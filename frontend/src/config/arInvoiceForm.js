import { mergeSavedFormSettings } from '../utils/formSettingsPreferences';

const FORM_SETTINGS_STORAGE_KEY = 'sapb1.arInvoice.formSettings.v1';

const HEADER_UDF_DEFINITIONS = [];
const ROW_UDF_DEFINITIONS = [];

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
  return identity.includes('termsofsupply') ||
    identity.includes('supplyterms');
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

const getValidDefinitions = (definitions = []) =>
  (definitions || []).filter((field) => field && field.key);

const createUdfState = (definitions = []) =>
  getValidDefinitions(definitions).reduce((acc, field) => {
    acc[field.key] = getDefaultUdfValue(field);
    return acc;
  }, {});

const normalizeUdfState = (definitions = [], values = {}, options = {}) => {
  const preserveExtra = options.preserveExtra !== false;
  const normalized = getValidDefinitions(definitions).reduce((acc, field) => {
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
  getValidDefinitions(definitions).reduce((acc, field) => {
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
  matrixColumns = [],
) => ({
  matrixColumns: buildVisibilitySettings(matrixColumns),
  headerUdfs: buildVisibilitySettings(headerUdfs),
  rowUdfs: buildVisibilitySettings(rowUdfs),
});

const readSavedFormSettings = (
  headerUdfs = HEADER_UDF_DEFINITIONS,
  rowUdfs = ROW_UDF_DEFINITIONS,
  matrixColumns = [],
  storageKey = FORM_SETTINGS_STORAGE_KEY,
) => {
  const defaults = createDefaultFormSettings(headerUdfs, rowUdfs, matrixColumns);

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    return mergeSavedFormSettings(defaults, JSON.parse(raw), {
      editableSapControlledGroups: ['matrixColumns', 'rowUdfs', 'headerUdfs'],
    });
  } catch (_error) {
    return defaults;
  }
};

export {
  FORM_SETTINGS_STORAGE_KEY,
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createDefaultFormSettings,
  createUdfState,
  normalizeUdfState,
  readSavedFormSettings,
};
