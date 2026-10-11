import { applyCopiedDeliveryQuantities } from './deliveryCopyQuantities';

test('sales-order copy keeps ordered, delivery, and balance quantities distinct', () => {
  const line = applyCopiedDeliveryQuantities({
    sourceType: 'salesOrder',
    sourceLine: { OrderedQuantity: 10, Quantity: 6.6, OpenQty: 6.6 },
    line: { quantity: '6.6', openQty: '6.6', udf: { U_Order_Qty: '0' } },
    matrixFields: [{ label: 'Ordered Qty', valueKey: 'U_Order_Qty' }],
    rowUdfFields: [{ key: 'U_Order_Qty', label: 'Ordered Qty' }],
  });
  expect(line.quantity).toBe('6.6');
  expect(line.orderedQty).toBe('10');
  expect(line.openQty).toBe('');
  expect(line.udf.U_Order_Qty).toBe('10');
});

test('copy does not carry a source document balance into a new Delivery', () => {
  const line = applyCopiedDeliveryQuantities({
    sourceType: 'arReserveInvoice',
    sourceLine: { Quantity: 4, OpenQty: 4 },
    line: { quantity: '4', openQty: '4', udf: {} },
  });
  expect(line.quantity).toBe('4');
  expect(line.orderedQty).toBe('');
  expect(line.openQty).toBe('');
});
