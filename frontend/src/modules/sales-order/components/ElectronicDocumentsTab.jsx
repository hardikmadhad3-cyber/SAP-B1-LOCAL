import React from 'react';
import DocumentEDocTab from '../../../components/document/DocumentEDocTab';

// Sales Order Electronic Documents tab: shared SAP B1 layout.
export default function ElectronicDocumentsTab({ disabled, ...props }) {
  return <DocumentEDocTab isEditable={!disabled} {...props} variant="sales" />;
}
