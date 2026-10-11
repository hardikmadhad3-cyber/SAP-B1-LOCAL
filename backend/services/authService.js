const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const authDbService = require('./authDbService');
const generalSettingsService = require('./generalSettingsService');
const { syncApplicationSidebarMenus } = require('./applicationMenuSyncService');
const { appendVirtualMenus } = require('./virtualMenuService');

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const isBcryptHash = (value) => /^\$2[aby]\$\d{2}\$/.test(String(value || ''));

const sanitizeUser = (user) => ({
  userId: user.UserId,
  username: user.Username,
  fullName: user.FullName || user.Username,
  email: user.Email || '',
  isActive: Boolean(user.IsActive),
});

const sanitizeCompany = (company) => ({
  companyId: company.CompanyId,
  companyName: company.CompanyName,
  dbDialect: company.DbDialect || 'sqlserver',
  dbName: company.DbName,
  dbServer: company.DbServer || '',
  dbPort: company.DbPort || '',
  serverName: company.ServerName || company.DbServer || '',
  licenseServer: company.LicenseServer || '',
  sapVersion: company.SAPVersion || '',
  isDefault: Boolean(company.IsDefault),
});

const createToken = (payload, expiresIn) =>
  jwt.sign(payload, env.jwtSecret, { expiresIn });

const comparePassword = async (password, storedHash) => {
  const normalizedHash = String(storedHash || '');
  if (!normalizedHash) return false;

  if (isBcryptHash(normalizedHash)) {
    return bcrypt.compare(password, normalizedHash);
  }

  return password === normalizedHash;
};

const TOP_LEVEL_MENU_PRIORITY = new Map([
  ['dashboard', 0],
  ['sales', 1],
  ['sales a r', 1],
  ['purchase', 2],
  ['purchase a p', 2],
  ['purchasing', 2],
  ['purchasing a p', 2],
  ['reports', 6],
  ['general settings', 7],
  ['admin panel', 8],
]);

const normalizeMenuPriorityName = (menuName) =>
  String(menuName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const getTopLevelMenuPriority = (menu) => {
  if (menu?.parentId) return Number.MAX_SAFE_INTEGER;

  const normalizedName = normalizeMenuPriorityName(menu?.menuName);
  return TOP_LEVEL_MENU_PRIORITY.get(normalizedName) ?? Number.MAX_SAFE_INTEGER;
};

const buildMenuTree = (menus, rightsByMenuId) => {
  const menusById = new Map();

  for (const menu of menus) {
    menusById.set(menu.MenuId, {
      menuId: menu.MenuId,
      menuName: menu.MenuName,
      menuPath: menu.MenuPath || '',
      parentId: menu.ParentId ?? null,
      icon: menu.Icon || '',
      sortOrder: menu.SortOrder ?? 0,
      rights: rightsByMenuId.get(menu.MenuId) || {
        canView: true,
        canAdd: false,
        canEdit: false,
        canDelete: false,
      },
      children: [],
    });
  }

  const tree = [];

  for (const menu of menusById.values()) {
    if (menu.parentId && menusById.has(menu.parentId)) {
      menusById.get(menu.parentId).children.push(menu);
    } else {
      tree.push(menu);
    }
  }

  const sortMenus = (items) => {
    items.sort((a, b) => {
      const topLevelPriorityDiff = getTopLevelMenuPriority(a) - getTopLevelMenuPriority(b);
      if (topLevelPriorityDiff !== 0) return topLevelPriorityDiff;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.menuId - b.menuId;
    });

    for (const item of items) {
      sortMenus(item.children);
    }
  };

  sortMenus(tree);
  return tree;
};

const isAdminRoleName = (roleName) =>
  ['admin', 'superadmin'].includes(String(roleName || '').trim().toLowerCase());

const isSetupAdminLogin = (username, password) =>
  String(username || '') === env.setupAdminUsername &&
  String(password || '') === env.setupAdminPassword;

const createSetupAdminLoginResult = () => {
  const username = env.setupAdminUsername || 'manager';
  const adminToken = createToken(
    {
      tokenType: 'admin',
      userId: 0,
      username,
      roleId: 0,
      roleName: 'SuperAdmin',
      isSetupAdmin: true,
    },
    env.jwtExpiresIn,
  );

  return {
    token: adminToken,
    user: {
      userId: 0,
      username,
      fullName: 'Setup Administrator',
      email: '',
      isActive: true,
    },
    roleId: 0,
    roleName: 'SuperAdmin',
  };
};

const REPORT_MENU_PATH_PATTERN = /^\/reportlayoutmanager\/menu\/(\d+)\/?$/i;

const extractReportMenuIdFromPath = (menuPath = '') => {
  const match = String(menuPath || '').trim().match(REPORT_MENU_PATH_PATTERN);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : null;
};

const getAllowedReportMenuIdsForCompany = async (companyId) => {
  if (!Number.isInteger(Number(companyId))) {
    return null;
  }

  const rows = await authDbService.queryRows(`
    SELECT ReportMenuId, ParentId
    FROM dbo.ReportMenus
    WHERE CompanyId = @companyId
  `, { companyId: Number(companyId) });
  const reportRows = await authDbService.queryRows(`
    SELECT DISTINCT ReportMenuId
    FROM dbo.Reports
    WHERE CompanyId = @companyId AND ReportMenuId IS NOT NULL
  `, { companyId: Number(companyId) });
  const byId = new Map(rows.map((row) => [Number(row.ReportMenuId), row]));
  const allowed = new Set();
  for (const report of reportRows) {
    let menu = byId.get(Number(report.ReportMenuId));
    while (menu && !allowed.has(Number(menu.ReportMenuId))) {
      allowed.add(Number(menu.ReportMenuId));
      menu = byId.get(Number(menu.ParentId));
    }
  }
  return allowed;
};

const syncAdminRoleRightsForRole = async (db, roleId, roleName = '') => {
  if (!isAdminRoleName(roleName) || !Number.isInteger(Number(roleId))) return;

  await db.query(`
    INSERT INTO dbo.RoleRights (RoleId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
    SELECT @roleId, M.MenuId, 1, 1, 1, 0
    FROM dbo.Menus M
    WHERE NOT EXISTS (
      SELECT 1
      FROM dbo.RoleRights RR
      WHERE RR.RoleId = @roleId
        AND RR.MenuId = M.MenuId
    )
  `, { roleId: Number(roleId) });
};

const buildAuthorizedMenus = async (roleId, roleName = '', companyId = null) => {
  await authDbService.transaction(async (db) => {
    await syncApplicationSidebarMenus(db);
    await syncAdminRoleRightsForRole(db, roleId, roleName);
  });

  const [allMenus, roleRights] = await Promise.all([
    authDbService.queryRows(`
      SELECT MenuId, MenuName, MenuPath, ParentId, Icon, SortOrder
      FROM dbo.Menus
      ORDER BY SortOrder, MenuId
    `),
    authDbService.queryRows(`
      SELECT RoleId, MenuId, CanView, CanAdd, CanEdit, CanDelete
      FROM dbo.RoleRights
      WHERE RoleId = @roleId
    `, { roleId }),
  ]);

  const allowedReportMenuIds = await getAllowedReportMenuIdsForCompany(companyId);
  const filteredMenus = allowedReportMenuIds
    ? allMenus.filter((menu) => {
        const reportMenuId = extractReportMenuIdFromPath(menu.MenuPath);
        if (!reportMenuId) {
          return true;
        }

        return allowedReportMenuIds.has(reportMenuId);
      })
    : allMenus;

  const visibleRights = roleRights.filter((right) => Boolean(right.CanView));
  const visibleIds = new Set(visibleRights.map((right) => right.MenuId));
  const menuLookup = new Map(filteredMenus.map((menu) => [menu.MenuId, menu]));

  for (const right of visibleRights) {
    let current = menuLookup.get(right.MenuId);
    while (current?.ParentId && menuLookup.has(current.ParentId)) {
      visibleIds.add(current.ParentId);
      current = menuLookup.get(current.ParentId);
    }
  }

  const rightsByMenuId = new Map(
    visibleRights.map((right) => [
      right.MenuId,
      {
        canView: Boolean(right.CanView),
        canAdd: Boolean(right.CanAdd),
        canEdit: Boolean(right.CanEdit),
        canDelete: Boolean(right.CanDelete),
      },
    ]),
  );

  const visibleMenus = filteredMenus.filter((menu) => visibleIds.has(menu.MenuId));
  const menuTree = buildMenuTree(visibleMenus, rightsByMenuId);
  const menuPaths = visibleMenus
    .map((menu) => String(menu.MenuPath || '').trim())
    .filter(Boolean);

  const menuPayload = appendVirtualMenus({
    menus: menuTree,
    menuPaths,
    includeAdminPanel: isAdminRoleName(roleName),
  });

  return menuPayload;
};

const login = async (username, password) => {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');

  if (!normalizedUsername || !normalizedPassword) {
    throw createHttpError(400, 'Username and password are required.');
  }

  const user = await authDbService.findUserByUsername(normalizedUsername);

  if (!user || !user.IsActive) {
    throw createHttpError(401, 'Invalid username or password.');
  }

  const isValidPassword = await comparePassword(normalizedPassword, user.PasswordHash);
  if (!isValidPassword) {
    throw createHttpError(401, 'Invalid username or password.');
  }

  const preAuthToken = createToken(
    {
      tokenType: 'pending',
      userId: user.UserId,
      username: user.Username,
    },
    env.pendingJwtExpiresIn,
  );

  return {
    preAuthToken,
    user: sanitizeUser(user),
  };
};

const adminLogin = async (username, password) => {
  const normalizedUsername = String(username || '').trim();
  const normalizedPassword = String(password || '');

  if (!normalizedUsername || !normalizedPassword) {
    throw createHttpError(400, 'Username and password are required.');
  }

  if (isSetupAdminLogin(normalizedUsername, normalizedPassword)) {
    return createSetupAdminLoginResult();
  }

  const user = await authDbService.findUserByUsername(normalizedUsername);

  if (!user || !user.IsActive) {
    throw createHttpError(401, 'Invalid username or password.');
  }

  const isValidPassword = await comparePassword(normalizedPassword, user.PasswordHash);
  if (!isValidPassword) {
    throw createHttpError(401, 'Invalid username or password.');
  }

  const role = await authDbService.getAdminRoleForUser(user.UserId);
  if (!role || !isAdminRoleName(role.RoleName)) {
    throw createHttpError(403, 'Only Admin users can access the admin panel.');
  }

  const adminToken = createToken(
    {
      tokenType: 'admin',
      userId: user.UserId,
      username: user.Username,
      roleId: role.RoleId,
      roleName: role.RoleName,
    },
    env.jwtExpiresIn,
  );

  return {
    token: adminToken,
    user: sanitizeUser(user),
    roleId: role.RoleId,
    roleName: role.RoleName,
  };
};

const getActiveCompanies = async () => {
  const companies = await authDbService.getActiveCompanies();
  return companies.map(sanitizeCompany);
};

const getCompaniesForUser = async (userId) => {
  const companies = await authDbService.getUserCompanies(userId);
  return companies.map(sanitizeCompany);
};

const selectCompany = async (userId, companyId) => {
  const [company, role] = await Promise.all([
    authDbService.getAssignedCompanyForUser(userId, companyId),
    authDbService.getUserRoleForCompany(userId, companyId),
  ]);

  if (!company) {
    throw createHttpError(403, 'You do not have access to the selected company.');
  }

  if (!role) {
    throw createHttpError(403, 'No role is assigned for the selected company.');
  }

  const [{ menus, menuPaths }, generalSettings] = await Promise.all([
    buildAuthorizedMenus(role.RoleId, role.RoleName, companyId),
    generalSettingsService.getSettings(userId, companyId),
  ]);
  const accessToken = createToken(
    {
      tokenType: 'access',
      userId,
      companyId,
      roleId: role.RoleId,
    },
    env.jwtExpiresIn,
  );

  return {
    token: accessToken,
    userId,
    companyId,
    roleId: role.RoleId,
    roleName: role.RoleName,
    company: sanitizeCompany(company),
    generalSettings,
    menus,
    menuPaths,
  };
};

const getMenuForRole = async (roleId, companyId = null) => {
  const role = await authDbService.getRoleById(roleId);
  return buildAuthorizedMenus(roleId, role?.RoleName || '', companyId);
};

module.exports = {
  createHttpError,
  login,
  adminLogin,
  getActiveCompanies,
  getCompaniesForUser,
  selectCompany,
  getMenuForRole,
};
