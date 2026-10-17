const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const { withLocalCompany } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

const chains = [
  ['Quotations', 'Orders'], ['Quotations', 'DeliveryNotes'], ['Orders', 'DeliveryNotes'],
  ['Quotations', 'Invoices'], ['Orders', 'Invoices'], ['DeliveryNotes', 'Invoices'], ['Invoices', 'CreditNotes'],
  ['PurchaseRequests', 'PurchaseQuotations'], ['PurchaseRequests', 'PurchaseOrders'],
  ['PurchaseQuotations', 'PurchaseOrders'], ['PurchaseOrders', 'PurchaseDeliveryNotes'],
  ['PurchaseOrders', 'PurchaseInvoices'], ['PurchaseDeliveryNotes', 'PurchaseInvoices'], ['PurchaseInvoices', 'PurchaseCreditNotes'],
];

for (const company of ['copy_a', 'copy_b']) {
  test(company + ': every supported copy chain resolves omitted items in its own company', { skip: !env.databaseUrl }, async () => {
    await withLocalCompany(company, async ({ schema, sql }) => {
      const item = company.toUpperCase();
      await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C001', 'Customer', 'C', 1), ('V001', 'Vendor', 'S', 2)`);
      await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem") VALUES ($1, $1, 1, 'Y')`, [item]);
      await sql(`UPDATE "OWHS" SET "PriceDifAc" = '500000' WHERE "WhsCode" = '01'`);
      const sl = async (entity, payload) => (await local.request({ method: 'POST', url: '/' + entity, data: { DocDate: '2026-10-13', ...payload } }, schema)).data;
      await sl('PurchaseDeliveryNotes', { CardCode: 'V001', DocumentLines: [{ ItemCode: item, WarehouseCode: '01', Quantity: 100, UnitPrice: 10 }] });
      for (const [baseEntity, targetEntity] of chains) {
        const card = targetEntity.startsWith('Purchase') ? 'V001' : 'C001';
        const base = await sl(baseEntity, { CardCode: card, DocumentLines: [{ ItemCode: item, WarehouseCode: '01', Quantity: 2, UnitPrice: 10 }] });
        const target = await sl(targetEntity, { CardCode: card, DocumentLines: [{ BaseType: Number(local.DOCUMENTS[baseEntity].objType), BaseEntry: base.DocEntry, BaseLine: 0, Quantity: 1, UnitPrice: 10 }] });
        assert.equal(target.DocumentLines[0].ItemCode, item, baseEntity + ' -> ' + targetEntity);
        assert.equal(target.DocumentLines[0].WarehouseCode, '01');
        const savedBase = (await local.request({ method: 'GET', url: '/' + baseEntity + '(' + base.DocEntry + ')' }, schema)).data;
        assert.equal(savedBase.DocumentLines[0].RemainingOpenQuantity, 1);
      }
      for (const entity of ['Invoices', 'CreditNotes', 'PurchaseInvoices', 'PurchaseCreditNotes']) {
        const purchase = entity.startsWith('Purchase');
        const service = await sl(entity, { CardCode: purchase ? 'V001' : 'C001', DocType: 'dDocument_Service', DocumentLines: [{ ItemDescription: 'Service', AccountCode: purchase ? '510000' : '400000', Quantity: 1, UnitPrice: 10 }] });
        assert.equal(service.DocType, 'dDocument_Service');
        assert.equal(service.DocumentLines[0].ItemCode, null);
      }
      const unbalanced = await sql('SELECT "TransId" FROM "JDT1" GROUP BY "TransId" HAVING SUM("Debit") <> SUM("Credit")');
      assert.equal(unbalanced.rowCount, 0);
    });
  });
}
