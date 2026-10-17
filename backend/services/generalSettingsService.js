const authDbService = require('./authDbService');
const salesOrderService = require('./salesOrderService');
const deliveryService = require('./deliveryService');
const salesQuotationDbService = require('./salesQuotationDbService');
const arInvoiceDbService = require('./arInvoiceDbService');
const arCreditMemoDbService = require('./arCreditMemoDbService');
const purchaseRequestService = require('./purchaseRequestService');
const purchaseQuotationDbService = require('./purchaseQuotationDbService');
const purchaseOrderDbService = require('./purchaseOrderDbService');
const grpoDbService = require('./grpoDbService');
const apInvoiceDbService = require('./apInvoiceDbService');
const apCreditMemoDbService = require('./apCreditMemoDbService');

const SETTING_KEYS = [
  'salesWarehouse',
  'salesSeries',
  'deliveryWarehouse',
  'deliverySeries',
  'salesQuotationWarehouse',
  'salesQuotationSeries',
  'arInvoiceWarehouse',
  'arInvoiceSeries',
  'arCreditMemoWarehouse',
  'arCreditMemoSeries',
  'purchaseRequestWarehouse',
  'purchaseRequestSeries',
  'purchaseQuotationWarehouse',
  'purchaseQuotationSeries',
  'purchaseOrderWarehouse',
  'purchaseOrderSeries',
  'grpoWarehouse',
  'grpoSeries',
  'apInvoiceWarehouse',
  'apInvoiceSeries',
  'apCreditMemoWarehouse',
  'apCreditMemoSeries',
];

let ensureTablePromise = null;

const ensureTable = async () => {
  if (!ensureTablePromise) {
    ensureTablePromise = authDbService.ensureSchema().catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }

  return ensureTablePromise;
};

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeId = (value, label) => {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw createHttpError(400, `A valid ${label} is required.`);
  }
  return normalized;
};

const emptySettings = () => Object.fromEntries(SETTING_KEYS.map((key) => [key, '']));

const normalizeSettings = (settings = {}) => Object.fromEntries(
  SETTING_KEYS.map((key) => [key, String(settings?.[key] || '').trim()]),
);

const parseSettings = (settingsJson) => {
  try {
    return normalizeSettings(JSON.parse(settingsJson || '{}'));
  } catch (_error) {
    return emptySettings();
  }
};

const ensureAssignment = async (userId, companyId) => {
  const assignment = await authDbService.queryOne(`
    SELECT TOP 1 Id
    FROM dbo.UserCompanies
    WHERE UserId = @userId
      AND CompanyId = @companyId
  `, { userId, companyId });

  if (!assignment) {
    throw createHttpError(400, 'The selected user is not assigned to the selected company.');
  }
};

const getSettings = async (userIdValue, companyIdValue) => {
  const userId = normalizeId(userIdValue, 'user');
  const companyId = normalizeId(companyIdValue, 'company');
  await ensureTable();

  const row = await authDbService.queryOne(`
    SELECT SettingsJson
    FROM dbo.UserGeneralSettings
    WHERE UserId = @userId
      AND CompanyId = @companyId
  `, { userId, companyId });

  return row ? parseSettings(row.SettingsJson) : emptySettings();
};

const getSettingsForAuth = async (auth = {}) =>
  getSettings(auth.userId, auth.companyId);

const getAdminBootstrap = async () => {
  await ensureTable();

  const [companies, users, assignments] = await Promise.all([
    authDbService.queryRows(`
      SELECT CompanyId, CompanyName, DbName
      FROM dbo.Companies
      WHERE IsActive = 1
      ORDER BY CompanyName, CompanyId
    `),
    authDbService.queryRows(`
      SELECT UserId, Username, FullName
      FROM dbo.Users
      WHERE IsActive = 1
      ORDER BY FullName, Username, UserId
    `),
    authDbService.queryRows(`
      SELECT UserId, CompanyId
      FROM dbo.UserCompanies
      ORDER BY CompanyId, UserId
    `),
  ]);

  return { companies, users, assignments };
};

const getAdminSettings = async (userIdValue, companyIdValue) => {
  const userId = normalizeId(userIdValue, 'user');
  const companyId = normalizeId(companyIdValue, 'company');
  await ensureAssignment(userId, companyId);

  return {
    userId,
    companyId,
    settings: await getSettings(userId, companyId),
  };
};

const saveAdminSettings = async (userIdValue, companyIdValue, settings) => {
  const userId = normalizeId(userIdValue, 'user');
  const companyId = normalizeId(companyIdValue, 'company');
  await ensureAssignment(userId, companyId);
  await ensureTable();

  const normalizedSettings = normalizeSettings(settings);
  await authDbService.query(`
    INSERT INTO UserGeneralSettings (UserId, CompanyId, SettingsJson, CreatedAt, UpdatedAt)
    VALUES (@userId, @companyId, @settingsJson, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(UserId, CompanyId) DO UPDATE SET
      SettingsJson = excluded.SettingsJson,
      UpdatedAt = CURRENT_TIMESTAMP
  `, {
    userId,
    companyId,
    settingsJson: JSON.stringify(normalizedSettings),
  });

  return { userId, companyId, settings: normalizedSettings };
};

const getAdminOptions = async (req, userIdValue, companyIdValue, dateValue) => {
  const userId = normalizeId(userIdValue, 'user');
  const companyId = normalizeId(companyIdValue, 'company');
  await ensureAssignment(userId, companyId);

  req.auth = { ...req.auth, userId, companyId };
  const [
    referenceData,
    salesSeries,
    deliverySeries,
    salesQuotationSeries,
    arInvoiceSeries,
    arCreditMemoSeries,
    purchaseRequestSeries,
    purchaseQuotationSeries,
    purchaseOrderSeries,
    grpoSeries,
    apInvoiceSeries,
    apCreditMemoSeries,
  ] = await Promise.all([
    salesOrderService.getReferenceData(companyId),
    salesOrderService.getDocumentSeries(dateValue || null),
    deliveryService.getDocumentSeries(dateValue || null),
    salesQuotationDbService.getDocumentSeries(dateValue || null),
    arInvoiceDbService.getDocumentSeries(dateValue || null),
    arCreditMemoDbService.getDocumentSeries(dateValue || null),
    purchaseRequestService.getDocumentSeries(),
    purchaseQuotationDbService.getDocumentSeries(null, dateValue || null),
    purchaseOrderDbService.getDocumentSeries(dateValue || null),
    grpoDbService.getDocumentSeries(dateValue || null),
    apInvoiceDbService.getDocumentSeries({ date: dateValue || null }),
    apCreditMemoDbService.getDocumentSeries({ date: dateValue || null }),
  ]);

  return {
    warehouses: referenceData?.warehouses || [],
    seriesByGroup: {
      sales: salesSeries?.series || [],
      delivery: deliverySeries?.series || [],
      salesQuotation: salesQuotationSeries?.series || [],
      arInvoice: arInvoiceSeries?.series || [],
      arCreditMemo: arCreditMemoSeries?.series || [],
      purchaseRequest: purchaseRequestSeries?.series || [],
      purchaseQuotation: purchaseQuotationSeries?.series || [],
      purchaseOrder: purchaseOrderSeries?.series || [],
      grpo: grpoSeries?.series || [],
      apInvoice: apInvoiceSeries?.series || [],
      apCreditMemo: apCreditMemoSeries?.series || [],
    },
  };
};

module.exports = {
  getSettings,
  getSettingsForAuth,
  getAdminBootstrap,
  getAdminSettings,
  saveAdminSettings,
  getAdminOptions,
};
