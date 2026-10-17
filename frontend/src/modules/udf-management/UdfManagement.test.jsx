import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UdfManagement from './UdfManagement';
import api from '../../api/client';

jest.mock('../../api/client', () => ({ get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() }));

const META = {
  groups: [{ group: 'Marketing Documents', tables: [{ code: 'ORDR', label: 'Title (all marketing documents)' }, { code: 'RDR1', label: 'Rows (all marketing documents)' }] }],
  types: [
    { name: 'db_Alpha', label: 'Alphanumeric', subTypes: ['st_None', 'st_Address', 'st_Phone'], size: [1, 254, 10] },
    { name: 'db_Float', label: 'Units and Totals', subTypes: ['st_Rate', 'st_Sum', 'st_Price', 'st_Quantity', 'st_Percentage', 'st_Measurement'], size: null },
  ],
  linkable: ['OCRD', 'OITM'],
  local: true,
};
const AREA = { TableName: 'RDR1', FieldID: 0, Name: 'Area', Description: 'Area', Type: 'db_Float', SubType: 'st_Quantity',
  Mandatory: 'tNO', ValidValuesMD: [], Formula: 'U_Length * U_Width', Validation: null, ValidationMessage: null };

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((url, config) => Promise.resolve({ data: url === '/udfs/tables' ? META
    : { table: config.params.table, sharedWith: ['ORDR', 'OINV'], fields: config.params.table === 'RDR1' ? [AREA] : [] } }));
});

test('adds a marketing-document field with valid values and a validation rule', async () => {
  api.post.mockResolvedValue({ data: { TableName: 'ORDR', FieldID: 0, Name: 'Approved', Description: 'Approved', Type: 'db_Alpha', SubType: 'st_None', ValidValuesMD: [] } });
  render(<UdfManagement />);
  await screen.findByText('No user-defined fields on this table yet.');
  fireEvent.change(screen.getByLabelText('Field name*'), { target: { value: 'U_Approved' } });
  fireEvent.change(screen.getByLabelText('Description*'), { target: { value: 'Approved' } });
  fireEvent.change(screen.getByLabelText('Length'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add value' }));
  fireEvent.change(screen.getByLabelText('Value 1'), { target: { value: 'Y' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add value' }));
  fireEvent.change(screen.getByLabelText('Value 2'), { target: { value: 'N' } });
  fireEvent.change(screen.getByLabelText('Default value'), { target: { value: 'N' } });
  fireEvent.click(screen.getByLabelText('Mandatory'));
  fireEvent.change(screen.getByLabelText('Validation rule'), { target: { value: "U_Approved = 'Y' OR DocTotal < 1000" } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  await screen.findByText(/Field U_Approved added/);
  expect(api.post).toHaveBeenCalledWith('/udfs', expect.objectContaining({
    TableName: 'ORDR', Name: 'Approved', Type: 'db_Alpha', EditSize: '1', Mandatory: 'tYES', DefaultValue: 'N',
    ValidValuesMD: [{ Value: 'Y', Description: '' }, { Value: 'N', Description: '' }], Validation: "U_Approved = 'Y' OR DocTotal < 1000",
  }));
});

test('edits a row field: name and type are fixed, errors are shown', async () => {
  api.patch.mockRejectedValue({ response: { data: { message: 'The formula uses "U_Nope", which is not a field of RDR1.' } } });
  render(<UdfManagement />);
  fireEvent.click(await screen.findByRole('button', { name: /Rows \(all marketing documents\)/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.getByLabelText('Field name*')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Type')).toBeDisabled();
  expect(screen.getByLabelText('Formula')).toHaveValue('U_Length * U_Width');
  fireEvent.change(screen.getByLabelText('Formula'), { target: { value: 'U_Nope * 2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('U_Nope');
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/udfs/RDR1/0', expect.objectContaining({ Formula: 'U_Nope * 2' })));
});
