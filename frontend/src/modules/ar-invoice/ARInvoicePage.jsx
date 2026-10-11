import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import './styles/arInvoice.css';
import { useLocation, useNavigate } from 'react-router-dom';
import FormSettingsPanel from '../../components/purchase-order/FormSettingsPanel';
import HeaderUdfSidebar from '../../components/purchase-order/HeaderUdfSidebar';
import LineValueLookupModal from '../../components/sales-document/LineValueLookupModal';
import ExchangeRatesIndexesModal from '../sales-order/components/ExchangeRatesIndexesModal';
import ContentsTab from './components/ContentsTab';
import LogisticsTab from './components/LogisticsTab';
import AccountingTab from './components/AccountingTab';
import TaxTab from './components/TaxTab';
import ElectronicDocumentsTab from './components/ElectronicDocumentsTab';
import AttachmentsTab from './components/AttachmentsTab';
import BatchAllocationModal from './components/BatchAllocationModal';
import AddressModal from '../../components/document/AddressComponentModal';
import { formatAddressComponent, mapAddressFields, pickAddressComponentFields } from '../../utils/documentAddress';
import TaxInfoModal from './components/TaxInfoModal';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import WithholdingTaxTableModal from '../APInvoice/components/WithholdingTaxTableModal';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import PrintLayoutToolbar from '../../components/print-layout/PrintLayoutToolbar';
import JournalEntryPreviewButton from '../../components/journal-entry/JournalEntryPreviewButton';
import SalesEmployeeSetupModal from '../../components/sales-employee/SalesEmployeeSetupModal';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import CopyFromModal from '../../components/document/CopyFromModal';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import useDocumentDraftTask from '../../hooks/useDocumentDraftTask';
import { copyToDocument } from '../../services/documentCopyService';
import { duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import { determineTaxCode, recalculateAllTaxCodes, getGSTTypeLabel } from '../../utils/taxEngine';
import { filterWarehousesByBranch, getWarehouseBranchId } from '../../utils/warehouseBranch';
import { hydrateDocumentLineFromItem, mergeItemMaster } from '../../utils/documentItemHydration';
import { getSelectableBusinessPartners, isSelectableBpCode, markResolvedBpLookup } from '../../utils/documentBpSelection';
import { applyUomCodeSelection, getItemDefaultUom, getLineUomOptions } from '../../utils/documentUom';
import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount } from '../../utils/documentRounding';
import DocumentRoundingInput from '../../components/sales-document/DocumentRoundingInput';
import { getSapVisibleDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import { useStandardSalesFormSettings } from '../../utils/standardSalesFormSettings';
import { buildCompanyFormQueryContext } from '../../utils/companyFormQueryContext';
import { updateFormSettingPreference } from '../../utils/formSettingsPreferences';
import {
  convertDocumentAmountForDisplay,
  resolveDisplayCurrency,
  resolveDocumentCurrency,
} from '../../utils/documentCurrency';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import {
  batchQtyMatchesLine,
  getLineUomFactor,
  sumBatchQty,
} from '../../utils/batchQuantity';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { findTaxCode, getTaxComponentCodes } from '../../utils/taxCodeComponents';
import { getDocumentLinePayableTax } from '../../utils/documentLineTax';
import { consumeCopyToState, replaceRouteStatePreservingWindow } from '../../utils/copyToState';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useSalesEmployeeSetup from '../../hooks/useSalesEmployeeSetup';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import { useAuth } from '../../auth/AuthContext';
import { isRouteStateForActiveCompany } from '../../utils/companyStorageScope';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import {
  AR_INVOICE_LAYOUT_DOCUMENT_TYPE,
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
  fetchARInvoiceReferenceData,
  fetchARInvoiceCustomerDetails,
  fetchARInvoiceByDocEntry,
  submitARInvoice,
  updateARInvoice,
  fetchDocumentSeries,
  fetchBatchesByItem,
  fetchFreightCharges,
  fetchItemsForModal,
  fetchOpenSalesQuotationsForARInvoice,
  fetchSalesQuotationForARInvoiceCopy,
  fetchOpenSalesOrdersForARInvoice,
  fetchSalesOrderForARInvoiceCopy,
  fetchOpenDeliveriesForARInvoice,
  fetchDeliveryForARInvoiceCopy,
  fetchOpenBlanketAgreementsForARInvoice,
  fetchBlanketAgreementForARInvoiceCopy,
} from '../../api/arInvoiceApi';
import { fetchSalesOrderExchangeRates, saveSalesOrderExchangeRate } from '../../api/salesOrderApi';
import { fetchHSNCodeFromItem } from '../../api/hsnCodeApi';
import { arInvoiceCopyFromApi, normaliseDocumentHeader, normaliseDocumentLine, unwrapCopyFromDocument, BASE_TYPE } from '../../api/copyFromApi';
import {
  FORM_SETTINGS_STORAGE_KEY,
  createUdfState,
  normalizeUdfState as normalizeConfiguredUdfState,
  readSavedFormSettings,
} from '../../config/arInvoiceForm';

const SAP_MANUAL_SERIES_VALUE = '__SAP_MANUAL__';

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
const normalizeBaseLine = (line, fallbackIndex) =>
  line.baseLine ?? line.BaseLine ?? line.lineNum ?? line.LineNum ?? fallbackIndex;
const normalizeWarehouse = (line = {}, header = {}) =>
  line.whse || line.WarehouseCode || line.WhsCode || line.warehouse || header.warehouse || header.WarehouseCode || '';
const normalizeBranchSelection = (value) => {
  const normalized = String(value ?? '').trim();
  const lowered = normalized.toLowerCase();
  return normalized && lowered !== '0' && lowered !== '-1' && lowered !== 'select branch' && lowered !== 'no branch'
    ? normalized
    : '';
};
const hasUdfValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const isCheckedValue = (value) =>
  ['Y', 'YES', 'TRUE', '1', 'TYES', true].includes(
    typeof value === 'string' ? value.trim().toUpperCase() : value
  );
const isTruthySapFlag = (value) => {
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toUpperCase();
  return ['Y', 'YES', 'TRUE', 'TYES', '1'].includes(text);
};
const isBatchManaged = (item) => {
  if (!item) return false;
  return [
    item.BatchManaged,
    item.batchManaged,
    item.ManBtchNum,
    item.ManageBatchNumbers,
    item.manageBatchNumbers,
    item.isBatchManaged,
  ].some(isTruthySapFlag);
};
const isLineBatchManaged = (line = {}, item = null) => (
  [
    line.BatchManaged,
    line.batchManaged,
    line.ManBtchNum,
    line.ManageBatchNumbers,
    line.manageBatchNumbers,
    line.isBatchManaged,
  ].some(isTruthySapFlag) || isBatchManaged(item)
);
const getLineBaseTypeNumber = (line = {}) => {
  const parsed = Number(line.baseType ?? line.BaseType);
  return Number.isFinite(parsed) ? parsed : 0;
};
const isDeliveryBasedLine = (line = {}) => getLineBaseTypeNumber(line) === 15;
const normalizeLineBatches = (batches = []) => (
  Array.isArray(batches)
    ? batches
        .filter((batch) => String(batch?.batchNumber || batch?.BatchNumber || batch?.BatchNum || '').trim())
        .map((batch) => ({
          batchNumber: String(batch.batchNumber || batch.BatchNumber || batch.BatchNum || '').trim(),
          quantity: String(batch.quantity ?? batch.Quantity ?? ''),
          expiryDate: batch.expiryDate || batch.ExpiryDate || batch.ExpDate || '',
        }))
    : []
);
const checkBatchAvailability = async (itemCode, whsCode) => {
  if (!itemCode || !whsCode) return false;
  try {
    const response = await fetchBatchesByItem(itemCode, whsCode);
    return (response.data?.batches || []).length > 0;
  } catch (_error) {
    return true;
  }
};
const isYesValue = (value) => ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase());
const normalizeFieldIdentity = (value) =>
  String(value || '')
    .replace(/^U_/i, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
const fieldNameMatches = (field = {}, names = new Set()) =>
  names.has(normalizeFieldIdentity(field.key)) ||
  names.has(normalizeFieldIdentity(field.label)) ||
  names.has(normalizeFieldIdentity(field.aliasId)) ||
  names.has(normalizeFieldIdentity(field.sapField));
const getTransactionTypeFromUdfs = (definitions = [], values = {}) => {
  const field = definitions.find((definition) => fieldNameMatches(definition, TRANSACTION_TYPE_FIELD_NAMES));
  return field ? String(values?.[field.key] || '').trim() : '';
};
const mergeUdfValues = (...sources) =>
  sources.reduce((acc, source) => {
    Object.entries(source || {}).forEach(([key, value]) => {
      if (hasUdfValue(value) || acc[key] === undefined) {
        acc[key] = value ?? '';
      }
    });
    return acc;
  }, {});

// â”€â”€â”€ constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEC = { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 };
const GENERAL_SETTINGS = readGeneralSettings();
const TAB_NAMES = ['Contents', 'Logistics', 'Accounting', 'Tax', 'Electronic Documents', 'Attachments'];
const DEFAULT_WAREHOUSE_CODE = '';
const TRANSACTION_TYPE_FIELD_NAMES = new Set(['transactiontype', 'transtype', 'documenttype', 'doctype']);
const DEFAULT_TRANSACTION_TYPES = [
  { value: 'GST Tax Invoice', label: 'GST Tax Invoice' },
  { value: 'Bill of Supply', label: 'Bill of Supply' },
  { value: 'GST Debit Memo', label: 'GST Debit Memo' },
];
const AR_LINE_UDF_FIELD_MAP = {
  sacCode: ['U_SAC', 'U_SACCode', 'U_SAC_CODE'],
  U_Cost_Sheet: ['U_Cost_Sheet', 'U_COSTSHEET', 'U_CostSheet'],
  U_PackingType: ['U_PackingType', 'U_PACKINGTYPE', 'U_Packing_Type'],
  U_ContainerType: ['U_ContainerType', 'U_CONTAINERTYPE', 'U_Container_Type'],
  U_GrossWt: ['U_GrossWt', 'U_GROSSWT', 'U_Gross_Wt', 'U_GrossWeight'],
  U_TotalPackage: ['U_TotalPackage', 'U_TOTALPACKAGE', 'U_Total_Package'],
  taxCodeRepeat: ['U_TAXCODE', 'U_TaxCode'],
  price: ['U_PRICE', 'U_Price'],
  sellerBrokerage: ['U_Brok_Seller', 'U_Seller_Brokerage'],
  buyerBrokerage: ['U_Brok_Buyer', 'U_Buyer_Brokerage'],
  buyerDelivery: ['U_Buyer_Delivery'],
  sellerDelivery: ['U_Seller_Delivery'],
  buyerPaymentTerms: ['U_Buyer_Payment_Terms', 'U_BUYER_PAYMENT_TERM'],
  sellerPaymentTerms: ['U_Seller_Payment_Term', 'U_SELLER_PAYMENT_TERM'],
  buyerQuality: ['U_Buyer_Quality'],
  sellerQuality: ['U_Seller_Quality'],
  buyerPrice: ['U_Buyer_Price'],
  sellerPrice: ['U_Seller_Price'],
  buyerSpecialInstruction: ['U_Buyer_SPINS', 'U_Buyer_Special_Instruction'],
  sellerSpecialInstruction: ['U_Seller_SPINS', 'U_Seller_Special_Instruction'],
  sellerBrokerageAmtPer: ['U_Sel_Brok_AP'],
  sellerBrokeragePercent: ['U_Seller_Brok_Per'],
  stcode: ['U_SELLTCODE', 'U_STCODE'],
  sellerItem: ['U_S_Item', 'U_SITEM'],
  sellerQty: ['U_S_Qty', 'U_SQTY'],
  specialRebate: ['U_SPLRBT', 'U_Special_Rebate'],
  commission: ['U_COMPRC', 'U_Commission'],
  sellerBrokeragePerQty: ['U_S_BrokPerQty', 'U_BrokPerQty'],
  U_Fix_Brock_B: ['U_Fix_Brock_B'],
  U_Fix_Brock_S: ['U_Fix_Brock_S'],
};
const DOCUMENT_TYPE_CODE_BY_TRANSACTION_TYPE = {
  gsttaxinvoice: 'INV',
  taxinvoice: 'INV',
  billofsupply: 'BIL',
  gstdebitmemo: 'DBN',
  debitmemo: 'DBN',
};
const getDocumentTypeCodeForTransaction = (value) =>
  DOCUMENT_TYPE_CODE_BY_TRANSACTION_TYPE[normalizeFieldIdentity(value)] || value;

const normalizeUdfLookupKey = (value) =>
  String(value || '').trim().toUpperCase().replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');

const buildARInvoiceLineUdfPayload = (line = {}, rowUdfDefinitions = [], formSettings = {}) => {
  const udf = buildVisibleEnteredRowUdfPayload(
    rowUdfDefinitions,
    line.udf || {},
    formSettings,
    { preserveUnmappedUdfs: false },
  );
  const knownUdfKeyByToken = new Map();
  (rowUdfDefinitions || []).forEach((field) => {
    [field?.key, field?.sapField, field?.aliasId, field?.label, field?.description, field?.Descr].forEach((candidate) => {
      const token = normalizeUdfLookupKey(candidate);
      if (field?.key && token && !knownUdfKeyByToken.has(token)) knownUdfKeyByToken.set(token, field.key);
    });
  });

  Object.entries(AR_LINE_UDF_FIELD_MAP).forEach(([lineKey, udfKeys]) => {
    const value = line[lineKey];
    if (value === undefined || value === null || String(value).trim() === '') return;
    const keys = Array.isArray(udfKeys) ? udfKeys : [udfKeys];
    const actualUdfKey = keys.map((key) => knownUdfKeyByToken.get(normalizeUdfLookupKey(key))).find(Boolean);
    if (actualUdfKey) udf[actualUdfKey] = value;
  });

  return udf;
};

const getARInvoiceDocumentLines = (invoice = {}) => {
  const candidates = [
    invoice.lines,
    invoice.Lines,
    invoice.documentLines,
    invoice.DocumentLines,
    invoice.rows,
    invoice.DocumentRows,
  ];

  return candidates.find((value) => Array.isArray(value) && value.length) || [];
};

const createLine = (rowUdfDefinitions = []) => ({
  itemNo: '', itemDescription: '', hsnCode: '', quantity: '', unitPrice: '',
  openQty: '', uomCode: '', stdDiscount: '', priceAfterDiscount: '', noOfPackages: '', itemsPerUnit: '', taxCode: '', taxCodeRepeat: '', total: '', totalLC: '', grossTotal: '', whse: DEFAULT_WAREHOUSE_CODE,
  lineDeliveryDate: '',
  loc: '', branch: '', wTaxLiable: 'N', glAccount: '', glAccountName: '', distRule: '', taxLiable: 'Y',
  weight: '', taxAmount: '', uomName: '', cogsDistRule: '', countryOfOrigin: '',
  binLocationAllocation: '', commPercent: '', price: '', itemCost: '',
  withoutQtyPosting: 'N', enableSettingCost: 'N', returnCost: '',
  qtyInventoryUom: '', inventoryUOM: '', changeQtyInvUomIndependently: 'N',
  uomGroup: '', blanketAgreementNo: '', saudaNodeRef: '', apInvDocKey: '',
  apInvDocNum: '', apInvLineNum: '', assessableValue: '', bedRate: '',
  bedAmount: '', rg23dNo: '', specialRebate: '', commission: '',
  sellerBrokeragePerQty: '', sellerItem: '', sellerUnitPrice: '', sellerQty: '',
  sellerBrokerage: '', buyerBrokerage: '', buyerDelivery: '', sellerDelivery: '',
  buyerQuality: '', sellerQuality: '', buyerPrice: '', sellerPrice: '',
  buyerSpecialInstruction: '', sellerSpecialInstruction: '',
  sellerBrokerageAmtPer: '', sellerBrokeragePercent: '',
  buyerBillDiscount: '', sellerBillDiscount: '', sacCode: '', stcode: '',
  buyerPaymentTerms: '', sellerPaymentTerms: '', freightPurchase: '',
  freightSales: '', freightProvider: '', freightProviderName: '',
  documentCreated: '', brokerageNumber: '',
  batchManaged: false, batches: [], hasBatchesAvailable: false, uomFactor: 1,
  udf: createUdfState(rowUdfDefinitions),
});

const buildExchangeRatesFallbackData = ({
  year,
  month,
  currencies = [],
  localCurrency = '',
  documentCurrency = '',
}) => {
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
    entry.CurrCode || entry.Code || entry.code || entry.value || entry,
    entry.CurrName || entry.Name || entry.name || entry.label || entry,
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

const INIT_HEADER = {
  vendor: '', name: '', contactPerson: '', salesContractNo: '', branch: '', warehouse: GENERAL_SETTINGS.arInvoiceWarehouse || DEFAULT_WAREHOUSE_CODE,
  docNo: '', status: 'Open', series: GENERAL_SETTINGS.arInvoiceSeries || '', nextNumber: '',
  postingDate: today(), deliveryDate: '', documentDate: today(), contractDate: '',
  branchRegNo: '', shipTo: '', shipToCode: '', payTo: '', payToCode: '',
  transactionType: '', indicator: '',
  shippingType: '', confirmed: undefined, journalRemark: '', paymentTerms: '',
  paymentMethod: '', otherInstruction: '', discount: '', freight: '', tax: '',
  totalPaymentDue: '', rounding: false, roundingAmount: '', owner: '', purchaser: '', salesEmployee: '',
  placeOfSupply: '', currencyMode: 'BP', currency: '', exchangeRate: '', useBillToForTax: false,
  billToAddress: '', billToCode: '', shipToAddress: '',
  shipToAddressComponents: null, billToAddressComponents: null,
  ownerCode: '', language: '', trackingNo: '', stampNo: '', pickPackRemarks: '',
  bpChannelName: '', bpChannelContact: '',
};

const INIT_ATTACH = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, targetPath: '', fileName: '', attachmentDate: '',
  freeText: '', copyToTargetDocument: '', documentType: '', atchDocDate: '', alert: '',
}));

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ARInvoicePage() {
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
  const formRef = useRef(null);
  const handledCopyFromRef = useRef('');
  const requestedEditDocEntry = isRouteStateForActiveCompany(location.state)
    ? location.state?.arInvoiceDocEntry
    : null;

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
    warehouses: [], warehouse_addresses: [], company_address: {}, tax_codes: [],
    withholding_tax_codes: [],
    default_branch: '', default_warehouse: '',
    gl_accounts: [], distribution_rules: [], payment_terms: [], shipping_types: [], branches: [], uom_groups: [],
    local_currency: '', system_currency: '', company_currency: '', currencies: [],
    decimal_settings: DEC, warnings: [], series: [], states: [], transaction_types: [],
    matrix_columns: [],
    blanket_agreements: [],
    line_field_metadata: { matrix_columns: getSapStandardSalesMatrixColumns(), sap_form: {} },
  });
  const [, setSeriesReloadToken] = useState(0);
  const [pageState, setPageState] = useState({ loading: false, vendorLoading: false, posting: false, error: '', success: '', seriesLoading: false });
  const [valErrors, setValErrors] = useState({ header: {}, lines: {}, form: '' });
  useValidationHighlights(valErrors);
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [addressModal, setAddressModal] = useState(null);
  const [taxInfoModal, setTaxInfoModal] = useState(false);
  const [bpModal, setBpModal] = useState(false);
  const [stateModal, setStateModal] = useState(false);
  const [hsnModal, setHsnModal] = useState({ open: false, lineIndex: -1 });
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1, items: [], loading: false });
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
  const [batchModal, setBatchModal] = useState({ open: false, lineIndex: null, availableBatches: [], loading: false, error: '' });
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
  const [exchangeRatesModal, setExchangeRatesModal] = useState({
    open: false, currency: '', postingDate: '', initialRate: '', loading: false, error: '', data: null,
  });
  const [withholdingTax, setWithholdingTax] = useState({
    open: false,
    customerSubject: false,
    defaultCode: '',
    allowedCodes: [],
    rows: [],
  });
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
  const hydrateARInvoiceBatchLine = useCallback((line = {}) => {
    const itemCode = String(line.itemNo || line.ItemCode || '').trim();
    const item = refData.items.find((candidate) => String(candidate.ItemCode || '').trim() === itemCode);
    const deliveryBased = isDeliveryBasedLine(line);
    const batchManaged = deliveryBased ? false : isLineBatchManaged(line, item);
    const batches = deliveryBased ? [] : normalizeLineBatches(line.batches || line.BatchNumbers || line.BatchNumberDetails);
    const inventoryUOM = String(line.inventoryUOM || line.InventoryUOM || item?.InventoryUOM || line.uomCode || '').trim();
    const explicitFactor = Number(line.uomFactor);

    return {
      ...line,
      batchManaged,
      batches,
      hasBatchesAvailable: batchManaged
        ? line.hasBatchesAvailable !== false || batches.length > 0
        : false,
      inventoryUOM,
      uomFactor: Number.isFinite(explicitFactor) && explicitFactor > 0 ? explicitFactor : 1,
    };
  }, [refData.items]);

  const refreshBatchAvailabilityForLines = useCallback((nextLines = []) => {
    nextLines.forEach((line, lineIndex) => {
      if (isDeliveryBasedLine(line) || !line?.batchManaged || !line?.itemNo || !line?.whse) return;
      checkBatchAvailability(line.itemNo, line.whse).then((hasBatches) => {
        setLines((prevLines) => prevLines.map((currentLine, currentIndex) => (
          currentIndex === lineIndex &&
          currentLine.itemNo === line.itemNo &&
          currentLine.whse === line.whse
            ? { ...currentLine, hasBatchesAvailable: hasBatches }
            : currentLine
        )));
      });
    });
  }, []);

  // Copy To navigation can hydrate its draft before company reference data
  // finishes loading. Re-resolve batch management once the active company's
  // item master arrives so validation opens the allocator before submission.
  useEffect(() => {
    if (!refData.items.length) return;
    setLines((previous) => {
      let changed = false;
      const next = previous.map((line) => {
        const hydrated = hydrateARInvoiceBatchLine(line);
        if (
          hydrated.batchManaged !== line.batchManaged
          || hydrated.inventoryUOM !== line.inventoryUOM
          || hydrated.uomFactor !== line.uomFactor
        ) changed = true;
        return hydrated;
      });
      return changed ? next : previous;
    });
  }, [hydrateARInvoiceBatchLine, refData.items.length]);
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
    const draft = location.state?.arInvoiceDraft;
    if (!draft) return;

    setCurrentDocEntry(draft.currentDocEntry || null);
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
    arInvoiceDraft: {
      currentDocEntry,
      header,
      lines,
      headerUdfs,
      activeTab,
      isDirty,
      freightCharges: freightModal.freightCharges,
      withholdingTax: {
        customerSubject: withholdingTax.customerSubject,
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
    withholdingTax.customerSubject,
    withholdingTax.defaultCode,
    withholdingTax.rows,
  ]);

  useDocumentDraftTask({
    buildDraftState: buildLinkedRestoreState,
    title: 'A/R Invoice',
  });

  useEffect(() => {
    if (!snapshotPending || !currentDocEntry || pageState.loading || pageState.vendorLoading) return;
    setSnapshotPending(false);
  }, [snapshotPending, currentDocEntry, pageState.loading, pageState.vendorLoading, header, lines, headerUdfs]);

  const markDirty = useCallback((event) => {
    if (event?.target?.closest?.('[data-document-dirty-ignore="true"]')) return;
    if (currentDocEntry) setIsDirty(true);
  }, [currentDocEntry]);

  const loadDynamicLineLookupOptions = useCallback((source, field = {}, line = {}) => (
    loadSalesDocumentFieldLookupOptions({
      fetchLookup: fetchSalesDocumentLookup,
      source,
      field,
      line,
      documentType: 'AR_INVOICE',
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
          setHeaderUdfDefinitions([]);
          setRowUdfDefinitions([]);
          setMatrixColumnDefinitions(getSapStandardSalesMatrixColumns());
          setHeaderUdfs({});
          setLines([createLine([])]);
          setRefData(prev => ({
            ...prev,
            company: '',
            vendors: [], contacts: [], pay_to_addresses: [], items: [], warehouses: [],
            warehouse_addresses: [], company_address: {}, tax_codes: [], withholding_tax_codes: [],
            gl_accounts: [], distribution_rules: [], payment_terms: [], shipping_types: [],
            transaction_types: [], sales_employees: [], branches: [], states: [], uom_groups: [],
            local_currency: '', system_currency: '', company_currency: '', currencies: [],
            matrix_columns: [],
            blanket_agreements: [],
            line_field_metadata: { matrix_columns: getSapStandardSalesMatrixColumns(), sap_form: {} },
            udf_metadata: { header: [], rows: [] },
          }));
          return;
        }

        setHeaderUdfDefinitions([]);
        setRowUdfDefinitions([]);
        setMatrixColumnDefinitions([]);

        const refDataRes = await fetchARInvoiceReferenceData(activeCompanyId);
        if (ignore) return;

        const [layoutRes, blanketAgreementsRes, liveSchema] = await Promise.all([
          getDocumentLayout({
            companyDb: activeCompanyDb || undefined,
            documentType: AR_INVOICE_LAYOUT_DOCUMENT_TYPE,
            objectType: '13',
            refresh: true,
          }).catch((error) => ({
            data: {
              success: false,
              columns: [],
              warning: getErrMsg(error, 'Failed to load SAP layout.'),
            },
          })),
          fetchOpenBlanketAgreementsForARInvoice().catch(() => ({ data: { documents: [] } })),
          fetchSalesDocumentSchema({ documentType: 'AR_INVOICE' }).catch((error) => {
            console.warn('[A/R Invoice] Live OINV/INV1 schema was not available.', error);
            return null;
          }),
        ]);
        
        if (!ignore) {
          const vendorRows = refDataRes.data.vendors || refDataRes.data.customers || [];
          const sourceMatrixColumns = (
            refDataRes.data.line_field_metadata?.matrix_columns?.length
              ? refDataRes.data.line_field_metadata.matrix_columns
              : (refDataRes.data.matrix_columns || [])
          ).filter((field) => field && field.key);
          const liveFields = buildSalesDocumentLiveFields({
            schema: liveSchema,
            documentType: 'AR_INVOICE',
            objectType: '13',
            headerTable: 'OINV',
            lineTable: 'INV1',
            companyId: activeCompanyId,
            companyDb: activeCompanyDb,
            layoutResponse: layoutRes,
            referenceMatrixColumns: sourceMatrixColumns,
            referenceSapForm: refDataRes.data.line_field_metadata?.sap_form,
          });
          const nextHeaderUdfs = liveFields.headerUdfFields;
          const nextRowUdfs = liveFields.rowUdfFields;
          const nextLayoutMatrixColumns = liveFields.matrixColumns;
          const liveDefaultBranch = String(refDataRes.data.default_branch || '').trim();
          const liveDefaultWarehouse = String(refDataRes.data.default_warehouse || '').trim();
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
            company: refDataRes.data.company || '',
            vendors: vendorRows,
            bp_selection_policy: refDataRes.data.bp_selection_policy || null,
            contacts: refDataRes.data.contacts || [],
            pay_to_addresses: refDataRes.data.pay_to_addresses || [],
            items: refDataRes.data.items || [],
            warehouses: refDataRes.data.warehouses || [],
            warehouse_addresses: refDataRes.data.warehouse_addresses || [],
            company_address: refDataRes.data.company_address || {},
            tax_codes: refDataRes.data.tax_codes || [],
            withholding_tax_codes: refDataRes.data.withholding_tax_codes || [],
            gl_accounts: refDataRes.data.gl_accounts || [],
            distribution_rules: refDataRes.data.distribution_rules || [],
            payment_terms: refDataRes.data.payment_terms || [],
            shipping_types: refDataRes.data.shipping_types || [],
            transaction_types: refDataRes.data.transaction_types || [],
            sales_employees: refDataRes.data.sales_employees || [],
            branches: refDataRes.data.branches || [],
            states: refDataRes.data.states || [],
            uom_groups: refDataRes.data.uom_groups || [],
            local_currency: refDataRes.data.local_currency || '',
            system_currency: refDataRes.data.system_currency || refDataRes.data.local_currency || '',
            company_currency: refDataRes.data.company_currency || refDataRes.data.local_currency || '',
            currencies: refDataRes.data.currencies || [],
            decimal_settings: { ...DEC, ...(refDataRes.data.decimal_settings || {}) },
            matrix_columns: nextLayoutMatrixColumns,
            blanket_agreements: blanketAgreementsRes?.data?.documents || blanketAgreementsRes?.data?.agreements || [],
            line_field_metadata: {
              ...(refDataRes.data.line_field_metadata || { sap_form: {} }),
              matrix_columns: nextLayoutMatrixColumns,
              source_matrix_columns: sourceMatrixColumns,
              imported_layout: liveFields.importedLayout,
              live_schema: liveFields.liveSchema,
              live_available: liveFields.liveAvailable,
            },
            udf_metadata: { header: nextHeaderUdfs, rows: nextRowUdfs },
            warnings: [
              ...(refDataRes.data.warnings || []),
              ...(!liveFields.schemaMatchesCompany && liveSchema
                ? ['Ignored an A/R Invoice schema belonging to another company.']
                : []),
              ...(!liveFields.liveAvailable
                ? ['Live A/R Invoice field metadata was unavailable; SAP standard fields are shown.']
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
        const r = await fetchARInvoiceByDocEntry(docEntry);
        const so = r.data.ar_invoice;
        let editSeries = [];
        try {
          const seriesDate = so?.header?.postingDate || so?.header?.documentDate || '';
          const seriesResponse = await fetchDocumentSeries(seriesDate, so?.header?.transactionType || '', so?.header?.branch || '');
          editSeries = seriesResponse.data?.series || [];
        } catch (_seriesError) {
          editSeries = [];
        }
        if (ignore || !so) return;
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
        setHeader(prev => ({
          ...prev,
          ...INIT_HEADER,
          ...(so.header || {}),
          vendor: so.header?.customerCode || so.header?.customer || '',
          contactPerson: so.header?.contactPerson || '',
          name: so.header?.customerName || so.header?.name || '',
          paymentTerms: so.header?.paymentTermsCode || so.header?.paymentTerms || '',
          transactionType: so.header?.transactionType || getTransactionTypeFromUdfs(headerUdfDefinitions, so.header_udfs || '') || '',
          indicator: so.header?.indicator || so.header?.seriesIndicator || '',
          placeOfSupply: so.header?.placeOfSupply || '',
          branch: so.header?.branch || '',
          currencyMode: so.header?.currencyMode || prev.currencyMode || 'BP',
          currency: so.header?.currency || so.header?.DocCur || prev.currency || INIT_HEADER.currency,
          exchangeRate: so.header?.exchangeRate || so.header?.docRate || so.header?.DocRate || '',
          shipToAddressComponents: so.header?.shipToAddressComponents || null,
          billToAddressComponents: so.header?.billToAddressComponents || null,
          docNo: so.header?.docNo || so.header?.docNum || '',
          series: so.header?.series || '',
          nextNumber: so.header?.docNo || so.header?.docNum || '',
        }));
        
        const savedDocumentLines = getARInvoiceDocumentLines(so);
        const nextDocumentLines = savedDocumentLines.length
          ? savedDocumentLines.map((line) => hydrateARInvoiceBatchLine(hydrateWorkbookDocumentLine({
              line,
              createLine,
              rowUdfDefinitions,
              normalizeUdfState,
              items: refData.items,
              fallbackWarehouse: so.header?.warehouse || '',
            })))
          : [createLine(rowUdfDefinitions)];
        setLines(
          savedDocumentLines.length
            ? nextDocumentLines
            : [createLine(rowUdfDefinitions)]
        );
        setWithholdingTax((prev) => ({
          ...prev,
          open: false,
          rows: Array.isArray(so.withholdingTaxRows) ? so.withholdingTaxRows : [],
        }));
        refreshBatchAvailabilityForLines(nextDocumentLines);
        setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, so.header_udfs || {}));
        setSnapshotPending(true);
        setIsDirty(false);
        if (so.header?.customerCode || so.header?.customer) {
          loadVendorDetails(so.header?.customerCode || so.header?.customer, { preserveWithholdingRows: true });
        }
        setPageState(p => ({ ...p, success: so.doc_num ? `AR Invoice ${so.doc_num} loaded.` : 'AR Invoice loaded.' }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load AR Invoice.') }));
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

  // â”€â”€ Copy To: populate form from Sales Order / Delivery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const routedCopyFrom = location.state?.copyFrom;
    const persistedCopyState = routedCopyFrom ? null : consumeCopyToState(location.pathname, ['/ar-invoice']);
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
    const firstSourceLine = Array.isArray(srcLines) && srcLines.length ? srcLines[0] : {};
    const copiedWarehouse = normalizeWarehouse(firstSourceLine, srcHeader) || '';
    const copiedBranch = normalizeBranchSelection(normalizedHeader.branch)
      || normalizeBranchSelection(
        firstSourceLine.branch
        || firstSourceLine.Branch
        || firstSourceLine.BPL_IDAssignedToInvoice
        || firstSourceLine.BPLId
        || srcHeader.branch
        || srcHeader.BPL_IDAssignedToInvoice
        || srcHeader.BPLId
      )
      || getBranchFromWarehouseCode(copiedWarehouse);
    const copiedBaseType = baseDocument?.baseType || BASE_TYPE[copyFrom.type] || firstSourceLine.baseType || 15;
    const copiedBaseEntry = baseDocument?.baseEntry || copyFrom.docEntry;
    // Copying carries base references and commercial data, but a new invoice
    // must start with dates in the active posting period.
    const copyDate = today();

    setHeader(prev => ({
      ...prev,
      // Use the shared SAP normalizer so all common document fields travel
      // with the Delivery, then retain target-specific numbering context.
      ...srcHeader,
      ...normalizedHeader,
      vendor: normalizedHeader.vendor || srcHeader.vendor || srcHeader.CardCode || '',
      name: normalizedHeader.name || srcHeader.name || srcHeader.CardName || '',
      contactPerson: normalizedHeader.contactPerson || srcHeader.contactPerson || srcHeader.CntctCode || '',
      salesContractNo: normalizedHeader.salesContractNo || normalizedHeader.customerRefNo || srcHeader.salesContractNo || srcHeader.customerRefNo || srcHeader.CustomerRefNo || srcHeader.NumAtCard || '',
      branch: copiedBranch || normalizedHeader.branch || prev.branch || '',
      warehouse: copiedWarehouse || normalizedHeader.warehouse || prev.warehouse || '',
      otherInstruction: normalizedHeader.otherInstruction || srcHeader.otherInstruction || srcHeader.remarks || srcHeader.Comments || '',
      currencyMode: srcHeader.currencyMode || srcHeader.CurrencyMode || prev.currencyMode || 'BP',
      currency: normalizedHeader.currency || srcHeader.currency || srcHeader.DocCur || prev.currency || refData.local_currency || refData.company_currency || INIT_HEADER.currency,
      postingDate: copyDate,
      documentDate: copyDate,
      deliveryDate: copyDate,
      exchangeRate: '',
      // Series and document number must always be selected for the A/R Invoice
      // using its own posting date, fiscal period, branch and availability.
      series: '',
      nextNumber: '',
    }));
    setSeriesReloadToken((token) => token + 1);
    const copiedHeaderUdfs = mergeUdfValues(copyFrom.headerUdfs, copyFrom.header_udfs, srcHeader.header_udfs, srcHeader.headerUdfs);
    setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, copiedHeaderUdfs));

    if (Array.isArray(srcLines) && srcLines.length > 0) {
      const copiedLines = srcLines.map((l, idx) => {
        const normalizedLine = normaliseDocumentLine(l, idx, copiedBaseEntry, copiedBaseType, copiedBranch);
        const copyOpenQty = parseNum(normalizedLine.openQty);
        const copiedQuantity = [15, 17].includes(Number(normalizedLine.baseType || copiedBaseType)) && copyOpenQty > 0
          ? String(copyOpenQty)
          : normalizedLine.quantity;
        const copiedLineUdfs = mergeUdfValues(l.line_udfs, l.lineUdfs, l.udf, normalizedLine.udf);
        return hydrateARInvoiceBatchLine({
          ...createLine(rowUdfDefinitions),
          // Preserve fields shared by the two document forms even when they
          // are not explicitly listed in the cross-document normalizer.
          ...l,
          ...normalizedLine,
          quantity: copiedQuantity,
          whse: normalizeWarehouse(normalizedLine, srcHeader) || normalizeWarehouse(l, srcHeader) || copiedWarehouse || '',
          taxCodeManuallyOverridden: Boolean(String(normalizedLine.taxCode || l.taxCode || l.TaxCode || l.VatGroup || '').trim()),
          baseEntry: l.baseEntry ?? l.BaseEntry ?? copiedBaseEntry,
          baseType: l.baseType ?? l.BaseType ?? copiedBaseType,
          baseLine: normalizeBaseLine(l, idx),
          branch: normalizedLine.branch || l.branch || copiedBranch,
          udf: normalizeUdfState(rowUdfDefinitions, copiedLineUdfs),
        });
      });
      setLines(copiedLines);
      refreshBatchAvailabilityForLines(copiedLines);
    }

    setFreightModal({
      open: false,
      freightCharges: Array.isArray(copyFrom.freightCharges) ? copyFrom.freightCharges : [],
      loading: false,
    });

    const cardCode = srcHeader.vendor || srcHeader.CardCode;
    if (cardCode) loadVendorDetails(cardCode);

    const sourceLabel = copyFrom.sourceLabel || copyFrom.type || 'source document';
    setPageState(p => ({ ...p, success: `Copied from ${sourceLabel}. Please review and save.` }));
    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state || persistedCopyState);
  }, [location.pathname, location.state?.copyFrom, navigate, headerUdfDefinitions, rowUdfDefinitions, getBranchFromWarehouseCode, hydrateARInvoiceBatchLine, refreshBatchAvailabilityForLines]); // eslint-disable-line react-hooks/exhaustive-deps

  // â”€â”€ derived / computed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const belongsToCurrentVendor = (row) => {
    const rowCardCode = String(row?.CardCode || '').trim();
    return !rowCardCode || rowCardCode === String(header.vendor || '').trim();
  };
  const vendorContacts = refData.contacts.filter(belongsToCurrentVendor);
  const contactOptions = header.contactPerson && !vendorContacts.some(c => String(c.CntctCode || '') === String(header.contactPerson || ''))
    ? [{ CardCode: header.vendor, CntctCode: header.contactPerson, Name: header.contactPerson }, ...vendorContacts]
    : vendorContacts;
  const vendorPayToAddresses = refData.pay_to_addresses.filter(belongsToCurrentVendor);
  const vendorShipToAddresses = refData.ship_to_addresses.filter(belongsToCurrentVendor);
  const vendorBillToAddresses = refData.bill_to_addresses.filter(belongsToCurrentVendor);
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
    return DEFAULT_TRANSACTION_TYPES;
  }, []);
  useEffect(() => {
    if (currentDocEntry || requestedEditDocEntry || header.transactionType || !transactionTypeOptions.length) return;
    const firstOption = transactionTypeOptions[0];
    setHeader((prev) => ({
      ...prev,
      transactionType: firstOption.value,
      indicator: firstOption.indicator || prev.indicator,
    }));
  }, [currentDocEntry, requestedEditDocEntry, header.transactionType, transactionTypeOptions]);

  useEffect(() => {
    if (currentDocEntry || requestedEditDocEntry || normalizeBranchSelection(header.branch) || !header.warehouse) return;

    const warehouseBranch = getBranchFromWarehouseCode(header.warehouse);
    if (!warehouseBranch) return;

    setHeader((prev) => {
      if (normalizeBranchSelection(prev.branch) || String(prev.warehouse || '') !== String(header.warehouse)) {
        return prev;
      }
      return {
        ...prev,
        branch: warehouseBranch,
        series: '',
        nextNumber: '',
      };
    });
    setSeriesReloadToken((token) => token + 1);
  }, [currentDocEntry, requestedEditDocEntry, header.branch, header.warehouse, getBranchFromWarehouseCode]);

  const resolveARInvoiceAddress = useCallback((code, addresses = [], fallbackText = '') => {
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

  const getUomGroupName = useCallback((item = {}) => {
    if (!item?.UoMGroupEntry && item?.UoMGroupEntry !== 0) return '';
    const group = (refData.uom_groups || []).find(g => String(g.AbsEntry) === String(item.UoMGroupEntry));
    return group?.Name || String(item.UoMGroupEntry || '');
  }, [refData.uom_groups]);

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

  const blanketAgreementLookupOptions = useMemo(() => {
    const docs = refData.base_documents?.blanket_agreements || refData.blanket_agreements || [];
    return (Array.isArray(docs) ? docs : []).map((agreement) => {
      const value = agreement.DocEntry ?? agreement.DocNum ?? agreement.AgreementNo ?? agreement.value ?? '';
      const description = agreement.CardName || agreement.Description || agreement.Remarks || agreement.description || '';
      return {
        value: value != null ? String(value) : '',
        description,
        label: description ? `${value} - ${description}` : String(value || ''),
        docEntry: agreement.DocEntry,
        docNum: agreement.DocNum,
      };
    }).filter((option) => option.value);
  }, [refData.base_documents, refData.blanket_agreements]);

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

  const getUdfLookupOptions = useCallback((fieldNames = []) => {
    const names = new Set(fieldNames.map(normalizeFieldIdentity));
    const field = (rowUdfDefinitions || []).find((definition) => fieldNameMatches(definition, names));
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

  const rowUdfByAlias = useMemo(() => new Map((rowUdfDefinitions || []).map((field) => [
    normalizeFieldIdentity(field.aliasId || field.key || field.label),
    field,
  ])), [rowUdfDefinitions]);

  const itemNameRowUdfKey = useMemo(() => {
    const candidates = ['itemname', 'itemdescription', 'sitemname', 'selleritemname'];
    return candidates.map((candidate) => rowUdfByAlias.get(candidate)?.key).find(Boolean) || '';
  }, [rowUdfByAlias]);

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
  const calcLineTotalFromFields = (line) => {
    const qty = parseNum(line.quantity), price = parseNum(line.unitPrice), disc = parseNum(line.stdDiscount);
    return roundTo(qty * price * (1 - disc / 100), numDec.total);
  };
  const calcLineTotal = (line) => {
    const enteredTotal = String(line.total ?? '').trim();
    return enteredTotal ? roundTo(parseNum(enteredTotal), numDec.total) : calcLineTotalFromFields(line);
  };
  const calcUnitPriceFromTotal = (line) => {
    const qty = parseNum(line.quantity);
    const total = parseNum(line.total);
    const discountFactor = 1 - parseNum(line.stdDiscount) / 100;
    if (qty <= 0 || total <= 0 || discountFactor <= 0) return '';
    return fmtDec(total / qty / discountFactor, numDec.unitPrice);
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
          savedTaxAmount: currentDocEntry ? l.taxAmount : undefined }), numDec.tax);
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
    objectType: 13,
    docEntry: currentDocEntry,
    header,
    total: totals.total,
  });
  const hasSavedWTaxAmount = Boolean(currentDocEntry && Math.abs(parseNum(header.wtaxAmount)) > 0);
  const hasWTaxLiableLines = lines.some((line) => isYesValue(line.wTaxLiable || line.wtaxLiable)) || hasSavedWTaxAmount;
  const showWTaxSummaryRow = hasWTaxLiableLines;
  const wtaxBaseAmount = totals.total;
  const recalcWithholdingRows = useCallback((rows = withholdingTax.rows, baseAmount = wtaxBaseAmount) => (
    (rows || []).map((row) => {
      const rate = parseNum(row.rate);
      return {
        ...row,
        baseAmount: roundTo(baseAmount, numDec.total),
        taxableAmount: roundTo(baseAmount, numDec.total),
        wtaxAmount: roundTo(baseAmount * rate / 100, numDec.tax),
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
    return [{
      code: codeRow.code || '',
      name: codeRow.name || '',
      rate,
      baseAmount: roundTo(baseAmount, numDec.total),
      taxableAmount: roundTo(baseAmount, numDec.total),
      wtaxAmount: roundTo(baseAmount * rate / 100, numDec.tax),
      category: codeRow.taxCategory || 'Invoice',
      baseType: 'Net',
      criteria: 'Cash',
      tdsType: 'eTDS',
      tdsAccount: '',
      surchargeAccount: '',
      cessAccount: '',
      hscAccount: '',
      igstAccount: '',
      cgstAccount: '',
      sgstAccount: '',
      utgstAccount: '',
    }];
  }, [numDec.tax, numDec.total, withholdingTax.allowedCodes, withholdingTax.defaultCode, wtaxBaseAmount]);
  const wtaxRowsForTotals = showWTaxSummaryRow
    ? (
        currentDocEntry && withholdingTax.rows.length
          ? withholdingTax.rows
          : recalcWithholdingRows(withholdingTax.rows.length ? withholdingTax.rows : createDefaultWithholdingRows())
      )
    : [];
  const withholdingModalRows = withholdingTax.open
    ? (
        currentDocEntry && withholdingTax.rows.length
          ? withholdingTax.rows
          : recalcWithholdingRows(withholdingTax.rows.length ? withholdingTax.rows : createDefaultWithholdingRows())
      )
    : wtaxRowsForTotals;
  const calculatedWtaxAmount = roundTo(wtaxRowsForTotals.reduce((sum, row) => sum + parseNum(row.wtaxAmount), 0), numDec.tax);
  const wtaxAmount = hasSavedWTaxAmount ? roundTo(parseNum(header.wtaxAmount), numDec.tax) : calculatedWtaxAmount;
  const totalPaymentDueAfterWTax = currentDocEntry && String(header.totalPaymentDue || '').trim()
    ? roundTo(parseNum(header.totalPaymentDue), numDec.totalPaymentDue)
    : roundTo(totals.total - wtaxAmount, numDec.totalPaymentDue);

  useEffect(() => {
    if (!hasWTaxLiableLines || !withholdingTax.customerSubject || withholdingTax.rows.length) return;

    const defaultRows = createDefaultWithholdingRows();
    if (!defaultRows.length) return;

    setWithholdingTax((prev) => (
      prev.rows.length ? prev : { ...prev, rows: defaultRows }
    ));
  }, [createDefaultWithholdingRows, hasWTaxLiableLines, withholdingTax.customerSubject, withholdingTax.rows.length]);

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
  const loadVendorDetails = async (code, options = {}) => {
    if (!code) {
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setWithholdingTax({ open: false, customerSubject: false, defaultCode: '', allowedCodes: [], rows: [] });
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
      const r = await fetchARInvoiceCustomerDetails(code);
      const contacts = r.data.contacts || [];
      const payToAddresses = r.data.pay_to_addresses || [];
      const shipToAddresses = r.data.ship_to_addresses || [];
      const customerWithholdingTax = r.data.withholding_tax || {};
      
      setRefData(p => ({
        ...p,
        contacts: contacts,
        pay_to_addresses: payToAddresses,
        ship_to_addresses: shipToAddresses,
        bill_to_addresses: payToAddresses
      }));
      setWithholdingTax((prev) => ({
        open: false,
        customerSubject: Boolean(customerWithholdingTax.subject),
        defaultCode: customerWithholdingTax.defaultCode || '',
        allowedCodes: customerWithholdingTax.allowedCodes || [],
        rows: options.preserveWithholdingRows ? prev.rows : [],
      }));

      if (contacts.length > 0) {
        setHeader(prev => ({
          ...prev,
          contactPerson: prev.contactPerson || String(contacts[0].CntctCode || '')
        }));
      }

      const defaultShipTo = shipToAddresses[0] || payToAddresses[0] || null;
      const defaultBillTo = payToAddresses[0] || shipToAddresses[0] || null;
      if (defaultShipTo || defaultBillTo) {
        const formattedShipTo = defaultShipTo ? fmtAddr(defaultShipTo) : '';
        const formattedBillTo = defaultBillTo ? fmtAddr(defaultBillTo) : formattedShipTo;
        setHeader(prev => ({
          ...prev,
          placeOfSupply: prev.placeOfSupply || defaultShipTo?.State || defaultBillTo?.State || '',
          shipToCode: prev.shipToCode || defaultShipTo?.Address || '',
          shipToAddress: prev.shipToAddress || prev.shipTo || formattedShipTo,
          shipTo: prev.shipTo || prev.shipToAddress || formattedShipTo,
          billToCode: prev.billToCode || prev.payToCode || defaultBillTo?.Address || '',
          billToAddress: prev.billToAddress || prev.payTo || formattedBillTo,
          payToCode: prev.payToCode || prev.billToCode || defaultBillTo?.Address || '',
          payTo: prev.payTo || prev.billToAddress || formattedBillTo
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
      setWithholdingTax({ open: false, customerSubject: false, defaultCode: '', allowedCodes: [], rows: [] });
    } finally {
      setPageState(p => ({ ...p, vendorLoading: false }));
    }
  };

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
        currency: resolveDocumentCurrency({
          mode: 'BP',
          cardCode: code,
          businessPartners: refData.vendors || [],
          currentCurrency: hdr.currency,
          localCurrency: refData.local_currency || refData.company_currency || '',
          systemCurrency: refData.system_currency || refData.local_currency || refData.company_currency || '',
          fallbackLocalCurrency: '',
        }),
        exchangeRate: '',
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
        ...prev,
        loading: false,
        error: getErrMsg(error, 'Failed to load exchange rates.'),
        data: buildExchangeRatesFallbackData({
          year,
          month,
          currencies: refData.currencies || [],
          localCurrency: refData.local_currency || refData.company_currency || '',
          documentCurrency: prev.currency,
        }),
      }));
    }
  }, [refData.company_currency, refData.currencies, refData.local_currency]);

  const saveExchangeRateFromModal = useCallback(async ({ rates = [], currency, postingDate, rate }) => {
    const entries = (Array.isArray(rates) && rates.length ? rates : [{ currency, postingDate, rate }])
      .map((entry) => ({ ...entry, rate: Number(entry.rate) }));
    const invalidEntry = entries.find((entry) => (
      !String(entry.currency || '').trim()
      || !String(entry.postingDate || '').trim()
      || !Number.isFinite(entry.rate)
      || entry.rate <= 0
    ));
    if (invalidEntry) {
      setExchangeRatesModal((prev) => ({ ...prev, error: 'Enter a positive exchange rate.' }));
      return;
    }
    setExchangeRatesModal((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const savedEntries = [];
      for (const entry of entries) {
        const saved = await saveSalesOrderExchangeRate(entry);
        savedEntries.push({ ...entry, rate: Number(saved.data?.rate) || entry.rate });
      }
      setHeader((prev) => {
        const documentRate = savedEntries.find((entry) => (
          String(entry.currency).toUpperCase() === String(prev.currency).toUpperCase()
          && String(entry.postingDate) === String(prev.postingDate)
        ));
        return documentRate ? { ...prev, exchangeRate: String(documentRate.rate) } : prev;
      });
      setExchangeRatesModal((prev) => ({ ...prev, open: false, loading: false, error: '' }));
      setPageState((prev) => ({ ...prev, error: '', success: '' }));
    } catch (error) {
      if (Number(error?.response?.status) === 404) {
        setHeader((prev) => {
          const documentRate = entries.find((entry) => (
            String(entry.currency).toUpperCase() === String(prev.currency).toUpperCase()
            && String(entry.postingDate) === String(prev.postingDate)
          ));
          return documentRate ? { ...prev, exchangeRate: String(documentRate.rate) } : prev;
        });
        setExchangeRatesModal((prev) => ({ ...prev, open: false, loading: false, error: '' }));
        return;
      }
      setExchangeRatesModal((prev) => ({
        ...prev,
        loading: false,
        error: getErrMsg(error, 'Failed to save exchange rate.'),
      }));
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
  }, [header.currency, header.exchangeRate, header.postingDate, openExchangeRatesModal, refData.company_currency, refData.local_currency]);

  useEffect(() => {
    if (currentDocEntry) return;
    if (!header.vendor || !header.currency || !header.postingDate) return;
    refreshExchangeRate(header.currency, header.postingDate);
  }, [currentDocEntry, header.vendor, header.currency, header.postingDate, refreshExchangeRate]);

  // â”€â”€ handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openLineLookup = (field, lineIndex, udfField = null) => {
    if (!isDocumentEditable) return;
    const isAccount = field === 'glAccount';
    const isSellerItem = field === 'sItem';
    const isPaymentTerms = field === 'buyerPaymentTerms' || field === 'sellerPaymentTerms' || field === 'sellerPaymentTermsRepeat';
    const isBlanketAgreement = field === 'blanketAgreementNo';
    const isStCode = field === 'stcode';
    const udfOptionsByField = {
      U_Cost_Sheet: getUdfLookupOptions(['CostSheet', 'Cost Sheet', 'Cost-Sheet', 'U_Cost_Sheet']),
      U_PackingType: getUdfLookupOptions(['PackingType', 'Packing Type', 'Packing-Type', 'U_PackingType']),
      U_ContainerType: getUdfLookupOptions(['ContainerType', 'Container Type', 'U_ContainerType']),
      stcode: getUdfLookupOptions(['STCODE', 'StatisticalCode', 'Statistical Code', 'U_STCODE']),
    };
    const fieldOptions = isAccount
      ? accountLookupOptions
      : isSellerItem
        ? itemLookupOptions
        : isPaymentTerms
          ? paymentTermLookupOptions
          : isBlanketAgreement
            ? blanketAgreementLookupOptions
            : isStCode
              ? udfOptionsByField.stcode
              : udfOptionsByField[field] || distributionRuleLookupOptions;
    setLineLookupModal({
      open: true,
      lineIndex,
      field,
      udfKey: udfField?.key || '',
      title: isAccount ? 'List of G/L Accounts'
        : isSellerItem ? 'List of Items'
        : isPaymentTerms ? 'List of Payment Terms'
        : isBlanketAgreement ? 'List of Blanket Agreements'
        : isStCode ? 'List of Statistical Codes'
        : 'List of Distribution Rules',
      options: fieldOptions,
      searchPlaceholder: isAccount ? 'Search G/L accounts'
        : isSellerItem ? 'Search items'
        : isPaymentTerms ? 'Search payment terms'
        : isBlanketAgreement ? 'Search blanket agreements'
        : isStCode ? 'Search statistical codes'
        : 'Search distribution rules',
      emptyMessage: isAccount ? 'No G/L accounts found'
        : isSellerItem ? 'No items found'
        : isPaymentTerms ? 'No payment terms found'
        : isBlanketAgreement ? 'No blanket agreements found'
        : isStCode ? 'No statistical codes found'
        : 'No distribution rules found',
      columns: isAccount
        ? [
            { key: 'accountNumber', label: 'Account Number', width: 150, primary: true },
            { key: 'accountName', label: 'Account Name' },
            { key: 'accountBalance', label: 'Account Balance', width: 130, align: 'right' },
            { key: 'inactive', label: 'Inactive', width: 90 },
          ]
        : isSellerItem
          ? [
              { key: 'itemCode', label: 'Item No.', width: 150, primary: true },
              { key: 'itemName', label: 'Item Description' },
              { key: 'salesUnit', label: 'UoM', width: 100 },
            ]
        : isPaymentTerms
          ? [
              { key: 'paymentTermCode', label: 'Code', width: 120, primary: true },
              { key: 'paymentTermName', label: 'Payment Terms' },
            ]
        : isBlanketAgreement
          ? [
              { key: 'docNum', label: 'Agreement No.', width: 140, primary: true },
              { key: 'description', label: 'Description' },
            ]
        : (isStCode || udfOptionsByField[field])
          ? null
          : [
              { key: 'factorCode', label: 'Distr. Rule', width: 140, primary: true },
              { key: 'factorDescription', label: 'Description' },
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
        const nextUdf = {
          ...(line.udf || {}),
          [lineLookupModal.udfKey]: selectedValue,
        };
        if (lineLookupModal.field === 'sItem' && itemNameRowUdfKey) {
          nextUdf[itemNameRowUdfKey] = option?.itemName || option?.description || '';
        }
        return {
          ...line,
          sellerItem: lineLookupModal.field === 'sItem' ? selectedValue : line.sellerItem,
          udf: nextUdf,
        };
      }

      const next = { ...line, [lineLookupModal.field]: selectedValue };
      if (lineLookupModal.field === 'glAccount') {
        next.glAccountName = option?.accountName || option?.description || '';
      }
      if (lineLookupModal.field === 'sellerItem') {
        next.sellerItem = selectedValue;
        if (!next.itemDescription) next.itemDescription = option?.itemName || option?.description || '';
      }
      if (lineLookupModal.field === 'distRule' && (!line.cogsDistRule || line.cogsDistRule === line.distRule)) {
        next.cogsDistRule = selectedValue;
      }
      return next;
    }));
    markDirty();
    closeLineLookup();
  };

  const handleHeaderChange = (e) => {
    if (!isDocumentEditable) return;
    const { name, value, type, checked } = e.target;
    setValErrors(p => ({ ...p, header: { ...p.header, [name]: '' }, form: '' }));
    setPageState(p => ({ ...p, error: '', success: '' }));
    
    if (name === 'series') {
      handleSeriesChange(value);
      return;
    }

    if (name === 'transactionType') {
      const selectedOption = transactionTypeOptions.find((option) => String(option.value) === String(value));
      setHeader(p => ({
        ...p,
        transactionType: value,
        indicator: selectedOption?.indicator || p.indicator,
        series: '',
        nextNumber: '',
      }));
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

    if (name === 'branch') {
      const nextWarehouses = filterWarehousesByBranch(effectiveWarehouses, value);
      setHeader(prev => {
        const currentWarehouseAllowed = nextWarehouses.some((warehouse) => (
          String(warehouse.WhsCode || '') === String(prev.warehouse || '')
        ));
        return {
          ...prev,
          branch: value,
          warehouse: currentWarehouseAllowed ? prev.warehouse : (nextWarehouses[0]?.WhsCode || ''),
          series: '',
          nextNumber: '',
        };
      });
      return;
    }

    if (name === 'warehouse') {
      const warehouseBranch = getBranchFromWarehouseCode(value);
      setHeader(prev => ({
        ...prev,
        warehouse: value,
        branch: warehouseBranch || prev.branch,
        ...(warehouseBranch && warehouseBranch !== normalizeBranchSelection(prev.branch)
          ? { series: '', nextNumber: '' }
          : {}),
      }));
      return;
    }
    
    if (name === 'vendor') {
      markResolvedBpLookup(e.target, value, refData.vendors, refData.bp_selection_policy);
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

  const handleLineChange = async (i, e) => {
    if (!isDocumentEditable) return;
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
            next.inventoryUOM = String(item.InventoryUOM || '').trim();
            next.uomFactor = 1;
            next.qtyInventoryUom = next.qtyInventoryUom || next.quantity || '';
            next.uomGroup = getUomGroupName(item);
            next.batchManaged = isBatchManaged(item);
            next.batches = [];
            next.hasBatchesAvailable = next.batchManaged ? true : false;
            next.countryOfOrigin = item.ItemCountryOrg || item.CountryOrg || next.countryOfOrigin || '';
            next.glAccount = next.glAccount || item.SalesGLAccount || item.IncomeAccount || item.IncomeAcct || item.RevenuesAccount || item.RevenuesAc || '';
            next.glAccountName = next.glAccountName || accountLookupOptions.find((account) => String(account.value) === String(next.glAccount || ''))?.accountName || '';
            next.distRule = next.distRule || item.DistributionRule || item.OcrCode || '';
            next.cogsDistRule = next.cogsDistRule || item.COGSDistributionRule || item.COGSCostingCode || item.CogsOcrCod || next.distRule || '';
            next.stcode = next.stcode || '';
            
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
              next.total = fmtDec(calcLineTotalFromFields(next), numDec.total);
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
            
            next.total = fmtDec(calcLineTotalFromFields(next), numDec.total);
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
            next.inventoryUOM = String(item.InventoryUOM || '').trim();
            next.uomFactor = 1;
            next.qtyInventoryUom = next.qtyInventoryUom || next.quantity || '';
            next.uomGroup = getUomGroupName(item);
            next.batchManaged = isBatchManaged(item);
            next.batches = [];
            next.hasBatchesAvailable = next.batchManaged ? true : false;
            next.countryOfOrigin = item.ItemCountryOrg || item.CountryOrg || next.countryOfOrigin || '';
            next.glAccount = next.glAccount || item.SalesGLAccount || item.IncomeAccount || item.IncomeAcct || item.RevenuesAccount || item.RevenuesAc || '';
            next.glAccountName = next.glAccountName || accountLookupOptions.find((account) => String(account.value) === String(next.glAccount || ''))?.accountName || '';
            next.distRule = next.distRule || item.DistributionRule || item.OcrCode || '';
            next.cogsDistRule = next.cogsDistRule || item.COGSDistributionRule || item.COGSCostingCode || item.CogsOcrCod || next.distRule || '';
            next.stcode = next.stcode || '';
            next.hsnCode = item.SWW || item.HSNCode || item.U_HSNCode || next.hsnCode || '';
          }
          next.total = fmtDec(calcLineTotalFromFields(next), numDec.total);
          return next;
        }));
      }
      return;
    }
    
    setLines(prev => prev.map((line, idx) => {
      if (idx !== i) return line;
      const next = { ...line, [name]: numDec[name] !== undefined ? sanitize(value, numDec[name]) : value };
      if (name === 'uomName') next.uomNameEdited = true;
      if (name === 'uomCode') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(next.itemNo || ''));
        Object.assign(next, applyUomCodeSelection(next, value, getLineUomOptions(next, item, refData.uom_groups)));
      }
      if (['itemNo', 'whse', 'quantity', 'uomCode'].includes(name)) {
        next.batches = [];
        if (next.batchManaged) next.hasBatchesAvailable = true;
      }
      if (name === 'taxCode') {
        next.taxCodeManuallyOverridden = Boolean(String(next.taxCode || '').trim());
      }
      if (name === 'distRule' && (!line.cogsDistRule || line.cogsDistRule === line.distRule)) {
        next.cogsDistRule = value;
      }
      if (name === 'quantity' && !isCheckedValue(next.changeQtyInvUomIndependently)) {
        next.qtyInventoryUom = next.quantity;
      }
      if (name === 'total') {
        next.total = sanitize(value, numDec.total);
        const unitPrice = calcUnitPriceFromTotal(next);
        if (unitPrice) next.unitPrice = unitPrice;
      } else if (['quantity', 'unitPrice', 'stdDiscount'].includes(name)) {
        next.total = fmtDec(calcLineTotalFromFields(next), numDec.total);
      }
      return next;
    }));

    if ((name === 'wTaxLiable' || name === 'wtaxLiable') && isYesValue(value) && withholdingTax.customerSubject) {
      setWithholdingTax((prev) => ({
        ...prev,
        open: false,
        rows: prev.rows.length ? recalcWithholdingRows(prev.rows) : createDefaultWithholdingRows(),
      }));
    }
  };

  const handleNumBlur = (field, target = 'line', i = null) => {
    if (!isDocumentEditable) return;
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
    setLines(previous => {
      const nextLines = applyDocumentTablePaste({
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
          let next = hydrateWorkbookDocumentLine({
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
          if (pastedKeys.has('taxCode')) next.taxCodeManuallyOverridden = Boolean(String(next.taxCode || '').trim());
          if (pastedKeys.has('distRule') && !next.cogsDistRule) next.cogsDistRule = next.distRule;
          next.total = fmtDec(calcLineTotalFromFields(next), numDec.total);
          return hydrateARInvoiceBatchLine(next);
        },
      });
      return nextLines;
    });
  };

  const handleTableClipboardFeedback = (message, type) => {
    setPageState(previous => ({
      ...previous,
      error: type === 'error' ? message : '',
      success: type === 'error' ? '' : message,
    }));
  };

  // â”€â”€ Freight Selection Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openWithholdingTaxTable = useCallback(() => {
    if (!isDocumentEditable) return;
    if (!header.vendor) {
      setPageState((prev) => ({ ...prev, error: 'Select a customer before opening withholding tax table.', success: '' }));
      return;
    }

    setPageState((prev) => ({ ...prev, error: '', success: '' }));
    setWithholdingTax((prev) => ({
      ...prev,
      open: true,
      rows: prev.rows.length ? recalcWithholdingRows(prev.rows) : createDefaultWithholdingRows(),
    }));
  }, [createDefaultWithholdingRows, header.vendor, isDocumentEditable, recalcWithholdingRows]);

  const openFreightModal = async () => {
    if (!isDocumentEditable) return;
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
    if (!isDocumentEditable) return;
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
    if (!isDocumentEditable) return;
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
      
      // SAP B1 allows either Unit Price or Total (LC) to drive the line amount.
      if (
        (!lastLine.unitPrice || Number(lastLine.unitPrice) <= 0) &&
        (!lastLine.total || Number(lastLine.total) <= 0)
      ) {
        errors.total = 'Total (LC) or Unit Price is required before adding a new line';
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
      whse: header.warehouse || ''
    }]);
  };

  const removeLine = (i) => {
    if (!isDocumentEditable) return;
    markDirty();
    setValErrors(p => { const nl = { ...p.lines }; delete nl[i]; return { ...p, lines: nl, form: '' }; });
    setLines(p => p.filter((_, idx) => idx !== i));
  };

  const handleHeaderUdfChange = (k, v) => {
    if (!isDocumentEditable) return;
    markDirty();
    setHeaderUdfs(p => ({ ...p, [k]: v }));
  };
  const handleRowUdfChange = (i, k, v) => {
    if (!isDocumentEditable) return;
    markDirty();
    const field = rowUdfDefinitions.find((definition) => definition.key === k);
    const isSellerItem = normalizeFieldIdentity(field?.aliasId || field?.key || field?.label) === 'sitem';
    const matchedItem = isSellerItem
      ? refData.items.find((item) => String(item.ItemCode || '') === String(v || ''))
      : null;

    setLines(p => p.map((l, idx) => {
      if (idx !== i) return l;
      const nextUdf = { ...(l.udf || {}), [k]: v };
      if (isSellerItem && itemNameRowUdfKey) {
        nextUdf[itemNameRowUdfKey] = matchedItem?.ItemName || '';
      }
      return {
        ...l,
        sellerItem: isSellerItem ? v : l.sellerItem,
        udf: nextUdf,
      };
    }));
  };
  const updateFormSetting = (g, k, prop, val) => setFormSettings((previous) => (
    updateFormSettingPreference(previous, g, k, prop, val, {
      editableSapControlledGroups: ['matrixColumns', 'rowUdfs', 'headerUdfs'],
    })
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
    if (!isDocumentEditable) return;
    const shipAddress = resolveARInvoiceAddress(
      header.shipToCode,
      vendorEffectiveShipToAddresses,
      header.shipToAddress || header.shipTo,
    );
    const billAddress = resolveARInvoiceAddress(
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
    if (!isDocumentEditable) return;
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
      const selectedAddress = resolveARInvoiceAddress(value, vendorEffectiveShipToAddresses);
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
      const selectedAddress = resolveARInvoiceAddress(value, vendorEffectiveBillToAddresses);
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
    if (!isDocumentEditable) return;
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
    if (!isDocumentEditable) return;
    setBpModal(true);
  };

  const closeBpModal = () => {
    setBpModal(false);
  };

  // â”€â”€ State Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const openStateModal = () => {
    if (!isDocumentEditable) return;
    setStateModal(true);
  };

  const closeStateModal = () => {
    setStateModal(false);
  };

  const handleStateSelect = (state) => {
    if (!isDocumentEditable) return;
    setHeader(p => ({ ...p, placeOfSupply: getStateCodeValue(state, refData.states) }));
  };

  // â”€â”€ BP Modal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleBpSelect = (bp) => {
    if (!isDocumentEditable) return;
    const code = bp.CardCode;
    if (!isSelectableBpCode(code, refData.bp_selection_policy)) return;
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
    if (!isDocumentEditable) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from(e.target.files);
      alert(`Selected ${files.length} file(s). Upload functionality to be implemented.`);
    };
    input.click();
  };

  const openBatchModalForLine = useCallback((lineIndex, line) => {
    if (!isDocumentEditable) return;
    if (isDeliveryBasedLine(line)) {
      setPageState((prev) => ({
        ...prev,
        error: 'Batch assignment is not required for an A/R Invoice copied from Delivery.',
        success: '',
      }));
      return;
    }
    if (!line?.itemNo) {
      setPageState((prev) => ({ ...prev, error: 'Select an item before allocating batches.', success: '' }));
      return;
    }
    if (!line?.whse) {
      setPageState((prev) => ({ ...prev, error: 'Select a warehouse before allocating batches.', success: '' }));
      return;
    }

    const hydratedLine = hydrateARInvoiceBatchLine(line);
    const itemNo = hydratedLine.itemNo;
    const whse = hydratedLine.whse;
    setBatchModal({ open: true, lineIndex, availableBatches: [], loading: true, error: '' });
    window.setTimeout(async () => {
      try {
        const response = await fetchBatchesByItem(itemNo, whse);
        setBatchModal((current) => (
          current.open && current.lineIndex === lineIndex
            ? {
                open: true,
                lineIndex,
                availableBatches: response.data?.batches || [],
                loading: false,
                error: '',
              }
            : current
        ));
      } catch (error) {
        setBatchModal((current) => (
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
  }, [hydrateARInvoiceBatchLine, isDocumentEditable]);

  const openBatchModal = useCallback((lineIndex, lineOverride = null) => {
    openBatchModalForLine(lineIndex, lineOverride || lines[lineIndex]);
  }, [lines, openBatchModalForLine]);

  const closeBatchModal = () => {
    setBatchModal({ open: false, lineIndex: null, availableBatches: [], loading: false, error: '' });
  };

  const saveLineBatches = (nextBatches) => {
    if (batchModal.lineIndex == null) return;
    markDirty();
    setLines((prev) => prev.map((line, index) => {
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
        qtyInventoryUom: String(assignedBaseQty),
        hasBatchesAvailable: true,
      };

      return {
        ...updatedLine,
        total: fmtDec(calcLineTotalFromFields(updatedLine), numDec.total),
      };
    }));
    setValErrors((prev) => ({
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
    if (!isDocumentEditable) return;
    setHsnModal({ open: true, lineIndex });
  };

  const closeHSNModal = () => {
    setHsnModal({ open: false, lineIndex: -1 });
  };

  const handleHSNSelect = (hsn) => {
    if (!isDocumentEditable) return;
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
    if (!isDocumentEditable) return;
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
    if (!isDocumentEditable) return;
    if (itemModal.lineIndex < 0) return;
    
    const lineIndex = itemModal.lineIndex;
    const mergedItem = mergeItemMaster(item, refData.items);
    
    try {
      const hsnRes = await fetchHSNCodeFromItem(mergedItem.ItemCode);
      const hsnData = hsnRes.data;
      
      setLines(prev => prev.map((line, idx) => {
        if (idx === lineIndex) {
          const updatedLine = hydrateDocumentLineFromItem(line, mergedItem, {
            side: 'sales',
            hsnCode: hsnData.hsnCode || hsnData.hsn_sww || '',
            fallbackWarehouse: header.warehouse,
            syncUnitPriceUdf: false,
            calcLineTotal,
            formatTotal: (value) => fmtDec(value, numDec.total),
            uomGroups: refData.uom_groups,
          });
          updatedLine.uomName = updatedLine.uomName || updatedLine.uomCode || '';
          updatedLine.inventoryUOM = mergedItem.InventoryUOM || updatedLine.inventoryUOM || '';
          updatedLine.qtyInventoryUom = updatedLine.qtyInventoryUom || updatedLine.quantity || '';
          updatedLine.uomGroup = getUomGroupName(mergedItem);
          updatedLine.stcode = updatedLine.stcode || '';
          
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
          const updatedLine = hydrateDocumentLineFromItem(line, mergedItem, {
            side: 'sales',
            fallbackWarehouse: header.warehouse,
            syncUnitPriceUdf: false,
            calcLineTotal,
            formatTotal: (value) => fmtDec(value, numDec.total),
            uomGroups: refData.uom_groups,
          });
          updatedLine.uomName = updatedLine.uomName || updatedLine.uomCode || '';
          updatedLine.inventoryUOM = mergedItem.InventoryUOM || updatedLine.inventoryUOM || '';
          updatedLine.qtyInventoryUom = updatedLine.qtyInventoryUom || updatedLine.quantity || '';
          updatedLine.uomGroup = getUomGroupName(mergedItem);
          updatedLine.stcode = updatedLine.stcode || '';
          return updatedLine;
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
        ? { ...line, whse: '', batches: [], hasBatchesAvailable: line.batchManaged ? true : line.hasBatchesAvailable }
        : line
    )));
  }, [branchFilteredWarehouses, header.branch, refData.warehouses.length]);

  // Sync warehouse to all lines when header warehouse changes
  useEffect(() => {
    if (header.warehouse) {
      setLines(prev => prev.map(l => (
        String(l.whse || '') === String(header.warehouse)
          ? l
          : {
              ...l,
              whse: header.warehouse,
              batches: [],
              hasBatchesAvailable: l.batchManaged ? true : l.hasBatchesAvailable,
            }
      )));
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
        if (!isSelectableBpCode(vc, refData.bp_selection_policy)) {
          e.header.vendor = `Use ${refData.bp_selection_policy.preferredCardCode} for this customer.`;
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

      if (!isUpdate && !String(header.series || '').trim()) {
        e.header.series = 'Select a valid numbering series.';
        e.form = 'A valid numbering series is required for this posting date.';
        return e;
      }

      if (!isUpdate && refData.branches.length) {
        const selectedSeries = refData.series.find((series) => String(series.Series) === String(header.series));
        const resolvedBranch = normalizeBranchSelection(header.branch)
          || normalizeBranchSelection(selectedSeries?.BPLId)
          || getBranchFromWarehouseCode(header.warehouse || normalizeWarehouse(lines[0] || {}, header));
        if (!resolvedBranch) {
          e.header.branch = 'Select the branch assigned to this warehouse and numbering series.';
          e.form = 'Branch is required before the A/R Invoice can be added.';
          return e;
        }
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

        const openQty = parseNum(l.openQty ?? l.OpenQty ?? l.OpenQuantity);
        if ((l.baseType || l.BaseType) && openQty > 0 && parseNum(l.quantity) - openQty > 0.000001) {
          e.lines[i] = { ...(e.lines[i] || {}), quantity: `Quantity cannot exceed open quantity ${openQty}` };
          e.form = 'Please copy only the remaining open quantity.';
          return e;
        }

        if (!l.hsnCode && !isUpdate) {
          console.log(`âŒ Line ${i}: HSN Code is required`);
          e.lines[i] = { ...(e.lines[i] || {}), hsnCode: 'HSN Code is required' };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }

        if (
          (!l.unitPrice || Number(l.unitPrice) <= 0) &&
          (!l.total || Number(l.total) <= 0) &&
          !isUpdate
        ) {
          console.log(`âŒ Line ${i}: Unit Price/Total validation failed`);
          e.lines[i] = { ...(e.lines[i] || {}), total: 'Total (LC) or Unit Price must be > 0' };
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
        const item = refData.items.find((candidate) => String(candidate.ItemCode || '') === String(l.itemNo || ''));
        const batchManaged = !isDeliveryBasedLine(l) && isLineBatchManaged(l, item);
        if (batchManaged && !isUpdate) {
          if (!Array.isArray(l.batches) || l.batches.length === 0) {
            e.lines[i] = { ...(e.lines[i] || {}), batches: 'Batch selection is mandatory for batch-managed item' };
            e.form = 'Please assign batches before adding this A/R Invoice.';
            return e;
          }

          if (!batchQtyMatchesLine(l, l.batches)) {
            e.lines[i] = { ...(e.lines[i] || {}), batches: 'Batch quantity must match the line quantity in base UoM' };
            e.form = 'Please assign batches before adding this A/R Invoice.';
            return e;
          }
        }

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
  const openCopyFromModal = (docType) => {
    if (!isDocumentEditable || currentDocEntry) return;
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

  // â”€â”€ Copy From handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCopyFrom = (data, sourceType) => {
    setSeriesRevision(value => value + 1);

    const copySource = unwrapCopyFromDocument(data);
    const copiedFreight = summarizeFreightRows(copySource.freightCharges, effectiveTaxCodes);
    setFreightModal({ open: false, freightCharges: copiedFreight.rows, loading: false });
    const baseType = BASE_TYPE[sourceType] || 17;
    const normHeader = normaliseDocumentHeader(copySource.header);
    const firstSourceLine = Array.isArray(copySource.lines) && copySource.lines.length ? copySource.lines[0] : {};
    const copiedWarehouse = normalizeWarehouse(firstSourceLine, copySource.header || {});
    const resolvedBranch = normalizeBranchSelection(normHeader.branch)
      || normalizeBranchSelection(firstSourceLine.branch || firstSourceLine.Branch || firstSourceLine.BPL_IDAssignedToInvoice || firstSourceLine.BPLId)
      || getBranchFromWarehouseCode(copiedWarehouse);
    const resolvedHeader = { ...normHeader, branch: resolvedBranch, warehouse: normHeader.warehouse || copiedWarehouse || header.warehouse };
    // The target is a new invoice; retain source data but reset document dates.
    const copyDate = today();

    setHeader(prev => ({
      ...prev,
      ...resolvedHeader,
      currency: copySource.header?.currency || copySource.header?.DocCur || prev.currency || refData.local_currency || refData.company_currency || INIT_HEADER.currency,
      currencyMode: copySource.header?.currencyMode || prev.currencyMode || 'BP',
      postingDate: copyDate,
      documentDate: copyDate,
      deliveryDate: copyDate,
      exchangeRate: '',
      series: '',
      nextNumber: '',
      freight: fmtDec(copiedFreight.totalNet, numDec.freight),
    }));
    setSeriesReloadToken((token) => token + 1);
    const copiedHeaderUdfs = mergeUdfValues(copySource.header_udfs, copySource.headerUdfs, copySource.header?.header_udfs, copySource.header?.headerUdfs);
    setHeaderUdfs(normalizeUdfState(headerUdfDefinitions, copiedHeaderUdfs));

    const rawLines = copySource.lines;
    const newLines = rawLines.map((line, idx) => {
      const normalizedLine = normaliseDocumentLine(line, idx, copySource.docEntry, baseType, resolvedBranch);
      const copyOpenQty = parseNum(normalizedLine.openQty);
      const copiedQuantity = [15, 17].includes(Number(normalizedLine.baseType || baseType)) && copyOpenQty > 0
        ? String(copyOpenQty)
        : normalizedLine.quantity;
      const copiedLineUdfs = mergeUdfValues(line.line_udfs, line.lineUdfs, line.udf, normalizedLine.udf);
      return hydrateARInvoiceBatchLine({
        ...createLine(rowUdfDefinitions),
        ...normalizedLine,
        quantity: copiedQuantity,
        branch: normalizeBranchSelection(normalizedLine.branch) || resolvedBranch,
        udf: normalizeUdfState(rowUdfDefinitions, copiedLineUdfs),
      });
    });
    setLines(newLines.length > 0 ? newLines : [createLine(rowUdfDefinitions)]);
    refreshBatchAvailabilityForLines(newLines);

    const cardCode = normHeader.vendor;
    if (cardCode && cardCode !== header.vendor) loadVendorDetails(cardCode);

    const labels = { salesQuotation: 'Sales Quotation', salesOrder: 'Sales Order', delivery: 'Delivery', blanket: 'Blanket Agreement' };
    setPageState(p => ({ ...p, success: `Copied from ${labels[sourceType] || sourceType}` }));
  };

  // â”€â”€ Copy From fetch handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fetchCopyFromDocuments = async (docType) => {
    try {
      const bpCode = String(header.vendor || '').trim();
      if (!bpCode) return [];

      // Sales Quotations: use dedicated API
      if (docType === 'salesQuotation') {
        const res = await fetchOpenSalesQuotationsForARInvoice(bpCode);
        return res?.data?.quotations || res?.data?.documents || [];
      }
      // Sales Orders: filter by current customer for relevance
      if (docType === 'salesOrder') {
        const res = await fetchOpenSalesOrdersForARInvoice(bpCode);
        return res?.data?.orders || res?.data?.documents || [];
      }
      // Deliveries: filter by current customer for relevance
      if (docType === 'delivery') {
        const res = await fetchOpenDeliveriesForARInvoice(bpCode);
        return res?.data?.deliveries || res?.data?.documents || [];
      }
      // Blanket Agreements: use dedicated API
      if (docType === 'blanket') {
        const res = await fetchOpenBlanketAgreementsForARInvoice();
        return res?.data?.agreements || [];
      }
      return await arInvoiceCopyFromApi.fetchOpenDocuments(docType, bpCode);
    } catch (err) {
      console.error('Error fetching documents:', err);
      throw err;
    }
  };

  const fetchCopyFromDocumentDetails = async (docType, docEntry) => {
    try {
      if (docType === 'salesQuotation') {
        const res = await fetchSalesQuotationForARInvoiceCopy(docEntry);
        return res.data;
      }
      if (docType === 'salesOrder') {
        const res = await fetchSalesOrderForARInvoiceCopy(docEntry);
        return res.data;
      }
      if (docType === 'delivery') {
        const res = await fetchDeliveryForARInvoiceCopy(docEntry);
        return res.data;
      }
      if (docType === 'blanket') {
        const res = await fetchBlanketAgreementForARInvoiceCopy(docEntry);
        return res.data;
      }
      return await arInvoiceCopyFromApi.fetchDocumentForCopy(docType, docEntry);
    } catch (err) {
      console.error('Error fetching document details:', err);
      throw err;
    }
  };

  // â”€â”€ Copy To handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCopyTo = async (targetType = 'ar-credit-memo') => {
    await copyToDocument({
      sourceDocType: 'arInvoice',
      targetType,
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: {
        header,
        lines: lines.map((line) => ({
          ...stripSalesDocumentTopLevelUdfs(line),
          stdDiscount: line.stdDiscount ?? line.DiscountPercent ?? line.DiscPrcnt ?? line.discount ?? '',
        })),
        headerUdfs,
        freightCharges: freightModal.freightCharges,
      },
      restoreState: { arInvoiceDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
      errorMessage: 'Please save the AR invoice first before copying to another document',
    });
  };

  const handleDuplicate = async () => {
    setSeriesRevision(value => value + 1);

    const duplicateDate = today();
    const duplicateSeriesValue = String(header.series || '').trim();
    const duplicateTransactionType = String(
      header.transactionType || getTransactionTypeFromUdfs(headerUdfDefinitions, headerUdfs) || 'GST Tax Invoice'
    ).trim();
    const firstLineWarehouse = normalizeWarehouse(lines[0] || {}, header);
    const duplicateBranch = normalizeBranchSelection(header.branch)
      || normalizeBranchSelection(lines[0]?.branch || lines[0]?.loc)
      || getBranchFromWarehouseCode(header.warehouse || firstLineWarehouse);
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
      successMessage: 'A/R invoice duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      setHeader(prev => ({
        ...prev,
        postingDate: duplicateDate,
        documentDate: duplicateDate,
        deliveryDate: prev.deliveryDate || duplicateDate,
        branch: duplicateBranch,
        transactionType: duplicateTransactionType,
        series: duplicateSeriesValue,
        nextNumber: '',
      }));
      if (duplicateSeriesValue === SAP_MANUAL_SERIES_VALUE) {
        handleSeriesChange(duplicateSeriesValue);
        return;
      }

    }
  };

  // â”€â”€ submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
    docEntry: currentDocEntry, isDirty,
    state: { header, lines, headerUdfs, withholdingTax, freightCharges: freightModal.freightCharges, companyDb: activeCompanyDb , company_id: activeCompanyId, companyKey: formSettingsStorageKey },
  });

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!companyFormSettingsReady) {
      setPageState(p => ({ ...p, error: 'Select a company and wait for its Form Settings to load before saving this document.', success: '' }));
      return;
    }
    if (!isDocumentEditable) {
      setPageState(p => ({ ...p, error: 'Closed A/R Invoices cannot be edited.', success: '' }));
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
          const hydratedLines = lines.map(hydrateARInvoiceBatchLine);
          setLines(hydratedLines);
          setActiveTab('Contents');
          refreshBatchAvailabilityForLines(hydratedLines);
          window.setTimeout(() => openBatchModal(lineIndex, hydratedLines[lineIndex]), 0);
        }
      }
      return;
    }
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, posting: true, error: '', success: '' }));
    try {
      const selectedSeries = refData.series.find((series) => String(series.Series) === String(header.series));
      const selectedSeriesBranch = normalizeBranchSelection(selectedSeries?.BPLId);
      const firstLineWarehouse = normalizeWarehouse(lines[0] || {}, header);
      const resolvedBranch = normalizeBranchSelection(header.branch)
        || selectedSeriesBranch
        || normalizeBranchSelection(lines[0]?.branch || lines[0]?.loc)
        || getBranchFromWarehouseCode(header.warehouse || firstLineWarehouse);
      const prep = { 
        ...stripSalesDocumentTopLevelUdfs(header),
        transactionType: header.transactionType,
        transactionTypeCode: getDocumentTypeCodeForTransaction(header.transactionType),
        deliveryDate: header.deliveryDate || header.postingDate || header.documentDate,
        placeOfSupply: header.placeOfSupply,
        branch: resolvedBranch,
        contactPerson: header.contactPerson,
        roundingAmount: getDocumentRoundingPayloadAmount(header, totals.roundingAmount),
        roundingAmountIsManual: header.roundingAmountIsManual === true,
      };
      
      // Only include series if it's explicitly set and valid
      if (header.series && String(header.series).trim() && Number(header.series) > 0) {
        prep.series = Number(header.series);
      }
      
      console.log('ðŸ” [Frontend] Submitting AR Invoice with header:', prep);
      console.log('ðŸ” [Frontend] Lines:', lines);
      
      const payload = {
        company_id: activeCompanyId,
        header: prep,
        lines: lines.map((line) => ({
          ...stripSalesDocumentTopLevelUdfs(line),
          batches: isDeliveryBasedLine(line) ? [] : line.batches,
          batchManaged: isDeliveryBasedLine(line) ? false : line.batchManaged,
          udf: buildARInvoiceLineUdfPayload(line, rowUdfDefinitions, formSettings),
        })),
        freightCharges: freightModal.freightCharges,
        withholdingTaxRows: wtaxRowsForTotals,
        header_udfs: normalizeUdfState(headerUdfDefinitions, headerUdfs),
      };
      const r = currentDocEntry ? await updateARInvoice(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitARInvoice(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      setSnapshotPending(false);
      setIsDirty(false);
      setCurrentDocEntry(null); setHeader(INIT_HEADER); setLines([createLine(rowUdfDefinitions)]);
      setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
      setRefData(p => ({ ...p, contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [] }));
      setWithholdingTax({ open: false, customerSubject: false, defaultCode: '', allowedCodes: [], rows: [] });
      setValErrors({ header: {}, lines: {}, form: '' });
      
      if (Array.isArray(refData.series) && refData.series.length > 0) {
        setHeader(prev => ({ ...prev, series: '', nextNumber: '', docNo: '' }));
      }
      
      setPageState(p => ({ ...p, success: `${r.data.message || 'AR Invoice saved.'}${dn}` }));
    } catch (e) {
      console.error('âŒ [Frontend] AR Invoice submission failed:', e);
      const responseBody = e?.response?.data || {};
      const isBatchSelectionError = responseBody.code === 'BATCH_SELECTION_REQUIRED'
        || /batch selection is mandatory|batch quantity must match/i.test(getErrMsg(e, ''));
      if (isBatchSelectionError) {
        const detailLine = Array.isArray(responseBody.details?.lines)
          ? responseBody.details.lines[0]
          : null;
        const detailIndex = Number(detailLine?.lineIndex);
        const errorItemCode = String(detailLine?.itemCode || '').trim();
        const hydratedLines = lines.map(hydrateARInvoiceBatchLine);
        let lineIndex = Number.isInteger(detailIndex) && detailIndex >= 0 && detailIndex < hydratedLines.length
          ? detailIndex
          : -1;

        if (lineIndex < 0 && errorItemCode) {
          lineIndex = hydratedLines.findIndex((line) => (
            !isDeliveryBasedLine(line)
            && String(line.itemNo || line.ItemCode || '').trim() === errorItemCode
          ));
        }
        if (lineIndex < 0) {
          lineIndex = hydratedLines.findIndex((line) => !isDeliveryBasedLine(line) && line.batchManaged);
        }

        if (lineIndex >= 0) {
          const message = detailLine?.message || getErrMsg(e, 'Please assign batches before adding this A/R Invoice.');
          setLines(hydratedLines);
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
          refreshBatchAvailabilityForLines(hydratedLines);
          window.setTimeout(() => openBatchModal(lineIndex, hydratedLines[lineIndex]), 0);
          return;
        }
      }
      setPageState(p => ({ ...p, error: getErrMsg(e, 'AR Invoice submission failed.') }));
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
    setWithholdingTax({ open: false, customerSubject: false, defaultCode: '', allowedCodes: [], rows: [] });
  };

  const visHdrUdfs = headerUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
  const visibleRowUdfs = rowUdfDefinitions.filter(f => formSettings.rowUdfs?.[f.key]?.visible !== false);
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;
  const documentBodyRef = useRef(null);
  useClosedDocumentViewMode(documentBodyRef, !isDocumentEditable, [activeTab, sidebarOpen, formSettingsOpen]);

  // Continue in next part with render...

  // â”€â”€ render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useDocumentSeries({ endpoint: '/ar-invoice', companyKey: formSettingsStorageKey, currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form
      ref={formRef}
      className={`del-page sap-document-page so-sales-order-page${isRightSidebarOpen ? ' del-page--sidebar-open' : ''}`}
      onSubmit={handleSubmit}
      onChangeCapture={markDirty}
    >

      {/* toolbar */}
      <div className="del-toolbar sap-document-toolbar">
        <span className="del-toolbar__title">A/R Invoice{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="del-btn del-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || !isDocumentEditable || formSettingsStatus.queryModeActive}>
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
          documentType="arInvoice"
          documentLabel="A/R Invoice"
          docEntry={currentDocEntry}
          docNumber={header.docNo}
          disabled={pageState.posting}
          classPrefix="del"
          onSuccess={(message) => setPageState(p => ({ ...p, error: '', success: message }))}
          onError={(message) => setPageState(p => ({ ...p, success: '', error: message }))}
        />
        <JournalEntryPreviewButton
          documentType="arInvoice"
          documentLabel="A/R Invoice"
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
              setValErrors({ header: {}, lines: {}, form: '' });
              setPageState(p => ({ ...p, error: '', success: '' }));
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
              Sales Orders / Deliveries
            </button>
          </div>
        </div>
        <button 
          type="button" 
          className="del-btn sap-document-toolbar__copy"
          onClick={() => handleCopyTo('arCreditMemo')}
          disabled={!currentDocEntry || formSettingsStatus.queryModeActive}
          title={!currentDocEntry ? 'Save the AR invoice first' : 'Copy this invoice to A/R Credit Memo'}
        >
          Copy To
        </button>
        {currentDocEntry && (
          <button type="button" className="del-btn sap-document-toolbar__duplicate" onClick={handleDuplicate} disabled={formSettingsStatus.queryModeActive}>
            Duplicate
          </button>
        )}
        <button type="button" className="del-btn sap-document-toolbar__find" onClick={() => navigate('/ar-invoice/find')}>Find</button>
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
                    
                    {/* Customer */}
                    <div className="del-field">
                      <label className="del-field__label">Customer *</label>
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

                    {/* Name */}
                    <div className="del-field">
                      <label className="del-field__label">Name</label>
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

                    {/* Customer Ref. No. */}
                    <div className="del-field">
                      <label className="del-field__label">Customer Ref. No.</label>
                      <input
                        name="salesContractNo"
                        className="del-field__input"
                        value={header.salesContractNo}
                        onChange={handleHeaderChange}
                        disabled={!isDocumentEditable}
                      />
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
                      disabled={!isDocumentEditable || pageState.vendorLoading || !header.vendor || !!currentDocEntry}
                    />

                    {/* Transaction Type */}
                    <div className="del-field">
                      <label className="del-field__label">Transaction Type</label>
                      <select
                        name="transactionType"
                        className="del-field__select"
                        value={header.transactionType || ''}
                        onChange={handleHeaderChange}
                        disabled={!isDocumentEditable || !transactionTypeOptions.length}
                      >
                        {transactionTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

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
                          disabled={!isDocumentEditable}
                        />
                        <button
                          type="button"
                          className="del-btn del-btn--lookup"
                          onClick={openStateModal}
                          title="Select State"
                          disabled={!isDocumentEditable}
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
                        disabled={!isDocumentEditable}
                      >
                        <option value="">Select Warehouse</option>
                        {branchFilteredWarehouses.map(w => (
                          <option key={w.WhsCode} value={w.WhsCode}>
                            {w.WhsCode} - {w.WhsName}
                          </option>
                        ))}
                        {header.warehouse && !branchFilteredWarehouses.some(w => String(w.WhsCode) === String(header.warehouse)) && (
                          <option value={header.warehouse}>{header.warehouse}</option>
                        )}
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
                        className={`del-field__select${valErrors.header.series ? ' del-field__input--error' : ''}`}
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

                    {/* Status */}
                    <div className="del-field">
                      <label className="del-field__label">Status</label>
                      <input name="status" className="del-field__input" value={header.status} readOnly style={{ background: '#f0f2f5', color: header.status === 'Open' ? '#1a7a30' : '#c00', fontWeight: 600 }} />
                    </div>

                    {/* Posting Date */}
                    <div className="del-field">
                      <label className="del-field__label">Posting Date *</label>
                      <SapDateInput  name="postingDate" className={`del-field__input${valErrors.header.postingDate ? ' del-field__input--error' : ''}`} value={header.postingDate} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
                    </div>

                    {/* Due Date */}
                    <div className="del-field">
                      <label className="del-field__label">Due Date</label>
                      <SapDateInput  name="deliveryDate" className="del-field__input" value={header.deliveryDate} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
                    </div>

                    {/* Document Date */}
                    <div className="del-field">
                      <label className="del-field__label">Document Date *</label>
                      <SapDateInput  name="documentDate" className={`del-field__input${valErrors.header.documentDate ? ' del-field__input--error' : ''}`} value={header.documentDate} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
                    </div>

                    {/* Payment Terms */}
                    <div className="del-field">
                      <label className="del-field__label">Payment Terms</label>
                      <select name="paymentTerms" className="del-field__select" value={header.paymentTerms} onChange={handleHeaderChange} disabled={!isDocumentEditable}>
                        <option value="">Select</option>
                        {payTermOpts.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>

                    {/* Branch */}
                    <div className="del-field">
                      <label className="del-field__label">Branch *</label>
                      <select name="branch" className={`del-field__select${valErrors.header.branch ? ' del-field__input--error' : ''}`} value={header.branch} onChange={handleHeaderChange} disabled={!!currentDocEntry}>
                        <option value="">Select Branch</option>
                        {refData.branches.map(b => (
                          <option key={b.BPLId} value={b.BPLId}>
                            {b.BPLName}
                          </option>
                        ))}
                      </select>
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
                onOpenBatchModal={openBatchModal}
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
                isEditable={isDocumentEditable}
              />
            )}

            {activeTab === 'Accounting' && (
              <AccountingTab
                header={header}
                onHeaderChange={handleHeaderChange}
                payTermOpts={payTermOpts}
                isEditable={isDocumentEditable}
              />
            )}

            {activeTab === 'Tax' && (
              <TaxTab onOpenTaxInfoModal={openTaxInfoModal} isEditable={isDocumentEditable} />
            )}

            {activeTab === 'Electronic Documents' && (
              <ElectronicDocumentsTab />
            )}

            {activeTab === 'Attachments' && (
              <AttachmentsTab
                attachments={attachments}
                onBrowseAttachment={handleBrowseAttachment}
                isEditable={isDocumentEditable}
              />
            )}

            {/* Continue in next part... */}

            {/* â•â• TOTALS FOOTER â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
            <div className="del-header-card">
              <div className="del-field-grid del-field-grid--summary">
                <div>
                  <div className="del-field">
                    <label className="del-field__label">Sales Employee</label>
                    <select name="purchaser" className="del-field__select" value={header.purchaser || ''} onChange={handleHeaderChange} disabled={!isDocumentEditable}>
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
                    <input name="owner" className="del-field__input" value={header.owner || ''} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
                  </div>
                  <div className="del-field">
                    <label className="del-field__label">Remarks</label>
                    <textarea className="del-textarea" rows={3} name="otherInstruction" value={header.otherInstruction} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
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
                          <td className="del-grid__cell--num"><input className="del-grid__input" name="discount" value={header.discount} onChange={handleHeaderChange} onBlur={() => handleNumBlur('discount', 'header')} disabled={!isDocumentEditable} /></td>
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
                              disabled={!isDocumentEditable}
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
                              disabled={!isDocumentEditable}
                            >
                              ...
                            </button>
                          </td>
                        </tr>
                        <tr>
                          <td><input type="checkbox" className="" name="rounding" checked={header.rounding} onChange={handleHeaderChange} style={{ marginRight: 6 }} disabled={!isDocumentEditable} /><span>Rounding</span></td>
                          <td className='del-grid__cell--num'><DocumentRoundingInput className="del-grid__input" header={header} setHeader={setHeader} formattedAmount={formatDisplayMoney(totals.roundingAmount, numDec.totalPaymentDue)} disabled={!isDocumentEditable} onManualChange={markDirty} /></td>
                        </tr>
                        <tr>
                          <td>Tax</td>
                          <td className="del-grid__cell--num"><input className="del-grid__input" value={formatDisplayMoney(totals.taxAmt, numDec.tax)} readOnly /></td>
                        </tr>
                        {showWTaxSummaryRow && (
                          <tr>
                            <td>WTax Amount</td>
                            <td className="del-grid__cell--num" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input className="del-grid__input" value={formatDisplayMoney(wtaxAmount, numDec.tax)} readOnly style={{ flex: 1 }} />
                              <button
                                type="button"
                                onClick={openWithholdingTaxTable}
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '11px',
                                  border: '1px solid #d0d7de',
                                  borderRadius: '3px',
                                  background: 'linear-gradient(180deg, #f6f8fa 0%, #e9ecef 100%)',
                                  cursor: 'pointer',
                                  minWidth: '24px'
                                }}
                                title="Open Withholding Tax Table"
                                disabled={!isDocumentEditable}
                              >
                                ...
                              </button>
                            </td>
                          </tr>
                        )}
                        <tr style={{ borderTop: '2px solid #a0aab4' }}>
                          <td style={{ fontWeight: 700, color: '#003366' }}>Total Payment Due</td>
                          <td className="del-grid__cell--num" style={{ fontWeight: 700, color: '#003366' }}><input className="del-grid__input" style={{ fontWeight: 700, color: '#003366' }} value={formatDisplayMoney(totalPaymentDueAfterWTax, numDec.totalPaymentDue)} readOnly /></td>
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
                <button type="submit" className="del-btn del-btn--primary" disabled={pageState.posting || !isDocumentEditable}>
                  {secondaryActionLabel}
                </button>
                <button type="button" className="del-btn" onClick={resetForm}>
                  Cancel
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {/* Copy From Dropdown - SAP B1 style */}
                <div className="del-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
                  <button
                    type="button"
                    className="del-btn"
                    disabled={!isDocumentEditable || !!currentDocEntry}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setValErrors({ header: {}, lines: {}, form: '' });
                      setPageState(p => ({ ...p, error: '', success: '' }));
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
                      { key: 'salesQuotation', label: 'Sales Quotations' },
                      { key: 'salesOrder',     label: 'Sales Orders' },
                      { key: 'delivery',       label: 'Deliveries' },
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
                <button 
                  type="button" 
                  className="del-btn"
                  onClick={() => handleCopyTo('arCreditMemo')}
                  disabled={!currentDocEntry}
                  title={!currentDocEntry ? 'Save the AR invoice first' : 'Copy this invoice to A/R Credit Memo'}
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
            showHeaderUdfSettings
            rowUdfFields={rowUdfDefinitions}
            formSettings={formSettings}
          onSettingChange={updateFormSetting}
          onColumnOrderChange={formSettingsStatus.reorder}
            settingsLoaded={companyFormSettingsReady}
            editablePropertiesByGroup={{ matrixColumns: ['visible'], headerUdfs: ['visible'], rowUdfs: ['visible'] }}
            editableSapControlledProperties={{ matrixColumns: ['visible'], headerUdfs: ['visible'], rowUdfs: ['visible'] }}
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
        businessPartners={getSelectableBusinessPartners(refData.vendors, refData.bp_selection_policy)}
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
        allowManualRows={false}
        workspaceRef={formRef}
        onRowsChange={(rows) => setWithholdingTax((prev) => ({
          ...prev,
          rows: recalcWithholdingRows(rows),
        }))}
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
        documentLabel="A/R invoice"
        onLoad={loadExchangeRatesMonth}
        onSave={saveExchangeRateFromModal}
        onClose={() => setExchangeRatesModal((prev) => ({ ...prev, open: false }))}
      />
    </form>
  );
}

export default ARInvoicePage;
