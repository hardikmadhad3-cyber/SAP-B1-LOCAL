import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import '../../modules/item-master/styles/itemMaster.css';
import './styles/SalesQuotation.css';
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
import EWayBillModal from './components/EWayBillModal';
import TaxInfoModal from './components/TaxInfoModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import BusinessPartnerModal from './components/BusinessPartnerModal';
import CopyFromModal from '../../components/document/CopyFromModal';
import CopyToDropdown from '../../components/document/CopyToDropdown';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import LineValueLookupModal from '../../components/sales-document/LineValueLookupModal';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import {
  convertDocumentAmountForDisplay,
  inferDocumentCurrencyMode,
  resolveDisplayCurrency,
} from '../../utils/documentCurrency';
import PrintLayoutToolbar from '../../components/print-layout/PrintLayoutToolbar';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import ExchangeRatesIndexesModal from '../sales-order/components/ExchangeRatesIndexesModal';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import useStandardDocumentDraftTask from '../../hooks/useStandardDocumentDraftTask';
import { determineTaxCode, getGSTTypeLabel } from '../../utils/taxEngine';
import { filterWarehousesByBranch } from '../../utils/warehouseBranch';
import { hydrateDocumentLineFromItem, mergeItemMaster } from '../../utils/documentItemHydration';
import { applyUomCodeSelection, getLineUomOptions } from '../../utils/documentUom';
import { getSapVisibleDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import {
  SAP_MANUAL_SERIES_VALUE,
  isManualDocumentSeries,
  isValidManualDocumentNumber,
} from '../../utils/documentSeries';
import { useStandardSalesFormSettings } from '../../utils/standardSalesFormSettings';
import { buildCompanyFormQueryContext } from '../../utils/companyFormQueryContext';
import { updateFormSettingPreference } from '../../utils/formSettingsPreferences';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { findTaxCode, getTaxComponentCodes } from '../../utils/taxCodeComponents';
import { copyToDocument } from '../../services/documentCopyService';
import { replaceRouteStatePreservingWindow } from '../../utils/copyToState';
import { duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useSalesEmployeeSetup from '../../hooks/useSalesEmployeeSetup';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import useSalesDocumentLineLookups from '../../hooks/useSalesDocumentLineLookups';
import SalesEmployeeSetupModal from '../../components/sales-employee/SalesEmployeeSetupModal';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { useAuth } from '../../auth/AuthContext';
import { isRouteStateForActiveCompany } from '../../utils/companyStorageScope';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import {
  SALES_QUOTATION_LAYOUT_DOCUMENT_TYPE,
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
  fetchSalesQuotationByDocEntry,
  fetchSalesQuotationCustomerDetails,
  fetchSalesQuotationReferenceData,
  submitSalesQuotation,
  updateSalesQuotation,
  fetchDocumentSeries,
  fetchItemsForModal,
  fetchFreightCharges,
  createSalesQuotationLookupValue,
  fetchOpenSalesQuotations,
  fetchSalesQuotationForCopy,
} from '../../api/salesQuotationApi';
import { fetchSalesOrderExchangeRates, saveSalesOrderExchangeRate } from '../../api/salesOrderApi';
import { normaliseDocumentHeader, normaliseDocumentLine, unwrapCopyFromDocument, BASE_TYPE } from '../../api/copyFromApi';
import { fetchHSNCodes } from '../../api/hsnCodeApi';
import {
  FORM_SETTINGS_STORAGE_KEY,
  createUdfState,
  normalizeUdfState as normalizeConfiguredUdfState,
  readSavedFormSettings,
} from '../../config/salesQuotationForm';

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const getErrorText = (value) => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!value || typeof value !== 'object') return '';
  return getErrorText(value.value)
    || getErrorText(value.message)
    || getErrorText(value.detail)
    || getErrorText(value.details)
    || getErrorText(value.error);
};

const getErrMsg = (e, fb) => {
  const body = e?.response?.data || {};
  return getErrorText(body.detail)
    || getErrorText(body.details)
    || getErrorText(body.message)
    || getErrorText(body.error)
    || getErrorText(e?.message)
    || fb;
};
const normalizeUdfState = (definitions = [], values = {}) => (
  normalizeConfiguredUdfState(definitions, values, { preserveExtra: false })
);
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

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ constants Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const DEC = { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 };
const TAB_NAMES = ['Contents', 'Logistics', 'Accounting', 'Tax', 'Electronic Documents', 'Attachments'];
const buildExchangeRatesFallbackData = ({ year, month, currencies = [], localCurrency = '', documentCurrency = '' }) => {
  const normalizedYear = Number(year) || new Date().getFullYear();
  const normalizedMonth = Number(month) || (new Date().getMonth() + 1);
  const localCode = String(localCurrency || '').trim();
  const currencyMap = new Map();
  const addCurrency = (code, name = '') => {
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode || normalizedCode === localCode || currencyMap.has(normalizedCode)) return;
    currencyMap.set(normalizedCode, {
      code: normalizedCode,
      name: String(name || normalizedCode).trim(),
    });
  };

  (Array.isArray(currencies) ? currencies : []).forEach((entry) => addCurrency(
    entry.CurrCode || entry.Code || entry.code || entry.value,
    entry.CurrName || entry.Name || entry.name || entry.label,
  ));
  addCurrency(documentCurrency);

  const daysInMonth = new Date(normalizedYear, normalizedMonth, 0).getDate();
  return {
    year: normalizedYear,
    month: normalizedMonth,
    localCurrency: localCode,
    currencies: [...currencyMap.values()].sort((left, right) => left.code.localeCompare(right.code)),
    days: Array.from({ length: daysInMonth }, (_unused, index) => ({ day: index + 1, rates: {} })),
  };
};
const GENERAL_SETTINGS = readGeneralSettings();
const HEADER_VALIDATION_TABS = {
  shipToCode: 'Logistics',
  billToCode: 'Logistics',
};

const getValidationTab = (errors) => {
  if (Object.values(errors.lines || {}).some(lineErrors => Object.values(lineErrors || {}).some(Boolean))) {
    return 'Contents';
  }

  const headerField = Object.entries(errors.header || {}).find(([, message]) => Boolean(message))?.[0];
  return HEADER_VALIDATION_TABS[headerField] || 'Contents';
};

const createLine = (rowUdfDefinitions = []) => ({
  itemNo: '', itemDescription: '', hsnCode: '', quantity: '', unitPrice: '',
  requiredDate: '', quotedDate: '', requiredQty: '', noOfPackages: '',
  sacCode: '', uomCode: '', stdDiscount: '', taxCode: '', total: '', totalLC: '', grossTotal: '', whse: '',
  lineDeliveryDate: '',
  taxCodeManuallyOverridden: false,
  distRule: '', cogsDistRule: '', countryOfOrigin: '', loc: '', branch: '',
  blanketAgreementNo: '', allowProcurementDoc: false,
  saudaNodeRef: '', apInvDocKey: '', apInvDocNum: '', apInvLineNum: '',
  assessableValue: '', bedRate: '', bedAmount: '', rg23dNo: '',
  specialRebate: '', commission: '', sellerItem: '', sellerQty: '',
  sellerBrokeragePerQty: '',
  unitPriceUdf: '',
  sellerBrokerage: '', buyerBrokerage: '',
  buyerDelivery: '', sellerDelivery: '',
  buyerPaymentTerms: '', sellerPaymentTerms: '',
  buyerQuality: '', sellerQuality: '',
  buyerPrice: '', sellerPrice: '',
  buyerSpecialInstruction: '', sellerSpecialInstruction: '',
  sellerBrokerageAmtPer: '', sellerBrokeragePercent: '',
  buyerBillDiscount: '', sellerBillDiscount: '', stcode: '',
  freightPurchase: '', freightSales: '', freightProvider: '', freightProviderName: '',
  documentCreated: today(), brokerageNumber: '',
  udf: createUdfState(rowUdfDefinitions),
});

const INIT_HEADER = {
  vendor: '', name: '', contactPerson: '', customerRefNo: '', salesContractNo: '', branch: '', warehouse: GENERAL_SETTINGS.salesQuotationWarehouse || '',
  docNo: '', status: 'Open', series: GENERAL_SETTINGS.salesQuotationSeries || '', nextNumber: '',
  postingDate: today(), deliveryDate: '', documentDate: today(), contractDate: '',
  branchRegNo: '', shipTo: '', shipToCode: '', payTo: '', payToCode: '',
  shippingType: '', confirmed: undefined, journalRemark: '', paymentTerms: '',
  paymentMethod: '', otherInstruction: '', discount: '', freight: '', tax: '',
  totalPaymentDue: '', rounding: false, owner: '', purchaser: '',
  placeOfSupply: '', currencyMode: 'BP', currency: '', exchangeRate: '', useBillToForTax: false,
  billToAddress: '', billToCode: '', shipToAddress: '',
  shipToAddressComponents: null, billToAddressComponents: null,
};

const createInitialHeader = () => ({
  ...INIT_HEADER,
  postingDate: today(),
  documentDate: today(),
  deliveryDate: '',
  docNo: '',
  nextNumber: '',
  series: GENERAL_SETTINGS.salesQuotationSeries || '',
  status: 'Open',
});

const resolveCurrencyCode = (currency, fallback = '') => {
  const normalized = String(currency || '').trim();
  return normalized && normalized !== '##' ? normalized : fallback;
};

const getSalesQuotationItemDescription = (item = {}, fallback = '') => (
  item.ItemName ||
  item.ItemDescription ||
  item.Dscription ||
  item.Description ||
  item.ItemDesc ||
  item.FrgnName ||
  fallback ||
  ''
);

const INIT_ATTACH = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, targetPath: '', fileName: '', attachmentDate: '',
  freeText: '', copyToTargetDocument: '', documentType: '', atchDocDate: '', alert: '',
}));

const closeDocumentDropdowns = () => {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.so-dropdown').forEach(d => d.classList.remove('active'));
};

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Main Component Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function SalesQuotation() {
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
    ? location.state?.salesQuotationDocEntry || location.state?.salesOrderDocEntry
    : null;
  const formRef = useRef(null);

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(INIT_HEADER);
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState([]);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState([]);
  const [hydratedFieldMetadataScope, setHydratedFieldMetadataScope] = useState('');
  const [matrixColumnDefinitions, setMatrixColumnDefinitions] = useState(() => getSapStandardSalesMatrixColumns());
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
    warehouses: [], warehouse_addresses: [], company_address: {}, tax_codes: [], hsn_codes: [],
    payment_terms: [], shipping_types: [], branches: [], uom_groups: [], sales_employees: [], owners: [],
    countries: [], distribution_rules: [], distribution_dimensions: [], quality_options: { buyer: [], seller: [] }, price_options: { buyer: [], seller: [] },
    company_currencies: { localCurrency: '', systemCurrency: '', currencies: [] },
    decimal_settings: DEC, warnings: [], series: [], states: [], udf_metadata: { header: [], rows: [] },
    line_field_metadata: { matrix_columns: getSapStandardSalesMatrixColumns(), sap_form: {} },
    lookup_sources: {},
  });
  const [pageState, setPageState] = useState({ loading: false, vendorLoading: false, posting: false, error: '', success: '', seriesLoading: false });
  const [valErrors, setValErrors] = useState({ header: {}, lines: {}, form: '' });
  useValidationHighlights(valErrors, { rootRef: formRef });
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [addressModal, setAddressModal] = useState(null);
  const [eWayBillModal, setEWayBillModal] = useState(false);
  const [eWayBillData, setEWayBillData] = useState({});
  const [taxInfoModal, setTaxInfoModal] = useState(false);
  const [stateModal, setStateModal] = useState(false);
  const [bpModal, setBpModal] = useState(false);
  const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1 });
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, items: [], loading: false });
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
  const [exchangeRatesModal, setExchangeRatesModal] = useState({
    open: false, currency: '', postingDate: '', initialRate: '', loading: false, error: '', data: null,
  });

  useStandardDocumentDraftTask({
    draftKey: 'salesQuotationDraft',
    title: 'Sales Quotation',
    draftValues: {
      currentDocEntry,
      header,
      lines,
      headerUdfs,
      activeTab,
      isDirty,
      freightCharges: freightModal.freightCharges,
    },
    restoreDraft: (draft) => {
      setCurrentDocEntry(draft.currentDocEntry || null);
      setHeader(draft.header || INIT_HEADER);
      setLines(Array.isArray(draft.lines) && draft.lines.length
        ? draft.lines
        : [createLine([])]);
      setHeaderUdfs(draft.headerUdfs || {});
      setActiveTab(TAB_NAMES.includes(draft.activeTab) ? draft.activeTab : 'Contents');
      setIsDirty(Boolean(draft.isDirty));
      setFreightModal((prev) => ({
        ...prev,
        freightCharges: Array.isArray(draft.freightCharges) ? draft.freightCharges : [],
        loading: false,
      }));
    },
  });
  const [copyFromModal, setCopyFromModal] = useState(false);
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
    openQualityModal,
    openPaymentTermsModal,
    closeLineLookupModal,
    handleLineLookupSelect,
    handleLineLookupCreate,
  } = useSalesDocumentLineLookups({
    refData,
    setRefData,
    setLines,
    createLookupValue: createSalesQuotationLookupValue,
    documentType: 'SALES_QUOTATION',
    lineTable: 'QUT1',
  });

  const loadDynamicLineLookupOptions = useCallback((source, field = {}, line = {}) => (
    loadSalesDocumentFieldLookupOptions({
      fetchLookup: fetchSalesDocumentLookup,
      source,
      field,
      line,
      documentType: 'SALES_QUOTATION',
      schemaVersion: refData.line_field_metadata?.live_schema?.schemaVersion || '',
    })
  ), [refData.line_field_metadata]);

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
    const handleClickOutside = (event) => {
      if (!event.target.closest('.so-dropdown')) {
        closeDocumentDropdowns();
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // decimal config
  const dec = { ...DEC, ...(refData.decimal_settings || {}) };
  const numDec = {
    quantity: Number(dec.QtyDec), unitPrice: Number(dec.PriceDec),
    requiredQty: Number(dec.QtyDec),
    unitPriceUdf: Number(dec.PriceDec),
    sellerQty: Number(dec.QtyDec),
    sellerBrokeragePerQty: Number(dec.PriceDec),
    assessableValue: Number(dec.SumDec),
    bedRate: Number(dec.PercentDec),
    bedAmount: Number(dec.SumDec),
    specialRebate: Number(dec.PercentDec),
    commission: Number(dec.PercentDec),
    sellerBrokerage: Number(dec.SumDec),
    buyerBrokerage: Number(dec.SumDec),
    sellerBrokeragePercent: Number(dec.PercentDec),
    buyerBillDiscount: Number(dec.PercentDec),
    sellerBillDiscount: Number(dec.PercentDec),
    freightPurchase: Number(dec.SumDec),
    freightSales: Number(dec.SumDec),
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
  const documentBodyRef = useRef(null);
  useClosedDocumentViewMode(documentBodyRef, !isDocumentEditable, [activeTab]);
  const hasBuyerCode = Boolean(String(header.vendor || '').trim());
  const isUpdateMode = Boolean(currentDocEntry);
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
  const resolveSalesQuotationAddress = useCallback((code, addresses = [], fallbackText = '') => {
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
    if (currentDocEntry) setIsDirty(true);
  }, [currentDocEntry]);

  // Continue in next part...

  // Ã¢â€â‚¬Ã¢â€â‚¬ load reference data Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    let ignore = false;
    setHydratedFieldMetadataScope('');
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        if (!activeCompanyId) {
          setHeaderUdfDefinitions([]);
          setRowUdfDefinitions([]);
          setMatrixColumnDefinitions(getSapStandardSalesMatrixColumns());
          setHeaderUdfs({});
          setLines([createLine([])]);
          setRefData(prev => ({
            ...prev,
            company: '',
            vendors: [], contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [],
            items: [], warehouses: [], warehouse_addresses: [], company_address: {}, tax_codes: [], hsn_codes: [],
            payment_terms: [], shipping_types: [], branches: [], states: [], uom_groups: [], sales_employees: [], owners: [],
            countries: [], distribution_rules: [], distribution_dimensions: [], quality_options: { buyer: [], seller: [] }, price_options: { buyer: [], seller: [] },
            company_currencies: { localCurrency: '', systemCurrency: '', currencies: [] },
            udf_metadata: { header: [], rows: [] },
            line_field_metadata: { matrix_columns: getSapStandardSalesMatrixColumns(), sap_form: {} },
            lookup_sources: {},
          }));
          return;
        }

        setHeaderUdfDefinitions([]);
        setRowUdfDefinitions([]);
        setMatrixColumnDefinitions([]);

        const [refDataRes, hsnRes, layoutRes, liveSchema] = await Promise.all([
          fetchSalesQuotationReferenceData(activeCompanyId),
          fetchHSNCodes(),
          getDocumentLayout({
            companyDb: activeCompanyDb || undefined,
            documentType: SALES_QUOTATION_LAYOUT_DOCUMENT_TYPE,
            objectType: '23',
            refresh: true,
          }).catch((error) => ({
            data: {
              success: false,
              columns: [],
              warning: getErrMsg(error, 'Failed to load SAP layout.'),
            },
          })),
          fetchSalesDocumentSchema({ documentType: 'SALES_QUOTATION' }).catch((error) => {
            console.warn('[Sales Quotation] Live OQUT/QUT1 schema was not available.', error);
            return null;
          }),
        ]);
        
        // Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â LOGGING: Reference Data Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â
        console.log('Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â');
        console.log('Ã°Å¸â€œÅ¡ Reference Data Loaded:');
        console.log('  - Vendors/Customers:', refDataRes.data.vendors?.length || 0);
        console.log('  - Items:', refDataRes.data.items?.length || 0);
        console.log('  - Tax Codes:', refDataRes.data.tax_codes?.length || 0);
        console.log('  - Warehouses:', refDataRes.data.warehouses?.length || 0);
        console.log('  - Payment Terms:', refDataRes.data.payment_terms?.length || 0);
        console.log('  - Shipping Types:', refDataRes.data.shipping_types?.length || 0);
        console.log('  - Branches:', refDataRes.data.branches?.length || 0);
        console.log('  - States:', refDataRes.data.states?.length || 0);
        console.log('  - Series:', refData.series?.length || 0);
        console.log('  - HSN Codes:', hsnRes.data?.length || 0);
        console.log('  - Sales Employees:', refDataRes.data.sales_employees?.length || 0);
        console.log('  - Owners:', refDataRes.data.owners?.length || 0);
        console.log('Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬');
        console.log('Ã°Å¸ÂÂ¢ Company Address:', refDataRes.data.company_address);
        console.log('Ã¢Å¡â„¢Ã¯Â¸Â  Decimal Settings:', refDataRes.data.decimal_settings);
        console.log('Ã¢Å¡Â Ã¯Â¸Â  Warnings:', refDataRes.data.warnings);
        console.log('Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬');
        console.log('Ã°Å¸â€™Â° TAX CODES LOADED:');
        (refDataRes.data.tax_codes || []).forEach(tc => {
          console.log(`  ${tc.Code} - ${tc.Name} (Rate: ${tc.Rate}%, Type: ${tc.GSTType || 'N/A'})`);
        });
        if (refDataRes.data.sales_employees && refDataRes.data.sales_employees.length > 0) {
          console.log('Ã°Å¸â€˜Â¥ SALES EMPLOYEES LOADED:');
          refDataRes.data.sales_employees.forEach(emp => {
            console.log(`  ${emp.SlpName} (Code: ${emp.SlpCode})`);
          });
        }
        if (refDataRes.data.owners && refDataRes.data.owners.length > 0) {
          console.log('Ã°Å¸â€˜Â¤ OWNERS LOADED:');
          refDataRes.data.owners.forEach(owner => {
            console.log(`  ${owner.FullName} (empID: ${owner.empID})`);
          });
        }
        console.log('Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â');
        
        if (!ignore) {
          const sourceMatrixColumns = refDataRes.data.line_field_metadata?.matrix_columns || [];
          const liveFields = buildSalesDocumentLiveFields({
            schema: liveSchema,
            documentType: 'SALES_QUOTATION',
            objectType: '23',
            headerTable: 'OQUT',
            lineTable: 'QUT1',
            companyId: activeCompanyId,
            companyDb: activeCompanyDb,
            layoutResponse: layoutRes,
            referenceMatrixColumns: sourceMatrixColumns,
            referenceSapForm: refDataRes.data.line_field_metadata?.sap_form,
          });
          const nextHeaderUdfs = liveFields.headerUdfFields;
          const nextRowUdfs = liveFields.rowUdfFields;
          const nextMatrixColumns = liveFields.matrixColumns;
          setHeaderUdfDefinitions(nextHeaderUdfs);
          setRowUdfDefinitions(nextRowUdfs);
          setMatrixColumnDefinitions(nextMatrixColumns);
          setHeaderUdfs((prev) => normalizeUdfState(nextHeaderUdfs, prev, { preserveExtra: false }));
          setLines((prev) => prev.map((line) => ({
            ...line,
            udf: normalizeUdfState(nextRowUdfs, line.udf || {}, { preserveExtra: false }),
          })));
          replaceFormSettings(readSavedFormSettings(nextHeaderUdfs, nextRowUdfs, nextMatrixColumns, formSettingsStorageKey));
          setRefData(prev => ({
            ...prev,
            company: refDataRes.data.company || '',
            vendors: refDataRes.data.vendors || [],
            contacts: refDataRes.data.contacts || [],
            pay_to_addresses: refDataRes.data.pay_to_addresses || [],
            ship_to_addresses: refDataRes.data.ship_to_addresses || [],
            bill_to_addresses: refDataRes.data.bill_to_addresses || [],
            items: refDataRes.data.items || [],
            warehouses: refDataRes.data.warehouses || [],
            warehouse_addresses: refDataRes.data.warehouse_addresses || [],
            company_address: refDataRes.data.company_address || {},
            tax_codes: refDataRes.data.tax_codes || [],
            hsn_codes: hsnRes.data || [],
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
            company_currencies: refDataRes.data.company_currencies || { localCurrency: '', systemCurrency: '', currencies: [] },
            decimal_settings: { ...DEC, ...(refDataRes.data.decimal_settings || {}) },
            warnings: [
              ...(refDataRes.data.warnings || []),
              ...(!liveFields.schemaMatchesCompany && liveSchema
                ? ['Ignored a Sales Quotation schema belonging to another company.']
                : []),
              ...(!liveFields.liveAvailable
                ? ['Live Sales Quotation field metadata was unavailable; SAP standard fields are shown.']
                : []),
              ...(layoutRes?.data?.warning ? [layoutRes.data.warning] : []),
            ],
            udf_metadata: { header: nextHeaderUdfs, rows: nextRowUdfs },
            line_field_metadata: {
              ...(refDataRes.data.line_field_metadata || { sap_form: {} }),
              matrix_columns: nextMatrixColumns,
              source_matrix_columns: sourceMatrixColumns,
              imported_layout: liveFields.importedLayout,
              live_schema: liveFields.liveSchema,
              live_available: liveFields.liveAvailable,
            },
            lookup_sources: refDataRes.data.lookup_sources || {},
            series: Array.isArray(prev.series) ? prev.series : [],
          }));
          setHydratedFieldMetadataScope(activeFieldMetadataScope);
        }
      } catch (e) {
        console.error('Ã¢ÂÅ’ Error loading reference data:', e);
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ load existing order Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬


  useEffect(() => {
    const docEntry = requestedEditDocEntry;
    if (!docEntry || hydratedFieldMetadataScope !== activeFieldMetadataScope) return;
    let ignore = false;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        const r = await fetchSalesQuotationByDocEntry(docEntry);
        const so = r.data.sales_quotation;
        let editSeries = [];
        try {
          const seriesDate = so?.header?.postingDate || so?.header?.documentDate || '';
          const seriesResponse = await fetchDocumentSeries(seriesDate, { branch: so?.header?.branch || '' });
          editSeries = seriesResponse.data?.series || [];
        } catch (_seriesError) {
          editSeries = [];
        }
        
        
        if (ignore || !so) return;
        setCurrentDocEntry(so.doc_entry || Number(docEntry));
        
        // Get warehouse from first line if available
        const firstLineWarehouse = so.lines && so.lines.length > 0 ? so.lines[0].whse : '';
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
          shipToAddressComponents: so.header?.shipToAddressComponents || null,
          billToCode: so.header?.payToCode || '',
          billToAddress: so.header?.payTo || '',
          billToAddressComponents: so.header?.billToAddressComponents || null,
          // Copy all other fields from backend
          postingDate: so.header?.postingDate || '',
          deliveryDate: so.header?.deliveryDate || '',
          documentDate: so.header?.documentDate || '',
          customerRefNo: so.header?.customerRefNo || '',
          docNo: String(so.header?.docNum || so.header?.docNo || ''),
          nextNumber: String(so.header?.docNum || so.header?.docNo || ''),
          status: so.header?.status || '',
          shippingType: so.header?.shippingType || '',
          confirmed: so.header?.confirmed || false,
          journalRemark: so.header?.journalRemark || '',
          currency: so.header?.currency || refData.company_currencies?.localCurrency || '',
          currencyMode: inferDocumentCurrencyMode({
            currency: so.header?.currency || refData.company_currencies?.localCurrency || '',
            cardCode: so.header?.customerCode || '',
            businessPartners: refData.vendors || [],
            localCurrency: refData.company_currencies?.localCurrency || '',
            systemCurrency: refData.company_currencies?.systemCurrency || '',
            fallbackLocalCurrency: '',
          }),
          exchangeRate: so.header?.exchangeRate || so.header?.docRate || so.header?.DocRate || '',
        };
        
        console.log('Ã°Å¸â€œÂ¥ Final header state:', newHeader);
        setHeader(newHeader);
        setLines(
          Array.isArray(so.lines) && so.lines.length
            ? so.lines.map((line) => {
                const hydratedLine = hydrateWorkbookDocumentLine({
                  line,
                  createLine,
                  rowUdfDefinitions,
                  normalizeUdfState,
                  items: refData.items,
                });
                const savedTaxCode = String(
                  hydratedLine.taxCode ||
                  hydratedLine.taxCodeRepeat ||
                  line.taxCode ||
                  line.taxCodeRepeat ||
                  line.TaxCode ||
                  line.VatGroup ||
                  ''
                ).trim();
                return {
                  ...hydratedLine,
                  taxCode: savedTaxCode,
                  taxCodeRepeat: savedTaxCode,
                  taxCodeManuallyOverridden: Boolean(savedTaxCode),
                };
              })
            : [createLine(rowUdfDefinitions)]
        );
        setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, so.header_udfs || {}));
        setSnapshotPending(true);
        setIsDirty(false);
        
        if (so.header?.customerCode) {
          loadVendorDetails(so.header.customerCode);
        }
        setPageState(p => ({ ...p, success: so.doc_num ? `Sales Quotation ${so.doc_num} loaded.` : 'Sales Quotation loaded.' }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load Sales Quotation.') }));
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ derived / computed Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  const effectiveTaxCodes = refData.tax_codes || [];
  const effectiveWarehouses = refData.warehouses || [];
  const freightTotals = summarizeFreightRows(freightModal.freightCharges, effectiveTaxCodes);

  const getLineFieldPolicy = (fieldKey) => {
    const field = matrixColumnDefinitions.find((column) => (
      [column.key, column.valueKey, column.rendererKey].some((value) => String(value || '') === fieldKey)
    ));
    const editable = Boolean(field && field.readOnly !== true && field.active !== false);
    return {
      editable,
      required: Boolean(field?.schemaDriven && field.required && editable),
    };
  };

  const resolveAutomaticTaxCode = (item = {}) => {
    if (!item || !String(item.ItemCode || '').trim()) return '';
    const billToAddress = resolveSalesQuotationAddress(
      header.billToCode,
      vendorEffectiveBillToAddresses,
      header.billToAddress,
    );
    const candidate = determineTaxCode(
      item,
      header.placeOfSupply,
      billToAddress?.State || header.placeOfSupply,
      Boolean(header.useBillToForTax),
      refData.company_address?.State || selectedBranch?.State || '',
      effectiveTaxCodes,
    );
    const match = effectiveTaxCodes.find(
      (tax) => String(tax.Code || '').trim().toUpperCase() === String(candidate || '').trim().toUpperCase(),
    );
    return match?.Code || '';
  };

  const hydrateSelectedItem = (line = {}, selectedItem = {}, itemCode = '') => {
    const normalizedItemCode = String(itemCode || selectedItem.ItemCode || '').trim();
    const itemChanged = String(line.itemNo || '').trim() !== normalizedItemCode;
    const baseLine = itemChanged
      ? {
          ...line,
          itemNo: normalizedItemCode,
          itemDescription: '',
          hsnCode: '',
          hsnEntry: '',
          sacCode: '',
          countryOfOrigin: '',
          uomCode: '',
          uomName: '',
          uomEntry: '',
          unitPrice: '',
          inStock: '',
          qtyInWhse: '',
          batchManaged: false,
          whse: header.warehouse || '',
          taxCode: '',
          taxCodeRepeat: '',
          taxCodeManuallyOverridden: false,
          uomNameEdited: false,
        }
      : { ...line, itemNo: normalizedItemCode };
    if (!selectedItem || !String(selectedItem.ItemCode || '').trim()) {
      baseLine.total = fmtDec(calcLineTotal(baseLine), numDec.total);
      return baseLine;
    }

    const next = hydrateDocumentLineFromItem(baseLine, selectedItem, {
      side: 'sales',
      hsnCode: selectedItem.HSNCode || selectedItem.SWW || '',
      fallbackWarehouse: header.warehouse,
      syncUnitPriceUdf: false,
      calcLineTotal,
      formatTotal: (value) => fmtDec(value, numDec.total),
      uomGroups: refData.uom_groups,
    });
    next.itemDescription = getSalesQuotationItemDescription(selectedItem, next.itemDescription);
    const selectedHsnEntry = Number(selectedItem.HSNEntry);
    next.hsnEntry = Number.isInteger(selectedHsnEntry) && selectedHsnEntry > 0
      ? selectedHsnEntry
      : '';
    next.taxCode = resolveAutomaticTaxCode(selectedItem);
    next.taxCodeRepeat = next.taxCode;
    next.total = fmtDec(calcLineTotal(next), numDec.total);
    return next;
  };
  
  // Filter warehouses by selected branch
  const branchFilteredWarehouses = filterWarehousesByBranch(effectiveWarehouses, header.branch);
  
  const payTermOpts = (refData.payment_terms || [])
    .map(t => ({ value: String(t.GroupNum), label: t.PymntGroup }));
  const shipTypeOpts = (refData.shipping_types || [])
    .map(s => ({ value: String(s.TrnspCode), label: s.TrnspName }));

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

  // Ã¢â€â‚¬Ã¢â€â‚¬ calculations Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const calcLineTotal = (line) => {
    const qty = parseNum(line.quantity), price = parseNum(line.unitPrice), disc = parseNum(line.stdDiscount);
    return roundTo(qty * price * (1 - disc / 100), numDec.total);
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
  const documentCurrency = String(header.currency || refData.company_currencies?.localCurrency || '').trim();
  const displayMode = String(header.currencyMode || 'BP').trim().toUpperCase();
  const displayCurrency = resolveDisplayCurrency({
    mode: displayMode,
    documentCurrency,
    localCurrency: refData.company_currencies?.localCurrency,
    systemCurrency: refData.company_currencies?.systemCurrency,
  });
  const formatDisplayMoney = (value, decimals) => {
    const converted = convertDocumentAmountForDisplay(value, {
      mode: displayMode,
      documentCurrency,
      localCurrency: refData.company_currencies?.localCurrency,
      systemCurrency: refData.company_currencies?.systemCurrency,
      documentRate: header.exchangeRate,
      systemRate: header.systemExchangeRate,
      postingMethod: refData.exchange_rate_settings?.postingMethod,
    });
    const amount = fmtDec(converted, decimals);
    return amount !== '' && displayCurrency ? `${amount} ${displayCurrency}` : amount;
  };
  useRelationshipMapRegistration({
    enabled: Boolean(currentDocEntry),
    objectType: 23,
    docEntry: currentDocEntry,
    header,
    total: totals.total,
  });

  // Ã¢â€â‚¬Ã¢â€â‚¬ GST determination logic Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Ã¢â€â‚¬Ã¢â€â‚¬ address sync Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  // Sync branch to all lines when header branch changes
  useEffect(() => {
    if (header.branch) {
      console.log('Ã°Å¸â€â€ž Syncing branch to all lines:', header.branch);
      setLines(prev => {
        const updated = prev.map(l => ({ 
          ...l, 
          branch: String(header.branch), 
          loc: String(header.branch)
        }));
        console.log('Ã¢Å“â€¦ Lines updated with branch:', updated.map(l => ({ branch: l.branch, loc: l.loc })));
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
      
      // Validate warehouse-branch assignment
      if (header.branch) {
        const selectedWarehouse = refData.warehouses.find(w => w.WhsCode === header.warehouse);
        if (selectedWarehouse && selectedWarehouse.BranchID && 
            String(selectedWarehouse.BranchID) !== String(header.branch)) {
          console.warn(`Ã¢Å¡Â Ã¯Â¸Â Warehouse "${header.warehouse}" is assigned to Branch ${selectedWarehouse.BranchID}, but document is for Branch ${header.branch}`);
          setPageState(p => ({ 
            ...p, 
            error: `Warning: Warehouse "${header.warehouse}" is assigned to a different branch. This may cause submission errors.` 
          }));
        }
      }
    }
  }, [header.warehouse, header.branch, refData.warehouses]);

  // Ã¢â€â‚¬Ã¢â€â‚¬ Recalculate Tax Codes on State/Address Changes Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useEffect(() => {
    if (currentDocEntry) return;
    if (!header.vendor || !header.placeOfSupply) return;

    const companyState = refData.company_address?.State || selectedBranch?.State || '';
    
    if (!companyState) {
      console.warn('Ã¢Å¡Â Ã¯Â¸Â Company state not available for tax recalculation');
      return;
    }

    console.log('Ã°Å¸â€â€ž Recalculating Tax Codes for All Lines:', {
      placeOfSupply: header.placeOfSupply,
      companyState,
      gstType: getGSTTypeLabel(companyState, header.placeOfSupply),
      lineCount: lines.filter(l => l.itemNo).length
    });

    setLines((previous) => previous.map((line) => {
      if (!line.itemNo || line.taxCodeManuallyOverridden) return line;
      const item = refData.items.find(
        (candidate) => String(candidate.ItemCode || '') === String(line.itemNo || ''),
      );
      const taxCode = resolveAutomaticTaxCode(item);
      return { ...line, taxCode, taxCodeRepeat: taxCode };
    }));
  }, [currentDocEntry, header.placeOfSupply, header.billToCode, header.useBillToForTax, header.vendor, refData.company_address, selectedBranch]);

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

  // Ã¢â€â‚¬Ã¢â€â‚¬ vendor details Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const loadVendorDetails = async (code) => {
    if (!code) {
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      return;
    }

    setPageState(p => ({ ...p, vendorLoading: true }));

    try {
      const r = await fetchSalesQuotationCustomerDetails(code);
    
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
          contactPerson: contacts[0].CntctCode
        }));
      }

    } catch (err) {
      console.error('Ã¢ÂÅ’ Error loading vendor details:', err);
      console.error('Error response:', err.response?.data);
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
    } finally {
      setPageState(p => ({ ...p, vendorLoading: false }));
    }
  };

  const syncVendor = (code, hdr) => {
    const m = refData.vendors.find(v => String(v.CardCode || '') === String(code || ''));
    if (!m) return { nextHeader: hdr };
    const localCurrency = refData.company_currencies?.localCurrency || hdr.currency || '';
    return {
      nextHeader: {
        ...hdr,
        name: m.CardName || hdr.name,
        paymentTerms: m.PayTermsGrpCode != null ? String(m.PayTermsGrpCode) : hdr.paymentTerms,
        contactPerson: '',
        currency: resolveCurrencyCode(m.Currency, localCurrency),
        exchangeRate: '',
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
        data: buildExchangeRatesFallbackData({ year, month, currencies: refData.currencies || refData.company_currencies?.currencies || [], localCurrency: refData.company_currencies?.localCurrency || '', documentCurrency: exchangeRatesModal.currency }),
      }));
    }
  }, [exchangeRatesModal.currency, refData.currencies, refData.company_currencies]);

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
    const localCurrency = String(refData.company_currencies?.localCurrency || '').trim();
    if (!currency || !postingDate || !localCurrency) return;
    if (currency === localCurrency) {
      setHeader((prev) => prev.exchangeRate ? { ...prev, exchangeRate: '' } : prev);
      return;
    }
    if (!header.exchangeRate) {
      openExchangeRatesModal({ currency, postingDate, initialRate: '' });
    }
  }, [header.currency, header.exchangeRate, header.postingDate, openExchangeRatesModal, refData.company_currencies]);

  useEffect(() => {
    if (currentDocEntry) return;
    if (!header.vendor || !header.currency || !header.postingDate) return;
    refreshExchangeRate(header.currency, header.postingDate);
  }, [currentDocEntry, header.vendor, header.currency, header.postingDate, refreshExchangeRate]);

  // Ã¢â€â‚¬Ã¢â€â‚¬ handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
        exchangeRate: String(prev.currency || '').trim() === String(refData.company_currencies?.localCurrency || '').trim()
          ? prev.exchangeRate
          : '',
      }));
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
    
    // Ã¢Å“â€¦ FIX: When purchaser (Sales Employee name) changes, update salesEmployee (code) too
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
      
      console.log('Ã°Å¸â€â€ž Sales Employee changed:', {
        name: value,
        code: selectedEmployee ? selectedEmployee.SlpCode : '-1'
      });
      
      return;
    }
    
    if (numDec[name] !== undefined && type !== 'checkbox') {
      setHeader(p => ({ ...p, [name]: sanitize(value, numDec[name]) }));
      return;
    }
    setHeader(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
  };
  
  const handleShipToChange = (addressCode) => {
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

  const refreshAddModeSeries = async (postingDateValue = today(), selectedSeries = '') => { setHeader(prev => ({ ...prev, postingDate: postingDateValue, series: '', nextNumber: '' })); setSeriesRevision(value => value + 1); };

  const handleLineChange = (i, e) => {
    const { name, value } = e.target;
    setValErrors(p => ({ ...p, lines: { ...p.lines, [i]: { ...(p.lines[i] || {}), [name]: '' } }, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));
    
    if (name === 'itemNo') {
      const item = refData.items.find(
        (candidate) => String(candidate.ItemCode || '') === String(value || ''),
      );
      setLines((previous) => previous.map(
        (line, index) => index === i ? hydrateSelectedItem(line, item, value) : line,
      ));
      return;
    }

    setLines(prev => prev.map((line, idx) => {
      if (idx !== i) return line;
      const next = { ...line, [name]: numDec[name] !== undefined ? sanitize(value, numDec[name]) : value };
      if (name === 'uomName') next.uomNameEdited = true;
      if (name === 'taxCode') {
        next.taxCodeManuallyOverridden = true;
        next.taxCodeRepeat = value;
      }
      if (name === 'uomCode') {
        const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
        Object.assign(next, applyUomCodeSelection(next, value, getLineUomOptions(next, item, refData.uom_groups)));
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
        let next = { ...pastedLine };
        const pastedKeys = new Set(rowPatch.cells.map(cell => cell.key));
        if (pastedKeys.has('itemNo')) {
          const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
          const pastedValues = { ...next, udf: { ...(next.udf || {}) } };
          next = hydrateSelectedItem(next, item, next.itemNo);
          rowPatch.cells.forEach((cell) => {
            if (cell.isUdf) next.udf = { ...(next.udf || {}), [cell.key]: cell.value };
            else next[cell.key] = pastedValues[cell.key];
          });
        }
        if (pastedKeys.has('uomCode')) {
          const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
          Object.assign(next, applyUomCodeSelection(next, next.uomCode, getLineUomOptions(next, item, refData.uom_groups)));
        }
        if (pastedKeys.has('taxCode')) {
          next.taxCodeManuallyOverridden = true;
          next.taxCodeRepeat = next.taxCode;
        }
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

  const getLineEntryErrors = (line = {}, { isUpdate = false } = {}) => {
    const errors = {};
    if (!String(line.itemNo || '').trim()) {
      errors.itemNo = 'Item is required';
    }
    if (!line.quantity || Number(line.quantity) <= 0) {
      errors.quantity = 'Quantity must be greater than 0';
    }
    if (!isUpdate && (!line.unitPrice || Number(line.unitPrice) <= 0)) {
      errors.unitPrice = 'Unit Price must be greater than 0';
    }
    if (!isUpdate && !String(line.whse || '').trim()) {
      errors.whse = 'Warehouse is required';
    }

    [
      ['hsnCode', 'HSN Code'],
      ['uomCode', 'UoM'],
      ['taxCode', 'Tax Code'],
    ].forEach(([fieldKey, label]) => {
      if (!isUpdate && getLineFieldPolicy(fieldKey).required && !String(line[fieldKey] || '').trim()) {
        errors[fieldKey] = `${label} is required`;
      }
    });

    const taxCode = String(line.taxCode || '').trim();
    if (taxCode && !effectiveTaxCodes.some(
      (tax) => String(tax.Code || '').trim().toUpperCase() === taxCode.toUpperCase(),
    )) {
      errors.taxCode = `Tax code '${taxCode}' is not valid in the active SAP company`;
    }
    return errors;
  };

  const addLine = () => {
    // Validate the last line before adding a new one
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const lastIndex = lines.length - 1;
      const errors = getLineEntryErrors(lastLine);
      
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
      whse: header.warehouse || ''
    }]);
  };

  const removeLine = (i) => {
    markDirty();
    setValErrors(p => { const nl = { ...p.lines }; delete nl[i]; return { ...p, lines: nl, form: '' }; });
    setLines(p => p.filter((_, idx) => idx !== i));
  };

  const handleHeaderUdfChange = (e, val) => {
    markDirty();
    // Support both direct key-value pairs (from Sidebar) and standard React events (from native inputs)
    if (typeof e === 'string') {
      setHeaderUdfs(p => ({ ...p, [e]: val }));
    } else if (e && e.target) {
      const { name, value, type, checked } = e.target;
      setHeaderUdfs(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
    }
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Address Modal handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const openAddressModal = (type) => {
    const shipAddress = resolveSalesQuotationAddress(
      header.shipToCode,
      vendorEffectiveShipToAddresses,
      header.shipToAddress || header.shipTo,
    );
    const billAddress = resolveSalesQuotationAddress(
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
      const selectedAddress = resolveSalesQuotationAddress(value, vendorEffectiveShipToAddresses);
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
      const selectedAddress = resolveSalesQuotationAddress(value, vendorEffectiveBillToAddresses);
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ E-Way Bill Modal handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Tax Info Modal handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ State Selection Modal handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const openStateModal = () => {
    setStateModal(true);
  };

  const closeStateModal = () => {
    setStateModal(false);
  };

  const handleStateSelect = (state) => {
    setHeader(p => ({ ...p, placeOfSupply: getStateCodeValue(state, refData.states) }));
  };

  // Ã¢â€â‚¬Ã¢â€â‚¬ Business Partner Modal handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ HSN Code Modal handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Item Selection Modal handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const openItemModal = async (lineIndex) => {
    console.log('Ã°Å¸â€Â Opening item modal for line:', lineIndex);
    const fallbackItems = Array.isArray(refData.items) ? refData.items : [];
    setItemModal({
      open: true,
      lineIndex,
      items: fallbackItems,
      loading: fallbackItems.length === 0,
    });
    
    try {
      console.log('Ã°Å¸â€œÂ¡ Fetching items from API...');
      const response = await fetchItemsForModal();
      const payload = response?.data;
      const normalizedItems = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload)
          ? payload
          : [];
      console.log('Ã¢Å“â€¦ Items received:', payload);
      console.log('Ã°Å¸â€œÅ  Items count:', normalizedItems.length);
      
      setItemModal((prev) => ({
        ...prev,
        items: normalizedItems.length > 0 ? normalizedItems : fallbackItems,
        loading: false,
      }));
    } catch (error) {
      console.error('Ã¢ÂÅ’ Failed to load items:', error);
      console.error('Error details:', error.response?.data || error.message);
      setItemModal((prev) => ({
        ...prev,
        items: prev.items.length > 0 ? prev.items : fallbackItems,
        loading: false,
      }));
    }
  };

  const closeItemModal = () => {
    setItemModal({ open: false, lineIndex: -1, items: [], loading: false });
  };

  const handleItemSelect = (item) => {
    if (itemModal.lineIndex < 0) return;
    
    const lineIndex = itemModal.lineIndex;
    const mergedItem = mergeItemMaster(item, refData.items);
    setLines((previous) => previous.map(
      (line, index) => index === lineIndex
        ? hydrateSelectedItem(line, mergedItem, mergedItem.ItemCode)
        : line,
    ));
    closeItemModal();
  };

  // Ã¢â€â‚¬Ã¢â€â‚¬ Freight Selection Modal handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const openFreightModal = async () => {
    console.log('Ã°Å¸Å¡Å¡ Opening freight modal, docEntry:', currentDocEntry);
    if (freightModal.freightCharges.length > 0) {
      setFreightModal(prev => ({ ...prev, open: true, loading: false }));
      return;
    }
    setFreightModal(prev => ({ ...prev, open: true, loading: true }));
    
    try {
      console.log('Ã°Å¸â€œÂ¡ Fetching freight charges from API...');
      const response = await fetchFreightCharges(currentDocEntry);
      console.log('Ã¢Å“â€¦ Freight charges received:', response.data);
      console.log('Ã°Å¸â€œÅ  Freight charges count:', response.data.freightCharges?.length || 0);
      
      setFreightModal({
        open: true,
        freightCharges: response.data.freightCharges || [],
        loading: false
      });
    } catch (error) {
      console.error('Ã¢ÂÅ’ Failed to load freight charges:', error);
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
    console.log('Ã°Å¸Å¡Å¡ Applied freight charges:', summary);
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ Copy From Handler Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const openCopyFromModal = () => {
    if (currentDocEntry) return;

    const bpCode = String(header.vendor || '').trim();
    if (!bpCode) {
      setValErrors({ header: { vendor: 'Select Customer first' }, lines: {}, form: '' });
      setPageState(prev => ({ ...prev, error: '', success: '' }));
      return;
    }

    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(prev => ({ ...prev, error: '', success: '' }));
    setCopyFromModal(true);
  };

  const fetchCopyFromDocuments = async () => {
    const bpCode = String(header.vendor || '').trim();
    if (!bpCode) return [];
    const response = await fetchOpenSalesQuotations(bpCode);
    return response.data?.documents || [];
  };

  const fetchCopyFromDocumentDetails = async (_docType, docEntry) => {
    const response = await fetchSalesQuotationForCopy(docEntry);
    return response.data;
  };

  const handleCopyFrom = (documentData, docType = 'salesQuotation') => {
    setSeriesRevision(value => value + 1);

    console.log('Copying from:', docType, documentData);

    const copySource = unwrapCopyFromDocument(documentData);
    const normalizedHeader = normaliseDocumentHeader(copySource.header);
    const sourceHeaderUdfs = copySource.document?.header_udfs || copySource.source?.header_udfs || documentData?.header_udfs || {};
    const sourceFreightCharges = copySource.document?.freightCharges || copySource.source?.freightCharges || documentData?.freightCharges || [];
    const rawLines = copySource.lines;
    const baseEntry = copySource.docEntry || documentData?.baseDocument?.baseEntry || null;
    const baseType = BASE_TYPE[docType] || BASE_TYPE.salesQuotation;
    const firstLine = rawLines[0] || {};
    const firstLineWarehouse = firstLine.WarehouseCode || firstLine.WhsCode || firstLine.whse || '';

    setCurrentDocEntry(null);
    setHeader(prev => ({
      ...prev,
      vendor: normalizedHeader.vendor,
      name: normalizedHeader.name,
      contactPerson: normalizedHeader.contactPerson,
      placeOfSupply: normalizedHeader.placeOfSupply,
      paymentTerms: normalizedHeader.paymentTerms,
      branch: normalizedHeader.branch,
      warehouse: firstLineWarehouse || prev.warehouse,
      otherInstruction: normalizedHeader.otherInstruction || prev.otherInstruction,
      docNo: '',
      nextNumber: prev.nextNumber,
      status: 'Open',
    }));

    const copiedLines = rawLines.map((line, idx) => {
      const normalizedLine = normaliseDocumentLine(
        line,
        idx,
        baseEntry,
        baseType,
        normalizedHeader.branch
      );

      const nextLine = {
        ...createLine(rowUdfDefinitions),
        ...normalizedLine,
        baseType,
        baseEntry,
        baseLine: line.LineNum ?? line.lineNum ?? normalizedLine.baseLine ?? idx,
        udf: normalizeUdfState(rowUdfDefinitions, line.udf || {}),
      };

      return {
        ...nextLine,
        total: fmtDec(calcLineTotal(nextLine), numDec.total),
      };
    });

    setLines(copiedLines.length ? copiedLines : [createLine(rowUdfDefinitions)]);
    setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, sourceHeaderUdfs));
    setFreightModal({ open: false, freightCharges: Array.isArray(sourceFreightCharges) ? sourceFreightCharges : [], loading: false });

    if (normalizedHeader.vendor) {
      loadVendorDetails(normalizedHeader.vendor);
    }

    setCopyFromModal(false);
    setPageState(p => ({ ...p, error: '', success: 'Copied from Sales Quotation. Please review and save.' }));
  };

  const handleCopyTo = async (targetType) => {
    await copyToDocument({
      sourceDocType: 'salesQuotation',
      targetType,
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: { header, lines, headerUdfs, freightCharges: freightModal.freightCharges },
      restoreState: { salesQuotationDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      beforeNavigate: closeDocumentDropdowns,
      setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
      errorMessage: pageState.loading
        ? 'Please wait until the sales quotation has finished loading before using Copy To.'
        : 'Open a saved sales quotation before using Copy To.',
    });
  };

  const handleDuplicate = async () => {
    setSeriesRevision(value => value + 1);

    const resetHeader = createInitialHeader();
    const duplicated = duplicateDocumentInPlace({
      currentDocEntry,
      header,
      initialHeader: resetHeader,
      lines: lines.map((line) => ({
        ...line,
        taxCodeManuallyOverridden: Boolean(String(line.taxCode || '').trim()),
      })),
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
      successMessage: 'Sales quotation duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      setHeader(prev => ({
        ...prev,
        postingDate: resetHeader.postingDate,
        documentDate: resetHeader.documentDate,
        deliveryDate: resetHeader.deliveryDate,
        docNo: '',
        nextNumber: '',
        series: '',
        status: 'Open',
      }));
      await refreshAddModeSeries(resetHeader.postingDate);
    }
  };

  // eslint-disable-next-line no-unused-vars
  const handleCopyFromLegacy = (documentData, docType) => {
    console.log('Ã°Å¸â€œâ€¹ Copying from:', docType, documentData);
    
    // Copy header
    setHeader(prev => ({
      ...prev,
      vendor: documentData.header.vendor,
      name: documentData.header.name,
      contactPerson: documentData.header.contactPerson,
      placeOfSupply: documentData.header.placeOfSupply,
      paymentTerms: documentData.header.paymentTerms,
      branch: documentData.header.branch,
    }));

    // Copy lines WITHOUT tax codes (will be recalculated)
    const copiedLines = documentData.lines.map(line => ({
      ...createLine(rowUdfDefinitions),
      ...line,
      taxCode: '', // DO NOT copy tax code - will be auto-determined
      baseType: documentData.baseDocument.baseType,
      baseEntry: documentData.baseDocument.baseEntry,
      baseLine: line.lineNum,
    }));

    setLines(copiedLines);
    
    // Load vendor details to trigger address and tax recalculation
    if (documentData.header.vendor) {
      loadVendorDetails(documentData.header.vendor);
    }
    
    setCopyFromModal(false);
  };

  // Ã¢â€â‚¬Ã¢â€â‚¬ Browse Attachment handler Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ validation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const validate = () => {
    const isUpdate = !!currentDocEntry;
    const e = { header: {}, lines: {}, form: '' };
    const localCurrency = String(refData.company_currencies?.localCurrency || '').trim();
    const documentCurrency = String(header.currency || '').trim();
    if (documentCurrency && localCurrency && documentCurrency !== localCurrency) {
      const rate = Number(header.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) {
        e.header.exchangeRate = 'Exchange rate is required for foreign currency documents.';
        e.form = 'Please enter the SAP exchange rate before saving.';
        return e;
      }
    }

    if (!isUpdate && isManualDocumentSeries(header.series) && !isValidManualDocumentNumber(header.nextNumber)) {
      e.header.nextNumber = 'Enter a positive document number for Manual series.';
      e.form = 'Please correct the highlighted fields.';
      return e;
    }
    
    if (!isUpdate) {
      const vc = String(header.vendor || '').trim();
      if (!vc) { e.header.vendor = 'Select a customer.'; e.form = 'Please correct the highlighted fields.'; return e; }

      // Require a branch only for companies that actually use SAP branches.
      if (refData.branches.length && !String(header.branch || '').trim()) {
        e.header.branch = 'Select a branch.';
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

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

      const lineErrors = getLineEntryErrors(l, { isUpdate });
      if (Object.keys(lineErrors).length) {
        e.lines[i] = lineErrors;
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ submit Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
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
      setActiveTab(getValidationTab(e));
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
        branch: header.branch,
        contactPerson: header.contactPerson,
        series: header.series ? Number(header.series) : undefined,
      };
      
      // Clean lines - remove any readonly/computed fields
      const cleanedLines = lines.map(line => ({
        lineNum: line.lineNum,
        itemNo: line.itemNo,
        itemDescription: line.itemDescription,
        hsnCode: line.hsnCode,
        hsnEntry: line.hsnEntry,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        price: line.price,
        sellerPrice: line.sellerPrice,
        buyerPrice: line.buyerPrice,
        sellerDelivery: line.sellerDelivery,
        buyerDelivery: line.buyerDelivery,
        sellerBrokerageAmtPer: line.sellerBrokerageAmtPer,
        sellerBrokeragePercent: line.sellerBrokeragePercent,
        sellerBrokerage: line.sellerBrokerage,
        buyerBrokerage: line.buyerBrokerage,
        specialRebate: line.specialRebate,
        commission: line.commission,
        sellerBrokeragePerQty: line.sellerBrokeragePerQty,
        unitPriceUdf: line.unitPriceUdf,
        buyerPaymentTerms: line.buyerPaymentTerms,
        sellerPaymentTerms: line.sellerPaymentTerms,
        buyerQuality: line.buyerQuality,
        sellerQuality: line.sellerQuality,
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
        uomName: line.uomName,
        uomNameEdited: line.uomNameEdited,
        uomEntry: line.uomEntry,
        stdDiscount: line.stdDiscount,
        stcode: line.stcode,
        taxCode: line.taxCode,
        taxCodeRepeat: line.taxCodeRepeat,
        total: line.total,
        whse: line.whse,
        distRule: line.distRule,
        distRule2: line.distRule2,
        distRule3: line.distRule3,
        distRule4: line.distRule4,
        distRule5: line.distRule5,
        cogsDistRule: line.cogsDistRule,
        cogsDistRule2: line.cogsDistRule2,
        cogsDistRule3: line.cogsDistRule3,
        cogsDistRule4: line.cogsDistRule4,
        cogsDistRule5: line.cogsDistRule5,
        glAccount: line.glAccount,
        freeText: line.freeText,
        countryOfOrigin: line.countryOfOrigin,
        sacCode: line.sacCode,
        loc: line.loc,
        branch: line.branch,
        requiredDate: line.requiredDate,
        noOfPackages: line.noOfPackages,
        quotedDate: line.quotedDate,
        lineDeliveryDate: line.lineDeliveryDate,
        lineShippingType: line.lineShippingType,
        wTaxLiable: line.wTaxLiable,
        taxLiable: line.taxLiable,
        blanketAgreementNo: line.blanketAgreementNo,
        blanketAgreementLine: line.blanketAgreementLine,
        commPercent: line.commPercent,
        withoutQtyPosting: line.withoutQtyPosting,
        baseEntry: line.baseEntry,
        baseType: line.baseType,
        baseLine: line.baseLine,
        batches: line.batches,
        udf: buildVisibleEnteredRowUdfPayload(
          rowUdfDefinitions,
          line.udf || {},
          formSettings,
          { preserveUnmappedUdfs: false },
        ),
      }));
      
      const payload = {
        company_id: activeCompanyId,
        header: prep,
        lines: cleanedLines,
        freightCharges: freightModal.freightCharges,
        header_udfs: normalizeUdfState(headerUdfDefinitions, headerUdfs),
      };
      
      const r = currentDocEntry ? await updateSalesQuotation(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitSalesQuotation(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      const resetHeader = createInitialHeader();
      setSnapshotPending(false);
      setIsDirty(false);
      setCurrentDocEntry(null); setHeader(resetHeader); setLines([createLine(rowUdfDefinitions)]);
      setFreightModal({ open: false, freightCharges: [], loading: false });
      setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [] }));
      setValErrors({ header: {}, lines: {}, form: '' });
      await refreshAddModeSeries(resetHeader.postingDate);
      
      setPageState(p => ({ ...p, success: `${r.data.message || 'Sales Quotation saved.'}${dn}` }));
    } catch (e) {
      console.error('Ã¢ÂÅ’ Sales Quotation Submission Error:', e);
      console.error('Error Response:', e.response?.data);
      setPageState(p => ({ ...p, error: getErrMsg(e, 'Sales Quotation submission failed.') }));
    } finally {
      setPageState(p => ({ ...p, posting: false }));
    }
  };

  const resetForm = async () => {
    setSeriesRevision(value => value + 1);

    const resetHeader = createInitialHeader();
    setSnapshotPending(false);
    setIsDirty(false);
    setCurrentDocEntry(null); setHeader(resetHeader); setLines([createLine(rowUdfDefinitions)]);
    setFreightModal({ open: false, freightCharges: [], loading: false });
    setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, error: '', success: '' }));
    await refreshAddModeSeries(resetHeader.postingDate);
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

  // Ã¢â€â‚¬Ã¢â€â‚¬ render Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  useDocumentSeries({ endpoint: '/sales-quotation', companyKey: String(activeCompanyId), currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form ref={formRef} className={`so-page sap-document-page${isRightSidebarOpen ? ' so-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>

      {/* toolbar */}
      <div className="so-toolbar sap-document-toolbar">
        <span className="so-toolbar__title">Sales Quotation{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="so-btn so-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || !isDocumentEditable || formSettingsStatus.queryModeActive} title={primaryActionLabel}>
          {primaryActionLabel}
        </button>
        <button type="button" className="so-btn sap-document-toolbar__cancel" onClick={resetForm}>
          Cancel
        </button>
        <button type="button" className="so-btn sap-document-toolbar__udf" onClick={toggleHeaderUdfs}>
          {sidebarOpen ? 'Hide UDFs' : 'Show UDFs'}
        </button>
        <button type="button" className="so-btn sap-document-toolbar__settings" onClick={toggleFormSettings} disabled={!companyFormSettingsReady || formSettingsStatus.queryModeActive} title={formSettingsStatus.queryModeActive ? 'Company SQL Content layout is active' : (companyFormSettingsReady ? 'Choose document-line fields' : 'Loading company Form Settings')}>
          Form Settings
        </button>
        <PrintLayoutToolbar
          documentType="salesQuotation"
          documentLabel="Sales Quotation"
          docEntry={currentDocEntry}
          docNumber={header.docNo}
          disabled={pageState.posting}
          classPrefix="so"
          onSuccess={(message) => setPageState(p => ({ ...p, error: '', success: message }))}
          onError={(message) => setPageState(p => ({ ...p, success: '', error: message }))}
        />
        <button type="button" className="so-btn sap-document-toolbar__copy" onClick={() => openCopyFromModal()} disabled={!isDocumentEditable || !!currentDocEntry || formSettingsStatus.queryModeActive}>
          Copy From
        </button>
        <CopyToDropdown
          sourceDocType="salesQuotation"
          disabled={!currentDocEntry || formSettingsStatus.queryModeActive}
          onCopyTo={handleCopyTo}
        />
        {currentDocEntry && (
          <button type="button" className="so-btn sap-document-toolbar__duplicate" onClick={handleDuplicate} disabled={formSettingsStatus.queryModeActive}>
            Duplicate
          </button>
        )}
        <button type="button" className="so-btn sap-document-toolbar__find" onClick={() => navigate('/sales-quotation/find')}>Find</button>
        <button type="button" className="so-btn sap-document-toolbar__new" onClick={resetForm}>New</button>
      </div>

      {/* alerts */}
      {pageState.loading && <div className="so-alert so-alert--success" style={{ marginTop: 0 }}>Loading...</div>}
      {pageState.error && <div className="so-alert so-alert--error" role="alert" data-auto-dismiss="false">{pageState.error}</div>}
      {pageState.success && <div className="so-alert so-alert--success">{pageState.success}</div>}
      {refData.warnings?.length > 0 && (
        <div className="so-alert so-alert--warning">
          <strong>SAP warnings:</strong>
          {refData.warnings.map((w, i) => <div key={i}>{w}</div>)}
          <div style={{ marginTop: 4, color: '#555' }}>Dropdowns are showing fallback values. Connect to SAP to load live data.</div>
          <div style={{ marginTop: 4, color: '#d00', fontWeight: 600 }}>Ã¢Å¡Â Ã¯Â¸Â Tax codes shown are examples only. Use actual SAP tax codes to avoid submission errors.</div>
        </div>
      )}

      <fieldset ref={documentBodyRef} className="so-fieldset" aria-disabled={!isDocumentEditable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <div className={`so-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`}>
        <div className="so-layout__main">

            {/* Ã¢â€¢ÂÃ¢â€¢Â HEADER CARD Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
            <div className="so-header-card">
              <div className="row g-2">
                {/* LEFT COLUMN */}
                <div className="col-md-6">
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
                      currencyOptions={refData.currencies || refData.company_currencies?.currencies || []}
                      localCurrency={refData.company_currencies?.localCurrency || ''}
                      systemCurrency={refData.company_currencies?.systemCurrency || refData.company_currencies?.localCurrency || ''}
                      fallbackLocalCurrency=""
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
                        style={{ border: valErrors.header.branch ? '1px solid #c00' : undefined }}
                      >
                        <option value="">Select Branch</option>
                        {refData.branches.map(b => (
                          <option key={b.BPLId} value={b.BPLId}>
                            {b.BPLName}
                          </option>
                        ))}
                      </select>
                      {valErrors.header.branch && (
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
                        style={{ border: valErrors.header.warehouse ? '1px solid #c00' : undefined }}
                        title={header.branch ? `Showing warehouses for selected branch` : 'Select a branch first to filter warehouses'}
                      >
                        <option value="">Select Warehouse</option>
                        {branchFilteredWarehouses.map(w => (
                          <option key={w.WhsCode} value={w.WhsCode}>
                            {w.WhsCode} - {w.WhsName}
                          </option>
                        ))}
                      </select>
                      {valErrors.header.warehouse && (
                        <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.header.warehouse}</div>
                      )}
                    </div>

                  </div>
                </div>

                {/* RIGHT COLUMN */}
                <div className="col-md-6">
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
                        {(canUseManualSeries(refData) || (currentDocEntry && ['-1','manual','__sap_manual__'].includes(String(header.series)))) && (<option value={SAP_MANUAL_SERIES_VALUE}>Manual</option>)}
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
                        className={`so-field__input${valErrors.header.nextNumber ? ' so-field__input--error' : ''}`}
                        value={currentDocEntry ? (header.docNo || header.nextNumber || '') : (header.nextNumber || '')}
                        onChange={handleHeaderChange}
                        readOnly={!!currentDocEntry || !isManualDocumentSeries(header.series)}
                        inputMode="numeric"
                        style={{ background: !currentDocEntry && isManualDocumentSeries(header.series) ? '#fff' : '#f0f2f5' }}
                        title={isManualDocumentSeries(header.series) ? 'Enter the manual document number' : 'Number will be assigned from the selected series'}
                      />
                    </div>

                    {/* Customer Ref. No. */}
                    <div className="so-field">
                      <label className="so-field__label">Customer Ref. No.</label>
                      <input name="customerRefNo" className="so-field__input" value={header.customerRefNo} onChange={handleHeaderChange} />
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
                      {valErrors.header.documentDate && (
                        <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.header.documentDate}</div>
                      )}
                    </div>

                  </div>
                </div>
              </div>
            </div>

            {/* Ã¢â€¢ÂÃ¢â€¢Â TABS Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
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

            {/* Ã¢â€¢ÂÃ¢â€¢Â TAB CONTENT Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
            {activeTab === 'Contents' && (
              <ContentsTab
                companyQueryContext={buildCompanyFormQueryContext(currentDocEntry, header)}
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
                distributionDimensions={refData.distribution_dimensions || []}
                countries={refData.countries || []}
                onOpenHSNModal={openHSNModal}
                onOpenItemModal={openItemModal}
                onOpenQualityModal={openQualityModal}
                onOpenPaymentTermsModal={openPaymentTermsModal}
                getBranchName={getBranchName}
                formSettings={formSettings}
                formSettingsReady={companyFormSettingsReady}
                matrixFields={effectiveMatrixColumnDefinitions}
                useSapMatrixOrder={Boolean(refData.line_field_metadata?.sap_form?.preferenceRows)}
                rowUdfFields={visibleRowUdfs}
                onRowUdfChange={handleRowUdfChange}
                onLoadLookupOptions={loadDynamicLineLookupOptions}
                displayCurrency={displayCurrency}
                documentCurrency={documentCurrency}
                formatDisplayMoney={formatDisplayMoney}
                canPasteTable={isDocumentEditable}
                onPasteTable={handleTablePaste}
                onClipboardFeedback={handleTableClipboardFeedback}
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

            {/* Ã¢â€¢ÂÃ¢â€¢Â TOTALS FOOTER Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
            <div className="so-header-card">
              <div className="so-field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
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
                  </div>
                  <div className="so-field">
                    <label className="so-field__label">Remarks</label>
                    <textarea className="so-textarea" rows={3} name="otherInstruction" value={header.otherInstruction || ''} onChange={handleHeaderChange} />
                  </div>
                </div>
                <div>
                  <div className="so-section-title">Tax Summary</div>
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
                  <div className="so-grid-wrap">
                    <table className="so-grid" style={{ marginTop: '8px' }}>
                      <tbody>
                        <tr>
                          <td>Total Before Discount</td>
                          <td className="so-grid__cell--num"><input className="so-grid__input" value={formatDisplayMoney(totals.subtotal, numDec.total)} readOnly /></td>
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
                          <td className="so-grid__cell--num"><input className="so-grid__input" value={formatDisplayMoney(totals.taxAmt, numDec.tax)} readOnly /></td>
                        </tr>
                        <tr style={{ borderTop: '2px solid #a0aab4' }}>
                          <td style={{ fontWeight: 700, color: '#003366' }}>Total</td>
                          <td className="so-grid__cell--num" style={{ fontWeight: 700, color: '#003366' }}><input className="so-grid__input" style={{ fontWeight: 700, color: '#003366' }} value={formatDisplayMoney(totals.total, numDec.totalPaymentDue)} readOnly /></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Ã¢â€¢ÂÃ¢â€¢Â ACTION BUTTONS Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â */}
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
                <button type="button" className="so-btn" onClick={() => openCopyFromModal()}>
                  Copy From
                </button>
              </div>
            </div>
            )}

          </div>{/* end main col */}

          <HeaderUdfSidebar
            className="so-layout__sidebar"
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
            className="so-layout__sidebar"
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
        businessPartners={refData.vendors || []}
      />

      {/* Copy From Modal */}
      <CopyFromModal
        isOpen={copyFromModal}
        onClose={() => setCopyFromModal(false)}
        onCopy={handleCopyFrom}
        documentType="salesQuotation"
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
        portalTarget={document.body}
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
        currency={header.currency || refData.company_currencies?.localCurrency || ''}
      />
      <ExchangeRatesIndexesModal
        isOpen={exchangeRatesModal.open}
        currency={exchangeRatesModal.currency}
        postingDate={exchangeRatesModal.postingDate}
        initialRate={exchangeRatesModal.initialRate}
        loading={exchangeRatesModal.loading}
        error={exchangeRatesModal.error}
        data={exchangeRatesModal.data}
        documentLabel="sales quotation"
        onLoad={loadExchangeRatesMonth}
        onSave={saveExchangeRateFromModal}
        onClose={() => setExchangeRatesModal((prev) => ({ ...prev, open: false }))}
      />
    </form>
  );
}

export default SalesQuotation;
