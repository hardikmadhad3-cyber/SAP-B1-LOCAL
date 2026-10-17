import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import { isManualDocumentSeries, isValidManualDocumentNumber } from '../../utils/documentSeries';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import './styles/purchase-request.css';
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
import ReferenceDocumentsModal from '../sales-order/components/ReferenceDocumentsModal';
import CopyToDropdown from '../../components/document/CopyToDropdown';
import { copyToDocument } from '../../services/documentCopyService';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import AddressModal from '../../components/document/AddressComponentModal';
import TaxInfoModal from './components/TaxInfoModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import BusinessPartnerModal from './components/BusinessPartnerModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { recalculateAllTaxCodes, getGSTTypeLabel } from '../../utils/taxEngine';
import { filterWarehousesByBranch } from '../../utils/warehouseBranch';
import { getDefaultSeriesForCurrentYear, getSapVisibleDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import { useStandardSalesFormSettings } from '../../utils/standardSalesFormSettings';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount } from '../../utils/documentRounding';
import DocumentRoundingInput from '../../components/sales-document/DocumentRoundingInput';
import { mapAddressToModalForm, resolveAddressForModal } from '../../utils/documentAddress';
import { duplicateDocumentInPlace, refreshDuplicateSeries } from '../../utils/documentDuplicate';
import { getItemPurchaseUom } from '../../utils/documentItemHydration';
import { applyUomCodeSelection, getLineUomOptions } from '../../utils/documentUom';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import { fetchSalesDocumentSchema } from '../../api/salesDocumentSchemaApi';
import { buildSalesDocumentLiveFields } from '../../utils/salesDocumentLiveFields';
import { mergeLiveMatrixSettings } from '../../utils/liveDocumentLayout';
import { buildSalesOrderMatrixColumnsFromLayout } from '../sales-order/documentLayout';
import {
  fetchPurchaseRequestByDocEntry,
  fetchPurchaseRequestReferenceData,
  fetchPurchaseRequestVendorDetails,
  fetchPurchaseRequestDocumentSeries,
  fetchPurchaseRequestItemsForModal,
  submitPurchaseRequest,
  updatePurchaseRequest,
  fetchFreightCharges,
} from '../../api/purchaseRequestApi';
import { fetchHSNCodes, fetchHSNCodeFromItem } from '../../api/hsnCodeApi';
import { FALLBACK_TAX_CODES } from '../../utils/fallbackTaxCodes';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import {
  BASE_MATRIX_COLUMNS,
  normalizePurchaseRequestMatrixColumns,
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createUdfState,
  readSavedFormSettings,
} from '../../config/purchaseRequestForm';

import useUnsavedChangesWarning, { hasEnteredDocumentLines } from '../../hooks/useUnsavedChangesWarning';
import DocumentStatusActions from '../../components/document/DocumentStatusActions';
import { reloadRouteDocument } from '../../utils/copyToState';
// ─── helpers ─────────────────────────────────────────────────────────────────
const getErrMsg = (e, fb) => {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string' && d.trim()) return d;
  if (d?.error?.message) return d.error.message;
  if (d?.message) return d.message;
  return e?.message || fb;
};
const today = () => new Date().toISOString().split('T')[0];
const oneMonthFromToday = () => {
  const value = new Date();
  value.setMonth(value.getMonth() + 1);
  return value.toISOString().split('T')[0];
};
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

// ─── constants ────────────────────────────────────────────────────────────────
const DEC = { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 };
const TAB_NAMES = ['Contents', 'Attachments'];
const GENERAL_SETTINGS = readGeneralSettings();

const createLine = (rowUdfDefinitions = ROW_UDF_DEFINITIONS, requiredDate = today()) => ({
  itemNo: '',
  itemDescription: '',
  hsnCode: '',
  quantity: '',
  uomCode: '',
  unitPrice: '',
  stdDiscount: '',
  taxCode: '',
  total: '',
  whse: '',
  loc: '',
  branch: '',
  vendor: '',
  requiredDate,
  distributionRule: '',
  accountCode: '',
  udf: createUdfState(rowUdfDefinitions),
});

const INIT_HEADER = {
  documentType: 'Item',
  requesterType: 'User',
  requesterCode: '',
  requesterName: '',
  requesterBranch: '',
  requesterDepartment: '',
  requesterEmail: '',
  sendEmail: false,
  validUntil: oneMonthFromToday(),
  vendor: '',
  name: '',
  contactPerson: '',
  salesContractNo: '',
  branch: '',
  warehouse: GENERAL_SETTINGS.purchaseRequestWarehouse || '',
  docNo: '',
  status: 'Open',
  series: GENERAL_SETTINGS.purchaseRequestSeries || '',
  nextNumber: '',
  postingDate: today(),
  deliveryDate: '',
  documentDate: today(),
  contractDate: '',
  branchRegNo: '',
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
  requiredDate: today(),
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
};

// ─── Main Component ───────────────────────────────────────────────────────────
function PurchaseRequest() {
  const [seriesRevision, setSeriesRevision] = useState(0);

  const { company, user } = useAuth();
  const { removeTask, upsertTask } = useSapWindowTaskbarActions();
  const activeCompanyId = company?.companyId || '';
  const location = useLocation();
  const navigate = useNavigate();
  const initialPurchaseRequestDocEntryRef = useRef(location.state?.purchaseRequestDocEntry || null);

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(INIT_HEADER);
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState(HEADER_UDF_DEFINITIONS);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState(ROW_UDF_DEFINITIONS);
  const [matrixColumnDefinitions, setMatrixColumnDefinitions] = useState(BASE_MATRIX_COLUMNS);
  const [lines, setLines] = useState([createLine(ROW_UDF_DEFINITIONS)]);
  const [attachments, setAttachments] = useState([]);
  const [activeTab, setActiveTab] = useState('Contents');
  const [referenceDocuments, setReferenceDocuments] = useState([]);
  const [referenceDocumentsModal, setReferenceDocumentsModal] = useState(false);
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
    requester_branches: [],
    requester_users: [],
    requester_employees: [],
    departments: [],
    service_accounts: [],
    decimal_settings: DEC,
    warnings: [],
    series: [],
    states: [],
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
  const [isDirty, setIsDirty] = useState(false);
  useValidationHighlights(valErrors);
  const [addressModal, setAddressModal] = useState(null);
  const [taxInfoModal, setTaxInfoModal] = useState(false);
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, items: [], loading: false });
  const [stateModal, setStateModal] = useState(false);
  const [bpModal, setBpModal] = useState({ open: false, lineIndex: -1 });
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
  const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1 });
  const [addressForm, setAddressForm] = useState({
    streetNo: '', buildingFloorRoom: '', block: '', city: '', zipCode: '', county: '',
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

  const markDirty = useCallback((event) => {
    if (event?.target?.closest?.('[data-document-dirty-ignore="true"]')) return;
    if (currentDocEntry) setIsDirty(true);
  }, [currentDocEntry]);

  // ── load reference data ───────────────────────────────────────────────────
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
        const [refDataRes, seriesRes, hsnRes, layoutRes, schema] = await Promise.all([
          fetchPurchaseRequestReferenceData(activeCompanyId),
          fetchPurchaseRequestDocumentSeries({ date: today() }),
          fetchHSNCodes(),
          getDocumentLayout({ documentType: 'PURCHASE_REQUEST', companyDb: company?.dbName, refresh: true }).catch((error) => ({
            data: {
              success: false,
              columns: [],
              warning: getErrMsg(error, 'Failed to load SAP layout.'),
            },
          })),
          fetchSalesDocumentSchema({ documentType: 'PURCHASE_REQUEST' }).catch(() => null),
        ]);

        if (!ignore) {
          const liveMatrixColumns = refDataRes.data.line_field_metadata?.matrix_columns?.length
            ? refDataRes.data.line_field_metadata.matrix_columns
            : BASE_MATRIX_COLUMNS;
          const liveFields = buildSalesDocumentLiveFields({
            schema,
            documentType: 'PURCHASE_REQUEST',
            objectType: '1470000113',
            headerTable: 'OPRQ',
            lineTable: 'PRQ1',
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
          const companyLayoutColumns = buildSalesOrderMatrixColumnsFromLayout({
            layoutColumns: layoutRes?.data?.columns || [],
            liveMatrixColumns,
            rowUdfFields: nextRowUdfs,
            includeLineNumber: false,
            appendMissingLiveColumns: false,
          });
          const nextMatrixColumns = normalizePurchaseRequestMatrixColumns(
            companyLayoutColumns.length ? companyLayoutColumns : BASE_MATRIX_COLUMNS
          );
          const hasSapMatrixPreferences = Boolean(
            layoutRes?.data?.source && layoutRes.data.source !== 'fallback'
          );
          setHeaderUdfDefinitions(nextHeaderUdfs);
          setRowUdfDefinitions(nextRowUdfs);
          setHeaderUdfs((prev) => ({ ...createUdfState(nextHeaderUdfs), ...prev }));
          setLines((prev) => prev.map((line) => ({
            ...line,
            udf: createUdfState(nextRowUdfs, line.udf || {}),
          })));
          setMatrixColumnDefinitions(nextMatrixColumns);
          const nextDefaults = readSavedFormSettings(
            nextHeaderUdfs,
            nextRowUdfs,
            nextMatrixColumns,
            formSettingsStorageKey,
          );
          replaceFormSettings((prev) => mergeLiveMatrixSettings(nextDefaults, prev, hasSapMatrixPreferences));

          setRefData({
            company: refDataRes.data.company || '',
            company_state: refDataRes.data.company_state || '',
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
            requester_branches: refDataRes.data.requester_branches || [],
            requester_users: refDataRes.data.requester_users || [],
            requester_employees: refDataRes.data.requester_employees || [],
            departments: refDataRes.data.departments || [],
            service_accounts: refDataRes.data.service_accounts || [],
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

          if (seriesRes.data.series && seriesRes.data.series.length > 0 && !initialPurchaseRequestDocEntryRef.current && !String(header.series || '').trim()) {
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
        if (!ignore) setPageState(p => ({ ...p, loading: false }));
      }
    };
    load();
    return () => { ignore = true; };
  }, [activeCompanyId, company?.dbName, formSettingsStorageKey]);

  useEffect(() => {
    if (currentDocEntry || header.requesterCode || !refData.requester_users.length) return;
    const loginNames = [user?.username, user?.fullName]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    const requester = refData.requester_users.find((entry) => {
      const values = [entry.code, entry.name].map((value) => String(value || '').trim().toLowerCase());
      return loginNames.some((name) => values.includes(name));
    }) || refData.requester_users[0];
    if (!requester) return;
    setHeader((previous) => ({
      ...previous,
      requesterType: 'User',
      requesterCode: requester.code,
      requesterName: requester.name,
      requesterBranch: requester.branch,
      requesterDepartment: requester.department,
      requesterEmail: requester.email,
    }));
  }, [currentDocEntry, header.requesterCode, refData.requester_users, user?.fullName, user?.username]);



  // ── load existing order ───────────────────────────────────────────────────
  useEffect(() => {
    const docEntry = location.state?.purchaseRequestDocEntry;
    if (!docEntry) return;
    let ignore = false;
    const load = async () => {
      setPageState(p => ({ ...p, loading: true, error: '', success: '' }));
      try {
        const r = await fetchPurchaseRequestByDocEntry(docEntry);
        const purchaseRequest = r.data.purchase_request;
        if (ignore || !purchaseRequest) return;
        setCurrentDocEntry(purchaseRequest.doc_entry || Number(docEntry));
        setHeader(prev => ({
          ...prev,
          ...INIT_HEADER,
          ...(purchaseRequest.header || {}),
        }));

        setLines(
          Array.isArray(purchaseRequest.lines) && purchaseRequest.lines.length
            ? purchaseRequest.lines.map(l => ({ ...createLine(rowUdfDefinitions), ...l, udf: { ...createUdfState(rowUdfDefinitions), ...(l.udf || {}) } }))
            : [createLine(rowUdfDefinitions)]
        );
        setHeaderUdfs({ ...createUdfState(headerUdfDefinitions), ...(purchaseRequest.header_udfs || {}) });
        setReferenceDocuments(purchaseRequest.reference_documents || []);
        setIsDirty(false);
        if (purchaseRequest.header?.vendor) {
          loadVendorDetails(purchaseRequest.header.vendor);
        }
        setPageState(p => ({
          ...p,
          success: location.state?.documentStatusMessage || (purchaseRequest.doc_num
            ? `Purchase request ${purchaseRequest.doc_num} loaded.`
            : 'Purchase request loaded.'),
        }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load purchase request.') }));
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
  }, [currentDocEntry, numDec.freight]);

  // ── derived / computed ────────────────────────────────────────────────────
  const vendorContacts = useMemo(
    () => (refData.contacts || []).filter(c => String(c.CardCode || '') === String(header.vendor || '')),
    [header.vendor, refData.contacts],
  );
  const contactOptions = header.contactPerson && !vendorContacts.some(c => String(c.CntctCode || '') === String(header.contactPerson || ''))
    ? [{ CardCode: header.vendor, CntctCode: header.contactPerson, Name: header.contactPerson }, ...vendorContacts]
    : vendorContacts;
  const vendorPayToAddresses = useMemo(
    () => (refData.pay_to_addresses || []).filter(a => String(a.CardCode || '') === String(header.vendor || '')),
    [header.vendor, refData.pay_to_addresses],
  );
  const vendorShipToAddresses = useMemo(
    () => (refData.ship_to_addresses || []).filter(a => String(a.CardCode || '') === String(header.vendor || '')),
    [header.vendor, refData.ship_to_addresses],
  );
  const vendorBillToAddresses = useMemo(
    () => (refData.bill_to_addresses || []).filter(a => String(a.CardCode || '') === String(header.vendor || '')),
    [header.vendor, refData.bill_to_addresses],
  );
  const vendorEffectiveShipToAddresses = useMemo(
    () => (vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses),
    [vendorPayToAddresses, vendorShipToAddresses],
  );
  const vendorEffectiveBillToAddresses = useMemo(
    () => (vendorBillToAddresses.length ? vendorBillToAddresses : vendorPayToAddresses),
    [vendorBillToAddresses, vendorPayToAddresses],
  );
  const selectedBranch = useMemo(
    () => refData.branches.find(b => String(b.BPLId || '') === String(header.branch || '')),
    [header.branch, refData.branches],
  );

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
  const effectiveTaxCodes = refData.tax_codes.length ? refData.tax_codes : FALLBACK_TAX_CODES;
  const effectiveWarehouses = refData.warehouses;
  const branchFilteredWarehouses = useMemo(
    () => filterWarehousesByBranch(effectiveWarehouses, header.branch),
    [effectiveWarehouses, header.branch],
  );
  const freightTotals = summarizeFreightRows(freightModal.freightCharges, effectiveTaxCodes);

  const getBranchName = (branchId) => {
    if (!branchId) return '';
    const branch = refData.branches.find(b => String(b.BPLId) === String(branchId));
    return branch ? branch.BPLName : branchId;
  };

  const getWarehouseLocationCode = (warehouseCode) => {
    if (!warehouseCode) return '';
    const warehouse = effectiveWarehouses.find(
      (entry) => String(entry.WhsCode || '') === String(warehouseCode)
    );
    return warehouse?.LocationCode == null ? '' : String(warehouse.LocationCode);
  };

  // ── calculations ──────────────────────────────────────────────────────────
  const calcLineTotal = (line) => {
    const qty = header.documentType === 'Service' ? 1 : parseNum(line.quantity);
    const price = parseNum(line.unitPrice), disc = parseNum(line.stdDiscount);
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
    objectType: 1470000113,
    docEntry: currentDocEntry,
    header,
    total: totals.total,
  });

  // ── GST Logic - Recalculate Tax Codes ────────────────────────────────────
  // Automatically recalculate tax codes when place of supply or vendor changes
  useEffect(() => {
    if (!header.vendor || !header.placeOfSupply) return;

    const companyState = refData.company_address?.State || selectedBranch?.State || '';
    
    if (!companyState) {
      console.warn('⚠️ Company state not available for tax recalculation');
      return;
    }

    console.log('🔄 Recalculating Tax Codes for All Lines:', {
      placeOfSupply: header.placeOfSupply,
      companyState,
      gstType: getGSTTypeLabel(companyState, header.placeOfSupply),
      status: 'starting'
    });

    // Recalculate tax codes for all lines with items
    setLines(prevLines => recalculateAllTaxCodes(
      prevLines,
      refData.items,
      header.placeOfSupply,  // shipToState (using placeOfSupply)
      header.placeOfSupply,  // billToState (using placeOfSupply)
      header.usePayToForTax || false,  // useBillToForTax
      companyState,
      effectiveTaxCodes
    ));
  }, [header.placeOfSupply, header.vendor, header.usePayToForTax, refData.company_address, selectedBranch, refData.items, effectiveTaxCodes]);

  // ── address sync ──────────────────────────────────────────────────────────
  // Sync branch to all lines when header branch changes
  useEffect(() => {
    if (header.branch) {
      console.log('🔄 Syncing branch to all lines:', header.branch);
      setLines(prev => {
        const updated = prev.map(l => ({ 
          ...l, 
          branch: String(header.branch)
        }));
        console.log('✅ Lines updated with branch:', updated.map(l => ({ branch: l.branch, loc: l.loc })));
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

    setLines(prev => {
      let changed = false;
      const next = prev.map(line => {
        if (line.whse && !allowedWarehouseCodes.has(String(line.whse))) {
          changed = true;
          return { ...line, whse: '', loc: '' };
        }
        return line;
      });
      return changed ? next : prev;
    });
  }, [branchFilteredWarehouses, header.branch, refData.warehouses.length]);

  // Sync warehouse to all lines when header warehouse changes
  useEffect(() => {
    if (header.warehouse) {
      setLines(prev => prev.map(l => ({
        ...l,
        whse: header.warehouse,
        loc: getWarehouseLocationCode(header.warehouse),
      })));
    }
  }, [header.warehouse]);

  useEffect(() => {
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

  // ── vendor details ────────────────────────────────────────────────────────
  const loadVendorDetails = async (code) => {
    if (!code) {
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setHeader(prev => ({ ...prev, placeOfSupply: '' }));
      return;
    }

    setPageState(p => ({ ...p, vendorLoading: true }));

    try {
      const r = await fetchPurchaseRequestVendorDetails(code);
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
     
      // Auto-select first contact if available
      if (contacts.length > 0) {
        setHeader(prev => ({
          ...prev,
          contactPerson: contacts[0].CntctCode
        }));
      }

      // Auto-populate addresses from vendor
      const effectiveShipTo = shipToAddresses.length ? shipToAddresses : payToAddresses;
      const effectiveBillTo = billToAddresses.length ? billToAddresses : payToAddresses;

      if (effectiveShipTo.length > 0) {
        const defaultShipTo = effectiveShipTo[0];
        if (defaultShipTo.State) {
          console.log('🌍 Auto-setting Place of Supply from vendor ship-to address:', defaultShipTo.State);
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
    } catch (err) {
      console.error('Error loading vendor details:', err);
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
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
        paymentTerms: m.GroupNum != null ? String(m.GroupNum) : hdr.paymentTerms,
        contactPerson: '',
        shipTo: '',
        shipToCode: '',
        billTo: '',
        billToCode: '',
        payTo: '',
        payToCode: '',
        placeOfSupply: '',
      },
      vatGroup: m.VatGroup || '',
    };
  };

  // ── handlers ──────────────────────────────────────────────────────────────
   const handleHeaderChange = (e) => {
    const { name, value, type, checked } = e.target;
    setValErrors(p => ({ ...p, header: { ...p.header, [name]: '' }, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));
    
    if (name === 'series') {
      handleSeriesChange(value);
      return;
    }

    if (name === 'requesterType') {
      setHeader((previous) => ({
        ...previous,
        requesterType: value,
        requesterCode: '',
        requesterName: '',
        requesterBranch: '',
        requesterDepartment: '',
        requesterEmail: '',
      }));
      return;
    }

    if (name === 'requesterCode') {
      const options = header.requesterType === 'Employee'
        ? refData.requester_employees
        : refData.requester_users;
      const requester = options.find((entry) => String(entry.code) === String(value));
      setHeader((previous) => ({
        ...previous,
        requesterCode: value,
        requesterName: requester?.name || '',
        requesterBranch: requester?.branch || '',
        requesterDepartment: requester?.department || '',
        requesterEmail: requester?.email || '',
      }));
      return;
    }

    if (name === 'documentType') {
      setHeader((previous) => ({ ...previous, documentType: value }));
      setLines([createLine(rowUdfDefinitions, header.requiredDate || today())]);
      return;
    }

    if (name === 'requiredDate') {
      setHeader((previous) => ({ ...previous, requiredDate: value }));
      setLines((previousLines) => previousLines.map((line) => ({
        ...line,
        requiredDate: !line.requiredDate || line.requiredDate === header.requiredDate
          ? value
          : line.requiredDate,
      })));
      return;
    }

    if (name === 'requesterBranch') {
      setHeader((previous) => ({ ...previous, requesterBranch: value }));
      return;
    }
    
    if (name === 'shipToCode') {
      handleShipToChange(value);
      return;
    }
    
    if (name === 'vendor') {
      setHeader(prev => {
        const prep = { ...prev, [name]: value };
        const { nextHeader, vatGroup } = syncVendor(value, prep);
        nextHeader.contactPerson = '';
        setLines(ls => ls.map(l => ({
          ...l,
          taxCode: vatGroup || l.taxCode
        })));
        return nextHeader;
      });
      loadVendorDetails(value);
      return;
    }
    if (numDec[name] !== undefined && type !== 'checkbox') {
      setHeader(p => ({ ...p, [name]: sanitize(value, numDec[name]) }));
      return;
    }
    setHeader(p => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
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

      if (name === 'itemNo') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));
        if (item) {
          next.itemDescription = item.ItemName || next.itemDescription;
          next.hsnCode = item.HSNCode || next.hsnCode || '';
          Object.assign(next, getItemPurchaseUom(item, refData.uom_groups));
          next.vendor = item.PreferredVendor || item.CardCode || next.vendor || '';

          // Auto-assign default warehouse
          if (item.DefaultWarehouse) {
            next.whse = item.DefaultWarehouse;
            next.loc = getWarehouseLocationCode(item.DefaultWarehouse);
          }
        }

        // Auto-assign tax code if not set
        if (!next.taxCode) {
          const v = refData.vendors.find(vv => String(vv.CardCode || '') === String(header.vendor || ''));
          if (v?.VatGroup) next.taxCode = v.VatGroup;
        }
      }
      if (name === 'uomCode') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(next.itemNo || ''));
        Object.assign(next, applyUomCodeSelection(next, value, getLineUomOptions(next, item, refData.uom_groups)));
      }
      
      if (name === 'whse') {
        next.loc = getWarehouseLocationCode(value);
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
      
      if (header.documentType === 'Item' && !String(lastLine.itemNo || '').trim()) {
        errors.push('Item No.');
      }
      if (header.documentType === 'Service' && !String(lastLine.itemDescription || '').trim()) {
        errors.push('Service Description');
      }
      if (header.documentType === 'Service' && !String(lastLine.accountCode || '').trim()) {
        errors.push('G/L Account');
      }
      if (!lastLine.requiredDate) {
        errors.push('Required Date');
      }
      if (header.documentType === 'Item' && (!lastLine.quantity || Number(lastLine.quantity) <= 0)) {
        errors.push('Quantity');
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
    setLines(p => [...p, { 
      ...createLine(rowUdfDefinitions, header.requiredDate || today()),
      branch: header.branch || '', 
      loc: getWarehouseLocationCode(header.warehouse),
      whse: header.warehouse || ''
    }]);
  };

  const removeLine = (i) => {
    setValErrors(p => { const nl = { ...p.lines }; delete nl[i]; return { ...p, lines: nl, form: '' }; });
    setLines(p => p.filter((_, idx) => idx !== i));
  };

  const handleHeaderUdfChange = (k, v) => setHeaderUdfs(p => ({ ...p, [k]: v }));
  const handleRowUdfChange = (lineIndex, key, value) => {
    setLines((previousLines) => previousLines.map((line, index) => (
      index === lineIndex
        ? { ...line, udf: { ...(line.udf || {}), [key]: value } }
        : line
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

  // ── Series and Auto-Numbering handlers ────────────────────────────────────
  const handleSeriesChange = (seriesValue) => {
      const manual = ['-1', 'manual', '__sap_manual__'].includes(String(seriesValue).toLowerCase());
      if (manual && !canUseManualSeries(refData)) return;
      const selected = (refData.series || []).find(row => String(row.Series) === String(seriesValue));
      setHeader(prev => ({ ...prev, series: manual ? '-1' : selected ? String(selected.Series) : '', nextNumber: manual ? '' : String(selected?.NextNumber ?? ''), docNo: '' }));
      setPageState(prev => ({ ...prev, error: '', success: '' }));
    };

  const handleDuplicate = () => {
    setSeriesRevision(value => value + 1);

    initialPurchaseRequestDocEntryRef.current = null;
    const duplicated = duplicateDocumentInPlace({
      currentDocEntry,
      header,
      initialHeader: INIT_HEADER,
      lines,
      createLine,
      setCurrentDocEntry,
      setHeader,
      setLines,
      setActiveTab,
      setValErrors,
      setPageState,
      setFreightModal,
      navigate,
      location,
      successMessage: 'Purchase request duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      refreshDuplicateSeries(refData.series, '', handleSeriesChange);
    }
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

  // ── Address Modal handlers ────────────────────────────────────────────────
  const openAddressModal = (type) => {
    const isShipTo = type === 'shipTo';
    const addresses = isShipTo ? vendorEffectiveShipToAddresses : vendorEffectiveBillToAddresses;
    const addressCode = isShipTo
      ? header.shipToCode
      : (header.payToCode || header.billToCode);
    const addressText = isShipTo
      ? header.shipTo
      : (header.payTo || header.billTo);
    const activeAddress = resolveAddressForModal(addressCode, addresses, addressText);

    setAddressForm(mapAddressToModalForm(activeAddress));
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

  // ── Tax Info Modal handlers ───────────────────────────────────────────────
  const openTaxInfoModal = () => {
    setTaxInfoModal(true);
  };

  const closeTaxInfoModal = () => {
    setTaxInfoModal(false);
  };

  const saveTaxInfoModal = () => {
    closeTaxInfoModal();
  };

  const openItemModal = async (lineIndex) => {
    setItemModal({ open: true, lineIndex, items: [], loading: true });
    try {
      const response = await fetchPurchaseRequestItemsForModal();
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
        next.hsnCode = hsnCode;
        next.vendor = item.PreferredVendor || item.CardCode || next.vendor || '';
        if (item.DefaultWarehouse) {
          next.whse = item.DefaultWarehouse;
          next.loc = getWarehouseLocationCode(item.DefaultWarehouse);
        }
        next.total = fmtDec(calcLineTotal(next), numDec.total);
        return next;
      }));
    } catch {
      setLines(prev => prev.map((line, idx) => {
        if (idx !== lineIndex) return line;
        return {
          ...line,
          itemNo: item.ItemCode,
          itemDescription: item.ItemName || '',
          ...getItemPurchaseUom(item, refData.uom_groups),
          hsnCode: item.HSNCode || '',
          vendor: item.PreferredVendor || item.CardCode || line.vendor || '',
          whse: item.DefaultWarehouse || line.whse || '',
          loc: item.DefaultWarehouse
            ? getWarehouseLocationCode(item.DefaultWarehouse)
            : line.loc || '',
        };
      }));
    }
    closeItemModal();
  };

  const handleTaxInfoFormChange = (e) => {
    const { name, value } = e.target;
    setTaxInfoForm(p => ({ ...p, [name]: value }));
  };

  // ── HSN Modal handlers ────────────────────────────────────────────────────
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

  // ── Business Partner Modal handlers ───────────────────────────────────────
  const openBpModal = () => {
    setBpModal({ open: true, lineIndex: -1 });
  };

  const openVendorModal = (lineIndex) => {
    setBpModal({ open: true, lineIndex });
  };

  const closeBpModal = () => {
    setBpModal({ open: false, lineIndex: -1 });
  };

  const handleBpSelect = (bp) => {
    if (bpModal.lineIndex >= 0) {
      setLines((previousLines) => previousLines.map((line, index) => (
        index === bpModal.lineIndex
          ? { ...line, vendor: bp.CardCode || '' }
          : line
      )));
      closeBpModal();
      return;
    }

    setHeader(prev => {
      const prep = { ...prev, vendor: bp.CardCode };
      const { nextHeader, vatGroup } = syncVendor(bp.CardCode, prep);
      nextHeader.contactPerson = '';
      setLines(ls => ls.map(l => ({
        ...l,
        taxCode: vatGroup || l.taxCode
      })));
      return nextHeader;
    });
    loadVendorDetails(bp.CardCode);
    closeBpModal();
  };

  // ── State Selection Modal handlers ────────────────────────────────────────
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

  // ── Browse Attachment handler ─────────────────────────────────────────────
  const handleBrowseAttachment = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from(e.target.files);
      setAttachments((previous) => [
        ...previous,
        ...files.map((file, index) => ({
          id: previous.length + index + 1,
          targetPath: file.webkitRelativePath || '',
          fileName: file.name,
          attachmentDate: today(),
          freeText: '',
          copyToTargetDocument: 'No',
          documentType: file.type || '',
          atchDocDate: today(),
          alert: '',
          file,
        })),
      ]);
    };
    input.click();
  };

  // ── validation ────────────────────────────────────────────────────────────
  const validate = () => {
    const e = { header: {}, lines: {}, form: '' };
    if (!currentDocEntry && isManualDocumentSeries(header.series) && !isValidManualDocumentNumber(header.nextNumber)) {
      e.form = 'Enter a positive whole document number for Manual series.';
      return e;
    }

    if (!String(header.requesterCode || '').trim()) e.header.requesterCode = 'Select a requester.';
    if (!String(header.postingDate || '').trim()) e.header.postingDate = 'Posting Date is required.';
    if (!String(header.validUntil || '').trim()) e.header.validUntil = 'Valid Until is required.';
    if (!String(header.documentDate || '').trim()) e.header.documentDate = 'Document Date is required.';
    if (!String(header.requiredDate || '').trim()) e.header.requiredDate = 'Required Date is required.';
    if (header.sendEmail && !String(header.requesterEmail || '').trim()) {
      e.header.requesterEmail = 'E-Mail Address is required when notification is enabled.';
    }

    const pop = lines.filter((line) => String(
      line.itemNo || line.accountCode || line.itemDescription || ''
    ).trim());
    if (!pop.length) e.form = 'Add at least one document line.';

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const isPopulated = String(l.itemNo || l.accountCode || l.itemDescription || '').trim();
      if (!isPopulated) continue;

      if (header.documentType === 'Item' && !String(l.itemNo || '').trim()) {
        e.lines[i] = { ...(e.lines[i] || {}), itemNo: 'Item is required.' };
      }
      if (header.documentType === 'Service' && !String(l.itemDescription || '').trim()) {
        e.lines[i] = { ...(e.lines[i] || {}), itemDescription: 'Service description is required.' };
      }
      if (header.documentType === 'Service' && !String(l.accountCode || '').trim()) {
        e.lines[i] = { ...(e.lines[i] || {}), itemNo: 'G/L Account is required.' };
      }
      if (header.documentType === 'Item' && Number(l.quantity) <= 0) {
        e.lines[i] = { ...(e.lines[i] || {}), quantity: 'Required Quantity must be greater than zero.' };
      }
      if (!String(l.requiredDate || '').trim()) {
        e.lines[i] = { ...(e.lines[i] || {}), requiredDate: 'Required Date is required.' };
      }
    }

    if (Object.keys(e.header).length || Object.keys(e.lines).length) {
      e.form = e.form || 'Please correct the highlighted fields.';
    }

    return e;
  };

  // ── submit ────────────────────────────────────────────────────────────────
  const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
    docEntry: currentDocEntry, isDirty,
    state: { header, lines, headerUdfs, referenceDocuments, freightCharges: freightModal.freightCharges , company_id: activeCompanyId, companyKey: formSettingsStorageKey },
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
        roundingAmount: getDocumentRoundingPayloadAmount(header, totals.roundingAmount),
        roundingAmountIsManual: header.roundingAmountIsManual === true,
        series: header.series ? Number(header.series) : undefined,
      };

      const payloadLines = lines.map((line) => ({
        ...line,
        udf: buildVisibleEnteredRowUdfPayload(rowUdfDefinitions, line.udf || {}, formSettings),
      }));
      const payload = {
        company_id: activeCompanyId,
        header: prep,
        lines: payloadLines,
        header_udfs: headerUdfs,
        reference_documents: referenceDocuments,
        freight_charges: freightModal.freightCharges,
      };
      const r = currentDocEntry
        ? await updatePurchaseRequest(currentDocEntry, narrowConfirmationUpdate(payload))
        : await submitPurchaseRequest(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      setIsDirty(false);
      setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
      setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
      setReferenceDocuments([]);
      setAttachments([]);
      setRefData(p => ({
        ...p,
        contacts: [],
        pay_to_addresses: [],
        ship_to_addresses: [],
        bill_to_addresses: [],
      }));
      setValErrors({ header: {}, lines: {}, form: '' });
      setItemModal({ open: false, lineIndex: -1, items: [], loading: false });
      setFreightModal({ open: false, freightCharges: [], loading: false });

      if (refData.series.length > 0) {
        setHeader(prev => ({ ...prev, series: '', nextNumber: '', docNo: '' }));
      }

      setPageState(p => ({ ...p, success: `${r.data.message || 'Purchase request saved.'}${dn}` }));
    } catch (e) {
      setPageState(p => ({ ...p, error: getErrMsg(e, 'Purchase request submission failed.') }));
    } finally {
      setPageState(p => ({ ...p, posting: false }));
    }
  };

  const resetForm = () => {
    setSeriesRevision(value => value + 1);

    setIsDirty(false);
    setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
    setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
    setReferenceDocuments([]);
    setReferenceDocumentsModal(false);
    setAttachments([]);
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, error: '', success: '' }));
    setItemModal({ open: false, lineIndex: -1, items: [], loading: false });
    setFreightModal({ open: false, freightCharges: [], loading: false });
  };

  const handleCopyTo = async (targetType) => {
    await copyToDocument({
      sourceDocType: 'purchaseRequest',
      targetType,
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: { header, lines, headerUdfs, freightCharges: freightModal.freightCharges },
      restoreState: { purchaseRequestDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      setError: (message) => setPageState((previous) => ({ ...previous, success: '', error: message })),
      errorMessage: 'Please save the purchase request before using Copy To.',
    });
  };

  const hasRequester = Boolean(String(header.requesterCode || '').trim());
  const visHdrUdfs = headerUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;

  // ── render ────────────────────────────────────────────────────────────────
  useDocumentSeries({ endpoint: '/purchase-request', companyKey: formSettingsStorageKey, currentDocEntry, header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form className={`po-page sap-document-page purchase-request-classic${isRightSidebarOpen ? ' po-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>

      {/* toolbar */}
      <div className="po-toolbar sap-document-toolbar">
        <span className="po-toolbar__title">Purchase Request{currentDocEntry ? ` — #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="po-btn po-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || !isDocumentEditable} title={primaryActionLabel}>
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
        <button type="button" className="po-btn sap-document-toolbar__find" onClick={() => navigate('/purchase-request/find')}>Find</button>
        <button type="button" className="po-btn sap-document-toolbar__new" onClick={resetForm}>New</button>
        <DocumentStatusActions
          type="purchase-request"
          docEntry={currentDocEntry}
          actions={['close', 'cancel']}
          className="po-btn"
          disabled={pageState.posting || pageState.loading}
          onDone={(action) => reloadRouteDocument(navigate, location, 'purchaseRequestDocEntry', currentDocEntry, action)}
          onError={(message) => setPageState((p) => ({ ...p, error: message, success: '' }))}
        />
        <CopyToDropdown
          sourceDocType="purchaseRequest"
          disabled={!currentDocEntry}
          onCopyTo={handleCopyTo}
          buttonClassName="po-btn sap-document-toolbar__copy"
          dropdownClassName="po-dropdown"
          menuClassName="po-dropdown-menu"
        />
        {currentDocEntry && (
          <button type="button" className="po-btn sap-document-toolbar__duplicate" onClick={handleDuplicate}>
            Duplicate
          </button>
        )}
      </div>

      {/* alerts */}
      {pageState.loading && <div className="po-alert po-alert--success" style={{ marginTop: 0 }}>Loading…</div>}
      {pageState.error && <div className="po-alert po-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="po-alert po-alert--success">{pageState.success}</div>}


      <fieldset ref={documentBodyRef} aria-disabled={!isDocumentEditable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className={`po-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`}>
          <div className="po-layout__main">

            {/* ══ HEADER CARD ══════════════════════════════════════════════ */}
            <div className="po-header-card pr-header-card">
              <div className="pr-header-grid">
                <div className="pr-header-column">
                  <div className="po-field">
                    <label className="po-field__label">Requester *</label>
                    <div className="pr-requester-control">
                      <select name="requesterType" className="po-field__select" value={header.requesterType} onChange={handleHeaderChange}>
                        <option value="User">User</option>
                        <option value="Employee">Employee</option>
                      </select>
                      <select name="requesterCode" className="po-field__select" value={header.requesterCode} onChange={handleHeaderChange} style={{ border: valErrors.header.requesterCode ? '1px solid #c00' : undefined }}>
                        <option value="">Select requester</option>
                        {(header.requesterType === 'Employee' ? refData.requester_employees : refData.requester_users).map((requester) => (
                          <option key={requester.code} value={requester.code}>
                            {requester.code}{requester.name ? ` - ${requester.name}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Requester Name</label>
                    <input name="requesterName" className="po-field__input" value={header.requesterName} onChange={handleHeaderChange} />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Branch</label>
                    <select name="requesterBranch" className="po-field__select" value={header.requesterBranch} onChange={handleHeaderChange}>
                      <option value=""></option>
                      {(refData.requester_branches || []).map((branch) => <option key={branch.code} value={branch.code}>{branch.name}</option>)}
                      {header.requesterBranch && !(refData.requester_branches || []).some((branch) => String(branch.code) === String(header.requesterBranch)) && <option value={header.requesterBranch}>{header.requesterBranch}</option>}
                    </select>
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Department</label>
                    <select name="requesterDepartment" className="po-field__select" value={header.requesterDepartment} onChange={handleHeaderChange}>
                      <option value=""></option>
                      {refData.departments.map((department) => <option key={department.code} value={department.code}>{department.name}</option>)}
                      {header.requesterDepartment && !refData.departments.some((department) => String(department.code) === String(header.requesterDepartment)) && <option value={header.requesterDepartment}>{header.requesterDepartment}</option>}
                    </select>
                  </div>
                  <label className="pr-email-option">
                    <input type="checkbox" name="sendEmail" checked={header.sendEmail} onChange={handleHeaderChange} />
                    Send E-Mail if PO or GRPO is Added
                  </label>
                  <div className="po-field">
                    <label className="po-field__label">E-Mail Address</label>
                    <input type="email" name="requesterEmail" className="po-field__input" value={header.requesterEmail} onChange={handleHeaderChange} style={{ border: valErrors.header.requesterEmail ? '1px solid #c00' : undefined }} />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Place of Supply</label>
                    <div className="pr-lookup-control">
                      <input name="placeOfSupply" className="po-field__input" value={getStateDisplayName(header.placeOfSupply, refData.states)} onChange={handleHeaderChange} />
                      <button type="button" className="po-btn" onClick={openStateModal}>...</button>
                    </div>
                  </div>
                </div>

                <div className="pr-header-column">
                  <div className="po-field">
                    <label className="po-field__label">No.</label>
                    <div className="pr-number-control">
                      <select name="series" className="po-field__select" value={header.series} onChange={handleHeaderChange} disabled={!!currentDocEntry || pageState.seriesLoading}>
                        <option value=""></option>
                        {(canUseManualSeries(refData) || (currentDocEntry && isManualDocumentSeries(header.series))) && <option value="-1">Manual</option>}
                        {getSapVisibleDocumentSeries(refData.series, { selectedSeries: header.series, includeHistorical: Boolean(currentDocEntry), postingDate: header.postingDate }).map((series) => (
                          <option key={series.Series} value={series.Series}>{series.SeriesName}</option>
                        ))}
                      </select>
                      <input className="po-field__input" value={header.docNo || header.nextNumber || ''} readOnly />
                    </div>
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Status</label>
                    <input className="po-field__input" value={header.status} readOnly />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Posting Date</label>
                    <SapDateInput  name="postingDate" className="po-field__input" value={header.postingDate} onChange={handleHeaderChange} />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Valid Until *</label>
                    <SapDateInput  name="validUntil" className="po-field__input" value={header.validUntil} onChange={handleHeaderChange} style={{ border: valErrors.header.validUntil ? '1px solid #c00' : undefined }} />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Document Date</label>
                    <SapDateInput  name="documentDate" className="po-field__input" value={header.documentDate} onChange={handleHeaderChange} />
                  </div>
                  <div className="po-field">
                    <label className="po-field__label">Required Date *</label>
                    <SapDateInput  name="requiredDate" className="po-field__input" value={header.requiredDate} onChange={handleHeaderChange} style={{ border: valErrors.header.requiredDate ? '1px solid #c00' : undefined }} />
                  </div>
                  <div className="pr-reference-row">
                    <span>Referenced Document</span>
                    <button type="button" className="po-btn" onClick={() => setReferenceDocumentsModal(true)}>{referenceDocuments.length || '...'}</button>
                  </div>
                </div>
              </div>
            </div>

            {false && (<>
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

            {/* ══ TABS ══════════════════════════════════════════════════════ */}
            </>)}

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

            {/* ══ TAB CONTENT ═══════════════════════════════════════════════ */}
            {activeTab === 'Contents' && (
              <>
                <ContentsTab
                  lines={lines}
                  onLineChange={handleLineChange}
                  onNumBlur={handleNumBlur}
                  onAddLine={addLine}
                  onRemoveLine={removeLine}
                  onOpenHSNModal={openHSNModal}
                  onOpenItemModal={openItemModal}
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
                  documentType={header.documentType}
                  onDocumentTypeChange={(value) => handleHeaderChange({ target: { name: 'documentType', value } })}
                  documentTypeLocked={Boolean(currentDocEntry)}
                  onOpenVendorModal={openVendorModal}
                  serviceAccounts={refData.service_accounts}
                />
              </>
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

            {false && (<>
            {/* ══ TOTALS FOOTER ═════════════════════════════════════════════ */}
            <div className="po-header-card">
              <div className="po-field-grid">
                <div>
                  <div className="po-field">
                    <label className="po-field__label">Purchaser</label>
                    <select name="purchaser" className="po-field__select" value={header.purchaser || ''} onChange={handleHeaderChange}>
                      <option value="">No Purchaser</option>
                      <option value="Buyer 1">Buyer 1</option>
                      <option value="Buyer 2">Buyer 2</option>
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

            {/* ══ ACTION BUTTONS ════════════════════════════════════════════ */}
            </>)}

            <div className="pr-document-footer">
              <div className="pr-footer-notes">
                <div className="po-field">
                  <label className="po-field__label">Owner</label>
                  <input name="owner" className="po-field__input" value={header.owner || ''} onChange={handleHeaderChange} />
                </div>
                <div className="po-field">
                  <label className="po-field__label">Remarks</label>
                  <textarea className="po-textarea" rows={2} name="otherInstruction" value={header.otherInstruction} onChange={handleHeaderChange} />
                </div>
              </div>
              <div className="pr-totals-panel">
                <div className="pr-total-row">
                  <label>Total Before Discount</label>
                  <input value={fmtDec(totals.subtotal, numDec.total)} readOnly />
                </div>
                <div className="pr-total-row">
                  <label>Freight</label>
                  <div className="pr-total-lookup">
                    <input
                      name="freight"
                      value={header.freight}
                      onChange={handleHeaderChange}
                      onBlur={() => handleNumBlur('freight', 'header')}
                    />
                    <button type="button" onClick={openFreightModal} title="Select Freight Charge">...</button>
                  </div>
                </div>
                <div className="pr-total-row">
                  <label>Tax</label>
                  <input value={fmtDec(totals.taxAmt, numDec.tax)} readOnly />
                </div>
                <div className="pr-total-row pr-total-row--due">
                  <label>Total Payment Due</label>
                  <input value={fmtDec(totals.total, numDec.totalPaymentDue)} readOnly />
                </div>
              </div>
            </div>

            {false && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', marginBottom: '12px', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="submit" className="po-btn po-btn--primary" disabled={pageState.posting}>
                  {pageState.posting ? 'Saving…' : currentDocEntry ? 'Update' : 'Add & New'}
                </button>
                <button type="button" className="po-btn" onClick={resetForm}>
                  Cancel
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="po-btn">
                  Copy From
                </button>
                <button 
                  type="button" 
                  className="po-btn"
                  disabled={!currentDocEntry}
                >
                  Copy To
                </button>
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
            disabled={!hasRequester}
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

      {/* HSN Code Modal */}
      <HSNCodeModal
        isOpen={hsnModal.open}
        onClose={closeHSNModal}
        onSelect={handleHSNSelect}
        hsnCodes={refData.hsn_codes || []}
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
        isOpen={bpModal.open}
        onClose={closeBpModal}
        onSelect={handleBpSelect}
        businessPartners={refData.vendors || []}
        title="List of Vendors"
      />

      <ItemSelectionModal
        isOpen={itemModal.open}
        onClose={closeItemModal}
        onSelect={handleItemSelect}
        items={itemModal.items}
        loading={itemModal.loading}
      />

      <FreightChargesModal
        isOpen={freightModal.open}
        onClose={closeFreightModal}
        onApply={handleFreightApply}
        freightCharges={freightModal.freightCharges}
        taxCodes={effectiveTaxCodes}
        loading={freightModal.loading}
      />

      <ReferenceDocumentsModal
        isOpen={referenceDocumentsModal}
        referenceDocuments={referenceDocuments}
        onClose={() => setReferenceDocumentsModal(false)}
        onSave={(rows) => {
          setReferenceDocuments(rows);
          setReferenceDocumentsModal(false);
        }}
        isEditable={isDocumentEditable}
      />
    </form>
  );
}

export default PurchaseRequest;
