'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runWithRequestContext } = require('../services/requestContextService');
const {
  compileQuery,
  validateQueryText,
  normalizeContext,
  explicitResultAliases,
  serializeLayout,
  useReadOnlyQueryCredentials,
  queryCompanyDatabase,
  deriveRuntimeContext,
  publisherUserId,
} = require('../services/companyFormQueryService');

test('setup administrator layout audit omits the nonpersistent user ID', () => {
  assert.equal(publisherUserId({ tokenType: 'admin', userId: 0, isSetupAdmin: true }), null);
  assert.equal(publisherUserId({ tokenType: 'admin', userId: 7 }), 7);
  assert.equal(publisherUserId({ tokenType: 'admin', userId: 7, isSetupAdmin: true }), null);

  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec(fs.readFileSync(path.resolve(__dirname, '../db/auth-schema.sqlite.sql'), 'utf8'));
    database.prepare("INSERT INTO Companies (CompanyId, CompanyName, DbName) VALUES (4, 'Dewang', 'DC_LiveDB')").run();
    database.prepare(`INSERT INTO CompanyFormQueryLayouts
      (CompanyId, FormKey, QueryText, PublishedByUserId)
      VALUES (4, 'sapb1.salesOrder.formSettings.v2', 'SELECT 1 AS Item_No', @userId)`)
      .run({ userId: publisherUserId({ userId: 0, isSetupAdmin: true }) });
    assert.equal(database.prepare('SELECT PublishedByUserId FROM CompanyFormQueryLayouts').get().PublishedByUserId, null);
  } finally {
    database.close();
  }
});

test('accepts one read-only statement and compiles approved placeholders', () => {
  const sql = validateQueryText(
    'SELECT T0.ItemCode AS [Item Code] FROM QUT1 T0 WHERE T0.DocEntry = {{docEntry}}',
  );
  assert.equal(
    compileQuery(sql),
    'SELECT T0.ItemCode AS [Item Code] FROM QUT1 T0 WHERE T0.DocEntry = @docEntry',
  );
});

test('rejects writes, multiple statements, unknown placeholders, and cross-database references', () => {
  assert.throws(() => validateQueryText('DELETE FROM QUT1'), /Only SELECT|read-only/i);
  assert.throws(() => validateQueryText('SELECT 1; SELECT 2'), /Multiple SQL statements/i);
  assert.throws(() => validateQueryText('SELECT {{password}} AS Secret'), /Unsupported placeholder/i);
  assert.throws(() => validateQueryText('SELECT @docEntry AS DocEntry'), /placeholder.*syntax/i);
  assert.throws(() => validateQueryText('SELECT ItemCode FROM QUT1'), /explicit.*AS alias/i);
  assert.throws(() => validateQueryText('SELECT 1 AS Value, 2 AS [value]'), /Duplicate result column/i);
  assert.throws(() => validateQueryText('SELECT * FROM OtherDb.dbo.QUT1'), /Cross-database/i);
});

test('reads aliases from the final SELECT of a CTE', () => {
  assert.deepEqual(
    explicitResultAliases('WITH Source AS (SELECT ItemCode FROM QUT1) SELECT ItemCode AS [Item Code], 1 AS Qty FROM Source'),
    ['Item Code', 'Qty'],
  );
});

test('published layouts retain physical UDF identity with HANA and SQL Server aliases', () => {
  for (const queryText of [
    'SELECT T0."TaxCode" AS Tax_Code, T0."U_TAXCODE" AS TaxCode, T0."U_PRICE" AS Price FROM "INV1" T0',
    'SELECT T0.[TaxCode] AS [Tax_Code], T0.[U_TAXCODE] AS [TaxCode], T0.[U_PRICE] AS [Price] FROM INV1 T0',
  ]) {
    const layout = serializeLayout({ FormKey: 'service', QueryText: queryText, IsPublished: 1,
      ColumnsJson: JSON.stringify(['Tax_Code', 'TaxCode', 'Price'].map((key) => ({ key, label: key }))) });
    assert.equal(layout.columns[0].fieldName, 'TaxCode');
    assert.equal(layout.columns[1].fieldName, 'U_TAXCODE');
    assert.equal(layout.columns[2].fieldName, 'U_PRICE');
  }
});

test('normalizes runtime values and always takes userId from authentication', () => {
  assert.deepEqual(normalizeContext(
    { userId: 17 },
    { docEntry: '42', cardCode: ' C100 ', postingDate: '2026-09-05T12:00:00Z', branchId: '3', userId: 999 },
  ), {
    docEntry: 42,
    cardCode: 'C100',
    postingDate: '2026-09-05',
    branchId: 3,
    userId: 17,
  });
});

test('requires and applies a dedicated read-only company database credential', () => {
  assert.throws(
    () => useReadOnlyQueryCredentials({ DbUser: 'application-user', DbPassword: 'write-password' }),
    /dedicated SELECT-only database user/i,
  );
  const company = useReadOnlyQueryCredentials({
    CompanyId: 3,
    DbUser: 'application-user',
    DbPassword: 'write-password',
    FormQueryDbUser: 'layout-reader',
    FormQueryDbPassword: 'read-password',
  });
  assert.equal(company.DbUser, 'layout-reader');
  assert.equal(company.DbPassword, 'read-password');
});

test('SQL Content authentication errors identify the database connection without leaking driver details or retrying', async () => {
  for (const DbDialect of ['hana', 'sqlserver']) {
    let calls = 0;
    const database = { query: async () => {
      calls += 1;
      throw new Error('authentication failed password=must-not-leak');
    } };
    await assert.rejects(queryCompanyDatabase(database, { DbDialect }, 'SELECT 1'), (error) => {
      assert.equal(error.statusCode, 422);
      assert.equal(error.code, 'LAYOUT_READ_ONLY_AUTHENTICATION_FAILED');
      assert.match(error.message, DbDialect === 'hana' ? /HANA database username/ : /SQL Server database username/);
      assert.match(error.message, /SQL Content Query Connection/);
      assert.doesNotMatch(error.message, /must-not-leak/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('SQL Content preserves query failures and recognizes SQL Server login error codes', async () => {
  const sqlError = new Error('invalid column name: T0.SACEntry');
  await assert.rejects(queryCompanyDatabase({ query: async () => { throw sqlError; } }, {}, 'SELECT 1'),
    (error) => error === sqlError);
  await assert.rejects(queryCompanyDatabase({ query: () => {
    throw Object.assign(new Error('Connection rejected'), { code: 'ELOGIN' });
  } }, {}, 'SELECT 1'), { code: 'LAYOUT_READ_ONLY_AUTHENTICATION_FAILED' });
});

test('runtime document metadata authentication uses the same actionable error', async () => {
  let calls = 0;
  await assert.rejects(runWithRequestContext({ auth: { userId: 17, companyId: 4 } }, () =>
    deriveRuntimeContext({ userId: 17 }, { DbDialect: 'hana', DbName: 'JKL_LIVEDB' },
      'sapb1.purchaseOrder.formSettings.v1', { docEntry: 42 }, {
        query: async () => { calls += 1; throw new Error('authentication failed'); },
      })), { code: 'LAYOUT_READ_ONLY_AUTHENTICATION_FAILED' });
  assert.equal(calls, 1);
});

test('auth schema includes versioned layouts and dedicated query credentials', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(fs.readFileSync(path.resolve(__dirname, '../db/auth-schema.sqlite.sql'), 'utf8'));
    const companyColumns = database.prepare('PRAGMA table_info(Companies)').all().map((column) => column.name);
    assert.ok(companyColumns.includes('FormQueryDbUser'));
    assert.ok(companyColumns.includes('FormQueryDbPassword'));
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'CompanyFormQueryLayouts'").get().count,
      1,
    );
  } finally {
    database.close();
  }
});

test('derives runtime document context from the company database and ignores browser values', async () => {
  const calls = [];
  const database = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === 1) {
        return { recordset: ['DocEntry', 'CardCode', 'DocDate', 'BPLId'].map((columnName, index) => ({
          columnName, dataType: index === 0 || index === 3 ? 'int' : 'nvarchar', ordinalPosition: index + 1,
        })) };
      }
      return { recordset: [{ DocEntry: 42, CardCode: 'C100', PostingDate: '2026-09-05', BranchId: 3 }] };
    },
  };
  const context = await runWithRequestContext(
    { auth: { userId: 17, companyId: 3 } },
    () => deriveRuntimeContext(
      { userId: 17 },
      { DbDialect: 'sqlserver', DbName: 'TEST_DB' },
      'sapb1.salesOrder.formSettings.v2',
      { docEntry: 42, cardCode: 'ATTACK', postingDate: '1999-01-01', branchId: 999, userId: 999 },
      database,
    ),
  );
  assert.deepEqual(context, {
    docEntry: 42, cardCode: 'C100', postingDate: '2026-09-05', branchId: 3, userId: 17,
  });
  assert.equal(calls[1].params.docEntry, 42);
  assert.match(calls[1].sql, /FROM ORDR T0/);
});

test('derives service document context from the matching SAP header table', async () => {
  const queries = [];
  const database = {
    query: async (sql) => {
      queries.push(sql);
      if (/INFORMATION_SCHEMA\.COLUMNS/i.test(sql)) {
        return { recordset: ['DocEntry', 'CardCode', 'DocDate', 'BPLId'].map((columnName, index) => ({
          columnName, dataType: index === 0 || index === 3 ? 'int' : 'nvarchar', ordinalPosition: index + 1,
        })) };
      }
      return { recordset: [{ DocEntry: 42, CardCode: 'C100', PostingDate: '2026-09-05', BranchId: 3 }] };
    },
  };
  const cases = [
    ['sapb1.serviceArInvoice.formSettings.v7', 'OINV'],
    ['sapb1.serviceArCreditMemo.formSettings.v10', 'ORIN'],
    ['sapb1.serviceApInvoice.formSettings.v10', 'OPCH'],
    ['sapb1.serviceApCreditMemo.formSettings.v10', 'ORPC'],
    ['sapb1.purchaseRequest.formSettings.v1', 'OPRQ'],
    ['sapb1.purchaseQuotation.formSettings.v1', 'OPQT'],
  ];

  for (const [formKey, headerTable] of cases) {
    queries.length = 0;
    const context = await runWithRequestContext(
      { auth: { userId: 17, companyId: 3 } },
      () => deriveRuntimeContext(
        { userId: 17 },
        { DbDialect: 'sqlserver', DbName: 'TEST_DB' },
        formKey,
        { docEntry: 42 },
        database,
      ),
    );
    assert.equal(context.docEntry, 42);
    assert.equal(context.cardCode, 'C100');
    assert.match(queries[1], new RegExp(`FROM ${headerTable} T0`));
  }
});
