/**
 * SAP Service Layer writes for Job Work documents, generic across all 4
 * transactions — each is a registered UDO (see jobWorkProvisioningService.js),
 * so header + line writes go to a single generic resource (e.g. POST /STTL_JWPM)
 * the same way GRPO posts header+lines together to /PurchaseDeliveryNotes.
 */
const sapService = require('./sapService');
const jobWorkDb = require('./jobWorkDbService');
const { getTransaction } = require('./jobWorkSchema');
const { applyUdfValues } = require('./udfPayloadUtils');
const jobWorkIssueNotePosting = require('./jobWorkIssueNotePostingService');
const jobWorkCustomerReceiptPosting = require('./jobWorkCustomerReceiptPostingService');
const jobWorkCustomerIssuePosting = require('./jobWorkCustomerIssuePostingService');
const jobWorkReceiptReturnPosting = require('./jobWorkReceiptReturnPostingService');

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
    // Existing rows (loaded from a saved document) carry their own LineId —
    // including it tells Service Layer to update that row in place. Without
    // it, every submitted row reads as a new insert, duplicating the line on
    // every update instead of replacing it.
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

// Confirmed against the live Service Layer $metadata EntityType: a UDO's child
// table collections are NOT exposed under their physical table name — they're
// exposed as "<ObjectName>Collection" (e.g. STTL_JWP6, registered as child #6
// via createUdo's ObjectName, appears in the wire format as "6Collection").
// ObjectName is assigned as the child's 1-based position in udo.childTables,
// so that same position (matched against transaction.childTables, built from
// the identical declared order) gives us the right key here.
const buildDocumentPayload = (transaction, payload = {}) => {
  const sapPayload = buildHeaderPayload(transaction, payload.header || {});

  // Series is a raw SAP system field on the UDO itself (not a U_ custom
  // field), so it's set directly here rather than through buildHeaderPayload
  // — only meaningful on create, since a document's series can't change once
  // SAP has assigned it a number.
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

/**
 * Once the real stock movement has been posted for one of these documents,
 * the document is locked: items/quantities/warehouses/batches/bins can no
 * longer change without desyncing from what SAP actually moved. Only each
 * transaction's own whitelist of informational header fields may still be
 * edited post-posting.
 */
const LOCKED_ISSUE_NOTE_EDITABLE_FIELDS = [
  'OWOR', 'JWOPAYT', 'SLSEMP', 'TranName', 'VEHNO', 'ChallanNo', 'ChallanDt', 'NatureP', 'EWBILLNO',
];
const LOCKED_RECEIPT_NOTE_EDITABLE_FIELDS = [
  'TranName', 'VEHNO', 'ChallanNo', 'ChallanDt', 'NatureP', 'EWBILLNO', 'KNTWEIGHT',
];
const LOCKED_ISSUE_RETURN_NOTE_EDITABLE_FIELDS = [
  'TranName', 'ChallanNo', 'ChallanDt', 'NatureP',
];

/**
 * Declarative per-transaction stock-posting config — each entry describes:
 *  - `posting`: the module with validateHeader/validateLines/postStockMovements
 *    (see jobWorkIssueNotePostingService.js / jobWorkCustomerReceiptPostingService.js)
 *  - `lockedEditableFields`: header fields still editable once posted
 *  - `alreadyPostedFields`: header UDF names that, if any is set, mean the
 *    stock movement already happened (so Update must not repost or unlock)
 *  - `movements`: one entry per possible real SAP document this transaction
 *    can create — `key` matches postStockMovements' result shape, `resource`
 *    is the Service Layer endpoint, `entryField`/`numField` are this
 *    document's own dedicated link fields, `linkBackEntryField`/
 *    `linkBackNumField` are the reverse-link UDFs written onto the real SAP
 *    document (see jobWorkSchema.js's STANDARD_TABLE_UDFS).
 */
const STOCK_MOVEMENT_CONFIGS = {
  jobworkIssueNote: {
    posting: jobWorkIssueNotePosting,
    lockedEditableFields: LOCKED_ISSUE_NOTE_EDITABLE_FIELDS,
    alreadyPostedFields: ['WebInvTraDocEntry', 'WebGoodsIssDocEntry'],
    movements: [
      {
        key: 'inventoryTransfer', resource: 'StockTransfers',
        entryField: 'WebInvTraDocEntry', numField: 'WebInvTraDocNum',
        linkBackEntryField: 'JobWorkDocEntry', linkBackNumField: 'JobWorkDocNum',
      },
      {
        key: 'goodsIssue', resource: 'InventoryGenExits',
        entryField: 'WebGoodsIssDocEntry', numField: 'WebGoodsIssDocNum',
        linkBackEntryField: 'JobWorkDocEntry', linkBackNumField: 'JobWorkDocNum',
      },
    ],
  },
  customerReceiptNote: {
    posting: jobWorkCustomerReceiptPosting,
    lockedEditableFields: LOCKED_RECEIPT_NOTE_EDITABLE_FIELDS,
    alreadyPostedFields: ['WebGoodsRcptDocEntry'],
    movements: [
      {
        key: 'goodsReceipt', resource: 'InventoryGenEntries',
        entryField: 'WebGoodsRcptDocEntry', numField: 'WebGoodsRcptDocNum',
        linkBackEntryField: 'CustReceiptDocEntry', linkBackNumField: 'CustReceiptDocNum',
      },
    ],
  },
  customerIssueReturnNote: {
    posting: jobWorkCustomerIssuePosting,
    lockedEditableFields: LOCKED_ISSUE_RETURN_NOTE_EDITABLE_FIELDS,
    alreadyPostedFields: ['WebGoodsIssDocEntry'],
    movements: [
      {
        key: 'goodsIssue', resource: 'InventoryGenExits',
        entryField: 'WebGoodsIssDocEntry', numField: 'WebGoodsIssDocNum',
        linkBackEntryField: 'CustIssueDocEntry', linkBackNumField: 'CustIssueDocNum',
      },
    ],
  },
  // Only one of these three ever posts per document, decided by header.JWTYP
  // ('R' → goodsIssue + goodsReceipt together; 'RE' → inventoryTransferReturn
  // alone) — see jobWorkReceiptReturnPostingService.js. passFullLines: true
  // because this transaction has three meaningful child tables (consumption,
  // finished-goods receipt, return) instead of the usual one.
  jobworkReceiptReturnNote: {
    posting: jobWorkReceiptReturnPosting,
    passFullLines: true,
    lockedEditableFields: LOCKED_ISSUE_NOTE_EDITABLE_FIELDS,
    alreadyPostedFields: ['WebGoodsIssDocEntry', 'WebInvTraRtnDocEntry'],
    movements: [
      {
        key: 'goodsIssue', resource: 'InventoryGenExits',
        entryField: 'WebGoodsIssDocEntry', numField: 'WebGoodsIssDocNum',
        linkBackEntryField: 'JWPurRcptGIDocEntry', linkBackNumField: 'JWPurRcptGIDocNum',
      },
      {
        key: 'goodsReceipt', resource: 'InventoryGenEntries',
        entryField: 'WebGoodsRcptDocEntry', numField: 'WebGoodsRcptDocNum',
        linkBackEntryField: 'JWPurRcptGRDocEntry', linkBackNumField: 'JWPurRcptGRDocNum',
      },
      {
        key: 'inventoryTransferReturn', resource: 'StockTransfers',
        entryField: 'WebInvTraRtnDocEntry', numField: 'WebInvTraRtnDocNum',
        linkBackEntryField: 'JWPurRcptRtnDocEntry', linkBackNumField: 'JWPurRcptRtnDocNum',
      },
    ],
  },
};

// Writes the linked real-document DocEntry/DocNum onto the paperwork
// document's own dedicated fields (see jobWorkSchema.js's WebInvTraDocEntry /
// WebGoodsRcptDocEntry etc.) — kept separate from any legacy free-text ref
// fields the old add-on used, which aren't reliable SAP links.
const applyStockMovementRefs = (config, sapPayload, stockMovements) => {
  if (!config || !stockMovements) return;
  config.movements.forEach((movement) => {
    const posted = stockMovements[movement.key];
    if (!posted) return;
    sapPayload[`U_${movement.entryField}`] = posted.docEntry;
    sapPayload[`U_${movement.numField}`] = posted.docNum;
  });
};

// The other half of the golden-arrow pair: once the Job Work document itself
// has a DocEntry/DocNum, stamp them back onto the real SAP document(s) it
// created, so those documents can link back too (matches SAP's own
// base-document/target-document convention). Best-effort — the Job Work
// document is already saved by this point, so a failure here only means the
// reverse link is missing, not that anything is lost.
const linkStockMovementsBack = async (config, stockMovements, docEntry, docNum) => {
  if (!config || !stockMovements) return;
  await Promise.all(config.movements.map(async (movement) => {
    const posted = stockMovements[movement.key];
    if (!posted) return;
    try {
      await sapService.request({
        method: 'PATCH',
        url: `/${movement.resource}(${posted.docEntry})`,
        data: {
          [`U_${movement.linkBackEntryField}`]: docEntry,
          [`U_${movement.linkBackNumField}`]: docNum,
        },
      });
    } catch (error) {
      console.error(`[JobWork] Failed to link ${movement.resource}(${posted.docEntry}) back to ${docEntry}:`, error.message);
    }
  }));
};

const isAlreadyPosted = (config, header = {}) =>
  Boolean(config) && config.alreadyPostedFields.some((field) => header[`U_${field}`]);

// config.passFullLines: transactions with more than one meaningful child
// table (e.g. jobworkReceiptReturnNote's separate consumption/receipt/return
// grids) need every child table's rows, not just the primaryLineTable one —
// this opts a transaction's posting module into receiving the whole
// payload.lines map instead. header is also passed to validateLines here
// (a safe additive 4th argument existing posting modules simply ignore) so
// this same module's validation can branch on a transaction-type field.
const getLineRowsForPreSave = (config, transaction, payload) => (
  config.passFullLines
    ? (payload.lines || {})
    : ((payload.lines || {})[transaction.listFields.primaryLineTable] || [])
);

const runPreSaveChecks = async (config, transactionKey, transaction, payload) => {
  const lineRows = getLineRowsForPreSave(config, transaction, payload);
  const { items, warehouses, branches } = await jobWorkDb.getReferenceData(transactionKey);
  config.posting.validateHeader(payload.header || {}, branches);
  const itemsByCode = new Map(items.map((item) => [String(item.ItemCode || '').trim(), item]));
  const warehousesByCode = new Map(warehouses.map((wh) => [String(wh.WhsCode || '').trim(), wh]));
  config.posting.validateLines(lineRows, itemsByCode, warehousesByCode, payload.header || {});
};

const submitDocument = async (transactionKey, payload) => {
  const transaction = getTransaction(transactionKey);
  const config = STOCK_MOVEMENT_CONFIGS[transactionKey];

  if (config) {
    await runPreSaveChecks(config, transactionKey, transaction, payload);
  }

  // For transactions with real stock behind them, the paperwork document only
  // means anything if the stock actually moved — so it's posted FIRST. If SAP
  // rejects it (e.g. a warehouse missing its Branch assignment), nothing is
  // saved at all, rather than leaving an orphaned paperwork document with no
  // matching stock movement.
  let stockMovements = null;
  if (config) {
    console.log(`[JobWork] ${transactionKey} create: calling postStockMovements.`);
    const lineRows = getLineRowsForPreSave(config, transaction, payload);
    try {
      stockMovements = await config.posting.postStockMovements({ header: payload.header || {}, lines: lineRows });
    } catch (stockError) {
      console.error(`[JobWork] Stock posting failed for ${transactionKey} (document not saved):`, stockError.message);
      throw stockError;
    }
  }

  const sapPayload = buildDocumentPayload(transaction, payload);
  applyStockMovementRefs(config, sapPayload, stockMovements);

  try {
    const response = await sapService.request({
      method: 'POST',
      url: `/${transaction.udo.objectType}`,
      data: sapPayload,
    });
    const docEntry = response.data.DocEntry;
    const docNum = response.data.DocNum;
    const series = response.data.Series;

    await linkStockMovementsBack(config, stockMovements, docEntry, docNum);

    return {
      success: true,
      message: `${transaction.menuName} created successfully.`,
      doc_entry: docEntry,
      doc_num: docNum,
      series,
      ...(stockMovements ? { stock_movements: stockMovements } : {}),
    };
  } catch (error) {
    if (stockMovements && config) {
      const summary = config.movements
        .map((movement) => `${movement.key}:${stockMovements[movement.key]?.docEntry || '-'}`)
        .join(' ');
      console.error(
        `[JobWork] Stock movement posted (${summary}) but the paperwork document failed to save:`,
        error.message,
      );
    }
    console.error(`[JobWork] Submit failed for ${transactionKey}:`, error.message);
    if (error.response?.data) {
      console.error('[JobWork] SAP error response:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
};

const updateDocument = async (transactionKey, docEntry, payload) => {
  const transaction = getTransaction(transactionKey);
  const config = STOCK_MOVEMENT_CONFIGS[transactionKey];

  let stockMovements = null;
  let existingDocNum = null;
  if (config) {
    const existing = await jobWorkDb.getByDocEntry(transactionKey, docEntry);
    existingDocNum = existing.header?.DocNum ?? null;

    if (isAlreadyPosted(config, existing.header || {})) {
      console.log(`[JobWork] ${transactionKey} update: already posted (${config.alreadyPostedFields.filter((f) => existing.header?.[`U_${f}`]).join(', ')}) — skipping stock posting, PATCHing locked fields only.`);
      const restrictedHeader = {};
      for (const field of config.lockedEditableFields) {
        if (payload.header && payload.header[field] !== undefined) {
          restrictedHeader[field] = payload.header[field];
        }
      }
      const sapPayload = buildHeaderPayload(transaction, restrictedHeader);
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
    }

    console.log(`[JobWork] ${transactionKey} update: not yet posted — calling postStockMovements now.`);
    await runPreSaveChecks(config, transactionKey, transaction, payload);

    // Stock movements only ever post once per document. If this one was
    // created without a qualifying stock movement and the user has since
    // completed the lines on an edit, post it now — same "post first, save
    // only if it succeeds" guarantee as create. Already-posted documents were
    // returned above and never reach here.
    const lineRows = getLineRowsForPreSave(config, transaction, payload);
    try {
      stockMovements = await config.posting.postStockMovements({ header: payload.header || {}, lines: lineRows });
    } catch (stockError) {
      console.error(`[JobWork] Stock posting failed for ${transactionKey} update (document not saved):`, stockError.message);
      throw stockError;
    }
  }

  const sapPayload = buildDocumentPayload(transaction, payload);
  applyStockMovementRefs(config, sapPayload, stockMovements);

  // A row the user removed in the UI is simply absent from the submitted
  // array — Service Layer's PATCH never deletes on our behalf, so it has to
  // be cleaned up directly (see jobWorkDbService.deleteRemovedLines). This runs
  // before the PATCH, which would otherwise have added rows (no LineId yet)
  // that would be deleted here as well.
  const primaryLineTable = transaction.listFields.primaryLineTable;
  const submittedLines = (payload.lines || {})[primaryLineTable] || [];
  const keepLineIds = submittedLines
    .map((line) => line.LineId)
    .filter((lineId) => lineId !== undefined && lineId !== null && lineId !== '');
  await jobWorkDb.deleteRemovedLines(primaryLineTable, docEntry, keepLineIds);

  await sapService.request({
    method: 'PATCH',
    url: `/${transaction.udo.objectType}(${Number(docEntry)})`,
    data: sapPayload,
  });

  await linkStockMovementsBack(config, stockMovements, Number(docEntry), existingDocNum);

  return {
    success: true,
    message: `${transaction.menuName} updated successfully.`,
    doc_entry: docEntry,
    doc_num: existingDocNum,
    ...(stockMovements ? { stock_movements: stockMovements } : {}),
  };
};

module.exports = {
  getReferenceData: jobWorkDb.getReferenceData,
  getList: jobWorkDb.getList,
  getByDocEntry: jobWorkDb.getByDocEntry,
  getDocumentSeries: jobWorkDb.getDocumentSeries,
  getNextNumber: jobWorkDb.getNextNumber,
  getGoodsReceiptSeries: jobWorkDb.getGoodsReceiptSeries,
  getPartyAddresses: jobWorkDb.getPartyAddresses,
  getBinsByWarehouse: jobWorkDb.getBinsByWarehouse,
  getConsumableIssues: jobWorkReceiptReturnPosting.getConsumableIssues,
  submitDocument,
  updateDocument,
};
