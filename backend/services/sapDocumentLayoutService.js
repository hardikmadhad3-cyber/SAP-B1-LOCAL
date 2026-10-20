const authDbService = require('./authDbService');
const db = require('./dbService');
const { getUdfDefinitions } = require('./udfMetadataService');
const {
  findCprfStandardDefinition,
  findCprfUdfDefinition,
  getSalesDocumentCprfDefinitions,
  getLayoutColumnDedupeKey,
  mergeDuplicateCprfLayoutColumns,
  selectEffectiveCprfRows,
} = require('./sapFormPreferenceUtils');
const salesOrderDbService = require('./salesOrderDbService');
const salesQuotationDbService = require('./salesQuotationDbService');
const deliveryDbService = require('./deliveryDbService');
const arInvoiceDbService = require('./arInvoiceDbService');
const arCreditMemoDbService = require('./arCreditMemoDbService');
const purchaseOrderDbService = require('./purchaseOrderDbService');
const purchaseQuotationDbService = require('./purchaseQuotationDbService');
const grpoDbService = require('./grpoDbService');
const apInvoiceDbService = require('./apInvoiceDbService');
const apCreditMemoDbService = require('./apCreditMemoDbService');
const serviceArInvoiceDbService = require('./serviceArInvoiceDbService');
const serviceApInvoiceDbService = require('./serviceApInvoiceDbService');
const serviceApCreditMemoDbService = require('./serviceApCreditMemoDbService');
const serviceArCreditMemoDbService = require('./serviceArCreditMemoDbService');

const createCommonFallbackColumns = () => [
  { columnUid: 'LineNum', fieldName: 'LineNum', columnTitle: '#', columnOrder: 1, width: 42, dataType: 'number', isUdf: false },
  { columnUid: 'ItemCode', fieldName: 'ItemCode', columnTitle: 'Item No.', columnOrder: 2, width: 160, dataType: 'string', isUdf: false },
  { columnUid: 'Dscription', fieldName: 'Dscription', columnTitle: 'Item Description', columnOrder: 3, width: 240, dataType: 'string', isUdf: false },
  { columnUid: 'Quantity', fieldName: 'Quantity', columnTitle: 'Quantity', columnOrder: 4, width: 90, dataType: 'number', isUdf: false },
  { columnUid: 'UomName', fieldName: 'UomName', columnTitle: 'UoM Name', columnOrder: 5, width: 120, dataType: 'string', isUdf: false },
  { columnUid: 'HsnCode', fieldName: 'HsnCode', columnTitle: 'HSN', columnOrder: 6, width: 95, dataType: 'string', isUdf: false },
  { columnUid: 'Price', fieldName: 'Price', columnTitle: 'Unit Price', columnOrder: 7, width: 110, dataType: 'number', isUdf: false },
  { columnUid: 'VatGroup', fieldName: 'VatGroup', columnTitle: 'Tax Code', columnOrder: 8, width: 110, dataType: 'string', isUdf: false },
  { columnUid: 'LineTotal', fieldName: 'LineTotal', columnTitle: 'Total (LC)', columnOrder: 9, width: 115, dataType: 'number', isUdf: false },
  { columnUid: 'TotalFrgn', fieldName: 'TotalFrgn', columnTitle: 'Total (Doc)', columnOrder: 10, width: 115, dataType: 'number', isUdf: false },
  { columnUid: 'DiscPrcnt', fieldName: 'DiscPrcnt', columnTitle: 'Discount %', columnOrder: 11, width: 95, dataType: 'number', isUdf: false },
  { columnUid: 'WhsCode', fieldName: 'WhsCode', columnTitle: 'Whse', columnOrder: 12, width: 80, dataType: 'string', isUdf: false },
];

const createPurchaseRequestFallbackColumns = () => [
  { columnUid: 'LineNum', fieldName: 'LineNum', columnTitle: '#', columnOrder: 1, width: 42, dataType: 'number', isUdf: false },
  { columnUid: 'ItemCode', fieldName: 'ItemCode', columnTitle: 'Item No.', columnOrder: 2, width: 130, dataType: 'string', isUdf: false },
  { columnUid: 'LineVendor', fieldName: 'LineVendor', columnTitle: 'Vendor', columnOrder: 3, width: 120, dataType: 'string', isUdf: false },
  { columnUid: 'ReqDate', fieldName: 'ReqDate', columnTitle: 'Required Date', columnOrder: 4, width: 125, dataType: 'date', isUdf: false },
  { columnUid: 'Quantity', fieldName: 'Quantity', columnTitle: 'Required Qty.', columnOrder: 5, width: 100, dataType: 'number', isUdf: false },
  { columnUid: 'Price', fieldName: 'Price', columnTitle: 'Info Price', columnOrder: 6, width: 100, dataType: 'number', isUdf: false },
  { columnUid: 'DiscPrcnt', fieldName: 'DiscPrcnt', columnTitle: 'Discount %', columnOrder: 7, width: 95, dataType: 'number', isUdf: false },
  { columnUid: 'TaxCode', fieldName: 'TaxCode', columnTitle: 'Tax Code', columnOrder: 8, width: 105, dataType: 'string', isUdf: false },
  { columnUid: 'LineTotal', fieldName: 'LineTotal', columnTitle: 'Total (LC)', columnOrder: 9, width: 110, dataType: 'number', isUdf: false },
  { columnUid: 'OcrCode', fieldName: 'OcrCode', columnTitle: 'Distr. Rule', columnOrder: 10, width: 105, dataType: 'string', isUdf: false },
  { columnUid: 'UomCode', fieldName: 'UomCode', columnTitle: 'UoM Code', columnOrder: 11, width: 100, dataType: 'string', isUdf: false },
  { columnUid: 'WhsCode', fieldName: 'WhsCode', columnTitle: 'Whse', columnOrder: 12, width: 85, dataType: 'string', isUdf: false },
  { columnUid: 'CountryOrg', fieldName: 'CountryOrg', columnTitle: 'Country/Region of Origin', columnOrder: 13, width: 180, dataType: 'string', isUdf: false },
  { columnUid: 'LocCode', fieldName: 'LocCode', columnTitle: 'Loc.', columnOrder: 14, width: 85, dataType: 'string', isUdf: false },
];

const createServiceFallbackColumns = () => [
  { columnUid: 'LineNum', fieldName: 'LineNum', columnTitle: '#', columnOrder: 1, width: 42, dataType: 'number', isUdf: false },
  { columnUid: 'Dscription', fieldName: 'Dscription', columnTitle: 'Description', columnOrder: 2, width: 240, dataType: 'string', isUdf: false },
  { columnUid: 'AcctCode', fieldName: 'AcctCode', columnTitle: 'G/L Account', columnOrder: 3, width: 140, dataType: 'string', isUdf: false },
  { columnUid: 'OcrCode', fieldName: 'OcrCode', columnTitle: 'Distr. Rule', columnOrder: 4, width: 120, dataType: 'string', isUdf: false },
  { columnUid: 'TaxCode', fieldName: 'TaxCode', columnTitle: 'Tax Code', columnOrder: 5, width: 115, dataType: 'string', isUdf: false },
  { columnUid: 'WTLiable', fieldName: 'WTLiable', columnTitle: 'WTax Liable', columnOrder: 6, width: 100, dataType: 'yesNo', isUdf: false },
  { columnUid: 'LineTotal', fieldName: 'LineTotal', columnTitle: 'Total (LC)', columnOrder: 7, width: 115, dataType: 'number', isUdf: false },
  { columnUid: 'VatSum', fieldName: 'VatSum', columnTitle: 'Tax Amount (LC)', columnOrder: 8, width: 125, dataType: 'number', isUdf: false },
  { columnUid: 'SacEntry', fieldName: 'SacEntry', columnTitle: 'SAC', columnOrder: 9, width: 95, dataType: 'string', isUdf: false },
  { columnUid: 'LocCode', fieldName: 'LocCode', columnTitle: 'Loc.', columnOrder: 10, width: 115, dataType: 'string', isUdf: false },
];

const DOCUMENT_TYPES = {
  SALES_ORDER: {
    documentType: 'SALES_ORDER',
    objectType: '17',
    formType: '139',
    matrixId: '38',
    headerTable: 'ORDR',
    tableName: 'RDR1',
    fallbackColumns: [
      { columnUid: 'LineNum', fieldName: 'LineNum', columnTitle: '#', columnOrder: 1, width: 42, dataType: 'number', isUdf: false },
      { columnUid: 'ItemCode', fieldName: 'ItemCode', columnTitle: 'Item No.', columnOrder: 2, width: 160, dataType: 'string', isUdf: false },
      { columnUid: 'Dscription', fieldName: 'Dscription', columnTitle: 'Item Description', columnOrder: 3, width: 240, dataType: 'string', isUdf: false },
      { columnUid: 'Quantity', fieldName: 'Quantity', columnTitle: 'Quantity', columnOrder: 4, width: 90, dataType: 'number', isUdf: false },
      { columnUid: 'UomName', fieldName: 'UomName', columnTitle: 'UoM Name', columnOrder: 5, width: 120, dataType: 'string', isUdf: false },
      { columnUid: 'HsnCode', fieldName: 'HsnCode', columnTitle: 'HSN', columnOrder: 6, width: 95, dataType: 'string', isUdf: false },
      { columnUid: 'Price', fieldName: 'Price', columnTitle: 'Unit Price', columnOrder: 7, width: 110, dataType: 'number', isUdf: false },
      { columnUid: 'VatGroup', fieldName: 'VatGroup', columnTitle: 'Tax Code', columnOrder: 8, width: 110, dataType: 'string', isUdf: false },
      { columnUid: 'LineTotal', fieldName: 'LineTotal', columnTitle: 'Total (LC)', columnOrder: 9, width: 115, dataType: 'number', isUdf: false },
      { columnUid: 'TotalFrgn', fieldName: 'TotalFrgn', columnTitle: 'Total (Doc)', columnOrder: 10, width: 115, dataType: 'number', isUdf: false },
      { columnUid: 'DiscPrcnt', fieldName: 'DiscPrcnt', columnTitle: 'Discount %', columnOrder: 13, width: 95, dataType: 'number', isUdf: false },
      { columnUid: 'DelivrdQty', fieldName: 'DelivrdQty', columnTitle: 'Delivered Qty', columnOrder: 14, width: 120, dataType: 'number', isUdf: false },
      { columnUid: 'WhsCode', fieldName: 'WhsCode', columnTitle: 'Whse', columnOrder: 15, width: 80, dataType: 'string', isUdf: false },
    ],
    getReferenceData: () => salesOrderDbService.getReferenceData(),
  },
  SALES_QUOTATION: {
    documentType: 'SALES_QUOTATION',
    objectType: '23',
    formType: '149',
    matrixId: '38',
    headerTable: 'OQUT',
    tableName: 'QUT1',
    fallbackColumns: createCommonFallbackColumns(),
    getReferenceData: () => salesQuotationDbService.getReferenceData(),
  },
  DELIVERY: {
    documentType: 'DELIVERY',
    objectType: '15',
    formType: '140',
    matrixId: '38',
    headerTable: 'ODLN',
    tableName: 'DLN1',
    fallbackColumns: [
      { columnUid: 'LineNum', fieldName: 'LineNum', columnTitle: '#', columnOrder: 1, width: 42, dataType: 'number', isUdf: false },
      { columnUid: 'ItemCode', fieldName: 'ItemCode', columnTitle: 'Item No.', columnOrder: 2, width: 160, dataType: 'string', isUdf: false },
      { columnUid: 'Dscription', fieldName: 'Dscription', columnTitle: 'Item Description', columnOrder: 3, width: 240, dataType: 'string', isUdf: false },
      { columnUid: 'Quantity', fieldName: 'Quantity', columnTitle: 'Quantity', columnOrder: 4, width: 90, dataType: 'number', isUdf: false },
      { columnUid: 'UomName', fieldName: 'UomName', columnTitle: 'UoM Name', columnOrder: 5, width: 120, dataType: 'string', isUdf: false },
      { columnUid: 'HsnCode', fieldName: 'HsnCode', columnTitle: 'HSN', columnOrder: 6, width: 95, dataType: 'string', isUdf: false },
      { columnUid: 'Price', fieldName: 'Price', columnTitle: 'Unit Price', columnOrder: 7, width: 110, dataType: 'number', isUdf: false },
      { columnUid: 'VatGroup', fieldName: 'VatGroup', columnTitle: 'Tax Code', columnOrder: 8, width: 110, dataType: 'string', isUdf: false },
      { columnUid: 'LineTotal', fieldName: 'LineTotal', columnTitle: 'Total (LC)', columnOrder: 9, width: 115, dataType: 'number', isUdf: false },
      { columnUid: 'TotalFrgn', fieldName: 'TotalFrgn', columnTitle: 'Total (Doc)', columnOrder: 10, width: 115, dataType: 'number', isUdf: false },
      { columnUid: 'DiscPrcnt', fieldName: 'DiscPrcnt', columnTitle: 'Discount %', columnOrder: 13, width: 95, dataType: 'number', isUdf: false },
      { columnUid: 'WhsCode', fieldName: 'WhsCode', columnTitle: 'Whse', columnOrder: 14, width: 80, dataType: 'string', isUdf: false },
    ],
    getReferenceData: () => deliveryDbService.getReferenceData(),
  },
  AR_INVOICE: {
    documentType: 'AR_INVOICE',
    objectType: '13',
    formType: '133',
    matrixId: '38',
    headerTable: 'OINV',
    tableName: 'INV1',
    fallbackColumns: createCommonFallbackColumns(),
    getReferenceData: () => arInvoiceDbService.getReferenceData(),
  },
  AR_CREDIT_MEMO: {
    documentType: 'AR_CREDIT_MEMO',
    objectType: '14',
    formType: '179',
    matrixId: '38',
    headerTable: 'ORIN',
    tableName: 'RIN1',
    fallbackColumns: createCommonFallbackColumns(),
    getReferenceData: () => arCreditMemoDbService.getReferenceData(),
  },
  PURCHASE_REQUEST: {
    documentType: 'PURCHASE_REQUEST',
    objectType: '1470000113',
    formType: '1470000200',
    matrixId: '38',
    headerTable: 'OPRQ',
    tableName: 'PRQ1',
    fallbackColumns: createPurchaseRequestFallbackColumns(),
  },
  PURCHASE_QUOTATION: {
    documentType: 'PURCHASE_QUOTATION',
    objectType: '540000006',
    formType: '540000988',
    matrixId: '38',
    headerTable: 'OPQT',
    tableName: 'PQT1',
    fallbackColumns: createCommonFallbackColumns(),
    getReferenceData: () => purchaseQuotationDbService.getReferenceData(),
  },
  PURCHASE_ORDER: {
    documentType: 'PURCHASE_ORDER',
    objectType: '22',
    formType: '142',
    matrixId: '38',
    headerTable: 'OPOR',
    tableName: 'POR1',
    fallbackColumns: createCommonFallbackColumns(),
    getReferenceData: () => purchaseOrderDbService.getReferenceData(),
  },
  GRPO: {
    documentType: 'GRPO',
    objectType: '20',
    formType: '143',
    matrixId: '38',
    headerTable: 'OPDN',
    tableName: 'PDN1',
    fallbackColumns: createCommonFallbackColumns(),
    getReferenceData: () => grpoDbService.getReferenceData && grpoDbService.getReferenceData(),
  },
  AP_INVOICE: {
    documentType: 'AP_INVOICE',
    objectType: '18',
    formType: '141',
    matrixId: '38',
    headerTable: 'OPCH',
    tableName: 'PCH1',
    fallbackColumns: createCommonFallbackColumns(),
    getReferenceData: () => apInvoiceDbService.getReferenceData(),
  },
  AP_CREDIT_MEMO: {
    documentType: 'AP_CREDIT_MEMO',
    objectType: '19',
    formType: '181',
    matrixId: '38',
    headerTable: 'ORPC',
    tableName: 'RPC1',
    fallbackColumns: createCommonFallbackColumns(),
    getReferenceData: () => apCreditMemoDbService.getReferenceData(),
  },
  SERVICE_AR_INVOICE: {
    documentType: 'SERVICE_AR_INVOICE',
    objectType: '13',
    formType: '133',
    matrixId: '38',
    headerTable: 'OINV',
    tableName: 'INV1',
    serviceLineMode: true,
    fallbackColumns: createServiceFallbackColumns(),
    getReferenceData: () => serviceArInvoiceDbService.getReferenceData(),
  },
  SERVICE_AP_INVOICE: {
    documentType: 'SERVICE_AP_INVOICE',
    objectType: '18',
    formType: '141',
    matrixId: '38',
    headerTable: 'OPCH',
    tableName: 'PCH1',
    serviceLineMode: true,
    fallbackColumns: createServiceFallbackColumns(),
    getReferenceData: () => serviceApInvoiceDbService.getReferenceData(),
  },
  SERVICE_AP_CREDIT_MEMO: {
    documentType: 'SERVICE_AP_CREDIT_MEMO',
    objectType: '19',
    formType: '181',
    matrixId: '38',
    headerTable: 'ORPC',
    tableName: 'RPC1',
    serviceLineMode: true,
    fallbackColumns: createServiceFallbackColumns(),
    getReferenceData: () => serviceApCreditMemoDbService.getReferenceData(),
  },
  SERVICE_AR_CREDIT_MEMO: {
    documentType: 'SERVICE_AR_CREDIT_MEMO',
    objectType: '14',
    formType: '179',
    matrixId: '38',
    headerTable: 'ORIN',
    tableName: 'RIN1',
    serviceLineMode: true,
    fallbackColumns: createServiceFallbackColumns(),
    getReferenceData: () => serviceArCreditMemoDbService.getReferenceData(),
  },
};

DOCUMENT_TYPES.SALES_ORDER.getReferenceData = () => salesOrderDbService.getReferenceData();

const AUTHORITATIVE_SOURCE_EXCLUSION = 'udf-sync';
const LIVE_LAYOUT_SOURCE = 'live-sap-metadata';
const liveLayoutBuilds = new Map();
const DOCUMENT_TYPE_ALIASES = Object.values(DOCUMENT_TYPES).reduce((acc, mapping) => {
  acc[mapping.documentType] = mapping.documentType;
  if (!acc[mapping.objectType]) acc[mapping.objectType] = mapping.documentType;
  if (!acc[String(mapping.formType)]) acc[String(mapping.formType)] = mapping.documentType;
  return acc;
}, {});

const createHttpError = (statusCode, message, details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
};

const normalizeText = (value, fieldName, { required = false, maxLength = 200 } = {}) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    if (required) {
      throw createHttpError(400, `${fieldName} is required.`);
    }
    return '';
  }

  if (normalized.length > maxLength) {
    throw createHttpError(400, `${fieldName} is too long.`);
  }

  return normalized;
};

const normalizeBooleanFlag = (value, fallback = true) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 't', 'on', 'tyes'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'f', 'off', 'tno'].includes(normalized)) return false;
  return fallback;
};

const normalizeInteger = (value, fallback, fieldName, { min = 0, max = 5000 } = {}) => {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw createHttpError(400, `${fieldName} must be numeric.`);
  }

  const integer = Math.trunc(parsed);
  if (integer < min || integer > max) {
    throw createHttpError(400, `${fieldName} is out of range.`);
  }

  return integer;
};

const clampLayoutWidth = (value, fallback = 120) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 40), 4000);
};

const normalizeDocumentType = (input = {}) => {
  const rawDocumentType = input?.documentType ?? input?.document_type ?? input?.type;
  const rawObjectType = input?.objectType ?? input?.object_type ?? input?.objType;
  const rawFormType = input?.formType ?? input?.form_type;
  const rawValue = rawDocumentType || rawObjectType || rawFormType;

  if (!String(rawValue || '').trim()) {
    throw createHttpError(400, 'documentType or objectType is required for SAP layout.', {
      received: {
        documentType: rawDocumentType || null,
        objectType: rawObjectType || null,
        formType: rawFormType || null,
      },
      allowedDocumentTypes: Object.keys(DOCUMENT_TYPES),
      allowedObjectTypes: Object.values(DOCUMENT_TYPES).map((item) => item.objectType),
      examples: {
        salesQuotation: { documentType: 'SALES_QUOTATION', objectType: '23' },
        delivery: { documentType: 'DELIVERY', objectType: '15' },
        arInvoice: { documentType: 'AR_INVOICE', objectType: '13' },
        arCreditMemo: { documentType: 'AR_CREDIT_MEMO', objectType: '14' },
      },
    });
  }

  const normalized = normalizeText(rawValue, 'documentType or objectType', { required: true, maxLength: 50 }).toUpperCase();
  const canonicalType = DOCUMENT_TYPE_ALIASES[normalized] || normalized;
  const mapping = DOCUMENT_TYPES[canonicalType];
  if (!mapping) {
    throw createHttpError(400, `Unsupported document layout type "${normalized}".`, {
      received: {
        documentType: rawDocumentType || null,
        objectType: rawObjectType || null,
        formType: rawFormType || null,
      },
      allowedDocumentTypes: Object.keys(DOCUMENT_TYPES),
      allowedObjectTypes: Object.values(DOCUMENT_TYPES).map((item) => item.objectType),
      hint: 'Send documentType or SAP objectType. Sales Quotation uses objectType 23.',
    });
  }

  return mapping;
};

const normalizeColumnInput = (column = {}, index = 0) => {
  const columnUid = normalizeText(column.columnUid, `columns[${index}].columnUid`, { required: true, maxLength: 200 });
  const fieldName = normalizeText(column.fieldName || columnUid, `columns[${index}].fieldName`, { required: true, maxLength: 200 });
  const columnTitle = normalizeText(column.columnTitle, `columns[${index}].columnTitle`, { required: true, maxLength: 200 });

  return {
    columnUid,
    fieldName,
    columnTitle,
    visible: normalizeBooleanFlag(column.visible, true),
    editable: normalizeBooleanFlag(column.editable, true),
    columnOrder: normalizeInteger(column.columnOrder, index + 1, `columns[${index}].columnOrder`, { min: 0, max: 100000 }),
    width: clampLayoutWidth(column.width, 120),
    dataType: normalizeText(column.dataType, `columns[${index}].dataType`, { required: false, maxLength: 100 }) || null,
    isUdf: normalizeBooleanFlag(column.isUdf, fieldName.toUpperCase().startsWith('U_')),
    source: normalizeText(column.source, `columns[${index}].source`, { required: false, maxLength: 100 }) || 'manual',
  };
};

const mapRowToColumn = (row = {}) => ({
  columnUid: String(row.columnUid || ''),
  fieldName: String(row.fieldName || ''),
  columnTitle: String(row.columnTitle || ''),
  visible: Number(row.visible) === 1,
  editable: Number(row.editable) === 1,
  columnOrder: Number(row.columnOrder) || 0,
  width: clampLayoutWidth(row.width, 120),
  dataType: row.dataType || '',
  isUdf: Number(row.isUdf) === 1,
  source: row.source || 'manual',
});

const isNumericOnly = (value) => /^\d+$/.test(String(value || '').trim());

const isUnmatchedNumericLayoutColumn = (column = {}) => (
  !column.isUdf
  && isNumericOnly(column.columnUid)
  && isNumericOnly(column.fieldName)
  && isNumericOnly(column.columnTitle)
);

const sanitizeLayoutColumns = (columns = []) => {
  const usedKeys = new Set();
  return (columns || [])
    .filter((column) => column && !isUnmatchedNumericLayoutColumn(column))
    .filter((column) => {
      const dedupeKey = getLayoutColumnDedupeKey(column);
      if (!dedupeKey || dedupeKey === '|') return true;
      if (usedKeys.has(dedupeKey)) return false;
      usedKeys.add(dedupeKey);
      return true;
    });
};

const normalizeLiveLayoutFieldName = (column = {}) => {
  const sapField = normalizeText(column.sapField, 'sapField', { required: false, maxLength: 200 });
  if (sapField) return sapField;

  const udfKey = normalizeText(column.udfKey, 'udfKey', { required: false, maxLength: 200 });
  if (udfKey) return udfKey;

  return normalizeText(column.key, 'key', { required: true, maxLength: 200 });
};

const mapLiveMatrixColumnToLayoutColumn = (column = {}, index = 0) => {
  const fieldName = normalizeLiveLayoutFieldName(column);
  const inferredDataType = column.type || (column.numeric ? 'number' : 'string');
  return normalizeColumnInput({
    columnUid: column.sapColumnId || column.sapField || column.key || `auto_${index + 1}`,
    fieldName,
    columnTitle: column.label || fieldName,
    visible: column.visible !== false,
    editable: column.active !== false && !column.readOnly,
    columnOrder: Number(column.order || column.columnOrder || index + 1),
    width: clampLayoutWidth(column.minWidth || column.width, 120),
    dataType: inferredDataType,
    isUdf: Boolean(
      column.isUdf
      || column.isUdfBacked
      || String(fieldName || '').trim().toUpperCase().startsWith('U_')
    ),
    source: 'live-sap-metadata',
  }, index);
};

const normalizeLayoutMatchToken = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^U_/, '')
    .replace(/[^A-Z0-9]/g, '');

const unique = (values = []) => [...new Set(values.filter(Boolean))];

const SALES_ORDER_STRICT_LAYOUT_FIELDS = [
  { title: 'Item No.', fieldNames: ['ItemCode'], aliases: ['Item No.', 'ItemNo', 'itemNo'], width: 160, dataType: 'string', isUdf: false },
  { title: 'Item Description', fieldNames: ['Dscription'], aliases: ['Item Description', 'Description', 'itemDescription'], width: 240, dataType: 'string', isUdf: false },
  { title: 'Quantity', fieldNames: ['Quantity'], aliases: ['Qty', 'quantity'], width: 90, dataType: 'number', isUdf: false },
  { title: 'UoM Name', fieldNames: ['unitMsr', 'UomName', 'UomCode'], aliases: ['UoM Name', 'UOM Name', 'UoM'], width: 120, dataType: 'string', isUdf: false },
  { title: 'HSN', fieldNames: ['HsnCode', 'HsnEntry', 'hsnCode'], aliases: ['HSN', 'HSN/SAC'], width: 95, dataType: 'string', isUdf: false },
  { title: 'Unit Price', fieldNames: ['Price', 'PriceBefDi', 'UnitPrice'], aliases: ['Unit Price'], width: 110, dataType: 'number', forceFieldName: 'Price', forceColumnUid: 'Price', forceStandard: true },
  { title: 'Tax Code', fieldNames: ['VatGroup', 'TaxCode'], aliases: ['Tax Code'], width: 110, dataType: 'string', forceFieldName: 'TaxCode', forceColumnUid: 'TaxCode', forceStandard: true },
  { title: 'Total (LC)', fieldNames: ['LineTotal'], aliases: ['Total (LC)', 'Total LC', 'Total'], width: 115, dataType: 'number', isUdf: false },
  { title: 'Total (Doc)', fieldNames: ['TotalFrgn'], aliases: ['Total (Doc)', 'Total Doc', 'Total (FC)'], width: 115, dataType: 'number', isUdf: false },
  { title: 'Gross Total', fieldNames: ['GTotal'], aliases: ['Gross Total', 'GrossTotal'], width: 120, dataType: 'number', isUdf: false },
  { title: 'Packing-Type', fieldNames: ['U_PackingType'], aliases: ['Packing-Type', 'PackingType'], width: 140, dataType: 'string', isUdf: true },
  { title: 'GrossWt', fieldNames: ['U_GrossWt'], aliases: ['GrossWt', 'Gross Weight'], width: 110, dataType: 'number', isUdf: true },
  { title: 'Total-Package', fieldNames: ['U_TotalPackage'], aliases: ['Total-Package', 'TotalPackage'], width: 130, dataType: 'number', isUdf: true },
  { title: 'Discount %', fieldNames: ['DiscPrcnt'], aliases: ['Discount %', 'Discount'], width: 95, dataType: 'number', isUdf: false },
  { title: 'Delivered Qty', fieldNames: ['DelivrdQty', 'deliveredQty'], aliases: ['Delivered Qty'], width: 120, dataType: 'number', isUdf: false },
  {
    title: 'FOR Rate',
    fieldNames: ['U_ForRate', 'U_FORRATE', 'U_FOR_RATE', 'U_For_Rate', 'U_FORRate', 'U_Forrate', 'Rate'],
    aliases: ['FOR Rate', 'FORRATE', 'FOR_Rate'],
    width: 110,
    dataType: 'number',
    isUdf: true,
  },
  { title: 'Whse', fieldNames: ['WhsCode'], aliases: ['Whse', 'Warehouse', 'WarehouseCode'], width: 85, dataType: 'string', isUdf: false },
  { title: 'TaxCode', fieldNames: ['U_TAXCODE', 'U_TaxCode', 'TaxCode'], aliases: ['TaxCode'], width: 110, dataType: 'string', forceUdf: true },
  { title: 'Price', fieldNames: ['U_PRICE', 'U_Price'], aliases: ['Price'], width: 110, dataType: 'number', forceUdf: true },
  { title: 'Seller Brokerage', fieldNames: ['U_Brok_Seller'], aliases: ['Seller Brokerage'], width: 125, dataType: 'number', isUdf: true },
  { title: 'Buyer Brokerage', fieldNames: ['U_Brok_Buyer'], aliases: ['Buyer Brokerage'], width: 125, dataType: 'number', isUdf: true },
  { title: 'Buyer - Delivery', fieldNames: ['U_Buyer_Delivery'], aliases: ['Buyer - Delivery'], width: 135, dataType: 'string', isUdf: true },
  { title: 'Seller - Delivery', fieldNames: ['U_Seller_Delivery'], aliases: ['Seller - Delivery'], width: 135, dataType: 'string', isUdf: true },
  { title: 'Buyer - Terms of payment', fieldNames: ['U_Buyer_Payment_Terms'], aliases: ['Buyer - Terms of payment', 'Buyer - Terms of Payment'], width: 180, dataType: 'string', isUdf: true },
  { title: 'Seller - Terms of Payment', fieldNames: ['U_Seller_Payment_Term', 'U_Seller_Payment_Terms'], aliases: ['Seller - Terms of Payment'], width: 180, dataType: 'string', isUdf: true },
  { title: 'Buyer - Quality', fieldNames: ['U_Buyer_Quality'], aliases: ['Buyer - Quality'], width: 155, dataType: 'string', isUdf: true },
  { title: 'Seller - Quality', fieldNames: ['U_Seller_Quality'], aliases: ['Seller - Quality'], width: 155, dataType: 'string', isUdf: true },
  { title: 'Buyer - Price', fieldNames: ['U_Buyer_Price'], aliases: ['Buyer - Price'], width: 135, dataType: 'string', isUdf: true },
  { title: 'Seller - Price', fieldNames: ['U_Seller_Price'], aliases: ['Seller - Price'], width: 135, dataType: 'string', isUdf: true },
  { title: 'Buyer - Special Instruction', fieldNames: ['U_Buyer_SPINS'], aliases: ['Buyer - Special Instruction'], width: 190, dataType: 'string', isUdf: true },
  { title: 'Seller - Special Instruction', fieldNames: ['U_Seller_SPINS'], aliases: ['Seller - Special Instruction'], width: 190, dataType: 'string', isUdf: true },
  { title: 'Seller Brokerage(Amt./Per)', fieldNames: ['U_Sel_Brok_AP'], aliases: ['Seller Brokerage(Amt./Per)'], width: 165, dataType: 'string', isUdf: true },
  { title: 'Seller Brokerage in Percentage', fieldNames: ['U_Seller_Brok_Per'], aliases: ['Seller Brokerage in Percentage'], width: 180, dataType: 'number', isUdf: true },
  { title: 'STCODE', fieldNames: ['U_SELLTCODE', 'U_STCODE'], aliases: ['STCODE'], width: 110, dataType: 'string', isUdf: true },
  { title: 'S_Item', fieldNames: ['U_S_Item'], aliases: ['S_Item', 'S Item'], width: 125, dataType: 'string', isUdf: true },
  { title: 'S_Qty', fieldNames: ['U_S_Qty'], aliases: ['S_Qty', 'S Qty'], width: 110, dataType: 'number', isUdf: true },
  { title: 'Special Rebate', fieldNames: ['U_SPLRBT'], aliases: ['Special Rebate'], width: 120, dataType: 'number', isUdf: true },
  { title: 'Commision', fieldNames: ['U_COMPRC'], aliases: ['Commision', 'Commission'], width: 110, dataType: 'number', isUdf: true },
  { title: 'BrokPerQty', fieldNames: ['U_S_BrokPerQty'], aliases: ['BrokPerQty'], width: 115, dataType: 'number', isUdf: true },
  { title: 'FIX Brok BUYER', fieldNames: ['U_Fix_Brock_B', 'U_Fix_Brok_B', 'U_FIXBROKBUYER', 'U_FixBrokBuyer'], aliases: ['FIX Brok BUYER', 'Fix Brok Buyer'], width: 135, dataType: 'number', isUdf: true },
  { title: 'Fix Brock Seller', fieldNames: ['U_Fix_Brock_S', 'U_Fix_Brok_S', 'U_FIXBROCKSELLER', 'U_FIXBROKSELLER', 'U_FixBrockSeller'], aliases: ['Fix Brock Seller', 'Fix Brok Seller'], width: 140, dataType: 'number', isUdf: true },
];

const COMMON_MARKETING_COLUMN_DEFS = [
  { title: '#', fieldName: 'LineNum', aliases: ['#', 'LineNum'], sapColumnIds: ['0', '#', 'LineNum'], width: 42, dataType: 'number' },
  { title: 'Item No.', fieldName: 'ItemCode', aliases: ['Item No.', 'ItemNo'], sapColumnIds: ['1', 'ItemCode', 'Item No.', 'ItemNo'], width: 160, dataType: 'string' },
  { title: 'Item Description', fieldName: 'Dscription', aliases: ['Item Description', 'Description'], sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Item Description'], width: 240, dataType: 'string' },
  { title: 'Quantity', fieldName: 'Quantity', aliases: ['Quantity', 'Qty'], sapColumnIds: ['11', 'Quantity', 'Qty'], width: 90, dataType: 'number' },
  { title: 'Required Date', fieldName: 'ReqDate', aliases: ['Required Date'], sapColumnIds: ['5', 'ReqDate', 'Required Date'], width: 125, dataType: 'date' },
  { title: 'Delivery Date', fieldName: 'ShipDate', aliases: ['Delivery Date', 'Quoted Date'], sapColumnIds: ['ShipDate', 'Delivery Date', 'Quoted Date'], width: 125, dataType: 'date' },
  { title: 'Unit Price', fieldName: 'Price', aliases: ['Unit Price'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'UnitPrice', 'Unit Price'], width: 110, dataType: 'number' },
  { title: 'Discount %', fieldName: 'DiscPrcnt', aliases: ['Discount %', 'Disc%'], sapColumnIds: ['15', 'DiscPrcnt', 'Discount %', 'Disc%'], width: 95, dataType: 'number' },
  { title: 'Tax Code', fieldName: 'TaxCode', aliases: ['Tax Code'], sapColumnIds: ['234000377', 'VatGroup', 'TaxCode', 'Tax Code'], width: 115, dataType: 'string' },
  { title: 'Total (LC)', fieldName: 'LineTotal', aliases: ['Total (LC)', 'Total LC', 'Total'], sapColumnIds: ['17', 'LineTotal', 'Total', 'Total (LC)', 'Total LC'], width: 115, dataType: 'number' },
  { title: 'Total (Doc)', fieldName: 'TotalFrgn', aliases: ['Total (Doc)', 'Total Doc', 'Total (FC)'], sapColumnIds: ['TotalFrgn', 'Total (Doc)', 'Total Doc', 'Total (FC)'], width: 115, dataType: 'number' },
  { title: 'Gross Total', fieldName: 'GTotal', aliases: ['Gross Total', 'GrossTotal'], sapColumnIds: ['GTotal', 'GrossTotal', 'Gross Total'], width: 120, dataType: 'number' },
  { title: 'Whse', fieldName: 'WhsCode', aliases: ['Whse', 'Warehouse'], sapColumnIds: ['174', 'WhsCode', 'Warehouse', 'Whse'], width: 90, dataType: 'string' },
  { title: 'G/L Account', fieldName: 'AcctCode', aliases: ['G/L Account', 'GLAccount'], sapColumnIds: ['234001512', 'AcctCode', 'G/L Account', 'GLAccount'], width: 135, dataType: 'string' },
  { title: 'Distr. Rule', fieldName: 'OcrCode', aliases: ['Distr. Rule', 'Distribution Rule'], sapColumnIds: ['21', 'OcrCode', 'Distr. Rule', 'DistributionRule'], width: 105, dataType: 'string' },
  { title: 'Tax Liable', fieldName: 'TaxOnly', aliases: ['Tax Liable'], sapColumnIds: ['22', 'TaxOnly', 'Tax Liable'], width: 95, dataType: 'yesNo' },
  { title: 'WTax Liable', fieldName: 'WTLiable', aliases: ['WTax Liable'], sapColumnIds: ['18', 'WTLiable', 'WtLiable', 'WTax Liable'], width: 100, dataType: 'yesNo' },
  { title: 'Weight', fieldName: 'Weight1', aliases: ['Weight'], sapColumnIds: ['Weight1', 'Weight'], width: 95, dataType: 'number' },
  { title: 'Tax Amount (LC)', fieldName: 'VatSum', aliases: ['Tax Amount (LC)', 'Tax Amount (Doc)'], sapColumnIds: ['83', 'VatSum', 'Tax Amount (LC)', 'Tax Amount (Doc)'], width: 125, dataType: 'number' },
  { title: 'UoM Code', fieldName: 'UomCode', aliases: ['UoM Code', 'UoM'], sapColumnIds: ['1470002149', 'UomCode', 'UoMCode', 'UoM Code', 'UoM'], width: 105, dataType: 'string' },
  { title: 'UoM Name', fieldName: 'unitMsr', aliases: ['UoM Name'], sapColumnIds: ['1470002145', 'unitMsr', 'UomName', 'UoM Name'], width: 120, dataType: 'string' },
  { title: 'In Stock', fieldName: 'OnHand', aliases: ['In Stock', 'InStock'], sapColumnIds: ['OnHand', 'In Stock', 'InStock'], width: 105, dataType: 'number' },
  { title: 'Qty in Whse', fieldName: 'WhsQty', aliases: ['Qty in Whse', 'Qty in Warehouse', 'WhsQty'], sapColumnIds: ['WhsQty', 'Qty in Whse', 'Qty in Warehouse'], width: 115, dataType: 'number' },
  { title: 'COGS Distr. Rule', fieldName: 'CogsOcrCod', aliases: ['COGS Distr. Rule'], sapColumnIds: ['29', 'CogsOcrCod', 'COGS Distr. Rule'], width: 135, dataType: 'string' },
  { title: 'Country/Region of Origin', fieldName: 'CountryOrg', aliases: ['Country/Region of Origin'], sapColumnIds: ['10002037', 'CountryOrg', 'Country/Region of Origin'], width: 185, dataType: 'string' },
  { title: 'Loc.', fieldName: 'LocCode', aliases: ['Loc.', 'Location'], sapColumnIds: ['10002047', 'LocCode', 'Location', 'Loc.'], width: 115, dataType: 'string' },
  { title: 'HSN', fieldName: 'HsnEntry', aliases: ['HSN', 'HSN/SAC'], sapColumnIds: ['254000391', 'HsnEntry', 'HsnCode', 'HSN', 'HSN/SAC'], width: 115, dataType: 'string' },
  { title: 'SAC', fieldName: 'SacEntry', aliases: ['SAC'], sapColumnIds: ['254000393', 'SacEntry', 'SacCode', 'SAC'], width: 95, dataType: 'string' },
  { title: 'No. of Packages', fieldName: 'PackQty', aliases: ['No. of Packages'], sapColumnIds: ['13', 'PackQty', 'Packages', 'No. of Packages', 'NumOfPacks'], width: 120, dataType: 'number' },
  { title: 'Packing-Type', fieldName: 'U_PackingType', aliases: ['Packing-Type', 'PackingType', 'Packing Type'], sapColumnIds: ['U_PackingType', 'U_PACKINGTYPE', 'U_PACKING_TYPE', 'Packing-Type', 'PackingType'], width: 140, dataType: 'string' },
  { title: 'GrossWt', fieldName: 'U_GrossWt', aliases: ['GrossWt', 'Gross Weight', 'Gross Wt'], sapColumnIds: ['U_GrossWt', 'U_GROSSWT', 'U_GROSS_WT', 'GrossWt', 'Gross Weight'], width: 110, dataType: 'number' },
  { title: 'Total-Package', fieldName: 'U_TotalPackage', aliases: ['Total-Package', 'TotalPackage', 'Total Package'], sapColumnIds: ['U_TotalPackage', 'U_TOTALPACKAGE', 'U_TOTAL_PACKAGE', 'Total-Package', 'TotalPackage'], width: 130, dataType: 'number' },
  { title: 'FOR Rate', fieldName: 'U_ForRate', aliases: ['FOR Rate', 'FORRATE', 'FOR_Rate', 'For Rate'], sapColumnIds: ['U_ForRate', 'U_FORRATE', 'U_FOR_RATE', 'FOR Rate', 'FORRATE'], width: 110, dataType: 'number' },
  { title: 'Open Qty', fieldName: 'OpenQty', aliases: ['Open Qty', 'Ordered Qty'], sapColumnIds: ['OpenQty', 'Open Qty', 'Ordered Qty'], width: 95, dataType: 'number' },
  { title: 'Delivered Qty', fieldName: 'DelivrdQty', aliases: ['Delivered Qty', 'Qty to Ship'], sapColumnIds: ['DelivrdQty', 'Delivered Qty', 'Qty to Ship'], width: 110, dataType: 'number' },
  { title: 'Comm. %', fieldName: 'Commission', aliases: ['Commission Percentage', 'CommissionPercent', 'Comm. %'], sapColumnIds: ['28', 'Commission', 'CommissionPercent', 'Commission Percentage', 'Comm. %'], width: 95, dataType: 'number' },
  { title: 'Free Text', fieldName: 'FreeTxt', aliases: ['Free Text'], sapColumnIds: ['FreeTxt', 'Free Text'], width: 150, dataType: 'string' },
  { title: 'Blanket Agreement No.', fieldName: 'AgrNo', aliases: ['Blanket Agreement No.'], sapColumnIds: ['1000', 'AgrNo', 'Blanket Agreement No.'], width: 170, dataType: 'string' },
  { title: 'Enable Setting Cost', fieldName: 'EnSetCost', aliases: ['Enable Setting Cost'], sapColumnIds: ['110000310', 'EnSetCost', 'Enable Setting Cost'], width: 140, dataType: 'checkbox' },
  { title: 'Return Cost (LC)', fieldName: 'RetCost', aliases: ['Return Cost (LC)'], sapColumnIds: ['1003', 'RetCost', 'Return Cost (LC)'], width: 125, dataType: 'number' },
];

const indexLayoutCandidate = (index, token, candidate) => {
  const normalized = normalizeLayoutMatchToken(token);
  if (!normalized) return;
  if (!index.has(normalized)) index.set(normalized, []);
  index.get(normalized).push(candidate);
};

const buildLayoutCandidateIndex = ({ matrixColumns = [], rowUdfFields = [] } = {}) => {
  const index = new Map();

  (matrixColumns || []).forEach((column, sourceIndex) => {
    const layoutColumn = mapLiveMatrixColumnToLayoutColumn(column, sourceIndex);
    const candidate = {
      column: layoutColumn,
      identity: `${layoutColumn.columnUid}|${layoutColumn.fieldName}|${layoutColumn.columnTitle}`,
      sourceIndex,
    };
    [
      column.key,
      column.sapField,
      column.udfKey,
      column.sapColumnId,
      column.label,
      column.fieldName,
      column.aliasId,
      ...(column.additionalPreferenceKeys || []),
      layoutColumn.columnUid,
      layoutColumn.fieldName,
      layoutColumn.columnTitle,
    ].forEach((token) => indexLayoutCandidate(index, token, candidate));
  });

  (rowUdfFields || []).forEach((field, sourceIndex) => {
    const fieldName = normalizeText(field.key || field.sapField, 'row UDF key', { required: false, maxLength: 200 });
    if (!fieldName) return;

    const layoutColumn = normalizeColumnInput({
      columnUid: field.sapColumnId || field.sapField || field.key,
      fieldName,
      columnTitle: field.label || field.description || field.key,
      visible: field.visible !== false,
      editable: field.active !== false && !field.readOnly,
      columnOrder: Number(field.order || 5000 + sourceIndex),
      width: clampLayoutWidth(field.minWidth || field.width, field.type === 'textarea' ? 180 : 125),
      dataType: field.type || field.dataType || 'string',
      isUdf: true,
      source: LIVE_LAYOUT_SOURCE,
    }, sourceIndex);
    const candidate = {
      column: layoutColumn,
      identity: `${layoutColumn.columnUid}|${layoutColumn.fieldName}|${layoutColumn.columnTitle}`,
      sourceIndex: 10000 + sourceIndex,
    };
    [
      field.key,
      field.sapField,
      field.aliasId,
      field.label,
      field.description,
      field.sapColumnId,
      layoutColumn.columnUid,
      layoutColumn.fieldName,
      layoutColumn.columnTitle,
    ].forEach((token) => indexLayoutCandidate(index, token, candidate));
  });

  return index;
};

const findStrictLayoutCandidate = (expected, candidateIndex, usedIdentities) => {
  const tokens = unique([
    expected.title,
    ...(expected.fieldNames || []),
    ...(expected.aliases || []),
  ].map(normalizeLayoutMatchToken));

  for (const token of tokens) {
    const candidates = candidateIndex.get(token) || [];
    const unused = candidates.find((candidate) => !usedIdentities.has(candidate.identity));
    if (unused) return unused;
    if (candidates.length) return candidates[0];
  }

  return null;
};

const buildStrictSalesOrderLayoutColumns = ({ matrixColumns = [], rowUdfFields = [] } = {}) => {
  const candidateIndex = buildLayoutCandidateIndex({ matrixColumns, rowUdfFields });
  const usedIdentities = new Set();
  const usedColumnUids = new Set();
  const strictColumns = [];

  SALES_ORDER_STRICT_LAYOUT_FIELDS.forEach((expected, index) => {
    const candidate = findStrictLayoutCandidate(expected, candidateIndex, usedIdentities);
    if (!candidate?.column) return;

    usedIdentities.add(candidate.identity);
    const sourceColumn = candidate.column;
    const defaultFieldName = expected.fieldNames?.[0] || sourceColumn.fieldName || sourceColumn.columnUid;
    const fieldName = expected.forceFieldName || sourceColumn.fieldName || defaultFieldName;
    const baseColumnUid = expected.forceColumnUid || sourceColumn.columnUid || defaultFieldName || `strict_${index + 1}`;
    const columnUidKey = String(baseColumnUid).trim().toUpperCase();
    const columnUid = usedColumnUids.has(columnUidKey)
      ? `${baseColumnUid}_${index + 1}`
      : baseColumnUid;
    usedColumnUids.add(String(columnUid).trim().toUpperCase());

    const inferredIsUdf = Boolean(sourceColumn.isUdf || String(fieldName || '').trim().toUpperCase().startsWith('U_'));
    const isUdf = expected.forceStandard
      ? false
      : (expected.forceUdf ? true : inferredIsUdf);

    strictColumns.push(normalizeColumnInput({
      ...sourceColumn,
      columnUid,
      fieldName,
      columnTitle: expected.title,
      visible: true,
      editable: sourceColumn.editable !== false,
      columnOrder: index + 1,
      width: clampLayoutWidth(sourceColumn.width, expected.width || 120),
      dataType: expected.forceStandard
        ? (expected.dataType || sourceColumn.dataType || 'string')
        : (sourceColumn.dataType || expected.dataType || 'string'),
      isUdf,
      source: LIVE_LAYOUT_SOURCE,
    }, index));
  });

  return strictColumns;
};

const LIVE_MARKETING_LAYOUT_WITH_UDFS = new Set(['AR_INVOICE', 'AR_CREDIT_MEMO']);

const buildLiveMarketingLayoutColumns = ({ matrixColumns = [], rowUdfFields = [] } = {}) => {
  const usedUdfTokens = new Set();
  const markUsedUdf = (...values) => {
    values.map(normalizeLayoutMatchToken).filter(Boolean).forEach((token) => usedUdfTokens.add(token));
  };
  const hasUsedUdf = (...values) => values.map(normalizeLayoutMatchToken).filter(Boolean).some((token) => usedUdfTokens.has(token));

  const standardColumns = (matrixColumns || []).map((column, index) => {
    const layoutColumn = mapLiveMatrixColumnToLayoutColumn(column, index);
    if (layoutColumn.isUdf || String(layoutColumn.fieldName || layoutColumn.columnUid || '').trim().toUpperCase().startsWith('U_')) {
      markUsedUdf(column.key, column.sapField, column.fieldName, column.sapColumnId, layoutColumn.columnUid, layoutColumn.fieldName);
    }
    return layoutColumn;
  });

  const udfColumns = (rowUdfFields || [])
    .map((field, index) => {
      const fieldName = normalizeText(field.key || field.sapField, 'row UDF key', { required: false, maxLength: 200 });
      if (!fieldName) return null;
      if (hasUsedUdf(field.key, field.sapField, field.sapColumnId)) return null;

      markUsedUdf(field.key, field.sapField, field.sapColumnId);
      return normalizeColumnInput({
        columnUid: field.sapColumnId || field.sapField || field.key,
        fieldName,
        columnTitle: field.label || field.description || field.key,
        visible: field.visible !== false,
        editable: field.active !== false && !field.readOnly,
        columnOrder: Number.isFinite(Number(field.order)) ? Number(field.order) : 5000 + index,
        width: clampLayoutWidth(field.minWidth || field.width, field.type === 'textarea' ? 180 : 125),
        dataType: field.type || field.dataType || 'string',
        isUdf: true,
        source: LIVE_LAYOUT_SOURCE,
      }, 10000 + index);
    })
    .filter(Boolean);

  return sanitizeLayoutColumns([...standardColumns, ...udfColumns]);
};

const normalizeAuth = async (auth = {}, requestedCompanyDb, requestedUserCode) => {
  const userId = Number(auth.userId);
  const companyId = Number(auth.companyId);

  if (!Number.isInteger(userId) || !Number.isInteger(companyId)) {
    throw createHttpError(401, 'A valid company session is required.');
  }

  const sessionUser = auth.username
    ? { Username: auth.username }
    : await authDbService.queryOne(`
        SELECT Username
        FROM Users
        WHERE UserId = @userId
      `, { userId });
  const username = normalizeText(sessionUser?.Username, 'Authenticated username', { required: true, maxLength: 150 });

  const assignedCompany = await authDbService.getAssignedCompanyForUser(userId, companyId);
  if (!assignedCompany) {
    throw createHttpError(403, 'Selected company is not assigned to this user.');
  }

  const sessionCompanyDb = normalizeText(assignedCompany.DbName, 'Assigned company database', { required: true, maxLength: 200 });
  const normalizedRequestedCompanyDb = requestedCompanyDb
    ? normalizeText(requestedCompanyDb, 'companyDb', { required: true, maxLength: 200 })
    : sessionCompanyDb;
  if (normalizedRequestedCompanyDb.toUpperCase() !== sessionCompanyDb.toUpperCase()) {
    throw createHttpError(403, 'companyDb does not match the selected company session.');
  }

  // Form Settings in CPRF are owned by the SAP B1 user, not by the web user.
  // A UserCompanies mapping overrides the company SAP account when a person
  // has a dedicated SAP B1 identity; otherwise all web users share the
  // configured company account's layout.
  const assignedSapUserCode = normalizeText(
    assignedCompany.AssignedSapUserCode,
    'Assigned SAP user code',
    { required: false, maxLength: 150 },
  );
  const adminPanelSapUsername = normalizeText(assignedCompany.SapUsername, 'Admin panel SAP username', { required: false, maxLength: 150 });
  const preferredUserCode = assignedSapUserCode || adminPanelSapUsername || username;
  const allowedUserCodes = new Set(
    [username, assignedSapUserCode, adminPanelSapUsername]
      .filter(Boolean)
      .map((value) => value.toUpperCase()),
  );

  const normalizedRequestedUserCode = requestedUserCode
    ? normalizeText(requestedUserCode, 'userCode', { required: true, maxLength: 150 })
    : preferredUserCode;
  if (!allowedUserCodes.has(normalizedRequestedUserCode.toUpperCase())) {
    throw createHttpError(403, 'userCode does not match the authenticated or mapped SAP user.');
  }

  return {
    userId,
    companyId,
    companyDb: sessionCompanyDb,
    userCode: normalizedRequestedUserCode,
  };
};

const buildResponse = ({ scope, mapping, columns, source, warning = '' }) => ({
  success: true,
  companyDb: scope.companyDb,
  userCode: scope.userCode,
  documentType: mapping.documentType,
  objectType: mapping.objectType,
  formType: mapping.formType,
  matrixId: mapping.matrixId,
  tableName: mapping.tableName,
  source,
  ...(warning ? { warning } : {}),
  columns,
});

const getAuthoritativeLayoutRows = async ({ companyDb, userCode, documentType, formType, matrixId }) => (
  authDbService.queryRows(`
    SELECT
      columnUid,
      fieldName,
      columnTitle,
      visible,
      editable,
      columnOrder,
      width,
      dataType,
      isUdf,
      source
    FROM sap_form_layout_columns
    WHERE companyDb = @companyDb
      AND userCode = @userCode
      AND documentType = @documentType
      AND formType = @formType
      AND matrixId = @matrixId
      AND LOWER(COALESCE(source, 'manual')) <> LOWER(@excludedSource)
      AND LOWER(COALESCE(source, 'manual')) <> LOWER(@liveLayoutSource)
    ORDER BY columnOrder ASC, id ASC
  `, {
    companyDb,
    userCode,
    documentType,
    formType,
    matrixId,
    excludedSource: AUTHORITATIVE_SOURCE_EXCLUSION,
    liveLayoutSource: LIVE_LAYOUT_SOURCE,
  })
);

const getSavedLiveLayoutRows = async ({ companyDb, userCode, documentType, formType, matrixId }) => (
  authDbService.queryRows(`
    SELECT
      columnUid,
      fieldName,
      columnTitle,
      visible,
      editable,
      columnOrder,
      width,
      dataType,
      isUdf,
      source
    FROM sap_form_layout_columns
    WHERE companyDb = @companyDb
      AND userCode = @userCode
      AND documentType = @documentType
      AND formType = @formType
      AND matrixId = @matrixId
      AND LOWER(COALESCE(source, 'manual')) = LOWER(@liveLayoutSource)
    ORDER BY columnOrder ASC, id ASC
  `, {
    companyDb,
    userCode,
    documentType,
    formType,
    matrixId,
    liveLayoutSource: LIVE_LAYOUT_SOURCE,
  })
);

const saveLayoutRows = async ({
  companyId,
  companyDb,
  userCode,
  documentType,
  formType,
  matrixId,
  tableName,
  columns,
} = {}) => {
  await authDbService.transaction(async (tx) => {
    await tx.query(`
      DELETE FROM sap_form_layout_columns
      WHERE (CompanyId = @companyId OR (CompanyId IS NULL AND UPPER(companyDb) = UPPER(@companyDb)))
        AND UPPER(userCode) = UPPER(@userCode)
        AND documentType = @documentType
        AND formType = @formType
        AND matrixId = @matrixId
    `, {
      companyId,
      companyDb,
      userCode,
      documentType,
      formType,
      matrixId,
    });

    for (const column of columns) {
      await tx.query(`
        INSERT INTO sap_form_layout_columns (
          CompanyId,
          companyDb,
          userCode,
          documentType,
          formType,
          matrixId,
          tableName,
          columnUid,
          fieldName,
          columnTitle,
          visible,
          editable,
          columnOrder,
          width,
          dataType,
          isUdf,
          source,
          createdAt,
          updatedAt
        )
        VALUES (
          @companyId,
          @companyDb,
          @userCode,
          @documentType,
          @formType,
          @matrixId,
          @tableName,
          @columnUid,
          @fieldName,
          @columnTitle,
          @visible,
          @editable,
          @columnOrder,
          @width,
          @dataType,
          @isUdf,
          @source,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT(CompanyId, companyDb, userCode, documentType, formType, matrixId, columnUid) DO UPDATE SET
          tableName = excluded.tableName,
          fieldName = excluded.fieldName,
          columnTitle = excluded.columnTitle,
          visible = excluded.visible,
          editable = excluded.editable,
          columnOrder = excluded.columnOrder,
          width = excluded.width,
          dataType = excluded.dataType,
          isUdf = excluded.isUdf,
          source = excluded.source,
          updatedAt = CURRENT_TIMESTAMP
      `, {
        companyId,
        companyDb,
        userCode,
        documentType,
        formType,
        matrixId,
        tableName,
        columnUid: column.columnUid,
        fieldName: column.fieldName,
        columnTitle: column.columnTitle,
        visible: column.visible ? 1 : 0,
        editable: column.editable ? 1 : 0,
        columnOrder: column.columnOrder,
        width: column.width,
        dataType: column.dataType,
        isUdf: column.isUdf ? 1 : 0,
        source: column.source,
      });
    }
  });
};

const queryRowsSafe = async (sql, params = {}) => {
  try {
    const result = await db.query(sql, params);
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.recordset)) return result.recordset;
    if (Array.isArray(result?.rows)) return result.rows;
    if (Array.isArray(result?.value)) return result.value;
    return [];
  } catch (error) {
    console.warn('[SAP_LAYOUT] Live metadata query failed:', error?.message || error);
    return [];
  }
};

const resolveSapUserSign = async (userCode) => {
  const sapUsername = normalizeText(userCode, 'userCode', { required: false, maxLength: 150 });
  if (!sapUsername) return null;

  const rows = await queryRowsSafe(`
    SELECT TOP 1 USERID
    FROM OUSR
    WHERE USER_CODE = @sapUsername
       OR U_NAME = @sapUsername
    ORDER BY
      CASE WHEN USER_CODE = @sapUsername THEN 0 ELSE 1 END,
      USERID
  `, { sapUsername });

  const userSign = Number(rows[0]?.USERID);
  return Number.isFinite(userSign) ? userSign : null;
};

const getTableColumnMetadata = async (tableName) => {
  const rows = await queryRowsSafe(`
    SELECT
      COLUMN_NAME,
      DATA_TYPE,
      CHARACTER_MAXIMUM_LENGTH,
      NUMERIC_PRECISION,
      NUMERIC_SCALE,
      IS_NULLABLE,
      ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = @tableName
    ORDER BY ORDINAL_POSITION
  `, { tableName });

  return rows.reduce((acc, row) => {
    const name = String(row.COLUMN_NAME || '').trim();
    if (!name) return acc;
    acc[name.toUpperCase()] = {
      name,
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

const getAssignedFormTemplateIds = async ({ formType, userSign }) => {
  if (userSign == null) return [];

  const tableRows = await queryRowsSafe(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'UIC4'
  `);
  if (!tableRows.length) return [];

  const columnRows = await queryRowsSafe(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'UIC4'
  `);
  const columns = new Set(columnRows.map((row) => String(row.COLUMN_NAME || '').trim().toUpperCase()));
  if (!columns.has('TPLID') || !columns.has('FORMID') || !columns.has('USERID')) return [];

  const rows = await queryRowsSafe(`
    SELECT TPLId
    FROM UIC4
    WHERE FormId = @formType
      AND UserID = @userSign
    ORDER BY TPLId
  `, { formType, userSign });

  return unique(rows
    .map((row) => Number(row.TPLId))
    .filter((value) => Number.isFinite(value) && value > 0));
};

const getCprfRows = async ({ formType, matrixId, tableName, userCode }) => {
  const tableRows = await queryRowsSafe(`
    SELECT TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME = 'CPRF'
  `);
  if (!tableRows.length) return { rows: [], userSign: null };

  const cprfColumns = await queryRowsSafe(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'CPRF'
  `);
  const columnSet = new Set(cprfColumns.map((row) => String(row.COLUMN_NAME || '').trim()));
  const hasItemUid = columnSet.has('ItemUID');
  const hasTableName = columnSet.has('TableName');
  const hasCaption = columnSet.has('Caption');
  const hasTitle = columnSet.has('Title');
  const hasDescr = columnSet.has('Descr');
  const hasColAlias = columnSet.has('ColAlias');
  const userSign = await resolveSapUserSign(userCode);
  if (userSign == null) return { rows: [], userSign: null };
  const assignedTemplateIds = await getAssignedFormTemplateIds({ formType, userSign });

  let rows = await queryRowsSafe(`
    SELECT
      FormID,
      ItemID,
      ColID,
      Width,
      VisInForm,
      VisualIndx,
      EditInForm,
      UserSign,
      TPLId
      ${hasTableName ? ', TableName' : ", '' AS TableName"}
      ${hasItemUid ? ', ItemUID' : ", '' AS ItemUID"}
      ${hasCaption ? ', Caption' : ", '' AS Caption"}
      ${hasTitle ? ', Title' : ", '' AS Title"}
      ${hasDescr ? ', Descr' : ", '' AS Descr"}
      ${hasColAlias ? ', ColAlias' : ", '' AS ColAlias"}
    FROM CPRF
    WHERE FormID = @formType
      AND (
        ItemID = @matrixId
        ${hasItemUid ? 'OR ItemUID = @matrixId' : ''}
      )
      AND UserSign = @userSign
    ORDER BY
      CASE WHEN TPLId = 0 THEN 0 ELSE 1 END,
      VisualIndx,
      ColID
  `, { formType, matrixId, userSign });

  if (!rows.length && hasTableName) {
    rows = await queryRowsSafe(`
      SELECT
        FormID,
        ItemID,
        ColID,
        Width,
        VisInForm,
        VisualIndx,
        EditInForm,
        UserSign,
        TPLId,
        TableName
        ${hasItemUid ? ', ItemUID' : ", '' AS ItemUID"}
        ${hasCaption ? ', Caption' : ", '' AS Caption"}
        ${hasTitle ? ', Title' : ", '' AS Title"}
        ${hasDescr ? ', Descr' : ", '' AS Descr"}
        ${hasColAlias ? ', ColAlias' : ", '' AS ColAlias"}
      FROM CPRF
      WHERE FormID = @formType
        AND TableName = @tableName
        AND UserSign = @userSign
      ORDER BY
        CASE WHEN TPLId = 0 THEN 0 ELSE 1 END,
        VisualIndx,
        ColID
    `, { formType, tableName, userSign });
  }

  return {
    rows: selectEffectiveCprfRows(rows, { assignedTemplateIds }),
    userSign,
  };
};

const buildReferenceColumnDefinitions = (matrixColumns = []) => (matrixColumns || [])
  .map((column) => {
    const fieldName = String(column?.sapField || column?.fieldName || column?.key || '').trim();
    const isUdf = Boolean(
      column?.isUdf
      || column?.isUdfBacked
      || fieldName.toUpperCase().startsWith('U_')
    );
    if (!fieldName || isUdf) return null;

    return {
      title: column.label || fieldName,
      fieldName,
      aliases: unique([
        column.key,
        column.label,
        column.fieldName,
        ...(column.alternativeFields || []),
        ...(column.additionalPreferenceKeys || []),
      ]),
      sapColumnIds: unique([
        column.sapColumnId,
        ...(column.sapColumnIds || []),
      ]),
      width: column.minWidth || column.width || 120,
      dataType: column.type || (column.numeric ? 'number' : column.dataType || 'string'),
    };
  })
  .filter(Boolean);

const findGenericColumnDefinition = (row = {}, mapping = {}, referenceDefinitions = []) => (
  findCprfStandardDefinition({
    row,
    preferredDefinitions: [
      ...getSalesDocumentCprfDefinitions(mapping.documentType),
      ...(referenceDefinitions || []),
    ],
    fallbackDefinitions: COMMON_MARKETING_COLUMN_DEFS,
  })
);

// CUFD FieldID is a numeric metadata ordinal, not a matrix column identity.
// The pure resolver intentionally uses only U_ aliases or descriptive CPRF
// metadata so standard ColIDs cannot become unrelated UDFs by ordinal.
const findUdfDefinitionForPreference = findCprfUdfDefinition;

// A saved row is mis-bound when its matrix ColID is one SAP reserves for a
// standard column yet the stored field is a UDF. A genuine UDF column always
// carries a U_ columnUid, so a numeric id paired with a U_ field can only come
// from the ordinal-matching resolver this replaced.
const isMisboundStandardColumn = (row = {}, mapping = {}) => {
  const columnUid = String(row.columnUid || '').trim();
  const fieldName = String(row.fieldName || '').trim();
  if (!isNumericOnly(columnUid) || !fieldName.toUpperCase().startsWith('U_')) return false;
  const standardDefinition = findGenericColumnDefinition({ ColID: columnUid }, mapping);
  return Boolean(standardDefinition?.fieldName)
    && !String(standardDefinition.fieldName).toUpperCase().startsWith('U_');
};

const hasMisboundStandardColumns = (rows = [], mapping = {}) => (
  (rows || []).some((row) => isMisboundStandardColumn(row, mapping))
);

const buildGenericLiveLayoutColumnsFromCprf = async (mapping, scope) => {
  const [{ rows: preferenceRows }, lineColumns, udfDefinitions, referenceData] = await Promise.all([
    getCprfRows({
      formType: mapping.formType,
      matrixId: mapping.matrixId,
      tableName: mapping.tableName,
      userCode: scope.userCode,
    }),
    getTableColumnMetadata(mapping.tableName),
    getUdfDefinitions(mapping.tableName),
    typeof mapping.getReferenceData === 'function'
      ? mapping.getReferenceData().catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!preferenceRows.length) return [];
  const referenceDefinitions = buildReferenceColumnDefinitions(
    referenceData?.line_field_metadata?.matrix_columns || []
  );

  return sanitizeLayoutColumns(mergeDuplicateCprfLayoutColumns(preferenceRows
    .map((row, index) => {
      const standardDefinition = findGenericColumnDefinition(row, mapping, referenceDefinitions);
      const udfDefinition = findUdfDefinitionForPreference(row, udfDefinitions);
      const hasDescriptiveIdentity = [row.Caption, row.Title, row.Descr, row.ColAlias]
        .some((value) => String(value || '').trim());
      if (
        !standardDefinition
        && !udfDefinition
        && !hasDescriptiveIdentity
        && isNumericOnly(row.ColID || row.ItemUID)
      ) {
        return null;
      }
      // A standard SAP caption takes precedence over a same-named UDF. This
      // prevents a legacy `U_Unit_Price` definition from turning the actual
      // SAP Unit Price column into an unrelated renderer.
      const fieldName = standardDefinition?.fieldName || udfDefinition?.key || String(row.ColID || row.ItemUID || `column_${index + 1}`).trim();
      const metadata = lineColumns[String(fieldName || '').toUpperCase()];
      const width = Number(row.Width);
      const sapCaption = [row.Caption, row.Title, row.Descr, row.ColAlias]
        .map((value) => String(value || '').trim())
        .find(Boolean);

      return normalizeColumnInput({
        columnUid: String(row.ColID || row.ItemUID || fieldName || `column_${index + 1}`).trim(),
        fieldName,
        columnTitle: sapCaption || standardDefinition?.title || udfDefinition?.label || fieldName,
        visible: normalizeBooleanFlag(row.VisInForm, true),
        editable: normalizeBooleanFlag(row.EditInForm, true),
        columnOrder: Number.isFinite(Number(row.VisualIndx)) ? Number(row.VisualIndx) : index + 1,
        width: Number.isFinite(width) && width > 0
          ? width
          : (standardDefinition?.width || (udfDefinition?.type === 'textarea' ? 180 : 120)),
        dataType: standardDefinition?.dataType || udfDefinition?.type || metadata?.dataType || 'string',
        isUdf: Boolean((!standardDefinition && udfDefinition) || String(fieldName || '').trim().toUpperCase().startsWith('U_')),
        source: LIVE_LAYOUT_SOURCE,
      }, index);
    })
    .filter(Boolean)))
    .sort((left, right) => (left.columnOrder || 0) - (right.columnOrder || 0));
};

const getLiveDerivedLayoutColumns = async (mapping, scope, { preferCprf = false } = {}) => {
  // Service documents share SAP form IDs with item documents, but the matrix
  // column semantics differ. CPRF plus the service-specific definitions is
  // therefore authoritative; inherited item reference metadata is not.
  if (preferCprf || mapping.serviceLineMode) {
    const cprfColumns = await buildGenericLiveLayoutColumnsFromCprf(mapping, scope);
    if (cprfColumns.length) return cprfColumns;
  }

  const referenceData = typeof mapping.getReferenceData === 'function'
    ? await mapping.getReferenceData()
    : null;
  const preferenceRows = Number(referenceData?.line_field_metadata?.sap_form?.preferenceRows || 0);
  const matrixColumns = referenceData?.line_field_metadata?.matrix_columns || [];
  const rowUdfFields = referenceData?.udf_metadata?.rows || [];

  if (!preferenceRows || !Array.isArray(matrixColumns) || !matrixColumns.length) {
    const genericColumns = await buildGenericLiveLayoutColumnsFromCprf(mapping, scope);
    return sanitizeLayoutColumns(genericColumns);
  }

  if (LIVE_MARKETING_LAYOUT_WITH_UDFS.has(mapping.documentType)) {
    const liveColumns = buildLiveMarketingLayoutColumns({
      matrixColumns,
      rowUdfFields,
    });

    return sanitizeLayoutColumns(liveColumns.length
      ? liveColumns
      : matrixColumns.map(mapLiveMatrixColumnToLayoutColumn));
  }

  if (mapping.documentType === 'SALES_ORDER') {
    const strictColumns = buildStrictSalesOrderLayoutColumns({
      matrixColumns,
      rowUdfFields,
    });

    return sanitizeLayoutColumns(strictColumns.length
      ? strictColumns
      : matrixColumns.map(mapLiveMatrixColumnToLayoutColumn));
  }

  return sanitizeLayoutColumns(matrixColumns.map(mapLiveMatrixColumnToLayoutColumn));
};

const getDocumentLayout = async (auth, input = {}) => {
  const mapping = normalizeDocumentType(input);
  const scope = await normalizeAuth(auth, input.companyDb, input.userCode);
  const refreshLive = normalizeBooleanFlag(input.refresh, false);
  const layoutBuildKey = [
    scope.companyDb,
    scope.userCode,
    mapping.documentType,
    mapping.formType,
    mapping.matrixId,
    refreshLive ? 'refresh' : 'cached',
  ].join('|').toUpperCase();

  const rows = await getAuthoritativeLayoutRows({
    companyDb: scope.companyDb,
    userCode: scope.userCode,
    documentType: mapping.documentType,
    formType: mapping.formType,
    matrixId: mapping.matrixId,
  });

  if (!refreshLive && rows.length) {
    return buildResponse({
      scope,
      mapping,
      columns: rows.map(mapRowToColumn),
      source: 'imported-layout',
    });
  }

  const savedLiveRows = await getSavedLiveLayoutRows({
    companyDb: scope.companyDb,
    userCode: scope.userCode,
    documentType: mapping.documentType,
    formType: mapping.formType,
    matrixId: mapping.matrixId,
  });

  const savedServiceTokens = new Set(savedLiveRows.flatMap((row) => [
    row.fieldName,
    row.columnUid,
    row.columnTitle,
  ].map(normalizeLayoutMatchToken).filter(Boolean)));
  const savedServiceLayoutHasAccount = [
    'ACCTCODE',
    'ACCOUNTCODE',
    'GLACCOUNT',
  ].some((fieldToken) => savedServiceTokens.has(fieldToken));
  const savedServiceLayoutIsIncompatible = Boolean(
    mapping.serviceLineMode
    && savedLiveRows.length
    && (
      savedServiceTokens.has('ITEMCODE')
      || savedServiceTokens.has('WAREHOUSECODE')
      || savedServiceTokens.has('WHSCODE')
      || !savedServiceLayoutHasAccount
    )
  );

  const savedLiveRowsMissingUdfs = LIVE_MARKETING_LAYOUT_WITH_UDFS.has(mapping.documentType)
    && savedLiveRows.length;

  // An earlier resolver paired a numeric CPRF ColID with a UDF by ordinal, so
  // saved layouts can bind a standard SAP caption such as Unit Price to an
  // unrelated UDF. Those rows make the column read and write the wrong line
  // field, so the layout is re-derived from SAP rather than trusted.
  const savedLayoutHasMisboundStandardColumns = hasMisboundStandardColumns(savedLiveRows, mapping);
  if (savedLayoutHasMisboundStandardColumns) {
    console.warn(
      `[SAP_LAYOUT] Discarding a stale ${mapping.documentType} layout for `
      + `${scope.companyDb}/${scope.userCode}: standard captions are bound to unrelated UDF fields.`,
    );
  }

  if (!refreshLive && savedLiveRows.length && !savedLiveRowsMissingUdfs
      && !savedServiceLayoutIsIncompatible && !savedLayoutHasMisboundStandardColumns) {
    const sanitizedSavedLiveRows = sanitizeLayoutColumns(savedLiveRows.map(mapRowToColumn));
    if (sanitizedSavedLiveRows.length !== savedLiveRows.length) {
      await saveLayoutRows({
        companyId: scope.companyId,
        companyDb: scope.companyDb,
        userCode: scope.userCode,
        documentType: mapping.documentType,
        formType: mapping.formType,
        matrixId: mapping.matrixId,
        tableName: mapping.tableName,
        columns: sanitizedSavedLiveRows,
      });
    }
    if (sanitizedSavedLiveRows.length) {
      return buildResponse({
        scope,
        mapping,
        columns: sanitizedSavedLiveRows,
        source: LIVE_LAYOUT_SOURCE,
      });
    }
  }

  if (liveLayoutBuilds.has(layoutBuildKey)) {
    return liveLayoutBuilds.get(layoutBuildKey);
  }

  const buildPromise = (async () => {
    const liveDerivedColumns = await getLiveDerivedLayoutColumns(mapping, scope, {
      preferCprf: refreshLive,
    });
    if (liveDerivedColumns.length) {
      await saveLayoutRows({
        companyId: scope.companyId,
        companyDb: scope.companyDb,
        userCode: scope.userCode,
        documentType: mapping.documentType,
        formType: mapping.formType,
        matrixId: mapping.matrixId,
        tableName: mapping.tableName,
        columns: liveDerivedColumns,
      });

      return buildResponse({
        scope,
        mapping,
        columns: liveDerivedColumns,
        source: LIVE_LAYOUT_SOURCE,
      });
    }

    // A forced live read is allowed to fall back safely when the selected SAP
    // user has no CPRF records or the company does not expose CPRF. Do not
    // discard the last known layout in that case.
    if (rows.length) {
      return buildResponse({
        scope,
        mapping,
        columns: rows.map(mapRowToColumn),
        source: 'imported-layout',
      });
    }

    // A mis-bound layout is worse than none: its columns read and write the
    // wrong line field silently, so the neutral fallback is used instead.
    if (savedLiveRows.length && !savedLayoutHasMisboundStandardColumns) {
      const sanitizedSavedLiveRows = sanitizeLayoutColumns(savedLiveRows.map(mapRowToColumn));
      if (sanitizedSavedLiveRows.length) {
        return buildResponse({
          scope,
          mapping,
          columns: sanitizedSavedLiveRows,
          source: LIVE_LAYOUT_SOURCE,
        });
      }
    }

    // Local ERP: the built-in standard layout is the normal case, not a warning.
    return buildResponse({
      scope,
      mapping,
      columns: mapping.fallbackColumns.map((column) => ({
        ...column,
        visible: true,
        editable: column.fieldName !== 'LineNum',
        source: 'fallback',
      })),
      source: 'fallback',
    });
  })().finally(() => {
    liveLayoutBuilds.delete(layoutBuildKey);
  });

  liveLayoutBuilds.set(layoutBuildKey, buildPromise);
  return buildPromise;
};

const startSyncRun = async ({ companyDb, userCode, documentType, message }) => {
  const result = await authDbService.query(`
    INSERT INTO sap_form_layout_sync_runs (companyDb, userCode, documentType, status, message, startedAt)
    VALUES (@companyDb, @userCode, @documentType, 'running', @message, CURRENT_TIMESTAMP)
  `, {
    companyDb,
    userCode,
    documentType,
    message: message || null,
  });

  return Number(result.lastInsertId || 0);
};

const finishSyncRun = async (id, status, message) => {
  if (!id) return;
  await authDbService.query(`
    UPDATE sap_form_layout_sync_runs
    SET status = @status,
        message = @message,
        completedAt = CURRENT_TIMESTAMP
    WHERE id = @id
  `, {
    id,
    status,
    message: message || null,
  });
};

const importDocumentLayout = async (auth, input = {}) => {
  const mapping = normalizeDocumentType(input);
  const scope = await normalizeAuth(auth, input.companyDb, input.userCode);
  const formType = normalizeText(input.formType || mapping.formType, 'formType', { required: true, maxLength: 50 });
  const matrixId = normalizeText(input.matrixId || mapping.matrixId, 'matrixId', { required: true, maxLength: 50 });
  const tableName = normalizeText(input.tableName || mapping.tableName, 'tableName', { required: true, maxLength: 50 });

  if (!Array.isArray(input.columns)) {
    throw createHttpError(400, 'columns must be an array.');
  }

  const columns = input.columns.map(normalizeColumnInput);
  const syncRunId = await startSyncRun({
    companyDb: scope.companyDb,
    userCode: scope.userCode,
    documentType: mapping.documentType,
    message: `Importing ${columns.length} layout columns.`,
  });

  try {
    await saveLayoutRows({
      companyId: scope.companyId,
      companyDb: scope.companyDb,
      userCode: scope.userCode,
      documentType: mapping.documentType,
      formType,
      matrixId,
      tableName,
      columns,
    });

    await finishSyncRun(syncRunId, 'completed', `Imported ${columns.length} layout columns.`);
  } catch (error) {
    await finishSyncRun(syncRunId, 'failed', error.message);
    throw error;
  }

  return buildResponse({
    scope,
    mapping: { ...mapping, formType, matrixId, tableName },
    columns,
    source: 'imported-layout',
  });
};

const syncDocumentLayoutUdfs = async (auth, input = {}) => {
  const mapping = normalizeDocumentType(input);
  const scope = await normalizeAuth(auth, input.companyDb, input.userCode);
  const syncRunId = await startSyncRun({
    companyDb: scope.companyDb,
    userCode: scope.userCode,
    documentType: mapping.documentType,
    message: `Syncing UDF helper metadata for ${mapping.tableName}.`,
  });

  try {
    const udfDefinitions = await getUdfDefinitions(mapping.tableName);
    const existingRows = await authDbService.queryRows(`
      SELECT fieldName
      FROM sap_form_layout_columns
      WHERE companyDb = @companyDb
        AND userCode = @userCode
        AND documentType = @documentType
        AND formType = @formType
        AND matrixId = @matrixId
    `, {
      companyDb: scope.companyDb,
      userCode: scope.userCode,
      documentType: mapping.documentType,
      formType: mapping.formType,
      matrixId: mapping.matrixId,
    });

    const existingFieldNames = new Set(
      existingRows.map((row) => String(row.fieldName || '').trim().toUpperCase()).filter(Boolean),
    );

    const columnsToInsert = udfDefinitions
      .filter((field) => String(field.key || '').trim().toUpperCase().startsWith('U_'))
      .filter((field) => !existingFieldNames.has(String(field.key || '').trim().toUpperCase()))
      .map((field, index) => ({
        columnUid: field.key,
        fieldName: field.key,
        columnTitle: field.label || field.key,
        visible: false,
        editable: !field.readOnly,
        columnOrder: 5000 + index,
        width: field.type === 'textarea' ? 180 : 120,
        dataType: field.type || 'string',
        isUdf: true,
        source: AUTHORITATIVE_SOURCE_EXCLUSION,
      }));

    for (const column of columnsToInsert) {
      await authDbService.query(`
        INSERT INTO sap_form_layout_columns (
          CompanyId,
          companyDb,
          userCode,
          documentType,
          formType,
          matrixId,
          tableName,
          columnUid,
          fieldName,
          columnTitle,
          visible,
          editable,
          columnOrder,
          width,
          dataType,
          isUdf,
          source,
          createdAt,
          updatedAt
        )
        VALUES (
          @companyId,
          @companyDb,
          @userCode,
          @documentType,
          @formType,
          @matrixId,
          @tableName,
          @columnUid,
          @fieldName,
          @columnTitle,
          @visible,
          @editable,
          @columnOrder,
          @width,
          @dataType,
          @isUdf,
          @source,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT(CompanyId, companyDb, userCode, documentType, formType, matrixId, columnUid) DO UPDATE SET
          fieldName = excluded.fieldName,
          columnTitle = excluded.columnTitle,
          editable = excluded.editable,
          width = excluded.width,
          dataType = excluded.dataType,
          isUdf = excluded.isUdf,
          source = excluded.source,
          updatedAt = CURRENT_TIMESTAMP
      `, {
        companyId: scope.companyId,
        companyDb: scope.companyDb,
        userCode: scope.userCode,
        documentType: mapping.documentType,
        formType: mapping.formType,
        matrixId: mapping.matrixId,
        tableName: mapping.tableName,
        columnUid: column.columnUid,
        fieldName: column.fieldName,
        columnTitle: column.columnTitle,
        visible: column.visible ? 1 : 0,
        editable: column.editable ? 1 : 0,
        columnOrder: column.columnOrder,
        width: column.width,
        dataType: column.dataType,
        isUdf: column.isUdf ? 1 : 0,
        source: column.source,
      });
    }

    await finishSyncRun(syncRunId, 'completed', `Synced ${columnsToInsert.length} helper UDF columns.`);

    return {
      success: true,
      companyDb: scope.companyDb,
      userCode: scope.userCode,
      documentType: mapping.documentType,
      formType: mapping.formType,
      matrixId: mapping.matrixId,
      tableName: mapping.tableName,
      syncedCount: columnsToInsert.length,
      columns: columnsToInsert,
    };
  } catch (error) {
    await finishSyncRun(syncRunId, 'failed', error.message);
    throw error;
  }
};

module.exports = {
  DOCUMENT_TYPES,
  getDocumentLayout,
  hasMisboundStandardColumns,
  importDocumentLayout,
  isMisboundStandardColumn,
  syncDocumentLayoutUdfs,
};
