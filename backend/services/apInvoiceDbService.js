const { getMarketingDocumentSeries: getSharedDocumentSeries, withSeriesContext } = require('./documentSeriesDbUtils');
const db = require('./dbService');
const { createPhysicalColumnSetReader, selectPhysicalOptionalColumn } = require('./salesDocumentDbCompatibility');
const { getDocumentUnitPriceSql } = require('./documentUnitPriceDbUtils');
const { getDocumentUomSql, loadCompanyUomGroups } = require('./documentUomDbUtils');
const { loadBusinessPartnerAddresses } = require('./businessPartnerAddressDbUtils');
const masterDataDbService = require('./masterDataDbService');
const { buildMarketingDocumentListFilterQuery } = require('./documentListUtils');
const { getHeaderUdfValues, getLineUdfValues, getMarketingDocumentUdfs } = require('./udfMetadataService');
const { getPlaceOfSupplyUdfValue } = require('./placeOfSupplyUtils');
const { selectSapEligibleSeries } = require('./documentSeriesDbUtils');

const safe = async (promise) => {
  try {
    const r = await promise;
    return r.recordset || [];
  } catch (e) {
    return [];
  }
};

const getTableColumns = createPhysicalColumnSetReader(db);

const optionalColumn = (columns, tableAlias, columnName, alias, fallback = 'NULL') => (
  selectPhysicalOptionalColumn(columns, tableAlias, columnName, alias, fallback)
);

const parseSeriesDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value || '').trim();
  if (!text) return new Date();

  const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

  const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const normalizeSeriesText = (value) =>
  String(value || '').toUpperCase().replace(/FY/g, '').replace(/[^A-Z0-9]/g, '');

const resolveTransactionSeriesKind = (transactionType = '') => {
  const normalizedType = normalizeSeriesText(transactionType);
  if (normalizedType.includes('DEBIT')) return 'debit';
  if (normalizedType.includes('BILLOFSUPPLY') || normalizedType.includes('SUPPLY')) return 'bill';
  if (normalizedType.includes('TAXINVOICE') || normalizedType.includes('GST')) return 'tax';
  return '';
};

const getSeriesKind = (series = {}) => {
  const text = normalizeSeriesText([
    series.SeriesName,
    series.DisplayName,
    series.RawSeriesName,
    series.BeginStr,
    series.Indicator,
    series.DocSubType,
  ].filter(Boolean).join(' '));
  const docSubType = String(series.DocSubType || '').trim().toUpperCase();

  if (docSubType === 'GD' || text.includes('DEBIT') || text.includes('DBN') || text.includes('CAN')) return 'debit';
  if (docSubType === '--' || text.includes('BILLOFSUPPLY') || text.includes('SUPPLY') || text.includes('BOS') || text.includes('BILL')) return 'bill';
  if (docSubType === 'GA' || text.includes('TAXINVOICE') || text.includes('GST')) return 'tax';
  if (text.includes('AP') && !text.includes('CAN')) return 'bill';
  return 'tax';
};

const filterSeriesByTransactionType = (series = [], transactionType = '') => {
  const targetKind = resolveTransactionSeriesKind(transactionType);
  if (!targetKind) return series;

  const matched = (Array.isArray(series) ? series : []).filter((row) => {
    if (Number(row.Series) === -1 || String(row.SeriesName || '').trim().toUpperCase() === 'MANUAL') return false;
    return getSeriesKind(row) === targetKind;
  });

  return matched.length ? matched : series;
};

const scoreSeriesForTransactionType = (series = {}, transactionType = '') => {
  const targetKind = resolveTransactionSeriesKind(transactionType);
  if (!targetKind) return 0;

  const text = normalizeSeriesText([
    series.SeriesName,
    series.DisplayName,
    series.RawSeriesName,
    series.BeginStr,
    series.Indicator,
    series.DocSubType,
  ].filter(Boolean).join(' '));
  const docSubType = String(series.DocSubType || '').trim().toUpperCase();
  const isManual = Number(series.Series) === -1 || String(series.SeriesName || '').trim().toUpperCase() === 'MANUAL';
  if (isManual) return -10000;

  let score = 0;
  if (series.IsDefault || series.isDefault) score += 25;

  if (targetKind === 'debit') {
    if (docSubType === 'GD') score += 250;
    if (text.includes('CAN')) score += 180;
    if (text.includes('DEBIT') || text.includes('DBN')) score += 160;
    if (text.includes('AP')) score -= 40;
    if (docSubType === 'GA' || text.includes('TAX')) score -= 80;
  } else if (targetKind === 'bill') {
    if (docSubType === '--') score += 120;
    if (text.includes('BILLOFSUPPLY') || text.includes('SUPPLY') || text.includes('BOS') || text.includes('BILL')) score += 180;
    if (text.includes('AP')) score += 140;
    if (text.includes('CAN') || text.includes('DEBIT') || docSubType === 'GD') score -= 120;
    if (docSubType === 'GA' || text.includes('TAX')) score -= 60;
  } else if (targetKind === 'tax') {
    if (docSubType === 'GA') score += 180;
    if (text.includes('GST') || text.includes('TAXINVOICE') || text.includes('TAX')) score += 160;
    if (!text.includes('AP') && !text.includes('CAN') && !text.includes('DEBIT') && !text.includes('BILL')) score += 120;
    if (text.includes('AP')) score -= 100;
    if (text.includes('CAN') || text.includes('DEBIT') || docSubType === 'GD') score -= 160;
  }

  return score;
};

const pickSapSeriesForTransactionType = (series = [], transactionType = '') => {
  const rows = Array.isArray(series) ? series.filter(Boolean) : [];
  if (!String(transactionType || '').trim()) return null;

  const nonManualRows = rows.filter((row) => (
    Number(row.Series) !== -1 &&
    String(row.SeriesName || '').trim().toUpperCase() !== 'MANUAL'
  ));
  const candidates = nonManualRows.length ? nonManualRows : rows;
  if (!candidates.length) return null;

  const scored = candidates
    .map((row, index) => ({ row, index, score: scoreSeriesForTransactionType(row, transactionType) }))
    .sort((left, right) =>
      right.score - left.score ||
      Number(right.row.IsDefault || right.row.isDefault || 0) - Number(left.row.IsDefault || left.row.isDefault || 0) ||
      left.index - right.index);

  return scored[0]?.row || null;
};

const keepSapVisibleNumberingSeries = (series = []) => {
  return selectSapEligibleSeries(series);
};

const dedupeNumberingSeries = (series = []) => {
  const seen = new Set();
  return (Array.isArray(series) ? series : []).filter((row) => {
    const name = normalizeSeriesText(row.SeriesName || row.DisplayName || row.RawSeriesName || row.BeginStr || row.Series);
    const indicator = normalizeSeriesText(row.Indicator);
    const docSubType = String(row.DocSubType || '').trim().toUpperCase();
    const key = `${name}|${indicator}|${docSubType}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getFinancialYearTokens = (docDate) => {
  const year = docDate.getFullYear();
  const fyStartYear = docDate.getMonth() + 1 >= 4 ? year : year - 1;
  const fyEndYear = fyStartYear + 1;
  const fyStartShort = String(fyStartYear).slice(-2);
  const fyEndShort = String(fyEndYear).slice(-2);
  return [
    `${fyStartShort}${fyEndShort}`,
    `${fyStartYear}${fyEndShort}`,
    `${fyStartYear}${fyEndYear}`,
  ];
};

const isDateBetween = (date, fromDate, toDate) => {
  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const to = toDate instanceof Date ? toDate : new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  return date >= from && date <= to;
};

const getMarketingDocumentSeries = async ({ objectCode, date, branch, docSubType, transactionType } = {}) => withSeriesContext(await getSharedDocumentSeries({ db, objectCode, targetDate: date, branch, docSubType, transactionType }));

const getVendors = () => safe(db.query(`
  SELECT CardCode, CardName, CardType, Currency, Balance,
         VatGroup, GroupNum AS PayTermsGrpCode
  FROM   OCRD
  WHERE  CardType = 'S'
    AND  frozenFor <> 'Y'
  ORDER  BY CardName
`));

const getItems = () => safe(db.query(`
  SELECT T0.ItemCode, T0.ItemName,
         T0.BuyUnitMsr  AS PurchaseUnit,
         T0.InvntryUom  AS InventoryUOM,
         T0.UgpEntry    AS UoMGroupEntry,
         T0.PUoMEntry   AS PurchaseUomEntry,
         PU.UomCode     AS PurchaseUomCode,
         PU.UomName     AS PurchaseUomName,
         T0.DfltWH      AS DefaultWarehouse,
         CAST(COALESCE(NULLIF(T0.LastPurPrc, 0), NULLIF(T0.AvgPrice, 0), 0) AS DECIMAL(19,6)) AS UnitPrice,
         CHP.ChapterID  AS HSNCode,
         T0.ManBtchNum  AS BatchManaged,
         T0.ManSerNum   AS SerialManaged
  FROM   OITM T0
  LEFT JOIN OUOM PU ON PU.UomEntry = T0.PUoMEntry
  LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
  WHERE  T0.PrchseItem = 'Y'
    AND  T0.validFor  <> 'N'
  ORDER  BY T0.ItemCode
`));

const getItemsForModal = () => safe(db.query(`
  SELECT
    T0.ItemCode,
    T0.ItemName,
    T0.FrgnName        AS ForeignName,
    T1.ItmsGrpNam      AS ItemGroup,
    CAST(T0.OnHand AS DECIMAL(19,2)) AS InStock,
    T0.BuyUnitMsr      AS PurchaseUnit,
    T0.InvntryUom      AS InventoryUOM,
    T0.UgpEntry        AS UoMGroupEntry,
    T0.PUoMEntry       AS PurchaseUomEntry,
    PU.UomCode         AS PurchaseUomCode,
    PU.UomName         AS PurchaseUomName,
    T0.DfltWH          AS DefaultWarehouse,
    CAST(COALESCE(NULLIF(T0.LastPurPrc, 0), NULLIF(T0.AvgPrice, 0), 0) AS DECIMAL(19,6)) AS UnitPrice,
    CHP.ChapterID      AS HSNCode,
    T0.ManBtchNum      AS BatchManaged,
    T0.ManSerNum       AS SerialManaged
  FROM OITM T0
  LEFT JOIN OITB T1  ON T1.ItmsGrpCod = T0.ItmsGrpCod
  LEFT JOIN OUOM PU  ON PU.UomEntry = T0.PUoMEntry
  LEFT JOIN OCHP CHP ON CHP.AbsEntry  = T0.ChapterID
  WHERE T0.PrchseItem = 'Y'
    AND T0.validFor  <> 'N'
  ORDER BY T0.ItemCode
`));

const getWarehouses = () => safe(db.query(`
  SELECT WhsCode, WhsName, Street, Block,
         City, County, State, ZipCode, Country, BPLid AS BranchID
  FROM   OWHS
  WHERE  Inactive <> 'Y'
  ORDER  BY WhsCode
`));

const getPaymentTerms = () => safe(db.query(`
  SELECT GroupNum, PymntGroup
  FROM   OCTG
  ORDER  BY PymntGroup
`));

const getSalesEmployees = () => safe(db.query(`
  SELECT SlpCode, SlpName, Memo, Commission, Active
  FROM   OSLP
  ORDER  BY
    CASE WHEN SlpCode = -1 THEN 0 ELSE 1 END,
    SlpName
`));

const getShippingTypes = () => safe(db.query(`
  SELECT TrnspCode, TrnspName
  FROM   OSHP
  ORDER  BY TrnspName
`));

const getBranches = () => safe(db.query(`
  SELECT BPLId, BPLName, State
  FROM   OBPL where Disabled='N' 
  ORDER  BY BPLName
`));

const getStates = () => safe(db.query(`
  SELECT Code, Name
  FROM   OCST
  WHERE  Country = 'IN'
  ORDER  BY Name
`));

const getTaxCodes = () => masterDataDbService.searchDocumentTaxCodes('', 'purchase', 500, 0);

const getWithholdingTaxCodes = () => masterDataDbService.lookupWithholdingTaxCodes('');
const getGLAccounts = () => masterDataDbService.lookupGLAccounts('', 5000);

const getUomGroups = () => loadCompanyUomGroups(db);

const getDecimalSettings = () => safe(db.query(`
  SELECT TOP 1
    PriceDec,
    QtyDec,
    RateDec,
    PercentDec,
    SumDec
  FROM OADM
`));

const getCompanyInfo = () => safe(db.query(`
  SELECT TOP 1
    CompnyName,
    CompnyAddr AS Address,
    State,
    MainCurncy,
    SysCurrncy
  FROM OADM
`));

const getContactsByVendor = async (cardCode) => safe(db.query(`
  SELECT 
    T0.CardCode,
    T0.CntctCode,
    T0.Name,
    T0.FirstName,
    T0.LastName,
    T0.E_MailL AS E_Mail,
    T0.Cellolar AS MobilePhone,
    T0.Tel1 AS Phone1
  FROM OCPR T0
  WHERE T0.CardCode = @cardCode
  ORDER BY T0.Name
`, { cardCode }));

const getAddressesByVendor = async (cardCode) => {
  const { addresses } = await loadBusinessPartnerAddresses(db, cardCode, { context: 'AP Invoice' });
  return addresses;
};

const getVendorGSTProfile = async (cardCode) => {
  const rows = await safe(db.query(`
    SELECT TOP 1
      T1.GSTRegnNo AS GSTIN,
      T1.State
    FROM OCRD T0
    JOIN CRD1 T1 ON T0.CardCode = T1.CardCode
    WHERE T0.CardCode = @cardCode
    ORDER BY CASE WHEN T1.AdresType = 'B' THEN 0 ELSE 1 END, T1.Address
  `, { cardCode }));

  return rows[0] || { GSTIN: '', State: '' };
};

const getVendorWithholdingTaxDetails = async (vendorCode) => {
  const [ocrdRows, allowedRows, allCodes] = await Promise.all([
    safe(db.query(`
      SELECT TOP 1
        T0.CardCode,
        T0.WTCode
      FROM OCRD T0
      WHERE T0.CardCode = @vendorCode
    `, { vendorCode })),
    safe(db.query(`
      SELECT DISTINCT
        T0.WTCode
      FROM CRD4 T0
      WHERE T0.CardCode = @vendorCode
        AND ISNULL(T0.WTCode, '') <> ''
      ORDER BY T0.WTCode
    `, { vendorCode })),
    getWithholdingTaxCodes(),
  ]);

  const defaultCode = String(ocrdRows[0]?.WTCode || '').trim();
  const allowedCodeSet = new Set(
    [
      ...allowedRows.map((row) => String(row.WTCode || '').trim()),
      defaultCode,
    ].filter(Boolean)
  );
  const allowedCodes = allCodes.filter((row) => allowedCodeSet.has(String(row.code || '').trim()));
  const fallbackAllowedCodes = allowedCodeSet.size
    ? Array.from(allowedCodeSet).map((code) => ({ code, name: code, rate: 0, taxCategory: '' }))
    : [];

  return {
    subject: allowedCodeSet.size > 0,
    defaultCode,
    allowedCodes: allowedCodes.length ? allowedCodes : fallbackAllowedCodes,
  };
};

const getOpenGRPO = async (vendorCode = null) => {
  const query = vendorCode
    ? `
      SELECT TOP 100
        T0.DocEntry,
        T0.DocNum,
        T0.CardCode,
        T0.CardName,
        T0.DocDate,
        T0.DocDueDate,
        T0.DocTotal
      FROM OPDN T0
      WHERE T0.DocStatus = 'O'
        AND T0.CANCELED <> 'Y'
        AND EXISTS (
          SELECT 1
          FROM PDN1 T1
          WHERE T1.DocEntry = T0.DocEntry
            AND T1.LineStatus = 'O'
            AND ISNULL(T1.OpenQty, 0) > 0
        )
        AND T0.CardCode = @vendorCode
      ORDER BY T0.DocEntry DESC
    `
    : `
      SELECT TOP 100
        T0.DocEntry,
        T0.DocNum,
        T0.CardCode,
        T0.CardName,
        T0.DocDate,
        T0.DocDueDate,
        T0.DocTotal
      FROM OPDN T0
      WHERE T0.DocStatus = 'O'
        AND T0.CANCELED <> 'Y'
        AND EXISTS (
          SELECT 1
          FROM PDN1 T1
          WHERE T1.DocEntry = T0.DocEntry
            AND T1.LineStatus = 'O'
            AND ISNULL(T1.OpenQty, 0) > 0
        )
      ORDER BY T0.DocEntry DESC
    `;

  const result = await safe(vendorCode ? db.query(query, { vendorCode }) : db.query(query));
  return { orders: result };
};

// SAP B1 allows an A/P Invoice to be drawn from an open Goods Receipt PO or
// straight from an open Purchase Order. Both behave identically here apart from
// their tables, their wording, and whether stock is received by the invoice.
const AP_INVOICE_BASE_DOCUMENTS = Object.freeze({
  20: Object.freeze({
    baseType: 20,
    label: 'Goods Receipt PO',
    headerTable: 'OPDN',
    lineTable: 'PDN1',
    // The goods are already in stock, so the invoice must not re-allocate them.
    allowsBatchAllocation: false,
  }),
  22: Object.freeze({
    baseType: 22,
    label: 'Purchase Order',
    headerTable: 'OPOR',
    lineTable: 'POR1',
    // Invoicing a Purchase Order directly is what receives the stock, so a
    // batch-managed item still needs its allocation on the invoice.
    allowsBatchAllocation: true,
  }),
});

const resolveApInvoiceBaseDocument = (baseType) => (
  AP_INVOICE_BASE_DOCUMENTS[Number(baseType)] || null
);

const getBaseDocumentTargetInvoices = async (baseType, docEntry, lineNum = null) => {
  const baseDocument = resolveApInvoiceBaseDocument(baseType);
  if (!baseDocument) return [];
  const params = { docEntry, baseType: baseDocument.baseType };
  const lineFilter = lineNum == null ? '' : 'AND T1.BaseLine = @lineNum';
  if (lineNum != null) params.lineNum = lineNum;

  return safe(db.query(`
    SELECT TOP 10
      T0.DocEntry,
      T0.DocNum,
      T0.Series,
      NNM.SeriesName,
      NNM.Indicator,
      T1.BaseLine
    FROM PCH1 T1
    INNER JOIN OPCH T0 ON T0.DocEntry = T1.DocEntry
    LEFT JOIN NNM1 NNM ON NNM.Series = T0.Series AND NNM.ObjectCode = '18'
    WHERE T1.BaseType = @baseType
      AND T1.BaseEntry = @docEntry
      ${lineFilter}
      AND T0.CANCELED <> 'Y'
    ORDER BY T0.DocEntry DESC
  `, params));
};

const getGRPOTargetInvoices = (docEntry, lineNum = null) => (
  getBaseDocumentTargetInvoices(20, docEntry, lineNum)
);

const formatTargetInvoiceReference = (target) => {
  if (!target) return '';
  const invoiceNumber = target.DocNum || target.DocEntry;
  const seriesName = String(target.SeriesName || target.Series || '').trim();
  return `A/P Invoice ${invoiceNumber}${seriesName ? ` (series ${seriesName})` : ''}`;
};

const getBaseDocumentForCopy = async (docEntry, baseTypeValue = 20) => {
  const baseDocument = resolveApInvoiceBaseDocument(baseTypeValue);
  if (!baseDocument) {
    throw createBaseDocumentError(
      'INVALID_BASE_DOCUMENT_TYPE',
      `A/P Invoice cannot be copied from document type ${baseTypeValue}.`,
      { baseType: baseTypeValue, docEntry },
    );
  }
  const { headerTable, lineTable, label, baseType } = baseDocument;
  const headerRows = await safe(db.query(`
    SELECT 
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.CntctCode AS ContactPersonCode,
      T0.NumAtCard AS VendorRefNo,
      T0.DocDate AS PostingDate,
      T0.DocDueDate AS DeliveryDate,
      T0.TaxDate AS DocumentDate,
      ${selectPhysicalOptionalColumn(await getTableColumns(headerTable), 'T0', 'BPLId', 'Branch')},
      T0.DocCur AS Currency,
      T0.DocRate AS ExchangeRate,
      T0.GroupNum AS PaymentTerms,
      T0.SlpCode AS SalesEmployeeCode,
      T1.SlpName AS SalesEmployeeName,
      T0.Comments AS Remarks,
      T0.JrnlMemo AS JournalRemark,
      T0.DiscPrcnt AS DiscountPercent,
      T0.RoundDif AS RoundingAmount,
      T0.TotalExpns AS Freight,
      T0.VatSum AS Tax,
      T0.DocTotal AS TotalPaymentDue
    FROM ${headerTable} T0
    LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`${label} ${docEntry} not found`);
  }

  const header = headerRows[0];
  const lineUdfsByLineNum = await getLineUdfValues({ tableId: lineTable, keyValue: docEntry });

  const lineColumns = await getTableColumns(lineTable);
  const documentUom = await getDocumentUomSql(db, lineTable);
  const lineRows = await safe(db.query(`
    SELECT 
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      T0.OpenQty,
      ${await getDocumentUnitPriceSql(db, lineTable, 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TaxCode,
      'N' AS WTLiable,
      T0.LineTotal,
      T0.WhsCode AS Warehouse,
      ${optionalColumn(lineColumns, 'T0', 'AcctCode', 'GLAccount', "''")},
      ${documentUom.entrySql} AS UoMEntry,
      ${documentUom.codeSql} AS UoMCode,
      ${documentUom.nameSql} AS UoMName,
      ${optionalColumn(lineColumns, 'T0', 'StockPrice', 'ItemCost', '0')},
      ${optionalColumn(lineColumns, 'T0', 'OcrCode', 'DistributionRule', "''")},
      ${optionalColumn(lineColumns, 'T0', 'CountryOrg', 'CountryOfOrigin', "''")},
      ${optionalColumn(lineColumns, 'T0', 'LocCode', 'LocationCode', "''")},
      ${optionalColumn(lineColumns, 'T0', 'AgrNo', 'BlanketAgreementNo', "''")}
    FROM ${lineTable} T0
    ${documentUom.joinSql}
    WHERE T0.DocEntry = @docEntry
      AND T0.LineStatus = 'O'
      AND T0.OpenQty > 0
    ORDER BY T0.LineNum
  `, { docEntry }));

  if (!lineRows.length) {
    const targetInvoices = await getBaseDocumentTargetInvoices(baseType, docEntry);
    const targetReference = formatTargetInvoiceReference(targetInvoices[0]);
    throw createBaseDocumentError(
      'BASE_DOCUMENT_ALREADY_INVOICED',
      targetReference
        ? `This ${label} has no open quantity left. It was already copied to ${targetReference}.`
        : `This ${label} is closed or has no open quantity left to copy to an A/P Invoice.`,
      { docEntry, baseType, targetInvoices },
    );
  }

  const itemCodes = lineRows.map((l) => l.ItemCode).filter(Boolean);
  let itemInfoMap = {};

  if (itemCodes.length > 0) {
    const params = itemCodes.reduce((acc, code, i) => ({ ...acc, [`item${i}`]: code }), {});
    const itemRows = await safe(db.query(`
      SELECT T0.ItemCode,
             CHP.ChapterID AS HSNCode,
             T0.ManBtchNum AS BatchManaged,
             T0.WTLiable AS ItemWTLiable
      FROM OITM T0
      LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
      WHERE T0.ItemCode IN (${itemCodes.map((_, i) => `@item${i}`).join(',')})
    `, params));

    itemInfoMap = itemRows.reduce((acc, row) => {
      acc[row.ItemCode] = {
        hsnCode: row.HSNCode || '',
        batchManaged: row.BatchManaged === 'Y',
        wtaxLiable: String(row.ItemWTLiable || '').toUpperCase() === 'Y',
      };
      return acc;
    }, {});
  }

  return {
    header: {
      vendor: header.CardCode,
      name: header.CardName,
      contactPerson: header.ContactPersonCode ? String(header.ContactPersonCode) : '',
      salesContractNo: header.VendorRefNo || '',
      branch: header.Branch ? String(header.Branch) : '',
      paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
      otherInstruction: header.Remarks || '',
      rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
      roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
    },
    lines: lineRows.map((l) => {
      const itemInfo = itemInfoMap[l.ItemCode] || { hsnCode: '', batchManaged: false, wtaxLiable: false };
      return {
        baseEntry: docEntry,
        baseType,
        baseLine: l.LineNum,
        itemNo: l.ItemCode || '',
        itemDescription: l.ItemDescription || '',
        hsnCode: itemInfo.hsnCode,
        quantity: l.OpenQty != null ? String(l.OpenQty) : '',
        openQty: l.OpenQty != null ? String(l.OpenQty) : '',
        unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
        stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
        taxCode: l.TaxCode || '',
        wtaxLiable: itemInfo.wtaxLiable ? 'Y' : 'N',
        total: l.LineTotal != null ? String(l.LineTotal) : '',
        whse: l.Warehouse || '',
        glAccount: l.GLAccount || '',
        uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
        uomCode: l.UoMCode || '',
        uomName: l.UoMName || l.UoMCode || '',
        itemCost: l.ItemCost != null ? String(l.ItemCost) : '',
        distRule: l.DistributionRule || '',
        countryOfOrigin: l.CountryOfOrigin || '',
        loc: l.LocationCode != null ? String(l.LocationCode) : '',
        blanketAgreementNo: l.BlanketAgreementNo ? String(l.BlanketAgreementNo) : '',
        batchManaged: itemInfo.batchManaged,
        batches: [],
        udf: lineUdfsByLineNum[l.LineNum] || {},
      };
    }),
  };
};

const getGRPOForCopy = (docEntry) => getBaseDocumentForCopy(docEntry, 20);

const getAPInvoiceList = async ({
  query = '',
  openOnly = false,
  docNum = '',
  vendorCode = '',
  vendorName = '',
  status = '',
  postingDateFrom = '',
  postingDateTo = '',
  page = 1,
  pageSize = 25,
} = {}) => {
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedPageSize = Math.min(200, Math.max(1, Number(pageSize) || 25));
  const skip = (normalizedPage - 1) * normalizedPageSize;
  const { whereClauses, params } = buildMarketingDocumentListFilterQuery({
    query,
    openOnly,
    docNum,
    partnerCode: vendorCode,
    partnerName: vendorName,
    status,
    postingDateFrom,
    postingDateTo,
  }, {
    additionalQueryClauses: [
      'T0.NumAtCard LIKE @query',
      `EXISTS (
        SELECT 1
        FROM PCH1 Q1
        WHERE Q1.DocEntry = T0.DocEntry
          AND (Q1.ItemCode LIKE @query OR Q1.Dscription LIKE @query)
      )`,
    ],
  });
  whereClauses.push("ISNULL(T0.DocType, 'I') = 'I'");

  const countRows = await safe(db.query(`
    SELECT COUNT(*) AS total_count
    FROM OPCH T0
    WHERE ${whereClauses.join('\n      AND ')}
  `, params));

  const totalCount = Number(countRows?.[0]?.total_count || 0);

  const result = await safe(db.query(`
    SELECT
      T0.DocEntry AS doc_entry,
      T0.DocNum AS doc_num,
      T0.CardCode AS vendor_code,
      T0.CardName AS vendor_name,
      T0.DocDate AS posting_date,
      T0.DocDueDate AS delivery_date,
      T0.DocTotal AS total_amount,
      T0.DocCur AS currency,
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS status,
      (
        SELECT COUNT(*)
        FROM PCH1 T1
        WHERE T1.DocEntry = T0.DocEntry
      ) AS line_count
    FROM OPCH T0
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    apInvoices: result.map((row) => ({
      doc_entry: row.doc_entry,
      doc_num: row.doc_num,
      vendor_code: row.vendor_code,
      vendor_name: row.vendor_name,
      posting_date: row.posting_date ? row.posting_date.toISOString().split('T')[0] : '',
      delivery_date: row.delivery_date ? row.delivery_date.toISOString().split('T')[0] : '',
      total_amount: Number(row.total_amount || 0),
      currency: row.currency || '',
      status: row.status || '',
      line_count: Number(row.line_count || 0),
    })),
    pagination: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / normalizedPageSize)),
    },
  };
};

const getAPInvoice = async (docEntry) => {
  const headerColumns = await getTableColumns('OPCH');
  const headerRows = await safe(db.query(`
    SELECT 
      T0.DocEntry,
      T0.DocNum,
      T0.Series,
      NNM.SeriesName,
      NNM.Indicator AS SeriesIndicator,
      T0.CardCode,
      T0.CardName,
      T0.CntctCode AS ContactPersonCode,
      T0.SlpCode AS SalesEmployeeCode,
      T1.SlpName AS SalesEmployeeName,
      T0.NumAtCard AS VendorRefNo,
      T0.DocDate AS PostingDate,
      T0.DocDueDate AS DeliveryDate,
      T0.TaxDate AS DocumentDate,
      ${selectPhysicalOptionalColumn(headerColumns, 'T0', 'BPLId', 'Branch')},
      T0.DocCur AS Currency,
      T0.DocRate AS ExchangeRate,
      T0.GroupNum AS PaymentTerms,
      T0.Comments AS Remarks,
      T0.JrnlMemo AS JournalRemark,
      T0.DiscPrcnt AS DiscountPercent,
      T0.RoundDif AS RoundingAmount,
      T0.TotalExpns AS Freight,
      T0.VatSum AS Tax,
      T0.WTSum AS WTaxAmount,
      T0.DocTotal AS TotalPaymentDue,
      ${optionalColumn(headerColumns, 'T0', 'ShipToCode', 'ShipToCode', "''")},
      ${optionalColumn(headerColumns, 'T0', 'PayToCode', 'PayToCode', "''")},
      ${optionalColumn(headerColumns, 'T0', 'Address', 'BillToAddress', "''")},
      ${optionalColumn(headerColumns, 'T0', 'Address2', 'PayToAddress', "''")},
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS DocumentStatus
    FROM OPCH T0
    LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode
    LEFT JOIN NNM1 NNM ON NNM.Series = T0.Series AND NNM.ObjectCode = '18'
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`A/P Invoice ${docEntry} not found`);
  }

  const header = headerRows[0];
  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OPCH', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'PCH1', keyValue: docEntry }),
  ]);

  const [lineColumns, withholdingColumns] = await Promise.all([
    getTableColumns('PCH1'),
    getTableColumns('PCH5'),
  ]);
  const documentUom = await getDocumentUomSql(db, 'PCH1');
  const lineResult = await db.query(`
    SELECT 
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      ${await getDocumentUnitPriceSql(db, 'PCH1', 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TaxCode,
      ${optionalColumn(lineColumns, 'T0', 'WTLiable', 'WTLiable', "'N'")},
      T0.LineTotal,
      T0.WhsCode AS Warehouse,
      ${optionalColumn(lineColumns, 'T0', 'AcctCode', 'GLAccount', "''")},
      ${documentUom.entrySql} AS UoMEntry,
      ${documentUom.codeSql} AS UoMCode,
      ${documentUom.nameSql} AS UoMName,
      ${optionalColumn(lineColumns, 'T0', 'StockPrice', 'ItemCost', '0')},
      ${optionalColumn(lineColumns, 'T0', 'OcrCode', 'DistributionRule', "''")},
      ${optionalColumn(lineColumns, 'T0', 'CountryOrg', 'CountryOfOrigin', "''")},
      ${optionalColumn(lineColumns, 'T0', 'LocCode', 'LocationCode', "''")},
      ${optionalColumn(lineColumns, 'T0', 'AgrNo', 'BlanketAgreementNo', "''")},
      T0.BaseEntry,
      T0.BaseType,
      T0.BaseLine
    FROM PCH1 T0
    ${documentUom.joinSql}
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `, { docEntry });
  const lineRows = lineResult.recordset || [];
  if (!lineRows.length) {
    throw new Error(`A/P Invoice ${docEntry} exists but its content lines could not be loaded.`);
  }

  const withholdingRows = await safe(db.query(`
    SELECT
      T0.LineNum,
      T0.WTCode,
      ISNULL(T1.WTName, '') AS WTName,
      T0.Rate,
      T0.TaxbleAmnt AS TaxableAmount,
      T0.WTAmnt AS WTAmount,
      T0.Category,
      ${optionalColumn(withholdingColumns, 'T0', 'BaseType', 'BaseType', "'N'")},
      ${optionalColumn(withholdingColumns, 'T0', 'Criteria', 'Criteria', "'C'")},
      ${optionalColumn(withholdingColumns, 'T0', 'Doc1LineNo', 'DocumentLineNumber', '-1')},
      ${optionalColumn(withholdingColumns, 'T0', 'TdsAcc', 'TdsAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'SurAcc', 'SurchargeAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'CessAcc', 'CessAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'HscAcc', 'HscAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'TDSType', 'TDSType', "'E'")},
      ${optionalColumn(withholdingColumns, 'T0', 'IgstAcc', 'IGSTAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'CgstAcc', 'CGSTAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'SgstAcc', 'SGSTAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'UtgstAcc', 'UTGSTAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'CsgstAcc', 'CessGSTAccount', "''")},
      ${optionalColumn(withholdingColumns, 'T0', 'TdsRate', 'TDSRate', 'T0.Rate')},
      ${optionalColumn(withholdingColumns, 'T0', 'SurRate', 'SurchargeRate', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CessRate', 'CessRate', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'HscRate', 'HSCRate', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'IgstRate', 'IGSTRate', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CgstRate', 'CGSTRate', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'SgstRate', 'SGSTRate', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'UtgstRate', 'UTGSTRate', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CsgstRate', 'CessGSTRate', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'TdsBAmt', 'TDSBaseAmount', 'T0.TaxbleAmnt')},
      ${optionalColumn(withholdingColumns, 'T0', 'SurBAmt', 'SurchargeBaseAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CessBAmt', 'CessBaseAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'HscBAmt', 'HSCBaseAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'IgstBAmt', 'IGSTBaseAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CgstBAmt', 'CGSTBaseAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'SgstBAmt', 'SGSTBaseAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'UtgstBAmt', 'UTGSTBaseAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CsgstBAmt', 'CessGSTBaseAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'TdsAmnt', 'TDSTaxAmount', 'T0.WTAmnt')},
      ${optionalColumn(withholdingColumns, 'T0', 'SurAmnt', 'SurchargeTaxAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CessAmnt', 'CessTaxAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'HscAmnt', 'HSCTaxAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'IgstAmnt', 'IGSTTaxAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CgstAmnt', 'CGSTTaxAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'SgstAmnt', 'SGSTTaxAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'UtgstAmt', 'UTGSTTaxAmount', '0')},
      ${optionalColumn(withholdingColumns, 'T0', 'CsgstAmt', 'CessGSTTaxAmount', '0')}
    FROM PCH5 T0
    LEFT JOIN OWHT T1 ON T1.WTCode = T0.WTCode
    WHERE T0.AbsEntry = @docEntry
    ORDER BY T0.LineNum
  `, { docEntry }));

  const categoryLabels = { I: 'Invoice', P: 'Payment' };
  const baseTypeLabels = { G: 'Gross', N: 'Net', V: 'VAT', U: 'UoM', H: 'Gross - VAT' };
  const criteriaLabels = { C: 'Cash', A: 'Accrual', Y: 'Cash', N: 'Accrual' };
  const tdsTypeLabels = { E: 'eTDS', D: 'GST TDS', C: 'GST TCS', S: 'SALES TCS' };
  const savedWithholdingRows = withholdingRows.map((row) => ({
    lineNum: row.LineNum,
    documentLineNumber: row.DocumentLineNumber,
    code: row.WTCode || '',
    name: row.WTName || '',
    rate: Number(row.Rate || 0),
    baseAmount: Number(row.TDSBaseAmount ?? row.TaxableAmount ?? 0),
    taxableAmount: Number(row.TaxableAmount || 0),
    wtaxAmount: Number(row.WTAmount || 0),
    category: categoryLabels[String(row.Category || '').toUpperCase()] || row.Category || 'Invoice',
    categoryCode: row.Category || 'I',
    baseType: baseTypeLabels[String(row.BaseType || '').toUpperCase()] || row.BaseType || 'Net',
    baseTypeCode: row.BaseType || 'N',
    criteria: criteriaLabels[String(row.Criteria || '').toUpperCase()] || row.Criteria || 'Cash',
    criteriaCode: row.Criteria || 'C',
    tdsType: tdsTypeLabels[String(row.TDSType || '').toUpperCase()] || row.TDSType || 'eTDS',
    tdsTypeCode: row.TDSType || 'E',
    tdsAccount: row.TdsAccount || '',
    surchargeAccount: row.SurchargeAccount || '',
    cessAccount: row.CessAccount || '',
    hscAccount: row.HscAccount || '',
    igstAccount: row.IGSTAccount || '',
    cgstAccount: row.CGSTAccount || '',
    sgstAccount: row.SGSTAccount || '',
    utgstAccount: row.UTGSTAccount || '',
    cessGstAccount: row.CessGSTAccount || '',
    tdsRate: Number(row.TDSRate ?? row.Rate ?? 0),
    surchargeRate: Number(row.SurchargeRate || 0),
    cessRate: Number(row.CessRate || 0),
    hscRate: Number(row.HSCRate || 0),
    igstRate: Number(row.IGSTRate || 0),
    cgstRate: Number(row.CGSTRate || 0),
    sgstRate: Number(row.SGSTRate || 0),
    utgstRate: Number(row.UTGSTRate || 0),
    cessGstRate: Number(row.CessGSTRate || 0),
    tdsBaseAmount: Number(row.TDSBaseAmount ?? row.TaxableAmount ?? 0),
    surchargeBaseAmount: Number(row.SurchargeBaseAmount || 0),
    cessBaseAmount: Number(row.CessBaseAmount || 0),
    hscBaseAmount: Number(row.HSCBaseAmount || 0),
    igstBaseAmount: Number(row.IGSTBaseAmount || 0),
    cgstBaseAmount: Number(row.CGSTBaseAmount || 0),
    sgstBaseAmount: Number(row.SGSTBaseAmount || 0),
    utgstBaseAmount: Number(row.UTGSTBaseAmount || 0),
    cessGstBaseAmount: Number(row.CessGSTBaseAmount || 0),
    tdsTaxAmount: Number(row.TDSTaxAmount ?? row.WTAmount ?? 0),
    surchargeTaxAmount: Number(row.SurchargeTaxAmount || 0),
    cessTaxAmount: Number(row.CessTaxAmount || 0),
    hscTaxAmount: Number(row.HSCTaxAmount || 0),
    igstTaxAmount: Number(row.IGSTTaxAmount || 0),
    cgstTaxAmount: Number(row.CGSTTaxAmount || 0),
    sgstTaxAmount: Number(row.SGSTTaxAmount || 0),
    utgstTaxAmount: Number(row.UTGSTTaxAmount || 0),
    cessGstTaxAmount: Number(row.CessGSTTaxAmount || 0),
  }));

  const savedDocumentLineNumbers = new Set(
    savedWithholdingRows
      .map((row) => Number(row.documentLineNumber))
      .filter((lineNumber) => Number.isInteger(lineNumber) && lineNumber >= 0)
  );
  const hasSavedWithholdingTax = savedWithholdingRows.length > 0 || Number(header.WTaxAmount || 0) !== 0;

  const itemCodes = lineRows.map((l) => l.ItemCode).filter(Boolean);
  let itemInfoMap = {};

  if (itemCodes.length > 0) {
    const params = itemCodes.reduce((acc, code, i) => ({ ...acc, [`item${i}`]: code }), {});
    const itemRows = await safe(db.query(`
      SELECT T0.ItemCode,
             CHP.ChapterID AS HSNCode,
             T0.ManBtchNum AS BatchManaged
      FROM OITM T0
      LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
      WHERE T0.ItemCode IN (${itemCodes.map((_, i) => `@item${i}`).join(',')})
    `, params));

    itemInfoMap = itemRows.reduce((acc, row) => {
      acc[row.ItemCode] = {
        hsnCode: row.HSNCode || '',
        batchManaged: row.BatchManaged === 'Y',
      };
      return acc;
    }, {});
  }

  return {
    apInvoice: {
      doc_entry: header.DocEntry,
      doc_num: header.DocNum,
      header: {
        vendor: header.CardCode,
        name: header.CardName,
        contactPerson: header.ContactPersonCode ? String(header.ContactPersonCode) : '',
        salesEmployee: header.SalesEmployeeCode != null ? String(header.SalesEmployeeCode) : '',
        purchaser: header.SalesEmployeeName || '',
        salesContractNo: header.VendorRefNo || '',
        branch: header.Branch ? String(header.Branch) : '',
        docNo: header.DocNum ? String(header.DocNum) : '',
        status: header.DocumentStatus || 'Open',
        series: header.Series != null ? String(header.Series) : '',
        seriesName: header.SeriesName || '',
        seriesIndicator: header.SeriesIndicator || '',
        currency: header.Currency || '',
        exchangeRate: header.ExchangeRate == null ? '' : String(header.ExchangeRate),
        postingDate: header.PostingDate ? header.PostingDate.toISOString().split('T')[0] : '',
        deliveryDate: header.DeliveryDate ? header.DeliveryDate.toISOString().split('T')[0] : '',
        documentDate: header.DocumentDate ? header.DocumentDate.toISOString().split('T')[0] : '',
        journalRemark: header.JournalRemark || '',
        paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
        placeOfSupply: getPlaceOfSupplyUdfValue(headerUdfs),
        otherInstruction: header.Remarks || '',
        discount: header.DiscountPercent != null ? String(header.DiscountPercent) : '',
        rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
        roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
        freight: header.Freight != null ? String(header.Freight) : '',
        tax: header.Tax != null ? String(header.Tax) : '',
        wtaxAmount: header.WTaxAmount != null ? String(header.WTaxAmount) : '',
        totalPaymentDue: header.TotalPaymentDue != null ? String(header.TotalPaymentDue) : '',
        billToCode: header.ShipToCode || '',
        billTo: header.BillToAddress || '',
        billToAddress: header.BillToAddress || '',
        payToCode: header.PayToCode || '',
        payTo: header.PayToAddress || '',
        payToAddress: header.PayToAddress || '',
      },
      lines: lineRows.map((l) => {
        const itemInfo = itemInfoMap[l.ItemCode] || { hsnCode: '', batchManaged: false };
        return {
          baseEntry: l.BaseEntry || null,
          baseType: l.BaseType || null,
          baseLine: l.BaseLine || null,
          itemNo: l.ItemCode || '',
          itemDescription: l.ItemDescription || '',
          hsnCode: itemInfo.hsnCode,
          quantity: l.Quantity != null ? String(l.Quantity) : '',
          unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
          stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
          taxCode: l.TaxCode || '',
          wtaxLiable: (
            String(l.WTLiable || '').toUpperCase() === 'Y'
            || savedDocumentLineNumbers.has(Number(l.LineNum))
            || (hasSavedWithholdingTax && savedDocumentLineNumbers.size === 0)
          ) ? 'Y' : 'N',
          total: l.LineTotal != null ? String(l.LineTotal) : '',
          whse: l.Warehouse || '',
          glAccount: l.GLAccount || '',
          uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
          uomCode: l.UoMCode || '',
          uomName: l.UoMName || l.UoMCode || '',
          itemCost: l.ItemCost != null ? String(l.ItemCost) : '',
          distRule: l.DistributionRule || '',
          countryOfOrigin: l.CountryOfOrigin || '',
          loc: l.LocationCode != null ? String(l.LocationCode) : '',
          blanketAgreementNo: l.BlanketAgreementNo ? String(l.BlanketAgreementNo) : '',
          batchManaged: itemInfo.batchManaged,
          batches: [],
          udf: lineUdfsByLineNum[l.LineNum] || {},
        };
      }),
      withholding_tax_rows: savedWithholdingRows,
      header_udfs: headerUdfs,
    },
  };
};

const getDocumentSeries = async ({ date = null, branch = '', transactionType = '', docSubType } = {}) => {
  return getMarketingDocumentSeries({ objectCode: '18', date, branch, transactionType, docSubType });
};

const getNextNumber = async (series) => {
  const result = await safe(db.query(`
    SELECT NextNumber
    FROM NNM1
    WHERE Series = @series
      AND ObjectCode = '18'
  `, { series }));

  return { nextNumber: result.length ? result[0].NextNumber : null };
};

const getStateFromWarehouse = async (whsCode) => {
  const result = await safe(db.query(`
    SELECT State
    FROM OWHS
    WHERE WhsCode = @whsCode
  `, { whsCode }));

  return { state: result.length ? (result[0].State || '') : '' };
};

const loadReferencePart = async (label, loader, fallback, warnings) => {
  try {
    return await loader();
  } catch (error) {
    warnings.push(`${label}: ${error.message || 'failed to load'}`);
    return fallback;
  }
};

const getReferenceData = async () => {
  const warnings = [];
  const [
    vendors,
    items,
    warehouses,
    paymentTerms,
    salesEmployees,
    shippingTypes,
    branches,
    states,
    taxCodes,
    uomGroupsRaw,
    decimalRows,
    companyRows,
    udfMetadata,
    withholdingTaxCodes,
    distributionRules,
    glAccounts,
    locations,
    businessPartners,
  ] = await Promise.all([
    loadReferencePart('Vendors', getVendors, [], warnings),
    loadReferencePart('Items', getItems, [], warnings),
    loadReferencePart('Warehouses', getWarehouses, [], warnings),
    loadReferencePart('Payment terms', getPaymentTerms, [], warnings),
    loadReferencePart('Sales employees', getSalesEmployees, [], warnings),
    loadReferencePart('Shipping types', getShippingTypes, [], warnings),
    loadReferencePart('Branches', getBranches, [], warnings),
    loadReferencePart('States', getStates, [], warnings),
    loadReferencePart('Tax codes', getTaxCodes, [], warnings),
    loadReferencePart('UoM groups', getUomGroups, [], warnings),
    loadReferencePart('Decimal settings', getDecimalSettings, [], warnings),
    loadReferencePart('Company info', getCompanyInfo, [], warnings),
    loadReferencePart(
      'UDF metadata',
      () => getMarketingDocumentUdfs({ headerTable: 'OPCH', lineTable: 'PCH1' }),
      { header: [], rows: [] },
      warnings
    ),
    loadReferencePart('Withholding tax codes', getWithholdingTaxCodes, [], warnings),
    loadReferencePart('Distribution rules', () => masterDataDbService.lookupDistributionRules(), [], warnings),
    loadReferencePart('GL accounts', getGLAccounts, [], warnings),
    loadReferencePart('Warehouse locations', () => masterDataDbService.lookupWarehouseLocations(), [], warnings),
    loadReferencePart('Business partners', () => masterDataDbService.searchBP('', '', 5000, 0), [], warnings),
  ]);

  const uomGroupMap = Object.fromEntries(uomGroupsRaw.map((group) => [group.AbsEntry, group]));

  const decimalSettings = decimalRows.length > 0 ? {
    QtyDec: decimalRows[0].QtyDec || 2,
    PriceDec: decimalRows[0].PriceDec || 2,
    SumDec: decimalRows[0].SumDec || 2,
    RateDec: decimalRows[0].RateDec || 2,
    PercentDec: decimalRows[0].PercentDec || 2,
  } : {
    QtyDec: 2,
    PriceDec: 2,
    SumDec: 2,
    RateDec: 2,
    PercentDec: 2,
  };

  const companyInfo = companyRows.length > 0 ? {
    name: companyRows[0].CompnyName || 'SAP B1',
    address: companyRows[0].Address || '',
    state: companyRows[0].State || '',
    localCurrency: companyRows[0].MainCurncy || '',
    systemCurrency: companyRows[0].SysCurrncy || companyRows[0].MainCurncy || '',
  } : {
    name: 'SAP B1',
    address: '',
    state: '',
    localCurrency: '',
    systemCurrency: '',
  };

  return {
    company: companyInfo.name,
    company_state: companyInfo.state,
    local_currency: companyInfo.localCurrency,
    system_currency: companyInfo.systemCurrency,
    company_currency: companyInfo.localCurrency,
    default_branch: branches.length === 1 ? String(branches[0].BPLId || '') : '',
    vendors,
    contacts: [],
    pay_to_addresses: [],
    ship_to_addresses: [],
    bill_to_addresses: [],
    items,
    warehouses,
    warehouse_addresses: warehouses,
    company_address: { Address: companyInfo.address, State: companyInfo.state },
    tax_codes: taxCodes,
    withholding_tax_codes: withholdingTaxCodes,
    gl_accounts: glAccounts,
    distribution_rules: distributionRules,
    locations,
    business_partners: businessPartners,
    payment_terms: paymentTerms,
    sales_employees: salesEmployees.map((e) => ({ SlpCode: e.SlpCode, SlpName: e.SlpName, Memo: e.Memo, Commission: e.Commission, Active: e.Active })),
    shipping_types: shippingTypes,
    branches,
    states,
    uom_groups: Object.values(uomGroupMap),
    decimal_settings: decimalSettings,
    udf_metadata: udfMetadata,
    warnings,
  };
};

const getVendorDetails = async (vendorCode) => {
  if (!vendorCode) {
    return {
      contacts: [],
      pay_to_addresses: [],
      ship_to_addresses: [],
      bill_to_addresses: [],
      gstin: '',
      vendorState: '',
      withholding_tax: {
        subject: false,
        defaultCode: '',
        allowedCodes: [],
      },
    };
  }

  const [contacts, addresses, withholdingTax] = await Promise.all([
    getContactsByVendor(vendorCode),
    getAddressesByVendor(vendorCode),
    getVendorWithholdingTaxDetails(vendorCode),
  ]);
  const gstProfile = await getVendorGSTProfile(vendorCode);
  const payToAddresses = addresses.filter((a) => a.AdresType === 'B' || a.AdresType === 'bo_BillTo');
  const shipToAddresses = addresses.filter((a) => a.AdresType === 'S' || a.AdresType === 'bo_ShipTo');

  return {
    contacts,
    pay_to_addresses: payToAddresses,
    ship_to_addresses: shipToAddresses,
    bill_to_addresses: payToAddresses,
    gstin: gstProfile.GSTIN || '',
    vendorState: gstProfile.State || '',
    withholding_tax: withholdingTax,
  };
};

const getVendorValidation = async (cardCode) => {
  const rows = await safe(db.query(`
    SELECT TOP 1
      T0.CardCode,
      T0.CardType,
      T0.frozenFor AS FrozenFor,
      GST.State,
      GST.GSTIN
    FROM OCRD T0
    LEFT JOIN (
      SELECT
        T1.CardCode,
        T1.GSTRegnNo AS GSTIN,
        T1.State,
        ROW_NUMBER() OVER (
          PARTITION BY T1.CardCode
          ORDER BY CASE WHEN T1.AdresType = 'B' THEN 0 ELSE 1 END, T1.Address
        ) AS AddressRank
      FROM CRD1 T1
    ) GST
      ON GST.CardCode = T0.CardCode
     AND GST.AddressRank = 1
    WHERE T0.CardCode = @cardCode
  `, { cardCode }));

  return rows[0] || null;
};

const getFallbackNonGstTaxCode = async () => {
  const rows = await safe(db.query(`
    SELECT TOP 1
      T0.Code,
      T0.Name,
      SUM(T1.Rate) AS Rate
    FROM OVTG T0
    INNER JOIN VTG1 T1 ON T0.Code = T1.Code
    GROUP BY T0.Code, T0.Name
    HAVING
      SUM(T1.Rate) = 0
      OR UPPER(T0.Code) LIKE '%NON%GST%'
      OR UPPER(T0.Name) LIKE '%NON%GST%'
      OR UPPER(T0.Code) LIKE '%EXEMPT%'
      OR UPPER(T0.Name) LIKE '%EXEMPT%'
    ORDER BY
      CASE
        WHEN UPPER(T0.Code) LIKE '%NON%GST%' OR UPPER(T0.Name) LIKE '%NON%GST%' THEN 0
        WHEN UPPER(T0.Code) LIKE '%EXEMPT%' OR UPPER(T0.Name) LIKE '%EXEMPT%' THEN 1
        ELSE 2
      END,
      T0.Code
  `));

  return rows[0] || null;
};

const getBranchEnabled = async () => {
  const rows = await safe(db.query(`
    SELECT COUNT(*) AS BranchCount
    FROM OBPL
  `));
  return Number(rows[0]?.BranchCount || 0) > 0;
};

const getItemValidation = async (itemCode) => {
  const rows = await safe(db.query(`
    SELECT TOP 1
      ItemCode,
      validFor,
      frozenFor,
      PrchseItem,
      ManBtchNum,
      ManSerNum,
      InvntryUom
    FROM OITM
    WHERE ItemCode = @itemCode
  `, { itemCode }));
  return rows[0] || null;
};

const getTaxCodeValidation = async (code) => masterDataDbService.getTaxCode(code);

const createBaseDocumentError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  error.statusCode = 400;
  error.details = details;
  return error;
};

const parseBaseNumber = (value, fieldName, details) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw createBaseDocumentError(
      'BASE_DOCUMENT_NOT_FOUND',
      `Base document ${fieldName} is required.`,
      details,
    );
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createBaseDocumentError(
      'BASE_DOCUMENT_NOT_FOUND',
      `Base document ${fieldName} is invalid.`,
      { ...details, [fieldName]: value },
    );
  }

  return parsed;
};

const parseQuantity = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasPositiveBatchAssignment = (line = {}) => (
  Array.isArray(line.batches) &&
  line.batches.some((batch) => (
    String(batch?.batchNumber || batch?.BatchNumber || batch?.BatchNum || '').trim() &&
    parseQuantity(batch?.quantity ?? batch?.Quantity) > 0
  ))
);

const getBaseDocumentOpenLineValidation = async (baseType, docEntry, lineNum) => {
  const baseDocument = resolveApInvoiceBaseDocument(baseType);
  if (!baseDocument) return null;
  const { headerTable, lineTable } = baseDocument;
  const rows = await safe(db.query(`
    SELECT TOP 1
      T0.DocEntry,
      H.DocNum,
      H.DocStatus,
      H.CANCELED,
      T0.LineNum,
      T0.OpenQty,
      T0.LineStatus
    FROM ${lineTable} T0
    INNER JOIN ${headerTable} H ON H.DocEntry = T0.DocEntry
    WHERE T0.DocEntry = @docEntry
      AND T0.LineNum = @lineNum
  `, { docEntry, lineNum }));
  return rows[0] || null;
};

const getGRPOOpenLineValidation = (docEntry, lineNum) => (
  getBaseDocumentOpenLineValidation(20, docEntry, lineNum)
);

const validateAPInvoiceBaseDocuments = async (lines = []) => {
  for (let index = 0; index < (lines || []).length; index += 1) {
    const line = lines[index] || {};
    const rawBaseType = line.baseType ?? line.BaseType;
    const rawBaseEntry = line.baseEntry ?? line.BaseEntry;
    const rawBaseLine = line.baseLine ?? line.BaseLine;
    const hasBaseDocument =
      rawBaseType !== undefined && rawBaseType !== null && String(rawBaseType).trim() !== '' &&
      rawBaseEntry !== undefined && rawBaseEntry !== null && String(rawBaseEntry).trim() !== '' &&
      rawBaseLine !== undefined && rawBaseLine !== null && String(rawBaseLine).trim() !== '';

    if (!hasBaseDocument) continue;

    const details = { lineIndex: index, itemCode: line.itemNo || line.ItemCode || '' };
    const baseType = parseBaseNumber(rawBaseType, 'baseType', details);
    const baseEntry = parseBaseNumber(rawBaseEntry, 'baseEntry', details);
    const baseLine = parseBaseNumber(rawBaseLine, 'baseLine', details);
    const requestedQty = parseQuantity(line.quantity ?? line.Quantity);

    const baseDocument = resolveApInvoiceBaseDocument(baseType);
    if (!baseDocument) {
      const allowed = Object.values(AP_INVOICE_BASE_DOCUMENTS).map((item) => item.label).join(' or ');
      throw createBaseDocumentError(
        'INVALID_BASE_DOCUMENT_TYPE',
        `A/P Invoice can only be copied from an open ${allowed}. BaseType ${baseType} is not allowed.`,
        { ...details, baseType, baseEntry, baseLine },
      );
    }
    const { label } = baseDocument;

    if (!baseDocument.allowsBatchAllocation && hasPositiveBatchAssignment(line)) {
      throw createBaseDocumentError(
        'BATCH_ASSIGNMENT_NOT_REQUIRED',
        `Batch assignment is not required when creating an A/P Invoice from a ${label}.`,
        { ...details, baseType, baseEntry, baseLine },
      );
    }

    const grpoLine = await getBaseDocumentOpenLineValidation(baseType, baseEntry, baseLine);
    if (!grpoLine) {
      throw createBaseDocumentError(
        'BASE_LINE_NOT_FOUND',
        `${label} line ${baseLine} was not found.`,
        { ...details, baseType, baseEntry, baseLine },
      );
    }

    if (String(grpoLine.CANCELED || '').toUpperCase() === 'Y' || String(grpoLine.DocStatus || '').toUpperCase() !== 'O') {
      const targetInvoices = await getBaseDocumentTargetInvoices(baseType, baseEntry, baseLine);
      const targetReference = formatTargetInvoiceReference(targetInvoices[0]);
      throw createBaseDocumentError(
        'BASE_DOCUMENT_ALREADY_INVOICED',
        targetReference
          ? `${label} ${grpoLine.DocNum || baseEntry} was already copied to ${targetReference}; it cannot be copied again.`
          : `${label} ${grpoLine.DocNum || baseEntry} is closed and cannot be copied to A/P Invoice.`,
        { ...details, baseType, baseEntry, baseLine, docStatus: grpoLine.DocStatus, targetInvoices },
      );
    }

    if (String(grpoLine.LineStatus || '').toUpperCase() !== 'O') {
      const targetInvoices = await getBaseDocumentTargetInvoices(baseType, baseEntry, baseLine);
      const targetReference = formatTargetInvoiceReference(targetInvoices[0]);
      throw createBaseDocumentError(
        'BASE_LINE_CLOSED',
        targetReference
          ? `${label} line ${baseLine} was already copied to ${targetReference}; it cannot be invoiced again.`
          : `${label} line ${baseLine} is closed and cannot be invoiced again.`,
        { ...details, baseType, baseEntry, baseLine, lineStatus: grpoLine.LineStatus, targetInvoices },
      );
    }

    const openQty = parseQuantity(grpoLine.OpenQty);
    if (openQty <= 0) {
      throw createBaseDocumentError(
        'NO_OPEN_QUANTITY',
        `This ${label} line has already been fully invoiced.`,
        { ...details, baseType, baseEntry, baseLine, openQty },
      );
    }

    if (requestedQty - openQty > 0.000001) {
      throw createBaseDocumentError(
        'QUANTITY_EXCEEDS_OPEN_QUANTITY',
        `Quantity ${requestedQty} exceeds open quantity ${openQty} on ${label} line ${baseLine}.`,
        { ...details, baseType, baseEntry, baseLine, requestedQty, openQty },
      );
    }
  }

  return { isValid: true };
};

const isDuplicateVendorInvoiceNumber = async (cardCode, vendorRefNo, excludeDocEntry = null) => {
  if (!cardCode || !vendorRefNo) return false;
  const params = { cardCode, vendorRefNo };
  const extra = excludeDocEntry != null ? 'AND DocEntry <> @excludeDocEntry' : '';
  if (excludeDocEntry != null) params.excludeDocEntry = excludeDocEntry;
  const rows = await safe(db.query(`
    SELECT TOP 1 DocEntry
    FROM OPCH
    WHERE CardCode = @cardCode
      AND NumAtCard = @vendorRefNo
      ${extra}
  `, params));
  return rows.length > 0;
};

const hasItemGLAccount = async (itemCode) => {
  try {
    const rows = await db.query(`
      SELECT TOP 1 T1.AcctCode
      FROM OITM T0
      LEFT JOIN OACT T1 ON T1.AcctCode = T0.CogsAcct
      WHERE T0.ItemCode = @itemCode
    `, { itemCode });
    return !!rows.recordset?.[0]?.AcctCode;
  } catch (_error) {
    return true;
  }
};

module.exports = {
  getReferenceData,
  getVendorDetails,
  getAPInvoiceList,
  getAPInvoice,
  getDocumentSeries,
  getNextNumber,
  getStateFromWarehouse,
  getOpenGRPO,
  AP_INVOICE_BASE_DOCUMENTS,
  getBaseDocumentForCopy,
  getBaseDocumentOpenLineValidation,
  getGRPOForCopy,
  resolveApInvoiceBaseDocument,
  getVendorValidation,
  getFallbackNonGstTaxCode,
  getBranchEnabled,
  getItemValidation,
  getTaxCodeValidation,
  getGRPOOpenLineValidation,
  validateAPInvoiceBaseDocuments,
  isDuplicateVendorInvoiceNumber,
  hasItemGLAccount,
  getItemsForModal
};
