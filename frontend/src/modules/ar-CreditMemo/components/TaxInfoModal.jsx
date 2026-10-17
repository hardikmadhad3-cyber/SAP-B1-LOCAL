import React from 'react';

export default function TaxInfoModal({ isOpen, onClose, onSave, taxInfoForm, onFormChange }) {
  if (!isOpen) return null;

  return (
    <div className="del-modal-overlay" onClick={onClose}>
      <div className="del-modal" onClick={e => e.stopPropagation()}>
        <div className="del-modal__header">
          <h6 style={{ margin: 0, fontSize: '12px', fontWeight: 600 }}>Tax Information</h6>
          <button 
            type="button" 
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '18px',
              cursor: 'pointer',
              padding: 0,
              width: '24px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>
        <div className="del-modal__body">
          <div className="del-field-grid">
            <div className="del-field">
              <label className="del-field__label">P.A.N. No.</label>
              <input
                className="del-field__input"
                name="panNo"
                value={taxInfoForm.panNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">P.A.N. Circle No.</label>
              <input
                className="del-field__input"
                name="panCircleNo"
                value={taxInfoForm.panCircleNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">P.A.N. Ward No.</label>
              <input
                className="del-field__input"
                name="panWardNo"
                value={taxInfoForm.panWardNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">P.A.N. Assessing Officer</label>
              <input
                className="del-field__input"
                name="panAssessingOfficer"
                value={taxInfoForm.panAssessingOfficer}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">Deductee Ref. No.</label>
              <input
                className="del-field__input"
                name="deducteeRefNo"
                value={taxInfoForm.deducteeRefNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">LST/VAT No.</label>
              <input
                className="del-field__input"
                name="lstVatNo"
                value={taxInfoForm.lstVatNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">CST No.</label>
              <input
                className="del-field__input"
                name="cstNo"
                value={taxInfoForm.cstNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">TAN No.</label>
              <input
                className="del-field__input"
                name="tanNo"
                value={taxInfoForm.tanNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">Service Tax No.</label>
              <input
                className="del-field__input"
                name="serviceTaxNo"
                value={taxInfoForm.serviceTaxNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">Company Type</label>
              <input
                className="del-field__input"
                name="companyType"
                value={taxInfoForm.companyType}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">Nature of Business</label>
              <input
                className="del-field__input"
                name="natureOfBusiness"
                value={taxInfoForm.natureOfBusiness}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">Assessee Type</label>
              <input
                className="del-field__input"
                name="assesseeType"
                value={taxInfoForm.assesseeType}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">TIN No.</label>
              <input
                className="del-field__input"
                name="tinNo"
                value={taxInfoForm.tinNo}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">ITR Filing</label>
              <input
                className="del-field__input"
                name="itrFiling"
                value={taxInfoForm.itrFiling}
                onChange={onFormChange}
              />
            </div>
            <div className="del-field">
              <label className="del-field__label">GST Type</label>
              <select
                className="del-field__select"
                name="gstType"
                value={taxInfoForm.gstType}
                onChange={onFormChange}
              >
                <option value="">— Select —</option>
                <option>Regular</option>
                <option>Composition</option>
                <option>Unregistered</option>
              </select>
            </div>
            <div className="del-field">
              <label className="del-field__label">GSTIN</label>
              <input
                className="del-field__input"
                name="gstin"
                value={taxInfoForm.gstin}
                onChange={onFormChange}
              />
            </div>
          </div>
        </div>
        <div className="del-modal__footer">
          <button type="button" className="del-btn del-btn--primary" onClick={onSave}>
            OK
          </button>
          <button type="button" className="del-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
