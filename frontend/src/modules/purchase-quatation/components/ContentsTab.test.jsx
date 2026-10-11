import { buildSalesDocumentLiveFields } from '../../../utils/salesDocumentLiveFields';
import { fireEvent, render, screen } from '@testing-library/react';
import ContentsTab from './ContentsTab';

jest.mock('../../../components/sales-document/LiveUdfValueInput', () => ({ field, value, onChange }) => (
  <input aria-label={field.label || field.key} value={value} onChange={(event) => onChange(event.target.value)} />
));

test('renders and edits a current-company Purchase Quotation row UDF', () => {
  const onRowUdfChange = jest.fn();
  render(
    <ContentsTab
      lines={[{ itemNo: 'RM-001', udf: { U_QuoteGrade: 'Premium' } }]}
      onLineChange={jest.fn()}
      onNumBlur={jest.fn()}
      onAddLine={jest.fn()}
      onRemoveLine={jest.fn()}
      lineItemOptions={[]}
      getUomOptions={() => []}
      effectiveTaxCodes={[]}
      effectiveWarehouses={[]}
      valErrors={{ lines: {} }}
      matrixFields={[
        { key: 'itemNo', label: 'Item No.' },
        {
          key: 'U_QuoteGrade',
          label: 'Quote Grade',
          isUdf: true,
          field: { key: 'U_QuoteGrade', label: 'Quote Grade', type: 'text' },
        },
      ]}
      rowUdfFields={[{ key: 'U_QuoteGrade', label: 'Quote Grade', type: 'text' }]}
      formSettings={{ matrixColumns: { U_QuoteGrade: { visible: true, active: true } }, rowUdfs: {} }}
      onRowUdfChange={onRowUdfChange}
    />
  );

  expect(screen.getByText('Quote Grade')).toBeInTheDocument();
  fireEvent.change(screen.getByDisplayValue('Premium'), { target: { value: 'Standard' } });
  expect(onRowUdfChange).toHaveBeenCalledWith(0, 'U_QuoteGrade', 'Standard');
});

const lookupItems = [
  { ItemCode: 'RM-001', ItemName: 'Raw Cotton' },
  { ItemCode: 'RM-002', ItemName: 'Raw Fabric' },
];

function renderItemLookup(value = '') {
  const onOpenItemModal = jest.fn();
  const onLineChange = jest.fn();
  render(<ContentsTab
    lines={[{ itemNo: value }]}
    onLineChange={onLineChange}
    onNumBlur={jest.fn()}
    onAddLine={jest.fn()}
    onRemoveLine={jest.fn()}
    lineItemOptions={{ 0: lookupItems }}
    getUomOptions={() => []}
    effectiveTaxCodes={[]}
    effectiveWarehouses={[]}
    valErrors={{ lines: {} }}
    matrixFields={[{ key: 'itemNo', label: 'Item No.' }]}
    onOpenItemModal={onOpenItemModal}
  />);
  return { input: screen.getByPlaceholderText('Item Code'), onOpenItemModal, onLineChange };
}

test('Item No. is editable text with a lookup button instead of a dropdown', () => {
  const { input, onOpenItemModal } = renderItemLookup();
  expect(input.tagName).toBe('INPUT');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Select Item'));
  expect(onOpenItemModal).toHaveBeenCalledWith(0);
});

test('Tab on a blank item opens the current row lookup', () => {
  const { input, onOpenItemModal } = renderItemLookup();
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(onOpenItemModal).toHaveBeenCalledWith(0, '', lookupItems);
});

test('Tab on a partial item code opens matching items', () => {
  const { input, onOpenItemModal, onLineChange } = renderItemLookup('RM-');
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(onOpenItemModal).toHaveBeenCalledWith(0, 'RM-', lookupItems);
  expect(onLineChange).not.toHaveBeenCalled();
});

test('Tab on an exact item code hydrates the row through the normal change handler', () => {
  const { input, onOpenItemModal, onLineChange } = renderItemLookup('RM-001');
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(onLineChange).toHaveBeenCalledWith(0, { target: { name: 'itemNo', value: 'RM-001' } });
  expect(onOpenItemModal).not.toHaveBeenCalled();
});


test('schema-only company Item No. metadata flagged as a dropdown still renders the item lookup', () => {
  const itemField = {
    id: 'PQT1.U_ItemCode', stateKey: 'itemNo', sapField: 'U_ItemCode', databaseField: 'U_ItemCode',
    storage: 'udf', label: 'Item No.', type: 'select', options: [{ value: 'RM-001', label: 'Raw Cotton' }],
    visible: true, editable: true,
  };
  const live = buildSalesDocumentLiveFields({
    companyId: 7, companyDb: 'JKL_TEST', documentType: 'PURCHASE_QUOTATION',
    objectType: '540000006', headerTable: 'OPQT', lineTable: 'PQT1',
    schema: { companyId: 7, companyDb: 'JKL_TEST', headerFields: [], lineFields: [itemField] },
    layoutResponse: { source: 'fallback', columns: [] },
  });
  const onOpenItemModal = jest.fn();
  render(<ContentsTab
    lines={[{ itemNo: '' }]} onLineChange={jest.fn()} onNumBlur={jest.fn()}
    onAddLine={jest.fn()} onRemoveLine={jest.fn()} lineItemOptions={[]}
    getUomOptions={() => []} effectiveTaxCodes={[]} effectiveWarehouses={[]} valErrors={{ lines: {} }}
    matrixFields={live.matrixColumns} rowUdfFields={live.rowUdfFields} onOpenItemModal={onOpenItemModal}
  />);
  expect(screen.getByPlaceholderText('Item Code').tagName).toBe('INPUT');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Select Item'));
  expect(onOpenItemModal).toHaveBeenCalledWith(0);
});

test('stale UDF dropdown flags cannot override a column with the itemNo renderer', () => {
  const onOpenItemModal = jest.fn();
  render(<ContentsTab
    lines={[{ itemNo: 'RM-001' }]} onLineChange={jest.fn()} onNumBlur={jest.fn()}
    onAddLine={jest.fn()} onRemoveLine={jest.fn()} lineItemOptions={[]}
    getUomOptions={() => []} effectiveTaxCodes={[]} effectiveWarehouses={[]} valErrors={{ lines: {} }}
    matrixFields={[{ key: 'itemNo__2', rendererKey: 'itemNo', label: 'Item No.', isUdf: true,
      field: { key: 'U_ItemCode', type: 'select', options: [{ value: 'RM-001', label: 'Raw Cotton' }] } }]}
    onOpenItemModal={onOpenItemModal}
  />);
  expect(screen.getByPlaceholderText('Item Code')).toHaveValue('RM-001');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Select Item'));
  expect(onOpenItemModal).toHaveBeenCalledWith(0);
});
