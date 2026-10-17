import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DocumentCurrencySelect from './DocumentCurrencySelect';

const currencies = [
  { CurrCode: 'INR', CurrName: 'Indian Rupee' },
  { CurrCode: 'USD', CurrName: 'US Dollar' },
  { CurrCode: 'EUR', CurrName: 'Euro' },
];

test('keeps a fixed-currency SAP business partner on its assigned currency and shows its rate', () => {
  render(
    <DocumentCurrencySelect
      header={{ vendor: 'C-USD', currencyMode: 'BP', currency: 'USD', exchangeRate: '86.5' }}
      businessPartners={[{ CardCode: 'C-USD', Currency: 'USD' }]}
      currencyOptions={currencies}
      localCurrency="INR"
      systemCurrency="EUR"
    />,
  );

  expect(screen.queryByTitle('Document Currency')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Document Currency (fixed)')).toHaveValue('USD');
  expect(screen.getByLabelText('Document Currency (fixed)')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Exchange Rate')).toHaveValue('86.5');
});

test('shows only included company currencies for an all-currencies SAP business partner', () => {
  render(
    <DocumentCurrencySelect
      header={{ vendor: 'C-ALL', currencyMode: 'BP', currency: 'USD', exchangeRate: '86' }}
      businessPartners={[{
        CardCode: 'C-ALL',
        Currency: '##',
        BPCurrencies: [
          { CurrencyCode: 'USD', Include: 'Y' },
          { CurrencyCode: 'EUR', Include: 'N' },
        ],
      }]}
      currencyOptions={currencies}
      localCurrency="INR"
      systemCurrency="EUR"
    />,
  );

  const selector = screen.getByTitle('Document Currency');
  expect([...selector.querySelectorAll('option')].map((option) => option.value)).toEqual(['USD']);
  expect(screen.getByLabelText('Exchange Rate')).toHaveValue('86');
});

test('switching currency source emits the resolved document currency and clears old rate', () => {
  const onHeaderChange = jest.fn();
  render(
    <DocumentCurrencySelect
      header={{ vendor: 'C-USD', currencyMode: 'BP', currency: 'USD', exchangeRate: '86.5' }}
      onHeaderChange={onHeaderChange}
      businessPartners={[{ CardCode: 'C-USD', Currency: 'USD' }]}
      currencyOptions={currencies}
      localCurrency="INR"
      systemCurrency="EUR"
    />,
  );

  fireEvent.change(screen.getByLabelText('Currency Source'), { target: { value: 'LOCAL' } });

  expect(onHeaderChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ name: 'currencyMode', value: 'LOCAL' }) }));
  expect(onHeaderChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ name: 'currency', value: 'INR' }) }));
  expect(onHeaderChange).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ name: 'exchangeRate', value: '' }) }));
});

test('local currency mode still shows which currency the document uses', () => {
  render(
    <DocumentCurrencySelect
      header={{ vendor: 'C-INR', currencyMode: 'LOCAL', currency: 'INR' }}
      businessPartners={[{ CardCode: 'C-INR', Currency: 'INR' }]}
      currencyOptions={currencies}
      localCurrency="INR"
    />,
  );
  expect(screen.getByLabelText('Document Currency (fixed)')).toHaveValue('INR');
});
