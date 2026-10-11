import SapLookupTextInput from '../../../components/common/SapLookupTextInput';
import SapInput from '../../../components/common/SapInput';
import LiveUdfValueInput from '../../../components/sales-document/LiveUdfValueInput';
import React from 'react';
import TaxCodeLookup from '../../../components/TaxCodeLookup';
import { useSapItemCodeTab } from '../../../utils/sapTabNavigation';
import { getLineTotalsForDisplay } from '../../../utils/lineTotals';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';
import { getReadableDocumentLineColumnWidth } from '../../../utils/documentLineColumnWidth';
import { isBaseDocumentLine } from '../../../utils/documentUom';
import useDocumentTableClipboard from '../../../components/sales-document/useDocumentTableClipboard';
import {
  BASE_MATRIX_COLUMNS,
} from '../../../config/purchaseOrderForm';

const MATRIX_COLS = BASE_MATRIX_COLUMNS;
const BASE_MATRIX_COLUMN_BY_KEY = new Map(MATRIX_COLS.map((column) => [column.key, column]));

const INDEX_COL_WIDTH = 42;
const ACTION_COL_WIDTH = 48;

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
const getColumnWidth = (column = {}) => getReadableDocumentLineColumnWidth(
  column,
  {
    ...(BASE_MATRIX_COLUMN_BY_KEY.get(column.rendererKey || column.valueKey || column.key) || {}),
    ...(column.field || {}),
  },
);

const NUMERIC_FIELDS = new Set([
  'quantity',
  'unitPrice',
  'forRate',
  'grossWt',
  'totalPackage',
  'commPercent',
  'price',
  'sellerBrokerage',
  'buyerBrokerage',
  'sellerBrokeragePercent',
  'sellerQty',
  'specialRebate',
  'commission',
  'sellerBrokeragePerQty',
  'fixBrokBuyer',
  'fixBrockSeller',
]);

const LINE_FIELD_TO_UDF_KEY = {
  packingType: ['U_PackingType', 'U_PACKINGTYPE', 'U_Packing_Type', 'U_PackingStatus', 'U_PACKINGSTATUS'],
  containerType: ['U_ContainerType', 'U_CONTAINERTYPE', 'U_Container_Type'],
  costSheet: ['U_Cost_Sheet', 'U_COST_SHEET', 'U_CostSheet'],
  grossWt: ['U_GrossWt', 'U_GROSSWT', 'U_Gross_Wt', 'U_GrossWeight', 'U_GROSSWEIGHT'],
  totalPackage: ['U_TotalPackage', 'U_TOTALPACKAGE', 'U_Total_Package', 'U_TotalPackge'],
  forRate: ['U_ForRate', 'U_FORRATE', 'U_ForPrice', 'U_FORPRICE', 'U_FOR_PRICE', 'U_FORPrice', 'U_FOR_Price'],
  taxCodeRepeat: 'U_TAXCODE',
  price: ['U_PRICE', 'U_Price'],
  sellerBrokerage: 'U_Brok_Seller',
  buyerBrokerage: ['U_Brok_Buyer', 'U_Buyer_Brokerage', 'U_BUYERBROKERAGE', 'U_Brokerage_Buyer'],
  buyerDelivery: 'U_Buyer_Delivery',
  sellerDelivery: 'U_Seller_Delivery',
  buyerPaymentTerms: 'U_Buyer_Payment_Terms',
  sellerPaymentTerms: 'U_Seller_Payment_Term',
  buyerQuality: 'U_Buyer_Quality',
  sellerQuality: 'U_Seller_Quality',
  buyerPrice: 'U_Buyer_Price',
  sellerPrice: 'U_Seller_Price',
  buyerSpecialInstruction: 'U_Buyer_SPINS',
  sellerSpecialInstruction: 'U_Seller_SPINS',
  sellerBrokerageAmtPer: 'U_Sel_Brok_AP',
  sellerBrokeragePercent: 'U_Seller_Brok_Per',
  stcode: 'U_SELLTCODE',
  sellerItem: 'U_S_Item',
  sellerQty: 'U_S_Qty',
  specialRebate: 'U_SPLRBT',
  commission: 'U_COMPRC',
  sellerBrokeragePerQty: 'U_S_BrokPerQty',
  fixBrokBuyer: 'U_Fix_Brock_B',
  fixBrockSeller: 'U_Fix_Brock_S',
};

const isUdfColumn = (column = {}) => (
  Boolean(column.isUdf)
  || String(column.key || '').startsWith('U_')
  || String(column.valueKey || '').startsWith('U_')
);

const normalizeUdfKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^U_/, '')
    .replace(/[^A-Z0-9]/g, '');

const getMappedUdfField = (rowUdfFieldMap, mappedUdfKey) => {
  const mappedKeys = Array.isArray(mappedUdfKey) ? mappedUdfKey : [mappedUdfKey];
  for (const key of mappedKeys) {
    const field = rowUdfFieldMap.get(key) || rowUdfFieldMap.get(normalizeUdfKey(key));
    if (field) return field;
  }
  return null;
};

function EditableContentsTab({
  lines,
  onLineChange,
  onNumBlur,
  onAddLine,
  onRemoveLine,
  lineItemOptions,
  getUomOptions,
  effectiveTaxCodes,
  effectiveWarehouses,
  valErrors,
  onOpenHSNModal,
  onOpenItemModal,
  matrixFields = MATRIX_COLS,
  formSettings = {},
  rowUdfFields = [],
  onRowUdfChange,
  getBranchName,
  canPasteTable = false,
  onPasteTable,
  onClipboardFeedback,
}) {
  const sapItemTab = useSapItemCodeTab({ lineItemOptions, onLineChange, onOpenItemModal });

  const rowUdfFieldMap = React.useMemo(
    () => {
      const map = new Map();
      (rowUdfFields || []).filter((field) => field?.key).forEach((field) => {
        map.set(field.key, field);
        map.set(normalizeUdfKey(field.key), field);
      });
      return map;
    },
    [rowUdfFields]
  );

  const baseColumns = React.useMemo(() => {
    const sourceColumns = Array.isArray(matrixFields) && matrixFields.length
      ? matrixFields
      : MATRIX_COLS;
    const liveColumns = sourceColumns
      .filter((column) => column?.key)
      .map((column, index) => {
        const udfField = isUdfColumn(column)
          ? (column.field || rowUdfFieldMap.get(column.key) || rowUdfFieldMap.get(normalizeUdfKey(column.key)))
          : null;
        return {
          ...column,
          field: udfField || column.field,
          minWidth: getColumnWidth(column),
          order: Number(column.order || column.columnOrder) || index + 1,
        };
      })
      // A stale layout UDF must never render unless the current company schema
      // supplied the corresponding row-UDF definition.
      .filter((column) => !isUdfColumn(column) || Boolean(column.field));

    return liveColumns
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
  }, [matrixFields, rowUdfFieldMap]);

  const getColumnSetting = (column = {}) => {
    const udfFieldKey = column.field?.key || column.key;
    const savedSetting = isUdfColumn(column)
      ? (formSettings.matrixColumns?.[column.key] || formSettings.rowUdfs?.[udfFieldKey] || {})
      : (formSettings.matrixColumns?.[column.key] || {});

    return {
      ...savedSetting,
      visible: savedSetting.visible !== false && column.visible !== false,
      active: savedSetting.active !== false && column.active !== false && column.readOnly !== true,
    };
  };

  const visibleColumns = getOrderedVisibleMatrixColumns(baseColumns, formSettings);
  const clipboardColumns = React.useMemo(() => visibleColumns.map((column) => {
    const setting = getColumnSetting(column);
    return {
      key: column.valueKey || column.rendererKey || column.key,
      label: column.label || column.key,
      isUdf: isUdfColumn(column),
      readOnly: Boolean(column.readOnly || setting.active === false),
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
  const tableMinWidth = INDEX_COL_WIDTH + ACTION_COL_WIDTH + visibleColumns.reduce((total, col) => total + getColumnWidth(col), 0);

  const renderInput = (line, rowIndex, fieldName, options = {}) => (
    <SapInput
      className="so-grid__input"
      name={fieldName}
      type={options.type || (NUMERIC_FIELDS.has(fieldName) ? 'number' : 'text')}
      value={options.value ?? line[fieldName] ?? ''}
      readOnly={options.readOnly}
      disabled={options.disabled}
      style={options.style}
      onChange={(e) => onLineChange(rowIndex, e)}
      onBlur={options.onBlur}
    />
  );

  const getTaxRate = React.useCallback((taxCode = '') => {
    const code = String(taxCode || '').trim();
    if (!code) return 0;
    const exact = effectiveTaxCodes.find((tax) => String(tax.Code || '').trim() === code);
    if (exact?.Rate != null) return Number(exact.Rate) || 0;
    const codePrefix = code.split(/\s|-/).filter(Boolean).slice(0, 2).join('-');
    const prefixed = effectiveTaxCodes.find((tax) => String(tax.Code || '').trim() === codePrefix);
    if (prefixed?.Rate != null) return Number(prefixed.Rate) || 0;
    const numericRate = String(code).match(/(\d+(?:\.\d+)?)\s*%/);
    return numericRate ? Number(numericRate[1]) || 0 : 0;
  }, [effectiveTaxCodes]);

  const getCalculatedForRate = React.useCallback((line = {}) => {
    const unitPrice = Number(line.unitPrice || 0);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return '';
    const rate = getTaxRate(line.taxCode);
    return (unitPrice * (1 + rate / 100)).toFixed(5);
  }, [getTaxRate]);

  const renderMappedInput = (line, rowIndex, fieldName, options = {}) => {
    const mappedUdfKey = LINE_FIELD_TO_UDF_KEY[fieldName];
    const udfField = getMappedUdfField(rowUdfFieldMap, mappedUdfKey);
    const disabled = options.disabled || udfField?.active === false;
    const optionsList = udfField?.options || [];
    const currentValue = fieldName === 'forRate'
      ? (line[fieldName] || getCalculatedForRate(line))
      : (line[fieldName] || '');
    const hasCurrentOption = optionsList.some((option) => {
      const normalizedOption = typeof option === 'object' ? option : { value: option };
      return String(normalizedOption.value ?? '') === String(currentValue);
    });

    if (udfField?.lookupSource) {
      return <LiveUdfValueInput field={udfField} line={line} value={currentValue} disabled={disabled} onChange={(nextValue) => onLineChange(rowIndex, { target: { name: fieldName, value: nextValue } })} />;
    }

    if (udfField?.type === 'select' || optionsList.length > 0) {
      return (
        <select
          className="so-grid__input"
          name={fieldName}
          value={currentValue}
          disabled={disabled}
          onChange={(e) => onLineChange(rowIndex, e)}
        >
          <option value=""></option>
          {optionsList.map((option) => {
            const normalizedOption = typeof option === 'object' ? option : { value: option, label: option };
            return (
              <option key={normalizedOption.value} value={normalizedOption.value}>
                {normalizedOption.label}
              </option>
            );
          })}
          {currentValue && !hasCurrentOption && (
            <option value={currentValue}>{currentValue}</option>
          )}
        </select>
      );
    }

    return renderInput(line, rowIndex, fieldName, {
      ...options,
      disabled,
      type: udfField?.type === 'date' ? 'date' : options.type,
      value: currentValue,
    });
  };

  const renderGenericUdfCell = (column, line, rowIndex) => {
    const field = column.field || rowUdfFieldMap.get(column.key) || column;
    const disabled = field.active === false || getColumnSetting(column).active === false;
    const value = line.udf?.[field.key] || '';
    const change = (nextValue) => onRowUdfChange && onRowUdfChange(rowIndex, field.key, nextValue);

    if (field.lookupSource) {
      return <td key={column.key}><LiveUdfValueInput field={field} line={line} value={value} disabled={disabled} onChange={change} /></td>;
    }

    if (field.type === 'select') {
      return (
        <td key={column.key}>
          <select className="so-grid__input" value={value} onChange={(e) => change(e.target.value)} disabled={disabled}>
            <option value=""></option>
            {(field.options || []).map((option) => {
              const normalizedOption = typeof option === 'object' ? option : { value: option, label: option };
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

    return (
      <td key={column.key}>
        <SapInput
          className="so-grid__input"
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => change(e.target.value)}
          disabled={disabled}
        />
      </td>
    );
  };

  const renderCell = (column, line, rowIndex, uomOpts, lineTotals) => {
    const key = column.key;

    if (isUdfColumn(column)) {
      return renderGenericUdfCell(column, line, rowIndex);
    }

    switch (key) {
      case 'itemNo':
        return (
          <td key={key}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <SapLookupTextInput
                className="so-grid__input"
                style={{ flex: 1, textAlign: 'left', border: valErrors.lines[rowIndex]?.itemNo ? '1px solid #c00' : undefined }}
                name="itemNo"
                data-sap-lookup="item"
                data-sap-row-index={rowIndex}
                onKeyDown={(e) => sapItemTab.handleItemCodeTab(e, rowIndex)}
                value={line.itemNo || ''}
                onChange={(e) => onLineChange(rowIndex, e)}
                placeholder="Item Code"
              />
              <button type="button" onClick={() => onOpenItemModal && onOpenItemModal(rowIndex)} style={pickerButtonStyle} title="Select Item">
                ...
              </button>
            </div>
            {valErrors.lines[rowIndex]?.itemNo && (
              <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[rowIndex].itemNo}</div>
            )}
          </td>
        );
      case 'itemDescription':
        return (
          <td key={key}>
            {renderInput(line, rowIndex, 'itemDescription', {
              type: 'text',
              style: { width: '100%', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            })}
          </td>
        );
      case 'hsnCode':
        return (
          <td key={key}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <input
                className="so-grid__input"
                style={{ flex: '1 1 0', minWidth: 96, textAlign: 'left', border: valErrors.lines[rowIndex]?.hsnCode ? '1px solid #c00' : undefined }}
                name="hsnCode"
                value={line.hsnCode || ''}
                onChange={(e) => onLineChange(rowIndex, e)}
                placeholder="HSN/SAC"
              />
              <button type="button" onClick={() => onOpenHSNModal && onOpenHSNModal(rowIndex)} style={pickerButtonStyle} title="Select HSN Code">
                ...
              </button>
            </div>
            {valErrors.lines[rowIndex]?.hsnCode && (
              <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[rowIndex].hsnCode}</div>
            )}
          </td>
        );
      case 'quantity':
      case 'unitPrice':
        return (
          <td key={key}>
            {renderInput(line, rowIndex, key, {
              onBlur: () => onNumBlur(key, 'line', rowIndex),
              style: { border: valErrors.lines[rowIndex]?.[key] ? '1px solid #c00' : undefined },
            })}
            {valErrors.lines[rowIndex]?.[key] && (
              <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[rowIndex][key]}</div>
            )}
          </td>
        );
      case 'uomCode':
        return (
          <td key={key}>
            <select className="so-grid__input" name="uomCode" value={line.uomCode || ''} onChange={(e) => onLineChange(rowIndex, e)} disabled={isBaseDocumentLine(line) || Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL'}>
              <option value=""></option>
              {uomOpts.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
              {line.uomCode && !uomOpts.includes(line.uomCode) && <option value={line.uomCode}>{line.uomCode}</option>}
            </select>
          </td>
        );
      case 'uomName':
        return (
          <td key={key}>
            <input className="so-grid__input" name="uomName" value={line.uomNameEdited ? (line.uomName ?? '') : (line.uomName || line.uomCode || '')} onChange={(e) => onLineChange(rowIndex, e)} disabled={isBaseDocumentLine(line) || !(Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL')} />
          </td>
        );
      case 'taxCode':
        return (
          <td key={key}>
            <TaxCodeLookup
              className="so-grid__input"
              style={{ width: '100%', textAlign: 'left' }}
              name="taxCode"
              value={line.taxCode || ''}
              onChange={(e) => onLineChange(rowIndex, e)}
              taxCodes={effectiveTaxCodes}
            />
          </td>
        );
      case 'totalLC':
      case 'totalBeforeTax':
      case 'taxAmount':
      case 'taxAmountLC':
      case 'grossTotal':
      case 'totalDocumentCurrency':
      case 'priceAfterDiscount': {
        const value = ['totalLC', 'totalBeforeTax'].includes(key)
          ? lineTotals.beforeTax
          : ['taxAmount', 'taxAmountLC'].includes(key)
            ? (lineTotals.beforeTax === '' ? '' : (Number(lineTotals.total) - Number(lineTotals.beforeTax)).toFixed(2))
            : key === 'priceAfterDiscount'
              ? (line.unitPrice === '' || line.unitPrice == null ? '' : (Number(line.unitPrice) * (1 - Number(line.stdDiscount || 0) / 100)).toFixed(2))
              : lineTotals.total;
        return <td key={key}><input className="so-grid__input" value={value} readOnly style={{ background: '#f5f8fc' }} /></td>;
      }
      case 'total':
        return (
          <td key={key}>
            <input className="so-grid__input" value={lineTotals.total} readOnly style={{ background: '#f5f8fc' }} />
          </td>
        );
      case 'whse':
        return (
          <td key={key}>
            <select
              className="so-grid__input"
              style={{ width: '100%', textAlign: 'left', border: valErrors.lines[rowIndex]?.whse ? '1px solid #c00' : undefined }}
              name="whse"
              value={line.whse || ''}
              onChange={(e) => onLineChange(rowIndex, e)}
            >
              <option value="">Select</option>
              {effectiveWarehouses.map((warehouse) => (
                <option key={warehouse.WhsCode} value={warehouse.WhsCode}>{warehouse.WhsCode}</option>
              ))}
              {line.whse && !effectiveWarehouses.some((warehouse) => warehouse.WhsCode === line.whse) && (
                <option value={line.whse}>{line.whse}</option>
              )}
            </select>
            {valErrors.lines[rowIndex]?.whse && (
              <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[rowIndex].whse}</div>
            )}
          </td>
        );
      case 'sellerBrokerageAmtPer':
        return (
          <td key={key}>
            <select className="so-grid__input" name="sellerBrokerageAmtPer" value={line.sellerBrokerageAmtPer || ''} onChange={(e) => onLineChange(rowIndex, e)}>
              <option value=""></option>
              <option value="Amount">Amount</option>
              <option value="Percentage">Percentage</option>
            </select>
          </td>
        );
      case 'loc':
      case 'branch':
        return (
          <td key={key}>
            <input
              className="so-grid__input"
              value={(getBranchName ? getBranchName(line.branch) : '') || line[key] || ''}
              readOnly
              style={{ background: '#f5f8fc' }}
            />
          </td>
        );
      case 'distRule':
      case 'countryOfOrigin':
      case 'sac':
      case 'blanketAgreementNo':
        return (
          <td key={key}>
            {renderInput(line, rowIndex, key)}
          </td>
        );
      default:
        return (
          <td key={key}>
            {renderMappedInput(line, rowIndex, key, { readOnly: column.readOnly === true })}
          </td>
        );
    }
  };

  return (
    <div className="so-tab-panel" style={{ overflow: 'visible', minWidth: 0, maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="so-section-title">Document Lines</div>
        <button type="button" className="so-btn so-btn--primary" onClick={onAddLine}>
          + Add Line
        </button>
      </div>
      <div className="so-grid-wrap so-grid-wrap--contents">
        <div className="so-grid-wrap__scroller so-grid-wrap__scroller--contents">
          <table {...tableClipboardProps} className="so-grid so-grid--contents" style={{ width: 'max-content', minWidth: tableMinWidth, tableLayout: 'auto' }}>
            <colgroup>
              <col style={{ width: INDEX_COL_WIDTH }} />
              {visibleColumns.map((column) => (
                <col key={column.key} style={{ width: getColumnWidth(column) }} />
              ))}
              <col style={{ width: ACTION_COL_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: INDEX_COL_WIDTH }}>#</th>
                {visibleColumns.map((column) => (
                  <th key={column.key} style={{ minWidth: getColumnWidth(column) }}>
                    {column.label || column.key}
                  </th>
                ))}
                <th style={{ width: ACTION_COL_WIDTH }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, rowIndex) => {
                const uomOpts = getUomOptions(line);
                const lineTotals = getLineTotalsForDisplay(line, effectiveTaxCodes, 2, { preferCalculated: true });
                return (
                  <tr key={rowIndex}>
                    <td className="so-grid__cell--muted" style={{ textAlign: 'center', fontSize: 11 }}>{rowIndex + 1}</td>
                    {visibleColumns.map((column) => renderCell(column, line, rowIndex, uomOpts, lineTotals))}
                    <td>
                      <button
                        type="button"
                        className="so-btn so-btn--danger"
                        style={{ padding: '2px 8px', fontSize: 14 }}
                        onClick={() => onRemoveLine(rowIndex)}
                      >
                        x
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {tableClipboardUi}
        </div>
      </div>
    </div>
  );
}

export default function ContentsTab(props) {
  return <EditableContentsTab {...props} />;
}
