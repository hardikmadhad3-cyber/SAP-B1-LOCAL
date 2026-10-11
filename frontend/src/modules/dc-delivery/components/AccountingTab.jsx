import SapDateInput from '../../../components/common/SapDateInput';
import React from 'react';

export default function AccountingTab({ header, onHeaderChange, payTermOpts }) {
  return (
    <div className="del-tab-panel">
      <div className="del-field-grid">
        {/* Journal Remark */}
        <div className="del-field">
          <label className="del-field__label">Journal Remark</label>
          <input
            className="del-field__input"
            name="journalRemark"
            value={header.journalRemark}
            onChange={onHeaderChange}
          />
        </div>

        {/* Payment Terms */}
        <div className="del-field">
          <label className="del-field__label">Payment Terms</label>
          <select
            className="del-field__select"
            name="paymentTerms"
            value={header.paymentTerms}
            onChange={onHeaderChange}
          >
            <option value="">— Select —</option>
            {payTermOpts.map(t => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Payment Method */}
        <div className="del-field">
          <label className="del-field__label">Payment Method</label>
          <select
            className="del-field__select"
            name="paymentMethod"
            value={header.paymentMethod}
            onChange={onHeaderChange}
          >
            <option value="">— Select —</option>
            <option>Bank Transfer</option>
            <option>Cheque</option>
            <option>Cash</option>
            <option>Credit Card</option>
          </select>
        </div>

        {/* Central Bank Ind. */}
        <div className="del-field">
          <label className="del-field__label">Central Bank Ind.</label>
          <select className="del-field__select">
            <option value="">— Select —</option>
          </select>
        </div>

        {/* Business Partner Project */}
        <div className="del-field">
          <label className="del-field__label">Business Partner Project</label>
          <input className="del-field__input" />
        </div>

        {/* Create QR Code From */}
        <div className="del-field">
          <label className="del-field__label">Create QR Code From</label>
          <input className="del-field__input" />
        </div>

        {/* Indicator */}
        <div className="del-field">
          <label className="del-field__label">Indicator</label>
          <select className="del-field__select">
            <option value="">— Select —</option>
          </select>
        </div>

        {/* Order Number */}
        <div className="del-field">
          <label className="del-field__label">Order Number</label>
          <input className="del-field__input" />
        </div>

        {/* Owner */}
        <div className="del-field">
          <label className="del-field__label">Owner</label>
          <input
            className="del-field__input"
            name="owner"
            value={header.owner || ''}
            onChange={onHeaderChange}
          />
        </div>

        {/* Remarks / Instructions */}
        <div className="del-field" style={{ gridColumn: '1 / -1' }}>
          <label className="del-field__label">Remarks / Instructions</label>
          <textarea
            className="del-textarea"
            style={{ flex: 1, minHeight: '80px' }}
            rows={4}
            name="otherInstruction"
            value={header.otherInstruction}
            onChange={onHeaderChange}
          />
        </div>

        {/* Manually Recalculate Due Date - Full width section */}
        <div style={{ gridColumn: '1 / -1', padding: '8px 0', borderTop: '1px solid #e0e6ed', marginTop: '8px' }}>
          <div className="del-section-title" style={{ margin: '0 0 8px 0' }}>Manually Recalculate Due Date</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '110px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="radio" name="dueDateCalc" id="dueDateSelected" />
              <label htmlFor="dueDateSelected" style={{ cursor: 'pointer', margin: 0, fontSize: 12 }}>Selected Date</label>
              <SapDateInput  className="del-field__input" style={{ flex: '0 0 150px', height: '22px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="radio" name="dueDateCalc" id="dueDateMonths" />
              <label htmlFor="dueDateMonths" style={{ cursor: 'pointer', margin: 0, fontSize: 12 }}>Months + Days</label>
              <input type="number" className="del-field__input" placeholder="Months" style={{ flex: '0 0 80px', height: '22px' }} />
              <input type="number" className="del-field__input" placeholder="Days" style={{ flex: '0 0 80px', height: '22px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: 12, color: '#444', width: '110px', textAlign: 'right' }}>Cash Discount Date Offset</span>
              <input type="number" className="del-field__input" style={{ flex: '0 0 80px', height: '22px' }} />
            </div>
          </div>
        </div>

        {/* Use Shipped Goods Account */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0' }}>
          <span style={{ width: '110px' }}></span>
          <input type="checkbox" id="useShippedGoods" style={{ cursor: 'pointer' }} />
          <label htmlFor="useShippedGoods" style={{ cursor: 'pointer', margin: 0, fontSize: 12 }}>
            Use Shipped Goods Account
          </label>
        </div>

        {/* Consolidation Type */}
        <div className="del-field">
          <label className="del-field__label">Consolidation Type</label>
          <select className="del-field__select">
            <option value="">— Select —</option>
          </select>
        </div>

        {/* Consolidating BP */}
        <div className="del-field">
          <label className="del-field__label">Consolidating BP</label>
          <input className="del-field__input" />
        </div>
      </div>
    </div>
  );
}
