import React from "react";
import { backflushIssueQty } from "../receiptHelpers";

/**
 * Read-only preview of the backflush components. The backend issues them
 * (a separate Issue for Production document) when the receipt is added.
 */
export default function BackflushPreview({ lines, receiptQty, plannedQty }) {
  if (!lines.length) return null;

  return (
    <div className="rfp-backflush-panel">
      <div className="rfp-backflush-panel__title">
        Backflush Components
        <span className="rfp-backflush-panel__badge">Issued automatically on Add</span>
        <span className="rfp-backflush-panel__note">
          Will Issue = Planned x Received Qty / Order Planned Qty
        </span>
      </div>

      <div className="rfp-grid-scroll">
        <table className="rfp-grid">
          <thead>
            <tr>
              <th className="rfp-th rfp-th--no">Item No.</th>
              <th className="rfp-th rfp-th--desc">Description</th>
              <th className="rfp-th rfp-th--bomqty">Planned</th>
              <th className="rfp-th rfp-th--issued">Issued</th>
              <th className="rfp-th rfp-th--calcqty">Will Issue</th>
              <th className="rfp-th rfp-th--uom">UoM</th>
              <th className="rfp-th rfp-th--wh">Warehouse</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const willIssue = backflushIssueQty(line.bom_qty, receiptQty, plannedQty);
              return (
                <tr key={`${line.item_code}-${index}`} className="rfp-grid__row">
                  <td className="rfp-grid__cell rfp-grid__cell--readonly">{line.item_code}</td>
                  <td className="rfp-grid__cell rfp-grid__cell--readonly">{line.item_name}</td>
                  <td className="rfp-grid__cell rfp-grid__cell--num rfp-grid__cell--readonly">
                    {Number(line.bom_qty || 0).toFixed(4)}
                  </td>
                  <td className="rfp-grid__cell rfp-grid__cell--num rfp-grid__cell--readonly">
                    {Number(line.issued_qty || 0).toFixed(4)}
                  </td>
                  <td className="rfp-grid__cell rfp-grid__cell--calc">
                    {willIssue > 0 ? willIssue.toFixed(4) : "-"}
                  </td>
                  <td className="rfp-grid__cell rfp-grid__cell--readonly">{line.uom}</td>
                  <td className="rfp-grid__cell rfp-grid__cell--readonly">{line.warehouse}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
