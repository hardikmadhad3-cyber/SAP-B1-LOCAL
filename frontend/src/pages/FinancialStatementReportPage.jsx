import SapDateInput from '../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchFinancialStatement, fetchFinancialStatementLookups } from "../api/financialStatementsApi";
import {
  BalanceSheetExpandedModal,
  BalanceSheetFilterGridModal,
  BalanceSheetRevaluationModal,
} from "../components/reports/BalanceSheetCriteriaModals";
import PropertiesSelectionModal from "../components/reports/PropertiesSelectionModal";
import { TrialBalanceCriteria, TrialBalanceExpandedModal } from "../components/reports/TrialBalanceCriteria";
import useFloatingWindow from "../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../components/SapWindowTaskbarContext";
import "../styles/sales-analysis-report.css";
import "../styles/financial-accounting-report.css";

const REPORTS = {
  "balance-sheet": {
    title: "Balance Sheet",
    groups: "Assets, liabilities, and equity",
    columns: [
      ["beginningOfYear", "Beginning of Year"],
      ["currentBalance", "Current Period"],
    ],
  },
  "trial-balance": {
    title: "Trial Balance",
    groups: "Business partners and G/L accounts",
    columns: [
      ["opening", "O.B."],
      ["debit", "Debit"],
      ["credit", "Credit"],
      ["balance", "Balance"],
    ],
  },
  "profit-and-loss-statement": {
    title: "Profit and Loss Statement",
    groups: "Revenue and expenditure",
    columns: [
      ["currentPeriod", "Current Period"],
      ["currentYear", "Current Year"],
    ],
  },
  "cash-flow": {
    title: "Cash Flow",
    groups: "The values displayed are the remaining Balance Due for each transaction",
    columns: [
      ["debit", "Debit"],
      ["credit", "Credit"],
      ["total", "Total"],
      ["balance", "Balance"],
    ],
  },
  "cash-flow-reference-report": {
    title: "Cash Flow Reference Report",
    groups: "Transactions relevant to cash flow",
    columns: [
      ["date", "Date"],
      ["type", "Type"],
      ["transactionNumber", "Trans. #"],
      ["creator", "Creator"],
      ["entityCode", "G/L Acc./BP Code"],
      ["entityName", "G/L Acc./BP Name"],
      ["debit", "Debit"],
      ["credit", "Credit"],
      ["primaryFormItem", "Primary Form Item"],
    ],
  },
};

const CASH_FLOW_TABS = [
  { key: "cash", label: "Cash" },
  { key: "creditCard", label: "Credit Card" },
  { key: "checks", label: "Checks" },
  { key: "businessPartner", label: "Business Partner" },
];

const CASH_FLOW_INTERVALS = [
  { code: "daily", name: "Daily" },
  { code: "weekly", name: "Weekly" },
  { code: "monthly", name: "Monthly" },
  { code: "quarterly", name: "Quarterly" },
  { code: "semiAnnual", name: "Semi-annually" },
  { code: "annual", name: "Annually" },
];

const CASH_FLOW_DEFAULT_DOCUMENT_TYPES = {
  purchaseOrders: false,
  goodsReceiptPo: false,
  goodsReturnRequest: false,
  goodsReturn: false,
  apDownPayment: true,
  apInvoices: true,
  apCreditMemos: true,
  salesOrders: false,
  deliveries: false,
  returnRequest: false,
  returns: false,
  arDownPayment: true,
  arInvoices: true,
  arCreditMemos: true,
};

const inputDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const initialCriteria = () => {
  const today = new Date();
  const fiscalStart = new Date(today.getFullYear() - (today.getMonth() < 3 ? 1 : 0), 3, 1);
  return {
    dateFrom: inputDate(fiscalStart),
    dateTo: inputDate(today),
    fiscalYearFrom: inputDate(fiscalStart),
    displayCurrency: "local",
    dateType: "postingDate",
    templateCode: "",
    includeZeroBalance: false,
    hideZeroBalance: true,
    hideNoPostings: true,
    includeBusinessPartners: true,
    includeGlAccounts: true,
    bpFrom: "",
    bpTo: "",
    customerGroup: "All",
    vendorGroup: "All",
    selectedAccountGroups: [1, 2, 3, 4, 5],
    propertyFilter: { ignoreProperties: true, linkMode: "and", exactlyMatch: false, selectedPropertyNumbers: [] },
    openingBalanceForPeriod: true,
    showControlAccountInfo: false,
    periodType: "annual",
    balanceMode: "account",
    foreignName: false,
    externalCode: false,
    addJournalVouchers: false,
    addClosingBalances: false,
    ignoreAdjustments: false,
    expanded: true,
    displaySubtotals: true,
    hideTitles: false,
    displayLevel: 10,
    revaluationEnabled: false,
    revaluation: {
      currencyCode: "", fcMethod: "fixedRate", fixedRate: "", averageRateDays: 3,
      referJournalRates: true, allCurrenciesDisplay: "system", indexCode: "",
      indexToCode: "", indexToMonth: String(new Date().getMonth() + 1),
      indexToYear: String(new Date().getFullYear()), indexValue: "", indexMethod: "postingDate",
    },
    printMode: "monthly",
    expandedCriteria: {
      referenceFields: false, userDefinedFields: false, blanketAgreement: false,
      blanketAgreementFrom: "", blanketAgreementTo: "",
      originalJournals: [],
    },
    referenceFilters: [],
    udfFilters: [],
    timeInterval: "weekly",
    addRecurringPostings: true,
    considerDelaysInPayments: false,
    displayFullyReconciledPostings: false,
    addBlanketAgreements: false,
    addMarketingDocuments: true,
    addDocumentDrafts: false,
    addRecurringTransactions: false,
    openingBalanceMode: "opening",
    cashFlowReferenceMode: "unassigned",
    cashFlowTab: "cash",
    cashFlowChecks: {
      cashAccounts: true,
      credit: true,
      checks: true,
      customerLiabilities: true,
      debtsToVendors: true,
      customerForecast: false,
      vendorForecast: false,
    },
    selectedCashAccounts: [],
    cashFlowDocumentTypes: CASH_FLOW_DEFAULT_DOCUMENT_TYPES,
    projectFrom: "",
    projectTo: "",
    blanketAgreementFrom: "",
    blanketAgreementTo: "",
    projectedPostings: [
      { date: "2018-08-31", description: "sales", project: "", incomingTotal: 500000, outgoingTotal: 0, securityLevel: "Customer Liabilities", recurrencePeriod: "One Time", recurrence: -1, validUntil: "" },
      { date: "2018-08-31", description: "purchase", project: "", incomingTotal: 0, outgoingTotal: 100000, securityLevel: "Payable to Vendor", recurrencePeriod: "One Time", recurrence: -1, validUntil: "" },
      { date: "2018-08-31", description: "gst liability", project: "", incomingTotal: 0, outgoingTotal: 20000, securityLevel: "Payable to Vendor", recurrencePeriod: "One Time", recurrence: -1, validUntil: "" },
      { date: "", description: "", project: "", incomingTotal: 0, outgoingTotal: 0, securityLevel: "Cash Account", recurrencePeriod: "One Time", recurrence: -1, validUntil: "" },
    ],
  };
};

const EMPTY_LOOKUPS = {
  dateTypes: [
    { code: "postingDate", name: "Posting Date" },
    { code: "dueDate", name: "Due Date" },
    { code: "documentDate", name: "Document Date" },
  ],
  templates: [{ code: "standard", name: "Standard" }],
  financialStatementTemplates: [],
  reportTemplates: {},
  companyCurrency: { localCurrency: "", systemCurrency: "" },
  currencies: [],
  indexes: [],
  referenceFields: [],
  userDefinedFields: [],
  ruleOptions: [],
  customerGroups: [],
  vendorGroups: [],
  bpProperties: [],
  trialBalanceTemplates: [
    { code: "trialBalance", name: "Trial Balance" },
    { code: "chartOfAccounts", name: "Chart of Accounts" },
  ],
  cashFlow: {
    cashAccounts: [],
    securityLevels: [],
    documentTypes: Object.entries(CASH_FLOW_DEFAULT_DOCUMENT_TYPES).map(([key, defaultSelected]) => ({
      key,
      label: key,
      defaultSelected,
    })),
  },
};

const templateText = (template) =>
  `${template?.code || ""} ${template?.name || ""} ${template?.reportHint || ""}`.trim().toLowerCase();

const getTemplatesForReport = (lookups, reportKey) => {
  if (reportKey === "trial-balance") return lookups.trialBalanceTemplates || [];
  const keyedTemplates = lookups.reportTemplates?.[reportKey];
  if (Array.isArray(keyedTemplates) && keyedTemplates.length) return keyedTemplates;

  const templates = lookups.financialStatementTemplates?.length
    ? lookups.financialStatementTemplates
    : lookups.templates || [];
  if (reportKey === "balance-sheet") {
    const matches = templates.filter((template) => {
      const text = templateText(template);
      return text === "standard" || text.includes("balance sheet") || text.includes("balancesheet");
    });
    return matches.length ? matches : templates;
  }
  if (reportKey === "profit-and-loss-statement") {
    const matches = templates.filter((template) => {
      const text = templateText(template);
      return text === "standard" || text.includes("profit") || text.includes("loss") || text.includes("p & l") || text.includes("p&l") || text.includes("income statement");
    });
    return matches.length ? matches : templates;
  }
  return templates;
};

const formatAmount = (value) => {
  if (Math.abs(Number(value || 0)) < 0.005) return "";
  return Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatCashAmount = (value, currencyCode = "") => {
  if (value === "" || value === null || value === undefined || Math.abs(Number(value || 0)) < 0.005) return "";
  const amount = Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currencyCode ? `${currencyCode} ${amount}` : amount;
};

const formatDate = (value) => {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};

const LEVEL_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);

function CashFlowDocumentTypesModal({ documentTypes, value, onChange, onClose }) {
  const rows = documentTypes?.length ? documentTypes : EMPTY_LOOKUPS.cashFlow.documentTypes;
  const toggleType = (key) => onChange({ ...value, [key]: !value?.[key] });

  return (
    <div className="fac-modal-backdrop fac-modal-backdrop--cash-flow">
      <div className="fac-modal cf-document-modal">
        <header className="sales-analysis-window__titlebar sap-report-titlebar fac-modal-titlebar">
          <span className="sap-report-title">Document Types</span>
          <div className="sales-analysis-window__controls">
            <button type="button" aria-label="Minimize">-</button>
            <button type="button" aria-label="Restore">[]</button>
            <button type="button" aria-label="Close" onClick={onClose}>x</button>
          </div>
        </header>
        <div className="sales-analysis-window__accent" />
        <div className="cf-document-modal__body">
          <div className="cf-small-grid cf-document-grid">
            <div className="cf-small-grid__head"><span /><span>Document Type</span><span className="cf-grid-open-icon">^</span></div>
            {rows.map((row) => (
              <label key={row.key} className="cf-small-grid__row cf-document-grid__row">
                <span><input type="checkbox" checked={Boolean(value?.[row.key])} onChange={() => toggleType(row.key)} /></span>
                <span>{row.label}</span>
                <span />
              </label>
            ))}
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`blank-${index}`} className="cf-small-grid__row cf-document-grid__row is-blank"><span /><span /><span /></div>
            ))}
          </div>
        </div>
        <footer className="fac-modal-footer cf-document-modal__footer">
          <button type="button" className="sap-report-btn sap-report-btn--primary" onClick={onClose}>OK</button>
          <button type="button" className="sap-report-btn" onClick={onClose}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}

function CashFlowAccountGrid({ accounts, selectedCodes, onChange, emptyRows = 8 }) {
  const selectedSet = new Set(selectedCodes || []);
  const toggle = (code) => {
    if (!(selectedCodes || []).length) {
      onChange((accounts || []).map((account) => account.code).filter((accountCode) => accountCode !== code));
      return;
    }
    const next = selectedSet.has(code)
      ? (selectedCodes || []).filter((item) => item !== code)
      : [...(selectedCodes || []), code];
    onChange(next);
  };
  const displayRows = accounts?.length ? accounts.slice(0, 60) : [];
  const allSelectedByDefault = !(selectedCodes || []).length;

  return (
    <div className="cf-small-grid cf-account-grid">
      <div className="cf-small-grid__head"><span>#</span><span>X</span><span>Account</span><span className="cf-grid-open-icon">^</span></div>
      {displayRows.map((account, index) => (
        <div key={account.code} className="cf-small-grid__row">
          <span>{index + 1}</span>
          <span><input type="checkbox" checked={allSelectedByDefault || selectedSet.has(account.code)} onChange={() => toggle(account.code)} /></span>
          <span className="cf-account-cell"><span className="cf-arrow">-></span>{account.formatCode || account.code} - {account.name}</span>
          <span />
        </div>
      ))}
      {Array.from({ length: Math.max(emptyRows - displayRows.length, 0) }).map((_, index) => (
        <div key={`blank-${index}`} className="cf-small-grid__row is-blank"><span>{displayRows.length + index + 1}</span><span /><span /><span /></div>
      ))}
    </div>
  );
}

function CashFlowRangeBox({ criteria, setField }) {
  return (
    <div className="cf-range-box">
      <div className="cf-range-row">
        <span>Project</span>
        <span>From</span>
        <input className="is-yellow" value={criteria.projectFrom} onChange={(event) => setField("projectFrom", event.target.value)} />
        <span>To</span>
        <input value={criteria.projectTo} onChange={(event) => setField("projectTo", event.target.value)} />
      </div>
      <div className="cf-range-row">
        <span>Blanket Agreement</span>
        <span>From</span>
        <input value={criteria.blanketAgreementFrom} onChange={(event) => setField("blanketAgreementFrom", event.target.value)} />
        <span>To</span>
        <input value={criteria.blanketAgreementTo} onChange={(event) => setField("blanketAgreementTo", event.target.value)} />
      </div>
    </div>
  );
}

function CashFlowProjectedGrid({ rows }) {
  const displayRows = [...(rows || [])];
  while (displayRows.length < 11) displayRows.push({});

  return (
    <div className="cf-projected">
      <div className="cf-section-label">Include Projected Postings</div>
      <div className="cf-projected-grid-wrap">
        <table className="cf-projected-grid">
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Description</th>
              <th>Project</th>
              <th>Incoming Total</th>
              <th>Outgoing Amo...</th>
              <th>Security Level</th>
              <th>Recurrence Pe...</th>
              <th>Recurrence ...</th>
              <th>Valid Until</th>
                <th>^</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, index) => (
              <tr key={`${index}-${row.description || "blank"}`}>
                <td>{index + 1}</td>
                <td>{formatDate(row.date)}</td>
                <td>{row.description || ""}</td>
                <td>{row.project || ""}</td>
                <td className="is-numeric">{formatCashAmount(row.incomingTotal, row.incomingTotal ? "INR" : "")}</td>
                <td className="is-numeric">{formatCashAmount(row.outgoingTotal, row.outgoingTotal ? "INR" : "")}</td>
                <td>{row.securityLevel || ""}{row.securityLevel ? <span className="cf-cell-caret">v</span> : null}</td>
                <td>{row.recurrencePeriod || ""}{row.recurrencePeriod ? <span className="cf-cell-caret">v</span> : null}</td>
                <td>{row.recurrence ?? ""}</td>
                <td>{formatDate(row.validUntil)}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CashFlowCriteria({ criteria, lookups, setField, setNestedField, openModal, message }) {
  const activeTab = criteria.cashFlowTab || "cash";
  const customerGroups = [{ code: "All", name: "All" }, ...(lookups.customerGroups || [])];
  const vendorGroups = [{ code: "All", name: "All" }, ...(lookups.vendorGroups || [])];

  return (
    <div className="fac-criteria cf-criteria sales-analysis-window__body">
      <div className="cf-main">
        <div className="cf-left">
          <div className="cf-date-row">
            <span>Date</span>
            <span>From</span>
            <SapDateInput  value={criteria.dateFrom} onChange={(event) => setField("dateFrom", event.target.value)} />
            <span>To</span>
            <SapDateInput  value={criteria.dateTo} onChange={(event) => setField("dateTo", event.target.value)} />
          </div>
          <label className="cf-interval-row">
            <span>Time Interval</span>
            <select value={criteria.timeInterval} onChange={(event) => setField("timeInterval", event.target.value)}>
              {CASH_FLOW_INTERVALS.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
          </label>
          <div className="cf-checks">
            <label><input type="checkbox" checked={criteria.addRecurringPostings} onChange={(event) => setField("addRecurringPostings", event.target.checked)} />Add Recurring Postings</label>
            <label><input type="checkbox" checked={criteria.addJournalVouchers} onChange={(event) => setField("addJournalVouchers", event.target.checked)} />Add Journal Vouchers</label>
            <label><input type="checkbox" checked={criteria.considerDelaysInPayments} onChange={(event) => setField("considerDelaysInPayments", event.target.checked)} />Consider Delays in Payments</label>
            <label><input type="checkbox" checked={criteria.displayFullyReconciledPostings} onChange={(event) => setField("displayFullyReconciledPostings", event.target.checked)} />Display Fully Reconciled Postings</label>
            <label><input type="checkbox" checked={criteria.addBlanketAgreements} onChange={(event) => setField("addBlanketAgreements", event.target.checked)} />Add Blanket Agreements</label>
            <label className="cf-ellipsis-line"><input type="checkbox" checked={criteria.addMarketingDocuments} onChange={(event) => setField("addMarketingDocuments", event.target.checked)} />Add Marketing Documents<button type="button" className="cf-ellipsis-btn" onClick={() => openModal("cashDocumentTypes")}>...</button></label>
            <label className="cf-ellipsis-line"><input type="checkbox" checked={criteria.addDocumentDrafts} onChange={(event) => setField("addDocumentDrafts", event.target.checked)} />Add Document Drafts<button type="button" className="cf-ellipsis-btn" onClick={() => openModal("cashDocumentTypes")}>...</button></label>
            <label className="cf-ellipsis-line"><input type="checkbox" checked={criteria.addRecurringTransactions} onChange={(event) => setField("addRecurringTransactions", event.target.checked)} />Add Recurring Transactions<button type="button" className="cf-ellipsis-btn" onClick={() => openModal("cashDocumentTypes")}>...</button></label>
          </div>
        </div>

        <div className="cf-right">
          <div className="sales-analysis-tabs cf-tabs">
            {CASH_FLOW_TABS.map((tab) => (
              <button key={tab.key} type="button" className={`sales-analysis-tabs__tab${activeTab === tab.key ? " is-active" : ""}`} onClick={() => setField("cashFlowTab", tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="cf-tab-panel">
            {activeTab === "businessPartner" ? (
              <div className="cf-bp-tab">
                <div className="cf-bp-row"><span>From</span><input value={criteria.bpFrom} onChange={(event) => setField("bpFrom", event.target.value)} /><span>To</span><input value={criteria.bpTo} onChange={(event) => setField("bpTo", event.target.value)} /></div>
                <label className="cf-bp-row"><span>Customer Group</span><select value={criteria.customerGroup} onChange={(event) => setField("customerGroup", event.target.value)}>{customerGroups.map((group) => <option key={`c-${group.code}`} value={group.code}>{group.name || group.code}</option>)}</select></label>
                <label className="cf-bp-row"><span>Vendor Group</span><select value={criteria.vendorGroup} onChange={(event) => setField("vendorGroup", event.target.value)}>{vendorGroups.map((group) => <option key={`v-${group.code}`} value={group.code}>{group.name || group.code}</option>)}</select></label>
                <div className="cf-bp-row"><button type="button" className="sap-report-btn sap-report-btn--primary" onClick={() => openModal("properties")}>Properties</button><input readOnly value={criteria.propertyFilter?.ignoreProperties === false ? "Selected" : "Ignore"} /></div>
              </div>
            ) : (
              <CashFlowAccountGrid accounts={lookups.cashFlow?.cashAccounts || []} selectedCodes={criteria.selectedCashAccounts} onChange={(value) => setField("selectedCashAccounts", value)} />
            )}
          </div>

          <div className="cf-opening">
            <label><input type="radio" name="openingBalanceMode" checked={criteria.openingBalanceMode === "opening"} onChange={() => setField("openingBalanceMode", "opening")} />Opening Balance</label>
            <input value="" readOnly />
            <label><input type="radio" name="openingBalanceMode" checked={criteria.openingBalanceMode === "calculate"} onChange={() => setField("openingBalanceMode", "calculate")} />Calculate Opening Balance</label>
          </div>

          <CashFlowRangeBox criteria={criteria} setField={setField} />
        </div>
      </div>

      <CashFlowProjectedGrid rows={criteria.projectedPostings} />
      {message ? <div className="fac-report-message">{message}</div> : null}
    </div>
  );
}

function CashFlowResult({ report, criteria, setField, setNestedField, currencyCode, collapsed, setCollapsed, onBack }) {
  const rows = (report?.rows || []).filter((row) => !collapsed || row.rowKind !== "detail");
  const shortDate = (value) => {
    const formatted = formatDate(value);
    const match = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return match ? `${match[1]}/${match[2]}/${match[3].slice(2)}` : formatted;
  };
  const updateCheck = (key, checked) => setNestedField("cashFlowChecks", { ...criteria.cashFlowChecks, [key]: checked });

  return (
    <div className="fac-result cf-result sales-analysis-window__body--report">
      <div className="cf-result-toolbar">
        <div className="cf-result-date-row">
          <span>Date From</span><strong>{shortDate(report.dateFrom)}</strong>
          <span>To</span><strong>{shortDate(report.dateTo)}</strong>
          <span>Currency</span>
          <select value={criteria.displayCurrency} onChange={(event) => setField("displayCurrency", event.target.value)}>
            <option value="local">Local</option>
            <option value="system">System</option>
          </select>
        </div>
        <div className="cf-result-check-row">
          <label><input type="checkbox" checked={criteria.cashFlowChecks?.cashAccounts !== false} onChange={(event) => updateCheck("cashAccounts", event.target.checked)} />Cash Accounts</label>
          <label><input type="checkbox" checked={criteria.cashFlowChecks?.credit !== false} onChange={(event) => updateCheck("credit", event.target.checked)} />Credit</label>
          <label><input type="checkbox" checked={criteria.cashFlowChecks?.checks !== false} onChange={(event) => updateCheck("checks", event.target.checked)} />Checks</label>
          <label><input type="checkbox" checked={criteria.cashFlowChecks?.customerLiabilities !== false} onChange={(event) => updateCheck("customerLiabilities", event.target.checked)} />Customer Liabilities</label>
          <label><input type="checkbox" checked={criteria.cashFlowChecks?.debtsToVendors !== false} onChange={(event) => updateCheck("debtsToVendors", event.target.checked)} />Debts to Vendors</label>
          <label><input type="checkbox" checked={Boolean(criteria.cashFlowChecks?.customerForecast)} onChange={(event) => updateCheck("customerForecast", event.target.checked)} />Customer Forecast</label>
          <label><input type="checkbox" checked={Boolean(criteria.cashFlowChecks?.vendorForecast)} onChange={(event) => updateCheck("vendorForecast", event.target.checked)} />Vendor Forecast</label>
        </div>
      </div>

      <div className="cf-result-grid-wrap sales-analysis-report__grid-wrap">
        <table className="cf-result-grid sales-analysis-report__grid">
          <thead>
            <tr>
              <th>Due Date</th>
              <th>Origin</th>
              <th>Reference</th>
              <th>Control Account</th>
              <th>G/L Account/BP Code</th>
              <th>Project</th>
              <th>Blanket Agreement</th>
              <th>Remarks</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Total</th>
              <th>Balance</th>
              <th>^</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key || row.rowNo} className={`cf-result-row is-${row.rowKind || "detail"}`}>
                <td>{row.rowKind === "period" ? <span className="cf-row-toggle">&gt;</span> : null}{row.dueDate === "OB" ? "OB" : shortDate(row.dueDate)}</td>
                <td>{row.origin || ""}</td>
                <td>{row.reference || ""}</td>
                <td>{row.controlAccount || ""}</td>
                <td>{row.accountName || row.glAccountBpCode || ""}</td>
                <td>{row.project || ""}</td>
                <td>{row.blanketAgreement || ""}</td>
                <td>{row.remarks || ""}</td>
                <td className="is-numeric">{formatCashAmount(row.debit, currencyCode)}</td>
                <td className="is-numeric">{formatCashAmount(row.credit, currencyCode)}</td>
                <td className="is-numeric">{formatCashAmount(row.total, currencyCode)}</td>
                <td className="is-numeric">{formatCashAmount(row.balance, currencyCode)}</td>
                <td />
              </tr>
            ))}
            {Array.from({ length: Math.max(18 - rows.length, 0) }).map((_, index) => (
              <tr key={`blank-${index}`} className="cf-result-row is-blank">
                {Array.from({ length: 13 }).map((__, cellIndex) => <td key={cellIndex} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="cf-result-footer">
        <button type="button" className="sales-analysis-report__back-btn" onClick={onBack}>{"<"}</button>
        <button type="button" className="sap-report-btn sap-report-btn--primary">OK</button>
        <span>Note: {REPORTS["cash-flow"].groups}</span>
        <button type="button" className="sap-report-btn cf-expand-btn" onClick={() => setCollapsed(false)}>Expand</button>
        <button type="button" className="sap-report-btn" onClick={() => setCollapsed(true)}>Collapse</button>
      </footer>
    </div>
  );
}

function CashFlowReferenceCriteria({ criteria, message, setField }) {
  return (
    <div className="fac-criteria cfr-criteria sales-analysis-window__body">
      <div className="cfr-date-row">
        <span>Date From</span>
        <SapDateInput  value={criteria.dateFrom} onChange={(event) => setField("dateFrom", event.target.value)} />
        <span>To</span>
        <SapDateInput  value={criteria.dateTo} onChange={(event) => setField("dateTo", event.target.value)} />
      </div>

      <div className="cfr-radio-stack">
        <label>
          <input
            type="radio"
            name="cashFlowReferenceMode"
            checked={criteria.cashFlowReferenceMode !== "all"}
            onChange={() => setField("cashFlowReferenceMode", "unassigned")}
          />
          <span>Unassigned Transactions Relevant to Cash Flow</span>
        </label>
        <label>
          <input
            type="radio"
            name="cashFlowReferenceMode"
            checked={criteria.cashFlowReferenceMode === "all"}
            onChange={() => setField("cashFlowReferenceMode", "all")}
          />
          <span>All Transactions Relevant to Cash Flow</span>
        </label>
      </div>

      {message ? <div className="fac-report-message">{message}</div> : null}
    </div>
  );
}

function CashFlowReferenceResult({ report, criteria, currencyCode, setField, onBack }) {
  const rows = report?.rows || [];
  const blankRows = Array.from({ length: Math.max(26 - rows.length, 0) });

  return (
    <div className="cfr-result sales-analysis-window__body--report">
      <div className="cfr-result-toolbar">
        <label>
          <span>Currency</span>
          <select value={criteria.displayCurrency} onChange={(event) => setField("displayCurrency", event.target.value)}>
            <option value="local">Local</option>
            <option value="system">System</option>
            <option value="foreign">Foreign</option>
          </select>
        </label>
        <div className="cfr-result-dates">
          <span>From Date</span>
          <strong>{formatDate(report.dateFrom)}</strong>
          <span>To Date</span>
          <strong>{formatDate(report.dateTo)}</strong>
        </div>
      </div>

      <div className="cfr-grid-wrap sales-analysis-report__grid-wrap">
        <table className="cfr-grid sales-analysis-report__grid">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Trans. #</th>
              <th>Creator</th>
              <th>G/L Acc./BP Code</th>
              <th>G/L Acc./BP Name</th>
              <th>Debit{currencyCode ? ` (${currencyCode})` : ""}</th>
              <th>Credit{currencyCode ? ` (${currencyCode})` : ""}</th>
              <th>Primary Form Item</th>
              <th className="cfr-grid-open">^</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{formatDate(row.date)}</td>
                <td>{row.type}</td>
                <td>{row.transactionNumber || ""}</td>
                <td>{row.creator}</td>
                <td>{row.entityCode}</td>
                <td>{row.entityName}</td>
                <td className="is-numeric">{formatAmount(row.debit)}</td>
                <td className="is-numeric">{formatAmount(row.credit)}</td>
                <td>{row.primaryFormItem}</td>
                <td />
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan="10" className="sales-analysis-report__empty">
                  No cash flow reference transactions matched the current selection criteria.
                </td>
              </tr>
            ) : null}
            {blankRows.map((_, index) => (
              <tr key={`blank-${index}`} className="is-blank">
                <td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="6">{report?.totals?.rowCount || 0}</td>
              <td className="is-numeric">{formatAmount(report?.totals?.debit)}</td>
              <td className="is-numeric">{formatAmount(report?.totals?.credit)}</td>
              <td colSpan="2" />
            </tr>
          </tfoot>
        </table>
      </div>

      <footer className="cfr-result-footer">
        <button type="button" className="sales-analysis-report__back-btn" onClick={onBack}>{"<"}</button>
        <span>{REPORTS["cash-flow-reference-report"].groups}</span>
      </footer>
    </div>
  );
}

function ProfitLossCriteria({ criteria, lookups, setField, openModal, message }) {
  const templates = getTemplatesForReport(lookups, "profit-and-loss-statement");

  return (
    <div className="fac-criteria fac-pl-criteria sales-analysis-window__body">
      <div className="fac-pl-date-row">
        <label>Date</label>
        <select value={criteria.dateType} onChange={(event) => setField("dateType", event.target.value)}>
          {lookups.dateTypes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
        <span>From</span>
        <SapDateInput  value={criteria.dateFrom} onChange={(event) => setField("dateFrom", event.target.value)} />
        <span>To</span>
        <SapDateInput  value={criteria.dateTo} onChange={(event) => setField("dateTo", event.target.value)} />
      </div>

      <div className="fac-pl-main">
        <fieldset className="fac-pl-display-box">
          <legend>Display in Report:</legend>
          <label className="fac-pl-template">
            <span>Template</span>
            <select value={criteria.templateCode} onChange={(event) => setField("templateCode", event.target.value)}>
              {templates.map((item) => <option key={item.code} value={item.code}>{item.name || item.code}</option>)}
            </select>
          </label>

          <div className="fac-pl-display-checks">
            <label><input type="checkbox" checked={criteria.includeZeroBalance} onChange={(event) => setField("includeZeroBalance", event.target.checked)} />Accounts with Balance of Zero</label>
            <label><input type="checkbox" checked={criteria.foreignName} onChange={(event) => setField("foreignName", event.target.checked)} />Foreign Name</label>
            <label><input type="checkbox" checked={criteria.externalCode} onChange={(event) => setField("externalCode", event.target.checked)} />External Code</label>
          </div>

          <div className="fac-pl-currencies">
            <label><input type="radio" name="plCurrency" checked={criteria.displayCurrency === "local"} onChange={() => setField("displayCurrency", "local")} />Display LC</label>
            <label><input type="radio" name="plCurrency" checked={criteria.displayCurrency === "system"} onChange={() => setField("displayCurrency", "system")} />Display SC</label>
            <label><input type="radio" name="plCurrency" checked={criteria.displayCurrency === "localAndSystem"} onChange={() => setField("displayCurrency", "localAndSystem")} />Display LC and SC</label>
          </div>

          <div className="fac-pl-periods">
            <label><input type="radio" name="plPeriod" checked={criteria.periodType === "annual"} onChange={() => setField("periodType", "annual")} />Annual Report</label>
            <label><input type="radio" name="plPeriod" checked={criteria.periodType === "quarterly"} onChange={() => setField("periodType", "quarterly")} />Quarterly Report</label>
            <label><input type="radio" name="plPeriod" checked={criteria.periodType === "monthly"} onChange={() => setField("periodType", "monthly")} />Monthly Report</label>
          </div>
        </fieldset>

        <div className="fac-pl-side">
          <label><input type="checkbox" checked={criteria.addJournalVouchers} onChange={(event) => setField("addJournalVouchers", event.target.checked)} />Add Journal Vouchers</label>
          <label><input type="checkbox" checked={criteria.ignoreAdjustments} onChange={(event) => setField("ignoreAdjustments", event.target.checked)} />Ignore Adjustments</label>
          <div className="fac-pl-actions">
            <input aria-label="Enable Revaluation" type="checkbox" checked={criteria.revaluationEnabled} onChange={(event) => setField("revaluationEnabled", event.target.checked)} />
            <button type="button" className="sap-report-btn" onClick={() => openModal("revaluation")}>Revaluation</button>
            <span />
            <button type="button" className="sap-report-btn" onClick={() => openModal("expanded")}>Expanded</button>
          </div>
        </div>
      </div>

      <div className="fac-pl-print-row">
        <label><input type="radio" name="plPrint" checked={criteria.printMode === "monthly"} onChange={() => setField("printMode", "monthly")} />Print Monthly Report</label>
        <label><input type="radio" name="plPrint" checked={criteria.printMode === "medium"} onChange={() => setField("printMode", "medium")} />Print Medium Report</label>
        <label><input type="radio" name="plPrint" checked={criteria.printMode === "yearEnd"} onChange={() => setField("printMode", "yearEnd")} />Print Year End Report</label>
      </div>

      {message ? <div className="fac-report-message">{message}</div> : null}
    </div>
  );
}

export default function FinancialStatementReportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { reportKey = "" } = useParams();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const definition = REPORTS[reportKey];
  const [criteria, setCriteria] = useState(initialCriteria);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [lookups, setLookups] = useState(EMPTY_LOOKUPS);
  const [activeModal, setActiveModal] = useState("");
  const [cashFlowCollapsed, setCashFlowCollapsed] = useState(false);

  useEffect(() => {
    if (reportKey !== "cash-flow") return;
    setCriteria((current) => ({
      ...current,
      addJournalVouchers: true,
      addMarketingDocuments: true,
      timeInterval: current.timeInterval || "weekly",
      cashFlowTab: current.cashFlowTab || "cash",
    }));
  }, [reportKey]);

  useEffect(() => {
    let mounted = true;
    fetchFinancialStatementLookups()
      .then((data) => {
        if (!mounted) return;
        const next = { ...EMPTY_LOOKUPS, ...(data || {}) };
        next.templates = getTemplatesForReport(next, reportKey);
        if (!next.templates.length) next.templates = EMPTY_LOOKUPS.templates;
        setLookups(next);
        const reportTemplates = getTemplatesForReport(next, reportKey);
        setCriteria((current) => ({
          ...current,
          templateCode: reportKey === "trial-balance"
            ? (next.trialBalanceTemplates.some((template) => template.code === current.templateCode)
              ? current.templateCode
              : next.trialBalanceTemplates[0]?.code || "")
            : (reportTemplates.some((template) => template.code === current.templateCode)
              ? current.templateCode
              : reportTemplates[0]?.code || ""),
          revaluation: {
            ...current.revaluation,
            currencyCode: current.revaluation.currencyCode || next.currencies[0]?.code || "",
            indexCode: current.revaluation.indexCode || next.indexes[0]?.code || "",
            indexToCode: current.revaluation.indexToCode || next.indexes[0]?.code || "",
          },
        }));
      })
      .catch((error) => {
        if (mounted) setMessage(error?.response?.data?.message || "Could not load SAP B1 financial report lookups.");
      });
    return () => { mounted = false; };
  }, [reportKey]);

  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 18,
    taskId: `financial-statement-${reportKey}-criteria`,
    taskTitle: `${definition?.title || "Financial Report"} - Selection Criteria`,
    taskPath: location.pathname,
    bounds: "parent",
  });
  const reportWindow = useFloatingWindow({
    isOpen: Boolean(report),
    defaultTop: 8,
    taskId: `financial-statement-${reportKey}-result`,
    taskTitle: definition?.title || "Financial Report",
    taskPath: location.pathname,
    bounds: "parent",
  });

  const setField = (field, value) => {
    setCriteria((current) => ({ ...current, [field]: value }));
    setMessage("");
  };
  const setNestedField = (field, value) => {
    setCriteria((current) => ({ ...current, [field]: value }));
    setMessage("");
  };

  const closeCriteria = () => {
    if (!closeActiveAndRestorePrevious()) navigate("/dashboard");
  };

  const runReport = async () => {
    if (!criteria.dateFrom || !criteria.dateTo) {
      setMessage("Select the report date range.");
      return;
    }
    if (criteria.dateFrom > criteria.dateTo) {
      setMessage("From Date cannot be after To Date.");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      setReport(await fetchFinancialStatement(reportKey, criteria));
    } catch (error) {
      setReport(null);
      setMessage(error?.response?.data?.message || error?.message || "Could not load report data.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    const reportTemplates = getTemplatesForReport(lookups, reportKey);
    setCriteria({
      ...initialCriteria(),
      templateCode: reportKey === "trial-balance"
        ? lookups.trialBalanceTemplates[0]?.code || "trialBalance"
        : reportTemplates[0]?.code || "",
    });
    setReport(null);
    setMessage("");
  };

  const controls = (frame, onClose) => (
    <div className="sales-analysis-window__controls">
      <button type="button" aria-label="Minimize" onClick={() => { frame.toggleMinimize(); navigate("/dashboard"); }}>-</button>
      <button type="button" aria-label="Restore" onClick={frame.toggleMaximize}>[]</button>
      <button type="button" aria-label="Close" onClick={onClose}>x</button>
    </div>
  );

  const reportCaption = useMemo(() => {
    if (!report) return "";
    if (reportKey === "balance-sheet") return `As of ${formatDate(report.dateTo)}`;
    return `From ${formatDate(report.dateFrom)} To ${formatDate(report.dateTo)}`;
  }, [report, reportKey]);

  const resultTitle = reportKey === "trial-balance" && criteria.balanceMode === "account"
    ? "Account Balance"
    : definition.title;
  const resultCurrencyCode = report?.currencyCode
    || (criteria.displayCurrency === "system"
      ? lookups.companyCurrency?.systemCurrency
      : lookups.companyCurrency?.localCurrency)
    || "";

  const openReportRow = (row) => {
    if (row.entityType === "bp") {
      navigate(`/business-partner?cardCode=${encodeURIComponent(row.entityCode)}`);
      return;
    }
    navigate(`/chart-of-accounts?accountCode=${encodeURIComponent(row.key)}`);
  };

  if (!definition) {
    return <div className="fac-report-message">This financial report is not configured yet.</div>;
  }

  return (
    <div className="fac-report-page sales-analysis-page sap-report-page">
      <section
        className={`fac-report-window fac-report-window--criteria${reportKey === "balance-sheet" ? " fac-report-window--balance-sheet" : ""}${reportKey === "trial-balance" ? " fac-report-window--trial-balance" : ""}${reportKey === "profit-and-loss-statement" ? " fac-report-window--profit-loss" : ""}${reportKey === "cash-flow" ? " fac-report-window--cash-flow" : ""}${reportKey === "cash-flow-reference-report" ? " fac-report-window--cash-flow-reference" : ""} sales-analysis-window sap-report-window${criteriaWindow.isMinimized ? " is-minimized" : ""}${criteriaWindow.isMaximized ? " is-maximized" : ""}`}
        {...criteriaWindow.windowProps}
      >
        <header className="sales-analysis-window__titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
          <span className="sap-report-title">{definition.title} - Selection Criteria</span>
          {controls(criteriaWindow, closeCriteria)}
        </header>
        <div className="sales-analysis-window__accent" />

        {!criteriaWindow.isMinimized ? (
          <>
            {reportKey === "cash-flow-reference-report" ? (
              <CashFlowReferenceCriteria criteria={criteria} message={message} setField={setField} />
            ) : reportKey === "cash-flow" ? (
              <CashFlowCriteria criteria={criteria} lookups={lookups} setField={setField} setNestedField={setNestedField} openModal={setActiveModal} message={message} />
            ) : reportKey === "trial-balance" ? (
              <div className="fac-criteria fac-tb-criteria sales-analysis-window__body">
                <TrialBalanceCriteria criteria={criteria} lookups={lookups} setField={setField} openModal={setActiveModal} />
                {message ? <div className="fac-report-message">{message}</div> : null}
              </div>
            ) : reportKey === "balance-sheet" ? <div className="fac-criteria fac-bs-criteria sales-analysis-window__body">
              <div className="fac-bs-date-row">
                <label>Date</label>
                <select value={criteria.dateType} onChange={(event) => setField("dateType", event.target.value)}>{lookups.dateTypes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
                <span>To</span>
                <SapDateInput  value={criteria.dateTo} onChange={(event) => setField("dateTo", event.target.value)} />
              </div>

              <div className="fac-bs-main">
                <fieldset className="fac-bs-display-box">
                  <legend>Display in Report:</legend>
                  <label className="fac-bs-template"><span>Template</span><select value={criteria.templateCode} onChange={(event) => setField("templateCode", event.target.value)}>{lookups.templates.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
                  <div className="fac-bs-display-checks">
                    <label><input type="checkbox" checked={criteria.includeZeroBalance} onChange={(event) => setField("includeZeroBalance", event.target.checked)} />Accounts with Balance of Zero</label>
                    <label><input type="checkbox" checked={criteria.foreignName} onChange={(event) => setField("foreignName", event.target.checked)} />Foreign Name</label>
                    <label><input type="checkbox" checked={criteria.externalCode} onChange={(event) => setField("externalCode", event.target.checked)} />External Code</label>
                  </div>
                  <div className="fac-bs-currencies">
                    <label><input type="radio" name="currency" checked={criteria.displayCurrency === "local"} onChange={() => setField("displayCurrency", "local")} />Display LC</label>
                    <label><input type="radio" name="currency" checked={criteria.displayCurrency === "system"} onChange={() => setField("displayCurrency", "system")} />Display SC</label>
                    <label><input type="radio" name="currency" checked={criteria.displayCurrency === "localAndSystem"} onChange={() => setField("displayCurrency", "localAndSystem")} />Display LC and SC</label>
                  </div>
                </fieldset>

                <div className="fac-bs-side">
                  <div className="fac-bs-side-checks">
                    <label><input type="checkbox" checked={criteria.addJournalVouchers} onChange={(event) => setField("addJournalVouchers", event.target.checked)} />Add Journal Vouchers</label>
                    <label><input type="checkbox" checked={criteria.addClosingBalances} onChange={(event) => setField("addClosingBalances", event.target.checked)} />Add Closing Balances</label>
                    <label><input type="checkbox" checked={criteria.ignoreAdjustments} onChange={(event) => setField("ignoreAdjustments", event.target.checked)} />Ignore Adjustments</label>
                  </div>
                  <div className="fac-bs-actions">
                    <input aria-label="Enable Revaluation" type="checkbox" checked={criteria.revaluationEnabled} onChange={(event) => setField("revaluationEnabled", event.target.checked)} />
                    <button type="button" className="sap-report-btn" onClick={() => setActiveModal("revaluation")}>Revaluation</button>
                    <span />
                    <button type="button" className="sap-report-btn" onClick={() => setActiveModal("expanded")}>Expanded</button>
                  </div>
                </div>
              </div>

              {message ? <div className="fac-report-message">{message}</div> : null}
            </div> : reportKey === "profit-and-loss-statement" ? (
              <ProfitLossCriteria criteria={criteria} lookups={lookups} setField={setField} openModal={setActiveModal} message={message} />
            ) : <div className="fac-criteria sales-analysis-window__body">
              <div className="fac-date-row">
                <label>Date</label>
                <select value={criteria.dateType} onChange={(event) => setField("dateType", event.target.value)}>{lookups.dateTypes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
                {reportKey !== "balance-sheet" ? <span>From</span> : <span />}
                {reportKey !== "balance-sheet" ? (
                  <SapDateInput  value={criteria.dateFrom} onChange={(event) => setField("dateFrom", event.target.value)} />
                ) : <span />}
                <span>To</span>
                <SapDateInput  value={criteria.dateTo} onChange={(event) => setField("dateTo", event.target.value)} />
              </div>

              <div className="fac-criteria-layout">
                <fieldset className="fac-section">
                  <legend>Display in Report</legend>
                  <label><input type="checkbox" checked={criteria.includeZeroBalance} onChange={(event) => setField("includeZeroBalance", event.target.checked)} />Accounts with Balance of Zero</label>
                  <label><input type="checkbox" checked={criteria.foreignName} onChange={(event) => setField("foreignName", event.target.checked)} />Foreign Name</label>
                  <label><input type="checkbox" checked={criteria.externalCode} onChange={(event) => setField("externalCode", event.target.checked)} />External Code</label>
                  <div className="fac-radio-group">
                    <label><input type="radio" name="currency" checked={criteria.displayCurrency === "local"} onChange={() => setField("displayCurrency", "local")} />Display LC</label>
                    <label><input type="radio" name="currency" checked={criteria.displayCurrency === "system"} onChange={() => setField("displayCurrency", "system")} />Display SC</label>
                    <label><input type="radio" name="currency" checked={criteria.displayCurrency === "foreign"} onChange={() => setField("displayCurrency", "foreign")} />Display FC</label>
                  </div>
                  {reportKey === "profit-and-loss-statement" ? (
                    <div className="fac-radio-group fac-radio-group--period">
                      <label><input type="radio" checked readOnly />Annual Report</label>
                      <label><input type="radio" disabled />Quarterly Report</label>
                      <label><input type="radio" disabled />Monthly Report</label>
                    </div>
                  ) : null}
                </fieldset>

                <div className="fac-side-options">
                  <label><input type="checkbox" checked={criteria.addJournalVouchers} onChange={(event) => setField("addJournalVouchers", event.target.checked)} />Add Journal Vouchers</label>
                  {reportKey !== "profit-and-loss-statement" ? <label><input type="checkbox" checked={criteria.addClosingBalances} onChange={(event) => setField("addClosingBalances", event.target.checked)} />Add Closing Balances</label> : null}
                  <label><input type="checkbox" checked={criteria.ignoreAdjustments} onChange={(event) => setField("ignoreAdjustments", event.target.checked)} />Ignore Adjustments</label>
                  <button type="button" className="sap-report-btn" disabled onClick={() => setActiveModal("revaluation")}>Revaluation</button>
                  <button type="button" className="sap-report-btn fac-expanded" onClick={() => setActiveModal("expanded")}>Expanded</button>
                </div>
              </div>

              {message ? <div className="fac-report-message">{message}</div> : null}
            </div>}
            <footer className="fac-report-footer">
              <button type="button" className="sap-report-btn sap-report-btn--primary" onClick={runReport} disabled={loading}>{loading ? "Loading..." : "OK"}</button>
              <button type="button" className="sap-report-btn" onClick={reset}>Cancel</button>
            </footer>
          </>
        ) : null}
      </section>

      {report ? (
        <section
          className={`fac-report-window fac-report-window--result sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? " is-minimized" : ""}${reportWindow.isMaximized ? " is-maximized" : ""}`}
          {...reportWindow.windowProps}
        >
          <header className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
            <span className="sap-report-title">{resultTitle}</span>
            {controls(reportWindow, () => setReport(null))}
          </header>
          <div className="sales-analysis-window__accent" />
          {!reportWindow.isMinimized ? reportKey === "cash-flow-reference-report" ? (
            <CashFlowReferenceResult
              report={report}
              criteria={criteria}
              currencyCode={resultCurrencyCode}
              setField={setField}
              onBack={() => setReport(null)}
            />
          ) : reportKey === "cash-flow" ? (
            <CashFlowResult
              report={report}
              criteria={criteria}
              setField={setField}
              setNestedField={setNestedField}
              currencyCode={resultCurrencyCode}
              collapsed={cashFlowCollapsed}
              setCollapsed={setCashFlowCollapsed}
              onBack={() => setReport(null)}
            />
          ) : (
            <div className="fac-result sales-analysis-window__body--report">
              <div className="fac-result-toolbar">
                {reportKey === "trial-balance" ? (
                  <div className="fac-tb-report-dates">
                    <span>From Date</span><strong>{formatDate(report.dateFrom)}</strong>
                    <span>To</span><strong>{formatDate(report.dateTo)}</strong>
                  </div>
                ) : reportKey === "profit-and-loss-statement" ? (
                  <div className="fac-pl-result-toolbar">
                    <div className="fac-pl-result-dates">
                      <span>Current Period</span><span>From</span><strong>{formatDate(report.dateFrom)}</strong><span>To</span><strong>{formatDate(report.dateTo)}</strong>
                      <span>Current Year</span><span>From</span><strong>{formatDate(report.fiscalYearFrom || report.dateFrom)}</strong><span>To</span><strong>{formatDate(report.dateTo)}</strong>
                    </div>
                    <div className="fac-pl-result-options">
                      <label><input type="checkbox" checked={criteria.displaySubtotals} onChange={(event) => setField("displaySubtotals", event.target.checked)} />Display Subtotals</label>
                      <label><input type="checkbox" checked={criteria.hideTitles} onChange={(event) => setField("hideTitles", event.target.checked)} />Hide Titles</label>
                      <label className="fac-pl-level"><span>Level</span><select value={criteria.displayLevel} onChange={(event) => setField("displayLevel", Number(event.target.value))}>{LEVEL_OPTIONS.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
                    </div>
                  </div>
                ) : (
                  <>
                    <strong>{reportCaption}</strong>
                    <label><input type="checkbox" checked={criteria.displaySubtotals} onChange={(event) => setField("displaySubtotals", event.target.checked)} />Display Subtotals</label>
                  </>
                )}
              </div>
              <div className="fac-grid-wrap sales-analysis-report__grid-wrap">
                <table className={`fac-grid sales-analysis-report__grid${reportKey === "trial-balance" ? " fac-grid--trial-balance" : ""}${reportKey === "profit-and-loss-statement" ? " fac-grid--profit-loss" : ""}`}>
                  <thead>
                    {reportKey === "trial-balance" ? (
                      <>
                        <tr className="fac-grid__currency-head">
                          <th rowSpan="2">Code</th>
                          <th rowSpan="2">Name</th>
                          <th colSpan={definition.columns.length}>{report.displayCurrency === "system" ? "System Currency" : report.displayCurrency === "foreign" ? "Foreign Currency" : "Local Currency"}</th>
                        </tr>
                        <tr>{definition.columns.map(([, label]) => <th key={label}>{label}</th>)}</tr>
                      </>
                    ) : (
                      <tr>
                        <th>Account Name</th>
                        {definition.columns.map(([, label]) => <th key={label}>{reportKey === "profit-and-loss-statement" && resultCurrencyCode ? `${label} (${resultCurrencyCode})` : label}</th>)}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {report.rows.map((row) => {
                      if (reportKey !== "trial-balance" && row.isGroup && !criteria.displaySubtotals) return null;
                      if (reportKey === "profit-and-loss-statement" && criteria.hideTitles && row.isTitle && !row.isGroup) return null;
                      if (reportKey === "profit-and-loss-statement" && Number(row.level || 0) > Number(criteria.displayLevel || 10)) return null;
                      return (
                        <tr key={row.key} className={`${row.isGroup ? "is-group" : ""}${row.isTitle ? " is-title" : ""}${row.rowKind ? ` is-${row.rowKind}` : ""}`}>
                          {reportKey === "trial-balance" ? (
                            <>
                              <td>{row.isTitle ? "" : row.accountCode}</td>
                              <td style={{ paddingLeft: `${8 + Math.min(row.level, 8) * 15}px` }}>
                                {!row.isTitle && row.accountCode ? <button type="button" className="fac-account-link" onClick={() => openReportRow(row)}>{criteria.foreignName && row.foreignName ? row.foreignName : row.accountName}</button> : row.accountName}
                                {criteria.externalCode && row.externalCode ? <small className="fac-external-code">{row.externalCode}</small> : null}
                              </td>
                            </>
                          ) : (
                            <td style={{ paddingLeft: `${8 + Math.min(row.level, 8) * 15}px` }}>
                              {!row.isTitle && row.accountCode ? (
                                <button type="button" className="fac-account-link" onClick={() => openReportRow(row)}>
                                  <span>-&gt;</span>{row.accountCode} - {criteria.foreignName && row.foreignName ? row.foreignName : row.accountName}
                                </button>
                              ) : (criteria.foreignName && row.foreignName ? row.foreignName : row.accountName)}
                              {criteria.externalCode && row.externalCode ? <small className="fac-external-code">{row.externalCode}</small> : null}
                            </td>
                          )}
                          {definition.columns.map(([key]) => <td key={key} className="is-numeric">{formatAmount(row[key])}</td>)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <footer className="fac-result-footer">
                <button type="button" className="sales-analysis-report__back-btn" onClick={() => setReport(null)}>{"<"}</button>
                <span>{definition.groups}</span>
              </footer>
            </div>
          ) : null}
        </section>
      ) : null}
      {activeModal === "revaluation" ? <BalanceSheetRevaluationModal title={`${definition.title} Revaluation`} lookups={lookups} value={criteria.revaluation} onChange={(value) => setNestedField("revaluation", value)} onClose={() => setActiveModal("")} /> : null}
      {activeModal === "expanded" ? <BalanceSheetExpandedModal value={criteria.expandedCriteria} onChange={(value) => setNestedField("expandedCriteria", value)} onOpenReferences={() => setActiveModal("references")} onOpenUdfs={() => setActiveModal("udfs")} onClose={() => setActiveModal("")} /> : null}
      {activeModal === "trialExpanded" ? <TrialBalanceExpandedModal value={criteria.expandedCriteria} onChange={(value) => setNestedField("expandedCriteria", value)} onOpenReferences={() => setActiveModal("references")} onOpenUdfs={() => setActiveModal("udfs")} onClose={() => setActiveModal("")} /> : null}
      {activeModal === "references" ? <BalanceSheetFilterGridModal title="Reference Fields" fields={lookups.referenceFields} rules={lookups.ruleOptions} rows={criteria.referenceFilters} onChange={(value) => setNestedField("referenceFilters", value)} onClose={() => setActiveModal(reportKey === "trial-balance" ? "trialExpanded" : "expanded")} /> : null}
      {activeModal === "udfs" ? <BalanceSheetFilterGridModal title="User-Defined Fields" fields={lookups.userDefinedFields} rules={lookups.ruleOptions} rows={criteria.udfFilters} onChange={(value) => setNestedField("udfFilters", value)} onClose={() => setActiveModal(reportKey === "trial-balance" ? "trialExpanded" : "expanded")} /> : null}
      {activeModal === "cashDocumentTypes" ? <CashFlowDocumentTypesModal documentTypes={lookups.cashFlow?.documentTypes || []} value={criteria.cashFlowDocumentTypes} onChange={(value) => setNestedField("cashFlowDocumentTypes", value)} onClose={() => setActiveModal("")} /> : null}
      <PropertiesSelectionModal isOpen={activeModal === "properties"} onClose={() => setActiveModal("")} onSave={(value) => setNestedField("propertyFilter", value)} properties={lookups.bpProperties} value={criteria.propertyFilter} propertyLabelPrefix="Business Partners Property" />
    </div>
  );
}
