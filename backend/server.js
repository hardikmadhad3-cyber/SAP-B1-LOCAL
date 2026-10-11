require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const env     = require('./config/env');

if (!env.verboseSapLogs) {
  const originalLog = console.log.bind(console);
  console.debug = () => {};
  console.log = (...args) => {
    const first = String(args[0] ?? '');
    const noisyPatterns = [
      'RECEIVED PAYLOAD',
      'SAP PAYLOAD',
      'Constructed SAP Payload',
      'Validated Payload',
      'Service Layer search result',
      'FINAL CONVERTED VALUES',
      'ODBC Data Loaded',
      'Available Sales Employees',
      'Reference data:',
      'response keys',
      'â•â•â•â•â•â•â•â•',
      'ðŸ”¥',
      'ðŸ”',
      'âœ…',
      'âš ï¸',
    ];

    if (noisyPatterns.some((pattern) => first.includes(pattern))) {
      return;
    }

    originalLog(...args);
  };
}

const {
  authenticateAccessToken,
  authenticateAdminPanelToken,
} = require('./middleware/authMiddleware');
const { runWithRequestContext } = require('./services/requestContextService');
const apiTimingMiddleware = require('./middleware/apiTiming');
const { cacheMiddleware, invalidateCacheMiddleware } = require('./middleware/cacheMiddleware');
const {
  apiRateLimitMiddleware,
  reportRateLimitMiddleware,
  reportSafetyMiddleware,
} = require('./services/safetyControls');

const authRoutes            = require('./routes/authRoutes');
const menuRoutes            = require('./routes/menuRoutes');
const dashboardRoutes       = require('./routes/dashboardRoutes');
const sapRoutes             = require('./routes/sapRoutes');
const itemRoutes            = require('./routes/itemRoutes');
const businessPartnerRoutes = require('./routes/businessPartnerRoutes');
const warehouseRoutes       = require('./routes/warehouseRoutes');
const priceListRoutes       = require('./routes/priceListRoutes');
const taxCodeRoutes         = require('./routes/taxCodeRoutes');
const uomGroupRoutes        = require('./routes/uomGroupRoutes');
const paymentTermsRoutes    = require('./routes/paymentTermsRoutes');
const shippingTypeRoutes    = require('./routes/shippingTypeRoutes');
const branchRoutes          = require('./routes/branchRoutes');
const chartOfAccountsRoutes = require('./routes/chartOfAccountsRoutes');
const purchaseOrderRoutes   = require('./routes/purchaseOrder');
const purchaseQuotationRoutes = require('./routes/purchaseQuotation');
const purchaseRequestRoutes = require('./routes/purchaseRequest');
const salesOrderRoutes      = require('./routes/salesOrder');
const salesDocumentSchemaRoutes = require('./modules/salesDocumentSchema/salesDocumentSchemaRoutes');
const dcSalesOrderRoutes    = require('./routes/dcSalesOrder');
const ncSalesOrderRoutes    = require('./routes/ncSalesOrder');
const sodaSalesOrderRoutes  = require('./routes/sodaSalesOrder');
const salesQuotationRoutes  = require('./routes/salesQuotation');
const blanketAgreementRoutes = require('./routes/blanketAgreement');
const printRoutes           = require('./routes/printRoutes');
const documentPrintRoutes   = require('./routes/documentPrintRoutes');
const reportLayoutRoutes    = require('./routes/reportLayoutRoutes');
const companyReportsRoutes = require('./routes/companyReportsRoutes');
const salesAnalysisRoutes   = require('./routes/salesAnalysisRoutes');
const opportunitiesForecastRoutes = require('./routes/opportunitiesForecastRoutes');
const bomRoutes             = require('./routes/bomRoutes');
const productionOrderRoutes    = require('./routes/productionOrder');
const issueForProductionRoutes   = require('./routes/issueForProduction');
const receiptFromProductionRoutes = require('./routes/receiptFromProduction');
const grpoRoutes                 = require('./routes/grpo');
const deliveryRoutes             = require('./routes/delivery');
const dcDeliveryRoutes           = require('./routes/dcDelivery');
const ncDeliveryRoutes           = require('./routes/ncDelivery');
const sodaDeliveryRoutes         = require('./routes/sodaDelivery');
const apInvoiceRoutes            = require('./routes/apInvoice');
const arInvoiceRoutes            = require('./routes/arInvoice');
const serviceArInvoiceRoutes      = require('./routes/serviceArInvoice');
const serviceApInvoiceRoutes      = require('./routes/serviceApInvoice');
const serviceApCreditMemoRoutes   = require('./routes/serviceApCreditMemo');
const serviceArCreditMemoRoutes   = require('./routes/serviceArCreditMemo');
const journalEntryRoutes           = require('./routes/journalEntryRoutes');
const incomingPaymentsRoutes      = require('./routes/incomingPayments');
const outgoingPaymentsRoutes      = require('./routes/outgoingPayments');
const apCreditMemoRoutes         = require('./routes/apCreditMemo');
const arCreditMemoRoutes         = require('./routes/arCreditMemo');
const hsnCodeRoutes              = require('./routes/hsnCodeRoutes');
const goodsReceiptRoutes         = require('./routes/goodsReceipt');
const goodsReceiptController     = require('./controllers/goodsReceiptController');
const goodsIssueRoutes           = require('./routes/goodsIssue');
const inventoryTransferRequestRoutes = require('./routes/inventoryTransferRequest');
const inventoryTransferRoutes    = require('./routes/inventoryTransfer');
const purchaseAnalysisRoutes     = require('./routes/reports/purchaseAnalysis.routes');
const activityOverviewRoutes     = require('./routes/reports/activityOverview.routes');
const campaignsListRoutes        = require('./routes/reports/campaignsList.routes');
const inactiveCustomersRoutes    = require('./routes/reports/inactiveCustomers.routes');
const purchaseRequestReportRoutes = require('./routes/reports/purchaseRequestReport.routes');
const itemListReportRoutes       = require('./routes/reports/itemListReport.routes');
const productionOpenItemsRoutes  = require('./routes/reports/productionOpenItems.routes');
const billOfMaterialsReportRoutes = require('./routes/reports/billOfMaterials.routes');
const inventoryPostingListRoutes = require('./routes/reports/inventoryPostingList.routes');
const inventoryInWarehouseRoutes = require('./routes/reports/inventoryInWarehouse.routes');
const inventoryAuditRoutes       = require('./routes/reports/inventoryAudit.routes');
const inventoryAgingRoutes       = require('./routes/reports/inventoryAging.routes');
const glAccountsBusinessPartnersRoutes = require('./routes/reports/glAccountsBusinessPartners.routes');
const generalLedgerRoutes        = require('./routes/reports/generalLedger.routes');
const customerReceivablesAgingRoutes = require('./routes/reports/customerReceivablesAging.routes');
const vendorLiabilitiesAgingRoutes = require('./routes/reports/vendorLiabilitiesAging.routes');
const accountingTransactionReportsRoutes = require('./routes/reports/accountingTransactionReports.routes');
const financialStatementsRoutes  = require('./routes/reports/financialStatements.routes');
const reportStudioRoutes         = require('./routes/reportStudioRoutes');
const reportLookupsRoutes        = require('./routes/reportLookups');
const adminPanelRoutes           = require('./routes/adminPanelRoutes');
const performanceRoutes          = require('./routes/performanceRoutes');
const formSettingsRoutes         = require('./routes/formSettings');
const generalSettingsRoutes      = require('./routes/generalSettingsRoutes');
const predefinedTextRoutes       = require('./routes/predefinedTextRoutes');
const relationshipMapRoutes      = require('./routes/relationshipMap');
const sapDocumentLayoutRoutes    = require('./routes/sapDocumentLayout');
const queryManagerRoutes         = require('./routes/queryManagerRoutes');
const jobWorkRoutes              = require('./routes/jobWork');
const gatePassRoutes             = require('./routes/gatePass');
const qcRoutes                   = require('./routes/qcRoutes');
const whatsappRoutes             = require('./routes/whatsappRoutes');
const whatsappWebhookRoutes      = require('./routes/whatsappWebhookRoutes');

const app = express();

const masterDataCache = (namespace, ttlSeconds) => [
  cacheMiddleware({ namespace, ttlSeconds }),
  invalidateCacheMiddleware(namespace),
];

const isReusableLookupRequest = (req) => {
  if (req.method !== 'GET') return false;

  const path = req.path.toLowerCase();
  const isDocumentLayoutRequest = path === '/sap/layout/document' || path === '/api/sap/layout/document';
  const isForcedLiveLayoutRead = isDocumentLayoutRequest
    && ['1', 'true', 'yes'].includes(String(req.query?.refresh || '').trim().toLowerCase());
  if (isForcedLiveLayoutRead) return false;
  const isNextNumberRoute =
    path.includes('/next-number') ||
    path.endsWith('/series/next') ||
    /\/lookup\/series\/[^/]+\/next$/.test(path);

  if (isNextNumberRoute) return false;

  return (
    path.endsWith('/reference-data') ||
    path.endsWith('/lookups') ||
    isDocumentLayoutRequest ||
    path.startsWith('/api/hsn-codes') ||
    path.includes('/lookup/') ||
    path.endsWith('/metadata') ||
    path.endsWith('/items-modal') ||
    path.endsWith('/freight-charges') ||
    path.endsWith('/print-layouts') ||
    path.includes('/warehouse-state') ||
    path.includes('/state-from-address')
  );
};

const reusableLookupCache = cacheMiddleware({
  namespace: (req) => `lookup:${req.path.toLowerCase()}`,
  ttlSeconds: 1800,
  shouldCache: isReusableLookupRequest,
});

const isAllowedOrigin = (origin, requestHost = '') => {
  if (!origin) return true;

  try {
    const { protocol, hostname, port } = new URL(origin);
    const originHost = `${hostname}${port ? `:${port}` : ''}`.toLowerCase();
    const normalizedRequestHost = String(requestHost || '').trim().toLowerCase();

    // The frontend served by this backend may be reached through a public IP
    // address or DNS name forwarded by a router. That exact same-origin request
    // is trusted without opening access to unrelated external websites.
    if (normalizedRequestHost && originHost === normalizedRequestHost) return true;

    // Explicitly listed origins from ALLOWED_ORIGINS take priority.
    if (env.allowedOrigins.includes(origin)) return true;

    const allowedPorts = new Set(['3000', '3001', String(env.port)]);
    if (protocol !== 'http:' || !allowedPorts.has(port)) return false;

    const isPrivateLanHost =
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);

    return hostname === 'localhost' || hostname === '127.0.0.1' || isPrivateLanHost;
  } catch (_error) {
    return false;
  }
};

const redactSensitiveFields = (value) => {
  if (!value || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, fieldValue]) => {
      if (/(password|token|secret)/i.test(key)) {
        return [key, '[REDACTED]'];
      }

      return [key, redactSensitiveFields(fieldValue)];
    }),
  );
};

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED_REJECTION]', reason);
});

process.on('uncaughtException', (error, origin) => {
  console.error('[UNCAUGHT_EXCEPTION]', origin || 'unknown');
  console.error(error?.stack || error?.message || error);
});

app.use((req, res, next) => {
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin, req.headers.host)) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })(req, res, next);
});

// Ensure Authorization header is allowed in CORS preflight responses
// so frontend clients can send Bearer tokens from browsers.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});
app.use(express.json({
  verify(req, _res, buffer) {
    const requestPath = String(req.originalUrl || '').split('?')[0];
    if (requestPath === '/api/whatsapp/webhook') {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use((req, res, next) => runWithRequestContext(req, next));
// Meta calls this exact endpoint without an application access token. POST payloads
// are accepted only when their HMAC signature matches WHATSAPP_APP_SECRET.
app.use('/api/whatsapp', apiRateLimitMiddleware, whatsappWebhookRoutes);
app.use(apiTimingMiddleware);

// Request logging middleware
app.use((req, res, next) => {
  const isWriteRequest = req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT';
  if (isWriteRequest) {
    console.log(`[${req.method}] ${req.path}`);
    console.log('Request body:', JSON.stringify(redactSensitiveFields(req.body), null, 2));
  } else if (env.verboseRequestLogs) {
    console.log(`[${req.method}] ${req.path}`);
  }
  next();
});

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (!req.path.startsWith('/api')) return next();
  if (
    req.path === '/api/login' ||
    req.path === '/api/admin-login' ||
    req.path === '/api/companies-public' ||
    req.path === '/api/select-company' ||
    req.path.startsWith('/api/companies/')
  ) {
    return next();
  }
  if (req.path.startsWith('/api/admin-panel')) {
    return authenticateAdminPanelToken(req, res, next);
  }
  return authenticateAccessToken(req, res, next);
});

app.use('/api', apiRateLimitMiddleware);
app.use('/api/reports', reportRateLimitMiddleware, reportSafetyMiddleware);
app.use('/api', reusableLookupCache);

// Routes
app.use('/api',                    authRoutes);
app.use('/api/menu',               menuRoutes);
app.use('/api/dashboard',
  cacheMiddleware({
    namespace: 'dashboard',
    ttlSeconds: 45,
    shouldCache: (req) => String(req.query.refresh || '') !== '1',
  }),
  dashboardRoutes,
);
app.get('/api/items',              cacheMiddleware({ namespace: 'items', ttlSeconds: 3600 }), goodsReceiptController.getItems);
app.use('/api/items',              ...masterDataCache('items', 3600), itemRoutes);
app.use('/api/business-partners',  ...masterDataCache('business-partners', 3600), businessPartnerRoutes);
app.get('/api/warehouses',         cacheMiddleware({ namespace: 'warehouses', ttlSeconds: 7200 }), goodsReceiptController.getWarehouses);
app.use('/api/warehouses',         ...masterDataCache('warehouses', 7200), warehouseRoutes);
app.use('/api/price-lists',        ...masterDataCache('price-lists', 3600), priceListRoutes);
app.use('/api/tax-codes',          ...masterDataCache('tax-codes', 14400), taxCodeRoutes);
app.use('/api/uom-groups',         ...masterDataCache('uom-groups', 14400), uomGroupRoutes);
app.use('/api/payment-terms',      ...masterDataCache('payment-terms', 14400), paymentTermsRoutes);
app.use('/api/shipping-types',     ...masterDataCache('shipping-types', 14400), shippingTypeRoutes);
app.use('/api/branches',           ...masterDataCache('branches', 28800), branchRoutes);
app.use('/api/chart-of-accounts',  ...masterDataCache('chart-of-accounts', 28800), chartOfAccountsRoutes);
app.get('/api/series',             goodsReceiptController.getSeries);
app.get('/api/purchase-orders',    goodsReceiptController.getPurchaseOrders);
app.use('/api/purchase-order',     purchaseOrderRoutes);
app.use('/api/purchase-quotation', purchaseQuotationRoutes);
app.use('/api/purchase-request',   purchaseRequestRoutes);
app.use('/api/sales-order',        salesOrderRoutes);
app.use('/api/sales-document',     salesDocumentSchemaRoutes);
app.use('/api/dc-sales-order',     dcSalesOrderRoutes);
app.use('/api/nc-sales-order',     ncSalesOrderRoutes);
app.use('/api/soda-sales-order',   sodaSalesOrderRoutes);
app.use('/api/sales-quotation',    salesQuotationRoutes);
app.use('/api/blanket-agreements', blanketAgreementRoutes);
app.use('/api',                    printRoutes);
app.use('/api/document-print',     documentPrintRoutes);
app.use('/api',                    reportLayoutRoutes);
app.use('/api',                    companyReportsRoutes);
app.use('/api',                    reportStudioRoutes);
app.use('/api/reports',            salesAnalysisRoutes);
app.use('/api/reports',            opportunitiesForecastRoutes);
app.use('/api/bom',                bomRoutes);
app.use('/api/production-order',   productionOrderRoutes);
app.use('/api/issue-for-production',    issueForProductionRoutes);
app.use('/api/receipt-from-production', receiptFromProductionRoutes);
app.use('/api/grpo',               grpoRoutes);
app.use('/api/delivery',           deliveryRoutes);
app.use('/api/dc-delivery',        dcDeliveryRoutes);
app.use('/api/nc-delivery',        ncDeliveryRoutes);
app.use('/api/soda-delivery',      sodaDeliveryRoutes);
app.use('/api/ap-invoice',         apInvoiceRoutes);
app.use('/api/ar-invoice',         arInvoiceRoutes);
app.use('/api/services/ar-invoice', serviceArInvoiceRoutes);
app.use('/api/services/ap-invoice', serviceApInvoiceRoutes);
app.use('/api/services/ap-credit-memo', serviceApCreditMemoRoutes);
app.use('/api/services/ar-credit-memo', serviceArCreditMemoRoutes);
app.use('/api/journal-entry',      journalEntryRoutes);
app.use('/api/incoming-payments',  incomingPaymentsRoutes);
app.use('/api/outgoing-payments',  outgoingPaymentsRoutes);
app.use('/api/ap-credit-memo',     apCreditMemoRoutes);
app.use('/api/ar-credit-memo',     arCreditMemoRoutes);
app.use('/api/hsn-codes',          hsnCodeRoutes);
app.use('/api/goods-receipt',      goodsReceiptRoutes);
app.use('/api/goods-issue',        goodsIssueRoutes);
app.use('/api/inventory-transfer-request', inventoryTransferRequestRoutes);
app.use('/api/inventory-transfer', inventoryTransferRoutes);
app.use('/api/reports',            purchaseAnalysisRoutes);
app.use('/api/reports',            activityOverviewRoutes);
app.use('/api/reports',            campaignsListRoutes);
app.use('/api/reports',            inactiveCustomersRoutes);
app.use('/api/reports',            purchaseRequestReportRoutes);
app.use('/api/reports',            itemListReportRoutes);
app.use('/api/reports',            productionOpenItemsRoutes);
app.use('/api/reports',            billOfMaterialsReportRoutes);
app.use('/api/reports',            inventoryPostingListRoutes);
app.use('/api/reports',            inventoryInWarehouseRoutes);
app.use('/api/reports',            inventoryAuditRoutes);
app.use('/api/reports',            inventoryAgingRoutes);
app.use('/api/reports',            glAccountsBusinessPartnersRoutes);
app.use('/api/reports',            generalLedgerRoutes);
app.use('/api/reports',            customerReceivablesAgingRoutes);
app.use('/api/reports',            vendorLiabilitiesAgingRoutes);
app.use('/api/reports',            accountingTransactionReportsRoutes);
app.use('/api/reports',            financialStatementsRoutes);
app.use('/api',                    financialStatementsRoutes);
app.use('/api/lookups',            reportLookupsRoutes);
app.use('/api/admin-panel',        adminPanelRoutes);
app.use('/api/performance',        performanceRoutes);
app.use('/api/form-settings',      formSettingsRoutes);
app.use('/api/general-settings',   generalSettingsRoutes);
app.use('/api/predefined-texts',   predefinedTextRoutes);
app.use('/api/relationship-map',   relationshipMapRoutes);
app.use('/api/sap/layout',         sapDocumentLayoutRoutes);
app.use('/api/query-manager',      queryManagerRoutes);
app.use('/api/job-work',           jobWorkRoutes);
app.use('/api/gate-pass',          gatePassRoutes);
app.use('/api/qc',                 qcRoutes);
app.use('/api/whatsapp',           whatsappRoutes);
app.use('/api',                    sapRoutes);

// Health check
app.get('/health', (_req, res) =>
  res.json({
    status: 'ok',
    message: 'Backend is running',
    host: '0.0.0.0',
    port: env.port,
  }));

// SAP connection debug â€” remove in production
app.get('/api/debug/production-orders', async (_req, res) => {
  try {
    const sapService = require('./services/sapService');
    await sapService.ensureSession();
    const resp = await sapService.request({
      method: 'GET',
      url: `/ProductionOrders?$select=DocEntry,DocNum,ItemNo,ProductionOrderStatus&$top=5`,
    });
    res.json({ ok: true, count: resp.data?.value?.length, sample: resp.data?.value });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.response?.data || e.message });
  }
});

// Serve static files from the React frontend build for single-port LAN access
const path = require('path');
const fs = require('fs');
const frontendBuildPath = path.join(__dirname, '../frontend/build');

app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return next();
  if (!/\.(js|css|html|svg)$/.test(req.path)) return next();

  const requestedPath = path.normalize(path.join(frontendBuildPath, decodeURIComponent(req.path)));
  if (!requestedPath.startsWith(frontendBuildPath)) return next();

  const gzipPath = `${requestedPath}.gz`;
  if (!fs.existsSync(gzipPath)) return next();

  if (requestedPath.includes(`${path.sep}static${path.sep}`)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.set('Cache-Control', 'no-cache');
  }

  res.set('Content-Encoding', 'gzip');
  res.set('Vary', 'Accept-Encoding');
  res.type(requestedPath);
  return res.sendFile(gzipPath);
});

app.use(express.static(frontendBuildPath, {
  setHeaders(res, filePath) {
    if (filePath.includes(`${path.sep}static${path.sep}`)) {
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }

    res.set('Cache-Control', 'no-cache');
  },
}));

// Catch-all route to serve the React index.html for frontend routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(frontendBuildPath, 'index.html'));
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  console.error('[ERROR_STACK]', err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    details: err.details || undefined,
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

const server = app.listen(env.port, '0.0.0.0', () => {
  console.log(`[Server] Running on http://0.0.0.0:${env.port} (accessible on LAN)`);
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.log(`[SERVER_INFO] Port ${env.port} is already in use. Another backend instance is already running, so this duplicate start will close.`);
    process.exit(0);
    return;
  }

  console.error('[SERVER_ERROR]', error?.stack || error?.message || error);
});
