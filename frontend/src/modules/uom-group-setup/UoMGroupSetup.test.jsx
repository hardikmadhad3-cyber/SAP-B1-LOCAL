import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UoMGroupSetup from './UoMGroupSetup';
import GroupDefinitionModal from './components/GroupDefinitionModal';
import * as api from '../../api/uomGroupApi';

let mockCompany = { companyId: 1, dbName: 'cmp_a' };
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ company: mockCompany }) }));
jest.mock('../../api/uomGroupApi', () => ({ createUoMGroup: jest.fn(), updateUoMGroup: jest.fn(), searchUoMGroups: jest.fn(), fetchUoMs: jest.fn(), createUoM: jest.fn(), getUoMGroup: jest.fn() }));
const ea = { code: '1', name: 'EA - Each', uomCode: 'EA', uomName: 'Each' };
const kgs = { code: '2', name: 'KGS - Kilogram', uomCode: 'KGS', uomName: 'Kilogram' };
const group = { AbsEntry: 1, Code: 'EA', Name: 'Each', BaseUoM: 1 };

beforeEach(() => {
  jest.resetAllMocks();
  mockCompany = { companyId: 1, dbName: 'cmp_a' };
  api.fetchUoMs.mockResolvedValue([ea, kgs]);
  api.searchUoMGroups.mockResolvedValue([group]);
  api.createUoMGroup.mockResolvedValue({ AbsEntry: 2 });
  api.updateUoMGroup.mockResolvedValue(group);
  api.getUoMGroup.mockResolvedValue({ ...group, UoMGroupDefinitionCollection: [{ AlternateUoM: 1, AlternateQuantity: 1, BaseQuantity: 1 }] });
});

test('existing units are visible separately from groups and selectable as the base', async () => {
  render(<UoMGroupSetup />);
  await screen.findByDisplayValue('Each');
  expect(screen.getByLabelText('Base UoM 2')).toContainHTML('KGS - Kilogram');
  fireEvent.click(screen.getByRole('tab', { name: 'Units of Measure' }));
  expect(screen.getByText('KGS')).toBeInTheDocument();
  expect(screen.getByText('Kilogram')).toBeInTheDocument();
});

test('duplicate unit errors refresh the saved unit list', async () => {
  api.fetchUoMs.mockResolvedValueOnce([ea]).mockResolvedValue([ea, kgs]);
  api.createUoM.mockRejectedValue({ response: { data: { message: 'Unit of measure "KGS" already exists.' } } });
  render(<UoMGroupSetup />);
  await screen.findByDisplayValue('Each');
  fireEvent.click(screen.getByRole('tab', { name: 'Units of Measure' }));
  fireEvent.change(screen.getByLabelText('UoM Code*'), { target: { value: 'KGS' } });
  fireEvent.change(screen.getByLabelText('UoM Name*'), { target: { value: 'Kilogram' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add UoM' }));
  expect(await screen.findByText('KGS')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('already exists');
});

test('group save skips unused padding rows', async () => {
  render(<UoMGroupSetup />);
  await screen.findByDisplayValue('Each');
  fireEvent.change(screen.getByLabelText('Group code 2'), { target: { value: 'WEIGHT' } });
  fireEvent.change(screen.getByLabelText('Group name 2'), { target: { value: 'Weight' } });
  fireEvent.change(screen.getByLabelText('Base UoM 2'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(api.createUoMGroup).toHaveBeenCalledWith({ Code: 'WEIGHT', Name: 'Weight', BaseUoM: 2 }));
  expect(await screen.findByText('UoM Groups saved successfully.')).toBeInTheDocument();
});

test('validates every entered group before any writes', async () => {
  render(<UoMGroupSetup />);
  await screen.findByDisplayValue('Each');
  fireEvent.change(screen.getByLabelText('Group code 2'), { target: { value: 'KGS' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  expect(screen.getByRole('alert')).toHaveTextContent('required');
  expect(api.createUoMGroup).not.toHaveBeenCalled();
  expect(api.updateUoMGroup).not.toHaveBeenCalled();
});

test('changing company replaces groups and units', async () => {
  const { rerender } = render(<UoMGroupSetup />);
  await screen.findByDisplayValue('Each');
  api.fetchUoMs.mockResolvedValue([ea]);
  api.searchUoMGroups.mockResolvedValue([{ ...group, Name: 'Second company' }]);
  mockCompany = { companyId: 2, dbName: 'cmp_b' };
  rerender(<UoMGroupSetup />);
  expect(await screen.findByDisplayValue('Second company')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Units of Measure' }));
  expect(screen.queryByText('KGS')).not.toBeInTheDocument();
});

test('all group search pages are loaded', async () => {
  api.searchUoMGroups.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...group, AbsEntry: i + 1, Code: 'G' + i }))).mockResolvedValueOnce([{ ...group, AbsEntry: 51, Code: 'LAST' }]);
  render(<UoMGroupSetup />);
  expect(await screen.findByDisplayValue('LAST')).toBeInTheDocument();
  expect(api.searchUoMGroups).toHaveBeenCalledWith('', 50, 50);
});

test('retry after a partial save does not create the first group twice', async () => {
  api.createUoMGroup.mockResolvedValueOnce({ AbsEntry: 2 }).mockRejectedValueOnce(new Error('Second group failed')).mockResolvedValueOnce({ AbsEntry: 3 });
  render(<UoMGroupSetup />);
  await screen.findByDisplayValue('Each');
  for (const index of [2, 3]) {
    fireEvent.change(screen.getByLabelText('Group code ' + index), { target: { value: 'NEW' + index } });
    fireEvent.change(screen.getByLabelText('Group name ' + index), { target: { value: 'New group ' + index } });
    fireEvent.change(screen.getByLabelText('Base UoM ' + index), { target: { value: '2' } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Second group failed');
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  expect(await screen.findByText('UoM Groups saved successfully.')).toBeInTheDocument();
  expect(api.createUoMGroup.mock.calls.map(([payload]) => payload.Code)).toEqual(['NEW2', 'NEW3', 'NEW3']);
});

test('base conversion is fixed and padded conversion rows can be edited', async () => {
  render(<GroupDefinitionModal group={group} uomOptions={[ea, kgs]} onClose={jest.fn()} onSave={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled());
  expect(screen.getByLabelText('AlternateQuantity 1')).toBeDisabled();
  expect(screen.getByLabelText('Delete row 1')).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Alternate UoM 3'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('BaseQuantity 3'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  expect(screen.getByRole('alert')).toHaveTextContent('greater than zero');
  expect(api.updateUoMGroup).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('BaseQuantity 3'), { target: { value: '0.001' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  await waitFor(() => expect(api.updateUoMGroup).toHaveBeenCalledWith(1, { UoMGroupDefinitionCollection: [
    { AlternateUoM: 1, AlternateQuantity: 1, BaseQuantity: 1 },
    { AlternateUoM: 2, AlternateQuantity: 1, BaseQuantity: 0.001 },
  ] }));
});

test('failed definition loads cannot overwrite saved conversion rules', async () => {
  api.getUoMGroup.mockRejectedValue(new Error('Database unavailable'));
  render(<GroupDefinitionModal group={group} uomOptions={[ea]} onClose={jest.fn()} onSave={jest.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
  expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
});
