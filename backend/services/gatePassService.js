/**
 * SAP Service Layer writes for Gate Pass masters and transactions.
 * Transactions are registered UDOs — header + line writes go to a single
 * generic resource (e.g. POST /STGTPV), same pattern as jobWorkService.js.
 * Masters are plain bott_MasterData UDTs, exposed by Service Layer as
 * generic OData entities under `/U_<TableName>` with built-in Code/Name
 * columns — no UDO registration needed for those.
 */
const sapService = require('./sapService');
const db = require('./dbService');
const gatePassDb = require('./gatePassDbService');
const { getMaster, getTransaction } = require('./gatePassSchema');
const { applyUdfValues } = require('./udfPayloadUtils');

const formatDateForSAP = (value) => (value ? String(value).split('T')[0] : null);

const buildUdfDefinitionsByKey = (fields) =>
  new Map(fields.map((field) => [`U_${field.name}`, { key: `U_${field.name}`, type: field.type, maxLength: field.size }]));

const buildHeaderPayload = (transaction, header = {}) => {
  const payload = {};
  const definitionsByKey = buildUdfDefinitionsByKey(transaction.masterFields);
  const udfValues = {};
  for (const field of transaction.masterFields) {
    const value = header[field.name];
    if (value === undefined) continue;
    udfValues[`U_${field.name}`] = field.type === 'Date' ? formatDateForSAP(value) : value;
  }
  applyUdfValues(payload, udfValues, null, definitionsByKey);
  return payload;
};

const buildLinesPayload = (transaction, tableName, rows = []) => {
  const fields = transaction.childFields[tableName] || [];
  const definitionsByKey = buildUdfDefinitionsByKey(fields);

  return rows.map((row) => {
    const linePayload = {};
    if (row.LineId !== undefined && row.LineId !== null && row.LineId !== '') {
      linePayload.LineId = Number(row.LineId);
    }
    const udfValues = {};
    for (const field of fields) {
      const value = row[field.name];
      if (value === undefined) continue;
      udfValues[`U_${field.name}`] = field.type === 'Date' ? formatDateForSAP(value) : value;
    }
    applyUdfValues(linePayload, udfValues, null, definitionsByKey);
    return linePayload;
  });
};

// Same wire-format convention confirmed for Job Work: a UDO's child table
// collections are exposed as "<ObjectName>Collection" (1-based position in
// udo.childTables), not the physical table name.
const buildDocumentPayload = (transaction, payload = {}) => {
  const sapPayload = buildHeaderPayload(transaction, payload.header || {});

  if (payload.header?.Series !== undefined && payload.header?.Series !== null && String(payload.header.Series).trim()) {
    sapPayload.Series = Number(payload.header.Series);
  }

  transaction.childTables.forEach((childTable, index) => {
    const rows = (payload.lines || {})[childTable.name];
    if (Array.isArray(rows)) {
      sapPayload[`${index + 1}Collection`] = buildLinesPayload(transaction, childTable.name, rows);
    }
  });

  return sapPayload;
};

const submitDocument = async (transactionKey, payload) => {
  const transaction = getTransaction(transactionKey);
  const sapPayload = buildDocumentPayload(transaction, payload);

  try {
    const response = await sapService.request({
      method: 'POST',
      url: `/${transaction.udo.objectType}`,
      data: sapPayload,
    });
    return {
      success: true,
      message: `${transaction.menuName} created successfully.`,
      doc_entry: response.data.DocEntry,
      doc_num: response.data.DocNum,
      series: response.data.Series,
    };
  } catch (error) {
    console.error(`[GatePass] Submit failed for ${transactionKey}:`, error.message);
    if (error.response?.data) {
      console.error('[GatePass] SAP error response:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
};

const updateDocument = async (transactionKey, docEntry, payload) => {
  const transaction = getTransaction(transactionKey);
  const sapPayload = buildDocumentPayload(transaction, payload);

  // Rows removed in the UI are deleted before the PATCH: afterwards the rows it
  // just added (no LineId in the payload) would be deleted too.
  const primaryLineTable = transaction.listFields.primaryLineTable;
  const submittedLines = (payload.lines || {})[primaryLineTable] || [];
  const keepLineIds = submittedLines
    .map((line) => line.LineId)
    .filter((lineId) => lineId !== undefined && lineId !== null && lineId !== '');
  await gatePassDb.deleteRemovedLines(primaryLineTable, docEntry, keepLineIds);

  await sapService.request({
    method: 'PATCH',
    url: `/${transaction.udo.objectType}(${Number(docEntry)})`,
    data: sapPayload,
  });

  return {
    success: true,
    message: `${transaction.menuName} updated successfully.`,
    doc_entry: docEntry,
  };
};

// --- Masters (Visitor Type / Visit Type) ---

const getNextMasterCode = async (master) => {
  const table = `"@${master.table.name}"`;
  const dialect = await db.getDialect();
  // PostgreSQL has no TRY_CAST; its regex is bound as a parameter so the SQL rewrite leaves it alone.
  const numericCode = {
    hana: `CASE WHEN "Code" LIKE_REGEXPR '^[0-9]+$' THEN CAST("Code" AS INTEGER) ELSE 0 END`,
    postgres: 'CASE WHEN "Code" ~ @digits THEN CAST("Code" AS INTEGER) ELSE 0 END',
  }[dialect] || 'TRY_CAST("Code" AS INT)';
  const rows = await db.query(`
    SELECT ISNULL(MAX(${numericCode}), 0) + 1 AS next_code FROM ${table}
  `, { digits: '^[0-9]+$' }).then((res) => res.recordset || []).catch(() => []);
  const nextCode = Number(rows[0]?.next_code || 1);
  return String(nextCode).padStart(3, '0');
};

const createMasterRow = async (masterKey, { name }) => {
  const master = getMaster(masterKey);
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    const error = new Error('Name is required.');
    error.statusCode = 400;
    throw error;
  }

  const code = await getNextMasterCode(master);
  const response = await sapService.request({
    method: 'POST',
    url: `/U_${master.table.name}`,
    data: { Code: code, Name: trimmedName },
  });
  return { code: response.data.Code ?? code, name: response.data.Name ?? trimmedName };
};

const updateMasterRow = async (masterKey, code, { name }) => {
  const master = getMaster(masterKey);
  const trimmedName = String(name || '').trim();
  if (!trimmedName) {
    const error = new Error('Name is required.');
    error.statusCode = 400;
    throw error;
  }

  await sapService.request({
    method: 'PATCH',
    url: sapService.buildStringKeyPath(`U_${master.table.name}`, code),
    data: { Name: trimmedName },
  });
  return { code, name: trimmedName };
};

const deleteMasterRow = async (masterKey, code) => {
  const master = getMaster(masterKey);
  await sapService.request({
    method: 'DELETE',
    url: sapService.buildStringKeyPath(`U_${master.table.name}`, code),
  });
  return { success: true };
};

module.exports = {
  getMasterList: gatePassDb.getMasterList,
  createMasterRow,
  updateMasterRow,
  deleteMasterRow,
  getList: gatePassDb.getList,
  getByDocEntry: gatePassDb.getByDocEntry,
  submitDocument,
  updateDocument,
};
