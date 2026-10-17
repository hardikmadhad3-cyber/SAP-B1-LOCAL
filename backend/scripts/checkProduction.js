// Production check, run by deployment/start-backend.ps1 before the server starts
// (or by hand: `node scripts/checkProduction.js`). FAIL stops the start: data
// could be lost or exposed. WARN is printed for the administrator to fix.
const fs = require('fs');
const path = require('path');
const env = require('../config/env');

const results = [];
const report = (level, message) => results.push({ level, message });

const run = async () => {
  if (!process.env.DATABASE_URL) report('FAIL', 'DATABASE_URL is not set in backend/.env.');
  if (String(process.env.AUTH_DB_PROVIDER || 'postgres') !== 'postgres') report('WARN', 'AUTH_DB_PROVIDER is not postgres; users are not stored in the ERP database.');

  if (!env.isUsableSecret(String(process.env.JWT_SECRET || '').trim())) {
    report('WARN', 'JWT_SECRET in backend/.env is empty or a placeholder; the generated secret in backend/data/.jwt-secret is used (keep that file private).');
  }
  if (!env.setupAdminLoginEnabled) {
    report('WARN', 'SETUP_ADMIN_PASSWORD is weak, so the emergency setup-administrator login is off. Use a database admin user, or set 12+ characters with letters and digits.');
  }

  const pg = require('../db/pgDb');
  const authDb = require('../services/authDbService');
  const { ensureCompanyMigrated } = require('../db/companyMigrations');
  try {
    await pg.getPool('').query('SELECT 1');
  } catch (error) {
    report('FAIL', `Cannot reach the database: ${error.message}`);
    return pg;
  }

  const companies = (await authDb.getActiveCompanies()).filter((company) => String(company.DbDialect || '').toLowerCase() === 'postgres');
  if (!companies.length) report('WARN', 'No active local (PostgreSQL) company. Create one with `npm run seed:company`.');
  const today = new Date().toLocaleDateString('en-CA');
  for (const company of companies) {
    const name = `${company.CompanyName} (${company.DbName})`;
    try {
      await ensureCompanyMigrated(company.DbName);
    } catch (error) {
      report('FAIL', `${name}: database upgrade failed: ${error.message}`);
      continue;
    }
    const sql = (text, values) => pg.getPool(company.DbName).query(text, values);
    const period = (await sql('SELECT "PeriodStat" FROM "OFPR" WHERE $1::date BETWEEN "F_RefDate" AND "T_RefDate" LIMIT 1', [today])).rows[0];
    if (!period) report('WARN', `${name}: no posting period covers today (${today}); documents cannot be added. Setup > Posting Periods.`);
    else if (period.PeriodStat !== 'N') report('WARN', `${name}: today's posting period is locked.`);
    const acp = (await sql('SELECT * FROM "OACP" ORDER BY "FinancYear" DESC LIMIT 1')).rows[0] || {};
    const missing = [['LinkAct_1', 'receivables'], ['LinkAct_10', 'payables'], ['DfltIncom', 'revenue'], ['DfltExpn', 'expense'],
      ['COGM_Act', 'cost of goods sold'], ['AlocCstAct', 'allocation (GRNI)']].filter(([column]) => !acp[column]).map(([, label]) => label);
    if (missing.length) report('WARN', `${name}: G/L Account Determination has no ${missing.join(', ')} account; posting documents will stop until set.`);
  }

  // Backups: the newest database backup should be recent.
  const backupDir = path.resolve(__dirname, '../../backups');
  const newest = fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter((file) => file.endsWith('.dump')).map((file) => fs.statSync(path.join(backupDir, file)).mtimeMs).sort().pop()
    : null;
  if (!newest) report('WARN', 'No database backup found in backups/. Run deployment\\backup-database.ps1 -InstallSchedule.');
  else if (Date.now() - newest > 2 * 24 * 3600 * 1000) report('WARN', `The newest database backup is ${Math.floor((Date.now() - newest) / 86400000)} days old.`);
  return pg;
};

run().then(async (pg) => {
  for (const { level, message } of results) console.log(`${level.padEnd(4)}  ${message}`);
  const failed = results.some((result) => result.level === 'FAIL');
  console.log(failed ? 'Production check: FAILED' : `Production check: OK${results.length ? ' (with warnings)' : ''}`);
  await pg?.closeAll?.();
  process.exit(failed ? 1 : 0);
}).catch((error) => {
  console.error(`FAIL  Production check could not run: ${error.message}`);
  process.exit(1);
});
