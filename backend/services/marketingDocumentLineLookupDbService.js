const db = require('./dbService');
const { createTableFieldMetadataReader } = require('./salesDocumentDbCompatibility');

const safe = async (promise) => {
  try {
    const result = await promise;
    return result.recordset || [];
  } catch (error) {
    // Logged, not hidden: a failing query would otherwise look like "no data".
    console.warn('[DB] query failed, returning no rows:', error?.message || error);
    return [];
  }
};

const LOOKUP_UDF_CONFIG = {
  U_Buyer_Quality: { aliasId: 'Buyer_Quality', columnName: 'U_Buyer_Quality' },
  U_Seller_Quality: { aliasId: 'Seller_Quality', columnName: 'U_Seller_Quality' },
  U_Buyer_Price: { aliasId: 'Buyer_Price', columnName: 'U_Buyer_Price' },
  U_Seller_Price: { aliasId: 'Seller_Price', columnName: 'U_Seller_Price' },
};

const getTableFieldMetadata = createTableFieldMetadataReader({ database: db });
const quoteSqlIdentifier = (identifier) => `[${String(identifier || '').replace(/]/g, ']]')}]`;

const normalizeLookupAlias = (aliasId) => {
  const normalized = String(aliasId || '').trim();
  if (!normalized) return '';
  if (LOOKUP_UDF_CONFIG[normalized]) return normalized;

  const prefixed = normalized.startsWith('U_') ? normalized : `U_${normalized}`;
  if (LOOKUP_UDF_CONFIG[prefixed]) return prefixed;

  const byAliasId = Object.entries(LOOKUP_UDF_CONFIG).find(([, config]) => (
    String(config.aliasId || '').toLowerCase() === normalized.replace(/^U_/, '').toLowerCase()
  ));

  return byAliasId ? byAliasId[0] : '';
};

const normalizeLineTable = (lineTable) => {
  const normalized = String(lineTable || '').trim().toUpperCase();
  if (!['RDR1', 'QUT1'].includes(normalized)) {
    throw new Error('Unsupported marketing document lookup table.');
  }
  return normalized;
};

const mapLookupRows = (rows = []) => {
  const seen = new Set();
  const options = [];

  rows.forEach((row) => {
    const rawValue = row?.Value ?? row?.FldValue ?? '';
    const rawDescription = row?.Description ?? row?.Descr ?? '';
    const description = String(rawDescription || '').trim();
    const value = String(rawValue || description || '').trim();

    if (!value) return;

    const normalized = value.toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);

    options.push({
      value,
      description,
      label: description && description !== value ? `${value} - ${description}` : value,
    });
  });

  return options;
};

const getUdfValidValues = (lineTable, aliasId) => safe(db.query(`
  SELECT
    LTRIM(RTRIM(ISNULL(T1.FldValue, ''))) AS Value,
    LTRIM(RTRIM(ISNULL(T1.Descr, ''))) AS Description,
    T1.IndexID
  FROM CUFD T0
  INNER JOIN UFD1 T1
    ON T0.TableID = T1.TableID
   AND T0.FieldID = T1.FieldID
  WHERE T0.TableID = @lineTable
    AND (T0.AliasID = @aliasId OR CONCAT('U_', T0.AliasID) = @aliasId)
  ORDER BY T1.IndexID, T1.FldValue
`, { lineTable, aliasId }));

const getExistingLookupValues = async (lineTable, aliasId) => {
  const normalizedAlias = normalizeLookupAlias(aliasId);
  const config = LOOKUP_UDF_CONFIG[normalizedAlias];
  if (!config) return [];

  const fieldMetadata = await getTableFieldMetadata(lineTable);
  const columnName = Object.keys(fieldMetadata || {}).find(
    (fieldName) => fieldName.toLowerCase() === config.columnName.toLowerCase()
  );
  if (!columnName) return [];
  const quotedColumnName = quoteSqlIdentifier(columnName);

  return safe(db.query(`
    SELECT DISTINCT
      LTRIM(RTRIM(CAST(${quotedColumnName} AS NVARCHAR(254)))) AS Value,
      '' AS Description
    FROM ${quoteSqlIdentifier(lineTable)}
    WHERE NULLIF(LTRIM(RTRIM(CAST(${quotedColumnName} AS NVARCHAR(254)))), '') IS NOT NULL
    ORDER BY Value
  `));
};

const getLookupValues = async (lineTable, aliasId) => {
  const normalizedTable = normalizeLineTable(lineTable);
  const normalizedAlias = normalizeLookupAlias(aliasId);
  const config = LOOKUP_UDF_CONFIG[normalizedAlias];
  if (!config) return [];

  const [validValues, existingValues] = await Promise.all([
    getUdfValidValues(normalizedTable, normalizedAlias),
    getExistingLookupValues(normalizedTable, normalizedAlias),
  ]);

  return mapLookupRows([...validValues, ...existingValues]);
};

const getLookupUdfDefinition = async (lineTable, aliasId) => {
  const normalizedTable = normalizeLineTable(lineTable);
  const normalizedAlias = normalizeLookupAlias(aliasId);
  const config = LOOKUP_UDF_CONFIG[normalizedAlias];
  if (!config) return null;

  const rows = await safe(db.query(`
    SELECT TOP 1 TableID, AliasID, FieldID, Descr
    FROM CUFD
    WHERE TableID = @lineTable
      AND AliasID = @aliasId
  `, {
    lineTable: normalizedTable,
    aliasId: config.aliasId,
  }));

  return rows[0] || null;
};

const createLookupValue = async (lineTable, aliasId, value, description = '') => {
  const normalizedTable = normalizeLineTable(lineTable);
  const normalizedAlias = normalizeLookupAlias(aliasId);
  const config = LOOKUP_UDF_CONFIG[normalizedAlias];
  if (!config) {
    throw new Error('Unsupported lookup field.');
  }

  const udfDefinition = await getLookupUdfDefinition(normalizedTable, normalizedAlias);
  if (!udfDefinition) {
    throw new Error(`SAP UDF definition not found for ${normalizedAlias} on ${normalizedTable}.`);
  }

  const normalizedValue = String(value || '').trim();
  const normalizedDescription = String(description || normalizedValue).trim();

  if (!normalizedValue) {
    throw new Error('Value is required.');
  }

  const existingRows = await safe(db.query(`
    SELECT TOP 1
      LTRIM(RTRIM(ISNULL(FldValue, ''))) AS Value,
      LTRIM(RTRIM(ISNULL(Descr, ''))) AS Description
    FROM UFD1
    WHERE TableID = @lineTable
      AND FieldID = @fieldId
      AND UPPER(LTRIM(RTRIM(ISNULL(FldValue, '')))) = @fieldValue
  `, {
    lineTable: normalizedTable,
    fieldId: udfDefinition.FieldID,
    fieldValue: normalizedValue.toUpperCase(),
  }));

  if (existingRows[0]) {
    return mapLookupRows(existingRows)[0];
  }

  const nextIndexRows = await db.query(`
    SELECT ISNULL(MAX(IndexID), -1) + 1 AS NextIndex
    FROM UFD1
    WHERE TableID = @lineTable
      AND FieldID = @fieldId
  `, {
    lineTable: normalizedTable,
    fieldId: udfDefinition.FieldID,
  });

  const nextIndex = Number(nextIndexRows.recordset?.[0]?.NextIndex ?? 0);

  await db.query(`
    INSERT INTO UFD1 (TableID, FieldID, IndexID, FldValue, Descr, FldDate)
    VALUES (@lineTable, @fieldId, @indexId, @fieldValue, @description, NULL)
  `, {
    lineTable: normalizedTable,
    fieldId: udfDefinition.FieldID,
    indexId: nextIndex,
    fieldValue: normalizedValue,
    description: normalizedDescription,
  });

  return mapLookupRows([{
    Value: normalizedValue,
    Description: normalizedDescription,
  }])[0];
};

const createMarketingDocumentLineLookupRepository = ({ lineTable }) => {
  const normalizedTable = normalizeLineTable(lineTable);

  return {
    getLookupValues: (aliasId) => getLookupValues(normalizedTable, aliasId),
    createLookupValue: (aliasId, value, description) =>
      createLookupValue(normalizedTable, aliasId, value, description),
  };
};

module.exports = {
  createMarketingDocumentLineLookupRepository,
  getLookupValues,
  createLookupValue,
  normalizeLookupAlias,
};
