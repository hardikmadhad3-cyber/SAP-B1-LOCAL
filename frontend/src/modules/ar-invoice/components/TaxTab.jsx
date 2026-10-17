import React from 'react';
import SapDateInput from '../../../components/common/SapDateInput';
import DocumentTaxTab from '../../../components/document/DocumentTaxTab';
import { DocField } from '../../../components/document/DocumentTabLayout';

// A/R Invoice Tax tab (also Service A/R Invoice / Credit Memo). Credit memos
// add the original tax invoice reference (`showTaxInvoiceReference`).
export default function TaxTab({
  showTaxInvoiceReference = false,
  taxInvoiceReferenceRequired = false,
  errors = {},
  ...props
}) {
  const { header = {}, onHeaderChange, isEditable = true } = props;
  const required = taxInvoiceReferenceRequired ? ' *' : '';
  return (
    <DocumentTaxTab {...props} variant="sales">
      {showTaxInvoiceReference ? (
        <>
          <DocField label={`Original Invoice No.${required}`}>
            {(id) => (
              <input
                id={id}
                name="taxInvoiceNo"
                className={errors.taxInvoiceNo ? 'del-field__input--error' : undefined}
                value={header.taxInvoiceNo || ''}
                onChange={onHeaderChange}
                disabled={!isEditable}
                maxLength={100}
                title={errors.taxInvoiceNo || 'Reference number of the original tax invoice'}
              />
            )}
          </DocField>
          <DocField label={`Original Invoice Date${required}`}>
            {(id) => (
              <SapDateInput
                id={id}
                name="taxInvoiceDate"
                className={errors.taxInvoiceDate ? 'del-field__input--error' : ''}
                value={header.taxInvoiceDate || ''}
                onChange={onHeaderChange}
                disabled={!isEditable}
                title={errors.taxInvoiceDate || 'Date of the original tax invoice'}
              />
            )}
          </DocField>
        </>
      ) : null}
    </DocumentTaxTab>
  );
}
