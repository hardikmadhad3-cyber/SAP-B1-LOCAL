import React from 'react';
import DocumentTaxTab from '../../../components/document/DocumentTaxTab';

// Sales Quotation Tax tab: shared SAP B1 layout (components/document/DocumentTaxTab).
export default function TaxTab(props) {
  return <DocumentTaxTab {...props} variant="sales" />;
}
