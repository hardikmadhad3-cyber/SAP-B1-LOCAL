import { hydrateDocumentLineFromItem } from './documentItemHydration';

test('fills the configured SAP Unit row UDF from the selected sales item', () => {
  const line = hydrateDocumentLineFromItem(
    { quantity: '1', udf: { U_UoM: '', U_Other: 'keep' } },
    { ItemCode: 'COMP001', ItemName: 'MOUSE LOGITECH', SalesUnit: 'NOS', UoMGroupEntry: -1 },
    { side: 'sales' },
  );

  expect(line.uomName).toBe('NOS');
  expect(line.udf).toEqual({ U_UoM: 'NOS', U_Other: 'keep' });
});

test('uses the purchase UoM for a configured Unit UDF on purchase pages', () => {
  const line = hydrateDocumentLineFromItem(
    { udf: { U_UOM: '' } },
    { ItemCode: 'A100', PurchaseUnit: 'BOX', UoMGroupEntry: -1 },
    { side: 'purchase' },
  );
  expect(line.udf.U_UOM).toBe('BOX');
});

test('does not add a Unit UDF when the company has no such row field', () => {
  const line = hydrateDocumentLineFromItem(
    { udf: { U_Other: 'keep' } },
    { ItemCode: 'Anisole', SalesUnit: 'ton', UoMGroupEntry: -1 },
    { side: 'sales' },
  );
  expect(line.udf).toEqual({ U_Other: 'keep' });
});
