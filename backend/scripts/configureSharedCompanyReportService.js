// Fill missing SAP Report Service settings for companies verified to share one service account.
// Run with --apply to update the local auth database. No credentials are printed.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const axios = require('axios');
const https = require('https');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const dbPath = path.resolve(__dirname, '..', process.env.AUTH_SQLITE_PATH || './data/henny_auth.sqlite');
const sourceName = 'NCPL_110126';
const targetNames = ['NOCPL_LIVE', 'TEST_NOCPL_VENT'];
const apply = process.argv.includes('--apply');

const checkLogin = async (source, target) => {
  const payload = {
    CompanyDB: target.DbName,
    UserName: source.ReportServiceUsername,
    Password: source.ReportServicePassword,
  };
  if (source.ReportServiceDbInstance) payload.DBInstance = source.ReportServiceDbInstance;
  const response = await axios.post(new URL('/login', source.ReportServiceBaseUrl).toString(), payload, {
    timeout: 20000,
    httpsAgent: new https.Agent({ rejectUnauthorized: Boolean(source.ReportServiceRejectUnauthorized) }),
  });
  if (!response.headers['set-cookie']?.length) {
    throw new Error(`Report Service did not return a session for ${target.DbName}.`);
  }
};

const main = async () => {
  const db = new DatabaseSync(dbPath);
  try {
    const source = db.prepare('SELECT * FROM Companies WHERE DbName = ?').get(sourceName);
    if (!source?.ReportServiceBaseUrl || !source.ReportServiceUsername || !source.ReportServicePassword) {
      throw new Error(`Source company ${sourceName} has incomplete Report Service settings.`);
    }
    const targets = targetNames.map((name) => {
      const company = db.prepare('SELECT * FROM Companies WHERE DbName = ?').get(name);
      if (!company) throw new Error(`Company ${name} was not found.`);
      return company;
    });
    for (const target of targets) {
      await checkLogin(source, target);
      process.stdout.write(`${target.DbName}: Report Service login verified\n`);
    }
    if (!apply) {
      process.stdout.write('Dry run complete. Pass --apply to fill missing settings.\n');
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      const update = db.prepare(`
        UPDATE Companies
        SET ReportServiceBaseUrl = COALESCE(NULLIF(ReportServiceBaseUrl, ''), ?),
            ReportServiceUsername = COALESCE(NULLIF(ReportServiceUsername, ''), ?),
            ReportServicePassword = COALESCE(NULLIF(ReportServicePassword, ''), ?),
            ReportServiceDbInstance = COALESCE(NULLIF(ReportServiceDbInstance, ''), ?),
            ReportServiceCompanyDb = COALESCE(NULLIF(ReportServiceCompanyDb, ''), DbName),
            ReportServiceDefaultSchema = COALESCE(NULLIF(ReportServiceDefaultSchema, ''), DbName),
            ReportServiceRejectUnauthorized = COALESCE(ReportServiceRejectUnauthorized, ?)
        WHERE CompanyId = ?
      `);
      for (const target of targets) {
        update.run(
          source.ReportServiceBaseUrl,
          source.ReportServiceUsername,
          source.ReportServicePassword,
          source.ReportServiceDbInstance || null,
          source.ReportServiceRejectUnauthorized,
          target.CompanyId,
        );
      }
      db.exec('COMMIT');
      process.stdout.write(`Configured Report Service for ${targetNames.join(', ')}.\n`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
