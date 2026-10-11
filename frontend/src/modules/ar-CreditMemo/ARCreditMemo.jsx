import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount } from '../../utils/documentRounding';
import DocumentRoundingInput from '../../components/sales-document/DocumentRoundingInput';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import './styles/ARCreditMemo.css';
import { useLocation, useNavigate } from 'react-router-dom';
import FormSettingsPanel from '../../components/purchase-order/FormSettingsPanel';
import HeaderUdfSidebar from '../../components/purchase-order/HeaderUdfSidebar';
import ContentsTab from './components/ContentsTab';
import LogisticsTab from './components/LogisticsTab';
import AccountingTab from './components/AccountingTab';
import TaxTab from './components/TaxTab';
import ElectronicDocumentsTab from './components/ElectronicDocumentsTab';
import AttachmentsTab from './components/AttachmentsTab';
import AddressModal from '../../components/document/AddressComponentModal';
import { formatAddressComponent, mapAddressFields, pickAddressComponentFields } from '../../utils/documentAddress';
import TaxInfoModal from './components/TaxInfoModal';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import ExchangeRatesIndexesModal from '../sales-order/components/ExchangeRatesIndexesModal';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import LineValueLookupModal from '../../components/sales-document/LineValueLookupModal';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import PrintLayoutToolbar from '../../components/print-layout/PrintLayoutToolbar';
import JournalEntryPreviewButton from '../../components/journal-entry/JournalEntryPreviewButton';
import SalesEmployeeSetupModal from '../../components/sales-employee/SalesEmployeeSetupModal';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import CopyFromModal from '../../components/document/CopyFromModal';
import CopyToModal from './components/CopyToModal';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import { determineTaxCode, recalculateAllTaxCodes, getGSTTypeLabel } from '../../utils/taxEngine';
import { filterWarehousesByBranch, getWarehouseBranchId } from '../../utils/warehouseBranch';
import { hydrateDocumentLineFromItem, mergeItemMaster } from '../../utils/documentItemHydration';
import { applyUomCodeSelection, getItemDefaultUom, getLineUomOptions } from '../../utils/documentUom';
import { getSapVisibleDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import {
  convertDocumentAmountForDisplay,
  inferDocumentCurrencyMode,
  resolveDisplayCurrency,
  resolveDocumentCurrency,
} from '../../utils/documentCurrency';
import { useStandardSalesFormSettings } from '../../utils/standardSalesFormSettings';
import { buildCompanyFormQueryContext } from '../../utils/companyFormQueryContext';
import { updateFormSettingPreference } from '../../utils/formSettingsPreferences';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { findTaxCode, getTaxComponentCodes } from '../../utils/taxCodeComponents';
import { getDocumentLinePayableTax } from '../../utils/documentLineTax';
import {
  buildCopyToState,
  consumeCopyToState,
  openCopyToDocument,
  replaceRouteStatePreservingWindow,
} from '../../utils/copyToState';
import { duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useSalesEmployeeSetup from '../../hooks/useSalesEmployeeSetup';
import useDocumentDraftTask from '../../hooks/useDocumentDraftTask';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import { useAuth } from '../../auth/AuthContext';
import { isRouteStateForActiveCompany } from '../../utils/companyStorageScope';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import {
  AR_CREDIT_MEMO_LAYOUT_DOCUMENT_TYPE,
  getSapStandardSalesMatrixColumns,
} from '../sales-order/documentLayout';
import { fetchSalesDocumentLookup, fetchSalesDocumentSchema } from '../../api/salesDocumentSchemaApi';
import {
  buildSalesDocumentLiveFields,
  getSalesDocumentCompanyScopeKey,
  loadSalesDocumentFieldLookupOptions,
  stripSalesDocumentTopLevelUdfs,
} from '../../utils/salesDocumentLiveFields';
import { hydrateWorkbookDocumentLine } from '../../utils/workbookLineHydration';
import { applyDocumentTablePaste } from '../../utils/documentTableClipboard';
import {
  fetchARCreditMemoReferenceData,
  fetchARCreditMemoCustomerDetails,
  fetchARCreditMemoByDocEntry,
  submitARCreditMemo,
  updateARCreditMemo,
  fetchDocumentSeries,
  fetchFreightCharges,
  fetchItemsForModal,
  fetchBatchesByItem,
  fetchUomConversionFactor,
  fetchOpenARInvoicesForCreditMemo,
  fetchARInvoiceForCreditMemoCopy,
} from '../../api/arCreditMemoApi';
import { fetchSalesOrderExchangeRates, saveSalesOrderExchangeRate } from '../../api/salesOrderApi';
import { fetchHSNCodeFromItem } from '../../api/hsnCodeApi';
import { fetchDeliveryForCopyToCreditMemo } from '../../api/deliveryApi';
import { normaliseDocumentHeader, normaliseDocumentLine, unwrapCopyFromDocument, BASE_TYPE } from '../../api/copyFromApi';
import {
  FORM_SETTINGS_STORAGE_KEY,
  createUdfState,
  normalizeUdfState as normalizeConfiguredUdfState,
  readSavedFormSettings,
} from '../../config/arCreditMemoForm';

const SAP_MANUAL_SERIES_VALUE = '__SAP_MANUAL__';
const GENERAL_SETTINGS = readGeneralSettings();

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getErrMsg = (e, fb) => {
  const body = e?.response?.data || {};
  const d = body.detail || body.details;
  if (typeof d === 'string' && d.trim()) return d;
  if (d?.error?.message) return d.error.message;
  if (d?.message) return d.message;
  if (body.message) return d?.hint ? `${body.message} ${d.hint}` : body.message;
  return e?.message || fb;
};
const normalizeUdfState = (definitions = [], values = {}) => (
  normalizeConfiguredUdfState(definitions, values, { preserveExtra: false })
);
const today = () => new Date().toISOString().split('T')[0];
const parseNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const roundTo = (v, d) => { const f = 10 ** Math.max(d, 0); return Math.round((v + Number.EPSILON) * f) / f; };
const fmtDec = (v, d) => { if (v === '' || v == null) return ''; const n = Number(v); return Number.isNaN(n) ? '' : n.toFixed(Math.max(d, 0)); };
const firstEnteredValue = (...values) => values.find((value) => (
  value !== undefined
  && value !== null
  && !(typeof value === 'string' && value.trim() === '')
));
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
const normalizeBranchSelection = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== '-1' && normalized !== '0' ? normalized : '';
};

// Check if batches are available for item in specific warehouse
const checkBatchAvailability = async (itemCode, whsCode) => {
  if (!itemCode || !whsCode) return false;
  
  try {
    console.log('ðŸ” [AR Credit Memo - checkBatchAvailability] Checking batches for:', { itemCode, whsCode });
    const response = await fetchBatchesByItem(itemCode, whsCode);
    console.log('ðŸ” [AR Credit Memo - checkBatchAvailability] API Response:', response);
    
    const batches = response.data?.batches || [];
    const hasBatches = batches.length > 0;
    
    console.log('ðŸ” [AR Credit Memo - checkBatchAvailability] Found batches:', batches.length, 'Has batches:', hasBatches);
    console.log('ðŸ” [AR Credit Memo - checkBatchAvailability] Batch details:', batches);
    
    return hasBatches;
  } catch (error) {
    console.error('âŒ [AR Credit Memo - checkBatchAvailability] Error:', error);
    return true; // Assume batches available on error to prevent hiding button
  }
};

// Check if item is batch-managed
const isBatchManaged = (item) => {
  if (!item) return false;
  const batchFlag = item.ManBtchNum || item.BatchManaged;
  return batchFlag === 'Y' || batchFlag === true || batchFlag === 1;
};

// â”€â”€â”€ constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEC = { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 };
const TAB_NAMES = ['Contents', 'Logistics', 'Accounting', 'Tax', 'Electronic Documents', 'Attachments'];
const DEFAULT_WAREHOUSE_CODE = '';
const DEFAULT_TRANSACTION_TYPES = [
  { value: 'GST Tax Invoice', label: 'GST Tax Invoice' },
  { value: 'Bill of Supply', label: 'Bill of Supply' },
];
const buildExchangeRatesFallbackData = ({ year, month, currencies = [], localCurrency = '', documentCurrency = '' }) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  const currencyList = (Array.isArray(currencies) ? currencies : [])
    .map((c) => String(c.code || c.Code || c || '').trim())
    .filter((c) => c && c !== localCurrency);
  if (documentCurrency && !currencyList.includes(documentCurrency)) currencyList.unshift(documentCurrency);
  return { year, month, currencies: currencyList, days: daysInMonth, rates: {} };
};

const toArray = (value, fallbackKeys = []) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  for (const key of fallbackKeys) {
    if (Array.isArray(value[key])) return value[key];
  }

  if (Array.isArray(value.value)) return value.value;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.documents)) return value.documents;

  return [];
};

const normalizeReferenceData = (data = {}) => {
  const ref = data && typeof data === 'object' ? data : {};
  const udfMetadata = ref.udf_metadata && typeof ref.udf_metadata === 'object' ? ref.udf_metadata : {};
  const lineFieldMetadata = ref.line_field_metadata && typeof ref.line_field_metadata === 'object'
    ? ref.line_field_metadata
    : {};

  return {
    ...ref,
    vendors: toArray(ref.vendors || ref.customers, ['vendors', 'customers', 'business_partners']),
    customers: toArray(ref.customers || ref.vendors, ['customers', 'vendors', 'business_partners']),
    contacts: toArray(ref.contacts, ['contacts']),
    pay_to_addresses: toArray(ref.pay_to_addresses, ['pay_to_addresses']),
    ship_to_addresses: toArray(ref.ship_to_addresses, ['ship_to_addresses']),
    bill_to_addresses: toArray(ref.bill_to_addresses, ['bill_to_addresses']),
    items: toArray(ref.items, ['items']),
    warehouses: toArray(ref.warehouses, ['warehouses']),
    warehouse_addresses: toArray(ref.warehouse_addresses || ref.warehouses, ['warehouse_addresses', 'warehouses']),
    tax_codes: toArray(ref.tax_codes, ['tax_codes']),
    payment_terms: toArray(ref.payment_terms, ['payment_terms']),
    shipping_types: toArray(ref.shipping_types, ['shipping_types']),
    sales_employees: toArray(ref.sales_employees, ['sales_employees']),
    branches: toArray(ref.branches, ['branches']),
    states: toArray(ref.states, ['states']),
    transaction_types: toArray(ref.transaction_types || ref.transactionTypes, ['transaction_types', 'transactionTypes', 'validValues', 'ValidValues']),
    gl_accounts: toArray(ref.gl_accounts, ['gl_accounts']),
    distribution_rules: toArray(ref.distribution_rules, ['distribution_rules']),
    uom_groups: toArray(ref.uom_groups, ['uom_groups']),
    matrix_columns: toArray(ref.matrix_columns, ['matrix_columns']),
    line_field_metadata: {
      ...lineFieldMetadata,
      matrix_columns: toArray(lineFieldMetadata.matrix_columns || ref.matrix_columns, ['matrix_columns']),
      sap_form: lineFieldMetadata.sap_form || {},
    },
    udf_metadata: {
      header: toArray(udfMetadata.header, ['header']),
      rows: toArray(udfMetadata.rows, ['rows']),
    },
    warnings: toArray(ref.warnings, ['warnings']),
  };
};

const normalizeTransactionOption = (option) => {
  const value = String(option?.value ?? option?.Value ?? option?.code ?? option?.Code ?? option ?? '').trim();
  const label = String(option?.label ?? option?.description ?? option?.Descr ?? option?.name ?? value).trim();
  return value ? { value, label: label || value } : null;
};

const createLine = (rowUdfDefinitions = []) => ({
  itemNo: '', itemDescription: '', hsnCode: '', sacCode: '', quantity: '', unitPrice: '',
  uomCode: '', stdDiscount: '', taxCode: '', total: '', grossTotal: '', whse: DEFAULT_WAREHOUSE_CODE,
  lineDeliveryDate: '',
  loc: '', branch: '', noOfPackages: '', wTaxLiable: 'N', glAccount: '',
  distRule: '', taxLiable: 'Y', weight: '', taxAmount: '', totalLC: '',
  uomName: '', cogsDistRule: '', countryOfOrigin: '',
  binLocationAllocation: '', itemCost: '', withoutQtyPosting: 'N',
  enableSettingCost: 'N', returnCost: '', blanketAgreementNo: '',
  costSheet: '', packingType: '', containerType: '', grossWt: '', totalPackage: '',
  taxCodeRepeat: '', price: '',
  sellerBrokerage: '', buyerBrokerage: '', buyerDelivery: '', sellerDelivery: '',
  buyerPaymentTerms: '', sellerPaymentTerms: '', buyerQuality: '', sellerQuality: '',
  buyerPrice: '', sellerPrice: '', buyerSpecialInstruction: '', sellerSpecialInstruction: '',
  sellerBrokerageAmtPer: '', sellerBrokeragePercent: '', stcode: '',
  sellerItem: '', sellerQty: '', specialRebate: '', commission: '',
  sellerBrokeragePerQty: '', fixBrokBuyer: '', fixBrockSeller: '',
  sellerPaymentTermsRepeat: '',
  batchManaged: false,
  hasBatchesAvailable: false,
  batches: [],
  inventoryUOM: '',
  uomFactor: 1,
  udf: createUdfState(rowUdfDefinitions),
});

const INIT_HEADER = {
  vendor: '', name: '', contactPerson: '', salesContractNo: '', branch: '', warehouse: GENERAL_SETTINGS.arCreditMemoWarehouse || DEFAULT_WAREHOUSE_CODE,
  docNo: '', status: 'Open', series: GENERAL_SETTINGS.arCreditMemoSeries || '', nextNumber: '',
  postingDate: today(), deliveryDate: '', documentDate: today(), contractDate: '',
  transactionType: 'GST Tax Invoice',
  branchRegNo: '', shipTo: '', shipToCode: '', payTo: '', payToCode: '',
  shippingType: '', confirmed: undefined, journalRemark: '', paymentTerms: '',
  paymentMethod: '', otherInstruction: '', discount: '', freight: '', tax: '',
  totalPaymentDue: '', rounding: false, roundingAmount: '', owner: '', purchaser: '', salesEmployee: '',
  placeOfSupply: '', currencyMode: 'BP', currency: '', exchangeRate: '', useBillToForTax: false,
  billToAddress: '', billToCode: '', shipToAddress: '',
  shipToAddressComponents: null, billToAddressComponents: null,
};

const INIT_ATTACH = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, targetPath: '', fileName: '', attachmentDate: '',
  freeText: '', copyToTargetDocument: '', documentType: '', atchDocDate: '', alert: '',
}));

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getARCreditMemoDocumentLines = (creditMemo = {}) => {
  const candidates = [
    creditMemo.lines,
    creditMemo.Lines,
    creditMemo.documentLines,
    creditMemo.DocumentLines,
    creditMemo.rows,
    creditMemo.DocumentRows,
  ];

  return candidates.find((value) => Array.isArray(value) && value.length) || [];
};

function ARCreditMemo() {
  const [seriesRevision, setSeriesRevision] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();
  const { company } = useAuth();
  const activeCompanyId = company?.companyId || '';
  const activeCompanyDb = company?.dbName || '';
  const activeFieldMetadataScope = getSalesDocumentCompanyScopeKey({
    companyId: activeCompanyId,
    companyDb: activeCompanyDb,
  });
  const { removeTask, upsertTask } = useSapWindowTaskbarActions();
  const requestedEditDocEntry = isRouteStateForActiveCompany(location.state)
    ? location.state?.arCreditMemoDocEntry
    : null;

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(INIT_HEADER);
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState([]);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState([]);
  const [hydratedFieldMetadataScope, setHydratedFieldMetadataScope] = useState('');
  const [matrixColumnDefinitions, setMatrixColumnDefinitions] = useState(() => getSapStandardSalesMatrixColumns());
  const [loadedCreditMemo, setLoadedCreditMemo] = useState(null);
  const [lines, setLines] = useState([createLine([])]);
  const [attachments] = useState(INIT_ATTACH);
  const [activeTab, setActiveTab] = useState('Contents');
  const [headerUdfs, setHeaderUdfs] = useState({});
  const [formSettings, setFormSettings, formSettingsStorageKey, replaceFormSettings,
    formSettingsStatus, effectiveMatrixColumnDefinitions, companyFormSettingsReady] = useStandardSalesFormSettings({
    formKey: FORM_SETTINGS_STORAGE_KEY,
    readSavedFormSettings,
    headerUdfDefinitions,
    rowUdfDefinitions,
    matrixColumnDefinitions,
    companyId: activeCompanyId,
    companyDb: activeCompanyDb,
    hydratedFieldMetadataScope,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [formSettingsOpen, setFormSettingsOpen] = useState(false);
  const [refData, setRefData] = useState({
    company: '', vendors: [], contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [], items: [],
    warehouses: [], warehouse_addresses: [], company_address: {}, tax_codes: [],
    default_branch: '', default_warehouse: '',
    payment_terms: [], shipping_types: [], branches: [], uom_groups: [],
    local_currency: '', system_currency: '', company_currency: '', currencies: [],
    exchange_rate_settings: { postingMethod: 'direct', decimalPlaces: 6 },
    decimal_settings: DEC, warnings: [], series: [], states: [],
    matrix_columns: [],
    line_field_metadata: { matrix_columns: getSapStandardSalesMatrixColumns(), sap_form: {} },
    gl_accounts: [],
    distribution_rules: [],
  });
  const [pageState, setPageState] = useState({ loading: false, vendorLoading: false, posting: false, error: '', success: '', seriesLoading: false });
  const [valErrors, setValErrors] = useState({ header: {}, lines: {}, form: '' });
  useValidationHighlights(valErrors);
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [, setSeriesReloadToken] = useState(0);
  const [addressModal, setAddressModal] = useState(null);
  const [taxInfoModal, setTaxInfoModal] = useState(false);
  const [bpModal, setBpModal] = useState(false);
  const [stateModal, setStateModal] = useState(false);
  const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1 });
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, items: [], loading: false });
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
  const [exchangeRatesModal, setExchangeRatesModal] = useState({
    open: false, currency: '', postingDate: '', initialRate: '', loading: false, error: '', data: null,
  });
  const [lineLookupModal, setLineLookupModal] = useState({
    open: false,
    lineIndex: -1,
    field: '',
    udfKey: '',
    title: '',
    options: [],
    searchPlaceholder: '',
    emptyMessage: '',
    columns: [],
  });
  const [copyFromModal, setCopyFromModal] = useState(false);
  const [copyToModal, setCopyToModal] = useState(false);
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
    const handler = (e) => {
      if (!e.target.closest('.del-dropdown')) {
        document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // decimal config
  const dec = { ...DEC, ...(refData.decimal_settings || {}) };
  const numDec = {
    quantity: Number(dec.QtyDec), unitPrice: Number(dec.PriceDec),
    stdDiscount: Number(dec.PercentDec), total: Number(dec.SumDec),
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
  const hasBuyerCode = Boolean(String(header.vendor || '').trim());
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
  const getBranchFromWarehouseCode = useCallback((warehouseCode = '') => {
    const code = String(warehouseCode || '').trim();
    if (!code) return '';
    const warehouse = (refData.warehouses || []).find((row) => (
      String(row?.WhsCode || row?.WarehouseCode || row?.warehouse || '').trim() === code
    ));
    return normalizeBranchSelection(getWarehouseBranchId(warehouse));
  }, [refData.warehouses]);
  const primaryActionLabel = pageState.posting
    ? 'Saving...'
    : currentDocEntry
      ? updateActionLabel
      : 'Add';
  const secondaryActionLabel = pageState.posting
    ? 'Saving...'
    : currentDocEntry
      ? updateActionLabel
      : 'Add & New';

  useEffect(() => {
    const draft = location.state?.arCreditMemoDraft;
    if (!draft) return;

    setCurrentDocEntry(draft.currentDocEntry || null);
    setLoadedCreditMemo(null);
    setHeader(draft.header || INIT_HEADER);
    setLines(Array.isArray(draft.lines) && draft.lines.length
      ? draft.lines
      : [createLine(rowUdfDefinitions)]);
    setHeaderUdfs(draft.headerUdfs || normalizeUdfState(headerUdfDefinitions));
    setActiveTab(draft.activeTab || 'Contents');
    setIsDirty(Boolean(draft.isDirty));
    setFreightModal((prev) => ({
      ...prev,
      open: false,
      freightCharges: Array.isArray(draft.freightCharges) ? draft.freightCharges : [],
      loading: false,
    }));
    if (draft.addressForm) setAddressForm(draft.addressForm);
    if (draft.taxInfoForm) setTaxInfoForm(draft.taxInfoForm);
    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
  }, [
    headerUdfDefinitions,
    location.pathname,
    location.state,
    navigate,
    rowUdfDefinitions,
  ]);

  const buildLinkedRestoreState = useCallback(() => ({
    arCreditMemoDraft: {
      currentDocEntry,
      header,
      lines,
      headerUdfs,
      activeTab,
      isDirty,
      freightCharges: freightModal.freightCharges,
      addressForm,
      taxInfoForm,
    },
  }), [
    activeTab,
    addressForm,
    currentDocEntry,
    freightModal.freightCharges,
    header,
    headerUdfs,
    isDirty,
    lines,
    taxInfoForm,
  ]);

  useDocumentDraftTask({
    buildDraftState: buildLinkedRestoreState,
    title: 'A/R Credit Memo',
  });

  useEffect(() => {
    if (!snapshotPending || !currentDocEntry || pageState.loading || pageState.vendorLoading) return;
    setSnapshotPending(false);
  }, [snapshotPending, currentDocEntry, pageState.loading, pageState.vendorLoading, header, lines, headerUdfs]);

  const markDirty = useCallback(() => {
    if (currentDocEntry) setIsDirty(true);
  }, [currentDocEntry]);

  const loadDynamicLineLookupOptions = useCallback((source, field = {}, line = {}) => (
    loadSalesDocumentFieldLookupOptions({
      fetchLookup: fetchSalesDocumentLookup,
      source,
      field,
      line,
      documentType: 'AR_CREDIT_MEMO',
      schemaVersion: refData.line_field_metadata?.live_schema?.schemaVersion || '',
    })
  ), [refData.line_field_metadata]);

  // Continue in next part...

  // â”€â”€ load reference data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    let ignore = false;
    setHydratedFieldMetadataScope('');
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        if (!activeCompanyId) {
          setLoadedCreditMemo(null);
          setHeaderUdfDefinitions([]);
          setRowUdfDefinitions([]);
          setMatrixColumnDefinitions(getSapStandardSalesMatrixColumns());
          setHeaderUdfs({});
          setLines([createLine([])]);
          setRefData(prev => ({
            ...prev,
            company: '',
            vendors: [], contacts: [], pay_to_addresses: [], items: [], warehouses: [],
            warehouse_addresses: [], company_address: {}, tax_codes: [], payment_terms: [],
            shipping_types: [], sales_employees: [], branches: [], states: [], gl_accounts: [],
            distribution_rules: [], uom_groups: [], matrix_columns: [],
            local_currency: '', system_currency: '', company_currency: '', currencies: [],
            exchange_rate_settings: { postingMethod: 'direct', decimalPlaces: 6 },
            line_field_metadata: { matrix_columns: getSapStandardSalesMatrixColumns(), sap_form: {} },
            udf_metadata: { header: [], rows: [] },
          }));
          return;
        }

        setHeaderUdfDefinitions([]);
        setRowUdfDefinitions([]);
        setMatrixColumnDefinitions([]);

        const [refDataRes, layoutRes, liveSchema] = await Promise.all([
          fetchARCreditMemoReferenceData(activeCompanyId),
          getDocumentLayout({
            companyDb: activeCompanyDb || undefined,
            documentType: AR_CREDIT_MEMO_LAYOUT_DOCUMENT_TYPE,
            objectType: '14',
            refresh: true,
          }).catch((error) => ({
            data: {
              success: false,
              columns: [],
              warning: getErrMsg(error, 'Failed to load SAP layout.'),
            },
          })),
          fetchSalesDocumentSchema({ documentType: 'AR_CREDIT_MEMO' }).catch((error) => {
            console.warn('[A/R Credit Memo] Live ORIN/RIN1 schema was not available.', error);
            return null;
          }),
        ]);
        
        if (!ignore) {
          const nextRefData = normalizeReferenceData(refDataRes.data);
          const vendorRows = nextRefData.vendors || nextRefData.customers || [];
          const sourceMatrixColumns = nextRefData.line_field_metadata.matrix_columns.length
            ? nextRefData.line_field_metadata.matrix_columns
            : nextRefData.matrix_columns;
          const liveFields = buildSalesDocumentLiveFields({
            schema: liveSchema,
            documentType: 'AR_CREDIT_MEMO',
            objectType: '14',
            headerTable: 'ORIN',
            lineTable: 'RIN1',
            companyId: activeCompanyId,
            companyDb: activeCompanyDb,
            layoutResponse: layoutRes,
            referenceMatrixColumns: sourceMatrixColumns,
            referenceSapForm: nextRefData.line_field_metadata?.sap_form,
          });
          const nextHeaderUdfs = liveFields.headerUdfFields;
          const nextRowUdfs = liveFields.rowUdfFields;
          const nextLayoutMatrixColumns = liveFields.matrixColumns;
          const liveDefaultBranch = String(nextRefData.default_branch || '').trim();
          const liveDefaultWarehouse = String(nextRefData.default_warehouse || '').trim();
          setHeaderUdfDefinitions(nextHeaderUdfs);
          setRowUdfDefinitions(nextRowUdfs);
          setMatrixColumnDefinitions(nextLayoutMatrixColumns);
          setHeaderUdfs((prev) => normalizeUdfState(nextHeaderUdfs, prev, { preserveExtra: false }));
          setLines((prev) => prev.map((line) => ({
            ...line,
            udf: normalizeUdfState(nextRowUdfs, line.udf || {}, { preserveExtra: false }),
          })));
          replaceFormSettings(readSavedFormSettings(
            nextHeaderUdfs,
            nextRowUdfs,
            nextLayoutMatrixColumns,
            formSettingsStorageKey,
          ));
          setRefData(prev => ({
            ...prev,
            company: nextRefData.company || '',
            vendors: vendorRows,
            contacts: nextRefData.contacts,
            pay_to_addresses: nextRefData.pay_to_addresses,
            items: nextRefData.items,
            warehouses: nextRefData.warehouses,
            warehouse_addresses: nextRefData.warehouse_addresses,
            company_address: nextRefData.company_address || {},
            tax_codes: nextRefData.tax_codes,
            payment_terms: nextRefData.payment_terms,
            shipping_types: nextRefData.shipping_types,
            sales_employees: nextRefData.sales_employees,
            branches: nextRefData.branches,
            states: nextRefData.states,
            gl_accounts: nextRefData.gl_accounts,
            distribution_rules: nextRefData.distribution_rules,
            uom_groups: nextRefData.uom_groups,
            local_currency: nextRefData.local_currency || nextRefData.company_currency || '',
            system_currency: nextRefData.system_currency || nextRefData.local_currency || nextRefData.company_currency || '',
            company_currency: nextRefData.company_currency || nextRefData.local_currency || '',
            currencies: nextRefData.currencies || [],
            exchange_rate_settings: nextRefData.exchange_rate_settings || { postingMethod: 'direct', decimalPlaces: 6 },
            decimal_settings: { ...DEC, ...(nextRefData.decimal_settings || {}) },
            matrix_columns: nextLayoutMatrixColumns,
            line_field_metadata: {
              ...(nextRefData.line_field_metadata || { sap_form: {} }),
              matrix_columns: nextLayoutMatrixColumns,
              source_matrix_columns: sourceMatrixColumns,
              imported_layout: liveFields.importedLayout,
              live_schema: liveFields.liveSchema,
              live_available: liveFields.liveAvailable,
            },
            udf_metadata: { header: nextHeaderUdfs, rows: nextRowUdfs },
            warnings: [
              ...(nextRefData.warnings || []),
              ...(!liveFields.schemaMatchesCompany && liveSchema
                ? ['Ignored an A/R Credit Memo schema belonging to another company.']
                : []),
              ...(!liveFields.liveAvailable
                ? ['Live A/R Credit Memo field metadata was unavailable; SAP standard fields are shown.']
                : []),
              ...(layoutRes?.data?.warning ? [layoutRes.data.warning] : []),
            ],
            series: Array.isArray(prev.series) ? prev.series : [],
            default_branch: liveDefaultBranch,
            default_warehouse: liveDefaultWarehouse,
          }));
          if (!currentDocEntry && !requestedEditDocEntry && (liveDefaultBranch || liveDefaultWarehouse)) {
            setHeader(prev => ({
              ...prev,
              branch: prev.branch || liveDefaultBranch,
              warehouse: prev.warehouse || liveDefaultWarehouse,
            }));
            setLines(prev => prev.map((line) => ({
              ...line,
              branch: line.branch || liveDefaultBranch,
              loc: line.loc || liveDefaultBranch,
              whse: line.whse || liveDefaultWarehouse,
            })));
          }
          setHydratedFieldMetadataScope(activeFieldMetadataScope);
        }
      } catch (e) {
        if (!ignore) {
          const fallbackColumns = getSapStandardSalesMatrixColumns();
          setHeaderUdfDefinitions([]);
          setRowUdfDefinitions([]);
          setMatrixColumnDefinitions(fallbackColumns);
          setHeaderUdfs({});
          setLines((previous) => previous.map((line) => ({ ...line, udf: {} })));
          replaceFormSettings(readSavedFormSettings([], [], fallbackColumns, formSettingsStorageKey));
          setRefData((previous) => ({
            ...previous,
            matrix_columns: fallbackColumns,
            udf_metadata: { header: [], rows: [] },
            line_field_metadata: {
              matrix_columns: fallbackColumns,
              source_matrix_columns: [],
              sap_form: {},
              live_schema: null,
              live_available: false,
            },
          }));
          setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load reference data.') }));
          setHydratedFieldMetadataScope(activeFieldMetadataScope);
        }
      } finally {
        if (!ignore) setPageState(p => ({ ...p, loading: false }));
      }
    };
    load();
    return () => { ignore = true; };
  }, [activeCompanyDb, activeCompanyId, activeFieldMetadataScope, formSettingsStorageKey, replaceFormSettings]);

  useEffect(() => {
    if (!companyFormSettingsReady || formSettingsStatus.hasUnsavedChanges) return;
    replaceFormSettings(readSavedFormSettings(
      headerUdfDefinitions,
      rowUdfDefinitions,
      effectiveMatrixColumnDefinitions,
      formSettingsStorageKey,
    ));
  }, [companyFormSettingsReady, effectiveMatrixColumnDefinitions, formSettingsStatus.hasUnsavedChanges, formSettingsStorageKey, headerUdfDefinitions, replaceFormSettings, rowUdfDefinitions]);

  // â”€â”€ load existing order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


  useEffect(() => {
    const docEntry = requestedEditDocEntry;
    if (!docEntry || hydratedFieldMetadataScope !== activeFieldMetadataScope) return;
    let ignore = false;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        const r = await fetchARCreditMemoByDocEntry(docEntry);
        const so = r.data.ar_credit_memo;
        console.log('AR Credit Memo response:', r.data);
        console.log('DocType:', so?.header?.docType);
        console.log('Document lines:', getARCreditMemoDocumentLines(so));
        if (ignore || !so) return;
        if (String(so.header?.docType || 'I').trim().toUpperCase() === 'S') {
          setLoadedCreditMemo(null);
          setPageState(p => ({
            ...p,
            error: 'This A/R Credit Memo is a Service type document. Open it in the Service A/R Credit Memo page.',
            success: '',
          }));
          return;
        }
        let editSeries = [];
        try {
          const seriesDate = so?.header?.postingDate || so?.header?.documentDate || '';
          const seriesResponse = await fetchDocumentSeries(
            seriesDate,
            so?.header?.transactionType || 'GST Tax Invoice',
            so?.header?.branch || '',
          );
          editSeries = seriesResponse.data?.series || [];
        } catch (_seriesError) {
          editSeries = [];
        }
        if (ignore) return;
        setCurrentDocEntry(so.doc_entry || Number(docEntry));
        const savedSeriesValue = String(so.header?.series || '');
        const savedSeriesOption = savedSeriesValue
          ? {
              Series: savedSeriesValue,
              SeriesName: so.header?.seriesName || savedSeriesValue,
              Indicator: so.header?.seriesIndicator || '',
            }
          : null;
        const mergedEditSeries = savedSeriesOption
          ? [
              savedSeriesOption,
              ...editSeries.filter((series) => String(series.Series) !== savedSeriesValue),
            ]
          : editSeries;
        if (mergedEditSeries.length) {
          setRefData(prev => ({
            ...prev,
            series: mergedEditSeries,
          }));
        }
        setLoadedCreditMemo(so);
        setHeader(prev => ({
          ...prev,
          ...INIT_HEADER,
          ...(so.header || {}),
          vendor: so.header?.customerCode || so.header?.customer || '',
          contactPerson: so.header?.contactPerson || '',
          name: so.header?.customerName || so.header?.name || '',
          paymentTerms: so.header?.paymentTermsCode || so.header?.paymentTerms || '',
          placeOfSupply: so.header?.placeOfSupply || '',
          branch: so.header?.branch || '',
          shipToAddressComponents: so.header?.shipToAddressComponents || null,
          billToAddressComponents: so.header?.billToAddressComponents || null,
          docNo: so.header?.docNo || so.header?.docNum || '',
          series: so.header?.series || '',
          nextNumber: so.header?.docNo || so.header?.docNum || '',
          currency: so.header?.currency || refData.local_currency || '',
          currencyMode: inferDocumentCurrencyMode({
            currency: so.header?.currency || refData.local_currency || '',
            cardCode: so.header?.customerCode || so.header?.customer || '',
            businessPartners: refData.vendors || [],
            localCurrency: refData.local_currency || '',
            systemCurrency: refData.system_currency || refData.local_currency || '',
            fallbackLocalCurrency: '',
          }),
          exchangeRate: so.header?.exchangeRate || so.header?.docRate || so.header?.DocRate || '',
          rounding: Boolean(so.header?.rounding || parseNum(so.header?.roundingAmount) !== 0),
          roundingAmount: so.header?.roundingAmount ?? '',
        }));
        
        const savedDocumentLines = getARCreditMemoDocumentLines(so);
        if (savedDocumentLines.length) {
          setLines(savedDocumentLines.map((line) => hydrateWorkbookDocumentLine({
            line,
            createLine,
            rowUdfDefinitions,
            normalizeUdfState,
            items: refData.items,
            fallbackWarehouse: so.header?.warehouse || DEFAULT_WAREHOUSE_CODE,
          })));
        }
        setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, so.header_udfs || {}));
        setSnapshotPending(true);
        setIsDirty(false);
        if (so.header?.customerCode || so.header?.customer) {
          loadVendorDetails(so.header?.customerCode || so.header?.customer);
        }
        setPageState(p => ({ ...p, success: so.doc_num ? `AR Credit Memo ${so.doc_num} loaded.` : 'AR Credit Memo loaded.' }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load AR Credit Memo.') }));
      } finally {
        if (!ignore) {
          setPageState(p => ({ ...p, loading: false }));
          replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
        }
      }
    };
    load();
    return () => { ignore = true; };
  }, [activeFieldMetadataScope, hydratedFieldMetadataScope, location.pathname, requestedEditDocEntry, navigate]);

  useEffect(() => {
    if (!loadedCreditMemo || isDirty) return;
    const savedDocumentLines = getARCreditMemoDocumentLines(loadedCreditMemo);
    if (!savedDocumentLines.length) return;

    setLines(savedDocumentLines.map((line) => hydrateWorkbookDocumentLine({
      line,
      createLine,
      rowUdfDefinitions,
      normalizeUdfState,
      items: refData.items,
      fallbackWarehouse: loadedCreditMemo.header?.warehouse || DEFAULT_WAREHOUSE_CODE,
    })));
  }, [loadedCreditMemo, rowUdfDefinitions, refData.items, isDirty]);

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

  // â”€â”€ load from delivery (Copy To) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const deliveryDocEntry = location.state?.deliveryDocEntry;
    if (!deliveryDocEntry) return;
    
    let ignore = false;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        const r = await fetchDeliveryForCopyToCreditMemo(deliveryDocEntry);
        const deliveryData = r.data;
        
        if (ignore || !deliveryData) return;
        
        // Map delivery header to credit memo header
        setHeader(prev => ({
          ...prev,
          vendor: deliveryData.header?.customer || '',
          name: deliveryData.header?.name || '',
          contactPerson: deliveryData.header?.contactPerson || '',
          salesContractNo: deliveryData.header?.salesContractNo || '',
          branch: deliveryData.header?.branch || '',
          paymentTerms: deliveryData.header?.paymentTerms || '',
          otherInstruction: deliveryData.header?.otherInstruction || '',
          postingDate: today(),
          deliveryDate: today(),
          documentDate: today(),
          currency: deliveryData.header?.currency || prev.currency,
          exchangeRate: deliveryData.header?.exchangeRate || deliveryData.header?.docRate || deliveryData.header?.DocRate || '',
          baseRef: deliveryData.header?.baseRef || '', // Reference to delivery doc number
        }));
        
        // Map delivery lines to credit memo lines with base document linking
        setLines(
          Array.isArray(deliveryData.lines) && deliveryData.lines.length
            ? deliveryData.lines.map(l => ({
                ...createLine(rowUdfDefinitions),
                ...l,
                baseEntry: l.baseEntry, // Delivery DocEntry
                baseType: 15, // Delivery
                baseLine: l.baseLine,
                udf: normalizeUdfState(rowUdfDefinitions, l.udf || {})
              }))
            : [createLine(rowUdfDefinitions)]
        );
        
        // Load customer details
        if (deliveryData.header?.customer) {
          loadVendorDetails(deliveryData.header.customer);
        }
        
        setPageState(p => ({ 
          ...p, 
          success: `Copied from Delivery ${deliveryData.header?.baseRef || deliveryDocEntry}. Ready to create Credit Memo.` 
        }));
      } catch (e) {
        if (!ignore) {
          const errorMsg = getErrMsg(e, 'Failed to load delivery for copy.');
          setPageState(p => ({ ...p, error: errorMsg }));
        }
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

  // â”€â”€ Copy To: populate form from Sales Order / Delivery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const routedCopyFrom = location.state?.copyFrom;
    const persistedCopyState = routedCopyFrom ? null : consumeCopyToState(location.pathname, ['/ar-credit-memo']);
    const copyFrom = routedCopyFrom || persistedCopyState?.copyFrom;
    if (!copyFrom) return;

    const {
      header: srcHeader = {},
      lines: srcLines = [],
      headerUdfs: srcHeaderUdfs = {},
      baseDocument,
      sourceLabel,
      type: sourceType,
    } = copyFrom;

    setHeader(prev => ({
      ...prev,
      vendor:           srcHeader.vendor           || srcHeader.CardCode  || '',
      name:             srcHeader.name             || srcHeader.CardName  || '',
      contactPerson:    srcHeader.contactPerson    || srcHeader.CntctCode || '',
      salesContractNo:  srcHeader.salesContractNo  || srcHeader.customerRefNo || srcHeader.CustomerRefNo || srcHeader.NumAtCard || '',
      branch:           srcHeader.branch           || srcHeader.BPL_IDAssignedToInvoice || '',
      warehouse:        srcHeader.warehouse        || DEFAULT_WAREHOUSE_CODE,
      paymentTerms:     srcHeader.paymentTerms     || srcHeader.GroupNum  || '',
      placeOfSupply:    srcHeader.placeOfSupply    || '',
      otherInstruction: srcHeader.otherInstruction || srcHeader.Comments || '',
      discount:         srcHeader.discount         || '',
      freight:          srcHeader.freight          || '',
      billToAddress:    srcHeader.billToAddress    || '',
      billToCode:       srcHeader.billToCode       || '',
      shipToAddress:    srcHeader.shipToAddress    || '',
      shipToCode:       srcHeader.shipToCode       || '',
      payTo:            srcHeader.payTo            || '',
      payToCode:        srcHeader.payToCode        || '',
      owner:            srcHeader.owner            || '',
      purchaser:        srcHeader.purchaser        || '',
      currency:         srcHeader.currency         || prev.currency,
      exchangeRate:     srcHeader.exchangeRate     || srcHeader.docRate || srcHeader.DocRate || '',
    }));

    setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, srcHeaderUdfs));
    setFreightModal({ open: false, freightCharges: Array.isArray(copyFrom.freightCharges) ? copyFrom.freightCharges : [], loading: false });

    if (Array.isArray(srcLines) && srcLines.length > 0) {
      setLines(srcLines.map((l, idx) => ({
        ...createLine(rowUdfDefinitions),
        itemNo:          l.itemNo             || l.ItemCode        || '',
        itemDescription: l.itemDescription    || l.ItemDescription || l.Dscription || '',
        quantity:        String(firstEnteredValue(l.quantity, l.Quantity, l.OpenQty, 0)),
        unitPrice:       String(firstEnteredValue(l.unitPrice, l.UnitPrice, l.Price, 0)),
        uomCode:         l.uomCode            || l.UomCode || l.unitMsr || '',
        hsnCode:         l.hsnCode            || l.HSNCode || '',
        taxCode:         l.taxCode            || l.TaxCode || '',
        taxCodeManuallyOverridden: Boolean(String(l.taxCode || l.TaxCode || l.VatGroup || '').trim()),
        total:           String(firstEnteredValue(l.total, l.LineTotal, 0)),
        whse:            l.whse               || l.WarehouseCode || l.WhsCode || DEFAULT_WAREHOUSE_CODE,
        loc:             l.loc                || l.Location || '',
        stdDiscount:     String(firstEnteredValue(l.stdDiscount, l.DiscountPercent, l.DiscPrcnt, l.discount, 0)),
        packingType:     String(firstEnteredValue(l.packingType, l.U_PackingType, l.udf?.U_PackingType) ?? ''),
        grossWt:         String(firstEnteredValue(l.grossWt, l.U_GrossWt, l.udf?.U_GrossWt) ?? ''),
        totalPackage:    String(firstEnteredValue(l.totalPackage, l.U_TotalPackage, l.udf?.U_TotalPackage) ?? ''),
        baseEntry:       baseDocument?.baseEntry || copyFrom.docEntry,
        baseType:        baseDocument?.baseType  || 13,
        baseLine:        l.lineNum         ?? l.LineNum         ?? idx,
        branch:          l.branch          || srcHeader.branch  || '',
        udf: normalizeUdfState(rowUdfDefinitions, l.udf || {}),
      })));
    }

    const cardCode = srcHeader.vendor || srcHeader.CardCode;
    if (cardCode) loadVendorDetails(cardCode);

    const sourceDocumentLabel = sourceLabel || (sourceType === 'arInvoice' ? 'A/R Invoice' : 'source document');
    setPageState(p => ({ ...p, success: `Copied from ${sourceDocumentLabel}. Please review and save.` }));
    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // â”€â”€ derived / computed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const vendorContacts = refData.contacts.filter(c => String(c.CardCode || '') === String(header.vendor || ''));
  const contactOptions = header.contactPerson && !vendorContacts.some(c => String(c.CntctCode || '') === String(header.contactPerson || ''))
    ? [{ CardCode: header.vendor, CntctCode: header.contactPerson, Name: header.contactPerson }, ...vendorContacts]
    : vendorContacts;
  const vendorPayToAddresses = refData.pay_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorShipToAddresses = refData.ship_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorBillToAddresses = refData.bill_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorEffectiveShipToAddresses = vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses;
  const vendorEffectiveBillToAddresses = vendorBillToAddresses.length ? vendorBillToAddresses : vendorPayToAddresses;
  const selectedBranch = refData.branches.find(b => String(b.BPLId || '') === String(header.branch || ''));
  const firstLineWhse = String(lines[0]?.whse || '').trim();
  const selectedWhseAddr = refData.warehouse_addresses.find(w => String(w.WhsCode || '') === firstLineWhse);
  const defaultShipTo = fmtAddr(refData.company_address);

  const effectiveTaxCodes = refData.tax_codes || [];
  const effectiveWarehouses = refData.warehouses || [];
  const branchFilteredWarehouses = filterWarehousesByBranch(effectiveWarehouses, header.branch);
  const freightTotals = summarizeFreightRows(freightModal.freightCharges, effectiveTaxCodes);
  const effectiveWhseAddrs = refData.warehouse_addresses || [];
  const payTermOpts = (refData.payment_terms || [])
    .map(t => ({ value: String(t.GroupNum), label: t.PymntGroup }));
  const shipTypeOpts = (refData.shipping_types || [])
    .map(s => ({ value: String(s.TrnspCode), label: s.TrnspName }));
  const transactionTypeOptions = useMemo(() => {
    const liveOptions = (refData.transaction_types || [])
      .map(normalizeTransactionOption)
      .filter(Boolean);
    return liveOptions.length ? liveOptions : DEFAULT_TRANSACTION_TYPES;
  }, [refData.transaction_types]);
  const resolveARCreditMemoAddress = useCallback((code, addresses = [], fallbackText = '') => {
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
    return getLineUomOptions(line, item, refData.uom_groups).map((uom) => uom.uomCode);
  }, [refData.items, refData.uom_groups]);

  const lineItemOptions = lines.reduce((acc, line, i) => {
    const code = String(line.itemNo || '').trim();
    const exists = refData.items.some(it => String(it.ItemCode || '') === code);
    acc[i] = code && !exists ? [{ ItemCode: code, ItemName: line.itemDescription || code }, ...refData.items] : refData.items;
    return acc;
  }, {});

  const accountLookupOptions = useMemo(() => (refData.gl_accounts || []).map((account) => ({
    value: account.code || '',
    description: account.name || '',
    label: account.name ? `${account.code} - ${account.name}` : account.code,
    accountNumber: account.code || '',
    accountName: account.name || '',
    accountBalance: Number(account.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    inactive: account.inactive || 'No',
  })).filter((option) => option.value), [refData.gl_accounts]);

  const distributionRuleLookupOptions = useMemo(() => (refData.distribution_rules || []).map((rule) => {
    const value = rule.FactorCode || rule.OcrCode || rule.code || '';
    const description = rule.FactorDescription || rule.OcrName || rule.name || '';
    return {
      value,
      description,
      label: description ? `${value} - ${description}` : value,
      factorCode: value,
      factorDescription: description,
    };
  }).filter((option) => option.value), [refData.distribution_rules]);

  const itemLookupOptions = useMemo(() => (refData.items || []).map((item) => ({
    value: item.ItemCode || '',
    description: item.ItemName || '',
    label: item.ItemName ? `${item.ItemCode} - ${item.ItemName}` : item.ItemCode,
    itemCode: item.ItemCode || '',
    itemName: item.ItemName || '',
    salesUnit: item.SalesUnit || item.InventoryUOM || '',
  })).filter((option) => option.value), [refData.items]);

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

  const getBranchName = (branchId) => {
    if (!branchId) return '';
    const branch = refData.branches.find(b => String(b.BPLId) === String(branchId));
    return branch ? branch.BPLName : branchId;
  };

  // â”€â”€ calculations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const calcLineTotal = (line) => {
    const qty = parseNum(line.quantity), price = parseNum(line.unitPrice), disc = parseNum(line.stdDiscount);
    return roundTo(qty * price * (1 - disc / 100), numDec.total);
  };

  const calcTotals = () => {
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
        const tax = findTaxCode(effectiveTaxCodes, l.taxCode);
        const rate = parseNum(tax?.Rate);
        const base = discSub * (net / subtotal);
        const lineTax = roundTo(getDocumentLinePayableTax({ taxableAmount: base, tax,
          savedTaxAmount: l.taxAmount }), numDec.tax);
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
    const totalBeforeRounding = roundTo(discSub + freight + taxAmt, numDec.totalPaymentDue);
    const { roundingAmount, total } = calculateDocumentRounding(
      totalBeforeRounding, header.rounding, numDec.totalPaymentDue, (currentDocEntry || header.roundingAmountIsManual) ? header : null, getDocumentRoundingPolicy(refData, header),
    );
    return {
      subtotal,
      discAmt,
      discSub,
      freight,
      freightTaxAmt,
      taxAmt,
      totalBeforeRounding,
      roundingAmount,
      total,
      taxBreakdown: Array.from(taxMap.values()),
    };
  };

  const totals = calcTotals();
  const documentCurrency = String(header.currency || refData.local_currency || refData.company_currency || '').trim();
  const displayMode = String(header.currencyMode || 'BP').trim().toUpperCase();
  const displayCurrency = resolveDisplayCurrency({
    mode: displayMode,
    documentCurrency,
    localCurrency: refData.local_currency || refData.company_currency,
    systemCurrency: refData.system_currency,
  });
  const formatDisplayMoney = (value, decimals) => {
    const converted = convertDocumentAmountForDisplay(value, {
      mode: displayMode,
      documentCurrency,
      localCurrency: refData.local_currency || refData.company_currency,
      systemCurrency: refData.system_currency,
      documentRate: header.exchangeRate,
      systemRate: header.systemExchangeRate,
      postingMethod: refData.exchange_rate_settings?.postingMethod,
    });
    const amount = fmtDec(converted, decimals);
    return amount !== '' && displayCurrency ? `${amount} ${displayCurrency}` : amount;
  };
  useRelationshipMapRegistration({
    enabled: Boolean(currentDocEntry),
    objectType: 14,
    docEntry: currentDocEntry,
    header,
    total: totals.total,
  });

  // Continue in next part...

  // â”€â”€ address sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    setHeader(prev => {
      if (prev.shipToCode) return prev;
      const next = selectedWhseAddr ? fmtAddr(selectedWhseAddr) : defaultShipTo;
      if (!next || prev.shipTo === next) return prev;
      return { ...prev, shipToCode: selectedWhseAddr ? selectedWhseAddr.WhsCode : 'COMPANY', shipTo: next };
    });
  }, [selectedWhseAddr, defaultShipTo]);

  useEffect(() => {
    if (!header.vendor) return;
    setHeader(prev => {
      const existing = vendorEffectiveBillToAddresses.find(a => String(a.Address || '') === String(prev.payToCode || prev.billToCode || ''));
      if (existing) return prev;
      const def = vendorEffectiveBillToAddresses[0];
      if (!def) return prev;
      const fmt = fmtAddr(def);
      if (prev.payToCode === def.Address && prev.payTo === fmt) return prev;
      return {
        ...prev,
        payToCode: def.Address || '',
        payTo: fmt,
        billToCode: prev.billToCode || def.Address || '',
        billToAddress: prev.billToAddress || fmt,
      };
    });
  }, [header.vendor, vendorEffectiveBillToAddresses]);

  // â”€â”€ vendor details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadVendorDetails = async (code) => {
    if (!code) {
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setHeader(prev => ({ 
        ...prev, 
        placeOfSupply: '',
        shipToCode: '',
        shipToAddress: '',
        billToCode: '',
        billToAddress: ''
      }));
      return;
    }

    setPageState(p => ({ ...p, vendorLoading: true }));

    try {
      const r = await fetchARCreditMemoCustomerDetails(code);
      const contacts = r.data.contacts || [];
      const payToAddresses = r.data.pay_to_addresses || [];
      const shipToAddresses = r.data.ship_to_addresses || [];
      
      setRefData(p => ({
        ...p,
        contacts: contacts,
        pay_to_addresses: payToAddresses,
        ship_to_addresses: shipToAddresses,
        bill_to_addresses: payToAddresses
      }));

      if (contacts.length > 0) {
        setHeader(prev => ({
          ...prev,
          contactPerson: contacts[0].CntctCode
        }));
      }

      const defaultShipTo = shipToAddresses[0] || payToAddresses[0] || null;
      const defaultBillTo = payToAddresses[0] || shipToAddresses[0] || null;
      if (defaultShipTo || defaultBillTo) {
        const formattedShipTo = defaultShipTo ? fmtAddr(defaultShipTo) : '';
        const formattedBillTo = defaultBillTo ? fmtAddr(defaultBillTo) : formattedShipTo;
        setHeader(prev => ({
          ...prev,
          placeOfSupply: defaultShipTo?.State || defaultBillTo?.State || prev.placeOfSupply,
          shipToCode: defaultShipTo?.Address || '',
          shipToAddress: formattedShipTo,
          billToCode: defaultBillTo?.Address || '',
          billToAddress: formattedBillTo,
          payToCode: defaultBillTo?.Address || '',
          payTo: formattedBillTo
        }));
      }

      // Auto-populate addresses from customer's default address
      if (false && payToAddresses.length > 0) {
        const defaultAddress = payToAddresses[0];
        const formattedAddress = fmtAddr(defaultAddress);
        
        console.log('ðŸŒ Auto-setting addresses from customer:', {
          state: defaultAddress.State,
          addressCode: defaultAddress.Address,
          formattedAddress
        });
        
        setHeader(prev => ({
          ...prev,
          placeOfSupply: defaultAddress.State || prev.placeOfSupply,
          // Set Ship To
          shipToCode: defaultAddress.Address || '',
          shipToAddress: formattedAddress,
          // Set Bill To (same as Ship To by default)
          billToCode: defaultAddress.Address || '',
          billToAddress: formattedAddress
        }));
      }

    } catch (err) {
      console.error('Error loading customer details:', err);
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
    } finally {
      setPageState(p => ({ ...p, vendorLoading: false }));
    }
  };

  const syncVendor = (code, hdr) => {
    const m = refData.vendors.find(v => String(v.CardCode || '') === String(code || ''));
    if (!m) return { nextHeader: hdr };
    const nextCurrency = resolveDocumentCurrency({
      mode: 'BP',
      cardCode: code,
      businessPartners: refData.vendors || [],
      currentCurrency: hdr.currency,
      localCurrency: refData.local_currency || refData.company_currency || '',
      systemCurrency: refData.system_currency || refData.local_currency || refData.company_currency || '',
      fallbackLocalCurrency: '',
    });
    return {
      nextHeader: {
        ...hdr,
        name: m.CardName || hdr.name,
        paymentTerms: m.PayTermsGrpCode != null ? String(m.PayTermsGrpCode) : hdr.paymentTerms,
        currency: nextCurrency,
        exchangeRate: nextCurrency === hdr.currency ? hdr.exchangeRate || '' : '',
        contactPerson: '',
      },
    };
  };

  const openExchangeRatesModal = useCallback(({ currency, postingDate, initialRate = '' }) => {
    setExchangeRatesModal({ open: true, currency, postingDate, initialRate, loading: false, error: '', data: null });
  }, []);

  const loadExchangeRatesMonth = useCallback(async ({ year, month }) => {
    setExchangeRatesModal((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const response = await fetchSalesOrderExchangeRates({ year, month });
      setExchangeRatesModal((prev) => ({ ...prev, loading: false, error: '', data: response.data }));
    } catch (error) {
      setExchangeRatesModal((prev) => ({
        ...prev, loading: false,
        error: error?.response?.data?.detail || error?.message || 'Failed to load exchange rates.',
        data: buildExchangeRatesFallbackData({ year, month, currencies: refData.currencies || [], localCurrency: refData.local_currency || refData.company_currency || '', documentCurrency: exchangeRatesModal.currency }),
      }));
    }
  }, [exchangeRatesModal.currency, refData.company_currency, refData.currencies, refData.local_currency]);

  const saveExchangeRateFromModal = useCallback(async ({ rates = [], currency, postingDate, rate }) => {
    const entries = (Array.isArray(rates) && rates.length ? rates : [{ currency, postingDate, rate }])
      .map((entry) => ({ ...entry, rate: Number(entry.rate) }));
    const invalidEntry = entries.find((entry) => !String(entry.currency || '').trim() || !String(entry.postingDate || '').trim() || !Number.isFinite(entry.rate) || entry.rate <= 0);
    if (invalidEntry) { setExchangeRatesModal((prev) => ({ ...prev, error: 'Enter a positive exchange rate.' })); return; }
    setExchangeRatesModal((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const savedEntries = [];
      for (const entry of entries) {
        const saved = await saveSalesOrderExchangeRate(entry);
        savedEntries.push({ ...entry, rate: Number(saved.data?.rate) || entry.rate });
      }
      setHeader((prev) => {
        const documentRate = savedEntries.find((e) => String(e.currency).toUpperCase() === String(prev.currency).toUpperCase() && String(e.postingDate) === String(prev.postingDate));
        return documentRate ? { ...prev, exchangeRate: String(documentRate.rate) } : prev;
      });
      setExchangeRatesModal((prev) => ({ ...prev, open: false, loading: false, error: '' }));
    } catch (error) {
      if (Number(error?.response?.status) === 404) {
        setHeader((prev) => {
          const documentRate = entries.find((e) => String(e.currency).toUpperCase() === String(prev.currency).toUpperCase() && String(e.postingDate) === String(prev.postingDate));
          return documentRate ? { ...prev, exchangeRate: String(documentRate.rate) } : prev;
        });
        setExchangeRatesModal((prev) => ({ ...prev, open: false, loading: false, error: '' }));
        return;
      }
      setExchangeRatesModal((prev) => ({ ...prev, loading: false, error: error?.response?.data?.detail || error?.message || 'Failed to save exchange rate.' }));
    }
  }, []);

  const refreshExchangeRate = useCallback((nextCurrency = header.currency, nextDate = header.postingDate) => {
    const currency = String(nextCurrency || '').trim();
    const postingDate = String(nextDate || '').trim();
    const localCurrency = String(refData.local_currency || refData.company_currency || '').trim();
    if (!currency || !postingDate || !localCurrency) return;
    if (currency === localCurrency) {
      setHeader((prev) => prev.exchangeRate ? { ...prev, exchangeRate: '' } : prev);
      return;
    }
    if (!header.exchangeRate) {
      openExchangeRatesModal({ currency, postingDate, initialRate: '' });
    }
  }, [header.currency, header.exchangeRate, header.postingDate, openExchangeRatesModal]);

  useEffect(() => {
    if (currentDocEntry) return;
    if (!header.vendor || !header.currency || !header.postingDate) return;
    refreshExchangeRate(header.currency, header.postingDate);
  }, [currentDocEntry, header.vendor, header.currency, header.postingDate, refreshExchangeRate]);

  // â”€â”€ handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleHeaderChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValErrors(p => ({ ...p, header: { ...p.header, [name]: '' }, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));
    
    if (name === 'series') {
      handleSeriesChange(value);
      return;
    }
    if (name === 'transactionType') {
      setHeader(p => ({
        ...p,
        transactionType: value,
        series: '',
        nextNumber: '',
      }));
      setSeriesReloadToken((token) => token + 1);
      return;
    }
    if (name === 'branch') {
      const nextWarehouses = filterWarehousesByBranch(effectiveWarehouses, value);
      setHeader(p => ({
        ...p,
        branch: value,
        series: '',
        nextNumber: '',
        warehouse: nextWarehouses.some((w) => String(w.WhsCode) === String(p.warehouse))
          ? p.warehouse
          : '',
      }));
      setSeriesReloadToken((token) => token + 1);
      return;
    }
    if (name === 'warehouse') {
      const warehouseBranch = getBranchFromWarehouseCode(value);
      setHeader(p => ({
        ...p,
        warehouse: value,
        branch: warehouseBranch || p.branch,
        ...(warehouseBranch && warehouseBranch !== normalizeBranchSelection(p.branch)
          ? { series: '', nextNumber: '' }
          : {}),
      }));
      if (warehouseBranch && warehouseBranch !== normalizeBranchSelection(header.branch)) {
        setSeriesReloadToken((token) => token + 1);
      }
      return;
    }
    
    if (name === 'shipToCode') {
      handleShipToCodeChange(value);
      return;
    }
    
    if (name === 'billToCode') {
      handleBillToCodeChange(value);
      return;
    }
    
    if (name === 'vendor') {
      setHeader(prev => {
        const prep = { ...prev, [name]: value };
        const { nextHeader } = syncVendor(value, prep);
        nextHeader.contactPerson = '';
        return nextHeader;
      });
      loadVendorDetails(value);
      return;
    }
    if (name === 'currencyMode') {
      setHeader((prev) => ({ ...prev, currencyMode: value }));
      return;
    }
    if (name === 'currency') {
      setHeader((prev) => ({
        ...prev,
        currency: String(value || '').trim(),
        exchangeRate: '',
      }));
      return;
    }
    if (name === 'postingDate') {
      setHeader((prev) => ({
        ...prev,
        postingDate: value,
        exchangeRate: String(prev.currency || '').trim() === String(refData.local_currency || refData.company_currency || '').trim()
          ? prev.exchangeRate
          : '',
      }));
      return;
    }
    if (name === 'purchaser') {
      if (value === '__DEFINE_NEW__') {
        openSalesEmployeeSetup();
        return;
      }

      const selectedEmployee = resolveSalesEmployeeByName(value);
      setHeader((prev) => ({
        ...prev,
        purchaser: value,
        salesEmployee: selectedEmployee ? String(selectedEmployee.SlpCode) : '-1',
      }));
      return;
    }
    if (numDec[name] !== undefined && type !== 'checkbox') {
      setHeader(p => ({ ...p, [name]: sanitize(value, numDec[name]) }));
      return;
    }
    setHeader(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
  };
  
  const handleShipToCodeChange = (addressCode) => {
    if (!addressCode) {
      setHeader(p => ({ ...p, shipToCode: '', shipToAddress: '' }));
      return;
    }
    
    // Find the address from customer addresses
    const addr = vendorEffectiveShipToAddresses.find(a => String(a.Address) === String(addressCode))
      || vendorEffectiveBillToAddresses.find(a => String(a.Address) === String(addressCode));
    if (addr) {
      const formattedAddress = fmtAddr(addr);
      setHeader(p => ({ 
        ...p, 
        shipToCode: addressCode, 
        shipToAddress: formattedAddress,
        placeOfSupply: addr.State || p.placeOfSupply
      }));
    } else {
      setHeader(p => ({ ...p, shipToCode: addressCode }));
    }
  };
  
  const handleBillToCodeChange = (addressCode) => {
    if (!addressCode) {
      setHeader(p => ({ ...p, billToCode: '', billToAddress: '' }));
      return;
    }
    
    // Find the address from customer addresses
    const addr = vendorEffectiveBillToAddresses.find(a => String(a.Address) === String(addressCode))
      || vendorEffectiveShipToAddresses.find(a => String(a.Address) === String(addressCode));
    if (addr) {
      const formattedAddress = fmtAddr(addr);
      setHeader(p => ({ 
        ...p, 
        billToCode: addressCode, 
        billToAddress: formattedAddress
      }));
    } else {
      setHeader(p => ({ ...p, billToCode: addressCode }));
    }
  };
  
  const handleSeriesChange = (seriesValue) => {
      const manual = ['-1', 'manual', '__sap_manual__'].includes(String(seriesValue).toLowerCase());
      if (manual && !canUseManualSeries(refData)) return;
      const selected = (refData.series || []).find(row => String(row.Series) === String(seriesValue));
      setHeader(prev => ({ ...prev, series: manual ? '-1' : selected ? String(selected.Series) : '', nextNumber: manual ? '' : String(selected?.NextNumber ?? ''), docNo: '' }));
      setPageState(prev => ({ ...prev, error: '', success: '' }));
    };

  const openLineLookup = (field, lineIndex, udfField = null) => {
    if (!isDocumentEditable) return;
    const isAccount = field === 'glAccount';
    const isDistributionRule = field === 'distRule';

    setLineLookupModal({
      open: true,
      lineIndex,
      field,
      udfKey: udfField?.key || '',
      title: isAccount
        ? 'List of G/L Accounts'
        : isDistributionRule
          ? 'List of Distribution Rules'
          : 'List of Items',
      options: isAccount
        ? accountLookupOptions
        : isDistributionRule
          ? distributionRuleLookupOptions
          : itemLookupOptions,
      searchPlaceholder: isAccount
        ? 'Search G/L accounts'
        : isDistributionRule
          ? 'Search distribution rules'
          : 'Search items',
      emptyMessage: isAccount
        ? 'No G/L accounts found'
        : isDistributionRule
          ? 'No distribution rules found'
          : 'No items found',
      columns: isAccount
        ? [
            { key: 'accountNumber', label: 'Account Number', width: 150, primary: true },
            { key: 'accountName', label: 'Account Name' },
            { key: 'accountBalance', label: 'Account Balance', width: 130, align: 'right' },
            { key: 'inactive', label: 'Inactive', width: 90 },
          ]
        : isDistributionRule
          ? [
              { key: 'factorCode', label: 'Distr. Rule', width: 140, primary: true },
              { key: 'factorDescription', label: 'Description' },
            ]
          : [
              { key: 'itemCode', label: 'Item No.', width: 150, primary: true },
              { key: 'itemName', label: 'Item Description' },
              { key: 'salesUnit', label: 'UoM', width: 100 },
            ],
    });
  };

  const closeLineLookup = () => {
    setLineLookupModal((prev) => ({ ...prev, open: false, lineIndex: -1, field: '', udfKey: '' }));
  };

  const handleLineLookupSelect = (option) => {
    if (lineLookupModal.lineIndex < 0 || !lineLookupModal.field) return;
    const selectedValue = option?.value || '';

    setLines((prev) => prev.map((line, index) => {
      if (index !== lineLookupModal.lineIndex) return line;

      if (lineLookupModal.udfKey) {
        return {
          ...line,
          udf: {
            ...(line.udf || {}),
            [lineLookupModal.udfKey]: selectedValue,
          },
        };
      }

      const next = { ...line, [lineLookupModal.field]: selectedValue };
      if (lineLookupModal.field === 'distRule') {
        next.cogsDistRule = selectedValue;
      }
      return next;
    }));

    markDirty();
    closeLineLookup();
  };

  const handleLineChange = async (i, e) => {
    const { name, value } = e.target;
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
            const next = { ...line, itemNo: value, taxCodeManuallyOverridden: false };
            
            // Step 1: Set Item Details
            next.itemDescription = item.ItemName || next.itemDescription;
            Object.assign(next, getItemDefaultUom(item, refData.uom_groups, 'sales'));
            next.glAccount = next.glAccount || item.SalesGLAccount || item.IncomeAccount || item.IncomeAcct || item.RevenuesAccount || item.RevenuesAc || '';
            next.distRule = next.distRule || item.DistributionRule || item.OcrCode || '';
            next.cogsDistRule = next.distRule || next.cogsDistRule || item.COGSDistributionRule || item.COGSCostingCode || item.CogsOcrCod || '';
            
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
              next.taxCodeRepeat = '';
              next.total = fmtDec(calcLineTotal(next), numDec.total);
              return next;
            }
            
            // Step 6: Auto-Determine Tax Code using Tax Engine
            const determinedTaxCode = determineTaxCode(
              item,
              gstState,  // shipToState
              gstState,  // billToState (using same as shipTo)
              false,     // useBillToForTax
              companyState,
              effectiveTaxCodes
            );
            
            if (determinedTaxCode) {
              next.taxCode = determinedTaxCode;
              next.taxCodeRepeat = determinedTaxCode;
              console.log(`âœ… Auto-assigned tax code: ${determinedTaxCode} (${getGSTTypeLabel(companyState, gstState)})`);
            } else {
              console.warn('âš ï¸ Could not determine tax code automatically');
              next.taxCode = '';
              next.taxCodeRepeat = '';
            }
            
            next.total = fmtDec(calcLineTotal(next), numDec.total);
            return next;
          }));
        }
      } catch (error) {
        console.error('âŒ Error fetching HSN code:', error);
        // Fallback to basic item selection without HSN
        setLines(prev => prev.map((line, idx) => {
          if (idx !== i) return line;
          const next = { ...line, itemNo: value, taxCodeManuallyOverridden: false };
          const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));
          if (item) {
            next.itemDescription = item.ItemName || next.itemDescription;
            Object.assign(next, getItemDefaultUom(item, refData.uom_groups, 'sales'));
            next.glAccount = next.glAccount || item.SalesGLAccount || item.IncomeAccount || item.IncomeAcct || item.RevenuesAccount || item.RevenuesAc || '';
            next.distRule = next.distRule || item.DistributionRule || item.OcrCode || '';
            next.cogsDistRule = next.distRule || next.cogsDistRule || item.COGSDistributionRule || item.COGSCostingCode || item.CogsOcrCod || '';
            next.hsnCode = item.SWW || item.HSNCode || item.U_HSNCode || next.hsnCode || '';
            
            // Set batch management flag
            next.batchManaged = isBatchManaged(item);
            next.inventoryUOM = item.InventoryUOM || '';
            
            // Check batch availability if batch-managed and warehouse is set
            if (next.batchManaged && next.whse) {
              checkBatchAvailability(value, next.whse).then(hasBatches => {
                setLines(prevLines => prevLines.map((l, lIdx) => 
                  lIdx === i ? { ...l, hasBatchesAvailable: hasBatches } : l
                ));
              });
            }
          }
          next.total = fmtDec(calcLineTotal(next), numDec.total);
          return next;
        }));
      }
      return;
    }
    
    // Handle warehouse change - check batch availability
    if (name === 'whse' && value) {
      setLines(prev => prev.map((line, idx) => {
        if (idx !== i) return line;
        const next = { ...line, whse: value };
        
        // Check batch availability if item is batch-managed
        if (next.batchManaged && next.itemNo) {
          checkBatchAvailability(next.itemNo, value).then(hasBatches => {
            setLines(prevLines => prevLines.map((l, lIdx) => 
              lIdx === i ? { ...l, hasBatchesAvailable: hasBatches } : l
            ));
          });
        }
        
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      }));
      return;
    }
    
    // Handle UoM change - fetch conversion factor
    if (name === 'uomCode' && value) {
      setLines(prev => prev.map((line, idx) => {
        if (idx !== i) return line;
        const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(line.itemNo || ''));
        const next = applyUomCodeSelection(line, value, getLineUomOptions(line, item, refData.uom_groups));
        
        // Fetch UoM conversion factor if item is selected
        if (next.itemNo) {
          fetchUomConversionFactor(next.itemNo, value)
            .then(response => {
              const { factor, inventoryUOM: invUoM } = response.data;
              console.log('ðŸ“¦ [AR Credit Memo] UoM conversion:', { 
                itemCode: next.itemNo, 
                uomCode: value, 
                factor, 
                inventoryUOM: invUoM 
              });
              
              setLines(prevLines => prevLines.map((l, lIdx) => 
                lIdx === i ? { 
                  ...l, 
                  uomFactor: factor || 1,
                  inventoryUOM: invUoM || l.inventoryUOM
                } : l
              ));
            })
            .catch(error => {
              console.error('âŒ [AR Credit Memo] Error fetching UoM conversion:', error);
            });
        }
        
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      }));
      return;
    }
    
    setLines(prev => prev.map((line, idx) => {
      if (idx !== i) return line;
      const next = { ...line, [name]: numDec[name] !== undefined ? sanitize(value, numDec[name]) : value };
      if (name === 'uomName') next.uomNameEdited = true;
      if (name === 'uomCode') {
        const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
        Object.assign(next, applyUomCodeSelection(next, value, getLineUomOptions(next, item, refData.uom_groups)));
      }
      if (name === 'distRule') {
        next.cogsDistRule = value;
      }
      if (name === 'taxCode') {
        next.taxCodeManuallyOverridden = Boolean(String(next.taxCode || '').trim());
        next.taxCodeRepeat = value;
      }
      next.total = fmtDec(calcLineTotal(next), numDec.total);
      return next;
    }));
  };

  const handleNumBlur = (field, target = 'line', i = null) => {
    const d = numDec[field];
    if (d === undefined) return;
    if (target === 'header') { setHeader(p => ({ ...p, [field]: fmtDec(p[field], d) })); return; }
    setLines(p => p.map((l, idx) => idx === i ? { ...l, [field]: fmtDec(l[field], d) } : l));
  };

  const handleTablePaste = ({ startRowIndex, patches }) => {
    if (!isDocumentEditable) return;
    markDirty();
    setPageState(previous => ({ ...previous, error: '', success: '' }));
    setValErrors(previous => ({ ...previous, form: '' }));
    setLines(previous => applyDocumentTablePaste({
      lines: previous,
      patches,
      startRowIndex,
      createLine: () => ({
        ...createLine(rowUdfDefinitions),
        branch: header.branch || '',
        whse: header.warehouse || '',
      }),
      transformLine: (pastedLine, _rowIndex, rowPatch) => {
        const pastedKeys = new Set(rowPatch.cells.map(cell => cell.key));
        const next = hydrateWorkbookDocumentLine({
          line: pastedLine,
          createLine,
          rowUdfDefinitions,
          normalizeUdfState,
          items: refData.items,
          fallbackWarehouse: header.warehouse,
        });
        if (pastedKeys.has('uomCode')) {
          const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
          Object.assign(next, applyUomCodeSelection(next, next.uomCode, getLineUomOptions(next, item, refData.uom_groups)));
        }
        if (pastedKeys.has('taxCode')) {
          next.taxCodeManuallyOverridden = Boolean(String(next.taxCode || '').trim());
          next.taxCodeRepeat = next.taxCode;
        }
        if (pastedKeys.has('distRule')) next.cogsDistRule = next.distRule;
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      },
    }));
  };

  const handleTableClipboardFeedback = (message, type) => {
    setPageState(previous => ({
      ...previous,
      error: type === 'error' ? message : '',
      success: type === 'error' ? '' : message,
    }));
  };

  // â”€â”€ Freight Selection Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openFreightModal = async () => {
    console.log('... Opening freight modal, docEntry:', currentDocEntry);
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
    console.log('... Applied freight charges:', summary);
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

  const addLine = () => {
    // Validate the last line before adding a new one
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const lastIndex = lines.length - 1;
      const errors = {};
      
      // Check if last line has an item
      if (!String(lastLine.itemNo || '').trim()) {
        errors.itemNo = 'Item is required before adding a new line';
      }
      
      // Check if last line has HSN Code
      if (!String(lastLine.hsnCode || '').trim()) {
        errors.hsnCode = 'HSN Code is required before adding a new line';
      }
      
      // Check if last line has quantity
      if (!lastLine.quantity || Number(lastLine.quantity) <= 0) {
        errors.quantity = 'Quantity is required before adding a new line';
      }
      
      // Check if last line has unit price
      if (!lastLine.unitPrice || Number(lastLine.unitPrice) <= 0) {
        errors.unitPrice = 'Unit Price is required before adding a new line';
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
    markDirty();
    setLines(p => [...p, { 
      ...createLine(rowUdfDefinitions), 
      branch: header.branch || '', 
      loc: header.branch || '',
      whse: header.warehouse || DEFAULT_WAREHOUSE_CODE
    }]);
  };

  const removeLine = (i) => {
    markDirty();
    setValErrors(p => { const nl = { ...p.lines }; delete nl[i]; return { ...p, lines: nl, form: '' }; });
    setLines(p => p.filter((_, idx) => idx !== i));
  };

  const handleHeaderUdfChange = (k, v) => {
    markDirty();
    setHeaderUdfs(p => ({ ...p, [k]: v }));
  };
  const handleRowUdfChange = (i, k, v) => {
    markDirty();
    setLines(p => p.map((l, idx) => idx === i ? { ...l, udf: { ...(l.udf || {}), [k]: v } } : l));
  };
  const updateFormSetting = (g, k, prop, val) => setFormSettings((previous) => (
    updateFormSettingPreference(previous, g, k, prop, val)
  ));
  const toggleHeaderUdfs = () => {
    setFormSettingsOpen(false);
    setSidebarOpen(p => !p);
  };
  const toggleFormSettings = () => {
    setSidebarOpen(false);
    if (formSettingsOpen) {
      setFormSettingsOpen(false);
      return;
    }
    setFormSettingsOpen(true);
  };

  // â”€â”€ Address Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openAddressModal = (type) => {
    const shipAddress = resolveARCreditMemoAddress(
      header.shipToCode,
      vendorEffectiveShipToAddresses,
      header.shipToAddress || header.shipTo,
    );
    const billAddress = resolveARCreditMemoAddress(
      header.billToCode || header.payToCode,
      vendorEffectiveBillToAddresses,
      header.billToAddress || header.payTo,
    );
    const activeAddress = type === 'billTo' ? billAddress : shipAddress;
    const activeComponents = type === 'billTo'
      ? header.billToAddressComponents
      : header.shipToAddressComponents;

    setAddressForm(
      {
        ...mapAddressToModalForm(activeAddress, {
          shipToCode: header.shipToCode || shipAddress?.Address || '',
          shipToAddress: header.shipToAddress || header.shipTo || (shipAddress ? fmtAddr(shipAddress) : ''),
          billToCode: header.billToCode || header.payToCode || billAddress?.Address || '',
          billToAddress: header.billToAddress || header.payTo || (billAddress ? fmtAddr(billAddress) : ''),
        }),
        ...(activeComponents || {}),
      },
    );
    setAddressModal({ type });
  };

  const closeAddressModal = () => {
    setAddressModal(null);
  };

  const saveAddressModal = () => {
    const formatted = formatAddressComponent(addressForm);
    const components = pickAddressComponentFields(addressForm);
    markDirty();

    if (addressModal.type === 'shipTo') {
      setHeader(p => ({
        ...p,
        shipToCode: addressForm.shipToCode || p.shipToCode,
        shipToAddress: formatted,
        shipTo: formatted,
        shipToAddressComponents: components,
        billToCode: addressForm.billToCode || p.billToCode,
        payToCode: addressForm.billToCode || p.payToCode,
        billToAddress: addressForm.billToAddress || p.billToAddress,
        payTo: addressForm.billToAddress || p.payTo,
        placeOfSupply: addressForm.state || '',
      }));
    } else {
      setHeader(p => ({
        ...p,
        shipToCode: addressForm.shipToCode || p.shipToCode,
        shipToAddress: addressForm.shipToAddress || p.shipToAddress,
        shipTo: addressForm.shipToAddress || p.shipTo,
        billToCode: addressForm.billToCode || p.billToCode,
        payToCode: addressForm.billToCode || p.payToCode,
        billToAddress: formatted,
        payTo: formatted,
        billToAddressComponents: components,
        placeOfSupply: header.useBillToForTax ? addressForm.state || '' : p.placeOfSupply,
      }));
    }
    closeAddressModal();
  };

  const handleAddressFormChange = (e) => {
    const { name, value } = e.target;

    if (name === 'shipToCode') {
      const selectedAddress = resolveARCreditMemoAddress(value, vendorEffectiveShipToAddresses);
      setAddressForm(prev => {
        const nextState = {
          ...prev,
          shipToCode: value,
          shipToAddress: selectedAddress ? fmtAddr(selectedAddress) : prev.shipToAddress,
        };
        return addressModal?.type === 'shipTo'
          ? mapAddressToModalForm(selectedAddress, nextState)
          : nextState;
      });
      return;
    }

    if (name === 'billToCode') {
      const selectedAddress = resolveARCreditMemoAddress(value, vendorEffectiveBillToAddresses);
      setAddressForm(prev => {
        const nextState = {
          ...prev,
          billToCode: value,
          billToAddress: selectedAddress ? fmtAddr(selectedAddress) : prev.billToAddress,
        };
        return addressModal?.type === 'billTo'
          ? mapAddressToModalForm(selectedAddress, nextState)
          : nextState;
      });
      return;
    }

    setAddressForm(p => ({ ...p, [name]: value }));
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

  // â”€â”€ BP Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openBpModal = () => {
    setBpModal(true);
  };

  const closeBpModal = () => {
    setBpModal(false);
  };

  // â”€â”€ State Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openStateModal = () => {
    setStateModal(true);
  };

  const closeStateModal = () => {
    setStateModal(false);
  };

  const handleStateSelect = (state) => {
    setHeader(p => ({ ...p, placeOfSupply: getStateCodeValue(state, refData.states) }));
  };

  // â”€â”€ BP Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  const handleTaxInfoFormChange = (e) => {
    const { name, value } = e.target;
    setTaxInfoForm(p => ({ ...p, [name]: value }));
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

  // â”€â”€ HSN Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openHSNModal = (lineIndex) => {
    setHsnModal({ open: true, lineIndex });
  };

  const closeHSNModal = () => {
    setHsnModal({ open: false, lineIndex: -1 });
  };

  const handleHSNSelect = (hsn) => {
    if (hsnModal.lineIndex >= 0) {
      setLines(prev => prev.map((line, idx) => 
        idx === hsnModal.lineIndex 
          ? { ...line, hsnCode: hsn.code || '' }
          : line
      ));
    }
    closeHSNModal();
  };

  // â”€â”€ Item Selection Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openItemModal = async (lineIndex) => {
    console.log('ðŸ” Opening item modal for line:', lineIndex);
    setItemModal({ open: true, lineIndex, items: [], loading: true });
    
    try {
      const response = await fetchItemsForModal();
      console.log('ðŸ“Š Items count:', response.data.items?.length || 0);
      
      setItemModal(prev => ({
        ...prev,
        items: response.data.items || [],
        loading: false,
      }));
    } catch (error) {
      console.error('âŒ Failed to load items:', error);
      console.error('Error details:', error.response?.data || error.message);
      setItemModal(prev => ({
        ...prev,
        items: [],
        loading: false,
      }));
    }
  };

  const closeItemModal = () => {
    setItemModal({ open: false, lineIndex: -1, items: [], loading: false });
  };

  const handleItemSelect = async (item) => {
    if (itemModal.lineIndex < 0) return;
    
    const lineIndex = itemModal.lineIndex;
    const mergedItem = mergeItemMaster(item, refData.items);
    const currentLine = lines[lineIndex];
    
    try {
      const hsnRes = await fetchHSNCodeFromItem(mergedItem.ItemCode);
      const hsnData = hsnRes.data;
      
      // Check if item is batch-managed
      const itemIsBatchManaged = isBatchManaged(mergedItem);
      
      // Get UoM - use SalesUnit or InventoryUOM
      const selectedUoM = mergedItem.SalesUnit || mergedItem.InventoryUOM || '';
      
      // Fetch UoM conversion factor if UoM is set
      let uomFactor = 1;
      let inventoryUOM = mergedItem.InventoryUOM || '';
      
      if (selectedUoM && mergedItem.ItemCode) {
        try {
          const uomRes = await fetchUomConversionFactor(mergedItem.ItemCode, selectedUoM);
          uomFactor = uomRes.data.factor || 1;
          inventoryUOM = uomRes.data.inventoryUOM || mergedItem.InventoryUOM || '';
          console.log('ðŸ“¦ [AR Credit Memo - handleItemSelect] UoM conversion:', { 
            itemCode: mergedItem.ItemCode, 
            uomCode: selectedUoM, 
            factor: uomFactor,
            inventoryUOM 
          });
        } catch (uomError) {
          console.error('âŒ [AR Credit Memo - handleItemSelect] Error fetching UoM conversion:', uomError);
        }
      }
      
      // Check batch availability if batch-managed and warehouse is set
      let hasBatchesAvailable = false;
      if (itemIsBatchManaged && currentLine.whse) {
        try {
          hasBatchesAvailable = await checkBatchAvailability(mergedItem.ItemCode, currentLine.whse);
        } catch (batchError) {
          console.error('âŒ [AR Credit Memo - handleItemSelect] Error checking batch availability:', batchError);
        }
      }
      
      setLines(prev => prev.map((line, idx) => {
        if (idx === lineIndex) {
          const updatedLine = {
            ...hydrateDocumentLineFromItem(line, mergedItem, {
              side: 'sales',
              hsnCode: hsnData.hsnCode || hsnData.hsn_sww || '',
              fallbackWarehouse: header.warehouse || DEFAULT_WAREHOUSE_CODE,
              syncUnitPriceUdf: false,
              calcLineTotal,
              formatTotal: (value) => fmtDec(value, numDec.total),
              uomGroups: refData.uom_groups,
            }),
            uomCode: selectedUoM,
            batchManaged: itemIsBatchManaged,
            hasBatchesAvailable: hasBatchesAvailable,
            inventoryUOM: inventoryUOM,
            uomFactor: uomFactor,
            batches: [],
          };
          updatedLine.glAccount = updatedLine.glAccount || mergedItem.SalesGLAccount || mergedItem.IncomeAccount || mergedItem.IncomeAcct || mergedItem.RevenuesAccount || mergedItem.RevenuesAc || '';
          updatedLine.distRule = updatedLine.distRule || mergedItem.DistributionRule || mergedItem.OcrCode || '';
          updatedLine.cogsDistRule = updatedLine.distRule || updatedLine.cogsDistRule || mergedItem.COGSDistributionRule || mergedItem.COGSCostingCode || mergedItem.CogsOcrCod || '';
          
          // Auto-populate tax code based on HSN
          if (updatedLine.hsnCode) {
            const taxCode = determineTaxCode(updatedLine.hsnCode, refData.tax_codes || []);
            if (taxCode) {
              updatedLine.taxCode = taxCode;
            }
          }
          
          return updatedLine;
        }
        return line;
      }));
      
      closeItemModal();
    } catch (error) {
      console.error('Error selecting item:', error);
      setLines(prev => prev.map((line, idx) => {
        if (idx === lineIndex) {
          const nextLine = hydrateDocumentLineFromItem(line, mergedItem, {
            side: 'sales',
            fallbackWarehouse: header.warehouse || DEFAULT_WAREHOUSE_CODE,
            syncUnitPriceUdf: false,
            calcLineTotal,
            formatTotal: (value) => fmtDec(value, numDec.total),
            uomGroups: refData.uom_groups,
          });
          return {
            ...nextLine,
            glAccount: nextLine.glAccount || mergedItem.SalesGLAccount || mergedItem.IncomeAccount || mergedItem.IncomeAcct || mergedItem.RevenuesAccount || mergedItem.RevenuesAc || '',
            distRule: nextLine.distRule || mergedItem.DistributionRule || mergedItem.OcrCode || '',
            cogsDistRule: nextLine.distRule || nextLine.cogsDistRule || mergedItem.COGSDistributionRule || mergedItem.COGSCostingCode || mergedItem.CogsOcrCod || '',
          };
        }
        return line;
      }));
      closeItemModal();
    }
  };

  // â”€â”€ Sync warehouse and branch from header to lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Sync branch to all lines when header branch changes
  useEffect(() => {
    if (header.branch) {
      console.log('ðŸ”„ Syncing branch to all lines:', header.branch);
      setLines(prev => {
        const updated = prev.map(l => ({ 
          ...l, 
          branch: String(header.branch), 
          loc: String(header.branch)
        }));
        console.log('âœ… Lines updated with branch:', updated.map(l => ({ branch: l.branch, loc: l.loc })));
        return updated;
      });
    }
  }, [header.branch]);

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

    setLines(prev => prev.map(line => (
      line.whse && !allowedWarehouseCodes.has(String(line.whse))
        ? { ...line, whse: '' }
        : line
    )));
  }, [branchFilteredWarehouses, header.branch, refData.warehouses.length]);

  // Sync warehouse to all lines when header warehouse changes
  useEffect(() => {
    if (header.warehouse) {
      setLines(prev => prev.map(l => ({ ...l, whse: header.warehouse })));
    }
  }, [header.warehouse]);

  // â”€â”€ Recalculate Tax Codes on State/Address Changes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
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
    });

    // Recalculate tax codes for all lines with items using functional update
    setLines(prevLines => {
      return recalculateAllTaxCodes(
        prevLines,
        refData.items,
        header.placeOfSupply,  // shipToState
        header.placeOfSupply,  // billToState
        false,                 // useBillToForTax
        companyState,
        effectiveTaxCodes
      );
    });
  }, [header.placeOfSupply, header.vendor, refData.company_address, selectedBranch, refData.items, effectiveTaxCodes]);

  // Continue in next part...

  // â”€â”€ validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const validate = () => {
    console.log('ðŸ” Starting validation...');
    const isUpdate = !!currentDocEntry;
    const e = { header: {}, lines: {}, form: '' };
    const localCurrency = String(refData.local_currency || refData.company_currency || '').trim();
    const documentCurrency = String(header.currency || '').trim();
    if (documentCurrency && localCurrency && documentCurrency !== localCurrency) {
      const rate = Number(header.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        e.header.exchangeRate = 'Exchange rate is required for foreign currency documents.';
        e.form = 'Please enter the SAP exchange rate before saving.';
        return e;
      }
    }
    
    try {
      if (!isUpdate) {
        console.log('ðŸ” Validating vendor:', header.vendor);
        const vc = String(header.vendor || '').trim();
        if (!vc) { 
          console.log('âŒ Vendor validation failed');
          e.header.vendor = 'Select a customer.'; 
          e.form = 'Please correct the highlighted fields.'; 
          return e; 
        }
        
      }
      
      console.log('ðŸ” Validating postingDate:', header.postingDate);
      if (!String(header.postingDate || '').trim()) { 
        console.log('âŒ Posting date validation failed');
        e.header.postingDate = 'Posting date is required.'; 
        e.form = 'Please correct the highlighted fields.'; 
        return e; 
      }
      
      console.log('ðŸ” Validating documentDate:', header.documentDate);
      if (!String(header.documentDate || '').trim()) { 
        console.log('âŒ Document date validation failed');
        e.header.documentDate = 'Document date is required.'; 
        e.form = 'Please correct the highlighted fields.'; 
        return e; 
      }

      console.log('ðŸ” Filtering lines with items...');
      const pop = lines.filter(l => String(l.itemNo || '').trim());
      console.log(`ðŸ” Found ${pop.length} lines with items out of ${lines.length} total lines`);
      
      if (!pop.length) { 
        console.log('âŒ No item lines found');
        e.form = 'Add at least one item line.'; 
        return e; 
      }
      
      console.log('ðŸ” Validating individual lines...');
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        console.log(`ðŸ” Checking line ${i}:`, { 
          itemNo: l.itemNo, 
          quantity: l.quantity, 
          hsnCode: l.hsnCode,
          unitPrice: l.unitPrice,
          uomCode: l.uomCode,
          whse: l.whse,
          taxCode: l.taxCode
        });
        
        if (!String(l.itemNo || '').trim()) {
          console.log(`â­ï¸ Skipping empty line ${i}`);
          continue;
        }

        if (!l.itemNo) {
          console.log(`âŒ Line ${i}: Item is required`);
          e.lines[i] = { ...(e.lines[i] || {}), itemNo: 'Item is required' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }

        if (!l.quantity || Number(l.quantity) <= 0) {
          console.log(`âŒ Line ${i}: Quantity validation failed`);
          e.lines[i] = { ...(e.lines[i] || {}), quantity: 'Quantity must be > 0' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }

        if (!l.hsnCode && !isUpdate) {
          console.log(`âŒ Line ${i}: HSN Code is required`);
          e.lines[i] = { ...(e.lines[i] || {}), hsnCode: 'HSN Code is required' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }

        if ((!l.unitPrice || Number(l.unitPrice) <= 0) && !isUpdate) {
          console.log(`âŒ Line ${i}: Unit Price validation failed`);
          e.lines[i] = { ...(e.lines[i] || {}), unitPrice: 'Unit Price must be > 0' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }

        if (!l.uomCode && !isUpdate) {
          console.log(`âŒ Line ${i}: UoM is required`);
          e.lines[i] = { ...(e.lines[i] || {}), uomCode: 'UoM is required' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }

        if (!l.whse && !isUpdate) {
          console.log(`âŒ Line ${i}: Warehouse is required`);
          e.lines[i] = { ...(e.lines[i] || {}), whse: 'Warehouse is required' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }
        
        console.log(`ðŸ” Line ${i}: Validating tax code:`, l.taxCode);
        const hasTaxCode = String(l.taxCode || '').trim();
        const taxCodeExists = !hasTaxCode || effectiveTaxCodes.some(t => String(t.Code) === String(l.taxCode));
        if (!taxCodeExists) {
          console.log(`âŒ Line ${i}: Tax code '${l.taxCode}' is not valid`);
          e.lines[i] = { ...(e.lines[i] || {}), taxCode: `Tax code '${l.taxCode}' is not valid in SAP B1` };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }
      }
      
      // Validate GST tax code combinations after checking all lines
      console.log('ðŸ” Validating GST tax code combinations...');
      const taxCodesUsed = new Set(pop.map(l => l.taxCode).filter(Boolean));
      console.log('ðŸ” Tax codes used:', Array.from(taxCodesUsed));
      
      const sgstCodes = getTaxComponentCodes(taxCodesUsed, effectiveTaxCodes, 'SGST');
      const cgstCodes = getTaxComponentCodes(taxCodesUsed, effectiveTaxCodes, 'CGST');

      console.log('ðŸ” SGST codes:', sgstCodes);
      console.log('ðŸ” CGST codes:', cgstCodes);

      if (sgstCodes.length > 0 && cgstCodes.length === 0) {
        console.log('âŒ SGST requires CGST');
        e.form = 'SGST requires CGST to be applied as well';
        return e;
      }
      if (cgstCodes.length > 0 && sgstCodes.length === 0) {
        console.log('âŒ CGST requires SGST');
        e.form = 'CGST requires SGST to be applied as well';
        return e;
      }
      if (sgstCodes.length > 0 && cgstCodes.length > 0) {
        console.log('ðŸ” Validating SGST and CGST rates match...');
        const sgstRates = sgstCodes.map(code => {
          const tax = findTaxCode(effectiveTaxCodes, code);
          return tax ? parseNum(tax.Rate) : 0;
        });
        const cgstRates = cgstCodes.map(code => {
          const tax = findTaxCode(effectiveTaxCodes, code);
          return tax ? parseNum(tax.Rate) : 0;
        });
        console.log('ðŸ” SGST rates:', sgstRates);
        console.log('ðŸ” CGST rates:', cgstRates);
        
        if (sgstRates[0] !== cgstRates[0]) {
          console.log('âŒ SGST and CGST rates do not match');
          e.form = 'SGST and CGST rates must be equal';
          return e;
        }
      }

      // Prevent save if total is 0
      console.log('ðŸ” Calculating totals...');
      const currentTotals = calcTotals();
      console.log('ðŸ” Total:', currentTotals.total);
      
      if (currentTotals.total <= 0) {
        console.log('âŒ Total is 0 or negative');
        e.form = 'Total amount must be greater than 0. Please add items with valid prices.';
        return e;
      }

      console.log('âœ… Validation passed!');
      return e;
      
    } catch (error) {
      console.error('âŒ Validation error:', error);
      console.error('Error stack:', error.stack);
      e.form = `Validation error: ${error.message}`;
      return e;
    }
  };

  // â”€â”€ Copy From Modal Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openCopyFromModal = () => {
    if (currentDocEntry) return;

    console.log('ðŸŸ¢ Copy From Clicked');

    // âœ… ONLY BUYER VALIDATION
    if (!header.vendor) {
      setValErrors({
        header: { vendor: 'Select Customer first' },
        lines: {},
        form: ''
      });
      return;
    }

    // âœ… CLEAR ALL ERRORS
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, error: '', success: '' }));

    setCopyFromModal(true);
  };

  // â”€â”€ Copy From fetch handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchCopyFromDocuments = async (docType) => {
    try {
      if (docType === 'arInvoice') {
        const res = await fetchOpenARInvoicesForCreditMemo(header.vendor || null);
        return res?.data?.invoices || res?.data?.documents || [];
      }
      return [];
    } catch (err) {
      console.error('Error fetching documents:', err);
      throw err;
    }
  };

  const fetchCopyFromDocumentDetails = async (docType, docEntry) => {
    try {
      if (docType === 'arInvoice') {
        const res = await fetchARInvoiceForCreditMemoCopy(docEntry);
        return res.data;
      }
      return null;
    } catch (err) {
      console.error('Error fetching document details:', err);
      throw err;
    }
  };

  // â”€â”€ Copy From handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCopyFrom = (data, sourceType) => {
    setSeriesRevision(value => value + 1);

    console.log('ðŸ“¥ Copy From:', sourceType, data);
    
    const copySource = unwrapCopyFromDocument(data);
    const copiedFreight = summarizeFreightRows(copySource.freightCharges, effectiveTaxCodes);
    setFreightModal({ open: false, freightCharges: copiedFreight.rows, loading: false });
    const baseType = BASE_TYPE[sourceType] || 13;
    const normHeader = normaliseDocumentHeader(copySource.header);
    const firstSourceLine = Array.isArray(copySource.lines) && copySource.lines.length ? copySource.lines[0] : {};
    const copiedWarehouse = firstSourceLine.whse || firstSourceLine.WarehouseCode || firstSourceLine.WhsCode || normHeader.warehouse || DEFAULT_WAREHOUSE_CODE;
    const resolvedBranch = normalizeBranchSelection(normHeader.branch)
      || normalizeBranchSelection(firstSourceLine.branch || firstSourceLine.Branch || firstSourceLine.BPL_IDAssignedToInvoice || firstSourceLine.BPLId)
      || getBranchFromWarehouseCode(copiedWarehouse);
    const copyDate = today();

    setHeader(prev => ({
      ...prev,
      ...normHeader,
      branch: resolvedBranch,
      warehouse: normHeader.warehouse || copiedWarehouse || prev.warehouse,
      postingDate: copyDate,
      documentDate: copyDate,
      deliveryDate: copyDate,
      exchangeRate: copySource.header?.exchangeRate || copySource.header?.docRate || copySource.header?.DocRate || '',
      series: '',
      nextNumber: '',
      freight: fmtDec(copiedFreight.totalNet, numDec.freight),
    }));
    setSeriesReloadToken((token) => token + 1);

    const rawLines = copySource.lines;
    const newLines = rawLines.map((line, idx) => {
      const normalizedLine = normaliseDocumentLine(line, idx, copySource.docEntry, baseType, resolvedBranch);
      const copiedBatches = Array.isArray(line.batches)
        ? line.batches
        : Array.isArray(line.BatchNumbers)
          ? line.BatchNumbers.map((batch) => ({
              batchNumber: batch.batchNumber || batch.BatchNumber || '',
              quantity: batch.quantity || batch.Quantity || '',
              expiryDate: batch.expiryDate || batch.ExpiryDate || '',
            }))
          : [];
      return {
        ...createLine(rowUdfDefinitions),
        ...normalizedLine,
        branch: normalizeBranchSelection(normalizedLine.branch) || resolvedBranch,
        whse: normalizedLine.whse || normalizedLine.WarehouseCode || normalizedLine.WhsCode || copiedWarehouse || DEFAULT_WAREHOUSE_CODE,
        batchManaged: Boolean(copiedBatches.length || line.batchManaged || line.BatchManaged === 'Y'),
        hasBatchesAvailable: Boolean(copiedBatches.length),
        batches: copiedBatches,
      };
    });
    setLines(newLines.length > 0 ? newLines : [createLine(rowUdfDefinitions)]);

    const cardCode = normHeader.vendor;
    if (cardCode && cardCode !== header.vendor) loadVendorDetails(cardCode);

    const labels = { arInvoice: 'A/R Invoice' };
    setPageState(p => ({ ...p, success: `Copied from ${labels[sourceType] || sourceType}` }));
  };

  // â”€â”€ Copy To handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCopyTo = (targetType) => {
    console.log('ðŸ“¤ Copy To:', targetType);
    const targetConfig = {
      arInvoice: { docType: 'arInvoice', label: 'A/R Invoice', path: '/ar-invoice' },
      return: { docType: 'return', label: 'Return', path: '/return/new' },
    }[targetType];

    const copyState = buildCopyToState({
      sourceDocType: 'arCreditMemo',
      sourceLabel: 'A/R Credit Memo',
      sourceDocEntry: currentDocEntry,
      header,
      lines,
      headerUdfs,
      baseType: 14,
      extraState: targetType === 'return'
        ? {
            copyFromDelivery: currentDocEntry,
            deliveryData: {
              header,
              lines,
              headerUdfs,
            },
          }
        : {},
    });

    openCopyToDocument({
      sourceDocType: 'arCreditMemo',
      sourceLabel: 'A/R Credit Memo',
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      targetDocType: targetConfig?.docType,
      targetLabel: targetConfig?.label,
      targetPath: targetConfig?.path,
      copyState,
      restoreState: { arCreditMemoDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
      errorMessage: 'Please save the AR Credit Memo first before copying to another document',
    });
  };

  const handleDuplicate = async () => {
    setSeriesRevision(value => value + 1);

    const duplicateDate = today();
    const duplicated = duplicateDocumentInPlace({
      currentDocEntry,
      header,
      initialHeader: INIT_HEADER,
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
      successMessage: 'A/R credit memo duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      setHeader(prev => ({
        ...prev,
        postingDate: duplicateDate,
        documentDate: duplicateDate,
        deliveryDate: prev.deliveryDate || duplicateDate,
        series: '',
        nextNumber: '',
      }));
      
    }
  };

  // â”€â”€ submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
    docEntry: currentDocEntry, isDirty,
    state: { header, lines, headerUdfs, freightCharges: freightModal.freightCharges, companyDb: activeCompanyDb , company_id: activeCompanyId, companyKey: formSettingsStorageKey },
  });

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!companyFormSettingsReady) {
      setPageState(p => ({ ...p, error: 'Select a company and wait for its Form Settings to load before saving this document.', success: '' }));
      return;
    }
    if (!isDocumentEditable) {
      setPageState(p => ({ ...p, error: 'This document is closed and cannot be edited.', success: '' }));
      return;
    }
    if (currentDocEntry && !hasUnsavedChanges) return;
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
        ...stripSalesDocumentTopLevelUdfs(header),
        deliveryDate: header.deliveryDate || header.postingDate || header.documentDate,
        placeOfSupply: header.placeOfSupply,
        branch: normalizeBranchSelection(header.branch)
          || getBranchFromWarehouseCode(header.warehouse || lines[0]?.whse || ''),
        contactPerson: header.contactPerson,
        totalPaymentDue: fmtDec(totals.total, numDec.totalPaymentDue),
        roundingAmount: getDocumentRoundingPayloadAmount(header, fmtDec(totals.roundingAmount, numDec.totalPaymentDue)),
        roundingAmountIsManual: header.roundingAmountIsManual === true,
      };
      
      // Only include series if it's explicitly set and valid
      if (header.series && String(header.series).trim() && Number(header.series) > 0) {
        prep.series = Number(header.series);
      }
      
      console.log('ðŸ” [Frontend] Submitting AR Credit Memo with header:', prep);
      console.log('ðŸ” [Frontend] Lines:', lines);
      
      const payload = {
        company_id: activeCompanyId,
        header: prep,
        lines: lines.map((line) => ({
          ...stripSalesDocumentTopLevelUdfs(line),
          udf: buildVisibleEnteredRowUdfPayload(
            rowUdfDefinitions,
            line.udf || {},
            formSettings,
            { preserveUnmappedUdfs: false },
          ),
        })),
        freightCharges: freightModal.freightCharges,
        header_udfs: normalizeUdfState(headerUdfDefinitions, headerUdfs),
      };
      const r = currentDocEntry ? await updateARCreditMemo(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitARCreditMemo(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      setSnapshotPending(false);
      setIsDirty(false);
      setLoadedCreditMemo(null);
      setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
      setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setValErrors({ header: {}, lines: {}, form: '' });
      
      if (Array.isArray(refData.series) && refData.series.length > 0) {
        setHeader(prev => ({ ...prev, series: '', nextNumber: '', docNo: '' }));
      }
      
      setPageState(p => ({ ...p, success: `${r.data.message || 'AR Credit Memo saved.'}${dn}` }));
    } catch (e) {
      console.error('âŒ [Frontend] AR Credit Memo submission failed:', e);
      setPageState(p => ({ ...p, error: getErrMsg(e, 'AR Credit Memo submission failed.') }));
    } finally {
      setPageState(p => ({ ...p, posting: false }));
    }
  };

  const resetForm = () => {
    setSeriesRevision(value => value + 1);

    setSnapshotPending(false);
    setIsDirty(false);
    setLoadedCreditMemo(null);
    setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
    setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, error: '', success: '' }));
  };

  const visHdrUdfs = headerUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
  const visibleRowUdfs = rowUdfDefinitions.filter(f => formSettings.rowUdfs?.[f.key]?.visible !== false);
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;
  const documentBodyRef = useRef(null);
  useClosedDocumentViewMode(documentBodyRef, !isDocumentEditable, [activeTab, sidebarOpen, formSettingsOpen]);

  // Continue in next part with render...

  // â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useDocumentSeries({ endpoint: '/ar-credit-memo', companyKey: formSettingsStorageKey, currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form className={`del-page sap-document-page so-sales-order-page${isRightSidebarOpen ? ' del-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>

      {/* toolbar */}
      <div className="del-toolbar sap-document-toolbar">
        <span className="del-toolbar__title">A/R Credit Memo{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="del-btn del-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || formSettingsStatus.queryModeActive}>
          {primaryActionLabel}
        </button>
        <button type="button" className="del-btn sap-document-toolbar__cancel" onClick={resetForm}>
          Cancel
        </button>
      
        <button
          type="button"
          className="del-btn sap-document-toolbar__udf"
          onClick={toggleHeaderUdfs}
        >
          {sidebarOpen ? 'Hide UDFs' : 'Show UDFs'}
        </button>
        <button type="button" className="del-btn sap-document-toolbar__settings" onClick={toggleFormSettings} disabled={!companyFormSettingsReady || formSettingsStatus.queryModeActive} title={formSettingsStatus.queryModeActive ? 'Company SQL Content layout is active' : (companyFormSettingsReady ? 'Choose document-line fields' : 'Loading company Form Settings')}>
          Form Settings
        </button>
        <PrintLayoutToolbar
          documentType="arCreditMemo"
          documentLabel="A/R Credit Memo"
          docEntry={currentDocEntry}
          docNumber={header.docNo}
          disabled={pageState.posting}
          classPrefix="del"
          onSuccess={(message) => setPageState(p => ({ ...p, error: '', success: message }))}
          onError={(message) => setPageState(p => ({ ...p, success: '', error: message }))}
        />
        <JournalEntryPreviewButton
          documentType="arCreditMemo"
          documentLabel="A/R Credit Memo"
          docEntry={currentDocEntry}
          buildPayload={() => ({ header, lines, header_udfs: headerUdfs, freightCharges: freightModal.freightCharges })}
          disabled={pageState.posting}
        />
        <div className="del-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
          <button
            type="button"
            className="del-btn"
            disabled={!isDocumentEditable || !!currentDocEntry || formSettingsStatus.queryModeActive}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const dropdown = e.currentTarget.parentElement;
              const isActive = dropdown.classList.contains('active');
              document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
              if (!isActive) dropdown.classList.add('active');
            }}
          >
            Copy From
          </button>
          <div className="del-dropdown-menu">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openCopyFromModal();
                document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
              }}
            >
              A/R Invoices
            </button>
          </div>
        </div>
        <button
          type="button"
          className="del-btn sap-document-toolbar__copy"
          disabled
          title="No SAP Copy To target is configured for A/R Credit Memo."
        >
          Copy To
        </button>
        {currentDocEntry && (
          <button type="button" className="del-btn sap-document-toolbar__duplicate" onClick={handleDuplicate} disabled={formSettingsStatus.queryModeActive}>
            Duplicate
          </button>
        )}
        <button type="button" className="del-btn sap-document-toolbar__find" onClick={() => navigate('/ar-credit-memo/find')}>Find</button>
        <button type="button" className="del-btn sap-document-toolbar__new" onClick={resetForm}>New</button>
      </div>

      {/* alerts */}
      {pageState.loading && <div className="del-alert del-alert--success" style={{ marginTop: 0 }}>Loading...</div>}
      {pageState.error && <div className="del-alert del-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="del-alert del-alert--success">{pageState.success}</div>}
      {refData.warnings?.length > 0 && (
        <div className="alert alert-warning py-2" style={{ fontSize: 11 }}>
          <strong>SAP warnings:</strong>
          {refData.warnings.map((w, i) => <div key={i}>{w}</div>)}
          <div style={{ marginTop: 4, color: '#555' }}>Dropdowns are showing fallback values. Connect to SAP to load live data.</div>
          <div style={{ marginTop: 4, color: '#d00', fontWeight: 600 }}>âš ï¸ Tax codes shown are examples only. Use actual SAP tax codes to avoid submission errors.</div>
        </div>
      )}

      <fieldset ref={documentBodyRef} className="del-fieldset" aria-disabled={!isDocumentEditable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <div className={`sap-document-layout so-layout${isRightSidebarOpen ? ' is-sidebar-open' : ' sap-document-layout--no-udf'}`}>
        <div className="sap-document-main so-layout__main">

            {/* â•â• HEADER CARD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="del-header-card">
              <div className="row g-2">
                {/* LEFT COLUMN */}
                <div className="col-md-6">
                  <div className="del-field-grid del-field-grid--single">
                    
                    {/* Buyer's Code */}
                    <div className="del-field">
                      <label className="del-field__label">Buyer's Code *</label>
                      <div className="sap-input-group">
                        <input
                          name="vendor"
                          className={`del-field__input${valErrors.header.vendor ? ' del-field__input--error' : ''}`}
                          value={header.vendor}
                          onChange={handleHeaderChange}
                          disabled={!!currentDocEntry}
                          placeholder="Customer code"
                        />
                        <button
                          type="button"
                          className="del-btn del-btn--lookup"
                          onClick={openBpModal}
                          disabled={!!currentDocEntry}
                          title="Select Business Partner"
                        >
                          ...
                        </button>
                      </div>
                    </div>

                    {/* Buyer's Name */}
                    <div className="del-field">
                      <label className="del-field__label">Buyer's Name</label>
                      <input name="name" className="del-field__input" value={header.name} readOnly />
                    </div>

                    {/* Contact Person */}
                    <div className="del-field">
                      <label className="del-field__label">Contact Person</label>
                      <select
                        name="contactPerson"
                        className="del-field__select"
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

                    <div className="del-field">
                      <label className="del-field__label">Transaction Type</label>
                      <select
                        name="transactionType"
                        className="del-field__select"
                        value={header.transactionType || ''}
                        onChange={handleHeaderChange}
                        disabled={!!currentDocEntry || !transactionTypeOptions.length}
                      >
                        {transactionTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <DocumentCurrencySelect
                      classPrefix="del"
                      header={header}
                      onHeaderChange={handleHeaderChange}
                      businessPartners={refData.vendors || []}
                      currencyOptions={refData.currencies || []}
                      localCurrency={refData.local_currency || refData.company_currency || ''}
                      systemCurrency={refData.system_currency || refData.local_currency || refData.company_currency || ''}
                      fallbackLocalCurrency=""
                      disabled={pageState.vendorLoading || !header.vendor || !!currentDocEntry}
                    />

                    {/* Place of Supply */}
                    <div className="del-field">
                      <label className="del-field__label">Place of Supply</label>
                      <div className="sap-input-group">
                        <input
                          name="placeOfSupply"
                          className={`del-field__input${valErrors.header.placeOfSupply ? ' del-field__input--error' : ''}`}
                          value={getStateDisplayName(header.placeOfSupply, refData.states)}
                          onChange={handleHeaderChange}
                          placeholder="State code"
                        />
                        <button
                          type="button"
                          className="del-btn del-btn--lookup"
                          onClick={openStateModal}
                          title="Select State"
                        >
                          ...
                        </button>
                      </div>
                    </div>

                    {/* Warehouse */}
                    <div className="del-field">
                      <label className="del-field__label">Warehouse *</label>
                      <select 
                        name="warehouse" 
                        className="del-field__select" 
                        value={header.warehouse || ''} 
                        onChange={handleHeaderChange}
                      >
                        <option value="">Select Warehouse</option>
                        {branchFilteredWarehouses.map(w => (
                          <option key={w.WhsCode} value={w.WhsCode}>
                            {w.WhsCode} - {w.WhsName}
                          </option>
                        ))}
                      </select>
                    </div>

                  </div>
                </div>

                {/* RIGHT COLUMN */}
                <div className="col-md-6">
                  <div className="del-field-grid del-field-grid--single">

                    {/* Series */}
                    <div className="del-field">
                      <label className="del-field__label">Series</label>
                      <select 
                        name="series"
                        className="del-field__select" 
                        value={header.series}
                        onChange={handleHeaderChange}
                        disabled={!!currentDocEntry || pageState.seriesLoading}
                      >
                        <option value="">{pageState.seriesLoading ? 'Loading series...' : pageState.seriesError ? 'Series unavailable' : 'Select Series'}</option>
                        {(canUseManualSeries(refData) || (currentDocEntry && ['-1','manual','__sap_manual__'].includes(String(header.series)))) && (<option value={SAP_MANUAL_SERIES_VALUE}>Manual</option>)}
                        {getSapVisibleDocumentSeries(refData.series, {
                          selectedSeries: header.series, includeHistorical: Boolean(currentDocEntry),
                          postingDate: header.postingDate || header.documentDate,
                        }).map(s => (
                          <option key={s.Series} value={s.Series}>
                            {s.DisplayName || s.RawSeriesName || s.SeriesName || s.Series}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Auto Number */}
                    <div className="del-field">
                      <label className="del-field__label">Number</label>
                      <input 
                        name="nextNumber" 
                        className="del-field__input" 
                        value={currentDocEntry ? (header.docNo || header.nextNumber || '') : (pageState.seriesLoading ? '...' : header.nextNumber)}
                        readOnly 
                        style={{ background: '#f0f2f5' }}
                        title="Number will be assigned after saving"
                      />
                    </div>

                    {/* Customer Ref. No. */}
                    <div className="del-field">
                      <label className="del-field__label">Customer Ref. No.</label>
                      <input name="salesContractNo" className="del-field__input" value={header.salesContractNo} onChange={handleHeaderChange} />
                    </div>

                    {/* Status */}
                    <div className="del-field">
                      <label className="del-field__label">Status</label>
                      <input name="status" className="del-field__input" value={header.status} readOnly style={{ background: '#f0f2f5', color: header.status === 'Open' ? '#1a7a30' : '#c00', fontWeight: 600 }} />
                    </div>

                    {/* Posting Date */}
                    <div className="del-field">
                      <label className="del-field__label">Posting Date *</label>
                      <SapDateInput  name="postingDate" className={`del-field__input${valErrors.header.postingDate ? ' del-field__input--error' : ''}`} value={header.postingDate} onChange={handleHeaderChange} />
                    </div>

                    {/* Delivery Date */}
                    <div className="del-field">
                      <label className="del-field__label">Delivery Date</label>
                      <SapDateInput  name="deliveryDate" className="del-field__input" value={header.deliveryDate} onChange={handleHeaderChange} />
                    </div>

                    {/* Document Date */}
                    <div className="del-field">
                      <label className="del-field__label">Document Date *</label>
                      <SapDateInput  name="documentDate" className={`del-field__input${valErrors.header.documentDate ? ' del-field__input--error' : ''}`} value={header.documentDate} onChange={handleHeaderChange} />
                    </div>

                  </div>
                </div>
              </div>
            </div>

            {/* â•â• TABS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="del-tabs">
              {TAB_NAMES.map(t => (
                <button 
                  key={t}
                  type="button" 
                  className={`del-tab${activeTab === t ? ' del-tab--active' : ''}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* â•â• TAB CONTENT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {activeTab === 'Contents' && (
              <ContentsTab
                companyQueryContext={buildCompanyFormQueryContext(currentDocEntry, header)}
                lines={lines}
                onLineChange={handleLineChange}
                onNumBlur={handleNumBlur}
                onAddLine={addLine}
                onRemoveLine={removeLine}
                onOpenHSNModal={openHSNModal}
                onOpenItemModal={openItemModal}
                onOpenLineLookup={openLineLookup}
                lineItemOptions={lineItemOptions}
                getUomOptions={getUomOptions}
                effectiveTaxCodes={effectiveTaxCodes}
                effectiveWarehouses={branchFilteredWarehouses}
                fmtTaxLabel={fmtTaxLabel}
                getBranchName={getBranchName}
                valErrors={valErrors}
                isEditable={isDocumentEditable}
                formSettings={formSettings}
                formSettingsReady={companyFormSettingsReady}
                matrixFields={effectiveMatrixColumnDefinitions}
                rowUdfFields={visibleRowUdfs}
                onRowUdfChange={handleRowUdfChange}
                onLoadLookupOptions={loadDynamicLineLookupOptions}
                canPasteTable={isDocumentEditable}
                onPasteTable={handleTablePaste}
                onClipboardFeedback={handleTableClipboardFeedback}
              />
            )}

            {activeTab === 'Logistics' && (
              <LogisticsTab
                header={header}
                onHeaderChange={handleHeaderChange}
                effectiveWhseAddrs={effectiveWhseAddrs}
                vendorPayToAddresses={vendorPayToAddresses}
                vendorShipToAddresses={vendorEffectiveShipToAddresses}
                vendorBillToAddresses={vendorEffectiveBillToAddresses}
                shipTypeOpts={shipTypeOpts}
                onOpenAddressModal={openAddressModal}
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

            {/* Continue in next part... */}

            {/* â•â• TOTALS FOOTER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="del-header-card">
              <div className="del-field-grid del-field-grid--summary">
                <div>
                  <div className="del-field">
                    <label className="del-field__label">Sales Employee</label>
                    <select name="purchaser" className="del-field__select" value={header.purchaser || ''} onChange={handleHeaderChange}>
                      <option value="">No Sales Employee / Buyer</option>
                      {effectiveSalesEmployees.map((employee) => (
                        <option key={employee.SlpCode ?? employee.SlpName} value={employee.SlpName || ''}>
                          {employee.SlpName || ''}
                        </option>
                      ))}
                      <option value="__DEFINE_NEW__">Define New</option>
                    </select>
                  </div>
                  <div className="del-field">
                    <label className="del-field__label">Owner</label>
                    <input name="owner" className="del-field__input" value={header.owner || ''} onChange={handleHeaderChange} />
                  </div>
                  <div className="del-field">
                    <label className="del-field__label">Remarks</label>
                    <textarea className="del-textarea" rows={3} name="otherInstruction" value={header.otherInstruction} onChange={handleHeaderChange} />
                  </div>
                </div>
                <div>
                  <div className="del-section-title">Tax Summary</div>
                  {totals.taxBreakdown.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      {totals.taxBreakdown.map(t => (
                        <div key={t.taxCode} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                          <span>{t.taxCode} ({t.taxRate}%)</span>
                          <span>{formatDisplayMoney(t.taxAmount, numDec.tax)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="del-grid-wrap">
                    <table className="del-grid" style={{ marginTop: '8px' }}>
                      <tbody>
                        <tr>
                          <td>Total Before Discount</td>
                          <td className="del-grid__cell--num"><input className="del-grid__input" value={formatDisplayMoney(totals.subtotal, numDec.total)} readOnly /></td>
                        </tr>
                        <tr>
                          <td>Discount %</td>
                          <td className="del-grid__cell--num"><input className="del-grid__input" name="discount" value={header.discount} onChange={handleHeaderChange} onBlur={() => handleNumBlur('discount', 'header')} /></td>
                        </tr>
                        <tr>
                          <td>Freight</td>
                          <td className="del-grid__cell--num" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input 
                              className="del-grid__input" 
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
                          <td><input type="checkbox" className="" name="rounding" checked={header.rounding} onChange={handleHeaderChange} style={{ marginRight: 6 }} /><span>Rounding</span></td>
                          <td className="del-grid__cell--num"><DocumentRoundingInput className="del-grid__input" header={header} setHeader={setHeader} formattedAmount={formatDisplayMoney(totals.roundingAmount, numDec.totalPaymentDue)} disabled={!isDocumentEditable} onManualChange={markDirty} /></td>
                        </tr>
                        <tr>
                          <td>Tax</td>
                          <td className="del-grid__cell--num"><input className="del-grid__input" value={formatDisplayMoney(totals.taxAmt, numDec.tax)} readOnly /></td>
                        </tr>
                        <tr style={{ borderTop: '2px solid #a0aab4' }}>
                          <td style={{ fontWeight: 700, color: '#003366' }}>Total</td>
                          <td className="del-grid__cell--num" style={{ fontWeight: 700, color: '#003366' }}><input className="del-grid__input" style={{ fontWeight: 700, color: '#003366' }} value={formatDisplayMoney(totals.total, numDec.totalPaymentDue)} readOnly /></td>
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
                <button type="submit" className="del-btn del-btn--primary" disabled={pageState.posting}>
                  {secondaryActionLabel}
                </button>
                <button type="button" className="del-btn" onClick={resetForm}>
                  Cancel
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
                {/* Copy From Dropdown - SAP B1 style */}
                <div className="del-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    type="button"
                    className="del-btn"
                    disabled={!isDocumentEditable || !!currentDocEntry}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const dropdown = e.currentTarget.parentElement;
                      const isActive = dropdown.classList.contains('active');
                      document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
                      if (!isActive) dropdown.classList.add('active');
                    }}
                  >
                    Copy From
                  </button>
                  <div className="del-dropdown-menu">
                    {[
                      { key: 'arInvoice', label: 'A/R Invoices' },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openCopyFromModal();
                          document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="del-btn"
                  disabled
                  title="No SAP Copy To target is configured for A/R Credit Memo."
                >
                  Copy To
                </button>
              </div>
            </div>
            )}

          </div>{/* end main col */}

          <HeaderUdfSidebar
            className="sap-header-udf-panel so-layout__sidebar"
            isOpen={sidebarOpen}
            fields={visHdrUdfs}
            formSettings={formSettings}
            values={headerUdfs}
            disabled={!hasBuyerCode}
            onFieldChange={handleHeaderUdfChange}
            onLoadLookupOptions={loadDynamicLineLookupOptions}
            onClose={() => setSidebarOpen(false)}
          />
          <FormSettingsPanel
            variant="sidebar"
            className="sap-header-udf-panel so-layout__sidebar"
            isOpen={formSettingsOpen}
            onClose={() => setFormSettingsOpen(false)}
            matrixFields={effectiveMatrixColumnDefinitions}
            headerUdfFields={headerUdfDefinitions}
            rowUdfFields={rowUdfDefinitions}
            formSettings={formSettings}
          onSettingChange={updateFormSetting}
          onColumnOrderChange={formSettingsStatus.reorder}
            settingsLoaded={companyFormSettingsReady}
            editablePropertiesByGroup={{ matrixColumns: ['visible'], rowUdfs: ['visible'] }}
            editableSapControlledProperties={{ matrixColumns: ['visible'], headerUdfs: [], rowUdfs: ['visible'] }}
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
        businessPartners={refData.vendors || []}
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

      {/* Copy From Modal */}
      <CopyFromModal
        isOpen={copyFromModal}
        onClose={() => setCopyFromModal(false)}
        onCopy={handleCopyFrom}
        documentType="arInvoice"
        onFetchDocuments={fetchCopyFromDocuments}
        onFetchDocumentDetails={fetchCopyFromDocumentDetails}
      />

      {/* Copy To Modal */}
      <CopyToModal
        isOpen={copyToModal}
        onClose={() => setCopyToModal(false)}
        onCopyTo={handleCopyTo}
        currentDocEntry={currentDocEntry}
      />

      <SalesEmployeeSetupModal
        isOpen={salesEmployeeSetup.open}
        rows={salesEmployeeSetup.rows}
        saving={salesEmployeeSetup.saving}
        onClose={closeSalesEmployeeSetup}
        onSave={saveSalesEmployeeSetup}
        onUpdateRow={updateSalesEmployeeSetupRow}
      />

      {/* Freight Selection Modal */}
      <FreightChargesModal
        isOpen={freightModal.open}
        onClose={closeFreightModal}
        onApply={handleFreightApply}
        freightCharges={freightModal.freightCharges}
        taxCodes={effectiveTaxCodes}
        loading={freightModal.loading}
        currency={header.currency || refData.local_currency || refData.company_currency || ''}
      />
      <LineValueLookupModal
        isOpen={lineLookupModal.open}
        onClose={closeLineLookup}
        onSelect={handleLineLookupSelect}
        options={lineLookupModal.options}
        title={lineLookupModal.title}
        searchPlaceholder={lineLookupModal.searchPlaceholder}
        emptyMessage={lineLookupModal.emptyMessage}
        allowCreate={false}
        columns={lineLookupModal.columns}
        portalTarget={document.body}
      />
      <ExchangeRatesIndexesModal
        isOpen={exchangeRatesModal.open}
        currency={exchangeRatesModal.currency}
        postingDate={exchangeRatesModal.postingDate}
        initialRate={exchangeRatesModal.initialRate}
        loading={exchangeRatesModal.loading}
        error={exchangeRatesModal.error}
        data={exchangeRatesModal.data}
        documentLabel="A/R credit memo"
        onLoad={loadExchangeRatesMonth}
        onSave={saveExchangeRateFromModal}
        onClose={() => setExchangeRatesModal((prev) => ({ ...prev, open: false }))}
      />
    </form>
  );
}

export default ARCreditMemo;
