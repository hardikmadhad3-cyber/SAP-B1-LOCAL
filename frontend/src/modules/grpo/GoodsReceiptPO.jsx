import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import './styles/GoodsReceiptPO.css';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import FormSettingsPanel from './components/FormSettingsPanel';
import HeaderUdfSidebar from './components/HeaderUdfSidebar';
import ContentsTab from './components/ContentsTab';
import LogisticsTab from './components/LogisticsTab';
import AccountingTab from './components/AccountingTab';
import TaxTab from './components/TaxTab';
import ElectronicDocumentsTab from './components/ElectronicDocumentsTab';
import AttachmentsTab from './components/AttachmentsTab';
import ReferenceDocumentsModal from '../sales-order/components/ReferenceDocumentsModal';
import AddressModal from '../../components/document/AddressComponentModal';
import TaxInfoModal from './components/TaxInfoModal';
import CopyFromModal from './components/CopyFromModal';
import BatchAllocationModal from './components/BatchAllocationModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import BusinessPartnerModal from './components/BusinessPartnerModal';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import PurchasePrintLayoutActions from '../../components/print-layout/PurchasePrintLayoutActions';
import JournalEntryPreviewButton from '../../components/journal-entry/JournalEntryPreviewButton';
import SapGoldenArrowButton from '../../components/document/SapGoldenArrowButton';
import SalesEmployeeSetupModal from '../../components/sales-employee/SalesEmployeeSetupModal';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import { copyToDocument } from '../../services/documentCopyService';
import { duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import { mapAddressToModalForm, resolveAddressForModal } from '../../utils/documentAddress';
import { getDefaultSeriesForCurrentYear, getSapVisibleDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import { useStandardSalesFormSettings } from '../../utils/standardSalesFormSettings';
import { buildCompanyFormQueryContext } from '../../utils/companyFormQueryContext';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import { getStateCodeValue } from '../../utils/stateDisplay';
import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount } from '../../utils/documentRounding';
import DocumentRoundingInput from '../../components/sales-document/DocumentRoundingInput';
import { getItemPrice, getItemPurchaseUom } from '../../utils/documentItemHydration';
import { applyUomCodeSelection, getLineUomOptions } from '../../utils/documentUom';
import {
  SAP_MANUAL_SERIES_VALUE,
  isManualDocumentSeries,
  isValidManualDocumentNumber,
} from '../../utils/documentSeries';
import { normaliseDocumentHeader } from '../../api/copyFromApi';
import useSalesEmployeeSetup from '../../hooks/useSalesEmployeeSetup';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import {
  BATCH_QTY_TOLERANCE,
  getRequiredBatchQty,
  getLineUomFactor,
  sumBatchQty,
} from '../../utils/batchQuantity';
import {
  fetchGRPOReferenceData,
  fetchGRPOByDocEntry,
  fetchGRPOVendorDetails,
  submitGRPO,
  updateGRPO,
  fetchDocumentSeries,
  fetchPurchaseOrderForCopy,
  fetchBatchesByItem,
  fetchNextBatchNumber,
  fetchItemsForModal,
  fetchFreightCharges,
} from '../../api/grpoApi';
import { fetchSalesOrderReferenceDocumentLookup } from '../../api/salesOrderApi';
import { fetchHSNCodeFromItem } from '../../api/hsnCodeApi';
import {
  BASE_MATRIX_COLUMNS,
  FORM_SETTINGS_STORAGE_KEY,
  GRPO_LINE_UDF_FIELD_MAP,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createUdfState,
  readSavedFormSettings,
} from '../../config/grpoForm';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import { consumeCopyToState, replaceRouteStatePreservingWindow } from '../../utils/copyToState';
import { openLinkedBusinessPartner, openLinkedReferenceDocument } from '../../utils/sapLinkedNavigation';
import useValidationHighlights from '../../utils/useValidationHighlights';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import { fetchSalesDocumentSchema } from '../../api/salesDocumentSchemaApi';
import { buildSalesDocumentLiveFields } from '../../utils/salesDocumentLiveFields';
import { hydrateWorkbookDocumentLine } from '../../utils/workbookLineHydration';
import { applyDocumentTablePaste } from '../../utils/documentTableClipboard';
import useDocumentDraftTask from '../../hooks/useDocumentDraftTask';
import {
  buildGRPOLineUdfPayload,
  getFirstLineValue,
  getLineUdfValue,
  hydrateGRPOLineUdfFields,
  resolveUdfDefinitionKey,
  synchronizeGRPOLineFieldChange,
  synchronizeGRPOLineUdfChange,
} from './grpoLineUdfMapping';

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
const isBatchManaged = (item) => String(item?.BatchManaged || '').toUpperCase() === 'Y';
const isGstTaxCode = (taxCode) => {
  const value = String(taxCode || '').trim().toUpperCase();
  return Boolean(value) && value.includes('GST') && !value.includes('NON-GST') && !value.includes('NONGST');
};
const normalizeState = (value) => String(value || '').trim().toUpperCase();
const getDerivedGstType = (vendorState, placeOfSupply) => {
  if (!vendorState || !placeOfSupply) return '';
  return normalizeState(vendorState) === normalizeState(placeOfSupply) ? 'INTRASTATE' : 'INTERSTATE';
};
const formatDerivedGstType = (gstType) => {
  if (gstType === 'INTRASTATE') return 'CGST + SGST';
  if (gstType === 'INTERSTATE') return 'IGST';
  return '';
};
const normalizeGRPOReferenceDocuments = (rows = []) => (
  Array.isArray(rows)
    ? rows.map((row) => ({
      direction: row.direction || row.Direction || 'to',
      transactionType: String(row.transactionType ?? row.referencedObjectType ?? row.RefObjType ?? row.RefType ?? ''),
      docEntry: String(row.docEntry ?? row.referencedDocEntry ?? row.RefDocEntr ?? row.RefDocEntry ?? ''),
      docNumber: String(row.docNumber ?? row.referencedDocNumber ?? row.RefDocNum ?? row.RefDocNo ?? ''),
      extDocNumber: String(row.extDocNumber ?? row.externalDocNumber ?? row.ExtDocNum ?? row.ExtDocNo ?? ''),
      issueDate: row.issueDate || row.IssueDate || '',
      remark: row.remark || row.Remark || '',
    })).filter((row) => (
      String(row.transactionType || row.docEntry || row.docNumber || row.extDocNumber || '').trim()
    ))
    : []
);
const findPreferredGstTaxCode = ({ taxCodes = [], gstType = '', currentTaxCode = '' }) => {
  if (!gstType) return null;

  const availableTaxCodes = taxCodes.filter((taxCode) =>
    isGstTaxCode(taxCode.Code) && normalizeState(taxCode.GSTType) === gstType
  );
  if (!availableTaxCodes.length) return null;

  const currentTax = taxCodes.find((taxCode) => String(taxCode.Code || '') === String(currentTaxCode || ''));
  const currentRate = currentTax?.Rate != null ? Number(currentTax.Rate) : null;
  if (currentRate != null && Number.isFinite(currentRate)) {
    const sameRateTaxCode = availableTaxCodes.find((taxCode) => Number(taxCode.Rate) === currentRate);
    if (sameRateTaxCode) return sameRateTaxCode;
  }

  return availableTaxCodes.find((taxCode) => Number(taxCode.Rate) === 18) || availableTaxCodes[0];
};

// â”€â”€â”€ constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEC = { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 };
const TAB_NAMES = ['Contents', 'Logistics', 'Accounting', 'Tax', 'Electronic Documents', 'Attachments'];
const DEFAULT_WAREHOUSE = '';
const GENERAL_SETTINGS = readGeneralSettings();
const hydrateGRPOLine = (line = {}, rowUdfDefinitions = ROW_UDF_DEFINITIONS, items = [], fallbackWarehouse = DEFAULT_WAREHOUSE) => {
  const hydrated = hydrateWorkbookDocumentLine({
    line,
    createLine,
    rowUdfDefinitions,
    normalizeUdfState: createUdfState,
    items,
    fallbackWarehouse,
  });
  const sellerPaymentTermsKey = resolveUdfDefinitionKey(
    GRPO_LINE_UDF_FIELD_MAP.sellerPaymentTermsDuplicate,
    rowUdfDefinitions
  );
  const explicitUdfPrice = getLineUdfValue(line, ['U_PRICE', 'U_Price']);

  return hydrateGRPOLineUdfFields({
    ...hydrated,
    price: explicitUdfPrice === '' ? '' : String(explicitUdfPrice),
    sellerPaymentTermsDuplicate: getFirstLineValue(
      hydrated.sellerPaymentTermsDuplicate,
      hydrated.sellerPaymentTerms,
      sellerPaymentTermsKey ? hydrated.udf?.[sellerPaymentTermsKey] : ''
    ),
  });
};

const createLine = (rowUdfDefinitions = ROW_UDF_DEFINITIONS) => ({
  itemNo: '',
  itemDescription: '',
  hsnCode: '',
  quantity: '',
  uomCode: '',
  uomName: '',
  uomEntry: null,
  unitPrice: '',
  stdDiscount: '',
  taxCode: '',
  countryOfOrigin: '',
  distRule: '',
  loc: '',
  sac: '',
  blanketAgreementNo: '',
  costSheet: '',
  containerType: '',
  packingType: '',
  grossWt: '',
  totalPackage: '',
  binLocationAllocation: '',
  taxCodeRepeat: '',
  price: '',
  sellerBrokerage: '',
  buyerBrokerage: '',
  buyerDelivery: '',
  sellerDelivery: '',
  buyerPaymentTerms: '',
  sellerPaymentTerms: '',
  buyerQuality: '',
  sellerQuality: '',
  buyerPrice: '',
  sellerPrice: '',
  buyerSpecialInstruction: '',
  sellerSpecialInstruction: '',
  sellerBrokerageAmtPer: '',
  sellerBrokeragePercent: '',
  stcode: '',
  sellerItem: '',
  sellerQty: '',
  specialRebate: '',
  commission: '',
  sellerBrokeragePerQty: '',
  fixBrokBuyer: '',
  fixBrockSeller: '',
  sellerPaymentTermsDuplicate: '',
  total: '',
  whse: DEFAULT_WAREHOUSE,
  batchManaged: false,
  batches: [],
  inventoryUOM: '',
  uomFactor: 1,
  openQty: '',
  baseEntry: null,
  baseType: 22,
  baseLine: null,
  taxCodeManuallyOverridden: false,
  udf: createUdfState(rowUdfDefinitions),
});

const INIT_HEADER = {
  vendor: '',
  name: '',
  contactPerson: '',
  salesContractNo: '',
  branch: '',
  warehouse: GENERAL_SETTINGS.grpoWarehouse || DEFAULT_WAREHOUSE,
  docNo: '',
  status: 'Open',
  series: GENERAL_SETTINGS.grpoSeries || '',
  nextNumber: '',
  postingDate: today(),
  deliveryDate: '',
  documentDate: today(),
  contractDate: '',
  branchRegNo: '',
  currencyMode: 'BP',
  currency: '',
  exchangeRate: '',
  shipTo: '',
  shipToCode: '',
  shipToAddress: '',
  buyerLocation: '',
  billTo: '',
  billToCode: '',
  billToAddress: '',
  payTo: '',
  payToCode: '',
  payToAddress: '',
  shippingType: '',
  usePayToForTax: false,
  toOrder: '',
  notifyPartyCode: '',
  notifyPartyName: '',
  notifyPartyAddress: '',
  language: '',
  splitGoodsReceiptPO: false,
  confirmed: undefined,
  journalRemark: '',
  paymentTerms: '',
  paymentMethod: '',
  centralBankInd: '',
  dueDateMonths: '0',
  dueDateDays: '0',
  cashDiscountOffset: '',
  paymentTerms2: '',
  advancePaymentPercent: '',
  advanceAmt: '',
  balancePaymentAgainst: '',
  shipmentWithin: '',
  expiryDate: '',
  advanceDate: '',
  withinDays: '',
  daysFrom: '',
  bpProject: '',
  qrCodeFrom: '',
  cancellationDate: '',
  requiredDate: '',
  indicator: '',
  orderNumber: '',
  taxInformation: '',
  transactionCategory: '',
  formNo: '',
  dutyStatus: 'With Payment of Duty',
  importTax: false,
  supplyCovered: false,
  differentialTaxRate: '100',
  edocFormat: '',
  documentStatus: '',
  totalImportedDocument: '',
  dateReceived: '',
  purchaser: '',
  salesEmployee: '',
  owner: '',
  agentCode: '',
  agentName: '',
  otherInstruction: '',
  discount: '',
  freight: '',
  rounding: false,
  roundingAmount: '',
  tax: '',
  totalPaymentDue: '',
  placeOfSupply: '',
  gstin: '',
  vendorState: '',
  gstType: '',
  allowGstOverride: false,
};

const INIT_ATTACH = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1,
  targetPath: '',
  fileName: '',
  attachmentDate: '',
  freeText: '',
  copyToTargetDocument: '',
  documentType: '',
  atchDocDate: '',
  alert: '',
}));

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function GoodsReceiptPO() {
  const [seriesRevision, setSeriesRevision] = useState(0);

  const { company } = useAuth();
  const activeCompanyId = company?.companyId || '';
  const location = useLocation();
  const navigate = useNavigate();
  const { removeTask, upsertTask } = useSapWindowTaskbarActions();
  const formRef = useRef(null);

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(INIT_HEADER);
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState(HEADER_UDF_DEFINITIONS);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState(ROW_UDF_DEFINITIONS);
  const [matrixColumnDefinitions, setMatrixColumnDefinitions] = useState(BASE_MATRIX_COLUMNS);
  const [lines, setLines] = useState([createLine(ROW_UDF_DEFINITIONS)]);
  const [attachments] = useState(INIT_ATTACH);
  const [activeTab, setActiveTab] = useState('Contents');
  const [referenceDocumentsModal, setReferenceDocumentsModal] = useState(false);
  const [referenceDocuments, setReferenceDocuments] = useState([]);
  const [referenceDocumentsChanged, setReferenceDocumentsChanged] = useState(false);
  const [headerUdfs, setHeaderUdfs] = useState(() => createUdfState(HEADER_UDF_DEFINITIONS));
  const [formSettings, setFormSettings, formSettingsStorageKey, replaceFormSettings,
    formSettingsStatus, effectiveMatrixColumnDefinitions] = useStandardSalesFormSettings({
    formKey: FORM_SETTINGS_STORAGE_KEY,
    readSavedFormSettings,
    headerUdfDefinitions,
    rowUdfDefinitions,
    matrixColumnDefinitions,
    companyId: activeCompanyId,
    companyDb: company?.dbName || '',
    includeLineNumber: false,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [formSettingsOpen, setFormSettingsOpen] = useState(false);
  const [refData, setRefData] = useState({
    company: '',
    company_state: '',
    local_currency: '',
    system_currency: '',
    currencies: [],
    rounding_settings: { method: '', currencies: [] },
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
    payment_terms: [],
    shipping_types: [],
    branches: [],
    uom_groups: [],
    decimal_settings: DEC,
    warnings: [],
    series: [],
    states: [],
    udf_metadata: { header: [], rows: [] },
  });
  const [pageState, setPageState] = useState({
    loading: false,
    vendorLoading: false,
    posting: false,
    seriesLoading: false,
    error: '',
    success: '',
  });
  const [referenceDataLoaded, setReferenceDataLoaded] = useState(false);
  const [valErrors, setValErrors] = useState({
    header: {},
    lines: {},
    form: '',
  });
  useValidationHighlights(valErrors);
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [addressModal, setAddressModal] = useState(null);
  const [taxInfoModal, setTaxInfoModal] = useState(false);
  const [copyFromModal, setCopyFromModal] = useState(false);
  const [pendingCopyFrom, setPendingCopyFrom] = useState(null);
  const [batchModal, setBatchModal] = useState({ open: false, lineIndex: null, availableBatches: [], loading: false, error: '' });
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, items: [], loading: false });
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
  const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1 });
  const [bpModal, setBpModal] = useState(false);
  const [addressForm, setAddressForm] = useState({
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
    const handleClickOutside = (event) => {
      if (!event.target.closest('.po-dropdown')) {
        document.querySelectorAll('.po-dropdown').forEach((dropdown) => dropdown.classList.remove('active'));
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // decimal config
  const dec = { ...DEC, ...(refData.decimal_settings || {}) };
  const numDec = {
    quantity: Number(dec.QtyDec),
    unitPrice: Number(dec.PriceDec),
    stdDiscount: Number(dec.PercentDec),
    total: Number(dec.SumDec),
    discount: Number(dec.PercentDec),
    freight: Number(dec.SumDec),
    tax: Number(dec.SumDec),
    totalPaymentDue: Number(dec.SumDec),
    advancePaymentPercent: Number(dec.PercentDec),
    advanceAmt: Number(dec.SumDec),
    withinDays: 0,
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
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
  const hasOpenCopyQuantity = Boolean(currentDocEntry) && lines.some((line = {}) => {
    const rawOpenQty = line.openQty ?? line.OpenQty ?? line.OpenQuantity;
    if (rawOpenQty !== undefined && rawOpenQty !== null && String(rawOpenQty).trim() !== '') {
      return parseNum(rawOpenQty) > 0;
    }

    const lineStatus = String(line.lineStatus ?? line.LineStatus ?? '').trim().toUpperCase();
    if (lineStatus && !['O', 'OPEN'].includes(lineStatus)) return false;

    return parseNum(line.quantity ?? line.Quantity) > 0;
  });
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
    const draft = location.state?.grpoDraft;
    if (!draft) return;

    setCurrentDocEntry(draft.currentDocEntry || null);
    setHeader(draft.header || INIT_HEADER);
    setLines(Array.isArray(draft.lines) && draft.lines.length ? draft.lines : [createLine(ROW_UDF_DEFINITIONS)]);
    setHeaderUdfs(draft.headerUdfs || createUdfState(HEADER_UDF_DEFINITIONS));
    setActiveTab(draft.activeTab || 'Contents');
    setIsDirty(Boolean(draft.isDirty));
    setReferenceDocuments(normalizeGRPOReferenceDocuments(draft.referenceDocuments));
    setReferenceDocumentsChanged(Boolean(draft.referenceDocumentsChanged));
    // Reference Information is transient UI and must not reopen when a
    // minimized document window is restored.
    setReferenceDocumentsModal(false);
    if (Array.isArray(draft.freightCharges)) {
      setFreightModal((prev) => ({
        ...prev,
        freightCharges: draft.freightCharges,
        loading: false,
      }));
    }
    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
  }, [location.state, navigate, location.pathname]);

  const buildLinkedRestoreState = useCallback((overrides = {}) => ({
    grpoDraft: {
      currentDocEntry,
      header,
      lines,
      headerUdfs,
      activeTab,
      isDirty,
      freightCharges: freightModal.freightCharges,
      referenceDocuments: Array.isArray(overrides.referenceDocuments) ? overrides.referenceDocuments : referenceDocuments,
      referenceDocumentsChanged: overrides.referenceDocumentsChanged ?? referenceDocumentsChanged,
      referenceDocumentsModalOpen: false,
    },
  }), [activeTab, currentDocEntry, freightModal.freightCharges, header, headerUdfs, isDirty, lines, referenceDocuments, referenceDocumentsChanged, referenceDocumentsModal]);

  useDocumentDraftTask({
    buildDraftState: buildLinkedRestoreState,
    title: 'Goods Receipt PO',
  });

  const openBusinessPartnerLink = useCallback(() => {
    openLinkedBusinessPartner({
      cardCode: header.vendor,
      sourcePath: location.pathname,
      sourceTitle: `Goods Receipt PO${header.docNo || currentDocEntry ? ` #${header.docNo || currentDocEntry}` : ''}`,
      sourceRestoreState: buildLinkedRestoreState(),
      navigate,
      upsertTask,
    });
  }, [buildLinkedRestoreState, currentDocEntry, header.docNo, header.vendor, location.pathname, navigate, upsertTask]);

  const resolveReferenceDocEntry = useCallback(async (row) => {
    const savedDocEntry = String(row?.docEntry || '').trim();
    if (savedDocEntry) return savedDocEntry;

    const docNumber = String(row?.docNumber || '').trim();
    const transactionType = String(row?.transactionType || '').trim();
    if (!docNumber || !transactionType) return '';

    const response = await fetchSalesOrderReferenceDocumentLookup({
      transactionType,
      query: docNumber,
      top: 20,
    });
    const options = response.data?.options || [];
    const exactMatch = options.find((option) => String(option.docNumber || '').trim() === docNumber);
    return String((exactMatch || options[0])?.docEntry || '').trim();
  }, []);

  const openReferenceDocumentLink = useCallback(async (row, options = {}) => {
    try {
      const docEntry = await resolveReferenceDocEntry(row);
      if (!docEntry) {
        setPageState((prev) => ({
          ...prev,
          success: '',
          error: 'Referenced document was not found. Choose a document from the lookup first.',
        }));
        return false;
      }

      const opened = openLinkedReferenceDocument({
        transactionType: row?.transactionType,
        docEntry,
        docNumber: row?.docNumber,
        sourcePath: location.pathname,
        sourceTitle: `Goods Receipt PO${header.docNo || currentDocEntry ? ` #${header.docNo || currentDocEntry}` : ''}`,
        sourceRestoreState: buildLinkedRestoreState({
          referenceDocuments: options.referenceDocuments || referenceDocuments,
          referenceDocumentsChanged: options.referenceDocumentsChanged ?? referenceDocumentsChanged,
          referenceDocumentsModalOpen: false,
        }),
        navigate,
        upsertTask,
      });
      if (!opened) {
        setPageState((prev) => ({
          ...prev,
          success: '',
          error: 'This referenced document type is not configured for navigation.',
        }));
      }
      return opened;
    } catch (error) {
      setPageState((prev) => ({
        ...prev,
        success: '',
        error: getErrMsg(error, 'Failed to open referenced document.'),
      }));
      return false;
    }
  }, [buildLinkedRestoreState, currentDocEntry, header.docNo, location.pathname, navigate, referenceDocuments, referenceDocumentsChanged, referenceDocumentsModal, resolveReferenceDocEntry, upsertTask]);

  useEffect(() => {
    if (!snapshotPending || !currentDocEntry || pageState.loading || pageState.vendorLoading) return;
    setSnapshotPending(false);
  }, [snapshotPending, currentDocEntry, pageState.loading, pageState.vendorLoading, header, lines, headerUdfs]);

  const markDirty = useCallback((event) => {
    if (event?.target?.closest?.('[data-document-dirty-ignore="true"]')) return;
    if (currentDocEntry) setIsDirty(true);
  }, [currentDocEntry]);

  // â”€â”€ load reference data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setReferenceDataLoaded(false);
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        setHeaderUdfDefinitions([]);
        setRowUdfDefinitions([]);
        setMatrixColumnDefinitions([]);
        // Loading schema/settings must preserve loaded, copied and draft lines.
        if (!activeCompanyId) {
          setHeaderUdfs({});
          setLines([createLine([])]);
          return;
        }
        const [refDataRes, seriesRes, layoutRes, schema] = await Promise.all([
          fetchGRPOReferenceData(activeCompanyId),
          fetchDocumentSeries(today()),
          getDocumentLayout({ documentType: 'GRPO', companyDb: company?.dbName }).catch((error) => ({
            data: {
              success: false,
              columns: [],
              warning: getErrMsg(error, 'Failed to load SAP layout.'),
            },
          })),
          fetchSalesDocumentSchema({ documentType: 'GRPO' }).catch(() => null),
        ]);

        if (!ignore) {
          const liveMatrixColumns = refDataRes.data.line_field_metadata?.matrix_columns?.length
            ? refDataRes.data.line_field_metadata.matrix_columns
            : BASE_MATRIX_COLUMNS;
          const liveFields = buildSalesDocumentLiveFields({
            schema,
            documentType: 'GRPO',
            objectType: '20',
            headerTable: 'OPDN',
            lineTable: 'PDN1',
            companyId: activeCompanyId,
            companyDb: company?.dbName || '',
            layoutResponse: layoutRes,
            referenceMatrixColumns: liveMatrixColumns,
            referenceSapForm: refDataRes.data.line_field_metadata?.sap_form || {},
            includeLineNumber: false,
            safeFallbackMatrixColumns: BASE_MATRIX_COLUMNS,
            useSafeFallbackWithoutLayout: true,
          });
          const nextHeaderUdfs = liveFields.liveAvailable
            ? liveFields.headerUdfFields
            : (refDataRes.data.udf_metadata?.header || []);
          const nextRowUdfs = liveFields.liveAvailable
            ? liveFields.rowUdfFields
            : (refDataRes.data.udf_metadata?.rows || []);
          const nextMatrixColumns = liveFields.matrixColumns?.length
            ? liveFields.matrixColumns
            : BASE_MATRIX_COLUMNS;
          setHeaderUdfDefinitions(nextHeaderUdfs);
          setRowUdfDefinitions(nextRowUdfs);
          setMatrixColumnDefinitions(nextMatrixColumns);
          setHeaderUdfs((prev) => createUdfState(nextHeaderUdfs, prev));
          setLines((prev) => prev.map((line) => ({
            ...hydrateGRPOLine(line, nextRowUdfs, refData.items, line.whse || header.warehouse || ''),
            udf: createUdfState(nextRowUdfs, line.udf || {}),
          })));
          const nextDefaults = readSavedFormSettings(nextHeaderUdfs, nextRowUdfs, nextMatrixColumns, formSettingsStorageKey);
          replaceFormSettings(nextDefaults);

          setRefData({
            company: refDataRes.data.company || '',
            company_state: refDataRes.data.company_state || '',
            local_currency: refDataRes.data.local_currency || '',
            system_currency: refDataRes.data.system_currency || '',
            currencies: refDataRes.data.currencies || [],
            rounding_settings: refDataRes.data.rounding_settings || { method: '', currencies: [] },
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
            payment_terms: refDataRes.data.payment_terms || [],
            shipping_types: refDataRes.data.shipping_types || [],
            sales_employees: refDataRes.data.sales_employees || [],
            branches: refDataRes.data.branches || [],
            states: refDataRes.data.states || [],
            uom_groups: refDataRes.data.uom_groups || [],
            decimal_settings: { ...DEC, ...(refDataRes.data.decimal_settings || {}) },
            udf_metadata: refDataRes.data.udf_metadata || { header: [], rows: [] },
            line_field_metadata: {
              ...(refDataRes.data.line_field_metadata || { sap_form: {} }),
              matrix_columns: nextMatrixColumns,
              imported_layout: layoutRes?.data || null,
            },
            warnings: [
              ...(refDataRes.data.warnings || []),
              ...(layoutRes?.data?.warning ? [layoutRes.data.warning] : []),
            ],
            series: seriesRes.data.series || [],
          });

          if (seriesRes.data.series && seriesRes.data.series.length > 0 && !currentDocEntry && !String(header.series || '').trim()) {
            const defaultSeries = getDefaultSeriesForCurrentYear(seriesRes.data.series);
            if (defaultSeries?.Series != null) {
              handleSeriesChange(defaultSeries.Series);
            }
          }
        }
        console.log("FULL REF DATA:", refDataRes.data);
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load reference data.') }));
      } finally {
        if (!ignore) {
          setReferenceDataLoaded(true);
          setPageState(p => ({ ...p, loading: false }));
        }
      }
    };
    load();
    return () => { ignore = true; };
  }, [activeCompanyId, company?.dbName, formSettingsStorageKey]);

  // â”€â”€ load existing order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const docEntry = location.state?.grpoDocEntry;
    if (!docEntry) return;
    let ignore = false;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        const r = await fetchGRPOByDocEntry(docEntry);
        const grpo = r.data.grpo;
        if (ignore || !grpo) return;
        setCurrentDocEntry(grpo.doc_entry || Number(docEntry));
        const firstLineWarehouse = Array.isArray(grpo.lines)
          ? grpo.lines.find((line) => String(line?.whse || '').trim())?.whse
          : '';
        setHeader(prev => ({
          ...prev,
          ...INIT_HEADER,
          ...(grpo.header || {}),
          currencyMode: grpo.header?.currencyMode || INIT_HEADER.currencyMode,
          currency: grpo.header?.currency || INIT_HEADER.currency,
          warehouse: grpo.header?.warehouse || firstLineWarehouse || '',
          nextNumber: grpo.header?.docNo || grpo.doc_num || grpo.header?.nextNumber || '',
        }));

        setLines(
          Array.isArray(grpo.lines) && grpo.lines.length
            ? grpo.lines.map(l => ({ ...hydrateGRPOLine(l, rowUdfDefinitions, refData.items, header.warehouse || ''), taxCodeManuallyOverridden: true }))
            : [createLine(rowUdfDefinitions)]
        );
        setHeaderUdfs({ ...createUdfState(headerUdfDefinitions), ...(grpo.header_udfs || {}) });
        setReferenceDocuments(normalizeGRPOReferenceDocuments(grpo.reference_documents || grpo.referenceDocuments));
        setReferenceDocumentsChanged(false);
        setSnapshotPending(true);
        setIsDirty(false);
        if (grpo.header?.vendor) {
          loadVendorDetails(grpo.header.vendor);
        }
        setPageState(p => ({ ...p, success: grpo.doc_num ? `Goods Receipt PO ${grpo.doc_num} loaded.` : 'Goods Receipt PO loaded.' }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load Goods Receipt PO.') }));
      } finally {
        if (!ignore) {
          setPageState(p => ({ ...p, loading: false }));
          replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
        }
      }
    };
    load();
    return () => { ignore = true; };
  }, [location.pathname, location.state, navigate, headerUdfDefinitions, rowUdfDefinitions]);

  useEffect(() => {
    const routedCopyFrom = location.state?.copyFrom;
    const persistedCopyState = routedCopyFrom ? null : consumeCopyToState(location.pathname, ['/grpo']);
    const copyFrom = routedCopyFrom || persistedCopyState?.copyFrom;
    if (copyFrom) setPendingCopyFrom(copyFrom);
  }, [location.pathname, location.state]);

  useEffect(() => {
    if (!pendingCopyFrom || !referenceDataLoaded) return;

    let ignore = false;
    const loadCopiedPurchaseOrder = async () => {
      setPageState((prev) => ({ ...prev, loading: true, error: '', success: '' }));
      try {
        let copyData = pendingCopyFrom;
        const sourceType = String(copyData.type || '').toLowerCase();
        const sourceDocEntry = copyData.docEntry || copyData.baseDocument?.baseEntry;

        if (sourceType === 'purchaseorder' && sourceDocEntry) {
          try {
            const response = await fetchPurchaseOrderForCopy(sourceDocEntry);
            copyData = {
              ...copyData,
              header: response.data?.header || copyData.header || {},
              lines: response.data?.lines || copyData.lines || [],
              headerUdfs: response.data?.header_udfs || copyData.headerUdfs || {},
              baseDocument: copyData.baseDocument || { baseEntry: sourceDocEntry, baseType: 22 },
            };
          } catch (_error) {
            copyData = pendingCopyFrom;
          }
        }

        if (ignore) return;

        const { header: sourceHeader = {}, lines: sourceLines = [], baseDocument } = copyData;
        const copiedLines = Array.isArray(sourceLines) && sourceLines.length
          ? sourceLines.map((line, index) => hydrateGRPOLine(
            {
              ...line,
              quantity: String(line.quantity || line.Quantity || line.OpenQty || 0),
              stdDiscount: String(line.stdDiscount || line.DiscountPercent || line.DiscPrcnt || line.discount || 0),
              baseEntry: line.baseEntry ?? line.BaseEntry ?? baseDocument?.baseEntry ?? sourceDocEntry,
              baseType: line.baseType ?? line.BaseType ?? baseDocument?.baseType ?? 22,
              baseLine: line.baseLine ?? line.BaseLine ?? line.lineNum ?? line.LineNum ?? index,
              branch: line.branch || sourceHeader.branch || '',
            },
            rowUdfDefinitions,
            refData.items,
            ''
          ))
          : [createLine(rowUdfDefinitions)];
        const firstLineWarehouse = copiedLines.find((line) => String(line?.whse || '').trim())?.whse || '';

        setHeader((prev) => ({
          ...prev,
          vendor: sourceHeader.vendor || sourceHeader.CardCode || '',
          name: sourceHeader.name || sourceHeader.CardName || '',
          contactPerson: sourceHeader.contactPerson || sourceHeader.CntctCode || '',
          salesContractNo: sourceHeader.salesContractNo || sourceHeader.VendorRefNo || sourceHeader.NumAtCard || '',
          branch: sourceHeader.branch || sourceHeader.BPL_IDAssignedToInvoice || '',
          paymentTerms: sourceHeader.paymentTerms || sourceHeader.GroupNum || '',
          currencyMode: sourceHeader.currencyMode || prev.currencyMode || INIT_HEADER.currencyMode,
          currency: sourceHeader.currency || sourceHeader.DocCur || prev.currency || INIT_HEADER.currency,
          shipToCode: sourceHeader.shipToCode || sourceHeader.ShipToCode || '',
          shipTo: sourceHeader.shipTo || sourceHeader.shipToAddress || sourceHeader.ShipToAddress || '',
          shipToAddress: sourceHeader.shipToAddress || sourceHeader.ShipToAddress || sourceHeader.shipTo || '',
          buyerLocation: sourceHeader.buyerLocation || sourceHeader.U_ShipLocation || '',
          warehouse: sourceHeader.warehouse || firstLineWarehouse || prev.warehouse || '',
          placeOfSupply: sourceHeader.placeOfSupply || prev.placeOfSupply || '',
          otherInstruction: sourceHeader.otherInstruction || sourceHeader.Comments || '',
          rounding: sourceHeader.rounding ?? normaliseDocumentHeader(sourceHeader).rounding ?? false,
          roundingAmount: sourceHeader.roundingAmount || sourceHeader.RoundingAmount || sourceHeader.RoundDif || '',
        }));
        setLines(copiedLines);
        setHeaderUdfs((prev) => ({ ...prev, ...(copyData.headerUdfs || {}) }));
        setValErrors({ header: {}, lines: {}, form: '' });
        setFreightModal({ open: false, freightCharges: Array.isArray(copyData.freightCharges) ? copyData.freightCharges : [], loading: false });

        const vendorCode = sourceHeader.vendor || sourceHeader.CardCode;
        if (vendorCode) loadVendorDetails(vendorCode);

        setPendingCopyFrom(null);
        setPageState((prev) => ({ ...prev, loading: false, error: '', success: 'Copied from Purchase Order. Please review and save.' }));
        replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
      } catch (error) {
        if (!ignore) {
          setPendingCopyFrom(null);
          setPageState((prev) => ({ ...prev, loading: false, error: getErrMsg(error, 'Failed to copy from Purchase Order.'), success: '' }));
        }
      }
    };

    loadCopiedPurchaseOrder();
    return () => { ignore = true; };
  }, [pendingCopyFrom, referenceDataLoaded, rowUdfDefinitions, refData.items, location.pathname, navigate]);

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
  const vendorContacts = refData.contacts.filter(c => String(c.CardCode || '') === String(header.vendor || ''));
  const contactOptions = header.contactPerson && !vendorContacts.some(c => String(c.CntctCode || '') === String(header.contactPerson || ''))
    ? [{ CardCode: header.vendor, CntctCode: header.contactPerson, Name: header.contactPerson }, ...vendorContacts]
    : vendorContacts;
  const vendorPayToAddresses = refData.pay_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorShipToAddresses = refData.ship_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorEffectiveShipToAddresses = vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses;
  const selectedWarehouse = refData.warehouses.find(w => String(w.WhsCode || '') === String(header.warehouse || ''));
  const getCurrencyForMode = useCallback((mode, vendorCode = header.vendor) => {
    const selectedMode = mode || INIT_HEADER.currencyMode;
    const vendor = refData.vendors.find(v => String(v.CardCode || '') === String(vendorCode || ''));
    const bpCurrency = String(vendor?.Currency || '').trim();
    const localCurrency = String(refData.local_currency || INIT_HEADER.currency).trim();
    const systemCurrency = String(refData.system_currency || localCurrency || INIT_HEADER.currency).trim();

    if (selectedMode === 'local') return localCurrency || INIT_HEADER.currency;
    if (selectedMode === 'system') return systemCurrency || localCurrency || INIT_HEADER.currency;
    if (bpCurrency && bpCurrency !== '##') return bpCurrency;
    return localCurrency || INIT_HEADER.currency;
  }, [header.vendor, refData.local_currency, refData.system_currency, refData.vendors]);

  const getBuyerBillToAddress = useCallback(() => {
    if (selectedWarehouse) {
      const formattedWarehouseAddress = fmtAddr(selectedWarehouse);
      if (formattedWarehouseAddress) {
        return {
          code: selectedWarehouse.WhsCode || '',
          address: formattedWarehouseAddress,
          source: selectedWarehouse,
        };
      }
    }

    const companyAddress = refData.company_address || {};
    const formattedCompanyAddress = fmtAddr(companyAddress) || companyAddress.Address || '';
    return {
      code: companyAddress.AddressName || companyAddress.Address || '',
      address: formattedCompanyAddress,
      source: companyAddress,
    };
  }, [refData.company_address, selectedWarehouse]);

  const payTermOpts = refData.payment_terms.length
    ? refData.payment_terms.map(t => ({ value: String(t.GroupNum), label: t.PymntGroup }))
    : [{ value: 'Net 30', label: 'Net 30' }, { value: 'Net 60', label: 'Net 60' }];

  const shipTypeOpts = refData.shipping_types.length
    ? refData.shipping_types.map(s => ({ value: String(s.TrnspCode), label: s.TrnspName }))
    : [{ value: 'Air', label: 'Air' }, { value: 'Sea', label: 'Sea' }, { value: 'Road', label: 'Road' }];

  const lineItemOptions = lines.reduce((acc, line, i) => {
    const code = String(line.itemNo || '').trim();
    const exists = refData.items.some(it => String(it.ItemCode || '') === code);
    acc[i] = code && !exists ? [{ ItemCode: code, ItemName: line.itemDescription || code }, ...refData.items] : refData.items;
    return acc;
  }, {});

  const getUomOptions = useCallback((line) => {
    const item = refData.items.find(i => String(i.ItemCode || '') === String(line.itemNo || ''));
    return getLineUomOptions(line, item, refData.uom_groups).map((uom) => uom.uomCode);
  }, [refData.items, refData.uom_groups]);

  const uomOptions = lines.reduce((acc, line, i) => {
    acc[i] = getUomOptions(line);
    return acc;
  }, {});
  const effectiveTaxCodes = refData.tax_codes || [];
  const effectiveWarehouses = refData.warehouses.length ? refData.warehouses : [];
  const branchFilteredWarehouses = effectiveWarehouses;
  const freightTotals = summarizeFreightRows(freightModal.freightCharges, effectiveTaxCodes);

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

  const derivedGstType = getDerivedGstType(header.vendorState, header.placeOfSupply);
  const inferredGstType = formatDerivedGstType(derivedGstType);
  const getPreferredLineTaxCode = useCallback((currentTaxCode = '') => {
    if (!derivedGstType) return '';

    const vendor = refData.vendors.find(v => String(v.CardCode || '') === String(header.vendor || ''));
    const preferredTaxCode = findPreferredGstTaxCode({
      taxCodes: effectiveTaxCodes,
      gstType: derivedGstType,
      currentTaxCode: currentTaxCode || vendor?.VatGroup || '',
    });

    return preferredTaxCode?.Code || '';
  }, [derivedGstType, effectiveTaxCodes, header.vendor, refData.vendors]);

  // â”€â”€ calculations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const calcLineTotal = (line, { preferStored = false } = {}) => {
    if (preferStored && line.total !== undefined && line.total !== null && String(line.total).trim() !== '') {
      return roundTo(parseNum(line.total), numDec.total);
    }
    const qty = parseNum(line.quantity), price = parseNum(line.unitPrice), disc = parseNum(line.stdDiscount);
    return roundTo(qty * price * (1 - disc / 100), numDec.total);
  };

  const calcTotals = () => {
    const taxRateMap = new Map(effectiveTaxCodes.map(t => [String(t.Code || ''), parseNum(t.Rate)]));
    const subtotal = lines.reduce((s, l) => s + calcLineTotal(l, { preferStored: true }), 0);
    const discPct = parseNum(header.discount);
    const discAmt = roundTo(subtotal * discPct / 100, numDec.total);
    const discSub = Math.max(0, subtotal - discAmt);
    const freight = roundTo(parseNum(header.freight), numDec.total);
    const freightTaxAmt = roundTo(parseNum(freightTotals.totalTax), numDec.tax);
    let taxAmt = 0;
    const taxMap = new Map();
    if (subtotal > 0) {
      lines.forEach(l => {
        const net = calcLineTotal(l, { preferStored: true });
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
    const rounding = calculateDocumentRounding(
      discSub + freight + taxAmt,
      header.rounding,
      numDec.totalPaymentDue, (currentDocEntry || header.roundingAmountIsManual) ? header : null, getDocumentRoundingPolicy(refData, header));
    return { subtotal, discAmt, discSub, freight, freightTaxAmt, taxAmt, ...rounding, taxBreakdown: Array.from(taxMap.values()) };
  };

  const totals = calcTotals();
  useRelationshipMapRegistration({
    enabled: Boolean(currentDocEntry),
    objectType: 20,
    docEntry: currentDocEntry,
    header,
    total: totals.total,
  });
  const totalsForDisplay = currentDocEntry && !isDirty
    ? {
      ...totals,
      taxAmt: header.tax !== '' ? parseNum(header.tax) : totals.taxAmt,
      roundingAmount: header.roundingAmount !== '' ? parseNum(header.roundingAmount) : totals.roundingAmount,
      total: header.totalPaymentDue !== '' ? parseNum(header.totalPaymentDue) : totals.total,
    }
    : totals;

  // â”€â”€ GST Logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const applyGstLogic = useCallback(() => {
    if (!derivedGstType) return;

    setLines(prevLines => prevLines.map(line => {
      if (!line.itemNo || line.taxCodeManuallyOverridden) {
        return line;
      }

      const defaultTax = findPreferredGstTaxCode({
        taxCodes: effectiveTaxCodes,
        gstType: derivedGstType,
        currentTaxCode: line.taxCode,
      });
      if (!defaultTax?.Code || String(line.taxCode || '') === String(defaultTax.Code)) {
        return line;
      }

      return { ...line, taxCode: defaultTax.Code };
    }));
  }, [derivedGstType, effectiveTaxCodes]);

  // Trigger GST logic when vendor GST context changes
  useEffect(() => {
    if (header.vendorState || header.placeOfSupply) {
      applyGstLogic();
    }
  }, [header.vendorState, header.placeOfSupply, applyGstLogic]);

  useEffect(() => {
    setHeader(prev => prev.gstType === inferredGstType ? prev : { ...prev, gstType: inferredGstType });
  }, [inferredGstType]);

  // â”€â”€ address sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Sync branch to all lines when header branch changes
  useEffect(() => {
    if (header.branch) {
      setLines(prev => prev.map(l => ({ ...l, branch: String(header.branch), loc: String(header.branch) })));
    }
  }, [header.branch]);

  // Header warehouse is a default for blank rows; SAP B1 allows different line warehouses.
  useEffect(() => {
    if (header.warehouse) {
      setLines(prev => prev.map(l => (
        String(l.itemNo || '').trim()
          ? l
          : { ...l, whse: header.warehouse }
      )));
    }
  }, [header.warehouse]);

  useEffect(() => {
    const shouldAutoPopulateAddresses = true;
    if (!shouldAutoPopulateAddresses) return;
    setHeader(prev => {
      const existing = vendorEffectiveShipToAddresses.find(a => String(a.Address || '') === String(prev.shipToCode || ''));
      if (existing) {
        const savedOrAddressState = prev.placeOfSupply || String(existing.State || '').trim();
        return savedOrAddressState === prev.placeOfSupply
          ? prev
          : { ...prev, placeOfSupply: savedOrAddressState };
      }
      const def = vendorEffectiveShipToAddresses[0];
      if (!def) return prev;
      const fmt = fmtAddr(def);
      const nextState = String(def.State || '').trim();
      if (prev.shipToCode === def.Address && prev.shipTo === fmt && prev.placeOfSupply === nextState) return prev;
      return { ...prev, shipToCode: def.Address || '', shipTo: fmt, shipToAddress: fmt, placeOfSupply: nextState };
    });
  }, [header.vendor, vendorEffectiveShipToAddresses]);

  useEffect(() => {
    const buyerBillTo = getBuyerBillToAddress();
    if (!buyerBillTo.address) return;
    setHeader(prev => {
      if (
        prev.billToCode === buyerBillTo.code
        && prev.billTo === buyerBillTo.address
        && prev.billToAddress === buyerBillTo.address
      ) return prev;
      return {
        ...prev,
        billToCode: buyerBillTo.code || prev.billToCode || '',
        billTo: buyerBillTo.address,
        billToAddress: buyerBillTo.address,
      };
    });
  }, [getBuyerBillToAddress]);

  useEffect(() => {
    if (!header.vendor) return;
    setHeader(prev => {
      const existing = vendorPayToAddresses.find(a => String(a.Address || '') === String(prev.payToCode || ''));
      if (existing) return prev;
      const def = vendorPayToAddresses[0];
      if (!def) return prev;
      const fmt = fmtAddr(def);
      if (prev.payToCode === def.Address && prev.payTo === fmt) return prev;
      return { ...prev, payToCode: def.Address || '', payTo: fmt, payToAddress: fmt };
    });
  }, [header.vendor, vendorPayToAddresses]);

  // â”€â”€ vendor details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadVendorDetails = async (code) => {
    if (!code) {
      setRefData(p => ({
        ...p,
        contacts: [],
        pay_to_addresses: [],
        ship_to_addresses: [],
        bill_to_addresses: [],
      }));
      setHeader(prev => ({
        ...prev,
        gstin: '',
        vendorState: '',
        gstType: '',
        allowGstOverride: false,
        contactPerson: '',
      }));
      return;
    }

    setPageState(p => ({ ...p, vendorLoading: true }));

    try {
      const r = await fetchGRPOVendorDetails(code);
      const contacts = r.data.contacts || [];
      const payToAddresses = r.data.pay_to_addresses || [];
      const shipToAddresses = r.data.ship_to_addresses || [];
      const billToAddresses = r.data.bill_to_addresses || [];
      const primaryTaxAddress = payToAddresses[0] || billToAddresses[0] || shipToAddresses[0] || contacts[0] || {};
      const gstin = String(r.data.gstin || primaryTaxAddress.GSTIN || primaryTaxAddress.gstin || '').trim();
      const vendorState = String(r.data.vendorState || primaryTaxAddress.State || primaryTaxAddress.state || '').trim();
      setRefData(p => ({
        ...p,
        contacts: contacts,
        pay_to_addresses: payToAddresses,
        ship_to_addresses: shipToAddresses,
        bill_to_addresses: billToAddresses,
      }));
      setHeader(prev => ({
        ...prev,
        gstin,
        vendorState,
        gstType: formatDerivedGstType(getDerivedGstType(vendorState, prev.placeOfSupply)),
        allowGstOverride: false,
        contactPerson: contacts.length > 0 ? contacts[0].CntctCode : '',
      }));
    } catch (err) {
      setRefData(p => ({
        ...p,
        contacts: [],
        pay_to_addresses: [],
        ship_to_addresses: [],
        bill_to_addresses: [],
      }));
      setHeader(prev => ({ ...prev, gstin: '', vendorState: '', gstType: '', allowGstOverride: false, contactPerson: '' }));
    } finally {
      setPageState(p => ({ ...p, vendorLoading: false }));
    }
  };

  const syncVendor = (code, hdr) => {
    const m = refData.vendors.find(v => String(v.CardCode || '') === String(code || ''));
    if (!m) return { nextHeader: hdr };
    return {
      nextHeader: {
        ...hdr,
        name: m.CardName || m.Name || hdr.name,
        currencyMode: hdr.currencyMode || INIT_HEADER.currencyMode,
        currency: getCurrencyForMode(hdr.currencyMode || INIT_HEADER.currencyMode, code),
        paymentTerms: m.GroupNum != null ? String(m.GroupNum) : hdr.paymentTerms,
        contactPerson: '',
        shipTo: '',
        shipToCode: '',
        shipToAddress: '',
        billTo: '',
        billToCode: '',
        billToAddress: '',
        payTo: '',
        payToCode: '',
        payToAddress: '',
        placeOfSupply: '',
      },
      vatGroup: String(m.VatGroup || '').trim(),
    };
  };

  // â”€â”€ handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCurrencyModeChange = (e) => {
    const mode = e.target.value;
    setHeader(prev => ({
      ...prev,
      currencyMode: mode,
      currency: getCurrencyForMode(mode, prev.vendor),
    }));
  };

  const handleHeaderChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValErrors(p => ({ ...p, header: { ...p.header, [name]: '' }, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));

    if (name === 'series') {
      handleSeriesChange(value);
      return;
    }

    if (name === 'currencyMode') {
      handleCurrencyModeChange(e);
      return;
    }

    if (name === 'shipToCode') {
      handleShipToChange(value);
      return;
    }
    if (name === 'payToCode') {
      handlePayToCodeChange(value);
      return;
    }
    if (name === 'shipTo') {
      setHeader(p => ({ ...p, shipTo: value, shipToAddress: value }));
      return;
    }
    if (name === 'payTo') {
      setHeader(p => ({ ...p, payTo: value, payToAddress: value }));
      return;
    }
    if (name === 'billTo') {
      setHeader(p => ({ ...p, billTo: value, billToAddress: value }));
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
    setHeader(p => ({
      ...p,
      [name]: type === 'checkbox' ? checked : value,
      ...(['currency', 'postingDate'].includes(name) ? { exchangeRate: '' } : {}),
    }));
  };

  const handleShipToCodeChange = (e) => {
    const selectedCode = e.target.value;
    const selectedAddress = vendorEffectiveShipToAddresses.find(a => String(a.Address || '') === selectedCode);

    setHeader(prev => ({
      ...prev,
      shipToCode: selectedCode,
      shipTo: fmtAddr(selectedAddress),
      shipToAddress: fmtAddr(selectedAddress),
      placeOfSupply: String(selectedAddress?.State || '').trim(),
    }));
  };

  const handlePayToCodeChange = (selectedCode) => {
    const selectedAddress = vendorPayToAddresses.find(a => String(a.Address || '') === String(selectedCode || ''));
    const formattedAddress = selectedAddress ? fmtAddr(selectedAddress) : '';

    setHeader(prev => ({
      ...prev,
      payToCode: selectedCode,
      payTo: formattedAddress,
      payToAddress: formattedAddress,
    }));
  };

  const handleLineChange = (i, e) => {
    const { name, value } = e.target;
    setValErrors(p => ({ ...p, lines: { ...p.lines, [i]: { ...(p.lines[i] || {}), [name]: '' } }, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));
    setLines(prev => prev.map((line, idx) => {
      if (idx !== i) return line;
      const nextValue = numDec[name] !== undefined ? sanitize(value, numDec[name]) : value;
      const next = synchronizeGRPOLineFieldChange(line, name, nextValue, rowUdfDefinitions);
      if (name === 'uomName') next.uomNameEdited = true;

      if (name === 'taxCode') {
        next.taxCodeManuallyOverridden = true;
      }
      if (name === 'sellerPaymentTerms') {
        next.sellerPaymentTermsDuplicate = value;
      }
      if (name === 'sellerPaymentTermsDuplicate') {
        next.sellerPaymentTerms = value;
      }

      if (name === 'itemNo') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));
        next.batches = [];
        next.batchManaged = isBatchManaged(item);
        if (item) {
          const itemPrice = getItemPrice(item, 'purchase');
          next.itemDescription = item.ItemName || next.itemDescription;
          next.hsnCode = item.HSNCode || next.hsnCode || '';
          Object.assign(next, getItemPurchaseUom(item, refData.uom_groups));
          if (!next.unitPrice && itemPrice) {
            next.unitPrice = itemPrice;
          }
          next.inventoryUOM = String(item.InventoryUOM || '').trim();
          next.uomFactor = getLineUomFactor({
            uomCode: next.uomCode,
          });

          // Auto-assign default warehouse
          if (item.DefaultWarehouse) {
            next.whse = item.DefaultWarehouse;
          }

          if (!next.taxCodeManuallyOverridden) {
            const preferredTaxCode = getPreferredLineTaxCode(next.taxCode);
            if (preferredTaxCode) {
              next.taxCode = preferredTaxCode;
            }
          }
        }

      }
      if (name === 'uomCode') {
        next.batches = [];
        const item = refData.items.find(it => String(it.ItemCode || '') === String(next.itemNo || ''));
        Object.assign(next, applyUomCodeSelection(next, value, getLineUomOptions(next, item, refData.uom_groups)));
      }
      if (name === 'whse') {
        next.batches = [];
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
        const next = hydrateGRPOLine(pastedLine, rowUdfDefinitions, refData.items, header.warehouse);
        if (pastedKeys.has('itemNo')) {
          const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
          next.batches = [];
          next.batchManaged = isBatchManaged(item);
          if (item) {
            const itemPrice = getItemPrice(item, 'purchase');
            if (!next.unitPrice && itemPrice) next.unitPrice = itemPrice;
            if (!pastedKeys.has('whse') && item.DefaultWarehouse) next.whse = item.DefaultWarehouse;
            if (!next.taxCodeManuallyOverridden) next.taxCode = getPreferredLineTaxCode(next.taxCode) || next.taxCode;
          }
        }
        if (pastedKeys.has('uomCode')) {
          const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
          next.batches = [];
          Object.assign(next, applyUomCodeSelection(next, next.uomCode, getLineUomOptions(next, item, refData.uom_groups)));
        }
        if (pastedKeys.has('whse')) next.batches = [];
        if (pastedKeys.has('taxCode')) next.taxCodeManuallyOverridden = true;
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

  const openFreightModal = async () => {
    if (freightModal.freightCharges.length > 0) {
      setFreightModal(prev => ({ ...prev, open: true, loading: false }));
      return;
    }
    setFreightModal(prev => ({ ...prev, open: true, loading: true }));
    try {
      const response = await fetchFreightCharges(currentDocEntry);
      setFreightModal({
        open: true,
        freightCharges: response.data.freightCharges || [],
        loading: false,
      });
    } catch (_error) {
      setFreightModal({
        open: true,
        freightCharges: [],
        loading: false,
      });
    }
  };

  const closeFreightModal = () => {
    setFreightModal(prev => ({ ...prev, open: false, loading: false }));
  };

  const handleFreightApply = (summary) => {
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
    markDirty();
    setValErrors(p => ({ ...p, form: '' }));
    setLines(p => [...p, { ...createLine(rowUdfDefinitions), whse: header.warehouse || '', branch: header.branch || '', loc: header.branch || '' }]);
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
    setLines(p => p.map((l, idx) => (
      idx === i ? synchronizeGRPOLineUdfChange(l, k, v, rowUdfDefinitions) : l
    )));
  };
  const updateFormSetting = (g, k, prop, val) => setFormSettings(p => ({ ...p, [g]: { ...p[g], [k]: { ...p[g][k], [prop]: val } } }));
  const toggleHeaderUdfs = () => {
    setFormSettingsOpen(false);
    setSidebarOpen(p => !p);
  };
  const toggleFormSettings = () => {
    setSidebarOpen(false);
    setFormSettingsOpen(p => !p);
  };

  // â”€â”€ Series and Auto-Numbering handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleSeriesChange = (seriesValue) => {
      const manual = ['-1', 'manual', '__sap_manual__'].includes(String(seriesValue).toLowerCase());
      if (manual && !canUseManualSeries(refData)) return;
      const selected = (refData.series || []).find(row => String(row.Series) === String(seriesValue));
      setHeader(prev => ({ ...prev, series: manual ? '-1' : selected ? String(selected.Series) : '', nextNumber: manual ? '' : String(selected?.NextNumber ?? ''), docNo: '' }));
      setPageState(prev => ({ ...prev, error: '', success: '' }));
    };


  const handleShipToChange = (addressCode) => {
    if (!addressCode) {
      setHeader(p => ({ ...p, shipToCode: addressCode, shipTo: '', shipToAddress: '', placeOfSupply: '' }));
      return;
    }

    const addr = vendorEffectiveShipToAddresses.find(a => String(a.Address || '') === addressCode);
    setHeader(p => ({
      ...p,
      shipToCode: addressCode,
      shipTo: fmtAddr(addr),
      shipToAddress: fmtAddr(addr),
      placeOfSupply: String(addr?.State || '').trim(),
    }));
  };

  // â”€â”€ Address Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const buildAddressObjectFromText = (text = '', source = {}) => {
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    return {
      ...source,
      Street: source.Street || lines[0] || '',
      Building: source.Building || lines[1] || '',
      Block: source.Block || lines[2] || '',
      City: source.City || '',
      ZipCode: source.ZipCode || '',
      State: source.State || '',
      Country: source.Country || 'IN',
      Address2: source.Address2 || lines[3] || '',
      Address3: source.Address3 || lines[4] || '',
    };
  };

  const openAddressModal = (type) => {
    const buyerBillTo = getBuyerBillToAddress();
    const shipAddress = resolveAddressForModal(
      header.shipToCode,
      vendorEffectiveShipToAddresses,
      header.shipToAddress || header.shipTo,
      fmtAddr,
    );
    const payAddress = resolveAddressForModal(
      header.payToCode,
      vendorPayToAddresses,
      header.payToAddress || header.payTo,
      fmtAddr,
    );
    const billAddress = buildAddressObjectFromText(header.billToAddress || header.billTo || buyerBillTo.address, buyerBillTo.source || {});
    const activeAddress = type === 'billTo'
      ? billAddress
      : type === 'payTo'
        ? (payAddress || buildAddressObjectFromText(header.payToAddress || header.payTo))
        : (shipAddress || buildAddressObjectFromText(header.shipToAddress || header.shipTo));

    setAddressForm(mapAddressToModalForm(activeAddress, {
      shipToCode: header.shipToCode || shipAddress?.Address || '',
      shipToAddress: header.shipToAddress || header.shipTo || (shipAddress ? fmtAddr(shipAddress) : ''),
      billToCode: header.billToCode || buyerBillTo.code || '',
      billToAddress: header.billToAddress || header.billTo || buyerBillTo.address || '',
    }));
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
      setHeader(p => ({ ...p, shipTo: formatted, shipToAddress: formatted }));
    } else if (addressModal.type === 'billTo') {
      setHeader(p => ({ ...p, billTo: formatted, billToAddress: formatted }));
    } else {
      setHeader(p => ({ ...p, payTo: formatted, payToAddress: formatted }));
    }
    closeAddressModal();
  };

  const handleAddressFormChange = (e) => {
    const { name, value } = e.target;
    setAddressForm(p => ({ ...p, [name]: value }));
  };

  // â”€â”€ Tax Info Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openReferenceDocumentsModal = () => setReferenceDocumentsModal(true);
  const closeReferenceDocumentsModal = () => setReferenceDocumentsModal(false);
  const saveReferenceDocumentsModal = (rows) => {
    setReferenceDocuments(normalizeGRPOReferenceDocuments(rows));
    setReferenceDocumentsChanged(true);
    if (currentDocEntry) setIsDirty(true);
    setReferenceDocumentsModal(false);
  };

  const openTaxInfoModal = () => {
    setTaxInfoModal(true);
  };

  const closeTaxInfoModal = () => {
    setTaxInfoModal(false);
  };

  const saveTaxInfoModal = () => {
    closeTaxInfoModal();
  };

  // â”€â”€ Item Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openItemModal = async (lineIndex) => {
    setItemModal({ open: true, lineIndex, items: [], loading: true });
    try {
      const response = await fetchItemsForModal();
      setItemModal(prev => ({ ...prev, items: response.data.items || [], loading: false }));
    } catch {
      setItemModal(prev => ({ ...prev, items: [], loading: false }));
    }
  };

  const closeItemModal = () => {
    setItemModal({ open: false, lineIndex: -1, items: [], loading: false });
  };

  const handleItemSelect = async (item) => {
    const lineIndex = itemModal.lineIndex;
    if (lineIndex < 0) return;
    try {
      const hsnResponse = await fetchHSNCodeFromItem(item.ItemCode);
      const hsnCode = hsnResponse.data?.hsnCode || item.HSNCode || '';
      setLines(prev => prev.map((line, idx) => {
        if (idx !== lineIndex) return line;
        const next = { ...line };
        next.itemNo = item.ItemCode;
        next.itemDescription = item.ItemName || '';
        Object.assign(next, getItemPurchaseUom(item, refData.uom_groups));
        if (!next.unitPrice) {
          next.unitPrice = getItemPrice(item, 'purchase');
        }
        next.hsnCode = hsnCode;
        next.batches = [];
        next.batchManaged = item.BatchManaged === 'Y';
        next.inventoryUOM = String(item.InventoryUOM || '').trim();
        next.uomFactor = getLineUomFactor({
          uomCode: next.uomCode,
        });
        if (item.DefaultWarehouse) next.whse = item.DefaultWarehouse;
        if (!next.taxCodeManuallyOverridden) {
          const preferredTaxCode = getPreferredLineTaxCode(next.taxCode);
          if (preferredTaxCode) {
            next.taxCode = preferredTaxCode;
          }
        }
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      }));
    } catch {
      setLines(prev => prev.map((line, idx) => {
        if (idx !== lineIndex) return line;
        const unitPrice = line.unitPrice || getItemPrice(item, 'purchase');
        const purchaseUom = getItemPurchaseUom(item, refData.uom_groups);
        const next = {
          ...line,
          itemNo: item.ItemCode,
          itemDescription: item.ItemName || '',
          ...purchaseUom,
          unitPrice,
          hsnCode: item.HSNCode || '',
          batches: [],
          batchManaged: item.BatchManaged === 'Y',
          inventoryUOM: String(item.InventoryUOM || '').trim(),
          uomFactor: getLineUomFactor({
            uomCode: purchaseUom.uomCode,
          }),
          taxCode: !line.taxCodeManuallyOverridden ? (getPreferredLineTaxCode(line.taxCode) || line.taxCode) : line.taxCode,
        };
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      }));
    }
    closeItemModal();
  };

  // â”€â”€ HSN Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openHSNModal = (lineIndex) => setHsnModal({ open: true, lineIndex });
  const closeHSNModal = () => setHsnModal({ open: false, lineIndex: -1 });

  const handleHSNSelect = (hsn) => {
    if (hsnModal.lineIndex >= 0) {
      setLines(prev => prev.map((line, idx) =>
        idx === hsnModal.lineIndex ? { ...line, hsnCode: hsn.code || hsn.Code || '' } : line
      ));
    }
    closeHSNModal();
  };

  // â”€â”€ Business Partner Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openBpModal = () => setBpModal(true);
  const closeBpModal = () => setBpModal(false);

  const handleBpSelect = (bp) => {
    setHeader(prev => {
      const prep = { ...prev, vendor: bp.CardCode };
      const { nextHeader } = syncVendor(bp.CardCode, prep);
      nextHeader.contactPerson = '';
      return nextHeader;
    });
    loadVendorDetails(bp.CardCode);
    closeBpModal();
  };

  const handleTaxInfoFormChange = (e) => {
    const { name, value } = e.target;
    setTaxInfoForm(p => ({ ...p, [name]: value }));
  };

  // â”€â”€ Copy From handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCopyFrom = async (poDocEntry) => {
    setSeriesRevision(value => value + 1);

    try {
      setPageState(p => ({ ...p, loading: true }));
      const res = await fetchPurchaseOrderForCopy(poDocEntry);
      const copiedLines = res.data.lines.map(l => hydrateGRPOLine(l, rowUdfDefinitions, refData.items, header.warehouse || ''));
      const firstLineWarehouse = copiedLines.find((line) => String(line?.whse || '').trim())?.whse || '';
      setHeader(prev => ({
        ...prev,
        ...res.data.header,
        warehouse: res.data.header?.warehouse || firstLineWarehouse || prev.warehouse || '',
        rounding: res.data.header?.rounding ?? normaliseDocumentHeader(res.data.header || {}).rounding ?? false,
        roundingAmount: res.data.header?.roundingAmount || res.data.header?.RoundingAmount || res.data.header?.RoundDif || '',
      }));
      setHeaderUdfs((prev) => ({ ...prev, ...(res.data.header_udfs || {}) }));
      setLines(copiedLines);
      setCopyFromModal(false);
      if (res.data.header.vendor) {
        loadVendorDetails(res.data.header.vendor);
      }
      setPageState(p => ({ ...p, loading: false, success: 'Purchase Order copied successfully.' }));
    } catch (err) {
      setPageState(p => ({ ...p, loading: false, error: 'Failed to copy from Purchase Order.' }));
    }
  };

  const openCopyFromModal = () => {
    if (currentDocEntry) return;

    if (!String(header.vendor || '').trim()) {
      setValErrors({ header: { vendor: 'Select a vendor first.' }, lines: {}, form: '' });
      setPageState((prev) => ({ ...prev, error: '', success: '' }));
      return;
    }

    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState((prev) => ({ ...prev, error: '', success: '' }));
    setCopyFromModal(true);
  };

  const handleCopyTo = async (targetType) => {
    if (currentDocEntry && !hasOpenCopyQuantity) {
      setPageState(p => ({
        ...p,
        success: '',
        error: 'This Goods Receipt PO has no open quantity left. It has already been fully copied to A/P Invoice.',
      }));
      return;
    }

    await copyToDocument({
      sourceDocType: 'grpo',
      targetType,
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: { header, lines, freightCharges: freightModal.freightCharges },
      restoreState: { grpoDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
      errorMessage: 'Please save the goods receipt PO first before copying to another document.',
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
      successMessage: 'Goods receipt PO duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      setHeader(prev => ({
        ...prev,
        postingDate: duplicateDate,
        deliveryDate: duplicateDate,
        documentDate: duplicateDate,
        series: '',
        nextNumber: '',
      }));
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

  const openBatchModal = (lineIndex) => {
    const line = lines[lineIndex];
    if (!line?.itemNo) {
      setPageState(p => ({ ...p, error: 'Select an item before allocating batches.' }));
      return;
    }
    if (!line?.whse) {
      setPageState(p => ({ ...p, error: 'Select a warehouse before allocating batches.' }));
      return;
    }

    setBatchModal({ open: true, lineIndex, availableBatches: [], loading: true, error: '' });
    window.setTimeout(async () => {
      try {
        const response = await fetchBatchesByItem(line.itemNo, line.whse);
        setBatchModal(current => (
          current.open && current.lineIndex === lineIndex
            ? {
              open: true,
              lineIndex,
              availableBatches: response.data.batches || [],
              loading: false,
              error: '',
            }
            : current
        ));
      } catch (error) {
        setBatchModal(current => (
          current.open && current.lineIndex === lineIndex
            ? {
              open: true,
              lineIndex,
              availableBatches: [],
              loading: false,
              error: getErrMsg(error, 'Failed to load warehouse batches.'),
            }
            : current
        ));
      }
    }, 0);
  };

  const closeBatchModal = () => {
    setBatchModal({ open: false, lineIndex: null, availableBatches: [], loading: false, error: '' });
  };

  const saveLineBatches = (nextBatches) => {
    if (batchModal.lineIndex == null) return;
    setLines(prev => prev.map((line, index) => (
      index === batchModal.lineIndex ? { ...line, batches: nextBatches } : line
    )));
    setValErrors(prev => {
      const nextLineErrors = { ...(prev.lines[batchModal.lineIndex] || {}) };
      delete nextLineErrors.batches;
      return {
        ...prev,
        lines: {
          ...prev.lines,
          [batchModal.lineIndex]: nextLineErrors,
        },
      };
    });
    closeBatchModal();
  };

  // â”€â”€ validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const validate = () => {
    const isUpdate = !!currentDocEntry;
    const e = { header: {}, lines: {}, form: '' };

    if (!isUpdate) {
      const vc = String(header.vendor || '').trim();
      if (!vc) { e.header.vendor = 'Select a vendor.'; e.form = 'Please correct the highlighted fields.'; return e; }
    }

    if (!String(header.postingDate || '').trim()) { e.header.postingDate = 'Posting date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (!String(header.documentDate || '').trim()) { e.header.documentDate = 'Document date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (!isUpdate && isManualDocumentSeries(header.series) && !isValidManualDocumentNumber(header.nextNumber)) {
      e.header.nextNumber = 'Enter a positive document number for Manual series.';
      e.form = 'Please correct the highlighted fields.';
      return e;
    }

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

      if (!l.hsnCode && !isUpdate) {
        e.lines[i] = { ...(e.lines[i] || {}), hsnCode: 'HSN Code is required' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      if (!l.quantity || Number(l.quantity) <= 0) {
        e.lines[i] = { ...(e.lines[i] || {}), quantity: 'Quantity must be > 0' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      // Validate against open quantity if copying from PO
      if (l.openQty && Number(l.quantity) > Number(l.openQty)) {
        e.lines[i] = {
          ...(e.lines[i] || {}),
          quantity: `Cannot exceed open qty (${l.openQty})`
        };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      if (!l.uomCode && !isUpdate) {
        e.lines[i] = { ...(e.lines[i] || {}), uomCode: 'UoM is required' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      if ((!l.unitPrice || Number(l.unitPrice) <= 0) && !isUpdate) {
        e.lines[i] = { ...(e.lines[i] || {}), unitPrice: 'Unit Price must be > 0' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      if (!l.whse && !isUpdate) {
        e.lines[i] = { ...(e.lines[i] || {}), whse: 'Warehouse is required' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      if (l.batchManaged) {
        if (!Array.isArray(l.batches) || l.batches.length === 0) {
          e.lines[i] = { ...(e.lines[i] || {}), batches: 'Batch selection is mandatory for batch-managed item' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }
        const requiredBatchQty = getRequiredBatchQty(l);
        const assignedBatchQty = sumBatchQty(l.batches);
        const inventoryUOM = l.inventoryUOM || l.uomCode || 'Base UoM';
        if (Math.abs(assignedBatchQty - requiredBatchQty) > BATCH_QTY_TOLERANCE) {
          e.lines[i] = {
            ...(e.lines[i] || {}),
            batches: `Batch quantity (${assignedBatchQty.toFixed(2)} ${inventoryUOM}) must match base quantity (${requiredBatchQty.toFixed(2)} ${inventoryUOM}).`
          };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }
      }
    }

    return e;
  };

  // â”€â”€ submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
    docEntry: currentDocEntry, isDirty,
    state: { header, lines, headerUdfs, referenceDocuments, referenceDocumentsChanged, freightCharges: freightModal.freightCharges , company_id: activeCompanyId, companyKey: formSettingsStorageKey },
  });

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!isDocumentEditable) {
      setPageState(p => ({ ...p, error: 'This document is closed and cannot be edited.', success: '' }));
      return;
    }
    if (currentDocEntry && !hasUnsavedChanges) return;
    const e = validate();
    if (e.form || Object.values(e.header).some(Boolean) || Object.values(e.lines).some(le => Object.values(le || {}).some(Boolean))) {
      setValErrors(e);
      setPageState(p => ({ ...p, error: e.form || 'Please correct the highlighted fields.', success: '' }));
      const firstBatchErrorLineIndex = Object.entries(e.lines || {}).find(([, lineErrors]) =>
        Boolean(lineErrors?.batches)
      )?.[0];
      if (firstBatchErrorLineIndex !== undefined) {
        const lineIndex = Number(firstBatchErrorLineIndex);
        if (Number.isInteger(lineIndex) && lineIndex >= 0) {
          setActiveTab('Contents');
          window.setTimeout(() => openBatchModal(lineIndex), 0);
        }
      }
      return;
    }
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, posting: true, error: '', success: '' }));
    try {
      const prep = {
        ...header,
        deliveryDate: header.deliveryDate || header.postingDate || header.documentDate,
        roundingAmount: getDocumentRoundingPayloadAmount(header, totals.roundingAmount),
        roundingAmountIsManual: header.roundingAmountIsManual === true,
        series: header.series || undefined,
      };

      const payloadLines = lines.map((line) => ({
        ...line,
        udf: buildGRPOLineUdfPayload(line, rowUdfDefinitions, formSettings),
      }));
      const payload = {
        company_id: activeCompanyId,
        header: prep,
        lines: payloadLines,
        freightCharges: freightModal.freightCharges,
        reference_documents: referenceDocuments,
        reference_documents_changed: referenceDocumentsChanged || (!currentDocEntry && referenceDocuments.length > 0),
        header_udfs: {
          ...headerUdfs,
          U_ShipLocation: prep.buyerLocation || '',
        },
      };
      const r = currentDocEntry ? await updateGRPO(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitGRPO(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      setSnapshotPending(false);
      setIsDirty(false);
      setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
      setReferenceDocuments([]); setReferenceDocumentsChanged(false); setReferenceDocumentsModal(false);
      setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
      setRefData(p => ({
        ...p,
        contacts: [],
        pay_to_addresses: [],
        ship_to_addresses: [],
        bill_to_addresses: [],
      }));
      setValErrors({ header: {}, lines: {}, form: '' });

      if (refData.series.length > 0) {
        setHeader(prev => ({ ...prev, series: '', nextNumber: '', docNo: '' }));
      }

      setPageState(p => ({ ...p, success: `${r.data.message || 'Goods Receipt PO saved.'}${dn}` }));
    } catch (e) {
      setPageState(p => ({ ...p, error: getErrMsg(e, 'Goods Receipt PO submission failed.') }));
    } finally {
      setPageState(p => ({ ...p, posting: false }));
    }
  };

  const resetForm = () => {
    setSeriesRevision(value => value + 1);

    setSnapshotPending(false);
    setIsDirty(false);
    setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
    setReferenceDocuments([]); setReferenceDocumentsChanged(false); setReferenceDocumentsModal(false);
    setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, error: '', success: '' }));
    setFreightModal({ open: false, freightCharges: [], loading: false });
  };

  const hasBuyerCode = Boolean(String(header.vendor || '').trim());
  const visHdrUdfs = headerUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;
  // Visibility is resolved once, inside the Contents grid, with the same shared
  // helper the Form Settings panel uses. Pre-filtering here only on
  // `matrixColumns` hid company-published columns whose setting is stored under
  // `rowUdfs`, so the panel showed them ticked while the grid dropped them.

  // Continue in next message with render...

  // â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useDocumentSeries({ endpoint: '/grpo', companyKey: formSettingsStorageKey, currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form ref={formRef} className={`po-page sap-document-page grpo-page${isRightSidebarOpen ? ' po-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>

      {/* â”€â”€ Toolbar â”€â”€ */}
      <div className="po-toolbar sap-document-toolbar">
        <span className="po-toolbar__title sap-document-toolbar__title">Goods Receipt PO{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="po-btn po-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || formSettingsStatus.queryModeActive}>
          {primaryActionLabel}
        </button>
        <button type="button" className="po-btn sap-document-toolbar__cancel" onClick={resetForm}>Cancel</button>
        <button type="button" className="po-btn sap-document-toolbar__find" onClick={() => navigate('/grpo/find')}>Find</button>
        <button type="button" className="po-btn sap-document-toolbar__new" onClick={resetForm}>New</button>
        <button type="button" className="po-btn sap-document-toolbar__udf" onClick={toggleHeaderUdfs}>
          {sidebarOpen ? 'Hide UDFs' : 'Show UDFs'}
        </button>
        <button type="button" className="po-btn sap-document-toolbar__settings" onClick={toggleFormSettings} disabled={formSettingsStatus.queryModeActive} title={formSettingsStatus.queryModeActive ? 'Company SQL Content layout is active' : 'Choose document-line fields'}>Form Settings</button>
        <div className="po-dropdown">
          <button
            type="button"
            className="po-btn"
            disabled={!isDocumentEditable || !!currentDocEntry || formSettingsStatus.queryModeActive}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const dropdown = event.currentTarget.parentElement;
              const isActive = dropdown.classList.contains('active');
              document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
              if (!isActive) dropdown.classList.add('active');
            }}
          >
            Copy From ▼
          </button>
          <div className="po-dropdown-menu">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openCopyFromModal();
                document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
              }}
            >
              Purchase Orders
            </button>
          </div>
        </div>
        <div className="po-dropdown">
          <button
            type="button"
            className="po-btn"
            disabled={!currentDocEntry || !hasOpenCopyQuantity || formSettingsStatus.queryModeActive}
            title={!currentDocEntry
              ? 'Open a saved goods receipt PO before using Copy To.'
              : !hasOpenCopyQuantity
                ? 'This Goods Receipt PO has no open quantity left.'
                : 'Copy To'}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!currentDocEntry || !hasOpenCopyQuantity) return;
              const dropdown = event.currentTarget.parentElement;
              const isActive = dropdown.classList.contains('active');
              document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
              if (!isActive) dropdown.classList.add('active');
            }}
          >
            Copy To ▼
          </button>
          <div className="po-dropdown-menu">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleCopyTo('apInvoice');
                document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
              }}
            >
              A/P Invoice
            </button>
          </div>
        </div>
        {currentDocEntry && (
          <button type="button" className="po-btn sap-document-toolbar__duplicate" onClick={handleDuplicate} disabled={formSettingsStatus.queryModeActive}>
            Duplicate
          </button>
        )}
        <PurchasePrintLayoutActions
          documentKey="goodsReceiptPo"
          docEntry={currentDocEntry}
          docNumber={header.docNo}
          disabled={pageState.posting || pageState.loading}
          onSuccess={(message) => setPageState(p => ({ ...p, error: '', success: message }))}
          onError={(message) => setPageState(p => ({ ...p, error: message, success: '' }))}
        />
        <JournalEntryPreviewButton
          documentType="grpo"
          documentLabel="Goods Receipt PO"
          docEntry={currentDocEntry}
          buildPayload={() => ({ header, lines, header_udfs: headerUdfs, freightCharges: freightModal.freightCharges })}
          disabled={pageState.posting || pageState.loading}
          className="po-btn sap-document-toolbar__journal-preview"
        />
        <span className={`po-mode-badge po-mode-badge--${currentDocEntry ? 'update' : 'add'}`}>
          {currentDocEntry ? 'Update' : 'Add'}
        </span>
      </div>

      {/* â”€â”€ Alerts â”€â”€ */}
      {pageState.loading && <div className="po-alert po-alert--warning">Loading...</div>}
      {pageState.error   && <div className="po-alert po-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="po-alert po-alert--success">{pageState.success}</div>}
      {refData.warnings?.length > 0 && (
        <div className="po-alert po-alert--warning">
          <strong>SAP warnings:</strong>
          {refData.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      <fieldset ref={documentBodyRef} aria-disabled={!isDocumentEditable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className={`po-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`}>
          <div className="po-layout__main">

            {/* â•â• HEADER CARD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="po-header-card">
              <div className="po-document-header-grid po-header-grid">

                {/* LEFT â€” Vendor info */}
                <div className="po-document-header-column po-header-grid__section po-header-grid__section--left">
                  <div className="po-field">
                    <label className="po-field__label">Vendor Code *</label>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <input 
                        name="vendor" 
                        className={`po-field__input${valErrors.header.vendor ? ' po-field__input--error' : ''}`} 
                        value={header.vendor} 
                        onChange={handleHeaderChange} 
                        disabled={!!currentDocEntry} 
                        style={{ flex: 1 }} 
                        placeholder="Select Vendor"
                      />
                      <SapGoldenArrowButton
                        onClick={openBusinessPartnerLink}
                        disabled={!header.vendor}
                        title="Open Business Partner"
                      />
                      {!currentDocEntry && (
                        <button type="button" onClick={openBpModal} style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }} title="Select Vendor">...</button>
                      )}
                    </div>
                    {valErrors.header.vendor && <span className="po-error-feedback">{valErrors.header.vendor}</span>}
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Vendor Name</label>
                    <input name="name" className="po-field__input" value={header.name} readOnly />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Contact Person</label>
                    <select name="contactPerson" className="po-field__select" value={header.contactPerson || ''} onChange={handleHeaderChange} disabled={pageState.vendorLoading || !header.vendor || !!currentDocEntry}>
                      <option value="">Select</option>
                      {contactOptions.map(c => (
                        <option key={c.CntctCode} value={c.CntctCode}>{c.Name || `${c.FirstName || ''} ${c.LastName || ''}`}</option>
                      ))}
                    </select>
                  </div>
                  <DocumentCurrencySelect
                    classPrefix="po"
                    header={header}
                    onHeaderChange={handleHeaderChange}
                    businessPartners={refData.vendors || []}
                    currencyOptions={refData.currencies || []}
                    localCurrency={refData.local_currency || ''}
                    systemCurrency={refData.system_currency || refData.local_currency || ''}
                    fallbackLocalCurrency=""
                    disabled={!header.vendor || Boolean(currentDocEntry)}
                  />
                  <div className="po-field">
                    <label className="po-field__label">Vendor Ref. No.</label>
                    <input name="salesContractNo" className="po-field__input" value={header.salesContractNo} onChange={handleHeaderChange} />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Place of Supply</label>
                    <select
                      name="placeOfSupply"
                      className="po-field__select"
                      value={header.placeOfSupply || ''}
                      onChange={handleHeaderChange}
                    >
                      <option value="">Select</option>
                      {refData.states.map((state) => (
                        <option key={state.Code} value={state.Code}>{state.Name || state.Code}</option>
                      ))}
                      {header.placeOfSupply && !refData.states.some((state) => String(state.Code) === String(header.placeOfSupply)) && (
                        <option value={header.placeOfSupply}>{header.placeOfSupply}</option>
                      )}
                    </select>
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Branch</label>
                    <select name="branch" className="po-field__select" value={header.branch} onChange={handleHeaderChange}>
                      <option value="">Select</option>
                      {refData.branches.map(b => <option key={b.BPLId} value={b.BPLId}>{b.BPLName}</option>)}
                    </select>
                  </div>
                </div>

                {/* RIGHT â€” Document info */}
                <div className="po-document-header-column po-header-grid__section po-header-grid__section--right">
                  <div className="po-field">
                    <label className="po-field__label">Series</label>
                    <select name="series" className="po-field__select" value={header.series} onChange={handleHeaderChange} disabled={!!currentDocEntry || pageState.seriesLoading}>
                      <option value="">{pageState.seriesLoading ? 'Loading series...' : pageState.seriesError ? 'Series unavailable' : 'Select Series'}</option>
                      {(canUseManualSeries(refData) || (currentDocEntry && ['-1','manual','__sap_manual__'].includes(String(header.series)))) && (<option value={SAP_MANUAL_SERIES_VALUE}>Manual</option>)}
                      {getSapVisibleDocumentSeries(refData.series, {
                        selectedSeries: header.series, includeHistorical: Boolean(currentDocEntry),
                        postingDate: header.postingDate || header.documentDate,
                      }).map(s => <option key={s.Series} value={s.Series}>{s.SeriesName}</option>)}
                      {header.series && !isManualDocumentSeries(header.series) && !refData.series.some(s => String(s.Series) === String(header.series)) && (
                        <option value={header.series}>{header.series}</option>
                      )}
                    </select>
                    <input
                      name="nextNumber"
                      type="text"
                      className="po-field__input"
                      style={{
                        width: 80,
                        background: !currentDocEntry && isManualDocumentSeries(header.series) ? '#fff' : '#f0f2f5',
                        textAlign: 'center',
                        border: valErrors.header.nextNumber ? '1px solid #c00' : undefined,
                      }}
                      value={pageState.seriesLoading ? '...' : (currentDocEntry ? (header.docNo || header.nextNumber || '') : header.nextNumber)}
                      onChange={handleHeaderChange}
                      readOnly={!!currentDocEntry || !isManualDocumentSeries(header.series)}
                      title={isManualDocumentSeries(header.series) ? 'Enter the manual document number' : 'Number will be assigned from the selected series'}
                    />
                    {valErrors.header.nextNumber && <span className="po-error-feedback">{valErrors.header.nextNumber}</span>}
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Status</label>
                    <input name="status" className="po-field__input" value={header.status} readOnly style={{ color: header.status === 'Open' ? '#1a7a30' : '#c00', fontWeight: 600 }} />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Posting Date *</label>
                    <SapDateInput  name="postingDate" className={`po-field__input${valErrors.header.postingDate ? ' po-field__input--error' : ''}`} value={header.postingDate} onChange={handleHeaderChange} />
                    {valErrors.header.postingDate && <span className="po-error-feedback">{valErrors.header.postingDate}</span>}
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Due Date</label>
                    <SapDateInput  name="deliveryDate" className="po-field__input" value={header.deliveryDate} onChange={handleHeaderChange} />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Document Date *</label>
                    <SapDateInput  name="documentDate" className={`po-field__input${valErrors.header.documentDate ? ' po-field__input--error' : ''}`} value={header.documentDate} onChange={handleHeaderChange} />
                    {valErrors.header.documentDate && <span className="po-error-feedback">{valErrors.header.documentDate}</span>}
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Default Warehouse</label>
                    <select name="warehouse" className="po-field__select" value={header.warehouse || ''} onChange={handleHeaderChange}>
                      <option value="">Select Warehouse</option>
                      {branchFilteredWarehouses.map(w => (
                        <option key={w.WhsCode} value={w.WhsCode}>{w.WhsCode} - {w.WhsName}</option>
                      ))}
                      {header.warehouse && !branchFilteredWarehouses.some(w => String(w.WhsCode) === String(header.warehouse)) && (
                        <option value={header.warehouse}>{header.warehouse}</option>
                      )}
                    </select>
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Ship From</label>
                    <select
                      name="shipToCode"
                      className="po-field__select"
                      value={header.shipToCode || ''}
                      onChange={handleShipToCodeChange}
                      disabled={!header.vendor}
                    >
                      <option value="">Select</option>
                      {vendorEffectiveShipToAddresses.map((address) => (
                        <option key={address.Address} value={address.Address}>
                          {address.Address}
                        </option>
                      ))}
                      {header.shipToCode && !vendorEffectiveShipToAddresses.some((address) => String(address.Address || '') === String(header.shipToCode)) && (
                        <option value={header.shipToCode}>{header.shipToCode}</option>
                      )}
                    </select>
                  </div>
                </div>

              </div>
            </div>

            {/* â•â• TABS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="po-tabs">
              {TAB_NAMES.map(t => (
                <button type="button" key={t} className={`po-tab${activeTab === t ? ' po-tab--active' : ''}`} onClick={() => setActiveTab(t)}>{t}</button>
              ))}
            </div>

            {/* â•â• TAB CONTENT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="po-tab-panel">
            {activeTab === 'Contents' && (
              <ContentsTab
                companyQueryContext={buildCompanyFormQueryContext(currentDocEntry, header)}
                lines={lines}
                onLineChange={handleLineChange}
                onNumBlur={handleNumBlur}
                onAddLine={addLine}
                onRemoveLine={removeLine}
                onOpenBatchModal={openBatchModal}
                onOpenItemModal={openItemModal}
                onOpenHSNModal={openHSNModal}
                lineItemOptions={lineItemOptions}
                taxCodeOptions={effectiveTaxCodes}
                warehouseOptions={branchFilteredWarehouses}
                uomOptions={uomOptions}
                formatTaxLabel={fmtTaxLabel}
                valErrors={valErrors}
                visibleColumns={effectiveMatrixColumnDefinitions}
                visibleRowUdfs={rowUdfDefinitions}
                onRowUdfChange={handleRowUdfChange}
                formSettings={formSettings}
                canPasteTable={isDocumentEditable}
                onPasteTable={handleTablePaste}
                onClipboardFeedback={handleTableClipboardFeedback}
              />
            )}

            {activeTab === 'Logistics' && (
              <LogisticsTab
                header={header}
                onHeaderChange={handleHeaderChange}
                vendorShipToAddresses={vendorEffectiveShipToAddresses}
                vendorPayToAddresses={vendorPayToAddresses}
                shippingTypeOptions={shipTypeOpts}
                onShipToCodeChange={handleShipToCodeChange}
                onPayToCodeChange={(event) => handlePayToCodeChange(event.target.value)}
                onOpenAddressModal={openAddressModal}
              />
            )}

            {activeTab === 'Accounting' && (
              <AccountingTab
                header={header}
                onHeaderChange={handleHeaderChange}
                paymentTermOptions={payTermOpts}
                referenceDocuments={referenceDocuments}
                onOpenReferenceDocuments={openReferenceDocumentsModal}
                isEditable={isDocumentEditable}
              />
            )}

            {activeTab === 'Tax' && (
              <TaxTab header={header} onHeaderChange={handleHeaderChange} onOpenTaxInfoModal={openTaxInfoModal} />
            )}

            {activeTab === 'Electronic Documents' && (
              <ElectronicDocumentsTab header={header} onHeaderChange={handleHeaderChange} />
            )}

            {activeTab === 'Attachments' && (
              <AttachmentsTab attachments={attachments} onBrowseAttachment={handleBrowseAttachment} />
            )}
            </div>{/* end po-tab-panel */}

            {/* â•â• TOTALS FOOTER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="po-header-card" style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <div className="po-field">
                    <label className="po-field__label">Purchaser</label>
                    <select name="purchaser" className="po-field__select" value={header.purchaser || ''} onChange={handleHeaderChange}>
                      <option value="">No Purchaser</option>
                      {effectiveSalesEmployees.map((employee) => (
                        <option key={employee.SlpCode ?? employee.SlpName} value={employee.SlpName || ''}>
                          {employee.SlpName || ''}
                        </option>
                      ))}
                      <option value="__DEFINE_NEW__">Define New</option>
                    </select>
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Owner</label>
                    <input name="owner" className="po-field__input" value={header.owner || ''} onChange={handleHeaderChange} />
                  </div>
                  <div className="po-field" style={{ alignItems: 'flex-start' }}>
                    <label className="po-field__label" style={{ paddingTop: 4 }}>Remarks</label>
                    <textarea className="po-textarea" rows={3} name="otherInstruction" value={header.otherInstruction} onChange={handleHeaderChange} />
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  {totalsForDisplay.taxBreakdown.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className="po-section-title">Tax Summary</div>
                      {totalsForDisplay.taxBreakdown.map(t => (
                        <div key={t.taxCode} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                          <span>{t.taxCode} ({t.taxRate}%)</span>
                          <span>{fmtDec(t.taxAmount, numDec.tax)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <table className="po-grid" style={{ tableLayout: 'fixed' }}>
                    <tbody>
                      <tr>
                        <td style={{ fontWeight: 600 }}>Total Before Discount</td>
                        <td><input className="po-grid__input" value={fmtDec(totalsForDisplay.subtotal, numDec.total)} readOnly style={{ background: '#f5f8fc' }} /></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600 }}>Discount %</td>
                        <td><input className="po-grid__input" name="discount" value={header.discount} onChange={handleHeaderChange} onBlur={() => handleNumBlur('discount', 'header')} /></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600 }}>Freight</td>
                        <td style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input className="po-grid__input" name="freight" value={header.freight} onChange={handleHeaderChange} onBlur={() => handleNumBlur('freight', 'header')} style={{ flex: 1 }} />
                          <button
                            type="button"
                            onClick={openFreightModal}
                            style={{ padding: '2px 8px', fontSize: 11, border: '1px solid #d0d7de', borderRadius: 3, background: 'linear-gradient(180deg, #f6f8fa 0%, #e9ecef 100%)', cursor: 'pointer', minWidth: 24 }}
                            title="Select Freight Charge"
                          >
                            ...
                          </button>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600 }}>
                          <label className="po-checkbox-label">
                            <input type="checkbox" name="rounding" checked={header.rounding} onChange={handleHeaderChange} />
                            Rounding
                          </label>
                        </td>
                        <td><DocumentRoundingInput className="po-grid__input" header={header} setHeader={setHeader} formattedAmount={fmtDec(totalsForDisplay.roundingAmount, numDec.totalPaymentDue)} disabled={!isDocumentEditable} onManualChange={markDirty} /></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600 }}>Tax</td>
                        <td><input className="po-grid__input" value={fmtDec(totalsForDisplay.taxAmt, numDec.tax)} readOnly style={{ background: '#f5f8fc' }} /></td>
                      </tr>
                      <tr className="po-grid__total">
                        <td style={{ fontWeight: 700, color: '#003366', fontSize: 12 }}>Total</td>
                        <td><input className="po-grid__input" value={fmtDec(totalsForDisplay.total, numDec.totalPaymentDue)} readOnly style={{ background: '#e8f4fc', fontWeight: 700, color: '#003366' }} /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* â•â• ACTION BUTTONS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {false && (
            <div className="po-toolbar" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="submit" className="po-btn po-btn--primary" disabled={pageState.posting}>
                  {secondaryActionLabel}
                </button>
                <button type="button" className="po-btn" onClick={resetForm}>Cancel</button>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div className="po-dropdown">
                  <button
                    type="button"
                    className="po-btn"
                    disabled={!isDocumentEditable || !!currentDocEntry}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      const dropdown = event.currentTarget.parentElement;
                      const isActive = dropdown.classList.contains('active');
                      document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
                      if (!isActive) dropdown.classList.add('active');
                    }}
                  >
                    Copy From ▼
                  </button>
                  <div className="po-dropdown-menu">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        openCopyFromModal();
                        document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
                      }}
                    >
                      Purchase Orders
                    </button>
                  </div>
                </div>
                <div className="po-dropdown">
                  <button
                    type="button"
                    className="po-btn"
                    disabled={!currentDocEntry || !hasOpenCopyQuantity}
                    title={!currentDocEntry
                      ? 'Open a saved goods receipt PO before using Copy To.'
                      : !hasOpenCopyQuantity
                        ? 'This Goods Receipt PO has no open quantity left.'
                        : 'Copy To'}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!currentDocEntry || !hasOpenCopyQuantity) return;
                      const dropdown = event.currentTarget.parentElement;
                      const isActive = dropdown.classList.contains('active');
                      document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
                      if (!isActive) dropdown.classList.add('active');
                    }}
                  >
                    Copy To ▼
                  </button>
                  <div className="po-dropdown-menu">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleCopyTo('apInvoice');
                        document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
                      }}
                    >
                      A/P Invoice
                    </button>
                  </div>
                </div>
              </div>
            </div>
            )}

        </div>{/* end main flex */}

          <HeaderUdfSidebar
            className="po-layout__sidebar"
            isOpen={sidebarOpen}
            fields={visHdrUdfs}
            formSettings={formSettings}
            values={headerUdfs}
            disabled={!hasBuyerCode}
            onFieldChange={handleHeaderUdfChange}
            onClose={() => setSidebarOpen(false)}
          />
          <FormSettingsPanel
            variant="sidebar"
            className="po-layout__sidebar"
            isOpen={formSettingsOpen}
            onClose={() => setFormSettingsOpen(false)}
            matrixFields={effectiveMatrixColumnDefinitions}
            headerUdfFields={headerUdfDefinitions}
            rowUdfFields={[]}
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
        states={refData.states || []}
      />

      {/* Tax Information Modal */}
      <TaxInfoModal
        isOpen={taxInfoModal}
        onClose={closeTaxInfoModal}
        onSave={saveTaxInfoModal}
        taxInfoForm={taxInfoForm}
        onFormChange={handleTaxInfoFormChange}
      />

      {/* Copy From Modal */}
      <CopyFromModal
        isOpen={copyFromModal}
        onClose={() => setCopyFromModal(false)}
        onCopy={handleCopyFrom}
        vendorCode={header.vendor}
      />

      <SalesEmployeeSetupModal
        isOpen={salesEmployeeSetup.open}
        rows={salesEmployeeSetup.rows}
        saving={salesEmployeeSetup.saving}
        onClose={closeSalesEmployeeSetup}
        onSave={saveSalesEmployeeSetup}
        onUpdateRow={updateSalesEmployeeSetupRow}
      />

      <ReferenceDocumentsModal
        isOpen={referenceDocumentsModal}
        referenceDocuments={referenceDocuments}
        onClose={closeReferenceDocumentsModal}
        onSave={saveReferenceDocumentsModal}
        isEditable={isDocumentEditable}
        cardCode={header.vendor}
        onOpenDocument={openReferenceDocumentLink}
      />

      <BatchAllocationModal
        isOpen={batchModal.open}
        mode="receipt"
        line={batchModal.lineIndex != null ? lines[batchModal.lineIndex] : null}
        availableBatches={batchModal.availableBatches}
        loading={batchModal.loading}
        error={batchModal.error}
        onGenerateBatchNumber={() => fetchNextBatchNumber('JKL')}
        workspaceRef={formRef}
        onClose={closeBatchModal}
        onSave={saveLineBatches}
      />

      {/* Item Selection Modal */}
      <ItemSelectionModal
        isOpen={itemModal.open}
        onClose={closeItemModal}
        onSelect={handleItemSelect}
        items={itemModal.items}
        loading={itemModal.loading}
      />

      {/* HSN Code Modal */}
      <HSNCodeModal
        isOpen={hsnModal.open}
        onClose={closeHSNModal}
        onSelect={handleHSNSelect}
      />

      {/* Business Partner Modal */}
      <BusinessPartnerModal
        isOpen={bpModal}
        onClose={closeBpModal}
        onSelect={handleBpSelect}
        businessPartners={refData.vendors || []}
      />

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

export default GoodsReceiptPO;
