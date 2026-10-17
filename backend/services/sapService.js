/**
 * SAP Business One Service Layer integration service
 */
const axios = require('axios');
const https = require('https');
const { URL } = require('url');
const authDbService = require('./authDbService');
const dbService = require('./dbService');
const { getRequestContext, getOrSetContextValue } = require('./requestContextService');
const { getActiveCompanyConfig } = require('./companyConfigService');
const { normalizeSapWritePayload } = require('./sapPayloadUtils');
const { withSapSlot } = require('./safetyControls');
const { createServiceLayerLoginError } = require('./serviceLayerErrorUtils');

const httpsAgentsByRejectMode = new Map();
const SERVICE_LAYER_REQUEST_TIMEOUT_MS = Number(process.env.SAP_SERVICE_LAYER_TIMEOUT_MS || 180000);
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

const getHttpsAgent = (rejectUnauthorized, { keepAlive = true } = {}) => {
  const key = `${rejectUnauthorized ? 'strict' : 'relaxed'}:${keepAlive ? 'keep-alive' : 'single-use'}`;
  if (!httpsAgentsByRejectMode.has(key)) {
    httpsAgentsByRejectMode.set(key, new https.Agent({
      keepAlive,
      ...(keepAlive ? { keepAliveMsecs: 30000, maxFreeSockets: 10 } : {}),
      maxSockets: 50,
      timeout: SERVICE_LAYER_REQUEST_TIMEOUT_MS,
      rejectUnauthorized,
    }));
  }

  return httpsAgentsByRejectMode.get(key);
};

const isTransientNetworkError = (error) => (
  !error.response &&
  (
    TRANSIENT_NETWORK_CODES.has(error.code) ||
    /socket hang up|connection reset|timed out|timeout/i.test(String(error.message || ''))
  )
);

const createServiceLayerNetworkError = (error, method, fullUrl) => {
  const parsed = new URL(fullUrl);
  const wrapped = new Error(`SAP Service Layer connection closed before a response (${error.message || error.code || 'network error'}). Please try the save again after confirming SAP Service Layer is reachable.`);
  wrapped.code = error.code || 'SAP_SERVICE_LAYER_NETWORK';
  wrapped.cause = error;
  wrapped.serviceLayer = {
    method,
    host: parsed.host,
    path: parsed.pathname,
  };
  return wrapped;
};

const SESSION_TTL_MS = 25 * 60 * 1000;
const sessionsByCompanyDb = new Map();
const pendingLoginsByCompanyDb = new Map();
const userStampFieldsByCompanyTable = new Map();
const userStampUserById = new Map();

const clearServiceLayerSessions = () => {
  sessionsByCompanyDb.clear();
  pendingLoginsByCompanyDb.clear();
};

const USER_STAMP_ENDPOINT_TABLES = new Map([
  ['Items', 'OITM'],
  ['Orders', 'ORDR'],
  ['DeliveryNotes', 'ODLN'],
  ['Quotations', 'OQUT'],
  ['Invoices', 'OINV'],
  ['CreditNotes', 'ORIN'],
  ['PurchaseOrders', 'OPOR'],
  ['PurchaseQuotations', 'OPQT'],
  ['PurchaseRequests', 'OPRQ'],
  ['PurchaseDeliveryNotes', 'OPDN'],
  ['PurchaseInvoices', 'OPCH'],
  ['PurchaseCreditNotes', 'ORPC'],
  ['InventoryGenEntries', 'OIGN'],
  ['InventoryGenExits', 'OIGE'],
  ['StockTransfers', 'OWTR'],
  ['InventoryTransferRequests', 'OWTQ'],
  ['ProductionOrders', 'OWOR'],
]);

const USER_STAMP_TARGETS = {
  userName: new Set(['WEBUSER']),
  userCode: new Set(['WEBUSERCODE']),
};
const USER_STAMP_STANDARD_FIELDS = ['U_WEBUSER', 'U_WEBUSERCODE'];
const USER_STAMP_DEPRECATED_FIELDS = ['U_WEBUSERID'];

const normalizeStampKey = (value = '') =>
  String(value || '').trim().toUpperCase().replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');

const getServiceLayerEntity = (url = '') => {
  const path = String(url || '').split('?')[0].replace(/^\/+/, '');
  const match = path.match(/^([A-Za-z0-9_]+)(?:\(|\/|$)/);
  return match ? match[1] : '';
};

const buildUrl = (baseUrl, path) => {
  const qIdx = path.indexOf('?');
  if (qIdx === -1) return `${baseUrl}${path}`;

  const base = path.slice(0, qIdx);
  const qs = path.slice(qIdx + 1);
  const encodedQs = qs
    .replace(/\$/g, '%24')
    .replace(/ /g, '%20')
    .replace(/'/g, '%27');

  return `${baseUrl}${base}?${encodedQs}`;
};

const buildStringKeyPath = (entityName, value) => {
  const escapedValue = String(value ?? '').replace(/'/g, "''");
  // SAP Service Layer rejects encoded path separators (%2F) inside OData keys.
  const encodedValue = encodeURIComponent(escapedValue).replace(/%2F/gi, '/');
  return `/${entityName}('${encodedValue}')`;
};

const extractCookie = (header) => {
  if (!Array.isArray(header)) return header || '';
  return header.map((cookie) => String(cookie).split(';')[0]).filter(Boolean).join('; ');
};

const getSessionKey = (config) => [
  config.baseUrl,
  config.username,
  config.companyDb,
].map((value) => String(value || '').trim().toLowerCase()).join('|');

const getSessionState = (config) => {
  const sessionKey = getSessionKey(config);

  if (!sessionsByCompanyDb.has(sessionKey)) {
    sessionsByCompanyDb.set(sessionKey, {
      companyDb: String(config.companyDb || '').trim(),
      sessionCookie: '',
      sessionActive: false,
      sessionExpireAt: 0,
    });
  }

  return sessionsByCompanyDb.get(sessionKey);
};

const resolveCompanyDb = async (requestConfig = {}) => {
  const explicitCompanyDb = String(requestConfig.companyDb || '').trim();
  if (explicitCompanyDb) {
    return explicitCompanyDb;
  }

  const context = getRequestContext();
  if (context?.companyDb) {
    return context.companyDb;
  }

  const authUserId = Number(context?.req?.auth?.userId);
  const authCompanyId = Number(context?.req?.auth?.companyId);

  if (Number.isFinite(authUserId) && Number.isFinite(authCompanyId)) {
    const assignedCompany = await getOrSetContextValue(
      `assignedCompany:${authUserId}:${authCompanyId}`,
      () => authDbService.getAssignedCompanyForUser(authUserId, authCompanyId),
    );
    const activeConfig = await getActiveCompanyConfig({ company: assignedCompany });
    const companyDb = String(activeConfig.serviceLayer.companyDb || '').trim();

    if (companyDb) {
      if (context) {
        context.companyDb = companyDb;
      }
      return companyDb;
    }
  }

  const activeConfig = await getActiveCompanyConfig();
  return String(activeConfig.serviceLayer.companyDb || '').trim();
};

const resolveServiceLayerConfig = async (requestConfig = {}) => {
  const activeConfig = await getActiveCompanyConfig();
  return {
    ...activeConfig.serviceLayer,
    companyDb: String(requestConfig.companyDb || activeConfig.serviceLayer.companyDb || '').trim(),
  };
};

const getUserStampFields = async (companyDb, tableName) => {
  const cacheKey = `${String(companyDb || '').trim().toLowerCase()}:${tableName}`;
  if (userStampFieldsByCompanyTable.has(cacheKey)) {
    return userStampFieldsByCompanyTable.get(cacheKey);
  }

  const columnResult = await dbService.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = @tableName
      AND COLUMN_NAME LIKE 'U_%'
  `, { tableName }, { databaseName: companyDb });

  const metadataResult = await dbService.query(`
    SELECT AliasID, Descr
    FROM CUFD
    WHERE TableID = @tableName
  `, { tableName }, { databaseName: companyDb }).catch((error) => {
    console.warn(`[SAP] Could not read UDF metadata for ${companyDb}.${tableName}: ${error.message}`);
    return { recordset: [] };
  });

  const columns = new Set((columnResult.recordset || []).map((row) => String(row.COLUMN_NAME || '').trim()));
  const fields = {
    fieldNames: columns,
    userNameField: '',
    userCodeFields: [],
  };

  const addResolvedField = (fieldName, targetType) => {
    const normalizedFieldName = String(fieldName || '').trim();
    if (!normalizedFieldName || !columns.has(normalizedFieldName)) {
      return;
    }

    if (targetType === 'userName' && !fields.userNameField) {
      fields.userNameField = normalizedFieldName;
      return;
    }

    if (targetType === 'userCode' && !fields.userCodeFields.includes(normalizedFieldName)) {
      fields.userCodeFields.push(normalizedFieldName);
    }
  };

  for (const columnName of columns) {
    const normalizedColumn = normalizeStampKey(columnName);
    if (USER_STAMP_TARGETS.userName.has(normalizedColumn)) {
      addResolvedField(columnName, 'userName');
    }
    if (USER_STAMP_TARGETS.userCode.has(normalizedColumn)) {
      addResolvedField(columnName, 'userCode');
    }
  }

  for (const row of metadataResult.recordset || []) {
    const alias = String(row.AliasID || '').trim();
    const serviceLayerField = alias ? `U_${alias.replace(/^U_/i, '')}` : '';
    const keysToMatch = [alias, row.Descr].map(normalizeStampKey);

    if (keysToMatch.some((key) => USER_STAMP_TARGETS.userName.has(key))) {
      addResolvedField(serviceLayerField, 'userName');
    }

    if (keysToMatch.some((key) => USER_STAMP_TARGETS.userCode.has(key))) {
      addResolvedField(serviceLayerField, 'userCode');
    }
  }

  userStampFieldsByCompanyTable.set(cacheKey, fields);
  return fields;
};

const getAuthenticatedUserStamp = async () => {
  const context = getRequestContext();
  const userId = Number(context?.req?.auth?.userId);
  if (!Number.isFinite(userId)) {
    return null;
  }

  if (userStampUserById.has(userId)) {
    return userStampUserById.get(userId);
  }

  const user = await authDbService.queryOne(`
    SELECT UserId, Username, FullName
    FROM dbo.Users
    WHERE UserId = @userId
  `, { userId });

  const stamp = {
    userCode: String(user?.UserId ?? userId).trim(),
    userName: String(user?.FullName || user?.Username || userId).trim(),
  };

  userStampUserById.set(userId, stamp);
  return stamp;
};

const withAuthenticatedUserStamp = async (config, companyDb) => {
  const method = String(config.method || 'get').trim().toUpperCase();
  if (!['POST', 'PATCH'].includes(method) || !config.data || typeof config.data !== 'object' || Array.isArray(config.data)) {
    return config.data || null;
  }

  const entity = getServiceLayerEntity(config.url);
  // Keep a confirmation-only PATCH narrow: automatic audit UDF stamping would
  // otherwise write unrelated document fields despite the caller's intent.
  if (method === 'PATCH' && USER_STAMP_ENDPOINT_TABLES.has(entity)
    && Object.keys(config.data).length === 1
    && ['tYES', 'tNO'].includes(config.data.Confirmed)) return config.data;
  const tableName = USER_STAMP_ENDPOINT_TABLES.get(entity);
  if (!tableName) {
    return config.data;
  }

  const stamp = await getAuthenticatedUserStamp();
  if (!stamp) {
    return config.data;
  }

  const fields = await getUserStampFields(companyDb, tableName);

  const stampedPayload = { ...config.data };
  for (const field of [...USER_STAMP_STANDARD_FIELDS, ...USER_STAMP_DEPRECATED_FIELDS]) {
    if (!fields.fieldNames.has(field)) {
      delete stampedPayload[field];
    }
  }

  for (const field of USER_STAMP_DEPRECATED_FIELDS) {
    delete stampedPayload[field];
  }

  if (!fields.userNameField && fields.userCodeFields.length === 0) {
    return stampedPayload;
  }

  if (fields.userNameField && stamp.userName) {
    stampedPayload[fields.userNameField] = stamp.userName;
  }

  for (const field of fields.userCodeFields) {
    if (stamp.userCode) {
      stampedPayload[field] = stamp.userCode;
    }
  }

  return stampedPayload;
};

const login = async (companyDbOrConfig) => {
  const config = typeof companyDbOrConfig === 'object' && companyDbOrConfig !== null
    ? companyDbOrConfig
    : await resolveServiceLayerConfig({ companyDb: companyDbOrConfig });
  const resolvedCompanyDb = String(config.companyDb || '').trim();
  if (!config.baseUrl || !config.username || !config.password || !resolvedCompanyDb) {
    throw new Error('Missing SAP configuration. Check backend/.env or Company Master credentials.');
  }

  const loginKey = getSessionKey(config);
  const pendingLogin = pendingLoginsByCompanyDb.get(loginKey);
  if (pendingLogin) {
    return pendingLogin;
  }

  const loginUrl = buildUrl(config.baseUrl, '/Login');
  const loginPromise = axios.post(
    loginUrl,
    {
      UserName: config.username,
      Password: config.password,
      CompanyDB: resolvedCompanyDb,
    },
    {
      httpsAgent: getHttpsAgent(config.rejectUnauthorized, { keepAlive: false }),
      timeout: SERVICE_LAYER_REQUEST_TIMEOUT_MS,
      headers: { Connection: 'close' },
    },
  ).then((response) => {
    const sessionState = getSessionState(config);
    sessionState.sessionCookie = extractCookie(response.headers['set-cookie']);
    sessionState.sessionActive = true;
    sessionState.sessionExpireAt = Date.now() + SESSION_TTL_MS;
    console.log(`[SAP] Session established for ${resolvedCompanyDb}`);
    return sessionState.sessionCookie;
  }).catch((error) => {
    if (isTransientNetworkError(error)) {
      throw createServiceLayerNetworkError(error, 'POST', loginUrl);
    }

    throw createServiceLayerLoginError(error, {
      companyDb: resolvedCompanyDb,
      baseUrl: config.baseUrl,
    });
  }).finally(() => {
    pendingLoginsByCompanyDb.delete(loginKey);
  });

  pendingLoginsByCompanyDb.set(loginKey, loginPromise);
  return loginPromise;
};

const ensureSession = async (companyDb) => {
  if (!companyDb && (await dbService.resolveSqlConnectionConfig()).dialect === 'postgres') return;
  const config = await resolveServiceLayerConfig({ companyDb });
  const sessionState = getSessionState(config);

  if (!sessionState.sessionActive || !sessionState.sessionCookie || Date.now() >= sessionState.sessionExpireAt) {
    await login(config);
  }
};

const rawRequest = (method, fullUrl, headers, body, rejectUnauthorized, requestOptions = {}) =>
  new Promise((resolve, reject) => {
    const parsed = new URL(fullUrl);
    const requestBody = body === undefined || body === null ? '' : JSON.stringify(body);
    const normalizedMethod = method.toUpperCase();
    const keepAlive = requestOptions.keepAlive !== false;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: normalizedMethod,
      headers: {
        'Content-Type': 'application/json',
        ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {}),
        ...(!keepAlive ? { Connection: 'close' } : {}),
        ...headers,
      },
      agent: getHttpsAgent(rejectUnauthorized, { keepAlive }),
      rejectUnauthorized,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          const err = new Error(`SAP ${res.statusCode}`);
          try {
            err.response = { status: res.statusCode, data: JSON.parse(data) };
          } catch {
            err.response = { status: res.statusCode, data };
          }
          return reject(err);
        }

        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.setTimeout(SERVICE_LAYER_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`SAP Service Layer request timed out after ${SERVICE_LAYER_REQUEST_TIMEOUT_MS}ms`));
    });
    req.on('error', (error) => reject(
      isTransientNetworkError(error)
        ? createServiceLayerNetworkError(error, normalizedMethod, fullUrl)
        : error,
    ));
    if (requestBody) req.write(requestBody);
    req.end();
  });

const request = async (config, retryOnAuth = true, retryOnTransientRead = true) => {
  await require('./documentSeriesWriteValidation').validateMarketingSeriesWrite(config);
  // Local ERP companies have no SAP: the same request is served from PostgreSQL.
  const sqlConfig = await dbService.resolveSqlConnectionConfig();
  if (sqlConfig.dialect === 'postgres') {
    const method = String(config.method || 'get').trim().toUpperCase();
    return require('./localServiceLayer').request({
      ...config,
      data: WRITE_METHODS.has(method) && !config.preserveEmptyStrings ? normalizeSapWritePayload(config.data) : config.data,
    }, sqlConfig.database);
  }
  const serviceLayerConfig = await resolveServiceLayerConfig(config);
  const companyDb = serviceLayerConfig.companyDb;
  await ensureSession(companyDb);
  const sessionState = getSessionState(serviceLayerConfig);
  const normalizedMethod = String(config.method || 'get').trim().toUpperCase();
  const stampedRequestData = await withAuthenticatedUserStamp(config, companyDb);
  const requestData = WRITE_METHODS.has(normalizedMethod)
    ? (config.preserveEmptyStrings ? stampedRequestData : normalizeSapWritePayload(stampedRequestData))
    : stampedRequestData;
  const useKeepAlive = !WRITE_METHODS.has(normalizedMethod);

  try {
    return await withSapSlot(config, () => rawRequest(
      normalizedMethod,
      buildUrl(serviceLayerConfig.baseUrl, config.url),
      { Cookie: sessionState.sessionCookie, ...(config.headers || {}) },
      requestData,
      serviceLayerConfig.rejectUnauthorized,
      { keepAlive: useKeepAlive },
    ));
  } catch (error) {
    if (retryOnAuth && [401, 403].includes(error.response?.status)) {
      console.log(`[SAP] Auth error for ${companyDb}; re-logging in`);
      sessionState.sessionActive = false;
      sessionState.sessionCookie = '';
      sessionState.sessionExpireAt = 0;
      await login(serviceLayerConfig);
      return request(config, false, retryOnTransientRead);
    }

    if (retryOnTransientRead && IDEMPOTENT_METHODS.has(normalizedMethod) && isTransientNetworkError(error.cause || error)) {
      console.warn(`[SAP] Transient ${normalizedMethod} connection error; retrying once: ${error.message}`);
      return request(config, retryOnAuth, false);
    }

    throw error;
  }
};

const createItem = async (data) => {
  const res = await request({ method: 'POST', url: '/Items', data });
  return res.data;
};

const getItem = async (itemCode) => {
  const res = await request({ method: 'GET', url: buildStringKeyPath('Items', itemCode) });
  return res.data;
};

const updateItem = async (itemCode, data) => {
  await request({ method: 'PATCH', url: buildStringKeyPath('Items', itemCode), data });
  return getItem(itemCode);
};

const searchItems = async (query = '', top = 50, skip = 0) => {
  const filter = query
    ? `&$filter=contains(ItemCode,'${query}') or contains(ItemName,'${query}')`
    : '';

  const res = await request({
    method: 'GET',
    url: `/Items?$select=ItemCode,ItemName,ForeignName,ItemsGroupCode,InventoryItem,SalesItem,PurchaseItem,AssetItem,Valid,Frozen,ItemType,ItemClass&$top=${top}&$skip=${skip}${filter}`,
  });

  return res.data.value || [];
};

const getItemGroups = async () => {
  const res = await request({ method: 'GET', url: '/ItemGroups?$select=Number,GroupName' });
  return res.data.value || [];
};

const getPriceLists = async () => {
  const res = await request({ method: 'GET', url: '/PriceLists?$select=PriceListNo,PriceListName' });
  return res.data.value || [];
};

const createItem_generic = async (endpoint, data) => {
  const res = await request({ method: 'POST', url: endpoint, data });
  return res.data;
};

module.exports = {
  login,
  ensureSession,
  request,
  buildStringKeyPath,
  resolveCompanyDb,
  resolveServiceLayerConfig,
  clearServiceLayerSessions,
  createItem,
  createItem_generic,
  getItem,
  updateItem,
  searchItems,
  getItemGroups,
  getPriceLists,
};
