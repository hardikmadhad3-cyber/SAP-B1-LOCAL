const { getMarketingDocumentSeries: getSharedDocumentSeries, withSeriesContext } = require('./documentSeriesDbUtils');
const db = require('./dbService');
const { createPhysicalColumnSetReader, selectPhysicalOptionalColumn } = require('./salesDocumentDbCompatibility');
const { getDocumentUnitPriceSql } = require('./documentUnitPriceDbUtils');
const { getDocumentUomSql, loadCompanyUomGroups } = require('./documentUomDbUtils');
const { loadBusinessPartnerAddresses } = require('./businessPartnerAddressDbUtils');
const masterDataDbService = require('./masterDataDbService');
const { buildMarketingDocumentListFilterQuery } = require('./documentListUtils');
const { getHeaderUdfValues, getLineUdfValues, getMarketingDocumentUdfs } = require('./udfMetadataService');
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

const filterSeriesByTransactionType = (series = [], transactionType = '') => {
  const targetKind = resolveTransactionSeriesKind(transactionType);
  if (!targetKind) return series;

  const expectedDocSubType = targetKind === 'tax' ? 'GA' : targetKind === 'debit' ? 'GD' : '--';
  const matched = (Array.isArray(series) ? series : []).filter((row) => (
    String(row.DocSubType || '--').trim().toUpperCase() === expectedDocSubType
  ));
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
  let score = series.IsDefault || series.isDefault ? 25 : 0;
  if (targetKind === 'bill') {
    if (docSubType === '--') score += 120;
    if (text.includes('AP') || text.includes('BILL') || text.includes('SUPPLY') || text.includes('BOS')) score += 160;
    if (text.includes('CAN') || text.includes('DEBIT') || docSubType === 'GD') score -= 120;
  } else if (targetKind === 'tax') {
    if (docSubType === 'GA') score += 180;
    if (text.includes('GST') || text.includes('TAX')) score += 160;
    if (!text.includes('AP') && !text.includes('CAN') && !text.includes('DEBIT') && !text.includes('BILL')) score += 120;
    if (text.includes('AP') || text.includes('CAN') || text.includes('DEBIT') || docSubType === 'GD') score -= 120;
  } else if (targetKind === 'debit') {
    if (docSubType === 'GD') score += 200;
    if (text.includes('CAN') || text.includes('DEBIT')) score += 180;
  }
  return score;
};

const pickSapSeriesForTransactionType = (series = [], transactionType = '') => {
  if (!String(transactionType || '').trim()) return null;
  const rows = (Array.isArray(series) ? series : []).filter(Boolean);
  const candidates = rows.filter((row) => Number(row.Series) !== -1 && String(row.SeriesName || '').trim().toUpperCase() !== 'MANUAL');
  const pool = candidates.length ? candidates : rows;
  return pool
    .map((row, index) => ({ row, index, score: scoreSeriesForTransactionType(row, transactionType) }))
    .sort((left, right) =>
      right.score - left.score ||
      Number(right.row.IsDefault || right.row.isDefault || 0) - Number(left.row.IsDefault || left.row.isDefault || 0) ||
      left.index - right.index)[0]?.row || null;
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
         CHP.ChapterID  AS HSNCode
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
    MainCurncy
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
  const { addresses } = await loadBusinessPartnerAddresses(db, cardCode, { context: 'AP Credit Memo' });
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
      ORDER BY T0.DocEntry DESC
    `;

  const result = await safe(vendorCode ? db.query(query, { vendorCode }) : db.query(query));
  return { orders: result };
};

const getGRPOForCopy = async (docEntry) => {
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
      ${selectPhysicalOptionalColumn(await getTableColumns('OPDN'), 'T0', 'BPLId', 'Branch')},
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
    FROM OPDN T0
    LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`GRPO ${docEntry} not found`);
  }

  const header = headerRows[0];
  const copyLineColumns = await getTableColumns('PDN1');
  const documentUom = await getDocumentUomSql(db, 'PDN1');
  const copyLineResult = await db.query(`
    SELECT 
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      T0.OpenQty,
      ${await getDocumentUnitPriceSql(db, 'PDN1', 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TaxCode,
      ${optionalColumn(copyLineColumns, 'T0', 'WTLiable', 'WTLiable', "'N'")},
      T0.LineTotal,
      T0.WhsCode AS Warehouse,
      ${optionalColumn(copyLineColumns, 'T0', 'AcctCode', 'GLAccount', "''")},
      ${documentUom.entrySql} AS UoMEntry,
      ${documentUom.codeSql} AS UoMCode,
      ${documentUom.nameSql} AS UoMName,
      ${optionalColumn(copyLineColumns, 'T0', 'StockPrice', 'ItemCost', '0')},
      ${optionalColumn(copyLineColumns, 'T0', 'OcrCode', 'DistributionRule', "''")},
      ${optionalColumn(copyLineColumns, 'T0', 'CountryOrg', 'CountryOfOrigin', "''")},
      ${optionalColumn(copyLineColumns, 'T0', 'LocCode', 'LocationCode', "''")},
      ${optionalColumn(copyLineColumns, 'T0', 'SACEntry', 'SACCode', "''")},
      ${optionalColumn(copyLineColumns, 'T0', 'NoInvtryMv', 'WithoutQtyPosting', "'N'")},
      ${optionalColumn(copyLineColumns, 'T0', 'AgrNo', 'BlanketAgreementNo', "''")}
    FROM PDN1 T0
    ${documentUom.joinSql}
    WHERE T0.DocEntry = @docEntry
      AND T0.LineStatus = 'O'
      AND T0.OpenQty > 0
    ORDER BY T0.LineNum
  `, { docEntry });
  const lineRows = copyLineResult.recordset || [];

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
      const itemInfo = itemInfoMap[l.ItemCode] || { hsnCode: '', batchManaged: false };
      return {
        baseEntry: docEntry,
        baseType: 20,
        baseLine: l.LineNum,
        itemNo: l.ItemCode || '',
        itemDescription: l.ItemDescription || '',
        hsnCode: itemInfo.hsnCode,
        quantity: l.OpenQty != null ? String(l.OpenQty) : '',
        openQty: l.OpenQty != null ? String(l.OpenQty) : '',
        unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
        stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
        taxCode: l.TaxCode || '',
        wtaxLiable: String(l.WTLiable || '').toUpperCase() === 'Y' ? 'Y' : 'N',
        total: l.LineTotal != null ? String(l.LineTotal) : '',
        whse: l.Warehouse || '',
        glAccount: l.GLAccount || '',
        uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
        uomCode: l.UoMCode || '',
        uomName: l.UoMName || l.UoMCode || '',
        distRule: l.DistributionRule || '',
        countryOfOrigin: l.CountryOfOrigin || '',
        loc: l.LocationCode != null ? String(l.LocationCode) : '',
        sacCode: l.SACCode != null ? String(l.SACCode) : '',
        withoutQtyPosting: String(l.WithoutQtyPosting || '').toUpperCase() === 'Y' ? 'Y' : 'N',
        blanketAgreementNo: l.BlanketAgreementNo ? String(l.BlanketAgreementNo) : '',
        batchManaged: itemInfo.batchManaged,
        batches: [],
        udf: {},
      };
    }),
  };
};

const getAPCreditMemoList = async ({
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
        FROM RPC1 Q1
        WHERE Q1.DocEntry = T0.DocEntry
          AND (Q1.ItemCode LIKE @query OR Q1.Dscription LIKE @query)
      )`,
    ],
  });
  whereClauses.push("ISNULL(T0.DocType, 'I') = 'I'");

  const countRows = await safe(db.query(`
    SELECT COUNT(*) AS total_count
    FROM ORPC T0
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
        FROM RPC1 T1
        WHERE T1.DocEntry = T0.DocEntry
      ) AS line_count
    FROM ORPC T0
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    apCreditMemos: result.map((row) => ({
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

const getAPCreditMemo = async (docEntry) => {
  const headerColumns = await getTableColumns('ORPC');
  const headerRows = await safe(db.query(`
    SELECT 
      T0.DocEntry,
      T0.DocNum,
      T0.Series,
      T0.CardCode,
      T0.CardName,
      T0.CntctCode AS ContactPersonCode,
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
    FROM ORPC T0
    LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`A/P Credit Memo ${docEntry} not found`);
  }

  const header = headerRows[0];
  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'ORPC', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'RPC1', keyValue: docEntry }),
  ]);

  const lineColumns = await getTableColumns('RPC1');
  const documentUom = await getDocumentUomSql(db, 'RPC1');
  const lineResult = await db.query(`
    SELECT 
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      ${await getDocumentUnitPriceSql(db, 'RPC1', 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TaxCode,
      ${optionalColumn(lineColumns, 'T0', 'WTLiable', 'WTLiable', "'N'")},
      T0.LineTotal,
      T0.WhsCode AS Warehouse,
      ${documentUom.entrySql} AS UoMEntry,
      ${documentUom.codeSql} AS UoMCode,
      ${documentUom.nameSql} AS UoMName,
      ${optionalColumn(lineColumns, 'T0', 'AcctCode', 'GLAccount', "''")},
      ${optionalColumn(lineColumns, 'T0', 'StockPrice', 'ItemCost', '0')},
      ${optionalColumn(lineColumns, 'T0', 'OcrCode', 'DistributionRule', "''")},
      ${optionalColumn(lineColumns, 'T0', 'CountryOrg', 'CountryOfOrigin', "''")},
      ${optionalColumn(lineColumns, 'T0', 'LocCode', 'LocationCode', "''")},
      ${optionalColumn(lineColumns, 'T0', 'SACEntry', 'SACCode', "''")},
      ${optionalColumn(lineColumns, 'T0', 'NoInvtryMv', 'WithoutQtyPosting', "'N'")},
      ${optionalColumn(lineColumns, 'T0', 'AgrNo', 'BlanketAgreementNo', "''")},
      T0.BaseEntry,
      T0.BaseType,
      T0.BaseLine
    FROM RPC1 T0
    ${documentUom.joinSql}
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `, { docEntry });
  const lineRows = lineResult.recordset || [];
  if (!lineRows.length) {
    throw new Error(`A/P Credit Memo ${docEntry} exists but its content lines could not be loaded.`);
  }

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
    apCreditMemo: {
      doc_entry: header.DocEntry,
      doc_num: header.DocNum,
      header: {
        vendor: header.CardCode,
        name: header.CardName,
        contactPerson: header.ContactPersonCode ? String(header.ContactPersonCode) : '',
        salesEmployee: header.SalesEmployeeCode ? String(header.SalesEmployeeCode) : '',
        purchaser: header.SalesEmployeeName || '',
        salesContractNo: header.VendorRefNo || '',
        branch: header.Branch ? String(header.Branch) : '',
        docNo: header.DocNum ? String(header.DocNum) : '',
        status: header.DocumentStatus || 'Open',
        series: header.Series ? String(header.Series) : '',
        currency: header.Currency || '',
        exchangeRate: header.ExchangeRate == null ? '' : String(header.ExchangeRate),
        postingDate: header.PostingDate ? header.PostingDate.toISOString().split('T')[0] : '',
        deliveryDate: header.DeliveryDate ? header.DeliveryDate.toISOString().split('T')[0] : '',
        documentDate: header.DocumentDate ? header.DocumentDate.toISOString().split('T')[0] : '',
        journalRemark: header.JournalRemark || '',
        paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
        otherInstruction: header.Remarks || '',
        discount: header.DiscountPercent != null ? String(header.DiscountPercent) : '',
        rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
        roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
        freight: header.Freight != null ? String(header.Freight) : '',
        tax: header.Tax != null ? String(header.Tax) : '',
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
          wtaxLiable: String(l.WTLiable || '').toUpperCase() === 'Y' ? 'Y' : 'N',
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
          sacCode: l.SACCode != null ? String(l.SACCode) : '',
          withoutQtyPosting: String(l.WithoutQtyPosting || '').toUpperCase() === 'Y' ? 'Y' : 'N',
          blanketAgreementNo: l.BlanketAgreementNo ? String(l.BlanketAgreementNo) : '',
          batchManaged: itemInfo.batchManaged,
          batches: [],
          udf: lineUdfsByLineNum[l.LineNum] || {},
        };
      }),
      header_udfs: headerUdfs,
    },
  };
};

const getDocumentSeries = async ({ date = null, branch = '', transactionType = '', docSubType } = {}) => {
  return getMarketingDocumentSeries({ objectCode: '19', date, branch, transactionType, docSubType });
};

const getNextNumber = async (series) => {
  const result = await safe(db.query(`
    SELECT NextNumber
    FROM NNM1
    WHERE Series = @series
      AND ObjectCode = '19'
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
    distributionRules,
    glAccounts,
    locations,
    countries,
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
      () => getMarketingDocumentUdfs({ headerTable: 'ORPC', lineTable: 'RPC1' }),
      { header: [], rows: [] },
      warnings
    ),
    loadReferencePart('Distribution rules', () => masterDataDbService.lookupDistributionRules(), [], warnings),
    loadReferencePart('GL accounts', getGLAccounts, [], warnings),
    loadReferencePart('Warehouse locations', () => masterDataDbService.lookupWarehouseLocations(), [], warnings),
    loadReferencePart('Countries', () => masterDataDbService.lookupCountries(''), [], warnings),
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
  } : {
    name: 'SAP B1',
    address: '',
    state: '',
    localCurrency: '',
  };

  return {
    company: companyInfo.name,
    company_state: companyInfo.state,
    company_currency: companyInfo.localCurrency,
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
    payment_terms: paymentTerms,
    sales_employees: salesEmployees.map((e) => ({ SlpCode: e.SlpCode, SlpName: e.SlpName, Memo: e.Memo, Commission: e.Commission, Active: e.Active })),
    shipping_types: shippingTypes,
    branches,
    states,
    uom_groups: Object.values(uomGroupMap),
    decimal_settings: decimalSettings,
    udf_metadata: udfMetadata,
    distribution_rules: distributionRules,
    gl_accounts: glAccounts,
    locations,
    countries,
    business_partners: businessPartners,
    warnings,
  };
};

const getVendorDetails = async (vendorCode) => {
  if (!vendorCode) {
    return { contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [], gstin: '', vendorState: '' };
  }

  const [contacts, addresses] = await Promise.all([
    getContactsByVendor(vendorCode),
    getAddressesByVendor(vendorCode),
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
      PrchseItem
    FROM OITM
    WHERE ItemCode = @itemCode
  `, { itemCode }));
  return rows[0] || null;
};

const getTaxCodeValidation = async (code) => masterDataDbService.getTaxCode(code);

const getGRPOOpenLineValidation = async (docEntry, lineNum) => {
  const rows = await safe(db.query(`
    SELECT TOP 1
      T0.DocEntry,
      T0.LineNum,
      T0.OpenQty,
      T0.LineStatus
    FROM PDN1 T0
    INNER JOIN OPDN H ON H.DocEntry = T0.DocEntry
    WHERE T0.DocEntry = @docEntry
      AND T0.LineNum = @lineNum
  `, { docEntry, lineNum }));
  return rows[0] || null;
};

const isDuplicateVendorInvoiceNumber = async (cardCode, vendorRefNo, excludeDocEntry = null) => {
  if (!cardCode || !vendorRefNo) return false;
  const params = { cardCode, vendorRefNo };
  const extra = excludeDocEntry != null ? 'AND DocEntry <> @excludeDocEntry' : '';
  if (excludeDocEntry != null) params.excludeDocEntry = excludeDocEntry;
  const rows = await safe(db.query(`
    SELECT TOP 1 DocEntry
    FROM ORPC
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
  getAPCreditMemoList,
  getAPCreditMemo,
  getDocumentSeries,
  getNextNumber,
  getStateFromWarehouse,
  getOpenGRPO,
  getGRPOForCopy,
  getVendorValidation,
  getFallbackNonGstTaxCode,
  getBranchEnabled,
  getItemValidation,
  getTaxCodeValidation,
  getGRPOOpenLineValidation,
  isDuplicateVendorInvoiceNumber,
  hasItemGLAccount,
  getItemsForModal
};
