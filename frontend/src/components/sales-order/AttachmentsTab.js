import SapDateInput from '../common/SapDateInput';
import React, { useState } from 'react';

function AttachmentsTab() {
  const [attachments] = useState([
    { id: 1, targetPath: '', fileName: '', attachmentDate: '', freeText: '', copyToTarget: false },
    { id: 2, targetPath: '', fileName: '', attachmentDate: '', freeText: '', copyToTarget: false },
    { id: 3, targetPath: '', fileName: '', attachmentDate: '', freeText: '', copyToTarget: false },
  ]);

  return (
    <div className="so-attachments-tab">
      <div className="so-attachments-toolbar">
        <button type="button" className="so-btn so-btn-sm">Browse</button>
        <button type="button" className="so-btn so-btn-sm" disabled>Display</button>
        <button type="button" className="so-btn so-btn-sm so-btn-danger" disabled>Delete</button>
      </div>

      <div className="so-matrix-wrapper">
        <table className="so-matrix">
          <thead>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th style={{ minWidth: 200 }}>Target Path</th>
              <th style={{ minWidth: 180 }}>File Name</th>
              <th style={{ minWidth: 120 }}>Attachment Date</th>
              <th style={{ minWidth: 150 }}>Free Text</th>
              <th style={{ minWidth: 100 }}>Copy to Target</th>
            </tr>
          </thead>
          <tbody>
            {attachments.map((attachment) => (
              <tr key={attachment.id}>
                <td className="so-matrix-cell-center">{attachment.id}</td>
                <td>
                  <input
                    type="text"
                    className="so-matrix-input"
                    value={attachment.targetPath}
                    readOnly
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className="so-matrix-input"
                    value={attachment.fileName}
                    readOnly
                  />
                </td>
                <td>
                  <SapDateInput
                    
                    className="so-matrix-input"
                    value={attachment.attachmentDate}
                    readOnly
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className="so-matrix-input"
                    value={attachment.freeText}
                    readOnly
                  />
                </td>
                <td className="so-matrix-cell-center">
                  <input
                    type="checkbox"
                    checked={attachment.copyToTarget}
                    disabled
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default AttachmentsTab;
