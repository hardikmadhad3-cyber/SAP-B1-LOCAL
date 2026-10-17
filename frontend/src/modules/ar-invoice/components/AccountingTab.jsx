import React from 'react';
import DocumentAccountingTab from '../../../components/document/DocumentAccountingTab';

// A/R Invoice (also Service A/R Invoice / Credit Memo) Accounting tab: shared SAP B1 layout; this page's header keys below.
export default function AccountingTab({ payTermOpts, paymentTermOptions, paymentMethodOpts, ...props }) {
  return (
    <DocumentAccountingTab
      {...props}
      paymentTermOptions={payTermOpts?.length ? payTermOpts : paymentTermOptions}
      paymentMethodOptions={paymentMethodOpts}
      fields={{ dates: false, owner: true, consolidation: true, shippedGoods: true }}
    />
  );
}
