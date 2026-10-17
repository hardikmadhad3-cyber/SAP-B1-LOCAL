// Opening balances and internal reconciliation for local PostgreSQL companies.
// The posting rules live in localServiceLayer; this resolves the selected company.
const db = require('./dbService');
const { ensureCompanyMigrated } = require('../db/companyMigrations');
const engine = require('./localServiceLayer');

const companySchema = async () => {
  const config = await db.resolveSqlConnectionConfig();
  if (config.dialect !== 'postgres') {
    const error = new Error('This page is for local PostgreSQL companies; use the SAP client for SAP-connected companies.');
    error.statusCode = 400;
    throw error;
  }
  await ensureCompanyMigrated(config.database);
  return config.database;
};

module.exports = {
  listOpeningBalances: async () => engine.listOpeningBalances(await companySchema()),
  postOpeningBalances: async (kind, body) => engine.postOpeningBalances(await companySchema(), kind, body),
  listReconcilablePartners: async () => engine.listReconcilablePartners(await companySchema()),
  listOpenRows: async (cardCode) => engine.listOpenRows(await companySchema(), cardCode),
  reconcile: async (body) => engine.reconcile(await companySchema(), body),
};
