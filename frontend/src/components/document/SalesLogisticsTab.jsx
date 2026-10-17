import React from 'react';
import { DocCheckbox, DocField, DocLookup, DocTabColumn, DocTabColumns, DocTabPanel } from './DocumentTabLayout';

// SAP B1 Logistics tab for sales documents (Quotation, Order, Delivery,
// A/R Invoice, A/R Credit Memo and the service A/R documents). One layout;
// the per-document SAP field set comes from SALES_LOGISTICS_FIELDS.
//
// `names` maps the shared fields to each page's header keys, because pages
// save different header names (e.g. Delivery `languageCode`, A/R
// `pickPackRemarks`, Quotation `shipTo` / `payTo` for the address text).
// SAP B1 BoSuppLangs codes: 3 = English (US), 8 = English (UK). Any other
// saved code is still shown (as its number) so it round-trips unchanged.
export const DOCUMENT_LANGUAGE_OPTIONS = [
  { value: '8', label: 'English (UK)' },
  { value: '3', label: 'English (US)' },
];

export const SALES_LOGISTICS_FIELDS = {
  quotation: { approved: true, partialDelivery: true },
  order: { printPickingSheet: true, procurement: true, approved: true, partialDelivery: true },
  delivery: { tracking: true, approved: true },
  invoice: { tracking: true, approved: true },
  creditMemo: { tracking: true, approved: true },
};

const DEFAULT_NAMES = {
  shipToCode: 'shipToCode',
  shipToAddress: 'shipToAddress',
  billToCode: 'billToCode',
  billToAddress: 'billToAddress',
  language: 'language',
  pickAndPackRemarks: 'pickAndPackRemarks',
  bpChannelName: 'bpChannelName',
  bpChannelContact: 'bpChannelContact',
};

const addressLabel = (address) => `${address.AddressName || address.Address || address.CardCode} - ${address.State || 'No State'}`;

function AddressSelect({ id, name, value, options, onChange, disabled }) {
  const hasSaved = value && !options.some((address) => String(address.Address) === String(value));
  return (
    <select id={id} name={name} value={value || ''} onChange={onChange} disabled={disabled}>
      <option value="">Select</option>
      {options.map((address) => (
        <option key={address.Address} value={address.Address}>{addressLabel(address)}</option>
      ))}
      {hasSaved ? <option value={value}>{value}</option> : null}
    </select>
  );
}

export default function SalesLogisticsTab({
  documentType = 'order',
  header = {},
  onHeaderChange,
  shipToAddresses = [],
  billToAddresses = [],
  payToAddresses = [],
  shippingTypeOptions = [],
  onOpenAddressModal,
  onOpenEWayBillModal,
  isEditable = true,
  names: nameOverrides = {},
}) {
  const fields = SALES_LOGISTICS_FIELDS[documentType] || SALES_LOGISTICS_FIELDS.order;
  const names = { ...DEFAULT_NAMES, ...nameOverrides };
  const list = (value) => (Array.isArray(value) ? value : []);
  const shipToOptions = list(shipToAddresses).length ? list(shipToAddresses) : list(payToAddresses);
  const billToOptions = list(billToAddresses).length ? list(billToAddresses) : list(payToAddresses);
  const disabled = !isEditable;
  const value = (key, fallbackKey) => header[names[key]] ?? (fallbackKey ? header[fallbackKey] : '') ?? '';
  const text = (key) => ({ name: names[key] || key, value: value(key) || '', onChange: onHeaderChange, disabled });
  const check = (name, checked) => ({ name, checked, onChange: onHeaderChange, disabled });
  const languageValue = value('language') || '8';
  const hasLanguageOption = DOCUMENT_LANGUAGE_OPTIONS.some((option) => option.value === String(languageValue));

  return (
    <DocTabPanel className="sap-doc-tab--logistics">
      <DocTabColumns>
        <DocTabColumn>
          <DocField label="Ship To">
            {(id) => (
              <DocLookup onLookup={() => onOpenAddressModal?.('shipTo')} disabled={disabled} title="Select Ship To address">
                <AddressSelect id={id} name={names.shipToCode} value={value('shipToCode')} options={shipToOptions} onChange={onHeaderChange} disabled={disabled} />
              </DocLookup>
            )}
          </DocField>
          <DocField>
            <textarea rows={3} aria-label="Ship To address" {...text('shipToAddress')} value={value('shipToAddress', 'shipTo') || ''} />
          </DocField>

          <DocField label="Bill To">
            {(id) => (
              <DocLookup onLookup={() => onOpenAddressModal?.('billTo')} disabled={disabled} title="Select Bill To address">
                <AddressSelect id={id} name={names.billToCode} value={value('billToCode')} options={billToOptions} onChange={onHeaderChange} disabled={disabled} />
              </DocLookup>
            )}
          </DocField>
          <DocField>
            <textarea rows={3} aria-label="Bill To address" {...text('billToAddress')} />
          </DocField>

          <DocField label="Shipping Type">
            {(id) => (
              <select id={id} name="shippingType" value={header.shippingType || ''} onChange={onHeaderChange} disabled={disabled}>
                <option value="">Select</option>
                {list(shippingTypeOptions).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
          </DocField>

          <DocCheckbox label="Use Bill to Address to Determine Tax" {...check('useBillToForTax', Boolean(header.useBillToForTax))} />

          {onOpenEWayBillModal ? (
            <DocField label="E-Way Bill Details">
              <button type="button" className="sap-doc-field__lookup-btn" onClick={onOpenEWayBillModal} aria-label="E-Way Bill Details">...</button>
            </DocField>
          ) : null}
        </DocTabColumn>

        <DocTabColumn>
          {fields.printPickingSheet ? (
            <DocCheckbox label="Print Picking Sheet" {...check('printPickingSheet', Boolean(header.printPickingSheet))} />
          ) : null}

          <DocField label="Language">
            {(id) => (
              <select id={id} name={names.language} value={languageValue} onChange={onHeaderChange} disabled={disabled}>
                {DOCUMENT_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
                {!hasLanguageOption ? <option value={languageValue}>{languageValue}</option> : null}
              </select>
            )}
          </DocField>

          {fields.tracking ? (
            <>
              <DocField label="Tracking No.">{(id) => <input id={id} name="trackingNo" value={header.trackingNo || ''} onChange={onHeaderChange} disabled={disabled} />}</DocField>
              <DocField label="Stamp No.">{(id) => <input id={id} name="stampNo" value={header.stampNo || ''} onChange={onHeaderChange} disabled={disabled} />}</DocField>
            </>
          ) : null}

          {fields.procurement ? (
            <>
              <DocCheckbox label="Procure Non Drop-Ship Items" {...check('procureNonDropShipItems', Boolean(header.procureNonDropShipItems))} />
              <DocCheckbox label="Procure Drop-Ship Items" {...check('procureDropShipItems', header.procureDropShipItems !== false)} />
            </>
          ) : null}

          {fields.approved ? (
            <DocCheckbox
              label="Approved"
              {...check('confirmed', header.confirmed ?? true)}
              title={header.confirmed == null ? 'SAP company default; click to choose explicitly' : undefined}
            />
          ) : null}

          {fields.partialDelivery ? (
            <DocCheckbox label="Allow Partial Delivery" {...check('allowPartialDelivery', header.allowPartialDelivery !== false)} />
          ) : null}

          <DocField label="Pick and Pack Remarks">{(id) => <input id={id} {...text('pickAndPackRemarks')} />}</DocField>
          <DocField label="BP Channel Name">{(id) => <input id={id} {...text('bpChannelName')} />}</DocField>
          <DocField label="BP Channel Contact">
            {(id) => (
              <select id={id} name={names.bpChannelContact} value={value('bpChannelContact') || ''} onChange={onHeaderChange} disabled={disabled}>
                <option value="">Select</option>
                {value('bpChannelContact') ? <option value={value('bpChannelContact')}>{value('bpChannelContact')}</option> : null}
              </select>
            )}
          </DocField>
        </DocTabColumn>
      </DocTabColumns>
    </DocTabPanel>
  );
}
