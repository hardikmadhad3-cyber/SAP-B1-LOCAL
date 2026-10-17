import React, { useCallback, useState } from "react";
import "../item-master/styles/itemMaster.css";
import SapLookupModal from "../../components/common/SapLookupModal";
import {
  fetchHSNCodes, fetchSACCodes, createHSNCode, updateHSNCode, createSACCode, updateSACCode,
} from "../../api/hsnCodeApi";

// SAP B1 India: HSN codes for goods (Chapter ID, OCHP) and SAC codes for
// services (OSAC). Items link to them; documents print them for GST.
// The server enforces the formats; its messages are shown as they come.

const asRows = (data) => (Array.isArray(data) ? data : data?.value || []);

const errorText = (err, fallback) => err.response?.data?.message || err.message || fallback;

// Mirrors the server: chapter (2) . heading (2) . sub-heading (rest).
const hsnParts = (code = "") => ({ chapter: code.slice(0, 2), heading: code.slice(2, 4), subHeading: code.slice(4) });

const KINDS = {
  hsn: {
    title: "HSN Codes - Setup",
    codeLabel: "HSN Code*",
    nameLabel: "Description*",
    codeLength: 8,
    nameLength: 120,
    hint: "4, 6 or 8 digits, e.g. 8471 or 84713010",
    fetch: (query) => fetchHSNCodes(query).then((r) => asRows(r.data)),
    toForm: (row) => ({ absEntry: row.absEntry, code: row.code, name: row.description }),
    toPayload: (form) => ({ ChapterID: form.code.trim(), Description: form.name.trim() }),
    fromSaved: (saved) => ({ absEntry: saved.AbsEntry, code: saved.ChapterID, name: saved.Description }),
    create: createHSNCode,
    update: updateHSNCode,
    columns: [{ key: "code", label: "HSN Code" }, { key: "description", label: "Description" }],
  },
  sac: {
    title: "SAC Codes - Setup",
    codeLabel: "SAC Code*",
    nameLabel: "Service Name*",
    codeLength: 6,
    nameLength: 254,
    hint: "6 digits starting with 99, e.g. 998314",
    fetch: (query) => fetchSACCodes(query).then((r) => asRows(r.data)),
    toForm: (row) => ({ absEntry: row.absEntry, code: row.code, name: row.serviceName }),
    toPayload: (form) => ({ ServiceCode: form.code.trim(), ServiceName: form.name.trim() }),
    fromSaved: (saved) => ({ absEntry: saved.AbsEntry, code: saved.ServiceCode, name: saved.ServiceName }),
    create: createSACCode,
    update: updateSACCode,
    columns: [{ key: "code", label: "SAC Code" }, { key: "serviceName", label: "Service Name" }],
  },
};

const EMPTY = { absEntry: null, code: "", name: "" };

function CodeTab({ kind, children }) {
  const config = KINDS[kind];
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [finding, setFinding] = useState(false);
  const [alert, setAlert] = useState(null);
  const mode = form.absEntry ? "update" : "add";
  const showAlert = useCallback((type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 6000);
  }, []);

  const save = async () => {
    setLoading(true);
    try {
      const payload = config.toPayload(form);
      const saved = mode === "add" ? await config.create(payload) : await config.update(form.absEntry, payload);
      setForm(config.fromSaved(saved));
      showAlert("success", `${config.codeLabel.replace("*", "")} "${payload.ChapterID || payload.ServiceCode}" ${mode === "add" ? "added" : "updated"}.`);
    } catch (err) {
      showAlert("error", errorText(err, "Could not save."));
    } finally {
      setLoading(false);
    }
  };

  const parts = hsnParts(form.code);
  return (
    <div className="im-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">{config.title}</span>
        <span className={`im-mode-badge im-mode-badge--${mode}`}>{mode.toUpperCase()}</span>
        <button type="button" className="im-btn im-btn--primary" onClick={save} disabled={loading}>
          {loading ? "..." : mode === "add" ? "Add" : "Update"}
        </button>
        <button type="button" className="im-btn" onClick={() => setForm(EMPTY)}>New</button>
        <button type="button" className="im-btn" onClick={() => setFinding(true)}>Find</button>
      </div>
      {alert && (
        <div className={`im-alert im-alert--${alert.type}`} role={alert.type === "error" ? "alert" : "status"}>{alert.msg}</div>
      )}

      {children}

      <div className="im-tab-panel">
        <div className="im-field-grid">
          <label className="im-field">
            <span className="im-field__label">{config.codeLabel}</span>
            <input className="im-field__input" value={form.code} maxLength={config.codeLength}
              inputMode="numeric" title={config.hint} placeholder={config.hint.split(",")[0]} autoFocus
              onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })} />
          </label>
          <label className="im-field">
            <span className="im-field__label">{config.nameLabel}</span>
            <input className="im-field__input" value={form.name} maxLength={config.nameLength}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          {kind === "hsn" && [["Chapter", parts.chapter], ["Heading", parts.heading], ["Sub-Heading", parts.subHeading]].map(([label, value]) => (
            <label className="im-field" key={label}>
              <span className="im-field__label">{label}</span>
              <input className="im-field__input im-field__input--readonly" value={value} readOnly />
            </label>
          ))}
        </div>
      </div>

      <SapLookupModal
        open={finding}
        title={`Find ${kind.toUpperCase()} Code`}
        columns={config.columns}
        fetchOptions={config.fetch}
        onClose={() => setFinding(false)}
        onSelect={(row) => { setForm(config.toForm(row)); setFinding(false); }}
      />
    </div>
  );
}

// SAP B1 setup windows put the toolbar on top and the tabs under it, so the
// tab strip is rendered inside each tab's page rather than above the toolbar.
export default function HsnSacCodes() {
  const [tab, setTab] = useState("hsn");
  const tabs = (
    <div className="im-tabs" role="tablist">
      {[["hsn", "HSN (Goods)"], ["sac", "SAC (Services)"]].map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key}
          className={`im-tab${tab === key ? " im-tab--active" : ""}`} onClick={() => setTab(key)}>{label}</button>
      ))}
    </div>
  );
  return <CodeTab key={tab} kind={tab}>{tabs}</CodeTab>;
}
