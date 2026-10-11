import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LiveUdfValueInput from './LiveUdfValueInput';
import { fetchSalesDocumentLookup } from '../../api/salesDocumentSchemaApi';

let mockActiveCompany = { companyId: 1, dbName: 'COMPANY_A' };
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ company: mockActiveCompany }) }));
jest.mock('../../api/salesDocumentSchemaApi', () => ({ fetchSalesDocumentLookup: jest.fn() }));
jest.mock('./LineValueLookupModal', () => ({ isOpen, options, onSelect }) => isOpen ? (
  <div>{options.map((option) => <button key={option.value} onClick={() => onSelect(option)}>{option.label}</button>)}</div>
) : null);

test('loads values when opened and clears the previous company values on company change', async () => {
  mockActiveCompany = { companyId: 1, dbName: 'COMPANY_A' };
  fetchSalesDocumentLookup.mockResolvedValueOnce({ options: [{ value: 'A', label: 'Company A value' }] });
  const onChange = jest.fn();
  const field = { key: 'U_Grade', label: 'Grade', tableId: 'POR1', schemaFieldId: 'POR1.U_Grade', lookupSource: 'udf-valid-values' };
  const view = render(<LiveUdfValueInput field={field} value="" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose Grade value' }));
  await waitFor(() => expect(screen.getByText('Company A value')).toBeTruthy());
  expect(fetchSalesDocumentLookup).toHaveBeenCalledWith('udf-valid-values', expect.objectContaining({ fieldId: 'POR1.U_Grade', documentType: 'PURCHASE_ORDER' }));
  mockActiveCompany = { companyId: 2, dbName: 'COMPANY_B' };
  view.rerender(<LiveUdfValueInput field={field} value="" onChange={onChange} />);
  await waitFor(() => expect(screen.queryByText('Company A value')).toBeNull());
  fetchSalesDocumentLookup.mockResolvedValueOnce({ options: [{ value: 'B', label: 'Company B value' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Choose Grade value' }));
  await waitFor(() => expect(screen.getByText('Company B value')).toBeTruthy());
  fireEvent.click(screen.getByText('Company B value'));
  expect(onChange).toHaveBeenCalledWith('B');
});
