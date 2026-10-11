const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const authDbService = require('../services/authDbService');
const { APP_MENU_DEFINITIONS, syncApplicationSidebarMenus } = require('../services/applicationMenuSyncService');

test('menu sync preserves an admin-selected root parent for Company Reports', async () => {
  const idByKey = new Map(APP_MENU_DEFINITIONS.map((definition, index) => [definition.key, index + 1]));
  const menus = APP_MENU_DEFINITIONS.map((definition) => ({
    MenuId: idByKey.get(definition.key),
    MenuName: definition.menuName,
    MenuPath: definition.menuPath || null,
    ParentId: definition.parentKey ? idByKey.get(definition.parentKey) : null,
    Icon: definition.icon,
    SortOrder: definition.sortOrder,
  }));
  const companyReports = menus.find((menu) => menu.MenuPath === '/reports/company');
  companyReports.ParentId = null;
  menus.push({ MenuId: menus.length + 1, MenuName: 'Reports', MenuPath: '/reports', ParentId: null, Icon: 'report', SortOrder: 8 });

  const tableExists = mock.method(authDbService, 'tableExists', async (name) => name === 'Menus');
  const writes = [];
  const db = {
    queryRows: async (sql) => sql.includes('SELECT MenuId, MenuName, MenuPath, ParentId, Icon, SortOrder') ? menus : [],
    queryOne: async (sql) => sql.includes('MenuPath = @path') ? menus.find((menu) => menu.MenuPath === '/reports') : null,
    query: async (sql, params) => {
      writes.push({ sql, params });
      return { rowsAffected: [0], recordset: [] };
    },
  };

  try {
    await syncApplicationSidebarMenus(db);
    assert.equal(companyReports.ParentId, null);
    assert.equal(writes.some(({ sql, params }) => /UPDATE dbo\.Menus/i.test(sql) && params?.menuId === companyReports.MenuId), false);
  } finally {
    tableExists.mock.restore();
  }
});
