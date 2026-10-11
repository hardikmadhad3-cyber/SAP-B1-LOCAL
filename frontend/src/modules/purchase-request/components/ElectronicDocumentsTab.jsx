import SapDateInput from '../../../components/common/SapDateInput';
import React from 'react';

export default function ElectronicDocumentsTab({ header, onHeaderChange }) {
  return (
    <div className="card p-3 mb-3">
      <h6 className="mb-3">Electronic Documents</h6>
      <div className="row g-3">
        <div className="col-md-6">
          <div className="mb-2">
            <label className="form-label">eDoc Format</label>
            <select
              className="form-control form-control-sm"
              name="edocFormat"
              value={header.edocFormat}
              onChange={onHeaderChange}
            >
              <option value="">Select</option>
              <option>JSON</option>
              <option>XML</option>
            </select>
          </div>

          <div className="mb-2">
            <label className="form-label">Document Status</label>
            <input
              className="form-control form-control-sm"
              name="documentStatus"
              value={header.documentStatus}
              onChange={onHeaderChange}
              readOnly
              style={{ background: '#f5f5f5' }}
            />
          </div>
        </div>

        <div className="col-md-6">
          <div className="mb-2">
            <label className="form-label">Total Imported Document</label>
            <input
              className="form-control form-control-sm"
              name="totalImportedDocument"
              value={header.totalImportedDocument}
              onChange={onHeaderChange}
            />
          </div>

          <div className="mb-2">
            <label className="form-label">Date Received</label>
            <SapDateInput
              
              className="form-control form-control-sm"
              name="dateReceived"
              value={header.dateReceived}
              onChange={onHeaderChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
