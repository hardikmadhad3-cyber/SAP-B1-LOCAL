const fs = require('fs');
const path = require('path');
const pgDb = require('../db/pgDb');

const [authSchema, addonSchema] = fs.readFileSync(
  path.join(__dirname, '../db/app-schema.pg.sql'), 'utf8',
).split('-- COMPANY ADDONS');
const databases = new Map();
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;
const unquote = (name) => String(name).replace(/^\[|\]$|^"|"$/g, '');

const forSchema = (schema) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('Invalid application schema.');
  if (databases.has(schema)) return databases.get(schema);
  let ready;
  const ensureSchema = () => {
    if (!ready) {
      ready = (async () => {
        const client = await pgDb.getPool(schema).connect();
        try {
          await client.query('BEGIN');
          // Serialize initialization across processes, including the first startup.
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [schema]);
          await client.query(`CREATE SCHEMA IF NOT EXISTS ${quote(schema)}`);
          await client.query(`SET LOCAL search_path TO ${quote(schema)}`);
          await client.query(schema.startsWith('app_company_') ? addonSchema : authSchema);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      })().catch((error) => { ready = null; throw error; });
    }
    return ready;
  };

  const run = async (client, sqlText, params = {}) => {
    if (!String(sqlText || '').trim()) return { recordset: [], rowsAffected: [0] };
    let sql = pgDb.translateSql(sqlText);
    const isInsert = /^\s*INSERT\b/i.test(sql);
    const hasReturning = /\bRETURNING\b/i.test(sql);
    if (isInsert && !hasReturning) sql = sql.trim().replace(/;$/, '') + ' RETURNING *';
    const values = Object.fromEntries(Object.entries(params).map(([key, value]) => [
      key, typeof value === 'boolean' ? Number(value) : value,
    ]));
    const bound = pgDb.bindParams(sql, values);
    const result = await client.query(bound.sql, bound.values);
    return {
      recordset: isInsert && !hasReturning ? [] : result.rows,
      rowsAffected: [/^\s*SELECT\b/i.test(sql) ? 0 : result.rowCount || 0],
      ...(isInsert ? { lastInsertId: Number(Object.values(result.rows[0] || {})[0] || 0) } : {}),
    };
  };
  const apiFor = (client) => {
    const query = (sql, params) => run(client, sql, params);
    const queryRows = async (sql, params) => (await query(sql, params)).recordset || [];
    const queryOne = async (sql, params) => (await queryRows(sql, params))[0] || null;
    return { query, queryRows, queryOne };
  };
  const api = apiFor({ query: async (...args) => {
    await ensureSchema();
    return pgDb.getPool(schema).query(...args);
  } });
  const transaction = async (callback) => {
    await ensureSchema();
    const client = await pgDb.getPool(schema).connect();
    try {
      await client.query('BEGIN');
      const result = await callback(apiFor(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  const tableExists = async (tableName) => {
    await ensureSchema();
    const result = await pgDb.getPool(schema).query(
      'SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND lower(table_name) = lower($2)',
      [schema, unquote(tableName)],
    );
    return result.rowCount > 0;
  };
  const getTableSchemaRows = async (tableName) => {
    await ensureSchema();
    const result = await pgDb.getPool(schema).query(`
      SELECT c.column_name AS "columnName", c.data_type AS "dataType",
        c.is_nullable AS "isNullable", c.character_maximum_length AS "maxLength",
        c.ordinal_position AS "ordinalPosition", (c.is_identity = 'YES')::int AS "isIdentity",
        EXISTS (SELECT 1 FROM information_schema.table_constraints t
          JOIN information_schema.key_column_usage k USING (constraint_catalog, constraint_schema, constraint_name)
          WHERE t.constraint_type = 'PRIMARY KEY' AND t.table_schema = c.table_schema
            AND t.table_name = c.table_name AND k.column_name = c.column_name)::int AS "isPrimaryKey",
        fk.foreign_table AS "referencedTable", fk.foreign_column AS "referencedColumn"
      FROM information_schema.columns c
      LEFT JOIN LATERAL (
        SELECT target.table_name AS foreign_table, target.column_name AS foreign_column
        FROM information_schema.key_column_usage k
        JOIN information_schema.referential_constraints r USING (constraint_catalog, constraint_schema, constraint_name)
        JOIN information_schema.key_column_usage target
          ON target.constraint_catalog = r.unique_constraint_catalog
          AND target.constraint_schema = r.unique_constraint_schema
          AND target.constraint_name = r.unique_constraint_name
          AND target.ordinal_position = k.position_in_unique_constraint
        WHERE k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = c.column_name
      ) fk ON true
      WHERE c.table_schema = $1 AND lower(c.table_name) = lower($2)
      ORDER BY c.ordinal_position`, [schema, unquote(tableName)]);
    const bitNames = new Set(['IsActive', 'IsDefault', 'IsRequired', 'IsPublic', 'IsSystem',
      'CanView', 'CanAdd', 'CanEdit', 'CanDelete', 'SapRejectUnauthorized',
      'ReportServiceRejectUnauthorized', 'DbEncrypt', 'DbTrustCert']);
    return result.rows.map((row) => ({ ...row,
      dataType: bitNames.has(row.columnName) ? 'bit'
        : ({ integer: 'int', text: 'nvarchar' }[row.dataType] || row.dataType),
    }));
  };
  const database = { ...api, ensureSchema, transaction, tableExists, getTableSchemaRows };
  databases.set(schema, database);
  return database;
};

module.exports = { ...forSchema('app'), forSchema };
