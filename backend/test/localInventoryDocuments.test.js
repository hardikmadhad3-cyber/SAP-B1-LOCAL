// Phase 4 inventory documents: Goods Receipt, Goods Issue, Inventory Transfer and
// Transfer Request on the local engine, checked against hand-computed SAP results.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const goodsReceiptService = require('../services/goodsReceiptService');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('goods receipt, goods issue and transfers move stock at moving average and post balanced entries', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('inv', async ({ schema, sql, asUser }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const item = () => one(`SELECT "OnHand", "AvgPrice" FROM "OITM" WHERE "ItemCode" = 'I001'`);
    const whs = async (code) => (await one(`SELECT "OnHand" FROM "OITW" WHERE "ItemCode" = 'I001' AND "WhsCode" = $1`, [code]))?.OnHand ?? 0;
    const journal = async (doc) => Object.fromEntries((await sql(
      'SELECT "Account", "Debit" - "Credit" AS "Net" FROM "JDT1" WHERE "TransId" = $1 ORDER BY "Line_ID"', [doc.TransId],
    )).rows.map((row) => [row.Account, row.Net]));
    const day = '2026-10-17';

    await sql(`INSERT INTO "OACT" ("AcctCode", "AcctName", "GroupMask", "FormatCode") VALUES ('121000', 'Inventory Mumbai', 1, '121000')`);
    await sql(`INSERT INTO "OWHS" ("WhsCode", "WhsName", "BPLid", "Location", "BalInvntAc") VALUES ('02', 'Mumbai', 1, 1, '121000')`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem") VALUES ('I001', 'Widget', 1, 'Y'), ('S001', 'Service', 1, 'N')`);

    // Goods receipt 10 @ 100: inventory against the increase offset (G/L determination default 510000).
    const receipt1 = await sl('POST', '/InventoryGenEntries', { DocDate: day, Reference2: 'R-1', DocumentLines: [{ ItemCode: 'I001', Quantity: 10, Price: 100, WarehouseCode: '01' }] });
    assert.deepEqual(await journal(receipt1), { 120000: 1000, 510000: -1000 });
    assert.equal(receipt1.Reference2, 'R-1');
    assert.equal(receipt1.DocTotal, 1000);
    // Goods receipt 10 @ 130 against the row's own account: average (1000 + 1300) / 20 = 115.
    const receipt2 = await sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 10, Price: 130, WarehouseCode: '01', AccountCode: '500000' }] });
    assert.deepEqual(await journal(receipt2), { 120000: 1300, 500000: -1300 });
    assert.deepEqual(await item(), { OnHand: 20, AvgPrice: 115 });

    // Goods issue 4 at average cost 115, whatever price the page sent; the decrease offset is debited.
    const issue = await sl('POST', '/InventoryGenExits', { DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 4, Price: 999, WarehouseCode: '01' }] });
    assert.deepEqual(await journal(issue), { 510000: 460, 120000: -460 });
    assert.equal(issue.DocTotal, 460);
    assert.equal(issue.DocumentLines[0].Price, 115);
    assert.deepEqual(await item(), { OnHand: 16, AvgPrice: 115 });

    // Refusals leave nothing behind: negative stock, non-inventory item, same warehouse twice.
    const nextIssue = (await one(`SELECT "NextNumber" FROM "NNM1" WHERE "ObjectCode" = '60'`)).NextNumber;
    assert.deepEqual(await slFailure(sl('POST', '/InventoryGenExits', { DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 17, WarehouseCode: '01' }] })),
      [400, 'Row 1: quantity falls into negative inventory for item "I001" in warehouse 01.']);
    assert.equal((await one(`SELECT "NextNumber" FROM "NNM1" WHERE "ObjectCode" = '60'`)).NextNumber, nextIssue);
    assert.deepEqual(await slFailure(sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'S001', Quantity: 1, Price: 1, WarehouseCode: '01' }] })),
      [400, 'Row 1: item "S001" is not an inventory item.']);
    assert.deepEqual(await slFailure(sl('POST', '/StockTransfers', { DocDate: day, FromWarehouse: '01', ToWarehouse: '01', StockTransferLines: [{ ItemCode: 'I001', Quantity: 1 }] })),
      [400, 'Row 1: the from and to warehouses must differ.']);

    // Transfer 5 from 01 to 02 (the page's StockTransfers payload): company stock and average unchanged,
    // value moves between the warehouses' inventory accounts.
    const transfer = await sl('POST', '/StockTransfers', {
      DocDate: day, DueDate: day, FromWarehouse: '01', ToWarehouse: '02',
      StockTransferLines: [{ ItemCode: 'I001', Quantity: 5, FromWarehouseCode: '01', WarehouseCode: '02' }],
    });
    assert.deepEqual(await journal(transfer), { 121000: 575, 120000: -575 });
    assert.equal(transfer.StockTransferLines[0].FromWarehouseCode, '01');
    assert.equal(transfer.FromWarehouse, '01');
    assert.deepEqual([await whs('01'), await whs('02')], [11, 5]);
    assert.deepEqual(await item(), { OnHand: 16, AvgPrice: 115 });

    // Transfer request 3 (no stock, no entry) -> transfer copied from it closes the request.
    const request = await sl('POST', '/InventoryTransferRequests', { DocDate: day, FromWarehouse: '01', ToWarehouse: '02', StockTransferLines: [{ ItemCode: 'I001', Quantity: 3 }] });
    assert.equal(request.TransId, null);
    assert.deepEqual([await whs('01'), await whs('02')], [11, 5]);
    await sl('POST', '/StockTransfers', { DocDate: day, FromWarehouse: '01', ToWarehouse: '02',
      StockTransferLines: [{ BaseType: 1250000001, BaseEntry: request.DocEntry, BaseLine: 0, Quantity: 3 }] });
    assert.equal((await sl('GET', `/InventoryTransferRequests(${request.DocEntry})`)).DocumentStatus, 'bost_Close');
    assert.deepEqual([await whs('01'), await whs('02')], [8, 8]);

    // Both warehouses on one inventory account: stock moves, no journal entry.
    await sql(`UPDATE "OWHS" SET "BalInvntAc" = '120000' WHERE "WhsCode" = '02'`);
    const sameAccount = await sl('POST', '/StockTransfers', { DocDate: day, FromWarehouse: '02', ToWarehouse: '01', StockTransferLines: [{ ItemCode: 'I001', Quantity: 1 }] });
    assert.equal(sameAccount.TransId, null);
    assert.deepEqual([await whs('01'), await whs('02')], [9, 7]);

    // Goods receipt copied from the goods issue (page sends only the base reference): item, unit and cost
    // come from the issue row, and the issue is not consumed.
    const returned = await sl('POST', '/InventoryGenEntries', { DocDate: day,
      DocumentLines: [{ BaseType: 60, BaseEntry: issue.DocEntry, BaseLine: 0, Quantity: 2, WarehouseCode: '01' }] });
    assert.equal(returned.DocumentLines[0].ItemCode, 'I001');
    assert.deepEqual(await journal(returned), { 120000: 230, 510000: -230 });
    assert.deepEqual(await item(), { OnHand: 18, AvgPrice: 115 });

    // Posted documents: remarks and references change, quantities and dates do not.
    await sl('PATCH', `/InventoryGenExits(${issue.DocEntry})`, { Comments: 'Scrap', Reference2: 'S-9', JournalMemo: 'Scrap issue' });
    const patched = await sl('GET', `/InventoryGenExits(${issue.DocEntry})`);
    assert.deepEqual([patched.Comments, patched.Reference2, patched.DocTotal], ['Scrap', 'S-9', 460]);
    assert.match((await slFailure(sl('PATCH', `/InventoryGenExits(${issue.DocEntry})`, { DocDate: '2026-10-18' })))[1], /posted document cannot change/);

    // The Goods Receipt page's own payload, through its service.
    const { Series: series } = await one(`SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = '59'`);
    const page = await asUser(() => goodsReceiptService.createGoodsReceipt({
      header: { postingDate: day, documentDate: day, series, remarks: 'Opening count', ref2: 'GR-PAGE' },
      lines: [{ itemCode: 'I001', quantity: '2', unitPrice: '115', warehouse: '02' }],
    }));
    assert.equal(page.success, true);
    assert.deepEqual(await item(), { OnHand: 20, AvgPrice: 115 });

    // Books: every entry balances and the inventory accounts equal stock value (20 x 115).
    assert.equal((await one('SELECT COALESCE(SUM("Debit" - "Credit"), 0) AS "Net" FROM "JDT1"')).Net, 0);
    assert.equal((await one(`SELECT SUM("Debit" - "Credit") AS "Net" FROM "JDT1" WHERE "Account" IN ('120000', '121000')`)).Net, 2300);
    assert.equal((await one(`SELECT SUM("TransValue") AS "Value" FROM "OINM" WHERE "ItemCode" = 'I001'`)).Value, 2300);
  });
});
