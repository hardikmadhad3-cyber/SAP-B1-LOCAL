import React from 'react';
import DocumentTaxTab from '../../../components/document/DocumentTaxTab';

// GRPO stores Form No. as `formNo` and Duty Status as its full text.
const GRPO_DUTY_OPTIONS = [
  { value: 'With Payment of Duty', label: 'With Payment of Duty' },
  { value: 'Without Payment of Duty', label: 'Without Payment of Duty' },
  { value: 'Exempted', label: 'Exempted' },
];

export default function TaxTab(props) {
  return <DocumentTaxTab {...props} variant="purchase" names={{ formNo: 'formNo' }} dutyOptions={GRPO_DUTY_OPTIONS} />;
}
