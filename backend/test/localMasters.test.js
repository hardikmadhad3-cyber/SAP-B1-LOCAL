const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

// M4: Business Partner saves through its controller and reads back in SAP's SL shape.
test('Business partner saves locally with addresses, contacts, GSTIN and SAP BP rules', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('bp', async ({ asUser, sql, company }) => {
    const bpController = require('../controllers/businessPartnerController');
    const call = async (handler, { body = {}, params = {} } = {}) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
      await handler({ body, params, query: {}, auth: { companyId: company.companyId } }, res);
      return res;
    };

    await asUser(async () => {
      // What modules/business-partner/BusinessPartner.jsx buildPayload sends.
      const page = {
        CardType: 'cCustomer', CardCode: 'C100', CardName: 'Acme Pvt Ltd', CardForeignName: 'Acme', Currency: 'INR',
        Phone1: '079-1234', Cellular: '98250', EmailAddress: 'a@acme.in', Website: 'acme.in', PayTermsGrpCode: 1,
        PriceListNum: 1, CreditLimit: 50000, FederalTaxID: '24AAACA1234A1Z5', Notes: 'Key account', Properties2: 'tYES',
        Valid: 'tYES', Frozen: 'tNO', CompanyPrivate: 'cCompany', AliasName: 'ACME',
        BPFiscalTaxIDCollection: [{ Address: '', TaxId0: 'AAACA1234A' }],
        BPAddresses: [
          { AddressName: 'Head Office', AddressType: 'bo_BillTo', Street: 'SG Road', City: 'Ahmedabad', State: 'GJ',
            Country: 'IN', ZipCode: '380015', GSTIN: '24AAACA1234A1Z5', GstType: 'gstRegularTDSISD', TaxOffice: 'Ahd-1' },
          { AddressName: 'Plant', AddressType: 'bo_ShipTo', Street: 'GIDC', City: 'Sanand', State: 'GJ', Country: 'IN' },
        ],
        ContactEmployees: [{ Name: 'Ravi', Phone1: '999', E_Mail: 'ravi@acme.in', Position: 'Buyer' }],
      };
      const created = await call(bpController.createBP, { body: structuredClone(page) });
      assert.equal(created.statusCode, 201, JSON.stringify(created.body));

      const loaded = (await call(bpController.getBP, { params: { cardCode: 'C100' } })).body;
      for (const field of ['CardType', 'CardName', 'CardForeignName', 'Currency', 'Phone1', 'Cellular', 'EmailAddress', 'Website',
        'PayTermsGrpCode', 'PriceListNum', 'CreditLimit', 'FederalTaxID', 'Notes', 'Properties2', 'Valid', 'CompanyPrivate', 'AliasName']) {
        assert.equal(String(loaded[field]), String(page[field]), `${field} must round-trip`);
      }
      assert.equal(loaded.BPFiscalTaxIDCollection[0].TaxId0, 'AAACA1234A', 'extra collections are kept');
      const [billTo, shipTo] = loaded.BPAddresses;
      assert.deepEqual([billTo.AddressName, billTo.AddressType, billTo.GSTIN, billTo.GstType, billTo.TaxOffice, billTo.City],
        ['Head Office', 'bo_BillTo', '24AAACA1234A1Z5', 'gstRegularTDSISD', 'Ahd-1', 'Ahmedabad']);
      assert.equal(shipTo.AddressType, 'bo_ShipTo');
      assert.deepEqual([loaded.BilltoDefault, loaded.ShipToDefault, loaded.ContactPerson], ['Head Office', 'Plant', 'Ravi']);
      assert.deepEqual([loaded.ContactEmployees[0].Phone1, loaded.ContactEmployees[0].E_Mail, loaded.ContactEmployees[0].Position],
        ['999', 'ravi@acme.in', 'Buyer']);

      // What documents read: OCRD default address copy and the CRD1 GSTIN.
      const ocrd = (await sql('SELECT "Address", "City", "State1", "MailAddres", "LicTradNum" FROM "OCRD" WHERE "CardCode" = $1', ['C100'])).rows[0];
      assert.deepEqual(ocrd, { Address: 'SG Road', City: 'Ahmedabad', State1: 'GJ', MailAddres: 'GIDC', LicTradNum: '24AAACA1234A1Z5' });
      const docAddresses = await require('../services/businessPartnerAddressDbUtils')
        .loadBusinessPartnerAddresses(require('../services/dbService'), 'C100');
      assert.ok(JSON.stringify(docAddresses).includes('24AAACA1234A1Z5'), JSON.stringify(docAddresses));

      // Update: rename, add a ship-to, change a contact; untouched rows stay.
      const updated = await call(bpController.updateBP, { params: { cardCode: 'C100' }, body: {
        CardName: 'Acme Private Limited',
        BPAddresses: [{ AddressName: 'Warehouse 2', AddressType: 'bo_ShipTo', City: 'Vadodara', State: 'GJ', Country: 'IN' }],
        ContactEmployees: [{ Name: 'Ravi', Phone1: '888' }],
      } });
      assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
      assert.equal(updated.body.CardName, 'Acme Private Limited');
      assert.deepEqual(updated.body.BPAddresses.map((a) => a.AddressName), ['Head Office', 'Plant', 'Warehouse 2']);
      assert.equal(updated.body.ContactEmployees.length, 1);
      assert.equal(updated.body.ContactEmployees[0].Phone1, '888');
      assert.equal(updated.body.ContactEmployees[0].E_Mail, 'ravi@acme.in');
      assert.equal(updated.body.Notes, 'Key account');

      // SAP rules.
      const fail = async (handler, request) => (await call(handler, request)).body.message;
      assert.equal(await fail(bpController.createBP, { body: { ...structuredClone(page), CardCode: 'C101',
        BPAddresses: [{ AddressName: 'X', GSTIN: '24BADGSTIN' }] } }), 'GSTIN "24BADGSTIN" on address "X" is not valid.');
      assert.equal(await fail(bpController.createBP, { body: { CardType: 'cCustomer', CardCode: 'C100', CardName: 'Dup' } }),
        'Business partner "C100" already exists.');
      assert.equal(await fail(bpController.createBP, { body: { CardType: 'cSupplier', CardCode: 'V1', CardName: 'Vendor', GroupCode: 1 } }),
        'BP group 1 is not a vendor group.');
      assert.equal((await sql(`SELECT count(*)::int AS n FROM "OCRD" WHERE "CardCode" IN ('C101', 'V1')`)).rows[0].n, 0);
      const local = require('../services/localServiceLayer');
      assert.equal(await local.request({ method: 'PATCH', url: "/BusinessPartners('C100')", data: { CardType: 'cSupplier' } }, (await sql('SELECT current_schema() AS s')).rows[0].s)
        .then(() => null, (e) => e.message), 'The BP type cannot change (only a lead can become a customer).');

      // BP numbering series: SAP assigns the code at save time.
      const series = (await sql(`SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = '2' AND "DocSubType" = 'C'`)).rows[0].Series;
      const first = await call(bpController.createBP, { body: { CardType: 'cCustomer', CardName: 'Series BP', Series: series } });
      const second = await call(bpController.createBP, { body: { CardType: 'cCustomer', CardName: 'Series BP 2', Series: series } });
      assert.deepEqual([first.body.CardCode, second.body.CardCode], ['C00001', 'C00002'], JSON.stringify(first.body));

      // The new customer works on a sales order.
      const orderSeries = (await sql(`SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = '17'`)).rows[0].Series;
      await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod") VALUES ('I1', 'Item', 1)`);
      const order = (await require('../services/sapService').request({ method: 'POST', url: '/Orders', data: {
        CardCode: 'C100', Series: orderSeries, DocDate: '2026-10-11', DocumentLines: [{ ItemCode: 'I1', Quantity: 1, UnitPrice: 10 }] } })).data;
      assert.equal(order.CardName, 'Acme Private Limited');
    });
  });
});

// M4: Item Master saves through itemService and reads back through the page's reader.
test('Item master saves locally with prices, warehouses, barcodes and SAP item rules', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('itm', async ({ asUser, sql }) => {
    const sl = (method, url, data) => require('../services/sapService').request({ method, url, data });
    const items = require('../services/itemService');

    await asUser(async () => {
      for (const [code, type] of [['CGST9', -100], ['SGST9', -110]]) {
        await sl('POST', '/SalesTaxAuthorities', { Code: code, Name: code, Type: type, Rate: 9, SalesTaxAccount: '210000', PurchaseTaxAccount: '210000' });
      }
      await sl('POST', '/SalesTaxCodes', { Code: 'GST18', Name: 'GST 18%', SalesTaxCodes_Lines: [{ STACode: 'CGST9' }, { STACode: 'SGST9' }] });
      const hsn = (await sl('POST', '/ChapterIDs', { ChapterID: '84713010', Description: 'Portable computers' })).data;
      await sl('POST', '/Warehouses', { WarehouseCode: 'W2', WarehouseName: 'Second' });
      await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('V1', 'Vendor', 'S', 2), ('C1', 'Cust', 'C', 1)`);

      // What modules/item-master/ItemMaster.jsx buildPayload sends (HSN already resolved by the controller).
      const page = {
        ItemCode: 'FG001', ItemName: 'Laptop 14"', ForeignName: 'Notebook', InventoryItem: 'tYES', SalesItem: 'tYES',
        PurchaseItem: 'tYES', ItemType: 'itItems', ItemClass: 'itcMaterial', ItemsGroupCode: 1, VatLiable: 'tYES',
        ArTaxCode: 'GST18', ApTaxCode: 'GST18', GSTRelevnt: 'tYES', GSTTaxCategory: 'gtc_Regular', ChapterID: hsn.AbsEntry,
        Valid: 'tYES', ValidFrom: '2026-04-01', Mainsupplier: 'V1', SalesUnit: 'Nos', SalesItemsPerUnit: 1,
        PurchaseUnit: 'Box', PurchaseItemsPerUnit: 10, DefaultWarehouse: '01', CostAccountingMethod: 'bis_MovingAverage',
        GLMethod: 'glm_WH', PlanningSystem: 'bop_None', ProcurementMethod: 'bom_Buy', MinInventory: 2, MaxInventory: 100,
        IncomeAccount: '400000', ExpanseAccount: '510000', User_Text: 'Remarks here', Properties3: 'tYES',
        ItemPrices: [{ PriceList: 1, Price: 250, Currency: 'INR', Factor: 1 }],
        ItemWarehouseInfoCollection: [{ WarehouseCode: '01', MinimalStock: 5, MaximalStock: 50, MinimalOrder: 1 }],
        ItemBarCodeCollection: [{ Barcode: '8901234567890', Quantity: 1 }],
        ItemPreferredVendors: [{ BPCode: 'V1' }],
      };
      await items.createItem(page);
      const loaded = await items.getItem('FG001');
      const collections = ['ItemPrices', 'ItemWarehouseInfoCollection', 'ItemBarCodeCollection', 'ItemPreferredVendors', 'ChapterID'];
      for (const [field, value] of Object.entries(page).filter(([field]) => !collections.includes(field))) {
        assert.equal(String(loaded[field]), String(value), `${field} must round-trip`);
      }
      assert.equal(loaded.ChapterID, '84713010', 'the page shows the HSN code');
      assert.equal(loaded.ItemPrices.find((p) => p.PriceList === 1).Price, 250);
      assert.deepEqual(loaded.ItemWarehouseInfoCollection.map((w) => [w.WarehouseCode, w.MinimalStock, w.MaximalStock]),
        [['01', 5, 50], ['W2', 0, 0]], 'a row per warehouse, as SAP creates them');
      assert.equal(loaded.ItemBarCodeCollection[0].Barcode, '8901234567890');
      assert.equal(loaded.ItemPreferredVendors[0].VendorCode || loaded.ItemPreferredVendors[0].BPCode, 'V1');

      // A warehouse created later gets a row for the existing item.
      await sl('POST', '/Warehouses', { WarehouseCode: 'W3', WarehouseName: 'Third' });
      assert.ok((await items.getItem('FG001')).ItemWarehouseInfoCollection.some((w) => w.WarehouseCode === 'W3'));

      // Update.
      await items.updateItem('FG001', { ItemName: 'Laptop 15"', ItemPrices: [{ PriceList: 1, Price: 300 }],
        ItemWarehouseInfoCollection: [{ WarehouseCode: '01', MinimalStock: 10 }] });
      const updated = await items.getItem('FG001');
      assert.equal(updated.ItemName, 'Laptop 15"');
      assert.equal(updated.ItemPrices.find((p) => p.PriceList === 1).Price, 300);
      assert.equal(updated.ItemWarehouseInfoCollection.find((w) => w.WarehouseCode === '01').MinimalStock, 10);
      assert.equal(updated.ForeignName, 'Notebook', 'untouched fields stay');

      // SAP rules (engine level; itemService also pre-cleans some fields).
      const fail = (promise) => promise.then(() => null, (e) => e.message);
      for (const [data, message] of [
        [{ ItemCode: 'FG001', ItemName: 'x' }, 'Item "FG001" already exists.'],
        [{ ItemCode: 'X1' }, 'Enter the item description.'],
        [{ ItemCode: 'X2', ItemName: 'x', DefaultWarehouse: 'NOPE' }, 'Warehouse "NOPE" does not exist.'],
        [{ ItemCode: 'X3', ItemName: 'x', ArTaxCode: 'NOPE' }, 'Tax code "NOPE" does not exist.'],
        [{ ItemCode: 'X4', ItemName: 'x', ItemPrices: [{ PriceList: 99, Price: 1 }] }, 'Price list 99 does not exist.'],
        [{ ItemCode: 'X5', ItemName: 'x', ItemPrices: [{ PriceList: 1, Price: -1 }] }, 'Prices cannot be negative.'],
        [{ ItemCode: 'X6', ItemName: 'x', InventoryItem: 'tNO', SalesItem: 'tNO', PurchaseItem: 'tNO' },
          'Select at least one of inventory, sales or purchase item.'],
        [{ ItemCode: 'X7', ItemName: 'x', IncomeAccount: '999' }, 'G/L account "999" does not exist.'],
      ]) {
        assert.equal(await fail(sl('POST', '/Items', data)), message);
      }
      assert.equal((await sql(`SELECT count(*)::int AS n FROM "OITM" WHERE "ItemCode" LIKE 'X%'`)).rows[0].n, 0, 'failed saves leave nothing');

      // Used in a document: valuation and stock-keeping settings are fixed.
      const series = (await sql(`SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = '17'`)).rows[0].Series;
      const order = (await sl('POST', '/Orders', { CardCode: 'C1', Series: series, DocDate: '2026-10-11',
        DocumentLines: [{ ItemCode: 'FG001', Quantity: 1, UnitPrice: 300, TaxCode: 'GST18' }] })).data;
      assert.equal(order.DocTotal, 354);
      assert.equal(await fail(items.updateItem('FG001', { CostAccountingMethod: 'bis_FIFO' })),
        'Item "FG001" already has stock or documents; EvalSystem cannot change.');

      // Item numbering series: SAP assigns the code at save time.
      const itemSeries = (await sql(`SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = '4'`)).rows[0].Series;
      const first = await items.createItem({ ItemCode: 'preview', ItemName: 'Series item', Series: itemSeries });
      const second = await items.createItem({ ItemCode: 'preview', ItemName: 'Series item 2', Series: itemSeries });
      assert.deepEqual([first.ItemCode, second.ItemCode], ['000001', '000002']);
    });
  });
});

// M3: HSN (OCHP) and SAC (OSAC) codes, as Item Master and documents read them.
test('HSN and SAC codes follow GST formats and stay linked to items', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('hsn', async ({ asUser, sql }) => {
    const sl = (method, url, data) => require('../services/sapService').request({ method, url, data });
    const hsn = require('../services/hsnCodeDbService');

    await asUser(async () => {
      // No SAC codes yet: the SAC list is empty, not HSN codes in disguise.
      assert.deepEqual(await hsn.getSACCodes(''), []);

      const created = (await sl('POST', '/ChapterIDs', { ChapterID: '84713010', Description: 'Portable computers' })).data;
      assert.deepEqual([created.Chapter, created.Heading, created.SubHeading], ['84', '71', '3010']);
      assert.equal(await hsn.resolveHSNCodeToAbsEntry('84713010'), created.AbsEntry);
      assert.equal((await hsn.getHSNCodes('8471'))[0].description, 'Portable computers');

      for (const [code, message] of [['847', 'An HSN code has 4, 6 or 8 digits.'], ['84A1', 'An HSN code has 4, 6 or 8 digits.'],
        ['84713010', 'HSN code "84713010" already exists.']]) {
        assert.deepEqual(await slFailure(sl('POST', '/ChapterIDs', { ChapterID: code, Description: 'x' })), [400, message]);
      }
      assert.deepEqual(await slFailure(sl('POST', '/ChapterIDs', { ChapterID: '8471' })), [400, 'Enter the description.']);

      // Items reference the internal key, so a corrected code follows every item.
      await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "ChapterID") VALUES ('LAP1', 'Laptop', 1, $1)`, [created.AbsEntry]);
      await sl('PATCH', `/ChapterIDs(${created.AbsEntry})`, { ChapterID: '84713020' });
      const fromItem = await hsn.getHSNCodeFromItem('LAP1');
      assert.equal(fromItem.hsnCode || fromItem.HSNCode || fromItem.code, '84713020');
      await assert.rejects(sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "ChapterID") VALUES ('BAD', 'x', 1, 99999)`), /FK_OITM_ChapterID/);

      // SAC.
      const sac = (await sl('POST', '/SACCodes', { ServiceCode: '998314', ServiceName: 'IT design and development services' })).data;
      assert.equal(await hsn.resolveSACCodeToAbsEntry('998314'), sac.AbsEntry);
      assert.equal(await hsn.resolveSACCodeToAbsEntry('84713020'), null, 'an HSN code is not a SAC code');
      assert.equal((await hsn.getSACCodes('9983'))[0].serviceName, 'IT design and development services');
      assert.deepEqual(await slFailure(sl('POST', '/SACCodes', { ServiceCode: '123456', ServiceName: 'x' })),
        [400, 'A SAC code has 6 digits and starts with 99.']);
      await sl('PATCH', `/SACCodes(${sac.AbsEntry})`, { ServiceName: 'IT services' });
      assert.equal((await sl('GET', `/SACCodes(${sac.AbsEntry})`)).data.ServiceName, 'IT services');
    });
  });
});

// M2: GST components and tax codes, SAP India rules, and what documents see.
test('GST tax components and tax codes follow SAP India rules and feed documents', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('tax', async ({ asUser, sql }) => {
    const sl = (method, url, data) => require('../services/sapService').request({ method, url, data });
    const masters = require('../services/masterDataDbService');
    const component = (Code, Type, Rate, extra = {}) => sl('POST', '/SalesTaxAuthorities', {
      Code, Name: Code, Type, Rate, SalesTaxAccount: '210000', PurchaseTaxAccount: '210000', ...extra,
    });

    await asUser(async () => {
      // Components (OSTA).
      for (const [code, type, rate] of [['CGST9', -100, 9], ['SGST9', -110, 9], ['IGST18', -120, 18], ['CGST6', -100, 6], ['SGST6', -110, 6]]) {
        await component(code, type, rate);
      }
      assert.deepEqual(await slFailure(component('BAD', -999, 5)), [400, 'Tax type -999 does not exist.']);
      assert.deepEqual(await slFailure(component('BAD', -100, 105)), [400, 'The component rate must be between 0 and 100.']);
      assert.deepEqual(await slFailure(sl('POST', '/SalesTaxAuthorities', { Code: 'BAD', Name: 'x', Type: -100, Rate: 5 })),
        [400, 'Enter the sales and purchase tax accounts.']);
      assert.deepEqual(await slFailure(component('CGST9', -100, 9)), [400, 'Tax component "CGST9" already exists.']);

      // Codes (OSTC + STC1): rate is the sum of components; type/rate come from the component.
      const created = (await sl('POST', '/SalesTaxCodes', {
        Code: 'GST18', Name: 'GST 18%', SalesTaxCodes_Lines: [{ STACode: 'CGST9', EffectiveRate: 99 }, { STACode: 'SGST9' }],
      })).data;
      assert.equal(created.Rate, 18);
      assert.deepEqual(created.SalesTaxCodes_Lines.map((l) => [l.LineNumber, l.STACode, l.STAType, l.EffectiveRate]),
        [[0, 'CGST9', -100, 9], [1, 'SGST9', -110, 9]]);
      await sl('POST', '/SalesTaxCodes', { Code: 'IGST18', Name: 'IGST 18%', SalesTaxCodes_Lines: [{ STACode: 'IGST18' }] });
      await sl('POST', '/SalesTaxCodes', { Code: 'GST18AR', Name: 'GST 18% sales only', ValidForAP: 'tNO',
        SalesTaxCodes_Lines: [{ STACode: 'CGST9' }, { STACode: 'SGST9' }] });

      for (const [lines, message] of [
        [[{ STACode: 'CGST9' }], 'CGST and SGST must be used together with equal rates.'],
        [[{ STACode: 'CGST9' }, { STACode: 'SGST6' }], 'CGST and SGST must be used together with equal rates.'],
        [[{ STACode: 'IGST18' }, { STACode: 'CGST9' }], 'IGST cannot be combined with CGST or SGST in one tax code.'],
        [[{ STACode: 'CGST9' }, { STACode: 'CGST9' }], 'A tax component can appear only once in a tax code.'],
        [[{ STACode: 'NOPE' }], 'Tax component "NOPE" does not exist.'],
        [[], 'Add at least one tax component.'],
      ]) {
        assert.deepEqual(await slFailure(sl('POST', '/SalesTaxCodes', { Code: 'X1', Name: 'x', SalesTaxCodes_Lines: lines })), [400, message]);
      }
      assert.deepEqual(await slFailure(sl('POST', '/SalesTaxCodes', { Code: 'X1', Name: 'x', ValidForAR: 'tNO', ValidForAP: 'tNO',
        SalesTaxCodes_Lines: [{ STACode: 'IGST18' }] })), [400, 'A tax code must be valid for sales, purchasing or both.']);

      // What the sales/purchase pages read.
      const listed = await masters.searchDocumentTaxCodes('', 'sales', 50, 0);
      const byCode = Object.fromEntries(listed.map((row) => [row.Code, row]));
      assert.equal(Number(byCode.GST18.Rate), 18);
      assert.equal(byCode.GST18.GSTType, 'INTRASTATE');
      assert.equal(byCode.IGST18.GSTType, 'INTERSTATE');

      // Documents: rate, A/R-A/P validity, inactive.
      await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C1', 'Cust', 'C', 1), ('V1', 'Vend', 'S', 2)`);
      await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod") VALUES ('I1', 'Item', 1)`);
      const seriesOf = async (objectCode) => (await sql('SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = $1', [objectCode])).rows[0].Series;
      const doc = async (url, CardCode, TaxCode) => sl('POST', url, {
        CardCode, DocDate: '2026-10-11', Series: await seriesOf(url === '/Orders' ? '17' : '22'),
        DocumentLines: [{ ItemCode: 'I1', Quantity: 1, UnitPrice: 100, TaxCode }],
      });
      const order = (await doc('/Orders', 'C1', 'GST18')).data;
      assert.equal(order.VatSum, 18);
      assert.equal(order.DocTotal, 118);
      assert.equal((await doc('/Orders', 'C1', 'GST18AR')).data.DocTotal, 118);
      assert.deepEqual(await slFailure(doc('/PurchaseOrders', 'V1', 'GST18AR')),
        [400, 'Tax code "GST18AR" is not valid for purchasing documents.']);
      await sl('PATCH', "/SalesTaxCodes('IGST18')", { Inactive: 'tYES' });
      assert.deepEqual(await slFailure(doc('/Orders', 'C1', 'IGST18')), [400, 'Tax code "IGST18" is inactive.']);

      // Posted tax codes keep their components and rates; descriptions may change.
      assert.deepEqual(await slFailure(sl('PATCH', "/SalesTaxCodes('GST18')", { SalesTaxCodes_Lines: [{ STACode: 'CGST6' }, { STACode: 'SGST6' }] })),
        [400, 'Tax code "GST18" is already used in documents; its rate or components cannot change. Create a new one and set this one inactive.']);
      assert.deepEqual(await slFailure(sl('PATCH', "/SalesTaxAuthorities('CGST9')", { Rate: 10 })),
        [400, 'Tax component "CGST9" is already used in documents; its rate or components cannot change. Create a new one and set this one inactive.']);
      await sl('PATCH', "/SalesTaxCodes('GST18')", { Name: 'GST @ 18%' });
      assert.equal((await sl('GET', "/SalesTaxCodes('GST18')")).data.Name, 'GST @ 18%');

      // An unused component's new rate flows into the codes that use it.
      await sl('POST', '/SalesTaxCodes', { Code: 'GST12', Name: 'GST 12%', SalesTaxCodes_Lines: [{ STACode: 'CGST6' }, { STACode: 'SGST6' }] });
      await sl('PATCH', "/SalesTaxAuthorities('CGST6')", { Rate: 7 });
      await sl('PATCH', "/SalesTaxAuthorities('SGST6')", { Rate: 7 });
      assert.equal((await sl('GET', "/SalesTaxCodes('GST12')")).data.Rate, 14);
      assert.deepEqual(await slFailure(sl('PATCH', "/SalesTaxAuthorities('CGST6')", { Type: -120 })),
        [400, 'Tax component "CGST6" is used in tax codes; its tax type cannot change.']);
    });
  });
});

// M1: the Warehouse page's own payload saves locally and reads back unchanged.
test('Warehouse master saves through the page path and round-trips every field', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('whs', async ({ sql, asUser }) => {
    await sql(`INSERT INTO "OACT" ("AcctCode", "AcctName", "GroupMask", "Postable") VALUES
      ('120100', 'Raw Material Stock', 1, 'Y'), ('120000T', 'Inventory (title)', 1, 'N')`);
    const sapService = require('../services/sapService');
    const masters = require('../services/masterDataDbService');

    // Exactly what modules/warehouse/Warehouse.jsx sends.
    const page = {
      WarehouseCode: 'RM01', WarehouseName: 'Raw Material Store', Inactive: 'tNO', DropShip: 'tNO',
      Nettable: 'tYES', Excisable: 'tNO', EnableBinLocations: 'tNO', Location: 1, WHShipToName: 'Plant 1',
      BusinessPlaceID: 1, AddressType: 'Plant', Street: 'GIDC Road', StreetNo: '12', Block: 'B',
      BuildingFloorRoom: 'Shed 3', ZipCode: '380015', City: 'Ahmedabad', County: 'Ahmedabad', Country: 'IN',
      State: 'GJ', GlobalLocationNumber: 'GLN1', AddressName2: 'Unit 2', AddressName3: 'Gate 4',
      StockAccount: '120100', CostOfGoodsSold: '500000', TransfersAcc: '120000', ReturningAccount: '400000',
      DecreasingAccount: '510000', IncreasingAcc: '510000', PurchaseAccount: '500000',
      PurchaseReturningAccount: '500000', PurchaseOffsetAccount: '200000', WIPMaterialAccount: '120000',
      ExpensesClearingAccount: '510000', TaxGroup: 'ZERO',
    };

    await asUser(async () => {
      assert.equal((await sapService.request({ method: 'POST', url: '/Warehouses', data: page })).status, 201);
      const loaded = await masters.getWarehouse('RM01');
      for (const [field, value] of Object.entries(page)) {
        assert.equal(String(loaded[field]), String(value), `${field} must round-trip`);
      }

      // PATCH: rename and change an account; the code is fixed.
      await sapService.request({ method: 'PATCH', url: "/Warehouses('RM01')", data: { WarehouseName: 'RM Store', StockAccount: '120000' } });
      const patched = await masters.getWarehouse('RM01');
      assert.equal(patched.WarehouseName, 'RM Store');
      assert.equal(patched.StockAccount, '120000');
      assert.equal(patched.City, 'Ahmedabad', 'untouched fields stay');
      assert.deepEqual(await slFailure(sapService.request({ method: 'PATCH', url: "/Warehouses('RM01')", data: { WarehouseCode: 'RM02' } })),
        [400, 'The warehouse code cannot be changed.']);

      // SAP rules.
      assert.deepEqual(await slFailure(sapService.request({ method: 'POST', url: '/Warehouses', data: { WarehouseCode: 'RM01', WarehouseName: 'Again' } })),
        [400, 'Warehouse "RM01" already exists.']);
      assert.deepEqual(await slFailure(sapService.request({ method: 'POST', url: '/Warehouses', data: { WarehouseCode: 'RM03' } })),
        [400, 'Enter the warehouse name.']);
      assert.deepEqual(await slFailure(sapService.request({ method: 'POST', url: '/Warehouses', data: { WarehouseCode: 'RM03', WarehouseName: 'X', StockAccount: '999' } })),
        [400, 'G/L account "999" does not exist.']);
      assert.deepEqual(await slFailure(sapService.request({ method: 'POST', url: '/Warehouses', data: { WarehouseCode: 'RM03', WarehouseName: 'X', StockAccount: '120000T' } })),
        [400, 'G/L account "120000T" is a title account; select an active account.']);
      assert.equal((await slFailure(sapService.request({ method: 'POST', url: '/Warehouses', data: { WarehouseCode: 'TOOLONG01', WarehouseName: 'X' } })))[0], 400);
      assert.deepEqual(await slFailure(sapService.request({ method: 'PATCH', url: "/Warehouses('01')", data: { Inactive: 'tYES' } })),
        [400, 'Warehouse "01" is the company default warehouse and cannot be inactive.']);

      await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod") VALUES ('I1', 'Item', 1)`);
      await sql(`INSERT INTO "OITW" ("ItemCode", "WhsCode", "OnHand") VALUES ('I1', 'RM01', 5)`);
      assert.deepEqual(await slFailure(sapService.request({ method: 'PATCH', url: "/Warehouses('RM01')", data: { Inactive: 'tYES' } })),
        [400, 'Warehouse "RM01" has stock or open quantities and cannot be inactive.']);
      await sql(`UPDATE "OITW" SET "OnHand" = 0`);
      await sapService.request({ method: 'PATCH', url: "/Warehouses('RM01')", data: { Inactive: 'tYES' } });
      assert.equal((await masters.getWarehouse('RM01')).Inactive, 'tYES');

      // The list the transaction pages use sees it.
      assert.ok((await masters.searchWarehouses('RM')).some((row) => row.WarehouseCode === 'RM01'));
    });
  });
});
