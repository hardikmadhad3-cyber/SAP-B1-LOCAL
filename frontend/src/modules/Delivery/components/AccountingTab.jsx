import React from 'react';
import DocumentAccountingTab from '../../../components/document/DocumentAccountingTab';

// Delivery Accounting tab: shared SAP B1 layout; this page's header keys below.
export default function AccountingTab({ payTermOpts, paymentTermOptions, paymentMethodOpts, ...props }) {
  return (
    <DocumentAccountingTab
      {...props}
      paymentTermOptions={payTermOpts?.length ? payTermOpts : paymentTermOptions}
      paymentMethodOptions={paymentMethodOpts}
      names={{ bpProject: 'projectCode', qrCodeFrom: 'qrCodeSource' }}
      fields={{ dates: false, owner: true, consolidation: true, dueDate: false, shippedGoods: true }}
    />
  );
}
