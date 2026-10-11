import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import './styles/APInvoice.css';
import { useLocation, useNavigate } from 'react-router-dom';
import FormSettingsPanel from '../../components/ap-invoice/FormSettingsPanel';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import HeaderUdfSidebar from '../../components/ap-invoice/HeaderUdfSidebar';
import LineValueLookupModal from '../../components/sales-document/LineValueLookupModal';
import ContentsTab from './components/ContentsTab';
import LogisticsTab from './components/LogisticsTab';
import AccountingTab from './components/AccountingTab';
import TaxTab from './components/TaxTab';
import ElectronicDocumentsTab from './components/ElectronicDocumentsTab';
import AttachmentsTab from './components/AttachmentsTab';
import AddressModal from '../../components/document/AddressComponentModal';
import TaxInfoModal from './components/TaxInfoModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import BusinessPartnerModal from './components/BusinessPartnerModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import WithholdingTaxTableModal from './components/WithholdingTaxTableModal';
import CopyFromModal from '../../components/document/CopyFromModal';
import BatchAllocationModal from '../grpo/components/BatchAllocationModal';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import PurchasePrintLayoutActions from '../../components/print-layout/PurchasePrintLayoutActions';
import JournalEntryPreviewButton from '../../components/journal-entry/JournalEntryPreviewButton';
import SalesEmployeeSetupModal from '../../components/sales-employee/SalesEmployeeSetupModal';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import { copyToDocument } from '../../services/documentCopyService';
import { duplicateDocumentInPlace, refreshDuplicateSeries } from '../../utils/documentDuplicate';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import { filterWarehousesByBranch } from '../../utils/warehouseBranch';
import { getItemPurchaseUom, hydrateDocumentLineFromItem, mergeItemMaster } from '../../utils/documentItemHydration';
import { applyUomCodeSelection, getLineUomOptions } from '../../utils/documentUom';
import { applyDocumentTablePaste } from '../../utils/documentTableClipboard';
import { mapAddressToModalForm, resolveAddressForModal, resolveBuyerBillToAddress } from '../../utils/documentAddress';
import { getSapVisibleDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import {
  SAP_MANUAL_SERIES_VALUE,
  isManualDocumentSeries,
  isValidManualDocumentNumber,
} from '../../utils/documentSeries';
import { useStandardSalesFormSettings } from '../../utils/standardSalesFormSettings';
import { buildCompanyFormQueryContext } from '../../utils/companyFormQueryContext';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import { fetchSalesDocumentSchema } from '../../api/salesDocumentSchemaApi';
import { buildSalesDocumentLiveFields } from '../../utils/salesDocumentLiveFields';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount } from '../../utils/documentRounding';
import DocumentRoundingInput from '../../components/sales-document/DocumentRoundingInput';
import { resolveWithholdingTaxBaseAmount } from '../../utils/withholdingTax';
import useSalesEmployeeSetup from '../../hooks/useSalesEmployeeSetup';
import { useAuth } from '../../auth/AuthContext';
import { consumeCopyToState, replaceRouteStatePreservingWindow } from '../../utils/copyToState';
import useDocumentDraftTask from '../../hooks/useDocumentDraftTask';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import {
  BATCH_QTY_TOLERANCE,
  getRequiredBatchQty,
  sumBatchQty,
} from '../../utils/batchQuantity';
import { fetchNextBatchNumber } from '../../api/grpoApi';
import { buildLocationLookupOptions } from '../../utils/locationLookup';
import {
  fetchAPInvoiceReferenceData,
  fetchAPInvoiceVendorDetails,
  submitAPInvoice,
  updateAPInvoice,
  fetchAPInvoiceByDocEntry,
  fetchOpenGRPO,
  fetchGRPOForCopy,
  fetchItemsForModal,
  fetchFreightCharges,
} from '../../api/apInvoiceApi';
import { fetchHSNCodeFromItem } from '../../api/hsnCodeApi';
import { normaliseDocumentHeader, normaliseDocumentLine, unwrapCopyFromDocument } from '../../api/copyFromApi';
import {
  BASE_MATRIX_COLUMNS,
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createUdfState,
  readSavedFormSettings,
} from '../../config/APInvoiceForm';
import {
  buildPurchaseOrderLineUdfPayload,
  hydratePurchaseOrderLineUdfFields,
} from '../purchase-order/purchaseOrderLineUdfMapping';

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
const getFirstValidationMessage = (errors) => {
  if (errors.form && errors.form !== 'Please correct the highlighted fields.') return errors.form;
  const headerMessage = Object.values(errors.header || {}).find(Boolean);
  if (headerMessage) return headerMessage;
  for (const lineError of Object.values(errors.lines || {})) {
    const message = Object.values(lineError || {}).find(Boolean);
    if (message) return message;
  }
  return 'Please correct the highlighted fields.';
};

const isYesValue = (value) => ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase());

const normalizeState = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const isGstTaxCode = (taxCode) => {
  const value = String(taxCode || '').trim().toUpperCase();
  return Boolean(value) && value.includes('GST') && !value.includes('NON-GST') && !value.includes('NONGST');
};

const getDerivedGstType = (vendorState, placeOfSupply) => {
  if (!vendorState || !placeOfSupply) return '';
  return normalizeState(vendorState) === normalizeState(placeOfSupply) ? 'INTRASTATE' : 'INTERSTATE';
};

const formatDerivedGstType = (gstType) => {
  if (gstType === 'INTRASTATE') return 'CGST + SGST';
  if (gstType === 'INTERSTATE') return 'IGST';
  return '';
};

const findPreferredGstTaxCode = ({ taxCodes = [], gstType = '', currentTaxCode = '' }) => {
  if (!gstType) return null;

  const availableTaxCodes = taxCodes.filter((taxCode) =>
    isGstTaxCode(taxCode.Code) && String(taxCode.GSTType || '').trim().toUpperCase() === gstType
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
const GENERAL_SETTINGS = readGeneralSettings();
const DEFAULT_TRANSACTION_TYPES = [
  { value: 'GST Tax Invoice', label: 'GST Tax Invoice' },
  { value: 'Bill of Supply', label: 'Bill of Supply' },
  { value: 'GST Debit Memo', label: 'GST Debit Memo' },
];






const normalizeMetadataIdentity = (value) =>
  String(value || '').replace(/^U_/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

const isTransactionTypeField = (field = {}) => {
  const identities = [field.key, field.sapField, field.aliasId, field.label, field.description, field.Descr]
    .map(normalizeMetadataIdentity);
  return identities.some((identity) => [
    'transactiontype',
    'transtype',
    'documenttype',
    'doctype',
  ].includes(identity));
};

const getTransactionTypeOptions = (headerUdfDefinitions = [], fallbackOptions = DEFAULT_TRANSACTION_TYPES) => {
  const transactionTypeField = headerUdfDefinitions.find(isTransactionTypeField);
  const metadataOptions = Array.isArray(transactionTypeField?.options)
    ? transactionTypeField.options
      .map((option) => {
        const value = String(option?.value ?? option ?? '').trim();
        const label = String(option?.label ?? option?.description ?? option?.Descr ?? value).trim();
        return value ? { value, label: label || value } : null;
      })
      .filter(Boolean)
    : [];

  return metadataOptions.length ? metadataOptions : fallbackOptions;
};

const createLine = (rowUdfDefinitions = ROW_UDF_DEFINITIONS) => ({
  itemNo: '',
  itemDescription: '',
  hsnCode: '',
  sac: '',
  quantity: '',
  openQty: '',
  uomCode: '',
  unitPrice: '',
  stdDiscount: '',
  taxCode: '',
  wtaxLiable: 'N',
  total: '',
  binLocationAllocation: '',
  glAccount: '',
  glAccountName: '',
  whse: '',
  itemCost: '',
  countryOfOrigin: '',
  distRule: '',
  loc: '',
  blanketAgreementNo: '',
  costSheet: '',
  packingType: '',
  containerType: '',
  grossWt: '',
  totalPackage: '',
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
  baseEntry: null,
  baseType: null,
  baseLine: null,
  inventoryUOM: '',
  uomFactor: 1,
  batchManaged: false,
  batches: [],
  taxCodeManuallyOverridden: false,
  udf: createUdfState(rowUdfDefinitions),
});

const INIT_HEADER = {
  vendor: '',
  name: '',
  contactPerson: '',
  salesContractNo: '',
  transactionType: '',
  currencyMode: 'BP',
  currency: '',
  exchangeRate: '',
  branch: '',
  warehouse: GENERAL_SETTINGS.apInvoiceWarehouse || '',
  docNo: '',
  status: 'Open',
  series: GENERAL_SETTINGS.apInvoiceSeries || '',
  nextNumber: '',
  postingDate: today(),
  deliveryDate: '',
  documentDate: today(),
  contractDate: '',
  branchRegNo: '',
  shipTo: '',
  shipToCode: '',
  shipToAddress: '',
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
  splitAPInvoice: false,
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
  referenceNumber: '',
  referenceDate: '',
  revision: false,
  reasonForIssuingNote: 'Sales Return',
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

const AP_INVOICE_COPY_BASE_TYPE = {
  grpo: 20,
  purchaseOrder: 22,
  apInvoice: 18,
};

const AP_INVOICE_COPY_SOURCE_LABEL = {
  grpo: 'GRPO',
  purchaseOrder: 'Purchase Order',
  apInvoice: 'A/P Invoice',
};

const getLineBaseTypeNumber = (line = {}) => {
  const parsed = Number(line.baseType ?? line.BaseType);
  return Number.isFinite(parsed) ? parsed : 0;
};
const isGrpoBasedLine = (line = {}) => getLineBaseTypeNumber(line) === 20;
const isPurchaseOrderBasedLine = (line = {}) => getLineBaseTypeNumber(line) === 22;
// A Goods Receipt PO and a Purchase Order both carry an open quantity that caps
// what this invoice may draw.
const isOpenQuantityBasedLine = (line = {}) => (
  isGrpoBasedLine(line) || isPurchaseOrderBasedLine(line)
);

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function APInvoice() {
  const [seriesRevision, setSeriesRevision] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();
  const workspaceRef = useRef(null);
  const { company } = useAuth();
  const activeCompanyId = company?.companyId || '';
  const { removeTask, upsertTask } = useSapWindowTaskbarActions();

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(INIT_HEADER);
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState(HEADER_UDF_DEFINITIONS);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState(ROW_UDF_DEFINITIONS);
  const [matrixColumnDefinitions, setMatrixColumnDefinitions] = useState(BASE_MATRIX_COLUMNS);
  const [lines, setLines] = useState([createLine(ROW_UDF_DEFINITIONS)]);
  const [attachments] = useState(INIT_ATTACH);
  const [activeTab, setActiveTab] = useState('Contents');
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
    company_currency: '',
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
    withholding_tax_codes: [],
    payment_terms: [],
    gl_accounts: [],
    distribution_rules: [],
    business_partners: [],
    shipping_types: [],
    branches: [],
    uom_groups: [],
    locations: [],
    decimal_settings: DEC,
    udf_metadata: { header: [], rows: [] },
    warnings: [],
    series: [],
    states: [],
    transaction_types: [],
    transactionTypes: [],
  });
  const [pageState, setPageState] = useState({
    loading: false,
    vendorLoading: false,
    posting: false,
    seriesLoading: false,
    error: '',
    success: '',
  });
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
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, items: [], loading: false });
  const [batchModal, setBatchModal] = useState({ open: false, lineIndex: null, loading: false, error: '' });
  const [lineLookupModal, setLineLookupModal] = useState({
    open: false,
    lineIndex: -1,
    field: '',
    udfKey: '',
    title: '',
    options: [],
    searchPlaceholder: 'Search values',
    emptyMessage: 'No values found',
    columns: null,
  });
  const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1, fieldName: 'hsnCode', udfKey: '' });
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
  const [withholdingTax, setWithholdingTax] = useState({
    open: false,
    vendorSubject: false,
    defaultCode: '',
    allowedCodes: [],
    rows: [],
  });
  const [bpModal, setBpModal] = useState(false);
  const [stateModal, setStateModal] = useState(false);
  const [copyFromModal, setCopyFromModal] = useState(false);
  const [copyFromDocType, setCopyFromDocType] = useState('grpo');
  const [addressForm, setAddressForm] = useState({
    streetPoBox: '', streetNo: '', buildingFloorRoom: '', block: '', city: '', zipCode: '', county: '',
    state: '', countryRegion: '', addressName2: '', addressName3: '', gln: '', gstin: ''
  });
  const [taxInfoForm, setTaxInfoForm] = useState({
    panNo: '', panCircleNo: '', panWardNo: '', panAssessingOfficer: '', deducteeRefNo: '',
    lstVatNo: '', cstNo: '', tanNo: '', serviceTaxNo: '', companyType: '', natureOfBusiness: '',
    assesseeType: '', tinNo: '', itrFiling: '', gstType: '', gstin: ''
  });
  const [taxInfoDraft, setTaxInfoDraft] = useState({});

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
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  const hydrateAPInvoiceBatchLine = useCallback((line = {}) => {
    const itemCode = String(line.itemNo || line.ItemCode || '').trim();
    const item = refData.items.find((candidate) => String(candidate.ItemCode || '').trim() === itemCode);
    const grpoBased = isGrpoBasedLine(line);
    return {
      ...line,
      batchManaged: grpoBased ? false : Boolean(line.batchManaged || isYesValue(item?.BatchManaged) || isYesValue(item?.ManBtchNum)),
      batches: grpoBased ? [] : (Array.isArray(line.batches) ? line.batches : []),
      inventoryUOM: String(line.inventoryUOM || item?.InventoryUOM || line.uomCode || '').trim(),
      uomFactor: Number(line.uomFactor) > 0 ? Number(line.uomFactor) : 1,
    };
  }, [refData.items]);

  useEffect(() => {
    if (!refData.items.length) return;
    setLines((previous) => {
      let changed = false;
      const next = previous.map((line) => {
        const hydrated = hydrateAPInvoiceBatchLine(line);
        if (
          hydrated.batchManaged !== line.batchManaged
          || hydrated.inventoryUOM !== line.inventoryUOM
          || hydrated.uomFactor !== line.uomFactor
        ) changed = true;
        return hydrated;
      });
      return changed ? next : previous;
    });
  }, [hydrateAPInvoiceBatchLine, refData.items.length]);
  const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
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
    const draft = location.state?.apInvoiceDraft;
    if (!draft) return;

    setCurrentDocEntry(draft.currentDocEntry || null);
    setHeader(draft.header || INIT_HEADER);
    setLines(Array.isArray(draft.lines) && draft.lines.length
      ? draft.lines
      : [createLine(rowUdfDefinitions)]);
    setHeaderUdfs(draft.headerUdfs || createUdfState(headerUdfDefinitions));
    setActiveTab(draft.activeTab || 'Contents');
    setIsDirty(Boolean(draft.isDirty));
    setFreightModal((prev) => ({
      ...prev,
      open: false,
      freightCharges: Array.isArray(draft.freightCharges) ? draft.freightCharges : [],
      loading: false,
    }));
    if (draft.withholdingTax) {
      setWithholdingTax((prev) => ({
        ...prev,
        ...draft.withholdingTax,
        open: false,
      }));
    }
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
    apInvoiceDraft: {
      currentDocEntry,
      header,
      lines,
      headerUdfs,
      activeTab,
      isDirty,
      freightCharges: freightModal.freightCharges,
      withholdingTax: {
        vendorSubject: withholdingTax.vendorSubject,
        defaultCode: withholdingTax.defaultCode,
        allowedCodes: withholdingTax.allowedCodes,
        rows: withholdingTax.rows,
      },
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
    withholdingTax.allowedCodes,
    withholdingTax.defaultCode,
    withholdingTax.rows,
    withholdingTax.vendorSubject,
  ]);

  useDocumentDraftTask({
    buildDraftState: buildLinkedRestoreState,
    title: 'A/P Invoice',
  });

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
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        if (!activeCompanyId) {
          setHeaderUdfDefinitions([]);
          setRowUdfDefinitions([]);
          setMatrixColumnDefinitions([]);
          setHeaderUdfs({});
          setHeader(INIT_HEADER);
          setLines([createLine([])]);
          setRefData(prev => ({
            ...prev,
            company: '',
            company_state: '',
            company_currency: '',
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
            withholding_tax_codes: [],
            payment_terms: [],
            gl_accounts: [],
            distribution_rules: [],
            business_partners: [],
            shipping_types: [],
            sales_employees: [],
            branches: [],
            states: [],
            locations: [],
            transaction_types: [],
            transactionTypes: [],
            uom_groups: [],
            udf_metadata: { header: [], rows: [] },
            warnings: [],
            series: [],
          }));
          return;
        }

        const [refDataRes, layoutRes, schema] = await Promise.all([
          fetchAPInvoiceReferenceData(activeCompanyId),
          getDocumentLayout({
            companyDb: company?.dbName || undefined,
            documentType: 'AP_INVOICE',
          }).catch((error) => ({
            data: { source: 'fallback', columns: [], warning: getErrMsg(error, 'Failed to load SAP layout.') },
          })),
          fetchSalesDocumentSchema({ documentType: 'AP_INVOICE' }).catch(() => null),
        ]);

        if (!ignore) {
          const liveFields = buildSalesDocumentLiveFields({
            schema,
            documentType: 'AP_INVOICE',
            objectType: '18',
            headerTable: 'OPCH',
            lineTable: 'PCH1',
            companyId: activeCompanyId,
            companyDb: company?.dbName || '',
            layoutResponse: layoutRes,
            referenceMatrixColumns: refDataRes.data.line_field_metadata?.matrix_columns || BASE_MATRIX_COLUMNS,
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
          setLines((prev) => prev.map((line) => hydratePurchaseOrderLineUdfFields({
            ...line,
            udf: createUdfState(nextRowUdfs, line.udf || {}),
          })));
          const nextDefaults = readSavedFormSettings(
            nextHeaderUdfs,
            nextRowUdfs,
            nextMatrixColumns,
            formSettingsStorageKey,
          );
          replaceFormSettings(nextDefaults);

          setRefData({
            company: refDataRes.data.company || '',
            company_state: refDataRes.data.company_state || '',
            company_currency: refDataRes.data.company_currency || '',
            local_currency: refDataRes.data.local_currency || refDataRes.data.company_currency || '',
            system_currency: refDataRes.data.system_currency || refDataRes.data.company_currency || '',
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
            withholding_tax_codes: refDataRes.data.withholding_tax_codes || [],
            payment_terms: refDataRes.data.payment_terms || [],
            gl_accounts: refDataRes.data.gl_accounts || [],
            distribution_rules: refDataRes.data.distribution_rules || [],
            business_partners: refDataRes.data.business_partners || [],
            shipping_types: refDataRes.data.shipping_types || [],
            sales_employees: refDataRes.data.sales_employees || [],
            branches: refDataRes.data.branches || [],
            states: refDataRes.data.states || [],
            locations: refDataRes.data.locations || [],
            transaction_types: refDataRes.data.transaction_types || [],
            transactionTypes: refDataRes.data.transactionTypes || [],
            uom_groups: refDataRes.data.uom_groups || [],
            decimal_settings: { ...DEC, ...(refDataRes.data.decimal_settings || {}) },
            udf_metadata: refDataRes.data.udf_metadata || { header: [], rows: [] },
            warnings: [
              ...(refDataRes.data.warnings || []),
              ...(layoutRes?.data?.warning ? [layoutRes.data.warning] : []),
            ],
            series: [],
          });
        }
        console.log("FULL REF DATA:", refDataRes.data);
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load reference data.') }));
      } finally {
        if (!ignore) setPageState(p => ({ ...p, loading: false }));
      }
    };
    load();
    return () => { ignore = true; };
  }, [activeCompanyId, company?.dbName, formSettingsStorageKey]);

  // â”€â”€ load existing order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const docEntry = location.state?.APInvoiceDocEntry;
    if (!docEntry) return;
    let ignore = false;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        const r = await fetchAPInvoiceByDocEntry(docEntry);
        const po = r.data.apInvoice;
        if (ignore || !po) return;
        setCurrentDocEntry(po.doc_entry || Number(docEntry));
        setHeader(prev => ({
          ...prev,
          ...INIT_HEADER,
          ...(po.header || {}),
        }));

        setLines(
          Array.isArray(po.lines) && po.lines.length
            ? po.lines.map(l => hydratePurchaseOrderLineUdfFields({
              ...createLine(rowUdfDefinitions),
              ...l,
              taxCodeManuallyOverridden: true,
              udf: { ...createUdfState(rowUdfDefinitions), ...(l.udf || {}) },
            }))
            : [createLine(rowUdfDefinitions)]
        );
        const savedWithholdingRows = Array.isArray(po.withholding_tax_rows)
          ? po.withholding_tax_rows
          : (Array.isArray(po.withholdingTaxRows) ? po.withholdingTaxRows : []);
        setWithholdingTax((prev) => ({
          ...prev,
          open: false,
          vendorSubject: savedWithholdingRows.length > 0 || prev.vendorSubject,
          rows: savedWithholdingRows,
        }));
        setHeaderUdfs({ ...createUdfState(headerUdfDefinitions), ...(po.header_udfs || {}) });
        setSnapshotPending(true);
        setIsDirty(false);
        if (po.header?.vendor) {
          loadVendorDetails(po.header.vendor, {
            preserveWithholdingRows: true,
            savedWithholdingRows,
          });
        }
        setPageState(p => ({ ...p, success: po.doc_num ? `A/P Invoice ${po.doc_num} loaded.` : 'A/P Invoice loaded.' }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load A/P Invoice.') }));
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
    const routedCopyFrom = location.state?.copyFrom;
    const persistedCopyState = routedCopyFrom ? null : consumeCopyToState(location.pathname, ['/ap-invoice']);
    const copyFrom = routedCopyFrom || persistedCopyState?.copyFrom;
    if (!copyFrom) return;

    const sourceType = copyFrom.type || 'grpo';
    const normalizedHeader = { ...normaliseDocumentHeader(copyFrom.header || {}) };
    // The vendor reference on an invoice is the vendor's own invoice number, so
    // it is never inherited from the receipt or order it is drawn from.
    if (sourceType === 'grpo' || sourceType === 'purchaseOrder') {
      normalizedHeader.salesContractNo = '';
      normalizedHeader.customerRefNo = '';
    }
    const sourceLines = Array.isArray(copyFrom.lines) ? copyFrom.lines : [];
    const copiedLines = sourceLines.map((line, index) => {
      const normalizedLine = normaliseDocumentLine(
        line,
        index,
        line.baseEntry ?? copyFrom.baseDocument?.baseEntry ?? copyFrom.docEntry,
        line.baseType ?? copyFrom.baseDocument?.baseType ?? AP_INVOICE_COPY_BASE_TYPE[sourceType] ?? 20,
        line.branch || normalizedHeader.branch
      );
      const openQty = String(line.openQty ?? line.OpenQty ?? normalizedLine.openQty ?? line.quantity ?? line.Quantity ?? '');
      const copiedQuantity = isOpenQuantityBasedLine(normalizedLine) && parseNum(openQty) > 0
        ? openQty
        : normalizedLine.quantity;

      return hydratePurchaseOrderLineUdfFields({
        ...createLine(rowUdfDefinitions),
        ...normalizedLine,
        quantity: copiedQuantity,
        openQty,
        batchManaged: isGrpoBasedLine(normalizedLine) ? false : normalizedLine.batchManaged,
        batches: isGrpoBasedLine(normalizedLine) ? [] : normalizedLine.batches,
        udf: { ...createUdfState(rowUdfDefinitions), ...(line.udf || {}) },
      });
    });

    setHeader((prev) => ({ ...prev, ...normalizedHeader }));
    setLines(copiedLines.length ? copiedLines : [createLine(rowUdfDefinitions)]);
    setFreightModal({ open: false, freightCharges: Array.isArray(copyFrom.freightCharges) ? copyFrom.freightCharges : [], loading: false });
    setWithholdingTax((prev) => ({ ...prev, open: false, rows: [] }));
    setValErrors({ header: {}, lines: {}, form: '' });

    if (normalizedHeader.vendor) {
      loadVendorDetails(normalizedHeader.vendor);
    }

    const label = AP_INVOICE_COPY_SOURCE_LABEL[sourceType] || 'GRPO';
    setPageState((prev) => ({ ...prev, error: '', success: `Copied from ${label}. Please review and save.` }));
    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
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
  const vendorContacts = refData.contacts.filter(c => String(c.CardCode || '') === String(header.vendor || ''));
  const contactOptions = header.contactPerson && !vendorContacts.some(c => String(c.CntctCode || '') === String(header.contactPerson || ''))
    ? [{ CardCode: header.vendor, CntctCode: header.contactPerson, Name: header.contactPerson }, ...vendorContacts]
    : vendorContacts;
  const vendorPayToAddresses = refData.pay_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorShipToAddresses = refData.ship_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorBillToAddresses = refData.bill_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorEffectiveShipToAddresses = vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses;
  const vendorEffectiveBillToAddresses = vendorBillToAddresses.length ? vendorBillToAddresses : vendorPayToAddresses;
  const selectedWarehouse = refData.warehouses.find(
    (warehouse) => String(warehouse.WhsCode || '') === String(header.warehouse || ''),
  );
  const autoBillToAddressRef = useRef('');
  const buyerBillToAddress = useMemo(() => resolveBuyerBillToAddress({
    warehouse: selectedWarehouse,
    companyAddress: refData.company_address,
    formatAddress: fmtAddr,
  }), [refData.company_address, selectedWarehouse]);

  const payTermOpts = refData.payment_terms.length
    ? refData.payment_terms.map(t => ({ value: String(t.GroupNum), label: t.PymntGroup }))
    : [{ value: 'Net 30', label: 'Net 30' }, { value: 'Net 60', label: 'Net 60' }];

  const shipTypeOpts = refData.shipping_types.length
    ? refData.shipping_types.map(s => ({ value: String(s.TrnspCode), label: s.TrnspName }))
    : [{ value: 'Air', label: 'Air' }, { value: 'Sea', label: 'Sea' }, { value: 'Road', label: 'Road' }];

  const transactionTypeOptions = useMemo(
    () => getTransactionTypeOptions(headerUdfDefinitions),
    [headerUdfDefinitions],
  );

  useEffect(() => {
    if (currentDocEntry || header.transactionType || !transactionTypeOptions.length) return;
    const firstOption = transactionTypeOptions[0];
    setHeader((prev) => ({
      ...prev,
      transactionType: firstOption.value,
      indicator: firstOption.indicator || prev.indicator,
    }));
  }, [currentDocEntry, header.transactionType, transactionTypeOptions]);



  const lineItemOptions = lines.reduce((acc, line, i) => {
    const code = String(line.itemNo || '').trim();
    const exists = refData.items.some(it => String(it.ItemCode || '') === code);
    acc[i] = code && !exists ? [{ ItemCode: code, ItemName: line.itemDescription || code }, ...refData.items] : refData.items;
    return acc;
  }, {});
  const accountLookupOptions = useMemo(() => (refData.gl_accounts || []).map((account) => ({
    value: account.code || account.AcctCode || '',
    description: account.name || account.AcctName || '',
    label: (account.name || account.AcctName) ? `${account.code || account.AcctCode} - ${account.name || account.AcctName}` : (account.code || account.AcctCode),
    accountNumber: account.code || account.AcctCode || '',
    accountName: account.name || account.AcctName || '',
    accountBalance: Number(account.balance || account.Balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
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
  const locationLookupOptions = useMemo(
    () => buildLocationLookupOptions(refData.locations || []),
    [refData.locations]
  );
  const paymentTermLookupOptions = useMemo(() => (refData.payment_terms || []).map((term) => {
    const value = term.GroupNum != null ? String(term.GroupNum) : String(term.code || term.value || '');
    const description = term.PymntGroup || term.name || term.description || '';
    return {
      value,
      description,
      label: description ? `${value} - ${description}` : value,
      paymentTermCode: value,
      paymentTermName: description,
    };
  }).filter((option) => option.value), [refData.payment_terms]);
  const itemLookupOptions = useMemo(() => (refData.items || []).map((item) => ({
    value: item.ItemCode || '',
    description: item.ItemName || '',
    label: item.ItemName ? `${item.ItemCode} - ${item.ItemName}` : item.ItemCode,
    itemCode: item.ItemCode || '',
    itemName: item.ItemName || '',
    purchaseUnit: item.PurchaseUnit || item.InventoryUOM || '',
  })).filter((option) => option.value), [refData.items]);
  const getUdfLookupOptions = useCallback((fieldNames = []) => {
    const names = new Set(fieldNames.map(normalizeMetadataIdentity));
    const field = (rowUdfDefinitions || []).find((definition) => {
      const identities = [
        definition.key,
        definition.sapField,
        definition.aliasId,
        definition.label,
        definition.description,
        definition.Descr,
      ].map(normalizeMetadataIdentity);
      return identities.some((identity) => names.has(identity));
    });
    return (field?.options || []).map((option) => {
      const value = String(option?.value ?? option ?? '').trim();
      const description = String(option?.label ?? option?.description ?? option?.Descr ?? '').trim();
      return value ? {
        value,
        description,
        label: description ? `${value} - ${description}` : value,
      } : null;
    }).filter(Boolean);
  }, [rowUdfDefinitions]);

  const FALLBACK_WAREHOUSES = [{ WhsCode: 'WH01', WhsName: 'Main Warehouse' }];

  const effectiveTaxCodes = refData.tax_codes || [];
  const effectiveWarehouses = refData.warehouses.length ? refData.warehouses : FALLBACK_WAREHOUSES;
  const branchFilteredWarehouses = filterWarehousesByBranch(effectiveWarehouses, header.branch);
  const defaultBranchId = refData.branches[0]?.BPLId;
  const defaultWarehouseCode = branchFilteredWarehouses[0]?.WhsCode;
  const freightTotals = summarizeFreightRows(freightModal.freightCharges, effectiveTaxCodes);

  useEffect(() => {
    if (!header.branch && defaultBranchId != null) {
      setHeader((prev) => prev.branch ? prev : { ...prev, branch: String(defaultBranchId) });
    }
  }, [header.branch, defaultBranchId]);

  useEffect(() => {
    if (!header.warehouse && defaultWarehouseCode) {
      setHeader((prev) => prev.warehouse ? prev : { ...prev, warehouse: defaultWarehouseCode });
    }
  }, [header.warehouse, defaultWarehouseCode]);

  const getBranchName = (branchId) => {
    if (!branchId) return '';
    const branch = refData.branches.find(b => String(b.BPLId) === String(branchId));
    return branch ? branch.BPLName : branchId;
  };

  const getUomOptions = useCallback((line) => {
    const item = refData.items.find(i => String(i.ItemCode || '') === String(line.itemNo || ''));
    return getLineUomOptions(line, item, refData.uom_groups).map((uom) => uom.uomCode);
  }, [refData.items, refData.uom_groups]);

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

  // â”€â”€ calculations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const rounding = calculateDocumentRounding(
      discSub + freight + taxAmt,
      header.rounding,
      numDec.totalPaymentDue, (currentDocEntry || header.roundingAmountIsManual) ? header : null, getDocumentRoundingPolicy(refData, header));
    return { subtotal, discAmt, discSub, freight, freightTaxAmt, taxAmt, ...rounding, taxBreakdown: Array.from(taxMap.values()) };
  };

  const totals = calcTotals();
  useRelationshipMapRegistration({
    enabled: Boolean(currentDocEntry),
    objectType: 18,
    docEntry: currentDocEntry,
    header,
    total: totals.total,
  });
  const hasWTaxLiableLines = lines.some((line) => isYesValue(line.wtaxLiable || line.wTaxLiable));
  const hasSavedWithholdingTax = withholdingTax.rows.length > 0 || parseNum(header.wtaxAmount) !== 0;
  const showWithholdingTax = hasWTaxLiableLines || hasSavedWithholdingTax;
  const wtaxBaseAmount = {
    netAmount: roundTo(totals.discSub + totals.freight, numDec.total),
    taxAmount: totals.taxAmt,
    grossAmount: totals.total,
  };
  const recalcWithholdingRows = useCallback((rows = withholdingTax.rows, baseAmount = wtaxBaseAmount) => (
    (rows || []).map((row) => {
      const rate = parseNum(row.rate);
      const resolvedBaseAmount = resolveWithholdingTaxBaseAmount(row, baseAmount, numDec.total);
      return {
        ...row,
        baseAmount: resolvedBaseAmount,
        taxableAmount: resolvedBaseAmount,
        wtaxAmount: roundTo(resolvedBaseAmount * rate / 100, numDec.tax),
        tdsRate: row.tdsRate ?? rate,
        tdsBaseAmount: resolvedBaseAmount,
        tdsTaxAmount: roundTo(resolvedBaseAmount * rate / 100, numDec.tax),
        category: row.category || 'Invoice',
        baseType: row.baseType || 'Net',
        criteria: row.criteria || 'Cash',
        tdsType: row.tdsType || 'eTDS',
      };
    })
  ), [numDec.tax, numDec.total, withholdingTax.rows, wtaxBaseAmount]);
  const createDefaultWithholdingRows = useCallback((baseAmount = wtaxBaseAmount) => {
    const allowedCodes = withholdingTax.allowedCodes || [];
    const defaultCode = withholdingTax.defaultCode || allowedCodes[0]?.code || '';
    const codeRow = allowedCodes.find((row) => String(row.code || '') === String(defaultCode || '')) || allowedCodes[0];
    if (!codeRow) return [];

    const rate = parseNum(codeRow.rate);
    const rowDefaults = {
      baseTypeCode: codeRow.baseTypeCode || 'N',
      baseType: codeRow.baseType || 'Net',
      basePercentage: codeRow.basePercentage ?? 100,
    };
    const resolvedBaseAmount = resolveWithholdingTaxBaseAmount(rowDefaults, baseAmount, numDec.total);
    return [{
      code: codeRow.code || '',
      name: codeRow.name || '',
      rate,
      baseAmount: resolvedBaseAmount,
      taxableAmount: resolvedBaseAmount,
      wtaxAmount: roundTo(resolvedBaseAmount * rate / 100, numDec.tax),
      category: codeRow.taxCategory || 'Invoice',
      ...rowDefaults,
      categoryCode: codeRow.taxCategory || 'I',
      criteria: 'Cash',
      criteriaCode: 'C',
      tdsType: codeRow.tdsType || 'eTDS',
      tdsTypeCode: codeRow.tdsTypeCode || 'E',
      tdsAccount: codeRow.tdsAccount || codeRow.account || '',
      surchargeAccount: codeRow.surchargeAccount || '',
      cessAccount: codeRow.cessAccount || '',
      hscAccount: codeRow.hscAccount || '',
      igstAccount: codeRow.igstAccount || '',
      cgstAccount: codeRow.cgstAccount || '',
      sgstAccount: codeRow.sgstAccount || '',
      utgstAccount: codeRow.utgstAccount || '',
      cessGstAccount: codeRow.cessGstAccount || '',
      tdsRate: codeRow.tdsRate ?? rate,
      surchargeRate: codeRow.surchargeRate ?? 0,
      cessRate: codeRow.cessRate ?? 0,
      hscRate: codeRow.hscRate ?? 0,
      igstRate: codeRow.igstRate ?? 0,
      cgstRate: codeRow.cgstRate ?? 0,
      sgstRate: codeRow.sgstRate ?? 0,
      utgstRate: codeRow.utgstRate ?? 0,
      cessGstRate: codeRow.cessGstRate ?? 0,
      tdsBaseAmount: resolvedBaseAmount,
      surchargeBaseAmount: 0,
      cessBaseAmount: 0,
      hscBaseAmount: 0,
      igstBaseAmount: 0,
      cgstBaseAmount: 0,
      sgstBaseAmount: 0,
      utgstBaseAmount: 0,
      cessGstBaseAmount: 0,
      tdsTaxAmount: roundTo(resolvedBaseAmount * rate / 100, numDec.tax),
      surchargeTaxAmount: 0,
      cessTaxAmount: 0,
      hscTaxAmount: 0,
      igstTaxAmount: 0,
      cgstTaxAmount: 0,
      sgstTaxAmount: 0,
      utgstTaxAmount: 0,
      cessGstTaxAmount: 0,
    }];
  }, [numDec.tax, numDec.total, withholdingTax.allowedCodes, withholdingTax.defaultCode, wtaxBaseAmount]);
  const wtaxRowsForTotals = showWithholdingTax
    ? (currentDocEntry && withholdingTax.rows.length
      ? withholdingTax.rows
      : recalcWithholdingRows(withholdingTax.rows.length ? withholdingTax.rows : createDefaultWithholdingRows()))
    : [];
  const withholdingModalRows = withholdingTax.open
    ? (currentDocEntry && withholdingTax.rows.length
      ? withholdingTax.rows
      : recalcWithholdingRows(withholdingTax.rows.length ? withholdingTax.rows : createDefaultWithholdingRows()))
    : wtaxRowsForTotals;
  const calculatedWTaxAmount = wtaxRowsForTotals.reduce((sum, row) => sum + parseNum(row.wtaxAmount), 0);
  const wtaxAmount = roundTo(
    currentDocEntry && calculatedWTaxAmount === 0
      ? parseNum(header.wtaxAmount)
      : calculatedWTaxAmount,
    numDec.tax
  );
  const totalPaymentDueAfterWTax = roundTo(totals.total - wtaxAmount, numDec.totalPaymentDue);
  const derivedGstType = getDerivedGstType(header.vendorState, header.placeOfSupply);
  const inferredGstType = formatDerivedGstType(derivedGstType);

  const openLineLookup = (column, lineIndex, udfField = null) => {
    if (!isDocumentEditable) return;
    const fieldName = typeof column === 'string' ? column : column?.key;
    if (!fieldName) return;
    const isAccount = fieldName === 'glAccount';
    const isDistributionRule = fieldName === 'distRule';
    const isLocation = fieldName === 'loc' || column?.lookup === 'location';
    const isPaymentTerms = fieldName === 'buyerPaymentTerms' || fieldName === 'sellerPaymentTerms';
    const isSellerItem = fieldName === 'sellerItem';
    const isStCode = fieldName === 'stcode';
    const udfOptionsByField = {
      costSheet: getUdfLookupOptions(['CostSheet', 'Cost Sheet', 'Cost-Sheet', 'U_Cost_Sheet']),
      packingType: getUdfLookupOptions(['PackingType', 'Packing Type', 'Packing-Type', 'U_PackingType']),
      containerType: getUdfLookupOptions(['ContainerType', 'Container Type', 'U_ContainerType']),
      stcode: getUdfLookupOptions(['STCODE', 'StatisticalCode', 'Statistical Code', 'U_STCODE']),
      blanketAgreementNo: getUdfLookupOptions(['BlanketAgreementNo', 'Blanket Agreement No']),
    };
    const options = isAccount
      ? accountLookupOptions
      : isDistributionRule
        ? distributionRuleLookupOptions
        : isLocation
          ? locationLookupOptions
          : isPaymentTerms
            ? paymentTermLookupOptions
            : isSellerItem
              ? itemLookupOptions
              : udfOptionsByField[fieldName] || [];

    setLineLookupModal({
      open: true,
      lineIndex,
      field: fieldName,
      udfKey: udfField?.key || '',
      title: isAccount ? 'List of G/L Accounts'
        : isDistributionRule ? 'List of Distribution Rules'
        : isLocation ? 'List of Locations'
        : isPaymentTerms ? 'List of Payment Terms'
        : isSellerItem ? 'List of Items'
        : isStCode ? 'List of Statistical Codes'
        : `List of ${column?.label || fieldName}`,
      options,
      searchPlaceholder: isAccount ? 'Search G/L accounts'
        : isDistributionRule ? 'Search distribution rules'
        : isLocation ? 'Search locations'
        : isPaymentTerms ? 'Search payment terms'
        : isSellerItem ? 'Search items'
        : 'Search values',
      emptyMessage: isAccount ? 'No G/L accounts found'
        : isDistributionRule ? 'No distribution rules found'
        : isLocation ? 'No locations found'
        : isPaymentTerms ? 'No payment terms found'
        : isSellerItem ? 'No items found'
        : 'No values found',
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
          : isLocation
            ? [
                { key: 'code', label: 'Code', width: 100, primary: true },
                { key: 'locationName', label: 'Location' },
              ]
            : isPaymentTerms
            ? [
                { key: 'paymentTermCode', label: 'Code', width: 120, primary: true },
                { key: 'paymentTermName', label: 'Payment Terms' },
              ]
            : isSellerItem
              ? [
                  { key: 'itemCode', label: 'Item No.', width: 150, primary: true },
                  { key: 'itemName', label: 'Item Description' },
                  { key: 'purchaseUnit', label: 'UoM', width: 100 },
                ]
              : null,
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
          [lineLookupModal.field]: selectedValue,
          udf: {
            ...(line.udf || {}),
            [lineLookupModal.udfKey]: selectedValue,
          },
        };
      }

      const next = { ...line, [lineLookupModal.field]: selectedValue };
      if (lineLookupModal.field === 'glAccount') {
        next.glAccountName = option?.accountName || option?.description || '';
      }
      if (lineLookupModal.field === 'sellerItem') {
        next.sellerItem = selectedValue;
      }
      return next;
    }));
    markDirty();
    closeLineLookup();
  };

  // â”€â”€ GST Logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const applyGstLogic = useCallback(async () => {
    if (!derivedGstType) {
      return;
    }

    setLines(prevLines => prevLines.map(line => {
      if (!line.itemNo || line.taxCodeManuallyOverridden) {
        return line;
      }

      const defaultTax = findPreferredGstTaxCode({
        taxCodes: refData.tax_codes,
        gstType: derivedGstType,
        currentTaxCode: line.taxCode,
      });
      if (!defaultTax?.Code || String(line.taxCode || '') === String(defaultTax.Code)) {
        return line;
      }

      return { ...line, taxCode: defaultTax.Code };
    }));
  }, [derivedGstType, refData.tax_codes]);

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

  useEffect(() => {
    if (!buyerBillToAddress.address) return;
    const previousDefaultAddress = autoBillToAddressRef.current;
    autoBillToAddressRef.current = buyerBillToAddress.address;
    setHeader(prev => {
      const currentAddress = prev.billToAddress || prev.billTo || '';
      if (currentAddress && currentAddress !== previousDefaultAddress) return prev;
      if (
        prev.billToCode === buyerBillToAddress.code
        && prev.billTo === buyerBillToAddress.address
        && prev.billToAddress === buyerBillToAddress.address
      ) return prev;
      return {
        ...prev,
        billToCode: buyerBillToAddress.code || prev.billToCode || '',
        billTo: buyerBillToAddress.address,
        billToAddress: buyerBillToAddress.address,
      };
    });
  }, [buyerBillToAddress]);

  useEffect(() => {
    const shouldAutoPopulateAddresses = true;
    if (!shouldAutoPopulateAddresses) return;
    if (!header.vendor) return;
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
      const nextPlaceOfSupply = def.State || prev.placeOfSupply || '';
      if (prev.shipToCode === def.Address && prev.shipTo === fmt && prev.placeOfSupply === nextPlaceOfSupply) return prev;
      return { ...prev, shipToCode: def.Address || '', shipTo: fmt, placeOfSupply: nextPlaceOfSupply };
    });
  }, [header.vendor, vendorEffectiveShipToAddresses]);

  useEffect(() => {
    const shouldAutoPopulateAddresses = true;
    if (!shouldAutoPopulateAddresses) return;
    if (!header.vendor) return;
    setHeader(prev => {
      const existing = vendorEffectiveBillToAddresses.find(a => String(a.Address || '') === String(prev.payToCode || ''));
      if (existing) return prev;
      const def = vendorEffectiveBillToAddresses[0];
      if (!def) return prev;
      const fmt = fmtAddr(def);
      if (prev.payToCode === def.Address && prev.payTo === fmt) return prev;
      return { ...prev, payToCode: def.Address || '', payTo: fmt, payToAddress: fmt };
    });
  }, [header.vendor, vendorEffectiveBillToAddresses]);

  // â”€â”€ vendor details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadVendorDetails = async (code, options = {}) => {
    const preserveWithholdingRows = Boolean(options.preserveWithholdingRows);
    const savedWithholdingRows = Array.isArray(options.savedWithholdingRows)
      ? options.savedWithholdingRows
      : [];
    if (!code) {
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setHeader(prev => ({ ...prev, gstin: '', vendorState: '', gstType: '', allowGstOverride: false }));
      setWithholdingTax({ open: false, vendorSubject: false, defaultCode: '', allowedCodes: [], rows: [] });
      return;
    }

    setPageState(p => ({ ...p, vendorLoading: true }));

    try {
      const r = await fetchAPInvoiceVendorDetails(code);
      const contacts = r.data.contacts || [];
      const payToAddresses = r.data.pay_to_addresses || [];
      const shipToAddresses = r.data.ship_to_addresses || [];
      const billToAddresses = r.data.bill_to_addresses || [];
      const primaryTaxAddress = payToAddresses[0] || billToAddresses[0] || shipToAddresses[0] || contacts[0] || {};
      const gstin = String(r.data.gstin || primaryTaxAddress.GSTIN || primaryTaxAddress.gstin || '').trim();
      const vendorState = String(r.data.vendorState || primaryTaxAddress.State || primaryTaxAddress.state || '').trim();
      const vendorWithholdingTax = r.data.withholding_tax || {};
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
      setWithholdingTax((prev) => ({
        open: false,
        vendorSubject: Boolean(vendorWithholdingTax.subject) || savedWithholdingRows.length > 0,
        defaultCode: vendorWithholdingTax.defaultCode || '',
        allowedCodes: vendorWithholdingTax.allowedCodes || [],
        rows: preserveWithholdingRows
          ? (savedWithholdingRows.length ? savedWithholdingRows : prev.rows)
          : [],
      }));
    } catch (err) {
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setHeader(prev => ({ ...prev, gstin: '', vendorState: '', gstType: '', allowGstOverride: false, contactPerson: '' }));
      setWithholdingTax((prev) => ({
        open: false,
        vendorSubject: preserveWithholdingRows && (savedWithholdingRows.length > 0 || prev.rows.length > 0),
        defaultCode: '',
        allowedCodes: [],
        rows: preserveWithholdingRows
          ? (savedWithholdingRows.length ? savedWithholdingRows : prev.rows)
          : [],
      }));
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
        currencyMode: 'BP',
        currency: m.Currency && m.Currency !== '##'
          ? m.Currency
          : (hdr.currency || refData.local_currency || refData.company_currency || ''),
        exchangeRate: '',
        paymentTerms: m.GroupNum != null ? String(m.GroupNum) : hdr.paymentTerms,
        contactPerson: '',
        shipTo: '',
        shipToCode: '',
        payTo: '',
        payToCode: '',
        placeOfSupply: '',
        gstin: '',
        vendorState: '',
        gstType: '',
        allowGstOverride: false,
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

    if (name === 'transactionType') {
      const selectedOption = transactionTypeOptions.find((option) => String(option.value) === String(value));
      setHeader((prev) => ({
        ...prev,
        transactionType: value,
        indicator: selectedOption?.indicator || prev.indicator,
        series: '',
        nextNumber: '',
      }));
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
    const selectedAddress = vendorEffectiveShipToAddresses.find(a => String(a.Address || '') === selectedCode)
      || vendorEffectiveBillToAddresses.find(a => String(a.Address || '') === selectedCode);

    setHeader(prev => ({
      ...prev,
      shipToCode: selectedCode,
      shipTo: fmtAddr(selectedAddress),
      placeOfSupply: selectedAddress?.State || prev.placeOfSupply || '',
    }));
  };

  const handleLineChange = (i, e) => {
    const { name, value } = e.target;
    setValErrors(p => ({ ...p, lines: { ...p.lines, [i]: { ...(p.lines[i] || {}), [name]: '' } }, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));
    setLines(prev => prev.map((line, idx) => {
      if (idx !== i) return line;
      const next = { ...line, [name]: numDec[name] !== undefined ? sanitize(value, numDec[name]) : value };
      if (name === 'uomName') next.uomNameEdited = true;

      if (name === 'taxCode') {
        next.taxCodeManuallyOverridden = true;
      }

      if (name === 'itemNo') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));
        if (item) {
          next.itemDescription = item.ItemName || next.itemDescription;
          next.hsnCode = item.HSNCode || next.hsnCode || '';
          Object.assign(next, getItemPurchaseUom(item, refData.uom_groups));
          next.glAccount = next.glAccount || item.PurchaseAccount || item.PurchaseAcct || item.ExpenseAccount || item.ExpensesAccount || item.ExpensesAc || '';
          const glAccount = accountLookupOptions.find((account) => String(account.value) === String(next.glAccount || ''));
          next.glAccountName = next.glAccountName || glAccount?.accountName || '';

          // Auto-assign default warehouse
          if (item.DefaultWarehouse) {
            next.whse = item.DefaultWarehouse;
          }
        }
        if (!next.taxCodeManuallyOverridden) {
          const preferredTaxCode = findPreferredGstTaxCode({
            taxCodes: refData.tax_codes,
            gstType: derivedGstType,
            currentTaxCode: next.taxCode,
          });
          if (preferredTaxCode?.Code) {
            next.taxCode = preferredTaxCode.Code;
          }
        }
      }
      if (name === 'uomCode') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(next.itemNo || ''));
        Object.assign(next, applyUomCodeSelection(next, value, getLineUomOptions(next, item, refData.uom_groups)));
      }

      next.total = fmtDec(calcLineTotal(next), numDec.total);
      return next;
    }));

    if (name === 'wtaxLiable' && isYesValue(value) && withholdingTax.vendorSubject) {
      setWithholdingTax((prev) => ({
        ...prev,
        open: true,
        rows: prev.rows.length ? recalcWithholdingRows(prev.rows) : createDefaultWithholdingRows(),
      }));
    }
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
        const next = { ...pastedLine };
        const pastedKeys = new Set(rowPatch.cells.map(cell => cell.key));
        if (pastedKeys.has('itemNo')) {
          const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
          if (item) {
            next.itemDescription = item.ItemName || next.itemDescription;
            next.hsnCode = item.HSNCode || next.hsnCode || '';
            Object.assign(next, getItemPurchaseUom(item, refData.uom_groups));
            next.glAccount = next.glAccount || item.PurchaseAccount || item.PurchaseAcct || item.ExpenseAccount || item.ExpensesAccount || item.ExpensesAc || '';
            if (!pastedKeys.has('whse') && item.DefaultWarehouse) next.whse = item.DefaultWarehouse;
          }
          if (!next.taxCodeManuallyOverridden) {
            const preferredTaxCode = findPreferredGstTaxCode({
              taxCodes: refData.tax_codes,
              gstType: derivedGstType,
              currentTaxCode: next.taxCode,
            });
            if (preferredTaxCode?.Code) next.taxCode = preferredTaxCode.Code;
          }
        }
        if (pastedKeys.has('uomCode')) {
          const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
          Object.assign(next, applyUomCodeSelection(next, next.uomCode, getLineUomOptions(next, item, refData.uom_groups)));
        }
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

  const openWithholdingTaxTable = useCallback(() => {
    if (!header.vendor) {
      setPageState((prev) => ({ ...prev, error: 'Select a vendor before opening withholding tax table.', success: '' }));
      return;
    }

    if (!withholdingTax.vendorSubject) {
      setPageState((prev) => ({ ...prev, error: 'Selected vendor does not have withholding tax setup.', success: '' }));
      return;
    }

    setPageState((prev) => ({ ...prev, error: '', success: '' }));
    setWithholdingTax((prev) => ({
      ...prev,
      open: true,
      rows: prev.rows.length ? recalcWithholdingRows(prev.rows) : createDefaultWithholdingRows(),
    }));
  }, [createDefaultWithholdingRows, header.vendor, recalcWithholdingRows, withholdingTax.vendorSubject]);

  const handleDocumentContextMenu = (event) => {
    event.preventDefault();
    openWithholdingTaxTable();
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
    setLines(p => p.map((l, idx) => idx === i ? { ...l, udf: { ...(l.udf || {}), [k]: v } } : l));
  };
  const updateFormSetting = (g, k, prop, val) => setFormSettings(p => ({
    ...p,
    [g]: {
      ...(p[g] || {}),
      [k]: { ...((p[g] || {})[k] || {}), [prop]: val },
    },
  }));
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
      setHeader(p => ({ ...p, shipToCode: addressCode, shipTo: '', placeOfSupply: '' }));
      return;
    }

    const addr = vendorEffectiveShipToAddresses.find(a => String(a.Address || '') === addressCode)
      || vendorEffectiveBillToAddresses.find(a => String(a.Address || '') === addressCode);
    setHeader(p => ({
      ...p,
      shipToCode: addressCode,
      shipTo: fmtAddr(addr),
      placeOfSupply: addr?.State || p.placeOfSupply || '',
    }));
  };

  // â”€â”€ Address Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openAddressModal = (type) => {
    const shipAddress = resolveAddressForModal(
      header.shipToCode,
      vendorEffectiveShipToAddresses,
      header.shipToAddress || header.shipTo,
      fmtAddr,
    );
    const payAddress = resolveAddressForModal(
      header.payToCode || header.billToCode,
      vendorEffectiveBillToAddresses,
      header.billToAddress || header.billTo || header.payTo,
      fmtAddr,
    );
    const activeAddress = type === 'payTo' || type === 'billTo' ? payAddress : shipAddress;

    setAddressForm(mapAddressToModalForm(activeAddress, {
      shipToCode: header.shipToCode || shipAddress?.Address || '',
      shipToAddress: header.shipToAddress || header.shipTo || (shipAddress ? fmtAddr(shipAddress) : ''),
      billToCode: header.billToCode || header.payToCode || payAddress?.Address || '',
      billToAddress: header.billToAddress || header.billTo || header.payTo || (payAddress ? fmtAddr(payAddress) : ''),
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
    } else {
      setHeader(p => ({ ...p, payTo: formatted, billTo: formatted, billToAddress: formatted }));
    }
    closeAddressModal();
  };

  const handleAddressFormChange = (e) => {
    const { name, value } = e.target;
    setAddressForm(p => ({ ...p, [name]: value }));
  };

  // â”€â”€ Tax Info Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openTaxInfoModal = () => {
    setTaxInfoDraft({ ...taxInfoForm });
    setTaxInfoModal(true);
  };

  const closeTaxInfoModal = () => {
    setTaxInfoModal(false);
  };

  const saveTaxInfoModal = () => {
    setTaxInfoForm({ ...taxInfoDraft });
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
    const mergedItem = mergeItemMaster(item, refData.items);
    try {
      const hsnResponse = await fetchHSNCodeFromItem(mergedItem.ItemCode);
      const hsnCode = hsnResponse.data?.hsnCode || mergedItem.HSNCode || '';
      setLines(prev => prev.map((line, idx) => {
        if (idx !== lineIndex) return line;
        return hydrateDocumentLineFromItem(line, mergedItem, {
          side: 'purchase',
          hsnCode,
          fallbackWarehouse: header.warehouse,
          calcLineTotal,
          formatTotal: (value) => fmtDec(value, numDec.total),
        });
      }));
    } catch {
      setLines(prev => prev.map((line, idx) => {
        if (idx !== lineIndex) return line;
        return hydrateDocumentLineFromItem(line, mergedItem, {
          side: 'purchase',
          hsnCode: mergedItem.HSNCode || '',
          fallbackWarehouse: header.warehouse,
          calcLineTotal,
          formatTotal: (value) => fmtDec(value, numDec.total),
        });
      }));
    }
    closeItemModal();
  };

  const openHSNModal = (lineIndex, fieldName = 'hsnCode', udfKey = '') => {
    setHsnModal({ open: true, lineIndex, fieldName, udfKey });
  };

  const closeHSNModal = () => {
    setHsnModal({ open: false, lineIndex: -1, fieldName: 'hsnCode', udfKey: '' });
  };

  const handleHSNSelect = (hsn) => {
    const fieldName = hsnModal.fieldName || 'hsnCode';
    const code = hsn.code || hsn.Code || '';
    if (hsnModal.lineIndex >= 0) {
      setLines(prev => prev.map((line, idx) =>
        idx === hsnModal.lineIndex
          ? hsnModal.udfKey
            ? { ...line, udf: { ...(line.udf || {}), [hsnModal.udfKey]: code } }
            : { ...line, [fieldName]: code }
          : line
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

  // â”€â”€ State Selection Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openStateModal = () => setStateModal(true);
  const closeStateModal = () => setStateModal(false);

  const handleStateSelect = (state) => {
    setHeader(prev => ({ ...prev, placeOfSupply: getStateCodeValue(state, refData.states) }));
    closeStateModal();
  };

  const handleTaxInfoFormChange = (e) => {
    const { name, value } = e.target;
    setTaxInfoDraft(p => ({ ...p, [name]: value }));
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

  // â”€â”€ validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openBatchModal = useCallback((lineIndex, lineOverride = null) => {
    if (!isDocumentEditable) return;
    const line = lineOverride || lines[lineIndex];
    if (isGrpoBasedLine(line)) {
      setPageState((previous) => ({
        ...previous,
        error: 'Batch assignment is not required for an A/P Invoice copied from GRPO.',
        success: '',
      }));
      return;
    }
    if (!line?.itemNo) {
      setPageState((previous) => ({ ...previous, error: 'Select an item before allocating batches.', success: '' }));
      return;
    }
    if (!line?.whse) {
      setPageState((previous) => ({ ...previous, error: 'Select a warehouse before allocating batches.', success: '' }));
      return;
    }
    setBatchModal({ open: true, lineIndex, loading: false, error: '' });
  }, [isDocumentEditable, lines]);

  const closeBatchModal = useCallback(() => {
    setBatchModal({ open: false, lineIndex: null, loading: false, error: '' });
  }, []);

  const saveLineBatches = useCallback((nextBatches) => {
    if (batchModal.lineIndex == null) return;
    markDirty();
    setLines((previous) => previous.map((line, index) => (
      index === batchModal.lineIndex ? { ...line, batches: nextBatches } : line
    )));
    setValErrors((previous) => {
      const lineErrors = { ...(previous.lines?.[batchModal.lineIndex] || {}) };
      delete lineErrors.batches;
      return {
        ...previous,
        form: '',
        lines: { ...(previous.lines || {}), [batchModal.lineIndex]: lineErrors },
      };
    });
    setPageState((previous) => ({ ...previous, error: '', success: '' }));
    closeBatchModal();
  }, [batchModal.lineIndex, closeBatchModal, markDirty]);

  const handleCopyFrom = (data, docType) => {
    setSeriesRevision(value => value + 1);

    const copySource = unwrapCopyFromDocument(data);
    const normalizedHeader = { ...normaliseDocumentHeader(copySource.header) };
    if (docType === 'grpo' || docType === 'purchaseOrder') {
      normalizedHeader.salesContractNo = '';
      normalizedHeader.customerRefNo = '';
    }
    const rawLines = copySource.lines;
    const copiedLines = rawLines.map((line, index) => {
      const normalizedLine = normaliseDocumentLine(
        line,
        index,
        copySource.docEntry,
        AP_INVOICE_COPY_BASE_TYPE[docType] || 20,
        normalizedHeader.branch,
      );
      const openQty = String(line.OpenQty ?? line.openQty ?? normalizedLine.openQty ?? line.Quantity ?? line.quantity ?? '');
      const copiedQuantity = isOpenQuantityBasedLine(normalizedLine) && parseNum(openQty) > 0
        ? openQty
        : normalizedLine.quantity;

      return hydratePurchaseOrderLineUdfFields({
        ...createLine(rowUdfDefinitions),
        ...normalizedLine,
        quantity: copiedQuantity,
        openQty,
        batchManaged: isGrpoBasedLine(normalizedLine) ? false : normalizedLine.batchManaged,
        batches: isGrpoBasedLine(normalizedLine) ? [] : normalizedLine.batches,
        udf: { ...createUdfState(rowUdfDefinitions), ...(line.udf || {}) },
      });
    });

    setHeader((prev) => ({ ...prev, ...normalizedHeader }));
    setLines(copiedLines.length ? copiedLines : [createLine(rowUdfDefinitions)]);
    setFreightModal({ open: false, freightCharges: [], loading: false });
    setWithholdingTax((prev) => ({ ...prev, open: false, rows: [] }));

    if (normalizedHeader.vendor) {
      loadVendorDetails(normalizedHeader.vendor);
    }

    setCopyFromModal(false);
    setPageState((prev) => ({ ...prev, error: '', success: 'GRPO copied successfully.' }));
  };

  const openCopyFromModal = (docType) => {
    if (currentDocEntry) return;

    if (!String(header.vendor || '').trim()) {
      setValErrors({ header: { vendor: 'Select a vendor first.' }, lines: {}, form: '' });
      setPageState((prev) => ({ ...prev, error: '', success: '' }));
      return;
    }

    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState((prev) => ({ ...prev, error: '', success: '' }));
    setCopyFromDocType(docType);
    setCopyFromModal(true);
  };

  const fetchCopyFromDocuments = async (docType) => {
    if (docType === 'grpo') {
      const response = await fetchOpenGRPO(header.vendor);
      return response.data.orders || response.data.documents || [];
    }

    return [];
  };

  const fetchCopyFromDocumentDetails = async (docType, docEntry) => {
    if (docType === 'grpo') {
      const response = await fetchGRPOForCopy(docEntry);
      return response.data;
    }

    throw new Error(`Unsupported copy from type: ${docType}`);
  };

  const handleCopyTo = async (targetType) => {
    await copyToDocument({
      sourceDocType: 'apInvoice',
      targetType,
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: { header, lines, freightCharges: freightModal.freightCharges },
      restoreState: { APInvoiceDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
      errorMessage: 'Please save the A/P invoice first before copying to another document.',
    });
  };

  const handleDuplicate = () => {
    setSeriesRevision(value => value + 1);

    const sourceSeries = header.series;
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
      successMessage: 'A/P invoice duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      setHeader((prev) => ({ ...prev, salesContractNo: '' }));
      if (sourceSeries) {
        handleSeriesChange(sourceSeries);
      } else {
        refreshDuplicateSeries(refData.series, '', handleSeriesChange);
      }
    }
  };

  const validate = () => {
    const isUpdate = !!currentDocEntry;
    const e = { header: {}, lines: {}, form: '' };

    if (!isUpdate) {
      const vc = String(header.vendor || '').trim();
      if (!vc) { e.header.vendor = 'Select a vendor.'; e.form = 'Please correct the highlighted fields.'; return e; }
    }

    if (!String(header.postingDate || '').trim()) { e.header.postingDate = 'Posting date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (!String(header.documentDate || '').trim()) { e.header.documentDate = 'Document date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (!String(header.deliveryDate || '').trim()) { e.header.deliveryDate = 'Due date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (!isUpdate && isManualDocumentSeries(header.series) && !isValidManualDocumentNumber(header.nextNumber)) {
      e.header.nextNumber = 'Enter a positive document number for Manual series.';
      e.form = 'Please correct the highlighted fields.';
      return e;
    }
    if (String(header.deliveryDate || '').trim() && String(header.postingDate || '').trim() && header.deliveryDate < header.postingDate) {
      e.header.deliveryDate = 'Due date must be on or after posting date.';
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

      if (!l.uomCode && !isUpdate) {
        e.lines[i] = { ...(e.lines[i] || {}), uomCode: 'UoM is required' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      if ((l.unitPrice === '' || l.unitPrice == null || Number(l.unitPrice) < 0) && !isUpdate) {
        e.lines[i] = { ...(e.lines[i] || {}), unitPrice: 'Unit Price must be >= 0' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      if (!l.whse && !isUpdate) {
        e.lines[i] = { ...(e.lines[i] || {}), whse: 'Warehouse is required' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      if (!isUpdate && !isGrpoBasedLine(l) && l.batchManaged) {
        if (!Array.isArray(l.batches) || l.batches.length === 0) {
          e.lines[i] = { ...(e.lines[i] || {}), batches: 'Batch selection is mandatory for batch-managed item' };
          e.form = 'Please assign incoming batches before adding this A/P Invoice.';
          return e;
        }
        const requiredBatchQty = getRequiredBatchQty(l);
        const assignedBatchQty = sumBatchQty(l.batches);
        const inventoryUOM = l.inventoryUOM || l.uomCode || 'Base UoM';
        if (Math.abs(assignedBatchQty - requiredBatchQty) > BATCH_QTY_TOLERANCE) {
          e.lines[i] = {
            ...(e.lines[i] || {}),
            batches: `Batch quantity (${assignedBatchQty.toFixed(2)} ${inventoryUOM}) must match base quantity (${requiredBatchQty.toFixed(2)} ${inventoryUOM}).`,
          };
          e.form = 'Please correct the batch allocation.';
          return e;
        }
      }

      if (l.baseEntry != null && l.baseEntry !== '' && parseNum(l.openQty) > 0 && parseNum(l.quantity) > parseNum(l.openQty)) {
        e.lines[i] = { ...(e.lines[i] || {}), quantity: `Quantity cannot exceed open quantity ${l.openQty}` };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }
    }

    if (hasWTaxLiableLines) {
      if (!withholdingTax.vendorSubject) {
        e.form = 'Selected vendor does not have withholding tax setup.';
        return e;
      }

      if (!wtaxRowsForTotals.some((row) => String(row.code || '').trim())) {
        e.form = 'Select withholding tax code in the withholding tax table.';
        return e;
      }
    }

    return e;
  };

  // â”€â”€ submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
    docEntry: currentDocEntry, isDirty,
    state: { header, lines, headerUdfs, withholdingTax, freightCharges: freightModal.freightCharges , company_id: activeCompanyId, companyKey: formSettingsStorageKey },
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
      setPageState(p => ({ ...p, error: getFirstValidationMessage(e), success: '' }));
      if (hasWTaxLiableLines && withholdingTax.vendorSubject) {
        setWithholdingTax((prev) => ({
          ...prev,
          open: true,
          rows: prev.rows.length ? recalcWithholdingRows(prev.rows) : createDefaultWithholdingRows(),
        }));
      }
      const firstBatchErrorLineIndex = Object.entries(e.lines || {}).find(([, lineErrors]) => (
        Boolean(lineErrors?.batches)
      ))?.[0];
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
        series: isManualDocumentSeries(header.series) ? SAP_MANUAL_SERIES_VALUE : (header.series ? Number(header.series) : undefined),
        gstType: inferredGstType,
        allowGstOverride: false,
      };
      const payloadLines = lines.map((line) => ({
        ...line,
        batches: isGrpoBasedLine(line) ? [] : line.batches,
        batchManaged: isGrpoBasedLine(line) ? false : line.batchManaged,
        udf: buildPurchaseOrderLineUdfPayload(line, rowUdfDefinitions, formSettings),
      }));
      const payload = {
        company_id: activeCompanyId,
        header: prep,
        lines: payloadLines,
        freightCharges: freightModal.freightCharges,
        withholdingTaxRows: wtaxRowsForTotals,
        header_udfs: headerUdfs,
      };
      const r = currentDocEntry ? await updateAPInvoice(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitAPInvoice(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      const warningMsg = r.data.warning?.message ? ` Warning: ${r.data.warning.message}` : '';
      setSnapshotPending(false);
      setIsDirty(false);
      setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
      setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [] }));
      setWithholdingTax({ open: false, vendorSubject: false, defaultCode: '', allowedCodes: [], rows: [] });
      setValErrors({ header: {}, lines: {}, form: '' });

      if (refData.series.length > 0) {
        setHeader(prev => ({ ...prev, series: '', nextNumber: '', docNo: '' }));
      }

      setPageState(p => ({ ...p, success: `${r.data.message || 'A/P Invoice saved.'}${dn}${warningMsg}` }));
    } catch (e) {
      const responseBody = e?.response?.data || {};
      if (responseBody.code === 'BATCH_SELECTION_REQUIRED') {
        const detailLine = Array.isArray(responseBody.details?.lines) ? responseBody.details.lines[0] : null;
        const detailIndex = Number(detailLine?.lineIndex);
        const itemCode = String(detailLine?.itemCode || '').trim();
        let lineIndex = Number.isInteger(detailIndex) && detailIndex >= 0 && detailIndex < lines.length
          ? detailIndex
          : -1;
        if (lineIndex < 0 && itemCode) {
          lineIndex = lines.findIndex((line) => (
            !isGrpoBasedLine(line) && String(line.itemNo || '').trim() === itemCode
          ));
        }
        if (lineIndex >= 0) {
          const message = detailLine?.message || getErrMsg(e, 'Please assign incoming batches.');
          setValErrors((previous) => ({
            ...previous,
            form: message,
            lines: {
              ...(previous.lines || {}),
              [lineIndex]: { ...(previous.lines?.[lineIndex] || {}), batches: message },
            },
          }));
          setPageState((previous) => ({ ...previous, error: message, success: '' }));
          setActiveTab('Contents');
          window.setTimeout(() => openBatchModal(lineIndex), 0);
          return;
        }
      }
      setPageState(p => ({ ...p, error: getErrMsg(e, 'A/P Invoice submission failed.') }));
    } finally {
      setPageState(p => ({ ...p, posting: false }));
    }
  };

  const resetForm = () => {
    setSeriesRevision(value => value + 1);

    setSnapshotPending(false);
    setIsDirty(false);
    setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
    setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, error: '', success: '' }));
    setFreightModal({ open: false, freightCharges: [], loading: false });
    setWithholdingTax({ open: false, vendorSubject: false, defaultCode: '', allowedCodes: [], rows: [] });
  };

  const hasBuyerCode = Boolean(String(header.vendor || '').trim());
  const sidebarHeaderUdfDefinitions = useMemo(
    () => headerUdfDefinitions.filter((field) => !isTransactionTypeField(field)),
    [headerUdfDefinitions],
  );
  const visHdrUdfs = sidebarHeaderUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;
  const documentBodyRef = useRef(null);
  useClosedDocumentViewMode(documentBodyRef, !isDocumentEditable, [activeTab, sidebarOpen, formSettingsOpen]);

  // Continue in next message with render...

  // â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useDocumentSeries({ endpoint: '/ap-invoice', companyKey: formSettingsStorageKey, currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form
      ref={workspaceRef}
      className={`po-page sap-document-page ap-invoice-page${isRightSidebarOpen ? ' po-page--sidebar-open' : ''}`}
      onSubmit={handleSubmit}
      onChangeCapture={markDirty}
      onContextMenu={handleDocumentContextMenu}
    >

      {/* â”€â”€ Toolbar â”€â”€ */}
      <div className="po-toolbar sap-document-toolbar">
        <span className="po-toolbar__title sap-document-toolbar__title">A/P Invoice{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="po-btn po-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || formSettingsStatus.queryModeActive}>
          {primaryActionLabel}
        </button>
        <button type="button" className="po-btn sap-document-toolbar__cancel" onClick={resetForm}>Cancel</button>
        <button type="button" className="po-btn sap-document-toolbar__find" onClick={() => navigate('/ap-invoice/find')}>Find</button>
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
                openCopyFromModal('grpo');
                document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
              }}
            >
              GRPO
            </button>
          </div>
        </div>
        <div className="po-dropdown">
          <button
            type="button"
            className="po-btn"
            disabled={!currentDocEntry || formSettingsStatus.queryModeActive}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
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
                handleCopyTo('apCreditMemo');
                document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
              }}
            >
              A/P Credit Memo
            </button>
          </div>
        </div>
        {currentDocEntry && (
          <button type="button" className="po-btn sap-document-toolbar__duplicate" onClick={handleDuplicate} disabled={formSettingsStatus.queryModeActive}>
            Duplicate
          </button>
        )}
        <PurchasePrintLayoutActions
          documentKey="apInvoice"
          docEntry={currentDocEntry}
          docNumber={header.docNo}
          disabled={pageState.posting || pageState.loading}
          onSuccess={(message) => setPageState(p => ({ ...p, error: '', success: message }))}
          onError={(message) => setPageState(p => ({ ...p, error: message, success: '' }))}
        />
        <JournalEntryPreviewButton
          documentType="apInvoice"
          documentLabel="A/P Invoice"
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
              <div className="po-field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>

                {/* LEFT â€” Vendor info */}
                <div style={{ borderRight: '2px solid #e0e6ed', paddingRight: 16 }}>
                  <div className="po-field">
                    <label className="po-field__label">Vendor *</label>
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
                      {!currentDocEntry && (
                        <button type="button" onClick={openBpModal} style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }} title="Select Vendor">...</button>
                      )}
                    </div>
                    {valErrors.header.vendor && <span className="po-error-feedback">{valErrors.header.vendor}</span>}
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Name</label>
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
                  <div className="po-field">
                    <label className="po-field__label">Transaction Type</label>
                    <select
                      name="transactionType"
                      className="po-field__select"
                      value={header.transactionType || ''}
                      onChange={handleHeaderChange}
                      disabled={!isDocumentEditable || !transactionTypeOptions.length}
                    >
                      {transactionTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Supplier Invoice No.</label>
                    <input name="salesContractNo" className="po-field__input" value={header.salesContractNo} onChange={handleHeaderChange} />
                  </div>
                  <DocumentCurrencySelect
                    classPrefix="po"
                    header={header}
                    onHeaderChange={handleHeaderChange}
                    businessPartners={refData.vendors || []}
                    currencyOptions={refData.currencies || []}
                    localCurrency={refData.local_currency || refData.company_currency || ''}
                    systemCurrency={refData.system_currency || refData.local_currency || ''}
                    fallbackLocalCurrency=""
                    disabled={!header.vendor || Boolean(currentDocEntry)}
                  />
                  <div className="po-field">
                    <label className="po-field__label">Place of Supply</label>
                    <div style={{ display: 'flex', gap: 2 }}>
                      <input 
                        name="placeOfSupply" 
                        className={`po-field__input${valErrors.header.placeOfSupply ? ' po-field__input--error' : ''}`} 
                        value={getStateDisplayName(header.placeOfSupply, refData.states)} 
                        onChange={handleHeaderChange} 
                        style={{ flex: 1 }} 
                        placeholder="Select State"
                      />
                      <button type="button" onClick={openStateModal} style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }} title="Select State">...</button>
                    </div>
                    {valErrors.header.placeOfSupply && <span className="po-error-feedback">{valErrors.header.placeOfSupply}</span>}
                    {!pageState.vendorLoading && header.vendor && !header.gstin && (
                      <div className="po-alert po-alert--warning" style={{ margin: '4px 0 0', padding: '3px 8px', fontSize: 11 }}>GSTIN missing - please verify tax calculation</div>
                    )}
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Ship From</label>
                    <select name="shipToCode" className="po-field__select" value={header.shipToCode || ''} onChange={handleHeaderChange} disabled={!header.vendor}>
                      <option value="">Select</option>
                      {vendorEffectiveShipToAddresses.map((address) => (
                        <option key={address.Address} value={address.Address}>{address.Address}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* RIGHT â€” Document info */}
                <div style={{ paddingLeft: 16 }}>
                  <div className="po-field">
                    <label className="po-field__label">No.</label>
                    <select name="series" className="po-field__select" value={header.series} onChange={handleHeaderChange} disabled={!!currentDocEntry || pageState.seriesLoading}>
                      <option value="">{pageState.seriesLoading ? 'Loading series...' : pageState.seriesError ? 'Series unavailable' : 'Select Series'}</option>
                      {(canUseManualSeries(refData) || (currentDocEntry && ['-1','manual','__sap_manual__'].includes(String(header.series)))) && (<option value={SAP_MANUAL_SERIES_VALUE}>Manual</option>)}
                      {getSapVisibleDocumentSeries(refData.series, {
                        selectedSeries: header.series, includeHistorical: Boolean(currentDocEntry),
                        postingDate: header.postingDate || header.documentDate,
                      }).map(s => <option key={s.Series} value={s.Series}>{s.SeriesName} ({s.Indicator})</option>)}
                      {header.series && !isManualDocumentSeries(header.series) && !refData.series.some(s => String(s.Series) === String(header.series)) && (
                        <option value={header.series}>
                          {header.seriesName
                            ? `${header.seriesName}${header.seriesIndicator ? ` (${header.seriesIndicator})` : ''}`
                            : header.series}
                        </option>
                      )}
                    </select>
                    <input
                      type="text"
                      name="nextNumber"
                      className="po-field__input"
                      style={{
                        width: 80,
                        background: !currentDocEntry && isManualDocumentSeries(header.series) ? '#fff' : '#f0f2f5',
                        textAlign: 'center',
                        border: valErrors.header.nextNumber ? '1px solid #c00' : undefined,
                      }}
                      value={pageState.seriesLoading ? '...' : currentDocEntry ? (header.docNo || header.nextNumber || '') : (header.nextNumber || '')}
                      onChange={handleHeaderChange}
                      readOnly={!!currentDocEntry || !isManualDocumentSeries(header.series)}
                      title={isManualDocumentSeries(header.series) ? 'Enter the manual document number' : 'Auto-assigned on save'}
                    />
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
                    <SapDateInput  name="deliveryDate" className={`po-field__input${valErrors.header.deliveryDate ? ' po-field__input--error' : ''}`} value={header.deliveryDate} onChange={handleHeaderChange} />
                    {valErrors.header.deliveryDate && <span className="po-error-feedback">{valErrors.header.deliveryDate}</span>}
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Document Date *</label>
                    <SapDateInput  name="documentDate" className={`po-field__input${valErrors.header.documentDate ? ' po-field__input--error' : ''}`} value={header.documentDate} onChange={handleHeaderChange} />
                    {valErrors.header.documentDate && <span className="po-error-feedback">{valErrors.header.documentDate}</span>}
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
            <div className={activeTab === 'Tax' ? 'sap-b1-tax-panel' : 'po-tab-panel'}>
            {activeTab === 'Contents' && (
              <ContentsTab
                companyQueryContext={buildCompanyFormQueryContext(currentDocEntry, header)}
                lines={lines}
                onLineChange={handleLineChange}
                onNumBlur={handleNumBlur}
                onAddLine={addLine}
                onRemoveLine={removeLine}
                onOpenBatchModal={openBatchModal}
                lineItemOptions={lineItemOptions}
                getUomOptions={getUomOptions}
                effectiveTaxCodes={effectiveTaxCodes}
                effectiveWarehouses={branchFilteredWarehouses}
                fmtTaxLabel={fmtTaxLabel}
                valErrors={valErrors}
                branches={refData.branches}
                onOpenHSNModal={openHSNModal}
                onOpenItemModal={openItemModal}
                onOpenLineLookup={openLineLookup}
                getBranchName={getBranchName}
                locationLookupOptions={locationLookupOptions}
                matrixFields={effectiveMatrixColumnDefinitions}
                formSettings={formSettings}
                rowUdfFields={rowUdfDefinitions}
                onRowUdfChange={handleRowUdfChange}
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
                shippingTypeOptions={shipTypeOpts}
                onShipToCodeChange={handleShipToCodeChange}
                onOpenAddressModal={openAddressModal}
              />
            )}

            {activeTab === 'Accounting' && (
              <AccountingTab
                header={header}
                onHeaderChange={handleHeaderChange}
                paymentTermOptions={payTermOpts}
              />
            )}

            {activeTab === 'Tax' && (
              <TaxTab
                header={header}
                onHeaderChange={handleHeaderChange}
                onOpenTaxInfoModal={openTaxInfoModal}
                errors={valErrors.header}
                isEditable={isDocumentEditable}
              />
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
                  {totals.taxBreakdown.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className="po-section-title">Tax Summary</div>
                      {totals.taxBreakdown.map(t => (
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
                        <td><input className="po-grid__input" value={fmtDec(totals.subtotal, numDec.total)} readOnly style={{ background: '#f5f8fc' }} /></td>
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
                        <td><DocumentRoundingInput className="po-grid__input" header={header} setHeader={setHeader} formattedAmount={fmtDec(totals.roundingAmount, numDec.totalPaymentDue)} disabled={!isDocumentEditable} onManualChange={markDirty} /></td>
                      </tr>
                      <tr>
                        <td style={{ fontWeight: 600 }}>Tax</td>
                        <td><input className="po-grid__input" value={fmtDec(totals.taxAmt, numDec.tax)} readOnly style={{ background: '#f5f8fc' }} /></td>
                      </tr>
                      {showWithholdingTax && (
                        <tr>
                          <td style={{ fontWeight: 600 }}>WTax Amount</td>
                          <td style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input className="po-grid__input" value={fmtDec(wtaxAmount, numDec.tax)} readOnly style={{ background: '#f5f8fc', flex: 1 }} />
                            <button
                              type="button"
                              onClick={openWithholdingTaxTable}
                              style={{ padding: '2px 8px', fontSize: 11, border: '1px solid #d0d7de', borderRadius: 3, background: 'linear-gradient(180deg, #f6f8fa 0%, #e9ecef 100%)', cursor: 'pointer', minWidth: 24 }}
                              title="Open Withholding Tax Table"
                            >
                              ...
                            </button>
                          </td>
                        </tr>
                      )}
                      <tr className="po-grid__total">
                        <td style={{ fontWeight: 700, color: '#003366', fontSize: 12 }}>Total Payment Due</td>
                        <td><input className="po-grid__input" value={fmtDec(totalPaymentDueAfterWTax, numDec.totalPaymentDue)} readOnly style={{ background: '#e8f4fc', fontWeight: 700, color: '#003366' }} /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* â•â• ACTION BUTTONS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            {false && (
            <div className="po-toolbar sap-document-toolbar" style={{ justifyContent: 'space-between', marginTop: 10 }}>
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
                        openCopyFromModal('grpo');
                        document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
                      }}
                    >
                      GRPO
                    </button>
                  </div>
                </div>
                <div className="po-dropdown">
                  <button
                    type="button"
                    className="po-btn"
                    disabled={!currentDocEntry}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
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
                        handleCopyTo('apCreditMemo');
                        document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
                      }}
                    >
                      A/P Credit Memo
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
            headerUdfFields={sidebarHeaderUdfDefinitions}
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
        taxInfoForm={taxInfoDraft}
        onFormChange={handleTaxInfoFormChange}
      />

      {/* Item Selection Modal */}
      <ItemSelectionModal
        isOpen={itemModal.open}
        onClose={closeItemModal}
        onSelect={handleItemSelect}
        items={itemModal.items}
        loading={itemModal.loading}
      />

      <HSNCodeModal
        isOpen={hsnModal.open}
        onClose={closeHSNModal}
        onSelect={handleHSNSelect}
        mode={hsnModal.fieldName === 'sac' ? 'sac' : 'hsn'}
      />

      <LineValueLookupModal
        isOpen={lineLookupModal.open}
        onClose={closeLineLookup}
        onSelect={handleLineLookupSelect}
        options={lineLookupModal.options}
        title={lineLookupModal.title}
        searchPlaceholder={lineLookupModal.searchPlaceholder}
        emptyMessage={lineLookupModal.emptyMessage}
        columns={lineLookupModal.columns}
        allowCreate={false}
      />

      {/* Business Partner Modal */}
      <BusinessPartnerModal
        isOpen={bpModal}
        onClose={closeBpModal}
        onSelect={handleBpSelect}
        businessPartners={refData.vendors || []}
      />

      {/* State Selection Modal */}
      <StateSelectionModal
        isOpen={stateModal}
        onClose={closeStateModal}
        onSelect={handleStateSelect}
        states={refData.states || []}
      />

      <CopyFromModal
        isOpen={copyFromModal}
        onClose={() => setCopyFromModal(false)}
        onCopy={handleCopyFrom}
        documentType={copyFromDocType}
        onFetchDocuments={fetchCopyFromDocuments}
        onFetchDocumentDetails={fetchCopyFromDocumentDetails}
      />

      <SalesEmployeeSetupModal
        isOpen={salesEmployeeSetup.open}
        rows={salesEmployeeSetup.rows}
        saving={salesEmployeeSetup.saving}
        onClose={closeSalesEmployeeSetup}
        onSave={saveSalesEmployeeSetup}
        onUpdateRow={updateSalesEmployeeSetupRow}
      />

      <WithholdingTaxTableModal
        isOpen={withholdingTax.open}
        onClose={() => setWithholdingTax((prev) => ({ ...prev, open: false }))}
        rows={withholdingModalRows}
        allowedCodes={withholdingTax.allowedCodes.length ? withholdingTax.allowedCodes : refData.withholding_tax_codes}
        baseAmount={wtaxBaseAmount}
        workspaceRef={workspaceRef}
        onRowsChange={(rows) => setWithholdingTax((prev) => ({
          ...prev,
          rows: recalcWithholdingRows(rows),
        }))}
      />

      <BatchAllocationModal
        isOpen={batchModal.open}
        mode="receipt"
        documentLabel="A/P Invoice"
        line={batchModal.lineIndex != null ? lines[batchModal.lineIndex] : null}
        loading={batchModal.loading}
        error={batchModal.error}
        onGenerateBatchNumber={() => fetchNextBatchNumber('JKL')}
        workspaceRef={workspaceRef}
        onClose={closeBatchModal}
        onSave={saveLineBatches}
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

export default APInvoice;
