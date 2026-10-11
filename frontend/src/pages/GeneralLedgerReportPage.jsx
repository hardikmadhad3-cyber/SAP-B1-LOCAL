import SapDateInput from '../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BusinessPartnerLookupModal from "../components/reports/BusinessPartnerLookupModal";
import GLAccountLookupModal from "../components/reports/GLAccountLookupModal";
import PropertiesSelectionModal from "../components/reports/PropertiesSelectionModal";
import useFloatingWindow from "../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../components/SapWindowTaskbarContext";
import { fetchGeneralLedgerLookups, fetchGeneralLedgerReport } from "../api/generalLedgerApi";
import "../styles/sales-analysis-report.css";
import "../styles/inventory-audit-report.css";
import "../styles/general-ledger-report.css";

const REPORT_PATH = "/reports/financial/accounting/general-ledger";
const DEFAULT_ACCOUNT_GROUPS = [
  { groupMask: 1, code: "1", name: "Asset" },
  { groupMask: 2, code: "2", name: "Liability" },
  { groupMask: 3, code: "3", name: "Equity" },
  { groupMask: 4, code: "4", name: "Revenue" },
  { groupMask: 5, code: "5", name: "Expenditure" },
];
const DEFAULT_BP_PROPERTIES = Array.from({ length: 64 }, (_, index) => ({
  number: index + 1,
  name: `Business Partners Property ${index + 1}`,
}));

const toInputDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const createInitialState = () => {
  const today = new Date();
  const fiscalStart = new Date(today.getFullYear() - (today.getMonth() < 3 ? 1 : 0), 3, 1);
  return {
    includeBusinessPartners: true,
    includeAccounts: true,
    bpCodeFrom: "",
    bpCodeTo: "",
    customerGroup: "All",
    vendorGroup: "All",
    propertyFilter: {
      ignoreProperties: true,
      linkMode: "and",
      exactlyMatch: false,
      selectedPropertyNumbers: [],
    },
    selectedAccountGroupMasks: DEFAULT_ACCOUNT_GROUPS.map((group) => group.groupMask),
    accountFindGroup: "1",
    controlAccountsOnly: false,
    selectedControlAccountCodes: [],
    dateRanges: {
      postingDate: { enabled: true, from: toInputDate(fiscalStart), to: toInputDate(today) },
      dueDate: { enabled: false, from: toInputDate(fiscalStart), to: toInputDate(today) },
      documentDate: { enabled: false, from: toInputDate(fiscalStart), to: toInputDate(today) },
    },
    openingBalanceForPeriod: true,
    hideZeroBalancedAccounts: false,
    hideAccountsWithNoPostings: true,
    displayCurrency: "local",
  };
};

const formatAmount = (value) =>
  Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("en-GB");
};

const renderWindowControls = (windowFrame, onMinimize, onClose) => (
  <div className="sales-analysis-window__controls">
    <button type="button" aria-label={windowFrame.isMinimized ? "Restore" : "Minimize"} onClick={onMinimize}>-</button>
    <button type="button" aria-label={windowFrame.isMaximized ? "Restore Down" : "Restore"} onClick={windowFrame.toggleMaximize}>[]</button>
    <button type="button" aria-label="Close" onClick={onClose}>x</button>
  </div>
);

function GeneralLedgerReportPage() {
  const navigate = useNavigate();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const [formState, setFormState] = useState(createInitialState);
  const [lookups, setLookups] = useState({
    accountGroups: DEFAULT_ACCOUNT_GROUPS,
    accounts: [],
    controlAccounts: [],
    customerGroups: [{ code: "All", name: "All" }],
    vendorGroups: [{ code: "All", name: "All" }],
  });
  const [lookupTarget, setLookupTarget] = useState("");
  const [showProperties, setShowProperties] = useState(false);
  const [showControlAccounts, setShowControlAccounts] = useState(false);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 12,
    taskId: "general-ledger-criteria",
    taskTitle: "General Ledger - Selection Criteria",
    taskPath: REPORT_PATH,
    bounds: "parent",
  });
  const reportWindow = useFloatingWindow({
    isOpen: Boolean(report),
    defaultTop: 8,
    taskId: "general-ledger-report",
    taskTitle: "General Ledger",
    taskPath: REPORT_PATH,
    bounds: "parent",
  });

  useEffect(() => {
    let ignore = false;
    fetchGeneralLedgerLookups()
      .then((response) => {
        if (ignore) return;
        const accountGroups = response?.accountGroups?.length ? response.accountGroups : DEFAULT_ACCOUNT_GROUPS;
        setLookups({
          accountGroups,
          accounts: response?.accounts || [],
          controlAccounts: response?.controlAccounts || [],
          customerGroups: response?.customerGroups?.length ? response.customerGroups : [{ code: "All", name: "All" }],
          vendorGroups: response?.vendorGroups?.length ? response.vendorGroups : [{ code: "All", name: "All" }],
        });
        setFormState((current) => ({
          ...current,
          selectedAccountGroupMasks: accountGroups.map((group) => Number(group.groupMask)).filter(Boolean),
          accountFindGroup: String(accountGroups[0]?.groupMask || 1),
        }));
      })
      .catch((error) => {
        if (!ignore) setMessage(error?.response?.data?.message || "Could not load General Ledger lookups.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  const selectedAccountGroups = useMemo(
    () => new Set((formState.selectedAccountGroupMasks || []).map(Number)),
    [formState.selectedAccountGroupMasks],
  );

  const setField = (field, value) => {
    setFormState((current) => ({ ...current, [field]: value }));
    setMessage("");
  };

  const setDateRange = (key, field, value) => {
    setFormState((current) => ({
      ...current,
      dateRanges: {
        ...current.dateRanges,
        [key]: { ...current.dateRanges[key], [field]: value },
      },
    }));
    setMessage("");
  };

  const toggleAccountGroup = (groupMask) => {
    if (!formState.includeAccounts) return;
    setFormState((current) => {
      const next = new Set((current.selectedAccountGroupMasks || []).map(Number));
      if (next.has(Number(groupMask))) next.delete(Number(groupMask));
      else next.add(Number(groupMask));
      return { ...current, selectedAccountGroupMasks: [...next].sort((a, b) => a - b) };
    });
  };

  const handleFindAccountGroup = () => {
    const groupMask = Number(formState.accountFindGroup || 0);
    if (!groupMask) return;
    setFormState((current) => ({
      ...current,
      selectedAccountGroupMasks: [...new Set([...(current.selectedAccountGroupMasks || []), groupMask])].sort((a, b) => a - b),
    }));
  };

  const handleBpSelect = (row) => {
    if (!lookupTarget) return;
    setField(lookupTarget, row?.CardCode || "");
    setLookupTarget("");
  };

  const runReport = async () => {
    if (!formState.includeBusinessPartners && !formState.includeAccounts) {
      setMessage("Select Business Partner or Accounts to run the report.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      setReport(await fetchGeneralLedgerReport(formState));
    } catch (error) {
      setReport(null);
      setMessage(error?.response?.data?.message || error?.message || "Could not load General Ledger report.");
    } finally {
      setLoading(false);
    }
  };

  const closeCriteria = () => {
    if (closeActiveAndRestorePrevious()) return;
    navigate("/dashboard");
  };

  const openEntity = (code, type) => {
    if (!code) return;
    navigate(type === "bp"
      ? `/business-partner?cardCode=${encodeURIComponent(code)}`
      : `/chart-of-accounts?accountCode=${encodeURIComponent(code)}`);
  };

  const openJournalEntry = (transId) => {
    if (!transId) return;
    navigate("/journal-entry", { state: { journalEntryTransId: transId } });
  };

  const sourceDocumentRoute = (row) => {
    const docEntry = Number(row?.sourceDocEntry || 0);
    const routes = {
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
    if (Number(row?.transType) === 30 || !routes[row?.transType] || !docEntry) {
      openJournalEntry(row?.transId);
      return;
    }
    const [path, stateKey] = routes[row.transType];
    navigate(path, { state: { [stateKey]: docEntry } });
  };

  const groupedRows = useMemo(() => {
    const result = [];
    let previousEntity = "";
    (report?.rows || []).forEach((row) => {
      if (row.entityCode !== previousEntity) {
        result.push({ kind: "group", ...row });
        previousEntity = row.entityCode;
      }
      result.push({ kind: "row", ...row });
    });
    return result;
  }, [report]);
  const currencyLabel = report?.displayCurrency === "system" ? "SC" : report?.displayCurrency === "foreign" ? "FC" : "LC";

  const renderArrowButton = (title, onClick) => (
    <button type="button" className="glr-golden-arrow" title={title} onClick={onClick}>-&gt;</button>
  );

  return (
    <div className="glr-page sales-analysis-page sap-report-page">
      <section
        className={`glr-window glr-window--criteria sales-analysis-window sap-report-window${criteriaWindow.isMinimized ? " is-minimized" : ""}${criteriaWindow.isMaximized ? " is-maximized" : ""}`}
        {...criteriaWindow.windowProps}
      >
        <header className="sales-analysis-window__titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
          <span className="sales-analysis-window__title sap-report-title">General Ledger - Selection Criteria</span>
          {renderWindowControls(criteriaWindow, () => {
            criteriaWindow.toggleMinimize();
            navigate("/dashboard");
          }, closeCriteria)}
        </header>
        <div className="sales-analysis-window__accent sap-report-accent" />
        {!criteriaWindow.isMinimized ? (
          <>
            <div className="glr-criteria-body sales-analysis-window__body">
              <div className="glr-criteria-top">
                <div className="glr-left">
                  <label className="glr-check"><input type="checkbox" checked={formState.includeBusinessPartners} onChange={(event) => setField("includeBusinessPartners", event.target.checked)} /><span>Business Partner</span></label>
                  <div className={`glr-code-row${!formState.includeBusinessPartners ? " is-disabled" : ""}`}>
                    <span>Code</span><span>From</span>
                    <div className="glr-lookup"><input value={formState.bpCodeFrom} disabled={!formState.includeBusinessPartners} onChange={(event) => setField("bpCodeFrom", event.target.value)} /><button type="button" disabled={!formState.includeBusinessPartners} onClick={() => setLookupTarget("bpCodeFrom")}>...</button></div>
                    <span>To</span>
                    <div className="glr-lookup"><input value={formState.bpCodeTo} disabled={!formState.includeBusinessPartners} onChange={(event) => setField("bpCodeTo", event.target.value)} /><button type="button" disabled={!formState.includeBusinessPartners} onClick={() => setLookupTarget("bpCodeTo")}>...</button></div>
                  </div>
                  <div className="glr-select-row"><label>Customer Group</label><select value={formState.customerGroup} disabled={!formState.includeBusinessPartners} onChange={(event) => setField("customerGroup", event.target.value)}>{lookups.customerGroups.map((group) => <option key={`c-${group.code}`} value={group.code}>{group.name}</option>)}</select></div>
                  <div className="glr-select-row"><label>Vendor Group</label><select value={formState.vendorGroup} disabled={!formState.includeBusinessPartners} onChange={(event) => setField("vendorGroup", event.target.value)}>{lookups.vendorGroups.map((group) => <option key={`v-${group.code}`} value={group.code}>{group.name}</option>)}</select></div>
                  <div className="glr-properties-row"><button type="button" className="sap-report-btn" disabled={!formState.includeBusinessPartners} onClick={() => setShowProperties(true)}>Properties</button><input readOnly value={formState.propertyFilter.ignoreProperties ? "Ignore" : `${formState.propertyFilter.selectedPropertyNumbers.length} Selected`} /></div>
                  <label className="glr-control-line">
                    <input type="checkbox" checked={formState.controlAccountsOnly} onChange={(event) => setField("controlAccountsOnly", event.target.checked)} />
                    <span>Control Accts</span>
                    <button type="button" className="glr-lookup-btn" disabled={!formState.controlAccountsOnly} title="Account Selection" onClick={() => setShowControlAccounts(true)}>...</button>
                    <span className="glr-control-count">{formState.selectedControlAccountCodes.length ? `${formState.selectedControlAccountCodes.length} selected` : ""}</span>
                  </label>
                </div>

                <div className="glr-right">
                  <div className="glr-account-toolbar">
                    <label className="glr-check"><input type="checkbox" checked={formState.includeAccounts} onChange={(event) => setField("includeAccounts", event.target.checked)} /><span>Accounts</span></label>
                    <button type="button" className="sap-report-btn" disabled={!formState.includeAccounts} onClick={handleFindAccountGroup}>Find</button>
                    <select value={formState.accountFindGroup} disabled={!formState.includeAccounts} onChange={(event) => setField("accountFindGroup", event.target.value)}>{lookups.accountGroups.map((group) => <option key={group.groupMask} value={group.groupMask}>{group.code}</option>)}</select>
                  </div>
                  <div className={`glr-account-groups${!formState.includeAccounts ? " is-disabled" : ""}`}>
                    <table><thead><tr><th>#</th><th>x</th><th>Account</th></tr></thead><tbody>
                      {lookups.accountGroups.map((group) => <tr key={group.groupMask} onClick={() => toggleAccountGroup(group.groupMask)} className={selectedAccountGroups.has(Number(group.groupMask)) ? "is-selected" : ""}><td>{group.code}</td><td>{selectedAccountGroups.has(Number(group.groupMask)) ? "x" : ""}</td><td><span className="glr-small-arrow">-&gt;</span>{group.name}</td></tr>)}
                    </tbody></table>
                  </div>
                </div>
              </div>

              <div className="glr-divider" />
              <div className="glr-date-grid">
                <strong>Selection</strong><strong>From</strong><strong>To</strong>
                {[
                  ["postingDate", "Posting Date"],
                  ["dueDate", "Due Date"],
                  ["documentDate", "Document Date"],
                ].map(([key, label]) => <React.Fragment key={key}>
                  <label className="glr-check"><input type="checkbox" checked={formState.dateRanges[key].enabled} onChange={(event) => setDateRange(key, "enabled", event.target.checked)} /><span>{label}</span></label>
                  <SapDateInput  value={formState.dateRanges[key].from} disabled={!formState.dateRanges[key].enabled} onChange={(event) => setDateRange(key, "from", event.target.value)} />
                  <SapDateInput  value={formState.dateRanges[key].to} disabled={!formState.dateRanges[key].enabled} onChange={(event) => setDateRange(key, "to", event.target.value)} />
                </React.Fragment>)}
              </div>
              <div className="glr-divider" />
              <div className="glr-options">
                <label className="glr-check"><input type="checkbox" checked={formState.openingBalanceForPeriod} onChange={(event) => setField("openingBalanceForPeriod", event.target.checked)} /><span>Opening Balance for Period</span></label>
                <label className="glr-check"><input type="checkbox" checked={formState.hideZeroBalancedAccounts} onChange={(event) => setField("hideZeroBalancedAccounts", event.target.checked)} /><span>Hide Zero Balanced Acct</span></label>
                <label className="glr-check"><input type="checkbox" checked={formState.hideAccountsWithNoPostings} onChange={(event) => setField("hideAccountsWithNoPostings", event.target.checked)} /><span>Hide Acct with no Postings</span></label>
                <label className="glr-display">Display<select value={formState.displayCurrency} onChange={(event) => setField("displayCurrency", event.target.value)}><option value="local">Local Currency</option><option value="system">System Currency</option><option value="foreign">Foreign Currency</option></select></label>
              </div>
              {message ? <div className="glr-message">{message}</div> : null}
            </div>
            <footer className="glr-criteria-footer">
              <div><button type="button" className="sap-report-btn sap-report-btn--primary" disabled={loading} onClick={runReport}>{loading ? "Loading..." : "OK"}</button><button type="button" className="sap-report-btn" disabled={loading} onClick={() => { setFormState(createInitialState()); setReport(null); setMessage(""); }}>Cancel</button></div>
              <button type="button" className="sap-report-btn" onClick={() => setField("selectedAccountGroupMasks", lookups.accountGroups.map((group) => Number(group.groupMask)))}>Select All</button>
            </footer>
          </>
        ) : null}
      </section>

      {report ? (
        <section className={`glr-window glr-window--report sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? " is-minimized" : ""}${reportWindow.isMaximized ? " is-maximized" : ""}`} {...reportWindow.windowProps}>
          <header className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
            <span className="sales-analysis-window__title sap-report-title">General Ledger</span>
            {renderWindowControls(reportWindow, () => {
              reportWindow.toggleMinimize();
              navigate("/dashboard");
            }, () => setReport(null))}
          </header>
          <div className="sales-analysis-window__accent sap-report-accent" />
          {!reportWindow.isMinimized ? <>
            <div className="glr-report-toolbar"><span>Display subtotal</span><label><input type="checkbox" /> Daily</label><label><input type="checkbox" /> Monthly</label><label><input type="checkbox" defaultChecked /> Yearly</label></div>
            <div className="glr-grid-wrap sales-analysis-report__grid-wrap">
              <table className="glr-grid sales-analysis-report__grid">
                <thead><tr><th>Posting Date</th><th>Due Date</th><th>Series</th><th>Doc. No.</th><th>Trans. No.</th><th>Remarks</th><th>Offset Acct</th><th>Offset Acct Name</th><th>Debit ({currencyLabel})</th><th>Credit ({currencyLabel})</th><th>Cumulative Balance ({currencyLabel})</th><th>Remarks1 (Header)</th></tr></thead>
                <tbody>
                  {groupedRows.length ? groupedRows.map((row, index) => row.kind === "group" ? (
                    <tr className="glr-group-row" key={`group-${row.entityCode}-${index}`}><td colSpan={12}><strong>{row.entityType === "bp" ? (row.cardType === "S" ? "Vendor" : "Customer") : "Account"}</strong><span className="glr-group-code">{renderArrowButton(`Open ${row.entityType === "bp" ? "Business Partner" : "G/L Account"}`, () => openEntity(row.entityCode, row.entityType))}{row.entityCode}</span><span>{row.entityName}</span></td></tr>
                  ) : (
                    <tr key={`${row.transId}-${row.lineId}-${index}`}>
                      <td><span className="glr-drill-cell">{renderArrowButton("Open Journal Entry", () => openJournalEntry(row.transId))}{formatDate(row.postingDate)}</span></td>
                      <td>{formatDate(row.dueDate)}</td><td>{row.series}</td>
                      <td><span className="glr-drill-cell">{renderArrowButton(`Open ${row.documentTypeLabel}`, () => sourceDocumentRoute(row))}{row.formattedDocumentNumber}</span></td>
                      <td>{row.transId}</td><td title={row.remarks}>{row.remarks}</td>
                      <td>{row.offsetCode ? <span className="glr-drill-cell">{renderArrowButton("Open Offset Account", () => openEntity(row.offsetCode, row.offsetType))}{row.offsetCode}</span> : ""}</td>
                      <td>{row.offsetName}</td><td className="is-numeric">{row.debit ? formatAmount(row.debit) : ""}</td><td className="is-numeric">{row.credit ? formatAmount(row.credit) : ""}</td><td className="is-numeric">{formatAmount(row.cumulativeBalance)}</td><td>{row.headerRemarks}</td>
                    </tr>
                  )) : <tr><td colSpan={12} className="sales-analysis-report__empty">No General Ledger postings found.</td></tr>}
                </tbody>
                <tfoot><tr><td colSpan={8}>Total</td><td className="is-numeric">{formatAmount(report.totals?.debit)}</td><td className="is-numeric">{formatAmount(report.totals?.credit)}</td><td colSpan={2} /></tr></tfoot>
              </table>
            </div>
            <div className="sales-analysis-report__footer"><button type="button" className="sales-analysis-report__back-btn" aria-label="Back to selection criteria" onClick={() => setReport(null)}>&lt;</button></div>
          </> : null}
        </section>
      ) : null}

      <BusinessPartnerLookupModal isOpen={Boolean(lookupTarget)} onClose={() => setLookupTarget("")} onSelect={handleBpSelect} type="" />
      <PropertiesSelectionModal isOpen={showProperties} onClose={() => setShowProperties(false)} onSave={(propertyFilter) => setField("propertyFilter", propertyFilter)} title="Properties" propertyLabelPrefix="Business Partners Property" properties={DEFAULT_BP_PROPERTIES} value={formState.propertyFilter} />
      <GLAccountLookupModal isOpen={showControlAccounts} accounts={lookups.controlAccounts} selectedCodes={formState.selectedControlAccountCodes} onClose={() => setShowControlAccounts(false)} onSave={(codes) => setField("selectedControlAccountCodes", codes)} title="Account Selection" />
    </div>
  );
}

export default GeneralLedgerReportPage;
