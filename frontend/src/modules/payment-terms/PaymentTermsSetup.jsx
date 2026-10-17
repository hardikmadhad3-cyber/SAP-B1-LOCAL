import React, { useState, useCallback, useEffect } from "react";
import "./styles/paymentTermsSetup.css";
import DueDateSection from "./components/DueDateSection";
import InstallmentsSection from "./components/InstallmentsSection";
import LookupModal from "./components/LookupModal";
import {
  createPaymentTerms,
  getPaymentTerms,
  updatePaymentTerms,
  searchPaymentTerms,
  fetchCashDiscounts,
  fetchPaymentMethods,
} from "../../api/paymentTermsApi";

const EMPTY_FORM = {
  GroupNumber: "",
  PaymentTermsGroupCode: "",
  PaymentTermsGroupName: "",
  BaselineDate: "bld_PostingDate",
  StartFrom: "ptsf_DayOfMonth",
  NumberOfAdditionalMonths: 0,
  NumberOfAdditionalDays: 0,
  ToleranceDays: 0,
  NumberOfInstallments: 1,
  OpenIncomingPaymentsByDueDate: "tNO",
  CreditLimit: 0,
  LoadLimitCredit: "tNO",
  PaymentTermsInstallments: [],
  DiscountCode: "",
  PaymentMethod: "",
};

function buildPayload(form) {
  const payload = {
    PaymentTermsGroupName: form.PaymentTermsGroupName.trim(),
  };

  if (form.PaymentTermsGroupCode) {
    payload.PaymentTermsGroupCode = form.PaymentTermsGroupCode.trim();
  }

  payload.BaselineDate = form.BaselineDate || "bld_PostingDate";
  payload.StartFrom = form.StartFrom || "ptsf_DayOfMonth";
  payload.DiscountCode = form.DiscountCode || null;
  payload.PaymentMethod = form.PaymentMethod || null;

  if (form.NumberOfAdditionalMonths != null) payload.NumberOfAdditionalMonths = Number(form.NumberOfAdditionalMonths);
  if (form.NumberOfAdditionalDays != null) payload.NumberOfAdditionalDays = Number(form.NumberOfAdditionalDays);
  if (form.ToleranceDays != null) payload.ToleranceDays = Number(form.ToleranceDays || 0);
  if (form.NumberOfInstallments != null) payload.NumberOfInstallments = Number(form.NumberOfInstallments);
  if (form.CreditLimit != null) payload.CreditLimit = Number(form.CreditLimit);
  
  payload.LoadLimitCredit = form.LoadLimitCredit || "tNO";
  payload.OpenIncomingPaymentsByDueDate = form.OpenIncomingPaymentsByDueDate || "tNO";

  const lines = (form.PaymentTermsInstallments || [])
    .filter((l) => l.Percent !== "" && l.Percent != null)
    .map((l, idx) => ({
      InstallmentNumber: idx + 1,
      Percent: Number(l.Percent),
      NumberOfAdditionalMonths: Number(l.NumberOfAdditionalMonths || 0),
      NumberOfAdditionalDays: Number(l.NumberOfAdditionalDays || 0),
      BaselineDate: l.BaselineDate || form.BaselineDate,
      StartFrom: l.StartFrom || form.StartFrom,
    }));

  // Always sent, so removing every row removes the saved installments too.
  payload.PaymentTermsInstallments = lines;

  return payload;
}

export default function PaymentTermsSetup() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [mode, setMode] = useState("add");
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showFindModal, setShowFindModal] = useState(false);
  const [cashDiscounts, setCashDiscounts] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  useEffect(() => {
    let active = true;
    Promise.all([fetchCashDiscounts(), fetchPaymentMethods()]).then(([discounts, methods]) => {
      if (active) { setCashDiscounts(discounts); setPaymentMethods(methods); }
    }).catch(() => { if (active) setAlert({ type: "error", msg: "Unable to load cash discounts and payment methods." }); });
    return () => { active = false; };
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

  const handleFieldChange = useCallback((name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setMode("add");
    setAlert(null);
  };

  const handleAdd = async () => {
    if (!form.PaymentTermsGroupCode.trim()) {
      showAlert("error", "Payment Terms Code is required.");
      return;
    }
    if (form.PaymentTermsGroupCode.length > 15) {
      showAlert("error", "Payment Terms Code cannot exceed 15 characters.");
      return;
    }
    if (!form.PaymentTermsGroupName.trim()) {
      showAlert("error", "Payment Terms Name is required.");
      return;
    }
    if (form.PaymentTermsGroupName.length > 50) {
      showAlert("error", "Payment Terms Name cannot exceed 50 characters.");
      return;
    }

    setLoading(true);
    try {
      const result = await createPaymentTerms(buildPayload(form));
      setForm((prev) => ({ ...prev, GroupNumber: result.GroupNumber }));
      showAlert("success", `Payment Terms "${form.PaymentTermsGroupCode}" created successfully.`);
      setMode("update");
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Failed to create Payment Terms.";
      showAlert("error", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!form.GroupNumber) return;

    setLoading(true);
    try {
      await updatePaymentTerms(form.GroupNumber, buildPayload(form));
      showAlert("success", `Payment Terms "${form.PaymentTermsGroupCode}" updated successfully.`);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Failed to update Payment Terms.";
      showAlert("error", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (mode === "add") return handleAdd();
    if (mode === "update") return handleUpdate();
  };

  const handleFind = async (groupNumber) => {
    setLoading(true);
    try {
      const data = await getPaymentTerms(groupNumber);
      setForm({
        ...EMPTY_FORM,
        ...data,
        PaymentTermsInstallments: data.PaymentTermsInstallments || [],
      });
      setMode("update");
      setShowFindModal(false);
      showAlert("success", `Payment Terms "${data.PaymentTermsGroupCode}" loaded.`);
    } catch (err) {
      showAlert("error", "Payment Terms not found.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pt-page">
      {/* Toolbar */}
      <div className="pt-toolbar">
        <span className="pt-toolbar__title">Payment Terms - Setup</span>
        <button className="pt-btn pt-btn--primary" onClick={handleSave} disabled={loading}>
          {loading ? "..." : mode === "add" ? "Add" : "Update"}
        </button>
        <button className="pt-btn" onClick={resetForm}>
          Cancel
        </button>
        <button className="pt-btn" onClick={() => setShowFindModal(true)}>
          Find
        </button>
      </div>

      {alert && <div className={`pt-alert pt-alert--${alert.type}`}>{alert.msg}</div>}

      {/* Header Section */}
      <div className="pt-header">
        <div className="pt-header-row">
          <div className="pt-field">
            <label className="pt-field__label">Payment Terms Code*</label>
            <input
              className="pt-field__input"
              name="PaymentTermsGroupCode"
              value={form.PaymentTermsGroupCode}
              onChange={handleChange}
              readOnly={mode === "update"}
              maxLength={15}
              autoFocus
            />
          </div>

          <div className="pt-field pt-field--wide">
            <label className="pt-field__label">Payment Terms Name*</label>
            <input
              className="pt-field__input"
              name="PaymentTermsGroupName"
              value={form.PaymentTermsGroupName}
              onChange={handleChange}
              maxLength={50}
            />
          </div>
        </div>
      </div>

      {/* Due Date Configuration */}
      <DueDateSection form={form} onChange={handleChange} onFieldChange={handleFieldChange} />

      {/* Rates */}
      <div className="pt-section">
        <div className="pt-section__title">Credit Settings</div>
        <div className="pt-section__content">
          <div className="pt-field-row">
            <div className="pt-field">
              <label className="pt-field__label">Max. Credit Limit</label>
              <input
                type="number"
                className="pt-field__input"
                name="CreditLimit"
                value={form.CreditLimit || 0}
                onChange={handleChange}
                min="0"
                step="0.01"
              />
            </div>

            <div className="pt-field pt-field--checkbox">
              <input
                type="checkbox"
                id="loadLimitCredit"
                name="LoadLimitCredit"
                checked={form.LoadLimitCredit === "tYES"}
                onChange={handleChange}
              />
              <label htmlFor="loadLimitCredit">Load Limit Credit</label>
            </div>

            <div className="pt-field pt-field--checkbox">
              <input
                type="checkbox"
                id="openIncomingPayment"
                name="OpenIncomingPaymentsByDueDate"
                checked={form.OpenIncomingPaymentsByDueDate === "tYES"}
                onChange={handleChange}
              />
              <label htmlFor="openIncomingPayment">Open Incoming Payment by Due Date</label>
            </div>
          </div>
        </div>
      </div>

      {/* Installments */}
      <div className="pt-section">
        <div className="pt-section__title">Payment Defaults</div>
        <div className="pt-section__content pt-field-row">
          {[["DiscountCode", "Cash Discount", cashDiscounts], ["PaymentMethod", "Payment Method", paymentMethods]].map(([name, label, options]) => (
            <label className="pt-field" key={name}>{label}
              <select className="pt-field__input" name={name} value={form[name] || ""} onChange={handleChange}>
                <option value="">None</option>
                {options.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>
      <InstallmentsSection form={form} setForm={setForm} />

      {/* Find Modal */}
      {showFindModal && (
        <LookupModal
          title="Find Payment Terms"
          onClose={() => setShowFindModal(false)}
          onSelect={(row) => handleFind(row.GroupNumber)}
          fetchOptions={searchPaymentTerms}
          columns={[
            { key: "PaymentTermsGroupCode", label: "Code" },
            { key: "PaymentTermsGroupName", label: "Name" },
            { key: "NumberOfAdditionalDays", label: "Days" },
          ]}
        />
      )}
    </div>
  );
}
