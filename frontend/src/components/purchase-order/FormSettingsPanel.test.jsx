import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FormSettingsPanel, { filterDuplicateRowUdfFields } from './FormSettingsPanel';
import { mergeContentSettingsFields } from '../../utils/formSettingsColumns';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';

const fields = [
  { key: 'ItemCode', label: 'Item No.', order: 1 },
  { key: 'discount', label: 'Discount %', order: 2 },
  { key: 'uomName', label: 'UoM Name', order: 3, required: true },
  { key: 'U_PackingType', label: 'Packing Type', order: 4, isUdf: true },
];

const settings = {
  matrixColumns: {
    ItemCode: { visible: true, order: 1 },
    discount: { visible: true, order: 2 },
    uomName: { visible: false, order: 3, required: true },
    U_PackingType: { visible: true, order: 4 },
  },
  rowUdfs: {
    U_PackingType: { visible: true, order: 3 },
    U_ContainerType: { visible: false, order: 4 },
  },
};

test('keeps a matrix UDF canonical instead of showing a duplicate row UDF', () => {
  expect(filterDuplicateRowUdfFields(
    [{ key: 'U_PackingType', fieldName: 'U_PackingType' }],
    [
      { key: 'U_PackingType', label: 'Packing Type' },
      { key: 'U_ContainerType', label: 'Container Type' },
    ],
  )).toEqual([{ key: 'U_ContainerType', label: 'Container Type' }]);
});

test('shows one visibility-only Content list and locks required identity fields', () => {
  const onSettingChange = jest.fn();
  render(
    <FormSettingsPanel
      isOpen
      onClose={jest.fn()}
      matrixFields={fields}
      headerUdfFields={[{ key: 'U_Header', label: 'Header Field' }]}
      rowUdfFields={[
        { key: 'U_PackingType', label: 'Packing Type' },
        { key: 'U_ContainerType', label: 'Container Type' },
      ]}
      formSettings={settings}
      onSettingChange={onSettingChange}
      settingsLoaded
      settingsScopeLabel="manager / COMPANY_A"
    />,
  );

  expect(screen.getByText('Content Columns for manager / COMPANY_A')).toBeInTheDocument();
  expect(screen.getAllByText('Packing Type')).toHaveLength(1);
  expect(screen.getByText('Container Type')).toBeInTheDocument();
  expect(screen.queryByText('Header Field')).not.toBeInTheDocument();
  expect(screen.queryByText('Active')).not.toBeInTheDocument();

  const itemRow = screen.getByText('Item No.').closest('.border.rounded');
  expect(itemRow.querySelector('input[type="checkbox"]')).toBeDisabled();

  const discountRow = screen.getByText('Discount %').closest('.border.rounded');
  const discountVisibility = discountRow.querySelector('input[type="checkbox"]');
  expect(discountVisibility).toBeEnabled();
  fireEvent.click(discountVisibility);
  expect(onSettingChange).toHaveBeenCalledWith('matrixColumns', 'discount', 'visible', false);

  const uomRow = screen.getByText('UoM Name').closest('.border.rounded');
  const uomVisibility = uomRow.querySelector('input[type="checkbox"]');
  expect(uomVisibility).toBeEnabled();
  fireEvent.click(uomVisibility);
  expect(onSettingChange).toHaveBeenCalledWith('matrixColumns', 'uomName', 'visible', true);
});

test('keeps distinct published captions that point to the same company UDF', () => {
  const matrix = [
    { key: 'U_Com', valueKey: 'U_Com', label: 'Commission', companyQueryLayoutColumn: true },
    { key: 'U_Com__layout_2', valueKey: 'U_Com', label: 'Commission', companyQueryLayoutColumn: true },
  ];
  expect(mergeContentSettingsFields(matrix, [{ key: 'U_Com', label: 'Commission' }])
    .map((field) => field.key)).toEqual(['U_Com', 'U_Com__layout_2']);
});

test('lets Sales Order hide a current-company header UDF through Form Settings', () => {
  const onSettingChange = jest.fn();
  render(
    <FormSettingsPanel
      isOpen
      showHeaderUdfSettings
      headerUdfFields={[{ key: 'U_Buyer', label: 'Buyer Name', visible: true }]}
      formSettings={{ headerUdfs: { U_Buyer: { visible: true } } }}
      onSettingChange={onSettingChange}
    />,
  );

  const row = screen.getByText('Buyer Name').closest('.border.rounded');
  fireEvent.click(row.querySelector('input[type="checkbox"]'));
  expect(onSettingChange).toHaveBeenCalledWith('headerUdfs', 'U_Buyer', 'visible', false);
});

test('lets a saved user preference show a column hidden by the SAP default layout', () => {
  render(
    <FormSettingsPanel
      isOpen
      onClose={jest.fn()}
      matrixFields={[{ key: 'uomName', label: 'UoM Name', visible: false, required: true }]}
      formSettings={{ matrixColumns: { uomName: { visible: true, order: 1 } } }}
      onSettingChange={jest.fn()}
      settingsLoaded
    />,
  );

  const uomVisibility = screen.getByLabelText('Visible');
  expect(uomVisibility).toBeEnabled();
  expect(uomVisibility).toBeChecked();
});

test('publishes one atomic normalized order from keyboard-accessible move controls', () => {
  const onColumnOrderChange = jest.fn();
  render(
    <FormSettingsPanel
      isOpen
      onClose={jest.fn()}
      matrixFields={fields}
      rowUdfFields={[]}
      formSettings={settings}
      onSettingChange={jest.fn()}
      onColumnOrderChange={onColumnOrderChange}
      settingsLoaded
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Move Discount % down' }));
  expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
  expect(onColumnOrderChange.mock.calls[0][0].map((field) => field.key)).toEqual([
    'ItemCode',
    'uomName',
    'discount',
    'U_PackingType',
  ]);
});

test('uses explicit Save and discards on Cancel or close', () => {
  const onSave = jest.fn();
  const onCancel = jest.fn();
  const onClose = jest.fn();
  render(
    <FormSettingsPanel
      isOpen
      onClose={onClose}
      matrixFields={fields}
      rowUdfFields={[]}
      formSettings={settings}
      onSettingChange={jest.fn()}
      settingsLoaded
      hasUnsavedChanges
      onSave={onSave}
      onCancel={onCancel}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('does not expose fields or Save while company settings are loading', () => {
  render(
    <FormSettingsPanel
      isOpen
      onClose={jest.fn()}
      matrixFields={fields}
      formSettings={settings}
      onSettingChange={jest.fn()}
      settingsLoaded={false}
      hasUnsavedChanges
      onSave={jest.fn()}
    />,
  );
  expect(screen.getByText('Loading saved Content-column settings...')).toBeInTheDocument();
  expect(screen.queryByText('Item No.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('closed documents keep user visibility, ordering and Save enabled without unlocking document fields', async () => {
  const onSettingChange = jest.fn();
  const onColumnOrderChange = jest.fn();
  const onSave = jest.fn();
  const onCancel = jest.fn();
  function ClosedDocument({ showSettings }) {
    const ref = React.useRef(null);
    useClosedDocumentViewMode(ref, true);
    return <fieldset ref={ref}>
      <input aria-label="Document quantity" defaultValue="1" />
      <input aria-label="Document tax" type="checkbox" />
      <button type="button">Add document line</button>
      <FormSettingsPanel isOpen={showSettings} onClose={jest.fn()}
        matrixFields={fields} formSettings={settings}
        onSettingChange={onSettingChange} onColumnOrderChange={onColumnOrderChange}
        settingsLoaded hasUnsavedChanges onSave={onSave} onCancel={onCancel}
        settingsScopeLabel="manager / COMPANY_A" />
    </fieldset>;
  }
  const { rerender } = render(<ClosedDocument showSettings={false} />);
  expect(screen.getByLabelText('Document quantity')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Document tax')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Add document line' })).toBeDisabled();
  // Opening the sidebar after the lock exercises the MutationObserver path.
  rerender(<ClosedDocument showSettings />);
  await act(async () => { await Promise.resolve(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Move Discount % down' })).toBeEnabled());
  const discount = screen.getAllByLabelText('Visible')[1];
  expect(discount).toBeEnabled();
  fireEvent.click(discount);
  fireEvent.click(screen.getByRole('button', { name: 'Move Discount % down' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSettingChange).toHaveBeenCalledWith('matrixColumns', 'discount', 'visible', false);
  expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(screen.getAllByLabelText('Visible')[0]).toBeDisabled();
  expect(screen.getByLabelText('Document tax')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
