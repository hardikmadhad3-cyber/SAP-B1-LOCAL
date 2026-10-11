import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import { calculateDocumentRounding, getDocumentRoundingPolicy } from '../../utils/documentRounding';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import { getWarehouseLocationCode } from '../../utils/warehouseLocation';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import './styles/Delivery.css';
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
import TaxInfoModal from './components/TaxInfoModal';
import BatchAllocationModal from './components/BatchAllocationModal';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import QualitySelectionModal from '../sales-order/components/QualitySelectionModal';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import PrintLayoutToolbar from '../../components/print-layout/PrintLayoutToolbar';
import JournalEntryPreviewButton from '../../components/journal-entry/JournalEntryPreviewButton';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import CopyFromModal from '../../components/document/CopyFromModal';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import { copyToDocument } from '../../services/documentCopyService';
import { filterWarehousesByBranch, getWarehouseBranchId } from '../../utils/warehouseBranch';
import { hydrateDocumentLineFromItem, mergeItemMaster } from '../../utils/documentItemHydration';
import { FALLBACK_UOM, FALLBACK_WAREHOUSES } from '../../utils/fallbackReferenceData';
import { getSapVisibleDocumentSeries, pickDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import { useCompanyScopedFormSettings } from '../../utils/formSettingsStorage';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { findTaxCode, getTaxComponentCodes } from '../../utils/taxCodeComponents';
import { getDocumentLinePayableTax } from '../../utils/documentLineTax';
import { isRouteStateForActiveCompany } from '../../utils/companyStorageScope';
import {
  consumeCopyToState as consumePersistedCopyToState,
  replaceRouteStatePreservingWindow,
} from '../../utils/copyToState';
import useStandardDocumentDraftTask from '../../hooks/useStandardDocumentDraftTask';
import { duplicateDocumentInPlace, refreshDuplicateSeries } from '../../utils/documentDuplicate';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import {
  BATCH_QTY_TOLERANCE,
  getLineUomFactor,
  getRequiredBatchQty,
  sumBatchQty,
} from '../../utils/batchQuantity';
import { determineTaxCode, recalculateAllTaxCodes, getGSTTypeLabel } from '../../utils/taxEngine';
import {
  fetchDeliveryReferenceData,
  fetchDeliveryByDocEntry,
  fetchDeliveryCustomerDetails,
  fetchItemsForModal,
  fetchUomConversionFactor,
  submitDelivery,
  updateDelivery,
  fetchDocumentSeries,
  fetchOpenSalesOrders,
  fetchSalesOrderForCopy,
  fetchOpenSalesQuotationsForDelivery,
  fetchSalesQuotationForDeliveryCopy,
  fetchOpenReturnsForDelivery,
  fetchReturnForDeliveryCopy,
  fetchOpenBlanketAgreementsForDelivery,
  fetchBlanketAgreementForDeliveryCopy,
  fetchBatchesByItem,
  fetchFreightCharges,
  validateDeliveryDocument,
  createDeliveryLookupValue,
  saveDeliverySalesEmployeesSetup
} from '../../api/sodaDeliveryApi';
import { fetchSalesOrderByDocEntry } from '../../api/sodaSalesOrderApi';
import { fetchHSNCodeFromItem } from '../../api/hsnCodeApi';
import { SALES_ORDER_COMPANY_ID } from '../../config/appConfig';
import { sodaDeliveryCopyFromApi, normaliseDocumentHeader, normaliseDocumentLine, BASE_TYPE } from '../../api/copyFromApi';
import {
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  BASE_MATRIX_COLUMNS,
  buildCompanyMatrixColumnSettings,
  createUdfState,
  filterDeliveryRowUdfDefinitions,
  normalizeUdfState,
  readSavedFormSettings,
} from '../../config/sodaDeliveryForm';

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

const hasUdfValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const mergeUdfValues = (...sources) =>
  sources.reduce((acc, source) => {
    Object.entries(source || {}).forEach(([key, value]) => {
      if (hasUdfValue(value) || acc[key] === undefined) {
        acc[key] = value ?? '';
      }
    });
    return acc;
  }, {});

const unwrapSalesOrderDocument = (data = {}) =>
  data.sales_order || data.salesOrder || data.document || data;

const getDocumentLines = (document = {}) => {
  const lines = document.DocumentLines || document.lines || [];
  return Array.isArray(lines) ? lines : [];
};

const getLineIdentity = (line = {}, fallbackIndex = null) =>
  line.LineNum ?? line.lineNum ?? line.BaseLine ?? line.baseLine ?? fallbackIndex;

const mergeSalesOrderCopyUdfs = (copyData = {}, detailData = {}) => {
  const detailDocument = unwrapSalesOrderDocument(detailData);
  const detailHeaderUdfs = mergeUdfValues(detailDocument.header_udfs, detailDocument.headerUdfs);
  const copyHeaderUdfs = mergeUdfValues(copyData.header_udfs, copyData.headerUdfs);
  const mergedHeaderUdfs = mergeUdfValues(detailHeaderUdfs, copyHeaderUdfs);
  const copyLines = getDocumentLines(copyData);
  const detailLines = getDocumentLines(detailDocument);

  const detailLinesByIdentity = new Map();
  detailLines.forEach((line, index) => {
    const identity = getLineIdentity(line, index);
    if (identity !== null && identity !== undefined) {
      detailLinesByIdentity.set(String(identity), line);
    }
  });

  const mergedLines = copyLines.map((line, index) => {
    const identity = getLineIdentity(line, index);
    const detailLine = detailLinesByIdentity.get(String(identity)) || detailLines[index] || {};

    return {
      ...line,
      udf: mergeUdfValues(detailLine.udf, detailLine.line_udfs, detailLine.lineUdfs, line.udf, line.line_udfs, line.lineUdfs),
    };
  });

  return {
    ...copyData,
    header_udfs: mergedHeaderUdfs,
    headerUdfs: mergedHeaderUdfs,
    DocumentLines: mergedLines.length ? mergedLines : copyLines,
  };
};
const isEmptyBranchValue = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || normalized === '0' || normalized === '-1' || normalized === 'no branch' || normalized === 'select branch';
};
const normalizeSubmitBranch = (value) =>
  isEmptyBranchValue(value) ? '' : String(value).trim();
const getWarehouseCode = (warehouse = {}) =>
  !warehouse || typeof warehouse !== 'object'
    ? ''
    :
  warehouse.WhsCode ?? warehouse.whsCode ?? warehouse.code ?? '';
const findWarehouse = (warehouses = [], warehouseCode = '') => {
  const normalizedWarehouse = String(warehouseCode || '').trim();
  if (!normalizedWarehouse) return null;
  return (warehouses || []).find((entry) => String(getWarehouseCode(entry) || '').trim() === normalizedWarehouse) || null;
};
const getWarehouseBranchValue = (warehouses = [], warehouseCode = '') =>
  normalizeSubmitBranch(getWarehouseBranchId(findWarehouse(warehouses, warehouseCode)));
const alignBranchWithWarehouse = (branch, warehouseCode, warehouses = []) => {
  const normalizedBranch = normalizeSubmitBranch(branch);
  if (!normalizedBranch) return '';

  const normalizedWarehouse = String(warehouseCode || '').trim();
  if (!normalizedWarehouse) return normalizedBranch;

  const warehouseBranch = getWarehouseBranchValue(warehouses, warehouseCode);

  if (!warehouseBranch) return normalizedBranch;
  return normalizedBranch === warehouseBranch ? normalizedBranch : warehouseBranch;
};
const resolveCopiedBranchWarehouse = ({
  sourceBranch,
  sourceWarehouse,
  fallbackWarehouse,
  warehouses = [],
} = {}) => {
  const warehouse = String(sourceWarehouse || fallbackWarehouse || '').trim();
  const branch = normalizeSubmitBranch(sourceBranch)
    ? alignBranchWithWarehouse(sourceBranch, warehouse, warehouses)
    : '';

  return {
    branch: isEmptyBranchValue(branch) ? '' : String(branch),
    warehouse,
  };
};
const fmtDec = (v, d) => { if (v === '' || v == null) return ''; const n = Number(v); return Number.isNaN(n) ? '' : n.toFixed(Math.max(d, 0)); };
const TAX_SENSITIVE_LINE_FIELDS = new Set(['itemNo', 'quantity', 'unitPrice', 'discountAmount', 'stdDiscount', 'taxCode', 'uomCode']);
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
const SAP_YES_VALUES = new Set(['Y', 'YES', 'TRUE', 'TYES', '1']);
const isSapYes = (value) => SAP_YES_VALUES.has(String(value ?? '').trim().toUpperCase());
const firstPresent = (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
const isInventoryManaged = (item) => {
  if (!item) return false;
  const inventoryFlag = firstPresent(
    item.InventoryItem,
    item.InvntItem,
    item.inventoryItem,
    item.inventoryManaged,
    item.ManageInventory
  );
  return inventoryFlag === undefined ? true : isSapYes(inventoryFlag);
};
const isBatchManaged = (item) => {
  if (!item) return false;
  
  const batchManagedValue = firstPresent(
    item?.BatchManaged,
    item?.ManBtchNum,
    item?.ManageBatchNumbers,
    item?.batchManaged
  );
  const isManaged = isInventoryManaged(item) && isSapYes(batchManagedValue);
  
  console.log('ðŸ” [isBatchManaged] Item:', item?.ItemCode, 'BatchManaged field:', batchManagedValue, 'Is managed:', isManaged);
  console.log('ðŸ” [isBatchManaged] Full item data:', item);
  
  return isManaged;
};
// Check if batches are available for item in specific warehouse
const checkBatchAvailability = async (itemCode, whsCode) => {
  if (!itemCode || !whsCode) return false;
  
  try {
    console.log('ðŸ” [checkBatchAvailability] Checking batches for:', { itemCode, whsCode });
    const response = await fetchBatchesByItem(itemCode, whsCode);
    console.log('ðŸ” [checkBatchAvailability] API Response:', response);
    
    const batches = response.data?.batches || [];
    const hasBatches = batches.length > 0;
    
    console.log('ðŸ” [checkBatchAvailability] Found batches:', batches.length, 'Has batches:', hasBatches);
    console.log('ðŸ” [checkBatchAvailability] Batch details:', batches);
    
    return hasBatches;
  } catch (error) {
    console.error('âŒ [checkBatchAvailability] Error:', error);
    // If there's an error, assume batches are available for batch-managed items
    // This prevents the button from being hidden due to API errors
    return true;
  }
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
// â”€â”€â”€ constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEC = { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 };
const TAB_NAMES = ['Contents', 'Logistics', 'Accounting', 'Tax', 'Electronic Documents', 'Attachments'];
const DEFAULT_WAREHOUSE = '01';
const DEFAULT_COMMISSION_PERCENT = '';

const createLine = (rowUdfDefinitions = ROW_UDF_DEFINITIONS) => ({
  itemNo: '', itemDescription: '',
  sellerQuality: '', buyerQuality: '',
  hsnCode: '', quantity: '', unitPrice: '', discountAmount: '',
  sellerPrice: '', buyerPrice: '',
  sellerDelivery: '', buyerDelivery: '',
  sellerBrokerageAmtPer: '', sellerBrokeragePercent: '',
  sellerBrokerage: '', buyerBrokerage: '',
  specialRebate: '', commission: DEFAULT_COMMISSION_PERCENT, sellerBrokeragePerQty: '', unitPriceUdf: '',
  commissionAmountPerTon: '', commissionBy: '',
  qtySpecialInstruction: '', deliverySpecialInstruction: '',
  buyerPaymentTerms: '', sellerPaymentTerms: '', buyerSpecialInstruction: '', sellerSpecialInstruction: '',
  buyerBillDiscount: '', sellerBillDiscount: '', sellerItem: '', sellerQty: '',
  freightPurchase: '', freightSales: '', freightProvider: '', freightProviderName: '',
  brokerageNumber: '',
  uomCode: '', uomName: '', stdDiscount: '', stcode: '', taxCode: '', total: '', taxAmount: '', whse: DEFAULT_WAREHOUSE,
  distRule: '', freeText: '', countryOfOrigin: '', sacCode: '',
  openQty: '', deliveredQty: '', documentCreated: '',
  loc: '', branch: '', lineNum: undefined, baseEntry: null, baseType: null, baseLine: null,
  inventoryManaged: false, batchManaged: false, batches: [],
  hasBatchesAvailable: false, // Track if batches are available for this item-warehouse combo
  inventoryUOM: '', // Base UoM from item master
  uomFactor: 1, // Conversion factor: Document UoM to Base UoM
  udf: createUdfState(rowUdfDefinitions),
});

const INIT_HEADER = {
  vendor: '', name: '', contactPerson: '', salesContractNo: '', branch: '', warehouse: DEFAULT_WAREHOUSE,
  docNo: '', status: 'Open', series: '', nextNumber: '',
  postingDate: today(), deliveryDate: today(), documentDate: today(), contractDate: '',
  branchRegNo: '', shipTo: '', shipToCode: '', payTo: '', payToCode: '',
  shippingType: '', confirmed: undefined, journalRemark: '', paymentTerms: '',
  paymentMethod: '', otherInstruction: '', discount: '', freight: '', tax: '',
  totalPaymentDue: '', rounding: false, owner: '', purchaser: '',
  placeOfSupply: '', currency: 'INR', useBillToForTax: false,
  billToAddress: '', billToCode: '', shipToAddress: '',
};

const createInitialHeader = (settings = readGeneralSettings()) => ({
  ...INIT_HEADER,
  warehouse: settings.sodaDeliveryWarehouse || DEFAULT_WAREHOUSE,
  series: settings.sodaDeliverySeries || '',
  postingDate: today(),
  deliveryDate: today(),
  documentDate: today(),
});

const INIT_ATTACH = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, targetPath: '', fileName: '', attachmentDate: '',
  freeText: '', copyToTargetDocument: '', documentType: '', atchDocDate: '', alert: '',
}));

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SODADelivery() {
  const [seriesRevision, setSeriesRevision] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();
  const { company } = useAuth();
  const activeCompanyId = company?.companyId || SALES_ORDER_COMPANY_ID;
  const { removeTask, upsertTask } = useSapWindowTaskbarActions();
  const formRef = useRef(null);
  const isHydratingDocumentRef = useRef(false);
  const handledCopyFromRef = useRef('');
  const generalSettingsRef = useRef(readGeneralSettings());
  const requestedEditDocEntry = isRouteStateForActiveCompany(location.state) ? (
    location.state?.sodaDeliveryDocEntry ||
    location.state?.document?.docEntry ||
    location.state?.document?.DocEntry
  ) : null;
  const staleRequestedEditDocEntry = !requestedEditDocEntry && (
    location.state?.sodaDeliveryDocEntry ||
    location.state?.document?.docEntry ||
    location.state?.document?.DocEntry
  );

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(() => createInitialHeader(generalSettingsRef.current));
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState(HEADER_UDF_DEFINITIONS);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState(ROW_UDF_DEFINITIONS);
  const [lines, setLines] = useState([createLine(ROW_UDF_DEFINITIONS)]);
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
    warehouses: [], locations: [], warehouse_addresses: [], company_address: {}, tax_codes: [],
    payment_terms: [], shipping_types: [], branches: [], uom_groups: [],
    distribution_rules: [], sales_employees: [], quality_options: { buyer: [], seller: [] }, price_options: { buyer: [], seller: [] },
    decimal_settings: DEC, warnings: [], series: [], states: [], udf_metadata: { header: [], rows: [] },
  });
  const [pageState, setPageState] = useState({ loading: false, vendorLoading: false, posting: false, error: '', success: '', seriesLoading: false });
  const [valErrors, setValErrors] = useState({ header: {}, lines: {}, form: '' });
  useValidationHighlights(valErrors, { rootRef: formRef });
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useStandardDocumentDraftTask({
    draftKey: 'sodaDeliveryDraft',
    title: 'SODA Delivery',
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
      setLines(Array.isArray(draft.lines) && draft.lines.length
        ? draft.lines
        : [createLine(ROW_UDF_DEFINITIONS)]);
      setHeaderUdfs(draft.headerUdfs || normalizeUdfState(HEADER_UDF_DEFINITIONS));
      setActiveTab(draft.activeTab || 'Contents');
      setIsDirty(Boolean(draft.isDirty));
    },
  });
  const [addressModal, setAddressModal] = useState(null);
  const [taxInfoModal, setTaxInfoModal] = useState(false);
  const [batchModal, setBatchModal] = useState({ open: false, lineIndex: null, availableBatches: [], loading: false, error: '' });
  const [bpModal, setBpModal] = useState(false);
  const [stateModal, setStateModal] = useState(false);
  const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1 });
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, items: [], loading: false });
  const [qualityModal, setQualityModal] = useState({
    open: false,
    lineIndex: -1,
    field: '',
    title: 'List of User-Defined Values',
    options: [],
    searchPlaceholder: 'Search values',
    emptyMessage: 'No values found',
    allowCreate: true,
  });
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
  const [salesEmployeeSetup, setSalesEmployeeSetup] = useState({ open: false, rows: [], saving: false });
  const [copyFromModal, setCopyFromModal] = useState(false);
  const [copyFromDocType, setCopyFromDocType] = useState('salesOrder');
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

  // Close Copy From dropdown when clicking outside
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
    quantity: Number(dec.QtyDec), unitPrice: Number(dec.PriceDec), discountAmount: Number(dec.PriceDec),
    stdDiscount: Number(dec.PercentDec), total: Number(dec.SumDec),
    discount: Number(dec.PercentDec), freight: Number(dec.SumDec),
    tax: Number(dec.SumDec), totalPaymentDue: Number(dec.SumDec),
  };
  const isDocumentEditable = !currentDocEntry || ['open', 'unapproved'].includes(String(header.status || '').toLowerCase());
  const documentBodyRef = useRef(null);
  useClosedDocumentViewMode(documentBodyRef, !isDocumentEditable, [activeTab]);
  const hasBuyerCode = Boolean(String(header.vendor || '').trim());
  const isUpdateMode = Boolean(currentDocEntry);
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
  const resolvePreferredSeries = (seriesList, postingDateValue, selectedSeries = '') => pickDocumentSeries(seriesList, selectedSeries);
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
  const hydrateLoadedLine = useCallback((line) => {
    const itemCode = String(line?.itemNo || line?.ItemCode || line?.itemCode || '').trim();
    const item = refData.items.find(i => String(i.ItemCode || '').trim() === itemCode);
    const rawUomCode = String(
      line?.uomCode ||
      line?.UoMCode ||
      line?.UomCode ||
      line?.unitMsr ||
      item?.SalesUnit ||
      item?.InventoryUOM ||
      ''
    ).trim();
    const numericFactor = parseFloat(rawUomCode);
    const explicitFactor = Number(line?.uomFactor);
    const uomFactor = Number.isFinite(explicitFactor) && explicitFactor > 0
      ? explicitFactor
      : Number.isFinite(numericFactor) && numericFactor > 0
        ? numericFactor
        : 1;
    const inventoryUOM = String(line?.inventoryUOM || line?.InventoryUOM || item?.InventoryUOM || '').trim();
    const batches = Array.isArray(line?.batches)
      ? line.batches
          .filter(batch => String(batch?.batchNumber || '').trim())
          .map(batch => ({
            batchNumber: String(batch.batchNumber || '').trim(),
            quantity: String(batch.quantity ?? ''),
            expiryDate: batch.expiryDate || '',
          }))
      : [];
    const lineInventoryFlag = firstPresent(
      line?.inventoryManaged,
      line?.InventoryItem,
      line?.InvntItem,
      line?.inventoryItem
    );
    const inventoryManaged = lineInventoryFlag === undefined
      ? (item ? isInventoryManaged(item) : !!line?.batchManaged)
      : isSapYes(lineInventoryFlag);
    const batchManaged = inventoryManaged && (line?.batchManaged != null ? !!line.batchManaged : isBatchManaged(item));

    return {
      ...createLine(rowUdfDefinitions),
      ...line,
      itemNo: itemCode,
      itemDescription: line?.itemDescription || line?.ItemDescription || line?.Dscription || item?.ItemName || '',
      hsnCode: line?.hsnCode || line?.HSNCode || item?.HSNCode || item?.SWW || item?.U_HSNCode || '',
      quantity: String(line?.quantity ?? line?.Quantity ?? ''),
      openQty: String(line?.openQty ?? line?.OpenQuantity ?? line?.OpenQty ?? ''),
      unitPrice: String(line?.unitPrice ?? line?.UnitPrice ?? line?.Price ?? ''),
      discountAmount: String(line?.discountAmount ?? line?.DiscountAmount ?? line?.U_Rate ?? line?.udf?.U_Rate ?? line?.line_udfs?.U_Rate ?? line?.lineUdfs?.U_Rate ?? ''),
      sellerPrice: String(line?.sellerPrice ?? line?.SellerPrice ?? ''),
      buyerPrice: String(line?.buyerPrice ?? line?.BuyerPrice ?? ''),
      sellerDelivery: line?.sellerDelivery || line?.SellerDelivery || '',
      buyerDelivery: line?.buyerDelivery || line?.BuyerDelivery || '',
      sellerBrokerageAmtPer: line?.sellerBrokerageAmtPer || line?.SellerBrokerageAmtPer || '',
      sellerBrokeragePercent: String(line?.sellerBrokeragePercent ?? line?.SellerBrokeragePercent ?? ''),
      sellerBrokerage: String(line?.sellerBrokerage ?? line?.SellerBrokerage ?? ''),
      buyerBrokerage: String(line?.buyerBrokerage ?? line?.BuyerBrokerage ?? ''),
      specialRebate: String(line?.specialRebate ?? line?.SpecialRebate ?? ''),
      commission: String(line?.commission ?? line?.Commission ?? DEFAULT_COMMISSION_PERCENT),
      sellerBrokeragePerQty: String(line?.sellerBrokeragePerQty ?? line?.SellerBrokeragePerQty ?? ''),
      unitPriceUdf: String(line?.unitPriceUdf ?? line?.UnitPriceUdf ?? ''),
      buyerPaymentTerms: line?.buyerPaymentTerms || line?.BuyerPaymentTerms || '',
      sellerPaymentTerms: line?.sellerPaymentTerms || line?.SellerPaymentTerms || '',
      buyerSpecialInstruction: line?.buyerSpecialInstruction || line?.BuyerSpecialInstruction || '',
      sellerSpecialInstruction: line?.sellerSpecialInstruction || line?.SellerSpecialInstruction || '',
      buyerBillDiscount: String(line?.buyerBillDiscount ?? line?.BuyerBillDiscount ?? ''),
      sellerBillDiscount: String(line?.sellerBillDiscount ?? line?.SellerBillDiscount ?? ''),
      sellerItem: line?.sellerItem || line?.SellerItem || '',
      sellerQty: String(line?.sellerQty ?? line?.SellerQty ?? ''),
      freightPurchase: String(line?.freightPurchase ?? line?.FreightPurchase ?? ''),
      freightSales: String(line?.freightSales ?? line?.FreightSales ?? ''),
      freightProvider: line?.freightProvider || line?.FreightProvider || '',
      freightProviderName: line?.freightProviderName || line?.FreightProviderName || '',
      brokerageNumber: line?.brokerageNumber || line?.BrokerageNumber || '',
      uomCode: rawUomCode,
      stdDiscount: String(line?.stdDiscount ?? line?.DiscountPercent ?? line?.DiscPrcnt ?? ''),
      stcode: line?.stcode || line?.STCode || '',
      taxCode: line?.taxCode || line?.TaxCode || line?.VatGroup || '',
      total: String(line?.total ?? line?.LineTotal ?? ''),
      taxAmount: String(line?.taxAmount ?? line?.LineTaxAmount ?? line?.VatSum ?? ''),
      whse: line?.whse || line?.Warehouse || line?.WarehouseCode || line?.WhsCode || '',
      distRule: line?.distRule || line?.DistributionRule || line?.OcrCode || '',
      freeText: line?.freeText || line?.FreeText || '',
      countryOfOrigin: line?.countryOfOrigin || line?.CountryOfOrigin || '',
      sacCode: line?.sacCode || line?.SACCode || '',
      deliveredQty: String(line?.deliveredQty ?? line?.DeliveredQty ?? ''),
      documentCreated: line?.documentCreated || line?.DocumentCreated || '',
      loc: String(line?.loc ?? line?.Loc ?? ''),
      branch: String(line?.branch ?? line?.Branch ?? ''),
      lineNum: line?.lineNum ?? line?.LineNum,
      baseEntry: line?.baseEntry ?? line?.BaseEntry ?? null,
      baseType: line?.baseType ?? line?.BaseType ?? null,
      baseLine: line?.baseLine ?? line?.BaseLine ?? null,
      inventoryUOM,
      uomFactor,
      inventoryManaged,
      batchManaged,
      batches,
      hasBatchesAvailable: batchManaged ? true : false,
      udf: normalizeUdfState(rowUdfDefinitions, line?.udf || {}),
    };
  }, [refData.items, rowUdfDefinitions]);

  // Continue in next part...

  // â”€â”€ load reference data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        const refDataRes = await fetchDeliveryReferenceData(activeCompanyId);
        
        if (!ignore) {
          const vendorRows = refDataRes.data.vendors || refDataRes.data.customers || [];
          const nextHeaderUdfs = refDataRes.data.udf_metadata?.header || [];
          const rawRowUdfs = refDataRes.data.udf_metadata?.rows || [];
          const nextRowUdfs = filterDeliveryRowUdfDefinitions(rawRowUdfs);
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
            matrixColumns: buildCompanyMatrixColumnSettings(rawRowUdfs, prev.matrixColumns),
            rowUdfs: {
              ...nextRowUdfs.reduce((acc, field) => ({ ...acc, [field.key]: { visible: false, active: true } }), {}),
              ...(prev.rowUdfs || {}),
            },
          }));
          setRefData(prev => ({
            ...prev,
            company: refDataRes.data.company || '',
            vendors: vendorRows,
            contacts: refDataRes.data.contacts || [],
            pay_to_addresses: refDataRes.data.pay_to_addresses || [],
            ship_to_addresses: refDataRes.data.ship_to_addresses || [],
            bill_to_addresses: refDataRes.data.bill_to_addresses || [],
            items: refDataRes.data.items || [],
            warehouses: refDataRes.data.warehouses || [],
            locations: refDataRes.data.locations || [],
            warehouse_addresses: refDataRes.data.warehouse_addresses || [],
            company_address: refDataRes.data.company_address || {},
            tax_codes: refDataRes.data.tax_codes || [],
            payment_terms: refDataRes.data.payment_terms || [],
            shipping_types: refDataRes.data.shipping_types || [],
            sales_employees: refDataRes.data.sales_employees || [],
            branches: refDataRes.data.branches || [],
            states: refDataRes.data.states || [],
            uom_groups: refDataRes.data.uom_groups || [],
            distribution_rules: refDataRes.data.distribution_rules || [],
            quality_options: refDataRes.data.quality_options || { buyer: [], seller: [] },
            price_options: refDataRes.data.price_options || { buyer: [], seller: [] },
            decimal_settings: { ...DEC, ...(refDataRes.data.decimal_settings || {}) },
            warnings: refDataRes.data.warnings || [],
            udf_metadata: refDataRes.data.udf_metadata || { header: [], rows: [] },
            series: Array.isArray(prev.series) ? prev.series : [],
          }));
        }
      } catch (e) {
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
    if (staleRequestedEditDocEntry) {
      setPageState(p => ({ ...p, loading: false, error: '', success: '' }));
      replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
      return;
    }

    const docEntry = requestedEditDocEntry;
    if (!docEntry) return;
    let ignore = false;
    let hydrationTimer = null;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        isHydratingDocumentRef.current = true;
        const r = await fetchDeliveryByDocEntry(docEntry);
        const so = r.data.delivery;
        let editSeries = [];
        try {
          const seriesDate = so?.header?.postingDate || so?.header?.documentDate || '';
          const seriesResponse = await fetchDocumentSeries(seriesDate, { branch: so?.header?.branch || '' });
          editSeries = seriesResponse.data?.series || [];
        } catch (_seriesError) {
          editSeries = [];
        }
        const loadedLines = Array.isArray(so?.lines) && so.lines.length
          ? so.lines
          : Array.isArray(so?.DocumentLines) && so.DocumentLines.length
            ? so.DocumentLines
            : [];
        const firstLineWarehouse = loadedLines.length > 0
          ? String(
              loadedLines[0]?.whse ||
              loadedLines[0]?.Warehouse ||
              loadedLines[0]?.WarehouseCode ||
              loadedLines[0]?.WhsCode ||
              ''
            )
          : '';
        console.log('ðŸ“¦ [SODA Delivery] Loaded delivery data:', so);
        console.log('ðŸ“¦ [SODA Delivery] Header:', so.header);
        console.log('ðŸ“¦ [SODA Delivery] Lines:', so.lines);
        
        if (ignore || !so) return;
        setCurrentDocEntry(so.doc_entry || Number(docEntry));
        setActiveTab('Contents');
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
          warehouse: firstLineWarehouse || so.header?.warehouse || DEFAULT_WAREHOUSE,
          shipToCode: so.header?.shipToCode || '',
          shipToAddress: so.header?.shipToAddress || so.header?.shipTo || '',
          shipTo: so.header?.shipTo || so.header?.shipToAddress || '',
          billToCode: so.header?.billToCode || so.header?.payToCode || '',
          billToAddress: so.header?.billToAddress || so.header?.payTo || '',
          payToCode: so.header?.payToCode || so.header?.billToCode || '',
          payTo: so.header?.payTo || so.header?.billToAddress || '',
          docNo: so.header?.docNo || so.header?.docNum || '',
          series: so.header?.series || '',
          nextNumber: so.header?.docNo || so.header?.docNum || '',
        }));
        
        setLines(
          loadedLines.length
            ? loadedLines.map(l => hydrateLoadedLine({ ...l, branch: l.branch || so.header?.branch || '' }))
            : [createLine(rowUdfDefinitions)]
        );
        
        console.log('ðŸ“¦ [SODA Delivery] Lines after mapping:', lines);
        
        setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, so.header_udfs || {}));
        setSnapshotPending(true);
        setIsDirty(false);
        if (so.header?.customerCode || so.header?.customer) {
          loadVendorDetails(so.header?.customerCode || so.header?.customer, { preserveExisting: true });
        }
        
        setPageState(p => ({ ...p, success: so.doc_num ? `SODA Delivery ${so.doc_num} loaded.` : 'SODA Delivery loaded.' }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load SODA delivery.') }));
      } finally {
        hydrationTimer = setTimeout(() => {
          isHydratingDocumentRef.current = false;
        }, 0);
        if (!ignore) {
          setPageState(p => ({ ...p, loading: false }));
          replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
        }
      }
    };
    load();
    return () => {
      ignore = true;
      isHydratingDocumentRef.current = false;
      if (hydrationTimer) clearTimeout(hydrationTimer);
    };
  }, [hydrateLoadedLine, location.pathname, location.state, navigate]);

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

  useEffect(() => {
    if (!currentDocEntry || !refData.items.length) return;

    setLines(prevLines => prevLines.map(line => hydrateLoadedLine(line)));
  }, [currentDocEntry, hydrateLoadedLine, refData.items.length]);

  // â”€â”€ Copy To: populate form from Sales Order / other source â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const routedCopyFrom = location.state?.copyFrom;
    if (routedCopyFrom && !isRouteStateForActiveCompany(location.state)) {
      replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
      return;
    }

    const persistedCopyState = consumePersistedCopyToState(location.pathname, ['/soda-delivery/new', '/soda-delivery']);
    const copyFrom = routedCopyFrom || persistedCopyState?.copyFrom;

    if (!copyFrom) return;

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

    const { header: srcHeader = {}, lines: srcLines = [], baseDocument } = copyFrom;
    const normalizedHeader = normaliseDocumentHeader(srcHeader || {});
    const baseEntry = baseDocument?.baseEntry || copyFrom.docEntry;
    const baseType = baseDocument?.baseType || BASE_TYPE[copyFrom.type] || 17;
    const firstSourceLine = Array.isArray(srcLines) && srcLines.length ? srcLines[0] : {};
    const firstLineWarehouse =
      firstSourceLine?.whse ||
      firstSourceLine?.WarehouseCode ||
      firstSourceLine?.WhsCode ||
      '';
    const copiedLocation = resolveCopiedBranchWarehouse({
      sourceBranch: normalizedHeader.branch || srcHeader.branch || srcHeader.BPL_IDAssignedToInvoice || srcHeader.BPLId,
      sourceWarehouse: srcHeader.warehouse,
      fallbackWarehouse: firstLineWarehouse,
      warehouses: refData.warehouses.length ? refData.warehouses : FALLBACK_WAREHOUSES,
    });

    setCurrentDocEntry(null);
    setActiveTab('Contents');
    setSnapshotPending(false);
    setIsDirty(false);
    setValErrors({ header: {}, lines: {}, form: '' });
    setFreightModal({ open: false, freightCharges: Array.isArray(copyFrom.freightCharges) ? copyFrom.freightCharges : [], loading: false });
    setCopyFromModal(false);

    // Populate header for a new SODA Delivery copied from the source document.
    setHeader(prev => ({
      ...INIT_HEADER,
      postingDate: today(),
      documentDate: today(),
      deliveryDate: srcHeader.deliveryDate || srcHeader.DocDueDate || prev.deliveryDate || '',
      vendor:           normalizedHeader.vendor || srcHeader.vendor || srcHeader.CardCode || '',
      name:             normalizedHeader.name || srcHeader.name || srcHeader.CardName || '',
      contactPerson:    normalizedHeader.contactPerson || srcHeader.contactPerson || srcHeader.CntctCode || '',
      salesContractNo:  normalizedHeader.salesContractNo || normalizedHeader.customerRefNo || srcHeader.salesContractNo || srcHeader.customerRefNo || srcHeader.CustomerRefNo || srcHeader.NumAtCard || '',
      branch:           copiedLocation.branch,
      warehouse:        copiedLocation.warehouse || DEFAULT_WAREHOUSE,
      paymentTerms:     normalizedHeader.paymentTerms || srcHeader.paymentTerms || srcHeader.GroupNum || '',
      placeOfSupply:    normalizedHeader.placeOfSupply || srcHeader.placeOfSupply || '',
      otherInstruction: normalizedHeader.otherInstruction || srcHeader.otherInstruction || srcHeader.Comments || '',
      discount:         srcHeader.discount || '',
      freight:          srcHeader.freight || '',
      tax:              srcHeader.tax || '',
      currency:         srcHeader.currency || 'INR',
      shipTo:           srcHeader.shipTo || srcHeader.shipToAddress || '',
      shipToCode:       srcHeader.shipToCode || '',
      shipToAddress:    srcHeader.shipToAddress || srcHeader.shipTo || '',
      payTo:            srcHeader.payTo || srcHeader.billToAddress || '',
      payToCode:        srcHeader.payToCode || srcHeader.billToCode || '',
      billToCode:       srcHeader.billToCode || srcHeader.payToCode || '',
      billToAddress:    srcHeader.billToAddress || srcHeader.payTo || '',
    }));
    const copiedHeaderUdfs = mergeUdfValues(copyFrom.headerUdfs, copyFrom.header_udfs, srcHeader.header_udfs, srcHeader.headerUdfs);
    setHeaderUdfs({
      ...copiedHeaderUdfs,
      ...normalizeUdfState(headerUdfDefinitions, copiedHeaderUdfs),
    });

    // Populate lines with base document linking
    if (Array.isArray(srcLines) && srcLines.length > 0) {
      setLines(srcLines.map((l, idx) => {
        const normalizedLine = normaliseDocumentLine(
          l,
          idx,
          baseEntry,
          baseType,
          copiedLocation.branch
        );

        const copiedLineUdfs = mergeUdfValues(l.line_udfs, l.lineUdfs, l.udf, normalizedLine.udf);
        const item = refData.items.find(it => String(it.ItemCode || '') === String(normalizedLine.itemNo || ''));
        const inventoryManaged = item ? isInventoryManaged(item) : isInventoryManaged(l);
        const batchManaged = item ? isBatchManaged(item) : isBatchManaged(l);
        return {
          ...createLine(rowUdfDefinitions),
          ...normalizedLine,
          taxCode: normalizedLine.taxCode || l.taxCode || l.TaxCode || l.VatGroup || '',
          stcode: normalizedLine.stcode || l.stcode || '',
          branch: normalizedLine.branch || copiedLocation.branch,
          loc: normalizedLine.loc || getWarehouseLocationCode(refData.warehouses, normalizedLine.whse || l.whse || l.WarehouseCode || l.WhsCode || copiedLocation.warehouse),
          whse: normalizedLine.whse || l.whse || l.WarehouseCode || l.WhsCode || copiedLocation.warehouse || DEFAULT_WAREHOUSE,
          commission: normalizedLine.commission || l.commission || l.Commission || DEFAULT_COMMISSION_PERCENT,
          baseEntry,
          baseType,
          baseLine: l.lineNum ?? l.LineNum ?? normalizedLine.baseLine ?? idx,
          inventoryManaged,
          batchManaged,
          hasBatchesAvailable: batchManaged ? true : false,
          udf: {
            ...copiedLineUdfs,
            ...normalizeUdfState(rowUdfDefinitions, copiedLineUdfs),
          },
        };
      }));
    } else {
      setLines([createLine(rowUdfDefinitions)]);
    }

    // Load vendor details to populate contacts/addresses
    const cardCode = normalizedHeader.vendor || srcHeader.vendor || srcHeader.CardCode;
    if (cardCode) loadVendorDetails(cardCode, { preserveExisting: true });

    const sourceLabel = copyFrom.sourceLabel || copyFrom.type || 'source document';
    setPageState(p => ({ ...p, success: `Copied from ${sourceLabel}. Please review and save.` }));

    // Clear state so refresh doesn't re-populate
    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state || persistedCopyState);
  }, [location.pathname, location.state?.copyFrom, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // â”€â”€ derived / computed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const vendorContacts = refData.contacts.filter(c => String(c.CardCode || '') === String(header.vendor || ''));
  const contactOptions = header.contactPerson && !vendorContacts.some(c => String(c.CntctCode || '') === String(header.contactPerson || ''))
    ? [{ CardCode: header.vendor, CntctCode: header.contactPerson, Name: header.contactPerson }, ...vendorContacts]
    : vendorContacts;
  const vendorPayToAddresses = refData.pay_to_addresses.filter(a => String(a.CardCode || '') === String(header.vendor || ''));
  const vendorShipToAddresses = refData.ship_to_addresses?.filter(a => String(a.CardCode || '') === String(header.vendor || '')) || [];
  const vendorBillToAddresses = refData.bill_to_addresses?.filter(a => String(a.CardCode || '') === String(header.vendor || '')) || [];
  const vendorEffectiveShipToAddresses = vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses;
  const vendorEffectiveBillToAddresses = vendorBillToAddresses.length ? vendorBillToAddresses : vendorPayToAddresses;
  const selectedBranch = refData.branches.find(b => String(b.BPLId || '') === String(header.branch || ''));
  const hasSelectedBranchOption =
    !normalizeSubmitBranch(header.branch) ||
    refData.branches.some(b => String(b.BPLId || '') === String(header.branch || ''));
  const firstLineWhse = String(lines[0]?.whse || '').trim();
  const selectedWhseAddr = refData.warehouse_addresses.find(w => String(w.WhsCode || '') === firstLineWhse);
  const defaultShipTo = fmtAddr(refData.company_address);
  const uomGroupMap = (refData.uom_groups || []).reduce((acc, g) => { acc[g.AbsEntry] = g.uomCodes || []; return acc; }, {});

  const effectiveTaxCodes = refData.tax_codes || [];
  const effectiveSalesEmployees = refData.sales_employees.length
    ? refData.sales_employees
    : [{ SlpCode: -1, SlpName: 'No Sales Employee / Buyer', Active: 'Y' }];
  const effectiveWarehouses = refData.warehouses.length ? refData.warehouses : FALLBACK_WAREHOUSES;
  const getLineInventoryManaged = (line = {}) => {
    const explicitFlag = firstPresent(
      line.inventoryManaged,
      line.InventoryItem,
      line.InvntItem,
      line.inventoryItem
    );
    if (explicitFlag !== undefined) return isSapYes(explicitFlag);

    const itemCode = String(line.itemNo || line.ItemCode || '').trim();
    const item = refData.items.find(it => String(it.ItemCode || '') === itemCode);
    return item ? isInventoryManaged(item) : !!line.batchManaged;
  };
  const branchFilteredWarehouses = filterWarehousesByBranch(effectiveWarehouses, header.branch);
  const freightTotals = summarizeFreightRows(freightModal.freightCharges, effectiveTaxCodes);
  const payTermOpts = refData.payment_terms.length
    ? refData.payment_terms.map(t => ({ value: String(t.GroupNum), label: t.PymntGroup }))
    : FALLBACK_PAYMENT_TERMS;
  const shipTypeOpts = refData.shipping_types.length
    ? refData.shipping_types.map(s => ({ value: String(s.TrnspCode), label: s.TrnspName }))
    : FALLBACK_SHIPPING;

  useEffect(() => {
    if (isHydratingDocumentRef.current || currentDocEntry || !header.warehouse) return;

    const alignedBranch = alignBranchWithWarehouse(header.branch, header.warehouse, effectiveWarehouses);
    if (alignedBranch !== normalizeSubmitBranch(header.branch)) {
      setHeader(prev => ({ ...prev, branch: alignedBranch }));
    }
  }, [currentDocEntry, effectiveWarehouses, header.branch, header.warehouse]);

  const resolveDeliveryAddress = useCallback((code, addresses = [], fallbackText = '') => {
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

  const getBranchName = (branchId) => {
    if (!branchId) return '';
    const branch = refData.branches.find(b => String(b.BPLId) === String(branchId));
    return branch ? branch.BPLName : branchId;
  };

  // â”€â”€ calculations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const getLineDiscountAmount = (line) => {
    const explicitDiscount = String(line.discountAmount ?? '').trim();
    if (explicitDiscount) return parseNum(explicitDiscount);
    return parseNum(line.unitPrice) * parseNum(line.stdDiscount) / 100;
  };

  const getLineDiscountPercent = (line) => {
    const explicitPercent = String(line.stdDiscount ?? '').trim();
    if (explicitPercent) return parseNum(explicitPercent);

    const price = parseNum(line.unitPrice);
    if (price <= 0) return 0;
    return getLineDiscountAmount(line) * 100 / price;
  };

  const calcLineTotal = (line) => {
    const qty = parseNum(line.quantity), price = parseNum(line.unitPrice);
    return roundTo(qty * Math.max(price - getLineDiscountAmount(line), 0), numDec.total);
  };

  const calcLineCommission = (line) => {
    const percent = parseNum(line.commission);
    if (percent <= 0) return '';

    const value = parseNum(line.quantity) * parseNum(line.unitPrice) * percent / 100;
    return fmtDec(roundTo(value, numDec.total), numDec.total);
  };

  const applyLineCalculatedFields = (line) => {
    const next = { ...line };
    if (String(next.discountAmount ?? '').trim()) {
      next.stdDiscount = fmtDec(roundTo(getLineDiscountPercent(next), numDec.stdDiscount), numDec.stdDiscount);
    }
    next.total = fmtDec(calcLineTotal(next), numDec.total);
    next.sellerBrokerage = calcLineCommission(next);
    return next;
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
      totalBeforeRounding, header.rounding, numDec.totalPaymentDue, currentDocEntry ? header : null, getDocumentRoundingPolicy(refData, header),
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
  useRelationshipMapRegistration({
    enabled: Boolean(currentDocEntry),
    objectType: 15,
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
      const existing = vendorPayToAddresses.find(a => String(a.Address || '') === String(prev.payToCode || ''));
      if (existing) return prev;
      const def = vendorPayToAddresses[0];
      if (!def) return prev;
      const fmt = fmtAddr(def);
      if (prev.payToCode === def.Address && prev.payTo === fmt) return prev;
      return { ...prev, payToCode: def.Address || '', payTo: fmt };
    });
  }, [header.vendor, vendorPayToAddresses]);

  useEffect(() => {
    if (!currentDocEntry || !header.vendor) return;

    const resolveAddressCode = (addresses, currentCode, currentText) => {
      const normalizedCode = String(currentCode || '').trim();
      if (normalizedCode && addresses.some((address) => String(address.Address || '').trim() === normalizedCode)) {
        return normalizedCode;
      }

      const normalizedText = normalizeAddressText(currentText);
      if (!normalizedText) return '';

      const matchedAddress = addresses.find((address) => {
        const formatted = normalizeAddressText(fmtAddr(address));
        if (formatted && formatted === normalizedText) return true;

        const compactFormatted = formatted.replace(/\s+/g, '');
        const compactText = normalizedText.replace(/\s+/g, '');
        return compactFormatted && compactFormatted === compactText;
      });

      return matchedAddress ? String(matchedAddress.Address || '').trim() : '';
    };

    const resolvedShipToCode = resolveAddressCode(
      vendorEffectiveShipToAddresses,
      header.shipToCode,
      header.shipToAddress || header.shipTo
    );
    const resolvedBillToCode = resolveAddressCode(
      vendorEffectiveBillToAddresses,
      header.billToCode || header.payToCode,
      header.billToAddress || header.payTo
    );

    if (
      resolvedShipToCode === String(header.shipToCode || '').trim() &&
      resolvedBillToCode === String(header.billToCode || '').trim()
    ) {
      return;
    }

    setHeader((prev) => ({
      ...prev,
      shipToCode: resolvedShipToCode || prev.shipToCode,
      billToCode: resolvedBillToCode || prev.billToCode,
      payToCode: resolvedBillToCode || prev.payToCode,
    }));
  }, [
    currentDocEntry,
    header.vendor,
    header.shipToCode,
    header.shipToAddress,
    header.shipTo,
    header.billToCode,
    header.billToAddress,
    header.payToCode,
    header.payTo,
    vendorEffectiveShipToAddresses,
    vendorEffectiveBillToAddresses,
  ]);

  // â”€â”€ vendor details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadVendorDetails = async (code, options = {}) => {
    const { preserveExisting = false } = options;
    if (!code) {
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setHeader(prev => ({ ...prev, placeOfSupply: '' }));
      return;
    }

    setPageState(p => ({ ...p, vendorLoading: true }));

    try {
      const r = await fetchDeliveryCustomerDetails(code);
      const contacts = r.data.contacts || [];
      const payToAddresses = r.data.pay_to_addresses || [];
      const shipToAddresses = r.data.ship_to_addresses || [];
      const billToAddresses = r.data.bill_to_addresses || [];
      
      setRefData(p => ({
        ...p,
        contacts: contacts,
        pay_to_addresses: payToAddresses,
        ship_to_addresses: shipToAddresses,
        bill_to_addresses: billToAddresses
      }));

      const defaultShipToAddress = shipToAddresses[0] || payToAddresses[0] || null;
      const defaultBillToAddress = billToAddresses[0] || payToAddresses[0] || null;

      setHeader(prev => {
        const nextHeader = { ...prev };

        if (contacts.length > 0 && (!preserveExisting || !prev.contactPerson)) {
          nextHeader.contactPerson = contacts[0].CntctCode;
        }

        if (defaultShipToAddress) {
          const formattedShipTo = fmtAddr(defaultShipToAddress);
          if (!preserveExisting || !prev.shipToCode) {
            nextHeader.shipToCode = defaultShipToAddress.Address || '';
            nextHeader.shipToAddress = formattedShipTo;
            nextHeader.shipTo = formattedShipTo;
          }

          if (defaultShipToAddress.State && (!preserveExisting || !prev.placeOfSupply)) {
            console.log('ðŸŒ Auto-setting Place of Supply from customer address:', defaultShipToAddress.State);
            const stateMatch = refData.states.find(st =>
              st.Name === defaultShipToAddress.State || st.Code === defaultShipToAddress.State
            );
            nextHeader.placeOfSupply = stateMatch ? stateMatch.Code : defaultShipToAddress.State;
          }
        }

        if (defaultBillToAddress && (!preserveExisting || !prev.billToCode)) {
          const formattedBillTo = fmtAddr(defaultBillToAddress);
          nextHeader.billToCode = defaultBillToAddress.Address || '';
          nextHeader.billToAddress = formattedBillTo;
          nextHeader.payToCode = defaultBillToAddress.Address || '';
          nextHeader.payTo = formattedBillTo;
        }

        return nextHeader;
      });

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
    return {
      nextHeader: { ...hdr, name: m.CardName || hdr.name, paymentTerms: m.PayTermsGrpCode != null ? String(m.PayTermsGrpCode) : hdr.paymentTerms, contactPerson: '' },
    };
  };

  // â”€â”€ handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const buildSalesEmployeeSetupRows = () => {
    const rows = effectiveSalesEmployees.map(employee => {
      const row = {
        SlpCode: employee.SlpCode,
        SlpName: employee.SlpName || '',
        Commission: employee.Commission != null ? String(employee.Commission) : '',
        Memo: employee.Memo || '',
        Active: String(employee.Active || 'Y').toUpperCase() !== 'N',
        Employee: false,
      };

      return {
        ...row,
        __original: {
          SlpName: row.SlpName,
          Commission: row.Commission,
          Memo: row.Memo,
          Active: row.Active,
        },
      };
    });

    return [
      ...rows,
      { SlpCode: '', SlpName: '', Commission: '', Memo: '', Active: true, Employee: false },
    ];
  };

  const openSalesEmployeeSetup = () => {
    setSalesEmployeeSetup({ open: true, rows: buildSalesEmployeeSetupRows(), saving: false });
  };

  const closeSalesEmployeeSetup = () => {
    setSalesEmployeeSetup(prev => ({ ...prev, open: false, saving: false }));
  };

  const updateSalesEmployeeSetupRow = (index, field, value) => {
    setSalesEmployeeSetup(prev => {
      const rows = prev.rows.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [field]: value } : row
      ));
      const lastRow = rows[rows.length - 1];
      if (lastRow && String(lastRow.SlpName || '').trim()) {
        rows.push({ SlpCode: '', SlpName: '', Commission: '', Memo: '', Active: true, Employee: false });
      }
      return { ...prev, rows };
    });
  };

  const saveSalesEmployeeSetup = async () => {
    const hasSalesEmployeeSetupChanged = row => {
      const original = row.__original;
      if (!original) return true;

      return (
        String(row.SlpName || '').trim() !== String(original.SlpName || '').trim() ||
        String(row.Commission || '').trim() !== String(original.Commission || '').trim() ||
        String(row.Memo || '').trim() !== String(original.Memo || '').trim() ||
        Boolean(row.Active) !== Boolean(original.Active)
      );
    };

    const rowsToSave = salesEmployeeSetup.rows
      .map(row => ({
        SlpCode: row.SlpCode,
        SlpName: String(row.SlpName || '').trim(),
        Commission: String(row.Commission || '').trim(),
        Memo: row.Memo || '',
        Active: row.Active,
        Employee: row.Employee,
        Changed: hasSalesEmployeeSetupChanged(row),
      }))
      .filter(row => row.SlpName && String(row.SlpCode) !== '-1' && row.Changed);

    setSalesEmployeeSetup(prev => ({ ...prev, saving: true }));
    setPageState(p => ({ ...p, error: '', success: '' }));

    try {
      const response = await saveDeliverySalesEmployeesSetup(rowsToSave);
      setRefData(prev => ({ ...prev, sales_employees: response.data?.sales_employees || [] }));
      setSalesEmployeeSetup({ open: false, rows: [], saving: false });
      setPageState(p => ({ ...p, success: response.data?.message || 'Sales employees setup saved.' }));
    } catch (error) {
      setSalesEmployeeSetup(prev => ({ ...prev, saving: false }));
      setPageState(p => ({ ...p, error: getErrMsg(error, 'Failed to save sales employees setup.') }));
    }
  };

  const handleHeaderChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValErrors(p => ({ ...p, header: { ...p.header, [name]: '' }, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));
    
    console.log('ðŸ”§ [SODA Delivery] handleHeaderChange called:', { name, value, type });
    
    if (name === 'series') {
      handleSeriesChange(value);
      return;
    }

    if (name === 'purchaser') {
      if (value === '__DEFINE_NEW__') {
        openSalesEmployeeSetup();
        return;
      }

      const selectedEmployee = effectiveSalesEmployees.find(
        employee => String(employee.SlpName || '') === String(value || '')
      );

      setHeader(p => ({
        ...p,
        purchaser: value,
        salesEmployee: selectedEmployee ? String(selectedEmployee.SlpCode) : '-1',
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

    if (name === 'billToCode') {
      handleBillToChange(value);
      return;
    }

    if (name === 'shipToCode') {
      handleShipToChange(value);
      return;
    }
    if (numDec[name] !== undefined && type !== 'checkbox') {
      setHeader(p => ({ ...p, [name]: sanitize(value, numDec[name]) }));
      if (name === 'discount') {
        setLines(prevLines => prevLines.map(line => (
          String(line.taxAmount ?? '').trim() ? { ...line, taxAmount: '' } : line
        )));
      }
      return;
    }
    
    if (name === 'branch') {
      console.log('ðŸ¢ [SODA Delivery] Branch changing to:', value);
      const nextWarehouseOptions = value
        ? filterWarehousesByBranch(effectiveWarehouses, value)
        : effectiveWarehouses;
      const hasDefaultWarehouse = nextWarehouseOptions.some(
        (warehouse) => String(warehouse.WhsCode || '') === DEFAULT_WAREHOUSE
      );
      const nextWarehouse = !refData.warehouses.length || hasDefaultWarehouse ? DEFAULT_WAREHOUSE : '';
      setHeader(p => ({ ...p, [name]: value, warehouse: nextWarehouse }));
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
      // Find the state code that matches the state name
      const stateMatch = refData.states.find(st => 
        st.Name === addr.State || st.Code === addr.State
      );
      const stateCode = stateMatch ? stateMatch.Code : (addr.State || '');
      
      setHeader(p => ({
        ...p,
        shipToCode: addressCode,
        shipToAddress: fmtAddr(addr),
        shipTo: fmtAddr(addr),
        placeOfSupply: stateCode
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
        payToCode: addressCode,
        payTo: fmtAddr(addr)
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
            const next = { ...line, itemNo: value, taxAmount: '' };
            
            // Reset batches
            next.batches = [];
            next.inventoryManaged = isInventoryManaged(item);
            next.batchManaged = isBatchManaged(item);
            next.hasBatchesAvailable = next.batchManaged ? true : false;

            if (item && next.batchManaged && next.whse) {
              checkBatchAvailability(next.itemNo, next.whse).then(hasBatches => {
                setLines(prevLines => prevLines.map((l, lIdx) =>
                  lIdx === i ? { ...l, hasBatchesAvailable: hasBatches } : l
                ));
              });
            }
            
            // Step 1: Set Item Details
            next.itemDescription = item.ItemName || next.itemDescription;
            next.uomCode = String(item.SalesUnit || item.InventoryUOM || '').trim();
            
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
              console.log(`âœ… Auto-assigned tax code: ${determinedTaxCode} (${getGSTTypeLabel(companyState, gstState)})`);
            } else {
              console.warn('âš ï¸ Could not determine tax code automatically');
              next.taxCode = '';
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
          const next = { ...line, itemNo: value, taxAmount: '' };
          const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));
          next.batches = [];
          next.inventoryManaged = isInventoryManaged(item);
          next.batchManaged = isBatchManaged(item);
          next.hasBatchesAvailable = false; // Reset batch availability
          
          // Check batch availability if item is batch-managed and warehouse is selected
          if (item && next.batchManaged && next.whse) {
            checkBatchAvailability(next.itemNo, next.whse).then(hasBatches => {
              setLines(prevLines => prevLines.map((l, lIdx) => 
                lIdx === i ? { ...l, hasBatchesAvailable: hasBatches } : l
              ));
            });
          }
          
          if (item) {
            next.itemDescription = item.ItemName || next.itemDescription;
            next.uomCode = String(item.SalesUnit || item.InventoryUOM || '').trim();
            next.hsnCode = item.SWW || item.HSNCode || item.U_HSNCode || next.hsnCode || '';
          }
          next.total = fmtDec(calcLineTotal(next), numDec.total);
          return next;
        }));
      }
      return;
    }
    
    setLines(prev => prev.map((line, idx) => {
      if (idx !== i) return line;
      const next = { ...line, [name]: numDec[name] !== undefined ? sanitize(value, numDec[name]) : value };
                if (name === 'uomName') next.uomNameEdited = true;
                if (name === 'uomCode') { next.uomName = value; next.uomNameEdited = false; }
      if (TAX_SENSITIVE_LINE_FIELDS.has(name)) {
        next.taxAmount = '';
      }
      if (name === 'unitPrice' && String(next.discountAmount ?? '').trim()) {
        next.stdDiscount = fmtDec(roundTo(getLineDiscountPercent(next), numDec.stdDiscount), numDec.stdDiscount);
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
      
      // Handle warehouse change
      if (name === 'whse') {
        next.batches = [];
        next.hasBatchesAvailable = false; // Reset batch availability
        
        // Check batch availability if item is batch-managed and warehouse is selected
        if (next.batchManaged && value) {
          checkBatchAvailability(next.itemNo, value).then(hasBatches => {
            setLines(prevLines => prevLines.map((l, lIdx) => 
              lIdx === i ? { ...l, hasBatchesAvailable: hasBatches } : l
            ));
          });
        }
      }
      
      // Handle UoM change - fetch conversion factor
      if (name === 'uomCode' && value && next.itemNo) {
        // Fetch UoM conversion factor asynchronously
        fetchUomConversionFactor(next.itemNo, value)
          .then(response => {
            const { factor, inventoryUOM: invUoM } = response.data;
            console.log('ðŸ”„ UoM Conversion:', {
              itemCode: next.itemNo,
              documentUoM: value,
              inventoryUOM: invUoM,
              factor,
              docQty: next.quantity,
              baseQty: parseNum(next.quantity) * factor
            });
            
            setLines(prevLines => prevLines.map((l, lIdx) => 
              lIdx === i ? { 
                ...l, 
                uomFactor: factor,
                inventoryUOM: invUoM
              } : l
            ));
          })
          .catch(error => {
            console.error('âŒ Failed to fetch UoM conversion factor:', error);
            // Default to factor 1 if fetch fails
            setLines(prevLines => prevLines.map((l, lIdx) => 
              lIdx === i ? { ...l, uomFactor: 1 } : l
            ));
          });
      }
      
      next.total = fmtDec(calcLineTotal(next), numDec.total);
      return next;
    }));
  };

  const handleNumBlur = (field, target = 'line', i = null) => {
    const d = numDec[field];
    if (d === undefined) return;
    if (target === 'header') { setHeader(p => ({ ...p, [field]: fmtDec(p[field], d) })); return; }
    setLines(p => p.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, [field]: fmtDec(l[field], d) };
      if (field === 'discountAmount') {
        next.stdDiscount = String(next.discountAmount ?? '').trim()
          ? fmtDec(roundTo(getLineDiscountPercent(next), numDec.stdDiscount), numDec.stdDiscount)
          : '';
        next.taxAmount = '';
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      }
      if (field === 'stdDiscount') {
        const price = parseNum(next.unitPrice);
        next.discountAmount = String(next.stdDiscount ?? '').trim() && price > 0
          ? fmtDec(roundTo(price * parseNum(next.stdDiscount) / 100, numDec.discountAmount), numDec.discountAmount)
          : '';
        next.taxAmount = '';
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      }
      if (field === 'quantity' && l.batchManaged && Array.isArray(l.batches) && l.batches.length > 0) {
        next[field] = String(roundTo(parseNum(l[field]), Math.max(d, 6)));
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      }
      next.total = fmtDec(calcLineTotal(next), numDec.total);
      return next;
    }));
  };

  const addLine = () => {
    // Validate the last line before adding a new one
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const lastIndex = lines.length - 1;
      const lastLineInventoryManaged = getLineInventoryManaged(lastLine);
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
      
      // Check if last inventory item line has Warehouse
      if (lastLineInventoryManaged && !String(lastLine.whse || '').trim()) {
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
    
    console.log('âž• [SODA Delivery] Adding new line with header values:', {
      branch: header.branch,
      loc: getWarehouseLocationCode(refData.warehouses, header.warehouse),
      whse: header.warehouse
    });
    
    setLines(p => [...p, { 
      ...createLine(rowUdfDefinitions), 
      branch: header.branch || '', 
      loc: getWarehouseLocationCode(refData.warehouses, header.warehouse),
      whse: header.warehouse || ''
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
  const updateFormSetting = (g, k, prop, val) => setFormSettings(p => {
    return { ...p, [g]: { ...(p[g] || {}), [k]: { ...((p[g] || {})[k] || {}), [prop]: val } } };
  });
  const loadHeaderBillToPartyDetails = useCallback(
    (partyCode) => fetchDeliveryCustomerDetails(partyCode).then((response) => response.data),
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
    const shipAddress = resolveDeliveryAddress(
      header.shipToCode,
      vendorEffectiveShipToAddresses,
      header.shipToAddress || header.shipTo,
    );
    const billAddress = resolveDeliveryAddress(
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
        shipToCode: addressForm.shipToCode,
        shipTo: formatted || addressForm.shipToAddress,
        shipToAddress: formatted || addressForm.shipToAddress,
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
        billToCode: addressForm.billToCode,
        payToCode: addressForm.billToCode,
        billToAddress: formatted || addressForm.billToAddress,
        payTo: formatted || addressForm.billToAddress,
      }));
    }
    closeAddressModal();
  };

  const handleAddressFormChange = (e) => {
    const { name, value } = e.target;

    if (name === 'shipToCode') {
      const selectedAddress = resolveDeliveryAddress(value, vendorEffectiveShipToAddresses);
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
      const selectedAddress = resolveDeliveryAddress(value, vendorEffectiveBillToAddresses);
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
              error: getErrMsg(error, 'Failed to load available batches.'),
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
    setLines(prev => prev.map((line, index) => {
      if (index !== batchModal.lineIndex) return line;

      const assignedBaseQty = sumBatchQty(nextBatches);
      const uomFactor = getLineUomFactor(line);
      const nextDocumentQty = uomFactor > 0
        ? roundTo(assignedBaseQty / uomFactor, 6)
        : roundTo(assignedBaseQty, 6);
      const updatedLine = {
        ...line,
        batches: nextBatches,
        quantity: String(nextDocumentQty),
      };

      return {
        ...updatedLine,
        total: fmtDec(calcLineTotal(updatedLine), numDec.total),
      };
    }));
    setValErrors(prev => ({
      ...prev,
      lines: {
        ...prev.lines,
        [batchModal.lineIndex]: {
          ...(prev.lines[batchModal.lineIndex] || {}),
          batches: '',
          quantity: '',
        },
      },
      form: '',
    }));
    closeBatchModal();
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
  const getPaymentTermsLookupOptions = () => {
    const sourceTerms = refData.payment_terms.length
      ? refData.payment_terms.map((term) => ({
          code: String(term.GroupNum ?? ''),
          name: term.PymntGroup || String(term.GroupNum ?? ''),
        }))
      : FALLBACK_PAYMENT_TERMS.map((term) => ({
          code: term.value,
          name: term.label,
        }));

    return sourceTerms
      .filter((term) => term.name)
      .map((term) => ({
        value: term.name,
        description: term.code ? `Code: ${term.code}` : '',
        label: term.code ? `${term.name} (${term.code})` : term.name,
      }));
  };

  const openPaymentTermsModal = (field, lineIndex) => {
    setQualityModal({
      open: true,
      lineIndex,
      field,
      title: 'List of Buyer Terms of Payment',
      options: getPaymentTermsLookupOptions(),
      searchPlaceholder: 'Search payment terms',
      emptyMessage: 'No payment terms found',
      allowCreate: false,
    });
  };

  const openQualityModal = (field, lineIndex) => {
    const optionMap = {
      buyerQuality: {
        title: 'List of Buyer Quality Values',
        options: refData.quality_options?.buyer || [],
        searchPlaceholder: 'Search buyer quality values',
        emptyMessage: 'No buyer quality values found',
      },
      sellerQuality: {
        title: 'List of Seller Quality Values',
        options: refData.quality_options?.seller || [],
        searchPlaceholder: 'Search seller quality values',
        emptyMessage: 'No seller quality values found',
      },
      buyerPrice: {
        title: 'List of Buyer Price Values',
        options: refData.price_options?.buyer || [],
        searchPlaceholder: 'Search buyer price values',
        emptyMessage: 'No buyer price values found',
      },
      sellerPrice: {
        title: 'List of Seller Price Values',
        options: refData.price_options?.seller || [],
        searchPlaceholder: 'Search seller price values',
        emptyMessage: 'No seller price values found',
      },
    };

    const nextConfig = optionMap[field] || {
      title: 'List of User-Defined Values',
      options: [],
      searchPlaceholder: 'Search values',
      emptyMessage: 'No values found',
      allowCreate: true,
    };

    setQualityModal({
      open: true,
      lineIndex,
      field,
      title: nextConfig.title,
      options: nextConfig.options,
      searchPlaceholder: nextConfig.searchPlaceholder,
      emptyMessage: nextConfig.emptyMessage,
      allowCreate: nextConfig.allowCreate !== false,
    });
  };

  const closeQualityModal = () => {
    setQualityModal({
      open: false,
      lineIndex: -1,
      field: '',
      title: 'List of User-Defined Values',
      options: [],
      searchPlaceholder: 'Search values',
      emptyMessage: 'No values found',
      allowCreate: true,
    });
  };

  const handleQualitySelect = (option) => {
    if (qualityModal.lineIndex < 0 || !qualityModal.field) return;

    setLines(prev => prev.map((line, idx) => (
      idx === qualityModal.lineIndex
        ? { ...line, [qualityModal.field]: option?.value || '' }
        : line
    )));
  };

  const handleQualityCreate = async ({ value, description }) => {
    const field = qualityModal.field;
    if (!field) return null;

    const response = await createDeliveryLookupValue(field, value, description);
    const createdOption = response?.data?.option || {
      value,
      description: description || value,
      label: description && description !== value ? `${value} - ${description}` : value,
    };
    const nextOptions = response?.data?.options || [];

    setRefData((prev) => {
      const next = { ...prev };

      if (field === 'buyerQuality' || field === 'sellerQuality') {
        next.quality_options = {
          ...(prev.quality_options || { buyer: [], seller: [] }),
          [field === 'buyerQuality' ? 'buyer' : 'seller']: nextOptions,
        };
      }

      if (field === 'buyerPrice' || field === 'sellerPrice') {
        next.price_options = {
          ...(prev.price_options || { buyer: [], seller: [] }),
          [field === 'buyerPrice' ? 'buyer' : 'seller']: nextOptions,
        };
      }

      return next;
    });

    setQualityModal((prev) => ({
      ...prev,
      options: nextOptions,
    }));

    return createdOption;
  };

  const openItemModal = async (lineIndex) => {
    console.log('ðŸ” Opening item modal for line:', lineIndex);
    setItemModal({ open: true, lineIndex, items: [], loading: true });
    
    try {
      console.log('ðŸ“¡ Fetching items from API...');
      const selectedWarehouse = lines[lineIndex]?.whse || header.warehouse || '';
      const response = await fetchItemsForModal(selectedWarehouse);
      console.log('âœ… Items received:', response.data);
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
    
    console.log('ðŸŽ¯ [handleItemSelect] Item selected:', {
      ItemCode: item.ItemCode,
      ItemName: item.ItemName,
      BatchManaged: item.BatchManaged,
      ManBtchNum: item.ManBtchNum,
      InventoryItem: item.InventoryItem,
      inventoryManaged: isInventoryManaged(mergedItem),
      isBatchManaged: isBatchManaged(item),
      SalesUnit: item.SalesUnit,
      InventoryUOM: item.InventoryUOM
    });
    
    try {
      const hsnRes = await fetchHSNCodeFromItem(mergedItem.ItemCode);
      const hsnData = hsnRes.data;
      
      // Get the current line to check warehouse
      const currentLine = lines[lineIndex];
      const itemIsInventoryManaged = isInventoryManaged(mergedItem);
      const itemIsBatchManaged = isBatchManaged(mergedItem);
      
      // Get UoM - prefer SalesUnit, fallback to InventoryUOM
      // Note: UoM codes can be numeric (e.g., "5.6" meaning 5.6BOX)
      const selectedUoM = mergedItem.SalesUnit || mergedItem.InventoryUOM || '';
      const displayUoM = selectedUoM;
      
      console.log('ðŸ” [handleItemSelect] Selected UoM:', {
        SalesUnit: item.SalesUnit,
        InventoryUOM: item.InventoryUOM,
        selectedUoM,
        displayUoM,
        UoMGroupEntry: item.UoMGroupEntry
      });
      
      // Log available UoMs for this item from UoM Group
      if (item.UoMGroupEntry && refData.uom_groups) {
        const uomGroup = refData.uom_groups.find(g => g.AbsEntry === item.UoMGroupEntry);
        if (uomGroup) {
          console.log('ðŸ“¦ [handleItemSelect] UoM Group Info:', {
            groupName: uomGroup.Name,
            availableUoMs: uomGroup.uomCodes,
            conversions: uomGroup.conversions
          });
        } else {
          console.warn('âš ï¸ [handleItemSelect] UoM Group not found:', item.UoMGroupEntry);
        }
      }
      
      // Fetch UoM conversion factor
      let uomFactor = 1;
      let inventoryUOM = mergedItem.InventoryUOM || '';
      
      if (selectedUoM && mergedItem.ItemCode) {
        try {
          console.log('ðŸ” [handleItemSelect] Fetching UoM conversion for:', {
            itemCode: item.ItemCode,
            selectedUoM,
            itemInventoryUOM: item.InventoryUOM
          });
          
          const uomRes = await fetchUomConversionFactor(mergedItem.ItemCode, selectedUoM);
          
          console.log('ðŸ“¦ [handleItemSelect] UoM API Response:', uomRes.data);
          
          uomFactor = uomRes.data.factor || 1;
          inventoryUOM = uomRes.data.inventoryUOM || mergedItem.InventoryUOM || '';
          
          const docQty = parseNum(currentLine.quantity);
          
          console.log('ðŸ”„ [handleItemSelect] UoM Conversion Applied:', {
            itemCode: item.ItemCode,
            documentUoM: selectedUoM,
            inventoryUOM,
            factor: uomFactor,
            documentQty: docQty,
            baseQty: docQty * uomFactor,
            calculation: `${docQty} ${selectedUoM} Ã— ${uomFactor} = ${docQty * uomFactor} ${inventoryUOM}`
          });
        } catch (uomError) {
          console.error('âŒ [handleItemSelect] Failed to fetch UoM conversion:', uomError);
          console.error('âŒ [handleItemSelect] Error details:', {
            message: uomError.message,
            response: uomError.response?.data,
            status: uomError.response?.status
          });
        }
      } else {
        console.warn('âš ï¸ [handleItemSelect] Skipping UoM conversion - missing data:', {
          hasSelectedUoM: !!selectedUoM,
          hasItemCode: !!item.ItemCode
        });
      }
      
      // Check batch availability BEFORE updating state if item is batch-managed
      let hasBatchesAvailable = false;
      if (itemIsBatchManaged && currentLine.whse) {
        console.log('ðŸ” [handleItemSelect] Checking batch availability for:', {
          itemCode: item.ItemCode,
          warehouse: currentLine.whse
        });
        hasBatchesAvailable = await checkBatchAvailability(mergedItem.ItemCode, currentLine.whse);
        console.log('âœ… [handleItemSelect] Batch availability result:', hasBatchesAvailable);
      }
      
      setLines(prev => prev.map((line, idx) => {
        if (idx === lineIndex) {
          const updatedLine = {
            ...hydrateDocumentLineFromItem(line, mergedItem, {
              side: 'sales',
              hsnCode: hsnData.hsnCode || hsnData.hsn_sww || '',
              fallbackWarehouse: header.warehouse,
              calcLineTotal,
              formatTotal: (value) => fmtDec(value, numDec.total),
            }),
            uomCode: displayUoM, // Use the validated UoM for display
            batches: [],
            inventoryManaged: itemIsInventoryManaged,
            batchManaged: itemIsBatchManaged,
            hasBatchesAvailable: itemIsBatchManaged ? hasBatchesAvailable : false,
            inventoryUOM: inventoryUOM,
            uomFactor: uomFactor,
            taxAmount: '',
          };
          
          console.log('ðŸ“ [handleItemSelect] Updated line:', {
            itemNo: updatedLine.itemNo,
            inventoryManaged: updatedLine.inventoryManaged,
            batchManaged: updatedLine.batchManaged,
            hasBatchesAvailable: updatedLine.hasBatchesAvailable,
            warehouse: updatedLine.whse,
            uomCode: updatedLine.uomCode,
            inventoryUOM: updatedLine.inventoryUOM,
            uomFactor: updatedLine.uomFactor
          });
          
          // Auto-determine tax code
          const gstState = header.placeOfSupply;
          const companyState = refData.company_address?.State || selectedBranch?.State || '';
          
          if (gstState && companyState) {
            const determinedTaxCode = determineTaxCode(
              item,
              gstState,
              gstState,
              false,
              companyState,
              effectiveTaxCodes
            );
            
            if (determinedTaxCode) {
              updatedLine.taxCode = determinedTaxCode;
            }
          }
          
          updatedLine.total = fmtDec(calcLineTotal(updatedLine), numDec.total);
          return updatedLine;
        }
        return line;
      }));
      
      closeItemModal();
    } catch (error) {
      console.error('âŒ [handleItemSelect] Error selecting item:', error);
      // Still set basic item info even if HSN fetch fails
      const currentLine = lines[lineIndex];
      const itemIsInventoryManaged = isInventoryManaged(mergedItem);
      const itemIsBatchManaged = isBatchManaged(mergedItem);
      const selectedUoM = mergedItem.SalesUnit || mergedItem.InventoryUOM || '';
      
      // Try to get UoM conversion in error case
      let uomFactor = 1;
      let inventoryUOM = mergedItem.InventoryUOM || '';
      
      if (selectedUoM && mergedItem.ItemCode) {
        try {
          const uomRes = await fetchUomConversionFactor(mergedItem.ItemCode, selectedUoM);
          uomFactor = uomRes.data.factor || 1;
          inventoryUOM = uomRes.data.inventoryUOM || mergedItem.InventoryUOM || '';
        } catch (uomError) {
          console.error('âŒ [handleItemSelect] Failed to fetch UoM conversion in error handler:', uomError);
        }
      }
      
      // Check batch availability in error case too
      let hasBatchesAvailable = false;
      if (itemIsBatchManaged && currentLine.whse) {
        try {
          hasBatchesAvailable = await checkBatchAvailability(mergedItem.ItemCode, currentLine.whse);
        } catch (batchError) {
          console.error('âŒ [handleItemSelect] Error checking batch availability:', batchError);
        }
      }
      
      setLines(prev => prev.map((line, idx) => {
        if (idx === lineIndex) {
          const updatedLine = {
            ...hydrateDocumentLineFromItem(line, mergedItem, {
              side: 'sales',
              hsnCode: mergedItem.HSNCode || '',
              fallbackWarehouse: header.warehouse,
              calcLineTotal,
              formatTotal: (value) => fmtDec(value, numDec.total),
            }),
            uomCode: selectedUoM,
            batches: [],
            inventoryManaged: itemIsInventoryManaged,
            batchManaged: itemIsBatchManaged,
            hasBatchesAvailable: itemIsBatchManaged ? hasBatchesAvailable : false,
            inventoryUOM: inventoryUOM,
            uomFactor: uomFactor,
            taxAmount: '',
          };
          updatedLine.total = fmtDec(calcLineTotal(updatedLine), numDec.total);
          
          return updatedLine;
        }
        return line;
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

  // â”€â”€ Sync warehouse and branch from header to lines â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Sync branch to all lines when header branch changes
  useEffect(() => {
    if (isHydratingDocumentRef.current) return;
    console.log('ðŸ”„ [SODA Delivery] Branch sync useEffect triggered');
    console.log('ðŸ”„ [SODA Delivery] header.branch value:', header.branch);
    console.log('ðŸ”„ [SODA Delivery] header.branch type:', typeof header.branch);
    console.log('ðŸ”„ [SODA Delivery] Current lines count:', lines.length);
    
    if (header.branch) {
      console.log('ðŸ”„ [SODA Delivery] Syncing branch to all lines:', header.branch);
      setLines(prev => {
        console.log('ðŸ”„ [SODA Delivery] Previous lines:', prev.map(l => ({ itemNo: l.itemNo, branch: l.branch, loc: l.loc })));
        const updated = prev.map(l => ({ 
          ...l, 
          branch: String(header.branch)
        }));
        console.log('âœ… [SODA Delivery] Updated lines:', updated.map(l => ({ itemNo: l.itemNo, branch: l.branch, loc: l.loc })));
        return updated;
      });
    } else {
      console.log('âš ï¸ [SODA Delivery] Branch is empty, skipping sync');
    }
  }, [header.branch]);
  
  // Initial sync: Set branch on existing lines when branch is first loaded
  useEffect(() => {
    if (isHydratingDocumentRef.current) return;
    if (header.branch && lines.length > 0) {
      const needsSync = lines.some(l => !l.branch || l.branch !== String(header.branch));
      if (needsSync) {
        console.log('ðŸ”„ [SODA Delivery] Initial branch sync needed');
        setLines(prev => prev.map(l => ({ 
          ...l, 
          branch: String(header.branch)
        })));
      }
    }
  }, [refData.branches]); // Trigger when branches are loaded

  // Debug: Log when lines change
  useEffect(() => {
    console.log('ðŸ“ [SODA Delivery] Lines state changed:', lines.map(l => ({ itemNo: l.itemNo, branch: l.branch, loc: l.loc, whse: l.whse })));
  }, [lines]);
  
  // Debug: Log header.branch value
  useEffect(() => {
    console.log('ðŸ¢ [SODA Delivery] Header branch value:', header.branch);
  }, [header.branch]);

  useEffect(() => {
    if (isHydratingDocumentRef.current) return;
    if (!header.branch || !refData.warehouses.length) return;

    const allowedWarehouseCodes = new Set(
      branchFilteredWarehouses.map(w => String(w.WhsCode || ''))
    );

    setLines(prev => prev.map(line => (
      line.whse && !allowedWarehouseCodes.has(String(line.whse))
        ? { ...line, whse: '', hasBatchesAvailable: false, batches: [] }
        : line
    )));
  }, [branchFilteredWarehouses, header.branch, refData.warehouses.length]);

  // Sync warehouse to all lines when header warehouse changes and refresh batch availability
  useEffect(() => {
    if (isHydratingDocumentRef.current) return;
    if (!header.warehouse) {
      setLines(prev => prev.map(l => ({ ...l, whse: '', hasBatchesAvailable: false, batches: [] })));
      return;
    }

    setLines(prev => prev.map((line, index) => {
      const next = { ...line, whse: header.warehouse };

      if (next.itemNo && next.batchManaged) {
        next.hasBatchesAvailable = false;
        next.batches = [];

        checkBatchAvailability(next.itemNo, header.warehouse).then(hasBatches => {
          setLines(prevLines => prevLines.map((l, idx) => (
            idx === index ? { ...l, hasBatchesAvailable: hasBatches } : l
          )));
        });
      } else {
        next.hasBatchesAvailable = false;
        next.batches = [];
      }

      return next;
    }));
  }, [header.warehouse]);

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
  }, [currentDocEntry, header.placeOfSupply, header.vendor, refData.company_address, selectedBranch, refData.items, effectiveTaxCodes]);

  // Continue in next part...

  // â”€â”€ validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const validate = async () => {
    const isUpdate = !!currentDocEntry;
    const e = { header: {}, lines: {}, form: '' };
    const pop = lines.filter(l => String(l.itemNo || '').trim());
    const hasInventoryManagedLines = pop.some(getLineInventoryManaged);
    
    // Frontend basic validation first
    if (!isUpdate) {
      const vc = String(header.vendor || '').trim();
      if (!vc) { e.header.vendor = 'Select a customer.'; e.form = 'Please correct the highlighted fields.'; return e; }
    }
    
    if (!String(header.postingDate || '').trim()) { e.header.postingDate = 'Posting date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (!String(header.documentDate || '').trim()) { e.header.documentDate = 'Document date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (hasInventoryManagedLines && !String(header.warehouse || '').trim()) { e.header.warehouse = 'Warehouse is required for inventory items.'; e.form = 'Please correct the highlighted fields.'; return e; }
    for (const field of headerUdfDefinitions.filter(field => field.required)) {
      if (!String(headerUdfs[field.key] ?? '').trim()) {
        e.header[field.key] = `${field.label || field.key} is required.`;
        e.form = 'Please complete required UDF fields.';
        return e;
      }
    }

    if (!pop.length) { e.form = 'Add at least one item line.'; return e; }
    
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!String(l.itemNo || '').trim()) continue;
      const lineInventoryManaged = getLineInventoryManaged(l);
      for (const field of rowUdfDefinitions.filter(field => field.required)) {
        if (!String(l.udf?.[field.key] ?? '').trim()) {
          e.lines[i] = { ...(e.lines[i] || {}), [field.key]: `${field.label || field.key} is required.` };
          e.form = 'Please complete required row UDF fields.';
          return e;
        }
      }

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

      if (lineInventoryManaged && !l.whse && !isUpdate) {
        e.lines[i] = { ...(e.lines[i] || {}), whse: 'Warehouse is required' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      // Enhanced tax code validation
      if (!l.taxCode || l.taxCode === 'Select' || l.taxCode === '') {
        e.lines[i] = { ...(e.lines[i] || {}), taxCode: 'Please select a valid Tax Code' };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }

      // Enhanced batch validation with UoM conversion
      if (lineInventoryManaged && l.batchManaged && l.hasBatchesAvailable !== false) {
        if (!Array.isArray(l.batches) || l.batches.length === 0) {
          e.lines[i] = { ...(e.lines[i] || {}), batches: 'Batch selection is mandatory for batch-managed item' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }
        
        const baseQty = getRequiredBatchQty(l);
        const batchQty = sumBatchQty(l.batches);
        const inventoryUOM = l.inventoryUOM || l.uomCode || '';
        
        if (Math.abs(batchQty - baseQty) > BATCH_QTY_TOLERANCE) {
          e.lines[i] = { ...(e.lines[i] || {}), batches: `Batch quantity (${batchQty.toFixed(2)} ${inventoryUOM}) must match base quantity (${baseQty.toFixed(2)} ${inventoryUOM})` };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }
      }
      
      const hasTaxCode = String(l.taxCode || '').trim();
      const taxCodeExists = !hasTaxCode || effectiveTaxCodes.some(t => String(t.Code) === String(l.taxCode));
      if (!taxCodeExists) {
        e.lines[i] = { ...(e.lines[i] || {}), taxCode: `Tax code '${l.taxCode}' is not valid in SAP B1` };
        e.form = 'Please correct the highlighted fields.';
        return e;
      }
    }
    
    // If frontend validation passes, call backend validation
    try {
      const submitBranch = alignBranchWithWarehouse(
        header.branch,
        header.warehouse || lines.find(l => String(l.whse || '').trim())?.whse,
        effectiveWarehouses
      );
      const validationPayload = {
        header: {
          customerCode: header.vendor,
          postingDate: header.postingDate,
          documentDate: header.documentDate,
          branch: submitBranch,
          series: header.series
        },
        lines: lines.filter(l => String(l.itemNo || '').trim()).map(l => ({
          itemNo: l.itemNo,
          quantity: l.quantity,
          whse: l.whse,
          taxCode: l.taxCode,
          uomCode: l.uomCode,
          uomFactor: l.uomFactor,
          inventoryUOM: l.inventoryUOM,
          inventoryManaged: getLineInventoryManaged(l),
          batchManaged: l.batchManaged,
          batches: l.batches || []
        }))
      };

      const backendValidation = await validateDeliveryDocument(validationPayload);
      
      if (!backendValidation.data.success) {
        // Map backend validation errors to frontend format
        const backendErrors = backendValidation.data.errors;
        
        for (const error of backendErrors) {
          if (error.includes('Customer Code')) {
            e.header.vendor = error;
          } else if (error.includes('Posting Date')) {
            e.header.postingDate = error;
          } else if (error.includes('Document Date')) {
            e.header.documentDate = error;
          } else if (error.includes('Branch')) {
            e.header.branch = error;
          } else if (error.includes('Tax Code')) {
            // Find the line number for tax code error
            const lineMatch = error.match(/line (\d+)/);
            if (lineMatch) {
              const lineIndex = parseInt(lineMatch[1]) - 1;
              e.lines[lineIndex] = { ...(e.lines[lineIndex] || {}), taxCode: 'Please select a valid Tax Code' };
            }
          } else if (
            error.includes('batch-managed') ||
            error.includes('Batch quantity') ||
            error.includes('exceeds available quantity')
          ) {
            // Find the line for batch error
            const itemMatch = error.match(/item ([^.,]+)/i);
            if (itemMatch) {
              const itemCode = itemMatch[1].trim();
              const lineIndex = lines.findIndex(l => l.itemNo === itemCode);
              if (lineIndex >= 0) {
                e.lines[lineIndex] = {
                  ...(e.lines[lineIndex] || {}),
                  batches: error.includes('batch-managed')
                    ? 'Batch selection is mandatory for batch-managed item'
                    : error
                };
              }
            }
          } else if (error.includes('Insufficient stock')) {
            // Find the line for stock error
            const itemMatch = error.match(/item ([A-Z0-9]+)/);
            if (itemMatch) {
              const itemCode = itemMatch[1];
              const lineIndex = lines.findIndex(l => l.itemNo === itemCode);
              if (lineIndex >= 0) {
                e.lines[lineIndex] = { ...(e.lines[lineIndex] || {}), quantity: error };
              }
            }
          } else if (error.includes('Warehouse') && error.includes('branch')) {
            // Find the line for warehouse-branch error
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].whse) {
                e.lines[i] = { ...(e.lines[i] || {}), whse: 'Warehouse does not belong to selected branch' };
                break;
              }
            }
          } else if (error.includes('Series')) {
            e.header.series = error;
          } else {
            // Generic error
            e.form = error;
          }
        }
        
        e.form = e.form || 'Please correct the highlighted fields.';
      }
    } catch (validationError) {
      console.error('Backend validation error:', validationError);
      const backendErrors = validationError.response?.data?.errors || [];
      if (backendErrors.length > 0) {
        for (const error of backendErrors) {
          if (error.includes('Insufficient stock')) {
            const itemMatch = error.match(/item ([^ ]+) in warehouse/i);
            const itemCode = itemMatch?.[1];
            const lineIndex = lines.findIndex(l => String(l.itemNo) === String(itemCode));
            if (lineIndex >= 0) {
              e.lines[lineIndex] = { ...(e.lines[lineIndex] || {}), quantity: error };
            } else {
              e.form = error;
            }
          } else {
            e.form = error;
          }
        }
        e.form = e.form || 'Please correct the highlighted fields.';
      } else {
        e.form = getErrMsg(validationError, 'SODA Delivery validation failed.');
      }
    }
    
    // Validate GST tax code combinations (after loop)
    const taxCodesUsed = new Set(pop.map(l => l.taxCode).filter(Boolean));
    const sgstCodes = getTaxComponentCodes(taxCodesUsed, effectiveTaxCodes, 'SGST');
    const cgstCodes = getTaxComponentCodes(taxCodesUsed, effectiveTaxCodes, 'CGST');

    if (sgstCodes.length > 0 && cgstCodes.length === 0) {
      e.form = 'SGST requires CGST to be applied as well. Please check tax codes in line items.';
      return e;
    }
    if (cgstCodes.length > 0 && sgstCodes.length === 0) {
      e.form = 'CGST requires SGST to be applied as well. Please check tax codes in line items.';
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
        e.form = 'SGST and CGST rates must be equal. Please check tax codes in line items.';
        return e;
      }
    }

    // Prevent save if total is 0
    const currentTotals = calcTotals();
    if (currentTotals.total <= 0) {
      e.form = 'Total amount must be greater than 0. Please add items with valid prices.';
      return e;
    }

    return e;
  };

  // â”€â”€ Copy From handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCopyFrom = (data, sourceType) => {
    setSeriesRevision(value => value + 1);

    const sourceDocument = data || {};
    const unwrappedDocument =
      sourceDocument.sales_order ||
      sourceDocument.salesOrder ||
      sourceDocument.sales_quotation ||
      sourceDocument.salesQuotation ||
      sourceDocument.delivery ||
      sourceDocument.return ||
      sourceDocument.document ||
      sourceDocument;
    const srcHeader = unwrappedDocument.header ? unwrappedDocument.header : unwrappedDocument;
    const unwrappedLines = getDocumentLines(unwrappedDocument);
    const sourceLines = unwrappedLines.length ? unwrappedLines : getDocumentLines(sourceDocument);
    const baseType = BASE_TYPE[sourceType] || 17;
    const toDateInputValue = (value) => {
      if (!value) return '';
      const text = String(value);
      return text.includes('T') ? text.split('T')[0] : text.slice(0, 10);
    };
    const baseEntry =
      unwrappedDocument.DocEntry ??
      unwrappedDocument.docEntry ??
      unwrappedDocument.doc_entry ??
      sourceDocument.DocEntry ??
      sourceDocument.docEntry ??
      sourceDocument.doc_entry ??
      null;
    const normHeader = normaliseDocumentHeader(srcHeader);
    const firstSourceLine = sourceLines.length ? sourceLines[0] : {};
    const firstLineWarehouse =
      firstSourceLine?.whse ||
      firstSourceLine?.WarehouseCode ||
      firstSourceLine?.WhsCode ||
      '';
    const copiedLocation = resolveCopiedBranchWarehouse({
      sourceBranch: normHeader.branch || srcHeader.branch || srcHeader.BPL_IDAssignedToInvoice || srcHeader.BPLId,
      sourceWarehouse: srcHeader.warehouse,
      fallbackWarehouse: firstLineWarehouse,
      warehouses: refData.warehouses.length ? refData.warehouses : FALLBACK_WAREHOUSES,
    });

    setHeader(prev => ({
      ...prev,
      ...normHeader,
      deliveryDate: toDateInputValue(srcHeader.deliveryDate || srcHeader.DocDueDate || prev.deliveryDate || ''),
      vendor: normHeader.vendor || srcHeader.customerCode || srcHeader.customer || srcHeader.CardCode || '',
      name: normHeader.name || srcHeader.customerName || srcHeader.name || srcHeader.CardName || '',
      contactPerson: normHeader.contactPerson || srcHeader.contactPerson || srcHeader.CntctCode || '',
      branch: copiedLocation.branch,
      warehouse: copiedLocation.warehouse || prev.warehouse || DEFAULT_WAREHOUSE,
      paymentTerms: normHeader.paymentTerms || srcHeader.paymentTerms || srcHeader.GroupNum || '',
      placeOfSupply: normHeader.placeOfSupply || srcHeader.placeOfSupply || srcHeader.PlaceOfSupply || '',
      salesContractNo: srcHeader.salesContractNo || srcHeader.customerRefNo || srcHeader.NumAtCard || '',
      otherInstruction: normHeader.otherInstruction || srcHeader.otherInstruction || srcHeader.remarks || srcHeader.Comments || '',
      discount: srcHeader.discount || srcHeader.DiscPrcnt || '',
      freight: srcHeader.freight || srcHeader.Freight || '',
      tax: srcHeader.tax || srcHeader.TaxAmount || '',
      currency: srcHeader.currency || srcHeader.DocCur || prev.currency || 'INR',
      shipTo: srcHeader.shipTo || srcHeader.shipToAddress || srcHeader.Address || '',
      shipToCode: srcHeader.shipToCode || srcHeader.ShipToCode || '',
      shipToAddress: srcHeader.shipToAddress || srcHeader.shipTo || srcHeader.Address || '',
      payTo: srcHeader.payTo || srcHeader.billToAddress || srcHeader.Address2 || '',
      payToCode: srcHeader.payToCode || srcHeader.billToCode || srcHeader.PayToCode || '',
      billToCode: srcHeader.billToCode || srcHeader.payToCode || srcHeader.PayToCode || '',
      billToAddress: srcHeader.billToAddress || srcHeader.payTo || srcHeader.Address2 || '',
    }));
    const copiedHeaderUdfs = mergeUdfValues(
      srcHeader.header_udfs,
      srcHeader.headerUdfs,
      sourceDocument.header_udfs,
      sourceDocument.headerUdfs,
      unwrappedDocument.header_udfs,
      unwrappedDocument.headerUdfs
    );
    setHeaderUdfs({
      ...copiedHeaderUdfs,
      ...normalizeUdfState(headerUdfDefinitions, copiedHeaderUdfs),
    });

    const newLines = sourceLines.map((line, idx) => {
      const normalizedLine = normaliseDocumentLine(line, idx, baseEntry, baseType, copiedLocation.branch);
      const copiedLineUdfs = mergeUdfValues(line.line_udfs, line.lineUdfs, line.udf, normalizedLine.udf);
      const item = refData.items.find(it => String(it.ItemCode || '') === String(normalizedLine.itemNo || ''));
      const inventoryManaged = item ? isInventoryManaged(item) : isInventoryManaged(line);
      const batchManaged = item ? isBatchManaged(item) : isBatchManaged(line);
      return {
        ...createLine(rowUdfDefinitions),
        ...normalizedLine,
        baseEntry: line.baseEntry ?? line.BaseEntry ?? baseEntry,
        baseType: line.baseType ?? line.BaseType ?? baseType,
        baseLine: line.baseLine ?? line.BaseLine ?? line.lineNum ?? line.LineNum ?? normalizedLine.baseLine ?? idx,
        taxCode: normalizedLine.taxCode || line.taxCode || line.TaxCode || line.VatGroup || '',
        stcode: normalizedLine.stcode || line.stcode || '',
        branch: normalizedLine.branch || copiedLocation.branch,
        loc: normalizedLine.loc || getWarehouseLocationCode(refData.warehouses, normalizedLine.whse || line.whse || line.WarehouseCode || line.WhsCode || copiedLocation.warehouse),
        whse: normalizedLine.whse || line.whse || line.WarehouseCode || line.WhsCode || copiedLocation.warehouse || DEFAULT_WAREHOUSE,
        commission: normalizedLine.commission || line.commission || line.Commission || DEFAULT_COMMISSION_PERCENT,
        inventoryManaged,
        batchManaged,
        hasBatchesAvailable: batchManaged ? true : false,
        udf: {
          ...copiedLineUdfs,
          ...normalizeUdfState(rowUdfDefinitions, copiedLineUdfs),
        },
      };
    });
    setLines(newLines.length > 0 ? newLines : [createLine(rowUdfDefinitions)]);

    const cardCode = normHeader.vendor || srcHeader.customerCode || srcHeader.customer || srcHeader.CardCode;
    if (cardCode && cardCode !== header.vendor) loadVendorDetails(cardCode);

    const labels = { salesOrder: 'SODA Sales Order', sodaSalesOrder: 'SODA Sales Order', salesQuotation: 'Sales Quotation', delivery: 'Delivery', sodaDelivery: 'SODA Delivery', returns: 'Return', blanket: 'Blanket Agreement' };
    setPageState(p => ({ ...p, success: `Copied from ${labels[sourceType] || sourceType}` }));
  };

  // â”€â”€ Copy From Modal Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openCopyFromModal = (docType) => {
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

    setCopyFromDocType(docType);
    setCopyFromModal(true);
  };

  // â”€â”€ Copy From fetch handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchCopyFromDocuments = async (docType) => {
    try {
      const bpCode = String(header.vendor || '').trim();
      if (!bpCode) return [];

      // Sales Quotations: use dedicated API
      if (docType === 'salesQuotation') {
        const res = await fetchOpenSalesQuotationsForDelivery(bpCode);
        return res?.data?.quotations || res?.data?.documents || [];
      }
      // Sales Orders: filter by current customer for relevance
      if (docType === 'salesOrder') {
        const res = await fetchOpenSalesOrders(bpCode);
        return res?.data?.orders || [];
      }
      // Returns (AR Credit Memo): use dedicated API
      if (docType === 'returns') {
        const res = await fetchOpenReturnsForDelivery();
        return res?.data?.creditMemos || [];
      }
      // Blanket Agreements: use dedicated API
      if (docType === 'blanket') {
        const res = await fetchOpenBlanketAgreementsForDelivery();
        return res?.data?.agreements || [];
      }
      return await sodaDeliveryCopyFromApi.fetchOpenDocuments(docType, bpCode);
    } catch (err) {
      console.error('Error fetching documents:', err);
      throw err;
    }
  };

  const fetchCopyFromDocumentDetails = async (docType, docEntry) => {
    try {
      if (docType === 'salesQuotation') {
        const res = await fetchSalesQuotationForDeliveryCopy(docEntry);
        return res.data;
      }
      if (docType === 'salesOrder') {
        const res = await fetchSalesOrderForCopy(docEntry);
        const copyData = res.data || {};

        try {
          const detailRes = await fetchSalesOrderByDocEntry(docEntry);
          return mergeSalesOrderCopyUdfs(copyData, detailRes.data || {});
        } catch (detailError) {
          console.warn('Failed to load full sales order UDF detail. Using copy payload only.', detailError);
          return copyData;
        }
      }
      if (docType === 'returns') {
        const res = await fetchReturnForDeliveryCopy(docEntry);
        return res.data;
      }
      if (docType === 'blanket') {
        const res = await fetchBlanketAgreementForDeliveryCopy(docEntry);
        return res.data;
      }
      return await sodaDeliveryCopyFromApi.fetchDocumentForCopy(docType, docEntry);
    } catch (err) {
      console.error('Error fetching document details:', err);
      throw err;
    }
  };

  // â”€â”€ Copy To handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCopyTo = async (targetType) => {
    await copyToDocument({
      sourceDocType: 'sodaDelivery',
      targetType,
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: { header, lines, headerUdfs, freightCharges: freightModal.freightCharges },
      restoreState: { sodaDeliveryDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      beforeNavigate: () => document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active')),
      setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
      errorMessage: 'Please save the SODA delivery first before copying to another document.',
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
      successMessage: 'SODA delivery duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      refreshDuplicateSeries(refData.series, '', handleSeriesChange);
    }
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
    const e = await validate(); // Make validate async
    if (e.form || Object.values(e.header).some(Boolean) || Object.values(e.lines).some(le => Object.values(le || {}).some(Boolean))) {
      setValErrors(e);
      setPageState(p => ({ ...p, error: e.form || 'Please correct the highlighted fields.', success: '' }));
      return;
    }
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, posting: true, error: '', success: '' }));
    try {
      const submitBranch = alignBranchWithWarehouse(
        header.branch,
        header.warehouse || lines.find(line => String(line.whse || '').trim())?.whse,
        effectiveWarehouses
      );
      const prep = { 
        ...header, 
        customerCode: header.customerCode || header.vendor,
        customer: header.customer || header.vendor,
        deliveryDate: header.deliveryDate || header.postingDate || header.documentDate,
        placeOfSupply: header.placeOfSupply,
        branch: submitBranch,
        contactPerson: header.contactPerson,
        series: header.series ? Number(header.series) : undefined,
        totalPaymentDue: fmtDec(totals.total, numDec.totalPaymentDue),
        roundingAmount: fmtDec(totals.roundingAmount, numDec.totalPaymentDue),
      };
      
      const payload = {
        company_id: activeCompanyId,
        header: prep,
        lines: lines.map((line) => {
          const lineWithCalculatedFields = applyLineCalculatedFields(line);
          return {
            ...line,
            discountAmount: lineWithCalculatedFields.discountAmount,
            stdDiscount: lineWithCalculatedFields.stdDiscount,
            sellerBrokerage: lineWithCalculatedFields.sellerBrokerage,
            total: lineWithCalculatedFields.total,
            udf: buildVisibleEnteredRowUdfPayload(rowUdfDefinitions, line.udf || {}, sodaDeliveryFormSettings),
          };
        }),
        freightCharges: freightModal.freightCharges,
        header_udfs: normalizeUdfState(headerUdfDefinitions, headerUdfs),
      };
      const r = currentDocEntry ? await updateDelivery(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitDelivery(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      setSnapshotPending(false);
      setIsDirty(false);
      const resetHeader = createInitialHeader(generalSettingsRef.current);
      setCurrentDocEntry(null); setHeader(resetHeader); setLines([createLine(rowUdfDefinitions)]);
      setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setValErrors({ header: {}, lines: {}, form: '' });
      
      if (refData.series.length > 0) {
        const defaultSeries = resolvePreferredSeries(refData.series, resetHeader.postingDate);
        if (defaultSeries?.Series != null) {
          handleSeriesChange(defaultSeries.Series);
        }
      }
      
      setPageState(p => ({ ...p, success: `${r.data.message || 'Sales order saved.'}${dn}` }));
    } catch (e) {
      const message = getErrMsg(e, 'SODA Delivery submission failed.');
      if (message.includes('Warehouse') && message.toLowerCase().includes('branch')) {
        const lineIndex = lines.findIndex(line => String(line.whse || '').trim());
        setValErrors({
          header: {},
          lines: lineIndex >= 0
            ? { [lineIndex]: { whse: 'Warehouse does not belong to selected branch' } }
            : {},
          form: 'Please correct the highlighted fields.',
        });
      }
      setPageState(p => ({ ...p, error: message, success: '' }));
    } finally {
      setPageState(p => ({ ...p, posting: false }));
    }
  };

  const resetForm = () => {
    setSeriesRevision(value => value + 1);

    setSnapshotPending(false);
    setIsDirty(false);
    const resetHeader = createInitialHeader(generalSettingsRef.current);
    setCurrentDocEntry(null); setHeader(resetHeader); setLines([createLine(rowUdfDefinitions)]);
    setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, error: '', success: '' }));
  };

  const filteredRowUdfDefinitions = filterDeliveryRowUdfDefinitions(rowUdfDefinitions);
  const sodaDeliveryFormSettings = useMemo(() => {
    const rowUdfs = filteredRowUdfDefinitions.reduce((acc, field) => {
      acc[field.key] = {
        visible: false,
        active: true,
        ...(formSettings.rowUdfs?.[field.key] || {}),
      };
      return acc;
    }, {});

    return {
      ...formSettings,
      rowUdfs,
    };
  }, [filteredRowUdfDefinitions, formSettings]);
  const visibleHeaderUdfs = headerUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
  const visibleRowUdfs = filteredRowUdfDefinitions.filter(f => sodaDeliveryFormSettings.rowUdfs?.[f.key]?.visible === true);
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;

  useEffect(() => {
    const handleShortcut = (event) => {
      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return;
      if (pageState.posting || !isDocumentEditable) return;

      const key = String(event.key || '').toLowerCase();
      const shouldSubmit = (!isUpdateMode && key === 'a') || (isUpdateMode && hasUnsavedChanges && key === 'u');
      if (!shouldSubmit) return;

      event.preventDefault();
      formRef.current?.requestSubmit();
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [hasUnsavedChanges, isDocumentEditable, isUpdateMode, pageState.posting]);

  // Continue in next part with render...

  // â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useDocumentSeries({ endpoint: '/soda-delivery', companyKey: String(activeCompanyId), currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form ref={formRef} className={`del-page sap-document-page${isRightSidebarOpen ? ' del-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>

      {/* toolbar */}
      <div className="del-toolbar sap-document-toolbar">
        <span className="del-toolbar__title">SODA Delivery{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="del-btn del-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || !isDocumentEditable} title={primaryActionLabel}>
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
        <button type="button" className="del-btn sap-document-toolbar__settings" onClick={toggleFormSettings}>
          Form Settings
        </button>
        <PrintLayoutToolbar
          documentType="delivery"
          documentLabel="SODA Delivery"
          docEntry={currentDocEntry}
          docNumber={header.docNo}
          disabled={pageState.posting}
          classPrefix="del"
          onSuccess={(message) => setPageState(p => ({ ...p, error: '', success: message }))}
          onError={(message) => setPageState(p => ({ ...p, success: '', error: message }))}
        />
        <JournalEntryPreviewButton
          documentType="sodaDelivery"
          documentLabel="SODA Delivery"
          docEntry={currentDocEntry}
          buildPayload={() => ({ header, lines, header_udfs: headerUdfs, freightCharges: freightModal.freightCharges })}
          disabled={pageState.posting || pageState.loading}
        />
        <div className="del-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
          <button
            type="button"
            className="del-btn"
            disabled={!isDocumentEditable || !!currentDocEntry || !hasBuyerCode}
            style={{ opacity: (!isDocumentEditable || !!currentDocEntry || !hasBuyerCode) ? 0.5 : 1 }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (currentDocEntry || !hasBuyerCode) return;
              setValErrors({ header: {}, lines: {}, form: '' });
              setPageState(p => ({ ...p, error: '', success: '' }));
              const dropdown = e.currentTarget.parentElement;
              const isActive = dropdown.classList.contains('active');
              document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
              if (!isActive) dropdown.classList.add('active');
            }}
          >
            Copy From ▼
          </button>
          <div className="del-dropdown-menu">
            {[
              { key: 'salesQuotation', label: 'Sales Quotations' },
              { key: 'salesOrder',     label: 'SODA Sales Orders' },
              { key: 'returns',        label: 'Returns' },
              { key: 'blanket',        label: 'Blanket Agreement' },
            ].map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openCopyFromModal(opt.key);
                  document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="del-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
          <button
            type="button"
            className="del-btn"
            disabled={!currentDocEntry}
            style={{ opacity: !currentDocEntry ? 0.5 : 1 }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!currentDocEntry) return;
              const dropdown = e.currentTarget.parentElement;
              const isActive = dropdown.classList.contains('active');
              document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
              if (!isActive) dropdown.classList.add('active');
            }}
          >
            Copy To ▼
          </button>
          <div className="del-dropdown-menu">
            {[
              { key: 'ar-invoice', label: 'A/R Invoice' },
            ].map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCopyTo(opt.key);
                  document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {currentDocEntry && (
          <button type="button" className="del-btn sap-document-toolbar__duplicate" onClick={handleDuplicate}>
            Duplicate
          </button>
        )}
        <button type="button" className="del-btn sap-document-toolbar__find" onClick={() => navigate('/soda-delivery/find')}>Find</button>
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

      <fieldset ref={documentBodyRef} aria-disabled={!isDocumentEditable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className={`del-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`} style={{ padding: '0 12px', overflow: 'visible', minWidth: 0 }}>

          <div className="del-layout__main" style={{ minWidth: 0, overflow: 'visible' }}>

            {/* â•â• HEADER CARD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="del-header-card">
              <div className="row g-2">
                {/* LEFT COLUMN */}
                <div className="col-md-6">
                  <div className="del-field-grid" style={{ gridTemplateColumns: '1fr' }}>
                    
                    {/* Buyer's Code */}
                    <div className="del-field">
                      <label className="del-field__label">Buyer's Code *</label>
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
                    <div className="del-field">
                      <label className="del-field__label">Buyer's Name</label>
                      <input name="name" className="del-field__input" value={header.name} readOnly />
                    </div>

                    <fieldset disabled={!hasBuyerCode} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
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

                    <DocumentCurrencySelect
                      classPrefix="del"
                      header={header}
                      onHeaderChange={handleHeaderChange}
                      businessPartners={refData.vendors || []}
                      disabled={pageState.vendorLoading || !header.vendor || !!currentDocEntry}
                    />

                    {/* Place of Supply */}
                    <div className="del-field">
                      <label className="del-field__label">Place of Supply</label>
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
                    <div className="del-field">
                      <label className="del-field__label">Payment Terms</label>
                      <select name="paymentTerms" className="del-field__select" value={header.paymentTerms} onChange={handleHeaderChange}>
                        <option value="">Select</option>
                        {payTermOpts.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>

                    <div className="del-field">
                      <label className="del-field__label">Branch</label>
                      <select name="branch" className={`del-field__select${valErrors.header.branch ? ' del-field__select--error' : ''}`} value={normalizeSubmitBranch(header.branch)} onChange={handleHeaderChange} disabled={!!currentDocEntry}>
                        <option value="">Select Branch</option>
                        {!hasSelectedBranchOption && (
                          <option value={header.branch}>{`Branch ${header.branch}`}</option>
                        )}
                        {refData.branches.map(b => (
                          <option key={b.BPLId} value={b.BPLId}>
                            {b.BPLName}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Warehouse */}
                    <div className="del-field">
                      <label className="del-field__label">Warehouse *</label>
                      <select 
                        name="warehouse" 
                        className={`del-field__select${valErrors.header.warehouse ? ' del-field__select--error' : ''}`}
                        value={header.warehouse || ''} 
                        onChange={handleHeaderChange}
                      >
                        <option value="">Select Warehouse</option>
                        {branchFilteredWarehouses.map(w => (
                          <option key={w.WhsCode} value={w.WhsCode}>
                            {w.WhsCode} - {w.WhsName}
                          </option>
                        ))}
                        {header.warehouse && !branchFilteredWarehouses.some(w => String(w.WhsCode || '') === String(header.warehouse)) && (
                          <option value={header.warehouse}>{header.warehouse}</option>
                        )}
                      </select>
                    </div>
                    </fieldset>

                  </div>
                </div>

                {/* RIGHT COLUMN */}
                <div className="col-md-6">
                  <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                  <div className="del-field-grid" style={{ gridTemplateColumns: '1fr' }}>

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
                        {getSapVisibleDocumentSeries(refData.series, {
                          selectedSeries: header.series, includeHistorical: Boolean(currentDocEntry),
                          postingDate: header.postingDate || header.documentDate,
                        }).map(s => (
                          <option key={s.Series} value={s.Series}>
                            {s.SeriesName} ({s.Indicator})
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
                  </fieldset>
                </div>
              </div>
            </div>

            {/* â•â• TABS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <fieldset disabled={!hasBuyerCode} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
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
                locations={refData.locations || []}
                lines={lines}
                onLineChange={handleLineChange}
                onNumBlur={handleNumBlur}
                onAddLine={addLine}
                onRemoveLine={removeLine}
                onOpenBatchModal={openBatchModal}
                onOpenHSNModal={openHSNModal}
                onOpenItemModal={openItemModal}
                lineItemOptions={lineItemOptions}
                getUomOptions={getUomOptions}
                effectiveTaxCodes={effectiveTaxCodes}
                effectiveWarehouses={branchFilteredWarehouses}
                fmtTaxLabel={fmtTaxLabel}
                getBranchName={getBranchName}
                valErrors={valErrors}
                distributionRules={refData.distribution_rules || []}
                onOpenQualityModal={openQualityModal}
                onOpenPaymentTermsModal={openPaymentTermsModal}
                formSettings={sodaDeliveryFormSettings}
                rowUdfFields={visibleRowUdfs}
                onRowUdfChange={handleRowUdfChange}
              />
            )}

            {activeTab === 'Logistics' && (
              <LogisticsTab
                header={header}
                onHeaderChange={handleHeaderChange}
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
              <div className="del-field-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <div className="del-field">
                    <label className="del-field__label">Sales Employee</label>
                    <select name="purchaser" className="del-field__select" value={header.purchaser || ''} onChange={handleHeaderChange}>
                      <option value="">No Sales Employee / Buyer</option>
                      {effectiveSalesEmployees
                        .filter(employee => String(employee.SlpCode) !== '-1')
                        .map(employee => (
                          <option key={employee.SlpCode} value={employee.SlpName}>
                            {employee.SlpName}
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
                          <span>{fmtDec(t.taxAmount, numDec.tax)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="del-grid-wrap">
                    <table className="del-grid" style={{ marginTop: '8px' }}>
                      <tbody>
                        <tr>
                          <td>Total Before Discount</td>
                          <td className="del-grid__cell--num"><input className="del-grid__input" value={fmtDec(totals.subtotal, numDec.total)} readOnly /></td>
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
                          <td className="del-grid__cell--num">
                            <input className="del-grid__input" value={fmtDec(totals.roundingAmount, numDec.totalPaymentDue)} readOnly />
                          </td>
                        </tr>
                        <tr>
                          <td>Tax</td>
                          <td className="del-grid__cell--num"><input className="del-grid__input" value={fmtDec(totals.taxAmt, numDec.tax)} readOnly /></td>
                        </tr>
                        <tr style={{ borderTop: '2px solid #a0aab4' }}>
                          <td style={{ fontWeight: 700, color: '#003366' }}>Total</td>
                          <td className="del-grid__cell--num" style={{ fontWeight: 700, color: '#003366' }}><input className="del-grid__input" style={{ fontWeight: 700, color: '#003366' }} value={fmtDec(totals.total, numDec.totalPaymentDue)} readOnly /></td>
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
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* Copy From Dropdown - SAP B1 style, same as Sales Order */}
                <div className="del-dropdown">
                  <button
                    type="button"
                    className="del-btn"
                    disabled={!isDocumentEditable || !!currentDocEntry || !hasBuyerCode}
                    style={{ opacity: (!isDocumentEditable || !!currentDocEntry || !hasBuyerCode) ? 0.5 : 1 }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (currentDocEntry || !hasBuyerCode) return;
                      setValErrors({ header: {}, lines: {}, form: '' });
                      setPageState(p => ({ ...p, error: '', success: '' }));
                      const dropdown = e.currentTarget.parentElement;
                      const isActive = dropdown.classList.contains('active');
                      document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
                      if (!isActive) dropdown.classList.add('active');
                    }}
                  >
                    Copy From ▼
                  </button>
                  <div className="del-dropdown-menu">
                    {[
                      { key: 'salesQuotation', label: 'Sales Quotations' },
                      { key: 'salesOrder',     label: 'SODA Sales Orders' },
                      { key: 'returns',        label: 'Returns' },
                      { key: 'blanket',        label: 'Blanket Agreement' },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openCopyFromModal(opt.key);
                          document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Copy To Dropdown - SAP B1 style */}
                <div className="del-dropdown">
                  <button
                    type="button"
                    className="del-btn"
                    disabled={!currentDocEntry}
                    style={{ opacity: !currentDocEntry ? 0.5 : 1 }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!currentDocEntry) return;
                      const dropdown = e.currentTarget.parentElement;
                      const isActive = dropdown.classList.contains('active');
                      document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
                      if (!isActive) dropdown.classList.add('active');
                    }}
                  >
                    Copy To ▼
                  </button>
                  <div className="del-dropdown-menu">
                    {[
                      { key: 'ar-invoice', label: 'A/R Invoice' },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCopyTo(opt.key);
                          document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active'));
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            )}

          </fieldset>

          </div>{/* end main col */}

          <HeaderUdfSidebar
            className="del-layout__sidebar"
            isOpen={sidebarOpen}
            fields={visibleHeaderUdfs}
            formSettings={sodaDeliveryFormSettings}
            values={headerUdfs}
            disabled={!hasBuyerCode}
            onFieldChange={handleHeaderUdfChange}
            onClose={() => setSidebarOpen(false)}
            billToPartyAddressOptions={vendorEffectiveBillToAddresses}
            billToPartyName={header.name}
            loadBillToPartyDetails={loadHeaderBillToPartyDetails}
          />
          <FormSettingsPanel
            variant="sidebar"
            className="del-layout__sidebar"
            isOpen={formSettingsOpen}
            onClose={() => setFormSettingsOpen(false)}
            matrixFields={BASE_MATRIX_COLUMNS}
            headerUdfFields={headerUdfDefinitions}
            rowUdfFields={filteredRowUdfDefinitions}
            formSettings={sodaDeliveryFormSettings}
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

      {/* Tax Information Modal */}
      <TaxInfoModal
        isOpen={taxInfoModal}
        onClose={closeTaxInfoModal}
        onSave={saveTaxInfoModal}
        taxInfoForm={taxInfoForm}
        onFormChange={handleTaxInfoFormChange}
      />

      <BatchAllocationModal
        isOpen={batchModal.open}
        line={batchModal.lineIndex != null ? lines[batchModal.lineIndex] : null}
        availableBatches={batchModal.availableBatches}
        loading={batchModal.loading}
        error={batchModal.error}
        workspaceRef={formRef}
        onClose={closeBatchModal}
        onSave={saveLineBatches}
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

      <QualitySelectionModal
        isOpen={qualityModal.open}
        onClose={closeQualityModal}
        onSelect={handleQualitySelect}
        onCreate={handleQualityCreate}
        options={qualityModal.options}
        title={qualityModal.title}
        searchPlaceholder={qualityModal.searchPlaceholder}
        emptyMessage={qualityModal.emptyMessage}
        allowCreate={qualityModal.allowCreate}
      />

      {/* Copy From Modal */}
      <CopyFromModal
        isOpen={copyFromModal}
        onClose={() => setCopyFromModal(false)}
        onCopy={handleCopyFrom}
        documentType={copyFromDocType}
        onFetchDocuments={fetchCopyFromDocuments}
        onFetchDocumentDetails={fetchCopyFromDocumentDetails}
      />

      {salesEmployeeSetup.open && (
        <div className="sap-setup-overlay" role="dialog" aria-modal="true">
          <div className="sap-setup-window">
            <div className="sap-setup-titlebar">
              <span>Sales Employees/Buyers - Setup</span>
              <div className="sap-setup-window-actions">
                <button type="button" aria-label="Close" onClick={closeSalesEmployeeSetup}>x</button>
              </div>
            </div>
            <div className="sap-setup-body">
              <div className="sap-setup-grid-wrap">
                <table className="sap-setup-grid">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Sales Employee Name</th>
                      <th>Commission Group</th>
                      <th>Commission %</th>
                      <th>Remarks</th>
                      <th>Active</th>
                      <th>Employee</th>
                      <th>T...</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesEmployeeSetup.rows.map((row, index) => (
                      <tr key={`${row.SlpCode || 'new'}-${index}`}>
                        <td>{index + 1}</td>
                        <td>
                          <input
                            value={row.SlpName}
                            onChange={event => updateSalesEmployeeSetupRow(index, 'SlpName', event.target.value)}
                            disabled={row.SlpCode === -1}
                          />
                        </td>
                        <td>
                          <select value="user-defined" disabled={row.SlpCode === -1}>
                            <option value="user-defined">User-Defined Commission</option>
                          </select>
                        </td>
                        <td>
                          <input
                            className="sap-setup-num"
                            value={row.Commission}
                            onChange={event => updateSalesEmployeeSetupRow(index, 'Commission', sanitize(event.target.value, numDec.discount))}
                            disabled={row.SlpCode === -1}
                          />
                        </td>
                        <td>
                          <input
                            value={row.Memo}
                            onChange={event => updateSalesEmployeeSetupRow(index, 'Memo', event.target.value)}
                            disabled={row.SlpCode === -1}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.Active}
                            onChange={event => updateSalesEmployeeSetupRow(index, 'Active', event.target.checked)}
                            disabled={row.SlpCode === -1}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={row.Employee}
                            onChange={event => updateSalesEmployeeSetupRow(index, 'Employee', event.target.checked)}
                            disabled={row.SlpCode === -1}
                          />
                        </td>
                        <td></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sap-setup-footer">
                <div>
                  <button type="button" className="sap-setup-primary" onClick={saveSalesEmployeeSetup} disabled={salesEmployeeSetup.saving}>
                    {salesEmployeeSetup.saving ? 'Saving...' : 'OK'}
                  </button>
                  <button type="button" onClick={closeSalesEmployeeSetup} disabled={salesEmployeeSetup.saving}>Cancel</button>
                </div>
                <button type="button" disabled>Set as Default</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Freight Selection Modal */}
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

export default SODADelivery;
