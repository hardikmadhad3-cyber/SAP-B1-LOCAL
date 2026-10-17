import React, { useRef } from "react";

/**
 * Attachments tab.
 * `attachments` = [{ id, name, size, type, url, file? }]
 * `onAdd(files)`, `onRemove(id)`
 */
export default function AttachmentsTab({ attachments = [], onAdd, onRemove, onOpen }) {
  const inputRef = useRef(null);

  const handleFiles = (e) => {
    const files = Array.from(e.target.files);
    if (files.length) onAdd(files);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onAdd(files);
  };

  return (
    <div>
      <div className="im-section-title">Attachments</div>

      {/* Drop zone */}
      <div
        className="im-drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <span className="im-drop-zone__icon">📎</span>
        <span>Drop files here or <u>click to browse</u></span>
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={handleFiles}
        />
      </div>

      {/* File list */}
      {attachments.length > 0 && (
        <table className="im-grid" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>File Name</th>
              <th>Type</th>
              <th className="im-grid__cell--num">Size</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {attachments.map((att) => (
              <tr key={att.id}>
                <td>
                  {onOpen && !att.file ? (
                    <button type="button" className="im-link" onClick={() => onOpen(att)}>
                      {att.name}
                    </button>
                  ) : (
                    <span>{att.name}{att.file ? " (uploads on Add)" : ""}</span>
                  )}
                </td>
                <td className="im-grid__cell--muted">{att.type || "—"}</td>
                <td className="im-grid__cell--num im-grid__cell--muted">
                  {att.size ? formatBytes(att.size) : "—"}
                </td>
                <td>
                  <button
                    type="button"
                    className="im-btn im-btn--danger"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => onRemove(att.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {attachments.length === 0 && (
        <div className="im-tab-placeholder">No attachments added yet.</div>
      )}
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
