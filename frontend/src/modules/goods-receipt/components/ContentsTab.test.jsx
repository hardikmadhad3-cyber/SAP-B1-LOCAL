import { fireEvent, render, screen } from '@testing-library/react';
import ContentsTab from './ContentsTab';

const props = (overrides = {}) => ({
  lines: [{ itemCode: 'I001', quantity: 1, warehouse: '01' }],
  activeRow: 0,
  onFocusRow: jest.fn(),
  onItemCodeChange: jest.fn(),
  onItemCommit: jest.fn(),
  onOpenItemModal: jest.fn(),
  onFieldChange: jest.fn(),
  onRowUdfChange: jest.fn(),
  onAddLine: jest.fn(),
  onRemoveLine: jest.fn(),
  errors: {},
  warehouses: [{ whsCode: '01' }, { whsCode: '02' }],
  ...overrides,
});

test('Goods Receipt/Issue lines show the SAP B1 warehouse column and change it per row', () => {
  const onFieldChange = jest.fn();
  render(<ContentsTab {...props({ onFieldChange })} />);
  expect(screen.getByRole('columnheader', { name: 'Whse' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Warehouse row 1'), { target: { value: '02' } });
  expect(onFieldChange).toHaveBeenCalledWith(0, 'warehouse', '02');
});

test('one-company UDF columns appear only when the company has that UDF', () => {
  const { unmount } = render(<ContentsTab {...props()} />);
  expect(screen.queryByRole('columnheader', { name: 'Seller Brokerage' })).not.toBeInTheDocument();
  unmount();
  render(<ContentsTab {...props({ rowUdfFields: [{ key: 'U_Brok_Seller', label: 'Seller Brokerage', type: 'number' }] })} />);
  expect(screen.getByRole('columnheader', { name: 'Seller Brokerage' })).toBeInTheDocument();
});
