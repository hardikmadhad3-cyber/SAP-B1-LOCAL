import React from 'react';
import DocumentTaxTab from '../../../components/document/DocumentTaxTab';

// A/R Credit Memo Tax tab: shared SAP B1 layout (components/document/DocumentTaxTab).
export default function TaxTab(props) {
  return <DocumentTaxTab {...props} variant="sales" />;
}
