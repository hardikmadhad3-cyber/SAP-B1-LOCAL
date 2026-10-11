export const SALES_DOCUMENT_SCHEMA_DOCUMENT_TYPE = 'SALES_ORDER';
export const SALES_DOCUMENT_SCHEMA_OBJECT_TYPE = '17';
export const SALES_DOCUMENT_SCHEMA_HEADER_TABLE = 'ORDR';
export const SALES_DOCUMENT_SCHEMA_LINE_TABLE = 'RDR1';

export const SALES_DOCUMENT_SCHEMA_TYPES = Object.freeze({
  SALES_QUOTATION: Object.freeze({ objectType: '23', headerTable: 'OQUT', lineTable: 'QUT1' }),
  SALES_ORDER: Object.freeze({ objectType: '17', headerTable: 'ORDR', lineTable: 'RDR1' }),
  DELIVERY: Object.freeze({ objectType: '15', headerTable: 'ODLN', lineTable: 'DLN1' }),
  AR_INVOICE: Object.freeze({ objectType: '13', headerTable: 'OINV', lineTable: 'INV1' }),
  AR_CREDIT_MEMO: Object.freeze({ objectType: '14', headerTable: 'ORIN', lineTable: 'RIN1' }),
  PURCHASE_REQUEST: Object.freeze({ objectType: '1470000113', headerTable: 'OPRQ', lineTable: 'PRQ1', purchaseDocument: true }),
  PURCHASE_QUOTATION: Object.freeze({ objectType: '540000006', headerTable: 'OPQT', lineTable: 'PQT1', purchaseDocument: true }),
  PURCHASE_ORDER: Object.freeze({ objectType: '22', headerTable: 'OPOR', lineTable: 'POR1', purchaseDocument: true }),
  GRPO: Object.freeze({ objectType: '20', headerTable: 'OPDN', lineTable: 'PDN1', purchaseDocument: true }),
  AP_INVOICE: Object.freeze({ objectType: '18', headerTable: 'OPCH', lineTable: 'PCH1', purchaseDocument: true }),
  AP_CREDIT_MEMO: Object.freeze({ objectType: '19', headerTable: 'ORPC', lineTable: 'RPC1', purchaseDocument: true }),
  SERVICE_AR_INVOICE: Object.freeze({ objectType: '13', headerTable: 'OINV', lineTable: 'INV1', serviceLineMode: true }),
  SERVICE_AR_CREDIT_MEMO: Object.freeze({ objectType: '14', headerTable: 'ORIN', lineTable: 'RIN1', serviceLineMode: true }),
  SERVICE_AP_INVOICE: Object.freeze({ objectType: '18', headerTable: 'OPCH', lineTable: 'PCH1', serviceLineMode: true }),
  SERVICE_AP_CREDIT_MEMO: Object.freeze({ objectType: '19', headerTable: 'ORPC', lineTable: 'RPC1', serviceLineMode: true }),
});

export const SALES_DOCUMENT_SCHEMA_LOOKUP_SOURCES = new Set([
  'items',
  'business-partners',
  'warehouses',
  'tax-codes',
  'uom-codes',
  'distribution-rules',
  'sales-employees',
  'owners',
  'shipping-types',
  'sac-codes',
  'hsn-codes',
  'countries',
  'udf-valid-values',
  'sap-user-values',
  'udf-linked-table',
  'udo',
]);

export const SALES_DOCUMENT_SCHEMA_LOOKUP_LIMIT = 100;

export const getSalesDocumentFieldKey = (field = {}) => String(
  field.stateKey || field.sapField || field.databaseField || field.id || '',
).trim();

export const normalizeSalesDocumentSchemaField = (field = {}, index = 0) => ({
  ...field,
  id: field.id || `${field.tableName || 'FIELD'}.${field.sapField || field.databaseField || field.stateKey || index}`,
  stateKey: getSalesDocumentFieldKey(field),
  order: Number.isFinite(Number(field.order)) ? Number(field.order) : index + 1,
  options: Array.isArray(field.options) ? field.options.map((option) => (
    typeof option === 'object'
      ? { ...option, value: String(option.value ?? ''), label: String(option.label ?? option.description ?? option.value ?? '') }
      : { value: String(option), label: String(option) }
  )) : [],
});

export const normalizeSalesDocumentSchema = (schema = {}, requestedDocumentType = SALES_DOCUMENT_SCHEMA_DOCUMENT_TYPE) => {
  const documentType = String(schema.documentType || requestedDocumentType || SALES_DOCUMENT_SCHEMA_DOCUMENT_TYPE).toUpperCase();
  const defaults = SALES_DOCUMENT_SCHEMA_TYPES[documentType] || SALES_DOCUMENT_SCHEMA_TYPES.SALES_ORDER;
  return ({
  ...schema,
  documentType,
  objectType: String(schema.objectType || defaults.objectType),
  headerTable: schema.headerTable || defaults.headerTable,
  lineTable: schema.lineTable || defaults.lineTable,
  schemaVersion: String(schema.schemaVersion || ''),
  headerFields: (schema.headerFields || [])
    .map(normalizeSalesDocumentSchemaField)
    .sort((a, b) => a.order - b.order),
  lineFields: (schema.lineFields || [])
    .map(normalizeSalesDocumentSchemaField)
    .sort((a, b) => a.order - b.order),
  });
};
