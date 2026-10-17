const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const { withLocalCompany } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

// Calls a controller the way Express does; returns { statusCode, body }.
const call = async (handler, { body = {}, params = {}, query = {} } = {}) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ body: structuredClone(body), params, query }, res);
  return res;
};
const ok = (res) => { assert.ok(res.statusCode < 300, JSON.stringify(res.body)); return res.body; };
const failure = (res) => { assert.ok(res.statusCode >= 400, `expected a failure, got ${JSON.stringify(res.body)}`); return res.body.message; };

// M5: the existing setup pages save locally and read back through their own readers.
test('setup masters save through their pages and follow SAP rules', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('setup', async ({ asUser, sql }) => {
    const uom = require('../controllers/uomGroupController');
    const terms = require('../controllers/paymentTermsController');
    const prices = require('../controllers/priceListController');
    const shipping = require('../controllers/shippingTypeController');
    const branches = require('../controllers/branchController');
    const accounts = require('../controllers/chartOfAccountsController');
    const masters = require('../services/masterDataDbService');

    await asUser(async () => {
      // Units of measure and UoM groups (modules/uom-group-setup).
      const box = ok(await call(uom.createUoM, { body: { Code: 'BOX', Name: 'Box' } }));
      const kg = ok(await call(uom.createUoM, { body: { Code: 'KG', Name: 'Kilogram' } }));
      assert.equal(failure(await call(uom.createUoM, { body: { Code: 'BOX', Name: 'Again' } })), 'Unit of measure "BOX" already exists.');
      const ea = (await sql(`SELECT "UomEntry" FROM "OUOM" WHERE "UomCode" = 'EA'`)).rows[0].UomEntry;
      const group = ok(await call(uom.createUoMGroup, { body: { Code: 'PACK', Name: 'Packing', BaseUoM: ea } }));
      ok(await call(uom.updateUoMGroup, { params: { absEntry: group.AbsEntry }, body: {
        UoMGroupDefinitionCollection: [{ AlternateUoM: box.AbsEntry, BaseQuantity: 12, AlternateQuantity: 1 }],
      } }));
      const loadedGroup = await masters.getUoMGroup(group.AbsEntry);
      assert.deepEqual(loadedGroup.UoMGroupDefinitionCollection.map((l) => [l.UoMCode, l.AlternateQuantity, l.BaseQuantity]),
        [['EA', 1, 1], ['BOX', 1, 12]], 'SAP keeps the 1:1 base row');
      assert.equal(failure(await call(uom.updateUoMGroup, { params: { absEntry: group.AbsEntry }, body: {
        UoMGroupDefinitionCollection: [{ AlternateUoM: kg.AbsEntry, BaseQuantity: 0, AlternateQuantity: 1 }] } })),
      'Quantities must be greater than zero.');

      // Payment terms (modules/payment-terms).
      const termsPage = {
        PaymentTermsGroupName: 'Net 30 2 inst', BaselineDate: 'bld_PostingDate', StartFrom: 'ptsf_MonthEnd',
        NumberOfAdditionalMonths: 0, NumberOfAdditionalDays: 30, CreditLimit: 100000, CashDiscountPercent: 2,
        LoadLimitCredit: 'tNO', OpenIncomingPaymentsByDueDate: 'tNO',
        PaymentTermsInstallments: [
          { InstallmentNumber: 1, Percent: 40, NumberOfAdditionalDays: 30 },
          { InstallmentNumber: 2, Percent: 60, NumberOfAdditionalDays: 60 },
        ],
      };
      const createdTerms = ok(await call(terms.createPaymentTerms, { body: termsPage }));
      const loadedTerms = await masters.getPaymentTerms(createdTerms.GroupNumber);
      for (const field of ['PaymentTermsGroupName', 'BaselineDate', 'StartFrom', 'NumberOfAdditionalDays', 'CreditLimit', 'CashDiscountPercent']) {
        assert.equal(String(loadedTerms[field]), String(termsPage[field]), `${field} must round-trip`);
      }
      assert.equal(loadedTerms.NumberOfInstallments, 2);
      assert.equal(failure(await call(terms.createPaymentTerms, { body: { PaymentTermsGroupName: 'Bad split',
        PaymentTermsInstallments: [{ Percent: 50 }, { Percent: 30 }] } })), 'Installment percentages must add up to 100 (now 80).');

      // Price lists (modules/price-list): a new list is filled from its base list x factor.
      await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod") VALUES ('I1', 'Item', 1)`);
      await sql(`INSERT INTO "ITM1" ("ItemCode", "PriceList", "Price") VALUES ('I1', 1, 100) ON CONFLICT ("ItemCode", "PriceList") DO UPDATE SET "Price" = 100`);
      const listPage = { PriceListName: 'Dealer', BasePriceList: 1, Factor: 0.9, RoundingMethod: 'borm_NoRounding',
        Active: 'tYES', IsGrossPrice: 'tNO', PriceListCurrency: 'INR' };
      const list = ok(await call(prices.createPriceList, { body: listPage }));
      const loadedList = await masters.getPriceList(list.PriceListNo);
      for (const field of ['PriceListName', 'BasePriceList', 'Factor', 'RoundingMethod', 'Active', 'IsGrossPrice', 'PriceListCurrency']) {
        assert.equal(String(loadedList[field]), String(listPage[field]), `${field} must round-trip`);
      }
      assert.equal(Number((await sql('SELECT "Price" FROM "ITM1" WHERE "ItemCode" = $1 AND "PriceList" = $2', ['I1', list.PriceListNo])).rows[0].Price), 90);
      assert.equal(failure(await call(prices.createPriceList, { body: { PriceListName: 'Dealer' } })), 'Price list "Dealer" already exists.');
      assert.equal(failure(await call(prices.createPriceList, { body: { PriceListName: 'Bad', Factor: 0 } })), 'The factor must be greater than zero.');

      // Shipping types (modules/shipping-type), delete refused while in use.
      const ship = ok(await call(shipping.createShippingType, { body: { Name: 'By Road', Website: 'roadways.in' } }));
      assert.deepEqual(await masters.getShippingType(ship.Code), { Code: ship.Code, Name: 'By Road', Website: 'roadways.in', ShippingCompany: '' });
      await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode", "ShipType") VALUES ('C1', 'Cust', 'C', 1, $1)`, [ship.Code]);
      assert.equal(failure(await call(shipping.deleteShippingType, { params: { code: ship.Code } })), `Shipping type ${ship.Code} is in use and cannot be deleted.`);
      const spare = ok(await call(shipping.createShippingType, { body: { Name: 'Courier' } }));
      ok(await call(shipping.deleteShippingType, { params: { code: spare.Code } }));

      // Branches (modules/branch): the page's own field names come back.
      const branchPage = { BPLName: 'Ahmedabad Plant', BPLNameForeign: 'AMD', DefaultWarehouseCode: '01', FederalTaxID: 'AAACA1234A',
        GSTIN: '24AAACA1234A1Z5', GSTType: 'gstRegularTDSISD', Street: 'GIDC', City: 'Ahmedabad', State: 'GJ', Country: 'IN',
        Phone: '079-555', Email: 'plant@acme.in', TaxOfficeName: 'Ahd-1' };
      const branch = ok(await call(branches.createBranch, { body: branchPage }));
      const loadedBranch = await masters.getBranch(branch.BPLID ?? branch.BPLId);
      for (const [field, value] of Object.entries(branchPage)) assert.equal(String(loadedBranch[field]), value, `${field} must round-trip`);
      assert.equal(failure(await call(branches.createBranch, { body: { BPLName: 'Bad GST', GSTIN: '24BAD' } })), 'GSTIN "24BAD" is not valid.');

      // Chart of accounts (modules/chart-of-accounts): title/active, parent levels, SAP rules.
      ok(await call(accounts.createAccount, { body: { Code: '130000', Name: 'Current Assets', AccountType: 'sat_Assets', IsTitleAccount: 'tYES' } }));
      ok(await call(accounts.createAccount, { body: { Code: '130100', Name: 'Petty Cash', FatherAccountKey: '130000',
        IsTitleAccount: 'tNO', ActiveAccount: 'tYES', CashAccount: 'tYES', ControlAccount: 'tNO', Confidential: 'tYES', ExternalCode: 'PC' } }));
      const petty = await masters.getAccount('130100');
      assert.deepEqual([petty.IsTitleAccount, petty.ActiveAccount, petty.AccountType, petty.Level, petty.FatherAccountKey, petty.CashAccount, petty.Confidential],
        ['tNO', 'tYES', 'sat_Assets', 2, '130000', 'tYES', 'tYES']);
      assert.equal((await masters.getAccount('130000')).IsTitleAccount, 'tYES');
      assert.equal(failure(await call(accounts.createAccount, { body: { Code: '130200', Name: 'X', FatherAccountKey: '130100' } })),
        'Parent account "130100" must be a title account.');
      assert.equal(failure(await call(accounts.updateAccount, { params: { code: '130000' }, body: { IsTitleAccount: 'tNO' } })),
        'A title account with child accounts cannot become an active account.');
      // Title accounts cannot be used on masters (warehouse rule from M1 still holds).
      const sl = require('../services/sapService');
      assert.equal(await sl.request({ method: 'POST', url: '/Warehouses', data: { WarehouseCode: 'W9', WarehouseName: 'x', StockAccount: '130000' } })
        .then(() => null, (e) => e.message), 'G/L account "130000" is a title account; select an active account.');
    });
  });
});
test('UoM setup lists saved units and protects SAP group conversion rules', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('uom_rules', async ({ asUser, sql }) => {
    const controller = require('../controllers/uomGroupController');
    const masters = require('../services/masterDataDbService');
    const sap = require('../services/sapService');
    await asUser(async () => {
      const unit = ok(await call(controller.createUoM, { body: { Code: 'KGS', Name: 'Kilogram' } }));
      const units = ok(await call(controller.lookupUoMs));
      assert.ok(units.some((row) => row.uomCode === 'KGS' && row.uomName === 'Kilogram' && Number(row.code) === unit.AbsEntry));
      assert.ok(!(await masters.searchUoMGroups()).some((row) => row.Code === 'KGS'), 'creating a unit does not create a group');
      assert.match(failure(await call(controller.createUoM, { body: { Code: 'KGS', Name: 'Again' } })), /already exists/);
      const ea = units.find((row) => row.uomCode === 'EA');
      const group = ok(await call(controller.createUoMGroup, { body: { Code: 'WEIGHT_GROUP_CODE_20', Name: 'Weight', BaseUoM: Number(ea.code) } }));
      const patch = (lines) => call(controller.updateUoMGroup, { params: { absEntry: group.AbsEntry }, body: { UoMGroupDefinitionCollection: lines } });
      const base = { AlternateUoM: Number(ea.code), AlternateQuantity: 1, BaseQuantity: 1 };
      const kg = { AlternateUoM: unit.AbsEntry, AlternateQuantity: 1, BaseQuantity: 12 };
      ok(await patch([base, kg]));
      assert.match(failure(await patch([{ ...base, AlternateQuantity: 2, BaseQuantity: 2 }, kg])), /base unit of measure converts 1 to 1/);
      assert.match(failure(await patch([base, kg, kg])), /only once/);
      await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C_UOM', 'UoM Customer', 'C', 1)`);
      await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "UgpEntry", "IUoMEntry", "SUoMEntry", "PUoMEntry") VALUES ('I_UOM', 'UoM Item', 1, $1, $2, $3, $2)`, [group.AbsEntry, Number(ea.code), unit.AbsEntry]);
      const series = (await sql(`SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = '17' ORDER BY "Series" LIMIT 1`)).rows[0].Series;
      const order = (await sap.request({ method: 'POST', url: '/Orders', data: { CardCode: 'C_UOM', Series: series, DocDate: '2026-10-13', DocumentLines: [{ ItemCode: 'I_UOM', Quantity: 1, UnitPrice: 10, UoMEntry: unit.AbsEntry, UnitsOfMeasurment: 12 }] } })).data;
      assert.match(failure(await patch([base, { ...kg, BaseQuantity: 24 }])), /Close or cancel open documents/);
      const unchanged = await masters.getUoMGroup(group.AbsEntry);
      assert.equal(unchanged.UoMGroupDefinitionCollection.find((row) => row.AlternateUoM === unit.AbsEntry).BaseQuantity, 12);
      assert.match(failure(await patch([base])), /rows used by items cannot be removed/);
      assert.match(failure(await call(controller.updateUoMGroup, { params: { absEntry: group.AbsEntry }, body: { BaseUoM: unit.AbsEntry } })), /base UoM cannot change/);
      await sap.request({ method: 'POST', url: '/Orders(' + order.DocEntry + ')/Close' });
      ok(await patch([base, { ...kg, BaseQuantity: 24 }]));
      const changed = await masters.getUoMGroup(group.AbsEntry);
      assert.equal(changed.UoMGroupDefinitionCollection.find((row) => row.AlternateUoM === unit.AbsEntry).BaseQuantity, 24);
    });
  });
  await withLocalCompany('uom_other', async ({ asUser }) => {
    await asUser(async () => {
      const controller = require('../controllers/uomGroupController');
      assert.ok(!ok(await call(controller.lookupUoMs)).some((row) => row.uomCode === 'KGS'));
      ok(await call(controller.createUoM, { body: { Code: 'KGS', Name: 'Other company kilograms' } }));
    });
  });
});
