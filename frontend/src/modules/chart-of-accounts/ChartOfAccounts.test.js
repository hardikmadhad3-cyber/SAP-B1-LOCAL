import { previewAccountLevel } from './ChartOfAccounts';

jest.mock('react-router-dom', () => ({ useLocation: () => ({}), useNavigate: () => () => {} }), { virtual: true });
jest.mock('../../api/client', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn() }));

const parents = [{ code: '100000', level: 1 }, { code: '130000', level: 2 }];

test('a new top-level account is level 1, a child is one below its parent', () => {
  expect(previewAccountLevel({ Level: '', FatherAccountKey: '' }, parents)).toBe(1);
  expect(previewAccountLevel({ Level: '', FatherAccountKey: '130000' }, parents)).toBe(3);
});

test('a saved account keeps its stored level', () => {
  expect(previewAccountLevel({ Level: 4, FatherAccountKey: '100000' }, parents)).toBe(4);
});
