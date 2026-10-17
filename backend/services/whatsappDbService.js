const appDb = require('./appDbService');
const { getRequestContext } = require('./requestContextService');

const database = () => {
  const req = getRequestContext()?.req;
  const companyId = Number(req?.auth?.companyId || req?.whatsappCompanyId);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new Error('A valid company session is required for whatsapp data.');
  }
  return appDb.forSchema('app_company_' + companyId);
};
const queryRows = (sql, params) => database().queryRows(sql, params);
const queryOne = (sql, params) => database().queryOne(sql, params);
const execute = async (sql, params) => {
  const result = await database().query(sql, params);
  return { changes: result.rowsAffected[0], lastInsertRowid: result.lastInsertId || 0 };
};
module.exports = { queryRows, queryOne, execute };
