import SapDateInput from '../../../components/common/SapDateInput';
export default function AccountingTab({ header, onHeaderChange, paymentTermOptions }) {
  return (
    <div className="po-tab-panel">
      <div className="po-field-grid">
        {/* Journal Remark */}
        <div className="po-field">
          <label className="po-field__label">Journal Remark</label>
          <input
            className="po-field__input"
            name="journalRemark"
            value={header.journalRemark}
            onChange={onHeaderChange}
          />
        </div>

        {/* Payment Terms */}
        <div className="po-field">
          <label className="po-field__label">Payment Terms</label>
          <select
            className="po-field__select"
            name="paymentTerms"
            value={header.paymentTerms}
            onChange={onHeaderChange}
          >
            <option value="">— Select —</option>
            {paymentTermOptions.map(t => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Payment Method */}
        <div className="po-field">
          <label className="po-field__label">Payment Method</label>
          <select
            className="po-field__select"
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
        <div className="po-field">
          <label className="po-field__label">Central Bank Ind.</label>
          <input className="po-field__input" />
        </div>

        {/* Business Partner Project */}
        <div className="po-field">
          <label className="po-field__label">Business Partner Project</label>
          <input
            className="po-field__input"
            name="bpProject"
            value={header.bpProject}
            onChange={onHeaderChange}
          />
        </div>

        {/* Create QR Code From */}
        <div className="po-field">
          <label className="po-field__label">Create QR Code From</label>
          <input
            className="po-field__input"
            name="qrCodeFrom"
            value={header.qrCodeFrom}
            onChange={onHeaderChange}
          />
        </div>

        {/* Cancellation Date */}
        <div className="po-field">
          <label className="po-field__label">Cancellation Date</label>
          <SapDateInput
            
            className="po-field__input"
            name="cancellationDate"
            value={header.cancellationDate}
            onChange={onHeaderChange}
          />
        </div>

        {/* Required Date */}
        <div className="po-field">
          <label className="po-field__label">Required Date</label>
          <SapDateInput
            
            className="po-field__input"
            name="requiredDate"
            value={header.requiredDate}
            onChange={onHeaderChange}
          />
        </div>

        {/* Indicator */}
        <div className="po-field">
          <label className="po-field__label">Indicator</label>
          <select
            className="po-field__select"
            name="indicator"
            value={header.indicator}
            onChange={onHeaderChange}
          >
            <option value="">— Select —</option>
          </select>
        </div>

        {/* Order Number */}
        <div className="po-field">
          <label className="po-field__label">Order Number</label>
          <input
            className="po-field__input"
            name="orderNumber"
            value={header.orderNumber}
            onChange={onHeaderChange}
          />
        </div>

        {/* Referenced Document */}
        <div className="po-field">
          <label className="po-field__label">Referenced Document</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input className="po-field__input" readOnly style={{ flex: 1 }} />
            <button type="button" className="po-btn" style={{ padding: '2px 8px', fontSize: '12px' }}>
              ...
            </button>
          </div>
        </div>

        {/* Manually Recalculate Due Date - Full width section */}
        <div style={{ gridColumn: '1 / -1', padding: '8px 0', borderTop: '1px solid #e0e6ed', marginTop: '8px' }}>
          <div className="po-section-title" style={{ margin: '0 0 8px 0' }}>Manually Recalculate Due Date:</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '110px' }}>
            <label style={{ fontSize: 12 }}>Selected Date</label>
            <input
              type="number"
              className="po-field__input"
              style={{ width: '40px', height: '22px' }}
              name="dueDateMonths"
              value={header.dueDateMonths}
              onChange={onHeaderChange}
            />
            <label style={{ fontSize: 12 }}>Months +</label>
            <input
              type="number"
              className="po-field__input"
              style={{ width: '40px', height: '22px' }}
              name="dueDateDays"
              value={header.dueDateDays}
              onChange={onHeaderChange}
            />
            <label style={{ fontSize: 12 }}>Days</label>
            <select className="po-field__select" style={{ width: '80px', height: '22px' }}>
              <option>None</option>
            </select>
          </div>
        </div>

        {/* Cash Discount Date Offset */}
        <div style={{ gridColumn: '1 / -1', padding: '4px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '110px', fontSize: 12, textAlign: 'right' }}>Cash Discount Date Offset:</span>
            <input
              type="number"
              className="po-field__input"
              style={{ width: '100px', height: '22px' }}
              name="cashDiscountOffset"
              value={header.cashDiscountOffset}
              onChange={onHeaderChange}
            />
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
      </div>
    </div>
  );
}
