import { appendOrderLines, buildIssuePayload } from './IssueForProduction';

jest.mock('react-router-dom', () => ({ useLocation: () => ({}), useNavigate: () => () => {} }), { virtual: true });
jest.mock('../../api/client', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));

const row = (base_entry, base_line, extra = {}) => ({
  _id: `${base_entry}-${base_line}`, base_entry, base_line, item_code: `C${base_line}`, issue_qty: 1, warehouse: '01', ...extra,
});

test('picking another order appends its rows and skips rows already in the issue', () => {
  const existing = [row(10, 0), row(10, 1)];
  const merged = appendOrderLines(existing, [row(10, 1), row(11, 0), row(11, 1)]);
  expect(merged.map((l) => `${l.base_entry}:${l.base_line}`)).toEqual(['10:0', '10:1', '11:0', '11:1']);
  expect(appendOrderLines(merged, [row(11, 0)])).toHaveLength(4);
});

test('payload sends base_entry per line and the first order as prod_order_entry', () => {
  const payload = buildIssuePayload({ series: '5', posting_date: '2026-10-19' }, [
    row(10, 0, { project: 'P1' }),
    row(11, 2),
    row(12, 0, { issue_qty: 0 }),
  ]);
  expect(payload.prod_order_entry).toBe(10);
  expect(payload.lines.map((l) => [l.base_entry, l.base_line, l.base_type])).toEqual([[10, 0, 202], [11, 2, 202]]);
  expect(payload.lines[0].project).toBe('P1');
});
