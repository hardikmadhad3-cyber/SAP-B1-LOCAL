import { mergeSavedFormSettings } from '../utils/formSettingsPreferences';
import {
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createUdfState,
} from './APInvoiceForm';
import { filterSafePurchaseMatrixColumns } from '../utils/purchaseDocumentFormSettings';

export {
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createUdfState,
};

export const FORM_SETTINGS_STORAGE_KEY = 'sapb1.apCreditMemo.formSettings.v1';

const CONFIGURED_MATRIX_COLUMNS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160 },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240 },
  { key: 'quantity', label: 'Quantity', minWidth: 90 },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 110 },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 95 },
  { key: 'taxCode', label: 'Tax Code', minWidth: 120 },
  { key: 'wtaxLiable', label: 'WTax Liable', minWidth: 115, type: 'select', options: ['Y', 'N'] },
  { key: 'total', label: 'Total (LC)', minWidth: 120, readOnly: true },
  { key: 'whse', label: 'Whse', minWidth: 95 },
  { key: 'binLocationAllocation', label: 'Bin Location Allocation', minWidth: 175, readOnly: true },
  { key: 'glAccount', label: 'G/L Account', minWidth: 130, lookup: 'account' },
  { key: 'itemCost', label: 'Item Cost', minWidth: 110, readOnly: true },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 115, lookup: 'distRule' },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105 },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 190, lookup: 'country' },
  { key: 'loc', label: 'Loc.', minWidth: 115, lookup: 'location' },
  { key: 'withoutQtyPosting', label: 'Without Qty Posting', minWidth: 145, type: 'yesNo' },
  { key: 'blanketAgreementNo', label: 'Blanket Agreement No.', minWidth: 170 },
  { key: 'hsnCode', label: 'HSN', minWidth: 115, udfLabels: ['U_HSN'] },
  { key: 'sac', label: 'SAC', minWidth: 105, udfLabels: ['SAC Code', 'U_SAC', 'U_SACCode'] },
  { key: 'costSheet', label: 'Cost-Sheet', minWidth: 125, udfLabels: ['U_Cost_Sheet', 'U_COSTSHEET'] },
  { key: 'packingType', label: 'Packing-Type', minWidth: 140, udfLabels: ['U_PackingType', 'U_PACKINGTYPE', 'U_Packing_Type', 'U_PackingStatus'] },
  { key: 'containerType', label: 'Container Type', minWidth: 140, udfLabels: ['U_ContainerType', 'U_CONTAINERTYPE', 'U_Container_Type'] },
  { key: 'grossWt', label: 'GrossWt', minWidth: 110, udfLabels: ['U_GrossWt', 'U_GROSSWT', 'U_Gross_Wt', 'U_GrossWeight'] },
  { key: 'totalPackage', label: 'Total-Package', minWidth: 130, udfLabels: ['U_TotalPackage', 'U_TOTALPACKAGE', 'U_Total_Package', 'U_TotalPackge'] },
  { key: 'taxCodeRepeat', label: 'TaxCode', minWidth: 110, readOnly: true, udfLabels: ['U_TAXCODE', 'U_TaxCode'] },
  { key: 'price', label: 'Price', minWidth: 110, udfLabels: ['U_PRICE', 'U_Price'] },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 150, lookup: 'businessPartner', udfLabels: ['U_Brok_Seller', 'U_SellerBrokerage'] },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', minWidth: 145, lookup: 'businessPartner', udfLabels: ['U_Brok_Buyer', 'U_BuyerBrokerage'] },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', minWidth: 145, udfLabels: ['U_Buyer_Delivery', 'U_BuyerDelivery'] },
  { key: 'sellerDelivery', label: 'Seller - Delivery', minWidth: 145, udfLabels: ['U_Seller_Delivery', 'U_SellerDelivery'] },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of payment', minWidth: 200, lookup: 'paymentTerm', udfLabels: ['Buyer - Terms of Payment', 'U_Buyer_Payment_Terms', 'U_BuyerTermsOfPayment', 'U_BuyerPayTerms'] },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', minWidth: 205, lookup: 'paymentTerm', udfLabels: ['U_Seller_Payment_Term', 'U_Seller_Payment_Terms', 'U_SellerTermsOfPayment', 'U_SellerPayTerms'] },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 140, udfLabels: ['U_Buyer_Quality', 'U_BuyerQuality'] },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 145, udfLabels: ['U_Seller_Quality', 'U_SellerQuality'] },
  { key: 'buyerPrice', label: 'Buyer - Price', minWidth: 130, udfLabels: ['U_Buyer_Price', 'U_BuyerPrice'] },
  { key: 'sellerPrice', label: 'Seller - Price', minWidth: 130, udfLabels: ['U_Seller_Price', 'U_SellerPrice'] },
  { key: 'buyerSpecialInstruction', label: 'Buyer - Special Instruction', minWidth: 210, udfLabels: ['U_Buyer_SPINS', 'U_BuyerSpecialInstruction', 'U_BuyerSplInst'] },
  { key: 'sellerSpecialInstruction', label: 'Seller - Special Instruction', minWidth: 210, udfLabels: ['U_Seller_SPINS', 'U_SellerSpecialInstruction', 'U_SellerSplInst'] },
  { key: 'sellerBrokerageAmtPer', label: 'Seller Brokerage(Amt./Per)', minWidth: 210, udfLabels: ['Seller Brokerage Amt Per', 'U_Sel_Brok_AP', 'U_SellerBrokerageAmtPer', 'U_SellBrkAmtPer'] },
  { key: 'sellerBrokeragePercent', label: 'Seller Brokerage in Percentage', minWidth: 225, udfLabels: ['U_Seller_Brok_Per', 'U_SellerBrokeragePercentage', 'U_SellerBrkPct'] },
  { key: 'stcode', label: 'STCODE', minWidth: 115, udfLabels: ['STCode', 'U_SELLTCODE', 'U_STCODE'] },
  { key: 'sellerItem', label: 'S_Item', minWidth: 115, lookup: 'item', udfLabels: ['U_S_Item', 'U_SItem'] },
  { key: 'sellerQty', label: 'S_Qty', minWidth: 95, udfLabels: ['U_S_Qty', 'U_SQty'] },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 135, udfLabels: ['U_SPLRBT', 'U_SpecialRebate'] },
  { key: 'commission', label: 'Commision', minWidth: 115, udfLabels: ['Commission', 'U_COMPRC', 'U_Commision', 'U_Commission'] },
  { key: 'sellerBrokeragePerQty', label: 'BrokPerQty', minWidth: 120, udfLabels: ['U_S_BrokPerQty', 'U_BrokPerQty'] },
  { key: 'fixBrokBuyer', label: 'FIX Brok BUYER', minWidth: 140, udfLabels: ['U_Fix_Brock_B', 'U_Fix_Brok_B', 'U_FIX_BROK_BUYER'] },
  { key: 'fixBrockSeller', label: 'Fix Brock Seller', minWidth: 145, udfLabels: ['U_Fix_Brock_S', 'U_Fix_Brok_S', 'U_Fix_Brock_Seller'] },
  { key: 'sellerTermsOfPaymentRepeat', label: 'Seller - Terms of Payment', minWidth: 205, lookup: 'paymentTerm', udfLabels: ['U_Seller_Payment_Term', 'U_Seller_Payment_Terms'] },
];

export const BASE_MATRIX_COLUMNS = filterSafePurchaseMatrixColumns(CONFIGURED_MATRIX_COLUMNS);

const buildVisibilitySettings = (definitions = []) =>
  definitions.reduce((acc, field, index) => {
    acc[field.key] = {
      order: Number(field.order ?? field.columnOrder ?? index + 1),
      minWidth: field.minWidth,
      sapControlled: Boolean(field.sapControlled),
      visible: field.visible !== false,
      active: field.active !== false,
      ...(field.valueKey && field.valueKey !== field.key ? { valueKey: field.valueKey } : {}),
    };
    return acc;
  }, {});

const createDefaultFormSettingsForCreditMemo = (
  headerUdfs = [],
  rowUdfs = [],
  matrixColumns = BASE_MATRIX_COLUMNS,
) => ({
  headerUdfs: buildVisibilitySettings(headerUdfs),
  matrixColumns: buildVisibilitySettings(matrixColumns),
  rowUdfs: buildVisibilitySettings(rowUdfs),
});

export const createDefaultFormSettings = createDefaultFormSettingsForCreditMemo;

export const readSavedFormSettings = (
  headerUdfs = [],
  rowUdfs = [],
  matrixColumns = BASE_MATRIX_COLUMNS,
  storageKey = FORM_SETTINGS_STORAGE_KEY,
) => {
  const effectiveMatrixColumns = Array.isArray(matrixColumns) ? matrixColumns : BASE_MATRIX_COLUMNS;
  const effectiveStorageKey = typeof matrixColumns === 'string' ? matrixColumns : storageKey;
  const defaults = createDefaultFormSettingsForCreditMemo(headerUdfs, rowUdfs, effectiveMatrixColumns);

  try {
    const raw = localStorage.getItem(effectiveStorageKey);
    if (!raw) return defaults;
    return mergeSavedFormSettings(defaults, JSON.parse(raw));
  } catch (_error) {
    return defaults;
  }
};
