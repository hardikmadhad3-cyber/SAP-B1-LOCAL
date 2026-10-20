import { applyLineEdit, buildProductionOrderPayload, recalcPlannedQty } from './productionOrderHelpers';

jest.mock('react-router-dom', () => ({ useLocation: () => ({}), useNavigate: () => () => {} }), { virtual: true });

test('planned qty = base ratio x header planned + additional qty', () => {
  expect(recalcPlannedQty({ base_ratio: 2, additional_qty: 3 }, 5).planned_qty).toBe(13);
  // by-products keep their negative sign
  expect(recalcPlannedQty({ base_ratio: -0.5, additional_qty: 0 }, 4).planned_qty).toBe(-2);
  const text = { component_type: 'pit_Text', planned_qty: 1, base_ratio: 9 };
  expect(recalcPlannedQty(text, 10)).toBe(text);
});

test('editing base qty, base ratio or additional qty recalculates the row', () => {
  const line = { base_qty: 4, base_ratio: 2, additional_qty: 0, planned_qty: 20 };
  expect(applyLineEdit(line, 'additional_qty', '1', 10).planned_qty).toBe(21);
  expect(applyLineEdit(line, 'base_ratio', '3', 10).planned_qty).toBe(30);
  const scaled = applyLineEdit(line, 'base_qty', '8', 10);
  expect(scaled.base_ratio).toBe(4);
  expect(scaled.planned_qty).toBe(40);
  expect(applyLineEdit({ base_qty: 0, base_ratio: 0, additional_qty: 0 }, 'base_qty', '6', 2, 3).planned_qty).toBe(4);
  expect(applyLineEdit(line, 'warehouse', '01', 10).planned_qty).toBe(20);
});

test('payload keeps text rows, drops empty rows and sends stages', () => {
  const header = { item_code: 'FG', planned_qty: '2', pick_remarks: 'Pick A', linked_to: 'sales_order', linked_order_entry: '15', user_id: '3' };
  const lines = [
    { _id: 1, component_type: 'pit_Item', item_code: 'C1', planned_qty: 2, stage_id: '1', route_sequence: '1' },
    { _id: 2, component_type: 'pit_Text', item_code: '', item_name: 'Mix well', line_text: '' },
    { _id: 3, component_type: 'pit_Item', item_code: '' },
  ];
  const stages = [{ StageID: 1, SequenceNumber: 1, StageEntry: 7, Name: 'Assembly', StageCode: 'ASM' }];
  const payload = buildProductionOrderPayload(header, lines, stages);

  expect(payload.lines).toHaveLength(2);
  expect(payload.lines[0]).toMatchObject({ item_code: 'C1', stage_id: 1, line_num: 0 });
  expect(payload.lines[0]._id).toBeUndefined();
  expect(payload.lines[1]).toMatchObject({ component_type: 'pit_Text', line_text: 'Mix well', line_num: 1, stage_id: '' });
  expect(payload.stages).toEqual([{ stage_entry: 7, stage_id: 1, name: 'Assembly' }]);
  expect(payload).toMatchObject({ planned_qty: 2, pick_remarks: 'Pick A', linked_to: 'sales_order', linked_order_entry: '15', user_id: '3' });
  expect(payload.status).toBeUndefined();
});
