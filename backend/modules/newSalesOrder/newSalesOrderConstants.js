'use strict';

const SALES_ORDER_DOCUMENT = Object.freeze({
  documentType: 'SALES_ORDER',
  objectType: '17',
  formType: '139',
  matrixId: '38',
  headerTable: 'ORDR',
  lineTable: 'RDR1',
});

const DELIVERY_DOCUMENT = Object.freeze({
  documentType: 'DELIVERY',
  objectType: '15',
  formType: '140',
  matrixId: '38',
  headerTable: 'ODLN',
  lineTable: 'DLN1',
});

const SALES_QUOTATION_DOCUMENT = Object.freeze({
  documentType: 'SALES_QUOTATION',
  objectType: '23',
  formType: '149',
  matrixId: '38',
  headerTable: 'OQUT',
  lineTable: 'QUT1',
});

const AR_INVOICE_DOCUMENT = Object.freeze({
  documentType: 'AR_INVOICE',
  objectType: '13',
  formType: '133',
  matrixId: '38',
  headerTable: 'OINV',
  lineTable: 'INV1',
});

const AR_CREDIT_MEMO_DOCUMENT = Object.freeze({
  documentType: 'AR_CREDIT_MEMO',
  objectType: '14',
  formType: '179',
  matrixId: '38',
  headerTable: 'ORIN',
  lineTable: 'RIN1',
});

const PURCHASE_REQUEST_DOCUMENT = Object.freeze({
  documentType: 'PURCHASE_REQUEST', objectType: '1470000113', formType: '1470000200', matrixId: '38',
  headerTable: 'OPRQ', lineTable: 'PRQ1', purchaseDocument: true,
});

const PURCHASE_QUOTATION_DOCUMENT = Object.freeze({
  documentType: 'PURCHASE_QUOTATION', objectType: '540000006', formType: '540000988', matrixId: '38',
  headerTable: 'OPQT', lineTable: 'PQT1', purchaseDocument: true,
});

const PURCHASE_ORDER_DOCUMENT = Object.freeze({
  documentType: 'PURCHASE_ORDER', objectType: '22', formType: '142', matrixId: '38',
  headerTable: 'OPOR', lineTable: 'POR1', purchaseDocument: true,
});

const GRPO_DOCUMENT = Object.freeze({
  documentType: 'GRPO', objectType: '20', formType: '143', matrixId: '38',
  headerTable: 'OPDN', lineTable: 'PDN1', purchaseDocument: true,
});

const AP_INVOICE_DOCUMENT = Object.freeze({
  documentType: 'AP_INVOICE', objectType: '18', formType: '141', matrixId: '38',
  headerTable: 'OPCH', lineTable: 'PCH1', purchaseDocument: true,
});

const AP_CREDIT_MEMO_DOCUMENT = Object.freeze({
  documentType: 'AP_CREDIT_MEMO', objectType: '19', formType: '181', matrixId: '38',
  headerTable: 'ORPC', lineTable: 'RPC1', purchaseDocument: true,
});

const SERVICE_AR_INVOICE_DOCUMENT = Object.freeze({
  documentType: 'SERVICE_AR_INVOICE',
  objectType: '13',
  formType: '133',
  matrixId: '38',
  headerTable: 'OINV',
  lineTable: 'INV1',
  serviceLineMode: true,
});

const SERVICE_AR_CREDIT_MEMO_DOCUMENT = Object.freeze({
  documentType: 'SERVICE_AR_CREDIT_MEMO',
  objectType: '14',
  formType: '179',
  matrixId: '38',
  headerTable: 'ORIN',
  lineTable: 'RIN1',
  serviceLineMode: true,
});

const SERVICE_AP_INVOICE_DOCUMENT = Object.freeze({
  documentType: 'SERVICE_AP_INVOICE',
  objectType: '18',
  formType: '141',
  matrixId: '38',
  headerTable: 'OPCH',
  lineTable: 'PCH1',
  serviceLineMode: true,
});

const SERVICE_AP_CREDIT_MEMO_DOCUMENT = Object.freeze({
  documentType: 'SERVICE_AP_CREDIT_MEMO',
  objectType: '19',
  formType: '181',
  matrixId: '38',
  headerTable: 'ORPC',
  lineTable: 'RPC1',
  serviceLineMode: true,
});

const SALES_DOCUMENTS = Object.freeze({
  SALES_QUOTATION: SALES_QUOTATION_DOCUMENT,
  SALES_ORDER: SALES_ORDER_DOCUMENT,
  DELIVERY: DELIVERY_DOCUMENT,
  AR_INVOICE: AR_INVOICE_DOCUMENT,
  AR_CREDIT_MEMO: AR_CREDIT_MEMO_DOCUMENT,
  PURCHASE_REQUEST: PURCHASE_REQUEST_DOCUMENT,
  PURCHASE_QUOTATION: PURCHASE_QUOTATION_DOCUMENT,
  PURCHASE_ORDER: PURCHASE_ORDER_DOCUMENT,
  GRPO: GRPO_DOCUMENT,
  AP_INVOICE: AP_INVOICE_DOCUMENT,
  AP_CREDIT_MEMO: AP_CREDIT_MEMO_DOCUMENT,
  SERVICE_AR_INVOICE: SERVICE_AR_INVOICE_DOCUMENT,
  SERVICE_AR_CREDIT_MEMO: SERVICE_AR_CREDIT_MEMO_DOCUMENT,
  SERVICE_AP_INVOICE: SERVICE_AP_INVOICE_DOCUMENT,
  SERVICE_AP_CREDIT_MEMO: SERVICE_AP_CREDIT_MEMO_DOCUMENT,
});

const resolveSalesDocument = (value = SALES_ORDER_DOCUMENT.documentType) => {
  const key = String(value || SALES_ORDER_DOCUMENT.documentType).trim().toUpperCase().replace(/[\s-]+/g, '_');
  const document = SALES_DOCUMENTS[key];
  if (!document) {
    const error = new Error(`Unsupported sales document type: ${value || '(empty)'}.`);
    error.statusCode = 400;
    error.code = 'UNSUPPORTED_SALES_DOCUMENT_TYPE';
    throw error;
  }
  return document;
};

const SCHEMA_FORMAT_VERSION = 'nso-schema-v1';

// This registry only describes stable SAP marketing-document semantics. Company
// UDFs are deliberately absent and are discovered from the active document
// profile tables plus CUFD at runtime.
const SALES_ORDER_HEADER_STANDARD_FIELDS = Object.freeze({
  CardCode: Object.freeze({
    stateKey: 'customerCode',
    sapField: 'CardCode',
    databaseField: 'CardCode',
    label: 'Buyer Code',
    renderer: 'lookup',
    lookupSource: 'business-partners',
    required: true,
    order: 10,
    width: 150,
  }),
  CardName: Object.freeze({
    stateKey: 'customerName',
    sapField: 'CardName',
    databaseField: 'CardName',
    label: 'Buyer Name',
    renderer: 'text',
    readOnly: true,
    order: 20,
    width: 220,
  }),
  DocDate: Object.freeze({
    stateKey: 'postingDate',
    sapField: 'DocDate',
    databaseField: 'DocDate',
    label: 'Posting Date',
    renderer: 'date',
    type: 'date',
    required: true,
    order: 30,
    width: 135,
  }),
  DocDueDate: Object.freeze({
    stateKey: 'deliveryDate',
    sapField: 'DocDueDate',
    databaseField: 'DocDueDate',
    label: 'Delivery Date',
    renderer: 'date',
    type: 'date',
    order: 40,
    width: 135,
  }),
  TaxDate: Object.freeze({
    stateKey: 'documentDate',
    sapField: 'TaxDate',
    databaseField: 'TaxDate',
    label: 'Document Date',
    renderer: 'date',
    type: 'date',
    required: true,
    order: 50,
    width: 135,
  }),
  NumAtCard: Object.freeze({
    stateKey: 'customerReferenceNo',
    sapField: 'NumAtCard',
    databaseField: 'NumAtCard',
    label: 'Customer Ref. No.',
    renderer: 'text',
    order: 60,
    width: 170,
  }),
  DocCurrency: Object.freeze({
    stateKey: 'documentCurrency',
    sapField: 'DocCurrency',
    databaseField: 'DocCur',
    aliases: Object.freeze(['DocCur']),
    label: 'Currency',
    renderer: 'text',
    order: 70,
    width: 100,
  }),
  SalesPersonCode: Object.freeze({
    stateKey: 'salesEmployeeCode',
    sapField: 'SalesPersonCode',
    databaseField: 'SlpCode',
    aliases: Object.freeze(['SlpCode', 'SalesEmployee']),
    label: 'Sales Employee',
    renderer: 'lookup',
    lookupSource: 'sales-employees',
    order: 80,
    width: 180,
  }),
  DocumentsOwner: Object.freeze({
    stateKey: 'ownerCode',
    sapField: 'DocumentsOwner',
    databaseField: 'OwnerCode',
    aliases: Object.freeze(['OwnerCode', 'Owner']),
    label: 'Owner',
    renderer: 'lookup',
    lookupSource: 'owners',
    order: 90,
    width: 180,
  }),
  Comments: Object.freeze({
    stateKey: 'remarks',
    sapField: 'Comments',
    databaseField: 'Comments',
    label: 'Remarks',
    renderer: 'textarea',
    type: 'textarea',
    order: 100,
    width: 320,
  }),
});

const PURCHASE_DOCUMENT_HEADER_STANDARD_FIELDS = Object.freeze({
  ...SALES_ORDER_HEADER_STANDARD_FIELDS,
  CardCode: Object.freeze({ ...SALES_ORDER_HEADER_STANDARD_FIELDS.CardCode, stateKey: 'vendorCode', label: 'Vendor Code' }),
  CardName: Object.freeze({ ...SALES_ORDER_HEADER_STANDARD_FIELDS.CardName, stateKey: 'vendorName', label: 'Vendor Name' }),
  NumAtCard: Object.freeze({ ...SALES_ORDER_HEADER_STANDARD_FIELDS.NumAtCard, stateKey: 'vendorReferenceNo', label: 'Vendor Ref. No.' }),
});

const SALES_ORDER_LINE_STANDARD_FIELDS = Object.freeze({
  LineNum: Object.freeze({
    stateKey: 'lineNumber',
    sapField: 'LineNum',
    databaseField: 'LineNum',
    label: '#',
    renderer: 'integer',
    type: 'integer',
    storage: 'display-only',
    readOnly: true,
    order: 10,
    width: 55,
  }),
  ItemCode: Object.freeze({
    stateKey: 'itemNo',
    sapField: 'ItemCode',
    databaseField: 'ItemCode',
    label: 'Item No.',
    renderer: 'item-lookup',
    lookupSource: 'items',
    required: true,
    order: 20,
    width: 160,
  }),
  ItemDescription: Object.freeze({
    stateKey: 'itemDescription',
    sapField: 'ItemDescription',
    databaseField: 'Dscription',
    aliases: Object.freeze(['Dscription']),
    label: 'Item Description',
    renderer: 'text',
    order: 30,
    width: 240,
  }),
  Quantity: Object.freeze({
    stateKey: 'quantity',
    sapField: 'Quantity',
    databaseField: 'Quantity',
    label: 'Quantity',
    renderer: 'number',
    required: true,
    order: 40,
    width: 105,
  }),
  UnitPrice: Object.freeze({
    stateKey: 'unitPrice',
    sapField: 'UnitPrice',
    databaseField: 'Price',
    aliases: Object.freeze(['Price', 'PriceBefDi']),
    label: 'Unit Price',
    renderer: 'number',
    order: 50,
    width: 120,
  }),
  WarehouseCode: Object.freeze({
    stateKey: 'warehouseCode',
    sapField: 'WarehouseCode',
    databaseField: 'WhsCode',
    aliases: Object.freeze(['WhsCode', 'Warehouse']),
    label: 'Warehouse',
    renderer: 'lookup',
    lookupSource: 'warehouses',
    required: true,
    order: 60,
    width: 120,
  }),
  ShippingMethod: Object.freeze({
    stateKey: 'lineShippingType',
    sapField: 'ShippingMethod',
    databaseField: 'TrnsCode',
    aliases: Object.freeze(['ShipType', 'ShippingType', 'Shipping Type', 'TransportationCode', 'TrnspCode']),
    label: 'Shipping Type',
    renderer: 'lookup',
    lookupSource: 'shipping-types',
    order: 65,
    width: 125,
  }),
  TaxCode: Object.freeze({
    stateKey: 'taxCode',
    sapField: 'TaxCode',
    databaseField: 'VatGroup',
    aliases: Object.freeze(['VatGroup']),
    label: 'Tax Code',
    renderer: 'lookup',
    lookupSource: 'tax-codes',
    order: 70,
    width: 120,
  }),
  GrossTotal: Object.freeze({
    stateKey: 'grossTotal',
    sapField: 'GrossTotal',
    databaseField: 'GTotal',
    aliases: Object.freeze(['GTotal', 'Total (Doc)', 'Total Doc', 'Gross Total']),
    label: 'Total (Doc)',
    renderer: 'number',
    storage: 'calculated',
    readOnly: true,
    order: 75,
    width: 120,
  }),
  TotalFrgn: Object.freeze({
    stateKey: 'lineTotalForeign',
    sapField: 'RowTotalFC',
    databaseField: 'TotalFrgn',
    aliases: Object.freeze(['RowTotalFC', 'Total Foreign', 'Total (FC)']),
    label: 'Total (Doc)',
    renderer: 'number',
    storage: 'calculated',
    readOnly: true,
    order: 76,
    width: 120,
  }),
  LocationCode: Object.freeze({
    stateKey: 'locationCode',
    sapField: 'LocationCode',
    databaseField: 'LocCode',
    aliases: Object.freeze(['LocCode', 'Loc.', 'Location']),
    label: 'Loc.',
    renderer: 'text',
    storage: 'display-only',
    readOnly: true,
    order: 105,
    width: 115,
  }),
  CostingCode: Object.freeze({
    stateKey: 'distributionRule',
    sapField: 'CostingCode',
    databaseField: 'OcrCode',
    aliases: Object.freeze(['OcrCode', 'DistributionRule']),
    label: 'Distribution Rule',
    renderer: 'lookup',
    lookupSource: 'distribution-rules',
    order: 80,
    width: 145,
  }),
  CostingCode2: Object.freeze({ stateKey: 'distributionRule2', sapField: 'CostingCode2', databaseField: 'OcrCode2', label: 'Distribution Rule 2', renderer: 'lookup', lookupSource: 'distribution-rules', order: 81, width: 145 }),
  CostingCode3: Object.freeze({ stateKey: 'distributionRule3', sapField: 'CostingCode3', databaseField: 'OcrCode3', label: 'Distribution Rule 3', renderer: 'lookup', lookupSource: 'distribution-rules', order: 82, width: 145 }),
  CostingCode4: Object.freeze({ stateKey: 'distributionRule4', sapField: 'CostingCode4', databaseField: 'OcrCode4', label: 'Distribution Rule 4', renderer: 'lookup', lookupSource: 'distribution-rules', order: 83, width: 145 }),
  CostingCode5: Object.freeze({ stateKey: 'distributionRule5', sapField: 'CostingCode5', databaseField: 'OcrCode5', label: 'Distribution Rule 5', renderer: 'lookup', lookupSource: 'distribution-rules', order: 84, width: 145 }),
  ProjectCode: Object.freeze({ stateKey: 'projectCode', sapField: 'ProjectCode', databaseField: 'Project', label: 'Project', renderer: 'text', order: 85, width: 125 }),
  WTLiable: Object.freeze({ stateKey: 'wtaxLiable', sapField: 'WTLiable', databaseField: 'WTLiable', label: 'WTax Liable', renderer: 'checkbox', type: 'checkbox', order: 86, width: 105 }),
  UoMCode: Object.freeze({
    stateKey: 'uomCode',
    sapField: 'UoMCode',
    databaseField: 'UomCode',
    aliases: Object.freeze(['UomCode', 'unitMsr', 'UoM']),
    label: 'UoM Code',
    renderer: 'lookup',
    lookupSource: 'uom-codes',
    lookupDependsOn: Object.freeze(['itemNo']),
    order: 90,
    width: 115,
  }),
  CountryOrg: Object.freeze({
    stateKey: 'countryOfOrigin',
    sapField: 'CountryOrg',
    databaseField: 'CountryOrg',
    label: 'Country/Region of Origin',
    renderer: 'lookup',
    lookupSource: 'countries',
    order: 100,
    width: 180,
  }),
  HSNEntry: Object.freeze({
    stateKey: 'hsnEntry',
    sapField: 'HSNEntry',
    databaseField: 'HsnEntry',
    aliases: Object.freeze(['HsnEntry', 'HsnCode', 'HSN']),
    label: 'HSN',
    renderer: 'lookup',
    lookupSource: 'hsn-codes',
    order: 110,
    width: 115,
  }),
  SACEntry: Object.freeze({
    stateKey: 'sacEntry',
    sapField: 'SACEntry',
    databaseField: 'SacEntry',
    aliases: Object.freeze(['SacEntry', 'SacCode', 'SAC']),
    label: 'SAC',
    renderer: 'lookup',
    lookupSource: 'sac-codes',
    order: 120,
    width: 115,
  }),
  DiscountPercent: Object.freeze({
    stateKey: 'discountPercent',
    sapField: 'DiscountPercent',
    databaseField: 'DiscPrcnt',
    aliases: Object.freeze(['DiscPrcnt']),
    label: 'Discount %',
    renderer: 'number',
    order: 130,
    width: 105,
  }),
  ShipDate: Object.freeze({
    stateKey: 'deliveryDate',
    sapField: 'ShipDate',
    databaseField: 'ShipDate',
    aliases: Object.freeze(['Del. Date', 'Delivery Date', 'Ship Date']),
    label: 'Del. Date',
    renderer: 'date',
    type: 'date',
    order: 125,
    width: 125,
  }),
  RequiredDate: Object.freeze({
    stateKey: 'requiredDate',
    sapField: 'RequiredDate',
    databaseField: 'ReqDate',
    aliases: Object.freeze(['RequiredDate', 'ReqDate', 'Required Date']),
    label: 'Required Date',
    renderer: 'date',
    type: 'date',
    order: 126,
    width: 125,
  }),
  PackageQuantity: Object.freeze({
    stateKey: 'noOfPackages',
    sapField: 'PackageQuantity',
    databaseField: 'PackQty',
    aliases: Object.freeze(['PackageQuantity', 'PackQty', 'Packages', 'NumOfPacks', 'No. of Packages']),
    label: 'No. of Packages',
    renderer: 'number',
    type: 'number',
    order: 127,
    width: 120,
  }),
  OpenQuantity: Object.freeze({
    stateKey: 'openQty',
    sapField: 'OpenQuantity',
    databaseField: 'OpenQty',
    aliases: Object.freeze(['OpenQty', 'Open Qty', 'Ordered Qty']),
    label: 'Open Qty',
    renderer: 'number',
    storage: 'calculated',
    readOnly: true,
    order: 135,
    width: 105,
  }),
  TaxLiable: Object.freeze({
    stateKey: 'taxLiable',
    sapField: 'TaxLiable',
    databaseField: 'TaxOnly',
    aliases: Object.freeze(['TaxOnly', 'Tax Liable']),
    label: 'Tax Liable',
    renderer: 'checkbox',
    type: 'checkbox',
    order: 137,
    width: 95,
  }),
  TaxAmount: Object.freeze({
    stateKey: 'taxAmount',
    sapField: 'TaxAmount',
    databaseField: 'VatSum',
    aliases: Object.freeze(['VatSum', 'Tax Amount (Doc)', 'Tax Amount (LC)', 'Tax Amount']),
    label: 'Tax Amount (Doc)',
    renderer: 'number',
    storage: 'calculated',
    readOnly: true,
    order: 138,
    width: 125,
  }),
  LineTotal: Object.freeze({
    stateKey: 'lineTotal',
    sapField: 'LineTotal',
    databaseField: 'LineTotal',
    label: 'Total',
    renderer: 'number',
    storage: 'calculated',
    readOnly: true,
    order: 140,
    width: 120,
  }),
});

// SAP B1 service rows use the same physical marketing-document tables as item
// rows, but expose a different matrix and Service Layer write contract.
const SERVICE_DOCUMENT_LINE_STANDARD_FIELDS = Object.freeze({
  LineNum: Object.freeze({ stateKey: 'lineNumber', sapField: 'LineNum', databaseField: 'LineNum', label: '#', renderer: 'integer', type: 'integer', storage: 'display-only', readOnly: true, order: 10, width: 55 }),
  ItemDescription: Object.freeze({ stateKey: 'description', sapField: 'ItemDescription', databaseField: 'Dscription', aliases: Object.freeze(['Description']), label: 'Description', renderer: 'text', required: true, order: 20, width: 240 }),
  AccountCode: Object.freeze({ stateKey: 'glAccount', sapField: 'AccountCode', databaseField: 'AcctCode', aliases: Object.freeze(['Account', 'G/L Account']), label: 'G/L Account', renderer: 'lookup', required: true, order: 30, width: 145 }),
  Quantity: Object.freeze({ stateKey: 'sQty', sapField: 'Quantity', databaseField: 'Quantity', label: 'Quantity', renderer: 'number', order: 40, width: 100 }),
  UnitPrice: Object.freeze({ stateKey: 'unitPrice', sapField: 'UnitPrice', databaseField: 'Price', aliases: Object.freeze(['PriceBefDi']), label: 'Unit Price', renderer: 'number', order: 50, width: 120 }),
  DiscountPercent: Object.freeze({ stateKey: 'discountPercent', sapField: 'DiscountPercent', databaseField: 'DiscPrcnt', label: 'Discount %', renderer: 'number', order: 60, width: 105 }),
  TaxCode: Object.freeze({ stateKey: 'taxCode', sapField: 'TaxCode', databaseField: 'VatGroup', aliases: Object.freeze(['TaxCode']), label: 'Tax Code', renderer: 'lookup', lookupSource: 'tax-codes', required: true, order: 70, width: 120 }),
  CostingCode: Object.freeze({ stateKey: 'distRule', sapField: 'CostingCode', databaseField: 'OcrCode', label: 'Distribution Rule', renderer: 'lookup', lookupSource: 'distribution-rules', order: 80, width: 145 }),
  CostingCode2: Object.freeze({ stateKey: 'distRule2', sapField: 'CostingCode2', databaseField: 'OcrCode2', label: 'Distribution Rule 2', renderer: 'text', order: 90, width: 145 }),
  CostingCode3: Object.freeze({ stateKey: 'distRule3', sapField: 'CostingCode3', databaseField: 'OcrCode3', label: 'Distribution Rule 3', renderer: 'text', order: 100, width: 145 }),
  CostingCode4: Object.freeze({ stateKey: 'distRule4', sapField: 'CostingCode4', databaseField: 'OcrCode4', label: 'Distribution Rule 4', renderer: 'text', order: 110, width: 145 }),
  CostingCode5: Object.freeze({ stateKey: 'distRule5', sapField: 'CostingCode5', databaseField: 'OcrCode5', label: 'Distribution Rule 5', renderer: 'text', order: 120, width: 145 }),
  ProjectCode: Object.freeze({ stateKey: 'projectCode', sapField: 'ProjectCode', databaseField: 'Project', label: 'Project', renderer: 'text', order: 130, width: 125 }),
  WTLiable: Object.freeze({ stateKey: 'wtaxLiable', sapField: 'WTLiable', databaseField: 'WTLiable', label: 'WTax Liable', renderer: 'checkbox', type: 'checkbox', order: 140, width: 105 }),
  SACEntry: Object.freeze({ stateKey: 'sac', sapField: 'SACEntry', databaseField: 'SacEntry', label: 'SAC', renderer: 'lookup', lookupSource: 'sac-codes', order: 150, width: 110 }),
  LocationCode: Object.freeze({ stateKey: 'loc', sapField: 'LocationCode', databaseField: 'LocCode', label: 'Loc.', renderer: 'text', order: 160, width: 115 }),
  AgreementNo: Object.freeze({ stateKey: 'blanketAgreementNo', sapField: 'AgreementNo', databaseField: 'AgrNo', label: 'Blanket Agreement No.', renderer: 'integer', type: 'integer', order: 170, width: 170 }),
  LineTotal: Object.freeze({ stateKey: 'totalLC', sapField: 'LineTotal', databaseField: 'LineTotal', label: 'Total (LC)', renderer: 'number', storage: 'calculated', readOnly: true, order: 180, width: 120 }),
  TotalFrgn: Object.freeze({ stateKey: 'totalDocumentCurrency', sapField: 'RowTotalFC', databaseField: 'TotalFrgn', label: 'Total (Doc)', renderer: 'number', storage: 'calculated', readOnly: true, order: 190, width: 120 }),
  TaxAmount: Object.freeze({ stateKey: 'taxAmountLC', sapField: 'TaxAmount', databaseField: 'VatSum', label: 'Tax Amount (LC)', renderer: 'number', storage: 'calculated', readOnly: true, order: 200, width: 130 }),
});

const LOOKUP_SOURCES = Object.freeze([
  'items',
  'business-partners',
  'warehouses',
  'tax-codes',
  'uom-codes',
  'distribution-rules',
  'sac-codes',
  'hsn-codes',
  'countries',
  'sales-employees',
  'owners',
  'shipping-types',
  'udf-valid-values',
  'sap-user-values',
  'udf-linked-table',
  'udo',
]);

const LOOKUP_SOURCE_SET = new Set(LOOKUP_SOURCES);

const LOOKUP_PAGING = Object.freeze({
  defaultPage: 1,
  defaultLimit: 50,
  maximumLimit: 100,
  maximumSearchLength: 100,
});

const LOOKUP_QUERY_KEYS = Object.freeze([
  'q',
  'query',
  'page',
  'limit',
  'fieldId',
  'schemaVersion',
  'itemCode',
  'documentType',
]);

const FORBIDDEN_SCOPE_KEYS = Object.freeze([
  'company',
  'companyId',
  'company_id',
  'companyDb',
  'company_db',
  'database',
  'databaseName',
  'dbName',
  'sapCompanyDb',
  'userCode',
]);

const FORBIDDEN_LOOKUP_KEYS = Object.freeze([
  'sql',
  'queryText',
  'table',
  'tableName',
  'lookupTable',
  'codeColumn',
  'labelColumn',
]);

const LINKED_TABLE_COLUMN_CANDIDATES = Object.freeze({
  code: Object.freeze([
    'Code',
    'AbsEntry',
    'DocEntry',
    'ItemCode',
    'CardCode',
    'WhsCode',
    'OcrCode',
    'UomCode',
    'BPLId',
    'U_Code',
  ]),
  label: Object.freeze([
    'Name',
    'Descr',
    'Description',
    'Dscription',
    'ItemName',
    'CardName',
    'WhsName',
    'OcrName',
    'UomName',
    'BPLName',
    'U_Name',
  ]),
});

module.exports = {
  AP_CREDIT_MEMO_DOCUMENT,
  AP_INVOICE_DOCUMENT,
  AR_CREDIT_MEMO_DOCUMENT,
  AR_INVOICE_DOCUMENT,
  DELIVERY_DOCUMENT,
  GRPO_DOCUMENT,
  FORBIDDEN_LOOKUP_KEYS,
  FORBIDDEN_SCOPE_KEYS,
  LINKED_TABLE_COLUMN_CANDIDATES,
  LOOKUP_PAGING,
  LOOKUP_QUERY_KEYS,
  LOOKUP_SOURCES,
  LOOKUP_SOURCE_SET,
  SALES_ORDER_DOCUMENT,
  SALES_QUOTATION_DOCUMENT,
  SALES_DOCUMENTS,
  SALES_ORDER_HEADER_STANDARD_FIELDS,
  SALES_ORDER_LINE_STANDARD_FIELDS,
  PURCHASE_DOCUMENT_HEADER_STANDARD_FIELDS,
  PURCHASE_ORDER_DOCUMENT,
  PURCHASE_QUOTATION_DOCUMENT,
  PURCHASE_REQUEST_DOCUMENT,
  SERVICE_DOCUMENT_LINE_STANDARD_FIELDS,
  SERVICE_AP_CREDIT_MEMO_DOCUMENT,
  SERVICE_AP_INVOICE_DOCUMENT,
  SERVICE_AR_CREDIT_MEMO_DOCUMENT,
  SERVICE_AR_INVOICE_DOCUMENT,
  SCHEMA_FORMAT_VERSION,
  resolveSalesDocument,
};
