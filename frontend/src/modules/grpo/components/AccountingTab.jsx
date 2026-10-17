import React from 'react';
import DocumentAccountingTab from '../../../components/document/DocumentAccountingTab';

// GRPO Accounting tab: shared SAP B1 layout plus this company's advance /
// shipment terms rows, kept under their existing header keys.
const GRPO_EXTRA_FIELDS = [
  { key: 'paymentTerms2', label: 'Payment Terms 2' },
  { key: 'advancePaymentPercent', label: 'Advance Payment %' },
  { key: 'advanceAmt', label: 'Advance Amount' },
  { key: 'balancePaymentAgainst', label: 'Balance Payment' },
  { key: 'shipmentWithin', label: 'Shipment Within', column: 'right' },
  { key: 'expiryDate', label: 'Expiry Date', type: 'date', column: 'right' },
  { key: 'advanceDate', label: 'Advance Date', type: 'date', column: 'right' },
  { key: 'withinDays', label: 'Within Days', type: 'number', column: 'right' },
  { key: 'daysFrom', label: 'Days From', column: 'right' },
];

export default function AccountingTab({ paymentTermOptions, payTermOpts, ...props }) {
  return (
    <DocumentAccountingTab
      {...props}
      paymentTermOptions={paymentTermOptions?.length ? paymentTermOptions : payTermOpts}
      names={{ centralBankIndicator: 'centralBankInd', qrCodeFrom: 'qrCodeFrom', cashDiscountOffset: 'cashDiscountOffset' }}
      extraFields={GRPO_EXTRA_FIELDS}
    />
  );
}
