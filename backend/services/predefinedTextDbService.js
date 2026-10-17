const db = require('./dbService');

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

const escapeLike = (value) => String(value || '').replace(/[%_[\]]/g, (match) => `[${match}]`);

const TEXT_CODE_INVALID_PATTERN = /[*{}%!\^=<>?|]/;

const mapPredefinedTextRow = (row = {}) => {
  const code = String(row.TextCode || row.code || '').trim();
  const text = String(row.Text || row.text || '').trim();

  return {
    code,
    text,
    value: text,
    description: code,
    label: code && text ? `${code} - ${text}` : text || code,
  };
};

const getPredefinedTexts = async (query = '') => {
  const normalizedQuery = String(query || '').trim();

  const rows = await safe(db.query(`
    SELECT TOP 500
      LTRIM(RTRIM(CAST(TextCode AS NVARCHAR(20)))) AS TextCode,
      LTRIM(RTRIM(CAST([Text] AS NVARCHAR(5000)))) AS [Text]
    FROM OPDT
    WHERE @query = ''
      OR TextCode LIKE @queryLike
      OR CAST([Text] AS NVARCHAR(5000)) LIKE @queryLike
    ORDER BY TextCode
  `, {
    query: normalizedQuery,
    queryLike: `%${escapeLike(normalizedQuery)}%`,
  }));

  return rows.map(mapPredefinedTextRow);
};

const validateTextCode = (textCode) => {
  const normalizedTextCode = String(textCode || '').trim();

  if (!normalizedTextCode) {
    throw new Error('Text Code is required.');
  }

  if (normalizedTextCode.length > 20) {
    throw new Error('Text Code cannot exceed 20 characters.');
  }

  if (TEXT_CODE_INVALID_PATTERN.test(normalizedTextCode)) {
    throw new Error('Text Code contains characters that SAP does not allow.');
  }

  return normalizedTextCode;
};

const createPredefinedText = async ({ textCode, text }) => {
  const normalizedTextCode = validateTextCode(textCode);
  const normalizedText = String(text || '').trim();

  if (!normalizedText) {
    throw new Error('Text is required.');
  }

  const existingRows = await db.query(`
    SELECT TOP 1
      LTRIM(RTRIM(CAST(TextCode AS NVARCHAR(20)))) AS TextCode,
      LTRIM(RTRIM(CAST([Text] AS NVARCHAR(5000)))) AS [Text]
    FROM OPDT
    WHERE UPPER(LTRIM(RTRIM(TextCode))) = @textCode
  `, {
    textCode: normalizedTextCode.toUpperCase(),
  });

  const existing = existingRows.recordset?.[0];
  if (existing) {
    return mapPredefinedTextRow(existing);
  }

  const nextRows = await db.query(`
    SELECT ISNULL(MAX(AbsEntry), 0) + 1 AS NextAbsEntry
    FROM OPDT
  `);
  const nextAbsEntry = Number(nextRows.recordset?.[0]?.NextAbsEntry || 1);

  await db.query(`
    INSERT INTO OPDT (AbsEntry, TextCode, [Text])
    VALUES (@nextAbsEntry, @textCode, @text)
  `, {
    nextAbsEntry,
  });

  const insertedRows = await db.query(`
    SELECT
      LTRIM(RTRIM(CAST(TextCode AS NVARCHAR(20)))) AS TextCode,
      LTRIM(RTRIM(CAST([Text] AS NVARCHAR(5000)))) AS [Text]
    FROM OPDT
    WHERE AbsEntry = @nextAbsEntry
  `, {
    nextAbsEntry,
    textCode: normalizedTextCode,
    text: normalizedText,
  });

  return mapPredefinedTextRow(insertedRows.recordset?.[0] || {
    TextCode: normalizedTextCode,
    Text: normalizedText,
  });
};

module.exports = {
  createPredefinedText,
  getPredefinedTexts,
};
