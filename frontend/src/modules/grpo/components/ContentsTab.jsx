import SapLookupTextInput from '../../../components/common/SapLookupTextInput';
import SapInput from '../../../components/common/SapInput';
import LiveUdfValueInput from '../../../components/sales-document/LiveUdfValueInput';
import React from 'react';
import { isBaseDocumentLine } from '../../../utils/documentUom';
import TaxCodeLookup from '../../../components/TaxCodeLookup';

import { BASE_MATRIX_COLUMNS, GRPO_LINE_UDF_FIELD_MAP } from '../../../config/grpoForm';
import { getLineTotalsForDisplay } from '../../../utils/lineTotals';
import { useSapItemCodeTab } from '../../../utils/sapTabNavigation';
import { normalizeUdfLookupKey } from '../grpoLineUdfMapping';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';
import { getReadableDocumentLineColumnWidth } from '../../../utils/documentLineColumnWidth';
import useDocumentTableClipboard from '../../../components/sales-document/useDocumentTableClipboard';

const normalizeFieldIdentity = (field = {}) =>
  [
    field.key,
    field.sapField,
    field.aliasId,
    field.label,
    field.description,
    field.Descr,
  ].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '');

const isSellerBrokerageAmtPerField = (field) => {
  const identity = normalizeFieldIdentity(field);
  return identity.includes('sellerbrokerageamtper') ||
    identity.includes('sellerbrokerageamountper') ||
    identity.includes('selbrokap');
};

const isDocumentCreatedField = (field) => {
  const identity = normalizeFieldIdentity(field);
  return identity.includes('documentcreated');
};

const isSapPairDropdownField = (field) =>
  isSellerBrokerageAmtPerField(field) || isDocumentCreatedField(field);

const NUMERIC_FIELDS = new Set([
  'quantity',
  'unitPrice',
  'grossWt',
  'totalPackage',
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

const INDEX_COL_WIDTH = 42;
const ACTION_COL_WIDTH = 48;
const BASE_MATRIX_COLUMN_BY_KEY = new Map(BASE_MATRIX_COLUMNS.map((column) => [column.key, column]));

const asArray = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean);
const getColumnWidth = (column = {}) => getReadableDocumentLineColumnWidth(
  column,
  {
    ...(BASE_MATRIX_COLUMN_BY_KEY.get(column.rendererKey || column.valueKey || column.key) || {}),
    ...(column.field || {}),
  },
);

const getUdfFieldForColumn = (column, rowUdfFieldMap, rowUdfTokenMap) => {
  const udfKeys = asArray(column.udfKey || GRPO_LINE_UDF_FIELD_MAP[column.key]);
  for (const udfKey of udfKeys) {
    const field = rowUdfFieldMap.get(udfKey) || rowUdfTokenMap.get(normalizeUdfLookupKey(udfKey));
    if (field) return field;
  }
  return null;
};

const isLiveUdfColumn = (column = {}) => (
  Boolean(column.isUdf)
  || String(column.key || '').trim().toUpperCase().startsWith('U_')
  || String(column.sapField || '').trim().toUpperCase().startsWith('U_')
);

const getSapPairDropdownOptions = (field) => {
  const options = Array.isArray(field.options) ? field.options : [];
  if (options.length) return options;

  if (isSellerBrokerageAmtPerField(field)) {
    return [
      { value: 'Amount', label: 'Amount' },
      { value: 'Percentage', label: 'Percentage' },
    ];
  }

  if (isDocumentCreatedField(field)) {
    return [
      { value: 'N', label: 'No' },
      { value: 'Y', label: 'Yes' },
    ];
  }

  return options;
};

const normalizeSapPairDropdownOption = (field, option) => {
  const normalizedOption = typeof option === 'object'
    ? { value: option.value ?? '', label: option.label ?? option.value ?? '' }
    : { value: option, label: option };
  const value = String(normalizedOption.value ?? '');
  let label = String(normalizedOption.label ?? value);

  if (isDocumentCreatedField(field)) {
    const normalizedValue = value.trim().toUpperCase();
    if (normalizedValue === 'N') label = 'No';
    if (normalizedValue === 'Y') label = 'Yes';
  }

  if (isSellerBrokerageAmtPerField(field)) {
    const normalizedText = `${value} ${label}`.toLowerCase();
    if (normalizedText.includes('amount')) label = 'Amount';
    if (normalizedText.includes('percentage')) label = 'Percentage';
  }

  return {
    value,
    label: isSapPairDropdownField(field) ? `${value} - ${label}` : label,
  };
};

function EditableContentsTab({
  lines,
  onLineChange,
  onNumBlur,
  onAddLine,
  onRemoveLine,
  onOpenBatchModal,
  onOpenItemModal,
  onOpenHSNModal,
  lineItemOptions,
  taxCodeOptions,
  warehouseOptions,
  uomOptions,
  formatTaxLabel,
  valErrors,
  visibleColumns,
  visibleRowUdfs,
  onRowUdfChange,
  formSettings,
  canPasteTable = false,
  onPasteTable,
  onClipboardFeedback,
}) {
  const sapItemTab = useSapItemCodeTab({ lineItemOptions, onLineChange, onOpenItemModal });
  const rowUdfFieldMap = React.useMemo(
    () => new Map((visibleRowUdfs || []).filter((field) => field?.key).map((field) => [field.key, field])),
    [visibleRowUdfs]
  );
  const rowUdfTokenMap = React.useMemo(
    () => new Map(
      (visibleRowUdfs || [])
        .filter((field) => field?.key)
        .map((field) => [normalizeUdfLookupKey(field.key), field])
    ),
    [visibleRowUdfs]
  );
  const liveColumns = (Array.isArray(visibleColumns) ? visibleColumns : [])
    .map((column) => {
      const field = isLiveUdfColumn(column)
        ? (column.field
          || rowUdfFieldMap.get(column.key)
          || rowUdfTokenMap.get(normalizeUdfLookupKey(column.key)))
        : getUdfFieldForColumn(column, rowUdfFieldMap, rowUdfTokenMap);
      return isLiveUdfColumn(column) ? { ...column, field } : column;
    })
    // A stale layout UDF must never render unless the current company schema
    // supplied the matching row-UDF definition. Visibility itself is decided
    // only by the resolved Form Settings below: the imported SAP layout flag on
    // the column is the default those settings override, so re-checking it here
    // hid columns a company Form Settings layout had explicitly published.
    .filter((column) => !isLiveUdfColumn(column) || Boolean(column.field));
  const displayColumns = getOrderedVisibleMatrixColumns(liveColumns, formSettings);
  const clipboardColumns = React.useMemo(() => displayColumns.map((column) => {
    const field = column.field || getUdfFieldForColumn(column, rowUdfFieldMap, rowUdfTokenMap);
    const setting = formSettings.matrixColumns?.[column.key]
      || (field?.key ? formSettings.rowUdfs?.[field.key] : null)
      || {};
    return {
      key: column.valueKey || column.rendererKey || column.key,
      label: column.label || column.key,
      isUdf: isLiveUdfColumn(column),
      readOnly: Boolean(column.readOnly || field?.readOnly || setting.active === false),
    };
  }), [displayColumns, formSettings, rowUdfFieldMap, rowUdfTokenMap]);
  const { tableClipboardProps, tableClipboardUi } = useDocumentTableClipboard({
    columns: clipboardColumns,
    rows: lines,
    columnOffset: 1,
    canPaste: canPasteTable,
    onPaste: onPasteTable,
    onFeedback: onClipboardFeedback,
  });
  const tableMinWidth = INDEX_COL_WIDTH + ACTION_COL_WIDTH + displayColumns.reduce(
    (total, col) => total + getColumnWidth(col),
    0
  );

  const renderMappedInput = (line, index, col, isActive) => {
    const field = getUdfFieldForColumn(col, rowUdfFieldMap, rowUdfTokenMap);
    const disabled = !isActive || field?.active === false || field?.readOnly;
    const optionsList = field?.options || [];

    if (field?.lookupSource) {
      return <LiveUdfValueInput field={field} line={line} value={line[col.key] || ''} disabled={disabled} onChange={(nextValue) => onLineChange(index, { target: { name: col.key, value: nextValue } })} />;
    }

    if (field?.type === 'select' || optionsList.length > 0 || isSapPairDropdownField(field || col)) {
      return (
        <select
          className="so-grid__input"
          name={col.key}
          value={line[col.key] || ''}
          disabled={disabled}
          onChange={e => onLineChange(index, e)}
        >
          <option value=""></option>
          {getSapPairDropdownOptions(field || col).map((option) => {
            const normalizedOption = normalizeSapPairDropdownOption(field || col, option);
            return (
              <option key={normalizedOption.value} value={normalizedOption.value}>
                {normalizedOption.label}
              </option>
            );
          })}
          {line[col.key] && !getSapPairDropdownOptions(field || col).some((option) => {
            const normalizedOption = normalizeSapPairDropdownOption(field || col, option);
            return String(normalizedOption.value) === String(line[col.key]);
          }) && (
            <option value={line[col.key]}>{line[col.key]}</option>
          )}
        </select>
      );
    }

    return (
      <SapInput
        className="so-grid__input"
        type={field?.type === 'date' ? 'date' : NUMERIC_FIELDS.has(col.key) || field?.type === 'number' ? 'number' : 'text'}
        name={col.key}
        value={line[col.key] || ''}
        disabled={disabled}
        onChange={e => onLineChange(index, e)}
        onBlur={() => onNumBlur && onNumBlur(col.key, 'line', index)}
      />
    );
  };

  const renderLiveUdfInput = (line, index, col, isActive) => {
    const field = col.field;
    const disabled = !isActive || field.active === false || field.readOnly === true;
    const value = line.udf?.[field.key] ?? '';
    const updateValue = (nextValue) => onRowUdfChange && onRowUdfChange(index, field.key, nextValue);

    if (field.lookupSource) {
      return <LiveUdfValueInput field={field} line={line} value={value} disabled={disabled} onChange={updateValue} />;
    }

    if (field.type === 'select' || (field.options || []).length || isSapPairDropdownField(field)) {
      return (
        <select
          className="so-grid__input"
          value={value}
          disabled={disabled}
          onChange={(event) => updateValue(event.target.value)}
        >
          <option value=""></option>
          {getSapPairDropdownOptions(field).map((option) => {
            const normalized = normalizeSapPairDropdownOption(field, option);
            return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>;
          })}
        </select>
      );
    }

    if (field.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value).trim().toUpperCase())}
          disabled={disabled}
          onChange={(event) => updateValue(event.target.checked ? 'Y' : 'N')}
        />
      );
    }

    return (
      <SapInput
        className="so-grid__input"
        type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
        value={value}
        disabled={disabled}
        onChange={(event) => updateValue(event.target.value)}
      />
    );
  };

  const renderBatchCell = (line, index, isActive) => {
    const lineErrors = valErrors.lines[index] || {};
    const hasItem = Boolean(String(line.itemNo || '').trim());
    const hasWarehouse = Boolean(String(line.whse || '').trim());
    const hasQty = Number(line.quantity || 0) > 0;
    const canOpenBatch = Boolean(isActive && line.batchManaged && hasItem && hasWarehouse && hasQty);
    const buttonTitle = !hasItem
      ? 'Select Item first'
      : !hasWarehouse
        ? 'Select Warehouse first'
        : !hasQty
          ? 'Enter quantity'
          : 'Assign batches';

    if (!line.batchManaged) {
      return <span className="so-grid__cell--muted" style={{ fontSize: 11 }}>Not Batch Item</span>;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
        <button
          type="button"
          className="del-btn"
          style={{ fontSize: 11, padding: '2px 8px', minWidth: 92 }}
          onClick={() => onOpenBatchModal && onOpenBatchModal(index)}
          disabled={!canOpenBatch}
          title={buttonTitle}
        >
          {line.batches?.length ? `${line.batches.length} Assigned` : 'Assign Batch'}
        </button>
        {lineErrors.batches ? (
          <span style={{ color: '#d9534f', fontSize: 11, lineHeight: 1.2, textAlign: 'center' }}>
            {lineErrors.batches}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="so-section-title">Item Matrix</div>
        <button type="button" className="so-btn so-btn--primary" onClick={onAddLine}>+ Add Line</button>
      </div>
      <div className="so-grid-wrap so-grid-wrap--contents">
        <div className="so-grid-wrap__scroller so-grid-wrap__scroller--contents">
        <table {...tableClipboardProps} className="so-grid so-grid--contents" style={{ width: 'max-content', minWidth: tableMinWidth, tableLayout: 'auto' }}>
          <colgroup>
            <col style={{ width: INDEX_COL_WIDTH }} />
            {displayColumns.map((col) => (
              <col key={col.key} style={{ width: getColumnWidth(col) }} />
            ))}
            <col style={{ width: ACTION_COL_WIDTH }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ width: INDEX_COL_WIDTH }}>#</th>
              {displayColumns.map(col => (
                <th key={col.key} style={{ minWidth: getColumnWidth(col) }}>
                  {col.label}
                </th>
              ))}
              <th style={{ width: ACTION_COL_WIDTH }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const lineTotals = getLineTotalsForDisplay(line, taxCodeOptions);
              return (
              <tr key={index}>
                <td className="so-grid__cell--muted" style={{ textAlign: 'center', fontSize: 11 }}>{index + 1}</td>

                {displayColumns.map(col => {
                  const isActive = formSettings.matrixColumns[col.key]?.active !== false;
                  const isTotal = col.key === 'total' || col.key === 'totalBeforeTax';

                  if (isLiveUdfColumn(col) && col.field) return (
                    <td key={col.key}>
                      {renderLiveUdfInput(
                        line,
                        index,
                        col,
                        (formSettings.matrixColumns?.[col.key] || formSettings.rowUdfs?.[col.field.key] || {}).active !== false
                      )}
                    </td>
                  );

                  if (col.key === 'itemNo') return (
                    <td key={col.key}>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <SapLookupTextInput
                          className="so-grid__input"
                          style={{ flex: 1, textAlign: 'left', border: valErrors.lines[index]?.itemNo ? '1px solid #c00' : undefined }}
                          name="itemNo" value={line.itemNo || ''} disabled={!isActive}
                          data-sap-lookup="item"
                          data-sap-row-index={index}
                          onKeyDown={(e) => sapItemTab.handleItemCodeTab(e, index)}
                          onChange={e => onLineChange(index, e)}
                          placeholder="Item Code"
                        />
                        {isActive && (
                          <button type="button" onClick={() => onOpenItemModal && onOpenItemModal(index)}
                            style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                            title="Select Item">...</button>
                        )}
                      </div>
                      {valErrors.lines[index]?.itemNo && <div className="po-error-feedback">{valErrors.lines[index].itemNo}</div>}
                    </td>
                  );

                  if (col.key === 'hsnCode') return (
                    <td key={col.key}>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <input
                          className="so-grid__input"
                          style={{ flex: '1 1 0', minWidth: 96, border: valErrors.lines[index]?.hsnCode ? '1px solid #c00' : undefined }}
                          name="hsnCode" value={line.hsnCode || ''} disabled={!isActive}
                          onChange={e => onLineChange(index, e)}
                          placeholder="HSN/SAC"
                        />
                        {isActive && (
                          <button type="button" onClick={() => onOpenHSNModal && onOpenHSNModal(index)}
                            style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                            title="Select HSN Code">...</button>
                        )}
                      </div>
                      {valErrors.lines[index]?.hsnCode && <div className="po-error-feedback">{valErrors.lines[index].hsnCode}</div>}
                    </td>
                  );

                  if (col.key === 'taxCode') return (
                    <td key={col.key}>
                      <TaxCodeLookup
                        className="so-grid__input"
                        style={{ width: '100%', textAlign: 'left', border: valErrors.lines[index]?.taxCode ? '1px solid #c00' : undefined }}
                        name="taxCode" value={line.taxCode || ''} disabled={!isActive}
                        onChange={e => onLineChange(index, e)}
                        taxCodes={taxCodeOptions}
                        error={Boolean(valErrors.lines[index]?.taxCode)}
                      />
                      {valErrors.lines[index]?.taxCode && <div className="po-error-feedback">{valErrors.lines[index].taxCode}</div>}
                    </td>
                  );

                  if (col.key === 'whse') return (
                    <td key={col.key}>
                      <select
                        className="so-grid__input"
                        style={{ width: '100%', textAlign: 'left', border: valErrors.lines[index]?.whse ? '1px solid #c00' : undefined }}
                        name="whse" value={line.whse || ''} disabled={!isActive}
                        onChange={e => onLineChange(index, e)}
                      >
                        <option value="">Select</option>
                        {warehouseOptions.map(w => <option key={w.WhsCode} value={w.WhsCode}>{w.WhsCode}</option>)}
                        {line.whse && !warehouseOptions.some(w => String(w.WhsCode) === String(line.whse)) && (
                          <option value={line.whse}>{line.whse}</option>
                        )}
                      </select>
                      {valErrors.lines[index]?.whse && <div className="po-error-feedback">{valErrors.lines[index].whse}</div>}
                    </td>
                  );

                  if (col.key === 'uomCode') return (
                    <td key={col.key}>
                      <select
                        className="so-grid__input"
                        style={{ width: '100%', textAlign: 'left', border: valErrors.lines[index]?.uomCode ? '1px solid #c00' : undefined }}
                        name="uomCode" value={line.uomCode || ''}
                        disabled={!isActive || isBaseDocumentLine(line) || Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL'}
                        onChange={e => onLineChange(index, e)}
                      >
                        <option value="">Select</option>
                        {uomOptions[index]?.map(uom => <option key={uom} value={uom}>{uom}</option>)}
                        {line.uomCode && !(uomOptions[index] || []).some(uom => String(uom) === String(line.uomCode)) && (
                          <option value={line.uomCode}>{line.uomCode}</option>
                        )}
                      </select>
                      {valErrors.lines[index]?.uomCode && <div className="po-error-feedback">{valErrors.lines[index].uomCode}</div>}
                    </td>
                  );

                  if (col.key === 'uomName') return (
                    <td key={col.key}>
                      <input
                        className="so-grid__input"
                        name="uomName"
                        value={line.uomNameEdited ? (line.uomName ?? '') : (line.uomName || line.uomCode || '')}
                        disabled={!isActive || isBaseDocumentLine(line) || !(Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL')}
                        onChange={(e) => onLineChange(index, e)}
                      />
                    </td>
                  );

                  if (col.key === 'binLocationAllocation') return (
                    <td key={col.key}>
                      {renderBatchCell(line, index, isActive)}
                    </td>
                  );

                  if (col.key === 'openQty') return (
                    <td key={col.key}>
                      <input
                        className="so-grid__input"
                        name="openQty"
                        value={line.openQty || ''}
                        readOnly
                        disabled
                        style={{ background: '#f5f8fc' }}
                      />
                    </td>
                  );

                  if (col.key === 'totalBeforeTax') return (
                    <td key={col.key}>
                      <input
                        className="so-grid__input"
                        value={lineTotals.beforeTax}
                        readOnly
                        disabled
                        style={{ background: '#f5f8fc' }}
                      />
                    </td>
                  );

                  if (col.key === 'total') return (
                    <td key={col.key}>
                      <input
                        className="so-grid__input"
                        value={lineTotals.total}
                        readOnly
                        disabled
                        style={{ background: '#f5f8fc' }}
                      />
                    </td>
                  );

                  if (GRPO_LINE_UDF_FIELD_MAP[col.key] || col.udfKey) return (
                    <td key={col.key}>
                      {renderMappedInput(line, index, col, isActive)}
                      {valErrors.lines[index]?.[col.key] && <div className="po-error-feedback">{valErrors.lines[index][col.key]}</div>}
                    </td>
                  );

                  return (
                    <td key={col.key}>
                      <SapInput
                        className="so-grid__input"
                        type={NUMERIC_FIELDS.has(col.key) ? 'number' : 'text'}
                        style={{ border: valErrors.lines[index]?.[col.key] ? '1px solid #c00' : undefined, background: isTotal ? '#f5f8fc' : undefined }}
                        name={col.key} value={line[col.key] || ''}
                        disabled={!isActive || isTotal}
                        onChange={e => onLineChange(index, e)}
                        onBlur={() => onNumBlur && onNumBlur(col.key, 'line', index)}
                      />
                      {valErrors.lines[index]?.[col.key] && <div className="po-error-feedback">{valErrors.lines[index][col.key]}</div>}
                    </td>
                  );
                })}

                <td>
                  <button type="button" className="so-btn so-btn--danger" style={{ padding: '2px 8px', fontSize: 14 }} onClick={() => onRemoveLine(index)}>x</button>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
        {tableClipboardUi}
      </div>
      </div>
    </>
  );
}

export default function ContentsTab(props) {
  return <EditableContentsTab {...props} />;
}
