// Master pages: values the pages sent that were lost or refused (2026-10-17 audit).
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('branches, payment terms, price lists, UoM groups and accounts keep what the pages send', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('mpf', async ({ schema, sql, asUser }) => {
    const sl = async (method, url, data) => (await local.request({ method, url, data }, schema)).data;
    const one = async (text, values) => (await sql(text, values)).rows[0];
    const master = require('../services/masterDataDbService');

    // Branch 2 is not a second main branch and has no borrowed warehouse; it can be edited.
    const branch = await sl('POST', '/BusinessPlaces', { BPLName: 'Mumbai' });
    assert.deepEqual(await one('SELECT "MainBPL", "DflWhs" FROM "OBPL" WHERE "BPLId" = $1', [branch.BPLID ?? branch.BPLId]),
      { MainBPL: 'N', DflWhs: null });
    await sl('PATCH', `/BusinessPlaces(${branch.BPLID ?? branch.BPLId})`, { BPLName: 'Mumbai', RepName: 'Asha', VATRegNum: '' });
    assert.equal((await one('SELECT COUNT(*)::int AS "N" FROM "OBPL" WHERE "MainBPL" = $1', ['Y'])).N, 1);

    // Payment terms: the page's own code and Load Limit Credit are stored; all installments can be removed.
    const terms = await sl('POST', '/PaymentTermsTypes', { PaymentTermsGroupName: 'Net 30 split', PaymentTermsGroupCode: 'N30S',
      LoadLimitCredit: 'tYES', ToleranceDays: 3, PaymentTermsInstallments: [
        { InstallmentNumber: 1, Percent: 50, NumberOfAdditionalDays: 15 }, { InstallmentNumber: 2, Percent: 50, NumberOfAdditionalDays: 30 }] });
    const groupNum = terms.GroupNumber ?? terms.GroupNum;
    let loaded = await asUser(() => master.getPaymentTerms(groupNum));
    assert.deepEqual([loaded.PaymentTermsGroupCode, loaded.LoadLimitCredit, loaded.ToleranceDays, loaded.PaymentTermsInstallments.length], ['N30S', 'tYES', 3, 2]);
    await sl('PATCH', `/PaymentTermsTypes(${groupNum})`, { PaymentTermsGroupName: 'Net 30 split', PaymentTermsInstallments: [] });
    loaded = await asUser(() => master.getPaymentTerms(groupNum));
    assert.equal(loaded.PaymentTermsInstallments.length, 0, 'removing every installment row removes them');
    assert.deepEqual(await slFailure(sl('PATCH', `/PaymentTermsTypes(${groupNum})`, { PaymentTermsInstallments: [
      { Percent: 100 }, { Percent: 0 }] })), [400, 'Installment 2: enter a percentage greater than 0.']);

    // Price list: an update that does not resend the dates compares them as dates, not text.
    const list = await sl('POST', '/PriceLists', { PriceListName: 'Season', ValidFrom: '2026-02-01', ValidTo: '2026-11-30' });
    await sl('PATCH', `/PriceLists(${list.PriceListNo ?? list.ListNum})`, { PriceListName: 'Season 2026' });
    await sl('PATCH', `/PriceLists(${list.PriceListNo ?? list.ListNum})`, { ValidFrom: null, ValidTo: null });
    assert.deepEqual(await one('SELECT "ValidFrom", "ValidTo" FROM "OPLN" WHERE "ListNum" = $1', [list.PriceListNo ?? list.ListNum]),
      { ValidFrom: null, ValidTo: null });

    // UoM group: a new base unit drops the old base's 1 = 1 row.
    for (const code of ['KGA', 'PCA']) await sl('POST', '/UnitOfMeasurements', { Code: code, Name: code });
    const uom = async (code) => (await one('SELECT "UomEntry" FROM "OUOM" WHERE "UomCode" = $1', [code])).UomEntry;
    const group = await sl('POST', '/UnitOfMeasurementGroups', { Code: 'GRP', Name: 'Group', BaseUoM: await uom('KGA') });
    const ugp = group.AbsEntry ?? group.UgpEntry;
    await sl('PATCH', `/UnitOfMeasurementGroups(${ugp})`, { BaseUoM: await uom('PCA'), UoMGroupDefinitionCollection: [
      { AlternateUoM: await uom('KGA'), AlternateQuantity: 1, BaseQuantity: 1 }, { AlternateUoM: await uom('PCA'), AlternateQuantity: 1, BaseQuantity: 1 }] });
    assert.deepEqual((await sql('SELECT "UomEntry" FROM "UGP1" WHERE "UgpEntry" = $1', [ugp])).rows.map((row) => row.UomEntry), [await uom('PCA')]);

    // Chart of accounts: control account and revaluation flags come back.
    await sl('POST', '/ChartOfAccounts', { Code: '115000', Name: 'Receivables control', AccountType: 'sat_Other',
      ControlAccount: 'tYES', RevaluationCoordinated: 'tYES', ExternalCode: 'EXT' });
    await sl('PATCH', "/ChartOfAccounts('115000')", { ExternalCode: null });
    const account = await asUser(() => master.getAccount('115000'));
    assert.deepEqual([account.ControlAccount, account.RevaluationCoordinated, account.ExternalCode], ['tYES', 'tYES', '']);
  });
});
