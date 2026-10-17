// Phase 4: copy-from, committed/ordered, moving-average stock and journal
// entries for marketing documents, checked against hand-computed SAP results.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('sales and purchase documents copy, move stock and post balanced journal entries', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('post', async ({ schema, sql }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const stock = () => one(`SELECT i."OnHand", i."IsCommited", i."OnOrder", i."AvgPrice", w."OnHand" AS "WhsOnHand"
      FROM "OITM" i JOIN "OITW" w ON w."ItemCode" = i."ItemCode" AND w."WhsCode" = '01' WHERE i."ItemCode" = 'I001'`);
    const journal = async (doc) => Object.fromEntries((await sql(
      'SELECT "Account", "Debit" - "Credit" AS "Net" FROM "JDT1" WHERE "TransId" = $1 ORDER BY "Line_ID"', [doc.TransId],
    )).rows.map((row) => [row.Account, row.Net]));
    const line = (base, extra) => ({ ItemCode: 'I001', ...extra, ...(base && { BaseType: base.type, BaseEntry: base.doc.DocEntry, BaseLine: 0 }) });

    await sql(`INSERT INTO "OACT" ("AcctCode", "AcctName", "GroupMask", "FormatCode") VALUES ('130000', 'Input Tax', 1, '130000')`);
    await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C001', 'Acme Ltd', 'C', 1), ('C002', 'Other Ltd', 'C', 1), ('V001', 'Supplier', 'S', 2)`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem") VALUES ('I001', 'Widget', 1, 'Y')`);
    for (const [code, type] of [['CGST9', -100], ['SGST9', -110]]) {
      await sl('POST', '/SalesTaxAuthorities', { Code: code, Name: code, Type: type, Rate: 9, SalesTaxAccount: '210000', PurchaseTaxAccount: '130000' });
    }
    await sl('POST', '/SalesTaxCodes', { Code: 'GST18', Name: 'GST 18%', SalesTaxCodes_Lines: [{ STACode: 'CGST9' }, { STACode: 'SGST9' }] });

    // Purchase order 10 -> on order 10.
    const po = await sl('POST', '/PurchaseOrders', { CardCode: 'V001', DocDate: '2026-10-12', DocumentLines: [line(null, { Quantity: 10, UnitPrice: 100, TaxCode: 'GST18' })] });
    assert.equal((await stock()).OnOrder, 10);

    // GRPO 6 @ 100 and 4 @ 130 from the PO: stock in at document price, average (600 + 520) / 10 = 112, PO closed.
    const grpo1 = await sl('POST', '/PurchaseDeliveryNotes', { CardCode: 'V001', DocDate: '2026-10-12', DocumentLines: [line({ type: 22, doc: po }, { Quantity: 6, UnitPrice: 100, TaxCode: 'GST18' })] });
    assert.deepEqual(await journal(grpo1), { 120000: 600, 220000: -600 }, 'GRPO: inventory against allocation, no tax');
    assert.equal((await stock()).OnOrder, 4);
    assert.equal((await sl('GET', `/PurchaseOrders(${po.DocEntry})`)).DocumentLines[0].RemainingOpenQuantity, 4);
    await sl('POST', '/PurchaseDeliveryNotes', { CardCode: 'V001', DocDate: '2026-10-12', DocumentLines: [line({ type: 22, doc: po }, { Quantity: 4, UnitPrice: 130, TaxCode: 'GST18' })] });
    assert.deepEqual(await stock(), { OnHand: 10, IsCommited: 0, OnOrder: 0, AvgPrice: 112, WhsOnHand: 10 });
    assert.equal((await sl('GET', `/PurchaseOrders(${po.DocEntry})`)).DocumentStatus, 'bost_Close', 'fully received PO closes');
    assert.equal((await slFailure(sl('POST', '/PurchaseDeliveryNotes', { CardCode: 'V001', DocumentLines: [line({ type: 22, doc: po }, { Quantity: 1, UnitPrice: 1 })] })))[1],
      'Row 1: the base document row is closed.');

    // A/P invoice from GRPO 1 at 110: allocation cleared at 600, 60 price difference, input tax, vendor credited.
    const apPayload = { CardCode: 'V001', DocDate: '2026-10-12', DocumentLines: [line({ type: 20, doc: grpo1 }, { ItemCode: undefined, Quantity: 6, UnitPrice: 110, TaxCode: 'GST18' })] };
    assert.deepEqual(await slFailure(sl('POST', '/PurchaseInvoices', apPayload)),
      [400, 'Define the price difference account for item "I001" in its item group, warehouse 01 or G/L Account Determination.']);
    await sql(`UPDATE "OWHS" SET "PriceDifAc" = '500000' WHERE "WhsCode" = '01'`);
    const apInvoice = await sl('POST', '/PurchaseInvoices', apPayload);
    assert.deepEqual(await journal(apInvoice), { 200000: -778.8, 220000: 600, 500000: 60, 130000: 118.8 });
    assert.equal((await one(`SELECT "Balance" FROM "OCRD" WHERE "CardCode" = 'V001'`)).Balance, -778.8);
    assert.equal((await stock()).OnHand, 10, 'stock moved with the GRPO, not the invoice');

    // Sales order 8 -> committed 8; delivery of 5 at average cost 112 -> committed 3.
    const order = await sl('POST', '/Orders', { CardCode: 'C001', DocDate: '2026-10-12', DocumentLines: [line(null, { Quantity: 8, UnitPrice: 200, TaxCode: 'GST18' })] });
    assert.equal((await stock()).IsCommited, 8);
    assert.equal((await slFailure(sl('POST', '/DeliveryNotes', { CardCode: 'C002', DocumentLines: [line({ type: 17, doc: order }, { Quantity: 1, UnitPrice: 200 })] })))[1],
      'Row 1: the base document belongs to another business partner.');
    const delivery = await sl('POST', '/DeliveryNotes', { CardCode: 'C001', DocDate: '2026-10-12', DocumentLines: [line({ type: 17, doc: order }, { Quantity: 5, UnitPrice: 200, TaxCode: 'GST18' })] });
    assert.deepEqual(await journal(delivery), { 500000: 560, 120000: -560 });
    assert.equal(delivery.DocumentLines[0].StockPrice, 112);
    assert.deepEqual(await stock(), { OnHand: 5, IsCommited: 3, OnOrder: 0, AvgPrice: 112, WhsOnHand: 5 });

    // Negative stock is refused and leaves nothing behind.
    const nextDelivery = (await one(`SELECT "NextNumber" FROM "NNM1" WHERE "ObjectCode" = '15'`)).NextNumber;
    assert.deepEqual(await slFailure(sl('POST', '/DeliveryNotes', { CardCode: 'C001', DocumentLines: [line(null, { Quantity: 6, UnitPrice: 200 })] })),
      [400, 'Row 1: quantity falls into negative inventory for item "I001" in warehouse 01.']);
    assert.equal((await one(`SELECT "NextNumber" FROM "NNM1" WHERE "ObjectCode" = '15'`)).NextNumber, nextDelivery);
    assert.equal((await stock()).OnHand, 5);

    // Invoice from the delivery: no stock, revenue + output tax against the customer; delivery closes.
    const baseInvoiceLine = { BaseType: 15, BaseEntry: delivery.DocEntry, BaseLine: 0, Quantity: 5, UnitPrice: 200, TaxCode: 'GST18' };
    await assert.rejects(sl('POST', '/Invoices', { CardCode: 'C001', DocumentLines: [{ ...baseInvoiceLine, ItemCode: 'I001_WRONG' }] }), /the item differs from the base document row/);
    await assert.rejects(sl('POST', '/Invoices', { CardCode: 'C002', DocumentLines: [baseInvoiceLine] }), /another business partner/);
    await assert.rejects(sl('POST', '/Invoices', { CardCode: 'C001', DocumentLines: [{ ...baseInvoiceLine, BaseEntry: -1 }] }), /base document row -1\/0 does not exist/);
    await assert.rejects(sl('POST', '/Invoices', { CardCode: 'C001', DocumentLines: [{ Quantity: 1, UnitPrice: 200 }] }), /select an item/);
    const invoice = await sl('POST', '/Invoices', { CardCode: 'C001', DocDate: '2026-10-12', DocumentLines: [baseInvoiceLine] });
    assert.equal(invoice.DocumentLines[0].ItemCode, 'I001', 'item inherited from the delivery reference sent by the invoice page');
    assert.equal(invoice.DocumentLines[0].WarehouseCode, '01');
    await assert.rejects(sl('POST', '/Invoices', { CardCode: 'C001', DocumentLines: [baseInvoiceLine] }), /base document row is closed/);
    assert.deepEqual(await journal(invoice), { 110000: 1180, 400000: -1000, 210000: -180 });
    assert.equal(invoice.DocumentLines[0].StockPrice, 112, 'cost carried from the delivery');
    assert.equal((await sl('GET', `/DeliveryNotes(${delivery.DocEntry})`)).DocumentStatus, 'bost_Close');
    assert.equal((await stock()).OnHand, 5);

    // Standalone invoice: stock out at cost plus COGS.
    const direct = await sl('POST', '/Invoices', { CardCode: 'C001', DocDate: '2026-10-12', DocumentLines: [line(null, { Quantity: 2, UnitPrice: 200, TaxCode: 'ZERO' })] });
    assert.deepEqual(await journal(direct), { 110000: 400, 400000: -400, 500000: 224, 120000: -224 });

    // Credit memo for 1 from the first invoice: reverses revenue and tax, returns stock at the invoice's cost.
    const credit = await sl('POST', '/CreditNotes', { CardCode: 'C001', DocDate: '2026-10-12', DocumentLines: [line({ type: 13, doc: invoice }, { Quantity: 1, UnitPrice: 200, TaxCode: 'GST18' })] });
    assert.deepEqual(await journal(credit), { 110000: -236, 400000: 200, 210000: 36, 120000: 112, 500000: -112 });
    assert.deepEqual(await stock(), { OnHand: 4, IsCommited: 3, OnOrder: 0, AvgPrice: 112, WhsOnHand: 4 });
    assert.equal((await one(`SELECT "Balance" FROM "OCRD" WHERE "CardCode" = 'C001'`)).Balance, 1344);

    // Books agree with stock: inventory account = on hand x average; every entry balances.
    assert.equal((await one(`SELECT SUM("Debit" - "Credit") AS "Value" FROM "JDT1" WHERE "Account" = '120000'`)).Value, 4 * 112);
    assert.equal((await sql(`SELECT "TransId" FROM "JDT1" GROUP BY "TransId" HAVING SUM("Debit") <> SUM("Credit")`)).rowCount, 0);
    assert.equal((await one(`SELECT SUM("InQty" - "OutQty") AS "Qty", SUM("TransValue") AS "Value" FROM "OINM" WHERE "ItemCode" = 'I001'`)).Value, 448);

    // Posted documents keep their amounts; remarks may change.
    await sl('PATCH', `/Invoices(${invoice.DocEntry})`, { Comments: 'checked' });
    assert.equal((await slFailure(sl('PATCH', `/Invoices(${invoice.DocEntry})`, { DocumentLines: [{ LineNum: 0, Quantity: 4 }] })))[0], 400);
    assert.equal((await slFailure(sl('PATCH', `/Invoices(${invoice.DocEntry})`, { DocumentLines: [line(null, { Quantity: 1 })] })))[1], 'Rows cannot be added to a posted document.');

    // Closing the order releases what is still committed.
    await sl('POST', `/Orders(${order.DocEntry})/Close`);
    assert.equal((await stock()).IsCommited, 0);

    // Cancelling a copy gives the quantity back to its base.
    const quotation = await sl('POST', '/Quotations', { CardCode: 'C001', DocumentLines: [line(null, { Quantity: 2, UnitPrice: 200 })] });
    const fromQuote = await sl('POST', '/Orders', { CardCode: 'C001', DocumentLines: [line({ type: 23, doc: quotation }, { Quantity: 2, UnitPrice: 200 })] });
    assert.equal((await sl('GET', `/Quotations(${quotation.DocEntry})`)).DocumentStatus, 'bost_Close');
    await sl('POST', `/Orders(${fromQuote.DocEntry})/Cancel`);
    const reopened = await sl('GET', `/Quotations(${quotation.DocEntry})`);
    assert.equal(reopened.DocumentStatus, 'bost_Open');
    assert.equal(reopened.DocumentLines[0].RemainingOpenQuantity, 2);
    assert.equal((await stock()).IsCommited, 0);
  });
});
