import { mergeSavedFormSettings } from './formSettingsPreferences';

const buildVisibilitySettings = (definitions = []) => (
  (definitions || []).reduce((settings, field) => {
    if (!field?.key) return settings;
    const active = field.active !== undefined
      ? field.active !== false
      : field.editable !== false && !field.readOnly;
    settings[field.key] = {
      visible: field.visible !== false,
      active,
      sapControlled: Boolean(field.sapControlled),
      order: Number(field.columnOrder ?? field.order) || undefined,
      minWidth: Number(field.minWidth ?? field.width) || undefined,
      valueKey: field.valueKey,
    };
    return settings;
  }, {})
);

export const createServiceDocumentFormSettings = (
  headerUdfs = [],
  rowUdfs = [],
  matrixColumns = [],
) => ({
  matrixColumns: buildVisibilitySettings(matrixColumns),
  headerUdfs: buildVisibilitySettings(headerUdfs),
  rowUdfs: buildVisibilitySettings(rowUdfs),
});

export const readServiceDocumentFormSettings = ({
  headerUdfs = [],
  rowUdfs = [],
  matrixColumns = [],
  storageKey,
} = {}) => {
  const defaults = createServiceDocumentFormSettings(headerUdfs, rowUdfs, matrixColumns);
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const saved = JSON.parse(raw);
    const settings = mergeSavedFormSettings(defaults, saved);
    if (saved?.__companyQueryLayout) settings.__companyQueryLayout = saved.__companyQueryLayout;
    return settings;
  } catch (_error) {
    return defaults;
  }
};
