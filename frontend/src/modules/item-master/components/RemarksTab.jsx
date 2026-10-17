import React from "react";

export default function RemarksTab({ form, onChange }) {
  return (
    <div>
      {/* SAP keeps the item Remarks (User Text) in OITM.UserText. */}
      <div className="im-section-title">Remarks</div>
      <textarea
        name="User_Text"
        aria-label="Remarks"
        value={form.User_Text || ""}
        onChange={onChange}
        rows={7}
        className="im-textarea"
        placeholder="Enter remarks..."
      />

      <div className="im-section-title" style={{ marginTop: 16 }}>Audit Information</div>
      <div className="im-field-grid">
        <div className="im-field">
          <label className="im-field__label">Created</label>
          <input className="im-field__input" readOnly value={[form.CreateDate, form.CreateTime].filter(Boolean).join(" ")} />
        </div>
        <div className="im-field">
          <label className="im-field__label">Last Updated</label>
          <input className="im-field__input" readOnly value={[form.UpdateDate, form.UpdateTime].filter(Boolean).join(" ")} />
        </div>
      </div>
    </div>
  );
}
