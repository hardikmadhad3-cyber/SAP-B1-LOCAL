import React from "react";

const TRANS_TYPES = [
  { value: "Complete", label: "Complete" },
  { value: "Reject", label: "Reject" },
];

const getAllocationSummary = (line) => {
  const parts = [];
  if (line.manage_batch) parts.push(`${(line.batch_numbers || []).length} batch`);
  if (line.manage_serial) parts.push(`${(line.serial_numbers || []).length} serial`);
  if (line.enable_bin_locations) parts.push(`${(line.bin_allocations || []).length} bin`);
  return parts.join(" / ");
};

export default function ReceiptLines({
  lines,
  warehouses,
  distRules,
  projects,
  branches,
  readOnly,
  onChange,
  onAdd,
  onDelete,
  onItemSearch,
  onAllocate,
}) {
  const EMPTY_ROWS = 8;

  return (
    <div className="rfp-lines-wrap">
      <div className="rfp-grid-scroll">
        <table className="rfp-grid">
          <thead>
            <tr>
              <th className="rfp-th rfp-th--orderno">Order No.</th>
              <th className="rfp-th rfp-th--seriesno">Series No.</th>
              <th className="rfp-th rfp-th--itemno">Item No.</th>
              <th className="rfp-th rfp-th--desc">Item Description</th>
              <th className="rfp-th rfp-th--transtype">Trans. Type</th>
              <th className="rfp-th rfp-th--qty">Quantity</th>
              <th className="rfp-th rfp-th--price">Unit Price</th>
              <th className="rfp-th rfp-th--value">Value</th>
              <th className="rfp-th rfp-th--cost">Item Cost</th>
              <th className="rfp-th rfp-th--planned">Planned</th>
              <th className="rfp-th rfp-th--completed">Completed</th>
              <th className="rfp-th rfp-th--invuom">Inventory UoM</th>
              <th className="rfp-th rfp-th--uomcode">UoM Code</th>
              <th className="rfp-th rfp-th--uomname">UoM Name</th>
              <th className="rfp-th rfp-th--itemsper">Items per Unit</th>
              <th className="rfp-th rfp-th--dr">Distr. Rule</th>
              <th className="rfp-th rfp-th--location">Location</th>
              <th className="rfp-th rfp-th--branch">Branch</th>
              <th className="rfp-th rfp-th--uomgroup">UoM Group</th>
              <th className="rfp-th rfp-th--byproduct">By-Product</th>
              <th className="rfp-th rfp-th--alloc">Allocations</th>
              <th className="rfp-th rfp-th--wh">Warehouse</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const canAllocate =
                Boolean(line.item_code) &&
                (line.manage_batch ||
                  line.manage_serial ||
                  line.enable_bin_locations ||
                  (line.batch_numbers || []).length > 0 ||
                  (line.serial_numbers || []).length > 0 ||
                  (line.bin_allocations || []).length > 0);

              return (
                <tr key={line._id} className={`rfp-grid__row${line.by_product ? " rfp-grid__row--byproduct" : ""}`}>
                  <td className="rfp-grid__cell rfp-grid__cell--readonly">{line.order_no || ""}</td>
                  <td className="rfp-grid__cell rfp-grid__cell--readonly">{line.series_no || ""}</td>

                  <td className="rfp-grid__cell">
                    <div className="rfp-cell-lookup">
                      <input
                        className="rfp-cell-input"
                        value={line.item_code}
                        readOnly={readOnly}
                        onChange={(e) => onChange(line._id, "item_code", e.target.value)}
                        placeholder="Item Code"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          className="im-lookup-btn"
                          tabIndex={-1}
                          onClick={() => onItemSearch(line._id)}
                        >
                          ...
                        </button>
                      )}
                    </div>
                  </td>

                  <td className="rfp-grid__cell">
                    <input
                      className="rfp-cell-input"
                      value={line.item_name}
                      readOnly={readOnly}
                      onChange={(e) => onChange(line._id, "item_name", e.target.value)}
                    />
                  </td>

                  <td className="rfp-grid__cell">
                    <select
                      className="rfp-cell-select"
                      value={line.trans_type}
                      disabled={readOnly}
                      onChange={(e) => onChange(line._id, "trans_type", e.target.value)}
                    >
                      {TRANS_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="rfp-grid__cell">
                    <input
                      className="rfp-cell-input rfp-cell-input--num"
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantity}
                      readOnly={readOnly}
                      onChange={(e) => onChange(line._id, "quantity", e.target.value)}
                    />
                  </td>

                  {/* SAP values production receipts on posting (WIP / item cost): price is display only. */}
                  <td className="rfp-grid__cell rfp-grid__cell--readonly rfp-grid__cell--num">
                    {readOnly ? Number(line.unit_price || 0).toFixed(2) : <span className="rfp-muted">Valued on posting</span>}
                  </td>

                  <td className="rfp-grid__cell rfp-grid__cell--readonly rfp-grid__cell--num">
                    {readOnly ? Number(line.value || (Number(line.quantity) || 0) * (Number(line.unit_price) || 0)).toFixed(2) : ""}
                  </td>

                  <td className="rfp-grid__cell rfp-grid__cell--readonly rfp-grid__cell--num">
                    {Number(line.item_cost || 0).toFixed(2)}
                  </td>

                  <td className="rfp-grid__cell rfp-grid__cell--readonly rfp-grid__cell--num">
                    {Number(line.planned || 0).toFixed(2)}
                  </td>

                  <td className="rfp-grid__cell rfp-grid__cell--readonly rfp-grid__cell--num">
                    {Number(line.completed || 0).toFixed(2)}
                  </td>

                  <td className="rfp-grid__cell rfp-grid__cell--readonly">
                    {line.inventory_uom || ""}
                  </td>

                  <td className="rfp-grid__cell">
                    <input
                      className="rfp-cell-input"
                      value={line.uom_code}
                      readOnly={readOnly}
                      onChange={(e) => onChange(line._id, "uom_code", e.target.value)}
                    />
                  </td>

                  <td className="rfp-grid__cell rfp-grid__cell--readonly">
                    {line.uom_name || ""}
                  </td>

                  <td className="rfp-grid__cell">
                    <input
                      className="rfp-cell-input rfp-cell-input--num"
                      type="number"
                      min="0"
                      step="any"
                      value={line.items_per_unit}
                      readOnly={readOnly}
                      onChange={(e) => onChange(line._id, "items_per_unit", e.target.value)}
                    />
                  </td>

                  <td className="rfp-grid__cell">
                    <select
                      className="rfp-cell-select"
                      value={line.distribution_rule}
                      disabled={readOnly}
                      onChange={(e) => onChange(line._id, "distribution_rule", e.target.value)}
                    >
                      <option value="">--</option>
                      {distRules.map((rule) => (
                        <option key={rule.FactorCode} value={rule.FactorCode}>
                          {rule.FactorCode}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="rfp-grid__cell">
                    <input
                      className="rfp-cell-input"
                      value={line.location}
                      readOnly={readOnly}
                      onChange={(e) => onChange(line._id, "location", e.target.value)}
                    />
                  </td>

                  <td className="rfp-grid__cell">
                    <select
                      className="rfp-cell-select"
                      value={line.branch}
                      disabled={readOnly}
                      onChange={(e) => onChange(line._id, "branch", e.target.value)}
                    >
                      <option value="">--</option>
                      {branches.map((branch) => (
                        <option key={branch.BPLID} value={branch.BPLID}>
                          {branch.BPLName}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="rfp-grid__cell rfp-grid__cell--readonly">
                    {line.uom_group || ""}
                  </td>

                  <td className="rfp-grid__cell rfp-grid__cell--center">
                    <label className="rfp-byproduct-label">
                      <input
                        type="checkbox"
                        aria-label="By-product"
                        checked={line.by_product}
                        disabled={readOnly}
                        onChange={(e) => onChange(line._id, "by_product", e.target.checked)}
                      />
                      {line.by_product && "By-product"}
                    </label>
                  </td>

                  <td className="rfp-grid__cell">
                    <button
                      type="button"
                      className="rfp-alloc-btn"
                      onClick={() => onAllocate(line._id)}
                      disabled={!canAllocate}
                      title={getAllocationSummary(line) || "No allocations required"}
                    >
                      {readOnly ? "View" : "Alloc"}
                    </button>
                    {getAllocationSummary(line) && (
                      <div className="rfp-alloc-summary">{getAllocationSummary(line)}</div>
                    )}
                  </td>

                  <td className="rfp-grid__cell">
                    <select
                      className="rfp-cell-select"
                      value={line.warehouse}
                      disabled={readOnly}
                      onChange={(e) => onChange(line._id, "warehouse", e.target.value)}
                    >
                      <option value="">--</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.WarehouseCode} value={warehouse.WarehouseCode}>
                          {warehouse.WarehouseCode}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}

            {lines.length < EMPTY_ROWS && Array.from({ length: EMPTY_ROWS - lines.length }).map((_, i) => (
              <tr key={`e-${i}`} className="rfp-grid__row rfp-grid__row--empty">
                {Array.from({ length: 22 }).map((__, j) => (
                  <td key={j} className="rfp-grid__cell rfp-grid__cell--empty" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="rfp-row-btns">
          <button type="button" className="rfp-row-btn" onClick={onAdd} title="Add row">+</button>
          <button
            type="button"
            className="rfp-row-btn rfp-row-btn--del"
            onClick={() => { const last = lines[lines.length - 1]; if (last) onDelete(last._id); }}
            title="Remove last row"
          >
            -
          </button>
        </div>
      )}
    </div>
  );
}
