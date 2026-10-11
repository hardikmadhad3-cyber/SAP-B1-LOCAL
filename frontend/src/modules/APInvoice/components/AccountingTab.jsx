import SapInput from '../../../components/common/SapInput';
const SELECT_PLACEHOLDER = '— Select —';

function TextField({ label, name, value, onChange, isEditable, readOnly = false, type = 'text', className = '' }) {
  return (
    <div className={`po-field ${className}`.trim()}>
      <label className="po-field__label">{label}</label>
      <SapInput
        type={type}
        className="po-field__input"
        name={name}
        value={value || ''}
        onChange={onChange}
        readOnly={readOnly}
        disabled={!isEditable}
      />
    </div>
  );
}

function SelectField({ label, name, value, onChange, isEditable, children, className = '' }) {
  return (
    <div className={`po-field ${className}`.trim()}>
      <label className="po-field__label">{label}</label>
      <select
        className="po-field__select"
        name={name}
        value={value || ''}
        onChange={onChange}
        disabled={!isEditable}
      >
        {children}
      </select>
    </div>
  );
}

function CheckboxField({ label, name, checked, onChange, isEditable, inputName, inputValue }) {
  return (
    <div className="po-field po-sapb1-checkbox-field">
      <label className="po-field__label" />
      <label className="po-checkbox-label">
        <input
          type="checkbox"
          name={name}
          checked={!!checked}
          onChange={onChange}
          disabled={!isEditable}
        />
        <span>{label}</span>
      </label>
      {inputName && (
        <input
          className="po-field__input po-sapb1-inline-input"
          name={inputName}
          value={inputValue || ''}
          onChange={onChange}
          disabled={!isEditable || !checked}
        />
      )}
    </div>
  );
}

export default function AccountingTab({
  header = {},
  onHeaderChange,
  paymentTermOptions = [],
  payTermOpts = [],
  isEditable = true,
}) {
  const terms = Array.isArray(paymentTermOptions) && paymentTermOptions.length
    ? paymentTermOptions
    : (Array.isArray(payTermOpts) ? payTermOpts : []);

  return (
    <div className="po-tab-panel po-sapb1-tab-panel po-sapb1-accounting-tab">
      <div className="po-sapb1-tab-surface po-sapb1-accounting-layout">
        <div className="po-sapb1-accounting-left">
          <TextField label="Journal Remark" name="journalRemark" value={header.journalRemark} onChange={onHeaderChange} isEditable={isEditable} />
          <TextField label="Control Account" name="controlAccount" value={header.controlAccount} onChange={onHeaderChange} isEditable={isEditable} />

          <CheckboxField
            label="Payment Block"
            name="paymentBlock"
            checked={header.paymentBlock}
            onChange={onHeaderChange}
            isEditable={isEditable}
            inputName="paymentBlockReason"
            inputValue={header.paymentBlockReason}
          />
          <CheckboxField label="Max. Cash Discount" name="maxCashDiscount" checked={header.maxCashDiscount} onChange={onHeaderChange} isEditable={isEditable} />

          <SelectField label="Payment Terms" name="paymentTerms" value={header.paymentTerms} onChange={onHeaderChange} isEditable={isEditable}>
            <option value="">{SELECT_PLACEHOLDER}</option>
            {terms.map((term) => (
              <option key={term.value} value={term.value}>{term.label}</option>
            ))}
          </SelectField>

          <SelectField label="Payment Method" name="paymentMethod" value={header.paymentMethod} onChange={onHeaderChange} isEditable={isEditable}>
            <option value="">{SELECT_PLACEHOLDER}</option>
            <option>Bank Transfer</option>
            <option>Cheque</option>
            <option>Cash</option>
            <option>Credit Card</option>
            {header.paymentMethod && !['Bank Transfer', 'Cheque', 'Cash', 'Credit Card'].includes(String(header.paymentMethod)) && (
              <option value={header.paymentMethod}>{header.paymentMethod}</option>
            )}
          </SelectField>

          <SelectField label="Central Bank Ind." name="centralBankIndicator" value={header.centralBankIndicator} onChange={onHeaderChange} isEditable={isEditable}>
            <option value="">{SELECT_PLACEHOLDER}</option>
          </SelectField>

          <div className="po-sapb1-due-date-section">
            <div className="po-sapb1-section-label">Manually Recalculate Due Date:</div>
            <div className="po-sapb1-due-date-row">
              <select className="po-field__select" name="dueDateBasis" value={header.dueDateBasis || ''} onChange={onHeaderChange} disabled={!isEditable}>
                <option value="">None</option>
                <option value="selectedDate">Selected Date</option>
                <option value="monthsDays">Months + Days</option>
              </select>
              <input className="po-field__input po-sapb1-number-input" type="number" name="dueDateMonths" value={header.dueDateMonths || 0} onChange={onHeaderChange} disabled={!isEditable} />
              <span>Months +</span>
              <input className="po-field__input po-sapb1-number-input" type="number" name="dueDateDays" value={header.dueDateDays || 0} onChange={onHeaderChange} disabled={!isEditable} />
              <span>Days</span>
            </div>
          </div>

          <TextField label="Cash Discount Date Offset:" name="cashDiscountOffset" value={header.cashDiscountOffset} onChange={onHeaderChange} isEditable={isEditable} type="number" />

          <div className="po-sapb1-accounting-bottom">
            <SelectField label="Consolidation Type" name="consolidationType" value={header.consolidationType || 'Payment Consolidation'} onChange={onHeaderChange} isEditable={isEditable}>
              <option value="Payment Consolidation">Payment Consolidation</option>
              <option value="Delivery Consolidation">Delivery Consolidation</option>
              <option value="None">None</option>
            </SelectField>
            <TextField label="Consolidating BP" name="consolidatingBp" value={header.consolidatingBp} onChange={onHeaderChange} isEditable={isEditable} />
          </div>
        </div>

        <div className="po-sapb1-accounting-right">
          <TextField label="BP Project" name="bpProject" value={header.bpProject} onChange={onHeaderChange} isEditable={isEditable} />
          <TextField label="Create QR Code From" name="qrCodeFrom" value={header.qrCodeFrom} onChange={onHeaderChange} isEditable={isEditable} />

          <SelectField label="Indicator" name="indicator" value={header.indicator} onChange={onHeaderChange} isEditable={isEditable}>
            <option value="">{SELECT_PLACEHOLDER}</option>
          </SelectField>

          <TextField label="Order Number" name="orderNumber" value={header.orderNumber} onChange={onHeaderChange} isEditable={isEditable} />

          <div className="po-field po-sapb1-reference-field">
            <label className="po-field__label">Referenced Document</label>
            <div className="po-sapb1-reference-control">
              <input className="po-field__input" name="referencedDocument" value={header.referencedDocument || ''} onChange={onHeaderChange} disabled={!isEditable} />
              <button type="button" className="po-lookup-btn" disabled={!isEditable}>...</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
