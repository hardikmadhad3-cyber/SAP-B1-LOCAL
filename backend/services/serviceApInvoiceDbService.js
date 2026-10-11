const db = require('./dbService');
const { createTableColumnDetailsReader } = require('./salesDocumentDbCompatibility');
const apInvoiceDb = require('./apInvoiceDbService');
const masterDataDbService = require('./masterDataDbService');
const { getServiceDocumentAccounts } = require('./serviceDocumentAccountDbService');
const hsnCodeDbService = require('./hsnCodeDbService');
const { getHeaderUdfValues, getLineUdfValues, getMarketingDocumentUdfs } = require('./udfMetadataService');
const { selectSapEligibleSeries } = require('./documentSeriesDbUtils');

const safe = async (promise) => {
  try {
    const result = await promise;
    return result.recordset || [];
  } catch (error) {
    console.error('[Service AP Invoice DB] Query error:', error.message);
    return [];
  }
};

const readTableColumnDetails = createTableColumnDetailsReader({ database: db });

const getTableColumns = async (tableName) => {
  const rows = await readTableColumnDetails(tableName);

  return new Map(rows
    .map((row) => String(row.columnName || '').trim())
    .filter(Boolean)
    .map((columnName) => [columnName.toUpperCase(), columnName]));
};

const getColumnName = (columns, columnName) => (
  columns.get(String(columnName || '').trim().toUpperCase()) || ''
);

const hasColumn = (columns, columnName) => Boolean(getColumnName(columns, columnName));

const optionalColumn = (columns, tableAlias, columnName, alias, fallback = 'NULL') => {
  const actualColumnName = getColumnName(columns, columnName);
  return actualColumnName
    ? `${tableAlias}.${actualColumnName} AS ${alias}`
    : `${fallback} AS ${alias}`;
};

const queryRowsWithFallback = async ({ primarySql, fallbackSql, params = {}, label }) => {
  try {
    const result = await db.query(primarySql, params);
    return result.recordset || [];
  } catch (error) {
    console.error(`[Service AP Invoice DB] ${label} query error:`, error.message);
  }

  try {
    const fallbackResult = await db.query(fallbackSql, params);
    return fallbackResult.recordset || [];
  } catch (fallbackError) {
    console.error(`[Service AP Invoice DB] ${label} fallback query error:`, fallbackError.message);
    return [];
  }
};

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatDate = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).split('T')[0] : date.toISOString().split('T')[0];
};

const normalizeSeriesText = (value) =>
  String(value || '').toUpperCase().replace(/FY/g, '').replace(/[^A-Z0-9]/g, '');

const resolveSeriesDocSubType = (transactionType = '') => {
  const normalizedType = normalizeSeriesText(transactionType);
  if (normalizedType.includes('GSTDEBITMEMO') || normalizedType.includes('DEBITMEMO')) return 'GD';
  if (normalizedType.includes('GSTTAXINVOICE') || normalizedType.includes('TAXINVOICE')) return 'GA';
  if (normalizedType.includes('BILLOFSUPPLY')) return '--';
  return '';
};

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
  const rows = Array.isArray(series) ? series.filter(Boolean) : [];
  if (rows.length <= 1) return rows;

  const nonManualRows = rows.filter((row) => Number(row.Series) !== -1 && String(row.SeriesName || '').trim().toUpperCase() !== 'MANUAL');
  const candidates = nonManualRows.length ? nonManualRows : rows;
  const defaultRows = candidates.filter((row) => row.IsDefault || row.isDefault);
  if (defaultRows.length) return [defaultRows[0]];

  return [candidates[0]];
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

const lookupServiceItems = async () => {
  const rowsWithWTax = await safe(db.query(`
    SELECT
      ItemCode,
      ItemName,
      OnHand,
      WTLiable
    FROM OITM
    WHERE PrchseItem = 'Y'
      AND validFor <> 'N'
    ORDER BY ItemCode
  `));

  const rows = rowsWithWTax.length ? rowsWithWTax : await safe(db.query(`
    SELECT
      ItemCode,
      ItemName,
      OnHand,
      NULL AS WTLiable
    FROM OITM
    WHERE PrchseItem = 'Y'
      AND validFor <> 'N'
    ORDER BY ItemCode
  `));

  return rows.map((row) => ({
    ItemCode: row.ItemCode || '',
    ItemName: row.ItemName || '',
    InStock: row.OnHand ?? 0,
    WTaxLiable: ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(row.WTLiable || '').trim().toUpperCase()) ? 'Yes' : 'No',
  }));
};

const getReferenceData = async () => {
  const [base, accounts, distributionRules, withholdingTaxCodes, sacCodes, locations, businessPartners, serviceItems] = await Promise.all([
    apInvoiceDb.getReferenceData(),
    getServiceDocumentAccounts(),
    masterDataDbService.lookupDistributionRules(),
    masterDataDbService.lookupWithholdingTaxCodes('', 200),
    hsnCodeDbService.getSACCodes('', 5000, 0),
    masterDataDbService.lookupWarehouseLocations(),
    masterDataDbService.searchBP('', '', 5000, 0),
    lookupServiceItems(),
  ]);

  return {
    ...base,
    items: serviceItems,
    locations,
    business_partners: businessPartners,
    gl_accounts: accounts,
    distribution_rules: distributionRules,
    withholding_tax_codes: withholdingTaxCodes,
    sac_codes: sacCodes.map((sac) => ({
      code: sac.code || '',
      serviceCode: sac.code || '',
      serviceName: sac.serviceName || sac.description || sac.name || '',
      description: sac.serviceName || sac.description || sac.name || '',
      heading: sac.heading || '',
      subHeading: sac.subHeading || '',
    })),
    quality_options: base.quality_options || { buyer: [], seller: [] },
    price_options: base.price_options || { buyer: [], seller: [] },
  };
};

const getServiceAPInvoiceList = async ({
  query = '',
  docNum = '',
  vendorCode = '',
  vendorName = '',
  status = '',
  postingDateFrom = '',
  postingDateTo = '',
  page = 1,
  pageSize = 25,
} = {}) => {
  const limit = Math.max(1, Math.min(toInt(pageSize, 25), 100));
  const currentPage = Math.max(1, toInt(page, 1));
  const offset = (currentPage - 1) * limit;
  const filters = [];
  const params = {
    query: String(query || '').trim(),
    like: `%${String(query || '').trim()}%`,
    docNum: String(docNum || '').trim(),
    vendorCode: String(vendorCode || '').trim(),
    vendorName: String(vendorName || '').trim(),
    vendorNameLike: `%${String(vendorName || '').trim()}%`,
    status: String(status || '').trim(),
    postingDateFrom: String(postingDateFrom || '').trim(),
    postingDateTo: String(postingDateTo || '').trim(),
    offset,
    limit,
  };

  filters.push("T0.DocType = 'S'");
  filters.push("ISNULL(T0.CANCELED, 'N') <> 'Y'");
  if (params.query) {
    filters.push(`(
      CAST(T0.DocNum AS nvarchar(50)) LIKE @like
      OR T0.CardCode LIKE @like
      OR T0.CardName LIKE @like
      OR ISNULL(T0.Comments, '') LIKE @like
    )`);
  }
  if (params.docNum) filters.push('CAST(T0.DocNum AS nvarchar(50)) LIKE @docNum');
  if (params.vendorCode) filters.push('T0.CardCode LIKE @vendorCode');
  if (params.vendorName) filters.push('T0.CardName LIKE @vendorNameLike');
  if (params.status === 'Open') filters.push("T0.DocStatus = 'O'");
  if (params.status === 'Closed') filters.push("T0.DocStatus = 'C'");
  if (params.postingDateFrom) filters.push('CAST(T0.DocDate AS date) >= CAST(@postingDateFrom AS date)');
  if (params.postingDateTo) filters.push('CAST(T0.DocDate AS date) <= CAST(@postingDateTo AS date)');

  const where = filters.length ? `WHERE ${filters.join('\n AND ')}` : '';
  const countRows = await safe(db.query(`
    SELECT COUNT(1) AS TotalCount
    FROM OPCH T0
    ${where}
  `, params));

  const rows = await safe(db.query(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.DocDate,
      T0.DocDueDate,
      T0.DocTotal,
      CASE T0.DocStatus WHEN 'O' THEN 'Open' WHEN 'C' THEN 'Closed' ELSE T0.DocStatus END AS Status,
      COUNT(T1.LineNum) AS LineCount
    FROM OPCH T0
    LEFT JOIN PCH1 T1 ON T1.DocEntry = T0.DocEntry
    ${where}
    GROUP BY T0.DocEntry, T0.DocNum, T0.CardCode, T0.CardName, T0.DocDate, T0.DocDueDate, T0.DocTotal, T0.DocStatus
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `, params));

  const totalCount = Number(countRows[0]?.TotalCount || 0);
  return {
    service_ap_invoices: rows.map((row) => ({
      doc_entry: row.DocEntry,
      doc_num: row.DocNum,
      vendor_code: row.CardCode || '',
      vendor_name: row.CardName || '',
      posting_date: formatDate(row.DocDate),
      delivery_date: formatDate(row.DocDueDate),
      status: row.Status || '',
      line_count: row.LineCount || 0,
      total_amount: row.DocTotal || 0,
    })),
    pagination: {
      page: currentPage,
      pageSize: limit,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    },
  };
};

const mapUdfToAliases = (udf = {}) => ({
  sac: udf.U_SAC || udf.U_SACCode || '',
  saudaNodeRef: udf.U_SaudaNodeRef || udf.U_SaudaNodhRef || '',
  costSheet: udf.U_Cost_Sheet || udf.U_CostSheet || udf.U_COSTSHEET || '',
  packingType: udf.U_PackingType || udf.U_Packing_Type || udf.U_PACKINGTYPE || '',
  containerType: udf.U_ContainerType || udf.U_Container_Type || udf.U_CONTAINERTYPE || '',
  grossWt: udf.U_GrossWt || udf.U_Gross_Wt || udf.U_GrossWeight || '',
  totalPackage: udf.U_TotalPackage || udf.U_Total_Package || '',
  taxCodeRepeat: udf.U_TAXCODE || udf.U_TaxCode || '',
  price: udf.U_PRICE || udf.U_Price || '',
  apInvDocKey: udf.U_APInvDocKey || udf.U_APInvDocEntry || '',
  apInvDocNum: udf.U_APInvDocNum || '',
  apInvLineNum: udf.U_APInvLineNum || '',
  rg23DNo: udf.U_RG23DNo || udf.U_RG23DNO || '',
  specialRebate: udf.U_SpecialRebate || '',
  commision: udf.U_Commision || udf.U_Commission || '',
  brokPerQty: udf.U_BrokPerQty || '',
  sItem: udf.U_S_Item || udf.U_SItem || '',
  sQty: udf.U_S_Qty || udf.U_SQty || '',
  sellerBrokerage: udf.U_SellerBrokerage || '',
  buyerBrokerage: udf.U_BuyerBrokerage || '',
  buyerDelivery: udf.U_BuyerDelivery || '',
  sellerDelivery: udf.U_SellerDelivery || '',
  buyerQuality: udf.U_BuyerQuality || '',
  sellerQuality: udf.U_SellerQuality || '',
  buyerPrice: udf.U_BuyerPrice || '',
  sellerPrice: udf.U_SellerPrice || '',
  buyerSpecialInstruction: udf.U_BuyerSpecialInstruction || udf.U_BuyerSplInst || '',
  sellerSpecialInstruction: udf.U_SellerSpecialInstruction || udf.U_SellerSplInst || '',
  sellerBrokerageAmtPer: udf.U_SellerBrokerageAmtPer || udf.U_SellBrkAmtPer || '',
  sellerBrokeragePercentage: udf.U_SellerBrokeragePercentage || udf.U_SellerBrkPct || '',
  buyerBillDiscount: udf.U_BuyerBillDiscount || '',
  sellerBillDiscount: udf.U_SellerBillDiscount || '',
  stcode: udf.U_STCODE || '',
  buyerTermsOfPayment: udf.U_BuyerTermsOfPayment || udf.U_BuyerPayTerms || '',
  sellerTermsOfPayment: udf.U_SellerTermsOfPayment || udf.U_SellerPayTerms || '',
  sellerTermsOfPaymentRepeat: udf.U_SellerTermsOfPayment || udf.U_SellerPayTerms || '',
  fixBrokBuyer: udf.U_Fix_Brock_B || udf.U_Fix_Brok_B || udf.U_FIX_BROK_BUYER || '',
  fixBrockSeller: udf.U_Fix_Brock_S || udf.U_Fix_Brok_S || udf.U_FIXBROCKSELLER || udf.U_FIX_BROK_SELLER || '',
  freightPurchase: udf.U_FreightPurchase || '',
  freightSales: udf.U_FreightSales || '',
  freightProvider: udf.U_FreightProvider || '',
  freightProviderName: udf.U_FreightProviderName || '',
  documentCreated: formatDate(udf.U_DocumentCreated || ''),
  brokerageNumber: udf.U_BrokerageNumber || udf.U_BrokerageNo || '',
});

const getServiceAPInvoice = async (docEntry) => {
  const headerColumns = await getTableColumns('OPCH');
  const canJoinPayToAddress = hasColumn(headerColumns, 'PayToCode');
  const canJoinShipAddress = hasColumn(headerColumns, 'ShipToCode');
  const payToPlaceExpr = canJoinPayToAddress ? 'PayToState.Name, PayToAddr.State' : 'NULL, NULL';
  const shipPlaceExpr = canJoinShipAddress ? 'ShipState.Name, ShipAddr.State' : 'NULL, NULL';
  const placeOfSupplyColumn = getColumnName(headerColumns, 'U_PlaceOfSupply');
  const placeOfSupplyExpr = placeOfSupplyColumn
    ? `COALESCE(NULLIF(LTRIM(RTRIM(CAST(T0.${placeOfSupplyColumn} AS NVARCHAR(254)))), ''), ${payToPlaceExpr}, ${shipPlaceExpr}, '')`
    : `COALESCE(${payToPlaceExpr}, ${shipPlaceExpr}, '')`;
  const payToAddressJoin = canJoinPayToAddress
    ? `LEFT JOIN CRD1 PayToAddr
      ON PayToAddr.CardCode = T0.CardCode
     AND PayToAddr.Address = T0.PayToCode
     AND PayToAddr.AdresType = 'B'
    LEFT JOIN OCST PayToState
      ON PayToState.Code = PayToAddr.State
     AND PayToState.Country = PayToAddr.Country`
    : '';
  const shipAddressJoin = canJoinShipAddress
    ? `LEFT JOIN CRD1 ShipAddr
      ON ShipAddr.CardCode = T0.CardCode
     AND ShipAddr.Address = T0.ShipToCode
     AND ShipAddr.AdresType = 'S'
    LEFT JOIN OCST ShipState
      ON ShipState.Code = ShipAddr.State
     AND ShipState.Country = ShipAddr.Country`
    : '';

  const headerRows = await safe(db.query(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.Series,
      NNM.SeriesName,
      NNM.Indicator AS SeriesIndicator,
      T0.CardCode,
      T0.CardName,
      T0.CntctCode,
      T0.NumAtCard,
      T0.DocDate,
      T0.DocDueDate,
      T0.TaxDate,
      T0.BPLId,
      T0.DocCur,
      T0.DocRate,
      T0.GroupNum,
      T0.Comments,
      T0.JrnlMemo,
      T0.DiscPrcnt,
      T0.TotalExpns,
      T0.VatSum,
      T0.DocTotal,
      ${optionalColumn(headerColumns, 'T0', 'DiscSum', 'DiscSum', '0')},
      ${optionalColumn(headerColumns, 'T0', 'RoundDif', 'RoundDif', 'NULL')},
      ${optionalColumn(headerColumns, 'T0', 'Rounding', 'Rounding', 'NULL')},
      ${optionalColumn(headerColumns, 'T0', 'WTSum', 'WTSum', '0')},
      ${optionalColumn(headerColumns, 'T0', 'PaidToDate', 'PaidToDate', '0')},
      ${optionalColumn(headerColumns, 'T0', 'DpmAmnt', 'DpmAmnt', '0')},
      ${placeOfSupplyExpr} AS PlaceOfSupply,
      ${optionalColumn(headerColumns, 'T0', 'ShipToCode', 'ShipToCode', "''")},
      ${optionalColumn(headerColumns, 'T0', 'PayToCode', 'PayToCode', "''")},
      ${optionalColumn(headerColumns, 'T0', 'Address', 'ShipToAddress', "''")},
      ${optionalColumn(headerColumns, 'T0', 'Address2', 'BillToAddress', "''")},
      T0.SlpCode,
      SLP.SlpName,
      CASE T0.DocStatus WHEN 'O' THEN 'Open' WHEN 'C' THEN 'Closed' ELSE T0.DocStatus END AS Status
    FROM OPCH T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    LEFT JOIN NNM1 NNM ON NNM.ObjectCode = '18' AND NNM.Series = T0.Series
    ${payToAddressJoin}
    ${shipAddressJoin}
    WHERE T0.DocEntry = @docEntry AND T0.DocType = 'S'
  `, { docEntry }));

  if (!headerRows.length) throw new Error('Service A/P Invoice not found');
  const header = headerRows[0];
  const pch1Columns = await getTableColumns('PCH1');
  const classificationColumn = getColumnName(pch1Columns, 'SacEntry')
    || getColumnName(pch1Columns, 'HsnEntry');
  const sacSelect = classificationColumn
    ? `T0.${classificationColumn} AS SACEntry,
      NULL AS SAC`
    : `NULL AS SACEntry,
      NULL AS SAC`;

  const lineRows = await queryRowsWithFallback({
    label: 'invoice lines',
    params: { docEntry },
    primarySql: `
    SELECT
      T0.LineNum,
      T0.AcctCode,
      ACT.AcctName,
      T0.Dscription,
      T0.OcrCode,
      T0.TaxCode,
      T0.LineTotal,
      T0.VatSum,
      T0.Price,
      ${optionalColumn(pch1Columns, 'T0', 'DiscPrcnt', 'DiscountPercent', '0')},
      ${optionalColumn(pch1Columns, 'T0', 'PriceBefDi', 'PriceBeforeDiscount', 'NULL')},
      NULL AS WTLiable,
      T0.Quantity,
      ${optionalColumn(pch1Columns, 'T0', 'ReqDate', 'RequiredDate')},
      ${optionalColumn(pch1Columns, 'T0', 'PackQty', 'PackageQuantity', '0')},
      T0.BaseEntry,
      T0.BaseType,
      T0.BaseLine,
      ${optionalColumn(pch1Columns, 'T0', 'LocCode', 'LocationCode')},
      ${optionalColumn(pch1Columns, 'T0', 'AgrNo', 'BlanketAgreementNo')},
      ${sacSelect}
    FROM PCH1 T0
    LEFT JOIN OACT ACT ON ACT.AcctCode = T0.AcctCode
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `,
    fallbackSql: `
    SELECT
      T0.LineNum,
      T0.AcctCode,
      ACT.AcctName,
      T0.Dscription,
      T0.OcrCode,
      T0.TaxCode,
      T0.LineTotal,
      T0.VatSum,
      T0.Price,
      0 AS DiscountPercent,
      NULL AS PriceBeforeDiscount,
      NULL AS WTLiable,
      T0.Quantity,
      NULL AS RequiredDate,
      0 AS PackageQuantity,
      T0.BaseEntry,
      T0.BaseType,
      T0.BaseLine,
      NULL AS LocationCode,
      NULL AS BlanketAgreementNo,
      NULL AS SACEntry,
      NULL AS SAC
    FROM PCH1 T0
    LEFT JOIN OACT ACT ON ACT.AcctCode = T0.AcctCode
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `,
  });

  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OPCH', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'PCH1', keyValue: docEntry }),
  ]);
  const [sacLookup, hsnLookup] = await Promise.all([
    hsnCodeDbService.getSACCodes('', 5000, 0),
    hsnCodeDbService.getHSNCodes('', 5000, 0),
  ]);
  const sacByEntry = new Map(sacLookup.map((sac) => [String(sac.absEntry ?? ''), sac.serviceCode || sac.code || '']));
  const hsnByEntry = new Map(hsnLookup.map((hsn) => [String(hsn.absEntry ?? ''), hsn.code || '']));
  const classificationByEntry = classificationColumn.toUpperCase() === 'HSNENTRY' ? hsnByEntry : sacByEntry;
  const lineSubtotal = lineRows.reduce((sum, line) => sum + Number(line.LineTotal || 0), 0);
  const headerSubtotal = Number(header.DocTotal || 0)
    + Number(header.DiscSum || 0)
    + Number(header.WTSum || 0)
    - Number(header.TotalExpns || 0)
    - Number(header.VatSum || 0)
    - Number(header.RoundDif || 0);
  const totalBeforeDiscount = lineSubtotal || headerSubtotal;
  const derivedRounding = Number(header.DocTotal || 0)
    + Number(header.WTSum || 0)
    + Number(header.DiscSum || 0)
    + Number(header.DpmAmnt || 0)
    - totalBeforeDiscount
    - Number(header.TotalExpns || 0)
    - Number(header.VatSum || 0);
  const roundingAmount = header.RoundDif != null && header.RoundDif !== ''
    ? Number(header.RoundDif) : (Math.abs(derivedRounding) <= 1 ? derivedRounding : 0);

  return {
    service_ap_invoice: {
      doc_entry: header.DocEntry,
      doc_num: header.DocNum,
      header: {
        vendor: header.CardCode || '',
        customerCode: header.CardCode || '',
        name: header.CardName || '',
        contactPerson: header.CntctCode ? String(header.CntctCode) : '',
        salesContractNo: header.NumAtCard || '',
        currency: header.DocCur || '',
        exchangeRate: header.DocRate == null ? '' : String(header.DocRate),
        transactionType: 'GST Tax Invoice',
        placeOfSupply: header.PlaceOfSupply || '',
        docNo: header.DocNum ? String(header.DocNum) : '',
        status: header.Status || 'Open',
        series: header.Series ? String(header.Series) : '',
        seriesName: header.SeriesName || '',
        nextNumber: header.DocNum ? String(header.DocNum) : '',
        postingDate: formatDate(header.DocDate),
        deliveryDate: formatDate(header.DocDueDate),
        documentDate: formatDate(header.TaxDate),
        branch: header.BPLId ? String(header.BPLId) : '',
        paymentTerms: header.GroupNum ? String(header.GroupNum) : '',
        remarks: header.Comments || '',
        otherInstruction: header.Comments || '',
        journalRemark: header.JrnlMemo || '',
        discount: header.DiscPrcnt != null ? String(header.DiscPrcnt) : '',
        discountAmount: header.DiscSum != null ? String(header.DiscSum) : '',
        freight: header.TotalExpns != null ? String(header.TotalExpns) : '',
        tax: header.VatSum != null ? String(header.VatSum) : '',
        roundingAmount: String(roundingAmount),
        rounding: header.Rounding != null
          ? ['Y', 'TYES'].includes(String(header.Rounding).toUpperCase()) : roundingAmount !== 0,
        wtaxAmount: header.WTSum != null ? String(header.WTSum) : '',
        appliedAmount: header.PaidToDate != null ? String(header.PaidToDate) : '',
        totalDownPayment: header.DpmAmnt != null ? String(header.DpmAmnt) : '',
        totalPaymentDue: header.DocTotal != null ? String(header.DocTotal) : '',
        balanceDue: header.DocTotal != null && header.PaidToDate != null ? String(Number(header.DocTotal || 0) - Number(header.PaidToDate || 0)) : '',
        totalBeforeDiscount: header.DocTotal != null ? String(totalBeforeDiscount) : '',
        shipToCode: header.ShipToCode || '',
        billToCode: header.PayToCode || '',
        shipToAddress: header.ShipToAddress || '',
        billToAddress: header.BillToAddress || '',
        salesEmployee: header.SlpCode != null ? String(header.SlpCode) : '',
        purchaser: header.SlpName || '',
      },
      lines: lineRows.map((line) => {
        const udf = lineUdfsByLineNum[line.LineNum] || {};
        const udfAliases = mapUdfToAliases(udf);
        return {
          ...udfAliases,
          baseEntry: line.BaseEntry ?? null,
          baseType: line.BaseType ?? null,
          baseLine: line.BaseLine ?? null,
          sac: line.SAC || classificationByEntry.get(String(line.SACEntry ?? '')) || hsnByEntry.get(String(line.SACEntry ?? '')) || sacByEntry.get(String(line.SACEntry ?? '')) || udfAliases.sac || '',
          description: line.Dscription || '',
          glAccount: line.AcctCode || '',
          glAccountName: line.AcctName || '',
          distRule: line.OcrCode || '',
          requiredDate: formatDate(line.RequiredDate),
          noOfPackages: line.PackageQuantity != null ? String(line.PackageQuantity) : '',
          taxCode: line.TaxCode || '',
          wtaxLiable: line.WTLiable != null
            ? (String(line.WTLiable).toUpperCase() === 'Y' ? 'Yes' : 'No')
            : (Number(header.WTSum || 0) !== 0 ? 'Yes' : 'No'),
          totalLC: line.LineTotal != null ? String(line.LineTotal) : '',
          taxAmountLC: line.VatSum != null ? String(line.VatSum) : '',
          loc: line.LocationCode != null ? String(line.LocationCode) : '',
          locCode: line.LocationCode != null ? String(line.LocationCode) : '',
          blanketAgreementNo: line.BlanketAgreementNo != null ? String(line.BlanketAgreementNo) : '',
          unitPrice: line.PriceBeforeDiscount != null ? String(line.PriceBeforeDiscount) : (line.Price != null ? String(line.Price) : ''),
          udf,
        };
      }),
      header_udfs: headerUdfs,
    },
  };
};

const getOpenServiceDocuments = async ({ table, vendorCode = '' }) => {
  const params = {};
  const cardFilter = String(vendorCode || '').trim() ? 'AND T0.CardCode = @vendorCode' : '';
  if (cardFilter) params.vendorCode = String(vendorCode).trim();

  return safe(db.query(`
    SELECT TOP 200
      T0.DocEntry, T0.DocNum, T0.CardCode, T0.CardName,
      T0.DocDate, T0.DocDueDate, T0.Comments, T0.DocTotal
    FROM ${table} T0
    WHERE T0.DocStatus = 'O'
      AND ISNULL(T0.CANCELED, 'N') <> 'Y'
      AND T0.DocType = 'S'
      ${cardFilter}
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
  `, params));
};

const getServiceDocumentForCopy = async ({ headerTable, lineTable, docEntry, baseType }) => {
  const headerRows = await safe(db.query(`
    SELECT T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate, T0.TaxDate,
      T0.CardCode, T0.CardName, T0.CntctCode, T0.NumAtCard, T0.Comments,
      T0.BPLId, T0.BPL_IDAssignedToInvoice, T0.GroupNum, T0.SlpCode,
      T0.DiscPrcnt, T0.TotalExpns AS Freight
    FROM ${headerTable} T0
    WHERE T0.DocEntry = @docEntry AND T0.DocType = 'S'
  `, { docEntry }));

  const lineColumns = await getTableColumns(lineTable);
  const copyClassificationColumn = getColumnName(lineColumns, 'SacEntry')
    || getColumnName(lineColumns, 'HsnEntry');
  const copySacSelect = copyClassificationColumn
    ? `T0.${copyClassificationColumn} AS SACEntry,
      NULL AS SAC`
    : `NULL AS SACEntry,
      NULL AS SAC`;

  const lineRows = await queryRowsWithFallback({
    label: `${lineTable} copy lines`,
    params: { docEntry, baseType },
    primarySql: `
    SELECT
      T0.LineNum,
      T0.AcctCode AS AccountCode,
      ACT.AcctName AS AccountName,
      T0.Dscription AS ItemDescription,
      CASE
        WHEN T0.OpenQty IS NOT NULL AND T0.OpenQty > 0 THEN T0.OpenQty
        ELSE T0.Quantity
      END AS Quantity,
      T0.OpenQty,
      ${optionalColumn(lineColumns, 'T0', 'ReqDate', 'RequiredDate')},
      ${optionalColumn(lineColumns, 'T0', 'PackQty', 'PackageQuantity', '0')},
      T0.Price AS UnitPrice,
      T0.TaxCode,
      T0.OcrCode AS DistributionRule,
      CASE
        WHEN T0.OpenQty IS NOT NULL AND T0.OpenQty > 0 THEN ISNULL(T0.Price, 0) * T0.OpenQty
        ELSE T0.LineTotal
      END AS LineTotal,
      T0.VatSum AS TaxAmount,
      ${optionalColumn(lineColumns, 'T0', 'LocCode', 'LocationCode')},
      ${optionalColumn(lineColumns, 'T0', 'AgrNo', 'BlanketAgreementNo')},
      ${copySacSelect},
      T0.DocEntry AS BaseEntry,
      T0.LineNum AS BaseLine,
      @baseType AS BaseType
    FROM ${lineTable} T0
    LEFT JOIN OACT ACT ON ACT.AcctCode = T0.AcctCode
    WHERE T0.DocEntry = @docEntry
      AND ISNULL(T0.LineStatus, 'O') = 'O'
    ORDER BY T0.LineNum
  `,
    fallbackSql: `
    SELECT
      T0.LineNum,
      T0.AcctCode AS AccountCode,
      ACT.AcctName AS AccountName,
      T0.Dscription AS ItemDescription,
      CASE
        WHEN T0.OpenQty IS NOT NULL AND T0.OpenQty > 0 THEN T0.OpenQty
        ELSE T0.Quantity
      END AS Quantity,
      T0.OpenQty,
      NULL AS RequiredDate,
      0 AS PackageQuantity,
      T0.Price AS UnitPrice,
      T0.TaxCode,
      T0.OcrCode AS DistributionRule,
      CASE
        WHEN T0.OpenQty IS NOT NULL AND T0.OpenQty > 0 THEN ISNULL(T0.Price, 0) * T0.OpenQty
        ELSE T0.LineTotal
      END AS LineTotal,
      T0.VatSum AS TaxAmount,
      NULL AS LocationCode,
      NULL AS BlanketAgreementNo,
      NULL AS SACEntry,
      NULL AS SAC,
      T0.DocEntry AS BaseEntry,
      T0.LineNum AS BaseLine,
      @baseType AS BaseType
    FROM ${lineTable} T0
    LEFT JOIN OACT ACT ON ACT.AcctCode = T0.AcctCode
    WHERE T0.DocEntry = @docEntry
      AND ISNULL(T0.LineStatus, 'O') = 'O'
    ORDER BY T0.LineNum
  `,
  });

  const [sacLookup, hsnLookup] = await Promise.all([
    hsnCodeDbService.getSACCodes('', 5000, 0),
    hsnCodeDbService.getHSNCodes('', 5000, 0),
  ]);
  const sacByEntry = new Map(sacLookup.map((sac) => [String(sac.absEntry ?? ''), sac.serviceCode || sac.code || '']));
  const hsnByEntry = new Map(hsnLookup.map((hsn) => [String(hsn.absEntry ?? ''), hsn.code || '']));
  const copyClassificationByEntry = copyClassificationColumn.toUpperCase() === 'HSNENTRY' ? hsnByEntry : sacByEntry;

  const lineUdfsByLineNum = await getLineUdfValues({ tableId: lineTable, keyValue: docEntry });

  return {
    ...(headerRows[0] || {}),
    DocumentLines: lineRows.map((line) => ({
      ...line,
      udf: lineUdfsByLineNum[line.LineNum] || {},
      ...mapUdfToAliases(lineUdfsByLineNum[line.LineNum] || {}),
      SAC: line.SAC || copyClassificationByEntry.get(String(line.SACEntry ?? '')) || hsnByEntry.get(String(line.SACEntry ?? '')) || sacByEntry.get(String(line.SACEntry ?? '')) || '',
    })),
  };
};

const getServiceAPDocumentSeries = async (options = {}) => apInvoiceDb.getDocumentSeries(typeof options === 'string' ? { date: options } : options);

const getVendorDetails = async (vendorCode) => {
  const [details, vendorRows] = await Promise.all([
    apInvoiceDb.getVendorDetails(vendorCode),
    safe(db.query(`
      SELECT TOP 1 CardCode, CardName, Currency, GroupNum
      FROM OCRD
      WHERE CardCode = @vendorCode AND CardType = 'S'
    `, { vendorCode })),
  ]);

  return {
    ...details,
    vendor: vendorRows[0] || null,
  };
};

module.exports = {
  getReferenceData,
  getVendorDetails,
  getVendorFilterOptions: null,
  getDocumentSeries: getServiceAPDocumentSeries,
  getNextNumber: apInvoiceDb.getNextNumber,
  getVendorValidation: apInvoiceDb.getVendorValidation,
  getBranchEnabled: apInvoiceDb.getBranchEnabled,
  getTaxCodeValidation: apInvoiceDb.getTaxCodeValidation,
  isDuplicateVendorInvoiceNumber: apInvoiceDb.isDuplicateVendorInvoiceNumber,
  getServiceAPInvoiceList,
  getServiceAPInvoice,
  getMarketingDocumentUdfs,
  getOpenServicePurchaseQuotations: (vendorCode) => getOpenServiceDocuments({ table: 'OPQT', vendorCode }),
  getOpenServicePurchaseOrders: (vendorCode) => getOpenServiceDocuments({ table: 'OPOR', vendorCode }),
  getOpenServiceGRPO: (vendorCode) => getOpenServiceDocuments({ table: 'OPDN', vendorCode }),
  getServicePurchaseQuotationForCopy: (docEntry) => getServiceDocumentForCopy({ headerTable: 'OPQT', lineTable: 'PQT1', docEntry, baseType: 540000006 }),
  getServicePurchaseOrderForCopy: (docEntry) => getServiceDocumentForCopy({ headerTable: 'OPOR', lineTable: 'POR1', docEntry, baseType: 22 }),
  getServiceGRPOForCopy: (docEntry) => getServiceDocumentForCopy({ headerTable: 'OPDN', lineTable: 'PDN1', docEntry, baseType: 20 }),
};
