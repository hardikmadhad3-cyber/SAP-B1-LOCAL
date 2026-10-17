const appDb = require('./appDbService');
const cache = new Map();
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const { query, queryRows, queryOne, transaction, ensureSchema, tableExists, getTableSchemaRows } = appDb;
const ensureCompanyCredentialColumns = ensureSchema;
const insertAndGetId = async (sqlText, params = {}) => {
  const result = await query(sqlText, params);
  return Number(result.lastInsertId || result.recordset?.[0]?.recordId || 0);
};
const clearCache = (prefix = '') => {
  for (const key of cache.keys()) {
    if (!prefix || String(key).startsWith(prefix)) cache.delete(key);
  }
};

const getCached = (key) => {
  const entry = cache.get(key);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return entry.value;
};

const setCached = (key, value, ttlMs = DEFAULT_CACHE_TTL_MS) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  return value;
};

const cachedQuery = async (key, queryFn, ttlMs) => {
  const cachedValue = getCached(key);
  if (cachedValue !== undefined) return cachedValue;

  const value = await queryFn();
  return setCached(key, value, ttlMs);
};

const COMPANY_SELECT_COLUMNS = `
    CompanyId,
    CompanyName,
    DbDialect,
    DbName,
    DbUser,
    DbPassword,
    FormQueryDbUser,
    FormQueryDbPassword,
    ServerName,
    LicenseServer,
    SAPVersion,
    IsActive,
    CreatedAt,
    Port,
    AuthDbName,
    SapBaseUrl,
    SapUsername,
    SapPassword,
    SapCompanyDb,
    SapRejectUnauthorized,
    ReportServiceBaseUrl,
    ReportServiceUsername,
    ReportServicePassword,
    ReportServiceCompanyDb,
    ReportServiceDbInstance,
    ReportServiceDefaultSchema,
    ReportServiceRejectUnauthorized,
    SalesOrderDefaultToVendorCode,
    DbServer,
    DbPort,
    DbEncrypt,
    DbTrustCert
`;

const qualifyCompanyColumns = (alias) =>
  COMPANY_SELECT_COLUMNS
    .split('\n')
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => `    ${alias}.${column}`)
    .join('\n');

const findUserByUsername = async (username) => queryOne(`
  SELECT UserId, Username, PasswordHash, FullName, Email, IsActive, CreatedAt
  FROM Users
  WHERE Username = @username
`, { username });

const getActiveCompanies = async () => {
  await ensureCompanyCredentialColumns();
  return cachedQuery('activeCompanies', () => queryRows(`
  SELECT
${COMPANY_SELECT_COLUMNS}
  FROM Companies
  WHERE IsActive = 1
  ORDER BY CompanyName ASC
`));
};

const getUserCompanies = async (userId) => {
  await ensureCompanyCredentialColumns();
  return cachedQuery(`userCompanies:${userId}`, () => queryRows(`
  SELECT
${qualifyCompanyColumns('c')},
    uc.IsDefault,
    uc.SapUserCode AS AssignedSapUserCode
  FROM UserCompanies uc
  INNER JOIN Companies c
    ON c.CompanyId = uc.CompanyId
  WHERE uc.UserId = @userId
    AND c.IsActive = 1
  ORDER BY uc.IsDefault DESC, c.CompanyName ASC
`, { userId }));
};

const getAssignedCompanyForUser = async (userId, companyId) => {
  await ensureCompanyCredentialColumns();
  return cachedQuery(`assignedCompany:${userId}:${companyId}`, () => queryOne(`
  SELECT
${qualifyCompanyColumns('c')},
    uc.IsDefault,
    uc.SapUserCode AS AssignedSapUserCode
  FROM UserCompanies uc
  INNER JOIN Companies c
    ON c.CompanyId = uc.CompanyId
  WHERE uc.UserId = @userId
    AND uc.CompanyId = @companyId
    AND c.IsActive = 1
`, { userId, companyId }));
};

const getUserRoleForCompany = async (userId, companyId) => cachedQuery(`userRole:${userId}:${companyId}`, () => queryOne(`
  SELECT ur.RoleId, r.RoleName
  FROM UserRoles ur
  INNER JOIN Roles r
    ON r.RoleId = ur.RoleId
  WHERE ur.UserId = @userId
    AND ur.CompanyId = @companyId
  LIMIT 1
`, { userId, companyId }));

const getAdminRoleForUser = async (userId) => cachedQuery(`adminRole:${userId}`, () => queryOne(`
  SELECT ur.RoleId, r.RoleName
  FROM UserRoles ur
  INNER JOIN Roles r
    ON r.RoleId = ur.RoleId
  WHERE ur.UserId = @userId
    AND LOWER(r.RoleName) IN ('admin', 'superadmin')
  ORDER BY CASE WHEN LOWER(r.RoleName) = 'superadmin' THEN 0 ELSE 1 END, ur.RoleId ASC
  LIMIT 1
`, { userId }));

const getRoleById = async (roleId) => cachedQuery(`role:${roleId}`, () => queryOne(`
  SELECT RoleId, RoleName
  FROM Roles
  WHERE RoleId = @roleId
`, { roleId }));

const getAllMenus = async () => cachedQuery('allMenus', () => queryRows(`
  SELECT MenuId, MenuName, MenuPath, ParentId, Icon, SortOrder
  FROM Menus
  ORDER BY SortOrder, MenuId
`));

const getRoleRights = async (roleId) => cachedQuery(`roleRights:${roleId}`, () => queryRows(`
  SELECT RoleId, MenuId, CanView, CanAdd, CanEdit, CanDelete
  FROM RoleRights
  WHERE RoleId = @roleId
`, { roleId }));

module.exports = {
  query,
  queryRows,
  queryOne,
  transaction,
  ensureSchema,
  ensureCompanyCredentialColumns,
  clearCache,
  tableExists,
  getTableSchemaRows,
  insertAndGetId,
  findUserByUsername,
  getActiveCompanies,
  getUserCompanies,
  getAssignedCompanyForUser,
  getUserRoleForCompany,
  getAdminRoleForUser,
  getRoleById,
  getAllMenus,
  getRoleRights,
};
