/**
 * Purchase Quotation DB Service - ODBC/Direct SQL for GET operations
 * Reads data directly from SAP B1 SQL Server database
 */
const db = require('./dbService');
const { createPhysicalColumnSetReader, findPhysicalColumnName, selectPhysicalOptionalColumn } = require('./salesDocumentDbCompatibility');
const { getDocumentUnitPriceSql } = require('./documentUnitPriceDbUtils');
const { getDocumentUomSql, loadCompanyUomGroups } = require('./documentUomDbUtils');
const { loadBusinessPartnerAddresses } = require('./businessPartnerAddressDbUtils');
const masterDataDbService = require('./masterDataDbService');
const { getHeaderUdfValues, getLineUdfValues, getMarketingDocumentUdfs } = require('./udfMetadataService');
const {
  normalizeTopLimit,
  buildMarketingDocumentListFilterQuery,
  appendSapSearchCondition,
} = require('./documentListUtils');
const { getMarketingDocumentSeries } = require('./documentSeriesDbUtils');

const safe = async (promise) => {
  try {
    const r = await promise;
    return r.recordset || [];
  } catch (e) {
    // Logged, not hidden: a failing query would otherwise look like "no data".
    console.warn('[DB] query failed, returning no rows:', e?.message || e);
    return [];
  }
};

const formatDateForInput = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0].split(' ')[0];
};

const getTableColumns = createPhysicalColumnSetReader(db);

// ── REFERENCE DATA QUERIES ────────────────────────────────────────────────────

const getVendors = () => safe(db.query(`
  SELECT *
  FROM   OCRD
  WHERE  CardType = 'S'
  ORDER  BY CardName, CardCode
`));

const searchVendors = async ({ query = '', cardCode = '', cardName = '', top, sortBy = 'code' } = {}) => {
  const normalizedQuery = String(query || '').trim();
  const normalizedCardCode = String(cardCode || '').trim();
  const normalizedCardName = String(cardName || '').trim();
  const normalizedTop = normalizeTopLimit(top);
  const queryClauses = [];
  const queryParams = {};
  appendSapSearchCondition(queryClauses, queryParams, ['CardCode', 'CardName'], normalizedQuery, 'query');
  const cardCodeClauses = [];
  const cardCodeParams = {};
  appendSapSearchCondition(cardCodeClauses, cardCodeParams, ['CardCode'], normalizedCardCode, 'cardCode');
  const cardNameClauses = [];
  const cardNameParams = {};
  appendSapSearchCondition(cardNameClauses, cardNameParams, ['CardName'], normalizedCardName, 'cardName');
  const orderBy = String(sortBy || '').trim().toLowerCase() === 'name'
    ? 'CardName, CardCode'
    : 'CardCode, CardName';
  const topClause = normalizedTop ? 'TOP (@top)' : '';

  return safe(db.query(`
    SELECT ${topClause}
      *
    FROM OCRD
    WHERE CardType = 'S'
      ${queryClauses.length ? `AND ${queryClauses.join(' AND ')}` : ''}
      ${cardCodeClauses.length ? `AND ${cardCodeClauses.join(' AND ')}` : ''}
      ${cardNameClauses.length ? `AND ${cardNameClauses.join(' AND ')}` : ''}
    ORDER BY ${orderBy}
  `, {
    ...(normalizedTop ? { top: normalizedTop } : {}),
    ...queryParams,
    ...cardCodeParams,
    ...cardNameParams,
  }));
};

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
         T0.SWW         AS HSNCode
  FROM   OITM T0
  LEFT JOIN OUOM PU ON PU.UomEntry = T0.PUoMEntry
  WHERE  T0.PrchseItem = 'Y'
    AND  T0.validFor  <> 'N'
  ORDER  BY T0.ItemCode
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

// ── VENDOR DETAILS ────────────────────────────────────────────────────────────

const getContactsByVendor = async (cardCode) => {
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

const getAddressesByVendor = async (cardCode) => {
  const { addresses } = await loadBusinessPartnerAddresses(db, cardCode, { context: 'Purchase Quotation' });
  return addresses;
};

// ── PURCHASE ORDER LIST ───────────────────────────────────────────────────────

const getPurchaseQuotationList = async ({
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
  });

  const countRows = await safe(db.query(`
    SELECT COUNT(*) AS total_count
    FROM OPQT T0
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
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS status,
      T0.DocCur AS currency,
      (
        SELECT COUNT(*)
        FROM PQT1 T1
        WHERE T1.DocEntry = T0.DocEntry
      ) AS line_count
    FROM OPQT T0
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    quotations: result.map((row) => ({
      doc_entry: row.doc_entry,
      doc_num: row.doc_num,
      vendor_code: row.vendor_code,
      vendor_name: row.vendor_name,
      posting_date: row.posting_date ? row.posting_date.toISOString().split('T')[0] : '',
      delivery_date: row.delivery_date ? row.delivery_date.toISOString().split('T')[0] : '',
      total_amount: Number(row.total_amount || 0),
      status: row.status || '',
      currency: row.currency || '',
      line_count: Number(row.line_count || 0),
    })),
    pagination: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalCount,
      totalPages: Math.max(Math.ceil(totalCount / normalizedPageSize), 1),
    },
  };
};

// ── GET SINGLE PURCHASE ORDER ─────────────────────────────────────────────────

const getPurchaseQuotation = async (docEntry) => {
  // Get header
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
      T0.ReqDate AS RequiredDate,
      T0.TaxDate AS DocumentDate,
      ${selectPhysicalOptionalColumn(await getTableColumns('OPQT'), 'T0', 'BPLId', 'Branch')},
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
      T0.DocTotal AS TotalPaymentDue,
      T0.Confirmed,
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS DocumentStatus
    FROM OPQT T0
    LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`Purchase Quotation ${docEntry} not found`);
  }

  const header = headerRows[0];
  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OPQT', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'PQT1', keyValue: docEntry }),
  ]);

  const lineColumns = await getTableColumns('PQT1');
  const documentUom = await getDocumentUomSql(db, 'PQT1');
  const firstExistingLineColumn = (...columns) =>
    columns.map((column) => findPhysicalColumnName(lineColumns, column)).find(Boolean);
  const optionalLineColumn = (columns, alias, fallback = "''") => {
    const column = firstExistingLineColumn(...(Array.isArray(columns) ? columns : [columns]));
    return selectPhysicalOptionalColumn(lineColumns, 'T0', column, alias, fallback);
  };

  // Get lines
  const lineResult = await db.query(`
    SELECT 
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      ${await getDocumentUnitPriceSql(db, 'PQT1', 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TaxCode,
      T0.LineTotal,
      T0.WhsCode AS Warehouse,
      ${documentUom.entrySql} AS UoMEntry,
      ${documentUom.codeSql} AS UoMCode,
      ${documentUom.nameSql} AS UoMName,
      ${optionalLineColumn(['ReqDate', 'RequiredDate'], 'RequiredDate')},
      ${optionalLineColumn('ShipDate', 'ShipDate')},
      ${optionalLineColumn('OcrCode', 'DistributionRule')},
      ${optionalLineColumn('CountryOrg', 'CountryOfOrigin')},
      ${optionalLineColumn('LocCode', 'LocationCode')},
      ${optionalLineColumn('AgrNo', 'BlanketAgreementNo')}
    FROM PQT1 T0
    ${documentUom.joinSql}
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `, { docEntry });
  const lineRows = lineResult.recordset || [];
  if (!lineRows.length) {
    throw new Error(`Purchase Quotation ${docEntry} exists but its content lines could not be loaded.`);
  }

  // Get HSN codes for items
  const itemCodes = lineRows.map(l => l.ItemCode).filter(Boolean);
  let itemHsnMap = {};
  
  if (itemCodes.length > 0) {
    try {
      const hsnRows = await safe(db.query(`
        SELECT ItemCode, SWW AS HSNCode
        FROM OITM
        WHERE ItemCode IN (${itemCodes.map((_, i) => `@item${i}`).join(',')})
      `, itemCodes.reduce((acc, code, i) => ({ ...acc, [`item${i}`]: code }), {})));
      
      itemHsnMap = hsnRows.reduce((acc, row) => {
        acc[row.ItemCode] = row.HSNCode || '';
        return acc;
      }, {});
    } catch (err) {
      // Could not fetch HSN codes
    }
  }

  const firstUdfValue = (udfs, keys) => {
    for (const key of keys) {
      if (udfs[key] !== undefined && udfs[key] !== null && String(udfs[key]) !== '') {
        return String(udfs[key]);
      }
    }
    return '';
  };

  const result = {
    purchase_quotation: {
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
        requiredDate: header.RequiredDate ? header.RequiredDate.toISOString().split('T')[0] : '',
        documentDate: header.DocumentDate ? header.DocumentDate.toISOString().split('T')[0] : '',
        confirmed: header.Confirmed === 'Y',
        journalRemark: header.JournalRemark || '',
        paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
        otherInstruction: header.Remarks || '',
        discount: header.DiscountPercent != null ? String(header.DiscountPercent) : '',
        rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
        roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
        freight: header.Freight != null ? String(header.Freight) : '',
        tax: header.Tax != null ? String(header.Tax) : '',
        totalPaymentDue: header.TotalPaymentDue != null ? String(header.TotalPaymentDue) : '',
      },
      lines: lineRows.map(l => {
        const lineUdf = lineUdfsByLineNum[l.LineNum] || {};
        return {
          itemNo: l.ItemCode || '',
          itemDescription: l.ItemDescription || '',
          hsnCode: firstUdfValue(lineUdf, ['U_HSNCode', 'U_HSN']) || itemHsnMap[l.ItemCode] || '',
          sacCode: firstUdfValue(lineUdf, ['U_SACCode', 'U_SAC']),
          quantity: l.Quantity != null ? String(l.Quantity) : '',
          requiredQty: firstUdfValue(lineUdf, ['U_Req_Qty', 'U_ReqQty']),
          requiredDate: formatDateForInput(l.RequiredDate),
          quotedDate: formatDateForInput(l.ShipDate),
          sellerQty: firstUdfValue(lineUdf, ['U_S_Qty']),
          unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
          unitPriceUdf: firstUdfValue(lineUdf, ['U_Unit_Price']),
          taxCodeRepeat: firstUdfValue(lineUdf, ['U_TAXCODE', 'U_TaxCode']),
          price: firstUdfValue(lineUdf, ['U_PRICE', 'U_Price']),
          stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
          taxCode: l.TaxCode || '',
          total: l.LineTotal != null ? String(l.LineTotal) : '',
          totalLC: l.LineTotal != null ? String(l.LineTotal) : '',
          whse: l.Warehouse || '',
          uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
          uomCode: l.UoMCode || '',
          uomName: l.UoMName || l.UoMCode || '',
          distRule: l.DistributionRule || '',
          countryOfOrigin: l.CountryOfOrigin || '',
          loc: l.LocationCode != null ? String(l.LocationCode) : '',
          branch: l.LocationCode != null ? String(l.LocationCode) : '',
          blanketAgreementNo: l.BlanketAgreementNo != null ? String(l.BlanketAgreementNo) : '',
          U_Cost_Sheet: firstUdfValue(lineUdf, ['U_Cost_Sheet', 'U_COST_SHEET', 'U_COSTSHEET', 'U_CostSheet']),
          U_PackingType: firstUdfValue(lineUdf, ['U_PackingType', 'U_PACKINGTYPE', 'U_Packing_Type', 'U_PackingStatus', 'U_PACKINGSTATUS']),
          U_ContainerType: firstUdfValue(lineUdf, ['U_ContainerType', 'U_CONTAINERTYPE', 'U_Container_Type']),
          U_GrossWt: firstUdfValue(lineUdf, ['U_GrossWt', 'U_GROSSWT', 'U_Gross_Wt', 'U_GrossWeight', 'U_GROSSWEIGHT']),
          U_TotalPackage: firstUdfValue(lineUdf, ['U_TotalPackage', 'U_TOTALPACKAGE', 'U_Total_Package', 'U_TotalPackge']),
          specialRebate: firstUdfValue(lineUdf, ['U_SPLRBT']),
          commission: firstUdfValue(lineUdf, ['U_COMPRC']),
          sellerBrokeragePerQty: firstUdfValue(lineUdf, ['U_S_BrokPerQty']),
          sellerBrokerage: firstUdfValue(lineUdf, ['U_Brok_Seller']),
          buyerBrokerage: firstUdfValue(lineUdf, ['U_Brok_Buyer']),
          buyerDelivery: firstUdfValue(lineUdf, ['U_Buyer_Delivery']),
          sellerDelivery: firstUdfValue(lineUdf, ['U_Seller_Delivery']),
          buyerPaymentTerms: firstUdfValue(lineUdf, ['U_Buyer_Payment_Terms']),
          sellerPaymentTerms: firstUdfValue(lineUdf, ['U_Seller_Payment_Terms']),
          buyerQuality: firstUdfValue(lineUdf, ['U_Buyer_Quality']),
          sellerQuality: firstUdfValue(lineUdf, ['U_Seller_Quality']),
          buyerPrice: firstUdfValue(lineUdf, ['U_Buyer_Price']),
          sellerPrice: firstUdfValue(lineUdf, ['U_Seller_Price']),
          buyerSpecialInstruction: firstUdfValue(lineUdf, ['U_Buyer_SPINS']),
          sellerSpecialInstruction: firstUdfValue(lineUdf, ['U_Seller_SPINS']),
          sellerBrokerageAmtPer: firstUdfValue(lineUdf, ['U_Sel_Brok_AP']),
          sellerBrokeragePercent: firstUdfValue(lineUdf, ['U_Seller_Brok_Per']),
          buyerBillDiscount: firstUdfValue(lineUdf, ['U_Buyer_Bill_Disc']),
          sellerBillDiscount: firstUdfValue(lineUdf, ['U_Seller_Bill_Disc']),
          stcode: firstUdfValue(lineUdf, ['U_SELLTCODE']),
          sellerItem: firstUdfValue(lineUdf, ['U_S_Item']),
          freightPurchase: firstUdfValue(lineUdf, ['U_Freight_pur']),
          freightSales: firstUdfValue(lineUdf, ['U_Freight_sales']),
          freightProvider: firstUdfValue(lineUdf, ['U_Fr_trans']),
          freightProviderName: firstUdfValue(lineUdf, ['U_Fr_trans_name']),
          brokerageNumber: firstUdfValue(lineUdf, ['U_BDNum']),
          U_Fix_Brock_B: firstUdfValue(lineUdf, ['U_Fix_Brock_B', 'U_Fix_Brok_B', 'U_FIX_BROK_BUYER', 'U_FIXBROKBUYER', 'U_FixBrokBuyer']),
          U_Fix_Brock_S: firstUdfValue(lineUdf, ['U_Fix_Brock_S', 'U_Fix_Brok_S', 'U_Fix_Brock_Seller', 'U_FIXBROCKSELLER', 'U_FIXBROKSELLER', 'U_FixBrokSeller']),
          udf: lineUdf,
        };
      }),
      header_udfs: headerUdfs,
    }
  };

  return result;
};

const getOpenPurchaseQuotations = async (vendorCode = null) => {
  const result = await safe(db.query(`
    SELECT TOP 200
      T0.DocEntry,
      T0.DocNum,
      T0.DocDate,
      T0.DocDueDate,
      T0.CardCode,
      T0.CardName,
      T0.Comments,
      T0.DocTotal
    FROM OPQT T0
    WHERE T0.DocStatus = 'O'
      AND T0.CANCELED <> 'Y'
      AND (@vendorCode IS NULL OR T0.CardCode = @vendorCode)
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
  `, { vendorCode }));

  return result;
};

const getPurchaseQuotationForCopy = async (docEntry) => {
  const headerRows = await safe(db.query(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.DocDate,
      T0.DocDueDate,
      T0.TaxDate,
      T0.CardCode,
      T0.CardName,
      T0.CntctCode,
      T0.NumAtCard,
      T0.Comments,
      ${selectPhysicalOptionalColumn(await getTableColumns('OPQT'), 'T0', 'BPLId', 'BPLId')},
      ${selectPhysicalOptionalColumn(await getTableColumns('OPQT'), 'T0', 'BPLId', 'BPL_IDAssignedToInvoice')},
      T0.GroupNum,
      T0.DiscPrcnt,
      T0.RoundDif,
      T0.TotalExpns AS Freight
    FROM OPQT T0
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`Purchase Quotation ${docEntry} not found`);
  }

  const documentUom = await getDocumentUomSql(db, 'PQT1');
  const lineRows = await safe(db.query(`
    SELECT
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.OpenQty AS Quantity,
      ${await getDocumentUnitPriceSql(db, 'PQT1', 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.WhsCode AS WarehouseCode,
      T0.TaxCode,
      ${documentUom.entrySql} AS UomEntry,
      ${documentUom.codeSql} AS UomCode,
      ${documentUom.nameSql} AS UomName,
      CHP.ChapterID AS HSNCode,
      T0.DocEntry AS BaseEntry,
      T0.LineNum AS BaseLine,
      540000006 AS BaseType
    FROM PQT1 T0
    LEFT JOIN OITM ITM ON T0.ItemCode = ITM.ItemCode
    LEFT JOIN OCHP CHP ON ITM.ChapterID = CHP.AbsEntry
    ${documentUom.joinSql}
    WHERE T0.DocEntry = @docEntry
      AND T0.LineStatus = 'O'
      AND T0.OpenQty > 0
    ORDER BY T0.LineNum
  `, { docEntry }));

  return { ...headerRows[0], DocumentLines: lineRows };
};

// ── DOCUMENT SERIES ───────────────────────────────────────────────────────────

const getDocumentSeries = async (branch = null, targetDate = null) => {
  return {
    series: await getMarketingDocumentSeries({
      db,
      objectCode: '540000006',
      targetDate,
      branch: branch ?? '',
      docSubType: '--',
      collapseToSapVisible: true,
    }),
  };
};

const getNextNumber = async (series) => {
  const result = await safe(db.query(`
    SELECT NextNumber
    FROM NNM1
    WHERE Series = @series
      AND ObjectCode = '540000006'
  `, { series }));

  if (result.length > 0) {
    return { nextNumber: result[0].NextNumber };
  }

  return { nextNumber: null };
};

// ── STATE FROM ADDRESS ────────────────────────────────────────────────────────

const getStateFromAddress = async (vendorCode, addressCode) => {
  const result = await safe(db.query(`
    SELECT State
    FROM CRD1
    WHERE CardCode = @vendorCode
      AND Address = @addressCode
  `, { vendorCode, addressCode }));

  if (result.length > 0) {
    return { state: result[0].State || '' };
  }

  return { state: '' };
};

const getStateFromWarehouse = async (whsCode) => {
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

// ── MAIN REFERENCE DATA FUNCTION ──────────────────────────────────────────────

const getReferenceData = async () => {
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
  ] = await Promise.all([
    getVendors(),
    getItems(),
    getWarehouses(),
    getPaymentTerms(),
    getSalesEmployees(),
    getShippingTypes(),
    getBranches(),
    getStates(),
    getTaxCodes(),
    getUomGroups(),
    getDecimalSettings(),
    getCompanyInfo(),
    getMarketingDocumentUdfs({ headerTable: 'OPQT', lineTable: 'PQT1' }),
  ]);

  const uom_groups = uomGroupsRaw;

  // Decimal settings
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

  // Company info
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
    vendors,
    contacts: [],
    pay_to_addresses: [],
    items,
    warehouses,
    warehouse_addresses: warehouses,
    company_address: { State: companyInfo.state },
    tax_codes: taxCodes,
    payment_terms: paymentTerms,
    sales_employees: salesEmployees.map((e) => ({ SlpCode: e.SlpCode, SlpName: e.SlpName, Memo: e.Memo, Commission: e.Commission, Active: e.Active })),
    shipping_types: shippingTypes,
    branches,
    states,
    uom_groups,
    decimal_settings: decimalSettings,
    udf_metadata: udfMetadata,
    warnings: [],
  };
};

// ── VENDOR DETAILS ────────────────────────────────────────────────────────────

const getVendorDetails = async (vendorCode) => {
  if (!vendorCode) {
    return {
      contacts: [],
      pay_to_addresses: [],
      bill_to_addresses: [],
      ship_to_addresses: [],
    };
  }

  const [contacts, addresses] = await Promise.all([
    getContactsByVendor(vendorCode),
    getAddressesByVendor(vendorCode),
  ]);

  // Filter pay-to addresses (Bill To)
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

// ── EXPORTS ───────────────────────────────────────────────────────────────────

module.exports = {
  getReferenceData,
  searchVendors,
  getVendorDetails,
  getPurchaseQuotationList,
  getPurchaseQuotation,
  getOpenPurchaseQuotations,
  getPurchaseQuotationForCopy,
  getDocumentSeries,
  getNextNumber,
  getStateFromAddress,
  getStateFromWarehouse,
};
