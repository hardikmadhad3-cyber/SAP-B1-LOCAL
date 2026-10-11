import SapLookupTextInput from '../../../components/common/SapLookupTextInput';
import SapInput from '../../../components/common/SapInput';
import LiveUdfValueInput from '../../../components/sales-document/LiveUdfValueInput';
import React from 'react';
import TaxCodeLookup from '../../../components/TaxCodeLookup';
import { useSapItemCodeTab } from '../../../utils/sapTabNavigation';
import { getLineTotalsForDisplay } from '../../../utils/lineTotals';
import { resolveLocationDisplayName } from '../../../utils/locationLookup';
import { getOrderedVisibleMatrixColumns } from '../../../utils/formSettingsColumns';
import { getReadableDocumentLineColumnWidth } from '../../../utils/documentLineColumnWidth';
import { isBaseDocumentLine } from '../../../utils/documentUom';
import useDocumentTableClipboard from '../../../components/sales-document/useDocumentTableClipboard';

const FALLBACK_MATRIX_COLS = [
  { key: 'itemNo', label: 'Item No.', minWidth: 160 },
  { key: 'itemDescription', label: 'Item Description', minWidth: 240 },
  { key: 'quantity', label: 'Quantity', minWidth: 90 },
  { key: 'uomCode', label: 'UoM Code', minWidth: 105 },
  { key: 'uomName', label: 'UoM Name', minWidth: 120 },
  { key: 'unitPrice', label: 'Unit Price', minWidth: 110 },
  { key: 'stdDiscount', label: 'Discount %', minWidth: 95 },
  { key: 'taxCode', label: 'Tax Code', minWidth: 120 },
  { key: 'total', label: 'Total (LC)', minWidth: 120 },
  { key: 'whse', label: 'Whse', minWidth: 95 },
];

const INDEX_COL_WIDTH = 42;
const ACTION_COL_WIDTH = 128;
const FALLBACK_MATRIX_COLUMN_BY_KEY = new Map(FALLBACK_MATRIX_COLS.map((column) => [column.key, column]));

const getColumnWidth = (column = {}) => getReadableDocumentLineColumnWidth(
  column,
  {
    ...(FALLBACK_MATRIX_COLUMN_BY_KEY.get(column.rendererKey || column.valueKey || column.key) || {}),
    ...(column.field || column.udfField || {}),
  },
);

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

const DIRECT_LINE_FIELDS = new Set([
  'itemNo',
  'itemDescription',
  'hsnCode',
  'sac',
  'sacCode',
  'quantity',
  'unitPrice',
  'stdDiscount',
  'rate',
  'taxCode',
  'wtaxLiable',
  'grossPriceAfterDisc',
  'total',
  'binLocationAllocation',
  'whse',
  'glAccount',
  'itemCost',
  'distRule',
  'priceSource',
  'taxAmountLC',
  'uomCode',
  'uomName',
  'countryOfOrigin',
  'loc',
  'withoutQtyPosting',
  'blanketAgreementNo',
  'costSheet',
  'packingType',
  'containerType',
  'grossWt',
  'totalPackage',
  'taxCodeRepeat',
  'price',
  'sellerBrokerage',
  'buyerBrokerage',
  'buyerDelivery',
  'sellerDelivery',
  'buyerPaymentTerms',
  'sellerPaymentTerms',
  'buyerQuality',
  'sellerQuality',
  'buyerPrice',
  'sellerPrice',
  'buyerSpecialInstruction',
  'sellerSpecialInstruction',
  'sellerBrokerageAmtPer',
  'sellerBrokeragePercent',
  'stcode',
  'sellerItem',
  'sellerQty',
  'specialRebate',
  'commission',
  'sellerBrokeragePerQty',
  'fixBrokBuyer',
  'fixBrockSeller',
  'sellerTermsOfPaymentRepeat',
]);

const NUMERIC_LINE_FIELDS = new Set([
  'quantity',
  'unitPrice',
  'stdDiscount',
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
  'sellerBrokerageAmountPer',
  'sellerBrokeragePercentage',
  'sellerQuantity',
  'brokPerQty',
  'commision',
  'fixBrokBuyer',
  'fixBrockSeller',
]);

const normalizeIdentity = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const parseNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const formatNumber = (value) => {
  if (value === '' || value == null) return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return number.toFixed(2);
};

const getTaxRate = (line = {}, taxCodes = []) => {
  const code = String(line.taxCode || '').trim();
  if (!code) return 0;
  const match = taxCodes.find((entry) => String(entry?.Code || '').trim() === code);
  return parseNumber(match?.Rate);
};

const getGrossPriceAfterDiscount = (line = {}) => {
  if (line.unitPrice === '' || line.unitPrice == null) return '';
  const price = parseNumber(line.unitPrice);
  const discount = parseNumber(line.stdDiscount);
  return formatNumber(price * (1 - discount / 100));
};

const getTaxAmount = (lineTotals = {}, taxRate = 0) => {
  if (!lineTotals.beforeTax) return '';
  return formatNumber(parseNumber(lineTotals.beforeTax) * taxRate / 100);
};

const getUdfIdentitySet = (field = {}) =>
  new Set([
    field.key,
    field.sapField,
    field.aliasId,
    field.label,
    field.description,
    field.Descr,
  ].map(normalizeIdentity).filter(Boolean));

const getColumnIdentitySet = (column = {}) =>
  new Set([
    column.key,
    column.label,
    ...(column.udfLabels || []),
  ].map(normalizeIdentity).filter(Boolean));

const findMatchingUdfField = (column = {}, rowUdfFields = []) => {
  const columnIdentities = getColumnIdentitySet(column);
  return rowUdfFields.find((field) => {
    const fieldIdentities = getUdfIdentitySet(field);
    return Array.from(columnIdentities).some((identity) => fieldIdentities.has(identity));
  });
};

const isColumnActive = (column = {}, formSettings = {}) =>
  formSettings?.matrixColumns?.[column.key]?.active !== false;

const isLiveUdfColumn = (column = {}) => (
  Boolean(column.isUdf)
  || String(column.key || '').trim().toUpperCase().startsWith('U_')
  || String(column.sapField || '').trim().toUpperCase().startsWith('U_')
);

function EditableContentsTab({
  lines,
  onLineChange,
  onNumBlur,
  onAddLine,
  onRemoveLine,
  onOpenBatchModal,
  lineItemOptions,
  getUomOptions,
  effectiveTaxCodes,
  effectiveWarehouses,
  valErrors,
  onOpenHSNModal,
  onOpenItemModal,
  onOpenLineLookup,
  getBranchName,
  matrixFields = FALLBACK_MATRIX_COLS,
  formSettings = {},
  rowUdfFields = [],
  onRowUdfChange,
  locationLookupOptions = [],
  canPasteTable = false,
  onPasteTable,
  onClipboardFeedback,
}) {
  const sapItemTab = useSapItemCodeTab({ lineItemOptions, onLineChange, onOpenItemModal });
  const baseColumns = (matrixFields?.length ? matrixFields : FALLBACK_MATRIX_COLS)
    .map((column) => {
      const matchedUdfField = column.field
        || (DIRECT_LINE_FIELDS.has(column.key) && !isLiveUdfColumn(column)
          ? null
          : findMatchingUdfField(column, rowUdfFields));
      const udfSetting = matchedUdfField
        ? (formSettings.matrixColumns?.[column.key] || formSettings.rowUdfs?.[matchedUdfField.key])
        : null;
      const hydratedColumn = {
        ...column,
        active: isLiveUdfColumn(column)
          ? udfSetting?.active !== false && matchedUdfField?.active !== false
          : isColumnActive(column, formSettings),
        matchedUdfField,
        udfField: matchedUdfField,
        field: isLiveUdfColumn(column) ? matchedUdfField : column.field,
      };
      const width = getColumnWidth(hydratedColumn);
      return { ...hydratedColumn, width, minWidth: width };
    })
    .filter((column) => !isLiveUdfColumn(column) || Boolean(column.field));
  const matrixCols = getOrderedVisibleMatrixColumns(baseColumns, formSettings);
  const clipboardColumns = React.useMemo(() => matrixCols.map((column) => ({
    key: column.valueKey || column.rendererKey || column.key,
    label: column.label || column.key,
    isUdf: isLiveUdfColumn(column),
    readOnly: Boolean(column.readOnly || column.active === false || column.field?.readOnly),
  })), [matrixCols]);
  const { tableClipboardProps, tableClipboardUi } = useDocumentTableClipboard({
    columns: clipboardColumns,
    rows: lines,
    columnOffset: 1,
    canPaste: canPasteTable,
    onPaste: onPasteTable,
    onFeedback: onClipboardFeedback,
  });
  const tableMinWidth = INDEX_COL_WIDTH + ACTION_COL_WIDTH + matrixCols.reduce((total, col) => total + getColumnWidth(col), 0);

  const renderUdfCell = (field, line, rowIndex) => {
    const disabled = field.active === false || field.readOnly === true;
    const value = line.udf?.[field.key] || '';
    const renderAsSelect = field.type === 'select' || isSapPairDropdownField(field);

    if (field.lookupSource) {
      return <LiveUdfValueInput field={field} line={line} value={value} disabled={disabled} className="po-grid__input" onChange={(nextValue) => onRowUdfChange && onRowUdfChange(rowIndex, field.key, nextValue)} />;
    }

    if (renderAsSelect) {
      return (
        <select
          className="po-grid__input"
          value={value}
          onChange={(event) => onRowUdfChange && onRowUdfChange(rowIndex, field.key, event.target.value)}
          disabled={disabled}
        >
          <option value=""></option>
          {getSapPairDropdownOptions(field).map((option) => {
            const normalizedOption = normalizeSapPairDropdownOption(field, option);
            return (
              <option key={normalizedOption.value} value={normalizedOption.value}>
                {normalizedOption.label}
              </option>
            );
          })}
        </select>
      );
    }

    if (field.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value || '').trim().toUpperCase())}
          disabled={disabled}
          onChange={(event) => onRowUdfChange && onRowUdfChange(rowIndex, field.key, event.target.checked ? 'Y' : 'N')}
        />
      );
    }

    return (
      <SapInput
        className="po-grid__input"
        type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(event) => onRowUdfChange && onRowUdfChange(rowIndex, field.key, event.target.value)}
        disabled={disabled}
      />
    );
  };

  const renderUdfLookupCell = (field, line, rowIndex, lookupFieldName, title) => {
    const disabled = field.active === false || field.readOnly === true;
    const value = line.udf?.[field.key] || '';

    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <input
          className="po-grid__input"
          style={{ flex: 1, textAlign: 'left' }}
          value={value}
          onChange={(event) => onRowUdfChange && onRowUdfChange(rowIndex, field.key, event.target.value)}
          disabled={disabled}
        />
        {!disabled && (
          <button
            type="button"
            onClick={() => onOpenHSNModal && onOpenHSNModal(rowIndex, lookupFieldName, field.key)}
            style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
            title={title}
          >
            ...
          </button>
        )}
      </div>
    );
  };

  const renderUdfTaxCodeCell = (field, line, rowIndex) => {
    const disabled = field.active === false || field.readOnly === true;

    return (
      <TaxCodeLookup
        className="po-grid__input"
        style={{ width: '100%', textAlign: 'left' }}
        name={field.key}
        value={line.udf?.[field.key] || ''}
        onChange={(event) => onRowUdfChange && onRowUdfChange(rowIndex, field.key, event.target.value)}
        taxCodes={effectiveTaxCodes}
        disabled={disabled}
      />
    );
  };

  const renderLineLookupCell = (column, line, rowIndex, field = null) => {
    const disabled = column.active === false || column.readOnly === true || field?.active === false || field?.readOnly === true;
    const value = field ? line.udf?.[field.key] || '' : line[column.key] || '';
    const isLocationLookup = !field && column.lookup === 'location';
    const displayValue = isLocationLookup
      ? resolveLocationDisplayName(value, locationLookupOptions)
      : value;

    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <input
          className="po-grid__input"
          style={{ flex: 1, textAlign: 'left' }}
          name={field ? undefined : column.key}
          value={displayValue}
          onChange={(event) => {
            if (field) {
              onRowUdfChange && onRowUdfChange(rowIndex, field.key, event.target.value);
              return;
            }
            onLineChange(rowIndex, event);
          }}
          readOnly={isLocationLookup}
          disabled={disabled}
          title={isLocationLookup && displayValue !== value ? `${value} - ${displayValue}` : String(value || '')}
        />
        {!disabled && (
          <button
            type="button"
            onClick={() => onOpenLineLookup && onOpenLineLookup(column, rowIndex, field)}
            style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
            title={`Select ${column.label}`}
          >
            ...
          </button>
        )}
      </div>
    );
  };

  const renderCell = (column, line, rowIndex, lineTotals, uomOpts) => {
    const lineErrors = valErrors?.lines?.[rowIndex] || {};
    const disabled = column.active === false || column.readOnly === true;
    const taxRate = getTaxRate(line, effectiveTaxCodes);

    if (isLiveUdfColumn(column) && column.field) {
      return renderUdfCell(column.field, line, rowIndex);
    }

    if (column.udfField) {
      const mergedField = {
        ...column.udfField,
        active: column.active && column.udfField.active !== false,
        type: column.type || column.udfField.type,
        options: column.options || column.udfField.options,
      };

      if (column.key === 'sac' || column.key === 'sacCode') {
        return renderUdfLookupCell(mergedField, line, rowIndex, 'sac', 'Select SAC');
      }

      if (column.key === 'freight1TaxCode') {
        return renderUdfTaxCodeCell(mergedField, line, rowIndex);
      }

      if (column.lookup) {
        return renderLineLookupCell(column, line, rowIndex, mergedField);
      }

      return renderUdfCell(mergedField, line, rowIndex);
    }

    if (column.key === 'itemNo') {
      return (
        <>
          <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            <SapLookupTextInput
              className="po-grid__input"
              style={{ flex: 1, textAlign: 'left', border: lineErrors.itemNo ? '1px solid #c00' : undefined }}
              name="itemNo"
              data-sap-lookup="item"
              data-sap-row-index={rowIndex}
              onKeyDown={(event) => sapItemTab.handleItemCodeTab(event, rowIndex)}
              value={line.itemNo || ''}
              onChange={(event) => onLineChange(rowIndex, event)}
              placeholder="Item Code"
              disabled={disabled}
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => onOpenItemModal && onOpenItemModal(rowIndex)}
                style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                title="Select Item"
              >
                ...
              </button>
            )}
          </div>
          {lineErrors.itemNo && <div className="po-error-feedback">{lineErrors.itemNo}</div>}
        </>
      );
    }

    if (column.key === 'itemDescription') {
      return (
        <input
          className="po-grid__input"
          style={{ width: '100%', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          name="itemDescription"
          value={line.itemDescription || ''}
          onChange={(event) => onLineChange(rowIndex, event)}
          title={line.itemDescription || ''}
          disabled={disabled}
        />
      );
    }

    if (column.key === 'hsnCode') {
      return (
        <>
          <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            <input
              className="po-grid__input"
              style={{ flex: 1, textAlign: 'left', border: lineErrors.hsnCode ? '1px solid #c00' : undefined }}
              name="hsnCode"
              value={line.hsnCode || ''}
              onChange={(event) => onLineChange(rowIndex, event)}
              placeholder="HSN/SAC"
              disabled={disabled}
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => onOpenHSNModal && onOpenHSNModal(rowIndex, 'hsnCode')}
                style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                title="Select HSN Code"
              >
                ...
              </button>
            )}
          </div>
          {lineErrors.hsnCode && <div className="po-error-feedback">{lineErrors.hsnCode}</div>}
        </>
      );
    }

    if (column.key === 'sac' || column.key === 'sacCode') {
      return (
        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <input
            className="po-grid__input"
            style={{ flex: 1, textAlign: 'left' }}
            name={column.key}
            value={line[column.key] || ''}
            onChange={(event) => onLineChange(rowIndex, event)}
            placeholder="SAC"
            disabled={disabled}
          />
          {!disabled && (
            <button
              type="button"
              onClick={() => onOpenHSNModal && onOpenHSNModal(rowIndex, 'sac')}
              style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
              title="Select SAC"
            >
              ...
            </button>
          )}
        </div>
      );
    }

    if (column.key === 'uomCode') {
      const manualUom = Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL';
      return (
        <select
          className="po-grid__input"
          style={{ width: '100%', textAlign: 'left', border: lineErrors.uomCode ? '1px solid #c00' : undefined }}
          name="uomCode"
          value={line.uomCode || ''}
          onChange={(event) => onLineChange(rowIndex, event)}
          disabled={disabled || manualUom || isBaseDocumentLine(line)}
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
      );
    }

    if (column.key === 'uomName') {
      const manualUom = Number(line.uomEntry) < 0 || String(line.uomCode || '').toUpperCase() === 'MANUAL';
      return (
        <input
          className="po-grid__input"
          style={{ width: '100%', textAlign: 'left', background: manualUom ? undefined : '#f5f8fc' }}
          name="uomName"
          value={line.uomNameEdited ? (line.uomName ?? '') : (line.uomName || line.uomCode || '')}
          onChange={(event) => onLineChange(rowIndex, event)}
          disabled={disabled || !manualUom || isBaseDocumentLine(line)}
        />
      );
    }

    if (column.key === 'taxCode' || column.key === 'freight1TaxCode') {
      return (
        <TaxCodeLookup
          className="po-grid__input"
          style={{ width: '100%', textAlign: 'left' }}
          name={column.key}
          value={line[column.key] || ''}
          onChange={(event) => onLineChange(rowIndex, event)}
          taxCodes={effectiveTaxCodes}
          disabled={disabled}
        />
      );
    }

    if (column.key === 'whse') {
      return (
        <>
          <select
            className="po-grid__input"
            style={{ width: '100%', textAlign: 'left', border: lineErrors.whse ? '1px solid #c00' : undefined }}
            name="whse"
            value={line.whse || ''}
            onChange={(event) => onLineChange(rowIndex, event)}
            disabled={disabled}
          >
            <option value="">Select</option>
            {effectiveWarehouses.map((warehouse) => (
              <option key={warehouse.WhsCode} value={warehouse.WhsCode}>{warehouse.WhsCode}</option>
            ))}
            {line.whse && !effectiveWarehouses.some((warehouse) => warehouse.WhsCode === line.whse) && (
              <option value={line.whse}>{line.whse}</option>
            )}
          </select>
          {lineErrors.whse && <div className="po-error-feedback">{lineErrors.whse}</div>}
        </>
      );
    }

    if (column.key === 'wtaxLiable') {
      return (
        <select
          className="po-grid__input"
          name="wtaxLiable"
          value={line.wtaxLiable || ''}
          onChange={(event) => onLineChange(rowIndex, event)}
          disabled={disabled}
        >
          <option value="N">N</option>
          <option value="Y">Y</option>
        </select>
      );
    }

    if (column.key === 'withoutQtyPosting' || column.type === 'yesNo') {
      return (
        <select
          className="po-grid__input"
          name={column.key}
          value={['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(line[column.key] || '').trim().toUpperCase()) ? 'Y' : 'N'}
          onChange={(event) => onLineChange(rowIndex, event)}
          disabled={disabled}
        >
          <option value="N">No</option>
          <option value="Y">Yes</option>
        </select>
      );
    }

    if (column.lookup) {
      return renderLineLookupCell(column, line, rowIndex);
    }

    const readOnlyValues = {
      rate: taxRate ? formatNumber(taxRate) : '',
      grossPriceAfterDisc: getGrossPriceAfterDiscount(line),
      taxAmountLC: getTaxAmount(lineTotals, taxRate),
      totalBeforeTax: lineTotals.beforeTax,
      total: lineTotals.total,
    };

    if (Object.prototype.hasOwnProperty.call(readOnlyValues, column.key)) {
      return (
        <input
          className="po-grid__input"
          value={readOnlyValues[column.key] || ''}
          readOnly
          disabled
          style={{ background: '#f5f8fc' }}
        />
      );
    }

    if (column.type === 'select') {
      return (
        <select
          className="po-grid__input"
          name={column.key}
          value={line[column.key] || ''}
          onChange={(event) => onLineChange(rowIndex, event)}
          disabled={disabled}
        >
          <option value=""></option>
          {(column.options || []).map((option) => {
            const normalizedOption = typeof option === 'object' ? option : { value: option, label: option };
            return (
              <option key={normalizedOption.value} value={normalizedOption.value}>
                {normalizedOption.label}
              </option>
            );
          })}
        </select>
      );
    }

    return (
      <>
        <input
          className="po-grid__input"
          style={{ border: lineErrors[column.key] ? '1px solid #c00' : undefined }}
          name={column.key}
          value={line[column.key] || ''}
          onChange={(event) => onLineChange(rowIndex, event)}
          onBlur={NUMERIC_LINE_FIELDS.has(column.key) ? () => onNumBlur(column.key, 'line', rowIndex) : undefined}
          disabled={disabled}
        />
        {lineErrors[column.key] && <div className="po-error-feedback">{lineErrors[column.key]}</div>}
      </>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="po-section-title" style={{ marginBottom: 0 }}>Item Matrix</div>
        <button type="button" className="po-btn po-btn--primary" onClick={onAddLine}>
          + Add Line
        </button>
      </div>
      <div className="po-grid-wrap" style={{ overflowX: 'auto', overflowY: 'visible' }}>
          <table
            {...tableClipboardProps}
            className="po-grid"
            style={{ width: 'max-content', minWidth: tableMinWidth, tableLayout: 'auto' }}
          >
            <colgroup>
              <col style={{ width: INDEX_COL_WIDTH }} />
              {matrixCols.map((column) => (
                <col key={column.key} style={{ width: getColumnWidth(column) }} />
              ))}
              <col style={{ width: ACTION_COL_WIDTH }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: INDEX_COL_WIDTH }}>#</th>
                {matrixCols.map((column) => (
                  <th key={column.key} style={{ minWidth: getColumnWidth(column) }}>
                    {column.label}
                  </th>
                ))}
                <th style={{ width: ACTION_COL_WIDTH }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, rowIndex) => {
                const uomOpts = getUomOptions(line);
                const lineTotals = getLineTotalsForDisplay(line, effectiveTaxCodes);
                return (
                  <tr key={rowIndex}>
                    <td className="po-grid__cell--muted" style={{ textAlign: 'center', fontSize: 11 }}>{rowIndex + 1}</td>
                    {matrixCols.map((column) => (
                      <td key={column.key}>
                        {renderCell(column, line, rowIndex, lineTotals, uomOpts)}
                      </td>
                    ))}
                    <td>
                      {line.batchManaged && Number(line.baseType ?? line.BaseType) !== 20 && (
                        <button
                          type="button"
                          className="po-btn"
                          style={{ padding: '2px 6px', marginRight: 3, fontSize: 11 }}
                          onClick={() => onOpenBatchModal?.(rowIndex)}
                          disabled={!line.itemNo || !line.whse || Number(line.quantity || 0) <= 0}
                          title="Assign incoming batches"
                        >
                          {line.batches?.length ? `${line.batches.length} Batch` : 'Batch'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="po-btn po-btn--danger"
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
  );
}

export default function ContentsTab(props) {
  return <EditableContentsTab {...props} />;
}
