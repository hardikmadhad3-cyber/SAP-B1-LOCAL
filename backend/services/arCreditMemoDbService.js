const { getMarketingDocumentSeries: getSharedDocumentSeries } = require('./documentSeriesDbUtils');
/**
 * AR Credit Memo DB Service - ODBC/Direct SQL for GET operations
 * Reads data directly from SAP B1 SQL Server database
 */
const db = require('./dbService');
const { getDocumentUomSql, loadCompanyUomGroups } = require('./documentUomDbUtils');
const { getDocumentUnitPriceSql } = require('./documentUnitPriceDbUtils');
const { loadBusinessPartnerAddresses } = require('./businessPartnerAddressDbUtils');
const masterDataDbService = require('./masterDataDbService');
const salesOrderDb = require('./salesOrderDbService');
const deliveryDb = require('./deliveryDbService');
const arInvoiceDb = require('./arInvoiceDbService');
const { getHeaderUdfValues, getLineUdfValues, getMarketingDocumentUdfs } = require('./udfMetadataService');
const { buildMarketingDocumentListFilterQuery } = require('./documentListUtils');
const {
  buildAddressExtensionSelectFields,
  buildDocumentAddressComponents,
} = require('./documentAddressDbUtils');
const { selectSapEligibleSeries } = require('./documentSeriesDbUtils');
const {
  createTableColumnDetailsReader,
  createTableFieldMetadataReader,
} = require('./salesDocumentDbCompatibility');
const { buildLineDeliveryDateFields } = require('./salesDocumentHydrationUtils');
const { getRequestContext } = require('./requestContextService');
const authDbService = require('./authDbService');
const { selectEffectiveCprfRows } = require('./sapFormPreferenceUtils');

const safe = async (promise) => {
  try {
    const r = await promise;
    return Array.isArray(r) ? r : (r.recordset || []);
  } catch (e) {
    console.warn('[AR Credit Memo DB] Query failed silently:', e.message);
    return [];
  }
};

const getTableFieldMetadata = createTableFieldMetadataReader({ database: db });
const getTableColumnDetails = createTableColumnDetailsReader({ database: db });
const getARCreditMemoHeaderTableFieldMetadata = () => getTableFieldMetadata('ORIN');
const getARCreditMemoLineTableFieldMetadata = () => getTableFieldMetadata('RIN1');

const hasTableField = (metadata, columnName) => {
  const normalizedColumnName = String(columnName || '').trim().toLowerCase();
  if (!metadata || !normalizedColumnName) return false;
  return Object.keys(metadata).some((fieldName) => fieldName.toLowerCase() === normalizedColumnName);
};

const getTableFieldName = (metadata, columnName) => {
  const normalizedColumnName = String(columnName || '').trim().toLowerCase();
  if (!metadata || !normalizedColumnName) return '';
  return Object.keys(metadata).find((fieldName) => fieldName.toLowerCase() === normalizedColumnName) || '';
};

const sqlAlias = (alias) => `[${String(alias || '').replace(/]/g, ']]')}]`;

const sqlColumnRef = (metadata, tableAlias, columnName) => {
  const physicalName = getTableFieldName(metadata, columnName);
  return physicalName ? `${tableAlias}.[${physicalName}]` : '';
};

const optionalColumn = (metadata, tableAlias, columnName, alias, fallback = 'NULL') => (
  sqlColumnRef(metadata, tableAlias, columnName)
    ? `${sqlColumnRef(metadata, tableAlias, columnName)} AS ${sqlAlias(alias)}`
    : `${fallback} AS ${sqlAlias(alias)}`
);

const buildOptionalHeaderTextExpression = (metadata = {}, candidates = [], fallback = "''") => {
  const resolvedColumn = candidates
    .map((candidate) => sqlColumnRef(metadata, 'T0', candidate))
    .find(Boolean);
  return resolvedColumn
    ? `NULLIF(LTRIM(RTRIM(CAST(${resolvedColumn} AS NVARCHAR(254)))), '')`
    : fallback;
};

const keepSapVisibleNumberingSeries = (series = []) => {
  return selectSapEligibleSeries(series);
};

const normalizeSeriesText = (value) =>
  String(value || '').toUpperCase().replace(/FY/g, '').replace(/[-/\s]/g, '');

const resolveSeriesDocSubType = (transactionType = '') => {
  const normalizedType = normalizeSeriesText(transactionType);
  if (normalizedType.includes('GSTDEBITMEMO') || normalizedType.includes('DEBITMEMO')) return 'GD';
  if (normalizedType.includes('GSTTAXINVOICE') || normalizedType.includes('TAXINVOICE')) return 'GA';
  if (normalizedType.includes('BILLOFSUPPLY')) return '--';
  return '';
};

const firstUdfValue = (udf = {}, aliases = []) => {
  for (const alias of aliases) {
    if (udf[alias] !== undefined && udf[alias] !== null && String(udf[alias]) !== '') {
      return udf[alias];
    }
  }
  return '';
};

// ── REFERENCE DATA QUERIES ────────────────────────────────────────────────────

const getCustomers = () => safe(db.query(`
  SELECT CardCode, CardName, CardType, Currency, Balance,
         VatGroup, GroupNum AS PayTermsGrpCode
  FROM   OCRD
  WHERE  CardType = 'C'
    AND  frozenFor <> 'Y'
  ORDER  BY CardName
`));

const getItems = () => safe(db.query(`
  SELECT ItemCode, ItemName,
         SalUnitMsr  AS SalesUnit,
         InvntryUom  AS InventoryUOM,
         UgpEntry    AS UoMGroupEntry,
         SUoMEntry   AS SalesUomEntry,
         DfltWH      AS DefaultWarehouse,
         SWW         AS HSNCode,
         ManBtchNum  AS BatchManaged,
         ManSerNum   AS SerialManaged
  FROM   OITM
  WHERE  SellItem = 'Y'
    AND  validFor  <> 'N'
  ORDER  BY ItemCode
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

const getShippingTypes = () => safe(db.query(`
  SELECT TrnspCode, TrnspName
  FROM   OSHP
  ORDER  BY TrnspName
`));

const getSalesEmployees = () => safe(db.query(`
  SELECT SlpCode, SlpName, Memo, Commission, Active
  FROM   OSLP
  ORDER  BY
    CASE WHEN SlpCode = -1 THEN 0 ELSE 1 END,
    SlpName
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

const getTaxCodes = () => masterDataDbService.searchDocumentTaxCodes('', 'sales', 500, 0);

const getUomGroups = () => loadCompanyUomGroups(db);

const getDecimalSettings = () => safe(db.query(`
  SELECT TOP 1
    DecSep, ThousSep, DateSep, DateFormat,
    PriceDec,
    QtyDec,
    RateDec,
    PercentDec,
    MeasureDec AS MeasurDec,
    SumDec
  FROM OADM
`));

const getCompanyInfo = () => safe(db.query(`
  SELECT TOP 1
    CompnyName,
    CompnyAddr AS Address,
    State
  FROM OADM
`));

// ── CUSTOMER DETAILS ──────────────────────────────────────────────────────────

const getContactsByCustomer = async (cardCode) => {
  const result = await safe(db.query(`
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

  return result;
};

const getAddressesByCustomer = async (cardCode) => {
  const { addresses } = await loadBusinessPartnerAddresses(db, cardCode, { context: 'AR Credit Memo' });
  return addresses;
};

// ── AR CREDIT MEMO LIST ───────────────────────────────────────────────────────

const getARCreditMemoList = async ({
  query = '',
  openOnly = false,
  docNum = '',
  customerCode = '',
  customerName = '',
  sellerCode = '',
  sellerName = '',
  status = '',
  postingDateFrom = '',
  postingDateTo = '',
  page = 1,
  pageSize = 25,
} = {}) => {
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedPageSize = Math.min(200, Math.max(1, Number(pageSize) || 25));
  const skip = (normalizedPage - 1) * normalizedPageSize;
  const headerFieldMetadata = await getARCreditMemoHeaderTableFieldMetadata();
  const sellerCodeExpression = buildOptionalHeaderTextExpression(headerFieldMetadata, [
    'U_Seller_Code',
    'U_To_Code_Vendor',
    'U_ToCodeVendor',
    'U_To_Code',
    'U_ToCode',
    'U_To_Vendor_Code',
    'U_Vendor_Code',
    'U_Party_Code',
  ]);
  const sellerNameExpression = buildOptionalHeaderTextExpression(headerFieldMetadata, [
    'U_Seller_Name',
    'U_To_Name',
    'U_ToName',
    'U_Vendor_Name',
    'U_Party_Name',
  ]);
  const { whereClauses, params } = buildMarketingDocumentListFilterQuery({
    query,
    openOnly,
    docNum,
    partnerCode: customerCode,
    partnerName: customerName,
    sellerCode,
    sellerName,
    status,
    postingDateFrom,
    postingDateTo,
  }, {
    includeSellerFields: true,
    sellerCodeField: sellerCodeExpression,
    sellerNameField: sellerNameExpression,
  });
  whereClauses.push("T0.DocType = 'I'");

  const countRows = await safe(db.query(`
    SELECT COUNT(*) AS total_count
    FROM ORIN T0
    WHERE ${whereClauses.join('\n      AND ')}
  `, params));

  const totalCount = Number(countRows?.[0]?.total_count || 0);

  const result = await safe(db.query(`
    SELECT
      T0.DocEntry AS doc_entry,
      T0.DocNum AS doc_num,
      T0.CardCode AS customer_code,
      T0.CardName AS customer_name,
      COALESCE(${sellerCodeExpression}, '') AS seller_code,
      COALESCE(${sellerNameExpression}, '') AS seller_name,
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
        FROM RIN1 T1
        WHERE T1.DocEntry = T0.DocEntry
          AND ISNULL(LTRIM(RTRIM(T1.ItemCode)), '') <> ''
      ) AS line_count
    FROM ORIN T0
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    ar_credit_memos: result.map((row) => ({
      doc_entry: row.doc_entry,
      doc_num: row.doc_num,
      customer_code: row.customer_code,
      customer_name: row.customer_name,
      seller_code: row.seller_code || '',
      seller_name: row.seller_name || '',
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

// ── GET SINGLE AR CREDIT MEMO ─────────────────────────────────────────────────

const getARCreditMemo = async (docEntry) => {
  const headerFieldMetadata = await getTableFieldMetadata('ORIN');
  const addressExtensionFieldMetadata = await getTableFieldMetadata('RIN12');
  const addressExtensionSelectFields = buildAddressExtensionSelectFields({
    fieldMetadata: addressExtensionFieldMetadata,
    tableAlias: 'T12',
    quoteIdentifier: sqlAlias,
    quoteAlias: sqlAlias,
  });
  const headerRows = await safe(db.query(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.DocType,
      T0.Series,
      NNM.SeriesName,
      NNM.Indicator AS SeriesIndicator,
      T0.CardCode,
      T0.CardName,
      T0.CntctCode AS ContactPersonCode,
      T0.NumAtCard AS CustomerRefNo,
      T0.DocDate AS PostingDate,
      T0.DocDueDate AS DeliveryDate,
      T0.TaxDate AS DocumentDate,
      T0.BPLId AS Branch,
      T0.DocCur AS Currency,
      T0.DocRate AS ExchangeRate,
      T0.GroupNum AS PaymentTerms,
      T0.Comments AS Remarks,
      T0.JrnlMemo AS JournalRemark,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TotalExpns AS Freight,
      T0.VatSum AS Tax,
      ${optionalColumn(headerFieldMetadata, 'T0', 'RoundDif', 'RoundingAmount', '0')},
      T0.DocTotal AS TotalPaymentDue,
      ${optionalColumn(headerFieldMetadata, 'T0', 'ShipToCode', 'ShipToCode', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'PayToCode', 'PayToCode', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'Address', 'ShipToAddress', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'Address2', 'BillToAddress', "''")},
      ${addressExtensionSelectFields.join(',\n      ')},
      T0.SlpCode AS SalesEmployeeCode,
      SLP.SlpName AS SalesEmployeeName,
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS DocumentStatus
    FROM ORIN T0
    LEFT JOIN RIN12 T12 ON T12.DocEntry = T0.DocEntry
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    LEFT JOIN NNM1 NNM ON NNM.ObjectCode = '14' AND NNM.Series = T0.Series
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`AR Credit Memo ${docEntry} not found`);
  }

  const header = headerRows[0];
  const shipToAddressComponents = buildDocumentAddressComponents(header, 'ShipTo');
  const billToAddressComponents = buildDocumentAddressComponents(header, 'BillTo');
  if (String(header.DocType || 'I').trim().toUpperCase() === 'S') {
    const error = new Error('This A/R Credit Memo is a Service type document. Open it in the Service A/R Credit Memo page.');
    error.status = 400;
    throw error;
  }

  const lineFieldMetadata = await getTableFieldMetadata('RIN1');
  const lineTaxExpression = hasTableField(lineFieldMetadata, 'TaxCode')
    ? 'T0.TaxCode'
    : hasTableField(lineFieldMetadata, 'VatGroup')
      ? 'T0.VatGroup'
      : "''";
  const documentUom = await getDocumentUomSql(db, 'RIN1');
  const lineSacExpression = hasTableField(lineFieldMetadata, 'SacEntry')
    ? 'T0.SacEntry'
    : hasTableField(lineFieldMetadata, 'SACEntry')
      ? 'T0.SACEntry'
      : "''";
  const lineTaxAmountExpression = hasTableField(lineFieldMetadata, 'VatSum')
    ? 'T0.VatSum'
    : 'NULL';
  const lineWithoutQtyPostingExpression = hasTableField(lineFieldMetadata, 'NoInvtryMv')
    ? 'T0.NoInvtryMv'
    : hasTableField(lineFieldMetadata, 'WithoutQtyPosting')
      ? 'T0.WithoutQtyPosting'
      : "'N'";
  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'ORIN', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'RIN1', keyValue: docEntry }),
  ]);

  let lineRows = [];
  try {
    const lineResult = await db.query(`
      SELECT
        T0.LineNum,
        T0.ItemCode,
        COALESCE(NULLIF(LTRIM(RTRIM(T0.Dscription)), ''), ITM.ItemName, '') AS ItemDescription,
        T0.Quantity,
        ${optionalColumn(lineFieldMetadata, 'T0', 'ShipDate', 'ShipDate', 'NULL')},
        ${await getDocumentUnitPriceSql(db, 'RIN1', 'T0')} AS UnitPrice,
        T0.DiscPrcnt AS DiscountPercent,
        ${lineTaxExpression} AS TaxCode,
        T0.LineTotal,
        ${lineTaxAmountExpression} AS TaxAmount,
        ${optionalColumn(lineFieldMetadata, 'T0', 'WTLiable', 'WTLiable', "'N'")},
        T0.WhsCode AS Warehouse,
        ${documentUom.entrySql} AS UoMEntry,
        ${documentUom.codeSql} AS UoMCode,
        ${documentUom.nameSql} AS UoMName,
        ${optionalColumn(lineFieldMetadata, 'T0', 'AcctCode', 'GLAccount', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'OcrCode', 'DistributionRule', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'CogsOcrCod', 'COGSDistributionRule', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'CountryOrg', 'CountryOfOrigin', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'LocCode', 'Loc', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'OcrCode2', 'BranchCode', "''")},
        ${lineWithoutQtyPostingExpression} AS WithoutQtyPosting,
        ${optionalColumn(lineFieldMetadata, 'T0', 'EnSetCost', 'EnableSettingCost', "'N'")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'RetCost', 'ReturnCost', '0')},
        ${optionalColumn(lineFieldMetadata, 'T0', 'AgrNo', 'BlanketAgreementNo', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'StockPrice', 'ItemCost', '0')},
        ${optionalColumn(lineFieldMetadata, 'T0', 'U_AssblValue', 'AssessableValue', 'NULL')},
        ${lineSacExpression} AS SACCode,
        T0.BaseEntry,
        T0.BaseType,
        T0.BaseLine,
        COALESCE(CHP.ChapterID, ITM.SWW, '') AS HSNCode
      FROM RIN1 T0
      ${documentUom.joinSql}
      LEFT JOIN OITM ITM ON ITM.ItemCode = T0.ItemCode
      LEFT JOIN OCHP CHP ON CHP.AbsEntry = ITM.ChapterID
      WHERE T0.DocEntry = @docEntry
        AND ISNULL(LTRIM(RTRIM(T0.ItemCode)), '') <> ''
      ORDER BY T0.LineNum
    `, { docEntry });
    lineRows = Array.isArray(lineResult) ? lineResult : (lineResult.recordset || []);
  } catch (error) {
    console.error('[AR Credit Memo DB] Detailed line query failed; retrying with minimal line query:', error.message);
    const fallbackResult = await db.query(`
      SELECT
        T0.LineNum,
        T0.ItemCode,
        T0.Dscription AS ItemDescription,
        T0.Quantity,
        ${optionalColumn(lineFieldMetadata, 'T0', 'ShipDate', 'ShipDate', 'NULL')},
        ${await getDocumentUnitPriceSql(db, 'RIN1', 'T0')} AS UnitPrice,
        T0.DiscPrcnt AS DiscountPercent,
        ${lineTaxExpression} AS TaxCode,
        T0.LineTotal,
        ${lineTaxAmountExpression} AS TaxAmount,
        T0.WhsCode AS Warehouse,
        ${documentUom.entrySql} AS UoMEntry,
        ${documentUom.codeSql} AS UoMCode,
        ${documentUom.nameSql} AS UoMName,
        T0.BaseEntry,
        T0.BaseType,
        T0.BaseLine,
        COALESCE(ITM.SWW, '') AS HSNCode
      FROM RIN1 T0
      ${documentUom.joinSql}
      LEFT JOIN OITM ITM ON ITM.ItemCode = T0.ItemCode
      WHERE T0.DocEntry = @docEntry
        AND ISNULL(LTRIM(RTRIM(T0.ItemCode)), '') <> ''
      ORDER BY T0.LineNum
    `, { docEntry });
    lineRows = Array.isArray(fallbackResult) ? fallbackResult : (fallbackResult.recordset || []);
  }

  console.log(`[DB] getARCreditMemo - DocEntry: ${docEntry}, Line rows found: ${lineRows.length}`);

  const itemCodes = lineRows.map(l => l.ItemCode).filter(Boolean);
  let itemInfoMap = {};
  
  if (itemCodes.length > 0) {
    try {
      const itemRows = await safe(db.query(`
        SELECT ItemCode, SWW AS HSNCode, ManBtchNum AS BatchManaged
        FROM OITM
        WHERE ItemCode IN (${itemCodes.map((_, i) => `@item${i}`).join(',')})
      `, itemCodes.reduce((acc, code, i) => ({ ...acc, [`item${i}`]: code }), {})));
      
      itemInfoMap = itemRows.reduce((acc, row) => {
        acc[row.ItemCode] = {
          hsnCode: row.HSNCode || '',
          batchManaged: row.BatchManaged === 'Y'
        };
        return acc;
      }, {});
    } catch (err) {
      console.error('[DB] Error fetching item info:', err);
    }
  }

  // Fetch batch allocations for this credit memo
  const batchRows = await safe(db.query(`
    SELECT BaseLinNum AS BaseLineNum, BatchNum, Quantity
    FROM   IBT1
    WHERE  BaseEntry = @docEntry
      AND  BaseType = 14
    ORDER  BY BaseLinNum, BatchNum
  `, { docEntry }));

  const batchesByLine = {};
  batchRows.forEach(b => {
    if (!batchesByLine[b.BaseLineNum]) {
      batchesByLine[b.BaseLineNum] = [];
    }
    batchesByLine[b.BaseLineNum].push({
      batchNumber: b.BatchNum || '',
      quantity: String(b.Quantity || 0),
      expiryDate: '',
    });
  });

  const formattedLines = lineRows.map((l, idx) => {
    const itemInfo = itemInfoMap[l.ItemCode] || { hsnCode: '', batchManaged: false };
    const lineUdfs = lineUdfsByLineNum[l.LineNum] || {};
    return {
      baseEntry: l.BaseEntry || null,
      baseType: l.BaseType || null,
      baseLine: l.BaseLine || null,
      lineNum: l.LineNum,
      LineNum: l.LineNum,
      itemNo: l.ItemCode || '',
      ItemCode: l.ItemCode || '',
      itemDescription: l.ItemDescription || '',
      ItemDescription: l.ItemDescription || '',
      hsnCode: l.HSNCode || itemInfo.hsnCode,
      HSNCode: l.HSNCode || itemInfo.hsnCode,
      sacCode: l.SACCode != null ? String(l.SACCode) : '',
      SACCode: l.SACCode != null ? String(l.SACCode) : '',
      quantity: l.Quantity != null ? String(l.Quantity) : '',
      Quantity: l.Quantity != null ? String(l.Quantity) : '',
      ...buildLineDeliveryDateFields(l),
      unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
      UnitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
      stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
      DiscountPercent: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
      taxCode: l.TaxCode || '',
      TaxCode: l.TaxCode || '',
      taxCodeRepeat: firstUdfValue(lineUdfs, ['U_TAXCODE', 'U_TaxCode']) || l.TaxCode || '',
      total: l.LineTotal != null ? String(l.LineTotal) : '',
      totalLC: l.LineTotal != null ? String(l.LineTotal) : '',
      LineTotal: l.LineTotal != null ? String(l.LineTotal) : '',
      taxAmount: l.TaxAmount != null ? String(l.TaxAmount) : '',
      wTaxLiable: String(l.WTLiable || '').toUpperCase() === 'Y' ? 'Y' : 'N',
      WTLiable: String(l.WTLiable || '').toUpperCase() === 'Y' ? 'Y' : 'N',
      whse: l.Warehouse || '',
      WarehouseCode: l.Warehouse || '',
      WhsCode: l.Warehouse || '',
      glAccount: l.GLAccount || '',
      GLAccount: l.GLAccount || '',
      distRule: l.DistributionRule || '',
      DistributionRule: l.DistributionRule || '',
      cogsDistRule: l.COGSDistributionRule || l.DistributionRule || '',
      COGSDistributionRule: l.COGSDistributionRule || l.DistributionRule || '',
      countryOfOrigin: l.CountryOfOrigin || '',
      CountryOfOrigin: l.CountryOfOrigin || '',
      loc: l.Loc || '',
      Loc: l.Loc || '',
      branch: l.BranchCode || (header.Branch ? String(header.Branch) : ''),
      uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
      uomCode: l.UoMCode || '',
      UoMCode: l.UoMCode || '',
      uomName: l.UoMName || l.UoMCode || '',
      enableSettingCost: String(l.EnableSettingCost || '').toUpperCase() === 'Y' ? 'Y' : 'N',
      withoutQtyPosting: String(l.WithoutQtyPosting || '').toUpperCase() === 'Y' ? 'Y' : 'N',
      returnCost: l.ReturnCost != null ? String(l.ReturnCost) : '',
      blanketAgreementNo: l.BlanketAgreementNo != null ? String(l.BlanketAgreementNo) : '',
      BlanketAgreementNo: l.BlanketAgreementNo != null ? String(l.BlanketAgreementNo) : '',
      itemCost: l.ItemCost != null ? String(l.ItemCost) : '',
      ItemCost: l.ItemCost != null ? String(l.ItemCost) : '',
      assessableValue: l.AssessableValue != null ? String(l.AssessableValue) : '',
      price: firstUdfValue(lineUdfs, ['U_PRICE', 'U_Price']),
      sellerBrokerage: firstUdfValue(lineUdfs, ['U_Brok_Seller', 'U_BROK_SELLER']),
      buyerBrokerage: firstUdfValue(lineUdfs, ['U_Brok_Buyer', 'U_BROK_BUYER']),
      buyerDelivery: firstUdfValue(lineUdfs, ['U_Buyer_Delivery', 'U_BUYER_DELIVERY']),
      sellerDelivery: firstUdfValue(lineUdfs, ['U_Seller_Delivery', 'U_SELLER_DELIVERY']),
      buyerPaymentTerms: firstUdfValue(lineUdfs, ['U_Buyer_Payment_Terms', 'U_BUYER_PAYMENT_TERMS']),
      sellerPaymentTerms: firstUdfValue(lineUdfs, ['U_Seller_Payment_Term', 'U_Seller_Payment_Terms', 'U_SELLER_PAYMENT_TERM', 'U_SELLER_PAYMENT_TERMS']),
      buyerQuality: firstUdfValue(lineUdfs, ['U_Buyer_Quality', 'U_BUYER_QUALITY']),
      sellerQuality: firstUdfValue(lineUdfs, ['U_Seller_Quality', 'U_SELLER_QUALITY']),
      buyerPrice: firstUdfValue(lineUdfs, ['U_Buyer_Price', 'U_BUYER_PRICE']),
      sellerPrice: firstUdfValue(lineUdfs, ['U_Seller_Price', 'U_SELLER_PRICE']),
      buyerSpecialInstruction: firstUdfValue(lineUdfs, ['U_Buyer_SPINS', 'U_BUYER_SPINS']),
      sellerSpecialInstruction: firstUdfValue(lineUdfs, ['U_Seller_SPINS', 'U_SELLER_SPINS']),
      sellerBrokerageAmtPer: firstUdfValue(lineUdfs, ['U_Sel_Brok_AP', 'U_SEL_BROK_AP']),
      sellerBrokeragePercent: firstUdfValue(lineUdfs, ['U_Seller_Brok_Per', 'U_SELLER_BROK_PER']),
      stcode: firstUdfValue(lineUdfs, ['U_SELLTCODE']),
      sellerItem: firstUdfValue(lineUdfs, ['U_S_Item', 'U_S_ITEM']),
      sellerQty: firstUdfValue(lineUdfs, ['U_S_Qty', 'U_S_QTY']),
      specialRebate: firstUdfValue(lineUdfs, ['U_SPLRBT']),
      commission: firstUdfValue(lineUdfs, ['U_COMPRC']),
      sellerBrokeragePerQty: firstUdfValue(lineUdfs, ['U_S_BrokPerQty', 'U_S_BROKPERQTY']),
      U_Cost_Sheet: firstUdfValue(lineUdfs, ['U_Cost_Sheet']),
      U_PackingType: firstUdfValue(lineUdfs, ['U_PackingType', 'U_PACKINGTYPE']),
      U_ContainerType: firstUdfValue(lineUdfs, ['U_ContainerType']),
      U_GrossWt: firstUdfValue(lineUdfs, ['U_GrossWt']),
      U_TotalPackage: firstUdfValue(lineUdfs, ['U_TotalPackage']),
      U_Fix_Brock_B: firstUdfValue(lineUdfs, ['U_Fix_Brock_B', 'U_Fix_Brok_B', 'U_FIX_BROK_BUYER']),
      U_Fix_Brock_S: firstUdfValue(lineUdfs, ['U_Fix_Brock_S', 'U_Fix_Brok_S', 'U_Fix_Brock_Seller']),
      batchManaged: itemInfo.batchManaged,
      batches: batchesByLine[l.LineNum] || [],
      udf: lineUdfs,
      line_udfs: lineUdfs,
    };
  });

  return {
    ar_credit_memo: {
      doc_entry: header.DocEntry,
      doc_num: header.DocNum,
      header: {
        customer: header.CardCode,
        customerCode: header.CardCode,
        name: header.CardName,
        customerName: header.CardName,
        docType: header.DocType || 'I',
        contactPerson: header.ContactPersonCode ? String(header.ContactPersonCode) : '',
        salesContractNo: header.CustomerRefNo || '',
        branch: header.Branch ? String(header.Branch) : '',
        warehouse: lineRows.length > 0 && lineRows[0].Warehouse ? String(lineRows[0].Warehouse) : '',
        docNo: header.DocNum ? String(header.DocNum) : '',
        status: header.DocumentStatus || 'Open',
        series: header.Series ? String(header.Series) : '',
        seriesName: header.SeriesName || '',
        seriesIndicator: header.SeriesIndicator || '',
        postingDate: header.PostingDate ? header.PostingDate.toISOString().split('T')[0] : '',
        deliveryDate: header.DeliveryDate ? header.DeliveryDate.toISOString().split('T')[0] : '',
        documentDate: header.DocumentDate ? header.DocumentDate.toISOString().split('T')[0] : '',
        journalRemark: header.JournalRemark || '',
        paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
        paymentTermsCode: header.PaymentTerms ? String(header.PaymentTerms) : '',
        otherInstruction: header.Remarks || '',
        discount: header.DiscountPercent != null ? String(header.DiscountPercent) : '',
        freight: header.Freight != null ? String(header.Freight) : '',
        tax: header.Tax != null ? String(header.Tax) : '',
        rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
        roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
        totalPaymentDue: header.TotalPaymentDue != null ? String(header.TotalPaymentDue) : '',
        shipToCode: header.ShipToCode || '',
        payToCode: header.PayToCode || '',
        billToCode: header.PayToCode || '',
        shipTo: header.ShipToAddress || '',
        payTo: header.BillToAddress || '',
        shipToAddress: header.ShipToAddress || '',
        billToAddress: header.BillToAddress || '',
        shipToAddressComponents,
        billToAddressComponents,
        salesEmployee: header.SalesEmployeeCode ? String(header.SalesEmployeeCode) : '',
        purchaser: header.SalesEmployeeName || '',
        currency: header.Currency || '',
        exchangeRate: header.ExchangeRate != null ? String(header.ExchangeRate) : '',
      },
      lines: formattedLines,
      DocumentLines: formattedLines,
      header_udfs: headerUdfs,
    }
  };
};

// ── DOCUMENT SERIES ───────────────────────────────────────────────────────────

const getDocumentSeries = async (targetDate = null, transactionType = '', branch = '', docSubType) => getSharedDocumentSeries({ db, objectCode: '14', targetDate, branch, docSubType, transactionType });

const getNextNumber = async (series) => {
  const result = await safe(db.query(`
    SELECT NextNumber
    FROM NNM1
    WHERE Series = @series
      AND ObjectCode = '14'
  `, { series }));

  if (result.length > 0) {
    return { nextNumber: result[0].NextNumber };
  }

  return { nextNumber: null };
};

// ── STATE FROM ADDRESS/WAREHOUSE ──────────────────────────────────────────────

const getStateFromAddress = async (cardCode, addressCode) => {
  const result = await safe(db.query(`
    SELECT State
    FROM CRD1
    WHERE CardCode = @cardCode
      AND Address = @addressCode
  `, { cardCode, addressCode }));

  if (result.length > 0) {
    return { state: result[0].State || '' };
  }

  return { state: '' };
};

const getWarehouseState = async (whsCode) => {
  const result = await safe(db.query(`
    SELECT State
    FROM OWHS
    WHERE WhsCode = @whsCode
  `, { whsCode }));

  if (result.length > 0) {
    return { state: result[0].State || '' };
  }

  return { state: '' };
};

const getWarehouseBranch = async (whsCode) => {
  const normalizedWarehouseCode = String(whsCode || '').trim();
  if (!normalizedWarehouseCode) return { branchId: '' };

  const result = await safe(db.query(`
    SELECT TOP 1 BPLid AS BPLId
    FROM OWHS
    WHERE WhsCode = @whsCode
      AND Inactive <> 'Y'
  `, { whsCode: normalizedWarehouseCode }));

  return {
    branchId: result[0]?.BPLId != null ? String(result[0].BPLId) : '',
  };
};

// ── FREIGHT CHARGES ───────────────────────────────────────────────────────────

const getFreightCharges = (docEntry) => {
  if (!docEntry) {
    // CREATE MODE (New AR Credit Memo)
    return safe(db.query(`
      SELECT 
        T0.ExpnsCode,
        T0.ExpnsName,
        T0.DistrbMthd AS DistributionMethod,
        T0.TaxLiable,
        T0.RevFixSum AS DefaultAmount
      FROM OEXD T0
      ORDER BY T0.ExpnsName
    `));
  }

  // EDIT MODE (Existing AR Credit Memo)
  return safe(db.query(`
    SELECT 
      T0.ExpnsCode,
      T0.ExpnsName,
      T0.DistrbMthd AS DistributionMethod,
      T0.TaxLiable,
      T0.RevFixSum AS DefaultAmount,

      ISNULL(T1.LineTotal, 0) AS LineTotal,
      T1.TaxCode,
      T1.VatSum AS TaxAmount,
      T1.Comments

    FROM OEXD T0
    LEFT JOIN RIN3 T1 
      ON T0.ExpnsCode = T1.ExpnsCode 
     AND T1.DocEntry = @DocEntry

    ORDER BY T0.ExpnsName
  `, { DocEntry: docEntry }));
};

// ── ITEMS FOR MODAL ───────────────────────────────────────────────────────────

const getItemsForModal = () => safe(db.query(`
  SELECT 
    T0.ItemCode,
    T0.ItemName,
    T0.FrgnName AS ForeignName,
    T0.ItmsGrpCod AS ItemGroupCode,
    T1.ItmsGrpNam AS ItemGroup, 
    CAST(T0.OnHand AS DECIMAL(19,2)) AS InStock,
    T0.IsCommited AS Committed,
    T0.OnOrder AS Ordered,
    T0.SalUnitMsr AS SalesUnit,
    T0.InvntryUom AS InventoryUOM,
    T0.UgpEntry AS UoMGroupEntry,
    T0.SUoMEntry AS SalesUomEntry,
    CHP.ChapterID AS HSNCode,
    T0.validFor AS Active,
    T0.frozenFor AS Frozen,
    T0.PrchseItem AS PurchaseItem,
    T0.SellItem AS SalesItem,
    T0.InvntItem AS InventoryItem,
    T0.DfltWH AS DefaultWarehouse,
    T0.ManBtchNum AS BatchManaged,
    T0.ManSerNum AS SerialManaged
  FROM OITM T0
  LEFT JOIN OITB T1 ON T0.ItmsGrpCod = T1.ItmsGrpCod 
  LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
  WHERE T0.SellItem = 'Y'
    AND T0.validFor <> 'N'
  ORDER BY T0.ItemCode
`));

// ── BATCHES ───────────────────────────────────────────────────────────────────

const getBatchesByItem = async (itemCode, whsCode) => {
  const result = await safe(db.query(`
    SELECT 
      T0.BatchNum AS BatchNumber,
      T0.Quantity AS AvailableQty,
      T0.ExpDate AS ExpiryDate
    FROM OIBT T0
    WHERE T0.ItemCode = @itemCode
      AND T0.WhsCode = @whsCode
      AND T0.Quantity > 0
    ORDER BY T0.ExpDate
  `, { itemCode, whsCode }));

  return { batches: result };
};

// ── UOM CONVERSION ────────────────────────────────────────────────────────────

const getUomConversionFactor = async (itemCode, uomCode) => {
  const result = await safe(db.query(`
    SELECT 
      T0.ItemCode,
      T0.InvntryUom AS InventoryUOM,
      T0.UgpEntry AS UoMGroupEntry,
      T0.SUoMEntry AS SalesUomEntry,
      T0.SalUnitMsr AS SalesUnit,
      T2.BaseQty,
      T2.AltQty,
      T3.UomCode
    FROM OITM T0
    LEFT JOIN OUGP T1 ON T0.UgpEntry = T1.UgpEntry
    LEFT JOIN UGP1 T2 ON T1.UgpEntry = T2.UgpEntry
    LEFT JOIN OUOM T3 ON T2.UomEntry = T3.UomEntry
    WHERE T0.ItemCode = @itemCode
      AND T3.UomCode = @uomCode
  `, { itemCode, uomCode }));

  if (result.length > 0) {
    const row = result[0];
    const baseQty = parseFloat(row.BaseQty || 1);
    const altQty = parseFloat(row.AltQty || 1);
    const factor = baseQty > 0 ? altQty / baseQty : 1;
    
    return {
      inventoryUOM: row.InventoryUOM,
      uomCode: row.UomCode,
      baseQty,
      altQty,
      factor
    };
  }

  // If not found in UoM Group, check if the UoM code itself is numeric
  const numericFactor = parseFloat(uomCode);
  if (!isNaN(numericFactor) && numericFactor > 0) {
    const itemResult = await safe(db.query(`
      SELECT InvntryUom AS InventoryUOM
      FROM OITM
      WHERE ItemCode = @itemCode
    `, { itemCode }));
    
    const inventoryUOM = itemResult.length > 0 ? itemResult[0].InventoryUOM : '';
    
    return {
      inventoryUOM,
      uomCode: uomCode,
      baseQty: 1,
      altQty: numericFactor,
      factor: numericFactor
    };
  }

  return {
    inventoryUOM: '',
    uomCode: uomCode,
    baseQty: 1,
    altQty: 1,
    factor: 1
  };
};

// ── MAIN REFERENCE DATA FUNCTION ──────────────────────────────────────────────

const AR_CREDIT_MEMO_FORM_ID = '179';
const AR_CREDIT_MEMO_MATRIX_ITEM_ID = '38';
const AR_CREDIT_MEMO_SUPPRESSED_ROW_UDFS = new Set([
  'APIVDOCKEY',
  'APIVDOCNUM',
  'APIVLINENUM',
  'APINVDOCKEY',
  'APINVDOCNUM',
  'APINVLINENUM',
]);

const AR_CREDIT_MEMO_MATRIX_COLUMN_DEFS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160, sapField: 'ItemCode', sapColumnIds: ['1', 'ItemCode', 'Item No.', 'ItemNo'] },
  { key: 'itemDescription', label: 'Item Description', minWidth: 220, sapField: 'Dscription', sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Item Description'] },
  { key: 'quantity', label: 'Qty', minWidth: 80, sapField: 'Quantity', sapColumnIds: ['11', 'Quantity', 'Qty'] },
  { key: 'noOfPackages', label: 'No. of Packages', minWidth: 120, sapField: 'PackQty', alternativeFields: ['Packages', 'NumOfPacks'], sapColumnIds: ['13', 'PackQty', 'Packages', 'No. of Packages', 'NumOfPacks'] },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 95, sapField: 'Price', alternativeFields: ['PriceBefDi'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'UnitPrice', 'Unit Price'] },
  { key: 'stdDiscount', label: 'Disc%', minWidth: 85, sapField: 'DiscPrcnt', sapColumnIds: ['15', 'DiscPrcnt', 'DiscountPercent', 'Discount %', 'Disc%'] },
  { key: 'taxCode', label: 'Tax Code', minWidth: 115, sapField: 'TaxCode', sapColumnIds: ['234000377', '160', 'TaxCode', 'Tax Code'] },
  { key: 'wTaxLiable', label: 'WTax Liable', minWidth: 100, sapField: 'WtLiable', type: 'yesNo', sapColumnIds: ['18', 'WTLiable', 'WtLiable', 'WTax Liable'] },
  { key: 'totalLC', label: 'Total (LC)', minWidth: 110, sapField: 'LineTotal', calculated: true, sapColumnIds: ['160', '17', 'GTotal', 'Total', 'Total (LC)', 'LineTotal'] },
  { key: 'whse', label: 'Whse', minWidth: 90, sapField: 'WhsCode', sapColumnIds: ['174', 'WhsCode', 'Warehouse', 'Whse'] },
  { key: 'glAccount', label: 'G/L Account', minWidth: 135, sapField: 'AcctCode', sapColumnIds: ['234001512', 'AcctCode', 'G/L Account', 'GLAccount'] },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 105, sapField: 'OcrCode', sapColumnIds: ['21', 'OcrCode', 'Distr. Rule', 'DistributionRule'] },
  { key: 'taxLiable', label: 'Tax Liable', minWidth: 95, sapField: 'TaxOnly', type: 'checkbox', sapColumnIds: ['22', 'TaxOnly', 'Tax Liable'] },
  { key: 'weight', label: 'Weight', minWidth: 95, sapField: 'Weight1', alternativeFields: ['Weight'], sapColumnIds: ['23', 'Weight1', 'Weight'] },
  { key: 'taxAmount', label: 'Tax Amount (LC)', minWidth: 125, sapField: 'VatSum', calculated: true, sapColumnIds: ['24', 'VatSum', 'Tax Amount (LC)'] },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105, sapField: 'UomCode', alternativeFields: ['UomEntry'], sapColumnIds: ['1470002149', 'UomCode', 'UoMCode', 'UoM Code'] },
  { key: 'uomName', label: 'UoM Name', minWidth: 120, sapField: 'unitMsr', alternativeFields: [], sapColumnIds: ['1470002145', 'unitMsr', 'UoM Name'] },
  { key: 'cogsDistRule', label: 'COGS Distr. Rule', minWidth: 135, sapField: 'CogsOcrCod', sapColumnIds: ['29', 'CogsOcrCod', 'COGS Distr. Rule'] },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 185, sapField: 'CountryOrg', sapColumnIds: ['10002037', 'CountryOrg', 'Country/Region of Origin'] },
  { key: 'loc', label: 'Loc.', source: 'branch', sapColumnIds: ['10002047', 'LocCode', 'Location', 'LOC', 'Loc.'], minWidth: 115 },
  { key: 'branch', label: 'Branch', source: 'branch', sapColumnIds: ['BPLId', 'Branch'], minWidth: 115 },
  { key: 'enableSettingCost', label: 'Enable Setting Cost', minWidth: 140, sapField: 'EnSetCost', alternativeFields: ['EnableSetCost'], type: 'checkbox', sapColumnIds: ['110000310', 'EnSetCost', 'Enable Setting Cost'] },
  { key: 'returnCost', label: 'Return Cost (LC)', minWidth: 125, sapField: 'RetCost', alternativeFields: ['ReturnCost'], sapColumnIds: ['1003', 'RetCost', 'Return Cost (LC)'] },
  { key: 'blanketAgreementNo', label: 'Blanket Agreement No.', minWidth: 170, sapField: 'AgrNo', alternativeFields: ['AgrLineNum'], sapColumnIds: ['1000', 'AgrNo', 'Blanket Agreement No.'] },
  { key: 'hsnCode', label: 'HSN', minWidth: 115, sapField: 'HsnEntry', sapColumnIds: ['254000391', 'HsnEntry', 'HSN', 'HSN/SAC'] },
  { key: 'sacCode', label: 'SAC', minWidth: 95, sapField: 'SacEntry', sapColumnIds: ['254000393', 'SacEntry', 'SAC'] },
];

const truthySapFlag = (value) => ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value ?? '').trim().toUpperCase());
const falsySapFlag = (value) => ['N', 'NO', 'FALSE', '0', 'TNO'].includes(String(value ?? '').trim().toUpperCase());
const sapFlagToBoolean = (value, fallback = true) => {
  if (truthySapFlag(value)) return true;
  if (falsySapFlag(value)) return false;
  return fallback;
};
const normalizePreferenceKey = (value) => String(value || '').trim().toUpperCase().replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');

const resolveSapUserSign = async () => {
  let sapUsername = '';
  try {
    const { getActiveCompanyConfig } = require('./companyConfigService');
    const company = await getActiveCompanyConfig();
    const requestAuth = getRequestContext()?.req?.auth || {};
    const applicationUser = requestAuth.username
      ? { Username: requestAuth.username }
      : Number.isInteger(Number(requestAuth.userId))
        ? await authDbService.queryOne(`
            SELECT Username
            FROM Users
            WHERE UserId = @userId
          `, { userId: Number(requestAuth.userId) })
        : null;
    sapUsername = String(
      company?.userMapping?.sapUserCode
      || applicationUser?.Username
      || company?.serviceLayer?.username
      || '',
    ).trim();
  } catch (_error) {
    sapUsername = '';
  }
  if (!sapUsername) return null;

  const rows = await safe(db.query(`
    SELECT TOP 1 USERID
    FROM OUSR
    WHERE USER_CODE = @sapUsername
       OR U_NAME = @sapUsername
    ORDER BY CASE WHEN USER_CODE = @sapUsername THEN 0 ELSE 1 END, USERID
  `, { sapUsername }));

  const userSign = Number(rows[0]?.USERID);
  return Number.isFinite(userSign) ? userSign : null;
};

const getARCreditMemoColumnPreferences = async () => {
  let cprfColumnDetails;
  try {
    cprfColumnDetails = await getTableColumnDetails('CPRF');
  } catch (_error) {
    cprfColumnDetails = [];
  }
  if (!cprfColumnDetails.length) return { byKey: {}, rows: [], userSign: null };

  const columnSet = new Set(cprfColumnDetails.map((col) => String(col.columnName || '').trim()));
  const hasItemUid = columnSet.has('ItemUID');
  const hasTableName = columnSet.has('TableName');
  const hasCaption = columnSet.has('Caption');
  const hasTitle = columnSet.has('Title');
  const hasDescr = columnSet.has('Descr');
  const hasColAlias = columnSet.has('ColAlias');
  const userSign = await resolveSapUserSign();
  if (userSign == null) return { byKey: {}, rows: [], userSign: null };

  let rows = await safe(db.query(`
    SELECT
      FormID, ItemID, ColID, Width, VisInForm, VisualIndx, EditInForm,
      VisInExpnd, ExpandIndx, EditInEXP, UserSign, TPLId
      ${hasTableName ? ', TableName' : ", '' AS TableName"}
      ${hasItemUid ? ', ItemUID' : ", '' AS ItemUID"}
      ${hasCaption ? ', Caption' : ", '' AS Caption"}
      ${hasTitle ? ', Title' : ", '' AS Title"}
      ${hasDescr ? ', Descr' : ", '' AS Descr"}
      ${hasColAlias ? ', ColAlias' : ", '' AS ColAlias"}
    FROM CPRF
    WHERE FormID = @formId
      AND (
        ItemID = @itemId
        ${hasItemUid ? 'OR ItemUID = @itemId' : ''}
      )
      AND UserSign = @userSign
    ORDER BY CASE WHEN TPLId = 0 THEN 0 ELSE 1 END, VisualIndx, ColID
  `, {
    formId: AR_CREDIT_MEMO_FORM_ID,
    itemId: AR_CREDIT_MEMO_MATRIX_ITEM_ID,
    userSign,
  }));

  if (!rows.length && hasTableName) {
    rows = await safe(db.query(`
      SELECT
        FormID, ItemID, ColID, Width, VisInForm, VisualIndx, EditInForm,
        VisInExpnd, ExpandIndx, EditInEXP, UserSign, TPLId,
        TableName
        ${hasItemUid ? ', ItemUID' : ", '' AS ItemUID"}
        ${hasCaption ? ', Caption' : ", '' AS Caption"}
        ${hasTitle ? ', Title' : ", '' AS Title"}
        ${hasDescr ? ', Descr' : ", '' AS Descr"}
        ${hasColAlias ? ', ColAlias' : ", '' AS ColAlias"}
      FROM CPRF
      WHERE FormID = @formId
        AND TableName = @tableName
        AND UserSign = @userSign
      ORDER BY CASE WHEN TPLId = 0 THEN 0 ELSE 1 END, VisualIndx, ColID
    `, {
      formId: AR_CREDIT_MEMO_FORM_ID,
      tableName: 'RIN1',
      userSign,
    }));
  }

  rows = selectEffectiveCprfRows(rows);

  const byKey = rows.reduce((acc, row) => {
    [row.ColID, row.TableName, row.ItemUID, row.Caption, row.Title, row.Descr, row.ColAlias]
      .map(normalizePreferenceKey).filter(Boolean).forEach((key) => {
        if (!acc[key]) acc[key] = row;
      });
    return acc;
  }, {});

  return { byKey, rows, userSign };
};

const getARCreditMemoLineTableColumns = async () => {
  try {
    const columnDetails = await getTableColumnDetails('RIN1');
    if (!columnDetails.length) return {};

    return columnDetails.reduce((acc, col) => {
      const columnName = String(col.columnName || '').trim();
      if (!columnName) return acc;
      acc[columnName.toUpperCase()] = {
        name: columnName,
        dataType: String(col.dataType || '').trim().toLowerCase(),
        maxLength: col.maxLength ?? null,
        precision: col.numericPrecision ?? null,
        scale: col.numericScale ?? null,
        nullable: Boolean(col.nullable),
        ordinal: col.ordinal || 0,
      };
      return acc;
    }, {});
  } catch (error) {
    console.warn('[AR Credit Memo DB] getARCreditMemoLineTableColumns failed:', error.message);
    return {};
  }
};

const findColumnPreference = (column, preferences = {}) => {
  const candidates = [
    ...(column.sapColumnIds || []),
    column.sapField,
    ...(column.alternativeFields || []),
    column.key,
  ].map(normalizePreferenceKey).filter(Boolean);

  for (const candidate of candidates) {
    if (preferences[candidate]) return preferences[candidate];
  }
  return null;
};

const getColumnMetadata = (column, lineColumns = {}) => {
  const candidates = [column.sapField, ...(column.alternativeFields || [])].filter(Boolean);
  for (const candidate of candidates) {
    const metadata = lineColumns[String(candidate).toUpperCase()];
    if (metadata) return metadata;
  }
  return null;
};

const getARCreditMemoLineFieldMetadata = async () => {
  const [lineColumns, preferencesResult] = await Promise.all([
    getARCreditMemoLineTableColumns(),
    getARCreditMemoColumnPreferences(),
  ]);
  const hasPreferences = preferencesResult.rows.length > 0;

  const matrixColumns = AR_CREDIT_MEMO_MATRIX_COLUMN_DEFS
    .map((column, index) => {
      const metadata = getColumnMetadata(column, lineColumns);
      const exists = Boolean(metadata || column.calculated || column.source);
      if (!exists) return null;

      const preference = findColumnPreference(column, preferencesResult.byKey);
      const visible = preference ? sapFlagToBoolean(preference.VisInForm, true) : true;
      const active = preference ? sapFlagToBoolean(preference.EditInForm, true) : true;
      const width = Number(preference?.Width);

      return {
        key: column.key,
        label: column.label,
        sapField: column.sapField || '',
        source: column.source || (column.calculated ? 'calculated' : 'RIN1'),
        dataType: metadata?.dataType || '',
        maxLength: metadata?.maxLength || undefined,
        precision: metadata?.precision || undefined,
        scale: metadata?.scale || undefined,
        required: metadata ? !metadata.nullable : false,
        readOnly: Boolean(column.calculated),
        visible,
        active,
        minWidth: Number.isFinite(width) && width > 0 ? Math.max(width, column.minWidth || 125) : (column.minWidth || 125),
        order: Number.isFinite(Number(preference?.VisualIndx)) ? Number(preference.VisualIndx) : index + 1,
        sapColumnId: preference?.ColID || '',
      };
    })
    .filter(Boolean)
    .sort((left, right) => (left.order || 0) - (right.order || 0));

  return {
    matrix_columns: matrixColumns,
    sap_form: {
      formId: AR_CREDIT_MEMO_FORM_ID,
      matrixItemId: AR_CREDIT_MEMO_MATRIX_ITEM_ID,
      userSign: preferencesResult.userSign,
      preferenceRows: preferencesResult.rows.length,
    },
    _preferencesByKey: preferencesResult.byKey,
  };
};

const applyLineColumnPreferencesToUdfs = (udfMetadata = {}, preferences = {}) => {
  const hasPreferences = Object.keys(preferences || {}).length > 0;
  const rows = (udfMetadata.rows || []).map((field) => {
    const normalizedFieldKeys = [
      field.key,
      field.sapField,
      field.aliasId,
      field.label,
    ].map(normalizePreferenceKey).filter(Boolean);
    if (normalizedFieldKeys.some((key) => AR_CREDIT_MEMO_SUPPRESSED_ROW_UDFS.has(key))) {
      return null;
    }

    const preference = findColumnPreference({
      key: field.key,
      sapField: field.sapField,
      sapColumnIds: [field.key, field.aliasId, field.label],
    }, preferences);

    if (!preference) return field;

    return {
      ...field,
      visible: sapFlagToBoolean(preference.VisInForm, true),
      active: sapFlagToBoolean(preference.EditInForm, true),
      minWidth: Number(preference.Width) > 0 ? Number(preference.Width) : field.minWidth,
      order: Number(preference.VisualIndx) || field.order,
      sapColumnId: preference.ColID || field.sapColumnId,
    };
  }).filter(Boolean).sort((left, right) => (left.order || 99999) - (right.order || 99999));

  return { ...udfMetadata, rows };
};

const getReferenceData = async () => {
  const [
    customers,
    items,
    warehouses,
    paymentTerms,
    shippingTypes,
    salesEmployees,
    branches,
    states,
    taxCodes,
    uomGroupsRaw,
    decimalRows,
    companyRows,
    accounts,
    distributionRules,
    udfMetadata,
    lineFieldMetadata,
  ] = await Promise.all([
    getCustomers(),
    getItems(),
    getWarehouses(),
    getPaymentTerms(),
    getShippingTypes(),
    getSalesEmployees(),
    getBranches(),
    getStates(),
    getTaxCodes(),
    getUomGroups(),
    getDecimalSettings(),
    getCompanyInfo(),
    masterDataDbService.searchAccounts('', '', 5000, 0),
    masterDataDbService.lookupDistributionRules(),
    getMarketingDocumentUdfs({ headerTable: 'ORIN', lineTable: 'RIN1' }),
    getARCreditMemoLineFieldMetadata(),
  ]);
  const effectiveUdfMetadata = applyLineColumnPreferencesToUdfs(
    udfMetadata,
    lineFieldMetadata._preferencesByKey || {},
  );

  const uom_groups = uomGroupsRaw;

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
  } : {
    name: 'SAP B1',
    address: '',
    state: '',
  };

  return {
    company: companyInfo.name,
    company_state: companyInfo.state,
    vendors: customers,
    customers,
    contacts: [],
    pay_to_addresses: [],
    items,
    warehouses,
    warehouse_addresses: warehouses,
    company_address: { State: companyInfo.state },
    tax_codes: taxCodes,
    payment_terms: paymentTerms,
    shipping_types: shippingTypes,
    sales_employees: salesEmployees.map(e => ({
      SlpCode: e.SlpCode,
      SlpName: e.SlpName,
      Memo: e.Memo || '',
      Commission: e.Commission,
      Active: e.Active,
    })),
    branches,
    states,
    gl_accounts: accounts
      .filter((account) => account.ActiveAccount !== 'tNO' && account.IsTitleAccount !== 'tYES')
      .map((account) => ({
        code: account.Code,
        name: account.Name,
        accountType: account.AccountType,
        balance: account.Balance ?? 0,
        inactive: account.ActiveAccount === 'tNO' ? 'Yes' : 'No',
      })),
    distribution_rules: distributionRules.map((rule) => ({
      FactorCode: rule.FactorCode || rule.OcrCode || '',
      FactorDescription: rule.FactorDescription || rule.OcrName || '',
    })),
    uom_groups,
    decimal_settings: decimalSettings,
    matrix_columns: lineFieldMetadata.matrix_columns || [],
    line_field_metadata: {
      matrix_columns: lineFieldMetadata.matrix_columns || [],
      sap_form: lineFieldMetadata.sap_form || {},
    },
    udf_metadata: effectiveUdfMetadata,
    warnings: [],
  };
};

const getCustomerDetails = async (customerCode) => {
  if (!customerCode) {
    return {
      contacts: [],
      pay_to_addresses: [],
      ship_to_addresses: [],
      bill_to_addresses: [],
    };
  }

  const [contacts, addresses] = await Promise.all([
    getContactsByCustomer(customerCode),
    getAddressesByCustomer(customerCode),
  ]);

  const payToAddresses = addresses.filter(a => 
    a.AdresType === 'B' || a.AdresType === 'bo_BillTo'
  );
  const shipToAddresses = addresses.filter(a =>
    a.AdresType === 'S' || a.AdresType === 'bo_ShipTo'
  );

  return {
    contacts,
    pay_to_addresses: payToAddresses,
    bill_to_addresses: payToAddresses,
    ship_to_addresses: shipToAddresses,
  };
};

// ── COPY FROM FUNCTIONS ───────────────────────────────────────────────────────

// ── COPY FROM FUNCTIONS ───────────────────────────────────────────────────────

const getOpenDeliveries = () => safe(db.query(`
  SELECT TOP 200
    T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate,
    T0.CardCode, T0.CardName, T0.Comments, T0.DocTotal
  FROM ODLN T0
  WHERE T0.DocStatus = 'O' AND T0.CANCELED <> 'Y'
  ORDER BY T0.DocDate DESC, T0.DocNum DESC
`));

const getDeliveryForCopy = async (docEntry) => deliveryDb.getDeliveryForCopy(docEntry);

// A/R invoice copy helpers used by the A/R Credit Memo Copy From flow.
const getOpenARInvoices = (customerCode = null) => {
  const params = customerCode ? { customerCode } : {};
  const query = `
    SELECT TOP 200
    T0.DocEntry,
    T0.DocNum,
    T0.DocDate,
    T0.DocDueDate,
    T0.CardCode,
    T0.CardName,
    T0.Comments,
    T0.DocTotal
FROM OINV T0
WHERE 
    T0.DocStatus = 'O'        -- Open invoices
    AND T0.CANCELED = 'N'     -- Not canceled
    ${customerCode ? "AND T0.CardCode = @customerCode" : ""}
ORDER BY 
    T0.DocDate DESC,
    T0.DocNum DESC;
  `;
  return safe(db.query(query, params));
};

const getARInvoiceForCopy = async (docEntry) => arInvoiceDb.getARInvoiceForCopy(docEntry);

const getARCreditMemoForCopy = async (docEntry) => {
  const result = await getARCreditMemo(docEntry);
  const creditMemo = result?.ar_credit_memo || {};
  const header = creditMemo.header || {};

  return {
    DocEntry: creditMemo.doc_entry || docEntry,
    DocNum: creditMemo.doc_num || header.docNo || '',
    DocDate: header.postingDate || '',
    DocDueDate: header.deliveryDate || '',
    TaxDate: header.documentDate || '',
    CardCode: header.customerCode || header.customer || '',
    CardName: header.customerName || header.name || '',
    CntctCode: header.contactPerson || '',
    NumAtCard: header.salesContractNo || '',
    Comments: header.otherInstruction || '',
    BPLId: header.branch || '',
    BPL_IDAssignedToInvoice: header.branch || '',
    GroupNum: header.paymentTermsCode || header.paymentTerms || '',
    DocCur: header.currency || '',
    DocRate: header.exchangeRate || '',
    DiscPrcnt: header.discount || 0,
    Freight: header.freight || 0,
    DocumentLines: (creditMemo.lines || []).map((line, index) => ({
      LineNum: line.lineNum ?? line.LineNum ?? index,
      ItemCode: line.itemNo || '',
      ItemDescription: line.itemDescription || '',
      Quantity: line.quantity || 0,
      OpenQty: line.quantity || 0,
      UnitPrice: line.unitPrice || 0,
      DiscountPercent: line.stdDiscount || line.discountPercent || 0,
      WarehouseCode: line.whse || line.warehouse || '',
      TaxCode: line.taxCode || '',
      UomCode: line.uomCode || '',
      UomName: line.uomName || line.uomCode || '',
      HSNCode: line.hsnCode || '',
      BaseEntry: creditMemo.doc_entry || docEntry,
      BaseLine: line.lineNum ?? line.LineNum ?? index,
      BaseType: 14,
    })),
  };
};

const getOpenSalesOrders = () => safe(db.query(`
  
`));

const getSalesOrderForCopy = async (docEntry) => salesOrderDb.getSalesOrderForCopy(docEntry);

const getOpenReturns = (customerCode = null) => {
  const query = `
    // SELECT TOP 200
    //   T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate,
    //   T0.CardCode, T0.CardName, T0.Comments, T0.DocTotal
    // FROM ORIN T0
    // WHERE T0.DocStatus = 'O' AND T0.CANCELED <> 'Y'
    //   ${customerCode ? "AND T0.CardCode = @customerCode" : ""}
    // ORDER BY T0.DocDate DESC, T0.DocNum DESC
  `;
  return safe(db.query(query, customerCode ? { customerCode } : {}));
};

const getReturnForCopy = async (docEntry) => safe(db.query(`
  SELECT 
    T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate, T0.TaxDate,
    T0.CardCode, T0.CardName, T0.CntctCode AS ContactPerson,
    T0.NumAtCard AS CustomerRefNo, T0.DocCur AS Currency,
    T0.DocRate AS ExchangeRate, T0.Comments,
    T0.SalesPersonCode, T0.GroupNum AS PaymentTerms,
    T0.DiscPrcnt AS DiscountPercent, T0.DiscSum AS DiscountTotal,
    T0.VatSum AS TaxTotal, T0.DocTotal,
    T0.BPLId AS Branch, T0.IndicatorCode AS PlaceOfSupply,
    T1.LineNum, T1.ItemCode, T1.Dscription AS ItemDescription,
    T1.Quantity, ${await getDocumentUnitPriceSql(db, 'RIN1', 'T1')} AS UnitPrice, T1.Currency AS LineCurrency,
    T1.Rate AS LineRate, T1.DiscPrcnt AS LineDiscountPercent,
    T1.LineTotal, T1.TaxCode, T1.VatPrcnt AS TaxRate,
    T1.VatSum AS LineTaxAmount, T1.GTotal AS LineGrossTotal,
    T1.WhsCode AS WarehouseCode, T1.UomCode,
    T1.U_HSNCode AS HSNCode
  FROM ORIN T0
  LEFT JOIN RIN1 T1 ON T0.DocEntry = T1.DocEntry
  WHERE T0.DocEntry = @docEntry
  ORDER BY T1.LineNum
`, { docEntry }));

const getOpenReturnRequests = (customerCode = null) => {
  const query = `
    SELECT TOP 200
      T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate,
      T0.CardCode, T0.CardName, T0.Comments, T0.DocTotal
    FROM ORDN T0
    WHERE T0.DocStatus = 'O' AND T0.CANCELED <> 'Y'
      ${customerCode ? "AND T0.CardCode = @customerCode" : ""}
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
  `;
  return safe(db.query(query, customerCode ? { customerCode } : {}));
};

const getReturnRequestForCopy = async (docEntry) => safe(db.query(`
  SELECT 
    T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate, T0.TaxDate,
    T0.CardCode, T0.CardName, T0.CntctCode AS ContactPerson,
    T0.NumAtCard AS CustomerRefNo, T0.DocCur AS Currency,
    T0.DocRate AS ExchangeRate, T0.Comments,
    T0.SalesPersonCode, T0.GroupNum AS PaymentTerms,
    T0.DiscPrcnt AS DiscountPercent, T0.DiscSum AS DiscountTotal,
    T0.VatSum AS TaxTotal, T0.DocTotal,
    T0.BPLId AS Branch, T0.IndicatorCode AS PlaceOfSupply,
    T1.LineNum, T1.ItemCode, T1.Dscription AS ItemDescription,
    T1.Quantity, ${await getDocumentUnitPriceSql(db, 'RDN1', 'T1')} AS UnitPrice, T1.Currency AS LineCurrency,
    T1.Rate AS LineRate, T1.DiscPrcnt AS LineDiscountPercent,
    T1.LineTotal, T1.TaxCode, T1.VatPrcnt AS TaxRate,
    T1.VatSum AS LineTaxAmount, T1.GTotal AS LineGrossTotal,
    T1.WhsCode AS WarehouseCode, T1.UomCode,
    T1.U_HSNCode AS HSNCode
  FROM ORDN T0
  LEFT JOIN RDN1 T1 ON T0.DocEntry = T1.DocEntry
  WHERE T0.DocEntry = @docEntry
  ORDER BY T1.LineNum
`, { docEntry }));

const getOpenDownPayments = (customerCode = null) => {
  const query = `
    SELECT TOP 200
      T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate,
      T0.CardCode, T0.CardName, T0.Comments, T0.DocTotal
    FROM ODPI T0
    WHERE T0.DocStatus = 'O' AND T0.CANCELED <> 'Y'
      ${customerCode ? "AND T0.CardCode = @customerCode" : ""}
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
  `;
  return safe(db.query(query, customerCode ? { customerCode } : {}));
};

const getDownPaymentForCopy = async (docEntry) => safe(db.query(`
  SELECT 
    T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate, T0.TaxDate,
    T0.CardCode, T0.CardName, T0.CntctCode AS ContactPerson,
    T0.NumAtCard AS CustomerRefNo, T0.DocCur AS Currency,
    T0.DocRate AS ExchangeRate, T0.Comments,
    T0.SalesPersonCode, T0.GroupNum AS PaymentTerms,
    T0.DiscPrcnt AS DiscountPercent, T0.DiscSum AS DiscountTotal,
    T0.VatSum AS TaxTotal, T0.DocTotal,
    T0.BPLId AS Branch, T0.IndicatorCode AS PlaceOfSupply,
    T1.LineNum, T1.ItemCode, T1.Dscription AS ItemDescription,
    T1.Quantity, ${await getDocumentUnitPriceSql(db, 'DPI1', 'T1')} AS UnitPrice, T1.Currency AS LineCurrency,
    T1.Rate AS LineRate, T1.DiscPrcnt AS LineDiscountPercent,
    T1.LineTotal, T1.TaxCode, T1.VatPrcnt AS TaxRate,
    T1.VatSum AS LineTaxAmount, T1.GTotal AS LineGrossTotal,
    T1.WhsCode AS WarehouseCode, T1.UomCode,
    T1.U_HSNCode AS HSNCode
  FROM ODPI T0
  LEFT JOIN DPI1 T1 ON T0.DocEntry = T1.DocEntry
  WHERE T0.DocEntry = @docEntry
  ORDER BY T1.LineNum
`, { docEntry }));

module.exports = {
  getARCreditMemoHeaderTableFieldMetadata,
  getARCreditMemoLineTableFieldMetadata,
  getReferenceData,
  getCustomerDetails,
  getARCreditMemoList,
  getARCreditMemo,
  getDocumentSeries,
  getNextNumber,
  getStateFromAddress,
  getWarehouseState,
  getWarehouseBranch,
  getFreightCharges,
  getItemsForModal,
  getBatchesByItem,
  getUomConversionFactor,
  // getOpenDeliveries,
  // getDeliveryForCopy,
  getOpenARInvoices,
  getARInvoiceForCopy,
  getARCreditMemoForCopy,
  // getOpenSalesOrders,
  // getSalesOrderForCopy,
  // getOpenReturns,
  // getReturnForCopy,
  // getOpenReturnRequests,
  // getReturnRequestForCopy,
  // getOpenDownPayments,
  // getDownPaymentForCopy,
};
