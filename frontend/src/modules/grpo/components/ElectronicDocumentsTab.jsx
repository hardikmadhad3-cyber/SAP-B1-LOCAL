import SapDateInput from '../../../components/common/SapDateInput';
import React from 'react';

export default function ElectronicDocumentsTab({ header, onHeaderChange }) {
  return (
    <div>
      <div className="po-section-title">Electronic Documents</div>
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div className="po-field">
            <label className="po-field__label">eDoc Format</label>
            <select className="po-field__select" name="edocFormat" value={header.edocFormat} onChange={onHeaderChange}>
              <option value="">Select</option>
              <option>JSON</option>
              <option>XML</option>
            </select>
          </div>
          <div className="po-field">
            <label className="po-field__label">Document Status</label>
            <input className="po-field__input" name="documentStatus" value={header.documentStatus} onChange={onHeaderChange} readOnly />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="po-field">
            <label className="po-field__label">Total Imported</label>
            <input className="po-field__input" name="totalImportedDocument" value={header.totalImportedDocument} onChange={onHeaderChange} />
          </div>
          <div className="po-field">
            <label className="po-field__label">Date Received</label>
            <SapDateInput  className="po-field__input" name="dateReceived" value={header.dateReceived} onChange={onHeaderChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
