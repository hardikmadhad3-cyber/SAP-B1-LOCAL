'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDocumentSchema,
  buildSalesOrderSchema,
  createNewSalesOrderSchemaService,
} = require('../modules/newSalesOrder/newSalesOrderSchemaService');
const {
  AR_CREDIT_MEMO_DOCUMENT,
  AR_INVOICE_DOCUMENT,
  DELIVERY_DOCUMENT,
  AP_CREDIT_MEMO_DOCUMENT,
  AP_INVOICE_DOCUMENT,
  GRPO_DOCUMENT,
  PURCHASE_ORDER_DOCUMENT,
  PURCHASE_QUOTATION_DOCUMENT,
  PURCHASE_REQUEST_DOCUMENT,
  SALES_ORDER_DOCUMENT,
  SALES_QUOTATION_DOCUMENT,
  SERVICE_AP_CREDIT_MEMO_DOCUMENT,
  SERVICE_AP_INVOICE_DOCUMENT,
  SERVICE_AR_CREDIT_MEMO_DOCUMENT,
  SERVICE_AR_INVOICE_DOCUMENT,
  resolveSalesDocument,
} = require('../modules/newSalesOrder/newSalesOrderConstants');
const companyA = require('./fixtures/newSalesOrderCompanyA');
const companyB = require('./fixtures/newSalesOrderCompanyB');

const getField = (schema, id) => [...schema.headerFields, ...schema.lineFields]
  .find((field) => field.id === id);

test('resolves the five standard Sales-A/R document profiles', () => {
  const profiles = [
    [SALES_QUOTATION_DOCUMENT, '23', '149', 'OQUT', 'QUT1'],
    [SALES_ORDER_DOCUMENT, '17', '139', 'ORDR', 'RDR1'],
    [DELIVERY_DOCUMENT, '15', '140', 'ODLN', 'DLN1'],
    [AR_INVOICE_DOCUMENT, '13', '133', 'OINV', 'INV1'],
    [AR_CREDIT_MEMO_DOCUMENT, '14', '179', 'ORIN', 'RIN1'],
  ];

  for (const [profile, objectType, formType, headerTable, lineTable] of profiles) {
    assert.equal(resolveSalesDocument(profile.documentType), profile);
    assert.equal(profile.objectType, objectType);
    assert.equal(profile.formType, formType);
    assert.equal(profile.headerTable, headerTable);
    assert.equal(profile.lineTable, lineTable);
  }
});

test('resolves all four SAP service-document profiles', () => {
  const profiles = [
    [SERVICE_AR_INVOICE_DOCUMENT, '13', 'OINV', 'INV1'],
    [SERVICE_AR_CREDIT_MEMO_DOCUMENT, '14', 'ORIN', 'RIN1'],
    [SERVICE_AP_INVOICE_DOCUMENT, '18', 'OPCH', 'PCH1'],
    [SERVICE_AP_CREDIT_MEMO_DOCUMENT, '19', 'ORPC', 'RPC1'],
  ];

  for (const [profile, objectType, headerTable, lineTable] of profiles) {
    assert.equal(resolveSalesDocument(profile.documentType), profile);
    assert.equal(profile.objectType, objectType);
    assert.equal(profile.headerTable, headerTable);
    assert.equal(profile.lineTable, lineTable);
    assert.equal(profile.serviceLineMode, true);
  }
});

test('resolves all six SAP item purchase-document profiles', () => {
  const profiles = [
    [PURCHASE_REQUEST_DOCUMENT, '1470000113', '1470000200', 'OPRQ', 'PRQ1'],
    [PURCHASE_QUOTATION_DOCUMENT, '540000006', '540000988', 'OPQT', 'PQT1'],
    [PURCHASE_ORDER_DOCUMENT, '22', '142', 'OPOR', 'POR1'],
    [GRPO_DOCUMENT, '20', '143', 'OPDN', 'PDN1'],
    [AP_INVOICE_DOCUMENT, '18', '141', 'OPCH', 'PCH1'],
    [AP_CREDIT_MEMO_DOCUMENT, '19', '181', 'ORPC', 'RPC1'],
  ];

  for (const [profile, objectType, formType, headerTable, lineTable] of profiles) {
    assert.equal(resolveSalesDocument(profile.documentType), profile);
    assert.equal(profile.objectType, objectType);
    assert.equal(profile.formType, formType);
    assert.equal(profile.headerTable, headerTable);
    assert.equal(profile.lineTable, lineTable);
    assert.equal(profile.purchaseDocument, true);
    assert.equal(profile.serviceLineMode, undefined);
  }
});

test('service schemas expose service standards and only current-company UDFs', () => {
  for (const profile of [
    SERVICE_AR_INVOICE_DOCUMENT,
    SERVICE_AR_CREDIT_MEMO_DOCUMENT,
    SERVICE_AP_INVOICE_DOCUMENT,
    SERVICE_AP_CREDIT_MEMO_DOCUMENT,
  ]) {
    const metadata = {
      dialect: 'hana',
      physical: {
        [profile.headerTable]: [{ columnName: 'CardCode', databaseType: 'nvarchar', ordinal: 1 }],
        [profile.lineTable]: [
          { columnName: 'ItemCode', databaseType: 'nvarchar', ordinal: 1 },
          { columnName: 'Dscription', databaseType: 'nvarchar', ordinal: 2 },
          { columnName: 'AcctCode', databaseType: 'nvarchar', ordinal: 3 },
          { columnName: 'Price', databaseType: 'decimal', ordinal: 4 },
          { columnName: 'VatGroup', databaseType: 'nvarchar', ordinal: 5 },
          { columnName: 'LineTotal', databaseType: 'decimal', ordinal: 6 },
          { columnName: 'U_CurrentCompany', databaseType: 'nvarchar', ordinal: 7 },
        ],
      },
      udfs: {
        [profile.headerTable]: [],
        [profile.lineTable]: [{
          tableName: profile.lineTable,
          fieldId: 1,
          aliasId: 'CurrentCompany',
          sapField: 'U_CurrentCompany',
          label: 'Current Company',
          typeId: 'A',
          options: [],
        }],
      },
      layout: [
        {
          tableName: profile.lineTable,
          columnUid: 'ItemCode',
          fieldName: 'ItemCode',
          columnTitle: 'Item No.',
          visible: 1,
          editable: 1,
          columnOrder: 1,
        },
        {
          tableName: profile.lineTable,
          columnUid: 'U_Deleted',
          fieldName: 'U_Deleted',
          columnTitle: 'Deleted',
          visible: 1,
          editable: 1,
          isUdf: 1,
          columnOrder: 99,
        },
      ],
    };

    const schema = buildDocumentSchema({ context: companyA.context, metadata, rawDocument: profile });
    assert.equal(getField(schema, `${profile.lineTable}.Dscription`).stateKey, 'description');
    assert.equal(getField(schema, `${profile.lineTable}.AcctCode`).stateKey, 'glAccount');
    assert.equal(getField(schema, `${profile.lineTable}.LineTotal`).readOnly, true);
    assert.ok(getField(schema, `${profile.lineTable}.U_CurrentCompany`));
    assert.equal(schema.lineFields.some((field) => field.sapField === 'U_Deleted'), false);
    assert.equal(schema.lineFields.some((field) => field.sapField === 'ItemCode'), false);
  }
});

test('builds live standard and UDF fields against every document profile table pair', () => {
  const profiles = [
    SALES_QUOTATION_DOCUMENT,
    SALES_ORDER_DOCUMENT,
    DELIVERY_DOCUMENT,
    AR_INVOICE_DOCUMENT,
    AR_CREDIT_MEMO_DOCUMENT,
    PURCHASE_REQUEST_DOCUMENT,
    PURCHASE_QUOTATION_DOCUMENT,
    PURCHASE_ORDER_DOCUMENT,
    GRPO_DOCUMENT,
    AP_INVOICE_DOCUMENT,
    AP_CREDIT_MEMO_DOCUMENT,
  ];

  for (const profile of profiles) {
    const metadata = {
      dialect: 'hana',
      physical: {
        [profile.headerTable]: [{ columnName: 'CardCode', databaseType: 'nvarchar', ordinal: 1 }],
        [profile.lineTable]: [
          { columnName: 'ItemCode', databaseType: 'nvarchar', ordinal: 1 },
          { columnName: 'U_LiveLine', databaseType: 'nvarchar', ordinal: 2 },
        ],
      },
      udfs: {
        [profile.headerTable]: [],
        [profile.lineTable]: [{
          tableName: profile.lineTable,
          fieldId: 1,
          aliasId: 'LiveLine',
          sapField: 'U_LiveLine',
          label: 'Live Line',
          typeId: 'A',
          options: [],
        }],
      },
      layout: [],
    };
    const schema = buildDocumentSchema({ context: companyA.context, metadata, rawDocument: profile });
    assert.equal(schema.headerTable, profile.headerTable);
    assert.equal(schema.lineTable, profile.lineTable);
    assert.ok(getField(schema, `${profile.lineTable}.U_LiveLine`));
    assert.equal(schema.lineFields.some((field) => field.id.startsWith('RDR1.')),
      profile.lineTable === 'RDR1');
  }
});

test('QUT1 ReqDate is an editable RequiredDate field only when physically present', () => {
  const metadata = {
    dialect: 'sqlserver',
    physical: {
      OQUT: [{ columnName: 'CardCode', databaseType: 'nvarchar', ordinal: 1 }],
      QUT1: [
        { columnName: 'ItemCode', databaseType: 'nvarchar', ordinal: 1 },
        { columnName: 'ReqDate', databaseType: 'date', ordinal: 2 },
      ],
      OINV: [{ columnName: 'CardCode', databaseType: 'nvarchar', ordinal: 1 }],
      INV1: [{ columnName: 'ItemCode', databaseType: 'nvarchar', ordinal: 1 }],
    },
    udfs: { OQUT: [], QUT1: [], OINV: [], INV1: [] },
    layout: [],
  };
  const quotation = buildDocumentSchema({
    context: companyA.context,
    metadata,
    rawDocument: SALES_QUOTATION_DOCUMENT,
  });
  const invoice = buildDocumentSchema({
    context: companyA.context,
    metadata,
    rawDocument: AR_INVOICE_DOCUMENT,
  });
  const requiredDate = getField(quotation, 'QUT1.ReqDate');

  assert.deepEqual({
    stateKey: requiredDate.stateKey,
    sapField: requiredDate.sapField,
    renderer: requiredDate.renderer,
    editable: requiredDate.editable,
  }, {
    stateKey: 'requiredDate',
    sapField: 'RequiredDate',
    renderer: 'date',
    editable: true,
  });
  assert.equal(invoice.lineFields.some((field) => field.sapField === 'RequiredDate'), false);
});

test('builds an isolated Delivery schema from ODLN and DLN1 metadata', () => {
  const context = { ...companyA.context, companyDb: 'DELIVERY_COMPANY', companyId: 303 };
  const metadata = {
    dialect: 'sqlserver',
    physical: {
      ODLN: [
        { columnName: 'CardCode', databaseType: 'nvarchar', maxLength: 15, ordinal: 1 },
        { columnName: 'U_DeliveryRoute', databaseType: 'nvarchar', maxLength: 30, ordinal: 2 },
      ],
      DLN1: [
        { columnName: 'ItemCode', databaseType: 'nvarchar', maxLength: 50, ordinal: 1 },
        { columnName: 'U_LoadSequence', databaseType: 'int', ordinal: 2 },
      ],
    },
    udfs: {
      ODLN: [{ sapField: 'U_DeliveryRoute', aliasId: 'DeliveryRoute', label: 'Delivery Route', options: [] }],
      DLN1: [{ sapField: 'U_LoadSequence', aliasId: 'LoadSequence', label: 'Load Sequence', typeId: 'N', subType: '', options: [] }],
    },
    layout: [],
  };

  const schema = buildDocumentSchema({ context, metadata, rawDocument: DELIVERY_DOCUMENT });
  assert.equal(schema.documentType, 'DELIVERY');
  assert.equal(schema.objectType, '15');
  assert.equal(schema.headerTable, 'ODLN');
  assert.equal(schema.lineTable, 'DLN1');
  assert.equal(schema.companyDb, 'DELIVERY_COMPANY');
  assert.ok(getField(schema, 'ODLN.U_DeliveryRoute'));
  assert.equal(getField(schema, 'DLN1.U_LoadSequence').type, 'integer');
  assert.equal(schema.lineFields.some((field) => field.id.startsWith('RDR1.')), false);
});

test('normalizes Company A physical fields, CUFD, UFD1, and layout into one schema', () => {
  const schema = buildSalesOrderSchema({ context: companyA.context, metadata: companyA.metadata });

  assert.equal(schema.documentType, 'SALES_ORDER');
  assert.equal(schema.objectType, '17');
  assert.equal(schema.companyId, 101);
  assert.equal(schema.companyDb, 'NSO_COMPANY_A');
  assert.equal(schema.userCode, 'manager_a');
  assert.match(schema.schemaVersion, /^nso-schema-v1-[a-f0-9]{24}$/);

  const packing = getField(schema, 'RDR1.U_PackingType');
  assert.equal(packing.storage, 'udf');
  assert.equal(packing.type, 'select');
  assert.equal(packing.renderer, 'select');
  assert.deepEqual(packing.options[0], { value: 'BOX', label: 'Box' });
  assert.equal(packing.lookup.source, 'udf-valid-values');

  const grossWeight = getField(schema, 'RDR1.U_GrossWt');
  assert.equal(grossWeight.type, 'number');
  assert.equal(grossWeight.precision, 19);
  assert.equal(grossWeight.scale, 6);
  assert.equal(grossWeight.step, '0.000001');

  const totalPackages = getField(schema, 'RDR1.U_TotalPackage');
  assert.equal(totalPackages.type, 'integer');
  assert.equal(totalPackages.required, true);

  const linked = getField(schema, 'RDR1.U_ContainerType');
  assert.equal(linked.type, 'lookup');
  assert.equal(linked.lookup.source, 'udf-linked-table');
  assert.equal(linked.lookup.fieldId, linked.id);
  assert.equal(linked.linkedTable, '@NSO_CONTAINER_TYPES');
});

test('Company schemas stay isolated and switching removes incompatible UDFs', () => {
  const schemaA = buildSalesOrderSchema({ context: companyA.context, metadata: companyA.metadata });
  const schemaB = buildSalesOrderSchema({ context: companyB.context, metadata: companyB.metadata });
  const idsA = new Set(schemaA.lineFields.map((field) => field.id));
  const idsB = new Set(schemaB.lineFields.map((field) => field.id));

  assert.equal(idsA.has('RDR1.U_GrossWt'), true);
  assert.equal(idsA.has('RDR1.U_Quality'), false);
  assert.equal(idsB.has('RDR1.U_GrossWt'), false);
  assert.equal(idsB.has('RDR1.U_TotalPackage'), false);
  assert.equal(idsB.has('RDR1.U_Quality'), true);
  assert.notEqual(schemaA.schemaVersion, schemaB.schemaVersion);

  assert.equal(getField(schemaB, 'RDR1.U_ExpectedDate').type, 'date');
  assert.equal(getField(schemaB, 'RDR1.U_Approved').type, 'checkbox');
  assert.equal(getField(schemaB, 'RDR1.U_Quality').lookup.source, 'udf-linked-table');
});

test('a newly added physical CUFD field appears without a registry or JSX change', () => {
  const metadata = structuredClone(companyA.metadata);
  metadata.physical.RDR1.push({
    columnName: 'U_NewCompanyField',
    databaseType: 'nvarchar',
    maxLength: 40,
    precision: null,
    scale: null,
    nullable: true,
    ordinal: 12,
  });
  metadata.udfs.RDR1.push({
    tableName: 'RDR1',
    fieldId: 5,
    aliasId: 'NewCompanyField',
    sapField: 'U_NewCompanyField',
    label: 'New Company Field',
    typeId: 'A',
    subType: '',
    maxLength: 40,
    required: false,
    readOnly: false,
    linkedTable: null,
    relUDO: null,
    defaultValue: null,
    options: [],
  });

  const schema = buildSalesOrderSchema({ context: companyA.context, metadata });
  const field = getField(schema, 'RDR1.U_NewCompanyField');
  assert.ok(field);
  assert.equal(field.sapField, 'U_NewCompanyField');
  assert.equal(field.stateKey, 'U_NewCompanyField');
  assert.equal(field.storage, 'udf');
  assert.equal(field.type, 'text');
});

test('stale layout UDF rows are dropped unless the current company table confirms them', () => {
  const metadata = structuredClone(companyA.metadata);
  metadata.layout.push(
    {
      tableName: 'RDR1',
      columnUid: 'U_DeletedCompanyField',
      fieldName: 'U_DeletedCompanyField',
      columnTitle: 'Deleted Company Field',
      visible: 1,
      editable: 1,
      isUdf: 1,
      columnOrder: 900,
    },
    {
      tableName: 'RDR1',
      columnUid: 'LegacyDisplayOnly',
      fieldName: 'LegacyDisplayOnly',
      columnTitle: 'Legacy Display Only',
      visible: 1,
      editable: 0,
      columnOrder: 901,
    },
  );

  const schema = buildSalesOrderSchema({ context: companyA.context, metadata });
  assert.equal(schema.lineFields.some((field) => field.sapField === 'U_DeletedCompanyField'), false);
  assert.ok(schema.lineFields.find((field) => field.sapField === 'LegacyDisplayOnly'));
});

test('standard semantic mappings use Service Layer properties but retain physical DB columns', () => {
  const schema = buildSalesOrderSchema({ context: companyA.context, metadata: companyA.metadata });
  const itemDescription = getField(schema, 'RDR1.Dscription');
  const warehouse = getField(schema, 'RDR1.WhsCode');

  assert.equal(itemDescription.stateKey, 'itemDescription');
  assert.equal(itemDescription.sapField, 'ItemDescription');
  assert.equal(itemDescription.databaseField, 'Dscription');
  assert.equal(warehouse.sapField, 'WarehouseCode');
  assert.equal(warehouse.lookup.source, 'warehouses');
});

test('maps the SAP TotalFrgn database column as a calculated document-currency total', () => {
  const metadata = structuredClone(companyA.metadata);
  metadata.physical.RDR1.push({
    columnName: 'TotalFrgn',
    databaseType: 'decimal',
    precision: 19,
    scale: 6,
    ordinal: 12,
  });
  const schema = buildSalesOrderSchema({ context: companyA.context, metadata });
  const total = getField(schema, 'RDR1.TotalFrgn');
  assert.ok(total);
  assert.equal(total.sapField, 'RowTotalFC');
  assert.equal(total.storage, 'calculated');
  assert.equal(total.readOnly, true);
});

test('RDR1 schema preserves SAP matrix layout order for standard layout-only fields', () => {
  const metadata = structuredClone(companyA.metadata);
  metadata.physical.RDR1.push(
    { columnName: 'GTotal', databaseType: 'decimal', maxLength: null, precision: 19, scale: 6, nullable: true, ordinal: 12 },
    { columnName: 'CountryOrg', databaseType: 'nvarchar', maxLength: 3, precision: null, scale: null, nullable: true, ordinal: 13 },
    { columnName: 'LocCode', databaseType: 'int', maxLength: null, precision: 10, scale: 0, nullable: true, ordinal: 14 },
    { columnName: 'ShipDate', databaseType: 'date', maxLength: null, precision: null, scale: null, nullable: true, ordinal: 15 },
    { columnName: 'TrnsCode', databaseType: 'int', maxLength: null, precision: 10, scale: 0, nullable: true, ordinal: 16 },
    { columnName: 'TaxOnly', databaseType: 'nvarchar', maxLength: 1, precision: null, scale: null, nullable: true, ordinal: 17 },
    { columnName: 'VatSum', databaseType: 'decimal', maxLength: null, precision: 19, scale: 6, nullable: true, ordinal: 18 },
    { columnName: 'OpenQty', databaseType: 'decimal', maxLength: null, precision: 19, scale: 6, nullable: true, ordinal: 19 },
  );
  metadata.layout = [
    { tableName: 'RDR1', columnUid: 'ItemCode', fieldName: 'ItemCode', columnTitle: 'Item No.', visible: 1, editable: 1, columnOrder: 1, width: 160 },
    { tableName: 'RDR1', columnUid: 'Dscription', fieldName: 'Dscription', columnTitle: 'Item Description', visible: 1, editable: 1, columnOrder: 2, width: 240 },
    { tableName: 'RDR1', columnUid: 'Quantity', fieldName: 'Quantity', columnTitle: 'Quantity', visible: 1, editable: 1, columnOrder: 3, width: 100 },
    { tableName: 'RDR1', columnUid: 'Price', fieldName: 'Price', columnTitle: 'Unit Price', visible: 1, editable: 1, columnOrder: 4, width: 110 },
    { tableName: 'RDR1', columnUid: 'VatGroup', fieldName: 'VatGroup', columnTitle: 'Tax Code', visible: 1, editable: 1, columnOrder: 5, width: 110 },
    { tableName: 'RDR1', columnUid: 'GTotal', fieldName: 'GTotal', columnTitle: 'Total (Doc)', visible: 1, editable: 0, columnOrder: 6, width: 120 },
    { tableName: 'RDR1', columnUid: 'CountryOrg', fieldName: 'CountryOrg', columnTitle: 'Country/Region of Origin', visible: 1, editable: 1, columnOrder: 7, width: 180 },
    { tableName: 'RDR1', columnUid: 'LocCode', fieldName: 'LocCode', columnTitle: 'Loc.', visible: 1, editable: 0, columnOrder: 8, width: 100 },
    { tableName: 'RDR1', columnUid: 'ShipDate', fieldName: 'ShipDate', columnTitle: 'Del. Date', visible: 1, editable: 1, columnOrder: 9, width: 120 },
    { tableName: 'RDR1', columnUid: 'TrnsCode', fieldName: 'TrnsCode', columnTitle: 'Shipping Type', visible: 1, editable: 1, columnOrder: 10, width: 120 },
    { tableName: 'RDR1', columnUid: 'OpenQty', fieldName: 'OpenQty', columnTitle: 'Open Qty', visible: 1, editable: 0, columnOrder: 11, width: 100 },
    { tableName: 'RDR1', columnUid: 'TaxOnly', fieldName: 'TaxOnly', columnTitle: 'Tax Liable', visible: 1, editable: 1, columnOrder: 12, width: 95 },
    { tableName: 'RDR1', columnUid: 'VatSum', fieldName: 'VatSum', columnTitle: 'Tax Amount (Doc)', visible: 1, editable: 0, columnOrder: 13, width: 125 },
    { tableName: 'RDR1', columnUid: 'unitMsr', fieldName: 'unitMsr', columnTitle: 'UoM Name', visible: 1, editable: 0, columnOrder: 14, width: 120 },
  ];

  const schema = buildSalesOrderSchema({ context: companyA.context, metadata });
  const labels = schema.lineFields.filter((field) => field.visible !== false).map((field) => field.label);

  assert.deepEqual(labels, [
    'Item No.',
    'Item Description',
    'Quantity',
    'Unit Price',
    'Tax Code',
    'Total (Doc)',
    'Country/Region of Origin',
    'Loc.',
    'Del. Date',
    'Shipping Type',
    'Open Qty',
    'Tax Liable',
    'Tax Amount (Doc)',
    'UoM Name',
  ]);
  assert.equal(getField(schema, 'RDR1.TrnsCode').lookup.source, 'shipping-types');
  assert.equal(getField(schema, 'RDR1.TaxOnly').renderer, 'checkbox');
  assert.equal(getField(schema, 'RDR1.GTotal').readOnly, true);
});

test('schema service exposes getCurrentSchema alias for dummy validation integration', async () => {
  const service = createNewSalesOrderSchemaService({
    repository: { getSalesOrderMetadata: async () => companyB.metadata },
  });
  const schema = await service.getCurrentSchema(companyB.context);
  assert.equal(schema.companyDb, 'NSO_COMPANY_B');
  assert.ok(Array.isArray(schema.headerFields));
  assert.ok(Array.isArray(schema.lineFields));
});

test('document line matrices expose only the SAP B1 Distribution Rule column, not Distribution Rule 2-5', () => {
  const constants = require('../modules/newSalesOrder/newSalesOrderConstants');
  for (const fields of [constants.SALES_ORDER_LINE_STANDARD_FIELDS, constants.SERVICE_DOCUMENT_LINE_STANDARD_FIELDS]) {
    assert.ok(fields.CostingCode, 'Distribution Rule stays');
    for (const n of [2, 3, 4, 5]) assert.equal(fields[`CostingCode${n}`], undefined);
  }
});
