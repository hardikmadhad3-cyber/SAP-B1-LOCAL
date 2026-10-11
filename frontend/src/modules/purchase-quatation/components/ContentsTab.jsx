import SapLookupTextInput from '../../../components/common/SapLookupTextInput';
import SapInput from '../../../components/common/SapInput';
import LiveUdfValueInput from '../../../components/sales-document/LiveUdfValueInput';
import React from 'react';
import TaxCodeLookup from '../../../components/TaxCodeLookup';
import { useSapItemCodeTab } from '../../../utils/sapTabNavigation';
import { BASE_MATRIX_COLUMNS } from '../../../config/purchaseQuotationForm';
import { getLineTotalsForDisplay } from '../../../utils/lineTotals';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';
import { getReadableDocumentLineColumnWidth } from '../../../utils/documentLineColumnWidth';
import { isBaseDocumentLine } from '../../../utils/documentUom';
import useDocumentTableClipboard from '../../../components/sales-document/useDocumentTableClipboard';

const COLUMN_WIDTHS = {
  itemNo: 160,
  itemDescription: 220,
  requiredDate: 125,
  quotedDate: 125,
  requiredQty: 110,
  quantity: 110,
  unitPrice: 110,
  unitPriceUdf: 110,
  price: 110,
  stdDiscount: 90,
  taxCode: 115,
  taxCodeRepeat: 110,
  taxAmount: 120,
  totalBeforeTax: 135,
  totalLC: 115,
  total: 115,
  whse: 90,
  distRule: 105,
  uomCode: 105,
  countryOfOrigin: 180,
  loc: 115,
  branch: 115,
  blanketAgreementNo: 150,
  U_Cost_Sheet: 125,
  U_PackingType: 140,
  U_ContainerType: 145,
  U_GrossWt: 110,
  U_TotalPackage: 130,
  sellerBrokerageAmtPer: 160,
  sellerBrokeragePercent: 175,
  buyerPaymentTerms: 175,
  sellerPaymentTerms: 175,
  buyerSpecialInstruction: 185,
  sellerSpecialInstruction: 185,
  freightProviderName: 165,
  documentCreated: 140,
  brokerageNumber: 145,
  U_Fix_Brock_B: 135,
  U_Fix_Brock_S: 140,
};

const INDEX_COL_WIDTH = 42;
const ACTION_COL_WIDTH = 48;
const BASE_MATRIX_COLUMN_BY_KEY = new Map(BASE_MATRIX_COLUMNS.map((column) => [column.key, column]));

const getColumnWidth = (column = {}) => getReadableDocumentLineColumnWidth(
  column,
  {
    ...(BASE_MATRIX_COLUMN_BY_KEY.get(column.rendererKey || column.valueKey || column.key) || {}),
    minWidth: COLUMN_WIDTHS[column.key]
      || BASE_MATRIX_COLUMN_BY_KEY.get(column.rendererKey || column.valueKey || column.key)?.minWidth,
    ...(column.field || {}),
  },
);

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

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDateDisplay = (value) => {
  if (!value) return '';
  return String(value).split('T')[0];
};

const normalizeLookupToken = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^U_/, '')
    .replace(/[^A-Z0-9]/g, '');

const findUdfFieldForColumn = (column = {}, rowUdfFields = []) => {
  const columnTokens = [
    column.key,
    column.sapField,
    column.fieldName,
    column.label,
  ].map(normalizeLookupToken).filter(Boolean);

  return (rowUdfFields || []).find((field) => {
    const fieldTokens = [
      field.key,
      field.sapField,
      field.aliasId,
      field.label,
      field.description,
      field.Descr,
    ].map(normalizeLookupToken).filter(Boolean);

    return columnTokens.some((token) => fieldTokens.includes(token));
  });
};

export default function ContentsTab({
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
  getBranchName,
  formSettings = {},
  matrixFields = BASE_MATRIX_COLUMNS,
  rowUdfFields = [],
  onRowUdfChange,
  canPasteTable = false,
  onPasteTable,
  onClipboardFeedback,
}) {
  const sapItemTab = useSapItemCodeTab({ lineItemOptions, onLineChange, onOpenItemModal });
  const baseMatrixFields = Array.isArray(matrixFields) && matrixFields.length ? matrixFields : BASE_MATRIX_COLUMNS;
  const matrixColumns = baseMatrixFields.map((column) => {
    const width = getColumnWidth(column);
    return { ...column, width, minWidth: width };
  });

  const visibleColumns = getOrderedVisibleMatrixColumns(matrixColumns, formSettings);
  const clipboardColumns = React.useMemo(() => visibleColumns.map((column) => {
    const setting = formSettings.matrixColumns?.[column.key] || formSettings.rowUdfs?.[column.key] || {};
    return {
      key: column.valueKey || column.rendererKey || column.key,
      label: column.label || column.key,
      isUdf: Boolean(column.isUdf || String(column.key || '').startsWith('U_')),
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

  const tableMinWidth =
    INDEX_COL_WIDTH +
    ACTION_COL_WIDTH +
    visibleColumns.reduce((total, col) => total + getColumnWidth(col), 0);

  const renderUdfCell = (field, line, i) => {
    const setting = formSettings.matrixColumns?.[field.key] || formSettings.rowUdfs?.[field.key] || {};
    const disabled = field.readOnly || setting.active === false;
    const value = line.udf?.[field.key] || '';

    if (field.lookupSource) {
      return <td key={field.key}><LiveUdfValueInput field={field} line={line} value={value} disabled={disabled} onChange={(nextValue) => onRowUdfChange && onRowUdfChange(i, field.key, nextValue)} /></td>;
    }

    if (field.type === 'select') {
      return (
        <td key={field.key}>
          <select
            className="so-grid__input"
            value={value}
            disabled={disabled}
            onChange={(e) => onRowUdfChange && onRowUdfChange(i, field.key, e.target.value)}
          >
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

    if (field.type === 'checkbox') {
      return (
        <td key={field.key}>
          <input
            type="checkbox"
            checked={['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase())}
            disabled={disabled}
            onChange={(e) => onRowUdfChange && onRowUdfChange(i, field.key, e.target.checked ? 'Y' : 'N')}
          />
        </td>
      );
    }

    return (
      <td key={field.key}>
        <SapInput
          className="so-grid__input"
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          value={value}
          disabled={disabled}
          onChange={(e) => onRowUdfChange && onRowUdfChange(i, field.key, e.target.value)}
        />
      </td>
    );
  };

  const renderCell = (column, line, i, uomOpts, lineTotals) => {
    const rendererKey = column.rendererKey || column.valueKey || column.key;
    if (column.isUdf && rendererKey !== 'itemNo') return renderUdfCell(column.field, line, i);

    const taxAmount = (() => {
      if (String(line.taxAmount ?? '').trim()) return line.taxAmount;
      if (!lineTotals.beforeTax || !lineTotals.total) return '';
      return (parseNumber(lineTotals.total) - parseNumber(lineTotals.beforeTax)).toFixed(2);
    })();

    const textInput = (key, options = {}) => (
      <td key={key}>
        <SapInput
          className="so-grid__input"
          name={key}
          value={line[key] || ''}
          onChange={(e) => onLineChange(i, e)}
          onBlur={options.numeric ? () => onNumBlur(key, 'line', i) : undefined}
          type={options.type || 'text'}
          readOnly={options.readOnly}
          disabled={options.disabled}
          style={options.style}
        />
      </td>
    );

    const readonlyInput = (key, value) => (
      <td key={key}>
        <input className="so-grid__input" value={value || ''} readOnly style={{ background: '#f5f8fc' }} />
      </td>
    );

    const shouldUseSapUdfLookup =
      ['taxCodeRepeat', 'price'].includes(column.key) ||
      [column.key, column.sapField, column.fieldName].some((value) =>
        String(value || '').trim().toUpperCase().startsWith('U_')
      );
    const sapUdfField = shouldUseSapUdfLookup && rendererKey !== 'itemNo'
      ? findUdfFieldForColumn(column, rowUdfFields)
      : null;
    if (sapUdfField?.lookupSource) {
      return <td key={column.key}><LiveUdfValueInput field={sapUdfField} line={line} value={line[column.key] || ''} disabled={sapUdfField.readOnly || formSettings.rowUdfs?.[sapUdfField.key]?.active === false} onChange={(nextValue) => onLineChange(i, { target: { name: column.key, value: nextValue } })} /></td>;
    }
    if (sapUdfField?.type === 'select' || sapUdfField?.options?.length) {
      return (
        <td key={column.key}>
          <select
            className="so-grid__input"
            name={column.key}
            value={line[column.key] || ''}
            disabled={sapUdfField.readOnly || formSettings.rowUdfs?.[sapUdfField.key]?.active === false}
            onChange={(e) => onLineChange(i, e)}
          >
            <option value=""></option>
            {(sapUdfField.options || []).map((option) => {
              const normalizedOption = typeof option === 'object' ? option : { value: option, label: option };
              return (
                <option key={normalizedOption.value} value={normalizedOption.value}>
                  {normalizedOption.label}
                </option>
              );
            })}
            {line[column.key] && !(sapUdfField.options || []).some((option) => {
              const normalizedOption = typeof option === 'object' ? option : { value: option, label: option };
              return String(normalizedOption.value || '') === String(line[column.key] || '');
            }) && (
              <option value={line[column.key]}>{line[column.key]}</option>
            )}
          </select>
        </td>
      );
    }

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
              value={line.itemNo || ''}
              onChange={(e) => onLineChange(i, e)}
              placeholder="Item Code"
            />
            {onOpenItemModal ? (
              <button type="button" onClick={() => onOpenItemModal(i)} style={pickerButtonStyle} title="Select Item">
                ...
              </button>
            ) : null}
          </div>
          {valErrors.lines[i]?.itemNo && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].itemNo}</div>
          )}
        </td>
      ),
      itemDescription: () => textInput('itemDescription', { style: { textAlign: 'left' } }),
      requiredDate: () => textInput('requiredDate', { type: 'date' }),
      quotedDate: () => textInput('quotedDate', { type: 'date' }),
      requiredQty: () => textInput('requiredQty', { numeric: true }),
      quantity: () => (
        <td key="quantity">
          <input
            className="so-grid__input"
            style={{ border: valErrors.lines[i]?.quantity ? '1px solid #c00' : undefined }}
            name="quantity"
            value={line.quantity || ''}
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
            value={line.unitPrice || ''}
            onChange={(e) => onLineChange(i, e)}
            onBlur={() => onNumBlur('unitPrice', 'line', i)}
          />
          {valErrors.lines[i]?.unitPrice && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].unitPrice}</div>
          )}
        </td>
      ),
      unitPriceUdf: () => textInput('unitPriceUdf', { numeric: true }),
      stdDiscount: () => textInput('stdDiscount', { numeric: true }),
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
      taxCodeRepeat: () => (
        <td key="taxCodeRepeat">
          <TaxCodeLookup
            className="so-grid__input"
            style={{ width: '100%', textAlign: 'left' }}
            name="taxCodeRepeat"
            value={line.taxCodeRepeat || ''}
            onChange={(e) => onLineChange(i, e)}
            taxCodes={effectiveTaxCodes}
          />
        </td>
      ),
      taxAmount: () => readonlyInput('taxAmount', taxAmount),
      totalBeforeTax: () => readonlyInput('totalBeforeTax', lineTotals.beforeTax),
      totalLC: () => readonlyInput('totalLC', lineTotals.beforeTax),
      total: () => readonlyInput('total', lineTotals.total),
      whse: () => (
        <td key="whse">
          <select
            className="so-grid__input"
            style={{ width: '100%', textAlign: 'left', border: valErrors.lines[i]?.whse ? '1px solid #c00' : undefined }}
            name="whse"
            value={line.whse || ''}
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
      uomCode: () => (
        <td key="uomCode">
          <select
            className="so-grid__input"
            style={{ width: '100%', textAlign: 'left', border: valErrors.lines[i]?.uomCode ? '1px solid #c00' : undefined }}
            name="uomCode"
            value={line.uomCode || ''}
            onChange={(e) => onLineChange(i, e)}
            disabled={isBaseDocumentLine(line) || Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL'}
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
      loc: () => readonlyInput('loc', getBranchName ? getBranchName(line.branch) : line.loc),
      branch: () => readonlyInput('branch', getBranchName ? getBranchName(line.branch) : line.branch),
      hsnCode: () => (
        <td key="hsnCode">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1, textAlign: 'left', border: valErrors.lines[i]?.hsnCode ? '1px solid #c00' : undefined }}
              name="hsnCode"
              value={line.hsnCode || ''}
              onChange={(e) => onLineChange(i, e)}
              placeholder="HSN"
            />
            <button type="button" onClick={() => onOpenHSNModal && onOpenHSNModal(i)} style={pickerButtonStyle} title="Select HSN Code">
              ...
            </button>
          </div>
          {valErrors.lines[i]?.hsnCode && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[i].hsnCode}</div>
          )}
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
      documentCreated: () => readonlyInput('documentCreated', formatDateDisplay(line.documentCreated)),
    };

    const numericFields = new Set([
      'sellerQty',
      'sellerBrokeragePerQty',
      'assessableValue',
      'bedRate',
      'bedAmount',
      'specialRebate',
      'commission',
      'sellerBrokerage',
      'buyerBrokerage',
      'sellerBrokeragePercent',
      'buyerBillDiscount',
      'sellerBillDiscount',
      'freightPurchase',
      'freightSales',
      'price',
      'U_GrossWt',
      'U_TotalPackage',
      'U_Fix_Brock_B',
      'U_Fix_Brock_S',
    ]);

    return cellRenderers[rendererKey]
      ? cellRenderers[rendererKey]()
      : textInput(column.key, { numeric: numericFields.has(column.key) });
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
          <table
            {...tableClipboardProps}
            className="so-grid so-grid--contents"
            style={{ width: 'max-content', minWidth: tableMinWidth, tableLayout: 'auto' }}
          >
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
                    {column.label}
                  </th>
                ))}
                <th style={{ width: ACTION_COL_WIDTH }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const uomOpts = getUomOptions(line);
                const lineTotals = getLineTotalsForDisplay(line, effectiveTaxCodes);

                return (
                  <tr key={i}>
                    <td className="so-grid__cell--muted" style={{ textAlign: 'center', fontSize: 11 }}>
                      {i + 1}
                    </td>
                    {visibleColumns.map((column) => renderCell(column, line, i, uomOpts, lineTotals))}
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
          {tableClipboardUi}
        </div>
      </div>
    </div>
  );
}
