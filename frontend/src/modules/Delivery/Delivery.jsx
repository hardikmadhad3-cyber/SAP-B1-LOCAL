import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount } from '../../utils/documentRounding';
import DocumentRoundingInput from '../../components/sales-document/DocumentRoundingInput';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import './styles/Delivery.css';
import { useLocation, useNavigate } from 'react-router-dom';
import FormSettingsPanel from '../../components/purchase-order/FormSettingsPanel';
import HeaderUdfSidebar from '../../components/purchase-order/HeaderUdfSidebar';
import ContentsTab from './components/ContentsTab';
import LogisticsTab from './components/LogisticsTab';
import AccountingTab from './components/AccountingTab';
import TaxTab from './components/TaxTab';
import ElectronicDocumentsTab from './components/ElectronicDocumentsTab';
import EWayBillModal from './components/EWayBillModal';
import AttachmentsTab from './components/AttachmentsTab';
import ReferenceDocumentsModal from '../sales-order/components/ReferenceDocumentsModal';
import AddressModal from '../../components/document/AddressComponentModal';
import { formatAddressComponent, mapAddressFields, pickAddressComponentFields } from '../../utils/documentAddress';
import TaxInfoModal from './components/TaxInfoModal';
import BatchAllocationModal from './components/BatchAllocationModal';
import InventoryAllocationModal from './components/InventoryAllocationModal';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import HSNCodeModal from '../../components/common/HSNCodeModal';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import QualitySelectionModal from '../sales-order/components/QualitySelectionModal';
import ExchangeRatesIndexesModal from '../sales-order/components/ExchangeRatesIndexesModal';
import FreightChargesModal from '../../components/freight/FreightChargesModal';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import SapGoldenArrowButton from '../../components/document/SapGoldenArrowButton';
import JournalEntryPreviewButton from '../../components/journal-entry/JournalEntryPreviewButton';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import { summarizeFreightRows } from '../../components/freight/freightUtils';
import CopyFromModal from '../../components/document/CopyFromModal';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import useDocumentDraftTask from '../../hooks/useDocumentDraftTask';
import { copyToDocument } from '../../services/documentCopyService';
import { filterWarehousesByBranch, getWarehouseBranchId } from '../../utils/warehouseBranch';
import { hydrateDocumentLineFromItem, mergeItemMaster } from '../../utils/documentItemHydration';
import { getSelectableBusinessPartners, isSelectableBpCode, markResolvedBpLookup } from '../../utils/documentBpSelection';
import { applyUomCodeSelection, getItemDefaultUom, getLineUomOptions } from '../../utils/documentUom';
import { getSapVisibleDocumentSeries, pickDocumentSeries, canUseManualSeries } from '../../utils/seriesDefaults';
import {
  SAP_MANUAL_SERIES_VALUE,
  isManualDocumentSeries,
  isValidManualDocumentNumber,
} from '../../utils/documentSeries';
import { readGeneralSettings } from '../../utils/generalSettingsStorage';
import { useStandardSalesFormSettings } from '../../utils/standardSalesFormSettings';
import { applyCopiedDeliveryQuantities } from './deliveryCopyQuantities';
import { buildCompanyFormQueryContext } from '../../utils/companyFormQueryContext';
import { updateFormSettingPreference } from '../../utils/formSettingsPreferences';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import { convertDocumentAmountForDisplay, inferDocumentCurrencyMode, resolveDisplayCurrency } from '../../utils/documentCurrency';
import { getStateCodeValue, getStateDisplayName } from '../../utils/stateDisplay';
import { findTaxCode, getTaxComponentCodes } from '../../utils/taxCodeComponents';
import { getDocumentLinePayableTax } from '../../utils/documentLineTax';
import { isRouteStateForActiveCompany } from '../../utils/companyStorageScope';
import {
  reloadRouteDocument,
  consumeCopyToState as consumePersistedCopyToState,
  replaceRouteStatePreservingWindow,
} from '../../utils/copyToState';
import { openLinkedBusinessPartner, openLinkedReferenceDocument } from '../../utils/sapLinkedNavigation';
import { buildDuplicateLines, duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import useValidationHighlights from '../../utils/useValidationHighlights';
import useClosedDocumentViewMode from '../../hooks/useClosedDocumentViewMode';
import {
  BATCH_QTY_TOLERANCE,
  getLineUomFactor,
  getRequiredBatchQty,
  sumBatchQty,
} from '../../utils/batchQuantity';
import { determineTaxCode, recalculateAllTaxCodes, getGSTTypeLabel } from '../../utils/taxEngine';
import { useAuth } from '../../auth/AuthContext';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import {
  DELIVERY_LAYOUT_DOCUMENT_TYPE,
  getSapStandardSalesMatrixColumns,
} from '../sales-order/documentLayout';
import { fetchSalesDocumentLookup, fetchSalesDocumentSchema } from '../../api/salesDocumentSchemaApi';
import {
  buildSalesDocumentLiveFields,
  filterLayoutToCurrentSchema,
  getSalesDocumentCompanyScopeKey,
  loadSalesDocumentFieldLookupOptions,
} from '../../utils/salesDocumentLiveFields';
import { buildDeliveryLiveMatrixColumns } from './deliveryLiveMatrix';
import { hydrateWorkbookDocumentLine } from '../../utils/workbookLineHydration';
import { applyDocumentTablePaste } from '../../utils/documentTableClipboard';
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
  fetchOpenArReserveInvoicesForDelivery,
  fetchArReserveInvoiceForDeliveryCopy,
  fetchBatchesByItem,
  fetchFreightCharges,
  validateDeliveryDocument,
  createDeliveryLookupValue,
  saveDeliverySalesEmployeesSetup
} from '../../api/deliveryApi';
import {
  fetchSalesOrderByDocEntry,
  fetchSalesOrderExchangeRates,
  fetchSalesOrderReferenceDocumentLookup,
  saveSalesOrderExchangeRate,
} from '../../api/salesOrderApi';
import { fetchHSNCodeFromItem } from '../../api/hsnCodeApi';
import { deliveryCopyFromApi, normaliseDocumentHeader, normaliseDocumentLine, unwrapCopyFromDocument, BASE_TYPE } from '../../api/copyFromApi';
import {
  FORM_SETTINGS_STORAGE_KEY,
  createUdfState,
  normalizeUdfState,
  readSavedFormSettings,
} from '../../config/deliveryForm';

import useUnsavedChangesWarning, { hasEnteredDocumentLines } from '../../hooks/useUnsavedChangesWarning';
import DocumentStatusActions from '../../components/document/DocumentStatusActions';
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
const today = () => new Date().toISOString().split('T')[0];
const parseNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const firstNonBlank = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};
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

const normalizeCompanyUdfState = (definitions = [], values = {}) => {
  return normalizeUdfState(definitions, values, { preserveExtra: false });
};

const pickLineUdfValues = (source = {}) =>
  Object.entries(source || {}).reduce((acc, [key, value]) => {
    if (String(key || '').toUpperCase().startsWith('U_')) {
      acc[key] = value ?? '';
    }
    return acc;
  }, {});

const normalizeMirrorToken = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^U_/, '')
    .replace(/[^A-Z0-9]/g, '');

const getFieldMirrorTokens = (fieldOrValues) => {
  const values = Array.isArray(fieldOrValues)
    ? fieldOrValues
    : [
        fieldOrValues?.key ?? fieldOrValues,
        fieldOrValues?.sapField,
        fieldOrValues?.aliasId,
        fieldOrValues?.label,
        fieldOrValues?.description,
        fieldOrValues?.Descr,
      ];

  return values.map(normalizeMirrorToken).filter(Boolean);
};

const findMatchingRowUdfKeys = (sourceFieldOrValues, rowUdfDefinitions = []) => {
  const sourceTokens = new Set(getFieldMirrorTokens(sourceFieldOrValues));
  if (!sourceTokens.size) return [];

  return (rowUdfDefinitions || [])
    .filter((field) => getFieldMirrorTokens(field).some((token) => sourceTokens.has(token)))
    .map((field) => field.key)
    .filter(Boolean);
};

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
      udf: mergeUdfValues(
        pickLineUdfValues(detailLine),
        detailLine.udf,
        detailLine.line_udfs,
        detailLine.lineUdfs,
        pickLineUdfValues(line),
        line.udf,
        line.line_udfs,
        line.lineUdfs
      ),
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
const getWarehouseLocationValue = (warehouses = [], warehouseCode = '') => {
  const warehouse = findWarehouse(warehouses, warehouseCode);
  return warehouse?.LocationCode != null ? String(warehouse.LocationCode) : '';
};
const resolveBatchWarehouseCode = (lineWarehouse = '', headerWarehouse = '') =>
  String(headerWarehouse || lineWarehouse || '').trim();
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
const TAX_SENSITIVE_LINE_FIELDS = new Set(['itemNo', 'quantity', 'unitPrice', 'stdDiscount', 'taxCode', 'uomCode']);
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

// â”€â”€â”€ constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEC = { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 };
const TAB_NAMES = ['Contents', 'Logistics', 'Accounting', 'Tax', 'Electronic Documents', 'Attachments'];
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

const DELIVERY_LINE_UPDATE_FIELDS = [
  'lineNum', 'baseEntry', 'baseType', 'baseLine', 'itemNo', 'itemDescription', 'quantity', 'unitPrice',
  'whse', 'uomEntry', 'uomCode', 'taxCode', 'distRule', 'distRule2', 'distRule3', 'distRule4', 'distRule5',
  'cogsDistRule', 'cogsDistRule2', 'cogsDistRule3', 'cogsDistRule4', 'cogsDistRule5', 'glAccount',
  'lineShippingType', 'lineDeliveryDate', 'taxLiable', 'wTaxLiable', 'withoutQtyPosting',
  'loc', 'blanketAgreementNo', 'blanketAgreementLine', 'commPercent', 'freeText', 'hsnCode', 'sacCode',
  'countryOfOrigin', 'specialRebate', 'commission', 'sellerBrokeragePerQty',
  'unitPriceUdf', 'discountAmount', 'sellerBrokerage', 'buyerBrokerage',
  'buyerDelivery', 'sellerDelivery', 'buyerPaymentTerms', 'sellerPaymentTerms',
  'buyerQuality', 'sellerQuality', 'buyerPrice', 'sellerPrice',
  'buyerSpecialInstruction', 'sellerSpecialInstruction', 'sellerBrokerageAmtPer',
  'sellerBrokeragePercent', 'buyerBillDiscount', 'sellerBillDiscount', 'stcode',
  'sellerItem', 'sellerQty', 'freightPurchase', 'freightSales', 'freightProvider',
  'freightProviderName', 'brokerageNumber', 'packingType', 'grossWt', 'totalPackage',
];

const stableSignatureObject = (value) => {
  if (Array.isArray(value)) return value.map(stableSignatureObject);
  if (!value || typeof value !== 'object') return value ?? '';
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableSignatureObject(value[key]);
    return result;
  }, {});
};

const getDeliveryLinesUpdateSignature = (documentLines = []) => JSON.stringify(
  (documentLines || [])
    .filter((line) => String(line?.itemNo || '').trim())
    .map((line) => ({
      ...DELIVERY_LINE_UPDATE_FIELDS.reduce((result, key) => {
        result[key] = line?.[key] ?? '';
        return result;
      }, {}),
      batches: (line?.batches || []).map((batch) => ({
        batchNumber: String(batch?.batchNumber || '').trim(),
        quantity: String(batch?.quantity ?? ''),
      })),
      udf: stableSignatureObject(line?.udf || {}),
    }))
);

const createLine = (rowUdfDefinitions = [], headerUdfsParam = {}) => ({
  itemNo: '', itemDescription: '',
  sellerQuality: '', buyerQuality: '',
  hsnCode: '', quantity: '', unitPrice: '',
  sellerPrice: '', buyerPrice: '',
  sellerDelivery: '', buyerDelivery: '',
  sellerBrokerageAmtPer: '', sellerBrokeragePercent: '',
  sellerBrokerage: '', buyerBrokerage: '',
  specialRebate: '', commission: '', sellerBrokeragePerQty: '', unitPriceUdf: '',
  buyerPaymentTerms: '', sellerPaymentTerms: '', buyerSpecialInstruction: '', sellerSpecialInstruction: '',
  buyerBillDiscount: '', sellerBillDiscount: '', sellerItem: '', sellerQty: '',
  freightPurchase: '', freightSales: '', freightProvider: '', freightProviderName: '',
  brokerageNumber: '',
  uomCode: '', uomEntry: null, stdDiscount: '', stcode: '', taxCode: '', total: '', taxAmount: '', whse: '',
  uomName: '', inStock: '', qtyInWhse: '', price: '', priceAfterDiscount: '', itemCost: '', binLocationAllocation: '',
  distRule: '', distRule2: '', distRule3: '', distRule4: '', distRule5: '',
  cogsDistRule: '', cogsDistRule2: '', cogsDistRule3: '', cogsDistRule4: '', cogsDistRule5: '', glAccount: '',
  freeText: '', countryOfOrigin: '', sacCode: '', blanketAgreementNo: '', blanketAgreementLine: '',
  commPercent: '', grossTotal: '', lineShippingType: '', lineDeliveryDate: '', wTaxLiable: '', taxLiable: '',
  withoutQtyPosting: '', enableSettingCost: '', returnCost: '',
  openQty: '', orderedQty: '', qtyToShip: '', deliveredQty: '', documentCreated: '',
  loc: '', branch: '', lineNum: undefined, baseEntry: null, baseType: null, baseLine: null,
  batchManaged: false, serialManaged: false, binManaged: false,
  batches: [], serialNumbers: [], binAllocations: [],
  hasBatchesAvailable: false, // Track if batches are available for this item-warehouse combo
  inventoryUOM: '', // Base UoM from item master
  uomFactor: 1, // Conversion factor: Document UoM to Base UoM
  // Merge provided header UDFs into line UDF defaults so header values auto-fill matching row UDFs
  udf: mergeUdfValues(createUdfState(rowUdfDefinitions), headerUdfsParam || {}),
});

const needsBatchAllocation = (line = {}) => (
  Boolean(line.batchManaged) &&
  Boolean(String(line.itemNo || '').trim()) &&
  Boolean(String(line.whse || '').trim()) &&
  parseNum(line.quantity) > 0 &&
  (!Array.isArray(line.batches) || line.batches.length === 0) &&
  line.hasBatchesAvailable !== false
);

const clearBaseDocumentLink = (line = {}) => ({
  ...line,
  baseEntry: null,
  baseType: null,
  baseLine: null,
  BaseEntry: null,
  BaseType: null,
  BaseLine: null,
  lineNum: undefined,
  LineNum: undefined,
});

const INIT_HEADER = {
  vendor: '', name: '', contactPerson: '', salesContractNo: '', branch: '', warehouse: '',
  docNo: '', status: 'Open', series: '', nextNumber: '',
  postingDate: today(), deliveryDate: today(), documentDate: today(), contractDate: '',
  branchRegNo: '', shipTo: '', shipToCode: '', payTo: '', payToCode: '',
  shippingType: '', confirmed: undefined, journalRemark: '', paymentTerms: '',
  paymentMethod: '', otherInstruction: '', discount: '', freight: '', tax: '',
  totalPaymentDue: '', rounding: false, owner: '', purchaser: '',
  placeOfSupply: '', currencyMode: 'BP', currency: '', exchangeRate: '', useBillToForTax: false,
  billToAddress: '', billToCode: '', shipToAddress: '',
  shipToAddressComponents: null, billToAddressComponents: null,
  edocGenerationType: 'edocGenerateLater', edocExportFormat: '', edocStatus: '',
  genericEdocGenerationType: 'edocGenerateLater', genericEdocExportFormat: '', genericEdocStatus: '',
  languageCode: '', trackingNo: '', stampNo: '', pickAndPackRemarks: '', bpChannelCode: '', bpChannelContact: '',
  centralBankIndicator: '', projectCode: '', qrCodeSource: '', indicator: '', orderNumber: '',
  consolidationType: '', consolidatingBP: '', useShippedGoodsAccount: false,
  transactionCategory: '', taxFormNo: '', dutyStatus: '', exportFlag: false,
  differentialTaxRate: '100', supplyCovered: false,
};

const normalizeDeliveryReferenceDocuments = (rows = []) => (
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      lineNum: row.lineNum ?? row.LineNum ?? undefined,
      direction: row.direction || 'to',
      transactionType: String(row.transactionType ?? row.referencedObjectType ?? row.RefObjType ?? row.RefType ?? ''),
      docEntry: String(row.docEntry ?? row.referencedDocEntry ?? row.RefDocEntr ?? row.RefDocEntry ?? ''),
      docNumber: String(row.docNumber ?? row.referencedDocNumber ?? row.RefDocNum ?? row.RefDocNo ?? ''),
      extDocNumber: String(row.extDocNumber ?? row.externalDocNumber ?? row.ExtDocNum ?? ''),
      issueDate: row.issueDate || row.IssueDate || '',
      remark: row.remark || row.Remark || row.Comments || '',
    }))
    .filter((row) => String(row.transactionType || row.docNumber || row.docEntry || row.extDocNumber || '').trim())
);
const hasCompleteDeliveryReferenceDocument = (row = {}) => (
  String(row.transactionType || '').trim() &&
  String(row.docEntry || row.docNumber || row.extDocNumber || '').trim()
);

const createInitialHeader = (settings = readGeneralSettings()) => ({
  ...INIT_HEADER,
  warehouse: settings.deliveryWarehouse || '',
  series: settings.deliverySeries || '',
  postingDate: today(),
  deliveryDate: today(),
  documentDate: today(),
});

const INIT_ATTACH = Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, targetPath: '', fileName: '', attachmentDate: '',
  freeText: '', copyToTargetDocument: '', documentType: '', atchDocDate: '', alert: '',
}));

const getBpGstTypeLabel = (value) => ({
  1: 'Regular/TDS/ISD', 2: 'Composition', 3: 'Casual Taxable Person',
  4: 'Government Department', 5: 'Non-Resident Taxable Person',
  6: 'OIDAR', 7: 'TDS', 8: 'TCS', 9: 'UN Embassy/Body',
})[String(value || '')] || String(value || '');

// â”€â”€â”€ Main Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Delivery() {
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
  const isHydratingDocumentRef = useRef(false);
  const loadedLinesSignatureRef = useRef('');
  const handledCopyFromRef = useRef('');
  const copiedLinesNeedBatchOpenRef = useRef(false);
  const copyFromRateAppliedRef = useRef(false);
  const generalSettingsRef = useRef(readGeneralSettings());
  const defaultWarehouseAppliedRef = useRef(false);
  const requestedEditDocEntry = isRouteStateForActiveCompany(location.state) ? (
    location.state?.deliveryDocEntry ||
    location.state?.document?.docEntry ||
    location.state?.document?.DocEntry
  ) : null;
  const staleRequestedEditDocEntry = !requestedEditDocEntry && (
    location.state?.deliveryDocEntry ||
    location.state?.document?.docEntry ||
    location.state?.document?.DocEntry
  );

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(() => createInitialHeader(generalSettingsRef.current));
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState([]);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState([]);
  const [matrixColumnDefinitions, setMatrixColumnDefinitions] = useState(getSapStandardSalesMatrixColumns);
  const [hydratedFieldMetadataScope, setHydratedFieldMetadataScope] = useState('');
  const [lines, setLines] = useState([createLine([])]);
  const [attachments, setAttachments] = useState(INIT_ATTACH);
  const [activeTab, setActiveTab] = useState('Contents');
  const [referenceDocumentsModal, setReferenceDocumentsModal] = useState(false);
  const [referenceDocuments, setReferenceDocuments] = useState([]);
  const [referenceDocumentsChanged, setReferenceDocumentsChanged] = useState(false);
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
    warehouses: [], warehouse_addresses: [], locations: [], company_address: {}, tax_codes: [],
    payment_terms: [], payment_methods: [], shipping_types: [], branches: [], uom_groups: [],
    distribution_rules: [], sales_employees: [], quality_options: { buyer: [], seller: [] }, price_options: { buyer: [], seller: [] },
    decimal_settings: DEC, warnings: [], series: [], states: [], udf_metadata: { header: [], rows: [] },
    eway_bill_formats: [],
    eway_bill_transporters: [],
    eway_bill_options: {},
    local_currency: '', system_currency: '', currencies: [],
    line_field_metadata: { matrix_columns: getSapStandardSalesMatrixColumns(), sap_form: {} },
  });
  const [pageState, setPageState] = useState({ loading: false, vendorLoading: false, posting: false, error: '', success: '', seriesLoading: false });
  const [valErrors, setValErrors] = useState({ header: {}, lines: {}, form: '' });
  useValidationHighlights(valErrors, { rootRef: formRef });
  const [snapshotPending, setSnapshotPending] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [addressModal, setAddressModal] = useState(null);
  const [taxInfoModal, setTaxInfoModal] = useState(false);
  const [batchModal, setBatchModal] = useState({ open: false, lineIndex: null, availableBatches: [], loading: false, error: '' });
  const [inventoryModal, setInventoryModal] = useState({ open: false, lineIndex: null });
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
  const qualityLookupRequest = useRef(0);
  useEffect(() => {
    qualityLookupRequest.current += 1;
    setQualityModal((previous) => ({ ...previous, open: false, options: [] }));
  }, [activeCompanyId, activeCompanyDb]);
  const [freightModal, setFreightModal] = useState({ open: false, freightCharges: [], loading: false });
  const [exchangeRatesModal, setExchangeRatesModal] = useState({
    open: false,
    currency: '',
    postingDate: '',
    initialRate: '',
    loading: false,
    error: '',
    data: null,
  });
  const [salesEmployeeSetup, setSalesEmployeeSetup] = useState({ open: false, rows: [], saving: false });
  const [copyFromModal, setCopyFromModal] = useState(false);
  const [eWayBillModalOpen, setEWayBillModalOpen] = useState(false);
  const [eWayBillDetails, setEWayBillDetails] = useState({});
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
  const isDocumentEditable = !currentDocEntry || ['open', 'unapproved'].includes(String(header.status || '').toLowerCase());
  const documentBodyRef = useRef(null);
  useClosedDocumentViewMode(documentBodyRef, !isDocumentEditable, [activeTab]);
  const hasBuyerCode = Boolean(String(header.vendor || '').trim());
  const isUpdateMode = Boolean(currentDocEntry);
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  useUnsavedChangesWarning(hasUnsavedChanges || (!currentDocEntry && hasEnteredDocumentLines(lines)));
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

  const loadDynamicLineLookupOptions = useCallback((source, field = {}, line = {}) => (
    loadSalesDocumentFieldLookupOptions({
      fetchLookup: fetchSalesDocumentLookup,
      source,
      field,
      line,
      documentType: 'DELIVERY',
      schemaVersion: refData.line_field_metadata?.live_schema?.schemaVersion || '',
    })
  ), [refData.line_field_metadata]);

  useEffect(() => {
    const draft = location.state?.deliveryDraft;
    if (!draft) return;

    setCurrentDocEntry(draft.currentDocEntry || null);
    setHeader(draft.header || createInitialHeader(generalSettingsRef.current));
    setLines(Array.isArray(draft.lines) && draft.lines.length ? draft.lines : [createLine([])]);
    setHeaderUdfs(draft.headerUdfs || {});
    setReferenceDocuments(Array.isArray(draft.referenceDocuments) ? draft.referenceDocuments : []);
    setReferenceDocumentsChanged(Boolean(draft.referenceDocumentsChanged));
    setActiveTab(draft.activeTab || 'Contents');
    setIsDirty(Boolean(draft.isDirty));
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
    deliveryDraft: {
      currentDocEntry,
      header,
      lines,
      headerUdfs,
      referenceDocuments: Array.isArray(overrides.referenceDocuments)
        ? overrides.referenceDocuments
        : referenceDocuments,
      referenceDocumentsChanged: overrides.referenceDocumentsChanged ?? referenceDocumentsChanged,
      referenceDocumentsModalOpen: false,
      freightCharges: freightModal.freightCharges,
      activeTab,
      isDirty,
    },
  }), [activeTab, currentDocEntry, freightModal.freightCharges, header, headerUdfs, isDirty, lines, referenceDocuments, referenceDocumentsChanged, referenceDocumentsModal]);

  useDocumentDraftTask({
    buildDraftState: buildLinkedRestoreState,
    title: 'Delivery',
  });

  const openBusinessPartnerLink = useCallback(() => {
    openLinkedBusinessPartner({
      cardCode: header.vendor,
      sourcePath: location.pathname,
      sourceTitle: `Delivery${header.docNo || currentDocEntry ? ` #${header.docNo || currentDocEntry}` : ''}`,
      sourceRestoreState: buildLinkedRestoreState(),
      navigate,
      upsertTask,
    });
  }, [buildLinkedRestoreState, currentDocEntry, header.docNo, header.vendor, location.pathname, navigate, upsertTask]);

  const resolveReferenceDocEntry = useCallback(async (row) => {
    const currentDocEntryValue = String(row?.docEntry || '').trim();
    if (currentDocEntryValue) return currentDocEntryValue;

    const docNumber = String(row?.docNumber || '').trim();
    const transactionType = String(row?.transactionType || '').trim();
    if (!docNumber || !transactionType) return '';

    const response = await fetchSalesOrderReferenceDocumentLookup({
      transactionType,
      query: docNumber,
      cardCode: '',
      top: 20,
    });
    const exact = (response.data?.options || []).find((option) => (
      String(option.docNumber || '') === docNumber
    ));
    return exact?.docEntry ? String(exact.docEntry) : '';
  }, []);

  const openReferenceDocument = useCallback(async (row, options = {}) => {
    try {
      const docEntry = await resolveReferenceDocEntry(row);
      if (!docEntry) {
        setPageState(p => ({
          ...p,
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
        sourceTitle: `Delivery${header.docNo || currentDocEntry ? ` #${header.docNo || currentDocEntry}` : ''}`,
        sourceRestoreState: buildLinkedRestoreState(options),
        navigate,
        upsertTask,
      });

      if (!opened) {
        setPageState(p => ({
          ...p,
          success: '',
          error: 'This referenced document type is not configured for navigation.',
        }));
      }
      return opened;
    } catch (error) {
      setPageState(p => ({
        ...p,
        success: '',
        error: getErrMsg(error, 'Failed to open referenced document.'),
      }));
      return false;
    }
  }, [buildLinkedRestoreState, currentDocEntry, header.docNo, location.pathname, navigate, resolveReferenceDocEntry, upsertTask]);

  useEffect(() => {
    if (!snapshotPending || !currentDocEntry || pageState.loading || pageState.vendorLoading) return;
    loadedLinesSignatureRef.current = getDeliveryLinesUpdateSignature(lines);
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
    const explicitFactor = Number(
      line?.uomFactor ?? line?.UomFactor ?? line?.NumPerMsr ?? line?.numPerMsr
    );
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
    const batchManaged = isLineBatchManaged(line, item);
    const serialManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(line?.serialManaged ?? line?.SerialManaged ?? item?.SerialManaged ?? '').toUpperCase());
    const lineWarehouse = String(line?.whse || line?.Warehouse || line?.WarehouseCode || line?.WhsCode || '').trim();
    const warehouse = refData.warehouses.find((row) => String(row.WhsCode) === lineWarehouse);
    const binManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(line?.binManaged ?? line?.BinManaged ?? warehouse?.BinActivat ?? '').toUpperCase());
    const workbookLine = hydrateWorkbookDocumentLine({
      line,
      createLine,
      rowUdfDefinitions,
      normalizeUdfState,
      items: refData.items,
    });

    const hydratedLine = {
      ...workbookLine,
      itemNo: itemCode,
      itemDescription: line?.itemDescription || line?.ItemDescription || line?.Dscription || item?.ItemName || '',
      hsnCode: line?.hsnCode || line?.HSNCode || item?.HSNCode || item?.SWW || item?.U_HSNCode || '',
      quantity: String(line?.quantity ?? line?.Quantity ?? ''),
      openQty: String(line?.openQty ?? line?.OpenQuantity ?? line?.OpenQty ?? ''),
      orderedQty: String(line?.orderedQty ?? line?.OrderedQuantity ?? line?.OrderedQty ?? ''),
      qtyToShip: String(line?.qtyToShip ?? line?.QtyToShip ?? ''),
      balanceQty: String(line?.balanceQty ?? line?.BalanceQty ?? ''),
      unitPrice: String(line?.unitPrice ?? line?.UnitPrice ?? line?.Price ?? ''),
      uomName: line?.uomName || line?.UoMName || line?.UomName || line?.UnitMsr || line?.unitMsr || item?.SalesUnit || rawUomCode,
      price: String(firstNonBlank(line?.price, line?.Price, line?.unitPrice, line?.UnitPrice)),
      priceAfterDiscount: String(firstNonBlank(line?.priceAfterDiscount, line?.PriceAfterDiscount)),
      itemCost: String(firstNonBlank(line?.itemCost, line?.ItemCost, line?.StockPrice, line?.stockPrice, item?.ItemCost, item?.AvgPrice)),
      binLocationAllocation: line?.binLocationAllocation || line?.BinLocationAllocation || '',
      sellerPrice: String(line?.sellerPrice ?? line?.SellerPrice ?? ''),
      buyerPrice: String(line?.buyerPrice ?? line?.BuyerPrice ?? ''),
      sellerDelivery: line?.sellerDelivery || line?.SellerDelivery || '',
      buyerDelivery: line?.buyerDelivery || line?.BuyerDelivery || '',
      sellerBrokerageAmtPer: line?.sellerBrokerageAmtPer || line?.SellerBrokerageAmtPer || '',
      sellerBrokeragePercent: String(line?.sellerBrokeragePercent ?? line?.SellerBrokeragePercent ?? ''),
      sellerBrokerage: String(line?.sellerBrokerage ?? line?.SellerBrokerage ?? ''),
      buyerBrokerage: String(line?.buyerBrokerage ?? line?.BuyerBrokerage ?? ''),
      specialRebate: String(line?.specialRebate ?? line?.SpecialRebate ?? ''),
      commission: String(line?.commission ?? line?.Commission ?? ''),
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
      distRule2: line?.distRule2 || line?.DistributionRule2 || line?.OcrCode2 || '',
      distRule3: line?.distRule3 || line?.DistributionRule3 || line?.OcrCode3 || '',
      distRule4: line?.distRule4 || line?.DistributionRule4 || line?.OcrCode4 || '',
      distRule5: line?.distRule5 || line?.DistributionRule5 || line?.OcrCode5 || '',
      cogsDistRule: line?.cogsDistRule || line?.COGSDistributionRule || line?.CogsOcrCod || '',
      freeText: line?.freeText || line?.FreeText || '',
      countryOfOrigin: line?.countryOfOrigin || line?.CountryOfOrigin || '',
      sacCode: line?.sacCode || line?.SACCode || '',
      blanketAgreementNo: String(line?.blanketAgreementNo ?? line?.BlanketAgreementNo ?? ''),
      commPercent: String(line?.commPercent ?? line?.CommissionPercent ?? ''),
      grossTotal: String(line?.grossTotal ?? line?.GrossTotal ?? ''),
      lineShippingType: String(line?.lineShippingType ?? line?.ShippingMethod ?? line?.TrnsCode ?? ''),
      lineDeliveryDate: line?.lineDeliveryDate || line?.DeliveryDate || line?.ShipDate || '',
      wTaxLiable: line?.wTaxLiable ?? line?.WTaxLiable ?? line?.WTLiable ?? '',
      taxLiable: line?.taxLiable ?? line?.TaxLiable ?? line?.TaxOnly ?? '',
      withoutQtyPosting: line?.withoutQtyPosting ?? line?.WithoutQtyPosting ?? '',
      enableSettingCost: line?.enableSettingCost ?? line?.EnableSettingCost ?? '',
      returnCost: String(line?.returnCost ?? line?.ReturnCost ?? ''),
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
      batchManaged,
      batches,
      serialManaged,
      binManaged,
      serialNumbers: Array.isArray(line?.serialNumbers) ? line.serialNumbers : [],
      binAllocations: Array.isArray(line?.binAllocations) ? line.binAllocations : [],
      hasBatchesAvailable: batchManaged ? true : false,
      udf: normalizeCompanyUdfState(
        rowUdfDefinitions,
        mergeUdfValues(pickLineUdfValues(line), workbookLine.udf, line?.line_udfs, line?.lineUdfs, line?.udf)
      ),
    };
    hydratedLine.taxCodeManuallyOverridden = Boolean(
      line?.taxCodeManuallyOverridden ?? String(hydratedLine.taxCode || '').trim()
    );
    return hydratedLine;
  }, [refData.items, rowUdfDefinitions]);

  const openBatchModalForLine = useCallback((lineIndex, line) => {
    if (!line?.itemNo) {
      setPageState(p => ({ ...p, error: 'Select an item before allocating batches.' }));
      return;
    }
    const itemNo = line.itemNo;
    const whse = resolveBatchWarehouseCode(line.whse, header.warehouse);
    if (!whse) {
      setPageState(p => ({ ...p, error: 'Select a warehouse before allocating batches.' }));
      return;
    }

    if (String(line.whse || '').trim() !== whse) {
      setLines(prevLines => prevLines.map((currentLine, currentIndex) => (
        currentIndex === lineIndex
          ? { ...currentLine, whse, batches: [], hasBatchesAvailable: false }
          : currentLine
      )));
    }

    setBatchModal({ open: true, lineIndex, availableBatches: [], loading: true, error: '' });
    window.setTimeout(async () => {
      try {
        const response = await fetchBatchesByItem(itemNo, whse);
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
  }, [header.warehouse]);

  const openBatchModal = useCallback((lineIndex, lineOverride = null) => {
    openBatchModalForLine(lineIndex, lineOverride || lines[lineIndex]);
  }, [lines, openBatchModalForLine]);

  const openInventoryAllocationModal = useCallback((lineIndex) => {
    const line = lines[lineIndex];
    if (!line?.itemNo || !line?.whse) {
      setPageState((state) => ({ ...state, error: 'Select an item and warehouse before allocating inventory.' }));
      return;
    }
    if (line.serialManaged || line.binManaged) setInventoryModal({ open: true, lineIndex });
    else openBatchModal(lineIndex, line);
  }, [lines, openBatchModal]);

  const saveInventoryAllocations = useCallback((allocations) => {
    setLines((rows) => rows.map((row, index) => index === inventoryModal.lineIndex
      ? { ...row, ...allocations }
      : row));
    setInventoryModal({ open: false, lineIndex: null });
  }, [inventoryModal.lineIndex]);

  const refreshBatchAvailabilityForLines = useCallback((nextLines = []) => {
    nextLines.forEach((line, lineIndex) => {
      const whse = resolveBatchWarehouseCode(line?.whse, header.warehouse);
      if (!line?.batchManaged || !line?.itemNo || !whse) return;
      checkBatchAvailability(line.itemNo, whse).then(hasBatches => {
        setLines(prevLines => prevLines.map((currentLine, currentIndex) => (
          currentIndex === lineIndex &&
          currentLine.itemNo === line.itemNo &&
          resolveBatchWarehouseCode(currentLine.whse, header.warehouse) === whse
            ? { ...currentLine, whse, hasBatchesAvailable: hasBatches }
            : currentLine
        )));
      });
    });
  }, [header.warehouse]);

  const openRequiredBatchAllocationOnAdd = useCallback(() => {
    const hydratedLines = lines.map(line => hydrateLoadedLine(line));
    const lineIndex = hydratedLines.findIndex(needsBatchAllocation);
    if (lineIndex < 0) return false;

    setLines(hydratedLines);
    setActiveTab('Contents');
    setValErrors(prev => ({
      ...prev,
      form: 'Please assign batches before adding this delivery.',
      lines: {
        ...prev.lines,
        [lineIndex]: {
          ...(prev.lines[lineIndex] || {}),
          batches: 'Batch selection is mandatory for batch-managed item',
        },
      },
    }));
    setPageState(p => ({
      ...p,
      posting: false,
      error: 'Please assign batches before adding this delivery.',
      success: '',
    }));
    refreshBatchAvailabilityForLines(hydratedLines);
    window.setTimeout(() => openBatchModal(lineIndex, hydratedLines[lineIndex]), 0);
    return true;
  }, [hydrateLoadedLine, lines, openBatchModal, refreshBatchAvailabilityForLines]);

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
            vendors: [], contacts: [], pay_to_addresses: [], ship_to_addresses: [], bill_to_addresses: [],
            items: [], warehouses: [], warehouse_addresses: [], locations: [], company_address: {}, tax_codes: [],
            payment_terms: [], payment_methods: [], shipping_types: [], branches: [], states: [], uom_groups: [],
            distribution_rules: [], sales_employees: [], quality_options: { buyer: [], seller: [] }, price_options: { buyer: [], seller: [] },
            eway_bill_formats: [],
            eway_bill_transporters: [],
            eway_bill_options: {},
            local_currency: '', system_currency: '', currencies: [],
            udf_metadata: { header: [], rows: [] },
            line_field_metadata: { matrix_columns: getSapStandardSalesMatrixColumns(), sap_form: {} },
          }));
          return;
        }

        setHeaderUdfDefinitions([]);
        setRowUdfDefinitions([]);
        setMatrixColumnDefinitions([]);

        const [refDataRes, layoutRes, liveSchema] = await Promise.all([
          fetchDeliveryReferenceData(activeCompanyId),
          getDocumentLayout({
            companyDb: activeCompanyDb || undefined,
            documentType: DELIVERY_LAYOUT_DOCUMENT_TYPE,
            objectType: '15',
            refresh: true,
          }).catch((error) => ({
            data: {
              success: false,
              columns: [],
              warning: getErrMsg(error, 'Failed to load SAP layout.'),
            },
          })),
          fetchSalesDocumentSchema({ documentType: 'DELIVERY' }).catch((error) => {
            console.warn('[Delivery] Live DLN1 schema was not available.', error);
            return null;
          }),
        ]);
        
        if (!ignore) {
          const vendorRows = refDataRes.data.vendors || refDataRes.data.customers || [];
          const sourceMatrixColumns = refDataRes.data.line_field_metadata?.matrix_columns || [];
          const liveFields = buildSalesDocumentLiveFields({
            schema: liveSchema,
            documentType: 'DELIVERY',
            objectType: '15',
            headerTable: 'ODLN',
            lineTable: 'DLN1',
            companyId: activeCompanyId,
            companyDb: activeCompanyDb,
            layoutResponse: layoutRes,
            referenceMatrixColumns: sourceMatrixColumns,
            referenceSapForm: refDataRes.data.line_field_metadata?.sap_form,
            includeLineNumber: false,
          });
          const normalizedSchema = liveFields.liveSchema;
          const schemaLineFields = normalizedSchema?.lineFields || [];
          const nextHeaderUdfs = liveFields.headerUdfFields;
          const nextRowUdfs = liveFields.rowUdfFields;
          const liveMatrixColumns = liveFields.liveAvailable && sourceMatrixColumns.length
            ? sourceMatrixColumns
            : liveFields.matrixColumns;
          const layoutSource = String(layoutRes?.data?.source || '').trim().toLowerCase();
          const realLayoutColumns = layoutSource && layoutSource !== 'fallback'
            ? filterLayoutToCurrentSchema(layoutRes?.data?.columns || [], schemaLineFields)
            : [];
          const nextMatrixColumns = buildDeliveryLiveMatrixColumns({
            schemaLineFields,
            referenceMatrixColumns: liveMatrixColumns,
            rowUdfFields: nextRowUdfs,
            layoutColumns: realLayoutColumns,
          });
          setHeaderUdfDefinitions(nextHeaderUdfs);
          setRowUdfDefinitions(nextRowUdfs);
          setMatrixColumnDefinitions(nextMatrixColumns);
          setHeaderUdfs((prev) => normalizeCompanyUdfState(nextHeaderUdfs, prev));
          setLines((prev) => prev.map((line) => ({
            ...line,
            udf: normalizeCompanyUdfState(nextRowUdfs, line.udf || {}),
          })));
          replaceFormSettings(readSavedFormSettings(
            nextHeaderUdfs,
            nextRowUdfs,
            nextMatrixColumns,
            formSettingsStorageKey,
          ));
          setRefData(prev => ({
            ...prev,
            company: refDataRes.data.company || '',
            local_currency: refDataRes.data.local_currency || '',
            system_currency: refDataRes.data.system_currency || refDataRes.data.local_currency || '',
            currencies: refDataRes.data.currencies || [],
            vendors: vendorRows,
            bp_selection_policy: refDataRes.data.bp_selection_policy || null,
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
            payment_methods: refDataRes.data.payment_methods || [],
            shipping_types: refDataRes.data.shipping_types || [],
            sales_employees: refDataRes.data.sales_employees || [],
            branches: refDataRes.data.branches || [],
            states: refDataRes.data.states || [],
            uom_groups: refDataRes.data.uom_groups || [],
            distribution_rules: refDataRes.data.distribution_rules || [],
            quality_options: refDataRes.data.quality_options || { buyer: [], seller: [] },
            price_options: refDataRes.data.price_options || { buyer: [], seller: [] },
            eway_bill_formats: refDataRes.data.eway_bill_formats || [],
            generic_edoc_formats: refDataRes.data.generic_edoc_formats || [],
            eway_bill_transporters: refDataRes.data.eway_bill_transporters || [],
            eway_bill_options: refDataRes.data.eway_bill_options || {},
            decimal_settings: { ...DEC, ...(refDataRes.data.decimal_settings || {}) },
            warnings: [
              ...(refDataRes.data.warnings || []),
              ...(!liveFields.schemaMatchesCompany && liveSchema ? ['Ignored a Delivery schema belonging to another company.'] : []),
              ...(!liveFields.liveAvailable ? ['Live Delivery field metadata was unavailable; SAP standard fields are shown.'] : []),
              ...(layoutRes?.data?.warning ? [layoutRes.data.warning] : []),
            ],
            udf_metadata: { header: nextHeaderUdfs, rows: nextRowUdfs },
            line_field_metadata: {
              ...(refDataRes.data.line_field_metadata || { sap_form: {} }),
              matrix_columns: nextMatrixColumns,
              source_matrix_columns: liveMatrixColumns,
              imported_layout: {
                ...(layoutRes?.data || {}),
                columns: realLayoutColumns,
              },
              live_schema: normalizedSchema,
              live_available: liveFields.liveAvailable,
            },
            series: Array.isArray(prev.series) ? prev.series : [],
          }));
          setHydratedFieldMetadataScope(activeFieldMetadataScope);
        }
      } catch (e) {
        if (!ignore) {
          const fallbackColumns = getSapStandardSalesMatrixColumns();
          setHeaderUdfDefinitions([]);
          setRowUdfDefinitions([]);
          setMatrixColumnDefinitions(fallbackColumns);
          setHeaderUdfs({});
          setRefData((previous) => ({
            ...previous,
            udf_metadata: { header: [], rows: [] },
            line_field_metadata: {
              matrix_columns: fallbackColumns,
              source_matrix_columns: fallbackColumns,
              sap_form: {},
              imported_layout: null,
              live_schema: null,
            },
          }));
          setHydratedFieldMetadataScope(activeFieldMetadataScope);
          setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load reference data. SAP standard fields are shown.') }));
        }
      } finally {
        if (!ignore) setPageState(p => ({ ...p, loading: false }));
      }
    };
    load();
    return () => { ignore = true; };
  }, [activeCompanyDb, activeCompanyId, activeFieldMetadataScope, formSettingsStorageKey]);

  useEffect(() => {
    if (!companyFormSettingsReady || formSettingsStatus.hasUnsavedChanges) return;
    replaceFormSettings(readSavedFormSettings(
      headerUdfDefinitions,
      rowUdfDefinitions,
      effectiveMatrixColumnDefinitions,
      formSettingsStorageKey,
    ));
  }, [companyFormSettingsReady, effectiveMatrixColumnDefinitions, formSettingsStatus.hasUnsavedChanges, formSettingsStorageKey, headerUdfDefinitions, replaceFormSettings, rowUdfDefinitions]);

  useEffect(() => {
    if (currentDocEntry || requestedEditDocEntry || isHydratingDocumentRef.current) return;

    const eWayBillFormats = refData.eway_bill_formats || [];
    if (!header.edocExportFormat && eWayBillFormats.length) {
      setHeader((current) => ({ ...current, edocExportFormat: String(eWayBillFormats[0].AbsEntry) }));
    }
  }, [currentDocEntry, header.edocExportFormat, refData.eway_bill_formats, requestedEditDocEntry]);



  // â”€â”€ load existing order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (staleRequestedEditDocEntry) {
      setPageState(p => ({ ...p, loading: false, error: '', success: '' }));
      replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
      return;
    }

    const docEntry = requestedEditDocEntry;
    if (!docEntry) return;
    if (hydratedFieldMetadataScope !== activeFieldMetadataScope) return;
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
        const loadedReferenceDocuments = normalizeDeliveryReferenceDocuments(
          so.reference_documents || so.referenceDocuments || []
        );
        const firstLineWarehouse = loadedLines.length > 0
          ? String(
              loadedLines[0]?.whse ||
              loadedLines[0]?.Warehouse ||
              loadedLines[0]?.WarehouseCode ||
              loadedLines[0]?.WhsCode ||
              ''
            )
          : '';
        console.log('ðŸ“¦ [Delivery] Loaded delivery data:', so);
        console.log('ðŸ“¦ [Delivery] Header:', so.header);
        console.log('ðŸ“¦ [Delivery] Lines:', so.lines);
        
        if (ignore || !so) return;
        setCurrentDocEntry(so.doc_entry || Number(docEntry));
        setEWayBillDetails(so.eway_bill_details || {});
        setAttachments(so.attachments?.length ? so.attachments : INIT_ATTACH);
        setReferenceDocuments(loadedReferenceDocuments);
        setReferenceDocumentsChanged(false);
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
        const savedEdocExportFormat = String(so.header?.edocExportFormat || '');
        const isSavedEWayBillFormat = savedEdocExportFormat && (refData.eway_bill_formats || [])
          .some((format) => String(format.AbsEntry) === savedEdocExportFormat);
        const isSavedGenericEdocFormat = savedEdocExportFormat && (refData.generic_edoc_formats || [])
          .some((format) => String(format.AbsEntry) === savedEdocExportFormat);
        const defaultEWayBillFormat = (refData.eway_bill_formats || [])[0]?.AbsEntry;
        setHeader(prev => ({
          ...prev,
          ...INIT_HEADER,
          ...(so.header || {}),
          currencyMode: inferDocumentCurrencyMode({
            currency: so.header?.currency,
            cardCode: so.header?.customerCode || so.header?.customer,
            businessPartners: refData.vendors,
            localCurrency: refData.local_currency,
            systemCurrency: refData.system_currency,
          }),
          vendor: so.header?.customerCode || so.header?.customer || '',
          contactPerson: so.header?.contactPerson || '',
          name: so.header?.customerName || so.header?.name || '',
          paymentTerms: so.header?.paymentTermsCode || so.header?.paymentTerms || '',
          placeOfSupply: so.header?.placeOfSupply || '',
          branch: so.header?.branch || '',
          warehouse: firstLineWarehouse || so.header?.warehouse || '',
          shipToCode: so.header?.shipToCode || '',
          shipToAddress: so.header?.shipToAddress || so.header?.shipTo || '',
          shipToAddressComponents: so.header?.shipToAddressComponents || null,
          shipTo: so.header?.shipTo || so.header?.shipToAddress || '',
          billToCode: so.header?.billToCode || so.header?.payToCode || '',
          billToAddress: so.header?.billToAddress || so.header?.payTo || '',
          billToAddressComponents: so.header?.billToAddressComponents || null,
          payToCode: so.header?.payToCode || so.header?.billToCode || '',
          payTo: so.header?.payTo || so.header?.billToAddress || '',
          docNo: so.header?.docNo || so.header?.docNum || '',
          series: so.header?.series || '',
          nextNumber: so.header?.docNo || so.header?.docNum || '',
          edocGenerationType: so.header?.edocGenerationType || 'edocGenerateLater',
          edocExportFormat: isSavedGenericEdocFormat
            ? (defaultEWayBillFormat != null ? String(defaultEWayBillFormat) : '')
            : savedEdocExportFormat,
          edocStatus: so.header?.edocStatus || '',
          genericEdocGenerationType: so.header?.genericEdocGenerationType || so.header?.edocGenerationType || 'edocGenerateLater',
          genericEdocExportFormat: so.header?.genericEdocExportFormat
            || (isSavedEWayBillFormat ? '' : savedEdocExportFormat),
          genericEdocStatus: so.header?.genericEdocStatus || so.header?.edocStatus || '',
        }));
        
        const hydratedLoadedLines = loadedLines.length
          ? loadedLines.map(l => hydrateLoadedLine({ ...l, branch: l.branch || so.header?.branch || '' }))
          : [createLine(rowUdfDefinitions)];
        loadedLinesSignatureRef.current = getDeliveryLinesUpdateSignature(hydratedLoadedLines);
        setLines(hydratedLoadedLines);
        
        console.log('ðŸ“¦ [Delivery] Lines after mapping:', lines);
        
        setHeaderUdfs(normalizeCompanyUdfState(headerUdfDefinitions, so.header_udfs || {}));
        setSnapshotPending(true);
        setIsDirty(false);
        if (so.header?.customerCode || so.header?.customer) {
          loadVendorDetails(so.header?.customerCode || so.header?.customer, {
            preserveExisting: true,
            selectedBillToCode: so.header?.billToCode || so.header?.payToCode || '',
          });
        }
        
        setPageState(p => ({ ...p, success: location.state?.documentStatusMessage || (so.doc_num ? `Delivery ${so.doc_num} loaded.` : 'Delivery loaded.') }));
      } catch (e) {
        if (!ignore) setPageState(p => ({ ...p, error: getErrMsg(e, 'Failed to load delivery.') }));
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
  }, [activeFieldMetadataScope, hydrateLoadedLine, hydratedFieldMetadataScope, location.pathname, location.state, navigate]);

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

  useEffect(() => {
    if (currentDocEntry || !refData.items.length || !copiedLinesNeedBatchOpenRef.current) return;

    copiedLinesNeedBatchOpenRef.current = false;
    const hydratedLines = lines.map(line => hydrateLoadedLine(line));
    setLines(hydratedLines);
    refreshBatchAvailabilityForLines(hydratedLines);
  }, [
    currentDocEntry,
    hydrateLoadedLine,
    lines,
    refData.items.length,
    refreshBatchAvailabilityForLines,
  ]);

  // â”€â”€ Copy To: populate form from Sales Order / other source â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const routedCopyFrom = location.state?.copyFrom;
    if (routedCopyFrom && !isRouteStateForActiveCompany(location.state)) {
      replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
      return;
    }

    const persistedCopyState = consumePersistedCopyToState(location.pathname, ['/delivery/new', '/delivery']);
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
      warehouses: refData.warehouses || [],
    });

    setCurrentDocEntry(null);
    setEWayBillDetails({});
    setAttachments(INIT_ATTACH);
    setReferenceDocuments([]);
    setReferenceDocumentsChanged(false);
    setReferenceDocumentsModal(false);
    setActiveTab('Contents');
    setSnapshotPending(false);
    setIsDirty(false);
    setValErrors({ header: {}, lines: {}, form: '' });
    setFreightModal({ open: false, freightCharges: Array.isArray(copyFrom.freightCharges) ? copyFrom.freightCharges : [], loading: false });
    setCopyFromModal(false);

    // Populate header for a new Delivery copied from the source document.
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
      warehouse:        copiedLocation.warehouse,
      paymentTerms:     normalizedHeader.paymentTerms || srcHeader.paymentTerms || srcHeader.GroupNum || '',
      placeOfSupply:    normalizedHeader.placeOfSupply || srcHeader.placeOfSupply || '',
      otherInstruction: normalizedHeader.otherInstruction || srcHeader.otherInstruction || srcHeader.Comments || '',
      discount:         srcHeader.discount || '',
      freight:          srcHeader.freight || '',
      tax:              srcHeader.tax || '',
      currency:         srcHeader.currency || refData.local_currency || '',
      currencyMode:     srcHeader.currencyMode || (srcHeader.currency ? 'BP' : 'BP'),
      exchangeRate:     srcHeader.exchangeRate || srcHeader.docRate || srcHeader.DocRate || '',
      shipTo:           srcHeader.shipTo || srcHeader.shipToAddress || '',
      shipToCode:       srcHeader.shipToCode || '',
      shipToAddress:    srcHeader.shipToAddress || srcHeader.shipTo || '',
      payTo:            srcHeader.payTo || srcHeader.billToAddress || '',
      payToCode:        srcHeader.payToCode || srcHeader.billToCode || '',
      billToCode:       srcHeader.billToCode || srcHeader.payToCode || '',
      billToAddress:    srcHeader.billToAddress || srcHeader.payTo || '',
    }));
    setHeaderUdfs(normalizeCompanyUdfState(
      headerUdfDefinitions,
      mergeUdfValues(copyFrom.headerUdfs, copyFrom.header_udfs, srcHeader.header_udfs, srcHeader.headerUdfs)
    ));

    // Populate lines with base document linking
    if (Array.isArray(srcLines) && srcLines.length > 0) {
      const copiedLines = srcLines.map((l, idx) => {
        const normalizedLine = normaliseDocumentLine(
          l,
          idx,
          baseEntry,
          baseType,
          copiedLocation.branch
        );

        return hydrateLoadedLine({
          ...createLine(rowUdfDefinitions),
          ...normalizedLine,
          taxCode: normalizedLine.taxCode || l.taxCode || l.TaxCode || l.VatGroup || '',
          taxCodeManuallyOverridden: Boolean(String(normalizedLine.taxCode || l.taxCode || l.TaxCode || l.VatGroup || '').trim()),
          stcode: normalizedLine.stcode || l.stcode || '',
          branch: normalizedLine.branch || copiedLocation.branch,
          loc: normalizedLine.loc || getWarehouseLocationValue(refData.warehouses, normalizedLine.whse || l.whse || l.WarehouseCode || l.WhsCode || copiedLocation.warehouse),
          whse: normalizedLine.whse || l.whse || l.WarehouseCode || l.WhsCode || copiedLocation.warehouse,
          baseEntry,
          baseType,
          baseLine: l.lineNum ?? l.LineNum ?? normalizedLine.baseLine ?? idx,
          udf: normalizeCompanyUdfState(rowUdfDefinitions, mergeUdfValues(pickLineUdfValues(l), l.line_udfs, l.lineUdfs, l.udf)),
        });
      });
      copiedLinesNeedBatchOpenRef.current = !refData.items.length && copiedLines.some(line => line.itemNo);
      setLines(copiedLines);
      refreshBatchAvailabilityForLines(copiedLines);
    } else {
      copiedLinesNeedBatchOpenRef.current = false;
      setLines([createLine(rowUdfDefinitions)]);
    }

    // Load vendor details to populate contacts/addresses
    const cardCode = normalizedHeader.vendor || srcHeader.vendor || srcHeader.CardCode;
    if (cardCode) loadVendorDetails(cardCode, { preserveExisting: true });

    // Mark that exchange rate was applied from source document (SAP B1 behavior: don't prompt again)
    const copiedRate = srcHeader.exchangeRate || srcHeader.docRate || srcHeader.DocRate || '';
    if (copiedRate) copyFromRateAppliedRef.current = true;

    const sourceLabel = copyFrom.sourceLabel || copyFrom.type || 'source document';
    setPageState(p => ({ ...p, success: `Copied from ${sourceLabel}. Please review and save.` }));

    // Clear state so refresh doesn't re-populate
    replaceRouteStatePreservingWindow(navigate, location.pathname, location.state || persistedCopyState);
  }, [location.pathname, location.state?.copyFrom, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // â”€â”€ derived / computed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const vendorCode = String(header.vendor || '');
  const vendorContacts = useMemo(
    () => refData.contacts.filter(c => String(c.CardCode || '') === vendorCode),
    [refData.contacts, vendorCode]
  );
  const contactOptions = useMemo(
    () => header.contactPerson && !vendorContacts.some(c => String(c.CntctCode || '') === String(header.contactPerson || ''))
      ? [{ CardCode: header.vendor, CntctCode: header.contactPerson, Name: header.contactPerson }, ...vendorContacts]
      : vendorContacts,
    [header.contactPerson, header.vendor, vendorContacts]
  );
  const vendorPayToAddresses = useMemo(
    () => refData.pay_to_addresses.filter(a => String(a.CardCode || '') === vendorCode),
    [refData.pay_to_addresses, vendorCode]
  );
  const vendorShipToAddresses = useMemo(
    () => (refData.ship_to_addresses || []).filter(a => String(a.CardCode || '') === vendorCode),
    [refData.ship_to_addresses, vendorCode]
  );
  const vendorBillToAddresses = useMemo(
    () => (refData.bill_to_addresses || []).filter(a => String(a.CardCode || '') === vendorCode),
    [refData.bill_to_addresses, vendorCode]
  );
  const vendorEffectiveShipToAddresses = useMemo(
    () => vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses,
    [vendorShipToAddresses, vendorPayToAddresses]
  );
  const vendorEffectiveBillToAddresses = useMemo(
    () => vendorBillToAddresses.length ? vendorBillToAddresses : vendorPayToAddresses,
    [vendorBillToAddresses, vendorPayToAddresses]
  );
  const selectedBranch = useMemo(
    () => refData.branches.find(b => String(b.BPLId || '') === String(header.branch || '')),
    [refData.branches, header.branch]
  );
  const hasSelectedBranchOption =
    !normalizeSubmitBranch(header.branch) ||
    refData.branches.some(b => String(b.BPLId || '') === String(header.branch || ''));
  const firstLineWhse = String(lines[0]?.whse || '').trim();
  const selectedWhseAddr = useMemo(
    () => refData.warehouse_addresses.find(w => String(w.WhsCode || '') === firstLineWhse),
    [refData.warehouse_addresses, firstLineWhse]
  );
  const defaultShipTo = useMemo(() => fmtAddr(refData.company_address), [refData.company_address]);
  const effectiveTaxCodes = refData.tax_codes || [];
  const effectiveSalesEmployees = refData.sales_employees.length
    ? refData.sales_employees
    : [{ SlpCode: -1, SlpName: 'No Sales Employee / Buyer', Active: 'Y' }];
  const effectiveWarehouses = useMemo(
    () => refData.warehouses || [],
    [refData.warehouses]
  );
  const branchFilteredWarehouses = useMemo(
    () => filterWarehousesByBranch(effectiveWarehouses, header.branch),
    [effectiveWarehouses, header.branch]
  );
  const freightTotals = summarizeFreightRows(freightModal.freightCharges, effectiveTaxCodes);
  const payTermOpts = (refData.payment_terms || [])
    .map(t => ({ value: String(t.GroupNum), label: t.PymntGroup }));
  const paymentMethodOpts = (refData.payment_methods || []).map(method => ({
    value: String(method.Code || '').trim(),
    label: method.Description
      ? `${method.Code} - ${method.Description}`
      : String(method.Code || '').trim(),
  })).filter(method => method.value);
  const shipTypeOpts = (refData.shipping_types || [])
    .map(s => ({ value: String(s.TrnspCode), label: s.TrnspName }));

  useEffect(() => {
    if (isHydratingDocumentRef.current || currentDocEntry || requestedEditDocEntry || defaultWarehouseAppliedRef.current) return;

    const defaultWarehouse = String(generalSettingsRef.current.deliveryWarehouse || '').trim();
    if (!defaultWarehouse) {
      defaultWarehouseAppliedRef.current = true;
      return;
    }

    if (!effectiveWarehouses.length) return;

    const warehouse = effectiveWarehouses.find((entry) => String(getWarehouseCode(entry) || '') === defaultWarehouse);
    defaultWarehouseAppliedRef.current = true;
    if (!warehouse) return;

    const warehouseBranch = getWarehouseBranchValue(effectiveWarehouses, defaultWarehouse);
    setHeader((prev) => {
      if (prev.warehouse && String(prev.warehouse) !== defaultWarehouse) return prev;
      return {
        ...prev,
        warehouse: prev.warehouse || defaultWarehouse,
        branch: prev.branch || warehouseBranch,
      };
    });
  }, [currentDocEntry, effectiveWarehouses, requestedEditDocEntry]);

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

  const eWayBillLiveData = useMemo(() => {
    const billTo = resolveDeliveryAddress(
      header.billToCode || header.payToCode,
      vendorEffectiveBillToAddresses,
      header.billToAddress || header.payTo,
    ) || vendorEffectiveBillToAddresses[0] || {};
    const shipTo = resolveDeliveryAddress(
      header.shipToCode,
      vendorEffectiveShipToAddresses,
      header.shipToAddress || header.shipTo,
    ) || vendorEffectiveShipToAddresses[0] || {};
    const dispatchFrom = selectedWhseAddr || refData.company_address || {};
    const stateName = (value) => getStateDisplayName(value, refData.states || []);

    return {
      mainHSN: lines.find((line) => String(line.hsnCode || '').trim())?.hsnCode || '',
      billFromName: selectedBranch?.BPLName || refData.company || '',
      billFromGSTIN: selectedBranch?.TaxIdNum || selectedBranch?.GSTRegnNo || refData.company_address?.GSTIN || '',
      billFromState: stateName(selectedBranch?.State || refData.company_address?.State),
      dispatchFromAddress: fmtAddr(dispatchFrom),
      dispatchFromPlace: dispatchFrom.City || dispatchFrom.County || '',
      dispatchFromZipCode: dispatchFrom.ZipCode || '',
      dispatchFromState: stateName(dispatchFrom.State),
      billToName: header.name || '',
      billToGSTIN: billTo.GSTIN || billTo.GSTRegnNo || '',
      billToState: stateName(billTo.State),
      shipToAddress: fmtAddr(shipTo) || header.shipToAddress || header.shipTo || '',
      shipToPlace: shipTo.City || shipTo.County || '',
      shipToZipCode: shipTo.ZipCode || '',
      shipToState: stateName(shipTo.State),
    };
  }, [
    header.billToAddress,
    header.billToCode,
    header.name,
    header.payTo,
    header.payToCode,
    header.shipTo,
    header.shipToAddress,
    header.shipToCode,
    lines,
    refData.company,
    refData.company_address,
    refData.states,
    resolveDeliveryAddress,
    selectedBranch,
    selectedWhseAddr,
    vendorEffectiveBillToAddresses,
    vendorEffectiveShipToAddresses,
  ]);

  const effectiveEWayBillLiveData = useMemo(() => {
    const stateName = (value) => getStateDisplayName(value, refData.states || []);
    const transporter = (refData.eway_bill_transporters || []).find((entry) =>
      String(entry.AbsEntry ?? entry.TspEntry ?? '') === String(eWayBillDetails.transporterEntry ?? ''));
    const savedDetails = { ...eWayBillDetails };
    ['billFromState', 'dispatchFromState', 'billToState', 'shipToState'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(savedDetails, field)) {
        savedDetails[field] = stateName(savedDetails[field]);
      }
    });
    if (transporter || savedDetails.transporterEntry || savedDetails.transporterCode) {
      savedDetails.transporterCode = savedDetails.transporterCode || transporter?.TransCode || '';
      savedDetails.transporterName = savedDetails.transporterName || transporter?.TransName || '';
      savedDetails.transporterId = savedDetails.transporterId || transporter?.TransID || transporter?.GSTIN || '';
    }
    return { ...eWayBillLiveData, ...savedDetails };
  }, [eWayBillDetails, eWayBillLiveData, refData.eway_bill_transporters, refData.states]);

  const saveEWayBillDetails = useCallback(({ udfUpdates = {}, details = {} }) => {
    markDirty();
    setHeaderUdfs((current) => ({ ...current, ...udfUpdates }));
    setEWayBillDetails(details);
  }, [markDirty]);

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
  const documentCurrency = String(header.currency || refData.local_currency || '').trim();
  const displayMode = String(header.currencyMode || 'BP').trim().toUpperCase();
  const displayCurrency = resolveDisplayCurrency({
    mode: displayMode,
    documentCurrency,
    localCurrency: refData.local_currency,
    systemCurrency: refData.system_currency,
  });
  const formatDisplayMoney = (value, decimals) => {
    const converted = convertDocumentAmountForDisplay(value, {
      mode: displayMode,
      documentCurrency,
      localCurrency: refData.local_currency,
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
      const currentPayToCode = String(prev.payToCode || '').trim();
      const existing = vendorPayToAddresses.find(a => String(a.Address || '').trim() === currentPayToCode);
      if (existing) return prev;
      const def = vendorPayToAddresses[0];
      if (!def) return prev;
      const defaultPayToCode = String(def.Address || '').trim();
      const fmt = fmtAddr(def);
      if (!defaultPayToCode && !fmt) return prev;
      if (currentPayToCode === defaultPayToCode && String(prev.payTo || '') === fmt) return prev;
      return { ...prev, payToCode: defaultPayToCode, payTo: fmt };
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
    const { preserveExisting = false, selectedBillToCode = '' } = options;
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
      const selectedTaxAddress = billToAddresses.find((address) => String(address.Address || '') === String(selectedBillToCode || header.billToCode || header.payToCode || '')) || defaultBillToAddress;

      if (selectedTaxAddress) {
        const gstin = String(selectedTaxAddress.GSTIN || '').trim();
        setTaxInfoForm((current) => ({
          ...current,
          panNo: gstin.length >= 12 ? gstin.slice(2, 12) : current.panNo,
          gstType: getBpGstTypeLabel(selectedTaxAddress.GSTType) || current.gstType,
          gstin: gstin || current.gstin,
        }));
      }

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

  const getDefaultJournalRemark = (code) => {
    const normalizedCode = String(code || '').trim();
    return normalizedCode ? `Deliveries - ${normalizedCode}` : '';
  };

  const getDefaultPaymentMethod = (bp = {}) => (
    String(bp.PaymentMethod || bp.PymCode || bp.PeymentMethodCode || '').trim()
  );

  const openExchangeRatesModal = useCallback(({ currency, postingDate, initialRate = '' }) => {
    setExchangeRatesModal({
      open: true,
      currency,
      postingDate,
      initialRate,
      loading: false,
      error: '',
      data: null,
    });
  }, []);

  const loadExchangeRatesMonth = useCallback(async ({ year, month }) => {
    setExchangeRatesModal((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      const response = await fetchSalesOrderExchangeRates({ year, month });
      setExchangeRatesModal((previous) => ({
        ...previous,
        loading: false,
        error: '',
        data: response.data,
      }));
    } catch (error) {
      setExchangeRatesModal((previous) => ({
        ...previous,
        loading: false,
        error: getErrMsg(error, 'Failed to load exchange rates.'),
        data: buildExchangeRatesFallbackData({
          year,
          month,
          currencies: refData.currencies,
          localCurrency: refData.local_currency,
          documentCurrency: exchangeRatesModal.currency,
        }),
      }));
    }
  }, [exchangeRatesModal.currency, refData.currencies, refData.local_currency]);

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
      setExchangeRatesModal((previous) => ({ ...previous, error: 'Enter a positive exchange rate.' }));
      return;
    }

    setExchangeRatesModal((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      const savedEntries = [];
      for (const entry of entries) {
        const saved = await saveSalesOrderExchangeRate(entry);
        savedEntries.push({
          ...entry,
          rate: Number(saved.data?.rate) || entry.rate,
        });
      }
      setHeader((previous) => {
        const documentRate = savedEntries.find((entry) => (
          String(entry.currency).toUpperCase() === String(previous.currency).toUpperCase()
          && String(entry.postingDate) === String(previous.postingDate)
        ));
        return documentRate ? { ...previous, exchangeRate: String(documentRate.rate) } : previous;
      });
      setExchangeRatesModal((previous) => ({ ...previous, open: false, loading: false, error: '' }));
      setPageState((previous) => ({ ...previous, error: '', success: '' }));
    } catch (error) {
      if (Number(error?.response?.status) === 404) {
        setHeader((previous) => {
          const documentRate = entries.find((entry) => (
            String(entry.currency).toUpperCase() === String(previous.currency).toUpperCase()
            && String(entry.postingDate) === String(previous.postingDate)
          ));
          return documentRate ? { ...previous, exchangeRate: String(documentRate.rate) } : previous;
        });
        setExchangeRatesModal((previous) => ({ ...previous, open: false, loading: false, error: '' }));
        return;
      }
      setExchangeRatesModal((previous) => ({
        ...previous,
        loading: false,
        error: getErrMsg(error, 'Failed to save exchange rates.'),
      }));
    }
  }, []);

  const refreshExchangeRate = useCallback((nextCurrency = header.currency, nextDate = header.postingDate) => {
    const currency = String(nextCurrency || '').trim();
    const postingDate = String(nextDate || '').trim();
    const localCurrency = String(refData.local_currency || '').trim();
    if (!currency || !postingDate || !localCurrency) {
      return;
    }
    if (currency === localCurrency) {
      setHeader((previous) => previous.exchangeRate ? { ...previous, exchangeRate: '' } : previous);
      return;
    }
    if (!header.exchangeRate) {
      // SAP B1 behavior: if the rate was carried from the source document (copy-to),
      // don't prompt for it again. Only prompt when no rate exists at all.
      if (copyFromRateAppliedRef.current) {
        copyFromRateAppliedRef.current = false;
        return;
      }
      openExchangeRatesModal({ currency, postingDate, initialRate: '' });
    }
  }, [header.currency, header.exchangeRate, header.postingDate, openExchangeRatesModal, refData.local_currency]);

  useEffect(() => {
    if (currentDocEntry || !header.vendor || !header.currency || !header.postingDate) return;
    refreshExchangeRate(header.currency, header.postingDate);
  }, [currentDocEntry, header.currency, header.postingDate, header.vendor, refreshExchangeRate]);

  const syncVendor = (code, hdr) => {
    const m = refData.vendors.find(v => String(v.CardCode || '') === String(code || ''));
    if (!m) return { nextHeader: hdr };
    return {
      nextHeader: {
        ...hdr,
        name: m.CardName || hdr.name,
        journalRemark: getDefaultJournalRemark(code),
        paymentTerms: m.PayTermsGrpCode != null ? String(m.PayTermsGrpCode) : hdr.paymentTerms,
        paymentMethod: getDefaultPaymentMethod(m) || hdr.paymentMethod,
        currency: (
          String(m.Currency || m.CardCurrency || '').trim() !== '##'
            ? String(m.Currency || m.CardCurrency || '').trim()
            : ''
        ) || refData.local_currency || hdr.currency,
        exchangeRate: '',
        contactPerson: '',
      },
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
    
    console.log('ðŸ”§ [Delivery] handleHeaderChange called:', { name, value, type });
    
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
      markResolvedBpLookup(e.target, value, refData.vendors, refData.bp_selection_policy);
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
      setHeader((previous) => ({ ...previous, currencyMode: value }));
      return;
    }

    if (name === 'currency') {
      setHeader((previous) => ({
        ...previous,
        currency: String(value || '').trim(),
        exchangeRate: '',
      }));
      return;
    }

    if (name === 'postingDate') {
      setHeader((previous) => ({
        ...previous,
        postingDate: value,
        exchangeRate: String(previous.currency || '').trim() === String(refData.local_currency || '').trim()
          ? previous.exchangeRate
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
      console.log('ðŸ¢ [Delivery] Branch changing to:', value);
      // Clear warehouse when branch changes since it might not belong to the new branch
      setHeader(p => ({ ...p, [name]: value, warehouse: '' }));
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
            const next = clearBaseDocumentLink({ ...line, itemNo: value, taxAmount: '', taxCodeManuallyOverridden: false });
            
            // Reset batches
            next.batches = [];
            next.batchManaged = isBatchManaged(item);
            next.hasBatchesAvailable = false;
            
            // Step 1: Set Item Details
            next.itemDescription = item.ItemName || next.itemDescription;
            Object.assign(next, getItemDefaultUom(item, refData.uom_groups, 'sales'));
            next.itemCost = item.ItemCost != null ? String(item.ItemCost) : (item.AvgPrice != null ? String(item.AvgPrice) : next.itemCost || '');
            next.price = next.unitPrice || next.price || '';

            if (next.batchManaged && next.whse) {
              checkBatchAvailability(next.itemNo, next.whse).then(hasBatches => {
                setLines(prevLines => prevLines.map((l, lIdx) =>
                  lIdx === i ? { ...l, hasBatchesAvailable: hasBatches } : l
                ));
              });
            }
            
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
          const next = clearBaseDocumentLink({ ...line, itemNo: value, taxAmount: '', taxCodeManuallyOverridden: false });
          const item = refData.items.find(it => String(it.ItemCode || '') === String(value || ''));
          next.batches = [];
          next.serialNumbers = [];
          next.binAllocations = [];
          next.batchManaged = isBatchManaged(item);
          next.serialManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(item?.SerialManaged || item?.ManSerNum || '').toUpperCase());
          const selectedWarehouse = refData.warehouses.find((row) => String(row.WhsCode) === String(next.whse || ''));
          next.binManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(selectedWarehouse?.BinActivat || '').toUpperCase());
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
            Object.assign(next, getItemDefaultUom(item, refData.uom_groups, 'sales'));
            next.itemCost = item.ItemCost != null ? String(item.ItemCost) : (item.AvgPrice != null ? String(item.AvgPrice) : next.itemCost || '');
            next.price = next.unitPrice || next.price || '';
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
      if (name === 'uomCode') {
        const item = refData.items.find(it => String(it.ItemCode || '') === String(next.itemNo || ''));
        Object.assign(next, applyUomCodeSelection(next, value, getLineUomOptions(next, item, refData.uom_groups)));
      }
      if (TAX_SENSITIVE_LINE_FIELDS.has(name)) {
        next.taxAmount = '';
      }
      if (name === 'quantity' && String(value) !== String(line.quantity)) {
        next.batches = [];
        next.serialNumbers = [];
        next.binAllocations = [];
      }
      
      // Handle warehouse change
      if (name === 'whse') {
        next.batches = [];
        next.serialNumbers = [];
        next.binAllocations = [];
        const selectedWarehouse = refData.warehouses.find((row) => String(row.WhsCode) === String(value || ''));
        next.loc = selectedWarehouse?.LocationCode != null ? String(selectedWarehouse.LocationCode) : '';
        next.binManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(selectedWarehouse?.BinActivat || '').toUpperCase());
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
        next.batches = [];
        next.serialNumbers = [];
        next.binAllocations = [];
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
      if (name === 'taxCode') {
        next.taxCodeManuallyOverridden = Boolean(String(next.taxCode || '').trim());
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
      if (field === 'quantity' && l.batchManaged && Array.isArray(l.batches) && l.batches.length > 0) {
        return { ...l, [field]: String(roundTo(parseNum(l[field]), Math.max(d, 6))) };
      }
      return { ...l, [field]: fmtDec(l[field], d) };
    }));
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
        const next = hydrateLoadedLine(pastedLine);
        if (pastedKeys.has('uomCode')) {
          const item = refData.items.find(candidate => String(candidate.ItemCode || '') === String(next.itemNo || ''));
          Object.assign(next, applyUomCodeSelection(next, next.uomCode, getLineUomOptions(next, item, refData.uom_groups)));
        }
        if (pastedKeys.has('taxCode')) next.taxCodeManuallyOverridden = Boolean(String(next.taxCode || '').trim());
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
    
    console.log('âž• [Delivery] Adding new line with header values:', {
      branch: header.branch,
      loc: getWarehouseLocationValue(refData.warehouses, header.warehouse),
      whse: header.warehouse
    });
    
    setLines(p => [...p, { 
      ...createLine(rowUdfDefinitions, headerUdfs), 
      branch: header.branch || '', 
      loc: getWarehouseLocationValue(refData.warehouses, header.warehouse),
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
    // Auto-fill existing lines' UDFs when header UDF value is provided and line UDF is empty
    if (hasUdfValue(v)) {
      const headerField = headerUdfDefinitions.find((field) => field.key === k) || { key: k };
      const targetKeys = new Set(findMatchingRowUdfKeys(headerField, rowUdfDefinitions));
      if (rowUdfDefinitions.some((field) => field.key === k)) targetKeys.add(k);

      setLines(prev => prev.map((l) => {
        const current = l.udf || {};
        const updates = {};
        targetKeys.forEach((targetKey) => {
          if (!hasUdfValue(current[targetKey])) updates[targetKey] = v;
        });
        return Object.keys(updates).length ? { ...l, udf: mergeUdfValues(current, updates) } : l;
      }));
    }
  };
  const handleRowUdfChange = (i, k, v) => {
    markDirty();
    setLines(p => p.map((l, idx) => {
      if (idx !== i) return l;
      const mirroredUdf = String(k || '').startsWith('U_') ? { [k]: v } : {};
      return { ...l, ...mirroredUdf, udf: { ...(l.udf || {}), [k]: v } };
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
        shipToCode: addressForm.shipToCode,
        shipTo: formatted,
        shipToAddress: formatted,
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
        billToCode: addressForm.billToCode,
        payToCode: addressForm.billToCode,
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
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
      const files = Array.from(e.target.files);
      alert(`Selected ${files.length} file(s). Upload functionality to be implemented.`);
    };
    input.click();
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
      const selectedBatchWarehouse = String(
        nextBatches.find(batch => String(batch?.whse || batch?.warehouse || '').trim())?.whse
        || nextBatches.find(batch => String(batch?.whse || batch?.warehouse || '').trim())?.warehouse
        || ''
      ).trim();
      const nextDocumentQty = uomFactor > 0
        ? roundTo(assignedBaseQty / uomFactor, 6)
        : roundTo(assignedBaseQty, 6);
      const updatedLine = {
        ...line,
        whse: selectedBatchWarehouse || line.whse,
        batches: nextBatches,
        hasBatchesAvailable: true,
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
    const sourceTerms = (refData.payment_terms || []).map((term) => ({
      code: String(term.GroupNum ?? ''),
      name: term.PymntGroup || String(term.GroupNum ?? ''),
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
      options: [],
      searchPlaceholder: nextConfig.searchPlaceholder,
      emptyMessage: 'Loading this company’s SAP values...',
      allowCreate: nextConfig.allowCreate !== false,
    });
    const aliasByField = {
      buyerQuality: 'U_Buyer_Quality', sellerQuality: 'U_Seller_Quality',
      buyerPrice: 'U_Buyer_Price', sellerPrice: 'U_Seller_Price',
    };
    const alias = aliasByField[field];
    if (!alias) {
      setQualityModal((previous) => ({ ...previous, options: nextConfig.options, emptyMessage: nextConfig.emptyMessage }));
      return;
    }
    const currentRequest = ++qualityLookupRequest.current;
    loadSalesDocumentFieldLookupOptions({
      fetchLookup: fetchSalesDocumentLookup,
      source: 'udf-valid-values',
      field: { id: `DLN1.${alias}` },
      documentType: 'DELIVERY',
    }).then((options) => {
      if (qualityLookupRequest.current !== currentRequest) return;
      setQualityModal((previous) => ({ ...previous, options, emptyMessage: nextConfig.emptyMessage }));
    }).catch((error) => {
      if (qualityLookupRequest.current !== currentRequest) return;
      setQualityModal((previous) => ({ ...previous, options: [], emptyMessage: error?.response?.data?.detail || 'Unable to load this company’s SAP values.' }));
    });
  };

  const closeQualityModal = () => {
    qualityLookupRequest.current += 1;
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

  const openReferenceDocumentsModal = () => {
    setReferenceDocumentsModal(true);
  };

  const closeReferenceDocumentsModal = () => {
    setReferenceDocumentsModal(false);
  };

  const saveReferenceDocumentsModal = (rows) => {
    setReferenceDocuments(normalizeDeliveryReferenceDocuments(rows));
    setReferenceDocumentsChanged(true);
    markDirty();
    setReferenceDocumentsModal(false);
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
      isBatchManaged: isBatchManaged(item),
      SalesUnit: item.SalesUnit,
      InventoryUOM: item.InventoryUOM
    });
    
    try {
      const hsnRes = await fetchHSNCodeFromItem(mergedItem.ItemCode);
      const hsnData = hsnRes.data;
      
      // Get the current line to check warehouse
      const currentLine = lines[lineIndex];
      const itemIsBatchManaged = isBatchManaged(mergedItem);
      const itemIsSerialManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(mergedItem.SerialManaged || mergedItem.ManSerNum || '').toUpperCase());
      const selectedWarehouse = refData.warehouses.find((row) => String(row.WhsCode) === String(currentLine.whse || header.warehouse));
      const warehouseIsBinManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(selectedWarehouse?.BinActivat || '').toUpperCase());
      
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
          const updatedLine = clearBaseDocumentLink({
            ...hydrateDocumentLineFromItem(line, mergedItem, {
              side: 'sales',
              hsnCode: hsnData.hsnCode || hsnData.hsn_sww || '',
              fallbackWarehouse: header.warehouse,
              syncUnitPriceUdf: false,
              calcLineTotal,
              formatTotal: (value) => fmtDec(value, numDec.total),
              uomGroups: refData.uom_groups,
            }),
            uomCode: displayUoM, // Use the validated UoM for display
            uomName: mergedItem.SalesUnit || displayUoM || mergedItem.InventoryUOM || '',
            itemCost: mergedItem.ItemCost != null ? String(mergedItem.ItemCost) : (mergedItem.AvgPrice != null ? String(mergedItem.AvgPrice) : ''),
            price: line.unitPrice || '',
            batches: [],
            serialNumbers: [],
            binAllocations: [],
            batchManaged: itemIsBatchManaged,
            serialManaged: itemIsSerialManaged,
            binManaged: warehouseIsBinManaged,
            hasBatchesAvailable: itemIsBatchManaged ? hasBatchesAvailable : false,
            inventoryUOM: inventoryUOM,
            uomFactor: uomFactor,
            taxAmount: '',
          });
          
          console.log('ðŸ“ [handleItemSelect] Updated line:', {
            itemNo: updatedLine.itemNo,
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
      const itemIsBatchManaged = isBatchManaged(mergedItem);
      const itemIsSerialManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(mergedItem.SerialManaged || mergedItem.ManSerNum || '').toUpperCase());
      const selectedWarehouse = refData.warehouses.find((row) => String(row.WhsCode) === String(currentLine.whse || header.warehouse));
      const warehouseIsBinManaged = ['Y', 'YES', '1', 'TRUE'].includes(String(selectedWarehouse?.BinActivat || '').toUpperCase());
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
          const updatedLine = clearBaseDocumentLink({
            ...hydrateDocumentLineFromItem(line, mergedItem, {
              side: 'sales',
              hsnCode: mergedItem.HSNCode || '',
              fallbackWarehouse: header.warehouse,
              syncUnitPriceUdf: false,
              calcLineTotal,
              formatTotal: (value) => fmtDec(value, numDec.total),
              uomGroups: refData.uom_groups,
            }),
            uomCode: selectedUoM,
            uomName: mergedItem.SalesUnit || selectedUoM || mergedItem.InventoryUOM || '',
            itemCost: mergedItem.ItemCost != null ? String(mergedItem.ItemCost) : (mergedItem.AvgPrice != null ? String(mergedItem.AvgPrice) : ''),
            price: line.unitPrice || '',
            batches: [],
            serialNumbers: [],
            binAllocations: [],
            batchManaged: itemIsBatchManaged,
            serialManaged: itemIsSerialManaged,
            binManaged: warehouseIsBinManaged,
            hasBatchesAvailable: itemIsBatchManaged ? hasBatchesAvailable : false,
            inventoryUOM: inventoryUOM,
            uomFactor: uomFactor,
            taxAmount: '',
          });
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
    console.log('ðŸ”„ [Delivery] Branch sync useEffect triggered');
    console.log('ðŸ”„ [Delivery] header.branch value:', header.branch);
    console.log('ðŸ”„ [Delivery] header.branch type:', typeof header.branch);
    console.log('ðŸ”„ [Delivery] Current lines count:', lines.length);
    
    if (!header.branch || !lines.some(l => String(l.branch || '') !== String(header.branch))) return;

    if (header.branch) {
      console.log('ðŸ”„ [Delivery] Syncing branch to all lines:', header.branch);
      setLines(prev => {
        console.log('ðŸ”„ [Delivery] Previous lines:', prev.map(l => ({ itemNo: l.itemNo, branch: l.branch, loc: l.loc })));
        const updated = prev.map(l => ({ 
          ...l, 
          branch: String(header.branch)
        }));
        console.log('âœ… [Delivery] Updated lines:', updated.map(l => ({ itemNo: l.itemNo, branch: l.branch, loc: l.loc })));
        return updated;
      });
    } else {
      console.log('âš ï¸ [Delivery] Branch is empty, skipping sync');
    }
  }, [header.branch, lines]);
  
  // Initial sync: Set branch on existing lines when branch is first loaded
  useEffect(() => {
    if (isHydratingDocumentRef.current) return;
    if (header.branch && lines.length > 0) {
      const needsSync = lines.some(l => !l.branch || l.branch !== String(header.branch));
      if (needsSync) {
        console.log('ðŸ”„ [Delivery] Initial branch sync needed');
        setLines(prev => prev.map(l => ({ 
          ...l, 
          branch: String(header.branch)
        })));
      }
    }
  }, [refData.branches]); // Trigger when branches are loaded

  useEffect(() => {
    if (isHydratingDocumentRef.current) return;
    if (!header.branch || !refData.warehouses.length) return;

    const allowedWarehouseCodes = new Set(
      branchFilteredWarehouses.map(w => String(w.WhsCode || ''))
    );

    setLines(prev => {
      let changed = false;
      const nextLines = prev.map(line => {
        if (!line.whse || allowedWarehouseCodes.has(String(line.whse))) {
          return line;
        }
        changed = true;
        return { ...line, whse: '', hasBatchesAvailable: false, batches: [] };
      });
      return changed ? nextLines : prev;
    });
  }, [branchFilteredWarehouses, header.branch, refData.warehouses.length]);

  // Sync warehouse to all lines when header warehouse changes and refresh batch availability
  useEffect(() => {
    if (isHydratingDocumentRef.current) return;
    if (!header.warehouse) {
      setLines(prev => {
        let changed = false;
        const nextLines = prev.map(l => {
          if (!l.whse && !l.hasBatchesAvailable && (!Array.isArray(l.batches) || l.batches.length === 0)) {
            return l;
          }
          changed = true;
          return { ...l, whse: '', loc: '', hasBatchesAvailable: false, batches: [] };
        });
        return changed ? nextLines : prev;
      });
      return;
    }

    setLines(prev => {
      let changed = false;
      const nextLines = prev.map((line, index) => {
      const next = { ...line, whse: header.warehouse,
        loc: line.whse === header.warehouse ? line.loc : getWarehouseLocationValue(refData.warehouses, header.warehouse) };

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

      if (
        line.whse === next.whse && line.loc === next.loc &&
        line.hasBatchesAvailable === next.hasBatchesAvailable &&
        JSON.stringify(line.batches || []) === JSON.stringify(next.batches || [])
      ) {
        return line;
      }
      changed = true;
      return next;
      });
      return changed ? nextLines : prev;
    });
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
  const validate = async ({ validateDocumentLines = true } = {}) => {
    const isUpdate = !!currentDocEntry;
    const e = { header: {}, lines: {}, form: '' };

    if (!isUpdate && isManualDocumentSeries(header.series) && !isValidManualDocumentNumber(header.nextNumber)) {
      e.header.nextNumber = 'Enter a positive document number for Manual series.';
      e.form = 'Please correct the highlighted fields.';
      return e;
    }
    
    // Frontend basic validation first
    if (!isUpdate) {
      const vc = String(header.vendor || '').trim();
      if (!vc) { e.header.vendor = 'Select a customer.'; e.form = 'Please correct the highlighted fields.'; return e; }
      if (!isSelectableBpCode(vc, refData.bp_selection_policy)) {
        e.header.vendor = `Use ${refData.bp_selection_policy.preferredCardCode} for this customer.`;
        e.form = 'Please correct the highlighted fields.';
        return e;
      }
    }
    
    if (!String(header.postingDate || '').trim()) { e.header.postingDate = 'Posting date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (!String(header.documentDate || '').trim()) { e.header.documentDate = 'Document date is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    if (!String(header.warehouse || '').trim()) { e.header.warehouse = 'Warehouse is required.'; e.form = 'Please correct the highlighted fields.'; return e; }
    for (const field of headerUdfDefinitions.filter(field => field.required)) {
      if (!String(headerUdfs[field.key] ?? '').trim()) {
        e.header[field.key] = `${field.label || field.key} is required.`;
        e.form = 'Please complete required UDF fields.';
        return e;
      }
    }

    const pop = lines.filter(l => String(l.itemNo || '').trim());
    if (validateDocumentLines && !pop.length) { e.form = 'Add at least one item line.'; return e; }
    
    for (let i = 0; validateDocumentLines && i < lines.length; i++) {
      const l = lines[i];
      if (!String(l.itemNo || '').trim()) continue;
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

      if (!l.whse && !isUpdate) {
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
      if (!isUpdate && l.batchManaged && l.hasBatchesAvailable !== false) {
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
      if (!isUpdate && l.serialManaged) {
        const requiredSerials = getRequiredBatchQty(l);
        if (!Number.isInteger(requiredSerials) || (l.serialNumbers || []).length !== requiredSerials) {
          e.lines[i] = { ...(e.lines[i] || {}), batches: `Assign ${requiredSerials} serial number(s)` };
          e.form = 'Please correct the highlighted fields.';
          return e;
        }
      }
      if (!isUpdate && l.binManaged) {
        const requiredBinQty = getRequiredBatchQty(l);
        const allocatedBinQty = (l.binAllocations || []).reduce((sum, row) => sum + parseNum(row.quantity), 0);
        if (Math.abs(requiredBinQty - allocatedBinQty) > BATCH_QTY_TOLERANCE) {
          e.lines[i] = { ...(e.lines[i] || {}), batches: `Bin allocation must equal ${requiredBinQty}` };
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
        _isUpdate: isUpdate,
        validateDocumentLines,
                        header: {
                          customerCode: header.vendor,
                          postingDate: header.postingDate,
                          documentDate: header.documentDate,
                          branch: submitBranch,
                          series: header.series,
                          nextNumber: header.nextNumber,
                        },
        lines: lines.filter(l => String(l.itemNo || '').trim()).map(l => ({
          itemNo: l.itemNo,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          hsnCode: l.hsnCode,
           whse: l.whse,
           taxCode: l.taxCode,
           uomCode: l.uomCode,
           uomName: l.uomName,
           uomEntry: l.uomEntry,
           uomNameEdited: l.uomNameEdited,
           uomFactor: l.uomFactor,
          inventoryUOM: l.inventoryUOM,
          baseEntry: l.baseEntry,
          baseType: l.baseType,
          baseLine: l.baseLine,
          batchManaged: l.batchManaged,
          batches: l.batches || [],
          serialManaged: l.serialManaged,
          serialNumbers: l.serialNumbers || [],
          binManaged: l.binManaged,
          binAllocations: l.binAllocations || [],
          udf: l.udf || {},
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
        e.form = getErrMsg(validationError, 'Delivery validation failed.');
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

    const copiedFreight = summarizeFreightRows(unwrapCopyFromDocument(data).freightCharges, effectiveTaxCodes);
    setFreightModal({ open: false, freightCharges: copiedFreight.rows, loading: false });
    const sourceDocument = data || {};
    const unwrappedDocument =
      sourceDocument.sales_order ||
      sourceDocument.salesOrder ||
      sourceDocument.sales_quotation ||
      sourceDocument.salesQuotation ||
      sourceDocument.ar_reserve_invoice ||
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
      warehouses: refData.warehouses || [],
    });

    setHeader(prev => ({
      ...prev,
      ...normHeader,
      deliveryDate: toDateInputValue(srcHeader.deliveryDate || srcHeader.DocDueDate || prev.deliveryDate || ''),
      vendor: normHeader.vendor || srcHeader.customerCode || srcHeader.customer || srcHeader.CardCode || '',
      name: normHeader.name || srcHeader.customerName || srcHeader.name || srcHeader.CardName || '',
      contactPerson: normHeader.contactPerson || srcHeader.contactPerson || srcHeader.CntctCode || '',
      branch: copiedLocation.branch,
      warehouse: copiedLocation.warehouse || prev.warehouse || '',
      paymentTerms: normHeader.paymentTerms || srcHeader.paymentTerms || srcHeader.GroupNum || '',
      placeOfSupply: normHeader.placeOfSupply || srcHeader.placeOfSupply || srcHeader.PlaceOfSupply || '',
      salesContractNo: srcHeader.salesContractNo || srcHeader.customerRefNo || srcHeader.NumAtCard || '',
      otherInstruction: normHeader.otherInstruction || srcHeader.otherInstruction || srcHeader.remarks || srcHeader.Comments || '',
      discount: srcHeader.discount || srcHeader.DiscPrcnt || '',
      freight: fmtDec(copiedFreight.totalNet, numDec.freight),
      tax: srcHeader.tax || srcHeader.TaxAmount || '',
      currency: srcHeader.currency || srcHeader.DocCur || prev.currency || refData.local_currency || '',
      exchangeRate: srcHeader.exchangeRate || srcHeader.DocRate || prev.exchangeRate || '',
      shipTo: srcHeader.shipTo || srcHeader.shipToAddress || srcHeader.Address || '',
      shipToCode: srcHeader.shipToCode || srcHeader.ShipToCode || '',
      shipToAddress: srcHeader.shipToAddress || srcHeader.shipTo || srcHeader.Address || '',
      payTo: srcHeader.payTo || srcHeader.billToAddress || srcHeader.Address2 || '',
      payToCode: srcHeader.payToCode || srcHeader.billToCode || srcHeader.PayToCode || '',
      billToCode: srcHeader.billToCode || srcHeader.payToCode || srcHeader.PayToCode || '',
      billToAddress: srcHeader.billToAddress || srcHeader.payTo || srcHeader.Address2 || '',
    }));
    setHeaderUdfs(normalizeCompanyUdfState(
      headerUdfDefinitions,
      mergeUdfValues(
        srcHeader.header_udfs,
        srcHeader.headerUdfs,
        sourceDocument.header_udfs,
        sourceDocument.headerUdfs,
        unwrappedDocument.header_udfs,
        unwrappedDocument.headerUdfs
      )
    ));

    const newLines = sourceLines.map((line, idx) => {
      const normalizedLine = normaliseDocumentLine(line, idx, baseEntry, baseType, copiedLocation.branch);
      const hydrated = hydrateLoadedLine({
        ...createLine(rowUdfDefinitions),
        ...normalizedLine,
        baseEntry: line.baseEntry ?? line.BaseEntry ?? baseEntry,
        baseType: line.baseType ?? line.BaseType ?? baseType,
        baseLine: line.baseLine ?? line.BaseLine ?? line.lineNum ?? line.LineNum ?? normalizedLine.baseLine ?? idx,
        taxCode: normalizedLine.taxCode || line.taxCode || line.TaxCode || line.VatGroup || '',
        taxCodeManuallyOverridden: Boolean(String(normalizedLine.taxCode || line.taxCode || line.TaxCode || line.VatGroup || '').trim()),
        stcode: normalizedLine.stcode || line.stcode || '',
        branch: normalizedLine.branch || copiedLocation.branch,
        loc: normalizedLine.loc || getWarehouseLocationValue(refData.warehouses, normalizedLine.whse || line.whse || line.WarehouseCode || line.WhsCode || copiedLocation.warehouse),
        whse: normalizedLine.whse || line.whse || line.WarehouseCode || line.WhsCode || copiedLocation.warehouse,
        udf: normalizeCompanyUdfState(
          rowUdfDefinitions,
          mergeUdfValues(pickLineUdfValues(line), line.line_udfs, line.lineUdfs, line.udf)
        ),
      });
      return applyCopiedDeliveryQuantities({
        line: hydrated,
        sourceLine: line,
        sourceType,
        matrixFields: effectiveMatrixColumnDefinitions,
        rowUdfFields: rowUdfDefinitions,
      });
    });
    const nextLines = newLines.length > 0 ? newLines : [createLine(rowUdfDefinitions)];
    copiedLinesNeedBatchOpenRef.current = !refData.items.length && newLines.some(line => line.itemNo);
    setLines(nextLines);
    refreshBatchAvailabilityForLines(nextLines);

    const cardCode = normHeader.vendor || srcHeader.customerCode || srcHeader.customer || srcHeader.CardCode;
    if (cardCode && cardCode !== header.vendor) loadVendorDetails(cardCode);

    const labels = { salesOrder: 'Sales Order', salesQuotation: 'Sales Quotation', arReserveInvoice: 'A/R Reserve Invoice' };
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
      if (docType === 'arReserveInvoice') {
        const res = await fetchOpenArReserveInvoicesForDelivery(bpCode);
        return res?.data?.invoices || [];
      }
      return await deliveryCopyFromApi.fetchOpenDocuments(docType, bpCode);
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
      if (docType === 'arReserveInvoice') {
        const res = await fetchArReserveInvoiceForDeliveryCopy(docEntry);
        return res.data;
      }
      return await deliveryCopyFromApi.fetchDocumentForCopy(docType, docEntry);
    } catch (err) {
      console.error('Error fetching document details:', err);
      throw err;
    }
  };

  // â”€â”€ Copy To handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleCopyTo = async (targetType) => {
    await copyToDocument({
      sourceDocType: 'delivery',
      targetType,
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: {
        header,
        lines,
        headerUdfs,
        freightCharges: freightModal.freightCharges,
      },
      restoreState: { deliveryDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      beforeNavigate: () => document.querySelectorAll('.del-dropdown').forEach(d => d.classList.remove('active')),
      setError: (message) => setPageState(p => ({ ...p, success: '', error: message })),
      errorMessage: 'Please save the delivery first before copying to another document.',
    });
  };

  const handleDuplicate = async () => {
    setSeriesRevision(value => value + 1);

    const duplicateDate = today();
    const duplicateWarehouse = resolveBatchWarehouseCode(
      lines.find(line => String(line.whse || '').trim())?.whse,
      header.warehouse
    );
    const duplicateLines = buildDuplicateLines(lines, createLine, rowUdfDefinitions).map(line => ({
      ...line,
      whse: duplicateWarehouse || line.whse || '',
      batches: [],
      hasBatchesAvailable: false,
    }));
    const duplicated = duplicateDocumentInPlace({
      currentDocEntry,
      header,
      initialHeader: INIT_HEADER,
      lines,
      createLine,
      rowUdfDefinitions,
      setCurrentDocEntry,
      setHeader,
      setLines: () => setLines(duplicateLines),
      setActiveTab,
      setValErrors,
      setPageState,
      setSnapshotPending,
      setIsDirty,
      setFreightModal,
      navigate,
      location,
      successMessage: 'Delivery duplicated. Review and add it as a new entry.',
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
      refreshBatchAvailabilityForLines(duplicateLines);

      
    }
  };

  // â”€â”€ submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
    docEntry: currentDocEntry, isDirty,
    state: { header, lines, headerUdfs, referenceDocuments, referenceDocumentsChanged, eWayBillDetails, freightCharges: freightModal.freightCharges, companyDb: activeCompanyDb , company_id: activeCompanyId, companyKey: formSettingsStorageKey },
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
    const isUpdate = Boolean(currentDocEntry);
    const documentLinesChanged = isUpdate && (
      !loadedLinesSignatureRef.current ||
      getDeliveryLinesUpdateSignature(lines) !== loadedLinesSignatureRef.current
    );
    if (!isUpdate && openRequiredBatchAllocationOnAdd()) return;
    if (!isUpdate) {
      const allocationLineIndex = lines.findIndex((line) => {
        const required = getRequiredBatchQty(line);
        const serialMissing = line.serialManaged && (line.serialNumbers || []).length !== required;
        const binTotal = (line.binAllocations || []).reduce((sum, row) => sum + parseNum(row.quantity), 0);
        const binMissing = line.binManaged && Math.abs(binTotal - required) > BATCH_QTY_TOLERANCE;
        return serialMissing || binMissing;
      });
      if (allocationLineIndex >= 0) {
        setActiveTab('Contents');
        openInventoryAllocationModal(allocationLineIndex);
        return;
      }
    }

    const e = await validate({ validateDocumentLines: !isUpdate || documentLinesChanged });
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
          window.setTimeout(() => openInventoryAllocationModal(lineIndex), 0);
        }
      }
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
        roundingAmount: getDocumentRoundingPayloadAmount(header, fmtDec(totals.roundingAmount, numDec.totalPaymentDue)),
        roundingAmountIsManual: header.roundingAmountIsManual === true,
      };
      
      const payload = {
        company_id: activeCompanyId,
        header: prep,
        lines: lines.map((line) => ({
          ...line,
          udf: buildVisibleEnteredRowUdfPayload(
            rowUdfDefinitions,
            line.udf || {},
            formSettings,
            { preserveUnmappedUdfs: false },
          ),
        })),
        freightCharges: freightModal.freightCharges,
        eway_bill_details: eWayBillDetails,
        include_document_lines: !isUpdate || documentLinesChanged,
        reference_documents: referenceDocuments,
        reference_documents_changed: referenceDocumentsChanged && referenceDocuments.some(hasCompleteDeliveryReferenceDocument),
        header_udfs: normalizeCompanyUdfState(headerUdfDefinitions, headerUdfs),
      };
      const r = currentDocEntry ? await updateDelivery(currentDocEntry, narrowConfirmationUpdate(payload)) : await submitDelivery(payload);
      const dn = r.data.doc_num ? ` Doc No: ${r.data.doc_num}.` : '';
      setSnapshotPending(false);
      setIsDirty(false);
      defaultWarehouseAppliedRef.current = false;
      const resetHeader = createInitialHeader(generalSettingsRef.current);
      setCurrentDocEntry(null); setHeader(resetHeader); setLines([createLine(rowUdfDefinitions)]);
      setReferenceDocuments([]);
      setReferenceDocumentsChanged(false);
      setReferenceDocumentsModal(false);
      setEWayBillDetails({});
      setAttachments(INIT_ATTACH);
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
      const message = getErrMsg(e, 'Delivery submission failed.');
      if (
        message.includes('batch-managed') ||
        message.includes('Batch selection') ||
        message.includes('Batch quantity') ||
        message.includes('exceeds available quantity')
      ) {
        const itemMatch = message.match(/item ([^.,]+)/i);
        const itemCode = itemMatch?.[1]?.trim();
        const hydratedLines = lines.map((line) => {
          if (itemCode && String(line.itemNo || '').trim() !== itemCode) return hydrateLoadedLine(line);
          return hydrateLoadedLine({ ...line, batchManaged: true, hasBatchesAvailable: true });
        });
        const lineIndex = itemCode
          ? hydratedLines.findIndex(line => String(line.itemNo || '').trim() === itemCode)
          : hydratedLines.findIndex(line => line.batchManaged && line.hasBatchesAvailable !== false);
        setLines(hydratedLines);
        if (lineIndex >= 0) {
          setActiveTab('Contents');
          setValErrors({
            header: {},
            lines: {
              [lineIndex]: {
                batches: message.includes('batch-managed')
                  ? 'Batch selection is mandatory for batch-managed item'
                  : message,
              },
            },
            form: 'Please assign batches before adding this delivery.',
          });
          window.setTimeout(() => openBatchModal(lineIndex, hydratedLines[lineIndex]), 0);
        }
      } else if (message.includes('Warehouse') && message.toLowerCase().includes('branch')) {
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

    defaultWarehouseAppliedRef.current = false;
    const resetHeader = createInitialHeader(generalSettingsRef.current);
    setSnapshotPending(false);
    setIsDirty(false);
    setCurrentDocEntry(null); setHeader(resetHeader); setLines([createLine(rowUdfDefinitions)]);
    setReferenceDocuments([]);
    setReferenceDocumentsChanged(false);
    setReferenceDocumentsModal(false);
    setEWayBillDetails({});
    setAttachments(INIT_ATTACH);
    setHeaderUdfs(createUdfState(headerUdfDefinitions)); setActiveTab('Contents');
    setValErrors({ header: {}, lines: {}, form: '' });
    setPageState(p => ({ ...p, error: '', success: '' }));
  };

  const visibleHeaderUdfs = headerUdfDefinitions.filter(f => formSettings.headerUdfs?.[f.key]?.visible !== false);
  const visibleRowUdfs = rowUdfDefinitions.filter(f => formSettings.rowUdfs?.[f.key]?.visible !== false);
  const formSettingsMatrixFields = useMemo(() => {
    const layoutColumns = refData.line_field_metadata?.imported_layout?.columns || [];
    const existingLineNumberColumn = effectiveMatrixColumnDefinitions.find((column) => (
      String(column?.key || '').trim() === '__lineNumber'
    ));
    if (existingLineNumberColumn) return effectiveMatrixColumnDefinitions;

    const lineNumberColumn = layoutColumns.find((column) => {
      const identity = String(
        column.fieldName || column.columnUid || column.columnTitle || ''
      ).trim().toLowerCase();
      return identity === 'linenum' || identity === '#';
    });

    return [{
      key: '__lineNumber',
      label: '#',
      visible: lineNumberColumn ? lineNumberColumn.visible !== false : true,
      active: false,
      order: lineNumberColumn && Number.isFinite(Number(lineNumberColumn.columnOrder))
        ? Number(lineNumberColumn.columnOrder)
        : -10000,
      minWidth: Number(lineNumberColumn?.width) || 42,
      width: Number(lineNumberColumn?.width) || 42,
      sapControlled: true,
      readOnly: true,
    }, ...effectiveMatrixColumnDefinitions];
  }, [effectiveMatrixColumnDefinitions, refData.line_field_metadata?.imported_layout?.columns]);
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
  useDocumentSeries({ endpoint: '/delivery', companyKey: String(activeCompanyId), currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form ref={formRef} className={`del-page sap-document-page${isRightSidebarOpen ? ' del-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>

      {/* toolbar */}
      <div className="del-toolbar sap-document-toolbar">
        <span className="del-toolbar__title">Delivery{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="del-btn del-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || !isDocumentEditable || formSettingsStatus.queryModeActive} title={primaryActionLabel}>
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
        <JournalEntryPreviewButton
          documentType="delivery"
          documentLabel="Delivery"
          docEntry={currentDocEntry}
          buildPayload={() => ({ header, lines, header_udfs: headerUdfs, freightCharges: freightModal.freightCharges, referenceDocuments })}
          disabled={pageState.posting || pageState.loading}
        />
        <div className="del-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
          <button
            type="button"
            className="del-btn"
            disabled={!isDocumentEditable || !!currentDocEntry || !hasBuyerCode || formSettingsStatus.queryModeActive}
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
            Copy From
          </button>
          <div className="del-dropdown-menu">
            {[
              { key: 'salesQuotation', label: 'Sales Quotations' },
              { key: 'salesOrder',     label: 'Sales Orders' },
              { key: 'arReserveInvoice', label: 'A/R Reserve Invoices' },
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
            disabled={!currentDocEntry || formSettingsStatus.queryModeActive}
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
            Copy To
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
          <button type="button" className="del-btn sap-document-toolbar__duplicate" onClick={handleDuplicate} disabled={formSettingsStatus.queryModeActive}>
            Duplicate
          </button>
        )}
        <button type="button" className="del-btn sap-document-toolbar__find" onClick={() => navigate('/delivery/find')}>Find</button>
        <button type="button" className="del-btn sap-document-toolbar__new" onClick={resetForm}>New</button>
        <DocumentStatusActions
          type="delivery"
          docEntry={currentDocEntry}
          actions={['close', 'cancel']}
          className="del-btn"
          disabled={pageState.posting || pageState.loading}
          onDone={(action) => reloadRouteDocument(navigate, location, 'deliveryDocEntry', currentDocEntry, action)}
          onError={(message) => setPageState((p) => ({ ...p, error: message, success: '' }))}
        />
      </div>

      {/* alerts */}
      {pageState.loading && <div className="del-alert del-alert--success" style={{ marginTop: 0 }}>Loading...</div>}
      {pageState.error && <div className="del-alert del-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="del-alert del-alert--success">{pageState.success}</div>}


      <fieldset ref={documentBodyRef} aria-disabled={!isDocumentEditable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className={`sap-document-layout del-layout${isRightSidebarOpen ? ' is-sidebar-open' : ' sap-document-layout--no-udf'}`}>

          <div className="sap-document-main del-layout__main">

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
                        <SapGoldenArrowButton
                          onClick={openBusinessPartnerLink}
                          disabled={!header.vendor}
                          title="Open Business Partner"
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
                      currencyOptions={refData.currencies || []}
                      localCurrency={refData.local_currency || ''}
                      systemCurrency={refData.system_currency || refData.local_currency || ''}
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
                      </select>
                    </div>
                    </fieldset>

                  </div>
                </div>

                {/* RIGHT COLUMN */}
                <div className="col-md-6">
                  <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
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
                        className={`del-field__input${valErrors.header.nextNumber ? ' del-field__input--error' : ''}`}
                        value={currentDocEntry ? (header.docNo || header.nextNumber || '') : (pageState.seriesLoading ? '...' : header.nextNumber)}
                        onChange={handleHeaderChange}
                        readOnly={!!currentDocEntry || !isManualDocumentSeries(header.series)}
                        inputMode="numeric"
                        style={{ background: !currentDocEntry && isManualDocumentSeries(header.series) ? '#fff' : '#f0f2f5' }}
                        title={isManualDocumentSeries(header.series) ? 'Enter the manual document number' : 'Number will be assigned from the selected series'}
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
            <div className="del-tabs" role="tablist" aria-label="Delivery details">
              {TAB_NAMES.map(t => (
                <div
                  key={t}
                  role="tab"
                  tabIndex={0}
                  aria-selected={activeTab === t}
                  className={`del-tab${activeTab === t ? ' del-tab--active' : ''}`}
                  onClick={() => setActiveTab(t)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setActiveTab(t);
                    }
                  }}
                >
                  {t}
                </div>
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
                onOpenBatchModal={openInventoryAllocationModal}
                onOpenHSNModal={openHSNModal}
                onOpenItemModal={openItemModal}
                lineItemOptions={lineItemOptions}
                getUomOptions={getUomOptions}
                effectiveTaxCodes={effectiveTaxCodes}
                effectiveWarehouses={branchFilteredWarehouses}
                fmtTaxLabel={fmtTaxLabel}
                getBranchName={getBranchName}
                locations={refData.locations || []}
                valErrors={valErrors}
                distributionRules={refData.distribution_rules || []}
                onOpenQualityModal={openQualityModal}
                onOpenPaymentTermsModal={openPaymentTermsModal}
                formSettings={formSettings}
                formSettingsReady={companyFormSettingsReady}
                matrixFields={formSettingsMatrixFields}
                rowUdfFields={visibleRowUdfs}
                onRowUdfChange={handleRowUdfChange}
                onLoadLookupOptions={loadDynamicLineLookupOptions}
                currency={header.currency || refData.local_currency || ''}
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
                paymentMethodOpts={paymentMethodOpts}
                referenceDocuments={referenceDocuments}
                onOpenReferenceDocuments={openReferenceDocumentsModal}
                isEditable={isDocumentEditable}
              />
            )}

            {activeTab === 'Tax' && (
              <TaxTab
                header={header}
                onHeaderChange={handleHeaderChange}
                onOpenTaxInfoModal={openTaxInfoModal}
                isEditable={isDocumentEditable}
              />
            )}

            {activeTab === 'Electronic Documents' && (
              <ElectronicDocumentsTab
                header={header}
                onHeaderChange={handleHeaderChange}
                formats={refData.eway_bill_formats || []}
                genericFormats={refData.generic_edoc_formats || []}
                onOpenEWayBill={() => setEWayBillModalOpen(true)}
                disabled={!isDocumentEditable}
              />
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
                          <td className="del-grid__cell--num">
                            <DocumentRoundingInput className="del-grid__input" header={header} setHeader={setHeader} formattedAmount={formatDisplayMoney(totals.roundingAmount, numDec.totalPaymentDue)} disabled={!isDocumentEditable} onManualChange={markDirty} />
                          </td>
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
                    Copy From
                  </button>
                  <div className="del-dropdown-menu">
                    {[
                      { key: 'salesQuotation', label: 'Sales Quotations' },
                      { key: 'salesOrder',     label: 'Sales Orders' },
                      { key: 'arReserveInvoice', label: 'A/R Reserve Invoices' },
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
                    Copy To
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
            className="sap-header-udf-panel del-layout__sidebar"
            isOpen={sidebarOpen}
            fields={visibleHeaderUdfs}
            formSettings={formSettings}
            values={headerUdfs}
            disabled={!hasBuyerCode}
            onFieldChange={handleHeaderUdfChange}
            onClose={() => setSidebarOpen(false)}
          />
          <FormSettingsPanel
            variant="sidebar"
            className="sap-header-udf-panel del-layout__sidebar"
            isOpen={formSettingsOpen}
            onClose={() => setFormSettingsOpen(false)}
            matrixFields={formSettingsMatrixFields}
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

      <EWayBillModal
        isOpen={eWayBillModalOpen}
        onClose={() => setEWayBillModalOpen(false)}
        onSave={saveEWayBillDetails}
        udfValues={headerUdfs}
        udfDefinitions={headerUdfDefinitions}
        liveData={effectiveEWayBillLiveData}
        transporters={refData.eway_bill_transporters || []}
        dropdownOptions={refData.eway_bill_options || {}}
        workspaceRef={formRef}
        disabled={!isDocumentEditable}
      />

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
        disabled={!isDocumentEditable}
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
      <InventoryAllocationModal
        isOpen={inventoryModal.open}
        line={inventoryModal.lineIndex != null ? lines[inventoryModal.lineIndex] : null}
        readOnly={!isDocumentEditable}
        onClose={() => setInventoryModal({ open: false, lineIndex: null })}
        onSave={saveInventoryAllocations}
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
              </div>
            </div>
          </div>
        </div>
      )}

      <ReferenceDocumentsModal
        isOpen={referenceDocumentsModal}
        referenceDocuments={referenceDocuments}
        onClose={closeReferenceDocumentsModal}
        onSave={saveReferenceDocumentsModal}
        isEditable={isDocumentEditable}
        cardCode={header.vendor}
        onOpenDocument={openReferenceDocument}
      />

      {/* Freight Selection Modal */}
      <FreightChargesModal
        isOpen={freightModal.open}
        onClose={closeFreightModal}
        onApply={handleFreightApply}
        freightCharges={freightModal.freightCharges}
        taxCodes={effectiveTaxCodes}
        loading={freightModal.loading}
        currency={header.currency || refData.local_currency || ''}
      />

      <ExchangeRatesIndexesModal
        isOpen={exchangeRatesModal.open}
        currency={exchangeRatesModal.currency}
        postingDate={exchangeRatesModal.postingDate}
        initialRate={exchangeRatesModal.initialRate}
        loading={exchangeRatesModal.loading}
        error={exchangeRatesModal.error}
        data={exchangeRatesModal.data}
        documentLabel="delivery"
        onLoad={loadExchangeRatesMonth}
        onSave={saveExchangeRateFromModal}
        onClose={() => setExchangeRatesModal((previous) => ({ ...previous, open: false }))}
      />
    </form>
  );
}

export default Delivery;
