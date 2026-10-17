import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LogisticsTab from './LogisticsTab';

const renderTab = (confirmed, onHeaderChange = jest.fn()) => render(
  <LogisticsTab header={{ confirmed }} onHeaderChange={onHeaderChange}
    vendorShipToAddresses={[]} vendorBillToAddresses={[]} shipTypeOpts={[]}
    onOpenAddressModal={jest.fn()} />,
);

test('does not default a new delivery to an explicit unconfirmed choice', () => {
  const change = jest.fn();
  renderTab(undefined, change);
  const checkbox = screen.getByRole('checkbox', { name: 'Approved' });
  expect(checkbox).toBeChecked();
  expect(checkbox).toHaveAttribute('title', 'SAP company default; click to choose explicitly');
  fireEvent.click(checkbox);
  expect(change).toHaveBeenCalled();
});

test('keeps the saved unconfirmed state visible and allows confirming it', () => {
  const change = jest.fn();
  renderTab(false, change);
  const checkbox = screen.getByRole('checkbox', { name: 'Approved' });
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeEnabled();
  fireEvent.click(checkbox);
  expect(change).toHaveBeenCalled();
});
