import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContentsTab from './ContentsTab';

const renderContentsTab = (matrixFields, overrides = {}) => render(
  <ContentsTab
    lines={overrides.lines || []}
    onLineChange={overrides.onLineChange || jest.fn()}
    onNumBlur={jest.fn()}
    lineItemOptions={[]}
    onAddLine={jest.fn()}
    onRemoveLine={jest.fn()}
    onOpenBatchModal={jest.fn()}
    onOpenHSNModal={jest.fn()}
    onOpenItemModal={overrides.onOpenItemModal || jest.fn()}
    onOpenQualityModal={jest.fn()}
    onOpenPaymentTermsModal={jest.fn()}
    getUomOptions={() => []}
    effectiveTaxCodes={[]}
    effectiveWarehouses={[]}
    fmtTaxLabel={(value) => value}
    getBranchName={overrides.getBranchName || ((value) => value)}
    locations={overrides.locations || []}
    valErrors={{ lines: [] }}
    matrixFields={matrixFields}
    rowUdfFields={overrides.rowUdfFields || []}
    onRowUdfChange={overrides.onRowUdfChange}
    onLoadLookupOptions={overrides.onLoadLookupOptions}
    formSettings={overrides.formSettings || {}}
    formSettingsReady={overrides.formSettingsReady}
  />
);

test('shows SAP location and branch names from their separate codes', () => {
  renderContentsTab([
    { key: 'loc', label: 'Loc.' },
    { key: 'branch', label: 'Branch' },
  ], {
    lines: [{ loc: '8', branch: '3' }],
    locations: [{ Code: 8, Location: 'UP' }, { Code: 3, Location: 'Ankleshwar' }],
    getBranchName: (value) => value === '3' ? 'UP' : '',
  });

  expect(screen.getAllByDisplayValue('UP')).toHaveLength(2);
  expect(screen.queryByDisplayValue('3')).not.toBeInTheDocument();
});

test('keeps a typed Item No. search phrase editable until Tab opens the lookup', () => {
  const onLineChange = jest.fn();
  const onOpenItemModal = jest.fn();
  renderContentsTab([{ key: 'itemNo', label: 'Item No.' }], {
    lines: [{ itemNo: '' }],
    onLineChange,
    onOpenItemModal,
  });

  const input = screen.getByPlaceholderText('Item Code');
  fireEvent.change(input, { target: { value: 'fertilizer' } });
  expect(input).toHaveValue('fertilizer');
  expect(onLineChange).not.toHaveBeenCalled();

  fireEvent.keyDown(input, { key: 'Tab' });
  expect(onOpenItemModal).toHaveBeenCalledWith(0, 'fertilizer', []);
});

test('does not render document-line fields before company Form Settings are ready', () => {
  renderContentsTab([
    { key: 'itemNo', label: 'Item No.' },
  ], { formSettingsReady: false });

  expect(screen.getByRole('status')).toHaveTextContent('Loading company line-field settings...');
  expect(screen.queryByText('Item No.')).not.toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('keeps configured Delivery column widths and lets the wrapper scroll for extra fields', () => {
  renderContentsTab([
    { key: 'itemNo', label: 'Item No.', minWidth: 160, importedLayout: true },
    { key: 'itemDescription', label: 'Item Description', minWidth: 240, importedLayout: true },
    { key: 'quantity', label: 'Quantity', minWidth: 85, importedLayout: true },
    { key: 'U_ExtraField', label: 'Extra Field', minWidth: 180, importedLayout: true, isUdf: true },
  ]);

  const table = screen.getByRole('table');
  const scroller = table.closest('.del-grid-wrap__scroller--contents');

  // 42px row number + visible columns + compulsory Bin Location Allocation + 48px action column.
  expect(table).toHaveStyle({ width: '967px', minWidth: '100%', tableLayout: 'fixed' });
  expect(scroller).toHaveStyle({ overflowX: 'auto' });
  expect(screen.getByText('Extra Field').closest('th')).toHaveStyle({ width: '180px' });
  expect(screen.getByText('Bin Location Allocation')).toBeInTheDocument();
});

test('applies SAP line-number visibility, order, and width like any other matrix column', () => {
  renderContentsTab([
    { key: 'itemNo', label: 'Item No.', minWidth: 160, order: 1, importedLayout: true },
    { key: '__lineNumber', label: '#', width: 60, order: 2, visible: true, active: false, importedLayout: true },
  ]);

  const headers = screen.getAllByRole('columnheader');
  expect(headers[0]).toHaveTextContent('#');
  expect(headers[0]).toHaveStyle({ width: '60px' });
  expect(headers[1]).toHaveTextContent('Item No.');

  cleanup();

  renderContentsTab([
    { key: '__lineNumber', label: '#', order: 0, visible: false, importedLayout: true },
    { key: 'quantity', label: 'Quantity', order: 1, importedLayout: true },
  ]);
  expect(screen.getAllByRole('columnheader').filter((header) => header.textContent === '#')).toHaveLength(1);
});

test('does not show hard-coded company fields while the live Delivery schema is loading', () => {
  renderContentsTab([]);

  expect(screen.queryByText('Seller Brokerage')).not.toBeInTheDocument();
  expect(screen.queryByText('Packing-Type')).not.toBeInTheDocument();
});

test('keeps Bin Location Allocation compulsory on Delivery even when settings try to hide it', () => {
  renderContentsTab([
    { key: 'itemNo', label: 'Item No.', importedLayout: true },
  ], {
    lines: [{ itemNo: 'ITEM-1', binLocationAllocation: '' }],
    formSettings: {
      matrixColumns: {
        itemNo: { visible: true, active: true },
        binLocationAllocation: { visible: false, active: false },
      },
    },
  });

  expect(screen.getByText('Bin Location Allocation')).toBeInTheDocument();
});

test('published company Delivery layout keeps exactly its selected columns', () => {
  renderContentsTab([
    { key: '__lineNumber', label: '#', companyQueryLayoutColumn: true },
    { key: 'itemNo', label: 'Item No.', companyQueryLayoutColumn: true },
    { key: 'U_Rate', valueKey: 'U_Rate', label: 'Discount', isUdf: true, companyQueryLayoutColumn: true },
  ], {
    formSettings: { __companyQueryLayout: { isPublished: true }, matrixColumns: {
      __lineNumber: { visible: true }, itemNo: { visible: true }, U_Rate: { visible: true },
    } },
  });

  expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
    '#', 'Item No.', 'Discount', '',
  ]);
  expect(screen.queryByText('Bin Location Allocation')).not.toBeInTheDocument();
});

test('configured lookup overrides the specialized Delivery item renderer', () => {
  renderContentsTab([{
    key: 'itemNo',
    valueKey: 'itemNo',
    rendererKey: 'itemNo',
    fieldName: 'ItemCode',
    label: 'Item No.',
    active: true,
    readOnly: false,
    importedLayout: true,
    schemaDriven: true,
    lookupConfigured: true,
    lookupSource: 'countries',
    lookup: { source: 'countries', fieldId: 'DLN1.ItemCode' },
  }], {
    lines: [{ itemNo: '' }],
    onLoadLookupOptions: jest.fn().mockResolvedValue([]),
  });

  expect(screen.getByTitle('List of Item No.')).toBeEnabled();
});

test('applies the logged-in user matrix visibility setting to a Delivery row UDF', () => {
  renderContentsTab([
    { key: 'U_AgentMaster', label: 'Agent Master', isUdf: true, importedLayout: true },
  ], {
    rowUdfFields: [{ key: 'U_AgentMaster', label: 'Agent Master' }],
    formSettings: {
      matrixColumns: { U_AgentMaster: { visible: false, active: true } },
      rowUdfs: { U_AgentMaster: { visible: true, active: true } },
    },
  });

  expect(screen.queryByText('Agent Master')).not.toBeInTheDocument();
});

test('applies the logged-in user active setting to a specialized Delivery cell', () => {
  renderContentsTab([
    { key: 'unitPrice', valueKey: 'unitPrice', rendererKey: 'unitPrice', label: 'Unit Price', type: 'number' },
  ], {
    lines: [{ unitPrice: '12.50' }],
    formSettings: {
      matrixColumns: { unitPrice: { visible: true, active: false } },
    },
  });

  expect(screen.getByDisplayValue('12.50')).toBeDisabled();
});

test('corrects a malformed imported Unit Price column again at render time', () => {
  renderContentsTab([
    {
      key: 'lineDeliveryDate',
      valueKey: 'lineDeliveryDate',
      rendererKey: 'lineDeliveryDate',
      fieldName: 'ShipDate',
      label: 'Unit Price',
      type: 'date',
      minWidth: 40,
      isUdf: true,
      importedLayout: true,
    },
  ], {
    lines: [{ unitPrice: '' }],
  });

  const priceInput = screen.getByRole('textbox');
  expect(priceInput).toHaveAttribute('type', 'text');
  expect(priceInput).toHaveAttribute('inputmode', 'decimal');
  expect(screen.getByText('Unit Price').closest('th')).toHaveStyle({ width: '110px' });
});

test('uses label-aware minimum spacing for narrow company UDF columns', () => {
  renderContentsTab([
    {
      key: 'U_ContainerType',
      valueKey: 'U_ContainerType',
      rendererKey: 'U_ContainerType',
      fieldName: 'U_ContainerType',
      label: 'ContainerType',
      type: 'text',
      minWidth: 40,
      isUdf: true,
      importedLayout: true,
    },
  ], {
    lines: [{ udf: { U_ContainerType: '' } }],
    rowUdfFields: [{ key: 'U_ContainerType', label: 'ContainerType', type: 'text' }],
  });

  expect(screen.getByText('ContainerType').closest('th')).toHaveStyle({ width: '122px' });
});

test('keeps standard Delivery fields readable when SAP supplies narrow widths', () => {
  renderContentsTab([
    { key: 'itemNo', label: 'Item No.', width: 40, importedLayout: true },
    { key: 'itemDescription', label: 'Item Description', width: 50, importedLayout: true },
    { key: 'quantity', label: 'Quantity', width: 35, type: 'number', importedLayout: true },
    { key: 'hsnCode', label: 'HSN', width: 30, importedLayout: true },
  ], {
    lines: [{
      itemNo: 'ITEM-1',
      itemDescription: 'Test item',
      quantity: '1',
      hsnCode: '5208',
    }],
  });

  expect(screen.getByText('Item No.').closest('th')).toHaveStyle({ width: '160px' });
  expect(screen.getByText('Item Description').closest('th')).toHaveStyle({ width: '240px' });
  expect(screen.getByText('Quantity').closest('th')).toHaveStyle({ width: '100px' });
  expect(screen.getByText('HSN').closest('th')).toHaveStyle({ width: '115px' });
});

test('opens a company-schema lookup and writes the selected Delivery row UDF', async () => {
  const onRowUdfChange = jest.fn();
  const onLoadLookupOptions = jest.fn().mockResolvedValue([
    { value: 'AG01', label: 'AG01 - Primary Agent', description: 'Primary Agent' },
  ]);
  const agentField = {
    key: 'U_AgentMaster',
    label: 'Agent Master',
    type: 'text',
    lookupSource: 'udf:DLN1:U_AgentMaster',
    lookup: { source: 'udf-linked-table', fieldId: 'DLN1.U_AgentMaster' },
  };

  renderContentsTab([
    {
      ...agentField,
      minWidth: 160,
      importedLayout: true,
      schemaDriven: true,
      isUdf: true,
      field: agentField,
    },
  ], {
    lines: [{ udf: { U_AgentMaster: '' } }],
    rowUdfFields: [agentField],
    onRowUdfChange,
    onLoadLookupOptions,
  });

  fireEvent.click(screen.getByTitle('List of Agent Master'));
  await waitFor(() => expect(onLoadLookupOptions).toHaveBeenCalledWith(
    'udf:DLN1:U_AgentMaster',
    expect.objectContaining({ key: 'U_AgentMaster' }),
    expect.objectContaining({ udf: { U_AgentMaster: '' } })
  ));
  fireEvent.doubleClick(await screen.findByText('AG01'));

  expect(onRowUdfChange).toHaveBeenCalledWith(0, 'U_AgentMaster', 'AG01');
});
