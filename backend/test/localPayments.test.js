// Phase 4 payments and manual journal entries on the local engine: incoming and
// outgoing payments settle invoices, credit memos and journal entries, leave the
// rest on account, and post balanced entries; checked by hand-computed amounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const incoming = require('../services/incomingPaymentsService');
const outgoing = require('../services/outgoingPaymentsService');
const journalEntries = require('../services/journalEntryService');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('payments settle documents, keep the rest on account and post balanced entries', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('pay', async ({ schema, sql, asUser }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const journal = async (transId) => Object.fromEntries((await sql(
      'SELECT "ShortName", SUM("Debit" - "Credit") AS "Net" FROM "JDT1" WHERE "TransId" = $1 GROUP BY "ShortName"', [transId],
    )).rows.map((row) => [row.ShortName, row.Net]));
    const balance = async (card) => (await one('SELECT "Balance" FROM "OCRD" WHERE "CardCode" = $1', [card])).Balance;
    const openItems = async (card) => (await asUser(() => incoming.getOpenInvoices(card))).map((row) => [row.invoiceTypeCode, row.balanceDue]).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const series = async (object) => String((await one('SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = $1', [object])).Series);
    const day = '2026-10-17';

    await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C001', 'Acme Ltd', 'C', 1), ('C002', 'Other Ltd', 'C', 1), ('V001', 'Supplier', 'S', 2)`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem") VALUES ('I001', 'Widget', 1, 'Y')`);
    await sl('POST', '/InventoryGenEntries', { DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 10, Price: 50, WarehouseCode: '01' }] });
    const sale = (lines) => ({ CardCode: 'C001', DocDate: day, DocumentLines: lines });
    const invoice1 = await sl('POST', '/Invoices', sale([{ ItemCode: 'I001', Quantity: 2, UnitPrice: 500 }]));
    const invoice2 = await sl('POST', '/Invoices', sale([{ ItemCode: 'I001', Quantity: 2, UnitPrice: 200 }]));
    const credit = await sl('POST', '/CreditNotes', sale([{ ItemCode: 'I001', Quantity: 1, UnitPrice: 100 }]));
    assert.equal(await balance('C001'), 1300);
    assert.equal((await one('SELECT "CtlAccount" FROM "OINV" WHERE "DocEntry" = $1', [invoice1.DocEntry])).CtlAccount, '110000');

    // The page lists open items (the query used to fail on missing invoice columns).
    assert.deepEqual(await openItems('C001'), [[13, 1000], [13, 400], [14, -100]]);

    // Incoming payment from the page: 600 on invoice 1 less the 100 credit memo, 500 cash.
    const payment = await asUser(async () => incoming.createIncomingPayment({
      header: { businessPartnerCode: 'C001', bpType: 'Customer', postingDate: day, seriesCode: await series('24') },
      invoices: [
        { docEntry: invoice1.DocEntry, invoiceTypeCode: 13, totalPayment: '600', balanceDue: '1000' },
        { docEntry: credit.DocEntry, invoiceTypeCode: 14, totalPayment: '-100', balanceDue: '-100' },
      ],
      paymentMeans: { cash: { amount: '500', account: '100000' } },
    }));
    const saved = await sl('GET', `/IncomingPayments(${payment.DocEntry})`);
    assert.deepEqual(await journal(saved.TransId), { 100000: 500, C001: -500 });
    assert.deepEqual([saved.DocTotal, saved.PaymentOnAccount], [500, 0]);
    assert.equal(await balance('C001'), 800);
    assert.deepEqual(await openItems('C001'), [[13, 400], [13, 400]]);
    assert.equal((await one('SELECT "DocStatus" FROM "ORIN" WHERE "DocEntry" = $1', [credit.DocEntry])).DocStatus, 'C', 'fully used credit memo closes');
    const detail = await asUser(() => incoming.getIncomingPaymentByDocEntry(payment.DocEntry));
    assert.deepEqual(detail.invoices.map((row) => [row.invoiceTypeCode, row.totalPayment]), [[13, 600], [14, -100]]);

    // Over-payment and another customer's invoice are refused, leaving nothing behind.
    const pay = (extra) => sl('POST', '/IncomingPayments', { DocType: 'rCustomer', CardCode: 'C001', DocDate: day, CashAccount: '100000', ...extra });
    assert.match((await slFailure(pay({ CashSum: 401, PaymentInvoices: [{ DocEntry: invoice1.DocEntry, InvoiceType: 'it_Invoice', SumApplied: 401 }] })))[1],
      /401 is more than the 400 still open/);
    assert.match((await slFailure(sl('POST', '/IncomingPayments', { CardCode: 'C002', DocDate: day, CashAccount: '100000', CashSum: 10,
      PaymentInvoices: [{ DocEntry: invoice2.DocEntry, InvoiceType: 'it_Invoice', SumApplied: 10 }] })))[1], /belongs to another business partner/);
    assert.match((await slFailure(pay({ CashSum: 0 })))[1], /payment total must be greater than zero/);
    assert.equal(await balance('C001'), 800);

    // 300 cash for invoice 2 (200): 100 stays on account, open on the payment's BP row.
    const partial = await pay({ CashSum: 300, PaymentInvoices: [{ DocEntry: invoice2.DocEntry, InvoiceType: 'it_Invoice', SumApplied: 200 }] });
    assert.equal(partial.PaymentOnAccount, 100);
    assert.equal((await one(`SELECT "BalDueCred" FROM "JDT1" WHERE "TransId" = $1 AND "ShortName" = 'C001'`, [partial.TransId])).BalDueCred, 100);
    assert.equal(await balance('C001'), 500);

    // Manual journal entry from the page: debit the customer 50 against revenue; it shows as an open item and is paid.
    const manual = await asUser(async () => journalEntries.createManualJournalEntry({
      header: { postingDate: day, remarks: 'Late fee', series: await series('30') },
      lines: [{ accountCode: 'C001', accountType: 'businessPartner', debit: 50 }, { accountCode: '400000', credit: 50, remarks: 'Fee' }],
    }));
    const manualId = manual.data.JdtNum;
    assert.deepEqual(await journal(manualId), { C001: 50, 400000: -50 });
    assert.equal((await one(`SELECT "Account" FROM "JDT1" WHERE "TransId" = $1 AND "ShortName" = 'C001'`, [manualId])).Account, '110000');
    assert.equal(await balance('C001'), 550);
    assert.ok((await asUser(() => incoming.getOpenInvoices('C001'))).some((row) => row.invoiceTypeCode === 30 && row.balanceDue === 50));
    await pay({ CashSum: 50, PaymentInvoices: [{ DocEntry: manualId, InvoiceType: 'it_JournalEntry', SumApplied: 50 }] });
    assert.ok(!(await asUser(() => incoming.getOpenInvoices('C001'))).some((row) => row.invoiceTypeCode === 30));
    assert.match((await slFailure(sl('POST', '/JournalEntries', { ReferenceDate: day, JournalEntryLines: [
      { AccountCode: '510000', Debit: 10 }, { AccountCode: '100000', Credit: 9 }] })))[1], /does not balance/);
    assert.match((await slFailure(sl('POST', '/JournalEntries', { ReferenceDate: day, JournalEntryLines: [
      { AccountCode: '510000', Debit: 10, Credit: 10 }, { AccountCode: '100000', Credit: 10 }] })))[1], /either a debit or a credit/);

    // Outgoing payment from the page: bank transfer for an A/P invoice closes it and clears the vendor.
    const bill = await sl('POST', '/PurchaseInvoices', { CardCode: 'V001', DocDate: day, DocumentLines: [{ ItemCode: 'I001', Quantity: 2, UnitPrice: 50 }] });
    assert.equal(await balance('V001'), -100);
    assert.deepEqual((await asUser(() => outgoing.getOpenInvoices('V001'))).map((row) => [row.invoiceTypeCode, row.balanceDue]), [[18, 100]]);
    const sent = await asUser(async () => outgoing.createOutgoingPayment({
      header: { businessPartnerCode: 'V001', bpType: 'Vendor', postingDate: day, seriesCode: await series('46') },
      invoices: [{ docEntry: bill.DocEntry, invoiceTypeCode: 18, totalPayment: '100', balanceDue: '100' }],
      paymentMeans: { transfer: { amount: '100', account: '100000', date: day, reference: 'UTR1' } },
    }));
    const vendorPayment = await sl('GET', `/VendorPayments(${sent.DocEntry})`);
    assert.deepEqual(await journal(vendorPayment.TransId), { V001: 100, 100000: -100 });
    assert.equal(await balance('V001'), 0);
    assert.equal((await one('SELECT "DocStatus", "PaidToDate" FROM "OPCH" WHERE "DocEntry" = $1', [bill.DocEntry])).DocStatus, 'C');

    // Account payment: 75 expense paid in cash, no business partner.
    const expense = await sl('POST', '/VendorPayments', { DocType: 'rAccount', DocDate: day, CashAccount: '100000', CashSum: 75,
      PaymentAccounts: [{ AccountCode: '510000', SumPaid: 75, Decription: 'Courier' }] });
    assert.deepEqual(await journal(expense.TransId), { 510000: 75, 100000: -75 });
    assert.match((await slFailure(sl('POST', '/VendorPayments', { DocType: 'rAccount', DocDate: day, CashAccount: '100000', CashSum: 75,
      PaymentAccounts: [{ AccountCode: '510000', SumPaid: 70 }] })))[1], /must add up to the payment total/);

    // Books: every entry balances; receivables equal the customer balance, payables the vendor balance.
    assert.equal((await one('SELECT COALESCE(SUM("Debit" - "Credit"), 0) AS "Net" FROM "JDT1"')).Net, 0);
    assert.equal((await one(`SELECT SUM("Debit" - "Credit") AS "Net" FROM "JDT1" WHERE "Account" = '110000'`)).Net, await balance('C001'));
    assert.equal((await one(`SELECT COALESCE(SUM("Debit" - "Credit"), 0) AS "Net" FROM "JDT1" WHERE "Account" = '200000'`)).Net, await balance('V001'));
    // Cash: +500 +300 +50 -100 -75.
    assert.equal((await one(`SELECT SUM("Debit" - "Credit") AS "Net" FROM "JDT1" WHERE "Account" = '100000'`)).Net, 675);
  });
});
