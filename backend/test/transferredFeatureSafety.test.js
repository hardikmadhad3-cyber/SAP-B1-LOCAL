const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const sqlSafety = require('../services/sqlSafetyService');
const webhook = require('../controllers/whatsappWebhookController');
const qcDb = require('../services/qcDbService');
const whatsappDb = require('../services/whatsappDbService');
const { runWithRequestContext } = require('../services/requestContextService');

test('Query Manager emits dialect-specific capped SELECT wrappers', () => {
  const sqlServer = sqlSafety.validateAndPrepare('SELECT ItemCode FROM OITM ORDER BY ItemCode', {
    rowLimit: 25,
    dialect: 'sqlserver',
  });
  assert.match(sqlServer.safeSql, /^SELECT TOP \(@safetyRowCap\)/);
  assert.equal(sqlServer.appliedLimit, 25);

  const hana = sqlSafety.validateAndPrepare('SELECT "ItemCode" FROM OITM ORDER BY "ItemCode"', {
    rowLimit: 25,
    dialect: 'hana',
  });
  assert.match(hana.safeSql, /LIMIT @safetyRowCap$/);
  assert.doesNotMatch(hana.safeSql, /\bTOP\b/);
});

test('Query Manager rejects modifying and multi-statement SQL', () => {
  assert.throws(() => sqlSafety.validateAndPrepare('DELETE FROM OITM'), /Only SELECT/);
  assert.throws(() => sqlSafety.validateAndPrepare('SELECT * FROM OITM; DROP TABLE OITM'), /disallowed keyword|single SELECT/);
});

test('WhatsApp webhook requires a valid Meta SHA-256 signature', () => {
  const previousSecret = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = 'test-app-secret';
  try {
    const rawBody = Buffer.from('{"entry":[]}');
    const signature = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
    assert.equal(webhook.hasValidWebhookSignature({ rawBody, get: () => signature }), true);
    assert.equal(webhook.hasValidWebhookSignature({ rawBody, get: () => 'sha256=bad' }), false);
    assert.equal(webhook.hasValidWebhookSignature({ rawBody: Buffer.from('{}'), get: () => signature }), false);
  } finally {
    if (previousSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = previousSecret;
  }
});

test('transferred local schemas initialize cleanly', () => {
  for (const schemaFile of ['qc-schema.sqlite.sql', 'whatsapp-schema.sqlite.sql']) {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(fs.readFileSync(path.join(__dirname, '..', 'db', schemaFile), 'utf8'));
      const count = database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get().count;
      assert.ok(Number(count) > 0, schemaFile + ' should create tables');
    } finally {
      database.close();
    }
  }
});

test('QC and WhatsApp select a separate PostgreSQL schema for each company', async () => {
  const appDb = require('../services/appDbService');
  const original = appDb.forSchema;
  const schemas = [];
  appDb.forSchema = (schema) => {
    schemas.push(schema);
    return { queryRows: async () => [] };
  };
  try {
    for (const companyId of [2, 3]) {
      await runWithRequestContext({ auth: { userId: 1, companyId } }, async () => {
        await qcDb.queryRows('SELECT * FROM qc_parameters');
        await require('../services/whatsappDbService').queryRows('SELECT * FROM whatsapp_customers');
      });
    }
    assert.deepEqual(schemas, ['app_company_2', 'app_company_2', 'app_company_3', 'app_company_3']);
    assert.throws(() => qcDb.queryRows('SELECT 1'), /company session/);
  } finally {
    appDb.forSchema = original;
  }
});

const sapUdfMetadata = require('../services/sapUdfMetadataService');

test('SAP UDF metadata normalization supports HANA and SQL Server column casing', () => {
  assert.equal(sapUdfMetadata.normalizeFieldName({ FieldName: 'DocType' }), 'DocType');
  assert.equal(sapUdfMetadata.normalizeFieldName({ FIELDNAME: 'JWNo' }), 'JWNo');
  assert.equal(sapUdfMetadata.normalizeFieldName({ AliasID: 'JWRNo' }), 'JWRNo');
});

test('Job Work lookup routes do not trigger schema provisioning', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'jobWork.js'), 'utf8');
  assert.match(routeSource, /router\.use\('\/:transactionKey', jobWorkController\.validateTransactionKey\);/);
  assert.match(routeSource, /goods-receipt-series', jobWorkController\.getGoodsReceiptSeries/);
  assert.doesNotMatch(routeSource, /router\.use\('\/:transactionKey'.*ensureSchemaMiddleware/);
  assert.match(routeSource, /\/:transactionKey\/list', jobWorkController\.ensureSchemaMiddleware/);
  assert.match(routeSource, /router\.post\('\/:transactionKey', jobWorkController\.ensureSchemaMiddleware/);
});
