const db = require('./dbService');
const { createTableColumnDetailsReader } = require('./salesDocumentDbCompatibility');
const {
  filterUdfMetadataRowsByPhysicalColumns,
  getPhysicalUdfKeyMap,
  loadUdfDefinitionsOrEmpty,
  normalizeUdfKey,
} = require('./udfMetadataUtils');

const getTableColumnDetails = createTableColumnDetailsReader({ database: db });

const safe = async (promise) => {
  try {
    const result = await promise;
    return result.recordset || [];
  } catch (_error) {
    // Logged, not hidden: a failing query would otherwise look like "no data".
    console.warn('[DB] query failed, returning no rows:', _error?.message || _error);
    return [];
  }
};

const getColumnSet = async (tableName) => {
  const rows = await getTableColumnDetails(tableName);
  return new Set(rows.map((row) => row.columnName));
};

const getPhysicalUdfColumns = async (tableName) => {
  const rows = await getTableColumnDetails(tableName);
  return rows
    .filter((row) => row.columnName.toUpperCase().startsWith('U_'))
    .map((row) => ({
      columnName: row.columnName,
      dataType: row.dataType,
      maxLength: row.maxLength,
    }))
    .filter((row) => row.columnName);
};

const TYPE_MAP = {
  A: 'text',
  M: 'textarea',
  N: 'number',
  D: 'date',
  B: 'number',
  S: 'select',
};

const SUBTYPE_MAP = {
  D: 'date',
  T: 'time',
  R: 'number',
  P: 'number',
  Q: 'number',
  S: 'number',
  '%': 'number',
  A: 'textarea',
};

const SQL_NUMBER_TYPES = new Set([
  'bigint',
  'decimal',
  'float',
  'int',
  'money',
  'numeric',
  'real',
  'smallint',
  'smallmoney',
  'tinyint',
]);

const SQL_DATE_TYPES = new Set([
  'date',
  'datetime',
  'datetime2',
  'datetimeoffset',
  'smalldatetime',
  'time',
]);

const YES_NO_VALUES = new Set(['y', 'n', 'yes', 'no', 'tYES'.toLowerCase(), 'tNO'.toLowerCase(), '1', '0']);

const isYesNoOptions = (options = []) => {
  const values = options.map((option) => String(option.value || '').trim().toLowerCase()).filter(Boolean);
  return values.length === 2 && values.every((value) => YES_NO_VALUES.has(value));
};

const getDefaultValue = (type, options, defaultValue) => {
  if (defaultValue !== undefined && defaultValue !== null) {
    return String(defaultValue);
  }

  if (type === 'select' && options.length > 0) return '';
  return '';
};

const mapType = (row, options) => {
  if (options.length > 0) return 'select';
  const typeId = String(row.TypeID || '').trim().toUpperCase();
  const subtypeId = String(row.SubType || row.SubTypeID || '').trim().toUpperCase();
  return SUBTYPE_MAP[subtypeId] || TYPE_MAP[typeId] || 'text';
};

const mapSqlType = (dataType, maxLength) => {
  const normalizedType = String(dataType || '').trim().toLowerCase();
  if (normalizedType === 'bit') return 'checkbox';
  if (SQL_NUMBER_TYPES.has(normalizedType)) return 'number';
  if (SQL_DATE_TYPES.has(normalizedType)) return 'date';
  if (Number(maxLength) < 0 || Number(maxLength) > 254) return 'textarea';
  return 'text';
};

const getUdfDefinitions = async (tableId) => {
  const normalizedTableId = String(tableId || '').trim();
  if (!normalizedTableId) return [];

  const [cufdColumns, physicalColumns] = await Promise.all([
    getColumnSet('CUFD'),
    getPhysicalUdfColumns(normalizedTableId),
  ]);
  // SAP names the structure column EditType and the linked table RTable.
  const selectSubType = cufdColumns.has('SubType') ? 'T0.SubType'
    : cufdColumns.has('EditType') ? 'T0.EditType AS SubType' : "'' AS SubType";
  const selectMandatoryAlt = cufdColumns.has('Mandatory') ? 'T0.Mandatory AS MandatoryAlt' : "'' AS MandatoryAlt";
  const selectEditable = cufdColumns.has('Editable') ? 'T0.Editable' : "'' AS Editable";
  const selectLinkedTable = cufdColumns.has('LinkedTable') ? 'T0.LinkedTable'
    : cufdColumns.has('RTable') ? 'T0.RTable AS LinkedTable' : "'' AS LinkedTable";

  const rows = await safe(db.query(`
    SELECT
      T0.TableID,
      T0.FieldID,
      T0.AliasID,
      T0.Descr,
      T0.TypeID,
      ${selectSubType},
      T0.EditSize,
      T0.NotNull AS Mandatory,
      ${selectMandatoryAlt},
      ${selectEditable},
      ${selectLinkedTable},
      T0.Dflt,
      T1.FldValue,
      T1.Descr AS ValueDescr
    FROM CUFD T0
    LEFT JOIN UFD1 T1
      ON T1.TableID = T0.TableID
     AND T1.FieldID = T0.FieldID
    WHERE T0.TableID = @tableId
    ORDER BY T0.FieldID, T1.IndexID
  `, { tableId: normalizedTableId }));

  const physicalKeyByNormalized = getPhysicalUdfKeyMap(physicalColumns);
  const physicalColumnByKey = new Map(
    physicalColumns.map((column) => [normalizeUdfKey(column.columnName).toUpperCase(), column]),
  );
  const liveRows = filterUdfMetadataRowsByPhysicalColumns(rows, physicalColumns);
  const byKey = new Map();
  const normalizedKeys = new Set();

  liveRows.forEach((row) => {
    const metadataKey = normalizeUdfKey(row.AliasID);
    const key = physicalKeyByNormalized.get(metadataKey.toUpperCase());
    if (!key) return;

    if (!byKey.has(key)) {
      normalizedKeys.add(key.toUpperCase());
      const physicalColumn = physicalColumnByKey.get(key.toUpperCase());
      // SAP's own CUFD type decides this. Typing every user-defined field as
      // text made normalizeUdfValue apply a character-length check, using
      // CUFD.EditSize, to numeric and date fields — which silently dropped a
      // value such as 1250.750000 from the payload.
      const resolvedType = mapType(row, [])
        || (physicalColumn ? mapSqlType(physicalColumn.dataType, physicalColumn.maxLength) : 'text');
      byKey.set(key, {
        key,
        label: row.Descr || key,
        type: resolvedType,
        defaultValue: '',
        required: [row.Mandatory, row.MandatoryAlt].some((value) => String(value || '').toUpperCase() === 'Y'),
        readOnly: String(row.Editable || '').toUpperCase() === 'N',
        maxLength: row.EditSize || undefined,
        options: [],
        lookupTable: String(row.LinkedTable || '').trim() || undefined,
        lookupSource: String(row.LinkedTable || '').trim()
          ? `udf:${normalizedTableId}:${key}`
          : undefined,
      });
    }

    if (row.FldValue != null && String(row.FldValue).trim() !== '') {
      const definition = byKey.get(key);
      definition.options.push({
        value: String(row.FldValue),
        label: row.ValueDescr || String(row.FldValue),
      });
      // A numeric or date field with valid values keeps its own type, so it
      // stays exempt from the text length check.
      if (['text', 'textarea'].includes(definition.type)) definition.type = 'select';
    }
  });

  physicalColumns.forEach((column) => {
    const key = normalizeUdfKey(column.columnName);
    const normalizedKey = key.toUpperCase();
    if (!key || normalizedKeys.has(normalizedKey)) return;

    normalizedKeys.add(normalizedKey);
    byKey.set(key, {
      key,
      label: key,
      type: mapSqlType(column.dataType, column.maxLength),
      defaultValue: '',
      required: false,
      readOnly: false,
      maxLength: column.maxLength && Number(column.maxLength) > 0 ? column.maxLength : undefined,
      options: [],
      tableId: normalizedTableId,
      fieldId: undefined,
      aliasId: key.replace(/^U_/, ''),
      sapField: key,
    });
  });

  // Local formula/validation rules; LocalUdfRule exists only in local companies, so elsewhere this is empty.
  const rules = await safe(db.query('SELECT AliasID, Formula, Validation, Message FROM LocalUdfRule WHERE TableID = @tableId', { tableId: normalizedTableId }));
  const ruleByKey = new Map(rules.map((rule) => [normalizeUdfKey(rule.AliasID).toUpperCase(), rule]));
  const withRule = (field) => {
    const rule = ruleByKey.get(field.key.toUpperCase());
    if (!rule) return field;
    return {
      ...field,
      formula: rule.Formula || undefined,
      validation: rule.Validation || undefined,
      validationMessage: rule.Message || undefined,
      // A calculated field is filled on save, not typed.
      readOnly: field.readOnly || Boolean(rule.Formula),
    };
  };

  return Array.from(byKey.values()).map((field) => {
    const sourceRow = liveRows.find(
      (row) => normalizeUdfKey(row.AliasID).toUpperCase() === field.key.toUpperCase(),
    ) || {};
    if (!sourceRow.AliasID) return withRule(field);

    const type = mapType(sourceRow, field.options);

    return withRule({
      ...field,
      type,
      defaultValue: getDefaultValue(type, field.options, sourceRow.Dflt),
      tableId: sourceRow.TableID || undefined,
      fieldId: sourceRow.FieldID,
      aliasId: sourceRow.AliasID || field.key.replace(/^U_/, ''),
      sapField: field.key,
      lookupTable: String(sourceRow.LinkedTable || '').trim() || undefined,
      lookupSource: String(sourceRow.LinkedTable || '').trim()
        ? `udf:${sourceRow.TableID || normalizedTableId}:${field.key}`
        : field.lookupSource,
    });
  });
};

const getUdfDefinitionsOrEmpty = async (
  tableId,
  { getDefinitions = getUdfDefinitions, logger = console } = {},
) => loadUdfDefinitionsOrEmpty(tableId, { getDefinitions, logger });

const getMarketingDocumentUdfs = async ({ headerTable, lineTable }) => {
  const [header, rows] = await Promise.all([
    getUdfDefinitions(headerTable),
    getUdfDefinitions(lineTable),
  ]);

  return { header, rows };
};

const toColumnName = (key) => String(key || '').replace(/]/g, ']]');
const toTableName = (key) => `[${toColumnName(key)}]`;

const formatValue = (value) => {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return value == null ? '' : String(value);
};

const getHeaderUdfValues = async ({ tableId, keyColumn = 'DocEntry', keyValue }) => {
  const definitions = await getUdfDefinitions(tableId);
  if (!definitions.length) return {};

  const selectList = definitions.map((field) => `[${toColumnName(field.key)}]`).join(', ');
  const rows = await safe(db.query(`
    SELECT ${selectList}
    FROM ${toTableName(tableId)}
    WHERE ${toTableName(keyColumn)} = @keyValue
  `, { keyValue }));

  const row = rows[0] || {};
  return definitions.reduce((acc, field) => {
    acc[field.key] = formatValue(row[field.key]);
    return acc;
  }, {});
};

const getLineUdfValues = async ({ tableId, keyColumn = 'DocEntry', keyValue }) => {
  const definitions = await getUdfDefinitions(tableId);
  if (!definitions.length) return {};

  const selectList = definitions.map((field) => `[${toColumnName(field.key)}]`).join(', ');
  const rows = await safe(db.query(`
    SELECT LineNum, ${selectList}
    FROM ${toTableName(tableId)}
    WHERE ${toTableName(keyColumn)} = @keyValue
  `, { keyValue }));

  return rows.reduce((acc, row) => {
    acc[row.LineNum] = definitions.reduce((values, field) => {
      values[field.key] = formatValue(row[field.key]);
      return values;
    }, {});
    return acc;
  }, {});
};

module.exports = {
  filterUdfMetadataRowsByPhysicalColumns,
  getMarketingDocumentUdfs,
  getUdfDefinitions,
  getUdfDefinitionsOrEmpty,
  getHeaderUdfValues,
  getLineUdfValues,
};
