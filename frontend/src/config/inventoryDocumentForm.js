export const GOODS_RECEIPT_FORM_SETTINGS_STORAGE_KEY = 'sapb1.goodsReceipt.formSettings.v1';
export const GOODS_ISSUE_FORM_SETTINGS_STORAGE_KEY = 'sapb1.goodsIssue.formSettings.v1';
export const INVENTORY_TRANSFER_FORM_SETTINGS_STORAGE_KEY = 'sapb1.inventoryTransfer.formSettings.v1';
export const INVENTORY_TRANSFER_REQUEST_FORM_SETTINGS_STORAGE_KEY = 'sapb1.inventoryTransferRequest.formSettings.v1';

export const createUdfState = (definitions = [], values = {}) =>
  definitions.reduce((acc, field) => {
    acc[field.key] = values[field.key] ?? field.defaultValue ?? '';
    return acc;
  }, {});

export const normalizeUdfState = (definitions = [], values = {}) =>
  createUdfState(definitions, values);

const buildVisibilitySettings = (definitions = []) =>
  definitions.reduce((acc, field) => {
    acc[field.key] = {
      visible: field.visible !== undefined ? field.visible : true,
      active: true,
    };
    return acc;
  }, {});

export const createDefaultFormSettings = (
  headerUdfFields = [],
  rowUdfFields = [],
  matrixColumns = [],
) => ({
  headerUdfs: buildVisibilitySettings(headerUdfFields),
  matrixColumns: buildVisibilitySettings(matrixColumns),
  rowUdfs: buildVisibilitySettings(rowUdfFields),
});

const mergeFieldSettings = (defaults = {}, saved = {}) =>
  Object.keys(defaults).reduce((acc, groupKey) => {
    acc[groupKey] = {
      ...defaults[groupKey],
      ...(saved[groupKey] || {}),
    };
    return acc;
  }, {});

export const readSavedFormSettings = (
  headerUdfFields = [],
  rowUdfFields = [],
  matrixColumns = [],
  storageKey,
) => {
  const defaults = createDefaultFormSettings(headerUdfFields, rowUdfFields, matrixColumns);

  if (!storageKey || typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    return mergeFieldSettings(defaults, JSON.parse(raw));
  } catch (_error) {
    return defaults;
  }
};

export const GOODS_RECEIPT_MATRIX_COLUMNS = [
  { key: 'itemCode', label: 'Item No.' },
  { key: 'itemDescription', label: 'Item Description' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'unitPrice', label: 'Unit Price' },
  { key: 'total', label: 'Total' },
  { key: 'warehouse', label: 'Whse' },
  { key: 'binLocationAllocation', label: 'Bin Location Allocation' },
  { key: 'accountCode', label: 'Account Code' },
  { key: 'itemCost', label: 'Item Cost' },
  { key: 'uomCode', label: 'UoM Code' },
  { key: 'uomName', label: 'UoM Name' },
  { key: 'distributionRule', label: 'Distr. Rule' },
  { key: 'rg23aPartINo', label: 'RG23A Part I No.' },
  { key: 'rg23cPartINo', label: 'RG23C Part I No.' },
  { key: 'location', label: 'Location' },
  { key: 'costSheet', label: 'Cost-Sheet' },
  { key: 'packingType', label: 'Packing-Type' },
  { key: 'containerType', label: 'Container Type' },
  { key: 'grossWt', label: 'GrossWt' },
  { key: 'totalPackage', label: 'Total-Package' },
  { key: 'taxCodeRepeat', label: 'TaxCode' },
  { key: 'price', label: 'Price' },
  { key: 'sellerBrokerage', label: 'Seller Brokerage' },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage' },
  { key: 'buyerDelivery', label: 'Buyer - Delivery' },
  { key: 'sellerDelivery', label: 'Seller - Delivery' },
  { key: 'buyerTermsOfPayment', label: 'Buyer - Terms of payment' },
  { key: 'sellerTermsOfPayment', label: 'Seller - Terms of Payment' },
  { key: 'buyerQuality', label: 'Buyer - Quality' },
  { key: 'sellerQuality', label: 'Seller - Quality' },
  { key: 'buyerPrice', label: 'Buyer - Price' },
  { key: 'sellerPrice', label: 'Seller - Price' },
  { key: 'buyerSpecialInstruction', label: 'Buyer - Special Instruction' },
  { key: 'sellerSpecialInstruction', label: 'Seller - Special Instruction' },
  { key: 'sellerBrokerageAmountPer', label: 'Seller Brokerage(Amt./Per)' },
  { key: 'sellerBrokeragePercentage', label: 'Seller Brokerage in Percentage' },
  { key: 'stcode', label: 'STCODE' },
  { key: 'sellerItem', label: 'S_Item' },
  { key: 'sellerQuantity', label: 'S_Qty' },
  { key: 'specialRebate', label: 'Special Rebate' },
  { key: 'commision', label: 'Commision' },
  { key: 'brokPerQty', label: 'BrokPerQty' },
  { key: 'fixBrokBuyer', label: 'FIX Brok BUYER' },
  { key: 'fixBrockSeller', label: 'Fix Brock Seller' },
  { key: 'sellerTermsOfPaymentDuplicate', label: 'Seller - Terms of Payment' },
];

export const INVENTORY_TRANSFER_MATRIX_COLUMNS = [
  { key: 'itemCode', label: 'Item No.' },
  { key: 'itemDescription', label: 'Item Description' },
  { key: 'fromWarehouse', label: 'From Warehouse' },
  { key: 'toWarehouse', label: 'To Warehouse' },
  { key: 'location', label: 'Loc.' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'itemCost', label: 'Item Cost' },
  { key: 'excisable', label: 'Excisable' },
  { key: 'distributionRule', label: 'Distr. Rule' },
  { key: 'uomCode', label: 'UoM Code' },
  { key: 'uomName', label: 'UoM Name' },
];
