// User-Defined Fields - Management (SAP: Tools > Customization Tools).
// Writes go through sapService's UserFieldsMD, so local companies use the local
// engine and SAP-connected companies use SAP's Service Layer.
const router = require('express').Router();
const authDb = require('../services/authDbService');
const db = require('../services/dbService');
const sapService = require('../services/sapService');
const { UDF_TYPES, udfTableGroup } = require('../services/localServiceLayer');
const { reportTableExists } = require('../services/reportMetadataService');
const { clearCache } = require('../middleware/cacheMiddleware');

const MENU_PATH = '/udf-management';
// Tables offered on the page, grouped as SAP's UDF management tree.
const TABLES = [
  ['Marketing Documents', [['ORDR', 'Title (all marketing documents)'], ['RDR1', 'Rows (all marketing documents)']]],
  ['Master Data', [['OCRD', 'Business Partners'], ['CRD1', 'BP Addresses'], ['OCPR', 'BP Contact Persons'], ['OITM', 'Items'],
    ['OITW', 'Items - Warehouse Info'], ['OWHS', 'Warehouses'], ['OITB', 'Item Groups'], ['OCRG', 'BP Groups'],
    ['OSLP', 'Sales Employees'], ['OCTG', 'Payment Terms'], ['OPLN', 'Price Lists'], ['OBPL', 'Branches']]],
  ['Finance', [['OACT', 'G/L Accounts'], ['OJDT', 'Journal Entry - Header'], ['JDT1', 'Journal Entry - Rows'], ['OSTC', 'Tax Codes']]],
  ['Inventory', [['OIGN', 'Goods Receipt - Header'], ['IGN1', 'Goods Receipt - Rows'], ['OIGE', 'Goods Issue - Header'], ['IGE1', 'Goods Issue - Rows'],
    ['OWTR', 'Inventory Transfer - Header'], ['WTR1', 'Inventory Transfer - Rows']]],
  ['Banking', [['ORCT', 'Incoming Payments'], ['OVPM', 'Outgoing Payments']]],
];
const ALLOWED = new Map(TABLES.flatMap(([, tables]) => tables.map(([code, label]) => [code, label])));
const MARKETING = new Set([...udfTableGroup('ORDR'), ...udfTableGroup('RDR1')]);
const isAllowed = (table) => ALLOWED.has(table) || MARKETING.has(table);

const authorize = (right) => async (req, res, next) => {
  try {
    const rows = await authDb.queryRows(`SELECT rr.CanView, rr.${right} AS Allowed FROM RoleRights rr
      JOIN Menus m ON m.MenuId=rr.MenuId JOIN UserRoles ur ON ur.RoleId=rr.RoleId
      WHERE ur.UserId=@userId AND ur.CompanyId=@companyId AND ur.RoleId=@roleId AND m.MenuPath=@path`,
    { userId: req.auth?.userId, companyId: req.auth?.companyId, roleId: req.auth?.roleId, path: MENU_PATH });
    if (!rows.some((row) => row.CanView && row.Allowed)) return res.status(403).json({ message: 'You do not have permission for user-defined fields.' });
    next();
  } catch (error) { next(error); }
};
const respond = (handler) => async (req, res) => {
  try {
    const result = await handler(req);
    if (req.method !== 'GET') clearCache();
    res.json(result ?? { success: true });
  } catch (error) {
    res.status(error.statusCode || error.response?.status || 500).json({
      message: error.response?.data?.error?.message?.value || error.message,
    });
  }
};
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const tableParam = (value) => {
  const table = String(value || '').trim().toUpperCase();
  if (!isAllowed(table)) fail(`User-defined fields are not managed for table "${value}" here.`);
  return table;
};
const isLocal = async () => (await db.resolveSqlConnectionConfig()).dialect === 'postgres';
// Formula/validation rules are a local extension; SAP's Service Layer does not know them.
const payloadFor = async (body) => {
  const data = { ...body };
  if (!(await isLocal())) {
    if (data.Formula || data.Validation) fail('Formulas and validation rules are available for local companies only.');
    ['Formula', 'Validation', 'ValidationMessage'].forEach((key) => delete data[key]);
  }
  return data;
};
const fieldUrl = (table, fieldId) => `/UserFieldsMD(TableName='${table}',FieldID=${Number(fieldId)})`;

router.get('/tables', authorize('CanView'), respond(async () => {
  const groups = [];
  for (const [group, tables] of TABLES) {
    const present = [];
    for (const [code, label] of tables) if (await reportTableExists(code)) present.push({ code, label });
    if (present.length) groups.push({ group, tables: present });
  }
  const types = Object.entries(UDF_TYPES).map(([name, type]) => ({ name, label: type.label, subTypes: Object.keys(type.subTypes), size: type.size || null }));
  const linkable = [...ALLOWED.keys()].filter((code) => !MARKETING.has(code));
  return { groups, types, linkable, local: await isLocal() };
}));

router.get('/', authorize('CanView'), respond(async (req) => {
  const table = tableParam(req.query.table);
  const result = await db.query('SELECT FieldID FROM CUFD WHERE TableID = @table ORDER BY FieldID', { table });
  const fields = [];
  for (const row of result.recordset || []) {
    fields.push((await sapService.request({ method: 'GET', url: fieldUrl(table, row.FieldID) })).data);
  }
  return { table, sharedWith: udfTableGroup(table), fields };
}));

router.post('/', authorize('CanAdd'), respond(async (req) => {
  const data = await payloadFor(req.body);
  data.TableName = tableParam(data.TableName);
  return (await sapService.request({ method: 'POST', url: '/UserFieldsMD', data })).data;
}));

router.patch('/:table/:fieldId', authorize('CanEdit'), respond(async (req) => {
  const table = tableParam(req.params.table);
  await sapService.request({ method: 'PATCH', url: fieldUrl(table, req.params.fieldId), data: await payloadFor(req.body) });
  return (await sapService.request({ method: 'GET', url: fieldUrl(table, req.params.fieldId) })).data;
}));

router.delete('/:table/:fieldId', authorize('CanEdit'), respond(async (req) => {
  await sapService.request({ method: 'DELETE', url: fieldUrl(tableParam(req.params.table), req.params.fieldId) });
}));

module.exports = router;
