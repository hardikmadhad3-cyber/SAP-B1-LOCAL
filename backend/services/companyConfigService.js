const env = require('../config/env');
const authDbService = require('./authDbService');
const { getRequestContext, getOrSetContextValue } = require('./requestContextService');

const firstText = (...values) => {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }

  return '';
};

const sourceForText = (companyValue, fallbackValue, companySource = 'admin-panel', fallbackSource = 'environment') => {
  if (String(companyValue ?? '').trim()) return companySource;
  if (String(fallbackValue ?? '').trim()) return fallbackSource;
  return 'missing';
};

const reportCompanyDbSource = (company = {}, useEnvFallback = true) => {
  if (String(company.ReportServiceCompanyDb ?? '').trim()) return 'admin-panel report service company DB';
  if (String(company.DbName ?? '').trim()) return 'selected company DbName';
  if (String(company.SapCompanyDb ?? '').trim()) return 'admin-panel SAP company fallback';
  if (!useEnvFallback) return 'missing';
  if (String(env.reportServiceCompanyDb ?? '').trim()) return 'environment';
  return 'missing';
};

const reportDefaultSchemaSource = (company = {}, useEnvFallback = true) => {
  if (String(company.ReportServiceDefaultSchema ?? '').trim()) return 'admin-panel report schema fallback';
  if (String(company.ReportServiceCompanyDb ?? '').trim()) return 'admin-panel report company fallback';
  if (String(company.DbName ?? '').trim()) return 'selected company DbName';
  if (String(company.SapCompanyDb ?? '').trim()) return 'admin-panel SAP company fallback';
  if (!useEnvFallback) return 'missing';
  if (String(env.reportServiceDefaultSchema ?? '').trim()) return 'environment';
  return 'missing';
};

const boolFromConfig = (value, fallback = false) => {
  if (value === null || value === undefined || value === '') {
    return Boolean(fallback);
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const numberFromConfig = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
};

const normalizeDbDialect = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'hana' || normalized === 'postgres') return normalized;
  return 'sqlserver';
};

const splitSqlServerName = (serverName = '', explicitInstance = '') => {
  const normalizedServer = String(serverName || '').trim();
  const normalizedInstance = String(explicitInstance || '').trim();
  const instanceMatch = normalizedServer.match(/^([^\\/]+)[\\/](.+)$/);

  if (instanceMatch) {
    return {
      server: instanceMatch[1],
      instanceName: instanceMatch[2],
    };
  }

  return {
    server: normalizedServer,
    instanceName: normalizedInstance || undefined,
  };
};

const getAssignedCompanyFromContext = async () => {
  const context = getRequestContext();
  if (context?.companyOverride) return context.companyOverride;
  const userId = Number(context?.req?.auth?.userId);
  const companyId = Number(context?.req?.auth?.companyId);

  if (!Number.isFinite(userId) || !Number.isFinite(companyId)) {
    return null;
  }

  return getOrSetContextValue(
    `assignedCompany:${userId}:${companyId}`,
    () => authDbService.getAssignedCompanyForUser(userId, companyId),
  );
};

const buildCompanyConfig = (company = {}) => {
  const hasSelectedCompany = company && Object.keys(company).length > 0;
  const companySqlDatabase = firstText(company.DbName);
  const companySapCompanyDb = firstText(company.SapCompanyDb);
  const dbDialect = normalizeDbDialect(firstText(company.DbDialect, env.dbDialect));
  const sqlDatabase = firstText(companySqlDatabase, env.dbName);
  const sapCompanyDb = firstText(companySapCompanyDb, sqlDatabase, env.sapCompanyDb);
  const reportCompanyDb = hasSelectedCompany
    ? firstText(company.ReportServiceCompanyDb, companySqlDatabase, companySapCompanyDb)
    : firstText(company.ReportServiceCompanyDb, companySqlDatabase, companySapCompanyDb, env.reportServiceCompanyDb);
  const reportDefaultSchema = hasSelectedCompany
    ? firstText(company.ReportServiceDefaultSchema, reportCompanyDb, companySqlDatabase, companySapCompanyDb)
    : firstText(company.ReportServiceDefaultSchema, reportCompanyDb, env.reportServiceDefaultSchema);
  const reportBaseUrl = hasSelectedCompany
    ? firstText(company.ReportServiceBaseUrl)
    : firstText(company.ReportServiceBaseUrl, env.reportServiceBaseUrl);
  const reportUsername = hasSelectedCompany
    ? firstText(company.ReportServiceUsername)
    : firstText(company.ReportServiceUsername, env.reportServiceUsername);
  const reportPassword = hasSelectedCompany
    ? firstText(company.ReportServicePassword)
    : firstText(company.ReportServicePassword, env.reportServicePassword);
  const reportDbInstance = hasSelectedCompany
    ? firstText(company.ReportServiceDbInstance)
    : firstText(company.ReportServiceDbInstance, env.reportServiceDbInstance);

  return {
    companyId: company.CompanyId ?? null,
    companyName: firstText(company.CompanyName),
    port: numberFromConfig(company.Port, env.port),
    authDbName: firstText(company.AuthDbName, env.authDbName),
    sql: {
      dialect: dbDialect,
      server: firstText(company.DbServer, company.ServerName, env.dbServer),
      instanceName: env.dbInstance || undefined,
      port: numberFromConfig(company.DbPort, env.dbPort),
      database: sqlDatabase,
      user: firstText(company.DbUser, env.dbUser),
      password: firstText(company.DbPassword, env.dbPassword),
      encrypt: boolFromConfig(company.DbEncrypt, env.dbEncrypt),
      trustServerCertificate: boolFromConfig(company.DbTrustCert, env.dbTrustCert),
    },
    serviceLayer: {
      baseUrl: firstText(company.SapBaseUrl, env.sapBaseUrl),
      username: firstText(company.SapUsername, env.sapUsername),
      password: firstText(company.SapPassword, env.sapPassword),
      companyDb: sapCompanyDb,
      rejectUnauthorized: boolFromConfig(company.SapRejectUnauthorized, env.sapRejectUnauthorized),
    },
    reportService: {
      baseUrl: reportBaseUrl,
      username: reportUsername,
      password: reportPassword,
      companyDb: reportCompanyDb,
      dbInstance: reportDbInstance,
      defaultSchema: reportDefaultSchema,
      rejectUnauthorized: boolFromConfig(
        company.ReportServiceRejectUnauthorized,
        env.reportServiceRejectUnauthorized,
      ),
      fieldSources: {
        baseUrl: sourceForText(company.ReportServiceBaseUrl, hasSelectedCompany ? '' : env.reportServiceBaseUrl),
        username: sourceForText(company.ReportServiceUsername, hasSelectedCompany ? '' : env.reportServiceUsername),
        password: sourceForText(company.ReportServicePassword, hasSelectedCompany ? '' : env.reportServicePassword),
        dbInstance: sourceForText(company.ReportServiceDbInstance, hasSelectedCompany ? '' : env.reportServiceDbInstance),
        companyDb: reportCompanyDbSource(company, !hasSelectedCompany),
        defaultSchema: reportDefaultSchemaSource(company, !hasSelectedCompany),
      },
    },
    documentDefaults: {
      salesOrderToVendorCode: firstText(company.SalesOrderDefaultToVendorCode),
    },
    userMapping: {
      sapUserCode: firstText(company.AssignedSapUserCode),
      companySapUserCode: firstText(company.SapUsername),
    },
  };
};

const getActiveCompanyConfig = async (overrides = {}) => {
  const company = overrides.company || await getAssignedCompanyFromContext();
  const config = buildCompanyConfig(company || {});

  if (overrides.companyDb) {
    config.serviceLayer.companyDb = String(overrides.companyDb).trim();
    config.reportService.companyDb = String(overrides.companyDb).trim();
  }

  if (overrides.databaseName) {
    config.sql.database = String(overrides.databaseName).trim();
  }

  return config;
};

module.exports = {
  boolFromConfig,
  buildCompanyConfig,
  getActiveCompanyConfig,
  normalizeDbDialect,
  splitSqlServerName,
};
