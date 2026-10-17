/**
 * Purchase Order DB Service - ODBC/Direct SQL for GET operations
 * Reads data directly from SAP B1 SQL Server database
 */
const db = require('./dbService');
const { getDocumentUnitPriceSql } = require('./documentUnitPriceDbUtils');
const { getDocumentUomSql, loadCompanyUomGroups } = require('./documentUomDbUtils');
const { getDocumentReferences } = require('./documentReferencesDbUtils');
const { createPhysicalColumnSetReader, selectPhysicalOptionalColumn } = require('./salesDocumentDbCompatibility');
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

const getTableColumnSet = createPhysicalColumnSetReader(db);

const selectColumnOrBlank = (columns, columnName, alias = columnName, tableAlias = '') =>
  selectPhysicalOptionalColumn(columns, tableAlias, columnName, alias, "CAST('' AS NVARCHAR(254))");

const formatCompanyAddress = (address = {}) => {
  const directAddress = String(address.Address || '').trim();
  if (directAddress) return directAddress;

  return [
    [address.Street, address.StreetNo],
    [address.Block, address.Building, address.Address2, address.Address3],
    [address.City, address.County, address.State, address.ZipCode],
    [address.Country],
  ]
    .map((parts) => parts.filter(Boolean).join(', '))
    .filter(Boolean)
    .join('\n');
};

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
  SELECT
    T0.ItemCode,
    T0.ItemName,
    T0.CardCode     AS PreferredVendor,
    T0.BuyUnitMsr  AS PurchaseUnit,
    T0.InvntryUom  AS InventoryUOM,
    T0.UgpEntry    AS UoMGroupEntry,
    T0.PUoMEntry   AS PurchaseUomEntry,
    T0.IUoMEntry   AS InventoryUomEntry,
    PU.UomCode     AS PurchaseUomCode,
    PU.UomName     AS PurchaseUomName,
    T0.DfltWH      AS DefaultWarehouse,
    T0.DfltWH      AS WarehouseCode,
    T0.DfltWH      AS WhsCode,
    CAST(COALESCE(NULLIF(T0.LastPurPrc, 0), NULLIF(T0.AvgPrice, 0), 0) AS DECIMAL(19,6)) AS UnitPrice,
    CAST(COALESCE(NULLIF(T0.LastPurPrc, 0), NULLIF(T0.AvgPrice, 0), 0) AS DECIMAL(19,6)) AS Price,
    CAST(T0.LastPurPrc AS DECIMAL(19,6)) AS LastPurPrc,
    CAST(T0.LastPurPrc AS DECIMAL(19,6)) AS LastPurchasePrice,
    CAST(T0.AvgPrice AS DECIMAL(19,6)) AS MovingAveragePrice,
    CAST(T0.AvgPrice AS DECIMAL(19,6)) AS AvgStdPrice,
    CHP.ChapterID  AS HSNCode
  FROM OITM T0
  LEFT JOIN OUOM PU ON PU.UomEntry = T0.PUoMEntry
  LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
  WHERE T0.PrchseItem = 'Y'
    AND ISNULL(T0.validFor, 'Y') <> 'N'
    AND ISNULL(T0.frozenFor, 'N') <> 'Y'
  ORDER BY T0.ItemCode
`));

const getItemsForModal = () => safe(db.query(`
  SELECT
    T0.ItemCode,
    T0.ItemName,
    T0.CardCode         AS PreferredVendor,
    T0.FrgnName        AS ForeignName,
    T1.ItmsGrpNam      AS ItemGroup,
    CAST(T0.OnHand AS DECIMAL(19,2)) AS InStock,
    T0.BuyUnitMsr      AS PurchaseUnit,
    T0.InvntryUom      AS InventoryUOM,
    T0.UgpEntry        AS UoMGroupEntry,
    T0.PUoMEntry       AS PurchaseUomEntry,
    T0.IUoMEntry       AS InventoryUomEntry,
    PU.UomCode         AS PurchaseUomCode,
    PU.UomName         AS PurchaseUomName,
    T0.DfltWH          AS DefaultWarehouse,
    T0.DfltWH          AS WarehouseCode,
    T0.DfltWH          AS WhsCode,
    CAST(COALESCE(NULLIF(T0.LastPurPrc, 0), NULLIF(T0.AvgPrice, 0), 0) AS DECIMAL(19,6)) AS UnitPrice,
    CAST(COALESCE(NULLIF(T0.LastPurPrc, 0), NULLIF(T0.AvgPrice, 0), 0) AS DECIMAL(19,6)) AS Price,
    CAST(T0.LastPurPrc AS DECIMAL(19,6)) AS LastPurPrc,
    CAST(T0.LastPurPrc AS DECIMAL(19,6)) AS LastPurchasePrice,
    CAST(T0.AvgPrice AS DECIMAL(19,6)) AS MovingAveragePrice,
    CAST(T0.AvgPrice AS DECIMAL(19,6)) AS AvgStdPrice,
    CHP.ChapterID      AS HSNCode,
    T0.ManBtchNum      AS BatchManaged,
    T0.ManSerNum       AS SerialManaged
  FROM OITM T0
  LEFT JOIN OITB T1  ON T1.ItmsGrpCod = T0.ItmsGrpCod
  LEFT JOIN OUOM PU ON PU.UomEntry = T0.PUoMEntry
  LEFT JOIN OCHP CHP ON CHP.AbsEntry  = T0.ChapterID
  WHERE T0.PrchseItem = 'Y'
    AND ISNULL(T0.validFor, 'Y') <> 'N'
    AND ISNULL(T0.frozenFor, 'N') <> 'Y'
  ORDER BY T0.ItemCode
`));

const getWarehouses = () => safe(db.query(`
  SELECT WhsCode, WhsName, Street, Block, [Location] AS LocationCode,
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

const itemUomContextCache = new Map();

const getItemUomContext = async (itemCode) => {
  const normalizedItemCode = String(itemCode || '').trim();
  if (!normalizedItemCode) return null;
  const companyScope = typeof db.resolveDatabaseName === 'function'
    ? String(await db.resolveDatabaseName() || '').trim().toUpperCase()
    : '';
  const cacheKey = `${companyScope}:${normalizedItemCode.toUpperCase()}`;

  if (!itemUomContextCache.has(cacheKey)) {
    itemUomContextCache.set(cacheKey, safe(db.query(`
      SELECT TOP 1
        T0.ItemCode,
        T0.UgpEntry,
        T0.PUoMEntry,
        T0.IUoMEntry,
        T0.BuyUnitMsr,
        T0.InvntryUom,
        PU.UomCode AS PurchaseUomCode,
        IU.UomCode AS InventoryUomCode
      FROM OITM T0
      LEFT JOIN OUOM PU ON PU.UomEntry = T0.PUoMEntry
      LEFT JOIN OUOM IU ON IU.UomEntry = T0.IUoMEntry
      WHERE T0.ItemCode = @itemCode
    `, { itemCode: normalizedItemCode })).then((rows) => rows[0] || null));
  }

  return itemUomContextCache.get(cacheKey);
};

const resolvePurchaseOrderLineUomEntry = async (itemCode, uomValue) => {
  const item = await getItemUomContext(itemCode);
  if (!item) return null;

  const rawValue = uomValue == null ? '' : String(uomValue).trim();
  const requestedUomEntry = Number(rawValue);
  const requestedUomCode = rawValue.toUpperCase();
  const ugpEntry = Number(item.UgpEntry);
  const purchaseUomEntry = Number(item.PUoMEntry);
  const inventoryUomEntry = Number(item.IUoMEntry);

  const isUsableEntry = (value) => Number.isInteger(value) && value !== 0;

  // The embedded SAP Manual UoM group stores the line's typed UoM name as
  // MeasureUnit; it must not be resolved to an OUOM entry.
  if (ugpEntry <= 0) return rawValue ? -1 : null;

  if (isUsableEntry(requestedUomEntry)) {
    if (ugpEntry > 0) {
      const rows = await safe(db.query(`
        SELECT TOP 1 UomEntry
        FROM UGP1
        WHERE UgpEntry = @ugpEntry
          AND UomEntry = @uomEntry
      `, { ugpEntry, uomEntry: requestedUomEntry }));
      return rows[0]?.UomEntry != null ? Number(rows[0].UomEntry) : null;
    }

    const rows = await safe(db.query(`
      SELECT TOP 1 UomEntry
      FROM OUOM
      WHERE UomEntry = @uomEntry
    `, { uomEntry: requestedUomEntry }));
    return rows[0]?.UomEntry != null ? Number(rows[0].UomEntry) : requestedUomEntry;
  }

  if (requestedUomCode) {
    if (ugpEntry > 0) {
      const rows = await safe(db.query(`
        SELECT TOP 1 U.UomEntry
        FROM UGP1 G
        INNER JOIN OUOM U ON U.UomEntry = G.UomEntry
        WHERE G.UgpEntry = @ugpEntry
          AND (
            UPPER(LTRIM(RTRIM(U.UomCode))) = @uomCode
            OR UPPER(LTRIM(RTRIM(U.UomName))) = @uomCode
          )
      `, { ugpEntry, uomCode: requestedUomCode }));

      return rows[0]?.UomEntry != null ? Number(rows[0].UomEntry) : null;
    }

    const rows = await safe(db.query(`
      SELECT TOP 1 UomEntry
      FROM OUOM
      WHERE UPPER(LTRIM(RTRIM(UomCode))) = @uomCode
         OR UPPER(LTRIM(RTRIM(UomName))) = @uomCode
      ORDER BY UomEntry
    `, { uomCode: requestedUomCode }));

    if (rows[0]?.UomEntry != null) {
      return Number(rows[0].UomEntry);
    }
  }

  if (isUsableEntry(purchaseUomEntry)) {
    return purchaseUomEntry;
  }

  if (isUsableEntry(inventoryUomEntry)) {
    return inventoryUomEntry;
  }

  return null;
};

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

const getCompanyInfo = async () => {
  const oadmColumns = await getTableColumnSet('OADM');
  const companyRows = await safe(db.query(`
    SELECT TOP 1
      ${selectColumnOrBlank(oadmColumns, 'CompnyName')},
      ${selectColumnOrBlank(oadmColumns, 'CompnyAddr', 'Address')},
      ${selectColumnOrBlank(oadmColumns, 'State')},
      ${selectColumnOrBlank(oadmColumns, 'MainCurncy')},
      ${selectColumnOrBlank(oadmColumns, 'SysCurrncy')}
    FROM OADM
  `));

  const company = companyRows[0] || {};
  const adm1Columns = await getTableColumnSet('ADM1');
  const adm1Rows = adm1Columns.size
    ? await safe(db.query(`
      SELECT TOP 1
        ${selectColumnOrBlank(adm1Columns, 'Street')},
        ${selectColumnOrBlank(adm1Columns, 'StreetNo')},
        ${selectColumnOrBlank(adm1Columns, 'Block')},
        ${selectColumnOrBlank(adm1Columns, 'Building')},
        ${selectColumnOrBlank(adm1Columns, 'Address2')},
        ${selectColumnOrBlank(adm1Columns, 'Address3')},
        ${selectColumnOrBlank(adm1Columns, 'City')},
        ${selectColumnOrBlank(adm1Columns, 'County')},
        ${selectColumnOrBlank(adm1Columns, 'State')},
        ${selectColumnOrBlank(adm1Columns, 'ZipCode')},
        ${selectColumnOrBlank(adm1Columns, 'Country')}
      FROM ADM1
    `))
    : [];

  const adm1Address = adm1Rows[0] || {};
  return [{
    ...company,
    Address: String(company.Address || '').trim() || formatCompanyAddress(adm1Address),
    State: String(company.State || '').trim() || String(adm1Address.State || '').trim(),
  }];
};

const PURCHASE_ORDER_FORM_ID = '142';
const PURCHASE_ORDER_MATRIX_ITEM_ID = '38';

const PURCHASE_ORDER_LINE_COLUMNS = [
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
  { key: 'commPercent', label: 'Comm. %', sapField: 'Commission', sapColumnIds: ['28', 'Commission', 'CommissionPercent', 'Commission Percentage', 'Comm. %'], minWidth: 95 },
  { key: 'branch', label: 'Branch', source: 'branch', sapColumnIds: ['BPLId', 'Branch'], minWidth: 115 },
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

const getLineTableColumns = async () => {
  const rows = await safe(db.query(`
    SELECT
      COLUMN_NAME,
      DATA_TYPE,
      CHARACTER_MAXIMUM_LENGTH,
      NUMERIC_PRECISION,
      NUMERIC_SCALE,
      IS_NULLABLE,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'POR1'
    ORDER BY ORDINAL_POSITION
  `));

  return rows.reduce((acc, row) => {
    const columnName = String(row.COLUMN_NAME || '').trim();
    if (!columnName) return acc;
    acc[columnName.toUpperCase()] = {
      name: columnName,
      dataType: String(row.DATA_TYPE || '').trim().toLowerCase(),
      maxLength: row.CHARACTER_MAXIMUM_LENGTH,
      precision: row.NUMERIC_PRECISION,
      scale: row.NUMERIC_SCALE,
      nullable: String(row.IS_NULLABLE || '').toUpperCase() === 'YES',
      ordinal: Number(row.ORDINAL_POSITION || 0),
    };
    return acc;
  }, {});
};

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

const getPurchaseOrderColumnPreferences = async () => {
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
  `, {
    formId: PURCHASE_ORDER_FORM_ID,
    itemId: PURCHASE_ORDER_MATRIX_ITEM_ID,
    tableName: 'POR1',
    userSign,
  }));

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

const getPurchaseOrderLineFieldMetadata = async () => {
  const [lineColumns, preferencesResult] = await Promise.all([
    getLineTableColumns(),
    getPurchaseOrderColumnPreferences(),
  ]);

  const matrixColumns = PURCHASE_ORDER_LINE_COLUMNS
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
        source: column.source || (column.calculated ? 'calculated' : 'POR1'),
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
      formId: PURCHASE_ORDER_FORM_ID,
      matrixItemId: PURCHASE_ORDER_MATRIX_ITEM_ID,
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
  const { addresses } = await loadBusinessPartnerAddresses(db, cardCode, { context: 'Purchase Order' });
  return addresses;
};

// ── PURCHASE ORDER LIST ───────────────────────────────────────────────────────

const getPurchaseOrderList = async ({
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
    FROM OPOR T0
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
        FROM POR1 T1
        WHERE T1.DocEntry = T0.DocEntry
      ) AS line_count
    FROM OPOR T0
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    orders: result.map((row) => ({
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

const getPurchaseOrder = async (docEntry) => {
  // Get header
  const { recordset: headerRows } = await db.query(`
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
      ${selectPhysicalOptionalColumn(await getTableColumnSet('OPOR'), 'T0', 'BPLId', 'Branch')},
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
      T0.TrnspCode AS ShippingType,
      ${selectPhysicalOptionalColumn(await getTableColumnSet('OPOR'), 'T0', 'LangCode', 'Language')},
      T0.Confirmed,
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS DocumentStatus
    FROM OPOR T0
    LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode
    WHERE T0.DocEntry = @docEntry
  `, { docEntry });

  if (!headerRows.length) {
    throw new Error(`Purchase Order ${docEntry} not found`);
  }

  const header = headerRows[0];
  const [headerUdfs, lineUdfsByLineNum, referenceDocuments] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OPOR', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'POR1', keyValue: docEntry }),
    getDocumentReferences(db, 'POR21', docEntry),
  ]);

  // Get lines
  const por1Columns = await getTableColumnSet('POR1');
  const documentUom = await getDocumentUomSql(db, 'POR1');
  const lineResult = await db.query(`
  SELECT 
    T0.LineNum,
    T0.ItemCode,
    T0.Dscription AS ItemDescription,
    T0.Quantity,
    T0.OpenQty,
    T0.LineStatus,
    ${await getDocumentUnitPriceSql(db, 'POR1', 'T0')} AS UnitPrice,
    T0.DiscPrcnt AS DiscountPercent,
    T0.TaxCode,
    T0.LineTotal,
    ${selectPhysicalOptionalColumn(por1Columns, 'T0', 'GTotal', 'GrossTotal')},
    T0.VatSum AS TaxAmount,
    ${selectPhysicalOptionalColumn(por1Columns, 'T0', 'Commission', 'CommissionPercent')},
    T0.WhsCode AS Warehouse,
    ${documentUom.entrySql} AS UoMEntry,
    ${documentUom.codeSql} AS UoMCode,
    ${documentUom.nameSql} AS UoMName,
    CHP.ChapterID AS HSNCode,
    ${selectColumnOrBlank(por1Columns, 'SACEntry', 'SACCode', 'T0')},
    ${selectColumnOrBlank(por1Columns, 'OcrCode', 'DistRule', 'T0')},
    ${selectColumnOrBlank(por1Columns, 'CountryOrg', 'CountryOfOrigin', 'T0')},
    ${selectColumnOrBlank(por1Columns, 'AgrNo', 'BlanketAgreementNo', 'T0')},
    ${selectColumnOrBlank(por1Columns, 'U_Cost_Sheet', 'CostSheet', 'T0')},
    ${selectColumnOrBlank(por1Columns, 'U_PackingType', 'PackingType', 'T0')},
    ${selectColumnOrBlank(por1Columns, 'U_ContainerType', 'ContainerType', 'T0')},
    ${selectColumnOrBlank(por1Columns, 'U_GrossWt', 'GrossWt', 'T0')},
    ${selectColumnOrBlank(por1Columns, 'U_TotalPackage', 'TotalPackage', 'T0')}
  FROM POR1 T0
  LEFT JOIN OITM ITM ON ITM.ItemCode = T0.ItemCode
  LEFT JOIN OCHP CHP ON CHP.AbsEntry = ITM.ChapterID
  ${documentUom.joinSql}
  WHERE T0.DocEntry = @docEntry
  ORDER BY T0.LineNum
`, { docEntry });
  const lineRows = lineResult.recordset || [];
  if (!lineRows.length) {
    throw new Error(`Purchase Order ${docEntry} exists but its content lines could not be loaded.`);
  }

  const result = {
    purchase_order: {
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
        shipToCode: header.ShipToCode || '',
        shipTo: '',
        shipToAddress: '',
        buyerLocation: getUdfValue(headerUdfs, ['U_ShipLocation', 'U_SHIPLOCATION']) || '',
        billTo: header.ShipToAddress || '',
        billToAddress: header.ShipToAddress || '',
        payToCode: header.PayToCode || '',
        billToCode: header.PayToCode || '',
        payTo: header.PayToAddress || '',
        payToAddress: header.PayToAddress || '',
        shippingType: header.ShippingType != null ? String(header.ShippingType) : '',
        language: header.Language != null ? String(header.Language) : '',
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
   lines: lineRows.map(l => ({
  itemNo: l.ItemCode || '',
  itemDescription: l.ItemDescription || '',
  hsnCode: l.HSNCode || '',
  quantity: l.Quantity != null ? String(l.Quantity) : '',
  unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
  stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
  taxCode: l.TaxCode || '',
  total: l.LineTotal != null ? String(l.LineTotal) : '',
  totalBeforeTax: l.LineTotal != null ? String(l.LineTotal) : '',
  totalLC: l.LineTotal != null ? String(l.LineTotal) : '',
  grossTotal: l.GrossTotal != null ? String(l.GrossTotal) : '',
  taxAmount: l.TaxAmount != null ? String(l.TaxAmount) : '',
  commPercent: l.CommissionPercent != null ? String(l.CommissionPercent) : '',
  whse: l.Warehouse || '',
  uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
  uomCode: l.UoMCode || '',
  uomName: l.UoMName || l.UoMCode || '',
  sac: l.SACCode != null ? String(l.SACCode) : '',
  distRule: l.DistRule || '',
  countryOfOrigin: l.CountryOfOrigin || '',
  loc: header.Branch ? String(header.Branch) : '',
  branch: header.Branch ? String(header.Branch) : '',
  blanketAgreementNo: l.BlanketAgreementNo != null ? String(l.BlanketAgreementNo) : '',
  costSheet: l.CostSheet || '',
  packingType: l.PackingType || '',
  containerType: l.ContainerType || '',
  grossWt: l.GrossWt != null ? String(l.GrossWt) : '',
  totalPackage: l.TotalPackage != null ? String(l.TotalPackage) : '',
  udf: lineUdfsByLineNum[l.LineNum] || {},
})),
      header_udfs: headerUdfs,
      reference_documents: referenceDocuments,
    }
  };

  return result;
};

// ── DOCUMENT SERIES ───────────────────────────────────────────────────────────

const getDocumentSeries = async (targetDate = null, { branch = '' } = {}) => ({
  series: await getMarketingDocumentSeries({
    db,
    objectCode: '22',
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
      AND ObjectCode = '22'
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
    getMarketingDocumentUdfs({ headerTable: 'OPOR', lineTable: 'POR1' }),
    getPurchaseOrderLineFieldMetadata(),
  ]);
  const effectiveUdfMetadata = applyLineColumnPreferencesToUdfs(
    udfMetadata,
    lineFieldMetadata._preferencesByKey || {},
  );

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
  getPurchaseOrderList,
  getPurchaseOrder,
  getDocumentSeries,
  getNextNumber,
  getStateFromAddress,
  getStateFromWarehouse,
  getItemsForModal,
  resolvePurchaseOrderLineUomEntry,
};
