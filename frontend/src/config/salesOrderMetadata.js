/**
 * SAP Business One Sales Order - Field Metadata
 * Defines all fields, tabs, and configurations for the Sales Order screen
 */

// ─── DECIMAL PRECISION ────────────────────────────────────────────────────────
export const DECIMAL_CONFIG = {
  quantity: 2,
  unitPrice: 2,
  discount: 2,
  total: 2,
  tax: 2,
  documentTotal: 2,
};

// ─── HEADER FIELDS ────────────────────────────────────────────────────────────
export const HEADER_FIELDS = {
  // Customer Section
  customerCode: { label: 'Buyer Code', required: true, type: 'select', section: 'customer' },
  customerName: { label: 'Buyer Name', required: true, type: 'text', section: 'customer' },
  contactPerson: { label: 'Contact Person', required: false, type: 'select', section: 'customer' },
  customerRefNo: { label: 'Customer Ref. No.', required: false, type: 'text', section: 'customer' },
  
  // Document Section
  docNum: { label: 'No.', required: false, type: 'text', readOnly: true, section: 'document' },
  status: { label: 'Status', required: false, type: 'text', readOnly: true, section: 'document' },
  postingDate: { label: 'Posting Date', required: true, type: 'date', section: 'document' },
  deliveryDate: { label: 'Delivery Date', required: false, type: 'date', section: 'document' },
  documentDate: { label: 'Document Date', required: true, type: 'date', section: 'document' },
  
  // Additional Fields
  salesEmployee: { label: 'Sales Employee', required: false, type: 'select', section: 'document' },
  owner: { label: 'Owner', required: false, type: 'text', section: 'document' },
  
  // Right Panel Fields
  serviceCharge: { label: 'ServiceCharge', required: false, type: 'text', section: 'rightPanel' },
  transporter: { label: 'Transporter', required: false, type: 'text', section: 'rightPanel' },
  lrNo: { label: 'LR No', required: false, type: 'text', section: 'rightPanel' },
  lrDate: { label: 'LR Date', required: false, type: 'date', section: 'rightPanel' },
  destinationAddress: { label: 'Destination Address', required: false, type: 'text', section: 'rightPanel' },
  finalDestination: { label: 'Final Destination', required: false, type: 'text', section: 'rightPanel' },
  finalDestAdd: { label: 'Final Dest Add', required: false, type: 'text', section: 'rightPanel' },
  vehicleNo: { label: 'Vehicle No', required: false, type: 'text', section: 'rightPanel' },
  dispatchThrough: { label: 'Dispatch Through', required: false, type: 'text', section: 'rightPanel' },
  quantity: { label: 'Quantity', required: false, type: 'number', section: 'rightPanel' },
  resolution: { label: 'Resolution', required: false, type: 'text', section: 'rightPanel' },
  quantityStatus: { label: 'Quantity Status', required: false, type: 'text', section: 'rightPanel' },
  uom: { label: 'UOM', required: false, type: 'text', section: 'rightPanel' },
  price: { label: 'Price', required: false, type: 'number', section: 'rightPanel' },
  priceDiscount: { label: 'Price Discount', required: false, type: 'number', section: 'rightPanel' },
  bFromDate: { label: 'B_FromDate', required: false, type: 'date', section: 'rightPanel' },
  bToDate: { label: 'B_ToDate', required: false, type: 'date', section: 'rightPanel' },
  sellerCode: { label: 'Seller Code', required: false, type: 'text', section: 'rightPanel' },
  sellerName: { label: 'Seller Name', required: false, type: 'text', section: 'rightPanel' },
  
  // Address Fields
  sellerAddressId: { label: 'Seller Address Id (Ship-From)', required: false, type: 'text', section: 'address' },
  sellerAddress: { label: 'Seller Address', required: false, type: 'textarea', section: 'address' },
  
  // Invoice Fields
  invoiceNo: { label: 'Invoice No', required: false, type: 'text', section: 'invoice' },
  invoiceDate: { label: 'Invoice Date', required: false, type: 'date', section: 'invoice' },
  oldSolaReadhNo: { label: 'Old Sola Readh No', required: false, type: 'text', section: 'invoice' },
  oldSolaReadhDate: { label: 'Old Sola Readh Date', required: false, type: 'date', section: 'invoice' },
  sellerContactPerson: { label: 'Seller Contact Person', required: false, type: 'text', section: 'invoice' },
  buyerCodeId: { label: 'Buyer\'s Code(2)', required: false, type: 'text', section: 'invoice' },
  buyerNameId: { label: 'Buyer\'s Name(2)', required: false, type: 'text', section: 'invoice' },
  buyerAddressId: { label: 'Buyer\'s Address Id', required: false, type: 'text', section: 'invoice' },
  buyerAddressId2: { label: 'Buyer\'s Address(2)', required: false, type: 'textarea', section: 'invoice' },
  
  // Additional UDF Fields
  uBillNo: { label: 'U-BillNo', required: false, type: 'text', section: 'udf' },
  vcUJNo: { label: 'VC_UJNo', required: false, type: 'text', section: 'udf' },
  eBillNo: { label: 'E-BillNo', required: false, type: 'text', section: 'udf' },
  jrn: { label: 'JRN', required: false, type: 'text', section: 'udf' },
};

// ─── CONTENTS TAB - MATRIX COLUMNS ────────────────────────────────────────────
export const MATRIX_COLUMNS = [
  { 
    key: 'itemServiceType', 
    label: 'Item/Service Type', 
    width: 120, 
    type: 'select',
    required: true,
    options: ['Item', 'Service']
  },
  { 
    key: 'itemNo', 
    label: 'Item No.', 
    width: 140, 
    type: 'select',
    required: true,
    searchable: true
  },
  { 
    key: 'itemDescription', 
    label: 'Item Description', 
    width: 200, 
    type: 'text',
    required: false
  },
  { 
    key: 'quantity', 
    label: 'Quantity', 
    width: 90, 
    type: 'number',
    required: true,
    align: 'right',
    decimals: 2
  },
  { 
    key: 'unitPrice', 
    label: 'Unit Price', 
    width: 100, 
    type: 'number',
    required: true,
    align: 'right',
    decimals: 2
  },
  { 
    key: 'discountPercent', 
    label: 'Discount %', 
    width: 90, 
    type: 'number',
    required: false,
    align: 'right',
    decimals: 2
  },
  { 
    key: 'priceAfterDiscount', 
    label: 'Price after Discount', 
    width: 120, 
    type: 'number',
    required: false,
    align: 'right',
    decimals: 2,
    calculated: true
  },
  { 
    key: 'taxCode', 
    label: 'Tax Code', 
    width: 120, 
    type: 'select',
    required: true
  },
  { 
    key: 'totalLC', 
    label: 'Total (LC)', 
    width: 110, 
    type: 'number',
    required: false,
    align: 'right',
    decimals: 2,
    calculated: true,
    readOnly: true
  },
  { 
    key: 'warehouse', 
    label: 'Whse', 
    width: 100, 
    type: 'select',
    required: true
  },
  { 
    key: 'distRule', 
    label: 'Distr. Rule', 
    width: 100, 
    type: 'select',
    required: false
  },
];

// ─── LOGISTICS TAB - MATRIX COLUMNS ───────────────────────────────────────────
export const LOGISTICS_COLUMNS = [
  { key: 'itemServiceType', label: 'Item/Service Type', width: 120, type: 'text', readOnly: true },
  { key: 'itemNo', label: 'Item No.', width: 140, type: 'text', readOnly: true },
  { key: 'freeText', label: 'Free Text', width: 120, type: 'text' },
  { key: 'uomCode', label: 'UoM Code', width: 100, type: 'select' },
  { key: 'cogsOcrCode', label: 'COGS Ocrcode', width: 120, type: 'select' },
  { key: 'distRule', label: 'Distr. Rule', width: 100, type: 'select' },
  { key: 'branch', label: 'Branch', width: 100, type: 'select' },
  { key: 'backflushAgreementNo', label: 'Backflush Agreement No.', width: 150, type: 'text' },
  { key: 'allowBackorderDisc', label: 'Allow Backorder Disc', width: 140, type: 'checkbox' },
  { key: 'hsn', label: 'HSN', width: 100, type: 'text' },
  { key: 'sac', label: 'SAC', width: 100, type: 'text' },
];

// ─── ACCOUNTING TAB - MATRIX COLUMNS ──────────────────────────────────────────
export const ACCOUNTING_COLUMNS = [
  { key: 'itemServiceType', label: 'Item/Service Type', width: 120, type: 'text', readOnly: true },
  { key: 'itemNo', label: 'Item No.', width: 140, type: 'text', readOnly: true },
  { key: 'glAccount', label: 'G/L Account', width: 140, type: 'select' },
  { key: 'taxCode', label: 'Tax Code', width: 120, type: 'select' },
  { key: 'taxOnly', label: 'Tax Only', width: 80, type: 'checkbox' },
  { key: 'wTLiable', label: 'W/T Liable', width: 90, type: 'checkbox' },
  { key: 'deferredTax', label: 'Deferred Tax', width: 100, type: 'checkbox' },
  { key: 'cogsOcrCode', label: 'COGS Ocrcode', width: 120, type: 'select' },
  { key: 'cogsAccountCode', label: 'COGS Account Code', width: 140, type: 'select' },
];

// ─── TAX TAB - MATRIX COLUMNS ─────────────────────────────────────────────────
export const TAX_COLUMNS = [
  { key: 'itemServiceType', label: 'Item/Service Type', width: 120, type: 'text', readOnly: true },
  { key: 'itemNo', label: 'Item No.', width: 140, type: 'text', readOnly: true },
  { key: 'taxCode', label: 'Tax Code', width: 120, type: 'select' },
  { key: 'taxRate', label: 'Tax Rate', width: 90, type: 'number', align: 'right', readOnly: true },
  { key: 'taxableAmount', label: 'Taxable Amount', width: 120, type: 'number', align: 'right', readOnly: true },
  { key: 'taxAmount', label: 'Tax Amount', width: 110, type: 'number', align: 'right', readOnly: true },
  { key: 'totalAmount', label: 'Total Amount', width: 120, type: 'number', align: 'right', readOnly: true },
];

// ─── ATTACHMENTS TAB ──────────────────────────────────────────────────────────
export const ATTACHMENT_FIELDS = [
  { key: 'targetPath', label: 'Target Path', width: 200, type: 'text' },
  { key: 'fileName', label: 'File Name', width: 180, type: 'text' },
  { key: 'attachmentDate', label: 'Attachment Date', width: 120, type: 'date' },
  { key: 'freeText', label: 'Free Text', width: 150, type: 'text' },
  { key: 'copyToTarget', label: 'Copy to Target Document', width: 150, type: 'checkbox' },
];

// ─── TAB DEFINITIONS ──────────────────────────────────────────────────────────
export const TABS = [
  { key: 'contents', label: 'Contents', icon: null },
  { key: 'logistics', label: 'Logistics', icon: null },
  { key: 'accounting', label: 'Accounting', icon: null },
  { key: 'tax', label: 'Tax', icon: null },
  { key: 'attachments', label: 'Attachments', icon: null },
];

// ─── TOTALS SECTION ───────────────────────────────────────────────────────────
export const TOTALS_FIELDS = {
  totalBeforeDiscount: { label: 'Total Before Discount', readOnly: true, decimals: 2 },
  discount: { label: 'Discount', editable: true, decimals: 2, type: 'percent' },
  freight: { label: 'Freight', editable: true, decimals: 2 },
  rounding: { label: 'Rounding', editable: true, type: 'checkbox' },
  tax: { label: 'Tax', readOnly: true, decimals: 2 },
  total: { label: 'Total', readOnly: true, decimals: 2, highlight: true },
};

// ─── VALIDATION RULES ─────────────────────────────────────────────────────────
export const VALIDATION_RULES = {
  header: {
    customerCode: { required: true, message: 'Customer is required' },
    postingDate: { required: true, message: 'Posting date is required' },
    documentDate: { required: true, message: 'Document date is required' },
    placeOfSupply: { required: false },
  },
  lines: {
    itemNo: { required: true, message: 'Item is required' },
    quantity: { required: true, min: 0.01, message: 'Quantity must be greater than 0' },
    unitPrice: { required: true, min: 0, message: 'Unit price is required' },
    taxCode: { required: true, message: 'Tax code is required' },
    warehouse: { required: true, message: 'Warehouse is required' },
  },
  document: {
    minLines: 1,
    message: 'At least one item line is required',
  },
  tax: {
    // SGST + CGST validation: If one is used, both must be used with same rate
    sgstCgstPair: true,
    message: 'SGST and CGST must be used together with equal rates',
  },
};

// ─── DEFAULT VALUES ───────────────────────────────────────────────────────────
export const DEFAULT_HEADER = {
  customerCode: '',
  customerName: '',
  contactPerson: '',
  customerRefNo: '',
  currency: 'INR',
  placeOfSupply: '',
  branch: '',
  docNum: '',
  status: 'Open',
  postingDate: new Date().toISOString().split('T')[0],
  deliveryDate: '',
  documentDate: new Date().toISOString().split('T')[0],
  branchRegNo: '',
  salesEmployee: '',
  owner: '',
  // Right panel
  serviceCharge: '',
  transporter: '',
  lrNo: '',
  lrDate: '',
  destinationAddress: '',
  finalDestination: '',
  finalDestAdd: '',
  vehicleNo: '',
  dispatchThrough: '',
  quantity: '',
  resolution: '',
  quantityStatus: '',
  uom: '',
  price: '',
  priceDiscount: '',
  bFromDate: '',
  bToDate: '',
  sellerCode: '',
  sellerName: '',
  sellerAddressId: '',
  sellerAddress: '',
  invoiceNo: '',
  invoiceDate: '',
  oldSolaReadhNo: '',
  oldSolaReadhDate: '',
  sellerContactPerson: '',
  buyerCodeId: '',
  buyerNameId: '',
  buyerAddressId: '',
  buyerAddressId2: '',
  uBillNo: '',
  vcUJNo: '',
  eBillNo: '',
  jrn: '',
  // Totals
  discount: '0',
  freight: '0',
  rounding: false,
  remarks: '',
};

export const DEFAULT_LINE = {
  itemServiceType: 'Item',
  itemNo: '',
  itemDescription: '',
  quantity: '',
  unitPrice: '',
  discountPercent: '0',
  priceAfterDiscount: '',
  taxCode: '',
  totalLC: '',
  warehouse: '',
  distRule: '',
  // Logistics
  freeText: '',
  uomCode: '',
  cogsOcrCode: '',
  branch: '',
  backflushAgreementNo: '',
  allowBackorderDisc: false,
  hsn: '',
  sac: '',
  // Accounting
  glAccount: '',
  taxOnly: false,
  wTLiable: false,
  deferredTax: false,
  cogsAccountCode: '',
};

// ─── SUMMARY TYPE OPTIONS ─────────────────────────────────────────────────────
export const SUMMARY_TYPE_OPTIONS = [
  { value: 'by_items', label: 'By Items' },
  { value: 'by_documents', label: 'By Documents' },
];

// ─── NO SUMMARY OPTIONS ───────────────────────────────────────────────────────
export const NO_SUMMARY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'summary_1', label: 'Summary 1' },
  { value: 'summary_2', label: 'Summary 2' },
];
