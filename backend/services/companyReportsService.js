const authDbService = require('./authDbService');
const dbService = require('./dbService');
const reportService = require('./reportService');

const createHttpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const normalizeCode = (value) => String(value || '').trim().toUpperCase();

const requireReportsAccess = async (auth) => {
  const companyId = Number(auth?.companyId);
  const roleId = Number(auth?.roleId);
  if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(roleId) || roleId <= 0) {
    throw createHttpError(401, 'A valid company session is required.');
  }

  const right = await authDbService.queryOne(`
    SELECT RR.CanView
    FROM dbo.RoleRights RR
    INNER JOIN dbo.Menus M ON M.MenuId = RR.MenuId
    WHERE RR.RoleId = @roleId AND RR.CanView = 1 AND LOWER(M.MenuPath) = @path
  `, { roleId, path: '/reports/company' });
  if (!right) throw createHttpError(403, 'You do not have permission to view company reports.');
  return companyId;
};

const readActiveReportCodes = async () => {
  try {
    const result = await dbService.query(`
      SELECT DocCode, Status
      FROM RDOC
      WHERE Category = 'C' AND TypeCode = 'RCRI'
    `);
    return new Map((result.recordset || []).map((row) => [normalizeCode(row.DocCode), normalizeCode(row.Status)]));
  } catch (_error) {
    // SAP Report Service can still list and run layouts when direct company SQL is unavailable.
    return null;
  }
};

const listCompanyReports = async (auth) => {
  await requireReportsAccess(auth);
  const [authorized, statuses] = await Promise.all([
    reportService.loadAuthorizedCrList(),
    readActiveReportCodes(),
  ]);
  const seen = new Set();
  const items = authorized
    .filter((row) => /^RCRI\d+$/i.test(String(row.code || '')))
    .filter((row) => !statuses || statuses.get(normalizeCode(row.code)) === 'A')
    .filter((row) => {
      const code = normalizeCode(row.code);
      if (seen.has(code)) return false;
      seen.add(code);
      return true;
    })
    .map((row) => ({ code: normalizeCode(row.code), name: row.name || row.code }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.code.localeCompare(right.code));
  return { items, statusVerified: Boolean(statuses) };
};

const getCompanyReport = async (auth, rawCode) => {
  const code = normalizeCode(rawCode);
  if (!/^RCRI\d+$/.test(code)) throw createHttpError(400, 'Invalid company report code.');
  const catalog = await listCompanyReports(auth);
  const report = catalog.items.find((item) => item.code === code);
  if (!report) throw createHttpError(404, 'Report is not available for the selected company.');
  const parameters = (await reportService.loadReportParameters(code))
    .filter((parameter) => !reportService.isDocumentPrintSystemParameter(parameter.paramName));
  return { report, parameters };
};

const isOptionalLookup = (parameter) => /item|product|buyer|seller|customer|vendor|business partner|card.?code/i
  .test(`${parameter.displayName || ''} ${parameter.paramName || ''}`);

const normalizeParameterValue = (parameter, rawValue) => {
  // An explicitly cleared filter must not restore a previously saved SAP value.
  const value = rawValue == null ? (parameter.defaultValue || '') : rawValue;
  if (value === '') {
    if (parameter.isRequired) {
      throw createHttpError(400, `${parameter.displayName} is required.`);
    }
    return '';
  }
  if (parameter.paramType === 'date') {
    const date = String(value).trim();
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw createHttpError(400, `${parameter.displayName} must be a valid date.`);
    }
    return date;
  }
  if (parameter.paramType === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw createHttpError(400, `${parameter.displayName} must be a valid number.`);
    return number;
  }
  const text = String(value).trim();
  return isOptionalLookup(parameter) && text.includes(' - ') ? text.split(' - ')[0].trim() : text;
};

const runCompanyReport = async (auth, code, submitted = {}) => {
  const { report, parameters } = await getCompanyReport(auth, code);
  const values = parameters.map((parameter) => ({
    name: parameter.apiName || parameter.paramName,
    type: parameter.paramType,
    value: normalizeParameterValue(parameter, submitted[parameter.paramName]),
  }));
  const result = await reportService.exportReportPdf({
    docCode: report.code,
    parameters: values,
    fileName: `${report.code}.pdf`,
    allowUnavailableLayoutMetadata: true,
  });
  return { reportCode: report.code, reportName: report.name, fileName: result.fileName || `${report.code}.pdf`, pdfBase64: result.base64Pdf };
};

module.exports = { listCompanyReports, getCompanyReport, runCompanyReport };
