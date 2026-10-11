import React, { useState, useCallback } from "react";
import "../item-master/styles/itemMaster.css";
import FindResultsModal from "../../components/FindResultsModal";
import GeneralTab    from "./components/GeneralTab";
import AccountingTab from "./components/AccountingTab";
import {
  createTaxCode, getTaxCode, updateTaxCode, searchTaxCodes,
  fetchTaxGLAccounts,
} from "../../api/taxCodeApi";

const TABS  = ["General", "Accounting"];
const MODES = { ADD: "add", FIND: "find", UPDATE: "update" };

const EMPTY_FORM = {
  // SAP B1 /VatGroups — exact Service Layer field names
  Code:  "",   // required — max 8 chars
  Name:  "",   // required

  // General tab
  // Category: VatGroupsTaxRegionEnum — vgtr_Output | vgtr_Input
  Category:    "vgtr_Output",
  // TaxType: VatGroupsType — vgt_Regular | vgt_Freight | vgt_DownPayment
  TaxType:     "vgt_Regular",
  // Inactive: BoYesNoEnum
  Inactive:    "tNO",
  // IsItemLevel: BoYesNoEnum
  IsItemLevel: "tNO",
  // Rate: decimal — primary tax rate %
  Rate:        "",
  // EffectiveFrom: date
  EffectiveFrom: "",
  // Deductible / NonDeductible: decimal %
  Deductible:    "",
  NonDeductible: "",

  // Accounting tab
  // TaxAccount: G/L account code
  TaxAccount:     "",
  TaxAccountName: "",
  // NonDeductibleAccount
  NonDeductibleAccount:     "",
  NonDeductibleAccountName: "",
  // AcquisitionTaxAccount
  AcquisitionTaxAccount:     "",
  AcquisitionTaxAccountName: "",
  // DeferredTaxAccount
  DeferredTaxAccount:     "",
  DeferredTaxAccountName: "",
  // EU fields
  EUCode:              "",
  // AcquisitionTax: BoYesNoEnum
  AcquisitionTax:      "tNO",
  AcquisitionTaxRate:  "",
};

function buildPayload(form) {
  const opt = (v) => v !== "" && v != null;
  const num = (v) => v !== "" && v != null && !isNaN(v) ? Number(v) : undefined;

  const p = {};

  // Required
  p.Code = form.Code;
  p.Name = form.Name;

  // General
  // Category: VatGroupsTaxRegionEnum
  p.Category    = form.Category    || "vgtr_Output";
  // TaxType: VatGroupsType
  p.TaxType     = form.TaxType     || "vgt_Regular";
  // Inactive: BoYesNoEnum
  p.Inactive    = form.Inactive    || "tNO";
  // IsItemLevel: BoYesNoEnum
  p.IsItemLevel = form.IsItemLevel || "tNO";
  // Rate: decimal
  if (num(form.Rate) != null)         p.Rate         = num(form.Rate);
  if (opt(form.EffectiveFrom))        p.EffectiveFrom = form.EffectiveFrom;
  if (num(form.Deductible) != null)   p.Deductible   = num(form.Deductible);
  if (num(form.NonDeductible) != null) p.NonDeductible = num(form.NonDeductible);

  // Accounting
  if (opt(form.TaxAccount))              p.TaxAccount              = form.TaxAccount;
  if (opt(form.NonDeductibleAccount))    p.NonDeductibleAccount    = form.NonDeductibleAccount;
  if (opt(form.AcquisitionTaxAccount))   p.AcquisitionTaxAccount   = form.AcquisitionTaxAccount;
  if (opt(form.DeferredTaxAccount))      p.DeferredTaxAccount      = form.DeferredTaxAccount;
  if (opt(form.EUCode))                  p.EUCode                  = form.EUCode;
  // AcquisitionTax: BoYesNoEnum
  p.AcquisitionTax = form.AcquisitionTax || "tNO";
  if (num(form.AcquisitionTaxRate) != null) p.AcquisitionTaxRate = num(form.AcquisitionTaxRate);

  return p;
}

export default function TaxCodeModule() {
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

  const loadTaxCode = async (code) => {
    const data = await getTaxCode(code);
    setForm({ ...EMPTY_FORM, ...data });
    setMode(MODES.UPDATE);
    showAlert("success", `"${data.Code}" loaded.`);
  };

  const handleAdd = async () => {
    if (!form.Code.trim()) { showAlert("error", "Code is required."); return; }
    if (!form.Name.trim()) { showAlert("error", "Name is required."); return; }
    setLoading(true);
    try {
      await createTaxCode(buildPayload(form));
      showAlert("success", `Tax Code "${form.Code}" created successfully.`);
      setMode(MODES.UPDATE);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to create.");
    } finally { setLoading(false); }
  };

  const handleFind = async () => {
    const code = form.Code.trim();
    const query = code || form.Name.trim();
    if (!query) { showAlert("error", "Enter a Code or Name to search."); return; }
    setLoading(true);
    try {
      if (code) {
        try {
          await loadTaxCode(code);
          return;
        } catch (_) {}
      }

      const results = await searchTaxCodes(query, "", 100);
      if (results.length === 0) {
        showAlert("error", "No matching tax codes found.");
      } else if (results.length === 1) {
        await loadTaxCode(results[0].Code);
      } else {
        setFindResults(results);
        setShowFindResults(true);
      }
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Tax Code search failed.");
    } finally { setLoading(false); }
  };

  const handleFindResultSelect = async (row) => {
    setShowFindResults(false);
    setLoading(true);
    try {
      await loadTaxCode(row.Code);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to load tax code.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!form.Code.trim()) return;
    setLoading(true);
    try {
      await updateTaxCode(form.Code.trim(), buildPayload(form));
      showAlert("success", `"${form.Code}" updated successfully.`);
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
        <span className="im-toolbar__title">Tax Code (VAT Group)</span>
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
            <label className="im-field__label">Code</label>
            {/* Code: string key — max 8 chars in SAP B1 */}
            <input
              className="im-field__input"
              name="Code"
              value={form.Code}
              onChange={handleChange}
              readOnly={mode === MODES.UPDATE}
              maxLength={8}
              autoFocus
              tabIndex={1}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Name</label>
            <input
              className="im-field__input"
              name="Name"
              value={form.Name}
              onChange={handleChange}
              tabIndex={2}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Category</label>
            {/* VatGroupsTaxRegionEnum: vgtr_Output | vgtr_Input */}
            <select
              className="im-field__select"
              name="Category"
              value={form.Category}
              onChange={handleChange}
              disabled={mode === MODES.UPDATE}
              tabIndex={3}
            >
              <option value="vgtr_Output">Output Tax (Sales)</option>
              <option value="vgtr_Input">Input Tax (Purchasing)</option>
            </select>
          </div>

          <div className="im-field">
            <label className="im-field__label">Rate %</label>
            <input
              className="im-field__input"
              name="Rate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={form.Rate}
              onChange={handleChange}
              tabIndex={4}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Inactive</label>
            <select
              className="im-field__select"
              name="Inactive"
              value={form.Inactive}
              onChange={handleChange}
              tabIndex={5}
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
        {tab === 0 && (
          <GeneralTab
            form={form}
            onChange={handleChange}
            setForm={setForm}
            fetchTaxGLAccounts={fetchTaxGLAccounts}
          />
        )}
        {tab === 1 && (
          <AccountingTab
            form={form}
            onChange={handleChange}
            setForm={setForm}
            fetchTaxGLAccounts={fetchTaxGLAccounts}
          />
        )}
      </div>

      <FindResultsModal
        open={showFindResults}
        title="Tax Code Search Results"
        columns={[
          { key: "Code", label: "Code" },
          { key: "Name", label: "Name" },
          { key: "Category", label: "Category" },
          { key: "Rate", label: "Rate" },
        ]}
        rows={findResults}
        getRowKey={(row) => row.Code}
        onClose={() => setShowFindResults(false)}
        onSelect={handleFindResultSelect}
      />
    </div>
  );
}
