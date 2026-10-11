import { mergeSavedFormSettings } from '../utils/formSettingsPreferences';

const FORM_SETTINGS_STORAGE_KEY = 'sapb1.salesQuotation.formSettings.v1';

// Retained as empty compatibility exports. Sales Quotation fields now come
// exclusively from the active company's live SAP schema and form layout.
const HEADER_UDF_DEFINITIONS = [];
const ROW_UDF_DEFINITIONS = [];
const BASE_MATRIX_COLUMNS = [];

const getOptionValue = (option) => (typeof option === 'string' ? option : option?.value ?? '');

const getUdfIdentity = (field = {}) =>
  [
    field.key,
    field.sapField,
    field.aliasId,
    field.label,
    field.description,
    field.Descr,
  ].join(' ').toLowerCase().replace(/[^a-z0-9]+/g, '');

const shouldKeepUdfBlankByDefault = (field = {}) => {
  const identity = getUdfIdentity(field);
  return identity.includes('termsofsupply') || identity.includes('supplyterms');
};

const getDefaultUdfValue = (field = {}) => {
  if (shouldKeepUdfBlankByDefault(field)) return '';

  if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== '') {
    return field.defaultValue;
  }

  if (field.required && field.type === 'select' && Array.isArray(field.options)) {
    return field.options.map(getOptionValue).find((value) => String(value || '').trim() !== '') ?? '';
  }

  return field.defaultValue ?? '';
};

const createUdfState = (definitions = []) =>
  definitions.reduce((acc, field) => {
    if (field?.key) acc[field.key] = getDefaultUdfValue(field);
    return acc;
  }, {});

const normalizeUdfState = (definitions = [], values = {}, options = {}) => {
  const preserveExtra = options.preserveExtra !== false;
  const normalized = definitions.reduce((acc, field) => {
    if (!field?.key) return acc;
    const currentValue = values[field.key];
    const shouldApplyDefault =
      currentValue === undefined ||
      currentValue === null ||
      (field.required && String(currentValue) === '');

    acc[field.key] = shouldApplyDefault ? getDefaultUdfValue(field) : currentValue;
    return acc;
  }, {});

  if (preserveExtra) {
    Object.entries(values || {}).forEach(([key, value]) => {
      if (String(key || '').startsWith('U_') && !Object.prototype.hasOwnProperty.call(normalized, key)) {
        normalized[key] = value == null ? '' : value;
      }
    });
  }

  return normalized;
};

const buildVisibilitySettings = (definitions = []) =>
  definitions.reduce((acc, field) => {
    if (!field?.key) return acc;
    acc[field.key] = {
      visible: field.visible !== undefined ? field.visible : true,
      active: field.active !== undefined ? field.active : true,
      sapControlled: Boolean(field.sapControlled),
      order: field.order,
      minWidth: field.minWidth,
      ...(field.valueKey && field.valueKey !== field.key ? { valueKey: field.valueKey } : {}),
    };
    return acc;
  }, {});

const createDefaultFormSettings = (
  headerUdfs = HEADER_UDF_DEFINITIONS,
  rowUdfs = ROW_UDF_DEFINITIONS,
  matrixColumns = BASE_MATRIX_COLUMNS,
) => ({
  headerUdfs: buildVisibilitySettings(headerUdfs),
  matrixColumns: buildVisibilitySettings(matrixColumns),
  rowUdfs: buildVisibilitySettings(rowUdfs),
});

const readSavedFormSettings = (
  headerUdfs = HEADER_UDF_DEFINITIONS,
  rowUdfs = ROW_UDF_DEFINITIONS,
  matrixColumns = BASE_MATRIX_COLUMNS,
  storageKey = FORM_SETTINGS_STORAGE_KEY,
) => {
  if (typeof headerUdfs === 'string') {
    storageKey = headerUdfs;
    headerUdfs = HEADER_UDF_DEFINITIONS;
    rowUdfs = ROW_UDF_DEFINITIONS;
    matrixColumns = BASE_MATRIX_COLUMNS;
  }
  const defaults = createDefaultFormSettings(headerUdfs, rowUdfs, matrixColumns);

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    return mergeSavedFormSettings(defaults, JSON.parse(raw));
  } catch (_error) {
    return defaults;
  }
};

export {
  BASE_MATRIX_COLUMNS,
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createDefaultFormSettings,
  createUdfState,
  normalizeUdfState,
  readSavedFormSettings,
};
