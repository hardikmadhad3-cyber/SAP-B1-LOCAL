import { DELIVERY_WORKBOOK_COLUMNS } from './workbookMatrixColumns';
import { mergeSavedFormSettings } from '../utils/formSettingsPreferences';

const FORM_SETTINGS_STORAGE_KEY = 'sapb1.delivery.formSettings.v3';

const normalizeUdfKey = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  return normalized.startsWith('U_') ? normalized : `U_${normalized}`;
};

const normalizeUdfLabel = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const compactUdfKey = (value) => normalizeUdfKey(value).replace(/[^A-Z0-9]+/g, '');

const HIDDEN_DELIVERY_ROW_UDF_KEYS = new Set([
  'U_SPLRBT',
  'U_COMPRC',
  'U_S_BROKPERQTY',
  'U_UNIT_PRICE',
  'U_BROK_SELLER',
  'U_BROK_BUYER',
  'U_BUYER_DELIVERY',
  'U_SELLER_DELIVERY',
  'U_BUYER_PAYMENT_TERMS',
  'U_SELLER_PAYMENT_TERMS',
  'U_BUYER_QUALITY',
  'U_SELLER_QUALITY',
  'U_BUYER_PRICE',
  'U_SELLER_PRICE',
  'U_BUYER_SPINS',
  'U_SELLER_SPINS',
  'U_SEL_BROK_AP',
  'U_SELLER_BROK_PER',
  'U_BUYER_BILL_DISC',
  'U_SELLER_BILL_DISC',
  'U_SELLTCODE',
  'U_S_ITEM',
  'U_S_QTY',
  'U_FREIGHT_PUR',
  'U_FREIGHT_SALES',
  'U_FR_TRANS',
  'U_FR_TRANS_NAME',
  'U_BDNUM',
]);

const HIDDEN_DELIVERY_ROW_UDF_LABELS = new Set([
  'Sauda Node Ref',
  'Sauda Nodh Ref',
  'Sauda Nodh No',
  'AP Inv DocKey',
  'AP Inv DocNum',
  'AP Inv LineNum',
  'Assessable Value',
  'BED Rate',
  'BED Amount',
  'RG23DNo',
  'Special Rebate',
  'Commision',
  'Commission',
  'BrokPerQty',
  'Unit Price',
  'Seller Brokerage',
  'Buyer Brokerage',
  'Buyer - Delivery',
  'Seller - Delivery',
  'Buyer - Terms of payment',
  'Seller - Terms of Payment',
  'Buyer - Quality',
  'Seller - Quality',
  'Buyer - Price',
  'Seller - Price',
  'Buyer - Special Instruction',
  'Seller - Special Instruction',
  'Seller Brokerage(Amt./Per)',
  'Seller Brokerage in Percentage',
  'Buyer Bill Discount',
  'Seller Bill Discount',
  'STCODE',
  'S_Item',
  'S_Qty',
  'Freight Purchase',
  'Freight Sales',
  'Freight Provider',
  'Freight Provider Name',
  'Document Created',
  'Brokerage Number',
].map(normalizeUdfLabel));

const HIDDEN_DELIVERY_ROW_UDF_KEY_FRAGMENTS = [
  'SAUDANODEREF',
  'SAUDANODHREF',
  'SAUDANODHNO',
  'APINVDOCKEY',
  'APINVDOCNUM',
  'APINVLINENUM',
  'ASSESSABLEVALUE',
  'BEDRATE',
  'BEDAMOUNT',
  'RG23DNO',
  'DOCUMENTCREATED',
];

const isHiddenDeliveryRowUdf = (field = {}) => {
  const key = normalizeUdfKey(field.key || field.sapField);
  const aliasKey = normalizeUdfKey(field.aliasId);
  const compactKeyValue = compactUdfKey(field.key || field.sapField || field.aliasId);
  const label = normalizeUdfLabel(field.label || field.description || field.Descr || field.key);

  return (
    HIDDEN_DELIVERY_ROW_UDF_KEYS.has(key) ||
    HIDDEN_DELIVERY_ROW_UDF_KEYS.has(aliasKey) ||
    HIDDEN_DELIVERY_ROW_UDF_LABELS.has(label) ||
    HIDDEN_DELIVERY_ROW_UDF_KEY_FRAGMENTS.some((fragment) => compactKeyValue.includes(fragment))
  );
};

const filterDeliveryRowUdfDefinitions = (definitions = []) =>
  (definitions || []).filter((field) => !isHiddenDeliveryRowUdf(field));

const HEADER_UDF_DEFINITIONS = [
  { key: 'U_SCharge', label: 'SaudaCharge', type: 'text', defaultValue: '' },
  { key: 'U_TRNS', label: 'Transporter', type: 'text', defaultValue: '' },
  { key: 'U_LRNO', label: 'LR No', type: 'text', defaultValue: '' },
  { key: 'U_LRDT', label: 'LR Date', type: 'date', defaultValue: '' },
  { key: 'U_DSTN', label: 'Destination', type: 'text', defaultValue: '' },
  { key: 'U_DSTNADD', label: 'Destination Address', type: 'text', defaultValue: '' },
  { key: 'U_FDSTN', label: 'Final Destination', type: 'text', defaultValue: '' },
  { key: 'U_VEHNO', label: 'Vehicle No', type: 'text', defaultValue: '' },
  { key: 'U_DOCTHR', label: 'Dispatch Through', type: 'text', defaultValue: '' },
  { key: 'U_UOM', label: 'UOM', type: 'text', defaultValue: '' },
  { key: 'U_Price', label: 'Price', type: 'text', defaultValue: '' },
  { key: 'U_SAmount', label: 'Sauda Amount', type: 'text', defaultValue: '' },
  { key: 'U_B_FromDate', label: 'B_FromDate', type: 'date', defaultValue: '' },
  { key: 'U_B_ToDate', label: 'B_ToDate', type: 'date', defaultValue: '' },
  { key: 'U_Seller_Code', label: 'Seller Code', type: 'text', defaultValue: '' },
  { key: 'U_Seller_Name', label: 'Seller Name', type: 'text', defaultValue: '' },
  { key: 'U_Seller_AddressId', label: 'Seller Address Id (Ship From)', type: 'text', defaultValue: '' },
  { key: 'U_Seller_Address', label: 'Seller Address', type: 'textarea', defaultValue: '' },
  { key: 'U_Old_Soda_Nodh_No', label: 'Old Soda Nodh No.', type: 'text', defaultValue: '' },
  { key: 'U_Old_Soda_Nodh_Date', label: 'Old Soda Nodh Date', type: 'date', defaultValue: '' },
  {
    key: 'U_Canceled',
    label: 'Canceled IRN',
    type: 'select',
    required: true,
    defaultValue: 'N',
    options: [
      { value: '', label: '' },
      { value: 'Y', label: 'Yes' },
      { value: 'N', label: 'No' },
    ],
  },
  { key: 'U_TrfId', label: 'Transporter ID', type: 'text', defaultValue: '' },
  { key: 'U_TrfName', label: 'Transporter Name', type: 'text', defaultValue: '' },
  { key: 'U_TrfVehi', label: 'Vehicle No', type: 'text', defaultValue: '' },
  { key: 'U_TrfDist', label: 'Distance', type: 'text', defaultValue: '' },
  {
    key: 'U_TrfMode',
    label: 'Transporter Mode',
    type: 'select',
    required: true,
    defaultValue: '1',
    options: [
      { value: '', label: '' },
      { value: '1', label: 'Road' },
      { value: '2', label: 'Rail' },
      { value: '3', label: 'Air' },
      { value: '4', label: 'Ship' },
    ],
  },
  {
    key: 'U_TrfVType',
    label: 'Transporter Vehicle Type',
    type: 'select',
    required: true,
    defaultValue: 'R',
    options: [
      { value: '', label: '' },
      { value: 'R', label: 'Regular' },
      { value: 'O', label: 'ODC' },
    ],
  },
  { key: 'U_AckNo', label: 'Acknowledgement No', type: 'text', defaultValue: '' },
  { key: 'U_AckDt', label: 'Acknowledgement Dt', type: 'text', defaultValue: '' },
  { key: 'U_CanDt', label: 'Cancel Dt', type: 'text', defaultValue: '' },
  { key: 'U_QrCode', label: 'Signed QRCode', type: 'textarea', defaultValue: '' },
  { key: 'U_SigInv', label: 'Signed Invoice', type: 'textarea', defaultValue: '' },
  { key: 'U_EwbDt', label: 'E-Way Date.', type: 'text', defaultValue: '' },
  { key: 'U_EwbVliDt', label: 'E-Way ValidTill Date.', type: 'text', defaultValue: '' },
  {
    key: 'U_EWayBCan',
    label: 'Canceled EWayBill',
    type: 'select',
    required: true,
    defaultValue: 'No',
    options: [
      { value: '', label: '' },
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  { key: 'U_TrfCode', label: 'Transporter Code', type: 'text', defaultValue: '' },
  {
    key: 'U_MultiVeh',
    label: 'Multiple Vehicle',
    type: 'select',
    required: true,
    defaultValue: 'No',
    options: [
      { value: '', label: '' },
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  {
    key: 'U_MultiVehPosted',
    label: 'Posted Multiple Vehicle',
    type: 'select',
    required: true,
    defaultValue: 'No',
    options: [
      { value: '', label: '' },
      { value: 'Yes', label: 'Yes' },
      { value: 'No', label: 'No' },
    ],
  },
  {
    key: 'U_SubSuply',
    label: 'Sub Supply Type',
    type: 'select',
    required: true,
    defaultValue: '1',
    options: [
      { value: '', label: '' },
      { value: '1', label: 'Supply' },
      { value: '2', label: 'Import' },
      { value: '3', label: 'Export' },
      { value: '4', label: 'Job Work' },
      { value: '5', label: 'For Own Use' },
      { value: '6', label: 'Job Work Returns' },
      { value: '7', label: 'Sales Return' },
      { value: '8', label: 'Others' },
      { value: '9', label: 'SKD/CKD/Lots' },
      { value: '10', label: 'Line Sales' },
      { value: '11', label: 'Recipient Not Known' },
      { value: '12', label: 'Exhibition Or Fairs' },
    ],
  },
  {
    key: 'U_DocType',
    label: 'Document Type',
    type: 'select',
    required: true,
    defaultValue: 'INV',
    options: [
      { value: '', label: '' },
      { value: 'INV', label: 'Tax Invoice' },
      { value: 'BIL', label: 'Bill Of Supply' },
      { value: 'BOE', label: 'Bill Of Entry' },
      { value: 'CHL', label: 'Delivery Challan' },
      { value: 'OTH', label: 'Others' },
    ],
  },
  {
    key: 'U_TraType',
    label: 'Transaction Type',
    type: 'select',
    required: true,
    defaultValue: '1',
    options: [
      { value: '', label: '' },
      { value: '1', label: 'Regular' },
      { value: '2', label: 'Bill To-Ship To' },
      { value: '3', label: 'Bill From-Ship From' },
      { value: '4', label: 'Combination Of 2 and 3' },
    ],
  },
  { key: 'U_DelRemarks', label: 'Del Remarks', type: 'textarea', defaultValue: '' },
];

const ROW_UDF_DEFINITIONS = [
  { key: 'U_Loc', label: 'Loc', type: 'text', defaultValue: '' },
  { key: 'U_Branch', label: 'Branch', type: 'text', defaultValue: '' },
  { key: 'U_PackingStatus', label: 'Packing Status', type: 'select', defaultValue: 'Pending', options: ['Pending', 'Packed', 'Shipped'] },
];

const BASE_MATRIX_COLUMNS = DELIVERY_WORKBOOK_COLUMNS;

const getOptionValue = (option) => (typeof option === 'string' ? option : option?.value ?? '');

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

const createUdfState = (definitions) =>
  definitions.reduce((acc, field) => {
    acc[field.key] = getDefaultUdfValue(field);
    return acc;
  }, {});

const normalizeUdfLookupKey = (value) =>
  String(value || '').trim().toUpperCase().replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');

const getUdfValueByKey = (values = {}, key = '') => {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];

  const token = normalizeUdfLookupKey(key);
  if (!token) return undefined;

  const match = Object.entries(values || {}).find(([valueKey]) => normalizeUdfLookupKey(valueKey) === token);
  return match ? match[1] : undefined;
};

const normalizeUdfState = (definitions, values = {}, options = {}) => {
  const preserveExtra = options.preserveExtra !== false;
  const normalized = definitions.reduce((acc, field) => {
    const currentValue = getUdfValueByKey(values, field.key);
    const shouldApplyDefault =
      currentValue === undefined ||
      currentValue === null ||
      (field.required && String(currentValue) === '');

    acc[field.key] = shouldApplyDefault ? getDefaultUdfValue(field) : currentValue;
    return acc;
  }, {});

  if (preserveExtra) {
    Object.entries(values || {}).forEach(([key, value]) => {
      if (String(key || '').startsWith('U_') && !Object.prototype.hasOwnProperty.call(normalized, key)) {
        normalized[key] = value == null ? '' : value;
      }
    });
  }

  return normalized;
};

const buildVisibilitySettings = (definitions) =>
  definitions.reduce((acc, field) => {
    acc[field.key] = {
      visible: field.visible !== undefined ? field.visible : true,
      active: field.active !== undefined ? field.active : true,
      sapControlled: Boolean(field.sapControlled),
      order: field.order,
      minWidth: field.minWidth,
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
  if (typeof headerUdfs === 'string') {
    storageKey = headerUdfs;
    headerUdfs = HEADER_UDF_DEFINITIONS;
    rowUdfs = ROW_UDF_DEFINITIONS;
    matrixColumns = BASE_MATRIX_COLUMNS;
  }
  const defaults = createDefaultFormSettings(headerUdfs, rowUdfs, matrixColumns);

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    return mergeSavedFormSettings(defaults, JSON.parse(raw), {
      editableSapControlledGroups: ['matrixColumns', 'rowUdfs', 'headerUdfs'],
    });
  } catch (error) {
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
  filterDeliveryRowUdfDefinitions,
  normalizeUdfState,
  readSavedFormSettings,
};
