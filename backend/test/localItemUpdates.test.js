// Item Master Update: what the page sends for cleared fields, zeros, unticked
// properties, the header price and the Remarks / QR / warehouse-management fields
// reaches the database; attachments are stored per company with safe names.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const pg = require('../db/pgDb');
const { withLocalCompany } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('item updates clear values, store zeros and unticked properties', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('itm', async ({ asUser, company }) => {
    const items = require('../services/itemService');
    await asUser(async () => {
      await items.createItem({ ItemCode: 'I100', ItemName: 'Widget', InventoryItem: 'tYES', SalesItem: 'tYES', PurchaseItem: 'tYES',
        ForeignName: 'Gadget', LeadTime: 5, Properties1: 'tYES', SupplierCatalogNo: 'CAT-1', User_Text: 'first' });
      // What ItemMaster buildPayload now sends on Update for these edits.
      await items.updateItem('I100', { ItemName: 'Widget', ForeignName: null, LeadTime: 0, Properties1: 'tNO', SupplierCatalogNo: null,
        User_Text: 'Store dry', ManageStockByWarehouse: 'tYES', CreateQRCodeFrom: 'ItemCode', ItemPrices: [{ PriceList: 1, Price: 111 }] });
      const item = await items.getItem('I100');
      assert.deepEqual(
        [item.ForeignName || '', item.LeadTime, item.Properties1, item.SupplierCatalogNo || '', item.User_Text, item.Remarks, item.ManageStockByWarehouse, item.CreateQRCodeFrom],
        ['', 0, 'tNO', '', 'Store dry', 'Store dry', 'tYES', 'ItemCode'],
      );
      assert.equal(item.ItemPrices.find((row) => Number(row.PriceList) === 1).Price, 111);
    });

    // Attachments: per company directory, file names cannot leave it.
    const controller = require('../controllers/itemController');
    const call = async (handler, params, extra = {}) => {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; }, download(file) { this.file = file; return this; } };
      await handler({ params, auth: { companyId: company.companyId }, ...extra }, res);
      return res;
    };
    const tmp = path.join(__dirname, '..', 'uploads', 'tmp', `att-${process.pid}`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, 'spec');
    const uploaded = await call(controller.uploadAttachment, { itemCode: 'I100' }, { file: { path: tmp, originalname: '../../evil spec.pdf', size: 4 } });
    assert.equal(uploaded.body.name, 'evil spec.pdf', JSON.stringify(uploaded.body));
    const dir = path.join(__dirname, '..', 'uploads', 'items', String(company.companyId), 'I100');
    try {
      assert.ok(fs.existsSync(path.join(dir, 'evil spec.pdf')), 'stored under the company and item');
      assert.deepEqual((await call(controller.getAttachments, { itemCode: 'I100' })).body.map((row) => row.name), ['evil spec.pdf']);
      assert.equal((await call(controller.getAttachments, { itemCode: 'I100' }, { auth: { companyId: company.companyId + 100000 } })).body.length, 0,
        'another company does not see the file');
      assert.equal((await call(controller.serveAttachment, { itemCode: 'I100', attachmentId: '..\..\..\.env' })).statusCode, 404);
      await call(controller.deleteAttachment, { itemCode: 'I100', attachmentId: 'evil spec.pdf' });
      assert.equal(fs.existsSync(path.join(dir, 'evil spec.pdf')), false);
    } finally {
      fs.rmSync(path.join(__dirname, '..', 'uploads', 'items', String(company.companyId)), { recursive: true, force: true });
    }
  });
});
