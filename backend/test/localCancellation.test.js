// Cancelling posted documents and payments on the local engine (SAP rules):
// a cancellation document reverses stock at the original values and the journal
// entry, base documents reopen, and documents in use by targets or payments are refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('posted documents and payments cancel with full reversal', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('cnl', async ({ schema, sql }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const item = () => one(`SELECT "OnHand", "IsCommited", "AvgPrice" FROM "OITM" WHERE "ItemCode" = 'I001'`);
    const whs = async (code) => (await one(`SELECT "OnHand" FROM "OITW" WHERE "ItemCode" = 'I001' AND "WhsCode" = $1`, [code]))?.OnHand ?? 0;
    const balance = async () => (await one(`SELECT "Balance" FROM "OCRD" WHERE "CardCode" = 'C001'`)).Balance;
    const net = async (account) => (await one('SELECT COALESCE(SUM("Debit" - "Credit"), 0) AS "Net" FROM "JDT1" WHERE "Account" = $1', [account])).Net;
    const failure = async (promise) => (await slFailure(promise))[1];
    const day = '2026-10-17';

    await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C001', 'Acme Ltd', 'C', 1)`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem") VALUES ('I001', 'Widget', 1, 'Y')`);
    await sql(`INSERT INTO "OWHS" ("WhsCode", "WhsName", "BPLid", "Location", "BalInvntAc") VALUES ('02', 'Mumbai', 1, 1, '120000')`);
    const receipt = await sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 10, Price: 100, WarehouseCode: '01' }] });

    // Delivery of 4 from an order, cancelled: stock back at cost, order row open again, entry reversed.
    const order = await sl('POST', '/Orders', { CardCode: 'C001', DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 4, UnitPrice: 300 }] });
    const fromOrder = { BaseType: 17, BaseEntry: order.DocEntry, BaseLine: 0, Quantity: 4, UnitPrice: 300 };
    const delivery = await sl('POST', '/DeliveryNotes', { CardCode: 'C001', DocDate: day, DocumentLines: [fromOrder] });
    assert.deepEqual(await item(), { OnHand: 6, IsCommited: 0, AvgPrice: 100 });
    await sl('POST', `/DeliveryNotes(${delivery.DocEntry})/Cancel`);
    assert.deepEqual(await item(), { OnHand: 10, IsCommited: 4, AvgPrice: 100 });
    const cancelled = await sl('GET', `/DeliveryNotes(${delivery.DocEntry})`);
    assert.deepEqual([cancelled.Cancelled, cancelled.DocumentStatus], ['tYES', 'bost_Close']);
    const reversal = await one(`SELECT "DocEntry", "DocNum", "TransId" FROM "ODLN" WHERE "CANCELED" = 'C'`);
    assert.equal(reversal.DocNum, delivery.DocNum + 1, 'cancellation document takes the next number of the series');
    assert.equal((await one('SELECT "StornoToTr" FROM "OJDT" WHERE "TransId" = $1', [reversal.TransId])).StornoToTr, delivery.TransId);
    assert.equal((await sl('GET', `/Orders(${order.DocEntry})`)).DocumentLines[0].RemainingOpenQuantity, 4);
    assert.equal(await net('500000'), 0, 'cost of goods sold reversed');
    assert.match(await failure(sl('POST', `/DeliveryNotes(${delivery.DocEntry})/Cancel`)), /already cancelled/);
    assert.match(await failure(sl('POST', `/DeliveryNotes(${reversal.DocEntry})/Cancel`)), /cancellation document cannot be cancelled/);

    // Delivery -> invoice: the delivery is refused while the invoice stands; cancelling the invoice reopens it.
    const delivery2 = await sl('POST', '/DeliveryNotes', { CardCode: 'C001', DocDate: day, DocumentLines: [fromOrder] });
    const invoice = await sl('POST', '/Invoices', { CardCode: 'C001', DocDate: day,
      DocumentLines: [{ BaseType: 15, BaseEntry: delivery2.DocEntry, BaseLine: 0, Quantity: 4, UnitPrice: 300 }] });
    assert.equal(await balance(), 1200);
    assert.match(await failure(sl('POST', `/DeliveryNotes(${delivery2.DocEntry})/Cancel`)), /copied to a target document/);

    // A paid invoice is refused until its payment is cancelled; the payment reopens it.
    const payment = await sl('POST', '/IncomingPayments', { CardCode: 'C001', DocDate: day, CashAccount: '100000', CashSum: 1200,
      PaymentInvoices: [{ DocEntry: invoice.DocEntry, InvoiceType: 'it_Invoice', SumApplied: 1200 }] });
    assert.equal(await balance(), 0);
    assert.match(await failure(sl('POST', `/Invoices(${invoice.DocEntry})/Cancel`)), /cancel the payments first/);
    await sl('POST', `/IncomingPayments(${payment.DocEntry})/Cancel`);
    assert.equal(await balance(), 1200);
    assert.equal(await net('100000'), 0, 'cash reversed');
    const reopened = await one('SELECT "DocStatus", "PaidToDate" FROM "OINV" WHERE "DocEntry" = $1', [invoice.DocEntry]);
    assert.deepEqual(reopened, { DocStatus: 'O', PaidToDate: 0 });
    assert.equal((await one(`SELECT "BalDueDeb" FROM "JDT1" WHERE "TransId" = $1 AND "ShortName" = 'C001'`, [invoice.TransId])).BalDueDeb, 1200);
    assert.match(await failure(sl('POST', `/IncomingPayments(${payment.DocEntry})/Cancel`)), /already cancelled/);

    await sl('POST', `/Invoices(${invoice.DocEntry})/Cancel`);
    assert.equal(await balance(), 0);
    assert.equal((await sl('GET', `/DeliveryNotes(${delivery2.DocEntry})`)).DocumentLines[0].LineStatus, 'bost_Open', 'delivery row open again');
    assert.equal(await whs('01'), 6, 'an invoice from a delivery moved no stock, so cancelling it moves none');
    await sl('POST', `/DeliveryNotes(${delivery2.DocEntry})/Cancel`);
    assert.deepEqual(await item(), { OnHand: 10, IsCommited: 4, AvgPrice: 100 });

    // A receipt whose stock was used is refused; a transfer cancels back between warehouses.
    await sl('POST', '/InventoryGenExits', { DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 8, WarehouseCode: '01' }] });
    assert.match(await failure(sl('POST', `/InventoryGenEntries(${receipt.DocEntry})/Cancel`)), /negative inventory/);
    const transfer = await sl('POST', '/StockTransfers', { DocDate: day, FromWarehouse: '01', ToWarehouse: '02', StockTransferLines: [{ ItemCode: 'I001', Quantity: 2 }] });
    assert.deepEqual([await whs('01'), await whs('02')], [0, 2]);
    await sl('POST', `/StockTransfers(${transfer.DocEntry})/Cancel`);
    assert.deepEqual([await whs('01'), await whs('02')], [2, 0]);

    // Delivery can be closed without invoicing; an invoice cannot.
    const delivery3 = await sl('POST', '/DeliveryNotes', { CardCode: 'C001', DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 1, UnitPrice: 300 }] });
    await sl('POST', `/DeliveryNotes(${delivery3.DocEntry})/Close`);
    assert.equal((await sl('GET', `/DeliveryNotes(${delivery3.DocEntry})`)).DocumentStatus, 'bost_Close');
    const invoice2 = await sl('POST', '/Invoices', { CardCode: 'C001', DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 1, UnitPrice: 300 }] });
    assert.match(await failure(sl('POST', `/Invoices(${invoice2.DocEntry})/Close`)), /not available/);

    // Books: every entry balances; inventory account equals stock value (1 left x 100).
    assert.equal((await one('SELECT COALESCE(SUM("Debit" - "Credit"), 0) AS "Net" FROM "JDT1"')).Net, 0);
    assert.deepEqual(await item(), { OnHand: 0, IsCommited: 4, AvgPrice: 100 });
    assert.equal(await net('120000'), 0);
    assert.equal(await net('110000'), await balance());
  });
});
