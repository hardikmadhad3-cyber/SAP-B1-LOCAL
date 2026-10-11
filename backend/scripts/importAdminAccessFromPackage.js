// Usage: node scripts/importAdminAccessFromPackage.js C:\path\to\package [--apply]
// Replaces the five admin access tables. Report menu definitions referenced by
// rights are copied too, so normal sidebar sync does not delete those rights.
// Existing companies and application menus keep their local IDs.
const fs = require('fs');
const path = require('path');
const { DatabaseSync, backup } = require('node:sqlite');
const dotenv = require('dotenv');

const packageRoot = process.argv[2];
const apply = process.argv.includes('--apply');
if (!packageRoot) {
  console.error('Usage: node scripts/importAdminAccessFromPackage.js <package-root> [--apply]');
  process.exit(1);
}

const sourceServicePath = path.resolve(packageRoot, 'backend/services/authDbService.js');
if (!fs.existsSync(sourceServicePath)) throw new Error('Source package auth service was not found.');

const destinationBackend = path.resolve(__dirname, '..');
const destinationEnv = dotenv.parse(fs.readFileSync(path.join(destinationBackend, '.env')));
if (destinationEnv.AUTH_DB_PROVIDER !== 'sqlite') throw new Error('Destination must use SQLite auth.');
const configuredPath = destinationEnv.AUTH_SQLITE_PATH || './data/henny_auth.sqlite';
const destinationPath = path.isAbsolute(configuredPath)
  ? configuredPath
  : path.resolve(destinationBackend, configuredPath);
if (!fs.existsSync(destinationPath)) throw new Error('Destination auth database was not found.');

const textKey = (value) => String(value || '').trim().toLowerCase();
const companyKey = (row) => [
  textKey(row.DbDialect || 'sqlserver'),
  textKey(row.DbName),
  textKey(row.DbServer || row.ServerName),
].join('|');
const dbValue = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  return value ?? null;
};

const run = async () => {
  const sourceAuthDb = require(sourceServicePath);
  const tables = ['Companies', 'Users', 'Roles', 'UserCompanies', 'UserRoles', 'RoleRights', 'Menus', 'ReportMenus'];
  const source = Object.fromEntries(await Promise.all(tables.map(async (table) => [
    table,
    await sourceAuthDb.queryRows(`SELECT * FROM dbo.${table}`),
  ])));
  const destination = new DatabaseSync(destinationPath);

  try {
    destination.exec('PRAGMA foreign_keys = ON');
    const destinationCompanies = destination.prepare('SELECT CompanyId, DbDialect, DbName, DbServer, ServerName FROM Companies').all();
    const destinationCompanyByKey = new Map();
    for (const row of destinationCompanies) {
      const key = companyKey(row);
      if (destinationCompanyByKey.has(key)) throw new Error(`Ambiguous destination company: ${key}`);
      destinationCompanyByKey.set(key, row.CompanyId);
    }
    const companyIds = new Map();
    for (const row of source.Companies) {
      const localId = destinationCompanyByKey.get(companyKey(row));
      if (!localId) throw new Error(`Import the company before its assignments: ${row.DbName}`);
      companyIds.set(row.CompanyId, localId);
    }

    const sourceMenuById = new Map(source.Menus.map((row) => [row.MenuId, row]));
    if (sourceMenuById.size !== source.Menus.length) throw new Error('Duplicate source menu IDs.');
    const destinationMenus = destination.prepare('SELECT MenuId, MenuName, MenuPath, ParentId FROM Menus').all();
    const menuIds = new Map();
    const missingMenus = [];
    let nextTemporaryId = -1;
    const resolveMenu = (sourceId) => {
      if (menuIds.has(sourceId)) return menuIds.get(sourceId);
      const row = sourceMenuById.get(sourceId);
      if (!row) throw new Error(`Role right references missing source menu ${sourceId}.`);
      const parentId = row.ParentId == null ? null : resolveMenu(row.ParentId);
      const matches = row.MenuPath
        ? destinationMenus.filter((candidate) => textKey(candidate.MenuPath) === textKey(row.MenuPath))
        : destinationMenus.filter((candidate) => !candidate.MenuPath
          && textKey(candidate.MenuName) === textKey(row.MenuName)
          && candidate.ParentId === parentId);
      if (matches.length > 1) throw new Error(`Ambiguous menu: ${row.MenuName || row.MenuPath}`);
      let localId = matches[0]?.MenuId;
      if (localId == null) {
        localId = nextTemporaryId--;
        missingMenus.push({ ...row, MenuId: localId, ParentId: parentId });
        destinationMenus.push({ MenuId: localId, MenuName: row.MenuName, MenuPath: row.MenuPath, ParentId: parentId });
      }
      menuIds.set(sourceId, localId);
      return localId;
    };
    for (const row of source.Menus) resolveMenu(row.MenuId);
    if (new Set(menuIds.values()).size !== menuIds.size) {
      throw new Error('Two source menus would map to one local menu.');
    }

    const sourceUserIds = new Set(source.Users.map((row) => row.UserId));
    const sourceRoleIds = new Set(source.Roles.map((row) => row.RoleId));
    const reportMenuById = new Map(source.ReportMenus.map((row) => [row.ReportMenuId, row]));
    if (reportMenuById.size !== source.ReportMenus.length) throw new Error('Duplicate source report menu IDs.');
    for (const row of source.ReportMenus) {
      if (row.ParentId != null && !reportMenuById.has(row.ParentId)) throw new Error('Missing report menu parent.');
      if (row.CompanyId != null && !companyIds.has(row.CompanyId)) throw new Error('Missing report menu company.');
      if (row.CreatedBy != null && !sourceUserIds.has(row.CreatedBy)) throw new Error('Missing report menu creator.');
    }
    for (const row of source.UserCompanies) {
      if (!sourceUserIds.has(row.UserId) || !companyIds.has(row.CompanyId)) throw new Error('Invalid user-company reference.');
    }
    for (const row of source.UserRoles) {
      if (!sourceUserIds.has(row.UserId) || !sourceRoleIds.has(row.RoleId) || !companyIds.has(row.CompanyId)) {
        throw new Error('Invalid user-role reference.');
      }
    }
    for (const row of source.RoleRights) {
      if (!sourceRoleIds.has(row.RoleId) || !menuIds.has(row.MenuId)) throw new Error('Invalid role-right reference.');
    }

    console.log(`Source rows: ${['Users', 'Roles', 'UserCompanies', 'UserRoles', 'RoleRights']
      .map((table) => `${table}=${source[table].length}`).join(', ')}.`);
    console.log(`Companies mapped: ${companyIds.size}; menus mapped: ${menuIds.size}; missing menus to add: ${missingMenus.length}; report menus: ${source.ReportMenus.length}.`);
    if (!apply) return;

    const backupPath = path.join(path.dirname(destinationPath),
      `${path.basename(destinationPath, '.sqlite')}.before-access-import-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    await backup(destination, backupPath);
    console.log(`Backup: ${backupPath}`);

    destination.exec('BEGIN IMMEDIATE');
    try {
      const newMenuIds = new Map();
      const localMenuId = (id) => (id < 0 ? newMenuIds.get(id) : id);
      for (const row of missingMenus) {
        const result = destination.prepare(`
          INSERT INTO Menus (MenuName, MenuPath, ParentId, Icon, SortOrder)
          VALUES (?, ?, ?, ?, ?)
        `).run(row.MenuName, row.MenuPath, row.ParentId == null ? null : localMenuId(row.ParentId), row.Icon, row.SortOrder);
        newMenuIds.set(row.MenuId, Number(result.lastInsertRowid));
      }

      for (const table of ['RoleRights', 'UserRoles', 'UserCompanies', 'Roles', 'Users']) {
        destination.exec(`DELETE FROM ${table}`);
      }
      const insertRows = (table, rows, transform = (row) => row) => {
        const columns = new Set(destination.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
        for (const original of rows) {
          const row = transform(original);
          const names = Object.keys(row).filter((name) => columns.has(name));
          const identifiers = names.map((name) => `[${name}]`).join(', ');
          const placeholders = names.map(() => '?').join(', ');
          destination.prepare(`INSERT INTO ${table} (${identifiers}) VALUES (${placeholders})`)
            .run(...names.map((name) => dbValue(row[name])));
        }
      };
      insertRows('Users', source.Users);
      insertRows('Roles', source.Roles);
      const reportMenusToWrite = [];
      const visitedReportMenus = new Set();
      const visitReportMenu = (row) => {
        if (visitedReportMenus.has(row.ReportMenuId)) return;
        if (row.ParentId != null) visitReportMenu(reportMenuById.get(row.ParentId));
        visitedReportMenus.add(row.ReportMenuId);
        reportMenusToWrite.push(row);
      };
      source.ReportMenus.forEach(visitReportMenu);
      for (const row of reportMenusToWrite) {
        const values = {
          ...row,
          CompanyId: row.CompanyId == null ? null : companyIds.get(row.CompanyId),
        };
        const names = Object.keys(values);
        const existing = destination.prepare('SELECT ReportMenuId FROM ReportMenus WHERE ReportMenuId = ?').get(row.ReportMenuId);
        if (existing) {
          const fields = names.filter((name) => name !== 'ReportMenuId');
          destination.prepare(`UPDATE ReportMenus SET ${fields.map((name) => `[${name}] = ?`).join(', ')} WHERE ReportMenuId = ?`)
            .run(...fields.map((name) => dbValue(values[name])), row.ReportMenuId);
        } else {
          destination.prepare(`INSERT INTO ReportMenus (${names.map((name) => `[${name}]`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
            .run(...names.map((name) => dbValue(values[name])));
        }
      }
      insertRows('UserCompanies', source.UserCompanies, (row) => ({
        ...row,
        CompanyId: companyIds.get(row.CompanyId),
      }));
      insertRows('UserRoles', source.UserRoles, (row) => ({
        ...row,
        CompanyId: companyIds.get(row.CompanyId),
      }));
      insertRows('RoleRights', source.RoleRights, (row) => ({
        ...row,
        MenuId: localMenuId(menuIds.get(row.MenuId)),
      }));

      const foreignKeyErrors = destination.prepare('PRAGMA foreign_key_check').all();
      if (foreignKeyErrors.length) throw new Error(`Foreign key check failed: ${foreignKeyErrors.length} rows.`);
      for (const table of ['Users', 'Roles', 'UserCompanies', 'UserRoles', 'RoleRights']) {
        const count = destination.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
        if (count !== source[table].length) throw new Error(`${table} count differs from source.`);
      }
      destination.exec('COMMIT');
      console.log('Admin access records imported and foreign keys verified.');
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
