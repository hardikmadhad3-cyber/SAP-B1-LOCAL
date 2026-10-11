import { filterSafePurchaseMatrixColumns } from '../utils/purchaseDocumentFormSettings';

const FORM_SETTINGS_STORAGE_KEY = 'sapb1.purchaseQuotation.formSettings.v1';

const HEADER_UDF_DEFINITIONS = [];

const ROW_UDF_DEFINITIONS = [];

const CONFIGURED_MATRIX_COLUMNS = [
  { key: 'itemNo', label: 'Item No.', visible: true, minWidth: 160 },
  { key: 'requiredDate', label: 'Required Date', visible: true, minWidth: 125 },
  { key: 'quotedDate', label: 'Quoted Date', visible: true, minWidth: 125 },
  { key: 'requiredQty', label: 'Required Qty.', visible: true, minWidth: 110 },
  { key: 'quantity', label: 'Quoted Qty.', visible: true, minWidth: 110 },
  { key: 'unitPrice', label: 'Unit Price', visible: true, minWidth: 110 },
  { key: 'stdDiscount', label: 'Discount %', visible: true, minWidth: 95 },
  { key: 'taxCode', label: 'Tax Code', visible: true, minWidth: 115 },
  { key: 'totalLC', label: 'Total (LC)', visible: true, minWidth: 115 },
  { key: 'distRule', label: 'Distr. Rule', visible: true, minWidth: 105 },
  { key: 'uomCode', label: 'UoM Code', visible: true, minWidth: 105 },
  { key: 'uomName', label: 'UoM Name', visible: true, minWidth: 120 },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', visible: true, minWidth: 185 },
  { key: 'loc', label: 'Loc.', visible: true, minWidth: 115 },
  { key: 'blanketAgreementNo', label: 'Blanket Agreement No.', visible: true, minWidth: 170 },
  { key: 'hsnCode', label: 'HSN', visible: true, minWidth: 115 },
  { key: 'sacCode', label: 'SAC', visible: true, minWidth: 95 },
  { key: 'U_Cost_Sheet', label: 'Cost-Sheet', visible: true, minWidth: 125, sapField: 'U_Cost_Sheet' },
  { key: 'U_PackingType', label: 'Packing-Type', visible: true, minWidth: 140, sapField: 'U_PackingType' },
  { key: 'U_ContainerType', label: 'Container Type', visible: true, minWidth: 145, sapField: 'U_ContainerType' },
  { key: 'U_GrossWt', label: 'GrossWt', visible: true, minWidth: 110, sapField: 'U_GrossWt' },
  { key: 'U_TotalPackage', label: 'Total-Package', visible: true, minWidth: 130, sapField: 'U_TotalPackage' },
  { key: 'taxCodeRepeat', label: 'TaxCode', visible: true, minWidth: 110, sapField: 'U_TAXCODE' },
  { key: 'price', label: 'Price', visible: true, minWidth: 110, sapField: 'U_PRICE' },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', visible: true, minWidth: 125 },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', visible: true, minWidth: 125 },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', visible: true, minWidth: 135 },
  { key: 'sellerDelivery', label: 'Seller - Delivery', visible: true, minWidth: 135 },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of payment', visible: true, minWidth: 180 },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', visible: true, minWidth: 180 },
  { key: 'buyerQuality', label: 'Buyer - Quality', visible: true, minWidth: 155 },
  { key: 'sellerQuality', label: 'Seller - Quality', visible: true, minWidth: 155 },
  { key: 'buyerPrice', label: 'Buyer - Price', visible: true, minWidth: 135 },
  { key: 'sellerPrice', label: 'Seller - Price', visible: true, minWidth: 135 },
  { key: 'buyerSpecialInstruction', label: 'Buyer - Special Instruction', visible: true, minWidth: 190 },
  { key: 'sellerSpecialInstruction', label: 'Seller - Special Instruction', visible: true, minWidth: 190 },
  { key: 'sellerBrokerageAmtPer', label: 'Seller Brokerage(Amt./Per)', visible: true, minWidth: 165 },
  { key: 'sellerBrokeragePercent', label: 'Seller Brokerage in Percentage', visible: true, minWidth: 180 },
  { key: 'stcode', label: 'STCODE', visible: true, minWidth: 110 },
  { key: 'sellerItem', label: 'S_Item', visible: true, minWidth: 125 },
  { key: 'sellerQty', label: 'S_Qty', visible: true, minWidth: 110 },
  { key: 'specialRebate', label: 'Special Rebate', visible: true, minWidth: 120 },
  { key: 'commission', label: 'Commision', visible: true, minWidth: 110 },
  { key: 'sellerBrokeragePerQty', label: 'BrokPerQty', visible: true, minWidth: 115 },
  { key: 'U_Fix_Brock_B', label: 'FIX Brok BUYER', visible: true, minWidth: 135, sapField: 'U_Fix_Brock_B' },
  { key: 'U_Fix_Brock_S', label: 'Fix Brock Seller', visible: true, minWidth: 140, sapField: 'U_Fix_Brock_S' },
  { key: 'itemDescription', label: 'Item Description', visible: false },
  { key: 'whse', label: 'Whse', visible: false },
  { key: 'taxAmount', label: 'Tax Amount (LC)', visible: false },
  { key: 'totalBeforeTax', label: 'Total Before Tax', visible: false },
  { key: 'branch', label: 'Branch', visible: false },
];

const getOptionValue = (option) => (typeof option === 'string' ? option : option?.value ?? '');

const BASE_MATRIX_COLUMNS = filterSafePurchaseMatrixColumns(CONFIGURED_MATRIX_COLUMNS);

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

const getDefaultUdfValue = (field = {}) => {
  if (shouldKeepUdfBlankByDefault(field)) return '';

  if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== '') {
    return field.defaultValue;
  }

  if (field.required && field.type === 'select' && Array.isArray(field.options)) {
    return field.options.map(getOptionValue).find((value) => String(value || '').trim() !== '') ?? '';
  }

  return field.defaultValue ?? '';
};

const createUdfState = (definitions = [], values = {}) =>
  definitions.reduce((acc, field) => {
    const currentValue = values[field.key];
    const shouldApplyDefault =
      currentValue === undefined ||
      currentValue === null ||
      (field.required && String(currentValue) === '');

    acc[field.key] = shouldApplyDefault ? getDefaultUdfValue(field) : currentValue;
    return acc;
  }, {});

const buildVisibilitySettings = (definitions = []) =>
  definitions.reduce((acc, field) => {
    acc[field.key] = {
      visible: field.visible !== undefined ? field.visible : true,
      active: true,
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
  matrixColumns: buildVisibilitySettings(Array.isArray(matrixColumns) ? matrixColumns : BASE_MATRIX_COLUMNS),
  rowUdfs: buildVisibilitySettings(rowUdfs),
});

const mergeNestedSettings = (defaults, saved = {}) =>
  Object.keys(defaults).reduce((acc, groupKey) => {
    acc[groupKey] = {
      ...defaults[groupKey],
      ...(saved[groupKey] || {}),
    };
    return acc;
  }, {});

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
    return mergeNestedSettings(defaults, JSON.parse(raw));
  } catch (_error) {
    return defaults;
  }
};

export {
  BASE_MATRIX_COLUMNS,
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createDefaultFormSettings,
  createUdfState,
  readSavedFormSettings,
};
