const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const authDb = require('../services/authDbService');
const pgDb = require('../db/pgDb');
const { ensureCompanyMigrated } = require('../db/companyMigrations');

const schemaSql = fs.readFileSync(path.join(__dirname, '../db/company-schema.pg.sql'), 'utf8');
const objectTypes = [
  ['2', 'Business Partners'], ['4', 'Items'], ['23', 'Quotation'], ['17', 'Sales Order'],
  ['15', 'Delivery'], ['13', 'AR Invoice'], ['14', 'AR Credit Memo'], ['22', 'Purchase Order'],
  ['20', 'GRPO'], ['18', 'AP Invoice'], ['19', 'AP Credit Memo'],
  ['1470000113', 'Purchase Request'], ['540000006', 'Purchase Quotation'],
  ['59', 'Goods Receipt'], ['60', 'Goods Issue'], ['67', 'Inventory Transfer'],
  ['1250000001', 'Transfer Request'], ['202', 'Production'], ['24', 'Incoming Payment'],
  ['46', 'Outgoing Payment'], ['30', 'Journal Entry'],
];

const seedNewCompany = async ({ name, schema, year, username = env.setupAdminUsername } = {}) => {
  name = String(name || '').trim();
  schema = String(schema || '').trim();
  username = String(username || '').trim();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const currentYear = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
  year = Number(year ?? currentYear);
  if (!name || name.length > 200) throw new Error('A company name of 1–200 characters is required.');
  if (!/^cmp_[a-z0-9_]+$/.test(schema) || schema.length > 63) throw new Error('Use a lowercase cmp_ company schema of at most 63 characters.');
  if (!Number.isInteger(year) || year < 2000 || year > 9998) throw new Error('Fiscal year must be an integer between 2000 and 9998.');
  if (!username || username.length > 100) throw new Error('A valid administrator username is required.');
  await authDb.ensureSchema();
  const client = await pgDb.getPool('').connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['seed-company:' + schema]);
    const existing = (await client.query('SELECT "CompanyId", "CompanyName", "DbDialect" FROM app."Companies" WHERE "DbName" = $1', [schema])).rows;
    const schemaExists = (await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])).rowCount > 0;
    if (existing.length) {
      if (existing.length !== 1 || existing[0].DbDialect !== 'postgres' || existing[0].CompanyName !== name || !schemaExists) {
        throw new Error('The company schema is already registered with different or incomplete configuration.');
      }
      const companyInfo = (await client.query(`SELECT "CompnyName" FROM "${schema}"."OADM"`)).rows;
      if (companyInfo.length !== 1 || companyInfo[0].CompnyName !== name) throw new Error('The registered company setup is incomplete or has a different name.');
      await client.query('COMMIT');
      return { companyId: existing[0].CompanyId, companyName: name, schema, created: false };
    }
    if (schemaExists) throw new Error('That schema already exists. Choose a fresh schema; existing data will not be overwritten.');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['seed-company:administrator']);
    const existingUser = (await client.query('SELECT "UserId", "IsActive" FROM app."Users" WHERE "Username" = $1', [username])).rows[0];
    if (existingUser && !existingUser.IsActive) throw new Error('The administrator account is inactive.');
    if (!existingUser && !env.setupAdminPassword) throw new Error('Configure SETUP_ADMIN_PASSWORD in backend/.env before creating the administrator.');

    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(schemaSql);
    const insert = (table, columns, values) => client.query(
      `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${values.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`, values,
    );
    await insert('OADM', ['CompnyName'], [name]);
    const indicator = `${year}-${String(year + 1).slice(-2)}`;
    const from = `${year}-04-01`, to = `${year + 1}-03-31`;
    await insert('OFPR', ['Code', 'Name', 'Indicator', 'F_RefDate', 'T_RefDate', 'F_DueDate', 'T_DueDate', 'F_TaxDate', 'T_TaxDate'],
      [indicator, indicator, indicator, from, to, from, to, from, to]);
    await insert('OCRN', ['CurrCode', 'CurrName', 'DocCurrCod'], ['INR', 'Indian Rupee', 'INR']);
    await insert('OCRY', ['Code', 'Name'], ['IN', 'India']);
    const accounts = [
      ['100000', 'Cash', 1, 'Y'], ['110000', 'Accounts Receivable', 1, 'N'],
      ['120000', 'Inventory', 1, 'N'], ['200000', 'Accounts Payable', 2, 'N'],
      ['210000', 'Tax Payable', 2, 'N'], ['220000', 'Goods Received Not Invoiced', 2, 'N'], ['300000', 'Opening Balance Equity', 3, 'N'],
      ['400000', 'Sales Revenue', 4, 'N'], ['500000', 'Cost of Goods Sold', 5, 'N'],
      ['510000', 'Operating Expenses', 5, 'N'],
    ];
    for (const [code, title, group, cash] of accounts) await insert('OACT', ['AcctCode', 'AcctName', 'GroupMask', 'CashBox', 'FormatCode'], [code, title, group, cash, code]);
    await insert('OBPL', ['BPLName'], [name]);
    await insert('OLCT', ['Location'], ['Main']);
    await insert('OWHS', ['WhsCode', 'WhsName', 'BPLid', 'Location', 'BalInvntAc', 'SaleCostAc', 'RevenuesAc', 'ExpensesAc'],
      ['01', 'Main Warehouse', 1, 1, '120000', '500000', '400000', '510000']);
    await insert('OITB', ['ItmsGrpNam'], ['General']);
    await insert('OCRG', ['GroupName', 'GroupType'], ['Customers', 'C']);
    await insert('OCRG', ['GroupName', 'GroupType'], ['Vendors', 'S']);
    await insert('OUOM', ['UomCode', 'UomName'], ['EA', 'Each']);
    await insert('OUGP', ['UgpCode', 'UgpName', 'BaseUom'], ['EA', 'Each', 1]);
    await insert('UGP1', ['UgpEntry', 'LineNum', 'UomEntry'], [1, 0, 1]);
    await insert('OCTG', ['PymntGroup', 'ListNum'], ['Due Immediately', 1]);
    await insert('OPLN', ['ListName'], ['Base Price List']);
    await insert('OSHP', ['TrnspName'], ['Standard']);
    await insert('OSLP', ['SlpName'], ['Unassigned']);
    await insert('OSTC', ['Code', 'Name'], ['ZERO', 'Zero Rate']);
    await insert('OSTA', ['Code', 'Type', 'Name', 'Rate', 'SalesTax', 'PurchTax'], ['ZERO', -100, 'Zero Rate', 0, '210000', '210000']);
    await insert('STC1', ['STCCode', 'LineNum', 'STACode', 'STAType'], ['ZERO', 0, 'ZERO', -100]);
    await insert('OVTG', ['Code', 'Name', 'Category', 'Account'], ['ZERO', 'Zero Rate', 'O', '210000']);
    await insert('OUSR', ['USER_CODE', 'U_NAME', 'SUPERUSER'], [username, 'Local Administrator', 'Y']);
    await insert('USR6', ['UserCode', 'BPLId'], [username, 1]);
    for (const [objectCode, label] of objectTypes) {
      // SAP: invoice/credit-memo series per GST subtype; BP series per BP type (C customers/leads, S vendors).
      const subtypes = ['13','14','18','19'].includes(objectCode) ? ['--', 'GA'] : objectCode === '2' ? ['C', 'S'] : ['--'];
      for (const subtype of subtypes) {
        const bpSeries = { C: ['Customers', 'C'], S: ['Vendors', 'V'] }[objectCode === '2' ? subtype : ''];
        const series = (await insert('NNM1', ['SeriesName', 'ObjectCode', 'Indicator', 'DocSubType', 'BeginStr'],
          [bpSeries ? bpSeries[0] : label, objectCode, indicator, subtype, bpSeries ? bpSeries[1] : ''])).rows[0].Series;
        await insert('ONNM', ['ObjectCode', 'DocSubType', 'DfltSeries', 'DfltSerie'], [objectCode, subtype, series, series]);
      }
    }
    const companyId = (await client.query(`INSERT INTO app."Companies"
      ("CompanyName", "DbDialect", "DbName", "IsActive", "SapUsername")
      VALUES ($1, 'postgres', $2, 1, $3) RETURNING "CompanyId"`, [name, schema, username])).rows[0].CompanyId;
    const userId = existingUser?.UserId || (await client.query(`INSERT INTO app."Users"
      ("Username", "PasswordHash", "FullName") VALUES ($1, $2, 'Local Administrator') RETURNING "UserId"`,
    [username, await bcrypt.hash(env.setupAdminPassword, 12)])).rows[0].UserId;
    let roleId = (await client.query(`SELECT "RoleId" FROM app."Roles" WHERE lower("RoleName") = 'superadmin' ORDER BY "RoleId" LIMIT 1`)).rows[0]?.RoleId;
    if (!roleId) roleId = (await client.query(`INSERT INTO app."Roles" ("RoleName") VALUES ('SuperAdmin') RETURNING "RoleId"`)).rows[0].RoleId;
    await client.query(`INSERT INTO app."UserCompanies" ("UserId", "CompanyId", "IsDefault", "SapUserCode")
      SELECT $1, $2, CASE WHEN EXISTS (SELECT 1 FROM app."UserCompanies" WHERE "UserId" = $1) THEN 0 ELSE 1 END, $3`, [userId, companyId, username]);
    await client.query(`INSERT INTO app."UserRoles" ("UserId", "RoleId", "CompanyId") VALUES ($1, $2, $3)`, [userId, roleId, companyId]);
    await client.query('COMMIT');
    authDb.clearCache();
    // A new company starts on the latest schema, not just the baseline.
    await ensureCompanyMigrated(schema);
    // Posting accounts for the starter chart; these columns come from the migrations.
    await pgDb.getPool(schema).query(`UPDATE "OACP" SET "LinkAct_1" = '110000', "LinkAct_10" = '200000', "DfltIncom" = '400000',
      "DfltExpn" = '510000', "COGM_Act" = '500000', "AlocCstAct" = '220000', "DecreasAc" = '510000', "IncreasAc" = '510000';
      UPDATE "OWHS" SET "TransferAc" = '220000' WHERE "WhsCode" = '01'`);
    return { companyId, companyName: name, schema, username, fiscalPeriod: indicator, created: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

if (require.main === module) {
  const { parseArgs } = require('node:util');
  let options;
  try {
    options = parseArgs({ options: { name: { type: 'string' }, schema: { type: 'string' }, year: { type: 'string' }, username: { type: 'string' } } }).values;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  if (options) seedNewCompany(options).then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => pgDb.closeAll());
}
module.exports = { seedNewCompany };
