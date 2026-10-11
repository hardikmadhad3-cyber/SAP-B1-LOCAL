import SapInput from '../../../components/common/SapInput';
import React from 'react';

const SELECT_PLACEHOLDER = '— Select —';

function TaxField({ label, name, value, onChange, isEditable, type = 'text', error }) {
  return (
    <div className="sap-b1-tax-field">
      <label className="sap-b1-tax-label" htmlFor={`sap-tax-${name}`}>{label}</label>
      <SapInput
        id={`sap-tax-${name}`}
        type={type}
        className={`sap-b1-tax-control${error ? ' sap-b1-tax-control--error' : ''}`}
        name={name}
        value={value || ''}
        onChange={onChange}
        disabled={!isEditable}
      />
    </div>
  );
}

function TaxSelect({ label, name, value, onChange, isEditable, children }) {
  return (
    <div className="sap-b1-tax-field">
      <label className="sap-b1-tax-label" htmlFor={`sap-tax-${name}`}>{label}</label>
      <select
        id={`sap-tax-${name}`}
        className="sap-b1-tax-control"
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

export default function TaxTab({
  onOpenTaxInfoModal,
  header = {},
  onHeaderChange,
  showTaxInvoiceReference = false,
  taxInvoiceReferenceRequired = false,
  errors = {},
  isEditable = true,
}) {
  const showCreditMemoFields = showTaxInvoiceReference;
  const canEditFields = isEditable && typeof onHeaderChange === 'function';

  return (
    <div className="sap-b1-tax-layout">
      <div className="sap-b1-tax-left">
        <div className="sap-b1-tax-field sap-b1-tax-information-row">
          <span className="sap-b1-tax-label">Tax Information</span>
          <button
            type="button"
            className="sap-b1-tax-ellipsis"
            onClick={onOpenTaxInfoModal}
            disabled={!isEditable}
            aria-label="Open Tax Information"
          >
            ...
          </button>
        </div>

        <TaxSelect label="Transaction Category" name="transactionCategory" value={header.transactionCategory} onChange={onHeaderChange} isEditable={canEditFields}>
          <option value="">{SELECT_PLACEHOLDER}</option>
          <option value="B2B">B2B</option>
          <option value="B2C">B2C</option>
          <option value="Export">Export</option>
          <option value="SEZ">SEZ</option>
        </TaxSelect>

        <TaxField label="Form No." name="formNo" value={header.formNo} onChange={onHeaderChange} isEditable={canEditFields} />

        {!showCreditMemoFields && (
          <TaxSelect label="Duty Status" name="dutyStatus" value={header.dutyStatus || 'With Payment of Duty'} onChange={onHeaderChange} isEditable={canEditFields}>
            <option value="With Payment of Duty">With Payment of Duty</option>
            <option value="Without Payment of Duty">Without Payment of Duty</option>
            <option value="Exempted">Exempted</option>
          </TaxSelect>
        )}

        <div className="sap-b1-tax-spacer" />
        <TaxField label="Reference Number" name="referenceNumber" value={header.referenceNumber} onChange={onHeaderChange} isEditable={canEditFields} />
        <TaxField label="Ref. Date" name="referenceDate" value={header.referenceDate} onChange={onHeaderChange} isEditable={canEditFields} type="date" />

        <label className="sap-b1-tax-check-row">
          <input type="checkbox" name="revision" checked={!!header.revision} onChange={onHeaderChange} disabled={!canEditFields} />
          <span>Revision</span>
        </label>

        {showCreditMemoFields && (
          <>
            <TaxField
              label={`Original Ref. No.${taxInvoiceReferenceRequired ? ' *' : ''}`}
              name="taxInvoiceNo"
              value={header.taxInvoiceNo}
              onChange={onHeaderChange}
              isEditable={canEditFields}
              error={errors.taxInvoiceNo}
            />
            <TaxField
              label={`Original Ref. Date${taxInvoiceReferenceRequired ? ' *' : ''}`}
              name="taxInvoiceDate"
              value={header.taxInvoiceDate}
              onChange={onHeaderChange}
              isEditable={canEditFields}
              type="date"
              error={errors.taxInvoiceDate}
            />
          </>
        )}

        <div className="sap-b1-tax-bottom">
          <TaxSelect label="Reason for Issuing Note" name="reasonForIssuingNote" value={header.reasonForIssuingNote || 'Sales Return'} onChange={onHeaderChange} isEditable={canEditFields}>
            <option value="Sales Return">Sales Return</option>
            <option value="Post Sale Discount">Post Sale Discount</option>
            <option value="Deficiency in Services">Deficiency in Services</option>
            <option value="Correction in Invoice">Correction in Invoice</option>
          </TaxSelect>

          <label className="sap-b1-tax-check-row">
            <input type="checkbox" name="supplyCovered" checked={!!header.supplyCovered} onChange={onHeaderChange} disabled={!canEditFields} />
            <span>Supply Covered under Sec 7 of IGST Act</span>
          </label>

          <TaxSelect label="Differential % of Tax Rate" name="differentialTaxRate" value={header.differentialTaxRate || '100'} onChange={onHeaderChange} isEditable={canEditFields}>
            <option value="100">100</option>
            <option value="75">75</option>
            <option value="50">50</option>
            <option value="25">25</option>
          </TaxSelect>
        </div>
      </div>

      <div className="sap-b1-tax-right">
        <label className="sap-b1-tax-check-row">
          <input type="checkbox" name="importTax" checked={!!header.importTax} onChange={onHeaderChange} disabled={!canEditFields} />
          <span>Import</span>
        </label>
      </div>
    </div>
  );
}
