import React from 'react';
import { render, waitFor } from '@testing-library/react';
import HeaderUdfSidebar from './HeaderUdfSidebar';
import { getBP } from '../../api/businessPartnerApi';

jest.mock('../../api/businessPartnerApi', () => ({
  getBP: jest.fn(),
  searchBP: jest.fn(),
}));
jest.mock('../../api/predefinedTextApi', () => ({
  createPredefinedText: jest.fn(),
  fetchPredefinedTexts: jest.fn(),
}));
jest.mock('../../modules/sales-order/components/BusinessPartnerModal', () => () => null);
jest.mock('../common/SapLookupModal', () => () => null);
jest.mock('../sales-document/LineValueLookupModal', () => () => null);

const fields = [
  { key: 'U_Seller_Code', label: 'Seller Code', type: 'text' },
  { key: 'U_Seller_AddressId', label: 'Seller Address Id (Ship From)', type: 'text' },
  { key: 'U_Seller_Address', label: 'Seller Address', type: 'textarea' },
];

const renderSidebar = (values, onFieldChange) => render(
  <HeaderUdfSidebar
    isOpen
    fields={fields}
    formSettings={{ headerUdfs: {} }}
    values={values}
    onFieldChange={onFieldChange}
  />
);

beforeEach(() => {
  getBP.mockReset();
  getBP.mockResolvedValue({
    BPAddresses: [
      { AddressName: 'FACTORY', Street: 'P.O. Kathwada', City: 'Ahmedabad', State: 'GJ', ZipCode: '382430', Country: 'IN' },
      { AddressName: 'OFFICE', Street: 'Other address' },
    ],
  });
});

test('loads the saved seller address text from its address ID', async () => {
  const onFieldChange = jest.fn();
  renderSidebar({ U_Seller_Code: 'VEN00485', U_Seller_AddressId: 'FACTORY', U_Seller_Address: '' }, onFieldChange);

  await waitFor(() => expect(onFieldChange).toHaveBeenCalledWith(
    'U_Seller_Address', 'P.O. Kathwada\nAhmedabad, GJ, 382430\nIN'
  ));
  expect(getBP).toHaveBeenCalledWith('VEN00485');
});

test('keeps a saved seller address text instead of replacing it with current master data', () => {
  const onFieldChange = jest.fn();
  renderSidebar({ U_Seller_Code: 'VEN00485', U_Seller_AddressId: 'FACTORY', U_Seller_Address: 'Saved address' }, onFieldChange);

  expect(getBP).not.toHaveBeenCalled();
  expect(onFieldChange).not.toHaveBeenCalled();
});
