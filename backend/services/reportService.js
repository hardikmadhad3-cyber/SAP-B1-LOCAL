const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const net = require('net');
const env = require('../config/env');
const dbService = require('./dbService');
const { getActiveCompanyConfig } = require('./companyConfigService');

const reportClientsByConfig = new Map();

const getReportClient = (config) => {
  const clientKey = [
    config.baseUrl,
    config.rejectUnauthorized ? 'strict' : 'relaxed',
  ].join('|');

  if (!reportClientsByConfig.has(clientKey)) {
    reportClientsByConfig.set(clientKey, axios.create({
      baseURL: config.baseUrl,
      timeout: env.reportServiceTimeoutMs,
      responseType: 'text',
      headers: {
        'Content-Type': 'application/json',
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: config.rejectUnauthorized,
      }),
    }));
  }

  return reportClientsByConfig.get(clientKey);
};

const reportSessionsByCompany = new Map();

const stripPdfPrefix = (value) =>
  String(value || '')
    .trim()
    .replace(/^data:application\/pdf;base64,/i, '')
    .replace(/\s+/g, '');

const extractCookieHeader = (cookieHeader) => {
  const cookieHeaders = Array.isArray(cookieHeader)
    ? cookieHeader
    : [cookieHeader].filter(Boolean);

  if (!cookieHeaders.length) {
    return '';
  }

  return cookieHeaders
    .map((cookie) => String(cookie).split(';')[0])
    .filter(Boolean)
    .join('; ');
};

const parseLoginPayload = (payload) => {
  if (!payload || typeof payload !== 'string') {
    return payload;
  }

  const trimmed = payload.trim();
  if (!trimmed) {
    return payload;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return payload;
  }
};

const extractReportServiceMessage = (payload) => {
  const parsedPayload = parseLoginPayload(payload);

  if (!parsedPayload || typeof parsedPayload !== 'object') {
    return '';
  }

  const candidates = [
    parsedPayload?.error?.message?.value,
    parsedPayload?.error?.message,
    parsedPayload?.message?.value,
    parsedPayload?.message,
    parsedPayload?.detail,
  ];

  return String(candidates.find((candidate) => candidate) || '').trim();
};

const normalizeStringPayload = (value) => {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return stripPdfPrefix(JSON.parse(trimmed));
    } catch (_error) {
      return stripPdfPrefix(trimmed.slice(1, -1));
    }
  }

  return stripPdfPrefix(trimmed);
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const padNumber = (value) => String(value).padStart(2, '0');

const normalizeLoadCrDateValue = (value) => {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const partMatch = text.match(/^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)$/i);
  if (partMatch) {
    const year = Number(partMatch[1]);
    const month = Number(partMatch[2]);
    const day = Number(partMatch[3]);

    if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
      return `${year}-${padNumber(month)}-${padNumber(day)}`;
    }
  }

  const epochMatch = text.match(/^\/?Date\((\d{10,})\)\/?$/i);
  if (epochMatch) {
    const epoch = Number(epochMatch[1]);
    if (Number.isFinite(epoch)) {
      return new Date(epoch).toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return text;
};

const humanizeParameterName = (value) =>
  String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

const normalizeLookupColumnKey = (value) =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '');

const DEFAULT_LOOKUP_COLUMNS_BY_TABLE = {
  OCRD: [
    { key: 'CardCode', label: 'BP Code' },
    { key: 'CardName', label: 'BP Name' },
  ],
  OITM: [
    { key: 'ItemCode', label: 'Item Code' },
    { key: 'ItemName', label: 'Item Name' },
  ],
};

const buildParameterOption = (entry, paramType) => {
  if (entry == null || entry === '') {
    return null;
  }

  if (typeof entry === 'object') {
    const valueCandidate =
      entry.value ??
      entry.Value ??
      entry.code ??
      entry.Code ??
      entry.key ??
      entry.Key ??
      entry.name ??
      entry.Name ??
      entry.description ??
      entry.Description;

    if (valueCandidate == null || valueCandidate === '') {
      return null;
    }

    const labelCandidate =
      entry.label ??
      entry.Label ??
      entry.description ??
      entry.Description ??
      entry.name ??
      entry.Name ??
      valueCandidate;

    return {
      value: paramType === 'number' ? String(Number(valueCandidate)) : String(valueCandidate),
      label: String(labelCandidate),
    };
  }

  return {
    value: paramType === 'number' ? String(Number(entry)) : String(entry),
    label: String(entry),
  };
};

const extractParameterOptions = (row, paramType, defaultValue, displayName) => {
  if (paramType !== 'string') {
    return [];
  }

  const sources = [
    row?.validValues,
    row?.ValidValues,
    row?.values,
    row?.Values,
    row?.listOfValues,
    row?.ListOfValues,
    row?.lovValues,
    row?.LovValues,
    row?.initialValues,
    row?.InitialValues,
  ].filter(Array.isArray);

  const optionMap = new Map();

  sources.forEach((source) => {
    source.forEach((entry) => {
      const option = buildParameterOption(entry, paramType);
      if (!option || !option.value) {
        return;
      }

      const key = option.value.toLowerCase();
      if (!optionMap.has(key)) {
        optionMap.set(key, option);
      }
    });
  });

  if (!optionMap.size && /report type/i.test(String(displayName || '')) && defaultValue) {
    optionMap.set(String(defaultValue).toLowerCase(), {
      value: String(defaultValue),
      label: String(defaultValue),
    });
  }

  return [...optionMap.values()];
};

const parseLookupSpec = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(.+?)@select\s+(.+?)\s+from\s+([A-Za-z0-9_]+)(?:\s+where\s+.+?)?\s*:?\s*$/i);

  if (!match) {
    return null;
  }

  const label = String(match[1] || '').trim();
  const table = String(match[3] || '').trim().toUpperCase();
  const rawColumns = String(match[2] || '').trim();
  const columns = rawColumns === '*'
    ? DEFAULT_LOOKUP_COLUMNS_BY_TABLE[table] || []
    : rawColumns
      .split(',')
      .map((column) => String(column || '').trim())
      .filter(Boolean)
      .map((column) => ({
        key: normalizeLookupColumnKey(column),
        label: column,
      }))
      .filter((column) => column.key);

  if (!table || !columns.length) {
    return null;
  }

  return {
    type: 'sql-lookup',
    title: label ? `Select ${label}` : 'Select Value',
    table,
    columns,
    valueKey: columns[0].key,
    displayKey: columns[1]?.key || columns[0].key,
  };
};

const mapCrParameterType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();

  if (
    normalized === 'xsd:number' ||
    normalized === 'xsd:int' ||
    normalized === 'xsd:integer' ||
    normalized === 'xsd:decimal' ||
    normalized === 'number' ||
    normalized === 'numeric'
  ) {
    return 'number';
  }

  if (normalized === 'xsd:date' || normalized === 'xsd:datetime' || normalized === 'date') {
    return 'date';
  }

  return 'string';
};

const extractParameterDefaultValue = (row, paramType) => {
  const candidates = [
    ...(Array.isArray(row?.initialValues) ? row.initialValues : []),
    ...(Array.isArray(row?.values) ? row.values : []),
    row?.defaultValue,
  ].filter((entry) => entry != null && entry !== '');

  const firstValue = candidates[0];
  if (firstValue == null) {
    return '';
  }

  if (paramType === 'date') {
    return normalizeLoadCrDateValue(firstValue);
  }

  if (paramType === 'number') {
    const numeric = Number(firstValue);
    return Number.isFinite(numeric) ? String(numeric) : String(firstValue);
  }

  return String(firstValue);
};

const normalizeCrParameter = (row, index) => {
  const apiName = String(row?.name || row?.parameterName || row?.parameter || row?.description || '');
  const paramName =
    apiName.trim();

  if (!paramName) {
    return null;
  }

  const paramType = mapCrParameterType(row?.type);
  const displayNameRaw = String(row?.description || row?.displayName || paramName).trim();
  const sortOrder = Number(row?.sortOrder ?? row?.SortOrder);
  const isOptionalPrompt = normalizeBoolean(row?.isOptionalPrompt);
  const allowNullValue = normalizeBoolean(row?.allowNullValue);
  const defaultValue = extractParameterDefaultValue(row, paramType);
  const lookup =
    parseLookupSpec(displayNameRaw) ||
    parseLookupSpec(paramName);
  const displayName = lookup
    ? humanizeParameterName(String(displayNameRaw.split(/@select/i)[0] || paramName).trim()) || paramName
    : humanizeParameterName(displayNameRaw || paramName) || paramName;
  const options = extractParameterOptions(row, paramType, defaultValue, displayName);

  return {
    paramName,
    apiName,
    displayName,
    paramType,
    // An optional prompt may be left blank even when an explicit NULL is disallowed.
    isRequired: !isOptionalPrompt && !allowNullValue,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : index,
    defaultValue,
    options,
    lookup,
  };
};

const extractBase64Pdf = (payload) => {
  if (typeof payload === 'string') {
    return normalizeStringPayload(payload);
  }

  if (!payload) {
    return '';
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const result = extractBase64Pdf(entry);
      if (result) {
        return result;
      }
    }

    return '';
  }

  if (typeof payload === 'object') {
    const preferredKeys = ['base64Pdf', 'Base64Pdf', 'pdfBase64', 'PDFData', 'data', 'value'];

    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        const result = extractBase64Pdf(payload[key]);
        if (result) {
          return result;
        }
      }
    }

    for (const value of Object.values(payload)) {
      const result = extractBase64Pdf(value);
      if (result) {
        return result;
      }
    }
  }

  return '';
};

const isKnownUnsupportedLayoutMessage = (value) =>
  /^ThereisnodefaultCrystalReportlayoutrelatedto/i.test(String(value || '').trim());

const isKnownPdfGenerationFailureMessage = (value) =>
  /^AnerrorhasoccurredwhilegeneratingthePDFfile\.?$/i.test(String(value || '').trim());

const isProbablyBase64 = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length < 80 || normalized.length % 4 !== 0) {
    return false;
  }

  return /^[A-Za-z0-9+/=]+$/.test(normalized);
};

const resolveReportServiceConfig = async (companyDb = '') => {
  const explicitCompanyDb = String(companyDb || '').trim();
  const activeCompanyConfig = await getActiveCompanyConfig();

  return {
    ...activeCompanyConfig.reportService,
    companyDb: explicitCompanyDb || activeCompanyConfig.reportService.companyDb,
  };
};

const resolveReportCompanyDb = async (companyDb = '') => {
  const config = await resolveReportServiceConfig(companyDb);
  return String(config.companyDb || '').trim();
};

const normalizeReportServiceBaseUrl = (value) =>
  String(value || '').trim().replace(/\/+$/, '');

const getReportServiceConfigCandidates = (primaryConfig) => {
  const candidates = [];
  const seenBaseUrls = new Set();

  const addCandidate = (config) => {
    const baseUrl = normalizeReportServiceBaseUrl(config.baseUrl);
    const key = baseUrl.toLowerCase();

    if (!baseUrl || seenBaseUrls.has(key)) {
      return;
    }

    seenBaseUrls.add(key);
    candidates.push({
      ...config,
      baseUrl,
    });
  };

  addCandidate(primaryConfig);

  return candidates;
};

const REPORT_SERVICE_CONNECTION_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'INVALID_REPORT_SERVICE_URL',
]);

const isReportServiceConnectivityError = (error) => {
  if (error?.isReportServiceConnectivityError) {
    return true;
  }

  const source = error?.cause || error;
  const code = String(source?.code || error?.code || '').toUpperCase();

  if (REPORT_SERVICE_CONNECTION_CODES.has(code)) {
    return true;
  }

  if (source?.response || error?.response) {
    return false;
  }

  return /network error|timeout|timed out|connect/i.test(String(source?.message || error?.message || ''));
};

const getReportServiceEndpoint = (baseUrl) => {
  const parsed = new URL(baseUrl);
  const defaultPort = parsed.protocol === 'https:' ? 443 : 80;

  return {
    host: parsed.hostname,
    port: Number(parsed.port || defaultPort),
  };
};

const assertReportServiceReachable = (config) => new Promise((resolve, reject) => {
  let endpoint;

  try {
    endpoint = getReportServiceEndpoint(config.baseUrl);
  } catch (error) {
    error.code = error.code || 'INVALID_REPORT_SERVICE_URL';
    reject(error);
    return;
  }

  const socket = new net.Socket();
  let settled = false;

  const finish = (error = null) => {
    if (settled) {
      return;
    }

    settled = true;
    socket.destroy();

    if (error) {
      reject(error);
      return;
    }

    resolve();
  };

  socket.setTimeout(3000);
  socket.once('connect', () => finish());
  socket.once('timeout', () => {
    const error = new Error(`connect ETIMEDOUT ${endpoint.host}:${endpoint.port}`);
    error.code = 'ETIMEDOUT';
    finish(error);
  });
  socket.once('error', finish);
  socket.connect(endpoint.port, endpoint.host);
});

const decorateReportServiceConnectionError = (error, action, config) => {
  if (!isReportServiceConnectivityError(error)) {
    return error;
  }

  if (error?.isReportServiceConnectivityError) {
    return error;
  }

  const baseUrl = normalizeReportServiceBaseUrl(config.baseUrl);
  const source = config.fieldSources?.baseUrl || 'configured';
  const code = String(error.code || error.cause?.code || '').toUpperCase();
  const detail = code ? ` (${code})` : '';
  const wrapped = new Error(
    `Could not connect to SAP Report Service at ${baseUrl} while trying to ${action}${detail}. ` +
    `Check the selected company's SAP Report Service Base URL (${source}) and confirm the configured host and port are reachable from this backend server.`,
  );

  wrapped.statusCode = code === 'ETIMEDOUT' || code === 'ECONNABORTED' ? 504 : 502;
  wrapped.code = code || 'REPORT_SERVICE_CONNECTION_FAILED';
  wrapped.cause = error;
  wrapped.isReportServiceConnectivityError = true;

  return wrapped;
};

const runWithReportServiceConfigFallback = async (primaryConfig, operation) => {
  const candidates = getReportServiceConfigCandidates(primaryConfig);
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    try {
      return await operation(candidate);
    } catch (error) {
      lastError = error;

      if (index < candidates.length - 1 && isReportServiceConnectivityError(error)) {
        console.warn('[ReportService] Report Service URL unreachable; retrying fallback URL', {
          failedBaseUrl: normalizeReportServiceBaseUrl(candidate.baseUrl),
          fallbackBaseUrl: normalizeReportServiceBaseUrl(candidates[index + 1].baseUrl),
          code: error.code || error.cause?.code || '',
        });
        continue;
      }

      throw error;
    }
  }

  throw lastError;
};

const hashSecret = (value) =>
  crypto.createHash('sha256').update(String(value || '')).digest('hex');

const getReportSessionKey = (config) => [
  config.baseUrl,
  config.username,
  hashSecret(config.password),
  config.companyDb,
  config.dbInstance,
].map((value) => String(value || '').trim().toLowerCase()).join('|');

const ensureReportLoginConfig = (config) => {
  const requiredFields = [
    ['baseUrl', 'Report Service Base Url'],
    ['username', 'Report Service Username'],
    ['password', 'Report Service Password'],
    ['companyDb', 'Report Service Company Db'],
  ];
  const missingFields = requiredFields
    .filter(([key]) => !String(config[key] || '').trim())
    .map(([, label]) => label);

  if (missingFields.length) {
    const sourceSummary = requiredFields
      .map(([key, label]) => `${label}: ${config.fieldSources?.[key] || 'unknown'}`)
      .join(', ');
    const error = new Error(
      `Missing SAP Report Service login configuration (${missingFields.join(', ')}). Enter these values in Admin Panel > Companies > SAP Report Service for the selected company. Current sources: ${sourceSummary}.`,
    );
    error.statusCode = 500;
    throw error;
  }
};

const buildCredentialSourceSummary = (config) => {
  const fieldSources = config.fieldSources || {};
  const usernameSource = fieldSources.username || 'configured';
  const passwordSource = fieldSources.password || 'configured';
  const companyDbSource = fieldSources.companyDb || 'configured';

  return `username from ${usernameSource}, password from ${passwordSource}, company DB from ${companyDbSource}`;
};

const getHttpStatusText = (status) => {
  if (Number(status) === 401) return '401 Unauthorized';
  if (Number(status) === 403) return '403 Forbidden';
  return status ? `HTTP ${status}` : 'an authorization error';
};

const decorateReportServiceAuthorizationError = (error, action, config) => {
  const status = Number(error?.response?.status);
  if (![401, 403].includes(status)) {
    return error;
  }

  const companyDb = String(config.companyDb || '').trim() || 'the configured company';
  const credentialSource = buildCredentialSourceSummary(config);
  const sapMessage = extractReportServiceMessage(error.response?.data);
  const statusText = getHttpStatusText(status);
  const message = sapMessage ? ` SAP said: ${sapMessage}` : '';
  const wrapped = new Error(
    `SAP Report Service rejected the request with ${statusText} while trying to ${action} for company ${companyDb} (${credentialSource}). ` +
    `Check Admin Panel > Companies > SAP Report Service credentials, company DB, and report permissions.${message}`,
  );

  wrapped.statusCode = 502;
  wrapped.code = 'REPORT_SERVICE_AUTH_FAILED';
  wrapped.cause = error;
  return wrapped;
};

const summarizeReportServicePayload = (payload) => {
  const parsedPayload = parseLoginPayload(payload);
  const sapMessage = extractReportServiceMessage(parsedPayload);

  if (sapMessage) {
    return sapMessage;
  }

  if (typeof parsedPayload === 'string') {
    return parsedPayload.trim().replace(/\s+/g, ' ').slice(0, 500);
  }

  if (parsedPayload && typeof parsedPayload === 'object') {
    try {
      return JSON.stringify(parsedPayload).replace(/\s+/g, ' ').slice(0, 500);
    } catch (_error) {
      return '';
    }
  }

  return '';
};

const decorateReportServiceHttpError = (error, action, config, context = {}) => {
  const status = Number(error?.response?.status);
  if (!status || [401, 403].includes(status)) {
    return error;
  }

  const statusText = getHttpStatusText(status);
  const companyDb = String(config.companyDb || '').trim() || 'the configured company';
  const baseUrl = normalizeReportServiceBaseUrl(config.baseUrl);
  const docCode = String(context.docCode || '').trim();
  const layoutName = String(context.layoutName || '').trim();
  const detail = summarizeReportServicePayload(error.response?.data);
  const layoutText = docCode
    ? ` Layout ${docCode}${layoutName ? ` (${layoutName})` : ''}.`
    : '';
  const detailText = detail ? ` SAP said: ${detail}` : '';
  const wrapped = new Error(
    `SAP Report Service returned ${statusText} while trying to ${action} for company ${companyDb} at ${baseUrl}.${layoutText}${detailText}`,
  );

  wrapped.statusCode = 502;
  wrapped.code = `REPORT_SERVICE_HTTP_${status}`;
  wrapped.cause = error;
  wrapped.details = {
    upstreamStatus: status,
    docCode: docCode || undefined,
    layoutName: layoutName || undefined,
    reportCompanyDb: companyDb,
    reportServiceBaseUrl: baseUrl,
  };

  return wrapped;
};

const loginToReportServiceWithConfig = async (reportConfig) => {
  const normalizedCompanyDb = String(reportConfig.companyDb || '').trim();
  const normalizedDbInstance = String(reportConfig.dbInstance || '').trim();
  ensureReportLoginConfig(reportConfig);

  let response;
  const loginPayload = {
    CompanyDB: normalizedCompanyDb,
    UserName: reportConfig.username,
    Password: reportConfig.password,
  };

  if (normalizedDbInstance) {
    loginPayload.DBInstance = normalizedDbInstance;
  }

  try {
    await assertReportServiceReachable(reportConfig);
    response = await getReportClient(reportConfig).post('/login', loginPayload);
  } catch (error) {
    throw decorateReportServiceConnectionError(
      decorateReportServiceHttpError(
        decorateReportServiceAuthorizationError(error, 'log in', reportConfig),
        'log in',
        reportConfig,
      ),
      'log in',
      reportConfig,
    );
  }

  const sessionCookie = extractCookieHeader(response.headers['set-cookie']);

  if (!sessionCookie) {
    const sapMessage = extractReportServiceMessage(response.data);
    const credentialSource = buildCredentialSourceSummary(reportConfig);
    const detail = sapMessage
      ? `SAP Report Service login failed for company ${normalizedCompanyDb} (${credentialSource}). Check Admin Panel > Companies > SAP Report Service and retry. SAP said: ${sapMessage}`
      : `SAP Report Service login did not return a session cookie for company ${normalizedCompanyDb} (${credentialSource}).`;
    const error = new Error(detail);
    error.statusCode = 502;
    throw error;
  }

  const responsePayload = parseLoginPayload(response.data);
  const sessionTimeoutMinutes = Number(responsePayload?.SessionTimeout);
  const ttlMinutes = Number.isFinite(sessionTimeoutMinutes) && sessionTimeoutMinutes > 0
    ? sessionTimeoutMinutes
    : 30;

  reportSessionsByCompany.set(getReportSessionKey(reportConfig), {
    cookie: sessionCookie,
    expiresAt: Date.now() + Math.max(ttlMinutes - 1, 1) * 60 * 1000,
  });

  return sessionCookie;
};

const loginToReportService = async (companyDb = '') => {
  const reportConfig = await resolveReportServiceConfig(companyDb);

  return runWithReportServiceConfigFallback(reportConfig, loginToReportServiceWithConfig);
};

const ensureReportSessionWithConfig = async (reportConfig) => {
  const sessionKey = getReportSessionKey(reportConfig);
  const session = reportSessionsByCompany.get(sessionKey);

  if (!session?.cookie || Date.now() >= session.expiresAt) {
    return loginToReportServiceWithConfig(reportConfig);
  }

  return session.cookie;
};

const ensureReportSession = async (companyDb = '') => {
  const reportConfig = await resolveReportServiceConfig(companyDb);

  return runWithReportServiceConfigFallback(reportConfig, ensureReportSessionWithConfig);
};

const toRequiredString = (value, fieldName) => {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    const error = new Error(`${fieldName} is required.`);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

const toRequiredPositiveIntegerString = (value, fieldName) => {
  const normalized = toRequiredString(value, fieldName);

  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
    const error = new Error(`${fieldName} must be a valid positive internal document key.`);
    error.statusCode = 400;
    throw error;
  }

  return normalized;
};

const buildFileName = ({ docEntry, docCode }) => `sales-order-${docEntry}-${docCode}.pdf`;

const DOCUMENT_TYPE_LABELS = new Map([
  ['RDR', 'Sales Order'],
  ['POR', 'Purchase Order'],
  ['PRQ', 'Purchase Request'],
  ['PQT', 'Purchase Quotation'],
  ['PCH', 'A/P Invoice'],
  ['PDN', 'Goods Receipt PO'],
  ['DLN', 'Delivery'],
  ['QUT', 'Sales Quotation'],
  ['INV', 'A/R Invoice'],
  ['RIN', 'A/R Credit Memo'],
  ['RPC', 'A/P Credit Memo'],
  ['IGN', 'Goods Receipt'],
  ['IGE', 'Goods Issue'],
  ['WTR', 'Inventory Transfer'],
  ['WTQ', 'Inventory Transfer Request'],
]);

const getLayoutMetadata = async (docCode, databaseName = '') => {
  const normalizedDocCode = String(docCode || '').trim();
  if (!normalizedDocCode) {
    return null;
  }

  const result = await dbService.query(`
    SELECT TOP 1 DocCode, DocName, TypeCode, Category, Status
    FROM RDOC
    WHERE DocCode = @docCode
  `, { docCode: normalizedDocCode }, databaseName ? { databaseName } : {});

  return result.recordset?.[0] || null;
};

const getDocumentTypeLabel = (typeCode) => {
  const prefix = String(typeCode || '').trim().slice(0, 3).toUpperCase();
  return DOCUMENT_TYPE_LABELS.get(prefix) || String(typeCode || '').trim() || 'document';
};

const isDocumentPrintLayout = (layoutMetadata) => {
  const typeCode = String(layoutMetadata?.TypeCode || '').trim().toUpperCase();
  const prefix = typeCode.slice(0, 3);
  return DOCUMENT_TYPE_LABELS.has(prefix);
};

const resolveXsdType = (type) => {
  const normalized = String(type || '').trim().toLowerCase();

  if (normalized === 'number' || normalized === 'numeric' || normalized === 'int' || normalized === 'xsd:number') {
    return 'xsd:number';
  }

  if (normalized === 'date' || normalized === 'xsd:date') {
    return 'xsd:date';
  }

  if (normalized === 'datetime' || normalized === 'xsd:datetime') {
    return 'xsd:dateTime';
  }

  if (normalized.startsWith('xsd:')) {
    return normalized;
  }

  return 'xsd:string';
};

const normalizeReportParameterValue = (value, type) => {
  if (value == null) {
    return '';
  }

  if (resolveXsdType(type) === 'xsd:number') {
    return Number(value);
  }

  return String(value);
};

const normalizeParameterNameKey = (value) =>
  String(value || '')
    .split(/@select/i)[0]
    .replace(/@/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

const isDocEntryParameter = (parameterName) => {
  const key = normalizeParameterNameKey(parameterName);
  return [
    'dockey',
    'docentry',
    'documentkey',
    'documententry',
    'documentid',
  ].includes(key) || [
    'dockey',
    'docentry',
    'documentkey',
    'documententry',
    'documentid',
  ].some((candidate) => key.endsWith(candidate));
};

const isDocNumParameter = (parameterName) => {
  const key = normalizeParameterNameKey(parameterName);
  return [
    'docnum',
    'documentnumber',
    'documentno',
    'docno',
  ].includes(key);
};

const isObjectTypeParameter = (parameterName) => {
  const key = normalizeParameterNameKey(parameterName);
  return [
    'objectid',
    'objecttype',
    'objtype',
    'boobjecttype',
    'doctype',
    'documenttype',
  ].includes(key) || [
    'objectid',
    'objecttype',
    'objtype',
    'boobjecttype',
  ].some((candidate) => key.endsWith(candidate));
};

const isSchemaParameter = (parameterName) => {
  const key = normalizeParameterNameKey(parameterName);
  return [
    'schema',
    'schemaname',
    'database',
    'databasename',
    'dbname',
    'companydb',
    'companydatabase',
  ].includes(key) || [
    'schema',
    'schemaname',
    'database',
    'databasename',
    'companydb',
    'companydatabase',
  ].some((candidate) => key.endsWith(candidate));
};

const hasSchemaParameter = (parameters = []) =>
  parameters.some((parameter) => isSchemaParameter(parameter.paramName || parameter.name));

const isCardCodeParameter = (parameterName) => {
  const key = normalizeParameterNameKey(parameterName);
  if (!key || key.includes('name')) return false;

  return [
    'card',
    'cardcode',
    'bp',
    'bpcode',
    'businesspartner',
    'businesspartnercode',
    'customer',
    'customercode',
    'custcode',
    'buyer',
    'buyercode',
    'vendor',
    'vendorcode',
    'supplier',
    'suppliercode',
  ].includes(key);
};

const isDocumentPrintSystemParameter = (parameterName) =>
  isDocEntryParameter(parameterName) ||
  isSchemaParameter(parameterName) ||
  isObjectTypeParameter(parameterName) ||
  isCardCodeParameter(parameterName) ||
  isDocNumParameter(parameterName);

const resolveDocumentParameterValue = (parameterName, context) => {
  if (isDocEntryParameter(parameterName)) {
    return context.docKeyValue || context.docEntry;
  }

  if (isSchemaParameter(parameterName)) {
    return context.schema;
  }

  if (isObjectTypeParameter(parameterName)) {
    return context.objectType;
  }

  if (isCardCodeParameter(parameterName)) {
    return context.cardCode;
  }

  if (isDocNumParameter(parameterName)) {
    return context.docNum;
  }

  return undefined;
};

const resolveDocumentParameterType = (parameterName, fallbackType = 'string') => {
  if (isDocEntryParameter(parameterName) || isObjectTypeParameter(parameterName)) {
    return 'number';
  }

  return fallbackType;
};

const addParameterIfMissing = (parameters, parameter) => {
  const key = String(parameter.name || '').trim().toUpperCase();
  if (!key || parameters.some((entry) => String(entry.name || '').trim().toUpperCase() === key)) {
    return;
  }

  parameters.push(parameter);
};

const hasMatchingLayoutParameter = (layoutParameters, predicate) =>
  layoutParameters.some((parameter) => predicate(parameter.paramName || parameter.name));

const buildDocumentPrintParameters = async ({
  docCode,
  docEntry,
  docKeyValue = '',
  docNum = '',
  schema,
  cardCode = '',
  objectType = '',
} = {}) => {
  const normalizedDocEntry = toRequiredPositiveIntegerString(docEntry, 'DocEntry');
  const resolvedDocKeyValue = toRequiredPositiveIntegerString(docKeyValue || normalizedDocEntry, 'DocKey');

  if (resolvedDocKeyValue !== normalizedDocEntry) {
    const error = new Error('Report DocKey parameter must match the currently open document DocEntry.');
    error.statusCode = 400;
    throw error;
  }

  const context = {
    docEntry: normalizedDocEntry,
    docKeyValue: resolvedDocKeyValue,
    docNum: String(docNum || '').trim(),
    schema: String(schema || '').trim(),
    cardCode: String(cardCode || '').trim(),
    objectType: String(objectType || '').trim(),
  };
  const layoutParameters = await loadReportParameters(docCode, { reportCompanyDb: schema });

  const parameters = [];
  layoutParameters.forEach((layoutParameter) => {
    const value = resolveDocumentParameterValue(layoutParameter.paramName, context);
    if (value === undefined || value === '') {
      return;
    }

    addParameterIfMissing(parameters, {
      name: layoutParameter.paramName,
      type: resolveDocumentParameterType(layoutParameter.paramName, layoutParameter.paramType),
      value,
    });
  });

  if (!hasMatchingLayoutParameter(parameters, isDocEntryParameter)) {
    addParameterIfMissing(parameters, {
      name: 'DocKey@',
      type: 'number',
      value: resolvedDocKeyValue,
    });
  }

  return parameters;
};

const buildExportDiagnostics = ({ docCode, layoutMetadata, payload, rawResponse }) => ({
  docCode,
  layout: {
    docName: String(layoutMetadata?.DocName || '').trim(),
    typeCode: String(layoutMetadata?.TypeCode || '').trim(),
    status: String(layoutMetadata?.Status || '').trim(),
  },
  payload,
  rawResponse: String(rawResponse || '').slice(0, 500),
});

const summarizeReportParameters = (parameters = []) =>
  parameters.map((parameter) => ({
    name: String(parameter?.name || '').trim(),
    type: resolveXsdType(parameter?.type),
    value: Array.isArray(parameter?.value) ? parameter.value : parameter?.value,
  }));

const normalizeAdditionalReportParameters = (parameters = []) => {
  if (!Array.isArray(parameters)) {
    return [];
  }

  return parameters
    .map((parameter) => ({
      name: String(parameter?.name || parameter?.paramName || '').trim(),
      type: parameter?.type || parameter?.paramType || 'string',
      value: parameter?.value,
    }))
    .filter((parameter) =>
      parameter.name &&
      !isDocumentPrintSystemParameter(parameter.name) &&
      parameter.value !== undefined &&
      parameter.value !== null &&
      String(parameter.value).trim() !== '',
    );
};

const exportReportPdf = async ({
  docCode,
  parameters = [],
  fileName = '',
  reportCompanyDb = '',
  allowUnavailableLayoutMetadata = false,
} = {}, retryOnAuth = true) => {
  const normalizedDocCode = toRequiredString(docCode || env.reportServiceDefaultDocCode, 'DocCode');
  const reportConfig = await resolveReportServiceConfig(reportCompanyDb);
  const normalizedReportCompanyDb = String(reportConfig.companyDb || '').trim();
  let layoutMetadata;
  let layoutMetadataUnavailable = false;
  try {
    layoutMetadata = await getLayoutMetadata(normalizedDocCode, normalizedReportCompanyDb);
  } catch (error) {
    if (!allowUnavailableLayoutMetadata) throw error;
    layoutMetadataUnavailable = true;
  }
  const hasDocumentKeyParameter = parameters.some((parameter) => isDocEntryParameter(parameter?.name));

  if (!layoutMetadata && !layoutMetadataUnavailable) {
    const error = new Error(`SAP layout ${normalizedDocCode} was not found in RDOC.`);
    error.statusCode = 404;
    throw error;
  }

  if (layoutMetadata && String(layoutMetadata.Status || '').trim().toUpperCase() !== 'A') {
    const error = new Error(`SAP layout ${normalizedDocCode} (${layoutMetadata.DocName || 'Unknown'}) is not active.`);
    error.statusCode = 422;
    throw error;
  }

  if (layoutMetadata && isDocumentPrintLayout(layoutMetadata) && !hasDocumentKeyParameter) {
    const documentTypeLabel = getDocumentTypeLabel(layoutMetadata.TypeCode);
    const error = new Error(
      `SAP layout ${normalizedDocCode} (${layoutMetadata.DocName || 'Unknown'}) is a ${documentTypeLabel} print layout (${layoutMetadata.TypeCode}). It expects document-key parameters like DocKey@ and Schema@, not date-range criteria.`,
    );
    error.statusCode = 422;
    throw error;
  }

  const payload = parameters.map((parameter) => {
    toRequiredString(parameter?.name, 'Parameter name');
    return {
      // LoadCR parameter names may contain significant trailing spaces.
      name: String(parameter.name),
      type: resolveXsdType(parameter?.type),
      value: [[normalizeReportParameterValue(parameter?.value, parameter?.type)]],
    };
  });

  console.info('[ReportService] Exporting Crystal document layout', {
    docCode: normalizedDocCode,
    reportCompanyDb: normalizedReportCompanyDb,
    layout: {
      docName: String(layoutMetadata?.DocName || '').trim(),
      typeCode: String(layoutMetadata?.TypeCode || '').trim(),
      category: String(layoutMetadata?.Category || '').trim(),
    },
    parameterPayload: summarizeReportParameters(parameters),
  });

  const postExport = async (activeReportConfig, allowAuthRetry) => {
    const reportSessionKey = getReportSessionKey(activeReportConfig);
    const reportSessionCookie = await ensureReportSessionWithConfig(activeReportConfig);
    const reportClient = getReportClient(activeReportConfig);

    try {
      return await reportClient.post('/rs/v1/ExportPDFData', payload, {
        params: {
          DocCode: normalizedDocCode,
        },
        headers: {
          Cookie: reportSessionCookie,
        },
      });
    } catch (error) {
      if (allowAuthRetry && error.response?.status === 401) {
        reportSessionsByCompany.delete(reportSessionKey);
        await loginToReportServiceWithConfig(activeReportConfig);
        return postExport(activeReportConfig, false);
      }

      throw decorateReportServiceConnectionError(
        decorateReportServiceHttpError(
          decorateReportServiceAuthorizationError(error, 'export the PDF', activeReportConfig),
          'export the PDF',
          activeReportConfig,
          {
            docCode: normalizedDocCode,
            layoutName: String(layoutMetadata?.DocName || '').trim(),
          },
        ),
        'export the PDF',
        activeReportConfig,
      );
    }
  };

  const response = await runWithReportServiceConfigFallback(
    reportConfig,
    (activeReportConfig) => postExport(activeReportConfig, retryOnAuth),
  );

  const base64Pdf = extractBase64Pdf(response.data);

  if (!base64Pdf) {
    const error = new Error('SAP Report Service returned an empty PDF response.');
    error.statusCode = 502;
    throw error;
  }

  if (isKnownUnsupportedLayoutMessage(base64Pdf)) {
    const error = new Error(`Layout ${normalizedDocCode} is not exportable through the Crystal Report PDF API.`);
    error.statusCode = 422;
    error.diagnostics = buildExportDiagnostics({
      docCode: normalizedDocCode,
      layoutMetadata,
      payload,
      rawResponse: base64Pdf,
    });
    throw error;
  }

  if (isKnownPdfGenerationFailureMessage(base64Pdf)) {
    const error = new Error('SAP Report Service could not generate the PDF for this layout and parameter set.');
    error.statusCode = 422;
    error.diagnostics = buildExportDiagnostics({
      docCode: normalizedDocCode,
      layoutMetadata,
      payload,
      rawResponse: base64Pdf,
    });
    throw error;
  }

  if (!isProbablyBase64(base64Pdf)) {
    const error = new Error(`SAP Report Service returned an unexpected response: ${String(base64Pdf).slice(0, 200)}`);
    error.statusCode = 502;
    error.diagnostics = buildExportDiagnostics({
      docCode: normalizedDocCode,
      layoutMetadata,
      payload,
      rawResponse: base64Pdf,
    });
    throw error;
  }

  return {
    message: 'SAP report PDF generated successfully.',
    base64Pdf,
    mimeType: 'application/pdf',
    fileName: fileName || `${normalizedDocCode}.pdf`,
    docCode: normalizedDocCode,
  };
};

const exportDocumentPdf = async ({
  docEntry,
  docNum = '',
  schema,
  cardCode = '',
  objectType = '',
  docCode,
  documentLabel = 'Document',
  fileName = '',
  reportParameters = [],
} = {}, retryOnAuth = true) => {
  const normalizedDocEntry = toRequiredPositiveIntegerString(docEntry, 'DocEntry');
  const reportConfig = await resolveReportServiceConfig();
  const normalizedSchema = toRequiredString(schema || reportConfig.defaultSchema, 'Schema');
  const normalizedDocCode = toRequiredString(docCode || env.reportServiceDefaultDocCode, 'DocCode');
  const normalizedDocNum = String(docNum || '').trim();
  const normalizedCardCode = String(cardCode || '').trim();
  const normalizedObjectType = String(objectType || '').trim();
  const outputFileName = fileName || `${String(documentLabel || 'document').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${normalizedDocEntry}-${normalizedDocCode}.pdf`;
  const parameters = await buildDocumentPrintParameters({
    docCode: normalizedDocCode,
    docEntry: normalizedDocEntry,
    docKeyValue: normalizedDocEntry,
    docNum: normalizedDocNum,
    schema: normalizedSchema,
    cardCode: normalizedCardCode,
    objectType: normalizedObjectType,
  });
  normalizeAdditionalReportParameters(reportParameters).forEach((parameter) => {
    addParameterIfMissing(parameters, parameter);
  });
  const parametersWithSchemaFallback = hasSchemaParameter(parameters)
    ? parameters
    : [
      ...parameters,
      {
        name: 'Schema@',
        type: 'string',
        value: normalizedSchema,
      },
    ];
  const docKeyParameter = parameters.find((parameter) => isDocEntryParameter(parameter.name));

  console.info('[ReportService] Document print parameters confirmed', {
    documentLabel,
    docEntry: normalizedDocEntry,
    docNum: normalizedDocNum,
    docCode: normalizedDocCode,
    schema: normalizedSchema,
    docKeySource: 'DocEntry',
    docKeyParameter: docKeyParameter?.name || 'DocKey@',
    docKeyParameterValue: String(docKeyParameter?.value ?? '').trim(),
  });

  let genericResponse;

  try {
    genericResponse = await exportReportPdf({
      docCode: normalizedDocCode,
      reportCompanyDb: normalizedSchema,
      parameters,
      fileName: outputFileName,
    }, retryOnAuth);
  } catch (error) {
    if (hasSchemaParameter(parameters) || !error?.code?.startsWith?.('REPORT_SERVICE_HTTP_')) {
      throw error;
    }

    console.warn('[ReportService] Retrying document print with Schema@ fallback after Report Service HTTP failure', {
      documentLabel,
      docEntry: normalizedDocEntry,
      docCode: normalizedDocCode,
      schema: normalizedSchema,
      firstFailure: error.message,
    });

    genericResponse = await exportReportPdf({
      docCode: normalizedDocCode,
      reportCompanyDb: normalizedSchema,
      parameters: parametersWithSchemaFallback,
      fileName: outputFileName,
    }, retryOnAuth);
  }

  return {
    message: `${documentLabel} PDF generated successfully.`,
    base64Pdf: genericResponse.base64Pdf,
    mimeType: 'application/pdf',
    fileName: genericResponse.fileName,
    docEntry: normalizedDocEntry,
    docNum: normalizedDocNum,
    cardCode: normalizedCardCode,
    objectType: normalizedObjectType,
    docKeySource: 'DocEntry',
    docKeyValue: normalizedDocEntry,
    docCode: normalizedDocCode,
    schema: normalizedSchema,
  };
};

const exportSalesOrderPdf = async ({ docEntry, schema, docCode } = {}, retryOnAuth = true) =>
  exportDocumentPdf({
    docEntry,
    schema,
    docCode,
    documentLabel: 'Sales order',
    fileName: buildFileName({
      docEntry: toRequiredString(docEntry, 'DocEntry'),
      docCode: toRequiredString(docCode || env.reportServiceDefaultDocCode, 'DocCode'),
    }),
  }, retryOnAuth);

const parseJsonPayload = (payload) => {
  if (payload == null) {
    return {};
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) {
      return {};
    }

    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      const error = new Error('SAP Report Service returned an invalid JSON response.');
      error.statusCode = 502;
      throw error;
    }
  }

  if (typeof payload === 'object') {
    return payload;
  }

  return {};
};

const loadReportParameters = async (docCode, optionsOrRetry = {}, retryOverride = undefined) => {
  const normalizedDocCode = toRequiredString(docCode, 'DocCode');
  const options = typeof optionsOrRetry === 'object' && optionsOrRetry !== null
    ? optionsOrRetry
    : {};
  const retryOnAuth = typeof optionsOrRetry === 'boolean'
    ? optionsOrRetry
    : (typeof retryOverride === 'boolean' ? retryOverride : true);
  const reportConfig = await resolveReportServiceConfig(options.reportCompanyDb);
  const loadParameters = async (activeReportConfig, allowAuthRetry) => {
    const reportSessionKey = getReportSessionKey(activeReportConfig);
    const reportSessionCookie = await ensureReportSessionWithConfig(activeReportConfig);
    const reportClient = getReportClient(activeReportConfig);

    try {
      return await reportClient.get('/rs/v1/LoadCR', {
        params: {
          DocCode: normalizedDocCode,
        },
        headers: {
          Cookie: reportSessionCookie,
        },
      });
    } catch (error) {
      if (allowAuthRetry && error.response?.status === 401) {
        reportSessionsByCompany.delete(reportSessionKey);
        await loginToReportServiceWithConfig(activeReportConfig);
        return loadParameters(activeReportConfig, false);
      }

      throw decorateReportServiceConnectionError(
        decorateReportServiceHttpError(
          decorateReportServiceAuthorizationError(error, 'load report parameters', activeReportConfig),
          'load report parameters',
          activeReportConfig,
          { docCode: normalizedDocCode },
        ),
        'load report parameters',
        activeReportConfig,
      );
    }
  };

  const response = await runWithReportServiceConfigFallback(
    reportConfig,
    (activeReportConfig) => loadParameters(activeReportConfig, retryOnAuth),
  );

  const payload = parseJsonPayload(response.data);

  if (normalizeBoolean(payload?.error)) {
    const message =
      String(payload?.message || '').trim() ||
      String(payload?.detail || '').trim() ||
      `SAP Report Service could not load parameters for ${normalizedDocCode}.`;
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }

  const rows = Array.isArray(payload?.resultSet) ? payload.resultSet : [];

  return rows
    .map((row, index) => normalizeCrParameter(row, index))
    .filter(Boolean)
    .filter((parameter, index, all) =>
      all.findIndex((candidate) => candidate.paramName.toLowerCase() === parameter.paramName.toLowerCase()) === index,
    );
};

const loadAuthorizedCrList = async (query = '', retryOnAuth = true) => {
  const reportConfig = await resolveReportServiceConfig();
  const loadList = async (activeReportConfig, allowAuthRetry) => {
    const reportSessionKey = getReportSessionKey(activeReportConfig);
    const reportSessionCookie = await ensureReportSessionWithConfig(activeReportConfig);
    const reportClient = getReportClient(activeReportConfig);

    try {
      return await reportClient.get('/rs/v1/LoadAuthorizedCRList', {
        headers: {
          Cookie: reportSessionCookie,
        },
      });
    } catch (error) {
      if (allowAuthRetry && error.response?.status === 401) {
        reportSessionsByCompany.delete(reportSessionKey);
        await loginToReportServiceWithConfig(activeReportConfig);
        return loadList(activeReportConfig, false);
      }

      throw decorateReportServiceConnectionError(
        decorateReportServiceHttpError(
          decorateReportServiceAuthorizationError(error, 'load authorized Crystal layouts', activeReportConfig),
          'load authorized Crystal layouts',
          activeReportConfig,
        ),
        'load authorized Crystal layouts',
        activeReportConfig,
      );
    }
  };

  const response = await runWithReportServiceConfigFallback(
    reportConfig,
    (activeReportConfig) => loadList(activeReportConfig, retryOnAuth),
  );

  const payload = parseJsonPayload(response.data);
  const rows = Array.isArray(payload?.resultSet) ? payload.resultSet : [];
  const search = String(query || '').trim().toLowerCase();

  return rows
    .map((row) => ({
      code: String(row?.code || '').trim(),
      name: String(row?.name || '').trim(),
      rootName: String(row?.root_name || '').trim(),
      rootGuid: String(row?.root_guid || '').trim(),
    }))
    .filter((row) => row.code)
    .filter((row) => {
      if (!search) {
        return true;
      }

      return (
        row.code.toLowerCase().includes(search) ||
        row.name.toLowerCase().includes(search) ||
        row.rootName.toLowerCase().includes(search)
      );
    })
    .sort((left, right) => {
      const byRoot = left.rootName.localeCompare(right.rootName);
      if (byRoot !== 0) return byRoot;

      const byName = left.name.localeCompare(right.name);
      if (byName !== 0) return byName;

      return left.code.localeCompare(right.code);
    });
};

const clearReportSessions = () => {
  reportSessionsByCompany.clear();
};

module.exports = {
  clearReportSessions,
  loadAuthorizedCrList,
  loadReportParameters,
  isProbablyBase64,
  isDocumentPrintSystemParameter,
  buildDocumentPrintParameters,
  exportReportPdf,
  exportDocumentPdf,
  exportSalesOrderPdf,
};
