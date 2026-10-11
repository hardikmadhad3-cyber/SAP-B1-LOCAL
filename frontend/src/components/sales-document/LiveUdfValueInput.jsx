import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { fetchSalesDocumentLookup } from '../../api/salesDocumentSchemaApi';
import { loadSalesDocumentFieldLookupOptions } from '../../utils/salesDocumentLiveFields';
import LineValueLookupModal from './LineValueLookupModal';

const DOCUMENT_BY_LINE_TABLE = {
  RDR1: 'SALES_ORDER', QUT1: 'SALES_QUOTATION', DLN1: 'DELIVERY',
  INV1: 'AR_INVOICE', RIN1: 'AR_CREDIT_MEMO', POR1: 'PURCHASE_ORDER',
  PDN1: 'GRPO', PCH1: 'AP_INVOICE', RPC1: 'AP_CREDIT_MEMO',
  PRQ1: 'PURCHASE_REQUEST', PQT1: 'PURCHASE_QUOTATION',
};

export default function LiveUdfValueInput({ field, value, onChange, disabled, className = 'so-grid__input', line = {} }) {
  const { company } = useAuth();
  const companyScope = `${company?.companyId || ''}:${company?.dbName || ''}`;
  const requestId = useRef(0);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    requestId.current += 1;
    setOpen(false);
    setOptions([]);
    setError('');
  }, [companyScope]);

  const close = () => {
    requestId.current += 1;
    setOpen(false);
  };

  const show = async () => {
    if (disabled) return;
    const currentRequest = ++requestId.current;
    setOptions([]);
    setError('');
    setOpen(true);
    try {
      const nextOptions = await loadSalesDocumentFieldLookupOptions({
        fetchLookup: fetchSalesDocumentLookup,
        source: field.lookupSource,
        field,
        line,
        documentType: DOCUMENT_BY_LINE_TABLE[field.tableId]
          || DOCUMENT_BY_LINE_TABLE[String(field.schemaFieldId || '').split('.')[0]],
      });
      if (requestId.current === currentRequest) setOptions(nextOptions);
    } catch (lookupError) {
      if (requestId.current === currentRequest) setError(lookupError?.message || 'Unable to load values');
    }
  };

  return (
    <>
      <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
        <input className={className} value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        <button type="button" disabled={disabled} onClick={show} aria-label={`Choose ${field.label || field.key} value`}>...</button>
      </span>
      <LineValueLookupModal
        isOpen={open}
        onClose={close}
        onSelect={(option) => onChange(option.value)}
        options={options}
        title={field.label ? `List of ${field.label} Values` : 'List of User-Defined Values'}
        emptyMessage={error || 'No values found'}
        allowCreate={false}
      />
    </>
  );
}
