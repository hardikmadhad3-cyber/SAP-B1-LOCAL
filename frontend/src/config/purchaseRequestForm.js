import {
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createDefaultFormSettings,
  createUdfState,
  readSavedFormSettings as readPurchaseOrderFormSettings,
} from './purchaseOrderForm';

const BASE_MATRIX_COLUMNS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 130 },
  { key: 'itemDescription', label: 'Item/Service Description', minWidth: 210 },
  { key: 'vendor', label: 'Vendor', minWidth: 120 },
  { key: 'requiredDate', label: 'Required Date', minWidth: 125 },
  { key: 'quantity', label: 'Required Qty.', minWidth: 100 },
  { key: 'unitPrice', label: 'Info Price', minWidth: 95 },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 90 },
  { key: 'taxCode', label: 'Tax Code', minWidth: 105 },
  { key: 'distributionRule', label: 'Distr. Rule', minWidth: 105 },
  { key: 'uomCode', label: 'UoM Code', minWidth: 100 },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'whse', label: 'Whse', minWidth: 85 },
  { key: 'loc', label: 'Loc.', minWidth: 85 },
  { key: 'total', label: 'Total (LC)', minWidth: 105 },
];

const PURCHASE_REQUEST_MATRIX_KEY_ALIASES = {
  requiredQty: 'quantity',
  totalLC: 'total',
  distRule: 'distributionRule',
  uomName: 'uomCode',
  glAccount: 'itemNo',
  price: 'unitPrice',
  lineDeliveryDate: 'requiredDate',
};

// Lines the user enters on an SAP B1 Purchase Request (PRQ1). The shared layout
// builder marks columns read-only when Sales Order has no writable mapping
// (Required Qty., Info Price, Vendor...), so PR re-opens them here.
const PURCHASE_REQUEST_EDITABLE_KEYS = new Set([
  'itemNo', 'itemDescription', 'vendor', 'requiredDate', 'quantity', 'unitPrice',
  'stdDiscount', 'taxCode', 'distributionRule', 'uomCode', 'whse', 'hsnCode',
]);

const normalizePurchaseRequestMatrixColumns = (columns = []) => {
  const seenKeys = new Set();
  return (columns || []).reduce((result, column) => {
    const sourceKey = String(column?.key || '').trim();
    const key = PURCHASE_REQUEST_MATRIX_KEY_ALIASES[sourceKey] || sourceKey;
    if (!key || seenKeys.has(key)) return result;
    seenKeys.add(key);
    const editable = PURCHASE_REQUEST_EDITABLE_KEYS.has(key);
    result.push({
      ...column,
      key,
      valueKey: key,
      rendererKey: key,
      ...(editable ? { readOnly: false, displayOnly: false } : {}),
    });
    return result;
  }, []);
};

export {
  BASE_MATRIX_COLUMNS,
  normalizePurchaseRequestMatrixColumns,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createDefaultFormSettings,
  createUdfState,
};

export const FORM_SETTINGS_STORAGE_KEY = 'sapb1.purchaseRequest.formSettings.v1';

export const readSavedFormSettings = (
  headerUdfs = HEADER_UDF_DEFINITIONS,
  rowUdfs = ROW_UDF_DEFINITIONS,
  matrixColumns = BASE_MATRIX_COLUMNS,
  storageKey = FORM_SETTINGS_STORAGE_KEY,
) => readPurchaseOrderFormSettings(
  headerUdfs,
  rowUdfs,
  matrixColumns,
  storageKey || FORM_SETTINGS_STORAGE_KEY,
);
