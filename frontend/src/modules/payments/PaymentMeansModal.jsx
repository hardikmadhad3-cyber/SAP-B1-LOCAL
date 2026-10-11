import SapDateInput from '../../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const today = new Date().toISOString().slice(0, 10);

const parseAmount = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/^INR\s*/i, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export const createDefaultPaymentMeans = ({ currency = "INR", cashAccount = "", amount = 0 } = {}) => ({
  currency,
  cheque: {
    account: "",
    dueDate: today,
    amount: "",
    country: "",
    bankName: "",
    bankCode: "",
    checkNumber: "",
  },
  transfer: {
    account: "",
    date: today,
    reference: "",
    amount: "",
  },
  creditCard: {
    cardName: "",
    account: "",
    cardNumber: "",
    validUntil: "",
    idNumber: "",
    telephone: "",
    paymentMethod: "",
    noOfPayments: "1",
    voucherNo: "",
    transactionType: "Regular",
    amount: "",
  },
  cash: {
    account: cashAccount || "",
    amount: amount ? money(amount) : "",
  },
  bankCharge: "",
});

export const paymentMeansTotal = (paymentMeans = {}) =>
  parseAmount(paymentMeans.cheque?.amount) +
  parseAmount(paymentMeans.transfer?.amount) +
  parseAmount(paymentMeans.creditCard?.amount) +
  parseAmount(paymentMeans.cash?.amount);

const PAYMENT_SECTIONS = [
  ["cheque", "Cheque"],
  ["transfer", "Bank Transfer"],
  ["creditCard", "Credit Card"],
  ["cash", "Cash"],
];

const clonePaymentMeans = (value) => JSON.parse(JSON.stringify(value || createDefaultPaymentMeans()));

export const validatePaymentMeans = (paymentMeans = {}, totalAmountDue = 0, options = {}) => {
  const due = parseAmount(totalAmountDue);
  const paid = paymentMeansTotal(paymentMeans);
  const effectiveDue = due > 0 ? due : options.allowPaidAsTotalDue && paid > 0 ? paid : due;

  if (effectiveDue <= 0) return "Total Amount Due must be greater than zero.";
  if (paid <= 0) return "Enter at least one Payment Means amount.";
  if (Math.abs(paid - effectiveDue) > 0.01) return "Payment Means paid amount must match Total Amount Due.";

  const missingAccount = PAYMENT_SECTIONS.find(([section]) =>
    parseAmount(paymentMeans[section]?.amount) > 0 && !String(paymentMeans[section]?.account || "").trim(),
  );
  return missingAccount ? `${missingAccount[1]} G/L Account is required.` : "";
};

export default function PaymentMeansModal({
  open,
  value,
  totalAmountDue,
  allowPaidAsTotalDue = false,
  onChange,
  onClose,
  onConfirm,
  lookupAccounts,
  AccountLookupField,
}) {
  const [activeTab, setActiveTab] = useState("cheque");
  const [draft, setDraft] = useState(() => clonePaymentMeans(value));
  const [validationError, setValidationError] = useState("");
  const means = draft;
  const paid = useMemo(() => paymentMeansTotal(means), [means]);
  const balanceDue = parseAmount(totalAmountDue) - paid;

  useEffect(() => {
    if (!open) return;
    const nextDraft = clonePaymentMeans(value);
    const populatedTab = PAYMENT_SECTIONS.find(([section]) => parseAmount(nextDraft[section]?.amount) > 0)?.[0];
    setDraft(nextDraft);
    setActiveTab(populatedTab || "cheque");
    setValidationError("");
  }, [open, value]);

  if (!open) return null;

  const updateSection = (section, field, fieldValue) => {
    setValidationError("");
    setDraft({
      ...means,
      [section]: {
        ...(means[section] || {}),
        [field]: fieldValue,
      },
    });
  };

  const updateDraft = (nextDraft) => {
    setValidationError("");
    setDraft(nextDraft);
  };

  const confirmPaymentMeans = () => {
    const error = validatePaymentMeans(means, totalAmountDue, { allowPaidAsTotalDue });
    if (error) {
      setValidationError(error);
      return;
    }
    onChange(means);
    if (onConfirm) onConfirm(means);
    else onClose();
  };

  const renderAccountField = (section, field = "account", title = "G/L Accounts") => {
    const sectionValue = means[section] || {};
    if (!AccountLookupField || !lookupAccounts) {
      return (
        <input
          value={sectionValue[field] || ""}
          onChange={(event) => updateSection(section, field, event.target.value)}
        />
      );
    }

    return (
      <AccountLookupField
        value={sectionValue[field] || ""}
        onChange={(nextValue) => updateSection(section, field, nextValue)}
        onSelect={(row) => updateSection(section, field, row.code)}
        fetchOptions={lookupAccounts}
        title={title}
        columns={[{ label: "Code", key: "code" }, { label: "Name", key: "name" }]}
      />
    );
  };

  const tabs = [
    { key: "cheque", label: "Cheque" },
    { key: "transfer", label: "Bank Transfer" },
    { key: "creditCard", label: "Credit Card" },
    { key: "cash", label: "Cash" },
  ];

  return createPortal(
    <div
      className="ip-payment-means-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="ip-payment-means"
        role="dialog"
        aria-modal="true"
        aria-label="Payment Means"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ip-payment-means__header">
          <span>Payment Means</span>
          <button type="button" className="sap-lookup-modal__close" aria-label="Close" onClick={onClose}>x</button>
        </div>
        <div className="ip-payment-means__body">
          <label className="ip-payment-means__currency">
            <span>Currency</span>
            <input
              value={means.currency || "INR"}
              onChange={(event) => updateDraft({ ...means, currency: event.target.value })}
            />
          </label>

          <div className="ip-payment-means__tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={activeTab === tab.key ? "is-active" : ""}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="ip-payment-means__panel">
            {activeTab === "cheque" ? (
              <>
                <label><span>G/L Account</span>{renderAccountField("cheque")}</label>
                <label><span>Due Date</span><SapDateInput  value={means.cheque?.dueDate || today} onChange={(event) => updateSection("cheque", "dueDate", event.target.value)} /></label>
                <label><span>Amount</span><input value={means.cheque?.amount || ""} onChange={(event) => updateSection("cheque", "amount", event.target.value)} /></label>
                <label><span>Country/Region</span><input value={means.cheque?.country || ""} onChange={(event) => updateSection("cheque", "country", event.target.value)} /></label>
                <label><span>Bank Name</span><input value={means.cheque?.bankName || ""} onChange={(event) => updateSection("cheque", "bankName", event.target.value)} /></label>
                <label><span>Bank Code</span><input value={means.cheque?.bankCode || ""} onChange={(event) => updateSection("cheque", "bankCode", event.target.value)} /></label>
                <label><span>Check No.</span><input value={means.cheque?.checkNumber || ""} onChange={(event) => updateSection("cheque", "checkNumber", event.target.value)} /></label>
              </>
            ) : null}

            {activeTab === "transfer" ? (
              <>
                <label><span>G/L Account</span>{renderAccountField("transfer")}</label>
                <label><span>Transfer Date</span><SapDateInput  value={means.transfer?.date || today} onChange={(event) => updateSection("transfer", "date", event.target.value)} /></label>
                <label><span>Reference</span><input value={means.transfer?.reference || ""} onChange={(event) => updateSection("transfer", "reference", event.target.value)} /></label>
                <label><span>Total</span><input value={means.transfer?.amount || ""} onChange={(event) => updateSection("transfer", "amount", event.target.value)} /></label>
              </>
            ) : null}

            {activeTab === "creditCard" ? (
              <>
                <label><span>Credit Card Name</span><input value={means.creditCard?.cardName || ""} onChange={(event) => updateSection("creditCard", "cardName", event.target.value)} /></label>
                <label><span>G/L Account</span>{renderAccountField("creditCard")}</label>
                <label><span>Credit Card No.</span><input value={means.creditCard?.cardNumber || ""} onChange={(event) => updateSection("creditCard", "cardNumber", event.target.value)} /></label>
                <label><span>Valid Until</span><SapDateInput  value={means.creditCard?.validUntil || ""} onChange={(event) => updateSection("creditCard", "validUntil", event.target.value)} /></label>
                <label><span>ID No.</span><input value={means.creditCard?.idNumber || ""} onChange={(event) => updateSection("creditCard", "idNumber", event.target.value)} /></label>
                <label><span>Telephone No.</span><input value={means.creditCard?.telephone || ""} onChange={(event) => updateSection("creditCard", "telephone", event.target.value)} /></label>
                <label><span>Payment Method</span><input value={means.creditCard?.paymentMethod || ""} onChange={(event) => updateSection("creditCard", "paymentMethod", event.target.value)} /></label>
                <label><span>Amount Due</span><input value={means.creditCard?.amount || ""} onChange={(event) => updateSection("creditCard", "amount", event.target.value)} /></label>
                <label><span>No. of Payments</span><input value={means.creditCard?.noOfPayments || "1"} onChange={(event) => updateSection("creditCard", "noOfPayments", event.target.value)} /></label>
                <label><span>Voucher No.</span><input value={means.creditCard?.voucherNo || ""} onChange={(event) => updateSection("creditCard", "voucherNo", event.target.value)} /></label>
                <label><span>Transaction Type</span><input value={means.creditCard?.transactionType || "Regular"} onChange={(event) => updateSection("creditCard", "transactionType", event.target.value)} /></label>
              </>
            ) : null}

            {activeTab === "cash" ? (
              <>
                <label><span>G/L Account</span>{renderAccountField("cash")}</label>
                <label><span>Total</span><input value={means.cash?.amount || ""} onChange={(event) => updateSection("cash", "amount", event.target.value)} /></label>
              </>
            ) : null}
          </div>

          <div className="ip-payment-means__footer-fields">
            <label><span>Overall Amount</span><input value={money(parseAmount(totalAmountDue))} readOnly /></label>
            <label><span>Balance Due</span><input value={money(balanceDue)} readOnly /></label>
            <label><span>Bank Charge</span><input value={means.bankCharge || ""} onChange={(event) => updateDraft({ ...means, bankCharge: event.target.value })} /></label>
            <label className="ip-payment-means__paid"><span>Paid</span><input value={money(paid)} readOnly /></label>
          </div>
          {validationError ? <div className="ip-payment-means__error" role="alert">{validationError}</div> : null}
        </div>
        <div className="ip-payment-means__actions">
          <button type="button" className="po-btn po-btn--primary" onClick={confirmPaymentMeans}>OK</button>
          <button type="button" className="po-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.querySelector(".app-shell__content") || document.body,
  );
}
