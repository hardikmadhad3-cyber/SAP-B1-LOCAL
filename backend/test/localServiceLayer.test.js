const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const authDb = require('../services/authDbService');
const { seedNewCompany } = require('../scripts/seedNewCompany');
const { runWithRequestContext } = require('../services/requestContextService');
const local = require('../services/localServiceLayer');

test('parses Service Layer URLs', () => {
  assert.deepEqual(local.parseUrl('/Orders'), { entity: 'Orders', key: undefined, action: undefined, hasQuery: false });
  assert.deepEqual(local.parseUrl('/Orders(12)/Close'), { entity: 'Orders', key: 12, action: 'Close', hasQuery: false });
  assert.equal(local.parseUrl("/Items('A''1')").key, "A'1");
  assert.equal(local.parseUrl('/Orders?$top=1').hasQuery, true);
});

test('local Service Layer creates, reads, updates and closes marketing documents', { skip: !env.databaseUrl }, async () => {
  const nonce = require('node:crypto').randomBytes(4).toString('hex');
  const schema = `cmp_sl_${process.pid}_${nonce}`;
  const username = `sl_${process.pid}_${nonce}`;
  const oldPassword = env.setupAdminPassword;
  env.setupAdminPassword = 'temporary-test-password';
  let company;
  const sl = (method, url, data) => local.request({ method, url, data }, schema);
  const sql = (text, values) => pg.getPool(schema).query(text, values);
  const slMessage = async (promise) => {
    const error = await promise.then(() => null, (e) => e);
    assert.ok(error, 'expected the request to fail');
    return [error.response?.status, error.response?.data?.error?.message?.value];
  };

  try {
    company = await seedNewCompany({ name: 'SL Test', schema, year: 2026, username });
    // Masters the pages would create: a customer, two items, an 18% GST code.
    await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C001', 'Acme Ltd', 'C', 1)`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod") VALUES ('I001', 'Widget', 1), ('I002', 'Gadget', 1)`);
    for (const [code, type] of [['CGST9', -100], ['SGST9', -110]]) {
      await sl('POST', '/SalesTaxAuthorities', { Code: code, Name: code, Type: type, Rate: 9, SalesTaxAccount: '210000', PurchaseTaxAccount: '210000' });
    }
    await sl('POST', '/SalesTaxCodes', { Code: 'GST18', Name: 'GST 18%', SalesTaxCodes_Lines: [{ STACode: 'CGST9' }, { STACode: 'SGST9' }] });

    // Quotation: 2 x 100 at 10% line discount = 180, GST 18% = 32.40.
    const quotation = (await sl('POST', '/Quotations', {
      CardCode: 'C001', DocDate: '2026-10-11',
      DocumentLines: [{ ItemCode: 'I001', Quantity: 2, UnitPrice: 100, DiscountPercent: 10, TaxCode: 'GST18' }],
      U_NotAColumn: 'kept in log',
    })).data;
    assert.equal(quotation.DocNum, 1);
    assert.equal(quotation.CardName, 'Acme Ltd');
    assert.equal(quotation.DocumentStatus, 'bost_Open');
    assert.equal(quotation.DocumentLines[0].ItemDescription, 'Widget');
    assert.equal(quotation.DocumentLines[0].WarehouseCode, '01');
    assert.equal(quotation.DocumentLines[0].LineTotal, 180);
    assert.equal(quotation.VatSum, 32.4);
    assert.equal(quotation.DocTotal, 212.4);
    const log = (await sql('SELECT "Unmapped" FROM "LocalSlLog" WHERE "DocEntry" = $1', [quotation.DocEntry])).rows[0];
    assert.deepEqual(log.Unmapped, { U_NotAColumn: 'kept in log' });

    // Order with header discount and freight: lines 180 + 50 = 230, 10% off = 207,
    // GST on 207 = 37.26, freight 20 (no tax) -> 264.26.
    const order = (await sl('POST', '/Orders', {
      CardCode: 'C001', DocDate: '2026-10-11', DiscountPercent: 10, Confirmed: 'tYES',
      DocumentLines: [
        { ItemCode: 'I001', Quantity: 2, UnitPrice: 100, DiscountPercent: 10, TaxCode: 'GST18',
          BaseType: 23, BaseEntry: quotation.DocEntry, BaseLine: 0 },
        { ItemCode: 'I002', Quantity: 1, UnitPrice: 50, TaxCode: 'GST18' },
      ],
      DocumentAdditionalExpenses: [{ ExpenseCode: 1, LineTotal: 20 }],
    })).data;
    assert.equal(order.DocNum, 1, 'each object has its own series');
    assert.equal(order.TotalDiscount, 23);
    assert.equal(order.VatSum, 37.26);
    assert.equal(order.TotalExpns, 20);
    assert.equal(order.DocTotal, 264.26);
    assert.equal(order.Confirmed, 'tYES');
    assert.equal(order.DocumentLines[0].BaseEntry, quotation.DocEntry);

    // PATCH: change row 0 quantity, add a row; untouched rows stay.
    assert.equal((await sl('PATCH', `/Orders(${order.DocEntry})`, {
      Comments: 'updated',
      DocumentLines: [{ LineNum: 0, Quantity: 3 }, { ItemCode: 'I002', Quantity: 2, UnitPrice: 50, TaxCode: 'GST18' }],
    })).status, 204);
    const updated = (await sl('GET', `/Orders(${order.DocEntry})`)).data;
    assert.equal(updated.Comments, 'updated');
    assert.deepEqual(updated.DocumentLines.map((l) => [l.LineNum, l.Quantity, l.LineTotal]), [[0, 3, 270], [1, 1, 50], [2, 2, 100]]);
    assert.equal(updated.DocTotal, roundTo((420 * 0.9) * 1.18 + 20));

    // Close, then edits are refused with an SL-shaped error.
    assert.equal((await sl('POST', `/Orders(${order.DocEntry})/Close`)).status, 204);
    assert.equal((await sl('GET', `/Orders(${order.DocEntry})`)).data.DocumentStatus, 'bost_Close');
    assert.deepEqual(await slMessage(sl('PATCH', `/Orders(${order.DocEntry})`, { Comments: 'x' })),
      [400, 'Closed or cancelled documents cannot be updated.']);

    // Validation errors read like SAP's and leave nothing behind.
    const before = (await sql('SELECT "NextNumber" FROM "NNM1" WHERE "ObjectCode" = \'17\'')).rows[0].NextNumber;
    assert.deepEqual(await slMessage(sl('POST', '/Orders', { CardCode: 'C001', DocDate: '2026-10-11', DocumentLines: [{ ItemCode: 'NOPE', Quantity: 1 }] })),
      [400, 'Row 1: item "NOPE" does not exist.']);
    assert.deepEqual(await slMessage(sl('POST', '/Orders', { CardCode: 'C001', DocDate: '2030-01-01', DocumentLines: [{ ItemCode: 'I001' }] })),
      [400, 'No posting period is defined for 2030-01-01. Create the fiscal period first.']);
    assert.deepEqual(await slMessage(sl('POST', '/Orders', { CardCode: 'C001', DocumentLines: [{ ItemCode: 'I001', TaxCode: 'BAD' }] })),
      [400, 'Tax code "BAD" does not exist.']);
    assert.equal((await sql('SELECT "NextNumber" FROM "NNM1" WHERE "ObjectCode" = \'17\'')).rows[0].NextNumber, before, 'failed posts roll back numbering');
    assert.equal((await slMessage(sl('GET', '/BlanketAgreements(1)')))[0], 501);
    assert.equal((await slMessage(sl('GET', '/ProductionOrders(999)')))[0], 404);
    assert.equal((await slMessage(sl('GET', '/JournalEntries(999)')))[0], 404);
    assert.equal((await slMessage(sl('POST', `/Invoices(999)/Cancel`)))[0], 404);

    // Manual numbers: allowed once, then refused as duplicates.
    assert.equal((await sl('POST', '/Orders', { CardCode: 'C001', HandWritten: 'tYES', DocNum: 5000, DocumentLines: [{ ItemCode: 'I001' }] })).data.DocNum, 5000);
    assert.deepEqual(await slMessage(sl('POST', '/Orders', { CardCode: 'C001', HandWritten: 'tYES', DocNum: 5000, DocumentLines: [{ ItemCode: 'I001' }] })),
      [400, 'Manual document number 5000 is already used.']);

    // Concurrent posts never share a number.
    const parallel = await Promise.all([1, 2, 3, 4].map(() => sl('POST', '/Orders', { CardCode: 'C001', DocumentLines: [{ ItemCode: 'I001' }] })));
    assert.equal(new Set(parallel.map((r) => r.data.DocNum)).size, 4);

    // Exchange rates.
    await sql(`INSERT INTO "OCRN" ("CurrCode", "CurrName") VALUES ('USD', 'US Dollar')`);
    await sl('POST', '/SBOBobService_SetCurrencyRate', { Currency: 'USD', RateDate: '2026-10-11', Rate: 83.5 });
    assert.deepEqual((await sl('POST', '/SBOBobService_GetCurrencyRate', { Currency: 'USD', Date: '2026-10-11' })).data, { value: 83.5 });

    // The real entry point: sapService routes a postgres company here.
    await runWithRequestContext({ auth: { userId: (await authDb.findUserByUsername(username)).UserId, companyId: company.companyId } }, async () => {
      const response = await require('../services/sapService').request({ method: 'get', url: `/Quotations(${quotation.DocEntry})` });
      assert.equal(response.data.DocTotal, 212.4);
    });
  } finally {
    env.setupAdminPassword = oldPassword;
    const user = await authDb.findUserByUsername(username);
    if (company) {
      for (const table of ['UserRoles', 'UserCompanies', 'Companies']) {
        await authDb.query(`DELETE FROM ${table} WHERE CompanyId = @id`, { id: company.companyId });
      }
    }
    if (user) await authDb.query('DELETE FROM Users WHERE UserId = @id', { id: user.UserId });
    await pg.getPool('').query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    authDb.clearCache();
    await pg.closeAll();
  }
});

function roundTo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
