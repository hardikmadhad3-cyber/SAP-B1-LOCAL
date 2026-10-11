import SapDateInput from '../../../components/common/SapDateInput';
import React, { useState } from 'react';

export default function EWayBillModal({ isOpen, onClose, onSave, initialData = {} }) {
  const [activeTab, setActiveTab] = useState('ewb');
  const [formData, setFormData] = useState({
    // EWB Details
    supplyType: initialData.supplyType || '',
    subSupplyType: initialData.subSupplyType || '',
    documentType: initialData.documentType || '',
    transactionType: initialData.transactionType || '',
    mainHSN: initialData.mainHSN || '',
    ewayBillNo: initialData.ewayBillNo || '',
    ewayBillDate: initialData.ewayBillDate || '',
    ewbExpirationDate: initialData.ewbExpirationDate || '',
    
    // Transportation Details
    transporterCode: initialData.transporterCode || '',
    transporterName: initialData.transporterName || '',
    transporterId: initialData.transporterId || '',
    mode: initialData.mode || '',
    vehicleType: initialData.vehicleType || '',
    vehicleNo: initialData.vehicleNo || '',
    distanceInKM: initialData.distanceInKM || '',
    transporterDocNo: initialData.transporterDocNo || '',
    transporterDocDate: initialData.transporterDocDate || '',
    
    // Bill From
    billFromName: initialData.billFromName || '',
    billFromGSTIN: initialData.billFromGSTIN || '',
    billFromState: initialData.billFromState || 'OTHER COUNTRY',
    
    // Bill To
    billToName: initialData.billToName || '',
    billToGSTIN: initialData.billToGSTIN || '',
    billToState: initialData.billToState || 'OTHER COUNTRY',
    
    // Dispatch From
    dispatchFromAddress: initialData.dispatchFromAddress || '',
    dispatchFromPlace: initialData.dispatchFromPlace || '',
    dispatchFromZipCode: initialData.dispatchFromZipCode || '',
    dispatchFromActualState: initialData.dispatchFromActualState || '',
    
    // Ship To
    shipToAddress: initialData.shipToAddress || '',
    shipToPlace: initialData.shipToPlace || '',
    shipToZipCode: initialData.shipToZipCode || '',
    shipToActualState: initialData.shipToActualState || '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    onSave(formData);
    onClose();
  };

  const handleValidate = () => {
    alert('E-Way Bill validation would be performed here');
  };

  if (!isOpen) return null;

  return (
    <div className="im-modal-overlay" onClick={onClose}>
      <div className="im-modal" style={{ width: '900px', maxWidth: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="im-modal__header">
          <span>E-Way Bill</span>
          <button className="im-modal__close" onClick={onClose}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #0070c0', background: '#f0f2f5' }}>
          <button
            className={`im-tab ${activeTab === 'ewb' ? 'im-tab--active' : ''}`}
            onClick={() => setActiveTab('ewb')}
            style={{ borderBottom: 'none', marginBottom: activeTab === 'ewb' ? '-2px' : '0' }}
          >
            EWB Details
          </button>
          <button
            className={`im-tab ${activeTab === 'transport' ? 'im-tab--active' : ''}`}
            onClick={() => setActiveTab('transport')}
            style={{ borderBottom: 'none', marginBottom: activeTab === 'transport' ? '-2px' : '0' }}
          >
            Transportation Details
          </button>
        </div>

        <div className="im-modal__body" style={{ padding: '14px', maxHeight: '60vh', overflowY: 'auto' }}>
          {activeTab === 'ewb' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                {/* Left Column */}
                <div>
                  <div className="im-section-title">EWB Details</div>
                  
                  <div className="im-field">
                    <label className="im-field__label">Supply Type</label>
                    <select className="im-field__select" name="supplyType" value={formData.supplyType} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="Outward">Outward</option>
                      <option value="Inward">Inward</option>
                    </select>
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Sub Supply Type</label>
                    <select className="im-field__select" name="subSupplyType" value={formData.subSupplyType} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="Supply">Supply</option>
                      <option value="Export">Export</option>
                      <option value="Job Work">Job Work</option>
                    </select>
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Document Type</label>
                    <select className="im-field__select" name="documentType" value={formData.documentType} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="Tax Invoice">Tax Invoice</option>
                      <option value="Bill of Supply">Bill of Supply</option>
                      <option value="Delivery Challan">Delivery Challan</option>
                    </select>
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Transaction Type</label>
                    <select className="im-field__select" name="transactionType" value={formData.transactionType} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="Regular">Regular</option>
                      <option value="Bill To-Ship To">Bill To-Ship To</option>
                      <option value="Bill From-Dispatch From">Bill From-Dispatch From</option>
                    </select>
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Main HSN</label>
                    <input className="im-field__input" name="mainHSN" value={formData.mainHSN} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">E-Way Bill No.</label>
                    <input className="im-field__input" name="ewayBillNo" value={formData.ewayBillNo} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">E-Way Bill Date</label>
                    <SapDateInput  className="im-field__input" name="ewayBillDate" value={formData.ewayBillDate} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">EWB Expiration Date</label>
                    <SapDateInput  className="im-field__input" name="ewbExpirationDate" value={formData.ewbExpirationDate} onChange={handleChange} />
                  </div>
                </div>

                {/* Right Column */}
                <div>
                  <div className="im-section-title">Bill From</div>
                  
                  <div className="im-field">
                    <label className="im-field__label">Name</label>
                    <input className="im-field__input" name="billFromName" value={formData.billFromName} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">GSTIN</label>
                    <input className="im-field__input" name="billFromGSTIN" value={formData.billFromGSTIN} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">State</label>
                    <input className="im-field__input" name="billFromState" value={formData.billFromState} onChange={handleChange} readOnly />
                  </div>

                  <div className="im-section-title" style={{ marginTop: '16px' }}>Bill To</div>
                  
                  <div className="im-field">
                    <label className="im-field__label">Name</label>
                    <input className="im-field__input" name="billToName" value={formData.billToName} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">GSTIN</label>
                    <input className="im-field__input" name="billToGSTIN" value={formData.billToGSTIN} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">State</label>
                    <input className="im-field__input" name="billToState" value={formData.billToState} onChange={handleChange} readOnly />
                  </div>
                </div>
              </div>

              {/* Dispatch From & Ship To */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', marginTop: '16px' }}>
                <div>
                  <div className="im-section-title">Dispatch From</div>
                  
                  <div className="im-field">
                    <label className="im-field__label">Address</label>
                    <textarea className="im-textarea" rows={2} name="dispatchFromAddress" value={formData.dispatchFromAddress} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Place</label>
                    <input className="im-field__input" name="dispatchFromPlace" value={formData.dispatchFromPlace} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Zip Code</label>
                    <input className="im-field__input" name="dispatchFromZipCode" value={formData.dispatchFromZipCode} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Actual State</label>
                    <input className="im-field__input" name="dispatchFromActualState" value={formData.dispatchFromActualState} onChange={handleChange} />
                  </div>
                </div>

                <div>
                  <div className="im-section-title">Ship To</div>
                  
                  <div className="im-field">
                    <label className="im-field__label">Address</label>
                    <textarea className="im-textarea" rows={2} name="shipToAddress" value={formData.shipToAddress} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Place</label>
                    <input className="im-field__input" name="shipToPlace" value={formData.shipToPlace} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Zip Code</label>
                    <input className="im-field__input" name="shipToZipCode" value={formData.shipToZipCode} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Actual State</label>
                    <input className="im-field__input" name="shipToActualState" value={formData.shipToActualState} onChange={handleChange} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transport' && (
            <div>
              <div className="im-section-title">Transportation Details</div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                <div>
                  <div className="im-field">
                    <label className="im-field__label">Transporter Code</label>
                    <input className="im-field__input" name="transporterCode" value={formData.transporterCode} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Transporter Name</label>
                    <input className="im-field__input" name="transporterName" value={formData.transporterName} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Transporter ID</label>
                    <input className="im-field__input" name="transporterId" value={formData.transporterId} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Mode</label>
                    <select className="im-field__select" name="mode" value={formData.mode} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="Road">Road</option>
                      <option value="Rail">Rail</option>
                      <option value="Air">Air</option>
                      <option value="Ship">Ship</option>
                    </select>
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Vehicle Type</label>
                    <select className="im-field__select" name="vehicleType" value={formData.vehicleType} onChange={handleChange}>
                      <option value="">Select</option>
                      <option value="Regular">Regular</option>
                      <option value="Over Dimensional Cargo">Over Dimensional Cargo</option>
                    </select>
                  </div>
                </div>

                <div>
                  <div className="im-field">
                    <label className="im-field__label">Vehicle No.</label>
                    <input className="im-field__input" name="vehicleNo" value={formData.vehicleNo} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Distance(in KM)</label>
                    <input type="number" className="im-field__input" name="distanceInKM" value={formData.distanceInKM} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Transporter Doc No.</label>
                    <input className="im-field__input" name="transporterDocNo" value={formData.transporterDocNo} onChange={handleChange} />
                  </div>

                  <div className="im-field">
                    <label className="im-field__label">Transporter Doc. Date</label>
                    <SapDateInput  className="im-field__input" name="transporterDocDate" value={formData.transporterDocDate} onChange={handleChange} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '8px', padding: '10px 14px', borderTop: '1px solid #c8d0da', background: '#f0f2f5' }}>
          <button className="im-btn im-btn--primary" onClick={handleSave}>OK</button>
          <button className="im-btn" onClick={onClose}>Cancel</button>
          <button className="im-btn" onClick={handleValidate} style={{ marginLeft: 'auto' }}>Validate</button>
        </div>
      </div>
    </div>
  );
}
