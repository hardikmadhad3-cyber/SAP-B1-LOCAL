import React, { useState } from 'react';
import { DocTabPanel } from './DocumentTabLayout';

// SAP B1 Attachments tab for every marketing document: the attachment grid
// with Browse / Display / Delete stacked on the right. Display and Delete
// become active once the page passes a handler and a row is selected.
const COLUMNS = [
  ['targetPath', 'Target Path'],
  ['fileName', 'File Name'],
  ['attachmentDate', 'Attachment Date'],
  ['freeText', 'Free Text'],
  ['copyToTargetDocument', 'Copy to Target'],
  ['documentType', 'Document Type'],
  ['atchDocDate', 'Doc Date'],
  ['alert', 'Alert'],
];

export default function DocumentAttachmentsTab({
  attachments = [],
  onBrowseAttachment,
  onDisplayAttachment,
  onDeleteAttachment,
  isEditable = true,
}) {
  const rows = Array.isArray(attachments) ? attachments : [];
  const [selectedId, setSelectedId] = useState(null);
  const selected = rows.find((row) => row.id === selectedId) || null;

  return (
    <DocTabPanel className="sap-doc-tab--attachments">
      <div className="sap-doc-attachments">
        <div className="sap-doc-attachments__grid-wrap">
          <table className="sap-doc-attachments__grid">
            <thead>
              <tr>
                <th>#</th>
                {COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="sap-doc-attachments__empty">No attachments added yet.</td>
                </tr>
              ) : rows.map((row, index) => (
                <tr
                  key={row.id ?? index}
                  className={row.id === selectedId ? 'is-selected' : undefined}
                  aria-selected={row.id === selectedId}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td>{row.id ?? index + 1}</td>
                  {COLUMNS.map(([key]) => <td key={key}>{row[key] ?? ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sap-doc-attachments__actions">
          <button type="button" className="sap-doc-attachments__btn sap-doc-attachments__btn--primary" onClick={onBrowseAttachment} disabled={!isEditable || !onBrowseAttachment}>Browse</button>
          <button type="button" className="sap-doc-attachments__btn" onClick={() => onDisplayAttachment?.(selected)} disabled={!selected || !onDisplayAttachment}>Display</button>
          <button type="button" className="sap-doc-attachments__btn" onClick={() => onDeleteAttachment?.(selected)} disabled={!isEditable || !selected || !onDeleteAttachment}>Delete</button>
        </div>
      </div>
    </DocTabPanel>
  );
}
