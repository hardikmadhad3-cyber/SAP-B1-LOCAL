const {
  SALES_ORDER_DOCUMENT,
  resolveSalesDocument,
} = require('./newSalesOrderConstants');

const HEADER_TABLE = SALES_ORDER_DOCUMENT.headerTable;
const LINE_TABLE = SALES_ORDER_DOCUMENT.lineTable;

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();

const createHttpError = (statusCode, message, details, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details !== undefined) error.details = details;
  if (code) error.code = code;
  return error;
};

const resolveSchemaTables = (schema = {}) => {
  let document = SALES_ORDER_DOCUMENT;
  if (text(schema.documentType)) {
    try {
      document = resolveSalesDocument(schema.documentType);
    } catch (_error) {
      throw createHttpError(500, 'Current schema has an unsupported document type.', undefined, 'INVALID_SCHEMA');
    }
  }

  const headerTable = upper(schema.headerTable || document.headerTable);
  const lineTable = upper(schema.lineTable || document.lineTable);
  if (headerTable !== document.headerTable || lineTable !== document.lineTable) {
    throw createHttpError(
      500,
      'Current schema tables do not match its sales-document profile.',
      { documentType: document.documentType, headerTable, lineTable },
      'INVALID_SCHEMA',
    );
  }
  return { document, headerTable, lineTable };
};

const fieldIdentifier = (field, index, tableName) =>
  text(field?.id) || `${tableName}.${text(field?.sapField || field?.databaseField || field?.stateKey) || `field_${index + 1}`}`;

const isUdfField = (field = {}) =>
  upper(field.storage) === 'UDF' || upper(field.sapField || field.databaseField).startsWith('U_');

const isDisplayOnlyField = (field = {}) =>
  ['CALCULATED', 'DISPLAY-ONLY', 'DISPLAY_ONLY'].includes(upper(field.storage));

const isFieldWritable = (field = {}) =>
  field.visible !== false && field.editable !== false && field.readOnly !== true && !isDisplayOnlyField(field);

const fieldInputKeys = (field = {}) => [...new Set([
  text(field.stateKey),
  text(field.sapField),
  text(field.databaseField),
  text(field.id),
].filter(Boolean))];

const normalizeSchemaFields = (schema, propertyName, expectedTable) => {
  const fields = schema?.[propertyName];
  if (!Array.isArray(fields)) {
    throw createHttpError(500, `Current schema is missing ${propertyName}.`, undefined, 'INVALID_SCHEMA');
  }

  const ids = new Set();
  const sapFields = new Set();
  return fields.map((field, index) => {
    if (!isPlainObject(field)) {
      throw createHttpError(500, `${propertyName}[${index}] is invalid.`, undefined, 'INVALID_SCHEMA');
    }

    const tableName = upper(field.tableName || expectedTable);
    if (tableName !== expectedTable) {
      throw createHttpError(
        500,
        `${propertyName}[${index}] does not belong to ${expectedTable}.`,
        { fieldId: fieldIdentifier(field, index, tableName), tableName },
        'INVALID_SCHEMA',
      );
    }

    const id = fieldIdentifier(field, index, tableName);
    const sapField = text(field.sapField);
    if (!sapField && !isDisplayOnlyField(field)) {
      throw createHttpError(500, `${id} is missing sapField.`, undefined, 'INVALID_SCHEMA');
    }
    if (ids.has(id)) {
      throw createHttpError(500, `Duplicate schema field id ${id}.`, undefined, 'INVALID_SCHEMA');
    }
    if (sapField && sapFields.has(upper(sapField)) && !isDisplayOnlyField(field)) {
      throw createHttpError(500, `Duplicate schema SAP field ${sapField}.`, undefined, 'INVALID_SCHEMA');
    }

    ids.add(id);
    if (sapField && !isDisplayOnlyField(field)) sapFields.add(upper(sapField));
    return { ...field, id, tableName, sapField };
  });
};

const buildInputMaps = (fields) => {
  const all = new Map();
  const udf = new Map();
  for (const field of fields) {
    for (const key of fieldInputKeys(field)) {
      if (all.has(key) && all.get(key).id !== field.id) {
        throw createHttpError(500, `Ambiguous schema input key ${key}.`, undefined, 'INVALID_SCHEMA');
      }
      all.set(key, field);
      if (isUdfField(field)) udf.set(key, field);
    }
  }
  return { all, udf };
};

const addError = (errors, { field, path, code, message }) => {
  errors.push({
    fieldId: field?.id || null,
    path,
    code,
    message,
  });
};

const normalizeContainers = (group, fields, path, errors, { line = false } = {}) => {
  const normalizedGroup = isPlainObject(group) ? group : {};
  if (!isPlainObject(group)) {
    addError(errors, { path, code: 'invalid_object', message: `${path} must be an object.` });
  }

  const values = isPlainObject(normalizedGroup.values) ? normalizedGroup.values : {};
  const udfValues = isPlainObject(normalizedGroup.udf) ? normalizedGroup.udf : {};
  if (hasOwn(normalizedGroup, 'values') && !isPlainObject(normalizedGroup.values)) {
    addError(errors, { path: `${path}.values`, code: 'invalid_object', message: `${path}.values must be an object.` });
  }
  if (hasOwn(normalizedGroup, 'udf') && !isPlainObject(normalizedGroup.udf)) {
    addError(errors, { path: `${path}.udf`, code: 'invalid_object', message: `${path}.udf must be an object.` });
  }

  const direct = {};
  const structuralKeys = new Set(['values', 'udf', 'errors', ...(line ? ['localLineId'] : [])]);
  for (const [key, value] of Object.entries(normalizedGroup)) {
    if (!structuralKeys.has(key)) direct[key] = value;
  }

  const maps = buildInputMaps(fields);
  const inspectUnknown = (source, sourcePath, allowedMap) => {
    for (const key of Object.keys(source)) {
      if (!allowedMap.has(key)) {
        addError(errors, {
          path: `${sourcePath}.${key}`,
          code: 'unknown_field',
          message: `Unknown field ${key} is not present in the current company schema.`,
        });
      }
    }
  };

  inspectUnknown(values, `${path}.values`, maps.all);
  inspectUnknown(udfValues, `${path}.udf`, maps.udf);
  inspectUnknown(direct, path, maps.all);

  return {
    values,
    udfValues,
    direct,
    localLineId: line ? text(normalizedGroup.localLineId) : '',
  };
};

const valuesEqual = (left, right) => {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return text(left) === text(right);
};

const readSubmittedValue = (field, containers, path, errors) => {
  const matches = [];
  for (const key of fieldInputKeys(field)) {
    if (hasOwn(containers.values, key)) matches.push({ path: `${path}.values.${key}`, value: containers.values[key] });
    if (isUdfField(field) && hasOwn(containers.udfValues, key)) matches.push({ path: `${path}.udf.${key}`, value: containers.udfValues[key] });
    if (hasOwn(containers.direct, key)) matches.push({ path: `${path}.${key}`, value: containers.direct[key] });
  }

  if (!matches.length) return { present: false, value: undefined, path: `${path}.${field.stateKey || field.sapField}` };
  const first = matches[0];
  if (matches.some((match) => !valuesEqual(match.value, first.value))) {
    addError(errors, {
      field,
      path: first.path,
      code: 'conflicting_values',
      message: `${field.label || field.sapField} was submitted more than once with conflicting values.`,
    });
  }
  return { present: true, value: first.value, path: first.path };
};

const isEmptyValue = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const decimalParts = (value) => {
  const match = text(value).match(/^[+-]?(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const integerDigits = match[1].replace(/^0+(?=\d)/, '') || '0';
  return {
    scale: (match[2] || '').length,
    precision: integerDigits.length + (match[2] || '').length,
  };
};

const isValidDateOnly = (value) => {
  const normalized = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const normalizeCheckbox = (value) => {
  if (value === true || value === false) return value;
  const normalized = upper(value);
  if (['Y', 'YES', 'TRUE', '1', 'TYES'].includes(normalized)) return true;
  if (['N', 'NO', 'FALSE', '0', 'TNO'].includes(normalized)) return false;
  return undefined;
};

const optionValues = (field) => (Array.isArray(field.options) ? field.options : [])
  .map((option) => (isPlainObject(option) ? option.value : option))
  .filter((value) => value !== undefined && value !== null)
  .map(String);

const validatePrimitiveValue = (field, value, path, errors) => {
  const type = upper(field.type || field.renderer || 'TEXT').replace(/_/g, '-');
  if (isEmptyValue(value)) {
    if (field.required) {
      addError(errors, {
        field,
        path,
        code: 'required',
        message: `${field.label || field.sapField} is required.`,
      });
    }
    return '';
  }

  if (type === 'NUMBER' || type === 'INTEGER') {
    const parts = decimalParts(value);
    const number = Number(value);
    if (!parts || !Number.isFinite(number)) {
      addError(errors, { field, path, code: 'invalid_number', message: `${field.label || field.sapField} must be numeric.` });
      return text(value);
    }
    if (type === 'INTEGER' && (!Number.isInteger(number) || parts.scale > 0)) {
      addError(errors, { field, path, code: 'integer_required', message: `${field.label || field.sapField} must be a whole number.` });
    }
    if (Number.isInteger(Number(field.scale)) && parts.scale > Number(field.scale)) {
      addError(errors, { field, path, code: 'scale_exceeded', message: `${field.label || field.sapField} allows at most ${field.scale} decimal places.` });
    }
    if (Number.isInteger(Number(field.precision)) && parts.precision > Number(field.precision)) {
      addError(errors, { field, path, code: 'precision_exceeded', message: `${field.label || field.sapField} exceeds precision ${field.precision}.` });
    }
    if (field.minimum != null && number < Number(field.minimum)) {
      addError(errors, { field, path, code: 'below_minimum', message: `${field.label || field.sapField} must be at least ${field.minimum}.` });
    }
    if (field.maximum != null && number > Number(field.maximum)) {
      addError(errors, { field, path, code: 'above_maximum', message: `${field.label || field.sapField} must be at most ${field.maximum}.` });
    }
    return text(value);
  }

  if (type === 'DATE') {
    const normalized = text(value).split('T')[0];
    if (!isValidDateOnly(normalized)) {
      addError(errors, { field, path, code: 'invalid_date', message: `${field.label || field.sapField} must be a valid date.` });
    }
    return normalized;
  }

  if (type === 'DATETIME') {
    if (!Number.isFinite(Date.parse(String(value)))) {
      addError(errors, { field, path, code: 'invalid_datetime', message: `${field.label || field.sapField} must be a valid date and time.` });
    }
    return String(value);
  }

  if (type === 'CHECKBOX' || type === 'BOOLEAN') {
    const checked = normalizeCheckbox(value);
    if (checked === undefined) {
      addError(errors, { field, path, code: 'invalid_checkbox', message: `${field.label || field.sapField} must be a yes/no value.` });
      return value;
    }
    return checked;
  }

  const normalized = text(value);
  const maxLength = Number(field.maxLength ?? field.maximumLength);
  if (Number.isInteger(maxLength) && maxLength >= 0 && normalized.length > maxLength) {
    addError(errors, { field, path, code: 'max_length', message: `${field.label || field.sapField} allows at most ${maxLength} characters.` });
  }

  if (type === 'SELECT') {
    const allowedValues = optionValues(field);
    if (!allowedValues.includes(normalized)) {
      addError(errors, { field, path, code: 'invalid_option', message: `${field.label || field.sapField} contains an invalid option value.` });
    }
  }
  return normalized;
};

const needsLookupValidation = (field) => {
  if (field.lookup?.source === 'sap-user-values' && field.lookup.allowFreeText) return false;
  const renderer = upper(field.renderer);
  const type = upper(field.type);
  return Boolean(field.lookup) || renderer === 'LOOKUP' || renderer === 'ITEM-LOOKUP' || type === 'LOOKUP';
};

const validateFieldSet = async ({
  fields,
  group,
  path,
  errors,
  schema,
  validateLookupValue,
  lineIndex,
}) => {
  const containers = normalizeContainers(group, fields, path, errors, { line: Number.isInteger(lineIndex) });
  const canonical = { values: {}, udf: {} };

  for (const field of fields) {
    const submitted = readSubmittedValue(field, containers, path, errors);
    let value = submitted.present ? submitted.value : field.defaultValue;
    const presentOrDefaulted = submitted.present || field.defaultValue !== undefined;

    if (submitted.present && !isFieldWritable(field) && !isEmptyValue(value) && !valuesEqual(value, field.defaultValue)) {
      addError(errors, {
        field,
        path: submitted.path,
        code: 'read_only',
        message: `${field.label || field.sapField} is read-only.`,
      });
    }

    const normalized = validatePrimitiveValue(field, value, submitted.path, errors);
    if (presentOrDefaulted || field.required) {
      const key = isUdfField(field) ? field.sapField : (field.stateKey || field.sapField);
      const target = isUdfField(field) ? canonical.udf : canonical.values;
      target[key] = normalized;
    }

    if (!isEmptyValue(normalized) && needsLookupValidation(field)) {
      const options = optionValues(field);
      if (options.length && !options.includes(String(normalized))) {
        addError(errors, {
          field,
          path: submitted.path,
          code: 'invalid_lookup_value',
          message: `${field.label || field.sapField} is not valid for the current company.`,
        });
      } else if (!options.length) {
        if (typeof validateLookupValue !== 'function') {
          addError(errors, {
            field,
            path: submitted.path,
            code: 'lookup_validation_unavailable',
            message: `Lookup validation is unavailable for ${field.label || field.sapField}.`,
          });
        } else {
          const result = await validateLookupValue({
            schema,
            field,
            value: normalized,
            record: canonical,
            scope: Number.isInteger(lineIndex) ? 'line' : 'header',
            lineIndex,
          });
          const valid = result === true || result?.valid === true;
          if (!valid) {
            addError(errors, {
              field,
              path: submitted.path,
              code: 'invalid_lookup_value',
              message: `${field.label || field.sapField} is not valid for the current company.`,
            });
          }
        }
      }
    }
  }

  return {
    ...canonical,
    ...(Number.isInteger(lineIndex) ? { localLineId: containers.localLineId || `line-${lineIndex + 1}` } : {}),
  };
};

const validateNewSalesOrderForm = async ({ schema, formData, validateLookupValue } = {}) => {
  if (!isPlainObject(schema)) {
    throw createHttpError(500, 'A current New Sales Order schema is required.', undefined, 'INVALID_SCHEMA');
  }
  if (!isPlainObject(formData)) {
    throw createHttpError(400, 'formData must be an object.', undefined, 'INVALID_FORM_DATA');
  }

  const { headerTable, lineTable } = resolveSchemaTables(schema);
  const headerFields = normalizeSchemaFields(schema, 'headerFields', headerTable);
  const lineFields = normalizeSchemaFields(schema, 'lineFields', lineTable);
  const errors = [];

  for (const key of Object.keys(formData)) {
    if (!['header', 'lines'].includes(key)) {
      addError(errors, { path: `formData.${key}`, code: 'unknown_field', message: `Unknown formData field ${key}.` });
    }
  }

  const lines = Array.isArray(formData.lines) ? formData.lines : [];
  if (!Array.isArray(formData.lines)) {
    addError(errors, { path: 'formData.lines', code: 'invalid_array', message: 'formData.lines must be an array.' });
  } else if (!lines.length) {
    addError(errors, { path: 'formData.lines', code: 'line_required', message: 'At least one document line is required.' });
  }

  const canonicalHeader = await validateFieldSet({
    fields: headerFields,
    group: formData.header,
    path: 'formData.header',
    errors,
    schema,
    validateLookupValue,
  });
  const canonicalLines = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    canonicalLines.push(await validateFieldSet({
      fields: lineFields,
      group: lines[lineIndex],
      path: `formData.lines[${lineIndex}]`,
      errors,
      schema,
      validateLookupValue,
      lineIndex,
    }));
  }

  return {
    valid: errors.length === 0,
    errors,
    canonicalFormData: {
      header: canonicalHeader,
      lines: canonicalLines,
    },
  };
};

const assertValidNewSalesOrderForm = async (options) => {
  const result = await validateNewSalesOrderForm(options);
  if (!result.valid) {
    const unavailable = result.errors.some((error) => error.code === 'lookup_validation_unavailable');
    throw createHttpError(
      unavailable ? 503 : 422,
      unavailable
        ? 'Current-company lookup validation is unavailable.'
        : 'New Sales Order dummy data failed validation.',
      { validationErrors: result.errors },
      unavailable ? 'LOOKUP_VALIDATION_UNAVAILABLE' : 'VALIDATION_FAILED',
    );
  }
  return result.canonicalFormData;
};

module.exports = {
  HEADER_TABLE,
  LINE_TABLE,
  assertValidNewSalesOrderForm,
  createHttpError,
  isEmptyValue,
  isUdfField,
  normalizeCheckbox,
  resolveSchemaTables,
  validateNewSalesOrderForm,
};
