// Pure helpers for Receipt from Production (tested in receiptHelpers.test.js).

export const toQty = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

// SAP backflush: component planned qty x received product qty / planned product qty.
export const backflushIssueQty = (componentPlanned, receivedQty, orderPlannedQty) => {
  const planned = toQty(orderPlannedQty);
  if (planned <= 0) return 0;
  return Number(((toQty(componentPlanned) * toQty(receivedQty)) / planned).toFixed(6));
};

// <ItemCode>-<YYYYMMDD>-<n>, n = first number not already used in the rows.
export const autoBatchNumber = (itemCode, date, existing = []) => {
  const stamp = String(date || new Date().toISOString().slice(0, 10)).slice(0, 10).replace(/-/g, "");
  const used = new Set(existing.filter(Boolean));
  let n = 1;
  while (used.has(`${itemCode}-${stamp}-${n}`)) n += 1;
  return `${itemCode}-${stamp}-${n}`;
};

// Lines that get posted: an item is set, and by-product rows only when a quantity was entered.
export const getPostingLines = (lines = []) =>
  lines.filter((line) => String(line.item_code || "").trim() && !(line.by_product && toQty(line.quantity) <= 0));

// Production receipts are valued by the backend (WIP / item cost), so no unit price is sent.
export const toPayloadLine = (line, prodOrderEntry) => ({
  item_code: line.item_code,
  quantity: toQty(line.quantity),
  warehouse: line.warehouse,
  uom_code: line.uom_code,
  trans_type: line.trans_type,
  location: line.location,
  distribution_rule: line.distribution_rule,
  project: line.project,
  base_entry: line.base_entry ?? prodOrderEntry,
  base_line: line.base_line ?? 0,
  base_type: line.base_type ?? 202,
  order_no: line.order_no,
  series_no: line.series_no,
  by_product: line.by_product,
  manage_batch: line.manage_batch,
  manage_serial: line.manage_serial,
  enable_bin_locations: line.enable_bin_locations,
  batch_numbers: line.batch_numbers || [],
  serial_numbers: line.serial_numbers || [],
  bin_allocations: line.bin_allocations || [],
});
