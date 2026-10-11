import SapDateInput from '../../../components/common/SapDateInput';
import React from 'react';

export default function AccountingTab({
  header,
  onHeaderChange,
  paymentTermOptions,
  referenceDocuments = [],
  onOpenReferenceDocuments,
  isEditable = true,
}) {
  const referenceCount = referenceDocuments.filter((row) => (
    String(row.transactionType || row.docNumber || row.docEntry || row.extDocNumber || '').trim()
  )).length;

  return (
    <div className="grpo-accounting-layout">
      {/* LEFT */}
      <div className="grpo-accounting-layout__column">
        <div className="po-field">
          <label className="po-field__label">Journal Remark</label>
          <input className="po-field__input" name="journalRemark" value={header.journalRemark} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Payment Terms</label>
          <select className="po-field__select" name="paymentTerms" value={header.paymentTerms} onChange={onHeaderChange}>
            <option value="">Select</option>
            {paymentTermOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="po-field">
          <label className="po-field__label">Payment Method</label>
          <select className="po-field__select" name="paymentMethod" value={header.paymentMethod} onChange={onHeaderChange}>
            <option value="">Select</option>
            <option>Bank Transfer</option>
            <option>Cheque</option>
            <option>Cash</option>
            <option>Credit Card</option>
          </select>
        </div>
        <div className="po-field">
          <label className="po-field__label">Central Bank Ind.</label>
          <select className="po-field__select" name="centralBankInd" value={header.centralBankInd} onChange={onHeaderChange}>
            <option value="">Select</option>
          </select>
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="po-section-title">Manually Recalculate Due Date</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="po-field">
              <label className="po-field__label">Months</label>
              <input type="number" className="po-field__input" style={{ width: 70 }} name="dueDateMonths" value={header.dueDateMonths} onChange={onHeaderChange} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Days</label>
              <input type="number" className="po-field__input" style={{ width: 70 }} name="dueDateDays" value={header.dueDateDays} onChange={onHeaderChange} />
            </div>
          </div>
        </div>
        <div className="po-field">
          <label className="po-field__label">Cash Disc. Offset</label>
          <input type="number" className="po-field__input" name="cashDiscountOffset" value={header.cashDiscountOffset} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Payment Terms 2</label>
          <input className="po-field__input" name="paymentTerms2" value={header.paymentTerms2} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Advance Payment %</label>
          <input className="po-field__input" name="advancePaymentPercent" value={header.advancePaymentPercent} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Advance Amount</label>
          <input className="po-field__input" name="advanceAmt" value={header.advanceAmt} onChange={onHeaderChange} />
        </div>
      </div>

      {/* RIGHT */}
      <div className="grpo-accounting-layout__column">
        <div className="po-field">
          <label className="po-field__label">Balance Payment</label>
          <input className="po-field__input" name="balancePaymentAgainst" value={header.balancePaymentAgainst} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Shipment Within</label>
          <input className="po-field__input" name="shipmentWithin" value={header.shipmentWithin} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Expiry Date</label>
          <SapDateInput  className="po-field__input" name="expiryDate" value={header.expiryDate} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Advance Date</label>
          <SapDateInput  className="po-field__input" name="advanceDate" value={header.advanceDate} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Within Days</label>
          <input type="number" className="po-field__input" name="withinDays" value={header.withinDays} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Days From</label>
          <input className="po-field__input" name="daysFrom" value={header.daysFrom} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">BP Project</label>
          <input className="po-field__input" name="bpProject" value={header.bpProject} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">QR Code From</label>
          <input className="po-field__input" name="qrCodeFrom" value={header.qrCodeFrom} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Cancellation Date</label>
          <SapDateInput  className="po-field__input" name="cancellationDate" value={header.cancellationDate} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Required Date</label>
          <SapDateInput  className="po-field__input" name="requiredDate" value={header.requiredDate} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Indicator</label>
          <select className="po-field__select" name="indicator" value={header.indicator} onChange={onHeaderChange}>
            <option value="">Select</option>
          </select>
        </div>
        <div className="po-field">
          <label className="po-field__label">Order Number</label>
          <input className="po-field__input" name="orderNumber" value={header.orderNumber} onChange={onHeaderChange} />
        </div>
        <div className="po-field">
          <label className="po-field__label">Referenced Document</label>
          <div className="grpo-reference-control">
            <input
              className="po-field__input grpo-reference-control__input"
              readOnly
              value={referenceCount ? `(${referenceCount})` : ''}
              aria-label="Referenced Document count"
            />
            <button
              type="button"
              className="po-btn grpo-reference-control__button"
              onClick={onOpenReferenceDocuments}
              disabled={!isEditable && !referenceCount}
              aria-label="Open Referenced Documents"
            >
              ...
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
