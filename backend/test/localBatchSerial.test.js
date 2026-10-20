// Batch and serial numbers on the local engine: receipts create them, issues and
// transfers take them from the warehouse, cancellations reverse them exactly.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('batch and serial items move through receipts, issues, transfers and cancellations', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('lot', async ({ schema, sql, asUser }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const batchQty = async (batch, whs = '01') => Number((await one(`SELECT "Quantity" FROM "OIBT" WHERE "ItemCode" = 'B1' AND "BatchNum" = $1 AND "WhsCode" = $2`, [batch, whs]))?.Quantity ?? 0);
    const serialWhs = async (serial) => (await one(`SELECT q."WhsCode" FROM "OSRN" n JOIN "OSRQ" q ON q."ItemCode" = n."ItemCode" AND q."SysNumber" = n."SysNumber"
      WHERE n."ItemCode" = 'S1' AND n."DistNumber" = $1 AND q."Quantity" > 0`, [serial]))?.WhsCode ?? null;
    const day = '2026-10-19';
    await sql(`INSERT INTO "OWHS" ("WhsCode", "WhsName", "BPLid", "Location", "BalInvntAc") VALUES ('02', 'Second', 1, 1, '120000')`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem", "ManBtchNum", "ManSerNum") VALUES
      ('B1', 'Batch item', 1, 'Y', 'Y', 'N'), ('S1', 'Serial item', 1, 'Y', 'N', 'Y')`);

    // Batches: the receipt names them; quantities must add up to the row.
    assert.match((await slFailure(sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'B1', Quantity: 10, Price: 5, WarehouseCode: '01' }] })))[1], /enter the batch numbers/);
    assert.match((await slFailure(sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'B1', Quantity: 10, Price: 5, WarehouseCode: '01',
      BatchNumbers: [{ BatchNumber: 'L1', Quantity: 4 }] }] })))[1], /must equal the row quantity/);
    const receipt = await sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'B1', Quantity: 10, Price: 5, WarehouseCode: '01',
      BatchNumbers: [{ BatchNumber: 'L1', Quantity: 6, ExpiryDate: '2027-01-31' }, { BatchNumber: 'L2', Quantity: 4 }] }] });
    assert.deepEqual([await batchQty('L1'), await batchQty('L2')], [6, 4]);
    assert.equal((await one(`SELECT "ExpDate"::text AS d FROM "OBTN" WHERE "DistNumber" = 'L1'`)).d, '2027-01-31');

    // Issue takes from the named batch; more than the batch holds is refused.
    assert.match((await slFailure(sl('POST', '/InventoryGenExits', { DocDate: day, DocumentLines: [{ ItemCode: 'B1', Quantity: 5, WarehouseCode: '01',
      BatchNumbers: [{ BatchNumber: 'L2', Quantity: 5 }] }] })))[1], /has only 4/);
    const issue = await sl('POST', '/InventoryGenExits', { DocDate: day, DocumentLines: [{ ItemCode: 'B1', Quantity: 3, WarehouseCode: '01',
      BatchNumbers: [{ BatchNumber: 'L1', Quantity: 3 }] }] });
    assert.equal(await batchQty('L1'), 3);

    // Transfer moves the batch between warehouses.
    await sl('POST', '/StockTransfers', { DocDate: day, FromWarehouse: '01', ToWarehouse: '02', StockTransferLines: [{ ItemCode: 'B1', Quantity: 2,
      FromWarehouseCode: '01', WarehouseCode: '02', BatchNumbers: [{ BatchNumber: 'L2', Quantity: 2 }] }] });
    assert.deepEqual([await batchQty('L2', '01'), await batchQty('L2', '02')], [2, 2]);

    // The pages' batch lookups read the same stock.
    await asUser(async () => {
      const lookup = await require('../services/goodsIssueDbService').getBatchesByItem('B1', '01');
      assert.deepEqual(lookup.batches.map((b) => [b.BatchNumber, Number(b.AvailableQty)]).sort(), [['L1', 3], ['L2', 2]]);
    });

    // Cancelling the issue puts the batch back; the receipt cannot be cancelled while its batch is used elsewhere.
    await sl('POST', `/InventoryGenExits(${issue.DocEntry})/Cancel`);
    assert.equal(await batchQty('L1'), 6);
    assert.match((await slFailure(sl('POST', `/InventoryGenEntries(${receipt.DocEntry})/Cancel`)))[1], /batch "L2".*has only 2/);

    // Serials: one per unit, unique while in stock; issues need a serial that is in that warehouse.
    assert.match((await slFailure(sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'S1', Quantity: 2, Price: 100, WarehouseCode: '01',
      SerialNumbers: [{ InternalSerialNumber: 'SN1' }] }] })))[1], /enter 2 serial/);
    await sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'S1', Quantity: 2, Price: 100, WarehouseCode: '01',
      SerialNumbers: [{ InternalSerialNumber: 'SN1' }, { InternalSerialNumber: 'SN2' }] }] });
    assert.match((await slFailure(sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'S1', Quantity: 1, Price: 100, WarehouseCode: '02',
      SerialNumbers: [{ InternalSerialNumber: 'SN1' }] }] })))[1], /already in stock/);
    assert.match((await slFailure(sl('POST', '/InventoryGenExits', { DocDate: day, DocumentLines: [{ ItemCode: 'S1', Quantity: 1, WarehouseCode: '01',
      SerialNumbers: [{ InternalSerialNumber: 'SN9' }] }] })))[1], /not in stock/);
    const serialIssue = await sl('POST', '/InventoryGenExits', { DocDate: day, DocumentLines: [{ ItemCode: 'S1', Quantity: 1, WarehouseCode: '01',
      SerialNumbers: [{ InternalSerialNumber: 'SN1' }] }] });
    assert.equal(await serialWhs('SN1'), null);
    assert.equal((await one(`SELECT "Status" FROM "OSRI" WHERE "IntrSerial" = 'SN1'`)).Status, 1);
    await sl('POST', `/InventoryGenExits(${serialIssue.DocEntry})/Cancel`);
    assert.equal(await serialWhs('SN1'), '01');
    assert.equal((await one(`SELECT "Status" FROM "OSRI" WHERE "IntrSerial" = 'SN1'`)).Status, 0);
  });
});
