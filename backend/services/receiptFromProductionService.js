/**
 * Receipt from Production Service
 *
 * SAP B1 endpoint: InventoryGenEntries (Type 59 = Receipt from Production)
 */
const sapService = require('./sapService');
const productionDbService = require('./productionDbService');

const opt = (v) => v !== '' && v != null;
const EPSILON = 0.000001;

const toQty = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const createReceipt = async (body) => {
  const currentOrder = await productionDbService.getProductionOrderForReceipt(body.prod_order_entry);
  if (!currentOrder) {
    const error = new Error('Production order not found.');
    error.statusCode = 404;
    throw error;
  }
  const orderDetail = await productionDbService.getProductionOrderByDocEntry(body.prod_order_entry);
  const componentLines = orderDetail?.production_order?.lines || [];
  const allowedComponents = new Map(componentLines.map((line) => [Number(line.base_line ?? line.line_num), line]));
  const isDisassembly = currentOrder.type === 'bopotDisassemble';
  const lines = [];
  for (const submitted of (Array.isArray(body.lines) ? body.lines : [])) {
    const baseLine = Number(submitted.base_line ?? 0);
    const isParent = !isDisassembly && baseLine === 0
      && String(submitted.item_code || '') === String(currentOrder.item_code || '');
    // A by-product row added on the page carries row 0; find its order row by item.
    let component = allowedComponents.get(baseLine);
    if (!isParent && (!component || String(component.item_code || '') !== String(submitted.item_code || ''))) {
      component = componentLines.find((line) => String(line.item_code || '') === String(submitted.item_code || '')
        && (isDisassembly || Number(line.planned_qty || 0) < 0));
    }
    const isAllowedComponent = Boolean(component)
      && String(component.item_code || '') === String(submitted.item_code || '')
      && (isDisassembly || Number(component.planned_qty || 0) < 0);
    if (!isParent && !isAllowedComponent) {
      const error = new Error('Production order lines changed or contain an invalid receipt line. Reload before posting.');
      error.statusCode = 409;
      throw error;
    }
    const quantity = toQty(submitted.quantity);
    const openQuantity = isParent
      ? Number(currentOrder.remaining_qty || 0)
      : Math.max(0, Math.abs(Number(component.planned_qty || 0)) - Math.abs(Number(component.issued_qty || 0)));
    if (quantity <= 0 || quantity > openQuantity + EPSILON) {
      const error = new Error(`Receipt quantity for "${submitted.item_code}" exceeds the current open quantity.`);
      error.statusCode = 422;
      throw error;
    }
    const warehouse = submitted.warehouse || (isParent ? currentOrder.warehouse : component.warehouse);
    const allocation = await productionDbService.getAllocationOptions(submitted.item_code, warehouse, 'receipt');
    lines.push({
      ...submitted,
      quantity,
      warehouse,
      base_entry: currentOrder.doc_entry,
      base_line: isParent ? baseLine : Number(component.base_line ?? component.line_num),
      base_type: 202,
      by_product: !isParent,
      manage_batch: allocation.manageBatch,
      manage_serial: allocation.manageSerial,
      enable_bin_locations: allocation.binEnabled,
    });
  }
  const trustedBody = {
    ...body,
    prod_order_entry: currentOrder.doc_entry,
    item_code: currentOrder.item_code,
    remaining_qty: currentOrder.remaining_qty,
    return_components: isDisassembly,
    lines,
  };
  await productionDbService.validateBranchWarehouses(body.branch, lines.map((line) => line.warehouse));
  _validate(trustedBody);
  const payload = _buildPayload(trustedBody);

  const resp = await sapService.request({
    method: 'POST',
    url: '/InventoryGenEntries',
    data: payload,
  });

  return {
    message: 'Receipt from production posted successfully.',
    doc_num: resp.data?.DocNum,
    doc_entry: resp.data?.DocEntry,
  };
};

function _assertManagedBinBreakdown(line, kind, expectedRows, binAllocations) {
  const totals = new Map();

  for (const allocation of binAllocations) {
    let baseLine = allocation.serial_batch_base_line;
    if ((baseLine === '' || baseLine == null) && expectedRows.length === 1) {
      baseLine = 0;
    }

    const normalizedBaseLine = Number(baseLine);
    if (!Number.isInteger(normalizedBaseLine) || normalizedBaseLine < 0 || normalizedBaseLine >= expectedRows.length) {
      throw new Error(`Item "${line.item_code}" requires ${kind} bin linkage. Choose a valid ${kind} row for each bin allocation.`);
    }

    totals.set(normalizedBaseLine, (totals.get(normalizedBaseLine) || 0) + toQty(allocation.quantity));
  }

  expectedRows.forEach((row, index) => {
    const expectedQty = kind === 'serial' ? 1 : toQty(row.quantity);
    const actualQty = totals.get(index) || 0;
    if (Math.abs(actualQty - expectedQty) > EPSILON) {
      throw new Error(
        `Item "${line.item_code}" bin allocations for ${kind} row ${index + 1} total ${actualQty}, but ${expectedQty} is required.`
      );
    }
  });
}

function _validate(body) {
  if (!body.prod_order_entry) {
    throw new Error('Production order is required.');
  }
  if (!body.posting_date) {
    throw new Error('Posting date is required.');
  }

  const validLines = Array.isArray(body.lines)
    ? body.lines.filter((line) => line.item_code && toQty(line.quantity) > 0)
    : [];

  const mainLines = validLines.filter((line) => !line.by_product);
  const primaryLine = mainLines[0] || validLines[0];
  const itemCode = body.item_code || primaryLine?.item_code;
  const receiptQty = body.receipt_qty != null ? toQty(body.receipt_qty) : toQty(primaryLine?.quantity);
  const isReturnComponents = body.return_components === true || body.return_components === 'Y';

  if (!itemCode) {
    throw new Error('Finished goods item code is required.');
  }
  if (!receiptQty || receiptQty <= 0) {
    throw new Error('Receipt quantity must be greater than 0.');
  }
  if (validLines.length === 0 && (!body.item_code || !body.receipt_qty)) {
    throw new Error('At least one receipt line with a valid quantity is required.');
  }
  if (!isReturnComponents && mainLines.length === 0) {
    throw new Error('Exactly one main finished goods line is required. Mark additional output lines as by-products.');
  }
  if (!isReturnComponents && mainLines.length > 1) {
    throw new Error('Only one main finished goods line is allowed per receipt. Mark the other lines as by-products.');
  }

  const remainingQty = Number(body.remaining_qty ?? Infinity);
  if (!isReturnComponents && remainingQty !== Infinity && receiptQty > remainingQty + EPSILON) {
    throw new Error(`Receipt quantity (${receiptQty}) exceeds remaining quantity (${remainingQty.toFixed(2)}).`);
  }

  for (const line of validLines) {
    if (!line.warehouse) {
      throw new Error(`Warehouse is required for item "${line.item_code}".`);
    }

    const lineQty = toQty(line.quantity);
    const batchNumbers = Array.isArray(line.batch_numbers) ? line.batch_numbers.filter((row) => row.batch_number && toQty(row.quantity) > 0) : [];
    const serialNumbers = Array.isArray(line.serial_numbers) ? line.serial_numbers.filter((row) => row.serial_number) : [];
    const binAllocations = Array.isArray(line.bin_allocations)
      ? line.bin_allocations.filter((row) => row.bin_abs != null && row.bin_abs !== '' && toQty(row.quantity) > 0)
      : [];

    if (line.manage_batch) {
      if (batchNumbers.length === 0) {
        throw new Error(`Item "${line.item_code}" requires batch numbers.`);
      }
      const batchTotal = batchNumbers.reduce((sum, row) => sum + toQty(row.quantity), 0);
      if (Math.abs(batchTotal - lineQty) > EPSILON) {
        throw new Error(`Item "${line.item_code}" batch quantities (${batchTotal}) must equal receipt quantity (${lineQty}).`);
      }
    }

    if (line.manage_serial) {
      if (serialNumbers.length === 0) {
        throw new Error(`Item "${line.item_code}" requires serial numbers.`);
      }
      if (!Number.isInteger(lineQty) || serialNumbers.length !== lineQty) {
        throw new Error(`Item "${line.item_code}" serial count (${serialNumbers.length}) must equal the integer receipt quantity (${lineQty}).`);
      }
    }

    if (!line.enable_bin_locations && binAllocations.length > 0) {
      throw new Error(`Item "${line.item_code}" has bin allocations, but warehouse "${line.warehouse}" is not bin-enabled.`);
    }

    if (line.enable_bin_locations) {
      if (binAllocations.length === 0) {
        throw new Error(`Bin allocations are required for item "${line.item_code}" in warehouse "${line.warehouse}".`);
      }

      const binTotal = binAllocations.reduce((sum, row) => sum + toQty(row.quantity), 0);
      if (Math.abs(binTotal - lineQty) > EPSILON) {
        throw new Error(`Item "${line.item_code}" bin quantities (${binTotal}) must equal receipt quantity (${lineQty}).`);
      }

      if (line.manage_batch) {
        _assertManagedBinBreakdown(line, 'batch', batchNumbers, binAllocations);
      } else if (line.manage_serial) {
        _assertManagedBinBreakdown(line, 'serial', serialNumbers, binAllocations);
      }
    }
  }
}

function _buildPayload(body) {
  const hasProductionOrderBase =
    Number(body.prod_order_entry) > 0 ||
    (Array.isArray(body.lines) && body.lines.some((line) => Number(line.base_type ?? 202) === 202 && Number(line.base_entry ?? body.prod_order_entry) > 0));

  const payload = {
    DocDate: body.posting_date,
    Comments: body.remarks || '',
    JournalMemo: body.journal_remark || '',
  };

  if (!hasProductionOrderBase) {
    payload.TaxDate = body.document_date || body.posting_date;
  }

  if (opt(body.series)) payload.Series = Number(body.series);
  if (opt(body.ref_2)) payload.Reference2 = body.ref_2;
  if (opt(body.branch)) payload.BPL_IDAssignedToInvoice = Number(body.branch);
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    payload.DocumentLines = body.lines
      .filter((line) => line.item_code && toQty(line.quantity) > 0)
      .map((line, idx) => {
        const batchNumbers = Array.isArray(line.batch_numbers)
          ? line.batch_numbers.filter((row) => row.batch_number && toQty(row.quantity) > 0)
          : [];
        const serialNumbers = Array.isArray(line.serial_numbers)
          ? line.serial_numbers.filter((row) => row.serial_number)
          : [];
        const binAllocations = Array.isArray(line.bin_allocations)
          ? line.bin_allocations.filter((row) => row.bin_abs != null && row.bin_abs !== '' && toQty(row.quantity) > 0)
          : [];

        const docLine = {
          Quantity: toQty(line.quantity),
          WarehouseCode: line.warehouse || undefined,
          LineNum: idx,
        };

        const baseEntry = opt(line.base_entry) ? Number(line.base_entry) : Number(body.prod_order_entry);
        if (Number.isFinite(baseEntry) && baseEntry > 0) {
          docLine.BaseEntry = baseEntry;
          // SAP: the finished product has no base row; by-products and returned components do.
          if (line.by_product || body.return_components) docLine.BaseLine = opt(line.base_line) ? Number(line.base_line) : 0;
          docLine.BaseType = opt(line.base_type) ? Number(line.base_type) : 202;
        } else {
          docLine.ItemCode = line.item_code;
        }

        if (opt(line.uom_code)) docLine.UoMCode = line.uom_code;
        if (opt(line.distribution_rule)) docLine.DistributionRule = line.distribution_rule;
        if (opt(line.project)) docLine.Project = line.project;
        // SAP values production receipts itself (WIP cost / item cost); a price is only sent without a production base.
        if (opt(line.unit_price) && !docLine.BaseEntry) docLine.Price = Number(line.unit_price);
        const transactionType = String(line.trans_type || 'Complete').toLowerCase();
        docLine.TransactionType = transactionType === 'reject' ? 'botrntReject' : 'botrntComplete';

        if (batchNumbers.length > 0) {
          docLine.BatchNumbers = batchNumbers.map((row) => ({
            BatchNumber: row.batch_number,
            Quantity: toQty(row.quantity),
            ...(opt(row.expiry_date) && { ExpiryDate: row.expiry_date }),
            ...(opt(row.manufacturing_date) && { ManufacturingDate: row.manufacturing_date }),
            ...(opt(row.notes) && { Notes: row.notes }),
          }));
        }

        if (serialNumbers.length > 0) {
          docLine.SerialNumbers = serialNumbers.map((row) => ({
            InternalSerialNumber: row.serial_number,
            Quantity: 1,
          }));
        }

        if (binAllocations.length > 0) {
          docLine.DocumentLinesBinAllocations = binAllocations.map((row) => {
            const binLine = {
              BinAbsEntry: Number(row.bin_abs),
              Quantity: toQty(row.quantity),
              BaseLineNumber: idx,
            };

            if ((line.manage_batch || line.manage_serial) && opt(row.serial_batch_base_line)) {
              binLine.SerialAndBatchNumbersBaseLine = Number(row.serial_batch_base_line);
            } else if ((line.manage_batch && batchNumbers.length === 1) || (line.manage_serial && serialNumbers.length === 1)) {
              binLine.SerialAndBatchNumbersBaseLine = 0;
            }

            if (row.allow_negative_quantity) {
              binLine.AllowNegativeQuantity = 'tYES';
            }

            return binLine;
          });
        }

        return docLine;
      });
  } else {
    const receiptQty = toQty(body.receipt_qty);
    const fgLine = {
      ItemCode: body.item_code,
      Quantity: receiptQty,
      WarehouseCode: body.warehouse || undefined,
      BaseEntry: Number(body.prod_order_entry),
      BaseLine: 0,
      BaseType: 202,
    };

    if (opt(body.uom)) fgLine.UoMCode = body.uom;
    if (opt(body.distribution_rule)) fgLine.DistributionRule = body.distribution_rule;
    if (opt(body.project)) fgLine.Project = body.project;

    payload.DocumentLines = [fgLine];
  }

  return payload;
}

const getReferenceDataByOdbc = (options) => productionDbService.getReceiptReferenceData(options);
const getSeries = (date, branch) => productionDbService.lookupSeriesContext('59', date, branch);
const getAllocationOptions = (itemCode, warehouse) =>
  productionDbService.getAllocationOptions(itemCode, warehouse, 'receipt');

const getProductionOrderForReceiptByOdbc = async (docEntry) => {
  const data = await productionDbService.getProductionOrderForReceipt(docEntry);
  if (!data) throw Object.assign(new Error('Production order not found.'), { statusCode: 404 });
  return data;
};

const getReceiptListByOdbc = (query) => productionDbService.getReceiptList(query);

const getReceiptByDocEntryByOdbc = async (docEntry) => {
  const data = await productionDbService.getReceiptByDocEntry(docEntry);
  if (!data) throw Object.assign(new Error('Receipt from production not found.'), { statusCode: 404 });
  return data;
};

const lookupProductionOrdersByOdbc = (query = '', type = '') =>
  productionDbService.lookupOpenProductionOrders(query, true, type, { receiptOpenOnly: true });

module.exports = {
  getReferenceData: getReferenceDataByOdbc,
  getProductionOrderForReceipt: getProductionOrderForReceiptByOdbc,
  getReceiptList: getReceiptListByOdbc,
  getReceiptByDocEntry: getReceiptByDocEntryByOdbc,
  createReceipt,
  cancelReceipt: async (docEntry) => {
    const n = Number(docEntry);
    if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid DocEntry.');
    // SAP: a cancellation document takes the products back out (only while the order is released).
    await sapService.request({ method: 'POST', url: `/InventoryGenEntries(${n})/Cancel` });
    return { message: 'Receipt from production cancelled.', ...(await productionDbService.getReceiptByDocEntry(n)) };
  },
  lookupProductionOrders: lookupProductionOrdersByOdbc,
  getSeries,
  getAllocationOptions,
  _private: { _validate, _buildPayload, _assertManagedBinBreakdown },
};
