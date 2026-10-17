'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSqliteAuthDbTestAdapter } = require('./helpers/sqliteAuthDbTestAdapter');
const { syncStandardSalesRoleRights, removeRetiredSalesMenus } = require('../services/standardSalesRoleRightsService');

test('migrates variant rights without granting hidden capabilities, preserves protected roles, and is idempotent', async () => {
  const harness = createSqliteAuthDbTestAdapter(`
    CREATE TABLE Roles (RoleId INTEGER, RoleName TEXT);
    CREATE TABLE Menus (MenuId INTEGER, MenuPath TEXT);
    CREATE TABLE RoleRights (Id INTEGER PRIMARY KEY, RoleId INTEGER, MenuId INTEGER, CanView INTEGER, CanAdd INTEGER, CanEdit INTEGER, CanDelete INTEGER);
    INSERT INTO Roles VALUES (1,'Admin'),(2,'Accountant'),(3,'DC_SALES DELIVERY'),(4,'NC_SALES DELIVERY'),(5,'NACPL_SODA');
    INSERT INTO Menus VALUES (1,'/sales-order'),(2,'/delivery'),(3,'/dc-sales-order'),(4,'/dc-delivery'),(5,'/nc-sales-order'),(6,'/nc-delivery'),(7,'/soda-sales-order'),(8,'/soda-delivery'),(9,'/reports/company'),(10,'/unrelated');
    INSERT INTO RoleRights VALUES (1,1,3,1,1,1,1),(2,2,3,1,0,1,0),(3,1,9,0,1,1,0),(4,2,9,0,0,0,0),
      (5,3,3,1,1,1,0),(6,3,4,1,1,1,0),(7,4,5,1,1,1,0),(8,4,6,1,1,1,0),
      (9,5,7,1,1,1,0),(10,5,8,1,0,1,0),(11,5,6,0,1,1,1),(12,5,2,0,0,1,0),(13,5,10,1,1,1,0);
  `);
  const { authDb: db } = harness;
  try {
    const preserved = await db.queryRows('SELECT * FROM RoleRights WHERE RoleId IN (1,2) OR MenuId=10 ORDER BY Id');
    await db.transaction(syncStandardSalesRoleRights);
    assert.deepEqual(await db.queryRows('SELECT * FROM RoleRights WHERE RoleId IN (1,2) OR MenuId=10 ORDER BY Id'), preserved);
    assert.deepEqual(await db.queryRows('SELECT * FROM RoleRights WHERE RoleId>2 AND MenuId BETWEEN 3 AND 8'), []);
    const flags = await db.queryRows('SELECT RoleId,CanView,CanAdd,CanEdit,CanDelete FROM RoleRights WHERE RoleId>2 AND MenuId=2 ORDER BY RoleId');
    assert.deepEqual(flags, [
      { RoleId:3, CanView:1, CanAdd:1, CanEdit:1, CanDelete:0 },
      { RoleId:4, CanView:1, CanAdd:1, CanEdit:1, CanDelete:0 },
      { RoleId:5, CanView:1, CanAdd:0, CanEdit:1, CanDelete:0 },
    ]);
    assert.equal((await db.queryRows('SELECT * FROM RoleRights WHERE RoleId>2 AND MenuId=9 AND CanView=1 AND CanAdd=0 AND CanEdit=0 AND CanDelete=0')).length, 3);
    const after = await db.queryRows('SELECT * FROM RoleRights ORDER BY Id');
    assert.equal(await db.transaction(syncStandardSalesRoleRights), 0);
    assert.deepEqual(await db.queryRows('SELECT * FROM RoleRights ORDER BY Id'), after);
  } finally { harness.close(); }
});

test('retires stored variant menus, preserves report links and children, and is idempotent', async () => {
  const harness = createSqliteAuthDbTestAdapter(`
    CREATE TABLE Menus (MenuId INTEGER PRIMARY KEY, MenuPath TEXT, ParentId INTEGER REFERENCES Menus(MenuId));
    CREATE TABLE RoleRights (RoleId INTEGER, MenuId INTEGER REFERENCES Menus(MenuId));
    CREATE TABLE MenuReports (MenuId INTEGER REFERENCES Menus(MenuId), ReportId INTEGER);
    INSERT INTO Menus VALUES (1,'/sales-order',NULL),(2,'/delivery',NULL),(3,'/dc-sales-order',NULL),(4,'/nc-delivery',NULL),(5,'/custom-report',3);
    INSERT INTO RoleRights VALUES (1,3),(2,4),(1,1);
    INSERT INTO MenuReports VALUES (3,10),(4,20);
  `);
  const db = harness.authDb;
  try {
    assert.equal(await db.transaction(removeRetiredSalesMenus), 2);
    assert.deepEqual(await db.queryRows('SELECT MenuId,ParentId FROM Menus ORDER BY MenuId'), [
      { MenuId: 1, ParentId: null }, { MenuId: 2, ParentId: null }, { MenuId: 5, ParentId: 1 },
    ]);
    assert.deepEqual(await db.queryRows('SELECT * FROM MenuReports ORDER BY ReportId'), [
      { MenuId: 1, ReportId: 10 }, { MenuId: 2, ReportId: 20 },
    ]);
    assert.deepEqual(await db.queryRows('SELECT * FROM RoleRights'), [{ RoleId: 1, MenuId: 1 }]);
    assert.equal(await db.transaction(removeRetiredSalesMenus), 0);
  } finally { harness.close(); }
});
