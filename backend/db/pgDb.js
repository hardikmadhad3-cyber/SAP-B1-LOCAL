/**
 * PostgreSQL adapter. The app's SQL is written in T-SQL; hanaDb already turns
 * that into quoted-identifier ANSI SQL, so this file only bridges the last
 * HANA -> PostgreSQL gap and returns the same { recordset, rowsAffected } shape
 * as the mssql driver.
 */
const { Pool, types } = require('pg');
const env = require('../config/env');
const hanaDb = require('./hanaDb');

// mssql returns numbers and UTC-midnight dates; match it so callers never see
// a difference. Precision guard comes from hanaDb (huge DECIMALs stay text).
[20, 1700].forEach((oid) => types.setTypeParser(oid, hanaDb.normalizeNumericValue));
types.setTypeParser(1082, (value) => new Date(`${value}T00:00:00.000Z`));
types.setTypeParser(1114, (value) => new Date(`${value.replace(' ', 'T')}Z`));

const TYPE_NAMES = {
  16: 'bit', 20: 'bigint', 21: 'smallint', 23: 'int', 25: 'text', 700: 'real', 701: 'float',
  1042: 'char', 1043: 'nvarchar', 1082: 'date', 1114: 'datetime', 1184: 'datetime', 1700: 'decimal',
};

// Words left unquoted after translation. Anything else that looks like an
// identifier is quoted so SAP's mixed/upper case names survive PostgreSQL's
// lower-case folding. An unlisted keyword fails loudly as a syntax error.
const KEYWORDS = new Set(`
  ALL AND ANY AS ASC BETWEEN BIGINT BOOLEAN BY CASCADE CASE CAST CHAR COLLATE COLUMN CONSTRAINT
  CONFLICT CREATE CROSS CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER DATE DECIMAL DEFAULT DELETE
  DESC DISTINCT DO DOUBLE DROP ELSE END ESCAPE EXCEPT EXISTS EXTRACT FALSE FETCH FILTER FIRST FLOAT FOR
  FOREIGN FROM FULL GROUP HAVING IF ILIKE IN INDEX INNER INSERT INT INTEGER INTERSECT INTERVAL INTO IS
  JOIN KEY LAST LATERAL LEFT LIKE LIMIT NEXT NOT NOTHING NULL NULLS NUMERIC OFFSET ON ONLY OR ORDER
  OUTER OVER PARTITION PRECISION PRIMARY RECURSIVE REFERENCES RETURNING RIGHT ROW ROWS SELECT SET
  SMALLINT TABLE TEXT THEN TIME TIMESTAMP TO TRUE UNION UNIQUE UPDATE USING VALUES VARCHAR VARYING
  VIEW WHEN WHERE WINDOW WITH WITHOUT ZONE UNBOUNDED PRECEDING FOLLOWING CURRENT
  YEAR MONTH DAY HOUR MINUTE SECOND QUARTER WEEK DOW
`.trim().split(/\s+/));

const FUNCTION_PRECEDING_EXCEPTIONS = /\b(INTO|TABLE|REFERENCES|ON|UPDATE)\s*$/i;
// Built-in functions stay functions even right after those words, e.g. a join
// condition `JOIN x ON LOWER(...)` (the exception is for `INDEX i ON Table(col)`).
const SQL_FUNCTIONS = new Set(`
  ABS AVG CAST CEILING COALESCE CONCAT COUNT DATE EXISTS FLOOR GREATEST LEAST LEFT LENGTH LOWER LTRIM MAX MIN
  NOT NULLIF POSITION REPLACE RIGHT ROUND RTRIM SUBSTRING SUM TRIM UPPER
`.trim().split(/\s+/));

// Walks strings, quoted identifiers and words in one pass.
const TOKEN = /'(?:[^']|'')*'|"(?:[^"]|"")*"|@[A-Za-z_][A-Za-z0-9_]*|\b[A-Za-z_][A-Za-z0-9_$]*\b/g;

const quoteRemainingIdentifiers = (sql) => sql.replace(TOKEN, (token, offset, full) => {
  if (!/^[A-Za-z_]/.test(token)) return token; // string, "ident" or @param
  const next = full.slice(offset + token.length);
  if (token === 'N' && next.startsWith("'")) return ''; // N'text' -> 'text'
  if (full[offset - 1] === '.') return `"${token}"`; // alias.column
  if (KEYWORDS.has(token.toUpperCase())) return token;
  if (/^\s*\(/.test(next) && (SQL_FUNCTIONS.has(token.toUpperCase()) || !FUNCTION_PRECEDING_EXCEPTIONS.test(full.slice(0, offset)))) return token; // function call
  return `"${token}"`;
});

// T-SQL `OUTPUT INSERTED.x, INSERTED.y` -> trailing `RETURNING x, y`.
const moveOutputToReturning = (sql) => {
  const match = sql.match(/\bOUTPUT\s+((?:INSERTED|DELETED)\.[\s\S]*?)(?=\s+(?:VALUES|SELECT|WHERE|DEFAULT\s+VALUES)\b|\s*;?\s*$)/i);
  if (!match) return sql;
  const columns = match[1].replace(/\b(?:INSERTED|DELETED)\./gi, '');
  const without = (sql.slice(0, match.index) + sql.slice(match.index + match[0].length)).trimEnd().replace(/;$/, '');
  return `${without} RETURNING ${columns}`;
};

// Map INFORMATION_SCHEMA to PostgreSQL's own, scoped to the company schema and
// reporting SQL Server type names (callers compare DATA_TYPE to 'nvarchar' etc).
const INFORMATION_SCHEMA_COLUMNS = `(SELECT 'dbo' AS "TABLE_SCHEMA", table_name AS "TABLE_NAME",
  column_name AS "COLUMN_NAME",
  CASE data_type WHEN 'character varying' THEN 'nvarchar' WHEN 'character' THEN 'nchar'
    WHEN 'numeric' THEN 'decimal' WHEN 'integer' THEN 'int' WHEN 'boolean' THEN 'bit'
    WHEN 'timestamp without time zone' THEN 'datetime' WHEN 'double precision' THEN 'float'
    ELSE data_type END AS "DATA_TYPE",
  character_maximum_length AS "CHARACTER_MAXIMUM_LENGTH", numeric_precision AS "NUMERIC_PRECISION",
  numeric_scale AS "NUMERIC_SCALE", is_nullable AS "IS_NULLABLE", ordinal_position AS "ORDINAL_POSITION"
  FROM information_schema.columns WHERE table_schema = current_schema())`;
const INFORMATION_SCHEMA_TABLES = `(SELECT 'dbo' AS "TABLE_SCHEMA", table_name AS "TABLE_NAME",
  table_type AS "TABLE_TYPE" FROM information_schema.tables WHERE table_schema = current_schema())`;

const replaceInformationSchema = (sql) => outsideStrings(sql, (part) => part
  .replace(/(?:\[INFORMATION_SCHEMA\]|"INFORMATION_SCHEMA"|\bINFORMATION_SCHEMA)\s*\.\s*(?:\[COLUMNS\]|"COLUMNS"|COLUMNS\b)/gi, '__PG_INFO_COLUMNS__')
  .replace(/(?:\[INFORMATION_SCHEMA\]|"INFORMATION_SCHEMA"|\bINFORMATION_SCHEMA)\s*\.\s*(?:\[TABLES\]|"TABLES"|TABLES\b)/gi, '__PG_INFO_TABLES__'));

const restoreInformationSchema = (sql) => sql
  .replace(/"?__PG_INFO_COLUMNS__"?/g, INFORMATION_SCHEMA_COLUMNS)
  .replace(/"?__PG_INFO_TABLES__"?/g, INFORMATION_SCHEMA_TABLES);

const DATE_PARTS = { YEAR: 'YEAR', MONTH: 'MONTH', DAYOFMONTH: 'DAY', DAY: 'DAY', QUARTER: 'QUARTER', WEEK: 'WEEK' };

// HANA spellings produced by hanaDb.normalizeSql -> PostgreSQL.
const outsideStrings = (sql, fn) => sql
  .split(/('(?:[^']|'')*')/)
  .map((part, index) => (index % 2 ? part : fn(part)))
  .join('');

const hanaToPg = (sql) => {
  let out = outsideStrings(sql, (part) => part
    .replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
    .replace(/\bN?VARCHAR\s*\(\s*(?:MAX|5000)\s*\)/gi, 'TEXT')
    .replace(/\bNVARCHAR\b/gi, 'VARCHAR')
    .replace(/\bNCHAR\b/gi, 'CHAR')
    .replace(/\bDATETIME2?\b/gi, 'TIMESTAMP')
    .replace(/\bSECONDDATE\b/gi, 'TIMESTAMP')
    .replace(/"?\bLIKE_REGEXPR\b"?/gi, '~'));
  out = hanaDb.replaceFunctionCalls(out, 'TO_VARCHAR', (args) => (
    args.length > 1 ? `TO_CHAR(${args.join(', ')})` : `CAST(${args[0]} AS TEXT)`));
  out = hanaDb.replaceFunctionCalls(out, 'DAYS_BETWEEN', (args, original) => (
    args.length === 2 ? `(CAST(${args[1]} AS DATE) - CAST(${args[0]} AS DATE))` : original));
  Object.entries(DATE_PARTS).forEach(([fn, part]) => {
    out = hanaDb.replaceFunctionCalls(out, fn, (args, original) => (
      args.length === 1 ? `CAST(EXTRACT(${part} FROM ${args[0]}) AS INTEGER)` : original));
  });
  return out;
};

// Each SELECT owns its TOP: a CTE's cap belongs before its closing parenthesis.
const rewriteTop = (sql) => {
  const tokens = [...sql.matchAll(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|\[[^\]]*\]|\bSELECT\s+TOP\s*(?:\(\s*(?:\d+|@\w+)\s*\)|(?:\d+|@\w+))\s*|[();]|\bLIMIT\b/gi)];
  let depth = 0;
  const edits = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i][0];
    if (token === '(') depth++;
    else if (token === ')') depth--;
    else if (/^SELECT\s+TOP\b/i.test(token)) {
      const cap = token.match(/TOP\s*\(?\s*(\d+|@\w+)/i)[1];
      let cursorDepth = depth, end = sql.length, hasLimit = false;
      for (let j = i + 1; j < tokens.length; j++) {
        const next = tokens[j][0];
        if (next === '(') cursorDepth++;
        if ((next === ')' && cursorDepth === depth) || (next === ';' && cursorDepth === depth)) {
          end = tokens[j].index;
          break;
        }
        if (next === ')') cursorDepth--;
        if (/^LIMIT$/i.test(next) && cursorDepth === depth) hasLimit = true;
      }
      edits.push({ start: tokens[i].index, end: tokens[i].index + token.length, value: 'SELECT ' });
      if (!hasLimit) edits.push({ start: end, end, value: ` LIMIT ${cap} ` });
    }
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) sql = sql.slice(0, edit.start) + edit.value + sql.slice(edit.end);
  return sql;
};

const translateSql = (sqlText) => {
  let sql = rewriteTop(moveOutputToReturning(String(sqlText || '')));
  sql = replaceInformationSchema(sql);
  sql = hanaDb.normalizeSql(sql);
  // HANA treats SET after UPDATE as a table name in PostgreSQL upserts.
  sql = outsideStrings(sql, (part) => part.replace(/\bDO\s+UPDATE\s+"SET"/gi, 'DO UPDATE SET'));
  sql = outsideStrings(sql, (part) => part.replace(/\bROWS\s+BETWEEN\s+"UNBOUNDED"\s+"PRECEDING"\s+AND\s+"CURRENT"\s+ROW/gi, 'ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW'));
  sql = quoteRemainingIdentifiers(sql);
  sql = restoreInformationSchema(sql);
  return hanaToPg(sql);
};

// @name -> $n (a repeated name reuses its slot). `@name IS [NOT] NULL` is
// folded to TRUE/FALSE from the value, since PostgreSQL cannot type a bare
// `$1 IS NULL` ("could not determine data type of parameter").
const bindParams = (sqlText, params = {}) => {
  const values = [];
  const slots = new Map();
  // Strings and "quoted identifiers" pass through untouched: SAP user tables are
  // named "@TABLE", which is not a parameter.
  const sql = sqlText.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|@([A-Za-z_][A-Za-z0-9_]*)(\s+IS\s+(NOT\s+)?NULL\b)?/gi, (token, name, isNullTest, not) => {
    if (!name) return token;
    if (isNullTest) return (params[name] == null) !== Boolean(not) ? 'TRUE' : 'FALSE';
    if (!slots.has(name)) {
      values.push(params[name] === undefined ? null : params[name]);
      slots.set(name, values.length);
    }
    return `$${slots.get(name)}`;
  });
  return { sql, values };
};

// One pool per company schema; search_path is set on connect, so a query
// needs no extra round trip.
const pools = new Map();

const getPool = (schema = '') => {
  if (pools.has(schema)) return pools.get(schema);
  if (schema && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema) || schema.length > 63)) throw new Error('Invalid PostgreSQL schema name.');
  if (!env.databaseUrl) throw new Error('DATABASE_URL is not configured for PostgreSQL access.');
  const pool = new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30000,
    ...(schema ? { options: `-c search_path=${schema}` } : {}),
  });
  pool.on('error', (error) => console.error('[DB] PostgreSQL idle client error:', error.message));
  pools.set(schema, pool);
  return pool;
};

const buildColumns = (fields = []) => Object.fromEntries(fields.map((field, index) => {
  const typeName = TYPE_NAMES[field.dataTypeID] || 'text';
  return [field.name, { index, name: field.name, type: { name: typeName, declaration: typeName } }];
}));

const toMssqlShape = (result) => {
  const recordset = result.rows || [];
  Object.defineProperty(recordset, 'columns', { value: buildColumns(result.fields), enumerable: false });
  return { recordset, rowsAffected: [result.rowCount || 0] };
};

const query = async (queryStr, params = {}, options = {}) => {
  const { sql, values } = bindParams(translateSql(queryStr), params);
  const schema = String(options.connectionConfig?.database || options.database || '').trim();
  const result = await getPool(schema).query({
    text: sql,
    values,
    ...(Number(options.requestTimeout) > 0 ? { query_timeout: Number(options.requestTimeout) } : {}),
  });
  return toMssqlShape(result);
};

// For local writes (Phase 3): run several statements on one connection.
const transaction = async (schema, callback) => {
  const client = await getPool(schema).connect();
  const run = async (queryStr, params = {}) => {
    const { sql, values } = bindParams(translateSql(queryStr), params);
    return toMssqlShape(await client.query(sql, values));
  };
  try {
    await client.query('BEGIN');
    const result = await callback(run);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const closeAll = async () => {
  await Promise.all([...pools.values()].map((pool) => pool.end()));
  pools.clear();
};

module.exports = { bindParams, closeAll, getPool, query, transaction, translateSql };
