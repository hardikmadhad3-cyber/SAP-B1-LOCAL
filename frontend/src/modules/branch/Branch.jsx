import React, { useState, useCallback } from "react";
import "../item-master/styles/itemMaster.css";
import FindResultsModal from "../../components/FindResultsModal";
import GeneralTab    from "./components/GeneralTab";
import AddressTab    from "./components/AddressTab";
import AccountingTab from "./components/AccountingTab";
import {
  createBranch, getBranch, updateBranch, searchBranches,
} from "../../api/branchApi";

const TABS  = ["General", "Address", "Accounting"];
const MODES = { ADD: "add", FIND: "find", UPDATE: "update" };

const EMPTY_FORM = {
  // SAP B1 /BusinessPlaces — exact Service Layer field names
  BPLID:          "",   // integer key — SAP-assigned
  BPLName:        "",   // required — branch name
  BPLNameForeign: "",

  // General tab
  VATRegNum:            "",
  RepName:              "",
  Industry:             "",
  // Disabled: BoYesNoEnum
  Disabled:             "tNO",
  DefaultWarehouseCode: "",
  Custom1:              "",
  Custom2:              "",

  // Address tab — SAP B1 BusinessPlaces address fields
  Street:   "",
  StreetNo: "",
  Block:    "",
  Building: "",
  City:     "",
  ZipCode:  "",
  County:   "",
  State:    "",
  Country:  "",
  Phone:    "",
  Fax:      "",
  Email:    "",

  // Accounting tab
  TaxOfficeName: "",
  TaxOfficeNo:   "",
  GSTIN:         "",
  // GSTType: BoGSTType enum
  GSTType:       "gstRegular",
  CompanyRegNo:  "",
  FederalTaxID:  "",
  AdditionalID:  "",
};

function buildPayload(form) {
  const opt = (v) => v !== "" && v != null;
  const p   = {};

  // Required
  p.BPLName = form.BPLName;

  // General
  if (opt(form.BPLNameForeign))       p.BPLNameForeign       = form.BPLNameForeign;
  if (opt(form.VATRegNum))            p.VATRegNum            = form.VATRegNum;
  if (opt(form.RepName))              p.RepName              = form.RepName;
  if (opt(form.Industry))             p.Industry             = form.Industry;
  // Disabled: BoYesNoEnum
  p.Disabled = form.Disabled || "tNO";
  if (opt(form.DefaultWarehouseCode)) p.DefaultWarehouseCode = form.DefaultWarehouseCode;
  if (opt(form.Custom1))              p.Custom1              = form.Custom1;
  if (opt(form.Custom2))              p.Custom2              = form.Custom2;

  // Address
  if (opt(form.Street))   p.Street   = form.Street;
  if (opt(form.StreetNo)) p.StreetNo = form.StreetNo;
  if (opt(form.Block))    p.Block    = form.Block;
  if (opt(form.Building)) p.Building = form.Building;
  if (opt(form.City))     p.City     = form.City;
  if (opt(form.ZipCode))  p.ZipCode  = form.ZipCode;
  if (opt(form.County))   p.County   = form.County;
  if (opt(form.State))    p.State    = form.State;
  if (opt(form.Country))  p.Country  = form.Country;
  if (opt(form.Phone))    p.Phone    = form.Phone;
  if (opt(form.Fax))      p.Fax      = form.Fax;
  if (opt(form.Email))    p.Email    = form.Email;

  // Accounting
  if (opt(form.TaxOfficeName)) p.TaxOfficeName = form.TaxOfficeName;
  if (opt(form.TaxOfficeNo))   p.TaxOfficeNo   = form.TaxOfficeNo;
  if (opt(form.GSTIN))         p.GSTIN         = form.GSTIN;
  if (opt(form.GSTType))       p.GSTType       = form.GSTType;
  if (opt(form.CompanyRegNo))  p.CompanyRegNo  = form.CompanyRegNo;
  if (opt(form.FederalTaxID))  p.FederalTaxID  = form.FederalTaxID;
  if (opt(form.AdditionalID))  p.AdditionalID  = form.AdditionalID;

  return p;
}

export default function BranchModule() {
  const [mode, setMode]       = useState(MODES.ADD);
  const [tab, setTab]         = useState(0);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [alert, setAlert]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [findResults, setFindResults] = useState([]);
  const [showFindResults, setShowFindResults] = useState(false);

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

  const loadBranch = async (bplid) => {
    const data = await getBranch(bplid);
    setForm({ ...EMPTY_FORM, ...data });
    setMode(MODES.UPDATE);
    showAlert("success", `"${data.BPLName}" loaded.`);
  };

  const handleAdd = async () => {
    if (!form.BPLName.trim()) { showAlert("error", "Branch Name is required."); return; }
    setLoading(true);
    try {
      const result = await createBranch(buildPayload(form));
      setForm((prev) => ({ ...prev, BPLID: result.BPLID ?? prev.BPLID }));
      showAlert("success", `Branch "${form.BPLName}" created successfully.`);
      setMode(MODES.UPDATE);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to create.");
    } finally { setLoading(false); }
  };

  const handleFind = async () => {
    const key = form.BPLID?.toString().trim();
    const query = key || form.BPLName.trim() || form.BPLNameForeign.trim();
    if (!query) { showAlert("error", "Enter a Branch ID or Branch Name to search."); return; }
    setLoading(true);
    try {
      if (key) {
        try {
          await loadBranch(key);
          return;
        } catch (_) {}
      }

      const results = await searchBranches(query, 100);
      if (results.length === 0) {
        showAlert("error", "No matching branches found.");
      } else if (results.length === 1) {
        await loadBranch(results[0].BPLID);
      } else {
        setFindResults(results);
        setShowFindResults(true);
      }
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Branch search failed.");
    } finally { setLoading(false); }
  };

  const handleFindResultSelect = async (row) => {
    setShowFindResults(false);
    setLoading(true);
    try {
      await loadBranch(row.BPLID);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to load branch.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    const key = form.BPLID?.toString().trim();
    if (!key) return;
    setLoading(true);
    try {
      await updateBranch(key, buildPayload(form));
      showAlert("success", `"${form.BPLName}" updated successfully.`);
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
        <span className="im-toolbar__title">Branch (Business Place)</span>
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
            <label className="im-field__label">Branch ID (BPLID)</label>
            {/* BPLID: SAP-assigned integer key */}
            <input
              className="im-field__input"
              name="BPLID"
              value={form.BPLID}
              onChange={handleChange}
              readOnly={mode === MODES.UPDATE}
              placeholder={mode === MODES.ADD ? "Assigned by SAP" : ""}
              style={mode === MODES.ADD ? { background: "#f0f2f5", color: "#888" } : {}}
              autoFocus
              tabIndex={1}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Branch Name</label>
            {/* BPLName: required */}
            <input
              className="im-field__input"
              name="BPLName"
              value={form.BPLName}
              onChange={handleChange}
              tabIndex={2}
              placeholder="e.g. Head Office, London Branch"
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Disabled</label>
            {/* Disabled: BoYesNoEnum */}
            <select
              className="im-field__select"
              name="Disabled"
              value={form.Disabled}
              onChange={handleChange}
              tabIndex={3}
            >
              <option value="tNO">No</option>
              <option value="tYES">Yes</option>
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
        {tab === 0 && <GeneralTab    form={form} onChange={handleChange} />}
        {tab === 1 && <AddressTab    form={form} onChange={handleChange} />}
        {tab === 2 && <AccountingTab form={form} onChange={handleChange} />}
      </div>

      <FindResultsModal
        open={showFindResults}
        title="Branch Search Results"
        columns={[
          { key: "BPLID", label: "ID" },
          { key: "BPLName", label: "Branch Name" },
          { key: "BPLNameForeign", label: "Foreign Name" },
        ]}
        rows={findResults}
        getRowKey={(row) => row.BPLID}
        onClose={() => setShowFindResults(false)}
        onSelect={handleFindResultSelect}
      />
    </div>
  );
}
