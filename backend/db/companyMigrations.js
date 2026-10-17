/**
 * Company schema upgrades. company-schema.pg.sql is the baseline a new company
 * is created from; every later change is a numbered file in company-migrations/
 * applied once per company, on that company's first query in this process.
 */
const fs = require('fs');
const path = require('path');
const pgDb = require('./pgDb');

const DIR = path.join(__dirname, 'company-migrations');
const migrations = fs.readdirSync(DIR).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()
  .map((name) => ({ name, sql: fs.readFileSync(path.join(DIR, name), 'utf8') }));

const applied = new Map();

const migrate = async (schema) => {
  const client = await pgDb.getPool(schema).connect();
  try {
    await client.query('BEGIN');
    // Serialises concurrent first requests and multiple server processes.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`migrate:${schema}`]);
    await client.query(`CREATE TABLE IF NOT EXISTS "_Migrations" (
      "Name" TEXT PRIMARY KEY, "AppliedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const done = new Set((await client.query('SELECT "Name" FROM "_Migrations"')).rows.map((row) => row.Name));
    for (const { name, sql } of migrations.filter((m) => !done.has(m.name))) {
      await client.query(sql);
      await client.query('INSERT INTO "_Migrations" ("Name") VALUES ($1)', [name]);
      console.log(`[DB] ${schema}: applied migration ${name}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// Cached per schema; a failure is not cached, so the next query retries.
const ensureCompanyMigrated = (schema) => {
  if (!schema) return Promise.resolve();
  if (!applied.has(schema)) {
    applied.set(schema, migrate(schema).catch((error) => {
      applied.delete(schema);
      throw error;
    }));
  }
  return applied.get(schema);
};

module.exports = { ensureCompanyMigrated, migrations };
