import SapDateInput from '../../../components/common/SapDateInput';
import React from 'react';

export default function TaxTab({
  onOpenTaxInfoModal,
  isEditable = true,
  header = {},
  onHeaderChange,
  showTaxInvoiceReference = false,
  taxInvoiceReferenceRequired = false,
  errors = {},
}) {
  return (
    <div className="sap-tab-panel del-tab-panel">
      <div className="sap-tab-grid">
        <div className="sap-tab-column">
          <div className="sap-section-heading-row">
            <div className="sap-section-title">Tax Information</div>
            <button type="button" className="del-btn del-btn--primary" onClick={onOpenTaxInfoModal} disabled={!isEditable}>Tax Information</button>
          </div>

          {showTaxInvoiceReference && (
            <>
              <div className="sap-form-row">
                <label className="del-field__label" htmlFor="taxInvoiceNo">Original Invoice No.{taxInvoiceReferenceRequired ? ' *' : ''}</label>
                <input id="taxInvoiceNo" className={`del-field__input${errors.taxInvoiceNo ? ' del-field__input--error' : ''}`} name="taxInvoiceNo" value={header.taxInvoiceNo || ''} onChange={onHeaderChange} disabled={!isEditable} maxLength={100} title={errors.taxInvoiceNo || 'Reference number of the original tax invoice'} />
              </div>

              <div className="sap-form-row">
                <label className="del-field__label" htmlFor="taxInvoiceDate">Original Invoice Date{taxInvoiceReferenceRequired ? ' *' : ''}</label>
                <SapDateInput id="taxInvoiceDate" className={`del-field__input${errors.taxInvoiceDate ? ' del-field__input--error' : ''}`}  name="taxInvoiceDate" value={header.taxInvoiceDate || ''} onChange={onHeaderChange} disabled={!isEditable} title={errors.taxInvoiceDate || 'Date of the original tax invoice'} />
              </div>
            </>
          )}

          <div className="sap-form-row">
            <label className="del-field__label">Transaction Category</label>
            <select className="del-field__select" disabled={!isEditable}>
              <option value="">-- Select --</option>
              <option>B2B</option>
              <option>B2C</option>
              <option>Export</option>
              <option>SEZ</option>
            </select>
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Form No.</label>
            <input className="del-field__input" disabled={!isEditable} />
          </div>
        </div>

        <div className="sap-tab-column">
          <div className="sap-section-title">Export</div>

          <div className="sap-form-row">
            <label className="del-field__label">Duty Status</label>
            <select className="del-field__select" disabled={!isEditable}>
              <option value="">-- Select --</option>
              <option>Paid</option>
              <option>Unpaid</option>
              <option>Exempted</option>
            </select>
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Differential % of Tax Rate</label>
            <select className="del-field__select" disabled={!isEditable}>
              <option value="100">100</option>
              <option value="75">75</option>
              <option value="50">50</option>
              <option value="25">25</option>
            </select>
          </div>

          <div className="sap-form-row sap-form-row--full">
            <label className="del-field__label">Export</label>
            <label className="sap-checkbox-row">
              <input type="checkbox" id="exportCheck" disabled={!isEditable} />
              <span>Export</span>
            </label>
          </div>

          <div className="sap-form-row sap-form-row--full">
            <label className="del-field__label">Supply Covered</label>
            <label className="sap-checkbox-row">
              <input type="checkbox" id="supplyCoveredCheck" disabled={!isEditable} />
              <span>Supply Covered under Sec 2 of IGST Act</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
