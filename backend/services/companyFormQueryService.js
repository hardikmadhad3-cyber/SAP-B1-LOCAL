'use strict';

const authDbService = require('./authDbService');
const dbService = require('./dbService');
const { setCompanyContextOverride } = require('./requestContextService');
const { assertStaticReadOnlySql, stripSqlLiterals } =
  require('../modules/newSalesOrder/newSalesOrderReadOnlyDbService');
const {
  getTableColumnsSql,
  normalizeRecordset,
  normalizeTableColumnDetails,
  rowValue,
} = require('./salesDocumentDbCompatibility');

const PREVIEW_LIMIT = 50;
const RUNTIME_LIMIT = 500;
const QUERY_TIMEOUT_MS = 10000;
const MAX_QUERY_LENGTH = 20000;
const PLACEHOLDERS = Object.freeze(['docEntry', 'cardCode', 'postingDate', 'branchId', 'userId']);
const PLACEHOLDER_SET = new Set(PLACEHOLDERS.map((value) => value.toLowerCase()));
const FORM_HEADER_TABLES = Object.freeze({
  'sapb1.salesQuotation.formSettings.v1': 'OQUT',
  'sapb1.salesOrder.formSettings.v2': 'ORDR',
  'sapb1.delivery.formSettings.v3': 'ODLN',
  'sapb1.arInvoice.formSettings.v1': 'OINV',
  'sapb1.arCreditMemo.formSettings.v1': 'ORIN',
  'sapb1.serviceArInvoice.formSettings.v7': 'OINV',
  'sapb1.serviceArCreditMemo.formSettings.v10': 'ORIN',
  'sapb1.purchaseRequest.formSettings.v1': 'OPRQ',
  'sapb1.purchaseQuotation.formSettings.v1': 'OPQT',
  'sapb1.purchaseOrder.formSettings.v1': 'OPOR',
  'sapb1.grpo.formSettings.v1': 'OPDN',
  'sapb1.apInvoice.formSettings.v1': 'OPCH',
  'sapb1.apCreditMemo.formSettings.v1': 'ORPC',
  'sapb1.serviceApInvoice.formSettings.v10': 'OPCH',
  'sapb1.serviceApCreditMemo.formSettings.v10': 'ORPC',
});
const SALES_PURCHASE_FORM_KEYS = new Set([
  'sapb1.salesQuotation.formSettings.v1',
  'sapb1.salesOrder.formSettings.v2',
  'sapb1.delivery.formSettings.v3',
  'sapb1.arInvoice.formSettings.v1',
  'sapb1.arCreditMemo.formSettings.v1',
  'sapb1.serviceArInvoice.formSettings.v7',
  'sapb1.serviceArCreditMemo.formSettings.v10',
  'sapb1.purchaseRequest.formSettings.v1',
  'sapb1.purchaseQuotation.formSettings.v1',
  'sapb1.purchaseOrder.formSettings.v1',
  'sapb1.grpo.formSettings.v1',
  'sapb1.apInvoice.formSettings.v1',
  'sapb1.apCreditMemo.formSettings.v1',
  'sapb1.serviceApInvoice.formSettings.v10',
  'sapb1.serviceApCreditMemo.formSettings.v10',
]);

const httpError = (statusCode, message, code) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
};

// Setup administrators are configured in the environment, not stored in Users.
// Their token carries userId 0, which cannot satisfy the layout audit FK.
const publisherUserId = (auth) => {
  if (auth?.isSetupAdmin === true) return null;
  const userId = Number(auth?.userId);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
};

const normalizeFormKey = (value) => {
  const formKey = String(value || '').trim();
  if (!formKey || formKey.length > 150) throw httpError(400, 'A valid page is required.', 'INVALID_FORM_KEY');
  return formKey;
};

const normalizeVersion = (value) => {
  const version = Number(value ?? 0);
  if (!Number.isInteger(version) || version < 0) {
    throw httpError(400, 'expectedVersion must be a non-negative integer.', 'INVALID_LAYOUT_VERSION');
  }
  return version;
};

const explicitResultExpressions = (queryText) => {
  const sql = stripSqlLiterals(queryText);
  let depth = 0;
  let selectStart = -1;
  let selectEnd = -1;
  for (let index = 0; index < sql.length; index += 1) {
    if (sql[index] === '(') depth += 1;
    else if (sql[index] === ')') depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    const tail = sql.slice(index);
    if (selectStart < 0 && /^SELECT\b/i.test(tail)) {
      selectStart = index + tail.match(/^SELECT\b/i)[0].length;
      index = selectStart - 1;
    } else if (selectStart >= 0 && /^FROM\b/i.test(tail)) {
      selectEnd = index;
      break;
    }
  }
  if (selectStart < 0) return [];
  const list = sql.slice(selectStart, selectEnd < 0 ? sql.length : selectEnd);
  const parts = [];
  let part = '';
  depth = 0;
  for (const char of list) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(part);
      part = '';
    } else {
      part += char;
    }
  }
  if (part.trim()) parts.push(part);
  return parts;
};

const explicitResultAliases = (queryText) => {
  return explicitResultExpressions(queryText).map((expression) => {
    const match = expression.trim().match(/\bAS\s+(?:\[([^\]]+)\]|\"([^\"]+)\"|([A-Za-z_][A-Za-z0-9_$#]*))\s*$/i);
    return String(match?.[1] || match?.[2] || match?.[3] || '').trim();
  });
};

const validateQueryText = (value, dialect = 'sqlserver') => {
  const queryText = String(value || '').trim();
  if (!queryText || queryText.length > MAX_QUERY_LENGTH) {
    throw httpError(400, `SQL query is required and limited to ${MAX_QUERY_LENGTH} characters.`, 'INVALID_LAYOUT_QUERY');
  }
  try {
    assertStaticReadOnlySql(queryText);
  } catch (error) {
    throw httpError(
      400,
      String(error.message || 'Only one read-only SELECT query is allowed.')
        .replace(/New Sales Order/gi, 'Company Form Settings'),
      'UNSAFE_LAYOUT_QUERY',
    );
  }

  const withoutLiterals = stripSqlLiterals(queryText);
  if (/\b(?:OPENROWSET|OPENDATASOURCE|OPENQUERY|BULK|XP_[A-Z0-9_]*|SP_OA[A-Z0-9_]*)\b/i.test(withoutLiterals)) {
    throw httpError(400, 'External data sources and dynamic SQL are not allowed.', 'UNSAFE_LAYOUT_QUERY');
  }
  if (/(?:\[[^\]]+\]|\"[^\"]+\"|\b[A-Za-z_][A-Za-z0-9_$#]*)\s*\.\s*(?:\[[^\]]+\]|\"[^\"]+\"|[A-Za-z_][A-Za-z0-9_$#]*)\s*\./.test(withoutLiterals)) {
    throw httpError(400, 'Cross-database object references are not allowed.', 'CROSS_DATABASE_QUERY');
  }
  if (String(dialect).toLowerCase() === 'hana'
      && /\b(?:FROM|JOIN)\s+\"[^\"]+\"\s*\.\s*\"[^\"]+\"/i.test(withoutLiterals)) {
    throw httpError(400, 'Cross-schema object references are not allowed for HANA layouts.', 'CROSS_DATABASE_QUERY');
  }

  const unknown = [];
  queryText.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match, name) => {
    if (!PLACEHOLDER_SET.has(name.toLowerCase())) unknown.push(name);
    return match;
  });
  if (unknown.length) {
    throw httpError(400, `Unsupported placeholder: {{${unknown[0]}}}.`, 'INVALID_LAYOUT_PLACEHOLDER');
  }
  if (/\{\{|\}\}/.test(queryText.replace(/\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/g, ''))) {
    throw httpError(400, 'A query contains an invalid placeholder.', 'INVALID_LAYOUT_PLACEHOLDER');
  }
  if (/@[A-Za-z_][A-Za-z0-9_]*/.test(withoutLiterals)) {
    throw httpError(400, 'Use only the approved {{placeholder}} syntax for query parameters.', 'INVALID_LAYOUT_PLACEHOLDER');
  }
  const aliases = explicitResultAliases(queryText);
  if (!aliases.length || aliases.some((alias) => !alias)) {
    throw httpError(
      400,
      'Every result expression must have an explicit, non-empty AS alias.',
      'INVALID_LAYOUT_COLUMNS',
    );
  }
  const aliasSet = new Set();
  for (const alias of aliases) {
    const normalized = alias.toLowerCase();
    if (aliasSet.has(normalized)) {
      throw httpError(400, `Duplicate result column alias: ${alias}.`, 'INVALID_LAYOUT_COLUMNS');
    }
    aliasSet.add(normalized);
  }
  return queryText;
};

const compileQuery = (queryText) => queryText.replace(
  /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
  (_match, name) => `@${PLACEHOLDERS.find((item) => item.toLowerCase() === name.toLowerCase())}`,
);

const normalizeContext = (auth = {}, context = {}) => {
  const date = String(context.postingDate || '').slice(0, 10);
  const cardCode = String(context.cardCode ?? '').trim();
  return {
    docEntry: Number.isInteger(Number(context.docEntry)) && Number(context.docEntry) > 0
      ? Number(context.docEntry) : null,
    cardCode: cardCode ? cardCode.slice(0, 100) : null,
    postingDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    branchId: context.branchId !== '' && context.branchId !== null && context.branchId !== undefined
      && Number.isInteger(Number(context.branchId))
      ? Number(context.branchId) : null,
    userId: Number(auth.userId),
  };
};

const parseJson = (value, fallback) => {
  try { return JSON.parse(value); } catch (_error) { return fallback; }
};

const serializeLayout = (row) => row ? ({
  formKey: row.FormKey,
  queryText: row.QueryText,
  columns: parseJson(row.ColumnsJson || '[]', []).map((column) => {
    const aliases = explicitResultAliases(row.QueryText || '');
    const expression = explicitResultExpressions(row.QueryText || '')[aliases.indexOf(column.key)] || '';
    // Preserve a physical UDF's identity even when its SQL alias is Price or TaxCode.
    const udf = expression.match(/\bT0\s*\.\s*(?:"(U_[^"]+)"|\[(U_[^\]]+)\]|(U_[A-Za-z0-9_]+))/i);
    if (udf) return { ...column, fieldName: udf[1] || udf[2] || udf[3] };
    const physical = expression.match(/\bT0\s*\.\s*(?:"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/i);
    return physical ? { ...column, fieldName: physical[1] || physical[2] || physical[3] } : column;
  }),
  isPublished: Boolean(row.IsPublished),
  version: Number(row.Version || 0),
  publishedByUserId: row.PublishedByUserId || null,
  publishedAt: row.PublishedAt || null,
  updatedAt: row.UpdatedAt || null,
}) : null;

const resolveCompany = async (companyId) => {
  const id = Number(companyId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'A valid company is required.', 'INVALID_COMPANY');
  const companies = await authDbService.getActiveCompanies();
  const company = companies.find((item) => Number(item.CompanyId) === id);
  if (!company) throw httpError(404, 'The selected company is not active.', 'COMPANY_NOT_FOUND');
  return company;
};

const useReadOnlyQueryCredentials = (company) => {
  const user = String(company?.FormQueryDbUser || '').trim();
  const password = String(company?.FormQueryDbPassword || '');
  if (!user || !password) {
    throw httpError(
      422,
      'Configure a dedicated SELECT-only database user and password for SQL Content queries on this company.',
      'LAYOUT_READ_ONLY_CONNECTION_REQUIRED',
    );
  }
  return { ...company, DbUser: user, DbPassword: password };
};

const formatDateValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

const deriveRuntimeContext = async (auth, company, formKey, rawContext = {}, database = dbService) => {
  const userId = publisherUserId(auth);
  const requestedDocEntry = Number(rawContext?.docEntry);
  if (!Number.isInteger(requestedDocEntry) || requestedDocEntry <= 0) {
    return { docEntry: null, cardCode: null, postingDate: null, branchId: null, userId };
  }
  const headerTable = FORM_HEADER_TABLES[formKey];
  if (!headerTable) throw httpError(400, 'SQL Content queries are not supported for this page.', 'INVALID_FORM_KEY');

  setCompanyContextOverride(company);
  const dialect = String(company.DbDialect || '').toLowerCase() === 'hana' ? 'hana' : 'sqlserver';
  const metadataResult = await queryCompanyDatabase(database, company,
    getTableColumnsSql(dialect),
    { tableName: headerTable },
  );
  const fieldNames = normalizeTableColumnDetails(normalizeRecordset(metadataResult))
    .map((field) => field.columnName);
  const resolveField = (...candidates) => candidates
    .map((candidate) => fieldNames.find((field) => field.toLowerCase() === candidate.toLowerCase()))
    .find(Boolean);
  const docEntryField = resolveField('DocEntry');
  const cardCodeField = resolveField('CardCode');
  const postingDateField = resolveField('DocDate');
  const branchField = resolveField('BPL_IDAssignedToInvoice', 'BPLId');
  if (!docEntryField) {
    throw httpError(422, 'The selected page does not expose a document key.', 'INVALID_DOCUMENT_CONTEXT');
  }

  const result = await queryCompanyDatabase(database, company, `
    SELECT
      T0.${docEntryField} AS DocEntry,
      ${cardCodeField ? `T0.${cardCodeField}` : 'NULL'} AS CardCode,
      ${postingDateField ? `T0.${postingDateField}` : 'NULL'} AS PostingDate,
      ${branchField ? `T0.${branchField}` : 'NULL'} AS BranchId
    FROM ${headerTable} T0
    WHERE T0.${docEntryField} = @docEntry
  `, { docEntry: requestedDocEntry });
  const document = normalizeRecordset(result)[0];
  if (!document) throw httpError(404, 'The selected document could not be found.', 'DOCUMENT_NOT_FOUND');
  const branchValue = rowValue(document, 'BranchId');
  return {
    docEntry: Number(rowValue(document, 'DocEntry')),
    cardCode: String(rowValue(document, 'CardCode') || '').trim().slice(0, 100) || null,
    postingDate: formatDateValue(rowValue(document, 'PostingDate')),
    branchId: branchValue !== null && branchValue !== undefined && branchValue !== ''
      && Number.isInteger(Number(branchValue)) ? Number(branchValue) : null,
    userId,
  };
};

const executeWithTimeout = async (promise) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(httpError(408, 'The query exceeded the 10 second limit.', 'LAYOUT_QUERY_TIMEOUT')),
          QUERY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const queryCompanyDatabase = async (database, company, sql, params = {}) => {
  try {
    return await executeWithTimeout(database.query(sql, params, { requestTimeout: QUERY_TIMEOUT_MS }));
  } catch (error) {
    if (error?.code === 'ELOGIN'
        || /authentication failed|login failed|invalid credentials/i.test(String(error?.message || ''))) {
      const databaseType = String(company?.DbDialect || '').toLowerCase() === 'hana' ? 'HANA' : 'SQL Server';
      throw httpError(
        422,
        `SQL Content database login failed for this company. In Admin > Companies > SQL Content Query Connection, enter a valid ${databaseType} database username and its matching password. This account requires SELECT access to this company database; SAP Business One login credentials are separate.`,
        'LAYOUT_READ_ONLY_AUTHENTICATION_FAILED',
      );
    }
    throw error;
  }
};

// Both drivers now report a column's declared type, so a published layout types
// a column the same way on SQL Server and HANA and no longer depends on the
// preview happening to return a row. The HANA names (SECONDDATE, TIMESTAMP,
// SMALLDECIMAL, NVARCHAR) sit alongside the SQL Server ones deliberately.
const columnType = (metadata = {}, sample) => {
  const declared = String(metadata?.type?.declaration || metadata?.type?.name || metadata?.type || '').toLowerCase();
  if (/date|time/.test(declared) || sample instanceof Date) return 'date';
  if (/int|decimal|numeric|money|real|float|double/.test(declared) || typeof sample === 'number') return 'number';
  if (/bit|bool/.test(declared) || typeof sample === 'boolean') return 'boolean';
  return 'text';
};

const extractColumns = (result, rows) => {
  const metadata = result?.recordset?.columns || {};
  const names = Object.keys(metadata).length ? Object.keys(metadata) : Object.keys(rows[0] || {});
  const seen = new Set();
  return names.map((name, index) => {
    const label = String(name || '').trim();
    const normalized = label.toLowerCase();
    if (!label) throw httpError(422, 'Every result column must have a non-empty alias.', 'INVALID_LAYOUT_COLUMNS');
    if (seen.has(normalized)) {
      throw httpError(422, `Duplicate result column alias: ${label}.`, 'INVALID_LAYOUT_COLUMNS');
    }
    seen.add(normalized);
    return { key: label, label, order: index + 1, type: columnType(metadata[name], rows[0]?.[name]) };
  });
};

const execute = async ({ auth, company, formKey, queryText, rawContext, limit }) => {
  setCompanyContextOverride(company);
  const dialect = String(company.DbDialect || '').toLowerCase() === 'hana' ? 'hana' : 'sqlserver';
  const validated = validateQueryText(queryText, dialect);
  const result = await queryCompanyDatabase(
    dbService, company, compileQuery(validated), normalizeContext(auth, rawContext),
  );
  const allRows = Array.isArray(result?.recordset) ? result.recordset : [];
  let columns = extractColumns(result, allRows);
  if (!columns.length) {
    columns = explicitResultAliases(validated).map((alias, index) => ({
      key: alias,
      label: alias,
      order: index + 1,
      type: 'text',
    }));
  }
  if (!columns.length) {
    throw httpError(422, 'The query must expose at least one named column.', 'INVALID_LAYOUT_COLUMNS');
  }
  return {
    formKey,
    columns,
    rows: allRows.slice(0, limit),
    rowCount: Math.min(allRows.length, limit),
    truncated: allRows.length > limit,
  };
};

const getLayoutRow = (companyId, formKey) => authDbService.queryOne(`
  SELECT FormKey, QueryText, ColumnsJson, IsPublished, Version, PublishedByUserId, PublishedAt, UpdatedAt
  FROM CompanyFormQueryLayouts
  WHERE CompanyId = @companyId AND FormKey = @formKey
`, { companyId, formKey });

const getAdminLayout = async (companyId, formKey) => {
  await authDbService.ensureSchema();
  await resolveCompany(companyId);
  return serializeLayout(await getLayoutRow(Number(companyId), normalizeFormKey(formKey)));
};

const copySalesPurchaseLayouts = async (auth, payload = {}) => {
  await authDbService.ensureSchema();
  const sourceCompanyId = Number(payload.sourceCompanyId);
  const targetCompanyId = Number(payload.targetCompanyId);
  if (!Number.isInteger(sourceCompanyId) || !Number.isInteger(targetCompanyId) || sourceCompanyId === targetCompanyId) {
    throw httpError(400, 'Different source and target companies are required.', 'INVALID_LAYOUT_COPY_COMPANIES');
  }

  const companies = await authDbService.getActiveCompanies();
  const source = companies.find((company) => Number(company.CompanyId) === sourceCompanyId);
  const target = companies.find((company) => Number(company.CompanyId) === targetCompanyId);
  if (!source || !target) throw httpError(404, 'Both companies must be active.', 'COMPANY_NOT_FOUND');

  const rows = await authDbService.queryRows(`
    SELECT FormKey, QueryText, ColumnsJson, IsPublished
    FROM CompanyFormQueryLayouts
    WHERE CompanyId = @sourceCompanyId
      AND IsPublished = 1
  `, { sourceCompanyId });
  const layouts = rows.filter((row) => SALES_PURCHASE_FORM_KEYS.has(String(row.FormKey)));
  const userId = Number(auth?.userId);

  await authDbService.transaction(async (tx) => {
    for (const layout of layouts) {
      await tx.query(`
        INSERT INTO CompanyFormQueryLayouts
          (CompanyId, FormKey, QueryText, ColumnsJson, IsPublished, Version, PublishedByUserId, PublishedAt, CreatedAt, UpdatedAt)
        VALUES
          (@targetCompanyId, @formKey, @queryText, @columnsJson, 1, 1, @userId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(CompanyId, FormKey) DO UPDATE SET
          QueryText = excluded.QueryText,
          ColumnsJson = excluded.ColumnsJson,
          IsPublished = 1,
          Version = CompanyFormQueryLayouts.Version + 1,
          PublishedByUserId = excluded.PublishedByUserId,
          PublishedAt = CURRENT_TIMESTAMP,
          UpdatedAt = CURRENT_TIMESTAMP
      `, {
        targetCompanyId,
        formKey: layout.FormKey,
        queryText: layout.QueryText,
        columnsJson: layout.ColumnsJson || '[]',
        userId,
      });
    }
  });

  return {
    sourceCompanyId,
    targetCompanyId,
    copiedCount: layouts.length,
    formKeys: layouts.map((layout) => layout.FormKey),
    executedCompanyQuery: false,
  };
};

const preview = async (auth, payload = {}) => {
  await authDbService.ensureSchema();
  const company = useReadOnlyQueryCredentials(await resolveCompany(payload.companyId));
  const formKey = normalizeFormKey(payload.formKey);
  return execute({ auth, company, formKey, queryText: payload.queryText, rawContext: payload.context, limit: PREVIEW_LIMIT });
};

const publish = async (auth, payload = {}) => {
  await authDbService.ensureSchema();
  const company = useReadOnlyQueryCredentials(await resolveCompany(payload.companyId));
  const companyId = Number(company.CompanyId);
  const formKey = normalizeFormKey(payload.formKey);
  const expectedVersion = normalizeVersion(payload.expectedVersion);
  const queryText = validateQueryText(payload.queryText, company.DbDialect);
  const validation = await execute({
    auth, company, formKey, queryText, rawContext: payload.context, limit: PREVIEW_LIMIT,
  });
  const userId = publisherUserId(auth);

  await authDbService.transaction(async (tx) => {
    const current = await tx.queryOne(
      'SELECT Version FROM CompanyFormQueryLayouts WHERE CompanyId = @companyId AND FormKey = @formKey',
      { companyId, formKey },
    );
    const currentVersion = Number(current?.Version || 0);
    if (currentVersion !== expectedVersion) {
      throw httpError(409, 'This layout was changed by another administrator. Reload it and try again.', 'LAYOUT_VERSION_CONFLICT');
    }
    const nextVersion = currentVersion + 1;
    await tx.query(`
      INSERT INTO CompanyFormQueryLayouts
        (CompanyId, FormKey, QueryText, ColumnsJson, IsPublished, Version, PublishedByUserId, PublishedAt, CreatedAt, UpdatedAt)
      VALUES
        (@companyId, @formKey, @queryText, @columnsJson, 1, @nextVersion, @userId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(CompanyId, FormKey) DO UPDATE SET
        QueryText = excluded.QueryText,
        ColumnsJson = excluded.ColumnsJson,
        IsPublished = 1,
        Version = excluded.Version,
        PublishedByUserId = excluded.PublishedByUserId,
        PublishedAt = CURRENT_TIMESTAMP,
        UpdatedAt = CURRENT_TIMESTAMP
    `, {
      companyId, formKey, queryText, columnsJson: JSON.stringify(validation.columns), nextVersion, userId,
    });
  });
  return serializeLayout(await getLayoutRow(companyId, formKey));
};

const unpublish = async (auth, payload = {}) => {
  await authDbService.ensureSchema();
  const company = await resolveCompany(payload.companyId);
  const companyId = Number(company.CompanyId);
  const formKey = normalizeFormKey(payload.formKey);
  const expectedVersion = normalizeVersion(payload.expectedVersion);
  await authDbService.transaction(async (tx) => {
    const current = await tx.queryOne(
      'SELECT Version FROM CompanyFormQueryLayouts WHERE CompanyId = @companyId AND FormKey = @formKey',
      { companyId, formKey },
    );
    if (!current) throw httpError(404, 'No saved query exists for this company and page.', 'LAYOUT_NOT_FOUND');
    if (Number(current.Version) !== expectedVersion) {
      throw httpError(409, 'This layout was changed by another administrator. Reload it and try again.', 'LAYOUT_VERSION_CONFLICT');
    }
    await tx.query(`
      UPDATE CompanyFormQueryLayouts
      SET IsPublished = 0, Version = Version + 1, PublishedByUserId = @userId, UpdatedAt = CURRENT_TIMESTAMP
      WHERE CompanyId = @companyId AND FormKey = @formKey AND Version = @expectedVersion
    `, { userId: publisherUserId(auth), companyId, formKey, expectedVersion });
  });
  return serializeLayout(await getLayoutRow(companyId, formKey));
};

const getPublishedLayout = async (auth, formKey, options = {}) => {
  await authDbService.ensureSchema();
  const userId = Number(auth?.userId);
  const companyId = Number(auth?.companyId);
  if (!Number.isInteger(userId) || !Number.isInteger(companyId)) {
    throw httpError(401, 'A valid company session is required.', 'INVALID_COMPANY_SESSION');
  }
  const company = await authDbService.getAssignedCompanyForUser(userId, companyId);
  if (!company) throw httpError(403, 'The selected company is not assigned to this user.', 'COMPANY_NOT_ASSIGNED');
  const layout = serializeLayout(await getLayoutRow(companyId, normalizeFormKey(formKey)));
  if (!layout?.isPublished) return null;
  if (options.includeQueryText) return layout;
  const { queryText: _queryText, ...publicLayout } = layout;
  return publicLayout;
};

const runPublished = async (auth, formKey, rawContext = {}) => {
  const layout = await getPublishedLayout(auth, formKey, { includeQueryText: true });
  if (!layout) throw httpError(404, 'No SQL Content layout is published for this page.', 'LAYOUT_NOT_PUBLISHED');
  try {
    const assignedCompany = await authDbService.getAssignedCompanyForUser(Number(auth.userId), Number(auth.companyId));
    const company = useReadOnlyQueryCredentials(assignedCompany);
    const context = await deriveRuntimeContext(auth, company, layout.formKey, rawContext);
    const result = await execute({
      auth, company, formKey: layout.formKey, queryText: layout.queryText, rawContext: context, limit: RUNTIME_LIMIT,
    });
    return { ...result, version: layout.version };
  } catch (error) {
    console.error(
      `[COMPANY_FORM_QUERY] ${layout.formKey} v${layout.version} failed for company ${auth.companyId}:`,
      error,
    );
    if (error.code === 'LAYOUT_READ_ONLY_AUTHENTICATION_FAILED') {
      throw httpError(422,
        'SQL Content database login failed for this company. Ask an administrator to correct its SQL Content Query Connection database credentials.',
        error.code);
    }
    throw httpError(
      error.statusCode === 408 ? 408 : 422,
      'The published Content query could not be loaded. Retry or contact an administrator.',
      'LAYOUT_QUERY_FAILED',
    );
  }
};

module.exports = {
  PLACEHOLDERS,
  PREVIEW_LIMIT,
  RUNTIME_LIMIT,
  columnType,
  compileQuery,
  explicitResultAliases,
  serializeLayout,
  validateQueryText,
  normalizeContext,
  useReadOnlyQueryCredentials,
  queryCompanyDatabase,
  deriveRuntimeContext,
  publisherUserId,
  getAdminLayout,
  copySalesPurchaseLayouts,
  preview,
  publish,
  unpublish,
  getPublishedLayout,
  runPublished,
};
