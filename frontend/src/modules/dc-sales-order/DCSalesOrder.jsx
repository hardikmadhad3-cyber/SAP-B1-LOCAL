import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import '../../modules/item-master/styles/itemMaster.css';
import './styles/salesOrder.css';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import FormSettingsPanel from '../../components/purchase-order/FormSettingsPanel';
import HeaderUdfSidebar from '../../components/purchase-order/HeaderUdfSidebar';
import ContentsTab from './components/ContentsTab';
import LogisticsTab from './components/LogisticsTab';
import AccountingTab from './components/AccountingTab';
import TaxTab from './components/TaxTab';
import ElectronicDocumentsTab from './components/ElectronicDocumentsTab';
import AttachmentsTab from './components/AttachmentsTab';
import AddressModal from '../../components/document/AddressComponentModal';
import { mapAddressFields } from '../../utils/documentAddress';
import EWayBillModal from './components/EWayBillModal';
import TaxInfoModal from './components/TaxInfoModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import BusinessPartnerModal from './components/BusinessPartnerModal';
import CopyFromModal from '../../components/document/CopyFromModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import LineValueLookupModal from '../../components/sales-document/LineValueLookupModal';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import PrintSalesOrderActions from './components/PrintSalesOrderActions';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import { determineTaxCode, recalculateAllTaxCodes, getGSTTypeLabel } from '../../utils/taxEngine';
import { filterWarehousesByBranch } from '../../utils/warehouseBranch';
import { hydrateDocumentLineFromItem, mergeItemMaster } from '../../utils/documentItemHydration';
import { getSapVisibleDocumentSeries, pickDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import { useCompanyScopedFormSettings } from '../../utils/formSettingsStorage';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { inferDocumentCurrencyMode, resolveDocumentCurrency } from '../../utils/documentCurrency';
import { findTaxCode, getTaxComponentCodes, taxCodeHasComponent } from '../../utils/taxCodeComponents';
import { consumeCopyToState, replaceRouteStatePreservingWindow } from '../../utils/copyToState';
import useStandardDocumentDraftTask from '../../hooks/useStandardDocumentDraftTask';
import { isRouteStateForActiveCompany } from '../../utils/companyStorageScope';
import { copyToDocument } from '../../services/documentCopyService';
import { duplicateDocumentInPlace, refreshDuplicateSeries } from '../../utils/documentDuplicate';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useSalesEmployeeSetup from '../../hooks/useSalesEmployeeSetup';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import useSalesDocumentLineLookups from '../../hooks/useSalesDocumentLineLookups';
import SalesEmployeeSetupModal from '../../components/sales-employee/SalesEmployeeSetupModal';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { getBP } from '../../api/businessPartnerApi';
import {
    fetchSalesOrderByDocEntry,
    fetchSalesOrderCustomerDetails,
    fetchSalesOrderVendorDetails,
    fetchSalesOrderReferenceData,
    submitSalesOrder,
    updateSalesOrder,
    fetchDocumentSeries,
    fetchItemsForModal,
    fetchFreightCharges,
    createSalesOrderLookupValue,
} from '../../api/dcSalesOrderApi';
import { fetchHSNCodes, fetchHSNCodeFromItem, fetchSACCodes } from '../../api/hsnCodeApi';
import { dcSalesOrderCopyFromApi, normaliseDocumentHeader, normaliseDocumentLine, unwrapCopyFromDocument, BASE_TYPE } from '../../api/copyFromApi';
import {
    FORM_SETTINGS_STORAGE_KEY,
    HEADER_UDF_DEFINITIONS,
    ROW_UDF_DEFINITIONS,
    BASE_MATRIX_COLUMNS,
    createUdfState,
    filterSalesOrderRowUdfDefinitions,
    normalizeUdfState,
    readSavedFormSettings,
} from '../../config/dcSalesOrderForm';

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getErrMsg = (e, fb) => {
    const d = e?.response?.data?.detail;
    if (typeof d === 'string' && d.trim()) return d;
    if (d?.error?.message) return d.error.message;
    if (d?.message) return d.message;
    return e?.message || fb;
};

const today = () => new Date().toISOString().split('T')[0];
const parseNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const roundTo = (v, d) => { const f = 10 ** Math.max(d, 0); return Math.round((v + Number.EPSILON) * f) / f; };
const fmtDec = (v, d) => { if (v === '' || v == null) return ''; const n = Number(v); return Number.isNaN(n) ? '' : n.toFixed(Math.max(d, 0)); };
const sanitize = (v, d) => {
    const c = String(v ?? '').replace(/[^\d.-]/g, '').replace(/(?!^)-/g, '').replace(/^(-?)\./, '$10.').replace(/(\..*)\./g, '$1');
    if (!c) return '';
    if (!c.includes('.')) return c;
    const [w, f] = c.split('.');
    return `${w}.${(f || '').slice(0, Math.max(d, 0))}`;
};
const fmtAddr = (a) => {
    if (!a) return '';
    return [[a.Street, a.StreetNo], [a.Block, a.Building, a.Address2, a.Address3],
    [a.City, a.County, a.State, a.ZipCode], [a.Country]]
        .map(p => p.filter(Boolean).join(', ')).filter(Boolean).join('\n');
};
const mapAddressToModalForm = (address, existing = {}) => ({
    shipToCode: existing.shipToCode || '',
    shipToAddress: existing.shipToAddress || '',
    billToCode: existing.billToCode || '',
    billToAddress: existing.billToAddress || '',
    streetPoBox: address?.Street || '',
    streetNo: address?.StreetNo || '',
    buildingFloorRoom: address?.BuildingFloorRoom || address?.Building || '',
    block: address?.Block || '',
    city: address?.City || '',
    zipCode: address?.ZipCode || '',
    county: address?.County || '',
    state: address?.State || '',
    countryRegion: address?.Country || '',
    addressName2: address?.AddressName2 || address?.Address2 || '',
    addressName3: address?.AddressName3 || address?.Address3 || '',
    gln: address?.GlobalLocationNumber || address?.GlblLocNum || address?.GLN || '',
    erpAddress: address?.U_ERPAddress || address?.U_ERP_Address || address?.ERPAddress || '',
    contactPerson: address?.U_ContactPerson || address?.U_CONTACT_PERSON || address?.ContactPerson || '',
    mobile: address?.U_Mobile || address?.U_MOBILE || address?.Mobile || address?.MobilePhone || '',
    dateOfRegistration: address?.U_DateOfRegistration || address?.U_Date_Of_Registration || address?.DateOfRegistration || '',
    dateDetailsOfRegistration: address?.U_DateDetlOfReg || address?.U_Date_Detl_Of_Reg || address?.DateDetlOfReg || '',
    addressStatus: address?.U_Status || address?.AddressStatus || address?.Status || '',
    gstin: address?.GSTRegnNo || address?.GSTIN || address?.U_GSTIN_No || address?.U_GSTINNo || '',
    ...mapAddressFields(address),
});
const normalizeAddressText = (value) =>
    String(value || '')
        .toLowerCase()
        .replace(/[\r\n]+/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const normalizeUdfFieldText = (value) =>
    String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

const getUdfFieldIdentity = (field) => normalizeUdfFieldText(
    `${String(field?.key || '').replace(/^U_/i, '')} ${field?.label || ''}`
);

const getUdfFieldKeyText = (field) =>
    normalizeUdfFieldText(String(field?.key || '').replace(/^U_/i, ''));

const isBillToPartyCodeUdf = (field) => {
    const identity = getUdfFieldIdentity(field);
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'billtopartycode' ||
        label === 'billpartycode' ||
        label === 'partycode' ||
        key === 'billtopartycode' ||
        key === 'billpartycode' ||
        key === 'partycode' ||
        identity.includes('billtopartycode') ||
        identity.includes('billpartycode');
};

const isBillToPartyNameUdf = (field) => {
    const identity = getUdfFieldIdentity(field);
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'billtopartyname' ||
        label === 'billpartyname' ||
        label === 'partyname' ||
        key === 'billtopartyname' ||
        key === 'billpartyname' ||
        key === 'partyname' ||
        identity.includes('billtopartyname') ||
        identity.includes('billpartyname');
};

const isBillToPartyAddressIdUdf = (field) => {
    const identity = getUdfFieldIdentity(field);
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'billtopartyaddressid' ||
        label === 'billtoaddressid' ||
        label === 'partyaddressid' ||
        key === 'billtopartyaddressid' ||
        key === 'billtoaddressid' ||
        key === 'partyaddressid' ||
        identity.includes('billtopartyaddressid') ||
        identity.includes('billtoaddressid') ||
        identity.includes('partyaddressid');
};

const isBillToPartyAddressUdf = (field) => {
    if (isBillToPartyAddressIdUdf(field)) return false;

    const identity = getUdfFieldIdentity(field);
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'billtopartyaddress' ||
        label === 'billtoaddressbillto' ||
        label === 'billpartyaddress' ||
        label === 'partyaddress' ||
        key === 'billtopartyaddress' ||
        key === 'billtoaddressbillto' ||
        key === 'billpartyaddress' ||
        key === 'partyaddress' ||
        identity.includes('billtopartyaddress') ||
        identity.includes('billtoaddressbillto') ||
        identity.includes('billpartyaddress');
};

const getBillToPartyUdfFields = (fields = []) => ({
    code: fields.find(isBillToPartyCodeUdf),
    name: fields.find(isBillToPartyNameUdf),
    addressId: fields.find(isBillToPartyAddressIdUdf),
    address: fields.find(isBillToPartyAddressUdf),
});

const isToVendorCodeUdf = (field) => {
    const identity = getUdfFieldIdentity(field);
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'tocodevendor' ||
        label === 'tovendorcode' ||
        key === 'tocodevendor' ||
        key === 'tovendorcode' ||
        identity.includes('tocodevendor') ||
        identity.includes('tovendorcode');
};

const isToVendorNameUdf = (field) => {
    const identity = getUdfFieldIdentity(field);
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'toname' ||
        label === 'tovendorname' ||
        key === 'toname' ||
        key === 'tovendorname' ||
        identity.includes('toname') ||
        identity.includes('tovendorname');
};

const isToVendorAddressIdUdf = (field) => {
    const identity = getUdfFieldIdentity(field);
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'toaddressid' ||
        label === 'tovendoraddressid' ||
        key === 'toaddressid' ||
        key === 'tovendoraddressid' ||
        identity.includes('toaddressid') ||
        identity.includes('tovendoraddressid');
};

const isToVendorAddressUdf = (field) => {
    if (isToVendorAddressIdUdf(field)) return false;

    const identity = getUdfFieldIdentity(field);
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'toaddress' ||
        label === 'tovendoraddress' ||
        key === 'toaddress' ||
        key === 'tovendoraddress' ||
        identity.includes('toaddress') ||
        identity.includes('tovendoraddress');
};

const isContactIdUdf = (field) => {
    const label = normalizeUdfFieldText(field?.label);
    const key = getUdfFieldKeyText(field);

    return label === 'contactid' ||
        label === 'contactpersonid' ||
        label === 'bpcontactid' ||
        label === 'buyercontactid' ||
        key === 'contactid' ||
        key === 'contactpersonid' ||
        key === 'bpcontactid' ||
        key === 'buyercontactid' ||
        key === 'cntctid' ||
        key === 'cntctname';
};

const getToVendorUdfFields = (fields = []) => ({
    code: fields.find(isToVendorCodeUdf),
    name: fields.find(isToVendorNameUdf),
    addressId: fields.find(isToVendorAddressIdUdf),
    address: fields.find(isToVendorAddressUdf),
    contactId: fields.find(isContactIdUdf),
});

const getContactIdentifier = (contact) =>
    String(
        contact?.ContactID ||
        contact?.ContactId ||
        contact?.Name ||
        contact?.ContactPerson ||
        [contact?.FirstName, contact?.LastName].filter(Boolean).join(' ') ||
        ''
    ).trim();

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
    getContactIdentifier(contact) || getContactCode(contact);

const isActiveContact = (contact) => {
    const active = String(contact?.Active || contact?.active || '').trim().toUpperCase();
    return !active || active === 'Y' || active === 'YES' || active === 'TYES' || active === '1';
};

const selectBusinessPartnerContactId = (bp = {}, contacts = []) => {
    const allContacts = [
        ...(Array.isArray(contacts) ? contacts : []),
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
        const matchingContact = allContacts.find((contact) => getContactCode(contact) === directContactCode);
        return getContactDisplayValue(matchingContact) || directContactCode;
    }

    const directContactName = String(
        bp.ContactPerson ||
        bp.ContactPersonName ||
        bp.DefaultContactPerson ||
        ''
    ).trim();

    if (directContactName) {
        const normalizedDirectName = normalizeUdfFieldText(directContactName);
        const matchingContact = allContacts.find((contact) =>
            normalizeUdfFieldText(getContactIdentifier(contact)) === normalizedDirectName ||
            String(getContactCode(contact)) === directContactName
        );
        return getContactDisplayValue(matchingContact) || directContactName;
    }

    const activeContact = allContacts.find((contact) => getContactDisplayValue(contact) && isActiveContact(contact));
    const fallbackContact = activeContact || allContacts.find((contact) => getContactDisplayValue(contact));
    return getContactDisplayValue(fallbackContact) || '';
};

const getBpAddressId = (address) =>
    address?.AddressName || address?.Address || address?.AddressID || address?.AddressId || '';

const isBpBillToAddress = (address) => {
    const type = String(address?.AddressType || address?.AddrType || address?.AdresType || '').toUpperCase();
    return type.includes('BILL') || type === 'B' || type === 'BO_BILLTO';
};

const hasBpAddressType = (address) =>
    String(address?.AddressType || address?.AddrType || address?.AdresType || '').trim() !== '';

const filterBpBillToAddresses = (addresses = []) => {
    const usableAddresses = (Array.isArray(addresses) ? addresses : [])
        .filter((address) => getBpAddressId(address));
    const billToAddresses = usableAddresses.filter(isBpBillToAddress);

    if (billToAddresses.length) return billToAddresses;
    return usableAddresses.some(hasBpAddressType) ? [] : usableAddresses;
};

const selectBillToPartyAddress = (addresses = [], party = {}) => {
    const usableAddresses = filterBpBillToAddresses(addresses);

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
        const match = usableAddresses.find((address) => String(getBpAddressId(address)).trim() === defaultBillTo);
        if (match) return match;
    }

    return usableAddresses.find(isBpBillToAddress) || usableAddresses[0];
};

const buildBillToPartyUdfPatch = (fields, { code = '', name, address = null } = {}) => {
    const patch = {};

    if (fields.code?.key) patch[fields.code.key] = code;
    if (fields.name?.key && name !== undefined) patch[fields.name.key] = name;
    if (fields.addressId?.key) patch[fields.addressId.key] = getBpAddressId(address);
    if (fields.address?.key) patch[fields.address.key] = fmtAddr(address);

    return patch;
};

const buildToVendorUdfPatch = (fields, { code = '', name, address = null, contactId } = {}) => {
    const patch = {};

    if (fields.code?.key) patch[fields.code.key] = code;
    if (fields.name?.key && name !== undefined) patch[fields.name.key] = name;
    if (fields.addressId?.key) patch[fields.addressId.key] = getBpAddressId(address);
    if (fields.address?.key) patch[fields.address.key] = fmtAddr(address);
    if (fields.contactId?.key && contactId !== undefined) patch[fields.contactId.key] = contactId;

    return patch;
};

const applyChangedUdfPatch = (current, patch) => {
    const entries = Object.entries(patch);
    if (!entries.length) return current;

    const hasChanges = entries.some(([key, value]) => String(current[key] || '') !== String(value || ''));
    return hasChanges ? { ...current, ...patch } : current;
};

// â”€â”€â”€ static fallbacks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FALLBACK_PAYMENT_TERMS = [
    { value: '0', label: 'Immediate' },
    { value: '1', label: 'Net 30' },
    { value: '2', label: 'Net 60' },
    { value: '3', label: 'Net 90' },
];
const FALLBACK_SHIPPING = [
    { value: '1', label: 'Air' },
    { value: '2', label: 'Sea' },
    { value: '3', label: 'Road' },
    { value: '4', label: 'Courier' },
];
const FALLBACK_UOM = ['EA', 'PCS', 'KG', 'LTR', 'MTR', 'BOX', 'SET', 'NOS', 'PKT', 'DZN'];
const DEFAULT_WAREHOUSE_CODE = '01';
const DEFAULT_WAREHOUSE_NAME = 'General';
const FALLBACK_WAREHOUSES = [
    { WhsCode: DEFAULT_WAREHOUSE_CODE, WhsName: DEFAULT_WAREHOUSE_NAME },
    { WhsCode: 'WH01', WhsName: 'Main Warehouse' },
    { WhsCode: 'WH02', WhsName: 'Secondary Warehouse' },
];
// â”€â”€â”€ constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEC = { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 };
const TAB_NAMES = ['Contents', 'Logistics', 'Accounting', 'Tax', 'Electronic Documents', 'Attachments'];

const createLine = (rowUdfDefinitions = ROW_UDF_DEFINITIONS) => ({
    itemServiceType: 'Item',
    itemNo: '', itemDescription: '',
    sellerQuality: '', buyerQuality: '',
    hsnCode: '', quantity: '', unitPrice: '', discountAmount: '',
    sellerPrice: '', buyerPrice: '',
    sellerDelivery: '', buyerDelivery: '',
    sellerBrokerageAmtPer: '', sellerBrokeragePercent: '',
    sellerBrokerage: '', buyerBrokerage: '',
    specialRebate: '', commission: '2.5', sellerBrokeragePerQty: '', unitPriceUdf: '',
    qtySpecialInstruction: '', deliverySpecialInstruction: '',
    buyerPaymentTerms: '', sellerPaymentTerms: '', buyerSpecialInstruction: '', sellerSpecialInstruction: '',
    buyerBillDiscount: '', sellerBillDiscount: '', sellerItem: '', sellerQty: '',
    freightPurchase: '', freightSales: '', freightProvider: '', freightProviderName: '',
    brokerageNumber: '',
    uomCode: '', uomName: '', stdDiscount: '', stcode: '', taxCode: '', total: '', whse: DEFAULT_WAREHOUSE_CODE,
    distRule: '', freeText: '', countryOfOrigin: '', sacCode: '',
    openQty: '', deliveredQty: '', taxAmount: '', documentCreated: '',
    loc: '', branch: '', lineNum: undefined, baseEntry: null, baseType: null, baseLine: null,
    udf: createUdfState(rowUdfDefinitions),
});

const INIT_HEADER = {
    vendor: '', name: '', contactPerson: '', salesContractNo: '', customerRefNo: '', branch: '', warehouse: DEFAULT_WAREHOUSE_CODE,
    docNo: '', status: 'Open', series: '', nextNumber: '',
    postingDate: today(), deliveryDate: today(), documentDate: today(), contractDate: '',
    branchRegNo: '', shipTo: '', shipToCode: '', payTo: '', payToCode: '',
    shippingType: '', confirmed: undefined, journalRemark: '', paymentTerms: '',
    paymentMethod: '', otherInstruction: '', discount: '', freight: '', tax: '',
    totalPaymentDue: '', rounding: false, owner: '', purchaser: '',
    placeOfSupply: '', currencyMode: 'BP', currency: 'INR', useBillToForTax: false,
    billToAddress: '', billToCode: '', shipToAddress: '',
};

const createInitialHeader = (settings = readGeneralSettings()) => ({
    ...INIT_HEADER,
    warehouse: settings.dcSalesWarehouse || DEFAULT_WAREHOUSE_CODE,
    series: settings.dcSalesSeries || '',
    postingDate: today(),
    deliveryDate: today(),
    documentDate: today(),
});

const INIT_ATTACH = Array.from({ length: 9 }, (_, i) => ({
    id: i + 1, targetPath: '', fileName: '', attachmentDate: '',
    freeText: '', copyToTargetDocument: '', documentType: '', atchDocDate: '', alert: '',
}));

const closeDocumentDropdowns = () => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
};

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DCSalesOrder() {
  const [seriesRevision, setSeriesRevision] = useState(0);

    const location = useLocation();
    const navigate = useNavigate();
    const { company } = useAuth();
    const activeCompanyId = company?.companyId || '';
    const { removeTask, upsertTask } = useSapWindowTaskbarActions();
    const formRef = useRef(null);
    const handledCopyFromRef = useRef('');
    const generalSettingsRef = useRef(readGeneralSettings());
    const lastAutoBillToPartyBuyerRef = useRef('');
    const lastLoadedBillToPartyCodeRef = useRef('');
    const defaultToVendorAppliedRef = useRef('');
    const [isCopyFromClick, setIsCopyFromClick] = useState(false);
    const [currentDocEntry, setCurrentDocEntry] = useState(null);
    const [header, setHeader] = useState(() => createInitialHeader(generalSettingsRef.current));
    const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState(HEADER_UDF_DEFINITIONS);
    const [rowUdfDefinitions, setRowUdfDefinitions] = useState(ROW_UDF_DEFINITIONS);
    const [lines, setLines] = useState([createLine()]);
    const [attachments] = useState(INIT_ATTACH);
    const [activeTab, setActiveTab] = useState('Contents');
    const [headerUdfs, setHeaderUdfs] = useState(() => normalizeUdfState(HEADER_UDF_DEFINITIONS));
  const [formSettings, setFormSettings, , , formSettingsStatus] = useCompanyScopedFormSettings(
        FORM_SETTINGS_STORAGE_KEY,
    readSavedFormSettings,
    [],
    { saveMode: 'explicit' },
  );
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [formSettingsOpen, setFormSettingsOpen] = useState(false);
    const [refData, setRefData] = useState({
        company: '', vendors: [], contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [], items: [],
        warehouses: [], warehouse_addresses: [], company_address: {}, tax_codes: [], hsn_codes: [], sac_codes: [],
        payment_terms: [], shipping_types: [], branches: [], uom_groups: [], sales_employees: [], owners: [],
        countries: [], distribution_rules: [], quality_options: { buyer: [], seller: [] }, price_options: { buyer: [], seller: [] },
        defaults: { toVendorCode: '' },
        decimal_settings: DEC, warnings: [], series: [], states: [], udf_metadata: { header: [], rows: [] },
        local_currency: 'INR', system_currency: 'INR',
    });
    const [pageState, setPageState] = useState({ loading: false, vendorLoading: false, posting: false, error: '', success: '', seriesLoading: false });
    const [valErrors, setValErrors] = useState({ header: {}, lines: {}, form: '' });
    const [snapshotPending, setSnapshotPending] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    useStandardDocumentDraftTask({
        draftKey: 'dcSalesOrderDraft',
        title: 'DC Sales Order',
        draftValues: {
            currentDocEntry,
            header,
            lines,
            headerUdfs,
            activeTab,
            isDirty,
        },
        restoreDraft: (draft) => {
            setCurrentDocEntry(draft.currentDocEntry || null);
            setHeader(draft.header || createInitialHeader(generalSettingsRef.current));
            setLines(Array.isArray(draft.lines) && draft.lines.length ? draft.lines : [createLine()]);
            setHeaderUdfs(draft.headerUdfs || normalizeUdfState(HEADER_UDF_DEFINITIONS));
            setActiveTab(draft.activeTab || 'Contents');
            setIsDirty(Boolean(draft.isDirty));
        },
    });
    const [addressModal, setAddressModal] = useState(null);
    const [eWayBillModal, setEWayBillModal] = useState(false);
    const [eWayBillData, setEWayBillData] = useState({});
    const [taxInfoModal, setTaxInfoModal] = useState(false);
    const [stateModal, setStateModal] = useState(false);
    const [bpModal, setBpModal] = useState(false);
    const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1 });
    const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, items: [], loading: false });
    const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
    const [copyFromModal, setCopyFromModal] = useState(false);
    const [copyFromMode, setCopyFromMode] = useState(false);
    const [copyFromDocType, setCopyFromDocType] = useState('quotation'); // 'quotation' or 'blanket'
    useValidationHighlights(valErrors, { enabled: !copyFromMode, rootRef: formRef });
    const [addressForm, setAddressForm] = useState({
        shipToCode: '', shipToAddress: '', billToCode: '', billToAddress: '',
        streetPoBox: '', streetNo: '', buildingFloorRoom: '', block: '', city: '', zipCode: '', county: '',
        state: '', countryRegion: '', addressName2: '', addressName3: '', gln: '', gstin: ''
    });
    const [taxInfoForm, setTaxInfoForm] = useState({
        panNo: '', panCircleNo: '', panWardNo: '', panAssessingOfficer: '', deducteeRefNo: '',
        lstVatNo: '', cstNo: '', tanNo: '', serviceTaxNo: '', companyType: '', natureOfBusiness: '',
        assesseeType: '', tinNo: '', itrFiling: '', gstType: '', gstin: ''
    });
    const {
        lineLookupModal,
        openSACModal,
        openQualityModal,
        openPaymentTermsModal,
        closeLineLookupModal,
        handleLineLookupSelect,
        handleLineLookupCreate,
    } = useSalesDocumentLineLookups({
        refData,
        setRefData,
        setLines,
        createLookupValue: createSalesOrderLookupValue,
    });

    useEffect(() => {
        if (!refData.states?.length || !header.placeOfSupply) return;
        const normalizedPlaceOfSupply = getStateCodeValue(header.placeOfSupply, refData.states);
        if (normalizedPlaceOfSupply && normalizedPlaceOfSupply !== header.placeOfSupply) {
            setHeader(prev => (
                prev.placeOfSupply === header.placeOfSupply
                    ? { ...prev, placeOfSupply: normalizedPlaceOfSupply }
                    : prev
            ));
        }
    }, [header.placeOfSupply, refData.states]);

    useEffect(() => {
        defaultToVendorAppliedRef.current = '';
    }, [activeCompanyId]);

    const resolvePreferredSeries = (seriesList, postingDateValue, selectedSeries = '') => pickDocumentSeries(seriesList, selectedSeries);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (!e.target.closest('.so-dropdown')) {
                document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    // decimal config
    const dec = { ...DEC, ...(refData.decimal_settings || {}) };
    const numDec = {
        quantity: Number(dec.QtyDec), unitPrice: Number(dec.PriceDec),
        stdDiscount: Number(dec.PercentDec), discountAmount: Number(dec.PriceDec), total: Number(dec.SumDec),
        discount: Number(dec.PercentDec), freight: Number(dec.SumDec),
        tax: Number(dec.SumDec), totalPaymentDue: Number(dec.SumDec),
    };
    const {
        effectiveSalesEmployees,
        salesEmployeeSetup,
        openSalesEmployeeSetup,
        closeSalesEmployeeSetup,
        updateSalesEmployeeSetupRow,
        saveSalesEmployeeSetup,
        resolveSalesEmployeeByName,
    } = useSalesEmployeeSetup({
        employees: refData.sales_employees || [],
        onEmployeesChange: (sales_employees) => setRefData((prev) => ({ ...prev, sales_employees })),
        onError: (message) => setPageState((prev) => ({ ...prev, error: message || '' })),
        onSuccess: (message) => setPageState((prev) => ({ ...prev, error: '', success: message || '' })),
        discountDecimals: numDec.discount,
        getErrMsg,
    });
    const isDocumentEditable = !currentDocEntry || String(header.status || '').toLowerCase() === 'open';
    const documentBodyRef = useRef(null);
    useClosedDocumentViewMode(documentBodyRef, !isDocumentEditable, [activeTab]);
    const hasBuyerCode = Boolean(String(header.vendor || '').trim());
    const isUpdateMode = Boolean(currentDocEntry);
    const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
    const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
    const primaryActionLabel = pageState.posting
        ? 'Saving...'
        : isUpdateMode
            ? updateActionLabel
            : 'Add';
    const secondaryActionLabel = pageState.posting
        ? 'Saving...'
        : currentDocEntry
            ? updateActionLabel
            : 'Add & New';

    useEffect(() => {
        if (!snapshotPending || !currentDocEntry || pageState.loading || pageState.vendorLoading) return;
        setSnapshotPending(false);
    }, [snapshotPending, currentDocEntry, pageState.loading, pageState.vendorLoading, header, lines, headerUdfs]);

    const markDirty = useCallback((event) => {
        if (event?.target?.closest?.('[data-document-dirty-ignore="true"]')) return;
        if (currentDocEntry) {
            setIsDirty(true);
        }
    }, [currentDocEntry]);

    // Continue in next part...

    // â”€â”€ load reference data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useEffect(() => {
        let ignore = false;
        const load = async () => {
            setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
            setRefData(prev => ({
                ...prev,
                vendors: [],
                contacts: [],
                pay_to_addresses: [],
                ship_to_addresses: [],
                bill_to_addresses: [],
                items: [],
                warehouses: [],
                warehouse_addresses: [],
                company_address: {},
                tax_codes: [],
                hsn_codes: [],
                payment_terms: [],
                shipping_types: [],
                branches: [],
                states: [],
                uom_groups: [],
                sales_employees: [],
                owners: [],
                countries: [],
                distribution_rules: [],
                quality_options: { buyer: [], seller: [] },
                price_options: { buyer: [], seller: [] },
                sac_codes: [],
                defaults: { toVendorCode: '' },
                warnings: [],
                local_currency: 'INR',
                system_currency: 'INR',
            }));
            try {
                const [refDataRes, hsnRes, sacRes] = await Promise.all([
                    fetchSalesOrderReferenceData(activeCompanyId),
                    fetchHSNCodes(),
                    fetchSACCodes(),
                ]);

                // â•â•â• LOGGING: Reference Data â•â•â•
                console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
                console.log('ðŸ“š Reference Data Loaded:');
                console.log('  - Vendors/Customers:', refDataRes.data.vendors?.length || 0);
                console.log('  - Items:', refDataRes.data.items?.length || 0);
                console.log('  - Tax Codes:', refDataRes.data.tax_codes?.length || 0);
                console.log('  - Warehouses:', refDataRes.data.warehouses?.length || 0);
                console.log('  - Payment Terms:', refDataRes.data.payment_terms?.length || 0);
                console.log('  - Shipping Types:', refDataRes.data.shipping_types?.length || 0);
                console.log('  - Branches:', refDataRes.data.branches?.length || 0);
                console.log('  - States:', refDataRes.data.states?.length || 0);
                console.log('  - HSN Codes:', hsnRes.data?.length || 0);
                console.log('  - SAC Codes:', refDataRes.data.sac_codes?.length || sacRes.data?.length || 0);
                console.log('  - Sales Employees:', refDataRes.data.sales_employees?.length || 0);
                console.log('  - Owners:', refDataRes.data.owners?.length || 0);
                console.log('â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
                console.log('ðŸ¢ Company Address:', refDataRes.data.company_address);
                console.log('âš™ï¸  Decimal Settings:', refDataRes.data.decimal_settings);
                console.log('âš ï¸  Warnings:', refDataRes.data.warnings);
                console.log('â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€');
                console.log('ðŸ’° TAX CODES LOADED:');
                (refDataRes.data.tax_codes || []).forEach(tc => {
                    console.log(`  ${tc.Code} - ${tc.Name} (Rate: ${tc.Rate}%, Type: ${tc.GSTType || 'N/A'})`);
                });
                if (refDataRes.data.sales_employees && refDataRes.data.sales_employees.length > 0) {
                    console.log('ðŸ‘¥ SALES EMPLOYEES LOADED:');
                    refDataRes.data.sales_employees.forEach(emp => {
                        console.log(`  ${emp.SlpName} (Code: ${emp.SlpCode})`);
                    });
                }
                if (refDataRes.data.owners && refDataRes.data.owners.length > 0) {
                    console.log('ðŸ‘¤ OWNERS LOADED:');
                    refDataRes.data.owners.forEach(owner => {
                        console.log(`  ${owner.FullName} (empID: ${owner.empID})`);
                    });
                }
                console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

                if (!ignore) {
                    const nextHeaderUdfs = refDataRes.data.udf_metadata?.header || [];
                    const nextRowUdfs = filterSalesOrderRowUdfDefinitions(refDataRes.data.udf_metadata?.rows || []);
                    const nextUdfMetadata = {
                        ...(refDataRes.data.udf_metadata || {}),
                        rows: nextRowUdfs,
                    };
                    setHeaderUdfDefinitions(nextHeaderUdfs);
                    setRowUdfDefinitions(nextRowUdfs);
                    setHeaderUdfs((prev) => normalizeUdfState(nextHeaderUdfs, prev));
                    setLines((prev) => prev.map((line) => ({
                        ...line,
                        udf: normalizeUdfState(nextRowUdfs, line.udf || {}),
                    })));
                    setFormSettings((prev) => ({
                        ...prev,
                        headerUdfs: {
                            ...nextHeaderUdfs.reduce((acc, field) => ({ ...acc, [field.key]: { visible: true, active: true } }), {}),
                            ...(prev.headerUdfs || {}),
                        },
                        rowUdfs: {
                            ...nextRowUdfs.reduce((acc, field) => ({ ...acc, [field.key]: { visible: true, active: true } }), {}),
                            ...(prev.rowUdfs || {}),
                        },
                    }));
                    setRefData(prev => ({
                        ...prev,
                        company: refDataRes.data.company || '',
                        local_currency: refDataRes.data.local_currency || 'INR',
                        system_currency: refDataRes.data.system_currency || refDataRes.data.local_currency || 'INR',
                        vendors: refDataRes.data.vendors || [],
                        contacts: prev.contacts?.length ? prev.contacts : (refDataRes.data.contacts || []),
                        pay_to_addresses: prev.pay_to_addresses?.length ? prev.pay_to_addresses : (refDataRes.data.pay_to_addresses || []),
                        ship_to_addresses: prev.ship_to_addresses?.length ? prev.ship_to_addresses : (refDataRes.data.ship_to_addresses || []),
                        bill_to_addresses: prev.bill_to_addresses?.length ? prev.bill_to_addresses : (refDataRes.data.bill_to_addresses || []),
                        items: refDataRes.data.items || [],
                        warehouses: refDataRes.data.warehouses || [],
                        warehouse_addresses: refDataRes.data.warehouse_addresses || [],
                        company_address: refDataRes.data.company_address || {},
                        tax_codes: refDataRes.data.tax_codes || [],
                        hsn_codes: hsnRes.data || [],
                        sac_codes: refDataRes.data.sac_codes?.length ? refDataRes.data.sac_codes : (sacRes.data || []),
                        payment_terms: refDataRes.data.payment_terms || [],
                        shipping_types: refDataRes.data.shipping_types || [],
                        branches: refDataRes.data.branches || [],
                        states: refDataRes.data.states || [],
                        uom_groups: refDataRes.data.uom_groups || [],
                        sales_employees: refDataRes.data.sales_employees || [],
                        owners: refDataRes.data.owners || [],
                        countries: refDataRes.data.countries || [],
                        distribution_rules: refDataRes.data.distribution_rules || [],
                        quality_options: refDataRes.data.quality_options || { buyer: [], seller: [] },
                        price_options: refDataRes.data.price_options || { buyer: [], seller: [] },
                        defaults: refDataRes.data.defaults || { toVendorCode: '' },
                        decimal_settings: { ...DEC, ...(refDataRes.data.decimal_settings || {}) },
                        warnings: refDataRes.data.warnings || [],
                        udf_metadata: nextUdfMetadata,
                    }));
                }
            } catch (e) {
                console.error('âŒ Error loading reference data:', e);
                if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load reference data.') }));
            } finally {
                if (!ignore) setPageState(p => ({ ...p, loading: false }));
            }
        };
        load();
        return () => { ignore = true; };
    }, [activeCompanyId]);

    // â”€â”€ load existing order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


    useEffect(() => {
        const docEntry =
            location.state?.dcSalesOrderDocEntry ||
            location.state?.salesOrderDocEntry ||
            location.state?.docEntry ||
            location.state?.document?.docEntry ||
            location.state?.document?.DocEntry;
        if (!docEntry) return;
        if (!isRouteStateForActiveCompany(location.state)) {
            setPageState(p => ({ ...p, loading: false, error: '', success: '' }));
            replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
            return;
        }
        let ignore = false;
        const load = async () => {
            setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
            try {
                const r = await fetchSalesOrderByDocEntry(docEntry);
                const so = r.data.sales_order;
                let editSeries = [];
                try {
                    const seriesDate = so?.header?.documentDate || so?.header?.postingDate || '';
                    const seriesResponse = await fetchDocumentSeries(seriesDate, { branch: so?.header?.branch || '' });
                    editSeries = seriesResponse.data?.series || [];
                } catch (_seriesError) {
                    editSeries = [];
                }

                console.log('ðŸ“¥ Loaded DC Sales Order:', so);
                console.log('ðŸ“¥ Header data:', so.header);
                console.log('ðŸ“¥ Series:', so.header?.series);

                if (ignore || !so) return;
                setCurrentDocEntry(so.doc_entry || Number(docEntry));

                // Get warehouse from first line if available
                const firstLineWarehouse = so.lines && so.lines.length > 0 ? so.lines[0].whse : '';

                console.log('ðŸ“¥ EDIT DATA - Sales Employee:', so.header?.salesEmployee, 'Code:', so.header?.salesEmployee);
                console.log('ðŸ“¥ EDIT DATA - Purchaser:', so.header?.purchaser);
                console.log('ðŸ“¥ EDIT DATA - Owner:', so.header?.owner);
                console.log('ðŸ“¥ EDIT DATA - Remarks:', so.header?.remarks);
                console.log('ðŸ“¥ EDIT DATA - Other Instruction:', so.header?.otherInstruction);
                console.log('ðŸ“¥ EDIT DATA - Freight:', so.header?.freight);
                console.log('ðŸ“¥ EDIT DATA - refData.sales_employees:', refData.sales_employees?.length || 0);
                console.log('ðŸ“¥ EDIT DATA - refData.owners:', refData.owners?.length || 0);

                if (editSeries.length) {
                    setRefData(prev => ({
                        ...prev,
                        series: editSeries,
                    }));
                }

                const newHeader = {
                    ...INIT_HEADER,
                    vendor: so.header?.customerCode || '',
                    contactPerson: so.header?.contactPerson || '',
                    name: so.header?.customerName || '',
                    paymentTerms: so.header?.paymentTermsCode || so.header?.paymentTerms || '',
                    placeOfSupply: so.header?.placeOfSupply || '',
                    branch: so.header?.branch || '',
                    series: so.header?.series || '',
                    warehouse: firstLineWarehouse || so.header?.warehouse || '',
                    discount: so.header?.discount || '',
                    freight: so.header?.freight || '',
                    tax: so.header?.tax || '',
                    // Sales Employee - use CODE not name
                    salesEmployee: so.header?.salesEmployee || '',
                    purchaser: so.header?.purchaser || '',  // This is the NAME for display
                    // Owner - use name (frontend uses name in dropdown)
                    owner: so.header?.owner || '',
                    // Remarks - map to otherInstruction
                    remarks: so.header?.remarks || '',
                    otherInstruction: so.header?.otherInstruction || so.header?.remarks || '',
                    // Map backend address field names to frontend field names
                    shipToCode: so.header?.shipToCode || '',
                    shipToAddress: so.header?.shipTo || '',
                    billToCode: so.header?.payToCode || '',
                    billToAddress: so.header?.payTo || '',
                    // Copy all other fields from backend
                    postingDate: so.header?.postingDate || '',
                    deliveryDate: so.header?.deliveryDate || '',
                    documentDate: so.header?.documentDate || '',
                    salesContractNo: so.header?.customerRefNo || so.header?.salesContractNo || '',
                    customerRefNo: so.header?.customerRefNo || so.header?.salesContractNo || '',
                    docNo: String(so.header?.docNum || ''),
                    nextNumber: String(so.header?.docNum || ''),
                    status: so.header?.status || '',
                    shippingType: so.header?.shippingType || '',
                    confirmed: so.header?.confirmed || false,
                    journalRemark: so.header?.journalRemark || '',
                    currency: so.header?.currency || 'INR',
                    currencyMode: inferDocumentCurrencyMode({
                        currency: so.header?.currency || 'INR',
                        cardCode: so.header?.customerCode || so.header?.vendor || '',
                        businessPartners: refData.vendors || [],
                        localCurrency: refData.local_currency || 'INR',
                        systemCurrency: refData.system_currency || refData.local_currency || 'INR',
                    }),
                };

                console.log('ðŸ“¥ Final header state:', newHeader);
                setHeader(newHeader);
                setFreightModal({ open: false, freightCharges: [], loading: false });

                setLines(
                    Array.isArray(so.lines) && so.lines.length
                        ? so.lines.map((l, index) => {
                            // If HSN is empty, try to get it from item master
                            let hsnCode = l.hsnCode || '';
                            if (!hsnCode && l.itemNo) {
                                const item = refData.items.find(it => String(it.ItemCode) === String(l.itemNo));
                                if (item) {
                                    hsnCode = item.SWW || item.HSNCode || '';
                                }
                            }

                            return applyLineCalculatedFields({
                                ...createLine(rowUdfDefinitions),
                                ...l,
                                lineNum: l.lineNum ?? l.LineNum ?? index,
                                hsnCode: hsnCode,
                                stcode: l.stcode || '',
                                uomName: l.uomName || l.uomCode || '',
                                uomNameEdited: l.uomNameEdited,
                                documentCreated: l.documentCreated || so.header?.documentCreated || '',
                                loc: l.loc || resolveLineLocation(l.whse, l.branch || so.header?.branch || header.branch),
                                udf: normalizeUdfState(rowUdfDefinitions, l.udf || {})
                            });
                        })
                        : [createLine(rowUdfDefinitions)]
                );
                setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, so.header_udfs || {}));
                setSnapshotPending(true);
                setIsDirty(false);

                if (so.header?.customerCode) {
                    loadVendorDetails(so.header.customerCode);
                }
                setPageState(p => ({ ...p, success: so.doc_num ? `Sales order ${so.doc_num} loaded.` : 'Sales order loaded.' }));
            } catch (e) {
                if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load DC sales order.') }));
            } finally {
                if (!ignore) {
                    setPageState(p => ({ ...p, loading: false }));
                    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
                }
            }
        };
        load();
        return () => { ignore = true; };
    }, [location.pathname, location.state, navigate]);

    useEffect(() => {
        if (!currentDocEntry) return;

        let ignore = false;
        const loadSavedFreightCharges = async () => {
            try {
                const response = await fetchFreightCharges(currentDocEntry);
                const savedFreightCharges = response.data.freightCharges || [];
                const savedFreightTotal = savedFreightCharges.reduce((sum, charge) => (
                    sum + parseNum(charge.netAmount ?? charge.LineTotal ?? charge.NetAmount ?? charge.DefaultAmount)
                ), 0);
                if (!ignore) {
                    setFreightModal(prev => ({
                        ...prev,
                        freightCharges: savedFreightCharges,
                        loading: false,
                    }));
                    setHeader(prev => ({ ...prev, freight: fmtDec(savedFreightTotal, numDec.freight) }));
                }
            } catch (_error) {
                if (!ignore) {
                    setFreightModal(prev => ({ ...prev, freightCharges: [], loading: false }));
                }
            }
        };

        loadSavedFreightCharges();
        return () => { ignore = true; };
    }, [currentDocEntry]);

    // â”€â”€ derived / computed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const vendorContacts = useMemo(
        () => refData.contacts.filter(c => String(c.CardCode || '') === String(header.vendor || '')),
        [refData.contacts, header.vendor],
    );
    const contactOptions = useMemo(
        () => header.contactPerson && !vendorContacts.some(c => String(c.CntctCode || '') === String(header.contactPerson || ''))
            ? [{ CardCode: header.vendor, CntctCode: header.contactPerson, Name: header.contactPerson }, ...vendorContacts]
            : vendorContacts,
        [header.contactPerson, header.vendor, vendorContacts],
    );
    const vendorPayToAddresses = useMemo(
        () => refData.pay_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || '')),
        [refData.pay_to_addresses, header.vendor],
    );
    const vendorShipToAddresses = useMemo(
        () => refData.ship_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || '')),
        [refData.ship_to_addresses, header.vendor],
    );
    const vendorBillToAddresses = useMemo(
        () => refData.bill_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || '')),
        [refData.bill_to_addresses, header.vendor],
    );
    const vendorEffectiveShipToAddresses = useMemo(
        () => vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses,
        [vendorShipToAddresses, vendorPayToAddresses],
    );
    const vendorEffectiveBillToAddresses = useMemo(
        () => vendorBillToAddresses.length ? vendorBillToAddresses : vendorPayToAddresses,
        [vendorBillToAddresses, vendorPayToAddresses],
    );
    const billToPartyUdfFields = useMemo(
        () => getBillToPartyUdfFields(headerUdfDefinitions),
        [headerUdfDefinitions],
    );
    const toVendorUdfFields = useMemo(
        () => getToVendorUdfFields(headerUdfDefinitions),
        [headerUdfDefinitions],
    );
    const toVendorCodeKey = toVendorUdfFields.code?.key || '';
    const toVendorCodeValue = String(toVendorCodeKey ? headerUdfs[toVendorCodeKey] : '').trim();
    const defaultToVendorCode = String(refData.defaults?.toVendorCode || '').trim();
    const billToPartyCodeKey = billToPartyUdfFields.code?.key || '';
    const billToPartyCodeValue = String(billToPartyCodeKey ? headerUdfs[billToPartyCodeKey] : '').trim();
    const selectedBranch = refData.branches.find(b => String(b.BPLId || '') === String(header.branch || ''));
    const uomGroupMap = useMemo(
        () => (refData.uom_groups || []).reduce((acc, g) => { acc[g.AbsEntry] = g.uomCodes || []; return acc; }, {}),
        [refData.uom_groups],
    );

    const effectiveTaxCodes = refData.tax_codes || [];
    const effectiveWarehouses = useMemo(
        () => (refData.warehouses.length ? refData.warehouses : FALLBACK_WAREHOUSES),
        [refData.warehouses],
    );
    const freightTotals = summarizeFreightRows(freightModal.freightCharges, effectiveTaxCodes);

    // Filter warehouses by selected branch
    const branchFilteredWarehouses = useMemo(
        () => filterWarehousesByBranch(effectiveWarehouses, header.branch),
        [effectiveWarehouses, header.branch],
    );

    const payTermOpts = refData.payment_terms.length
        ? refData.payment_terms.map(t => ({ value: String(t.GroupNum), label: t.PymntGroup }))
        : FALLBACK_PAYMENT_TERMS;
    const shipTypeOpts = refData.shipping_types.length
        ? refData.shipping_types.map(s => ({ value: String(s.TrnspCode), label: s.TrnspName }))
        : FALLBACK_SHIPPING;

    useEffect(() => {
        if (currentDocEntry || copyFromMode || !toVendorCodeKey) return;

        if (!defaultToVendorCode) {
            defaultToVendorAppliedRef.current = '';
            return;
        }

        if (toVendorCodeValue || defaultToVendorAppliedRef.current === defaultToVendorCode) return;

        let cancelled = false;
        defaultToVendorAppliedRef.current = defaultToVendorCode;

        const applyDefaultToVendor = async () => {
            let vendor = null;
            let addresses = [];
            let contacts = [];

            try {
                vendor = await getBP(defaultToVendorCode).catch(() => null);
                addresses = Array.isArray(vendor?.BPAddresses) ? vendor.BPAddresses : [];
                contacts = Array.isArray(vendor?.ContactEmployees) ? vendor.ContactEmployees : [];

                if (!addresses.length || !vendor?.CardName) {
                    const detailsResponse = await fetchSalesOrderVendorDetails(defaultToVendorCode);
                    if (cancelled) return;

                    const details = detailsResponse.data || {};
                    vendor = vendor || details.businessPartner || details.vendor || details.bp || null;
                    contacts = contacts.length ? contacts : [
                        ...(Array.isArray(details.contacts) ? details.contacts : []),
                        ...(Array.isArray(details.ContactEmployees) ? details.ContactEmployees : []),
                    ];
                    addresses = addresses.length ? addresses : [
                        ...(Array.isArray(details.addresses) ? details.addresses : []),
                        ...(Array.isArray(details.BPAddresses) ? details.BPAddresses : []),
                        ...(Array.isArray(details.bill_to_addresses) ? details.bill_to_addresses : []),
                        ...(Array.isArray(details.pay_to_addresses) ? details.pay_to_addresses : []),
                    ];
                }
            } catch (error) {
                console.error('Failed to load default To Vendor details:', error);
            }

            if (cancelled) return;

            const selectedAddress = selectBillToPartyAddress(addresses, vendor || {});
            const patch = buildToVendorUdfPatch(toVendorUdfFields, {
                code: defaultToVendorCode,
                name: vendor?.CardName || '',
                address: selectedAddress,
                contactId: selectBusinessPartnerContactId(vendor || {}, contacts),
            });

            setHeaderUdfs((prev) => {
                if (String(prev[toVendorCodeKey] || '').trim()) {
                    return prev;
                }

                return applyChangedUdfPatch(prev, patch);
            });
        };

        applyDefaultToVendor();

        return () => {
            cancelled = true;
        };
    }, [
        currentDocEntry,
        copyFromMode,
        toVendorCodeKey,
        toVendorCodeValue,
        defaultToVendorCode,
        toVendorUdfFields,
    ]);

    useEffect(() => {
        if (!billToPartyCodeKey) return;

        const buyerCode = String(header.vendor || '').trim();
        if (!buyerCode) {
            lastAutoBillToPartyBuyerRef.current = '';
            return;
        }

        const selectedAddress = vendorEffectiveBillToAddresses.find(
            (address) => String(getBpAddressId(address)) === String(header.billToCode || ''),
        ) || selectBillToPartyAddress(vendorEffectiveBillToAddresses, { BillToDef: header.billToCode });
        const patch = buildBillToPartyUdfPatch(billToPartyUdfFields, {
            code: buyerCode,
            name: header.name || '',
            address: selectedAddress,
        });

        setHeaderUdfs((prev) => {
                    const currentCode = String(prev[billToPartyCodeKey] || '').trim();
                    const isNewBuyer = lastAutoBillToPartyBuyerRef.current !== buyerCode;
                    const shouldCompleteSelectedBuyer =
                        currentCode === buyerCode &&
                (
                    (billToPartyUdfFields.name?.key && !String(prev[billToPartyUdfFields.name.key] || '').trim() && patch[billToPartyUdfFields.name.key]) ||
                    (selectedAddress && billToPartyUdfFields.addressId?.key && !String(prev[billToPartyUdfFields.addressId.key] || '').trim()) ||
                    (selectedAddress && billToPartyUdfFields.address?.key && !String(prev[billToPartyUdfFields.address.key] || '').trim())
                );

                    if (!isNewBuyer && !shouldCompleteSelectedBuyer) {
                        return prev;
                    }

                    lastAutoBillToPartyBuyerRef.current = buyerCode;
                    return applyChangedUdfPatch(prev, {
                        ...patch,
                        ...(billToPartyUdfFields.name?.key ? { [billToPartyUdfFields.name.key]: header.name || '' } : {}),
                    });
                });
    }, [
        billToPartyCodeKey,
        header.vendor,
        header.name,
        header.billToCode,
        headerUdfDefinitions,
        vendorEffectiveBillToAddresses,
    ]);

    useEffect(() => {
        if (!billToPartyCodeKey) return;
        if (!billToPartyCodeValue) {
            lastLoadedBillToPartyCodeRef.current = '';
            return;
        }
        if (lastLoadedBillToPartyCodeRef.current === billToPartyCodeValue) return;

        let cancelled = false;
        lastLoadedBillToPartyCodeRef.current = billToPartyCodeValue;

        const loadBillToPartyDetails = async () => {
            try {
                let party = await getBP(billToPartyCodeValue).catch(() => null);
                if (cancelled) return;

                let addresses = Array.isArray(party?.BPAddresses) ? party.BPAddresses : [];

                if (!addresses.length) {
                    const detailsResponse = await fetchSalesOrderCustomerDetails(billToPartyCodeValue);
                    if (cancelled) return;
                    const details = detailsResponse.data || {};
                    addresses = [
                        ...(Array.isArray(details.bill_to_addresses) ? details.bill_to_addresses : []),
                    ];
                    party = party || details.businessPartner || details.customer || null;
                }

                const selectedAddress = selectBillToPartyAddress(addresses, party || {});
                const patch = buildBillToPartyUdfPatch(billToPartyUdfFields, {
                    code: billToPartyCodeValue,
                    name: party?.CardName || undefined,
                    address: selectedAddress,
                });

                setHeaderUdfs((prev) => {
                    if (String(prev[billToPartyCodeKey] || '').trim() !== billToPartyCodeValue) {
                        return prev;
                    }

                    return applyChangedUdfPatch(prev, patch);
                });
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to load Bill To Party UDF details:', error);
                }
            }
        };

        loadBillToPartyDetails();

        return () => {
            cancelled = true;
        };
    }, [billToPartyCodeKey, billToPartyCodeValue, headerUdfDefinitions]);

    const resolveSalesOrderAddress = useCallback((code, addresses = [], fallbackText = '') => {
        const normalizedCode = String(code || '').trim();
        if (normalizedCode) {
            const exactMatch = addresses.find((address) => String(address?.Address || '').trim() === normalizedCode);
            if (exactMatch) return exactMatch;
        }

        const normalizedFallbackText = normalizeAddressText(fallbackText);
        if (normalizedFallbackText) {
            return addresses.find((address) => normalizeAddressText(fmtAddr(address)) === normalizedFallbackText) || null;
        }

        return null;
    }, []);

    const getUomOptions = useCallback((line) => {
        const item = refData.items.find(i => String(i.ItemCode || '') === String(line.itemNo || ''));
        if (item) {
            const codes = uomGroupMap[item.UoMGroupEntry];
            if (codes && codes.length) return codes;
            const fb = String(item.SalesUnit || item.InventoryUOM || '').trim();
            if (fb) return [fb];
        }
        return FALLBACK_UOM;
    }, [refData.items, uomGroupMap]);

    const lineItemOptions = lines.reduce((acc, line, i) => {
        const code = String(line.itemNo || '').trim();
        const exists = refData.items.some(it => String(it.ItemCode || '') === code);
        acc[i] = code && !exists ? [{ ItemCode: code, ItemName: line.itemDescription || code }, ...refData.items] : refData.items;
        return acc;
    }, {});

    const fmtTaxLabel = (t) => {
        const code = String(t?.Code || '').trim();
        const name = String(t?.Name || '').trim();
        const up = `${code} ${name}`.toUpperCase();
        let type = '';
        if (up.includes('IGST')) type = 'IGST';
        else if (up.includes('CGST') && up.includes('SGST')) type = 'CGST+SGST';
        else if (up.includes('CGST')) type = 'CGST';
        else if (up.includes('SGST')) type = 'SGST';
        else if (up.includes('GST')) type = 'GST';
        const rate = t?.Rate != null ? `${Number(t.Rate)}%` : '';
        if (type && rate) return `${code} - ${type} ${rate}`;
        if (type) return `${code} - ${type}`;
        return name ? `${code} - ${name}` : code;
    };

    const getBranchName = useCallback((branchId) => {
        if (!branchId) return '';
        const branch = refData.branches.find(b => String(b.BPLId) === String(branchId));
        return branch ? branch.BPLName : branchId;
    }, [refData.branches]);

    const getWarehouseLocation = useCallback((warehouseCode) => {
        if (!warehouseCode) return '';
        const warehouse = effectiveWarehouses.find(w => String(w.WhsCode || '') === String(warehouseCode || ''));
        return warehouse?.City || warehouse?.County || warehouse?.State || '';
    }, [effectiveWarehouses]);

    const resolveLineLocation = useCallback((warehouseCode, branchId) => (
        getWarehouseLocation(warehouseCode) || getBranchName(branchId) || ''
    ), [getBranchName, getWarehouseLocation]);

    // â”€â”€ calculations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const getLineDiscountAmount = (line) => {
        const explicitDiscount = String(line.discountAmount ?? '').trim();
        if (explicitDiscount) return parseNum(explicitDiscount);

        const price = parseNum(line.unitPrice);
        const disc = parseNum(line.stdDiscount);
        return price * disc / 100;
    };

    const getLineDiscountPercent = (line) => {
        const explicitPercent = String(line.stdDiscount ?? '').trim();
        if (explicitPercent) return parseNum(explicitPercent);

        const price = parseNum(line.unitPrice);
        if (price <= 0) return 0;
        return getLineDiscountAmount(line) * 100 / price;
    };

    const calcLineTotal = (line) => {
        const qty = parseNum(line.quantity), price = parseNum(line.unitPrice), discount = getLineDiscountAmount(line);
        return roundTo(qty * Math.max(price - discount, 0), numDec.total);
    };

    const calcLineCommission = (line) => {
        const percent = parseNum(line.commission);
        if (percent <= 0) return '';

        const value = parseNum(line.quantity) * parseNum(line.unitPrice) * percent / 100;
        return fmtDec(roundTo(value, numDec.sellerBrokerage), numDec.sellerBrokerage);
    };

    const applyLineCalculatedFields = (line) => {
        const next = { ...line };
        if (String(next.discountAmount ?? '').trim()) {
            next.stdDiscount = fmtDec(roundTo(getLineDiscountPercent(next), numDec.stdDiscount), numDec.stdDiscount);
        }
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        const calculatedSellerBrokerage = calcLineCommission(next);
        if (!String(next.sellerBrokerage ?? '').trim() && calculatedSellerBrokerage) {
            next.sellerBrokerage = calculatedSellerBrokerage;
        }
        return next;
    };

    const calcTotals = () => {
        const taxRateMap = new Map(effectiveTaxCodes.map(t => [String(t.Code || ''), parseNum(t.Rate)]));
        const subtotal = lines.reduce((s, l) => s + calcLineTotal(l), 0);
        const discPct = parseNum(header.discount);
        const discAmt = roundTo(subtotal * discPct / 100, numDec.total);
        const discSub = Math.max(0, subtotal - discAmt);
        const freight = roundTo(parseNum(header.freight), numDec.total);
        const freightTaxAmt = roundTo(parseNum(freightTotals.totalTax), numDec.tax);
        let taxAmt = 0;
        const taxMap = new Map();
        if (subtotal > 0) {
            lines.forEach(l => {
                const net = calcLineTotal(l);
                if (net <= 0 || !l.taxCode) return;
                const rate = taxRateMap.get(String(l.taxCode || '')) || 0;
                const base = discSub * (net / subtotal);
                const lineTax = roundTo(base * rate / 100, numDec.tax);
                taxAmt += lineTax;
                const ex = taxMap.get(l.taxCode) || { taxCode: l.taxCode, taxRate: rate, taxableAmount: 0, taxAmount: 0 };
                ex.taxableAmount = roundTo(ex.taxableAmount + base, numDec.total);
                ex.taxAmount = roundTo(ex.taxAmount + lineTax, numDec.tax);
                taxMap.set(l.taxCode, ex);
            });
        }
        taxAmt = roundTo(taxAmt, numDec.tax);
        if (taxAmt === 0) { const lt = roundTo(parseNum(header.tax), numDec.tax); if (lt > 0) taxAmt = lt; }
        taxAmt = roundTo(taxAmt + freightTaxAmt, numDec.tax);
        return { subtotal, discAmt, discSub, freight, freightTaxAmt, taxAmt, total: roundTo(discSub + freight + taxAmt, numDec.totalPaymentDue), taxBreakdown: Array.from(taxMap.values()) };
    };

    const totals = calcTotals();
    useRelationshipMapRegistration({
        enabled: Boolean(currentDocEntry),
        objectType: 17,
        docEntry: currentDocEntry,
        header,
        total: totals.total,
    });

    // â”€â”€ GST determination logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const determineGSTType = (gstState) => {
        if (!gstState) return 'IGST';

        // Get company state (assuming it's stored in refData.company or we need to get it)
        const companyState = refData.company_address?.State || '';

        if (gstState === companyState) {
            return 'CGST_SGST'; // CGST + SGST
        } else {
            return 'IGST';
        }
    };

    const getApplicableTaxCode = (gstType, itemTaxRate = 18) => {
        // Find tax codes based on GST type
        const taxCodes = effectiveTaxCodes.filter(code => {
            const rate = Number(code.Rate || 0);
            const gstTypeValue = String(code.GSTType || '').trim().toUpperCase();

            if (gstType === 'CGST_SGST') {
                if (gstTypeValue === 'INTRASTATE' && Math.abs(rate - itemTaxRate) < 0.01) {
                    return true;
                }
                // For CGST+SGST, we need CGST or SGST with half the rate
                const halfRate = itemTaxRate / 2;
                return (
                    taxCodeHasComponent(effectiveTaxCodes, code.Code, 'CGST')
                    || taxCodeHasComponent(effectiveTaxCodes, code.Code, 'SGST')
                ) && Math.abs(rate - halfRate) < 0.01;
            } else if (gstType === 'IGST') {
                if (gstTypeValue === 'INTERSTATE' && Math.abs(rate - itemTaxRate) < 0.01) {
                    return true;
                }
                // For IGST, we need IGST with full rate
                return taxCodeHasComponent(effectiveTaxCodes, code.Code, 'IGST') && Math.abs(rate - itemTaxRate) < 0.01;
            }
            return false;
        });

        // Return the first matching tax code
        return taxCodes.length > 0 ? taxCodes[0].Code : '';
    };

    // â”€â”€ address sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Sync branch to all lines when header branch changes
    useEffect(() => {
       if (copyFromMode || isCopyFromClick) return;
        if (header.branch) {
            console.log('ðŸ”„ Syncing branch to all lines:', header.branch);
            setLines(prev => {
                const updated = prev.map(l => ({
                    ...l,
                    branch: String(header.branch),
                    loc: resolveLineLocation(l.whse || header.warehouse, header.branch)
                }));
                console.log('âœ… Lines updated with branch:', updated.map(l => ({ branch: l.branch, loc: l.loc })));
                return updated;
            });
        }
    }, [copyFromMode, header.branch, header.warehouse, isCopyFromClick, refData.warehouses.length]);

    useEffect(() => {
        if (!header.branch || !refData.warehouses.length) return;

        const allowedWarehouseCodes = new Set(
            branchFilteredWarehouses.map(w => String(w.WhsCode || ''))
        );

        setHeader(prev => (
            prev.warehouse && !allowedWarehouseCodes.has(String(prev.warehouse))
                ? { ...prev, warehouse: '' }
                : prev
        ));

        setLines(prev => {
            let changed = false;
            const next = prev.map(line => {
                if (line.whse && !allowedWarehouseCodes.has(String(line.whse))) {
                    changed = true;
                    return { ...line, whse: '', loc: resolveLineLocation('', line.branch || header.branch) };
                }
                return line;
            });
            return changed ? next : prev;
        });
    }, [branchFilteredWarehouses, header.branch, refData.warehouses.length, resolveLineLocation]);

    // Sync warehouse to all lines when header warehouse changes
    useEffect(() => {
        if (copyFromMode || isCopyFromClick) return;
        if (header.warehouse) {
            setLines(prev => prev.map(l => ({
                ...l,
                whse: header.warehouse,
                loc: resolveLineLocation(header.warehouse, l.branch || header.branch)
            })));

            // Validate warehouse-branch assignment
            if (header.branch) {
                const selectedWarehouse = refData.warehouses.find(w => w.WhsCode === header.warehouse);
                if (selectedWarehouse && selectedWarehouse.BranchID &&
                    String(selectedWarehouse.BranchID) !== String(header.branch)) {
                    console.warn(`âš ï¸ Warehouse "${header.warehouse}" is assigned to Branch ${selectedWarehouse.BranchID}, but document is for Branch ${header.branch}`);
                    setPageState(p => ({
                        ...p,
                        error: `Warning: Warehouse "${header.warehouse}" is assigned to a different branch. This may cause submission errors.`
                    }));
                }
            }
        }
    }, [header.warehouse, header.branch, refData.warehouses]);

    // â”€â”€ Recalculate Tax Codes on State/Address Changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useEffect(() => {
        if (currentDocEntry) return;
        if (!header.vendor || !header.placeOfSupply) return;

        const companyState = refData.company_address?.State || selectedBranch?.State || '';

        if (!companyState) {
            console.warn('âš ï¸ Company state not available for tax recalculation');
            return;
        }

        console.log('ðŸ”„ Recalculating Tax Codes for All Lines:', {
            placeOfSupply: header.placeOfSupply,
            companyState,
            gstType: getGSTTypeLabel(companyState, header.placeOfSupply),
            lineCount: lines.filter(l => l.itemNo).length
        });

        // Recalculate tax codes for all lines with items
        const updatedLines = recalculateAllTaxCodes(
            lines,
            refData.items,
            header.placeOfSupply,  // shipToState
            header.placeOfSupply,  // billToState
            false,                 // useBillToForTax
            companyState,
            effectiveTaxCodes
        );

        setLines(updatedLines);
    }, [currentDocEntry, header.placeOfSupply, header.vendor, refData.company_address, selectedBranch]);

    useEffect(() => {
        if (!header.vendor) return;

        // Only run once when vendor changes or addresses are loaded
        if (header.billToCode || header.shipToCode) return; // Already set

        setHeader(prev => {
            let updates = {};

            const billToList = vendorEffectiveBillToAddresses;
            const shipToList = vendorEffectiveShipToAddresses;

            // Skip if no addresses available yet
            if (billToList.length === 0 && shipToList.length === 0) return prev;

            // Set default Bill-To address
            const defaultBillTo = billToList.find(a => String((a.AddressType || a.AdresType || '').toUpperCase()).includes('B')) || billToList[0];
            if (defaultBillTo && !prev.billToCode) {
                updates.billToCode = defaultBillTo.Address || '';
                updates.billToAddress = fmtAddr(defaultBillTo);
            }

            // Set default Ship-To address
            const defaultShipTo = shipToList.find(a => String((a.AddressType || a.AdresType || '').toUpperCase()).includes('S')) || shipToList[0];
            if (defaultShipTo && !prev.shipToCode) {
                updates.shipToCode = defaultShipTo.Address || '';
                updates.shipToAddress = fmtAddr(defaultShipTo);
            } else if (defaultBillTo && !prev.shipToCode) {
                // If no dedicated ship-to present, use bill-to as ship-to fallback
                updates.shipToCode = defaultBillTo.Address || '';
                updates.shipToAddress = fmtAddr(defaultBillTo);
            }

            // Update Place of Supply from Ship-To (or Bill-To fallback)
            const posAddress = defaultShipTo || defaultBillTo;
            if (posAddress && !prev.placeOfSupply) {
                updates.placeOfSupply = posAddress.State || '';
            }

            // Only update if there are changes
            if (Object.keys(updates).length > 0) {
                return { ...prev, ...updates };
            }
            return prev;
        });
    }, [header.vendor, refData.pay_to_addresses, refData.ship_to_addresses, refData.bill_to_addresses]);

    // Update GST when addresses or place of supply changes
    useEffect(() => {
        if (currentDocEntry) return;
        if (!header.vendor || !header.placeOfSupply) return;

        const gstType = determineGSTType();
        console.log('Auto-updating tax codes based on GST type:', gstType);

        // Update tax codes for all lines that have items
        setLines(prevLines =>
            prevLines.map(line => {
                if (!line.itemNo) return line; // Skip empty lines

                // Get item's default tax rate (assume 18% if not specified)
                const item = refData.items.find(it => String(it.ItemCode || '') === String(line.itemNo || ''));
                const itemTaxRate = item?.TaxRate || 18;

                const applicableTaxCode = getApplicableTaxCode(gstType, itemTaxRate);

                return {
                    ...line,
                    taxCode: applicableTaxCode || line.taxCode
                };
            })
        );
    }, [currentDocEntry, header.placeOfSupply, header.vendor]);

    // â”€â”€ vendor details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const loadVendorDetails = async (code) => {
        if (!code) {
            setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
            return;
        }

        setPageState(p => ({ ...p, vendorLoading: true }));

        try {
            const r = await fetchSalesOrderCustomerDetails(code);

            const contacts = r.data.contacts || [];
            setRefData(p => ({
                ...p,
                contacts: contacts,
                pay_to_addresses: r.data.pay_to_addresses || [],
                ship_to_addresses: r.data.ship_to_addresses || [],
                bill_to_addresses: r.data.bill_to_addresses || []
            }));

            if (contacts.length > 0) {
                setHeader(prev => ({
                    ...prev,
                    contactPerson: prev.contactPerson || contacts[0].CntctCode
                }));
            }

        } catch (err) {
            console.error('âŒ Error loading vendor details:', err);
            console.error('Error response:', err.response?.data);
            setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
        } finally {
            setPageState(p => ({ ...p, vendorLoading: false }));
        }
    };

    const resolveHeaderCurrency = useCallback((mode, vendorCode, currentCurrency = '') => (
        resolveDocumentCurrency({
            mode,
            cardCode: vendorCode,
            businessPartners: refData.vendors || [],
            currentCurrency,
            localCurrency: refData.local_currency || 'INR',
            systemCurrency: refData.system_currency || refData.local_currency || 'INR',
        })
    ), [refData.local_currency, refData.system_currency, refData.vendors]);

    const syncVendor = (code, hdr) => {
        const m = refData.vendors.find(v => String(v.CardCode || '') === String(code || ''));
        if (!m) return { nextHeader: hdr };
        const nextCurrencyMode = hdr.currencyMode || 'BP';
        return {
            nextHeader: {
                ...hdr,
                name: m.CardName || hdr.name,
                paymentTerms: m.PayTermsGrpCode != null ? String(m.PayTermsGrpCode) : hdr.paymentTerms,
                currencyMode: nextCurrencyMode,
                currency: resolveHeaderCurrency(nextCurrencyMode, code, hdr.currency),
                contactPerson: '',
            },
        };
    };

    // â”€â”€ handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleHeaderChange = (e) => {
        const { name, value, type, checked } = e.target;
        setValErrors(p => ({ ...p, header: { ...p.header, [name]: '' }, form: '' }));
        setPageState(p => ({ ...p, error: '', success: '' }));

        if (name === 'series') {
            handleSeriesChange(value);
            return;
        }

        if (name === 'shipToCode') {
            handleShipToChange(value);
            return;
        }

        if (name === 'vendor') {
            setHeader(prev => {
                const prep = { ...prev, [name]: value };
                const { nextHeader } = syncVendor(value, prep);
                nextHeader.contactPerson = '';
                // Reset address fields when vendor changes
                nextHeader.billToCode = '';
                nextHeader.billToAddress = '';
                nextHeader.shipToCode = '';
                nextHeader.shipToAddress = '';
                nextHeader.placeOfSupply = '';
                return nextHeader;
            });
            loadVendorDetails(value);
            return;
        }

        if (name === 'currencyMode') {
            const nextCurrency = resolveHeaderCurrency(value, header.vendor, header.currency);
            markDirty();
            setHeader(p => ({ ...p, currencyMode: value, currency: nextCurrency }));
            return;
        }

        if (name === 'billToCode') {
            handleBillToChange(value);
            return;
        }

        if (name === 'shipToCode') {
            handleShipToChange(value);
            return;
        }

        // âœ… FIX: When purchaser (Sales Employee name) changes, update salesEmployee (code) too
        if (name === 'purchaser') {
            if (value === '__DEFINE_NEW__') {
                openSalesEmployeeSetup();
                return;
            }
            // Find the SlpCode for the selected name
            const selectedEmployee = resolveSalesEmployeeByName(value);

            setHeader(p => ({
                ...p,
                purchaser: value,
                salesEmployee: selectedEmployee ? String(selectedEmployee.SlpCode) : '-1'
            }));

            console.log('ðŸ”„ Sales Employee changed:', {
                name: value,
                code: selectedEmployee ? selectedEmployee.SlpCode : '-1'
            });

            return;
        }

        if (numDec[name] !== undefined && type !== 'checkbox') {
            markDirty();
            setHeader(p => ({ ...p, [name]: sanitize(value, numDec[name]) }));
            return;
        }
        markDirty();
        setHeader(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleShipToChange = (addressCode) => {
        markDirty();
        if (!addressCode || !header.vendor) {
            setHeader(p => ({ ...p, shipToCode: addressCode, shipToAddress: '', placeOfSupply: '' }));
            return;
        }

        const addr = vendorEffectiveShipToAddresses.find(a => String(a.Address || '') === addressCode)
            || vendorEffectiveBillToAddresses.find(a => String(a.Address || '') === addressCode);
        if (addr) {
            setHeader(p => ({
                ...p,
                shipToCode: addressCode,
                shipToAddress: fmtAddr(addr),
                placeOfSupply: addr.State || p.placeOfSupply || ''
            }));
        }
    };

    const handleBillToChange = (addressCode) => {
        markDirty();
        if (!addressCode || !header.vendor) {
            setHeader(p => ({ ...p, billToCode: addressCode, billToAddress: '' }));
            return;
        }

        const addr = vendorEffectiveBillToAddresses.find(a => String(a.Address || '') === addressCode)
            || vendorEffectiveShipToAddresses.find(a => String(a.Address || '') === addressCode);
        if (addr) {
            setHeader(p => ({
                ...p,
                billToCode: addressCode,
                billToAddress: fmtAddr(addr),
                placeOfSupply: header.useBillToForTax ? addr.State || header.placeOfSupply : header.placeOfSupply
            }));
        }
    };

    const handleSeriesChange = (seriesValue) => {
      const manual = ['-1', 'manual', '__sap_manual__'].includes(String(seriesValue).toLowerCase());
      if (manual && !canUseManualSeries(refData)) return;
      const selected = (refData.series || []).find(row => String(row.Series) === String(seriesValue));
      setHeader(prev => ({ ...prev, series: manual ? '-1' : selected ? String(selected.Series) : '', nextNumber: manual ? '' : String(selected?.NextNumber ?? ''), docNo: '' }));
      setPageState(prev => ({ ...prev, error: '', success: '' }));
    };

    const handleLineChange = async (i, e) => {
        const { name, value } = e.target;
        markDirty();
        setValErrors(p => ({ ...p, lines: { ...p.lines, [i]: { ...(p.lines[i] || {}), [name]: '' } }, form: '' }));
        setPageState(p => ({ ...p, error: '', success: '' }));

        if (name === 'itemNo' && value) {
            // Fetch HSN code from database via API
            try {
                const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));

                if (item) {
                    // Fetch HSN code from OCHP table via JOIN query
                    const hsnResponse = await fetchHSNCodeFromItem(value);
                    const hsnData = hsnResponse.data;

                    console.log('ðŸ” Item Selected - HSN Data:', {
                        itemCode: value,
                        hsnCode: hsnData.hsnCode,
                        hsnDescription: hsnData.hsnDescription,
                        hsn_sww: hsnData.hsn_sww,
                    });

                    setLines(prev => prev.map((line, idx) => {
                        if (idx !== i) return line;
                        const next = { ...line, itemNo: value };

                        // Step 1: Set Item Details
                        next.itemDescription = item.ItemName || next.itemDescription;
                        next.uomCode = String(item.SalesUnit || item.InventoryUOM || '').trim();
                        next.uomName = next.uomName || next.uomCode;
                        next.countryOfOrigin = item.ItemCountryOrg || next.countryOfOrigin || '';
                        next.sacCode = item.SACEntry || next.sacCode || '';
                        next.distRule = next.distRule || item.DistributionRule || '';
                        next.whse = next.whse || item.DefaultWarehouse || header.warehouse || '';
                        next.loc = resolveLineLocation(next.whse, next.branch || header.branch);
                        next.openQty = next.openQty || '';

                        // Step 2: Set HSN Code from API response (OCHP.ChapterID via JOIN)
                        next.hsnCode = hsnData.hsnCode || hsnData.hsn_sww || '';

                        // Step 3: Get Base Tax Code from Item Master
                        const baseTaxCode = item.TaxCodeAR || item.SalTaxCode || '';

                        console.log('ðŸ” Item Selected:', {
                            itemCode: item.ItemCode,
                            itemName: item.ItemName,
                            hsnCode: next.hsnCode,
                            baseTaxCode: baseTaxCode,
                            placeOfSupply: header.placeOfSupply,
                        });

                        // Step 4: Determine GST State (Place of Supply)
                        const gstState = header.placeOfSupply;
                        const companyState = refData.company_address?.State || selectedBranch?.State || '';

                        // Step 5: Validate States
                        if (!gstState || !companyState) {
                            console.warn('âš ï¸ Missing state information for tax determination');
                            next.taxCode = '';
                            next.stcode = next.stcode || '';
                        } else {
                            // Step 6: Determine Tax Code using Tax Engine
                            const determinedTaxCode = determineTaxCode(
                                { ...item, TaxCodeAR: baseTaxCode },
                                gstState,        // shipToState (using Place of Supply)
                                gstState,        // billToState (same as POS for now)
                                false,           // useBillToForTax (not used in current flow)
                                companyState,
                                effectiveTaxCodes
                            );

                            if (determinedTaxCode) {
                                next.taxCode = determinedTaxCode;
                                next.stcode = next.stcode || '';
                                console.log('âœ… Tax Code Auto-Selected:', {
                                    gstType: getGSTTypeLabel(companyState, gstState),
                                    taxCode: determinedTaxCode
                                });
                            } else {
                                console.warn('âš ï¸ Could not determine tax code');
                                next.taxCode = '';
                                next.stcode = next.stcode || '';
                            }
                        }

                        return applyLineCalculatedFields(next);
                    }));
                }
            } catch (error) {
                console.error('âŒ Error fetching HSN code:', error);
                // Fallback to reference data if API fails
                setLines(prev => prev.map((line, idx) => {
                    if (idx !== i) return line;
                    const next = { ...line, itemNo: value };
                    const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));
                    if (item) {
                        next.itemDescription = item.ItemName || next.itemDescription;
                        next.uomCode = String(item.SalesUnit || item.InventoryUOM || '').trim();
                        next.uomName = next.uomName || next.uomCode;
                        next.hsnCode = item.SWW || item.HSNCode || item.U_HSNCode || next.hsnCode || '';
                        next.countryOfOrigin = item.ItemCountryOrg || next.countryOfOrigin || '';
                        next.sacCode = item.SACEntry || next.sacCode || '';
                        next.distRule = next.distRule || item.DistributionRule || '';
                        next.whse = next.whse || item.DefaultWarehouse || header.warehouse || '';
                        next.loc = resolveLineLocation(next.whse, next.branch || header.branch);
                        next.stcode = next.stcode || '';
                    }
                    return applyLineCalculatedFields(next);
                }));
            }
        } else {
            // For non-itemNo changes, update synchronously
            setLines(prev => prev.map((line, idx) => {
                if (idx !== i) return line;
                const next = { ...line, [name]: numDec[name] !== undefined ? sanitize(value, numDec[name]) : value };
                if (name === 'uomName') next.uomNameEdited = true;
                if (name === 'unitPrice') {
                    if (String(next.discountAmount ?? '').trim()) {
                        next.stdDiscount = fmtDec(roundTo(getLineDiscountPercent(next), numDec.stdDiscount), numDec.stdDiscount);
                    }
                }
                if (name === 'discountAmount') {
                    next.stdDiscount = String(next.discountAmount ?? '').trim()
                        ? fmtDec(roundTo(getLineDiscountPercent(next), numDec.stdDiscount), numDec.stdDiscount)
                        : '';
                }
                if (name === 'stdDiscount') {
                    const price = parseNum(next.unitPrice);
                    next.discountAmount = String(next.stdDiscount ?? '').trim() && price > 0
                        ? fmtDec(roundTo(price * parseNum(next.stdDiscount) / 100, numDec.discountAmount), numDec.discountAmount)
                        : '';
                }
                if (name === 'uomCode') { next.uomName = value; next.uomNameEdited = false; }
                if (name === 'taxCode') next.stcode = next.stcode || '';
                if (name === 'whse') next.loc = resolveLineLocation(next.whse, next.branch || header.branch);
                return applyLineCalculatedFields(next);
            }));
        }
    };

    const handleNumBlur = (field, target = 'line', i = null) => {
        const d = numDec[field];
        if (d === undefined) return;
        if (target === 'header') { setHeader(p => ({ ...p, [field]: fmtDec(p[field], d) })); return; }
        setLines(p => p.map((l, idx) => idx === i ? applyLineCalculatedFields({ ...l, [field]: fmtDec(l[field], d) }) : l));
    };

    const addLine = () => {
        markDirty();
        // ðŸš¨ SKIP ALL VALIDATION DURING COPY MODE
        if (copyFromMode) {
            setLines(p => [...p, {
                ...createLine(rowUdfDefinitions),
                branch: header.branch || '',
                loc: resolveLineLocation(header.warehouse, header.branch),
                whse: header.warehouse || ''
            }]);
            return;
        }
        // Validate the last line before adding a new one
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1];
            const lastIndex = lines.length - 1;
            const errors = {};

            // Check if last line has an item
            if (!String(lastLine.itemNo || '').trim()) {
                errors.itemNo = 'Item is required before adding a new line';
            }

            // Check if last line has quantity
            if (!lastLine.quantity || Number(lastLine.quantity) <= 0) {
                errors.quantity = 'Quantity is required before adding a new line';
            }

            // Check if last line has unit price
            if (!lastLine.unitPrice || Number(lastLine.unitPrice) <= 0) {
                errors.unitPrice = 'Unit Price is required before adding a new line';
            }

            // Check if last line has UoM
            if (!String(lastLine.uomCode || '').trim()) {
                errors.uomCode = 'UoM is required before adding a new line';
            }

            // Check if last line has HSN Code
            if (!String(lastLine.hsnCode || '').trim()) {
                errors.hsnCode = 'HSN Code is required before adding a new line';
            }

            // Check if last line has Tax Code
            if (!String(lastLine.taxCode || '').trim()) {
                errors.taxCode = 'Tax Code is required before adding a new line';
            }

            // Check if last line has Warehouse
            if (!String(lastLine.whse || '').trim()) {
                errors.whse = 'Warehouse is required before adding a new line';
            }

            // If there are errors, show them and don't add new line
            if (Object.keys(errors).length > 0) {
                setValErrors(p => ({
                    ...p,
                    lines: { ...p.lines, [lastIndex]: errors },
                    form: 'Please complete the current line before adding a new one.'
                }));
                setPageState(p => ({
                    ...p,
                    error: 'Please complete the current line before adding a new one.'
                }));
                return;
            }
        }

        // Clear errors and add new line with current header values
        setValErrors(p => ({ ...p, form: '' }));
        setPageState(p => ({ ...p, error: '' }));
        setLines(p => [...p, {
            ...createLine(rowUdfDefinitions),
            branch: header.branch || '',
            loc: resolveLineLocation(header.warehouse, header.branch),
            whse: header.warehouse || ''
        }]);
    };

    const removeLine = (i) => {
        setValErrors(p => { const nl = { ...p.lines }; delete nl[i]; return { ...p, lines: nl, form: '' }; });
        setLines(p => p.filter((_, idx) => idx !== i));
    };

    const handleHeaderUdfChange = useCallback((k, v) => {
        markDirty();
        setHeaderUdfs(p => {
            if (k === billToPartyCodeKey && !String(v || '').trim()) {
                return applyChangedUdfPatch(p, buildBillToPartyUdfPatch(billToPartyUdfFields, {
                    code: '',
                    name: '',
                    address: null,
                }));
            }

            if (k === toVendorCodeKey && !String(v || '').trim()) {
                defaultToVendorAppliedRef.current = '';
                return applyChangedUdfPatch(p, buildToVendorUdfPatch(toVendorUdfFields, {
                    code: '',
                    name: '',
                    address: null,
                    contactId: '',
                }));
            }

            return String(p?.[k] ?? '') === String(v ?? '') ? p : { ...p, [k]: v };
        });
    }, [billToPartyCodeKey, billToPartyUdfFields, markDirty, toVendorCodeKey, toVendorUdfFields]);
    const handleRowUdfChange = (i, k, v) => setLines(p => p.map((l, idx) => idx === i ? { ...l, udf: { ...(l.udf || {}), [k]: v } } : l));
    const updateFormSetting = useCallback((g, k, prop, val) => setFormSettings(p => {
        const currentValue = p?.[g]?.[k]?.[prop];
        if (currentValue === val) return p;
        return { ...p, [g]: { ...(p[g] || {}), [k]: { ...((p[g] || {})[k] || {}), [prop]: val } } };
    }), [setFormSettings]);
    const loadHeaderBillToPartyDetails = useCallback(
        (partyCode) => fetchSalesOrderCustomerDetails(partyCode).then((response) => response.data),
        [],
    );
    const loadHeaderToVendorDetails = useCallback(
        (vendorCode) => fetchSalesOrderVendorDetails(vendorCode).then((response) => response.data),
        [],
    );
    const toggleHeaderUdfs = () => {
        setFormSettingsOpen(false);
        setSidebarOpen(p => !p);
    };
    const toggleFormSettings = () => {
        setSidebarOpen(false);
        setFormSettingsOpen(p => !p);
    };

    // â”€â”€ Address Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const openAddressModal = (type) => {
        const shipAddress = resolveSalesOrderAddress(
            header.shipToCode,
            vendorEffectiveShipToAddresses,
            header.shipToAddress || header.shipTo,
        );
        const billAddress = resolveSalesOrderAddress(
            header.billToCode || header.payToCode,
            vendorEffectiveBillToAddresses,
            header.billToAddress || header.payTo,
        );
        const activeAddress = type === 'billTo' ? billAddress : shipAddress;

        setAddressForm(
            mapAddressToModalForm(activeAddress, {
                shipToCode: header.shipToCode || shipAddress?.Address || '',
                shipToAddress: header.shipToAddress || header.shipTo || (shipAddress ? fmtAddr(shipAddress) : ''),
                billToCode: header.billToCode || header.payToCode || billAddress?.Address || '',
                billToAddress: header.billToAddress || header.payTo || (billAddress ? fmtAddr(billAddress) : ''),
            }),
        );
        setAddressModal({ type });
    };

    const closeAddressModal = () => {
        setAddressModal(null);
    };

    const saveAddressModal = () => {
        const formatted = [
            [addressForm.streetPoBox, addressForm.streetNo].filter(Boolean).join(', '),
            addressForm.buildingFloorRoom,
            [addressForm.block, addressForm.city].filter(Boolean).join(', '),
            [addressForm.county, addressForm.state, addressForm.zipCode].filter(Boolean).join(', '),
            addressForm.countryRegion,
            addressForm.addressName2,
            addressForm.addressName3,
        ].filter(Boolean).join('\n');

        if (addressModal.type === 'shipTo') {
            setHeader(p => ({
                ...p,
                shipToCode: addressForm.shipToCode || p.shipToCode,
                shipToAddress: formatted || addressForm.shipToAddress,
                shipTo: formatted || addressForm.shipToAddress,
                billToCode: addressForm.billToCode || p.billToCode,
                payToCode: addressForm.billToCode || p.payToCode,
                billToAddress: addressForm.billToAddress || p.billToAddress,
                payTo: addressForm.billToAddress || p.payTo,
                placeOfSupply: addressForm.state || p.placeOfSupply,
            }));
        } else {
            setHeader(p => ({
                ...p,
                shipToCode: addressForm.shipToCode || p.shipToCode,
                shipToAddress: addressForm.shipToAddress || p.shipToAddress,
                shipTo: addressForm.shipToAddress || p.shipTo,
                billToCode: addressForm.billToCode || p.billToCode,
                payToCode: addressForm.billToCode || p.payToCode,
                billToAddress: formatted || addressForm.billToAddress,
                payTo: formatted || addressForm.billToAddress,
                placeOfSupply: header.useBillToForTax ? addressForm.state || p.placeOfSupply : p.placeOfSupply,
            }));
        }
        closeAddressModal();
    };

    const handleAddressFormChange = (e) => {
        const { name, value } = e.target;
        setAddressForm(p => ({ ...p, [name]: value }));
    };

    // â”€â”€ E-Way Bill Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const openEWayBillModal = () => {
        setEWayBillModal(true);
    };

    const closeEWayBillModal = () => {
        setEWayBillModal(false);
    };

    const saveEWayBillModal = (data) => {
        setEWayBillData(data);
        console.log('E-Way Bill Data saved:', data);
    };

    // â”€â”€ Tax Info Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const openTaxInfoModal = () => {
        setTaxInfoModal(true);
    };

    const closeTaxInfoModal = () => {
        setTaxInfoModal(false);
    };

    const saveTaxInfoModal = () => {
        closeTaxInfoModal();
    };

    const handleTaxInfoFormChange = (e) => {
        const { name, value } = e.target;
        setTaxInfoForm(p => ({ ...p, [name]: value }));
    };

    // â”€â”€ State Selection Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const openStateModal = () => {
        setStateModal(true);
    };

    const closeStateModal = () => {
        setStateModal(false);
    };

    const handleStateSelect = (state) => {
        setHeader(p => ({ ...p, placeOfSupply: getStateCodeValue(state, refData.states) }));
    };

    // â”€â”€ Business Partner Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const openBpModal = () => {
        setBpModal(true);
    };

    const closeBpModal = () => {
        setBpModal(false);
    };

    const handleBpSelect = (bp) => {
        const code = bp.CardCode;
        setHeader(prev => {
            const prep = { ...prev, vendor: code };
            const { nextHeader } = syncVendor(code, prep);
            nextHeader.contactPerson = '';
            // Reset address fields when vendor changes
            nextHeader.billToCode = '';
            nextHeader.billToAddress = '';
            nextHeader.shipToCode = '';
            nextHeader.shipToAddress = '';
            nextHeader.placeOfSupply = '';
            return nextHeader;
        });
        loadVendorDetails(code);
    };

    // â”€â”€ HSN Code Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const openHSNModal = (lineIndex) => {
        setHsnModal({ open: true, lineIndex });
    };

    const closeHSNModal = () => {
        setHsnModal({ open: false, lineIndex: -1 });
    };

    const handleHSNSelect = (hsn) => {
        if (hsnModal.lineIndex >= 0) {
            setLines(prev => prev.map((line, idx) => {
                if (idx === hsnModal.lineIndex) {
                    return { ...line, hsnCode: hsn.code || '' };
                }
                return line;
            }));
        }
    };

    // â”€â”€ Item Selection Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const closeItemModal = () => {
        setItemModal({ open: false, lineIndex: -1, items: [], loading: false });
    };

    const openItemModalSafe = async (lineIndex) => {
        const fallbackItems = Array.isArray(refData.items) ? refData.items : [];

        setItemModal({
            open: true,
            lineIndex,
            items: fallbackItems,
            loading: fallbackItems.length === 0
        });

        try {
            const selectedWarehouse = lines[lineIndex]?.whse || header.warehouse || '';
            const response = await fetchItemsForModal(selectedWarehouse);
            const payload = response?.data;
            const normalizedItems = Array.isArray(payload?.items)
                ? payload.items
                : Array.isArray(payload)
                    ? payload
                    : [];

            setItemModal((prev) => ({
                ...prev,
                items: normalizedItems.length > 0 ? normalizedItems : fallbackItems,
                loading: false,
            }));
        } catch (error) {
            console.error('Failed to load items for DC Sales Order modal:', error);
            setItemModal((prev) => ({
                ...prev,
                items: prev.items.length > 0 ? prev.items : fallbackItems,
                loading: false,
            }));
        }
    };

    const handleItemSelect = async (item) => {
        if (itemModal.lineIndex < 0) return;

        const lineIndex = itemModal.lineIndex;
        const mergedItem = mergeItemMaster(item, refData.items);

        try {
            // Fetch HSN code from database
            const hsnResponse = await fetchHSNCodeFromItem(mergedItem.ItemCode);
            const hsnData = hsnResponse.data;

            setLines(prev => prev.map((line, idx) => {
                if (idx !== lineIndex) return line;

                const next = hydrateDocumentLineFromItem(line, mergedItem, {
                    side: 'sales',
                    hsnCode: hsnData.hsnCode || hsnData.hsn_sww || '',
                    fallbackWarehouse: header.warehouse,
                    resolveLineLocation,
                    headerBranch: header.branch,
                    calcLineTotal,
                    formatTotal: (value) => fmtDec(value, numDec.total),
                });

                // Auto-determine tax code
                const gstState = header.placeOfSupply;
                const companyState = refData.company_address?.State || selectedBranch?.State || '';

                if (gstState && companyState) {
                    const determinedTaxCode = determineTaxCode(
                        mergedItem,
                        gstState,
                        gstState,
                        false,
                        companyState,
                        effectiveTaxCodes
                    );

                    if (determinedTaxCode) {
                        next.taxCode = determinedTaxCode;
                        next.stcode = next.stcode || '';
                    }
                }

                if (!next.stcode) {
                    next.stcode = next.stcode || '';
                }

                next.total = fmtDec(calcLineTotal(next), numDec.total);
                return next;
            }));

            closeItemModal();
        } catch (error) {
            console.error('Error selecting item:', error);
            // Still set basic item info even if HSN fetch fails
            setLines(prev => prev.map((line, idx) => {
                if (idx !== lineIndex) return line;
                return {
                    ...line,
                    ...hydrateDocumentLineFromItem(line, mergedItem, {
                        side: 'sales',
                        fallbackWarehouse: header.warehouse,
                        resolveLineLocation,
                        headerBranch: header.branch,
                        calcLineTotal,
                        formatTotal: (value) => fmtDec(value, numDec.total),
                    }),
                };
            }));
            closeItemModal();
        }
    };

    // â”€â”€ Freight Selection Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const openFreightModal = async () => {
        console.log('ðŸšš Opening freight modal, docEntry:', currentDocEntry);
        if (freightModal.freightCharges.length > 0) {
            setFreightModal(prev => ({ ...prev, open: true, loading: false }));
            return;
        }

        setFreightModal(prev => ({ ...prev, open: true, loading: true }));

        try {
            console.log('ðŸ“¡ Fetching freight charges from API...');
            const response = await fetchFreightCharges(currentDocEntry);
            console.log('âœ… Freight charges received:', response.data);
            console.log('ðŸ“Š Freight charges count:', response.data.freightCharges?.length || 0);

            setFreightModal({
                open: true,
                freightCharges: response.data.freightCharges || [],
                loading: false
            });
        } catch (error) {
            console.error('âŒ Failed to load freight charges:', error);
            console.error('Error details:', error.response?.data || error.message);
            setFreightModal({
                open: true,
                freightCharges: [],
                loading: false
            });
        }
    };

    const closeFreightModal = () => {
        setFreightModal(prev => ({ ...prev, open: false, loading: false }));
    };

    const handleFreightApply = (summary) => {
        console.log('ðŸšš Applied freight charges:', summary);
        setFreightModal(prev => ({
            ...prev,
            open: false,
            loading: false,
            freightCharges: summary.rows || [],
        }));
        setHeader(prev => ({
            ...prev,
            freight: fmtDec(summary.totalNet || 0, numDec.freight),
        }));
    };

    // â”€â”€ Copy From Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleCopyFrom = (data, docType) => {
    setSeriesRevision(value => value + 1);

        const copySource = unwrapCopyFromDocument(data);
        const baseType = BASE_TYPE[docType] || 23;
        const normHeader = normaliseDocumentHeader(copySource.header);
        const sourceHeaderUdfs = copySource.document?.header_udfs || copySource.source?.header_udfs || data?.header_udfs || {};
        const sourceFreightCharges = copySource.document?.freightCharges || copySource.source?.freightCharges || data?.freightCharges || [];

        const rawLines = copySource.lines;
        const copiedLines = rawLines.map((line, idx) => applyLineCalculatedFields({
            ...createLine(rowUdfDefinitions),
            ...normaliseDocumentLine(line, idx, copySource.docEntry, baseType, normHeader.branch),
            stcode: line.STCODE || line.STACode || line.stcode || '',
            documentCreated: line.DocumentCreated || line.documentCreated || copySource.header.DocumentCreated || normHeader.documentCreated || '',
            loc: line.loc || resolveLineLocation(line.WarehouseCode || line.WhsCode || line.whse || '', normHeader.branch),
        }));
        const firstLineWarehouse = copiedLines.find(line => String(line.whse || '').trim())?.whse || '';

        setHeader(prev => ({
            ...prev,
            ...normHeader,
            warehouse: normHeader.warehouse || firstLineWarehouse || prev.warehouse || '',
        }));
        setLines(copiedLines.length > 0 ? copiedLines : [createLine(rowUdfDefinitions)]);
        setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, sourceHeaderUdfs));
        setFreightModal({ open: false, freightCharges: Array.isArray(sourceFreightCharges) ? sourceFreightCharges : [], loading: false });

        if (normHeader.vendor) loadVendorDetails(normHeader.vendor);

        setCopyFromModal(false);
        setCopyFromMode(false);
    };

    // â”€â”€ Copy From Modal Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useEffect(() => {
        const routedCopyFrom = location.state?.copyFrom;
        if (routedCopyFrom && !isRouteStateForActiveCompany(location.state)) {
            replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
            return;
        }

        const persistedCopyState = routedCopyFrom ? null : consumeCopyToState(location.pathname, ['/dc-sales-order']);
        const copyFrom = routedCopyFrom || persistedCopyState?.copyFrom;

        if (!copyFrom || copyFrom.type !== 'salesQuotation') return;

        const copyFromKey = JSON.stringify({
            path: location.pathname,
            type: copyFrom.type,
            docEntry: copyFrom.docEntry,
            lineCount: Array.isArray(copyFrom.lines) ? copyFrom.lines.length : 0,
        });

        if (handledCopyFromRef.current === copyFromKey) {
            return;
        }

        handledCopyFromRef.current = copyFromKey;
        setCurrentDocEntry(null);
        setSnapshotPending(false);
        setIsDirty(false);
        setValErrors({ header: {}, lines: {}, form: '' });
        setFreightModal({ open: false, freightCharges: [], loading: false });
        handleCopyFrom({
            ...(copyFrom.header || {}),
            header: copyFrom.header || {},
            freightCharges: copyFrom.freightCharges || [],
            header_udfs: copyFrom.headerUdfs || copyFrom.header_udfs || {},
            DocumentLines: copyFrom.lines || [],
            DocEntry: copyFrom.docEntry,
        }, copyFrom.type);

        const sourceLabel = copyFrom.sourceLabel || 'Sales Quotation';
        setPageState(p => ({ ...p, error: '', success: `Copied from ${sourceLabel}. Please review and save.` }));
        replaceRouteStatePreservingWindow(navigate, location.pathname, location.state || persistedCopyState);
    }, [location.pathname, location.state?.copyFrom, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

    const openCopyFromModal = (docType) => {
        if (currentDocEntry) return;

        console.log('ðŸŸ¢ Copy From Clicked');

        // âœ… ONLY BUYER VALIDATION
        const buyerCode = String(header.vendor || '').trim();

        if (!buyerCode) {
            setValErrors({
                header: { vendor: 'Select Buyer first' },
                lines: {},
                form: ''
            });
            return;
        }

        // âœ… ENABLE COPY MODE
        setCopyFromMode(true);

        // âœ… CLEAR ALL ERRORS
        setValErrors({ header: {}, lines: {}, form: '' });
        setPageState(p => ({ ...p, error: '', success: '' }));

        setCopyFromDocType(docType);
        setCopyFromModal(true);
    };
    const fetchCopyFromDocuments = async (docType) => {
        try {
            const buyerCode = String(header.vendor || '').trim();
            if (!buyerCode) return [];
            return await dcSalesOrderCopyFromApi.fetchOpenDocuments(docType, buyerCode);
        } catch (error) {
            console.error('Error fetching documents:', error);
            throw error;
        }
    };

    const fetchCopyFromDocumentDetails = async (docType, docEntry) => {
        try {
            return await dcSalesOrderCopyFromApi.fetchDocumentForCopy(docType, docEntry);
        } catch (error) {
            console.error('Error fetching document details:', error);
            throw error;
        }
    };

    // â”€â”€ Copy To Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleCopyTo = async (targetType) => {
        await copyToDocument({
            sourceDocType: 'dcSalesOrder',
            targetType,
            sourceDocEntry: currentDocEntry,
            sourceDocNo: header.docNo,
            sourcePath: '/dc-sales-order',
            sourceSnapshot: { header, lines, headerUdfs, freightCharges: freightModal.freightCharges },
            restoreState: { dcSalesOrderDocEntry: currentDocEntry },
            navigate,
            upsertTask,
            removeTask,
            beforeNavigate: closeDocumentDropdowns,
            setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
            errorMessage: pageState.loading
                ? 'Please wait until the DC sales order has finished loading before using Copy To.'
                : 'Open a saved DC sales order before using Copy To.',
        });
    };

    const handleDuplicate = () => {
    setSeriesRevision(value => value + 1);

        const duplicated = duplicateDocumentInPlace({
            currentDocEntry,
            header,
            initialHeader: createInitialHeader(generalSettingsRef.current),
            lines,
            createLine,
            rowUdfDefinitions,
            setCurrentDocEntry,
            setHeader,
            setLines,
            setActiveTab,
            setValErrors,
            setPageState,
            setSnapshotPending,
            setIsDirty,
            setFreightModal,
            navigate,
            location,
            successMessage: 'DC sales order duplicated. Review and add it as a new entry.',
        });

        if (duplicated) {
            refreshDuplicateSeries(refData.series, '', handleSeriesChange);
        }
    };

    // â”€â”€ Browse Attachment handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const handleBrowseAttachment = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (e) => {
            const files = Array.from(e.target.files);
            alert(`Selected ${files.length} file(s). Upload functionality to be implemented.`);
        };
        input.click();
    };

    // Continue in next part...

    // â”€â”€ validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const validate = () => {
        // ðŸš¨ GLOBAL BYPASS FOR COPY MODE
        if (copyFromMode) {
            console.log('ðŸš« Validation skipped (Copy Mode)');
            return { header: {}, lines: {}, form: '' };
        }

        const isUpdate = !!currentDocEntry;
        const e = { header: {}, lines: {}, form: '' };

        if (!isUpdate) {
            const vc = String(header.vendor || '').trim();
            if (!vc) { e.header.vendor = 'Select a customer.'; e.form = 'Please correct the highlighted fields.'; return e; }

            // Validate Ship-To address (required for GST determination)
            if (!String(header.shipToCode || '').trim()) {
                e.header.shipToCode = 'Ship-To address is required.';
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            // Validate Bill-To address if GST override is enabled
            if (header.useBillToForTax && !String(header.billToCode || '').trim()) {
                e.header.billToCode = 'Bill-To address is required when using Bill-To for tax.';
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

        }

        // Validate Warehouse (always required)
        if (!String(header.warehouse || '').trim()) {
            e.header.warehouse = 'Warehouse is required.';
            e.form = 'Please correct the highlighted fields.';
            return e;
        }



        if (!String(header.postingDate || '').trim()) { e.header.postingDate = 'Posting date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
        if (!String(header.documentDate || '').trim()) { e.header.documentDate = 'Document date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }

        const pop = lines.filter(l => String(l.itemNo || '').trim());
        if (!pop.length) { e.form = 'Add at least one item line.'; return e; }

        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (!String(l.itemNo || '').trim()) continue;

            if (!l.itemNo) {
                e.lines[i] = { ...(e.lines[i] || {}), itemNo: 'Item is required' };
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            if (!l.quantity || Number(l.quantity) <= 0) {
                e.lines[i] = { ...(e.lines[i] || {}), quantity: 'Quantity must be > 0' };
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            if (!l.hsnCode && !isUpdate) {
                e.lines[i] = { ...(e.lines[i] || {}), hsnCode: 'HSN Code is required' };
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            if ((!l.unitPrice || Number(l.unitPrice) <= 0) && !isUpdate) {
                e.lines[i] = { ...(e.lines[i] || {}), unitPrice: 'Unit Price must be > 0' };
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            if (!l.uomCode && !isUpdate) {
                e.lines[i] = { ...(e.lines[i] || {}), uomCode: 'UoM is required' };
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            if (!l.whse && !isUpdate) {
                e.lines[i] = { ...(e.lines[i] || {}), whse: 'Warehouse is required' };
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            if (!l.taxCode || !String(l.taxCode).trim()) {
                e.lines[i] = { ...(e.lines[i] || {}), taxCode: 'Tax Code is required' };
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            const taxCodeExists = effectiveTaxCodes.some(t => String(t.Code) === String(l.taxCode));
            if (!taxCodeExists) {
                e.lines[i] = { ...(e.lines[i] || {}), taxCode: `Tax code '${l.taxCode}' is not valid in SAP B1` };
                e.form = 'Please correct the highlighted fields.';
                return e;
            }

            const taxCodesUsed = new Set(pop.map(l => l.taxCode).filter(Boolean));
            const sgstCodes = getTaxComponentCodes(taxCodesUsed, effectiveTaxCodes, 'SGST');
            const cgstCodes = getTaxComponentCodes(taxCodesUsed, effectiveTaxCodes, 'CGST');

            if (sgstCodes.length > 0 && cgstCodes.length === 0) {
                e.form = 'SGST requires CGST to be applied as well';
                return e;
            }
            if (cgstCodes.length > 0 && sgstCodes.length === 0) {
                e.form = 'CGST requires SGST to be applied as well';
                return e;
            }
            if (sgstCodes.length > 0 && cgstCodes.length > 0) {
                const sgstRates = sgstCodes.map(code => {
                    const tax = findTaxCode(effectiveTaxCodes, code);
                    return tax ? parseNum(tax.Rate) : 0;
                });
                const cgstRates = cgstCodes.map(code => {
                    const tax = findTaxCode(effectiveTaxCodes, code);
                    return tax ? parseNum(tax.Rate) : 0;
                });
                if (sgstRates[0] !== cgstRates[0]) {
                    e.form = 'SGST and CGST rates must be equal';
                    return e;
                }
            }
        }

        return e;
    };

    // â”€â”€ submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
      docEntry: currentDocEntry, isDirty,
      state: { header, lines, headerUdfs, freightCharges: freightModal.freightCharges , company_id: activeCompanyId },
    });

    const handleSubmit = async (ev) => {
        ev.preventDefault();
        if (!isDocumentEditable) {
            setPageState(p => ({ ...p, error: 'This document is closed and cannot be edited.', success: '' }));
            return;
        }
        if (currentDocEntry && !hasUnsavedChanges) return;
        if (copyFromMode) {
            console.log('âš ï¸ Submit blocked in Copy Mode');
            return;
        }
        ev.preventDefault();

        // ðŸš¨ Don't submit if in copy mode
        if (copyFromMode) {
            console.log('âš ï¸ Form submission blocked - Copy From mode is active');
            return;
        }

        const e = validate();
        if (e.form || Object.values(e.header).some(Boolean) || Object.values(e.lines).some(le => Object.values(le || {}).some(Boolean))) {
            setValErrors(e);
            setPageState(p => ({ ...p, error: e.form || 'Please correct the highlighted fields.', success: '' }));
            return;
        }
        setValErrors({ header: {}, lines: {}, form: '' });
        setPageState(p => ({ ...p, posting: true, error: '', success: '' }));
        try {
            const prep = {
                ...header,
                customerRefNo: header.customerRefNo || header.salesContractNo || '',
                deliveryDate: header.deliveryDate || header.postingDate || header.documentDate,
                placeOfSupply: header.placeOfSupply,
                branch: header.branch,
                contactPerson: header.contactPerson,
                series: header.series ? Number(header.series) : undefined,
            };

            // Clean lines - remove any readonly/computed fields
            const cleanedLines = lines.map(line => {
                const lineWithCalculatedFields = applyLineCalculatedFields(line);

                return ({
                lineNum: line.lineNum,
                itemServiceType: line.itemServiceType,
                itemNo: line.itemNo,
                itemDescription: line.itemDescription,
                sellerQuality: line.sellerQuality,
                buyerQuality: line.buyerQuality,
                hsnCode: line.hsnCode,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                sellerPrice: line.sellerPrice,
                buyerPrice: line.buyerPrice,
                sellerDelivery: line.sellerDelivery,
                buyerDelivery: line.buyerDelivery,
                sellerBrokerageAmtPer: line.sellerBrokerageAmtPer,
                sellerBrokeragePercent: line.sellerBrokeragePercent,
                sellerBrokerage: lineWithCalculatedFields.sellerBrokerage,
                buyerBrokerage: line.buyerBrokerage,
                specialRebate: line.specialRebate,
                commission: line.commission,
                sellerBrokeragePerQty: line.sellerBrokeragePerQty,
                unitPriceUdf: line.unitPriceUdf,
                qtySpecialInstruction: line.qtySpecialInstruction,
                deliverySpecialInstruction: line.deliverySpecialInstruction,
                buyerPaymentTerms: line.buyerPaymentTerms,
                sellerPaymentTerms: line.sellerPaymentTerms,
                buyerSpecialInstruction: line.buyerSpecialInstruction,
                sellerSpecialInstruction: line.sellerSpecialInstruction,
                buyerBillDiscount: line.buyerBillDiscount,
                sellerBillDiscount: line.sellerBillDiscount,
                sellerItem: line.sellerItem,
                sellerQty: line.sellerQty,
                freightPurchase: line.freightPurchase,
                freightSales: line.freightSales,
                freightProvider: line.freightProvider,
                freightProviderName: line.freightProviderName,
                brokerageNumber: line.brokerageNumber,
                uomCode: line.uomCode,
                discountAmount: lineWithCalculatedFields.discountAmount,
                stdDiscount: lineWithCalculatedFields.stdDiscount,
                stcode: line.stcode,
                taxCode: line.taxCode,
                total: lineWithCalculatedFields.total,
                whse: line.whse,
                distRule: line.distRule,
                freeText: line.freeText,
                countryOfOrigin: line.countryOfOrigin,
                sacCode: line.sacCode,
                loc: line.loc,
                branch: line.branch,
                baseEntry: line.baseEntry,
                baseType: line.baseType,
                baseLine: line.baseLine,
                udf: buildVisibleEnteredRowUdfPayload(rowUdfDefinitions, line.udf || {}, formSettings),
            });
            });

            const payload = {
                company_id: activeCompanyId,
                header: prep,
                lines: cleanedLines,
                freightCharges: freightModal.freightCharges,
                header_udfs: normalizeUdfState(headerUdfDefinitions, headerUdfs),
            };

            // â•â•â• LOGGING: Payload Before Submit â•â•â•
            console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
            console.log('ðŸ“¤ SUBMITTING SALES ORDER:');
            console.log('Header:', prep);
            console.log('Lines:', cleanedLines);
            console.log('Header UDFs:', headerUdfs);
            console.log('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');

            const r = currentDocEntry ? await updateSalesOrder(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitSalesOrder(payload);
            const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
            const resetHeader = createInitialHeader(generalSettingsRef.current);
            setSnapshotPending(false);
            setIsDirty(false);
            setCurrentDocEntry(null); setHeader(resetHeader); setLines([createLine(rowUdfDefinitions)]);
            setFreightModal({ open: false, freightCharges: [], loading: false });
            defaultToVendorAppliedRef.current = '';
            setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
            setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [] }));
            setValErrors({ header: {}, lines: {}, form: '' });

            const defaultSeries = resolvePreferredSeries(refData.series, resetHeader.postingDate);
            if (defaultSeries?.Series != null) {
                handleSeriesChange(defaultSeries.Series);
            }

            setPageState(p => ({ ...p, success: `${r.data.message || 'DC sales order saved.'}${dn}` }));
        } catch (e) {
            console.error('âŒ DC Sales Order Submission Error:', e);
            console.error('Error Response:', e.response?.data);
            setPageState(p => ({ ...p, error: getErrMsg(e, 'Sales order submission failed.') }));
        } finally {
            setPageState(p => ({ ...p, posting: false }));
        }
    };

    const resetForm = () => {
    setSeriesRevision(value => value + 1);

        const resetHeader = createInitialHeader(generalSettingsRef.current);
        setSnapshotPending(false);
        setIsDirty(false);
        setCurrentDocEntry(null); setHeader(resetHeader); setLines([createLine(rowUdfDefinitions)]);
        setFreightModal({ open: false, freightCharges: [], loading: false });
        defaultToVendorAppliedRef.current = '';
        setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
        setValErrors({ header: {}, lines: {}, form: '' });
        setPageState(p => ({ ...p, error: '', success: '' }));

        const defaultSeries = resolvePreferredSeries(refData.series, resetHeader.postingDate);
        if (defaultSeries?.Series != null) {
            handleSeriesChange(defaultSeries.Series);
        }
    };

    const openFindPage = () => {
        navigate('/dc-sales-order/find', { state: null });
    };

    const visHdrUdfs = headerUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
    const visibleRowUdfs = rowUdfDefinitions.filter(f => formSettings.rowUdfs?.[f.key]?.visible !== false);
    const isRightSidebarOpen = sidebarOpen || formSettingsOpen;

    useEffect(() => {
        const handleShortcut = (event) => {
            if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return;
            if (pageState.posting || !isDocumentEditable) return;

            const key = String(event.key || '').toLowerCase();
            const shouldSubmit = (!isUpdateMode && key === 'a') || (isUpdateMode && key === 'u');
            if (!shouldSubmit) return;

            event.preventDefault();
            formRef.current?.requestSubmit();
        };

        window.addEventListener('keydown', handleShortcut);
        return () => window.removeEventListener('keydown', handleShortcut);
    }, [isDocumentEditable, isUpdateMode, pageState.posting]);

    // Continue in next part with render...

    // â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    useDocumentSeries({ endpoint: '/dc-sales-order', companyKey: String(activeCompanyId), currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
        <form ref={formRef} className={`so-page sap-document-page${isRightSidebarOpen ? ' so-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>

            {/* toolbar */}
            <div className="so-toolbar sap-document-toolbar">
                <span className="so-toolbar__title">DC Sales Order{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
                <button type="submit" className="so-btn so-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || !isDocumentEditable} title={primaryActionLabel}>
                    {primaryActionLabel}
                </button>
                <button type="button" className="so-btn sap-document-toolbar__cancel" onClick={resetForm}>
                    Cancel
                </button>
                <button type="button" className="so-btn sap-document-toolbar__udf" onClick={toggleHeaderUdfs}>
                    {sidebarOpen ? 'Hide UDFs' : 'Show UDFs'}
                </button>
                <button type="button" className="so-btn sap-document-toolbar__settings" onClick={toggleFormSettings}>
                    Form Settings
                </button>
                <PrintSalesOrderActions
                    docEntry={currentDocEntry}
                    docNumber={header.docNo}
                    series={header.series}
                    cardCode={header.vendor}
                    disabled={pageState.posting}
                    onSuccess={(message) => setPageState(p => ({ ...p, error: '', success: message }))}
                    onError={(message) => setPageState(p => ({ ...p, success: '', error: message }))}
                />

                {/* Copy From Dropdown */}
                <div className="so-dropdown">
                    <button
                        type="button"
                        className="so-btn"
                        disabled={!isDocumentEditable || !!currentDocEntry || !hasBuyerCode}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (currentDocEntry || !hasBuyerCode) return;

                            console.log('ðŸ”µ Copy From dropdown clicked');

                            setIsCopyFromClick(true);   // ðŸš€ ADD THIS
                            // // âœ… FIRST: Activate copy mode to disable all validation
                            // setCopyFromMode(true);

                            // âœ… SECOND: Clear all validation errors immediately
                            setValErrors({ header: {}, lines: {}, form: '' });
                            setPageState({ error: '', success: '', loading: false, posting: false, vendorLoading: false, seriesLoading: false });

                            // âœ… THIRD: Force re-render by toggling dropdown
                            const dropdown = e.currentTarget.parentElement;
                            const isActive = dropdown.classList.contains('active');
                            // Close all other dropdowns
                            document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
                            if (!isActive) {
                                dropdown.classList.add('active');
                            }
                        }}
                        style={{ opacity: (!isDocumentEditable || !!currentDocEntry || !hasBuyerCode) ? 0.5 : 1 }}
                    >
                        Copy From ▼
                    </button>
                    <div className="so-dropdown-menu">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();

                                console.log('ðŸ“‹ Sales Quotations clicked');

                                // Clear everything before opening modal
                                // setCopyFromMode(true);
                                setValErrors({ header: {}, lines: {}, form: '' });
                                setPageState({ error: '', success: '', loading: false, posting: false, vendorLoading: false, seriesLoading: false });

                                // Small delay to ensure state is updated
                                setTimeout(() => {
                                    openCopyFromModal('quotation');
                                    document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
                                }, 10);
                            }}
                        >
                            Sales Quotations
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();

                                console.log('ðŸ“‹ Blanket Agreements clicked');

                                // Clear everything before opening modal
                                // setCopyFromMode(true);
                                setValErrors({ header: {}, lines: {}, form: '' });
                                setPageState({ error: '', success: '', loading: false, posting: false, vendorLoading: false, seriesLoading: false });

                                // Small delay to ensure state is updated
                                setTimeout(() => {
                                    openCopyFromModal('blanket');
                                    document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
                                }, 10);
                            }}
                        >
                            Blanket Agreements
                        </button>
                    </div>
                </div>
                <div className="so-dropdown">
                    <button
                        type="button"
                        className="so-btn"
                        disabled={!currentDocEntry}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!currentDocEntry) return;
                            const dropdown = e.currentTarget.parentElement;
                            const isActive = dropdown.classList.contains('active');
                            document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
                            if (!isActive) dropdown.classList.add('active');
                        }}
                        style={{ opacity: !currentDocEntry ? 0.5 : 1 }}
                    >
                        Copy To ▼
                    </button>
                    <div className="so-dropdown-menu">
                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyTo('delivery'); document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active')); }}>
                            DC Delivery
                        </button>
                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyTo('ar-invoice'); document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active')); }}>
                            A/R Invoice
                        </button>
                    </div>
                </div>
                {currentDocEntry && (
                    <button type="button" className="so-btn sap-document-toolbar__duplicate" onClick={handleDuplicate}>
                        Duplicate
                    </button>
                )}

                <button type="button" className="so-btn sap-document-toolbar__find" onClick={openFindPage}>Find</button>
                <button type="button" className="so-btn sap-document-toolbar__new" onClick={resetForm}>New</button>
            </div>

            {/* alerts */}
            {pageState.loading && <div className="so-alert so-alert--success" style={{ marginTop: 0 }}>Loading...</div>}
            {!copyFromMode && pageState.error && <div className="so-alert so-alert--error">{pageState.error}</div>}
            {pageState.success && <div className="so-alert so-alert--success">{pageState.success}</div>}
            {refData.warnings?.length > 0 && (
                <div className="so-alert so-alert--warning">
                    <strong>SAP warnings:</strong>
                    {refData.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    <div style={{ marginTop: 4, color: '#555' }}>Dropdowns are showing fallback values. Connect to SAP to load live data.</div>
                    <div style={{ marginTop: 4, color: '#d00', fontWeight: 600 }}>âš ï¸ Tax codes shown are examples only. Use actual SAP tax codes to avoid submission errors.</div>
                </div>
            )}

            <fieldset ref={documentBodyRef} className="so-fieldset" aria-disabled={!isDocumentEditable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <div className={`so-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`}>
                <div className="so-layout__main">

                        {/* â•â• HEADER CARD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                        <div className="so-header-card">
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
                                {/* LEFT COLUMN */}
                                <div style={{ flex: '1 1 45%', minWidth: '300px', maxWidth: '100%' }}>
                                    <div className="so-field-grid" style={{ gridTemplateColumns: '1fr' }}>

                                        {/* Buyer's Code */}
                                        <div className="so-field">
                                            <label className="so-field__label">Buyer's Code *</label>
                                            <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
                                                <input
                                                    name="vendor"
                                                    className={`so-field__input${valErrors.header.vendor ? ' so-field__input--error' : ''}`}
                                                    value={header.vendor}
                                                    onChange={handleHeaderChange}
                                                    disabled={!!currentDocEntry}
                                                    placeholder="Customer code"
                                                    style={{ flex: 1 }}
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-sm"
                                                    onClick={openBpModal}
                                                    disabled={!!currentDocEntry}
                                                    style={{
                                                        padding: '0 8px',
                                                        fontSize: 11,
                                                        border: '1px solid #a0aab4',
                                                        background: 'linear-gradient(180deg, #fff 0%, #e8ecf0 100%)',
                                                        minWidth: '28px'
                                                    }}
                                                    title="Select Business Partner"
                                                >
                                                    ...
                                                </button>
                                            </div>
                                        </div>

                                        {/* Buyer's Name */}
                                        <div className="so-field">
                                            <label className="so-field__label">Buyer's Name</label>
                                            <input name="name" className="so-field__input" value={header.name} readOnly />
                                        </div>

                                        <fieldset
                                            className="so-fieldset"
                                            disabled={!hasBuyerCode}
                                            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
                                        >
                                        {/* Contact Person */}
                                        <div className="so-field">
                                            <label className="so-field__label">Contact Person</label>
                                            <select
                                                name="contactPerson"
                                                className="so-field__select"
                                                value={header.contactPerson || ''}
                                                onChange={handleHeaderChange}
                                                disabled={pageState.vendorLoading || !header.vendor || !!currentDocEntry}
                                            >
                                                <option value="">Select</option>
                                                {contactOptions.map(c => (
                                                    <option key={c.CntctCode} value={c.CntctCode}>
                                                        {c.Name || `${c.FirstName || ''} ${c.LastName || ''}`}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <DocumentCurrencySelect
                                            classPrefix="so"
                                            header={header}
                                            onHeaderChange={handleHeaderChange}
                                            businessPartners={refData.vendors || []}
                                            localCurrency={refData.local_currency || 'INR'}
                                            systemCurrency={refData.system_currency || refData.local_currency || 'INR'}
                                            disabled={pageState.vendorLoading || !header.vendor || !!currentDocEntry}
                                        />

                                        {/* Place of Supply */}
                                        <div className="so-field">
                                            <label className="so-field__label">Place of Supply</label>
                                            <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
                                                <input
                                                    name="placeOfSupply"
                                                    className={`so-field__input${valErrors.header.placeOfSupply ? ' so-field__input--error' : ''}`}
                                                    value={getStateDisplayName(header.placeOfSupply, refData.states)}
                                                    onChange={handleHeaderChange}
                                                    placeholder="State code"
                                                    style={{ flex: 1 }}
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-sm"
                                                    onClick={openStateModal}
                                                    style={{
                                                        padding: '0 8px',
                                                        fontSize: 11,
                                                        border: '1px solid #a0aab4',
                                                        background: 'linear-gradient(180deg, #fff 0%, #e8ecf0 100%)',
                                                        minWidth: '28px'
                                                    }}
                                                    title="Select State"
                                                >
                                                    ...
                                                </button>
                                            </div>
                                        </div>

                                        {/* Payment Terms */}
                                        <div className="so-field">
                                            <label className="so-field__label">Payment Terms</label>
                                            <select name="paymentTerms" className="so-field__select" value={header.paymentTerms} onChange={handleHeaderChange}>
                                                <option value="">Select</option>
                                                {payTermOpts.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                        </div>

                                        {/* Branch */}
                                        <div className="so-field">
                                            <label className="so-field__label">Branch</label>
                                            <select
                                                name="branch"
                                                className="so-field__select"
                                                value={header.branch || ''}
                                                onChange={handleHeaderChange}
                                                style={{ border: (!copyFromMode && valErrors.header.branch) ? '1px solid #c00' : undefined }}
                                            >
                                                <option value="">Select Branch</option>
                                                {refData.branches.map(b => (
                                                    <option key={b.BPLId} value={b.BPLId}>
                                                        {b.BPLName}
                                                    </option>
                                                ))}
                                            </select>
                                            {!copyFromMode && valErrors.header.branch && (
                                                <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.header.branch}</div>
                                            )}
                                        </div>

                                        {/* Warehouse */}
                                        <div className="so-field">
                                            <label className="so-field__label">Warehouse *</label>
                                            <select
                                                name="warehouse"
                                                className="so-field__select"
                                                value={header.warehouse || ''}
                                                onChange={handleHeaderChange}
                                                style={{ border: (!copyFromMode && valErrors.header.warehouse) ? '1px solid #c00' : undefined }}
                                                title={header.branch ? `Showing warehouses for selected branch` : 'Select a branch first to filter warehouses'}
                                            >
                                                <option value="">Select Warehouse</option>
                                                {branchFilteredWarehouses.map(w => (
                                                    <option key={w.WhsCode} value={w.WhsCode}>
                                                        {w.WhsCode} - {w.WhsName}
                                                    </option>
                                                ))}
                                                {header.warehouse && !branchFilteredWarehouses.some(w => String(w.WhsCode || '') === String(header.warehouse || '')) && (
                                                    <option value={header.warehouse}>
                                                        {header.warehouse}
                                                        {header.warehouse === DEFAULT_WAREHOUSE_CODE ? ` - ${DEFAULT_WAREHOUSE_NAME}` : ''}
                                                    </option>
                                                )}
                                            </select>
                                            {!copyFromMode && valErrors.header.warehouse && (
                                                <div style={{ color: '#c00', fontSize: 10 }}>
                                                    {valErrors.header.warehouse}
                                                </div>
                                            )}
                                        </div>
                                        </fieldset>

                                    </div>
                                </div>

                                {/* RIGHT COLUMN */}
                                <div style={{ flex: '1 1 45%', minWidth: '300px', maxWidth: '100%' }}>
                                    <fieldset
                                        className="so-fieldset"
                                        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
                                    >
                                    <div className="so-field-grid" style={{ gridTemplateColumns: '1fr' }}>

                                        {/* Series */}
                                        <div className="so-field">
                                            <label className="so-field__label">Series</label>
                                            <select
                                                name="series"
                                                className="so-field__select"
                                                value={header.series || ''}
                                                onChange={handleHeaderChange}
                                                disabled={!!currentDocEntry || pageState.seriesLoading}
                                            >
                                                <option value="">{pageState.seriesLoading ? 'Loading series...' : pageState.seriesError ? 'Series unavailable' : 'Select Series'}</option>
                                                {getSapVisibleDocumentSeries(refData.series, {
                                                    selectedSeries: header.series, includeHistorical: Boolean(currentDocEntry),
                                                    postingDate: header.postingDate || header.documentDate,
                                                }).map(s => (
                                                    <option key={s.Series} value={s.Series}>
                                                        {s.SeriesName}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Auto Number */}
                                        <div className="so-field">
                                            <label className="so-field__label">Number</label>
                                            <input
                                                name="nextNumber"
                                                className="so-field__input"
                                                value={currentDocEntry ? (header.docNo || header.nextNumber || '') : (header.nextNumber || '')}
                                                readOnly
                                                style={{ background: '#f0f2f5' }}
                                            />
                                        </div>

                                        {/* Customer Ref. No. */}
                                        <div className="so-field">
                                            <label className="so-field__label">Customer Ref. No.</label>
                                            <input name="customerRefNo" className="so-field__input" value={header.customerRefNo || header.salesContractNo || ''} onChange={handleHeaderChange} />
                                        </div>

                                        {/* Status */}
                                        <div className="so-field">
                                            <label className="so-field__label">Status</label>
                                            <input name="status" className="so-field__input" value={header.status} readOnly style={{ background: '#f0f2f5', color: header.status === 'Open' ? '#1a7a30' : '#c00', fontWeight: 600 }} />
                                        </div>

                                        {/* Posting Date */}
                                        <div className="so-field">
                                            <label className="so-field__label">Posting Date *</label>
                                            <SapDateInput  name="postingDate" className="so-field__input" value={header.postingDate} onChange={handleHeaderChange} />
                                        </div>

                                        {/* Delivery Date */}
                                        <div className="so-field">
                                            <label className="so-field__label">Delivery Date</label>
                                            <SapDateInput  name="deliveryDate" className="so-field__input" value={header.deliveryDate} onChange={handleHeaderChange} />
                                        </div>

                                        {/* Document Date */}
                                        <div className="so-field">
                                            <label className="so-field__label">Document Date *</label>
                                            <SapDateInput
                                                
                                                name="documentDate"
                                                className="so-field__input"
                                                value={header.documentDate}
                                                onChange={handleHeaderChange}
                                                style={{ border: valErrors.header.documentDate ? '1px solid #c00' : undefined }}
                                            />
                                            {!copyFromMode && valErrors.header.documentDate && (
                                                <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.header.documentDate}</div>
                                            )}
                                        </div>

                                    </div>
                                    </fieldset>
                                </div>
                            </div>
                        </div>

                        {/* â•â• TABS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                        <fieldset
                            className="so-fieldset"
                            disabled={!hasBuyerCode}
                            style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
                        >
                        <div className="so-tabs">
                            {TAB_NAMES.map(t => (
                                <button
                                    key={t}
                                    type="button"
                                    className={`so-tab${activeTab === t ? ' so-tab--active' : ''}`}
                                    onClick={() => setActiveTab(t)}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>

                        {/* â•â• TAB CONTENT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                        {activeTab === 'Contents' && (
                            <ContentsTab
                                lines={lines}
                                onLineChange={handleLineChange}
                                onNumBlur={handleNumBlur}
                                onAddLine={addLine}
                                onRemoveLine={removeLine}
                                lineItemOptions={lineItemOptions}
                                getUomOptions={getUomOptions}
                                effectiveTaxCodes={effectiveTaxCodes}
                                effectiveWarehouses={branchFilteredWarehouses}
                                fmtTaxLabel={fmtTaxLabel}
                                valErrors={valErrors}
                                branches={refData.branches}
                                distributionRules={refData.distribution_rules || []}
                                countries={refData.countries || []}
                                onOpenHSNModal={openHSNModal}
                                onOpenSACModal={openSACModal}
                                onOpenItemModal={openItemModalSafe}
                                onOpenQualityModal={openQualityModal}
                                onOpenPaymentTermsModal={openPaymentTermsModal}
                                getBranchName={getBranchName}
                                copyFromMode={copyFromMode}
                                formSettings={formSettings}
                                rowUdfFields={visibleRowUdfs}
                                onRowUdfChange={handleRowUdfChange}
                            />
                        )}

                        {activeTab === 'Logistics' && (
                            <LogisticsTab
                                header={header}
                                onHeaderChange={handleHeaderChange}
                                vendorPayToAddresses={vendorPayToAddresses}
                                vendorShipToAddresses={vendorShipToAddresses}
                                vendorBillToAddresses={vendorBillToAddresses}
                                shipTypeOpts={shipTypeOpts}
                                onOpenAddressModal={openAddressModal}
                                onOpenEWayBillModal={openEWayBillModal}
                            />
                        )}

                        {activeTab === 'Accounting' && (
                            <AccountingTab
                                header={header}
                                onHeaderChange={handleHeaderChange}
                                payTermOpts={payTermOpts}
                            />
                        )}

                        {activeTab === 'Tax' && (
                            <TaxTab onOpenTaxInfoModal={openTaxInfoModal} />
                        )}

                        {activeTab === 'Electronic Documents' && (
                            <ElectronicDocumentsTab />
                        )}

                        {activeTab === 'Attachments' && (
                            <AttachmentsTab
                                attachments={attachments}
                                onBrowseAttachment={handleBrowseAttachment}
                            />
                        )}

                        {/* â•â• TOTALS FOOTER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                        <div className="so-header-card">
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
                                <div style={{ flex: '1 1 45%', minWidth: '300px', maxWidth: '100%' }}>
                                    <div className="so-field">
                                        <label className="so-field__label">Sales Employee</label>
                                        <select
                                            name="purchaser"
                                            className="so-field__select"
                                            value={header.purchaser || ''}
                                            onChange={handleHeaderChange}
                                            disabled={!refData.sales_employees || refData.sales_employees.length === 0}
                                        >
                                            <option value="">No Sales Employee / Buyer</option>
                                            {effectiveSalesEmployees.map(emp => (
                                                <option key={emp.SlpCode} value={emp.SlpName}>
                                                    {emp.SlpName}
                                                </option>
                                            ))}
                                            <option value="__DEFINE_NEW__">Define New</option>
                                        </select>
                                        {/* Debug info */}
                                        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
                                            {header.purchaser ? (
                                                <span>Selected: {header.purchaser} | Available: {effectiveSalesEmployees.length} employees</span>
                                            ) : (
                                                <span>No selection | Available: {effectiveSalesEmployees.length} employees</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="so-field">
                                        <label className="so-field__label">Owner</label>
                                        <select
                                            name="owner"
                                            className="so-field__select"
                                            value={header.owner || ''}
                                            onChange={handleHeaderChange}
                                            disabled={!refData.owners || refData.owners.length === 0}
                                        >
                                            <option value="">No Owner</option>
                                            {(refData.owners || []).map(owner => (
                                                <option key={owner.empID} value={owner.FullName}>
                                                    {owner.FullName}
                                                </option>
                                            ))}
                                        </select>
                                        {/* Debug info */}
                                        <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>
                                            {header.owner ? (
                                                <span>Selected: {header.owner} | Available: {(refData.owners || []).length} owners</span>
                                            ) : (
                                                <span>No selection | Available: {(refData.owners || []).length} owners</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="so-field">
                                        <label className="so-field__label">Remarks</label>
                                        <textarea className="so-textarea" rows={3} name="otherInstruction" value={header.otherInstruction || ''} onChange={handleHeaderChange} />
                                    </div>
                                </div>
                                <div style={{ flex: '1 1 45%', minWidth: '300px', maxWidth: '100%' }}>
                                    <div className="so-section-title">Tax Summary</div>
                                    {totals.taxBreakdown.length > 0 && (
                                        <div style={{ marginBottom: '12px' }}>
                                            {totals.taxBreakdown.map(t => (
                                                <div key={t.taxCode} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                                    <span>{t.taxCode} ({t.taxRate}%)</span>
                                                    <span>{fmtDec(t.taxAmount, numDec.tax)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="so-grid-wrap">
                                        <table className="so-grid" style={{ marginTop: '8px' }}>
                                            <tbody>
                                                <tr>
                                                    <td>Total Before Discount</td>
                                                    <td className="so-grid__cell--num"><input className="so-grid__input" value={fmtDec(totals.subtotal, numDec.total)} readOnly /></td>
                                                </tr>
                                                <tr>
                                                    <td>Discount %</td>
                                                    <td className="so-grid__cell--num"><input className="so-grid__input" name="discount" value={header.discount} onChange={handleHeaderChange} onBlur={() => handleNumBlur('discount', 'header')} /></td>
                                                </tr>
                                                <tr>
                                                    <td>Freight</td>
                                                    <td className="so-grid__cell--num" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <input
                                                            className="so-grid__input"
                                                            name="freight"
                                                            value={header.freight}
                                                            onChange={handleHeaderChange}
                                                            onBlur={() => handleNumBlur('freight', 'header')}
                                                            style={{ flex: 1 }}
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={openFreightModal}
                                                            style={{
                                                                padding: '2px 8px',
                                                                fontSize: '11px',
                                                                border: '1px solid #d0d7de',
                                                                borderRadius: '3px',
                                                                background: 'linear-gradient(180deg, #f6f8fa 0%, #e9ecef 100%)',
                                                                cursor: 'pointer',
                                                                minWidth: '24px'
                                                            }}
                                                            title="Select Freight Charge"
                                                        >
                                                            ...
                                                        </button>
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td>Tax</td>
                                                    <td className="so-grid__cell--num"><input className="so-grid__input" value={fmtDec(totals.taxAmt, numDec.tax)} readOnly /></td>
                                                </tr>
                                                <tr style={{ borderTop: '2px solid #a0aab4' }}>
                                                    <td style={{ fontWeight: 700, color: '#003366' }}>Total</td>
                                                    <td className="so-grid__cell--num" style={{ fontWeight: 700, color: '#003366' }}><input className="so-grid__input" style={{ fontWeight: 700, color: '#003366' }} value={fmtDec(totals.total, numDec.totalPaymentDue)} readOnly /></td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* â•â• ACTION BUTTONS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                        {false && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', marginBottom: '12px', gap: '8px' }}>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button type="submit" className="so-btn so-btn--primary" disabled={pageState.posting}>
                                    {secondaryActionLabel}
                                </button>
                                <button type="button" className="so-btn" onClick={resetForm}>
                                    Cancel
                                </button>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <div className="so-dropdown">
                                    <button
                                      type="button"
                                      className="so-btn"
                                      disabled={!isDocumentEditable || !!currentDocEntry || !hasBuyerCode}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (currentDocEntry || !hasBuyerCode) return;
                                        setCopyFromMode(true);
                                        setValErrors({ header: {}, lines: {}, form: '' });
                                        setPageState({ error: '', success: '', loading: false, posting: false, vendorLoading: false, seriesLoading: false });
                                        const dropdown = e.currentTarget.parentElement;
                                        const isActive = dropdown.classList.contains('active');
                                        document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
                                        if (!isActive) dropdown.classList.add('active');
                                      }}
                                      style={{ opacity: (!isDocumentEditable || !!currentDocEntry || !hasBuyerCode) ? 0.5 : 1 }}
                                    >
                                      Copy From ▼
                                    </button>
                                    <div className="so-dropdown-menu">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setCopyFromMode(true);
                                            setValErrors({ header: {}, lines: {}, form: '' });
                                            setPageState({ error: '', success: '', loading: false, posting: false, vendorLoading: false, seriesLoading: false });
                                            setTimeout(() => {
                                              openCopyFromModal('quotation');
                                              document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
                                            }, 10);
                                          }}
                                        >
                                            Sales Quotations
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setCopyFromMode(true);
                                            setValErrors({ header: {}, lines: {}, form: '' });
                                            setPageState({ error: '', success: '', loading: false, posting: false, vendorLoading: false, seriesLoading: false });
                                            setTimeout(() => {
                                              openCopyFromModal('blanket');
                                              document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
                                            }, 10);
                                          }}
                                        >
                                            Blanket Agreements
                                        </button>
                                    </div>
                                </div>
                                {/* Copy To Dropdown - SAP B1 style */}
                                <div className="so-dropdown">
                                    <button
                                        type="button"
                                        className="so-btn"
                                        disabled={!currentDocEntry}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (!currentDocEntry) return;
                                            const dropdown = e.currentTarget.parentElement;
                                            const isActive = dropdown.classList.contains('active');
                                            document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
                                            if (!isActive) dropdown.classList.add('active');
                                        }}
                                        style={{ opacity: !currentDocEntry ? 0.5 : 1 }}
                                    >
                                        Copy To ▼
                                    </button>
                                    <div className="so-dropdown-menu">
                                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyTo('delivery'); document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active')); }}>
                                            DC Delivery
                                        </button>
                                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyTo('ar-invoice'); document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active')); }}>
                                            A/R Invoice
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        )}
                        </fieldset>

                    </div>

                    <HeaderUdfSidebar
                        className="so-layout__sidebar"
                        isOpen={sidebarOpen}
                        fields={visHdrUdfs}
                        formSettings={formSettings}
                        values={headerUdfs}
                        disabled={!hasBuyerCode}
                        onFieldChange={handleHeaderUdfChange}
                        onClose={() => setSidebarOpen(false)}
                        billToPartyAddressOptions={vendorEffectiveBillToAddresses}
                        billToPartyName={header.name}
                        loadBillToPartyDetails={loadHeaderBillToPartyDetails}
                        loadToVendorDetails={loadHeaderToVendorDetails}
                    />
                    <FormSettingsPanel
                        variant="sidebar"
                        className="so-layout__sidebar"
                        isOpen={formSettingsOpen}
                        onClose={() => setFormSettingsOpen(false)}
                        matrixFields={BASE_MATRIX_COLUMNS}
                        headerUdfFields={headerUdfDefinitions}
                        rowUdfFields={rowUdfDefinitions}
                        formSettings={formSettings}
          onSettingChange={updateFormSetting}
          onColumnOrderChange={formSettingsStatus.reorder}
          settingsLoaded={formSettingsStatus.loaded}
          isSaving={formSettingsStatus.saving}
          hasUnsavedChanges={formSettingsStatus.hasUnsavedChanges}
          saveError={formSettingsStatus.error}
          onSave={formSettingsStatus.save}
          onCancel={formSettingsStatus.discard}
          settingsScopeLabel={formSettingsStatus.scopeLabel}
                    />
                </div>

            </fieldset>

            {/* Address Component Modal */}
            <AddressModal
                isOpen={!!addressModal}
                onClose={closeAddressModal}
                onSave={saveAddressModal}
                addressForm={addressForm}
                onFormChange={handleAddressFormChange}
                states={refData.states}
            />

            {/* E-Way Bill Modal */}
            <EWayBillModal
                isOpen={eWayBillModal}
                onClose={closeEWayBillModal}
                onSave={saveEWayBillModal}
                eWayBillData={eWayBillData}
            />

            {/* Tax Information Modal */}
            <TaxInfoModal
                isOpen={taxInfoModal}
                onClose={closeTaxInfoModal}
                onSave={saveTaxInfoModal}
                taxInfoForm={taxInfoForm}
                onFormChange={handleTaxInfoFormChange}
            />

            {/* State Selection Modal */}
            <StateSelectionModal
                isOpen={stateModal}
                onClose={closeStateModal}
                onSelect={handleStateSelect}
                states={refData.states || []}
            />

            {/* Business Partner Selection Modal */}
            <BusinessPartnerModal
                isOpen={bpModal}
                onClose={closeBpModal}
                onSelect={handleBpSelect}
                onCreateNew={() => {
                    closeBpModal();
                    navigate('/business-partner');
                }}
                businessPartners={refData.vendors || []}
            />

            {/* Copy From Modal */}
            <CopyFromModal
                isOpen={copyFromModal}
                onClose={() => {
                    setCopyFromModal(false);
                    setCopyFromMode(false);
                     setIsCopyFromClick(false); 
                }}
                onCopy={handleCopyFrom}
                documentType={copyFromDocType}
                onFetchDocuments={fetchCopyFromDocuments}
                onFetchDocumentDetails={fetchCopyFromDocumentDetails}
            />

            {/* HSN Code Selection Modal */}
            <HSNCodeModal
                isOpen={hsnModal.open}
                onClose={closeHSNModal}
                onSelect={handleHSNSelect}
            />

            {/* Item Selection Modal */}
            <ItemSelectionModal
                isOpen={itemModal.open}
                onClose={closeItemModal}
                onSelect={handleItemSelect}
                items={itemModal.items}
                loading={itemModal.loading}
            />

            <LineValueLookupModal
                isOpen={lineLookupModal.open}
                onClose={closeLineLookupModal}
                onSelect={handleLineLookupSelect}
                onCreate={handleLineLookupCreate}
                options={lineLookupModal.options}
                title={lineLookupModal.title}
                searchPlaceholder={lineLookupModal.searchPlaceholder}
                emptyMessage={lineLookupModal.emptyMessage}
                allowCreate={lineLookupModal.allowCreate}
                columns={lineLookupModal.columns}
            />

            <SalesEmployeeSetupModal
                isOpen={salesEmployeeSetup.open}
                rows={salesEmployeeSetup.rows}
                saving={salesEmployeeSetup.saving}
                onClose={closeSalesEmployeeSetup}
                onSave={saveSalesEmployeeSetup}
                onUpdateRow={updateSalesEmployeeSetupRow}
            />

            {/* Freight Charges Modal */}
            <FreightChargesModal
                isOpen={freightModal.open}
                onClose={closeFreightModal}
                onApply={handleFreightApply}
                freightCharges={freightModal.freightCharges}
                taxCodes={effectiveTaxCodes}
                loading={freightModal.loading}
            />
        </form>
    );
}

export default DCSalesOrder;
