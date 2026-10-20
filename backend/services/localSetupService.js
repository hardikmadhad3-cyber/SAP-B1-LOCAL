const db = require('./dbService');
const sap = require('./sapService');
const { ensureCompanyMigrated } = require('../db/companyMigrations');
const { MASTERS, DOCUMENTS, withTransaction } = require('./localServiceLayer');

const SETUPS = {
  'item-groups': { entity: 'ItemGroups', fields: ['ItmsGrpNam','Locked','BalInvntAc','SaleCostAc','RevenuesAc','ExpensesAc','BalanceAcc','TransferAc','DecreasAc','IncreasAc','UgpEntry'] },
  'bp-groups': { entity: 'BusinessPartnerGroups', fields: ['GroupName','GroupType'] },
  'sales-employees': { entity: 'SalesPersons', fields: ['SlpName','Active','Commission','Memo'] },
  currencies: { entity: 'Currencies', fields: ['CurrCode','CurrName','DocCurrCod'] },
  locations: { entity: 'Locations', fields: ['Location'] },
  'cash-discounts': { entity: 'CashDiscounts', fields: ['Code','TableDesc','BaseDate','CashDiscountLines'] },
  'payment-methods': { entity: 'PaymentMethods', fields: ['PayMethCod','Descript','Type','Active','BankTransf','GLAccount'] },
  'gl-determination': { entity: 'GLAccountDetermination', fields: MASTERS.GLAccountDetermination.accounts },
  states: { table: 'OCST', key: 'Code', fields: ['Code','Country','Name'] },
  'numbering-series': { table: 'NNM1', key: 'Series', fields: ['SeriesName','ObjectCode','Indicator','InitialNum','NextNumber','LastNum','Locked','BeginStr','EndStr','BPLId','DocSubType'] },
  'posting-periods': { table: 'OFPR', key: 'AbsEntry', fields: ['Name','PeriodStat','F_DueDate','T_DueDate','F_TaxDate','T_TaxDate'] },
  'exchange-rates': { table: 'ORTT', key: 'Currency', fields: ['Currency','RateDate','Rate'] },
  'account-template': { table: 'OACT', key: 'AcctCode', fields: [] },
  resources: { entity: 'Resources', fields: ['ResCode','ResName','ResType','ResGrpCod','UnitOfMsr','IssueMthd','DfltWH','StdCost','ResAcct','validFor','Remarks'] },
  'resource-groups': { entity: 'ResourceGroups', fields: ['ResGrpNam','ResType'] },
  'route-stages': { entity: 'RouteStages', fields: ['Code','Desc'] },
};
const fail = (message, statusCode = 400) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
const definition = (kind) => {
  const setup = SETUPS[kind];
  if (!setup) fail('Unknown setup page.', 404);
  return { ...MASTERS[setup.entity], ...setup };
};
const inCompany = async (callback) => {
  const config = await db.resolveSqlConnectionConfig();
  if (config.dialect !== 'postgres') fail('These setup pages are for local PostgreSQL companies.', 400);
  await ensureCompanyMigrated(config.database);
  return withTransaction(config.database, callback);
};
const text = (value, label, max = 100) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`Enter ${label} (up to ${max} characters).`);
  return value.trim();
};
const integer = (value, label, min = 1) => {
  if (value === '' || value == null || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > 2147483647) fail(`Enter a valid ${label}.`);
  return Number(value);
};
const isoDate = (value) => value instanceof Date ? value.toISOString().slice(0,10) : String(value).slice(0,10);
const log = (client, kind, payload) => client.query(
  'INSERT INTO "LocalSlLog" ("Entity", "Method", "Payload", "Unmapped") VALUES ($1,$2,$3,$4)',
  [kind, 'SETUP', JSON.stringify(payload), '{}'],
);

const list = (kind) => inCompany(async (client) => {
  const setup = definition(kind);
  const rows = (await client.query(`SELECT * FROM "${setup.table}" ORDER BY "${setup.key}"`)).rows;
  if (kind === 'cash-discounts') {
    const lines = (await client.query('SELECT * FROM "CDC1" ORDER BY "NumOfDays"')).rows;
    rows.forEach((row) => { row.CashDiscountLines = lines.filter((line) => line.CdcCode === row.Code); });
  }
  const accounts = (await client.query('SELECT "AcctCode", "AcctName" FROM "OACT" WHERE "Postable"=\'Y\' AND "FrozenFor"=\'N\' ORDER BY "AcctCode"')).rows;
  const branches = (await client.query('SELECT "BPLId", "BPLName" FROM "OBPL" WHERE "Disabled"=\'N\' ORDER BY "BPLId"')).rows;
  const periods = (await client.query('SELECT DISTINCT "Indicator" FROM "OFPR" ORDER BY "Indicator"')).rows;
  const defaults = (await client.query('SELECT * FROM "ONNM"')).rows;
  const currencies = (await client.query('SELECT * FROM "OCRN" ORDER BY "CurrCode"')).rows;
  const countries = (await client.query('SELECT * FROM "OCRY" ORDER BY "Name"')).rows;
  const uomGroups = (await client.query('SELECT "UgpEntry", "UgpName" FROM "OUGP" ORDER BY "UgpName"')).rows;
  const warehouses = (await client.query('SELECT "WhsCode", "WhsName" FROM "OWHS" ORDER BY "WhsCode"')).rows;
  const resourceGroups = (await client.query('SELECT "ResGrpCod", "ResGrpNam" FROM "ORSB" ORDER BY "ResGrpNam"')).rows;
  return { rows, accounts, branches, periods, defaults, currencies, countries, uomGroups, warehouses, resourceGroups, template: kind === 'account-template' ? ACCOUNT_TEMPLATE : undefined };
});

const save = async (kind, key, source) => {
  const setup = definition(kind);
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('Enter setup values.');
  const data = Object.fromEntries(setup.fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, typeof source[field] === 'string' ? source[field].trim() : source[field]]));
  if (setup.entity) {
    await inCompany(async () => {});
    if (kind === 'gl-determination' && key == null) fail('Create the fiscal year from Posting Periods first.');
    for (const field of setup.accounts || []) if (data[field] === '') data[field] = null;
    if (data.UgpEntry === '') data.UgpEntry = null;
    for (const field of ['ResGrpCod', 'DfltWH']) if (data[field] === '') data[field] = null;
    const literal = key == null ? '' : setup.generatedKey ? integer(key, 'record number') : `'${String(key).replace(/'/g, "''")}'`;
    // The key literal is only used for updates; new numeric keys come from PostgreSQL.
    await sap.request({ method: key == null ? 'POST' : 'PATCH', url: `/${setup.entity}${key == null ? '' : `(${literal})`}`, data, preserveEmptyStrings: true });
    return;
  }
  if (kind === 'exchange-rates') {
    await inCompany(async () => {});
    return sap.request({ method:'POST', url:'/SBOBobService_SetCurrencyRate', data });
  }
  return inCompany(async (client) => {
    if (kind === 'states') {
      const country = text(data.Country, 'country code', 3), code = text(data.Code, 'state code', 3), name = text(data.Name, 'state name');
      if (key != null && key !== `${country}:${code}`) fail('The country and state code cannot change.');
      if (key == null) await client.query('INSERT INTO "OCST" ("Country","Code","Name") VALUES ($1,$2,$3)', [country,code,name]);
      else if (!(await client.query('UPDATE "OCST" SET "Name"=$3 WHERE "Country"=$1 AND "Code"=$2', [country,code,name])).rowCount) fail('State not found.',404);
    } else if (kind === 'numbering-series') {
      await saveSeries(client, key, data);
    } else if (kind === 'posting-periods') {
      if (data.PeriodStat != null && !['N','Y'].includes(data.PeriodStat)) fail('Choose Unlocked or Locked.');
      if (data.Name != null) data.Name = text(data.Name,'period name',20);
      for (const field of ['F_DueDate','T_DueDate','F_TaxDate','T_TaxDate']) {
        if (data[field] != null && !/^\d{4}-\d{2}-\d{2}$/.test(data[field])) fail('Enter dates as YYYY-MM-DD.');
      }
      const fields = Object.keys(data);
      if (!fields.length) fail('Enter posting period settings.');
      if (!(await client.query(`UPDATE "OFPR" SET ${fields.map((field,i)=>`"${field}"=$${i+2}`).join(',')} WHERE "AbsEntry"=$1`,
        [integer(key,'period number'),...fields.map((field)=>data[field])])).rowCount) fail('Posting period not found.',404);
    } else fail('Use the action on this setup page.');
    await log(client, kind, data);
  });
};

const saveSeries = async (client, key, data) => {
  await client.query('LOCK TABLE "NNM1" IN SHARE ROW EXCLUSIVE MODE');
  const existing = key == null ? null : (await client.query('SELECT * FROM "NNM1" WHERE "Series"=$1 FOR UPDATE', [integer(key,'series number')])).rows[0];
  if (key != null && !existing) fail('Numbering series not found.',404);
  const row = { InitialNum: 1, NextNumber: 1, LastNum: 999999999, DocSubType: '--', Locked:'N', BeginStr:'', EndStr:'', ...existing, ...data };
  row.SeriesName = text(row.SeriesName,'series name',30);
  row.ObjectCode = text(row.ObjectCode,'object code',20);
  const known = new Set([...Object.values(DOCUMENTS).map((d) => d.objType),'2','4','24','46','30','59','60','67','1250000001','202']);
  if (!known.has(row.ObjectCode)) fail('Select a supported document or master object.');
  const subtypes = row.ObjectCode === '2' ? ['C','S'] : ['13','14','18','19'].includes(row.ObjectCode) ? ['--','GA'] : ['--'];
  if (!subtypes.includes(row.DocSubType)) fail('The subtype does not belong to this object.');
  if (!(await client.query('SELECT 1 FROM "OFPR" WHERE "Indicator"=$1', [row.Indicator])).rowCount) fail('Select an existing fiscal period indicator.');
  for (const field of ['InitialNum','NextNumber','LastNum']) row[field] = integer(row[field],field);
  if (row.InitialNum > row.NextNumber || row.LastNum < row.NextNumber - (existing ? 1 : 0)) fail('The next number must be within the series range.');
  if (!['N','Y'].includes(row.Locked)) fail('Invalid series lock status.');
  if (String(row.BeginStr).length > 8 || String(row.EndStr).length > 8) fail('Series prefix and suffix may have at most 8 characters.');
  row.BPLId = row.BPLId === '' || row.BPLId == null ? null : integer(row.BPLId,'branch');
  if (row.BPLId && !(await client.query('SELECT 1 FROM "OBPL" WHERE "BPLId"=$1 AND "Disabled"=\'N\'', [row.BPLId])).rowCount) fail('Select an active branch.');
  if (existing) {
    if (row.NextNumber < existing.NextNumber) fail('The next number cannot move backwards.');
    for (const field of ['ObjectCode','DocSubType','Indicator','InitialNum','BeginStr','EndStr','BPLId']) {
      if (String(row[field] ?? '') !== String(existing[field] ?? '')) fail(`${field} cannot change on an existing series. Create another series.`);
    }
  }
  const overlap = await client.query(`SELECT 1 FROM "NNM1" WHERE "ObjectCode"=$1 AND "DocSubType"=$2 AND "Indicator"=$3
    AND "BPLId" IS NOT DISTINCT FROM $4 AND "Series"<>$5 AND "InitialNum"<=$7 AND COALESCE("LastNum",2147483647)>=$6 LIMIT 1`,
  [row.ObjectCode,row.DocSubType,row.Indicator,row.BPLId,existing?.Series || -1,row.InitialNum,row.LastNum]);
  // Existing seed ranges may be broad; renaming/locking an unchanged range remains possible.
  if (overlap.rowCount && (!existing || row.LastNum !== existing.LastNum)) fail('This range overlaps another series for the same object, subtype, branch and fiscal period.');
  const fields = SETUPS['numbering-series'].fields;
  if (existing) await client.query(`UPDATE "NNM1" SET ${fields.map((field,i) => `"${field}"=$${i+2}`).join(',')} WHERE "Series"=$1`, [existing.Series,...fields.map((field)=>row[field])]);
  else await client.query(`INSERT INTO "NNM1" (${fields.map((field)=>`"${field}"`).join(',')}) VALUES (${fields.map((_,i)=>`$${i+1}`).join(',')})`, fields.map((field)=>row[field]));
};

const months = (start) => {
  if (!/^\d{4}-\d{2}-01$/.test(start) || Number(start.slice(5,7)) < 1 || Number(start.slice(5,7)) > 12 || Number(start.slice(0,4)) < 1900) fail('Choose the first day of the financial year.');
  const date = new Date(`${start}T00:00:00Z`);
  return Array.from({length:12}, (_,i) => ({ from: new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+i,1)).toISOString().slice(0,10),
    to: new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+i+1,0)).toISOString().slice(0,10) }));
};

const action = (kind, name, data = {}) => inCompany(async (client) => {
  definition(kind);
  if (kind === 'numbering-series' && name === 'set-default') {
    const row = (await client.query('SELECT * FROM "NNM1" WHERE "Series"=$1 FOR UPDATE',[integer(data.Series,'series number')])).rows[0];
    if (!row || row.Locked === 'Y' || (row.LastNum != null && row.NextNumber > row.LastNum)) fail('Select an unlocked series with numbers remaining.');
    await client.query(`INSERT INTO "ONNM" ("ObjectCode","DocSubType","DfltSeries","DfltSerie") VALUES ($1,$2,$3,$3)
      ON CONFLICT ("ObjectCode","DocSubType") DO UPDATE SET "DfltSeries"=$3,"DfltSerie"=$3`, [row.ObjectCode,row.DocSubType,row.Series]);
  } else if (kind === 'posting-periods' && ['create-months','split-period'].includes(name)) {
    await client.query('LOCK TABLE "OFPR" IN SHARE ROW EXCLUSIVE MODE');
    const existing = name === 'split-period' ? (await client.query('SELECT * FROM "OFPR" WHERE "AbsEntry"=$1 FOR UPDATE',[integer(data.AbsEntry,'period number')])).rows[0] : null;
    if (name === 'split-period' && !existing) fail('Posting period not found.',404);
    const periods = months(existing ? isoDate(existing.F_RefDate) : data.StartDate);
    const indicator = existing?.Indicator || text(data.Indicator,'fiscal indicator',10);
    if (existing) {
      if (existing.PeriodStat !== 'N' || isoDate(existing.T_RefDate) !== periods[11].to) fail('Only an unlocked annual period can be split into months.');
      const tables = [...new Set([...Object.values(DOCUMENTS).map((d)=>d.header),'OJDT'])];
      for (const table of tables) {
        const column = table === 'OJDT' ? 'RefDate' : 'DocDate';
        if ((await client.query(`SELECT 1 FROM "${table}" WHERE "${column}" BETWEEN $1 AND $2 LIMIT 1`, [periods[0].from,periods[11].to])).rowCount) fail('This year already contains documents. Create monthly periods for a new year instead.');
      }
    }
    if ((await client.query('SELECT 1 FROM "OFPR" WHERE "AbsEntry"<>$1 AND "F_RefDate"<=$3 AND "T_RefDate">=$2 LIMIT 1', [existing?.AbsEntry || -1,periods[0].from,periods[11].to])).rowCount) fail('The financial year overlaps existing posting periods.');
    if (!existing && (await client.query('SELECT 1 FROM "OACP" WHERE "PeriodCat"=$1',[indicator])).rowCount) fail('Use a new fiscal indicator for the new financial year.');
    await client.query(`INSERT INTO "OACP" ("PeriodCat","PeriodName","FinancYear","Year","SubType","PeriodNum") VALUES ($1,$1,$2,$3,'M',12)
      ON CONFLICT ("PeriodCat") DO UPDATE SET "SubType"='M',"PeriodNum"=12`, [indicator,periods[0].from,Number(periods[0].from.slice(0,4))]);
    for (const [index, period] of periods.entries()) {
      const code = `${indicator}-${String(index+1).padStart(2,'0')}`;
      const values = [code,indicator,period.from,period.to,existing ? isoDate(existing.F_DueDate) : periods[0].from,existing ? isoDate(existing.T_DueDate) : periods[11].to,
        existing ? isoDate(existing.F_TaxDate) : periods[0].from,existing ? isoDate(existing.T_TaxDate) : periods[11].to];
      if (existing && index === 0) await client.query('UPDATE "OFPR" SET "Code"=$1,"Name"=$1,"F_RefDate"=$3,"T_RefDate"=$4,"Category"=$2 WHERE "AbsEntry"=$5',[...values.slice(0,4),existing.AbsEntry]);
      else await client.query(`INSERT INTO "OFPR" ("Code","Name","Indicator","Category","F_RefDate","T_RefDate","F_DueDate","T_DueDate","F_TaxDate","T_TaxDate") VALUES ($1,$1,$2::text,$2::text,$3,$4,$5,$6,$7,$8)`,values);
    }
  } else if (kind === 'account-template' && name === 'apply') {
    await client.query('LOCK TABLE "OACT" IN SHARE ROW EXCLUSIVE MODE');
    const currency = (await client.query('SELECT "MainCurncy" FROM "OADM" LIMIT 1')).rows[0].MainCurncy;
    for (const account of ACCOUNT_TEMPLATE) {
      const current = (await client.query('SELECT * FROM "OACT" WHERE "AcctCode"=$1',[account.AcctCode])).rows[0];
      if (current && (current.GroupMask !== account.GroupMask || current.Postable !== account.Postable || current.AcctName !== account.AcctName || (current.FatherNum && current.FatherNum !== account.FatherNum))) {
        fail(`Account ${account.AcctCode} differs from the template. No accounts were changed.`);
      }
      if (!current) await client.query(`INSERT INTO "OACT" ("AcctCode","AcctName","GroupMask","Postable","FatherNum","Levels","ActCurr","FormatCode","ActType","ActiveAccount") VALUES ($1,$2,$3,$4,$5,$6,$7,$1,$8,$4)`,
        [account.AcctCode,account.AcctName,account.GroupMask,account.Postable,account.FatherNum,account.FatherNum ? 2 : 1,currency,account.GroupMask === 4 ? 'I' : account.GroupMask === 5 ? 'E' : 'N']);
      else if (account.FatherNum && !current.FatherNum) await client.query('UPDATE "OACT" SET "FatherNum"=$2,"Levels"=2 WHERE "AcctCode"=$1',[account.AcctCode,account.FatherNum]);
    }
  } else fail('Unknown setup action.',404);
  await log(client,kind,{ action:name,...data });
});

const ACCOUNT_TEMPLATE = [
  ['ASSETS','Assets',1,null],['LIABILITIES','Liabilities',2,null],['EQUITY','Equity',3,null],['REVENUE','Revenue',4,null],['EXPENSES','Expenses',5,null],
  ['100000','Cash',1,'ASSETS'],['110000','Accounts Receivable',1,'ASSETS'],['120000','Inventory',1,'ASSETS'],
  ['200000','Accounts Payable',2,'LIABILITIES'],['210000','Tax Payable',2,'LIABILITIES'],['220000','Goods Received Not Invoiced',2,'LIABILITIES'],['300000','Opening Balance Equity',3,'EQUITY'],
  ['400000','Sales Revenue',4,'REVENUE'],['500000','Cost of Goods Sold',5,'EXPENSES'],['510000','Operating Expenses',5,'EXPENSES'],
].map(([AcctCode,AcctName,GroupMask,FatherNum]) => ({ AcctCode,AcctName,GroupMask,FatherNum,Postable: FatherNum ? 'Y' : 'N' }));

module.exports = { SETUPS, list, save, action, months };
