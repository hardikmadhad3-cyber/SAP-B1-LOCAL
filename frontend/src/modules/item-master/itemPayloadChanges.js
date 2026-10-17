// ItemMaster buildPayload sends a field only when it has a value, so clearing a field,
// entering 0 or unticking a box never reached the database on Update. Send every
// field the user changed that the rules skipped, limited to properties the Service
// Layer returned for this item (so SAP never gets an unknown property).
// Serial/batch management stays out (buildPayload never sends it either).
const NEVER_SENT = new Set(["ManageSerialNumbers", "ManageBatchNumbers", "SRIAndBatchManageMethod", "IssuePrimarilyBy"]);
export function changedFieldsNotSent(form, sent, { form: initial = {}, keys = new Set() } = {}) {
  const changes = {};
  for (const key of keys) {
    if (key in sent || NEVER_SENT.has(key) || !(key in form)) continue;
    const value = form[key];
    const before = initial[key];
    if (value != null && typeof value === "object") continue;
    if (String(value ?? "") === String(before ?? "")) continue;
    if (value === "" || value == null) changes[key] = null;
    else if (typeof before === "number" && !Number.isNaN(Number(value))) changes[key] = Number(value);
    else changes[key] = value;
  }
  return changes;
}
