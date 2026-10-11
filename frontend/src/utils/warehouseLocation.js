export const getWarehouseLocationCode = (warehouses = [], warehouseCode = '') => {
  const code = String(warehouseCode || '').trim();
  if (!code) return '';
  const warehouse = (warehouses || []).find(row => String(row.WhsCode ?? row.whsCode ?? '').trim() === code);
  return warehouse?.LocationCode != null ? String(warehouse.LocationCode) : '';
};
