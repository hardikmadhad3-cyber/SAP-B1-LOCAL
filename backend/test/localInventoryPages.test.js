// The Goods Receipt / Goods Issue / Inventory Transfer (Request) page services
// must read a local company without a swallowed SQL error: their `safe()` wrapper
// turns a missing column into an empty item list ("No items found").
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const { withLocalCompany } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('inventory page services read a local company (items, copy-from, transfer read-back)', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('invp', async ({ schema, sql, asUser }) => {
    await sql(`INSERT INTO "OACT" ("AcctCode", "AcctName", "GroupMask", "FormatCode") VALUES ('121000', 'Inventory Mumbai', 1, '121000')`);
    await sql(`INSERT INTO "OWHS" ("WhsCode", "WhsName", "BPLid", "Location", "BalInvntAc") VALUES ('02', 'Mumbai', 1, 1, '121000')`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem") VALUES ('I001', 'Widget', 1, 'Y')`);
    const failures = [];
    const originalError = console.error;
    console.error = (...args) => { if (/Query failed/.test(String(args[0]))) failures.push(args.join(' ')); else originalError(...args); };
    try {
      await asUser(async () => {
        const services = ['goodsReceiptDbService', 'goodsIssueDbService', 'inventoryTransferDbService', 'inventoryTransferRequestDbService'];
        for (const name of services) {
          const items = await require(`../services/${name}`).getItems();
          assert.ok(items.some((item) => (item.itemCode || item.ItemCode) === 'I001'), `${name}.getItems lists I001: ${JSON.stringify(items).slice(0, 300)} ${failures.join(' | ').slice(0, 500)}`);
        }
        const receipt = require('../services/goodsReceiptDbService');
        await receipt.getPurchaseOrders();
        await receipt.getPurchaseInvoices();

        await sql(`INSERT INTO "OSLP" ("SlpCode", "SlpName") VALUES (7, 'Asha') ON CONFLICT DO NOTHING`);
        const day = new Date().toLocaleDateString('en-CA');
        await local.request({ method: 'POST', url: '/InventoryGenEntries', data: { DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 5, Price: 10, WarehouseCode: '01' }] } }, schema);
        const transfer = (await local.request({ method: 'POST', url: '/StockTransfers', data: {
          DocDate: day, FromWarehouse: '01', ToWarehouse: '02', SalesPersonCode: 7, Comments: 'move', JournalMemo: 'IT memo',
          StockTransferLines: [{ ItemCode: 'I001', Quantity: 2 }],
        } }, schema)).data;
        const read = await require('../services/inventoryTransferDbService').getInventoryTransfer(transfer.DocEntry);
        assert.equal(read.header.salesEmployee, '7');
        assert.equal(read.header.remarks, 'move');
        assert.equal(read.header.journalRemark, 'IT memo');
        assert.equal(read.lines.length, 1);
      });
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(failures, []);
  });
});
