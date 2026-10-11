import SapInput from '../../../components/common/SapInput';
import React, { useRef } from 'react';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';

const COLUMNS = [
  { key: 'itemCode', label: 'Item No.', minWidth: 155 },
  { key: 'itemDescription', label: 'Item Description', minWidth: 210, readOnly: true },
  { key: 'quantity', label: 'Quantity', minWidth: 90, numeric: true },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 105, numeric: true },
  { key: 'total', label: 'Total', minWidth: 110, numeric: true, readOnly: true },
  { key: 'binLocationAllocation', label: 'Bin Location Allocation', minWidth: 175, readOnly: true },
  { key: 'accountCode', label: 'Account Code', minWidth: 135, lookup: 'account' },
  { key: 'itemCost', label: 'Item Cost', minWidth: 110, numeric: true, readOnly: true },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105, readOnly: true },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'distributionRule', label: 'Distr. Rule', minWidth: 115, lookup: 'distRule' },
  { key: 'rg23aPartINo', label: 'RG23A Part I No.', minWidth: 145, udfLabels: ['RG23A Part I No.', 'RG23A Part I No', 'U_RG23APartI'] },
  { key: 'rg23cPartINo', label: 'RG23C Part I No.', minWidth: 145, udfLabels: ['RG23C Part I No.', 'RG23C Part I No', 'U_RG23CPartI'] },
  { key: 'location', label: 'Location', minWidth: 120, lookup: 'location' },
  { key: 'costSheet', label: 'Cost-Sheet', minWidth: 130, udfLabels: ['Cost-Sheet', 'U_CostSheet'] },
  { key: 'packingType', label: 'Packing-Type', minWidth: 140, udfLabels: ['Packing-Type', 'U_PackingType'] },
  { key: 'containerType', label: 'Container Type', minWidth: 145, udfLabels: ['Container Type', 'U_ContainerType'] },
  { key: 'grossWt', label: 'GrossWt', minWidth: 110, numeric: true, udfLabels: ['GrossWt', 'U_GrossWt'] },
  { key: 'totalPackage', label: 'Total-Package', minWidth: 130, numeric: true, udfLabels: ['Total-Package', 'U_TotalPackage'] },
  { key: 'taxCodeRepeat', label: 'TaxCode', minWidth: 110, udfLabels: ['TaxCode', 'U_TaxCode'] },
  { key: 'price', label: 'Price', minWidth: 110, numeric: true, udfLabels: ['Price', 'U_Price'] },
  { key: 'sellerBrokerage', label: 'Seller Brokerage', minWidth: 150, numeric: true, udfLabels: ['Seller Brokerage', 'U_Brok_Seller', 'U_SellerBrokerage'] },
  { key: 'buyerBrokerage', label: 'Buyer Brokerage', minWidth: 145, numeric: true, udfLabels: ['Buyer Brokerage', 'U_Brok_Buyer', 'U_BuyerBrokerage'] },
  { key: 'buyerDelivery', label: 'Buyer - Delivery', minWidth: 145, udfLabels: ['Buyer - Delivery', 'U_Buyer_Delivery', 'U_BuyerDelivery'] },
  { key: 'sellerDelivery', label: 'Seller - Delivery', minWidth: 145, udfLabels: ['Seller - Delivery', 'U_Seller_Delivery', 'U_SellerDelivery'] },
  { key: 'buyerTermsOfPayment', label: 'Buyer - Terms of payment', minWidth: 200, lookup: 'paymentTerm', udfLabels: ['Buyer - Terms of payment', 'Buyer - Terms of Payment', 'U_Buyer_Payment_Terms', 'U_BuyerTermsOfPayment', 'U_BuyerPayTerms'] },
  { key: 'sellerTermsOfPayment', label: 'Seller - Terms of Payment', minWidth: 205, lookup: 'paymentTerm', udfLabels: ['Seller - Terms of Payment', 'U_Seller_Payment_Terms', 'U_SellerTermsOfPayment', 'U_SellerPayTerms'] },
  { key: 'buyerQuality', label: 'Buyer - Quality', minWidth: 140, udfLabels: ['Buyer - Quality', 'U_Buyer_Quality', 'U_BuyerQuality'] },
  { key: 'sellerQuality', label: 'Seller - Quality', minWidth: 145, udfLabels: ['Seller - Quality', 'U_Seller_Quality', 'U_SellerQuality'] },
  { key: 'buyerPrice', label: 'Buyer - Price', minWidth: 130, numeric: true, udfLabels: ['Buyer - Price', 'U_Buyer_Price', 'U_BuyerPrice'] },
  { key: 'sellerPrice', label: 'Seller - Price', minWidth: 130, numeric: true, udfLabels: ['Seller - Price', 'U_Seller_Price', 'U_SellerPrice'] },
  { key: 'buyerSpecialInstruction', label: 'Buyer - Special Instruction', minWidth: 210, udfLabels: ['Buyer - Special Instruction', 'U_Buyer_SPINS', 'U_BuyerSpecialInstruction', 'U_BuyerSplInst'] },
  { key: 'sellerSpecialInstruction', label: 'Seller - Special Instruction', minWidth: 210, udfLabels: ['Seller - Special Instruction', 'U_Seller_SPINS', 'U_SellerSpecialInstruction', 'U_SellerSplInst'] },
  { key: 'sellerBrokerageAmountPer', label: 'Seller Brokerage(Amt./Per)', minWidth: 210, udfLabels: ['Seller Brokerage(Amt./Per)', 'Seller Brokerage Amt Per', 'U_Sel_Brok_AP', 'U_SellerBrokerageAmtPer', 'U_SellBrkAmtPer'] },
  { key: 'sellerBrokeragePercentage', label: 'Seller Brokerage in Percentage', minWidth: 225, numeric: true, udfLabels: ['Seller Brokerage in Percentage', 'U_Seller_Brok_Per', 'U_SellerBrokeragePercentage', 'U_SellerBrkPct'] },
  { key: 'stcode', label: 'STCODE', minWidth: 115, udfLabels: ['STCODE', 'STCode', 'U_SELLTCODE', 'U_STCODE'] },
  { key: 'sellerItem', label: 'S_Item', minWidth: 115, lookup: 'item', udfLabels: ['S_Item', 'U_S_Item', 'U_SItem'] },
  { key: 'sellerQuantity', label: 'S_Qty', minWidth: 95, numeric: true, udfLabels: ['S_Qty', 'U_S_Qty', 'U_SQty'] },
  { key: 'specialRebate', label: 'Special Rebate', minWidth: 135, numeric: true, udfLabels: ['Special Rebate', 'U_SPLRBT', 'U_SpecialRebate'] },
  { key: 'commision', label: 'Commision', minWidth: 115, numeric: true, udfLabels: ['Commision', 'Commission', 'U_COMPRC', 'U_Commision', 'U_Commission'] },
  { key: 'brokPerQty', label: 'BrokPerQty', minWidth: 120, numeric: true, udfLabels: ['BrokPerQty', 'U_S_BrokPerQty', 'U_BrokPerQty'] },
  { key: 'fixBrokBuyer', label: 'FIX Brok BUYER', minWidth: 135, numeric: true, udfLabels: ['FIX Brok BUYER', 'U_FIX_Brok_BUYER', 'U_FixBrokBuyer'] },
  { key: 'fixBrockSeller', label: 'Fix Brock Seller', minWidth: 140, numeric: true, udfLabels: ['Fix Brock Seller', 'U_Fix_Brock_Seller', 'U_FixBrockSeller'] },
  { key: 'sellerTermsOfPaymentDuplicate', label: 'Seller - Terms of Payment', minWidth: 205, lookup: 'paymentTerm', udfLabels: ['Seller - Terms of Payment', 'U_Seller_Payment_Terms', 'U_SellerTermsOfPayment', 'U_SellerPayTerms'] },
];

const STANDARD_KEYS = new Set([
  'itemCode',
  'itemDescription',
  'quantity',
  'unitPrice',
  'total',
  'binLocationAllocation',
  'accountCode',
  'itemCost',
  'uomCode',
  'uomName',
  'distributionRule',
  'location',
]);
const normalizeIdentity = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const fieldIdentities = (field = {}) => [field.key, field.sapField, field.aliasId, field.label, field.description].map(normalizeIdentity).filter(Boolean);
const getBoundUdf = (column, fields) => {
  if (column.udfField) return column.udfField;
  if (STANDARD_KEYS.has(column.key)) return null;
  const identities = [column.key, column.label, ...(column.udfLabels || [])].map(normalizeIdentity);
  return fields.find((field) => fieldIdentities(field).some((identity) => identities.includes(identity))) || null;
};

function ContentsTab({
  lines,
  activeRow,
  onFocusRow,
  onItemCodeChange,
  onItemCommit,
  onOpenItemModal,
  onFieldChange,
  onRowUdfChange,
  rowUdfFields = [],
  formSettings = {},
  onOpenLineLookup,
  onOpenBatchModal,
  onAddLine,
  onRemoveLine,
  errors,
}) {
  const inputRefs = useRef({});
  const visibleColumns = getOrderedVisibleMatrixColumns(COLUMNS, formSettings);

  const focusCell = (rowIndex, columnKey) => {
    const target = inputRefs.current[`${rowIndex}:${columnKey}`];
    target?.focus();
    target?.select?.();
  };

  const handleCellKeyDown = (event, rowIndex, columnKey) => {
    const columnIndex = visibleColumns.findIndex((column) => column.key === columnKey);
    if (columnIndex < 0) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = visibleColumns[columnIndex + 1];
      if (next) focusCell(rowIndex, next.key);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const previous = visibleColumns[columnIndex - 1];
      if (previous) focusCell(rowIndex, previous.key);
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      event.preventDefault();
      if (lines[rowIndex + 1]) focusCell(rowIndex + 1, columnKey);
      else {
        onAddLine();
        requestAnimationFrame(() => focusCell(rowIndex + 1, columnKey));
      }
    } else if (event.key === 'ArrowUp' && rowIndex > 0) {
      event.preventDefault();
      focusCell(rowIndex - 1, columnKey);
    }
  };

  const renderCell = (column, line, rowIndex, isCopiedRow, rowErrors) => {
    const udfField = getBoundUdf(column, rowUdfFields);
    const isUdf = !STANDARD_KEYS.has(column.key);
    const value = isUdf ? (udfField ? line.udf?.[udfField.key] || '' : '') : line[column.key] ?? '';
    const fieldInactive = isUdf && udfField
      ? formSettings.rowUdfs?.[udfField.key]?.active === false
      : formSettings.matrixColumns?.[column.key]?.active === false;
    const disabled = isUdf ? !udfField || udfField.readOnly || fieldInactive : Boolean(fieldInactive || column.readOnly || (isCopiedRow && ['quantity', 'unitPrice', 'accountCode', 'location'].includes(column.key)));
    const changeValue = (nextValue) => {
      if (isUdf && udfField) onRowUdfChange(rowIndex, udfField.key, nextValue);
      else onFieldChange(rowIndex, column.key, nextValue);
    };

    if (column.key === 'distributionRule') {
      const displayValue = [
        line.distributionRule,
        line.distributionRule2,
        line.distributionRule3,
        line.distributionRule4,
        line.distributionRule5,
      ].filter(Boolean).join(' / ');

      return (
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <input ref={(node) => { inputRefs.current[`${rowIndex}:${column.key}`] = node; }} className={`po-grid__input po-grid__input--text ${rowErrors[column.key] ? 'gr-goods-receipt__input--error' : ''}`} value={displayValue} readOnly title={displayValue} onFocus={() => onFocusRow(rowIndex)} onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.key)} />
          {!disabled && onOpenLineLookup && <button type="button" className="gr-goods-receipt__lookup-btn" onClick={() => onOpenLineLookup(column, rowIndex, udfField)} title={`Select ${column.label}`}>...</button>}
        </div>
      );
    }

    if (column.key === 'itemCode') {
      return (
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <input ref={(node) => { inputRefs.current[`${rowIndex}:itemCode`] = node; }} className={`po-grid__input po-grid__input--text ${rowErrors.itemCode ? 'gr-goods-receipt__input--error' : ''}`} value={line.itemCode} readOnly={isCopiedRow} onFocus={() => onFocusRow(rowIndex)} onChange={(event) => onItemCodeChange(rowIndex, event.target.value)} onBlur={() => onItemCommit(rowIndex)} onKeyDown={(event) => handleCellKeyDown(event, rowIndex, 'itemCode')} />
          {!isCopiedRow && <button type="button" className="gr-goods-receipt__lookup-btn" onClick={() => onOpenItemModal(rowIndex)} title="Select Item">...</button>}
        </div>
      );
    }

    if (column.key === 'binLocationAllocation') {
      return (
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <input
            ref={(node) => { inputRefs.current[`${rowIndex}:${column.key}`] = node; }}
            className={`po-grid__input po-grid__input--text ${rowErrors.batches || rowErrors.warehouse ? 'gr-goods-receipt__input--error' : ''}`}
            value={line.binLocationAllocation || (line.batchManaged && line.batches?.length ? `${line.batches.length} Assigned` : '')}
            readOnly
            title={line.batchManaged ? 'Batch allocation' : String(line.binLocationAllocation || '')}
            onFocus={() => onFocusRow(rowIndex)}
            onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.key)}
          />
          {line.batchManaged && onOpenBatchModal ? (
            <button type="button" className="gr-goods-receipt__lookup-btn" onClick={() => onOpenBatchModal(rowIndex)} title="Assign Batch">...</button>
          ) : null}
        </div>
      );
    }

    if (udfField?.type === 'select') {
      return (
        <select className="po-grid__input" value={value} disabled={disabled} onChange={(event) => changeValue(event.target.value)}>
          <option value=""></option>
          {(udfField.options || []).map((option) => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}
        </select>
      );
    }

    if (udfField?.type === 'checkbox') {
      return <input type="checkbox" checked={['Y', 'YES', 'TRUE', '1'].includes(String(value).toUpperCase())} disabled={disabled} onChange={(event) => changeValue(event.target.checked ? 'Y' : 'N')} />;
    }

    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <SapInput ref={(node) => { inputRefs.current[`${rowIndex}:${column.key}`] = node; }} className={`po-grid__input ${column.numeric ? '' : 'po-grid__input--text'} ${rowErrors[column.key] ? 'gr-goods-receipt__input--error' : ''}`} type={udfField?.type === 'date' ? 'date' : udfField?.type === 'number' ? 'number' : 'text'} value={value} readOnly={disabled} disabled={isUdf && !udfField} title={isUdf && !udfField ? 'Field is not configured on SAP IGN1' : String(value || '')} onFocus={() => onFocusRow(rowIndex)} onChange={(event) => changeValue(event.target.value)} onKeyDown={(event) => handleCellKeyDown(event, rowIndex, column.key)} />
        {column.lookup && !disabled && onOpenLineLookup && <button type="button" className="gr-goods-receipt__lookup-btn" onClick={() => onOpenLineLookup(column, rowIndex, udfField)} title={`Select ${column.label}`}>...</button>}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="po-section-title" style={{ marginBottom: 0 }}>Item Matrix</div>
        <button type="button" className="po-btn po-btn--primary" onClick={onAddLine}>+ Add Line</button>
      </div>
      <div className="po-grid-wrap gr-goods-receipt__grid-wrap">
        <table className="po-grid gr-goods-receipt__grid" style={{ width: 'max-content', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 38 }} />
            {visibleColumns.map((column) => <col key={column.key} style={{ width: column.minWidth }} />)}
            <col style={{ width: 38 }} />
          </colgroup>
          <thead><tr><th>#</th>{visibleColumns.map((column) => <th key={column.key}>{column.label}</th>)}<th></th></tr></thead>
          <tbody>
            {lines.map((line, rowIndex) => {
              const rowErrors = errors[rowIndex] || {};
              const isCopiedRow = line.baseEntry != null || line.lockedByCopy;
              return (
                <tr key={`${rowIndex}-${line.itemCode || 'blank'}`} className={activeRow === rowIndex ? 'gr-goods-receipt__row--active' : ''}>
                  <td className="po-grid__cell--muted" style={{ textAlign: 'center' }}>{rowIndex + 1}</td>
                  {visibleColumns.map((column) => <td key={column.key}>{renderCell(column, line, rowIndex, isCopiedRow, rowErrors)}{rowErrors[column.key] && <div className="po-error-feedback">{rowErrors[column.key]}</div>}</td>)}
                  <td><button type="button" className="po-btn po-btn--danger" style={{ padding: '1px 7px' }} onClick={() => onRemoveLine(rowIndex)}>x</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ContentsTab;
