import React from 'react';
import SalesLogisticsTab from '../../../components/document/SalesLogisticsTab';

// Delivery Logistics: shared SAP B1 layout; this page's header keys below.
export default function LogisticsTab({
  vendorShipToAddresses,
  vendorBillToAddresses,
  vendorPayToAddresses,
  shipTypeOpts,
  shippingTypeOptions,
  ...props
}) {
  return (
    <SalesLogisticsTab
      {...props}
      documentType="delivery"
      shipToAddresses={vendorShipToAddresses}
      billToAddresses={vendorBillToAddresses}
      payToAddresses={vendorPayToAddresses}
      shippingTypeOptions={shipTypeOpts?.length ? shipTypeOpts : shippingTypeOptions}
      names={{ language: 'languageCode', bpChannelName: 'bpChannelCode' }}
    />
  );
}
