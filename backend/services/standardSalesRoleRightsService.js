'use strict';

const PROTECTED_ROLES = new Set(['admin', 'superadmin', 'accountant', 'account']);
const isProtectedRole = name => PROTECTED_ROLES.has(String(name || '').trim().toLowerCase());
const GROUPS = [
  { target: '/sales-order', variants: ['/dc-sales-order', '/nc-sales-order', '/soda-sales-order'] },
  { target: '/delivery', variants: ['/dc-delivery', '/nc-delivery', '/soda-delivery'] },
];
const FLAGS = ['CanView', 'CanAdd', 'CanEdit', 'CanDelete'];

// The caller owns the transaction. This service uses only the application
// permissions database; it has no SAP database or Service Layer dependency.
async function syncStandardSalesRoleRights(db) {
  const roles = await db.queryRows('SELECT RoleId, RoleName FROM Roles');
  const menus = await db.queryRows('SELECT MenuId, MenuPath FROM Menus');
  const menuByPath = new Map(menus.map(m => [String(m.MenuPath || '').toLowerCase().replace(/\/+$/, ''), m.MenuId]));
  let changes = 0;
  for (const role of roles.filter(r => !isProtectedRole(r.RoleName))) {
    const rights = await db.queryRows('SELECT * FROM RoleRights WHERE RoleId = @roleId', { roleId: role.RoleId });
    for (const group of GROUPS) {
      const variantIds = group.variants.map(path => menuByPath.get(path)).filter(Boolean);
      const oldRights = rights.filter(r => variantIds.includes(r.MenuId));
      if (!oldRights.length) continue;
      const targetId = menuByPath.get(group.target);
      if (!targetId) throw new Error(`Cannot migrate role rights: ${group.target} menu is missing.`);
      const existing = rights.filter(r => r.MenuId === targetId);
      // A hidden variant may retain stale Add/Edit flags; do not turn those
      // into new capabilities on the visible standard page.
      const effective = [...existing, ...oldRights.filter(r => Number(r.CanView) === 1)];
      const flags = Object.fromEntries(FLAGS.map(flag => [flag, effective.some(r => Number(r[flag]) === 1) ? 1 : 0]));
      if (effective.length) {
        const params = { roleId: role.RoleId, menuId: targetId, ...flags };
        const result = existing.length
          ? await db.query('UPDATE RoleRights SET CanView=@CanView, CanAdd=@CanAdd, CanEdit=@CanEdit, CanDelete=@CanDelete WHERE RoleId=@roleId AND MenuId=@menuId', params)
          : await db.query('INSERT INTO RoleRights (RoleId,MenuId,CanView,CanAdd,CanEdit,CanDelete) VALUES (@roleId,@menuId,@CanView,@CanAdd,@CanEdit,@CanDelete)', params);
        changes += result.rowsAffected?.[0] || 0;
      }
      for (const menuId of variantIds) {
        const result = await db.query('DELETE FROM RoleRights WHERE RoleId=@roleId AND MenuId=@menuId', { roleId: role.RoleId, menuId });
        changes += result.rowsAffected?.[0] || 0;
      }
    }
    const reportsId = menuByPath.get('/reports/company');
    if (!reportsId) throw new Error('Company Reports menu is missing.');
    const existingReports = rights.filter(r => r.MenuId === reportsId);
    const params = { roleId: role.RoleId, menuId: reportsId };
    if (!existingReports.length) {
      changes += (await db.query('INSERT INTO RoleRights (RoleId,MenuId,CanView,CanAdd,CanEdit,CanDelete) VALUES (@roleId,@menuId,1,0,0,0)', params)).rowsAffected?.[0] || 0;
    } else if (existingReports.some(r => Number(r.CanView) !== 1)) {
      changes += (await db.query('UPDATE RoleRights SET CanView=1 WHERE RoleId=@roleId AND MenuId=@menuId AND CanView<>1', params)).rowsAffected?.[0] || 0;
    }
  }
  return changes;
}

module.exports = { syncStandardSalesRoleRights, isProtectedRole };
