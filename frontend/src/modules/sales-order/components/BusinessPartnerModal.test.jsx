import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BusinessPartnerModal from './BusinessPartnerModal';

test('searches all company business partners after Tab from a Header UDF', async () => {
  window.__sapB1PendingLookupQuery = 'te';
  const fetchPartners = jest.fn(async (query) => query === 'te'
    ? [{ CardCode: 'V9000', CardName: 'Test Supplier', CardType: 'cSupplier' }]
    : []);

  render(
    <BusinessPartnerModal
      isOpen
      onClose={jest.fn()}
      onSelect={jest.fn()}
      title="Vendor Code"
      variant="seller"
      fetchPartners={fetchPartners}
    />,
  );

  await waitFor(() => expect(fetchPartners).toHaveBeenCalledWith('te', { skip: 0, top: 200 }));
  expect(await screen.findByText('Test Supplier')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Find'), { target: { value: 'new' } });
  await waitFor(() => expect(fetchPartners).toHaveBeenCalledWith('new', { skip: 0, top: 200 }));
});
