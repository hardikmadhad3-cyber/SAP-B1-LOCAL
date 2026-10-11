// Usage: node scripts/importCompaniesFromPackage.js C:\path\to\package --apply
// Without --apply, print the company mapping without changing the local database.
const fs = require('fs');
const path = require('path');
const { DatabaseSync, backup } = require('node:sqlite');
const dotenv = require('dotenv');

const packageRoot = process.argv[2];
const apply = process.argv.includes('--apply');
if (!packageRoot) {
  console.error('Usage: node scripts/importCompaniesFromPackage.js <package-root> [--apply]');
  process.exit(1);
}

const sourceBackend = path.resolve(packageRoot, 'backend');
const sourceServicePath = path.join(sourceBackend, 'services', 'authDbService.js');
if (!fs.existsSync(sourceServicePath)) {
  console.error('Source package has no backend auth database service.');
  process.exit(1);
}

const destinationBackend = path.resolve(__dirname, '..');
const destinationEnv = dotenv.parse(fs.readFileSync(path.join(destinationBackend, '.env')));
if (destinationEnv.AUTH_DB_PROVIDER !== 'sqlite') {
  console.error('Destination must use the SQLite auth database.');
  process.exit(1);
}

const configuredDestination = destinationEnv.AUTH_SQLITE_PATH || './data/henny_auth.sqlite';
const destinationPath = path.isAbsolute(configuredDestination)
  ? configuredDestination
  : path.resolve(destinationBackend, configuredDestination);
if (!fs.existsSync(destinationPath)) {
  console.error('Destination auth database does not exist.');
  process.exit(1);
}

const companyKey = (row) => [
  String(row.DbDialect || 'sqlserver').trim().toLowerCase(),
  String(row.DbName || '').trim().toLowerCase(),
  String(row.DbServer || row.ServerName || '').trim().toLowerCase(),
].join('|');

const dbValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  return value ?? null;
};

const run = async () => {
  const sourceAuthDb = require(sourceServicePath);
  const sourceRows = await sourceAuthDb.queryRows('SELECT * FROM dbo.Companies ORDER BY CompanyId');
  const destination = new DatabaseSync(destinationPath);

  try {
    const destinationColumns = new Set(
      destination.prepare('PRAGMA table_info(Companies)').all().map((column) => column.name),
    );
    const existingRows = destination.prepare('SELECT CompanyId, DbDialect, DbName, DbServer, ServerName FROM Companies').all();
    const existingByKey = new Map();
    for (const row of existingRows) {
      const key = companyKey(row);
      if (existingByKey.has(key)) throw new Error(`Duplicate destination company connection: ${key}`);
      existingByKey.set(key, row);
    }

    const sourceKeys = new Set();
    const plan = sourceRows.map((row) => {
      const key = companyKey(row);
      if (!row.DbName || sourceKeys.has(key)) throw new Error(`Missing or duplicate source company connection: ${key}`);
      sourceKeys.add(key);
      return { row, existing: existingByKey.get(key) };
    });

    console.log(`Source: ${plan.length} companies; destination: ${existingRows.length} companies.`);
    for (const { row, existing } of plan) {
      console.log(`${existing ? 'Update' : 'Add'}: ${row.CompanyName} (${row.DbName})${existing ? `, keep local ID ${existing.CompanyId}` : ''}`);
    }
    if (!apply) return;

    const backupPath = path.join(
      path.dirname(destinationPath),
      `${path.basename(destinationPath, '.sqlite')}.before-company-import-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    await backup(destination, backupPath);
    console.log(`Backup: ${backupPath}`);

    destination.exec('BEGIN IMMEDIATE');
    try {
      for (const { row, existing } of plan) {
        const columns = Object.keys(row).filter((name) => name !== 'CompanyId' && destinationColumns.has(name));
        const values = columns.map((name) => dbValue(row[name]));
        if (existing) {
          const assignments = columns.map((name) => `[${name}] = ?`).join(', ');
          destination.prepare(`UPDATE Companies SET ${assignments} WHERE CompanyId = ?`)
            .run(...values, existing.CompanyId);
        } else {
          const names = columns.map((name) => `[${name}]`).join(', ');
          const placeholders = columns.map(() => '?').join(', ');
          destination.prepare(`INSERT INTO Companies (${names}) VALUES (${placeholders})`).run(...values);
        }
      }

      const finalRows = destination.prepare('SELECT CompanyId, CompanyName, DbDialect, DbName, DbServer, ServerName FROM Companies').all();
      for (const key of sourceKeys) {
        if (finalRows.filter((row) => companyKey(row) === key).length !== 1) {
          throw new Error(`Imported company is missing or duplicated: ${key}`);
        }
      }
      destination.exec('COMMIT');
      console.log(`Imported ${plan.length} companies; destination now has ${finalRows.length} companies.`);
    } catch (error) {
      destination.exec('ROLLBACK');
      throw error;
    }
  } finally {
    destination.close();
  }
};

run().then(() => process.exit(0)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
