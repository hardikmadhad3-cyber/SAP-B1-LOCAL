import SapLookupTextInput from '../../../components/common/SapLookupTextInput';
import SapInput from '../../../components/common/SapInput';
import LiveUdfValueInput from '../../../components/sales-document/LiveUdfValueInput';
import SapDateInput from '../../../components/common/SapDateInput';
import React from 'react';
import TaxCodeLookup from '../../../components/TaxCodeLookup';
import { getLineTotalsForDisplay } from '../../../utils/lineTotals';
import { useSapItemCodeTab } from '../../../utils/sapTabNavigation';
import { BASE_MATRIX_COLUMNS } from '../../../config/purchaseRequestForm';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';
import { getReadableDocumentLineColumnWidth } from '../../../utils/documentLineColumnWidth';
import { isBaseDocumentLine } from '../../../utils/documentUom';

const DEFAULT_MATRIX_COLS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160 },
  { key: 'itemDescription', label: 'Description', minWidth: 220 },
  { key: 'hsnCode', label: 'HSN', minWidth: 115 },
  { key: 'quantity', label: 'Qty', minWidth: 80 },
  { key: 'unitPrice', label: 'Price', minWidth: 95 },
  { key: 'uomCode', label: 'UoM', minWidth: 85 },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'stdDiscount', label: 'Disc%', minWidth: 85 },
  { key: 'taxCode', label: 'Tax Code', minWidth: 115 },
  { key: 'totalBeforeTax', label: 'Total Before Tax', minWidth: 135 },
  { key: 'total', label: 'Total', minWidth: 105 },
  { key: 'whse', label: 'Whse', minWidth: 90 },
  { key: 'loc', label: 'LOC', minWidth: 115 },
  { key: 'branch', label: 'Branch', minWidth: 115 },
];

const INDEX_COL_WIDTH = 42;
const ACTION_COL_WIDTH = 48;
const DEFAULT_MATRIX_COLUMN_BY_KEY = new Map(DEFAULT_MATRIX_COLS.map((column) => [column.key, column]));
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
    ...(DEFAULT_MATRIX_COLUMN_BY_KEY.get(column.rendererKey || column.valueKey || column.key) || {}),
    ...(column.field || {}),
  },
);

const withWidths = (columns = []) => columns.map((column) => {
  const width = getColumnWidth(column);
  return { ...column, width, minWidth: width };
});

const normalizeUdfKey = (value) =>
  String(value || '').trim().toUpperCase().replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');

const isUdfColumn = (column = {}) => (
  Boolean(column.isUdf)
  || String(column.key || '').trim().toUpperCase().startsWith('U_')
  || String(column.sapField || '').trim().toUpperCase().startsWith('U_')
);

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
  documentType = 'Item',
  onDocumentTypeChange,
  documentTypeLocked = false,
  onOpenVendorModal,
  serviceAccounts = [],
}) {
  const sapItemTab = useSapItemCodeTab({ lineItemOptions, onLineChange, onOpenItemModal });
  const rowUdfFieldMap = React.useMemo(() => {
    const map = new Map();
    (rowUdfFields || []).filter((field) => field?.key).forEach((field) => {
      map.set(field.key, field);
      map.set(normalizeUdfKey(field.key), field);
    });
    return map;
  }, [rowUdfFields]);
  const sourceColumns = withWidths(Array.isArray(matrixFields) && matrixFields.length ? matrixFields : DEFAULT_MATRIX_COLS)
    .map((column) => (
      documentType === 'Service' && column.key === 'itemNo'
        ? { ...column, label: 'G/L Account' }
        : column
    ));
  const liveColumns = sourceColumns
    .filter((column) => documentType !== 'Service' || !['uomCode', 'uomName'].includes(column.key))
    .map((column) => {
      if (!isUdfColumn(column)) return column;
      const field = column.field || rowUdfFieldMap.get(column.key) || rowUdfFieldMap.get(normalizeUdfKey(column.key));
      return { ...column, field };
    })
    .filter((column) => !isUdfColumn(column) || Boolean(column.field));
  const matrixCols = getOrderedVisibleMatrixColumns(liveColumns, formSettings);
  const tableMinWidth = INDEX_COL_WIDTH + ACTION_COL_WIDTH + matrixCols.reduce((total, col) => total + col.minWidth, 0);

  const renderUdfCell = (column, line, index) => {
    const field = column.field;
    const value = line.udf?.[field.key] ?? '';
    const setting = formSettings.matrixColumns?.[column.key]
      || formSettings.rowUdfs?.[field.key]
      || {};
    const disabled = field.readOnly === true
      || field.active === false
      || setting.active === false;
    const updateValue = (nextValue) => onRowUdfChange && onRowUdfChange(index, field.key, nextValue);

    if (field.lookupSource) {
      return <td key={column.key}><LiveUdfValueInput field={field} line={line} value={value} disabled={disabled} onChange={updateValue} /></td>;
    }

    if (field.type === 'select' || (field.options || []).length) {
      return (
        <td key={column.key}>
          <select className="so-grid__input" value={value} disabled={disabled} onChange={(event) => updateValue(event.target.value)}>
            <option value=""></option>
            {(field.options || []).map((option) => {
              const normalized = typeof option === 'object' ? option : { value: option, label: option };
              return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>;
            })}
          </select>
        </td>
      );
    }

    if (field.type === 'checkbox') {
      return (
        <td key={column.key}>
          <input
            type="checkbox"
            checked={['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value).trim().toUpperCase())}
            disabled={disabled}
            onChange={(event) => updateValue(event.target.checked ? 'Y' : 'N')}
          />
        </td>
      );
    }

    return (
      <td key={column.key}>
        <SapInput
          className="so-grid__input"
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          value={value}
          disabled={disabled}
          onChange={(event) => updateValue(event.target.value)}
        />
      </td>
    );
  };

  const renderTextInput = (key, line, index, options = {}) => (
    <td key={key}>
      <input
        className="so-grid__input"
        style={{
          width: '100%',
          textAlign: options.readOnly ? 'right' : 'left',
          background: options.readOnly ? '#f5f8fc' : undefined,
          border: valErrors.lines[index]?.[key] ? '1px solid #c00' : undefined,
          ...options.style,
        }}
        name={options.inputName || key}
        value={options.value ?? line[key] ?? ''}
        readOnly={options.readOnly}
        disabled={options.disabled}
        onChange={options.readOnly ? undefined : (event) => onLineChange(index, event)}
        onBlur={options.numeric ? () => onNumBlur(key, 'line', index) : undefined}
        title={line[key] || ''}
      />
      {valErrors.lines[index]?.[key] && (
        <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[index][key]}</div>
      )}
    </td>
  );

  const renderCell = (column, line, index, uomOpts, lineTotals) => {
    if (isUdfColumn(column) && column.field) {
      return renderUdfCell(column, line, index);
    }

    if (column.key === 'itemNo') {
      if (documentType === 'Service') {
        return (
          <td key={column.key}>
            <input
              className="so-grid__input"
              name="accountCode"
              list={`purchase-request-accounts-${index}`}
              value={line.accountCode || ''}
              onChange={(event) => onLineChange(index, event)}
              style={{ border: valErrors.lines[index]?.itemNo ? '1px solid #c00' : undefined }}
            />
            <datalist id={`purchase-request-accounts-${index}`}>
              {serviceAccounts.map((account) => (
                <option key={account.code} value={account.code}>{account.name}</option>
              ))}
            </datalist>
          </td>
        );
      }
      return (
        <td key={column.key}>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <SapLookupTextInput
              className="so-grid__input"
              style={{ flex: 1, textAlign: 'left', border: valErrors.lines[index]?.itemNo ? '1px solid #c00' : undefined }}
              name="itemNo"
              data-sap-lookup="item"
              data-sap-row-index={index}
              onKeyDown={(event) => sapItemTab.handleItemCodeTab(event, index)}
              value={line.itemNo || ''}
              onChange={(event) => onLineChange(index, event)}
              placeholder="Item Code"
            />
            <button type="button" onClick={() => onOpenItemModal && onOpenItemModal(index)} style={pickerButtonStyle} title="Select Item">...</button>
          </div>
          {valErrors.lines[index]?.itemNo && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[index].itemNo}</div>
          )}
        </td>
      );
    }

    if (column.key === 'vendor') {
      return (
        <td key={column.key}>
          <div className="pr-line-lookup">
            <input
              className="so-grid__input"
              name="vendor"
              value={line.vendor || ''}
              onChange={(event) => onLineChange(index, event)}
              placeholder="Vendor Code"
              data-sap-lookup="vendor"
              data-sap-row-index={index}
            />
            <button
              type="button"
              onClick={() => onOpenVendorModal?.(index)}
              style={pickerButtonStyle}
              title="Select Vendor"
            >
              ...
            </button>
          </div>
        </td>
      );
    }

    if (column.key === 'requiredDate') {
      return (
        <td key={column.key}>
          <SapDateInput
            
            className="so-grid__input"
            name="requiredDate"
            value={line.requiredDate || ''}
            onChange={(event) => onLineChange(index, event)}
            style={{ border: valErrors.lines[index]?.requiredDate ? '1px solid #c00' : undefined }}
          />
          {valErrors.lines[index]?.requiredDate && (
            <div style={{ color: '#c00', fontSize: 10 }}>{valErrors.lines[index].requiredDate}</div>
          )}
        </td>
      );
    }

    if (column.key === 'hsnCode') {
      return (
        <td key={column.key}>
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="so-grid__input"
              style={{ flex: 1, textAlign: 'left', border: valErrors.lines[index]?.hsnCode ? '1px solid #c00' : undefined }}
              name="hsnCode"
              value={line.hsnCode || ''}
              onChange={(event) => onLineChange(index, event)}
              placeholder="HSN/SAC"
            />
            <button type="button" onClick={() => onOpenHSNModal && onOpenHSNModal(index)} style={pickerButtonStyle} title="Select HSN Code">...</button>
          </div>
          {valErrors.lines[index]?.hsnCode && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[index].hsnCode}</div>
          )}
        </td>
      );
    }

    if (column.key === 'uomCode') {
      return (
        <td key={column.key}>
          <select className="so-grid__input" style={{ width: '100%', textAlign: 'left' }} name="uomCode" value={line.uomCode || ''} onChange={(event) => onLineChange(index, event)} disabled={documentType === 'Service' || isBaseDocumentLine(line) || Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL'}>
            <option value=""></option>
            {uomOpts.map((uom) => <option key={uom} value={uom}>{uom}</option>)}
            {line.uomCode && !uomOpts.includes(line.uomCode) && <option value={line.uomCode}>{line.uomCode}</option>}
          </select>
        </td>
      );
    }

    if (column.key === 'uomName') {
      return (
        <td key={column.key}>
          <input
            className="so-grid__input"
            name="uomName"
            value={line.uomNameEdited ? (line.uomName ?? '') : (line.uomName || line.uomCode || '')}
            onChange={(event) => onLineChange(index, event)}
            disabled={documentType === 'Service' || isBaseDocumentLine(line) || !(Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL')}
          />
        </td>
      );
    }

    if (column.key === 'taxCode') {
      return (
        <td key={column.key}>
          <TaxCodeLookup
            className="so-grid__input"
            style={{ width: '100%', textAlign: 'left' }}
            name="taxCode"
            value={line.taxCode || ''}
            onChange={(event) => onLineChange(index, event)}
            taxCodes={effectiveTaxCodes}
          />
        </td>
      );
    }

    if (column.key === 'whse') {
      return (
        <td key={column.key}>
          <select
            className="so-grid__input"
            style={{ width: '100%', textAlign: 'left', border: valErrors.lines[index]?.whse ? '1px solid #c00' : undefined }}
            name="whse"
            value={line.whse || ''}
            onChange={(event) => onLineChange(index, event)}
            disabled={documentType === 'Service'}
          >
            <option value="">Select</option>
            {effectiveWarehouses.map((warehouse) => <option key={warehouse.WhsCode} value={warehouse.WhsCode}>{warehouse.WhsCode}</option>)}
            {line.whse && !effectiveWarehouses.some((warehouse) => warehouse.WhsCode === line.whse) && <option value={line.whse}>{line.whse}</option>}
          </select>
          {valErrors.lines[index]?.whse && (
            <div style={{ color: '#c00', fontSize: 10, marginTop: 2 }}>{valErrors.lines[index].whse}</div>
          )}
        </td>
      );
    }

    if (column.key === 'totalBeforeTax') {
      return renderTextInput(column.key, line, index, { value: lineTotals.beforeTax, readOnly: true });
    }

    if (column.key === 'total') {
      return renderTextInput(column.key, line, index, { value: lineTotals.total, readOnly: true });
    }

    if (column.key === 'branch') {
      return renderTextInput(column.key, line, index, {
        value: getBranchName ? getBranchName(line.branch) : line.branch,
        readOnly: true,
        disabled: true,
      });
    }

    if (column.key === 'loc') {
      return renderTextInput(column.key, line, index, {
        value: line.loc,
        readOnly: true,
        disabled: true,
      });
    }

    return renderTextInput(column.key, line, index, {
      numeric: column.type === 'number' || ['quantity', 'unitPrice', 'stdDiscount'].includes(column.key),
      readOnly: Boolean(column.readOnly || column.displayOnly),
      disabled: column.active === false
        || (documentType === 'Service' && ['quantity', 'uomCode', 'whse'].includes(column.key)),
      style: column.key === 'itemDescription' ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined,
    });
  };

  return (
    <div className="so-tab-panel pr-contents-panel" style={{ overflow: 'visible', minWidth: 0, maxWidth: 'none' }}>
      <div className="pr-document-lines-header">
        <div className="so-section-title">Document Lines</div>
        <label className="so-field pr-doc-type-field">
          <span className="so-field__label">Item/Service Type</span>
          <select
            className="so-field__select"
            name="documentType"
            value={documentType}
            disabled={documentTypeLocked || !onDocumentTypeChange}
            onChange={(event) => onDocumentTypeChange?.(event.target.value)}
          >
            <option value="Item">Item</option>
            <option value="Service">Service</option>
          </select>
        </label>
        <button type="button" className="so-btn so-btn--primary" onClick={onAddLine}>+ Add Line</button>
      </div>
      <div className="so-grid-wrap so-grid-wrap--contents">
        <div className="so-grid-wrap__scroller so-grid-wrap__scroller--contents">
          <table className="so-grid so-grid--contents" style={{ width: 'max-content', minWidth: tableMinWidth, tableLayout: 'auto' }}>
            <colgroup>
              <col style={{ width: INDEX_COL_WIDTH }} />
              {matrixCols.map((column) => <col key={column.key} style={{ width: column.minWidth }} />)}
              <col style={{ width: ACTION_COL_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: INDEX_COL_WIDTH }}>#</th>
                {matrixCols.map((column) => <th key={column.key} style={{ minWidth: column.minWidth }}>{column.label}</th>)}
                <th style={{ width: ACTION_COL_WIDTH }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const uomOpts = getUomOptions(line);
                const lineTotals = getLineTotalsForDisplay(line, effectiveTaxCodes);
                return (
                  <tr key={index}>
                    <td className="so-grid__cell--muted" style={{ textAlign: 'center', fontSize: 11 }}>{index + 1}</td>
                    {matrixCols.map((column) => renderCell(column, line, index, uomOpts, lineTotals))}
                    <td>
                      <button type="button" className="so-btn so-btn--danger" style={{ padding: '2px 8px', fontSize: 14 }} onClick={() => onRemoveLine(index)}>x</button>
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
