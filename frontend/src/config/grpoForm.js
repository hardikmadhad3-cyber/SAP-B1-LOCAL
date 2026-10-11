import { mergeSavedFormSettings } from '../utils/formSettingsPreferences';
import { filterSafePurchaseMatrixColumns } from '../utils/purchaseDocumentFormSettings';

const FORM_SETTINGS_STORAGE_KEY = 'sapb1.grpo.formSettings.v1';

const HEADER_UDF_DEFINITIONS = [];

const ROW_UDF_DEFINITIONS = [];

const GRPO_LINE_UDF_FIELD_MAP = {
  packingType: ['U_PackingType', 'U_PACKINGTYPE', 'U_Packing_Type', 'U_PackingStatus', 'U_PACKINGSTATUS'],
  grossWt: ['U_GrossWt', 'U_GROSSWT', 'U_Gross_Wt', 'U_GrossWeight', 'U_GROSSWEIGHT'],
  totalPackage: ['U_TotalPackage', 'U_TOTALPACKAGE', 'U_Total_Package', 'U_TotalPackge'],
  taxCodeRepeat: 'U_TAXCODE',
  price: ['U_PRICE', 'U_Price'],
  sellerBrokerage: 'U_Brok_Seller',
  buyerBrokerage: ['U_Brok_Buyer', 'U_Buyer_Brokerage', 'U_BUYERBROKERAGE', 'U_Brokerage_Buyer'],
  buyerDelivery: 'U_Buyer_Delivery',
  sellerDelivery: 'U_Seller_Delivery',
  buyerPaymentTerms: 'U_Buyer_Payment_Terms',
  sellerPaymentTerms: 'U_Seller_Payment_Term',
  buyerQuality: 'U_Buyer_Quality',
  sellerQuality: 'U_Seller_Quality',
  buyerPrice: 'U_Buyer_Price',
  sellerPrice: 'U_Seller_Price',
  buyerSpecialInstruction: 'U_Buyer_SPINS',
  sellerSpecialInstruction: 'U_Seller_SPINS',
  sellerBrokerageAmtPer: 'U_Sel_Brok_AP',
  sellerBrokeragePercent: 'U_Seller_Brok_Per',
  stcode: 'U_SELLTCODE',
  sellerItem: 'U_S_Item',
  sellerQty: 'U_S_Qty',
  specialRebate: 'U_SPLRBT',
  commission: 'U_COMPRC',
  sellerBrokeragePerQty: 'U_S_BrokPerQty',
  fixBrokBuyer: 'U_Fix_Brock_B',
  fixBrockSeller: 'U_Fix_Brock_S',
  sellerPaymentTermsDuplicate: 'U_Seller_Payment_Term',
};

const CONFIGURED_MATRIX_COLUMNS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160 },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240 },
  { key: 'quantity', label: 'Quantity', minWidth: 95 },
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
  { key: 'packingType', label: 'Packing-Type', minWidth: 140, udfKey: GRPO_LINE_UDF_FIELD_MAP.packingType },
  { key: 'grossWt', label: 'GrossWt', minWidth: 110, udfKey: GRPO_LINE_UDF_FIELD_MAP.grossWt },
  { key: 'totalPackage', label: 'Total-Package', minWidth: 130, udfKey: GRPO_LINE_UDF_FIELD_MAP.totalPackage },
  { key: 'binLocationAllocation', label: 'Bin Location Allocation', minWidth: 160 },
  { key: 'whse', label: 'Whse', minWidth: 90 },
  { key: 'taxCodeRepeat', label: 'TaxCode', minWidth: 110, udfKey: GRPO_LINE_UDF_FIELD_MAP.taxCodeRepeat },
  { key: 'price', label: 'Price', minWidth: 110, udfKey: GRPO_LINE_UDF_FIELD_MAP.price },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 125, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerBrokerage },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', minWidth: 125, udfKey: GRPO_LINE_UDF_FIELD_MAP.buyerBrokerage },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', minWidth: 135, udfKey: GRPO_LINE_UDF_FIELD_MAP.buyerDelivery },
  { key: 'sellerDelivery', label: 'Seller - Delivery', minWidth: 135, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerDelivery },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of payment', minWidth: 180, udfKey: GRPO_LINE_UDF_FIELD_MAP.buyerPaymentTerms },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', minWidth: 180, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerPaymentTerms },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 155, udfKey: GRPO_LINE_UDF_FIELD_MAP.buyerQuality },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 155, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerQuality },
  { key: 'buyerPrice', label: 'Buyer - Price', minWidth: 135, udfKey: GRPO_LINE_UDF_FIELD_MAP.buyerPrice },
  { key: 'sellerPrice', label: 'Seller - Price', minWidth: 135, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerPrice },
  { key: 'buyerSpecialInstruction', label: 'Buyer - Special Instruction', minWidth: 190, udfKey: GRPO_LINE_UDF_FIELD_MAP.buyerSpecialInstruction },
  { key: 'sellerSpecialInstruction', label: 'Seller - Special Instruction', minWidth: 190, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerSpecialInstruction },
  { key: 'sellerBrokerageAmtPer', label: 'Seller Brokerage(Amt./Per)', minWidth: 175, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerBrokerageAmtPer },
  { key: 'sellerBrokeragePercent', label: 'Seller Brokerage in Percentage', minWidth: 190, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerBrokeragePercent },
  { key: 'stcode', label: 'STCODE', minWidth: 110, udfKey: GRPO_LINE_UDF_FIELD_MAP.stcode },
  { key: 'sellerItem', label: 'S_Item', minWidth: 125, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerItem },
  { key: 'sellerQty', label: 'S_Qty', minWidth: 110, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerQty },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 120, udfKey: GRPO_LINE_UDF_FIELD_MAP.specialRebate },
  { key: 'commission', label: 'Commision', minWidth: 110, udfKey: GRPO_LINE_UDF_FIELD_MAP.commission },
  { key: 'sellerBrokeragePerQty', label: 'BrokPerQty', minWidth: 115, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerBrokeragePerQty },
  { key: 'fixBrokBuyer', label: 'FIX Brok BUYER', minWidth: 135, udfKey: GRPO_LINE_UDF_FIELD_MAP.fixBrokBuyer },
  { key: 'fixBrockSeller', label: 'Fix Brock Seller', minWidth: 140, udfKey: GRPO_LINE_UDF_FIELD_MAP.fixBrockSeller },
  { key: 'sellerPaymentTermsDuplicate', label: 'Seller - Terms of Payment', minWidth: 180, udfKey: GRPO_LINE_UDF_FIELD_MAP.sellerPaymentTermsDuplicate },
];

const BASE_MATRIX_COLUMNS = filterSafePurchaseMatrixColumns(CONFIGURED_MATRIX_COLUMNS);
const BASE_MATRIX_COLUMN_KEYS = new Set(BASE_MATRIX_COLUMNS.map((column) => column.key));

const normalizeGRPOMatrixColumns = (columns = BASE_MATRIX_COLUMNS) => {
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

const createUdfState = (definitions = [], values = {}) =>
  (Array.isArray(definitions) ? definitions : []).reduce((acc, field) => {
    acc[field.key] = values[field.key] ?? (shouldKeepUdfBlankByDefault(field) ? '' : field.defaultValue ?? '');
    return acc;
  }, {});

const buildVisibilitySettings = (definitions = []) =>
  (Array.isArray(definitions) ? definitions : []).reduce((acc, field, index) => {
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
  matrixColumns: buildVisibilitySettings(Array.isArray(matrixColumns) ? matrixColumns : BASE_MATRIX_COLUMNS),
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
  GRPO_LINE_UDF_FIELD_MAP,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createDefaultFormSettings,
  createUdfState,
  normalizeGRPOMatrixColumns,
  readSavedFormSettings,
};
