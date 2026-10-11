const db = require('./dbService');
const arInvoiceDb = require('./arInvoiceDbService');
const masterDataDbService = require('./masterDataDbService');
const { getServiceDocumentAccounts } = require('./serviceDocumentAccountDbService');
const hsnCodeDbService = require('./hsnCodeDbService');
const { getHeaderUdfValues, getLineUdfValues, getMarketingDocumentUdfs } = require('./udfMetadataService');
const { createTableColumnDetailsReader } = require('./salesDocumentDbCompatibility');

const safe = async (promise) => {
  try {
    const result = await promise;
    return result.recordset || [];
  } catch (error) {
    console.warn('[Service AR Invoice DB] Query failed silently:', error.message);
    return [];
  }
};

const getTableColumnDetailsReader = createTableColumnDetailsReader({ database: db });

const getTableColumns = async (tableName) => {
  try {
    const columnDetails = await getTableColumnDetailsReader(String(tableName || '').trim());
    return new Map(columnDetails
      .map((col) => String(col.columnName || '').trim())
      .filter(Boolean)
      .map((columnName) => [columnName.toUpperCase(), columnName]));
  } catch (_error) {
    return new Map();
  }
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
    console.warn(`[Service AR Invoice DB] ${label} primary query failed:`, error.message);
  }

  try {
    const fallbackResult = await db.query(fallbackSql, params);
    return fallbackResult.recordset || [];
  } catch (fallbackError) {
    console.warn(`[Service AR Invoice DB] ${label} fallback query failed:`, fallbackError.message);
    return [];
  }
};

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const REFERENCE_DATA_CACHE_TTL_MS = Number(
  process.env.SERVICE_AR_INVOICE_REFERENCE_DATA_CACHE_TTL_MS || 5 * 60 * 1000,
);
const REFERENCE_DATA_BATCH_SIZE = Math.max(
  1,
  Math.min(3, Number(process.env.SERVICE_AR_INVOICE_REFERENCE_QUERY_BATCH_SIZE) || 2),
);
const referenceDataCache = new Map();

const cloneReferenceData = (data) => JSON.parse(JSON.stringify(data || {}));

const getReferenceDataCacheKey = async () => {
  try {
    return String(await db.resolveDatabaseName() || 'default');
  } catch (_error) {
    return 'default';
  }
};

const runReferenceDataTasks = async (tasks) => {
  const values = [];
  for (let index = 0; index < tasks.length; index += REFERENCE_DATA_BATCH_SIZE) {
    const batch = tasks.slice(index, index + REFERENCE_DATA_BATCH_SIZE);
    values.push(...await Promise.all(batch.map((task) => task())));
  }
  return values;
};

const getCachedReferenceData = async (loadData) => {
  if (!Number.isFinite(REFERENCE_DATA_CACHE_TTL_MS) || REFERENCE_DATA_CACHE_TTL_MS <= 0) {
    return loadData();
  }

  const cacheKey = await getReferenceDataCacheKey();
  const now = Date.now();
  const cached = referenceDataCache.get(cacheKey);

  if (cached?.data && cached.expiresAt > now) {
    return cloneReferenceData(cached.data);
  }
  if (cached?.pending) {
    return cloneReferenceData(await cached.pending);
  }

  const pending = loadData();
  referenceDataCache.set(cacheKey, { pending, expiresAt: now + REFERENCE_DATA_CACHE_TTL_MS });

  try {
    const data = await pending;
    referenceDataCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + REFERENCE_DATA_CACHE_TTL_MS,
    });
    return cloneReferenceData(data);
  } catch (error) {
    if (referenceDataCache.get(cacheKey)?.pending === pending) {
      referenceDataCache.delete(cacheKey);
    }
    throw error;
  }
};

const formatDate = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).split('T')[0] : date.toISOString().split('T')[0];
};

const normalizeUdfKey = (value) =>
  String(value || '')
    .replace(/^U_/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

const getKnownHeaderUdfValue = (values = {}, aliases = []) => {
  const normalizedAliases = aliases.map(normalizeUdfKey);
  const match = Object.entries(values || {}).find(([key, value]) => (
    normalizedAliases.includes(normalizeUdfKey(key)) &&
    value !== undefined &&
    value !== null &&
    String(value).trim() !== ''
  ));

  return match ? String(match[1]) : '';
};

const mapLookupRows = (rows = []) => {
  const seen = new Set();
  const options = [];

  rows.forEach((row) => {
    const rawValue = row?.Value ?? row?.FldValue ?? '';
    const rawDescription = row?.Description ?? row?.Descr ?? '';
    const description = String(rawDescription || '').trim();
    const value = String(rawValue || description || '').trim();

    if (!value) return;

    const normalized = value.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);

    options.push({
      value,
      description,
      label: description && description !== value ? `${value} - ${description}` : value,
    });
  });

  return options;
};

const getServiceLineLookupValues = ({ aliases = [], labels = [] }) => {
  const normalizedAliases = aliases
    .flatMap((alias) => {
      const cleanAlias = String(alias || '').trim().replace(/^U_/i, '');
      return cleanAlias ? [cleanAlias, `U_${cleanAlias}`] : [];
    })
    .filter(Boolean);
  const normalizedLabels = labels.map((label) => String(label || '').trim()).filter(Boolean);
  const clauses = [];
  const params = { tableId: 'INV1' };

  normalizedAliases.forEach((alias, index) => {
    const paramName = `alias${index}`;
    params[paramName] = alias;
    clauses.push(`T0.AliasID = @${paramName}`, `CONCAT('U_', T0.AliasID) = @${paramName}`);
  });

  normalizedLabels.forEach((label, index) => {
    const paramName = `label${index}`;
    params[paramName] = label;
    clauses.push(`T0.Descr = @${paramName}`);
  });

  if (!clauses.length) return Promise.resolve([]);

  return safe(db.query(`
    SELECT
      LTRIM(RTRIM(ISNULL(T1.FldValue, ''))) AS Value,
      LTRIM(RTRIM(ISNULL(T1.Descr, ''))) AS Description,
      T1.IndexID
    FROM CUFD T0
    INNER JOIN UFD1 T1
      ON T0.TableID = T1.TableID
     AND T0.FieldID = T1.FieldID
    WHERE T0.TableID = @tableId
      AND (${clauses.join(' OR ')})
    ORDER BY T1.IndexID, T1.FldValue
  `, params)).then(mapLookupRows);
};

const SERVICE_LINE_LOOKUPS = {
  buyerQuality: { aliases: ['BuyerQuality', 'Buyer_Quality'], labels: ['Buyer - Quality', 'Buyer Quality'] },
  sellerQuality: { aliases: ['SellerQuality', 'Seller_Quality'], labels: ['Seller - Quality', 'Seller Quality'] },
  buyerPrice: { aliases: ['BuyerPrice', 'Buyer_Price'], labels: ['Buyer - Price', 'Buyer Price'] },
  sellerPrice: { aliases: ['SellerPrice', 'Seller_Price'], labels: ['Seller - Price', 'Seller Price'] },
};

const lookupServiceItems = async () => {
  const rowsWithWTax = await safe(db.query(`
    SELECT
      ItemCode,
      ItemName,
      OnHand,
      WTLiable
    FROM OITM
    WHERE SellItem = 'Y'
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
    WHERE SellItem = 'Y'
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

const loadReferenceDataUncached = async () => {
  const [
    base,
    accounts,
    distributionRules,
    withholdingTaxCodes,
    sacCodes,
    locations,
    businessPartners,
    serviceItems,
    buyerQualityOptions,
    sellerQualityOptions,
    buyerPriceOptions,
    sellerPriceOptions,
  ] = await runReferenceDataTasks([
    () => arInvoiceDb.getReferenceData(),
    () => getServiceDocumentAccounts(),
    () => masterDataDbService.lookupDistributionRules(),
    () => masterDataDbService.lookupWithholdingTaxCodes('', 200),
    () => hsnCodeDbService.getSACCodes('', 5000, 0),
    () => masterDataDbService.lookupWarehouseLocations(),
    () => masterDataDbService.searchBP('', '', 5000, 0),
    () => lookupServiceItems(),
    () => getServiceLineLookupValues(SERVICE_LINE_LOOKUPS.buyerQuality),
    () => getServiceLineLookupValues(SERVICE_LINE_LOOKUPS.sellerQuality),
    () => getServiceLineLookupValues(SERVICE_LINE_LOOKUPS.buyerPrice),
    () => getServiceLineLookupValues(SERVICE_LINE_LOOKUPS.sellerPrice),
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
    quality_options: {
      buyer: buyerQualityOptions.length ? buyerQualityOptions : (base.quality_options?.buyer || []),
      seller: sellerQualityOptions.length ? sellerQualityOptions : (base.quality_options?.seller || []),
    },
    price_options: {
      buyer: buyerPriceOptions.length ? buyerPriceOptions : (base.price_options?.buyer || []),
      seller: sellerPriceOptions.length ? sellerPriceOptions : (base.price_options?.seller || []),
    },
  };
};

const getReferenceData = async () => getCachedReferenceData(loadReferenceDataUncached);

const getServiceARInvoiceList = async ({
  query = '',
  docNum = '',
  customerCode = '',
  customerName = '',
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
    customerCode: String(customerCode || '').trim(),
    customerName: String(customerName || '').trim(),
    customerNameLike: `%${String(customerName || '').trim()}%`,
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
  if (params.customerCode) filters.push('T0.CardCode LIKE @customerCode');
  if (params.customerName) filters.push('T0.CardName LIKE @customerNameLike');
  if (params.status === 'Open') filters.push("T0.DocStatus = 'O'");
  if (params.status === 'Closed') filters.push("T0.DocStatus = 'C'");
  if (params.postingDateFrom) filters.push('CAST(T0.DocDate AS date) >= CAST(@postingDateFrom AS date)');
  if (params.postingDateTo) filters.push('CAST(T0.DocDate AS date) <= CAST(@postingDateTo AS date)');

  const where = filters.length ? `WHERE ${filters.join('\n AND ')}` : '';
  const countRows = await safe(db.query(`
    SELECT COUNT(1) AS TotalCount
    FROM OINV T0
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
    FROM OINV T0
    LEFT JOIN INV1 T1 ON T1.DocEntry = T0.DocEntry
    ${where}
    GROUP BY T0.DocEntry, T0.DocNum, T0.CardCode, T0.CardName, T0.DocDate, T0.DocDueDate, T0.DocTotal, T0.DocStatus
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `, params));

  const totalCount = Number(countRows[0]?.TotalCount || 0);
  return {
    service_ar_invoices: rows.map((row) => ({
      doc_entry: row.DocEntry,
      doc_num: row.DocNum,
      customer_code: row.CardCode || '',
      customer_name: row.CardName || '',
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

const getServiceARInvoice = async (docEntry) => {
  const headerColumns = await getTableColumns('OINV');
  const canJoinShipAddress = hasColumn(headerColumns, 'ShipToCode');
  const canJoinBillAddress = hasColumn(headerColumns, 'PayToCode');
  const shipPlaceExpr = canJoinShipAddress ? 'ShipState.Name, ShipAddr.State' : 'NULL, NULL';
  const billPlaceExpr = canJoinBillAddress ? 'BillState.Name, BillAddr.State' : 'NULL, NULL';
  const placeOfSupplyColumn = getColumnName(headerColumns, 'U_PlaceOfSupply');
  const placeOfSupplyExpr = placeOfSupplyColumn
    ? `COALESCE(NULLIF(LTRIM(RTRIM(CAST(T0.${placeOfSupplyColumn} AS NVARCHAR(254)))), ''), ${shipPlaceExpr}, ${billPlaceExpr}, '')`
    : `COALESCE(${shipPlaceExpr}, ${billPlaceExpr}, '')`;
  const shipAddressJoin = canJoinShipAddress
    ? `LEFT JOIN CRD1 ShipAddr
      ON ShipAddr.CardCode = T0.CardCode
     AND ShipAddr.Address = T0.ShipToCode
     AND ShipAddr.AdresType = 'S'
    LEFT JOIN OCST ShipState
      ON ShipState.Code = ShipAddr.State
     AND ShipState.Country = ShipAddr.Country`
    : '';
  const billAddressJoin = canJoinBillAddress
    ? `LEFT JOIN CRD1 BillAddr
      ON BillAddr.CardCode = T0.CardCode
     AND BillAddr.Address = T0.PayToCode
     AND BillAddr.AdresType = 'B'
    LEFT JOIN OCST BillState
      ON BillState.Code = BillAddr.State
     AND BillState.Country = BillAddr.Country`
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
    FROM OINV T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    LEFT JOIN NNM1 NNM ON NNM.ObjectCode = '13' AND NNM.Series = T0.Series
    ${shipAddressJoin}
    ${billAddressJoin}
    WHERE T0.DocEntry = @docEntry AND T0.DocType = 'S'
  `, { docEntry }));

  if (!headerRows.length) throw new Error('Service A/R Invoice not found');
  const header = headerRows[0];
  const inv1Columns = await getTableColumns('INV1');
  const classificationColumn = getColumnName(inv1Columns, 'SacEntry')
    || getColumnName(inv1Columns, 'HsnEntry');
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
      ${optionalColumn(inv1Columns, 'T0', 'OcrCode2', 'OcrCode2')},
      ${optionalColumn(inv1Columns, 'T0', 'OcrCode3', 'OcrCode3')},
      ${optionalColumn(inv1Columns, 'T0', 'OcrCode4', 'OcrCode4')},
      ${optionalColumn(inv1Columns, 'T0', 'OcrCode5', 'OcrCode5')},
      T0.TaxCode,
      T0.LineTotal,
      T0.VatSum,
      T0.Price,
      ${optionalColumn(inv1Columns, 'T0', 'DiscPrcnt', 'DiscountPercent', '0')},
      ${optionalColumn(inv1Columns, 'T0', 'PriceBefDi', 'PriceBeforeDiscount', 'NULL')},
      ${optionalColumn(inv1Columns, 'T0', 'WTLiable', 'WTLiable', "'N'")},
      ${optionalColumn(inv1Columns, 'T0', 'LocCode', 'LocationCode')},
      ${optionalColumn(inv1Columns, 'T0', 'AgrNo', 'BlanketAgreementNo')},
      ${optionalColumn(inv1Columns, 'T0', 'Project', 'ProjectCode')},
      T0.Quantity,
      ${optionalColumn(inv1Columns, 'T0', 'ReqDate', 'RequiredDate')},
      ${optionalColumn(inv1Columns, 'T0', 'PackQty', 'PackageQuantity', '0')},
      T0.BaseEntry,
      T0.BaseType,
      T0.BaseLine,
      ${sacSelect}
    FROM INV1 T0
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
      NULL AS OcrCode2,
      NULL AS OcrCode3,
      NULL AS OcrCode4,
      NULL AS OcrCode5,
      T0.TaxCode,
      T0.LineTotal,
      T0.VatSum,
      T0.Price,
      0 AS DiscountPercent,
      NULL AS PriceBeforeDiscount,
      'N' AS WTLiable,
      NULL AS LocationCode,
      NULL AS BlanketAgreementNo,
      NULL AS ProjectCode,
      T0.Quantity,
      NULL AS RequiredDate,
      0 AS PackageQuantity,
      T0.BaseEntry,
      T0.BaseType,
      T0.BaseLine,
      NULL AS SACEntry,
      NULL AS SAC
    FROM INV1 T0
    LEFT JOIN OACT ACT ON ACT.AcctCode = T0.AcctCode
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `,
  });

  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OINV', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'INV1', keyValue: docEntry }),
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
    service_ar_invoice: {
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
        transactionType: getKnownHeaderUdfValue(headerUdfs, ['TransactionType', 'TransType', 'DocumentType', 'DocType']),
        indicator: getKnownHeaderUdfValue(headerUdfs, ['Indicator']),
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
          discountPercent: line.DiscountPercent != null ? String(line.DiscountPercent) : '',
          priceAfterDisc: line.Price != null ? String(line.Price) : '',
          taxCode: line.TaxCode || '',
          wtaxLiable: line.WTLiable != null
            ? (String(line.WTLiable).toUpperCase() === 'Y' ? 'Yes' : 'No')
            : (Number(header.WTSum || 0) !== 0 ? 'Yes' : 'No'),
          totalLC: line.LineTotal != null ? String(line.LineTotal) : '',
          taxAmountLC: line.VatSum != null ? String(line.VatSum) : '',
          loc: line.LocationCode != null ? String(line.LocationCode) : '',
          blanketAgreementNo: line.BlanketAgreementNo != null ? String(line.BlanketAgreementNo) : '',
          unitPrice: line.PriceBeforeDiscount != null ? String(line.PriceBeforeDiscount) : (line.Price != null ? String(line.Price) : ''),
          udf,
        };
      }),
      header_udfs: headerUdfs,
    },
  };
};

const getOpenServiceDocuments = async ({ table, customerCode = '' }) => {
  const params = {};
  const cardFilter = String(customerCode || '').trim() ? 'AND T0.CardCode = @customerCode' : '';
  if (cardFilter) params.customerCode = String(customerCode).trim();

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
      T0.Quantity,
      ${optionalColumn(lineColumns, 'T0', 'ReqDate', 'RequiredDate')},
      ${optionalColumn(lineColumns, 'T0', 'PackQty', 'PackageQuantity', '0')},
      T0.Price AS UnitPrice,
      T0.TaxCode,
      T0.OcrCode AS DistributionRule,
      T0.LineTotal,
      T0.VatSum AS TaxAmount,
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
      T0.Quantity,
      NULL AS RequiredDate,
      0 AS PackageQuantity,
      T0.Price AS UnitPrice,
      T0.TaxCode,
      T0.OcrCode AS DistributionRule,
      T0.LineTotal,
      T0.VatSum AS TaxAmount,
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

  return {
    ...(headerRows[0] || {}),
    DocumentLines: lineRows.map((line) => ({
      ...line,
      SAC: line.SAC || copyClassificationByEntry.get(String(line.SACEntry ?? '')) || hsnByEntry.get(String(line.SACEntry ?? '')) || sacByEntry.get(String(line.SACEntry ?? '')) || '',
    })),
  };
};

const getServiceARDocumentSeries = async (date, transactionType = '', branch = '', docSubType) => arInvoiceDb.getDocumentSeries(date, transactionType, branch, docSubType);

module.exports = {
  getReferenceData,
  getCustomerDetails: arInvoiceDb.getCustomerDetails,
  getCustomerFilterOptions: null,
  getDocumentSeries: getServiceARDocumentSeries,
  getNextNumber: arInvoiceDb.getNextNumber,
  getServiceARInvoiceList,
  getServiceARInvoice,
  getMarketingDocumentUdfs,
  getOpenServiceSalesQuotations: (customerCode) => getOpenServiceDocuments({ table: 'OQUT', customerCode }),
  getOpenServiceSalesOrders: (customerCode) => getOpenServiceDocuments({ table: 'ORDR', customerCode }),
  getOpenServiceDeliveries: (customerCode) => getOpenServiceDocuments({ table: 'ODLN', customerCode }),
  getServiceSalesQuotationForCopy: (docEntry) => getServiceDocumentForCopy({ headerTable: 'OQUT', lineTable: 'QUT1', docEntry, baseType: 23 }),
  getServiceSalesOrderForCopy: (docEntry) => getServiceDocumentForCopy({ headerTable: 'ORDR', lineTable: 'RDR1', docEntry, baseType: 17 }),
  getServiceDeliveryForCopy: (docEntry) => getServiceDocumentForCopy({ headerTable: 'ODLN', lineTable: 'DLN1', docEntry, baseType: 15 }),
};
