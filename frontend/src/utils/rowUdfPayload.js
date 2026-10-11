const hasEnteredUdfValue = (value) => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== '';
};

const isSapUdfKey = (key) => String(key || '').startsWith('U_');

const getRowUdfSettings = (key, rowSettings = {}, matrixSettings = {}) => {
  const matrixMatches = Object.entries(matrixSettings)
    .filter(([matrixKey, setting]) => matrixKey === key || setting?.valueKey === key)
    .map(([, setting]) => setting);
  return matrixMatches.length ? matrixMatches : [rowSettings[key] || {}];
};

const resolveVisible = (field = {}, setting = {}) => (
  setting?.visible !== undefined ? setting.visible !== false : field.visible !== false
);

const resolveActive = (field = {}, setting = {}) => (
  setting?.active !== undefined ? setting.active !== false : field.active !== false
);

const canIncludeRowUdf = (field, setting = {}) => {
  if (field) {
    return resolveVisible(field, setting) && resolveActive(field, setting);
  }

  return setting?.visible !== false && setting?.active !== false;
};

export const buildVisibleEnteredRowUdfPayload = (
  rowUdfDefinitions = [],
  values = {},
  formSettings = {},
  { preserveUnmappedUdfs = true } = {},
) => {
  const rowSettings = formSettings?.rowUdfs || {};
  const matrixSettings = formSettings?.matrixColumns || {};
  const definedUdfKeys = new Set(
    (rowUdfDefinitions || []).map((field) => field?.key).filter(Boolean),
  );

  const payload = (rowUdfDefinitions || []).reduce((acc, field) => {
    const key = field?.key;
    if (!key) return acc;

    const settings = getRowUdfSettings(key, rowSettings, matrixSettings);
    const value = values?.[key];

    if (settings.some((setting) => canIncludeRowUdf(field, setting)) && hasEnteredUdfValue(value)) {
      acc[key] = value;
    }

    return acc;
  }, {});

  Object.entries(values || {}).forEach(([key, value]) => {
    if (
      !isSapUdfKey(key) ||
      Object.prototype.hasOwnProperty.call(payload, key) ||
      definedUdfKeys.has(key) ||
      !preserveUnmappedUdfs ||
      !hasEnteredUdfValue(value)
    ) {
      return;
    }

    payload[key] = value;
  });

  return payload;
};
