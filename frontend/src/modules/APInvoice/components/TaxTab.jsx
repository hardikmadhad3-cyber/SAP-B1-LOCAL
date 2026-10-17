import React from 'react';
import SapInput from '../../../components/common/SapInput';
import DocumentTaxTab from '../../../components/document/DocumentTaxTab';
import { DocCheckbox, DocField } from '../../../components/document/DocumentTabLayout';

// A/P Invoice Tax tab (also A/P Credit Memo and the service A/P documents).
// Shared SAP B1 layout; A/P keeps the values it already stores (`formNo`,
// full-text Duty Status, `Export` category) and adds the A/P reference rows.
const AP_TRANSACTION_CATEGORIES = [
  { value: 'B2B', label: 'B2B' },
  { value: 'B2C', label: 'B2C' },
  { value: 'Export', label: 'Export' },
  { value: 'SEZ', label: 'SEZ' },
];

const AP_DUTY_OPTIONS = [
  { value: 'With Payment of Duty', label: 'With Payment of Duty' },
  { value: 'Without Payment of Duty', label: 'Without Payment of Duty' },
  { value: 'Exempted', label: 'Exempted' },
];

const REASONS_FOR_NOTE = ['Sales Return', 'Post Sale Discount', 'Deficiency in Services', 'Correction in Invoice'];

export default function TaxTab({
  showTaxInvoiceReference = false,
  taxInvoiceReferenceRequired = false,
  errors = {},
  ...props
}) {
  const { header = {}, onHeaderChange, isEditable = true } = props;
  const isCreditMemo = showTaxInvoiceReference;
  const disabled = !isEditable || typeof onHeaderChange !== 'function';
  const required = taxInvoiceReferenceRequired ? ' *' : '';
  const input = (name, type = 'text') => (id) => (
    <SapInput
      id={id}
      type={type}
      name={name}
      className={errors[name] ? 'del-field__input--error' : undefined}
      value={header[name] || ''}
      onChange={onHeaderChange}
      disabled={disabled}
      title={errors[name] || undefined}
    />
  );

  return (
    <DocumentTaxTab
      {...props}
      variant="purchase"
      names={{ formNo: 'formNo' }}
      dutyOptions={AP_DUTY_OPTIONS}
      transactionOptions={AP_TRANSACTION_CATEGORIES}
      hideDutyStatus={isCreditMemo}
    >
      <DocField label="Reference Number">{input('referenceNumber')}</DocField>
      <DocField label="Ref. Date">{input('referenceDate', 'date')}</DocField>
      <DocCheckbox label="Revision" name="revision" checked={Boolean(header.revision)} onChange={onHeaderChange} disabled={disabled} />

      {isCreditMemo ? (
        <>
          <DocField label={`Original Ref. No.${required}`}>{input('taxInvoiceNo')}</DocField>
          <DocField label={`Original Ref. Date${required}`}>{input('taxInvoiceDate', 'date')}</DocField>
          <DocField label="Reason for Issuing Note">
            {(id) => (
              <select id={id} name="reasonForIssuingNote" value={header.reasonForIssuingNote || REASONS_FOR_NOTE[0]} onChange={onHeaderChange} disabled={disabled}>
                {REASONS_FOR_NOTE.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            )}
          </DocField>
        </>
      ) : null}
    </DocumentTaxTab>
  );
}
