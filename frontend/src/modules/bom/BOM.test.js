import { splitStageRows, buildRowsWithStages } from './BOM';
import { STAGE_TYPE } from './components/BOMLines';

jest.mock('react-router-dom', () => ({ useLocation: () => ({}), useNavigate: () => () => {} }), { virtual: true });
jest.mock('../../api/client', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() }));

let seq = 0;
const row = (extra) => ({ _id: (seq += 1), ItemType: 'pit_Item', ItemCode: '', ItemName: '', StageID: null, ...extra });

test('stage rows become ProductTreeStages and following rows get their StageID', () => {
  const rows = [
    row({ ItemCode: 'TOP' }),
    row({ ItemType: STAGE_TYPE, StageEntry: 7, ItemName: 'Cutting' }),
    row({ ItemCode: 'A' }),
    row({ ItemType: 'pit_Resource', ItemCode: 'R1' }),
    row({ ItemType: STAGE_TYPE, StageEntry: 3, ItemName: 'Assembly' }),
    row({ ItemCode: 'B' }),
  ];
  const { stages, components } = splitStageRows(rows);
  expect(stages).toEqual([
    { StageID: 1, StageEntry: 7, Name: 'Cutting' },
    { StageID: 2, StageEntry: 3, Name: 'Assembly' },
  ]);
  expect(components.map((c) => [c.ItemCode, c.StageID])).toEqual([['TOP', null], ['A', 1], ['R1', 1], ['B', 2]]);
});

test('loaded stages rebuild stage rows; lines without a stage stay on top', () => {
  const stages = [
    { StageID: 2, SequenceNumber: 2, StageEntry: 3, Name: 'Assembly', StageCode: 'ASM' },
    { StageID: 1, SequenceNumber: 1, StageEntry: 7, Name: 'Cutting', StageCode: 'CUT' },
  ];
  const lines = [row({ ItemCode: 'B', StageID: 2 }), row({ ItemCode: 'A', StageID: 1 }), row({ ItemCode: 'TOP' })];
  const rows = buildRowsWithStages(stages, lines, () => row());
  expect(rows.map((r) => (r.ItemType === STAGE_TYPE ? `stage:${r.ItemCode}` : r.ItemCode))).toEqual([
    'TOP', 'stage:CUT', 'A', 'stage:ASM', 'B',
  ]);
  // Round trip keeps the stage entries and assignments.
  const { stages: saved, components } = splitStageRows(rows);
  expect(saved.map((s) => s.StageEntry)).toEqual([7, 3]);
  expect(components.map((c) => [c.ItemCode, c.StageID])).toEqual([['TOP', null], ['A', 1], ['B', 2]]);
});
