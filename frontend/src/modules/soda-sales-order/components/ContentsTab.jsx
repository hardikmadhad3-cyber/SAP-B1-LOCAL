import SapLookupTextInput from '../../../components/common/SapLookupTextInput';
import SapInput from '../../../components/common/SapInput';
import React from 'react';
import TaxCodeLookup from '../../../components/TaxCodeLookup';
import { useSapItemCodeTab } from '../../../utils/sapTabNavigation';
import { filterSalesOrderRowUdfDefinitions } from '../../../config/sodaSalesOrderForm';

import { getLineTotalsForDisplay } from '../../../utils/lineTotals';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';

const TABLE_MIN_WIDTH = 2700;

const MATRIX_COLS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160 },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240 },
  { key: 'unit', label: 'Unit', minWidth: 105 },
  { key: 'quantity', label: 'Quantity', minWidth: 85 },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 110 },
  { key: 'discountAmount', label: 'Discount', minWidth: 105 },
  { key: 'amount', label: 'Amount', minWidth: 115 },
  { key: 'netRate', label: 'Net Rate', minWidth: 105 },
  { key: 'taxableAmount', label: 'Taxable Amount', minWidth: 130 },
  { key: 'totalLC', label: 'Total (LC)', minWidth: 115 },
  { key: 'taxCode', label: 'Tax Code', minWidth: 110 },
  { key: 'taxAmount', label: 'Tax Amount (LC)', minWidth: 115 },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 90 },
  { key: 'commissionAmountPerTon', label: 'comm amt per tone', minWidth: 140 },
  { key: 'commissionPercent', label: 'Commission (Percent)', minWidth: 150 },
  { key: 'commissionAmount', label: 'Commission', minWidth: 120 },
  { key: 'openQty', label: 'Open Qty', minWidth: 85 },
  { key: 'countryOfOrigin', label: 'Country/Region of Origin', minWidth: 175 },
  { key: 'loc', label: 'Loc.', minWidth: 120 },
  { key: 'hsnCode', label: 'HSN', minWidth: 95 },
  { key: 'sacCode', label: 'SAC', minWidth: 90 },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 170 },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 170 },
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
  { key: 'stcode', label: 'STCODE', minWidth: 110 },
  { key: 'whse', label: 'Whse', minWidth: 75 },
  { key: 'distRule', label: 'Distr. Rule', minWidth: 105 },
  { key: 'freeText', label: 'Free Text', minWidth: 150 },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105 },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 110 },
  { key: 'commission', label: 'Commision', minWidth: 100 },
  { key: 'sellerBrokeragePerQty', label: 'BrokPerQty', minWidth: 110 },
  { key: 'buyerPaymentTerms', label: 'Buyer - Terms of Payment', minWidth: 170 },
  { key: 'sellerPaymentTerms', label: 'Seller - Terms of Payment', minWidth: 170 },
  { key: 'freightPurchase', label: 'Freight Purchase', minWidth: 130 },
  { key: 'freightSales', label: 'Freight Sales', minWidth: 120 },
  { key: 'freightProvider', label: 'Freight Provider', minWidth: 120 },
  { key: 'freightProviderName', label: 'Freight Provider Name', minWidth: 160 },
  { key: 'documentCreated', label: 'Document Created', minWidth: 140 },
  { key: 'brokerageNumber', label: 'Brokerage Number', minWidth: 140 },
];

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '';
};

const getLineComputedValues = (line, taxCodes) => {
  const quantity = parseNumber(line.quantity);
  const unitPrice = parseNumber(line.unitPrice);
  const discountPercent = parseNumber(line.stdDiscount);
  const enteredDiscountAmount = String(line.discountAmount ?? '').trim();
  const discountAmount = enteredDiscountAmount
    ? parseNumber(enteredDiscountAmount)
    : unitPrice * discountPercent / 100;
  const commissionPercent = parseNumber(line.commission);
  const amount = quantity * unitPrice;
  const netRate = Math.max(unitPrice - discountAmount, 0);
  const totals = getLineTotalsForDisplay(line, taxCodes);
  const totalLC = quantity || unitPrice ? formatNumber(quantity * netRate) : totals.beforeTax;
  const commissionAmount = commissionPercent > 0 && amount > 0
    ? formatNumber(amount * commissionPercent / 100)
    : '';

  return {
    amount: amount ? formatNumber(amount) : '',
    discountAmount: enteredDiscountAmount ? line.discountAmount : (discountAmount ? formatNumber(discountAmount) : ''),
    netRate: quantity || unitPrice ? formatNumber(netRate) : '',
    taxableAmount: totals.beforeTax,
    totalLC,
    commissionAmount,
    totals,
  };
};

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

export default function ContentsTab({
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
  onOpenHSNModal,
  onOpenItemModal,
  onOpenQualityModal,
  onOpenPaymentTermsModal,
  formSettings = {},
  rowUdfFields = [],
  onRowUdfChange,
  getBranchName,
}) {
  const sapItemTab = useSapItemCodeTab({ lineItemOptions, onLineChange, onOpenItemModal });
  const getTaxAmountDisplay = (line) => {
    if (String(line.taxAmount ?? '').trim()) return line.taxAmount;
    const totals = getLineTotalsForDisplay(line, effectiveTaxCodes);
    if (!totals.beforeTax || !totals.total) return '';
    return (parseNumber(totals.total) - parseNumber(totals.beforeTax)).toFixed(2);
  };

  // Filter visible columns based on form settings
  const visibleRowUdfFields = filterSalesOrderRowUdfDefinitions(rowUdfFields);

  const matrixColumns = [
    ...MATRIX_COLS,
    ...visibleRowUdfFields.map((field) => ({
      key: field.key,
      label: field.label || field.key,
      minWidth: field.type === 'textarea' ? 180 : 125,
      isUdf: true,
      field,
    })),
  ];

  const visibleColumns = getOrderedVisibleMatrixColumns(matrixColumns, formSettings);

  // Helper to check if a column is visible
  const isColumnVisible = (columnKey) => {
    const setting = formSettings.matrixColumns?.[columnKey];
    return setting?.visible !== false;
  };

  // Create a map of column renderers
  const renderCell = (columnKey, line, i, uomOpts, lineTotals) => {
    const udfColumn = visibleRowUdfFields.find((field) => field.key === columnKey);
    if (udfColumn) {
      const disabled = udfColumn.readOnly || formSettings.rowUdfs?.[udfColumn.key]?.active === false;
      const value = line.udf?.[udfColumn.key] || '';

      return (
        <td key={udfColumn.key}>
          {udfColumn.type === 'select' ? (
            <select
              className="so-grid__input"
              value={value}
              disabled={disabled}
              onChange={(e) => onRowUdfChange && onRowUdfChange(i, udfColumn.key, e.target.value)}
            >
              <option value=""></option>
              {(udfColumn.options || []).map((option) => {
                const normalizedOption = typeof option === 'object' ? option : { value: option, label: option };
                return <option key={normalizedOption.value} value={normalizedOption.value}>{normalizedOption.label}</option>;
              })}
            </select>
          ) : udfColumn.type === 'checkbox' ? (
            <input
              type="checkbox"
              checked={['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase())}
              disabled={disabled}
              onChange={(e) => onRowUdfChange && onRowUdfChange(i, udfColumn.key, e.target.checked ? 'Y' : 'N')}
            />
          ) : (
            <SapInput
              className="so-grid__input"
              type={udfColumn.type === 'date' ? 'date' : udfColumn.type === 'number' ? 'number' : 'text'}
              value={value}
              disabled={disabled}
              onChange={(e) => onRowUdfChange && onRowUdfChange(i, udfColumn.key, e.target.value)}
            />
          )}
        </td>
      );
    }

    if (!isColumnVisible(columnKey)) return null;

    const cellRenderers = {
      itemNo: () => (
        <td key="itemNo">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
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
            />
            <button
              type="button"
              onClick={() => onOpenItemModal && onOpenItemModal(i)}
              style={pickerButtonStyle}
              title="Select Item"
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
              data-sap-row-index={i}
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
              data-sap-row-index={i}
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
          <input
            className="so-grid__input"
            style={{ border: valErrors.lines[i]?.unitPrice ? '1px solid #c00' : undefined }}
            name="unitPrice"
            value={line.unitPrice}
            onChange={(e) => onLineChange(i, e)}
            onBlur={() => onNumBlur('unitPrice', 'line', i)}
          />
          {valErrors.lines[i]?.unitPrice && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].unitPrice}</div>
          )}
        </td>
      ),
      discountAmount: () => (
        <td key="discountAmount">
          <input
            className="so-grid__input"
            name="discountAmount"
            value={line.discountAmount ?? ''}
            onChange={(e) => onLineChange(i, e)}
            onBlur={() => onNumBlur('discountAmount', 'line', i)}
          />
        </td>
      ),
      amount: () => (
        <td key="amount">
          <input
            className="so-grid__input"
            value={lineTotals.amount}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      netRate: () => (
        <td key="netRate">
          <input
            className="so-grid__input"
            value={lineTotals.netRate}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      taxableAmount: () => (
        <td key="taxableAmount">
          <input
            className="so-grid__input"
            value={lineTotals.taxableAmount}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      uomCode: () => (
        <td key="uomCode">
          <select
            className="so-grid__input"
            name="uomCode"
            value={line.uomCode || ''}
            onChange={(e) => onLineChange(i, e)}
          >
            <option value=""></option>
            {uomOpts.map((uom) => (
              <option key={uom} value={uom}>
                {uom}
              </option>
            ))}
            {line.uomCode && !uomOpts.includes(line.uomCode) && (
              <option value={line.uomCode}>{line.uomCode}</option>
            )}
          </select>
        </td>
      ),
      unit: () => (
        <td key="unit">
          <select
            className="so-grid__input"
            name="uomCode"
            value={line.uomCode || ''}
            onChange={(e) => onLineChange(i, e)}
          >
            <option value=""></option>
            {uomOpts.map((uom) => (
              <option key={uom} value={uom}>
                {uom}
              </option>
            ))}
            {line.uomCode && !uomOpts.includes(line.uomCode) && (
              <option value={line.uomCode}>{line.uomCode}</option>
            )}
          </select>
        </td>
      ),
      sellerPrice: () => (
        <td key="sellerPrice">
          <input
            className="so-grid__input"
            name="sellerPrice"
            data-sap-row-index={i}
            value={line.sellerPrice || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      buyerPrice: () => (
        <td key="buyerPrice">
          <input
            className="so-grid__input"
            name="buyerPrice"
            data-sap-row-index={i}
            value={line.buyerPrice || ''}
            onChange={(e) => onLineChange(i, e)}
          />
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
            readOnly
            style={{ background: '#f5f8fc' }}
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
            value={getTaxAmountDisplay(line)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      totalLC: () => (
        <td key="totalLC">
          <input
            className="so-grid__input"
            value={lineTotals.totalLC}
            readOnly
            style={{ background: '#f5f8fc' }}
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
      distRule: () => (
        <td key="distRule">
          <select
            className="so-grid__input"
            style={{ width: '100%', textAlign: 'left' }}
            name="distRule"
            value={line.distRule || ''}
            onChange={(e) => onLineChange(i, e)}
          >
            <option value="">Select</option>
            {distributionRules.map((rule) => (
              <option key={rule.FactorCode} value={rule.FactorCode}>
                {rule.FactorCode}{rule.FactorDescription ? ` - ${rule.FactorDescription}` : ''}
              </option>
            ))}
          </select>
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
          <input
            className="so-grid__input"
            name="countryOfOrigin"
            style={{ textTransform: 'uppercase' }}
            value={line.countryOfOrigin || ''}
            onChange={(e) => onLineChange(i, e)}
          />
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
          />
        </td>
      ),
      loc: () => (
        <td key="loc">
          <input
            className="so-grid__input"
            value={(getBranchName && getBranchName(line.loc)) || line.loc || ''}
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
      commissionPercent: () => (
        <td key="commissionPercent">
          <input
            className="so-grid__input"
            name="commission"
            value={line.commission || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      commissionAmountPerTon: () => (
        <td key="commissionAmountPerTon">
          <input
            className="so-grid__input"
            name="sellerBrokeragePerQty"
            value={line.sellerBrokeragePerQty || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      commissionAmount: () => (
        <td key="commissionAmount">
          <input
            className="so-grid__input"
            value={lineTotals.commissionAmount || line.sellerBrokerage || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
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
              data-sap-row-index={i}
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
              data-sap-row-index={i}
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

    return cellRenderers[columnKey] ? cellRenderers[columnKey]() : null;
  };

  return (
    <div className="so-tab-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="so-section-title">Document Lines</div>
        <button type="button" className="so-btn so-btn--primary" onClick={onAddLine}>
          + Add Line
        </button>
      </div>

      <div className="so-grid-wrap so-grid-wrap--contents">
        <div
          className="so-grid-wrap__scroller so-grid-wrap__scroller--contents"
        >
          <table
            className="so-grid so-grid--contents"
            style={{
              width: 'max-content',
              minWidth: TABLE_MIN_WIDTH,
            }}
          >
          <colgroup>
            <col style={{ width: 42 }} />
            {visibleColumns.map((column) => (
              <col key={column.key} style={{ width: column.minWidth }} />
            ))}
            <col style={{ width: 48 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: 42 }}>#</th>
              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  style={{ minWidth: column.minWidth }}
                >
                  {column.label}
                </th>
              ))}
              <th style={{ width: 25 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const uomOpts = getUomOptions(line);
              const lineTotals = getLineComputedValues(line, effectiveTaxCodes);

              return (
                <tr key={i}>
                  <td className="so-grid__cell--muted" style={{ textAlign: 'center', fontSize: 11 }}>
                    {i + 1}
                  </td>

                  {visibleColumns.map(col => renderCell(col.key, line, i, uomOpts, lineTotals))}

                  <td>
                    <button
                      type="button"
                      className="so-btn so-btn--danger"
                      style={{ padding: '2px 8px', fontSize: 14 }}
                      onClick={() => onRemoveLine(i)}
                    >
                      x
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
