const { resolveDocumentConfirmationStatus } = require('./documentConfirmationUtils');
/**
 * Delivery DB Service - ODBC/Direct SQL for GET operations
 * Reads data directly from SAP B1 SQL Server database
 */
const db = require('./dbService');
const { loadCompanyUomGroups } = require('./documentUomDbUtils');
const { loadBusinessPartnerAddresses } = require('./businessPartnerAddressDbUtils');
const masterDataDbService = require('./masterDataDbService');
const salesOrderDb = require('./salesOrderDbService');
const { buildMarketingDocumentListFilterQuery } = require('./documentListUtils');
const {
  buildAddressExtensionSelectFields,
  buildDocumentAddressComponents,
} = require('./documentAddressDbUtils');
const {
  getHeaderUdfValues,
  getLineUdfValues,
  getMarketingDocumentUdfs,
  getUdfDefinitions,
} = require('./udfMetadataService');
const { getMarketingDocumentSeries } = require('./documentSeriesDbUtils');
const { getDocumentTaxCodeSql } = require('./documentTaxUtils');
const {
  createTableColumnDetailsReader,
  createTableFieldMetadataReader,
  resolveDatabaseScope,
  selectPhysicalOptionalColumn,
} = require('./salesDocumentDbCompatibility');
const authDbService = require('./authDbService');
const { getRequestContext } = require('./requestContextService');
const { selectEffectiveCprfRows } = require('./sapFormPreferenceUtils');

const safe = async (promise) => {
  try {
    const r = await promise;
    return r.recordset || [];
  } catch (e) {
    console.warn('[Delivery DB] Query failed silently:', e.message);
    return [];
  }
};

const REFERENCE_DATA_CACHE_TTL_MS = Number(process.env.DELIVERY_REFERENCE_DATA_CACHE_TTL_MS || 5 * 60 * 1000);
const referenceDataCache = new Map();

const cloneReferenceData = (data) => JSON.parse(JSON.stringify(data || {}));

const getReferenceDataCacheKey = async () => {
  const scope = await resolveDatabaseScope(db);
  return scope.cacheKey;
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
  referenceDataCache.set(cacheKey, {
    pending,
    expiresAt: now + REFERENCE_DATA_CACHE_TTL_MS,
  });

  try {
    const data = await pending;
    referenceDataCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + REFERENCE_DATA_CACHE_TTL_MS,
    });
    return cloneReferenceData(data);
  } catch (error) {
    const latest = referenceDataCache.get(cacheKey);
    if (latest?.pending === pending) {
      referenceDataCache.delete(cacheKey);
    }
    throw error;
  }
};

const quoteSqlIdentifier = (identifier) => `[${String(identifier || '').replace(/]/g, ']]')}]`;
const normalizeUdfNameForMatch = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const unique = (values = []) => [...new Set(values.filter(Boolean))];

const toFiniteNumberOrUndefined = (value) => {
  if (value == null || String(value).trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getLineDiscountPercent = (discountAmount, unitPrice, fallbackDiscountPercent) => {
  const fallback = toFiniteNumberOrUndefined(fallbackDiscountPercent);
  if (fallback !== undefined) return fallback;

  const discount = toFiniteNumberOrUndefined(discountAmount);
  const price = toFiniteNumberOrUndefined(unitPrice);
  if (discount !== undefined && price !== undefined && price > 0) {
    return (discount * 100) / price;
  }

  return undefined;
};

const hasNonBlankValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const formatSapDate = (value) => {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  return String(value).split('T')[0];
};

const normalizeEDocGenerationType = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    n: 'edocNotRelevant',
    no: 'edocNotRelevant',
    notrelevant: 'edocNotRelevant',
    edocnotrelevant: 'edocNotRelevant',
    g: 'edocGenerate',
    generate: 'edocGenerate',
    edocgenerate: 'edocGenerate',
    l: 'edocGenerateLater',
    later: 'edocGenerateLater',
    generatelater: 'edocGenerateLater',
    edocgeneratelater: 'edocGenerateLater',
    o: 'edocGenerateOffline',
    offline: 'edocGenerateOffline',
    generateoffline: 'edocGenerateOffline',
    edocgenerateoffline: 'edocGenerateOffline',
  };
  return aliases[normalized] || raw;
};

const normalizeEDocStatus = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const normalized = raw.toUpperCase();
  return ({
    N: 'New',
    P: 'Pending',
    W: 'Waiting',
    S: 'Sent',
    E: 'Error',
    C: 'OK',
    O: 'OK',
  })[normalized] || raw;
};

const getUdfAliasValue = (values = {}, aliases = []) => {
  for (const alias of aliases) {
    if (hasNonBlankValue(values[alias])) return values[alias];
  }

  const entries = Object.entries(values || {});
  for (const alias of aliases) {
    const normalizedAlias = normalizeUdfNameForMatch(alias);
    const match = entries.find(([key, value]) => (
      normalizeUdfNameForMatch(key) === normalizedAlias && hasNonBlankValue(value)
    ));
    if (match) return match[1];
  }

  return '';
};

const formatUdfValue = (value) => (value == null ? '' : String(value));

const buildNullableTrimmedTextExpression = (expression) => (
  `NULLIF(LTRIM(RTRIM(CAST(${expression} AS NVARCHAR(254)))), '')`
);

const resolveColumnName = (fieldMetadata = {}, candidateColumnName) => {
  const normalizedCandidate = normalizeUdfNameForMatch(candidateColumnName);
  return Object.keys(fieldMetadata).find(
    (columnName) => normalizeUdfNameForMatch(columnName) === normalizedCandidate
  );
};

const hasTableField = (metadata, columnName) => {
  const normalizedColumnName = String(columnName || '').trim().toLowerCase();
  if (!metadata || !normalizedColumnName) return false;
  return Object.keys(metadata).some((fieldName) => fieldName.toLowerCase() === normalizedColumnName);
};

const buildDeliverySellerExpression = (columnNames, fallbackExpression) => {
  const udfExpressions = unique(columnNames).map((columnName) => (
    buildNullableTrimmedTextExpression(`T0.${quoteSqlIdentifier(columnName)}`)
  ));

  return `
  COALESCE(
    ${[...udfExpressions, fallbackExpression, "''"].join(',\n    ')}
  )
`;
};

// ── REFERENCE DATA QUERIES ────────────────────────────────────────────────────

const getCustomers = () => safe(db.query(`
  SELECT CardCode, CardName, CardType, Currency, Balance,
         VatGroup, GroupNum AS PayTermsGrpCode, PymCode
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
         AvgPrice    AS ItemCost,
         CountryOrg  AS ItemCountryOrg,
         SACEntry    AS SACEntry,
         VatGourpSa  AS TaxCodeAR,
         ''          AS DistributionRule,
         DfltWH      AS DefaultWarehouse,
         SWW         AS HSNCode,
         InvntItem   AS InventoryItem,
         ManBtchNum  AS BatchManaged,
         ManSerNum   AS SerialManaged
  FROM   OITM
  WHERE  SellItem = 'Y'
    AND  validFor  <> 'N'
  ORDER  BY ItemCode
`));

const getWarehouses = async () => {
  const metadata = await getTableFieldMetadata('OWHS');
  const branchExpression = hasTableField(metadata, 'BPLid') ? 'T0.BPLid' : 'NULL';
  const locationExpression = hasTableField(metadata, 'Location') ? 'T0.Location' : 'NULL';
  const binExpression = hasTableField(metadata, 'BinActivat') ? 'T0.BinActivat' : "'N'";
  return safe(db.query(`
    SELECT T0.WhsCode, T0.WhsName, T0.Street, T0.Block,
           T0.City, T0.County, T0.State, T0.ZipCode, T0.Country,
           ${branchExpression} AS BranchID,
           ${locationExpression} AS LocationCode,
           ${binExpression} AS BinActivat
    FROM OWHS T0
    WHERE T0.Inactive <> 'Y'
    ORDER BY T0.WhsCode
  `));
};

const getLocations = async () => {
  const metadata = await getTableFieldMetadata('OLCT');
  if (!hasTableField(metadata, 'Code') || !hasTableField(metadata, 'Location')) return [];
  return safe(db.query('SELECT Code, Location FROM OLCT ORDER BY Location'));
};

const getPaymentTerms = () => safe(db.query(`
  SELECT GroupNum, PymntGroup
  FROM   OCTG
  ORDER  BY PymntGroup
`));

const getPaymentMethods = () => safe(db.query(`
  SELECT PayMethCod AS Code, Descript AS Description
  FROM   OPYM
  ORDER  BY PayMethCod
`));

const pickFirstValue = (row = {}, candidates = []) => {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate) && row[candidate] != null && row[candidate] !== '') {
      return row[candidate];
    }
  }
  return '';
};

const getDeliveryReferenceDocuments = async (docEntry) => {
  const fieldMetadata = await getTableFieldMetadata('DLN21');
  if (!fieldMetadata?.DocEntry) return [];

  const orderBy = fieldMetadata.LineNum ? 'ORDER BY [LineNum]' : '';
  const rows = await safe(db.query(`
    SELECT TOP 200 *
    FROM [DLN21]
    WHERE [DocEntry] = @DocEntry
    ${orderBy}
  `, { DocEntry: docEntry }));

  return rows.map((row, index) => {
    const transactionType = pickFirstValue(row, [
      'RefObjType',
      'RefType',
      'ObjType',
      'ObjectType',
      'RefObjCode',
      'RefObj',
    ]);
    const docEntryValue = pickFirstValue(row, [
      'RefDocEntr',
      'RefDocEntry',
      'RefDocEnt',
      'RefDocEn',
      'LinkedDocEntry',
    ]);
    const docNumber = pickFirstValue(row, [
      'RefDocNum',
      'RefDocNo',
      'RefDocNumber',
      'DocNum',
      'RefDoc',
    ]);
    const extDocNumber = pickFirstValue(row, [
      'ExtDocNum',
      'ExtDocNo',
      'ExtDocNumber',
      'ExternalRefNo',
      'ExternalReferencedDocNumber',
    ]);

    return {
      lineNum: row.LineNum != null ? Number(row.LineNum) : index,
      direction: 'to',
      transactionType: transactionType != null ? String(transactionType) : '',
      docEntry: docEntryValue != null ? String(docEntryValue) : '',
      docNumber: docNumber != null ? String(docNumber) : '',
      extDocNumber: extDocNumber != null ? String(extDocNumber) : '',
      issueDate: formatSapDate(row.IssueDate || row.RefDate || row.DocDate),
      remark: String(pickFirstValue(row, ['Remark', 'Remarks', 'Comments']) || ''),
    };
  }).filter((row) => (
    String(row.transactionType || row.docEntry || row.docNumber || row.extDocNumber || '').trim()
  ));
};

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

const getEWayBillFormats = () => safe(db.query(`
  SELECT AbsEntry, Name, Descr, Type
  FROM OLLF
  WHERE Type = 'EWBD'
    AND Assigned <> 'D'
  ORDER BY Name
`));

const getGenericEDocFormats = () => safe(db.query(`
  SELECT AbsEntry, Name, Descr, Type
  FROM OLLF
  WHERE (Type <> 'EWBD' OR Type IS NULL)
    AND Assigned <> 'D'
  ORDER BY Name
`));

// SAP B1's E-Way Bill transporter master. Selecting the live row shape keeps
// this compatible with SAP patch levels that expose additional transporter fields.
const getEWayBillTransporters = () => safe(db.query(`
  SELECT *
  FROM OTSP
  ORDER BY TransCode
`));

const getEWayBillDropdownOptions = async () => {
  const [subSupplyType, documentType, mode, vehicleType] = await Promise.all([
    safe(db.query('SELECT * FROM OEST')),
    safe(db.query('SELECT * FROM OEDT')),
    safe(db.query('SELECT * FROM OETM')),
    safe(db.query('SELECT * FROM OEVT')),
  ]);
  const normalize = (rows, valueKeys, labelKeys) => (rows || []).map((row) => {
    const entries = Object.entries(row || {}).filter(([, value]) => value !== null && value !== undefined);
    const read = (keys) => {
      for (const preferredKey of keys) {
        const match = entries.find(([key]) => key.toLowerCase() === preferredKey.toLowerCase());
        if (match) return match[1];
      }
      return undefined;
    };
    const value = read(valueKeys) ?? entries[0]?.[1] ?? '';
    const label = read([
      ...labelKeys,
      'Name', 'Descr', 'Description', 'Dscription',
      'SubName', 'TypeName', 'ModeName', 'VehicleName',
    ]) ?? [...entries].reverse().find(([, item]) => String(item) !== String(value))?.[1] ?? value;
    return { value: String(value), label: String(label) };
  }).filter((option) => option.value !== '').sort((a, b) => a.label.localeCompare(b.label));
  return {
    subSupplyType: normalize(subSupplyType, ['AbsEntry'], ['SubName', 'SubTypeName']),
    documentType: normalize(documentType, ['TypeCode', 'Code', 'AbsEntry'], ['TypeName', 'DocTypeName']),
    mode: normalize(mode, ['ModeCode', 'AbsEntry'], ['ModeName', 'TransModeName']),
    vehicleType: normalize(vehicleType, ['TypeCode', 'Code', 'AbsEntry'], ['TypeName', 'VehicleName']),
  };
};

const resolveEWayBillHSNEntry = async (chapterId) => {
  const normalized = String(chapterId || '').trim();
  if (!normalized) return null;
  const rows = await safe(db.query(`
    SELECT TOP 1 AbsEntry
    FROM OCHP
    WHERE ChapterID = @chapterId
  `, { chapterId: normalized }));
  return rows[0]?.AbsEntry ?? null;
};

const resolveEWayBillStateCode = async (state) => {
  const normalized = String(state || '').trim();
  if (!normalized) return '';
  const rows = await safe(db.query(`
    SELECT TOP 1 Code
    FROM OCST
    WHERE Country = 'IN' AND (Code = @state OR Name = @state)
    ORDER BY CASE WHEN Code = @state THEN 0 ELSE 1 END
  `, { state: normalized }));
  return rows[0]?.Code || normalized;
};

const getBranches = () => safe(db.query(`
  SELECT BPLId, BPLName, TaxIdNum, Address, Street, StreetNo, Building,
         Block, City, County, State, ZipCode, Country
  FROM   OBPL where Disabled='N'
  ORDER  BY BPLName
`));

const getDistributionRules = () => safe(db.query(`
  SELECT TOP 200 OcrCode AS FactorCode, OcrName AS FactorDescription
  FROM   OOCR
  WHERE  Active <> 'N'
  ORDER  BY OcrCode
`));

const getStates = () => safe(db.query(`
  SELECT Code, Name
  FROM   OCST
  WHERE  Country = 'IN'
  ORDER  BY Name
`));

const getTaxCodes = () => masterDataDbService.searchDocumentTaxCodes('', 'sales', 500, 0);

const getUomGroups = () => loadCompanyUomGroups(db);

const resolveDeliveryLineUomEntry = async (itemCode, uomValue, options = {}) =>
  salesOrderDb.resolveSalesOrderLineUomEntry(itemCode, uomValue, options);

const getBaseSalesOrderLineItemCode = async (docEntry, lineNum) => {
  const rows = await safe(db.query(`
    SELECT TOP 1 ItemCode
    FROM RDR1
    WHERE DocEntry = @DocEntry
      AND LineNum = @LineNum
  `, {
    DocEntry: Number(docEntry),
    LineNum: Number(lineNum),
  }));

  return String(rows[0]?.ItemCode || '').trim();
};

const getTableFieldMetadata = createTableFieldMetadataReader({ database: db });
const getTableColumnDetails = createTableColumnDetailsReader({ database: db });

const getDeliveryLineFieldMetadata = () => getTableFieldMetadata('DLN1');
const getDeliveryHeaderFieldMetadata = () => getTableFieldMetadata('ODLN');

const DELIVERY_FORM_ID = '140';
const DELIVERY_MATRIX_ITEM_ID = '38';

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
  const currentWidth = Number(current.Width);
  const nextWidth = Number(next.Width);
  if (Number.isFinite(currentWidth) && Number.isFinite(nextWidth) && currentWidth !== nextWidth) {
    return nextWidth > currentWidth;
  }
  return false;
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

const getDeliveryColumnPreferences = async () => {
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
    formId: DELIVERY_FORM_ID,
    itemId: DELIVERY_MATRIX_ITEM_ID,
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
      formId: DELIVERY_FORM_ID,
      tableName: 'DLN1',
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
    column.label,
  ].map(normalizePreferenceKey).filter(Boolean);

  for (const candidate of candidates) {
    if (preferences[candidate]) return preferences[candidate];
  }

  return null;
};

const getDeliverySacLookupSqlParts = (
  lineAlias,
  sacAlias,
  sacFieldMetadata = {},
  lineFieldMetadata = {},
) => {
  const sacEntryColumn = resolveColumnName(lineFieldMetadata, 'SACEntry');
  const sacAbsEntryColumn = resolveColumnName(sacFieldMetadata, 'AbsEntry');
  const canJoin = Boolean(sacEntryColumn && sacAbsEntryColumn);
  const serviceNameColumn = resolveColumnName(sacFieldMetadata, 'ServName')
    || resolveColumnName(sacFieldMetadata, 'ServiceName');
  const serviceCodeColumn = resolveColumnName(sacFieldMetadata, 'ServCode')
    || resolveColumnName(sacFieldMetadata, 'ServiceCode');
  const serviceNameExpression = canJoin && serviceNameColumn
    ? `${sacAlias}.${quoteSqlIdentifier(serviceNameColumn)}`
    : "''";
  const serviceCodeExpression = canJoin && serviceCodeColumn
    ? `${sacAlias}.${quoteSqlIdentifier(serviceCodeColumn)}`
    : "''";
  const sacEntryExpression = sacEntryColumn
    ? `CAST(${lineAlias}.${quoteSqlIdentifier(sacEntryColumn)} AS NVARCHAR(50))`
    : "''";

  return {
    joinSql: canJoin
      ? `LEFT JOIN OSAC ${sacAlias} ON ${sacAlias}.${quoteSqlIdentifier(sacAbsEntryColumn)} = ${lineAlias}.${quoteSqlIdentifier(sacEntryColumn)}`
      : '',
    serviceNameExpression,
    serviceCodeExpression,
    displayExpression: `COALESCE(NULLIF(LTRIM(RTRIM(${serviceNameExpression})), ''), NULLIF(LTRIM(RTRIM(${serviceCodeExpression})), ''), ${sacEntryExpression}, '')`,
  };
};

const DELIVERY_MATRIX_COLUMN_DEFS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160, sapField: 'ItemCode', sapColumnIds: ['1', 'ItemCode', 'Item No.', 'ItemNo'] },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240, sapField: 'Dscription', sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Item Description'] },
  { key: 'quantity', label: 'Quantity', minWidth: 90, numeric: true, sapField: 'Quantity', sapColumnIds: ['11', 'Quantity', 'Qty'] },
  { key: 'uomName', label: 'UoM Name', minWidth: 120, sapField: 'unitMsr', alternativeFields: [], sapColumnIds: ['1470002145', 'unitMsr', 'UomName', 'UoM Name'] },
  { key: 'hsnCode', label: 'HSN', minWidth: 95, readOnly: true, source: 'OITM', sapColumnIds: ['254000391', 'HsnEntry', 'HsnCode', 'HSN', 'HSN/SAC'] },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 110, numeric: true, sapField: 'Price', alternativeFields: ['PriceBefDi'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'Unit Price'] },
  { key: 'taxCode', label: 'Tax Code', minWidth: 110, sapField: 'TaxCode', alternativeFields: ['VatGroup'], sapColumnIds: ['160', '234000377', 'TaxCode', 'VatGroup', 'Tax Code'] },
  { key: 'U_PackingType', label: 'Packing-Type', minWidth: 140, sapField: 'U_PackingType', sapColumnIds: ['U_PackingType', 'U_PACKINGTYPE', 'U_PACKING_TYPE', 'Packing-Type'], isUdf: true },
  { key: 'U_GrossWt', label: 'GrossWt', minWidth: 110, numeric: true, sapField: 'U_GrossWt', sapColumnIds: ['U_GrossWt', 'U_GROSSWT', 'U_GROSS_WT', 'GrossWt'], isUdf: true },
  { key: 'U_TotalPackage', label: 'Total-Package', minWidth: 130, numeric: true, sapField: 'U_TotalPackage', sapColumnIds: ['U_TotalPackage', 'U_TOTALPACKAGE', 'U_TOTAL_PACKAGE', 'Total-Package'], isUdf: true },
  { key: 'totalLC', label: 'Total (LC)', minWidth: 115, readOnly: true, numeric: true, sapField: 'LineTotal', sapColumnIds: ['17', 'LineTotal', 'GTotal', 'Total', 'Total (LC)'] },
  { key: 'whse', label: 'Whse', minWidth: 85, sapField: 'WhsCode', sapColumnIds: ['174', 'WhsCode', 'Warehouse', 'Whse'] },
  { key: 'binLocationAllocation', label: 'Bin Location Allocation', minWidth: 160, readOnly: true, source: 'calculated', sapColumnIds: ['Bin Location Allocation'] },
  { key: 'priceAfterDiscount', label: 'Price after Discount', minWidth: 130, readOnly: true, numeric: true, source: 'calculated', sapColumnIds: ['Price after Discount'] },
  { key: 'itemCost', label: 'Item Cost', minWidth: 110, readOnly: true, numeric: true, source: 'OITM', sapColumnIds: ['Item Cost'] },
  { key: 'taxCodeRepeat', label: 'TaxCode', minWidth: 110, readOnly: true, source: 'calculated', sapColumnIds: ['TaxCode'] },
  { key: 'price', label: 'Price', minWidth: 95, readOnly: true, numeric: true, source: 'calculated', sapColumnIds: ['Price'] },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 125, numeric: true, sapField: 'U_Brok_Seller', isUdfBacked: true },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', minWidth: 125, numeric: true, sapField: 'U_Brok_Buyer', isUdfBacked: true },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', minWidth: 135, sapField: 'U_Buyer_Delivery', isUdfBacked: true },
  { key: 'sellerDelivery', label: 'Seller - Delivery', minWidth: 135, sapField: 'U_Seller_Delivery', isUdfBacked: true },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of payment', minWidth: 180, sapField: 'U_Buyer_Payment_Terms', isUdfBacked: true },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', minWidth: 180, sapField: 'U_Seller_Payment_Terms', alternativeFields: ['U_Seller_Payment_Term'], isUdfBacked: true },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 155, sapField: 'U_Buyer_Quality', isUdfBacked: true },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 155, sapField: 'U_Seller_Quality', isUdfBacked: true },
  { key: 'buyerPrice', label: 'Buyer - Price', minWidth: 135, sapField: 'U_Buyer_Price', isUdfBacked: true },
  { key: 'sellerPrice', label: 'Seller - Price', minWidth: 135, sapField: 'U_Seller_Price', isUdfBacked: true },
  { key: 'buyerSpecialInstruction', label: 'Buyer - Special Instruction', minWidth: 190, sapField: 'U_Buyer_SPINS', isUdfBacked: true },
  { key: 'sellerSpecialInstruction', label: 'Seller - Special Instruction', minWidth: 190, sapField: 'U_Seller_SPINS', isUdfBacked: true },
  { key: 'sellerBrokerageAmtPer', label: 'Seller Brokerage(Amt./Per)', minWidth: 165, sapField: 'U_Sel_Brok_AP', isUdfBacked: true },
  { key: 'sellerBrokeragePercent', label: 'Seller Brokerage in Percentage', minWidth: 180, numeric: true, sapField: 'U_Seller_Brok_Per', isUdfBacked: true },
  { key: 'stcode', label: 'STCODE', minWidth: 110, sapField: 'U_SELLTCODE', isUdfBacked: true },
  { key: 'sellerItem', label: 'S_Item', minWidth: 125, sapField: 'U_S_Item', isUdfBacked: true },
  { key: 'sellerQty', label: 'S_Qty', minWidth: 110, numeric: true, sapField: 'U_S_Qty', isUdfBacked: true },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 120, numeric: true, sapField: 'U_SPLRBT', isUdfBacked: true },
  { key: 'commission', label: 'Commision', minWidth: 110, numeric: true, sapField: 'U_COMPRC', isUdfBacked: true },
  { key: 'sellerBrokeragePerQty', label: 'BrokPerQty', minWidth: 115, numeric: true, sapField: 'U_S_BrokPerQty', isUdfBacked: true },
  { key: 'U_Fix_Brock_B', label: 'FIX Brok BUYER', minWidth: 135, numeric: true, sapField: 'U_Fix_Brock_B', alternativeFields: ['U_Fix_Brok_B', 'U_FIXBROKBUYER', 'U_FixBrokBuyer'], isUdf: true },
  { key: 'U_Fix_Brock_S', label: 'Fix Brock Seller', minWidth: 140, numeric: true, sapField: 'U_Fix_Brock_S', alternativeFields: ['U_Fix_Brok_S', 'U_FIXBROCKSELLER', 'U_FIXBROKSELLER', 'U_FixBrockSeller'], isUdf: true },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 95, numeric: true, sapField: 'DiscPrcnt', visible: false },
  { key: 'taxAmount', label: 'Tax Amount (LC)', minWidth: 125, readOnly: true, numeric: true, sapField: 'VatSum', visible: false },
  { key: 'qtyToShip', label: 'Qty to Ship', minWidth: 110, numeric: true, readOnly: true, sapField: 'QtyToShip', sapColumnIds: ['10000314'] },
  { key: 'orderedQty', label: 'Ordered Qty', minWidth: 95, numeric: true, readOnly: true, sapField: 'OrderedQty', source: 'RDR1', sapColumnIds: ['10000310'] },
  { key: 'balanceQty', label: 'Bal Qty', minWidth: 95, readOnly: true, source: 'calculated', visible: false },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105, sapField: 'UomCode', alternativeFields: ['UomEntry'], sapColumnIds: ['1470002149', 'UomCode', 'UoMCode', 'UoM Code'], visible: false },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 105, sapField: 'OcrCode', visible: false },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 185, sapField: 'CountryOrg', visible: false },
  { key: 'loc', label: 'Loc.', minWidth: 115, readOnly: true, sapField: 'LocCode', visible: false },
  { key: 'sacCode', label: 'SAC', minWidth: 95, sapField: 'SACEntry', visible: false },
];

const getColumnMetadata = (column, columns = {}) => {
  const candidates = [
    column.sapField,
    ...(column.alternativeFields || []),
    column.key,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const metadata = columns[String(candidate).toUpperCase()];
    if (metadata) return metadata;
  }

  return null;
};

const buildDeliveryLineUiMetadata = async (rowUdfDefinitions = []) => {
  const [lineFieldMetadata, preferencesResult] = await Promise.all([
    getDeliveryLineFieldMetadata(),
    getDeliveryColumnPreferences(),
  ]);
  const lineColumns = Object.entries(lineFieldMetadata || {}).reduce((acc, [name, dataType]) => {
    acc[String(name || '').toUpperCase()] = { name, dataType };
    return acc;
  }, {});
  const hasPreferences = preferencesResult.rows.length > 0;
  const rowUdfByKey = new Map((rowUdfDefinitions || []).map((field) => [normalizeUdfNameForMatch(field.key || field.sapField), field]));
  const findUdfFieldForColumn = (column = {}) => {
    const candidates = [
      column.sapField,
      ...(column.alternativeFields || []),
      column.key,
      column.label,
    ].map(normalizeUdfNameForMatch).filter(Boolean);

    return candidates.map((candidate) => rowUdfByKey.get(candidate)).find(Boolean) || null;
  };

  const matrixColumns = DELIVERY_MATRIX_COLUMN_DEFS.map((column, index) => {
    const metadata = getColumnMetadata(column, lineColumns);
    const udfField = findUdfFieldForColumn(column);
    const exists = Boolean(metadata || column.source || column.isUdf || column.isUdfBacked || udfField);
    if (!exists) return null;
    const effectiveKey = column.isUdf && udfField?.key ? udfField.key : column.key;

    const preference = findColumnPreference(column, preferencesResult.byKey);
    const visible = preference
      ? sapFlagToBoolean(preference.VisInForm, column.visible !== false)
      : column.visible !== false;
    const active = preference
      ? sapFlagToBoolean(preference.EditInForm, udfField?.active !== false)
      : udfField?.active !== false;
    const width = Number(preference?.Width);
    const order = Number.isFinite(Number(preference?.VisualIndx))
      ? Number(preference.VisualIndx)
      : index + 1;

    return {
      ...column,
      key: effectiveKey,
      valueKey: effectiveKey,
      rendererKey: effectiveKey,
      label: column.label || udfField?.label || effectiveKey,
      sapField: column.sapField || '',
      dataType: metadata?.dataType || udfField?.dataType || '',
      required: column.key === 'whse',
      readOnly: Boolean(column.readOnly || udfField?.readOnly),
      visible,
      active,
      minWidth: Number.isFinite(width) && width > 0
        ? Math.max(width, column.minWidth || 125)
        : (column.minWidth || 125),
      order,
      type: udfField?.type || column.type,
      options: udfField?.options || undefined,
      lookupSource: udfField?.lookupSource || undefined,
      lookupTable: udfField?.lookupTable || undefined,
      isUdf: Boolean(column.isUdf),
      field: column.isUdf ? (udfField || undefined) : undefined,
      sapControlled: hasPreferences,
      hasPreference: Boolean(preference),
      sapColumnId: preference?.ColID || '',
    };
  }).filter(Boolean)
    .sort((left, right) => (left.order || 0) - (right.order || 0));

  return {
    matrix_columns: matrixColumns,
    row_udfs: rowUdfDefinitions,
    sap_form: {
      formId: DELIVERY_FORM_ID,
      matrixItemId: DELIVERY_MATRIX_ITEM_ID,
      userSign: preferencesResult.userSign,
      preferenceRows: preferencesResult.rows.length,
    },
  };
};

const getDeliverySellerExpressions = async () => {
  try {
    const [fieldMetadata, udfDefinitions] = await Promise.all([
      getTableFieldMetadata('ODLN'),
      getUdfDefinitions('ODLN'),
    ]);

    const resolveExplicitColumns = (candidates) => unique(
      candidates.map((candidate) => resolveColumnName(fieldMetadata, candidate))
    );

    const resolveDefinitionColumns = (acceptedMatches) => unique(
      udfDefinitions
        .filter((field) => {
          const aliasMatch = normalizeUdfNameForMatch(field.aliasId || field.key);
          const keyMatch = normalizeUdfNameForMatch(field.key);
          const labelMatch = normalizeUdfNameForMatch(field.label || field.Descr);
          return [aliasMatch, keyMatch, labelMatch].some((match) => acceptedMatches.has(match));
        })
        .map((field) => resolveColumnName(fieldMetadata, field.key))
    );

    const codeColumns = unique([
      ...resolveExplicitColumns([
        'U_Seller_Code',
        'U_To_Code_Vendor',
        'U_ToCodeVendor',
        'U_To_Code',
        'U_ToCode',
        'U_To_Vendor_Code',
        'U_Vendor_Code',
        'U_Party_Code',
      ]),
      ...resolveDefinitionColumns(new Set([
        'SELLERCODE',
        'USELLERCODE',
        'TOCODEVENDOR',
        'UTOCODEVENDOR',
        'TOCODE',
        'UTOCODE',
        'TOVENDORCODE',
        'UTOVENDORCODE',
        'VENDORCODE',
        'UVENDORCODE',
        'PARTYCODE',
        'UPARTYCODE',
      ])),
    ]);

    const nameColumns = unique([
      ...resolveExplicitColumns([
        'U_Seller_Name',
        'U_To_Name',
        'U_ToName',
        'U_Vendor_Name',
        'U_Party_Name',
      ]),
      ...resolveDefinitionColumns(new Set([
        'SELLERNAME',
        'USELLERNAME',
        'TONAME',
        'UTONAME',
        'VENDORNAME',
        'UVENDORNAME',
        'PARTYNAME',
        'UPARTYNAME',
      ])),
    ]);

    return {
      codeExpression: buildDeliverySellerExpression(
        codeColumns,
        `CASE
      WHEN T0.SlpCode IS NOT NULL AND T0.SlpCode <> -1 THEN CAST(T0.SlpCode AS NVARCHAR(50))
      ELSE ''
    END`
      ),
      nameExpression: buildDeliverySellerExpression(
        nameColumns,
        `CASE
      WHEN T0.SlpCode IS NOT NULL AND T0.SlpCode <> -1 THEN NULLIF(LTRIM(RTRIM(SLP.SlpName)), '')
      ELSE ''
    END`
      ),
    };
  } catch (error) {
    console.warn('[Delivery List] Falling back to sales employee seller fields:', error.message);
    return {
      codeExpression: `CASE
      WHEN T0.SlpCode IS NOT NULL AND T0.SlpCode <> -1 THEN CAST(T0.SlpCode AS NVARCHAR(50))
      ELSE ''
    END`,
      nameExpression: `CASE
      WHEN T0.SlpCode IS NOT NULL AND T0.SlpCode <> -1 THEN NULLIF(LTRIM(RTRIM(SLP.SlpName)), '')
      ELSE ''
    END`,
    };
  }
};

const LOOKUP_UDF_CONFIG = {
  U_Buyer_Quality: {
    tableId: 'DLN1',
    aliasId: 'Buyer_Quality',
    columnName: 'U_Buyer_Quality',
  },
  U_Seller_Quality: {
    tableId: 'DLN1',
    aliasId: 'Seller_Quality',
    columnName: 'U_Seller_Quality',
  },
  U_Buyer_Price: {
    tableId: 'DLN1',
    aliasId: 'Buyer_Price',
    columnName: 'U_Buyer_Price',
  },
  U_Seller_Price: {
    tableId: 'DLN1',
    aliasId: 'Seller_Price',
    columnName: 'U_Seller_Price',
  },
};

const normalizeLookupAlias = (aliasId) => {
  const normalized = String(aliasId || '').trim();
  if (!normalized) return '';
  if (LOOKUP_UDF_CONFIG[normalized]) return normalized;

  const prefixed = normalized.startsWith('U_') ? normalized : `U_${normalized}`;
  if (LOOKUP_UDF_CONFIG[prefixed]) return prefixed;

  const byAliasId = Object.entries(LOOKUP_UDF_CONFIG).find(([, config]) => (
    String(config.aliasId || '').toLowerCase() === normalized.replace(/^U_/, '').toLowerCase()
  ));

  return byAliasId ? byAliasId[0] : '';
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

const getUdfValidValues = (tableId, aliasId) => safe(db.query(`
  SELECT
    LTRIM(RTRIM(ISNULL(T1.FldValue, ''))) AS Value,
    LTRIM(RTRIM(ISNULL(T1.Descr, ''))) AS Description,
    T1.IndexID
  FROM CUFD T0
  INNER JOIN UFD1 T1
    ON T0.TableID = T1.TableID
   AND T0.FieldID = T1.FieldID
  WHERE T0.TableID = @tableId
    AND (T0.AliasID = @aliasId OR CONCAT('U_', T0.AliasID) = @aliasId)
  ORDER BY T1.IndexID, T1.FldValue
`, { tableId, aliasId }));

const getExistingLookupValues = async (aliasId) => {
  const normalizedAlias = normalizeLookupAlias(aliasId);
  const config = LOOKUP_UDF_CONFIG[normalizedAlias];
  if (!config) return [];

  const fieldMetadata = await getTableFieldMetadata(config.tableId);
  const columnName = Object.keys(fieldMetadata || {}).find(
    (fieldName) => fieldName.toLowerCase() === config.columnName.toLowerCase()
  );
  if (!columnName) return [];
  const quotedColumnName = quoteSqlIdentifier(columnName);

  return safe(db.query(`
    SELECT DISTINCT
      LTRIM(RTRIM(CAST(${quotedColumnName} AS NVARCHAR(254)))) AS Value,
      '' AS Description
    FROM ${quoteSqlIdentifier(config.tableId)}
    WHERE NULLIF(LTRIM(RTRIM(CAST(${quotedColumnName} AS NVARCHAR(254)))), '') IS NOT NULL
    ORDER BY Value
  `));
};

const getLookupValues = async (aliasId) => {
  const normalizedAlias = normalizeLookupAlias(aliasId);
  const config = LOOKUP_UDF_CONFIG[normalizedAlias];
  if (!config) return [];

  const validValues = await getUdfValidValues(config.tableId, normalizedAlias);
  if (validValues.length > 0) {
    return mapLookupRows(validValues);
  }

  const [existingValues, salesOrderValues] = await Promise.all([
    getExistingLookupValues(normalizedAlias),
    salesOrderDb.getLookupValues(normalizedAlias).catch(() => []),
  ]);

  return mapLookupRows([...existingValues, ...salesOrderValues]);
};

const getLookupUdfDefinition = async (aliasId) => {
  const normalizedAlias = normalizeLookupAlias(aliasId);
  const config = LOOKUP_UDF_CONFIG[normalizedAlias];
  if (!config) return null;

  const rows = await safe(db.query(`
    SELECT TOP 1 TableID, AliasID, FieldID, Descr
    FROM CUFD
    WHERE TableID = @tableId
      AND AliasID = @aliasId
  `, {
    tableId: config.tableId,
    aliasId: config.aliasId,
  }));

  return rows[0] || null;
};

const createLookupValue = async (aliasId, value, description = '') => {
  const normalizedAlias = normalizeLookupAlias(aliasId);
  const config = LOOKUP_UDF_CONFIG[normalizedAlias];
  if (!config) {
    throw new Error('Unsupported lookup field.');
  }

  const udfDefinition = await getLookupUdfDefinition(normalizedAlias);
  if (!udfDefinition) {
    throw new Error(`SAP UDF definition not found for ${normalizedAlias}.`);
  }

  const normalizedValue = String(value || '').trim();
  const normalizedDescription = String(description || normalizedValue).trim();

  if (!normalizedValue) {
    throw new Error('Value is required.');
  }

  const existingRows = await safe(db.query(`
    SELECT TOP 1
      LTRIM(RTRIM(ISNULL(FldValue, ''))) AS Value,
      LTRIM(RTRIM(ISNULL(Descr, ''))) AS Description
    FROM UFD1
    WHERE TableID = @tableId
      AND FieldID = @fieldId
      AND UPPER(LTRIM(RTRIM(ISNULL(FldValue, '')))) = @fieldValue
  `, {
    tableId: config.tableId,
    fieldId: udfDefinition.FieldID,
    fieldValue: normalizedValue.toUpperCase(),
  }));

  if (existingRows[0]) {
    return mapLookupRows(existingRows)[0];
  }

  const nextIndexRows = await db.query(`
    SELECT ISNULL(MAX(IndexID), -1) + 1 AS NextIndex
    FROM UFD1
    WHERE TableID = @tableId
      AND FieldID = @fieldId
  `, {
    tableId: config.tableId,
    fieldId: udfDefinition.FieldID,
  });

  const nextIndex = Number(nextIndexRows.recordset?.[0]?.NextIndex ?? 0);

  await db.query(`
    INSERT INTO UFD1 (TableID, FieldID, IndexID, FldValue, Descr, FldDate)
    VALUES (@tableId, @fieldId, @indexId, @fieldValue, @description, NULL)
  `, {
    tableId: config.tableId,
    fieldId: udfDefinition.FieldID,
    indexId: nextIndex,
    fieldValue: normalizedValue,
    description: normalizedDescription,
  });

  return mapLookupRows([{
    Value: normalizedValue,
    Description: normalizedDescription,
  }])[0];
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
  const { addresses } = await loadBusinessPartnerAddresses(db, cardCode, { context: 'Delivery' });
  return addresses;
};

// ── SALES ORDERS (FOR COPY FROM) ──────────────────────────────────────────────

const getOpenSalesOrders = async (customerCode = null) => {
  
  // =========================
  // STEP 1: Check header only
  // =========================
  const headerQuery = `
    SELECT 
      DocEntry, DocNum, CardCode, DocStatus, CANCELED
    FROM ORDR
    WHERE 
      DocStatus = 'O'
      AND CANCELED = 'N'
      ${customerCode ? "AND CardCode = @customerCode" : ""}
  `;

  const headerData = await db.query(headerQuery, customerCode ? { customerCode } : {});
 
  // =========================
  // STEP 2: Check line open qty
  // =========================
  const lineQuery = `
    SELECT 
      T0.DocEntry,
      T0.DocNum,
      T1.LineNum,
      T1.OpenQty,
      T1.Quantity,
      T1.LineStatus
    FROM ORDR T0
    INNER JOIN RDR1 T1 ON T0.DocEntry = T1.DocEntry
    WHERE 
      T0.DocStatus = 'O'
      AND T0.CANCELED = 'N'
      ${customerCode ? "AND T0.CardCode = @customerCode" : ""}
  `;

  const lineData = await db.query(lineQuery, customerCode ? { customerCode } : {});
  
  // =========================
  // STEP 3: Check OPEN QTY only
  // =========================
  const openLineQuery = `
    SELECT 
      T0.DocEntry,
      T0.DocNum,
      T1.LineNum,
      T1.OpenQty
    FROM ORDR T0
    INNER JOIN RDR1 T1 ON T0.DocEntry = T1.DocEntry
    WHERE 
      T0.DocStatus = 'O'
      AND T0.CANCELED = 'N'
      ${customerCode ? "AND T0.CardCode = @customerCode" : ""}
      AND T1.OpenQty > 0
  `;

  const openLines = await db.query(openLineQuery, customerCode ? { customerCode } : {});
  
  // =========================
  // FINAL QUERY
  // =========================
  const finalQuery = `
    SELECT 
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.DocDate,
      T0.DocDueDate,
      T0.Comments,
      T0.DocTotal

    FROM ORDR T0

    WHERE 
      T0.DocStatus = 'O'
      AND T0.CANCELED = 'N'
      ${customerCode ? "AND T0.CardCode = @customerCode" : ""}

      AND EXISTS (
        SELECT 1
        FROM RDR1 T1
        WHERE 
          T1.DocEntry = T0.DocEntry
          AND T1.OpenQty > 0
      )

    ORDER BY 
      T0.DocDate DESC,
      T0.DocNum DESC
  `;

  const result = await db.query(finalQuery, customerCode ? { customerCode } : {});

  return { orders: result.recordset };
};
const getSalesOrderForCopy = async (docEntry) => salesOrderDb.getSalesOrderForCopy(docEntry);

const getOpenArReserveInvoices = async (customerCode = null) => {
  const invoiceMetadata = await getTableFieldMetadata('OINV');
  if (!hasTableField(invoiceMetadata, 'isIns')) {
    return { invoices: [], warning: 'A/R Reserve Invoice metadata is not available in this company.' };
  }
  const result = await safe(db.query(`
    SELECT
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.DocDate,
      T0.DocDueDate,
      T0.Comments,
      T0.DocTotal,
      T0.DocCur
    FROM OINV T0
    WHERE T0.isIns = 'Y'
      AND T0.DocStatus = 'O'
      AND T0.CANCELED = 'N'
      ${customerCode ? 'AND T0.CardCode = @customerCode' : ''}
      AND EXISTS (
        SELECT 1 FROM INV1 T1
        WHERE T1.DocEntry = T0.DocEntry
          AND T1.OpenQty > 0
      )
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
  `, customerCode ? { customerCode } : {}));
  return { invoices: result };
};

const getArReserveInvoiceForCopy = async (docEntry) => {
  const invoiceMetadata = await getTableFieldMetadata('OINV');
  if (!hasTableField(invoiceMetadata, 'isIns')) {
    const error = new Error('A/R Reserve Invoice metadata is not available in this company.');
    error.statusCode = 422;
    throw error;
  }
  const invoiceBranchColumn = resolveColumnName(invoiceMetadata, 'BPLId')
    || resolveColumnName(invoiceMetadata, 'BPL_IDAssignedToInvoice');
  const headers = await safe(db.query(`
    SELECT
      T0.DocEntry, T0.DocNum, T0.CardCode, T0.CardName,
      T0.DocDate, T0.DocDueDate, T0.TaxDate, T0.CntctCode,
      T0.NumAtCard, T0.Comments, ${invoiceBranchColumn ? `T0.${quoteSqlIdentifier(invoiceBranchColumn)}` : 'NULL'} AS BPLId, T0.GroupNum,
      T0.SlpCode, T0.DiscPrcnt, T0.DocCur, T0.DocRate,
      T0.ShipToCode, T0.PayToCode, T0.Address, T0.Address2
    FROM OINV T0
    WHERE T0.DocEntry = @DocEntry
      AND T0.isIns = 'Y'
      AND T0.DocStatus = 'O'
      AND T0.CANCELED = 'N'
  `, { DocEntry: docEntry }));
  if (!headers.length) {
    const error = new Error('Open A/R Reserve Invoice not found.');
    error.statusCode = 404;
    throw error;
  }
  const lines = await safe(db.query(`
    SELECT
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.OpenQty AS Quantity,
      T0.OpenQty,
      COALESCE(T0.PriceBefDi, T0.Price) AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      T0.WhsCode AS WarehouseCode,
      T0.TaxCode,
      T0.unitMsr AS UomCode,
      T0.UomEntry,
      T0.OcrCode AS DistributionRule,
      T0.FreeTxt AS FreeText,
      T0.CountryOrg,
      T0.LineTotal
    FROM INV1 T0
    WHERE T0.DocEntry = @DocEntry
      AND T0.OpenQty > 0
      AND T0.LineStatus = 'O'
    ORDER BY T0.LineNum
  `, { DocEntry: docEntry }));
  return { ar_reserve_invoice: { DocEntry: headers[0].DocEntry, header: headers[0], lines } };
};

const getDeliveryForCopy = async (docEntry) => {
  const headerFieldMetadata = await getTableFieldMetadata('ODLN');
  const taxCodeExpression = getDocumentTaxCodeSql(await getDeliveryLineFieldMetadata());
  const branchColumn = resolveColumnName(headerFieldMetadata, 'BPLId')
    || resolveColumnName(headerFieldMetadata, 'BPL_IDAssignedToInvoice');
  const branchAssignedExpression = hasTableField(headerFieldMetadata, 'BPL_IDAssignedToInvoice')
    ? `T0.${quoteSqlIdentifier(resolveColumnName(headerFieldMetadata, 'BPL_IDAssignedToInvoice'))}`
    : branchColumn
      ? `T0.${quoteSqlIdentifier(branchColumn)}`
      : 'NULL';
  const branchExpression = branchColumn ? `T0.${quoteSqlIdentifier(branchColumn)}` : 'NULL';

  const h = await db.query(`
    SELECT T0.DocEntry, T0.DocNum, T0.DocDate, T0.DocDueDate, T0.TaxDate,
      T0.CardCode, T0.CardName, T0.CntctCode, T0.NumAtCard, T0.Comments,
      ${branchExpression} AS BPLId, ${branchAssignedExpression} AS BPL_IDAssignedToInvoice, T0.GroupNum, T0.SlpCode,
      T0.DiscPrcnt, T0.TotalExpns AS Freight
    FROM ODLN T0 WHERE T0.DocEntry = @DocEntry
  `, { DocEntry: docEntry });
  const l = await db.query(`
    SELECT T0.LineNum, T0.ItemCode, T0.Dscription AS ItemDescription,
      T0.OpenQty AS Quantity, COALESCE(T0.PriceBefDi, T0.Price) AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent, T0.WhsCode AS WarehouseCode,
      ${taxCodeExpression} AS TaxCode, T0.unitMsr AS UomCode,
      CASE
        WHEN ISNULL(T0.Quantity, 0) = 0 THEN ISNULL(T0.LineTotal, 0)
        ELSE ISNULL(T0.LineTotal, 0) * ISNULL(T0.OpenQty, 0) / NULLIF(T0.Quantity, 0)
      END AS LineTotal,
      CASE
        WHEN ISNULL(T0.Quantity, 0) = 0 THEN ISNULL(T0.VatSum, 0)
        ELSE ISNULL(T0.VatSum, 0) * ISNULL(T0.OpenQty, 0) / NULLIF(T0.Quantity, 0)
      END AS TaxAmount,
      CHP.ChapterID AS HSNCode,
      T0.DocEntry AS BaseEntry, T0.LineNum AS BaseLine, 15 AS BaseType
    FROM DLN1 T0
    LEFT JOIN OITM ITM ON T0.ItemCode = ITM.ItemCode
    LEFT JOIN OCHP CHP ON ITM.ChapterID = CHP.AbsEntry
    WHERE T0.DocEntry = @DocEntry AND T0.LineStatus = 'O' AND T0.OpenQty > 0
    ORDER BY T0.LineNum
  `, { DocEntry: docEntry });
  const lineUdfs = await getLineUdfValues({
    tableId: 'DLN1',
    keyValue: docEntry,
  }).catch(() => ({}));
  const documentLines = (l.recordset || []).map((line) => ({
    ...line,
    line_udfs: { ...(lineUdfs[line.LineNum] || {}) },
    udf: { ...(lineUdfs[line.LineNum] || {}) },
  }));
  return { ...(h.recordset?.[0] || {}), freightCharges: (await getFreightCharges(docEntry)).filter(row => Number(row.LineTotal || 0) !== 0), DocumentLines: documentLines };
};

// ── GET DELIVERY FOR COPY TO CREDIT MEMO ──────────────────────────────────────

const getDeliveryForCopyToCreditMemo = async (docEntry) => {
  const headerFieldMetadata = await getTableFieldMetadata('ODLN');
  const taxCodeExpression = getDocumentTaxCodeSql(await getDeliveryLineFieldMetadata());
  const branchColumn = resolveColumnName(headerFieldMetadata, 'BPLId')
    || resolveColumnName(headerFieldMetadata, 'BPL_IDAssignedToInvoice');
  // Get delivery header
  const headerRows = await safe(db.query(`
    SELECT 
      T0.DocEntry,
      T0.DocNum,
      T0.CardCode,
      T0.CardName,
      T0.CntctCode AS ContactPersonCode,
      T0.NumAtCard AS CustomerRefNo,
      T0.CreateDate AS DocumentCreated,
      T0.DocDate AS PostingDate,
      T0.DocDueDate AS DeliveryDate,
      T0.TaxDate AS DocumentDate,
      ${branchColumn ? `T0.${quoteSqlIdentifier(branchColumn)}` : 'NULL'} AS Branch,
      T0.DocCur AS Currency,
      T0.DocRate AS ExchangeRate,
      T0.GroupNum AS PaymentTerms,
      T0.ShipToCode,
      T0.PayToCode,
      T0.Address,
      T0.Address2,
      T0.TrnspCode AS ShippingType,
      T0.Confirmed,
      T0.SlpCode AS SalesEmployeeCode,
      SLP.SlpName AS SalesEmployeeName,
      T0.Comments AS Remarks,
      T0.JrnlMemo AS JournalRemark,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TotalExpns AS Freight,
      T0.VatSum AS Tax,
      T0.DocTotal AS TotalPaymentDue
    FROM ODLN T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    WHERE T0.DocEntry = @docEntry
      AND T0.DocStatus = 'O'
  `, { docEntry }));

  if (!headerRows.length) {
    throw new Error(`Delivery ${docEntry} not found or already closed`);
  }

  const header = headerRows[0];

  // Get lines with open quantity (not fully copied)
  const lineRows = await safe(db.query(`
    SELECT 
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      T0.OpenQty,
      COALESCE(T0.PriceBefDi, T0.Price) AS UnitPrice,
      T0.DiscPrcnt AS DiscountPercent,
      ${taxCodeExpression} AS TaxCode,
      CASE
        WHEN ISNULL(T0.Quantity, 0) = 0 THEN ISNULL(T0.LineTotal, 0)
        ELSE ISNULL(T0.LineTotal, 0) * ISNULL(T0.OpenQty, 0) / NULLIF(T0.Quantity, 0)
      END AS LineTotal,
      CASE
        WHEN ISNULL(T0.Quantity, 0) = 0 THEN ISNULL(T0.VatSum, 0)
        ELSE ISNULL(T0.VatSum, 0) * ISNULL(T0.OpenQty, 0) / NULLIF(T0.Quantity, 0)
      END AS TaxAmount,
      T0.WhsCode AS Warehouse,
      T0.unitMsr AS UoMCode
    FROM DLN1 T0
    WHERE T0.DocEntry = @docEntry
      AND T0.LineStatus = 'O'
      AND T0.OpenQty > 0
    ORDER BY T0.LineNum
  `, { docEntry }));

  if (!lineRows.length) {
    throw new Error('No rows available for copying. All lines are fully copied or closed.');
  }

  const lineUdfs = await getLineUdfValues({
    tableId: 'DLN1',
    keyValue: docEntry,
  }).catch(() => ({}));

  // Get HSN codes and batch info for items
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
      // Could not fetch item info
    }
  }

  return {
    header: {
      customer: header.CardCode,
      name: header.CardName,
      contactPerson: header.ContactPersonCode ? String(header.ContactPersonCode) : '',
      salesContractNo: header.CustomerRefNo || '',
      branch: header.Branch ? String(header.Branch) : '',
      paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
      otherInstruction: header.Remarks || '',
      baseRef: header.DocNum ? String(header.DocNum) : '', // Reference to delivery doc number
    },
    lines: lineRows.map(l => {
      const itemInfo = itemInfoMap[l.ItemCode] || { hsnCode: '', batchManaged: false };
      return {
        baseEntry: docEntry,
        baseType: 15, // Delivery
        baseLine: l.LineNum,
        itemNo: l.ItemCode || '',
        itemDescription: l.ItemDescription || '',
        hsnCode: itemInfo.hsnCode,
        quantity: l.OpenQty != null ? String(l.OpenQty) : '', // Use OpenQty for credit memo
        openQty: l.OpenQty != null ? String(l.OpenQty) : '',
        unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
        stdDiscount: l.DiscountPercent != null ? String(l.DiscountPercent) : '',
        taxCode: l.TaxCode || '',
        taxAmount: l.TaxAmount != null ? String(l.TaxAmount) : '',
        total: l.LineTotal != null ? String(l.LineTotal) : '',
        whse: l.Warehouse || '',
        uomCode: l.UoMCode || '',
        batchManaged: itemInfo.batchManaged,
        batches: [],
        udf: { ...(lineUdfs[l.LineNum] || {}) },
      };
    }),
  };
};

// ── BATCHES ───────────────────────────────────────────────────────────────────

const getBatchesByItem = async (itemCode, whsCode) => {
  const selectedWarehouse = String(whsCode || '').trim();
  const baseSelect = `
    SELECT 
      T0.BatchNum AS BatchNumber,
      T0.Quantity AS AvailableQty,
      T0.ExpDate AS ExpiryDate,
      T0.WhsCode AS WhsCode,
      W.WhsName AS WhsName
    FROM OIBT T0
    LEFT JOIN OWHS W ON W.WhsCode = T0.WhsCode
    WHERE T0.ItemCode = @itemCode
      AND T0.Quantity > 0
  `;

  if (selectedWarehouse) {
    const selectedResult = await safe(db.query(`
      ${baseSelect}
        AND T0.WhsCode = @whsCode
      ORDER BY T0.ExpDate
    `, { itemCode, whsCode: selectedWarehouse }));

    if (selectedResult.length) {
      return {
        batches: selectedResult,
        selectedWarehouse,
        hasSelectedWarehouseBatches: true,
        fallbackToOtherWarehouses: false,
      };
    }
  }

  const result = await safe(db.query(`
    ${baseSelect}
    ORDER BY
      CASE WHEN T0.WhsCode = @whsCode THEN 0 ELSE 1 END,
      T0.WhsCode,
      T0.ExpDate
  `, { itemCode, whsCode: selectedWarehouse }));

  return {
    batches: result,
    selectedWarehouse,
    hasSelectedWarehouseBatches: !selectedWarehouse ? result.length > 0 : false,
    fallbackToOtherWarehouses: Boolean(selectedWarehouse && result.length),
  };
};

// ── DELIVERY LIST ─────────────────────────────────────────────────────────────

const getDeliveryList = async ({
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
  const {
    codeExpression: sellerCodeExpression,
    nameExpression: sellerNameExpression,
  } = await getDeliverySellerExpressions();
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

  const countRows = await safe(db.query(`
    SELECT COUNT(*) AS total_count
    FROM ODLN T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    WHERE ${whereClauses.join('\n      AND ')}
  `, params));

  const totalCount = Number(countRows?.[0]?.total_count || 0);

  const result = await safe(db.query(`
    SELECT
      T0.DocEntry AS doc_entry,
      T0.DocNum AS doc_num,
      T0.CardCode AS customer_code,
      T0.CardName AS customer_name,
      ${sellerCodeExpression} AS seller_code,
      ${sellerNameExpression} AS seller_name,
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
        FROM DLN1 T1
        WHERE T1.DocEntry = T0.DocEntry
      ) AS line_count
    FROM ODLN T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    deliveries: result.map((row) => ({
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

// ── GET SINGLE DELIVERY ───────────────────────────────────────────────────────

const resolveDeliveryDocEntry = async (identifier) => {
  const normalizedIdentifier = Number(identifier);
  if (!Number.isFinite(normalizedIdentifier)) {
    throw new Error(`Invalid Delivery identifier: ${identifier}`);
  }

  const rows = await safe(db.query(`
    SELECT TOP 1 DocEntry, DocNum
    FROM ODLN
    WHERE DocEntry = @DocEntry
       OR DocNum = @DocNum
    ORDER BY CASE WHEN DocEntry = @DocEntry THEN 0 ELSE 1 END, DocEntry
  `, {
    DocEntry: normalizedIdentifier,
    DocNum: normalizedIdentifier,
  }));

  return rows[0] || null;
};

const getDelivery = async (docEntry) => {
  const resolvedDocument = await resolveDeliveryDocEntry(docEntry);
  if (!resolvedDocument) {
    throw new Error(`Delivery ${docEntry} not found`);
  }

  const resolvedDocEntry = resolvedDocument.DocEntry;
  const odlnFieldMetadata = await getTableFieldMetadata('ODLN');
  const addressExtensionFieldMetadata = await getTableFieldMetadata('DLN12');
  const eDocFormatFieldMetadata = await getTableFieldMetadata('OLLF');
  const addressExtensionSelectFields = buildAddressExtensionSelectFields({
    fieldMetadata: addressExtensionFieldMetadata,
    tableAlias: 'T12',
    quoteIdentifier: quoteSqlIdentifier,
    quoteAlias: quoteSqlIdentifier,
  });
  const optionalHeaderColumn = (candidates, alias, fallback = "''") => {
    const columnName = candidates.map((candidate) => resolveColumnName(odlnFieldMetadata, candidate)).find(Boolean);
    return columnName
      ? `T0.${quoteSqlIdentifier(columnName)} AS ${quoteSqlIdentifier(alias)}`
      : `${fallback} AS ${quoteSqlIdentifier(alias)}`;
  };
  const eDocExportFormatColumn = resolveColumnName(odlnFieldMetadata, 'EDocExpFrm');
  const eDocFormatAbsEntryColumn = resolveColumnName(eDocFormatFieldMetadata, 'AbsEntry');
  const eDocFormatTypeColumn = resolveColumnName(eDocFormatFieldMetadata, 'Type');
  const eDocFormatNameColumn = resolveColumnName(eDocFormatFieldMetadata, 'Name');
  const canJoinEDocFormat = Boolean(eDocExportFormatColumn && eDocFormatAbsEntryColumn);
  const eDocFormatJoinSql = canJoinEDocFormat
    ? `LEFT JOIN OLLF EDF ON EDF.${quoteSqlIdentifier(eDocFormatAbsEntryColumn)} = T0.${quoteSqlIdentifier(eDocExportFormatColumn)}`
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
      T0.CntctCode AS ContactPersonCode,
      T0.NumAtCard AS CustomerRefNo,
      T0.CreateDate AS DocumentCreated,
      T0.DocDate AS PostingDate,
      T0.DocDueDate AS DeliveryDate,
      T0.TaxDate AS DocumentDate,
      ${optionalHeaderColumn(['BPLId', 'BPL_IDAssignedToInvoice'], 'Branch', 'NULL')},
      T0.DocCur AS Currency,
      T0.DocRate AS ExchangeRate,
      T0.GroupNum AS PaymentTerms,
      T0.SlpCode AS SalesEmployeeCode,
      SLP.SlpName AS SalesEmployeeName,
      T0.Comments AS Remarks,
      T0.JrnlMemo AS JournalRemark,
      T0.DiscPrcnt AS DiscountPercent,
      T0.TotalExpns AS Freight,
      T0.VatSum AS Tax,
      T0.RoundDif AS RoundingAmount,
      T0.DocTotal AS TotalPaymentDue,
      T0.ShipToCode,
      T0.PayToCode,
      T0.Address,
      T0.Address2,
      ${addressExtensionSelectFields.join(',\n      ')},
      ${optionalHeaderColumn(['EDocGenTyp'], 'EDocGenerationType')},
      ${optionalHeaderColumn(['EDocExpFrm'], 'EDocExportFormat', 'NULL')},
      ${optionalHeaderColumn(['EDocStatus'], 'EDocStatus')},
      ${canJoinEDocFormat && eDocFormatTypeColumn ? `EDF.${quoteSqlIdentifier(eDocFormatTypeColumn)}` : "''"} AS EDocExportFormatType,
      ${canJoinEDocFormat && eDocFormatNameColumn ? `EDF.${quoteSqlIdentifier(eDocFormatNameColumn)}` : "''"} AS EDocExportFormatName,
      ${optionalHeaderColumn(['TrnspCode'], 'ShippingType', 'NULL')},
      ${optionalHeaderColumn(['Confirmed'], 'Confirmed')},
      ${optionalHeaderColumn(['LangCode'], 'LanguageCode', 'NULL')},
      ${optionalHeaderColumn(['TrackNo'], 'TrackingNo')},
      ${optionalHeaderColumn(['StampNum'], 'StampNo')},
      ${optionalHeaderColumn(['PickRmrk'], 'PickAndPackRemarks')},
      ${optionalHeaderColumn(['BPChCode'], 'BPChannelCode')},
      ${optionalHeaderColumn(['BPChCntc'], 'BPChannelContact', 'NULL')},
      ${optionalHeaderColumn(['PeyMethod'], 'PaymentMethod')},
      ${optionalHeaderColumn(['CentralBankInd', 'CntrlBnk'], 'CentralBankIndicator')},
      ${optionalHeaderColumn(['Project'], 'ProjectCode')},
      ${optionalHeaderColumn(['QRCodeSrc', 'QRCodeSource'], 'QRCodeSource')},
      ${optionalHeaderColumn(['Indicator'], 'Indicator')},
      ${optionalHeaderColumn(['ImportEnt'], 'OrderNumber')},
      ${optionalHeaderColumn(['OwnerCode'], 'OwnerCode', 'NULL')},
      CASE WHEN EMP.empID IS NOT NULL
        THEN LTRIM(RTRIM(CONCAT(CONCAT(COALESCE(EMP.firstName, ''), ' '), COALESCE(EMP.lastName, ''))))
        ELSE ''
      END AS OwnerName,
      ${optionalHeaderColumn(['FatherType'], 'ConsolidationType')},
      ${optionalHeaderColumn(['FatherCard'], 'ConsolidatingBP')},
      ${optionalHeaderColumn(['UseShpdGd', 'UseShippedGoods'], 'UseShippedGoods')},
      ${optionalHeaderColumn(['AtcEntry'], 'AttachmentEntry', 'NULL')},
      ${optionalHeaderColumn(['TransCat', 'TransactionCategory'], 'TransactionCategory')},
      ${optionalHeaderColumn(['FormNo', 'TaxFormNo'], 'TaxFormNo')},
      ${optionalHeaderColumn(['DutyStatus'], 'DutyStatus')},
      ${optionalHeaderColumn(['Export', 'IsExport', 'Exported'], 'ExportFlag')},
      ${optionalHeaderColumn(['DiffPercent', 'DifferentialTaxRate', 'DiffTaxRate'], 'DifferentialTaxRate', '100')},
      ${optionalHeaderColumn(['SupplySec7', 'SupplUnSec', 'SupplyCovered'], 'SupplyCovered')},
      CASE T0.DocStatus
        WHEN 'O' THEN 'Open'
        WHEN 'C' THEN 'Closed'
        ELSE T0.DocStatus
      END AS DocumentStatus
    FROM ODLN T0
    LEFT JOIN DLN12 T12 ON T12.DocEntry = T0.DocEntry
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    LEFT JOIN NNM1 NNM ON NNM.ObjectCode = '15' AND NNM.Series = T0.Series
    ${eDocFormatJoinSql}
    LEFT JOIN OHEM EMP ON EMP.empID = ${hasTableField(odlnFieldMetadata, 'OwnerCode') ? 'T0.OwnerCode' : 'NULL'}
    WHERE T0.DocEntry = @docEntry
  `, { docEntry: resolvedDocEntry }));

  if (!headerRows.length) {
    throw new Error(`Delivery ${docEntry} not found`);
  }

  const header = headerRows[0];
  const shipToAddressComponents = buildDocumentAddressComponents(header, 'ShipTo');
  const billToAddressComponents = buildDocumentAddressComponents(header, 'BillTo');

  const attachmentRows = header.AttachmentEntry == null || Number(header.AttachmentEntry) < 0
    ? []
    : await safe(db.query(`
      SELECT Line, TrgtPath, FileName, FileExt, Date, FreeText, CopyToTrgt, Override, SrcPath
      FROM ATC1
      WHERE AbsEntry = @attachmentEntry
      ORDER BY Line
    `, { attachmentEntry: header.AttachmentEntry }));

  const dln1FieldMetadata = await getDeliveryLineFieldMetadata();
  const hasDln1Column = (columnName) => hasTableField(dln1FieldMetadata, columnName);
  const physicalLineColumns = Object.keys(dln1FieldMetadata);
  const lineTaxAmountSelect = selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'VatSum', 'LineTaxAmount');
  const taxCodeExpression = getDocumentTaxCodeSql(dln1FieldMetadata);
  const commissionColumn = resolveColumnName(dln1FieldMetadata, 'CommPercent')
    || resolveColumnName(dln1FieldMetadata, 'Commission');
  const uomEntryColumn = resolveColumnName(dln1FieldMetadata, 'UomEntry');
  const unitMeasureColumn = resolveColumnName(dln1FieldMetadata, 'unitMsr');
  const unitMeasureExpression = unitMeasureColumn
    ? `NULLIF(LTRIM(RTRIM(T0.${quoteSqlIdentifier(unitMeasureColumn)})), '')`
    : 'NULL';
  const uomCodeExpression = uomEntryColumn
    ? `CASE WHEN T0.${quoteSqlIdentifier(uomEntryColumn)} < 0 THEN 'Manual' ELSE COALESCE(UOM.UomCode, ${unitMeasureExpression}, '') END`
    : `COALESCE(${unitMeasureExpression}, '')`;
  const uomNameExpression = uomEntryColumn
    ? `CASE WHEN T0.${quoteSqlIdentifier(uomEntryColumn)} < 0 THEN COALESCE(${unitMeasureExpression}, 'Manual') ELSE COALESCE(UOM.UomName, ${unitMeasureExpression}, UOM.UomCode, '') END`
    : `COALESCE(${unitMeasureExpression}, '')`;
  const uomJoinSql = uomEntryColumn
    ? `LEFT JOIN OUOM UOM ON UOM.UomEntry = T0.${quoteSqlIdentifier(uomEntryColumn)}`
    : '';
  const sacFieldMetadata = await getTableFieldMetadata('OSAC');
  const sacSql = getDeliverySacLookupSqlParts('T0', 'SAC', sacFieldMetadata, dln1FieldMetadata);

  const optionalLineSelects = [
    selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'QtyToShip'),
    selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'OrderedQty'),
    hasDln1Column('OpenQty') ? 'T0.OpenQty AS OpenQuantity' : 'CAST(NULL AS DECIMAL(19, 6)) AS OpenQuantity',
    `${taxCodeExpression} AS TaxCode`,
    lineTaxAmountSelect,
    hasDln1Column('NumPerMsr') ? 'T0.NumPerMsr AS UomFactor' : 'CAST(1 AS DECIMAL(19, 6)) AS UomFactor',
    uomEntryColumn ? `T0.${quoteSqlIdentifier(uomEntryColumn)} AS UoMEntry` : 'NULL AS UoMEntry',
    `${uomCodeExpression} AS UoMCode`,
    `${uomNameExpression} AS UoMName`,
    hasDln1Column('OcrCode') ? 'T0.OcrCode AS DistributionRule' : "'' AS DistributionRule",
    hasDln1Column('OcrCode2') ? 'T0.OcrCode2 AS DistributionRule2' : "'' AS DistributionRule2",
    hasDln1Column('OcrCode3') ? 'T0.OcrCode3 AS DistributionRule3' : "'' AS DistributionRule3",
    hasDln1Column('OcrCode4') ? 'T0.OcrCode4 AS DistributionRule4' : "'' AS DistributionRule4",
    hasDln1Column('OcrCode5') ? 'T0.OcrCode5 AS DistributionRule5' : "'' AS DistributionRule5",
    hasDln1Column('CogsOcrCod') ? 'T0.CogsOcrCod AS COGSDistributionRule' : "'' AS COGSDistributionRule",
    hasDln1Column('CogsOcrCo2') ? 'T0.CogsOcrCo2 AS COGSDistributionRule2' : "'' AS COGSDistributionRule2",
    hasDln1Column('CogsOcrCo3') ? 'T0.CogsOcrCo3 AS COGSDistributionRule3' : "'' AS COGSDistributionRule3",
    hasDln1Column('CogsOcrCo4') ? 'T0.CogsOcrCo4 AS COGSDistributionRule4' : "'' AS COGSDistributionRule4",
    hasDln1Column('CogsOcrCo5') ? 'T0.CogsOcrCo5 AS COGSDistributionRule5' : "'' AS COGSDistributionRule5",
    hasDln1Column('AcctCode') ? 'T0.AcctCode AS GLAccount' : "'' AS GLAccount",
    hasDln1Column('FreeTxt') ? 'T0.FreeTxt AS [FreeText]' : "'' AS [FreeText]",
    hasDln1Column('CountryOrg') ? 'T0.CountryOrg AS CountryOfOrigin' : "'' AS CountryOfOrigin",
    hasDln1Column('HsnEntry') ? 'T0.HsnEntry AS HSNEntry' : 'NULL AS HSNEntry',
    selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'SACEntry'),
    `${sacSql.displayExpression} AS SACCode`,
    `${sacSql.serviceNameExpression} AS SACServiceName`,
    `${sacSql.serviceCodeExpression} AS SACServiceCode`,
    hasDln1Column('LocCode') ? 'T0.LocCode AS Loc' : "'' AS Loc",
    hasDln1Column('ShipDate') ? 'T0.ShipDate AS LineDeliveryDate' : 'NULL AS LineDeliveryDate',
    hasDln1Column('TrnsCode') ? 'T0.TrnsCode AS LineShippingType' : 'NULL AS LineShippingType',
    hasDln1Column('WtLiable') ? 'T0.WtLiable AS WTaxLiable' : "'' AS WTaxLiable",
    hasDln1Column('TaxOnly') ? 'T0.TaxOnly AS TaxLiable' : "'' AS TaxLiable",
    hasDln1Column('AgrNo') ? 'T0.AgrNo AS BlanketAgreementNo' : 'NULL AS BlanketAgreementNo',
    hasDln1Column('AgrLnNum') ? 'T0.AgrLnNum AS BlanketAgreementLine' : 'NULL AS BlanketAgreementLine',
    hasDln1Column('GTotal') ? 'T0.GTotal AS GrossTotal' : 'NULL AS GrossTotal',
    commissionColumn ? `T0.${quoteSqlIdentifier(commissionColumn)} AS CommissionPercent` : 'NULL AS CommissionPercent',
    hasDln1Column('NoInvtryMv') ? 'T0.NoInvtryMv AS WithoutQtyPosting' : "'' AS WithoutQtyPosting",
    hasDln1Column('EnSetCost') ? 'T0.EnSetCost AS EnableSettingCost' : "'' AS EnableSettingCost",
    hasDln1Column('RetCost') ? 'T0.RetCost AS ReturnCost' : 'NULL AS ReturnCost',
    'COALESCE(ITW.OnHand, 0) AS QuantityInWarehouse',
    hasDln1Column('BaseEntry') ? 'T0.BaseEntry' : 'NULL AS BaseEntry',
    hasDln1Column('BaseType') ? 'T0.BaseType' : 'NULL AS BaseType',
    hasDln1Column('BaseLine') ? 'T0.BaseLine' : 'NULL AS BaseLine',
    hasDln1Column('U_Rate') ? 'T0.U_Rate AS DiscountAmount' : 'CAST(NULL AS DECIMAL(19, 6)) AS DiscountAmount',
    hasDln1Column('StockPrice') ? 'T0.StockPrice AS ItemCost' : 'ITM.AvgPrice AS ItemCost',
  ];

  let lineRows = [];
  try {
    const lineQuery = `
      SELECT
        T0.LineNum,
        T0.ItemCode,
        COALESCE(NULLIF(LTRIM(RTRIM(T0.Dscription)), ''), ITM.ItemName, '') AS ItemDescription,
        T0.Quantity,
        COALESCE(T0.PriceBefDi, T0.Price) AS UnitPrice,
        T0.DiscPrcnt AS DiscountPercent,
        T0.LineTotal,
        T0.WhsCode AS Warehouse,
        COALESCE(ITM.OnHand, 0) AS InStock,
        ${optionalLineSelects.join(',\n        ')},
        CHP.ChapterID AS HSNCode,
        ITM.ManBtchNum AS BatchManaged,
        '' AS Branch
      FROM DLN1 T0
      LEFT JOIN OITM ITM ON ITM.ItemCode = T0.ItemCode
      LEFT JOIN OITW ITW ON ITW.ItemCode = T0.ItemCode AND ITW.WhsCode = T0.WhsCode
      LEFT JOIN OCHP CHP ON CHP.AbsEntry = ${hasDln1Column('HsnEntry') ? 'COALESCE(T0.HsnEntry, ITM.ChapterID)' : 'ITM.ChapterID'}
      ${uomJoinSql}
      ${sacSql.joinSql}
      WHERE T0.DocEntry = @docEntry
      ORDER BY T0.LineNum
    `;

    const result = await db.query(lineQuery, { docEntry: resolvedDocEntry });
    lineRows = result.recordset || [];
  } catch (err) {
    console.error(`[DB] getDelivery line query failed for requested identifier ${docEntry} resolved DocEntry ${resolvedDocEntry}:`, err?.message || err);

    lineRows = await safe(db.query(`
      SELECT
        T0.LineNum,
        T0.ItemCode,
        COALESCE(NULLIF(LTRIM(RTRIM(T0.Dscription)), ''), ITM.ItemName, '') AS ItemDescription,
        T0.Quantity,
        ${hasDln1Column('OpenQty') ? 'T0.OpenQty' : 'CAST(NULL AS DECIMAL(19, 6))'} AS OpenQuantity,
        ${selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'QtyToShip')},
        ${selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'OrderedQty')},
        COALESCE(T0.PriceBefDi, T0.Price) AS UnitPrice,
        T0.DiscPrcnt AS DiscountPercent,
        T0.LineTotal,
        T0.WhsCode AS Warehouse,
        COALESCE(ITM.OnHand, 0) AS InStock,
        COALESCE(ITW.OnHand, 0) AS QuantityInWarehouse,
        ${hasDln1Column('NumPerMsr') ? 'T0.NumPerMsr' : 'CAST(1 AS DECIMAL(19, 6))'} AS UomFactor,
        ${uomEntryColumn ? `T0.${quoteSqlIdentifier(uomEntryColumn)}` : 'NULL'} AS UoMEntry,
        ${uomCodeExpression} AS UoMCode,
        ${uomNameExpression} AS UoMName,
        CAST(NULL AS DECIMAL(19, 6)) AS DiscountAmount,
        ${taxCodeExpression} AS TaxCode,
        ${lineTaxAmountSelect},
        '' AS DistributionRule,
        '' AS [FreeText],
        '' AS CountryOfOrigin,
        CHP.ChapterID AS HSNCode,
        -- This is the schema-safe fallback after the rich query above fails.
        -- Do not use SAC metadata here: older SAP B1 company schemas can have
        -- OSAC or OITM SAC data while DLN1 itself has no SACEntry column.
        NULL AS SACEntry,
        '' AS SACCode,
        '' AS SACServiceName,
        '' AS SACServiceCode,
        ITM.ManBtchNum AS BatchManaged,
        ITM.AvgPrice AS ItemCost,
        ${selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'BaseEntry')},
        ${selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'BaseType')},
        ${selectPhysicalOptionalColumn(physicalLineColumns, 'T0', 'BaseLine')},
        '' AS Branch,
        '' AS Loc
      FROM DLN1 T0
      LEFT JOIN OITM ITM ON ITM.ItemCode = T0.ItemCode
      LEFT JOIN OITW ITW ON ITW.ItemCode = T0.ItemCode AND ITW.WhsCode = T0.WhsCode
      LEFT JOIN OCHP CHP ON CHP.AbsEntry = ITM.ChapterID
      ${uomJoinSql}
      WHERE T0.DocEntry = @docEntry
      ORDER BY T0.LineNum
    `, { docEntry: resolvedDocEntry }));
  }

  console.log(`[DB] getDelivery - requested identifier: ${docEntry}, resolved DocEntry: ${resolvedDocEntry}, Line rows found: ${lineRows.length}`);
  if (!lineRows.length) throw new Error('Delivery content lines could not be loaded. Retry or contact an administrator.');
  if (lineRows.length > 0) {
    console.log('[DB] getDelivery - First line:', lineRows[0]);
  } else {
    console.warn(`[DB] getDelivery - No lines found for requested identifier ${docEntry} resolved DocEntry ${resolvedDocEntry}`);
  }

  // Ordered Qty on a Delivery copied from a Sales Order belongs to the
  // source RDR1 row. DLN1.OpenQty is the Delivery's own remaining quantity.
  const orderSources = hasDln1Column('BaseType') && hasDln1Column('BaseEntry') && hasDln1Column('BaseLine')
    ? lineRows.filter((line) => Number(line.BaseType) === 17
      && line.BaseEntry != null && line.BaseLine != null)
    : [];
  const orderedQtyBySource = new Map();
  if (orderSources.length) {
    const uniqueSources = [...new Map(orderSources.map((line) => [
      `${line.BaseEntry}:${line.BaseLine}`, line,
    ])).values()];
    const sourceParams = {};
    const sourcePredicates = uniqueSources.map((line, index) => {
      sourceParams[`baseEntry${index}`] = line.BaseEntry;
      sourceParams[`baseLine${index}`] = line.BaseLine;
      return `(DocEntry = @baseEntry${index} AND LineNum = @baseLine${index})`;
    });
    const sourceRows = await safe(db.query(`
      SELECT DocEntry, LineNum, Quantity
      FROM RDR1
      WHERE ${sourcePredicates.join(' OR ')}
    `, sourceParams));
    sourceRows.forEach((row) => orderedQtyBySource.set(`${row.DocEntry}:${row.LineNum}`, row.Quantity));
  }

  const itemCodes = lineRows.map(l => l.ItemCode).filter(Boolean);
  let itemInfoMap = {};
  
  if (itemCodes.length > 0) {
    try {
      const itemRows = await safe(db.query(`
        SELECT T0.ItemCode, CHP.ChapterID AS HSNCode, T0.ManBtchNum AS BatchManaged
        FROM OITM T0
        LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
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
      // Could not fetch item info
    }
  }

  let [headerUdfs, dynamicLineUdfs, referenceDocuments] = await Promise.all([
    getHeaderUdfValues({ tableId: 'ODLN', keyValue: resolvedDocEntry }),
    getLineUdfValues({ tableId: 'DLN1', keyValue: resolvedDocEntry }),
    getDeliveryReferenceDocuments(resolvedDocEntry),
  ]);

  let lineUdfs = {};
  try {
    const deliveryLineUdfColumns = [
      'U_SPLRBT',
      'U_COMPRC',
      'U_S_BrokPerQty',
      'U_Unit_Price',
      'U_Brok_Seller',
      'U_Brok_Buyer',
      'U_Buyer_Delivery',
      'U_Seller_Delivery',
      'U_Buyer_Payment_Terms',
      'U_Seller_Payment_Terms',
      'U_Buyer_Quality',
      'U_Seller_Quality',
      'U_Buyer_Price',
      'U_Seller_Price',
      'U_Buyer_SPINS',
      'U_Seller_SPINS',
      'U_Sel_Brok_AP',
      'U_Seller_Brok_Per',
      'U_Buyer_Bill_Disc',
      'U_Seller_Bill_Disc',
      'U_SELLTCODE',
      'U_S_Item',
      'U_S_Qty',
      'U_Freight_pur',
      'U_Freight_sales',
      'U_Fr_trans',
      'U_Fr_trans_name',
      'U_BDNum',
      'U_PackingType',
      'U_GrossWt',
      'U_TotalPackage',
    ].filter(hasDln1Column);

    const udfLineRows = deliveryLineUdfColumns.length
      ? await db.query(`
        SELECT
          LineNum,
          ${deliveryLineUdfColumns.map(quoteSqlIdentifier).join(',\n          ')}
        FROM DLN1
        WHERE DocEntry = @docEntry
      `, { docEntry: resolvedDocEntry })
      : { recordset: [] };

    if (udfLineRows.recordset) {
      udfLineRows.recordset.forEach((row) => {
        const { LineNum, ...values } = row;
        lineUdfs[LineNum] = values;
      });
    }
  } catch (err) {
    lineUdfs = {};
  }

  // Fetch batch allocations for this delivery
  let batchRows = await safe(db.query(`
    SELECT BaseLinNum AS BaseLineNum, BatchNum, ABS(Quantity) AS Quantity
    FROM   IBT1
    WHERE  BaseEntry = @docEntry
      AND  BaseType = 15
    ORDER  BY BaseLinNum, BatchNum
  `, { docEntry: resolvedDocEntry }));

  const batchesByLine = {};
  batchRows.forEach(b => {
    if (!batchesByLine[b.BaseLineNum]) {
      batchesByLine[b.BaseLineNum] = [];
    }
    batchesByLine[b.BaseLineNum].push({
      batchNumber: b.BatchNum || '',
      quantity: String(b.Quantity || 0),
      expiryDate: b.ExpiryDate instanceof Date
        ? b.ExpiryDate.toISOString().slice(0, 10)
        : (b.ExpiryDate || ''),
    });
  });

  // Keep the saved E-Way Bill read limited to DLN26. Optional master-data
  // joins vary between SAP B1 patch levels; a failed join must not hide the
  // document's entered E-Way Bill values in Find mode.
  const eWayBillRows = await safe(db.query(`
    SELECT TOP 1 T0.*
    FROM DLN26 T0
    WHERE T0.DocEntry = @docEntry
  `, { docEntry: resolvedDocEntry }));

  const savedEWayBill = eWayBillRows[0];
  if (savedEWayBill) {
    savedEWayBill.MainHSNEntry = savedEWayBill.MainHSNEntry ?? savedEWayBill.MainHsnEnt;
    const masterLabel = (row, preferredKeys, rawValue) => {
      const entries = Object.entries(row || {}).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
      const preferred = entries.find(([key]) => preferredKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase()));
      return String(preferred?.[1] ?? [...entries].reverse().find(([, value]) => String(value) !== String(rawValue))?.[1] ?? '');
    };
    const hsnRows = savedEWayBill.MainHSNEntry == null ? [] : await safe(db.query(`
      SELECT TOP 1 ChapterID AS MainHSN
      FROM OCHP
      WHERE AbsEntry = @entry
    `, { entry: savedEWayBill.MainHSNEntry }));

    const transporterRows = savedEWayBill.TspEntry == null ? [] : await safe(db.query(`
      SELECT TOP 1 TransCode AS TransporterCode
      FROM OTSP
      WHERE AbsEntry = @entry
    `, { entry: savedEWayBill.TspEntry }));

    const subTypeRows = savedEWayBill.SubSplyTyp == null ? [] : await safe(db.query(`
      SELECT TOP 1 * FROM OEST WHERE AbsEntry = @entry
    `, { entry: savedEWayBill.SubSplyTyp }));
    const documentTypeRows = !savedEWayBill.DocType ? [] : await safe(db.query(`
      SELECT TOP 1 * FROM OEDT WHERE TypeCode = @code
    `, { code: savedEWayBill.DocType }));
    const modeRows = savedEWayBill.TransMode == null ? [] : await safe(db.query(`
      SELECT TOP 1 * FROM OETM WHERE ModeCode = @entry
    `, { entry: savedEWayBill.TransMode }));
    const vehicleTypeRows = !savedEWayBill.VehicleTyp ? [] : await safe(db.query(`
      SELECT TOP 1 * FROM OEVT WHERE TypeCode = @code
    `, { code: savedEWayBill.VehicleTyp }));

    const resolveStateName = async (code) => {
      if (!code) return '';
      const rows = await safe(db.query(`
        SELECT TOP 1 Name
        FROM OCST
        WHERE Country = 'IN' AND Code = @code
      `, { code }));
      return rows[0]?.Name || '';
    };

    savedEWayBill.MainHSN = hsnRows[0]?.MainHSN || '';
    savedEWayBill.TransporterCode = transporterRows[0]?.TransporterCode || '';
    savedEWayBill.SubSupplyTypeLabel = masterLabel(subTypeRows[0], ['SubName', 'SubTypeName', 'Name', 'Descr'], savedEWayBill.SubSplyTyp);
    savedEWayBill.DocumentTypeLabel = masterLabel(documentTypeRows[0], ['TypeName', 'DocTypeName', 'Name', 'Descr'], savedEWayBill.DocType);
    savedEWayBill.ModeLabel = masterLabel(modeRows[0], ['ModeName', 'TransModeName', 'Name', 'Descr'], savedEWayBill.TransMode);
    savedEWayBill.VehicleTypeLabel = masterLabel(vehicleTypeRows[0], ['TypeName', 'VehicleName', 'Name', 'Descr'], savedEWayBill.VehicleTyp);
    savedEWayBill.FrmStateName = await resolveStateName(savedEWayBill.FrmState);
    savedEWayBill.ToStateName = await resolveStateName(savedEWayBill.ToState);
    savedEWayBill.ActFrmStateName = await resolveStateName(savedEWayBill.ActFrmStat);
    savedEWayBill.ActToStateName = await resolveStateName(savedEWayBill.ActToState);
  }

  // Newer SAP B1 patch levels may expose the allocation through OITL/ITL1
  // while the legacy IBT1 compatibility view returns no rows.
  if (!batchRows.length) {
    batchRows = await safe(db.query(`
      SELECT
        T0.DocLine AS BaseLineNum,
        T2.DistNumber AS BatchNum,
        ABS(T1.Quantity) AS Quantity,
        T2.ExpDate AS ExpiryDate
      FROM OITL T0
      INNER JOIN ITL1 T1 ON T1.LogEntry = T0.LogEntry
      INNER JOIN OBTN T2
        ON T2.ItemCode = T1.ItemCode
       AND T2.SysNumber = T1.SysNumber
      WHERE T0.DocEntry = @docEntry
        AND T0.DocType = 15
        AND T1.Quantity <> 0
      ORDER BY T0.DocLine, T2.DistNumber
    `, { docEntry: resolvedDocEntry }));
  }
  const eWayBill = eWayBillRows[0] || {};

  return {
    delivery: {
      doc_entry: header.DocEntry,
      doc_num: header.DocNum,
      header: {
        customer: header.CardCode,
        customerCode: header.CardCode, // Add alias for consistency
        name: header.CardName,
        customerName: header.CardName, // Add alias for consistency
        contactPerson: header.ContactPersonCode ? String(header.ContactPersonCode) : '',
        salesContractNo: header.CustomerRefNo || '',
        branch: header.Branch ? String(header.Branch) : '',
        warehouse: lineRows.length > 0 && lineRows[0].Warehouse ? String(lineRows[0].Warehouse) : '', // Get warehouse from first line (empty if no lines)
        docNo: header.DocNum ? String(header.DocNum) : '',
        status: resolveDocumentConfirmationStatus(header.DocumentStatus || 'Open', header.Confirmed),
        series: header.Series ? String(header.Series) : '',
        seriesName: header.SeriesName || '',
        seriesIndicator: header.SeriesIndicator || '',
        shipToCode: header.ShipToCode || '',
        payToCode: header.PayToCode || '',
        shipTo: header.Address2 || '',
        shipToAddress: header.Address2 || '',
        shipToAddressComponents,
        payTo: header.Address || '',
        billToAddress: header.Address || '',
        billToAddressComponents,
        billToCode: header.PayToCode || '',
        postingDate: header.PostingDate ? header.PostingDate.toISOString().split('T')[0] : '',
        deliveryDate: header.DeliveryDate ? header.DeliveryDate.toISOString().split('T')[0] : '',
        documentDate: header.DocumentDate ? header.DocumentDate.toISOString().split('T')[0] : '',
        documentCreated: header.DocumentCreated ? header.DocumentCreated.toISOString().split('T')[0] : '',
        journalRemark: header.JournalRemark || '',
        paymentTerms: header.PaymentTerms ? String(header.PaymentTerms) : '',
        currency: header.Currency || '',
        exchangeRate: header.ExchangeRate != null ? String(header.ExchangeRate) : '',
        paymentTermsCode: header.PaymentTerms ? String(header.PaymentTerms) : '', // Add alias
        shippingType: header.ShippingType ? String(header.ShippingType) : '',
        confirmed: String(header.Confirmed || '').toUpperCase() === 'Y',
        languageCode: header.LanguageCode != null ? String(header.LanguageCode) : '',
        trackingNo: header.TrackingNo || '',
        stampNo: header.StampNo || '',
        pickAndPackRemarks: header.PickAndPackRemarks || '',
        bpChannelCode: header.BPChannelCode || '',
        bpChannelContact: header.BPChannelContact != null ? String(header.BPChannelContact) : '',
        salesEmployee: header.SalesEmployeeCode != null ? String(header.SalesEmployeeCode) : '',
        purchaser: header.SalesEmployeeName || '',
        otherInstruction: header.Remarks || '',
        discount: header.DiscountPercent != null ? String(header.DiscountPercent) : '',
        freight: header.Freight != null ? String(header.Freight) : '',
        rounding: Math.abs(Number(header.RoundingAmount || 0)) > 0,
        roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
        tax: header.Tax != null ? String(header.Tax) : '',
        totalPaymentDue: header.TotalPaymentDue != null ? String(header.TotalPaymentDue) : '',
        edocGenerationType: normalizeEDocGenerationType(header.EDocGenerationType),
        edocExportFormat: header.EDocExportFormat != null ? String(header.EDocExportFormat) : '',
        edocStatus: normalizeEDocStatus(header.EDocStatus),
        genericEdocGenerationType: normalizeEDocGenerationType(header.EDocGenerationType),
        genericEdocExportFormat: header.EDocExportFormat != null ? String(header.EDocExportFormat) : '',
        genericEdocStatus: normalizeEDocStatus(header.EDocStatus),
        paymentMethod: header.PaymentMethod || '',
        centralBankIndicator: header.CentralBankIndicator || '',
        projectCode: header.ProjectCode || '',
        qrCodeSource: header.QRCodeSource || '',
        indicator: header.Indicator || '',
        orderNumber: header.OrderNumber || '',
        ownerCode: header.OwnerCode != null ? String(header.OwnerCode) : '',
        owner: header.OwnerName || '',
        consolidationType: header.ConsolidationType || '',
        consolidatingBP: header.ConsolidatingBP || '',
        useShippedGoodsAccount: ['Y', 'YES', '1', 'TRUE'].includes(String(header.UseShippedGoods || '').toUpperCase()),
        transactionCategory: header.TransactionCategory || '',
        taxFormNo: header.TaxFormNo || '',
        dutyStatus: header.DutyStatus || '',
        exportFlag: ['Y', 'YES', '1', 'TRUE'].includes(String(header.ExportFlag || '').toUpperCase()),
        differentialTaxRate: header.DifferentialTaxRate != null ? String(header.DifferentialTaxRate) : '100',
        supplyCovered: ['Y', 'YES', '1', 'TRUE'].includes(String(header.SupplyCovered || '').toUpperCase()),
      },
      lines: lineRows.map((l) => {
        const itemInfo = itemInfoMap[l.ItemCode] || { hsnCode: '', batchManaged: false };
        const lineUdf = {
          ...(dynamicLineUdfs[l.LineNum] || {}),
          ...(lineUdfs[l.LineNum] || {}),
        };
        const packingType = formatUdfValue(getUdfAliasValue(lineUdf, ['U_PackingType', 'U_Packing_Type']));
        const grossWt = formatUdfValue(getUdfAliasValue(lineUdf, ['U_GrossWt', 'U_Gross_Wt']));
        const totalPackage = formatUdfValue(getUdfAliasValue(lineUdf, ['U_TotalPackage', 'U_Total_Package']));
        const discountAmount = lineUdf.U_Rate ?? l.DiscountAmount;
        const discountPercent = getLineDiscountPercent(discountAmount, l.UnitPrice, l.DiscountPercent);
        return {
          lineNum: l.LineNum != null ? Number(l.LineNum) : undefined,
          baseEntry: l.BaseEntry || null,
          baseType: l.BaseType || null,
          baseLine: l.BaseLine || null,
          itemNo: l.ItemCode || '',
          itemDescription: l.ItemDescription || '',
          hsnCode: l.HSNCode || (l.HSNEntry != null ? String(l.HSNEntry) : '') || itemInfo.hsnCode || '',
          quantity: l.Quantity != null ? String(l.Quantity) : '',
          qtyToShip: l.QtyToShip != null ? String(l.QtyToShip) : '',
          orderedQty: l.OrderedQty != null ? String(l.OrderedQty)
            : orderedQtyBySource.has(`${l.BaseEntry}:${l.BaseLine}`)
              ? String(orderedQtyBySource.get(`${l.BaseEntry}:${l.BaseLine}`)) : '',
          openQty: l.OpenQuantity != null ? String(l.OpenQuantity) : '',
          unitPrice: l.UnitPrice != null ? String(l.UnitPrice) : '',
          uomName: l.UoMName || l.UoMCode || '',
          inStock: l.InStock != null ? String(l.InStock) : '',
          qtyInWhse: l.QuantityInWarehouse != null ? String(l.QuantityInWarehouse) : '',
          price: l.UnitPrice != null ? String(l.UnitPrice) : '',
          priceAfterDiscount: discountPercent != null && l.UnitPrice != null
            ? String(Number(l.UnitPrice || 0) * (1 - (Number(discountPercent || 0) / 100)))
            : '',
          itemCost: l.ItemCost != null ? String(l.ItemCost) : '',
          binLocationAllocation: '',
          discountAmount: discountAmount != null && String(discountAmount).trim() !== '' ? String(discountAmount) : '',
          unitPriceUdf: lineUdf.U_Unit_Price != null && lineUdf.U_Unit_Price !== '' ? String(lineUdf.U_Unit_Price) : '',
          sellerQuality: lineUdf.U_Seller_Quality || '',
          buyerQuality: lineUdf.U_Buyer_Quality || '',
          sellerPrice: lineUdf.U_Seller_Price || l.SellerPrice || '',
          buyerPrice: lineUdf.U_Buyer_Price || l.BuyerPrice || '',
          sellerDelivery: lineUdf.U_Seller_Delivery || l.SellerDelivery || '',
          buyerDelivery: lineUdf.U_Buyer_Delivery || l.BuyerDelivery || '',
          sellerBrokerageAmtPer: lineUdf.U_Sel_Brok_AP || l.SellerBrokerageAmtPer || '',
          sellerBrokeragePercent: lineUdf.U_Seller_Brok_Per != null ? String(lineUdf.U_Seller_Brok_Per) : (l.SellerBrokeragePercent != null ? String(l.SellerBrokeragePercent) : ''),
          sellerBrokerage: lineUdf.U_Brok_Seller != null ? String(lineUdf.U_Brok_Seller) : (l.SellerBrokerage != null ? String(l.SellerBrokerage) : ''),
          buyerBrokerage: lineUdf.U_Brok_Buyer != null ? String(lineUdf.U_Brok_Buyer) : (l.BuyerBrokerage != null ? String(l.BuyerBrokerage) : ''),
          stcode: lineUdf.U_SELLTCODE || '',
          specialRebate: lineUdf.U_SPLRBT != null ? String(lineUdf.U_SPLRBT) : '',
          commission: lineUdf.U_COMPRC != null ? String(lineUdf.U_COMPRC) : '',
          sellerBrokeragePerQty: lineUdf.U_S_BrokPerQty != null ? String(lineUdf.U_S_BrokPerQty) : '',
          buyerPaymentTerms: lineUdf.U_Buyer_Payment_Terms || '',
          sellerPaymentTerms: lineUdf.U_Seller_Payment_Terms || '',
          buyerSpecialInstruction: lineUdf.U_Buyer_SPINS || '',
          sellerSpecialInstruction: lineUdf.U_Seller_SPINS || '',
          buyerBillDiscount: lineUdf.U_Buyer_Bill_Disc != null ? String(lineUdf.U_Buyer_Bill_Disc) : '',
          sellerBillDiscount: lineUdf.U_Seller_Bill_Disc != null ? String(lineUdf.U_Seller_Bill_Disc) : '',
          sellerItem: lineUdf.U_S_Item || '',
          sellerQty: lineUdf.U_S_Qty != null ? String(lineUdf.U_S_Qty) : (l.SellerQty != null ? String(l.SellerQty) : ''),
          freightPurchase: lineUdf.U_Freight_pur != null ? String(lineUdf.U_Freight_pur) : '',
          freightSales: lineUdf.U_Freight_sales != null ? String(lineUdf.U_Freight_sales) : '',
          freightProvider: lineUdf.U_Fr_trans || '',
          freightProviderName: lineUdf.U_Fr_trans_name || '',
          brokerageNumber: lineUdf.U_BDNum || '',
          packingType,
          grossWt,
          totalPackage,
          U_PackingType: packingType,
          U_GrossWt: grossWt,
          U_TotalPackage: totalPackage,
          stdDiscount: discountPercent != null ? String(discountPercent) : '',
          taxCode: l.TaxCode || '',
          taxAmount: l.LineTaxAmount != null ? String(l.LineTaxAmount) : '',
          total: l.LineTotal != null ? String(l.LineTotal) : '',
          whse: l.Warehouse || '',
          uomCode: l.UoMCode || '',
          uomEntry: l.UoMEntry != null ? Number(l.UoMEntry) : null,
          uomFactor: l.UomFactor != null && l.UomFactor !== '' ? Number(l.UomFactor) : 1,
          distRule: l.DistributionRule || '',
          distRule2: l.DistributionRule2 || '',
          distRule3: l.DistributionRule3 || '',
          distRule4: l.DistributionRule4 || '',
          distRule5: l.DistributionRule5 || '',
          cogsDistRule: l.COGSDistributionRule || '',
          cogsDistRule2: l.COGSDistributionRule2 || '',
          cogsDistRule3: l.COGSDistributionRule3 || '',
          cogsDistRule4: l.COGSDistributionRule4 || '',
          cogsDistRule5: l.COGSDistributionRule5 || '',
          glAccount: l.GLAccount || '',
          freeText: l.FreeText || '',
          countryOfOrigin: l.CountryOfOrigin || '',
          sacCode: l.SACCode || l.SACServiceName || l.SACServiceCode || (l.SACEntry != null ? String(l.SACEntry) : ''),
          sacEntry: l.SACEntry != null ? String(l.SACEntry) : '',
          sacServiceName: l.SACServiceName || '',
          sacServiceCode: l.SACServiceCode || '',
          blanketAgreementNo: l.BlanketAgreementNo != null ? String(l.BlanketAgreementNo) : '',
          blanketAgreementLine: l.BlanketAgreementLine != null ? String(l.BlanketAgreementLine) : '',
          commPercent: l.CommissionPercent != null ? String(l.CommissionPercent) : '',
          grossTotal: l.GrossTotal != null ? String(l.GrossTotal) : '',
          lineShippingType: l.LineShippingType != null ? String(l.LineShippingType) : '',
          lineDeliveryDate: l.LineDeliveryDate instanceof Date
            ? l.LineDeliveryDate.toISOString().split('T')[0]
            : (l.LineDeliveryDate || ''),
          wTaxLiable: l.WTaxLiable || '',
          taxLiable: l.TaxLiable || '',
          withoutQtyPosting: l.WithoutQtyPosting || '',
          enableSettingCost: l.EnableSettingCost || '',
          returnCost: l.ReturnCost != null ? String(l.ReturnCost) : '',
          deliveredQty: l.Quantity != null && l.OpenQuantity != null ? String(Number(l.Quantity || 0) - Number(l.OpenQuantity || 0)) : '',
          documentCreated: header.DocumentCreated ? header.DocumentCreated.toISOString().split('T')[0] : '',
          branch: l.Branch ? String(l.Branch) : (header.Branch != null ? String(header.Branch) : ''),
          loc: l.Loc != null && l.Loc !== '' ? String(l.Loc) : '',
          batchManaged: String(l.BatchManaged || '').toUpperCase() === 'Y' || itemInfo.batchManaged,
          batches: batchesByLine[l.LineNum] || [],
          udf: {
            ...lineUdf,
            U_SPLRBT: lineUdf.U_SPLRBT ?? '',
            U_COMPRC: lineUdf.U_COMPRC ?? '',
            U_S_BrokPerQty: lineUdf.U_S_BrokPerQty ?? '',
            U_Unit_Price: lineUdf.U_Unit_Price ?? '',
            U_Rate: lineUdf.U_Rate ?? discountAmount ?? '',
            U_Brok_Seller: lineUdf.U_Brok_Seller ?? '',
            U_Brok_Buyer: lineUdf.U_Brok_Buyer ?? '',
            U_Buyer_Delivery: lineUdf.U_Buyer_Delivery || '',
            U_Seller_Delivery: lineUdf.U_Seller_Delivery || '',
            U_Buyer_Payment_Terms: lineUdf.U_Buyer_Payment_Terms || '',
            U_Seller_Payment_Terms: lineUdf.U_Seller_Payment_Terms || '',
            U_Buyer_Quality: lineUdf.U_Buyer_Quality || '',
            U_Seller_Quality: lineUdf.U_Seller_Quality || '',
            U_Buyer_Price: lineUdf.U_Buyer_Price || '',
            U_Seller_Price: lineUdf.U_Seller_Price || '',
            U_Buyer_SPINS: lineUdf.U_Buyer_SPINS || '',
            U_Seller_SPINS: lineUdf.U_Seller_SPINS || '',
            U_Sel_Brok_AP: lineUdf.U_Sel_Brok_AP || '',
            U_Seller_Brok_Per: lineUdf.U_Seller_Brok_Per ?? '',
            U_Buyer_Bill_Disc: lineUdf.U_Buyer_Bill_Disc ?? '',
            U_Seller_Bill_Disc: lineUdf.U_Seller_Bill_Disc ?? '',
            U_SELLTCODE: lineUdf.U_SELLTCODE || '',
            U_S_Item: lineUdf.U_S_Item || '',
            U_S_Qty: lineUdf.U_S_Qty ?? '',
            U_Freight_pur: lineUdf.U_Freight_pur ?? '',
            U_Freight_sales: lineUdf.U_Freight_sales ?? '',
            U_Fr_trans: lineUdf.U_Fr_trans || '',
            U_Fr_trans_name: lineUdf.U_Fr_trans_name || '',
            U_BDNum: lineUdf.U_BDNum || '',
            U_PackingType: packingType,
            U_GrossWt: grossWt,
            U_TotalPackage: totalPackage,
          },
        };
      }),
      header_udfs: headerUdfs,
      reference_documents: referenceDocuments,
      attachments: attachmentRows.map((row, index) => ({
        id: Number(row.Line ?? index) + 1,
        targetPath: row.TrgtPath || row.SrcPath || '',
        fileName: [row.FileName, row.FileExt].filter(Boolean).join('.'),
        attachmentDate: row.Date instanceof Date ? row.Date.toISOString().slice(0, 10) : (row.Date || ''),
        freeText: row.FreeText || '',
        copyToTargetDocument: String(row.CopyToTrgt || '').toUpperCase() === 'Y' ? 'Yes' : 'No',
        documentType: '',
        atchDocDate: '',
        alert: String(row.Override || '').toUpperCase() === 'Y' ? 'Yes' : 'No',
      })),
      eway_bill_details: eWayBillRows.length ? {
        supplyType: eWayBill.SuplyType === 'I' ? 'Inward' : 'Outward',
        subSupplyType: eWayBill.SubSplyTyp != null ? String(eWayBill.SubSplyTyp) : '',
        subSupplyTypeLabel: eWayBill.SubSupplyTypeLabel || '',
        documentType: eWayBill.DocType || '',
        documentTypeLabel: eWayBill.DocumentTypeLabel || '',
        transactionType: eWayBill.TransType != null ? String(eWayBill.TransType) : '',
        mainHSN: eWayBill.MainHSN || '',
        mainHSNEntry: eWayBill.MainHSNEntry != null ? String(eWayBill.MainHSNEntry) : '',
        ewayBillNo: eWayBill.EWayBillNo || '',
        ewayBillDate: eWayBill.EwbDate instanceof Date ? eWayBill.EwbDate.toISOString().slice(0, 10) : (eWayBill.EwbDate || ''),
        expirationDate: eWayBill.ExpireDate instanceof Date ? eWayBill.ExpireDate.toISOString().slice(0, 10) : (eWayBill.ExpireDate || ''),
        transporterName: eWayBill.TransName || '',
        transporterEntry: eWayBill.TspEntry != null ? String(eWayBill.TspEntry) : '',
        transporterCode: eWayBill.TransporterCode || '',
        transporterId: eWayBill.TransID || '',
        mode: eWayBill.TransMode != null ? String(eWayBill.TransMode) : '',
        modeLabel: eWayBill.ModeLabel || '',
        vehicleType: eWayBill.VehicleTyp || '',
        vehicleTypeLabel: eWayBill.VehicleTypeLabel || '',
        vehicleNo: eWayBill.VehicleNo || '',
        distanceInKM: eWayBill.Distance != null ? String(eWayBill.Distance) : '',
        transporterDocNo: eWayBill.TransDocNo || '',
        transporterDocDate: eWayBill.TransDate instanceof Date ? eWayBill.TransDate.toISOString().slice(0, 10) : (eWayBill.TransDate || ''),
        billFromName: eWayBill.FrmTraName || '',
        billFromGSTIN: eWayBill.FrmGSTN || '',
        billFromState: eWayBill.FrmStateName || eWayBill.FrmState || '',
        dispatchFromAddress: [eWayBill.FrmAddres1, eWayBill.FrmAddres2].filter(Boolean).join(' '),
        dispatchFromPlace: eWayBill.FrmPlace || '',
        dispatchFromZipCode: eWayBill.FrmZipCode || '',
        dispatchFromState: eWayBill.ActFrmStateName || eWayBill.ActFrmStat || '',
        billToName: eWayBill.ToTraName || '',
        billToGSTIN: eWayBill.ToGSTN || '',
        billToState: eWayBill.ToStateName || eWayBill.ToState || '',
        shipToAddress: [eWayBill.ToAddres1, eWayBill.ToAddres2].filter(Boolean).join(' '),
        shipToPlace: eWayBill.ToPlace || '',
        shipToZipCode: eWayBill.ToZipCode || '',
        shipToState: eWayBill.ActToStateName || eWayBill.ActToState || '',
      } : {},
    }
  };
};

const getSavedDeliveryQuantities = async (docEntry) => {
  const lineRows = await safe(db.query(`
    SELECT
      T0.LineNum,
      T0.ItemCode,
      T0.Dscription AS ItemDescription,
      T0.Quantity,
      T0.OpenQty,
      T0.unitMsr AS UoMCode,
      T0.WhsCode AS Warehouse
    FROM DLN1 T0
    WHERE T0.DocEntry = @docEntry
    ORDER BY T0.LineNum
  `, { docEntry }));

  const batchRows = await safe(db.query(`
    SELECT
      T0.BaseLinNum AS LineNum,
      SUM(T0.Quantity) AS BatchQuantity
    FROM IBT1 T0
    WHERE T0.BaseEntry = @docEntry
      AND T0.BaseType = 15
    GROUP BY T0.BaseLinNum
  `, { docEntry }));

  const batchQtyByLine = batchRows.reduce((acc, row) => {
    acc[row.LineNum] = Number(row.BatchQuantity || 0);
    return acc;
  }, {});

  return lineRows.map((row) => ({
    lineNum: Number(row.LineNum || 0),
    itemCode: row.ItemCode || '',
    itemDescription: row.ItemDescription || '',
    quantity: Number(row.Quantity || 0),
    openQty: Number(row.OpenQty || 0),
    uomCode: row.UoMCode || '',
    warehouse: row.Warehouse || '',
    batchQuantity: Number(batchQtyByLine[row.LineNum] || 0),
  }));
};

// ── DOCUMENT SERIES ───────────────────────────────────────────────────────────

const getDocumentSeries = async (targetDate = null, { branch = '' } = {}) => {
  return {
    series: await getMarketingDocumentSeries({
      db,
      objectCode: '15',
      targetDate,
      branch,
      collapseToSapVisible: true,
    }),
  };
};

const getAvailableSerials = async (itemCode, whsCode) => ({
  serials: await safe(db.query(`
    SELECT
      T0.SysNumber AS SystemSerialNumber,
      T0.DistNumber AS SerialNumber,
      T0.MnfSerial AS ManufacturerSerialNumber,
      T1.WhsCode,
      T1.Quantity AS AvailableQty
    FROM OSRN T0
    INNER JOIN OSRQ T1
      ON T1.ItemCode = T0.ItemCode
      AND T1.SysNumber = T0.SysNumber
    WHERE T0.ItemCode = @ItemCode
      AND T1.WhsCode = @WhsCode
      AND T1.Quantity > 0
    ORDER BY T0.DistNumber
  `, { ItemCode: itemCode, WhsCode: whsCode })),
});

const getAvailableBins = async (itemCode, whsCode) => ({
  bins: await safe(db.query(`
    SELECT
      T0.AbsEntry AS BinAbsEntry,
      T0.BinCode,
      T0.WhsCode,
      COALESCE(T1.OnHandQty, 0) AS AvailableQty
    FROM OBIN T0
    LEFT JOIN OIBQ T1
      ON T1.BinAbs = T0.AbsEntry
      AND T1.ItemCode = @ItemCode
    WHERE T0.WhsCode = @WhsCode
      AND COALESCE(T0.Disabled, 'N') <> 'Y'
    ORDER BY T0.BinCode
  `, { ItemCode: itemCode, WhsCode: whsCode })),
});

const getNextNumber = async (series, { targetDate = null, branch = '' } = {}) => {
  const validSeries = await getMarketingDocumentSeries({
    db,
    objectCode: '15',
    targetDate,
    branch,
    collapseToSapVisible: false,
  });
  const selected = validSeries.find((row) => String(row.Series) === String(series));
  if (!selected) return { nextNumber: null };

  const usedRows = await safe(db.query(`
    SELECT MAX(DocNum) AS LastDocumentNumber
    FROM ODLN
    WHERE Series = @series
  `, { series }));
  const configuredNext = Number(selected.NextNumber);
  const lastDocumentNumber = Number(usedRows[0]?.LastDocumentNumber);
  const nextNumber = Math.max(
    Number.isFinite(configuredNext) ? configuredNext : 0,
    Number.isFinite(lastDocumentNumber) ? lastDocumentNumber + 1 : 0,
  );
  return { nextNumber: nextNumber || null };
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

const loadReferenceDataUncached = async () => {
  const [
    customers,
    items,
    warehouses,
    locations,
    paymentTerms,
    paymentMethods,
    shippingTypes,
    salesEmployees,
    branches,
    distributionRules,
    states,
    taxCodes,
    uomGroupsRaw,
    decimalRows,
    companyRows,
    buyerQualityOptions,
    sellerQualityOptions,
    buyerPriceOptions,
    sellerPriceOptions,
    udfMetadata,
    eWayBillFormats,
    genericEDocFormats,
    eWayBillTransporters,
    eWayBillDropdownOptions,
  ] = await Promise.all([
    getCustomers(),
    getItems(),
    getWarehouses(),
    getLocations(),
    getPaymentTerms(),
    getPaymentMethods(),
    getShippingTypes(),
    getSalesEmployees(),
    getBranches(),
    getDistributionRules(),
    getStates(),
    getTaxCodes(),
    getUomGroups(),
    getDecimalSettings(),
    getCompanyInfo(),
    getLookupValues('U_Buyer_Quality'),
    getLookupValues('U_Seller_Quality'),
    getLookupValues('U_Buyer_Price'),
    getLookupValues('U_Seller_Price'),
    getMarketingDocumentUdfs({ headerTable: 'ODLN', lineTable: 'DLN1' }),
    getEWayBillFormats(),
    getGenericEDocFormats(),
    getEWayBillTransporters(),
    getEWayBillDropdownOptions(),
  ]);
  const lineFieldMetadata = await buildDeliveryLineUiMetadata(udfMetadata.rows || []);

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
    distribution_rules: distributionRules.map(rule => ({
      FactorCode: rule.FactorCode || '',
      FactorDescription: rule.FactorDescription || '',
    })),
    warehouses,
    locations,
    warehouse_addresses: warehouses,
    company_address: { Address: companyInfo.address, State: companyInfo.state },
    tax_codes: taxCodes,
    payment_terms: paymentTerms,
    payment_methods: paymentMethods.map(method => ({
      Code: method.Code || '',
      Description: method.Description || method.Code || '',
    })).filter(method => method.Code),
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
    uom_groups,
    quality_options: {
      buyer: buyerQualityOptions,
      seller: sellerQualityOptions,
    },
    price_options: {
      buyer: buyerPriceOptions,
      seller: sellerPriceOptions,
    },
    decimal_settings: decimalSettings,
    udf_metadata: udfMetadata,
    eway_bill_formats: eWayBillFormats,
    generic_edoc_formats: genericEDocFormats,
    eway_bill_transporters: eWayBillTransporters,
    eway_bill_options: eWayBillDropdownOptions,
    matrix_columns: lineFieldMetadata.matrix_columns || [],
    line_field_metadata: {
      matrix_columns: lineFieldMetadata.matrix_columns || [],
      sap_form: lineFieldMetadata.sap_form || {},
    },
    warnings: [],
  };
};

const getReferenceData = async () => getCachedReferenceData(loadReferenceDataUncached);

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
    ship_to_addresses: shipToAddresses,
    bill_to_addresses: payToAddresses,
  };
};

// Get freight charges for modal
const getFreightCharges = (docEntry) => {
  if (!docEntry) {
    // 🆕 CREATE MODE (New Delivery)
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

  // ✏️ EDIT MODE (Existing Delivery)
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
    LEFT JOIN DLN3 T1 
      ON T0.ExpnsCode = T1.ExpnsCode 
     AND T1.DocEntry = @DocEntry

    ORDER BY T0.ExpnsName
  `, { DocEntry: docEntry }));
};

// Enhanced item list for modal with all details
const getItemsForModal = (whsCode = '') => {
  const hasWarehouse = String(whsCode || '').trim();

  return safe(db.query(`
  SELECT 
    T0.ItemCode,
    T0.ItemName,
    T0.FrgnName AS ForeignName,
    T0.ItmsGrpCod AS ItemGroupCode,
    T1.ItmsGrpNam AS ItemGroup, 
    CAST(${hasWarehouse ? 'ISNULL(W.OnHand, 0)' : 'T0.OnHand'} AS DECIMAL(19,2)) AS InStock,
    ${hasWarehouse ? 'ISNULL(W.IsCommited, 0)' : 'T0.IsCommited'} AS Committed,
    ${hasWarehouse ? 'ISNULL(W.OnOrder, 0)' : 'T0.OnOrder'} AS Ordered,
    CAST(${hasWarehouse ? 'ISNULL(W.OnHand, 0) - ISNULL(W.IsCommited, 0)' : 'T0.OnHand - T0.IsCommited'} AS DECIMAL(19,2)) AS Available,
    T0.SalUnitMsr AS SalesUnit,
    T0.InvntryUom AS InventoryUOM,
    T0.UgpEntry AS UoMGroupEntry,
    T0.SUoMEntry AS SalesUomEntry,
    T0.AvgPrice AS ItemCost,
    CHP.ChapterID AS HSNCode,
    T0.CountryOrg AS ItemCountryOrg,
    T0.SACEntry AS SACEntry,
    T0.VatGourpSa AS TaxCodeAR,
    '' AS DistributionRule,
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
  ${hasWarehouse ? 'LEFT JOIN OITW W ON W.ItemCode = T0.ItemCode AND W.WhsCode = @WhsCode' : ''}
  WHERE T0.SellItem = 'Y'
    AND T0.validFor <> 'N'
  ORDER BY T0.ItemCode
`, hasWarehouse ? { WhsCode: hasWarehouse } : {}));
};

// Get UoM conversion factor for an item
const getUomConversionFactor = async (itemCode, uomCode) => {
  // First, let's see what UoMs are available for this item
  const debugResult = await safe(db.query(`
    SELECT 
      T0.ItemCode,
      T0.InvntryUom AS InventoryUOM,
      T0.UgpEntry AS UoMGroupEntry,
      T0.SUoMEntry AS SalesUomEntry,
      T0.SalUnitMsr AS SalesUnit,
      T2.BaseQty,
      T2.AltQty,
      T3.UomCode,
      T3.UomName
    FROM OITM T0
    LEFT JOIN OUGP T1 ON T0.SUoMEntry = T1.UgpEntry
    LEFT JOIN UGP1 T2 ON T1.UgpEntry = T2.UgpEntry
    LEFT JOIN OUOM T3 ON T2.UomEntry = T3.UomEntry
    WHERE T0.ItemCode = @itemCode
  `, { itemCode }));
  
  console.log(`[DB] Available UoMs for item ${itemCode}:`, debugResult);
  
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
    LEFT JOIN OUGP T1 ON T0.SUoMEntry = T1.UgpEntry
    LEFT JOIN UGP1 T2 ON T1.UgpEntry = T2.UgpEntry
    LEFT JOIN OUOM T3 ON T2.UomEntry = T3.UomEntry
    WHERE T0.ItemCode = @itemCode
      AND T3.UomCode = @uomCode
  `, { itemCode, uomCode }));
  
  console.log(`[DB] UoM conversion query result for ${itemCode} / ${uomCode}:`, result);

  if (result.length > 0) {
    const row = result[0];
    const baseQty = parseFloat(row.BaseQty || 1);
    const altQty = parseFloat(row.AltQty || 1);
    const factor = baseQty > 0 ? altQty / baseQty : 1;
    
    console.log(`[DB] Conversion calculation:`, {
      baseQty,
      altQty,
      factor,
      formula: `${altQty} / ${baseQty} = ${factor}`
    });
    
    return {
      inventoryUOM: row.InventoryUOM,
      uomCode: row.UomCode,
      baseQty,
      altQty,
      factor
    };
  }

  // If not found in UoM Group, check if the UoM code itself is numeric (e.g., "5.6")
  // This handles cases where the conversion factor is stored directly in the UoM code
  const numericFactor = parseFloat(uomCode);
  console.log(`[DB] Numeric UoM check:`, {
    uomCode,
    uomCodeType: typeof uomCode,
    uomCodeValue: JSON.stringify(uomCode),
    numericFactor,
    isNaN: isNaN(numericFactor),
    greaterThanZero: numericFactor > 0,
    willEnterBlock: !isNaN(numericFactor) && numericFactor > 0
  });
  
  if (!isNaN(numericFactor) && numericFactor > 0) {
    console.log(`[DB] ✅ UoM code "${uomCode}" is numeric, using as conversion factor: ${numericFactor}`);
    
    // Get inventory UOM from item
    const itemResult = await safe(db.query(`
      SELECT InvntryUom AS InventoryUOM
      FROM OITM
      WHERE ItemCode = @itemCode
    `, { itemCode }));
    
    const inventoryUOM = itemResult.length > 0 ? itemResult[0].InventoryUOM : '';
    
    console.log(`[DB] ✅ Returning numeric UoM conversion:`, {
      inventoryUOM,
      uomCode,
      baseQty: 1,
      altQty: numericFactor,
      factor: numericFactor
    });
    
    return {
      inventoryUOM,
      uomCode: uomCode,
      baseQty: 1,
      altQty: numericFactor,
      factor: numericFactor
    };
  }

  // If not found, return factor of 1 (no conversion)
  console.warn(`[DB] ⚠️ No UoM conversion found for ${itemCode} / ${uomCode}, returning default factor 1`);
  
  return {
    inventoryUOM: '',
    uomCode: uomCode,
    baseQty: 1,
    altQty: 1,
    factor: 1
  };
};

// ─── Validation Functions ───────────────────────────────────────────────────────

const BATCH_QTY_TOLERANCE = 0.001;
const SAP_YES_VALUES = new Set(['Y', 'YES', 'TRUE', 'TYES', '1']);
const MANUAL_UOM_PLACEHOLDER = 'MANUAL';

const parseBatchQtyNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const isSapYes = (value) => SAP_YES_VALUES.has(String(value || '').trim().toUpperCase());
const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';
const isManualUomPlaceholder = (value) =>
  String(value || '').trim().toUpperCase() === MANUAL_UOM_PLACEHOLDER;

const isTruthyFlag = (value) => (
  value === true || value === 1 || ['Y', 'YES', 'TRUE', '1'].includes(String(value ?? '').trim().toUpperCase())
);

const getDeliveryLineUomValue = (line = {}) => {
  if (isTruthyFlag(line.uomNameEdited)) {
    return line.uomName ?? line.UoMName ?? line.UomName ?? line.UnitMsr ?? line.unitMsr ?? line.uomCode;
  }

  return line.uomEntry ?? line.UoMEntry ?? line.uomCode ?? line.UoMCode ?? line.UomCode
    ?? line.uomName ?? line.UoMName ?? line.UomName ?? line.UnitMsr ?? line.unitMsr;
};

const getEffectiveLineUomCode = (line = {}, item = {}) => {
  const rawUomCode = String(getDeliveryLineUomValue(line) || '').trim();
  if (!isManualUomPlaceholder(rawUomCode)) {
    return rawUomCode;
  }

  return String(
    line.inventoryUOM
      || line.inventoryUom
      || line.InventoryUOM
      || line.uomName
      || item.SalUnitMsr
      || item.InvntryUom
      || rawUomCode
  ).trim();
};

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

const validateLineMasterData = async (lines = []) => {
  const errors = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || {};
    const lineNo = i + 1;
    const itemCode = String(line.itemNo || '').trim();
    const whsCode = String(line.whse || '').trim();
    const taxCode = String(line.taxCode || '').trim();
    const hsnCode = String(line.hsnCode || '').trim();
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const isBaseDocumentLine = !isBlank(line.baseEntry) && !isBlank(line.baseType) && !isBlank(line.baseLine);

    if (!itemCode) {
      errors.push(`Line ${lineNo}: Item No. is required`);
      continue;
    }

    const itemRows = await safe(db.query(`
      SELECT TOP 1
        T0.ItemCode,
        T0.ItemName,
        T0.SellItem,
        T0.validFor,
        T0.frozenFor,
        T0.InvntItem,
        T0.SalUnitMsr,
        T0.InvntryUom,
        T0.SUoMEntry,
        T0.UgpEntry,
        T0.VatGourpSa,
        COALESCE(CHP.ChapterID, T0.SWW, '') AS HSNCode
      FROM OITM T0
      LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
      WHERE T0.ItemCode = @ItemCode
    `, { ItemCode: itemCode }));

    const item = itemRows[0];
    if (!item) {
      errors.push(`Line ${lineNo}: Item ${itemCode} does not exist in SAP B1`);
      continue;
    }

    if (!isSapYes(item.SellItem) || String(item.validFor || '').toUpperCase() === 'N' || String(item.frozenFor || '').toUpperCase() === 'Y') {
      errors.push(`Line ${lineNo}: Item ${itemCode} is not an active sales item in SAP B1`);
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`Line ${lineNo}: Quantity must be greater than 0`);
    }

    if (!isBaseDocumentLine && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
      errors.push(`Line ${lineNo}: Unit Price must be greater than 0`);
    }

    const effectiveHsnCode = hsnCode || String(item.HSNCode || '').trim();
    if (!effectiveHsnCode) {
      errors.push(`Line ${lineNo}: HSN is required for item ${itemCode}`);
    }

    // SAP determines the UoM from the source line for a Copy From document.
    // The Delivery payload contains only the BaseEntry/BaseType/BaseLine for
    // those rows, so validating a separate UI UoM value can reject a valid
    // copied Sales Order before SAP gets a chance to create the delivery.
    const itemUsesManualUom = Number(item.UgpEntry) <= 0 || Number(item.SUoMEntry) <= 0;
    if (!isBaseDocumentLine && !itemUsesManualUom) {
      const uomCode = getEffectiveLineUomCode(line, item);
      if (!uomCode) {
        errors.push(`Line ${lineNo}: UoM Name is required for item ${itemCode}`);
      } else {
        const numericUomFactor = Number(uomCode);
        const isNumericUomFactor = Number.isFinite(numericUomFactor) && numericUomFactor > 0;
        const directUomMatches = [item.SalUnitMsr, item.InvntryUom]
          .map((value) => String(value || '').trim().toUpperCase())
          .filter(Boolean)
          .includes(uomCode.toUpperCase());

        if (!isNumericUomFactor && !directUomMatches) {
          const uomEntry = await resolveDeliveryLineUomEntry(itemCode, uomCode, {
            allowDefaultFallback: false,
          });

          if (uomEntry === null || uomEntry === undefined) {
            errors.push(`Line ${lineNo}: UoM ${uomCode} is not valid for item ${itemCode}`);
          }
        }
      }
    }

    if (!whsCode) {
      errors.push(`Line ${lineNo}: Whse is required`);
    } else {
      const warehouseRows = await safe(db.query(`
        SELECT TOP 1 WhsCode, Inactive
        FROM OWHS
        WHERE WhsCode = @WhsCode
      `, { WhsCode: whsCode }));

      if (!warehouseRows.length) {
        errors.push(`Line ${lineNo}: Warehouse ${whsCode} does not exist in SAP B1`);
      } else if (String(warehouseRows[0].Inactive || '').toUpperCase() === 'Y') {
        errors.push(`Line ${lineNo}: Warehouse ${whsCode} is inactive`);
      }
    }

    if (!taxCode || taxCode.toUpperCase() === 'SELECT') {
      errors.push(`Line ${lineNo}: Tax Code is required`);
    } else {
      const taxRows = await safe(db.query(`
        SELECT TOP 1 Code
        FROM OSTC
        WHERE UPPER(LTRIM(RTRIM(Code))) = @TaxCode
          AND ISNULL(Lock, 'N') <> 'Y'
      `, { TaxCode: taxCode.toUpperCase() }));

      if (!taxRows.length) {
        errors.push(`Line ${lineNo}: Tax Code ${taxCode} is not active in SAP B1`);
      }
    }
  }

  return { errors, isValid: errors.length === 0 };
};

const validateLineUdfValues = async (lines = []) => {
  const errors = [];
  const definitions = await getUdfDefinitions('DLN1').catch(() => []);
  const validUdfKeys = new Set(definitions.map((field) => field.key));
  const fixedValueFields = definitions.filter((field) => Array.isArray(field.options) && field.options.length > 0);
  const fixedValuesByKey = new Map(fixedValueFields.map((field) => [
    field.key,
    new Set(field.options.map((option) => String((typeof option === 'object' ? option.value : option) ?? '').trim()).filter(Boolean)),
  ]));

  (lines || []).forEach((line, index) => {
    Object.entries(line?.udf || {}).forEach(([key, value]) => {
      if (!String(key || '').startsWith('U_') || isBlank(value)) return;
      if (!validUdfKeys.has(key)) {
        return;
      }

      const fixedValues = fixedValuesByKey.get(key);
      if (fixedValues && fixedValues.size && !fixedValues.has(String(value).trim())) {
        errors.push(`Line ${index + 1}: ${key} value '${value}' is not valid in SAP B1`);
      }
    });
  });

  return { errors, isValid: errors.length === 0 };
};

// Validate batch selection only for inventory items that are batch-managed in SAP B1.
const validateBatchSelection = async (lines) => {
  const errors = [];
  const allocatedByStockBatch = new Map();
  const usedSerialNumbers = new Set();
  
  for (const line of lines) {
    if (!line.itemNo) continue;
    
    const result = await safe(db.query(`
      SELECT T0.InvntItem, T0.ManBtchNum, T0.ManSerNum, T0.ItemName
      FROM OITM T0
      WHERE T0.ItemCode = @ItemCode
    `, { ItemCode: line.itemNo }));
    
    const item = result[0];
    if (item && isSapYes(item.InvntItem) && isSapYes(item.ManBtchNum)) {
      if (!Array.isArray(line.batches) || line.batches.length === 0) {
        errors.push(`Batch selection is mandatory for batch-managed item ${line.itemNo}`);
      } else {
        const totalBatchQty = line.batches.reduce(
          (sum, batch) => sum + parseBatchQtyNumber(batch.quantity),
          0
        );
        const requiredBatchQty = getRequiredBatchQty(line);
        const inventoryUOM = String(line.inventoryUOM || line.uomCode || 'Base UoM').trim();
        
        if (Math.abs(totalBatchQty - requiredBatchQty) > BATCH_QTY_TOLERANCE) {
          errors.push(
            `Batch quantity must match base quantity for item ${line.itemNo}. Required: ${requiredBatchQty.toFixed(2)} ${inventoryUOM}, Allocated: ${totalBatchQty.toFixed(2)} ${inventoryUOM}`
          );
        }

        const allocatedByBatch = new Map();
        for (const batch of line.batches) {
          const batchNumber = String(batch.batchNumber || '').trim();
          const batchQty = parseBatchQtyNumber(batch.quantity);

          if (!batchNumber || batchQty <= 0) continue;

          allocatedByBatch.set(
            batchNumber,
            (allocatedByBatch.get(batchNumber) || 0) + batchQty
          );
        }

        for (const [batchNumber, allocatedQty] of allocatedByBatch.entries()) {
          const itemCode = String(line.itemNo || '').trim();
          const whsCode = String(line.whse || '').trim();
          const key = JSON.stringify({ itemCode, whsCode, batchNumber });
          const current = allocatedByStockBatch.get(key) || {
            itemCode,
            whsCode,
            batchNumber,
            inventoryUOM,
            allocatedQty: 0,
          };
          current.allocatedQty += allocatedQty;
          allocatedByStockBatch.set(key, current);
        }
      }
    }

    if (item && isSapYes(item.InvntItem) && isSapYes(item.ManSerNum)) {
      const serials = Array.isArray(line.serialNumbers) ? line.serialNumbers : [];
      const requiredQty = getRequiredBatchQty(line);
      if (!Number.isInteger(requiredQty) || requiredQty < 1) {
        errors.push(`Serial-managed item ${line.itemNo} requires a positive whole-number base quantity`);
      }
      if (serials.length !== requiredQty) {
        errors.push(`Serial count must match base quantity for item ${line.itemNo}. Required: ${requiredQty}, Allocated: ${serials.length}`);
      }
      serials.forEach((serial) => {
        const serialNumber = String(serial?.serialNumber || '').trim();
        const serialKey = `${line.itemNo}:${serialNumber}`;
        if (!serialNumber) errors.push(`Serial number is required for item ${line.itemNo}`);
        else if (usedSerialNumbers.has(serialKey)) errors.push(`Serial ${serialNumber} is allocated more than once for item ${line.itemNo}`);
        usedSerialNumbers.add(serialKey);
      });
    }

    if (item && isSapYes(item.InvntItem) && line.whse) {
      const warehouseMetadata = await getTableFieldMetadata('OWHS');
      if (hasTableField(warehouseMetadata, 'BinActivat')) {
        const warehouseRows = await safe(db.query(`
          SELECT BinActivat FROM OWHS WHERE WhsCode = @WhsCode
        `, { WhsCode: line.whse }));
        if (isSapYes(warehouseRows[0]?.BinActivat)) {
          const allocations = Array.isArray(line.binAllocations) ? line.binAllocations : [];
          const requiredQty = getRequiredBatchQty(line);
          const allocatedQty = allocations.reduce((sum, allocation) => sum + parseBatchQtyNumber(allocation.quantity), 0);
          if (!allocations.length || Math.abs(allocatedQty - requiredQty) > BATCH_QTY_TOLERANCE) {
            errors.push(`Bin allocation must match base quantity for item ${line.itemNo}. Required: ${requiredQty.toFixed(2)}, Allocated: ${allocatedQty.toFixed(2)}`);
          }
          for (const allocation of allocations) {
            const binAbsEntry = Number(allocation.binAbsEntry);
            const bins = Number.isInteger(binAbsEntry) ? await safe(db.query(`
              SELECT AbsEntry FROM OBIN WHERE AbsEntry = @BinAbsEntry AND WhsCode = @WhsCode
            `, { BinAbsEntry: binAbsEntry, WhsCode: line.whse })) : [];
            if (!bins.length) errors.push(`Invalid bin allocation for item ${line.itemNo} in warehouse ${line.whse}`);
            const allocationIndex = allocation.allocationIndex;
            const linkedCount = isSapYes(item.ManBtchNum)
              ? (line.batches || []).length
              : isSapYes(item.ManSerNum) ? (line.serialNumbers || []).length : 0;
            if (linkedCount > 0 && (!Number.isInteger(Number(allocationIndex))
              || Number(allocationIndex) < 0 || Number(allocationIndex) >= linkedCount)) {
              errors.push(`Bin allocation for item ${line.itemNo} must reference a valid batch or serial row`);
            }
          }
        }
      }
    }
  }

  for (const entry of allocatedByStockBatch.values()) {
    const batchResult = await safe(db.query(`
      SELECT SUM(T0.Quantity) as AvailableQty
      FROM OIBT T0
      WHERE T0.ItemCode = @ItemCode
        AND T0.BatchNum = @BatchNum
        AND T0.WhsCode = @WhsCode
    `, {
      ItemCode: entry.itemCode,
      BatchNum: entry.batchNumber,
      WhsCode: entry.whsCode
    }));

    const availableQty = parseBatchQtyNumber(batchResult[0]?.AvailableQty);

    if (availableQty <= 0) {
      errors.push(`Batch ${entry.batchNumber} does not belong to warehouse ${entry.whsCode} for item ${entry.itemCode}`);
      continue;
    }

    if (entry.allocatedQty - availableQty > BATCH_QTY_TOLERANCE) {
      errors.push(
        `Batch ${entry.batchNumber} exceeds available quantity for item ${entry.itemCode} in warehouse ${entry.whsCode}. Allocated across delivery: ${entry.allocatedQty.toFixed(2)} ${entry.inventoryUOM}, Available: ${availableQty.toFixed(2)} ${entry.inventoryUOM}`
      );
    }
  }
  
  return { errors, isValid: errors.length === 0 };
};

// Validate tax codes
const validateTaxCodes = (lines) => {
  const errors = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.itemNo) continue;
    
    if (!line.taxCode || line.taxCode === 'Select' || line.taxCode === '') {
      errors.push(`Please select a valid Tax Code for line ${i + 1}`);
    }
  }
  
  return { errors, isValid: errors.length === 0 };
};

// Validate stock availability only for inventory-managed items. SAP B1 allows
// non-inventory sales items on delivery documents without stock or warehouse stock checks.
const validateStockAvailability = (lines) => {
  const errors = [];
  const promises = [];
  
  for (const line of lines) {
    if (!line.itemNo || !line.whse) continue;
    
    const promise = safe(db.query(`
      SELECT 
        T1.InvntItem AS InventoryItem,
        T0.WhsCode AS WarehouseCode,
        T0.OnHand,
        T0.IsCommited,
        T0.OnHand - T0.IsCommited as Available,
        T1.InvntryUom AS InventoryUOM
      FROM OITM T1
      LEFT JOIN OITW T0
        ON T0.ItemCode = T1.ItemCode
       AND T0.WhsCode = @WhsCode
      WHERE T1.ItemCode = @ItemCode
    `, {
      ItemCode: line.itemNo,
      WhsCode: line.whse
    })).then(result => {
      if (result.length === 0) {
        errors.push(`Item ${line.itemNo} not found in SAP B1`);
        return;
      }
      
      const stock = result[0];
      if (!isSapYes(stock.InventoryItem)) {
        return;
      }

      if (!stock.WarehouseCode) {
        errors.push(`Item ${line.itemNo} not found in warehouse ${line.whse}`);
        return;
      }

      const actualRequiredQty = getRequiredBatchQty(line);
      const isBaseSalesOrderLine = String(line.baseType || '') === '17'
        && !isBlank(line.baseEntry)
        && !isBlank(line.baseLine);
      const availableStock = parseBatchQtyNumber(
        isBaseSalesOrderLine ? stock.OnHand : stock.Available
      );
      const inventoryUOM = String(stock.InventoryUOM || line.inventoryUOM || line.uomCode || 'Base UoM').trim();
      
      if (actualRequiredQty - availableStock > BATCH_QTY_TOLERANCE) {
        const quantityLabel = isBaseSalesOrderLine ? 'On hand' : 'Available';
        errors.push(`Insufficient stock for item ${line.itemNo} in warehouse ${line.whse}. Required: ${actualRequiredQty.toFixed(2)} ${inventoryUOM}, ${quantityLabel}: ${availableStock.toFixed(2)} ${inventoryUOM}`);
      }
    });
    
    promises.push(promise);
  }
  
  return Promise.all(promises).then(() => ({
    errors,
    isValid: errors.length === 0
  }));
};

// Validate branch
const validateBranch = async (branchId) => {
  if (!branchId) {
    return { errors: ['Please select a branch'], isValid: false };
  }
  
  const metadata = await getTableFieldMetadata('OBPL');
  if (!hasTableField(metadata, 'BPLId')) return { errors: [], isValid: true };
  const disabledExpression = hasTableField(metadata, 'Disabled') ? 'Disabled' : "'N'";
  const result = await safe(db.query(`
    SELECT BPLId, BPLName, ${disabledExpression} AS Disabled
    FROM OBPL
    WHERE BPLId = @BPLId
  `, { BPLId: branchId }));
  if (result.length === 0) return { errors: ['Branch not found'], isValid: false };
    
    const branch = result[0];
    if (branch.Disabled === 'Y') {
      return { errors: ['Invalid or inactive branch selected'], isValid: false };
    }
    
  return { errors: [], isValid: true };
};


// Validate series
const validateSeries = async (seriesId, branchId, postingDate = null) => {
  if (!seriesId) {
    return { errors: ['Please select a series'], isValid: false };
  }
  
  const validSeries = await getMarketingDocumentSeries({
    db,
    objectCode: '15',
    targetDate: postingDate,
    branch: branchId,
    collapseToSapVisible: false,
  });
  const isValid = validSeries.some((series) => String(series.Series) === String(seriesId));
  return isValid
    ? { errors: [], isValid: true }
    : { errors: ['Series is not valid for this Delivery posting date, branch, or number range'], isValid: false };
};

const DELIVERY_BASE_DOCUMENTS = Object.freeze({
  13: Object.freeze({ headerTable: 'OINV', lineTable: 'INV1', reserveInvoice: true }),
  17: Object.freeze({ headerTable: 'ORDR', lineTable: 'RDR1' }),
  23: Object.freeze({ headerTable: 'OQUT', lineTable: 'QUT1' }),
});

const validateDeliveryBaseDocumentLines = async (lines = [], customerCode = '') => {
  const errors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || {};
    if (isBlank(line.baseEntry) && isBlank(line.baseType) && isBlank(line.baseLine)) continue;
    const baseType = Number(line.baseType);
    const document = DELIVERY_BASE_DOCUMENTS[baseType];
    if (!document || isBlank(line.baseEntry) || isBlank(line.baseLine)) {
      errors.push(`Line ${index + 1}: Invalid Delivery base-document reference`);
      continue;
    }
    const reserveFilter = document.reserveInvoice ? "AND T0.isIns = 'Y'" : '';
    const rows = await safe(db.query(`
      SELECT
        T0.CardCode,
        T0.DocStatus,
        T0.CANCELED,
        T1.ItemCode,
        T1.OpenQty,
        T1.LineStatus
      FROM ${document.headerTable} T0
      INNER JOIN ${document.lineTable} T1 ON T1.DocEntry = T0.DocEntry
      WHERE T0.DocEntry = @BaseEntry
        AND T1.LineNum = @BaseLine
        ${reserveFilter}
    `, { BaseEntry: line.baseEntry, BaseLine: line.baseLine }));
    const source = rows[0];
    if (!source || source.DocStatus !== 'O' || source.CANCELED !== 'N' || source.LineStatus !== 'O') {
      errors.push(`Line ${index + 1}: The base document row is no longer open`);
      continue;
    }
    if (customerCode && String(source.CardCode) !== String(customerCode)) {
      errors.push(`Line ${index + 1}: The base document belongs to a different customer`);
    }
    if (String(source.ItemCode || '').trim() !== String(line.itemNo || '').trim()) {
      errors.push(`Line ${index + 1}: Item does not match the base document row`);
    }
    const requestedQuantity = Number(line.quantity);
    const openQuantity = Number(source.OpenQty);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0
      || !Number.isFinite(openQuantity) || requestedQuantity - openQuantity > BATCH_QTY_TOLERANCE) {
      errors.push(`Line ${index + 1}: Quantity exceeds the base document open quantity`);
    }
  }
  return { errors, isValid: errors.length === 0 };
};

// Validate warehouse belongs to branch
const validateWarehouseBranch = async (warehouseCode, branchId) => {
  if (!warehouseCode || !branchId) {
    return { errors: [], isValid: true }; // Skip validation if either is missing
  }
  
  const metadata = await getTableFieldMetadata('OWHS');
  if (!hasTableField(metadata, 'BPLId')) return { errors: [], isValid: true };
  const result = await safe(db.query(`
    SELECT WhsCode, BPLId
    FROM OWHS
    WHERE WhsCode = @WhsCode
    AND BPLId = @BPLId
  `, {
    WhsCode: warehouseCode,
    BPLId: branchId
  }));
  return result.length === 0
    ? { errors: ['Warehouse does not belong to selected branch'], isValid: false }
    : { errors: [], isValid: true };
};

module.exports = {
  getReferenceData,
  getSalesEmployees,
  getCustomerDetails,
  getDeliveryLineFieldMetadata,
  getDeliveryHeaderFieldMetadata,
  getLookupValues,
  createLookupValue,
  getDeliveryList,
  getDelivery,
  getSavedDeliveryQuantities,
  getDocumentSeries,
  getNextNumber,
  getStateFromWarehouse,
  getOpenSalesOrders,
  getSalesOrderForCopy,
  getOpenArReserveInvoices,
  getArReserveInvoiceForCopy,
  getDeliveryForCopy,
  getDeliveryForCopyToCreditMemo,
  getBatchesByItem,
  getAvailableSerials,
  getAvailableBins,
  getFreightCharges,
  getItemsForModal,
  getUomConversionFactor,
  resolveDeliveryLineUomEntry,
  getBaseSalesOrderLineItemCode,
  // Validation functions
  validateBatchSelection,
  validateLineMasterData,
  validateDeliveryBaseDocumentLines,
  validateLineUdfValues,
  validateTaxCodes,
  validateStockAvailability,
  validateBranch,
  validateSeries,
  validateWarehouseBranch,
  resolveEWayBillHSNEntry,
  resolveEWayBillStateCode,
  
};
