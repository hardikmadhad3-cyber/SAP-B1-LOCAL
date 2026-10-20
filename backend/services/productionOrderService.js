const sapService = require('./sapService');
const productionDbService = require('./productionDbService');

const formatDate  = (v) => (v ? String(v).split('T')[0] : '');

// SAP B1 ProductionOrders fields to select
// Note: Some fields may not exist in all SAP B1 versions, so we'll fetch without $select first
const opt = (v) => v !== '' && v != null;
const positiveInt = (v) => {
  if (v === '' || v == null) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

const productionError = (message, statusCode = 422, code = 'SAP_PRODUCTION_VALIDATION') =>
  Object.assign(new Error(message), { statusCode, code });

const getProductionOrderState = async (docEntry) => {
  const response = await sapService.request({ method: 'GET', url: `/ProductionOrders(${docEntry})` });
  return {
    order: response.data || {},
    etag: response.headers?.etag || response.headers?.ETag || response.data?.['@odata.etag'] || '',
  };
};

const transitionProductionOrder = async (docEntry, fromStatuses, targetStatus, extra = {}) => {
  const current = await getProductionOrderState(docEntry);
  const status = current.order.ProductionOrderStatus;
  if (!fromStatuses.includes(status)) {
    throw productionError(`Production order cannot change from "${STATUS_MAP[status] || status}" to "${STATUS_MAP[targetStatus] || targetStatus}".`, 409, 'SAP_PRODUCTION_STATUS');
  }
  await sapService.request({
    method: 'PATCH',
    url: `/ProductionOrders(${docEntry})`,
    headers: current.etag ? { 'If-Match': current.etag } : {},
    data: { ProductionOrderStatus: targetStatus, ...extra },
  });
};

const validateProductionOrderBody = async (body, { create = false } = {}) => {
  if (!String(body.item_code || '').trim()) throw productionError('Finished goods item is required.', 400);
  if (!(Number(body.planned_qty) > 0)) throw productionError('Planned quantity must be greater than zero.', 400);
  if (!body.due_date) throw productionError('Due date is required.', 400);
  if (!body.posting_date) throw productionError('Posting date is required.', 400);
  if (!String(body.warehouse || '').trim()) throw productionError('Finished goods warehouse is required.', 400);
  if (create && !['boposPlanned', 'boposReleased', '', undefined, null].includes(body.status)) {
    throw productionError('A new production order can only be created as Planned or Released.', 400);
  }
  const lineWarehouses = (body.lines || []).map((line) => line.warehouse).filter(Boolean);
  await productionDbService.validateBranchWarehouses(body.branch, [body.warehouse, ...lineWarehouses]);
};

const STATUS_MAP = {
  boposReleased:  'Released',
  boposPlanned:   'Planned',
  boposClosed:    'Closed',
  boposCancelled: 'Cancelled',
};

// ── Create ────────────────────────────────────────────────────────────────────
const createProductionOrder = async (body) => {
  console.log('[ProductionOrder] Create called with status:', body.status);
  await validateProductionOrderBody(body, { create: true });
  const isSpecialOrder = body.type === 'bopotSpecial';
  
  // Standard/Disassemble orders need a BOM. Special orders use a normal item
  // as the finished item and manual components, matching SAP B1 behavior.
  if (body.item_code && !isSpecialOrder) {
    let bomData;
    try {
      const bomResp = await sapService.request({
        method: 'GET',
        url: sapService.buildStringKeyPath('ProductTrees', body.item_code),
      });
      bomData = bomResp.data;
    } catch (err) {
      if (err.response?.status === 404 || err.response?.data?.error?.code === '-10') {
        throw new Error(
          `Item "${body.item_code}" does not have a Bill of Materials (BOM) defined. ` +
          `Please create a BOM for this item before creating a production order.`
        );
      }
      // Re-throw other errors
      throw err;
    }
    
    // Validate BOM lines for backflush + serial/batch conflict
    if (bomData?.ProductTreeLines) {
      for (const line of bomData.ProductTreeLines) {
        if (line.IssueMethod === 'im_Backflush') {
          // Check if this item is serial/batch managed
          try {
            const itemResp = await sapService.request({
              method: 'GET',
              url: sapService.buildStringKeyPath('Items', line.ItemCode),
            });
            const item = itemResp.data;
            
            if (item.ManageSerialNumbers === 'tYES' || item.ManageBatchNumbers === 'tYES') {
              throw new Error(
                `Cannot create production order: Component "${line.ItemCode}" (${line.ItemName || ''}) ` +
                `is set to backflush in the BOM but is managed by ${item.ManageSerialNumbers === 'tYES' ? 'serial' : 'batch'} numbers. ` +
                `Please update the BOM to use Manual issue method (im_Manual) for this component.`
              );
            }
          } catch (itemErr) {
            // If we can't fetch the item, let SAP handle the validation
            if (itemErr.message?.includes('Cannot create production order')) {
              throw itemErr;
            }
          }
        }
      }
    }
  }

  // Remember the desired status
  const desiredStatus = body.status;
  console.log('[ProductionOrder] Desired status:', desiredStatus);
  
  // SAP B1 requires production orders to be created as Planned
  const payload = _buildPayload(body, true); // Pass true to indicate creation
  console.log('[ProductionOrder] Payload status:', payload.ProductionOrderStatus);
  
  const resp = await sapService.request({ method: 'POST', url: '/ProductionOrders', data: payload });
  
  console.log('[ProductionOrder] Full response data:', JSON.stringify(resp.data, null, 2));
  console.log('[ProductionOrder] Response headers:', resp.headers);
  
  // SAP B1 Production Orders may return AbsoluteEntry/DocumentNumber or DocEntry/DocNum
  let docEntry = resp.data?.AbsoluteEntry || resp.data?.DocEntry;
  let docNum = resp.data?.DocumentNumber || resp.data?.DocNum;
  
  // If response doesn't contain the document details, try to extract from Location header
  if (!docEntry && resp.headers?.location) {
    const match = resp.headers.location.match(/ProductionOrders\((\d+)\)/);
    if (match) {
      docEntry = parseInt(match[1]);
      console.log('[ProductionOrder] Extracted DocEntry from Location header:', docEntry);
    }
  }
  
  // If we have docEntry but not docNum, fetch the created order to get the document number
  if (docEntry && !docNum) {
    try {
      const createdOrder = await productionDbService.getProductionOrderByDocEntry(docEntry);
      docNum = createdOrder?.production_order?.doc_num;
      console.log('[ProductionOrder] Fetched DocNum from created order:', docNum);
    } catch (err) {
      console.warn('[ProductionOrder] Could not fetch document number:', err.message);
    }
  }
  
  console.log('[ProductionOrder] Created order - DocEntry:', docEntry, 'DocNum:', docNum);
  console.log('[ProductionOrder] Checking if should auto-release:', docEntry, '&&', desiredStatus, '===', 'boposReleased', '=', (docEntry && desiredStatus === 'boposReleased'));
  
  // If user selected Released or Closed status, automatically transition after creation
  if (docEntry && desiredStatus === 'boposReleased') {
    console.log('[ProductionOrder] Auto-releasing order...');
    try {
      await transitionProductionOrder(docEntry, ['boposPlanned'], 'boposReleased');
      return {
        message: docNum 
          ? `Production order #${docNum} created and released successfully.`
          : 'Production order created and released successfully.',
        doc_num: docNum,
        doc_entry: docEntry,
      };
    } catch (err) {
      console.warn('Failed to auto-release production order:', err.message);
      throw Object.assign(
        new Error(docNum
          ? `Production order #${docNum} was created as Planned, but release failed: ${err.message}`
          : `Production order was created as Planned, but release failed: ${err.message}`),
        { statusCode: 409, code: 'SAP_PRODUCTION_PARTIAL_TRANSITION', docEntry, docNum },
      );
    }
  } else if (docEntry && desiredStatus === 'boposClosed') {
    console.log('[ProductionOrder] Auto-closing order...');
    try {
      // Must release first, then close
      await sapService.request({
        method: 'PATCH',
        url: `/ProductionOrders(${docEntry})`,
        data: { ProductionOrderStatus: 'boposReleased' },
      });
      await sapService.request({
        method: 'PATCH',
        url: `/ProductionOrders(${docEntry})`,
        data: { ProductionOrderStatus: 'boposClosed' },
      });
      return {
        message: docNum
          ? `Production order #${docNum} created and closed successfully.`
          : 'Production order created and closed successfully.',
        doc_num: docNum,
        doc_entry: docEntry,
      };
    } catch (err) {
      console.warn('Failed to auto-close production order:', err.message);
      return {
        message: docNum
          ? `Production order #${docNum} created as Planned (auto-close failed).`
          : 'Production order created as Planned (auto-close failed).',
        doc_num: docNum,
        doc_entry: docEntry,
      };
    }
  }
  
  return {
    message: docNum
      ? `Production order #${docNum} created successfully.`
      : 'Production order created successfully.',
    doc_num: docNum,
    doc_entry: docEntry,
  };
};

// ── Update ────────────────────────────────────────────────────────────────────
const updateProductionOrder = async (docEntry, body) => {
  const n = Number(docEntry);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid DocEntry.');

  await validateProductionOrderBody(body);
  const current = await getProductionOrderState(n);
  if (current.order.ProductionOrderStatus !== 'boposPlanned') {
    throw productionError('Only Planned production orders can be edited.', 409, 'SAP_PRODUCTION_STATUS');
  }
  if (body.status && body.status !== 'boposPlanned') {
    throw productionError('Use the Release or Close action to change production order status.', 400, 'SAP_PRODUCTION_STATUS');
  }
  const payload = _buildPayload({ ...body, status: 'boposPlanned' }, false);
  await sapService.request({
    method: 'PATCH',
    url: `/ProductionOrders(${n})`,
    headers: current.etag ? { 'If-Match': current.etag } : {},
    data: payload,
  });

  const updated = await productionDbService.getProductionOrderByDocEntry(n);
  return { message: 'Production order updated.', production_order: updated?.production_order || null };
};

// ── Release ───────────────────────────────────────────────────────────────────
const releaseProductionOrder = async (docEntry) => {
  const n = Number(docEntry);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid DocEntry.');

  await transitionProductionOrder(n, ['boposPlanned'], 'boposReleased');
  
  const updated = await productionDbService.getProductionOrderByDocEntry(n);
  return { message: 'Production order released.', production_order: updated?.production_order || null };
};

// ── Close ─────────────────────────────────────────────────────────────────────
// SAP closes on an actual closing date; what is left in WIP posts as variance on it.
const closeProductionOrder = async (docEntry, { closing_date: closingDate } = {}) => {
  const n = Number(docEntry);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid DocEntry.');

  await transitionProductionOrder(n, ['boposReleased'], 'boposClosed', opt(closingDate) ? { ClosingDate: formatDate(closingDate) } : {});

  const updated = await productionDbService.getProductionOrderByDocEntry(n);
  return { message: 'Production order closed.', production_order: updated?.production_order || null };
};

// Planned or released orders without issues or receipts can be cancelled.
const cancelProductionOrder = async (docEntry) => {
  const n = Number(docEntry);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid DocEntry.');

  await transitionProductionOrder(n, ['boposPlanned', 'boposReleased'], 'boposCancelled');

  const updated = await productionDbService.getProductionOrderByDocEntry(n);
  return { message: 'Production order cancelled.', production_order: updated?.production_order || null };
};

// ── Payload builder ───────────────────────────────────────────────────────────
function _buildPayload(body, isCreate = false) {
  const p = {};

  if (opt(body.item_code))    p.ItemNo                  = body.item_code;
  if (opt(body.planned_qty))  p.PlannedQuantity          = Number(body.planned_qty);
  if (opt(body.due_date))     p.DueDate                  = body.due_date;
  if (opt(body.posting_date)) p.PostingDate              = body.posting_date;
  if (opt(body.start_date))   p.StartDate                = body.start_date;
  if (opt(body.warehouse))    p.Warehouse                = body.warehouse;
  if (opt(body.priority))     p.Priority                 = Number(body.priority);
  if (opt(body.branch))       p.BPL_IDAssignedToInvoice  = Number(body.branch);
  if (opt(body.customer_code)) p.CustomerCode            = body.customer_code;
  
  // SAP B1 Rule: Production orders can only be created in Planned status
  // To release, you must create as Planned first, then call the Release action
  // Force status to Planned ONLY on creation, allow status updates during PATCH
  if (isCreate) {
    p.ProductionOrderStatus = 'boposPlanned';
  } else if (opt(body.status)) {
    // During update, allow status changes (Planned -> Released -> Closed)
    p.ProductionOrderStatus = body.status;
  }
  
  if (opt(body.type))         p.ProductionOrderType      = body.type;
  if (opt(body.distribution_rule)) p.DistributionRule   = body.distribution_rule;
  if (opt(body.project))      p.Project                  = body.project;
  if (opt(body.journal_remark)) p.JournalRemarks         = body.journal_remark;
  if (opt(body.remarks))      p.Remarks                  = body.remarks;
  if (body.pick_remarks !== undefined) p.PickRemarks     = body.pick_remarks || null;
  if (opt(body.user_id))      p.UserSignature            = Number(body.user_id);
  // SAP "Linked To": a sales order or a parent production order; otherwise manual.
  const originEntry = positiveInt(body.linked_order_entry ?? body.linked_order);
  const originType = { sales_order: 'bopooSalesOrder', production_order: 'bopooProductionOrder' }[body.linked_to];
  if (originType && originEntry) {
    p.ProductionOrderOrigin = originType;
    p.ProductionOrderOriginEntry = originEntry;
  } else {
    p.ProductionOrderOrigin = 'bopooManual';
  }
  
  // Only include Series if explicitly provided and valid
  // SAP B1 will auto-assign series if not provided
  // Series must be a valid positive integer
  const seriesNum = Number(body.series);
  if (body.series && body.series !== '' && Number.isInteger(seriesNum) && seriesNum > 0) {
    p.Series = seriesNum;
  }

  // Route stages of the order (rows refer to them by StageID).
  if (Array.isArray(body.stages)) {
    p.ProductionOrdersStages = body.stages
      .filter((stage) => opt(stage.stage_entry ?? stage.StageEntry))
      .map((stage) => ({
        StageEntry: Number(stage.stage_entry ?? stage.StageEntry),
        ...(positiveInt(stage.stage_id ?? stage.StageID) && { StageID: positiveInt(stage.stage_id ?? stage.StageID) }),
        ...(opt(stage.name ?? stage.Name) && { Name: stage.name ?? stage.Name }),
      }));
  }

  if (Array.isArray(body.lines) && body.lines.length > 0) {
    p.ProductionOrderLines = body.lines
      .filter((l) => (l.component_type === 'pit_Text' ? (l.line_text || l.item_name) : l.item_code))
      .map((l, idx) => {
        const line = {
          PlannedQuantity:  Number(l.planned_qty) || 1,
          ItemType:         l.component_type || 'pit_Item',
          LineNumber:       idx,
        };
        if (l.component_type === 'pit_Text') {
          line.LineText = l.line_text || l.item_name || '';
        } else if (opt(l.item_code)) {
          line.ItemNo = l.item_code;
        }
        if (opt(l.base_qty))           line.BaseQuantity = Number(l.base_qty);
        if (opt(l.warehouse))          line.Warehouse          = l.warehouse;
        if (opt(l.issue_method))       line.ProductionOrderIssueType = l.issue_method;
        if (opt(l.distribution_rule))  line.DistributionRule   = l.distribution_rule;
        if (opt(l.project))            line.Project            = l.project;
        if (opt(l.additional_qty))     line.AdditionalQuantity = Number(l.additional_qty);
        const stageId = positiveInt(l.stage_id || l.route_sequence);
        if (stageId)                   line.StageID            = stageId;
        return line;
      });
  }

  return p;
}

module.exports = {
  getReferenceData: productionDbService.getProductionOrderReferenceData,
  getProductionOrders: productionDbService.getProductionOrders,
  getProductionOrderByDocEntry: productionDbService.getProductionOrderByDocEntry,
  createProductionOrder,
  updateProductionOrder,
  releaseProductionOrder,
  closeProductionOrder,
  cancelProductionOrder,
  explodeBOM: productionDbService.explodeBOM,
  lookupItems: productionDbService.lookupProductionOrderItems,
  lookupComponentItems: productionDbService.lookupComponentItems,
  lookupResources: productionDbService.lookupResources,
  lookupRouteStages: productionDbService.lookupRouteStages,
  lookupWarehouses: productionDbService.lookupProdWarehouses,
  lookupDistributionRules: productionDbService.lookupDistributionRules,
  lookupProjects: productionDbService.lookupProjects,
  lookupBranches: productionDbService.lookupBranches,
  lookupCustomers: productionDbService.lookupCustomers,
  getSeries: (date, branch) => productionDbService.lookupSeriesContext('202', date, branch),
  _private: { validateProductionOrderBody, transitionProductionOrder, _buildPayload },
};
