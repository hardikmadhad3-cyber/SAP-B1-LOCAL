import SapLookupTextInput from '../../../components/common/SapLookupTextInput';
import SapInput from '../../../components/common/SapInput';
import React from 'react';
import DocumentLineSettingsLoading from '../../../components/sales-document/DocumentLineSettingsLoading';
import { resolveLocationDisplayName } from '../../../utils/locationLookup';
import TaxCodeLookup from '../../../components/TaxCodeLookup';
import DocumentLinesTable from '../../../components/sales-document/DocumentLinesTable';
import useDocumentTableClipboard from '../../../components/sales-document/useDocumentTableClipboard';
import { useSapItemCodeTab } from '../../../utils/sapTabNavigation';
import { matchesSapSearchText } from '../../../utils/sapSearch';
import { filterSalesOrderRowUdfDefinitions } from '../../../config/salesOrderForm';
import LineValueLookupModal from '../../../components/sales-document/LineValueLookupModal';
import { SALES_ORDER_LINE_NUMBER_KEY } from '../documentLayout';
import { getReadableDocumentLineColumnWidth } from '../../../utils/documentLineColumnWidth';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';
import { isBaseDocumentLine } from '../../../utils/documentUom';

import { getCalculatedForRate, getLineTotalsForDisplay } from '../../../utils/lineTotals';
import { isSalesBomComponentLine } from '../../../utils/salesBomLines';

const MATRIX_COLS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160 },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240 },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 170 },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 170 },
  { key: 'quantity', label: 'Quantity', minWidth: 85 },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 110 },
  { key: 'sellerPrice', label: 'Seller - Price', minWidth: 110 },
  { key: 'buyerPrice', label: 'Buyer - Price', minWidth: 110 },
  { key: 'sellerDelivery', label: 'Seller - Delivery', minWidth: 120 },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', minWidth: 120 },
  { key: 'sellerBrokerageAmtPer', label: 'Seller Brokerage(Amt./Per)', minWidth: 155 },
  { key: 'sellerBrokeragePercent', label: 'Seller Brokerage in Percentage', minWidth: 170 },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 120 },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', minWidth: 120 },
  { key: 'qtySpecialInstruction', label: 'Qty Special Instruction', minWidth: 165 },
  { key: 'deliverySpecialInstruction', label: 'Delivery Special Instruction', minWidth: 185 },
  { key: 'buyerBillDiscount', label: 'Buyer Bill Discount', minWidth: 130 },
  { key: 'sellerBillDiscount', label: 'Seller Bill Discount', minWidth: 130 },
  { key: 'deliveredQty', label: 'Delivered Qty', minWidth: 110 },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 90 },
  { key: 'stcode', label: 'STCODE', minWidth: 110 },
  { key: 'taxCode', label: 'Tax Code', minWidth: 110 },
  { key: 'taxAmount', label: 'Tax Amount (Doc)', minWidth: 115 },
  { key: 'totalLC', label: 'Total (Doc)', minWidth: 115 },
  { key: 'whse', label: 'Whse', minWidth: 75 },
  { key: 'binLocationAllocation', label: 'Bin Location Allocation', minWidth: 160, readOnly: true },
  { key: 'priceAfterDiscount', label: 'Price after Discount', minWidth: 130, readOnly: true, numeric: true, type: 'number' },
  { key: 'itemCost', label: 'Item Cost', minWidth: 110, readOnly: true, numeric: true, type: 'number' },
  { key: 'forRate', label: 'FOR Rate', minWidth: 115 },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 105 },
  { key: 'openQty', label: 'Open Qty', minWidth: 85 },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 175 },
  { key: 'freeText', label: 'Free Text', minWidth: 150 },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105 },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'loc', label: 'Loc.', minWidth: 120 },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 110 },
  { key: 'commission', label: 'Commision', minWidth: 100 },
  { key: 'hsnCode', label: 'HSN', minWidth: 95 },
  { key: 'sacCode', label: 'SAC', minWidth: 90 },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of Payment', minWidth: 170 },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', minWidth: 170 },
  { key: 'freightPurchase', label: 'Freight Purchase', minWidth: 130 },
  { key: 'freightSales', label: 'Freight Sales', minWidth: 120 },
  { key: 'freightProvider', label: 'Freight Provider', minWidth: 120 },
  { key: 'freightProviderName', label: 'Freight Provider Name', minWidth: 160 },
  { key: 'documentCreated', label: 'Document Created', minWidth: 140 },
  { key: 'brokerageNumber', label: 'Brokerage Number', minWidth: 140 },
];

const getReadableColumnWidth = (field = {}, rendererColumn = {}) => (
  getReadableDocumentLineColumnWidth(field, rendererColumn, {
    lineNumberKey: SALES_ORDER_LINE_NUMBER_KEY,
  })
);

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const hasNonZeroDisplayValue = (value) => {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (!text) return false;
  const numericText = text.replace(/,/g, '').replace(/[^0-9.-]/g, '');
  if (!numericText) return true;
  const parsed = Number(numericText);
  return !Number.isFinite(parsed) || parsed !== 0;
};

const getDisplayForRate = (line = {}, taxCodes = []) => (
  hasNonZeroDisplayValue(line.forRate)
    ? line.forRate
    : getCalculatedForRate(line, taxCodes)
);

const formatDateDisplay = (value) => {
  if (!value) return '';
  return String(value).split('T')[0];
};

const pickerButtonStyle = {
  padding: '0 6px',
  fontSize: 11,
  border: '1px solid #a0aab4',
  background: 'linear-gradient(180deg, #fff 0%, #e8ecf0 100%)',
  minWidth: '24px',
  height: '22px',
  cursor: 'pointer',
  borderRadius: '2px',
};

const DIST_RULE_FIELD_BY_DIMENSION = {
  1: 'distRule',
  2: 'distRule2',
  3: 'distRule3',
  4: 'distRule4',
  5: 'distRule5',
};

const normalizeColumnToken = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

const getRenderableUomOptions = (options = [], selectedValue = '') => {
  const unique = [];
  const seen = new Set();
  (Array.isArray(options) ? options : []).forEach((option) => {
    const value = String(option || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    unique.push(value);
  });

  const selected = String(selectedValue || '').trim();
  if (selected && !seen.has(selected)) unique.push(selected);
  return unique;
};

const COLUMN_RENDERER_ALIASES = new Map([
  ['LINENUM', SALES_ORDER_LINE_NUMBER_KEY],
  ['ITEMCODE', 'itemNo'],
  ['ITEMNO', 'itemNo'],
  ['ITEMDESCRIPTION', 'itemDescription'],
  ['DSCRIPTION', 'itemDescription'],
  ['DESCRIPTION', 'itemDescription'],
  ['QUANTITY', 'quantity'],
  ['QTY', 'quantity'],
  ['UOMNAME', 'uomName'],
  ['UNITMSR', 'uomName'],
  ['UNITOFMEASURENAME', 'uomName'],
  ['UOMCODE', 'uomCode'],
  ['ONHAND', 'inStock'],
  ['ONHANDQTY', 'inStock'],
  ['INSTOCK', 'inStock'],
  ['QUANTITYONSTOCK', 'inStock'],
  ['WHSQTY', 'qtyInWhse'],
  ['QTYINWHSE', 'qtyInWhse'],
  ['QTYINWAREHOUSE', 'qtyInWhse'],
  ['WAREHOUSEQUANTITY', 'qtyInWhse'],
  ['HSN', 'hsnCode'],
  ['BRANCH', 'branch'],
  ['BPLID', 'branch'],
  ['BPLIDASSIGNEDTOINVOICE', 'branch'],
  ['HSNCODE', 'hsnCode'],
  ['HSNENTRY', 'hsnCode'],
  ['PRICEBEFDI', 'unitPrice'],
  ['UNITPRICE', 'unitPrice'],
  ['VATGROUP', 'taxCode'],
  ['TAXCODE', 'taxCode'],
  ['SHIPTYPE', 'lineShippingType'],
  ['SHIPPINGTYPE', 'lineShippingType'],
  ['SHIPPINGMETHOD', 'lineShippingType'],
  ['TRNSCODE', 'lineShippingType'],
  ['SHIPDATE', 'lineDeliveryDate'],
  ['DELDATE', 'lineDeliveryDate'],
  ['DELIVERYDATE', 'lineDeliveryDate'],
  ['TAXONLY', 'taxLiable'],
  ['TAXLIABLE', 'taxLiable'],
  ['VATSUM', 'taxAmount'],
  ['TAXAMOUNT', 'taxAmount'],
  ['TAXAMOUNTDOC', 'taxAmount'],
  ['LINETOTAL', 'totalLC'],
  ['GTOTAL', 'grossTotal'],
  ['GROSSTOTAL', 'grossTotal'],
  ['TOTALDOC', 'grossTotal'],
  ['TOTAL', 'totalLC'],
  ['DISCPRCNT', 'stdDiscount'],
  ['DISCOUNTPERCENT', 'stdDiscount'],
  ['DISCOUNT', 'stdDiscount'],
  ['WHSCODE', 'whse'],
  ['WHSE', 'whse'],
  ['FORRATE', 'forRate'],
  ['FOR', 'forRate'],
  ['FORPRICE', 'forRate'],
  ['OCRCODE', 'distRule'],
  ['DISTRULE', 'distRule'],
  ['DISTRIBUTIONRULE', 'distRule'],
  ['COGSOCRCOD', 'cogsDistRule'],
  ['COGSCOSTINGCODE', 'cogsDistRule'],
  ['COGSDISTRIBUTIONRULE', 'cogsDistRule'],
  ['COGSDISTRRULE', 'cogsDistRule'],
  ['COUNTRYORG', 'countryOfOrigin'],
  ['LOC', 'loc'],
  ['LOCCODE', 'loc'],
  ['SAC', 'sacCode'],
  ['SACCODE', 'sacCode'],
  ['SACENTRY', 'sacCode'],
]);

const getRuleCode = (rule) => String(rule?.FactorCode || rule?.OcrCode || rule?.code || '').trim();
const getRuleName = (rule) => String(rule?.FactorDescription || rule?.OcrName || rule?.name || '').trim();
const getRuleDimensionCode = (rule) => String(rule?.DimensionCode || rule?.DimCode || rule?.dimensionCode || '1').trim() || '1';
const getDimensionCode = (dimension) => String(dimension?.DimensionCode || dimension?.DimCode || dimension?.code || '1').trim() || '1';
const getDimensionName = (dimension) => String(dimension?.DimensionName || dimension?.DimName || dimension?.DimDesc || dimension?.name || `Dimension ${getDimensionCode(dimension)}`).trim();
const getLineRuleValue = (line, dimensionCode) => line?.[DIST_RULE_FIELD_BY_DIMENSION[Number(dimensionCode)]] || '';

const buildDistributionDimensions = (dimensions = [], rules = []) => {
  const map = new Map();

  dimensions.forEach((dimension) => {
    const code = getDimensionCode(dimension);
    if (Number(code) >= 1 && Number(code) <= 5) {
      map.set(code, { DimensionCode: code, DimensionName: getDimensionName(dimension) });
    }
  });

  rules.forEach((rule) => {
    const code = getRuleDimensionCode(rule);
    if (Number(code) >= 1 && Number(code) <= 5 && !map.has(code)) {
      map.set(code, { DimensionCode: code, DimensionName: rule.DimensionName || `Dimension ${code}` });
    }
  });

  if (!map.size) {
    map.set('1', { DimensionCode: '1', DimensionName: 'Distribution Rule' });
  }

  return [...map.values()].sort((a, b) => Number(a.DimensionCode) - Number(b.DimensionCode));
};

function DistributionRuleAssignmentModal({
  isOpen,
  line,
  rules = [],
  dimensions = [],
  onClose,
  onApply,
}) {
  const dimensionRows = React.useMemo(
    () => buildDistributionDimensions(dimensions, rules),
    [dimensions, rules]
  );
  const [draft, setDraft] = React.useState({});
  const [activeDimensionCode, setActiveDimensionCode] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedRuleIndex, setSelectedRuleIndex] = React.useState(-1);

  React.useEffect(() => {
    if (!isOpen) return;
    const nextDraft = {};
    dimensionRows.forEach((dimension) => {
      const code = getDimensionCode(dimension);
      nextDraft[code] = getLineRuleValue(line, code);
    });
    setDraft(nextDraft);
    setActiveDimensionCode(dimensionRows[0] ? getDimensionCode(dimensionRows[0]) : '1');
    setSearchQuery('');
    setSelectedRuleIndex(-1);
  }, [dimensionRows, isOpen, line]);

  const activeDimension = dimensionRows.find((dimension) => getDimensionCode(dimension) === activeDimensionCode);
  const activeRules = React.useMemo(() => {
    const query = searchQuery.trim();
    return rules
      .filter((rule) => getRuleDimensionCode(rule) === activeDimensionCode)
      .filter((rule) => {
        if (!query) return true;
        return matchesSapSearchText(getRuleCode(rule), query) || matchesSapSearchText(getRuleName(rule), query);
      });
  }, [activeDimensionCode, rules, searchQuery]);

  React.useEffect(() => {
    setSelectedRuleIndex(-1);
  }, [activeDimensionCode, searchQuery]);

  if (!isOpen) return null;

  const selectRule = (rule) => {
    setDraft((prev) => ({ ...prev, [activeDimensionCode]: getRuleCode(rule) }));
  };

  const chooseSelectedRule = () => {
    if (selectedRuleIndex < 0 || !activeRules[selectedRuleIndex]) return;
    selectRule(activeRules[selectedRuleIndex]);
  };

  const getSelectedRuleName = (dimensionCode) => {
    const selectedCode = draft[dimensionCode];
    if (!selectedCode) return '';
    const selectedRule = rules.find((rule) => getRuleDimensionCode(rule) === dimensionCode && getRuleCode(rule) === selectedCode);
    return selectedRule ? getRuleName(selectedRule) : '';
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.34)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: 940, maxWidth: '94vw', maxHeight: '86vh', background: 'var(--sap-surface)', border: '1px solid var(--sap-border-strong)', boxShadow: 'var(--sap-shadow-modal)', display: 'flex', flexDirection: 'column' }} onClick={(event) => event.stopPropagation()}>
        <div style={{ padding: '8px 12px', borderBottom: '3px solid var(--sap-primary)', background: 'var(--sap-toolbar-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Select Distr. Rule</h3>
          <button type="button" onClick={onClose} style={{ border: '1px solid var(--sap-border-strong)', background: '#f5f6f7', width: 24, height: 22, cursor: 'pointer' }}>x</button>
        </div>

        <div className="so-distribution-modal__body">
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--sap-toolbar-bg)' }}>
                  <th style={{ width: 42, padding: '6px', textAlign: 'left', border: '1px solid var(--sap-border)' }}>#</th>
                  <th style={{ padding: '6px', textAlign: 'left', border: '1px solid var(--sap-border)' }}>Dimensions</th>
                  <th style={{ padding: '6px', textAlign: 'left', border: '1px solid var(--sap-border)' }}>Distr. Rule Code</th>
                  <th style={{ padding: '6px', textAlign: 'left', border: '1px solid var(--sap-border)' }}>Distr. Rule Name</th>
                </tr>
              </thead>
              <tbody>
                {dimensionRows.map((dimension, index) => {
                  const dimensionCode = getDimensionCode(dimension);
                  const isActive = dimensionCode === activeDimensionCode;
                  return (
                    <tr
                      key={dimensionCode}
                      onClick={() => setActiveDimensionCode(dimensionCode)}
                      style={{ background: isActive ? 'var(--sap-row-hover)' : index % 2 ? 'var(--sap-row-even)' : 'var(--sap-surface)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '5px 6px', border: '1px solid var(--sap-border)' }}>{index + 1}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid var(--sap-border)', fontWeight: 600 }}>{getDimensionName(dimension)}</td>
                      <td style={{ padding: 3, border: '1px solid var(--sap-border)' }}>
                        <input
                          readOnly
                          value={draft[dimensionCode] || ''}
                          onFocus={() => setActiveDimensionCode(dimensionCode)}
                          style={{ width: 'calc(100% - 28px)', height: 22, border: '1px solid var(--sap-border-strong)', padding: '2px 5px', background: '#fff7bf' }}
                        />
                        <button type="button" onClick={() => setActiveDimensionCode(dimensionCode)} style={{ ...pickerButtonStyle, marginLeft: 2 }}>...</button>
                      </td>
                      <td style={{ padding: '5px 6px', border: '1px solid var(--sap-border)' }}>{getSelectedRuleName(dimensionCode)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ border: '1px solid var(--sap-border-strong)' }}>
            <div style={{ padding: '8px 10px', borderBottom: '3px solid var(--sap-primary)', background: 'var(--sap-toolbar-bg)', fontWeight: 600, fontSize: 13 }}>
              List of Distribution Rules
            </div>
            <div style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, minWidth: 32 }}>Find</label>
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} style={{ flex: 1, height: 24, border: '1px solid var(--sap-border-strong)', padding: '2px 6px' }} />
            </div>
            <div style={{ padding: '0 8px 8px', fontSize: 12, color: 'var(--sap-text-muted)' }}>
              {activeDimension ? getDimensionName(activeDimension) : ''}
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', padding: '0 8px 8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--sap-toolbar-bg)' }}>
                    <th style={{ padding: '6px', textAlign: 'left', border: '1px solid var(--sap-border)' }}>Distribution Rule</th>
                    <th style={{ padding: '6px', textAlign: 'left', border: '1px solid var(--sap-border)' }}>Distribution Rule Name</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRules.length ? activeRules.map((rule, index) => (
                    <tr
                      key={`${getRuleCode(rule)}-${index}`}
                      onClick={() => setSelectedRuleIndex(index)}
                      onDoubleClick={() => selectRule(rule)}
                      style={{ background: selectedRuleIndex === index ? 'var(--sap-row-hover)' : index % 2 ? 'var(--sap-row-even)' : 'var(--sap-surface)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '5px 6px', border: '1px solid var(--sap-border)', fontWeight: 600 }}>{getRuleCode(rule)}</td>
                      <td style={{ padding: '5px 6px', border: '1px solid var(--sap-border)' }}>{getRuleName(rule)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={2} style={{ padding: 16, textAlign: 'center', color: 'var(--sap-text-muted)' }}>No distribution rules found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 8, borderTop: '1px solid var(--sap-border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={chooseSelectedRule} disabled={selectedRuleIndex < 0} style={{ ...pickerButtonStyle, height: 26, opacity: selectedRuleIndex >= 0 ? 1 : 0.6 }}>Choose</button>
            </div>
          </div>
        </div>

        <div style={{ padding: 12, borderTop: '1px solid var(--sap-border)', display: 'flex', justifyContent: 'flex-start', gap: 8 }}>
          <button type="button" onClick={() => onApply(draft)} style={{ ...pickerButtonStyle, minWidth: 80, height: 26, background: 'linear-gradient(180deg, var(--sap-primary) 0%, var(--sap-primary-dark) 100%)', color: '#fff' }}>OK</button>
          <button type="button" onClick={onClose} style={{ ...pickerButtonStyle, minWidth: 80, height: 26 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ReadyContentsTab({
  lines,
  onLineChange,
  onNumBlur,
  lineItemOptions,
  onAddLine,
  onRemoveLine,
  getUomOptions,
  effectiveTaxCodes,
  effectiveWarehouses,
  fmtTaxLabel,
  valErrors,
  distributionRules = [],
  distributionDimensions = [],
  onDistributionRuleChange,
  onOpenHSNModal,
  onOpenItemModal,
  onOpenQualityModal,
  onOpenPaymentTermsModal,
  formSettings = {},
  matrixFields = MATRIX_COLS,
  loading = false,
  useSapMatrixOrder = false,
  rowUdfFields = [],
  onRowUdfChange,
  onLoadLookupOptions,
  getBranchName,
  countries = [],
  locations = [],
  shippingTypeOptions = [],
  displayCurrency = '',
  documentCurrency = '',
  formatDisplayMoney,
  canPasteTable = false,
  onPasteTable,
  onClipboardFeedback,
}) {
  const sapItemTab = useSapItemCodeTab({ lineItemOptions, onLineChange, onOpenItemModal });
  const [dynamicUdfLookup, setDynamicUdfLookup] = React.useState({
    open: false,
    rowIndex: -1,
    field: null,
    options: [],
    loading: false,
    error: '',
  });
  const [distributionRuleAssignment, setDistributionRuleAssignment] = React.useState({
    open: false,
    rowIndex: -1,
  });
  const getTaxAmountDisplay = (line) => {
    if (String(line.taxAmount ?? '').trim()) return line.taxAmount;
    const totals = getLineTotalsForDisplay(line, effectiveTaxCodes);
    if (!totals.beforeTax || !totals.total) return '';
    return (parseNumber(totals.total) - parseNumber(totals.beforeTax)).toFixed(2);
  };
  const formatMoneyValue = (value) => {
    if (typeof formatDisplayMoney === 'function') return formatDisplayMoney(value);
    const text = String(value ?? '').trim();
    const currency = String(displayCurrency || '').trim();
    return text && currency ? `${text} ${currency}` : text;
  };
  const noCountryCode = React.useMemo(() => {
    const noCountry = countries.find((country) => (
      String(country.Code ?? country.code ?? '').trim().toUpperCase() === 'XX' ||
      String(country.Name ?? country.name ?? '').trim().toLowerCase() === '-no country-'
    ));
    return String(noCountry?.Code ?? noCountry?.code ?? '').trim();
  }, [countries]);
  const getLineLocationDisplay = React.useCallback((line = {}) => {
    const locationCode = String(line.loc ?? '').trim();
    if (!locationCode) return '';

    const locationName = resolveLocationDisplayName(locationCode, locations);
    if (locationName && locationName !== locationCode) return locationName;

    const warehouse = effectiveWarehouses.find((candidate) => (
      String(candidate.WhsCode ?? candidate.whsCode ?? '').trim() === String(line.whse ?? '').trim()
    )) || effectiveWarehouses.find((candidate) => (
      String(candidate.LocationCode ?? candidate.locationCode ?? '').trim() === locationCode
    ));

    return String(
      warehouse?.LocationName ||
      warehouse?.locationName ||
      warehouse?.City ||
      warehouse?.County ||
      warehouse?.State ||
      locationCode
    ).trim();
  }, [effectiveWarehouses, locations]);
  const renderCurrencyInput = (inputProps, suffix = documentCurrency || displayCurrency) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input {...inputProps} style={{ ...(inputProps.style || {}), flex: 1 }} />
      {String(suffix || '').trim() ? <span style={{ fontSize: 11, color: '#1f2937', minWidth: 28 }}>{suffix}</span> : null}
    </div>
  );
  const rendererColumnMap = React.useMemo(
    () => new Map(MATRIX_COLS.map((column) => [column.key, column])),
    []
  );
  const liveMatrixFields = React.useMemo(() => {
    const sourceFields = Array.isArray(matrixFields) ? matrixFields : MATRIX_COLS;
    if (!sourceFields.length) return [];
    const hasLineNumberColumn = sourceFields.some((field) => field?.key === SALES_ORDER_LINE_NUMBER_KEY);
    const withLineNumberColumn = hasLineNumberColumn
      ? sourceFields
      : [
          {
            key: SALES_ORDER_LINE_NUMBER_KEY,
            fieldName: 'LineNum',
            label: '#',
            visible: true,
            active: true,
            readOnly: true,
            minWidth: 42,
            width: 42,
            order: 0,
            columnOrder: 0,
            sapControlled: true,
            importedLayout: true,
          },
          ...sourceFields,
        ];

    if (!formSettings?.__companyQueryLayout?.isPublished) return withLineNumberColumn;

    const existingKeys = new Set(
      withLineNumberColumn.flatMap((field) => [field?.key, field?.valueKey, field?.rendererKey]).filter(Boolean),
    );
    const sqlSelectedFallbackColumns = MATRIX_COLS.filter((column) => (
      formSettings?.matrixColumns?.[column.key]?.visible !== false
      && formSettings?.matrixColumns?.[column.key]?.companyQueryLayout === true
      && !existingKeys.has(column.key)
    ));

    return [...withLineNumberColumn, ...sqlSelectedFallbackColumns];
  }, [formSettings, matrixFields]);
  const usesMetadataDrivenMatrix = useSapMatrixOrder || liveMatrixFields.some((field) => field?.importedLayout || field?.schemaDriven);
  const visibleRowUdfFields = usesMetadataDrivenMatrix
    ? (rowUdfFields || [])
    : filterSalesOrderRowUdfDefinitions(rowUdfFields);
  const getColumnValueKey = (column = {}) => column.valueKey || column.rendererKey || column.key;
  const getColumnRendererKey = (column = {}) => {
    const candidates = [
      column.rendererKey,
      column.valueKey,
      column.key,
      column.fieldName,
      column.layoutFieldName,
      column.sapField,
      column.sapColumnId,
      column.columnUid,
      column.columnTitle,
      column.label,
    ];

    for (const candidate of candidates) {
      const aliasedRenderer = COLUMN_RENDERER_ALIASES.get(normalizeColumnToken(candidate));
      if (aliasedRenderer) return aliasedRenderer;
    }

    return column.rendererKey || column.valueKey || column.key;
  };
  const isUdfMatrixColumn = (column = {}) => (
    Boolean(column.isUdf)
    || column.source === 'RDR1_UDF'
    || String(column.key || '').startsWith('U_')
    || String(column.valueKey || '').startsWith('U_')
  );
  const getMatrixColumnSetting = (column = {}) => (
    {
      visible: column.visible !== false,
      active: column.active !== false,
      ...(
        formSettings.matrixColumns?.[column.key]
        || formSettings.matrixColumns?.[column.valueKey]
        || (isUdfMatrixColumn(column) ? formSettings.rowUdfs?.[column.key] || formSettings.rowUdfs?.[column.valueKey] : undefined)
        || {}
      ),
    }
  );
  const getColumnVisibility = (column = {}) => {
    const setting = getMatrixColumnSetting(column);
    return setting.visible !== false;
  };

  const matrixColumns = [
    ...liveMatrixFields.map((field, index) => {
      const rendererColumn = rendererColumnMap.get(getColumnRendererKey(field)) || {};
      const readableWidth = getReadableColumnWidth(field, rendererColumn);
      return {
        ...rendererColumn,
        ...field,
        key: field.key,
        label: field.label || rendererColumn.label || field.key,
        width: readableWidth,
        minWidth: readableWidth,
        order: field.order ?? rendererColumn.order ?? index + 1,
      };
    }),
    ...(usesMetadataDrivenMatrix ? [] : visibleRowUdfFields.map((field) => ({
      key: field.key,
      label: field.label || field.key,
      width: getReadableColumnWidth(field),
      minWidth: getReadableColumnWidth(field),
      visible: field.visible,
      active: field.active,
      order: field.order,
      isUdf: true,
      field,
    }))),
  ].sort((left, right) => (Number(left.order ?? 99999) - Number(right.order ?? 99999)));

  const configuredVisibleColumns = getOrderedVisibleMatrixColumns(matrixColumns, formSettings);
  const visibleColumns = configuredVisibleColumns.some((column) => column.key === SALES_ORDER_LINE_NUMBER_KEY)
    ? configuredVisibleColumns
    : [
        {
          key: SALES_ORDER_LINE_NUMBER_KEY,
          valueKey: SALES_ORDER_LINE_NUMBER_KEY,
          rendererKey: SALES_ORDER_LINE_NUMBER_KEY,
          fieldName: 'LineNum',
          label: '#',
          visible: true,
          active: false,
          readOnly: true,
          minWidth: 42,
          width: 42,
          order: -10000,
          columnOrder: -10000,
        },
        ...configuredVisibleColumns,
      ];
  const clipboardColumns = React.useMemo(() => visibleColumns
    .filter((column) => column.key !== SALES_ORDER_LINE_NUMBER_KEY)
    .map((column) => {
      const valueKey = getColumnValueKey(column);
      const setting = getMatrixColumnSetting(column);
      return {
        key: valueKey,
        label: column.label || column.columnTitle || valueKey,
        isUdf: isUdfMatrixColumn(column),
        readOnly: Boolean(column.readOnly || (setting.active === false && isUdfMatrixColumn(column))),
      };
    }), [visibleColumns, formSettings]);
  const { tableClipboardProps, tableClipboardUi } = useDocumentTableClipboard({
    columns: clipboardColumns,
    rows: lines,
    columnOffset: 1,
    canPaste: canPasteTable,
    onPaste: onPasteTable,
    onFeedback: onClipboardFeedback,
  });

  // Helper to check if a column is visible
  const isColumnVisible = (columnKey) => {
    const column = matrixColumns.find((entry) => entry.key === columnKey);
    if (!column) return false;
    return getColumnVisibility(column);
  };

  const openDynamicUdfLookup = async (rowIndex, field) => {
    if (!field?.lookupSource || typeof onLoadLookupOptions !== 'function') return;

    setDynamicUdfLookup({
      open: true,
      rowIndex,
      field,
      options: [],
      loading: true,
      error: '',
    });

    try {
      const options = await onLoadLookupOptions(field.lookupSource, field);
      setDynamicUdfLookup({
        open: true,
        rowIndex,
        field,
        options: Array.isArray(options) ? options : [],
        loading: false,
        error: '',
      });
    } catch (error) {
      setDynamicUdfLookup({
        open: true,
        rowIndex,
        field,
        options: [],
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Failed to load lookup values.',
      });
    }
  };

  const handleDynamicUdfLookupSelect = (option) => {
    if (!dynamicUdfLookup.field?.key || dynamicUdfLookup.rowIndex < 0) return;
    const valueKey = getColumnValueKey(dynamicUdfLookup.field);
    const selectedValue = option?.value || '';
    if (isUdfMatrixColumn(dynamicUdfLookup.field)) {
      onRowUdfChange && onRowUdfChange(dynamicUdfLookup.rowIndex, valueKey, selectedValue);
    } else {
      onLineChange && onLineChange(dynamicUdfLookup.rowIndex, { target: { name: valueKey, value: selectedValue } });
    }
    setDynamicUdfLookup((prev) => ({ ...prev, open: false }));
  };

  const handleGenericMatrixValueChange = (rowIndex, column, nextValue) => {
    const valueKey = getColumnValueKey(column);
    if (isUdfMatrixColumn(column)) {
      onRowUdfChange && onRowUdfChange(rowIndex, valueKey, nextValue);
      return;
    }

    if (typeof onLineChange !== 'function') return;
    onLineChange(rowIndex, { target: { name: valueKey, value: nextValue } });
  };

  const renderGenericMatrixCell = (column, line, i) => {
    const setting = getMatrixColumnSetting(column);
    const disabled = column.readOnly || (setting.active === false && isUdfMatrixColumn(column));
    const valueKey = getColumnValueKey(column);
    const isPlainUnitUdf = String(valueKey || column.sapField || '')
      .replace(/[^a-z0-9]/gi, '').toUpperCase() === 'UUOM';
    const rawValue = isUdfMatrixColumn(column)
      ? (line.udf?.[valueKey] ?? '')
      : (line[valueKey] ?? '');
    const value = valueKey === 'forRate'
      ? (hasNonZeroDisplayValue(rawValue) ? rawValue : getCalculatedForRate(line, effectiveTaxCodes))
      : valueKey === 'grossTotal'
        ? (rawValue || getLineTotalsForDisplay(line, effectiveTaxCodes).total)
      : rawValue;

    const inputType = column.type === 'date'
      ? 'date'
      : (column.type === 'number' || column.numeric ? 'number' : 'text');

    const hasSelectOptions = !isPlainUnitUdf && Array.isArray(column.options) && column.options.length > 0;
    if (hasSelectOptions && (!column.lookupSource || column.lookupSource === 'udf-valid-values')) {
      return (
        <td key={column.key}>
          <select
            className="so-grid__input"
            value={value}
            data-sap-native-tab="true"
            disabled={disabled}
            onChange={(e) => handleGenericMatrixValueChange(i, column, e.target.value)}
          >
            <option value=""></option>
            {(column.options || []).map((option) => {
              const normalizedOption = typeof option === 'object'
                ? option
                : { value: option, label: option };
              return (
                <option key={normalizedOption.value} value={normalizedOption.value}>
                  {normalizedOption.label}
                </option>
              );
            })}
          </select>
        </td>
      );
    }

    if (column.type === 'checkbox') {
      return (
        <td key={column.key}>
          <input
            type="checkbox"
            data-sap-native-tab="true"
            checked={['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase())}
            disabled={disabled}
            onChange={(e) => handleGenericMatrixValueChange(i, column, e.target.checked ? 'Y' : 'N')}
          />
        </td>
      );
    }

    if (column.lookupSource && !isPlainUnitUdf) {
      return (
        <td key={column.key}>
          <div style={{ display: 'flex', gap: 2 }}>
            <SapInput
              className="so-grid__input"
              type={inputType}
              value={value}
              disabled={disabled}
              onChange={(e) => handleGenericMatrixValueChange(i, column, e.target.value)}
            />
            <button
              type="button"
              onClick={() => openDynamicUdfLookup(i, column)}
              disabled={disabled}
              style={pickerButtonStyle}
              title={`List of ${column.label || 'Values'}`}
            >
              ...
            </button>
          </div>
        </td>
      );
    }

    if (column.type === 'textarea') {
      return (
        <td key={column.key}>
          <textarea
            className="so-grid__input"
            value={value}
            disabled={disabled}
            rows={2}
            onChange={(e) => handleGenericMatrixValueChange(i, column, e.target.value)}
          />
        </td>
      );
    }

    return (
      <td key={column.key}>
        <SapInput
          className="so-grid__input"
          type={inputType}
          value={value}
          disabled={disabled}
          onChange={(e) => handleGenericMatrixValueChange(i, column, e.target.value)}
        />
      </td>
    );
  };

  // Create a map of column renderers
  const renderCell = (column, line, i, uomOpts, lineTotals) => {
    const columnKey = column.key;
    const rendererKey = getColumnRendererKey(column);
    const valueKey = getColumnValueKey(column);
    const isSalesBomComponent = line.bomRole === 'component' && line.bomType === 'S';
    const isSalesBomParent = line.bomRole === 'parent' && line.bomType === 'S';
    if (columnKey === SALES_ORDER_LINE_NUMBER_KEY) {
      return (
        <td key={columnKey} className="so-grid__cell--muted" style={{ textAlign: 'center', fontSize: 11 }}>
          {line.lineNum != null ? Number(line.lineNum) + 1 : i + 1}
        </td>
      );
    }

    const matchedUdfColumn = isUdfMatrixColumn(column)
      ? visibleRowUdfFields.find((field) => field.key === valueKey)
      : null;
    const udfColumn = isUdfMatrixColumn(column)
      ? (matchedUdfColumn ? { ...matchedUdfColumn, ...column, valueKey } : column)
      : null;
    if (udfColumn) return renderGenericMatrixCell(udfColumn, line, i);
    if (column.lookupConfigured && column.lookupSource) {
      return renderGenericMatrixCell(column, line, i);
    }

    if (!isColumnVisible(columnKey)) return null;

    const cellRenderers = {
      itemNo: () => (
        <td key="itemNo" title={isSalesBomParent ? 'Sales BOM parent' : (isSalesBomComponent ? 'Sales BOM component' : undefined)}>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', paddingLeft: isSalesBomComponent ? 12 : 0 }}>
            {isSalesBomComponent ? (
              <span aria-hidden="true" style={{ color: 'var(--sap-text-muted)', fontSize: 10, width: 8 }}>&gt;</span>
            ) : null}
            <SapLookupTextInput
              className="so-grid__input"
              style={{ flex: 1, textAlign: 'left', border: valErrors.lines[i]?.itemNo ? '1px solid #c00' : undefined }}
              name="itemNo"
              data-sap-lookup="item"
              data-sap-row-index={i}
              onKeyDown={(e) => sapItemTab.handleItemCodeTab(e, i)}
              value={line.itemNo}
              onChange={(e) => onLineChange(i, e)}
              placeholder="Item Code"
              disabled={isSalesBomComponent}
            />
            <button
              type="button"
              onClick={() => onOpenItemModal && onOpenItemModal(i)}
              style={pickerButtonStyle}
              title="Select Item"
              disabled={isSalesBomComponent}
            >
              ...
            </button>
          </div>
          {valErrors.lines[i]?.itemNo && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].itemNo}</div>
          )}
        </td>
      ),
      itemDescription: () => (
        <td key="itemDescription">
          <input
            className="so-grid__input"
            style={{ textAlign: 'left' }}
            name="itemDescription"
            value={line.itemDescription}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerQuality: () => (
        <td key="sellerQuality">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1 }}
              name="sellerQuality"
              value={line.sellerQuality || ''}
              onChange={(e) => onLineChange(i, e)}
            />
            <button
              type="button"
              onClick={() => onOpenQualityModal && onOpenQualityModal('sellerQuality', i)}
              style={pickerButtonStyle}
              title="Select Seller Quality"
            >
              ...
            </button>
          </div>
        </td>
      ),
      buyerQuality: () => (
        <td key="buyerQuality">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1 }}
              name="buyerQuality"
              value={line.buyerQuality || ''}
              onChange={(e) => onLineChange(i, e)}
            />
            <button
              type="button"
              onClick={() => onOpenQualityModal && onOpenQualityModal('buyerQuality', i)}
              style={pickerButtonStyle}
              title="Select Buyer Quality"
            >
              ...
            </button>
          </div>
        </td>
      ),
      quantity: () => (
        <td key="quantity">
          <input
            className="so-grid__input"
            style={{ border: valErrors.lines[i]?.quantity ? '1px solid #c00' : undefined }}
            name="quantity"
            value={line.quantity}
            onChange={(e) => onLineChange(i, e)}
            onBlur={() => onNumBlur('quantity', 'line', i)}
          />
          {valErrors.lines[i]?.quantity && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].quantity}</div>
          )}
        </td>
      ),
      unitPrice: () => (
        <td key="unitPrice">
          {renderCurrencyInput({
            className: 'so-grid__input',
            style: { border: valErrors.lines[i]?.unitPrice ? '1px solid #c00' : undefined },
            name: 'unitPrice',
            value: line.unitPrice,
            onChange: (e) => onLineChange(i, e),
            onBlur: () => onNumBlur('unitPrice', 'line', i),
            disabled: isSalesBomComponent,
          })}
          {valErrors.lines[i]?.unitPrice && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].unitPrice}</div>
          )}
        </td>
      ),
      uomCode: () => {
        const renderableUomOpts = getRenderableUomOptions(uomOpts, line.uomCode);
        return (
          <td key="uomCode">
            <select
              className="so-grid__input"
              name="uomCode"
              value={line.uomCode || ''}
              onChange={(e) => onLineChange(i, e)}
              disabled={isBaseDocumentLine(line) || Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL'}
            >
              <option value=""></option>
              {renderableUomOpts.map((uom) => (
                <option key={uom} value={uom}>
                  {uom}
                </option>
              ))}
            </select>
          </td>
        );
      },
      sellerPrice: () => (
        <td key="sellerPrice">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1 }}
              name="sellerPrice"
              value={line.sellerPrice || ''}
              onChange={(e) => onLineChange(i, e)}
            />
            <button
              type="button"
              onClick={() => onOpenQualityModal && onOpenQualityModal('sellerPrice', i)}
              style={pickerButtonStyle}
              title="Select Seller Price"
            >
              ...
            </button>
          </div>
        </td>
      ),
      buyerPrice: () => (
        <td key="buyerPrice">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1 }}
              name="buyerPrice"
              value={line.buyerPrice || ''}
              onChange={(e) => onLineChange(i, e)}
            />
            <button
              type="button"
              onClick={() => onOpenQualityModal && onOpenQualityModal('buyerPrice', i)}
              style={pickerButtonStyle}
              title="Select Buyer Price"
            >
              ...
            </button>
          </div>
        </td>
      ),
      sellerDelivery: () => (
        <td key="sellerDelivery">
          <input
            className="so-grid__input"
            name="sellerDelivery"
            value={line.sellerDelivery || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      buyerDelivery: () => (
        <td key="buyerDelivery">
          <input
            className="so-grid__input"
            name="buyerDelivery"
            value={line.buyerDelivery || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerBrokerageAmtPer: () => (
        <td key="sellerBrokerageAmtPer">
          <select
            className="so-grid__input"
            name="sellerBrokerageAmtPer"
            value={line.sellerBrokerageAmtPer || ''}
            onChange={(e) => onLineChange(i, e)}
          >
            <option value=""></option>
            <option value="Amount">Amount</option>
            <option value="Percentage">Percentage</option>
          </select>
        </td>
      ),
      sellerBrokeragePercent: () => (
        <td key="sellerBrokeragePercent">
          <input
            className="so-grid__input"
            name="sellerBrokeragePercent"
            value={line.sellerBrokeragePercent || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerBrokerage: () => (
        <td key="sellerBrokerage">
          <input
            className="so-grid__input"
            name="sellerBrokerage"
            value={line.sellerBrokerage || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      buyerBrokerage: () => (
        <td key="buyerBrokerage">
          <input
            className="so-grid__input"
            name="buyerBrokerage"
            value={line.buyerBrokerage || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      qtySpecialInstruction: () => (
        <td key="qtySpecialInstruction">
          <input
            className="so-grid__input"
            name="qtySpecialInstruction"
            value={line.qtySpecialInstruction || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      deliverySpecialInstruction: () => (
        <td key="deliverySpecialInstruction">
          <input
            className="so-grid__input"
            name="deliverySpecialInstruction"
            value={line.deliverySpecialInstruction || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      stdDiscount: () => (
        <td key="stdDiscount">
          <input
            className="so-grid__input"
            name="stdDiscount"
            value={line.stdDiscount}
            onChange={(e) => onLineChange(i, e)}
            onBlur={() => onNumBlur('stdDiscount', 'line', i)}
          />
        </td>
      ),
      stcode: () => (
        <td key="stcode">
          <input
            className="so-grid__input"
            name="stcode"
            value={line.stcode || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      taxCode: () => (
        <td key="taxCode">
          <TaxCodeLookup
            className="so-grid__input"
            style={{ width: '100%', textAlign: 'left' }}
            name="taxCode"
            value={line.taxCode || ''}
            onChange={(e) => onLineChange(i, e)}
            taxCodes={effectiveTaxCodes}
          />
        </td>
      ),
      taxAmount: () => (
        <td key="taxAmount">
          <input
            className="so-grid__input"
            value={formatMoneyValue(getTaxAmountDisplay(line))}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      totalLC: () => (
        <td key="totalLC">
          <input
            className="so-grid__input"
            value={formatMoneyValue(lineTotals.beforeTax)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      forRate: () => (
        <td key="forRate">
          <input
            className="so-grid__input"
            name="forRate"
            value={getDisplayForRate(line, effectiveTaxCodes)}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      whse: () => (
        <td key="whse">
          <select
            className="so-grid__input"
            style={{ width: '100%', textAlign: 'left', border: valErrors.lines[i]?.whse ? '1px solid #c00' : undefined }}
            name="whse"
            value={line.whse}
            onChange={(e) => onLineChange(i, e)}
          >
            <option value="">Select</option>
            {effectiveWarehouses.map((warehouse) => (
              <option key={warehouse.WhsCode} value={warehouse.WhsCode}>
                {warehouse.WhsCode}
              </option>
            ))}
            {line.whse && !effectiveWarehouses.some((warehouse) => warehouse.WhsCode === line.whse) && (
              <option value={line.whse}>{line.whse}</option>
            )}
          </select>
          {valErrors.lines[i]?.whse && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].whse}</div>
          )}
        </td>
      ),
      branch: () => (
        <td key="branch">
          <input
            className="so-grid__input"
            value={getBranchName?.(line.branch) || line.branch || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      distRule: () => (
        <td key="distRule">
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <input
              className="so-grid__input"
              value={line.distRule || ''}
              readOnly
              style={{ flex: 1, minWidth: 0, textAlign: 'left' }}
            />
            <button
              type="button"
              title="Select distribution rules"
              aria-label="Select distribution rules"
              onClick={() => setDistributionRuleAssignment({ open: true, rowIndex: i })}
              style={pickerButtonStyle}
            >
              ...
            </button>
          </div>
        </td>
      ),
      openQty: () => (
        <td key="openQty">
          <input
            className="so-grid__input"
            value={line.openQty || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      deliveredQty: () => (
        <td key="deliveredQty">
          <input
            className="so-grid__input"
            value={line.deliveredQty || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      countryOfOrigin: () => (
        <td key="countryOfOrigin">
          <select
            className="so-grid__input"
            name="countryOfOrigin"
            value={line.countryOfOrigin || noCountryCode}
            onChange={(e) => onLineChange(i, e)}
          >
            {!noCountryCode && <option value="">-No Country-</option>}
            {countries.map((country) => {
              const code = String(country.Code ?? country.code ?? '').trim();
              const name = String(country.Name ?? country.name ?? code).trim();
              return code ? <option key={code} value={code}>{name}</option> : null;
            })}
          </select>
        </td>
      ),
      freeText: () => (
        <td key="freeText">
          <input
            className="so-grid__input"
            name="freeText"
            value={line.freeText || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      uomName: () => (
        <td key="uomName">
          <input
            className="so-grid__input"
            name="uomName"
            value={line.uomNameEdited ? (line.uomName ?? '') : (line.uomName || line.uomCode || '')}
            onChange={(e) => onLineChange(i, e)}
            disabled={isBaseDocumentLine(line) || !(Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL')}
          />
        </td>
      ),
      loc: () => (
        <td key="loc">
          <input
            className="so-grid__input"
            value={getLineLocationDisplay(line)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      hsnCode: () => (
        <td key="hsnCode">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1, textAlign: 'left', border: valErrors.lines[i]?.hsnCode ? '1px solid #c00' : undefined }}
              name="hsnCode"
              value={line.hsnCode}
              onChange={(e) => onLineChange(i, e)}
              placeholder="HSN"
            />
            <button
              type="button"
              onClick={() => onOpenHSNModal && onOpenHSNModal(i)}
              style={pickerButtonStyle}
              title="Select HSN Code"
            >
              ...
            </button>
          </div>
          {valErrors.lines[i]?.hsnCode && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].hsnCode}</div>
          )}
        </td>
      ),
      lineShippingType: () => {
        const currentValue = String(line.lineShippingType ?? '').trim();
        const normalizedOptions = (shippingTypeOptions || []).map((option) => ({
          value: String(option?.value ?? option?.TrnspCode ?? '').trim(),
          label: String(option?.label ?? option?.TrnspName ?? option?.value ?? '').trim(),
        })).filter((option) => option.value);
        const hasCurrentOption = normalizedOptions.some((option) => option.value === currentValue);

        return (
          <td key={'lineShippingType'}>
            <select
              className={'so-grid__input'}
              name={'lineShippingType'}
              value={currentValue}
              onChange={(e) => onLineChange(i, e)}
              aria-label={`Shipping Type row ${i + 1}`}
            >
              <option value={''}></option>
              {currentValue && !hasCurrentOption ? (
                <option value={currentValue}>{currentValue}</option>
              ) : null}
              {normalizedOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </td>
        );
      },
      sacCode: () => (
        <td key="sacCode">
          <input
            className="so-grid__input"
            name="sacCode"
            value={line.sacCode || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      specialRebate: () => (
        <td key="specialRebate">
          <input
            className="so-grid__input"
            name="specialRebate"
            value={line.specialRebate || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      commission: () => (
        <td key="commission">
          <input
            className="so-grid__input"
            name="commission"
            value={line.commission || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerBrokeragePerQty: () => (
        <td key="sellerBrokeragePerQty">
          <input
            className="so-grid__input"
            name="sellerBrokeragePerQty"
            value={line.sellerBrokeragePerQty || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      buyerPaymentTerms: () => (
        <td key="buyerPaymentTerms">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1 }}
              name="buyerPaymentTerms"
              value={line.buyerPaymentTerms || ''}
              onChange={(e) => onLineChange(i, e)}
            />
            <button
              type="button"
              onClick={() => onOpenPaymentTermsModal && onOpenPaymentTermsModal('buyerPaymentTerms', i)}
              style={pickerButtonStyle}
              title="Select Buyer Terms of Payment"
            >
              ...
            </button>
          </div>
        </td>
      ),
      sellerPaymentTerms: () => (
        <td key="sellerPaymentTerms">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1 }}
              name="sellerPaymentTerms"
              value={line.sellerPaymentTerms || ''}
              onChange={(e) => onLineChange(i, e)}
            />
            <button
              type="button"
              onClick={() => onOpenPaymentTermsModal && onOpenPaymentTermsModal('sellerPaymentTerms', i)}
              style={pickerButtonStyle}
              title="Select Seller Terms of Payment"
            >
              ...
            </button>
          </div>
        </td>
      ),
      buyerSpecialInstruction: () => (
        <td key="buyerSpecialInstruction">
          <input
            className="so-grid__input"
            name="buyerSpecialInstruction"
            value={line.buyerSpecialInstruction || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerSpecialInstruction: () => (
        <td key="sellerSpecialInstruction">
          <input
            className="so-grid__input"
            name="sellerSpecialInstruction"
            value={line.sellerSpecialInstruction || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      buyerBillDiscount: () => (
        <td key="buyerBillDiscount">
          <input
            className="so-grid__input"
            name="buyerBillDiscount"
            value={line.buyerBillDiscount || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerBillDiscount: () => (
        <td key="sellerBillDiscount">
          <input
            className="so-grid__input"
            name="sellerBillDiscount"
            value={line.sellerBillDiscount || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerItem: () => (
        <td key="sellerItem">
          <input
            className="so-grid__input"
            name="sellerItem"
            value={line.sellerItem || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerQty: () => (
        <td key="sellerQty">
          <input
            className="so-grid__input"
            name="sellerQty"
            value={line.sellerQty || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      freightPurchase: () => (
        <td key="freightPurchase">
          <input
            className="so-grid__input"
            name="freightPurchase"
            value={line.freightPurchase || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      freightSales: () => (
        <td key="freightSales">
          <input
            className="so-grid__input"
            name="freightSales"
            value={line.freightSales || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      freightProvider: () => (
        <td key="freightProvider">
          <input
            className="so-grid__input"
            name="freightProvider"
            value={line.freightProvider || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      freightProviderName: () => (
        <td key="freightProviderName">
          <input
            className="so-grid__input"
            name="freightProviderName"
            value={line.freightProviderName || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      documentCreated: () => (
        <td key="documentCreated">
          <input
            className="so-grid__input"
            value={formatDateDisplay(line.documentCreated)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      brokerageNumber: () => (
        <td key="brokerageNumber">
          <input
            className="so-grid__input"
            name="brokerageNumber"
            value={line.brokerageNumber || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
    };

    if (!cellRenderers[rendererKey]) return renderGenericMatrixCell(column, line, i);
    const rendered = cellRenderers[rendererKey]();
    if (!React.isValidElement(rendered)) return rendered;

    const setting = getMatrixColumnSetting(column);
    // SAP/company layout preferences control visibility and ordering. Core
    // transaction fields keep their document editability; stale CPRF
    // EditInForm flags must not turn fields such as Discount into disabled
    // controls. Explicit UDF activity preferences remain respected, while
    // specialized renderers apply base-document/calculation/UoM locks.
    const disableSpecializedCell = Boolean(
      column.readOnly || (setting.active === false && isUdfMatrixColumn(column)),
    );
    return React.cloneElement(
      rendered,
      { key: columnKey },
      disableSpecializedCell ? (
        <fieldset
          disabled
          style={{ border: 0, margin: 0, minInlineSize: 0, padding: 0 }}
        >
          {rendered.props.children}
        </fieldset>
      ) : rendered.props.children,
    );
  };

  return (
    <>
    <div className="sap-tab-panel so-tab-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="so-section-title">Document Lines</div>
        <button type="button" className="so-btn so-btn--primary" onClick={onAddLine}>
          + Add Line
        </button>
      </div>

      <DocumentLinesTable
        tableProps={tableClipboardProps}
        rows={lines}
        columns={visibleColumns.map((column) => ({
          ...column,
          columnTitle: column.label || column.columnTitle || column.key,
          width: getReadableColumnWidth(column),
          minWidth: getReadableColumnWidth(column),
          columnOrder: column.columnOrder ?? column.order,
        }))}
        loading={loading}
        rowKey={(_row, index) => index}
        renderCell={(column, line, rowIndex) => {
          const uomOpts = getUomOptions(line);
          const lineTotals = isSalesBomComponentLine(line)
            ? { beforeTax: '0.00', total: '0.00' }
            : getLineTotalsForDisplay(line, effectiveTaxCodes);
          return renderCell(column, line, rowIndex, uomOpts, lineTotals);
        }}
        renderTrailingHeaderCell={() => <th style={{ width: 25 }}></th>}
        renderTrailingCell={(_row, rowIndex) => (
          <td>
            <button
              type="button"
              className="so-btn so-btn--danger"
              style={{ padding: '2px 8px', fontSize: 14 }}
              onClick={() => onRemoveLine(rowIndex)}
              title={lines[rowIndex]?.bomRole === 'component' ? 'Sales BOM components cannot be removed individually' : 'Remove line'}
            >
              x
            </button>
          </td>
        )}
      />
      {tableClipboardUi}
    </div>
    <LineValueLookupModal
      isOpen={dynamicUdfLookup.open}
      onClose={() => setDynamicUdfLookup((prev) => ({ ...prev, open: false }))}
      onSelect={handleDynamicUdfLookupSelect}
      options={dynamicUdfLookup.options}
      title={`List of ${dynamicUdfLookup.field?.label || 'Values'}`}
      searchPlaceholder="Search values"
      emptyMessage={dynamicUdfLookup.loading ? 'Loading values...' : (dynamicUdfLookup.error || 'No values found')}
      allowCreate={false}
      portalTarget={document.body}
    />
    <DistributionRuleAssignmentModal
      isOpen={distributionRuleAssignment.open}
      line={lines[distributionRuleAssignment.rowIndex]}
      rules={distributionRules}
      dimensions={distributionDimensions}
      onClose={() => setDistributionRuleAssignment({ open: false, rowIndex: -1 })}
      onApply={(valuesByDimension) => {
        if (distributionRuleAssignment.rowIndex >= 0) {
          onDistributionRuleChange?.(distributionRuleAssignment.rowIndex, valuesByDimension);
        }
        setDistributionRuleAssignment({ open: false, rowIndex: -1 });
      }}
    />
    </>
  );
}

export default function ContentsTab(props) {
  if (props.formSettingsReady === false) {
    return <DocumentLineSettingsLoading />;
  }

  return <ReadyContentsTab {...props} />;
}
