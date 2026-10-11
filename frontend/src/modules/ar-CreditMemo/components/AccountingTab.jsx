import SapDateInput from '../../../components/common/SapDateInput';
import React from 'react';

export default function AccountingTab({
  header = {},
  onHeaderChange,
  payTermOpts = [],
  isEditable = true,
}) {
  return (
    <div className="sap-tab-panel del-tab-panel">
      <div className="sap-tab-grid">
        <div className="sap-tab-column">
          <div className="sap-section-title">Accounting</div>

          <div className="sap-form-row">
            <label className="del-field__label">Journal Remark</label>
            <input className="del-field__input" name="journalRemark" value={header.journalRemark || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Payment Terms</label>
            <select className="del-field__select" name="paymentTerms" value={header.paymentTerms || ''} onChange={onHeaderChange} disabled={!isEditable}>
              <option value="">-- Select --</option>
              {payTermOpts.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Payment Method</label>
            <select className="del-field__select" name="paymentMethod" value={header.paymentMethod || ''} onChange={onHeaderChange} disabled={!isEditable}>
              <option value="">-- Select --</option>
              <option>Bank Transfer</option>
              <option>Cheque</option>
              <option>Cash</option>
              <option>Credit Card</option>
            </select>
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Central Bank Ind.</label>
            <select className="del-field__select" disabled={!isEditable}>
              <option value="">-- Select --</option>
            </select>
          </div>
        </div>

        <div className="sap-tab-column">
          <div className="sap-section-title">Reference</div>

          <div className="sap-form-row">
            <label className="del-field__label">Business Partner Project</label>
            <input className="del-field__input" disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Create QR Code From</label>
            <input className="del-field__input" disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Indicator</label>
            <select className="del-field__select" disabled={!isEditable}>
              <option value="">-- Select --</option>
            </select>
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Order Number</label>
            <input className="del-field__input" disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Owner</label>
            <input className="del-field__input" name="owner" value={header.owner || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row sap-form-row--stacked">
            <label className="del-field__label">Remarks / Instructions</label>
            <textarea className="del-textarea" rows={4} name="otherInstruction" value={header.otherInstruction || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Consolidation Type</label>
            <select className="del-field__select" disabled={!isEditable}>
              <option value="">-- Select --</option>
            </select>
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Consolidating BP</label>
            <input className="del-field__input" disabled={!isEditable} />
          </div>
        </div>

        <div className="sap-tab-section sap-tab-section--full sap-due-date-section">
          <div className="sap-section-title">Manually Recalculate Due Date</div>

          <div className="sap-form-row sap-form-row--full">
            <label className="del-field__label">Selected Date</label>
            <div className="sap-inline-row sap-due-date-controls">
              <input type="radio" name="dueDateCalc" id="creditMemoDueDateSelected" disabled={!isEditable} />
              <label className="sap-inline-label" htmlFor="creditMemoDueDateSelected">Selected Date</label>
              <SapDateInput  className="del-field__input sap-inline-control sap-inline-control--date" disabled={!isEditable} />
            </div>
          </div>

          <div className="sap-form-row sap-form-row--full">
            <label className="del-field__label">Months / Days</label>
            <div className="sap-inline-row sap-due-date-controls">
              <input type="radio" name="dueDateCalc" id="creditMemoDueDateMonths" disabled={!isEditable} />
              <label className="sap-inline-label" htmlFor="creditMemoDueDateMonths">Months + Days</label>
              <input type="number" className="del-field__input sap-inline-control sap-inline-control--short" placeholder="Months" disabled={!isEditable} />
              <input type="number" className="del-field__input sap-inline-control sap-inline-control--short" placeholder="Days" disabled={!isEditable} />
            </div>
          </div>

          <div className="sap-form-row">
            <label className="del-field__label">Cash Discount Date Offset</label>
            <input type="number" className="del-field__input" disabled={!isEditable} />
          </div>

          <div className="sap-checkbox-row">
            <input type="checkbox" id="creditMemoUseShippedGoods" disabled={!isEditable} />
            <span>Use Shipped Goods Account</span>
          </div>
        </div>
      </div>
    </div>
  );
}
