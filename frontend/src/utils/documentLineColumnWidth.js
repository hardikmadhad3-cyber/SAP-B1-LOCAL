const getPositiveWidth = (value) => {
  const width = Number(value);
  return Number.isFinite(width) && width > 0 ? width : 0;
};

// Sized for the 13px Fiori compact grid font (--sap-grid-font-size).
const getColumnTypeMinimumWidth = (field = {}) => {
  if (field.type === 'textarea') return 180;
  if (field.lookupSource || field.lookup?.source || field.lookup) return 130;
  if (field.type === 'date') return 125;
  if (field.type === 'checkbox') return 90;
  if (field.type === 'number' || field.numeric) return 95;
  return 115;
};

const getHeaderMinimumWidth = (field = {}, maximum = 240) => {
  const label = String(field.label || field.columnTitle || field.fieldName || field.key || '').trim();
  if (!label) return 0;
  return Math.min(maximum, Math.max(80, Math.ceil(label.length * 7.5) + 24));
};

export const getReadableDocumentLineColumnWidth = (
  field = {},
  semanticField = {},
  {
    lineNumberKey = '__lineNumber',
    lineNumberWidth = 42,
    maximumHeaderWidth = 240,
  } = {},
) => {
  if (String(field.key || '') === lineNumberKey) {
    return Math.max(
      lineNumberWidth,
      getPositiveWidth(field.width),
      getPositiveWidth(field.minWidth),
    );
  }

  return Math.max(
    getPositiveWidth(field.width),
    getPositiveWidth(field.minWidth),
    getPositiveWidth(semanticField.width),
    getPositiveWidth(semanticField.minWidth),
    getColumnTypeMinimumWidth({ ...semanticField, ...field }),
    getHeaderMinimumWidth(field, maximumHeaderWidth),
  );
};
