import { buildDeliveryLiveMatrixColumns, normalizeDeliveryMatrixColumn } from './deliveryLiveMatrix';

test('missing Delivery quantities appear after Quantity with distinct read-only SAP mappings', () => {
  const columns = buildDeliveryLiveMatrixColumns({ referenceMatrixColumns: [
    { key: 'quantity', label: 'Quantity', order: 10 },
    { key: 'unitPrice', label: 'Unit Price', order: 11 },
  ] });
  expect(columns.map(column => column.key)).toEqual(['quantity', 'qtyToShip', 'orderedQty', 'unitPrice']);
  expect(columns[1]).toMatchObject({ sapField: 'QtyToShip', valueKey: 'qtyToShip', readOnly: true, visible: true });
  expect(columns[2]).toMatchObject({ sapField: 'OrderedQty', valueKey: 'orderedQty', readOnly: true, visible: true });
  expect(columns[1].order).toBeGreaterThan(columns[0].order);
  expect(columns[2].order).toBeLessThan(columns[3].order);
  expect(normalizeDeliveryMatrixColumn({key:'deliveredQty', label:'Qty to Ship'}).valueKey).toBe('qtyToShip');
});

test('Delivery balance caption does not display the Delivery open quantity', () => {
  expect(normalizeDeliveryMatrixColumn({ label: 'Bal Qty', key: 'OpenQty' })).toMatchObject({
    valueKey: 'balanceQty', readOnly: true,
  });
});

const standardField = (sapField, stateKey, label, order, extra = {}) => ({
  id: `DLN1.${sapField}`,
  tableName: 'DLN1',
  sapField,
  databaseField: sapField,
  stateKey,
  label,
  type: 'text',
  renderer: sapField === 'ItemCode' ? 'item-lookup' : 'text',
  storage: 'standard',
  visible: true,
  editable: true,
  readOnly: false,
  order,
  width: 140,
  ...extra,
});

const udfField = (sapField, label, order, extra = {}) => ({
  id: `DLN1.${sapField}`,
  tableName: 'DLN1',
  sapField,
  databaseField: sapField,
  stateKey: sapField,
  label,
  type: 'text',
  renderer: 'text',
  storage: 'udf',
  visible: true,
  editable: true,
  readOnly: false,
  order,
  width: 150,
  options: [],
  ...extra,
});

test('uses only the active Delivery company schema and preserves live lookup metadata', () => {
  const companyAFields = [
    standardField('ItemCode', 'itemNo', 'Item No.', 1),
    udfField('U_AgentMaster', 'Agent Master', 2, {
      lookup: { source: 'udf-linked-table', fieldId: 'DLN1.U_AgentMaster' },
      lookupSource: 'udf-linked-table',
    }),
  ];
  const referenceColumns = [
    { key: 'itemNo', label: 'Item No.', minWidth: 160 },
    { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 140 },
    { key: 'U_OtherCompanyOnly', label: 'Other Company Only', minWidth: 150, isUdf: true },
  ];
  const rowUdfFields = [{
    key: 'U_AgentMaster',
    label: 'Agent Master',
    lookupSource: 'udf:DLN1:U_AgentMaster',
    lookup: { source: 'udf-linked-table', fieldId: 'DLN1.U_AgentMaster' },
  }];

  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: companyAFields,
    referenceMatrixColumns: referenceColumns,
    rowUdfFields,
  });

  expect(columns.map((column) => column.label)).toEqual(['Item No.', 'Agent Master']);
  expect(columns.find((column) => column.label === 'Agent Master')).toMatchObject({
    valueKey: 'U_AgentMaster',
    isUdf: true,
    lookup: { source: 'udf-linked-table', fieldId: 'DLN1.U_AgentMaster' },
  });
  expect(columns.some((column) => column.label === 'Other Company Only')).toBe(false);
  expect(columns.some((column) => column.label === 'Seller Brokerage')).toBe(false);
});

test('keeps SAP Delivery calculated columns when CPRF exposes only captions and numeric UIDs', () => {
  // These arbitrary numeric values exercise caption resolution; they are not
  // asserted SAP B1 column IDs.
  const columns = buildDeliveryLiveMatrixColumns({
    layoutColumns: [
      { columnUid: '160', fieldName: '160', columnTitle: 'Tax Code', columnOrder: 6, visible: true, editable: true },
      { columnUid: '17', fieldName: '17', columnTitle: 'Total (Doc)', columnOrder: 7, visible: true, editable: false },
      { columnUid: '29', fieldName: '29', columnTitle: 'COGS Distr. Rule', columnOrder: 10, visible: true, editable: false },
      { columnUid: '900000001', fieldName: '900000001', columnTitle: 'In Stock', columnOrder: 29, visible: true, editable: false },
      { columnUid: '1470002145', fieldName: '1470002145', columnTitle: 'UoM Name', columnOrder: 30, visible: true, editable: false },
      { columnUid: '900000002', fieldName: '900000002', columnTitle: 'Qty in Whse', columnOrder: 31, visible: true, editable: false },
    ],
  });

  expect(columns.map(({ key, order }) => [key, order])).toEqual([
    ['taxCode', 6],
    ['grossTotal', 7],
    ['cogsDistRule', 10],
    ['inStock', 29],
    ['uomName', 30],
    ['qtyInWhse', 31],
  ]);
});

test('does not retain fields when switching to another Delivery company schema', () => {
  const companyBFields = [
    standardField('ItemCode', 'itemNo', 'Item No.', 1),
    udfField('U_MillName', 'Mill-Name', 2),
  ];

  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: companyBFields,
    referenceMatrixColumns: [{ key: 'U_AgentMaster', label: 'Agent Master', isUdf: true }],
    rowUdfFields: [{ key: 'U_MillName', label: 'Mill-Name' }],
  });

  expect(columns.map((column) => column.label)).toEqual(['Item No.', 'Mill-Name']);
  expect(columns.some((column) => column.label === 'Agent Master')).toBe(false);
});

test('keeps linked-table metadata when the company SAP layout controls the Delivery order', () => {
  const agentSchemaField = udfField('U_AgentMaster', 'Agent Master', 2, {
    lookup: { source: 'udo', fieldId: 'DLN1.U_AgentMaster' },
    relUDO: 'AGENT_MASTER',
  });

  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      standardField('ItemCode', 'itemNo', 'Item No.', 1),
      agentSchemaField,
    ],
    referenceMatrixColumns: [{ key: 'itemNo', label: 'Item No.', minWidth: 160 }],
    rowUdfFields: [{
      key: 'U_AgentMaster',
      sapField: 'U_AgentMaster',
      label: 'Agent Master',
      lookupSource: 'udf:DLN1:U_AgentMaster',
    }],
    layoutColumns: [
      { fieldName: 'ItemCode', columnTitle: 'Item No.', visible: true, editable: true, columnOrder: 1 },
      { fieldName: 'U_AgentMaster', columnTitle: 'Agent Master', visible: true, editable: true, isUdf: true, columnOrder: 2 },
      { fieldName: 'U_OtherCompanyOnly', columnTitle: 'Other Company Only', visible: true, editable: true, isUdf: true, columnOrder: 3 },
    ],
  });

  expect(columns.map((column) => column.label)).toEqual(['Item No.', 'Agent Master']);
  expect(columns[1]).toMatchObject({
    lookupSource: 'udf:DLN1:U_AgentMaster',
    field: {
      lookup: { source: 'udo', fieldId: 'DLN1.U_AgentMaster' },
      relUDO: 'AGENT_MASTER',
    },
  });
});

test('filters legacy fallback UDF columns against the active Delivery company metadata', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    referenceMatrixColumns: [
      { key: 'itemNo', label: 'Item No.', sapField: 'ItemCode' },
      { key: 'sellerBrokerage', label: 'Seller Brokerage', sapField: 'U_Brok_Seller', isUdfBacked: true },
      { key: 'U_MillName', label: 'Mill-Name', sapField: 'U_MillName', isUdf: true },
    ],
    rowUdfFields: [{ key: 'U_MillName', label: 'Mill-Name' }],
  });

  expect(columns.map((column) => column.label)).toEqual(['Item No.', 'Mill-Name']);
  expect(columns.some((column) => column.label === 'Seller Brokerage')).toBe(false);
});

test('uses the live schema field type when a SAP layout UID is attached to the wrong title', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      standardField('Price', 'unitPrice', 'Unit Price', 1, { type: 'number', renderer: 'number' }),
      standardField('ShipDate', 'lineDeliveryDate', 'Delivery Date', 2, { type: 'date', renderer: 'date' }),
    ],
    referenceMatrixColumns: [
      { key: 'unitPrice', label: 'Unit Price', type: 'number', numeric: true },
      { key: 'lineDeliveryDate', label: 'Delivery Date', type: 'date' },
    ],
    layoutColumns: [
      {
        fieldName: 'ShipDate',
        columnUid: '14',
        columnTitle: 'Unit Price',
        visible: true,
        editable: true,
        isUdf: true,
        columnOrder: 1,
        dataType: 'date',
      },
    ],
  });

  expect(columns).toHaveLength(1);
  expect(columns[0]).toMatchObject({
    key: 'unitPrice',
    valueKey: 'unitPrice',
    rendererKey: 'unitPrice',
    type: 'number',
    numeric: true,
    label: 'Unit Price',
  });
});

test('resolves Unit Price by semantic caption even when the live schema caption is also misbound', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      standardField('Price', 'unitPrice', 'Unit Price', 1, { type: 'number', renderer: 'number' }),
      standardField('ShipDate', 'lineDeliveryDate', 'Unit Price', 2, { type: 'date', renderer: 'date' }),
    ],
    referenceMatrixColumns: [
      { key: 'unitPrice', label: 'Unit Price', type: 'number', numeric: true },
      { key: 'lineDeliveryDate', label: 'Delivery Date', type: 'date' },
    ],
    layoutColumns: [
      {
        fieldName: 'ShipDate',
        columnUid: '14',
        columnTitle: 'Unit Price',
        visible: true,
        editable: true,
        columnOrder: 1,
        dataType: 'date',
      },
    ],
  });

  expect(columns).toHaveLength(1);
  expect(columns[0]).toMatchObject({
    key: 'unitPrice',
    valueKey: 'unitPrice',
    rendererKey: 'unitPrice',
    fieldName: 'Price',
    type: 'number',
    numeric: true,
    isUdf: false,
    label: 'Unit Price',
  });
  expect(columns[0].minWidth).toBeGreaterThanOrEqual(110);
});

test('does not reinterpret a company UDF from its caption', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      udfField('U_QuotedDate', 'Quoted Date', 1, { type: 'date', renderer: 'date' }),
    ],
    rowUdfFields: [
      { key: 'U_QuotedDate', sapField: 'U_QuotedDate', label: 'Quoted Date', type: 'date' },
    ],
    layoutColumns: [
      {
        fieldName: 'U_QuotedDate',
        columnTitle: 'Quoted Date',
        visible: true,
        editable: true,
        isUdf: true,
        columnOrder: 1,
        dataType: 'date',
      },
    ],
  });

  expect(columns).toHaveLength(1);
  expect(columns[0]).toMatchObject({
    key: 'U_QuotedDate',
    valueKey: 'U_QuotedDate',
    rendererKey: 'U_QuotedDate',
    isUdf: true,
    type: 'date',
  });
});

test('keeps standard Item Description separate from a U_Description field in SAP order', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      standardField('Dscription', 'itemDescription', 'Item Description', 2),
      udfField('U_Description', 'Description', 44),
    ],
    rowUdfFields: [
      { key: 'U_Description', sapField: 'U_Description', label: 'Description', type: 'text' },
    ],
    layoutColumns: [
      { fieldName: 'Dscription', columnTitle: 'Item Description', visible: true, editable: true, columnOrder: 2 },
      { fieldName: 'U_Description', columnTitle: 'Description', visible: true, editable: true, isUdf: true, columnOrder: 44 },
    ],
  });

  expect(columns.map((column) => [column.key, column.label, column.order])).toEqual([
    ['itemDescription', 'Item Description', 2],
    ['U_Description', 'Description', 44],
  ]);
});

test('uses SAP control types for standard Delivery checkbox fields', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      standardField('WtLiable', 'wTaxLiable', 'WTax Liable', 1),
      standardField('TaxOnly', 'taxLiable', 'Tax Liable', 2),
    ],
    layoutColumns: [
      { fieldName: 'WtLiable', columnTitle: 'WTax Liable', visible: true, editable: true, columnOrder: 1 },
      { fieldName: 'TaxOnly', columnTitle: 'Tax Liable', visible: true, editable: true, columnOrder: 2 },
    ],
  });

  expect(columns).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'wTaxLiable', type: 'checkbox' }),
    expect.objectContaining({ key: 'taxLiable', type: 'checkbox' }),
  ]));
});

test('removes the legacy duplicate Unit Price UDF and keeps the standard numeric field', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      standardField('Price', 'unitPrice', 'Unit Price', 1, { type: 'number', renderer: 'number' }),
      udfField('U_Unit_Price', 'Unit Price', 2, { type: 'date', renderer: 'date' }),
    ],
    referenceMatrixColumns: [
      { key: 'unitPrice', label: 'Unit Price', sapField: 'Price', type: 'number', numeric: true },
    ],
    rowUdfFields: [
      { key: 'U_Unit_Price', sapField: 'U_Unit_Price', label: 'Unit Price', type: 'date' },
    ],
    layoutColumns: [
      { fieldName: 'Price', columnTitle: 'Unit Price', visible: true, editable: true, columnOrder: 1, dataType: 'number' },
      { fieldName: 'U_Unit_Price', columnTitle: 'Unit Price', visible: true, editable: true, isUdf: true, columnOrder: 2, dataType: 'date' },
    ],
  });

  expect(columns).toHaveLength(1);
  expect(columns[0]).toMatchObject({
    key: 'unitPrice',
    rendererKey: 'unitPrice',
    type: 'number',
    isUdf: false,
  });
});

test('preserves live SAP Delivery visibility, Active state, order, and width', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      standardField('Price', 'unitPrice', 'Unit Price', 1, { type: 'number', renderer: 'number' }),
      standardField('HsnEntry', 'hsnCode', 'HSN', 2, { editable: false, readOnly: true }),
    ],
    referenceMatrixColumns: [
      { key: 'unitPrice', label: 'Unit Price', type: 'number', numeric: true },
      { key: 'hsnCode', label: 'HSN', type: 'text' },
    ],
    layoutColumns: [
      { fieldName: 'Price', columnTitle: 'Unit Price', visible: true, editable: true, columnOrder: 4, width: 110, dataType: 'number' },
      { fieldName: 'HsnEntry', columnTitle: 'HSN', visible: false, editable: true, columnOrder: 16, width: 95, dataType: 'string' },
    ],
  });

  expect(columns).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'unitPrice', visible: true, active: true, order: 4, minWidth: 110, type: 'number' }),
    expect.objectContaining({ key: 'hsnCode', visible: false, active: true, readOnly: true, order: 16, minWidth: 105 }),
  ]));
});

test('keeps a current-company SAP UDF even when an old Delivery fallback hid it', () => {
  const columns = buildDeliveryLiveMatrixColumns({
    schemaLineFields: [
      standardField('ItemCode', 'itemNo', 'Item No.', 1),
      udfField('U_Seller_Delivery', 'Seller - Delivery', 2),
    ],
    rowUdfFields: [{ key: 'U_Seller_Delivery', sapField: 'U_Seller_Delivery', label: 'Seller - Delivery' }],
    layoutColumns: [
      { fieldName: 'ItemCode', columnTitle: 'Item No.', visible: true, editable: true, columnOrder: 1 },
      { fieldName: 'U_Seller_Delivery', columnTitle: 'Seller - Delivery', visible: true, editable: true, isUdf: true, columnOrder: 2 },
    ],
  });

  expect(columns).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'U_Seller_Delivery', isUdf: true, visible: true, active: true }),
  ]));
});
