import { mergeSavedFormSettings } from '../utils/formSettingsPreferences';

export {
  HEADER_UDF_DEFINITIONS,
  ROW_UDF_DEFINITIONS,
  createUdfState,
  normalizeUdfState,
} from './arInvoiceForm';

export const FORM_SETTINGS_STORAGE_KEY = 'sapb1.arCreditMemo.formSettings.v1';

const buildVisibilitySettings = (definitions = []) =>
  definitions.reduce((acc, field) => {
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

const createDefaultFormSettingsForCreditMemo = (
  headerUdfs = [],
  rowUdfs = [],
  matrixColumns = [],
) => ({
  matrixColumns: buildVisibilitySettings(matrixColumns),
  headerUdfs: buildVisibilitySettings(headerUdfs),
  rowUdfs: buildVisibilitySettings(rowUdfs),
});

export const readSavedFormSettings = (
  headerUdfs = [],
  rowUdfs = [],
  matrixColumns = [],
  storageKey = FORM_SETTINGS_STORAGE_KEY,
) => {
  const defaults = createDefaultFormSettingsForCreditMemo(headerUdfs, rowUdfs, matrixColumns);

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    return mergeSavedFormSettings(defaults, JSON.parse(raw));
  } catch (_error) {
    return defaults;
  }
};

export const createDefaultFormSettings = createDefaultFormSettingsForCreditMemo;
