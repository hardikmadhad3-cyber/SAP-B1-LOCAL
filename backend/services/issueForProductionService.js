/**
 * Issue for Production Service
 * SAP B1 endpoint: InventoryGenExits (Type 60 = Issue for Production)
 * Reduces stock from warehouse for production order components.
 * Backflush items (im_Backflush) are excluded — SAP handles them on receipt.
 * 
 * SAP B1 BaseType for InventoryGenExit:
 * - BaseType 202 = Production Order (OWOR)
 * - BaseType -1 or 0 = Manual (no base document)
 * 
 * Important Rules when BaseType = 202 (Production Order):
 * 1. TaxDate must be NULL/empty - SAP automatically sets it from production order
 * 2. ItemCode must be NULL/empty - SAP automatically populates from production order line
 * 3. Only Released production orders can be issued
 * 4. BaseEntry and BaseLine must reference the production order
 */
const sapService = require('./sapService');
const productionDbService = require('./productionDbService');

const opt         = (v) => v !== '' && v != null;
// ── Create issue (posts to SAP) ───────────────────────────────────────────────
const createIssue = async (body) => {
  // SAP: one issue can cover rows of several released production orders.
  const submittedLines = Array.isArray(body.lines) ? body.lines : [];
  const orderEntries = [...new Set(submittedLines.map((line) => Number(line.base_entry ?? body.prod_order_entry)).filter((entry) => entry > 0))];
  if (!orderEntries.length && body.prod_order_entry) orderEntries.push(Number(body.prod_order_entry));
  const orders = new Map();
  for (const entry of orderEntries) {
    const order = await productionDbService.getProductionOrderForIssue(entry);
    if (!order) {
      const error = new Error(`Production order ${entry} not found.`);
      error.statusCode = 404;
      throw error;
    }
    orders.set(entry, { order, lines: new Map((order.lines || []).map((line) => [Number(line.base_line), line])) });
  }
  const lines = [];
  for (const submitted of submittedLines) {
    const entry = Number(submitted.base_entry ?? body.prod_order_entry);
    const current = orders.get(entry)?.lines.get(Number(submitted.base_line));
    if (!current || String(submitted.item_code || '') !== String(current.item_code || '')) {
      const error = new Error('Production order lines changed. Reload the production order before posting.');
      error.statusCode = 409;
      throw error;
    }
    const quantity = Number(submitted.issue_qty);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > Number(current.remaining_qty || 0) + 0.000001) {
      const error = new Error(`Issue quantity for "${current.item_code}" exceeds the current open quantity.`);
      error.statusCode = 422;
      throw error;
    }
    // Resources have no stock, batches or bins.
    const allocation = current.component_type === 'pit_Resource'
      ? { manageBatch: false, manageSerial: false, binEnabled: false }
      : await productionDbService.getAllocationOptions(current.item_code, submitted.warehouse || current.warehouse, 'issue');
    lines.push({
      ...submitted,
      item_code: current.item_code,
      issue_qty: quantity,
      warehouse: submitted.warehouse || current.warehouse,
      base_entry: entry,
      base_line: current.base_line,
      base_type: 202,
      manage_batch: allocation.manageBatch,
      manage_serial: allocation.manageSerial,
      enable_bin_locations: allocation.binEnabled,
    });
  }
  const trustedBody = { ...body, prod_order_entry: orderEntries[0], lines };
  await productionDbService.validateBranchWarehouses(body.branch, lines.map((line) => line.warehouse));
  _validate(trustedBody);
  const payload = _buildPayload(trustedBody);

  const resp = await sapService.request({
    method: 'POST',
    url: '/InventoryGenExits',
    data: payload,
  });

  return {
    message:   'Issue for production posted successfully.',
    doc_num:   resp.data?.DocNum,
    doc_entry: resp.data?.DocEntry,
  };
};

// SAP: cancelling an issue posts a cancellation document and puts the
// components back (only while the order is still released).
const cancelIssue = async (docEntry) => {
  const n = Number(docEntry);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid DocEntry.');
  await sapService.request({ method: 'POST', url: `/InventoryGenExits(${n})/Cancel` });
  return { message: 'Issue for production cancelled.', ...(await productionDbService.getIssueByDocEntry(n)) };
};

// ── Validation ────────────────────────────────────────────────────────────────
function _validate(body) {
  if (!body.prod_order_entry) {
    throw new Error('Production order is required.');
  }
  if (!body.posting_date) {
    throw new Error('Posting date is required.');
  }
  const validLines = (body.lines || []).filter(
    (l) => l.item_code && Number(l.issue_qty) > 0
  );
  if (validLines.length === 0) {
    throw new Error('At least one line with a valid issue quantity is required.');
  }
  for (const l of validLines) {
    const issueQty = Number(l.issue_qty);
    if (issueQty < 0) {
      throw new Error(`Issue quantity for item "${l.item_code}" cannot be negative.`);
    }
    if (!l.warehouse) {
      throw new Error(`Warehouse is required for item "${l.item_code}".`);
    }
    
    // Validate batch/serial numbers
    if (l.manage_batch) {
      const batchTotal = (l.batch_numbers || []).reduce((sum, b) => sum + Number(b.quantity || 0), 0);
      if (Math.abs(batchTotal - issueQty) > 0.001) {
        throw new Error(`Item "${l.item_code}" requires batch numbers. Total batch quantity (${batchTotal}) must equal issue quantity (${issueQty}).`);
      }
    }
    if (l.manage_serial) {
      const serialCount = (l.serial_numbers || []).length;
      if (!Number.isInteger(issueQty)) {
        throw new Error(`Item "${l.item_code}" is serial-managed and requires a whole-number issue quantity.`);
      }
      if (serialCount !== Math.floor(issueQty)) {
        throw new Error(`Item "${l.item_code}" requires serial numbers. Number of serials (${serialCount}) must equal issue quantity (${Math.floor(issueQty)}).`);
      }
    }
    const binAllocations = Array.isArray(l.bin_allocations)
      ? l.bin_allocations.filter((row) => row.bin_abs != null && row.bin_abs !== '' && Number(row.quantity) > 0)
      : [];
    if (l.enable_bin_locations) {
      const binTotal = binAllocations.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      if (Math.abs(binTotal - issueQty) > 0.001) {
        throw new Error(`Item "${l.item_code}" bin quantities (${binTotal}) must equal issue quantity (${issueQty}).`);
      }
      for (const row of binAllocations) {
        const link = Number(row.serial_batch_base_line);
        const managedRows = l.manage_batch ? (l.batch_numbers || []) : (l.serial_numbers || []);
        if ((l.manage_batch || l.manage_serial)
          && (!Number.isInteger(link) || link < 0 || link >= managedRows.length)) {
          throw new Error(`Item "${l.item_code}" requires each bin allocation to reference a batch or serial row.`);
        }
      }
      if (l.manage_batch || l.manage_serial) {
        const managedRows = l.manage_batch ? (l.batch_numbers || []) : (l.serial_numbers || []);
        managedRows.forEach((managedRow, index) => {
          const expected = l.manage_batch ? Number(managedRow.quantity || 0) : 1;
          const allocated = binAllocations
            .filter((row) => Number(row.serial_batch_base_line) === index)
            .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
          if (Math.abs(allocated - expected) > 0.001) {
            throw new Error(`Item "${l.item_code}" bin linkage for managed row ${index + 1} must total ${expected}.`);
          }
        });
      }
    } else if (binAllocations.length) {
      throw new Error(`Warehouse "${l.warehouse}" is not bin-enabled.`);
    }
  }
}

// ── Payload builder ───────────────────────────────────────────────────────────
function _buildPayload(body) {
  const p = {
    DocDate:    body.posting_date,
    // SAP B1 Rule: TaxDate must be omitted when BaseType = 202 (Production Order)
    // When linked to production order, SAP automatically sets TaxDate
    Comments:   body.remarks       || '',
    JournalMemo:body.journal_remark|| '',
    DocumentLines: (body.lines || [])
      .filter((l) => l.item_code && Number(l.issue_qty) > 0)
      .map((l, idx) => {
        const line = {
          // SAP B1 Rule: ItemCode must be omitted when BaseType = 202 (Production Order)
          // SAP automatically populates ItemCode from the production order line
          Quantity:      Number(l.issue_qty),
          WarehouseCode: l.warehouse || undefined,
          // Link back to production order line
          BaseEntry: Number(l.base_entry ?? body.prod_order_entry),
          BaseLine:  Number(l.base_line ?? idx),
          BaseType:  202,  // 202 = Production Order
        };
        if (opt(l.uom))               line.UoMCode          = l.uom;
        if (opt(l.distribution_rule)) line.DistributionRule = l.distribution_rule;
        if (opt(l.project))           line.Project          = l.project;
        if (opt(l.account_code))      line.AccountCode      = l.account_code;
        
        // Batch/Serial Numbers
        if (l.batch_numbers && Array.isArray(l.batch_numbers) && l.batch_numbers.length > 0) {
          line.BatchNumbers = l.batch_numbers.map(b => ({
            BatchNumber: b.batch_number,
            Quantity:    Number(b.quantity),
          }));
        }
        if (l.serial_numbers && Array.isArray(l.serial_numbers) && l.serial_numbers.length > 0) {
          line.SerialNumbers = l.serial_numbers.map(s => ({
            InternalSerialNumber: s.serial_number,
          }));
        }
        if (Array.isArray(l.bin_allocations) && l.bin_allocations.length > 0) {
          line.DocumentLinesBinAllocations = l.bin_allocations
            .filter((row) => row.bin_abs != null && row.bin_abs !== '' && Number(row.quantity) > 0)
            .map((row) => ({
              BinAbsEntry: Number(row.bin_abs),
              Quantity: Number(row.quantity),
              BaseLineNumber: idx,
              ...((l.manage_batch || l.manage_serial)
                ? { SerialAndBatchNumbersBaseLine: Number(row.serial_batch_base_line) }
                : {}),
            }));
        }
        
        return line;
      }),
  };

  if (opt(body.series)) p.Series = Number(body.series);
  if (opt(body.ref_2))  p.Reference2 = body.ref_2;
  if (opt(body.branch)) p.BPL_IDAssignedToInvoice = Number(body.branch);

  return p;
}

const getReferenceDataByOdbc = (options) => productionDbService.getIssueReferenceData(options);
const getSeries = (date, branch) => productionDbService.lookupSeriesContext('60', date, branch);
const getAllocationOptions = (itemCode, warehouse) =>
  productionDbService.getAllocationOptions(itemCode, warehouse, 'issue');

const getProductionOrderForIssueByOdbc = async (docEntry) => {
  const data = await productionDbService.getProductionOrderForIssue(docEntry);
  if (!data) throw Object.assign(new Error('Production order not found.'), { statusCode: 404 });
  return data;
};

const getIssueListByOdbc = (query) => productionDbService.getIssueList(query);

const getIssueByDocEntryByOdbc = async (docEntry) => {
  const data = await productionDbService.getIssueByDocEntry(docEntry);
  if (!data) throw Object.assign(new Error('Issue for production not found.'), { statusCode: 404 });
  return data;
};

module.exports = {
  getReferenceData: getReferenceDataByOdbc,
  getProductionOrderForIssue: getProductionOrderForIssueByOdbc,
  getIssueList: getIssueListByOdbc,
  getIssueByDocEntry: getIssueByDocEntryByOdbc,
  createIssue,
  cancelIssue,
  lookupProductionOrders: (query = '', type = '') => productionDbService.lookupOpenProductionOrders(query, true, type, { issueableOnly: true }),
  getSeries,
  getAllocationOptions,
  _private: { _validate, _buildPayload },
};
