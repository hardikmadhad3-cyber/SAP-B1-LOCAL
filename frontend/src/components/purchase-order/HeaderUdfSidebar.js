import SapInput from '../common/SapInput';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBP, searchBP } from '../../api/businessPartnerApi';
import { createPredefinedText, fetchPredefinedTexts } from '../../api/predefinedTextApi';
import SapLookupModal from '../common/SapLookupModal';
import LineValueLookupModal from '../sales-document/LineValueLookupModal';
import BusinessPartnerModal from '../../modules/sales-order/components/BusinessPartnerModal';
import { matchesSapSearchText } from '../../utils/sapSearch';

const SELLER_CODE_KEY = 'U_Seller_Code';
const SELLER_NAME_KEY = 'U_Seller_Name';
const SELLER_ADDRESS_ID_KEY = 'U_Seller_AddressId';
const SELLER_ADDRESS_KEY = 'U_Seller_Address';
const SELLER_BP_TYPE = 'cSupplier';
const BILL_TO_PARTY_BP_TYPE = 'cCustomer';
const fetchSupplierPartners = (query, { skip = 0, top = 200 } = {}) =>
  searchBP(query, SELLER_BP_TYPE, top, skip);
const fetchCustomerPartners = (query, { skip = 0, top = 200 } = {}) =>
  searchBP(query, BILL_TO_PARTY_BP_TYPE, top, skip);

const normalizeFieldText = (value) =>
  String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const getFieldIdentity = (field) => normalizeFieldText(
  `${String(field?.key || '').replace(/^U_/i, '')} ${field?.label || ''}`
);

const isTermsOfSupplyField = (field) => {
  const identity = getFieldIdentity(field);
  return identity.includes('termsofsupply') || identity.includes('supplyterms');
};

const isSellerCodeField = (field) =>
  String(field?.key || '') === SELLER_CODE_KEY ||
  String(field?.label || '').trim().toLowerCase() === 'seller code';

const isToVendorCodeField = (field) => {
  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  return label === 'tocodevendor' ||
    label === 'tovendorcode' ||
    identity.includes('tocodevendor') ||
    identity.includes('tovendorcode');
};

const isToVendorNameField = (field) => {
  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  return label === 'toname' ||
    label === 'tovendorname' ||
    identity.includes('toname') ||
    identity.includes('tovendorname');
};

const isToVendorAddressIdField = (field) => {
  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  return label === 'toaddressid' ||
    label === 'tovendoraddressid' ||
    identity.includes('toaddressid') ||
    identity.includes('tovendoraddressid');
};

const isToVendorAddressField = (field) => {
  if (isToVendorAddressIdField(field)) return false;
  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  return label === 'toaddress' ||
    label === 'tovendoraddress' ||
    identity.includes('toaddress') ||
    identity.includes('tovendoraddress');
};

const isBillToPartyCodeField = (field) => {
  if (isSellerCodeField(field) || isToVendorCodeField(field)) return false;
  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  const key = normalizeFieldText(String(field?.key || '').replace(/^U_/i, ''));

  return label === 'billtopartycode' ||
    label === 'billpartycode' ||
    label === 'partycode' ||
    label === 'buyerscode2' ||
    label === 'buyercode2' ||
    key === 'billtopartycode' ||
    key === 'billpartycode' ||
    key === 'partycode' ||
    key === 'buyers2code' ||
    key === 'buyerscode2' ||
    key === 'buyercode2' ||
    identity.includes('billtopartycode') ||
    identity.includes('billpartycode') ||
    identity.includes('buyers2code') ||
    identity.includes('buyerscode2') ||
    identity.includes('buyercode2');
};

const isBillToPartyNameField = (field) => {
  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  const key = normalizeFieldText(String(field?.key || '').replace(/^U_/i, ''));

  return label === 'billtopartyname' ||
    label === 'billpartyname' ||
    label === 'partyname' ||
    label === 'buyersname2' ||
    label === 'buyername2' ||
    key === 'billtopartyname' ||
    key === 'billpartyname' ||
    key === 'partyname' ||
    key === 'buyers2name' ||
    key === 'buyersname2' ||
    key === 'buyername2' ||
    identity.includes('billtopartyname') ||
    identity.includes('billpartyname') ||
    identity.includes('buyers2name') ||
    identity.includes('buyersname2') ||
    identity.includes('buyername2');
};

const isBillToPartyAddressIdField = (field) => {
  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  const key = normalizeFieldText(String(field?.key || '').replace(/^U_/i, ''));

  return label === 'billtopartyaddressid' ||
    label === 'billtoaddressid' ||
    label === 'partyaddressid' ||
    label === 'buyersaddressid' ||
    label === 'buyeraddressid' ||
    key === 'billtopartyaddressid' ||
    key === 'billtoaddressid' ||
    key === 'partyaddressid' ||
    key === 'buyersaddressid' ||
    key === 'buyeraddressid' ||
    identity.includes('billtopartyaddressid') ||
    identity.includes('billtoaddressid') ||
    identity.includes('partyaddressid') ||
    identity.includes('buyersaddressid') ||
    identity.includes('buyeraddressid');
};

const isBillToPartyAddressField = (field) => {
  if (isBillToPartyAddressIdField(field)) return false;
  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  const key = normalizeFieldText(String(field?.key || '').replace(/^U_/i, ''));

  return label === 'billtopartyaddress' ||
    label === 'billtoaddressbillto' ||
    label === 'billpartyaddress' ||
    label === 'partyaddress' ||
    label === 'buyersaddress2' ||
    label === 'buyeraddress2' ||
    key === 'billtopartyaddress' ||
    key === 'billtoaddressbillto' ||
    key === 'billpartyaddress' ||
    key === 'partyaddress' ||
    key === 'buyersaddress' ||
    key === 'buyeraddress' ||
    identity.includes('billtopartyaddress') ||
    identity.includes('billtoaddressbillto') ||
    identity.includes('billpartyaddress') ||
    identity.includes('buyersaddress') ||
    identity.includes('buyeraddress');
};

const isSellerAddressField = (field) =>
  String(field?.key || '') === SELLER_ADDRESS_KEY ||
  normalizeFieldText(field?.label) === 'selleraddress';

const isSellerAddressIdField = (field) =>
  String(field?.key || '') === SELLER_ADDRESS_ID_KEY ||
  normalizeFieldText(field?.label) === 'selleraddressidshipfrom' ||
  normalizeFieldText(field?.label) === 'selleraddressid';

const isSellerContactPersonField = (field) => {
  const normalizedKey = normalizeFieldText(String(field?.key || '').replace(/^U_/, ''));
  const normalizedLabel = normalizeFieldText(field?.label);

  return normalizedLabel === 'sellercontactperson' ||
    normalizedLabel === 'sellerperson' ||
    normalizedKey === 'sellercontactperson' ||
    normalizedKey === 'sellerperson';
};

const isToVendorContactIdField = (field) => {
  if (isSellerContactPersonField(field)) return false;

  const identity = getFieldIdentity(field);
  const label = normalizeFieldText(field?.label);
  const key = normalizeFieldText(String(field?.key || '').replace(/^U_/i, ''));

  return label === 'contactid' ||
    label === 'contactpersonid' ||
    label === 'bpcontactid' ||
    label === 'buyercontactid' ||
    label === 'tocontactid' ||
    label === 'tovendorcontactid' ||
    label === 'vendorcontactid' ||
    label === 'cntctname' ||
    key === 'contactid' ||
    key === 'contactpersonid' ||
    key === 'bpcontactid' ||
    key === 'buyercontactid' ||
    key === 'tocontactid' ||
    key === 'tovendorcontactid' ||
    key === 'vendorcontactid' ||
    key === 'cntctid' ||
    key === 'cntctname' ||
    identity.includes('tocontactid') ||
    identity.includes('tovendorcontactid') ||
    identity.includes('vendorcontactid');
};

const sortHeaderUdfFields = (fields = []) => {
  const sellerAddressIndex = fields.findIndex(isSellerAddressField);
  const sellerContactIndex = fields.findIndex(isSellerContactPersonField);

  if (sellerAddressIndex < 0 || sellerContactIndex < 0 || sellerContactIndex === sellerAddressIndex + 1) {
    return fields;
  }

  const nextFields = [...fields];
  const [sellerContactField] = nextFields.splice(sellerContactIndex, 1);
  const nextSellerAddressIndex = nextFields.findIndex(isSellerAddressField);

  nextFields.splice(nextSellerAddressIndex + 1, 0, sellerContactField);
  return nextFields;
};

const getAddressId = (address) =>
  address?.AddressName || address?.Address || address?.AddressID || address?.AddressId || '';

const isShipToAddress = (address) => {
  const type = String(address?.AddressType || address?.AddrType || address?.AdresType || '').toUpperCase();
  return type.includes('SHIP') || type === 'S';
};

const isBillToAddress = (address) => {
  const type = String(address?.AddressType || address?.AddrType || address?.AdresType || '').toUpperCase();
  return type.includes('BILL') || type === 'B';
};

const hasAddressType = (address) =>
  String(address?.AddressType || address?.AddrType || address?.AdresType || '').trim() !== '';

const filterBillToAddresses = (addresses = []) => {
  const usableAddresses = (Array.isArray(addresses) ? addresses : [])
    .filter((address) => getAddressId(address));
  const billToAddresses = usableAddresses.filter(isBillToAddress);

  if (billToAddresses.length) return billToAddresses;
  return usableAddresses.some(hasAddressType) ? [] : usableAddresses;
};

const selectSellerAddress = (addresses = [], seller = {}) => {
  const usableAddresses = (Array.isArray(addresses) ? addresses : [])
    .filter((address) => getAddressId(address));

  if (!usableAddresses.length) return null;

  const defaultShipTo = String(seller.ShipToDefault || seller.ShipToDef || seller.ShipTo || '').trim();
  if (defaultShipTo) {
    const match = usableAddresses.find((address) => String(getAddressId(address)).trim() === defaultShipTo);
    if (match) return match;
  }

  return usableAddresses.find(isShipToAddress)
    || usableAddresses.find(isBillToAddress)
    || usableAddresses[0];
};

const selectBillToPartyAddress = (addresses = [], party = {}) => {
  const usableAddresses = filterBillToAddresses(addresses);

  if (!usableAddresses.length) return null;

  const defaultBillTo = String(
    party.BilltoDefault ||
    party.BillToDef ||
    party.BillToDefault ||
    party.PayToDefault ||
    party.PayToDef ||
    party.PayTo ||
    ''
  ).trim();
  if (defaultBillTo) {
    const match = usableAddresses.find((address) => String(getAddressId(address)).trim() === defaultBillTo);
    if (match) return match;
  }

  return usableAddresses.find(isBillToAddress)
    || usableAddresses[0];
};

const formatSellerAddress = (address) => {
  if (!address) return '';

  return [
    [address.Street, address.StreetNo],
    [address.Block, address.Building, address.BuildingFloorRoom, address.Address2, address.AddressName2, address.Address3, address.AddressName3],
    [address.City, address.County, address.State, address.ZipCode],
    [address.Country],
  ]
    .map((parts) => parts.filter((part) => String(part || '').trim()).join(', '))
    .filter(Boolean)
    .join('\n');
};

const formatAddressRowText = (address) =>
  formatSellerAddress(address).replace(/\s*\n\s*/g, ' ').trim();

const getAddressTypeText = (address) => {
  const rawType = String(address?.AddressType || address?.AddrType || address?.AdresType || '').trim().toUpperCase();
  if (rawType.includes('BILL') || rawType === 'B' || rawType === 'BO_BILLTO') return 'Bill To';
  if (rawType.includes('SHIP') || rawType === 'S' || rawType === 'BO_SHIPTO') return 'Ship To';
  return '';
};

const getAddressLineKey = (address, fallbackIndex = 0) =>
  String(address?.LineNum ?? address?.RowNum ?? address?.AddressID ?? address?.AddressId ?? fallbackIndex);

const getAddressOptionKey = (address, fallbackIndex = 0) => [
  getAddressId(address),
  getAddressTypeText(address),
  getAddressLineKey(address, fallbackIndex),
  formatAddressRowText(address),
].map((part) => String(part || '').trim().toLowerCase()).join('::');

const getAddressDedupeKey = (address) => [
  getAddressId(address),
  getAddressTypeText(address),
  formatAddressRowText(address),
].map((part) => String(part || '').trim().toLowerCase()).join('::');

const dedupeAddresses = (addresses = []) => {
  const seen = new Set();

  return (Array.isArray(addresses) ? addresses : []).filter((address) => {
    if (!getAddressId(address)) return false;

    const key = getAddressDedupeKey(address);
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
};

const getAddressListSignature = (addresses = []) =>
  (Array.isArray(addresses) ? addresses : [])
    .map((address, index) => getAddressOptionKey(address, index))
    .join('|');

const areAddressListsEqual = (left = [], right = []) =>
  getAddressListSignature(left) === getAddressListSignature(right);

const getContactName = (contact) =>
  String(
    contact?.Name ||
    contact?.ContactPerson ||
    [contact?.FirstName, contact?.MiddleName, contact?.LastName].filter(Boolean).join(' ') ||
    ''
  ).trim();

const isActiveContact = (contact) => {
  const active = String(contact?.Active || contact?.active || '').trim().toUpperCase();
  return !active || active === 'Y' || active === 'YES' || active === 'TYES' || active === '1';
};

const selectSellerContactPerson = (seller = {}) => {
  const directContact = String(
    seller.ContactPerson ||
    seller.ContactPersonName ||
    seller.DefaultContactPerson ||
    ''
  ).trim();

  if (directContact) return directContact;

  const contacts = Array.isArray(seller.ContactEmployees) ? seller.ContactEmployees : [];
  const activeContact = contacts.find((contact) => getContactName(contact) && isActiveContact(contact));
  return getContactName(activeContact || contacts.find(getContactName));
};

const getContactCode = (contact) =>
  String(
    contact?.CntctCode ??
    contact?.InternalCode ??
    contact?.ContactCode ??
    contact?.ContactID ??
    contact?.ContactId ??
    contact?.ContactPersonCode ??
    contact?.Code ??
    contact?.id ??
    ''
  ).trim();

const getContactDisplayValue = (contact) =>
  getContactName(contact) || getContactCode(contact);

const selectBusinessPartnerContactId = (bp = {}) => {
  const contacts = [
    ...(Array.isArray(bp?.contacts) ? bp.contacts : []),
    ...(Array.isArray(bp?.ContactEmployees) ? bp.ContactEmployees : []),
  ];
  const directContactCode = String(
    bp.ContactPersonCode ??
    bp.ContactPersonID ??
    bp.DefaultContactPersonCode ??
    bp.CntctCode ??
    ''
  ).trim();

  if (directContactCode) {
    const matchingContact = contacts.find((contact) => getContactCode(contact) === directContactCode);
    return getContactDisplayValue(matchingContact) || directContactCode;
  }

  const directContactName = String(
    bp.ContactPerson ||
    bp.ContactPersonName ||
    bp.DefaultContactPerson ||
    ''
  ).trim();

  if (directContactName) {
    const normalizedDirectName = normalizeFieldText(directContactName);
    const matchingContact = contacts.find((contact) =>
      normalizeFieldText(getContactName(contact)) === normalizedDirectName ||
      String(getContactCode(contact)) === directContactName
    );
    const matchingContactValue = getContactDisplayValue(matchingContact);
    if (matchingContactValue) return matchingContactValue;
    return directContactName;
  }

  const activeContact = contacts.find((contact) => getContactDisplayValue(contact) && isActiveContact(contact));
  const fallbackContact = activeContact || contacts.find((contact) => getContactDisplayValue(contact));
  return getContactDisplayValue(fallbackContact) || '';
};

function renderField(field = {}, value, disabled, onChange, onLookup) {
  const fieldType = field?.type || 'text';

  if (fieldType === 'checkbox') {
    const checked = ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase());
    return (
      <input
        type="checkbox"
        className="form-check-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked ? 'Y' : 'N')}
      />
    );
  }

  if (fieldType === 'select') {
    return (
      <div className={`po-udf-select-control${disabled ? ' is-disabled' : ''}`}>
        <select
          className="form-control form-control-sm po-udf-select-control__select"
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value=""></option>
          {(field.options || []).map((option) => {
            const normalizedOption = typeof option === 'object'
              ? option
              : { value: option, label: option };
            if (String(normalizedOption.value ?? '') === '') return null;

            return (
              <option key={normalizedOption.value} value={normalizedOption.value}>
                {normalizedOption.label}
              </option>
            );
          })}
        </select>
      </div>
    );
  }

  if (fieldType === 'textarea') {
    return (
      <textarea
        rows={3}
        className="form-control form-control-sm"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const input = (
    <SapInput
      type={fieldType === 'date' ? 'date' : fieldType === 'number' ? 'number' : 'text'}
      className="form-control form-control-sm"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  if (typeof onLookup === 'function') {
    return (
      <div className="po-udf-lookup-control">
        <div className="po-udf-lookup-control__field">
          {input}
        </div>
        <button
          type="button"
          className="btn btn-sm po-udf-lookup-control__button"
          onClick={onLookup}
          disabled={disabled}
          title="List of Business Partners"
          aria-label="List of Business Partners"
        >
          ...
        </button>
      </div>
    );
  }

  return (
    input
  );
}

function renderLookupControl(control, onLookup, disabled, title = 'Lookup') {
  return (
    <div className="po-udf-lookup-control">
      <div className="po-udf-lookup-control__field">
        {control}
      </div>
      <button
        type="button"
        className="btn btn-sm po-udf-lookup-control__button"
        onClick={onLookup}
        disabled={disabled}
        title={title}
        aria-label={title}
      >
        ...
      </button>
    </div>
  );
}

function renderLookupInputControl(value, onChange, onLookup, disabled, title = 'Lookup', showLookup = true) {
  const input = (
    <input
      type="text"
      className="form-control form-control-sm"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  return showLookup ? renderLookupControl(input, onLookup, disabled, title) : input;
}

const PREDEFINED_TEXT_COLUMNS = [
  { key: 'code', label: 'Text Code', width: 150 },
  { key: 'text', label: 'Text', primary: true },
];

function SellerAddressModal({
  isOpen,
  onClose,
  addresses = [],
  onSelect,
  loading = false,
  error = '',
  title = 'Seller Address in Sales Order',
  emptyMessage = 'No seller addresses found',
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAddresses = useMemo(() => {
    const usableAddresses = dedupeAddresses(addresses);
    if (!searchTerm.trim()) return usableAddresses;

    return usableAddresses.filter((address) =>
      matchesSapSearchText(getAddressId(address), searchTerm) ||
      matchesSapSearchText(formatAddressRowText(address), searchTerm)
    );
  }, [addresses, searchTerm]);

  const chooseAddress = (address) => {
    if (!address) return;
    onSelect(address);
    onClose();
  };

  return (
    <SapLookupModal
      open={isOpen}
      title={title}
      columns={[
        { key: 'rowNumber', label: '#', width: 44, searchable: false, render: (_address, index) => index + 1 },
        { key: 'addressId', label: 'Address ID', width: 150, render: getAddressId },
        { key: 'address', label: 'Address', render: formatAddressRowText },
      ]}
      rows={filteredAddresses}
      loading={loading}
      initialQuery={searchTerm}
      searchPlaceholder="Search addresses"
      emptyMessage={error || emptyMessage}
      onQueryChange={setSearchTerm}
      onClose={onClose}
      onSelect={chooseAddress}
      getRowKey={(address, index) => `${getAddressId(address)}-${index}`}
      width="min(760px, calc(100% - 40px))"
    />
  );
}

function HeaderUdfSidebar({
  isOpen,
  fields,
  formSettings,
  values,
  onFieldChange,
  onClose,
  disabled = false,
  orientation = 'vertical',
  className = '',
  style,
  billToPartyAddressOptions = [],
  billToPartyName = '',
  loadBillToPartyDetails,
  loadToVendorDetails,
  onLoadLookupOptions,
}) {
  const [sellerLookupOpen, setSellerLookupOpen] = useState(false);
  const [sellerAddressLookupOpen, setSellerAddressLookupOpen] = useState(false);
  const [sellerAddresses, setSellerAddresses] = useState([]);
  const [sellerAddressLoading, setSellerAddressLoading] = useState(false);
  const [sellerAddressError, setSellerAddressError] = useState('');
  const [toVendorLookupOpen, setToVendorLookupOpen] = useState(false);
  const [toVendorAddressLookupOpen, setToVendorAddressLookupOpen] = useState(false);
  const [toVendorAddresses, setToVendorAddresses] = useState([]);
  const [toVendorAddressLoading, setToVendorAddressLoading] = useState(false);
  const [toVendorAddressError, setToVendorAddressError] = useState('');
  const lastLoadedToVendorCodeRef = useRef('');
  const [billToPartyLookupOpen, setBillToPartyLookupOpen] = useState(false);
  const [billToPartyAddresses, setBillToPartyAddresses] = useState([]);
  const [billToPartyAddressLookupOpen, setBillToPartyAddressLookupOpen] = useState(false);
  const [billToPartyAddressLoading, setBillToPartyAddressLoading] = useState(false);
  const [billToPartyAddressError, setBillToPartyAddressError] = useState('');
  const lastLoadedBillToPartyCodeRef = useRef('');
  const [termsLookupOpen, setTermsLookupOpen] = useState(false);
  const [termsLookupFieldKey, setTermsLookupFieldKey] = useState('');
  const [termsLookupOptions, setTermsLookupOptions] = useState([]);
  const [termsLookupLoading, setTermsLookupLoading] = useState(false);
  const [termsLookupError, setTermsLookupError] = useState('');
  const [dynamicLookup, setDynamicLookup] = useState({
    open: false,
    field: null,
    options: [],
    loading: false,
    error: '',
  });
  const valuesRef = useRef(values || {});
  const onFieldChangeRef = useRef(onFieldChange);
  const loadBillToPartyDetailsRef = useRef(loadBillToPartyDetails);
  const loadToVendorDetailsRef = useRef(loadToVendorDetails);
  const billToPartyAddressOptionsSignature = getAddressListSignature(billToPartyAddressOptions);
  const externalBillToPartyAddresses = useMemo(
    () => filterBillToAddresses(dedupeAddresses(billToPartyAddressOptions)),
    [billToPartyAddressOptionsSignature],
  );

  useEffect(() => {
    valuesRef.current = values || {};
  }, [values]);

  useEffect(() => {
    onFieldChangeRef.current = onFieldChange;
  }, [onFieldChange]);

  useEffect(() => {
    loadBillToPartyDetailsRef.current = loadBillToPartyDetails;
  }, [loadBillToPartyDetails]);

  useEffect(() => {
    loadToVendorDetailsRef.current = loadToVendorDetails;
  }, [loadToVendorDetails]);

  const changeField = useCallback((key, nextValue) => {
    if (!key || typeof onFieldChangeRef.current !== 'function') return;

    const currentValue = valuesRef.current?.[key];
    if (String(currentValue ?? '') === String(nextValue ?? '')) {
      return;
    }

    onFieldChangeRef.current(key, nextValue);
  }, []);

  const setToVendorAddressList = useCallback((addresses = []) => {
    const nextAddresses = filterBillToAddresses(dedupeAddresses(addresses));
    setToVendorAddresses((current) =>
      areAddressListsEqual(current, nextAddresses) ? current : nextAddresses
    );
  }, []);

  const setBillToPartyAddressList = useCallback((addresses = []) => {
    const nextAddresses = filterBillToAddresses(dedupeAddresses(addresses));
    setBillToPartyAddresses((current) =>
      areAddressListsEqual(current, nextAddresses) ? current : nextAddresses
    );
  }, []);

  const safeFields = Array.isArray(fields) ? fields.filter((field) => field && field.key) : [];
  const containerClass = orientation === 'horizontal'
    ? 'po-udf-sidebar-horizontal'
    : 'col-xl-3 col-lg-4';

  const rootClassName = [
    containerClass,
    orientation === 'horizontal' ? '' : 'sap-header-udf-panel',
    className,
  ].filter(Boolean).join(' ');
  const isVerticalSidebar = orientation !== 'horizontal';
  const sidebarFrameStyle = isVerticalSidebar
    ? {
        alignSelf: 'stretch',
        display: 'flex',
        height: 'auto',
        minHeight: 0,
        maxHeight: 'none',
        overflow: 'hidden',
        width: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        ...(style || {}),
      }
    : (style || {});
  const sidebarCardStyle = isVerticalSidebar
    ? {
        position: 'static',
        top: 'auto',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        maxHeight: '100%',
        overflow: 'hidden',
      }
    : {};
  const sidebarBodyStyle = isVerticalSidebar
    ? {
        flex: '1 1 auto',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
      }
    : undefined;
  const showClose = typeof onClose === 'function';
  const orderedFields = sortHeaderUdfFields(safeFields);
  const sellerContactPersonField = orderedFields.find(isSellerContactPersonField);
  const toVendorCodeField = orderedFields.find(isToVendorCodeField);
  const toVendorNameField = orderedFields.find(isToVendorNameField);
  const toVendorAddressIdField = orderedFields.find(isToVendorAddressIdField);
  const toVendorAddressField = orderedFields.find(isToVendorAddressField);
  const toVendorContactIdField = orderedFields.find(isToVendorContactIdField);
  const toVendorCode = String(toVendorCodeField?.key ? values?.[toVendorCodeField.key] : '').trim();
  const toVendorNameValue = String(toVendorNameField?.key ? values?.[toVendorNameField.key] : '').trim();
  const toVendorAddressIdValue = String(toVendorAddressIdField?.key ? values?.[toVendorAddressIdField.key] : '').trim();
  const toVendorAddressTextValue = String(toVendorAddressField?.key ? values?.[toVendorAddressField.key] : '').trim();
  const sellerCodeValue = String(values?.[SELLER_CODE_KEY] || '').trim();
  const sellerAddressIdValue = String(values?.[SELLER_ADDRESS_ID_KEY] || '').trim();
  const sellerAddressTextValue = String(values?.[SELLER_ADDRESS_KEY] || '').trim();
  const billToPartyCodeField = orderedFields.find(isBillToPartyCodeField);
  const billToPartyCode = String(billToPartyCodeField?.key ? values?.[billToPartyCodeField.key] : '').trim();
  const billToPartyNameField = orderedFields.find(isBillToPartyNameField);
  const billToPartyAddressIdField = orderedFields.find(isBillToPartyAddressIdField);
  const billToPartyAddressField = orderedFields.find(isBillToPartyAddressField);
  const billToPartyNameValue = String(billToPartyNameField?.key ? values?.[billToPartyNameField.key] : '').trim();
  const billToPartyAddressIdValue = String(billToPartyAddressIdField?.key ? values?.[billToPartyAddressIdField.key] : '').trim();

  const loadToVendorByCode = useCallback(async (cardCode) => {
    const normalizedCode = String(cardCode || '').trim();
    if (!normalizedCode) return { vendor: null, addresses: [] };

    let vendor = null;
    let addresses = [];
    let contacts = [];

    if (typeof loadToVendorDetailsRef.current === 'function') {
      const details = await loadToVendorDetailsRef.current(normalizedCode);
      vendor = details?.businessPartner || details?.vendor || details?.bp || null;
      contacts = [
        ...(Array.isArray(details?.contacts) ? details.contacts : []),
        ...(Array.isArray(details?.ContactEmployees) ? details.ContactEmployees : []),
      ];
      addresses = [
        ...(Array.isArray(details?.addresses) ? details.addresses : []),
        ...(Array.isArray(details?.BPAddresses) ? details.BPAddresses : []),
        ...(Array.isArray(details?.bill_to_addresses) ? details.bill_to_addresses : []),
        ...(Array.isArray(details?.pay_to_addresses) ? details.pay_to_addresses : []),
      ];
    }

    if (!addresses.length || !vendor?.CardName) {
      try {
        const bp = await getBP(normalizedCode);
        vendor = vendor || bp;
        addresses = addresses.length ? addresses : (Array.isArray(bp?.BPAddresses) ? bp.BPAddresses : []);
        contacts = contacts.length ? contacts : (Array.isArray(bp?.ContactEmployees) ? bp.ContactEmployees : []);
      } catch (error) {
        if (!addresses.length && !contacts.length && !vendor) throw error;
      }
    }

    const usableAddresses = filterBillToAddresses(dedupeAddresses(addresses));
    const contactEmployees = contacts.length
      ? contacts
      : (Array.isArray(vendor?.ContactEmployees) ? vendor.ContactEmployees : []);

    if (contactEmployees.length) {
      vendor = { ...(vendor || {}), ContactEmployees: contactEmployees, contacts: contactEmployees };
    }

    return { vendor, addresses: usableAddresses };
  }, []);

  useEffect(() => {
    if (!isOpen || !sellerCodeValue || !sellerAddressIdValue || sellerAddressTextValue) {
      return undefined;
    }

    let cancelled = false;
    const loadSavedSellerAddress = async () => {
      try {
        const seller = await getBP(sellerCodeValue);
        if (cancelled) return;

        const address = (seller?.BPAddresses || []).find(
          (entry) => String(getAddressId(entry)).trim() === sellerAddressIdValue
        );
        const currentValues = valuesRef.current || {};
        if (
          address &&
          String(currentValues[SELLER_CODE_KEY] || '').trim() === sellerCodeValue &&
          String(currentValues[SELLER_ADDRESS_ID_KEY] || '').trim() === sellerAddressIdValue &&
          !String(currentValues[SELLER_ADDRESS_KEY] || '').trim()
        ) {
          changeField(SELLER_ADDRESS_KEY, formatSellerAddress(address));
        }
      } catch (error) {
        if (!cancelled) console.error('Failed to load saved seller address:', error);
      }
    };

    loadSavedSellerAddress();
    return () => { cancelled = true; };
  }, [isOpen, sellerCodeValue, sellerAddressIdValue, sellerAddressTextValue, changeField]);

  useEffect(() => {
    if (!isOpen || !toVendorCodeField?.key || !toVendorCode) {
      if (isOpen && toVendorCodeField?.key && !toVendorCode && toVendorContactIdField?.key) {
        changeField(toVendorContactIdField.key, '');
      }
      setToVendorAddressList([]);
      lastLoadedToVendorCodeRef.current = '';
      return undefined;
    }

    if (lastLoadedToVendorCodeRef.current === toVendorCode) {
      return undefined;
    }

    let cancelled = false;

    const hydrateToVendor = async () => {
      try {
        const { vendor, addresses } = await loadToVendorByCode(toVendorCode);
        if (cancelled) return;

        const selectedAddress = addresses.find(
          (address) => String(getAddressId(address)) === toVendorAddressIdValue
        ) || selectBillToPartyAddress(addresses, vendor || {});

        setToVendorAddressList(addresses);
        lastLoadedToVendorCodeRef.current = toVendorCode;

        if (toVendorNameField?.key && vendor?.CardName && !toVendorNameValue) {
          changeField(toVendorNameField.key, vendor.CardName);
        }

        if (toVendorContactIdField?.key) {
          changeField(toVendorContactIdField.key, selectBusinessPartnerContactId(vendor || {}));
        }

        if (selectedAddress && toVendorAddressIdField?.key && !toVendorAddressIdValue) {
          changeField(toVendorAddressIdField.key, getAddressId(selectedAddress));
        }

        if (selectedAddress && toVendorAddressField?.key && !toVendorAddressTextValue) {
          changeField(toVendorAddressField.key, formatSellerAddress(selectedAddress));
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load To Vendor addresses:', error);
          setToVendorAddressList([]);
          lastLoadedToVendorCodeRef.current = '';
        }
      }
    };

    hydrateToVendor();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    toVendorCode,
    toVendorCodeField?.key,
    toVendorNameField?.key,
    toVendorAddressIdField?.key,
    toVendorAddressField?.key,
    toVendorContactIdField?.key,
    toVendorNameValue,
    toVendorAddressIdValue,
    toVendorAddressTextValue,
    setToVendorAddressList,
    loadToVendorByCode,
    changeField,
  ]);

  useEffect(() => {
    if (!isOpen || !billToPartyCodeField?.key || !billToPartyCode) {
      setBillToPartyAddressList([]);
      lastLoadedBillToPartyCodeRef.current = '';
      return undefined;
    }

    const canUseExternalAddresses = externalBillToPartyAddresses.length &&
      (!billToPartyCode || !billToPartyName || billToPartyNameValue === billToPartyName);

    if (canUseExternalAddresses) {
      const selectedAddress = selectBillToPartyAddress(externalBillToPartyAddresses, {
        BillToDef: billToPartyAddressIdValue,
      });
      setBillToPartyAddressList(externalBillToPartyAddresses);
      lastLoadedBillToPartyCodeRef.current = billToPartyCode;

      if (billToPartyNameField?.key && billToPartyName && !billToPartyNameValue) {
        changeField(billToPartyNameField.key, billToPartyName);
      }

      if (
        selectedAddress &&
        billToPartyAddressIdField?.key &&
        !externalBillToPartyAddresses.some((address) => String(getAddressId(address)) === billToPartyAddressIdValue)
      ) {
        changeField(billToPartyAddressIdField.key, getAddressId(selectedAddress));
        if (billToPartyAddressField?.key) {
          changeField(billToPartyAddressField.key, formatSellerAddress(selectedAddress));
        }
      }

      return undefined;
    }

    if (lastLoadedBillToPartyCodeRef.current === billToPartyCode) {
      return undefined;
    }

    let cancelled = false;
    lastLoadedBillToPartyCodeRef.current = billToPartyCode;

    const loadBillToPartyAddresses = async () => {
      try {
        let party = null;
        let addresses = [];

        if (typeof loadBillToPartyDetailsRef.current === 'function') {
          const details = await loadBillToPartyDetailsRef.current(billToPartyCode);
          addresses = [
            ...(Array.isArray(details?.addresses) ? details.addresses : []),
            ...(Array.isArray(details?.BPAddresses) ? details.BPAddresses : []),
            ...(Array.isArray(details?.bill_to_addresses) ? details.bill_to_addresses : []),
          ];
          party = details?.businessPartner || details?.customer || null;
        }

        if (!addresses.length) {
          party = await getBP(billToPartyCode);
          addresses = Array.isArray(party?.BPAddresses) ? party.BPAddresses : [];
        }

        if (cancelled) return;

        const usableAddresses = filterBillToAddresses(dedupeAddresses(addresses));
        const selectedAddress = selectBillToPartyAddress(usableAddresses, party || {});
        setBillToPartyAddressList(usableAddresses);

        if (billToPartyNameField?.key && party?.CardName && !billToPartyNameValue) {
          changeField(billToPartyNameField.key, party.CardName);
        }

        if (
          selectedAddress &&
          billToPartyAddressIdField?.key &&
          !usableAddresses.some((address) => String(getAddressId(address)) === billToPartyAddressIdValue)
        ) {
          changeField(billToPartyAddressIdField.key, getAddressId(selectedAddress));
          if (billToPartyAddressField?.key) {
            changeField(billToPartyAddressField.key, formatSellerAddress(selectedAddress));
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load Bill To Party addresses:', error);
          setBillToPartyAddressList([]);
          lastLoadedBillToPartyCodeRef.current = '';
        }
      }
    };

    loadBillToPartyAddresses();

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    billToPartyCode,
    billToPartyCodeField?.key,
    billToPartyNameField?.key,
    billToPartyAddressIdField?.key,
    billToPartyAddressField?.key,
    externalBillToPartyAddresses,
    billToPartyName,
    billToPartyNameValue,
    billToPartyAddressIdValue,
    setBillToPartyAddressList,
    changeField,
  ]);

  if (!isOpen) {
    return null;
  }

  const openSellerLookup = () => {
    setSellerLookupOpen(true);
  };

  const openToVendorLookup = () => {
    setToVendorLookupOpen(true);
  };

  const openBillToPartyLookup = () => {
    setBillToPartyLookupOpen(true);
  };

  const openTermsOfSupplyLookup = async (field) => {
    setTermsLookupFieldKey(field?.key || '');
    setTermsLookupOpen(true);
    setTermsLookupLoading(true);
    setTermsLookupError('');

    try {
      const rows = await fetchPredefinedTexts();
      setTermsLookupOptions(rows);
    } catch (error) {
      console.error('Failed to load predefined texts:', error);
      setTermsLookupOptions([]);
      setTermsLookupError(error?.response?.data?.detail || error?.message || 'Failed to load predefined texts.');
    } finally {
      setTermsLookupLoading(false);
    }
  };

  const handleTermsLookupSelect = (option) => {
    const selectedText = String(option?.text || option?.value || '').trim();
    if (termsLookupFieldKey) {
      changeField(termsLookupFieldKey, selectedText);
    }
  };

  const handleTermsLookupCreate = async ({ value, description }) => {
    const result = await createPredefinedText({
      textCode: value,
      text: description,
    });
    const createdOption = result?.option || {
      code: value,
      text: description,
      value: description,
      description: value,
      label: value ? `${value} - ${description}` : description,
    };
    const nextOptions = result?.texts || await fetchPredefinedTexts();
    setTermsLookupOptions(nextOptions);
    return createdOption;
  };

  const openDynamicUdfLookup = async (field) => {
    if (!field?.lookupSource || typeof onLoadLookupOptions !== 'function') return;

    setDynamicLookup({
      open: true,
      field,
      options: [],
      loading: true,
      error: '',
    });

    try {
      const options = await onLoadLookupOptions(field.lookupSource, field);
      setDynamicLookup({
        open: true,
        field,
        options: Array.isArray(options) ? options : [],
        loading: false,
        error: '',
      });
    } catch (error) {
      setDynamicLookup({
        open: true,
        field,
        options: [],
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Failed to load lookup values.',
      });
    }
  };

  const handleDynamicLookupSelect = (option) => {
    if (!dynamicLookup.field?.key) return;
    changeField(dynamicLookup.field.key, option?.value || '');
  };

  const applySellerAddress = (seller) => {
    const selectedAddress = selectSellerAddress(seller?.BPAddresses, seller);
    changeField(SELLER_ADDRESS_ID_KEY, getAddressId(selectedAddress));
    changeField(SELLER_ADDRESS_KEY, formatSellerAddress(selectedAddress));
  };

  const applyToVendorAddress = (address) => {
    if (toVendorAddressIdField?.key) {
      changeField(toVendorAddressIdField.key, getAddressId(address));
    }
    if (toVendorAddressField?.key) {
      changeField(toVendorAddressField.key, formatSellerAddress(address));
    }
  };

  const applyBillToPartyAddress = (address) => {
    if (billToPartyAddressIdField?.key) {
      changeField(billToPartyAddressIdField.key, getAddressId(address));
    }
    if (billToPartyAddressField?.key) {
      changeField(billToPartyAddressField.key, formatSellerAddress(address));
    }
  };

  const handleBillToPartyAddressIdChange = (addressOptionKey) => {
    const selectedAddress = billToPartyAddresses.find(
      (address, index) => getAddressOptionKey(address, index) === addressOptionKey
    ) || billToPartyAddresses.find(
      (address) => String(getAddressId(address)) === String(addressOptionKey)
    ) || null;
    applyBillToPartyAddress(selectedAddress || { Address: addressOptionKey });
  };

  const openBillToPartyAddressLookup = async () => {
    setBillToPartyAddressLookupOpen(true);
    setBillToPartyAddressLoading(true);
    setBillToPartyAddressError('');

    if (!billToPartyCode) {
      setBillToPartyAddressList([]);
      setBillToPartyAddressLoading(false);
      setBillToPartyAddressError('Select Bill to Party Code first.');
      return;
    }

    try {
      let party = null;
      let addresses = [];

      if (typeof loadBillToPartyDetailsRef.current === 'function') {
        const details = await loadBillToPartyDetailsRef.current(billToPartyCode);
        party = details?.businessPartner || details?.customer || details?.bp || null;
        addresses = [
          ...(Array.isArray(details?.addresses) ? details.addresses : []),
          ...(Array.isArray(details?.BPAddresses) ? details.BPAddresses : []),
          ...(Array.isArray(details?.bill_to_addresses) ? details.bill_to_addresses : []),
        ];
      }

      if (!addresses.length) {
        party = party || await getBP(billToPartyCode);
        addresses = Array.isArray(party?.BPAddresses) ? party.BPAddresses : [];
      }

      const usableAddresses = filterBillToAddresses(dedupeAddresses(addresses));
      setBillToPartyAddressList(usableAddresses);
      lastLoadedBillToPartyCodeRef.current = billToPartyCode;

      if (!usableAddresses.length) {
        setBillToPartyAddressError('No bill-to address is available for this party.');
      }
    } catch (error) {
      console.error('Failed to load Bill To Party addresses:', error);
      setBillToPartyAddressList([]);
      setBillToPartyAddressError('Failed to load bill-to addresses.');
    } finally {
      setBillToPartyAddressLoading(false);
    }
  };

  const openSellerAddressLookup = async () => {
    const sellerCode = String(values?.[SELLER_CODE_KEY] || '').trim();
    setSellerAddressLookupOpen(true);
    setSellerAddressLoading(true);
    setSellerAddressError('');
    setSellerAddresses([]);

    if (!sellerCode) {
      setSellerAddressLoading(false);
      setSellerAddressError('Select Seller Code first.');
      return;
    }

    try {
      const seller = await getBP(sellerCode);
      const addresses = Array.isArray(seller?.BPAddresses) ? seller.BPAddresses : [];
      const usableAddresses = addresses.filter((address) => getAddressId(address));
      setSellerAddresses(usableAddresses);
      if (!usableAddresses.length) {
        setSellerAddressError('No address is available for this seller.');
      }
    } catch (error) {
      console.error('Failed to load seller addresses:', error);
      setSellerAddresses([]);
      setSellerAddressError('Failed to load seller addresses.');
    } finally {
      setSellerAddressLoading(false);
    }
  };

  const handleSellerAddressSelect = (address) => {
    changeField(SELLER_ADDRESS_ID_KEY, getAddressId(address));
    changeField(SELLER_ADDRESS_KEY, formatSellerAddress(address));
  };

  const handleToVendorAddressIdChange = (addressOptionKey) => {
    const addressOptions = dedupeAddresses(toVendorAddresses);
    const selectedAddress = addressOptions.find(
      (address, index) => getAddressOptionKey(address, index) === addressOptionKey
    ) || addressOptions.find(
      (address) => String(getAddressId(address)) === String(addressOptionKey)
    ) || null;
    applyToVendorAddress(selectedAddress || { Address: addressOptionKey });
  };

  const openToVendorAddressLookup = async () => {
    setToVendorAddressLookupOpen(true);
    setToVendorAddressLoading(true);
    setToVendorAddressError('');

    if (!toVendorCode) {
      setToVendorAddressList([]);
      setToVendorAddressLoading(false);
      setToVendorAddressError('Select To Code Vendor first.');
      return;
    }

    try {
      const { addresses } = await loadToVendorByCode(toVendorCode);
      setToVendorAddressList(addresses);
      lastLoadedToVendorCodeRef.current = toVendorCode;
      if (!addresses.length) {
        setToVendorAddressError('No address is available for this vendor.');
      }
    } catch (error) {
      console.error('Failed to load To Vendor addresses:', error);
      setToVendorAddressList([]);
      setToVendorAddressError('Failed to load vendor addresses.');
    } finally {
      setToVendorAddressLoading(false);
    }
  };

  const handleToVendorAddressSelect = (address) => {
    applyToVendorAddress(address);
  };

  const handleBillToPartyAddressSelect = (address) => {
    applyBillToPartyAddress(address);
  };

  const handleSellerSelect = async (bp) => {
    changeField(SELLER_CODE_KEY, bp.CardCode || '');
    changeField(SELLER_NAME_KEY, bp.CardName || '');
    changeField(SELLER_ADDRESS_ID_KEY, '');
    changeField(SELLER_ADDRESS_KEY, '');
    if (sellerContactPersonField?.key) {
      changeField(sellerContactPersonField.key, '');
    }

    const cardCode = String(bp.CardCode || '').trim();
    if (!cardCode) return;

    try {
      const seller = await getBP(cardCode);
      applySellerAddress(seller || bp);
      if (sellerContactPersonField?.key) {
        changeField(sellerContactPersonField.key, selectSellerContactPerson(seller || bp));
      }
    } catch (error) {
      console.error('Failed to load seller address details:', error);
      applySellerAddress(bp);
      if (sellerContactPersonField?.key) {
        changeField(sellerContactPersonField.key, selectSellerContactPerson(bp));
      }
    }
  };

  const handleToVendorSelect = async (bp) => {
    if (toVendorCodeField?.key) {
      changeField(toVendorCodeField.key, bp.CardCode || '');
    }
    if (toVendorNameField?.key) {
      changeField(toVendorNameField.key, bp.CardName || '');
    }
    if (toVendorAddressIdField?.key) {
      changeField(toVendorAddressIdField.key, '');
    }
    if (toVendorAddressField?.key) {
      changeField(toVendorAddressField.key, '');
    }
    if (toVendorContactIdField?.key) {
      changeField(toVendorContactIdField.key, '');
    }
    setToVendorAddressList([]);
    lastLoadedToVendorCodeRef.current = '';

    const cardCode = String(bp.CardCode || '').trim();
    if (!cardCode) return;

    try {
      const { vendor, addresses } = await loadToVendorByCode(cardCode);
      const selectedAddress = selectBillToPartyAddress(addresses, vendor || bp);
      setToVendorAddressList(addresses);
      lastLoadedToVendorCodeRef.current = cardCode;
      applyToVendorAddress(selectedAddress);
      if (toVendorNameField?.key && vendor?.CardName) {
        changeField(toVendorNameField.key, vendor.CardName);
      }
      if (toVendorContactIdField?.key) {
        changeField(toVendorContactIdField.key, selectBusinessPartnerContactId(vendor || bp));
      }
    } catch (error) {
      console.error('Failed to load To Vendor details:', error);
      const addresses = Array.isArray(bp?.BPAddresses) ? bp.BPAddresses : [];
      const usableAddresses = filterBillToAddresses(addresses);
      setToVendorAddressList(usableAddresses);
      lastLoadedToVendorCodeRef.current = cardCode;
      applyToVendorAddress(selectBillToPartyAddress(usableAddresses, bp));
      if (toVendorContactIdField?.key) {
        changeField(toVendorContactIdField.key, selectBusinessPartnerContactId(bp));
      }
    }
  };

  const handleBillToPartySelect = async (bp) => {
    if (billToPartyCodeField?.key) {
      changeField(billToPartyCodeField.key, bp.CardCode || '');
    }
    if (billToPartyNameField?.key) {
      changeField(billToPartyNameField.key, bp.CardName || '');
    }
    if (billToPartyAddressIdField?.key) {
      changeField(billToPartyAddressIdField.key, '');
    }
    if (billToPartyAddressField?.key) {
      changeField(billToPartyAddressField.key, '');
    }

    const cardCode = String(bp.CardCode || '').trim();
    if (!cardCode) {
      lastLoadedBillToPartyCodeRef.current = '';
      return;
    }

    try {
      const party = await getBP(cardCode);
      const addresses = Array.isArray(party?.BPAddresses) ? party.BPAddresses : [];
      const usableAddresses = filterBillToAddresses(dedupeAddresses(addresses));
      const selectedAddress = selectBillToPartyAddress(usableAddresses, party || bp);
      setBillToPartyAddressList(usableAddresses);
      lastLoadedBillToPartyCodeRef.current = cardCode;
      applyBillToPartyAddress(selectedAddress);
      if (billToPartyNameField?.key && party?.CardName) {
        changeField(billToPartyNameField.key, party.CardName);
      }
    } catch (error) {
      console.error('Failed to load Bill To Party details:', error);
      const addresses = Array.isArray(bp?.BPAddresses) ? bp.BPAddresses : [];
      const usableAddresses = filterBillToAddresses(dedupeAddresses(addresses));
      setBillToPartyAddressList(usableAddresses);
      lastLoadedBillToPartyCodeRef.current = cardCode;
      applyBillToPartyAddress(selectBillToPartyAddress(usableAddresses, bp));
    }
  };

  return (
    <>
      <div className={rootClassName} style={{ ...sidebarFrameStyle, ...style, width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        <div
          className={`card p-3 po-udf-sidebar-card ${orientation === 'horizontal' ? 'po-udf-sidebar-card-horizontal' : ''}`}
          style={sidebarCardStyle}
        >
          <div className="po-udf-sidebar-header">
            <div>
              <h6 className="mb-1">Header UDFs</h6>
              <small className="text-muted">
                Marketing document header user-defined fields
              </small>
            </div>
            {showClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close Header UDFs"
                title="Close"
                className="po-udf-sidebar-close"
              />
            ) : null}
          </div>

          <div className="po-udf-sidebar-body" style={sidebarBodyStyle}>
            {orderedFields.length === 0 ? (
              <div className="text-muted small">
                No header UDF fields are available for this document.
              </div>
            ) : null}
            {orderedFields.filter((field) => field && field.key).map((field) => {
              const termsOfSupplyField = isTermsOfSupplyField(field);
              const fieldValue = values[field.key];
              const fieldSetting = formSettings.headerUdfs?.[field.key] || {};
              const fieldActive = fieldSetting.active !== undefined
                ? fieldSetting.active !== false
                : field.active !== false;
              const fieldDisabled = disabled ||
                (!termsOfSupplyField && field.readOnly) ||
                !fieldActive;
              const currentToVendorAddressId = String(fieldValue || '');
              const currentBillToPartyAddressId = String(fieldValue || '');
              const fieldLookup = termsOfSupplyField
                ? () => openTermsOfSupplyLookup(field)
                : isSellerCodeField(field)
                ? openSellerLookup
                : isToVendorCodeField(field)
                  ? openToVendorLookup
                  : isBillToPartyCodeField(field)
                    ? openBillToPartyLookup
                    : isSellerAddressIdField(field)
                      ? openSellerAddressLookup
                      : isToVendorAddressIdField(field)
                        ? openToVendorAddressLookup
                        : isBillToPartyAddressIdField(field)
                          ? openBillToPartyAddressLookup
                          : field.lookupSource
                            ? () => openDynamicUdfLookup(field)
                            : undefined;
              const fieldControl = isToVendorAddressIdField(field)
                ? renderLookupInputControl(
                  currentToVendorAddressId,
                  handleToVendorAddressIdChange,
                  openToVendorAddressLookup,
                  fieldDisabled,
                  'List of To Vendor Addresses'
                )
                : isBillToPartyAddressIdField(field)
                  ? renderLookupInputControl(
                    currentBillToPartyAddressId,
                    handleBillToPartyAddressIdChange,
                    openBillToPartyAddressLookup,
                    fieldDisabled,
                    'List of Bill To Party Addresses'
                  )
                : termsOfSupplyField
                  ? renderLookupInputControl(
                    fieldValue || '',
                    (nextValue) => changeField(field.key, nextValue),
                    () => openTermsOfSupplyLookup(field),
                    fieldDisabled,
                    'List of Predefined Text'
                  )
                : renderField(
                  field,
                  fieldValue,
                  fieldDisabled,
                  (nextValue) => {
                    if (isToVendorAddressIdField(field)) {
                      handleToVendorAddressIdChange(nextValue);
                      return;
                    }
                    if (isBillToPartyAddressIdField(field)) {
                      handleBillToPartyAddressIdChange(nextValue);
                      return;
                    }
                    changeField(field.key, nextValue);
                  },
                  fieldLookup
                );

              return (
                <div
                  key={field.key}
                  className={`mb-3 po-udf-sidebar-field po-udf-sidebar-field--${field?.type || 'text'}`}
                >
                  <label className="form-label mb-1">
                    {field.label}{field.required ? ' *' : ''}
                  </label>
                  {fieldControl}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <BusinessPartnerModal
        isOpen={sellerLookupOpen}
        onClose={() => setSellerLookupOpen(false)}
        onSelect={handleSellerSelect}
        fetchPartners={fetchSupplierPartners}
        title="Ven(Code)FMS"
        variant="seller"
      />
      <BusinessPartnerModal
        isOpen={toVendorLookupOpen}
        onClose={() => setToVendorLookupOpen(false)}
        onSelect={handleToVendorSelect}
        fetchPartners={fetchSupplierPartners}
        title="Vendor Code"
        variant="seller"
      />
      <BusinessPartnerModal
        isOpen={billToPartyLookupOpen}
        onClose={() => setBillToPartyLookupOpen(false)}
        onSelect={handleBillToPartySelect}
        fetchPartners={fetchCustomerPartners}
        title="Bill To Party Code"
      />
      <SellerAddressModal
        isOpen={sellerAddressLookupOpen}
        onClose={() => setSellerAddressLookupOpen(false)}
        addresses={sellerAddresses}
        onSelect={handleSellerAddressSelect}
        loading={sellerAddressLoading}
        error={sellerAddressError}
      />
      <SellerAddressModal
        isOpen={toVendorAddressLookupOpen}
        onClose={() => setToVendorAddressLookupOpen(false)}
        addresses={toVendorAddresses}
        onSelect={handleToVendorAddressSelect}
        loading={toVendorAddressLoading}
        error={toVendorAddressError}
        title="To Vendor Address"
        emptyMessage="No vendor addresses found"
      />
      <SellerAddressModal
        isOpen={billToPartyAddressLookupOpen}
        onClose={() => setBillToPartyAddressLookupOpen(false)}
        addresses={billToPartyAddresses}
        onSelect={handleBillToPartyAddressSelect}
        loading={billToPartyAddressLoading}
        error={billToPartyAddressError}
        title="Bill To Party Address"
        emptyMessage="No bill-to addresses found"
      />
      <LineValueLookupModal
        isOpen={termsLookupOpen}
        onClose={() => setTermsLookupOpen(false)}
        onSelect={handleTermsLookupSelect}
        onCreate={handleTermsLookupCreate}
        options={termsLookupOptions}
        title="List of Predefined Text"
        searchPlaceholder="Search predefined text"
        emptyMessage={termsLookupLoading ? 'Loading predefined texts...' : (termsLookupError || 'No predefined text found')}
        allowCreate
        columns={PREDEFINED_TEXT_COLUMNS}
        createValueLabel="Text Code"
        createDescriptionLabel="Text"
      />
      <LineValueLookupModal
        isOpen={dynamicLookup.open}
        onClose={() => setDynamicLookup((prev) => ({ ...prev, open: false }))}
        onSelect={handleDynamicLookupSelect}
        options={dynamicLookup.options}
        title={`List of ${dynamicLookup.field?.label || 'Values'}`}
        searchPlaceholder="Search values"
        emptyMessage={dynamicLookup.loading ? 'Loading values...' : (dynamicLookup.error || 'No values found')}
        allowCreate={false}
      />
    </>
  );
}

export default HeaderUdfSidebar;
