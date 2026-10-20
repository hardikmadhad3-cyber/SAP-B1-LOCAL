import React, { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../item-master/styles/itemMaster.css";
import FindResultsModal from "../../components/FindResultsModal";
import { isRouteStateForActiveCompany } from "../../utils/companyStorageScope";
import { replaceRouteStatePreservingWindow } from "../../utils/copyToState";
import {
  createAccount,
  getAccount,
  updateAccount,
  searchAccounts,
  fetchParentAccounts,
  fetchCoACurrencies,
} from "../../api/chartOfAccountsApi";

const EMPTY_FORM = {
  Code: "",
  Name: "",
  ExternalCode: "",
  AccountCurrency: "",
  Confidential: "tNO",
  Level: "",
  Balance: 0,
  BalanceCurrency: "",
  AccountType: "sat_Other",
  ControlAccount: "tNO",
  CashAccount: "tNO",
  RevaluationCoordinated: "tNO",
  BlockManualPosting: "tNO",
  CashFlowRelevant: "tNO",
  ProjectCode: "",
  IsTitleAccount: "tNO",
  ActiveAccount: "tYES",
  FatherAccountKey: "",
};

const ACCOUNT_TYPES = [
  ["sat_Other", "Other"],
  ["sat_Assets", "Assets"],
  ["sat_Liabilities", "Liabilities"],
  ["sat_Equity", "Equity"],
  ["sat_Revenues", "Revenues"],
  ["sat_Expenditure", "Expenditure"],
];

const PROPERTY_FLAGS = [
  ["ControlAccount", "Control Account"],
  ["CashAccount", "Cash Account"],
  ["RevaluationCoordinated", "Reval. (Currency)"],
  ["BlockManualPosting", "Block Manual Posting"],
  ["CashFlowRelevant", "Cash Flow Relevant"],
];

// SAP B1: a top-level account is level 1; a child is one below its title account.
export const previewAccountLevel = (form, parentAccounts) => {
  if (form.Level) return form.Level;
  const parent = parentAccounts.find((account) => account.code === form.FatherAccountKey);
  return parent ? (Number(parent.level) || 1) + 1 : 1;
};

const formatBalance = (value) =>
  Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ChartOfAccounts() {
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  // The company's own currencies (OCRN), not a fixed list.
  const [currencies, setCurrencies] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("add");
  const [findResults, setFindResults] = useState([]);
  const [showFindResults, setShowFindResults] = useState(false);
  const [parentAccounts, setParentAccounts] = useState([]);

  const localCurrency = currencies.find((currency) => currency.local)?.code || "";

  const refreshParentAccounts = useCallback(() => {
    fetchParentAccounts("").then((rows) => setParentAccounts(Array.isArray(rows) ? rows : [])).catch(() => setParentAccounts([]));
  }, []);

  useEffect(() => {
    fetchCoACurrencies("").then((rows) => setCurrencies(Array.isArray(rows) ? rows : [])).catch(() => setCurrencies([]));
    refreshParentAccounts();
  }, [refreshParentAccounts]);

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (checked ? "tYES" : "tNO") : value,
      // Level follows the parent until the account is saved.
      ...(name === "FatherAccountKey" && !prev.Code ? { Level: "" } : {}),
    }));
  }, []);

  const loadAccount = async (code) => {
    const data = await getAccount(code);
    setForm({ ...EMPTY_FORM, ...data });
    setMode("update");
    showAlert("success", `Account "${data.Code}" loaded.`);
  };

  useEffect(() => {
    let ignore = false;
    const stateAccountCode = location.state?.accountCode || location.state?.glAccountCode;
    const accountCode = stateAccountCode || new URLSearchParams(location.search).get("accountCode");
    const normalizedAccountCode = String(accountCode || "").trim();

    if (!normalizedAccountCode) {
      return () => {
        ignore = true;
      };
    }

    if (stateAccountCode && !isRouteStateForActiveCompany(location.state)) {
      replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
      return () => {
        ignore = true;
      };
    }

    const loadRoutedAccount = async () => {
      setLoading(true);
      try {
        const data = await getAccount(normalizedAccountCode);
        if (ignore) return;
        setForm({ ...EMPTY_FORM, ...data });
        setMode("update");
        showAlert("success", `Account "${data.Code}" loaded.`);
        if (stateAccountCode) {
          replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
        }
      } catch (err) {
        if (!ignore) {
          showAlert("error", err.response?.data?.message || err.message || `Could not load account "${normalizedAccountCode}".`);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    loadRoutedAccount();

    return () => {
      ignore = true;
    };
  }, [location.pathname, location.search, location.state, navigate]);

  // SAP B1: Find with empty criteria lists every account.
  const handleFind = async () => {
    const code = form.Code.trim();
    const query = code || form.Name.trim();
    setLoading(true);
    try {
      if (code) {
        try {
          await loadAccount(code);
          return;
        } catch (_) {}
      }

      const results = await searchAccounts(query, "", 500);
      if (results.length === 0) {
        showAlert("error", "No matching accounts found.");
      } else if (results.length === 1) {
        await loadAccount(results[0].Code);
      } else {
        setFindResults(results);
        setShowFindResults(true);
      }
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Account search failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setForm(EMPTY_FORM);
    setMode("add");
    setAlert(null);
    setFindResults([]);
    setShowFindResults(false);
  };

  const handleFindResultSelect = async (row) => {
    setShowFindResults(false);
    setLoading(true);
    try {
      await loadAccount(row.Code);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to load account.");
    } finally {
      setLoading(false);
    }
  };

  const buildPayload = () => ({
    Code: form.Code.trim(),
    Name: form.Name.trim(),
    // Emptied fields are sent as null so the stored value is cleared.
    ExternalCode: form.ExternalCode?.trim() || null,
    AccountCurrency: form.AccountCurrency || null,
    ProjectCode: form.ProjectCode?.trim() || null,
    FatherAccountKey: form.FatherAccountKey || null,
    AccountType: form.AccountType || "sat_Other",
    IsTitleAccount: form.IsTitleAccount || "tNO",
    ActiveAccount: form.ActiveAccount || "tYES",
    Confidential: form.Confidential || "tNO",
    ControlAccount: form.ControlAccount || "tNO",
    CashAccount: form.CashAccount || "tNO",
    RevaluationCoordinated: form.RevaluationCoordinated || "tNO",
    BlockManualPosting: form.BlockManualPosting || "tNO",
    CashFlowRelevant: form.CashFlowRelevant || "tNO",
  });

  const handleSave = async () => {
    if (!form.Code.trim()) {
      showAlert("error", "G/L Account code is required.");
      return;
    }
    if (!form.Name.trim()) {
      showAlert("error", "Name is required.");
      return;
    }

    setLoading(true);
    try {
      const code = form.Code.trim();
      if (mode === "add") {
        await createAccount(buildPayload());
      } else {
        await updateAccount(code, buildPayload());
      }
      // Reload so Level and Balance show the saved values, and a new title
      // account can be chosen as a parent straight away.
      setForm({ ...EMPTY_FORM, ...(await getAccount(code)) });
      setMode("update");
      refreshParentAccounts();
      showAlert("success", `Account "${code}" ${mode === "add" ? "created" : "updated"} successfully.`);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to save.");
    } finally {
      setLoading(false);
    }
  };

  const isTitle = form.IsTitleAccount === "tYES";

  return (
    <div className="im-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">Chart of Accounts - Setup</span>
        <span className={`im-mode-badge im-mode-badge--${mode}`}>{mode === "add" ? "Add Mode" : "Update Mode"}</span>
        <button className="im-btn im-btn--primary" onClick={handleSave} disabled={loading}>
          {loading ? "..." : mode === "add" ? "Add" : "Update"}
        </button>
        <button className="im-btn" onClick={handleCancel}>Cancel</button>
        <button className="im-btn" onClick={handleFind} disabled={loading}>Find</button>
      </div>

      {alert && (
        <div className={`im-alert im-alert--${alert.type}`} role={alert.type === "error" ? "alert" : "status"}>{alert.msg}</div>
      )}

      <div className="im-header-card">
        <div className="im-header-left">
          <div className="im-section-title">G/L Account Details</div>
          <div className="im-checkboxes" role="radiogroup" aria-label="Account kind">
            <label className="im-checkbox-label">
              <input
                type="radio"
                name="AccountKind"
                checked={isTitle}
                onChange={() => setForm((prev) => ({ ...prev, IsTitleAccount: "tYES" }))}
              />
              Title
            </label>
            <label className="im-checkbox-label">
              <input
                type="radio"
                name="AccountKind"
                checked={!isTitle}
                onChange={() => setForm((prev) => ({ ...prev, IsTitleAccount: "tNO" }))}
              />
              Active Account
            </label>
          </div>
          <div className="im-field-grid">
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-code">G/L Account*</label>
              <input
                id="coa-code"
                className={`im-field__input${mode === "update" ? " im-field__input--readonly" : ""}`}
                name="Code"
                value={form.Code}
                onChange={handleChange}
                readOnly={mode === "update"}
                autoFocus
              />
            </div>
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-name">Name*</label>
              <input id="coa-name" className="im-field__input" name="Name" value={form.Name} onChange={handleChange} />
            </div>
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-parent">Parent (Title) Account</label>
              <select
                id="coa-parent"
                className="im-field__input im-field__select"
                name="FatherAccountKey"
                value={form.FatherAccountKey || ""}
                onChange={handleChange}
              >
                <option value="">None (top level)</option>
                {parentAccounts
                  .filter((account) => account.code !== form.Code)
                  .map((account) => (
                    <option key={account.code} value={account.code}>{account.name}</option>
                  ))}
              </select>
            </div>
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-external">External Code</label>
              <input id="coa-external" className="im-field__input" name="ExternalCode" value={form.ExternalCode} onChange={handleChange} />
            </div>
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-currency">Currency</label>
              <select
                id="coa-currency"
                className="im-field__input im-field__select"
                name="AccountCurrency"
                value={form.AccountCurrency}
                onChange={handleChange}
              >
                <option value="">Select Currency</option>
                <option value="##">All Currencies</option>
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>{currency.name || currency.code}</option>
                ))}
                {form.AccountCurrency && form.AccountCurrency !== "##" && !currencies.some((c) => c.code === form.AccountCurrency) && (
                  <option value={form.AccountCurrency}>{form.AccountCurrency}</option>
                )}
              </select>
            </div>
          </div>
        </div>

        <div className="im-header-right">
          <div className="im-field-grid">
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-level">Level</label>
              <input
                id="coa-level"
                className="im-field__input im-field__input--readonly"
                value={previewAccountLevel(form, parentAccounts)}
                readOnly
              />
            </div>
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-balance">Balance</label>
              <input
                id="coa-balance"
                className="im-field__input im-field__input--readonly"
                value={formatBalance(form.Balance)}
                readOnly
              />
              <span className="im-field__unit">{form.BalanceCurrency || localCurrency}</span>
            </div>
          </div>
          <div className="im-checkboxes">
            <label className="im-checkbox-label">
              <input type="checkbox" name="Confidential" checked={form.Confidential === "tYES"} onChange={handleChange} />
              Confidential
            </label>
          </div>
        </div>
      </div>

      <div className="im-header-card">
        <div className="im-header-left">
          <div className="im-section-title">G/L Account Properties</div>
          <div className="im-field-grid">
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-type">Account Type</label>
              <select
                id="coa-type"
                className="im-field__input im-field__select"
                name="AccountType"
                value={form.AccountType}
                onChange={handleChange}
              >
                {ACCOUNT_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="im-field">
              <label className="im-field__label" htmlFor="coa-project">Project</label>
              <input id="coa-project" className="im-field__input" name="ProjectCode" value={form.ProjectCode} onChange={handleChange} />
            </div>
          </div>
        </div>
        <div className="im-header-flags">
          {PROPERTY_FLAGS.map(([name, label]) => (
            <label key={name} className="im-checkbox-label">
              <input type="checkbox" name={name} checked={form[name] === "tYES"} onChange={handleChange} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <FindResultsModal
        open={showFindResults}
        title="Account Search Results"
        columns={[
          { key: "Code", label: "Code" },
          { key: "Name", label: "Name" },
          { key: "AccountType", label: "Type" },
          { key: "Level", label: "Level" },
        ]}
        rows={findResults}
        getRowKey={(row) => row.Code}
        onClose={() => setShowFindResults(false)}
        onSelect={handleFindResultSelect}
      />
    </div>
  );
}
