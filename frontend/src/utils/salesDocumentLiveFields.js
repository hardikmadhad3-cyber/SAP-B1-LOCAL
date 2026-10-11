import {
  buildSalesOrderMatrixColumnsFromLayout,
  buildSalesOrderMatrixColumnsFromSchema,
  buildSalesOrderRowUdfDefinitionsFromSchema,
  getSapStandardSalesMatrixColumns,
  mapLiveSalesOrderMatrixToLayout,
} from '../modules/sales-order/documentLayout';
import { normalizeSalesDocumentSchema } from './salesDocumentSchema';

const normalizeCompanyValue = (value) => String(value ?? '').trim().toLowerCase();

export const getSalesDocumentCompanyScopeKey = ({ companyId = '', companyDb = '' } = {}) => (
  `${String(companyId ?? '').trim()}::${normalizeCompanyValue(companyDb)}`
);

export const isSalesDocumentFieldMetadataReady = ({
  companyId = '',
  companyDb = '',
  hydratedScope = '',
} = {}) => {
  if (!String(companyId ?? '').trim() && !String(companyDb ?? '').trim()) return false;
  if (!String(hydratedScope || '').trim()) return false;
  return hydratedScope === getSalesDocumentCompanyScopeKey({ companyId, companyDb });
};

const normalizeFieldName = (value) => (
  String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '')
);

const getPhysicalFieldNames = (field = {}) => (
  [field.sapField, field.databaseField, field.stateKey]
    .map(normalizeFieldName)
    .filter(Boolean)
);

const isUdfFieldName = (value) => normalizeFieldName(value).startsWith('U_');

const getLayoutFieldNames = (column = {}) => (
  [column.fieldName, column.columnUid, column.sapField, column.databaseField]
    .map(normalizeFieldName)
    .filter(Boolean)
);

export const isSalesDocumentSchemaForCompany = (
  schema,
  { companyId = '', companyDb = '' } = {},
) => {
  if (!schema) return false;

  const schemaCompanyId = schema.companyId;
  if (
    schemaCompanyId !== undefined
    && schemaCompanyId !== null
    && String(schemaCompanyId) !== String(companyId)
  ) {
    return false;
  }

  const schemaCompanyDb = normalizeCompanyValue(schema.companyDb);
  const activeCompanyDb = normalizeCompanyValue(companyDb);
  return !schemaCompanyDb || !activeCompanyDb || schemaCompanyDb === activeCompanyDb;
};

// SAP layout metadata can outlive a UDF or can be cached for another company.
// Standard fields are safe to retain, but a UDF is rendered only when the
// current-company physical schema confirms its exact database field name.
export const filterLayoutToCurrentSchema = (layoutColumns = [], schemaLineFields = []) => {
  const confirmedUdfs = new Set(
    (schemaLineFields || [])
      .flatMap(getPhysicalFieldNames)
      .filter(isUdfFieldName),
  );

  return (layoutColumns || []).filter((column) => {
    const fieldNames = getLayoutFieldNames(column);
    const isUdf = Boolean(column?.isUdf) || fieldNames.some(isUdfFieldName);
    if (!isUdf) return true;
    return fieldNames.some((fieldName) => confirmedUdfs.has(fieldName));
  });
};

export const stripSalesDocumentTopLevelUdfs = (record = {}) => (
  Object.entries(record || {}).reduce((clean, [key, value]) => {
    if (!isUdfFieldName(key)) clean[key] = value;
    return clean;
  }, {})
);

export const buildSalesDocumentLiveFields = ({
  schema,
  documentType,
  objectType,
  headerTable,
  lineTable,
  companyId,
  companyDb,
  layoutResponse,
  referenceMatrixColumns = [],
  referenceSapForm = {},
  includeLineNumber = true,
  safeFallbackMatrixColumns = [],
  useSafeFallbackWithoutLayout = false,
} = {}) => {
  const schemaMatchesCompany = isSalesDocumentSchemaForCompany(schema, { companyId, companyDb });
  const normalizedSchema = schemaMatchesCompany
    ? normalizeSalesDocumentSchema(schema, documentType)
    : null;
  const schemaHeaderFields = normalizedSchema?.headerFields || [];
  const schemaLineFields = normalizedSchema?.lineFields || [];
  const headerUdfFields = buildSalesOrderRowUdfDefinitionsFromSchema(schemaHeaderFields, { lineTable: headerTable });
  const rowUdfFields = buildSalesOrderRowUdfDefinitionsFromSchema(schemaLineFields, { lineTable });
  const sapStandardColumns = getSapStandardSalesMatrixColumns();
  const schemaMatrixColumns = buildSalesOrderMatrixColumnsFromSchema({
    schemaLineFields,
    liveMatrixColumns: Array.isArray(referenceMatrixColumns) && referenceMatrixColumns.length
      ? referenceMatrixColumns
      : sapStandardColumns,
    rowUdfFields,
    lineTable,
  });

  const layout = layoutResponse?.data || layoutResponse || {};
  const layoutSource = String(layout.source || '').trim().toLowerCase();
  const importedLayoutColumns = layoutSource && layoutSource !== 'fallback'
    ? filterLayoutToCurrentSchema(layout.columns || [], schemaLineFields)
    : [];
  const hasSapMatrixPreferences = Number(referenceSapForm?.preferenceRows || 0) > 0;
  const liveReferenceLayout = hasSapMatrixPreferences
    ? filterLayoutToCurrentSchema(
        mapLiveSalesOrderMatrixToLayout(referenceMatrixColumns),
        schemaLineFields,
      )
    : [];
  const effectiveLayoutColumns = importedLayoutColumns.length
    ? importedLayoutColumns
    : liveReferenceLayout;
  const verifiedColumns = schemaMatrixColumns.length ? schemaMatrixColumns : sapStandardColumns;
  const safeFallbackColumns = Array.isArray(safeFallbackMatrixColumns) && safeFallbackMatrixColumns.length
    ? safeFallbackMatrixColumns
    : sapStandardColumns;
  // The current-company schema validates field identity. When SAP supplies an
  // explicit form layout, show only its columns; otherwise use the live schema.
  // A page-specific safe list is only an outage fallback.
  const matrixColumns = effectiveLayoutColumns.length
      ? buildSalesOrderMatrixColumnsFromLayout({
        layoutColumns: effectiveLayoutColumns,
        liveMatrixColumns: verifiedColumns,
        rowUdfFields,
        includeLineNumber,
        appendMissingLiveColumns: false,
      })
    : schemaMatrixColumns.length
      ? buildSalesOrderMatrixColumnsFromLayout({
          layoutColumns: [],
          liveMatrixColumns: schemaMatrixColumns,
          rowUdfFields,
          includeLineNumber,
        })
    : useSafeFallbackWithoutLayout
      ? buildSalesOrderMatrixColumnsFromLayout({
          layoutColumns: [],
          liveMatrixColumns: safeFallbackColumns,
          rowUdfFields: [],
          includeLineNumber,
        })
      : buildSalesOrderMatrixColumnsFromLayout({
          layoutColumns: [],
          liveMatrixColumns: sapStandardColumns,
          rowUdfFields: [],
          includeLineNumber,
        });

  return {
    documentType,
    objectType: String(objectType || normalizedSchema?.objectType || ''),
    schemaMatchesCompany,
    liveSchema: normalizedSchema,
    headerUdfFields,
    rowUdfFields,
    matrixColumns,
    sourceMatrixColumns: Array.isArray(referenceMatrixColumns) ? referenceMatrixColumns : [],
    importedLayout: layout,
    liveAvailable: Boolean(normalizedSchema && schemaLineFields.length),
    usedSapLayout: Boolean(effectiveLayoutColumns.length),
    usedSafeFallback: Boolean(
      useSafeFallbackWithoutLayout
      && !effectiveLayoutColumns.length
      && !schemaMatrixColumns.length
    ),
  };
};

const normalizeLookupOptions = (response = {}) => (
  (response.items || response.options || []).map((option) => ({
    ...(typeof option === 'object' ? option : {}),
    value: String(typeof option === 'object' ? option?.value ?? '' : option ?? ''),
    label: String(
      typeof option === 'object'
        ? option?.label ?? option?.description ?? option?.value ?? ''
        : option ?? '',
    ),
    description: String(typeof option === 'object' ? option?.description ?? '' : ''),
  }))
);

export const loadSalesDocumentFieldLookupOptions = async ({
  fetchLookup,
  source,
  field = {},
  line = {},
  documentType,
  schemaVersion = '',
  limit = 100,
} = {}) => {
  if (typeof fetchLookup !== 'function') return [];

  const normalizedSource = String(source || '').trim().toLowerCase();
  const schemaLookupSource = String(field.lookup?.source || '').trim().toLowerCase();
  const lookupSource = normalizedSource.startsWith('udf:')
    ? (schemaLookupSource || (field.lookupTable || field.linkedTable ? 'udf-linked-table' : ''))
    : normalizedSource;
  if (!lookupSource) return Array.isArray(field.options) ? field.options : [];

  const fieldId = field.lookup?.fieldId
    || field.schemaFieldId
    || field.id
    || (field.tableId && field.key ? `${field.tableId}.${field.key}` : '');
  const options = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const response = await fetchLookup(lookupSource, {
      limit,
      page,
      fieldId,
      schemaVersion,
      itemCode: line.itemNo || line.ItemCode || '',
      documentType,
    });
    const nextOptions = normalizeLookupOptions(response);
    options.push(...nextOptions);
    hasMore = Boolean(response?.hasMore) && nextOptions.length > 0;
    page += 1;
  }
  return options;
};
