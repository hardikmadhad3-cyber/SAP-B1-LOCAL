// Creates a separate demo company filled with trial data for testing every page:
// setup, masters and a full purchase + sales cycle (posted stock and journals).
// Everything goes through the same local Service Layer and setup service the
// pages call, so all SAP rules apply and the numbers are consistent.
//
//   node scripts/seedDemoData.js                    (company "Demo Trading", schema cmp_demo_trading, user manager)
//   node scripts/seedDemoData.js --reset            (drop that demo company first and rebuild it)
//   node scripts/seedDemoData.js --schema cmp_demo_2 --name "Demo 2" --username manager
const { parseArgs } = require('node:util');
const pgDb = require('../db/pgDb');
const authDb = require('../services/authDbService');
const { seedNewCompany } = require('./seedNewCompany');
const { runWithRequestContext } = require('../services/requestContextService');

const YEAR = 2026; // financial year 2026-27 (Apr 2026 - Mar 2027)

const removeCompany = async (schema) => {
  if (!/^cmp_demo/.test(schema)) throw new Error('--reset only removes demo schemas (cmp_demo...).');
  const companies = await require('../services/appDbService').queryRows('SELECT CompanyId FROM Companies WHERE DbName = @schema', { schema });
  for (const { CompanyId } of companies) {
    for (const table of ['UserRoles', 'UserCompanies', 'Companies']) await authDb.query(`DELETE FROM ${table} WHERE CompanyId = @id`, { id: CompanyId });
  }
  await pgDb.getPool('').query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  authDb.clearCache();
};

const fillCompany = async (sql) => {
  const sap = require('../services/sapService');
  const setup = require('../services/localSetupService');
  const post = async (url, data) => (await sap.request({ method: 'POST', url, data })).data;
  const counts = {};
  // Pages always send a series; use each object's default series as the page would preselect it.
  const { DOCUMENTS } = require('../services/localServiceLayer');
  const document = async (url, data) => {
    counts[url] = (counts[url] || 0) + 1;
    // SAP B1 India: invoices and credit memos are GST tax invoices (subtype GA) with their own series.
    const objType = DOCUMENTS[url.slice(1)].objType;
    const subType = ['13', '14', '18', '19'].includes(objType) ? 'GA' : '--';
    const Series = (await sql('SELECT "DfltSeries" FROM "ONNM" WHERE "ObjectCode" = $1 AND "DocSubType" = $2', [objType, subType])).rows[0].DfltSeries;
    try {
      return await post(url, { Series, ...(subType === 'GA' && { DocumentSubType: 'GA' }), DocDueDate: dueDate(data.DocDate), ...data });
    } catch (error) {
      error.message = `${url} #${counts[url]} (${data.DocDate}): ${error.response?.data?.error?.message?.value || error.message}`;
      throw error;
    }
  };
  const dueDate = (date) => {
    const due = new Date(`${date}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 30);
    return due.toISOString().slice(0, 10);
  };
  const line = (ItemCode, Quantity, UnitPrice, TaxCode, extra = {}) => ({ ItemCode, Quantity, UnitPrice, TaxCode, ...extra });
  // A row copied from a base document row (SAP copy-from), optionally a part quantity.
  const copy = (BaseType, base, index, Quantity, extra = {}) => {
    const source = base.DocumentLines[index];
    return { ItemCode: source.ItemCode, Quantity: Quantity ?? source.RemainingOpenQuantity, UnitPrice: source.UnitPrice,
      TaxCode: source.TaxCode, WarehouseCode: source.WarehouseCode, BaseType, BaseEntry: base.DocEntry, BaseLine: source.LineNum, ...extra };
  };
  const copyAll = (BaseType, base) => base.DocumentLines.map((_, i) => copy(BaseType, base, i));

  // ---- chart of accounts and account determination ----
  await setup.action('account-template', 'apply');
  for (const [Code, Name, FatherAccountKey] of [
    ['101000', 'HDFC Bank Current Account', 'ASSETS'], ['130000', 'Input GST Receivable', 'ASSETS'],
    ['410000', 'Freight Income', 'REVENUE'], ['520000', 'Freight Expense', 'EXPENSES'],
    ['530000', 'Purchase Price Difference', 'EXPENSES'], ['540000', 'Rounding Off', 'EXPENSES'],
  ]) await post('/ChartOfAccounts', { Code, Name, FatherAccountKey });
  const fiscal = (await sql('SELECT "AbsEntry" FROM "OACP" LIMIT 1')).rows[0].AbsEntry;
  await setup.save('gl-determination', fiscal, { LinkAct_3: '101000', RoundAcct: '540000' });
  await sql(`INSERT INTO "OEXD" ("ExpnsName", "RevAcct", "ExpnsAcct") VALUES ('Freight', '410000', '520000'), ('Packing & Forwarding', '410000', '520000')`);

  // ---- general setup ----
  for (const [Code, Name] of [['GJ', 'Gujarat'], ['MH', 'Maharashtra'], ['KA', 'Karnataka'], ['DL', 'Delhi'], ['TN', 'Tamil Nadu']]) {
    await setup.save('states', null, { Country: 'IN', Code, Name });
  }
  await setup.save('locations', null, { Location: 'Ahmedabad' });
  await setup.save('locations', null, { Location: 'Mumbai' });
  await setup.save('currencies', null, { CurrCode: 'USD', CurrName: 'US Dollar', DocCurrCod: 'USD' });
  await setup.save('currencies', null, { CurrCode: 'EUR', CurrName: 'Euro', DocCurrCod: 'EUR' });
  await setup.save('exchange-rates', null, { Currency: 'USD', RateDate: '2026-10-12', Rate: 83.45 });
  await setup.save('exchange-rates', null, { Currency: 'EUR', RateDate: '2026-10-12', Rate: 90.8 });
  const slp = {};
  for (const [name, commission] of [['Amit Shah', 2], ['Priya Mehta', 2.5], ['Rahul Verma', 1.5]]) {
    await setup.save('sales-employees', null, { SlpName: name, Active: 'Y', Commission: commission, Memo: 'Sales team' });
    slp[name] = (await sql('SELECT "SlpCode" FROM "OSLP" WHERE "SlpName" = $1', [name])).rows[0].SlpCode;
  }
  await setup.save('bp-groups', null, { GroupName: 'Distributors', GroupType: 'C' });
  await setup.save('bp-groups', null, { GroupName: 'Domestic Suppliers', GroupType: 'S' });
  await setup.save('cash-discounts', null, { Code: 'EARLY', TableDesc: '2% in 10 days', BaseDate: 'P', CashDiscountLines: [{ NumOfDays: 10, Discount: 2 }] });
  await setup.save('payment-methods', null, { PayMethCod: 'NEFT', Descript: 'NEFT / RTGS', Type: 'I', BankTransf: 'T', Active: 'Y', GLAccount: '101000' });
  await setup.save('payment-methods', null, { PayMethCod: 'CHQ', Descript: 'Cheque', Type: 'O', BankTransf: 'C', Active: 'Y', GLAccount: '101000' });
  const terms = {};
  for (const [name, days] of [['Net 30', 30], ['Net 45', 45]]) {
    terms[name] = (await post('/PaymentTermsTypes', { PaymentTermsGroupName: name, BaselineDate: 'bld_PostingDate', NumberOfAdditionalDays: days })).GroupNumber;
  }
  const groups = {};
  for (const [name, accounts] of [['Electronics', {}], ['Accessories', {}], ['Stationery', {}], ['Services', { RevenuesAc: '400000' }]]) {
    await setup.save('item-groups', null, { ItmsGrpNam: name, Locked: 'N', ...accounts });
    groups[name] = (await sql('SELECT "ItmsGrpCod" FROM "OITB" WHERE "ItmsGrpNam" = $1', [name])).rows[0].ItmsGrpCod;
  }
  const warehouseAccounts = { StockAccount: '120000', CostOfGoodsSold: '500000', RevenuesAccount: '400000', ExpenseAccount: '510000',
    TransfersAcc: '220000', PriceDifferencesAccount: '530000' };
  await sap.request({ method: 'PATCH', url: "/Warehouses('01')", data: { WarehouseName: 'Ahmedabad Main Warehouse', ...warehouseAccounts } });
  await post('/Warehouses', { WarehouseCode: '02', WarehouseName: 'Mumbai Depot', City: 'Mumbai', State: 'MH', Country: 'IN', ...warehouseAccounts });

  // ---- GST: components and codes (intra-state CGST+SGST, inter-state IGST) ----
  for (const rate of [5, 12, 18]) {
    const half = rate / 2;
    for (const [code, type, componentRate] of [[`CGST${half}`, -100, half], [`SGST${half}`, -110, half], [`IGST${rate}`, -120, rate]]) {
      await post('/SalesTaxAuthorities', { Code: code, Name: `${code.replace(/\d.*/, '')} ${componentRate}%`, Type: type, Rate: componentRate,
        SalesTaxAccount: '210000', PurchaseTaxAccount: '130000' });
    }
    await post('/SalesTaxCodes', { Code: `GST${rate}`, Name: `GST ${rate}% (CGST+SGST)`, SalesTaxCodes_Lines: [{ STACode: `CGST${half}` }, { STACode: `SGST${half}` }] });
    await post('/SalesTaxCodes', { Code: `IGST${rate}`, Name: `IGST ${rate}%`, SalesTaxCodes_Lines: [{ STACode: `IGST${rate}` }] });
  }

  // ---- HSN / SAC ----
  const hsn = {};
  for (const [code, text] of [['84713010', 'Portable computers'], ['85285200', 'Monitors'], ['84716060', 'Keyboards and mice'],
    ['85176290', 'Network routers'], ['85444999', 'Electric cables'], ['48025690', 'Copier paper'], ['42021290', 'Bags and cases'], ['84439959', 'Printer parts']]) {
    hsn[code] = (await post('/ChapterIDs', { ChapterID: code, Description: text })).AbsEntry;
  }
  await post('/SACCodes', { ServiceCode: '998713', ServiceName: 'Maintenance and repair of computers' });

  // ---- business partners ----
  const partner = (CardCode, CardName, type, city, State, gstin, extra = {}) => post('/BusinessPartners', {
    CardCode, CardName, CardType: type, Currency: 'INR', Valid: 'tYES', Frozen: 'tNO', CompanyPrivate: 'cCompany',
    PayTermsGrpCode: terms[type === 'cCustomer' ? 'Net 30' : 'Net 45'], FederalTaxID: gstin || undefined,
    Phone1: '079-4000' + CardCode.slice(-2), EmailAddress: `accounts@${CardName.toLowerCase().replace(/[^a-z]/g, '')}.in`,
    BPAddresses: [
      { AddressName: 'Bill To', AddressType: 'bo_BillTo', Street: 'Main Road', City: city, State, Country: 'IN', ZipCode: '380001',
        ...(gstin && { GSTIN: gstin, GstType: 'gstRegularTDSISD' }) },
      { AddressName: 'Ship To', AddressType: 'bo_ShipTo', Street: 'Godown Lane', City: city, State, Country: 'IN', ZipCode: '380001' },
    ],
    ContactEmployees: [{ Name: 'Accounts Desk', Phone1: '98250' + CardCode.slice(-5), E_Mail: 'desk@example.in' }],
    ...extra,
  });
  await partner('C00001', 'Shree Ganesh Traders', 'cCustomer', 'Ahmedabad', 'GJ', '24AABCS1234F1Z5', { SalesPersonCode: slp['Amit Shah'], CreditLimit: 500000 });
  await partner('C00002', 'Patel Electronics', 'cCustomer', 'Surat', 'GJ', '24AAFPP5678K1Z2', { SalesPersonCode: slp['Amit Shah'], CreditLimit: 300000 });
  await partner('C00003', 'Mumbai Digital Hub', 'cCustomer', 'Mumbai', 'MH', '27AACCM4321L1Z9', { SalesPersonCode: slp['Priya Mehta'], CreditLimit: 800000 });
  await partner('C00004', 'Bangalore Tech Retail', 'cCustomer', 'Bengaluru', 'KA', '29AAGCB8765M1Z3', { SalesPersonCode: slp['Rahul Verma'] });
  await partner('C00005', 'Delhi Office Supplies', 'cCustomer', 'New Delhi', 'DL', '07AAHCD2468N1Z1', { SalesPersonCode: slp['Rahul Verma'] });
  await partner('C00006', 'Walk-in Customer', 'cCustomer', 'Ahmedabad', 'GJ', null);
  await partner('V00001', 'Infotech Distributors Pvt Ltd', 'cSupplier', 'Ahmedabad', 'GJ', '24AAICI1357P1Z6');
  await partner('V00002', 'Global Components Ltd', 'cSupplier', 'Mumbai', 'MH', '27AABCG9753Q1Z4');
  await partner('V00003', 'Chennai Peripherals', 'cSupplier', 'Chennai', 'TN', '33AADCC1122R1Z8');
  await partner('V00004', 'Paper & Print Supplies', 'cSupplier', 'Ahmedabad', 'GJ', '24AAEFP3344S1Z7');

  // ---- items ----
  const item = (ItemCode, ItemName, group, price, taxCode, chapter, extra = {}) => post('/Items', {
    ItemCode, ItemName, InventoryItem: 'tYES', SalesItem: 'tYES', PurchaseItem: 'tYES', ItemType: 'itItems', ItemClass: 'itcMaterial',
    ItemsGroupCode: groups[group], VatLiable: 'tYES', ArTaxCode: taxCode, ApTaxCode: taxCode, GSTRelevnt: 'tYES', GSTTaxCategory: 'gtc_Regular',
    ChapterID: chapter && hsn[chapter], Valid: 'tYES', SalesUnit: 'Nos', PurchaseUnit: 'Nos', DefaultWarehouse: '01',
    CostAccountingMethod: 'bis_MovingAverage', GLMethod: 'glm_WH', MinInventory: 5, MaxInventory: 500,
    ItemPrices: [{ PriceList: 1, Price: price, Currency: 'INR', Factor: 1 }], ...extra,
  });
  await item('ITM001', 'Laptop 14" Core i5 16GB/512GB', 'Electronics', 58000, 'GST18', '84713010', { Mainsupplier: 'V00001' });
  await item('ITM002', 'Laptop 15.6" Core i7 32GB/1TB', 'Electronics', 79000, 'GST18', '84713010', { Mainsupplier: 'V00002' });
  await item('ITM003', '27" IPS LED Monitor', 'Electronics', 17500, 'GST18', '85285200', { Mainsupplier: 'V00001' });
  await item('ITM004', 'Wireless Keyboard & Mouse Combo', 'Accessories', 2300, 'GST18', '84716060');
  await item('ITM005', 'Wi-Fi Router AC1200', 'Electronics', 3900, 'GST18', '85176290', { Mainsupplier: 'V00002' });
  await item('ITM006', 'HDMI Cable 2m', 'Accessories', 450, 'GST18', '85444999');
  await item('ITM007', 'A4 Copier Paper 75 GSM (Ream)', 'Stationery', 290, 'GST12', '48025690', { Mainsupplier: 'V00004' });
  await item('ITM008', 'Laptop Backpack 15.6"', 'Accessories', 1500, 'GST18', '42021290', { Mainsupplier: 'V00003' });
  await item('ITM009', 'Laser Toner Cartridge', 'Accessories', 3100, 'GST18', '84439959', { Mainsupplier: 'V00003' });
  await item('SRV001', 'Annual Maintenance Contract (per device)', 'Services', 2500, 'GST18', null,
    { InventoryItem: 'tNO', PurchaseItem: 'tNO', ItemClass: 'itcService' });

  // ---- purchasing: request -> quotation -> order -> GRPO -> A/P invoice -> credit memo ----
  const request = await document('/PurchaseRequests', { DocDate: '2026-04-20', Comments: 'Stock for Q1 sales plan',
    DocumentLines: [line('ITM005', 40, 2300, 'IGST18'), line('ITM006', 200, 180, 'IGST18')] });
  const vendorQuote = await document('/PurchaseQuotations', { CardCode: 'V00002', DocDate: '2026-04-28', DocumentLines: copyAll(1470000113, request) });
  const po1 = await document('/PurchaseOrders', { CardCode: 'V00001', DocDate: '2026-05-05',
    DocumentLines: [line('ITM001', 20, 45000, 'GST18'), line('ITM003', 15, 11500, 'GST18'), line('ITM004', 50, 1200, 'GST18')] });
  const po2 = await document('/PurchaseOrders', { CardCode: 'V00002', DocDate: '2026-05-12',
    DocumentLines: [line('ITM002', 10, 61000, 'IGST18'), ...copyAll(540000006, vendorQuote)] });
  const po3 = await document('/PurchaseOrders', { CardCode: 'V00003', DocDate: '2026-06-02',
    DocumentLines: [line('ITM008', 60, 700, 'IGST18'), line('ITM009', 30, 1600, 'IGST18')] });
  const po4 = await document('/PurchaseOrders', { CardCode: 'V00004', DocDate: '2026-06-10', DocumentLines: [line('ITM007', 500, 210, 'GST12')] });
  await document('/PurchaseOrders', { CardCode: 'V00001', DocDate: '2026-10-08', Comments: 'Festive season restock (open)',
    DocumentLines: [line('ITM001', 10, 45500, 'GST18'), line('ITM003', 10, 11600, 'GST18')] });

  const grpo1 = await document('/PurchaseDeliveryNotes', { CardCode: 'V00001', DocDate: '2026-05-15', NumAtCard: 'INF/DC/1021', DocumentLines: copyAll(22, po1) });
  const grpo2 = await document('/PurchaseDeliveryNotes', { CardCode: 'V00002', DocDate: '2026-05-20', NumAtCard: 'GCL/DC/554',
    DocumentLines: [copy(22, po2, 0), copy(22, po2, 1, 30), copy(22, po2, 2)] });
  const grpo3 = await document('/PurchaseDeliveryNotes', { CardCode: 'V00003', DocDate: '2026-06-12', DocumentLines: copyAll(22, po3) });
  await document('/PurchaseDeliveryNotes', { CardCode: 'V00004', DocDate: '2026-06-15', Comments: 'Not yet invoiced', DocumentLines: [copy(22, po4, 0, 400)] });
  await document('/PurchaseDeliveryNotes', { CardCode: 'V00002', DocDate: '2026-07-01', Comments: 'Direct receipt into Mumbai depot',
    DocumentLines: [line('ITM001', 6, 45200, 'IGST18', { WarehouseCode: '02' }), line('ITM006', 100, 175, 'IGST18', { WarehouseCode: '02' })] });

  await document('/PurchaseInvoices', { CardCode: 'V00001', DocDate: '2026-05-20', NumAtCard: 'INF/INV/2201', DocumentLines: copyAll(20, grpo1),
    DocumentAdditionalExpenses: [{ ExpenseCode: 1, LineTotal: 2500, TaxCode: 'GST18' }] });
  await document('/PurchaseInvoices', { CardCode: 'V00002', DocDate: '2026-05-25', NumAtCard: 'GCL/INV/889',
    DocumentLines: [copy(20, grpo2, 0, undefined, { UnitPrice: 60500 }), copy(20, grpo2, 1), copy(20, grpo2, 2)] });
  const apInvoice3 = await document('/PurchaseInvoices', { CardCode: 'V00003', DocDate: '2026-06-14', NumAtCard: 'CP/2026/341', DocumentLines: copyAll(20, grpo3) });
  await document('/PurchaseCreditNotes', { CardCode: 'V00003', DocDate: '2026-06-20', Comments: 'Damaged toner returned', DocumentLines: [copy(18, apInvoice3, 1, 2)] });

  // ---- sales: quotation -> order -> delivery -> invoice -> credit memo ----
  const q1 = await document('/Quotations', { CardCode: 'C00001', DocDate: '2026-06-20', SalesPersonCode: slp['Amit Shah'],
    DocumentLines: [line('ITM001', 5, 58000, 'GST18'), line('ITM004', 10, 2300, 'GST18')] });
  const q2 = await document('/Quotations', { CardCode: 'C00003', DocDate: '2026-06-22', SalesPersonCode: slp['Priya Mehta'],
    DocumentLines: [line('ITM002', 3, 79000, 'IGST18'), line('ITM005', 10, 3900, 'IGST18')] });
  await document('/Quotations', { CardCode: 'C00004', DocDate: '2026-09-25', SalesPersonCode: slp['Rahul Verma'], Comments: 'Awaiting customer approval',
    DocumentLines: [line('ITM003', 6, 17500, 'IGST18')] });
  await document('/Quotations', { CardCode: 'C00005', DocDate: '2026-10-06', SalesPersonCode: slp['Rahul Verma'],
    DocumentLines: [line('ITM007', 100, 290, 'IGST12'), line('ITM009', 5, 3100, 'IGST18')] });

  const so1 = await document('/Orders', { CardCode: 'C00001', DocDate: '2026-06-25', SalesPersonCode: slp['Amit Shah'], NumAtCard: 'SGT/PO/77', DocumentLines: copyAll(23, q1) });
  const so2 = await document('/Orders', { CardCode: 'C00003', DocDate: '2026-07-02', SalesPersonCode: slp['Priya Mehta'], NumAtCard: 'MDH/PO/1209', DocumentLines: [copy(23, q2, 0)] });
  const so3 = await document('/Orders', { CardCode: 'C00002', DocDate: '2026-07-10', SalesPersonCode: slp['Amit Shah'],
    DocumentLines: [line('ITM005', 15, 3900, 'GST18'), line('ITM006', 50, 450, 'GST18'), line('ITM008', 20, 1500, 'GST18')] });
  const so4 = await document('/Orders', { CardCode: 'C00004', DocDate: '2026-08-05', SalesPersonCode: slp['Rahul Verma'], DiscountPercent: 2,
    DocumentLines: [line('ITM001', 4, 57500, 'IGST18'), line('ITM003', 4, 17000, 'IGST18')] });
  await document('/Orders', { CardCode: 'C00001', DocDate: '2026-10-05', SalesPersonCode: slp['Amit Shah'], Comments: 'Open order (committed stock)',
    DocumentLines: [line('ITM009', 10, 3100, 'GST18'), line('ITM007', 50, 290, 'GST12')] });
  await document('/Orders', { CardCode: 'C00003', DocDate: '2026-10-09', SalesPersonCode: slp['Priya Mehta'],
    DocumentLines: [line('ITM001', 2, 58000, 'IGST18', { WarehouseCode: '02' }), line('ITM006', 40, 450, 'IGST18', { WarehouseCode: '02' })] });

  const d1 = await document('/DeliveryNotes', { CardCode: 'C00001', DocDate: '2026-06-28', DocumentLines: copyAll(17, so1) });
  const d2 = await document('/DeliveryNotes', { CardCode: 'C00003', DocDate: '2026-07-05', DocumentLines: copyAll(17, so2) });
  const d3 = await document('/DeliveryNotes', { CardCode: 'C00002', DocDate: '2026-07-15', Comments: 'Router balance to follow',
    DocumentLines: [copy(17, so3, 0, 10), copy(17, so3, 1), copy(17, so3, 2)] });
  const d4 = await document('/DeliveryNotes', { CardCode: 'C00004', DocDate: '2026-08-10', DiscountPercent: 2, DocumentLines: copyAll(17, so4) });

  await document('/Invoices', { CardCode: 'C00001', DocDate: '2026-06-30', SalesPersonCode: slp['Amit Shah'], DocumentLines: copyAll(15, d1) });
  await document('/Invoices', { CardCode: 'C00003', DocDate: '2026-07-06', SalesPersonCode: slp['Priya Mehta'], DocumentLines: copyAll(15, d2),
    DocumentAdditionalExpenses: [{ ExpenseCode: 1, LineTotal: 1500, TaxCode: 'IGST18' }] });
  const inv3 = await document('/Invoices', { CardCode: 'C00002', DocDate: '2026-07-18', SalesPersonCode: slp['Amit Shah'], DocumentLines: copyAll(15, d3) });
  await document('/Invoices', { CardCode: 'C00004', DocDate: '2026-08-12', SalesPersonCode: slp['Rahul Verma'], DiscountPercent: 2, DocumentLines: copyAll(15, d4) });
  await document('/Invoices', { CardCode: 'C00006', DocDate: '2026-09-02', Comments: 'Counter sale',
    DocumentLines: [line('ITM004', 2, 2400, 'GST18'), line('ITM006', 3, 450, 'GST18')] });
  await document('/Invoices', { CardCode: 'C00002', DocDate: '2026-09-15', Comments: 'AMC for 8 laptops', DocumentLines: [line('SRV001', 8, 2500, 'GST18')] });
  await document('/CreditNotes', { CardCode: 'C00002', DocDate: '2026-07-25', Comments: 'Two backpacks returned - wrong colour', DocumentLines: [copy(13, inv3, 2, 2)] });

  return counts;
};

const main = async () => {
  const { values } = parseArgs({ options: {
    schema: { type: 'string', default: 'cmp_demo_trading' }, name: { type: 'string', default: 'Demo Trading' },
    username: { type: 'string', default: 'manager' }, reset: { type: 'boolean', default: false },
  } });
  if (values.reset) await removeCompany(values.schema);
  const exists = (await pgDb.getPool('').query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [values.schema])).rowCount > 0;
  if (exists) throw new Error(`Schema ${values.schema} already exists. Run with --reset to rebuild the demo company.`);
  const user = await authDb.findUserByUsername(values.username);
  if (!user) throw new Error(`User "${values.username}" does not exist.`);

  const company = await seedNewCompany({ name: values.name, schema: values.schema, year: YEAR, username: values.username });
  const sql = (text, params) => pgDb.getPool(values.schema).query(text, params);
  try {
    const counts = await runWithRequestContext({ auth: { userId: user.UserId, companyId: company.companyId }, body: {} }, () => fillCompany(sql));
    const totals = (await sql(`SELECT
      (SELECT count(*) FROM "OCRD")::int AS "BusinessPartners", (SELECT count(*) FROM "OITM")::int AS "Items",
      (SELECT count(*) FROM "OJDT")::int AS "JournalEntries", (SELECT count(*) FROM "OINM")::int AS "StockMovements",
      (SELECT SUM("OnHand" * "AvgPrice") FROM "OITM")::numeric(19,2) AS "StockValue"`)).rows[0];
    console.log(JSON.stringify({ company: values.name, companyId: company.companyId, schema: values.schema, login: values.username, documents: counts, totals }, null, 2));
  } catch (error) {
    console.error(`Demo data failed: ${error.message}`);
    console.error(`Fix the cause and rerun with --reset (removes only ${values.schema}).`);
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pgDb.closeAll());
}

module.exports = { fillCompany };
