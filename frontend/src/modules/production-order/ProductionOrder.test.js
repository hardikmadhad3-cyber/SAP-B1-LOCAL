import React from 'react';
import { render, screen } from '@testing-library/react';
import ProductionOrderModule from './ProductionOrder';

jest.mock('react-router-dom', () => ({ useLocation: () => ({}), useNavigate: () => () => {} }), { virtual: true });
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: {} }) }));
jest.mock('../../api/client', () => ({
  // plain functions: CRA's resetMocks would clear jest.fn implementations
  get: () => Promise.resolve({ data: {} }),
  post: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
}));

test('a new order renders in Add mode with the status locked and no unsaved fields', async () => {
  render(<ProductionOrderModule />);
  expect(await screen.findByText('Add Mode')).toBeInTheDocument();
  expect(screen.getByTitle(/Status changes through/)).toBeDisabled();
  expect(screen.queryByText('Routing Date Calculation')).toBeNull();
  expect(screen.queryByText('Procure Items')).toBeNull();
  expect(screen.getByLabelText('Pick and Pack Remarks')).toBeInTheDocument();
});
