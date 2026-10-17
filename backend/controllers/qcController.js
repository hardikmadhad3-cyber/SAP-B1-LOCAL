const qcDb = require('../services/qcDbService');
const db = require('../services/dbService');
const grpoService = require('../services/grpoService');
const authDbService = require('../services/authDbService');

const QC_FORM_DEFINITIONS = [
  {
    file: 'frmBParMap.xml',
    uid: 'frmBParMap',
    title: 'Item-wise Parameter Mapping',
    fields: ['Remarks', 'Item Code', 'Item Name', 'Active', 'User'],
    actions: ['OK', 'Cancel'],
  },
  {
    file: 'frmBR.xml',
    uid: 'frmBR',
    title: 'Batch Released Form',
    fields: ['Branch', 'Item Code', 'Item Name', 'Product Code', 'DocNum', 'DocDate', 'Status', 'IT Approved', 'IT Reject', 'CN Reject', 'Remarks', 'QC Done By', 'Item Group', 'Unit', 'Next Re-Test Days', 'Assay (Min-Max)', 'Water (Min-Max)', 'Good Issue (Sample Qty)', 'Specific Gravity', 'Water Per Volume', 'Min Sample Qty'],
    actions: ['Add', 'Cancel', 'Delete', 'Display', 'Browse', 'Process', 'Print Status'],
  },
  { file: 'frmCpyPara.xml', uid: 'frmCpyPara', title: 'Select Item', fields: ['Search'], actions: ['Process', 'Cancel'] },
  {
    file: 'frmIQC.xml',
    uid: 'frmIQC',
    title: 'Inward QC',
    fields: ['Item Code', 'Item Name', 'Document Key', 'Warehouse', 'Document No', 'Date', 'Quantity', 'Sample Qty', 'Remark', 'User', 'IT No', 'Reduce Sample Qty', 'Good Issue No', 'Reduce Qty Issue', 'QC Status', 'GL Account', 'Approver', 'Pass Whs', 'Reject Whs', 'Rework Whs', 'Document No.', 'GRPO', 'AR Credit Note', 'Ignore QC Result'],
    actions: ['OK', 'Cancel', 'Load Parameter'],
  },
  { file: 'frmIns.xml', uid: 'frmIns', title: 'Inspection', fields: ['Item Code', 'Item Name', 'Document No', 'Document Key', 'Line No'], actions: ['OK', 'Cancel'] },
  { file: 'frmInstrument.xml', uid: 'frmInstrument', title: 'Instrument Master', fields: ['Instrument Code', 'Instrument Name', 'Remarks', 'Active'], actions: ['OK', 'Cancel'] },
  { file: 'frmLic.xml', uid: 'frmLic', title: 'License', fields: [], actions: ['Cancel', 'OK'] },
  { file: 'frmLicAuth.xml', uid: 'frmLicAuth', title: 'Add-On License Authorization', fields: ['Product Id', 'Authorization No'], actions: ['OK', 'Cancel'] },
  { file: 'frmLicAuth1.xml', uid: 'frmLicAuth', title: 'New Form 2', fields: [], actions: [] },
  { file: 'frmLicImp.xml', uid: 'frmLicImp', title: 'Add-On License Import', fields: ['File Path :'], actions: ['Import File', '...'] },
  {
    file: 'frmPQC.xml',
    uid: 'frmPQC',
    title: 'In-Process QC',
    fields: ['Item Code', 'Item Name', 'Document Key', 'Warehouse', 'Document No', 'Date', 'Quantity', 'Sample Qty', 'Remark', 'User', 'IT No.', 'Reduce Sample Qty', 'Good Issue No', 'Reduce Qty Issue', 'QC Status', 'GL Account', 'Approver', 'Pass Whs', 'Reject Whs', 'Rework Whs', 'Document No.', 'Ignore QC Result'],
    actions: ['OK', 'Cancel', 'Load Parameter'],
  },
  {
    file: 'frmParMap.xml',
    uid: 'frmParMap',
    title: 'Parameter Mapping',
    fields: ['Remarks', 'Item Code', 'Item Group Code', 'Active', 'Item Wise', 'Item Group Wise', 'User', 'Document No.'],
    actions: ['OK', 'Cancel', 'Copy Parameter'],
  },
  { file: 'frmParameter.xml', uid: 'frmParameter', title: 'Parameter Master', fields: ['Parameter Code', 'Parameter Name', 'Remarks', 'Active'], actions: ['OK', 'Cancel'] },
  { file: 'frmQueue.xml', uid: 'frmQueue', title: 'Quality Check Queue', fields: ['From Date', 'To Date', 'ItemCode', 'Ignore QC Process'], actions: ['Cancel', 'OK', 'Load Data', 'Collapse', 'Expand'] },
  { file: 'frmRTQCR.xml', uid: 'frmRTQCR', title: 'Retest QC Request Form', fields: ['Branch', 'Unit', 'Doc No', 'DocDate', 'Ref No'], actions: ['Fetch Data', 'Add', 'Cancel', 'Process'] },
  {
    file: 'frmReQC.xml',
    uid: 'frmReQC',
    title: 'Re Process QC',
    fields: ['Item Code', 'Item Name', 'Document Key', 'Warehouse', 'Document No', 'Date', 'Quantity', 'Sample Qty', 'Remark', 'User', 'IT No.', 'Reduce Sample Qty', 'Good Issue No', 'Reduce Qty Issue', 'QC Status', 'GL Account', 'Approver', 'Pass Whs', 'Reject Whs', 'Rework Whs', 'Document No.', 'Ignore QC Result'],
    actions: ['OK', 'Cancel', 'Load Parameter'],
  },
  { file: 'frmUST.xml', uid: 'frmUST', title: 'User Settings', fields: ['Product Id', 'Document No'], actions: ['OK', 'Cancel'] },
];

const TABLES = {
  addons: {
    table: 'qc_addons',
    orderBy: 'id DESC',
    required: ['addon_code', 'addon_name', 'version'],
    fields: ['addon_code', 'addon_name', 'version', 'status', 'description'],
    defaults: { status: 'active' },
  },
  mappings: {
    table: 'qc_document_mappings',
    orderBy: 'id DESC',
    required: ['document_type', 'document_code', 'qc_workflow', 'inspection_level'],
    fields: [
      'document_type',
      'document_code',
      'qc_workflow',
      'inspection_level',
      'mandatory_inspection',
      'block_outward_if_failed',
      'is_active',
    ],
    defaults: {
      mandatory_inspection: 0,
      block_outward_if_failed: 0,
      is_active: 1,
    },
  },
  parameters: {
    table: 'qc_parameters',
    orderBy: 'id DESC',
    required: ['parameter_code', 'parameter_name', 'parameter_type'],
    fields: [
      'parameter_code',
      'parameter_name',
      'parameter_type',
      'uom',
      'test_method',
      'is_ctq',
      'spec_min',
      'spec_max',
      'spec_target',
      'allowed_values',
    ],
    defaults: { is_ctq: 0 },
  },
  workflows: {
    table: 'qc_workflows',
    orderBy: 'id DESC',
    required: ['workflow_name', 'workflow_type', 'trigger_event', 'assigned_inspector'],
    fields: [
      'workflow_name',
      'workflow_type',
      'trigger_event',
      'assigned_inspector',
      'approval_required',
      'is_active',
    ],
    defaults: { approval_required: 'No Approval', is_active: 1 },
  },
  transactions: {
    table: 'qc_transactions',
    orderBy: 'id DESC',
    required: ['transaction_no', 'direction', 'source_type', 'item_code', 'quantity'],
    fields: [
      'transaction_no',
      'direction',
      'source_type',
      'source_doc_no',
      'source_doc_entry',
      'source_line_num',
      'party_name',
      'item_code',
      'lot_no',
      'quantity',
      'uom',
      'inspection_status',
      'final_decision',
      'inspector_name',
      'inspection_date',
      'remarks',
    ],
    defaults: {
      inspection_status: 'Open',
      final_decision: 'Pending',
    },
  },
  itemParameterMappings: {
    table: 'qc_item_parameter_mappings',
    orderBy: 'id DESC',
    required: ['item_code', 'parameter_code'],
    fields: [
      'item_code',
      'item_name',
      'parameter_code',
      'parameter_name',
      'instrument_code',
      'instrument_name',
      'uom',
      'parameter_type',
      'rule_name',
      'from_value',
      'to_value',
      'expected_value',
      'is_optional',
      'remarks',
      'is_active',
      'user_name',
      'document_no',
      'so_num',
      'so_key',
    ],
    defaults: {
      is_optional: 0,
      is_active: 1,
    },
  },
  instruments: {
    table: 'qc_instruments',
    orderBy: 'id DESC',
    required: ['instrument_code', 'instrument_name'],
    fields: [
      'instrument_code',
      'instrument_name',
      'remarks',
      'is_active',
    ],
    defaults: {
      is_active: 1,
    },
  },
};

const mapItemParameterMappingResponse = (row) => {
  if (!row || typeof row !== 'object') {
    return row;
  }

  const { document_no, so_num, so_key, ...rest } = row;
  return rest;
};

const RESPONSE_TRANSFORMS = {
  itemParameterMappings: mapItemParameterMappingResponse,
};

const BOOLEAN_FIELDS = new Set([
  'mandatory_inspection',
  'block_outward_if_failed',
  'is_active',
  'is_ctq',
  'is_optional',
]);

const toIntBoolean = (value) => {
  if (value === true || value === 1 || value === '1') return 1;
  return 0;
};

const sanitizePayload = (entityKey, payload = {}) => {
  const config = TABLES[entityKey];
  const next = { ...config.defaults };

  for (const field of config.fields) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      next[field] = BOOLEAN_FIELDS.has(field) ? toIntBoolean(payload[field]) : payload[field];
    }
  }

  return next;
};

const validateRequired = (entityKey, payload) => {
  const required = TABLES[entityKey].required;
  for (const field of required) {
    const value = payload[field];
    if (value === undefined || value === null || String(value).trim() === '') {
      return field;
    }
  }
  return null;
};

const listEntity = (entityKey) => {
  const { table, orderBy } = TABLES[entityKey];
  return async (_req, res) => {
    const rows = await qcDb.queryRows(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    const transform = RESPONSE_TRANSFORMS[entityKey];
    res.json(transform ? rows.map((row) => transform(row)) : rows);
  };
};

const createEntity = (entityKey) => {
  const { table, fields } = TABLES[entityKey];
  return async (req, res) => {
    try {
      const payload = sanitizePayload(entityKey, req.body || {});
      const missingField = validateRequired(entityKey, payload);
      if (missingField) {
        return res.status(400).json({ message: `${missingField} is required.` });
      }

      const insertFields = fields.filter((field) => payload[field] !== undefined);
      const placeholders = insertFields.map((field) => `@${field}`).join(', ');
      const columns = insertFields.join(', ');

      const result = await qcDb.execute(
        `INSERT INTO ${table} (${columns}, updated_at) VALUES (${placeholders}, CURRENT_TIMESTAMP)`,
        payload,
      );

      const row = await qcDb.queryOne(`SELECT * FROM ${table} WHERE id = @id`, { id: result.lastInsertRowid });
      const transform = RESPONSE_TRANSFORMS[entityKey];
      return res.status(201).json(transform ? transform(row) : row);
    } catch (error) {
      const message = String(error?.message || 'Failed to create record.');
      const isConflict = message.toLowerCase().includes('unique');
      return res.status(isConflict ? 409 : 500).json({ message });
    }
  };
};

const updateEntity = (entityKey) => {
  const { table, fields } = TABLES[entityKey];
  return async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: 'Invalid id.' });
      }

      const payload = sanitizePayload(entityKey, req.body || {});
      const updateFields = fields.filter((field) => Object.prototype.hasOwnProperty.call(payload, field));

      if (!updateFields.length) {
        return res.status(400).json({ message: 'No fields provided for update.' });
      }

      const setClause = updateFields.map((field) => `${field} = @${field}`).join(', ');
      const result = await qcDb.execute(
        `UPDATE ${table} SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`,
        { ...payload, id },
      );

      if (!result.changes) {
        return res.status(404).json({ message: 'Record not found.' });
      }

      const row = await qcDb.queryOne(`SELECT * FROM ${table} WHERE id = @id`, { id });
      const transform = RESPONSE_TRANSFORMS[entityKey];
      return res.json(transform ? transform(row) : row);
    } catch (error) {
      const message = String(error?.message || 'Failed to update record.');
      const isConflict = message.toLowerCase().includes('unique');
      return res.status(isConflict ? 409 : 500).json({ message });
    }
  };
};

const deleteEntity = (entityKey) => {
  const { table } = TABLES[entityKey];
  return async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid id.' });
    }

    const result = await qcDb.execute(`DELETE FROM ${table} WHERE id = @id`, { id });
    if (!result.changes) {
      return res.status(404).json({ message: 'Record not found.' });
    }

    return res.json({ success: true });
  };
};

const saveItemParameterMappingHeader = async (req, res) => {
  try {
    const itemCode = String(req.body?.item_code || '').trim();
    if (!itemCode) {
      return res.status(400).json({ message: 'item_code is required.' });
    }

    const remarks = String(req.body?.remarks || '').trim();
    const userName = String(req.body?.user_name || '').trim();
    const itemName = String(req.body?.item_name || '').trim();
    const isActive = toIntBoolean(req.body?.is_active);

    const result = await qcDb.execute(
      `UPDATE qc_item_parameter_mappings
       SET
         remarks = @remarks,
         user_name = @user_name,
         item_name = @item_name,
         is_active = @is_active,
         updated_at = CURRENT_TIMESTAMP
       WHERE LOWER(TRIM(item_code)) = LOWER(TRIM(@item_code))`,
      {
        item_code: itemCode,
        remarks,
        user_name: userName,
        item_name: itemName,
        is_active: isActive,
      },
    );

    const rows = await qcDb.queryRows(
      `SELECT *
       FROM qc_item_parameter_mappings
       WHERE LOWER(TRIM(item_code)) = LOWER(TRIM(@item_code))
       ORDER BY id DESC`,
      { item_code: itemCode },
    );

    return res.json({
      success: true,
      item_code: itemCode,
      updated_count: Number(result.changes || 0),
      rows: rows.map(mapItemParameterMappingResponse),
    });
  } catch (error) {
    const message = String(error?.message || 'Failed to save mapping header.');
    return res.status(500).json({ message });
  }
};

const listForms = (_req, res) => {
  res.json(QC_FORM_DEFINITIONS);
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const getRequestDatabaseName = async (req) => {
  try {
    if (!req?.auth?.userId || !req?.auth?.companyId) return '';
    const assignedCompany = await authDbService.getAssignedCompanyForUser(req.auth.userId, req.auth.companyId);
    const dbName = String(assignedCompany?.DbName || '').trim();
    if (dbName) return dbName;
    return String(assignedCompany?.SapCompanyDb || '').trim();
  } catch (_error) {
    return '';
  }
};

const normalizeDecision = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'accepted') return 'Accepted';
  if (raw === 'rejected') return 'Rejected';
  return 'Pending';
};

const parsePendingInspectionPayload = async ({ direction = 'Inward', sourceType = 'GRPO' } = {}) => {
  const completedRows = await qcDb.queryRows(
    `SELECT
      source_doc_entry,
      source_line_num,
      item_code,
      lot_no
    FROM qc_transactions
    WHERE UPPER(TRIM(direction)) = UPPER(TRIM(@direction))
      AND UPPER(TRIM(source_type)) = UPPER(TRIM(@source_type))
      AND (
        UPPER(TRIM(final_decision)) IN ('ACCEPTED', 'REJECTED')
        OR UPPER(TRIM(inspection_status)) IN ('CLOSED', 'RELEASED')
      )`,
    {
      direction,
      source_type: sourceType,
    },
  );

  const completedLineKeys = new Set();
  for (const row of completedRows) {
    const docEntry = String(row.source_doc_entry ?? '').trim();
    const lineNum = String(row.source_line_num ?? '').trim();
    const itemCode = normalizeText(row.item_code);
    if (!docEntry || !lineNum || !itemCode) continue;
    completedLineKeys.add(`${docEntry}|${lineNum}|${itemCode}`);
  }

  const mappedRows = await qcDb.queryRows(
    `SELECT DISTINCT item_code
     FROM qc_item_parameter_mappings
     WHERE COALESCE(is_active, 1) = 1`,
  );
  const mappedItemCodes = new Set(
    mappedRows
      .map((row) => normalizeText(row.item_code))
      .filter(Boolean),
  );

  return { completedLineKeys, mappedItemCodes };
};

const getPendingGrpoRowsFromSap = async ({ vendorCode = '', docEntry = null, databaseName = '' } = {}) => {
  const normalizedVendorCode = String(vendorCode || '').trim();
  const parsedDocEntry = Number(docEntry);
  const normalizedDocEntry = Number.isFinite(parsedDocEntry) && parsedDocEntry > 0
    ? Math.trunc(parsedDocEntry)
    : null;

  const rows = await db.query(
    `SELECT
      H.DocEntry AS doc_entry,
      H.DocNum AS doc_num,
      H.DocDate AS doc_date,
      H.CardCode AS party_code,
      H.CardName AS party_name,
      L.LineNum AS line_num,
      L.ItemCode AS item_code,
      COALESCE(NULLIF(L.Dscription, ''), I.ItemName, '') AS item_name,
      L.WhsCode AS whs_code,
      CAST(COALESCE(NULLIF(L.OpenQty, 0), L.Quantity, 0) AS DECIMAL(19, 6)) AS open_qty,
      I.ManBtchNum AS batch_managed
    FROM OPDN H
    INNER JOIN PDN1 L
      ON L.DocEntry = H.DocEntry
    INNER JOIN OITM I
      ON I.ItemCode = L.ItemCode
    WHERE H.CANCELED <> 'Y'
      AND H.DocStatus = 'O'
      AND (
        UPPER(COALESCE(L.LineStatus, '')) = 'O'
        OR COALESCE(L.OpenQty, 0) > 0
      )
      AND (@vendorCode = '' OR H.CardCode = @vendorCode)
      AND (@docEntry IS NULL OR H.DocEntry = @docEntry)
    ORDER BY H.DocDate DESC, H.DocNum DESC, L.LineNum ASC`,
    {
      vendorCode: normalizedVendorCode,
      docEntry: normalizedDocEntry,
    },
    {
      databaseName: String(databaseName || '').trim() || undefined,
    },
  );
  return rows.recordset || [];
};

const getOpenGrpoHeadersFromSap = async ({ vendorCode = '', docEntry = null, databaseName = '' } = {}) => {
  const normalizedVendorCode = String(vendorCode || '').trim();
  const parsedDocEntry = Number(docEntry);
  const normalizedDocEntry = Number.isFinite(parsedDocEntry) && parsedDocEntry > 0
    ? Math.trunc(parsedDocEntry)
    : null;

  const rows = await db.query(
    `SELECT
      H.DocEntry AS doc_entry,
      H.DocNum AS doc_num,
      H.DocDate AS doc_date,
      H.CardCode AS vendor_code,
      H.CardName AS vendor_name
    FROM OPDN H
    WHERE H.CANCELED <> 'Y'
      AND H.DocStatus = 'O'
      AND (@vendorCode = '' OR H.CardCode = @vendorCode)
      AND (@docEntry IS NULL OR H.DocEntry = @docEntry)
    ORDER BY H.DocDate DESC, H.DocNum DESC`,
    {
      vendorCode: normalizedVendorCode,
      docEntry: normalizedDocEntry,
    },
    {
      databaseName: String(databaseName || '').trim() || undefined,
    },
  );

  return rows.recordset || [];
};

const getOpenGrpoHeadersWithFallback = async ({ vendorCode = '', docEntry = null, databaseName = '' } = {}) => {
  try {
    return await getOpenGrpoHeadersFromSap({ vendorCode, docEntry, databaseName });
  } catch (primaryError) {
    const hasExplicitDb = Boolean(String(databaseName || '').trim());
    if (!hasExplicitDb) {
      throw primaryError;
    }

    // Retry using context/default DB resolution when explicit DB fails.
    return getOpenGrpoHeadersFromSap({ vendorCode, docEntry, databaseName: '' });
  }
};

const getPendingDeliveryRowsFromSap = async ({ customerCode = '', docEntry = null, databaseName = '' } = {}) => {
  const normalizedCustomerCode = String(customerCode || '').trim();
  const parsedDocEntry = Number(docEntry);
  const normalizedDocEntry = Number.isFinite(parsedDocEntry) && parsedDocEntry > 0
    ? Math.trunc(parsedDocEntry)
    : null;

  const rows = await db.query(
    `SELECT
      H.DocEntry AS doc_entry,
      H.DocNum AS doc_num,
      H.DocDate AS doc_date,
      H.CardCode AS party_code,
      H.CardName AS party_name,
      L.LineNum AS line_num,
      L.ItemCode AS item_code,
      COALESCE(NULLIF(L.Dscription, ''), I.ItemName, '') AS item_name,
      L.WhsCode AS whs_code,
      CAST(COALESCE(NULLIF(L.OpenQty, 0), L.Quantity, 0) AS DECIMAL(19, 6)) AS open_qty,
      I.ManBtchNum AS batch_managed
    FROM ODLN H
    INNER JOIN DLN1 L
      ON L.DocEntry = H.DocEntry
    INNER JOIN OITM I
      ON I.ItemCode = L.ItemCode
    WHERE H.CANCELED <> 'Y'
      AND H.DocStatus = 'O'
      AND (
        UPPER(COALESCE(L.LineStatus, '')) = 'O'
        OR COALESCE(L.OpenQty, 0) > 0
      )
      AND (@customerCode = '' OR H.CardCode = @customerCode)
      AND (@docEntry IS NULL OR H.DocEntry = @docEntry)
    ORDER BY H.DocDate DESC, H.DocNum DESC, L.LineNum ASC`,
    {
      customerCode: normalizedCustomerCode,
      docEntry: normalizedDocEntry,
    },
    {
      databaseName: String(databaseName || '').trim() || undefined,
    },
  );

  return rows.recordset || [];
};

const getOpenDeliveryHeadersFromSap = async ({ customerCode = '', docEntry = null, databaseName = '' } = {}) => {
  const normalizedCustomerCode = String(customerCode || '').trim();
  const parsedDocEntry = Number(docEntry);
  const normalizedDocEntry = Number.isFinite(parsedDocEntry) && parsedDocEntry > 0
    ? Math.trunc(parsedDocEntry)
    : null;

  const rows = await db.query(
    `SELECT
      H.DocEntry AS doc_entry,
      H.DocNum AS doc_num,
      H.DocDate AS doc_date,
      H.CardCode AS customer_code,
      H.CardName AS customer_name
    FROM ODLN H
    WHERE H.CANCELED <> 'Y'
      AND H.DocStatus = 'O'
      AND (@customerCode = '' OR H.CardCode = @customerCode)
      AND (@docEntry IS NULL OR H.DocEntry = @docEntry)
    ORDER BY H.DocDate DESC, H.DocNum DESC`,
    {
      customerCode: normalizedCustomerCode,
      docEntry: normalizedDocEntry,
    },
    {
      databaseName: String(databaseName || '').trim() || undefined,
    },
  );

  return rows.recordset || [];
};

const getOpenDeliveryHeadersWithFallback = async ({ customerCode = '', docEntry = null, databaseName = '' } = {}) => {
  try {
    return await getOpenDeliveryHeadersFromSap({ customerCode, docEntry, databaseName });
  } catch (primaryError) {
    const hasExplicitDb = Boolean(String(databaseName || '').trim());
    if (!hasExplicitDb) {
      throw primaryError;
    }

    return getOpenDeliveryHeadersFromSap({ customerCode, docEntry, databaseName: '' });
  }
};

const filterPendingQcRows = async (rows, options = {}) => {
  const {
    onlyMappedItems = true,
    direction = 'Inward',
    sourceType = 'GRPO',
    partyCodeField = 'vendor_code',
    partyNameField = 'vendor_name',
  } = options;
  const { completedLineKeys, mappedItemCodes } = await parsePendingInspectionPayload({ direction, sourceType });

  let result = rows;

  if (onlyMappedItems) {
    result = result.filter((row) => mappedItemCodes.has(normalizeText(row.item_code)));
  }

  return result
    .filter((row) => !completedLineKeys.has(`${row.doc_entry}|${row.line_num}|${normalizeText(row.item_code)}`))
    .map((row) => ({
      doc_entry: Number(row.doc_entry),
      doc_num: Number(row.doc_num),
      doc_date: row.doc_date,
      [partyCodeField]: String(row.party_code || ''),
      [partyNameField]: String(row.party_name || ''),
      line_num: Number(row.line_num),
      item_code: String(row.item_code || ''),
      item_name: String(row.item_name || ''),
      whs_code: String(row.whs_code || ''),
      open_qty: Number(row.open_qty || 0),
      batch_managed: String(row.batch_managed || '').trim().toUpperCase() === 'Y',
    }));
};

const listInwardPendingVendors = async (req, res) => {
  try {
    const databaseName = await getRequestDatabaseName(req);
    const sapRows = await getOpenGrpoHeadersWithFallback({ databaseName });
    const pendingRows = sapRows.map((row) => ({
      vendor_code: String(row.vendor_code || ''),
      vendor_name: String(row.vendor_name || ''),
      doc_entry: Number(row.doc_entry),
    }));
    const byVendor = new Map();
    for (const row of pendingRows) {
      const key = row.vendor_code;
      if (!key) continue;
      if (!byVendor.has(key)) {
        byVendor.set(key, {
          vendor_code: row.vendor_code,
          vendor_name: row.vendor_name,
          pending_documents: 0,
          pending_lines: 0,
        });
      }

      const current = byVendor.get(key);
      current.pending_lines += 1;
    }

    const docUnique = new Set();
    for (const row of pendingRows) {
      const key = `${row.vendor_code}|${row.doc_entry}`;
      if (docUnique.has(key)) continue;
      docUnique.add(key);
      const current = byVendor.get(row.vendor_code);
      if (current) current.pending_documents += 1;
    }

    res.json({
      vendors: [...byVendor.values()].sort((a, b) => a.vendor_name.localeCompare(b.vendor_name)),
      meta: {
        open_grpo_documents: pendingRows.length,
        resolved_database: databaseName || null,
      },
    });
  } catch (error) {
    return res.json({
      vendors: [],
      meta: {
        open_grpo_documents: 0,
        error: String(error?.message || 'Failed to load pending GRPO vendors for inward QC.'),
      },
    });
  }
};

const listInwardPendingDocuments = async (req, res) => {
  try {
    const vendorCode = String(req.query?.vendorCode || '').trim();
    if (!vendorCode) {
      return res.status(400).json({ message: 'vendorCode is required.' });
    }

    const databaseName = await getRequestDatabaseName(req);
    const sapRows = await getOpenGrpoHeadersWithFallback({ vendorCode, databaseName });
    const pendingRows = sapRows.map((row) => ({
      doc_entry: Number(row.doc_entry),
      doc_num: Number(row.doc_num),
      doc_date: row.doc_date,
      vendor_code: String(row.vendor_code || ''),
      vendor_name: String(row.vendor_name || ''),
    }));
    const byDoc = new Map();
    for (const row of pendingRows) {
      const key = String(row.doc_entry);
      if (!byDoc.has(key)) {
        byDoc.set(key, {
          doc_entry: row.doc_entry,
          doc_num: row.doc_num,
          doc_date: row.doc_date,
          vendor_code: row.vendor_code,
          vendor_name: row.vendor_name,
          pending_lines: 1,
        });
      }
    }

    return res.json({
      documents: [...byDoc.values()].sort((a, b) => Number(b.doc_num || 0) - Number(a.doc_num || 0)),
    });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to load pending GRPO documents.' });
  }
};

const listInwardPendingItems = async (req, res) => {
  try {
    const rawDocEntry = String(req.query?.docEntry || '').trim();
    const docEntry = Number(rawDocEntry);
    if (!Number.isFinite(docEntry) || docEntry <= 0) {
      return res.status(400).json({ message: 'docEntry is required.' });
    }

    const databaseName = await getRequestDatabaseName(req);
    const pendingRows = await filterPendingQcRows(
      await getPendingGrpoRowsFromSap({ docEntry, databaseName }),
      { onlyMappedItems: true },
    );
    return res.json({ items: pendingRows });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to load pending GRPO items.' });
  }
};

const listInwardItemParameters = async (req, res) => {
  try {
    const itemCode = String(req.query?.itemCode || '').trim();
    if (!itemCode) {
      return res.status(400).json({ message: 'itemCode is required.' });
    }

    const rows = await qcDb.queryRows(
      `SELECT
        parameter_code,
        parameter_name,
        instrument_code,
        instrument_name,
        uom,
        parameter_type,
        rule_name,
        from_value,
        to_value,
        expected_value,
        is_optional
      FROM qc_item_parameter_mappings
      WHERE LOWER(TRIM(item_code)) = LOWER(TRIM(@item_code))
        AND COALESCE(is_active, 1) = 1
      ORDER BY id ASC`,
      { item_code: itemCode },
    );

    return res.json({
      parameters: rows.map((row) => ({
        ...row,
        is_optional: toIntBoolean(row.is_optional),
      })),
    });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to load QC parameters for item.' });
  }
};

const listOutwardItemParameters = (req, res) => listInwardItemParameters(req, res);

const listInwardItemBatches = async (req, res) => {
  try {
    const itemCode = String(req.query?.itemCode || '').trim();
    const whsCode = String(req.query?.whsCode || '').trim();
    if (!itemCode || !whsCode) {
      return res.status(400).json({ message: 'itemCode and whsCode are required.' });
    }

    const data = await grpoService.getBatchesByItem(itemCode, whsCode);
    return res.json({ batches: Array.isArray(data?.batches) ? data.batches : [] });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to load batches for item.' });
  }
};

const listOutwardItemBatches = async (req, res) => listInwardItemBatches(req, res);

const saveInwardQcInspection = async (req, res) => {
  try {
    const payload = req.body || {};
    const docEntry = Number(payload.doc_entry);
    const docNum = String(payload.doc_num || '').trim();
    const lineNum = Number(payload.line_num);
    const vendorCode = String(payload.vendor_code || '').trim();
    const vendorName = String(payload.vendor_name || '').trim();
    const itemCode = String(payload.item_code || '').trim();
    const itemName = String(payload.item_name || '').trim();
    const lotNo = String(payload.batch_no || '').trim();
    const quantity = Number(payload.quantity || 0);
    const uom = String(payload.uom || '').trim();
    const inspectorName = String(payload.inspector_name || '').trim();
    const finalDecision = normalizeDecision(payload.final_decision);
    const userRemarks = String(payload.remarks || '').trim();
    const observations = Array.isArray(payload.parameters) ? payload.parameters : [];

    if (!Number.isFinite(docEntry) || docEntry <= 0) {
      return res.status(400).json({ message: 'doc_entry is required.' });
    }
    if (!Number.isFinite(lineNum) || lineNum < 0) {
      return res.status(400).json({ message: 'line_num is required.' });
    }
    if (!itemCode) {
      return res.status(400).json({ message: 'item_code is required.' });
    }
    if (!observations.length) {
      return res.status(400).json({ message: 'At least one parameter observation is required.' });
    }

    const transactionNo = `IQC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const inspectionStatus = finalDecision === 'Pending' ? 'Open' : 'Closed';
    const inspectionData = {
      item_name: itemName,
      vendor_code: vendorCode,
      vendor_name: vendorName,
      doc_entry: docEntry,
      doc_num: docNum,
      line_num: lineNum,
      batch_no: lotNo,
      parameter_results: observations,
      remarks: userRemarks,
    };

    const result = await qcDb.execute(
      `INSERT INTO qc_transactions (
        transaction_no,
        direction,
        source_type,
        source_doc_no,
        source_doc_entry,
        source_line_num,
        party_name,
        item_code,
        lot_no,
        quantity,
        uom,
        inspection_status,
        final_decision,
        inspector_name,
        inspection_date,
        remarks,
        updated_at
      ) VALUES (
        @transaction_no,
        'Inward',
        'GRPO',
        @source_doc_no,
        @source_doc_entry,
        @source_line_num,
        @party_name,
        @item_code,
        @lot_no,
        @quantity,
        @uom,
        @inspection_status,
        @final_decision,
        @inspector_name,
        CURRENT_TIMESTAMP,
        @remarks,
        CURRENT_TIMESTAMP
      )`,
      {
        transaction_no: transactionNo,
        source_doc_no: docNum || String(docEntry),
        source_doc_entry: docEntry,
        source_line_num: lineNum,
        party_name: vendorName,
        item_code: itemCode,
        lot_no: lotNo,
        quantity,
        uom,
        inspection_status: inspectionStatus,
        final_decision: finalDecision,
        inspector_name: inspectorName,
        remarks: JSON.stringify(inspectionData),
      },
    );

    return res.status(201).json({
      success: true,
      id: result.lastInsertRowid,
      transaction_no: transactionNo,
    });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to save inward QC inspection.' });
  }
};

const listOutwardPendingCustomers = async (req, res) => {
  try {
    const databaseName = await getRequestDatabaseName(req);
    const sapRows = await getOpenDeliveryHeadersWithFallback({ databaseName });
    const pendingRows = sapRows.map((row) => ({
      customer_code: String(row.customer_code || ''),
      customer_name: String(row.customer_name || ''),
      doc_entry: Number(row.doc_entry),
    }));

    const byCustomer = new Map();
    for (const row of pendingRows) {
      const key = row.customer_code;
      if (!key) continue;
      if (!byCustomer.has(key)) {
        byCustomer.set(key, {
          customer_code: row.customer_code,
          customer_name: row.customer_name,
          pending_documents: 0,
          pending_lines: 0,
        });
      }
      byCustomer.get(key).pending_lines += 1;
    }

    const docUnique = new Set();
    for (const row of pendingRows) {
      const key = `${row.customer_code}|${row.doc_entry}`;
      if (docUnique.has(key)) continue;
      docUnique.add(key);
      const current = byCustomer.get(row.customer_code);
      if (current) current.pending_documents += 1;
    }

    return res.json({
      customers: [...byCustomer.values()].sort((a, b) => a.customer_name.localeCompare(b.customer_name)),
      meta: {
        open_delivery_documents: pendingRows.length,
        resolved_database: databaseName || null,
      },
    });
  } catch (error) {
    return res.json({
      customers: [],
      meta: {
        open_delivery_documents: 0,
        error: String(error?.message || 'Failed to load pending delivery customers for outward QC.'),
      },
    });
  }
};

const listOutwardPendingDocuments = async (req, res) => {
  try {
    const customerCode = String(req.query?.customerCode || '').trim();
    if (!customerCode) {
      return res.status(400).json({ message: 'customerCode is required.' });
    }

    const databaseName = await getRequestDatabaseName(req);
    const sapRows = await getOpenDeliveryHeadersWithFallback({ customerCode, databaseName });
    const pendingRows = sapRows.map((row) => ({
      doc_entry: Number(row.doc_entry),
      doc_num: Number(row.doc_num),
      doc_date: row.doc_date,
      customer_code: String(row.customer_code || ''),
      customer_name: String(row.customer_name || ''),
    }));

    const byDoc = new Map();
    for (const row of pendingRows) {
      const key = String(row.doc_entry);
      if (!byDoc.has(key)) {
        byDoc.set(key, {
          doc_entry: row.doc_entry,
          doc_num: row.doc_num,
          doc_date: row.doc_date,
          customer_code: row.customer_code,
          customer_name: row.customer_name,
          pending_lines: 1,
        });
      }
    }

    return res.json({
      documents: [...byDoc.values()].sort((a, b) => Number(b.doc_num || 0) - Number(a.doc_num || 0)),
    });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to load pending delivery documents.' });
  }
};

const listOutwardPendingItems = async (req, res) => {
  try {
    const rawDocEntry = String(req.query?.docEntry || '').trim();
    const docEntry = Number(rawDocEntry);
    if (!Number.isFinite(docEntry) || docEntry <= 0) {
      return res.status(400).json({ message: 'docEntry is required.' });
    }

    const databaseName = await getRequestDatabaseName(req);
    const pendingRows = await filterPendingQcRows(
      await getPendingDeliveryRowsFromSap({ docEntry, databaseName }),
      {
        onlyMappedItems: true,
        direction: 'Outward',
        sourceType: 'DELIVERY',
        partyCodeField: 'customer_code',
        partyNameField: 'customer_name',
      },
    );
    return res.json({ items: pendingRows });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to load pending delivery items.' });
  }
};

const saveOutwardQcInspection = async (req, res) => {
  try {
    const payload = req.body || {};
    const docEntry = Number(payload.doc_entry);
    const docNum = String(payload.doc_num || '').trim();
    const lineNum = Number(payload.line_num);
    const customerCode = String(payload.customer_code || '').trim();
    const customerName = String(payload.customer_name || '').trim();
    const itemCode = String(payload.item_code || '').trim();
    const itemName = String(payload.item_name || '').trim();
    const lotNo = String(payload.batch_no || '').trim();
    const quantity = Number(payload.quantity || 0);
    const uom = String(payload.uom || '').trim();
    const inspectorName = String(payload.inspector_name || '').trim();
    const finalDecision = normalizeDecision(payload.final_decision);
    const userRemarks = String(payload.remarks || '').trim();
    const observations = Array.isArray(payload.parameters) ? payload.parameters : [];

    if (!Number.isFinite(docEntry) || docEntry <= 0) {
      return res.status(400).json({ message: 'doc_entry is required.' });
    }
    if (!Number.isFinite(lineNum) || lineNum < 0) {
      return res.status(400).json({ message: 'line_num is required.' });
    }
    if (!itemCode) {
      return res.status(400).json({ message: 'item_code is required.' });
    }
    if (!observations.length) {
      return res.status(400).json({ message: 'At least one parameter observation is required.' });
    }

    const transactionNo = `OQC-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const inspectionStatus = finalDecision === 'Pending' ? 'Open' : 'Closed';
    const inspectionData = {
      item_name: itemName,
      customer_code: customerCode,
      customer_name: customerName,
      doc_entry: docEntry,
      doc_num: docNum,
      line_num: lineNum,
      batch_no: lotNo,
      parameter_results: observations,
      remarks: userRemarks,
    };

    const result = await qcDb.execute(
      `INSERT INTO qc_transactions (
        transaction_no,
        direction,
        source_type,
        source_doc_no,
        source_doc_entry,
        source_line_num,
        party_name,
        item_code,
        lot_no,
        quantity,
        uom,
        inspection_status,
        final_decision,
        inspector_name,
        inspection_date,
        remarks,
        updated_at
      ) VALUES (
        @transaction_no,
        'Outward',
        'DELIVERY',
        @source_doc_no,
        @source_doc_entry,
        @source_line_num,
        @party_name,
        @item_code,
        @lot_no,
        @quantity,
        @uom,
        @inspection_status,
        @final_decision,
        @inspector_name,
        CURRENT_TIMESTAMP,
        @remarks,
        CURRENT_TIMESTAMP
      )`,
      {
        transaction_no: transactionNo,
        source_doc_no: docNum || String(docEntry),
        source_doc_entry: docEntry,
        source_line_num: lineNum,
        party_name: customerName,
        item_code: itemCode,
        lot_no: lotNo,
        quantity,
        uom,
        inspection_status: inspectionStatus,
        final_decision: finalDecision,
        inspector_name: inspectorName,
        remarks: JSON.stringify(inspectionData),
      },
    );

    return res.status(201).json({
      success: true,
      id: result.lastInsertRowid,
      transaction_no: transactionNo,
    });
  } catch (error) {
    return res.status(500).json({ message: error?.message || 'Failed to save outward QC inspection.' });
  }
};

module.exports = {
  listForms,
  listAddons: listEntity('addons'),
  createAddon: createEntity('addons'),
  updateAddon: updateEntity('addons'),
  deleteAddon: deleteEntity('addons'),

  listMappings: listEntity('mappings'),
  createMapping: createEntity('mappings'),
  updateMapping: updateEntity('mappings'),
  deleteMapping: deleteEntity('mappings'),

  listParameters: listEntity('parameters'),
  createParameter: createEntity('parameters'),
  updateParameter: updateEntity('parameters'),
  deleteParameter: deleteEntity('parameters'),

  listWorkflows: listEntity('workflows'),
  createWorkflow: createEntity('workflows'),
  updateWorkflow: updateEntity('workflows'),
  deleteWorkflow: deleteEntity('workflows'),

  listTransactions: listEntity('transactions'),
  createTransaction: createEntity('transactions'),
  updateTransaction: updateEntity('transactions'),
  deleteTransaction: deleteEntity('transactions'),

  listItemParameterMappings: listEntity('itemParameterMappings'),
  createItemParameterMapping: createEntity('itemParameterMappings'),
  updateItemParameterMapping: updateEntity('itemParameterMappings'),
  deleteItemParameterMapping: deleteEntity('itemParameterMappings'),
  saveItemParameterMappingHeader,

  listInwardPendingVendors,
  listInwardPendingDocuments,
  listInwardPendingItems,
  listInwardItemParameters,
  listInwardItemBatches,
  saveInwardQcInspection,

  listOutwardPendingCustomers,
  listOutwardPendingDocuments,
  listOutwardPendingItems,
  listOutwardItemParameters,
  listOutwardItemBatches,
  saveOutwardQcInspection,

  listInstruments: listEntity('instruments'),
  createInstrument: createEntity('instruments'),
  updateInstrument: updateEntity('instruments'),
  deleteInstrument: deleteEntity('instruments'),
};
