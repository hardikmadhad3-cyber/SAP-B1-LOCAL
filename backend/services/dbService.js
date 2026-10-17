/**
 * Direct connection to SAP B1 company database.
 * Supports SQL Server and SAP HANA, and automatically resolves the
 * active company database from the logged-in user's assignment.
 */
const sql = require('mssql');
const env = require('../config/env');
const hanaDb = require('../db/hanaDb');
const pgDb = require('../db/pgDb');
const { ensureCompanyMigrated } = require('../db/companyMigrations');
const { getRequestContext } = require('./requestContextService');
const { getActiveCompanyConfig, splitSqlServerName } = require('./companyConfigService');
const { withDatabaseSlot } = require('./safetyControls');

const buildConfig = (connectionConfig) => {
  const sqlServer = splitSqlServerName(connectionConfig.server, connectionConfig.instanceName);

  return {
    server: sqlServer.server,
    database: connectionConfig.database,
    port: connectionConfig.port || undefined,
    options: {
      instanceName: sqlServer.instanceName,
      trustServerCertificate: connectionConfig.trustServerCertificate,
      encrypt: connectionConfig.encrypt,
    },
    authentication: {
      type: 'default',
      options: {
        userName: connectionConfig.user,
        password: connectionConfig.password,
      },
    },
    connectionTimeout: 15000,
    requestTimeout: 30000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
};

const pools = new Map();
const pendingPools = new Map();

const resolveSqlConnectionConfig = async (options = {}) => {
  const explicitDatabaseName = String(options.databaseName || '').trim();
  const activeCompanyConfig = await getActiveCompanyConfig({ databaseName: explicitDatabaseName });
  return activeCompanyConfig.sql;
};

const resolveDatabaseName = async (options = {}) => {
  const explicitDatabaseName = String(options.databaseName || '').trim();
  if (explicitDatabaseName) return explicitDatabaseName;

  const context = getRequestContext();
  if (context?.databaseName) {
    return context.databaseName;
  }

  const connectionConfig = await resolveSqlConnectionConfig(options);
  const resolvedFromAssignment = String(connectionConfig.database || '').trim();

  if (resolvedFromAssignment) {
    if (context) {
      context.databaseName = resolvedFromAssignment;
    }
    return resolvedFromAssignment;
  }

  return String(env.dbName || '').trim();
};

const getPoolKey = (connectionConfig) => JSON.stringify({
  dialect: connectionConfig.dialect || 'sqlserver',
  server: connectionConfig.server,
  instanceName: connectionConfig.instanceName || '',
  port: connectionConfig.port || 0,
  database: connectionConfig.database,
  user: connectionConfig.user,
  password: connectionConfig.password,
  encrypt: connectionConfig.encrypt,
  trustServerCertificate: connectionConfig.trustServerCertificate,
});

const getPool = async (connectionConfig) => {
  const resolvedDatabase = String(connectionConfig.database || '').trim();
  if (!resolvedDatabase || !connectionConfig.server || !connectionConfig.user) {
    throw new Error('No company database is configured for SQL access.');
  }

  const poolKey = getPoolKey(connectionConfig);
  const existingPool = pools.get(poolKey);
  if (existingPool?.connected) {
    return existingPool;
  }

  const pendingPool = pendingPools.get(poolKey);
  if (pendingPool) {
    return pendingPool;
  }

  const poolPromise = new sql.ConnectionPool(buildConfig(connectionConfig)).connect()
    .then((pool) => {
      pools.set(poolKey, pool);
      console.log(`[DB] SQL Server pool connected to ${connectionConfig.server}/${resolvedDatabase}`);
      return pool;
    })
    .finally(() => {
      pendingPools.delete(poolKey);
    });

  pendingPools.set(poolKey, poolPromise);
  return poolPromise;
};

const query = async (queryStr, params = {}, options = {}) => {
  const connectionConfig = await resolveSqlConnectionConfig(options);
  return withDatabaseSlot(queryStr, async () => {
    if (connectionConfig.dialect === 'postgres') {
      await ensureCompanyMigrated(connectionConfig.database);
      return pgDb.query(queryStr, params, { ...options, connectionConfig });
    }

    if (connectionConfig.dialect === 'hana') {
      return hanaDb.query(queryStr, params, {
        ...options,
        connectionConfig,
        database: connectionConfig.database,
      });
    }

    const pool = await getPool(connectionConfig);
    const req = pool.request();
    if (Number.isFinite(Number(options.requestTimeout)) && Number(options.requestTimeout) > 0) {
      req.timeout = Number(options.requestTimeout);
    }

    for (const [key, value] of Object.entries(params)) {
      req.input(key, value);
    }

    return req.query(queryStr);
  });
};

const getDialect = async (options = {}) => {
  const connectionConfig = await resolveSqlConnectionConfig(options);
  return connectionConfig.dialect || 'sqlserver';
};

// Optional SAP tables (IBT1, OITL, DLN26...) are absent in some companies; that is expected, not worth a log line.
const isMissingTableError = (error) => /relation "[^"]+" does not exist|invalid object name|invalid table name/i.test(String(error?.message || ''));

module.exports = {
  getDialect,
  isMissingTableError,
  query,
  sql,
  getPool,
  resolveDatabaseName,
  resolveSqlConnectionConfig,
};
