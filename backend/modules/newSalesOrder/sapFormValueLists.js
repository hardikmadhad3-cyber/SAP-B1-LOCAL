'use strict';

const { aliased, columnReference, quoteIdentifier } = require('./newSalesOrderSqlDialect');

// CSHS/CUVV are form-specific suggestion lists, separate from CUFD/UFD1
// constraints. Only ActionT=1 is read; stored SQL (ActionT=2) is never executed.
async function readSapFormValueLists({ context, document, dialect, getTableColumns, readOnlyDb }) {
  const required = { CSHS: ['FormID', 'ItemID', 'ColID', 'ActionT', 'IndexID'], CUVV: ['IndexID', 'Value', 'LineNum'] };
  for (const [table, names] of Object.entries(required)) {
    const columns = await getTableColumns(context, table, { dialect });
    const present = new Set(columns.map(c => c.columnName.toUpperCase()));
    if (!names.every(name => present.has(name.toUpperCase()))) return [];
  }
  const c = (table, name) => columnReference(table, name, dialect);
  return readOnlyDb.select({
    context, queryId: `metadata.form-values.${document.documentType}`,
    sql: `SELECT ${aliased(c('S', 'ItemID'), 'itemId', dialect)},
      ${aliased(c('S', 'ColID'), 'columnId', dialect)},
      ${aliased(c('S', 'IndexID'), 'indexId', dialect)},
      ${aliased(c('V', 'Value'), 'value', dialect)}
      FROM ${quoteIdentifier('CSHS', dialect)} S
      LEFT JOIN ${quoteIdentifier('CUVV', dialect)} V ON ${c('S', 'IndexID')} = ${c('V', 'IndexID')}
      WHERE ${c('S', 'FormID')} = @formId AND ${c('S', 'ActionT')} = 1
      ORDER BY ${c('S', 'IndexID')}, ${c('V', 'LineNum')}`,
    params: { formId: document.formType },
  });
}

function applySapFormValueLists(schema, rows, document, layoutRows = []) {
  const upper = value => String(value ?? '').trim().toUpperCase();
  const attach = (field, line) => {
    const fieldNames = [field.databaseField, field.sapField].map(upper);
    const layout = line ? layoutRows.find(row => upper(row.tableName) === upper(document.lineTable)
      && fieldNames.includes(upper(row.fieldName))) : null;
    const matches = (rows || []).filter(row => line
      ? String(row.itemId) === String(document.matrixId)
        && (fieldNames.includes(upper(row.columnId)) || (layout && String(layout.columnUid) === String(row.columnId)))
      : String(row.columnId) === '-1' && fieldNames.includes(upper(row.itemId)));
    if (!matches.length) return field;
    return {
      ...field,
      // Keep the original options: form suggestions are not valid-value constraints.
      userValueOptions: matches.filter(row => row.value !== null && row.value !== undefined && String(row.value).trim())
        .map(row => ({ value: String(row.value), label: String(row.value) })),
      validationLookup: field.lookup,
      lookup: { source: 'sap-user-values', fieldId: field.id, allowFreeText: !field.lookup && !field.options?.length },
      lookupSource: 'sap-user-values',
    };
  };
  return { ...schema, headerFields: schema.headerFields.map(f => attach(f, false)), lineFields: schema.lineFields.map(f => attach(f, true)) };
}

module.exports = { readSapFormValueLists, applySapFormValueLists };
