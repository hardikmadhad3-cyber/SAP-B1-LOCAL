import React, { useState, useEffect } from "react";
import { fetchProductionOrders } from "../../../api/productionOrderApi";
import SapDateInput from "../../../components/common/SapDateInput";
import "../../item-master/styles/itemMaster.css";
import "../productionOrder.css";

const STATUS_LABELS = {
  boposPlanned: "Planned",
  boposReleased: "Released",
  boposClosed: "Closed",
  boposCancelled: "Cancelled",
};

const TYPE_LABELS = {
  bopotStandard: "Standard",
  bopotSpecial: "Special",
  bopotDisassemble: "Disassemble",
};

const EMPTY_FILTERS = { status: "", type: "", dateFrom: "", dateTo: "" };

export default function ProductionOrderList({ onSelect, initialQuery = "" }) {
  const [orders,  setOrders]  = useState([]);
  const [query,   setQuery]   = useState(initialQuery);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const load = async (q = "", f = filters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProductionOrders({ query: q, ...f });
      setOrders(data.orders || []);
    } catch (err) {
      setError(err.response?.data?.detail || err.response?.data?.message || err.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setQuery(initialQuery);
    load(initialQuery);
  }, [initialQuery]); // eslint-disable-line

  const setFilter = (e) => setFilters((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  return (
    <div className="im-page po-list-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">Find Production Order</span>
        <button className="im-btn im-btn--primary" onClick={() => onSelect(null)}>New</button>
      </div>

      {error && <div className="im-alert im-alert--error" role="alert">{error}</div>}

      <div className="po-list-filters">
        <label className="po-inline-field">
          <span>Find</span>
          <input
            className="im-field__input po-list-filters__query"
            placeholder="Document no., product no., or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(query)}
          />
        </label>
        <label className="po-inline-field">
          <span>Status</span>
          <select className="im-field__select" name="status" value={filters.status} onChange={setFilter}>
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="po-inline-field">
          <span>Type</span>
          <select className="im-field__select" name="type" value={filters.type} onChange={setFilter}>
            <option value="">All</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="po-inline-field">
          <span>Due Date From</span>
          <SapDateInput className="im-field__input" name="dateFrom" value={filters.dateFrom} onChange={setFilter} />
        </label>
        <label className="po-inline-field">
          <span>To</span>
          <SapDateInput className="im-field__input" name="dateTo" value={filters.dateTo} onChange={setFilter} />
        </label>
        <button className="im-btn" onClick={() => load(query)} disabled={loading}>
          {loading ? "Finding..." : "Find"}
        </button>
        <button className="im-btn" onClick={() => { setQuery(""); setFilters(EMPTY_FILTERS); load("", EMPTY_FILTERS); }}>
          Clear
        </button>
      </div>

      <div className="po-list-scroll">
        <table className="po-list-table">
          <thead>
            <tr>
              <th>Doc No.</th>
              <th>Product No.</th>
              <th>Product Description</th>
              <th>Type</th>
              <th>Status</th>
              <th className="po-num">Planned Qty</th>
              <th className="po-num">Completed Qty</th>
              <th>Due Date</th>
              <th>Warehouse</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="po-list-empty">Loading production orders...</td></tr>
            )}
            {!loading && orders.length === 0 && (
              <tr><td colSpan={9} className="po-list-empty">No production orders found.</td></tr>
            )}
            {!loading && orders.map((o) => (
              <tr key={o.doc_entry} onClick={() => onSelect(o.doc_entry)} className="po-list-row">
                <td className="po-list-docnum">{o.doc_num}</td>
                <td>{o.item_code}</td>
                <td>{o.item_name}</td>
                <td>{TYPE_LABELS[o.type] || o.type}</td>
                <td>
                  <span className={`po-status-badge po-status-badge--${String(STATUS_LABELS[o.status] || o.status || "planned").toLowerCase()}`}>
                    {STATUS_LABELS[o.status] || o.status}
                  </span>
                </td>
                <td className="po-num">{Number(o.planned_qty).toFixed(2)}</td>
                <td className="po-num">{Number(o.completed_qty).toFixed(2)}</td>
                <td>{o.due_date}</td>
                <td>{o.warehouse}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
