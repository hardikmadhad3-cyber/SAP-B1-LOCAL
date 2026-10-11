import React, { useState, useCallback } from "react";
import "../item-master/styles/itemMaster.css";
import FindResultsModal from "../../components/FindResultsModal";
import GeneralTab      from "./components/GeneralTab";
import InstallmentsTab from "./components/InstallmentsTab";
import {
  createPaymentTerms, getPaymentTerms, updatePaymentTerms, searchPaymentTerms,
} from "../../api/paymentTermsApi";

const TABS  = ["General", "Installments"];
const MODES = { ADD: "add", FIND: "find", UPDATE: "update" };

const EMPTY_FORM = {
  // SAP B1 /PaymentTermsTypes — exact Service Layer field names
  GroupNumber:            "",   // integer key — SAP-assigned, used for GET/PATCH
  PaymentTermsGroupName:  "",   // required — display name
  // PaymentTermsGroupCode: string — short code (optional, SAP may auto-assign)
  PaymentTermsGroupCode:  "",

  // General tab
  // BaselineDate: BoBaselineDate — bld_PostingDate | bld_SystemDate | bld_DueDate
  BaselineDate:                    "bld_PostingDate",
  // StartFrom: BoPaymentTermsStartFrom — ptsf_DayOfMonth | ptsf_HalfMonth | ptsf_MonthEnd
  StartFrom:                       "ptsf_DayOfMonth",
  NumberOfAdditionalMonths:        "",
  NumberOfAdditionalDays:          "",
  NumberOfInstallments:            "",
  // CashDiscountPercent: decimal
  CashDiscountPercent:             "",
  // DiscountCode: string — links to CashDiscounts entity
  DiscountCode:                    "",
  // CreditLimit: decimal
  CreditLimit:                     "",
  // LoadLimitCredit: BoYesNoEnum
  LoadLimitCredit:                 "tNO",
  // OpenIncomingPaymentsByDueDate: BoYesNoEnum
  OpenIncomingPaymentsByDueDate:   "tNO",
  // PaymentMethod: string — default payment method code
  PaymentMethod:                   "",

  // Installments tab — PaymentTermsInstallments collection
  PaymentTermsInstallments: [],
};

function buildPayload(form) {
  const opt = (v) => v !== "" && v != null;
  const num = (v) => v !== "" && v != null && !isNaN(v) ? Number(v) : undefined;

  const p = {};

  // Required
  p.PaymentTermsGroupName = form.PaymentTermsGroupName;

  // Optional header fields
  if (opt(form.PaymentTermsGroupCode)) p.PaymentTermsGroupCode = form.PaymentTermsGroupCode;

  // General
  // BaselineDate: BoBaselineDate enum
  p.BaselineDate = form.BaselineDate || "bld_PostingDate";
  // StartFrom: BoPaymentTermsStartFrom enum
  p.StartFrom    = form.StartFrom    || "ptsf_DayOfMonth";

  if (num(form.NumberOfAdditionalMonths) != null) p.NumberOfAdditionalMonths = num(form.NumberOfAdditionalMonths);
  if (num(form.NumberOfAdditionalDays)   != null) p.NumberOfAdditionalDays   = num(form.NumberOfAdditionalDays);
  if (num(form.NumberOfInstallments)     != null) p.NumberOfInstallments     = num(form.NumberOfInstallments);
  if (num(form.CashDiscountPercent)      != null) p.CashDiscountPercent      = num(form.CashDiscountPercent);
  if (opt(form.DiscountCode))                     p.DiscountCode             = form.DiscountCode;
  if (num(form.CreditLimit)              != null) p.CreditLimit              = num(form.CreditLimit);
  // LoadLimitCredit: BoYesNoEnum
  p.LoadLimitCredit               = form.LoadLimitCredit               || "tNO";
  // OpenIncomingPaymentsByDueDate: BoYesNoEnum
  p.OpenIncomingPaymentsByDueDate = form.OpenIncomingPaymentsByDueDate || "tNO";
  if (opt(form.PaymentMethod)) p.PaymentMethod = form.PaymentMethod;

  // Installments — PaymentTermsInstallments collection
  const lines = (form.PaymentTermsInstallments || [])
    .filter((l) => l.Percent !== "" && l.Percent != null)
    .map((l, idx) => {
      const line = {};
      // InstallmentNumber: 1-based integer
      line.InstallmentNumber = idx + 1;
      if (num(l.Percent)                  != null) line.Percent                  = num(l.Percent);
      if (num(l.NumberOfAdditionalMonths) != null) line.NumberOfAdditionalMonths = num(l.NumberOfAdditionalMonths);
      if (num(l.NumberOfAdditionalDays)   != null) line.NumberOfAdditionalDays   = num(l.NumberOfAdditionalDays);
      // BaselineDate: BoBaselineDate enum
      if (opt(l.BaselineDate)) line.BaselineDate = l.BaselineDate;
      // StartFrom: BoPaymentTermsStartFrom enum
      if (opt(l.StartFrom))    line.StartFrom    = l.StartFrom;
      return line;
    });

  if (lines.length > 0) p.PaymentTermsInstallments = lines;

  return p;
}

export default function PaymentTermsModule() {
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

  const loadPaymentTerms = async (groupNumber) => {
    const data = await getPaymentTerms(groupNumber);
    setForm({ ...EMPTY_FORM, ...data });
    setMode(MODES.UPDATE);
    showAlert("success", `"${data.PaymentTermsGroupName}" loaded.`);
  };

  const handleAdd = async () => {
    if (!form.PaymentTermsGroupName.trim()) {
      showAlert("error", "Payment Terms Name is required.");
      return;
    }
    setLoading(true);
    try {
      const result = await createPaymentTerms(buildPayload(form));
      setForm((prev) => ({ ...prev, GroupNumber: result.GroupNumber ?? prev.GroupNumber }));
      showAlert("success", `Payment Terms "${form.PaymentTermsGroupName}" created successfully.`);
      setMode(MODES.UPDATE);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to create.");
    } finally { setLoading(false); }
  };

  const handleFind = async () => {
    const key = form.GroupNumber?.toString().trim();
    const query = key || form.PaymentTermsGroupName.trim() || form.PaymentTermsGroupCode.trim();
    if (!query) { showAlert("error", "Enter a Group Number, Code, or Name to search."); return; }
    setLoading(true);
    try {
      if (key) {
        try {
          await loadPaymentTerms(key);
          return;
        } catch (_) {}
      }

      const results = await searchPaymentTerms(query, 100);
      if (results.length === 0) {
        showAlert("error", "No matching payment terms found.");
      } else if (results.length === 1) {
        await loadPaymentTerms(results[0].GroupNumber);
      } else {
        setFindResults(results);
        setShowFindResults(true);
      }
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Payment Terms search failed.");
    } finally { setLoading(false); }
  };

  const handleFindResultSelect = async (row) => {
    setShowFindResults(false);
    setLoading(true);
    try {
      await loadPaymentTerms(row.GroupNumber);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to load payment terms.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    const key = form.GroupNumber?.toString().trim();
    if (!key) return;
    setLoading(true);
    try {
      await updatePaymentTerms(key, buildPayload(form));
      showAlert("success", `"${form.PaymentTermsGroupName}" updated successfully.`);
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
        <span className="im-toolbar__title">Payment Terms</span>
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
            <label className="im-field__label">Group Number</label>
            {/* GroupNumber: SAP-assigned integer key */}
            <input
              className="im-field__input"
              name="GroupNumber"
              value={form.GroupNumber}
              onChange={handleChange}
              readOnly={mode === MODES.UPDATE}
              placeholder={mode === MODES.ADD ? "Assigned by SAP" : ""}
              style={mode === MODES.ADD ? { background: "#f0f2f5", color: "#888" } : {}}
              tabIndex={1}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Name</label>
            <input
              className="im-field__input"
              name="PaymentTermsGroupName"
              value={form.PaymentTermsGroupName}
              onChange={handleChange}
              autoFocus
              tabIndex={2}
              placeholder="e.g. Net 30, 2/10 Net 30"
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Code</label>
            {/* PaymentTermsGroupCode: short string code */}
            <input
              className="im-field__input"
              name="PaymentTermsGroupCode"
              value={form.PaymentTermsGroupCode}
              onChange={handleChange}
              readOnly={mode === MODES.UPDATE}
              tabIndex={3}
              placeholder="e.g. NET30"
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Payment Method</label>
            {/* PaymentMethod: string — default payment method code */}
            <input
              className="im-field__input"
              name="PaymentMethod"
              value={form.PaymentMethod}
              onChange={handleChange}
              tabIndex={4}
              placeholder="Method code"
            />
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
        {tab === 1 && <InstallmentsTab form={form} setForm={setForm} />}
      </div>

      <FindResultsModal
        open={showFindResults}
        title="Payment Terms Search Results"
        columns={[
          { key: "GroupNumber", label: "No." },
          { key: "PaymentTermsGroupCode", label: "Code" },
          { key: "PaymentTermsGroupName", label: "Name" },
        ]}
        rows={findResults}
        getRowKey={(row) => row.GroupNumber}
        onClose={() => setShowFindResults(false)}
        onSelect={handleFindResultSelect}
      />
    </div>
  );
}
