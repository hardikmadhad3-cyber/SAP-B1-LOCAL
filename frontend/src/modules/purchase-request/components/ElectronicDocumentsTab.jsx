import React from 'react';
import DocumentEDocTab from '../../../components/document/DocumentEDocTab';

const RECEIVED_FORMATS = ['JSON', 'XML'];

// Purchase Request Electronic Documents tab: shared SAP B1 layout. Received eDoc keys: edocFormat / documentStatus.
export default function ElectronicDocumentsTab({ disabled, ...props }) {
  return <DocumentEDocTab isEditable={!disabled} {...props} variant="purchase" names={{ genericFormat: 'edocFormat', genericStatus: 'documentStatus' }} genericFormats={RECEIVED_FORMATS} />;
}
