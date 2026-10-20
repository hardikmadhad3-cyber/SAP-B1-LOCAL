// Pure SAP B1 production order rules shared by the page and its tests.

const round6 = (value) => parseFloat(Number(value || 0).toFixed(6));

// SAP: planned qty of a row = base ratio (per unit of product) x header planned qty + additional qty.
export const recalcPlannedQty = (line, headerPlannedQty) => {
  if (line.component_type === "pit_Text") return line;
  const ratio = Number(line.base_ratio ?? line.base_qty ?? 0) || 0;
  return { ...line, planned_qty: round6(ratio * (Number(headerPlannedQty) || 0) + (Number(line.additional_qty) || 0)) };
};

// Apply one grid edit, keeping the planned qty in step with base qty / base ratio / additional qty.
export const applyLineEdit = (line, field, value, headerPlannedQty, bomQty = 1) => {
  const next = { ...line, [field]: value };
  if (field === "base_qty") {
    const oldBase = Number(line.base_qty) || 0;
    const oldRatio = Number(line.base_ratio) || 0;
    // Scale the existing ratio so it stays right whatever BOM quantity the order came from.
    next.base_ratio = round6(oldBase && oldRatio ? oldRatio * (Number(value) || 0) / oldBase : (Number(value) || 0) / (Number(bomQty) || 1));
  }
  if (["base_qty", "base_ratio", "additional_qty"].includes(field)) return recalcPlannedQty(next, headerPlannedQty);
  return next;
};

const isLineFilled = (line) => (
  line.component_type === "pit_Text"
    ? Boolean(String(line.line_text || line.item_name || "").trim())
    : Boolean(String(line.item_code || "").trim())
);

// Snake_case body for POST / PATCH /production-order (backend _buildPayload).
export const buildProductionOrderPayload = (header, lines = [], stages = []) => ({
  item_code:          header.item_code,
  planned_qty:        Number(header.planned_qty),
  due_date:           header.due_date,
  posting_date:       header.posting_date,
  start_date:         header.start_date,
  type:               header.type,
  warehouse:          header.warehouse,
  priority:           Number(header.priority) || 100,
  distribution_rule:  header.distribution_rule,
  project:            header.project,
  branch:             header.branch,
  customer_code:      header.customer_code,
  linked_to:          header.linked_to,
  linked_order_entry: header.linked_order_entry,
  user_id:            header.user_id,
  journal_remark:     header.journal_remark,
  remarks:            header.remarks,
  pick_remarks:       header.pick_remarks,
  series:             header.series,
  stages: stages.map((stage) => ({ stage_entry: stage.StageEntry, stage_id: stage.StageID, name: stage.Name })),
  lines: lines.filter(isLineFilled).map(({ _id, route_sequence, ...line }, idx) => ({
    ...line,
    line_num: idx,
    component_type: line.component_type || "pit_Item",
    line_text: line.component_type === "pit_Text" ? (line.line_text || line.item_name || "") : "",
    stage_id: line.stage_id === "" || line.stage_id == null ? "" : Number(line.stage_id),
  })),
});
