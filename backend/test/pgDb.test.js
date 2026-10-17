const test = require('node:test');
const assert = require('node:assert/strict');
const pgDb = require('../db/pgDb');
const env = require('../config/env');

test('translates T-SQL into PostgreSQL', () => {
  const sql = pgDb.translateSql(`
    SELECT TOP 1 USERID FROM OUSR WHERE USER_CODE = @u OR ISNULL(U_NAME, N'') = @u ORDER BY USERID`);
  assert.match(sql, /SELECT "USERID" FROM "OUSR"/);
  assert.match(sql, /COALESCE\("U_NAME", ''\)/);
  assert.match(sql, /LIMIT 1$/);

  // A function right after ON (join condition) stays a function; an index target table is quoted.
  assert.match(pgDb.translateSql('SELECT 1 FROM Menus M JOIN X R ON LOWER(M.MenuPath) = R.P'), /ON LOWER\("M"\."MenuPath"\)/);
  assert.match(pgDb.translateSql('CREATE INDEX IX_A ON MyTable(Col)'), /ON "MyTable"\("Col"\)/);
  assert.match(pgDb.translateSql('INSERT INTO AppFolders (Name) OUTPUT INSERTED.FolderId AS FolderId VALUES (@n)'),
    /VALUES \(@n\) RETURNING "FolderId" AS "FolderId"$/);
  const nested = pgDb.translateSql(`WITH Capped AS (SELECT TOP 2 DocNum FROM ORDR ORDER BY DocNum)
    SELECT TOP (@cap) DocNum FROM Capped ORDER BY DocNum`);
  assert.match(nested, /LIMIT 2\s*\)/);
  assert.match(nested, /LIMIT @cap$/);
  assert.doesNotMatch(nested, /\bTOP\b/);
  assert.match(pgDb.translateSql("SELECT 'SELECT TOP 2' AS Value FROM OADM"), /'SELECT TOP 2'/);

  assert.deepEqual(pgDb.bindParams("SELECT @a, '@a', @b, @a", { a: 1, b: 2 }),
    { sql: "SELECT $1, '@a', $2, $1", values: [1, 2] });
  assert.deepEqual(pgDb.bindParams('WHERE (@b IS NULL OR x = @b) AND @c IS NOT NULL', { b: null, c: 0 }),
    { sql: 'WHERE (TRUE OR x = $1) AND TRUE', values: [null] });
  assert.equal(pgDb.bindParams('WHERE (@b IS NULL OR x = @b)', { b: 5 }).sql, 'WHERE (FALSE OR x = $1)');
});

// Live round trip against DATABASE_URL in a throwaway schema.
test('runs translated SAP-style queries on PostgreSQL', { skip: !env.databaseUrl }, async () => {
  const schema = `test_${process.pid}`;
  const opts = { database: schema };
  const admin = pgDb.getPool('');
  await admin.query(`CREATE SCHEMA "${schema}"`);
  try {
    await admin.query(`CREATE TABLE "${schema}"."ORDR" (
      "DocEntry" SERIAL PRIMARY KEY, "DocNum" INTEGER, "CardCode" VARCHAR(15),
      "DocDate" DATE, "DocTotal" NUMERIC(19,6), "U_NAME" VARCHAR(50), "CreateTS" TIMESTAMP)`);

    const inserted = await pgDb.query(`
      INSERT INTO ORDR (DocNum, CardCode, DocDate, DocTotal, U_NAME, CreateTS)
      OUTPUT INSERTED.DocEntry
      VALUES (@num, @card, @date, @total, N'manager', GETDATE())`,
    { num: 1001, card: 'C001', date: '2026-10-11', total: '1234.50' }, opts);
    assert.equal(inserted.recordset[0].DocEntry, 1);

    const { recordset } = await pgDb.query(`
      SELECT TOP 5 T0.DocEntry, T0.DocNum, ISNULL(T0.CardCode, '') AS CardCode, T0.DocTotal,
        T0.DocDate, T0.U_NAME, CONVERT(VARCHAR(10), T0.DocDate, 23) AS DocDateText,
        DATEDIFF(DAY, T0.DocDate, CAST('2026-10-21' AS DATE)) AS AgeDays,
        DATEPART(YEAR, T0.DocDate) AS DocYear
      FROM ORDR T0
      WHERE T0.CardCode = @card
      ORDER BY T0.DocEntry DESC`, { card: 'C001' }, opts);

    assert.deepEqual({ ...recordset[0], CreateTS: undefined }, {
      DocEntry: 1, DocNum: 1001, CardCode: 'C001', DocTotal: 1234.5,
      DocDate: new Date('2026-10-11T00:00:00.000Z'), U_NAME: 'manager',
      DocDateText: '2026-10-11', AgeDays: 10, DocYear: 2026, CreateTS: undefined,
    });
    assert.equal(recordset.columns.DocTotal.type.name, 'decimal');

    const columns = await pgDb.query(`
      SELECT COLUMN_NAME AS columnName, DATA_TYPE AS dataType
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tableName
      ORDER BY ORDINAL_POSITION`, { tableName: 'ORDR' }, opts);
    assert.deepEqual(columns.recordset.slice(0, 3).map((row) => [row.columnName, row.dataType]),
      [['DocEntry', 'int'], ['DocNum', 'int'], ['CardCode', 'nvarchar']]);

    for (const catalog of ['[INFORMATION_SCHEMA].[COLUMNS]', '"INFORMATION_SCHEMA" . "COLUMNS"']) {
      const quoted = await pgDb.query('SELECT COLUMN_NAME AS columnName FROM ' + catalog +
        ' WHERE TABLE_NAME = @tableName ORDER BY ORDINAL_POSITION', { tableName: 'ORDR' }, opts);
      assert.deepEqual(quoted.recordset.map((row) => row.columnName), columns.recordset.map((row) => row.columnName));
    }
    const tables = await pgDb.query('SELECT TABLE_NAME FROM [INFORMATION_SCHEMA].[TABLES] WHERE TABLE_NAME = @tableName', { tableName: 'ORDR' }, opts);
    assert.deepEqual(tables.recordset, [{ TABLE_NAME: 'ORDR' }]);
    assert.match(pgDb.translateSql("SELECT 'INFORMATION_SCHEMA.COLUMNS' AS label"), /'INFORMATION_SCHEMA\.COLUMNS'/);

    const updated = await pgDb.query('UPDATE ORDR SET DocTotal = DocTotal + 1 WHERE DocEntry = @id', { id: 1 }, opts);
    assert.deepEqual(updated.rowsAffected, [1]);
    const capped = await pgDb.query(`WITH Capped AS (SELECT TOP 2 DocNum FROM ORDR ORDER BY DocNum)
      SELECT TOP (@cap) DocNum,
        SUM(DocNum) OVER (ORDER BY DocNum ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS RunningTotal,
        ISNUMERIC(CAST(DocNum AS NVARCHAR(100))) AS IsNumeric
      FROM Capped ORDER BY DocNum`, { cap: 1 }, opts);
    assert.equal(capped.recordset[0].RunningTotal, 1001);
    assert.equal(capped.recordset[0].IsNumeric, 1);
  } finally {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pgDb.closeAll();
  }
});
