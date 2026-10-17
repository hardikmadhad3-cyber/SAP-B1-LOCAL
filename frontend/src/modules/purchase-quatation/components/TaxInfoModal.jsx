export default function TaxInfoModal({ isOpen, onClose, onSave, taxInfoForm, onFormChange }) {
  if (!isOpen) return null;

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header" style={{ background: '#6c757d', color: 'white', padding: '8px 16px' }}>
            <h6 className="modal-title mb-0">Tax Information</h6>
            <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
          </div>
          <div className="modal-body" style={{ padding: '16px' }}>
            <div className="row g-3">
              <div className="col-md-6">
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    P.A.N. No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="panNo"
                    value={taxInfoForm.panNo}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    P.A.N. Circle No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="panCircleNo"
                    value={taxInfoForm.panCircleNo}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    P.A.N. Ward No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="panWardNo"
                    value={taxInfoForm.panWardNo}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    P.A.N. Assessing Officer
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="panAssessingOfficer"
                    value={taxInfoForm.panAssessingOfficer}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    Deductee Ref. No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="deducteeRefNo"
                    value={taxInfoForm.deducteeRefNo}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    LST/VAT No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="lstVatNo"
                    value={taxInfoForm.lstVatNo}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    CST No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="cstNo"
                    value={taxInfoForm.cstNo}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    TAN No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="tanNo"
                    value={taxInfoForm.tanNo}
                    onChange={onFormChange}
                  />
                </div>
              </div>
              <div className="col-md-6">
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    Service Tax No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="serviceTaxNo"
                    value={taxInfoForm.serviceTaxNo}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    Company Type
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="companyType"
                    value={taxInfoForm.companyType}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    Nature of Business
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="natureOfBusiness"
                    value={taxInfoForm.natureOfBusiness}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    Assessee Type
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="assesseeType"
                    value={taxInfoForm.assesseeType}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    TIN No.
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="tinNo"
                    value={taxInfoForm.tinNo}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    ITR Filing
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="itrFiling"
                    value={taxInfoForm.itrFiling}
                    onChange={onFormChange}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    GST Type
                  </label>
                  <select
                    className="form-control form-control-sm"
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
                <div className="mb-2">
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 600 }}>
                    GSTIN
                  </label>
                  <input
                    className="form-control form-control-sm"
                    name="gstin"
                    value={taxInfoForm.gstin}
                    onChange={onFormChange}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer" style={{ padding: '8px 16px' }}>
            <button type="button" className="btn btn-warning btn-sm px-4" onClick={onSave}>
              OK
            </button>
            <button type="button" className="btn btn-secondary btn-sm px-4" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
