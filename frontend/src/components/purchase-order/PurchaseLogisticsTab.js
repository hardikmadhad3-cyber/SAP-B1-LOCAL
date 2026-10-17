import React from 'react';
import { DocCheckbox, DocField, DocLookup, DocTabColumn, DocTabColumns, DocTabPanel } from '../document/DocumentTabLayout';
import { DOCUMENT_LANGUAGE_OPTIONS } from '../document/SalesLogisticsTab';

export const PURCHASE_LOGISTICS_LANGUAGE_OPTIONS = DOCUMENT_LANGUAGE_OPTIONS;

export const PURCHASE_LOGISTICS_SELECT_OPTION = { value: '', label: 'Select' };

export const formatPurchaseLogisticsAddress = (address) => {
  if (!address) return '';

  return [
    [address.Street, address.StreetNo],
    [address.Block, address.Building, address.Address2, address.Address3],
    [address.City, address.County, address.State, address.ZipCode],
    [address.Country],
  ]
    .map((parts) => parts.filter(Boolean).join(', '))
    .filter(Boolean)
    .join('\n');
};

export default function PurchaseLogisticsTab({
  header = {},
  onHeaderChange,
  vendorPayToAddresses = [],
  vendorBillToAddresses = [],
  shippingTypeOptions = [],
  onPayToCodeChange,
  onOpenAddressModal,
  isEditable = true,
}) {
  const safePayToAddresses = Array.isArray(vendorPayToAddresses) ? vendorPayToAddresses : [];
  const safeBillToAddresses = Array.isArray(vendorBillToAddresses) ? vendorBillToAddresses : [];
  const safeShippingTypeOptions = Array.isArray(shippingTypeOptions) ? shippingTypeOptions : [];
  const payToOptions = safePayToAddresses.length ? safePayToAddresses : safeBillToAddresses;
  const hasCurrentLanguageOption = PURCHASE_LOGISTICS_LANGUAGE_OPTIONS.some((option) => String(option.value) === String(header.language || ''));

  const emitHeaderChange = (name, value, type = 'text', checked = false) => {
    onHeaderChange?.({ target: { name, value, type, checked } });
  };

  const handlePayToChange = (event) => {
    if (onPayToCodeChange) {
      onPayToCodeChange(event);
      return;
    }

    const selectedCode = event.target.value;
    const selectedAddress = payToOptions.find((address) => String(address.Address || '') === String(selectedCode || ''));
    const formattedAddress = selectedAddress ? formatPurchaseLogisticsAddress(selectedAddress) : '';

    emitHeaderChange('payToCode', selectedCode);
    emitHeaderChange('payTo', formattedAddress);
    emitHeaderChange('payToAddress', formattedAddress);
  };

  const disabled = !isEditable;

  // Same SAP B1 tab layout as the sales documents (DocumentTabLayout). Field
  // names are unchanged: the purchase pages save billTo / payToCode / payTo.
  return (
    <DocTabPanel className="sap-doc-tab--logistics">
      <DocTabColumns>
        <DocTabColumn>
          <DocField label="Bill To">
            {(id) => (
              <DocLookup onLookup={() => onOpenAddressModal?.('billTo')} disabled={disabled} title="Select Bill To address">
                <textarea id={id} rows={3} name="billTo" value={header.billToAddress || header.billTo || ''} onChange={onHeaderChange} disabled={disabled} />
              </DocLookup>
            )}
          </DocField>

          <DocField label="Pay To">
            {(id) => (
              <select id={id} name="payToCode" value={header.payToCode || ''} onChange={handlePayToChange} disabled={disabled}>
                <option value={PURCHASE_LOGISTICS_SELECT_OPTION.value}>{PURCHASE_LOGISTICS_SELECT_OPTION.label}</option>
                {payToOptions.map((addr) => (
                  <option key={addr.Address} value={addr.Address}>{addr.AddressName || addr.Address || addr.CardCode}</option>
                ))}
              </select>
            )}
          </DocField>
          <DocField>
            <DocLookup onLookup={() => onOpenAddressModal?.('payTo')} disabled={disabled} title="Select Pay To address">
              <textarea rows={3} aria-label="Pay To address" name="payTo" value={header.payToAddress || header.payTo || ''} onChange={onHeaderChange} disabled={disabled} />
            </DocLookup>
          </DocField>

          <DocField label="Shipping Type">
            {(id) => (
              <select id={id} name="shippingType" value={header.shippingType || ''} onChange={onHeaderChange} disabled={disabled}>
                <option value={PURCHASE_LOGISTICS_SELECT_OPTION.value}>{PURCHASE_LOGISTICS_SELECT_OPTION.label}</option>
                {safeShippingTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
          </DocField>

          <DocCheckbox label="Use Pay to Address to Determine Tax" name="usePayToForTax" checked={header.usePayToForTax || false} onChange={onHeaderChange} disabled={disabled} />
        </DocTabColumn>

        <DocTabColumn>
          <DocField label="Language">
            {(id) => (
              <select id={id} name="language" value={header.language || ''} onChange={onHeaderChange} disabled={disabled}>
                <option value={PURCHASE_LOGISTICS_SELECT_OPTION.value}>{PURCHASE_LOGISTICS_SELECT_OPTION.label}</option>
                {PURCHASE_LOGISTICS_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
                {header.language && !hasCurrentLanguageOption ? <option value={header.language}>{header.language}</option> : null}
              </select>
            )}
          </DocField>

          <DocCheckbox label="Split Purchase Order" name="splitPurchaseOrder" checked={header.splitPurchaseOrder || false} onChange={onHeaderChange} disabled={disabled} />
          <DocCheckbox
            label="Approved"
            name="confirmed"
            checked={header.confirmed ?? true}
            title={header.confirmed == null ? 'SAP company default; click to choose explicitly' : undefined}
            onChange={onHeaderChange}
            disabled={disabled}
          />
        </DocTabColumn>
      </DocTabColumns>
    </DocTabPanel>
  );
}
