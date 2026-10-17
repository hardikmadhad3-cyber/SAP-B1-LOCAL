const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const pgDb = require('../db/pgDb');
const env = require('../config/env');
const appDb = require('../services/appDbService');
const { runWithRequestContext } = require('../services/requestContextService');

test('app data works on PostgreSQL, including login and company isolation', { skip: !env.databaseUrl }, async () => {
  const schema = `test_app_${process.pid}`;
  const addonSchemas = [];
  const database = appDb.forSchema(schema);
  // Exercise the real auth helpers against a disposable application schema.
  require.cache[require.resolve('../services/appDbService')].exports = {
    ...database,
    forSchema: (name) => {
      const isolated = `app_company_${process.pid * 10000 + Number(name.split('_').at(-1))}`;
      if (!addonSchemas.includes(isolated)) addonSchemas.push(isolated);
      return appDb.forSchema(isolated);
    },
  };
  const authDb = require('../services/authDbService');
  const auth = require('../services/authService');
  const qc = require('../services/qcDbService');
  const whatsapp = require('../services/whatsappDbService');
  const webhook = require('../controllers/whatsappWebhookController');
  const qcController = require('../controllers/qcController');
  const whatsappController = require('../controllers/whatsappController');
  try {
    await Promise.all([database.ensureSchema(), database.ensureSchema()]);
    const passwordHash = await bcrypt.hash('test-password', 4);
    const user = await database.query(`INSERT INTO Users (Username, PasswordHash)
      OUTPUT INSERTED.UserId VALUES (@username, @passwordHash)`, { username: 'pg_test', passwordHash });
    const userId = user.recordset[0].UserId;
    const roleId = (await database.query(`INSERT INTO Roles (RoleName) VALUES ('Admin')`)).lastInsertId;
    for (const name of ['cmp_a', 'cmp_b']) {
      const companyId = (await database.query(`INSERT INTO Companies (CompanyName, DbName, DbDialect)
        VALUES (@name, @name, 'postgres')`, { name })).lastInsertId;
      await database.query('INSERT INTO UserCompanies (UserId, CompanyId) VALUES (@userId, @companyId)', { userId, companyId });
      await database.query('INSERT INTO UserRoles (UserId, RoleId, CompanyId) VALUES (@userId, @roleId, @companyId)', { userId, roleId, companyId });
    }
    assert.equal((await auth.login('pg_test', 'test-password')).user.userId, userId);
    await assert.rejects(auth.login('pg_test', 'wrong'), { statusCode: 401 });
    assert.equal((await auth.getCompaniesForUser(userId)).length, 2);
    const selected = await auth.selectCompany(userId, 1);
    assert.equal(selected.company.dbDialect, 'postgres');
    assert.ok(selected.menus.length > 0);
    assert.equal((await auth.selectCompany(userId, 2)).companyId, 2);
    await assert.rejects(auth.selectCompany(userId, 999), { statusCode: 403 });

    const columns = await database.getTableSchemaRows('UserCompanies');
    assert.equal(columns.find((c) => c.columnName === 'Id').isIdentity, 1);
    assert.equal(columns.find((c) => c.columnName === 'UserId').referencedTable, 'Users');
    assert.equal(columns.find((c) => c.columnName === 'IsDefault').dataType, 'bit');
    assert.equal(await database.tableExists('users'), true);
    await assert.rejects(database.transaction(async (tx) => {
      await tx.query("INSERT INTO Roles (RoleName) VALUES ('rollback')");
      throw new Error('rollback');
    }), /rollback/);
    assert.equal(await database.queryOne("SELECT * FROM Roles WHERE RoleName = 'rollback'"), null);
    // A concurrent ordinary query must not join another request's transaction.
    await assert.rejects(database.transaction(async (tx) => {
      await tx.query("INSERT INTO Roles (RoleName) VALUES ('tx_only')");
      await database.query("INSERT INTO Roles (RoleName) VALUES ('independent')");
      throw new Error('rollback');
    }), /rollback/);
    assert.ok(await database.queryOne("SELECT * FROM Roles WHERE RoleName = 'independent'"));
    assert.equal(await database.queryOne("SELECT * FROM Roles WHERE RoleName = 'tx_only'"), null);

    const settings = require('../services/formSettingsService');
    await settings.saveFormSettings({ userId, companyId: 1 }, 'test', { columns: ['A'] });
    await settings.saveFormSettings({ userId, companyId: 1 }, 'test', { columns: ['B'] });

    const response = () => ({ body: null, statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } });
    await runWithRequestContext({ auth: { userId, companyId: 1 } }, async () => {
      const res = response();
      await qcController.createParameter({ body: { parameter_code: 'P1', parameter_name: 'Test', parameter_type: 'Numeric' } }, res);
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal((await qc.queryRows('SELECT * FROM qc_parameters')).length, 1);
      const customerId = await webhook.upsertCustomer('910000000000', 'Test');
      const customers = await Promise.all(Array.from({ length: 5 }, () => webhook.upsertCustomer('910000000000', 'Test')));
      assert.ok(customers.every((id) => id === customerId));
      const conversationId = await webhook.getOrCreateOpenConversation(customerId);
      const conversations = await Promise.all(Array.from({ length: 5 }, () => webhook.getOrCreateOpenConversation(customerId)));
      assert.ok(conversations.every((id) => id === conversationId));
      await webhook.insertMessage({ conversationId, direction: 'inbound', messageType: 'text', body: 'Test' });
      assert.equal((await whatsapp.queryRows('SELECT * FROM whatsapp_messages')).length, 1);
      await whatsappController.listConversations({ query: {} }, res);
      assert.equal(res.body[0].last_message_body, 'Test');
      await whatsappController.upsertMessageTemplate({ params: { documentType: 'sales-order' }, body: { template_body: 'One' } }, res);
      await whatsappController.upsertMessageTemplate({ params: { documentType: 'sales-order' }, body: { template_body: 'Two' } }, res);
      assert.equal(res.body.template_body, 'Two');
    });
    await runWithRequestContext({ auth: { userId, companyId: 2 } }, async () => {
      assert.deepEqual(await qc.queryRows('SELECT * FROM qc_parameters'), []);
      assert.deepEqual(await whatsapp.queryRows('SELECT * FROM whatsapp_messages'), []);
    });
    assert.throws(() => qc.queryRows('SELECT * FROM qc_parameters'), /company session/);
    assert.throws(() => whatsapp.queryRows('SELECT * FROM whatsapp_messages'), /company session/);
  } finally {
    authDb.clearCache();
    for (const name of [schema, ...addonSchemas]) {
      await pgDb.getPool('').query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
    }
    await pgDb.closeAll();
  }
});
