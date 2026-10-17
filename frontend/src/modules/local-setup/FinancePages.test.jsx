import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OpeningBalances from './OpeningBalances';
import InternalReconciliation from './InternalReconciliation';
import * as api from '../../api/localFinanceApi';

jest.mock('../../api/localFinanceApi', () => ({
  fetchOpeningBalances: jest.fn(), postOpeningBalances: jest.fn(),
  fetchReconcilablePartners: jest.fn(), fetchOpenRows: jest.fn(), reconcileRows: jest.fn(),
}));

const lookups = {
  entries: [],
  accounts: [{ AcctCode: '100000', AcctName: 'Cash' }, { AcctCode: '300000', AcctName: 'Opening Balance Equity' }],
  partners: [{ CardCode: 'C001', CardName: 'Acme Ltd', CardType: 'C' }],
  items: [{ ItemCode: 'I001', ItemName: 'Widget' }],
  warehouses: [{ WhsCode: '01', WhsName: 'Main' }],
};

describe('Opening Balances page', () => {
  beforeEach(() => jest.resetAllMocks());

  it('posts only the filled business partner rows and reloads the list', async () => {
    api.fetchOpeningBalances.mockResolvedValue(lookups);
    api.postOpeningBalances.mockResolvedValue({ kind: 'partners', TransId: 9, Number: 4 });
    render(<OpeningBalances />);
    await screen.findAllByRole('option', { name: '100000 - Cash' });
    fireEvent.click(screen.getByRole('tab', { name: 'Business Partners' }));
    fireEvent.change(screen.getByLabelText('Business partner row 1'), { target: { value: 'C001' } });
    fireEvent.change(screen.getByLabelText('Debit row 1'), { target: { value: '1180' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(api.postOpeningBalances).toHaveBeenCalledWith('partners', expect.objectContaining({
      rows: [{ CardCode: 'C001', Debit: '1180' }], offsetAccount: '',
    })));
    expect(await screen.findByRole('status')).toHaveTextContent('Opening balance posted (journal entry 4).');
    expect(api.fetchOpeningBalances).toHaveBeenCalledTimes(2);
  });

  it('shows server errors as an alert', async () => {
    api.fetchOpeningBalances.mockResolvedValue(lookups);
    api.postOpeningBalances.mockRejectedValue({ response: { data: { message: 'Row 1: enter either a debit or a credit amount.' } } });
    render(<OpeningBalances />);
    await screen.findAllByRole('option', { name: '100000 - Cash' });
    fireEvent.change(screen.getByLabelText('G/L account row 1'), { target: { value: '100000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Row 1: enter either a debit or a credit amount.');
  });
});

describe('Internal Reconciliation page', () => {
  beforeEach(() => jest.resetAllMocks());

  it('reconciles only when the selected debits and credits are equal', async () => {
    api.fetchReconcilablePartners.mockResolvedValue([{ CardCode: 'C001', CardName: 'Acme Ltd', OpenRows: 2 }]);
    api.fetchOpenRows.mockResolvedValue([
      { TransId: 5, LineId: 0, TransType: 13, BaseRef: '12', Open: 300 },
      { TransId: 7, LineId: 1, TransType: 24, BaseRef: '3', Open: -200 },
    ]);
    api.reconcileRows.mockResolvedValue({ ReconNum: 1 });
    render(<InternalReconciliation />);
    await screen.findByRole('option', { name: 'C001 - Acme Ltd (2)' });
    fireEvent.change(screen.getByLabelText('Business partner'), { target: { value: 'C001' } });
    fireEvent.click(await screen.findByLabelText('Select A/R Invoice 12'));
    fireEvent.click(screen.getByLabelText('Select Incoming Payment 3'));
    const reconcile = screen.getByRole('button', { name: 'Reconcile' });
    expect(reconcile).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Amount to reconcile 12'), { target: { value: '200' } });
    expect(reconcile).toBeEnabled();
    fireEvent.click(reconcile);
    await waitFor(() => expect(api.reconcileRows).toHaveBeenCalledWith(expect.objectContaining({
      CardCode: 'C001', Rows: [{ TransId: 5, LineId: 0, Amount: 200 }, { TransId: 7, LineId: 1, Amount: 200 }],
    })));
    expect(await screen.findByRole('status')).toHaveTextContent('Reconciliation 1 saved.');
  });

  it('Auto Reconcile matches the smaller side oldest first and blocks amounts above the open amount', async () => {
    api.fetchReconcilablePartners.mockResolvedValue([{ CardCode: 'C001', CardName: 'Acme Ltd', OpenRows: 3 }]);
    api.fetchOpenRows.mockResolvedValue([
      { TransId: 5, LineId: 0, TransType: 13, BaseRef: '3', Open: 107970 },
      { TransId: 6, LineId: 0, TransType: 14, BaseRef: '1', Open: -3540 },
      { TransId: 8, LineId: 0, TransType: 13, BaseRef: '6', Open: 23600 },
    ]);
    render(<InternalReconciliation />);
    await screen.findByRole('option', { name: 'C001 - Acme Ltd (3)' });
    fireEvent.change(screen.getByLabelText('Business partner'), { target: { value: 'C001' } });
    fireEvent.click(await screen.findByLabelText('Select A/R Invoice 3'));
    fireEvent.click(screen.getByLabelText('Select A/R Credit Memo 1'));
    fireEvent.click(screen.getByLabelText('Select A/R Invoice 6'));
    fireEvent.click(screen.getByRole('button', { name: 'Auto Reconcile' }));
    expect(screen.getByLabelText('Amount to reconcile 3')).toHaveValue(3540);
    expect(screen.getByLabelText('Amount to reconcile 1')).toHaveValue(3540);
    expect(screen.getByLabelText('Amount to reconcile 6')).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Amount to reconcile 1'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Amount to reconcile 3'), { target: { value: '5000' } });
    expect(screen.getByRole('alert')).toHaveTextContent('cannot be more than the open amount');
    expect(screen.getByRole('button', { name: 'Reconcile' })).toBeDisabled();
  });
});
