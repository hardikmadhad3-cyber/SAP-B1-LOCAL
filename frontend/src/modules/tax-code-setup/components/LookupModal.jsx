import React, { useState, useEffect } from "react";

export default function LookupModal({ title, onClose, onSelect, fetchOptions, columns }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadResults("");
  }, []);

  const loadResults = async (query) => {
    setLoading(true);
    try {
      const data = await fetchOptions(query);
      setResults(Array.isArray(data) ? data : data.value || []);
    } catch (err) {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadResults(searchQuery);
  };

  const handleRowClick = (row) => {
    onSelect(row);
  };

  return (
    <div className="tc-modal-overlay" onClick={onClose}>
      <div className="tc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tc-modal__header">
          <span>{title}</span>
          <button className="tc-modal__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="tc-modal__search">
          <form onSubmit={handleSearch}>
            <input
              className="tc-modal__search-input"
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            <button className="tc-btn tc-btn--small" type="submit">
              Search
            </button>
          </form>
        </div>

        <div className="tc-modal__body">
          {loading ? (
            <div className="tc-modal__empty">Loading...</div>
          ) : results.length === 0 ? (
            <div className="tc-modal__empty">
              <div>No results found</div>
              <div style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
                {searchQuery ? 'Try a different search term' : 'No records available in the system'}
              </div>
            </div>
          ) : (
            <table className="tc-lookup-table">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((row, idx) => (
                  <tr
                    key={idx}
                    className="tc-lookup-table__row"
                    onClick={() => handleRowClick(row)}
                  >
                    {columns.map((col) => (
                      <td key={col.key}>{row[col.key] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
