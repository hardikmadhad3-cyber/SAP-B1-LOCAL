const { getMarketingDocumentSeries: getSharedDocumentSeries } = require('./documentSeriesDbUtils');
/**
 * AR Invoice reference data — loaded directly from SAP B1 SQL Server database.
 * Column names verified against SAP B1 schema.
 */
const db = require('./dbService');
const { loadCompanyUomGroups } = require('./documentUomDbUtils');
const { getDocumentUnitPriceSql } = require('./documentUnitPriceDbUtils');
const { loadBusinessPartnerAddresses } = require('./businessPartnerAddressDbUtils');
const masterDataDbService = require('./masterDataDbService');
const salesOrderDb = require('./salesOrderDbService');
const salesQuotationDb = require('./salesQuotationDbService');
const deliveryDb = require('./deliveryDbService');
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
  resolveDatabaseScope,
} = require('./salesDocumentDbCompatibility');
const { buildLineDeliveryDateFields } = require('./salesDocumentHydrationUtils');
const { getRequestContext } = require('./requestContextService');
const authDbService = require('./authDbService');
const { selectEffectiveCprfRows } = require('./sapFormPreferenceUtils');

const safe = async (promise) => {
  try {
    const r = await promise;
    return r.recordset || [];
  } catch (e) {
    if (e?.status === 503 || /\bis busy\b/i.test(String(e?.message || ''))) {
      throw e;
    }
    console.warn('[AR Invoice DB] Query failed silently:', e.message);
    return [];
  }
};

const REFERENCE_DATA_CACHE_TTL_MS = Number(
  process.env.AR_INVOICE_REFERENCE_DATA_CACHE_TTL_MS || 5 * 60 * 1000,
);
const REFERENCE_DATA_BATCH_SIZE = Math.max(
  1,
  Math.min(4, Number(process.env.AR_INVOICE_REFERENCE_QUERY_BATCH_SIZE) || 3),
);
const referenceDataCache = new Map();

const cloneReferenceData = (data) => JSON.parse(JSON.stringify(data || {}));

const getReferenceDataCacheKey = async () => {
  const scope = await resolveDatabaseScope(db);
  return scope.cacheKey;
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

const getTableFieldMetadata = createTableFieldMetadataReader({ database: db });
const getTableColumnDetails = createTableColumnDetailsReader({ database: db });
const getARInvoiceHeaderTableFieldMetadata = () => getTableFieldMetadata('OINV');
const getARInvoiceLineTableFieldMetadata = () => getTableFieldMetadata('INV1');

const AR_INVOICE_FORM_ID = '133';
const AR_INVOICE_MATRIX_ITEM_ID = '38';
const AR_INVOICE_SUPPRESSED_ROW_UDFS = new Set([
  'APIVDOCKEY',
  'APIVDOCNUM',
  'APIVLINENUM',
  'APINVDOCKEY',
  'APINVDOCNUM',
  'APINVLINENUM',
]);

const AR_INVOICE_MATRIX_COLUMN_DEFS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160, sapField: 'ItemCode', sapColumnIds: ['1', 'ItemCode', 'Item No.', 'ItemNo'] },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240, sapField: 'Dscription', sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Item Description'] },
  { key: 'quantity', label: 'Quantity', minWidth: 90, numeric: true, sapField: 'Quantity', sapColumnIds: ['11', 'Quantity', 'Qty'] },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 105, numeric: true, sapField: 'Price', alternativeFields: ['PriceBefDi'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'UnitPrice', 'Unit Price'] },
  { key: 'noOfPackages', label: 'No. of Packages', minWidth: 120, numeric: true, sapField: 'PackQty', sapColumnIds: ['PackQty', 'No. of Packages', 'No Of Packages'] },
  { key: 'priceAfterDiscount', label: 'Price after Discount', minWidth: 130, numeric: true, readOnly: true, sapField: 'Price', sapColumnIds: ['Price after Discount', 'PriceAfterDiscount'] },
  { key: 'itemsPerUnit', label: 'Items per Unit', minWidth: 120, numeric: true, sapField: 'NumPerMsr', sapColumnIds: ['NumPerMsr', 'Items per Unit'] },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 95, numeric: true, sapField: 'DiscPrcnt', sapColumnIds: ['15', 'DiscPrcnt', 'DiscountPercent', 'Discount %', 'Disc%'] },
  { key: 'taxCode', label: 'Tax Code', minWidth: 120, sapField: 'TaxCode', sapColumnIds: ['234000377', 'TaxCode', 'Tax Code'] },
  { key: 'wTaxLiable', label: 'WTax Liable', minWidth: 100, type: 'yesNo', sapField: 'WTLiable', sapColumnIds: ['18', 'WTLiable', 'WTax Liable'] },
  { key: 'totalLC', label: 'Total (LC)', minWidth: 110, numeric: true, sapField: 'LineTotal', sapColumnIds: ['160', '17', 'LineTotal', 'Total', 'Total (LC)'] },
  { key: 'whse', label: 'Whse', minWidth: 90, sapField: 'WhsCode', sapColumnIds: ['174', 'WhsCode', 'Warehouse', 'Whse'] },
  { key: 'glAccount', label: 'G/L Account', minWidth: 135, sapField: 'AcctCode', sapColumnIds: ['234001512', 'AcctCode', 'G/L Account', 'GLAccount'] },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 105, sapField: 'OcrCode', sapColumnIds: ['21', 'OcrCode', 'Distr. Rule', 'DistributionRule'] },
  { key: 'weight', label: 'Weight', minWidth: 95, numeric: true, sapField: 'Weight1', alternativeFields: ['Weight'], sapColumnIds: ['23', 'Weight1', 'Weight'] },
  { key: 'taxAmount', label: 'Tax Amount (LC)', minWidth: 125, readOnly: true, sapField: 'VatSum', sapColumnIds: ['24', 'VatSum', 'Tax Amount (LC)'] },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105, sapField: 'UomCode', alternativeFields: ['UomEntry'], sapColumnIds: ['1470002149', 'UomCode', 'UoMCode', 'UoM Code'] },
  { key: 'uomName', label: 'UoM Name', minWidth: 120, sapField: 'unitMsr', alternativeFields: [], sapColumnIds: ['1470002145', 'unitMsr', 'UoM Name'] },
  { key: 'cogsDistRule', label: 'COGS Distr. Rule', minWidth: 135, sapField: 'CogsOcrCod', sapColumnIds: ['29', 'CogsOcrCod', 'COGS Distr. Rule'] },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 185, sapField: 'CountryOrg', sapColumnIds: ['10002037', 'CountryOrg', 'Country/Region of Origin'] },
  { key: 'loc', label: 'Loc.', minWidth: 115, readOnly: true, sapField: 'LocCode', alternativeFields: ['WhsCode', 'BPLId'], sapColumnIds: ['10002047', 'LocCode', 'Location', 'Loc.'] },
  { key: 'qtyInventoryUom', label: 'Qty(Inventory UoM)', minWidth: 140, sapField: 'InvQty', sapColumnIds: ['38', 'InvQty', 'Qty(Inventory UoM)'] },
  { key: 'uomGroup', label: 'UoM Group', minWidth: 125, readOnly: true, sapField: 'UomEntry', alternativeFields: ['UomCode'], sapColumnIds: ['82', 'UomEntry', 'UoM Group'] },
  { key: 'hsnCode', label: 'HSN', minWidth: 115, sapField: 'HsnEntry', sapColumnIds: ['254000391', 'HsnEntry', 'HSN', 'HSN/SAC'] },
  { key: 'sacCode', label: 'SAC', minWidth: 95, sapField: 'SacEntry', sapColumnIds: ['254000393', 'SacEntry', 'SAC'] },
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

const shouldReplaceColumnPreference = (current, next) => {
  if (!current) return true;
  const currentVisible = sapFlagToBoolean(current.VisInForm, false);
  const nextVisible = sapFlagToBoolean(next.VisInForm, false);
  if (currentVisible !== nextVisible) return nextVisible;

  const currentIndex = Number(current.VisualIndx);
  const nextIndex = Number(next.VisualIndx);
  if (Number.isFinite(currentIndex) && Number.isFinite(nextIndex) && currentIndex !== nextIndex) {
    return nextIndex < currentIndex;
  }

  const currentWidth = Number(current.Width);
  const nextWidth = Number(next.Width);
  return !(Number.isFinite(currentWidth) && currentWidth > 0) && Number.isFinite(nextWidth) && nextWidth > 0;
};

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
    ORDER BY
      CASE WHEN USER_CODE = @sapUsername THEN 0 ELSE 1 END,
      USERID
  `, { sapUsername }));

  const userSign = Number(rows[0]?.USERID);
  return Number.isFinite(userSign) ? userSign : null;
};

const getARInvoiceColumnPreferences = async () => {
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
    ORDER BY
      CASE WHEN TPLId = 0 THEN 0 ELSE 1 END,
      VisualIndx,
      ColID
  `, {
    formId: AR_INVOICE_FORM_ID,
    itemId: AR_INVOICE_MATRIX_ITEM_ID,
    userSign,
  }));

  if (!rows.length && hasTableName) {
    rows = await safe(db.query(`
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
        TPLId,
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
      ORDER BY
        CASE WHEN TPLId = 0 THEN 0 ELSE 1 END,
        VisualIndx,
        ColID
    `, {
      formId: AR_INVOICE_FORM_ID,
      tableName: 'INV1',
      userSign,
    }));
  }

  rows = selectEffectiveCprfRows(rows);

  const byKey = rows.reduce((acc, row) => {
    [row.ColID, row.TableName, row.ItemUID, row.Caption, row.Title, row.Descr, row.ColAlias]
      .map(normalizePreferenceKey)
      .filter(Boolean)
      .forEach((key) => {
        if (shouldReplaceColumnPreference(acc[key], row)) acc[key] = row;
      });

    return acc;
  }, {});

  return { byKey, rows, userSign };
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

const getARInvoiceLineTableColumns = async () => {
  try {
    const columnDetails = await getTableColumnDetails('INV1');
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
    console.warn('[AR Invoice DB] getARInvoiceLineTableColumns failed:', error.message);
    return {};
  }
};

const getARInvoiceLineFieldMetadata = async () => {
  const [lineColumns, preferencesResult] = await Promise.all([
    getARInvoiceLineTableColumns(),
    getARInvoiceColumnPreferences(),
  ]);

  const matrixColumns = AR_INVOICE_MATRIX_COLUMN_DEFS
    .filter(Boolean)
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
        source: column.source || (column.calculated ? 'calculated' : 'INV1'),
        dataType: metadata?.dataType || '',
        maxLength: metadata?.maxLength || undefined,
        precision: metadata?.precision || undefined,
        scale: metadata?.scale || undefined,
        required: metadata ? !metadata.nullable : false,
        readOnly: Boolean(column.readOnly || column.calculated),
        visible,
        active,
        minWidth: Number.isFinite(width) && width > 0
          ? Math.max(width, column.minWidth || 125)
          : (column.minWidth || 125),
        order: Number.isFinite(Number(preference?.VisualIndx))
          ? Number(preference.VisualIndx)
          : index + 1,
        sapColumnId: preference?.ColID || '',
        numeric: Boolean(column.numeric),
        type: column.type,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (left.order || 0) - (right.order || 0));

  return {
    matrix_columns: matrixColumns,
    sap_form: {
      formId: AR_INVOICE_FORM_ID,
      matrixItemId: AR_INVOICE_MATRIX_ITEM_ID,
      userSign: preferencesResult.userSign,
      preferenceRows: preferencesResult.rows.length,
    },
    _preferencesByKey: preferencesResult.byKey,
  };
};

const applyLineColumnPreferencesToUdfs = (udfMetadata = {}, preferences = {}) => {
  const rows = (udfMetadata.rows || []).map((field) => {
    const normalizedFieldKeys = [
      field.key,
      field.sapField,
      field.aliasId,
      field.label,
    ].map(normalizePreferenceKey).filter(Boolean);
    if (normalizedFieldKeys.some((key) => AR_INVOICE_SUPPRESSED_ROW_UDFS.has(key))) {
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

  return {
    ...udfMetadata,
    rows,
  };
};

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

const optionalTrimmedText = (metadata, tableAlias, columnName) => (
  sqlColumnRef(metadata, tableAlias, columnName)
    ? `NULLIF(LTRIM(RTRIM(CAST(${sqlColumnRef(metadata, tableAlias, columnName)} AS NVARCHAR(254)))), '')`
    : 'NULL'
);

const coalesceText = (...expressions) => `COALESCE(${expressions.join(', ')}, '')`;

const buildOptionalHeaderTextExpression = (metadata = {}, candidates = [], fallback = "''") => {
  const resolvedColumn = candidates
    .map((candidate) => sqlColumnRef(metadata, 'T0', candidate))
    .find(Boolean);
  return resolvedColumn
    ? `NULLIF(LTRIM(RTRIM(CAST(${resolvedColumn} AS NVARCHAR(254)))), '')`
    : fallback;
};

// ── queries ───────────────────────────────────────────────────────────────────

const getCustomers = () => safe(db.query(`
  SELECT CardCode, CardName, CardType, Currency, Balance,
         VatGroup, GroupNum AS PayTermsGrpCode
  FROM   OCRD
  WHERE  CardType = 'C'
    AND  frozenFor <> 'Y'
  ORDER  BY CardName
`));

const getItems = async () => {
  const [itemMetadata, itemGroupMetadata, itemWarehouseMetadata] = await Promise.all([
    getTableFieldMetadata('OITM'),
    getTableFieldMetadata('OITB'),
    getTableFieldMetadata('OITW'),
  ]);
  const salesGlAccountExpression = coalesceText(
    optionalTrimmedText(itemWarehouseMetadata, 'W', 'RevenuesAc'),
    optionalTrimmedText(itemWarehouseMetadata, 'W', 'RevenueAcct'),
    optionalTrimmedText(itemMetadata, 'T0', 'IncomeAcct'),
    optionalTrimmedText(itemMetadata, 'T0', 'IncomeAccount'),
    optionalTrimmedText(itemMetadata, 'T0', 'RevenuesAc'),
    optionalTrimmedText(itemGroupMetadata, 'T1', 'RevenuesAc'),
    optionalTrimmedText(itemGroupMetadata, 'T1', 'RevenueAcct'),
    optionalTrimmedText(itemGroupMetadata, 'T1', 'IncomeAcct'),
    "''"
  );
  const distributionRuleExpression = coalesceText(
    optionalTrimmedText(itemMetadata, 'T0', 'OcrCode'),
    optionalTrimmedText(itemWarehouseMetadata, 'W', 'OcrCode'),
    optionalTrimmedText(itemGroupMetadata, 'T1', 'OcrCode'),
    "''"
  );
  const cogsDistributionRuleExpression = coalesceText(
    optionalTrimmedText(itemMetadata, 'T0', 'CogsOcrCod'),
    optionalTrimmedText(itemWarehouseMetadata, 'W', 'CogsOcrCod'),
    optionalTrimmedText(itemGroupMetadata, 'T1', 'CogsOcrCod'),
    optionalTrimmedText(itemMetadata, 'T0', 'OcrCode'),
    optionalTrimmedText(itemWarehouseMetadata, 'W', 'OcrCode'),
    optionalTrimmedText(itemGroupMetadata, 'T1', 'OcrCode'),
    "''"
  );

  return safe(db.query(`
  SELECT T0.ItemCode, T0.ItemName,
         T0.SalUnitMsr  AS SalesUnit,
         T0.InvntryUom  AS InventoryUOM,
         T0.UgpEntry    AS UoMGroupEntry,
         T0.SUoMEntry   AS SalesUomEntry,
         T0.SWW         AS HSNCode,
         T0.CountryOrg  AS ItemCountryOrg,
         T0.SACEntry    AS SACEntry,
         T0.VatGourpSa  AS TaxCodeAR,
         T0.DfltWH      AS DefaultWarehouse,
         T0.ManBtchNum  AS BatchManaged,
         T0.ManSerNum   AS SerialManaged,
         ${salesGlAccountExpression} AS SalesGLAccount,
         ${salesGlAccountExpression} AS IncomeAccount,
         ${distributionRuleExpression} AS DistributionRule,
         ${cogsDistributionRuleExpression} AS COGSDistributionRule
  FROM   OITM T0
  LEFT JOIN OITB T1 ON T1.ItmsGrpCod = T0.ItmsGrpCod
  LEFT JOIN OITW W ON W.ItemCode = T0.ItemCode AND W.WhsCode = T0.DfltWH
  WHERE  T0.SellItem = 'Y'
    AND  T0.validFor  <> 'N'
  ORDER  BY T0.ItemCode
`));
};

const getWarehouses = () => safe(db.query(`
  SELECT WhsCode, WhsName, Street, Block, Building,
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

const getBranches = async () => {
  const branchMetadata = await getTableFieldMetadata('OBPL');

  return safe(db.query(`
    SELECT
      T0.BPLId,
      T0.BPLName,
      ${optionalColumn(branchMetadata, 'T0', 'State', 'State', "''")},
      ${optionalColumn(branchMetadata, 'T0', 'TaxIdNum', 'TaxIdNum', "''")}
    FROM   OBPL T0
    WHERE  T0.Disabled = 'N'
    ORDER  BY T0.BPLName
  `));
};

const getCompanyInfo = () => safe(db.query(`
  SELECT TOP 1
    CompnyName,
    CompnyAddr AS Address,
    State,
    MainCurncy,
    SysCurrncy
  FROM OADM
`));

const getStates = () => safe(db.query(`
  SELECT Code, Name
  FROM   OCST
  WHERE  Country = 'IN'
  ORDER  BY Name
`));

const getTaxCodes = () => masterDataDbService.searchDocumentTaxCodes('', 'sales', 500, 0);

const getWithholdingTaxCodes = () => masterDataDbService.lookupWithholdingTaxCodes('');

const getUomGroups = () => loadCompanyUomGroups(db);

const getSalesEmployees = () => safe(db.query(`
  SELECT SlpCode, SlpName, Memo, Commission, Active
  FROM   OSLP
  ORDER  BY
    CASE WHEN SlpCode = -1 THEN 0 ELSE 1 END,
    SlpName
`));

// ── Document Series (ObjectCode = '18' for A/R Invoice) ───────────────────────────────────────────────────────────

const normalizeSeriesText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const isTransactionTypeField = (field = {}) => {
  const identity = [field.key, field.aliasId, field.label, field.description, field.Descr]
    .map(normalizeSeriesText)
    .join(' ');
  return identity.includes('transactiontype') ||
    identity.includes('transtype') ||
    identity.includes('documenttype') ||
    identity.includes('doctype');
};

const extractTransactionTypes = (udfMetadata = {}, series = []) => {
  const seen = new Set();
  const options = [];
  const addOption = (value, label = value, extra = {}) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue || seen.has(normalizedValue.toLowerCase())) return;
    seen.add(normalizedValue.toLowerCase());
    options.push({ value: normalizedValue, label: String(label || normalizedValue).trim(), ...extra });
  };

  const transactionTypeUdf = (udfMetadata.header || []).find(isTransactionTypeField);
  (transactionTypeUdf?.options || []).forEach((option) => addOption(option.value, option.label));

  if (!options.length) {
    (series || []).forEach((row) => {
      if (row.Indicator) addOption(row.Indicator, row.Indicator, { indicator: row.Indicator });
    });
  }

  return options;
};

const filterSeriesByTransactionType = (series = [], transactionType = '') => {
  const normalizedType = normalizeSeriesText(transactionType);
  if (!normalizedType) return series;

  const matched = (series || []).filter((row) => {
    const candidates = [
      row.TransactionType,
      row.transactionType,
      row.DocType,
      row.DocumentType,
      row.Indicator,
      row.SeriesName,
      row.RawSeriesName,
      row.BeginStr,
    ].map(normalizeSeriesText).filter(Boolean);

    return candidates.some((candidate) => (
      candidate === normalizedType ||
      (normalizedType.length > 3 && candidate.includes(normalizedType)) ||
      (candidate.length > 3 && normalizedType.includes(candidate))
    ));
  });

  return matched.length ? matched : series;
};

const isRegularInvoiceSeries = (row = {}) => {
  const docSubType = String(row.DocSubType ?? row.docSubType ?? '').trim().toUpperCase();
  return !docSubType || docSubType === '--';
};

const preferRegularInvoiceSeries = (series = [], transactionType = '') => {
  const normalizedType = normalizeSeriesText(transactionType);
  if (normalizedType.includes('debit')) return series;

  const regularSeries = (series || []).filter(isRegularInvoiceSeries);
  return regularSeries.length ? regularSeries : series;
};

const resolveSeriesDocSubType = (transactionType = '') => {
  const normalizedType = normalizeSeriesText(transactionType);
  if (normalizedType.includes('gstdebitmemo') || normalizedType.includes('debitmemo')) return 'GD';
  if (normalizedType.includes('gsttaxinvoice') || normalizedType.includes('taxinvoice')) return 'GA';
  if (normalizedType.includes('billofsupply')) return '--';
  return '';
};

const keepSapVisibleNumberingSeries = (series = []) => {
  return selectSapEligibleSeries(series);
};

const getDocumentSeries = async (targetDate = null, transactionType = '', branch = '', docSubType) => getSharedDocumentSeries({ db, objectCode: '13', targetDate, branch, docSubType, transactionType });

const getNextNumber = async (series) => {
  const result = await safe(db.query(`
    SELECT NextNumber
    FROM   NNM1
    WHERE  ObjectCode = '13'
      AND  Series = @series
      AND  Locked = 'N'
  `, { series }));

  if (result.length === 0) {
    throw new Error('Series not found or locked');
  }

  return {
    nextNumber: result[0].NextNumber,
  };
};

// ── Customer Details ──────────────────────────────────────────────────────────

const getContactsByCustomer = async (cardCode) => {
  const result = await safe(db.query(`
    SELECT
      CardCode,
      CntctCode,
      Name,
      FirstName,
      LastName,
      E_MailL AS E_Mail,
      Cellolar AS MobilePhone,
      Tel1 AS Phone
    FROM   OCPR
    WHERE  CardCode = @cardCode
    ORDER  BY Name
  `, { cardCode }));

  return result.map(c => ({
    CardCode: c.CardCode,
    CntctCode: c.CntctCode,
    Name: c.Name,
    FirstName: c.FirstName,
    LastName: c.LastName,
    E_Mail: c.E_Mail,
    MobilePhone: c.MobilePhone,
    Phone: c.Phone,
  }));
};

const getAddressesByCustomer = async (cardCode) => {
  return loadBusinessPartnerAddresses(db, cardCode, { context: 'AR Invoice' });
};

// ── Base Documents (Sales Orders and Deliveries) ──────────────────────────────────────────────────────────

const getOpenSalesOrders = (customerCode = null) => {
  const query = `
    SELECT TOP 200
      T0.DocEntry, T0.DocNum, T0.CardCode, T0.CardName,
      T0.DocDate, T0.DocDueDate, T0.Comments, T0.DocTotal
    FROM ORDR T0
    WHERE T0.DocStatus = 'O'
      AND T0.CANCELED <> 'Y'
      AND EXISTS (
        SELECT 1
        FROM RDR1 T1
        WHERE T1.DocEntry = T0.DocEntry
          AND T1.LineStatus = 'O'
          AND ISNULL(T1.OpenQty, 0) > 0
      )
      ${customerCode ? "AND T0.CardCode = @customerCode" : ""}
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
  `;
  
  return safe(db.query(query, customerCode ? { customerCode } : {}));
};

const getOpenDeliveries = (customerCode = null) => {
  const query = `
    SELECT 
      T0.DocNum, T0.CardCode, T0.CardName,
      T0.DocDate, T0.DocDueDate, T0.DocTotal,
      T0.DocEntry, T0.Comments
    FROM ODLN T0
    WHERE T0.DocStatus = 'O'
      AND T0.CANCELED <> 'Y'
      AND EXISTS (
        SELECT 1
        FROM DLN1 T1
        WHERE T1.DocEntry = T0.DocEntry
          AND T1.LineStatus = 'O'
          AND ISNULL(T1.OpenQty, 0) > 0
      )
      ${customerCode ? "AND T0.CardCode = @customerCode" : ""}
    ORDER BY T0.DocNum DESC, T0.DocDate DESC  
  `;
  
  return safe(db.query(query, customerCode ? { customerCode } : {}));
};

// ── Main Functions ────────────────────────────────────────────────────────────

const loadReferenceDataUncached = async () => {
  const [
    customers,
    items,
    warehouses,
    paymentTerms,
    shippingTypes,
    branches,
    states,
    taxCodes,
    uomGroups,
    salesEmployees,
    udfMetadata,
    lineFieldMetadata,
    currentSeries,
    accounts,
    distributionRules,
    companyRows,
    withholdingTaxCodes,
  ] = await runReferenceDataTasks([
    () => getCustomers(),
    () => getItems(),
    () => getWarehouses(),
    () => getPaymentTerms(),
    () => getShippingTypes(),
    () => getBranches(),
    () => getStates(),
    () => getTaxCodes(),
    () => getUomGroups(),
    () => getSalesEmployees(),
    () => getMarketingDocumentUdfs({ headerTable: 'OINV', lineTable: 'INV1' }),
    () => getARInvoiceLineFieldMetadata(),
    () => getDocumentSeries(),
    () => masterDataDbService.searchAccounts('', '', 5000, 0),
    () => masterDataDbService.lookupDistributionRules(),
    () => getCompanyInfo(),
    () => getWithholdingTaxCodes(),
  ]);
  const effectiveUdfMetadata = applyLineColumnPreferencesToUdfs(
    udfMetadata,
    lineFieldMetadata._preferencesByKey || {},
  );

  const processedUomGroups = uomGroups;
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
  const defaultBranch = branches.length === 1 ? String(branches[0].BPLId || '') : '';
  const defaultWarehouseRow =
    warehouses.find((warehouse) => defaultBranch && String(warehouse.BranchID || '') === defaultBranch) ||
    warehouses[0] ||
    null;

  return {
    company: companyInfo.name,
    company_state: companyInfo.state,
    local_currency: companyInfo.localCurrency,
    system_currency: companyInfo.systemCurrency,
    company_currency: companyInfo.localCurrency,
    default_branch: defaultBranch,
    default_warehouse: defaultWarehouseRow?.WhsCode || '',
    vendors: customers,  // Frontend expects 'vendors', not 'customers'
    contacts: [],        // Will be loaded per-customer on demand
    pay_to_addresses: [],  // Will be loaded per-customer on demand
    items,
    warehouses,
    warehouse_addresses: warehouses,
    company_address: { State: companyInfo.state, Address: companyInfo.address },
    payment_terms: paymentTerms,
    shipping_types: shippingTypes,
    branches,
    states,
    tax_codes: taxCodes,
    withholding_tax_codes: withholdingTaxCodes,
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
    sales_employees: salesEmployees.map((e) => ({
      SlpCode: e.SlpCode,
      SlpName: e.SlpName,
      Memo: e.Memo || '',
      Commission: e.Commission,
      Active: e.Active,
    })),
    uom_groups: processedUomGroups,
    transaction_types: extractTransactionTypes(udfMetadata, currentSeries),
    base_documents: {
      sales_orders: [],
      deliveries: [],
    },
    decimal_settings: {
      QtyDec: 2,
      PriceDec: 2,
      SumDec: 2,
      RateDec: 2,
      PercentDec: 2,
    },
    matrix_columns: lineFieldMetadata.matrix_columns || [],
    line_field_metadata: {
      matrix_columns: lineFieldMetadata.matrix_columns || [],
      sap_form: lineFieldMetadata.sap_form || {},
    },
    udf_metadata: effectiveUdfMetadata,
    warnings: [],
  };
};

const getCustomerGSTProfile = async (cardCode) => {
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

const getCustomerWithholdingTaxDetails = async (customerCode) => {
  const [ocrdRows, allowedRows, allCodes] = await Promise.all([
    safe(db.query(`
      SELECT TOP 1
        T0.CardCode,
        T0.WTCode
      FROM OCRD T0
      WHERE T0.CardCode = @customerCode
    `, { customerCode })),
    safe(db.query(`
      SELECT DISTINCT
        T0.WTCode
      FROM CRD4 T0
      WHERE T0.CardCode = @customerCode
        AND ISNULL(T0.WTCode, '') <> ''
      ORDER BY T0.WTCode
    `, { customerCode })),
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

const getCustomerDetails = async (customerCode) => {
  const [contacts, addressGroups, withholdingTax] = await Promise.all([
    getContactsByCustomer(customerCode),
    getAddressesByCustomer(customerCode),
    getCustomerWithholdingTaxDetails(customerCode),
  ]);
  const { billTo: billToAddresses, shipTo: shipToAddresses } = addressGroups;

  // Get customer basic info
  const customers = await safe(db.query(`
    SELECT CardCode, CardName, CardType, Currency, VatGroup, GroupNum
    FROM OCRD
    WHERE CardCode = @customerCode
  `, { customerCode }));

  const customer = customers.length > 0 ? customers[0] : null;

  // Get GST profile
  const gstProfile = await getCustomerGSTProfile(customerCode);

  return {
    customer,
    contacts,
    pay_to_addresses: billToAddresses,  // Frontend expects 'pay_to_addresses' for bill-to
    bill_to_addresses: billToAddresses,
    ship_to_addresses: shipToAddresses,
    gstin: gstProfile.GSTIN || '',
    customerState: gstProfile.State || '',
    withholding_tax: withholdingTax,
  };
};

const getARInvoiceList = async ({
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
  const headerFieldMetadata = await getARInvoiceHeaderTableFieldMetadata();
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
    FROM OINV T0
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
        FROM INV1 T1
        WHERE T1.DocEntry = T0.DocEntry
      ) AS line_count
    FROM OINV T0
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    ar_invoices: result.map((row) => ({
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

const getARInvoice = async (docEntry) => {
  const [headerFieldMetadata, lineFieldMetadata, withholdingTaxFieldMetadata] = await Promise.all([
    getTableFieldMetadata('OINV'),
    getTableFieldMetadata('INV1'),
    getTableFieldMetadata('INV5'),
  ]);
  const addressExtensionFieldMetadata = await getTableFieldMetadata('INV12');
  const addressExtensionSelectFields = buildAddressExtensionSelectFields({
    fieldMetadata: addressExtensionFieldMetadata,
    tableAlias: 'T12',
    quoteIdentifier: sqlAlias,
    quoteAlias: sqlAlias,
  });
  const requestedDocId = Number(docEntry);

  if (!Number.isFinite(requestedDocId)) {
    throw new Error('AR Invoice document id is invalid');
  }

  const placeOfSupplyExpression = hasTableField(headerFieldMetadata, 'U_PlaceOfSupply')
    ? "COALESCE(NULLIF(LTRIM(RTRIM(CAST(T0.U_PlaceOfSupply AS NVARCHAR(254)))), ''), C.State, ST.Name, '')"
    : "COALESCE(C.State, ST.Name, '')";
  const headerBranchExpression = hasTableField(headerFieldMetadata, 'BPL_IDAssignedToInvoice')
    ? 'COALESCE(T0.BPL_IDAssignedToInvoice, T0.BPLId)'
    : 'T0.BPLId';
  const lineTaxExpression = sqlColumnRef(lineFieldMetadata, 'T0', 'TaxCode')
    ? sqlColumnRef(lineFieldMetadata, 'T0', 'TaxCode')
    : sqlColumnRef(lineFieldMetadata, 'T0', 'VatGroup')
      ? sqlColumnRef(lineFieldMetadata, 'T0', 'VatGroup')
      : "''";
  const lineUomEntryRef = sqlColumnRef(lineFieldMetadata, 'T0', 'UomEntry');
  const lineUomCodeRef = sqlColumnRef(lineFieldMetadata, 'T0', 'UomCode');
  const lineUnitMsrRef = sqlColumnRef(lineFieldMetadata, 'T0', 'unitMsr');
  const resolvedLineUomCodeExpression = coalesceText(
    lineUomEntryRef ? "NULLIF(LTRIM(RTRIM(CAST(UOM.UomCode AS NVARCHAR(254)))), '')" : 'NULL',
    lineUomCodeRef ? `NULLIF(NULLIF(LTRIM(RTRIM(CAST(${lineUomCodeRef} AS NVARCHAR(254)))), ''), 'Manual')` : 'NULL',
    lineUnitMsrRef ? `NULLIF(LTRIM(RTRIM(CAST(${lineUnitMsrRef} AS NVARCHAR(254)))), '')` : 'NULL',
    "''"
  );
  const resolvedLineUomNameExpression = coalesceText(
    lineUomEntryRef ? 'NULLIF(LTRIM(RTRIM(CAST(UOM.UomName AS NVARCHAR(254)))), \'\')' : 'NULL',
    lineUnitMsrRef ? `NULLIF(LTRIM(RTRIM(CAST(${lineUnitMsrRef} AS NVARCHAR(254)))), '')` : 'NULL',
    lineUomCodeRef ? `NULLIF(LTRIM(RTRIM(CAST(${lineUomCodeRef} AS NVARCHAR(254)))), '')` : 'NULL',
    lineUomEntryRef ? 'UOM.UomCode' : 'NULL',
    "''"
  );
  const lineUomCodeExpression = lineUomEntryRef
    ? `CASE WHEN ${lineUomEntryRef} < 0 THEN 'Manual' ELSE ${resolvedLineUomCodeExpression} END`
    : resolvedLineUomCodeExpression;
  const lineUomNameExpression = lineUomEntryRef
    ? `CASE WHEN ${lineUomEntryRef} < 0 THEN ${coalesceText(lineUnitMsrRef || 'NULL', "'Manual'")} ELSE ${resolvedLineUomNameExpression} END`
    : resolvedLineUomNameExpression;
  const lineUomJoin = lineUomEntryRef ? `LEFT JOIN OUOM UOM ON UOM.UomEntry = ${lineUomEntryRef}` : '';

  const headerRows = await safe(db.query(`
    SELECT TOP 1
      T0.DocEntry,
      T0.DocNum,
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
      ${headerBranchExpression} AS Branch,
      T0.DocCur AS Currency,
      T0.DocRate AS ExchangeRate,
      T0.GroupNum AS PaymentTerms,
      T0.Comments AS Remarks,
      T0.JrnlMemo AS JournalRemark,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TotalExpns AS Freight,
      T0.VatSum AS Tax,
      T0.DocTotal AS TotalPaymentDue,
      ${optionalColumn(headerFieldMetadata, 'T0', 'WTSum', 'WTSum', '0')},
      ${placeOfSupplyExpression} AS PlaceOfSupply,
      ${optionalColumn(headerFieldMetadata, 'T0', 'ShipToCode', 'ShipToCode', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'PayToCode', 'PayToCode', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'Address', 'ShipToAddress', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'Address2', 'BillToAddress', "''")},
      ${addressExtensionSelectFields.join(',\n      ')},
      ${optionalColumn(headerFieldMetadata, 'T0', 'TrnspCode', 'ShippingType', 'NULL')},
      ${optionalColumn(headerFieldMetadata, 'T0', 'Confirmed', 'Confirmed', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'PeyMethod', 'PaymentMethod', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'OwnerCode', 'OwnerCode', 'NULL')},
      ${optionalColumn(headerFieldMetadata, 'T0', 'RoundDif', 'RoundingAmount', '0')},
      ${optionalColumn(headerFieldMetadata, 'T0', 'LangCode', 'Language', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'TrackNo', 'TrackingNo', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'StampNum', 'StampNo', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'PickRmrk', 'PickPackRemarks', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'BPChCode', 'BpChannelName', "''")},
      ${optionalColumn(headerFieldMetadata, 'T0', 'BPChCntc', 'BpChannelContact', "''")},
      T0.SlpCode AS SalesEmployeeCode,
      SLP.SlpName AS SalesEmployeeName,
      CASE WHEN EMP.empID IS NOT NULL
        THEN LTRIM(RTRIM(CONCAT(CONCAT(COALESCE(EMP.firstName, ''), ' '), COALESCE(EMP.lastName, ''))))
        ELSE ''
      END AS OwnerName,
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS DocumentStatus
    FROM OINV T0
    LEFT JOIN INV12 T12 ON T12.DocEntry = T0.DocEntry
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    LEFT JOIN NNM1 NNM ON NNM.ObjectCode = '13' AND NNM.Series = T0.Series
    LEFT JOIN OHEM EMP ON EMP.empID = ${hasTableField(headerFieldMetadata, 'OwnerCode') ? 'T0.OwnerCode' : 'NULL'}
    LEFT JOIN (
      SELECT
        C.CardCode,
        C.Address,
        C.State,
        C.Country,
        ROW_NUMBER() OVER (
          PARTITION BY C.CardCode, C.Address
          ORDER BY C.LineNum
        ) AS AddressRank
      FROM CRD1 C
      WHERE C.AdresType = 'S'
    ) C
      ON C.CardCode = T0.CardCode
     AND C.Address = ${hasTableField(headerFieldMetadata, 'ShipToCode') ? 'T0.ShipToCode' : "''"}
     AND C.AddressRank = 1
    LEFT JOIN OCST ST ON ST.Code = C.State AND ST.Country = C.Country
    WHERE (T0.DocEntry = @docEntry OR T0.DocNum = @docEntry)
      AND T0.DocType = 'I'
    ORDER BY CASE WHEN T0.DocEntry = @docEntry THEN 0 ELSE 1 END
  `, { docEntry: requestedDocId }));

  if (!headerRows.length) {
    throw new Error('AR Invoice not found');
  }

  const header = headerRows[0];
  const shipToAddressComponents = buildDocumentAddressComponents(header, 'ShipTo');
  const billToAddressComponents = buildDocumentAddressComponents(header, 'BillTo');
  const resolvedDocEntry = Number(header.DocEntry);

  const lineSacExpression = sqlColumnRef(lineFieldMetadata, 'T0', 'SacEntry')
    ? sqlColumnRef(lineFieldMetadata, 'T0', 'SacEntry')
    : sqlColumnRef(lineFieldMetadata, 'T0', 'SACEntry')
      ? sqlColumnRef(lineFieldMetadata, 'T0', 'SACEntry')
      : "''";
  const lineTaxAmountExpression = sqlColumnRef(lineFieldMetadata, 'T0', 'VatSum')
    ? sqlColumnRef(lineFieldMetadata, 'T0', 'VatSum')
    : 'NULL';
  const lineWithoutQtyPostingExpression = sqlColumnRef(lineFieldMetadata, 'T0', 'NoInvtryMv')
    ? sqlColumnRef(lineFieldMetadata, 'T0', 'NoInvtryMv')
    : sqlColumnRef(lineFieldMetadata, 'T0', 'WithoutQtyPosting')
      ? sqlColumnRef(lineFieldMetadata, 'T0', 'WithoutQtyPosting')
      : "'N'";

  let lineRows = await safe(db.query(`
    SELECT
      T0.LineNum,
      T0.ItemCode,
      COALESCE(NULLIF(LTRIM(RTRIM(T0.Dscription)), ''), ITM.ItemName, '') AS ItemDescription,
      T0.Quantity,
      T0.OpenQty AS OpenQuantity,
      ${optionalColumn(lineFieldMetadata, 'T0', 'ShipDate', 'ShipDate', 'NULL')},
      ${await getDocumentUnitPriceSql(db, 'INV1', 'T0')} AS UnitPrice,
      ${optionalColumn(lineFieldMetadata, 'T0', 'Price', 'PriceAfterDiscount', 'NULL')},
      ${optionalColumn(lineFieldMetadata, 'T0', 'PackQty', 'NoOfPackages', 'NULL')},
      ${optionalColumn(lineFieldMetadata, 'T0', 'NumPerMsr', 'ItemsPerUnit', 'NULL')},
      T0.DiscPrcnt AS DiscountPercent,
      ${lineTaxExpression} AS TaxCode,
      T0.LineTotal,
      ${lineTaxAmountExpression} AS TaxAmount,
      ${optionalColumn(lineFieldMetadata, 'T0', 'WTLiable', 'WTLiable', "'N'")},
      T0.WhsCode AS Warehouse,
      ${lineUomCodeExpression} AS UoMCode,
      ${lineUomCodeExpression} AS UomCode,
      ${lineUomNameExpression} AS UoMName,
      ${lineUomNameExpression} AS UnitMsr,
      ${optionalColumn(lineFieldMetadata, 'T0', 'UomEntry', 'UomEntry', 'NULL')},
      ${optionalColumn(lineFieldMetadata, 'T0', 'CountryOrg', 'CountryOfOrigin', "''")},
      ${optionalColumn(lineFieldMetadata, 'T0', 'AgrNo', 'BlanketAgreementNo', "''")},
      ${optionalColumn(lineFieldMetadata, 'T0', 'StockPrice', 'ItemCost', '0')},
      ${optionalColumn(lineFieldMetadata, 'T0', 'U_AssblValue', 'AssessableValue', 'NULL')},
      ${optionalColumn(lineFieldMetadata, 'T0', 'LocCode', 'Loc', "''")},
      ${optionalColumn(lineFieldMetadata, 'T0', 'AcctCode', 'GLAccount', "''")},
      ${optionalColumn(lineFieldMetadata, 'T0', 'OcrCode', 'DistributionRule', "''")},
      ${optionalColumn(lineFieldMetadata, 'T0', 'CogsOcrCod', 'COGSDistributionRule', "''")},
      ${optionalColumn(lineFieldMetadata, 'T0', 'OcrCode2', 'BranchCode', "''")},
      ${lineWithoutQtyPostingExpression} AS WithoutQtyPosting,
      ${optionalColumn(lineFieldMetadata, 'T0', 'EnSetCost', 'EnableSettingCost', "'N'")},
      ${optionalColumn(lineFieldMetadata, 'T0', 'RetCost', 'ReturnCost', 'NULL')},
      ${lineSacExpression} AS SACCode,
      ITM.ManBtchNum AS BatchManaged,
      ITM.InvntryUom AS InventoryUOM,
      T0.BaseEntry,
      T0.BaseType,
      T0.BaseLine,
      COALESCE(CHP.ChapterID, ITM.SWW, '') AS HSNCode
    FROM INV1 T0
    LEFT JOIN OITM ITM ON ITM.ItemCode = T0.ItemCode
    LEFT JOIN OCHP CHP ON CHP.AbsEntry = ITM.ChapterID
    ${lineUomJoin}
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `, { docEntry: resolvedDocEntry }));

  if (!lineRows.length) {
    lineRows = await safe(db.query(`
      SELECT
        T0.LineNum,
        T0.ItemCode,
        T0.Dscription AS ItemDescription,
        T0.Quantity,
        T0.Quantity AS OpenQuantity,
        ${optionalColumn(lineFieldMetadata, 'T0', 'ShipDate', 'ShipDate', 'NULL')},
        ${await getDocumentUnitPriceSql(db, 'INV1', 'T0')} AS UnitPrice,
        ${optionalColumn(lineFieldMetadata, 'T0', 'Price', 'PriceAfterDiscount', 'NULL')},
        ${optionalColumn(lineFieldMetadata, 'T0', 'PackQty', 'NoOfPackages', 'NULL')},
        ${optionalColumn(lineFieldMetadata, 'T0', 'NumPerMsr', 'ItemsPerUnit', 'NULL')},
        T0.DiscPrcnt AS DiscountPercent,
        ${lineTaxExpression} AS TaxCode,
        T0.LineTotal,
        ${lineTaxAmountExpression} AS TaxAmount,
        ${optionalColumn(lineFieldMetadata, 'T0', 'WTLiable', 'WTLiable', "'N'")},
        T0.WhsCode AS Warehouse,
        ${lineUomCodeExpression} AS UoMCode,
        ${lineUomCodeExpression} AS UomCode,
        ${lineUomNameExpression} AS UoMName,
        ${lineUomNameExpression} AS UnitMsr,
        ${optionalColumn(lineFieldMetadata, 'T0', 'UomEntry', 'UomEntry', 'NULL')},
        ${optionalColumn(lineFieldMetadata, 'T0', 'CountryOrg', 'CountryOfOrigin', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'AgrNo', 'BlanketAgreementNo', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'StockPrice', 'ItemCost', '0')},
        ${optionalColumn(lineFieldMetadata, 'T0', 'U_AssblValue', 'AssessableValue', 'NULL')},
        ${optionalColumn(lineFieldMetadata, 'T0', 'LocCode', 'Loc', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'AcctCode', 'GLAccount', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'OcrCode', 'DistributionRule', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'CogsOcrCod', 'COGSDistributionRule', "''")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'OcrCode2', 'BranchCode', "''")},
        ${lineWithoutQtyPostingExpression} AS WithoutQtyPosting,
        ${optionalColumn(lineFieldMetadata, 'T0', 'EnSetCost', 'EnableSettingCost', "'N'")},
        ${optionalColumn(lineFieldMetadata, 'T0', 'RetCost', 'ReturnCost', 'NULL')},
        ${lineSacExpression} AS SACCode,
        ITM.ManBtchNum AS BatchManaged,
        ITM.InvntryUom AS InventoryUOM,
        T0.BaseEntry,
        T0.BaseType,
        T0.BaseLine,
        '' AS HSNCode
      FROM INV1 T0
      LEFT JOIN OITM ITM ON ITM.ItemCode = T0.ItemCode
      ${lineUomJoin}
      WHERE T0.DocEntry = @docEntry
      ORDER BY T0.LineNum
    `, { docEntry: resolvedDocEntry }));
  }

  const batchRows = await safe(db.query(`
    SELECT
      BaseLinNum AS BaseLineNum,
      BatchNum,
      ABS(Quantity) AS Quantity
    FROM IBT1
    WHERE BaseType = 13
      AND BaseEntry = @docEntry
    ORDER BY BaseLinNum, BatchNum
  `, { docEntry: resolvedDocEntry }));
  const batchesByLine = batchRows.reduce((acc, batch) => {
    const lineNum = batch.BaseLineNum;
    if (!acc[lineNum]) acc[lineNum] = [];
    acc[lineNum].push({
      batchNumber: batch.BatchNum || '',
      quantity: batch.Quantity != null ? String(batch.Quantity) : '',
    });
    return acc;
  }, {});
  const wtaxDocumentColumn = getTableFieldName(withholdingTaxFieldMetadata, 'AbsEntry')
    || getTableFieldName(withholdingTaxFieldMetadata, 'DocEntry');
  const wtaxCodeRef = sqlColumnRef(withholdingTaxFieldMetadata, 'T0', 'WTCode');
  const wtaxTaxableRef = sqlColumnRef(withholdingTaxFieldMetadata, 'T0', 'TaxbleAmnt')
    || sqlColumnRef(withholdingTaxFieldMetadata, 'T0', 'TaxableAmount');
  const wtaxAmountRef = sqlColumnRef(withholdingTaxFieldMetadata, 'T0', 'WTAmnt')
    || sqlColumnRef(withholdingTaxFieldMetadata, 'T0', 'WTAmount');
  const wtaxRateRef = sqlColumnRef(withholdingTaxFieldMetadata, 'T0', 'Rate');
  const wtaxCategoryRef = sqlColumnRef(withholdingTaxFieldMetadata, 'T0', 'Category');
  const withholdingTaxRows = wtaxDocumentColumn && wtaxCodeRef
    ? await safe(db.query(`
      SELECT
        ${wtaxCodeRef} AS WTCode,
        COALESCE(NULLIF(LTRIM(RTRIM(WT.WTName)), ''), ${wtaxCodeRef}) AS WTName,
        ${wtaxRateRef || 'WT.Rate'} AS Rate,
        ${wtaxTaxableRef || '0'} AS TaxableAmount,
        ${wtaxAmountRef || '0'} AS WTAmount,
        ${wtaxCategoryRef || 'WT.Category'} AS Category
      FROM INV5 T0
      LEFT JOIN OWHT WT ON WT.WTCode = ${wtaxCodeRef}
      WHERE T0.${sqlAlias(wtaxDocumentColumn)} = @docEntry
      ORDER BY ${wtaxCodeRef}
    `, { docEntry: resolvedDocEntry }))
    : [];

  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OINV', keyValue: resolvedDocEntry }),
    getLineUdfValues({ tableId: 'INV1', keyValue: resolvedDocEntry }),
  ]);

  return {
    ar_invoice: {
      doc_entry: header.DocEntry,
      doc_num: header.DocNum,
      header: {
        customer: header.CardCode,
        customerCode: header.CardCode,
        name: header.CardName,
        customerName: header.CardName,
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
        placeOfSupply: header.PlaceOfSupply || '',
        shipToCode: header.ShipToCode || '',
        payToCode: header.PayToCode || '',
        billToCode: header.PayToCode || '',
        shipTo: header.ShipToAddress || '',
        payTo: header.BillToAddress || '',
        shipToAddress: header.ShipToAddress || '',
        billToAddress: header.BillToAddress || '',
        shipToAddressComponents,
        billToAddressComponents,
        shippingType: header.ShippingType != null ? String(header.ShippingType) : '',
        confirmed: String(header.Confirmed || '').toUpperCase() === 'Y',
        journalRemark: header.JournalRemark || '',
        paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
        paymentTermsCode: header.PaymentTerms ? String(header.PaymentTerms) : '',
        paymentMethod: header.PaymentMethod || '',
        language: header.Language != null ? String(header.Language) : '',
        trackingNo: header.TrackingNo || '',
        stampNo: header.StampNo || '',
        pickPackRemarks: header.PickPackRemarks || '',
        bpChannelName: header.BpChannelName || '',
        bpChannelContact: header.BpChannelContact != null ? String(header.BpChannelContact) : '',
        otherInstruction: header.Remarks || '',
        discount: header.DiscountPercent != null ? String(header.DiscountPercent) : '',
        freight: header.Freight != null ? String(header.Freight) : '',
        rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
        roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
        tax: header.Tax != null ? String(header.Tax) : '',
        wtaxAmount: header.WTSum != null ? String(header.WTSum) : '',
        totalPaymentDue: header.TotalPaymentDue != null ? String(header.TotalPaymentDue) : '',
        salesEmployee: header.SalesEmployeeCode != null ? String(header.SalesEmployeeCode) : '',
        purchaser: header.SalesEmployeeName || '',
        ownerCode: header.OwnerCode != null ? String(header.OwnerCode) : '',
        owner: header.OwnerName || '',
        currency: header.Currency || '',
        exchangeRate: header.ExchangeRate != null ? String(header.ExchangeRate) : '',
      },
      lines: lineRows.map((line) => {
        const lineUdfs = lineUdfsByLineNum[line.LineNum] || {};
        return ({
        ...line,
        baseEntry: line.BaseEntry || null,
        baseType: line.BaseType || null,
        baseLine: line.BaseLine || null,
        lineNum: line.LineNum,
        LineNum: line.LineNum,
        itemNo: line.ItemCode || '',
        ItemCode: line.ItemCode || '',
        itemDescription: line.ItemDescription || '',
        ItemDescription: line.ItemDescription || '',
        hsnCode: line.HSNCode || '',
        HSNCode: line.HSNCode || '',
        quantity: line.Quantity != null ? String(line.Quantity) : '',
        Quantity: line.Quantity != null ? String(line.Quantity) : '',
        ...buildLineDeliveryDateFields(line),
        openQty: line.OpenQuantity != null ? String(line.OpenQuantity) : (line.Quantity != null ? String(line.Quantity) : ''),
        unitPrice: line.UnitPrice != null ? String(line.UnitPrice) : '',
        priceAfterDiscount: line.PriceAfterDiscount != null ? String(line.PriceAfterDiscount) : '',
        noOfPackages: line.NoOfPackages != null ? String(line.NoOfPackages) : '',
        itemsPerUnit: line.ItemsPerUnit != null ? String(line.ItemsPerUnit) : '',
        UnitPrice: line.UnitPrice != null ? String(line.UnitPrice) : '',
        stdDiscount: line.DiscountPercent != null ? String(line.DiscountPercent) : '',
        DiscountPercent: line.DiscountPercent != null ? String(line.DiscountPercent) : '',
        taxCode: line.TaxCode || '',
        TaxCode: line.TaxCode || '',
        total: line.LineTotal != null ? String(line.LineTotal) : '',
        totalLC: line.LineTotal != null ? String(line.LineTotal) : '',
        LineTotal: line.LineTotal != null ? String(line.LineTotal) : '',
        taxAmount: line.TaxAmount != null ? String(line.TaxAmount) : '',
        wTaxLiable: String(line.WTLiable || '').toUpperCase() === 'Y' ? 'Y' : 'N',
        WTLiable: String(line.WTLiable || '').toUpperCase() === 'Y' ? 'Y' : 'N',
        whse: line.Warehouse || '',
        WarehouseCode: line.Warehouse || '',
        WhsCode: line.Warehouse || '',
        glAccount: line.GLAccount || '',
        GLAccount: line.GLAccount || '',
        distRule: line.DistributionRule || '',
        DistributionRule: line.DistributionRule || '',
        cogsDistRule: line.COGSDistributionRule || line.DistributionRule || '',
        COGSDistributionRule: line.COGSDistributionRule || line.DistributionRule || '',
        uomCode: line.UoMCode || '',
        UoMCode: line.UoMCode || '',
        UomCode: line.UomCode || line.UoMCode || '',
        UomEntry: line.UomEntry != null ? String(line.UomEntry) : '',
        uomName: line.UoMName || line.UnitMsr || line.UoMCode || '',
        UoMName: line.UoMName || line.UnitMsr || '',
        UomName: line.UoMName || line.UnitMsr || '',
        UnitMsr: line.UnitMsr || '',
        inventoryUOM: line.InventoryUOM || line.UoMCode || '',
        InventoryUOM: line.InventoryUOM || line.UoMCode || '',
        batchManaged: String(line.BatchManaged || '').toUpperCase() === 'Y',
        BatchManaged: line.BatchManaged || '',
        batches: batchesByLine[line.LineNum] || [],
        countryOfOrigin: line.CountryOfOrigin || '',
        CountryOfOrigin: line.CountryOfOrigin || '',
        blanketAgreementNo: line.BlanketAgreementNo != null ? String(line.BlanketAgreementNo) : '',
        BlanketAgreementNo: line.BlanketAgreementNo != null ? String(line.BlanketAgreementNo) : '',
        itemCost: line.ItemCost != null ? String(line.ItemCost) : '',
        ItemCost: line.ItemCost != null ? String(line.ItemCost) : '',
        assessableValue: line.AssessableValue != null ? String(line.AssessableValue) : '',
        AssessableValue: line.AssessableValue != null ? String(line.AssessableValue) : '',
        loc: line.Loc || '',
        Loc: line.Loc || '',
        LocCode: line.Loc || '',
        LocationCode: line.Loc || '',
        branch: line.BranchCode || (header.Branch ? String(header.Branch) : ''),
        sacCode: line.SACCode != null ? String(line.SACCode) : '',
        SACCode: line.SACCode != null ? String(line.SACCode) : '',
        withoutQtyPosting: String(line.WithoutQtyPosting || '').toUpperCase() === 'Y' ? 'Y' : 'N',
        enableSettingCost: String(line.EnableSettingCost || '').toUpperCase() === 'Y' ? 'Y' : 'N',
        returnCost: line.ReturnCost != null ? String(line.ReturnCost) : '',
        udf: lineUdfs,
        line_udfs: lineUdfs,
      });
      }),
      DocumentLines: lineRows,
      withholdingTaxRows: withholdingTaxRows.map((row) => ({
        code: row.WTCode || '',
        name: row.WTName || '',
        rate: row.Rate != null ? String(row.Rate) : '',
        baseAmount: row.TaxableAmount != null ? String(row.TaxableAmount) : '',
        taxableAmount: row.TaxableAmount != null ? String(row.TaxableAmount) : '',
        wtaxAmount: row.WTAmount != null ? String(row.WTAmount) : '',
        category: row.Category || 'Invoice',
        baseType: 'Net',
        criteria: 'Cash',
        tdsType: 'eTDS',
      })),
      header_udfs: headerUdfs,
    },
  };
};

const getStateFromAddress = async (cardCode, addressCode) => {
  const result = await safe(db.query(`
    SELECT State
    FROM CRD1
    WHERE CardCode = @cardCode
      AND Address = @addressCode
  `, { cardCode, addressCode }));

  return {
    state: result.length > 0 ? result[0].State : '',
  };
};

const getWarehouseState = async (whsCode) => {
  const result = await safe(db.query(`
    SELECT State
    FROM OWHS
    WHERE WhsCode = @whsCode
  `, { whsCode }));

  return {
    state: result.length > 0 ? result[0].State : '',
  };
};

const getReferenceData = async () => getCachedReferenceData(loadReferenceDataUncached);

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

const BATCH_QTY_TOLERANCE = 0.001;
const SAP_YES_VALUES = new Set(['Y', 'YES', 'TRUE', 'TYES', '1']);

const parseBatchQtyNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const isSapYes = (value) => SAP_YES_VALUES.has(String(value || '').trim().toUpperCase());

const getLineUomFactor = (line = {}) => {
  const explicitFactor = parseBatchQtyNumber(line.uomFactor);
  if (explicitFactor > 0) return explicitFactor;

  const rawUomCode = String(line.uomCode || '').trim();
  const numericFactor = parseFloat(rawUomCode);
  if (Number.isFinite(numericFactor) && numericFactor > 0) {
    return numericFactor;
  }

  return 1;
};

const getRequiredBatchQty = (line = {}) =>
  parseBatchQtyNumber(line.quantity) * getLineUomFactor(line);

const createBaseDocumentError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  error.details = details;
  return error;
};

const parseRequiredBaseNumber = (value, fieldName, details) => {
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

const hasPositiveBatchAssignment = (line = {}) => (
  Array.isArray(line.batches) &&
  line.batches.some((batch) => (
    String(batch?.batchNumber || batch?.BatchNumber || batch?.BatchNum || '').trim() &&
    parseBatchQtyNumber(batch?.quantity ?? batch?.Quantity) > 0
  ))
);

const getDocumentLineRow = async ({ headerTable, lineTable, docEntry, lineNum }) => {
  const result = await db.query(`
    SELECT
      H.DocEntry,
      H.DocNum,
      H.DocStatus,
      H.CANCELED,
      L.LineNum,
      L.LineStatus,
      ISNULL(L.OpenQty, 0) AS OpenQty,
      ISNULL(L.Quantity, 0) AS Quantity
    FROM ${headerTable} H
    LEFT JOIN ${lineTable} L
      ON L.DocEntry = H.DocEntry
     AND L.LineNum = @LineNum
    WHERE H.DocEntry = @DocEntry
  `, { DocEntry: docEntry, LineNum: lineNum });

  return result.recordset?.[0] || null;
};

const validateARInvoiceBaseDocuments = async (lines = []) => {
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
    const baseType = parseRequiredBaseNumber(rawBaseType, 'baseType', details);
    const baseEntry = parseRequiredBaseNumber(rawBaseEntry, 'baseEntry', details);
    const baseLine = parseRequiredBaseNumber(rawBaseLine, 'baseLine', details);
    const requestedQty = parseBatchQtyNumber(line.quantity ?? line.Quantity);

    if (![17, 15].includes(baseType)) {
      throw createBaseDocumentError(
        'INVALID_BASE_DOCUMENT_TYPE',
        `A/R Invoice can only be copied from an open Sales Order or Delivery. BaseType ${baseType} is not allowed.`,
        { ...details, baseType, baseEntry, baseLine },
      );
    }

    if (baseType === 15 && hasPositiveBatchAssignment(line)) {
      throw createBaseDocumentError(
        'BATCH_ASSIGNMENT_NOT_REQUIRED',
        'Batch assignment is not required when creating an A/R Invoice from a Delivery.',
        { ...details, baseType, baseEntry, baseLine },
      );
    }

    const isDelivery = baseType === 15;
    const row = await getDocumentLineRow({
      headerTable: isDelivery ? 'ODLN' : 'ORDR',
      lineTable: isDelivery ? 'DLN1' : 'RDR1',
      docEntry: baseEntry,
      lineNum: baseLine,
    });

    if (!row) {
      throw createBaseDocumentError(
        'BASE_DOCUMENT_NOT_FOUND',
        `${isDelivery ? 'Delivery' : 'Sales Order'} ${baseEntry} was not found.`,
        { ...details, baseType, baseEntry, baseLine },
      );
    }

    if (String(row.CANCELED || '').toUpperCase() === 'Y' || String(row.DocStatus || '').toUpperCase() !== 'O') {
      throw createBaseDocumentError(
        isDelivery ? 'DELIVERY_ALREADY_INVOICED' : 'BASE_DOCUMENT_CLOSED',
        `${isDelivery ? 'Delivery' : 'Sales Order'} ${row.DocNum || baseEntry} is closed and cannot be copied to A/R Invoice.`,
        { ...details, baseType, baseEntry, baseLine, docStatus: row.DocStatus },
      );
    }

    if (row.LineNum === null || row.LineNum === undefined) {
      throw createBaseDocumentError(
        'BASE_LINE_NOT_FOUND',
        `${isDelivery ? 'Delivery' : 'Sales Order'} line ${baseLine} was not found.`,
        { ...details, baseType, baseEntry, baseLine },
      );
    }

    if (String(row.LineStatus || '').toUpperCase() !== 'O') {
      throw createBaseDocumentError(
        isDelivery ? 'DELIVERY_ALREADY_INVOICED' : 'BASE_LINE_CLOSED',
        `${isDelivery ? 'Delivery' : 'Sales Order'} line ${baseLine} is closed and cannot be invoiced again.`,
        { ...details, baseType, baseEntry, baseLine, lineStatus: row.LineStatus },
      );
    }

    const openQty = parseBatchQtyNumber(row.OpenQty);
    if (openQty <= BATCH_QTY_TOLERANCE) {
      throw createBaseDocumentError(
        isDelivery ? 'DELIVERY_ALREADY_INVOICED' : 'NO_OPEN_QUANTITY',
        isDelivery
          ? 'This Delivery line has already been fully invoiced.'
          : 'This Sales Order is closed or fully delivered and has no open quantity available for invoicing.',
        { ...details, baseType, baseEntry, baseLine, openQty },
      );
    }

    if (requestedQty - openQty > BATCH_QTY_TOLERANCE) {
      throw createBaseDocumentError(
        'QUANTITY_EXCEEDS_OPEN_QUANTITY',
        `Quantity ${requestedQty} exceeds open quantity ${openQty} on ${isDelivery ? 'Delivery' : 'Sales Order'} line ${baseLine}.`,
        { ...details, baseType, baseEntry, baseLine, requestedQty, openQty },
      );
    }
  }

  return { isValid: true };
};

const validateBatchSelection = async (lines = []) => {
  const errors = [];
  const lineErrors = [];
  const allocatedByStockBatch = new Map();

  for (const [lineIndex, line] of (lines || []).entries()) {
    if (Number(line?.baseType ?? line?.BaseType) === 15) continue;

    const itemCode = String(line.itemNo || line.ItemCode || '').trim();
    if (!itemCode) continue;

    const result = await safe(db.query(`
      SELECT T0.InvntItem, T0.ManBtchNum, T0.ItemName
      FROM OITM T0
      WHERE T0.ItemCode = @ItemCode
    `, { ItemCode: itemCode }));

    const item = result[0];
    if (!item || !isSapYes(item.InvntItem) || !isSapYes(item.ManBtchNum)) continue;

    if (!Array.isArray(line.batches) || line.batches.length === 0) {
      const message = `Batch selection is mandatory for batch-managed item ${itemCode}`;
      errors.push(message);
      lineErrors.push({ lineIndex, itemCode, type: 'missing', message });
      continue;
    }

    const totalBatchQty = line.batches.reduce(
      (sum, batch) => sum + parseBatchQtyNumber(batch.quantity),
      0
    );
    const requiredBatchQty = getRequiredBatchQty(line);
    const inventoryUOM = String(line.inventoryUOM || line.InventoryUOM || line.uomCode || 'Base UoM').trim();

    if (Math.abs(totalBatchQty - requiredBatchQty) > BATCH_QTY_TOLERANCE) {
      const message = `Batch quantity must match base quantity for item ${itemCode}. Required: ${requiredBatchQty.toFixed(2)} ${inventoryUOM}, Allocated: ${totalBatchQty.toFixed(2)} ${inventoryUOM}`;
      errors.push(message);
      lineErrors.push({ lineIndex, itemCode, type: 'quantity', message });
    }

    for (const batch of line.batches) {
      const batchNumber = String(batch.batchNumber || batch.BatchNumber || '').trim();
      const batchQty = parseBatchQtyNumber(batch.quantity);
      const whsCode = String(line.whse || line.WarehouseCode || line.warehouse || '').trim();

      if (!batchNumber || batchQty <= 0) continue;

      const key = JSON.stringify({ itemCode, whsCode, batchNumber });
      const current = allocatedByStockBatch.get(key) || {
        itemCode,
        whsCode,
        batchNumber,
        inventoryUOM,
        allocatedQty: 0,
      };
      current.allocatedQty += batchQty;
      allocatedByStockBatch.set(key, current);
    }
  }

  for (const entry of allocatedByStockBatch.values()) {
    const batchResult = await safe(db.query(`
      SELECT SUM(T0.Quantity) AS AvailableQty
      FROM OIBT T0
      WHERE T0.ItemCode = @ItemCode
        AND T0.BatchNum = @BatchNum
        AND T0.WhsCode = @WhsCode
    `, {
      ItemCode: entry.itemCode,
      BatchNum: entry.batchNumber,
      WhsCode: entry.whsCode,
    }));

    const availableQty = parseBatchQtyNumber(batchResult[0]?.AvailableQty);

    if (availableQty <= 0) {
      errors.push(`Batch ${entry.batchNumber} does not belong to warehouse ${entry.whsCode} for item ${entry.itemCode}`);
      continue;
    }

    if (entry.allocatedQty - availableQty > BATCH_QTY_TOLERANCE) {
      errors.push(
        `Batch ${entry.batchNumber} exceeds available quantity for item ${entry.itemCode} in warehouse ${entry.whsCode}. Allocated across A/R Invoice: ${entry.allocatedQty.toFixed(2)} ${entry.inventoryUOM}, Available: ${availableQty.toFixed(2)} ${entry.inventoryUOM}`
      );
    }
  }

  return { errors, lineErrors, isValid: errors.length === 0 };
};

const getFreightCharges = (docEntry) => {
  if (!docEntry) {
    // CREATE MODE (New AR Invoice)
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

  // EDIT MODE (Existing AR Invoice)
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
    LEFT JOIN INV3 T1 
      ON T0.ExpnsCode = T1.ExpnsCode 
     AND T1.DocEntry = @DocEntry

    ORDER BY T0.ExpnsName
  `, { DocEntry: docEntry }));
};

// Enhanced item list for modal with all details
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
    T0.ManSerNum AS SerialManaged,
    T0.CountryOrg AS ItemCountryOrg,
    T0.SACEntry AS SACEntry,
    T0.VatGourpSa AS TaxCodeAR
  FROM OITM T0
  LEFT JOIN OITB T1 ON T0.ItmsGrpCod = T1.ItmsGrpCod 
  LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
  WHERE T0.SellItem = 'Y'
    AND T0.validFor <> 'N'
  ORDER BY T0.ItemCode
`));

// ── COPY FROM FUNCTIONS ───────────────────────────────────────────────────────

const getSalesOrderForCopy = async (docEntry) => salesOrderDb.getSalesOrderForCopy(docEntry);

const getDeliveryForCopy = async (docEntry) => deliveryDb.getDeliveryForCopy(docEntry);

const getOpenSalesQuotations = (customerCode = null) => {
  const normalizedCustomerCode = String(customerCode || '').trim();
  const params = {};
  const customerFilter = normalizedCustomerCode ? 'AND T0.CardCode = @customerCode' : '';
  if (normalizedCustomerCode) {
    params.customerCode = normalizedCustomerCode;
  }

  return safe(db.query(`
  SELECT TOP 200
    T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate,
    T0.CardCode, T0.CardName, T0.Comments, T0.DocTotal
  FROM OQUT T0
  WHERE T0.DocStatus = 'O' AND T0.CANCELED <> 'Y'
    ${customerFilter}
  ORDER BY T0.DocDate DESC, T0.DocNum DESC
`, params));
};

const getSalesQuotationForCopy = async (docEntry) => salesQuotationDb.getSalesQuotationForCopy(docEntry);

const getARInvoiceForCopy = async (docEntry) => {
  const headerFieldMetadata = await getTableFieldMetadata('OINV');
  const branchAssignedExpression = hasTableField(headerFieldMetadata, 'BPL_IDAssignedToInvoice')
    ? 'T0.BPL_IDAssignedToInvoice'
    : 'T0.BPLId';

  const h = await db.query(`
    SELECT T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate, T0.TaxDate,
      T0.CardCode, T0.CardName, T0.CntctCode, T0.NumAtCard, T0.Comments,
      T0.BPLId, ${branchAssignedExpression} AS BPL_IDAssignedToInvoice, T0.GroupNum, T0.SlpCode,
      T0.DiscPrcnt, T0.TotalExpns AS Freight
    FROM OINV T0 WHERE T0.DocEntry = @DocEntry
  `, { DocEntry: docEntry });
  const l = await db.query(`
    SELECT T0.LineNum, T0.ItemCode, T0.Dscription AS ItemDescription,
      T0.OpenQty AS Quantity, ${await getDocumentUnitPriceSql(db, 'INV1', 'T0')} AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent, T0.WhsCode AS WarehouseCode,
      T0.TaxCode, T0.unitMsr AS UomCode, CHP.ChapterID AS HSNCode,
      T0.DocEntry AS BaseEntry, T0.LineNum AS BaseLine, 13 AS BaseType,
      T0.BaseEntry AS SourceBaseEntry, T0.BaseLine AS SourceBaseLine, T0.BaseType AS SourceBaseType
    FROM INV1 T0
    LEFT JOIN OITM ITM ON T0.ItemCode = ITM.ItemCode
    LEFT JOIN OCHP CHP ON ITM.ChapterID = CHP.AbsEntry
    WHERE T0.DocEntry = @DocEntry AND T0.LineStatus = 'O' AND T0.OpenQty > 0
    ORDER BY T0.LineNum
  `, { DocEntry: docEntry });
  const batchRows = await safe(db.query(`
    SELECT
      BaseLinNum AS BaseLineNum,
      BatchNum,
      ABS(Quantity) AS Quantity
    FROM IBT1
    WHERE BaseType = 13
      AND BaseEntry = @DocEntry
    ORDER BY BaseLinNum, BatchNum
  `, { DocEntry: docEntry }));
  const batchesByLine = batchRows.reduce((acc, batch) => {
    const lineNum = batch.BaseLineNum;
    if (!acc[lineNum]) acc[lineNum] = [];
    acc[lineNum].push({
      batchNumber: batch.BatchNum || '',
      quantity: batch.Quantity != null ? String(batch.Quantity) : '',
    });
    return acc;
  }, {});
  const invoiceLines = l.recordset || [];
  const deliveryBasedLines = invoiceLines.filter((line) => (
    !batchesByLine[line.LineNum]?.length &&
    Number(line.SourceBaseType) === 15 &&
    line.SourceBaseEntry != null &&
    line.SourceBaseLine != null
  ));
  if (deliveryBasedLines.length) {
    const uniqueDeliveryEntries = [...new Set(deliveryBasedLines.map((line) => Number(line.SourceBaseEntry)))];
    const deliveryBatchRows = [];
    for (const deliveryEntry of uniqueDeliveryEntries) {
      let rows = await safe(db.query(`
        SELECT
          BaseEntry,
          BaseLinNum AS BaseLineNum,
          BatchNum,
          ABS(Quantity) AS Quantity
        FROM IBT1
        WHERE BaseType = 15
          AND BaseEntry = @deliveryEntry
        ORDER BY BaseLinNum, BatchNum
      `, { deliveryEntry }));
      if (!rows.length) {
        rows = await safe(db.query(`
          SELECT
            T0.DocEntry AS BaseEntry,
            T0.DocLine AS BaseLineNum,
            T2.DistNumber AS BatchNum,
            ABS(T1.Quantity) AS Quantity
          FROM OITL T0
          INNER JOIN ITL1 T1 ON T1.LogEntry = T0.LogEntry
          INNER JOIN OBTN T2
            ON T2.ItemCode = T1.ItemCode
           AND T2.SysNumber = T1.SysNumber
          WHERE T0.DocEntry = @deliveryEntry
            AND T0.DocType = 15
            AND T1.Quantity <> 0
          ORDER BY T0.DocLine, T2.DistNumber
        `, { deliveryEntry }));
      }
      deliveryBatchRows.push(...rows);
    }

    deliveryBasedLines.forEach((line) => {
      const sourceBatches = deliveryBatchRows.filter((batch) => (
        Number(batch.BaseEntry) === Number(line.SourceBaseEntry) &&
        Number(batch.BaseLineNum) === Number(line.SourceBaseLine)
      ));
      if (!sourceBatches.length) return;
      batchesByLine[line.LineNum] = sourceBatches.map((batch) => ({
        batchNumber: batch.BatchNum || '',
        quantity: batch.Quantity != null ? String(batch.Quantity) : '',
      }));
    });
  }
  const lineUdfs = await getLineUdfValues({
    tableId: 'INV1',
    keyValue: docEntry,
  }).catch(() => ({}));
  const documentLines = invoiceLines.map((line) => ({
    ...line,
    batches: batchesByLine[line.LineNum] || [],
    line_udfs: { ...(lineUdfs[line.LineNum] || {}) },
    udf: { ...(lineUdfs[line.LineNum] || {}) },
  }));
  return { ...(h.recordset?.[0] || {}), freightCharges: (await getFreightCharges(docEntry)).filter(row => Number(row.LineTotal || 0) !== 0), DocumentLines: documentLines };
};

module.exports = {
  getARInvoiceHeaderTableFieldMetadata,
  getARInvoiceLineTableFieldMetadata,
  getReferenceData,
  getCustomerDetails,
  getARInvoiceList,
  getARInvoice,
  getDocumentSeries,
  getNextNumber,
  getStateFromAddress,
  getWarehouseState,
  getWarehouseBranch,
  getBatchesByItem,
  validateARInvoiceBaseDocuments,
  validateBatchSelection,
  getFreightCharges,
  getItemsForModal,
  getOpenSalesOrders,
  getSalesOrderForCopy,
  getOpenDeliveries,
  getDeliveryForCopy,
  getARInvoiceForCopy,
  getOpenSalesQuotations,
  getSalesQuotationForCopy,
};
