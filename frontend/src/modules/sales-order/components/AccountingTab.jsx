import SapDateInput from '../../../components/common/SapDateInput';
export default function AccountingTab({
  header,
  onHeaderChange,
  payTermOpts,
  paymentMethodOpts = [],
  referenceDocuments = [],
  onOpenReferenceDocuments,
  isEditable = true,
}) {
  const referenceCount = (referenceDocuments || [])
    .filter((row) => String(row.transactionType || row.docNumber || row.docEntry || row.extDocNumber || '').trim())
    .length;
  const paymentMethods = [...paymentMethodOpts];
  const currentPaymentMethod = String(header.paymentMethod || '').trim();
  if (currentPaymentMethod && !paymentMethods.some((method) => String(method.value) === currentPaymentMethod)) {
    paymentMethods.push({ value: currentPaymentMethod, label: currentPaymentMethod });
  }

  const emitHeaderChange = (name, value, type = 'text', checked = false) => {
    onHeaderChange({
      target: {
        name,
        value,
        type,
        checked,
      },
    });
  };

  return (
    <div className="sap-tab-panel so-tab-panel so-accounting-panel">
      <div className="sap-tab-grid">
        <div className="sap-tab-column">
          <div className="sap-section-title">Accounting</div>
          <div className="sap-form-row">
            <label className="so-field__label">Journal Remark</label>
            <input className="so-field__input" name="journalRemark" value={header.journalRemark || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Payment Terms</label>
            <select className="so-field__select" name="paymentTerms" value={header.paymentTerms || ''} onChange={onHeaderChange} disabled={!isEditable}>
              <option value="">-- Select --</option>
              {payTermOpts.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Payment Method</label>
            <select className="so-field__select" name="paymentMethod" value={header.paymentMethod || ''} onChange={onHeaderChange} disabled={!isEditable}>
              <option value="">-- Select --</option>
              {paymentMethods.map(method => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="sap-tab-column">
          <div className="sap-section-title">Reference</div>
          <div className="sap-form-row">
            <label className="so-field__label">BP Project</label>
            <input className="so-field__input" name="bpProject" value={header.bpProject || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Create QR Code From</label>
            <input className="so-field__input" name="createQrCodeFrom" value={header.createQrCodeFrom || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Cancellation Date</label>
            <SapDateInput  className="so-field__input" name="cancellationDate" value={header.cancellationDate || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Required Date</label>
            <SapDateInput  className="so-field__input" name="requiredDate" value={header.requiredDate || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Indicator</label>
            <select className="so-field__select" name="indicator" value={header.indicator || ''} onChange={onHeaderChange} disabled={!isEditable}>
              <option value="">-- Select --</option>
            </select>
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Order Number</label>
            <input className="so-field__input" name="orderNumber" value={header.orderNumber || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Referenced Document</label>
            <div className="sap-input-group">
              <input className="so-field__input" readOnly value={referenceCount ? `(${referenceCount})` : ''} />
              <button type="button" className="so-btn so-btn--secondary so-btn--lookup" onClick={onOpenReferenceDocuments} disabled={!isEditable && !referenceCount}>
                ...
              </button>
            </div>
          </div>
        </div>

        <div className="sap-tab-section sap-tab-section--full sap-due-date-section">
          <div className="sap-section-title">Manually Recalculate Due Date</div>

          <div className="sap-form-row sap-form-row--full">
            <label className="so-field__label">Due Date</label>
            <div className="sap-inline-row sap-due-date-controls">
              <input type="number" className="so-field__input sap-inline-control sap-inline-control--short" name="recalcSelectedDate" value={header.recalcSelectedDate || '0'} onChange={onHeaderChange} disabled={!isEditable} />
              <span>Months +</span>
              <input type="number" className="so-field__input sap-inline-control sap-inline-control--short" name="recalcMonths" value={header.recalcMonths || '0'} onChange={onHeaderChange} disabled={!isEditable} />
              <span>Days</span>
              <select className="so-field__select sap-inline-control sap-inline-control--mode" name="recalcDaysMode" value={header.recalcDaysMode || 'None'} onChange={onHeaderChange} disabled={!isEditable}>
                <option>None</option>
              </select>
            </div>
          </div>

          <div className="sap-form-row">
            <label className="so-field__label">Cash Discount Date Offset</label>
            <input type="number" className="so-field__input" name="cashDiscountDateOffset" value={header.cashDiscountDateOffset || ''} onChange={onHeaderChange} disabled={!isEditable} />
          </div>

          <div className="sap-checkbox-row">
            <input type="checkbox" name="useShippedGoodsAccount" checked={Boolean(header.useShippedGoodsAccount)} onChange={(event) => emitHeaderChange('useShippedGoodsAccount', event.target.checked, 'checkbox', event.target.checked)} disabled={!isEditable} />
            <span>Use Shipped Goods Account</span>
          </div>
        </div>
      </div>
    </div>
  );
}
