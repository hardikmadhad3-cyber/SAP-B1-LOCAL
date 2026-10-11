import SapDateInput from '../../components/common/SapDateInput';
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "../../modules/item-master/styles/itemMaster.css";
import "./issueForProduction.css";
import IssueLines from "./components/IssueLines";
import IssueList from "./components/IssueList";
import ProductionOrderSearchModal from "./components/ProductionOrderSearchModal";
import CopyItemsModal from "./components/CopyItemsModal";
import {
  fetchIssueReferenceData,
  fetchIssueSeries,
  fetchProductionOrderForIssue,
  fetchIssueByDocEntry,
  createIssue,
} from "../../api/issueForProductionApi";
import { getSapVisibleDocumentSeries } from "../../utils/seriesDefaults";

const MODES = { ADD: "add", VIEW: "view", LIST: "list" };
const TABS = ["Contents", "Attachments", "Electronic Documents"];

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_HEADER = {
  doc_num: "",
  series: "",
  posting_date: today(),
  document_date: today(),
  ref_2: "",
  remarks: "",
  journal_remark: "Issue for Production",
  qr_code_from: "",
  branch: "",
};

const pickDefaultSeries = (seriesRows = [], postingDate = today()) =>
  getSapVisibleDocumentSeries(seriesRows, { postingDate })[0] || null;

const decorateIssueLine = (line, orderNo = "") => ({
  _id: line._id ?? Math.random(),
  line_num: line.line_num ?? 0,
  order_no: line.order_no || orderNo || "",
  series_no: line.series_no || "",
  line_type: line.line_type || "Item",
  item_code: line.item_code || "",
  item_name: line.item_name || "",
  planned_qty: line.planned_qty ?? 0,
  issued_qty: line.issued_qty ?? line.issue_qty ?? 0,
  remaining_qty: line.remaining_qty ?? 0,
  issue_qty: line.issue_qty ?? line.copy_qty ?? line.remaining_qty ?? 0,
  copy_qty: line.copy_qty ?? line.issue_qty ?? line.remaining_qty ?? 0,
  uom: line.uom || "",
  uom_name: line.uom_name || line.uom || "",
  warehouse: line.warehouse || "",
  item_cost: line.item_cost ?? "",
  available_qty: line.available_qty ?? "",
  location: line.location || "",
  sauda_node_ref: line.sauda_node_ref || "",
  ap_inv_doc_key: line.ap_inv_doc_key || "",
  issue_method: line.issue_method || "im_Manual",
  distribution_rule: line.distribution_rule || "",
  project: line.project || "",
  base_entry: line.base_entry ?? null,
  base_line: line.base_line ?? null,
  base_type: line.base_type ?? 202,
  manage_batch: Boolean(line.manage_batch),
  manage_serial: Boolean(line.manage_serial),
  enable_bin_locations: Boolean(line.enable_bin_locations),
  batch_numbers: line.batch_numbers || [],
  serial_numbers: line.serial_numbers || [],
  bin_allocations: line.bin_allocations || [],
  account_code: line.account_code || "",
});

export default function IssueForProductionModule() {
  const pageRef = useRef(null);
  const [mode, setMode] = useState(MODES.ADD);
  const [tab, setTab] = useState(0);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [poInfo, setPoInfo] = useState(null);
  const [warehouses, setWarehouses] = useState([]);
  const [distRules, setDistRules] = useState([]);
  const [projects, setProjects] = useState([]);
  const [series, setSeries] = useState([]);
  const [branches, setBranches] = useState([]);
  const [poModal, setPoModal] = useState(null);
  const [copyModal, setCopyModal] = useState(null);
  const branchWarehouses = useMemo(() => {
    if (mode !== MODES.ADD || !header.branch) return warehouses;
    return warehouses.filter((warehouse) => warehouse.BPLID == null || String(warehouse.BPLID) === String(header.branch));
  }, [header.branch, mode, warehouses]);

  const alertTimer = useRef(null);
  const visibleSeries = useMemo(() => getSapVisibleDocumentSeries(series, {
    selectedSeries: header.series,
    postingDate: header.posting_date,
  }), [series, header.series, header.posting_date]);

  useEffect(() => {
    fetchIssueReferenceData()
      .then((data) => {
        const nextSeries = data.series || [];
        setWarehouses(data.warehouses || []);
        setDistRules(data.distribution_rules || []);
        setProjects(data.projects || []);
        const nextBranches = data.branches || [];
        setBranches(nextBranches);
        setSeries(nextSeries);
        const defaultSeries = pickDefaultSeries(nextSeries, today());
        if (defaultSeries?.Series != null) {
          setHeader((prev) => ({
            ...prev,
            series: prev.series || String(defaultSeries.Series),
            branch: prev.branch || (nextBranches[0]?.BPLID != null ? String(nextBranches[0].BPLID) : ""),
          }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== MODES.ADD || !header.posting_date) return undefined;
    let active = true;
    fetchIssueSeries(header.posting_date, header.branch)
      .then((context) => {
        if (!active) return;
        const nextSeries = context.series || [];
        const preferred = context.defaultSeries != null ? String(context.defaultSeries) : "";
        setSeries(nextSeries);
        setHeader((prev) => {
          const valid = nextSeries.some((entry) => String(entry.Series) === String(prev.series));
          const fallback = preferred || (pickDefaultSeries(nextSeries, prev.posting_date)?.Series ?? "");
          return { ...prev, series: valid ? prev.series : String(fallback) };
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [header.branch, header.posting_date, mode]);

  const showAlert = useCallback((type, msg) => {
    clearTimeout(alertTimer.current);
    setAlert({ type, msg });
    alertTimer.current = setTimeout(() => setAlert(null), 7000);
  }, []);

  const resetForm = useCallback(() => {
    const defaultSeries = pickDefaultSeries(series, today());
    setHeader({
      ...EMPTY_HEADER,
      series: defaultSeries?.Series != null ? String(defaultSeries.Series) : "",
      posting_date: today(),
      document_date: today(),
      branch: branches[0]?.BPLID != null ? String(branches[0].BPLID) : "",
    });
    setLines([]);
    setPoInfo(null);
    setTab(0);
    setAlert(null);
    setPoModal(null);
    setCopyModal(null);
    setMode(MODES.ADD);
  }, [branches, series]);

  const handleHeaderChange = useCallback((event) => {
    const { name, value } = event.target;
    setHeader((prev) => ({ ...prev, [name]: value }));
  }, []);

  const applyProductionOrderData = useCallback((data, selectedLines = null) => {
    setPoInfo({
      doc_entry: data.doc_entry,
      doc_num: data.doc_num,
      series: data.series,
      series_name: data.series_name,
      item_code: data.item_code,
      item_name: data.item_name,
      planned_qty: data.planned_qty,
      completed_qty: data.completed_qty,
      status: data.status,
      type: data.type,
      warehouse: data.warehouse,
      due_date: data.due_date,
      start_date: data.start_date,
      branch: data.branch || "",
    });
    if (data.branch != null && data.branch !== "") {
      setHeader((prev) => ({ ...prev, branch: String(data.branch) }));
    }
    setLines((selectedLines || data.lines || []).map((line) => {
      const decorated = decorateIssueLine(line, data.doc_num);
      return {
        ...decorated,
        issue_qty: decorated.copy_qty ?? decorated.issue_qty ?? decorated.remaining_qty ?? 0,
      };
    }));
    setTab(0);
  }, []);

  const loadProductionOrder = async (docEntry, { showCopy = true } = {}) => {
    setLoading(true);
    try {
      const data = await fetchProductionOrderForIssue(docEntry);

      if ((data.lines || []).length === 0) {
        showAlert("error", "No manual-issue components found on this production order. All lines may be set to Backflush.");
        setPoInfo({
          doc_entry: data.doc_entry,
          doc_num: data.doc_num,
          series: data.series,
          series_name: data.series_name,
          item_code: data.item_code,
          item_name: data.item_name,
          status: data.status,
          type: data.type,
        });
        setLines([]);
        return;
      }

      const backflushCount = (data.lines_total_count || 0) - (data.lines || []).length;
      const msg = backflushCount > 0
        ? `${data.lines.length} manual component(s) loaded. ${backflushCount} backflush item(s) excluded.`
        : `${data.lines.length} component(s) loaded from Production Order #${data.doc_num}.`;

      if (showCopy) {
        setCopyModal({
          order: data,
          lines: (data.lines || []).map((line) => decorateIssueLine(line, data.doc_num)),
          message: msg,
        });
      } else {
        applyProductionOrderData(data);
        showAlert("success", msg);
      }
    } catch (err) {
      showAlert("error", err.response?.data?.detail || err.message || "Failed to load production order.");
    } finally {
      setLoading(false);
    }
  };

  const handlePoSelect = (po) => {
    setPoModal(null);
    loadProductionOrder(po.DocEntry);
  };

  const handleLineChange = useCallback((id, field, value) => {
    setLines((prev) => prev.map((line) => (line._id !== id ? line : { ...line, [field]: value })));
  }, []);

  const validate = () => {
    if (!poInfo?.doc_entry) {
      showAlert("error", "Select IV Production Order first.");
      return false;
    }
    if (!header.posting_date) {
      showAlert("error", "Posting date is required.");
      return false;
    }

    const validLines = lines.filter((line) => line.item_code && Number(line.issue_qty) > 0);
    if (validLines.length === 0) {
      showAlert("error", "At least one line must have a quantity greater than 0.");
      return false;
    }

    for (const line of validLines) {
      if (Number(line.issue_qty) < 0) {
        showAlert("error", `Quantity for "${line.item_code}" cannot be negative.`);
        return false;
      }
      if (!line.warehouse) {
        showAlert("error", `Whse is required for "${line.item_code}".`);
        return false;
      }
    }

    return true;
  };

  const handlePost = async () => {
    if (!validate()) return;
    setLoading(true);

    try {
      const payload = {
        prod_order_entry: poInfo.doc_entry,
        series: header.series,
        posting_date: header.posting_date,
        document_date: header.document_date,
        ref_2: header.ref_2,
        remarks: header.remarks,
        journal_remark: header.journal_remark,
        branch: header.branch,
        lines: lines
          .filter((line) => line.item_code && Number(line.issue_qty) > 0)
          .map((line) => ({
            item_code: line.item_code,
            issue_qty: Number(line.issue_qty),
            uom: line.uom,
            warehouse: line.warehouse,
            distribution_rule: line.distribution_rule,
            project: line.project,
            base_entry: line.base_entry,
            base_line: line.base_line,
            base_type: 202,
            manage_batch: line.manage_batch,
            manage_serial: line.manage_serial,
            batch_numbers: line.batch_numbers || [],
            serial_numbers: line.serial_numbers || [],
            bin_allocations: line.bin_allocations || [],
            account_code: line.account_code || "",
          })),
      };

      const result = await createIssue(payload);
      showAlert("success", `Issue for Production #${result.doc_num} posted. Inventory reduced.`);
      resetForm();
    } catch (err) {
      showAlert("error", err.response?.data?.detail || err.message || "Add failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFromList = async (docEntry) => {
    setLoading(true);
    try {
      const data = await fetchIssueByDocEntry(docEntry);
      const issue = data.issue;
      const firstOrderNo = (issue.lines || []).find((line) => line.order_no)?.order_no || "";

      setHeader({
        doc_num: issue.doc_num || "",
        series: issue.series || "",
        posting_date: issue.posting_date || today(),
        document_date: issue.document_date || issue.posting_date || today(),
        ref_2: issue.ref_2 || "",
        remarks: issue.remarks || "",
        journal_remark: issue.journal_remark || "Issue for Production",
        qr_code_from: issue.qr_code_from || "",
        branch: issue.branch || "",
      });

      setPoInfo(issue.prod_order_entry ? {
        doc_entry: issue.prod_order_entry,
        doc_num: firstOrderNo,
      } : null);
      setLines((issue.lines || []).map((line) => decorateIssueLine(line, firstOrderNo)));
      setMode(MODES.VIEW);
      setTab(0);
      showAlert("success", `Issue for Production #${issue.doc_num} loaded.`);
    } catch (err) {
      showAlert("error", err.response?.data?.detail || "Load failed.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mode === MODES.LIST) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const page = pageRef.current;
      const routeContent = page?.closest(".app-shell__content");
      const windowBody = page?.closest(".page-window-frame__body");
      const lineGrid = page?.querySelector(".ifp-grid-scroll");

      if (routeContent) routeContent.scrollTop = 0;
      if (windowBody) windowBody.scrollTop = 0;
      if (lineGrid) {
        lineGrid.scrollTop = 0;
        lineGrid.scrollLeft = 0;
      }
      window.scrollTo({ top: 0, left: 0 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  if (mode === MODES.LIST) {
    return (
      <IssueList
        onSelect={handleSelectFromList}
        onNew={() => {
          resetForm();
          setMode(MODES.ADD);
        }}
      />
    );
  }

  const isView = mode === MODES.VIEW;

  return (
    <div ref={pageRef} className="im-page ifp-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">Issue for Production</span>
        <span className={`im-mode-badge im-mode-badge--${isView ? "update" : "add"}`}>
          {isView ? "View Mode" : "Add Mode"}
        </span>

        {!isView && (
          <button className="im-btn im-btn--primary" onClick={handlePost} disabled={loading}>
            {loading ? "..." : "Add"}
          </button>
        )}
        <button className="im-btn" onClick={resetForm}>Cancel</button>
        <button className="im-btn" onClick={() => { resetForm(); setMode(MODES.ADD); }}>New</button>
<button className="im-btn" data-sap-find-action onClick={() => setMode(MODES.LIST)}>Find</button>
        <button
          type="button"
          className="im-btn"
          onClick={() => setPoModal({ type: "", title: "List of Production Orders" })}
          disabled={isView || loading}
        >
          IV Production Order
        </button>
        <button
          type="button"
          className="im-btn"
          onClick={() => setPoModal({ type: "disassembly", title: "List of Disassembly Orders" })}
          disabled={isView || loading}
        >
          Disassembly Order
        </button>
      </div>

      {alert && <div className={`im-alert im-alert--${alert.type}`}>{alert.msg}</div>}

      <div className="im-header-card ifp-sap-shell">
        <div className="ifp-header-layout">
          <div className="ifp-header-left">
            <div className="im-field">
              <label className="im-field__label ifp-lbl">Number</label>
              <input
                className="im-field__input ifp-readonly"
                value={header.doc_num || (isView ? "" : "(auto)")}
                readOnly
                style={{ width: 110 }}
              />
            </div>

            <div className="im-field">
              <label className="im-field__label ifp-lbl">Series</label>
              <select
                className="im-field__select"
                name="series"
                value={header.series}
                onChange={handleHeaderChange}
                disabled={isView}
                style={{ width: 140 }}
              >
                <option value="">--</option>
                {visibleSeries.map((entry) => (
                  <option key={entry.Series} value={entry.Series}>
                    {entry.DisplayName || entry.SeriesName || entry.Name}
                  </option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label ifp-lbl">Branch</label>
              <select className="im-field__select" name="branch" value={header.branch}
                onChange={handleHeaderChange} disabled={isView} style={{ width: 200 }}>
                <option value="">--</option>
                {branches.map((branch) => (
                  <option key={branch.BPLID} value={branch.BPLID}>{branch.BPLName}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="ifp-header-right">
            <div className="im-field">
              <label className="im-field__label ifp-lbl-r">Posting Date</label>
              <SapDateInput
                className="im-field__input"
                name="posting_date"
                
                value={header.posting_date}
                onChange={handleHeaderChange}
                readOnly={isView}
                style={{ width: 150 }}
              />
            </div>

            <div className="im-field">
              <label className="im-field__label ifp-lbl-r">Document Date</label>
              <SapDateInput
                className="im-field__input"
                name="document_date"
                
                value={header.document_date}
                onChange={handleHeaderChange}
                readOnly={isView}
                style={{ width: 150 }}
              />
            </div>

            <div className="im-field">
              <label className="im-field__label ifp-lbl-r">Ref. 2</label>
              <input
                className="im-field__input"
                name="ref_2"
                value={header.ref_2}
                onChange={handleHeaderChange}
                readOnly={isView}
                style={{ width: 150 }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="im-tabs">
        {TABS.map((tabName, index) => (
          <button
            key={tabName}
            type="button"
            className={`im-tab${tab === index ? " im-tab--active" : ""}`}
            onClick={() => setTab(index)}
          >
            {tabName}
          </button>
        ))}
      </div>

      <div className="im-tab-panel ifp-tab-panel">
        {tab === 0 && (
          <>
            {lines.length === 0 && !poInfo && (
              <div className="ifp-empty-state">
                Select IV Production Order to load components for issue.
              </div>
            )}
            {lines.length === 0 && poInfo && (
              <div className="ifp-empty-state ifp-empty-state--warn">
                No manual-issue components found. All lines on this production order may be set to Backflush.
              </div>
            )}
            {lines.length > 0 && (
              <IssueLines
                lines={lines}
                warehouses={branchWarehouses}
                distRules={distRules}
                projects={projects}
                readOnly={isView}
                onChange={handleLineChange}
                onOrderLookup={() => setPoModal({ type: "", title: "List of Production Orders" })}
                onItemLookup={() => {
                  if (poInfo && lines.length > 0) {
                    setCopyModal({ order: poInfo, lines, message: null });
                  } else {
                    setPoModal({ type: "", title: "List of Production Orders" });
                  }
                }}
              />
            )}
          </>
        )}

        {tab === 1 && (
          <div className="ifp-attachment-panel">
            <div className="ifp-grid-scroll">
              <table className="ifp-grid ifp-attachment-grid">
                <thead>
                  <tr>
                    <th className="ifp-th" style={{ width: 40 }}>#</th>
                    <th className="ifp-th" style={{ width: 330 }}>Target Path</th>
                    <th className="ifp-th" style={{ width: 270 }}>File Name</th>
                    <th className="ifp-th" style={{ width: 190 }}>Attachment Date</th>
                    <th className="ifp-th" style={{ width: 120 }}>Free Text</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 14 }).map((_, index) => (
                    <tr key={index} className="ifp-grid__row ifp-grid__row--empty">
                      <td className="ifp-grid__cell ifp-grid__cell--num">{index === 0 ? 1 : ""}</td>
                      <td className="ifp-grid__cell" />
                      <td className="ifp-grid__cell" />
                      <td className="ifp-grid__cell" />
                      <td className="ifp-grid__cell" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ifp-attachment-actions">
              <button className="im-btn" disabled>Browse</button>
              <button className="im-btn" disabled>Display</button>
              <button className="im-btn" disabled>Delete</button>
            </div>
          </div>
        )}

        {tab === 2 && (
          <div className="ifp-edoc-panel">
            <div className="ifp-edoc-row ifp-edoc-title">Generic eDoc Protocol</div>
            <div className="ifp-edoc-row"><span>eDoc Generation Type</span><input readOnly value="Not Relevant" /></div>
            <div className="ifp-edoc-row"><span>eDoc Format</span><input readOnly value="" /></div>
            <div className="ifp-edoc-row"><span>Documents Mapping Determination</span><input readOnly value="Double-click to open" /></div>
            <div className="ifp-edoc-row"><span>Document Status</span><input readOnly value="" /></div>
          </div>
        )}
      </div>

      <div className="ifp-form-footer">
        <div className="ifp-footer-left">
          <div className="im-field ifp-footer-field">
            <label className="im-field__label">Remarks</label>
            <textarea
              name="remarks"
              value={header.remarks}
              onChange={handleHeaderChange}
              readOnly={isView}
              rows={2}
              className="ifp-footer-textarea"
            />
          </div>
          <div className="im-field ifp-footer-field">
            <label className="im-field__label">Journal Remark</label>
            <input
              className="im-field__input ifp-footer-input"
              name="journal_remark"
              value={header.journal_remark}
              onChange={handleHeaderChange}
              readOnly={isView}
            />
          </div>
        </div>

        <div className="ifp-footer-right">
          <div className="im-field ifp-footer-field">
            <label className="im-field__label">Create QR Code From</label>
            <input
              className="im-field__input ifp-qr-input"
              name="qr_code_from"
              value={header.qr_code_from}
              onChange={handleHeaderChange}
              readOnly={isView}
            />
          </div>
        </div>
      </div>

      {poModal && (
        <ProductionOrderSearchModal
          title={poModal.title}
          type={poModal.type}
          onSelect={handlePoSelect}
          onClose={() => setPoModal(null)}
        />
      )}
      {copyModal && (
        <CopyItemsModal
          order={copyModal.order}
          lines={copyModal.lines}
          onOk={(selectedLines) => {
            applyProductionOrderData(copyModal.order, selectedLines);
            if (copyModal.message) showAlert("success", copyModal.message);
            setCopyModal(null);
          }}
          onClose={() => setCopyModal(null)}
        />
      )}
    </div>
  );
}
