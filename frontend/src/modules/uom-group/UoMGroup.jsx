import React, { useState, useCallback, useEffect } from "react";
import "../item-master/styles/itemMaster.css";
import FindResultsModal from "../../components/FindResultsModal";
import UoMLinesTab from "./components/UoMLinesTab";
import {
  createUoMGroup, getUoMGroup, updateUoMGroup, searchUoMGroups,
  fetchUoMs,
} from "../../api/uomGroupApi";

const TABS  = ["UoM Lines"];
const MODES = { ADD: "add", FIND: "find", UPDATE: "update" };

const EMPTY_FORM = {
  // SAP B1 /UnitOfMeasurementGroups — exact Service Layer field names
  AbsEntry: "",   // integer key — assigned by SAP, used for GET/PATCH
  Name:     "",   // required — group name e.g. "Weight", "Volume"
  // BaseUoM: integer (AbsEntry of UnitOfMeasurements) — the base unit for this group
  BaseUoM:     "",
  BaseUoMCode: "",  // display only
  // UnitOfMeasurementGroupLines: collection of alternate UoMs with conversion factors
  UnitOfMeasurementGroupLines: [],
};

function buildPayload(form) {
  const num = (v) => v !== "" && v != null && !isNaN(v) ? Number(v) : undefined;
  const opt = (v) => v !== "" && v != null;

  const p = {};

  // Required
  p.Name = form.Name;

  // BaseUoM: integer AbsEntry
  if (num(form.BaseUoM) != null) p.BaseUoM = num(form.BaseUoM);

  // Lines — UnitOfMeasurementGroupLines collection
  const lines = (form.UnitOfMeasurementGroupLines || [])
    .filter((l) => l.AlternateUoM !== "" && l.AlternateUoM != null)
    .map((l) => {
      const line = {};
      // AlternateUoM: integer AbsEntry of UnitOfMeasurements
      if (num(l.AlternateUoM) != null) line.AlternateUoM      = num(l.AlternateUoM);
      // BaseQuantity / AlternateQuantity: decimal
      if (num(l.BaseQuantity) != null)      line.BaseQuantity      = num(l.BaseQuantity);
      if (num(l.AlternateQuantity) != null) line.AlternateQuantity = num(l.AlternateQuantity);
      // UoMType: BoUoMTypeEnum — uomtSales | uomtPurchasing | uomtInventory | uomtAdditional
      if (opt(l.UoMType)) line.UoMType = l.UoMType;
      return line;
    });

  if (lines.length > 0) p.UnitOfMeasurementGroupLines = lines;

  return p;
}

export default function UoMGroupModule() {
  const [mode, setMode]           = useState(MODES.ADD);
  const [tab, setTab]             = useState(0);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [alert, setAlert]         = useState(null);
  const [loading, setLoading]     = useState(false);
  const [uomOptions, setUomOptions] = useState([]);
  const [findResults, setFindResults] = useState([]);
  const [showFindResults, setShowFindResults] = useState(false);

  // Load all UoMs once for dropdowns
  useEffect(() => {
    fetchUoMs().then(setUomOptions).catch(() => {});
  }, []);

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setTab(0);
    setAlert(null);
    setFindResults([]);
    setShowFindResults(false);
  };

  const loadUoMGroup = async (absEntry) => {
    const data = await getUoMGroup(absEntry);
    setForm({ ...EMPTY_FORM, ...data });
    setMode(MODES.UPDATE);
    showAlert("success", `"${data.Name}" loaded.`);
  };

  const handleAdd = async () => {
    if (!form.Name.trim()) { showAlert("error", "Name is required."); return; }
    setLoading(true);
    try {
      const result = await createUoMGroup(buildPayload(form));
      setForm((prev) => ({ ...prev, AbsEntry: result.AbsEntry ?? prev.AbsEntry }));
      showAlert("success", `UoM Group "${form.Name}" created successfully.`);
      setMode(MODES.UPDATE);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to create.");
    } finally { setLoading(false); }
  };

  const handleFind = async () => {
    const key = form.AbsEntry?.toString().trim();
    const query = key || form.Name.trim();
    if (!query) { showAlert("error", "Enter an ID or Group Name to search."); return; }
    setLoading(true);
    try {
      if (key) {
        try {
          await loadUoMGroup(key);
          return;
        } catch (_) {}
      }

      const results = await searchUoMGroups(query, 100);
      if (results.length === 0) {
        showAlert("error", "No matching UoM groups found.");
      } else if (results.length === 1) {
        await loadUoMGroup(results[0].AbsEntry);
      } else {
        setFindResults(results);
        setShowFindResults(true);
      }
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "UoM Group search failed.");
    } finally { setLoading(false); }
  };

  const handleFindResultSelect = async (row) => {
    setShowFindResults(false);
    setLoading(true);
    try {
      await loadUoMGroup(row.AbsEntry);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to load UoM group.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    const key = form.AbsEntry?.toString().trim();
    if (!key) return;
    setLoading(true);
    try {
      await updateUoMGroup(key, buildPayload(form));
      showAlert("success", `"${form.Name}" updated successfully.`);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to update.");
    } finally { setLoading(false); }
  };

  const handleSave = () => {
    if (mode === MODES.ADD)    return handleAdd();
    if (mode === MODES.UPDATE) return handleUpdate();
    if (mode === MODES.FIND)   return handleFind();
  };

  return (
    <div className="im-page">
      {/* Toolbar */}
      <div className="im-toolbar">
        <span className="im-toolbar__title">Unit of Measure Group</span>
        <span className={`im-mode-badge im-mode-badge--${mode}`}>
          {mode === MODES.ADD ? "Add Mode" : mode === MODES.FIND ? "Find Mode" : "Update Mode"}
        </span>
        <button className="im-btn im-btn--primary" onClick={handleSave} disabled={loading}>
          {loading ? "..." : mode === MODES.FIND ? "Find" : mode === MODES.ADD ? "Add" : "Update"}
        </button>
        <button className="im-btn" onClick={() => { setMode(MODES.ADD); resetForm(); }}>New</button>
        <button className="im-btn" data-sap-find-action onClick={() => { setMode(MODES.FIND); resetForm(); }}>Find</button>
        {mode === MODES.UPDATE && (
          <button className="im-btn im-btn--danger" onClick={resetForm}>Cancel</button>
        )}
      </div>

      {alert && <div className={`im-alert im-alert--${alert.type}`}>{alert.msg}</div>}

      {/* Header card */}
      <div className="im-header-card">
        <div className="im-field-grid">

          <div className="im-field">
            <label className="im-field__label">AbsEntry (ID)</label>
            {/* AbsEntry: SAP-assigned integer key — editable only in Find mode */}
            <input
              className="im-field__input"
              name="AbsEntry"
              value={form.AbsEntry}
              onChange={handleChange}
              readOnly={mode === MODES.UPDATE}
              placeholder={mode === MODES.ADD ? "Assigned by SAP" : ""}
              style={mode === MODES.ADD ? { background: "#f0f2f5", color: "#888" } : {}}
              tabIndex={1}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Group Name</label>
            <input
              className="im-field__input"
              name="Name"
              value={form.Name}
              onChange={handleChange}
              autoFocus
              tabIndex={2}
              placeholder="e.g. Weight, Volume, Length"
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Base UoM</label>
            {/* BaseUoM: integer AbsEntry of UnitOfMeasurements — the reference unit */}
            <select
              className="im-field__select"
              name="BaseUoM"
              value={form.BaseUoM !== "" ? String(form.BaseUoM) : ""}
              onChange={(e) => {
                const opt = uomOptions.find((u) => u.code === e.target.value);
                setForm((p) => ({
                  ...p,
                  BaseUoM:     e.target.value,
                  BaseUoMCode: opt?.uomCode || "",
                }));
              }}
              tabIndex={3}
            >
              <option value="">-- Select Base UoM --</option>
              {uomOptions.map((u) => (
                <option key={u.code} value={u.code}>{u.name}</option>
              ))}
            </select>
          </div>

        </div>
      </div>

      {/* Tabs */}
      <div className="im-tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            type="button"
            className={`im-tab${tab === i ? " im-tab--active" : ""}`}
            onClick={() => setTab(i)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="im-tab-panel">
        {tab === 0 && (
          <UoMLinesTab
            form={form}
            setForm={setForm}
            uomOptions={uomOptions}
          />
        )}
      </div>

      <FindResultsModal
        open={showFindResults}
        title="UoM Group Search Results"
        columns={[
          { key: "AbsEntry", label: "ID" },
          { key: "Code", label: "Code" },
          { key: "Name", label: "Group Name" },
        ]}
        rows={findResults}
        getRowKey={(row) => row.AbsEntry}
        onClose={() => setShowFindResults(false)}
        onSelect={handleFindResultSelect}
      />
    </div>
  );
}
