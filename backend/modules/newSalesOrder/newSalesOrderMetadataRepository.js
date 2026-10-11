'use strict';

const authDbService = require('../../services/authDbService');
const readOnlyDbService = require('./newSalesOrderReadOnlyDbService');
const { readSapFormValueLists } = require('./sapFormValueLists');
const {
  SALES_DOCUMENTS,
  SALES_ORDER_DOCUMENT,
  resolveSalesDocument,
} = require('./newSalesOrderConstants');
const {
  aliased,
  columnReference,
  normalizeSqlDialect,
  quoteIdentifier,
  selectFirstClause,
} = require('./newSalesOrderSqlDialect');

const buildPhysicalColumnsSql = (rawDialect) => {
  const dialect = normalizeSqlDialect(rawDialect);
  if (dialect === 'hana') {
    return `
      SELECT
        ${aliased('T0."COLUMN_NAME"', 'columnName', dialect)},
        ${aliased('T0."DATA_TYPE_NAME"', 'dataType', dialect)},
        ${aliased('T0."LENGTH"', 'maxLength', dialect)},
        ${aliased('T0."LENGTH"', 'numericPrecision', dialect)},
        ${aliased('T0."SCALE"', 'numericScale', dialect)},
        ${aliased('T0."IS_NULLABLE"', 'isNullable', dialect)},
        ${aliased('T0."POSITION"', 'ordinalPosition', dialect)}
      FROM "SYS"."TABLE_COLUMNS" T0
      WHERE T0."SCHEMA_NAME" = CURRENT_SCHEMA
        AND T0."TABLE_NAME" = @tableName
      ORDER BY T0."POSITION"
    `;
  }
  return `
    SELECT
      ${aliased('T0.[COLUMN_NAME]', 'columnName', dialect)},
      ${aliased('T0.[DATA_TYPE]', 'dataType', dialect)},
      ${aliased('T0.[CHARACTER_MAXIMUM_LENGTH]', 'maxLength', dialect)},
      ${aliased('T0.[NUMERIC_PRECISION]', 'numericPrecision', dialect)},
      ${aliased('T0.[NUMERIC_SCALE]', 'numericScale', dialect)},
      ${aliased('T0.[IS_NULLABLE]', 'isNullable', dialect)},
      ${aliased('T0.[ORDINAL_POSITION]', 'ordinalPosition', dialect)}
    FROM [INFORMATION_SCHEMA].[COLUMNS] T0
    WHERE T0.[TABLE_NAME] = @tableName
    ORDER BY T0.[ORDINAL_POSITION]
  `;
};

const buildTableExistsSql = (rawDialect) => {
  const dialect = normalizeSqlDialect(rawDialect);
  return dialect === 'hana'
    ? `
      SELECT ${aliased('T0."TABLE_NAME"', 'tableName', dialect)}
      FROM "SYS"."TABLES" T0
      WHERE T0."SCHEMA_NAME" = CURRENT_SCHEMA
        AND T0."TABLE_NAME" = @tableName
    `
    : `
      SELECT ${aliased('T0.[TABLE_NAME]', 'tableName', dialect)}
      FROM [INFORMATION_SCHEMA].[TABLES] T0
      WHERE T0.[TABLE_NAME] = @tableName
    `;
};

const buildUfd1ValuesSql = (rawDialect) => {
  const dialect = normalizeSqlDialect(rawDialect);
  const column = (name) => columnReference('T0', name, dialect);
  return `
    SELECT
      ${aliased(column('TableID'), 'tableId', dialect)},
      ${aliased(column('FieldID'), 'fieldId', dialect)},
      ${aliased(column('IndexID'), 'indexId', dialect)},
      ${aliased(column('FldValue'), 'value', dialect)},
      ${aliased(column('Descr'), 'label', dialect)}
    FROM ${quoteIdentifier('UFD1', dialect)} T0
    WHERE ${column('TableID')} = @tableName
    ORDER BY ${column('FieldID')}, ${column('IndexID')}
  `;
};

const PHYSICAL_COLUMNS_SQL = buildPhysicalColumnsSql('sqlserver');
const TABLE_EXISTS_SQL = buildTableExistsSql('sqlserver');
const UFD1_VALUES_SQL = buildUfd1ValuesSql('sqlserver');

// CompanyId is the company's real identity; companyDb only still matches the
// legacy rows the CompanyId backfill could not attribute to exactly one company.
const LAYOUT_COMPANY_SCOPE = `(
    CompanyId = @companyId
    OR (CompanyId IS NULL AND UPPER(companyDb) = UPPER(@companyDb))
  )`;

const LAYOUT_SQL = `
  SELECT
    tableName,
    columnUid,
    fieldName,
    columnTitle,
    visible,
    editable,
    columnOrder,
    width,
    dataType,
    isUdf,
    source,
    updatedAt
  FROM sap_form_layout_columns
  WHERE ${LAYOUT_COMPANY_SCOPE}
    AND UPPER(userCode) = UPPER(@userCode)
    AND documentType = @documentType
    AND formType = @formType
    AND matrixId = @matrixId
  ORDER BY columnOrder, id
`;

// SAP Form Settings belong to a SAP B1 user. When the signed-in person has no
// layout of their own, the company's most recently synchronised one is a far
// better answer than no layout at all, which used to silently swap the page to
// an entirely different field set.
const LAYOUT_FALLBACK_USER_SQL = `
  SELECT userCode
  FROM sap_form_layout_columns
  WHERE ${LAYOUT_COMPANY_SCOPE}
    AND documentType = @documentType
    AND formType = @formType
    AND matrixId = @matrixId
  GROUP BY userCode
  ORDER BY MAX(updatedAt) DESC
  LIMIT 1
`;

const text = (value) => String(value ?? '').trim();

const rowValue = (row, ...keys) => {
  if (!row || typeof row !== 'object') return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
    const match = Object.keys(row).find((candidate) => candidate.toLowerCase() === String(key).toLowerCase());
    if (match) return row[match];
  }
  return undefined;
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizePhysicalColumn = (row) => ({
  columnName: text(rowValue(row, 'columnName', 'COLUMN_NAME')),
  databaseType: text(rowValue(row, 'dataType', 'DATA_TYPE')).toLowerCase(),
  maxLength: numberOrNull(rowValue(row, 'maxLength', 'CHARACTER_MAXIMUM_LENGTH')),
  precision: numberOrNull(rowValue(row, 'numericPrecision', 'NUMERIC_PRECISION')),
  scale: numberOrNull(rowValue(row, 'numericScale', 'NUMERIC_SCALE')),
  nullable: ['1', 'TRUE', 'Y', 'YES'].includes(
    text(rowValue(row, 'isNullable', 'IS_NULLABLE')).toUpperCase(),
  ),
  ordinal: numberOrNull(rowValue(row, 'ordinalPosition', 'ORDINAL_POSITION')) || 0,
});

const assertKnownDocumentTable = (tableName) => {
  const normalized = text(tableName).toUpperCase();
  const allowedTables = Object.values(SALES_DOCUMENTS)
    .flatMap((document) => [document.headerTable, document.lineTable]);
  if (!allowedTables.includes(normalized)) {
    const error = new Error('Only allowlisted sales-document metadata tables are available.');
    error.statusCode = 400;
    error.code = 'UNSUPPORTED_DOCUMENT_TABLE';
    throw error;
  }
  return normalized;
};

const normalizeSapIdentifier = (value, label = 'SAP table') => {
  const normalized = text(value);
  if (!/^@?[A-Za-z0-9_]{1,127}$/.test(normalized)) {
    const error = new Error(`${label} is not an approved SAP identifier.`);
    error.statusCode = 400;
    error.code = 'UNAPPROVED_SAP_IDENTIFIER';
    throw error;
  }
  return normalized;
};

const buildCufdSql = (columnNames, rawDialect = 'sqlserver') => {
  const dialect = normalizeSqlDialect(rawDialect);
  const columns = new Map([...columnNames].map((name) => [String(name).toUpperCase(), String(name)]));
  const select = (name, alias, fallback = "''") => {
    const actual = columns.get(name.toUpperCase());
    return actual
      ? aliased(columnReference('T0', actual, dialect), alias, dialect)
      : aliased(fallback, alias, dialect);
  };
  const tableId = columns.get('TABLEID') || 'TableID';
  const fieldId = columns.get('FIELDID') || 'FieldID';

  return `
    SELECT
      ${select('TableID', 'tableId')},
      ${select('FieldID', 'fieldId', 'NULL')},
      ${select('AliasID', 'aliasId')},
      ${select('Descr', 'label')},
      ${select('TypeID', 'typeId')},
      ${select('SubType', 'subType')},
      ${select('EditSize', 'editSize', 'NULL')},
      ${select('NotNull', 'notNull')},
      ${select('Mandatory', 'mandatory')},
      ${select('Editable', 'editable')},
      ${select('LinkedTable', 'linkedTable')},
      ${select('RelUDO', 'relUDO')},
      ${select('Dflt', 'defaultValue', 'NULL')}
    FROM ${quoteIdentifier('CUFD', dialect)} T0
    WHERE ${columnReference('T0', tableId, dialect)} = @tableName
    ORDER BY ${columnReference('T0', fieldId, dialect)}
  `;
};

const buildResolveUdoSql = (rawDialect) => {
  const dialect = normalizeSqlDialect(rawDialect);
  const limit = selectFirstClause(dialect, 1);
  return `
    ${limit.prefix} ${aliased(columnReference('T0', 'TableName', dialect), 'tableName', dialect)}
    FROM ${quoteIdentifier('OUDO', dialect)} T0
    WHERE ${columnReference('T0', 'Code', dialect)} = @udoCode
    ORDER BY ${columnReference('T0', 'Code', dialect)}
    ${limit.suffix}
  `;
};

const normalizeUdfKey = (aliasId) => {
  const alias = text(aliasId).replace(/[^A-Za-z0-9_]/g, '');
  if (!alias) return '';
  return alias.toUpperCase().startsWith('U_') ? alias : `U_${alias.replace(/^_+/, '')}`;
};

const createNewSalesOrderMetadataRepository = ({
  readOnlyDb = readOnlyDbService,
  authDb = authDbService,
} = {}) => {
  if (!readOnlyDb || typeof readOnlyDb.select !== 'function') {
    throw new TypeError('A New Sales Order read-only database service is required.');
  }

  const getDialect = async (context) => normalizeSqlDialect(
    typeof readOnlyDb.getDialect === 'function'
      ? await readOnlyDb.getDialect(context)
      : context?.dbDialect,
  );

  const getTableColumns = async (context, tableName, {
    documentTableOnly = false,
    dialect: suppliedDialect,
  } = {}) => {
    const normalizedTable = documentTableOnly
      ? assertKnownDocumentTable(tableName)
      : normalizeSapIdentifier(tableName);
    const dialect = normalizeSqlDialect(suppliedDialect || await getDialect(context));
    const rows = await readOnlyDb.select({
      context,
      queryId: `metadata.columns.${normalizedTable}`,
      sql: buildPhysicalColumnsSql(dialect),
      params: { tableName: normalizedTable },
    });
    return rows.map(normalizePhysicalColumn).filter((column) => column.columnName);
  };

  const tableExists = async (context, tableName, { dialect: suppliedDialect } = {}) => {
    const normalizedTable = normalizeSapIdentifier(tableName);
    const dialect = normalizeSqlDialect(suppliedDialect || await getDialect(context));
    const rows = await readOnlyDb.select({
      context,
      queryId: `metadata.table-exists.${normalizedTable}`,
      sql: buildTableExistsSql(dialect),
      params: { tableName: normalizedTable },
    });
    return rows.length > 0;
  };

  const getUdfDefinitions = async (context, tableName, cufdColumnNames, {
    dialect: suppliedDialect,
  } = {}) => {
    const normalizedTable = assertKnownDocumentTable(tableName);
    const dialect = normalizeSqlDialect(suppliedDialect || await getDialect(context));
    const udfRows = await readOnlyDb.select({
      context,
      queryId: `metadata.cufd.${normalizedTable}`,
      sql: buildCufdSql(cufdColumnNames, dialect),
      params: { tableName: normalizedTable },
    });
    const valueRows = await readOnlyDb.select({
      context,
      queryId: `metadata.ufd1.${normalizedTable}`,
      sql: buildUfd1ValuesSql(dialect),
      params: { tableName: normalizedTable },
    });

    const valuesByField = new Map();
    for (const row of valueRows) {
      const fieldId = numberOrNull(rowValue(row, 'fieldId', 'FieldID'));
      const value = rowValue(row, 'value', 'FldValue');
      if (fieldId === null || value === null || value === undefined || text(value) === '') continue;
      if (!valuesByField.has(fieldId)) valuesByField.set(fieldId, []);
      valuesByField.get(fieldId).push({
        value: String(value),
        label: text(rowValue(row, 'label', 'Descr')) || String(value),
      });
    }

    return udfRows.map((row) => {
      const fieldId = numberOrNull(rowValue(row, 'fieldId'));
      const sapField = normalizeUdfKey(rowValue(row, 'aliasId'));
      return {
        tableName: normalizedTable,
        fieldId,
        aliasId: text(rowValue(row, 'aliasId')),
        sapField,
        label: text(rowValue(row, 'label')) || sapField,
        typeId: text(rowValue(row, 'typeId')),
        subType: text(rowValue(row, 'subType')),
        maxLength: numberOrNull(rowValue(row, 'editSize')),
        required: [rowValue(row, 'notNull'), rowValue(row, 'mandatory')]
          .some((value) => text(value).toUpperCase() === 'Y'),
        readOnly: text(rowValue(row, 'editable')).toUpperCase() === 'N',
        linkedTable: text(rowValue(row, 'linkedTable')) || null,
        relUDO: text(rowValue(row, 'relUDO')) || null,
        defaultValue: rowValue(row, 'defaultValue') ?? null,
        options: valuesByField.get(fieldId) || [],
      };
    }).filter((field) => field.sapField);
  };

  const getLayoutRows = async (context, rawDocument = SALES_ORDER_DOCUMENT) => {
    const document = typeof rawDocument === 'string' ? resolveSalesDocument(rawDocument) : rawDocument;
    if (!authDb || typeof authDb.queryRows !== 'function') return [];

    const scope = {
      companyId: Number(context.companyId) || null,
      companyDb: context.companyDb,
      documentType: document.documentType,
      formType: document.formType,
      matrixId: document.matrixId,
    };

    const ownRows = await authDb.queryRows(LAYOUT_SQL, { ...scope, userCode: context.userCode });
    if (ownRows.length) return ownRows;

    const [fallback] = await authDb.queryRows(LAYOUT_FALLBACK_USER_SQL, scope);
    const fallbackUserCode = text(rowValue(fallback, 'userCode'));
    if (!fallbackUserCode) return [];
    return authDb.queryRows(LAYOUT_SQL, { ...scope, userCode: fallbackUserCode });
  };

  const getDocumentMetadata = async (context, rawDocument = SALES_ORDER_DOCUMENT) => {
    const document = typeof rawDocument === 'string' ? resolveSalesDocument(rawDocument) : rawDocument;
    const dialect = await getDialect(context);
    const [headerColumns, lineColumns, cufdColumns, layoutRows] = await Promise.all([
      getTableColumns(context, document.headerTable, { documentTableOnly: true, dialect }),
      getTableColumns(context, document.lineTable, { documentTableOnly: true, dialect }),
      getTableColumns(context, 'CUFD', { dialect }),
      getLayoutRows(context, document),
    ]);
    const cufdColumnNames = new Set(cufdColumns.map((column) => column.columnName));
    const [headerUdfs, lineUdfs] = await Promise.all([
      getUdfDefinitions(context, document.headerTable, cufdColumnNames, { dialect }),
      getUdfDefinitions(context, document.lineTable, cufdColumnNames, { dialect }),
    ]);

    return {
      dialect,
      formValueLists: await readSapFormValueLists({ context, document, dialect, getTableColumns, readOnlyDb }),
      physical: {
        [document.headerTable]: headerColumns,
        [document.lineTable]: lineColumns,
      },
      udfs: {
        [document.headerTable]: headerUdfs,
        [document.lineTable]: lineUdfs,
      },
      layout: layoutRows,
    };
  };

  const getSalesOrderMetadata = (context) => getDocumentMetadata(context, SALES_ORDER_DOCUMENT);

  const resolveUdoTable = async (context, udoCode) => {
    const normalizedCode = text(udoCode);
    if (!normalizedCode || normalizedCode.length > 20) return null;
    const dialect = await getDialect(context);
    const rows = await readOnlyDb.select({
      context,
      queryId: 'metadata.oudo.resolve-table',
      sql: buildResolveUdoSql(dialect),
      params: { udoCode: normalizedCode },
    });
    const rawTable = text(rowValue(rows[0], 'tableName', 'TableName'));
    if (!rawTable) return null;
    return normalizeSapIdentifier(rawTable.startsWith('@') ? rawTable : `@${rawTable}`, 'UDO table');
  };

  return {
    getDocumentMetadata,
    getDialect,
    getLayoutRows,
    getSalesOrderMetadata,
    getTableColumns,
    getUdfDefinitions,
    resolveUdoTable,
    tableExists,
  };
};

const defaultRepository = createNewSalesOrderMetadataRepository();

module.exports = defaultRepository;
module.exports.LAYOUT_SQL = LAYOUT_SQL;
module.exports.LAYOUT_FALLBACK_USER_SQL = LAYOUT_FALLBACK_USER_SQL;
module.exports.PHYSICAL_COLUMNS_SQL = PHYSICAL_COLUMNS_SQL;
module.exports.TABLE_EXISTS_SQL = TABLE_EXISTS_SQL;
module.exports.UFD1_VALUES_SQL = UFD1_VALUES_SQL;
module.exports.assertKnownDocumentTable = assertKnownDocumentTable;
module.exports.buildCufdSql = buildCufdSql;
module.exports.buildPhysicalColumnsSql = buildPhysicalColumnsSql;
module.exports.buildResolveUdoSql = buildResolveUdoSql;
module.exports.buildTableExistsSql = buildTableExistsSql;
module.exports.buildUfd1ValuesSql = buildUfd1ValuesSql;
module.exports.createNewSalesOrderMetadataRepository = createNewSalesOrderMetadataRepository;
module.exports.normalizePhysicalColumn = normalizePhysicalColumn;
module.exports.normalizeSapIdentifier = normalizeSapIdentifier;
module.exports.normalizeUdfKey = normalizeUdfKey;
module.exports.rowValue = rowValue;
