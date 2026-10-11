import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ContentsTab from './ContentsTab';

const renderContentsTab = (overrides = {}) => render(
  <ContentsTab
    lines={overrides.lines || []}
    onLineChange={overrides.onLineChange || jest.fn()}
    onNumBlur={jest.fn()}
    lineItemOptions={[]}
    onAddLine={jest.fn()}
    onRemoveLine={jest.fn()}
    getUomOptions={() => []}
    effectiveTaxCodes={overrides.effectiveTaxCodes || []}
    effectiveWarehouses={[]}
    fmtTaxLabel={(value) => value}
    valErrors={{ lines: [] }}
    matrixFields={overrides.matrixFields || []}
    shippingTypeOptions={overrides.shippingTypeOptions || []}
    onLoadLookupOptions={overrides.onLoadLookupOptions}
    onRowUdfChange={overrides.onRowUdfChange}
    formSettings={overrides.formSettings || {}}
    getBranchName={overrides.getBranchName || ((branchId) => ({ '3': 'UP' }[branchId] || ''))}
  />
);

test('shows the SAP branch name on a saved Sales Order line', () => {
  renderContentsTab({
    lines: [{ branch: '3' }],
    matrixFields: [{ key: 'branch', fieldName: 'BPLId', label: 'Branch', importedLayout: true, readOnly: true }],
  });
  expect(screen.getByDisplayValue('UP')).toBeInTheDocument();
});

test('shows the Shipping Type name while retaining its SAP transport code', () => {
  let selectedChange = null;
  const onLineChange = jest.fn((_rowIndex, event) => {
    selectedChange = { name: event.target.name, value: event.target.value };
  });
  renderContentsTab({
    lines: [{ lineShippingType: '3' }],
    onLineChange,
    matrixFields: [{
      key: 'lineShippingType',
      fieldName: 'ShipType',
      label: 'Shipping Type',
      importedLayout: true,
      schemaDriven: true,
    }],
    shippingTypeOptions: [
      { value: '3', label: 'Road Transport' },
      { value: '5', label: 'Courier' },
    ],
  });

  const shippingType = screen.getByRole('combobox', { name: 'Shipping Type row 1' });
  expect(shippingType).toHaveValue('3');
  expect(screen.getByRole('option', { name: 'Road Transport' }).selected).toBe(true);

  fireEvent.change(shippingType, { target: { value: '5' } });
  expect(onLineChange).toHaveBeenCalledTimes(1);
  expect(selectedChange).toEqual({ name: 'lineShippingType', value: '5' });
});

test('always renders the mandatory row-number column when an imported layout omits it', () => {
  renderContentsTab({
    lines: [{ itemNo: 'RM-001' }],
    matrixFields: [{
      key: 'itemNo',
      fieldName: 'ItemCode',
      label: 'Item No.',
      importedLayout: true,
    }],
  });

  expect(screen.getByRole('columnheader', { name: '#' })).toBeInTheDocument();
  expect(screen.getByRole('cell', { name: '1' })).toBeInTheDocument();
});

test('renders the row-number column first when an imported layout places it mid-grid', () => {
  renderContentsTab({
    lines: [{ itemNo: 'RM-001' }],
    matrixFields: [
      { key: 'itemNo', fieldName: 'ItemCode', label: 'Item No.', order: 1, importedLayout: true },
      { key: 'brockSeller', fieldName: 'U_BrockSeller', label: 'Brock Seller', order: 40, importedLayout: true },
      { key: '__lineNumber', fieldName: 'LineNum', label: '#', order: 41, importedLayout: true },
      { key: 'lineDistrRule', fieldName: 'CostingCode', label: 'Distr. Rule', order: 42, importedLayout: true },
    ],
    formSettings: {
      matrixColumns: {
        itemNo: { visible: true, order: 1 },
        brockSeller: { visible: true, order: 40 },
        __lineNumber: { visible: true, order: 41 },
        lineDistrRule: { visible: true, order: 42 },
      },
    },
  });

  expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('#');
});

test('allows typing in an editable HSN column', () => {
  const onLineChange = jest.fn();
  renderContentsTab({
    lines: [{ hsnCode: '' }],
    onLineChange,
    matrixFields: [{
      key: 'hsnCode',
      fieldName: 'HsnEntry',
      label: 'HSN',
      active: true,
      readOnly: false,
      importedLayout: true,
      schemaDriven: true,
    }],
  });

  const hsnInput = screen.getByPlaceholderText('HSN');
  expect(hsnInput).toBeEnabled();
  fireEvent.change(hsnInput, { target: { value: '5208' } });
  expect(onLineChange).toHaveBeenCalledTimes(1);
});

test('configured lookup overrides a specialized standard line renderer', () => {
  renderContentsTab({
    lines: [{ quantity: '1' }],
    onLoadLookupOptions: jest.fn().mockResolvedValue([]),
    matrixFields: [{
      key: 'quantity',
      valueKey: 'quantity',
      rendererKey: 'quantity',
      fieldName: 'Quantity',
      label: 'Quantity',
      active: true,
      readOnly: false,
      importedLayout: true,
      schemaDriven: true,
      lookupConfigured: true,
      lookupSource: 'warehouses',
      lookup: { source: 'warehouses', fieldId: 'RDR1.Quantity' },
    }],
  });

  expect(screen.getByTitle('List of Quantity')).toBeEnabled();
});

test('a SAP UDF with valid values uses its company dropdown options', () => {
  const onLoadLookupOptions = jest.fn().mockResolvedValue([]);
  renderContentsTab({
    lines: [{ udf: { U_Seller_Quality: 'NO' } }],
    onLoadLookupOptions,
    matrixFields: [{
      key: 'U_Seller_Quality', valueKey: 'U_Seller_Quality',
      label: 'Seller - Quality', isUdf: true, type: 'select',
      options: [{ value: 'NO', label: 'NO' }, { value: 'YES', label: 'YES' }],
      lookupSource: 'udf-valid-values', schemaFieldId: 'RDR1.U_Seller_Quality',
    }],
  });
  expect(screen.getByRole('combobox')).toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveValue('NO');
  expect(screen.getByRole('option', { name: 'YES' })).toHaveValue('YES');
  expect(screen.queryByTitle('List of Seller - Quality')).not.toBeInTheDocument();
  expect(onLoadLookupOptions).not.toHaveBeenCalled();
});

test('a numeric SAP UDF selects its stored value in find mode', () => {
  renderContentsTab({
    lines: [{ udf: { U_BoxWeight: '7.00' } }],
    matrixFields: [{
      key: 'U_BoxWeight', valueKey: 'U_BoxWeight', label: 'Box Weight',
      isUdf: true, type: 'number', lookupSource: 'udf-valid-values',
      options: [{ value: '7.00', label: '7 KG' }, { value: '6.30', label: '6.3 KG' }],
    }],
  });
  expect(screen.getByRole('combobox')).toHaveValue('7.00');
  expect(screen.getByRole('option', { name: '7 KG' })).toBeInTheDocument();
});

test('SAP Unit UDF is editable text without a lookup button', () => {
  const onRowUdfChange = jest.fn();
  renderContentsTab({
    lines: [{ udf: { U_UoM: 'MT' } }],
    onRowUdfChange,
    matrixFields: [{
      key: 'U_UoM', valueKey: 'U_UoM', label: 'Unit', isUdf: true,
      type: 'text', lookupSource: 'sap-user-values',
      options: [{ value: 'MT', label: 'MT' }],
    }],
  });

  const input = screen.getByDisplayValue('MT');
  expect(input).toBeEnabled();
  expect(screen.queryByTitle('List of Unit')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'ton' } });
  expect(onRowUdfChange).toHaveBeenCalledWith(0, 'U_UoM', 'ton');
});

test('selecting a live SAP form value updates the exact row UDF used by Sales Order and A/R Invoice', async () => {
  const onRowUdfChange = jest.fn();
  renderContentsTab({
    lines: [{ udf: { U_Seller_Quality: '' } }], onRowUdfChange,
    onLoadLookupOptions: jest.fn().mockResolvedValue([{ value: '15 FFA MAX.', label: '15 FFA MAX.' }]),
    matrixFields: [{ key: 'U_Seller_Quality', valueKey: 'U_Seller_Quality', label: 'Seller - Quality',
      isUdf: true, type: 'text', lookupSource: 'sap-user-values', schemaFieldId: 'RDR1.U_Seller_Quality' }],
  });
  fireEvent.click(screen.getByTitle('List of Seller - Quality'));
  const value = await screen.findByText('15 FFA MAX.');
  fireEvent.click(value);
  fireEvent.click(screen.getByRole('button', { name: /^Choose$/i }));
  expect(onRowUdfChange).toHaveBeenCalledWith(0, 'U_Seller_Quality', '15 FFA MAX.');
});

test('keeps document-line fields readable when SAP supplies narrow column widths', () => {
  renderContentsTab({
    lines: [{
      itemNo: 'ITEM-1',
      itemDescription: 'Test item',
      quantity: '1',
      hsnCode: '5208',
      taxCode: 'GST12',
    }],
    matrixFields: [
      { key: 'itemNo', label: 'Item No.', width: 42, importedLayout: true },
      { key: 'itemDescription', label: 'Item Description', width: 55, importedLayout: true },
      { key: 'quantity', label: 'Quantity', width: 40, type: 'number', importedLayout: true },
      { key: 'hsnCode', label: 'HSN', width: 35, importedLayout: true },
      { key: 'taxCode', label: 'Tax Code', width: 45, importedLayout: true },
    ],
  });

  expect(screen.getByText('Item No.').closest('th')).toHaveStyle({ minWidth: '160px' });
  expect(screen.getByText('Item Description').closest('th')).toHaveStyle({ minWidth: '240px' });
  expect(screen.getByText('Quantity').closest('th')).toHaveStyle({ minWidth: '95px' });
  expect(screen.getByText('HSN').closest('th')).toHaveStyle({ minWidth: '115px' });
  expect(screen.getByText('Tax Code').closest('th')).toHaveStyle({ minWidth: '115px' });
  expect(screen.getByRole('table')).toHaveStyle({ width: 'max-content' });
});
test('keeps UoM Name blank after the user clears it', () => {
  const onLineChange = jest.fn();
  renderContentsTab({
    lines: [{ uomName: '', uomCode: 'MTR', uomNameEdited: true }],
    onLineChange,
    matrixFields: [{
      key: 'uomName',
      label: 'UoM Name',
      active: true,
      readOnly: false,
      importedLayout: true,
    }],
  });

  const uomNameInput = screen.getByRole('textbox');
  expect(uomNameInput).toHaveValue('');

  fireEvent.change(uomNameInput, { target: { value: 'Mtr.' } });
  expect(onLineChange).toHaveBeenCalledTimes(1);
  expect(onLineChange.mock.calls[0][0]).toBe(0);
  expect(onLineChange.mock.calls[0][1].target.name).toBe('uomName');
});

test('does not fabricate a Manual UoM when company item options are unavailable', () => {
  const onLineChange = jest.fn();
  renderContentsTab({
    lines: [{ uomCode: '' }],
    onLineChange,
    matrixFields: [{
      key: 'uomCode',
      label: 'UoM Code',
      active: true,
      readOnly: false,
      importedLayout: true,
    }],
    getUomOptions: () => [],
  });

  const uomCodeSelect = screen.getByRole('combobox');
  expect(uomCodeSelect).toHaveValue('');
  expect(screen.queryByRole('option', { name: 'Manual' })).not.toBeInTheDocument();
});

test('keeps Manual UoM Name editable while its code is fixed', () => {
  renderContentsTab({
    lines: [{ uomEntry: -1, uomCode: 'Manual', uomName: 'MTR' }],
    matrixFields: [
      { key: 'uomCode', label: 'UoM Code', active: true, readOnly: false, importedLayout: true },
      { key: 'uomName', label: 'UoM Name', active: true, readOnly: false, importedLayout: true },
    ],
    getUomOptions: () => ['Manual'],
  });

  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByRole('textbox')).toBeEnabled();
  expect(screen.getByRole('textbox')).toHaveValue('MTR');
});

test('does not lock core editable fields from a stale imported active flag', () => {
  renderContentsTab({
    lines: [{ stdDiscount: '2' }],
    matrixFields: [{
      key: 'stdDiscount',
      label: 'Discount %',
      active: false,
      readOnly: false,
      importedLayout: true,
    }],
  });

  expect(screen.getByDisplayValue('2')).toBeEnabled();
});

test('uses native Tab navigation after a configured Packing Type selector', () => {
  renderContentsTab({
    lines: [{ udf: { U_PackingType: 'Bag' }, stdDiscount: '' }],
    matrixFields: [
      {
        key: 'U_PackingType',
        label: 'Packing-Type',
        active: true,
        readOnly: false,
        importedLayout: true,
        isUdf: true,
        options: [{ value: 'Bag', label: 'Bag' }],
      },
      { key: 'stdDiscount', label: 'Discount %', active: true, readOnly: false, importedLayout: true },
    ],
  });

  expect(screen.getByRole('combobox')).toHaveAttribute('data-sap-native-tab', 'true');
  expect(screen.getByRole('textbox')).toBeEnabled();
});

test('calculates FOR Rate in find mode when loaded value is zero', () => {
  renderContentsTab({
    lines: [{ forRate: '0.000000', unitPrice: '21', stdDiscount: '2', taxCode: '12-GST' }],
    effectiveTaxCodes: [{ Code: '12-GST', Rate: 12 }],
    matrixFields: [{
      key: 'forRate',
      label: 'FOR Rate',
      type: 'number',
      numeric: true,
      active: true,
      readOnly: false,
      importedLayout: true,
    }],
  });

  expect(screen.getByDisplayValue('23.04960')).toBeInTheDocument();
});
