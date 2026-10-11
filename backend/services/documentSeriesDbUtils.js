'use strict';
const { createTableFieldMetadataReader, normalizeRecordset, rowValue, resolveDatabaseScope } = require('./salesDocumentDbCompatibility');
const { text, isTrue, dateOnly, dedupeSeriesRows, selectSapEligibleSeries, chooseDefaultSeries, normalizeDocumentSubType, gstSeriesSubType } = require('./documentSeriesPolicy');
const readers = new WeakMap();
// Numbering-series permissions and user defaults apply to inventory and
// production documents as well as marketing documents.
const seriesPermissionObjects = new Set([
  '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23',
  '59', '60', '202', '1470000113', '540000006',
]);
const seriesError = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode, code: 'SAP_DOCUMENT_SERIES' });

const loadAllowedBranches = async (read, access) => {
  const branches = await read('OBPL', ['BPLId', ['Disabled', "'N'"]], {}, { optional: true });
  const active = branches.filter(row => !isTrue(row.Disabled) && Number(row.BPLId) > 0)
    .map(row => text(row.BPLId));
  if (!active.length) return new Set();
  const assignments = access.userCode
    ? await read('USR6', ['BPLId', 'UserCode'], { UserCode: access.userCode }, { optional: true }) : [];
  // SAP exposes series for the user's assigned active branches before a
  // document branch is chosen. Superusers may have no USR6 rows on older DBs.
  if (!access.userCode || (access.superuser && !assignments.length)) return new Set(active);
  const assigned = new Set(assignments.map(row => text(row.BPLId)));
  return new Set(active.filter(id => assigned.has(id)));
};

const createSeriesReader = async (db) => {
  const scope = await resolveDatabaseScope(db);
  if (!readers.has(db)) readers.set(db, createTableFieldMetadataReader({ database: db }));
  const metadata = readers.get(db);
  const quote = (name) => scope.dialect === 'hana'
    ? '"' + String(name).replace(/"/g, '""') + '"' : '[' + String(name).replace(/]/g, ']]') + ']';
  const read = async (table, columns, where = {}, { optional = false } = {}) => {
    const fields = await metadata(table);
    const physical = (name) => Object.keys(fields).find((field) => field.toLowerCase() === name.toLowerCase());
    if (!Object.keys(fields).length && optional) return [];
    const required = [...columns.filter((column) => typeof column === 'string'), ...Object.keys(where)];
    for (const name of required) {
      if (!physical(name)) throw seriesError('Cannot read SAP numbering configuration: ' + table + '.' + name + ' is unavailable.');
    }
    const select = columns.map((column) => {
      const [name, fallback = 'NULL'] = Array.isArray(column) ? column : [column, 'NULL'];
      return (physical(name) ? quote(physical(name)) : fallback) + ' AS ' + quote(name);
    });
    const params = {};
    const conditions = Object.entries(where).map(([name, value], index) => {
      params['p' + index] = value;
      return quote(physical(name)) + ' = @p' + index;
    });
    const result = await db.query('SELECT ' + select.join(', ') + ' FROM ' + quote(table) + (conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''), params);
    return normalizeRecordset(result).map((row) => Object.fromEntries(columns.map((column) => {
      const name = Array.isArray(column) ? column[0] : column;
      return [name, rowValue(row, name)];
    })));
  };
  return { read, scope };
};

const resolveMarketingDocumentSeries = async ({ db, objectCode, targetDate, branch = '', docSubType, transactionType, accessLoader, purpose = 'display' } = {}) => {
  if (!db || !text(objectCode)) throw seriesError('A company database and document object are required.');
  const date = dateOnly(targetDate || new Date());
  const branchId = text(branch) === '' ? null : Number(branch);
  if (branchId !== null && (!Number.isSafeInteger(branchId) || branchId < 0)) throw seriesError('Select a valid branch.', 400);
  const { read, scope } = await createSeriesReader(db);
  const code = text(objectCode);
  const strictUser = seriesPermissionObjects.has(code);
  const access = strictUser
    ? await (accessLoader || require('./documentSeriesAccess').loadDocumentSeriesAccess)({ read, scope })
    : { superuser: true, userId: null, manualAllowed: true, canUseGroup: async () => true };
  const [rows, periods, numbering, userDefaults, admin] = await Promise.all([
    read('NNM1', ['Series', 'SeriesName', 'ObjectCode', 'Indicator', 'NextNumber', 'Locked',
      ['InitialNum'], ['LastNum'], ['BeginStr', "''"], ['EndStr', "''"], ['BPLId'],
      ['DocSubType', "'--'"], ['GroupCode'], ['IsForCncl', "'N'"], ['SeriesType', "'D'"], ['IsManual', "'N'"]], { ObjectCode: code }),
    read('OFPR', ['Indicator', 'F_RefDate', 'T_RefDate', ['Name', "''"]]),
    read('ONNM', ['ObjectCode', ['DocSubType', "'--'"], ['DfltSeries'], ['DfltSerie']], { ObjectCode: code }),
    strictUser ? read('NNM2', ['ObjectCode', 'UserSign', 'Series', ['DocSubType', "'--'"]], { ObjectCode: code, UserSign: access.userId }, { optional: true }) : [],
    read('OADM', [['MltpBrnchs', "'N'"], ['Country', "''"]]),
  ]);
  const subtype = text(docSubType) ? normalizeDocumentSubType(docSubType) : text(admin[0]?.Country).toUpperCase() === 'IN' && ['13','14','18','19'].includes(code) ? gstSeriesSubType(transactionType) : '--';
  const currentPeriods = periods.filter((period) => date >= dateOnly(period.F_RefDate) && date <= dateOnly(period.T_RefDate));
  // SAP can retain the last configured period's choices on a new document
  // after the configured calendar ends. Display availability is not posting
  // eligibility. Never use this display context for creation or calendar gaps.
  const lastPeriodEnd = periods.reduce((last, period) => {
    const end = dateOnly(period.T_RefDate);
    return end > last ? end : last;
  }, '');
  const displayPeriods = !currentPeriods.length && purpose === 'display' && lastPeriodEnd && date > lastPeriodEnd
    ? periods.filter(period => dateOnly(period.T_RefDate) === lastPeriodEnd)
    : currentPeriods;
  const multipleBranches = isTrue(admin[0]?.MltpBrnchs);
  const needsBranch = multipleBranches && !(branchId > 0);
  const allowedBranches = multipleBranches ? await loadAllowedBranches(read, access) : null;
  const hasAssignedSeries = rows.some(row => Number(row.BPLId) > 0
    && normalizeDocumentSubType(row.DocSubType) === subtype
    && displayPeriods.some(period => text(period.Indicator) === text(row.Indicator)));
  let candidates = needsBranch && purpose !== 'display' ? [] : rows.filter((row) => {
    if (Number(row.Series) <= 0 || isTrue(row.IsManual) || isTrue(row.Locked) || isTrue(row.IsForCncl) || text(row.SeriesType) !== 'D') return false;
    if (normalizeDocumentSubType(row.DocSubType) !== subtype) return false;
    if (!displayPeriods.some((period) => text(period.Indicator) === text(row.Indicator))) return false;
    if (multipleBranches) {
      const seriesBranch = text(row.BPLId);
      if (Number(row.BPLId) > 0) {
        if (!allowedBranches.has(seriesBranch) || (branchId && Number(row.BPLId) !== branchId)) return false;
      } else if (hasAssignedSeries || !allowedBranches.size) return false;
      if (branchId && !allowedBranches.has(text(branchId))) return false;
    }
    const next = Number(row.NextNumber);
    return Number.isSafeInteger(next) && next > 0
      && (!(Number(row.LastNum) > 0) || next <= Number(row.LastNum))
      && (!(Number(row.InitialNum) > 0) || next >= Number(row.InitialNum));
  });
  const groups = [...new Set(candidates.map((row) => text(row.GroupCode)))];
  const allowed = new Set();
  for (const group of groups) if (await access.canUseGroup(group)) allowed.add(group);
  candidates = dedupeSeriesRows(candidates.filter((row) => allowed.has(text(row.GroupCode))));
  const matchesSubtype = (row) => normalizeDocumentSubType(row.DocSubType) === subtype;
  const defaultSeries = chooseDefaultSeries(candidates,
    userDefaults.filter(matchesSubtype).map((row) => row.Series),
    numbering.filter(matchesSubtype).map((row) => row.DfltSeries ?? row.DfltSerie));
  const manualAllowed = access.manualAllowed && displayPeriods.length > 0
    && (!multipleBranches || (allowedBranches.size > 0 && (purpose === 'display' || !needsBranch)));
  const series = candidates.map((row) => {
    const period = displayPeriods.find((item) => text(item.Indicator) === text(row.Indicator));
    return { ...row, DisplayName: row.SeriesName, RawSeriesName: row.SeriesName,
      BPLId: row.BPLId == null ? '' : text(row.BPLId), IsManual: false,
      IsDefault: text(row.Series) === text(defaultSeries), isDefault: text(row.Series) === text(defaultSeries),
      IsCurrentPeriod: currentPeriods.length > 0, isCurrentPeriod: currentPeriods.length > 0, Eligible: true, PostingEligible: currentPeriods.length > 0,
      FinancialYear: period.Name, FromDate: dateOnly(period.F_RefDate), ToDate: dateOnly(period.T_RefDate),
      ManualAllowed: manualAllowed, DefaultSeries: defaultSeries };
  }).sort((a, b) => Number(b.IsDefault) - Number(a.IsDefault) || Number(a.Series) - Number(b.Series));
  return { series, defaultSeries, manualAllowed, postingDate: date, docSubType: subtype, country: text(admin[0]?.Country).toUpperCase(),
    postingPeriodValid: currentPeriods.length > 0,
    periodContextSource: currentPeriods.length ? 'posting-date' : displayPeriods.length ? 'last-configured-period' : 'none',
    reason: needsBranch && purpose !== 'display' ? 'Select a branch before posting this document.' : !displayPeriods.length ? 'No posting period covers this posting date.' : !series.length ? 'No eligible automatic series for this posting date, branch and SAP user.' : '' };
};
const getMarketingDocumentSeries = async (options) => {
  const result = await resolveMarketingDocumentSeries(options);
  Object.defineProperty(result.series, 'seriesContext', { value: result, enumerable: false });
  return result.series;
};
const withSeriesContext = (series) => {
  const context = series?.seriesContext;
  return context ? { ...context, series } : { series };
};
module.exports = { getMarketingDocumentSeries, resolveMarketingDocumentSeries, withSeriesContext, createSeriesReader,
  selectSapEligibleSeries, _private: { dedupeSeriesRows, keepSapVisibleSeries: selectSapEligibleSeries } };
