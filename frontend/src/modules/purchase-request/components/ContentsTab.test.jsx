import { fireEvent, render, screen } from '@testing-library/react';
import ContentsTab from './ContentsTab';

const baseProps = {
  onLineChange: jest.fn(),
  onNumBlur: jest.fn(),
  onAddLine: jest.fn(),
  onRemoveLine: jest.fn(),
  lineItemOptions: [],
  getUomOptions: () => [],
  effectiveTaxCodes: [],
  effectiveWarehouses: [],
  valErrors: { lines: {} },
  formSettings: { matrixColumns: {}, rowUdfs: {} },
};

test('renders current-company Purchase Request row UDFs in document lines', () => {
  const onRowUdfChange = jest.fn();
  render(
    <ContentsTab
      {...baseProps}
      lines={[{ itemNo: 'RM-001', udf: { U_RequestClass: 'Urgent' } }]}
      matrixFields={[
        { key: 'itemNo', label: 'Item No.' },
        {
          key: 'U_RequestClass',
          label: 'Request Class',
          isUdf: true,
          field: { key: 'U_RequestClass', label: 'Request Class', type: 'text' },
        },
      ]}
      rowUdfFields={[{ key: 'U_RequestClass', label: 'Request Class', type: 'text' }]}
      onRowUdfChange={onRowUdfChange}
    />
  );

  expect(screen.getByText('Request Class')).toBeInTheDocument();
  fireEvent.change(screen.getByDisplayValue('Urgent'), { target: { value: 'Normal' } });
  expect(onRowUdfChange).toHaveBeenCalledWith(0, 'U_RequestClass', 'Normal');
});

test('respects Purchase Request row-UDF visibility settings', () => {
  render(
    <ContentsTab
      {...baseProps}
      lines={[{ itemNo: 'RM-001', udf: { U_RequestClass: 'Urgent' } }]}
      matrixFields={[
        { key: 'itemNo', label: 'Item No.' },
        {
          key: 'U_RequestClass',
          label: 'Request Class',
          isUdf: true,
          field: { key: 'U_RequestClass', label: 'Request Class', type: 'text' },
        },
      ]}
      rowUdfFields={[{ key: 'U_RequestClass', label: 'Request Class', type: 'text' }]}
      formSettings={{ matrixColumns: { U_RequestClass: { visible: false } }, rowUdfs: {} }}
      onRowUdfChange={jest.fn()}
    />
  );

  expect(screen.queryByText('Request Class')).not.toBeInTheDocument();
});

test('renders and edits SAP Purchase Request row vendor and required date', () => {
  const onLineChange = jest.fn();
  const onOpenVendorModal = jest.fn();
  render(
    <ContentsTab
      {...baseProps}
      onLineChange={onLineChange}
      lines={[{
        itemNo: 'RM-001',
        vendor: 'V100',
        requiredDate: '2026-09-20',
        udf: {},
      }]}
      matrixFields={[
        { key: 'itemNo', label: 'Item No.' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'requiredDate', label: 'Required Date' },
      ]}
      onOpenVendorModal={onOpenVendorModal}
    />
  );

  expect(screen.getByText('Vendor')).toBeInTheDocument();
  expect(screen.getByDisplayValue('V100')).toHaveAttribute('name', 'vendor');
  fireEvent.click(screen.getByTitle('Select Vendor'));
  expect(onOpenVendorModal).toHaveBeenCalledWith(0);
  fireEvent.change(screen.getByDisplayValue('2026-09-20'), { target: { name: 'requiredDate', value: '2026-09-25' } });
  expect(onLineChange).toHaveBeenCalledWith(0, expect.objectContaining({
    target: expect.objectContaining({ name: 'requiredDate' }),
  }));
});

test('service mode uses a G/L account field and account reference data', () => {
  render(
    <ContentsTab
      {...baseProps}
      documentType="Service"
      lines={[{ accountCode: '610000', itemDescription: 'Consulting', udf: {} }]}
      matrixFields={[
        { key: 'itemNo', label: 'Item No.' },
        { key: 'itemDescription', label: 'Description' },
      ]}
      serviceAccounts={[{ code: '610000', name: 'Consulting Expense' }]}
    />
  );

  expect(screen.getByText('G/L Account')).toBeInTheDocument();
  expect(screen.getByDisplayValue('610000')).toHaveAttribute('name', 'accountCode');
  expect(screen.getByText('Consulting Expense')).toBeInTheDocument();
});

test('Required Qty. and Info Price stay editable when the SAP layout marks them read-only', () => {
  const { normalizePurchaseRequestMatrixColumns } = require('../../../config/purchaseRequestForm');
  const columns = normalizePurchaseRequestMatrixColumns([
    { key: 'itemNo', label: 'Item No.' },
    { key: 'requiredQty', label: 'Required Qty.', readOnly: true },
    { key: 'price', label: 'Info Price', readOnly: true },
    { key: 'totalLC', label: 'Total (LC)', readOnly: true },
  ]);
  expect(columns.find((c) => c.key === 'total').readOnly).toBe(true);
  const onLineChange = jest.fn();
  render(
    <ContentsTab
      {...baseProps}
      onLineChange={onLineChange}
      lines={[{ itemNo: 'ITM001', quantity: '', unitPrice: '' }]}
      matrixFields={columns}
    />
  );
  const qty = document.querySelector('input[name="quantity"]');
  const price = document.querySelector('input[name="unitPrice"]');
  expect(qty.readOnly).toBe(false);
  expect(price.readOnly).toBe(false);
  fireEvent.change(qty, { target: { value: '5' } });
  expect(onLineChange).toHaveBeenCalled();
});

test('Item/Service Type selector switches type and locks for added documents', () => {
  const onDocumentTypeChange = jest.fn();
  const { rerender } = render(
    <ContentsTab {...baseProps} lines={[{}]} matrixFields={[{ key: 'itemNo', label: 'Item No.' }]} onDocumentTypeChange={onDocumentTypeChange} />
  );
  fireEvent.change(screen.getByLabelText('Item/Service Type'), { target: { value: 'Service' } });
  expect(onDocumentTypeChange).toHaveBeenCalledWith('Service');
  rerender(
    <ContentsTab {...baseProps} lines={[{}]} matrixFields={[{ key: 'itemNo', label: 'Item No.' }]} onDocumentTypeChange={onDocumentTypeChange} documentTypeLocked />
  );
  expect(screen.getByLabelText('Item/Service Type')).toBeDisabled();
});
