const env = require('../config/env');
const { getRequestContext } = require('./requestContextService');

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const config = {
  apiRateWindowMs: toPositiveInt(process.env.API_RATE_WINDOW_MS, 60_000),
  apiRateMax: toPositiveInt(process.env.API_RATE_MAX, 180),
  reportRateWindowMs: toPositiveInt(process.env.REPORT_RATE_WINDOW_MS, 60_000),
  // Each report page loads 4-5 lookups on open; 20 a minute blocked normal browsing.
  reportRateMax: toPositiveInt(process.env.REPORT_RATE_MAX, 60),
  dbConcurrency: toPositiveInt(process.env.DB_QUERY_CONCURRENCY_LIMIT, 6),
  sapConcurrency: toPositiveInt(process.env.SAP_REQUEST_CONCURRENCY_LIMIT, 4),
  queueLimit: toPositiveInt(process.env.BACKEND_SAFETY_QUEUE_LIMIT, 100),
  slowDbMs: toPositiveInt(process.env.SLOW_DB_QUERY_MS, 3_000),
  slowSapMs: toPositiveInt(process.env.SLOW_SAP_REQUEST_MS, 5_000),
};

const rateBuckets = new Map();

const sanitizePath = (value = '') => String(value || '').split('?')[0].slice(0, 200);

const getRequestInfo = () => {
  const req = getRequestContext()?.req;
  return {
    req,
    path: req?.originalUrl || req?.path || '',
    method: req?.method || '',
    userId: req?.auth?.userId || 'anonymous',
    companyId: req?.auth?.companyId || 'public',
    ip: req?.ip || req?.socket?.remoteAddress || 'unknown',
  };
};

const getRateKey = (req, scope) => [
  scope,
  req.auth?.userId || req.ip || req.socket?.remoteAddress || 'anonymous',
  req.auth?.companyId || 'public',
].join(':');

const createRateLimitMiddleware = ({ scope, windowMs, max }) => (req, res, next) => {
  const now = Date.now();
  const key = getRateKey(req, scope);
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }

  current.count += 1;
  if (current.count <= max) {
    return next();
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  res.set('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({
    message: 'Too many requests. Please wait a moment before trying again.',
  });
};

const apiRateLimitMiddleware = createRateLimitMiddleware({
  scope: 'api',
  windowMs: config.apiRateWindowMs,
  max: config.apiRateMax,
});

const reportRateLimitMiddleware = createRateLimitMiddleware({
  scope: 'report',
  windowMs: config.reportRateWindowMs,
  max: config.reportRateMax,
});

const createLimiter = (name, maxActive) => {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= maxActive || queue.length === 0) return;
    const item = queue.shift();
    active += 1;

    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };

  return (task) => new Promise((resolve, reject) => {
    if (queue.length >= config.queueLimit) {
      const error = new Error(`${name} is busy. Please try again in a few seconds.`);
      error.status = 503;
      reject(error);
      return;
    }

    queue.push({ task, resolve, reject });
    runNext();
  });
};

const dbLimiter = createLimiter('Database', config.dbConcurrency);
const sapLimiter = createLimiter('SAP Service Layer', config.sapConcurrency);

const previewSql = (sqlText = '') => String(sqlText || '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 500);

const logSlowOperation = ({ type, startedAt, thresholdMs, label, detail }) => {
  const durationMs = Date.now() - startedAt;
  if (durationMs < thresholdMs) return;

  const request = getRequestInfo();
  console.warn(`[SLOW_${type}] ${durationMs}ms ${request.method} ${sanitizePath(request.path)} user=${request.userId} company=${request.companyId} ${label || ''}`, detail || '');
};

const withDatabaseSlot = async (queryStr, task) => {
  const startedAt = Date.now();
  return dbLimiter(async () => {
    try {
      return await task();
    } finally {
      logSlowOperation({
        type: 'DB',
        startedAt,
        thresholdMs: config.slowDbMs,
        label: 'query',
        detail: previewSql(queryStr),
      });
    }
  });
};

const withSapSlot = async (requestConfig, task) => {
  const startedAt = Date.now();
  return sapLimiter(async () => {
    try {
      return await task();
    } finally {
      logSlowOperation({
        type: 'SAP',
        startedAt,
        thresholdMs: config.slowSapMs,
        label: `${String(requestConfig?.method || 'GET').toUpperCase()} ${sanitizePath(requestConfig?.url || '')}`,
      });
    }
  });
};

const text = (value) => String(value || '').trim();
const hasBoth = (from, to) => Boolean(text(from) && text(to));
const hasEnabledRange = (range = {}) => Boolean(range?.enabled && text(range.from) && text(range.to));

const reportSafetyRules = [
  {
    match: /^\/api\/reports\/general-ledger$/i,
    isSafe: (body) => hasEnabledRange(body?.dateRanges?.postingDate),
    message: 'Select Posting Date From and To before running General Ledger.',
  },
  {
    match: /^\/api\/reports\/accounting-transactions\//i,
    isSafe: (body) => hasBoth(body?.postingDateFrom, body?.postingDateTo),
    message: 'Select Posting Date From and To before running this accounting report.',
  },
  {
    match: /^\/api\/reports\/inventory-audit$/i,
    isSafe: (body) => hasBoth(body?.dateFrom, body?.dateTo),
    message: 'Select Date From and To before running Inventory Audit.',
  },
  {
    match: /^\/api\/reports\/inventory-aging$/i,
    isSafe: (body) => Boolean(text(body?.reportDate)),
    message: 'Select Report Date before running Inventory Aging.',
  },
  {
    match: /^\/api\/reports\/customer-receivables-aging$/i,
    isSafe: (body) => Boolean(text(body?.agingDate)),
    message: 'Select Aging Date before running Customer Receivables Aging.',
  },
  {
    match: /^\/api\/reports\/vendor-liabilities-aging$/i,
    isSafe: (body) => Boolean(text(body?.agingDate)),
    message: 'Select Aging Date before running Vendor Liabilities Aging.',
  },
  {
    match: /^\/api\/reports\/campaigns-list$/i,
    isSafe: (body) => hasBoth(body?.startDateFrom, body?.startDateTo) || hasBoth(body?.endDateFrom, body?.endDateTo),
    message: 'Select a Start Date or End Date range before running Campaigns List.',
  },
];

const reportSafetyMiddleware = (req, res, next) => {
  if (req.method !== 'POST') return next();

  const path = sanitizePath(req.originalUrl || req.path);
  const rule = reportSafetyRules.find((item) => item.match.test(path));
  if (!rule || rule.isSafe(req.body || {})) {
    return next();
  }

  return res.status(400).json({ message: rule.message });
};

const getSafetyConfig = () => ({
  ...config,
  env: env.port ? 'loaded' : 'unknown',
});

module.exports = {
  apiRateLimitMiddleware,
  reportRateLimitMiddleware,
  reportSafetyMiddleware,
  withDatabaseSlot,
  withSapSlot,
  getSafetyConfig,
};
