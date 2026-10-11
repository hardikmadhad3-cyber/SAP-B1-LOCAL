const db = require('./dbService');
const { createTableColumnDetailsReader } = require('./salesDocumentDbCompatibility');
const arInvoiceDb = require('./arInvoiceDbService');
const arCreditMemoDb = require('./arCreditMemoDbService');
const masterDataDbService = require('./masterDataDbService');
const { getServiceDocumentAccounts } = require('./serviceDocumentAccountDbService');
const hsnCodeDbService = require('./hsnCodeDbService');
const { getHeaderUdfValues, getLineUdfValues, getMarketingDocumentUdfs } = require('./udfMetadataService');

const safe = async (promise) => {
  try {
    const result = await promise;
    return result.recordset || [];
  } catch (error) {
    console.error('[Service AR Credit Memo DB] Query error:', error.message);
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
    console.error(`[Service AR Credit Memo DB] ${label} query error:`, error.message);
  }

  try {
    const fallbackResult = await db.query(fallbackSql, params);
    return fallbackResult.recordset || [];
  } catch (fallbackError) {
    console.error(`[Service AR Credit Memo DB] ${label} fallback query error:`, fallbackError.message);
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

const getReferenceData = async () => {
  const [base, accounts, distributionRules, withholdingTaxCodes, sacCodes, locations, businessPartners, serviceItems, creditMemoUdfMetadata] = await Promise.all([
    arInvoiceDb.getReferenceData(),
    getServiceDocumentAccounts(),
    masterDataDbService.lookupDistributionRules(),
    masterDataDbService.lookupWithholdingTaxCodes('', 200),
    hsnCodeDbService.getSACCodes('', 5000, 0),
    masterDataDbService.lookupWarehouseLocations(),
    masterDataDbService.searchBP('', '', 5000, 0),
    lookupServiceItems(),
    getMarketingDocumentUdfs({ headerTable: 'ORIN', lineTable: 'RIN1' }),
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
    udf_metadata: creditMemoUdfMetadata || { header: [], rows: [] },
  };
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

const getServiceARCreditMemoList = async ({
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
    FROM ORIN T0
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
    FROM ORIN T0
    LEFT JOIN RIN1 T1 ON T1.DocEntry = T0.DocEntry
    ${where}
    GROUP BY T0.DocEntry, T0.DocNum, T0.CardCode, T0.CardName, T0.DocDate, T0.DocDueDate, T0.DocTotal, T0.DocStatus
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `, params));

  const totalCount = Number(countRows[0]?.TotalCount || 0);
  return {
    service_ar_credit_memos: rows.map((row) => ({
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
  apInvDocKey: udf.U_APInvDocKey || udf.U_APInvDocEntry || '',
  apInvDocNum: udf.U_APInvDocNum || '',
  apInvLineNum: udf.U_APInvLineNum || '',
  rg23DNo: udf.U_RG23DNo || udf.U_RG23DNO || '',
  specialRebate: udf.U_SpecialRebate || udf.U_SPLRBT || '',
  commision: udf.U_Commision || udf.U_Commission || udf.U_COMPRC || '',
  brokPerQty: udf.U_BrokPerQty || udf.U_S_BrokPerQty || udf.U_S_BROKPERQTY || '',
  sItem: udf.U_S_Item || udf.U_SItem || '',
  sQty: udf.U_S_Qty || udf.U_SQty || '',
  sellerBrokerage: udf.U_SellerBrokerage || udf.U_Brok_Seller || udf.U_BROK_SELLER || '',
  buyerBrokerage: udf.U_BuyerBrokerage || udf.U_Brok_Buyer || udf.U_BROK_BUYER || '',
  buyerDelivery: udf.U_BuyerDelivery || udf.U_Buyer_Delivery || udf.U_BUYER_DELIVERY || '',
  sellerDelivery: udf.U_SellerDelivery || udf.U_Seller_Delivery || udf.U_SELLER_DELIVERY || '',
  buyerQuality: udf.U_BuyerQuality || udf.U_Buyer_Quality || udf.U_BUYER_QUALITY || '',
  sellerQuality: udf.U_SellerQuality || udf.U_Seller_Quality || udf.U_SELLER_QUALITY || '',
  buyerPrice: udf.U_BuyerPrice || udf.U_Buyer_Price || udf.U_BUYER_PRICE || '',
  sellerPrice: udf.U_SellerPrice || udf.U_Seller_Price || udf.U_SELLER_PRICE || '',
  buyerSpecialInstruction: udf.U_BuyerSpecialInstruction || udf.U_BuyerSplInst || udf.U_Buyer_SPINS || udf.U_BUYER_SPINS || '',
  sellerSpecialInstruction: udf.U_SellerSpecialInstruction || udf.U_SellerSplInst || udf.U_Seller_SPINS || udf.U_SELLER_SPINS || '',
  sellerBrokerageAmtPer: udf.U_SellerBrokerageAmtPer || udf.U_SellBrkAmtPer || udf.U_Sel_Brok_AP || udf.U_SEL_BROK_AP || '',
  sellerBrokeragePercentage: udf.U_SellerBrokeragePercentage || udf.U_SellerBrkPct || udf.U_Seller_Brok_Per || udf.U_SELLER_BROK_PER || '',
  buyerBillDiscount: udf.U_BuyerBillDiscount || '',
  sellerBillDiscount: udf.U_SellerBillDiscount || '',
  stcode: udf.U_STCODE || udf.U_SELLTCODE || '',
  buyerTermsOfPayment: udf.U_BuyerTermsOfPayment || udf.U_BuyerPayTerms || udf.U_Buyer_Payment_Terms || udf.U_BUYER_PAYMENT_TERMS || '',
  sellerTermsOfPayment: udf.U_SellerTermsOfPayment || udf.U_SellerPayTerms || udf.U_Seller_Payment_Term || udf.U_Seller_Payment_Terms || '',
  sellerTermsOfPaymentRepeat: udf.U_SellerTermsOfPayment || udf.U_SellerPayTerms || udf.U_Seller_Payment_Term || udf.U_Seller_Payment_Terms || '',
  fixBrokBuyer: udf.U_Fix_Brock_B || udf.U_Fix_Brok_B || udf.U_FIX_BROK_BUYER || '',
  fixBrockSeller: udf.U_Fix_Brock_S || udf.U_Fix_Brok_S || udf.U_FIXBROCKSELLER || udf.U_FIX_BROK_SELLER || '',
  freightPurchase: udf.U_FreightPurchase || '',
  freightSales: udf.U_FreightSales || '',
  freightProvider: udf.U_FreightProvider || '',
  freightProviderName: udf.U_FreightProviderName || '',
  documentCreated: formatDate(udf.U_DocumentCreated || ''),
  brokerageNumber: udf.U_BrokerageNumber || udf.U_BrokerageNo || '',
});

const getServiceARCreditMemo = async (docEntry) => {
  const headerColumns = await getTableColumns('ORIN');
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
      ${optionalColumn(headerColumns, 'T0', 'TaxInvNo', 'TaxInvoiceNo', "''")},
      ${optionalColumn(headerColumns, 'T0', 'FrmBpDate', 'TaxInvoiceDate', 'NULL')},
      ${optionalColumn(headerColumns, 'T0', 'GSTTranTyp', 'GSTTransactionType', "'GA'")},
      T0.SlpCode,
      SLP.SlpName,
      CASE T0.DocStatus WHEN 'O' THEN 'Open' WHEN 'C' THEN 'Closed' ELSE T0.DocStatus END AS Status
    FROM ORIN T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    LEFT JOIN NNM1 NNM ON NNM.ObjectCode = '14' AND NNM.Series = T0.Series
    ${payToAddressJoin}
    ${shipAddressJoin}
    WHERE T0.DocEntry = @docEntry AND T0.DocType = 'S'
  `, { docEntry }));

  if (!headerRows.length) throw new Error('Service A/R Credit Memo not found');
  const header = headerRows[0];
  const pch1Columns = await getTableColumns('RIN1');
  const classificationColumn = getColumnName(pch1Columns, 'SacEntry')
    || getColumnName(pch1Columns, 'HsnEntry');
  const sacSelect = classificationColumn
    ? `T0.${classificationColumn} AS SACEntry,
      NULL AS SAC`
    : `NULL AS SACEntry,
      NULL AS SAC`;

  const lineRows = await queryRowsWithFallback({
    label: 'credit memo lines',
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
    FROM RIN1 T0
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
    FROM RIN1 T0
    LEFT JOIN OACT ACT ON ACT.AcctCode = T0.AcctCode
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `,
  });

  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'ORIN', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'RIN1', keyValue: docEntry }),
  ]);
  const [sacLookup, hsnLookup] = await Promise.all([
    hsnCodeDbService.getSACCodes('', 5000, 0),
    hsnCodeDbService.getHSNCodes('', 5000, 0),
  ]);
  const sacByEntry = new Map(sacLookup.map((sac) => [String(sac.absEntry ?? ''), sac.serviceCode || sac.code || '']));
  const hsnByEntry = new Map(hsnLookup.map((hsn) => [String(hsn.absEntry ?? ''), hsn.code || '']));
  const classificationByEntry = classificationColumn && classificationColumn.toUpperCase() === 'HSNENTRY' ? hsnByEntry : sacByEntry;
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
    service_ar_credit_memo: {
      doc_entry: header.DocEntry,
      doc_num: header.DocNum,
      header: {
        vendor: header.CardCode || '',
        customerCode: header.CardCode || '',
        name: header.CardName || '',
        contactPerson: header.CntctCode ? String(header.CntctCode) : '',
        salesContractNo: header.NumAtCard || '',
        taxInvoiceNo: header.TaxInvoiceNo || '',
        taxInvoiceDate: formatDate(header.TaxInvoiceDate),
        GSTTransactionType: header.GSTTransactionType || '',
        currency: header.DocCur || '',
        exchangeRate: header.DocRate == null ? '' : String(header.DocRate),
        transactionType: getKnownHeaderUdfValue(
          headerUdfs,
          ['TransactionType', 'TransType', 'DocumentType', 'DocType']
        ) || 'GST Tax Invoice',
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
  const headerColumns = await getTableColumns(headerTable);
  const headerRows = await safe(db.query(`
    SELECT T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate, T0.TaxDate,
      T0.CardCode, T0.CardName, T0.CntctCode, T0.NumAtCard, T0.Comments,
      ${optionalColumn(headerColumns, 'T0', 'BPLId', 'BPLId', 'NULL')},
      ${optionalColumn(headerColumns, 'T0', 'BPL_IDAssignedToInvoice', 'BPL_IDAssignedToInvoice', 'NULL')},
      ${optionalColumn(headerColumns, 'T0', 'TaxInvNo', 'TaxInvoiceNo', "''")},
      ${optionalColumn(headerColumns, 'T0', 'FrmBpDate', 'TaxInvoiceDate', 'NULL')},
      T0.GroupNum, T0.SlpCode,
      T0.DiscPrcnt, T0.TotalExpns AS Freight
    FROM ${headerTable} T0
    WHERE T0.DocEntry = @docEntry AND T0.DocType = 'S'
  `, { docEntry }));

  const lineColumns = await getTableColumns(lineTable);
  const openQtyColumn = getColumnName(lineColumns, 'OpenQty');
  const openQtyExpr = openQtyColumn ? `T0.${openQtyColumn}` : 'T0.Quantity';
  const copyQuantityExpr = openQtyColumn
    ? `CASE WHEN ${openQtyExpr} IS NOT NULL AND ${openQtyExpr} > 0 THEN ${openQtyExpr} ELSE T0.Quantity END`
    : 'T0.Quantity';
  const copyLineTotalExpr = openQtyColumn
    ? `CASE WHEN ${openQtyExpr} IS NOT NULL AND ${openQtyExpr} > 0 THEN ISNULL(T0.Price, 0) * ${openQtyExpr} ELSE T0.LineTotal END`
    : 'T0.LineTotal';
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
      ${copyQuantityExpr} AS Quantity,
      ${openQtyExpr} AS OpenQty,
      ${optionalColumn(lineColumns, 'T0', 'ReqDate', 'RequiredDate')},
      ${optionalColumn(lineColumns, 'T0', 'PackQty', 'PackageQuantity', '0')},
      T0.Price AS UnitPrice,
      T0.TaxCode,
      T0.OcrCode AS DistributionRule,
      ${copyLineTotalExpr} AS LineTotal,
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
      T0.Quantity AS Quantity,
      T0.Quantity AS OpenQty,
      NULL AS RequiredDate,
      0 AS PackageQuantity,
      T0.Price AS UnitPrice,
      T0.TaxCode,
      T0.OcrCode AS DistributionRule,
      T0.LineTotal AS LineTotal,
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
  const copyClassificationByEntry = copyClassificationColumn && copyClassificationColumn.toUpperCase() === 'HSNENTRY' ? hsnByEntry : sacByEntry;

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

const getServiceARCreditMemoDocumentSeries = async (options = {}) => {
  const { date, transactionType = '', branch = '', docSubType } = typeof options === 'string' ? { date: options } : options;
  return arCreditMemoDb.getDocumentSeries(date, transactionType, branch, docSubType);
};

const getNextNumber = async (series) => {
  const rows = await safe(db.query(`
    SELECT NextNumber
    FROM NNM1
    WHERE Series = @series
      AND ObjectCode = '14'
  `, { series }));

  return { nextNumber: rows.length ? rows[0].NextNumber : null };
};

const getCustomerDetails = async (customerCode) => arInvoiceDb.getCustomerDetails(customerCode);

const getCustomerValidation = async (cardCode) => {
  const rows = await safe(db.query(`
    SELECT TOP 1
      CardCode,
      CardType,
      frozenFor AS FrozenFor
    FROM OCRD
    WHERE CardCode = @cardCode
  `, { cardCode }));
  return rows[0] || null;
};

const getBranchEnabled = async () => {
  const rows = await safe(db.query('SELECT COUNT(*) AS BranchCount FROM OBPL'));
  return Number(rows[0]?.BranchCount || 0) > 0;
};

const getTaxCodeValidation = async (code) => masterDataDbService.getTaxCode(code);

const getARInvoiceTaxReference = async (docEntry) => {
  const headerColumns = await getTableColumns('OINV');
  const rows = await safe(db.query(`
    SELECT TOP 1
      T0.DocNum,
      T0.NumAtCard,
      T0.DocDate,
      T0.TaxDate,
      ${optionalColumn(headerColumns, 'T0', 'TaxInvNo', 'TaxInvoiceNo', "''")},
      ${optionalColumn(headerColumns, 'T0', 'FrmBpDate', 'TaxInvoiceDate', 'NULL')}
    FROM OINV T0
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  const row = rows[0] || {};
  return {
    taxInvoiceNo: String(row.TaxInvoiceNo || row.NumAtCard || row.DocNum || '').trim(),
    taxInvoiceDate: formatDate(row.TaxInvoiceDate || row.TaxDate || row.DocDate),
  };
};

module.exports = {
  getReferenceData,
  getCustomerDetails,
  getCustomerFilterOptions: null,
  getDocumentSeries: getServiceARCreditMemoDocumentSeries,
  getNextNumber,
  getCustomerValidation,
  getBranchEnabled,
  getTaxCodeValidation,
  getServiceARCreditMemoList,
  getServiceARCreditMemo,
  getARInvoiceTaxReference,
  getMarketingDocumentUdfs,
  getOpenServiceARInvoices: (customerCode) => getOpenServiceDocuments({ table: 'OINV', customerCode }),
  getServiceARInvoiceForCopy: (docEntry) => getServiceDocumentForCopy({ headerTable: 'OINV', lineTable: 'INV1', docEntry, baseType: 13 }),
};




