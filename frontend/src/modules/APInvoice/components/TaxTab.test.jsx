import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TaxTab from './TaxTab';

test('renders the shared SAP B1 document tab layout with A/P stored values', () => {
  const onHeaderChange = jest.fn();
  render(
    <TaxTab
      header={{ differentialTaxRate: '100', dutyStatus: 'Exempted', formNo: 'F-1' }}
      onHeaderChange={onHeaderChange}
      onOpenTaxInfoModal={() => {}}
    />
  );

  expect(screen.getByRole('tabpanel')).toHaveClass('sap-doc-tab');
  expect(screen.getByLabelText('Duty Status')).toHaveValue('Exempted');
  expect(screen.getByLabelText('Form No.')).toHaveValue('F-1');
  expect(screen.getByRole('checkbox', { name: 'Import' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Reason for Issuing Note')).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Transaction Category'), { target: { value: 'Export' } });
  expect(onHeaderChange).toHaveBeenCalled();
});

test('credit memos hide Duty Status and show the original reference and reason', () => {
  render(
    <TaxTab header={{}} onHeaderChange={() => {}} onOpenTaxInfoModal={() => {}} showTaxInvoiceReference taxInvoiceReferenceRequired />
  );

  expect(screen.queryByLabelText('Duty Status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Original Ref. No. *')).toBeInTheDocument();
  expect(screen.getByLabelText('Reason for Issuing Note')).toHaveValue('Sales Return');
});
