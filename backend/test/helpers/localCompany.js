// A throwaway PostgreSQL company for tests: seeded like a real one, with a
// request context logged in as its administrator, and removed afterwards.
const env = require('../../config/env');
const pg = require('../../db/pgDb');
const authDb = require('../../services/authDbService');
const { seedNewCompany } = require('../../scripts/seedNewCompany');
const { runWithRequestContext } = require('../../services/requestContextService');

const withLocalCompany = async (prefix, callback) => {
  const nonce = require('node:crypto').randomBytes(4).toString('hex');
  const schema = `cmp_${prefix}_${process.pid}_${nonce}`;
  const username = `${prefix}_${process.pid}_${nonce}`;
  const oldPassword = env.setupAdminPassword;
  env.setupAdminPassword = 'temporary-test-password';
  let company;
  try {
    company = await seedNewCompany({ name: `${prefix} test`, schema, year: 2026, username });
    const user = await authDb.findUserByUsername(username);
    const sql = (text, values) => pg.getPool(schema).query(text, values);
    const asUser = (fn) => runWithRequestContext({ auth: { userId: user.UserId, companyId: company.companyId }, body: {} }, fn);
    return await callback({ schema, sql, asUser, company });
  } finally {
    env.setupAdminPassword = oldPassword;
    if (company) {
      for (const table of ['UserRoles', 'UserCompanies', 'Companies']) {
        await authDb.query(`DELETE FROM ${table} WHERE CompanyId = @id`, { id: company.companyId });
      }
    }
    const user = await authDb.findUserByUsername(username);
    if (user) await authDb.query('DELETE FROM Users WHERE UserId = @id', { id: user.UserId });
    await pg.getPool('').query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    authDb.clearCache();
  }
};

// SL error -> [status, message], failing the test if the call succeeded.
const slFailure = async (promise) => {
  const error = await promise.then(() => null, (e) => e);
  if (!error) throw new Error('Expected the request to fail.');
  return [error.response?.status, error.response?.data?.error?.message?.value || error.message];
};

module.exports = { withLocalCompany, slFailure };
