const STRUCTURAL_COLUMN_KEYS = new Set([
  '#',
  'ACTION',
  'ACTIONS',
  'DELETE',
  'REMOVE',
  'ROW',
  'ROWNUMBER',
  'LINENUMBER',
  'SELECT',
  'SELECTION',
  'SERIAL',
  'SERIALNUMBER',
]);

const REQUIRED_IDENTITY_KEYS = new Set([
  'ACCOUNT',
  'ACCOUNTCODE',
  'ACCOUNTNO',
  'GLACCOUNT',
  'ITEM',
  'ITEMCODE',
  'ITEMNO',
  'SHORTNAME',
]);

const isRecord = (value) => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key);

const normalizeIdentity = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9#]/g, '');

// SAP renders the row number as a read-only, mandatory first column. It is
// part of the matrix layout (so it can be carried through company settings),
// but users must never be able to hide or move it behind data columns.
export const isLineNumberMatrixField = (field = {}) => {
  const identities = [field.key, field.valueKey, field.fieldName, field.rendererKey, field.label]
    .map(normalizeIdentity)
    .filter(Boolean);
  return identities.includes('#')
    || identities.includes('LINENUMBER')
    || identities.includes('LINENUM')
    || identities.includes('ROWNUMBER')
    || identities.includes('__LINENUMBER');
};

const toFiniteOrder = (value) => {
  const order = Number(value);
  return Number.isFinite(order) && order >= 0 ? order : null;
};

// Grids re-sort the resolved columns by `columnOrder`, so the row number needs a
// resolved order that is lower than every configurable column. Otherwise an
// imported layout that stores `#` in the middle drags it back out of position
// one after this helper has already pinned it to the front of the array.
const LINE_NUMBER_COLUMN_ORDER = -1;

export const isStructuralMatrixField = (field = {}) => {
  if (isLineNumberMatrixField(field)) return false;
  if (field.structural === true || field.configurable === false) return true;
  const identities = [field.key, field.valueKey, field.fieldName, field.rendererKey]
    .map(normalizeIdentity)
    .filter(Boolean);
  return identities.some((identity) => STRUCTURAL_COLUMN_KEYS.has(identity));
};

export const isRequiredVisibleMatrixField = (field = {}, setting = {}) => {
  if (isLineNumberMatrixField(field)) return true;
  if (setting?.companyQueryLayout === true && hasOwn(setting, 'visible')) return false;
  if (
    field.requiredVisible === true
    || field.visibilityLocked === true
    || field.pinnedVisible === true
    || setting.requiredVisible === true
    || setting.visibilityLocked === true
    || setting.pinnedVisible === true
  ) return true;

  const identities = [field.key, field.valueKey, field.fieldName, field.rendererKey]
    .map(normalizeIdentity)
    .filter(Boolean);
  return identities.some((identity) => REQUIRED_IDENTITY_KEYS.has(identity));
};

export const getMatrixColumnSetting = (column = {}, formSettings = {}) => {
  const matrixSetting = formSettings?.matrixColumns?.[column.key];
  const rowUdfKey = column.field?.key || column.udfKey || column.valueKey || column.fieldName || column.key;
  const rowUdfSetting = formSettings?.rowUdfs?.[rowUdfKey];
  return matrixSetting || rowUdfSetting || {};
};

export const isMatrixColumnVisible = (field = {}, setting = {}) => {
  if (isRequiredVisibleMatrixField(field, setting)) return true;
  if (hasOwn(setting, 'visible')) return setting.visible !== false;
  return field.visible !== false;
};

export const getOrderedVisibleMatrixColumns = (
  columns = [],
  formSettings = {},
  { includeHidden = false, includeStructural = false } = {},
) => (Array.isArray(columns) ? columns : [])
  .map((column, sourceIndex) => {
    if (!column?.key) return null;
    const setting = getMatrixColumnSetting(column, formSettings);
    return {
      column,
      sourceIndex,
      visible: isMatrixColumnVisible(column, setting),
      order: toFiniteOrder(setting.order)
        ?? toFiniteOrder(column.order ?? column.columnOrder)
        ?? sourceIndex + 1,
    };
  })
  .filter(Boolean)
  .filter((entry) => includeStructural || !isStructuralMatrixField(entry.column))
  .filter((entry) => includeHidden || entry.visible)
  .sort((left, right) => {
    const leftIsLineNumber = isLineNumberMatrixField(left.column);
    const rightIsLineNumber = isLineNumberMatrixField(right.column);
    if (leftIsLineNumber !== rightIsLineNumber) return leftIsLineNumber ? -1 : 1;
    return left.order - right.order || left.sourceIndex - right.sourceIndex;
  })
  .map((entry) => {
    const order = isLineNumberMatrixField(entry.column) ? LINE_NUMBER_COLUMN_ORDER : entry.order;
    return {
      ...entry.column,
      visible: entry.visible,
      order,
      columnOrder: order,
    };
  });

/**
 * Applies a single normalized order across standard matrix fields and row UDFs.
 * Unknown and stale keys are ignored so one company cannot revive another
 * company's fields.
 */
export const reorderFormSettingPreferences = (
  settings,
  orderedFields = [],
) => {
  if (!isRecord(settings) || !Array.isArray(orderedFields)) return settings;
  let changed = false;
  const nextSettings = { ...settings };

  // Keep SAP's mandatory row number at position one even when an imported
  // layout or a drag/drop event supplied a different order.
  const lineNumberFieldIndex = orderedFields.findIndex((field) => (
    isLineNumberMatrixField(typeof field === 'string' ? { key: field } : field)
  ));
  const normalizedOrderedFields = lineNumberFieldIndex > 0
    ? [orderedFields[lineNumberFieldIndex], ...orderedFields.filter((_field, index) => index !== lineNumberFieldIndex)]
    : orderedFields;

  normalizedOrderedFields.forEach((field, index) => {
    const key = typeof field === 'string' ? field : field?.key;
    const preferredGroup = typeof field === 'object' ? field?.settingsGroup : '';
    const groupKey = preferredGroup && isRecord(settings[preferredGroup]) && hasOwn(settings[preferredGroup], key)
      ? preferredGroup
      : (isRecord(settings.matrixColumns) && hasOwn(settings.matrixColumns, key) ? 'matrixColumns' : 'rowUdfs');
    if (!key || !isRecord(settings[groupKey]) || !hasOwn(settings[groupKey], key)) return;

    const order = index + 1;
    if (settings[groupKey][key]?.order === order) return;
    if (nextSettings[groupKey] === settings[groupKey]) {
      nextSettings[groupKey] = { ...settings[groupKey] };
    }
    nextSettings[groupKey][key] = { ...settings[groupKey][key], order };
    changed = true;
  });

  return changed ? nextSettings : settings;
};

export const mergeContentSettingsFields = (
  matrixFields = [],
  rowUdfFields = [],
) => {
  const fields = [];
  const identities = new Set();

  const append = (field, settingsGroup) => {
    if (!field?.key || isStructuralMatrixField(field)) return;
    const tokens = [field.key, field.valueKey, field.fieldName, field.sapField, field.aliasId]
      .map(normalizeIdentity)
      .filter(Boolean);
    if (!field.companyQueryLayoutColumn && tokens.some((token) => identities.has(token))) return;
    tokens.forEach((token) => identities.add(token));
    fields.push({ ...field, settingsGroup });
  };

  (matrixFields || []).forEach((field) => append(field, 'matrixColumns'));
  (rowUdfFields || []).forEach((field) => append(field, 'rowUdfs'));
  return fields;
};
