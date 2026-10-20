import { backflushIssueQty, autoBatchNumber, getPostingLines, toPayloadLine } from './receiptHelpers';

test('backflush issues planned x received / order planned qty', () => {
  expect(backflushIssueQty(20, 5, 10)).toBe(10);
  expect(backflushIssueQty(3, 1, 3)).toBe(1);
  expect(backflushIssueQty(5, 2, 0)).toBe(0);
});

test('auto batch number uses item, posting date and the next free counter', () => {
  expect(autoBatchNumber('FG01', '2026-10-19')).toBe('FG01-20261019-1');
  expect(autoBatchNumber('FG01', '2026-10-19', ['FG01-20261019-1', ''])).toBe('FG01-20261019-2');
});

test('by-product rows with 0 qty are not posted and no unit price is sent', () => {
  const lines = [
    { item_code: 'FG01', quantity: 5, unit_price: 99, by_product: false },
    { item_code: 'BP01', quantity: 0, by_product: true, base_line: 3 },
    { item_code: 'BP02', quantity: 2, by_product: true, base_line: 4 },
    { item_code: ' ', quantity: 1 },
  ];
  const posted = getPostingLines(lines);
  expect(posted.map((l) => l.item_code)).toEqual(['FG01', 'BP02']);
  const payload = posted.map((l) => toPayloadLine(l, 7));
  expect(payload.every((l) => !('unit_price' in l))).toBe(true);
  expect(payload[0].base_entry).toBe(7);
  expect(payload[1].base_line).toBe(4);
});
