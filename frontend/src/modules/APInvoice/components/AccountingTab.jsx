import React from 'react';
import DocumentAccountingTab from '../../../components/document/DocumentAccountingTab';

// A/P Invoice Accounting tab (also the service A/P documents). Shared SAP B1
// layout plus the A/P-only Control Account / Payment Block / Max. Cash
// Discount rows; header keys are this page's existing ones.
const AP_CONSOLIDATION_TYPES = ['Payment Consolidation', 'Delivery Consolidation', 'None'].map((value) => ({ value, label: value }));
const AP_DUE_DATE_BASIS = [
  { value: '', label: 'None' },
  { value: 'selectedDate', label: 'Selected Date' },
  { value: 'monthsDays', label: 'Months + Days' },
];

export default function AccountingTab({ paymentTermOptions, payTermOpts, ...props }) {
  return (
    <DocumentAccountingTab
      {...props}
      paymentTermOptions={paymentTermOptions?.length ? paymentTermOptions : payTermOpts}
      names={{
        qrCodeFrom: 'qrCodeFrom',
        cashDiscountOffset: 'cashDiscountOffset',
        consolidatingBP: 'consolidatingBp',
        dueMode: 'dueDateBasis',
        referencedDocument: 'referencedDocument',
      }}
      consolidationOptions={AP_CONSOLIDATION_TYPES}
      dueModeOptions={AP_DUE_DATE_BASIS}
      fields={{ apControls: true, dates: false, consolidation: true }}
    />
  );
}
