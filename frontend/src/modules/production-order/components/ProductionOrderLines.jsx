import React from "react";

const ISSUE_METHODS = [
  { value: "im_Manual", label: "Manual" },
  { value: "im_Backflush", label: "Backflush" },
];

const COMPONENT_TYPES = [
  { value: "pit_Item", label: "Item" },
  { value: "pit_Resource", label: "Resource" },
  { value: "pit_Text", label: "Text" },
];

const COLUMN_COUNT = 19;
const stageLabel = (stage) => `${stage.SequenceNumber ?? stage.StageID}. ${stage.Name || stage.StageCode || ""}`;

export default function ProductionOrderLines({
  lines, stages = [], warehouses, distRules, projects, routeStages = [],
  readOnly, isDisassembly, onChange, onAdd, onDelete, onAddStage, onItemSearch,
}) {
  const EMPTY_ROWS = 8;
  const columnCount = COLUMN_COUNT + (!readOnly ? 1 : 0);
  const stageById = new Map(stages.map((stage) => [String(stage.StageID), stage]));

  return (
    <div className="po-lines-wrap">
      <div className="po-lines-toolbar">
        <div className="po-section-label">{isDisassembly ? "Components to Receive" : "Components"}</div>
        {!readOnly && (
          <div className="po-lines-toolbar__actions">
            {routeStages.length > 0 && (
              <label className="po-inline-field">
                <span>Add Route Stage</span>
                <select className="im-field__select" value="" onChange={(e) => onAddStage?.(e.target.value)}>
                  <option value="">--</option>
                  {routeStages.map((stage) => (
                    <option key={stage.InternalNumber} value={stage.InternalNumber}>{stage.Code} - {stage.Description}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="im-btn" onClick={onAdd}>Add Row</button>
          </div>
        )}
      </div>

      <div className="po-grid-scroll">
        <table className="po-grid">
          <thead>
            <tr>
              <th className="po-th po-th--rownum">#</th>
              <th className="po-th po-th--type">Type</th>
              <th className="po-th po-th--no">No.</th>
              <th className="po-th po-th--desc">Description</th>
              <th className="po-th po-th--baseqty">Base Qty</th>
              <th className="po-th po-th--baseratio">Base Ratio</th>
              <th className="po-th po-th--planqty">Planned Qty</th>
              <th className="po-th po-th--issued">{isDisassembly ? "Received" : "Issued"}</th>
              <th className="po-th po-th--available">Available</th>
              <th className="po-th po-th--uom">UoM Code</th>
              <th className="po-th po-th--uomname">UoM Name</th>
              <th className="po-th po-th--wh">Warehouse</th>
              <th className="po-th po-th--issue">Issue Method</th>
              <th className="po-th po-th--wip">WIP Account</th>
              <th className="po-th po-th--dr">Distr. Rule</th>
              <th className="po-th po-th--proj">Project</th>
              <th className="po-th po-th--addqty">Add. Qty</th>
              <th className="po-th po-th--route">Stage</th>
              <th className="po-th po-th--procure">Procurement</th>
              {!readOnly && <th className="po-th po-th--action" aria-label="Row action" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const isText = line.component_type === "pit_Text";
              const isResource = line.component_type === "pit_Resource";
              // SAP: a negative planned qty on a standard/special order is a by-product.
              const isByProduct = !isDisassembly && !isText && Number(line.planned_qty) < 0;
              const stage = stageById.get(String(line.stage_id ?? ""));
              const startsStage = stage && String(lines[idx - 1]?.stage_id ?? "") !== String(line.stage_id);

              return (
                <React.Fragment key={line._id}>
                  {startsStage && (
                    <tr className="po-grid__row po-grid__row--stage">
                      <td className="po-grid__cell" colSpan={columnCount}>Route Stage {stageLabel(stage)}</td>
                    </tr>
                  )}
                  <tr className={`po-grid__row${isByProduct ? " po-grid__row--byproduct" : ""}`}>
                    <td className="po-grid__cell po-grid__cell--readonly po-grid__cell--num">
                      {idx + 1}
                      {isByProduct && <span className="po-byproduct-tag" title="By-product (negative planned quantity)">BP</span>}
                    </td>

                    <td className="po-grid__cell">
                      <select
                        className="po-cell-select"
                        aria-label={`Row ${idx + 1} type`}
                        value={line.component_type}
                        disabled={readOnly}
                        onChange={(e) => onChange(line._id, "component_type", e.target.value)}
                      >
                        {COMPONENT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </td>

                    <td className="po-grid__cell">
                      {isText ? (
                        <span className="po-cell-text">Text row</span>
                      ) : (
                        <div className="po-cell-lookup">
                          <input
                            className="po-cell-input"
                            aria-label={`Row ${idx + 1} number`}
                            value={line.item_code}
                            readOnly={readOnly}
                            onChange={(e) => onChange(line._id, "item_code", e.target.value)}
                            placeholder={isResource ? "Resource Code" : "Item Code"}
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              className="im-lookup-btn"
                              tabIndex={-1}
                              aria-label={`Find row ${idx + 1} ${isResource ? "resource" : "item"}`}
                              onClick={() => onItemSearch(line._id)}
                            >
                              …
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="po-grid__cell">
                      <input
                        className="po-cell-input"
                        aria-label={`Row ${idx + 1} description`}
                        value={isText ? (line.line_text || line.item_name || "") : line.item_name}
                        readOnly={readOnly || !isText}
                        onChange={(e) => onChange(line._id, "line_text", e.target.value)}
                        placeholder={isText ? "Enter text" : ""}
                      />
                    </td>

                    {isText ? (
                      <td className="po-grid__cell po-grid__cell--readonly" colSpan={COLUMN_COUNT - 4} />
                    ) : (
                      <>
                        <td className="po-grid__cell">
                          <input
                            className="po-cell-input po-cell-input--num"
                            aria-label={`Row ${idx + 1} base quantity`}
                            type="number"
                            step="any"
                            value={line.base_qty}
                            readOnly={readOnly}
                            onChange={(e) => onChange(line._id, "base_qty", e.target.value)}
                          />
                        </td>

                        <td className="po-grid__cell">
                          <input
                            className="po-cell-input po-cell-input--num"
                            aria-label={`Row ${idx + 1} base ratio`}
                            type="number"
                            step="any"
                            value={line.base_ratio ?? line.base_qty ?? 1}
                            readOnly={readOnly}
                            onChange={(e) => onChange(line._id, "base_ratio", e.target.value)}
                          />
                        </td>

                        <td className="po-grid__cell">
                          <input
                            className="po-cell-input po-cell-input--num"
                            aria-label={`Row ${idx + 1} planned quantity`}
                            type="number"
                            step="any"
                            title="A negative quantity is a by-product"
                            value={line.planned_qty}
                            readOnly={readOnly}
                            onChange={(e) => onChange(line._id, "planned_qty", e.target.value)}
                          />
                        </td>

                        <td className="po-grid__cell po-grid__cell--readonly po-grid__cell--num">
                          {Number(line.issued_qty || 0).toFixed(2)}
                        </td>

                        <td className="po-grid__cell po-grid__cell--readonly po-grid__cell--num">
                          {Number(line.available_qty || 0).toFixed(2)}
                        </td>

                        <td className="po-grid__cell po-grid__cell--readonly">{line.uom_code || line.uom || ""}</td>
                        <td className="po-grid__cell po-grid__cell--readonly">{line.uom_name || line.uom || ""}</td>

                        <td className="po-grid__cell">
                          <select
                            className="po-cell-select"
                            aria-label={`Row ${idx + 1} warehouse`}
                            value={line.warehouse}
                            disabled={readOnly}
                            onChange={(e) => onChange(line._id, "warehouse", e.target.value)}
                          >
                            <option value="">--</option>
                            {warehouses.map((w) => (
                              <option key={w.WarehouseCode} value={w.WarehouseCode}>{w.WarehouseCode}</option>
                            ))}
                          </select>
                        </td>

                        <td className="po-grid__cell">
                          <select
                            className="po-cell-select"
                            aria-label={`Row ${idx + 1} issue method`}
                            value={line.issue_method}
                            disabled={readOnly}
                            onChange={(e) => onChange(line._id, "issue_method", e.target.value)}
                          >
                            {ISSUE_METHODS.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </td>

                        <td className="po-grid__cell po-grid__cell--readonly">{line.wip_account || ""}</td>

                        <td className="po-grid__cell">
                          <select
                            className="po-cell-select"
                            aria-label={`Row ${idx + 1} distribution rule`}
                            value={line.distribution_rule}
                            disabled={readOnly}
                            onChange={(e) => onChange(line._id, "distribution_rule", e.target.value)}
                          >
                            <option value="">--</option>
                            {distRules.map((d) => (
                              <option key={d.FactorCode} value={d.FactorCode}>{d.FactorCode}</option>
                            ))}
                          </select>
                        </td>

                        <td className="po-grid__cell">
                          <select
                            className="po-cell-select"
                            aria-label={`Row ${idx + 1} project`}
                            value={line.project}
                            disabled={readOnly}
                            onChange={(e) => onChange(line._id, "project", e.target.value)}
                          >
                            <option value="">--</option>
                            {projects.map((p) => (
                              <option key={p.Code} value={p.Code}>{p.Code}</option>
                            ))}
                          </select>
                        </td>

                        <td className="po-grid__cell">
                          <input
                            className="po-cell-input po-cell-input--num"
                            aria-label={`Row ${idx + 1} additional quantity`}
                            type="number"
                            min="0"
                            step="any"
                            value={line.additional_qty}
                            readOnly={readOnly}
                            onChange={(e) => onChange(line._id, "additional_qty", e.target.value)}
                          />
                        </td>

                        <td className="po-grid__cell">
                          <select
                            className="po-cell-select"
                            aria-label={`Row ${idx + 1} route stage`}
                            value={line.stage_id ?? ""}
                            disabled={readOnly || !stages.length}
                            onChange={(e) => onChange(line._id, "stage_id", e.target.value)}
                          >
                            <option value="">--</option>
                            {stages.map((s) => (
                              <option key={s.StageID} value={s.StageID}>{stageLabel(s)}</option>
                            ))}
                          </select>
                        </td>

                        <td className="po-grid__cell po-grid__cell--readonly">{line.procurement_method || ""}</td>
                      </>
                    )}

                    {!readOnly && (
                      <td className="po-grid__cell po-grid__cell--action">
                        <button
                          type="button"
                          className="po-row-delete-btn"
                          onClick={() => onDelete(line._id)}
                          title="Remove row"
                          aria-label={`Remove row ${idx + 1}`}
                        >
                          -
                        </button>
                      </td>
                    )}
                  </tr>
                </React.Fragment>
              );
            })}

            {lines.length < EMPTY_ROWS && Array.from({ length: EMPTY_ROWS - lines.length }).map((_, i) => (
              <tr key={`e-${i}`} className="po-grid__row po-grid__row--empty">
                {Array.from({ length: columnCount }).map((__, j) => (
                  <td key={j} className="po-grid__cell po-grid__cell--empty" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
