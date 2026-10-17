/**
 * Goods Receipt PO DB Service - ODBC/Direct SQL for GET operations
 * Reads data directly from SAP B1 SQL Server database
 */
const db = require('./dbService');
const { getDocumentUnitPriceSql } = require('./documentUnitPriceDbUtils');
const { getDocumentUomSql, loadCompanyUomGroups } = require('./documentUomDbUtils');
const { getDocumentReferences } = require('./documentReferencesDbUtils');
const { createTableColumnDetailsReader, createPhysicalColumnSetReader, selectPhysicalOptionalColumn } = require('./salesDocumentDbCompatibility');
const { loadBusinessPartnerAddresses } = require('./businessPartnerAddressDbUtils');
const masterDataDbService = require('./masterDataDbService');
const { getHeaderUdfValues, getLineUdfValues, getMarketingDocumentUdfs } = require('./udfMetadataService');
const { buildMarketingDocumentListFilterQuery } = require('./documentListUtils');
const { getPlaceOfSupplyUdfValue } = require('./placeOfSupplyUtils');
const { getMarketingDocumentSeries } = require('./documentSeriesDbUtils');

const buildCopyRemarks = (sourceRemarks, baseRemark) => {
  const remarks = String(sourceRemarks || '').trim();
  const base = String(baseRemark || '').trim();

  if (!remarks) return base;
  if (!base || remarks.toLowerCase().includes(base.toLowerCase())) return remarks;

  return `${remarks}\n${base}`;
};

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

const normalizeUdfLookupToken = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^U_/, '')
    .replace(/[^A-Z0-9]+/g, '');

const getUdfValue = (udfs = {}, aliases = []) => {
  const aliasTokens = new Set((Array.isArray(aliases) ? aliases : [aliases]).map(normalizeUdfLookupToken).filter(Boolean));
  const match = Object.entries(udfs || {}).find(([key, value]) =>
    aliasTokens.has(normalizeUdfLookupToken(key)) &&
    value !== undefined &&
    value !== null &&
    String(value) !== ''
  );
  return match ? match[1] : '';
};

// ── REFERENCE DATA QUERIES ────────────────────────────────────────────────────

const getVendors = () => safe(db.query(`
  SELECT CardCode, CardName, CardType, Currency, Balance,
         VatGroup, GroupNum AS PayTermsGrpCode, ListNum
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
         CAST(COALESCE(NULLIF(T0.LastPurPrc, 0), NULLIF(T0.AvgPrice, 0), 0) AS DECIMAL(19,6)) AS Price,
         T0.LastPurPrc  AS LastPurchasePrice,
         T0.AvgPrice    AS MovingAveragePrice,
         COALESCE(CHP.ChapterID, T0.SWW, '') AS HSNCode,
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
    CAST(COALESCE(NULLIF(T0.LastPurPrc, 0), NULLIF(T0.AvgPrice, 0), 0) AS DECIMAL(19,6)) AS Price,
    T0.LastPurPrc      AS LastPurchasePrice,
    T0.AvgPrice        AS MovingAveragePrice,
    COALESCE(CHP.ChapterID, T0.SWW, '') AS HSNCode,
    T0.ManBtchNum      AS BatchManaged,
    T0.ManSerNum       AS SerialManaged
  FROM OITM T0
  LEFT JOIN OITB T1  ON T1.ItmsGrpCod = T0.ItmsGrpCod
  LEFT JOIN OUOM PU ON PU.UomEntry = T0.PUoMEntry
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
    State,
    MainCurncy,
    SysCurrncy
  FROM OADM
`));

const GRPO_FORM_ID = '143';
const GRPO_MATRIX_ITEM_ID = '38';

const GRPO_LINE_COLUMNS = [
  { key: 'itemNo', label: 'Item No.', sapField: 'ItemCode', sapColumnIds: ['1', 'ItemCode', 'Item No.', 'ItemNo'], minWidth: 160 },
  { key: 'itemDescription', label: 'Item Description', sapField: 'Dscription', sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Item Description'], minWidth: 220 },
  { key: 'hsnCode', label: 'HSN', sapField: 'ChapterID', source: 'item-master', sapColumnIds: ['254000391', 'HSN', 'HSN/SAC', 'ChapterID', 'HsnEntry', 'U_HSNCode', 'U_HSN'], minWidth: 115 },
  { key: 'quantity', label: 'Quantity', sapField: 'Quantity', sapColumnIds: ['11', 'Quantity', 'Qty'], minWidth: 90 },
  { key: 'unitPrice', label: 'Unit Price', sapField: 'Price', alternativeFields: ['PriceBefDi'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'UnitPrice', 'Unit Price'], minWidth: 110 },
  { key: 'uomCode', label: 'UoM Code', sapField: 'UomCode', alternativeFields: ['UomEntry'], sapColumnIds: ['1470002149', 'UomCode', 'UoMCode', 'UoM Code'], minWidth: 105 },
  { key: 'uomName', label: 'UoM Name', sapField: 'unitMsr', alternativeFields: [], sapColumnIds: ['1470002145', 'unitMsr', 'UomName', 'UoM Name'], minWidth: 120 },
  { key: 'stdDiscount', label: 'Discount %', sapField: 'DiscPrcnt', sapColumnIds: ['15', 'DiscPrcnt', 'DiscountPercent', 'Discount %', 'Disc%'], minWidth: 95 },
  { key: 'taxCode', label: 'Tax Code', sapField: 'TaxCode', sapColumnIds: ['160', 'TaxCode', 'Tax Code'], minWidth: 115 },
  { key: 'totalBeforeTax', label: 'Total Before Tax', sapField: 'LineTotal', calculated: true, sapColumnIds: ['21', 'LineTotal', 'Total Before Tax'], minWidth: 135 },
  { key: 'total', label: 'Total (LC)', sapField: 'LineTotal', calculated: true, sapColumnIds: ['17', 'GTotal', 'Total', 'Total (LC)', 'LineTotal'], minWidth: 115 },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', sapField: 'CountryOrg', sapColumnIds: ['10002037', 'CountryOrg', 'Country/Region of Origin'], minWidth: 185 },
  { key: 'distRule', label: 'Distr. Rule', sapField: 'OcrCode', sapColumnIds: ['21', 'OcrCode', 'DistributionRule', 'Distr. Rule'], minWidth: 105 },
  { key: 'loc', label: 'Loc.', source: 'branch', sapField: 'LocCode', sapColumnIds: ['10002047', 'LocCode', 'Location', 'Loc.'], minWidth: 115 },
  { key: 'sac', label: 'SAC', sapField: 'SacEntry', source: 'item-master', sapColumnIds: ['254000393', 'SacEntry', 'SAC'], minWidth: 105 },
  { key: 'blanketAgreementNo', label: 'Blanket Agreement No.', sapField: 'AgrNo', sapColumnIds: ['1000', 'AgrNo', 'Blanket Agreement No.'], minWidth: 170 },
  { key: 'costSheet', label: 'Cost-Sheet', sapField: 'U_Cost_Sheet', sapColumnIds: ['U_Cost_Sheet', 'Cost-Sheet'], minWidth: 130 },
  { key: 'packingType', label: 'Packing-Type', sapField: 'U_PackingType', sapColumnIds: ['U_PackingType', 'Packing-Type'], minWidth: 140 },
  { key: 'containerType', label: 'Container Type', sapField: 'U_ContainerType', sapColumnIds: ['U_ContainerType', 'Container Type'], minWidth: 145 },
  { key: 'grossWt', label: 'GrossWt', sapField: 'U_GrossWt', sapColumnIds: ['U_GrossWt', 'GrossWt'], minWidth: 110 },
  { key: 'totalPackage', label: 'Total-Package', sapField: 'U_TotalPackage', sapColumnIds: ['U_TotalPackage', 'Total-Package'], minWidth: 130 },
  { key: 'whse', label: 'Whse', sapField: 'WhsCode', sapColumnIds: ['24', 'WhsCode', 'WarehouseCode', 'Warehouse', 'Whse'], minWidth: 90 },
  { key: 'binLocationAllocation', label: 'Bin Location Allocation', source: 'batch-bin', sapColumnIds: ['BinAlloc', 'Bin Location Allocation'], minWidth: 160 },
];

const truthySapFlag = (value) => ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(
  String(value ?? '').trim().toUpperCase(),
);

const falsySapFlag = (value) => ['N', 'NO', 'FALSE', '0', 'TNO'].includes(
  String(value ?? '').trim().toUpperCase(),
);

const sapFlagToBoolean = (value, fallback = true) => {
  if (truthySapFlag(value)) return true;
  if (falsySapFlag(value)) return false;
  return fallback;
};

const normalizePreferenceKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^U_/, '')
    .replace(/[^A-Z0-9]/g, '');

const readLineTableColumnDetails = createTableColumnDetailsReader({ database: db });
const getHeaderTableColumns = createPhysicalColumnSetReader(db);
const getLineTableColumns = async (tableName) => {
  const rows = await readLineTableColumnDetails(tableName);

  return rows.reduce((acc, row) => {
    const columnName = row.columnName;
    if (!columnName) return acc;
    acc[columnName.toUpperCase()] = {
      name: columnName,
      dataType: row.dataType,
      maxLength: row.maxLength,
      precision: row.numericPrecision,
      scale: row.numericScale,
      nullable: row.nullable,
      ordinal: row.ordinal,
    };
    return acc;
  }, {});
};

const selectPdn1ColumnOrBlank = (columnMap, columnName, alias = columnName) =>
  selectPhysicalOptionalColumn(Object.values(columnMap).map((column) => column.name), 'T0', columnName, alias);

const resolveSapUserSign = async () => {
  let sapUsername = '';

  try {
    const { getActiveCompanyConfig } = require('./companyConfigService');
    const activeConfig = await getActiveCompanyConfig();
    sapUsername = String(activeConfig.serviceLayer?.username || '').trim();
  } catch (_error) {
    sapUsername = '';
  }

  if (!sapUsername) return null;

  const rows = await safe(db.query(`
    SELECT TOP 1 USERID
    FROM OUSR
    WHERE USER_CODE = @sapUsername
       OR U_NAME = @sapUsername
    ORDER BY
      CASE WHEN USER_CODE = @sapUsername THEN 0 ELSE 1 END,
      USERID
  `, { sapUsername }));

  const userSign = Number(rows[0]?.USERID);
  return Number.isFinite(userSign) ? userSign : null;
};

const getColumnPreferences = async ({ formId, itemId, tableName }) => {
  const tableRows = await safe(db.query(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'CPRF'
  `));

  if (!tableRows.length) return { byKey: {}, rows: [], userSign: null };

  const cprfColumns = await safe(db.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'CPRF'
  `));
  const columnSet = new Set(cprfColumns.map((row) => String(row.COLUMN_NAME || '').trim()));
  const hasItemUid = columnSet.has('ItemUID');
  const hasTableName = columnSet.has('TableName');
  const userSign = await resolveSapUserSign();
  if (userSign == null) return { byKey: {}, rows: [], userSign: null };

  const rows = await safe(db.query(`
    SELECT
      FormID,
      ItemID,
      ColID,
      Width,
      VisInForm,
      VisualIndx,
      EditInForm,
      VisInExpnd,
      ExpandIndx,
      EditInEXP,
      UserSign,
      TPLId
      ${hasTableName ? ', TableName' : ", '' AS TableName"}
      ${hasItemUid ? ', ItemUID' : ", '' AS ItemUID"}
    FROM CPRF
    WHERE FormID = @formId
      AND (
        ItemID = @itemId
        ${hasItemUid ? 'OR ItemUID = @itemId' : ''}
        ${hasTableName ? 'OR TableName = @tableName' : ''}
      )
      AND UserSign = @userSign
    ORDER BY
      CASE WHEN TPLId = 0 THEN 0 ELSE 1 END,
      VisualIndx,
      ColID
  `, { formId, itemId, tableName, userSign }));

  const byKey = rows.reduce((acc, row) => {
    [row.ColID, row.TableName, row.ItemUID]
      .map(normalizePreferenceKey)
      .filter(Boolean)
      .forEach((key) => {
        if (!acc[key]) acc[key] = row;
      });

    return acc;
  }, {});

  return { byKey, rows, userSign };
};

const findColumnPreference = (column, preferences = {}) => {
  const candidates = [
    column.key,
    column.sapField,
    ...(column.alternativeFields || []),
    ...(column.sapColumnIds || []),
  ].map(normalizePreferenceKey).filter(Boolean);

  for (const candidate of candidates) {
    if (preferences[candidate]) return preferences[candidate];
  }

  return null;
};

const getColumnMetadata = (column, lineColumns = {}) => {
  const candidates = [
    column.sapField,
    ...(column.alternativeFields || []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const metadata = lineColumns[String(candidate).toUpperCase()];
    if (metadata) return metadata;
  }

  return null;
};

const getGRPOLineFieldMetadata = async () => {
  const [lineColumns, preferencesResult] = await Promise.all([
    getLineTableColumns('PDN1'),
    getColumnPreferences({
      formId: GRPO_FORM_ID,
      itemId: GRPO_MATRIX_ITEM_ID,
      tableName: 'PDN1',
    }),
  ]);

  const matrixColumns = GRPO_LINE_COLUMNS
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
        source: column.source || (column.calculated ? 'calculated' : 'PDN1'),
        dataType: metadata?.dataType || '',
        maxLength: metadata?.maxLength || undefined,
        precision: metadata?.precision || undefined,
        scale: metadata?.scale || undefined,
        required: metadata ? !metadata.nullable : false,
        readOnly: Boolean(column.calculated),
        visible,
        active,
        minWidth: Number.isFinite(width) && width > 0
          ? Math.max(width, column.minWidth || 125)
          : (column.minWidth || 125),
        order: Number.isFinite(Number(preference?.VisualIndx))
          ? Number(preference.VisualIndx)
          : index + 1,
        sapColumnId: preference?.ColID || '',
      };
    })
    .filter(Boolean)
    .sort((left, right) => (left.order || 0) - (right.order || 0));

  return {
    matrix_columns: matrixColumns,
    sap_form: {
      formId: GRPO_FORM_ID,
      matrixItemId: GRPO_MATRIX_ITEM_ID,
      userSign: preferencesResult.userSign,
      preferenceRows: preferencesResult.rows.length,
    },
    _preferencesByKey: preferencesResult.byKey,
  };
};

const applyLineColumnPreferencesToUdfs = (udfMetadata = {}, preferences = {}) => {
  const rows = (udfMetadata.rows || []).map((field) => {
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
  });

  return {
    ...udfMetadata,
    rows,
  };
};

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
  const { addresses } = await loadBusinessPartnerAddresses(db, cardCode, { context: 'GRPO' });
  return addresses;
};

// ── PURCHASE ORDERS (FOR COPY FROM) ───────────────────────────────────────────

const getOpenPurchaseOrders = async (vendorCode = null) => {
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
      FROM OPOR T0
      WHERE T0.DocStatus = 'O'
        AND T0.CANCELED <> 'Y'
        AND EXISTS (
          SELECT 1
          FROM POR1 T1
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
      FROM OPOR T0
      WHERE T0.DocStatus = 'O'
        AND T0.CANCELED <> 'Y'
        AND EXISTS (
          SELECT 1
          FROM POR1 T1
          WHERE T1.DocEntry = T0.DocEntry
            AND T1.LineStatus = 'O'
            AND ISNULL(T1.OpenQty, 0) > 0
        )
      ORDER BY T0.DocEntry DESC
    `;

  const result = await safe(
    vendorCode ? db.query(query, { vendorCode }) : db.query(query)
  );

  return { orders: result };
};

const getPurchaseOrderForCopy = async (docEntry) => {
  // Get header
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
      ${selectPhysicalOptionalColumn(await getHeaderTableColumns('OPOR'), 'T0', 'BPLId', 'Branch')},
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
      T0.ShipToCode,
      T0.PayToCode,
      T0.Address AS ShipToAddress,
      T0.Address2 AS PayToAddress
    FROM OPOR T0
    LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`Purchase Order ${docEntry} not found`);
  }

  const header = headerRows[0];
  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OPOR', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'POR1', keyValue: docEntry }),
  ]);

  // Get lines with open quantity
  const documentUom = await getDocumentUomSql(db, 'POR1');
  const lineRows = await safe(db.query(`
    SELECT 
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      T0.OpenQty,
      ${await getDocumentUnitPriceSql(db, 'POR1', 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TaxCode,
      CASE
        WHEN ISNULL(T0.Quantity, 0) = 0 THEN ISNULL(T0.LineTotal, 0)
        ELSE ISNULL(T0.LineTotal, 0) * ISNULL(T0.OpenQty, 0) / NULLIF(T0.Quantity, 0)
      END AS LineTotal,
      CASE
        WHEN ISNULL(T0.Quantity, 0) = 0 THEN ISNULL(T0.VatSum, 0)
        ELSE ISNULL(T0.VatSum, 0) * ISNULL(T0.OpenQty, 0) / NULLIF(T0.Quantity, 0)
      END AS TaxAmount,
      ${selectPdn1ColumnOrBlank(await getLineTableColumns('POR1'), 'Commission', 'CommissionPercent')},
      T0.WhsCode AS Warehouse,
      ${documentUom.entrySql} AS UoMEntry,
      ${documentUom.codeSql} AS UoMCode,
      ${documentUom.nameSql} AS UoMName
    FROM POR1 T0
    ${documentUom.joinSql}
    WHERE T0.DocEntry = @docEntry
      AND T0.LineStatus = 'O'
      AND T0.OpenQty > 0
    ORDER BY T0.LineNum
  `, { docEntry }));

  // Get HSN codes and batch info for items
  const itemCodes = lineRows.map(l => l.ItemCode).filter(Boolean);
  let itemInfoMap = {};
  
  if (itemCodes.length > 0) {
    try {
      const itemRows = await safe(db.query(`
        SELECT T0.ItemCode,
               COALESCE(CHP.ChapterID, T0.SWW, '') AS HSNCode,
               T0.ManBtchNum AS BatchManaged
        FROM OITM T0
        LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
        WHERE T0.ItemCode IN (${itemCodes.map((_, i) => `@item${i}`).join(',')})
      `, itemCodes.reduce((acc, code, i) => ({ ...acc, [`item${i}`]: code }), {})));
      
      itemInfoMap = itemRows.reduce((acc, row) => {
        acc[row.ItemCode] = {
          hsnCode: row.HSNCode || '',
          batchManaged: row.BatchManaged === 'Y',
        };
        return acc;
      }, {});
    } catch (err) {
      // Could not fetch item info
    }
  }

  return {
    header: {
      vendor: header.CardCode,
      name: header.CardName,
      contactPerson: header.ContactPersonCode ? String(header.ContactPersonCode) : '',
      salesContractNo: header.VendorRefNo || '',
      branch: header.Branch ? String(header.Branch) : '',
      paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
      salesEmployee: header.SalesEmployeeCode ? String(header.SalesEmployeeCode) : '',
      purchaser: header.SalesEmployeeName || '',
      currency: header.Currency || '',
      exchangeRate: header.ExchangeRate == null ? '' : String(header.ExchangeRate),
      shipToCode: header.ShipToCode || '',
      shipTo: header.ShipToAddress || '',
      shipToAddress: header.ShipToAddress || '',
      payToCode: header.PayToCode || '',
      payTo: header.PayToAddress || '',
      payToAddress: header.PayToAddress || '',
      buyerLocation: getUdfValue(headerUdfs, ['U_ShipLocation', 'U_SHIPLOCATION']) || '',
      journalRemark: header.JournalRemark || '',
      discount: header.DiscountPercent != null ? String(header.DiscountPercent) : '',
      rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
      roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
      freight: header.Freight != null ? String(header.Freight) : '',
      tax: header.Tax != null ? String(header.Tax) : '',
      totalPaymentDue: header.TotalPaymentDue != null ? String(header.TotalPaymentDue) : '',
      otherInstruction: buildCopyRemarks(
        header.Remarks,
        header.DocNum ? `Based On Purchase Orders ${header.DocNum}.` : ''
      ),
    },
    header_udfs: headerUdfs,
    lines: lineRows.map(l => {
      const itemInfo = itemInfoMap[l.ItemCode] || { hsnCode: '', batchManaged: false };
      return ({
      baseEntry: docEntry,
      baseType: 22, // Purchase Order
      baseLine: l.LineNum,
      itemNo: l.ItemCode || '',
      itemDescription: l.ItemDescription || '',
      hsnCode: itemInfo.hsnCode,
      quantity: l.OpenQty != null ? String(l.OpenQty) : '',
      openQty: l.OpenQty != null ? String(l.OpenQty) : '',
      unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
      stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
      taxCode: l.TaxCode || '',
      total: l.LineTotal != null ? String(l.LineTotal) : '',
      totalBeforeTax: l.LineTotal != null ? String(l.LineTotal) : '',
      totalLC: l.LineTotal != null ? String(l.LineTotal) : '',
      LineTotal: l.LineTotal != null ? String(l.LineTotal) : '',
      taxAmount: l.TaxAmount != null ? String(l.TaxAmount) : '',
      LineTaxAmount: l.TaxAmount != null ? String(l.TaxAmount) : '',
      commPercent: l.CommissionPercent != null ? String(l.CommissionPercent) : '',
      whse: l.Warehouse || '',
      uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
      uomCode: l.UoMCode || '',
      uomName: l.UoMName || l.UoMCode || '',
      batchManaged: itemInfo.batchManaged,
      batches: [],
      udf: lineUdfsByLineNum[l.LineNum] || {},
    })}),
  };
};

// ── GRPO LIST ─────────────────────────────────────────────────────────────────

const getGRPOList = async ({
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
    FROM OPDN T0
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
        FROM PDN1 T1
        WHERE T1.DocEntry = T0.DocEntry
      ) AS line_count
    FROM OPDN T0
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    grpos: result.map((row) => ({
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

// ── GET SINGLE GRPO ───────────────────────────────────────────────────────────

const getGRPO = async (docEntry) => {
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
      ${selectPhysicalOptionalColumn(await getHeaderTableColumns('OPDN'), 'T0', 'BPLId', 'Branch')},
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
      T0.ShipToCode,
      T0.PayToCode,
      T0.Address AS ShipToAddress,
      T0.Address2 AS PayToAddress,
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS DocumentStatus
    FROM OPDN T0
    LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode
    WHERE T0.DocEntry = @docEntry
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`GRPO ${docEntry} not found`);
  }

  const header = headerRows[0];
  const [headerUdfs, lineUdfsByLineNum, pdn1Columns, referenceDocuments] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OPDN', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'PDN1', keyValue: docEntry }),
    getLineTableColumns('PDN1'),
    getDocumentReferences(db, 'PDN21', docEntry),
  ]);
  const documentUom = await getDocumentUomSql(db, 'PDN1');

  const lineResult = await db.query(`
    SELECT 
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      T0.OpenQty,
      T0.LineStatus,
      ${await getDocumentUnitPriceSql(db, 'PDN1', 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TaxCode,
      'N' AS WTLiable,
      T0.LineTotal,
      T0.VatSum AS TaxAmount,
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'Commission', 'CommissionPercent')},
      T0.WhsCode AS Warehouse,
      ${documentUom.entrySql} AS UoMEntry,
      ${documentUom.codeSql} AS UoMCode,
      ${documentUom.nameSql} AS UoMName,
      T0.BaseEntry,
      T0.BaseType,
      T0.BaseLine,
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'OcrCode', 'DistRule')},
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'CountryOrg', 'CountryOfOrigin')},
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'AgrNo', 'BlanketAgreementNo')},
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'SACEntry', 'SACCode')},
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'U_Cost_Sheet', 'CostSheet')},
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'U_PackingType', 'PackingType')},
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'U_ContainerType', 'ContainerType')},
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'U_GrossWt', 'GrossWt')},
      ${selectPdn1ColumnOrBlank(pdn1Columns, 'U_TotalPackage', 'TotalPackage')}
    FROM PDN1 T0
    ${documentUom.joinSql}
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `, { docEntry });
  const lineRows = lineResult.recordset || [];
  if (!lineRows.length) {
    const error = new Error(`Goods Receipt PO ${docEntry} exists but its content lines could not be loaded.`);
    error.code = 'GRPO_LINES_NOT_LOADED';
    error.statusCode = 500;
    throw error;
  }

  const itemCodes = lineRows.map(l => l.ItemCode).filter(Boolean);
  let itemInfoMap = {};
  
  if (itemCodes.length > 0) {
    try {
      const itemRows = await safe(db.query(`
        SELECT T0.ItemCode,
               COALESCE(CHP.ChapterID, T0.SWW, '') AS HSNCode,
               T0.ManBtchNum AS BatchManaged,
               T0.WTLiable AS ItemWTLiable
        FROM OITM T0
        LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
        WHERE T0.ItemCode IN (${itemCodes.map((_, i) => `@item${i}`).join(',')})
      `, itemCodes.reduce((acc, code, i) => ({ ...acc, [`item${i}`]: code }), {})));
      
      itemInfoMap = itemRows.reduce((acc, row) => {
        acc[row.ItemCode] = {
          hsnCode: row.HSNCode || '',
          batchManaged: row.BatchManaged === 'Y',
          wtaxLiable: String(row.ItemWTLiable || '').toUpperCase() === 'Y',
        };
        return acc;
      }, {});
    } catch (err) {
      // Could not fetch item info
    }
  }

  const batchRows = await safe(db.query(`
    SELECT T0.BaseLinNum AS BaseLineNum,
           T0.BatchNum,
           T0.Quantity,
           T1.MnfSerial AS SupplierLotNo
    FROM IBT1 T0
    LEFT JOIN OBTN T1
      ON T1.ItemCode = T0.ItemCode
     AND T1.SysNumber = T0.SysNumber
    WHERE T0.BaseEntry = @docEntry
      AND T0.BaseType = 20
    ORDER BY T0.BaseLinNum, T0.BatchNum
  `, { docEntry }));

  const batchesByLine = {};
  batchRows.forEach(b => {
    if (!batchesByLine[b.BaseLineNum]) {
      batchesByLine[b.BaseLineNum] = [];
    }
    batchesByLine[b.BaseLineNum].push({
      batchNumber: b.BatchNum || '',
      quantity: String(b.Quantity || 0),
      supplierLotNo: b.SupplierLotNo || '',
    });
  });

  return {
    grpo: {
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
        postingDate: header.PostingDate ? header.PostingDate.toISOString().split('T')[0] : '',
        deliveryDate: header.DeliveryDate ? header.DeliveryDate.toISOString().split('T')[0] : '',
        documentDate: header.DocumentDate ? header.DocumentDate.toISOString().split('T')[0] : '',
        currency: header.Currency || '',
        exchangeRate: header.ExchangeRate == null ? '' : String(header.ExchangeRate),
        journalRemark: header.JournalRemark || '',
        paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
        shipToCode: header.ShipToCode || '',
        shipTo: header.ShipToAddress || '',
        shipToAddress: header.ShipToAddress || '',
        payToCode: header.PayToCode || '',
        payTo: header.PayToAddress || '',
        payToAddress: header.PayToAddress || '',
        buyerLocation: getUdfValue(headerUdfs, ['U_ShipLocation', 'U_SHIPLOCATION']) || '',
        placeOfSupply: getPlaceOfSupplyUdfValue(headerUdfs),
        otherInstruction: header.Remarks || '',
        discount: header.DiscountPercent != null ? String(header.DiscountPercent) : '',
        rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
        roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
        freight: header.Freight != null ? String(header.Freight) : '',
        tax: header.Tax != null ? String(header.Tax) : '',
        totalPaymentDue: header.TotalPaymentDue != null ? String(header.TotalPaymentDue) : '',
      },
      lines: lineRows.map(l => {
        const itemInfo = itemInfoMap[l.ItemCode] || { hsnCode: '', batchManaged: false, wtaxLiable: false };
        return ({
        lineNum: l.LineNum,
        baseEntry: l.BaseEntry || null,
        baseType: l.BaseType || null,
        baseLine: l.BaseLine || null,
        itemNo: l.ItemCode || '',
        itemDescription: l.ItemDescription || '',
        hsnCode: itemInfo.hsnCode,
        quantity: l.Quantity != null ? String(l.Quantity) : '',
        openQty: l.OpenQty != null ? String(l.OpenQty) : '',
        lineStatus: String(l.LineStatus || '').toUpperCase() === 'O' ? 'Open' : 'Closed',
        unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
        stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
        taxCode: l.TaxCode || '',
        wtaxLiable: itemInfo.wtaxLiable ? 'Y' : 'N',
        total: l.LineTotal != null ? String(l.LineTotal) : '',
        totalBeforeTax: l.LineTotal != null ? String(l.LineTotal) : '',
        totalLC: l.LineTotal != null ? String(l.LineTotal) : '',
        LineTotal: l.LineTotal != null ? String(l.LineTotal) : '',
        taxAmount: l.TaxAmount != null ? String(l.TaxAmount) : '',
        LineTaxAmount: l.TaxAmount != null ? String(l.TaxAmount) : '',
        commPercent: l.CommissionPercent != null ? String(l.CommissionPercent) : '',
        whse: l.Warehouse || '',
        uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
        uomCode: l.UoMCode || '',
        uomName: l.UoMName || l.UoMCode || '',
        distRule: l.DistRule || '',
        countryOfOrigin: l.CountryOfOrigin || '',
        loc: header.Branch ? String(header.Branch) : '',
        branch: header.Branch ? String(header.Branch) : '',
        sac: l.SACCode != null ? String(l.SACCode) : '',
        blanketAgreementNo: l.BlanketAgreementNo != null ? String(l.BlanketAgreementNo) : '',
        costSheet: l.CostSheet || '',
        packingType: l.PackingType || '',
        containerType: l.ContainerType || '',
        grossWt: l.GrossWt != null ? String(l.GrossWt) : '',
        totalPackage: l.TotalPackage != null ? String(l.TotalPackage) : '',
        batchManaged: itemInfo.batchManaged,
        batches: batchesByLine[l.LineNum] || [],
        udf: lineUdfsByLineNum[l.LineNum] || {},
      })}),
      header_udfs: headerUdfs,
      reference_documents: referenceDocuments,
    }
  };
};

const getBatchesByItem = async (itemCode, whsCode) => {
  const result = await safe(db.query(`
    SELECT
      T0.BatchNum AS BatchNumber,
      T0.Quantity AS AvailableQty,
      T0.ExpDate AS ExpiryDate,
      T1.MnfSerial AS SupplierLotNo
    FROM OIBT T0
    LEFT JOIN OBTN T1
      ON T1.ItemCode = T0.ItemCode
     AND T1.SysNumber = T0.SysNumber
    WHERE T0.ItemCode = @itemCode
      AND T0.WhsCode = @whsCode
      AND T0.Quantity > 0
    ORDER BY T0.ExpDate
  `, { itemCode, whsCode }));

  return { batches: result };
};

const buildNextBatchNumber = (latestBatchNumber = '', prefix = 'JKL') => {
  const normalizedPrefix = String(prefix || 'JKL').trim().toUpperCase() || 'JKL';
  const suffix = String(latestBatchNumber || '').trim().slice(normalizedPrefix.length);
  const numeric = Number.parseInt(suffix, 10);

  if (Number.isFinite(numeric)) {
    return `${normalizedPrefix}${String(numeric + 1).padStart(Math.max(suffix.length, 6), '0')}`;
  }

  const year = String(new Date().getFullYear()).slice(-2);
  return `${normalizedPrefix}${year}0001`;
};

const getNextBatchNumber = async ({ prefix = 'JKL' } = {}) => {
  const normalizedPrefix = String(prefix || 'JKL').trim().toUpperCase() || 'JKL';
  const rows = await safe(db.query(`
    SELECT TOP 100
      T0.DistNumber
    FROM OBTN T0
    WHERE UPPER(T0.DistNumber) LIKE @prefixLike
      AND LEN(T0.DistNumber) > LEN(@prefix)
    ORDER BY T0.DistNumber DESC
  `, {
    prefix: normalizedPrefix,
    prefixLike: `${normalizedPrefix}%`,
  }));
  const latest = rows
    .map((row) => {
      const distNumber = String(row.DistNumber || '').trim();
      const suffix = distNumber.slice(normalizedPrefix.length);
      return {
        distNumber,
        suffixValue: Number.parseInt(suffix, 10),
        suffix,
      };
    })
    .filter((row) => /^\d+$/.test(row.suffix) && Number.isFinite(row.suffixValue))
    .sort((left, right) => right.suffixValue - left.suffixValue || right.distNumber.localeCompare(left.distNumber))[0];

  return {
    prefix: normalizedPrefix,
    nextBatchNumber: buildNextBatchNumber(latest?.distNumber || '', normalizedPrefix),
    previousBatchNumber: latest?.distNumber || '',
  };
};

// ── DOCUMENT SERIES ───────────────────────────────────────────────────────────

const getDocumentSeries = async (targetDate = null, { branch = '' } = {}) => ({
  series: await getMarketingDocumentSeries({
    db,
    objectCode: '20',
    targetDate,
    branch,
    docSubType: '--',
    collapseToSapVisible: true,
  }),
});

const getNextNumber = async (series) => {
  const result = await safe(db.query(`
    SELECT NextNumber
    FROM NNM1
    WHERE Series = @series
      AND ObjectCode = '20'
  `, { series }));

  if (result.length > 0) {
    return { nextNumber: result[0].NextNumber };
  }

  return { nextNumber: null };
};

// ── STATE FROM WAREHOUSE ──────────────────────────────────────────────────────

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
    lineFieldMetadata,
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
    getMarketingDocumentUdfs({ headerTable: 'OPDN', lineTable: 'PDN1' }),
    getGRPOLineFieldMetadata(),
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
    localCurrency: companyRows[0].MainCurncy || '',
    systemCurrency: companyRows[0].SysCurrncy || '',
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
    uom_groups,
    decimal_settings: decimalSettings,
    udf_metadata: effectiveUdfMetadata,
    line_field_metadata: {
      matrix_columns: lineFieldMetadata.matrix_columns || [],
      sap_form: lineFieldMetadata.sap_form || {},
    },
    warnings: [],
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
    };
  }

  const [contacts, addresses] = await Promise.all([
    getContactsByVendor(vendorCode),
    getAddressesByVendor(vendorCode),
  ]);

  const payToAddresses = addresses.filter(a => 
    a.AdresType === 'B' || a.AdresType === 'bo_BillTo'
  );
  const shipToAddresses = addresses.filter(a =>
    a.AdresType === 'S' || a.AdresType === 'bo_ShipTo'
  );
  const primaryTaxAddress = payToAddresses[0] || shipToAddresses[0] || addresses[0] || {};

  return {
    contacts,
    pay_to_addresses: payToAddresses,
    ship_to_addresses: shipToAddresses,
    bill_to_addresses: payToAddresses,
    gstin: String(primaryTaxAddress.GSTIN || '').trim(),
    vendorState: String(primaryTaxAddress.State || '').trim(),
  };
};

module.exports = {
  getReferenceData,
  getVendorDetails,
  getGRPOList,
  getGRPO,
  getDocumentSeries,
  getNextNumber,
  getStateFromWarehouse,
  getOpenPurchaseOrders,
  getPurchaseOrderForCopy,
  getBatchesByItem,
  getNextBatchNumber,
  getItemsForModal,
};
