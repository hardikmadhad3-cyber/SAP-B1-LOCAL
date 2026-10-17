import React, { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./styles/chartOfAccounts.css";
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
  AccountCurrencyName: "",
  Confidential: "tNO",
  Level: "",
  Balance: "0.00",
  BalanceCurrency: "INR",
  AccountType: "sat_Other",
  ControlAccount: "tNO",
  CashAccount: "tNO",
  RevaluationCoordinated: "tNO",
  BlockManualPosting: "tNO",
  CashFlowRelevant: "tNO",
  ProjectCode: "",
  ProductDistribution: "",
  DivisionDistribution: "",
  BranchDistribution: "",
  IsTitleAccount: "tNO",
  ActiveAccount: "tYES",
  FatherAccountKey: "",
};

export default function ChartOfAccounts() {
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  // The company's own currencies (OCRN), not a fixed list.
  const [currencies, setCurrencies] = useState([]);
  useEffect(() => {
    fetchCoACurrencies("").then((rows) => setCurrencies(Array.isArray(rows) ? rows : [])).catch(() => setCurrencies([]));
  }, []);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("add");
  const [findResults, setFindResults] = useState([]);
  const [showFindResults, setShowFindResults] = useState(false);
  const [parentAccounts, setParentAccounts] = useState([]);

  useEffect(() => {
    fetchParentAccounts("").then(setParentAccounts).catch(() => setParentAccounts([]));
  }, []);

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (checked ? "tYES" : "tNO") : value,
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

  const handleFind = async () => {
    const code = form.Code.trim();
    const query = code || form.Name.trim();
    if (!query) {
      showAlert("error", "Enter an Account Code or Name to search.");
      return;
    }
    setLoading(true);
    try {
      if (code) {
        try {
          await loadAccount(code);
          return;
        } catch (_) {}
      }

      const results = await searchAccounts(query, "", 100);
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

  const buildPayload = () => {
    const payload = {
      Code: form.Code.trim(),
      Name: form.Name.trim(),
    };

    // Emptied fields are sent as null so the stored value is cleared.
    payload.ExternalCode = form.ExternalCode?.trim() || null;
    payload.AccountCurrency = form.AccountCurrency || null;
    payload.ProjectCode = form.ProjectCode?.trim() || null;
    payload.FatherAccountKey = form.FatherAccountKey || null;

    payload.AccountType = form.AccountType || "sat_Other";
    payload.IsTitleAccount = form.IsTitleAccount || "tNO";
    payload.ActiveAccount = form.ActiveAccount || "tYES";
    payload.Confidential = form.Confidential || "tNO";
    payload.ControlAccount = form.ControlAccount || "tNO";
    payload.CashAccount = form.CashAccount || "tNO";
    payload.RevaluationCoordinated = form.RevaluationCoordinated || "tNO";
    payload.BlockManualPosting = form.BlockManualPosting || "tNO";
    payload.CashFlowRelevant = form.CashFlowRelevant || "tNO";

    return payload;
  };

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
      if (mode === "add") {
        await createAccount(buildPayload());
        showAlert("success", `Account "${form.Code}" created successfully.`);
        setMode("update");
      } else {
        await updateAccount(form.Code.trim(), buildPayload());
        showAlert("success", `Account "${form.Code}" updated successfully.`);
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Failed to save.";
      showAlert("error", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="coa-page">
      {/* Toolbar */}
      <div className="coa-toolbar">
        <span className="coa-toolbar__title">Chart of Accounts - Setup</span>
        <button className="coa-btn coa-btn--primary" onClick={handleSave} disabled={loading}>
          {loading ? "..." : mode === "add" ? "Add" : "Update"}
        </button>
        <button className="coa-btn" onClick={handleCancel}>
          Cancel
        </button>
        <button className="coa-btn" onClick={handleFind} disabled={loading}>
          Find
        </button>
      </div>

      {alert && <div className={`coa-alert coa-alert--${alert.type}`}>{alert.msg}</div>}

      {/* Main Form */}
      <div className="coa-form">
        {/* G/L Account Details Section */}
        <div className="coa-section">
          <div className="coa-section__header">G/L Account Details</div>
          <div className="coa-section__body">
            <div className="coa-row">
              <div className="coa-col-6">
                <div className="coa-radio-group">
                  <label className="coa-radio">
                    <input
                      type="radio"
                      name="AccountKind"
                      checked={form.IsTitleAccount === "tYES"}
                      onChange={() => setForm((prev) => ({ ...prev, IsTitleAccount: "tYES" }))}
                    />
                    <span>Title</span>
                  </label>
                  <label className="coa-radio">
                    <input
                      type="radio"
                      name="AccountKind"
                      checked={form.IsTitleAccount !== "tYES"}
                      onChange={() => setForm((prev) => ({ ...prev, IsTitleAccount: "tNO" }))}
                    />
                    <span>Active Account</span>
                  </label>
                </div>

                <div className="coa-field-group">
                  <label className="coa-label">Parent (Title) Account</label>
                  <select
                    className="coa-select"
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

                <div className="coa-field-group">
                  <label className="coa-label">G/L Account</label>
                  <input
                    type="text"
                    className="coa-input"
                    name="Code"
                    value={form.Code}
                    onChange={handleChange}
                    readOnly={mode === "update"}
                    placeholder="Account code"
                  />
                </div>

                <div className="coa-field-group">
                  <label className="coa-label">Name</label>
                  <input
                    type="text"
                    className="coa-input"
                    name="Name"
                    value={form.Name}
                    onChange={handleChange}
                    placeholder="Account name"
                  />
                </div>

                <div className="coa-field-group">
                  <label className="coa-label">External Code</label>
                  <input
                    type="text"
                    className="coa-input"
                    name="ExternalCode"
                    value={form.ExternalCode}
                    onChange={handleChange}
                  />
                </div>

                <div className="coa-field-group">
                  <label className="coa-label">Currency</label>
                  <select
                    className="coa-select"
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

              <div className="coa-col-6">
                <div className="coa-field-group">
                  <label className="coa-checkbox">
                    <input
                      type="checkbox"
                      name="Confidential"
                      checked={form.Confidential === "tYES"}
                      onChange={handleChange}
                    />
                    <span>Confidential</span>
                  </label>
                </div>

                <div className="coa-field-group">
                  <label className="coa-label">Level</label>
                  <input
                    type="text"
                    className="coa-input coa-input--readonly"
                    value={form.Level || "2"}
                    readOnly
                  />
                </div>

                <div className="coa-field-group">
                  <label className="coa-label">Balance</label>
                  <div className="coa-input-group">
                    <input
                      type="text"
                      className="coa-input coa-input--readonly"
                      value={form.Balance}
                      readOnly
                    />
                    <select className="coa-select coa-select--small" value={form.BalanceCurrency} readOnly>
                      <option value="INR">INR</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* G/L Account Properties Section */}
        <div className="coa-section">
          <div className="coa-section__header">G/L Account Properties</div>
          <div className="coa-section__body">
            <div className="coa-row">
              <div className="coa-col-6">
                <div className="coa-field-group">
                  <label className="coa-label">Account Type</label>
                  <select
                    className="coa-select"
                    name="AccountType"
                    value={form.AccountType}
                    onChange={handleChange}
                  >
                    <option value="sat_Other">Other</option>
                    <option value="sat_Assets">Assets</option>
                    <option value="sat_Liabilities">Liabilities</option>
                    <option value="sat_Equity">Equity</option>
                    <option value="sat_Revenues">Revenues</option>
                    <option value="sat_Expenditure">Expenditure</option>
                  </select>
                </div>

                <div className="coa-field-group">
                  <label className="coa-checkbox">
                    <input
                      type="checkbox"
                      name="ControlAccount"
                      checked={form.ControlAccount === "tYES"}
                      onChange={handleChange}
                    />
                    <span>Control Account</span>
                  </label>
                </div>

                <div className="coa-field-group">
                  <label className="coa-checkbox">
                    <input
                      type="checkbox"
                      name="CashAccount"
                      checked={form.CashAccount === "tYES"}
                      onChange={handleChange}
                    />
                    <span>Cash Account</span>
                  </label>
                </div>
              </div>

              <div className="coa-col-6">
                <div className="coa-field-group">
                  <label className="coa-checkbox">
                    <input
                      type="checkbox"
                      name="RevaluationCoordinated"
                      checked={form.RevaluationCoordinated === "tYES"}
                      onChange={handleChange}
                    />
                    <span>Reval. (Currency)</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="coa-row">
              <div className="coa-col-6">
                <div className="coa-field-group">
                  <label className="coa-checkbox">
                    <input
                      type="checkbox"
                      name="BlockManualPosting"
                      checked={form.BlockManualPosting === "tYES"}
                      onChange={handleChange}
                    />
                    <span>Block Manual Posting</span>
                  </label>
                </div>

                <div className="coa-field-group">
                  <label className="coa-checkbox">
                    <input
                      type="checkbox"
                      name="CashFlowRelevant"
                      checked={form.CashFlowRelevant === "tYES"}
                      onChange={handleChange}
                    />
                    <span>Cash Flow Relevant</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Relevant for Cost Accounting Section */}
        <div className="coa-section">
          <div className="coa-section__header">Relevant for Cost Accounting</div>
          <div className="coa-section__body">
            <div className="coa-field-group">
              <label className="coa-checkbox">
                <input type="checkbox" name="Project" />
                <span>Project</span>
              </label>
              <input
                type="text"
                className="coa-input"
                name="ProjectCode"
                value={form.ProjectCode}
                onChange={handleChange}
                placeholder="Project code"
              />
            </div>
          </div>
        </div>

        {/* Distribution Rule Section */}
        <div className="coa-section">
          <div className="coa-section__header">Distribution Rule</div>
          <div className="coa-section__body">
            <div className="coa-field-group">
              <label className="coa-checkbox">
                <input type="checkbox" name="ProductEnabled" />
                <span>PRODUCT</span>
              </label>
              <input
                type="text"
                className="coa-input"
                name="ProductDistribution"
                value={form.ProductDistribution}
                onChange={handleChange}
              />
            </div>

            <div className="coa-field-group">
              <label className="coa-checkbox">
                <input type="checkbox" name="DivisionEnabled" />
                <span>DIVISION</span>
              </label>
              <input
                type="text"
                className="coa-input"
                name="DivisionDistribution"
                value={form.DivisionDistribution}
                onChange={handleChange}
              />
            </div>

            <div className="coa-field-group">
              <label className="coa-checkbox">
                <input type="checkbox" name="BranchEnabled" />
                <span>BRANCH</span>
              </label>
              <input
                type="text"
                className="coa-input"
                name="BranchDistribution"
                value={form.BranchDistribution}
                onChange={handleChange}
              />
            </div>
          </div>
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
