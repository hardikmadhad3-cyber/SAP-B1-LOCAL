const db = require('./dbService');

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatDate = (value) => {
  if (!value) return new Date().toISOString().split('T')[0];
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).split('T')[0] : date.toISOString().split('T')[0];
};

const SAP_JOURNAL_PREVIEW_DOCUMENT_TYPES = {
  arReserveInvoice: { label: 'A/R Reserve Invoice' },
  delivery: { label: 'Delivery' },
  arInvoice: { label: 'A/R Invoice' },
  serviceArInvoice: { label: 'Service A/R Invoice', generator: 'generateFromServiceARInvoice' },
  return: { label: 'Return' },
  arCreditMemo: { label: 'A/R Credit Memo' },
  serviceArCreditMemo: { label: 'Service A/R Credit Memo', generator: 'generateFromServiceARCreditMemo' },
  apReserveInvoice: { label: 'A/P Reserve Invoice' },
  grpo: { label: 'Goods Receipt PO' },
  goodsReturn: { label: 'Goods Return' },
  apInvoice: { label: 'A/P Invoice' },
  serviceApInvoice: { label: 'Service A/P Invoice', generator: 'generateFromServiceAPInvoice' },
  apCreditMemo: { label: 'A/P Credit Memo' },
  serviceApCreditMemo: { label: 'Service A/P Credit Memo', generator: 'generateFromServiceAPCreditMemo' },
  incomingPayment: { label: 'Incoming Payment' },
  outgoingPayment: { label: 'Outgoing Payment' },
  goodsIssue: { label: 'Goods Issue' },
  goodsReceipt: { label: 'Goods Receipt' },
  inventoryTransfer: { label: 'Inventory Transfer' },
};

const normalizePreviewResponse = (journalEntry, documentTypeConfig) => ({
  entries: Array.isArray(journalEntry?.entries) ? journalEntry.entries : [journalEntry].filter(Boolean),
  warnings: [
    ...(Array.isArray(journalEntry?.warnings) ? journalEntry.warnings : []),
    'Preview is calculated before Add. The final SAP journal entry can differ if SAP numbering, exchange rates, inventory valuation, or posting settings change before the document is added.',
  ],
  source: {
    documentType: documentTypeConfig.label,
    sapType: documentTypeConfig.sapType || documentTypeConfig.label,
  },
});

const queryRows = async (sql, params = {}) => {
  const result = await db.query(sql, params);
  return result.recordset || [];
};

const safeRows = async (sql, params = {}) => {
  try {
    return await queryRows(sql, params);
  } catch (error) {
    console.error('[JournalEntry] SQL fallback:', error.message);
    return [];
  }
};

const getColumnMap = async (tableName) => {
  const rows = await safeRows(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = @tableName
  `, { tableName });

  return rows.reduce((map, row) => {
    const columnName = String(row.COLUMN_NAME || '').trim();
    if (columnName) map.set(columnName.toUpperCase(), columnName);
    return map;
  }, new Map());
};

const getColumnName = (columns, columnName) =>
  columns.get(String(columnName || '').trim().toUpperCase()) || '';

const columnFlag = (columns, columnName) =>
  getColumnName(columns, columnName) ? 1 : null;

const tableFlag = (columns) => (columns.size ? 1 : null);

const getTableShape = async () => {
  const headerColumns = await getColumnMap('OJDT');
  const lineColumns = await getColumnMap('JDT1');

  return {
    HeaderObjectId: tableFlag(headerColumns),
    LineObjectId: tableFlag(lineColumns),
    HeaderOriginColumn: columnFlag(headerColumns, 'Origin'),
    HeaderOriginNoColumn: columnFlag(headerColumns, 'OriginNo'),
    HeaderCreatedAtColumn: columnFlag(headerColumns, 'CreatedAt'),
    LineIdentityColumn: columnFlag(lineColumns, 'LineId'),
    LineAccountNameColumn: columnFlag(lineColumns, 'AccountName'),
  };
};

const ensureJournalTables = async () => {
  if (await db.getDialect() === 'hana') {
    return getTableShape();
  }

  await db.query(`
    IF OBJECT_ID('OJDT', 'U') IS NULL
    BEGIN
      CREATE TABLE OJDT(
        TransId INT IDENTITY PRIMARY KEY,
        Number INT,
        Series NVARCHAR(20),
        RefDate DATE,
        DueDate DATE,
        TaxDate DATE,
        Memo NVARCHAR(254),
        Origin NVARCHAR(50),
        OriginNo INT,
        CreatedAt DATETIME DEFAULT GETDATE()
      )
    END

    IF OBJECT_ID('JDT1', 'U') IS NULL
    BEGIN
      CREATE TABLE JDT1(
        LineId INT IDENTITY PRIMARY KEY,
        TransId INT,
        Account NVARCHAR(30),
        AccountName NVARCHAR(200),
        Debit DECIMAL(19,6),
        Credit DECIMAL(19,6),
        Project NVARCHAR(50),
        ProfitCenter NVARCHAR(50),
        Location NVARCHAR(50),
        Remarks NVARCHAR(250)
      )
    END
  `);

  return getTableShape();
};

const canPersistToShadowJournal = (shape) => (
  shape?.HeaderOriginColumn != null &&
  shape?.HeaderOriginNoColumn != null &&
  shape?.HeaderCreatedAtColumn != null &&
  shape?.LineIdentityColumn != null &&
  shape?.LineAccountNameColumn != null
);

const columnExpr = (shape, key, tableAlias, column, fallback = "''") => (
  shape?.[key] != null ? `${tableAlias}.${column}` : fallback
);

const coalesceExpr = (parts, fallback = "''") => {
  const expressions = parts.filter(Boolean);
  if (!expressions.length) return fallback;
  if (expressions.length === 1) return expressions[0];
  return `COALESCE(${expressions.join(', ')})`;
};

const getPostedJournalShape = async () => {
  const headerColumns = await getColumnMap('OJDT');
  const lineColumns = await getColumnMap('JDT1');
  const locationColumns = await getColumnMap('OLCT');

  return {
    HeaderSeriesColumn: columnFlag(headerColumns, 'Series'),
    HeaderNumberColumn: columnFlag(headerColumns, 'Number'),
    HeaderRefDateColumn: columnFlag(headerColumns, 'RefDate'),
    HeaderDueDateColumn: columnFlag(headerColumns, 'DueDate'),
    HeaderTaxDateColumn: columnFlag(headerColumns, 'TaxDate'),
    HeaderMemoColumn: columnFlag(headerColumns, 'Memo'),
    HeaderRef1Column: columnFlag(headerColumns, 'Ref1'),
    HeaderRef2Column: columnFlag(headerColumns, 'Ref2'),
    HeaderRef3Column: columnFlag(headerColumns, 'Ref3'),
    LineIdColumn: columnFlag(lineColumns, 'Line_ID'),
    LineAccountColumn: columnFlag(lineColumns, 'Account'),
    LineShortNameColumn: columnFlag(lineColumns, 'ShortName'),
    LineDebitColumn: columnFlag(lineColumns, 'Debit'),
    LineCreditColumn: columnFlag(lineColumns, 'Credit'),
    LineTaxCodeColumn: columnFlag(lineColumns, 'TaxCode'),
    LineMemoColumn: columnFlag(lineColumns, 'LineMemo'),
    LineProjectColumn: columnFlag(lineColumns, 'Project'),
    LineLocCodeColumn: columnFlag(lineColumns, 'LocCode'),
    LineLocationColumn: columnFlag(lineColumns, 'Location'),
    LineProfitCodeColumn: columnFlag(lineColumns, 'ProfitCode'),
    LineOcrCodeColumn: columnFlag(lineColumns, 'OcrCode'),
    LocationMasterObjectId: tableFlag(locationColumns),
    LocationMasterCodeColumn: columnFlag(locationColumns, 'Code'),
    LocationMasterNameColumn: columnFlag(locationColumns, 'Location'),
  };
};

const getPostedJournal = async ({
  transId,
  origin = 'Service A/R Invoice',
  originNo = null,
  reference2 = '',
}) => {
  const id = toNumber(transId);
  if (!id) return null;

  const shape = await getPostedJournalShape();
  if (shape.HeaderNumberColumn == null || shape.LineAccountColumn == null) return null;

  const headerRows = await safeRows(`
    SELECT TOP 1
      T0.TransId,
      ${columnExpr(shape, 'HeaderSeriesColumn', 'T0', 'Series', 'NULL')} AS Series,
      NNM.SeriesName,
      ${columnExpr(shape, 'HeaderNumberColumn', 'T0', 'Number', 'NULL')} AS Number,
      ${columnExpr(shape, 'HeaderRefDateColumn', 'T0', 'RefDate', 'NULL')} AS RefDate,
      ${columnExpr(shape, 'HeaderDueDateColumn', 'T0', 'DueDate', 'NULL')} AS DueDate,
      ${columnExpr(shape, 'HeaderTaxDateColumn', 'T0', 'TaxDate', 'NULL')} AS TaxDate,
      ${columnExpr(shape, 'HeaderMemoColumn', 'T0', 'Memo', "''")} AS Memo,
      ${columnExpr(shape, 'HeaderRef1Column', 'T0', 'Ref1', "''")} AS Ref1,
      ${columnExpr(shape, 'HeaderRef2Column', 'T0', 'Ref2', "''")} AS Ref2,
      ${columnExpr(shape, 'HeaderRef3Column', 'T0', 'Ref3', "''")} AS Ref3
    FROM OJDT T0
    LEFT JOIN NNM1 NNM ON NNM.ObjectCode = '30' AND NNM.Series = ${columnExpr(shape, 'HeaderSeriesColumn', 'T0', 'Series', 'NULL')}
    WHERE T0.TransId = @transId
  `, { transId: id });

  const header = headerRows[0];
  if (!header) return null;

  const accountExpr = shape.LineShortNameColumn != null
    ? 'COALESCE(NULLIF(T1.ShortName, \'\'), T1.Account)'
    : 'T1.Account';
  const profitCenterExpr = coalesceExpr([
    shape.LineProfitCodeColumn != null ? 'NULLIF(CAST(T1.ProfitCode AS NVARCHAR(50)), \'\')' : null,
    shape.LineOcrCodeColumn != null ? 'NULLIF(CAST(T1.OcrCode AS NVARCHAR(50)), \'\')' : null,
  ]);
  const canJoinLocationMaster = (
    (shape.LineLocCodeColumn != null || shape.LineLocationColumn != null) &&
    shape.LocationMasterObjectId != null &&
    shape.LocationMasterCodeColumn != null &&
    shape.LocationMasterNameColumn != null
  );
  const locationMasterKey = shape.LineLocCodeColumn != null
    ? 'T1.LocCode'
    : "CASE WHEN ISNUMERIC(CAST(T1.Location AS NVARCHAR(50))) = 1 THEN CAST(T1.Location AS INT) ELSE NULL END";
  const locationExpr = coalesceExpr([
    canJoinLocationMaster ? 'NULLIF(CAST(LOC.Location AS NVARCHAR(50)), \'\')' : null,
    shape.LineLocationColumn != null ? 'NULLIF(CAST(T1.Location AS NVARCHAR(50)), \'\')' : null,
    shape.LineLocCodeColumn != null ? 'CAST(T1.LocCode AS NVARCHAR(50))' : null,
  ]);
  const locationJoin = canJoinLocationMaster
    ? `LEFT JOIN OLCT LOC ON LOC.Code = ${locationMasterKey}`
    : '';

  const lineRows = await safeRows(`
    SELECT
      ${columnExpr(shape, 'LineIdColumn', 'T1', 'Line_ID', '0')} AS LineId,
      ${accountExpr} AS DisplayAccount,
      T1.Account AS ControlAccount,
      COALESCE(NULLIF(BP.CardName, ''), NULLIF(ACT.AcctName, ''), ${accountExpr}) AS DisplayName,
      ${columnExpr(shape, 'LineDebitColumn', 'T1', 'Debit', '0')} AS Debit,
      ${columnExpr(shape, 'LineCreditColumn', 'T1', 'Credit', '0')} AS Credit,
      ${columnExpr(shape, 'LineTaxCodeColumn', 'T1', 'TaxCode', "''")} AS TaxCode,
      ${columnExpr(shape, 'LineMemoColumn', 'T1', 'LineMemo', "''")} AS Remarks,
      ${columnExpr(shape, 'LineProjectColumn', 'T1', 'Project', "''")} AS Project,
      ${locationExpr} AS Location,
      ${profitCenterExpr} AS ProfitCenter,
      BP.CardCode AS BusinessPartnerCode
    FROM JDT1 T1
    LEFT JOIN OCRD BP ON BP.CardCode = ${accountExpr}
    LEFT JOIN OACT ACT ON ACT.AcctCode = ${accountExpr}
    ${locationJoin}
    WHERE T1.TransId = @transId
    ORDER BY ${columnExpr(shape, 'LineIdColumn', 'T1', 'Line_ID', '0')}
  `, { transId: id });

  if (!lineRows.length) return null;

  const journal = {
    series: header.Series == null ? '' : String(header.Series),
    seriesName: header.SeriesName || header.Series || '',
    number: header.Number || '',
    postingDate: formatDate(header.RefDate),
    dueDate: formatDate(header.DueDate || header.RefDate),
    documentDate: formatDate(header.TaxDate || header.RefDate),
    origin,
    originNo,
    transNo: header.TransId,
    remarks: header.Memo || '',
    reference1: header.Ref1 || '',
    reference2: header.Ref2 || reference2 || '',
    reference3: header.Ref3 || '',
    project: '',
    location: '',
    posted: true,
    lines: lineRows.map((line, index) => ({
      lineId: index + 1,
      account: line.DisplayAccount || '',
      controlAccount: line.BusinessPartnerCode ? line.ControlAccount || '' : '',
      name: line.DisplayName || '',
      debit: round2(line.Debit),
      credit: round2(line.Credit),
      taxCode: line.TaxCode || '',
      remarks: line.Remarks || '',
      project: line.Project || '',
      profitCenter: line.ProfitCenter || '',
      location: line.Location || '',
      goldenArrowTarget: line.BusinessPartnerCode ? 'businessPartner' : 'account',
    })),
  };

  journal.totalDebit = round2(journal.lines.reduce((sum, line) => sum + line.debit, 0));
  journal.totalCredit = round2(journal.lines.reduce((sum, line) => sum + line.credit, 0));
  journal.difference = round2(journal.totalDebit - journal.totalCredit);
  journal.isBalanced = Math.abs(journal.difference) < 0.005;
  return journal;
};

const getNextJournalNumber = async () => {
  const columns = await getColumnMap('OJDT');
  if (!getColumnName(columns, 'Number')) return 1;

  const rows = await safeRows(`
    SELECT ISNULL(MAX(Number), 0) + 1 AS NextNumber
    FROM OJDT
  `);
  return Number(rows[0]?.NextNumber || 1);
};

const getJournalEntrySeries = async (postingDate = '') => {
  const columns = await getColumnMap('NNM1');
  if (!columns.size || !getColumnName(columns, 'Series')) return [];

  const optionalSeriesColumn = (columnName, fallback) => {
    const actualName = getColumnName(columns, columnName);
    return actualName ? `T0.${actualName}` : fallback;
  };

  const rows = await safeRows(`
    SELECT TOP 200
      T0.Series,
      ${optionalSeriesColumn('SeriesName', "CAST(T0.Series AS NVARCHAR(20))")} AS SeriesName,
      ${optionalSeriesColumn('NextNumber', 'NULL')} AS NextNumber,
      ${optionalSeriesColumn('InitialNum', 'NULL')} AS InitialNumber,
      ${optionalSeriesColumn('LastNum', 'NULL')} AS LastNumber,
      ${optionalSeriesColumn('Indicator', "''")} AS Indicator,
      ${optionalSeriesColumn('Locked', "'N'")} AS Locked,
      ${optionalSeriesColumn('BPLId', 'NULL')} AS BPLId
    FROM NNM1 T0
    WHERE CAST(T0.ObjectCode AS NVARCHAR(20)) = '30'
    ORDER BY T0.Series
  `);

  const [defaultRows, periodRows] = await Promise.all([
    safeRows(`SELECT TOP 1 DfltSeries FROM ONNM WHERE CAST(ObjectCode AS NVARCHAR(20)) = '30'`),
    safeRows(`
      SELECT Indicator, MIN(F_RefDate) AS FromDate, MAX(T_RefDate) AS ToDate
      FROM OFPR
      GROUP BY Indicator
    `),
  ]);
  const defaultSeries = String(defaultRows[0]?.DfltSeries ?? '');
  const requestedDate = postingDate ? new Date(`${String(postingDate).slice(0, 10)}T00:00:00`) : null;
  const periodByIndicator = new Map(periodRows.map((row) => [String(row.Indicator || '').trim(), row]));

  let liveSeries = rows
    .filter((row) => String(row.Locked || 'N').toUpperCase() !== 'Y')
    .map((row) => ({
      series: String(row.Series ?? ''),
      name: String(row.SeriesName || row.Series || '').trim(),
      nextNumber: row.NextNumber ?? '',
      initialNumber: row.InitialNumber ?? '',
      lastNumber: row.LastNumber ?? '',
      indicator: String(row.Indicator || '').trim(),
      branchId: row.BPLId ?? null,
      manual: Number(row.Series) === -1,
      isDefault: String(row.Series ?? '') === defaultSeries,
    }));

  if (requestedDate && !Number.isNaN(requestedDate.getTime())) {
    const datedSeries = liveSeries.filter((row) => {
      if (row.manual) return true;
      const period = periodByIndicator.get(row.indicator);
      if (!period || !row.indicator) return false;
      const from = new Date(period.FromDate);
      const to = new Date(period.ToDate);
      return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && requestedDate >= from && requestedDate <= to;
    });
    if (datedSeries.some((row) => !row.manual)) liveSeries = datedSeries;
  }

  if (!liveSeries.some((row) => row.manual)) {
    liveSeries.push({
      series: '-1',
      name: 'Manual',
      nextNumber: '',
      initialNumber: '',
      lastNumber: '',
      indicator: '',
      branchId: null,
      manual: true,
      isDefault: false,
    });
  }

  return liveSeries;
};

const getJournalRemarkTemplates = async (search = '') => {
  const rows = await queryRows('SELECT TOP 500 * FROM OTTR ORDER BY AbsEntry');
  const normalizedSearch = String(search || '').trim().toLowerCase();

  return rows.map((row, index) => {
    const values = Object.entries(row);
    const findValue = (...names) => {
      const nameSet = new Set(names.map((name) => name.toUpperCase()));
      return values.find(([key]) => nameSet.has(String(key).toUpperCase()))?.[1];
    };
    const id = findValue('AbsEntry', 'Code', 'TemplateId', 'ID') ?? index + 1;
    const namedDescription = findValue(
      'TemplateDescription',
      'Dscription',
      'Description',
      'Template',
      'TemplateName',
      'TemplName',
      'Remarks',
      'Remark',
      'RemarkText',
      'Text',
      'Name',
    );
    const description = namedDescription ?? values.find(([key, value]) => {
      const normalizedKey = String(key || '').toUpperCase();
      if (['ABSENTRY', 'USERSIGN', 'LOGINSTANC', 'LOGINSTANCE'].includes(normalizedKey)) return false;
      return typeof value === 'string' && String(value).trim();
    })?.[1];

    return {
      id: String(id),
      description: String(description ?? '').trim(),
    };
  }).filter((row) => row.description && (
    !normalizedSearch || row.description.toLowerCase().includes(normalizedSearch)
  ));
};

const getJournalEntryReferenceData = async ({ postingDate = '' } = {}) => {
  const series = await getJournalEntrySeries(postingDate);
  return { series };
};

const getJournalSeries = async () => {
  const series = await getJournalEntrySeries();
  return series.find((row) => !row.manual)?.name || `FY${new Date().getFullYear()}`;
};

const getAccountName = async (account) => {
  if (!String(account || '').trim()) return '';
  const rows = await safeRows(`
    SELECT TOP 1 AcctName
    FROM OACT
    WHERE AcctCode = @account
  `, { account });
  return rows[0]?.AcctName || '';
};

const getCustomer = async (customerCode, fallbackName = '') => {
  const code = String(customerCode || '').trim();
  if (!code) return { code: '', name: fallbackName, controlAccount: '' };

  const rows = await safeRows(`
    SELECT TOP 1 CardCode, CardName, DebPayAcct
    FROM OCRD
    WHERE CardCode = @code
  `, { code });
  const row = rows[0] || {};
  return {
    code: row.CardCode || code,
    name: row.CardName || fallbackName || code,
    controlAccount: row.DebPayAcct || '',
  };
};

const getTaxComponents = async (taxCodes) => {
  const codes = [...new Set((taxCodes || []).map((code) => String(code || '').trim()).filter(Boolean))];
  if (!codes.length) return new Map();

  const columns = await getColumnMap('STC1');
  const stcCodeColumn = getColumnName(columns, 'STCCode');
  const staCodeColumn = getColumnName(columns, 'STACode');
  const lineIdColumn = getColumnName(columns, 'Line_ID');
  const staTypeColumn = getColumnName(columns, 'STAType');
  const rateColumns = ['EfctivRate', 'Rate']
    .map((columnName) => getColumnName(columns, columnName))
    .filter(Boolean);

  if (!stcCodeColumn || !staCodeColumn) return new Map();

  const rateExpr = rateColumns.length > 1
    ? `COALESCE(${rateColumns.map((columnName) => `T0.${columnName}`).join(', ')})`
    : (rateColumns[0] ? `T0.${rateColumns[0]}` : '0');
  const staTypeFilter = staTypeColumn
    ? `AND T0.${staTypeColumn} IN ('-100', '-110', '-120')`
    : '';
  const orderBy = lineIdColumn ? `ORDER BY T0.${stcCodeColumn}, T0.${lineIdColumn}` : `ORDER BY T0.${stcCodeColumn}`;

  const params = {};
  const placeholders = codes.map((code, index) => {
    const key = `code${index}`;
    params[key] = code;
    return `@${key}`;
  });

  const rows = await safeRows(`
    SELECT
      T0.${stcCodeColumn} AS STCCode,
      T0.${staCodeColumn} AS STACode,
      ${rateExpr} AS Rate
    FROM STC1 T0
    WHERE T0.${stcCodeColumn} IN (${placeholders.join(', ')})
      ${staTypeFilter}
    ${orderBy}
  `, params);

  return rows.reduce((map, row) => {
    const key = String(row.STCCode || '').trim();
    if (!key) return map;
    const current = map.get(key) || [];
    current.push({
      code: String(row.STACode || '').trim(),
      rate: toNumber(row.Rate),
    });
    map.set(key, current);
    return map;
  }, new Map());
};

const addGroupedLine = (groups, keyParts, line) => {
  const key = keyParts.map((part) => String(part ?? '')).join('|');
  const existing = groups.get(key);
  if (existing) {
    existing.debit = round2(existing.debit + line.debit);
    existing.credit = round2(existing.credit + line.credit);
    return;
  }
  groups.set(key, { ...line, debit: round2(line.debit), credit: round2(line.credit) });
};

const normalizeSourceLines = (payloadLines = [], discountPercent = 0) => {
  const discountFactor = Math.max(0, 1 - (toNumber(discountPercent) / 100));
  return payloadLines
    .filter((line) => String(line.description || line.glAccount || line.totalLC || line.unitPrice || '').trim())
    .map((line, index) => {
      const gross = toNumber(line.totalLC) || (toNumber(line.unitPrice) * (toNumber(line.sQty) || 1));
      return {
        index,
        account: String(line.glAccount || '').trim(),
        accountName: String(line.glAccountName || '').trim(),
        amount: round2(gross * discountFactor),
        taxAmount: round2(toNumber(line.taxAmountLC) * discountFactor),
        taxCode: String(line.taxCode || '').trim(),
        remarks: String(line.description || '').trim(),
        project: String(line.project || line.Project || '').trim(),
        profitCenter: String(line.distRule || line.profitCenter || line.ProfitCenter || '').trim(),
        location: String(line.loc || line.location || line.Location || '').trim(),
      };
    })
    .filter((line) => line.account && line.amount > 0);
};

const buildJournal = async ({ header = {}, lines = [], origin = 'Service A/R Invoice', originNo = null, transId = null }) => {
  const customerCode = header.vendor || header.customerCode || header.cardCode || '';
  const customer = await getCustomer(customerCode, header.name || header.customerName || '');
  const sourceLines = normalizeSourceLines(lines, header.discount);
  if (!customer.code) throw new Error('Customer is required to preview Journal Entry.');
  if (!sourceLines.length) throw new Error('At least one service line is required to preview Journal Entry.');

  const taxComponentsByCode = await getTaxComponents(sourceLines.map((line) => line.taxCode));
  const revenueGroups = new Map();
  const taxGroups = new Map();

  sourceLines.forEach((line) => {
    addGroupedLine(revenueGroups, [line.account, line.project, line.profitCenter, line.location], {
      account: line.account,
      name: line.accountName || line.account,
      debit: 0,
      credit: line.amount,
      taxCode: line.taxCode,
      remarks: line.remarks,
      project: line.project,
      profitCenter: line.profitCenter,
      location: line.location,
      goldenArrowTarget: 'account',
    });

    if (line.taxAmount <= 0) return;
    const components = taxComponentsByCode.get(line.taxCode) || [];
    const componentRateTotal = components.reduce((sum, component) => sum + Math.abs(component.rate), 0);
    if (components.length && componentRateTotal > 0) {
      components.forEach((component) => {
        const componentAmount = round2(line.taxAmount * Math.abs(component.rate) / componentRateTotal);
        addGroupedLine(taxGroups, [component.code, line.taxCode], {
          account: component.code || line.taxCode,
          name: component.code ? `Output ${component.code}` : `Output GST ${line.taxCode}`,
          debit: 0,
          credit: componentAmount,
          taxCode: line.taxCode,
          remarks: `Output GST - ${line.taxCode}`,
          project: line.project,
          profitCenter: line.profitCenter,
          location: line.location,
          goldenArrowTarget: 'tax',
        });
      });
    } else {
      addGroupedLine(taxGroups, [line.taxCode], {
        account: line.taxCode || 'OUTPUT_GST',
        name: line.taxCode ? `Output GST ${line.taxCode}` : 'Output GST',
        debit: 0,
        credit: line.taxAmount,
        taxCode: line.taxCode,
        remarks: `Output GST - ${line.taxCode}`,
        project: line.project,
        profitCenter: line.profitCenter,
        location: line.location,
        goldenArrowTarget: 'tax',
      });
    }
  });

  const creditLines = [...revenueGroups.values(), ...taxGroups.values()];
  const creditTotal = round2(creditLines.reduce((sum, line) => sum + line.credit, 0));
  const debitAccountName = customer.name || await getAccountName(customer.controlAccount);
  const series = header.journalSeries || await getJournalSeries();
  const number = header.journalNumber || await getNextJournalNumber();

  const journal = {
    series,
    number,
    postingDate: formatDate(header.postingDate || header.DocDate),
    dueDate: formatDate(header.deliveryDate || header.dueDate || header.DocDueDate || header.postingDate),
    documentDate: formatDate(header.documentDate || header.taxDate || header.TaxDate || header.postingDate),
    origin,
    originNo,
    transNo: transId,
    remarks: header.journalRemark || header.remarks || `${origin}${originNo ? ` ${originNo}` : ''}`,
    reference1: header.salesContractNo || '',
    reference2: customer.code,
    reference3: '',
    project: '',
    location: '',
    lines: [
      {
        account: customer.code,
        controlAccount: customer.controlAccount,
        name: debitAccountName,
        debit: creditTotal,
        credit: 0,
        taxCode: '',
        remarks: header.remarks || `${customer.name} receivable`,
        project: '',
        profitCenter: '',
        location: '',
        goldenArrowTarget: 'businessPartner',
      },
      ...creditLines,
    ].map((line, index) => ({ lineId: index + 1, ...line })),
  };

  const totalDebit = round2(journal.lines.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = round2(journal.lines.reduce((sum, line) => sum + line.credit, 0));
  journal.totalDebit = totalDebit;
  journal.totalCredit = totalCredit;
  journal.difference = round2(totalDebit - totalCredit);
  journal.isBalanced = Math.abs(journal.difference) < 0.005;
  return journal;
};

const buildAPJournal = async ({ header = {}, lines = [], origin = 'Service A/P Invoice', originNo = null, transId = null }) => {
  const vendorCode = header.vendor || header.vendorCode || header.cardCode || '';
  const vendor = await getCustomer(vendorCode, header.name || header.vendorName || '');
  const sourceLines = normalizeSourceLines(lines, header.discount);
  if (!vendor.code) throw new Error('Vendor is required to preview Journal Entry.');
  if (!sourceLines.length) throw new Error('At least one service line is required to preview Journal Entry.');

  const taxComponentsByCode = await getTaxComponents(sourceLines.map((line) => line.taxCode));
  const expenseGroups = new Map();
  const taxGroups = new Map();

  sourceLines.forEach((line) => {
    addGroupedLine(expenseGroups, [line.account, line.project, line.profitCenter, line.location], {
      account: line.account,
      name: line.accountName || line.account,
      debit: line.amount,
      credit: 0,
      taxCode: line.taxCode,
      remarks: line.remarks,
      project: line.project,
      profitCenter: line.profitCenter,
      location: line.location,
      goldenArrowTarget: 'account',
    });

    if (line.taxAmount <= 0) return;
    const components = taxComponentsByCode.get(line.taxCode) || [];
    const componentRateTotal = components.reduce((sum, component) => sum + Math.abs(component.rate), 0);
    if (components.length && componentRateTotal > 0) {
      components.forEach((component) => {
        const componentAmount = round2(line.taxAmount * Math.abs(component.rate) / componentRateTotal);
        addGroupedLine(taxGroups, [component.code, line.taxCode], {
          account: component.code || line.taxCode,
          name: component.code ? `Input ${component.code}` : `Input GST ${line.taxCode}`,
          debit: componentAmount,
          credit: 0,
          taxCode: line.taxCode,
          remarks: `Input GST - ${line.taxCode}`,
          project: line.project,
          profitCenter: line.profitCenter,
          location: line.location,
          goldenArrowTarget: 'tax',
        });
      });
    } else {
      addGroupedLine(taxGroups, [line.taxCode], {
        account: line.taxCode || 'INPUT_GST',
        name: line.taxCode ? `Input GST ${line.taxCode}` : 'Input GST',
        debit: line.taxAmount,
        credit: 0,
        taxCode: line.taxCode,
        remarks: `Input GST - ${line.taxCode}`,
        project: line.project,
        profitCenter: line.profitCenter,
        location: line.location,
        goldenArrowTarget: 'tax',
      });
    }
  });

  const debitLines = [...expenseGroups.values(), ...taxGroups.values()];
  const debitTotal = round2(debitLines.reduce((sum, line) => sum + line.debit, 0));
  const creditAccountName = vendor.name || await getAccountName(vendor.controlAccount);
  const series = header.journalSeries || await getJournalSeries();
  const number = header.journalNumber || await getNextJournalNumber();

  const journal = {
    series,
    number,
    postingDate: formatDate(header.postingDate || header.DocDate),
    dueDate: formatDate(header.deliveryDate || header.dueDate || header.DocDueDate || header.postingDate),
    documentDate: formatDate(header.documentDate || header.taxDate || header.TaxDate || header.postingDate),
    origin,
    originNo,
    transNo: transId,
    remarks: header.journalRemark || header.remarks || `${origin}${originNo ? ` ${originNo}` : ''}`,
    reference1: header.salesContractNo || '',
    reference2: vendor.code,
    reference3: '',
    project: '',
    location: '',
    lines: [
      ...debitLines,
      {
        account: vendor.code,
        controlAccount: vendor.controlAccount,
        name: creditAccountName,
        debit: 0,
        credit: debitTotal,
        taxCode: '',
        remarks: header.remarks || `${vendor.name} payable`,
        project: '',
        profitCenter: '',
        location: '',
        goldenArrowTarget: 'businessPartner',
      },
    ].map((line, index) => ({ lineId: index + 1, ...line })),
  };

  const totalDebit = round2(journal.lines.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = round2(journal.lines.reduce((sum, line) => sum + line.credit, 0));
  journal.totalDebit = totalDebit;
  journal.totalCredit = totalCredit;
  journal.difference = round2(totalDebit - totalCredit);
  journal.isBalanced = Math.abs(journal.difference) < 0.005;
  return journal;
};

const reverseJournalAmounts = (journal, origin = journal.origin) => {
  const reversed = {
    ...journal,
    origin,
    remarks: String(journal.remarks || '').replace('Service A/P Invoice', origin),
    lines: (journal.lines || []).map((line, index) => ({
      ...line,
      lineId: index + 1,
      debit: round2(line.credit),
      credit: round2(line.debit),
    })),
  };

  reversed.totalDebit = round2(reversed.lines.reduce((sum, line) => sum + line.debit, 0));
  reversed.totalCredit = round2(reversed.lines.reduce((sum, line) => sum + line.credit, 0));
  reversed.difference = round2(reversed.totalDebit - reversed.totalCredit);
  reversed.isBalanced = Math.abs(reversed.difference) < 0.005;
  return reversed;
};

const getSavedInvoicePayload = async (docEntry) => {
  const headerRows = await queryRows(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.DocDate,
      T0.DocDueDate,
      T0.TaxDate,
      T0.Comments,
      T0.JrnlMemo,
      T0.NumAtCard,
      T0.DiscPrcnt,
      T0.TransId
    FROM OINV T0
    WHERE T0.DocEntry = @docEntry
      AND T0.DocType = 'S'
  `, { docEntry });

  if (!headerRows.length) throw new Error('Service A/R Invoice was not found.');

  const lineRows = await queryRows(`
    SELECT
      T1.LineNum,
      T1.AcctCode,
      OACT.AcctName,
      T1.Dscription,
      T1.OcrCode,
      T1.TaxCode,
      T1.LineTotal,
      T1.VatSum
    FROM INV1 T1
    LEFT JOIN OACT ON OACT.AcctCode = T1.AcctCode
    WHERE T1.DocEntry = @docEntry
    ORDER BY T1.LineNum
  `, { docEntry });

  const header = headerRows[0];
  return {
    header: {
      vendor: header.CardCode,
      customerCode: header.CardCode,
      name: header.CardName,
      postingDate: formatDate(header.DocDate),
      deliveryDate: formatDate(header.DocDueDate),
      documentDate: formatDate(header.TaxDate),
      remarks: header.Comments || '',
      journalRemark: header.JrnlMemo || '',
      salesContractNo: header.NumAtCard || '',
      discount: header.DiscPrcnt || 0,
    },
    lines: lineRows.map((line) => ({
      description: line.Dscription || '',
      glAccount: line.AcctCode || '',
      glAccountName: line.AcctName || '',
      distRule: line.OcrCode || '',
      taxCode: line.TaxCode || '',
      totalLC: line.LineTotal || 0,
      taxAmountLC: line.VatSum || 0,
    })),
    originNo: header.DocNum || docEntry,
    transId: header.TransId || null,
  };
};

const getSavedAPInvoicePayload = async (docEntry) => {
  const headerRows = await queryRows(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.DocDate,
      T0.DocDueDate,
      T0.TaxDate,
      T0.Comments,
      T0.JrnlMemo,
      T0.NumAtCard,
      T0.DiscPrcnt,
      T0.TransId
    FROM OPCH T0
    WHERE T0.DocEntry = @docEntry
      AND T0.DocType = 'S'
  `, { docEntry });

  if (!headerRows.length) throw new Error('Service A/P Invoice was not found.');

  const lineRows = await queryRows(`
    SELECT
      T1.LineNum,
      T1.AcctCode,
      OACT.AcctName,
      T1.Dscription,
      T1.OcrCode,
      T1.TaxCode,
      T1.LineTotal,
      T1.VatSum
    FROM PCH1 T1
    LEFT JOIN OACT ON OACT.AcctCode = T1.AcctCode
    WHERE T1.DocEntry = @docEntry
    ORDER BY T1.LineNum
  `, { docEntry });

  const header = headerRows[0];
  return {
    header: {
      vendor: header.CardCode,
      vendorCode: header.CardCode,
      name: header.CardName,
      postingDate: formatDate(header.DocDate),
      deliveryDate: formatDate(header.DocDueDate),
      documentDate: formatDate(header.TaxDate),
      remarks: header.Comments || '',
      journalRemark: header.JrnlMemo || '',
      salesContractNo: header.NumAtCard || '',
      discount: header.DiscPrcnt || 0,
    },
    lines: lineRows.map((line) => ({
      description: line.Dscription || '',
      glAccount: line.AcctCode || '',
      glAccountName: line.AcctName || '',
      distRule: line.OcrCode || '',
      taxCode: line.TaxCode || '',
      totalLC: line.LineTotal || 0,
      taxAmountLC: line.VatSum || 0,
    })),
    originNo: header.DocNum || docEntry,
    transId: header.TransId || null,
  };
};

const getSavedARCreditMemoPayload = async (docEntry) => {
  const headerRows = await queryRows(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.DocDate,
      T0.DocDueDate,
      T0.TaxDate,
      T0.Comments,
      T0.JrnlMemo,
      T0.NumAtCard,
      T0.DiscPrcnt,
      T0.TransId
    FROM ORIN T0
    WHERE T0.DocEntry = @docEntry
      AND T0.DocType = 'S'
  `, { docEntry });

  if (!headerRows.length) throw new Error('Service A/R Credit Memo was not found.');

  const lineRows = await queryRows(`
    SELECT
      T1.LineNum,
      T1.AcctCode,
      OACT.AcctName,
      T1.Dscription,
      T1.OcrCode,
      T1.TaxCode,
      T1.LineTotal,
      T1.VatSum
    FROM RIN1 T1
    LEFT JOIN OACT ON OACT.AcctCode = T1.AcctCode
    WHERE T1.DocEntry = @docEntry
    ORDER BY T1.LineNum
  `, { docEntry });

  const header = headerRows[0];
  return {
    header: {
      vendor: header.CardCode,
      customerCode: header.CardCode,
      name: header.CardName,
      postingDate: formatDate(header.DocDate),
      deliveryDate: formatDate(header.DocDueDate),
      documentDate: formatDate(header.TaxDate),
      remarks: header.Comments || '',
      journalRemark: header.JrnlMemo || '',
      salesContractNo: header.NumAtCard || '',
      discount: header.DiscPrcnt || 0,
    },
    lines: lineRows.map((line) => ({
      description: line.Dscription || '',
      glAccount: line.AcctCode || '',
      glAccountName: line.AcctName || '',
      distRule: line.OcrCode || '',
      taxCode: line.TaxCode || '',
      totalLC: line.LineTotal || 0,
      taxAmountLC: line.VatSum || 0,
    })),
    originNo: header.DocNum || docEntry,
    transId: header.TransId || null,
  };
};

const getSavedAPCreditMemoPayload = async (docEntry) => {
  const headerRows = await queryRows(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.DocDate,
      T0.DocDueDate,
      T0.TaxDate,
      T0.Comments,
      T0.JrnlMemo,
      T0.NumAtCard,
      T0.DiscPrcnt,
      T0.TransId
    FROM ORPC T0
    WHERE T0.DocEntry = @docEntry
      AND T0.DocType = 'S'
  `, { docEntry });

  if (!headerRows.length) throw new Error('Service A/P Credit Memo was not found.');

  const lineRows = await queryRows(`
    SELECT
      T1.LineNum,
      T1.AcctCode,
      OACT.AcctName,
      T1.Dscription,
      T1.OcrCode,
      T1.TaxCode,
      T1.LineTotal,
      T1.VatSum
    FROM RPC1 T1
    LEFT JOIN OACT ON OACT.AcctCode = T1.AcctCode
    WHERE T1.DocEntry = @docEntry
    ORDER BY T1.LineNum
  `, { docEntry });

  const header = headerRows[0];
  return {
    header: {
      vendor: header.CardCode,
      vendorCode: header.CardCode,
      name: header.CardName,
      postingDate: formatDate(header.DocDate),
      deliveryDate: formatDate(header.DocDueDate),
      documentDate: formatDate(header.TaxDate),
      remarks: header.Comments || '',
      journalRemark: header.JrnlMemo || '',
      salesContractNo: header.NumAtCard || '',
      discount: header.DiscPrcnt || 0,
    },
    lines: lineRows.map((line) => ({
      description: line.Dscription || '',
      glAccount: line.AcctCode || '',
      glAccountName: line.AcctName || '',
      distRule: line.OcrCode || '',
      taxCode: line.TaxCode || '',
      totalLC: line.LineTotal || 0,
      taxAmountLC: line.VatSum || 0,
    })),
    originNo: header.DocNum || docEntry,
    transId: header.TransId || null,
  };
};

const getExistingShadowJournal = async (originNo, origin = 'Service A/R Invoice') => {
  const shape = await getTableShape();
  if (!canPersistToShadowJournal(shape)) return null;

  const headerRows = await safeRows(`
    SELECT TOP 1 TransId, Number, Series, RefDate, DueDate, TaxDate, Memo, Origin, OriginNo
    FROM OJDT
    WHERE Origin = @origin
      AND OriginNo = @originNo
    ORDER BY TransId DESC
  `, { origin, originNo });

  const header = headerRows[0];
  if (!header) return null;

  const lines = await safeRows(`
    SELECT Account, AccountName, Debit, Credit, Project, ProfitCenter, Location, Remarks
    FROM JDT1
    WHERE TransId = @transId
    ORDER BY LineId
  `, { transId: header.TransId });

  const journal = {
    series: header.Series || '',
    number: header.Number,
    postingDate: formatDate(header.RefDate),
    dueDate: formatDate(header.DueDate),
    documentDate: formatDate(header.TaxDate),
    origin: header.Origin || origin,
    originNo: header.OriginNo,
    transNo: header.TransId,
    remarks: header.Memo || '',
    reference1: '',
    reference2: '',
    reference3: '',
    project: '',
    location: '',
    persisted: true,
    lines: lines.map((line, index) => ({
      lineId: index + 1,
      account: line.Account || '',
      name: line.AccountName || '',
      debit: toNumber(line.Debit),
      credit: toNumber(line.Credit),
      taxCode: '',
      remarks: line.Remarks || '',
      project: line.Project || '',
      profitCenter: line.ProfitCenter || '',
      location: line.Location || '',
    })),
  };

  journal.totalDebit = round2(journal.lines.reduce((sum, line) => sum + line.debit, 0));
  journal.totalCredit = round2(journal.lines.reduce((sum, line) => sum + line.credit, 0));
  journal.difference = round2(journal.totalDebit - journal.totalCredit);
  journal.isBalanced = Math.abs(journal.difference) < 0.005;
  return journal;
};

const persistShadowJournal = async (journal) => {
  if (await db.getDialect() === 'hana') {
    return {
      ...journal,
      persisted: false,
      persistenceNote: 'SAP HANA company databases do not support direct SQL journal insertion; direct SQL journal insertion was skipped.',
    };
  }

  const shape = await ensureJournalTables();
  if (!canPersistToShadowJournal(shape)) {
    return {
      ...journal,
      persisted: false,
      persistenceNote: 'SAP standard OJDT/JDT1 tables were detected; direct SQL journal insertion was skipped.',
    };
  }

  const existing = await getExistingShadowJournal(journal.originNo, journal.origin);
  if (existing) return existing;

  const insertHeader = await queryRows(`
    INSERT INTO OJDT(Number, Series, RefDate, DueDate, TaxDate, Memo, Origin, OriginNo)
    OUTPUT INSERTED.TransId
    VALUES(@number, @series, @refDate, @dueDate, @taxDate, @memo, @origin, @originNo)
  `, {
    number: journal.number,
    series: journal.series,
    refDate: journal.postingDate,
    dueDate: journal.dueDate,
    taxDate: journal.documentDate,
    memo: journal.remarks,
    origin: journal.origin,
    originNo: journal.originNo,
  });

  const transId = insertHeader[0]?.TransId;
  for (const line of journal.lines) {
    await db.query(`
      INSERT INTO JDT1(TransId, Account, AccountName, Debit, Credit, Project, ProfitCenter, Location, Remarks)
      VALUES(@transId, @account, @accountName, @debit, @credit, @project, @profitCenter, @location, @remarks)
    `, {
      transId,
      account: line.account,
      accountName: line.name,
      debit: line.debit,
      credit: line.credit,
      project: line.project || '',
      profitCenter: line.profitCenter || '',
      location: line.location || '',
      remarks: line.remarks || '',
    });
  }

  return {
    ...journal,
    transNo: transId,
    persisted: true,
  };
};

const generateFromServiceARInvoice = async ({ docEntry, payload, persist = false }) => {
  if (docEntry) {
    const saved = await getSavedInvoicePayload(docEntry);
    const posted = await getPostedJournal({
      transId: saved.transId,
      origin: 'Service A/R Invoice',
      originNo: saved.originNo,
      reference2: saved.header.customerCode,
    });
    if (posted) return posted;
    const existing = persist ? await getExistingShadowJournal(saved.originNo, 'Service A/R Invoice') : null;
    if (existing) return existing;
    const journal = await buildJournal({
      ...saved,
      origin: 'Service A/R Invoice',
      originNo: saved.originNo,
      transId: saved.transId,
    });
    return persist ? persistShadowJournal(journal) : journal;
  }

  const source = payload || {};
  const journal = await buildJournal({
    header: source.header || {},
    lines: source.lines || [],
    origin: 'Service A/R Invoice',
    originNo: source.header?.docNo || null,
  });
  return { ...journal, persisted: false };
};

const generateFromServiceAPInvoice = async ({ docEntry, payload, persist = false }) => {
  if (docEntry) {
    const saved = await getSavedAPInvoicePayload(docEntry);
    const posted = await getPostedJournal({
      transId: saved.transId,
      origin: 'Service A/P Invoice',
      originNo: saved.originNo,
      reference2: saved.header.vendorCode,
    });
    if (posted) return posted;
    const existing = persist ? await getExistingShadowJournal(saved.originNo, 'Service A/P Invoice') : null;
    if (existing) return existing;
    const journal = await buildAPJournal({
      ...saved,
      origin: 'Service A/P Invoice',
      originNo: saved.originNo,
      transId: saved.transId,
    });
    return persist ? persistShadowJournal(journal) : journal;
  }

  const source = payload || {};
  const journal = await buildAPJournal({
    header: source.header || {},
    lines: source.lines || [],
    origin: 'Service A/P Invoice',
    originNo: source.header?.docNo || null,
  });
  return { ...journal, persisted: false };
};

const generateFromServiceAPCreditMemo = async ({ docEntry, payload, persist = false }) => {
  const origin = 'Service A/P Credit Memo';

  if (docEntry) {
    const saved = await getSavedAPCreditMemoPayload(docEntry);
    const posted = await getPostedJournal({
      transId: saved.transId,
      origin,
      originNo: saved.originNo,
      reference2: saved.header.vendorCode,
    });
    if (posted) return posted;
    const existing = persist ? await getExistingShadowJournal(saved.originNo, origin) : null;
    if (existing) return existing;
    const journal = reverseJournalAmounts(await buildAPJournal({
      ...saved,
      origin,
      originNo: saved.originNo,
      transId: saved.transId,
    }), origin);
    return persist ? persistShadowJournal(journal) : journal;
  }

  const source = payload || {};
  const journal = reverseJournalAmounts(await buildAPJournal({
    header: source.header || {},
    lines: source.lines || [],
    origin,
    originNo: source.header?.docNo || null,
  }), origin);
  return { ...journal, persisted: false };
};

const generateFromServiceARCreditMemo = async ({ docEntry, payload, persist = false }) => {
  const origin = 'Service A/R Credit Memo';

  if (docEntry) {
    const saved = await getSavedARCreditMemoPayload(docEntry);
    const posted = await getPostedJournal({
      transId: saved.transId,
      origin,
      originNo: saved.originNo,
      reference2: saved.header.customerCode,
    });
    if (posted) return posted;
    const existing = persist ? await getExistingShadowJournal(saved.originNo, origin) : null;
    if (existing) return existing;
    const journal = reverseJournalAmounts(await buildJournal({
      ...saved,
      origin,
      originNo: saved.originNo,
      transId: saved.transId,
    }), origin);
    return persist ? persistShadowJournal(journal) : journal;
  }

  const source = payload || {};
  const journal = reverseJournalAmounts(await buildJournal({
    header: source.header || {},
    lines: source.lines || [],
    origin,
    originNo: source.header?.docNo || null,
  }), origin);
  return { ...journal, persisted: false };
};

const previewJournalEntry = async ({ documentType, docEntry, payload } = {}) => {
  const key = String(documentType || '').trim();
  const config = SAP_JOURNAL_PREVIEW_DOCUMENT_TYPES[key];
  if (!config) {
    const error = new Error('Journal Entry Preview is available only for SAP posting documents that support it.');
    error.status = 400;
    throw error;
  }

  if (docEntry) {
    const error = new Error('SAP Journal Entry Preview is available in Add mode before the document is added.');
    error.status = 400;
    throw error;
  }

  if (!config.generator) {
    const error = new Error(`${config.label} is supported by SAP Journal Entry Preview, but this deployment needs the native SAP preview capability exposed before we can calculate it accurately.`);
    error.status = 501;
    error.response = {
      data: {
        sapDocumentType: config.sapType || config.label,
        reason: 'No official Service Layer preview action was discovered in the connected metadata, and this app does not have a parity-safe local calculator for this document type.',
      },
    };
    throw error;
  }

  const generator = module.exports[config.generator];
  const journalEntry = await generator({
    docEntry: null,
    payload,
    persist: false,
  });

  return normalizePreviewResponse(journalEntry, config);
};

const normalizeManualLine = (line = {}) => ({
  accountCode: String(line.accountCode || line.account || line.glAccount || '').trim(),
  accountName: String(line.accountName || line.name || '').trim(),
  accountType: String(line.accountType || line.entityType || '').trim(),
  debit: round2(toNumber(line.debit)),
  credit: round2(toNumber(line.credit)),
  remarks: String(line.remarks || line.lineMemo || '').trim(),
  taxCode: String(line.taxCode || '').trim(),
  project: String(line.project || '').trim(),
  distRule: String(line.distRule || line.profitCenter || '').trim(),
  location: String(line.location || line.loc || '').trim(),
});

const createManualJournalEntry = async (payload = {}) => {
  const header = payload.header || payload;
  const sourceLines = Array.isArray(payload.lines) ? payload.lines : [];
  const lines = sourceLines
    .map(normalizeManualLine)
    .filter((line) => line.accountCode || line.accountName || line.debit || line.credit || line.remarks);

  if (!lines.length) {
    throw new Error('At least one journal entry row is required.');
  }

  const invalidLine = lines.find((line) => !line.accountCode || (line.debit > 0 && line.credit > 0) || (line.debit <= 0 && line.credit <= 0));
  if (invalidLine) {
    throw new Error('Each journal row must have an account and either debit or credit amount.');
  }

  const totalDebit = round2(lines.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = round2(lines.reduce((sum, line) => sum + line.credit, 0));
  // Rows with a tax code get their tax rows added on posting, which then checks the balance.
  if (!lines.some((line) => line.taxCode) && Math.abs(totalDebit - totalCredit) >= 0.005) {
    throw new Error('Journal entry is not balanced.');
  }

  const data = {
    ReferenceDate: formatDate(header.postingDate || header.ReferenceDate),
    DueDate: formatDate(header.dueDate || header.DueDate || header.postingDate),
    TaxDate: formatDate(header.documentDate || header.taxDate || header.TaxDate || header.postingDate),
    Memo: String(header.remarks || header.memo || '').trim(),
    TransactionCode: String(header.transCode || header.transactionCode || '').trim(),
    Reference: String(header.reference1 || header.ref1 || '').trim(),
    Reference2: String(header.reference2 || header.ref2 || '').trim(),
    Reference3: String(header.reference3 || header.ref3 || '').trim(),
    ProjectCode: String(header.project || '').trim(),
    Indicator: String(header.indicator || '').trim(),
    JournalEntryLines: lines.map((line) => {
      const journalLine = {
        ShortName: line.accountCode,
        Debit: line.debit,
        Credit: line.credit,
        LineMemo: line.remarks,
      };

      if (line.accountType !== 'businessPartner') journalLine.AccountCode = line.accountCode;

      if (line.taxCode) journalLine.TaxCode = line.taxCode;
      if (line.project) journalLine.ProjectCode = line.project;
      if (line.distRule) journalLine.CostingCode = line.distRule;
      if (line.location) journalLine.LocationCode = line.location;
      return journalLine;
    }),
  };

  const selectedSeries = Number(header.series ?? header.Series);
  if (Number.isInteger(selectedSeries) && selectedSeries >= 0) {
    data.Series = selectedSeries;
  }

  Object.keys(data).forEach((key) => {
    if (data[key] === '') delete data[key];
  });

  const sapService = require('./sapService');
  const response = await sapService.request({
    method: 'POST',
    url: '/JournalEntries',
    data,
  });

  return {
    success: true,
    message: 'Journal Entry added successfully.',
    totalDebit,
    totalCredit,
    data: response.data,
  };
};

const getJournalEntryByTransId = async (transId) => {
  const journal = await getPostedJournal({
    transId,
    origin: 'Journal Entry',
  });
  if (!journal) {
    const error = new Error('Journal Entry was not found.');
    error.status = 404;
    throw error;
  }
  return journal;
};

const searchJournalEntries = async (query = '') => {
  const shape = await getPostedJournalShape();
  if (shape.HeaderNumberColumn == null) return [];

  const search = String(query || '').trim();
  const where = search
    ? `WHERE CAST(T0.TransId AS NVARCHAR(50)) LIKE @query
        OR CAST(${columnExpr(shape, 'HeaderNumberColumn', 'T0', 'Number', 'NULL')} AS NVARCHAR(50)) LIKE @query
        OR CAST(${columnExpr(shape, 'HeaderMemoColumn', 'T0', 'Memo', "''")} AS NVARCHAR(254)) LIKE @query
        OR CAST(${columnExpr(shape, 'HeaderRef1Column', 'T0', 'Ref1', "''")} AS NVARCHAR(100)) LIKE @query
        OR CAST(${columnExpr(shape, 'HeaderRef2Column', 'T0', 'Ref2', "''")} AS NVARCHAR(100)) LIKE @query
        OR CAST(${columnExpr(shape, 'HeaderRef3Column', 'T0', 'Ref3', "''")} AS NVARCHAR(100)) LIKE @query`
    : '';

  const rows = await safeRows(`
    SELECT TOP 500
      T0.TransId,
      ${columnExpr(shape, 'HeaderNumberColumn', 'T0', 'Number', 'NULL')} AS Number,
      ${columnExpr(shape, 'HeaderSeriesColumn', 'T0', 'Series', 'NULL')} AS Series,
      ${columnExpr(shape, 'HeaderRefDateColumn', 'T0', 'RefDate', 'NULL')} AS RefDate,
      ${columnExpr(shape, 'HeaderDueDateColumn', 'T0', 'DueDate', 'NULL')} AS DueDate,
      ${columnExpr(shape, 'HeaderTaxDateColumn', 'T0', 'TaxDate', 'NULL')} AS TaxDate,
      ${columnExpr(shape, 'HeaderMemoColumn', 'T0', 'Memo', "''")} AS Memo,
      ${columnExpr(shape, 'HeaderRef1Column', 'T0', 'Ref1', "''")} AS Ref1,
      ${columnExpr(shape, 'HeaderRef2Column', 'T0', 'Ref2', "''")} AS Ref2,
      ${columnExpr(shape, 'HeaderRef3Column', 'T0', 'Ref3', "''")} AS Ref3,
      SUM(COALESCE(${columnExpr(shape, 'LineDebitColumn', 'T1', 'Debit', '0')}, 0)) AS TotalDebit,
      SUM(COALESCE(${columnExpr(shape, 'LineCreditColumn', 'T1', 'Credit', '0')}, 0)) AS TotalCredit
    FROM OJDT T0
    LEFT JOIN JDT1 T1 ON T1.TransId = T0.TransId
    ${where}
    GROUP BY
      T0.TransId,
      ${columnExpr(shape, 'HeaderNumberColumn', 'T0', 'Number', 'NULL')},
      ${columnExpr(shape, 'HeaderSeriesColumn', 'T0', 'Series', 'NULL')},
      ${columnExpr(shape, 'HeaderRefDateColumn', 'T0', 'RefDate', 'NULL')},
      ${columnExpr(shape, 'HeaderDueDateColumn', 'T0', 'DueDate', 'NULL')},
      ${columnExpr(shape, 'HeaderTaxDateColumn', 'T0', 'TaxDate', 'NULL')},
      ${columnExpr(shape, 'HeaderMemoColumn', 'T0', 'Memo', "''")},
      ${columnExpr(shape, 'HeaderRef1Column', 'T0', 'Ref1', "''")},
      ${columnExpr(shape, 'HeaderRef2Column', 'T0', 'Ref2', "''")},
      ${columnExpr(shape, 'HeaderRef3Column', 'T0', 'Ref3', "''")}
    ORDER BY T0.TransId DESC
  `, search ? { query: `%${search}%` } : {});

  return rows.map((row) => ({
    docEntry: row.TransId,
    transId: row.TransId,
    docNum: row.Number == null ? '' : String(row.Number),
    number: row.Number == null ? '' : String(row.Number),
    series: row.Series == null ? '' : String(row.Series),
    postingDate: formatDate(row.RefDate),
    dueDate: formatDate(row.DueDate || row.RefDate),
    documentDate: formatDate(row.TaxDate || row.RefDate),
    remarks: row.Memo || '',
    reference1: row.Ref1 || '',
    reference2: row.Ref2 || '',
    reference3: row.Ref3 || '',
    totalDebit: round2(row.TotalDebit),
    totalCredit: round2(row.TotalCredit),
  }));
};

module.exports = {
  previewJournalEntry,
  generateFromServiceARInvoice,
  generateFromServiceAPInvoice,
  generateFromServiceAPCreditMemo,
  generateFromServiceARCreditMemo,
  createManualJournalEntry,
  searchJournalEntries,
  getJournalEntryByTransId,
  getJournalEntryReferenceData,
  getJournalRemarkTemplates,
};
