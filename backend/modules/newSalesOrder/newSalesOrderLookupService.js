'use strict';

const readOnlyDbService = require('./newSalesOrderReadOnlyDbService');
const metadataRepository = require('./newSalesOrderMetadataRepository');
const schemaService = require('./newSalesOrderSchemaService');
const customLookupRepository = require('../salesDocumentSchema/salesDocumentCustomLookupRepository');
const {
  FORBIDDEN_LOOKUP_KEYS,
  LOOKUP_PAGING,
  LOOKUP_QUERY_KEYS,
  LOOKUP_SOURCE_SET,
  LINKED_TABLE_COLUMN_CANDIDATES,
  resolveSalesDocument,
} = require('./newSalesOrderConstants');
const { rowValue, normalizeSapIdentifier } = require('./newSalesOrderMetadataRepository');
const {
  aliased,
  columnReference,
  normalizeSqlDialect,
  paginationClause,
  quoteIdentifier,
} = require('./newSalesOrderSqlDialect');
const {
  escapeLikeValue,
  LIKE_ESCAPE_SQL,
} = require('../../services/salesDocumentDbCompatibility');

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const literalLike = (expression) => `${expression} LIKE @like ${LIKE_ESCAPE_SQL}`;
const CUSTOM_LOOKUP_SOURCE = /^custom:(\d+)$/;

const createHttpError = (statusCode, message, code, details) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  if (details !== undefined) error.details = details;
  return error;
};

const buildLookupSelect = ({ dialect, tableName, select, where, orderBy }) => `
  SELECT
    ${select.map(([expression, alias]) => aliased(expression, alias, dialect)).join(',\n    ')}
  FROM ${quoteIdentifier(tableName, dialect)} T0
  WHERE ${where}
  ORDER BY ${orderBy.join(', ')}
  ${paginationClause(dialect)}
`;

const buildStandardLookupSql = (rawSource, rawDialect = 'sqlserver') => {
  const source = text(rawSource).toLowerCase();
  const dialect = normalizeSqlDialect(rawDialect);
  const c = (name) => columnReference('T0', name, dialect);
  const textValue = (name, fallback = "''") => `COALESCE(${c(name)}, ${fallback})`;
  const textCast = (name, length = 50) => `CAST(${c(name)} AS NVARCHAR(${length}))`;
  const common = (definition) => buildLookupSelect({ dialect, ...definition });

  const definitions = {
    items: {
      tableName: 'OITM',
      select: [[c('ItemCode'), 'value'], [c('ItemName'), 'label'], [c('ItemName'), 'description']],
      where: `${c('SellItem')} = 'Y'\n    AND ${textValue('validFor', "'Y'")} <> 'N'\n    AND (@search = '' OR ${literalLike(c('ItemCode'))} OR ${literalLike(textValue('ItemName'))})`,
      orderBy: [c('ItemCode')],
    },
    'business-partners': {
      tableName: 'OCRD',
      select: [[c('CardCode'), 'value'], [c('CardName'), 'label'], [c('CardName'), 'description']],
      where: `${c('CardType')} = 'C'\n    AND ${textValue('validFor', "'Y'")} <> 'N'\n    AND ${textValue('frozenFor', "'N'")} <> 'Y'\n    AND (@search = '' OR ${literalLike(c('CardCode'))} OR ${literalLike(textValue('CardName'))})`,
      orderBy: [c('CardCode')],
    },
    warehouses: {
      tableName: 'OWHS',
      select: [[c('WhsCode'), 'value'], [c('WhsName'), 'label'], [c('WhsName'), 'description']],
      where: `${textValue('Inactive', "'N'")} <> 'Y'\n    AND (@search = '' OR ${literalLike(c('WhsCode'))} OR ${literalLike(textValue('WhsName'))})`,
      orderBy: [c('WhsCode')],
    },
    'tax-codes': {
      tableName: 'OSTC',
      select: [[c('Code'), 'value'], [c('Name'), 'label'], [c('Name'), 'description']],
      where: `${textValue('Lock', "'N'")} <> 'Y'\n    AND (@search = '' OR ${literalLike(c('Code'))} OR ${literalLike(textValue('Name'))})`,
      orderBy: [c('Code')],
    },
    'shipping-types': {
      tableName: 'OSHP',
      select: [[c('TrnspCode'), 'value'], [c('TrnspName'), 'label'], [c('TrnspName'), 'description']],
      where: `@search = ''\n    OR ${literalLike(textCast('TrnspCode'))}\n    OR ${literalLike(textValue('TrnspName'))}`,
      orderBy: [c('TrnspName'), c('TrnspCode')],
    },
    'distribution-rules': {
      tableName: 'OOCR',
      select: [[c('OcrCode'), 'value'], [c('OcrName'), 'label'], [c('OcrName'), 'description']],
      where: `${textValue('Active', "'Y'")} <> 'N'\n    AND (@search = '' OR ${literalLike(c('OcrCode'))} OR ${literalLike(textValue('OcrName'))})`,
      orderBy: [c('OcrCode')],
    },
    'hsn-codes': {
      tableName: 'OCHP',
      select: [[c('AbsEntry'), 'value'], [c('ChapterID'), 'label'], [c('Dscription'), 'description']],
      where: `@search = ''\n    OR ${literalLike(textCast('AbsEntry'))}\n    OR ${literalLike(c('ChapterID'))}\n    OR ${literalLike(textValue('Dscription'))}\n    OR ${literalLike(textValue('Heading'))}\n    OR ${literalLike(textValue('SubHeading'))}`,
      orderBy: [c('ChapterID')],
    },
    countries: {
      tableName: 'OCRY',
      select: [[c('Code'), 'value'], [c('Name'), 'label'], [c('Name'), 'description']],
      where: `@search = '' OR ${literalLike(c('Code'))} OR ${literalLike(textValue('Name'))}`,
      orderBy: [c('Name'), c('Code')],
    },
    'sales-employees': {
      tableName: 'OSLP',
      select: [[c('SlpCode'), 'value'], [c('SlpName'), 'label'], [c('Memo'), 'description']],
      where: `${textValue('Active', "'Y'")} = 'Y'\n    AND (@search = '' OR ${literalLike(textCast('SlpCode'))} OR ${literalLike(textValue('SlpName'))})`,
      orderBy: [c('SlpName'), c('SlpCode')],
    },
    owners: {
      tableName: 'OHEM',
      select: [[c('empID'), 'value'], [c('firstName'), 'firstName'], [c('lastName'), 'lastName']],
      where: `@search = ''\n    OR ${literalLike(textCast('empID'))}\n    OR ${literalLike(textValue('firstName'))}\n    OR ${literalLike(textValue('lastName'))}`,
      orderBy: [c('firstName'), c('lastName'), c('empID')],
    },
    'uom-codes': {
      tableName: 'OUOM',
      select: [[c('UomCode'), 'value'], [c('UomName'), 'label'], [c('UomName'), 'description']],
      where: `@search = '' OR ${literalLike(c('UomCode'))} OR ${literalLike(textValue('UomName'))}`,
      orderBy: [c('UomCode')],
    },
  };

  return definitions[source] ? common(definitions[source]) : '';
};

const buildItemUomLookupSql = (rawDialect = 'sqlserver') => {
  const dialect = normalizeSqlDialect(rawDialect);
  const c = (alias, name) => columnReference(alias, name, dialect);
  return `
    SELECT
      ${aliased(c('U', 'UomCode'), 'value', dialect)},
      ${aliased(c('U', 'UomName'), 'label', dialect)},
      ${aliased(c('U', 'UomName'), 'description', dialect)}
    FROM ${quoteIdentifier('OITM', dialect)} I
    INNER JOIN ${quoteIdentifier('UGP1', dialect)} G ON ${c('G', 'UgpEntry')} = ${c('I', 'UgpEntry')}
    INNER JOIN ${quoteIdentifier('OUOM', dialect)} U ON ${c('U', 'UomEntry')} = ${c('G', 'UomEntry')}
    WHERE ${c('I', 'ItemCode')} = @itemCode
      AND (@search = '' OR ${literalLike(c('U', 'UomCode'))} OR ${literalLike(`COALESCE(${c('U', 'UomName')}, '')`)})
    ORDER BY ${c('G', 'LineNum')}, ${c('U', 'UomCode')}
    ${paginationClause(dialect)}
  `;
};

const STANDARD_LOOKUP_SQL = Object.freeze(Object.fromEntries(
  [...LOOKUP_SOURCE_SET]
    .map((source) => [source, buildStandardLookupSql(source, 'sqlserver')])
    .filter(([, sql]) => sql),
));
const ITEM_UOM_LOOKUP_SQL = buildItemUomLookupSql('sqlserver');

const parsePaging = (input = {}) => {
  const rawPage = input.page;
  const rawLimit = input.limit;
  const page = rawPage === undefined || rawPage === '' ? LOOKUP_PAGING.defaultPage : Number(rawPage);
  const requestedLimit = rawLimit === undefined || rawLimit === '' ? LOOKUP_PAGING.defaultLimit : Number(rawLimit);
  if (!Number.isInteger(page) || page < 1) {
    throw createHttpError(400, 'page must be a positive integer.', 'INVALID_LOOKUP_PAGE');
  }
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    throw createHttpError(400, 'limit must be a positive integer.', 'INVALID_LOOKUP_LIMIT');
  }
  const limit = Math.min(requestedLimit, LOOKUP_PAGING.maximumLimit);
  return { page, limit, offset: (page - 1) * limit, fetchLimit: limit + 1 };
};

const normalizeLookupInput = (input = {}) => {
  const keys = Object.keys(input || {});
  const forbiddenKey = keys.find((key) => FORBIDDEN_LOOKUP_KEYS.some((blocked) => blocked.toLowerCase() === key.toLowerCase()));
  if (forbiddenKey) {
    throw createHttpError(400, `${forbiddenKey} is not accepted by the lookup API.`, 'ARBITRARY_LOOKUP_TARGET_REJECTED');
  }
  const unknownKey = keys.find((key) => !LOOKUP_QUERY_KEYS.some((allowed) => allowed.toLowerCase() === key.toLowerCase()));
  if (unknownKey) {
    throw createHttpError(400, `Unknown lookup parameter ${unknownKey}.`, 'UNKNOWN_LOOKUP_PARAMETER');
  }
  if (input.q !== undefined && input.query !== undefined && text(input.q) !== text(input.query)) {
    throw createHttpError(400, 'q and query cannot contain different values.', 'CONFLICTING_LOOKUP_QUERY');
  }

  const search = text(input.q ?? input.query);
  if (search.length > LOOKUP_PAGING.maximumSearchLength) {
    throw createHttpError(
      400,
      `Lookup search is limited to ${LOOKUP_PAGING.maximumSearchLength} characters.`,
      'LOOKUP_SEARCH_TOO_LONG',
    );
  }
  const itemCode = text(input.itemCode);
  if (itemCode.length > 50) {
    throw createHttpError(400, 'itemCode is too long.', 'INVALID_ITEM_CODE');
  }
  return {
    ...parsePaging(input),
    search,
    like: `%${escapeLikeValue(search)}%`,
    itemCode,
    fieldId: text(input.fieldId),
    schemaVersion: text(input.schemaVersion),
    documentType: text(input.documentType),
  };
};

const normalizeOption = (row, source) => {
  const value = rowValue(row, 'value');
  if (value === null || value === undefined || text(value) === '') return null;
  if (source === 'owners') {
    const firstName = text(rowValue(row, 'firstName'));
    const lastName = text(rowValue(row, 'lastName'));
    const name = [firstName, lastName].filter(Boolean).join(' ') || String(value);
    return { value: String(value), label: name, description: name };
  }
  const label = text(rowValue(row, 'label')) || String(value);
  return {
    value: String(value),
    label,
    description: text(rowValue(row, 'description')) || label,
  };
};

const pageOptions = ({ source, rows, page, limit, schemaVersion }) => {
  const seen = new Set();
  const normalized = [];
  for (const row of rows || []) {
    const option = normalizeOption(row, source);
    // CUVV is an ordered SAP list and may intentionally contain duplicate
    // rows. Removing them here also breaks the raw-row pagination boundary.
    if (!option || (source !== 'sap-user-values' && seen.has(option.value))) continue;
    seen.add(option.value);
    normalized.push(option);
  }
  const hasMore = normalized.length > limit;
  return {
    source,
    items: normalized.slice(0, limit),
    page,
    limit,
    hasMore,
    ...(schemaVersion ? { schemaVersion } : {}),
  };
};

const findColumn = (columns, candidates) => {
  for (const candidate of candidates) {
    const match = (columns || []).find((column) => upper(column.columnName) === upper(candidate));
    if (match) return match.columnName;
  }
  return '';
};

const buildLinkedTableSql = ({
  tableName,
  codeColumn,
  labelColumn,
  descriptionColumn,
  dialect: rawDialect = 'sqlserver',
}) => {
  const dialect = normalizeSqlDialect(rawDialect);
  const table = quoteIdentifier(normalizeSapIdentifier(tableName, 'Linked table'), dialect);
  const code = quoteIdentifier(normalizeSapIdentifier(codeColumn, 'Lookup code column'), dialect);
  const label = quoteIdentifier(
    normalizeSapIdentifier(labelColumn || codeColumn, 'Lookup label column'),
    dialect,
  );
  const description = quoteIdentifier(
    normalizeSapIdentifier(descriptionColumn || labelColumn || codeColumn, 'Lookup description column'),
    dialect,
  );
  return `
    SELECT
      ${aliased(`CAST(${code} AS NVARCHAR(254))`, 'value', dialect)},
      ${aliased(`CAST(${label} AS NVARCHAR(254))`, 'label', dialect)},
      ${aliased(`CAST(${description} AS NVARCHAR(254))`, 'description', dialect)}
    FROM ${table}
    WHERE @search = ''
      OR ${literalLike(`CAST(${code} AS NVARCHAR(254))`)}
      OR ${literalLike(`CAST(${label} AS NVARCHAR(254))`)}
    ORDER BY ${label}, ${code}
    ${paginationClause(dialect)}
  `;
};

const findSchemaField = (schema, fieldId, { formValues = false } = {}) => {
  const match = text(fieldId).match(/^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
  let document;
  try {
    document = resolveSalesDocument(schema?.documentType);
  } catch (_error) {
    document = null;
  }
  const allowedTables = new Set(
    document ? [document.headerTable, document.lineTable].map(upper) : [],
  );
  if (!match || !allowedTables.has(upper(match[1]))) {
    throw createHttpError(400, 'A valid allowlisted sales-document fieldId is required.', 'INVALID_LOOKUP_FIELD');
  }
  const fields = [...(schema.headerFields || []), ...(schema.lineFields || [])];
  const field = fields.find((candidate) => upper(candidate.id) === upper(fieldId));
  if (!field || (upper(field.storage) !== 'UDF' && !(formValues && field.lookup?.source === 'sap-user-values'))) {
    throw createHttpError(404, 'The lookup field is not present in the current company schema.', 'LOOKUP_FIELD_NOT_FOUND');
  }
  return field;
};

const createNewSalesOrderLookupService = ({
  readOnlyDb = readOnlyDbService,
  metadata = metadataRepository,
  schemas = schemaService,
  customLookups = null,
} = {}) => {
  const getDialect = async (context) => normalizeSqlDialect(
    typeof metadata.getDialect === 'function'
      ? await metadata.getDialect(context)
      : (typeof readOnlyDb.getDialect === 'function'
        ? await readOnlyDb.getDialect(context)
        : context?.dbDialect),
  );

  const queryRows = async (context, source, sql, paging, extraParams = {}) => readOnlyDb.select({
    context,
    queryId: `lookup.${source}`,
    sql,
    params: {
      search: paging.search,
      like: paging.like,
      offset: paging.offset,
      fetchLimit: paging.fetchLimit,
      ...extraParams,
    },
  });

  const getSacOptions = async (context, paging, dialect) => {
    const columns = await metadata.getTableColumns(context, 'OSAC', { dialect });
    const entryColumn = findColumn(columns, ['AbsEntry']);
    const codeColumn = findColumn(columns, ['ServCode', 'ServiceCode']);
    const nameColumn = findColumn(columns, ['ServName', 'ServiceName']) || codeColumn;
    if (!codeColumn) {
      throw createHttpError(422, 'SAC lookup is not supported by this company database.', 'SAC_METADATA_UNAVAILABLE');
    }
    const sql = buildLinkedTableSql({
      tableName: 'OSAC',
      codeColumn: entryColumn || codeColumn,
      labelColumn: codeColumn,
      descriptionColumn: nameColumn,
      dialect,
    });
    return queryRows(context, 'sac-codes', sql, paging);
  };

  const getDynamicOptions = async (context, source, paging, suppliedSchema, dialect) => {
    const schema = suppliedSchema || await schemas.getSchema(context, paging.documentType);
    if (paging.schemaVersion && paging.schemaVersion !== schema.schemaVersion) {
      throw createHttpError(409, 'The document field schema changed. Reload the page.', 'STALE_SCHEMA_VERSION', {
        currentSchemaVersion: schema.schemaVersion,
      });
    }
    const field = findSchemaField(schema, paging.fieldId, { formValues: source === 'sap-user-values' });

    if (source === 'udf-valid-values' || source === 'sap-user-values') {
      const values = source === 'sap-user-values' ? field.userValueOptions : field.options;
      if (!Array.isArray(values) || (source === 'udf-valid-values' && !values.length)) {
        if (source === 'sap-user-values') {
          throw createHttpError(422, 'This field has no SAP form value list.', 'SAP_FORM_VALUES_UNAVAILABLE');
        }
        throw createHttpError(422, 'This field has no UFD1 valid values.', 'UDF_VALID_VALUES_UNAVAILABLE');
      }
      const search = paging.search.toLowerCase();
      const matches = values.filter((option) => !search
        || String(option.value || '').toLowerCase().includes(search)
        || String(option.label || '').toLowerCase().includes(search));
      const start = paging.offset;
      const rows = matches.slice(start, start + paging.fetchLimit);
      return { rows, schema };
    }

    let tableName;
    if (source === 'udf-linked-table') {
      tableName = text(field.linkedTable);
      if (!tableName) {
        throw createHttpError(422, 'This field has no CUFD LinkedTable metadata.', 'LINKED_TABLE_UNAVAILABLE');
      }
    } else {
      if (!text(field.relUDO)) {
        throw createHttpError(422, 'This field has no CUFD RelUDO metadata.', 'UDO_LOOKUP_UNAVAILABLE');
      }
      tableName = await metadata.resolveUdoTable(context, field.relUDO);
      if (!tableName) {
        throw createHttpError(422, 'The related UDO table could not be resolved.', 'UDO_LOOKUP_UNAVAILABLE');
      }
    }

    const approvedTable = normalizeSapIdentifier(tableName, 'Linked table');
    if (!await metadata.tableExists(context, approvedTable, { dialect })) {
      throw createHttpError(422, 'The linked lookup table does not exist in the current company.', 'LINKED_TABLE_UNAVAILABLE');
    }
    const columns = await metadata.getTableColumns(context, approvedTable, { dialect });
    const codeColumn = findColumn(columns, LINKED_TABLE_COLUMN_CANDIDATES.code);
    const labelColumn = findColumn(columns, LINKED_TABLE_COLUMN_CANDIDATES.label) || codeColumn;
    if (!codeColumn) {
      throw createHttpError(422, 'The linked table has no approved lookup code column.', 'LINKED_TABLE_COLUMNS_UNAVAILABLE');
    }
    const sql = buildLinkedTableSql({ tableName: approvedTable, codeColumn, labelColumn, dialect });
    const rows = await queryRows(context, source, sql, paging);
    return { rows, schema };
  };

  const getLookup = async (context, rawSource, input = {}, options = {}) => {
    const source = text(rawSource).toLowerCase();
    const customMatch = source.match(CUSTOM_LOOKUP_SOURCE);
    if (!LOOKUP_SOURCE_SET.has(source) && !customMatch) {
      throw createHttpError(404, 'Lookup source is not allowed.', 'LOOKUP_SOURCE_NOT_ALLOWED');
    }
    const paging = normalizeLookupInput(input);
    const dialect = await getDialect(context);
    let rows;
    let currentSchemaVersion = '';

    if (customMatch) {
      if (!customLookups) {
        throw createHttpError(404, 'Custom lookup source is not available.', 'CUSTOM_LOOKUP_NOT_AVAILABLE');
      }
      const definition = await customLookups.findById(context.companyId, Number(customMatch[1]));
      if (!definition) {
        throw createHttpError(404, 'Custom lookup was not found for this company.', 'CUSTOM_LOOKUP_NOT_FOUND');
      }
      const allRows = await readOnlyDb.select({
        context,
        queryId: `lookup.${source}`,
        sql: definition.QueryText,
        params: {},
      });
      const search = paging.search.toLowerCase();
      const matchingRows = search
        ? allRows.filter((row) => Object.values(row || {}).some((value) => String(value ?? '').toLowerCase().includes(search)))
        : allRows;
      rows = matchingRows.slice(paging.offset, paging.offset + paging.fetchLimit);
    } else if (['udf-valid-values', 'sap-user-values', 'udf-linked-table', 'udo'].includes(source)) {
      const dynamic = await getDynamicOptions(context, source, paging, options.schema, dialect);
      rows = dynamic.rows;
      currentSchemaVersion = dynamic.schema.schemaVersion;
    } else if (source === 'sac-codes') {
      rows = await getSacOptions(context, paging, dialect);
    } else {
      const sql = source === 'uom-codes' && paging.itemCode
        ? buildItemUomLookupSql(dialect)
        : buildStandardLookupSql(source, dialect);
      if (!sql) {
        throw createHttpError(404, 'Lookup source is not implemented.', 'LOOKUP_SOURCE_NOT_IMPLEMENTED');
      }
      rows = await queryRows(context, source, sql, paging, paging.itemCode ? { itemCode: paging.itemCode } : {});
    }

    return {
      success: true,
      companyId: Number(context.companyId),
      companyDb: text(context.companyDb),
      ...pageOptions({
        source,
        rows,
        page: paging.page,
        limit: paging.limit,
        schemaVersion: currentSchemaVersion,
      }),
    };
  };

  const validateLookupValue = async ({ trustedContext, context, schema, field, value, record } = {}) => {
    const normalizedValue = text(value);
    if (!normalizedValue || !field) return { valid: false };
    const inline = Array.isArray(field.options) ? field.options : [];
    if (inline.length) {
      return { valid: inline.some((option) => String(option?.value ?? option) === normalizedValue) };
    }
    if (field.lookup?.source === 'sap-user-values' && field.lookup.allowFreeText) return { valid: true };
    const validationLookup = field.lookup?.source === 'sap-user-values'
      ? (field.validationLookup || field.lookup) : field.lookup;
    const source = text(validationLookup?.source || field.lookupSource);
    if (!LOOKUP_SOURCE_SET.has(source) && !CUSTOM_LOOKUP_SOURCE.test(source)) return { valid: false };
    const itemCode = source === 'uom-codes' ? text(record?.values?.itemNo) : '';
    if (source === 'uom-codes' && Array.isArray(validationLookup?.dependsOn) && validationLookup.dependsOn.length && !itemCode) {
      return { valid: false };
    }
    const result = await getLookup(trustedContext || context, source, {
      q: normalizedValue,
      page: 1,
      limit: LOOKUP_PAGING.maximumLimit,
      ...(itemCode ? { itemCode } : {}),
      ...(String(source).startsWith('udf-') || source === 'udo'
        ? { fieldId: field.id, schemaVersion: schema?.schemaVersion }
        : {}),
    }, { schema });
    return { valid: result.items.some((option) => option.value === normalizedValue) };
  };

  return { getLookup, validateLookupValue };
};

const defaultService = createNewSalesOrderLookupService({ customLookups: customLookupRepository });

module.exports = defaultService;
module.exports.ITEM_UOM_LOOKUP_SQL = ITEM_UOM_LOOKUP_SQL;
module.exports.STANDARD_LOOKUP_SQL = STANDARD_LOOKUP_SQL;
module.exports.buildItemUomLookupSql = buildItemUomLookupSql;
module.exports.buildLinkedTableSql = buildLinkedTableSql;
module.exports.buildStandardLookupSql = buildStandardLookupSql;
module.exports.createNewSalesOrderLookupService = createNewSalesOrderLookupService;
module.exports.findSchemaField = findSchemaField;
module.exports.normalizeLookupInput = normalizeLookupInput;
module.exports.pageOptions = pageOptions;
