/**
 * Sales Order reference data — loaded directly from SAP B1 SQL Server database.
 * Column names verified against NCPL_110126 schema.
 */
const db = require('./dbService');
const { loadCompanyUomGroups } = require('./documentUomDbUtils');
const masterDataDbService = require('./masterDataDbService');
const hsnCodeDbService = require('./hsnCodeDbService');
const {
  getHeaderUdfValues,
  getLineUdfValues,
  getMarketingDocumentUdfs,
  getUdfDefinitions,
} = require('./udfMetadataService');
const {
  loadBusinessPartnerAddresses,
  splitBusinessPartnerAddresses,
} = require('./businessPartnerAddressDbUtils');
const { getMarketingDocumentSeries } = require('./documentSeriesDbUtils');
const authDbService = require('./authDbService');
const { getRequestContext } = require('./requestContextService');
const { selectEffectiveCprfRows } = require('./sapFormPreferenceUtils');
const {
  createTableColumnDetailsReader,
  createTableFieldMetadataReader,
  escapeLikeValue,
  LIKE_ESCAPE_SQL,
  normalizeRecordset,
  resolveDatabaseScope,
} = require('./salesDocumentDbCompatibility');

const safe = async (promise) => {
  try {
    const r = await promise;
    return r.recordset || [];
  } catch (e) {
    console.warn('[Sales Order DB] Query failed silently:', e.message);
    return [];
  }
};

const escapeLike = escapeLikeValue;
const normalizeTopLimit = (value) => {
  if (value == null || value === '') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.floor(parsed);
};

const formatSapDate = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
};

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDecimal = (value, decimals = 2) => {
  const number = toFiniteNumber(value);
  if (number === null) return '';

  const normalizedDecimals = Number.isInteger(decimals) && decimals >= 0 ? decimals : 2;
  const factor = 10 ** normalizedDecimals;
  return (Math.round((number + Number.EPSILON) * factor) / factor).toFixed(normalizedDecimals);
};

const getDisplayDiscountAmount = (unitPrice, discountPercent) => {
  const price = toFiniteNumber(unitPrice);
  const percent = toFiniteNumber(discountPercent);
  if (price === null || percent === null) return '';

  return formatDecimal((price * percent) / 100, 2);
};

const resolveSavedLineUnitPrice = (line = {}) => {
  const priceBeforeDiscount = toFiniteNumber(line.PriceBefDi);
  const priceAfterDiscount = toFiniteNumber(line.Price);

  if (priceBeforeDiscount !== null && priceBeforeDiscount !== 0) {
    return String(line.PriceBefDi);
  }
  if (priceAfterDiscount !== null && priceAfterDiscount !== 0) {
    return String(line.Price);
  }
  if (priceBeforeDiscount !== null) return String(line.PriceBefDi);
  if (priceAfterDiscount !== null) return String(line.Price);
  return '0';
};

const isSalesBomParentTreeType = (value) => (
  ['S', 'ISALESTREE', 'SALESTREE'].includes(String(value || '').trim().toUpperCase())
);

const getTaxRateFromCode = (taxCode) => {
  const normalized = String(taxCode || '').trim();
  if (!normalized) return 0;

  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;

  const rate = Number(match[1]);
  return Number.isFinite(rate) ? rate : 0;
};

const getCalculatedForRate = (unitPrice, discountPercent, taxCode) => {
  const price = toFiniteNumber(unitPrice);
  if (price === null) return '';

  const discount = toFiniteNumber(discountPercent) || 0;
  const taxRate = getTaxRateFromCode(taxCode);
  const discountedPrice = price * (1 - (discount / 100));
  return formatDecimal(discountedPrice * (1 + (taxRate / 100)), 5);
};

const normalizeSalesOrderStatusCode = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'o' || normalized === 'open') return 'O';
  if (normalized === 'c' || normalized === 'close' || normalized === 'closed') return 'C';
  return '';
};

const quoteSqlIdentifier = (identifier) => `[${String(identifier || '').replace(/]/g, ']]')}]`;
const normalizeUdfNameForMatch = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const unique = (values = []) => [...new Set(values.filter(Boolean))];

const FALLBACK_SALES_ORDER_SELLER_CODE_EXPRESSION = `
  COALESCE(
    CASE
      WHEN T0.SlpCode IS NOT NULL AND T0.SlpCode <> -1 THEN CAST(T0.SlpCode AS NVARCHAR(50))
      ELSE ''
    END,
    ''
  )
`;

const FALLBACK_SALES_ORDER_SELLER_NAME_EXPRESSION = `
  COALESCE(
    CASE
      WHEN T0.SlpCode IS NOT NULL AND T0.SlpCode <> -1 THEN NULLIF(LTRIM(RTRIM(SLP.SlpName)), '')
      ELSE ''
    END,
    ''
  )
`;

const getFallbackSalesOrderSellerExpressions = () => ({
  codeExpression: FALLBACK_SALES_ORDER_SELLER_CODE_EXPRESSION,
  nameExpression: FALLBACK_SALES_ORDER_SELLER_NAME_EXPRESSION,
});

const buildNullableTrimmedTextExpression = (expression) => (
  `NULLIF(LTRIM(RTRIM(CAST(${expression} AS NVARCHAR(254)))), '')`
);

const buildSalesOrderSellerExpression = (columnNames, fallbackExpression) => {
  const udfExpressions = unique(columnNames).map((columnName) => (
    buildNullableTrimmedTextExpression(`T0.${quoteSqlIdentifier(columnName)}`)
  ));

  return `
  COALESCE(
    ${[...udfExpressions, fallbackExpression, "''"].join(',\n    ')}
  )
`;
};

const resolveColumnName = (fieldMetadata = {}, candidateColumnName) => {
  const normalizedCandidate = normalizeUdfNameForMatch(candidateColumnName);
  return Object.keys(fieldMetadata).find(
    (columnName) => normalizeUdfNameForMatch(columnName) === normalizedCandidate
  );
};

const resolveTableColumnName = (fieldMetadata = {}, candidateColumnName) => {
  const normalizedCandidate = String(candidateColumnName || '').trim().toLowerCase();
  return Object.keys(fieldMetadata || {}).find(
    (columnName) => String(columnName || '').trim().toLowerCase() === normalizedCandidate
  );
};

const optionalHeaderColumn = (fieldMetadata = {}, candidates = [], alias, fallback = "''") => {
  const resolvedColumn = candidates
    .map((candidate) => resolveTableColumnName(fieldMetadata, candidate))
    .find(Boolean);
  return resolvedColumn
    ? `T0.${quoteSqlIdentifier(resolvedColumn)} AS ${quoteSqlIdentifier(alias)}`
    : `${fallback} AS ${quoteSqlIdentifier(alias)}`;
};

const resolveSalesOrderSellerColumns = async () => {
  const [fieldMetadata, udfDefinitions] = await Promise.all([
    getTableFieldMetadata('ORDR'),
    getUdfDefinitions('ORDR'),
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

  return { codeColumns, nameColumns };
};

const getSalesOrderSellerExpressions = async () => {
  try {
    const { codeColumns, nameColumns } = await resolveSalesOrderSellerColumns();

    return {
      codeExpression: buildSalesOrderSellerExpression(
        codeColumns,
        `CASE
      WHEN T0.SlpCode IS NOT NULL AND T0.SlpCode <> -1 THEN CAST(T0.SlpCode AS NVARCHAR(50))
      ELSE ''
    END`
      ),
      nameExpression: buildSalesOrderSellerExpression(
        nameColumns,
        `CASE
      WHEN T0.SlpCode IS NOT NULL AND T0.SlpCode <> -1 THEN NULLIF(LTRIM(RTRIM(SLP.SlpName)), '')
      ELSE ''
    END`
      ),
    };
  } catch (error) {
    console.warn('[Sales Order List] Falling back to sales employee seller fields:', error.message);
    return getFallbackSalesOrderSellerExpressions();
  }
};

const buildSalesOrderListFilterQuery = ({
  query = '',
  openOnly = true,
  docNum = '',
  customerRefNo = '',
  customerCode = '',
  customerName = '',
  sellerCode = '',
  sellerName = '',
  status = '',
  postingDateFrom = '',
  postingDateTo = '',
}, options = {}) => {
  const {
    codeExpression: salesOrderSellerCodeExpression,
    nameExpression: salesOrderSellerNameExpression,
  } = options.sellerExpressions || getFallbackSalesOrderSellerExpressions();
  const normalizedQuery = String(query || '').trim();
  const normalizedDocNum = String(docNum || '').trim();
  const normalizedCustomerRefNo = String(customerRefNo || '').trim();
  const normalizedCustomerCode = String(customerCode || '').trim();
  const normalizedCustomerName = String(customerName || '').trim();
  const normalizedSellerCode = String(sellerCode || '').trim();
  const normalizedSellerName = String(sellerName || '').trim();
  const normalizedDateFrom = String(postingDateFrom || '').trim();
  const normalizedDateTo = String(postingDateTo || '').trim();
  const normalizedStatus = normalizeSalesOrderStatusCode(status);
  const openOnlyFilter = openOnly !== false;
  const excludeField = String(options.excludeField || '').trim();
  const whereClauses = ["T0.CANCELED <> 'Y'"];
  const params = {};

  if (normalizedStatus && excludeField !== 'status') {
    whereClauses.push('T0.DocStatus = @status');
    params.status = normalizedStatus;
  } else if (openOnlyFilter) {
    whereClauses.push("T0.DocStatus = 'O'");
  }

  if (normalizedQuery) {
    whereClauses.push(`(
      CAST(T0.DocNum AS NVARCHAR(50)) LIKE @query ${LIKE_ESCAPE_SQL}
      OR T0.NumAtCard LIKE @query ${LIKE_ESCAPE_SQL}
      OR T0.CardCode LIKE @query ${LIKE_ESCAPE_SQL}
      OR T0.CardName LIKE @query ${LIKE_ESCAPE_SQL}
      OR ${salesOrderSellerCodeExpression} LIKE @query ${LIKE_ESCAPE_SQL}
      OR ${salesOrderSellerNameExpression} LIKE @query ${LIKE_ESCAPE_SQL}
    )`);
    params.query = `%${escapeLike(normalizedQuery)}%`;
  }

  if (normalizedDocNum && excludeField !== 'docNum') {
    whereClauses.push('CAST(T0.DocNum AS NVARCHAR(50)) = @docNum');
    params.docNum = normalizedDocNum;
  }

  if (normalizedCustomerRefNo && excludeField !== 'customerRefNo') {
    whereClauses.push(`T0.NumAtCard LIKE @customerRefNo ${LIKE_ESCAPE_SQL}`);
    params.customerRefNo = `%${escapeLike(normalizedCustomerRefNo)}%`;
  }

  if (normalizedCustomerCode && excludeField !== 'customerCode') {
    whereClauses.push(`T0.CardCode LIKE @customerCode ${LIKE_ESCAPE_SQL}`);
    params.customerCode = `%${escapeLike(normalizedCustomerCode)}%`;
  }

  if (normalizedCustomerName && excludeField !== 'customerName') {
    whereClauses.push(`T0.CardName LIKE @customerName ${LIKE_ESCAPE_SQL}`);
    params.customerName = `%${escapeLike(normalizedCustomerName)}%`;
  }

  if (normalizedSellerCode && excludeField !== 'sellerCode') {
    whereClauses.push(`${salesOrderSellerCodeExpression} LIKE @sellerCode ${LIKE_ESCAPE_SQL}`);
    params.sellerCode = `%${escapeLike(normalizedSellerCode)}%`;
  }

  if (normalizedSellerName && excludeField !== 'sellerName') {
    whereClauses.push(`${salesOrderSellerNameExpression} LIKE @sellerName ${LIKE_ESCAPE_SQL}`);
    params.sellerName = `%${escapeLike(normalizedSellerName)}%`;
  }

  if (normalizedDateFrom && excludeField !== 'postingDateFrom') {
    whereClauses.push('CAST(T0.DocDate AS date) >= CAST(@postingDateFrom AS date)');
    params.postingDateFrom = normalizedDateFrom;
  }

  if (normalizedDateTo && excludeField !== 'postingDateTo') {
    whereClauses.push('CAST(T0.DocDate AS date) <= CAST(@postingDateTo AS date)');
    params.postingDateTo = normalizedDateTo;
  }

  return { whereClauses, params };
};

// ── queries ───────────────────────────────────────────────────────────────────

const getCustomers = () => safe(db.query(`
  SELECT *
  FROM   OCRD
  WHERE  CardType = 'C'
  ORDER  BY CardName, CardCode
`));

const searchCustomers = async ({ query = '', cardCode = '', cardName = '', top, sortBy = 'code' } = {}) => {
  const normalizedQuery = String(query || '').trim();
  const normalizedCardCode = String(cardCode || '').trim();
  const normalizedCardName = String(cardName || '').trim();
  const normalizedTop = normalizeTopLimit(top);
  const orderBy = String(sortBy || '').trim().toLowerCase() === 'name'
    ? 'CardName, CardCode'
    : 'CardCode, CardName';
  const topClause = normalizedTop ? 'TOP (@top)' : '';

  return safe(db.query(`
    SELECT ${topClause}
      *
    FROM OCRD
    WHERE CardType = 'C'
      AND (@query = '' OR CardCode LIKE @queryLike ${LIKE_ESCAPE_SQL} OR CardName LIKE @queryLike ${LIKE_ESCAPE_SQL})
      AND (@cardCode = '' OR CardCode LIKE @cardCodeLike ${LIKE_ESCAPE_SQL})
      AND (@cardName = '' OR CardName LIKE @cardNameLike ${LIKE_ESCAPE_SQL})
    ORDER BY ${orderBy}
  `, {
    ...(normalizedTop ? { top: normalizedTop } : {}),
    query: normalizedQuery,
    queryLike: `%${escapeLike(normalizedQuery)}%`,
    cardCode: normalizedCardCode,
    cardCodeLike: `%${escapeLike(normalizedCardCode)}%`,
    cardName: normalizedCardName,
    cardNameLike: `%${escapeLike(normalizedCardName)}%`,
  }));
};

const getOptionalItemGstRelevantSelect = async () => {
  const columns = await getTableColumnDetails('OITM');
  const gstRelevantColumn = columns.find(
    (column) => String(column.columnName || '').toUpperCase() === 'GSTRELEVNT',
  );
  return gstRelevantColumn ? `T0.${gstRelevantColumn.columnName} AS GSTRelevnt,` : `'' AS GSTRelevnt,`;
};

const getItems = async () => {
  const gstRelevantSelect = await getOptionalItemGstRelevantSelect();
  return safe(db.query(`
  SELECT T0.ItemCode, T0.ItemName,
         T0.SalUnitMsr  AS SalesUnit,
         T0.InvntryUom  AS InventoryUOM,
         T0.UgpEntry    AS UoMGroupEntry,
         T0.SUoMEntry   AS SalesUomEntry,
         COALESCE(NULLIF(LTRIM(RTRIM(CHP.ChapterID)), ''), NULLIF(LTRIM(RTRIM(T0.SWW)), '')) AS HSNCode,
         T0.CountryOrg  AS ItemCountryOrg,
         T0.SACEntry    AS SACEntry,
         ${gstRelevantSelect}
         T0.VatGourpSa  AS TaxCodeAR,
         ''          AS DistributionRule,
         T0.DfltWH      AS DefaultWarehouse
  FROM   OITM T0
  LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
  WHERE  T0.SellItem = 'Y'
    AND  T0.validFor  <> 'N'
  ORDER  BY T0.ItemCode
`));
};

// Enhanced item list for modal with all details
const getItemsForModal = async (whsCode = '') => {
  const hasWarehouse = String(whsCode || '').trim();
  const gstRelevantSelect = await getOptionalItemGstRelevantSelect();

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
    ${gstRelevantSelect}
    T0.VatGourpSa AS TaxCodeAR,
    '' AS DistributionRule
    --T0.brand AS Brand,
    --T0.U_Origin AS Origin
  FROM OITM T0
 LEFT JOIN OITB T1 ON T0.ItmsGrpCod = T1.ItmsGrpCod 
   LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
   ${hasWarehouse ? 'LEFT JOIN OITW W ON W.ItemCode = T0.ItemCode AND W.WhsCode = @WhsCode' : ''}

 WHERE T0.SellItem = 'Y'
    AND T0.validFor <> 'N'
  ORDER BY T0.ItemCode

 
`, hasWarehouse ? { WhsCode: hasWarehouse } : {}));
};

// Get freight charges for modal
const getFreightCharges = (docEntry) => {
  if (!docEntry) {
    // CREATE MODE
    return safe(db.query(`
      SELECT 
        T0.ExpnsCode,
        T0.ExpnsName,
        T0.DistrbMthd AS DistributionMethod,
        T0.DistrbMthd AS FreightTaxDistributionMethod,
        T0.TaxLiable,
        T0.RevFixSum AS DefaultAmount,
        'O' AS Status
      FROM OEXD T0
      ORDER BY T0.ExpnsName
    `));
  }

  // EDIT MODE
  return safe(db.query(`
    SELECT 
      T0.ExpnsCode,
      T0.ExpnsName,
      T0.DistrbMthd AS DistributionMethod,
      T0.DistrbMthd AS FreightTaxDistributionMethod,
      T0.TaxLiable,
      T0.RevFixSum AS DefaultAmount,
      'O' AS Status,
      ISNULL(T1.LineTotal, 0) AS LineTotal,
      T1.TaxCode,
      ISNULL(T1.VatSum, 0) AS TaxAmount,
      T1.Comments
    FROM OEXD T0
    LEFT JOIN RDR3 T1 
      ON T0.ExpnsCode = T1.ExpnsCode 
     AND T1.DocEntry = @DocEntry
    ORDER BY T0.ExpnsName
  `, { DocEntry: docEntry }));
};

const getWarehouses = () => safe(db.query(`
  SELECT W.WhsCode, W.WhsName, W.Street, W.Block, W.Building,
         W.City, W.County, W.State, W.ZipCode, W.Country, W.BPLid AS BranchID,
         W.Location AS LocationCode, L.Location AS LocationName
  FROM   OWHS W
  LEFT JOIN OLCT L ON L.Code = W.Location
  WHERE  W.Inactive <> 'Y'
  ORDER  BY W.WhsCode
`));

const getLocations = () => safe(db.query(`
  SELECT Code, Location
  FROM   OLCT
  ORDER  BY Location, Code
`));

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

const getShippingTypes = () => safe(db.query(`
  SELECT TrnspCode, TrnspName
  FROM   OSHP
  ORDER  BY TrnspName
`));

const getSalesOrderPrintLayouts = () => safe(db.query(`
  SELECT
    DocCode AS layout_id,
    DocName AS layout_name,
    CASE
      WHEN Category = 'P' THEN 'PLD'
      WHEN Category = 'C' THEN 'Crystal Reports'
      ELSE Category
    END AS layout_type,
    CASE Language
      WHEN 8 THEN 'English (UK)'
      WHEN 3 THEN 'English'
      WHEN 1 THEN 'Default'
      ELSE ''
    END AS language_name,
    TypeCode AS type_code,
    Category AS category_code,
    Language AS language_code,
    Status AS status_code,
    CASE
      WHEN Category = 'C' THEN 1
      ELSE 0
    END AS is_export_supported
  FROM RDOC
  WHERE TypeCode = 'RDR2'
    AND Status = 'A'
  ORDER BY
    CAST(SUBSTRING(DocCode, 4, LEN(DocCode) - 3) AS INT),
    DocCode
`));

const getBranches = () => safe(db.query(`
  SELECT BPLId, BPLName
  FROM   OBPL
  WHERE  ISNULL(Disabled, 'N') <> 'Y'
  ORDER  BY BPLName
`));

const getStates = () => safe(db.query(`
  SELECT Code, Name
  FROM   OCST
  WHERE  Country = 'IN'
  ORDER  BY Name
`));

const getCountries = () => safe(db.query(`
  SELECT Code, Name
  FROM   OCRY
  ORDER  BY Name
`));

const getDistributionRules = async () => {
  const [ruleMetadata, dimensionMetadata] = await Promise.all([
    getTableFieldMetadata('OOCR'),
    getTableFieldMetadata('ODIM'),
  ]);

  const hasDimensionCode = Boolean(ruleMetadata?.DimCode);
  const dimensionCodeExpression = hasDimensionCode ? 'T0.DimCode' : '1';
  const dimensionNameColumn = ['DimDesc', 'DimName', 'Name']
    .find((columnName) => dimensionMetadata?.[columnName]);
  const dimensionJoin = dimensionMetadata?.DimCode
    ? `LEFT JOIN ODIM T1 ON T1.DimCode = ${dimensionCodeExpression}`
    : '';
  const dimensionFallbackExpression = `CONCAT('Dimension ', CAST(${dimensionCodeExpression} AS NVARCHAR(10)))`;
  const dimensionNameExpression = dimensionNameColumn
    ? `COALESCE(T1.${quoteSqlIdentifier(dimensionNameColumn)}, ${dimensionFallbackExpression})`
    : dimensionFallbackExpression;
  const activeDimensionColumn = ['Active', 'DimActive']
    .find((columnName) => dimensionMetadata?.[columnName]);
  const activeDimensionFilter = activeDimensionColumn
    ? `AND (T1.${quoteSqlIdentifier(activeDimensionColumn)} IS NULL OR T1.${quoteSqlIdentifier(activeDimensionColumn)} <> 'N')`
    : '';

  return safe(db.query(`
    SELECT TOP 500
      T0.OcrCode AS FactorCode,
      T0.OcrName AS FactorDescription,
      ${dimensionCodeExpression} AS DimensionCode,
      ${dimensionNameExpression} AS DimensionName
    FROM   OOCR T0
    ${dimensionJoin}
    WHERE  ISNULL(T0.Active, 'Y') <> 'N'
      ${activeDimensionFilter}
    ORDER  BY ${dimensionCodeExpression}, T0.OcrCode
  `));
};
const getTaxCodes = () => masterDataDbService.searchDocumentTaxCodes('', 'sales', 500, 0);

const getCompanyCurrencyInfo = async () => {
  const fields = await getTableFieldMetadata('OADM');
  const optional = ['QtyDec', 'PriceDec', 'SumDec', 'PercentDec', 'RoundMthd']
    .map(name => optionalHeaderColumn(fields, [name], name, 'NULL')).join(', ');
  return safe(db.query(`
    SELECT TOP 1 MainCurncy, SysCurrncy, DirectRate, DsplyRates, RateDec, ${optional}
    FROM OADM T0
  `));
};

const getTaxCodeDiagnostics = async (taxCodes = []) => {
  const normalizedCodes = [...new Set(
    (taxCodes || [])
      .map((code) => String(code || '').trim())
      .filter(Boolean)
  )];

  if (!normalizedCodes.length) {
    return [];
  }

  const params = {};
  const placeholders = normalizedCodes.map((code, index) => {
    const key = `taxCode${index}`;
    params[key] = code;
    return `@${key}`;
  });
  const componentColumns = await getTableColumnDetails('STC1');
  const componentColumnNames = new Set(
    componentColumns.map((column) => String(column.columnName || '').trim().toUpperCase()),
  );
  const effectiveRateExpression = componentColumnNames.has('EFCTIVRATE') ? 'T1.EfctivRate' : 'NULL';
  const rateExpression = componentColumnNames.has('RATE') ? 'T1.Rate' : 'NULL';

  return safe(db.query(`
    SELECT
      T0.Code,
      T0.Name,
      T0.Lock,
      T1.STACode,
      T1.STAType,
      ${effectiveRateExpression} AS EfctivRate,
      ${rateExpression} AS Rate
    FROM OSTC T0
    LEFT JOIN STC1 T1
      ON T0.Code = T1.STCCode
    WHERE T0.Code IN (${placeholders.join(', ')})
    ORDER BY T0.Code, T1.STACode
  `, params));
};

// const getTaxCodes = () => masterDataDbService.searchDocumentTaxCodes('', 'sales', 500, 0);

const getUomGroups = () => loadCompanyUomGroups(db);

const itemUomContextCache = new Map();
const getTableFieldMetadata = createTableFieldMetadataReader({ database: db });
const getTableColumnDetails = createTableColumnDetailsReader({ database: db });

const toSqlIdentifier = (identifier) => `[${String(identifier || '').replace(/]/g, ']]')}]`;

const normalizeDbScalar = (value) => {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return value == null ? '' : String(value);
};

const buildDocumentAddressComponents = (row = {}, prefix = 'ShipTo') => {
  const components = {
    streetPoBox: normalizeDbScalar(row[`${prefix}Street`]),
    streetNo: normalizeDbScalar(row[`${prefix}StreetNo`]),
    buildingFloorRoom: normalizeDbScalar(row[`${prefix}Building`]),
    block: normalizeDbScalar(row[`${prefix}Block`]),
    city: normalizeDbScalar(row[`${prefix}City`]),
    zipCode: normalizeDbScalar(row[`${prefix}ZipCode`]),
    county: normalizeDbScalar(row[`${prefix}County`]),
    state: normalizeDbScalar(row[`${prefix}State`]),
    countryRegion: normalizeDbScalar(row[`${prefix}Country`]),
    addressName2: normalizeDbScalar(row[`${prefix}Address2`]),
    addressName3: normalizeDbScalar(row[`${prefix}Address3`]),
    gln: normalizeDbScalar(row[`${prefix}GlobalLocationNumber`]),
  };

  return Object.values(components).some((value) => String(value || '').trim()) ? components : null;
};

const getPhysicalUdfValues = async ({ tableName, keyColumn = 'DocEntry', keyValue, includeLineNum = false }) => {
  const fieldMetadata = await getTableFieldMetadata(tableName);
  const udfColumns = Object.keys(fieldMetadata).filter((columnName) => columnName.startsWith('U_'));
  if (!udfColumns.length) return includeLineNum ? {} : {};

  const selectColumns = [
    ...(includeLineNum ? ['LineNum'] : []),
    ...udfColumns,
  ].map(toSqlIdentifier).join(', ');

  const rows = await safe(db.query(`
    SELECT ${selectColumns}
    FROM ${toSqlIdentifier(tableName)}
    WHERE ${toSqlIdentifier(keyColumn)} = @keyValue
  `, { keyValue }));

  if (includeLineNum) {
    return rows.reduce((acc, row) => {
      acc[row.LineNum] = udfColumns.reduce((values, columnName) => {
        values[columnName] = normalizeDbScalar(row[columnName]);
        return values;
      }, {});
      return acc;
    }, {});
  }

  const row = rows[0] || {};
  return udfColumns.reduce((values, columnName) => {
    values[columnName] = normalizeDbScalar(row[columnName]);
    return values;
  }, {});
};

const mergeLineUdfValueMaps = (...maps) => maps.reduce((acc, map) => {
  Object.entries(map || {}).forEach(([lineNum, values]) => {
    acc[lineNum] = {
      ...(acc[lineNum] || {}),
      ...(values || {}),
    };
  });

  return acc;
}, {});

const firstNonBlank = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
};

const getUdfValueByAliases = (values = {}, aliases = []) => {
  const entries = Object.entries(values || {});
  for (const alias of aliases) {
    const normalizedAlias = normalizeUdfNameForMatch(alias);
    const match = entries.find(([key]) => normalizeUdfNameForMatch(key) === normalizedAlias);
    if (match && match[1] !== undefined && match[1] !== null && String(match[1]).trim() !== '') {
      return match[1];
    }
  }
  return '';
};

const resolveForRateColumnName = (lineFieldMetadata = {}) => (
  resolveColumnName(lineFieldMetadata, 'U_ForRate') ||
  resolveColumnName(lineFieldMetadata, 'U_FORRATE') ||
  resolveColumnName(lineFieldMetadata, 'U_FOR_RATE') ||
  resolveColumnName(lineFieldMetadata, 'U_For_Rate') ||
  resolveColumnName(lineFieldMetadata, 'U_FORRate') ||
  resolveTableColumnName(lineFieldMetadata, 'Rate') ||
  ''
);

const getSalesOrderLineFieldMetadata = async () => {
  return getTableFieldMetadata('RDR1');
};

const SALES_ORDER_FORM_ID = '139';
const SALES_ORDER_MATRIX_ITEM_ID = '38';

const SALES_ORDER_MATRIX_COLUMN_DEFS = [
  { key: '__lineNumber', label: '#', minWidth: 42, calculated: true, readOnly: true, sapField: 'LineNum', sapColumnIds: ['0', 'LineNum', '#'] },
  { key: 'itemNo', label: 'Item No.', minWidth: 160, sapField: 'ItemCode', sapColumnIds: ['1', 'ItemCode', 'Item No.', 'ItemNo'] },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240, sapField: 'Dscription', sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Description', 'Item Description'] },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 170, sapField: 'U_Seller_Quality', sapColumnIds: ['U_Seller_Quality', 'Seller - Quality'] },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 170, sapField: 'U_Buyer_Quality', sapColumnIds: ['U_Buyer_Quality', 'Buyer - Quality'] },
  { key: 'quantity', label: 'Quantity', minWidth: 85, numeric: true, sapField: 'Quantity', sapColumnIds: ['11', 'Quantity', 'Qty'] },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 110, numeric: true, sapField: 'Price', alternativeFields: ['PriceBefDi'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'UnitPrice', 'Unit Price'] },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 175, sapField: 'CountryOrg', sapColumnIds: ['1003', '10002037', 'CountryOrg', 'Country/Region of Origin'] },
  { key: 'loc', label: 'Loc.', minWidth: 120, readOnly: true, sapField: 'LocCode', sapColumnIds: ['2000002049', '10002047', 'LocCode', 'Loc.'] },
  { key: 'commPercent', label: 'Comm. %', minWidth: 95, numeric: true, sapField: 'Commission', sapColumnIds: ['28', 'Commission', 'CommissionPercent', 'Comm. %'] },
  { key: 'sellerPrice', label: 'Seller - Price', minWidth: 110, numeric: true, sapField: 'U_Seller_Price', sapColumnIds: ['U_Seller_Price', 'Seller - Price'] },
  { key: 'buyerPrice', label: 'Buyer - Price', minWidth: 110, numeric: true, sapField: 'U_Buyer_Price', sapColumnIds: ['U_Buyer_Price', 'Buyer - Price'] },
  { key: 'sellerDelivery', label: 'Seller - Delivery', minWidth: 120, sapField: 'U_Seller_Delivery', sapColumnIds: ['U_Seller_Delivery', 'Seller - Delivery'] },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', minWidth: 120, sapField: 'U_Buyer_Delivery', sapColumnIds: ['U_Buyer_Delivery', 'Buyer - Delivery'] },
  { key: 'sellerBrokerageAmtPer', label: 'Seller Brokerage(Amt./Per)', minWidth: 155, sapField: 'U_Sel_Brok_AP', sapColumnIds: ['U_Sel_Brok_AP', 'Seller Brokerage(Amt./Per)'] },
  { key: 'sellerBrokeragePercent', label: 'Seller Brokerage in Percentage', minWidth: 170, sapField: 'U_Seller_Brok_Per', sapColumnIds: ['U_Seller_Brok_Per', 'Seller Brokerage in Percentage'] },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 120, sapField: 'U_Brok_Seller', sapColumnIds: ['U_Brok_Seller', 'Seller Brokerage'] },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', minWidth: 120, sapField: 'U_Brok_Buyer', sapColumnIds: ['U_Brok_Buyer', 'Buyer Brokerage'] },
  { key: 'qtySpecialInstruction', label: 'Qty Special Instruction', minWidth: 165, sapField: 'U_Seller_SPINS', sapColumnIds: ['U_Seller_SPINS', 'Qty Special Instruction'] },
  { key: 'deliverySpecialInstruction', label: 'Delivery Special Instruction', minWidth: 185, sapField: 'U_Buyer_SPINS', sapColumnIds: ['U_Buyer_SPINS', 'Delivery Special Instruction'] },
  { key: 'buyerBillDiscount', label: 'Buyer Bill Discount', minWidth: 130, sapField: 'U_Buyer_Bill_Disc', sapColumnIds: ['U_Buyer_Bill_Disc', 'Buyer Bill Discount'] },
  { key: 'sellerBillDiscount', label: 'Seller Bill Discount', minWidth: 130, sapField: 'U_Seller_Bill_Disc', sapColumnIds: ['U_Seller_Bill_Disc', 'Seller Bill Discount'] },
  { key: 'deliveredQty', label: 'Delivered Qty', minWidth: 110, calculated: true, readOnly: true, sapColumnIds: ['Delivered Qty', 'DelivrdQty'] },
  { key: 'forRate', label: 'FOR Rate', minWidth: 110, numeric: true, sapField: 'Rate', alternativeFields: ['U_ForRate', 'U_FORRATE', 'U_FOR_RATE', 'U_For_Rate', 'U_FORRate'], sapColumnIds: ['U_ForRate', 'U_FORRATE', 'U_FOR_RATE', 'U_For_Rate', 'Rate', 'FOR Rate', 'FORRATE'] },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 90, numeric: true, sapField: 'DiscPrcnt', sapColumnIds: ['15', 'DiscPrcnt', 'DiscountPercent', 'Disc%', 'Discount %'] },
  { key: 'stcode', label: 'STCODE', minWidth: 110, sapField: 'U_SELLTCODE', sapColumnIds: ['U_SELLTCODE', 'STCODE'] },
  { key: 'taxCode', label: 'Tax Code', minWidth: 110, sapField: 'TaxCode', alternativeFields: ['VatGroup'], sapColumnIds: ['160', '234000377', 'TaxCode', 'VatGroup', 'Tax Code'] },
  { key: 'taxAmount', label: 'Tax Amount (Doc)', minWidth: 125, readOnly: true, numeric: true, sapField: 'VatSum', sapColumnIds: ['83', 'VatSum', 'Tax Amount (Doc)', 'Tax Amount (LC)'] },
  { key: 'totalLC', label: 'Total (LC)', minWidth: 115, readOnly: true, numeric: true, sapField: 'LineTotal', sapColumnIds: ['17', 'LineTotal', 'Total', 'Total (LC)'] },
  { key: 'totalDoc', label: 'Total (Doc)', minWidth: 115, readOnly: true, numeric: true, sapField: 'TotalFrgn', sapColumnIds: ['23', 'TotalFrgn', 'Total (Doc)', 'Total Doc', 'Total (FC)'] },
  { key: 'grossTotal', label: 'Gross Total', minWidth: 120, readOnly: true, numeric: true, sapField: 'GTotal', sapColumnIds: ['GTotal', 'GrossTotal', 'Gross Total'] },
  { key: 'whse', label: 'Whse', minWidth: 85, sapField: 'WhsCode', sapColumnIds: ['24', 'WhsCode', 'WarehouseCode', 'Warehouse', 'Whse'] },
  { key: 'lineDeliveryDate', label: 'Del. Date', minWidth: 125, sapField: 'ShipDate', sapColumnIds: ['25', 'ShipDate', 'Del. Date', 'Delivery Date'] },
  { key: 'lineShippingType', label: 'Shipping Type', minWidth: 125, sapField: 'TrnsCode', alternativeFields: ['ShipType'], sapColumnIds: ['174', 'TrnsCode', 'ShipType', 'Shipping Type'] },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 105, sapField: 'OcrCode', sapColumnIds: ['21', 'OcrCode', 'DistributionRule', 'Distr. Rule'] },
  { key: 'openQty', label: 'Open Qty', minWidth: 85, readOnly: true, numeric: true, sapField: 'OpenQty', sapColumnIds: ['32', 'OpenQty', 'Open Qty'] },
  { key: 'taxLiable', label: 'Tax Liable', minWidth: 95, sapField: 'TaxOnly', sapColumnIds: ['22', 'TaxOnly', 'Tax Liable'] },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 175, sapField: 'CountryOrg', sapColumnIds: ['10002037', 'CountryOrg', 'Country/Region of Origin'] },
  { key: 'freeText', label: 'Free Text', minWidth: 150, sapField: 'FreeTxt', sapColumnIds: ['FreeTxt', 'Free Text'] },
  { key: 'uomName', label: 'UoM Name', minWidth: 120, sapField: 'unitMsr', alternativeFields: [], sapColumnIds: ['1470002145', 'unitMsr', 'UomName', 'UoM Name'] },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105, sapField: 'UomCode', alternativeFields: ['UomEntry'], sapColumnIds: ['1470002149', 'UomCode', 'UoMCode', 'UoM Code'] },
  { key: 'loc', label: 'Loc.', minWidth: 120, readOnly: true, sapField: 'LocCode', alternativeFields: ['WhsCode', 'BPLId'], sapColumnIds: ['10002047', 'LocCode', 'Loc.'] },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 110, sapField: 'U_SPLRBT', sapColumnIds: ['U_SPLRBT', 'Special Rebate'] },
  { key: 'commission', label: 'Commision', minWidth: 100, sapField: 'U_COMPRC', sapColumnIds: ['U_COMPRC', 'Commission', 'Commision'] },
  { key: 'sellerBrokeragePerQty', label: 'BrokPerQty', minWidth: 110, sapField: 'U_S_BrokPerQty', sapColumnIds: ['U_S_BrokPerQty', 'BrokPerQty'] },
  { key: 'hsnCode', label: 'HSN', minWidth: 95, source: 'OITM', sapColumnIds: ['254000391', 'HsnEntry', 'HSN', 'HSN/SAC'] },
  { key: 'sacCode', label: 'SAC', minWidth: 90, sapField: 'SACEntry', sapColumnIds: ['254000393', 'SACEntry', 'SAC'] },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of Payment', minWidth: 170, sapField: 'U_Buyer_Payment_Terms', sapColumnIds: ['U_Buyer_Payment_Terms', 'Buyer - Terms of Payment'] },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', minWidth: 170, sapField: 'U_Seller_Payment_Term', alternativeFields: ['U_Seller_Payment_Terms'], sapColumnIds: ['U_Seller_Payment_Term', 'U_Seller_Payment_Terms', 'Seller - Terms of Payment'] },
  { key: 'sellerItem', label: 'S_Item', minWidth: 125, sapField: 'U_S_Item', sapColumnIds: ['U_S_Item', 'S_Item'] },
  { key: 'sellerQty', label: 'S_Qty', minWidth: 110, numeric: true, sapField: 'U_S_Qty', sapColumnIds: ['U_S_Qty', 'S_Qty'] },
  { key: 'freightPurchase', label: 'Freight Purchase', minWidth: 130, sapField: 'U_Freight_pur', sapColumnIds: ['U_Freight_pur', 'Freight Purchase'] },
  { key: 'freightSales', label: 'Freight Sales', minWidth: 120, sapField: 'U_Freight_sales', sapColumnIds: ['U_Freight_sales', 'Freight Sales'] },
  { key: 'freightProvider', label: 'Freight Provider', minWidth: 120, sapField: 'U_Fr_trans', sapColumnIds: ['U_Fr_trans', 'Freight Provider'] },
  { key: 'freightProviderName', label: 'Freight Provider Name', minWidth: 160, sapField: 'U_Fr_trans_name', sapColumnIds: ['U_Fr_trans_name', 'Freight Provider Name'] },
  { key: 'documentCreated', label: 'Document Created', minWidth: 140, source: 'ORDR', readOnly: true, sapColumnIds: ['U_DocDate', 'Document Created'] },
  { key: 'brokerageNumber', label: 'Brokerage Number', minWidth: 140, sapField: 'U_BDNum', sapColumnIds: ['U_BDNum', 'Brokerage Number'] },
];

const SALES_ORDER_HEADER_FIELD_DEFS = [
  { key: 'vendor', label: 'Buyer Code', sapField: 'CardCode', required: true, lookupSource: 'customers' },
  { key: 'name', label: 'Buyer Name', sapField: 'CardName', readOnly: true },
  { key: 'contactPerson', label: 'Contact Person', sapField: 'CntctCode', lookupSource: 'contacts' },
  { key: 'currency', label: 'Currency', sapField: 'DocCur' },
  { key: 'placeOfSupply', label: 'Place of Supply', sapField: 'U_PlaceOfSupply', lookupSource: 'states', required: false },
  { key: 'paymentTerms', label: 'Payment Terms', sapField: 'GroupNum', lookupSource: 'paymentTerms' },
  { key: 'branch', label: 'Branch', sapField: 'BPLId', alternativeFields: ['BPL_IDAssignedToInvoice'], lookupSource: 'branches', required: true, forceVisible: true },
  { key: 'warehouse', label: 'Warehouse', source: 'RDR1', sapField: 'WhsCode', lookupSource: 'warehouses', required: true, forceVisible: true },
  { key: 'series', label: 'Series', sapField: 'Series', lookupSource: 'series' },
  { key: 'nextNumber', label: 'Number', sapField: 'DocNum', readOnly: true },
  { key: 'customerRefNo', label: 'Customer Ref. No.', sapField: 'NumAtCard' },
  { key: 'status', label: 'Status', sapField: 'DocStatus', readOnly: true },
  { key: 'postingDate', label: 'Posting Date', sapField: 'DocDate', type: 'date', required: true },
  { key: 'deliveryDate', label: 'Delivery Date', sapField: 'DocDueDate', type: 'date' },
  { key: 'documentDate', label: 'Document Date', sapField: 'TaxDate', type: 'date', required: true },
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

const getRichTableColumns = async (tableName) => {
  const normalizedTableName = String(tableName || '').trim();
  if (!normalizedTableName) return {};

  try {
    const columnDetails = await getTableColumnDetails(normalizedTableName);
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
    console.warn('[Sales Order DB] getRichTableColumns failed for', normalizedTableName, error.message);
    return {};
  }
};

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
    // CPRF Form Settings belong to the SAP B1 user. Prefer the explicit
    // user/company mapping, then the signed-in user, over the technical
    // Service Layer account.
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

const getSalesOrderColumnPreferences = async () => {
  // Use the shared dialect-safe reader to check CPRF existence and columns.
  // This works on both SQL Server and HANA without raw INFORMATION_SCHEMA.
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
      AND ItemID = @itemId
      AND UserSign = @userSign
    ORDER BY
      CASE WHEN TPLId = 0 THEN 0 ELSE 1 END,
      VisualIndx,
      ColID
  `, {
    formId: SALES_ORDER_FORM_ID,
    itemId: SALES_ORDER_MATRIX_ITEM_ID,
    userSign,
  }));

  if (!rows.length && hasItemUid) {
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
        TPLId
        ${hasTableName ? ', TableName' : ", '' AS TableName"}
        , ItemUID
        ${hasCaption ? ', Caption' : ", '' AS Caption"}
        ${hasTitle ? ', Title' : ", '' AS Title"}
        ${hasDescr ? ', Descr' : ", '' AS Descr"}
        ${hasColAlias ? ', ColAlias' : ", '' AS ColAlias"}
      FROM CPRF
      WHERE FormID = @formId
        AND ItemUID = @itemId
        AND UserSign = @userSign
      ORDER BY
        CASE WHEN TPLId = 0 THEN 0 ELSE 1 END,
        VisualIndx,
        ColID
    `, {
      formId: SALES_ORDER_FORM_ID,
      itemId: SALES_ORDER_MATRIX_ITEM_ID,
      userSign,
    }));
  }

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
      formId: SALES_ORDER_FORM_ID,
      tableName: 'RDR1',
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

const buildStandardColumnCandidates = (column = {}) => ([
  ...(column.sapColumnIds || []),
  column.label,
  column.sapField,
  ...(column.alternativeFields || []),
  ...(column.additionalPreferenceKeys || []),
  column.key,
]).map(normalizePreferenceKey).filter(Boolean);

const getPreferenceRowMatchKeys = (row = {}) => unique([
  row.Caption,
  row.Title,
  row.Descr,
  row.ColAlias,
  row.ItemUID,
  row.TableName,
  row.ColID,
].map(normalizePreferenceKey).filter(Boolean));

const buildUdfMatchKeys = (field = {}) => unique([
  field.key,
  field.sapField,
  field.aliasId,
  field.label,
  field.description,
  field.Descr,
].map(normalizePreferenceKey).filter(Boolean));

const getColumnMetadata = (column, columns = {}) => {
  const candidates = [
    column.sapField,
    ...(column.alternativeFields || []),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const metadata = columns[String(candidate).toUpperCase()];
    if (metadata) return metadata;
  }

  return null;
};

const buildStandardMatrixColumn = ({
  column = {},
  matchingUdf = null,
  metadata = null,
  order,
  visible = true,
  active = true,
  minWidth,
  sapColumnId = '',
  hasPreference = false,
  sapControlled = false,
} = {}) => ({
  key: column.key,
  label: matchingUdf?.label || column.label,
  sapField: column.sapField || '',
  source: column.source || (column.calculated ? 'calculated' : 'RDR1'),
  dataType: metadata?.dataType || matchingUdf?.dataType || '',
  maxLength: metadata?.maxLength || matchingUdf?.maxLength || undefined,
  precision: metadata?.precision || matchingUdf?.precision || undefined,
  scale: metadata?.scale || matchingUdf?.scale || undefined,
  required: column.key === 'whse' ? true : Boolean(metadata && !metadata.nullable),
  readOnly: Boolean(column.readOnly || column.calculated || matchingUdf?.readOnly),
  visible,
  active,
  minWidth: minWidth || column.minWidth || matchingUdf?.minWidth || 125,
  order,
  sapColumnId,
  sapColumnIds: column.sapColumnIds || [],
  alternativeFields: column.alternativeFields || [],
  numeric: Boolean(column.numeric),
  type: matchingUdf?.type || column.type,
  lookupSource: matchingUdf?.lookupSource,
  lookupTable: matchingUdf?.lookupTable,
  options: matchingUdf?.options || undefined,
  hasPreference,
  additionalPreferenceKeys: matchingUdf
    ? [matchingUdf.key, matchingUdf.aliasId, matchingUdf.label]
    : undefined,
  sapControlled,
  isUdfBacked: Boolean(matchingUdf),
  udfKey: matchingUdf?.key || undefined,
});

const buildStandardMatrixColumns = ({
  lineColumns = {},
  rowUdfDefinitions = [],
} = {}) => {
  const rowUdfBySapField = new Map(
    (rowUdfDefinitions || [])
      .filter((field) => normalizePreferenceKey(field.sapField || field.key))
      .map((field) => [normalizePreferenceKey(field.sapField || field.key), field]),
  );

  return SALES_ORDER_MATRIX_COLUMN_DEFS
    .map((column, index) => {
      const metadata = getColumnMetadata(column, lineColumns);
      const exists = Boolean(metadata || column.calculated || column.source);
      if (!exists) return null;

      const matchingUdf = rowUdfBySapField.get(normalizePreferenceKey(column.sapField));
      return buildStandardMatrixColumn({
        column,
        matchingUdf,
        metadata,
        order: index + 1,
      });
    })
    .filter(Boolean)
    .sort((left, right) => (left.order || 0) - (right.order || 0));
};

const buildSapDrivenUdfMatrixColumn = (field = {}, row = {}) => {
  const width = Number(row?.Width);
  return {
    key: field.key,
    label: field.label || field.key,
    sapField: field.sapField || field.key,
    source: 'RDR1_UDF',
    dataType: field.dataType || '',
    maxLength: field.maxLength || undefined,
    precision: field.precision || undefined,
    scale: field.scale || undefined,
    required: Boolean(field.required),
    readOnly: Boolean(field.readOnly),
    visible: sapFlagToBoolean(row?.VisInForm, field.visible !== false),
    active: sapFlagToBoolean(row?.EditInForm, field.active !== false),
    minWidth: Number.isFinite(width) && width > 0
      ? Math.max(width, field.minWidth || 125)
      : (field.minWidth || 125),
    order: Number.isFinite(Number(row?.VisualIndx))
      ? Number(row.VisualIndx)
      : (field.order || 99999),
    sapColumnId: row?.ColID || field.sapColumnId || '',
    type: field.type,
    options: field.options || undefined,
    lookupSource: field.lookupSource || undefined,
    lookupTable: field.lookupTable || undefined,
    isUdf: true,
    sapControlled: true,
    hasPreference: true,
  };
};

const scorePreferenceMatch = (row = {}, rowKeys = [], candidateKeys = []) => {
  const rowKeySet = new Set(rowKeys);
  const candidateKeySet = new Set(candidateKeys);
  let score = 0;

  const descriptiveKeys = [
    row.Caption,
    row.Title,
    row.Descr,
    row.ColAlias,
  ].map(normalizePreferenceKey).filter(Boolean);

  descriptiveKeys.forEach((key) => {
    if (candidateKeySet.has(key)) score += 100;
  });

  const itemUidKey = normalizePreferenceKey(row.ItemUID);
  if (itemUidKey && candidateKeySet.has(itemUidKey)) score += 50;

  const colIdKey = normalizePreferenceKey(row.ColID);
  if (colIdKey && candidateKeySet.has(colIdKey)) score += 10;

  candidateKeys.forEach((key) => {
    if (rowKeySet.has(key)) score += 1;
  });

  return score;
};

const findMatchedCandidateFromKeys = ({
  row = {},
  keys = [],
  candidatesByKey = new Map(),
  usedKeys = new Set(),
  getCandidateKeys,
} = {}) => {
  const uniqueCandidates = new Map();

  keys.forEach((key) => {
    (candidatesByKey.get(key) || []).forEach((candidate) => {
      if (candidate?.key && !usedKeys.has(candidate.key) && !uniqueCandidates.has(candidate.key)) {
        uniqueCandidates.set(candidate.key, candidate);
      }
    });
  });

  let bestCandidate = null;
  let bestScore = -1;

  uniqueCandidates.forEach((candidate) => {
    const score = scorePreferenceMatch(row, keys, getCandidateKeys(candidate));
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  });

  return bestCandidate;
};

const buildUnifiedSapDrivenMatrixColumns = ({
  standardColumns = [],
  rowUdfDefinitions = [],
  preferenceRows = [],
} = {}) => {
  const standardCandidatesByKey = new Map();
  const rowUdfCandidatesByKey = new Map();

  (standardColumns || []).forEach((column) => {
    buildStandardColumnCandidates(column).forEach((candidateKey) => {
      if (!standardCandidatesByKey.has(candidateKey)) {
        standardCandidatesByKey.set(candidateKey, []);
      }
      standardCandidatesByKey.get(candidateKey).push(column);
    });
  });

  (rowUdfDefinitions || []).forEach((field) => {
    buildUdfMatchKeys(field).forEach((candidateKey) => {
      if (!rowUdfCandidatesByKey.has(candidateKey)) {
        rowUdfCandidatesByKey.set(candidateKey, []);
      }
      rowUdfCandidatesByKey.get(candidateKey).push(field);
    });
  });

  const usedStandardKeys = new Set();
  const usedUdfKeys = new Set();
  const matrixColumns = [];

  (preferenceRows || []).forEach((row) => {
    const rowKeys = getPreferenceRowMatchKeys(row);
    const matchedStandard = findMatchedCandidateFromKeys({
      row,
      keys: rowKeys,
      candidatesByKey: standardCandidatesByKey,
      usedKeys: usedStandardKeys,
      getCandidateKeys: buildStandardColumnCandidates,
    });

    if (matchedStandard) {
      const width = Number(row?.Width);
      matrixColumns.push({
        ...matchedStandard,
        visible: sapFlagToBoolean(row?.VisInForm, matchedStandard.visible !== false),
        active: sapFlagToBoolean(row?.EditInForm, matchedStandard.active !== false),
        minWidth: Number.isFinite(width) && width > 0
          ? Math.max(width, matchedStandard.minWidth || 125)
          : matchedStandard.minWidth,
        order: Number.isFinite(Number(row?.VisualIndx))
          ? Number(row.VisualIndx)
          : matchedStandard.order,
        sapColumnId: row?.ColID || matchedStandard.sapColumnId || '',
        hasPreference: true,
        sapControlled: true,
      });
      usedStandardKeys.add(matchedStandard.key);
      if (matchedStandard.udfKey) usedUdfKeys.add(matchedStandard.udfKey);
      return;
    }

    const matchedUdf = findMatchedCandidateFromKeys({
      row,
      keys: rowKeys,
      candidatesByKey: rowUdfCandidatesByKey,
      usedKeys: usedUdfKeys,
      getCandidateKeys: buildUdfMatchKeys,
    });
    if (matchedUdf) {
      matrixColumns.push(buildSapDrivenUdfMatrixColumn(matchedUdf, row));
      usedUdfKeys.add(matchedUdf.key);
    }
  });

  const seenKeys = new Set();
  return matrixColumns
    .filter((column) => {
      if (!column?.key || seenKeys.has(column.key)) return false;
      seenKeys.add(column.key);
      return true;
    })
    .sort((left, right) => {
      const leftOrder = Number(left.order || 99999);
      const rightOrder = Number(right.order || 99999);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.label || left.key || '').localeCompare(String(right.label || right.key || ''));
    });
};

const getSalesOrderLineUiMetadata = async (rowUdfDefinitions = []) => {
  const [lineColumns, preferencesResult] = await Promise.all([
    getRichTableColumns('RDR1'),
    getSalesOrderColumnPreferences(),
  ]);

  const adjustedRowUdfs = applyLineColumnPreferencesToUdfs(
    { rows: rowUdfDefinitions },
    preferencesResult.rows || [],
    preferencesResult.rows.length,
  ).rows || [];

  const standardColumns = buildStandardMatrixColumns({
    lineColumns,
    rowUdfDefinitions: adjustedRowUdfs,
  });

  const standardColumnsWithPreferences = (standardColumns || []).map((column) => {
    const matchingRow = (preferencesResult.rows || []).find((row) => {
      const rowKeys = new Set(getPreferenceRowMatchKeys(row));
      return buildStandardColumnCandidates(column).some((candidate) => rowKeys.has(candidate));
    });

    if (!matchingRow) return column;

    const width = Number(matchingRow?.Width);
    return {
      ...column,
      visible: sapFlagToBoolean(matchingRow?.VisInForm, column.visible !== false),
      active: sapFlagToBoolean(matchingRow?.EditInForm, column.active !== false),
      minWidth: Number.isFinite(width) && width > 0
        ? Math.max(width, column.minWidth || 125)
        : column.minWidth,
      order: Number.isFinite(Number(matchingRow?.VisualIndx))
        ? Number(matchingRow.VisualIndx)
        : column.order,
      sapColumnId: matchingRow?.ColID || column.sapColumnId || '',
      hasPreference: true,
      sapControlled: preferencesResult.rows.length > 0,
    };
  });

  const matrixColumns = preferencesResult.rows.length > 0
    ? buildUnifiedSapDrivenMatrixColumns({
        standardColumns: standardColumnsWithPreferences,
        rowUdfDefinitions: adjustedRowUdfs,
        preferenceRows: preferencesResult.rows,
      })
    : standardColumnsWithPreferences;

  return {
    matrix_columns: matrixColumns,
    row_udfs: adjustedRowUdfs,
    sap_form: {
      formId: SALES_ORDER_FORM_ID,
      matrixItemId: SALES_ORDER_MATRIX_ITEM_ID,
      userSign: preferencesResult.userSign,
      preferenceRows: preferencesResult.rows.length,
    },
    _preferencesByKey: preferencesResult.byKey,
  };
};

const applyLineColumnPreferencesToUdfs = (udfMetadata = {}, preferenceRowsData = [], preferenceRows = 0) => {
  const rows = (udfMetadata.rows || []).map((field) => {
    const preference = (preferenceRowsData || []).find((row) => {
      const rowKeys = new Set(getPreferenceRowMatchKeys(row));
      return buildUdfMatchKeys(field).some((candidate) => rowKeys.has(candidate));
    });

    if (!preference) {
      return {
        ...field,
        sapControlled: preferenceRows > 0,
      };
    }

    return {
      ...field,
      visible: sapFlagToBoolean(preference.VisInForm, true),
      active: sapFlagToBoolean(preference.EditInForm, true),
      minWidth: Number(preference.Width) > 0 ? Number(preference.Width) : field.minWidth,
      order: Number(preference.VisualIndx) || field.order,
      sapColumnId: preference.ColID || field.sapColumnId,
      sapControlled: preferenceRows > 0,
    };
  }).sort((left, right) => (left.order || 99999) - (right.order || 99999));

  return {
    ...udfMetadata,
    rows,
  };
};

const getSalesOrderHeaderFieldMetadata = async () => {
  const [headerColumns, lineColumns] = await Promise.all([
    getRichTableColumns('ORDR'),
    getRichTableColumns('RDR1'),
  ]);

  const fields = SALES_ORDER_HEADER_FIELD_DEFS
    .map((field, index) => {
      const sourceColumns = field.source === 'RDR1' ? lineColumns : headerColumns;
      const metadata = getColumnMetadata(field, sourceColumns);
      const exists = Boolean(metadata || field.forceVisible || field.readOnly);
      if (!exists) return null;

      return {
        key: field.key,
        label: field.label,
        sapField: field.sapField || '',
        source: field.source || 'ORDR',
        dataType: metadata?.dataType || '',
        maxLength: metadata?.maxLength || undefined,
        precision: metadata?.precision || undefined,
        scale: metadata?.scale || undefined,
        visible: field.forceVisible ? true : true,
        active: !field.readOnly,
        required: Boolean(field.required || (metadata && !metadata.nullable)),
        readOnly: Boolean(field.readOnly),
        type: field.type || (metadata?.dataType && metadata.dataType.includes('date') ? 'date' : 'text'),
        lookupSource: field.lookupSource || undefined,
        lookupTable: field.lookupTable || undefined,
        order: index + 1,
        forceVisible: Boolean(field.forceVisible),
      };
    })
    .filter(Boolean);

  return { fields };
};

const STANDARD_LOOKUP_SOURCES = {
  customers: { label: 'Customers', dataKey: 'customers' },
  contacts: { label: 'Contact Persons', dataKey: 'contacts' },
  states: { label: 'States', dataKey: 'states' },
  paymentTerms: { label: 'Payment Terms', dataKey: 'payment_terms' },
  branches: { label: 'Branches', dataKey: 'branches' },
  warehouses: { label: 'Warehouses', dataKey: 'warehouses' },
  series: { label: 'Series', dataKey: 'series' },
  items: { label: 'Items', dataKey: 'items' },
  taxCodes: { label: 'Tax Codes', dataKey: 'tax_codes' },
  hsnCodes: { label: 'HSN Codes', dataKey: 'hsn_codes' },
  sacCodes: { label: 'SAC Codes', dataKey: 'sac_codes' },
  uomGroups: { label: 'UoM Groups', dataKey: 'uom_groups' },
  distributionRules: { label: 'Distribution Rules', dataKey: 'distribution_rules' },
  countries: { label: 'Countries', dataKey: 'countries' },
  salesEmployees: { label: 'Sales Employees', dataKey: 'sales_employees' },
  owners: { label: 'Owners', dataKey: 'owners' },
};

const buildLookupSources = (udfMetadata = {}) => {
  const sources = { ...STANDARD_LOOKUP_SOURCES };

  [...(udfMetadata.header || []), ...(udfMetadata.rows || [])].forEach((field) => {
    if (!field.lookupSource || !field.lookupTable) return;
    sources[field.lookupSource] = {
      label: field.label || field.key,
      table: field.lookupTable,
      tableId: field.tableId,
      fieldKey: field.key,
      type: 'udfLinkedTable',
    };
  });

  return sources;
};

const parseUdfLookupSource = (source) => {
  const match = String(source || '').match(/^udf:([A-Za-z0-9_@]+):(U_[A-Za-z0-9_]+)$/i);
  if (!match) return null;
  return {
    tableId: match[1],
    fieldKey: match[2],
  };
};

const sanitizeSapTableName = (tableName) => {
  const normalized = String(tableName || '').trim();
  if (!/^[A-Za-z0-9_@]+$/.test(normalized)) return '';
  return normalized;
};

const findColumnName = (columns = {}, candidates = []) => {
  for (const candidate of candidates) {
    const metadata = columns[String(candidate || '').trim().toUpperCase()];
    if (metadata?.name) return metadata.name;
  }
  return '';
};

const getUdfLinkedTableLookupOptions = async (source, query = '', limit = 50) => {
  const parsed = parseUdfLookupSource(source);
  if (!parsed || !['ORDR', 'RDR1'].includes(parsed.tableId.toUpperCase())) {
    return { options: [] };
  }

  const definitions = await getUdfDefinitions(parsed.tableId);
  const field = definitions.find((definition) =>
    String(definition.key || '').toUpperCase() === parsed.fieldKey.toUpperCase()
  );
  const lookupTable = sanitizeSapTableName(field?.lookupTable);
  if (!field || !lookupTable) return { options: [] };

  const columns = await getRichTableColumns(lookupTable);
  if (!Object.keys(columns).length) return { options: [] };

  const codeColumn = findColumnName(columns, [
    'Code', 'AbsEntry', 'DocEntry', 'ItemCode', 'CardCode', 'WhsCode', 'BPLId', 'U_Code',
  ]);
  const labelColumn = findColumnName(columns, [
    'Name', 'Descr', 'Description', 'ItemName', 'CardName', 'WhsName', 'BPLName', 'U_Name',
  ]) || codeColumn;
  if (!codeColumn) return { options: [] };

  const top = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const normalizedQuery = String(query || '').trim();
  const whereSql = normalizedQuery
    ? `WHERE CAST(${quoteSqlIdentifier(codeColumn)} AS NVARCHAR(254)) LIKE @query ${LIKE_ESCAPE_SQL}
        OR CAST(${quoteSqlIdentifier(labelColumn)} AS NVARCHAR(254)) LIKE @query ${LIKE_ESCAPE_SQL}`
    : '';

  const rows = await safe(db.query(`
    SELECT TOP (@top)
      CAST(${quoteSqlIdentifier(codeColumn)} AS NVARCHAR(254)) AS value,
      CAST(${quoteSqlIdentifier(labelColumn)} AS NVARCHAR(254)) AS label
    FROM ${quoteSqlIdentifier(lookupTable)}
    ${whereSql}
    ORDER BY ${quoteSqlIdentifier(labelColumn)}, ${quoteSqlIdentifier(codeColumn)}
  `, {
    top,
    query: `%${escapeLike(normalizedQuery)}%`,
  }));

  return {
    source,
    table: lookupTable,
    options: rows
      .map((row) => ({
        value: String(row.value || '').trim(),
        label: String(row.label || row.value || '').trim(),
      }))
      .filter((option) => option.value),
  };
};

const getSacLookupSqlParts = (lineAlias, sacAlias, sacFieldMetadata = {}, lineFieldMetadata = {}) => {
  const sacEntryColumn = resolveTableColumnName(lineFieldMetadata, 'SACEntry');
  const sacAbsEntryColumn = resolveTableColumnName(sacFieldMetadata, 'AbsEntry');
  const serviceNameColumnName = resolveTableColumnName(sacFieldMetadata, 'ServName')
    || resolveTableColumnName(sacFieldMetadata, 'ServiceName');
  const serviceCodeColumnName = resolveTableColumnName(sacFieldMetadata, 'ServCode')
    || resolveTableColumnName(sacFieldMetadata, 'ServiceCode');
  const canJoin = Boolean(sacEntryColumn && sacAbsEntryColumn);
  const serviceNameColumn = canJoin && serviceNameColumnName
    ? `${sacAlias}.${quoteSqlIdentifier(serviceNameColumnName)}`
    : "''";
  const serviceCodeColumn = canJoin && serviceCodeColumnName
    ? `${sacAlias}.${quoteSqlIdentifier(serviceCodeColumnName)}`
    : "''";
  const sacEntryExpression = sacEntryColumn
    ? `CAST(${lineAlias}.${quoteSqlIdentifier(sacEntryColumn)} AS NVARCHAR(50))`
    : "''";

  return {
    joinSql: canJoin
      ? `LEFT JOIN OSAC ${sacAlias} ON ${sacAlias}.${quoteSqlIdentifier(sacAbsEntryColumn)} = ${lineAlias}.${quoteSqlIdentifier(sacEntryColumn)}`
      : '',
    serviceNameColumn,
    serviceCodeColumn,
    displayExpression: `COALESCE(NULLIF(LTRIM(RTRIM(${serviceNameColumn})), ''), NULLIF(LTRIM(RTRIM(${serviceCodeColumn})), ''), ${sacEntryExpression})`,
  };
};

const getItemUomContext = async (itemCode) => {
  const normalizedItemCode = String(itemCode || '').trim();
  if (!normalizedItemCode) return null;

  const scope = await resolveDatabaseScope(db);
  const cacheKey = `${scope.cacheKey}:${normalizedItemCode.toUpperCase()}`;

  if (!itemUomContextCache.has(cacheKey)) {
    const pending = db.query(`
      SELECT TOP 1
        T0.ItemCode,
        T0.UgpEntry,
        T0.SUoMEntry,
        T0.IUoMEntry,
        T0.SalUnitMsr,
        T0.InvntryUom,
        SU.UomCode AS SalesUomCode,
        IU.UomCode AS InventoryUomCode
      FROM OITM T0
      LEFT JOIN OUOM SU ON SU.UomEntry = T0.SUoMEntry
      LEFT JOIN OUOM IU ON IU.UomEntry = T0.IUoMEntry
      WHERE T0.ItemCode = @itemCode
    `, { itemCode: normalizedItemCode })
      .then(normalizeRecordset)
      .then((rows) => rows[0] || null);
    itemUomContextCache.set(cacheKey, pending);
    pending.catch(() => {
      if (itemUomContextCache.get(cacheKey) === pending) itemUomContextCache.delete(cacheKey);
    });
  }

  return itemUomContextCache.get(cacheKey);
};

const resolveSalesOrderLineUomEntry = async (itemCode, uomValue, options = {}) => {
  const item = await getItemUomContext(itemCode);
  const allowDefaultFallback = options.allowDefaultFallback !== false;
  if (!item) return null;

  const rawValue = uomValue == null ? '' : String(uomValue).trim();
  const requestedUomEntry = Number(rawValue);
  const requestedUomCode = rawValue.toUpperCase();
  const isManualUomPlaceholder = requestedUomCode === 'MANUAL';
  const ugpEntry = Number(item.UgpEntry);
  const salesUomEntry = Number(item.SUoMEntry);
  const inventoryUomEntry = Number(item.IUoMEntry);

  const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

  // SAP B1's embedded Manual UoM group does not use an OUOM entry for the
  // document line. The UoM name is stored directly as MeasureUnit instead.
  if (!isPositiveInteger(ugpEntry)) return null;

  if (isPositiveInteger(requestedUomEntry)) {
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
    return rows[0]?.UomEntry != null ? Number(rows[0].UomEntry) : null;
  }

  if (requestedUomCode && !isManualUomPlaceholder) {
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

      if (rows[0]?.UomEntry != null) {
        return Number(rows[0].UomEntry);
      }

      return null;
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

  if (!allowDefaultFallback) return null;

  if (isPositiveInteger(salesUomEntry)) {
    return salesUomEntry;
  }

  if (isPositiveInteger(inventoryUomEntry)) {
    return inventoryUomEntry;
  }

  return null;
};

const getSalesEmployees = () => safe(db.query(`
  SELECT SlpCode, SlpName, Memo, Commission, Active
  FROM   OSLP
  WHERE  Active = 'Y'
  ORDER  BY SlpName
`));

const getOwners = () => safe(db.query(`
  SELECT empID, firstName, lastName, 
         CONCAT(CONCAT(COALESCE(firstName, ''), ' '), COALESCE(lastName, '')) AS FullName
  FROM   OHEM
  ORDER  BY firstName, lastName
`));

const LOOKUP_UDF_CONFIG = {
  U_Buyer_Quality: {
    tableId: 'RDR1',
    aliasId: 'Buyer_Quality',
    columnName: 'U_Buyer_Quality',
  },
  U_Seller_Quality: {
    tableId: 'RDR1',
    aliasId: 'Seller_Quality',
    columnName: 'U_Seller_Quality',
  },
  U_Buyer_Price: {
    tableId: 'RDR1',
    aliasId: 'Buyer_Price',
    columnName: 'U_Buyer_Price',
  },
  U_Seller_Price: {
    tableId: 'RDR1',
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
  const columnName = resolveTableColumnName(fieldMetadata, config.columnName);
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

  const [validValues, existingValues] = await Promise.all([
    getUdfValidValues(config.tableId, normalizedAlias),
    getExistingLookupValues(normalizedAlias),
  ]);

  return mapLookupRows([...validValues, ...existingValues]);
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

// ── Document Series ───────────────────────────────────────────────────────────

const getDocumentSeries = async (targetDate = null, { branch = '' } = {}) => {
  return getMarketingDocumentSeries({
    db,
    objectCode: '17',
    targetDate,
    branch,
    collapseToSapVisible: true,
  });
};

const getNextNumber = async (series) => {
  const result = await safe(db.query(`
    SELECT T0.NextNumber
    FROM NNM1 T0
    WHERE T0.ObjectCode = '17'
      AND T0.Series = @series
      AND T0.Locked = 'N'
  `, { series }));
  
  if (result.length === 0) {
    throw new Error('Series not found or locked');
  }
  
  return {
    nextNumber: result[0].NextNumber,
  };
};
const getContactsByCustomer = async (cardCode) => {
  const result = await safe(db.query(`
    SELECT 
      CntctCode,
      Name,
      FirstName,
      LastName,
      E_MailL AS E_Mail,
      Cellolar AS MobilePhone,   -- ✅ FIXED
      Tel1 AS Phone1,
      CardCode
    FROM OCPR
    WHERE UPPER(LTRIM(RTRIM(CardCode))) = UPPER(LTRIM(RTRIM(@cardCode)))
    ORDER BY Name
  `, { cardCode }));

  return result;
};
const getAddressesByCustomer = async (cardCode) => {
  const { addresses } = await loadBusinessPartnerAddresses(db, cardCode, { context: 'Sales Order' });
  return addresses;
};

const getStateFromAddress = async (cardCode, addressCode) => {
  if (!cardCode || !addressCode) {
    return { state: '' };
  }
  
  const result = await safe(db.query(`
    SELECT State
    FROM   CRD1
    WHERE  CardCode = @cardCode
      AND  Address = @addressCode
  `, { cardCode, addressCode }));
  
  return {
    state: result.length > 0 ? result[0].State || '' : '',
  };
};

// ── aggregators ───────────────────────────────────────────────────────────────

const normalizeCurrencyRows = (...rowGroups) => {
  const currenciesByCode = new Map();
  rowGroups.flat().forEach((row = {}) => {
    const code = String(row.CurrCode || row.Currency || row.Code || '').trim();
    if (!code || code === '##') return;
    const name = String(row.CurrName || row.CurrencyName || row.Name || code).trim() || code;
    const existing = currenciesByCode.get(code);
    if (!existing || existing.CurrName === existing.CurrCode) {
      currenciesByCode.set(code, { ...existing, ...row, CurrCode: code, CurrName: name });
    }
  });
  return [...currenciesByCode.values()].sort((left, right) => left.CurrCode.localeCompare(right.CurrCode));
};

const getCurrencies = async () => {
  const fields = await getTableFieldMetadata('OCRN');
  const roundingColumns = ['RoundSys', 'Decimals'].map(name => optionalHeaderColumn(fields, [name], name, 'NULL')).join(', ');
  const [setupCurrencies, rateCurrencies, bpCurrencies] = await Promise.all([
    safe(db.query(`
      SELECT
        CurrCode,
        CurrName, ${roundingColumns}
      FROM OCRN T0
      WHERE CurrCode IS NOT NULL
        AND CurrCode <> ''
      ORDER BY CurrCode
    `)),
    safe(db.query(`
      SELECT DISTINCT
        Currency AS CurrCode,
        Currency AS CurrName
      FROM ORTT
      WHERE Currency IS NOT NULL
        AND Currency <> ''
    `)),
    safe(db.query(`
      SELECT DISTINCT
        Currency AS CurrCode,
        Currency AS CurrName
      FROM OCRD
      WHERE Currency IS NOT NULL
        AND Currency <> ''
        AND Currency <> '##'
    `)),
  ]);

  return normalizeCurrencyRows(setupCurrencies, rateCurrencies, bpCurrencies);
};

const getExchangeRateRows = async ({ year, month }) => {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  if (!Number.isInteger(normalizedYear) || normalizedYear < 1900 || normalizedYear > 9999) return [];
  if (!Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) return [];

  const dateFrom = `${normalizedYear}-${String(normalizedMonth).padStart(2, '0')}-01`;
  const nextYear = normalizedMonth === 12 ? normalizedYear + 1 : normalizedYear;
  const nextMonth = normalizedMonth === 12 ? 1 : normalizedMonth + 1;
  const dateTo = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  return safe(db.query(`
    SELECT
      Currency,
      RateDate,
      Rate
    FROM ORTT
    WHERE RateDate >= @dateFrom
      AND RateDate < @dateTo
    ORDER BY RateDate, Currency
  `, { dateFrom, dateTo }));
};

const getReferenceData = async () => {
  const [
    customers, items, warehouses, locations, paymentTerms, paymentMethods,
    shippingTypes, branches, states, countries, distributionRules, taxCodes, sacCodes, uomRaw, salesEmployees, owners,
    buyerQualityOptions, sellerQualityOptions, buyerPriceOptions, sellerPriceOptions, udfMetadata,
    headerFieldMetadata,
    companyCurrencyRows,
    currencyRows,
  ] = await Promise.all([
    getCustomers(), getItems(), getWarehouses(), getLocations(), getPaymentTerms(), getPaymentMethods(),
    getShippingTypes(), getBranches(), getStates(), getCountries(), getDistributionRules(), getTaxCodes(), hsnCodeDbService.getSACCodes('', 5000, 0), getUomGroups(), getSalesEmployees(), getOwners(),
    getLookupValues('U_Buyer_Quality'),
    getLookupValues('U_Seller_Quality'),
    getLookupValues('U_Buyer_Price'),
    getLookupValues('U_Seller_Price'),
    getMarketingDocumentUdfs({ headerTable: 'ORDR', lineTable: 'RDR1' }),
    getSalesOrderHeaderFieldMetadata(),
    getCompanyCurrencyInfo(),
    getCurrencies(),
  ]);
  const companyCurrencyInfo = companyCurrencyRows[0] || {};
  const lineFieldMetadata = await getSalesOrderLineUiMetadata(udfMetadata.rows || []);
  const branchesEnabled = (branches || []).length > 0;
  const effectiveHeaderFieldMetadata = {
    ...(headerFieldMetadata || { fields: [] }),
    fields: (headerFieldMetadata?.fields || []).map((field) => (
      field.key === 'branch'
        ? {
            ...field,
            visible: branchesEnabled,
            active: branchesEnabled,
            required: branchesEnabled,
            forceVisible: branchesEnabled,
          }
        : field
    )),
  };
  const effectiveUdfMetadata = {
    ...(udfMetadata || {}),
    rows: lineFieldMetadata.row_udfs || [],
  };

  const uom_groups = uomRaw;
  const distributionDimensionMap = new Map();
  distributionRules.forEach((rule) => {
    const dimensionCode = String(rule.DimensionCode || '1').trim() || '1';
    if (!distributionDimensionMap.has(dimensionCode)) {
      distributionDimensionMap.set(dimensionCode, {
        DimensionCode: dimensionCode,
        DimensionName: rule.DimensionName || `Dimension ${dimensionCode}`,
      });
    }
  });
  const distributionDimensions = [...distributionDimensionMap.values()]
    .sort((a, b) => Number(a.DimensionCode) - Number(b.DimensionCode));

  const mappedCustomers = customers.map(c => ({
    CardCode:        c.CardCode,
    CardName:        c.CardName,
    CardType:        c.CardType,
    Currency:        c.Currency,
    VatGroup:        c.VatGroup,
    PayTermsGrpCode: c.GroupNum,
    PaymentMethod:   c.PymCode || '',
    Balance:         c.Balance,
    CurrentAccountBalance: c.Balance,
    FrozenFor:       c.frozenFor,
  }));

  const mappedWarehouses = warehouses.map(w => ({
    WhsCode: w.WhsCode, WhsName: w.WhsName,
    Street: w.Street, Block: w.Block, Building: w.Building,
    City: w.City, County: w.County, State: w.State,
    ZipCode: w.ZipCode, Country: w.Country, BranchID: w.BranchID,
    LocationCode: w.LocationCode != null ? String(w.LocationCode) : '',
    LocationName: w.LocationName || '',
  }));

  return {
    customers:           mappedCustomers,
    vendors:             mappedCustomers,
    local_currency:      companyCurrencyInfo.MainCurncy || '',
    system_currency:     companyCurrencyInfo.SysCurrncy || companyCurrencyInfo.MainCurncy || '',
    exchange_rate_settings: {
      postingMethod: String(companyCurrencyInfo.DirectRate || 'Y').toUpperCase() === 'N'
        ? 'indirect'
        : 'direct',
      decimalPlaces: Number.isInteger(Number(companyCurrencyInfo.RateDec))
        ? Number(companyCurrencyInfo.RateDec)
        : 6,
    },
    currencies:          currencyRows.map((currency) => ({
      CurrCode: currency.CurrCode || '',
      CurrName: currency.CurrName || currency.CurrCode || '',
    })).filter((currency) => currency.CurrCode),
    items: items.map(i => ({
      ItemCode:      i.ItemCode,
      ItemName:      i.ItemName,
      SalesUnit:     i.SalesUnit,
      InventoryUOM:  i.InventoryUOM,
      UoMGroupEntry: i.UoMGroupEntry,
      HSNCode:       i.HSNCode || '',
      SWW:           i.HSNCode || '',
      ItemCountryOrg:i.ItemCountryOrg || '',
      SACEntry:      i.SACEntry != null ? String(i.SACEntry) : '',
      TaxCodeAR:     i.TaxCodeAR || '',
      DistributionRule: i.DistributionRule || '',
      DefaultWarehouse: i.DefaultWarehouse || '',
    })),
    warehouses:          mappedWarehouses,
    warehouse_addresses: mappedWarehouses,
    locations:           locations.map(location => ({
      Code: location.Code != null ? String(location.Code) : '',
      Location: location.Location || '',
    })).filter(location => location.Code),
    payment_terms:  paymentTerms.map(t => ({ GroupNum: t.GroupNum, PymntGroup: t.PymntGroup })),
    payment_methods: paymentMethods.map(method => ({
      Code: method.Code || '',
      Description: method.Description || method.Code || '',
    })).filter(method => method.Code),
    shipping_types: shippingTypes.map(s => ({ TrnspCode: s.TrnspCode, TrnspName: s.TrnspName })),
    branches:       branches.map(b => ({ BPLId: b.BPLId, BPLName: b.BPLName })),
    branches_enabled: branchesEnabled,
    states:         states.map(st => ({ Code: st.Code, Name: st.Name })),
    countries:      countries.map(country => ({ Code: country.Code, Name: country.Name })),
    distribution_rules: distributionRules.map(rule => ({
      FactorCode: rule.FactorCode || '',
      FactorDescription: rule.FactorDescription || '',
      DimensionCode: rule.DimensionCode != null ? String(rule.DimensionCode) : '1',
      DimensionName: rule.DimensionName || '',
    })),
    distribution_dimensions: distributionDimensions,
    tax_codes:      taxCodes.map(t => ({ Code: t.Code, Name: t.Name, Rate: t.Rate, GSTType: t.GSTType })),
    sac_codes:      sacCodes.map(s => ({
      absEntry: s.absEntry ?? s.AbsEntry ?? null,
      serviceCode: s.serviceCode || s.code || s.ServiceCode || s.ServCode || '',
      serviceName: s.serviceName || s.description || s.ServiceName || s.ServName || '',
    })),
    uom_groups,
    sales_employees: salesEmployees.map(e => ({ SlpCode: e.SlpCode, SlpName: e.SlpName })),
    owners:         owners.map(o => ({ empID: o.empID, firstName: o.firstName, lastName: o.lastName, FullName: o.FullName })),
    quality_options: {
      buyer: buyerQualityOptions,
      seller: sellerQualityOptions,
    },
    price_options: {
      buyer: buyerPriceOptions,
      seller: sellerPriceOptions,
    },
    contacts:           [],
    pay_to_addresses:   [],
    company_address:    {},
    decimal_settings:   { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: Number(companyCurrencyInfo.RateDec) || 2, PercentDec: 2 },
    matrix_columns:     lineFieldMetadata.matrix_columns || [],
    header_field_metadata: effectiveHeaderFieldMetadata,
    line_field_metadata: {
      matrix_columns: lineFieldMetadata.matrix_columns || [],
      sap_form: lineFieldMetadata.sap_form || {},
    },
    udf_metadata:       effectiveUdfMetadata,
    lookup_sources:     buildLookupSources(effectiveUdfMetadata),
    warnings:           [],
  };
};

const getCustomerDetails = async (cardCode) => {
  const normalizedCardCode = String(cardCode || '').trim();
  if (!normalizedCardCode) {
    return {
      contacts: [],
      bill_to_addresses: [],
      pay_to_addresses: [],
      ship_to_addresses: [],
    };
  }

  const [contacts, addresses] = await Promise.all([
    getContactsByCustomer(normalizedCardCode),
    getAddressesByCustomer(normalizedCardCode),
  ]);

  const { billTo, shipTo } = splitBusinessPartnerAddresses(addresses, normalizedCardCode);

  return {
    contacts: contacts.map(c => ({
      CardCode:    String(c.CardCode || normalizedCardCode).trim(),
      CntctCode:   c.CntctCode,
      Name:        c.Name || `${c.FirstName || ''} ${c.LastName || ''}`.trim(),
      FirstName:   c.FirstName,
      LastName:    c.LastName,
      E_Mail:      c.E_Mail,
      MobilePhone: c.MobilePhone,
      Phone1:      c.Phone1,
    })),
    bill_to_addresses: billTo,
    pay_to_addresses:  billTo,
    ship_to_addresses: shipTo,
  };
};

const getItemDetails = async (itemCode) => {
  const gstRelevantSelect = await getOptionalItemGstRelevantSelect();
  const rows = await safe(db.query(`
    SELECT T0.ItemCode, T0.ItemName,
           T0.SalUnitMsr AS SalesUnit,
           T0.InvntryUom AS InventoryUOM,
           T0.UgpEntry   AS UgpEntry,
           T0.UgpEntry   AS UoMGroupEntry,
           T0.SUoMEntry  AS SalesUomEntry,
           T0.IUoMEntry  AS InventoryUomEntry,
           COALESCE(NULLIF(LTRIM(RTRIM(CHP.ChapterID)), ''), NULLIF(LTRIM(RTRIM(T0.SWW)), '')) AS HSNCode,
           T0.CountryOrg AS ItemCountryOrg,
           T0.SACEntry   AS SACEntry,
           ${gstRelevantSelect}
           T0.VatGourpSa AS TaxCodeAR,
           ''         AS DistributionRule,
           T0.DfltWH     AS DefaultWarehouse
    FROM   OITM T0
    LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
    WHERE  T0.ItemCode = @itemCode
  `, { itemCode }));
  const item = rows[0];
  if (!item) return null;
  return {
    ItemCode:      item.ItemCode,
    ItemName:      item.ItemName,
    SalesUnit:     item.SalesUnit,
    InventoryUOM:  item.InventoryUOM,
    UgpEntry:      item.UgpEntry,
    UoMGroupEntry: item.UoMGroupEntry,
    InventoryUomEntry: item.InventoryUomEntry,
    HSNCode:       item.HSNCode || '',
    SWW:           item.HSNCode || '',
    ItemCountryOrg:item.ItemCountryOrg || '',
    SACEntry:      item.SACEntry != null ? String(item.SACEntry) : '',
    GSTRelevnt:    item.GSTRelevnt || '',
    TaxCodeAR:     item.TaxCodeAR || '',
    DistributionRule: item.DistributionRule || '',
    DefaultWarehouse: item.DefaultWarehouse || '',
  };
};

// ── sales order list ──────────────────────────────────────────────────────────

const getSalesOrderList = async ({
  query = '',
  openOnly = true,
  docNum = '',
  customerRefNo = '',
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
  const sellerExpressions = await getSalesOrderSellerExpressions();
  const {
    codeExpression: salesOrderSellerCodeExpression,
    nameExpression: salesOrderSellerNameExpression,
  } = sellerExpressions;
  const { whereClauses, params } = buildSalesOrderListFilterQuery({
    query,
    openOnly,
    docNum,
    customerRefNo,
    customerCode,
    customerName,
    sellerCode,
    sellerName,
    status,
    postingDateFrom,
    postingDateTo,
  }, { sellerExpressions });

  const countResult = await safe(db.query(`
    SELECT COUNT(*) AS total_count
    FROM   ORDR T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    WHERE  ${whereClauses.join('\n      AND ')}
  `, params));

  const totalCount = Number(countResult?.[0]?.total_count || countResult?.[0]?.TOTAL_COUNT || 0);

  const orders = await safe(db.query(`
    SELECT
           T0.DocEntry,
           T0.DocNum,
           T0.NumAtCard,
           T0.CardCode,
           T0.CardName,
           ${salesOrderSellerCodeExpression} AS SellerCode,
           ${salesOrderSellerNameExpression} AS SellerName,
           T0.DocDate,
           T0.DocDueDate,
           T0.DocStatus,
           T0.DocTotal,
           T0.DocCur,
           (
             SELECT COUNT(*)
             FROM   RDR1 T1
             WHERE  T1.DocEntry = T0.DocEntry
           ) AS line_count
    FROM   ORDR T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    WHERE  ${whereClauses.join('\n      AND ')}
    ORDER  BY T0.DocEntry DESC
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { ...params, skip, top: normalizedPageSize }));

  return {
    orders: orders.map(o => ({
      doc_entry: o.DocEntry,
      doc_num: o.DocNum,
      customer_ref_no: o.NumAtCard || '',
      customer_code: o.CardCode,
      customer_name: o.CardName,
      seller_code: o.SellerCode || '',
      seller_name: o.SellerName || '',
      posting_date: o.DocDate ? o.DocDate.toISOString().split('T')[0] : '',
      delivery_date: o.DocDueDate ? o.DocDueDate.toISOString().split('T')[0] : '',
      status: o.DocStatus === 'O' ? 'Open' : o.DocStatus === 'C' ? 'Closed' : 'Unknown',
      line_count: Number(o.line_count || 0),
      total_amount: Number(o.DocTotal || 0),
      currency: o.DocCur || '',
    })),
    pagination: {
      page: normalizedPage,
      pageSize: normalizedPageSize,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / normalizedPageSize)),
    },
  };
};

const getSalesOrderFilterOptions = async ({
  field = '',
  query = '',
  openOnly = true,
  docNum = '',
  customerRefNo = '',
  customerCode = '',
  customerName = '',
  sellerCode = '',
  sellerName = '',
  status = '',
  postingDateFrom = '',
  postingDateTo = '',
  top = 50,
} = {}) => {
  const normalizedField = String(field || '').trim();
  const normalizedQuery = String(query || '').trim();
  const normalizedTop = normalizeTopLimit(top);

  if (normalizedField === 'customerCode' || normalizedField === 'customerName') {
    const customerWhereClauses = [
      "CardType = 'C'",
      `(@lookupQuery = '' OR CardCode LIKE @lookupLike ${LIKE_ESCAPE_SQL} OR CardName LIKE @lookupLike ${LIKE_ESCAPE_SQL})`,
    ];
    const customerParams = {
      lookupQuery: normalizedQuery,
      lookupLike: `%${escapeLike(normalizedQuery)}%`,
    };
    const topClause = normalizedTop ? 'TOP (@top)' : '';

    if (normalizedTop) {
      customerParams.top = normalizedTop;
    }

    const normalizedCustomerCode = String(customerCode || '').trim();
    const normalizedCustomerName = String(customerName || '').trim();

    if (normalizedCustomerCode && normalizedField !== 'customerCode') {
      customerWhereClauses.push(`CardCode LIKE @customerCode ${LIKE_ESCAPE_SQL}`);
      customerParams.customerCode = `%${escapeLike(normalizedCustomerCode)}%`;
    }

    if (normalizedCustomerName && normalizedField !== 'customerName') {
      customerWhereClauses.push(`CardName LIKE @customerName ${LIKE_ESCAPE_SQL}`);
      customerParams.customerName = `%${escapeLike(normalizedCustomerName)}%`;
    }

    const customerRows = await safe(db.query(`
      SELECT ${topClause}
        *
      FROM OCRD
      WHERE ${customerWhereClauses.join('\n        AND ')}
      ORDER BY ${normalizedField === 'customerCode' ? 'CardCode' : 'CardName'}, CardCode
    `, customerParams));

    return {
      options: customerRows.map((row) => ({
        code: normalizedField === 'customerCode'
          ? String(row.CardCode || '').trim()
          : String(row.CardName || '').trim(),
        name: normalizedField === 'customerCode'
          ? String(row.CardName || '').trim()
          : String(row.CardCode || '').trim(),
      })).filter((option) => option.code),
    };
  }

  const sellerExpressions = await getSalesOrderSellerExpressions();
  const {
    codeExpression: salesOrderSellerCodeExpression,
    nameExpression: salesOrderSellerNameExpression,
  } = sellerExpressions;

  const fieldConfig = {
    docNum: {
      select: `
        DISTINCT TOP (@top)
        CAST(T0.DocNum AS NVARCHAR(50)) AS code,
        T0.CardName AS name,
        T0.DocNum AS sort_code
      `,
      queryClause: `CAST(T0.DocNum AS NVARCHAR(50)) LIKE @lookupQuery ${LIKE_ESCAPE_SQL}`,
      orderBy: 'sort_code DESC',
    },
    customerCode: {
      select: `
        DISTINCT TOP (@top)
        T0.CardCode AS code,
        T0.CardName AS name
      `,
      queryClause: `(T0.CardCode LIKE @lookupQuery ${LIKE_ESCAPE_SQL} OR T0.CardName LIKE @lookupQuery ${LIKE_ESCAPE_SQL})`,
      orderBy: 'code',
    },
    customerName: {
      select: `
        DISTINCT TOP (@top)
        T0.CardName AS code,
        T0.CardCode AS name
      `,
      queryClause: `(T0.CardName LIKE @lookupQuery ${LIKE_ESCAPE_SQL} OR T0.CardCode LIKE @lookupQuery ${LIKE_ESCAPE_SQL})`,
      orderBy: 'code',
    },
    sellerCode: {
      select: `
        DISTINCT TOP (@top)
        ${salesOrderSellerCodeExpression} AS code,
        ${salesOrderSellerNameExpression} AS name
      `,
      queryClause: `(${salesOrderSellerCodeExpression} LIKE @lookupQuery ${LIKE_ESCAPE_SQL} OR ${salesOrderSellerNameExpression} LIKE @lookupQuery ${LIKE_ESCAPE_SQL})`,
      orderBy: 'code',
    },
    sellerName: {
      select: `
        DISTINCT TOP (@top)
        ${salesOrderSellerNameExpression} AS code,
        ${salesOrderSellerCodeExpression} AS name
      `,
      queryClause: `(${salesOrderSellerNameExpression} LIKE @lookupQuery ${LIKE_ESCAPE_SQL} OR ${salesOrderSellerCodeExpression} LIKE @lookupQuery ${LIKE_ESCAPE_SQL})`,
      orderBy: 'code',
    },
  };

  const config = fieldConfig[normalizedField];
  if (!config) return { options: [] };

  const { whereClauses, params } = buildSalesOrderListFilterQuery({
    query: '',
    openOnly,
    docNum,
    customerRefNo,
    customerCode,
    customerName,
    sellerCode,
    sellerName,
    status,
    postingDateFrom,
    postingDateTo,
  }, { excludeField: normalizedField, sellerExpressions });

  if (normalizedQuery) {
    whereClauses.push(config.queryClause);
    params.lookupQuery = `%${escapeLike(normalizedQuery)}%`;
  }

  const rows = await safe(db.query(`
    SELECT ${config.select}
    FROM ORDR T0
    LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode
    WHERE ${whereClauses.join('\n      AND ')}
      AND NULLIF(LTRIM(RTRIM(${normalizedField === 'sellerName' ? salesOrderSellerNameExpression : normalizedField === 'sellerCode' ? salesOrderSellerCodeExpression : 'CAST(1 AS NVARCHAR(1))'})), '') IS NOT NULL
    ORDER BY ${config.orderBy}
  `, { ...params, top: normalizedTop }));

  return {
    options: rows.map((row) => ({
      code: String(row.code || '').trim(),
      name: String(row.name || '').trim(),
    })).filter((option) => option.code),
  };
};

// ── single sales order ────────────────────────────────────────────────────────

const resolveSalesOrderDocEntry = async (identifier) => {
  const normalizedIdentifier = Number(identifier);
  if (!Number.isFinite(normalizedIdentifier)) {
    throw new Error(`Invalid Sales Order identifier: ${identifier}`);
  }

  const rows = await safe(db.query(`
    SELECT TOP 1 DocEntry, DocNum
    FROM ORDR
    WHERE DocEntry = @DocEntry
       OR DocNum = @DocNum
    ORDER BY CASE WHEN DocEntry = @DocEntry THEN 0 ELSE 1 END, DocEntry
  `, {
    DocEntry: normalizedIdentifier,
    DocNum: normalizedIdentifier,
  }));

  return rows[0] || null;
};

const pickFirstValue = (row = {}, candidates = []) => {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate) && row[candidate] != null && row[candidate] !== '') {
      return row[candidate];
    }
  }
  return '';
};

const getSalesOrderReferenceDocuments = async (docEntry) => {
  const fieldMetadata = await getTableFieldMetadata('RDR21');
  if (!fieldMetadata?.DocEntry) return [];

  const orderBy = fieldMetadata.LineNum ? 'ORDER BY [LineNum]' : '';
  const rows = await safe(db.query(`
    SELECT TOP 200 *
    FROM [RDR21]
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
      issueDate: formatSapDate(pickFirstValue(row, ['IssueDate', 'RefDate', 'DocDate'])),
      remark: String(pickFirstValue(row, ['Remark', 'Remarks', 'Comments']) || ''),
    };
  }).filter((row) => (
    String(row.transactionType || row.docEntry || row.docNumber || row.extDocNumber || '').trim()
  ));
};

const REFERENCE_DOCUMENT_LOOKUP_CONFIG = {
  '22': { table: 'OPOR', label: 'Purchase Order' },
  'rot_PurchaseOrder': { table: 'OPOR', label: 'Purchase Order' },
  '17': { table: 'ORDR', label: 'Sales Order' },
  'rot_SalesOrder': { table: 'ORDR', label: 'Sales Order' },
  '15': { table: 'ODLN', label: 'Delivery' },
  'rot_DeliveryNotes': { table: 'ODLN', label: 'Delivery' },
  '13': { table: 'OINV', label: 'A/R Invoice' },
  'rot_SalesInvoice': { table: 'OINV', label: 'A/R Invoice' },
  '14': { table: 'ORIN', label: 'A/R Credit Memo' },
  'rot_SalesCreditNote': { table: 'ORIN', label: 'A/R Credit Memo' },
  '23': { table: 'OQUT', label: 'Sales Quotation' },
  'rot_SalesQuotation': { table: 'OQUT', label: 'Sales Quotation' },
  '20': { table: 'OPDN', label: 'Goods Receipt PO' },
  'rot_PurchaseDeliveryNotes': { table: 'OPDN', label: 'Goods Receipt PO' },
  '18': { table: 'OPCH', label: 'A/P Invoice' },
  'rot_PurchaseInvoice': { table: 'OPCH', label: 'A/P Invoice' },
  '19': { table: 'ORPC', label: 'A/P Credit Memo' },
  'rot_PurchaseCreditNote': { table: 'ORPC', label: 'A/P Credit Memo' },
  '1470000113': { table: 'OPRQ', label: 'Purchase Request' },
  'rot_PurchaseRequest': { table: 'OPRQ', label: 'Purchase Request' },
  '540000006': { table: 'OPQT', label: 'Purchase Quotation' },
  'rot_PurchaseQuotation': { table: 'OPQT', label: 'Purchase Quotation' },
};

const getReferenceDocumentLookup = async ({
  transactionType = '',
  query = '',
  cardCode = '',
  top = 50,
} = {}) => {
  const normalizedType = String(transactionType || '').trim();
  const config = REFERENCE_DOCUMENT_LOOKUP_CONFIG[normalizedType];
  if (!config?.table) return { label: '', options: [] };

  const fieldMetadata = await getTableFieldMetadata(config.table);
  if (!fieldMetadata?.DocEntry || !fieldMetadata?.DocNum) {
    return { label: config.label, options: [] };
  }

  const normalizedTop = Math.min(200, Math.max(1, Number(top) || 50));
  const normalizedQuery = String(query || '').trim();
  const normalizedCardCode = String(cardCode || '').trim();
  const selectParts = [
    'T0.[DocEntry]',
    'T0.[DocNum]',
    fieldMetadata.DocDate ? 'T0.[DocDate]' : 'NULL AS [DocDate]',
    fieldMetadata.CardCode ? 'T0.[CardCode]' : "'' AS [CardCode]",
    fieldMetadata.CardName ? 'T0.[CardName]' : "'' AS [CardName]",
    fieldMetadata.NumAtCard ? 'T0.[NumAtCard]' : "'' AS [NumAtCard]",
    fieldMetadata.DocTotal ? 'T0.[DocTotal]' : 'NULL AS [DocTotal]',
    fieldMetadata.DocStatus ? 'T0.[DocStatus]' : "'' AS [DocStatus]",
  ];
  const whereClauses = ['1 = 1'];
  const params = { top: normalizedTop };

  if (fieldMetadata.CANCELED) {
    whereClauses.push("(T0.[CANCELED] IS NULL OR T0.[CANCELED] <> 'Y')");
  }

  if (normalizedQuery) {
    const queryParts = [`CAST(T0.[DocNum] AS NVARCHAR(50)) LIKE @query ${LIKE_ESCAPE_SQL}`];
    if (fieldMetadata.CardCode) queryParts.push(`T0.[CardCode] LIKE @query ${LIKE_ESCAPE_SQL}`);
    if (fieldMetadata.CardName) queryParts.push(`T0.[CardName] LIKE @query ${LIKE_ESCAPE_SQL}`);
    if (fieldMetadata.NumAtCard) queryParts.push(`T0.[NumAtCard] LIKE @query ${LIKE_ESCAPE_SQL}`);
    whereClauses.push(`(${queryParts.join(' OR ')})`);
    params.query = `%${escapeLike(normalizedQuery)}%`;
  }

  if (normalizedCardCode && fieldMetadata.CardCode) {
    whereClauses.push('T0.[CardCode] = @cardCode');
    params.cardCode = normalizedCardCode;
  }

  const orderBy = [
    fieldMetadata.DocDate ? 'T0.[DocDate] DESC' : '',
    'T0.[DocNum] DESC',
  ].filter(Boolean).join(', ');

  const rows = await safe(db.query(`
    SELECT TOP (@top)
      ${selectParts.join(',\n      ')}
    FROM ${quoteSqlIdentifier(config.table)} T0
    WHERE ${whereClauses.join('\n      AND ')}
    ORDER BY ${orderBy}
  `, params));

  return {
    label: config.label,
    options: rows.map((row) => ({
      docEntry: row.DocEntry != null ? String(row.DocEntry) : '',
      docNumber: row.DocNum != null ? String(row.DocNum) : '',
      extDocNumber: row.NumAtCard || '',
      cardCode: row.CardCode || '',
      cardName: row.CardName || '',
      docDate: formatSapDate(row.DocDate),
      docTotal: row.DocTotal != null ? String(row.DocTotal) : '',
      status: row.DocStatus === 'O' ? 'Open' : row.DocStatus === 'C' ? 'Closed' : (row.DocStatus || ''),
    })).filter((row) => row.docNumber),
  };
};

const getSalesOrder = async (docEntry) => {
  const resolvedDocument = await resolveSalesOrderDocEntry(docEntry);
  if (!resolvedDocument) {
    throw new Error(`Sales Order ${docEntry} not found`);
  }

  const resolvedDocEntry = resolvedDocument.DocEntry;
  const headerFieldMetadata = await getTableFieldMetadata('ORDR');
  const lineFieldMetadata = await getSalesOrderLineFieldMetadata();
  const sacFieldMetadata = await getTableFieldMetadata('OSAC');
  const addressExtensionFieldMetadata = await getTableFieldMetadata('RDR12');
  const lineField = (columnName, alias, fallback = "''") => (
    resolveTableColumnName(lineFieldMetadata, columnName)
      ? `T1.${quoteSqlIdentifier(resolveTableColumnName(lineFieldMetadata, columnName))} AS ${quoteSqlIdentifier(alias)}`
      : `${fallback} AS ${quoteSqlIdentifier(alias)}`
  );
  const resolveLineColumn = (candidates = []) => candidates
    .map((candidate) => resolveTableColumnName(lineFieldMetadata, candidate))
    .find(Boolean);
  const treeTypeColumn = resolveLineColumn(['TreeType', 'TreeTyp']);
  const parentLineNumColumn = resolveLineColumn(['ParentLineNum', 'ParentLnNum', 'ParentLine']);
  const taxCodeColumn = resolveLineColumn(['TaxCode', 'VatGroup']);
  const uomEntryColumn = resolveLineColumn(['UomEntry']);
  const unitMeasureColumn = resolveLineColumn(['unitMsr']);
  const hsnEntryColumn = resolveLineColumn(['HsnEntry']);
  const commissionColumn = resolveLineColumn(['CommPercent', 'Commission']);
  const taxCodeExpression = taxCodeColumn ? `T1.${quoteSqlIdentifier(taxCodeColumn)}` : "''";
  const unitMeasureExpression = unitMeasureColumn
    ? `NULLIF(LTRIM(RTRIM(T1.${quoteSqlIdentifier(unitMeasureColumn)})), '')`
    : 'NULL';
  const uomCodeExpression = uomEntryColumn
    ? `CASE WHEN T1.${quoteSqlIdentifier(uomEntryColumn)} < 0 THEN 'Manual' ELSE COALESCE(UOM.UomCode, ${unitMeasureExpression}, '') END`
    : `COALESCE(${unitMeasureExpression}, '')`;
  const uomNameExpression = uomEntryColumn
    ? `CASE WHEN T1.${quoteSqlIdentifier(uomEntryColumn)} < 0 THEN COALESCE(${unitMeasureExpression}, 'Manual') ELSE COALESCE(UOM.UomName, ${unitMeasureExpression}, UOM.UomCode, '') END`
    : `COALESCE(${unitMeasureExpression}, '')`;
  const uomJoinSql = uomEntryColumn
    ? `LEFT JOIN OUOM UOM ON UOM.UomEntry = T1.${quoteSqlIdentifier(uomEntryColumn)}`
    : '';
  const addressExtensionField = (candidates, alias, fallback = "''") => {
    const columnName = candidates
      .map((candidate) => resolveTableColumnName(addressExtensionFieldMetadata, candidate))
      .find(Boolean);
    return columnName
      ? `T12.${quoteSqlIdentifier(columnName)} AS ${quoteSqlIdentifier(alias)}`
      : `${fallback} AS ${quoteSqlIdentifier(alias)}`;
  };
  const paymentMethodColumn = resolveTableColumnName(headerFieldMetadata, 'PeyMethod');
  const paymentMethodExpression = paymentMethodColumn ? `T0.${quoteSqlIdentifier(paymentMethodColumn)}` : "''";
  const forRateColumnName = resolveForRateColumnName(lineFieldMetadata);
  const forRateExpression = forRateColumnName ? `T1.${quoteSqlIdentifier(forRateColumnName)}` : "''";
  const sacSql = getSacLookupSqlParts('T1', 'SAC', sacFieldMetadata, lineFieldMetadata);

  // ✅ Get complete header and line data with Place of Supply and HSN Code
  let rows;
  try {
    const result = await db.query(`
   SELECT 
    -- 🔹 HEADER
    T0.DocEntry,
    T0.DocNum,
    T0.CardCode,
    T0.CardName,
    T0.DocDate,
    T0.CreateDate AS DocumentCreated,
    T0.DocDueDate,
    T0.TaxDate,
    T0.DocStatus,
    T0.NumAtCard,
    T0.Comments AS Remarks,
    T0.DocTotal,
    T0.DocCur,
    T0.DocRate,
    T0.CntctCode,
    ${optionalHeaderColumn(headerFieldMetadata, ['BPLId', 'BPL_IDAssignedToInvoice'], 'BPLId', 'NULL')},
    T0.GroupNum,
    T0.ShipToCode,
    T0.PayToCode,
    T0.Address,
    T0.Address2,
    ${addressExtensionField(['StreetS', 'ShipToStreet'], 'ShipToStreet')},
    ${addressExtensionField(['StreetNoS', 'ShipToStreetNo'], 'ShipToStreetNo')},
    ${addressExtensionField(['BuildingS', 'ShipToBuilding'], 'ShipToBuilding')},
    ${addressExtensionField(['BlockS', 'ShipToBlock'], 'ShipToBlock')},
    ${addressExtensionField(['CityS', 'ShipToCity'], 'ShipToCity')},
    ${addressExtensionField(['ZipCodeS', 'ShipToZipCode'], 'ShipToZipCode')},
    ${addressExtensionField(['CountyS', 'ShipToCounty'], 'ShipToCounty')},
    ${addressExtensionField(['StateS', 'ShipToState'], 'ShipToState')},
    ${addressExtensionField(['CountryS', 'ShipToCountry'], 'ShipToCountry')},
    ${addressExtensionField(['Address2S', 'ShipToAddress2'], 'ShipToAddress2')},
    ${addressExtensionField(['Address3S', 'ShipToAddress3'], 'ShipToAddress3')},
    ${addressExtensionField(['GlblLocNumS', 'GlobalLocationNumberS', 'ShipToGlobalLocationNumber'], 'ShipToGlobalLocationNumber')},
    ${addressExtensionField(['StreetB', 'BillToStreet'], 'BillToStreet')},
    ${addressExtensionField(['StreetNoB', 'BillToStreetNo'], 'BillToStreetNo')},
    ${addressExtensionField(['BuildingB', 'BillToBuilding'], 'BillToBuilding')},
    ${addressExtensionField(['BlockB', 'BillToBlock'], 'BillToBlock')},
    ${addressExtensionField(['CityB', 'BillToCity'], 'BillToCity')},
    ${addressExtensionField(['ZipCodeB', 'BillToZipCode'], 'BillToZipCode')},
    ${addressExtensionField(['CountyB', 'BillToCounty'], 'BillToCounty')},
    ${addressExtensionField(['StateB', 'BillToState'], 'BillToState')},
    ${addressExtensionField(['CountryB', 'BillToCountry'], 'BillToCountry')},
    ${addressExtensionField(['Address2B', 'BillToAddress2'], 'BillToAddress2')},
    ${addressExtensionField(['Address3B', 'BillToAddress3'], 'BillToAddress3')},
    ${addressExtensionField(['GlblLocNumB', 'GlobalLocationNumberB', 'BillToGlobalLocationNumber'], 'BillToGlobalLocationNumber')},
    T0.TrnspCode,
    T0.Confirmed,
    ${optionalHeaderColumn(headerFieldMetadata, ['LangCode', 'Language'], 'LanguageCode', 'NULL')},
    ${optionalHeaderColumn(headerFieldMetadata, ['PickRmrk'], 'PickAndPackRemarks')},
    ${optionalHeaderColumn(headerFieldMetadata, ['BPChCode'], 'BPChannelCode')},
    ${optionalHeaderColumn(headerFieldMetadata, ['BPChCntc'], 'BPChannelContact', 'NULL')},
    T0.JrnlMemo,
    ${paymentMethodExpression} AS PaymentMethod,
    ${optionalHeaderColumn(headerFieldMetadata, ['TransCat', 'TransactionCategory'], 'TransactionCategory')},
    ${optionalHeaderColumn(headerFieldMetadata, ['FormNo', 'TaxFormNo'], 'TaxFormNo')},
    ${optionalHeaderColumn(headerFieldMetadata, ['DutyStatus'], 'DutyStatus')},
    ${optionalHeaderColumn(headerFieldMetadata, ['Export', 'IsExport', 'Exported'], 'ExportFlag')},
    ${optionalHeaderColumn(headerFieldMetadata, ['DiffPercent', 'DifferentialTaxRate', 'DiffTaxRate'], 'DifferentialTaxRate', "'100'")},
    ${optionalHeaderColumn(headerFieldMetadata, ['SupplySec7', 'SupplUnSec', 'SupplyCovered'], 'SupplyCovered')},
    T0.Series,
    T0.DiscPrcnt,

    -- 🔹 SALES EMPLOYEE
    T0.SlpCode,
    SLP.SlpName AS SalesEmployeeName,

    -- 🔹 OWNER
    T0.OwnerCode,
    CASE 
      WHEN EMP.empID IS NOT NULL 
      THEN CONCAT(CONCAT(COALESCE(EMP.firstName, ''), ' '), COALESCE(EMP.lastName, ''))
      ELSE NULL
    END AS OwnerName,

    -- 🔹 FINANCIALS
    T0.TotalExpns AS Freight,
    T0.VatSum AS TaxAmount,
    T0.RoundDif AS RoundingAmount,

    -- 🔹 PLACE OF SUPPLY (NO DUPLICATE FIXED)
    ST.Name AS PlaceOfSupply,

    -- 🔹 LINE DATA
    T1.LineNum,
    ${treeTypeColumn ? `T1.${quoteSqlIdentifier(treeTypeColumn)}` : "''"} AS TreeType,
    ${parentLineNumColumn ? `T1.${quoteSqlIdentifier(parentLineNumColumn)}` : 'NULL'} AS ParentLineNum,
    T1.ItemCode,
    T1.Dscription,
    T1.Quantity,
    T1.Price,
    T1.PriceBefDi,
    T1.DiscPrcnt AS LineDiscPrcnt,
    ${taxCodeExpression} AS TaxCode,
    T1.WhsCode,
    ${lineField('UomEntry', 'UoMEntry', 'NULL')},
    ${lineField('NumPerMsr', 'UomFactor', 'CAST(1 AS DECIMAL(19, 6))')},
    ${uomCodeExpression} AS UomCode,
    ${uomNameExpression} AS UomName,
    T1.OcrCode AS DistributionRule,
    ${lineField('OcrCode2', 'DistributionRule2')},
    ${lineField('OcrCode3', 'DistributionRule3')},
    ${lineField('OcrCode4', 'DistributionRule4')},
    ${lineField('OcrCode5', 'DistributionRule5')},
    ${lineField('CogsOcrCod', 'COGSDistributionRule')},
    ${lineField('CogsOcrCo2', 'COGSDistributionRule2')},
    ${lineField('CogsOcrCo3', 'COGSDistributionRule3')},
    ${lineField('CogsOcrCo4', 'COGSDistributionRule4')},
    ${lineField('CogsOcrCo5', 'COGSDistributionRule5')},
    ${lineField('AcctCode', 'GLAccount')},
    ${lineField('HsnEntry', 'HSNEntry', 'NULL')},
    ${lineField('SACEntry', 'SACEntry', 'NULL')},
    ${sacSql.displayExpression} AS SACCode,
    ${sacSql.serviceNameColumn} AS SACServiceName,
    ${sacSql.serviceCodeColumn} AS SACServiceCode,
    ${lineField('FreeTxt', 'FreeText')},
    ${lineField('CountryOrg', 'CountryOfOrigin')},
    ${lineField('LocCode', 'LocationCode', 'NULL')},
    ${lineField('ShipDate', 'LineDeliveryDate', 'NULL')},
    ${lineField('TrnsCode', 'LineShippingType', 'NULL')},
    ${lineField('WtLiable', 'WTaxLiable')},
    ${lineField('TaxOnly', 'TaxLiable')},
    ${lineField('AgrNo', 'BlanketAgreementNo', 'NULL')},
    ${lineField('AgrLnNum', 'BlanketAgreementLine', 'NULL')},
    ${lineField('TotalFrgn', 'DocumentTotal', 'NULL')},
    ${lineField('GTotal', 'GrossTotal', 'NULL')},
    ${commissionColumn ? `T1.${quoteSqlIdentifier(commissionColumn)}` : 'NULL'} AS CommissionPercent,
    ${lineField('NoInvtryMv', 'WithoutQtyPosting')},
    ${lineField('EnSetCost', 'EnableSettingCost')},
    ${lineField('RetCost', 'ReturnCost', 'NULL')},
    COALESCE(ITW.OnHand, 0) AS QuantityInWarehouse,
    COALESCE(ITM.OnHand, 0) AS InStock,
    T1.OpenQty AS OpenQuantity,
    CAST((ISNULL(T1.Quantity, 0) - ISNULL(T1.OpenQty, 0)) AS DECIMAL(19, 6)) AS DeliveredQuantity,
    ISNULL(T1.VatSum, 0) AS LineTaxAmount,
    T1.LineTotal,
    ${forRateExpression} AS ForRate,
    ${lineField('U_SPLRBT', 'SpecialRebate')},
    ${lineField('U_COMPRC', 'Commission')},
    ${lineField('U_S_BrokPerQty', 'SellerBrokeragePerQty')},
    ${lineField('U_Unit_Price', 'UnitPriceUdf', "''")},
    ${lineField('U_Rate', 'DiscountAmount', 'CAST(NULL AS DECIMAL(19, 6))')},
    ${lineField('U_Brok_Seller', 'SellerBrokerage')},
    ${lineField('U_Brok_Buyer', 'BuyerBrokerage')},
    ${lineField('U_Buyer_Delivery', 'BuyerDelivery')},
    ${lineField('U_Seller_Delivery', 'SellerDelivery')},
    ${lineField('U_Buyer_Payment_Terms', 'BuyerPaymentTerms')},
    ${lineField('U_Seller_Payment_Term', 'SellerPaymentTerm')},
    ${lineField('U_Seller_Payment_Terms', 'SellerPaymentTerms')},
    ${lineField('U_Buyer_Quality', 'BuyerQuality')},
    ${lineField('U_Seller_Quality', 'SellerQuality')},
    ${lineField('U_Buyer_Price', 'BuyerPrice')},
    ${lineField('U_Seller_Price', 'SellerPrice')},
    ${lineField('U_Buyer_SPINS', 'BuyerSpecialInstruction')},
    ${lineField('U_Seller_SPINS', 'SellerSpecialInstruction')},
    ${lineField('U_Seller_SPINS', 'QtySpecialInstruction')},
    ${lineField('U_Buyer_SPINS', 'DeliverySpecialInstruction')},
    ${lineField('U_Sel_Brok_AP', 'SellerBrokerageAmtPer')},
    ${lineField('U_Seller_Brok_Per', 'SellerBrokeragePercent')},
    ${lineField('U_Buyer_Bill_Disc', 'BuyerBillDiscount')},
    ${lineField('U_Seller_Bill_Disc', 'SellerBillDiscount')},
    ${lineField('U_SELLTCODE', 'STCODE')},
    ${lineField('U_S_Item', 'SellerItem')},
    ${lineField('U_S_Qty', 'SellerQty')},
    ${lineField('U_Freight_pur', 'FreightPurchase')},
    ${lineField('U_Freight_sales', 'FreightSales')},
    ${lineField('U_Fr_trans', 'FreightProvider')},
    ${lineField('U_Fr_trans_name', 'FreightProviderName')},
    ${lineField('U_BDNum', 'BrokerageNumber')},

    -- 🔹 HSN
    CHP.ChapterID AS HSNCode

FROM ORDR T0

LEFT JOIN RDR12 T12 ON T12.DocEntry = T0.DocEntry

-- ✅ LINES (KEEP INNER JOIN if lines must exist)
INNER JOIN RDR1 T1 ON T0.DocEntry = T1.DocEntry

-- ✅ SALES EMPLOYEE
LEFT JOIN OSLP SLP ON SLP.SlpCode = T0.SlpCode

-- ✅ OWNER
LEFT JOIN OHEM EMP ON EMP.empID = T0.OwnerCode

-- ✅ ADDRESS FIX (NO DUPLICATE ISSUE)
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
   AND C.Address = T0.ShipToCode
   AND C.AddressRank = 1

LEFT JOIN OCST ST 
    ON ST.Code = C.State 
   AND ST.Country = C.Country

-- ✅ HSN
LEFT JOIN OITM ITM ON ITM.ItemCode = T1.ItemCode
LEFT JOIN OITW ITW ON ITW.ItemCode = T1.ItemCode AND ITW.WhsCode = T1.WhsCode
LEFT JOIN OCHP CHP ON CHP.AbsEntry = ${hsnEntryColumn ? `COALESCE(T1.${quoteSqlIdentifier(hsnEntryColumn)}, ITM.ChapterID)` : 'ITM.ChapterID'}
${uomJoinSql}
${sacSql.joinSql}

WHERE T0.DocEntry = @DocEntry

ORDER BY T1.LineNum
  `, { DocEntry: resolvedDocEntry });
    rows = result.recordset || [];
  } catch (error) {
    console.error('[SalesOrderDB] getSalesOrder detail query failed:', {
      requestedIdentifier: docEntry,
      resolvedDocEntry,
      message: error.message,
    });
    throw error;
  }

  console.log('🔍 [Backend] Query returned', rows.length, 'rows for requested identifier', docEntry, 'resolved DocEntry', resolvedDocEntry);

  if (!rows.length) {
    throw new Error(`Sales Order ${docEntry} not found`);
  }

  const header = rows[0];  // Header data is same in all rows
  const placeOfSupply = header.PlaceOfSupply || '';
  const [dynamicHeaderUdfs, dynamicLineUdfs, physicalHeaderUdfs, physicalLineUdfs] = await Promise.all([
    getHeaderUdfValues({ tableId: 'ORDR', keyValue: resolvedDocEntry }),
    getLineUdfValues({ tableId: 'RDR1', keyValue: resolvedDocEntry }),
    getPhysicalUdfValues({ tableName: 'ORDR', keyValue: resolvedDocEntry }),
    getPhysicalUdfValues({ tableName: 'RDR1', keyValue: resolvedDocEntry, includeLineNum: true }),
  ]);
  const referenceDocuments = await getSalesOrderReferenceDocuments(resolvedDocEntry);

  // ✅ Try to get header UDFs if they exist
  let headerUdfs = {
    ...dynamicHeaderUdfs,
    ...physicalHeaderUdfs,
  };
  try {
    const udfRows = await db.query(`
      SELECT
        U_SCharge,
        U_TRNS,
        U_LRNO,
        U_LRDT,
        U_DSTN,
        U_DSTNADD,
        U_FDSTN,
        U_VEHNO,
        U_DOCTHR,
        U_UOM,
        U_Price,
        U_SAmount,
        U_B_FromDate,
        U_B_ToDate,
        U_Seller_Code,
        U_Seller_Name,
        U_Seller_AddressId,
        U_Seller_Address,
        U_Old_Soda_Nodh_No,
        U_Old_Soda_Nodh_Date,
        U_Canceled,
        U_TrfId,
        U_TrfName,
        U_TrfVehi,
        U_TrfDist,
        U_TrfMode,
        U_TrfVType,
        U_AckNo,
        U_AckDt,
        U_CanDt,
        U_QrCode,
        U_SigInv,
        U_EwbDt,
        U_EwbVliDt,
        U_EWayBCan,
        U_TrfCode,
        U_MultiVeh,
        U_MultiVehPosted,
        U_SubSuply,
        U_DocType,
        U_TraType,
        U_DelRemarks
      FROM   ORDR
      WHERE  DocEntry = @DocEntry
    `, { DocEntry: resolvedDocEntry });
    if (udfRows.recordset && udfRows.recordset.length > 0) {
      const udf = udfRows.recordset[0];
      headerUdfs = {
        ...headerUdfs,
        U_SCharge: udf.U_SCharge || '',
        U_TRNS: udf.U_TRNS || '',
        U_LRNO: udf.U_LRNO || '',
        U_LRDT: udf.U_LRDT ? udf.U_LRDT.toISOString().split('T')[0] : '',
        U_DSTN: udf.U_DSTN || '',
        U_DSTNADD: udf.U_DSTNADD || '',
        U_FDSTN: udf.U_FDSTN || '',
        U_VEHNO: udf.U_VEHNO || '',
        U_DOCTHR: udf.U_DOCTHR || '',
        U_UOM: udf.U_UOM || '',
        U_Price: udf.U_Price != null ? String(udf.U_Price) : '',
        U_SAmount: udf.U_SAmount != null ? String(udf.U_SAmount) : '',
        U_B_FromDate: udf.U_B_FromDate ? udf.U_B_FromDate.toISOString().split('T')[0] : '',
        U_B_ToDate: udf.U_B_ToDate ? udf.U_B_ToDate.toISOString().split('T')[0] : '',
        U_Seller_Code: udf.U_Seller_Code || '',
        U_Seller_Name: udf.U_Seller_Name || '',
        U_Seller_AddressId: udf.U_Seller_AddressId || '',
        U_Seller_Address: udf.U_Seller_Address || '',
        U_Old_Soda_Nodh_No: udf.U_Old_Soda_Nodh_No || '',
        U_Old_Soda_Nodh_Date: udf.U_Old_Soda_Nodh_Date ? udf.U_Old_Soda_Nodh_Date.toISOString().split('T')[0] : '',
        U_Canceled: udf.U_Canceled || '',
        U_TrfId: udf.U_TrfId || '',
        U_TrfName: udf.U_TrfName || '',
        U_TrfVehi: udf.U_TrfVehi || '',
        U_TrfDist: udf.U_TrfDist != null ? String(udf.U_TrfDist) : '',
        U_TrfMode: udf.U_TrfMode || '',
        U_TrfVType: udf.U_TrfVType || '',
        U_AckNo: udf.U_AckNo || '',
        U_AckDt: udf.U_AckDt || '',
        U_CanDt: udf.U_CanDt || '',
        U_QrCode: udf.U_QrCode || '',
        U_SigInv: udf.U_SigInv || '',
        U_EwbDt: udf.U_EwbDt || '',
        U_EwbVliDt: udf.U_EwbVliDt || '',
        U_EWayBCan: udf.U_EWayBCan || '',
        U_TrfCode: udf.U_TrfCode || '',
        U_MultiVeh: udf.U_MultiVeh || '',
        U_MultiVehPosted: udf.U_MultiVehPosted || '',
        U_SubSuply: udf.U_SubSuply || '',
        U_DocType: udf.U_DocType || '',
        U_TraType: udf.U_TraType || '',
        U_DelRemarks: udf.U_DelRemarks || '',
      };
    }
  } catch (err) {
    // Header UDF fields don't exist, skip them
  }

  // Use line data from the main joined query (rows already contains all lines)
  const lineRows = rows;
  const shipToAddressComponents = buildDocumentAddressComponents(header, 'ShipTo');
  const billToAddressComponents = buildDocumentAddressComponents(header, 'BillTo');

  const lineUdfs = mergeLineUdfValueMaps(dynamicLineUdfs, physicalLineUdfs);

  // ✅ Get batch numbers for each line (if any)
  const batchRows = await safe(db.query(`
    SELECT BaseLinNum AS BaseLineNum, BatchNum, Quantity
    FROM   IBT1
    WHERE  BaseEntry = @DocEntry
      AND  BaseType = 17
    ORDER  BY BaseLinNum, BatchNum
  `, { DocEntry: resolvedDocEntry }));

  // Group batches by line number
  const batchesByLine = {};
  batchRows.forEach(b => {
    if (!batchesByLine[b.BaseLineNum]) {
      batchesByLine[b.BaseLineNum] = [];
    }
    batchesByLine[b.BaseLineNum].push({
      batchNumber: b.BatchNum || '',
      quantity: String(b.Quantity || 0),
      expiryDate: '', // ExpDate column doesn't exist in IBT1
    });
  });

  const result = {
    sales_order: {
      doc_entry: header.DocEntry,
      doc_num: header.DocNum,
      header: {
        customerCode: header.CardCode,
        customerName: header.CardName,
        contactPerson: String(header.CntctCode || ''),
        branch: String(header.BPLId || ''),
        series: String(header.Series || ''),
        placeOfSupply: placeOfSupply,
        postingDate: header.DocDate ? header.DocDate.toISOString().split('T')[0] : '',
        documentCreated: formatSapDate(header.DocumentCreated),
        deliveryDate: header.DocDueDate ? header.DocDueDate.toISOString().split('T')[0] : '',
        documentDate: header.TaxDate ? header.TaxDate.toISOString().split('T')[0] : '',
        customerRefNo: header.NumAtCard || '',
        remarks: header.Comments || '',
        otherInstruction: header.Comments || '',  // Map Comments to otherInstruction for frontend
        docNum: header.DocNum,
        status: header.DocStatus === 'O' ? 'Open' : header.DocStatus === 'C' ? 'Closed' : 'Unknown',
        paymentTerms: String(header.GroupNum || ''),
        salesEmployee: String(header.SlpCode || ''),
        purchaser: header.SalesEmployeeName || '',  // Return name for frontend
        owner: header.OwnerName || '',  // Return owner name
        freight: String(header.Freight || ''),  // Use Freight (mapped from TotalExpns)
        shipToCode: header.ShipToCode || '',
        payToCode: header.PayToCode || '',
        shipTo: header.Address || '',
        payTo: header.Address2 || '',
        shipToAddressComponents,
        billToAddressComponents,
        shippingType: String(header.TrnspCode || ''),
        confirmed: header.Confirmed === 'Y',
        language: header.LanguageCode != null ? String(header.LanguageCode) : '',
        languageCode: header.LanguageCode != null ? String(header.LanguageCode) : '',
        pickAndPackRemarks: header.PickAndPackRemarks || '',
        bpChannelName: header.BPChannelCode || '',
        bpChannelCode: header.BPChannelCode || '',
        bpChannelContact: header.BPChannelContact != null ? String(header.BPChannelContact) : '',
        journalRemark: header.JrnlMemo || '',
        paymentMethod: header.PaymentMethod || '',
        transactionCategory: header.TransactionCategory || '',
        taxFormNo: header.TaxFormNo || '',
        dutyStatus: header.DutyStatus || 'Y',
        exportFlag: ['Y', 'YES', '1', 'TRUE'].includes(String(header.ExportFlag || '').toUpperCase()),
        differentialTaxRate: header.DifferentialTaxRate != null ? String(header.DifferentialTaxRate) : '100',
        supplyCovered: header.SupplyCovered == null || header.SupplyCovered === ''
          ? true
          : ['Y', 'YES', '1', 'TRUE'].includes(String(header.SupplyCovered || '').toUpperCase()),
        discount: String(header.DiscPrcnt || ''),
        tax: header.TaxAmount != null ? String(header.TaxAmount) : '',
        rounding: Number(header.RoundingAmount || 0) !== 0,
        roundingAmount: header.RoundingAmount != null ? String(header.RoundingAmount) : '',
        totalPaymentDue: header.DocTotal != null ? String(header.DocTotal) : '',
        currency: header.DocCur || '',
        exchangeRate: header.DocRate != null ? String(header.DocRate) : '',
      },
      header_udfs: headerUdfs,
      reference_documents: referenceDocuments,
      lines: lineRows.map(line => {
        const lineUdf = lineUdfs[line.LineNum] || {};
        const savedUnitPriceUdf = firstNonBlank(
          lineUdf.U_Unit_Price,
          lineUdf.U_PRICE,
          line.UnitPriceUdf,
        );
        const standardUnitPrice = resolveSavedLineUnitPrice(line);
        const displayUnitPrice = (
          isSalesBomParentTreeType(line.TreeType)
          && savedUnitPriceUdf != null
          && String(savedUnitPriceUdf).trim() !== ''
        )
          ? String(savedUnitPriceUdf)
          : standardUnitPrice;
        const savedDiscountAmount = lineUdf.U_Rate != null && String(lineUdf.U_Rate).trim() !== ''
          ? lineUdf.U_Rate
          : line.DiscountAmount;
        const displayDiscountAmount = savedDiscountAmount != null && String(savedDiscountAmount).trim() !== ''
          ? String(savedDiscountAmount)
          : getDisplayDiscountAmount(displayUnitPrice, line.LineDiscPrcnt);
        const calculatedForRate = getCalculatedForRate(displayUnitPrice, line.LineDiscPrcnt, line.TaxCode);
        const savedForRate = firstNonBlank(
          getUdfValueByAliases(lineUdf, ['U_ForRate', 'U_FORRATE', 'U_FOR_RATE', 'U_For_Rate', 'U_FORRate']),
          line.ForRate,
          line.Rate,
          calculatedForRate
        );
        // Get HSN Code from the joined query
        const hsnCode = line.HSNCode || (line.HSNEntry != null ? String(line.HSNEntry) : '');
        
        console.log('🔍 [Backend] Processing line:', line.LineNum, 'Item:', line.ItemCode, 'HSN:', hsnCode);
        
        return {
          lineNum: line.LineNum != null ? Number(line.LineNum) : undefined,
          treeType: line.TreeType || '',
          parentLineNum: line.ParentLineNum != null && Number(line.ParentLineNum) >= 0
            ? Number(line.ParentLineNum)
            : null,
          itemNo: line.ItemCode,
          itemDescription: line.Dscription || '',
          hsnCode: hsnCode,
          sacCode: line.SACCode || line.SACServiceName || line.SACServiceCode || (line.SACEntry != null ? String(line.SACEntry) : ''),
          sacEntry: line.SACEntry != null ? String(line.SACEntry) : '',
          sacServiceName: line.SACServiceName || '',
          sacServiceCode: line.SACServiceCode || '',
          quantity: String(line.Quantity || 0),
          unitPrice: displayUnitPrice,
          forRate: savedForRate !== '' ? String(savedForRate) : calculatedForRate,
          unitPriceUdf: savedUnitPriceUdf != null && savedUnitPriceUdf !== '' ? String(savedUnitPriceUdf) : '',
          sellerQuality: lineUdf.U_Seller_Quality || line.SellerQuality || '',
          buyerQuality: lineUdf.U_Buyer_Quality || line.BuyerQuality || '',
          sellerPrice: lineUdf.U_Seller_Price || line.SellerPrice || '',
          buyerPrice: lineUdf.U_Buyer_Price || line.BuyerPrice || '',
          sellerDelivery: lineUdf.U_Seller_Delivery || line.SellerDelivery || '',
          buyerDelivery: lineUdf.U_Buyer_Delivery || line.BuyerDelivery || '',
          sellerBrokerageAmtPer: lineUdf.U_Sel_Brok_AP || line.SellerBrokerageAmtPer || '',
          sellerBrokeragePercent: lineUdf.U_Seller_Brok_Per != null ? String(lineUdf.U_Seller_Brok_Per) : (line.SellerBrokeragePercent != null ? String(line.SellerBrokeragePercent) : ''),
          sellerBrokerage: lineUdf.U_Brok_Seller != null ? String(lineUdf.U_Brok_Seller) : (line.SellerBrokerage != null ? String(line.SellerBrokerage) : ''),
          buyerBrokerage: lineUdf.U_Brok_Buyer != null ? String(lineUdf.U_Brok_Buyer) : (line.BuyerBrokerage != null ? String(line.BuyerBrokerage) : ''),
          stcode: lineUdf.U_SELLTCODE || '',
          specialRebate: lineUdf.U_SPLRBT != null ? String(lineUdf.U_SPLRBT) : (line.SpecialRebate != null ? String(line.SpecialRebate) : ''),
          commission: lineUdf.U_COMPRC != null ? String(lineUdf.U_COMPRC) : (line.Commission != null ? String(line.Commission) : ''),
          sellerBrokeragePerQty: lineUdf.U_S_BrokPerQty != null ? String(lineUdf.U_S_BrokPerQty) : (line.SellerBrokeragePerQty != null ? String(line.SellerBrokeragePerQty) : ''),
          buyerPaymentTerms: lineUdf.U_Buyer_Payment_Terms || line.BuyerPaymentTerms || '',
          sellerPaymentTerms: lineUdf.U_Seller_Payment_Term || line.SellerPaymentTerm || '',
          qtySpecialInstruction: lineUdf.U_Seller_SPINS || line.QtySpecialInstruction || line.SellerSpecialInstruction || '',
          deliverySpecialInstruction: lineUdf.U_Buyer_SPINS || line.DeliverySpecialInstruction || line.BuyerSpecialInstruction || '',
          buyerSpecialInstruction: lineUdf.U_Buyer_SPINS || line.BuyerSpecialInstruction || '',
          sellerSpecialInstruction: lineUdf.U_Seller_SPINS || line.SellerSpecialInstruction || '',
          buyerBillDiscount: lineUdf.U_Buyer_Bill_Disc != null ? String(lineUdf.U_Buyer_Bill_Disc) : (line.BuyerBillDiscount != null ? String(line.BuyerBillDiscount) : ''),
          sellerBillDiscount: lineUdf.U_Seller_Bill_Disc != null ? String(lineUdf.U_Seller_Bill_Disc) : (line.SellerBillDiscount != null ? String(line.SellerBillDiscount) : ''),
          sellerItem: lineUdf.U_S_Item || line.SellerItem || '',
          sellerQty: lineUdf.U_S_Qty != null ? String(lineUdf.U_S_Qty) : (line.SellerQty != null ? String(line.SellerQty) : ''),
          freightPurchase: lineUdf.U_Freight_pur != null ? String(lineUdf.U_Freight_pur) : (line.FreightPurchase != null ? String(line.FreightPurchase) : ''),
          freightSales: lineUdf.U_Freight_sales != null ? String(lineUdf.U_Freight_sales) : (line.FreightSales != null ? String(line.FreightSales) : ''),
          freightProvider: lineUdf.U_Fr_trans || line.FreightProvider || '',
          freightProviderName: lineUdf.U_Fr_trans_name || line.FreightProviderName || '',
          brokerageNumber: lineUdf.U_BDNum || line.BrokerageNumber || '',
          uomCode: line.UomCode || '',
          uomName: line.UomName || line.UomCode || '',
          uomEntry: line.UoMEntry != null ? Number(line.UoMEntry) : null,
          uomFactor: line.UomFactor != null && line.UomFactor !== '' ? Number(line.UomFactor) : 1,
          inStock: line.InStock != null ? String(line.InStock) : '',
          qtyInWhse: line.QuantityInWarehouse != null ? String(line.QuantityInWarehouse) : '',
          discountAmount: displayDiscountAmount,
          stdDiscount: String(line.LineDiscPrcnt || ''),
          taxCode: line.TaxCode || '',
          total: String(line.LineTotal || 0),
          taxAmount: String(line.LineTaxAmount || 0),
          whse: line.WhsCode || '',
          // RDR1 has no branch column in many SAP B1 companies. The document
          // branch is stored on ORDR and shown on each row in the SAP client.
          branch: header.BPLId != null ? String(header.BPLId) : '',
          distRule: line.DistributionRule || '',
          distRule2: line.DistributionRule2 || '',
          distRule3: line.DistributionRule3 || '',
          distRule4: line.DistributionRule4 || '',
          distRule5: line.DistributionRule5 || '',
          cogsDistRule: line.COGSDistributionRule || '',
          cogsDistRule2: line.COGSDistributionRule2 || '',
          cogsDistRule3: line.COGSDistributionRule3 || '',
          cogsDistRule4: line.COGSDistributionRule4 || '',
          cogsDistRule5: line.COGSDistributionRule5 || '',
          glAccount: line.GLAccount || '',
          freeText: line.FreeText || '',
          countryOfOrigin: line.CountryOfOrigin || '',
          loc: line.LocationCode != null ? String(line.LocationCode) : '',
          blanketAgreementNo: line.BlanketAgreementNo != null ? String(line.BlanketAgreementNo) : '',
          blanketAgreementLine: line.BlanketAgreementLine != null ? String(line.BlanketAgreementLine) : '',
          commPercent: line.CommissionPercent != null ? String(line.CommissionPercent) : '',
          grossTotal: line.GrossTotal != null ? String(line.GrossTotal) : '',
          lineShippingType: line.LineShippingType != null ? String(line.LineShippingType) : '',
          lineDeliveryDate: formatSapDate(line.LineDeliveryDate),
          wTaxLiable: line.WTaxLiable || '',
          taxLiable: line.TaxLiable || '',
          withoutQtyPosting: line.WithoutQtyPosting || '',
          enableSettingCost: line.EnableSettingCost || '',
          returnCost: line.ReturnCost != null ? String(line.ReturnCost) : '',
          openQty: line.OpenQuantity != null ? String(line.OpenQuantity) : '',
          deliveredQty: line.DeliveredQuantity != null ? String(line.DeliveredQuantity) : '',
          documentCreated: formatSapDate(line.DocumentCreated),
          batches: batchesByLine[line.LineNum] || [],
          udf: {
            ...lineUdf,
            U_Brand: lineUdf.U_Brand || '',
            U_Origin: lineUdf.U_Origin || '',
            U_PackSize: lineUdf.U_PackSize || '',
            U_QcStatus: lineUdf.U_QcStatus || 'Pending',
            U_SPLRBT: lineUdf.U_SPLRBT ?? '',
            U_COMPRC: lineUdf.U_COMPRC ?? '',
            U_S_BrokPerQty: lineUdf.U_S_BrokPerQty ?? '',
            U_Unit_Price: lineUdf.U_Unit_Price ?? '',
            U_Rate: lineUdf.U_Rate != null && String(lineUdf.U_Rate).trim() !== ''
              ? lineUdf.U_Rate
              : displayDiscountAmount,
            U_Brok_Seller: lineUdf.U_Brok_Seller ?? '',
            U_Brok_Buyer: lineUdf.U_Brok_Buyer ?? '',
            U_Buyer_Delivery: lineUdf.U_Buyer_Delivery || '',
            U_Seller_Delivery: lineUdf.U_Seller_Delivery || '',
            U_Buyer_Payment_Terms: lineUdf.U_Buyer_Payment_Terms || '',
            U_Seller_Payment_Term: lineUdf.U_Seller_Payment_Term || '',
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
          },
        };
      }),
    },
  };
  
  console.log('🔍 [Backend] Returning header fields:');
  console.log('  - salesEmployee (SlpCode):', result.sales_order.header.salesEmployee);
  console.log('  - purchaser (SlpName):', result.sales_order.header.purchaser);
  console.log('  - owner (OwnerName):', result.sales_order.header.owner);
  console.log('  - freight:', result.sales_order.header.freight);
  console.log('  - remarks:', result.sales_order.header.remarks);
  console.log('  - otherInstruction:', result.sales_order.header.otherInstruction);
  
  return result;
};

// ── OPEN SALES ORDERS (FOR COPY FROM) ────────────────────────────────────────

const getOpenSalesOrders = (customerCode = '') => {
  const normalizedCustomerCode = String(customerCode || '').trim();
  const params = {};
  const customerFilter = normalizedCustomerCode ? 'AND T0.CardCode = @customerCode' : '';
  if (normalizedCustomerCode) {
    params.customerCode = normalizedCustomerCode;
  }

  return safe(db.query(`
  SELECT TOP 200
    T0.DocEntry,
    T0.DocNum,
    T0.DocDate,
    T0.DocDueDate,
    T0.CardCode,
    T0.CardName,
    T0.Comments,
    T0.DocTotal
  FROM ORDR T0
  WHERE T0.DocStatus = 'O'
    AND T0.CANCELED <> 'Y'
    ${customerFilter}
  ORDER BY T0.DocDate DESC, T0.DocNum DESC
`, params));
};

const getSalesOrderForCopy = async (docEntry) => {
  const headerFieldMetadata = await getTableFieldMetadata('ORDR');
  const lineFieldMetadata = await getSalesOrderLineFieldMetadata();
  const sacFieldMetadata = await getTableFieldMetadata('OSAC');
  const sqlAlias = (alias) => `[${String(alias || '').replace(/]/g, ']]')}]`;
  const headerBplColumn = resolveTableColumnName(headerFieldMetadata, 'BPLId')
    || resolveTableColumnName(headerFieldMetadata, 'BPL_IDAssignedToInvoice');
  const headerAssignedBplColumn = resolveTableColumnName(headerFieldMetadata, 'BPL_IDAssignedToInvoice')
    || headerBplColumn;
  const headerBplField = headerBplColumn
    ? `T0.${quoteSqlIdentifier(headerBplColumn)}`
    : 'NULL';
  const headerBranchField = headerAssignedBplColumn
    ? `T0.${quoteSqlIdentifier(headerAssignedBplColumn)}`
    : 'NULL';
  const paymentMethodColumn = resolveTableColumnName(headerFieldMetadata, 'PeyMethod');
  const paymentMethodExpression = paymentMethodColumn ? `T0.${quoteSqlIdentifier(paymentMethodColumn)}` : "''";
  const lineField = (columnName, alias, fallback = "''") => (
    resolveTableColumnName(lineFieldMetadata, columnName)
      ? `T0.${quoteSqlIdentifier(resolveTableColumnName(lineFieldMetadata, columnName))} AS ${sqlAlias(alias)}`
      : `${fallback} AS ${sqlAlias(alias)}`
  );
  const resolveLineColumn = (candidates = []) => candidates
    .map((candidate) => resolveTableColumnName(lineFieldMetadata, candidate))
    .find(Boolean);
  const treeTypeColumn = resolveLineColumn(['TreeType', 'TreeTyp']);
  const parentLineNumColumn = resolveLineColumn(['ParentLineNum', 'ParentLnNum', 'ParentLine']);
  const forRateColumnName = resolveForRateColumnName(lineFieldMetadata);
  const forRateExpression = forRateColumnName ? `T0.${quoteSqlIdentifier(forRateColumnName)}` : "''";
  const sacSql = getSacLookupSqlParts('T0', 'SAC', sacFieldMetadata, lineFieldMetadata);

  const headerResult = await db.query(`
    SELECT
      T0.DocEntry, T0.DocNum, T0.DocDate, T0.CreateDate AS DocumentCreated, T0.DocDueDate, T0.TaxDate,
      T0.CardCode, T0.CardName, T0.CntctCode,
      T0.NumAtCard, T0.Comments,
      T0.Address, T0.Address2, T0.ShipToCode, T0.PayToCode,
      ${headerBplField} AS BPLId,
      ${headerBranchField} AS BPL_IDAssignedToInvoice,
      T0.GroupNum, T0.SlpCode,
      T0.DiscPrcnt, T0.RoundDif, T0.TotalExpns AS Freight,
      ${paymentMethodExpression} AS PaymentMethod,
      ${optionalHeaderColumn(headerFieldMetadata, ['TransCat', 'TransactionCategory'], 'TransactionCategory')},
      ${optionalHeaderColumn(headerFieldMetadata, ['FormNo', 'TaxFormNo'], 'TaxFormNo')},
      ${optionalHeaderColumn(headerFieldMetadata, ['DutyStatus'], 'DutyStatus')},
      ${optionalHeaderColumn(headerFieldMetadata, ['Export', 'IsExport', 'Exported'], 'ExportFlag')},
      ${optionalHeaderColumn(headerFieldMetadata, ['DiffPercent', 'DifferentialTaxRate', 'DiffTaxRate'], 'DifferentialTaxRate', "'100'")},
      ${optionalHeaderColumn(headerFieldMetadata, ['SupplySec7', 'SupplUnSec', 'SupplyCovered'], 'SupplyCovered')},
      T0.VatSum AS TaxAmount, T0.DocCur, T0.DocRate, T0.DocTotal
    FROM ORDR T0
    WHERE T0.DocEntry = @DocEntry
  `, { DocEntry: docEntry });

  const linesResult = await db.query(`
    SELECT
      T0.LineNum, T0.ItemCode,
      ${treeTypeColumn ? `T0.${quoteSqlIdentifier(treeTypeColumn)}` : "''"} AS TreeType,
      ${parentLineNumColumn ? `T0.${quoteSqlIdentifier(parentLineNumColumn)}` : 'NULL'} AS ParentLineNum,
      T0.Dscription AS ItemDescription,
      T0.OpenQty AS Quantity,
      T0.Quantity AS OrderedQuantity,
      COALESCE(NULLIF(T0.PriceBefDi, 0), T0.Price, T0.PriceBefDi, 0) AS UnitPrice,
      T0.Price AS Price,
      ${lineField('StockPrice', 'ItemCost', 'ITM.AvgPrice')},
      T0.DiscPrcnt AS DiscountPercent,
      T0.WhsCode AS WarehouseCode,
      ITM.ManBtchNum AS BatchManaged,
      ITM.ManSerNum AS SerialManaged,
      ITM.InvntryUom AS InventoryUOM,
      T0.TaxCode, T0.unitMsr AS UomCode, T0.unitMsr AS UomName,
      ${lineField('NumPerMsr', 'UomFactor', 'CAST(1 AS DECIMAL(19, 6))')},
      ${lineField('UomEntry', 'UoMEntry', 'NULL')},
      T0.OcrCode AS DistributionRule,
      ${lineField('OcrCode2', 'DistributionRule2')},
      ${lineField('OcrCode3', 'DistributionRule3')},
      ${lineField('OcrCode4', 'DistributionRule4')},
      ${lineField('OcrCode5', 'DistributionRule5')},
      ${lineField('SACEntry', 'SACEntry', 'NULL')},
      ${sacSql.displayExpression} AS SACCode,
      ${sacSql.serviceNameColumn} AS SACServiceName,
      ${sacSql.serviceCodeColumn} AS SACServiceCode,
      ${lineField('FreeTxt', 'FreeText')},
      ${lineField('CountryOrg', 'CountryOfOrigin')},
      ${lineField('LocCode', 'LocationCode', 'NULL')},
      T0.OpenQty AS OpenQty,
      ${forRateExpression} AS ForRate,
      CAST((ISNULL(T0.Quantity, 0) - ISNULL(T0.OpenQty, 0)) AS DECIMAL(19, 6)) AS DeliveredQty,
      CASE
        WHEN ISNULL(T0.Quantity, 0) = 0 THEN ISNULL(T0.LineTotal, 0)
        ELSE ISNULL(T0.LineTotal, 0) * ISNULL(T0.OpenQty, 0) / NULLIF(T0.Quantity, 0)
      END AS LineTotal,
      CASE
        WHEN ISNULL(T0.Quantity, 0) = 0 THEN ISNULL(T0.VatSum, 0)
        ELSE ISNULL(T0.VatSum, 0) * ISNULL(T0.OpenQty, 0) / NULLIF(T0.Quantity, 0)
      END AS TaxAmount,
      CHP.ChapterID AS HSNCode,
      T0.DocEntry AS BaseEntry,
      T0.LineNum AS BaseLine,
      17 AS BaseType,
      ${lineField('U_SPLRBT', 'SpecialRebate')},
      ${lineField('U_COMPRC', 'Commission')},
      ${lineField('U_S_BrokPerQty', 'SellerBrokeragePerQty')},
      ${lineField('U_Unit_Price', 'UnitPriceUdf', "''")},
      ${lineField('U_Rate', 'DiscountAmount', 'CAST(NULL AS DECIMAL(19, 6))')},
      ${lineField('U_Brok_Seller', 'SellerBrokerage')},
      ${lineField('U_Brok_Buyer', 'BuyerBrokerage')},
      ${lineField('U_Buyer_Delivery', 'BuyerDelivery')},
      ${lineField('U_Seller_Delivery', 'SellerDelivery')},
      ${lineField('U_Buyer_Payment_Terms', 'BuyerPaymentTerms')},
      ${lineField('U_Buyer_Quality', 'BuyerQuality')},
      ${lineField('U_Seller_Quality', 'SellerQuality')},
      ${lineField('U_Buyer_Price', 'BuyerPrice')},
      ${lineField('U_Seller_Price', 'SellerPrice')},
      ${lineField('U_Buyer_SPINS', 'BuyerSpecialInstruction')},
      ${lineField('U_Seller_SPINS', 'SellerSpecialInstruction')},
      ${lineField('U_Seller_SPINS', 'QtySpecialInstruction')},
      ${lineField('U_Buyer_SPINS', 'DeliverySpecialInstruction')},
      ${lineField('U_Sel_Brok_AP', 'SellerBrokerageAmtPer')},
      ${lineField('U_Seller_Brok_Per', 'SellerBrokeragePercent')},
      ${lineField('U_Buyer_Bill_Disc', 'BuyerBillDiscount')},
      ${lineField('U_Seller_Bill_Disc', 'SellerBillDiscount')},
      ${lineField('U_SELLTCODE', 'STCODE')},
      ${lineField('U_S_Item', 'SellerItem')},
      ${lineField('U_S_Qty', 'SellerQty')},
      ${lineField('U_Freight_pur', 'FreightPurchase')},
      ${lineField('U_Freight_sales', 'FreightSales')},
      ${lineField('U_Fr_trans', 'FreightProvider')},
      ${lineField('U_Fr_trans_name', 'FreightProviderName')},
      ${lineField('U_BDNum', 'BrokerageNumber')}
    FROM RDR1 T0
    LEFT JOIN OITM ITM ON T0.ItemCode = ITM.ItemCode
    LEFT JOIN OCHP CHP ON ITM.ChapterID = CHP.AbsEntry
    ${sacSql.joinSql}
    WHERE T0.DocEntry = @DocEntry
      AND T0.LineStatus = 'O'
      AND T0.OpenQty > 0
    ORDER BY T0.LineNum
  `, { DocEntry: docEntry });

  const header = headerResult.recordset?.[0] || {};
  const resolvedDocEntry = header.DocEntry || docEntry;
  const [metadataHeaderUdfs, metadataLineUdfsByLineNum, physicalHeaderUdfs, physicalLineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'ORDR', keyValue: resolvedDocEntry }),
    getLineUdfValues({ tableId: 'RDR1', keyValue: resolvedDocEntry }),
    getPhysicalUdfValues({ tableName: 'ORDR', keyValue: resolvedDocEntry }),
    getPhysicalUdfValues({ tableName: 'RDR1', keyValue: resolvedDocEntry, includeLineNum: true }),
  ]);
  const headerUdfs = {
    ...metadataHeaderUdfs,
    ...physicalHeaderUdfs,
  };
  const batchRows = await safe(db.query(`
    SELECT BaseLinNum AS BaseLineNum, BatchNum, Quantity
    FROM   IBT1
    WHERE  BaseEntry = @DocEntry
      AND  BaseType = 17
    ORDER  BY BaseLinNum, BatchNum
  `, { DocEntry: resolvedDocEntry }));
  const batchesByLine = {};
  batchRows.forEach((batch) => {
    if (!batchesByLine[batch.BaseLineNum]) {
      batchesByLine[batch.BaseLineNum] = [];
    }
    batchesByLine[batch.BaseLineNum].push({
      batchNumber: batch.BatchNum || '',
      quantity: String(batch.Quantity || 0),
    });
  });
  const documentLines = (linesResult.recordset || []).map((line) => ({
    ...line,
    batches: batchesByLine[line.LineNum] || [],
    udf: {
      ...(metadataLineUdfsByLineNum[line.LineNum] || {}),
      ...(physicalLineUdfsByLineNum[line.LineNum] || {}),
    },
  }));

  return {
    ...header,
    header_udfs: headerUdfs,
    headerUdfs,
    freightCharges: (await getFreightCharges(resolvedDocEntry)).filter(row => Number(row.LineTotal || 0) !== 0),
    DocumentLines: documentLines,
  };
};

module.exports = {
  getReferenceData,
  getCustomerDetails,
  searchCustomers,
  getItemDetails,
  getSalesOrderLineFieldMetadata,
  resolveSalesOrderLineUomEntry,
  getTaxCodeDiagnostics,
  getLookupValues,
  getUdfLinkedTableLookupOptions,
  createLookupValue,
  getCompanyCurrencyInfo,
  getCurrencies,
  getExchangeRateRows,
  getSalesOrderList,
  getSalesOrderFilterOptions,
  getReferenceDocumentLookup,
  getSalesOrder,
  getDocumentSeries,
  getNextNumber,
  getStateFromAddress,
  getItemsForModal,
  getFreightCharges,
  getSalesOrderPrintLayouts,
  getOpenSalesOrders,
  getSalesOrderForCopy,
  _resolveSavedLineUnitPrice: resolveSavedLineUnitPrice,
};
