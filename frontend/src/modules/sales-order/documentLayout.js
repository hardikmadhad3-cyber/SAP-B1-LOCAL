export const SALES_ORDER_LAYOUT_DOCUMENT_TYPE = 'SALES_ORDER';
export const SALES_QUOTATION_LAYOUT_DOCUMENT_TYPE = 'SALES_QUOTATION';
export const DELIVERY_LAYOUT_DOCUMENT_TYPE = 'DELIVERY';
export const AR_INVOICE_LAYOUT_DOCUMENT_TYPE = 'AR_INVOICE';
export const AR_CREDIT_MEMO_LAYOUT_DOCUMENT_TYPE = 'AR_CREDIT_MEMO';
export const SALES_ORDER_LINE_NUMBER_KEY = '__lineNumber';

// This is the only non-live matrix used by the standard Sales-A/R pages.  It
// deliberately contains SAP fields only: no company UDF, workbook, or
// customer-specific column is allowed into the unavailable-metadata path.
export const SAP_STANDARD_SALES_MATRIX_COLUMNS = Object.freeze([
  Object.freeze({ key: SALES_ORDER_LINE_NUMBER_KEY, valueKey: SALES_ORDER_LINE_NUMBER_KEY, rendererKey: SALES_ORDER_LINE_NUMBER_KEY, fieldName: 'LineNum', sapField: 'LineNum', label: '#', type: 'number', minWidth: 42, width: 42, order: -10000, columnOrder: -10000, visible: true, readOnly: true, active: false, sapControlled: false, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'itemNo', fieldName: 'ItemCode', sapField: 'ItemCode', label: 'Item No.', type: 'text', minWidth: 150, visible: true, order: 20, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'itemDescription', fieldName: 'Dscription', sapField: 'Dscription', label: 'Item Description', type: 'text', minWidth: 220, visible: true, order: 30, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'quantity', fieldName: 'Quantity', sapField: 'Quantity', label: 'Quantity', type: 'number', numeric: true, minWidth: 100, visible: true, order: 40, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'uomCode', fieldName: 'UomCode', sapField: 'UoMCode', label: 'UoM Code', type: 'text', minWidth: 105, visible: true, order: 50, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'unitPrice', fieldName: 'Price', sapField: 'UnitPrice', label: 'Unit Price', type: 'number', numeric: true, minWidth: 110, visible: true, order: 60, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'stdDiscount', fieldName: 'DiscPrcnt', sapField: 'DiscountPercent', label: 'Discount %', type: 'number', numeric: true, minWidth: 95, visible: true, order: 70, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'taxCode', fieldName: 'VatGroup', sapField: 'TaxCode', label: 'Tax Code', type: 'text', minWidth: 115, visible: true, order: 80, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'whse', fieldName: 'WhsCode', sapField: 'WarehouseCode', label: 'Warehouse', type: 'text', minWidth: 120, visible: true, order: 90, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'distRule', fieldName: 'OcrCode', sapField: 'CostingCode', label: 'Distribution Rule', type: 'text', minWidth: 145, visible: true, order: 100, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'lineDeliveryDate', fieldName: 'ShipDate', sapField: 'ShipDate', label: 'Delivery Date', type: 'date', minWidth: 125, visible: true, order: 110, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'totalLC', fieldName: 'LineTotal', sapField: 'LineTotal', label: 'Total (LC)', type: 'number', numeric: true, minWidth: 115, visible: true, readOnly: true, active: false, order: 120, source: 'sap-standard-fallback' }),
  Object.freeze({ key: 'grossTotal', fieldName: 'TotalFrgn', sapField: 'TotalFrgn', label: 'Total (Doc)', type: 'number', numeric: true, minWidth: 120, visible: true, readOnly: true, active: false, order: 130, source: 'sap-standard-fallback' }),
]);

export const getSapStandardSalesMatrixColumns = () => (
  SAP_STANDARD_SALES_MATRIX_COLUMNS.map((column) => ({ ...column }))
);

export const makeSalesOrderHsnColumnEditable = (columns = []) => (
  (Array.isArray(columns) ? columns : []).map((column) => (
    String(column?.key || column?.valueKey || '').trim() === 'hsnCode'
      ? { ...column, active: true, readOnly: false, editable: true }
      : column
  ))
);

const normalizeToken = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

const normalizeUdfKey = (value) => {
  let normalized = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '');
  if (!normalized) return '';
  if (!normalized.startsWith('U_')) {
    normalized = `U_${normalized.replace(/^_+/, '')}`;
  }
  return normalized;
};

const mapLayoutDataTypeToInputType = (dataType = '') => {
  const normalized = String(dataType || '').trim().toLowerCase();
  if (['number', 'numeric', 'decimal', 'float', 'int', 'integer'].includes(normalized)) return 'number';
  if (['date', 'datetime'].includes(normalized)) return 'date';
  if (['textarea', 'memo'].includes(normalized)) return 'textarea';
  if (['checkbox', 'boolean', 'bit', 'yesno', 'yes_no'].includes(normalized)) return 'checkbox';
  return 'text';
};

const SAP_FIELD_TO_INTERNAL_KEY = {
  LINENUM: SALES_ORDER_LINE_NUMBER_KEY,
  ITEMCODE: 'itemNo',
  LINEVENDOR: 'vendor',
  DSCRIPTION: 'itemDescription',
  DESCRIPTION: 'itemDescription',
  QUANTITY: 'quantity',
  REQQTY: 'requiredQty',
  REQDATE: 'requiredDate',
  SHIPDATE: 'lineDeliveryDate',
  DELDATE: 'lineDeliveryDate',
  DELIVERYDATE: 'lineDeliveryDate',
  UOMNAME: 'uomName',
  UNITMSR: 'uomName',
  UNITOFMEASURENAME: 'uomName',
  UOMCODE: 'uomCode',
  ONHAND: 'inStock',
  ONHANDQTY: 'inStock',
  INSTOCK: 'inStock',
  QUANTITYONSTOCK: 'inStock',
  WHSQTY: 'qtyInWhse',
  QTYINWHSE: 'qtyInWhse',
  QTYINWAREHOUSE: 'qtyInWhse',
  WAREHOUSEQUANTITY: 'qtyInWhse',
  HSN: 'hsnCode',
  HSNCODE: 'hsnCode',
  HSNENTRY: 'hsnCode',
  PRICE: 'unitPrice',
  PRICEBEFDI: 'unitPrice',
  UNITPRICE: 'unitPrice',
  INFOPRICE: 'unitPrice',
  U_PRICE: 'price',
  U_TAXCODE: 'taxCodeRepeat',
  U_UNITPRICE: 'unitPriceUdf',
  U_UNIT_PRICE: 'unitPriceUdf',
  RATE: 'forRate',
  FORRATE: 'forRate',
  FORPRICE: 'forRate',
  FOR_PRICE: 'forRate',
  VATGROUP: 'taxCode',
  TAXCODE: 'taxCode',
  SHIPTYPE: 'lineShippingType',
  SHIPMETHOD: 'lineShippingType',
  SHIPPINGMETHOD: 'lineShippingType',
  SHIPPINGTYPE: 'lineShippingType',
  TRNSCODE: 'lineShippingType',
  TRANSPORTATIONCODE: 'lineShippingType',
  WTLIABLE: 'wTaxLiable',
  TAXONLY: 'taxLiable',
  LINETOTAL: 'totalLC',
  GTOTAL: 'grossTotal',
  TOTALFRGN: 'grossTotal',
  GROSSTOTAL: 'grossTotal',
  TOTAL: 'totalLC',
  PACKQTY: 'noOfPackages',
  NUMOFPACKS: 'noOfPackages',
  VATSUM: 'taxAmount',
  TAXAMOUNT: 'taxAmount',
  TAXAMOUNTLC: 'taxAmount',
  'TAXAMOUNT(LC)': 'taxAmount',
  'TAX AMOUNT(LC)': 'taxAmount',
  'TAX AMOUNT LC': 'taxAmount',
  TAXAMOUNT_LC: 'taxAmount',
  TAXAMOUNTLC_: 'taxAmount',
  TAXAMOUNT_LC_: 'taxAmount',
  TAXAMOUNTLC__:'taxAmount',
  BINALLOC: 'binLocationAllocation',
  BINALLOCATION: 'binLocationAllocation',
  BINLOCATIONALLOCATION: 'binLocationAllocation',
  COMMPERCENT: 'commPercent',
  COMMPRCNT: 'commPercent',
  COMMISSIONPERCENT: 'commPercent',
  ASSESSABLEVALUE: 'assessableValue',
  ASSESSABLEVALUEINR: 'assessableValue',
  PRICEAFTERDISCOUNT: 'priceAfterDiscount',
  PRICEAFTERDISC: 'priceAfterDiscount',
  ITEMCOST: 'itemCost',
  ACCTCODE: 'glAccount',
  ACCTNAME: 'glAccountName',
  ACCOUNTNAME: 'glAccountName',
  DISCPRCNT: 'stdDiscount',
  DISCOUNTPERCENT: 'stdDiscount',
  WAREHOUSECODE: 'whse',
  DELIVRDQTY: 'deliveredQty',
  WHSCODE: 'whse',
  OCRCODE: 'distRule',
  COSTINGCODE: 'distRule',
  OCRCODE2: 'distRule2',
  COSTINGCODE2: 'distRule2',
  OCRCODE3: 'distRule3',
  COSTINGCODE3: 'distRule3',
  OCRCODE4: 'distRule4',
  COSTINGCODE4: 'distRule4',
  OCRCODE5: 'distRule5',
  COSTINGCODE5: 'distRule5',
  COGSOCRCOD: 'cogsDistRule',
  COGSCOSTINGCODE: 'cogsDistRule',
  COGSDISTRIBUTIONRULE: 'cogsDistRule',
  WEIGHT1: 'weight',
  WEIGHT: 'weight',
  OPENQTY: 'openQty',
  OPENCREQTY: 'openQty',
  QTYTOSHIP: 'openQty',
  COUNTRYORG: 'countryOfOrigin',
  FREETXT: 'freeText',
  FREETEXT: 'freeText',
  SACCODE: 'sacCode',
  SACENTRY: 'sacCode',
  WITHOUTQTYPOSTING: 'withoutQtyPosting',
  WITHOUTINVENTORYMOVEMENT: 'withoutQtyPosting',
  ENSETCOST: 'enableSettingCost',
  RETCOST: 'returnCost',
  AGRNO: 'blanketAgreementNo',
  AGRLINENUM: 'blanketAgreementNo',
  INVQTY: 'qtyInventoryUom',
  NUMPERMSR: 'itemsPerUnit',
  UOMENTRY: 'uomGroup',
  LOCCODE: 'loc',
  BPLID: 'branch',
  U_SPLRBT: 'specialRebate',
  U_COMPRC: 'commission',
  U_S_BROKPERQTY: 'sellerBrokeragePerQty',
  U_BROK_SELLER: 'sellerBrokerage',
  U_BROK_BUYER: 'buyerBrokerage',
  U_BUYER_DELIVERY: 'buyerDelivery',
  U_SELLER_DELIVERY: 'sellerDelivery',
  U_BUYER_PAYMENT_TERMS: 'buyerPaymentTerms',
  U_SELLER_PAYMENT_TERM: 'sellerPaymentTerms',
  U_SELLER_PAYMENT_TERMS: 'sellerPaymentTerms',
  U_BUYER_QUALITY: 'buyerQuality',
  U_SELLER_QUALITY: 'sellerQuality',
  U_BUYER_PRICE: 'buyerPrice',
  U_SELLER_PRICE: 'sellerPrice',
  U_BUYER_SPINS: 'buyerSpecialInstruction',
  U_SELLER_SPINS: 'sellerSpecialInstruction',
  U_SEL_BROK_AP: 'sellerBrokerageAmtPer',
  U_SELLER_BROK_PER: 'sellerBrokeragePercent',
  U_BUYER_BILL_DISC: 'buyerBillDiscount',
  U_SELLER_BILL_DISC: 'sellerBillDiscount',
  U_SELLTCODE: 'stcode',
  U_STCODE: 'stcode',
  U_S_ITEM: 'sellerItem',
  U_SITEM: 'sellerItem',
  U_S_QTY: 'sellerQty',
  U_FREIGHT_PUR: 'freightPurchase',
  U_FREIGHT_SALES: 'freightSales',
  U_FR_TRANS: 'freightProvider',
  U_FR_TRANS_NAME: 'freightProviderName',
  U_BDNUM: 'brokerageNumber',
  U_DOCKEY: 'documentCreated',
  U_PACKINGTYPE: 'U_PackingType',
  U_PACKING_TYPE: 'U_PackingType',
  U_GROSSWT: 'U_GrossWt',
  U_GROSS_WT: 'U_GrossWt',
  U_TOTALPACKAGE: 'U_TotalPackage',
  U_TOTAL_PACKAGE: 'U_TotalPackage',
  U_CONTAINERTYPE: 'U_ContainerType',
  U_CONTAINER_TYPE: 'U_ContainerType',
  U_FORRATE: 'U_ForRate',
  U_FOR_RATE: 'U_ForRate',
  U_FOR_RATE_: 'U_ForRate',
  U_FORPRICE: 'U_ForRate',
  U_FOR_PRICE: 'U_ForRate',
  U_FIXBROKBUYER: 'U_Fix_Brock_B',
  U_FIX_BROK_BUYER: 'U_Fix_Brock_B',
  U_FIXBROCKSELLER: 'U_Fix_Brock_S',
  U_FIXBROKSELLER: 'U_Fix_Brock_S',
  U_FIX_BROCK_SELLER: 'U_Fix_Brock_S',
  U_FIX_BROK_SELLER: 'U_Fix_Brock_S',
  U_COSTSHEET: 'U_Cost_Sheet',
  U_COST_SHEET: 'U_Cost_Sheet',
};

const LABEL_TO_INTERNAL_KEY = {
  '#': SALES_ORDER_LINE_NUMBER_KEY,
  ITEMNO: 'itemNo',
  VENDOR: 'vendor',
  PREFERREDVENDOR: 'vendor',
  ITEMDESCRIPTION: 'itemDescription',
  DESCRIPTION: 'itemDescription',
  QUANTITY: 'quantity',
  OPENQTY: 'openQty',
  BALQTY: 'openQty',
  UOMNAME: 'uomName',
  UOMCODE: 'uomCode',
  INSTOCK: 'inStock',
  ONHAND: 'inStock',
  QUANTITYONSTOCK: 'inStock',
  QTYINWHSE: 'qtyInWhse',
  QTYINWAREHOUSE: 'qtyInWhse',
  WAREHOUSEQUANTITY: 'qtyInWhse',
  HSN: 'hsnCode',
  SAC: 'sacCode',
  UNITPRICE: 'unitPrice',
  FORPRICE: 'forRate',
  TAXCODE: 'taxCode',
  TOTALDOC: 'grossTotal',
  TOTALDOCUMENT: 'grossTotal',
  GROSSTOTAL: 'grossTotal',
  TOTALLC: 'totalLC',
  TOTAL: 'totalLC',
  GROSSWT: 'U_GrossWt',
  PACKINGTYPE: 'U_PackingType',
  PACKING: 'U_PackingType',
  TOTALPACKAGE: 'U_TotalPackage',
  TOTALPACKAGES: 'U_TotalPackage',
  DISCOUNT: 'stdDiscount',
  DISC: 'stdDiscount',
  PRICE: 'price',
  PRICEAFTERDISCOUNT: 'priceAfterDiscount',
  PRICEAFTERDISC: 'priceAfterDiscount',
  ITEMCOST: 'itemCost',
  QTY: 'quantity',
  REQUIREDQTY: 'requiredQty',
  REQUIREDDATE: 'requiredDate',
  QUOTEDDATE: 'quotedDate',
  DELDATE: 'lineDeliveryDate',
  DELIVERYDATE: 'lineDeliveryDate',
  DELIVEREDQTY: 'deliveredQty',
  QTYTOSHIP: 'deliveredQty',
  ORDEREDQTY: 'orderedQty',
  WHSE: 'whse',
  DISTRRULE: 'distRule',
  DISTRIBUTIONRULE: 'distRule',
  GLACCOUNT: 'glAccount',
  GLACCOUNTNAME: 'glAccountName',
  WTAXLIABLE: 'wTaxLiable',
  TAXLIABLE: 'taxLiable',
  SHIPPINGTYPE: 'lineShippingType',
  SHIPTYPE: 'lineShippingType',
  BINLOCATIONALLOCATION: 'binLocationAllocation',
  WEIGHT: 'weight',
  NOOFPACKAGES: 'noOfPackages',
  ITEMSPERUNIT: 'itemsPerUnit',
  BLANKETAGREEMENTNO: 'blanketAgreementNo',
  WITHOUTQTYPOSTING: 'withoutQtyPosting',
  WITHOUTINVENTORYMOVEMENT: 'withoutQtyPosting',
  ENABLESETTINGCOST: 'enableSettingCost',
  RETURNCOSTLC: 'returnCost',
  QTYINVENTORYUOM: 'qtyInventoryUom',
  CHANGEQTYINVUOMINDEPENDENTLY: 'changeQtyInvUomIndependently',
  UOMGROUP: 'uomGroup',
  COGSDISTRULE: 'cogsDistRule',
  COGSDISTRRULE: 'cogsDistRule',
  COUNTRYREGIONOFORIGIN: 'countryOfOrigin',
  ASSESSABLEVALUE: 'assessableValue',
  ASSESSABLEVALUEINR: 'assessableValue',
  LOC: 'loc',
  COSTSHEET: 'U_Cost_Sheet',
  CONTAINERTYPE: 'U_ContainerType',
  COMMPERCENT: 'commPercent',
  COMM: 'commPercent',
  FORRATE: 'U_ForRate',
  SELLERBROKERAGE: 'sellerBrokerage',
  BUYERBROKERAGE: 'buyerBrokerage',
  BUYERDELIVERY: 'buyerDelivery',
  SELLERDELIVERY: 'sellerDelivery',
  BUYERTERMSOFPAYMENT: 'buyerPaymentTerms',
  SELLERTERMSOFPAYMENT: 'sellerPaymentTerms',
  BUYERQUALITY: 'buyerQuality',
  SELLERQUALITY: 'sellerQuality',
  BUYERPRICE: 'buyerPrice',
  SELLERPRICE: 'sellerPrice',
  SITEM: 'sellerItem',
  SQTY: 'sellerQty',
  BROKPERQTY: 'sellerBrokeragePerQty',
  BUYERSPECIALINSTRUCTION: 'buyerSpecialInstruction',
  SELLERSPECIALINSTRUCTION: 'sellerSpecialInstruction',
  SELLERBROKERAGEAMTPER: 'sellerBrokerageAmtPer',
  SELLERBROKERAGEINPERCENTAGE: 'sellerBrokeragePercent',
  STCODE: 'stcode',
  FIXBROKBUYER: 'U_Fix_Brock_B',
  FIXBROCKSELLER: 'U_Fix_Brock_S',
  FIXBROKSELLER: 'U_Fix_Brock_S',
};

// Map common label variants for Tax Amount to internal `taxAmount` key
LABEL_TO_INTERNAL_KEY.TAXAMOUNT = 'taxAmount';
LABEL_TO_INTERNAL_KEY.TAXAMOUNTLC = 'taxAmount';
LABEL_TO_INTERNAL_KEY.TAXAMOUNTDOC = 'taxAmount';
LABEL_TO_INTERNAL_KEY.TAXAMOUNTDOCUMENT = 'taxAmount';
LABEL_TO_INTERNAL_KEY.TAXAMOUNT_LC = 'taxAmount';
LABEL_TO_INTERNAL_KEY['TAXAMOUNT(LC)'] = 'taxAmount';
LABEL_TO_INTERNAL_KEY['TAX AMOUNT(LC)'] = 'taxAmount';
LABEL_TO_INTERNAL_KEY['TAX AMOUNT LC'] = 'taxAmount';

// Ensure 'TAX CODE' label variants map exactly to `taxCode`
LABEL_TO_INTERNAL_KEY.TAXCODE = 'taxCode';
LABEL_TO_INTERNAL_KEY['TAX CODE'] = 'taxCode';

const STANDARD_RENDERER_KEYS = new Set([
  SALES_ORDER_LINE_NUMBER_KEY,
  'itemNo',
  'vendor',
  'itemDescription',
  'quantity',
  'requiredQty',
  'requiredDate',
  'quotedDate',
  'lineDeliveryDate',
  'uomName',
  'uomCode',
  'inStock',
  'qtyInWhse',
  'hsnCode',
  'unitPrice',
  'unitPriceUdf',
  'forRate',
  'taxCode',
  'taxCodeRepeat',
  'wTaxLiable',
  'taxLiable',
  'lineShippingType',
  'totalLC',
  'grossTotal',
  'price',
  'commPercent',
  'assessableValue',
  'priceAfterDiscount',
  'itemCost',
  'binLocationAllocation',
  'noOfPackages',
  'itemsPerUnit',
  'taxAmount',
  'glAccount',
  'glAccountName',
  'stdDiscount',
  'deliveredQty',
  'whse',
  'distRule',
  'distRule2',
  'distRule3',
  'distRule4',
  'distRule5',
  'cogsDistRule',
  'weight',
  'openQty',
  'orderedQty',
  'countryOfOrigin',
  'freeText',
  'sacCode',
  'enableSettingCost',
  'withoutQtyPosting',
  'returnCost',
  'blanketAgreementNo',
  'qtyInventoryUom',
  'changeQtyInvUomIndependently',
  'uomGroup',
  'loc',
  'branch',
  'specialRebate',
  'commission',
  'sellerBrokeragePerQty',
  'sellerItem',
  'sellerQty',
  'sellerBrokerage',
  'buyerBrokerage',
  'buyerDelivery',
  'sellerDelivery',
  'buyerPaymentTerms',
  'sellerPaymentTerms',
  'buyerQuality',
  'sellerQuality',
  'buyerPrice',
  'sellerPrice',
  'buyerSpecialInstruction',
  'sellerSpecialInstruction',
  'sellerBrokerageAmtPer',
  'sellerBrokeragePercent',
  'stcode',
  'U_Cost_Sheet',
  'U_PackingType',
  'U_ContainerType',
  'U_GrossWt',
  'U_TotalPackage',
  'U_Fix_Brock_B',
  'U_Fix_Brock_S',
]);

const STANDARD_FIELD_OVERRIDES = {
  itemNo: { type: 'text', minWidth: 150 },
  vendor: { type: 'text', minWidth: 120 },
  itemDescription: { type: 'text', minWidth: 220 },
  quantity: { type: 'number', minWidth: 100, numeric: true },
  requiredQty: { type: 'number', minWidth: 110, numeric: true },
  requiredDate: { type: 'date', minWidth: 125 },
  noOfPackages: { type: 'number', minWidth: 120, numeric: true },
  lineDeliveryDate: { type: 'date', minWidth: 125 },
  uomName: { type: 'text', minWidth: 120, readOnly: false, active: true },
  uomCode: { type: 'text', minWidth: 105 },
  inStock: { type: 'number', minWidth: 105, readOnly: true, numeric: true },
  qtyInWhse: { type: 'number', minWidth: 115, readOnly: true, numeric: true },
  hsnCode: { type: 'text', minWidth: 105 },
  sacCode: { type: 'text', minWidth: 105 },
  unitPrice: { type: 'number', minWidth: 110, numeric: true },
  unitPriceUdf: { type: 'number', minWidth: 110, numeric: true },
  forRate: { type: 'number', minWidth: 110, numeric: true },
  taxCode: { type: 'text', minWidth: 115 },
  wTaxLiable: { type: 'checkbox', minWidth: 100 },
  lineShippingType: { type: 'text', minWidth: 125 },
  taxCodeRepeat: { type: 'text', minWidth: 110, readOnly: true },
  taxLiable: { type: 'checkbox', minWidth: 95 },
  totalLC: { type: 'number', minWidth: 115, readOnly: true, numeric: true },
  grossTotal: { type: 'number', minWidth: 120, readOnly: true, numeric: true },
  price: { type: 'number', minWidth: 95, readOnly: true, numeric: true },
  priceAfterDiscount: { type: 'number', minWidth: 130, readOnly: true, numeric: true },
  itemsPerUnit: { type: 'number', minWidth: 120, numeric: true },
  glAccountName: { type: 'text', minWidth: 190, readOnly: true },
  itemCost: { type: 'number', minWidth: 110, readOnly: true, numeric: true },
  binLocationAllocation: { type: 'text', minWidth: 160, readOnly: true },
  stdDiscount: { type: 'number', minWidth: 95, numeric: true },
  deliveredQty: { type: 'number', minWidth: 120, readOnly: true, numeric: true },
  whse: { type: 'text', minWidth: 120 },
  distRule: { type: 'text', minWidth: 115 },
  distRule2: { type: 'text', minWidth: 115 },
  distRule3: { type: 'text', minWidth: 115 },
  distRule4: { type: 'text', minWidth: 115 },
  distRule5: { type: 'text', minWidth: 115 },
  cogsDistRule: { type: 'text', minWidth: 130 },
  openQty: { type: 'number', minWidth: 110, readOnly: true, numeric: true },
  orderedQty: { type: 'number', minWidth: 110, readOnly: true, numeric: true },
  blanketAgreementNo: { type: 'text', minWidth: 150 },
  withoutQtyPosting: { type: 'checkbox', minWidth: 145 },
  enableSettingCost: { type: 'checkbox', minWidth: 140 },
  returnCost: { type: 'number', minWidth: 125, numeric: true },
  commPercent: { type: 'number', minWidth: 95, numeric: true },
  assessableValue: { type: 'number', minWidth: 150, numeric: true },
  U_GrossWt: { type: 'number', minWidth: 110, numeric: true },
  U_TotalPackage: { type: 'number', minWidth: 130, numeric: true },
  U_Fix_Brock_B: { type: 'number', minWidth: 135, numeric: true },
  U_Fix_Brock_S: { type: 'number', minWidth: 140, numeric: true },
  documentCreated: { type: 'date', minWidth: 140, readOnly: true },
};

export const SALES_ORDER_WRITABLE_STANDARD_LINE_FIELDS = Object.freeze({
  itemNo: Object.freeze({ serviceLayerField: 'ItemCode', payloadKey: 'itemNo' }),
  itemDescription: Object.freeze({ serviceLayerField: 'ItemDescription', payloadKey: 'itemDescription' }),
  quantity: Object.freeze({ serviceLayerField: 'Quantity', payloadKey: 'quantity' }),
  unitPrice: Object.freeze({ serviceLayerField: 'UnitPrice', payloadKey: 'unitPrice' }),
  uomCode: Object.freeze({ serviceLayerField: 'UoMEntry', payloadKey: 'uomCode', resolved: true }),
  uomName: Object.freeze({ serviceLayerField: 'UoMEntry', payloadKey: 'uomName', resolved: true }),
  stdDiscount: Object.freeze({ serviceLayerField: 'DiscountPercent', payloadKey: 'stdDiscount' }),
  taxCode: Object.freeze({ serviceLayerField: 'TaxCode', payloadKey: 'taxCode' }),
  lineShippingType: Object.freeze({ serviceLayerField: 'ShippingMethod', payloadKey: 'lineShippingType' }),
  lineDeliveryDate: Object.freeze({ serviceLayerField: 'ShipDate', payloadKey: 'lineDeliveryDate' }),
  requiredDate: Object.freeze({ serviceLayerField: 'RequiredDate', payloadKey: 'requiredDate' }),
  noOfPackages: Object.freeze({ serviceLayerField: 'PackageQuantity', payloadKey: 'noOfPackages' }),
  taxLiable: Object.freeze({ serviceLayerField: 'TaxOnly', payloadKey: 'taxLiable' }),
  whse: Object.freeze({ serviceLayerField: 'WarehouseCode', payloadKey: 'whse' }),
  distRule: Object.freeze({ serviceLayerField: 'CostingCode', payloadKey: 'distRule' }),
  distRule2: Object.freeze({ serviceLayerField: 'CostingCode2', payloadKey: 'distRule2' }),
  distRule3: Object.freeze({ serviceLayerField: 'CostingCode3', payloadKey: 'distRule3' }),
  distRule4: Object.freeze({ serviceLayerField: 'CostingCode4', payloadKey: 'distRule4' }),
  distRule5: Object.freeze({ serviceLayerField: 'CostingCode5', payloadKey: 'distRule5' }),
  cogsDistRule: Object.freeze({ serviceLayerField: 'COGSCostingCode', payloadKey: 'cogsDistRule' }),
  glAccount: Object.freeze({ serviceLayerField: 'AccountCode', payloadKey: 'glAccount' }),
  wTaxLiable: Object.freeze({ serviceLayerField: 'WTLiable', payloadKey: 'wTaxLiable' }),
  blanketAgreementNo: Object.freeze({ serviceLayerField: 'AgreementNo', payloadKey: 'blanketAgreementNo' }),
  commPercent: Object.freeze({ serviceLayerField: 'CommissionPercent', payloadKey: 'commPercent' }),
  withoutQtyPosting: Object.freeze({ serviceLayerField: 'WithoutInventoryMovement', payloadKey: 'withoutQtyPosting' }),
  loc: Object.freeze({ serviceLayerField: 'LocationCode', payloadKey: 'loc' }),
  countryOfOrigin: Object.freeze({ serviceLayerField: 'CountryOrg', payloadKey: 'countryOfOrigin' }),
  hsnCode: Object.freeze({ serviceLayerField: 'HSNEntry', payloadKey: 'hsnCode', resolved: true }),
  sacCode: Object.freeze({ serviceLayerField: 'SACEntry', payloadKey: 'sacCode', resolved: true }),
  freeText: Object.freeze({ serviceLayerField: 'FreeText', payloadKey: 'freeText' }),
});

export const getSalesOrderWritableStandardLineField = (key) => (
  SALES_ORDER_WRITABLE_STANDARD_LINE_FIELDS[String(key || '').trim()] || null
);

export const isSalesOrderWritableStandardLineKey = (key) => (
  Boolean(getSalesOrderWritableStandardLineField(key))
);

const buildLiveFieldMap = (fields = []) => {
  const map = new Map();

  (fields || []).forEach((field) => {
    if (!field?.key) return;
    [
      field.key,
      field.sapField,
      field.fieldName,
      field.label,
    ]
      .map(normalizeToken)
      .filter(Boolean)
      .forEach((token) => {
        if (!map.has(token)) {
          map.set(token, field);
        }
      });
  });

  return map;
};

const buildRowUdfMap = (fields = []) => {
  const map = new Map();

  (fields || []).forEach((field) => {
    if (!field?.key) return;
    [
      field.key,
      field.sapField,
      field.aliasId,
      field.label,
    ]
      .map((value) => (String(value || '').startsWith('U_') ? normalizeUdfKey(value) : normalizeToken(value)))
      .filter(Boolean)
      .forEach((token) => {
        if (!map.has(token)) {
          map.set(token, field);
        }
      });
  });

  return map;
};

const findInternalKey = (layoutColumn, liveFieldMap) => {
  const fieldToken = normalizeToken(layoutColumn.fieldName || layoutColumn.columnUid);
  const labelToken = normalizeToken(layoutColumn.columnTitle);
  const rawTitle = String(layoutColumn.columnTitle || '').trim();
  const rawFieldName = String(layoutColumn.fieldName || layoutColumn.columnUid || '').trim();
  const rawFieldNameUpper = rawFieldName.toUpperCase();

  if (labelToken === 'TAXCODE' && rawTitle && !/\s/.test(rawTitle)) {
    return 'taxCodeRepeat';
  }

  if (labelToken === 'PRICE' && rawTitle.toUpperCase() === 'PRICE' && rawFieldNameUpper === 'PRICE') {
    return 'unitPrice';
  }

  if (labelToken === 'PRICE' && rawTitle.toUpperCase() === 'PRICE' && rawFieldNameUpper.startsWith('U_')) {
    return 'price';
  }

  if (rawFieldNameUpper.startsWith('U_') && normalizeUdfKey(rawFieldName) === 'U_TAXCODE') {
    return 'taxCodeRepeat';
  }

  if (rawFieldNameUpper.startsWith('U_') && normalizeUdfKey(rawFieldName) === 'U_PRICE') {
    return 'price';
  }

  if (['U_FORRATE', 'U_FOR_RATE', 'U_FORPRICE', 'U_FOR_PRICE'].includes(normalizeUdfKey(rawFieldName))) {
    return 'forRate';
  }

  const labelMappedKey = LABEL_TO_INTERNAL_KEY[labelToken];
  // SAP can retain an old physical UID while the Form Settings caption has
  // been changed. For standard fields the visible caption is authoritative;
  // keep explicit UDF identities above this branch so UDFs stay company-safe.
  if (labelMappedKey && !layoutColumn.preferPhysicalField && !rawFieldNameUpper.startsWith('U_')) {
    return labelMappedKey;
  }
  if (labelMappedKey && [
    'DISTRRULE',
    'DISTRIBUTIONRULE',
    'PACKINGTYPE',
    'PACKING',
    'TAXCODE',
  ].includes(labelToken)) {
    return labelMappedKey;
  }

  return (
    SAP_FIELD_TO_INTERNAL_KEY[fieldToken]
    || labelMappedKey
    || liveFieldMap.get(fieldToken)?.key
    || liveFieldMap.get(labelToken)?.key
    || ''
  );
};

const buildSyntheticColumn = (layoutColumn, key, extras = {}) => {
  const readOnly = extras.readOnly ?? (layoutColumn.editable === false);
  return {
    key,
    valueKey: extras.valueKey || key,
    rendererKey: extras.rendererKey || key,
    fieldName: layoutColumn.fieldName || layoutColumn.columnUid || key,
    layoutFieldName: layoutColumn.fieldName || layoutColumn.columnUid || key,
    label: layoutColumn.columnTitle || extras.label || key,
    visible: layoutColumn.visible !== false,
    // The SAP Form Settings Active value is independent of whether this web
    // client can safely post a field. Keep the UI input read-only when needed,
    // while preserving SAP's actual Active checkbox in Form Settings.
    active: extras.active ?? (layoutColumn.editable !== false),
    readOnly,
    minWidth: Number(layoutColumn.width) || extras.minWidth || 125,
    width: Number(layoutColumn.width) || extras.minWidth || 125,
    order: Number(layoutColumn.columnOrder) || extras.order || 0,
    columnOrder: Number(layoutColumn.columnOrder) || extras.order || 0,
    sapControlled: layoutColumn.source !== 'fallback',
    importedLayout: true,
    source: extras.source || layoutColumn.source || 'imported-layout',
    type: extras.type || mapLayoutDataTypeToInputType(layoutColumn.dataType),
    numeric: extras.numeric || false,
    isUdf: extras.isUdf || false,
    lookupSource: extras.lookupSource,
    lookupTable: extras.lookupTable,
    lookup: extras.lookup,
    options: extras.options,
    field: extras.field,
    id: extras.id,
    schemaFieldId: extras.schemaFieldId,
    tableId: extras.tableId,
    fieldId: extras.fieldId,
    schemaDriven: Boolean(extras.schemaDriven),
    lookupConfigured: Boolean(extras.lookupConfigured),
    serviceLayerField: extras.serviceLayerField,
    payloadKey: extras.payloadKey,
    writableStandardField: Boolean(extras.writableStandardField),
    displayOnly: Boolean(extras.displayOnly),
  };
};

const buildStandardLayoutColumn = (layoutColumn, liveField, internalKey, index) => {
  const standardOverride = STANDARD_FIELD_OVERRIDES[internalKey] || {};
  const writableMapping = getSalesOrderWritableStandardLineField(internalKey);
  const readOnly = standardOverride.readOnly ?? (
    !writableMapping || liveField?.readOnly || layoutColumn.editable === false
  );
  return {
    ...(liveField || {}),
    ...standardOverride,
    key: internalKey,
    valueKey: internalKey,
    rendererKey: internalKey,
    fieldName: layoutColumn.fieldName || layoutColumn.columnUid || liveField?.fieldName || internalKey,
    layoutFieldName: layoutColumn.fieldName || layoutColumn.columnUid || liveField?.fieldName || internalKey,
    label: layoutColumn.columnTitle || liveField?.label || internalKey,
    visible: layoutColumn.visible !== false,
    active: standardOverride.active ?? layoutColumn.editable !== false,
    readOnly,
    minWidth: Number(layoutColumn.width) || standardOverride.minWidth || liveField?.minWidth || 125,
    width: Number(layoutColumn.width) || standardOverride.minWidth || liveField?.minWidth || 125,
    order: Number(layoutColumn.columnOrder) || index + 1,
    columnOrder: Number(layoutColumn.columnOrder) || index + 1,
    sapControlled: layoutColumn.source !== 'fallback' && liveField?.sapControlled !== false,
    importedLayout: true,
    source: layoutColumn.source || 'imported-layout',
    isUdf: false,
    serviceLayerField: writableMapping?.serviceLayerField,
    payloadKey: writableMapping?.payloadKey,
    writableStandardField: Boolean(writableMapping),
  };
};

const buildGenericUdfField = (layoutColumn, fieldName) => ({
  key: fieldName,
  sapField: fieldName,
  label: layoutColumn.columnTitle || fieldName,
  type: mapLayoutDataTypeToInputType(layoutColumn.dataType),
  options: [],
  readOnly: layoutColumn.editable === false,
  active: layoutColumn.editable !== false,
});

const isSchemaUdfField = (field = {}) => {
  const storage = String(field.storage || '').trim().toLowerCase();
  const sapField = String(field.sapField || field.databaseField || field.stateKey || '').trim();
  return storage === 'udf' || sapField.toUpperCase().startsWith('U_');
};

const preserveSchemaUdfKey = (value) => {
  const normalized = String(value || '').trim().replace(/[^A-Za-z0-9_]+/g, '');
  if (!normalized) return '';
  return normalized.toUpperCase().startsWith('U_') ? normalized : `U_${normalized.replace(/^_+/, '')}`;
};

const normalizeSchemaFieldKey = (field = {}) => {
  const sapField = String(field.sapField || field.databaseField || field.stateKey || '').trim();
  return isSchemaUdfField(field)
    ? preserveSchemaUdfKey(sapField || field.stateKey || field.id)
    : String(field.stateKey || sapField || field.id || '').trim();
};

const getSchemaFieldInputType = (field = {}) => {
  const normalizedType = String(field.type || field.renderer || '').trim().toLowerCase();
  if (['number', 'integer'].includes(normalizedType)) return 'number';
  if (normalizedType === 'date') return 'date';
  if (['checkbox', 'boolean', 'yesno', 'yes_no'].includes(normalizedType)) return 'checkbox';
  if (normalizedType === 'textarea') return 'textarea';
  if (normalizedType === 'select') return 'select';
  return 'text';
};

const getSchemaSalesOrderLookupSource = (field = {}, lineTable = 'RDR1') => {
  const rawSource = String(field.lookup?.source || field.lookupSource || '').trim().toLowerCase();
  const sapField = preserveSchemaUdfKey(field.sapField || field.databaseField || field.stateKey);
  if (!isSchemaUdfField(field) || !sapField) return field.lookupSource || undefined;
  if (rawSource === 'udf-linked-table' || rawSource === 'udo' || field.linkedTable || field.lookupTable || field.relUDO) {
    return `udf:${lineTable}:${sapField}`;
  }
  return field.lookupSource || undefined;
};

export const buildSalesOrderRowUdfDefinitionsFromSchema = (schemaLineFields = [], { lineTable = 'RDR1' } = {}) => (
  (schemaLineFields || [])
    .filter(isSchemaUdfField)
    .map((field, index) => {
      const key = normalizeSchemaFieldKey(field);
      if (!key) return null;

      return {
        key,
        sapField: key,
        label: field.label || field.description || key,
        type: getSchemaFieldInputType(field),
        defaultValue: field.defaultValue ?? '',
        required: Boolean(field.required),
        readOnly: Boolean(field.readOnly || field.editable === false),
        visible: field.visible !== false,
        active: field.editable !== false,
        maxLength: field.maxLength || field.length || undefined,
        precision: field.precision ?? undefined,
        scale: field.scale ?? undefined,
        options: Array.isArray(field.options) ? field.options : [],
        lookupSource: getSchemaSalesOrderLookupSource(field, lineTable),
        lookup: field.lookup,
        lookupConfigured: Boolean(field.lookupConfigured),
        lookupTable: field.linkedTable || field.lookupTable || undefined,
        tableId: lineTable,
        fieldId: field.fieldId,
        aliasId: key.replace(/^U_/, ''),
        order: Number(field.order) || 1000 + index,
        minWidth: Number(field.width) || (field.type === 'textarea' ? 180 : 125),
        sapControlled: true,
        schemaFieldId: field.id,
      };
    })
    .filter(Boolean)
);

export const buildSalesOrderMatrixColumnsFromSchema = ({
  schemaLineFields = [],
  liveMatrixColumns = [],
  rowUdfFields = [],
  lineTable = 'RDR1',
} = {}) => {
  if (!Array.isArray(schemaLineFields) || !schemaLineFields.length) return [];

  const liveFieldMap = buildLiveFieldMap(liveMatrixColumns);
  const rowUdfMap = buildRowUdfMap(rowUdfFields);

  return withUniqueLayoutKeys(
    schemaLineFields
      .map((field, index) => {
        const sapField = String(field.sapField || field.databaseField || field.stateKey || '').trim();
        const key = normalizeSchemaFieldKey(field);
        if (!key || !sapField) return null;

        const isUdf = isSchemaUdfField(field);
        const layoutColumn = {
          fieldName: sapField,
          columnUid: field.databaseField || sapField,
          columnTitle: field.label || sapField,
          visible: field.visible !== false,
          editable: field.editable !== false && !field.readOnly,
          columnOrder: Number(field.order) || index + 1,
          width: Number(field.width) || undefined,
          dataType: field.databaseType || field.type || '',
          isUdf,
          source: 'schema',
          preferPhysicalField: true,
        };

        // Item No. always uses SAP's standard line identity and lookup, including
        // schema-only company layouts that incorrectly flag this column as a UDF.
        if (findInternalKey(layoutColumn, liveFieldMap) === 'itemNo') {
          const liveItemField = liveMatrixColumns.find((candidate) => candidate.key === 'itemNo');
          return {
            ...buildStandardLayoutColumn(layoutColumn, liveItemField, 'itemNo', index),
            type: 'text',
            lookupSource: 'items',
            id: field.id,
            schemaFieldId: field.id,
            schemaDriven: true,
          };
        }

        if (isUdf) {
          const udfField = rowUdfMap.get(normalizeUdfKey(sapField))
            || rowUdfMap.get(normalizeToken(field.label))
            || {
              key,
              sapField: key,
              label: field.label || key,
              type: getSchemaFieldInputType(field),
              options: Array.isArray(field.options) ? field.options : [],
              lookupSource: getSchemaSalesOrderLookupSource(field, lineTable),
              lookupTable: field.linkedTable || field.lookupTable || undefined,
              readOnly: Boolean(field.readOnly || field.editable === false),
              active: field.editable !== false,
            };

          return buildSyntheticColumn(layoutColumn, udfField.key, {
            label: field.label || udfField.label || udfField.key,
            readOnly: Boolean(udfField.readOnly || field.readOnly || field.editable === false),
            minWidth: Number(field.width) || (udfField.type === 'textarea' ? 180 : 125),
            order: Number(field.order) || index + 1,
            type: udfField.type || getSchemaFieldInputType(field),
            isUdf: true,
            lookupSource: udfField.lookupSource || getSchemaSalesOrderLookupSource(field, lineTable),
            lookupTable: udfField.lookupTable || field.linkedTable || field.lookupTable,
            lookup: field.lookup,
            options: udfField.options || field.options,
            field: udfField,
            id: field.id,
            schemaFieldId: field.id,
            fieldId: field.fieldId || field.lookup?.fieldId,
            schemaDriven: true,
            lookupConfigured: Boolean(field.lookupConfigured),
            sapControlled: true,
          });
        }

        const internalKey = findInternalKey(layoutColumn, liveFieldMap);
        const liveField = internalKey
          ? liveFieldMap.get(normalizeToken(internalKey)) || liveMatrixColumns.find((candidate) => candidate.key === internalKey)
          : null;

        if (liveField && STANDARD_RENDERER_KEYS.has(internalKey)) {
          return {
            ...buildStandardLayoutColumn(layoutColumn, liveField, internalKey, index),
            lookupSource: liveField.lookupSource || field.lookup?.source || field.lookupSource || undefined,
            lookup: field.lookup,
            options: liveField.options || (Array.isArray(field.options) ? field.options : undefined),
            id: field.id,
            schemaFieldId: field.id,
            fieldId: field.fieldId || field.lookup?.fieldId,
            schemaDriven: true,
            lookupConfigured: Boolean(field.lookupConfigured),
          };
        }

        if (internalKey && STANDARD_RENDERER_KEYS.has(internalKey)) {
          const writableMapping = getSalesOrderWritableStandardLineField(internalKey);
          const standardOverride = STANDARD_FIELD_OVERRIDES[internalKey] || {};
          const readOnly = standardOverride.readOnly ?? (
            !writableMapping || field.readOnly || field.editable === false
          );
          return buildSyntheticColumn(layoutColumn, internalKey, {
            ...standardOverride,
            label: field.label || internalKey,
            order: Number(field.order) || index + 1,
            readOnly,
            active: standardOverride.active ?? field.editable !== false,
            lookupSource: field.lookup?.source || field.lookupSource || undefined,
            lookup: field.lookup,
            options: Array.isArray(field.options) ? field.options : undefined,
            id: field.id,
            schemaFieldId: field.id,
            fieldId: field.fieldId || field.lookup?.fieldId,
            schemaDriven: true,
            lookupConfigured: Boolean(field.lookupConfigured),
            sapControlled: true,
            serviceLayerField: writableMapping?.serviceLayerField,
            payloadKey: writableMapping?.payloadKey,
            writableStandardField: Boolean(writableMapping),
          });
        }

        return buildSyntheticColumn(layoutColumn, key, {
          label: field.label || key,
          readOnly: true,
          minWidth: Number(field.width) || 125,
          order: Number(field.order) || index + 1,
          type: getSchemaFieldInputType(field),
          schemaDriven: true,
          lookupConfigured: Boolean(field.lookupConfigured),
          sapControlled: true,
          lookupSource: field.lookup?.source || field.lookupSource || undefined,
          lookup: field.lookup,
          options: Array.isArray(field.options) ? field.options : undefined,
          id: field.id,
          schemaFieldId: field.id,
          fieldId: field.fieldId || field.lookup?.fieldId,
          source: 'RDR1_SCHEMA_DISPLAY',
        });
      })
      .filter(Boolean)
  );
};

const withUniqueLayoutKeys = (columns = []) => {
  const counts = new Map();

  return (columns || []).map((column, index) => {
    const baseKey = column.key || column.valueKey || column.fieldName || `layout_${index + 1}`;
    const count = counts.get(baseKey) || 0;
    counts.set(baseKey, count + 1);

    const valueKey = column.valueKey || baseKey;
    const rendererKey = column.rendererKey || valueKey;
    if (count === 0) {
      return {
        ...column,
        key: baseKey,
        valueKey,
        rendererKey,
      };
    }

    return {
      ...column,
      key: `${baseKey}__layout_${index + 1}`,
      valueKey,
      rendererKey,
    };
  });
};

const getColumnIdentityTokens = (column = {}) => (
  [
    column.key,
    column.valueKey,
    column.rendererKey,
    column.fieldName,
    column.layoutFieldName,
    column.sapField,
    column.sapColumnId,
    column.columnUid,
  ]
    .map((value) => {
      const raw = String(value || '').trim();
      return raw.startsWith('U_') ? normalizeUdfKey(raw) : normalizeToken(raw);
    })
    .filter(Boolean)
);

const appendMissingLiveMatrixColumns = (layoutMappedColumns = [], liveMatrixColumns = []) => {
  if (!Array.isArray(liveMatrixColumns) || !liveMatrixColumns.length) return layoutMappedColumns;

  const seen = new Set();
  layoutMappedColumns.forEach((column) => {
    getColumnIdentityTokens(column).forEach((token) => seen.add(token));
  });

  const missing = liveMatrixColumns.filter((column) => {
    const tokens = getColumnIdentityTokens(column);
    if (!tokens.length) return false;
    return !tokens.some((token) => seen.has(token));
  });

  return [...layoutMappedColumns, ...missing];
};

const isLineNumberColumn = (column = {}) => (
  column.key === SALES_ORDER_LINE_NUMBER_KEY
  || column.valueKey === SALES_ORDER_LINE_NUMBER_KEY
  || column.rendererKey === SALES_ORDER_LINE_NUMBER_KEY
  || getColumnIdentityTokens(column).some((token) => token === 'LINENUM' || token === SALES_ORDER_LINE_NUMBER_KEY)
);

const pinLineNumberColumnFirst = (columns = []) => (
  (columns || []).map((column) => (
    isLineNumberColumn(column)
      ? {
          ...column,
          key: SALES_ORDER_LINE_NUMBER_KEY,
          valueKey: SALES_ORDER_LINE_NUMBER_KEY,
          rendererKey: SALES_ORDER_LINE_NUMBER_KEY,
          label: '#',
          order: -10000,
          columnOrder: -10000,
          minWidth: column.minWidth || 42,
          width: column.width || column.minWidth || 42,
          readOnly: true,
          active: false,
        }
      : column
  ))
);

const ensureLineNumberColumn = (columns = []) => {
  if ((columns || []).some(isLineNumberColumn)) return columns;

  return [{
    key: SALES_ORDER_LINE_NUMBER_KEY,
    valueKey: SALES_ORDER_LINE_NUMBER_KEY,
    rendererKey: SALES_ORDER_LINE_NUMBER_KEY,
    fieldName: 'LineNum',
    sapField: 'LineNum',
    label: '#',
    type: 'number',
    minWidth: 42,
    width: 42,
    order: -10000,
    columnOrder: -10000,
    visible: true,
    readOnly: true,
    active: false,
    sapControlled: true,
  }, ...(columns || [])];
};

export const mapLiveSalesOrderMatrixToLayout = (columns = []) => (
  (columns || []).map((column, index) => ({
    columnUid: column.sapColumnId || column.columnUid || column.sapField || column.key || `column_${index + 1}`,
    fieldName: column.sapField || column.fieldName || column.key || '',
    columnTitle: column.label || column.columnTitle || column.key || '',
    visible: column.visible !== false,
    editable: column.active !== false,
    columnOrder: Number.isFinite(Number(column.order)) ? Number(column.order) : index + 1,
    width: Number(column.minWidth || column.width) || undefined,
    dataType: column.dataType || column.type || '',
    isUdf: Boolean(column.isUdf || String(column.sapField || column.key || '').toUpperCase().startsWith('U_')),
    source: 'live-sap-metadata',
  }))
);

const getColumnDisplayIdentity = (column = {}) => {
  if (isLineNumberColumn(column)) return SALES_ORDER_LINE_NUMBER_KEY;
  const labelToken = normalizeToken(column.label || column.columnTitle);
  if (labelToken) return `LABEL:${labelToken}`;
  const tokens = getColumnIdentityTokens(column);
  return tokens[0] || '';
};

const isPreferredStandardMatrixColumn = (column = {}) => (
  !column.isUdf
  && [column.key, column.valueKey, column.rendererKey].some((key) => STANDARD_RENDERER_KEYS.has(key))
);

const dedupeVisibleMatrixColumns = (columns = []) => {
  const indexesByIdentity = new Map();
  const deduped = [];

  (columns || []).forEach((column) => {
    const identity = getColumnDisplayIdentity(column);
    if (!identity) {
      deduped.push(column);
      return;
    }

    const existingIndex = indexesByIdentity.get(identity);
    if (existingIndex === undefined) {
      indexesByIdentity.set(identity, deduped.length);
      deduped.push(column);
      return;
    }

    if (isPreferredStandardMatrixColumn(column) && !isPreferredStandardMatrixColumn(deduped[existingIndex])) {
      deduped[existingIndex] = column;
    }
  });

  return deduped;
};

const applyLineNumberMode = (columns = [], includeLineNumber = true) => {
  if (includeLineNumber) return ensureLineNumberColumn(columns);
  return (columns || []).filter((column) => !isLineNumberColumn(column));
};

export const buildSalesOrderMatrixColumnsFromLayout = ({
  layoutColumns = [],
  liveMatrixColumns = [],
  rowUdfFields = [],
  includeLineNumber = true,
  appendMissingLiveColumns = false,
  preserveDuplicateColumns = false,
} = {}) => {
  if (!Array.isArray(layoutColumns) || !layoutColumns.length) {
    return Array.isArray(liveMatrixColumns) && liveMatrixColumns.length
      ? withUniqueLayoutKeys(dedupeVisibleMatrixColumns(pinLineNumberColumnFirst(
          applyLineNumberMode(liveMatrixColumns, includeLineNumber),
        )))
      : withUniqueLayoutKeys(dedupeVisibleMatrixColumns(pinLineNumberColumnFirst(
          applyLineNumberMode(getSapStandardSalesMatrixColumns(), includeLineNumber),
        )));
  }

  const liveFieldMap = buildLiveFieldMap(liveMatrixColumns);
  const rowUdfMap = buildRowUdfMap(rowUdfFields);

  const mappedColumns = layoutColumns.map((layoutColumn, index) => {
    const internalKey = findInternalKey(layoutColumn, liveFieldMap);
    const fieldName = String(layoutColumn.fieldName || layoutColumn.columnUid || '').trim();
    const udfField = rowUdfMap.get(normalizeUdfKey(fieldName)) || rowUdfMap.get(normalizeToken(layoutColumn.columnTitle));
    const liveField = internalKey ? liveFieldMap.get(normalizeToken(internalKey)) || liveMatrixColumns.find((field) => field.key === internalKey) : null;
    const layoutIsUdf = Boolean(layoutColumn.isUdf) || fieldName.toUpperCase().startsWith('U_');

    if (internalKey === SALES_ORDER_LINE_NUMBER_KEY) {
      if (!includeLineNumber) return null;
      return buildSyntheticColumn(layoutColumn, SALES_ORDER_LINE_NUMBER_KEY, {
        label: '#',
        readOnly: true,
        minWidth: 42,
        order: index + 1,
        type: 'number',
      });
    }

    if (internalKey === 'itemNo') {
      return buildStandardLayoutColumn(layoutColumn, liveField, internalKey, index);
    }

    if (udfField && layoutIsUdf) {
      return buildSyntheticColumn(layoutColumn, udfField.key, {
        label: layoutColumn.columnTitle || udfField.label,
        readOnly: Boolean(udfField.readOnly) || layoutColumn.editable === false,
        minWidth: Number(layoutColumn.width) || (udfField.type === 'textarea' ? 180 : 125),
        order: Number(layoutColumn.columnOrder) || index + 1,
        type: udfField.type,
        isUdf: true,
        lookupSource: udfField.lookupSource,
        lookupTable: udfField.lookupTable,
        schemaFieldId: udfField.schemaFieldId,
        tableId: udfField.tableId,
        options: udfField.options,
        field: udfField,
      });
    }

    if (liveField && STANDARD_RENDERER_KEYS.has(internalKey)) {
      return buildStandardLayoutColumn(layoutColumn, liveField, internalKey, index);
    }

    if (!liveField && internalKey && STANDARD_RENDERER_KEYS.has(internalKey)) {
      const writableMapping = getSalesOrderWritableStandardLineField(internalKey);
      const standardOverride = STANDARD_FIELD_OVERRIDES[internalKey] || {};
      const readOnly = standardOverride.readOnly ?? (
        !writableMapping || layoutColumn.editable === false
      );
      return buildSyntheticColumn(layoutColumn, internalKey, {
        ...standardOverride,
        label: layoutColumn.columnTitle || internalKey,
        order: Number(layoutColumn.columnOrder) || index + 1,
        readOnly,
        active: standardOverride.active ?? layoutColumn.editable !== false,
        serviceLayerField: writableMapping?.serviceLayerField,
        payloadKey: writableMapping?.payloadKey,
        writableStandardField: Boolean(writableMapping),
      });
    }

    if (liveField) {
      return {
        ...liveField,
        key: liveField.key,
        valueKey: liveField.key,
        rendererKey: liveField.key,
        fieldName,
        layoutFieldName: fieldName,
        label: layoutColumn.columnTitle || liveField.label || liveField.key,
        visible: layoutColumn.visible !== false,
        active: layoutColumn.editable !== false,
        minWidth: Number(layoutColumn.width) || liveField.minWidth || 125,
        width: Number(layoutColumn.width) || liveField.minWidth || 125,
        order: Number(layoutColumn.columnOrder) || index + 1,
        columnOrder: Number(layoutColumn.columnOrder) || index + 1,
        sapControlled: layoutColumn.source !== 'fallback' && liveField.sapControlled !== false,
        importedLayout: true,
        source: layoutColumn.source || 'imported-layout',
      };
    }

    if (udfField) {
      return buildSyntheticColumn(layoutColumn, udfField.key, {
        label: udfField.label || layoutColumn.columnTitle,
        readOnly: Boolean(udfField.readOnly) || layoutColumn.editable === false,
        minWidth: udfField.type === 'textarea' ? 180 : 125,
        order: index + 1,
        type: udfField.type,
        isUdf: true,
        lookupSource: udfField.lookupSource,
        lookupTable: udfField.lookupTable,
        options: udfField.options,
      });
    }

    if (fieldName.toUpperCase().startsWith('U_')) {
      const genericField = buildGenericUdfField(layoutColumn, fieldName);
      return buildSyntheticColumn(layoutColumn, fieldName, {
        order: index + 1,
        isUdf: true,
        field: genericField,
        type: genericField.type,
      });
    }

    // Do not silently lose a column that SAP B1 shows in Form Settings. It is
    // read-only until this client has a confirmed payload mapping, but it
    // remains present with SAP's caption, visibility, active flag, and width.
    return buildSyntheticColumn(layoutColumn, `sapLayout_${fieldName || index + 1}`, {
      label: layoutColumn.columnTitle || fieldName || `SAP Column ${index + 1}`,
      readOnly: true,
      active: layoutColumn.editable !== false,
      minWidth: Number(layoutColumn.width) || 125,
      order: Number(layoutColumn.columnOrder) || index + 1,
      type: mapLayoutDataTypeToInputType(layoutColumn.dataType),
      source: layoutColumn.source || 'live-sap-metadata',
      displayOnly: true,
    });
  });

  const filtered = mappedColumns.filter(Boolean);

  const mergedColumns = appendMissingLiveColumns
    ? appendMissingLiveMatrixColumns(filtered, liveMatrixColumns)
    : filtered;

  return withUniqueLayoutKeys(
    preserveDuplicateColumns
      ? applyLineNumberMode(mergedColumns, includeLineNumber)
      : dedupeVisibleMatrixColumns(applyLineNumberMode(mergedColumns, includeLineNumber)),
  );
};

const SALES_ORDER_QUERY_CAPTIONS = Object.freeze({
  Item_No: 'Item No.', Item_Description: 'Item Description', Unit: 'Unit',
  Quantity: 'Quantity', Unit_Price: 'Unit Price', Discount: 'Discount',
  Amount: 'Amount', Net_Rate: 'Net Rate', Taxable_Amount: 'Taxable Amount',
  Total_LC: 'Total (LC)', Tax_Code: 'Tax Code', Tax_Amount_LC: 'Tax Amount (LC)',
  Discount_Percent: 'Discount %', Comm_Amt_Per_Tone: 'comm amt per tone',
  Commission_Percent: 'Commission (Percent)', Commission: 'Commission',
  Open_Qty: 'Open Qty', Country_Region_Of_Origin: 'Country/Region of Origin',
  Loc: 'Loc.', HSN: 'HSN', SAC: 'SAC', Commission_By: 'comissin by',
  Comm_Amt_Per_Tone_2: 'comm amt per tone', Commission_2: 'Commission',
  Seller_Terms_Of_Payment: 'Seller - Terms of Payment',
  Distr_Rule: 'Distr. Rule', COGS_Distr_Rule: 'COGS Distr. Rule',
  Blanket_Agreement_No: 'Blanket Agreement No.',
  UoM_Code: 'UoM Code', Sauda_Node_Ref: 'Sauda Node Ref',
});

export const buildStandardSalesCompanyQueryColumns = ({
  queryLayout,
  liveMatrixColumns = [],
  rowUdfFields = [],
  includeLineNumber = true,
} = {}) => {
  if (!queryLayout?.isPublished || !Array.isArray(queryLayout.columns) || !queryLayout.columns.length) {
    return null;
  }
  const currentUdfs = new Set(rowUdfFields.map((field) => String(field.key || '').toUpperCase()));
  const layoutColumns = queryLayout.columns
    .filter((column) => {
      const physical = String(column.fieldName || '').trim();
      return !/^U_/i.test(physical) || currentUdfs.has(physical.toUpperCase());
    })
    .map((column, index) => {
      const alias = String(column.key || column.label || '').trim();
      const physical = String(column.fieldName || alias).trim();
      return {
        fieldName: physical,
        columnUid: alias,
        columnTitle: SALES_ORDER_QUERY_CAPTIONS[alias] || String(column.label || alias).replace(/_/g, ' '),
        visible: true,
        editable: true,
        columnOrder: Number(column.order) || index + 1,
        dataType: column.type,
        isUdf: /^U_/i.test(physical),
        source: 'company-query-layout',
      };
    });
  return buildSalesOrderMatrixColumnsFromLayout({
    layoutColumns,
    liveMatrixColumns,
    rowUdfFields,
    includeLineNumber,
    preserveDuplicateColumns: true,
  }).map((column) => ({ ...column, companyQueryLayoutColumn: true }));
};
