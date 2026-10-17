import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import { isManualDocumentSeries, isValidManualDocumentNumber } from '../../utils/documentSeries';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import './styles/PurchaseQuatation.css';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import FormSettingsPanel from '../../components/purchase-order/FormSettingsPanel';
import HeaderUdfSidebar from '../../components/purchase-order/HeaderUdfSidebar';
import ContentsTab from './components/ContentsTab';
import LogisticsTab from './components/LogisticsTab';
import AccountingTab from './components/AccountingTab';
import TaxTab from './components/TaxTab';
import ElectronicDocumentsTab from './components/ElectronicDocumentsTab';
import AttachmentsTab from './components/AttachmentsTab';
import AddressModal from '../../components/document/AddressComponentModal';
import TaxInfoModal from './components/TaxInfoModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import BusinessPartnerModal from './components/BusinessPartnerModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import CopyFromModal from '../../components/document/CopyFromModal';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import SalesEmployeeSetupModal from '../../components/sales-employee/SalesEmployeeSetupModal';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import useStandardDocumentDraftTask from '../../hooks/useStandardDocumentDraftTask';
import { copyToDocument } from '../../services/documentCopyService';
import { duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import { filterWarehousesByBranch } from '../../utils/warehouseBranch';
import { hydrateDocumentLineFromItem, mergeItemMaster } from '../../utils/documentItemHydration';
import { applyUomCodeSelection, getLineUomOptions } from '../../utils/documentUom';
import { applyDocumentTablePaste } from '../../utils/documentTableClipboard';
import { mapAddressToModalForm, resolveAddressForModal } from '../../utils/documentAddress';
import { getDefaultSeriesForCurrentYear, getSapVisibleDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import { useStandardSalesFormSettings } from '../../utils/standardSalesFormSettings';
import { normalizePurchaseQuotationMatrixColumns } from '../../utils/purchaseDocumentFormSettings';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount } from '../../utils/documentRounding';
import DocumentRoundingInput from '../../components/sales-document/DocumentRoundingInput';
import useSalesEmployeeSetup from '../../hooks/useSalesEmployeeSetup';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import { fetchSalesDocumentSchema } from '../../api/salesDocumentSchemaApi';
import { buildSalesDocumentLiveFields } from '../../utils/salesDocumentLiveFields';
import { mergeLiveMatrixSettings } from '../../utils/liveDocumentLayout';
import {
  fetchPurchaseQuotationByDocEntry,
  fetchPurchaseQuotationReferenceData,
  fetchPurchaseQuotationVendorDetails,
  submitPurchaseQuotation,
  updatePurchaseQuotation,
  fetchFreightCharges,
} from '../../api/purchaseQuotationApi';
import {
  fetchOpenPurchaseRequestsForCopy,
  fetchPurchaseRequestForCopy,
} from '../../api/purchaseOrderApi';
import { fetchHSNCodes } from '../../api/hsnCodeApi';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import { normaliseDocumentHeader, normaliseDocumentLine, unwrapCopyFromDocument } from '../../api/copyFromApi';
import {
  BASE_MATRIX_COLUMNS,
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createUdfState,
  readSavedFormSettings,
} from '../../config/purchaseQuotationForm';

import useUnsavedChangesWarning, { hasEnteredDocumentLines } from '../../hooks/useUnsavedChangesWarning';
import DocumentStatusActions from '../../components/document/DocumentStatusActions';
import { reloadRouteDocument } from '../../utils/copyToState';
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

const createLine = (rowUdfDefinitions = ROW_UDF_DEFINITIONS) => ({
  itemNo: '',
  itemDescription: '',
  requiredDate: '',
  quotedDate: '',
  requiredQty: '',
  hsnCode: '',
  sacCode: '',
  quantity: '',
  uomCode: '',
  uomName: '',
  unitPrice: '',
  unitPriceUdf: '',
  stdDiscount: '',
  taxCode: '',
  taxCodeRepeat: '',
  taxAmount: '',
  totalBeforeTax: '',
  totalLC: '',
  total: '',
  price: '',
  whse: '',
  distRule: '',
  countryOfOrigin: '',
  loc: '',
  branch: '',
  blanketAgreementNo: '',
  U_Cost_Sheet: '',
  U_PackingType: '',
  U_ContainerType: '',
  U_GrossWt: '',
  U_TotalPackage: '',
  saudaNodeRef: '',
  apInvDocKey: '',
  apInvDocNum: '',
  apInvLineNum: '',
  assessableValue: '',
  bedRate: '',
  bedAmount: '',
  rg23dNo: '',
  specialRebate: '',
  commission: '',
  sellerItem: '',
  sellerQty: '',
  sellerBrokeragePerQty: '',
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
  U_Fix_Brock_B: '',
  U_Fix_Brock_S: '',
  buyerBillDiscount: '',
  sellerBillDiscount: '',
  stcode: '',
  freightPurchase: '',
  freightSales: '',
  freightProvider: '',
  freightProviderName: '',
  documentCreated: '',
  brokerageNumber: '',
  taxCodeManuallyOverridden: false,
  udf: createUdfState(rowUdfDefinitions),
});

const INIT_HEADER = {
  vendor: '',
  name: '',
  contactPerson: '',
  salesContractNo: '',
  branch: '',
  warehouse: GENERAL_SETTINGS.purchaseQuotationWarehouse || '',
  docNo: '',
  status: 'Open',
  series: GENERAL_SETTINGS.purchaseQuotationSeries || '',
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
  billTo: '',
  billToCode: '',
  payTo: '',
  payToCode: '',
  shippingType: '',
  useBillToForTax: false,
  usePayToForTax: false,
  toOrder: '',
  notifyPartyCode: '',
  notifyPartyName: '',
  notifyPartyAddress: '',
  language: '',
  splitPurchaseOrder: false,
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

const PURCHASE_QUOTATION_COPY_BASE_TYPE = {
  purchaseRequest: 1470000113,
};

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PurchaseOrder() {
  const [seriesRevision, setSeriesRevision] = useState(0);

  const { company } = useAuth();
  const activeCompanyId = company?.companyId || '';
  const location = useLocation();
  const navigate = useNavigate();
  const { removeTask, upsertTask } = useSapWindowTaskbarActions();

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(INIT_HEADER);
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState(HEADER_UDF_DEFINITIONS);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState(ROW_UDF_DEFINITIONS);
  const [matrixColumnDefinitions, setMatrixColumnDefinitions] = useState(BASE_MATRIX_COLUMNS);
  const [lines, setLines] = useState([createLine(ROW_UDF_DEFINITIONS)]);
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, query: '' });
  useEffect(() => {
    setItemModal({ open: false, lineIndex: -1, query: '' });
  }, [activeCompanyId]);
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
    hsn_codes: [],
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
  const [stateModal, setStateModal] = useState(false);
  const [bpModal, setBpModal] = useState(false);
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });

  useStandardDocumentDraftTask({
    draftKey: 'purchaseQuotationDraft',
    title: 'Purchase Quotation',
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
        : [createLine(ROW_UDF_DEFINITIONS)]);
      setHeaderUdfs(draft.headerUdfs || createUdfState(HEADER_UDF_DEFINITIONS));
      setActiveTab(draft.activeTab || 'Contents');
      setIsDirty(Boolean(draft.isDirty));
      setFreightModal((prev) => ({
        ...prev,
        freightCharges: Array.isArray(draft.freightCharges) ? draft.freightCharges : [],
        loading: false,
      }));
    },
  });
  const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1 });
  const [copyFromModal, setCopyFromModal] = useState(false);
  const [copyFromDocType, setCopyFromDocType] = useState('purchaseRequest');
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
    requiredQty: Number(dec.QtyDec),
    sellerQty: Number(dec.QtyDec),
    sellerBrokeragePerQty: Number(dec.PriceDec),
    unitPrice: Number(dec.PriceDec),
    unitPriceUdf: Number(dec.PriceDec),
    price: Number(dec.PriceDec),
    assessableValue: Number(dec.SumDec),
    bedRate: Number(dec.PercentDec),
    bedAmount: Number(dec.SumDec),
    specialRebate: Number(dec.PercentDec),
    commission: Number(dec.PercentDec),
    sellerBrokerage: Number(dec.SumDec),
    buyerBrokerage: Number(dec.SumDec),
    sellerBrokeragePercent: Number(dec.PercentDec),
    U_GrossWt: Number(dec.SumDec),
    U_TotalPackage: Number(dec.QtyDec),
    U_Fix_Brock_B: Number(dec.SumDec),
    U_Fix_Brock_S: Number(dec.SumDec),
    buyerBillDiscount: Number(dec.PercentDec),
    sellerBillDiscount: Number(dec.PercentDec),
    freightPurchase: Number(dec.SumDec),
    freightSales: Number(dec.SumDec),
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
  useUnsavedChangesWarning(hasUnsavedChanges || (!currentDocEntry && hasEnteredDocumentLines(lines)));
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
        setHeaderUdfDefinitions([]);
        setRowUdfDefinitions([]);
        setMatrixColumnDefinitions([]);
        // Loading schema/settings must preserve loaded, copied and draft lines.
        if (!activeCompanyId) {
          setHeaderUdfs({});
          setLines([createLine([])]);
          return;
        }
        const [refDataRes, hsnRes, layoutRes, schema] = await Promise.all([
          fetchPurchaseQuotationReferenceData(activeCompanyId),
          fetchHSNCodes(),
          getDocumentLayout({ documentType: 'PURCHASE_QUOTATION', companyDb: company?.dbName }).catch((error) => ({
            data: {
              success: false,
              columns: [],
              warning: getErrMsg(error, 'Failed to load SAP layout.'),
            },
          })),
          fetchSalesDocumentSchema({ documentType: 'PURCHASE_QUOTATION' }).catch(() => null),
        ]);

        if (!ignore) {
          const liveMatrixColumns = refDataRes.data.line_field_metadata?.matrix_columns?.length
            ? refDataRes.data.line_field_metadata.matrix_columns
            : BASE_MATRIX_COLUMNS;
          const liveFields = buildSalesDocumentLiveFields({
            schema,
            documentType: 'PURCHASE_QUOTATION',
            objectType: '540000006',
            headerTable: 'OPQT',
            lineTable: 'PQT1',
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
            ? normalizePurchaseQuotationMatrixColumns(liveFields.matrixColumns)
            : BASE_MATRIX_COLUMNS;
          const hasSapMatrixPreferences = Boolean(
            liveFields.usedSapLayout ||
            Number(refDataRes.data.line_field_metadata?.sap_form?.preferenceRows || 0)
          );
          setHeaderUdfDefinitions(nextHeaderUdfs);
          setRowUdfDefinitions(nextRowUdfs);
          setMatrixColumnDefinitions(nextMatrixColumns);
          setHeaderUdfs((prev) => createUdfState(nextHeaderUdfs, prev));
          setLines((prev) => prev.map((line) => ({
            ...line,
            udf: createUdfState(nextRowUdfs, line.udf || {}),
          })));
          const nextDefaults = readSavedFormSettings(nextHeaderUdfs, nextRowUdfs, nextMatrixColumns, formSettingsStorageKey);
          replaceFormSettings((prev) => mergeLiveMatrixSettings(nextDefaults, prev, hasSapMatrixPreferences));

          setRefData({
            company: refDataRes.data.company || '',
            company_state: refDataRes.data.company_state || '',
            local_currency: refDataRes.data.local_currency || refDataRes.data.company_currency || '',
            system_currency: refDataRes.data.system_currency || refDataRes.data.company_currency || '',
            currencies: refDataRes.data.currencies || [],
            rounding_settings: refDataRes.data.rounding_settings || { method: '', currencies: [] },
            vendors: refDataRes.data.vendors || [],
            contacts: refDataRes.data.contacts || [],
            pay_to_addresses: refDataRes.data.pay_to_addresses || [],
            items: refDataRes.data.items || [],
            warehouses: refDataRes.data.warehouses || [],
            warehouse_addresses: refDataRes.data.warehouse_addresses || [],
            company_address: refDataRes.data.company_address || {},
            tax_codes: refDataRes.data.tax_codes || [],
            hsn_codes: hsnRes.data || [],
            sales_employees: refDataRes.data.sales_employees || [],
            payment_terms: refDataRes.data.payment_terms || [],
            shipping_types: refDataRes.data.shipping_types || [],
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
            series: [],
          });

          setSeriesRevision(value => value + 1);
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
    const docEntry = location.state?.purchaseQuotationDocEntry;
    if (!docEntry) return;
    let ignore = false;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        const r = await fetchPurchaseQuotationByDocEntry(docEntry);
        const quotation = r.data.purchase_quotation;
        if (ignore || !quotation) return;
        setCurrentDocEntry(quotation.doc_entry || Number(docEntry));
        setHeader(prev => ({
          ...prev,
          ...INIT_HEADER,
          ...(quotation.header || {}),
        }));

        setLines(
          Array.isArray(quotation.lines) && quotation.lines.length
            ? quotation.lines.map(l => ({ ...createLine(rowUdfDefinitions), ...l, taxCodeManuallyOverridden: true, udf: { ...createUdfState(rowUdfDefinitions), ...(l.udf || {}) } }))
            : [createLine(rowUdfDefinitions)]
        );
        setHeaderUdfs({ ...createUdfState(headerUdfDefinitions), ...(quotation.header_udfs || {}) });
        setSnapshotPending(true);
        setIsDirty(false);
        if (quotation.header?.vendor) {
          loadVendorDetails(quotation.header.vendor);
        }
        setPageState(p => ({ ...p, success: location.state?.documentStatusMessage || (quotation.doc_num ? `Purchase quotation ${quotation.doc_num} loaded.` : 'Purchase quotation loaded.') }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load purchase quotation.') }));
      } finally {
        if (!ignore) {
          setPageState(p => ({ ...p, loading: false }));
          navigate(location.pathname, { replace: true, state: null });
        }
      }
    };
    load();
    return () => { ignore = true; };
  }, [location.pathname, location.state, navigate, headerUdfDefinitions, rowUdfDefinitions]);

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
  const vendorShipToAddresses = refData.ship_to_addresses?.filter(a => String(a.CardCode || '') === String(header.vendor || '')) || [];
  const vendorBillToAddresses = refData.bill_to_addresses?.filter(a => String(a.CardCode || '') === String(header.vendor || '')) || [];
  const vendorEffectiveShipToAddresses = vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses;
  const vendorEffectiveBillToAddresses = vendorBillToAddresses.length ? vendorBillToAddresses : vendorPayToAddresses;
  const selectedBranch = refData.branches.find(b => String(b.BPLId || '') === String(header.branch || ''));

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
  const effectiveTaxCodes = refData.tax_codes || [];
  const effectiveWarehouses = refData.warehouses.length ? refData.warehouses : [];
  const branchFilteredWarehouses = filterWarehousesByBranch(effectiveWarehouses, header.branch);
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
    const preferredTaxCode = findPreferredGstTaxCode({
      taxCodes: effectiveTaxCodes,
      gstType: derivedGstType,
      currentTaxCode,
    });
    return preferredTaxCode?.Code || '';
  }, [derivedGstType, effectiveTaxCodes]);

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
    objectType: 540000006,
    docEntry: currentDocEntry,
    header,
    total: totals.total,
  });

  useEffect(() => {
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

  useEffect(() => {
    setHeader(prev => prev.gstType === inferredGstType ? prev : { ...prev, gstType: inferredGstType });
  }, [inferredGstType]);

  // â”€â”€ GST Logic - Recalculate Tax Codes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Automatically recalculate tax codes when place of supply or vendor changes
  useEffect(() => {
    if (true) return;

    const companyState = refData.company_address?.State || selectedBranch?.State || '';
    
    if (!companyState) {
      console.warn('âš ï¸ Company state not available for tax recalculation');
      return;
    }

    console.log('ðŸ”„ Recalculating Tax Codes for All Lines:', {
      placeOfSupply: header.placeOfSupply,
      companyState,
      gstType: '',
      lineCount: lines.filter(l => l.itemNo).length
    });

    // Recalculate tax codes for all lines with items
    const updatedLines = lines;

    setLines(updatedLines);
  }, [header.placeOfSupply, header.vendor, refData.company_address, selectedBranch, refData.items, effectiveTaxCodes]);

  // â”€â”€ address sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  useEffect(() => {
    const shouldAutoPopulateAddresses = true;
    if (!shouldAutoPopulateAddresses) return;
    if (!header.vendor) return;
    setHeader(prev => {
      const existing = vendorEffectiveShipToAddresses.find(a => String(a.Address || '') === String(prev.shipToCode || ''));
      if (existing) return prev;
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
      return { ...prev, payToCode: def.Address || '', payTo: fmt };
    });
  }, [header.vendor, vendorEffectiveBillToAddresses]);

  // â”€â”€ vendor details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const loadVendorDetails = async (code) => {
    if (!code) {
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setHeader(prev => ({ ...prev, placeOfSupply: '', gstin: '', vendorState: '', gstType: '', allowGstOverride: false }));
      return;
    }

    setPageState(p => ({ ...p, vendorLoading: true }));

    try {
      const r = await fetchPurchaseQuotationVendorDetails(code);
      const contacts = r.data.contacts || [];
      const payToAddresses = r.data.pay_to_addresses || [];
      const shipToAddresses = r.data.ship_to_addresses || [];
      const billToAddresses = r.data.bill_to_addresses || [];
      const primaryTaxAddress = payToAddresses[0] || billToAddresses[0] || shipToAddresses[0] || contacts[0] || {};
      const gstin = String(primaryTaxAddress.GSTIN || primaryTaxAddress.gstin || '').trim();
      const vendorState = String(primaryTaxAddress.State || primaryTaxAddress.state || '').trim();
      
      setRefData(p => ({
        ...p,
        contacts: contacts,
        pay_to_addresses: payToAddresses,
        ship_to_addresses: shipToAddresses,
        bill_to_addresses: billToAddresses
      }));
     
      // Auto-select first contact if available
      if (contacts.length > 0) {
        setHeader(prev => ({
          ...prev,
          contactPerson: contacts[0].CntctCode
        }));
      }

      // Auto-populate logistics addresses from vendor, matching sales documents.
      const effectiveShipTo = shipToAddresses.length ? shipToAddresses : payToAddresses;
      const effectiveBillTo = billToAddresses.length ? billToAddresses : payToAddresses;

      if (effectiveShipTo.length > 0) {
        const defaultShipTo = effectiveShipTo[0];
        if (defaultShipTo.State) {
          console.log('ðŸŒ Auto-setting Place of Supply from vendor ship-to address:', defaultShipTo.State);
          setHeader(prev => ({
            ...prev,
            placeOfSupply: defaultShipTo.State,
            shipToCode: defaultShipTo.Address || '',
            shipTo: fmtAddr(defaultShipTo)
          }));
        }
      }

      if (effectiveBillTo.length > 0) {
        const defaultBillTo = effectiveBillTo[0];
        setHeader(prev => ({
          ...prev,
          billToCode: defaultBillTo.Address || '',
          billTo: fmtAddr(defaultBillTo)
        }));
      }
      setHeader(prev => ({
        ...prev,
        gstin,
        vendorState,
        gstType: formatDerivedGstType(getDerivedGstType(vendorState, prev.placeOfSupply)),
        allowGstOverride: false,
      }));
    } catch (err) {
      console.error('Error loading vendor details:', err);
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setHeader(prev => ({ ...prev, gstin: '', vendorState: '', gstType: '', allowGstOverride: false, contactPerson: '' }));
    } finally {
      setPageState(p => ({ ...p, vendorLoading: false }));
    }
  };

  const syncVendor = (code, hdr) => {
    const m = refData.vendors.find(v => String(v.CardCode || '') === String(code || ''));
    if (!m) return { nextHeader: hdr, vatGroup: '' };
    return {
      nextHeader: {
        ...hdr,
        name: m.CardName || m.Name || hdr.name,
        currencyMode: 'BP',
        currency: m.Currency && m.Currency !== '##'
          ? m.Currency
          : (hdr.currency || refData.local_currency || ''),
        exchangeRate: '',
        paymentTerms: m.GroupNum != null ? String(m.GroupNum) : hdr.paymentTerms,
        contactPerson: '',
        shipTo: '',
        shipToCode: '',
        billTo: '',
        billToCode: '',
        payTo: '',
        payToCode: '',
        placeOfSupply: '',
        gstin: '',
        vendorState: '',
        gstType: '',
        allowGstOverride: false,
      },
      vatGroup: m.VatGroup || '',
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

    if (name === 'branch') {
      setHeader((prev) => ({ ...prev, branch: value }));
      if (!currentDocEntry) {
        setSeriesRevision(value => value + 1);
      }
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
        next.taxCodeRepeat = value;
      }

      if (name === 'unitPrice' && !String(line.price || '').trim()) {
        next.price = next.unitPrice;
      }

      if (name === 'itemNo') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));
        if (item) {
          Object.assign(next, hydrateDocumentLineFromItem(next, mergeItemMaster(item, refData.items), {
            side: 'purchase',
            hsnCode: item.HSNCode || next.hsnCode || '',
            fallbackWarehouse: header.warehouse,
            uomGroups: refData.uom_groups,
            calcLineTotal,
            formatTotal: (lineTotal) => fmtDec(lineTotal, numDec.total),
          }));
        }

        if (!next.taxCodeManuallyOverridden) {
          const preferredTaxCode = getPreferredLineTaxCode(next.taxCode);
          if (preferredTaxCode) {
            next.taxCode = preferredTaxCode;
          }
        }

        if (!String(next.taxCodeRepeat || '').trim()) {
          next.taxCodeRepeat = next.taxCode || '';
        }
        if (!String(next.price || '').trim()) {
          next.price = next.unitPrice || '';
        }
      }
      if (name === 'uomCode') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(next.itemNo || ''));
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
          if (item) {
            const pastedValues = { ...next, udf: { ...(next.udf || {}) } };
            next = hydrateDocumentLineFromItem(next, mergeItemMaster(item, refData.items), {
              side: 'purchase',
              hsnCode: item.HSNCode || next.hsnCode || '',
              fallbackWarehouse: header.warehouse,
              uomGroups: refData.uom_groups,
              calcLineTotal,
              formatTotal: lineTotal => fmtDec(lineTotal, numDec.total),
            });
            rowPatch.cells.forEach((cell) => {
              if (cell.isUdf) next.udf = { ...(next.udf || {}), [cell.key]: cell.value };
              else next[cell.key] = pastedValues[cell.key];
            });
          }
          if (!next.taxCodeManuallyOverridden) next.taxCode = getPreferredLineTaxCode(next.taxCode) || next.taxCode;
          next.taxCodeRepeat = next.taxCodeRepeat || next.taxCode || '';
          next.price = next.price || next.unitPrice || '';
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
    // Validate the last line before adding a new one
    const lastLine = lines[lines.length - 1];
    
    // Check if last line has required fields filled
    if (lastLine) {
      const errors = [];
      
      if (!lastLine.itemNo || !String(lastLine.itemNo).trim()) {
        errors.push('Item Code');
      }
      if (!lastLine.hsnCode || !String(lastLine.hsnCode).trim()) {
        errors.push('HSN Code');
      }
      if (!lastLine.taxCode || !String(lastLine.taxCode).trim()) {
        errors.push('Tax Code');
      }
      if (!lastLine.quantity || Number(lastLine.quantity) <= 0) {
        errors.push('Quantity');
      }
      if (!lastLine.unitPrice || Number(lastLine.unitPrice) <= 0) {
        errors.push('Unit Price');
      }
      
      if (errors.length > 0) {
        setPageState(p => ({ 
          ...p, 
          error: `Please fill required fields in the current row before adding a new line: ${errors.join(', ')}`,
          success: '' 
        }));
        return;
      }
    }
    
    setValErrors(p => ({ ...p, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));
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

  const handleHeaderUdfChange = (k, v) => {
    markDirty();
    setHeaderUdfs(p => ({ ...p, [k]: v }));
  };
  const handleRowUdfChange = (i, k, v) => {
    markDirty();
    setLines(p => p.map((l, idx) => idx === i ? { ...l, udf: { ...(l.udf || {}), [k]: v } } : l));
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

  // â”€â”€ Business Partner Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openBpModal = () => {
    setBpModal(true);
  };

  const closeBpModal = () => {
    setBpModal(false);
  };

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
  const openStateModal = () => {
    setStateModal(true);
  };

  const closeStateModal = () => {
    setStateModal(false);
  };

  const handleStateSelect = (state) => {
    setHeader(prev => ({ ...prev, placeOfSupply: getStateCodeValue(state, refData.states) }));
    closeStateModal();
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
  const handleCopyFrom = (data, docType) => {
    setSeriesRevision(value => value + 1);

    const copySource = unwrapCopyFromDocument(data);
    const baseType = PURCHASE_QUOTATION_COPY_BASE_TYPE[docType] || 1470000113;
    const normalizedHeader = normaliseDocumentHeader(copySource.header);
    const rawLines = copySource.lines;
    const copiedLines = rawLines.map((line, index) => ({
      ...createLine(rowUdfDefinitions),
      ...normaliseDocumentLine(line, index, copySource.docEntry, baseType, normalizedHeader.branch),
    }));

    setHeader((prev) => ({ ...prev, ...normalizedHeader }));
    setLines(copiedLines.length ? copiedLines : [createLine(rowUdfDefinitions)]);
    setFreightModal({ open: false, freightCharges: [], loading: false });

    if (normalizedHeader.vendor) {
      loadVendorDetails(normalizedHeader.vendor);
    }

    setCopyFromModal(false);
    setPageState((prev) => ({ ...prev, error: '', success: 'Purchase Request copied successfully.' }));
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
    if (docType === 'purchaseRequest') {
      const response = await fetchOpenPurchaseRequestsForCopy(header.vendor);
      return response.data.documents || [];
    }

    return [];
  };

  const fetchCopyFromDocumentDetails = async (docType, docEntry) => {
    if (docType === 'purchaseRequest') {
      const response = await fetchPurchaseRequestForCopy(docEntry);
      return response.data;
    }

    throw new Error(`Unsupported copy from type: ${docType}`);
  };

  const handleCopyTo = async (targetType) => {
    await copyToDocument({
      sourceDocType: 'purchaseQuotation',
      targetType,
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: { header, lines, freightCharges: freightModal.freightCharges },
      restoreState: { purchaseQuotationDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
      errorMessage: 'Please save the purchase quotation first before copying to another document.',
    });
  };

  const handleDuplicate = () => {
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
      successMessage: 'Purchase quotation duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      setHeader(prev => ({
        ...prev,
        postingDate: duplicateDate,
        documentDate: duplicateDate,
        deliveryDate: duplicateDate,
        series: '',
        nextNumber: '',
      }));
      const defaultSeries = getDefaultSeriesForCurrentYear(refData.series, new Date(`${duplicateDate}T00:00:00`));
      if (defaultSeries?.Series != null) {
        handleSeriesChange(defaultSeries.Series);
      }
    }
  };

  const validate = () => {
    const isUpdate = !!currentDocEntry;
    const e = { header: {}, lines: {}, form: '' };
    if (!isUpdate && isManualDocumentSeries(header.series) && !isValidManualDocumentNumber(header.nextNumber)) {
      e.header.nextNumber = 'Enter a positive whole document number for Manual series.';
      e.form = e.header.nextNumber;
      return e;
    }

    if (!isUpdate) {
      const vc = String(header.vendor || '').trim();
      if (!vc) { e.header.vendor = 'Select a vendor.'; e.form = 'Please correct the highlighted fields.'; return e; }
      
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

    }

    // Prevent save if total is 0
    const currentTotals = calcTotals();
    if (currentTotals.total <= 0) {
      e.form = 'Total amount must be greater than 0. Please add items with valid prices.';
      return e;
    }

    return e;
  };

  // â”€â”€ submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
    docEntry: currentDocEntry, isDirty,
    state: { header, lines, headerUdfs, freightCharges: freightModal.freightCharges , company_id: activeCompanyId, companyKey: formSettingsStorageKey },
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
      return;
    }
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, posting: true, error: '', success: '' }));
    try {
      const prep = {
        ...header,
        deliveryDate: header.deliveryDate || header.postingDate || header.documentDate,
        requiredDate: header.requiredDate || header.deliveryDate || header.postingDate || header.documentDate,
        roundingAmount: getDocumentRoundingPayloadAmount(header, totals.roundingAmount),
        roundingAmountIsManual: header.roundingAmountIsManual === true,
        series: header.series ? Number(header.series) : undefined,
      };

      const payloadLines = lines.map((line) => ({
        ...line,
        udf: buildVisibleEnteredRowUdfPayload(rowUdfDefinitions, line.udf || {}, formSettings),
      }));
      const payload = { company_id: activeCompanyId, header: prep, lines: payloadLines, freightCharges: freightModal.freightCharges, header_udfs: headerUdfs };
      const r = currentDocEntry ? await updatePurchaseQuotation(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitPurchaseQuotation(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      setSnapshotPending(false);
      setIsDirty(false);
      setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
      setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [] }));
      setValErrors({ header: {}, lines: {}, form: '' });

      setSeriesRevision(value => value + 1);

      setPageState(p => ({ ...p, success: `${r.data.message || 'Purchase quotation saved.'}${dn}` }));
    } catch (e) {
      setPageState(p => ({ ...p, error: getErrMsg(e, 'Purchase quotation submission failed.') }));
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
  };

  const hasBuyerCode = Boolean(String(header.vendor || '').trim());
  const visHdrUdfs = headerUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;

  // â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useDocumentSeries({ endpoint: '/purchase-quotation', companyKey: formSettingsStorageKey, currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form className={`po-page sap-document-page${isRightSidebarOpen ? ' po-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>

      {/* toolbar */}
      <div className="po-toolbar sap-document-toolbar">
        <span className="po-toolbar__title">Purchase Quotation{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="po-btn po-btn--primary sap-document-toolbar__primary" disabled={pageState.posting}>
          {primaryActionLabel}
        </button>
        <button type="button" className="po-btn sap-document-toolbar__cancel" onClick={resetForm}>
          Cancel
        </button>
        <button type="button" className="po-btn sap-document-toolbar__udf" onClick={toggleHeaderUdfs}>
          {sidebarOpen ? 'Hide UDFs' : 'Show UDFs'}
        </button>
        <button type="button" className="po-btn sap-document-toolbar__settings" onClick={toggleFormSettings}>
          Form Settings
        </button>
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
                openCopyFromModal('purchaseRequest');
                document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
              }}
            >
              Purchase Requests
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
                handleCopyTo('purchaseOrder');
                document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
              }}
            >
              Purchase Order
            </button>
          </div>
        </div>
        {currentDocEntry && (
          <button type="button" className="po-btn sap-document-toolbar__duplicate" onClick={handleDuplicate}>
            Duplicate
          </button>
        )}
        <button type="button" className="po-btn sap-document-toolbar__find" onClick={() => navigate('/purchase-quotation/find')}>Find</button>
        <button type="button" className="po-btn sap-document-toolbar__new" onClick={resetForm}>New</button>
        <DocumentStatusActions
          type="purchase-quotation"
          docEntry={currentDocEntry}
          actions={['close', 'cancel']}
          className="po-btn"
          disabled={pageState.posting || pageState.loading}
          onDone={(action) => reloadRouteDocument(navigate, location, 'purchaseQuotationDocEntry', currentDocEntry, action)}
          onError={(message) => setPageState((p) => ({ ...p, error: message, success: '' }))}
        />
      </div>

      {/* alerts */}
      {pageState.loading && <div className="po-alert po-alert--success" style={{ marginTop: 0 }}>Loading...</div>}
      {pageState.error && <div className="po-alert po-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="po-alert po-alert--success">{pageState.success}</div>}


      <fieldset ref={documentBodyRef} aria-disabled={!isDocumentEditable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className={`po-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`}>
          <div className="po-layout__main">

            {/* â•â• HEADER CARD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="po-header-card">
              <div className="po-document-header-grid">
                {/* LEFT COLUMN */}
                <div className="po-document-header-column">
                  <div className="po-field-grid" style={{ gridTemplateColumns: '1fr' }}>
                    
                    {/* Vendor Code */}
                    <div className="po-field">
                      <label className="po-field__label">Vendor Code *</label>
                      <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
                        <input
                          name="vendor"
                          className={`po-field__input${valErrors.header.vendor ? ' po-field__input--error' : ''}`}
                          value={header.vendor}
                          onChange={handleHeaderChange}
                          disabled={!!currentDocEntry}
                          placeholder="Vendor code"
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

                    {/* Vendor Name */}
                    <div className="po-field">
                      <label className="po-field__label">Vendor Name</label>
                      <input name="name" className="po-field__input" value={header.name} readOnly />
                    </div>

                    {/* Contact Person */}
                    <div className="po-field">
                      <label className="po-field__label">Contact Person</label>
                      <select
                        name="contactPerson"
                        className="po-field__select"
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

                    {/* Place of Supply */}
                    <div className="po-field">
                      <label className="po-field__label">Place of Supply</label>
                      <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
                        <input
                          name="placeOfSupply"
                          className={`po-field__input${valErrors.header.placeOfSupply ? ' po-field__input--error' : ''}`}
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
                    <div className="po-field">
                      <label className="po-field__label">Payment Terms</label>
                      <select name="paymentTerms" className="po-field__select" value={header.paymentTerms} onChange={handleHeaderChange}>
                        <option value="">Select</option>
                        {payTermOpts.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>

                    {/* Branch */}
                    <div className="po-field">
                      <label className="po-field__label">Branch *</label>
                      <select 
                        name="branch" 
                        className="po-field__select" 
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
                    <div className="po-field">
                      <label className="po-field__label">Warehouse *</label>
                      <select 
                        name="warehouse" 
                        className="po-field__select" 
                        value={header.warehouse || ''} 
                        onChange={handleHeaderChange}
                        style={{ border: valErrors.header.warehouse ? '1px solid #c00' : undefined }}
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
                <div className="po-document-header-column">
                  <div className="po-field-grid" style={{ gridTemplateColumns: '1fr' }}>

                    {/* Series */}
                    <div className="po-field">
                      <label className="po-field__label">Series</label>
                      <select 
                        name="series" 
                        className="po-field__select" 
                        value={header.series || ''} 
                        onChange={handleHeaderChange}
                        disabled={!!currentDocEntry || pageState.seriesLoading}
                      >
                        <option value="">{pageState.seriesLoading ? 'Loading series...' : pageState.seriesError ? 'Series unavailable' : 'Select Series'}</option>
                        {(canUseManualSeries(refData) || (currentDocEntry && isManualDocumentSeries(header.series))) && <option value="-1">Manual</option>}
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
                    <div className="po-field">
                      <label className="po-field__label">Number</label>
                      <input 
                        name="nextNumber" 
                        className="po-field__input" 
                        value={header.nextNumber || ''} 
                        onChange={handleHeaderChange}
                        readOnly={!!currentDocEntry || !isManualDocumentSeries(header.series)}
                        style={{ background: isManualDocumentSeries(header.series) && !currentDocEntry ? '#fff' : '#f0f2f5' }}
                      />
                    </div>

                    {/* Vendor Ref. No. */}
                    <div className="po-field">
                      <label className="po-field__label">Vendor Ref. No.</label>
                      <input name="salesContractNo" className="po-field__input" value={header.salesContractNo} onChange={handleHeaderChange} />
                    </div>

                    {/* Status */}
                    <div className="po-field">
                      <label className="po-field__label">Status</label>
                      <input name="status" className="po-field__input" value={header.status} readOnly style={{ background: '#f0f2f5', color: header.status === 'Open' ? '#1a7a30' : '#c00', fontWeight: 600 }} />
                    </div>

                    {/* Posting Date */}
                    <div className="po-field">
                      <label className="po-field__label">Posting Date *</label>
                      <SapDateInput  name="postingDate" className="po-field__input" value={header.postingDate} onChange={handleHeaderChange} />
                    </div>

                    {/* Delivery Date */}
                    <div className="po-field">
                      <label className="po-field__label">Delivery Date</label>
                      <SapDateInput  name="deliveryDate" className="po-field__input" value={header.deliveryDate} onChange={handleHeaderChange} />
                    </div>

                    {/* Document Date */}
                    <div className="po-field">
                      <label className="po-field__label">Document Date *</label>
                      <SapDateInput 
                         
                        name="documentDate" 
                        className="po-field__input" 
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

            {/* â•â• TABS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="po-tabs">
              {TAB_NAMES.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`po-tab${activeTab === t ? ' po-tab--active' : ''}`}
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
                onOpenHSNModal={openHSNModal}
                onOpenItemModal={(lineIndex, query = '') => setItemModal({ open: true, lineIndex, query })}
                lineItemOptions={lineItemOptions}
                getUomOptions={getUomOptions}
                effectiveTaxCodes={effectiveTaxCodes}
                effectiveWarehouses={branchFilteredWarehouses}
                fmtTaxLabel={fmtTaxLabel}
                getBranchName={getBranchName}
                branches={refData.branches || []}
                hsnCodes={refData.hsn_codes || []}
                formSettings={formSettings}
                matrixFields={effectiveMatrixColumnDefinitions}
                rowUdfFields={rowUdfDefinitions}
                onRowUdfChange={handleRowUdfChange}
                valErrors={valErrors}
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
              <TaxTab header={header} onHeaderChange={handleHeaderChange} onOpenTaxInfoModal={openTaxInfoModal} />
            )}

            {activeTab === 'Electronic Documents' && (
              <ElectronicDocumentsTab header={header} onHeaderChange={handleHeaderChange} />
            )}

            {activeTab === 'Attachments' && (
              <AttachmentsTab attachments={attachments} onBrowseAttachment={handleBrowseAttachment} />
            )}

            {/* â•â• TOTALS FOOTER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="po-header-card">
              <div className="po-field-grid">
                <div>
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
                  <div className="po-field">
                    <label className="po-field__label">Remarks</label>
                    <textarea className="po-textarea" rows={3} name="otherInstruction" value={header.otherInstruction} onChange={handleHeaderChange} />
                  </div>
                </div>
                <div>
                  <div className="po-section-title">Tax Summary</div>
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
                  <div className="po-grid-wrap">
                    <table className="po-grid" style={{ marginTop: '8px' }}>
                      <tbody>
                        <tr>
                          <td>Total Before Discount</td>
                          <td className="po-grid__cell--num"><input className="po-grid__input" value={fmtDec(totals.subtotal, numDec.total)} readOnly /></td>
                        </tr>
                        <tr>
                          <td>Discount %</td>
                          <td className="po-grid__cell--num"><input className="po-grid__input" name="discount" value={header.discount} onChange={handleHeaderChange} onBlur={() => handleNumBlur('discount', 'header')} /></td>
                        </tr>
                        <tr>
                          <td>Freight</td>
                          <td className="po-grid__cell--num" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
                          <td>
                            <label className="po-checkbox-label">
                              <input type="checkbox" name="rounding" checked={header.rounding} onChange={handleHeaderChange} />
                              Rounding
                            </label>
                          </td>
                          <td className="po-grid__cell--num"><DocumentRoundingInput className="po-grid__input" header={header} setHeader={setHeader} formattedAmount={fmtDec(totals.roundingAmount, numDec.totalPaymentDue)} disabled={!isDocumentEditable} onManualChange={markDirty} /></td>
                        </tr>
                        <tr>
                          <td>Tax</td>
                          <td className="po-grid__cell--num"><input className="po-grid__input" value={fmtDec(totals.taxAmt, numDec.tax)} readOnly /></td>
                        </tr>
                        <tr style={{ borderTop: '2px solid #a0aab4' }}>
                          <td style={{ fontWeight: 700, color: '#003366' }}>Total</td>
                          <td className="po-grid__cell--num" style={{ fontWeight: 700, color: '#003366' }}><input className="po-grid__input" style={{ fontWeight: 700, color: '#003366' }} value={fmtDec(totals.total, numDec.totalPaymentDue)} readOnly /></td>
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
                <button type="submit" className="po-btn po-btn--primary" disabled={pageState.posting}>
                  {secondaryActionLabel}
                </button>
                <button type="button" className="po-btn" onClick={resetForm}>
                  Cancel
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
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
                        openCopyFromModal('purchaseRequest');
                        document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
                      }}
                    >
                      Purchase Requests
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
                        handleCopyTo('purchaseOrder');
                        document.querySelectorAll('.po-dropdown').forEach((node) => node.classList.remove('active'));
                      }}
                    >
                      Purchase Order
                    </button>
                  </div>
                </div>
              </div>
            </div>
            )}

          </div>{/* end main col */}

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

      {/* HSN Code Modal */}
      <HSNCodeModal
        isOpen={hsnModal.open}
        onClose={closeHSNModal}
        onSelect={handleHSNSelect}
        hsnCodes={refData.hsn_codes || []}
      />

      {/* State Selection Modal */}
      <ItemSelectionModal
        isOpen={itemModal.open}
        onClose={() => setItemModal({ open: false, lineIndex: -1, query: '' })}
        initialQuery={itemModal.query}
        items={refData.items}
        onSelect={(item) => {
          if (itemModal.lineIndex < 0 || !lines[itemModal.lineIndex]) return;
          return handleLineChange(itemModal.lineIndex, {
            target: { name: 'itemNo', value: item.ItemCode },
          });
        }}
      />
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

export default PurchaseOrder;
