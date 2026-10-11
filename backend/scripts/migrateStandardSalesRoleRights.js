'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const env = require('../config/env');
const { syncStandardSalesRoleRights, isProtectedRole } = require('../services/standardSalesRoleRightsService');

async function main() {
  const databasePath = path.resolve(__dirname, '..', env.authSqlitePath);
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA busy_timeout=5000');
  const query = async (sql, params = {}) => {
    const statement = database.prepare(sql);
    if (/^\s*SELECT/i.test(sql)) return { recordset: statement.all(params) };
    const result = statement.run(params);
    return { rowsAffected: [Number(result.changes)] };
  };
  const adapter = { query, queryRows: async (sql, params) => (await query(sql, params)).recordset };
  const protectedSnapshot = () => JSON.stringify(database.prepare('SELECT RR.* FROM RoleRights RR JOIN Roles R ON R.RoleId=RR.RoleId ORDER BY RR.Id').all()
    .filter(row => protectedIds.has(row.RoleId)));
  const protectedIds = new Set(database.prepare('SELECT * FROM Roles').all().filter(r => isProtectedRole(r.RoleName)).map(r => r.RoleId));
  database.exec('BEGIN IMMEDIATE');
  try {
    const before = protectedSnapshot();
    const backup = path.join(path.dirname(databasePath), `role-rights-before-standard-sales-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify(database.prepare('SELECT * FROM RoleRights ORDER BY Id').all(), null, 2), { flag: 'wx' });
    const changes = await syncStandardSalesRoleRights(adapter);
    if (before !== protectedSnapshot()) throw new Error('Protected role rights changed; rolling back.');
    database.exec('COMMIT');
    console.log(JSON.stringify({ changes, protectedRolesUnchanged: true, backup }));
    console.log(JSON.stringify(database.prepare("SELECT R.RoleName,M.MenuPath,RR.CanView,RR.CanAdd,RR.CanEdit,RR.CanDelete FROM RoleRights RR JOIN Roles R ON R.RoleId=RR.RoleId JOIN Menus M ON M.MenuId=RR.MenuId WHERE M.MenuPath IN ('/sales-order','/delivery','/reports/company') AND R.RoleName NOT IN ('Admin','Accountant') ORDER BY R.RoleId,M.MenuPath").all()));
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally { database.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
