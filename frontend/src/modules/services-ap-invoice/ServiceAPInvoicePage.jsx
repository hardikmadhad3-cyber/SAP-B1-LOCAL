import SapInput from '../../components/common/SapInput';
import SapDateInput from '../../components/common/SapDateInput';
import useConfirmationOnlyUpdate from '../../utils/useConfirmationOnlyUpdate';
import useDocumentSeries from '../../hooks/useDocumentSeries';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import TaxCodeLookup from '../../components/TaxCodeLookup';
import CopyFromModal from '../../components/document/CopyFromModal';
import DocumentCurrencySelect from '../../components/document/DocumentCurrencySelect';
import FormSettingsPanel from '../../components/purchase-order/FormSettingsPanel';
import HeaderUdfSidebar from '../../components/purchase-order/HeaderUdfSidebar';
import { useRelationshipMapRegistration } from '../../components/relationship-map/RelationshipMapHost';
import LineValueLookupModal from '../../components/sales-document/LineValueLookupModal';
import { copyToDocument } from '../../services/documentCopyService';
import useStandardDocumentDraftTask from '../../hooks/useStandardDocumentDraftTask';
import { duplicateDocumentInPlace } from '../../utils/documentDuplicate';
import { useSapWindowTaskbarActions } from '../../components/SapWindowTaskbarContext';
import { createActiveCompanyScopedRouteState, isRouteStateForCompany } from '../../utils/companyStorageScope';
import useServiceDocumentFormSettings from '../../utils/useServiceDocumentFormSettings';
import { updateFormSettingPreference } from '../../utils/formSettingsPreferences';
import { getOrderedVisibleMatrixColumns } from '../../utils/formSettingsColumns';
import { getReadableDocumentLineColumnWidth } from '../../utils/documentLineColumnWidth';
import { hydrateServiceAccountLine, populateServiceAccountLine } from '../../utils/serviceDocumentAccount';
import { calculateServiceInvoiceLine } from '../../utils/serviceInvoiceLineCalculations';
import { buildVisibleEnteredRowUdfPayload } from '../../utils/rowUdfPayload';
import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount, formatDocumentRoundingAmount } from '../../utils/documentRounding';
import DocumentRoundingInput from '../../components/sales-document/DocumentRoundingInput';
import { getSapVisibleDocumentSeries, getDefaultSeriesForCurrentYear, canUseManualSeries } from '../../utils/seriesDefaults';
import { resolveLocationDisplayName } from '../../utils/locationLookup';
import { getDocumentLayout } from '../../api/sapLayoutApi';
import { fetchSalesDocumentLookup, fetchSalesDocumentSchema } from '../../api/salesDocumentSchemaApi';
import { loadSalesDocumentFieldLookupOptions } from '../../utils/salesDocumentLiveFields';
import { useAuth } from '../../auth/AuthContext';
import { convertDocumentAmountForDisplay, resolveDisplayCurrency } from '../../utils/documentCurrency';
import { buildServiceDocumentLiveFields, getSapStandardServiceMatrixColumns } from '../../utils/serviceDocumentLiveFields';
import { BASE_TYPE, normaliseDocumentHeader, unwrapCopyFromDocument } from '../../api/copyFromApi';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import StateSelectionModal from '../../components/common/StateSelectionModal';
import LogisticsTab from '../APInvoice/components/LogisticsTab';
import AccountingTab from '../APInvoice/components/AccountingTab';
import TaxTab from '../APInvoice/components/TaxTab';
import ElectronicDocumentsTab from '../APInvoice/components/ElectronicDocumentsTab';
import AttachmentsTab from '../APInvoice/components/AttachmentsTab';
import AddressModal from '../../components/document/AddressComponentModal';
import { mapAddressFields } from '../../utils/documentAddress';
import TaxInfoModal from '../APInvoice/components/TaxInfoModal';
import WithholdingTaxTableModal from '../APInvoice/components/WithholdingTaxTableModal';
import JournalEntryPreviewModal from '../services-ar-invoice/JournalEntryPreviewModal';
import {
  calculateWithholdingTaxAmount,
  createDefaultWithholdingRows,
  createEmptyWithholdingTaxState,
  isYesValue,
  normalizePartnerWithholdingTax,
  recalcWithholdingRows,
  roundTo,
} from '../../utils/withholdingTax';
import {
  fetchOpenServiceGRPOForAPInvoice,
  fetchOpenServicePurchaseOrdersForAPInvoice,
  fetchOpenServicePurchaseQuotationsForAPInvoice,
  fetchServiceAPInvoiceByDocEntry,
  fetchServiceAPInvoiceReferenceData,
  fetchServiceAPInvoiceSeries,
  fetchServiceAPInvoiceVendorDetails,
  fetchServiceGRPOForAPInvoiceCopy,
  fetchServicePurchaseOrderForAPInvoiceCopy,
  fetchServicePurchaseQuotationForAPInvoiceCopy,
  generateServiceAPInvoiceJournalEntry,
  submitServiceAPInvoice,
  updateServiceAPInvoice,
} from '../../api/serviceApInvoiceApi';
import {
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createUdfState,
  normalizeUdfState,
  readSavedFormSettings,
} from '../../config/serviceApInvoiceForm';
import '../ar-invoice/styles/arInvoice.css';
import '../APInvoice/styles/APInvoice.css';
import '../services-ar-invoice/serviceArInvoice.css';
import './serviceApInvoice.css';

import useUnsavedChangesWarning, { hasEnteredDocumentLines } from '../../hooks/useUnsavedChangesWarning';
import DocumentStatusActions from '../../components/document/DocumentStatusActions';
import { getDocumentStatusMessage } from '../../utils/copyToState';
const today = () => new Date().toISOString().split('T')[0];

const INIT_HEADER = {
  vendor: '',
  name: '',
  contactPerson: '',
  salesContractNo: '',
  currencyMode: 'BP',
  currency: '',
  exchangeRate: '',
  transactionType: 'GST Tax Invoice',
  placeOfSupply: '',
  indicator: '',
  series: '',
  nextNumber: '',
  docNo: '',
  status: 'Open',
  postingDate: today(),
  deliveryDate: '',
  documentDate: today(),
  bFromDate: '',
  bToDate: '',
  branch: '',
  paymentTerms: '',
  salesEmployee: '',
  purchaser: '',
  owner: '',
  remarks: '',
  discount: '',
  discountAmount: '',
  totalBeforeDiscount: '',
  totalDownPayment: '',
  freight: '',
  rounding: false,
  roundingAmount: '',
  wtaxAmount: '',
  appliedAmount: '',
  balanceDue: '',
  totalPaymentDue: '',
  shipToCode: '',
  shipToAddress: '',
  billToCode: '',
  billToAddress: '',
  shippingType: '',
  confirmed: undefined,
  useBillToForTax: false,
  journalRemark: '',
  paymentMethod: '',
  otherInstruction: '',
  itemServiceType: 'Service',
  summaryType: 'No Summary',
};

const TAB_NAMES = ['Contents', 'Logistics', 'Accounting', 'Tax', 'Electronic Documents', 'Attachments'];
const DEFAULT_TRANSACTION_TYPES = [
  { value: 'GST Tax Invoice', label: 'GST Tax Invoice' },
  { value: 'Bill of Supply', label: 'Bill of Supply' },
  { value: 'GST Debit Memo', label: 'GST Debit Memo' },
];

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

const EMPTY_REF_DATA = {
  vendors: [],
  contacts: [],
  states: [],
  series: [],
  branches: [],
  payment_terms: [],
  sales_employees: [],
  tax_codes: [],
  gl_accounts: [],
  distribution_rules: [],
  shipping_types: [],
  pay_to_addresses: [],
  ship_to_addresses: [],
  bill_to_addresses: [],
  sac_codes: [],
  locations: [],
  items: [],
  business_partners: [],
  transaction_types: [],
  quality_options: { buyer: [], seller: [] },
  price_options: { buyer: [], seller: [] },
  udf_metadata: { header: [], rows: [] },
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

const normalizeReferenceData = (data = {}, seriesData = null) => {
  const ref = data && typeof data === 'object' ? data : {};
  const seriesSource = seriesData !== null && seriesData !== undefined ? seriesData : ref.series;

  return {
    ...EMPTY_REF_DATA,
    ...ref,
    vendors: toArray(ref.vendors, ['vendors', 'business_partners']),
    contacts: toArray(ref.contacts, ['contacts']),
    states: toArray(ref.states, ['states']),
    series: toArray(seriesSource, ['series']),
    branches: toArray(ref.branches, ['branches']),
    payment_terms: toArray(ref.payment_terms, ['payment_terms']),
    sales_employees: toArray(ref.sales_employees, ['sales_employees']),
    tax_codes: toArray(ref.tax_codes, ['tax_codes']),
    gl_accounts: toArray(ref.gl_accounts, ['gl_accounts']),
    distribution_rules: toArray(ref.distribution_rules, ['distribution_rules']),
    shipping_types: toArray(ref.shipping_types, ['shipping_types']),
    pay_to_addresses: toArray(ref.pay_to_addresses, ['pay_to_addresses']),
    ship_to_addresses: toArray(ref.ship_to_addresses, ['ship_to_addresses']),
    bill_to_addresses: toArray(ref.bill_to_addresses, ['bill_to_addresses']),
    sac_codes: toArray(ref.sac_codes, ['sac_codes']),
    locations: toArray(ref.locations, ['locations']),
    items: toArray(ref.items, ['items']),
    business_partners: toArray(ref.business_partners, ['business_partners']),
    transaction_types: toArray(ref.transaction_types || ref.transactionTypes, ['transaction_types', 'transactionTypes', 'validValues', 'ValidValues']),
    quality_options: {
      buyer: toArray(ref.quality_options?.buyer, ['buyer']),
      seller: toArray(ref.quality_options?.seller, ['seller']),
    },
    price_options: {
      buyer: toArray(ref.price_options?.buyer, ['buyer']),
      seller: toArray(ref.price_options?.seller, ['seller']),
    },
    udf_metadata: {
      header: toArray(ref.udf_metadata?.header, ['header']),
      rows: toArray(ref.udf_metadata?.rows, ['rows']),
    },
  };
};

const createLine = (rowUdfDefinitions = ROW_UDF_DEFINITIONS) => ({
  sac: '',
  description: '',
  glAccount: '',
  distRule: '',
  glAccountName: '',
  taxCode: '',
  wtaxLiable: 'No',
  totalLC: '',
  taxAmountLC: '',
  loc: '',
  locCode: '',
  blanketAgreementNo: '',
  costSheet: '',
  packingType: '',
  containerType: '',
  grossWt: '',
  totalPackage: '',
  taxCodeRepeat: '',
  price: '',
  saudaNodeRef: '',
  apInvDocKey: '',
  apInvDocNum: '',
  apInvLineNum: '',
  rg23DNo: '',
  specialRebate: '',
  commision: '',
  brokPerQty: '',
  sItem: '',
  unitPrice: '',
  sQty: '',
  sellerBrokerage: '',
  buyerBrokerage: '',
  buyerDelivery: '',
  sellerDelivery: '',
  buyerQuality: '',
  sellerQuality: '',
  buyerPrice: '',
  sellerPrice: '',
  buyerSpecialInstruction: '',
  sellerSpecialInstruction: '',
  sellerBrokerageAmtPer: '',
  sellerBrokeragePercentage: '',
  buyerBillDiscount: '',
  sellerBillDiscount: '',
  stcode: '',
  buyerTermsOfPayment: '',
  sellerTermsOfPayment: '',
  sellerTermsOfPaymentRepeat: '',
  fixBrokBuyer: '',
  fixBrockSeller: '',
  freightPurchase: '',
  freightSales: '',
  freightProvider: '',
  freightProviderName: '',
  documentCreated: '',
  brokerageNumber: '',
  baseEntry: null,
  baseType: null,
  baseLine: null,
  udf: createUdfState(rowUdfDefinitions),
});

const includeSelectedSeries = (series = [], selectedSeries = '', selectedSeriesName = '') => {
  const selected = String(selectedSeries || '').trim();
  if (!selected || selected === 'manual' || series.some((item) => String(item.Series || '') === selected)) {
    return series;
  }

  return [{
    Series: selected,
    SeriesName: selectedSeriesName || selected,
    NextNumber: '',
    IsLoadedDocumentSeries: true,
  }, ...series];
};

const dedupeSeriesOptions = (series = []) => {
  const seen = new Set();
  return (Array.isArray(series) ? series : []).filter((item) => {
    const id = String(item?.Series || '').trim();
    const label = String(item?.SeriesName || item?.DisplayName || item?.RawSeriesName || item?.BeginStr || id).trim().toUpperCase();
    const indicator = String(item?.Indicator || '').trim().toUpperCase();
    const docSubType = String(item?.DocSubType || '').trim().toUpperCase();
    const key = label ? `${label}|${indicator}|${docSubType}` : id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};






const normalizeFieldName = (value) =>
  String(value || '')
    .replace(/^U_/i, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();

const FIXED_SERVICE_MATRIX_FIELD_NAMES = new Set([
  'saudanoderef',
  'blanketagreementno',
  'costsheet',
  'packingtype',
  'containertype',
  'grosswt',
  'grossweight',
  'totalpackage',
  'taxcoderepeat',
  'taxcode',
  'taxcodeudf',
  'price',
  'apinvdockey',
  'apinvdocentry',
  'apinvdocnum',
  'apinvlinenum',
  'rg23dno',
  'specialrebate',
  'commision',
  'commission',
  'brokperqty',
  'unitprice',
  'sellerbrokerage',
  'buyerbrokerage',
  'buyerdelivery',
  'sellerdelivery',
  'buyertermsofpayment',
  'sellertermsofpayment',
  'sellertermsofpaymentrepeat',
  'fixbrokbuyer',
  'fixbrockbuyer',
  'fixbrokseller',
  'fixbrockseller',
  'buyerquality',
  'sellerquality',
  'buyerprice',
  'sellerprice',
  'buyerspecialinstruction',
  'sellerspecialinstruction',
  'sellerbrokerageamtper',
  'sellerbrokerageinpercentage',
  'buyerbilldiscount',
  'sellerbilldiscount',
  'stcode',
  'sitem',
  'sqty',
  'freightpurchase',
  'freightsales',
  'freightprovider',
  'freightprovidername',
  'documentcreated',
  'brokeragenumber',
]);

const fieldNameMatches = (field = {}, names = new Set()) =>
  names.has(normalizeFieldName(field.key)) ||
  names.has(normalizeFieldName(field.label)) ||
  names.has(normalizeFieldName(field.aliasId));

const isFixedServiceMatrixField = (field = {}) =>
  !/^U_/i.test(String(field.key || field.sapField || ''))
  && fieldNameMatches(field, FIXED_SERVICE_MATRIX_FIELD_NAMES);

const applyServiceRowUdfDefaults = (definitions = []) =>
  definitions.map((field) => ({ ...field, visible: field.visible === true }));

const LINE_LOOKUP_FIELDS = new Set([
  'sellerBrokerage',
  'buyerBrokerage',
  'buyerTermsOfPayment',
  'sellerTermsOfPayment',
  'buyerQuality',
  'sellerQuality',
  'buyerPrice',
  'sellerPrice',
  'freightProvider',
]);

const parseNum = (value) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '';
};

const fmtAddr = (address) => {
  if (!address) return '';
  return [
    [address.Street, address.StreetNo],
    [address.Block, address.Building, address.Address2, address.Address3],
    [address.City, address.County, address.State, address.ZipCode],
    [address.Country],
  ]
    .map((parts) => parts.filter(Boolean).join(', '))
    .filter(Boolean)
    .join('\n');
};

const getAddressState = (address) =>
  String(address?.State || address?.StateCode || address?.state || '').trim();

const findAddressByCode = (addresses = [], addressCode = '') => {
  const normalizedCode = String(addressCode || '').trim().toLowerCase();
  return addresses.find((address) => (
    String(address?.Address || address?.address || '').trim().toLowerCase() === normalizedCode
  )) || addresses[0];
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

const getTaxRate = (taxCodes, code) => {
  const tax = taxCodes.find((item) => String(item.Code || '') === String(code || ''));
  return parseNum(tax?.Rate);
};

const readLineAliasValue = (line = {}, aliases = []) => {
  const aliasSet = new Set(aliases.map(normalizeFieldName));
  const sources = [line, line.udf || {}];
  for (const source of sources) {
    for (const [key, value] of Object.entries(source || {})) {
      if (!aliasSet.has(normalizeFieldName(key))) continue;
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
  }
  return '';
};

const normalizeAccountCode = (value) => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();

const findAccountByCode = (accounts = [], code = '') => {
  const normalizedCode = normalizeAccountCode(code);
  if (!normalizedCode) return null;
  return accounts.find((item) => [
    item?.code,
    item?.AcctCode,
    item?.FormatCode,
    item?.formatCode,
    item?.accountCode,
    item?.value,
  ].some((value) => normalizeAccountCode(value) === normalizedCode)) || null;
};

const getAccountName = (account = {}) => account?.name || account?.AcctName || account?.accountName || account?.description || '';

const normalizeCopyLine = (line, idx, docEntry, baseType, accounts) => {
  const glAccount = String(line.AccountCode || line.AcctCode || line.glAccount || '').trim();
  const account = findAccountByCode(accounts, glAccount);
  const quantity = line.Quantity != null ? String(line.Quantity) : String(line.sQty || '');
  const unitPrice = line.UnitPrice != null ? String(line.UnitPrice) : String(line.unitPrice || '');
  const lineTotal = line.LineTotal != null
    ? String(line.LineTotal)
    : (parseNum(quantity) > 0 && parseNum(unitPrice) > 0 ? fmt(parseNum(quantity) * parseNum(unitPrice)) : String(line.totalLC || ''));
  return {
    ...createLine(),
    baseEntry: docEntry || line.BaseEntry || null,
    baseType: baseType || line.BaseType || null,
    baseLine: line.LineNum ?? line.BaseLine ?? idx,
    sac: String(line.SAC || line.SACEntry || line.sac || ''),
    description: String(line.ItemDescription || line.Dscription || line.description || ''),
    glAccount,
    glAccountName: line.glAccountName || line.AccountName || line.AcctName || getAccountName(account),
    distRule: String(line.DistributionRule || line.OcrCode || line.distRule || ''),
    taxCode: String(line.TaxCode || line.taxCode || ''),
    totalLC: lineTotal,
    taxAmountLC: line.TaxAmount != null ? String(line.TaxAmount) : String(line.taxAmountLC || ''),
    loc: String(line.Location || line.LocationCode || line.loc || ''),
    locCode: String(line.LocationCode || line.locCode || ''),
    blanketAgreementNo: String(line.BlanketAgreementNo || line.AgrNo || line.AgreementNo || line.blanketAgreementNo || ''),
    costSheet: String(readLineAliasValue(line, ['CostSheet', 'Cost_Sheet', 'costSheet'])),
    packingType: String(readLineAliasValue(line, ['PackingType', 'Packing_Type', 'packingType'])),
    containerType: String(readLineAliasValue(line, ['ContainerType', 'Container_Type', 'containerType'])),
    grossWt: String(readLineAliasValue(line, ['GrossWt', 'GrossWeight', 'grossWt'])),
    totalPackage: String(readLineAliasValue(line, ['TotalPackage', 'Total_Package', 'totalPackage'])),
    taxCodeRepeat: String(readLineAliasValue(line, ['TaxCode', 'TaxCodeRepeat', 'taxCodeRepeat']) || line.TaxCode || line.taxCode || ''),
    price: String(readLineAliasValue(line, ['Price', 'U_PRICE', 'price'])),
    apInvDocKey: String(readLineAliasValue(line, ['APInvDocKey', 'APInvDocEntry', 'apInvDocKey'])),
    apInvDocNum: String(readLineAliasValue(line, ['APInvDocNum', 'apInvDocNum'])),
    apInvLineNum: String(readLineAliasValue(line, ['APInvLineNum', 'apInvLineNum'])),
    rg23DNo: String(readLineAliasValue(line, ['RG23DNo', 'RG23DNO', 'rg23DNo'])),
    specialRebate: String(readLineAliasValue(line, ['SpecialRebate', 'specialRebate'])),
    commision: String(readLineAliasValue(line, ['Commision', 'Commission', 'commision'])),
    unitPrice,
    sQty: quantity,
    saudaNodeRef: String(readLineAliasValue(line, ['SaudaNodeRef', 'SaudaNodhRef', 'SaudaNode', 'saudaNodeRef'])),
    brokPerQty: String(readLineAliasValue(line, ['BrokPerQty', 'brokPerQty'])),
    sItem: String(readLineAliasValue(line, ['S_Item', 'SItem', 'sItem'])),
    sellerBrokerage: String(readLineAliasValue(line, ['SellerBrokerage', 'sellerBrokerage'])),
    buyerBrokerage: String(readLineAliasValue(line, ['BuyerBrokerage', 'buyerBrokerage'])),
    buyerDelivery: String(readLineAliasValue(line, ['BuyerDelivery', 'buyerDelivery'])),
    sellerDelivery: String(readLineAliasValue(line, ['SellerDelivery', 'sellerDelivery'])),
    buyerQuality: String(readLineAliasValue(line, ['BuyerQuality', 'buyerQuality'])),
    sellerQuality: String(readLineAliasValue(line, ['SellerQuality', 'sellerQuality'])),
    buyerPrice: String(readLineAliasValue(line, ['BuyerPrice', 'buyerPrice'])),
    sellerPrice: String(readLineAliasValue(line, ['SellerPrice', 'sellerPrice'])),
    buyerSpecialInstruction: String(readLineAliasValue(line, ['BuyerSpecialInstruction', 'BuyerSplInst', 'buyerSpecialInstruction'])),
    sellerSpecialInstruction: String(readLineAliasValue(line, ['SellerSpecialInstruction', 'SellerSplInst', 'sellerSpecialInstruction'])),
    sellerBrokerageAmtPer: String(readLineAliasValue(line, ['SellerBrokerageAmtPer', 'SellBrkAmtPer', 'sellerBrokerageAmtPer'])),
    sellerBrokeragePercentage: String(readLineAliasValue(line, ['SellerBrokeragePercentage', 'SellerBrkPct', 'sellerBrokeragePercentage'])),
    buyerBillDiscount: String(readLineAliasValue(line, ['BuyerBillDiscount', 'buyerBillDiscount'])),
    sellerBillDiscount: String(readLineAliasValue(line, ['SellerBillDiscount', 'sellerBillDiscount'])),
    stcode: String(readLineAliasValue(line, ['STCODE', 'STCode', 'stcode'])),
    buyerTermsOfPayment: String(readLineAliasValue(line, ['BuyerTermsOfPayment', 'BuyerPayTerms', 'buyerTermsOfPayment'])),
    sellerTermsOfPayment: String(readLineAliasValue(line, ['SellerTermsOfPayment', 'SellerPayTerms', 'sellerTermsOfPayment'])),
    sellerTermsOfPaymentRepeat: String(readLineAliasValue(line, ['SellerTermsOfPayment', 'SellerPayTerms', 'sellerTermsOfPaymentRepeat', 'sellerTermsOfPayment'])),
    fixBrokBuyer: String(readLineAliasValue(line, ['FixBrokBuyer', 'FixBrockBuyer', 'Fix_Brock_B', 'fixBrokBuyer'])),
    fixBrockSeller: String(readLineAliasValue(line, ['FixBrokSeller', 'FixBrockSeller', 'Fix_Brock_S', 'fixBrockSeller'])),
    freightPurchase: String(readLineAliasValue(line, ['FreightPurchase', 'freightPurchase'])),
    freightSales: String(readLineAliasValue(line, ['FreightSales', 'freightSales'])),
    freightProvider: String(readLineAliasValue(line, ['FreightProvider', 'freightProvider'])),
    freightProviderName: String(readLineAliasValue(line, ['FreightProviderName', 'freightProviderName'])),
    documentCreated: String(readLineAliasValue(line, ['DocumentCreated', 'documentCreated'])),
    brokerageNumber: String(readLineAliasValue(line, ['BrokerageNumber', 'BrokerageNo', 'brokerageNumber'])),
  };
};

function ServiceAPInvoicePage() {
  const [seriesRevision, setSeriesRevision] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();
  const { company } = useAuth();
  const activeCompanyId = company?.companyId || '';
  const activeCompanyDb = company?.dbName || '';
  const workspaceRef = useRef(null);
  const { removeTask, upsertTask } = useSapWindowTaskbarActions();
  const requestedDocEntry = isRouteStateForCompany(location.state, company)
    ? location.state?.serviceApInvoiceDocEntry
    : null;
  const handledCopyFromRef = useRef('');
  const vendorDetailsRequestRef = useRef(0);

  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [header, setHeader] = useState(INIT_HEADER);
  const [headerUdfDefinitions, setHeaderUdfDefinitions] = useState([]);
  const [rowUdfDefinitions, setRowUdfDefinitions] = useState([]);
  const [matrixColumnDefinitions, setMatrixColumnDefinitions] = useState(getSapStandardServiceMatrixColumns);
  const [lines, setLines] = useState([createLine([])]);
  const [headerUdfs, setHeaderUdfs] = useState({});
  const [withholdingTax, setWithholdingTax] = useState(createEmptyWithholdingTaxState);
  const {
    formSettings,
    setFormSettings,
    formSettingsStatus,
    formSettingsStorageKey,
    formSettingsReady: companyFormSettingsReady,
    effectiveMatrixColumns,
    hydrateFormSettings,
    clearMetadataScope: clearFormSettingsMetadataScope,
  } = useServiceDocumentFormSettings({
    company,
    baseStorageKey: FORM_SETTINGS_STORAGE_KEY,
    readSavedFormSettings,
    headerUdfDefinitions,
    rowUdfDefinitions,
    matrixColumnDefinitions,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [formSettingsOpen, setFormSettingsOpen] = useState(false);
  const [refData, setRefData] = useState(EMPTY_REF_DATA);
  const [attachments] = useState(INIT_ATTACH);
  const [activeTab, setActiveTab] = useState('Contents');
  const [pageState, setPageState] = useState({ loading: true, posting: false, error: '', success: '', seriesLoading: false });
  const [valErrors, setValErrors] = useState({ header: {}, lines: {}, form: '' });
  const [isDirty, setIsDirty] = useState(false);

  useStandardDocumentDraftTask({
    draftKey: 'serviceApInvoiceDraft',
    title: 'Service A/P Invoice',
    draftValues: { currentDocEntry, header, lines, headerUdfs, activeTab, isDirty },
    restoreDraft: (draft) => {
      setCurrentDocEntry(draft.currentDocEntry || null);
      setHeader(draft.header || INIT_HEADER);
      setLines(Array.isArray(draft.lines) && draft.lines.length
        ? draft.lines
        : [createLine(ROW_UDF_DEFINITIONS)]);
      setHeaderUdfs(draft.headerUdfs || normalizeUdfState(HEADER_UDF_DEFINITIONS));
      setActiveTab(draft.activeTab || 'Contents');
      setIsDirty(Boolean(draft.isDirty));
    },
  });
  const [copyFromModal, setCopyFromModal] = useState(false);
  const [copyFromDocType, setCopyFromDocType] = useState('purchaseOrder');
  const [bpModalOpen, setBpModalOpen] = useState(false);
  const [stateModalOpen, setStateModalOpen] = useState(false);
  const [addressModal, setAddressModal] = useState(null);
  const [taxInfoModal, setTaxInfoModal] = useState(false);
  const [addressForm, setAddressForm] = useState({
    shipToCode: '',
    shipToAddress: '',
    billToCode: '',
    billToAddress: '',
    streetPoBox: '',
    streetNo: '',
    buildingFloorRoom: '',
    block: '',
    city: '',
    zipCode: '',
    county: '',
    state: '',
    countryRegion: '',
    addressName2: '',
    addressName3: '',
    gln: '',
    gstin: '',
  });
  const [taxInfoForm, setTaxInfoForm] = useState({
    panNo: '',
    panCircleNo: '',
    panWardNo: '',
    panAssessingOfficer: '',
    deducteeRefNo: '',
    lstVatNo: '',
    cstNo: '',
    tanNo: '',
    serviceTaxNo: '',
    companyType: '',
    natureOfBusiness: '',
    assesseeType: '',
    tinNo: '',
    itrFiling: '',
    gstType: '',
    gstin: '',
  });
  const [journalPreview, setJournalPreview] = useState({
    open: false,
    loading: false,
    data: null,
    error: '',
  });
  const [lineLookupModal, setLineLookupModal] = useState({
    open: false,
    lineIndex: -1,
    field: '',
    title: '',
    options: [],
    searchPlaceholder: 'Search values',
    emptyMessage: 'No values found',
    allowCreate: false,
    isUdf: false,
    columns: null,
  });

  const isDocumentEditable = !currentDocEntry || String(header.status || '').toLowerCase() === 'open';
  const resolvePartnerCurrency = useCallback((currency, fallback = '') => {
    const normalized = String(currency || '').trim();
    if (normalized && normalized !== '##') return normalized;
    return fallback || refData.local_currency || refData.company_currency || '';
  }, [refData.company_currency, refData.local_currency]);
  useRelationshipMapRegistration({
    enabled: Boolean(currentDocEntry),
    objectType: 18,
    docEntry: currentDocEntry,
    header,
    total: header.totalPaymentDue || header.total || '',
  });
  const hasUnsavedChanges = Boolean(currentDocEntry && isDirty);
  useUnsavedChangesWarning(hasUnsavedChanges || (!currentDocEntry && hasEnteredDocumentLines(lines)));
  const updateActionLabel = hasUnsavedChanges ? 'Update' : 'OK';
  const primaryActionLabel = pageState.posting
    ? 'Saving...'
    : currentDocEntry
      ? updateActionLabel
      : 'Add';
  const markDirty = (event) => {
    if (event?.target?.closest?.('[data-document-dirty-ignore="true"]')) return;
    if (currentDocEntry) setIsDirty(true);
  };
  const hasVendorCode = Boolean(String(header.vendor || '').trim());
  const isRightSidebarOpen = sidebarOpen || formSettingsOpen;
  const taxCodes = toArray(refData.tax_codes, ['tax_codes']);
  const accounts = toArray(refData.gl_accounts, ['gl_accounts']);
  const distributionRules = toArray(refData.distribution_rules, ['distribution_rules']);
  const paymentTerms = toArray(refData.payment_terms, ['payment_terms']);
  const shippingTypes = toArray(refData.shipping_types, ['shipping_types']);
  const seriesOptions = useMemo(() => {
    const availableSeries = dedupeSeriesOptions(toArray(refData.series, ['series']));
    const options = currentDocEntry
      ? dedupeSeriesOptions(includeSelectedSeries(availableSeries, header.series, header.seriesName))
      : availableSeries;
    return getSapVisibleDocumentSeries(options, {
      selectedSeries: header.series, includeHistorical: Boolean(currentDocEntry),
      postingDate: header.postingDate || header.documentDate,
    });
  }, [currentDocEntry, refData.series, header.series, header.seriesName, header.postingDate, header.documentDate]);
  const salesEmployeeOptions = toArray(refData.sales_employees, ['sales_employees']);
  const stateOptions = toArray(refData.states, ['states']);
  const vendorPayToAddresses = toArray(refData.pay_to_addresses, ['pay_to_addresses']).filter((address) => String(address.CardCode || '') === String(header.vendor || ''));
  const vendorShipToAddresses = toArray(refData.ship_to_addresses, ['ship_to_addresses']).filter((address) => String(address.CardCode || '') === String(header.vendor || ''));
  const vendorBillToAddresses = toArray(refData.bill_to_addresses, ['bill_to_addresses']).filter((address) => String(address.CardCode || '') === String(header.vendor || ''));
  const vendorEffectiveShipToAddresses = vendorShipToAddresses.length ? vendorShipToAddresses : vendorPayToAddresses;
  const vendorEffectiveBillToAddresses = vendorBillToAddresses.length ? vendorBillToAddresses : vendorPayToAddresses;
  const payTermOpts = paymentTerms.map((term) => ({ value: String(term.GroupNum ?? term.code ?? ''), label: term.PymntGroup || term.name || String(term.GroupNum ?? '') }));
  const shipTypeOpts = shippingTypes.map((type) => ({ value: String(type.TrnspCode ?? type.code ?? ''), label: type.TrnspName || type.name || String(type.TrnspCode ?? '') }));
  const transactionTypeOptions = useMemo(() => {
    return DEFAULT_TRANSACTION_TYPES;
  }, []);

  const accountLookupOptions = useMemo(() => accounts.map((account) => ({
    value: account.code || '',
    description: account.name || '',
    label: account.name ? `${account.code} - ${account.name}` : account.code,
    accountNumber: account.code || '',
    accountName: account.name || '',
    accountBalance: Number(account.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    inactive: account.inactive || 'No',
  })).filter((option) => option.value), [accounts]);

  const distributionRuleLookupOptions = useMemo(() => distributionRules.map((rule) => {
    const value = rule.FactorCode || rule.OcrCode || rule.code || '';
    const description = rule.FactorDescription || rule.OcrName || rule.name || '';
    return {
      value,
      description,
      label: description ? `${value} - ${description}` : value,
    };
  }).filter((option) => option.value), [distributionRules]);

  const paymentTermLookupOptions = useMemo(() => paymentTerms.map((term) => {
    const value = term.PymntGroup || term.name || String(term.GroupNum ?? '');
    const code = String(term.GroupNum ?? term.code ?? '');
    return {
      value,
      description: code ? `Code: ${code}` : '',
      label: code ? `${value} (${code})` : value,
    };
  }).filter((option) => option.value), [paymentTerms]);

  const locationLookupOptions = useMemo(() => toArray(refData.locations, ['locations']).map((locationItem) => {
    const code = String(locationItem.code ?? locationItem.Code ?? '');
    const name = locationItem.name || locationItem.Location || locationItem.Name || code;
    return {
      value: name,
      description: code ? `Code: ${code}` : '',
      label: code ? `${name} (${code})` : name,
      code,
      locationName: name,
    };
  }).filter((option) => option.value), [refData.locations]);

  const itemLookupOptions = useMemo(() => toArray(refData.items, ['items']).map((item) => ({
    value: item.ItemCode || item.code || '',
    description: item.ItemName || item.name || '',
    label: item.ItemName ? `${item.ItemCode} - ${item.ItemName}` : item.ItemCode,
    itemNo: item.ItemCode || item.code || '',
    itemDescription: item.ItemName || item.name || '',
    inStock: Number(item.InStock ?? item.OnHand ?? 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
    wtaxLiable: item.WTaxLiable || item.WTLiable || '',
  })).filter((option) => option.value), [refData.items]);

  const freightProviderLookupOptions = useMemo(() => {
    const partners = toArray(refData.business_partners, ['business_partners']);
    const fallbackVendors = toArray(refData.vendors, ['vendors']);
    return (partners.length ? partners : fallbackVendors).map((bp) => {
    const code = bp.CardCode || bp.code || '';
    const name = bp.CardName || bp.name || '';
    return {
      value: code,
      description: name,
      label: name ? `${name} (${code})` : code,
      bpName: name,
      bpCode: code,
      bpBalance: Number(bp.Balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      bpType: String(bp.CardType || '').replace(/^c/, '') || '',
      active: bp.Active || 'Yes',
      inactive: bp.Inactive || 'No',
      billToBlock: bp.BillToBlock || '',
      billToBuildingFloorRoom: bp.BillToBuildingFloorRoom || '',
      gtsRegistrationNumber: bp.GTSRegistrationNumber || '',
    };
  }).filter((option) => option.value);
  }, [refData.business_partners, refData.vendors]);

  const serviceSacLookupOptions = useMemo(() => toArray(refData.sac_codes, ['sac_codes']).map((sac) => {
    const code = sac.serviceCode || sac.code || sac.ChapterID || '';
    const serviceName = sac.serviceName || sac.description || sac.name || sac.Dscription || '';
    return {
      value: code,
      description: serviceName || `Service Code: ${code}`,
      label: serviceName ? `${serviceName} (${code})` : code,
      serviceName,
      serviceCode: code,
    };
  }).filter((option) => option.value), [refData.sac_codes]);

  const genericLineLookupOptions = useMemo(() => ({
    sac: {
      title: 'List of India SAC Code',
      options: serviceSacLookupOptions,
      searchPlaceholder: 'Search service name or service code',
      emptyMessage: 'No service SAC codes found',
      columns: [
        { key: 'serviceName', label: 'Service Name', primary: true },
        { key: 'serviceCode', label: 'Service Code', width: 140 },
      ],
    },
    buyerTermsOfPayment: {
      title: 'List of Buyer Terms of Payment',
      options: paymentTermLookupOptions,
      searchPlaceholder: 'Search payment terms',
      emptyMessage: 'No payment terms found',
    },
    sellerTermsOfPayment: {
      title: 'List of Seller Terms of Payment',
      options: paymentTermLookupOptions,
      searchPlaceholder: 'Search payment terms',
      emptyMessage: 'No payment terms found',
    },
    sellerBrokerage: {
      title: 'List of Seller Brokerage Business Partners',
      options: freightProviderLookupOptions,
      searchPlaceholder: 'Search business partners',
      emptyMessage: 'No business partners found',
      columns: [
        { key: 'bpName', label: 'BP Name', primary: true },
        { key: 'bpCode', label: 'BP Code', width: 110 },
        { key: 'bpBalance', label: 'BP Balance', width: 120, align: 'right' },
        { key: 'bpType', label: 'BP Type', width: 90 },
      ],
    },
    buyerBrokerage: {
      title: 'List of Buyer Brokerage Business Partners',
      options: freightProviderLookupOptions,
      searchPlaceholder: 'Search business partners',
      emptyMessage: 'No business partners found',
      columns: [
        { key: 'bpName', label: 'BP Name', primary: true },
        { key: 'bpCode', label: 'BP Code', width: 110 },
        { key: 'bpBalance', label: 'BP Balance', width: 120, align: 'right' },
        { key: 'bpType', label: 'BP Type', width: 90 },
      ],
    },
    buyerQuality: {
      title: 'List of Buyer Quality Values',
      options: toArray(refData.quality_options?.buyer, ['buyer']),
      searchPlaceholder: 'Search buyer quality',
      emptyMessage: 'No buyer quality values found',
    },
    sellerQuality: {
      title: 'List of Seller Quality Values',
      options: toArray(refData.quality_options?.seller, ['seller']),
      searchPlaceholder: 'Search seller quality',
      emptyMessage: 'No seller quality values found',
    },
    buyerPrice: {
      title: 'List of Buyer Price Values',
      options: toArray(refData.price_options?.buyer, ['buyer']),
      searchPlaceholder: 'Search buyer price',
      emptyMessage: 'No buyer price values found',
    },
    sellerPrice: {
      title: 'List of Seller Price Values',
      options: toArray(refData.price_options?.seller, ['seller']),
      searchPlaceholder: 'Search seller price',
      emptyMessage: 'No seller price values found',
    },
    freightProvider: {
      title: 'List of Business Partners',
      options: freightProviderLookupOptions,
      searchPlaceholder: 'Search business partners',
      emptyMessage: 'No business partners found',
      columns: [
        { key: 'bpName', label: 'BP Name', primary: true },
        { key: 'bpCode', label: 'BP Code', width: 110 },
        { key: 'bpBalance', label: 'BP Balance', width: 120, align: 'right' },
        { key: 'bpType', label: 'BP Type', width: 90 },
        { key: 'active', label: 'Active', width: 70 },
        { key: 'inactive', label: 'Inactive', width: 80 },
        { key: 'billToBlock', label: 'Bill-to Block', width: 150 },
        { key: 'billToBuildingFloorRoom', label: 'Bill-to Building/Floor/Room', width: 220 },
        { key: 'gtsRegistrationNumber', label: 'GTS Registration Number', width: 180 },
      ],
    },
    loc: {
      title: 'List of Locations',
      options: locationLookupOptions,
      searchPlaceholder: 'Search locations',
      emptyMessage: 'No locations found',
      columns: [
        { key: 'locationName', label: 'Location', primary: true },
        { key: 'code', label: 'Code', width: 90 },
      ],
    },
    sItem: {
      title: 'List of Items',
      options: itemLookupOptions,
      searchPlaceholder: 'Search items',
      emptyMessage: 'No items found',
      columns: [
        { key: 'itemNo', label: 'Item No.', width: 150, primary: true },
        { key: 'itemDescription', label: 'Item Description' },
        { key: 'inStock', label: 'In Stock', width: 120, align: 'right' },
        { key: 'wtaxLiable', label: 'WTax Liable', width: 100 },
      ],
    },
  }), [freightProviderLookupOptions, itemLookupOptions, locationLookupOptions, paymentTermLookupOptions, refData.price_options, refData.quality_options, serviceSacLookupOptions]);

  const sumDecimals = Number(refData.decimal_settings?.sum);
  const numDec = Number.isInteger(sumDecimals) && sumDecimals >= 0 && sumDecimals <= 6 ? sumDecimals : 2;
  const totals = useMemo(() => {
    if (currentDocEntry) {
      const total = parseNum(header.totalPaymentDue);
      const appliedAmount = parseNum(header.appliedAmount);
      const lineSubtotal = lines.reduce((sum, line) => sum + parseNum(line.totalLC), 0);
      const lineTax = lines.reduce((sum, line) => sum + parseNum(line.taxAmountLC), 0);
      const tax = header.tax !== '' ? parseNum(header.tax) : lineTax;
      const freight = parseNum(header.freight);
      const downPayment = parseNum(header.totalDownPayment);
      const wtaxAmount = parseNum(header.wtaxAmount);
      const discountAmount = header.discountAmount !== ''
        ? parseNum(header.discountAmount)
        : lineSubtotal * parseNum(header.discount) / 100;
      const explicitSubtotal = parseNum(header.totalBeforeDiscount);
      const explicitRounding = parseNum(header.roundingAmount);
      const subtotal = explicitSubtotal || lineSubtotal || Math.max(
        0,
        total + wtaxAmount + discountAmount + downPayment - freight - tax - explicitRounding
      );
      const derivedRounding = total + wtaxAmount + discountAmount + downPayment - subtotal - freight - tax;
      const roundingAmount = header.roundingAmount !== '' && header.roundingAmount != null
        ? explicitRounding : derivedRounding;
      return {
        subtotal,
        tax,
        discountAmount,
        freight,
        downPayment,
        roundingAmount,
        total,
        appliedAmount,
        balanceDue: header.balanceDue !== '' ? parseNum(header.balanceDue) : Math.max(0, total - appliedAmount),
        wtaxAmount,
      };
    }

    const subtotal = lines.reduce((sum, line) => sum + parseNum(line.totalLC), 0);
    const tax = lines.reduce((sum, line) => sum + parseNum(line.taxAmountLC), 0);
    const discountAmount = subtotal * parseNum(header.discount) / 100;
    const freight = parseNum(header.freight);
    const downPayment = parseNum(header.totalDownPayment);
    const totalBeforeRounding = Math.max(0, subtotal - discountAmount - downPayment) + freight + tax;
    const { roundingAmount, total } = calculateDocumentRounding(totalBeforeRounding, header.rounding, numDec, (currentDocEntry || header.roundingAmountIsManual) ? header : null, getDocumentRoundingPolicy(refData, header));
    const appliedAmount = parseNum(header.appliedAmount);
    const balanceDue = Math.max(0, total - appliedAmount);
    return { subtotal, tax, discountAmount, freight, downPayment, roundingAmount, total, appliedAmount, balanceDue, wtaxAmount: 0 };
  }, [refData, numDec, currentDocEntry, header.appliedAmount, header.balanceDue, header.discount, header.discountAmount, header.freight, header.rounding, header.roundingAmount, header.roundingAmountIsManual, header.tax, header.totalBeforeDiscount, header.totalDownPayment, header.totalPaymentDue, header.wtaxAmount, lines]);

  const wtaxDecimals = { total: 2, tax: 2, totalPaymentDue: 2 };
  const hasSavedWTaxAmount = Boolean(currentDocEntry && Math.abs(parseNum(header.wtaxAmount)) > 0);
  const hasWTaxLiableLines = lines.some((line) => isYesValue(line.wtaxLiable || line.wTaxLiable)) || hasSavedWTaxAmount;
  const wtaxBaseAmount = {
    netAmount: roundTo(Math.max(0, totals.subtotal - totals.discountAmount - totals.downPayment) + totals.freight, 2),
    taxAmount: totals.tax,
    grossAmount: totals.total,
  };
  const wtaxRowsForTotals = hasWTaxLiableLines && withholdingTax.partnerSubject
    ? recalcWithholdingRows(withholdingTax.rows, wtaxBaseAmount, wtaxDecimals)
    : [];
  const withholdingModalRows = withholdingTax.open
    ? recalcWithholdingRows(
      withholdingTax.rows.length
        ? withholdingTax.rows
        : createDefaultWithholdingRows(withholdingTax, wtaxBaseAmount, wtaxDecimals),
      wtaxBaseAmount,
      wtaxDecimals
    )
    : wtaxRowsForTotals;
  const wtaxAmount = calculateWithholdingTaxAmount({
    currentDocEntry,
    savedAmount: header.wtaxAmount,
    hasLiableLines: hasWTaxLiableLines,
    withholdingTax,
    baseAmount: wtaxBaseAmount,
    decimals: wtaxDecimals,
  });
  const totalPaymentDueAfterWTax = roundTo(totals.total - wtaxAmount, wtaxDecimals.totalPaymentDue);
  const balanceDueAfterWTax = currentDocEntry && String(header.balanceDue || '').trim()
    ? totals.balanceDue
    : Math.max(0, totalPaymentDueAfterWTax - totals.appliedAmount);
  const displayCurrency = resolveDisplayCurrency({
    mode: header.currencyMode,
    documentCurrency: header.currency,
    localCurrency: refData.local_currency || refData.company_currency || '',
    systemCurrency: refData.system_currency || '',
  });
  const displayAmount = (value) => convertDocumentAmountForDisplay(value, {
    mode: header.currencyMode,
    documentCurrency: header.currency,
    localCurrency: refData.local_currency || refData.company_currency || '',
    systemCurrency: refData.system_currency || '',
    documentRate: header.exchangeRate,
    systemRate: refData.system_rate || refData.company_currencies?.systemRate || '',
    postingMethod: refData.exchange_rate_settings?.postingMethod || 'direct',
  });

  const openWithholdingTaxTable = () => {
    if (!String(header.vendor || '').trim()) {
      setPageState((prev) => ({ ...prev, error: 'Select a vendor before opening withholding tax table.', success: '' }));
      return;
    }
    if (!withholdingTax.partnerSubject) {
      setPageState((prev) => ({ ...prev, error: 'Selected vendor does not have withholding tax setup.', success: '' }));
      return;
    }
    setWithholdingTax((prev) => ({
      ...prev,
      open: true,
      rows: prev.rows.length ? recalcWithholdingRows(prev.rows, wtaxBaseAmount, wtaxDecimals) : createDefaultWithholdingRows(prev, wtaxBaseAmount, wtaxDecimals),
    }));
  };

  useEffect(() => {
    const handler = (event) => {
      if (!event.target.closest('.del-dropdown')) {
        document.querySelectorAll('.del-dropdown').forEach((dropdown) => dropdown.classList.remove('active'));
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    let ignore = false;

    clearFormSettingsMetadataScope();
    setHeaderUdfDefinitions([]);
    setCurrentDocEntry(null);
    setHeader(INIT_HEADER);
    setRowUdfDefinitions([]);
    setMatrixColumnDefinitions(getSapStandardServiceMatrixColumns());
    setHeaderUdfs({});
    setLines([createLine([])]);
    setWithholdingTax(createEmptyWithholdingTaxState());
    setValErrors({ header: {}, lines: {}, form: '' });
    setRefData((prev) => ({
      ...prev,
      contacts: [],
      udf_metadata: { header: [], rows: [] },
      line_field_metadata: null,
      currencies: [],
      local_currency: '',
      system_currency: '',
      company_currency: '',
      warnings: [],
    }));
    vendorDetailsRequestRef.current += 1;

    const load = async () => {
      setPageState((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const [refRes, seriesRes, layoutRes, liveSchema] = await Promise.all([
          fetchServiceAPInvoiceReferenceData(),
          fetchServiceAPInvoiceSeries(header.postingDate, header.transactionType),
          getDocumentLayout({ documentType: 'SERVICE_AP_INVOICE' }).catch((error) => ({
            data: {
              success: false,
              columns: [],
              warning: error.response?.data?.message || error.message || 'Failed to load SAP layout.',
            },
          })),
          fetchSalesDocumentSchema({ documentType: 'SERVICE_AP_INVOICE' }).catch(() => null),
        ]);
        if (ignore) return;

        const defaultBranch = String(
          refRes.data?.default_branch ||
          (toArray(refRes.data?.branches, ['branches']).length === 1
            ? toArray(refRes.data?.branches, ['branches'])[0]?.BPLId
            : '') ||
          ''
        );
        let nextRefData = normalizeReferenceData(refRes.data, seriesRes.data?.series || seriesRes.data);
        if (defaultBranch) {
          try {
            const branchSeriesRes = await fetchServiceAPInvoiceSeries(header.postingDate, header.transactionType, defaultBranch);
            if (ignore) return;
            nextRefData = normalizeReferenceData(refRes.data, branchSeriesRes.data?.series || branchSeriesRes.data);
          } catch (_seriesError) {
            // Keep the date-filtered response when branch-specific lookup is unavailable.
          }
        }
        const liveFields = buildServiceDocumentLiveFields({
          schema: liveSchema,
          documentType: 'SERVICE_AP_INVOICE',
          headerTable: 'OPCH',
          lineTable: 'PCH1',
          companyId: activeCompanyId,
          companyDb: activeCompanyDb,
          layoutResponse: layoutRes,
        });
        const nextHeaderUdfs = liveFields.liveAvailable ? liveFields.headerUdfFields : [];
        const nextRowUdfs = applyServiceRowUdfDefaults(liveFields.liveAvailable ? liveFields.rowUdfFields : []);
        const nextMatrixColumns = liveFields.liveAvailable
          ? liveFields.matrixColumns
          : getSapStandardServiceMatrixColumns();
        setHeaderUdfDefinitions(nextHeaderUdfs);
        setRowUdfDefinitions(nextRowUdfs);
        setMatrixColumnDefinitions(nextMatrixColumns);
        setHeaderUdfs((prev) => normalizeUdfState(nextHeaderUdfs, prev));
        setLines((prev) => prev.map((line) => ({
          ...line,
          udf: normalizeUdfState(nextRowUdfs, line.udf || {}),
        })));
        hydrateFormSettings(nextHeaderUdfs, nextRowUdfs, nextMatrixColumns);
        setRefData({
          ...nextRefData,
          line_field_metadata: {
            ...(nextRefData.line_field_metadata || { sap_form: {} }),
            matrix_columns: nextMatrixColumns,
            imported_layout: layoutRes?.data || null,
            live_schema: liveFields.liveSchema,
            live_available: liveFields.liveAvailable,
          },
          warnings: [
            ...(nextRefData.warnings || []),
            ...(!liveFields.liveAvailable
              ? ['Live Service A/P Invoice field metadata was unavailable; standard service fields are shown.']
              : []),
            ...(layoutRes?.data?.warning ? [layoutRes.data.warning] : []),
          ],
        });
        const firstSeries = getDefaultSeriesForCurrentYear(nextRefData.series);
        if (firstSeries && !requestedDocEntry) {
          setHeader((prev) => ({
            ...prev,
            branch: prev.branch || defaultBranch || String(firstSeries?.BPLId || ''),
            series: String(firstSeries.Series || ''),
            nextNumber: String(firstSeries.NextNumber || ''),
          }));
        }
        setPageState((prev) => ({ ...prev, loading: false }));
      } catch (error) {
        if (!ignore) {
          const fallbackColumns = getSapStandardServiceMatrixColumns();
          setHeaderUdfDefinitions([]);
          setRowUdfDefinitions([]);
          setMatrixColumnDefinitions(fallbackColumns);
          hydrateFormSettings([], [], fallbackColumns);
          setRefData((prev) => ({
            ...prev,
            udf_metadata: { header: [], rows: [] },
            line_field_metadata: {
              sap_form: {},
              matrix_columns: fallbackColumns,
              imported_layout: null,
              live_schema: null,
              live_available: false,
            },
            warnings: [...(prev.warnings || []), 'Live Service A/P Invoice field metadata was unavailable; safe SAP service fields are shown.'],
          }));
          setPageState((prev) => ({ ...prev, loading: false, error: error.response?.data?.message || error.message || 'Failed to load Service A/P Invoice.' }));
        }
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, [activeCompanyId, activeCompanyDb]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!requestedDocEntry) return;
    let ignore = false;

    const loadDocument = async () => {
      setPageState((prev) => ({ ...prev, loading: true, error: '', success: '' }));
      try {
        const res = await fetchServiceAPInvoiceByDocEntry(requestedDocEntry);
        if (ignore) return;
        const doc = res.data?.service_ap_invoice;
        if (!doc) throw new Error('Service A/P Invoice was not returned.');
        const loadedHeader = { ...doc.header };
        if (loadedHeader.postingDate) {
          try {
            const seriesRes = await fetchServiceAPInvoiceSeries(
              loadedHeader.postingDate,
              loadedHeader.transactionType || header.transactionType,
              loadedHeader.branch || '',
            );
            if (ignore) return;
            const documentSeries = toArray(seriesRes.data?.series || seriesRes.data, ['series']);
            if (documentSeries.length) {
              setRefData((prev) => ({ ...prev, series: documentSeries }));
            }
          } catch (_seriesError) {
            // The selected document series is still injected into the disabled series control below.
          }
        }
        if (loadedHeader.vendor) {
          try {
            const detailsRes = await fetchServiceAPInvoiceVendorDetails(loadedHeader.vendor);
            if (ignore) return;
            const payToAddresses = toArray(detailsRes.data?.pay_to_addresses, ['pay_to_addresses']);
            const billToAddresses = toArray(detailsRes.data?.bill_to_addresses, ['bill_to_addresses']);
            const shipToAddresses = toArray(detailsRes.data?.ship_to_addresses, ['ship_to_addresses']);
            const billTo = findAddressByCode(
              billToAddresses.length ? billToAddresses : payToAddresses,
              loadedHeader.billToCode
            );
            const shipTo = findAddressByCode(
              shipToAddresses.length ? shipToAddresses : payToAddresses,
              loadedHeader.shipToCode
            );
            if (!String(loadedHeader.placeOfSupply || '').trim()) {
              loadedHeader.placeOfSupply = getAddressState(billTo) || getAddressState(shipTo);
            }
            setRefData((prev) => ({
              ...prev,
              contacts: toArray(detailsRes.data?.contacts, ['contacts']),
              pay_to_addresses: payToAddresses,
              ship_to_addresses: shipToAddresses,
              bill_to_addresses: billToAddresses,
            }));
          } catch (_detailsError) {
            // The invoice itself remains loadable when partner address lookup is unavailable.
          }
        }
        setCurrentDocEntry(doc.doc_entry);
        setHeader((prev) => ({ ...prev, ...loadedHeader }));
        setHeaderUdfs(
          headerUdfDefinitions.length
            ? normalizeUdfState(headerUdfDefinitions, doc.header_udfs || {})
            : (doc.header_udfs || {})
        );
        const loadedLines = toArray(doc.lines, ['lines', 'DocumentLines']);
        setLines(loadedLines.length
          ? loadedLines.map((line) => hydrateServiceAccountLine({
            ...createLine(rowUdfDefinitions),
            ...line,
            udf: rowUdfDefinitions.length ? normalizeUdfState(rowUdfDefinitions, line.udf || {}) : (line.udf || {}),
          }, accounts))
          : [createLine(rowUdfDefinitions)]);
        setIsDirty(false);
        setPageState((prev) => ({ ...prev, loading: false, success: `Service A/P Invoice ${doc.doc_num || requestedDocEntry} loaded.` }));
      } catch (error) {
        if (!ignore) setPageState((prev) => ({ ...prev, loading: false, error: error.response?.data?.message || error.message || 'Failed to load Service A/P Invoice.' }));
      }
    };

    loadDocument();
    return () => {
      ignore = true;
    };
  }, [requestedDocEntry, headerUdfDefinitions, rowUdfDefinitions]);

  const updateLineCalculatedValues = (line, changedField) => ({
    ...calculateServiceInvoiceLine(line, changedField, getTaxRate(taxCodes, line.taxCode)),
    taxCodeRepeat: line.taxCode || '',
  });

  const loadVendorDetails = async (vendorCode) => {
    const normalizedVendorCode = String(vendorCode || '').trim();
    const requestId = vendorDetailsRequestRef.current + 1;
    vendorDetailsRequestRef.current = requestId;
    if (!normalizedVendorCode) {
      setRefData((prev) => ({ ...prev, contacts: [] }));
      setHeader((prev) => ({ ...prev, contactPerson: '' }));
      setWithholdingTax(createEmptyWithholdingTaxState());
      return;
    }
    try {
      const res = await fetchServiceAPInvoiceVendorDetails(normalizedVendorCode);
      if (requestId !== vendorDetailsRequestRef.current) return;
      const contacts = toArray(res.data?.contacts, ['contacts']);
      setRefData((prev) => ({
        ...prev,
        contacts,
        pay_to_addresses: toArray(res.data?.pay_to_addresses, ['pay_to_addresses']),
        ship_to_addresses: toArray(res.data?.ship_to_addresses, ['ship_to_addresses']),
        bill_to_addresses: toArray(res.data?.bill_to_addresses, ['bill_to_addresses']),
      }));
      const vendorWithholdingTax = normalizePartnerWithholdingTax(res.data?.withholding_tax || {});
      setWithholdingTax((prev) => ({ ...prev, ...vendorWithholdingTax, rows: [] }));
      const vendor = res.data?.vendor;
      if (vendor) {
        const shipToAddresses = toArray(res.data?.ship_to_addresses, ['ship_to_addresses']);
        const payToAddresses = toArray(res.data?.pay_to_addresses, ['pay_to_addresses']);
        const billToAddresses = toArray(res.data?.bill_to_addresses, ['bill_to_addresses']);
        const shipTo = (shipToAddresses.length ? shipToAddresses : payToAddresses)[0];
        const billTo = (billToAddresses.length ? billToAddresses : payToAddresses)[0];
        const placeOfSupply = getAddressState(billTo) || getAddressState(shipTo);
        setHeader((prev) => ({
          ...prev,
          vendor: vendor.CardCode || prev.vendor,
          name: vendor.CardName || prev.name,
          paymentTerms: vendor.GroupNum != null ? String(vendor.GroupNum) : prev.paymentTerms,
          currency: resolvePartnerCurrency(vendor.Currency, prev.currency),
          exchangeRate: '',
          contactPerson: contacts.some((contact) => String(contact.CntctCode) === String(prev.contactPerson))
            ? prev.contactPerson
            : String(contacts[0]?.CntctCode ?? ''),
          placeOfSupply: prev.placeOfSupply || placeOfSupply,
          shipToCode: prev.shipToCode || shipTo?.Address || '',
          shipToAddress: prev.shipToAddress || fmtAddr(shipTo),
          billToCode: prev.billToCode || billTo?.Address || '',
          billToAddress: prev.billToAddress || fmtAddr(billTo),
        }));
      }
    } catch (error) {
      if (requestId !== vendorDetailsRequestRef.current) return;
      setRefData((prev) => ({ ...prev, contacts: [] }));
      setHeader((prev) => ({ ...prev, contactPerson: '' }));
      setPageState((prev) => ({
        ...prev,
        error: error.response?.data?.message || error.message || 'Failed to load vendor contacts.',
      }));
    }
  };

  const selectVendor = async (vendor) => {
    const cardCode = vendor?.CardCode || vendor?.code || '';
    setHeader((prev) => ({
      ...prev,
      vendor: cardCode,
      name: vendor?.CardName || vendor?.name || prev.name,
      currency: resolvePartnerCurrency(vendor?.Currency, prev.currency),
      exchangeRate: '',
      paymentTerms: vendor?.GroupNum != null ? String(vendor.GroupNum) : prev.paymentTerms,
      contactPerson: '',
      shipToCode: '',
      shipToAddress: '',
      billToCode: '',
      billToAddress: '',
    }));
    if (cardCode) await loadVendorDetails(cardCode);
  };

  const openLineLookup = (field, lineIndex, override = {}) => {
    if (!isDocumentEditable) return;
    const config = genericLineLookupOptions[field] || {};
    setLineLookupModal({
      open: true,
      lineIndex,
      field,
      title: override.title || config.title || 'List of Values',
      options: override.options || config.options || [],
      searchPlaceholder: override.searchPlaceholder || config.searchPlaceholder || 'Search values',
      emptyMessage: override.emptyMessage || config.emptyMessage || 'No values found',
      allowCreate: Boolean(override.allowCreate ?? config.allowCreate ?? false),
      isUdf: Boolean(override.isUdf),
      columns: override.columns || config.columns || null,
    });
  };

  const closeLineLookup = () => {
    setLineLookupModal((prev) => ({ ...prev, open: false, lineIndex: -1, field: '' }));
  };

  const handleLineLookupSelect = (option) => {
    if (lineLookupModal.lineIndex < 0 || !lineLookupModal.field) return;
    const selectedValue = option?.value || '';
    setLines((prev) => prev.map((line, lineIndex) => {
      if (lineIndex !== lineLookupModal.lineIndex) return line;
      if (lineLookupModal.isUdf) {
        return { ...line, udf: { ...(line.udf || {}), [lineLookupModal.field]: selectedValue } };
      }
      const next = { ...line, [lineLookupModal.field]: selectedValue };
      if (lineLookupModal.field === 'glAccount') {
        Object.assign(next, populateServiceAccountLine(next, option, accounts));
      }
      if (lineLookupModal.field === 'loc') {
        next.locCode = option?.code || '';
        next.loc = option?.locationName || selectedValue;
      }
      if (lineLookupModal.field === 'sItem' && !String(next.description || '').trim()) {
        next.description = option?.description || next.description;
      }
      if (lineLookupModal.field === 'sItem' && option?.wtaxLiable) {
        next.wtaxLiable = option.wtaxLiable;
      }
      if (lineLookupModal.field === 'sac' && !String(next.description || '').trim()) {
        next.description = option?.description || next.description;
      }
      if (lineLookupModal.field === 'freightProvider') {
        next.freightProviderName = option?.description || option?.bpName || '';
      }
      return updateLineCalculatedValues(next);
    }));
  };

  const handleHeaderChange = async (event) => {
    if (!isDocumentEditable) return;
    const { name, value, type, checked } = event.target;
    const nextValue = type === 'checkbox' ? checked : value;

    if (name === 'vendor') {
      const vendor = toArray(refData.vendors, ['vendors']).find((item) => String(item.CardCode || item.code || '') === String(value));
      setHeader((prev) => ({
        ...prev,
        vendor: value,
        name: vendor?.CardName || vendor?.name || prev.name,
        contactPerson: '',
        shipToCode: '',
        shipToAddress: '',
        billToCode: '',
        billToAddress: '',
      }));
      if (vendor) await loadVendorDetails(value);
      return;
    }

    if (name === 'postingDate') { setHeader(prev => ({ ...prev, [name]: value, exchangeRate: '', series: '', nextNumber: '', docNo: '' })); return; }

    if (name === 'series') {
 const manual = ['-1','manual'].includes(String(value));
 if(manual && !canUseManualSeries(refData)) return;
 const selected = (refData.series || []).find(row => String(row.Series) === String(value));
 setHeader(prev => ({ ...prev, series: manual ? 'manual' : selected ? String(selected.Series) : '', nextNumber: manual ? '' : String(selected?.NextNumber ?? ''), docNo: '' })); return;
}

    if (name === 'shipToCode') {
      const selected = vendorEffectiveShipToAddresses.find((address) => String(address.Address || '') === String(value));
      setHeader((prev) => ({
        ...prev,
        shipToCode: value,
        shipToAddress: selected ? fmtAddr(selected) : prev.shipToAddress,
        placeOfSupply: selected?.State || prev.placeOfSupply,
      }));
      return;
    }

    if (name === 'billToCode' || name === 'payToCode') {
      const selected = vendorEffectiveBillToAddresses.find((address) => String(address.Address || '') === String(value));
      setHeader((prev) => ({
        ...prev,
        billToCode: value,
        payToCode: value,
        billToAddress: selected ? fmtAddr(selected) : prev.billToAddress,
        placeOfSupply: (prev.useBillToForTax || prev.usePayToForTax) && selected?.State ? selected.State : prev.placeOfSupply,
      }));
      return;
    }

    if (name === 'transactionType') { setHeader(prev => ({ ...prev, [name]: value, exchangeRate: '', series: '', nextNumber: '', docNo: '' })); return; }

    setHeader((prev) => ({
      ...prev,
      [name]: nextValue,
      ...(name === 'currency' ? { exchangeRate: '' } : {}),
      ...(name === 'remarks' ? { otherInstruction: nextValue } : {}),
      ...(name === 'otherInstruction' ? { remarks: nextValue } : {}),
    }));
  };

  const handleLineChange = (index, event) => {
    if (!isDocumentEditable) return;
    const { name, value } = event.target;
    setValErrors((prev) => ({ ...prev, lines: { ...prev.lines, [index]: { ...(prev.lines[index] || {}), [name]: '' } }, form: '' }));
    setLines((prev) => prev.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = { ...line, [name]: value };
      if (name === 'glAccount') {
        Object.assign(next, populateServiceAccountLine(next, { value }, accounts));
      }
      if (name === 'taxCode') {
        next.taxCodeRepeat = value;
      }
      if (name === 'loc') {
        next.locCode = '';
      }
      return ['taxCode', 'discountPercent', 'priceAfterDisc', 'totalLC', 'unitPrice', 'sQty'].includes(name)
        ? updateLineCalculatedValues(next, name)
        : next;
    }));
  };

  const handleLineBlur = (index, fieldName) => {
    if (!isDocumentEditable || fieldName !== 'priceAfterDisc') return;
    setLines((prev) => prev.map((line, lineIndex) => (
      lineIndex === index && line._pendingPriceDiscountApplication
        ? updateLineCalculatedValues(line, 'priceAfterDiscCommit')
        : line
    )));
  };

  const addLine = () => {
    if (!isDocumentEditable) return;
    setLines((prev) => [...prev, createLine(rowUdfDefinitions)]);
  };

  const removeLine = (index) => {
    if (!isDocumentEditable) return;
    setLines((prev) => (prev.length <= 1 ? [createLine(rowUdfDefinitions)] : prev.filter((_line, lineIndex) => lineIndex !== index)));
  };

  const handleHeaderUdfChange = (key, value) => {
    if (!isDocumentEditable) return;
    setHeaderUdfs((prev) => ({ ...prev, [key]: value }));
  };

  const handleRowUdfChange = (lineIndex, key, value) => {
    if (!isDocumentEditable) return;
    setLines((prev) => prev.map((line, index) => (
      index === lineIndex ? { ...line, udf: { ...(line.udf || {}), [key]: value } } : line
    )));
  };

  const updateFormSetting = (groupKey, fieldKey, prop, value) => setFormSettings((prev) => (
    updateFormSettingPreference(prev, groupKey, fieldKey, prop, value)
  ));

  const toggleHeaderUdfs = () => {
    setFormSettingsOpen(false);
    setSidebarOpen((prev) => !prev);
  };

  const toggleFormSettings = () => {
    if (!companyFormSettingsReady) return;
    setSidebarOpen(false);
    setFormSettingsOpen((prev) => !prev);
  };

  const openAddressModal = (type) => {
    if (!isDocumentEditable) return;
    const normalizedType = type === 'payTo' ? 'billTo' : type;
    const addressPool = normalizedType === 'billTo' ? vendorEffectiveBillToAddresses : vendorEffectiveShipToAddresses;
    const selectedCode = normalizedType === 'billTo' ? header.billToCode : header.shipToCode;
    const selectedAddress = addressPool.find((address) => String(address.Address || '') === String(selectedCode || ''));

    setAddressForm(mapAddressToModalForm(selectedAddress, {
      shipToCode: header.shipToCode || '',
      shipToAddress: header.shipToAddress || '',
      billToCode: header.billToCode || '',
      billToAddress: header.billToAddress || '',
    }));
    setAddressModal({ type: normalizedType });
  };

  const closeAddressModal = () => {
    setAddressModal(null);
  };

  const handleAddressFormChange = (event) => {
    const { name, value } = event.target;
    setAddressForm((prev) => ({ ...prev, [name]: value }));
  };

  const saveAddressModal = () => {
    if (!isDocumentEditable || !addressModal) return;
    const formatted = [
      [addressForm.streetPoBox, addressForm.streetNo].filter(Boolean).join(', '),
      addressForm.buildingFloorRoom,
      [addressForm.block, addressForm.city].filter(Boolean).join(', '),
      [addressForm.county, addressForm.state, addressForm.zipCode].filter(Boolean).join(', '),
      addressForm.countryRegion,
      addressForm.addressName2,
      addressForm.addressName3,
    ].filter(Boolean).join('\n');

    setHeader((prev) => ({
      ...prev,
      shipToCode: addressForm.shipToCode || prev.shipToCode,
      shipToAddress: addressModal.type === 'shipTo' ? (formatted || addressForm.shipToAddress) : (addressForm.shipToAddress || prev.shipToAddress),
      billToCode: addressForm.billToCode || prev.billToCode,
      billToAddress: addressModal.type === 'billTo' ? (formatted || addressForm.billToAddress) : (addressForm.billToAddress || prev.billToAddress),
      placeOfSupply:
        addressForm.state && (addressModal.type === 'shipTo' || prev.useBillToForTax || prev.usePayToForTax)
          ? addressForm.state
          : prev.placeOfSupply,
    }));
    closeAddressModal();
  };

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

  const handleTaxInfoFormChange = (event) => {
    const { name, value } = event.target;
    setTaxInfoForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleBrowseAttachment = () => {
    if (!isDocumentEditable) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length) {
        setPageState((prev) => ({ ...prev, success: `Selected ${files.length} file(s). Upload will be added later.`, error: '' }));
      }
    };
    input.click();
  };

  const validate = ({ requireDescription = true } = {}) => {
    const errors = { header: {}, lines: {}, form: '' };
    if (!String(header.vendor || '').trim()) errors.header.vendor = 'Vendor is required';
    if (!String(header.postingDate || '').trim()) errors.header.postingDate = 'Posting Date is required';
    if (!String(header.documentDate || '').trim()) errors.header.documentDate = 'Document Date is required';
    if (!String(header.currency || '').trim()) errors.header.currency = 'Document Currency is required';
    const localCurrency = String(refData.local_currency || refData.company_currency || '').trim();
    if (header.currency && localCurrency && String(header.currency).trim() !== localCurrency) {
      const rate = Number(header.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) errors.header.exchangeRate = 'A positive exchange rate is required';
    }
    if (header.series === 'manual' && parseNum(header.docNo) <= 0) errors.header.docNo = 'Document No. is required for Manual series';

    const populated = lines.filter((line) => String(line.description || line.glAccount || line.totalLC || '').trim());
    if (!populated.length) errors.form = 'At least one service line is required.';
    lines.forEach((line, index) => {
      if (!String(line.description || line.glAccount || line.totalLC || '').trim()) return;
      const lineErrors = {};
      if (requireDescription && !String(line.description || '').trim()) lineErrors.description = 'Description is required';
      if (!String(line.glAccount || '').trim()) lineErrors.glAccount = 'G/L Account is required';
      if (!String(line.taxCode || '').trim()) lineErrors.taxCode = 'Tax Code is required';
      if (parseNum(line.totalLC) <= 0) lineErrors.totalLC = 'Total is required';
      if (Object.keys(lineErrors).length) errors.lines[index] = lineErrors;
    });
    if (!String(header.series || '').trim()) {
      errors.form = `No numbering series is available for posting date ${header.postingDate}. Check the financial year and branch.`;
    }
    return errors;
  };

  const buildPayload = () => ({
    header: {
      ...header,
      roundingAmount: getDocumentRoundingPayloadAmount(header, totals.roundingAmount),
      roundingAmountIsManual: header.roundingAmountIsManual === true,
      wtaxAmount,
      totalPaymentDue: totalPaymentDueAfterWTax,
    },
    lines: lines
      .filter((line) => String(line.description || line.glAccount || line.totalLC || '').trim())
      .map((line) => ({
        ...line,
        udf: buildVisibleEnteredRowUdfPayload(rowUdfDefinitions, line.udf || {}, formSettings),
      })),
    header_udfs: normalizeUdfState(headerUdfDefinitions, headerUdfs),
    totals: { ...totals, wtaxAmount, total: totalPaymentDueAfterWTax, balanceDue: balanceDueAfterWTax },
    withholdingTaxRows: wtaxRowsForTotals,
  });

  const openJournalLinkedMaster = (line = {}) => {
    const code = String(line.account || '').trim();
    if (!code) return;

    setJournalPreview((prev) => ({ ...prev, open: false }));
    const isBusinessPartnerLine = line.goldenArrowTarget === 'businessPartner' || Boolean(String(line.controlAccount || '').trim());
    if (isBusinessPartnerLine) {
      navigate(`/business-partner?cardCode=${encodeURIComponent(code)}`, {
        state: createActiveCompanyScopedRouteState({
          businessPartnerCardCode: code,
          cardCode: code,
        }),
      });
      return;
    }

    navigate(`/chart-of-accounts?accountCode=${encodeURIComponent(code)}`, {
      state: createActiveCompanyScopedRouteState({
        accountCode: code,
        glAccountCode: code,
      }),
    });
  };

  const previewJournalEntry = async ({ persist = false, docEntry = currentDocEntry } = {}) => {
    const errors = validate({ requireDescription: false });
    if (errors.form || Object.keys(errors.header).length || Object.keys(errors.lines).length) {
      setValErrors(errors);
      setPageState((prev) => ({ ...prev, success: '', error: errors.form || 'Please correct the highlighted fields before previewing Journal Entry.' }));
      return null;
    }

    setJournalPreview((prev) => ({ ...prev, open: true, loading: true, error: '' }));
    try {
      const res = await generateServiceAPInvoiceJournalEntry({
        docEntry,
        payload: docEntry ? null : buildPayload(),
        persist,
      });
      setJournalPreview({ open: true, loading: false, data: res.data, error: '' });
      setPageState((prev) => ({ ...prev, error: '' }));
      return res.data;
    } catch (error) {
      const message = error.response?.data?.message || error.message || 'Failed to preview Journal Entry.';
      setJournalPreview((prev) => ({ ...prev, loading: false, error: message }));
      setPageState((prev) => ({ ...prev, success: '', error: message }));
      return null;
    }
  };

  const narrowConfirmationUpdate = useConfirmationOnlyUpdate({
    docEntry: currentDocEntry, isDirty,
    state: { header, lines, headerUdfs, withholdingTax, companyDb: activeCompanyDb , company_id: activeCompanyId, companyKey: formSettingsStorageKey },
  });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!companyFormSettingsReady) {
      setPageState((prev) => ({
        ...prev,
        success: '',
        error: 'Select a company and wait for its Form Settings to load before saving this document.',
      }));
      return;
    }
    if (!isDocumentEditable) {
      setPageState((prev) => ({ ...prev, success: '', error: 'Closed Service A/P Invoices cannot be edited.' }));
      return;
    }
    if (currentDocEntry && !hasUnsavedChanges) return;

    const errors = validate();
    if (errors.form || Object.keys(errors.header).length || Object.keys(errors.lines).length) {
      setValErrors(errors);
      setPageState((prev) => ({ ...prev, success: '', error: errors.form || 'Please correct the highlighted fields.' }));
      return;
    }

    setPageState((prev) => ({ ...prev, posting: true, error: '', success: '' }));
    try {
      const res = currentDocEntry
        ? await updateServiceAPInvoice(currentDocEntry, narrowConfirmationUpdate(buildPayload()))
        : await submitServiceAPInvoice(buildPayload());
      const docEntry = res.data?.doc_entry || res.data?.DocEntry || currentDocEntry;
      const docNum = res.data?.doc_num || res.data?.DocNum || header.docNo;
      setCurrentDocEntry(docEntry);
      setHeader((prev) => ({ ...prev, docNo: docNum ? String(docNum) : prev.docNo, status: 'Open' }));
      setIsDirty(false);
      setPageState((prev) => ({ ...prev, posting: false, success: `${res.data?.message || 'Service A/P Invoice saved.'}${docNum ? ` Doc No: ${docNum}` : ''}` }));
    } catch (error) {
      const message = error.response?.data?.detail?.error?.message?.value || error.response?.data?.message || error.message || 'Service A/P Invoice submission failed.';
      setPageState((prev) => ({ ...prev, posting: false, error: message }));
    }
  };

  const resetForm = () => {
    setSeriesRevision(value => value + 1);

    const firstSeries = getDefaultSeriesForCurrentYear(seriesOptions);
    setIsDirty(false);
    setCurrentDocEntry(null);
    setHeader({
      ...INIT_HEADER,
      branch: String(firstSeries?.BPLId || ''),
      series: firstSeries ? String(firstSeries.Series || '') : '',
      nextNumber: firstSeries ? String(firstSeries.NextNumber || '') : '',
    });
    setHeaderUdfs(createUdfState(headerUdfDefinitions));
    setLines([createLine(rowUdfDefinitions)]);
    setActiveTab('Contents');
    setValErrors({ header: {}, lines: {}, form: '' });
    setJournalPreview({ open: false, loading: false, data: null, error: '' });
    setPageState((prev) => ({ ...prev, error: '', success: '' }));
  };

  const openCopyFromModal = (docType) => {
    if (!isDocumentEditable || currentDocEntry) return;
    if (!header.vendor) {
      setValErrors({ header: { vendor: 'Select Vendor first' }, lines: {}, form: '' });
      return;
    }
    setCopyFromDocType(docType);
    setCopyFromModal(true);
  };

  const fetchCopyFromDocuments = async (docType) => {
    const vendorCode = String(header.vendor || '').trim();
    if (docType === 'purchaseQuotation') {
      const res = await fetchOpenServicePurchaseQuotationsForAPInvoice(vendorCode);
      return res.data?.documents || [];
    }
    if (docType === 'purchaseOrder') {
      const res = await fetchOpenServicePurchaseOrdersForAPInvoice(vendorCode);
      return res.data?.documents || [];
    }
    if (docType === 'grpo') {
      const res = await fetchOpenServiceGRPOForAPInvoice(vendorCode);
      return res.data?.documents || [];
    }
    return [];
  };

  const fetchCopyFromDocumentDetails = async (docType, docEntry) => {
    if (docType === 'purchaseQuotation') {
      const res = await fetchServicePurchaseQuotationForAPInvoiceCopy(docEntry);
      return res.data;
    }
    if (docType === 'purchaseOrder') {
      const res = await fetchServicePurchaseOrderForAPInvoiceCopy(docEntry);
      return res.data;
    }
    if (docType === 'grpo') {
      const res = await fetchServiceGRPOForAPInvoiceCopy(docEntry);
      return res.data;
    }
    return null;
  };

  const refreshSeriesForNewDocument = async ({ postingDate = header.postingDate, transactionType = header.transactionType, branch = header.branch } = {}) => { setHeader(prev => ({ ...prev, postingDate, transactionType, branch, series: '', nextNumber: '', docNo: '' })); };

  const handleCopyFrom = async (data, sourceType) => {
    setSeriesRevision(value => value + 1);

    const copySource = unwrapCopyFromDocument(data);
    const sourceLines = toArray(copySource.lines, ['lines', 'DocumentLines']);
    const copyKey = `${sourceType}-${copySource.docEntry}-${sourceLines.length}`;
    if (handledCopyFromRef.current === copyKey) return;
    handledCopyFromRef.current = copyKey;

    const normalizedHeader = normaliseDocumentHeader(copySource.header);
    const copyDate = today();
    const copyTransactionType = normalizedHeader.transactionType
      || header.transactionType
      || transactionTypeOptions[0]?.value
      || 'GST Tax Invoice';
    const copyBranch = normalizedHeader.branch || header.branch || '';
    setHeader((prev) => ({
      ...prev,
      ...normalizedHeader,
      postingDate: copyDate,
      documentDate: copyDate,
      deliveryDate: copyDate,
      exchangeRate: '',
      transactionType: copyTransactionType,
      branch: copyBranch,
      wtaxAmount: '',
      series: '',
      nextNumber: '',
      docNo: '',
    }));
    setWithholdingTax(createEmptyWithholdingTaxState());
    const baseType = BASE_TYPE[sourceType] || 17;
    const copyLines = sourceLines;
    setLines(copyLines.length
      ? copyLines.map((line, index) => ({
        ...normalizeCopyLine(line, index, copySource.docEntry, baseType, accounts),
        udf: createUdfState(rowUdfDefinitions),
      }))
      : [createLine(rowUdfDefinitions)]);
    setActiveTab('Contents');
    if (normalizedHeader.vendor) {
      loadVendorDetails(normalizedHeader.vendor);
    }
    await refreshSeriesForNewDocument({
      postingDate: copyDate,
      transactionType: copyTransactionType,
      branch: copyBranch,
      preferredSeries: '',
    });
    setPageState((prev) => ({ ...prev, success: 'Copied service document lines.', error: '' }));
  };

  const handleCopyTo = async () => {
    await copyToDocument({
      sourceDocType: 'serviceApInvoice',
      targetType: 'apCreditMemo',
      sourceDocEntry: currentDocEntry,
      sourceDocNo: header.docNo,
      sourcePath: location.pathname,
      sourceSnapshot: {
        header,
        lines: lines.map((line) => ({ ...line, udf: normalizeUdfState(rowUdfDefinitions, line.udf || {}) })),
        headerUdfs: normalizeUdfState(headerUdfDefinitions, headerUdfs),
      },
      restoreState: { serviceApInvoiceDocEntry: currentDocEntry },
      navigate,
      upsertTask,
      removeTask,
      setError: (message) => setPageState((prev) => ({ ...prev, success: '', error: message })),
      errorMessage: 'Please save the Service A/P Invoice first before copying.',
    });
  };

  const handleDuplicate = async () => {
    setSeriesRevision(value => value + 1);

    const duplicateDate = today();
    const duplicateTransactionType = header.transactionType || transactionTypeOptions[0]?.value || 'GST Tax Invoice';
    const duplicateBranch = header.branch || '';
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
      navigate,
      location,
      successMessage: 'Service A/P invoice duplicated. Review and add it as a new entry.',
    });

    if (duplicated) {
      setHeader((prev) => ({
        ...prev,
        postingDate: duplicateDate,
        documentDate: duplicateDate,
        deliveryDate: duplicateDate,
        transactionType: duplicateTransactionType,
        branch: duplicateBranch,
        wtaxAmount: '',
        series: '',
        nextNumber: '',
        docNo: '',
      }));
      setWithholdingTax((prev) => ({ ...prev, rows: [], open: false }));
      await refreshSeriesForNewDocument({
        postingDate: duplicateDate,
        branch: duplicateBranch,
        transactionType: duplicateTransactionType,
        preferredSeries: header.series,
      });
    }
  };

  const renderLineCell = (line, index, column) => {
    const numericValue = column.key === 'priceAfterDisc'
      ? Number(line.unitPrice || 0) * (1 - Number(line.discountPercent || 0) / 100)
      : line[column.key];
    const error = valErrors.lines[index]?.[column.key];
    if (column.isUdf) {
      const disabled =
        !isDocumentEditable ||
        column.readOnly ||
        formSettings.rowUdfs?.[column.udfKey]?.active === false;
      const value = line.udf?.[column.udfKey] || '';

      if (column.lookupSource) {
        return (
          <div className="service-ap-lookup-cell">
            <input className="del-grid__input" value={value} disabled={disabled} onChange={(event) => handleRowUdfChange(index, column.udfKey, event.target.value)} title={`Select ${column.label}`} />
            <button
              type="button"
              className="del-btn service-ap-lookup-btn"
              disabled={disabled}
              title={`Select ${column.label}`}
              onClick={async () => {
                try {
                  const options = await loadSalesDocumentFieldLookupOptions({
                    fetchLookup: fetchSalesDocumentLookup,
                    source: column.lookupSource,
                    field: column,
                    line,
                    documentType: 'SERVICE_AP_INVOICE',
                    schemaVersion: refData.line_field_metadata?.live_schema?.schemaVersion || '',
                  });
                  openLineLookup(column.udfKey, index, { title: `Select ${column.label}`, options, isUdf: true });
                } catch (_error) {
                  openLineLookup(column.udfKey, index, { title: `Select ${column.label}`, options: column.options || [], isUdf: true });
                }
              }}
            >...</button>
          </div>
        );
      }

      if (column.type === 'checkbox') {
        const checked = ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase());
        return (
        <input
          type="checkbox"
          data-sap-native-tab="true"
            className="form-check-input service-ap-udf-checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => handleRowUdfChange(index, column.udfKey, event.target.checked ? 'Y' : 'N')}
          />
        );
      }

      if (column.type === 'select') {
        return (
          <select
            className="del-grid__input"
            value={value}
            disabled={disabled}
            onChange={(event) => handleRowUdfChange(index, column.udfKey, event.target.value)}
          >
            <option value=""></option>
            {toArray(column.options, ['options']).map((option) => {
              const normalized = typeof option === 'object' ? option : { value: option, label: option };
              return (
                <option key={normalized.value} value={normalized.value}>
                  {normalized.label}
                </option>
              );
            })}
          </select>
        );
      }

      return (
        <SapInput
          className="del-grid__input"
          type={column.type === 'date' ? 'date' : column.type === 'number' ? 'number' : 'text'}
          value={value}
          disabled={disabled}
          onChange={(event) => handleRowUdfChange(index, column.udfKey, event.target.value)}
        />
      );
    }

    const renderLookupInput = ({ value = line[column.key] || '', onOpen, readOnly = false, title = 'Select value' }) => (
      <div className="service-ap-lookup-cell">
        <input
          className={`del-grid__input${error ? ' del-field__input--error' : ''}`}
          name={column.key}
          value={value}
          onChange={(event) => handleLineChange(index, event)}
          readOnly={readOnly}
          disabled={!isDocumentEditable || readOnly}
          title={title}
        />
        <button
          type="button"
          className="del-btn service-ap-lookup-btn"
          onClick={onOpen}
          disabled={!isDocumentEditable}
          title={title}
        >
          ...
        </button>
      </div>
    );

    if (column.lookup === 'tax') {
      return (
        <TaxCodeLookup
          className={`del-grid__input${error ? ' del-field__input--error' : ''}`}
          name={column.key}
          value={line[column.key] || ''}
          onChange={(event) => handleLineChange(index, event)}
          taxCodes={taxCodes}
          disabled={!isDocumentEditable}
        />
      );
    }

    if (column.lookup === 'yesNo') {
      return (
        <select className="del-grid__input" name={column.key} value={line[column.key] || 'Yes'} onChange={(event) => handleLineChange(index, event)} disabled={!isDocumentEditable}>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      );
    }

    if (column.lookup === 'distRule') {
      return renderLookupInput({
        title: 'Select Distribution Rule',
        onOpen: () => openLineLookup('distRule', index, {
          title: 'List of Distribution Rules',
          options: distributionRuleLookupOptions,
          searchPlaceholder: 'Search distribution rules',
          emptyMessage: 'No distribution rules found',
          columns: [
            { key: 'value', label: 'Distr. Rule', width: 140, primary: true },
            { key: 'description', label: 'Description' },
          ],
        }),
      });
    }

    if (column.lookup === 'account') {
      return renderLookupInput({
        title: 'Select G/L Account',
        onOpen: () => openLineLookup('glAccount', index, {
          title: 'List of G/L Accounts',
          options: accountLookupOptions,
          searchPlaceholder: 'Search G/L accounts',
          emptyMessage: 'No G/L accounts found',
          columns: [
            { key: 'accountNumber', label: 'Account Number', width: 150, primary: true },
            { key: 'accountName', label: 'Account Name' },
            { key: 'accountBalance', label: 'Account Balance', width: 130, align: 'right' },
            { key: 'inactive', label: 'Inactive', width: 90 },
          ],
        }),
      });
    }

    if (column.lookup === 'sac') {
      return renderLookupInput({
        title: 'Select SAC Code',
        onOpen: () => openLineLookup('sac', index),
      });
    }

    if (column.lookup === 'location') {
      return renderLookupInput({
        value: resolveLocationDisplayName(line.loc, locationLookupOptions),
        readOnly: true,
        title: 'Select Location',
        onOpen: () => openLineLookup('loc', index),
      });
    }

    if (column.lookup === 'item') {
      return renderLookupInput({
        title: 'Select Item',
        onOpen: () => openLineLookup('sItem', index),
      });
    }

    if (LINE_LOOKUP_FIELDS.has(column.key)) {
      return renderLookupInput({
        title: `Select ${column.label}`,
        onOpen: () => openLineLookup(column.key, index),
      });
    }

    return (
      <SapInput
        className={`del-grid__input${error ? ' del-field__input--error' : ''}`}
        type={column.type === 'date' ? 'date' : 'text'}
        name={column.key}
        value={column.readOnly && column.numeric ? String(displayAmount(numericValue ?? 0)) : (column.key === 'taxCodeRepeat' ? (line.taxCodeRepeat || line.taxCode || '') : (line[column.key] || ''))}
        onChange={(event) => handleLineChange(index, event)}
        onBlur={() => handleLineBlur(index, column.key)}
        readOnly={column.readOnly}
        disabled={!isDocumentEditable || column.readOnly}
        style={{ textAlign: column.numeric || column.readOnly ? 'right' : 'left' }}
      />
    );
  };

  const vendorOptions = toArray(refData.vendors, ['vendors']);
  const contactOptions = toArray(refData.contacts, ['contacts']);
  const visibleHeaderUdfs = headerUdfDefinitions.filter((field) => formSettings.headerUdfs?.[field.key]?.visible !== false);
  const configurableRowUdfs = formSettingsStatus.queryLayout?.isPublished
    ? [] : rowUdfDefinitions.filter((field) => !isFixedServiceMatrixField(field));
  const visibleLineColumns = getOrderedVisibleMatrixColumns([
    ...effectiveMatrixColumns,
    ...configurableRowUdfs.map((field) => ({
      key: `udf:${field.key}`,
      udfKey: field.key,
      label: field.label,
      width: Number(field.minWidth || field.width) || Math.max(140, Math.min(Number(field.maxLength || 160), 260)),
      order: Number(field.columnOrder ?? field.order) || 1000,
      type: field.type,
      readOnly: field.readOnly,
      isUdf: true,
      options: toArray(field.options, ['options']),
      lookupSource: field.lookupSource,
      lookupTable: field.lookupTable,
      fieldId: field.fieldId,
      schemaFieldId: field.schemaFieldId,
    })),
  ], formSettings).map((column) => {
    const width = getReadableDocumentLineColumnWidth(column);
    return { ...column, width, minWidth: width };
  });
  const tableMinWidth = 42 + 48 + visibleLineColumns.reduce((sum, column) => sum + column.width, 0);

  useDocumentSeries({ endpoint: '/services/ap-invoice', companyKey: formSettingsStorageKey, currentDocEntry, header: header, setHeader, setRefData, setPageState, ready: !pageState.loading && !pageState.posting , refreshKey: seriesRevision});

  return (
    <form ref={workspaceRef} className={`ap-invoice-page del-page sap-document-page service-ap-invoice-page${isRightSidebarOpen ? ' del-page--sidebar-open' : ''}`} onSubmit={handleSubmit} onChangeCapture={markDirty}>
      <div className="del-toolbar sap-document-toolbar">
        <span className="del-toolbar__title sap-document-toolbar__title">Service A/P Invoice{currentDocEntry ? ` - #${header.docNo || currentDocEntry}` : ''}</span>
        <button type="submit" className="del-btn del-btn--primary sap-document-toolbar__primary" disabled={pageState.posting || !isDocumentEditable} title={primaryActionLabel}>
          {primaryActionLabel}
        </button>
        <button type="button" className="del-btn sap-document-toolbar__cancel" onClick={resetForm}>Cancel</button>
        <button type="button" className="del-btn sap-document-toolbar__udf" onClick={toggleHeaderUdfs}>
          {sidebarOpen ? 'Hide UDFs' : 'Show UDFs'}
        </button>
        <button type="button" className="del-btn sap-document-toolbar__settings" onClick={toggleFormSettings} disabled={!companyFormSettingsReady} title={companyFormSettingsReady ? 'Choose document-line fields' : 'Loading company Form Settings'}>Form Settings</button>
        {!currentDocEntry && (
          <button
            type="button"
            className="del-btn sap-document-toolbar__journal-preview"
            onClick={() => previewJournalEntry({ persist: false })}
            disabled={pageState.posting || journalPreview.loading}
          >
            Preview Journal Entry
          </button>
        )}
        <button type="button" className="del-btn sap-document-toolbar__find" onClick={() => navigate('/services/ap-invoice/find')}>Find</button>
        <button type="button" className="del-btn sap-document-toolbar__new" onClick={resetForm}>New</button>
        <DocumentStatusActions
          type="service-ap-invoice"
          docEntry={currentDocEntry}
          actions={['cancel']}
          className="del-btn"
          disabled={pageState.posting || pageState.loading}
          onDone={async (action) => {
            const res = await fetchServiceAPInvoiceByDocEntry(currentDocEntry).catch(() => null);
            const status = res?.data?.service_ap_invoice?.header?.status;
            if (status) setHeader((prev) => ({ ...prev, status }));
            setPageState((prev) => ({ ...prev, error: '', success: getDocumentStatusMessage(action) }));
          }}
          onError={(message) => setPageState((prev) => ({ ...prev, error: message, success: '' }))}
        />
        <div className="del-dropdown" style={{ position: 'relative', display: 'inline-block' }}>
          <button type="button" className="del-btn" disabled={!isDocumentEditable || !!currentDocEntry} onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const dropdown = event.currentTarget.parentElement;
            const isActive = dropdown.classList.contains('active');
            document.querySelectorAll('.del-dropdown').forEach((item) => item.classList.remove('active'));
            if (!isActive) dropdown.classList.add('active');
          }}>
            Copy From
          </button>
          <div className="del-dropdown-menu">
            {[
              { key: 'purchaseQuotation', label: 'Purchase Quotations' },
              { key: 'purchaseOrder', label: 'Purchase Orders' },
              { key: 'grpo', label: 'Goods Receipt POs' },
            ].map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openCopyFromModal(option.key);
                  document.querySelectorAll('.del-dropdown').forEach((item) => item.classList.remove('active'));
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="del-btn sap-document-toolbar__copy" onClick={handleCopyTo} disabled={!currentDocEntry}>Copy To</button>
        {currentDocEntry && (
          <button type="button" className="del-btn sap-document-toolbar__duplicate" onClick={handleDuplicate}>
            Duplicate
          </button>
        )}
      </div>

      {pageState.loading && <div className="alert alert-success py-2">Loading...</div>}
      {pageState.error && <div className="alert alert-danger py-2">{pageState.error}</div>}
      {pageState.success && <div className="alert alert-success py-2">{pageState.success}</div>}


      <fieldset disabled={pageState.posting} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className={`so-layout${isRightSidebarOpen ? ' is-sidebar-open' : ''}`}>
          <div className="so-layout__main">
        <div className="del-header-card service-ap-header-card">
          <div className="del-field-grid service-ap-header-grid">
            <div>
              <div className="del-field">
                <label className="del-field__label">Vendor</label>
                <div className="service-ap-header-lookup">
                  <input className={`del-field__input${valErrors.header.vendor ? ' del-field__input--error' : ''}`} name="vendor" value={header.vendor} list="service-ap-invoice-vendors" onChange={handleHeaderChange} onBlur={() => loadVendorDetails(header.vendor)} disabled={!isDocumentEditable} />
                  <button type="button" className="del-btn service-ap-lookup-btn" onClick={() => setBpModalOpen(true)} disabled={!isDocumentEditable} title="List of Business Partners">...</button>
                </div>
              </div>
              <div className="del-field">
                <label className="del-field__label">Name</label>
                <input className="del-field__input" name="name" value={header.name} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
              </div>
              <div className="del-field">
                <label className="del-field__label">Contact Person</label>
                <select className="del-field__select" name="contactPerson" value={header.contactPerson} onChange={handleHeaderChange} disabled={!isDocumentEditable}>
                  <option value=""></option>
                  {contactOptions.map((contact) => (
                    <option key={contact.CntctCode || contact.Name} value={contact.CntctCode}>
                      {contact.Name || [contact.FirstName, contact.LastName].filter(Boolean).join(' ') || contact.CntctCode}
                    </option>
                  ))}
                </select>
              </div>
              <div className="del-field">
                <label className="del-field__label">Vendor Ref. No</label>
                <input className="del-field__input" name="salesContractNo" value={header.salesContractNo} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
              </div>

              <DocumentCurrencySelect
                classPrefix="del"
                header={header}
                onHeaderChange={handleHeaderChange}
                businessPartners={refData.vendors || []}
                currencyOptions={refData.currencies || refData.company_currencies?.currencies || []}
                localCurrency={refData.local_currency || refData.company_currency || ''}
                systemCurrency={refData.system_currency || refData.local_currency || refData.company_currency || ''}
                fallbackLocalCurrency={''}
                disabled={!isDocumentEditable || !header.vendor}
              />

              <div className="del-field">
                <label className="del-field__label">Transaction Type</label>
                <select className="del-field__select" name="transactionType" value={header.transactionType} onChange={handleHeaderChange} disabled={!isDocumentEditable}>
                  {transactionTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="del-field">
                <label className="del-field__label">No.</label>
                <div className="service-ap-docnum">
                  <select className="del-field__select" name="series" value={header.series} onChange={handleHeaderChange} disabled={!isDocumentEditable || currentDocEntry || pageState.seriesLoading}>
                    <option value="">{pageState.seriesLoading ? 'Loading series...' : pageState.seriesError ? 'Series unavailable' : 'Select Series'}</option>
                    {(canUseManualSeries(refData) || (currentDocEntry && ['-1','manual','__sap_manual__'].includes(String(header.series)))) && (<option value="manual">Manual</option>)}
                    {seriesOptions.map((series) => (
                      <option key={series.Series} value={series.Series}>{series.SeriesName}</option>
                    ))}
                  </select>
                  <input
                    className={`del-field__input${valErrors.header.docNo ? ' del-field__input--error' : ''}`}
                    name="docNo"
                    value={currentDocEntry ? (header.docNo || header.nextNumber || '') : pageState.seriesLoading ? '...' : (header.docNo || header.nextNumber || '')}
                    onChange={handleHeaderChange}
                    readOnly={header.series !== 'manual'}
                    disabled={!isDocumentEditable || currentDocEntry || pageState.seriesLoading}
                  />
                </div>
              </div>
              <div className="del-field">
                <label className="del-field__label">Status</label>
                <input className="del-field__input" value={header.status} readOnly />
              </div>
              <div className="del-field">
                <label className="del-field__label">Posting Date</label>
                <SapDateInput  className={`del-field__input${valErrors.header.postingDate ? ' del-field__input--error' : ''}`} name="postingDate" value={header.postingDate} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
              </div>
              <div className="del-field">
                <label className="del-field__label">Due Date</label>
                <SapDateInput  className="del-field__input" name="deliveryDate" value={header.deliveryDate} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
              </div>
              <div className="del-field">
                <label className="del-field__label">Document Date</label>
                <SapDateInput  className={`del-field__input${valErrors.header.documentDate ? ' del-field__input--error' : ''}`} name="documentDate" value={header.documentDate} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
              </div>
              <div className="del-field">
                <label className="del-field__label">Place of Supply</label>
                <div className="service-ap-header-lookup">
                  <input className="del-field__input" name="placeOfSupply" value={header.placeOfSupply} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
                  <button type="button" className="del-btn service-ap-lookup-btn" onClick={() => setStateModalOpen(true)} disabled={!isDocumentEditable} title="List of States">...</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="del-tabs">
          {TAB_NAMES.map((tabName) => (
            <button
              key={tabName}
              type="button"
              className={`del-tab${activeTab === tabName ? ' del-tab--active' : ''}`}
              onClick={() => setActiveTab(tabName)}
            >
              {tabName}
            </button>
          ))}
        </div>

        {activeTab === 'Contents' && (
          <div className="del-tab-panel" style={{ overflow: 'visible', minWidth: 0 }}>
            <div className="service-ap-content-toolbar" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="del-btn del-btn--primary" onClick={addLine} disabled={!isDocumentEditable}>+ Add Line</button>
            </div>

            <div className="del-grid-wrap del-grid-wrap--contents">
              <div className="del-grid-wrap__scroller del-grid-wrap__scroller--contents">
                <table className="del-grid del-grid--contents" style={{ width: 'max-content', minWidth: tableMinWidth, tableLayout: 'auto' }}>
                  <colgroup>
                    <col style={{ width: 42 }} />
                    {visibleLineColumns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
                    <col style={{ width: 48 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>#</th>
                      {visibleLineColumns.map((column) => <th key={column.key}>{column.label}</th>)}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <tr key={index}>
                        <td className="del-grid__cell--muted" style={{ textAlign: 'center' }}>{index + 1}</td>
                        {visibleLineColumns.map((column) => (
                          <td key={column.key}>{renderLineCell(line, index, { ...column, key: column.valueKey || column.key })}</td>
                        ))}
                        <td>
                          <button type="button" className="del-btn del-btn--danger" style={{ padding: '2px 6px' }} onClick={() => removeLine(index)} disabled={!isDocumentEditable}>x</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Logistics' && (
          <LogisticsTab
            header={header}
            onHeaderChange={handleHeaderChange}
            effectiveWhseAddrs={[]}
            vendorPayToAddresses={vendorPayToAddresses}
            vendorShipToAddresses={vendorEffectiveShipToAddresses}
            vendorBillToAddresses={vendorEffectiveBillToAddresses}
            shippingTypeOptions={shipTypeOpts}
            onOpenAddressModal={openAddressModal}
            isEditable={isDocumentEditable}
          />
        )}

        {activeTab === 'Accounting' && (
          <AccountingTab
            header={header}
            onHeaderChange={handleHeaderChange}
            paymentTermOptions={payTermOpts}
            isEditable={isDocumentEditable}
          />
        )}

        {activeTab === 'Tax' && (
          <div className="sap-b1-tax-panel">
            <TaxTab header={header} onHeaderChange={handleHeaderChange} onOpenTaxInfoModal={openTaxInfoModal} isEditable={isDocumentEditable} />
          </div>
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

        <div className="del-header-card service-ap-footer-card">
          <div className="del-field-grid service-ap-footer-grid">
            <div className="service-ap-footer-left">
              <div className="del-field">
                <label className="del-field__label">Buyer</label>
                <select className="del-field__select" name="salesEmployee" value={header.salesEmployee} onChange={handleHeaderChange} disabled={!isDocumentEditable}>
                  <option value="">No Buyer</option>
                  {salesEmployeeOptions.map((employee) => (
                    <option key={employee.SlpCode} value={employee.SlpCode}>{employee.SlpName}</option>
                  ))}
                </select>
              </div>
              <div className="del-field">
                <label className="del-field__label">Owner</label>
                <input className="del-field__input" name="owner" value={header.owner} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
              </div>
              <div className="del-field">
                <label className="del-field__label">Remarks</label>
                <textarea className="del-textarea" rows={3} name="remarks" value={header.remarks} onChange={handleHeaderChange} disabled={!isDocumentEditable} />
              </div>
            </div>
            <div className="service-ap-summary">
              <table className="del-grid service-ap-summary-table">
                <tbody>
                  <tr><td>Total Before Discount</td><td><input className="del-grid__input" value={fmt(displayAmount(totals.subtotal))} readOnly /></td></tr>
                  <tr><td>Discount %</td><td><input className="del-grid__input" name="discount" value={header.discount} onChange={handleHeaderChange} disabled={!isDocumentEditable} /></td></tr>
                  <tr><td>Total Down Payment</td><td><input className="del-grid__input" name="totalDownPayment" value={header.totalDownPayment} onChange={handleHeaderChange} disabled={!isDocumentEditable} /></td></tr>
                  <tr><td>Freight</td><td><input className="del-grid__input" name="freight" value={header.freight} onChange={handleHeaderChange} disabled={!isDocumentEditable} /></td></tr>
                  <tr><td><label className="service-ap-checkbox"><input type="checkbox" name="rounding" checked={header.rounding || (!header.roundingAmountIsManual && parseNum(header.roundingAmount) !== 0)} onChange={handleHeaderChange} disabled={!isDocumentEditable} /> Rounding</label></td><td><DocumentRoundingInput className="del-grid__input" header={header} setHeader={setHeader} formattedAmount={`${displayCurrency} ${formatDocumentRoundingAmount(displayAmount(totals.roundingAmount), numDec)}`.trim()} disabled={!isDocumentEditable} onManualChange={markDirty} /></td></tr>
                  <tr><td>Tax</td><td><input className="del-grid__input" value={fmt(displayAmount(totals.tax))} readOnly /></td></tr>
                  {hasWTaxLiableLines && (
                    <tr>
                      <td>WTax Amount</td>
                      <td>
                        <div className="service-ap-wtax-cell">
                          <input className="del-grid__input service-ap-wtax-input" value={fmt(displayAmount(wtaxAmount))} readOnly />
                          <button type="button" className="del-btn service-ap-wtax-btn" onClick={openWithholdingTaxTable} disabled={!isDocumentEditable}>→</button>
                        </div>
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderTop: '2px solid #a0aab4' }}><td style={{ fontWeight: 700 }}>Total</td><td><input className="del-grid__input" value={fmt(displayAmount(totalPaymentDueAfterWTax))} readOnly style={{ fontWeight: 700 }} /></td></tr>
                  <tr><td>Applied Amount</td><td><input className="del-grid__input" name="appliedAmount" value={header.appliedAmount} onChange={handleHeaderChange} disabled={!isDocumentEditable} /></td></tr>
                  <tr><td>Balance Due</td><td><input className="del-grid__input" value={fmt(displayAmount(balanceDueAfterWTax))} readOnly /></td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
          </div>

          <HeaderUdfSidebar
            className="so-layout__sidebar"
            isOpen={sidebarOpen}
            fields={visibleHeaderUdfs}
            formSettings={formSettings}
            values={headerUdfs}
            disabled={!hasVendorCode}
            onFieldChange={handleHeaderUdfChange}
            onClose={() => setSidebarOpen(false)}
          />
          <FormSettingsPanel
            variant="sidebar"
            className="so-layout__sidebar"
            isOpen={formSettingsOpen}
            onClose={() => setFormSettingsOpen(false)}
            showHeaderUdfSettings
            matrixFields={effectiveMatrixColumns}
            headerUdfFields={headerUdfDefinitions}
            rowUdfFields={configurableRowUdfs}
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

      <datalist id="service-ap-invoice-vendors">
        {vendorOptions.map((vendor) => (
          <option key={vendor.CardCode || vendor.code} value={vendor.CardCode || vendor.code}>
            {vendor.CardName || vendor.name}
          </option>
        ))}
      </datalist>
      <datalist id="service-ap-invoice-accounts">
        {accounts.map((account) => (
          <option key={account.code} value={account.code}>{account.name}</option>
        ))}
      </datalist>

      <CopyFromModal
        isOpen={copyFromModal}
        onClose={() => setCopyFromModal(false)}
        onCopy={handleCopyFrom}
        documentType={copyFromDocType}
        onFetchDocuments={fetchCopyFromDocuments}
        onFetchDocumentDetails={fetchCopyFromDocumentDetails}
      />

      <BusinessPartnerModal
        isOpen={bpModalOpen}
        onClose={() => setBpModalOpen(false)}
        onSelect={selectVendor}
        businessPartners={vendorOptions}
        title="List of Vendors"
      />

      <StateSelectionModal
        isOpen={stateModalOpen}
        onClose={() => setStateModalOpen(false)}
        onSelect={(state) => {
          setHeader((prev) => ({ ...prev, placeOfSupply: state.Code || state.code || '' }));
          setStateModalOpen(false);
        }}
        states={stateOptions}
      />

      <LineValueLookupModal
        isOpen={lineLookupModal.open}
        onClose={closeLineLookup}
        onSelect={handleLineLookupSelect}
        options={lineLookupModal.options}
        title={lineLookupModal.title}
        searchPlaceholder={lineLookupModal.searchPlaceholder}
        emptyMessage={lineLookupModal.emptyMessage}
        allowCreate={lineLookupModal.allowCreate}
        columns={lineLookupModal.columns}
      />

      <AddressModal
        isOpen={!!addressModal}
        onClose={closeAddressModal}
        onSave={saveAddressModal}
        addressForm={addressForm}
        onFormChange={handleAddressFormChange}
        states={stateOptions}
      />

      <TaxInfoModal
        isOpen={taxInfoModal}
        onClose={closeTaxInfoModal}
        onSave={saveTaxInfoModal}
        taxInfoForm={taxInfoForm}
        onFormChange={handleTaxInfoFormChange}
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
          rows: recalcWithholdingRows(rows, wtaxBaseAmount, wtaxDecimals),
        }))}
      />

      <JournalEntryPreviewModal
        isOpen={journalPreview.open}
        loading={journalPreview.loading}
        error={journalPreview.error}
        journalEntry={journalPreview.data}
        onClose={() => setJournalPreview((prev) => ({ ...prev, open: false }))}
        onOpenLinkedMaster={openJournalLinkedMaster}
        onRegenerate={() => previewJournalEntry({ persist: false })}
        onOpenSource={() => {
          setJournalPreview((prev) => ({ ...prev, open: false }));
          if (currentDocEntry) {
            navigate('/services/ap-invoice', { state: createActiveCompanyScopedRouteState({ serviceApInvoiceDocEntry: currentDocEntry }) });
          }
        }}
      />

    </form>
  );
}

export default ServiceAPInvoicePage;
