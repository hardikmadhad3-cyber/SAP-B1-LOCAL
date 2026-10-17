import SapInput from '../components/common/SapInput';
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fetchAccountingTransactionLookups, fetchAccountingTransactionReport } from "../api/accountingTransactionReportsApi";
import useFloatingWindow from "../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../components/SapWindowTaskbarContext";
import "../styles/sales-analysis-report.css";
import "../styles/accounting-transaction-reports.css";

const REPORTS = {
  "transaction-journal": {
    title: "Transaction Journal Report",
    subtitle: "Journal transactions and their G/L account lines",
  },
  "transaction-by-projects": {
    title: "Transaction Report by Projects",
    subtitle: "Journal transactions grouped and filtered by project",
  },
  "transactions-received-from-voucher": {
    title: "Transactions Received from Voucher Report",
    subtitle: "Transactions created from the selected journal voucher",
  },
  "document-journal": {
    title: "Document Journal",
    subtitle: "Detailed journal rows created by SAP Business One documents",
  },
  "journal-transaction-amount-range": {
    title: "Locate Journal Transaction by Amount Range",
    subtitle: "Journal rows whose debit or credit amount lies in the range",
  },
  "journal-transaction-fc-amount-range": {
    title: "Locate Journal Transaction by FC Amount Range",
    subtitle: "Foreign-currency journal rows whose amount lies in the range",
  },
};
const AMOUNT_RANGE_REPORTS = new Set(["journal-transaction-amount-range", "journal-transaction-fc-amount-range"]);

const ORIGINAL_JOURNALS = [
  ["all", "All Transactions"],
  ["13", "A/R Invoices"],
  ["14", "A/R Credit Memos"],
  ["18", "A/P Invoices"],
  ["19", "A/P Credit Memos"],
  ["24", "Incoming Payments"],
  ["30", "Journal Entries"],
  ["46", "Outgoing Payments"],
  ["59", "Goods Receipts"],
  ["60", "Goods Issues"],
];

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
    postingDateFrom: inputDate(fiscalStart),
    postingDateTo: inputDate(today),
    dueDateFrom: "",
    dueDateTo: "",
    documentDateFrom: "",
    documentDateTo: "",
    transactionFrom: "",
    transactionTo: "",
    projectFrom: "",
    projectTo: "",
    accountFrom: "",
    accountTo: "",
    originalJournal: "all",
    voucherNumber: "",
    amountFrom: "",
    amountTo: "",
    displayCurrency: "local",
    seriesCodes: [],
  };
};

const formatAmount = (value) => Number(value || 0).toLocaleString("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString("en-GB");
};

const SOURCE_ROUTES = {
  13: ["/ar-invoice", "arInvoiceDocEntry"],
  14: ["/ar-credit-memo", "arCreditMemoDocEntry"],
  15: ["/delivery", "deliveryDocEntry"],
  17: ["/sales-order", "salesOrderDocEntry"],
  18: ["/ap-invoice", "APInvoiceDocEntry"],
  19: ["/ap-credit-memo", "APCreditMemoDocEntry"],
  20: ["/grpo", "grpoDocEntry"],
  22: ["/purchase-order", "purchaseOrderDocEntry"],
  23: ["/sales-quotation", "salesQuotationDocEntry"],
  24: ["/incoming-payments", "incomingPaymentDocEntry"],
  46: ["/outgoing-payments", "outgoingPaymentDocEntry"],
  59: ["/goods-receipt", "goodsReceiptDocEntry"],
  60: ["/goods-issue", "goodsIssueDocEntry"],
  67: ["/inventory-transfer", "inventoryTransferDocEntry"],
  1250000001: ["/inventory-transfer-request", "inventoryTransferRequestDocEntry"],
};

function FinancialAccountingReportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { reportKey = "" } = useParams();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const definition = REPORTS[reportKey];
  const [criteria, setCriteria] = useState(initialCriteria);
  const [lookups, setLookups] = useState({ series: [], projects: [], accounts: [], vouchers: [] });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [showSeries, setShowSeries] = useState(false);

  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 18,
    taskId: `accounting-${reportKey}-criteria`,
    taskTitle: `${definition?.title || "Financial Accounting Report"} - Selection Criteria`,
    taskPath: location.pathname,
    bounds: "parent",
  });
  const reportWindow = useFloatingWindow({
    isOpen: Boolean(report),
    defaultTop: 8,
    taskId: `accounting-${reportKey}-result`,
    taskTitle: definition?.title || "Financial Accounting Report",
    taskPath: location.pathname,
    bounds: "parent",
  });

  useEffect(() => {
    let mounted = true;
    fetchAccountingTransactionLookups()
      .then((data) => {
        if (!mounted) return;
        setLookups({
          series: data?.series || [],
          projects: data?.projects || [],
          accounts: data?.accounts || [],
          vouchers: data?.vouchers || [],
        });
        if (reportKey === "transactions-received-from-voucher" && data?.vouchers?.length) {
          setCriteria((current) => ({ ...current, voucherNumber: String(data.vouchers[0].code) }));
        }
      })
      .catch((error) => {
        if (mounted) setMessage(error?.response?.data?.message || "Could not load SAP B1 report lookups.");
      });
    return () => { mounted = false; };
  }, [reportKey]);

  const setField = (field, value) => {
    setCriteria((current) => ({ ...current, [field]: value }));
    setMessage("");
  };

  const closeCriteria = () => {
    if (!closeActiveAndRestorePrevious()) navigate("/dashboard");
  };

  const runReport = async () => {
    if (reportKey === "transactions-received-from-voucher" && !Number(criteria.voucherNumber)) {
      setMessage("Select a journal voucher number.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      setReport(await fetchAccountingTransactionReport(reportKey, criteria));
    } catch (error) {
      setReport(null);
      setMessage(error?.response?.data?.message || error?.message || "Could not load report data.");
    } finally {
      setLoading(false);
    }
  };

  const openJournalEntry = (transId) => {
    if (transId) navigate("/journal-entry", { state: { journalEntryTransId: transId } });
  };
  const openEntity = (row) => {
    if (!row.entityCode) return;
    navigate(row.entityType === "bp"
      ? `/business-partner?cardCode=${encodeURIComponent(row.entityCode)}`
      : `/chart-of-accounts?accountCode=${encodeURIComponent(row.accountCode || row.entityCode)}`);
  };
  const openAccount = (code) => {
    if (code) navigate(`/chart-of-accounts?accountCode=${encodeURIComponent(code)}`);
  };
  const openSourceDocument = (row) => {
    const route = SOURCE_ROUTES[row.transType];
    if (!route || !row.sourceDocEntry) {
      openJournalEntry(row.transId);
      return;
    }
    navigate(route[0], { state: { [route[1]]: row.sourceDocEntry } });
  };

  const toggleSeries = (code) => {
    setCriteria((current) => {
      const selected = new Set(current.seriesCodes.map(Number));
      if (selected.has(Number(code))) selected.delete(Number(code));
      else selected.add(Number(code));
      return { ...current, seriesCodes: [...selected] };
    });
  };

  const controls = (frame, onClose) => (
    <div className="sales-analysis-window__controls">
      <button type="button" aria-label="Minimize" onClick={() => { frame.toggleMinimize(); navigate("/dashboard"); }}>-</button>
      <button type="button" aria-label="Restore" onClick={frame.toggleMaximize}>[]</button>
      <button type="button" aria-label="Close" onClick={onClose}>x</button>
    </div>
  );
  const arrow = (title, onClick) => (
    <button type="button" className="atr-arrow" title={title} onClick={onClick}>-&gt;</button>
  );
  const range = (label, fromField, toField, type = "text", list) => (
    <div className="atr-range">
      <label>{label}</label><span>From</span>
      <SapInput type={type} list={list} value={criteria[fromField]} onChange={(event) => setField(fromField, event.target.value)} />
      <span>To</span>
      <SapInput type={type} list={list} value={criteria[toField]} onChange={(event) => setField(toField, event.target.value)} />
    </div>
  );

  const columns = useMemo(() => {
    if (reportKey === "transaction-by-projects") {
      return ["project", "posting", "transaction", "document", "entity", "account", "debit", "credit", "remarks"];
    }
    if (reportKey === "transactions-received-from-voucher") {
      return ["transaction", "voucher", "due", "remarks", "debit", "credit", "entity"];
    }
    if (reportKey === "document-journal") {
      return ["transaction", "posting", "series", "document", "entity", "account", "debit", "credit", "remarks"];
    }
    return ["posting", "series", "journal", "type", "transaction", "entity", "account", "debit", "credit", "remarks"];
  }, [reportKey]);
  const debitColumnIndex = columns.indexOf("debit");
  const trailingTotalColumns = columns.length - columns.indexOf("credit") - 1;

  const header = {
    project: "Project", posting: "Posting Date", due: "Due Date", series: "Series", journal: "Number",
    type: "Type", transaction: "Trans. #", voucher: "Journal Voucher No.", document: "Document",
    entity: "G/L Acct/BP Code", account: "G/L Account / Name", debit: "Debit", credit: "Credit", remarks: "Remarks",
  };

  const renderCell = (column, row) => {
    if (column === "posting" || column === "due") return formatDate(row[column === "posting" ? "postingDate" : "dueDate"]);
    if (column === "transaction") return <span className="atr-linked">{arrow("Open Journal Entry", () => openJournalEntry(row.transId))}<button type="button" onClick={() => openJournalEntry(row.transId)}>{row.transId}</button></span>;
    if (column === "document") return <span className="atr-linked">{arrow(`Open ${row.documentType}`, () => openSourceDocument(row))}<button type="button" onClick={() => openSourceDocument(row)}>{row.documentPrefix} {row.documentNumber}</button></span>;
    if (column === "entity") return <span className="atr-linked">{arrow(`Open ${row.entityType === "bp" ? "Business Partner" : "G/L Account"}`, () => openEntity(row))}<button type="button" onClick={() => openEntity(row)}>{row.entityCode}</button><small>{row.entityName}</small></span>;
    if (column === "account") return <span className="atr-linked">{arrow("Open G/L Account", () => openAccount(row.accountCode))}<button type="button" onClick={() => openAccount(row.accountCode)}>{row.accountCode}</button><small>{row.accountName}</small></span>;
    if (column === "debit" || column === "credit") return row[column] ? formatAmount(row[column]) : "";
    if (column === "project") return row.projectCode ? `${row.projectCode} - ${row.projectName}` : "";
    if (column === "voucher") return row.voucherNumber || "";
    if (column === "journal") return row.journalNumber;
    if (column === "type") return row.documentPrefix;
    return row[column] || "";
  };

  if (!definition) {
    return <div className="atr-unsupported">This financial accounting report is not configured yet.</div>;
  }

  return (
    <div className="atr-page sales-analysis-page sap-report-page">
      <section className={`atr-window atr-window--criteria sales-analysis-window sap-report-window${criteriaWindow.isMinimized ? " is-minimized" : ""}${criteriaWindow.isMaximized ? " is-maximized" : ""}`} {...criteriaWindow.windowProps}>
        <header className="sales-analysis-window__titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
          <span className="sap-report-title">{definition.title} - Selection Criteria</span>
          {controls(criteriaWindow, closeCriteria)}
        </header>
        <div className="sales-analysis-window__accent" />
        {!criteriaWindow.isMinimized ? <>
          <div className="atr-criteria sales-analysis-window__body">
            {reportKey === "transaction-journal" || reportKey === "document-journal" ? (
              <div className="atr-select-row">
                <label>Original Journal</label>
                <select value={criteria.originalJournal} onChange={(event) => setField("originalJournal", event.target.value)}>
                  {ORIGINAL_JOURNALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            ) : null}
            {reportKey === "transactions-received-from-voucher" ? (
              <div className="atr-select-row">
                <label>Journal Voucher No.</label>
                <select value={criteria.voucherNumber} onChange={(event) => setField("voucherNumber", event.target.value)}>
                  <option value="">Select voucher</option>
                  {lookups.vouchers.map((voucher) => <option key={voucher.code} value={voucher.code}>{voucher.code} ({voucher.recordCount} records)</option>)}
                </select>
              </div>
            ) : null}
            {range("Posting Date", "postingDateFrom", "postingDateTo", "date")}
            {reportKey === "transaction-by-projects" || reportKey === "document-journal" ? range("Due Date", "dueDateFrom", "dueDateTo", "date") : null}
            {reportKey === "transaction-by-projects" || reportKey === "document-journal" ? range("Document Date", "documentDateFrom", "documentDateTo", "date") : null}
            {reportKey !== "transaction-by-projects" ? range("Transaction No.", "transactionFrom", "transactionTo", "number") : null}
            {reportKey === "transaction-by-projects" ? range("Project", "projectFrom", "projectTo", "text", "atr-projects") : null}
            {reportKey === "transaction-by-projects" || AMOUNT_RANGE_REPORTS.has(reportKey) ? range("G/L Account", "accountFrom", "accountTo", "text", "atr-accounts") : null}
            {AMOUNT_RANGE_REPORTS.has(reportKey) ? range(reportKey === "journal-transaction-fc-amount-range" ? "FC Amount" : "Amount", "amountFrom", "amountTo", "number") : null}
            <div className="atr-select-row">
              <label>Display Currency</label>
              <select value={criteria.displayCurrency} onChange={(event) => setField("displayCurrency", event.target.value)}>
                <option value="local">Local Currency</option><option value="system">System Currency</option><option value="foreign">Foreign Currency</option>
              </select>
            </div>
            {reportKey === "transaction-journal" ? <button type="button" className="sap-report-btn atr-series-btn" onClick={() => setShowSeries((value) => !value)}>Series ({criteria.seriesCodes.length || "All"})</button> : null}
            {showSeries ? <div className="atr-series-list">{lookups.series.map((series) => <label key={series.code}><input type="checkbox" checked={criteria.seriesCodes.map(Number).includes(Number(series.code))} onChange={() => toggleSeries(series.code)} />{series.name || series.code}</label>)}</div> : null}
            {message ? <div className="atr-message">{message}</div> : null}
            <datalist id="atr-projects">{lookups.projects.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</datalist>
            <datalist id="atr-accounts">{lookups.accounts.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</datalist>
          </div>
          <footer className="atr-footer">
            <button type="button" className="sap-report-btn sap-report-btn--primary" onClick={runReport} disabled={loading}>{loading ? "Loading..." : "OK"}</button>
            <button type="button" className="sap-report-btn" onClick={() => { setCriteria(initialCriteria()); setReport(null); setMessage(""); }}>Cancel</button>
          </footer>
        </> : null}
      </section>

      {report ? <section className={`atr-window atr-window--report sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? " is-minimized" : ""}${reportWindow.isMaximized ? " is-maximized" : ""}`} {...reportWindow.windowProps}>
        <header className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
          <span className="sap-report-title">{definition.title}</span>{controls(reportWindow, () => setReport(null))}
        </header>
        <div className="sales-analysis-window__accent" />
        {!reportWindow.isMinimized ? <div className="atr-report-body sales-analysis-window__body--report">
          <div className="atr-report-toolbar"><strong>{definition.subtitle}</strong><span>{report.rows.length} rows</span></div>
          <div className="atr-grid-wrap sales-analysis-report__grid-wrap">
            <table className="atr-grid sales-analysis-report__grid"><thead><tr><th>#</th>{columns.map((column) => <th key={column}>{header[column]}</th>)}</tr></thead>
              <tbody>{report.rows.length ? report.rows.map((row) => <tr key={`${row.transId}-${row.lineId}`}><td>{row.rowNo}</td>{columns.map((column) => <td key={column} className={column === "debit" || column === "credit" ? "is-number" : ""}>{renderCell(column, row)}</td>)}</tr>) : <tr><td colSpan={columns.length + 1} className="atr-empty">No SAP B1 journal rows matched the selected criteria.</td></tr>}</tbody>
              <tfoot><tr>
                <td colSpan={debitColumnIndex + 1}>{report.totals.rowCount} rows</td>
                <td className="is-number">{formatAmount(report.totals.debit)}</td>
                <td className="is-number">{formatAmount(report.totals.credit)}</td>
                {trailingTotalColumns > 0 ? <td colSpan={trailingTotalColumns} /> : null}
              </tr></tfoot>
            </table>
          </div>
          <footer className="atr-report-footer"><button type="button" className="sales-analysis-report__back-btn" onClick={() => setReport(null)}>{"<"}</button></footer>
        </div> : null}
      </section> : null}
    </div>
  );
}

export default FinancialAccountingReportPage;
