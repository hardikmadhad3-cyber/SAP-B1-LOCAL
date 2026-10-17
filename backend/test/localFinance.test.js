// Opening balances, cash discounts on payments, internal reconciliation and tax on
// manual journal entry rows on the local engine, checked by hand-computed amounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const journalEntries = require('../services/journalEntryService');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('opening balances, cash discounts, reconciliation and journal tax', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('fin', async ({ schema, sql, asUser }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const journal = async (transId) => Object.fromEntries((await sql(
      'SELECT "ShortName", SUM("Debit" - "Credit") AS "Net" FROM "JDT1" WHERE "TransId" = $1 GROUP BY "ShortName"', [transId],
    )).rows.map((row) => [row.ShortName, row.Net]));
    const balance = async (card) => (await one('SELECT "Balance" FROM "OCRD" WHERE "CardCode" = $1', [card])).Balance;
    const openRows = async (card) => (await local.listOpenRows(schema, card)).map((row) => [row.TransType, row.Open]);
    const failure = async (promise) => (await slFailure(promise))[1];
    const day = '2026-10-17';

    await sql(`INSERT INTO "OACT" ("AcctCode", "AcctName", "GroupMask", "FormatCode") VALUES ('130000', 'Input Tax', 1, '130000')`);
    await sql(`INSERT INTO "OCDC" ("Code", "TableDesc") VALUES ('CD2', '2% 10 days')`);
    await sql(`INSERT INTO "CDC1" ("CdcCode", "LineId", "NumOfDays", "Discount") VALUES ('CD2', 0, 10, 2)`);
    const terms = (await one(`INSERT INTO "OCTG" ("PymntGroup", "DiscCode") VALUES ('Net 30 / 2% 10', 'CD2') RETURNING "GroupNum"`)).GroupNum;
    await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C001', 'Acme Ltd', 'C', 1), ('V001', 'Supplier', 'S', 2)`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem") VALUES ('I001', 'Widget', 1, 'Y')`);
    for (const [code, type] of [['CGST9', -100], ['SGST9', -110]]) {
      await sl('POST', '/SalesTaxAuthorities', { Code: code, Name: code, Type: type, Rate: 9, SalesTaxAccount: '210000', PurchaseTaxAccount: '130000' });
    }
    await sl('POST', '/SalesTaxCodes', { Code: 'GST18', Name: 'GST 18%', SalesTaxCodes_Lines: [{ STACode: 'CGST9' }, { STACode: 'SGST9' }] });

    // Opening balances against Opening Balance Equity (300000, the G/L determination default).
    const glOpening = await local.postOpeningBalances(schema, 'accounts', { date: day, rows: [{ AccountCode: '100000', Debit: 5000 }] });
    assert.deepEqual(await journal(glOpening.TransId), { 100000: 5000, 300000: -5000 });
    const bpOpening = await local.postOpeningBalances(schema, 'partners', { date: day, rows: [
      { CardCode: 'C001', Debit: 1180, DueDate: '2026-11-16' }, { CardCode: 'V001', Credit: 300 }] });
    assert.deepEqual(await journal(bpOpening.TransId), { C001: 1180, V001: -300, 300000: -880 });
    assert.deepEqual([await balance('C001'), await balance('V001')], [1180, -300]);
    assert.equal((await one(`SELECT "Account" FROM "JDT1" WHERE "TransId" = $1 AND "ShortName" = 'C001'`, [bpOpening.TransId])).Account, '110000');
    const stockOpening = await local.postOpeningBalances(schema, 'items', { date: day, rows: [{ ItemCode: 'I001', WhsCode: '01', Quantity: 10, Price: 40 }] });
    assert.deepEqual(await journal(stockOpening.TransId), { 120000: 400, 300000: -400 });
    assert.deepEqual(await one(`SELECT "OnHand", "AvgPrice" FROM "OITM" WHERE "ItemCode" = 'I001'`), { OnHand: 10, AvgPrice: 40 });
    assert.equal((await local.listOpeningBalances(schema)).entries.length, 3);
    assert.deepEqual((await local.listReconcilablePartners(schema)).map((row) => row.CardCode), ['C001', 'V001']);
    assert.match((await slFailure(local.postOpeningBalances(schema, 'accounts', { date: day, rows: [{ AccountCode: '100000', Debit: 1, Credit: 1 }] })))[1], /either a debit or a credit/);

    // Cash discount: invoice 1000 on 2%/10-day terms, paid 980 within the days clears it.
    const invoice = await sl('POST', '/Invoices', { CardCode: 'C001', DocDate: day, PaymentGroupCode: terms, DocumentLines: [{ ItemCode: 'I001', Quantity: 1, UnitPrice: 1000 }] });
    const discounted = (extra) => sl('POST', '/IncomingPayments', { CardCode: 'C001', DocDate: day, CashAccount: '100000', CashSum: 980,
      PaymentInvoices: [{ DocEntry: invoice.DocEntry, InvoiceType: 'it_Invoice', SumApplied: 980, DiscountPercent: 2 }], ...extra });
    assert.match(await failure(discounted()), /Define the sales cash discount account/);
    await sql(`UPDATE "OACP" SET "CashDscAR" = '510000'`);
    assert.match(await failure(discounted({ PaymentInvoices: [{ DocEntry: invoice.DocEntry, InvoiceType: 'it_Invoice', SumApplied: 970, DiscountPercent: 3 }], CashSum: 970 })),
      /allows a cash discount of 2%/);
    assert.match(await failure(discounted({ DocDate: '2026-11-17' })), /allows a cash discount of 0%/);
    const paid = await discounted();
    assert.deepEqual(await journal(paid.TransId), { 100000: 980, 510000: 20, C001: -1000 });
    assert.deepEqual(await one('SELECT "PaidToDate", "DocStatus" FROM "OINV" WHERE "DocEntry" = $1', [invoice.DocEntry]), { PaidToDate: 1000, DocStatus: 'C' });
    await sl('POST', `/IncomingPayments(${paid.DocEntry})/Cancel`);
    assert.deepEqual(await one('SELECT "PaidToDate", "DocStatus" FROM "OINV" WHERE "DocEntry" = $1', [invoice.DocEntry]), { PaidToDate: 0, DocStatus: 'O' });
    await discounted();
    assert.equal(await balance('C001'), 1180);

    // Internal reconciliation: a credit memo against an invoice, and a payment on account against the opening balance.
    const invoice2 = await sl('POST', '/Invoices', { CardCode: 'C001', DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 1, UnitPrice: 300 }] });
    const creditMemo = await sl('POST', '/CreditNotes', { CardCode: 'C001', DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 1, UnitPrice: 100 }] });
    const onAccount = await sl('POST', '/IncomingPayments', { CardCode: 'C001', DocDate: day, CashAccount: '100000', CashSum: 200 });
    assert.deepEqual((await openRows('C001')).sort((a, b) => a[0] - b[0]), [[-2, 1180], [13, 300], [14, -100], [24, -200]]);
    const rowOf = async (transId) => (await one(`SELECT "Line_ID" FROM "JDT1" WHERE "TransId" = $1 AND "ShortName" = 'C001'`, [transId])).Line_ID;
    const pick = async (transId, amount) => ({ TransId: transId, LineId: await rowOf(transId), Amount: amount });
    assert.match((await slFailure(local.reconcile(schema, { CardCode: 'C001', Rows: [await pick(invoice2.TransId, 100), await pick(creditMemo.TransId, 90)] })))[1],
      /must be equal \(difference 10\)/);
    assert.match((await slFailure(local.reconcile(schema, { CardCode: 'C001', ReconDate: day, Rows: [await pick(invoice2.TransId, 100), await pick(invoice2.TransId, 100), await pick(creditMemo.TransId, 100)] })))[1],
      /selected twice/);
    assert.match((await slFailure(local.reconcile(schema, { CardCode: 'C001', ReconDate: '2026-01-01', Rows: [await pick(invoice2.TransId, 100), await pick(creditMemo.TransId, 100)] })))[1],
      /earlier than its posting date/);
    await local.reconcile(schema, { CardCode: 'C001', ReconDate: day, Rows: [await pick(invoice2.TransId, 100), await pick(creditMemo.TransId, 100)] });
    assert.equal((await one('SELECT "PaidToDate" FROM "OINV" WHERE "DocEntry" = $1', [invoice2.DocEntry])).PaidToDate, 100);
    assert.equal((await one('SELECT "DocStatus" FROM "ORIN" WHERE "DocEntry" = $1', [creditMemo.DocEntry])).DocStatus, 'C');
    await local.reconcile(schema, { CardCode: 'C001', Rows: [await pick(bpOpening.TransId, 200), await pick(onAccount.TransId, 200)] });
    assert.deepEqual((await openRows('C001')).sort((a, b) => a[0] - b[0]), [[-2, 980], [13, 200]]);
    assert.match(await failure(sl('POST', `/IncomingPayments(${onAccount.DocEntry})/Cancel`)), /reconciled; cancel that reconciliation first/);
    assert.equal((await one('SELECT COUNT(*)::int AS "N" FROM "ITR1"')).N, 4);

    // The rest of the opening balance is paid like an invoice from the payment page.
    await sl('POST', '/IncomingPayments', { CardCode: 'C001', DocDate: day, CashAccount: '100000', CashSum: 980,
      PaymentInvoices: [{ DocEntry: bpOpening.TransId, InvoiceType: 'it_OpeningBalance', SumApplied: 980 }] });
    assert.deepEqual(await openRows('C001'), [[13, 200]]);

    // Manual journal entry with GST on the revenue row: tax rows are added per component.
    const manual = await asUser(async () => journalEntries.createManualJournalEntry({
      header: { postingDate: day, remarks: 'Scrap sale', series: String((await one(`SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = '30'`)).Series) },
      lines: [{ accountCode: 'C001', accountType: 'businessPartner', debit: 118 }, { accountCode: '400000', credit: 100, taxCode: 'GST18' }],
    }));
    const taxed = manual.data.JdtNum;
    assert.deepEqual(await journal(taxed), { C001: 118, 400000: -100, 210000: -18 });
    assert.deepEqual(await one(`SELECT "VatGroup", "BaseSum", "VatAmount" FROM "JDT1" WHERE "TransId" = $1 AND "Account" = '400000'`, [taxed]),
      { VatGroup: 'GST18', BaseSum: 100, VatAmount: 18 });
    assert.equal((await one(`SELECT COUNT(*)::int AS "N" FROM "JDT1" WHERE "TransId" = $1 AND "VatLine" = 'Y'`, [taxed])).N, 2);
    assert.match(await failure(sl('POST', '/JournalEntries', { ReferenceDate: day, JournalEntryLines: [
      { ShortName: 'C001', Debit: 100 }, { AccountCode: '400000', Credit: 100, TaxCode: 'GST18' }] })), /does not balance \(difference -18\)/);
    // Input tax on a debit (purchase) row.
    const expense = await sl('POST', '/JournalEntries', { ReferenceDate: day, JournalEntryLines: [
      { AccountCode: '510000', Debit: 50, TaxCode: 'GST18' }, { AccountCode: '100000', Credit: 59 }] });
    assert.deepEqual(await journal(expense.JdtNum), { 510000: 50, 130000: 9, 100000: -59 });

    // Books balance; receivables equal the customer's balance.
    assert.equal((await one('SELECT COALESCE(SUM("Debit" - "Credit"), 0) AS "Net" FROM "JDT1"')).Net, 0);
    assert.equal((await one(`SELECT SUM("Debit" - "Credit") AS "Net" FROM "JDT1" WHERE "Account" = '110000'`)).Net, await balance('C001'));
  });
});
