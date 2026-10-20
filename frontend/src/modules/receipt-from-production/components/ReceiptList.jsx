import { useState, useEffect } from "react";
import { fetchReceiptList } from "../../../api/receiptFromProductionApi";
import "../../item-master/styles/itemMaster.css";

export default function ReceiptList({ onSelect, onNew }) {
  const [receipts, setReceipts] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async (q = "") => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReceiptList({ query: q });
      setReceipts(data.receipts || []);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line

  const handleSearch = () => {
    load(query);
  };

  const handleClear = () => {
    setQuery("");
    load("");
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="im-page">
      {/* Page Title */}
      <div className="im-toolbar">
        <span className="im-toolbar__title">Receipt from Production - Find</span>
        <button className="im-btn im-btn--primary" onClick={onNew}>
          New Receipt
        </button>
      </div>

      {/* Error Alert */}
      {error && <div className="im-alert im-alert--error">{error}</div>}

      {/* Search Bar Section */}
      <div className="im-header-card">
        <div className="rfp-list-toolbar">
          <input
            className="im-field__input"
            aria-label="Search receipts"
            placeholder="Search by Doc No. or remarks..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyPress}
            style={{ flex: 1, maxWidth: 400 }}
            autoFocus
          />
          <button className="im-btn" onClick={handleSearch} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
          <button className="im-btn" onClick={handleClear} disabled={loading}>
            Clear
          </button>
        </div>
      </div>

      <div className="im-grid-wrap">
        <table className="im-grid">
          <thead>
            <tr>
              <th>Doc No.</th>
              <th>Posting Date</th>
              <th>Production Order</th>
              <th>Lines</th>
              <th>Status</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="rfp-list-empty">Loading...</td></tr>
            )}
            {!loading && receipts.length === 0 && (
              <tr><td colSpan={6} className="rfp-list-empty">No receipt documents found.</td></tr>
            )}
            {!loading &&
              receipts.map((doc) => (
                <tr key={doc.doc_entry} className="rfp-list-row" onClick={() => onSelect(doc.doc_entry)}>
                  <td>
                    <button type="button" className="rfp-link-btn" onClick={(e) => { e.stopPropagation(); onSelect(doc.doc_entry); }}>
                      {doc.doc_num}
                    </button>
                  </td>
                  <td>{doc.posting_date}</td>
                  <td>{doc.production_order_no || ""}</td>
                  <td className="rfp-grid__cell--num">{doc.total_lines}</td>
                  <td>{doc.cancelled ? "Cancelled" : "Open"}</td>
                  <td>{doc.remarks || ""}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {!loading && receipts.length > 0 && (
        <div className="rfp-list-count">
          {receipts.length} record{receipts.length !== 1 ? "s" : ""} found
        </div>
      )}
    </div>
  );
}
