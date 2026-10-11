import SapLookupTextInput from '../../../components/common/SapLookupTextInput';
import SapInput from '../../../components/common/SapInput';
import React from 'react';
import { isBaseDocumentLine } from '../../../utils/documentUom';
import DocumentLineSettingsLoading from '../../../components/sales-document/DocumentLineSettingsLoading';
import TaxCodeLookup from '../../../components/TaxCodeLookup';
import LineValueLookupModal from '../../../components/sales-document/LineValueLookupModal';
import { useSapItemCodeTab } from '../../../utils/sapTabNavigation';
import { getLineTotalsForDisplay } from '../../../utils/lineTotals';
import { getSapStandardSalesMatrixColumns } from '../../sales-order/documentLayout';
import { normalizeDeliveryMatrixColumn } from '../deliveryLiveMatrix';
import { getReadableDocumentLineColumnWidth } from '../../../utils/documentLineColumnWidth';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';
import useDocumentTableClipboard from '../../../components/sales-document/useDocumentTableClipboard';
import { resolveLocationDisplayName } from '../../../utils/locationLookup';

const LINE_NUMBER_COLUMN_KEY = '__lineNumber';
const INDEX_COLUMN_WIDTH = 42;

const MATRIX_COLS = getSapStandardSalesMatrixColumns();
const DELIVERY_SPECIALIZED_LOOKUP_RENDERERS = new Set([
  'itemNo',
  'taxCode',
  'whse',
  'distRule',
  'uomCode',
  'hsnCode',
]);

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

const getLineFieldValue = (line = {}, key = '') => {
  if (key === 'itemNo') {
    return line.itemNo || line.ItemCode || line.itemCode || '';
  }
  if (key === 'itemDescription') {
    return line.itemDescription || line.ItemDescription || line.Dscription || line.description || line.itemName || '';
  }
  return line[key] || '';
};

const compactColumnToken = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

const getColumnValueKey = (column = {}) => column.valueKey || column.rendererKey || column.key || '';

const getUdfToken = (value) => String(value || '').trim().toUpperCase().replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');

const getLineUdfValue = (line = {}, key = '') => {
  const udfValues = line.udf || {};
  if (Object.prototype.hasOwnProperty.call(udfValues, key)) return udfValues[key];

  const token = getUdfToken(key);
  if (!token) return undefined;

  const match = Object.entries(udfValues).find(([udfKey]) => getUdfToken(udfKey) === token);
  return match ? match[1] : undefined;
};

const dedupeColumns = (columns = []) => {
  const seen = new Set();
  return columns.filter((column) => {
    if (!column?.key) return false;
    const identity = compactColumnToken(column.key || column.label || getColumnValueKey(column));
    if (!identity) return false;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const getPriceAfterDiscount = (line = {}) => {
  const unitPrice = parseNumber(line.unitPrice);
  const discountPercent = parseNumber(line.stdDiscount);
  if (!unitPrice) return '';
  return (unitPrice * (1 - (discountPercent / 100))).toFixed(2);
};

const formatSapAmountWithCurrency = (value, currency = '', decimals = 6) => {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const numericValue = Number(value);
  const formattedValue = Number.isFinite(numericValue)
    ? numericValue.toFixed(decimals)
    : String(value);
  const normalizedCurrency = String(currency || '').trim();
  return normalizedCurrency ? `${formattedValue} ${normalizedCurrency}` : formattedValue;
};

const getGenericUdfField = (column = {}) => {
  const key = column.valueKey || column.rendererKey || column.key;
  if (!String(key || '').startsWith('U_')) return null;

  return {
    key,
    label: column.label || key,
    type: column.type || (column.numeric ? 'number' : 'text'),
    options: column.options,
    readOnly: column.readOnly,
  };
};

function ReadyContentsTab({
  lines,
  onLineChange,
  onNumBlur,
  lineItemOptions,
  onAddLine,
  onRemoveLine,
  onOpenBatchModal,
  onOpenHSNModal,
  onOpenItemModal,
  onOpenQualityModal,
  onOpenPaymentTermsModal,
  getUomOptions,
  effectiveTaxCodes,
  effectiveWarehouses,
  fmtTaxLabel,
  getBranchName,
  locations = [],
  valErrors,
  distributionRules = [],
  formSettings = {},
  matrixFields = null,
  rowUdfFields = [],
  onRowUdfChange,
  onLoadLookupOptions,
  currency = '',
  canPasteTable = false,
  onPasteTable,
  onClipboardFeedback,
}) {
  const sapItemTab = useSapItemCodeTab({ lineItemOptions, onLineChange, onOpenItemModal });
  const [dynamicLookup, setDynamicLookup] = React.useState({
    open: false,
    rowIndex: -1,
    column: null,
    options: [],
    loading: false,
    error: '',
  });
  const getTaxAmountDisplay = (line) => {
    if (String(line.taxAmount ?? '').trim()) return line.taxAmount;
    const totals = getLineTotalsForDisplay(line, effectiveTaxCodes);
    if (!totals.beforeTax || !totals.total) return '';
    return (parseNumber(totals.total) - parseNumber(totals.beforeTax)).toFixed(2);
  };

  const hasExplicitMatrixFields = Array.isArray(matrixFields);
  const validMatrixFields = hasExplicitMatrixFields ? matrixFields.filter((field) => field && field.key) : [];
  const safeRowUdfFields = Array.isArray(rowUdfFields) ? rowUdfFields.filter((field) => field && field.key) : [];
  const configuredMatrixFields = hasExplicitMatrixFields ? validMatrixFields : MATRIX_COLS;
  const shouldForceBinAllocationColumn = configuredMatrixFields.length > 0
    && !formSettings?.__companyQueryLayout?.isPublished;
  const configuredWithRequiredDeliveryColumns = shouldForceBinAllocationColumn
    && !configuredMatrixFields.some((field) => field?.key === 'binLocationAllocation')
    ? [
        ...configuredMatrixFields,
        {
          key: 'binLocationAllocation',
          valueKey: 'binLocationAllocation',
          rendererKey: 'binLocationAllocation',
          fieldName: 'BinLocationAllocation',
          label: 'Bin Location Allocation',
          visible: true,
          active: false,
          readOnly: true,
          minWidth: 160,
          width: 160,
          order: Number.MAX_SAFE_INTEGER - 10,
          columnOrder: Number.MAX_SAFE_INTEGER - 10,
          sapControlled: true,
          requiredVisible: true,
        },
      ]
    : configuredMatrixFields;
  const effectiveFormSettings = {
    ...(formSettings || {}),
    matrixColumns: {
      ...(formSettings?.matrixColumns || {}),
      binLocationAllocation: {
        ...(formSettings?.matrixColumns?.binLocationAllocation || {}),
        visible: true,
        active: false,
        requiredVisible: true,
        visibilityLocked: true,
      },
    },
  };
  const sourceMatrixFields = configuredWithRequiredDeliveryColumns.some((field) => field?.key === LINE_NUMBER_COLUMN_KEY)
    ? configuredWithRequiredDeliveryColumns
    : [{
        key: LINE_NUMBER_COLUMN_KEY,
        valueKey: LINE_NUMBER_COLUMN_KEY,
        rendererKey: LINE_NUMBER_COLUMN_KEY,
        fieldName: 'LineNum',
        label: '#',
        visible: true,
        active: false,
        readOnly: true,
        minWidth: INDEX_COLUMN_WIDTH,
        width: INDEX_COLUMN_WIDTH,
        order: -10000,
        sapControlled: true,
      }, ...configuredWithRequiredDeliveryColumns];
  const usesMetadataDrivenMatrix = hasExplicitMatrixFields
    || sourceMatrixFields.some((field) => field?.sapControlled || field?.importedLayout);
  const rowUdfByKey = new Map(safeRowUdfFields.map((field) => [field.key, field]));
  const rowUdfByToken = new Map(safeRowUdfFields.map((field) => [getUdfToken(field.key), field]));
  const baseColumnByKey = new Map(MATRIX_COLS.map((field) => [field.key, field]));
  const isUdfMatrixColumn = (column = {}) => Boolean(
    column.isUdf
    || String(column.key || '').startsWith('U_')
    || String(column.valueKey || '').startsWith('U_')
  );
  const getMatrixColumnSetting = (column = {}) => ({
    visible: column.visible !== false,
    active: column.active !== false,
    ...(
      effectiveFormSettings.matrixColumns?.[column.key]
      || effectiveFormSettings.matrixColumns?.[column.valueKey]
      || (isUdfMatrixColumn(column)
        ? effectiveFormSettings.rowUdfs?.[column.key] || effectiveFormSettings.rowUdfs?.[column.valueKey]
        : undefined)
      || {}
    ),
  });
  const matrixColumns = [
    ...sourceMatrixFields.map((field, index) => {
      const normalizedField = normalizeDeliveryMatrixColumn(field);
      const rendererKey = normalizedField.rendererKey || normalizedField.valueKey || normalizedField.key;
      return {
        ...(baseColumnByKey.get(rendererKey) || {}),
        ...normalizedField,
        key: normalizedField.key,
        rendererKey,
        valueKey: normalizedField.valueKey || rendererKey,
        minWidth: normalizedField.minWidth || normalizedField.width || baseColumnByKey.get(rendererKey)?.minWidth || 125,
        order: Number(normalizedField.order ?? normalizedField.columnOrder ?? index + 1),
        field: normalizedField.isUdf
          ? (
            rowUdfByKey.get(normalizedField.valueKey || normalizedField.key) ||
            rowUdfByKey.get(normalizedField.key) ||
            rowUdfByToken.get(getUdfToken(normalizedField.valueKey || normalizedField.key)) ||
            rowUdfByToken.get(getUdfToken(normalizedField.key)) ||
            normalizedField.field
          )
          : normalizedField.field,
      };
    }),
    ...(usesMetadataDrivenMatrix ? [] : safeRowUdfFields.map((field) => ({
      key: field.key,
      label: field.label || field.key,
      minWidth: field.type === 'textarea' ? 180 : 125,
      isUdf: true,
      field,
    }))),
  ];

  const visibleColumns = getOrderedVisibleMatrixColumns(
    dedupeColumns(matrixColumns),
    effectiveFormSettings,
    { includeStructural: true },
  );
  const clipboardColumns = React.useMemo(() => visibleColumns
    .filter((column) => String(column.key) !== LINE_NUMBER_COLUMN_KEY)
    .map((column) => {
      const setting = getMatrixColumnSetting(column);
      return {
        key: column.valueKey || column.rendererKey || column.key,
        label: column.label || column.key,
        isUdf: isUdfMatrixColumn(column),
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
  // Ensure actions column is always present as the trailing column
  const visibleColumnsWithActions = [
    ...visibleColumns,
    { key: '__actions', label: '', minWidth: 48, order: Number.MAX_SAFE_INTEGER },
  ];
  const getColumnWidth = (column = {}) => {
    if (String(column.key || '') === '__actions') {
      return Number(column.minWidth || column.width) || 48;
    }
    const rendererKey = column.rendererKey || column.valueKey || column.key;
    return getReadableDocumentLineColumnWidth(
      column,
      baseColumnByKey.get(rendererKey) || {},
      {
        lineNumberKey: LINE_NUMBER_COLUMN_KEY,
        lineNumberWidth: INDEX_COLUMN_WIDTH,
      },
    );
  };
  const tableWidth = visibleColumnsWithActions.reduce(
    (total, column) => total + getColumnWidth(column),
    0
  );
  const isBatchColumn = (column = {}) => ['BATCH', 'BATCHES'].includes(compactColumnToken(
    column.rendererKey || column.valueKey || column.key || column.label
  ));
  const hasBatchColumn = visibleColumns.some(isBatchColumn);

  const openDynamicLookup = async (rowIndex, column, line) => {
    const source = column.lookupSource
      || column.lookup?.source
      || column.field?.lookupSource
      || column.field?.lookup?.source;
    if (!source || typeof onLoadLookupOptions !== 'function') return;

    setDynamicLookup({
      open: true,
      rowIndex,
      column,
      options: [],
      loading: true,
      error: '',
    });
    try {
      const options = await onLoadLookupOptions(source, column, line);
      setDynamicLookup({
        open: true,
        rowIndex,
        column,
        options: Array.isArray(options) ? options : [],
        loading: false,
        error: '',
      });
    } catch (error) {
      setDynamicLookup({
        open: true,
        rowIndex,
        column,
        options: [],
        loading: false,
        error: error?.response?.data?.detail || error?.message || 'Failed to load lookup values.',
      });
    }
  };

  const selectDynamicLookupValue = (option) => {
    const column = dynamicLookup.column;
    if (!column || dynamicLookup.rowIndex < 0) return;
    const valueKey = getColumnValueKey(column);
    const isUdfColumn = Boolean(column.isUdf || String(column.field?.key || valueKey).startsWith('U_'));
    if (isUdfColumn) {
      onRowUdfChange && onRowUdfChange(
        dynamicLookup.rowIndex,
        column.field?.key || valueKey,
        option?.value || ''
      );
    } else {
      onLineChange(dynamicLookup.rowIndex, {
        target: { name: valueKey, value: option?.value || '' },
      });
    }
    setDynamicLookup((previous) => ({ ...previous, open: false }));
  };

  const isColumnVisible = (columnKey) => {
    const column = matrixColumns.find((candidate) => candidate.key === columnKey);
    return column ? getMatrixColumnSetting(column).visible !== false : false;
  };

  const renderBatchCell = (line, i) => {
    const lineErrors = valErrors.lines[i] || {};
    const hasItem = !!line.itemNo;
    const hasWarehouse = !!line.whse;
    const hasQty = !!line.quantity && parseFloat(line.quantity) > 0;
    const needsAllocation = line.batchManaged || line.serialManaged || line.binManaged;
    const canOpenBatch = needsAllocation && hasItem && hasWarehouse && hasQty
      && (!line.batchManaged || line.hasBatchesAvailable !== false);
    const buttonTitle = !hasItem
      ? 'Select Item first'
      : !hasWarehouse
        ? 'Select Warehouse first'
        : !hasQty
          ? 'Enter quantity'
            : line.batchManaged && line.hasBatchesAvailable === false
            ? 'No batches available'
            : 'Assign batches';

    if (!needsAllocation) {
      return <span style={{ color: '#888', fontSize: 11 }}>No Allocation</span>;
    }

    if (line.batchManaged && line.hasBatchesAvailable === false) {
      return <span style={{ color: '#888', fontSize: 11 }}>No Batches Available</span>;
    }

    if (!hasItem || !hasWarehouse || !hasQty) {
      return (
        <button
          type="button"
          className="del-btn"
          disabled
          style={{ fontSize: 11, padding: '2px 8px', opacity: 0.6, cursor: 'not-allowed' }}
          title={buttonTitle}
        >
          Assign Inventory
        </button>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button
          type="button"
          className="del-btn"
          style={{ fontSize: 11, padding: '2px 8px' }}
          onClick={() => onOpenBatchModal(i)}
          disabled={!canOpenBatch}
          title={buttonTitle}
        >
          {(line.batches?.length || line.serialNumbers?.length || line.binAllocations?.length)
            ? `${(line.batches?.length || 0) + (line.serialNumbers?.length || 0) + (line.binAllocations?.length || 0)} Assigned`
            : line.serialManaged ? 'Assign Serials' : line.binManaged ? 'Assign Bins' : 'Assign Batch'}
        </button>
        {lineErrors.batches ? (
          <span style={{ color: '#d9534f', fontSize: 11, lineHeight: 1.2 }}>
            {lineErrors.batches}
          </span>
        ) : null}
      </div>
    );
  };

  const renderCell = (column, line, i, uomOpts, lineTotals) => {
    const columnKey = typeof column === 'object' ? column.key : column;
    const rendererKey = typeof column === 'object' ? (column.rendererKey || column.valueKey || column.key) : column;
    const udfColumn = typeof column === 'object' && column.isUdf
      ? (
        column.field ||
        safeRowUdfFields.find((field) => field.key === (column.valueKey || column.key)) ||
        rowUdfByToken.get(getUdfToken(column.valueKey || column.key)) ||
        getGenericUdfField(column)
      )
      : safeRowUdfFields.find((field) => field.key === columnKey);
    const columnObject = typeof column === 'object' ? column : { key: columnKey };
    const columnSetting = getMatrixColumnSetting(columnObject);
    const renderGenericCell = () => {
      const valueKey = getColumnValueKey(columnObject) || columnKey;
      const fieldKey = udfColumn?.key || valueKey;
      const disabled = Boolean(
        columnObject.readOnly ||
        columnObject.active === false ||
        columnSetting.active === false ||
        udfColumn?.readOnly ||
        (!formSettings.matrixColumns?.[columnObject.key]
          && formSettings.rowUdfs?.[fieldKey]?.active === false)
      );
      const rawValue = udfColumn
        ? (getLineUdfValue(line, fieldKey) ?? line[fieldKey] ?? '')
        : (line[valueKey] ?? line[columnKey] ?? '');
      const value = valueKey === 'grossTotal' && String(rawValue ?? '').trim() === ''
        ? lineTotals.total
        : rawValue;
      const fieldType = String(udfColumn?.type || columnObject.type || (columnObject.numeric ? 'number' : 'text')).trim();
      const fieldTypeKind = fieldType.toLowerCase();
      const fieldOptions = Array.isArray(udfColumn?.options) && udfColumn.options.length
        ? udfColumn.options
        : (Array.isArray(columnObject.options) ? columnObject.options : []);
      const lookupSource = columnObject.lookupSource
        || columnObject.lookup?.source
        || udfColumn?.lookupSource
        || udfColumn?.lookup?.source
        || '';
      const lookupColumn = {
        ...columnObject,
        field: udfColumn || columnObject.field,
        lookupSource,
        lookup: columnObject.lookup || udfColumn?.lookup,
        lookupTable: columnObject.lookupTable || udfColumn?.lookupTable,
      };
      const centeredInputStyle = {
        textAlign: 'center',
        textAlignLast: 'center',
        minWidth: 0,
        height: 26,
        lineHeight: '24px',
      };
      const updateValue = (nextValue) => {
        if (disabled) return;
        if (udfColumn) {
          onRowUdfChange && onRowUdfChange(i, fieldKey, nextValue);
          return;
        }
        onLineChange(i, { target: { name: valueKey, value: nextValue } });
      };

      return (
        <td key={columnKey} style={{ verticalAlign: 'middle' }}>
          {fieldTypeKind === 'select' && fieldOptions.length > 0 ? (
            <select
              className="del-grid__input"
              style={centeredInputStyle}
              value={value}
              disabled={disabled}
              onChange={(e) => updateValue(e.target.value)}
            >
              <option value=""></option>
              {fieldOptions.map((option) => {
                const normalizedOption = typeof option === 'object' ? option : { value: option, label: option };
                return (
                  <option key={normalizedOption.value} value={normalizedOption.value}>
                    {normalizedOption.label}
                  </option>
                );
              })}
            </select>
          ) : fieldTypeKind === 'checkbox' ? (
            <input
              type="checkbox"
              checked={['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase())}
              disabled={disabled}
              onChange={(e) => updateValue(e.target.checked ? 'Y' : 'N')}
            />
          ) : ['yesno'].includes(fieldTypeKind) ? (
            <select
              className="del-grid__input"
              style={centeredInputStyle}
              value={value}
              disabled={disabled}
              onChange={(e) => updateValue(e.target.value)}
            >
              <option value=""></option>
              <option value="Y">Yes</option>
              <option value="N">No</option>
            </select>
          ) : lookupSource ? (
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <SapInput
                className="del-grid__input"
                type={fieldTypeKind === 'date' ? 'date' : fieldTypeKind === 'number' ? 'number' : 'text'}
                value={value}
                readOnly={disabled}
                style={disabled ? { background: '#f5f8fc', ...centeredInputStyle } : centeredInputStyle}
                onChange={(e) => updateValue(e.target.value)}
              />
              <button
                type="button"
                onClick={() => openDynamicLookup(i, lookupColumn, line)}
                disabled={disabled}
                style={pickerButtonStyle}
                title={`List of ${columnObject.label || udfColumn?.label || 'Values'}`}
              >
                ...
              </button>
            </div>
          ) : fieldTypeKind === 'textarea' ? (
            <textarea
              className="del-grid__input"
              value={value}
              readOnly={disabled}
              rows={2}
              style={disabled ? { background: '#f5f8fc', ...centeredInputStyle } : centeredInputStyle}
              onChange={(e) => updateValue(e.target.value)}
            />
          ) : (
            <SapInput
              className="del-grid__input"
              type={fieldTypeKind === 'date' ? 'date' : fieldTypeKind === 'number' ? 'number' : 'text'}
              value={value}
              readOnly={disabled}
              style={disabled ? { background: '#f5f8fc', ...centeredInputStyle } : centeredInputStyle}
              onChange={(e) => updateValue(e.target.value)}
            />
          )}
        </td>
      );
    };

    if (udfColumn) return renderGenericCell();
    if (columnObject.lookupConfigured && (columnObject.lookupSource || columnObject.lookup?.source)) {
      return renderGenericCell();
    }
    if (
      columnObject.schemaDriven
      && (columnObject.lookupSource || columnObject.lookup?.source)
      && !DELIVERY_SPECIALIZED_LOOKUP_RENDERERS.has(rendererKey)
    ) {
      return renderGenericCell();
    }

    if (!isColumnVisible(columnKey)) return <td key={columnKey} />;

    const cellRenderers = {
      itemNo: () => (
        <td key="itemNo">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <SapLookupTextInput
              className="del-grid__input"
              style={{ flex: 1, textAlign: 'left', border: valErrors.lines[i]?.itemNo ? '1px solid #c00' : undefined }}
              name="itemNo"
              data-sap-lookup="item"
              data-sap-row-index={i}
              onKeyDown={(e) => sapItemTab.handleItemCodeTab(e, i)}
              value={getLineFieldValue(line, 'itemNo')}
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
            className="del-grid__input"
            name="itemDescription"
            value={getLineFieldValue(line, 'itemDescription')}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerQuality: () => (
        <td key="sellerQuality">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="del-grid__input"
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
              className="del-grid__input"
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
            className="del-grid__input"
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
            className="del-grid__input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
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
      uomCode: () => (
        <td key="uomCode">
          <select
            className="del-grid__input"
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
            className="del-grid__input"
            name="uomName"
            value={line.uomNameEdited ? (line.uomName ?? '') : (line.uomName || line.uomCode || '')}
            onChange={(e) => onLineChange(i, e)}
            disabled={isBaseDocumentLine(line) || !(Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL')}
          />
        </td>
      ),
      sellerPrice: () => (
        <td key="sellerPrice">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="del-grid__input"
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
              className="del-grid__input"
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
            className="del-grid__input"
            name="sellerDelivery"
            value={line.sellerDelivery || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      buyerDelivery: () => (
        <td key="buyerDelivery">
          <input
            className="del-grid__input"
            name="buyerDelivery"
            value={line.buyerDelivery || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerBrokerageAmtPer: () => (
        <td key="sellerBrokerageAmtPer">
          <select
            className="del-grid__input"
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
            className="del-grid__input"
            name="sellerBrokeragePercent"
            value={line.sellerBrokeragePercent || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerBrokerage: () => (
        <td key="sellerBrokerage">
          <input
            className="del-grid__input"
            name="sellerBrokerage"
            value={line.sellerBrokerage || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      buyerBrokerage: () => (
        <td key="buyerBrokerage">
          <input
            className="del-grid__input"
            name="buyerBrokerage"
            value={line.buyerBrokerage || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      deliveredQty: () => (
        <td key="deliveredQty">
          <input
            className="del-grid__input"
            value={line.deliveredQty || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      stdDiscount: () => (
        <td key="stdDiscount">
          <input
            className="del-grid__input"
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
            className="del-grid__input"
            name="stcode"
            value={line.stcode || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      taxCode: () => (
        <td key="taxCode">
          <TaxCodeLookup
            className="del-grid__input"
            style={{ width: '100%', textAlign: 'left', border: valErrors.lines[i]?.taxCode ? '1px solid #c00' : undefined }}
            name="taxCode"
            value={line.taxCode || ''}
            onChange={(e) => onLineChange(i, e)}
            taxCodes={effectiveTaxCodes}
            error={Boolean(valErrors.lines[i]?.taxCode)}
          />
        </td>
      ),
      taxCodeRepeat: () => (
        <td key="taxCodeRepeat">
          <input
            className="del-grid__input"
            value={line.taxCode || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      price: () => (
        <td key="price">
          <input
            className="del-grid__input"
            value={line.price || line.unitPrice || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      priceAfterDiscount: () => (
        <td key="priceAfterDiscount">
          <input
            className="del-grid__input"
            value={line.priceAfterDiscount || getPriceAfterDiscount(line)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      itemCost: () => (
        <td key="itemCost">
          <input
            className="del-grid__input"
            value={formatSapAmountWithCurrency(line.itemCost, currency, 6)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      binLocationAllocation: () => (
        <td key="binLocationAllocation">
          {hasBatchColumn ? (
            <input
              className="del-grid__input"
              value={line.binLocationAllocation || ''}
              readOnly
              style={{ background: '#f5f8fc' }}
            />
          ) : renderBatchCell(line, i)}
        </td>
      ),
      batch: () => (
        <td key="batch">
          {renderBatchCell(line, i)}
        </td>
      ),
      taxAmount: () => (
        <td key="taxAmount">
          <input
            className="del-grid__input"
            value={getTaxAmountDisplay(line)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      totalLC: () => (
        <td key="totalLC">
          <input
            className="del-grid__input"
            value={lineTotals.beforeTax}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      whse: () => (
        <td key="whse">
          <select
            className="del-grid__input"
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
      distRule: () => (
        <td key="distRule">
          <select
            className="del-grid__input"
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
            className="del-grid__input"
            value={line.openQty || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      loc: () => (
        <td key="loc">
          <input
            className="del-grid__input"
            value={resolveLocationDisplayName(line.loc, locations)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      countryOfOrigin: () => (
        <td key="countryOfOrigin">
          <input
            className="del-grid__input"
            name="countryOfOrigin"
            style={{ textTransform: 'uppercase' }}
            value={line.countryOfOrigin || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      branch: () => (
        <td key="branch">
          <input
            className="del-grid__input"
            value={getBranchName ? getBranchName(line.branch) : line.branch || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      hsnCode: () => (
        <td key="hsnCode">
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <input
              className="del-grid__input"
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
      unitPriceRepeat: () => (
        <td key="unitPriceRepeat">
          <input
            className="del-grid__input"
            value={line.unitPrice || ''}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      sacCode: () => (
        <td key="sacCode">
          <input
            className="del-grid__input"
            name="sacCode"
            value={line.sacCode || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      specialRebate: () => (
        <td key="specialRebate">
          <input
            className="del-grid__input"
            name="specialRebate"
            value={line.specialRebate || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      commission: () => (
        <td key="commission">
          <input
            className="del-grid__input"
            name="commission"
            value={line.commission || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerBrokeragePerQty: () => (
        <td key="sellerBrokeragePerQty">
          <input
            className="del-grid__input"
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
              className="del-grid__input"
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
              className="del-grid__input"
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
            className="del-grid__input"
            name="buyerSpecialInstruction"
            value={line.buyerSpecialInstruction || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerSpecialInstruction: () => (
        <td key="sellerSpecialInstruction">
          <input
            className="del-grid__input"
            name="sellerSpecialInstruction"
            value={line.sellerSpecialInstruction || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      buyerBillDiscount: () => (
        <td key="buyerBillDiscount">
          <input
            className="del-grid__input"
            name="buyerBillDiscount"
            value={line.buyerBillDiscount || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerBillDiscount: () => (
        <td key="sellerBillDiscount">
          <input
            className="del-grid__input"
            name="sellerBillDiscount"
            value={line.sellerBillDiscount || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerItem: () => (
        <td key="sellerItem">
          <input
            className="del-grid__input"
            name="sellerItem"
            value={line.sellerItem || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      sellerQty: () => (
        <td key="sellerQty">
          <input
            className="del-grid__input"
            name="sellerQty"
            value={line.sellerQty || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      freightPurchase: () => (
        <td key="freightPurchase">
          <input
            className="del-grid__input"
            name="freightPurchase"
            value={line.freightPurchase || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      freightSales: () => (
        <td key="freightSales">
          <input
            className="del-grid__input"
            name="freightSales"
            value={line.freightSales || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      freightProvider: () => (
        <td key="freightProvider">
          <input
            className="del-grid__input"
            name="freightProvider"
            value={line.freightProvider || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      freightProviderName: () => (
        <td key="freightProviderName">
          <input
            className="del-grid__input"
            name="freightProviderName"
            value={line.freightProviderName || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
      documentCreated: () => (
        <td key="documentCreated">
          <input
            className="del-grid__input"
            value={formatDateDisplay(line.documentCreated)}
            readOnly
            style={{ background: '#f5f8fc' }}
          />
        </td>
      ),
      brokerageNumber: () => (
        <td key="brokerageNumber">
          <input
            className="del-grid__input"
            name="brokerageNumber"
            value={line.brokerageNumber || ''}
            onChange={(e) => onLineChange(i, e)}
          />
        </td>
      ),
    };

    const renderedCell = cellRenderers[rendererKey] ? cellRenderers[rendererKey]() : renderGenericCell();
    const disableSpecializedCell = Boolean(columnObject.readOnly || columnSetting.active === false);
    return React.cloneElement(
      renderedCell,
      { key: columnKey },
      disableSpecializedCell ? (
        <fieldset className="del-grid__disabled-fieldset" disabled>
          {renderedCell.props.children}
        </fieldset>
      ) : renderedCell.props.children
    );
  };

  return (
    <>
    <div className="sap-tab-panel del-tab-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="del-section-title">Document Lines</div>
        <button type="button" className="del-btn del-btn--primary" onClick={onAddLine}>
          + Add Line
        </button>
      </div>

      <div 
        className="del-grid-wrap del-grid-wrap--contents"
        style={{ border: '1px solid #d7dde5' }}
      >
        <div 
          className="del-grid-wrap__scroller del-grid-wrap__scroller--contents"
          style={{
            overflowX: 'auto',
            overflowY: 'auto',
            maxHeight: '400px'
          }}
        >
          <table
            {...tableClipboardProps}
            className="del-grid del-grid--contents"
            style={{
              width: tableWidth,
              minWidth: '100%',
              tableLayout: 'fixed'
            }}
          >
            <colgroup>
              {visibleColumnsWithActions.map((column) => (
                <col key={column.key} style={{ width: getColumnWidth(column) }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {visibleColumnsWithActions.map((column) => (
                  <th key={column.key} style={{ width: getColumnWidth(column) }}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const uomOpts = getUomOptions(line);
                const lineTotals = getLineTotalsForDisplay(line, effectiveTaxCodes);

                return (
                  <tr key={i}>
                    {visibleColumnsWithActions.map((col) => {
                      if (String(col.key) === LINE_NUMBER_COLUMN_KEY) {
                        return (
                          <td
                            key={LINE_NUMBER_COLUMN_KEY}
                            className="del-grid__cell--muted"
                            style={{ textAlign: 'center', fontSize: 11 }}
                          >
                            {i + 1}
                          </td>
                        );
                      }
                      if (String(col.key) === '__actions') {
                        return (
                          <td key="__actions">
                            <button
                              type="button"
                              className="del-btn del-btn--danger"
                              style={{ padding: '2px 8px', fontSize: 14 }}
                              onClick={() => onRemoveLine(i)}
                            >
                              x
                            </button>
                          </td>
                        );
                      }

                      return renderCell(col, line, i, uomOpts, lineTotals);
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {tableClipboardUi}
        </div>
      </div>
    </div>
    <LineValueLookupModal
      isOpen={dynamicLookup.open}
      onClose={() => setDynamicLookup((previous) => ({ ...previous, open: false }))}
      onSelect={selectDynamicLookupValue}
      options={dynamicLookup.options}
      title={`List of ${dynamicLookup.column?.label || 'Values'}`}
      searchPlaceholder="Search values"
      emptyMessage={dynamicLookup.loading
        ? 'Loading values...'
        : (dynamicLookup.error || 'No values found')}
      allowCreate={false}
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
