// "Locate Journal Transaction by Amount Range" (Reports > Financial > Accounting).
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const reports = require('../services/reports/accountingTransactionReports.service');
const { withLocalCompany } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('journal rows are found by their amount range', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('acr', async ({ schema, asUser }) => {
    const entry = (amount) => local.request({ method: 'POST', url: '/JournalEntries', data: { ReferenceDate: '2026-10-17', JournalEntryLines: [
      { AccountCode: '510000', Debit: amount }, { AccountCode: '100000', Credit: amount }] } }, schema);
    for (const amount of [50, 150, 900]) await entry(amount);
    await asUser(async () => {
      const criteria = { postingDateFrom: '2026-10-01', postingDateTo: '2026-10-31', amountFrom: '100', amountTo: '500' };
      const found = await reports.getReport('journal-transaction-amount-range', criteria);
      const amounts = found.rows.map((row) => Number(row.debit || row.credit || row.Debit || row.Credit));
      assert.deepEqual([...new Set(amounts)], [150], JSON.stringify(found.rows[0]));
      assert.equal((await reports.getReport('journal-transaction-amount-range', { ...criteria, accountFrom: '510000', accountTo: '510000' })).rows.length, 1);
      assert.equal((await reports.getReport('journal-transaction-fc-amount-range', criteria)).rows.length, 0, 'no foreign-currency rows');
    });
  });
});
