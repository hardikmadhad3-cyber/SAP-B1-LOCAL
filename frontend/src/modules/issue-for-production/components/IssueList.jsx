import React, { useState, useEffect } from "react";
import { fetchIssueList } from "../../../api/issueForProductionApi";

export default function IssueList({ onSelect, onNew }) {
  const [issues, setIssues] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async (q = "") => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchIssueList({ query: q });
      setIssues(data.issues || []);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="im-page ifp-find-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">Find Issue for Production</span>
        <button className="im-btn im-btn--primary" onClick={onNew}>New</button>
      </div>

      {error && <div className="im-alert im-alert--error">{error}</div>}

      <div className="ifp-list-search-bar">
        <label htmlFor="ifp-find-query">Find</label>
        <input
          id="ifp-find-query"
          className="im-field__input"
          placeholder="Document no., remarks, reference, or production order"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && load(query)}
          style={{ width: 360 }}
        />
        <button className="im-btn" onClick={() => load(query)} disabled={loading}>
          {loading ? "Finding..." : "Find"}
        </button>
        <button className="im-btn" onClick={() => { setQuery(""); load(""); }}>Clear</button>
      </div>

      <div className="ifp-list-container">
        <table className="ifp-list-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th style={{ width: 100 }}>Document No.</th>
              <th style={{ width: 120 }}>Posting Date</th>
              <th style={{ width: 120 }}>Document Date</th>
              <th style={{ width: 110 }}>Ref. 2</th>
              <th style={{ width: 140 }}>Production Order</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 90, textAlign: "right" }}>Lines</th>
              <th style={{ minWidth: 180 }}>Journal Remark</th>
              <th style={{ minWidth: 220 }}>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", padding: "36px", color: "var(--sap-text-muted)" }}>
                  Loading issue documents...
                </td>
              </tr>
            )}
            {!loading && issues.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", color: "var(--sap-text-muted)", padding: "36px" }}>
                  No issue documents found.
                </td>
              </tr>
            )}
            {!loading && issues.map((doc, index) => (
              <tr key={doc.doc_entry} onClick={() => onSelect(doc.doc_entry)}>
                <td>{index + 1}</td>
                <td style={{ fontWeight: "var(--sap-font-weight-semibold)", color: "var(--sap-link)" }}>{doc.doc_num}</td>
                <td>{doc.posting_date}</td>
                <td>{doc.document_date}</td>
                <td>{doc.ref_2}</td>
                <td>{doc.production_order_no}</td>
                <td className={doc.cancelled ? "ifp-status--cancelled" : undefined}>{doc.cancelled ? "Cancelled" : "Posted"}</td>
                <td style={{ textAlign: "right" }}>{doc.total_lines}</td>
                <td>{doc.journal_remark}</td>
                <td>{doc.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
