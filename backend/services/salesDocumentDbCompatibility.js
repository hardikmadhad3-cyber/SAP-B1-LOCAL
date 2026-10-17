'use strict';

const SQLSERVER_TABLE_COLUMNS_SQL = `
  SELECT
    COLUMN_NAME AS columnName,
    DATA_TYPE AS dataType,
    CHARACTER_MAXIMUM_LENGTH AS maxLength,
    NUMERIC_PRECISION AS numericPrecision,
    NUMERIC_SCALE AS numericScale,
    IS_NULLABLE AS isNullable,
    ORDINAL_POSITION AS ordinalPosition
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME = @tableName
  ORDER BY ORDINAL_POSITION
`;

const HANA_TABLE_COLUMNS_SQL = `
  SELECT
    "COLUMN_NAME" AS "columnName",
    "DATA_TYPE_NAME" AS "dataType",
    "LENGTH" AS "maxLength",
    "LENGTH" AS "numericPrecision",
    "SCALE" AS "numericScale",
    "IS_NULLABLE" AS "isNullable",
    "POSITION" AS "ordinalPosition"
  FROM "SYS"."TABLE_COLUMNS"
  WHERE "SCHEMA_NAME" = CURRENT_SCHEMA
    AND "TABLE_NAME" = @tableName
  ORDER BY "POSITION"
`;

const normalizeDialect = (value) => (
  String(value || '').trim().toLowerCase() === 'hana' ? 'hana' : 'sqlserver'
);

const normalizeRecordset = (result) => {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.recordset)) return result.recordset;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
};

const rowValue = (row, ...keys) => {
  if (!row || typeof row !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    const match = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === String(key).toLowerCase(),
    );
    if (match) return row[match];
  }
  return undefined;
};

const normalizeSapTableName = (tableName) => {
  const normalized = String(tableName || '').trim().toUpperCase();
  if (!/^@?[A-Z0-9_]{1,127}$/.test(normalized)) {
    throw new TypeError('A valid SAP table name is required for metadata lookup.');
  }
  return normalized;
};

const resolveDatabaseScope = async (database) => {
  if (!database || typeof database.query !== 'function') {
    throw new TypeError('A database query service is required.');
  }

  const [databaseName, dialectValue, connectionConfig] = await Promise.all([
    typeof database.resolveDatabaseName === 'function'
      ? database.resolveDatabaseName()
      : '',
    typeof database.getDialect === 'function'
      ? database.getDialect()
      : 'sqlserver',
    typeof database.resolveSqlConnectionConfig === 'function'
      ? database.resolveSqlConnectionConfig()
      : null,
  ]);
  const normalizedDatabaseName = String(databaseName || '').trim();
  if (!normalizedDatabaseName) {
    throw new Error('The active company database could not be resolved.');
  }

  const dialect = normalizeDialect(dialectValue);
  const server = String(connectionConfig?.server || '').trim().toUpperCase();
  const instanceName = String(connectionConfig?.instanceName || '').trim().toUpperCase();
  const port = Number(connectionConfig?.port) || 0;
  const connectionIdentity = server
    ? `${server}:${instanceName}:${port}:`
    : '';
  return {
    databaseName: normalizedDatabaseName,
    dialect,
    cacheKey: `${dialect}:${connectionIdentity}${dialect === 'hana' ? normalizedDatabaseName : normalizedDatabaseName.toUpperCase()}`,
  };
};

const getTableColumnsSql = (dialect) => (
  normalizeDialect(dialect) === 'hana'
    ? HANA_TABLE_COLUMNS_SQL
    : SQLSERVER_TABLE_COLUMNS_SQL
);

const normalizeTableFieldMetadata = (rows = []) => rows.reduce((metadata, row) => {
  const columnName = String(rowValue(row, 'columnName', 'COLUMN_NAME') || '').trim();
  if (!columnName) return metadata;
  metadata[columnName] = String(
    rowValue(row, 'dataType', 'DATA_TYPE', 'DATA_TYPE_NAME') || '',
  ).trim().toLowerCase();
  return metadata;
}, {});

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeTableColumnDetails = (rows = []) => rows.map((row) => ({
  columnName: String(rowValue(row, 'columnName', 'COLUMN_NAME') || '').trim(),
  dataType: String(rowValue(row, 'dataType', 'DATA_TYPE', 'DATA_TYPE_NAME') || '').trim().toLowerCase(),
  maxLength: numberOrNull(rowValue(row, 'maxLength', 'CHARACTER_MAXIMUM_LENGTH', 'LENGTH')),
  numericPrecision: numberOrNull(rowValue(row, 'numericPrecision', 'NUMERIC_PRECISION', 'LENGTH')),
  numericScale: numberOrNull(rowValue(row, 'numericScale', 'NUMERIC_SCALE', 'SCALE')),
  nullable: ['YES', 'TRUE', 'Y', '1'].includes(
    String(rowValue(row, 'isNullable', 'IS_NULLABLE') || '').trim().toUpperCase(),
  ),
  ordinal: numberOrNull(rowValue(row, 'ordinalPosition', 'ORDINAL_POSITION', 'POSITION')) || 0,
})).filter((column) => column.columnName);

// Every column reader registers its cache so adding a user-defined field
// (a new U_ column) is visible everywhere without restarting the backend.
const columnCaches = new Set();
const clearTableColumnCaches = () => columnCaches.forEach((cache) => cache.clear());

const createTableColumnDetailsReader = ({ database, cache = new Map() } = {}) => {
  if (!database || typeof database.query !== 'function') {
    throw new TypeError('A database query service is required.');
  }
  columnCaches.add(cache);

  return async (tableName) => {
    const normalizedTableName = normalizeSapTableName(tableName);
    const scope = await resolveDatabaseScope(database);
    const cacheKey = `${scope.cacheKey}:${normalizedTableName}`;

    if (!cache.has(cacheKey)) {
      const pending = database.query(
        getTableColumnsSql(scope.dialect),
        { tableName: normalizedTableName },
      ).then(normalizeRecordset).then(normalizeTableColumnDetails);

      cache.set(cacheKey, pending);
      pending.catch(() => {
        if (cache.get(cacheKey) === pending) cache.delete(cacheKey);
      });
    }

    return cache.get(cacheKey);
  };
};

const createTableFieldMetadataReader = ({ database, cache = new Map() } = {}) => {
  if (!database || typeof database.query !== 'function') {
    throw new TypeError('A database query service is required.');
  }

  const readDetails = createTableColumnDetailsReader({ database, cache });
  return async (tableName) => normalizeTableFieldMetadata(await readDetails(tableName));
};

const LIKE_ESCAPE_CHARACTER = '!';
// Preserve physical casing: HANA quoted names and company UDFs are case-sensitive.
const findPhysicalColumnName = (columns, name) => Array.from(columns || []).find(
  (column) => String(column).toUpperCase() === String(name || '').toUpperCase(),
);

const selectPhysicalOptionalColumn = (columns, tableAlias, name, alias = name, fallback = 'NULL') => {
  const physicalName = findPhysicalColumnName(columns, name);
  const expression = physicalName
    ? `${tableAlias ? `${tableAlias}.` : ''}[${physicalName.replace(/]/g, ']]')}]`
    : fallback;
  return `${expression} AS [${String(alias).replace(/]/g, ']]')}]`;
};

const createPhysicalColumnSetReader = (database) => {
  const readDetails = createTableColumnDetailsReader({ database });
  return async (tableName) => new Set(
    (await readDetails(tableName)).map((column) => column.columnName),
  );
};

const escapeLikeValue = (value) => String(value || '').replace(
  /[!%_[\]]/g,
  (match) => `${LIKE_ESCAPE_CHARACTER}${match}`,
);

const LIKE_ESCAPE_SQL = `ESCAPE '${LIKE_ESCAPE_CHARACTER}'`;

module.exports = {
  clearTableColumnCaches,
  createPhysicalColumnSetReader,
  findPhysicalColumnName,
  selectPhysicalOptionalColumn,
  HANA_TABLE_COLUMNS_SQL,
  LIKE_ESCAPE_CHARACTER,
  LIKE_ESCAPE_SQL,
  SQLSERVER_TABLE_COLUMNS_SQL,
  createTableColumnDetailsReader,
  createTableFieldMetadataReader,
  escapeLikeValue,
  getTableColumnsSql,
  normalizeDialect,
  normalizeRecordset,
  normalizeSapTableName,
  normalizeTableFieldMetadata,
  normalizeTableColumnDetails,
  resolveDatabaseScope,
  rowValue,
};
