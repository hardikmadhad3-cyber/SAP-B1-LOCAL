// Production on the local engine: BOM -> production order -> release -> issue
// components -> receive the product -> close, through the pages' own services.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

const call = async (handler, { body = {}, params = {}, query = {} } = {}) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ body: structuredClone(body), params, query }, res);
  return res;
};
const ok = (res) => { assert.ok(res.statusCode < 300, JSON.stringify(res.body)); return res.body; };
const failure = (res) => { assert.ok(res.statusCode >= 400, `expected a failure, got ${JSON.stringify(res.body)}`); return res.body.message; };

test('BOM, production order, issue and receipt for production follow SAP rules', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('prod', async ({ schema, sql, asUser }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const day = '2026-10-19';
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem", "DfltWH") VALUES
      ('FG', 'Liquid', 1, 'Y', '01'), ('RM1', 'Base oil', 1, 'Y', '01'), ('RM2', 'Additive', 1, 'Y', '01'), ('NOBOM', 'Loose', 1, 'Y', '01')`);
    await sql(`INSERT INTO "ITM1" ("ItemCode", "PriceList", "Price") VALUES ('RM1', 1, 50), ('RM2', 1, 20)`);
    await sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [
      { ItemCode: 'RM1', Quantity: 100, Price: 40, WarehouseCode: '01' }, { ItemCode: 'RM2', Quantity: 100, Price: 10, WarehouseCode: '01' }] });

    const bom = require('../controllers/bomController');
    const orders = require('../services/productionOrderService');
    const issues = require('../services/issueForProductionService');
    const receipts = require('../services/receiptFromProductionService');
    const production = require('../services/productionDbService');
    const masters = require('../services/masterDataDbService');

    await asUser(async () => {
      const series = async (object) => (await production.lookupSeriesContext(object, day, '')).series[0].Series;
      const s202 = await series('202');
      const s60 = await series('60');
      const s59 = await series('59');
      // BOM: 1 FG = 2 RM1 + 1 RM2, priced from the price list; the item becomes a production BOM item.
      const created = ok(await call(bom.createBOM, { body: { TreeCode: 'FG', TreeType: 'iProductionTree', Quantity: 1, PriceList: 1,
        ProductTreeLines: [{ ItemCode: 'RM1', Quantity: 2 }, { ItemCode: 'RM2', Quantity: 1, IssueMethod: 'im_Manual' }, { ItemType: 'pit_Text', LineText: 'Mix well' }] } }));
      assert.equal(created.ProductDescription, 'Liquid');
      assert.deepEqual(created.ProductTreeLines.map((l) => [l.ItemCode, Number(l.Quantity), Number(l.Price), l.ItemType]),
        [['RM1', 2, 50, 'pit_Item'], ['RM2', 1, 20, 'pit_Item'], ['', 0, 0, 'pit_Text']]);
      assert.equal((await one(`SELECT "TreeType" FROM "OITM" WHERE "ItemCode" = 'FG'`)).TreeType, 'P');
      assert.equal((await masters.listBOMs('FG'))[0].TreeCode, 'FG');
      assert.match(failure(await call(bom.createBOM, { body: { TreeCode: 'FG', ProductTreeLines: [{ ItemCode: 'RM1', Quantity: 1 }] } })), /already exists/);
      assert.match(failure(await call(bom.createBOM, { body: { TreeCode: 'RM1', ProductTreeLines: [{ ItemCode: 'FG', Quantity: 1 }] } })), /Circular/);
      assert.match(failure(await call(bom.createBOM, { body: { TreeCode: 'NOBOM', ProductTreeLines: [{ ItemCode: 'XX', Quantity: 1 }] } })), /does not exist/);
      ok(await call(bom.updateBOM, { params: { treeCode: 'FG' }, body: { TreeCode: 'FG', Quantity: 1, PriceList: 1,
        ProductTreeLines: [{ ItemCode: 'RM1', Quantity: 2 }, { ItemCode: 'RM2', Quantity: 1 }] } }));

      // Production order for 10 FG: rows scaled from the BOM; numbered from the 202 series.
      await assert.rejects(orders.createProductionOrder({ item_code: 'NOBOM', planned_qty: 1, due_date: day, posting_date: day, warehouse: '01', series: s202 }), /bill of materials/i);
      const order = await orders.createProductionOrder({ item_code: 'FG', planned_qty: 10, due_date: day, posting_date: day, warehouse: '01', series: s202, status: 'boposPlanned' });
      const entry = order.doc_entry;
      assert.ok(entry && order.doc_num);
      let detail = (await production.getProductionOrderByDocEntry(entry)).production_order;
      assert.deepEqual(detail.lines.map((l) => [l.item_code, Number(l.planned_qty)]), [['RM1', 20], ['RM2', 10]]);

      // Planned orders cannot be issued; edits are allowed only while planned.
      assert.match((await slFailure(sl('POST', '/InventoryGenExits', { DocDate: day, Series: s60, DocumentLines: [{ BaseType: 202, BaseEntry: entry, BaseLine: 0, Quantity: 1 }] })))[1], /not released/);
      await orders.releaseProductionOrder(entry);
      assert.match((await slFailure(sl('PATCH', `/ProductionOrders(${entry})`, { PlannedQuantity: 12 })))[1], /Only planned/);

      // Issue 20 RM1 @ 40 and 10 RM2 @ 10 = 900 into WIP.
      const issue = await issues.createIssue({ prod_order_entry: entry, posting_date: day, series: s60,
        lines: [{ base_line: 0, item_code: 'RM1', issue_qty: 20, warehouse: '01' }, { base_line: 1, item_code: 'RM2', issue_qty: 10, warehouse: '01' }] });
      assert.ok(issue.doc_entry);
      detail = (await production.getProductionOrderByDocEntry(entry)).production_order;
      assert.deepEqual(detail.lines.map((l) => Number(l.issued_qty)), [20, 10]);
      assert.equal(Number((await one(`SELECT "OnHand" FROM "OITM" WHERE "ItemCode" = 'RM1'`)).OnHand), 80);
      assert.equal((await production.getIssueList({})).issues.length, 1);

      // Receive 4 then 6 FG: valued at the issued cost per open unit (900 / 10 = 90).
      const forReceipt = await production.getProductionOrderForReceipt(entry);
      assert.equal(Number(forReceipt.remaining_qty), 10);
      await receipts.createReceipt({ prod_order_entry: entry, posting_date: day, series: s59, lines: [{ base_line: 0, item_code: 'FG', quantity: 4, warehouse: '01' }] });
      await receipts.createReceipt({ prod_order_entry: entry, posting_date: day, series: s59, lines: [{ base_line: 0, item_code: 'FG', quantity: 6, warehouse: '01' }] });
      const fg = await one(`SELECT "OnHand", "AvgPrice" FROM "OITM" WHERE "ItemCode" = 'FG'`);
      assert.deepEqual([Number(fg.OnHand), Number(fg.AvgPrice)], [10, 90]);
      assert.equal(Number((await one('SELECT "CmpltQty" FROM "OWOR" WHERE "DocEntry" = $1', [entry])).CmpltQty), 10);
      assert.equal((await production.getReceiptList({})).receipts.length, 2);
      // The other readers the production pages use work on posted data.
      assert.equal((await production.getIssueByDocEntry(issue.doc_entry)).issue.lines.length, 2);
      const firstReceipt = (await production.getReceiptList({})).receipts[0];
      assert.ok((await production.getReceiptByDocEntry(firstReceipt.doc_entry ?? firstReceipt.DocEntry)).receipt);
      assert.ok(await production.getProductionOrderForIssue(entry));
      assert.ok((await production.lookupOpenProductionOrders('', true)).length >= 1);
      assert.equal((await production.explodeBOM('FG', 5)).lines.length, 2);
      assert.ok((await production.lookupProductionOrderItems('')).some((row) => (row.ItemCode ?? row.item_code ?? row.code) === 'FG'));
      await production.lookupFinishItems('');
      await production.lookupComponentItems('');
      const bomReport = await require('../services/reports/billOfMaterials.service').getBillOfMaterialsReport({
        itemFrom: '', itemTo: '', groupCode: 'All', bomType: 'All',
        propertyFilter: { ignoreProperties: true, linkMode: 'and', exactlyMatch: false, selectedPropertyNumbers: [] } });
      assert.ok(JSON.stringify(bomReport).includes('RM1'), 'BOM report lists the components');
      const openItems = await require('../services/reports/productionOpenItems.service').getProductionOpenItemsReport({ status: 'open', query: '' });
      assert.ok(openItems.rows.some((row) => row.docEntry === entry && row.status === 'Released'), 'open items report lists the released order');

      // Cancelling the issue is blocked once the order is closed; a closed order takes no more postings.
      await orders.closeProductionOrder(entry);
      assert.match((await slFailure(sl('POST', `/InventoryGenExits(${issue.doc_entry})/Cancel`)))[1], /not released/);
      assert.match((await slFailure(sl('PATCH', `/ProductionOrders(${entry})`, { ProductionOrderStatus: 'boposReleased' })))[1], /cannot change from Closed/);

      // Cancel: allowed for an order without postings, refused once components were issued.
      const spare = await orders.createProductionOrder({ item_code: 'FG', planned_qty: 1, due_date: day, posting_date: day, warehouse: '01', series: s202, status: 'boposReleased' });
      await issues.createIssue({ prod_order_entry: spare.doc_entry, posting_date: day, series: s60, lines: [{ base_line: 0, item_code: 'RM1', issue_qty: 2, warehouse: '01' }] });
      assert.match((await slFailure(sl('PATCH', `/ProductionOrders(${spare.doc_entry})`, { ProductionOrderStatus: 'boposCancelled' })))[1], /close it instead/);
      const empty = await orders.createProductionOrder({ item_code: 'FG', planned_qty: 1, due_date: day, posting_date: day, warehouse: '01', series: s202 });
      await sl('PATCH', `/ProductionOrders(${empty.doc_entry})`, { ProductionOrderStatus: 'boposCancelled' });
      assert.equal((await one('SELECT "Status" FROM "OWOR" WHERE "DocEntry" = $1', [empty.doc_entry])).Status, 'C');

      // A BOM can be deleted; the item stops being a BOM item.
      ok(await call(bom.deleteBOM, { params: { treeCode: 'FG' } }));
      assert.equal((await one(`SELECT "TreeType" FROM "OITM" WHERE "ItemCode" = 'FG'`)).TreeType, 'N');
    });
  });
});

test('backflush, by-products, disassembly, batch components and the closing variance', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('prod2', async ({ schema, sql, asUser }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const onHand = async (item) => Number((await one('SELECT "OnHand" FROM "OITM" WHERE "ItemCode" = $1', [item])).OnHand);
    const day = '2026-10-19';
    // Migration 017 on a chart where 530000 is already another account (as in Demo Trading):
    // the variance account goes to the next free code.
    await sql(`UPDATE "OACP" SET "WipVarAcct" = NULL`);
    await sql(`UPDATE "OACT" SET "AcctName" = 'Purchase Price Difference' WHERE "AcctCode" = '530000'`);
    await sql(require('node:fs').readFileSync(require('node:path').join(__dirname, '../db/company-migrations/017_batches_serials_wip.sql'), 'utf8'));
    assert.deepEqual(Object.values(await one('SELECT "WipAcct", "WipVarAcct" FROM "OACP" LIMIT 1')), ['125000', '535000']);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem", "DfltWH", "ManBtchNum") VALUES
      ('FG', 'Liquid', 1, 'Y', '01', 'N'), ('RM1', 'Base oil', 1, 'Y', '01', 'N'), ('RM2', 'Additive', 1, 'Y', '01', 'N'),
      ('BYP', 'Sludge', 1, 'Y', '01', 'N'), ('RMB', 'Batch resin', 1, 'Y', '01', 'Y')`);
    await sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [
      { ItemCode: 'RM1', Quantity: 100, Price: 40, WarehouseCode: '01' }, { ItemCode: 'RM2', Quantity: 100, Price: 10, WarehouseCode: '01' },
      { ItemCode: 'BYP', Quantity: 1, Price: 5, WarehouseCode: '01' }, { ItemCode: 'FG', Quantity: 5, Price: 90, WarehouseCode: '01' },
      { ItemCode: 'RMB', Quantity: 10, Price: 7, WarehouseCode: '01', BatchNumbers: [{ BatchNumber: 'R1', Quantity: 10 }] }] });

    const bom = require('../controllers/bomController');
    const orders = require('../services/productionOrderService');
    const issues = require('../services/issueForProductionService');
    const receipts = require('../services/receiptFromProductionService');
    const production = require('../services/productionDbService');

    await asUser(async () => {
      const series = async (object) => (await production.lookupSeriesContext(object, day, '')).series[0].Series;
      const [s202, s60, s59] = [await series('202'), await series('60'), await series('59')];
      const base = { due_date: day, posting_date: day, warehouse: '01', series: s202 };
      // 1 FG = 2 RM1 (manual) + 1 RM2 (backflush).
      ok(await call(bom.createBOM, { body: { TreeCode: 'FG', Quantity: 1, ProductTreeLines: [
        { ItemCode: 'RM1', Quantity: 2 }, { ItemCode: 'RM2', Quantity: 1, IssueMethod: 'im_Backflush' }] } }));
      await assert.rejects(orders.createProductionOrder({ ...base, item_code: 'FG', planned_qty: 1, type: 'bopotSpecial',
        lines: [{ item_code: 'RMB', planned_qty: 1, issue_method: 'im_Backflush' }] }), /cannot be backflushed/);

      // Backflush: receiving 4 FG issues 4 RM2 by itself; FG is valued with them: (8 x 40 + 4 x 10) / 4 = 90.
      const order = await orders.createProductionOrder({ ...base, item_code: 'FG', planned_qty: 4, status: 'boposReleased' });
      await issues.createIssue({ prod_order_entry: order.doc_entry, posting_date: day, series: s60,
        lines: [{ base_line: 0, item_code: 'RM1', issue_qty: 8, warehouse: '01' }] });
      await receipts.createReceipt({ prod_order_entry: order.doc_entry, posting_date: day, series: s59, lines: [{ base_line: 0, item_code: 'FG', quantity: 4, warehouse: '01' }] });
      assert.equal(await onHand('RM2'), 96);
      const lines = (await production.getProductionOrderByDocEntry(order.doc_entry)).production_order.lines;
      assert.deepEqual(lines.map((l) => Number(l.issued_qty)), [8, 4]);
      const receiptRow = await one('SELECT "Price" FROM "IGN1" WHERE "BaseEntry" = $1 AND "BaseType" = 202', [order.doc_entry]);
      assert.equal(Number(receiptRow.Price), 90);
      // Fully received: closing posts no variance.
      await orders.closeProductionOrder(order.doc_entry);
      assert.equal((await one('SELECT "TransId" FROM "OWOR" WHERE "DocEntry" = $1', [order.doc_entry])).TransId, null);

      // Special order with a batch component and a by-product (planned -1, received at its item cost 5).
      const special = await orders.createProductionOrder({ ...base, item_code: 'FG', planned_qty: 1, type: 'bopotSpecial', status: 'boposReleased',
        lines: [{ item_code: 'RMB', planned_qty: 2, warehouse: '01' }, { item_code: 'BYP', planned_qty: -1, warehouse: '01' }] });
      await assert.rejects(issues.createIssue({ prod_order_entry: special.doc_entry, posting_date: day, series: s60,
        lines: [{ base_line: 0, item_code: 'RMB', issue_qty: 2, warehouse: '01' }] }), /batch/i);
      await issues.createIssue({ prod_order_entry: special.doc_entry, posting_date: day, series: s60,
        lines: [{ base_line: 0, item_code: 'RMB', issue_qty: 2, warehouse: '01', batch_numbers: [{ batch_number: 'R1', quantity: 2 }] }] });
      assert.equal(Number((await one(`SELECT "Quantity" FROM "OIBT" WHERE "ItemCode" = 'RMB' AND "BatchNum" = 'R1'`)).Quantity), 8);
      await receipts.createReceipt({ prod_order_entry: special.doc_entry, posting_date: day, series: s59, lines: [
        { base_line: 0, item_code: 'FG', quantity: 1, warehouse: '01' }, { base_line: 0, item_code: 'BYP', quantity: 1, warehouse: '01', by_product: true }] });
      assert.equal(await onHand('BYP'), 2);
      const byProductRow = await one('SELECT "IssuedQty" FROM "WOR1" WHERE "DocEntry" = $1 AND "ItemCode" = $2', [special.doc_entry, 'BYP']);
      assert.equal(Number(byProductRow.IssuedQty), -1);
      // WIP: 14 issued; FG received at the 14 open, BYP at 5 -> WIP -5; closing clears it to variance.
      await orders.closeProductionOrder(special.doc_entry);
      const variance = (await sql(`SELECT j."Account", j."Debit" - j."Credit" AS "Net" FROM "JDT1" j JOIN "OWOR" o ON o."TransId" = j."TransId"
        WHERE o."DocEntry" = $1 ORDER BY j."Account"`, [special.doc_entry])).rows.map((r) => [r.Account, Number(r.Net)]);
      assert.deepEqual(variance, [['125000', 5], ['535000', -5]]);

      // Disassembly: issue 2 FG, receive the components at their item cost.
      const fgBefore = await onHand('FG');
      const dis = await orders.createProductionOrder({ ...base, item_code: 'FG', planned_qty: 2, type: 'bopotDisassemble', status: 'boposReleased' });
      const forIssue = await production.getProductionOrderForIssue(dis.doc_entry);
      assert.deepEqual(forIssue.lines.map((l) => [l.item_code, Number(l.issue_qty)]), [['FG', 2]]);
      await issues.createIssue({ prod_order_entry: dis.doc_entry, posting_date: day, series: s60,
        lines: forIssue.lines.map((l) => ({ ...l, issue_qty: 2 })) });
      assert.equal(await onHand('FG'), fgBefore - 2);
      const forReceipt = await production.getProductionOrderForReceipt(dis.doc_entry);
      assert.deepEqual(forReceipt.receipt_lines.map((l) => [l.item_code, Number(l.quantity)]), [['RM1', 4], ['RM2', 2]]);
      await receipts.createReceipt({ prod_order_entry: dis.doc_entry, posting_date: day, series: s59, lines: forReceipt.receipt_lines });
      const disLines = (await production.getProductionOrderByDocEntry(dis.doc_entry)).production_order.lines;
      assert.deepEqual(disLines.map((l) => Number(l.issued_qty)), [4, 2]);
      assert.equal(Number((await one('SELECT "CmpltQty" FROM "OWOR" WHERE "DocEntry" = $1', [dis.doc_entry])).CmpltQty), 2);
      await orders.closeProductionOrder(dis.doc_entry);
    });
  });
});

test('resources, route stages, sales order link, cancel, summary and browsing on the production pages', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('prod3', async ({ schema, sql, asUser }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const day = '2026-10-19';
    await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C001', 'Acme Ltd', 'C', 1)`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem", "SellItem", "DfltWH") VALUES
      ('FG', 'Liquid', 1, 'Y', 'Y', '01'), ('RM1', 'Base oil', 1, 'Y', 'Y', '01'), ('KIT', 'Gift kit', 1, 'N', 'Y', '01')`);
    await sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'RM1', Quantity: 100, Price: 40, WarehouseCode: '01' }] });
    const salesOrder = await sl('POST', '/Orders', { CardCode: 'C001', DocDate: day, DocumentLines: [{ ItemCode: 'FG', Quantity: 3, UnitPrice: 500 }] });

    const bom = require('../controllers/bomController');
    const orders = require('../services/productionOrderService');
    const issues = require('../services/issueForProductionService');
    const receipts = require('../services/receiptFromProductionService');
    const production = require('../services/productionDbService');
    const masters = require('../services/masterDataDbService');
    const setup = require('../services/localSetupService');

    await asUser(async () => {
      const series = async (object) => (await production.lookupSeriesContext(object, day, '')).series[0].Series;
      const [s202, s60, s59] = [await series('202'), await series('60'), await series('59')];
      const base = { due_date: day, posting_date: day, warehouse: '01', series: s202 };

      // Setup pages: resource group, resource (25 per hour, absorbed into G/L determination's 540000), route stages.
      await setup.save('resource-groups', null, { ResGrpNam: 'Labour', ResType: 'L' });
      const group = (await setup.list('resource-groups')).rows[0];
      await setup.save('resources', null, { ResCode: 'LAB', ResName: 'Mixing labour', ResType: 'L', ResGrpCod: group.ResGrpCod, StdCost: 25, IssueMthd: 'M', DfltWH: '01' });
      await assert.rejects(setup.save('resources', null, { ResCode: 'RM1', ResName: 'Clash' }), /already an item code/);
      await setup.save('route-stages', null, { Code: 'MIX', Desc: 'Mixing' });
      await setup.save('route-stages', null, { Code: 'PACK', Desc: 'Packing' });
      const stages = (await setup.list('route-stages')).rows;
      assert.equal((await one('SELECT "ResAcct" FROM "OACP" LIMIT 1')).ResAcct, '540000');

      // BOM with two route stages, an item row and a resource row; standard cost rolls up (2 x 40 + 0.5 x 25 = 92.5).
      ok(await call(bom.createBOM, { body: { TreeCode: 'FG', Quantity: 1,
        ProductTreeStages: stages.map((stage) => ({ StageEntry: stage.AbsEntry })),
        ProductTreeLines: [{ ItemCode: 'RM1', Quantity: 2, StageID: 1 }, { ItemCode: 'LAB', ItemType: 'pit_Resource', Quantity: 0.5, StageID: 2 }] } }));
      const loadedBom = await masters.getBOM('FG');
      assert.deepEqual(loadedBom.ProductTreeStages.map((stage) => [stage.StageID, stage.Name]), [[1, 'Mixing'], [2, 'Packing']]);
      assert.deepEqual(loadedBom.ProductTreeLines.map((line) => [line.ItemCode, line.ItemType]), [['RM1', 'pit_Item'], ['LAB', 'pit_Resource']]);
      assert.equal(Number(loadedBom.ProductionStdCost), 92.5);
      // BOM report: a lone "From" starts the range; rows carry their route stage.
      const report = await require('../services/reports/billOfMaterials.service').getBillOfMaterialsReport({ itemFrom: 'FG', itemTo: '', groupCode: 'All', bomType: 'All',
        propertyFilter: { ignoreProperties: true, linkMode: 'and', exactlyMatch: false, selectedPropertyNumbers: [] } });
      const fgReport = report.rows.find((row) => (row.itemCode ?? row.ItemCode) === 'FG');
      assert.deepEqual(fgReport.children.map((child) => [child.itemCode, child.extendedQuantity, child.routeStage]), [['RM1', 2, 'Mixing'], ['LAB', 0.5, 'Packing']]);
      assert.match(failure(await call(bom.updateBOM, { params: { treeCode: 'FG' }, body: { TreeCode: 'FG', Quantity: 1,
        ProductTreeLines: [{ ItemCode: 'RM1', Quantity: 2, StageID: 9 }] } })), /route stage 9/);
      // BOM types: a sales BOM sells a non-inventory item and has no resources.
      assert.match(failure(await call(bom.createBOM, { body: { TreeCode: 'RM1', TreeType: 'iSalesTree', ProductTreeLines: [{ ItemCode: 'KIT', Quantity: 1 }] } })), /sales BOM needs/);
      assert.match(failure(await call(bom.createBOM, { body: { TreeCode: 'KIT', TreeType: 'iSalesTree',
        ProductTreeLines: [{ ItemCode: 'LAB', ItemType: 'pit_Resource', Quantity: 1 }] } })), /resources can only/);
      ok(await call(bom.createBOM, { body: { TreeCode: 'KIT', TreeType: 'iSalesTree', HideBOMComponentsInPrintout: 'tYES', ProductTreeLines: [{ ItemCode: 'RM1', Quantity: 1 }] } }));
      assert.equal((await masters.getBOM('KIT')).HideBOMComponentsInPrintout, 'tYES');

      // Order linked to the sales order: origin, number and customer saved; stages copied from the BOM; the signed-in user stamped.
      const order = await orders.createProductionOrder({ ...base, item_code: 'FG', planned_qty: 10, status: 'boposReleased',
        linked_to: 'sales_order', linked_order_entry: salesOrder.DocEntry });
      let detail = (await production.getProductionOrderByDocEntry(order.doc_entry)).production_order;
      assert.deepEqual([detail.origin, detail.linked_to, detail.origin_num, detail.customer_code], ['Sales Order', 'sales_order', String(salesOrder.DocNum), 'C001']);
      assert.ok(detail.user, 'the signed-in user is the order user');
      assert.equal(detail.stages.length, 2);
      assert.deepEqual(detail.lines.map((line) => [line.item_code, line.component_type, Number(line.planned_qty), Number(line.base_ratio)]),
        [['RM1', 'pit_Item', 20, 2], ['LAB', 'pit_Resource', 5, 0.5]]);

      // Resource issue: 5 hours x 25 = 125 into WIP against the resource account; RM1 issued from two orders in one document.
      const second = await orders.createProductionOrder({ ...base, item_code: 'FG', planned_qty: 1, status: 'boposReleased' });
      const forIssue = await production.getProductionOrderForIssue(order.doc_entry);
      assert.deepEqual(forIssue.lines.map((line) => line.component_type), ['pit_Item', 'pit_Resource']);
      const issue = await issues.createIssue({ prod_order_entry: order.doc_entry, posting_date: day, series: s60, lines: [
        { base_entry: order.doc_entry, base_line: 0, item_code: 'RM1', issue_qty: 20, warehouse: '01' },
        { base_entry: order.doc_entry, base_line: 1, item_code: 'LAB', issue_qty: 5, warehouse: '01' },
        { base_entry: second.doc_entry, base_line: 0, item_code: 'RM1', issue_qty: 2, warehouse: '01' }] });
      const journal = (await sql(`SELECT j."Account", SUM(j."Debit" - j."Credit") AS "Net" FROM "JDT1" j JOIN "OIGE" h ON h."TransId" = j."TransId"
        WHERE h."DocEntry" = $1 GROUP BY j."Account" ORDER BY j."Account"`, [issue.doc_entry])).rows.map((r) => [r.Account, Number(r.Net)]);
      assert.deepEqual(journal, [['120000', -880], ['125000', 1005], ['540000', -125]]);
      assert.equal(Number((await one('SELECT "IssuedQty" FROM "WOR1" WHERE "DocEntry" = $1 AND "LineNum" = 0', [second.doc_entry])).IssuedQty), 2);
      detail = (await production.getProductionOrderByDocEntry(order.doc_entry)).production_order;
      assert.deepEqual([detail.summary.actual_component_cost, detail.summary.actual_resource_cost, detail.summary.planned_resource_cost], [800, 125, 125]);

      // Receipt then its cancellation: completed quantity goes back.
      const receipt = await receipts.createReceipt({ prod_order_entry: order.doc_entry, posting_date: day, series: s59,
        lines: [{ base_line: 0, item_code: 'FG', quantity: 4, warehouse: '01', unit_price: 0 }] });
      assert.equal(Number((await one('SELECT "Price" FROM "IGN1" WHERE "DocEntry" = $1', [receipt.doc_entry])).Price), 92.5, 'valued from WIP, not the page price');
      await receipts.cancelReceipt(receipt.doc_entry);
      assert.equal(Number((await one('SELECT "CmpltQty" FROM "OWOR" WHERE "DocEntry" = $1', [order.doc_entry])).CmpltQty), 0);
      assert.equal((await production.getReceiptList({})).receipts.find((row) => row.doc_entry === receipt.doc_entry).cancelled, true);
      detail = (await production.getProductionOrderByDocEntry(order.doc_entry)).production_order;
      assert.deepEqual(detail.related_documents.map((doc) => [doc.type, doc.cancelled]), [['Issue for Production', false], ['Receipt from Production', true]]);

      // Close on an actual closing date: the whole WIP (925) posts to variance on that date.
      await orders.closeProductionOrder(order.doc_entry, { closing_date: '2026-10-20' });
      detail = (await production.getProductionOrderByDocEntry(order.doc_entry)).production_order;
      assert.equal(detail.closing_date, '2026-10-20');
      assert.equal(detail.summary.total_variance, 925);
      assert.equal((await one('SELECT "RefDate"::text AS d FROM "OJDT" WHERE "TransId" = $1', [detail.summary.variance_trans_id])).d, '2026-10-20');
      await assert.rejects(issues.cancelIssue(issue.doc_entry), /not released/);

      // Cancel an order without postings; text rows survive a reload.
      const spare = await orders.createProductionOrder({ ...base, item_code: 'FG', planned_qty: 1, type: 'bopotSpecial',
        lines: [{ item_code: 'RM1', planned_qty: 1, warehouse: '01' }, { component_type: 'pit_Text', line_text: 'Check viscosity' }] });
      const spareLines = (await production.getProductionOrderByDocEntry(spare.doc_entry)).production_order.lines;
      assert.deepEqual(spareLines.map((line) => line.component_type), ['pit_Item', 'pit_Text']);
      await orders.cancelProductionOrder(spare.doc_entry);
      assert.equal((await one('SELECT "Status" FROM "OWOR" WHERE "DocEntry" = $1', [spare.doc_entry])).Status, 'C');
      await assert.rejects(orders.cancelProductionOrder(second.doc_entry), /close it instead/);

      // Browsing: first / next / last.
      const first = await production.navigateRecord('production-order', 'first');
      assert.equal(first, order.doc_entry);
      assert.equal(await production.navigateRecord('production-order', 'next', first), second.doc_entry);
      assert.equal(await production.navigateRecord('production-order', 'last'), spare.doc_entry);
      assert.equal(await production.navigateRecord('bom', 'first'), 'FG');
      assert.equal(await production.navigateRecord('issue-for-production', 'last'), issue.doc_entry);
    });
  });
});
