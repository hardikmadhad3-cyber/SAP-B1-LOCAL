import React from "react";

// UI-only row type: SAP shows route stages as grid rows; the component rows
// below a stage belong to it. BOM.jsx converts them to ProductTreeStages.
export const STAGE_TYPE = "pit_Stage";

// Resources and route stages exist only in production / template BOMs (SAP B1 rule).
const ITEM_TYPES = [
  { value: "pit_Item", label: "Item" },
  { value: "pit_Resource", label: "Resource", productionOnly: true },
  { value: "pit_Text", label: "Text" },
  { value: STAGE_TYPE, label: "Route Stage", productionOnly: true },
];

const ISSUE_METHODS = [
  { value: "im_Manual", label: "Manual" },
  { value: "im_Backflush", label: "Backflush" },
];

const COLUMNS = [
  ["type", "Type"],
  ["no", "No."],
  ["desc", "Description"],
  ["qty", "Quantity"],
  ["addqty", "Additional Quantity"],
  ["uom", "UoM Name"],
  ["wh", "Warehouse"],
  ["issue", "Issue Method"],
  ["stdcost", "Production Std Cost"],
  ["totalstd", "Total Production Std Cost"],
  ["pl", "Price List"],
  ["price", "Unit Price"],
  ["total", "Total"],
  ["comment", "Comments"],
  ["dr", "Distr. Rule"],
  ["project", "Project"],
  ["wip", "WIP Account"],
];

const num = (value) => (Number(value) || 0).toFixed(2);

export default function BOMLines({
  lines,
  treeType,
  selectedLineId,
  warehouses,
  priceLists,
  distRules,
  projects,
  totalStdCost,
  totalPrice,
  onChange,
  onAdd,
  onDelete,
  onSelectLine,
  onItemSearch,
}) {
  const allowProductionRows = treeType === "iProductionTree" || treeType === "iTemplateTree";

  return (
    <div className="bom-lines-wrap">
      <div className="bom-lines-layout">
        <div className="bom-grid-scroll">
          <table className="bom-grid">
            <colgroup>
              {COLUMNS.map(([key]) => <col key={key} className={`bom-col bom-col--${key}`} />)}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map(([key, label]) => (
                  <th key={key} className={`bom-th bom-th--${key}`} scope="col">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const isText = line.ItemType === "pit_Text";
                const isStage = line.ItemType === STAGE_TYPE;
                const isComponent = !isText && !isStage;
                const rowNo = index + 1;
                const field = (name) => ({
                  value: line[name] ?? "",
                  onFocus: () => onSelectLine(line._id),
                  onChange: (e) => onChange(line._id, name, e.target.value),
                  "aria-label": `${name} row ${rowNo}`,
                });
                const readonlyCell = (content, numeric = false) => (
                  <td className={`bom-grid__cell bom-grid__cell--readonly${numeric ? " bom-grid__cell--num" : ""}`}>
                    {content}
                  </td>
                );
                const empty = <td className="bom-grid__cell bom-grid__cell--readonly" />;
                const types = ITEM_TYPES.filter(
                  (t) => allowProductionRows || !t.productionOnly || t.value === line.ItemType
                );

                return (
                  <tr
                    key={line._id}
                    className={`bom-grid__row${isStage ? " bom-grid__row--stage" : ""}${
                      selectedLineId === line._id ? " bom-grid__row--selected" : ""
                    }`}
                    onClick={() => onSelectLine(line._id)}
                  >
                    <td className="bom-grid__cell">
                      <select className="bom-cell-select" {...field("ItemType")} aria-label={`Type row ${rowNo}`}>
                        {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>

                    {isText ? empty : (
                      <td className="bom-grid__cell">
                        <div className="bom-cell-lookup">
                          <input
                            className="bom-cell-input"
                            {...field("ItemCode")}
                            readOnly={isStage}
                            aria-label={`No. row ${rowNo}`}
                          />
                          <button
                            type="button"
                            className="im-lookup-btn"
                            tabIndex={-1}
                            aria-label={`Choose ${isStage ? "route stage" : line.ItemType === "pit_Resource" ? "resource" : "item"} for row ${rowNo}`}
                            onClick={() => {
                              onSelectLine(line._id);
                              onItemSearch(line._id);
                            }}
                          >
                            ...
                          </button>
                        </div>
                      </td>
                    )}

                    {isText ? (
                      <td className="bom-grid__cell">
                        <input className="bom-cell-input" {...field("Comment")} aria-label={`Text row ${rowNo}`} />
                      </td>
                    ) : readonlyCell(line.ItemName)}

                    {isComponent ? (
                      <>
                        <td className="bom-grid__cell">
                          <input
                            className="bom-cell-input bom-cell-input--num"
                            type="number"
                            min="0"
                            step="any"
                            {...field("Quantity")}
                          />
                        </td>
                        <td className="bom-grid__cell">
                          <input
                            className="bom-cell-input bom-cell-input--num"
                            type="number"
                            min="0"
                            step="any"
                            {...field("AdditionalQuantity")}
                          />
                        </td>
                        {readonlyCell(line.InventoryUOM)}
                        <td className="bom-grid__cell">
                          <select className="bom-cell-select" {...field("Warehouse")}>
                            <option value="">--</option>
                            {warehouses.map((w) => <option key={w.WarehouseCode} value={w.WarehouseCode}>{w.WarehouseCode}</option>)}
                          </select>
                        </td>
                        <td className="bom-grid__cell">
                          <select className="bom-cell-select" {...field("IssueMethod")}>
                            {ISSUE_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                        </td>
                        {readonlyCell(num(line.ProductionStdCost), true)}
                        {readonlyCell(num((Number(line.Quantity) || 0) * (Number(line.ProductionStdCost) || 0)), true)}
                        <td className="bom-grid__cell">
                          <select className="bom-cell-select" {...field("PriceList")}>
                            <option value="">--</option>
                            {priceLists.map((p) => <option key={p.PriceListNo} value={p.PriceListNo}>{p.PriceListName}</option>)}
                          </select>
                        </td>
                        {readonlyCell(num(line.Price), true)}
                        {readonlyCell(num((Number(line.Quantity) || 0) * (Number(line.Price) || 0)), true)}
                        <td className="bom-grid__cell">
                          <input className="bom-cell-input" {...field("Comment")} />
                        </td>
                        <td className="bom-grid__cell">
                          <select className="bom-cell-select" {...field("DistributionRule")}>
                            <option value="">--</option>
                            {distRules.map((d) => <option key={d.FactorCode} value={d.FactorCode}>{d.FactorCode}</option>)}
                          </select>
                        </td>
                        <td className="bom-grid__cell">
                          <select className="bom-cell-select" {...field("Project")}>
                            <option value="">--</option>
                            {projects.map((p) => <option key={p.Code} value={p.Code}>{p.Code}</option>)}
                          </select>
                        </td>
                        <td className="bom-grid__cell">
                          <input className="bom-cell-input" {...field("WipAccount")} />
                        </td>
                      </>
                    ) : (
                      <td className="bom-grid__cell bom-grid__cell--readonly" colSpan={COLUMNS.length - 3} />
                    )}
                  </tr>
                );
              })}

              {lines.length < 8 &&
                Array.from({ length: 8 - lines.length }).map((_, i) => (
                  <tr key={`empty-${i}`} className="bom-grid__row bom-grid__row--empty">
                    {COLUMNS.map(([key]) => <td key={key} className="bom-grid__cell bom-grid__cell--empty" />)}
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr className="bom-grid__footer">
                <td colSpan={9} />
                <td className="bom-grid__cell bom-grid__cell--num bom-grid__cell--total">{totalStdCost.toFixed(2)}</td>
                <td colSpan={2} />
                <td className="bom-grid__cell bom-grid__cell--num bom-grid__cell--total">{totalPrice.toFixed(2)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="bom-row-actions" aria-label="Row actions">
          <button type="button" className="im-btn" onClick={onAdd} title="Add row">Add Row</button>
          <button
            type="button"
            className="im-btn"
            onClick={() => {
              if (selectedLineId) onDelete(selectedLineId);
            }}
            title="Remove selected row"
          >
            Delete Row
          </button>
        </div>
      </div>
    </div>
  );
}
