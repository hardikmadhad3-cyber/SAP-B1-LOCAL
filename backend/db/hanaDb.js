let hanaClient = null;

try {
  hanaClient = require('@sap/hana-client');
} catch (_error) {
  hanaClient = null;
}

const SQL_KEYWORDS = new Set([
  'ADD',
  'AND',
  'AS',
  'ASC',
  'BETWEEN',
  'BY',
  'CASE',
  'CAST',
  'COALESCE',
  'COUNT',
  'CURRENT_DATE',
  'CURRENT_TIMESTAMP',
  'DATE',
  'DECIMAL',
  'DESC',
  'DISTINCT',
  'ELSE',
  'END',
  'FROM',
  'GROUP',
  'IFNULL',
  'IN',
  'INNER',
  'INT',
  'INTEGER',
  'IS',
  'JOIN',
  'LEFT',
  'LENGTH',
  'LIKE',
  'LIKE_REGEXPR',
  'LIMIT',
  'LOWER',
  'MAX',
  'MIN',
  'NOT',
  'NULL',
  'NULLIF',
  'NVARCHAR',
  'ON',
  'OR',
  'ORDER',
  'OUTER',
  'RIGHT',
  'SELECT',
  'SET',
  'SUM',
  'THEN',
  'TO_VARCHAR',
  'UPPER',
  'VARCHAR',
  'WHEN',
  'WHERE',
]);

const isReadQuery = (sqlText) => /^\s*(SELECT|WITH)\b/i.test(sqlText);

const quoteIdentifier = (value) =>
  `"${String(value || '').replace(/"/g, '""')}"`;

const HANA_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HANA_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

const isIdentifierChar = (char = '') => /[A-Za-z0-9_]/.test(char);

const withSqlSegments = (sqlText, replacer) => {
  const parts = [];
  let current = '';
  let inString = false;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    current += char;

    if (char !== "'") {
      continue;
    }

    if (inString && sqlText[index + 1] === "'") {
      current += sqlText[index + 1];
      index += 1;
      continue;
    }

    if (inString) {
      parts.push({ text: current, string: true });
      current = '';
      inString = false;
    } else {
      if (current.slice(0, -1)) {
        parts.push({ text: current.slice(0, -1), string: false });
      }
      current = "'";
      inString = true;
    }
  }

  if (current) {
    parts.push({ text: current, string: inString });
  }

  return parts
    .map((part) => (part.string ? part.text : replacer(part.text)))
    .join('');
};

const findTopLevelPattern = (sqlText, matcher) => {
  let inString = false;
  let depth = 0;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];

    if (char === "'") {
      if (inString && sqlText[index + 1] === "'") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (inString) continue;
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;

    const match = matcher(sqlText.slice(index), index, sqlText);
    if (match) return { ...match, start: index, end: index + match.text.length };
  }

  return null;
};

const hasTopLevelKeyword = (sqlText, keyword) =>
  Boolean(findTopLevelPattern(sqlText, (rest, index, fullText) => {
    const pattern = new RegExp(`^${keyword}\\b`, 'i');
    if (!pattern.test(rest)) return null;
    const previous = fullText[index - 1] || '';
    if (isIdentifierChar(previous)) return null;
    const text = rest.match(pattern)[0];
    return { text };
  }));

const applyTopLimit = (sqlText) => {
  const match = findTopLevelPattern(sqlText, (rest, index, fullText) => {
    const previous = fullText[index - 1] || '';
    if (isIdentifierChar(previous)) return null;

    const topMatch = rest.match(/^SELECT\s+(DISTINCT\s+)?TOP\s*(?:\(\s*)?(@[A-Za-z_][A-Za-z0-9_]*|\d+)(?:\s*\))?\s+/i);
    if (!topMatch) return null;

    return {
      text: topMatch[0],
      distinct: topMatch[1] || '',
      limit: topMatch[2],
    };
  });

  if (!match) {
    return sqlText;
  }

  const sql = `${sqlText.slice(0, match.start)}SELECT ${match.distinct}${sqlText.slice(match.end)}`;
  if (hasTopLevelKeyword(sql, 'LIMIT')) {
    return sql;
  }

  const trimmed = sql.trimEnd();
  const suffix = trimmed.endsWith(';') ? ';' : '';
  const body = suffix ? trimmed.slice(0, -1).trimEnd() : trimmed;
  return `${body} LIMIT ${match.limit}${suffix}`;
};

const quoteAliasColumns = (sqlText) =>
  withSqlSegments(sqlText, (segment) =>
    segment.replace(/\b([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g, (match, alias, column) => {
      if (alias.toLowerCase() === 'dbo') return column;
      if (column === column.toUpperCase()) return match;
      return `${alias}.${quoteIdentifier(column)}`;
    }));

const quoteBareIdentifiers = (sqlText) =>
  withSqlSegments(sqlText, (segment) =>
    segment.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (match, word, offset, fullText) => {
      if (!/[a-z]/.test(word)) return match;
      if (SQL_KEYWORDS.has(word.toUpperCase())) return match;

      const previous = fullText[offset - 1] || '';
      const next = fullText[offset + word.length] || '';
      if (previous === '@' || previous === '.' || previous === '"' || next === '"') return match;
      if (next === '(') return match;

      return quoteIdentifier(word);
    }));

const quoteTables = (sqlText) =>
  withSqlSegments(sqlText, (segment) =>
    segment.replace(/\b(FROM|JOIN|UPDATE|INTO)\s+([A-Z][A-Z0-9_]{2,})\b/g, (_match, keyword, tableName) =>
      `${keyword} ${quoteIdentifier(tableName)}`));

const replaceInformationSchemaViews = (sqlText) =>
  withSqlSegments(sqlText, (segment) =>
    segment
      .replace(
        /\bINFORMATION_SCHEMA\.COLUMNS\b/gi,
        `(SELECT
          SCHEMA_NAME AS TABLE_SCHEMA,
          TABLE_NAME,
          COLUMN_NAME,
          DATA_TYPE_NAME AS DATA_TYPE,
          LENGTH AS CHARACTER_MAXIMUM_LENGTH,
          LENGTH AS NUMERIC_PRECISION,
          SCALE AS NUMERIC_SCALE,
          IS_NULLABLE,
          POSITION AS ORDINAL_POSITION
        FROM SYS.TABLE_COLUMNS
        WHERE SCHEMA_NAME = CURRENT_SCHEMA
        UNION ALL
        SELECT SCHEMA_NAME AS TABLE_SCHEMA, VIEW_NAME AS TABLE_NAME,
          COLUMN_NAME, DATA_TYPE_NAME AS DATA_TYPE,
          LENGTH AS CHARACTER_MAXIMUM_LENGTH, LENGTH AS NUMERIC_PRECISION,
          SCALE AS NUMERIC_SCALE, IS_NULLABLE, POSITION AS ORDINAL_POSITION
        FROM SYS.VIEW_COLUMNS
        WHERE SCHEMA_NAME = CURRENT_SCHEMA)`,
      )
      .replace(
        /\bINFORMATION_SCHEMA\.TABLES\b/gi,
        `(SELECT
          SCHEMA_NAME AS TABLE_SCHEMA,
          TABLE_NAME,
          TABLE_TYPE
        FROM SYS.TABLES
        WHERE SCHEMA_NAME = CURRENT_SCHEMA
        UNION ALL
        SELECT SCHEMA_NAME AS TABLE_SCHEMA, VIEW_NAME AS TABLE_NAME,
          'VIEW' AS TABLE_TYPE
        FROM SYS.VIEWS
        WHERE SCHEMA_NAME = CURRENT_SCHEMA)`,
      ));

const splitTopLevelArgs = (text) => {
  const args = [];
  let current = '';
  let inString = false;
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "'") {
      current += char;
      if (inString && text[index + 1] === "'") {
        current += text[index + 1];
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '(') depth += 1;
      if (char === ')') depth = Math.max(0, depth - 1);
      if (char === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) args.push(current.trim());
  return args;
};

const replaceFunctionCalls = (sqlText, functionName, replacer) => {
  let output = '';
  let index = 0;
  let inString = false;
  const functionPattern = new RegExp(`^${functionName}\\s*\\(`, 'i');

  while (index < sqlText.length) {
    const char = sqlText[index];

    if (char === "'") {
      output += char;
      if (inString && sqlText[index + 1] === "'") {
        output += sqlText[index + 1];
        index += 2;
        continue;
      }
      inString = !inString;
      index += 1;
      continue;
    }

    if (inString) {
      output += char;
      index += 1;
      continue;
    }

    const rest = sqlText.slice(index);
    const match = rest.match(functionPattern);
    const previous = sqlText[index - 1] || '';
    if (!match || isIdentifierChar(previous)) {
      output += char;
      index += 1;
      continue;
    }

    const openParen = index + match[0].lastIndexOf('(');
    let depth = 0;
    let nestedString = false;
    let closeParen = -1;

    for (let cursor = openParen; cursor < sqlText.length; cursor += 1) {
      const cursorChar = sqlText[cursor];
      if (cursorChar === "'") {
        if (nestedString && sqlText[cursor + 1] === "'") {
          cursor += 1;
          continue;
        }
        nestedString = !nestedString;
        continue;
      }
      if (nestedString) continue;
      if (cursorChar === '(') depth += 1;
      if (cursorChar === ')') {
        depth -= 1;
        if (depth === 0) {
          closeParen = cursor;
          break;
        }
      }
    }

    if (closeParen === -1) {
      output += char;
      index += 1;
      continue;
    }

    const original = sqlText.slice(index, closeParen + 1);
    const args = splitTopLevelArgs(sqlText.slice(openParen + 1, closeParen));
    output += replacer(args, original);
    index = closeParen + 1;
  }

  return output;
};

const normalizeConvertType = (typeText) => {
  const type = String(typeText || '').trim().replace(/\s+/g, ' ');
  const varcharMatch = type.match(/^N?VARCHAR\s*\(\s*(MAX|\d+)\s*\)$/i);
  if (varcharMatch) {
    return `NVARCHAR(${varcharMatch[1].toUpperCase() === 'MAX' ? 5000 : varcharMatch[1]})`;
  }
  if (/^N?VARCHAR$/i.test(type)) return 'NVARCHAR(5000)';
  if (/^INT$/i.test(type)) return 'INTEGER';
  return type.toUpperCase();
};

const replaceConvertCalls = (sqlText) =>
  replaceFunctionCalls(sqlText, 'CONVERT', (args, original) => {
    if (args.length < 2) return original;

    const targetType = normalizeConvertType(args[0]);
    const expression = replaceConvertCalls(args[1]);
    const style = String(args[2] || '').trim();

    if (style === '23') {
      return `TO_VARCHAR(CAST(${expression} AS DATE), 'YYYY-MM-DD')`;
    }
    if (style === '103') {
      return `TO_VARCHAR(CAST(${expression} AS DATE), 'DD/MM/YYYY')`;
    }

    return `CAST(${expression} AS ${targetType})`;
  });

const replaceDateDiffCalls = (sqlText) =>
  replaceFunctionCalls(sqlText, 'DATEDIFF', (args, original) => {
    if (args.length < 3) return original;

    const unit = String(args[0] || '').trim().toUpperCase();
    if (unit !== 'DAY' && unit !== 'DD' && unit !== 'D') return original;

    return `DAYS_BETWEEN(${args[1]}, ${args[2]})`;
  });

const replaceDatePartCalls = (sqlText) =>
  replaceFunctionCalls(sqlText, 'DATEPART', (args, original) => {
    if (args.length < 2) return original;

    const unit = String(args[0] || '').trim().toUpperCase();
    const expression = args[1];
    if (['YEAR', 'YYYY', 'YY'].includes(unit)) return `YEAR(${expression})`;
    if (['QUARTER', 'QQ', 'Q'].includes(unit)) return `QUARTER(${expression})`;
    if (['MONTH', 'MM', 'M'].includes(unit)) return `MONTH(${expression})`;
    if (['WEEK', 'WK', 'WW'].includes(unit)) return `WEEK(${expression})`;
    if (['DAY', 'DD', 'D'].includes(unit)) return `DAYOFMONTH(${expression})`;

    return original;
  });

const buildNestedConcat = (args) => {
  const normalizedArgs = args.map((arg) => replaceConcatCalls(arg));
  if (normalizedArgs.length <= 2) return `CONCAT(${normalizedArgs.join(', ')})`;
  return normalizedArgs
    .slice(1)
    .reduce((expression, arg) => `CONCAT(${expression}, ${arg})`, normalizedArgs[0]);
};

const replaceConcatCalls = (sqlText) => {
  let output = '';
  let index = 0;
  let inString = false;

  while (index < sqlText.length) {
    const char = sqlText[index];

    if (char === "'") {
      output += char;
      if (inString && sqlText[index + 1] === "'") {
        output += sqlText[index + 1];
        index += 2;
        continue;
      }
      inString = !inString;
      index += 1;
      continue;
    }

    if (inString) {
      output += char;
      index += 1;
      continue;
    }

    const rest = sqlText.slice(index);
    const match = rest.match(/^CONCAT\s*\(/i);
    const previous = sqlText[index - 1] || '';
    if (!match || isIdentifierChar(previous)) {
      output += char;
      index += 1;
      continue;
    }

    const openParen = index + match[0].length - 1;
    let depth = 0;
    let nestedString = false;
    let closeParen = -1;

    for (let cursor = openParen; cursor < sqlText.length; cursor += 1) {
      const cursorChar = sqlText[cursor];
      if (cursorChar === "'") {
        if (nestedString && sqlText[cursor + 1] === "'") {
          cursor += 1;
          continue;
        }
        nestedString = !nestedString;
        continue;
      }
      if (nestedString) continue;
      if (cursorChar === '(') depth += 1;
      if (cursorChar === ')') {
        depth -= 1;
        if (depth === 0) {
          closeParen = cursor;
          break;
        }
      }
    }

    if (closeParen === -1) {
      output += char;
      index += 1;
      continue;
    }

    const args = splitTopLevelArgs(sqlText.slice(openParen + 1, closeParen));
    output += buildNestedConcat(args);
    index = closeParen + 1;
  }

  return output;
};

const replaceIsNumericCalls = (sqlText) =>
  replaceFunctionCalls(sqlText, 'ISNUMERIC', (args, original) => {
    if (args.length !== 1) return original;
    return "(CASE WHEN CAST(" + args[0] + " AS NVARCHAR(5000)) LIKE_REGEXPR '^[+-]?[0-9]+([.][0-9]+)?$' THEN 1 ELSE 0 END)";
  });

const normalizeSql = (sqlText) => {
  let sql = String(sqlText || '')
    .replace(/\bdbo\./gi, '')
    .replace(/\[([^\]]+)\]/g, (_match, identifier) => quoteIdentifier(identifier))
    .replace(/\bSYSUTCDATETIME\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bGETDATE\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bCONVERT\s*\(\s*date\s*,\s*CURRENT_TIMESTAMP\s*\)/gi, 'CURRENT_DATE')
    .replace(/\bISNULL\s*\(/gi, 'IFNULL(')
    .replace(/\bLEN\s*\(/gi, 'LENGTH(')
    .replace(/\bOFFSET\s+(@[A-Za-z_][A-Za-z0-9_]*|\d+)\s+ROWS\s+FETCH\s+NEXT\s+(@[A-Za-z_][A-Za-z0-9_]*|\d+)\s+ROWS\s+ONLY/gi, 'LIMIT $2 OFFSET $1');

  sql = replaceInformationSchemaViews(sql);
  sql = replaceConvertCalls(sql);
  sql = replaceDateDiffCalls(sql);
  sql = replaceDatePartCalls(sql);
  sql = replaceConcatCalls(sql);
  sql = replaceIsNumericCalls(sql);
  sql = applyTopLimit(sql);
  sql = quoteAliasColumns(sql);
  sql = quoteTables(sql);
  sql = quoteBareIdentifiers(sql);
  return sql.trim();
};

const bindParams = (sqlText, params = {}) => {
  const values = [];
  const sql = withSqlSegments(sqlText, (segment) =>
    segment.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
      values.push(params[name]);
      return '?';
    }));

  return { sql, values };
};

const buildConnectionParams = (connectionConfig) => {
  const server = String(connectionConfig.server || '').trim();
  const port = Number(connectionConfig.port || 30015);
  const database = String(connectionConfig.database || '').trim();

  if (!server || !database || !connectionConfig.user) {
    throw new Error('No company database is configured for HANA access.');
  }

  const params = {
    serverNode: `${server}:${port}`,
    uid: connectionConfig.user,
    pwd: connectionConfig.password || '',
    currentSchema: database,
  };

  if (connectionConfig.encrypt) {
    params.encrypt = 'true';
    params.sslValidateCertificate = connectionConfig.trustServerCertificate ? 'false' : 'true';
  }

  return params;
};

// One pool per company connection, mirroring the SQL Server pool in dbService.
// Without this every metadata query paid a fresh TCP + authentication round
// trip, which is what pushed HANA companies past the schema-load timeout.
const POOL_MAX_SIZE = 10;
const POOL_IDLE_SECONDS = 300;
const POOL_WAIT_MS = 15000;
const pools = new Map();

// The password is part of the key so a rotated credential opens a new pool
// instead of reusing connections authenticated with the old one.
const getPoolKey = (params) => JSON.stringify([
  params.serverNode,
  params.uid,
  params.pwd,
  params.currentSchema,
  params.encrypt || '',
  params.sslValidateCertificate || '',
]);

const getPool = (params) => {
  const poolKey = getPoolKey(params);
  const existing = pools.get(poolKey);
  if (existing) return existing;

  // The explicit pool API rejects the implicit `pooling` connection property,
  // so sizing lives here and nowhere in the connection string. poolCapacity is
  // how many idle connections are retained; leaving it at its default of 0
  // would keep the pool from reusing anything at all.
  const pool = hanaClient.createPool(params, {
    poolCapacity: POOL_MAX_SIZE,
    maxConnectedOrPooled: POOL_MAX_SIZE * 2,
    maxPooledIdleTime: POOL_IDLE_SECONDS,
    pingCheck: true,
    maxWaitTimeoutIfPoolExhausted: POOL_WAIT_MS,
  });
  pools.set(poolKey, pool);
  console.log(`[DB] HANA pool created for ${params.serverNode}/${params.currentSchema}`);
  return pool;
};

const connect = (connectionConfig) => new Promise((resolve, reject) => {
  if (!hanaClient) {
    reject(new Error('SAP HANA client is not installed. Install @sap/hana-client in the backend package before using HANA companies.'));
    return;
  }

  const params = buildConnectionParams(connectionConfig);
  if (typeof hanaClient.createPool !== 'function') {
    const connection = hanaClient.createConnection();
    connection.connect(params, (error) => (error ? reject(error) : resolve(connection)));
    return;
  }

  getPool(params).getConnection((error, connection) => (error ? reject(error) : resolve(connection)));
});

const exec = (connection, sqlText, values = []) => new Promise((resolve, reject) => {
  connection.exec(sqlText, values, (error, rows) => {
    if (error) {
      reject(error);
      return;
    }

    resolve(Array.isArray(rows) ? rows : []);
  });
});

// mssql reports the shape of a result set on `recordset.columns`; the HANA
// driver only exposes it through a prepared statement. Callers that infer a
// column's type (published SQL Content layouts, for one) were falling back to
// guessing from the first row's JavaScript value, which typed every HANA
// DECIMAL as text and typed an empty result set as text across the board.
const execWithMetadata = (connection, sqlText, values = []) => new Promise((resolve, reject) => {
  connection.prepare(sqlText, (prepareError, statement) => {
    if (prepareError) {
      // SET SCHEMA and other session statements cannot be prepared.
      exec(connection, sqlText, values).then(
        (rows) => resolve({ rows, columns: [] }),
        reject,
      );
      return;
    }

    statement.exec(values, (execError, rows) => {
      let columns = [];
      try {
        columns = statement.getColumnInfo() || [];
      } catch (_error) {
        columns = [];
      }
      try {
        statement.drop();
      } catch (_error) {
        // A dropped statement must never mask the query's own outcome.
      }
      if (execError) {
        reject(execError);
        return;
      }
      resolve({ rows: Array.isArray(rows) ? rows : [], columns });
    });
  });
});

const normalizeDateValue = (value) => {
  if (typeof value !== 'string') return value;
  if (HANA_DATE_PATTERN.test(value)) return new Date(`${value}T00:00:00.000Z`);
  if (HANA_TIMESTAMP_PATTERN.test(value)) return new Date(`${value.replace(' ', 'T')}Z`);
  return value;
};

// The HANA driver hands back DECIMAL and BIGINT as strings to preserve
// precision, while mssql hands back JavaScript numbers. Aligning them keeps a
// company's Price, Quantity and total columns numeric on both platforms.
const HANA_NUMERIC_TYPE = /^(?:SMALL)?DECIMAL$|^(?:TINY|SMALL|BIG)?INT(?:EGER)?$|^REAL$|^DOUBLE$|^FLOAT$/i;
const NUMERIC_TEXT_PATTERN = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

const normalizeNumericValue = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!NUMERIC_TEXT_PATTERN.test(trimmed)) return value;
  const parsed = Number(trimmed);
  // A DECIMAL(38,x) can exceed what a double holds exactly. Keep the original
  // text in that case rather than silently rounding a company's figures.
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) return value;
  return parsed;
};

const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const buildColumnMetadata = (columnInfo = []) => {
  const columns = {};
  const numericColumns = new Set();

  (Array.isArray(columnInfo) ? columnInfo : []).forEach((column, index) => {
    const name = String(column?.columnName ?? column?.name ?? '').trim();
    if (!name) return;
    const typeName = String(column?.typeName ?? column?.nativeTypeName ?? '').trim();
    if (HANA_NUMERIC_TYPE.test(typeName)) numericColumns.add(name);
    columns[name] = {
      index,
      name,
      // Shaped like an mssql column so shared callers read one field set.
      type: { name: typeName, declaration: typeName.toLowerCase() },
      length: numberOrNull(column?.length),
      scale: numberOrNull(column?.scale),
      precision: numberOrNull(column?.precision ?? column?.length),
      nullable: Boolean(column?.nullable),
    };
  });

  return { columns, numericColumns };
};

const normalizeRowValues = (row, numericColumns = new Set()) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      numericColumns.has(key) ? normalizeNumericValue(value) : normalizeDateValue(value),
    ]),
  );
};

// A pooled connection is returned to its pool here rather than torn down, so
// the next query on the same company reuses the established session.
const disconnect = (connection) => {
  try {
    connection.disconnect();
  } catch (_error) {
    // Ignore disconnect errors after a query has already completed.
  }
};

const query = async (queryStr, params = {}, options = {}) => {
  const normalizedSql = normalizeSql(queryStr);
  const { sql, values } = bindParams(normalizedSql, params);
  const connection = await connect(options.connectionConfig || options);

  try {
    if (options.connectionConfig?.database || options.database) {
      const schema = options.connectionConfig?.database || options.database;
      await exec(connection, `SET SCHEMA ${quoteIdentifier(schema)}`);
    }

    const { rows, columns: columnInfo } = await execWithMetadata(connection, sql, values);
    const { columns, numericColumns } = buildColumnMetadata(columnInfo);
    const recordset = isReadQuery(sql)
      ? rows.map((row) => normalizeRowValues(row, numericColumns))
      : [];
    // Non-enumerable so the recordset still spreads and serialises as a plain
    // array of rows, exactly as the mssql driver's recordset does.
    Object.defineProperty(recordset, 'columns', { value: columns, enumerable: false });
    return {
      recordset,
      rowsAffected: isReadQuery(sql) ? [0] : [rows?.length || 0],
    };
  } finally {
    disconnect(connection);
  }
};

module.exports = {
  bindParams,
  buildColumnMetadata,
  normalizeNumericValue,
  normalizeRowValues,
  normalizeSql,
  query,
  replaceFunctionCalls,
};
