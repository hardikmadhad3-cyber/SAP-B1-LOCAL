const db = require("../dbService");

const DOCUMENT_TYPES = {
  13: { label: "A/R Invoice", prefix: "IN" },
  14: { label: "A/R Credit Memo", prefix: "CN" },
  15: { label: "Delivery", prefix: "DN" },
  17: { label: "Sales Order", prefix: "SO" },
  18: { label: "A/P Invoice", prefix: "PU" },
  19: { label: "A/P Credit Memo", prefix: "PC" },
  20: { label: "Goods Receipt PO", prefix: "PD" },
  22: { label: "Purchase Order", prefix: "PO" },
  23: { label: "Sales Quotation", prefix: "SQ" },
  24: { label: "Incoming Payment", prefix: "RC" },
  30: { label: "Journal Entry", prefix: "JE" },
  46: { label: "Outgoing Payment", prefix: "PS" },
  59: { label: "Goods Receipt", prefix: "GR" },
  60: { label: "Goods Issue", prefix: "GI" },
  67: { label: "Inventory Transfer", prefix: "IM" },
  1250000001: { label: "Inventory Transfer Request", prefix: "TR" },
};

const REPORT_TITLES = {
  "transaction-journal": "Transaction Journal Report",
  "transaction-by-projects": "Transaction Report by Projects",
  "transactions-received-from-voucher": "Transactions Received from Voucher Report",
  "document-journal": "Document Journal",
  "journal-transaction-amount-range": "Locate Journal Transaction by Amount Range",
  "journal-transaction-fc-amount-range": "Locate Journal Transaction by FC Amount Range",
};

const normalizeText = (value) => String(value || "").trim();
const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const rowsOf = async (sql, params = {}) => {
  const result = await db.query(sql, params);
  return result.recordset || result || [];
};

const appendRange = (clauses, expression, from, to, params, prefix) => {
  if (normalizeText(from)) {
    params[`${prefix}From`] = normalizeText(from);
    clauses.push(`${expression} >= @${prefix}From`);
  }
  if (normalizeText(to)) {
    params[`${prefix}To`] = normalizeText(to);
    clauses.push(`${expression} <= @${prefix}To`);
  }
};

const appendDateRange = (clauses, expression, from, to, params, prefix) => {
  if (normalizeText(from)) {
    params[`${prefix}From`] = normalizeText(from);
    clauses.push(`CAST(${expression} AS DATE) >= CAST(@${prefix}From AS DATE)`);
  }
  if (normalizeText(to)) {
    params[`${prefix}To`] = normalizeText(to);
    clauses.push(`CAST(${expression} AS DATE) <= CAST(@${prefix}To AS DATE)`);
  }
};

const getVoucherColumn = async () => {
  const rows = await rowsOf(`
    SELECT TOP 1 COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'OJDT' AND COLUMN_NAME = 'BatchNum'
  `);
  return rows.length ? "H.BatchNum" : "H.TransId";
};

const getLookups = async () => {
  const [series, projects, accounts, voucherColumn] = await Promise.all([
    rowsOf(`
      SELECT DISTINCT CAST(S.Series AS INT) AS code, ISNULL(S.SeriesName, '') AS name
      FROM NNM1 S
      INNER JOIN OJDT H ON H.Series = S.Series
      ORDER BY name
    `),
    rowsOf(`
      SELECT ISNULL(P.PrjCode, '') AS code, ISNULL(P.PrjName, '') AS name
      FROM OPRJ P
      WHERE ISNULL(P.Active, 'Y') = 'Y'
      ORDER BY P.PrjCode
    `),
    rowsOf(`
      SELECT ISNULL(A.AcctCode, '') AS code, ISNULL(A.FormatCode, A.AcctCode) AS formatCode,
             ISNULL(A.AcctName, '') AS name
      FROM OACT A
      WHERE ISNULL(A.Postable, 'Y') = 'Y'
      ORDER BY A.AcctCode
    `),
    getVoucherColumn(),
  ]);
  const vouchers = await rowsOf(`
    SELECT TOP 500 CAST(${voucherColumn} AS INT) AS code, COUNT(*) AS recordCount
    FROM OJDT H
    WHERE ISNULL(${voucherColumn}, 0) <> 0
    GROUP BY ${voucherColumn}
    ORDER BY ${voucherColumn} DESC
  `);

  return { series, projects, accounts, vouchers };
};

const getReport = async (reportKey, criteria = {}) => {
  if (!REPORT_TITLES[reportKey]) {
    throw new Error("Unsupported accounting report.");
  }

  const params = {};
  const clauses = ["1 = 1"];
  appendDateRange(clauses, "H.RefDate", criteria.postingDateFrom, criteria.postingDateTo, params, "posting");
  appendDateRange(clauses, "L.DueDate", criteria.dueDateFrom, criteria.dueDateTo, params, "due");
  appendDateRange(clauses, "L.TaxDate", criteria.documentDateFrom, criteria.documentDateTo, params, "document");
  appendRange(clauses, "H.TransId", criteria.transactionFrom, criteria.transactionTo, params, "transaction");

  if (normalizeText(criteria.originalJournal) && criteria.originalJournal !== "all") {
    params.originalJournal = Number(criteria.originalJournal);
    clauses.push("H.TransType = @originalJournal");
  }
  if (normalizeText(criteria.projectFrom)) {
    params.projectFrom = normalizeText(criteria.projectFrom);
    clauses.push("ISNULL(L.Project, '') >= @projectFrom");
  }
  if (normalizeText(criteria.projectTo)) {
    params.projectTo = normalizeText(criteria.projectTo);
    clauses.push("ISNULL(L.Project, '') <= @projectTo");
  }
  appendRange(clauses, "L.Account", criteria.accountFrom, criteria.accountTo, params, "account");

  const selectedSeries = (Array.isArray(criteria.seriesCodes) ? criteria.seriesCodes : [])
    .map(Number)
    .filter(Number.isInteger);
  if (selectedSeries.length) {
    const placeholders = selectedSeries.map((value, index) => {
      params[`series${index}`] = value;
      return `@series${index}`;
    });
    clauses.push(`H.Series IN (${placeholders.join(", ")})`);
  }

  let voucherColumn = "H.TransId";
  if (reportKey === "transactions-received-from-voucher") {
    voucherColumn = await getVoucherColumn();
    params.voucherNumber = Number(criteria.voucherNumber || 0);
    clauses.push(`${voucherColumn} = @voucherNumber`);
  }

  // SAP "Locate Journal Transaction by (FC) Amount Range": rows whose debit or credit
  // amount lies in the range; the FC version looks only at foreign-currency rows.
  if (reportKey === "journal-transaction-amount-range" || reportKey === "journal-transaction-fc-amount-range") {
    const foreign = reportKey === "journal-transaction-fc-amount-range";
    const amount = foreign ? "(ISNULL(L.FCDebit, 0) + ISNULL(L.FCCredit, 0))" : "(ISNULL(L.Debit, 0) + ISNULL(L.Credit, 0))";
    if (foreign) clauses.push(`${amount} <> 0`);
    if (normalizeText(criteria.amountFrom)) {
      params.amountFrom = toNumber(criteria.amountFrom);
      clauses.push(`${amount} >= @amountFrom`);
    }
    if (normalizeText(criteria.amountTo)) {
      params.amountTo = toNumber(criteria.amountTo);
      clauses.push(`${amount} <= @amountTo`);
    }
  }

  const amountExpressions = criteria.displayCurrency === "system"
    ? { debit: "ISNULL(L.SYSDeb, 0)", credit: "ISNULL(L.SYSCred, 0)" }
    : criteria.displayCurrency === "foreign"
      ? { debit: "ISNULL(L.FCDebit, 0)", credit: "ISNULL(L.FCCredit, 0)" }
      : { debit: "ISNULL(L.Debit, 0)", credit: "ISNULL(L.Credit, 0)" };

  const rows = await rowsOf(`
    SELECT TOP 5000
      H.TransId, L.Line_ID AS LineId, H.RefDate AS PostingDate, L.DueDate, L.TaxDate AS DocumentDate,
      ISNULL(H.Series, 0) AS SeriesCode, ISNULL(S.SeriesName, '') AS SeriesName,
      ISNULL(H.Number, H.TransId) AS JournalNumber, ISNULL(H.TransType, 30) AS TransType,
      ISNULL(H.CreatedBy, 0) AS SourceDocEntry, ISNULL(H.BaseRef, '') AS BaseRef,
      ISNULL(H.Memo, '') AS HeaderRemarks, ISNULL(L.LineMemo, H.Memo) AS Remarks,
      ISNULL(L.Account, '') AS AccountCode, ISNULL(A.AcctName, '') AS AccountName,
      ISNULL(L.ShortName, '') AS EntityCode, COALESCE(BP.CardName, A.AcctName, '') AS EntityName,
      CASE WHEN BP.CardCode IS NOT NULL THEN 'bp' ELSE 'account' END AS EntityType,
      ISNULL(L.Project, '') AS ProjectCode, ISNULL(P.PrjName, '') AS ProjectName,
      CAST(${voucherColumn} AS INT) AS VoucherNumber,
      CAST(${amountExpressions.debit} AS DECIMAL(19, 2)) AS Debit,
      CAST(${amountExpressions.credit} AS DECIMAL(19, 2)) AS Credit
    FROM OJDT H
    INNER JOIN JDT1 L ON L.TransId = H.TransId
    LEFT JOIN NNM1 S ON S.Series = H.Series
    LEFT JOIN OACT A ON A.AcctCode = L.Account
    LEFT JOIN OCRD BP ON BP.CardCode = L.ShortName
    LEFT JOIN OPRJ P ON P.PrjCode = L.Project
    WHERE ${clauses.join("\n      AND ")}
    ORDER BY H.RefDate, H.TransId, L.Line_ID
  `, params);

  const mappedRows = rows.map((row, index) => {
    const transType = Number(row.TransType || 30);
    const documentType = DOCUMENT_TYPES[transType] || { label: `Transaction ${transType}`, prefix: "TR" };
    const documentNumber = normalizeText(row.BaseRef) || normalizeText(row.SourceDocEntry) || normalizeText(row.TransId);
    return {
      rowNo: index + 1,
      transId: Number(row.TransId || 0),
      lineId: Number(row.LineId || 0),
      postingDate: row.PostingDate,
      dueDate: row.DueDate,
      documentDate: row.DocumentDate,
      seriesCode: Number(row.SeriesCode || 0),
      series: row.SeriesName || "",
      journalNumber: Number(row.JournalNumber || 0),
      transType,
      documentType: documentType.label,
      documentPrefix: documentType.prefix,
      sourceDocEntry: transType === 30 ? 0 : Number(row.SourceDocEntry || 0),
      documentNumber,
      remarks: row.Remarks || "",
      headerRemarks: row.HeaderRemarks || "",
      accountCode: row.AccountCode || "",
      accountName: row.AccountName || "",
      entityCode: row.EntityCode || "",
      entityName: row.EntityName || "",
      entityType: row.EntityType || "account",
      projectCode: row.ProjectCode || "",
      projectName: row.ProjectName || "",
      voucherNumber: Number(row.VoucherNumber || 0),
      debit: toNumber(row.Debit),
      credit: toNumber(row.Credit),
    };
  });

  return {
    reportKey,
    reportTitle: REPORT_TITLES[reportKey],
    generatedAt: new Date().toISOString(),
    displayCurrency: criteria.displayCurrency || "local",
    rows: mappedRows,
    totals: {
      rowCount: mappedRows.length,
      debit: mappedRows.reduce((sum, row) => sum + row.debit, 0),
      credit: mappedRows.reduce((sum, row) => sum + row.credit, 0),
    },
  };
};

module.exports = { getLookups, getReport, REPORT_TITLES };
