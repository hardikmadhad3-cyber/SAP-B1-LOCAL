import React from 'react';
import SapDateInput from '../common/SapDateInput';
import { DocCheckbox, DocField, DocLookup, DocTabColumn, DocTabColumns, DocTabPanel, DocTabSection } from './DocumentTabLayout';

// SAP B1 Accounting tab for marketing documents: "Accounting" (left) and
// "Reference" (right) columns plus the Manually Recalculate Due Date block.
// `names` maps to the page's header keys (pages save e.g. `bpProject` vs
// `projectCode`, `cashDiscountDateOffset` vs `cashDiscountOffset`).
// `fields` switches on the SAP fields a document type actually has;
// `extraFields` adds company-specific rows ({ key, label, type, column }).
const DEFAULT_NAMES = {
  journalRemark: 'journalRemark',
  paymentTerms: 'paymentTerms',
  paymentMethod: 'paymentMethod',
  centralBankIndicator: 'centralBankIndicator',
  consolidationType: 'consolidationType',
  consolidatingBP: 'consolidatingBP',
  bpProject: 'bpProject',
  qrCodeFrom: 'createQrCodeFrom',
  cancellationDate: 'cancellationDate',
  requiredDate: 'requiredDate',
  indicator: 'indicator',
  orderNumber: 'orderNumber',
  owner: 'owner',
  remarks: 'otherInstruction',
  controlAccount: 'controlAccount',
  paymentBlock: 'paymentBlock',
  paymentBlockReason: 'paymentBlockReason',
  maxCashDiscount: 'maxCashDiscount',
  referencedDocument: '',
  dueMonths: 'dueDateMonths',
  dueDays: 'dueDateDays',
  dueMode: '',
  cashDiscountOffset: 'cashDiscountDateOffset',
  useShippedGoodsAccount: 'useShippedGoodsAccount',
};

// Used when the page has no payment-method master data (stored as text).
const FALLBACK_PAYMENT_METHODS = ['Bank Transfer', 'Cheque', 'Cash', 'Credit Card'].map((value) => ({ value, label: value }));

const DEFAULT_DUE_MODES = [{ value: 'None', label: 'None' }];

const withSaved = (options, value) => {
  const saved = String(value ?? '').trim();
  if (!saved || options.some((option) => String(option.value) === saved)) return options;
  return [...options, { value: saved, label: saved }];
};

export default function DocumentAccountingTab({
  header = {},
  onHeaderChange,
  isEditable = true,
  paymentTermOptions = [],
  paymentMethodOptions,
  referenceDocuments = [],
  onOpenReferenceDocuments,
  names: nameOverrides = {},
  consolidationOptions = [],
  dueModeOptions = DEFAULT_DUE_MODES,
  extraFields = [],
  fields: {
    apControls = false,
    dates = true,
    owner = false,
    consolidation = false,
    dueDate = true,
    shippedGoods = false,
  } = {},
}) {
  const names = {
    ...DEFAULT_NAMES,
    ...Object.fromEntries(extraFields.map((extra) => [extra.key, extra.key])),
    ...nameOverrides,
  };
  const disabled = !isEditable || typeof onHeaderChange !== 'function';
  const value = (key) => header[names[key]] ?? '';
  const input = (key, extra = {}) => (id) => (
    <input id={id} name={names[key]} value={value(key)} onChange={onHeaderChange} disabled={disabled} {...extra} />
  );
  const date = (key) => (id) => (
    <SapDateInput id={id} name={names[key]} value={value(key)} onChange={onHeaderChange} disabled={disabled} />
  );
  const select = (key, options, placeholder = '-- Select --') => (id) => (
    <select id={id} name={names[key]} value={value(key)} onChange={onHeaderChange} disabled={disabled}>
      <option value="">{placeholder}</option>
      {withSaved(options, value(key)).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
  const referenceCount = (Array.isArray(referenceDocuments) ? referenceDocuments : [])
    .filter((row) => String(row.transactionType || row.docNumber || row.docEntry || row.extDocNumber || '').trim())
    .length;
  const renderExtra = (column) => extraFields
    .filter((extra) => (extra.column || 'left') === column)
    .map((extra) => {
      const key = extra.key;
      const control = extra.type === 'date' ? date(key) : input(key, extra.type === 'number' ? { type: 'number' } : {});
      return <DocField key={key} label={extra.label}>{control}</DocField>;
    });
  const methods = Array.isArray(paymentMethodOptions) && paymentMethodOptions.length ? paymentMethodOptions : FALLBACK_PAYMENT_METHODS;

  return (
    <DocTabPanel className="sap-doc-tab--accounting">
      <DocTabColumns>
        <DocTabColumn>
          <div className="sap-doc-tab__section-title">Accounting</div>
          <DocField label="Journal Remark">{input('journalRemark', { maxLength: 254 })}</DocField>
          {apControls ? (
            <>
              <DocField label="Control Account">{input('controlAccount')}</DocField>
              <DocField label="Payment Block">
                {(id) => (
                  <>
                    <input id={id} type="checkbox" name={names.paymentBlock} checked={Boolean(header[names.paymentBlock])} onChange={onHeaderChange} disabled={disabled} />
                    <input aria-label="Payment Block reason" name={names.paymentBlockReason} value={value('paymentBlockReason')} onChange={onHeaderChange} disabled={disabled || !header[names.paymentBlock]} />
                  </>
                )}
              </DocField>
              <DocCheckbox label="Max. Cash Discount" name={names.maxCashDiscount} checked={Boolean(header[names.maxCashDiscount])} onChange={onHeaderChange} disabled={disabled} />
            </>
          ) : null}
          <DocField label="Payment Terms">{select('paymentTerms', Array.isArray(paymentTermOptions) ? paymentTermOptions : [])}</DocField>
          <DocField label="Payment Method">{select('paymentMethod', methods)}</DocField>
          <DocField label="Central Bank Ind.">{input('centralBankIndicator')}</DocField>
          {consolidation ? (
            <>
              <DocField label="Consolidation Type">{select('consolidationType', consolidationOptions)}</DocField>
              <DocField label="Consolidating BP">{input('consolidatingBP')}</DocField>
            </>
          ) : null}
          {renderExtra('left')}
        </DocTabColumn>

        <DocTabColumn>
          <div className="sap-doc-tab__section-title">Reference</div>
          <DocField label="BP Project">{input('bpProject')}</DocField>
          <DocField label="Create QR Code From">{input('qrCodeFrom')}</DocField>
          {dates ? (
            <>
              <DocField label="Cancellation Date">{date('cancellationDate')}</DocField>
              <DocField label="Required Date">{date('requiredDate')}</DocField>
            </>
          ) : null}
          <DocField label="Indicator">{select('indicator', [])}</DocField>
          <DocField label="Order Number">{input('orderNumber')}</DocField>
          <DocField label="Referenced Document">
            {(id) => (
              <DocLookup onLookup={onOpenReferenceDocuments} disabled={!onOpenReferenceDocuments || (disabled && !referenceCount)} title="Open Referenced Documents">
                {!onOpenReferenceDocuments && names.referencedDocument ? (
                  <input id={id} name={names.referencedDocument} value={value('referencedDocument')} onChange={onHeaderChange} disabled={disabled} />
                ) : (
                  <input id={id} aria-label="Referenced Document count" readOnly value={referenceCount ? `(${referenceCount})` : ''} />
                )}
              </DocLookup>
            )}
          </DocField>
          {owner ? (
            <>
              <DocField label="Owner">{input('owner')}</DocField>
              <DocField label="Remarks / Instructions">{input('remarks')}</DocField>
            </>
          ) : null}
          {renderExtra('right')}
        </DocTabColumn>
      </DocTabColumns>

      {dueDate || shippedGoods ? (
        <DocTabSection title={dueDate ? 'Manually Recalculate Due Date' : null}>
          {dueDate ? (
            <>
              <DocField label="Due Date">
                {(id) => (
                  <>
                    {names.dueMode ? (
                      <select aria-label="Due date basis" name={names.dueMode} value={value('dueMode') || dueModeOptions[0]?.value || ''} onChange={onHeaderChange} disabled={disabled}>
                        {withSaved(dueModeOptions, value('dueMode')).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    ) : null}
                    <input id={id} type="number" min="0" className="sap-doc-field__short" aria-label="Months" name={names.dueMonths} value={value('dueMonths')} onChange={onHeaderChange} disabled={disabled} />
                    <span className="sap-doc-field__inline-text">Months +</span>
                    <input type="number" min="0" className="sap-doc-field__short" aria-label="Days" name={names.dueDays} value={value('dueDays')} onChange={onHeaderChange} disabled={disabled} />
                    <span className="sap-doc-field__inline-text">Days</span>
                  </>
                )}
              </DocField>
              <DocField label="Cash Discount Date Offset">{input('cashDiscountOffset', { type: 'number' })}</DocField>
            </>
          ) : null}
          {shippedGoods ? (
            <DocCheckbox
              label="Use Shipped Goods Account"
              name={names.useShippedGoodsAccount}
              checked={Boolean(header[names.useShippedGoodsAccount])}
              onChange={onHeaderChange}
              disabled={disabled}
            />
          ) : null}
        </DocTabSection>
      ) : null}
    </DocTabPanel>
  );
}
