import { mergeSavedFormSettings } from '../utils/formSettingsPreferences';
import { filterSafePurchaseMatrixColumns } from '../utils/purchaseDocumentFormSettings';

const FORM_SETTINGS_STORAGE_KEY = 'sapb1.purchaseOrder.formSettings.v1';

const HEADER_UDF_DEFINITIONS = [];

const ROW_UDF_DEFINITIONS = [];

const CONFIGURED_MATRIX_COLUMNS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160 },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240 },
  { key: 'quantity', label: 'Quantity', minWidth: 90 },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105 },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'hsnCode', label: 'HSN', minWidth: 145 },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 110 },
  { key: 'taxCode', label: 'Tax Code', minWidth: 115 },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 185 },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 105 },
  { key: 'loc', label: 'Loc.', minWidth: 90 },
  { key: 'sac', label: 'SAC', minWidth: 105 },
  { key: 'blanketAgreementNo', label: 'Blanket Agreement No.', minWidth: 170 },
  { key: 'costSheet', label: 'Cost-Sheet', minWidth: 130 },
  { key: 'containerType', label: 'Container Type', minWidth: 145 },
  { key: 'forRate', label: 'FOR-Price', minWidth: 110 },
  { key: 'total', label: 'Total', minWidth: 110 },
  { key: 'packingType', label: 'Packing-Type', minWidth: 140 },
  { key: 'grossWt', label: 'GrossWt', minWidth: 110 },
  { key: 'totalPackage', label: 'Total-Package', minWidth: 130 },
  { key: 'whse', label: 'Whse', minWidth: 90 },
  {
    key: 'commPercent',
    label: 'Comm. %',
    minWidth: 95,
    sapField: 'Commission',
    sapColumnIds: ['28', 'Commission', 'CommissionPercent', 'Commission Percentage', 'Comm. %'],
  },
  { key: 'taxCodeRepeat', label: 'TaxCode', minWidth: 110 },
  { key: 'price', label: 'Price', minWidth: 110 },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 125 },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', minWidth: 125 },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', minWidth: 135 },
  { key: 'sellerDelivery', label: 'Seller - Delivery', minWidth: 135 },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of payment', minWidth: 180 },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', minWidth: 180 },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 155 },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 155 },
  { key: 'buyerPrice', label: 'Buyer - Price', minWidth: 135 },
  { key: 'sellerPrice', label: 'Seller - Price', minWidth: 135 },
  { key: 'buyerSpecialInstruction', label: 'Buyer - Special Instruction', minWidth: 190 },
  { key: 'sellerSpecialInstruction', label: 'Seller - Special Instruction', minWidth: 190 },
  { key: 'sellerBrokerageAmtPer', label: 'Seller Brokerage(Amt./Per)', minWidth: 165 },
  { key: 'sellerBrokeragePercent', label: 'Seller Brokerage in Percentage', minWidth: 180 },
  { key: 'stcode', label: 'STCODE', minWidth: 110 },
  { key: 'sellerItem', label: 'S_Item', minWidth: 125 },
  { key: 'sellerQty', label: 'S_Qty', minWidth: 110 },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 120 },
  { key: 'commission', label: 'Commision', minWidth: 110, sapField: 'U_COMPRC', isUdf: true },
  { key: 'sellerBrokeragePerQty', label: 'BrokPerQty', minWidth: 115 },
  { key: 'fixBrokBuyer', label: 'FIX Brok BUYER', minWidth: 135 },
  { key: 'fixBrockSeller', label: 'Fix Brock Seller', minWidth: 140 },
];

const BASE_MATRIX_COLUMNS = filterSafePurchaseMatrixColumns(CONFIGURED_MATRIX_COLUMNS);
const BASE_MATRIX_COLUMN_KEYS = new Set(BASE_MATRIX_COLUMNS.map((column) => column.key));

const normalizePurchaseOrderMatrixColumns = (columns = BASE_MATRIX_COLUMNS) => {
  const metadataByKey = new Map(
    (Array.isArray(columns) ? columns : [])
      .filter((column) => column?.key && BASE_MATRIX_COLUMN_KEYS.has(column.key))
      .map((column) => [column.key, column])
  );

  return BASE_MATRIX_COLUMNS.map((baseColumn, index) => {
    const metadata = metadataByKey.get(baseColumn.key) || {};
    const metadataMinWidth = Number(metadata.minWidth || metadata.width || 0);
    const metadataWidth = Number(metadata.width || metadata.minWidth || 0);
    const baseMinWidth = Number(baseColumn.minWidth || 125);
    const effectiveMinWidth = Math.max(metadataMinWidth || 0, baseMinWidth);
    const effectiveWidth = Math.max(metadataWidth || 0, effectiveMinWidth);
    return {
      ...metadata,
      ...baseColumn,
      key: baseColumn.key,
      label: baseColumn.label,
      minWidth: effectiveMinWidth,
      width: effectiveWidth,
      visible: true,
      active: metadata.active !== false && metadata.editable !== false && baseColumn.active !== false,
      order: index + 1,
    };
  });
};

const getUdfIdentity = (field = {}) =>
  [
    field.key,
    field.sapField,
    field.aliasId,
    field.label,
    field.description,
    field.Descr,
  ].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '');

const shouldKeepUdfBlankByDefault = (field = {}) => {
  const identity = getUdfIdentity(field);
  return identity.includes('termsofsupply') ||
    identity.includes('supplyterms');
};

const asDefinitionArray = (definitions) => (Array.isArray(definitions) ? definitions : []);

const createUdfState = (definitions = [], values = {}) =>
  asDefinitionArray(definitions).reduce((acc, field) => {
    acc[field.key] = values[field.key] ?? (shouldKeepUdfBlankByDefault(field) ? '' : field.defaultValue ?? '');
    return acc;
  }, {});

const buildVisibilitySettings = (definitions = []) =>
  asDefinitionArray(definitions).reduce((acc, field, index) => {
    acc[field.key] = {
      order: Number(field.order ?? field.columnOrder ?? index + 1),
      minWidth: field.minWidth,
      sapControlled: Boolean(field.sapControlled),
      visible: field.visible !== false,
      active: field.active !== false,
      ...(field.valueKey && field.valueKey !== field.key ? { valueKey: field.valueKey } : {}),
    };
    return acc;
  }, {});

const createDefaultFormSettings = (
  headerUdfs = HEADER_UDF_DEFINITIONS,
  rowUdfs = ROW_UDF_DEFINITIONS,
  matrixColumns = BASE_MATRIX_COLUMNS,
) => ({
  headerUdfs: buildVisibilitySettings(headerUdfs),
  matrixColumns: buildVisibilitySettings(matrixColumns),
  rowUdfs: buildVisibilitySettings(rowUdfs),
});

const readSavedFormSettings = (
  headerUdfs = HEADER_UDF_DEFINITIONS,
  rowUdfs = ROW_UDF_DEFINITIONS,
  matrixColumns = BASE_MATRIX_COLUMNS,
  storageKey = FORM_SETTINGS_STORAGE_KEY,
) => {
  const effectiveMatrixColumns = Array.isArray(matrixColumns) ? matrixColumns : BASE_MATRIX_COLUMNS;
  const effectiveStorageKey = typeof matrixColumns === 'string' ? matrixColumns : storageKey;
  const defaults = createDefaultFormSettings(headerUdfs, rowUdfs, effectiveMatrixColumns);

  try {
    const raw = localStorage.getItem(effectiveStorageKey);
    if (!raw) return defaults;
    return mergeSavedFormSettings(defaults, JSON.parse(raw));
  } catch (error) {
    return defaults;
  }
};

export {
  BASE_MATRIX_COLUMNS,
  BASE_MATRIX_COLUMN_KEYS,
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createDefaultFormSettings,
  createUdfState,
  normalizePurchaseOrderMatrixColumns,
  readSavedFormSettings,
};
