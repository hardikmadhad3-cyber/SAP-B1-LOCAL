import { mergeSavedFormSettings } from '../utils/formSettingsPreferences';
import { filterSafePurchaseMatrixColumns } from '../utils/purchaseDocumentFormSettings';

const FORM_SETTINGS_STORAGE_KEY = 'sapb1.apInvoice.formSettings.v1';

const HEADER_UDF_DEFINITIONS = [];
const ROW_UDF_DEFINITIONS = [];

const CONFIGURED_MATRIX_COLUMNS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160 },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240 },
  { key: 'quantity', label: 'Quantity', minWidth: 90 },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 110 },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 95 },
  { key: 'taxCode', label: 'Tax Code', minWidth: 120 },
  { key: 'wtaxLiable', label: 'TDS', minWidth: 90, type: 'select', options: ['Y', 'N'], udfLabels: ['WTax Liable', 'TDS'] },
  { key: 'total', label: 'Total (LC)', minWidth: 120, readOnly: true },
  { key: 'binLocationAllocation', label: 'Bin Location Allocation', minWidth: 175, readOnly: true },
  { key: 'glAccount', label: 'G/L Account', minWidth: 130, lookup: true },
  { key: 'glAccountName', label: 'G/L Account Name', minWidth: 190, readOnly: true },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105 },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'itemCost', label: 'Item Cost', minWidth: 110, readOnly: true },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 190 },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 115, lookup: true },
  { key: 'loc', label: 'Loc.', minWidth: 115, lookup: 'location' },
  { key: 'blanketAgreementNo', label: 'Blanket Agreement No.', minWidth: 170, lookup: true },
  { key: 'hsnCode', label: 'HSN', minWidth: 115, udfLabels: ['HSN'] },
  { key: 'sac', label: 'SAC', minWidth: 105, udfLabels: ['SAC'] },
  { key: 'costSheet', label: 'Cost-Sheet', minWidth: 130, lookup: true, udfLabels: ['Cost-Sheet'] },
  { key: 'packingType', label: 'Packing-Type', minWidth: 140, lookup: true, udfLabels: ['Packing-Type'] },
  { key: 'containerType', label: 'Container Type', minWidth: 145, lookup: true, udfLabels: ['Container Type'] },
  { key: 'grossWt', label: 'GrossWt', minWidth: 110, udfLabels: ['GrossWt'] },
  { key: 'totalPackage', label: 'Total-Package', minWidth: 130, udfLabels: ['Total-Package'] },
  { key: 'taxCodeRepeat', label: 'TaxCode', minWidth: 110, udfLabels: ['TaxCode'] },
  { key: 'price', label: 'Price', minWidth: 110, udfLabels: ['Price'] },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 150, udfLabels: ['Seller Brokerage'] },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', minWidth: 145, udfLabels: ['Buyer Brokerage'] },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', minWidth: 145, udfLabels: ['Buyer - Delivery'] },
  { key: 'sellerDelivery', label: 'Seller - Delivery', minWidth: 145, udfLabels: ['Seller - Delivery'] },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of payment', minWidth: 200, lookup: true, udfLabels: ['Buyer - Terms of payment', 'Buyer - Terms of Payment'] },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', minWidth: 205, lookup: true, udfLabels: ['Seller - Terms of Payment'] },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 140, udfLabels: ['Buyer - Quality'] },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 145, udfLabels: ['Seller - Quality'] },
  { key: 'buyerPrice', label: 'Buyer - Price', minWidth: 130, udfLabels: ['Buyer - Price'] },
  { key: 'sellerPrice', label: 'Seller - Price', minWidth: 130, udfLabels: ['Seller - Price'] },
  { key: 'buyerSpecialInstruction', label: 'Buyer - Special Instruction', minWidth: 210, udfLabels: ['Buyer - Special Instruction'] },
  { key: 'sellerSpecialInstruction', label: 'Seller - Special Instruction', minWidth: 210, udfLabels: ['Seller - Special Instruction'] },
  { key: 'sellerBrokerageAmtPer', label: 'Seller Brokerage(Amt./Per)', minWidth: 210, udfLabels: ['Seller Brokerage(Amt./Per)', 'Seller Brokerage Amt Per'] },
  { key: 'sellerBrokeragePercent', label: 'Seller Brokerage in Percentage', minWidth: 225, udfLabels: ['Seller Brokerage in Percentage'] },
  { key: 'stcode', label: 'STCODE', minWidth: 115, lookup: true, udfLabels: ['STCODE'] },
  { key: 'sellerItem', label: 'S_Item', minWidth: 115, lookup: true, udfLabels: ['S_Item'] },
  { key: 'sellerQty', label: 'S_Qty', minWidth: 95, udfLabels: ['S_Qty'] },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 135, udfLabels: ['Special Rebate'] },
  { key: 'commission', label: 'Commision', minWidth: 115, udfLabels: ['Commision', 'Commission'] },
  { key: 'sellerBrokeragePerQty', label: 'BrokPerQty', minWidth: 120, udfLabels: ['BrokPerQty'] },
  { key: 'fixBrokBuyer', label: 'FIX Brok BUYER', minWidth: 135, udfLabels: ['FIX Brok BUYER'] },
  { key: 'fixBrockSeller', label: 'Fix Brock Seller', minWidth: 140, udfLabels: ['Fix Brock Seller'] },
];

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
