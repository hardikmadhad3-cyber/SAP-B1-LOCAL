const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const authDb = require('../services/authDbService');
const { seedNewCompany } = require('../scripts/seedNewCompany');
const { runWithRequestContext } = require('../services/requestContextService');
const db = require('../services/dbService');

test('company seed rejects invalid names, schemas and fiscal years before writing', async () => {
  await assert.rejects(seedNewCompany({ name: 'Test', schema: 'public', year: 2026 }), /cmp_/);
  await assert.rejects(seedNewCompany({ name: 'Test', schema: 'cmp_test;drop', year: 2026 }), /cmp_/);
  await assert.rejects(seedNewCompany({ name: 'Test', schema: 'cmp_test', year: 'bad' }), /Fiscal year/);
  await assert.rejects(seedNewCompany({ name: '', schema: 'cmp_test', year: 2026 }), /company name/);
});

test('fresh companies seed atomically, stay isolated, and support existing read services', { skip: !env.databaseUrl }, async () => {
  const nonce = require('node:crypto').randomBytes(4).toString('hex');
  const schema = `cmp_phase2_${process.pid}_${nonce}`;
  const secondSchema = schema + '_b';
  const username = `phase2_${process.pid}_${nonce}`;
  const oldPassword = env.setupAdminPassword;
  env.setupAdminPassword = 'temporary-test-password';
  const companies = [];
  const originalQuery = db.query;
  const queryErrors = [];
  db.query = async (...args) => {
    try { return await originalQuery(...args); }
    catch (error) { queryErrors.push(error.message); throw error; }
  };
  const roleIdsBefore = (await authDb.queryRows('SELECT RoleId FROM Roles')).map((r) => r.RoleId);
  try {
    const company = await seedNewCompany({ name: 'Phase 2 Test', schema, year: 2026, username });
    assert.equal(company.created, true);
    companies.push(company.companyId);
    const second = await seedNewCompany({ name: 'Second Test', schema: secondSchema, year: 2026, username });
    assert.equal(second.created, true);
    companies.push(second.companyId);
    assert.equal((await seedNewCompany({ name: 'Phase 2 Test', schema, year: 2026, username })).created, false);
    await assert.rejects(seedNewCompany({ name: 'Other Name', schema, username }), /already registered/);
    const user = await authDb.findUserByUsername(username);
    assert.ok(user);
    assert.equal((await require('../services/authService').login(username, 'temporary-test-password')).user.userId, user.UserId);
    const companyRows = await authDb.getUserCompanies(user.UserId);
    assert.equal(companyRows.length, 2);
    assert.ok(companyRows.every((r) => r.DbDialect === 'postgres'));
    const checks = [];
    const check = async (label, callback) => {
      try { await callback(); }
      catch (error) { checks.push(label + ': ' + error.message); }
    };
    await runWithRequestContext({ auth: { userId: user.UserId, companyId: company.companyId } }, async () => {
      const masters = require('../services/masterDataDbService');
      for (const name of ['searchBranches', 'searchWarehouses', 'searchPaymentTerms', 'searchUoMGroups',
        'searchTaxCodes', 'searchShippingTypes', 'searchPriceLists', 'searchAccounts', 'searchBP',
        'lookupCountries', 'lookupStates', 'lookupWarehouseLocations', 'lookupBusinessPlaces',
        'lookupGLAccounts', 'lookupUoMs', 'lookupPriceLists', 'lookupCurrencies', 'lookupBPGroups',
        'lookupPaymentTerms', 'lookupSalesPersons', 'lookupDistributionRules', 'lookupProjects']) {
        await check('master.' + name, () => masters[name]());
      }
      await check('documentTaxCodes', async () => {
        assert.ok((await masters.searchDocumentTaxCodes('', 'sales')).some((r) => r.Code === 'ZERO'));
      });
      for (const [module, list] of [
        ['salesQuotationDbService', 'getSalesQuotationList'], ['salesOrderDbService', 'getSalesOrderList'],
        ['deliveryDbService', 'getDeliveryList'], ['arInvoiceDbService', 'getARInvoiceList'],
        ['arCreditMemoDbService', 'getARCreditMemoList'], ['purchaseOrderDbService', 'getPurchaseOrderList'],
        ['grpoDbService', 'getGRPOList'], ['apInvoiceDbService', 'getAPInvoiceList'],
        ['apCreditMemoDbService', 'getAPCreditMemoList'], ['purchaseQuotationDbService', 'getPurchaseQuotationList'],
        ['inventoryTransferRequestDbService', 'getInventoryTransferRequestList'], ['inventoryTransferDbService', 'getInventoryTransferList'],
        ['goodsReceiptDbService', 'getGoodsReceiptList'], ['goodsIssueDbService', 'getGoodsIssueList'],
        ['productionDbService', 'getProductionOrders'],
      ]) {
        const service = require('../services/' + module);
        await check(module + '.' + list, () => service[list]());
        if (service.getReferenceData) await check(module + '.references', () => service.getReferenceData());
      }
      const items = require('../services/itemDbService');
      for (const name of ['searchItems', 'getItemGroups', 'getManufacturers', 'getHSNCodes', 'getPriceLists', 'getVendors', 'getWarehouses', 'getGLAccounts', 'getUoMGroups', 'getItemProperties']) {
        await check('item.' + name, () => items[name]());
      }
      await check('quotation references', () => require('../services/salesQuotationDbService').getReferenceData());
      await check('order references', () => require('../services/salesOrderDbService').getReferenceData());
      await check('purchase requests', () => require('../services/purchaseRequestService').getPurchaseRequests());
      await check('numbering', async () => {
        const series = await require('../services/documentSeriesDbUtils').resolveMarketingDocumentSeries({ db, objectCode: '17', targetDate: '2026-10-11' });
        assert.equal(series.series.length, 1);
        assert.equal(series.postingPeriodValid, true);
        assert.equal(series.series[0].NextNumber, 1);
      });
      await check('dashboard', async () => {
        const overview = await require('../services/dashboardDbService').getOverview({ asOfDate: '2026-10-11' });
        assert.deepEqual(overview.warnings, []);
        assert.equal(overview.kpis.salesAmount.value, 0);
      });
      const criteria = { dateFrom: '2026-04-01', dateTo: '2027-03-31', asOfDate: '2026-10-11', selectedAccountGroups: [1,2,3,4,5] };
      for (const name of ['generalLedger', 'glAccountsBusinessPartners', 'inventoryInWarehouse',
        'inventoryAudit', 'inventoryAging', 'customerReceivablesAging', 'vendorLiabilitiesAging', 'inactiveCustomers']) {
        const service = require('../services/reports/' + name + '.service');
        await check('report.' + name + '.lookups', () => service.getLookups());
        await check('report.' + name, () => service.getReport(criteria));
      }
      await check('financial lookups', () => require('../services/reports/financialStatements.service').getLookups());
      for (const key of ['balance-sheet', 'trial-balance', 'profit-and-loss-statement', 'cash-flow', 'cash-flow-reference-report', 'statement-of-cash-flows', 'business-assessment-report']) {
        await check('report.' + key, () => require('../services/reports/financialStatements.service').getReport(key, criteria));
      }
      await check('report.items', () => require('../services/reports/itemListReport.service').getItemListReport(criteria));
      for (const [module, method] of [['billOfMaterials', 'getBillOfMaterialsReport'], ['productionOpenItems', 'getProductionOpenItemsReport'],
        ['inventoryPostingList', 'getInventoryPostingList'], ['purchaseRequestReport', 'getPurchaseRequestReport'], ['purchaseAnalysis', 'getPurchaseAnalysis'],
        ['activityOverview', 'getActivityOverview'], ['campaignsList', 'getReport']]) {
        await check('report.' + module, () => require('../services/reports/' + module + '.service')[method](module === 'purchaseAnalysis' ? require('../validators/reports/purchaseAnalysis.validator').sanitizePurchaseAnalysisPayload({ tab: 'customers', reportPeriod: 'annual', documentType: 'invoices', dateFilters: { postingDate: { enabled: true, from: '2026-04-01', to: '2027-03-31' } } }) : { ...criteria }));
      }
      const accounting = require('../services/reports/accountingTransactionReports.service');
      for (const key of Object.keys(accounting.REPORT_TITLES)) await check('report.' + key, () => accounting.getReport(key, criteria));
      await check('incoming payments', () => require('../services/incomingPaymentsService').searchIncomingPayments());
      await check('outgoing payments', () => require('../services/outgoingPaymentsService').searchOutgoingPayments());
      for (const name of ['getCustomerSalesAnalysisReport', 'getItemSalesAnalysisReport', 'getSalesEmployeeSalesAnalysisReport']) {
        await check('report.' + name, () => require('../services/salesAnalysisDbService')[name](criteria));
      }
      assert.deepEqual([...checks, ...new Set(queryErrors)], []);
      assert.deepEqual([...new Set(queryErrors)], [], 'Queries that callers swallowed must also succeed');
      await db.query("INSERT INTO OCRD (CardCode, CardName, CardType) VALUES ('C1', 'Test Customer', 'C')");
      await db.query("INSERT INTO OITM (ItemCode, ItemName) VALUES ('I1', 'Test Item')");
      const seriesId = (await db.query("SELECT Series FROM NNM1 WHERE ObjectCode = '13' AND DocSubType = 'GA'")).recordset[0].Series;
      await db.query(`INSERT INTO OINV (DocNum, DocDate, CardCode, Series, DocTotal) VALUES (1, '2026-10-11', 'C1', @series, 12.34)`, { series: seriesId });
      await db.query("INSERT INTO INV1 (DocEntry, LineNum, ItemCode, WhsCode, Quantity, LineTotal) VALUES (1, 0, 'I1', '01', 2, 12.34)");
      const populated = await require('../services/dashboardDbService').getOverview({ asOfDate: '2026-10-11' });
      assert.deepEqual(populated.warnings, []);
      assert.equal(populated.kpis.salesAmount.value, 12.34);
      assert.equal(populated.topItems[0].code, 'I1');
      await assert.rejects(db.query("INSERT INTO RDR1 (DocEntry, LineNum, ItemCode) VALUES (999, 0, 'I1')"), { code: '23503' });
    });
    await runWithRequestContext({ auth: { userId: user.UserId, companyId: second.companyId } }, async () => {
      assert.deepEqual((await db.query('SELECT * FROM OCRD')).recordset, []);
      assert.equal((await db.query('SELECT CompnyName FROM OADM')).recordset[0].CompnyName, 'Second Test');
    });
  } finally {
    db.query = originalQuery;
    env.setupAdminPassword = oldPassword;
    const user = await authDb.findUserByUsername(username);
    for (const companyId of companies) {
      await authDb.query('DELETE FROM UserRoles WHERE CompanyId = @companyId', { companyId });
      await authDb.query('DELETE FROM UserCompanies WHERE CompanyId = @companyId', { companyId });
      await authDb.query('DELETE FROM Companies WHERE CompanyId = @companyId', { companyId });
    }
    if (user) await authDb.query('DELETE FROM Users WHERE UserId = @id', { id: user.UserId });
    for (const role of await authDb.queryRows('SELECT RoleId FROM Roles')) {
      if (!roleIdsBefore.includes(role.RoleId)) {
        await authDb.query('DELETE FROM RoleRights WHERE RoleId = @id AND NOT EXISTS (SELECT 1 FROM UserRoles WHERE RoleId = @id)', { id: role.RoleId });
        await authDb.query('DELETE FROM Roles WHERE RoleId = @id AND NOT EXISTS (SELECT 1 FROM UserRoles WHERE RoleId = @id)', { id: role.RoleId });
      }
    }
    for (const name of [schema, secondSchema]) await pg.getPool('').query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    authDb.clearCache();
    await pg.closeAll();
  }
});
