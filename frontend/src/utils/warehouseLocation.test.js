import { getWarehouseLocationCode } from './warehouseLocation';

test('keeps warehouse location separate from its branch', () => {
  expect(getWarehouseLocationCode([{ WhsCode: 'SUN-FG', LocationCode: 8, BranchID: 3 }], 'SUN-FG')).toBe('8');
  expect(getWarehouseLocationCode([{ WhsCode: 'SUN-FG', LocationCode: 8, BranchID: 3 }], 'OTHER')).toBe('');
});
