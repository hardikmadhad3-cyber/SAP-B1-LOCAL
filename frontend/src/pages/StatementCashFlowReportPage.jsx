import SapDateInput from '../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchFinancialStatement, fetchFinancialStatementLookups } from "../api/financialStatementsApi";
import useFloatingWindow from "../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../components/SapWindowTaskbarContext";
import "../styles/sales-analysis-report.css";
import "../styles/statement-cash-flow-report.css";

const DATE_TYPES = [
  { code: "postingDate", name: "Posting Date" },
  { code: "dueDate", name: "Due Date" },
  { code: "documentDate", name: "Document Date" },
];

const TEMPLATE_FALLBACKS = [
  { code: "defaultCashFlow", name: "Default cash flow" },
  { code: "defaultDirect", name: "Default cash flow report (direct method)" },
  { code: "Temp001", name: "Temp001" },
];

const inputDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const fiscalPeriod = () => {
  const today = new Date();
  const startYear = today.getFullYear() - (today.getMonth() < 3 ? 1 : 0);
  return {
    actualFrom: inputDate(new Date(startYear, 3, 1)),
    actualTo: inputDate(new Date(startYear + 1, 2, 31)),
    previousFrom: inputDate(new Date(startYear - 1, 3, 1)),
    previousTo: inputDate(new Date(startYear, 2, 31)),
  };
};

const initialCriteria = () => {
  const period = fiscalPeriod();
  return {
    actualDateType: "postingDate",
    dateFrom: period.actualFrom,
    dateTo: period.actualTo,
    includePreviousPeriod: false,
    previousDateType: "postingDate",
    previousDateFrom: period.previousFrom,
    previousDateTo: period.previousTo,
    templateCode: "defaultCashFlow",
    displayLevel: 10,
  };
};

const formatDate = (value) => {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year.slice(2)}` : value;
};

const formatAmount = (value) => {
  const number = Number(value || 0);
  if (Math.abs(number) < 0.005) return "";
  return number.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const LEVEL_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);

function StatementCashFlowReportPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { company } = useAuth();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const [criteria, setCriteria] = useState(initialCriteria);
  const [templates, setTemplates] = useState(TEMPLATE_FALLBACKS);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 18,
    taskId: "statement-cash-flow-criteria",
    taskTitle: "Statement of Cash Flow Selection Criteria",
    taskPath: location.pathname,
    bounds: "parent",
  });
  const reportWindow = useFloatingWindow({
    isOpen: Boolean(report),
    defaultTop: 8,
    taskId: "statement-cash-flow-report",
    taskTitle: "Statement of Cash Flows",
    taskPath: location.pathname,
    bounds: "parent",
  });

  useEffect(() => {
    let mounted = true;
    fetchFinancialStatementLookups()
      .then((data) => {
        if (!mounted) return;
        const nextTemplates = data?.reportTemplates?.["statement-of-cash-flows"]?.length
          ? data.reportTemplates["statement-of-cash-flows"]
          : TEMPLATE_FALLBACKS;
        setTemplates(nextTemplates);
        setCriteria((current) => ({
          ...current,
          templateCode: nextTemplates.some((template) => template.code === current.templateCode)
            ? current.templateCode
            : nextTemplates[0]?.code || "",
        }));
      })
      .catch((error) => {
        if (mounted) setMessage(error?.response?.data?.message || "Could not load Statement of Cash Flow dropdown data.");
      });
    return () => { mounted = false; };
  }, []);

  const setField = (field, value) => {
    setCriteria((current) => ({ ...current, [field]: value }));
    setMessage("");
  };

  const controls = (frame, onClose) => (
    <div className="sales-analysis-window__controls">
      <button type="button" aria-label="Minimize" onClick={() => { frame.toggleMinimize(); navigate("/dashboard"); }}>-</button>
      <button type="button" aria-label="Restore" onClick={frame.toggleMaximize}>[]</button>
      <button type="button" aria-label="Close" onClick={onClose}>x</button>
    </div>
  );

  const closeCriteria = () => {
    if (!closeActiveAndRestorePrevious()) navigate("/dashboard");
  };

  const runReport = async () => {
    if (!criteria.dateFrom || !criteria.dateTo) {
      setMessage("Select the actual period date range.");
      return;
    }
    if (criteria.dateFrom > criteria.dateTo) {
      setMessage("Actual Period From date cannot be after To date.");
      return;
    }
    if (criteria.includePreviousPeriod && criteria.previousDateFrom > criteria.previousDateTo) {
      setMessage("Previous Period From date cannot be after To date.");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      setReport(await fetchFinancialStatement("statement-of-cash-flows", criteria));
    } catch (error) {
      setReport(null);
      setMessage(error?.response?.data?.message || error?.message || "Could not load Statement of Cash Flows.");
    } finally {
      setLoading(false);
    }
  };

  const resetCriteria = () => {
    setCriteria(initialCriteria());
    setReport(null);
    setMessage("");
  };

  const visibleRows = useMemo(() => {
    const level = Number(criteria.displayLevel || 10);
    return (report?.rows || []).filter((row) => Number(row.level || 0) <= level);
  }, [criteria.displayLevel, report?.rows]);

  const companyName = company?.companyName || company?.dbName || "Company";

  return (
    <div className="scf-page sales-analysis-page sap-report-page">
      <section
        className={`scf-window scf-window--criteria sales-analysis-window sap-report-window${criteriaWindow.isMinimized ? " is-minimized" : ""}${criteriaWindow.isMaximized ? " is-maximized" : ""}`}
        {...criteriaWindow.windowProps}
      >
        <header className="sales-analysis-window__titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
          <span className="sap-report-title">Statement of Cash Flow Selection Criteria</span>
          {controls(criteriaWindow, closeCriteria)}
        </header>
        <div className="sales-analysis-window__accent" />

        {!criteriaWindow.isMinimized ? (
          <>
            <div className="scf-criteria sales-analysis-window__body">
              <div className="scf-period-title">Actual Period</div>
              <div className="scf-date-row">
                <select value={criteria.actualDateType} onChange={(event) => setField("actualDateType", event.target.value)}>
                  {DATE_TYPES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                </select>
                <span>From</span>
                <SapDateInput  value={criteria.dateFrom} onChange={(event) => setField("dateFrom", event.target.value)} />
                <span>To</span>
                <SapDateInput  value={criteria.dateTo} onChange={(event) => setField("dateTo", event.target.value)} />
                <button type="button" className="scf-picker" aria-label="Open picker">=</button>
                <span>Template</span>
                <select className="scf-template" value={criteria.templateCode} onChange={(event) => setField("templateCode", event.target.value)}>
                  {templates.map((template) => <option key={template.code} value={template.code}>{template.name || template.code}</option>)}
                </select>
              </div>

              <div className="scf-divider" />
              <div className="scf-period-title">Previous Period</div>
              <div className="scf-date-row scf-date-row--previous">
                <input
                  aria-label="Enable Previous Period"
                  type="checkbox"
                  checked={criteria.includePreviousPeriod}
                  onChange={(event) => setField("includePreviousPeriod", event.target.checked)}
                />
                <select value={criteria.previousDateType} onChange={(event) => setField("previousDateType", event.target.value)}>
                  {DATE_TYPES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                </select>
                <span>From</span>
                <SapDateInput  value={criteria.previousDateFrom} onChange={(event) => setField("previousDateFrom", event.target.value)} />
                <span>To</span>
                <SapDateInput  value={criteria.previousDateTo} onChange={(event) => setField("previousDateTo", event.target.value)} />
                <button type="button" className="scf-picker" aria-label="Open picker">=</button>
              </div>

              {message ? <div className="scf-message">{message}</div> : null}
            </div>
            <footer className="scf-footer">
              <button type="button" className="sales-analysis__sap-btn" onClick={runReport} disabled={loading}>{loading ? "Loading..." : "OK"}</button>
              <button type="button" className="sales-analysis__sap-btn sales-analysis__sap-btn--secondary" onClick={resetCriteria}>Cancel</button>
            </footer>
          </>
        ) : null}
      </section>

      {report ? (
        <section
          className={`scf-window scf-window--report sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? " is-minimized" : ""}${reportWindow.isMaximized ? " is-maximized" : ""}`}
          {...reportWindow.windowProps}
        >
          <header className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
            <span className="sap-report-title">Statement of Cash Flows</span>
            {controls(reportWindow, () => setReport(null))}
          </header>
          <div className="sales-analysis-window__accent" />
          {!reportWindow.isMinimized ? (
            <div className="scf-report-body sales-analysis-window__body--report">
              <div className="scf-report-head">
                <label>Company</label>
                <input readOnly value={companyName} />
                <div className="scf-period-head">
                  <span>Actual Period</span>
                  <span>From</span>
                  <input readOnly value={formatDate(report.dateFrom)} />
                  <span>To</span>
                  <input readOnly value={formatDate(report.dateTo)} />
                </div>
              </div>
              <div className="scf-grid-wrap">
                <table className="scf-grid">
                  <thead>
                    <tr>
                      <th>Line Items</th>
                      <th>Line No.</th>
                      <th>Actual Period</th>
                      {criteria.includePreviousPeriod ? <th>Previous Period</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.key} className={`scf-row scf-row--${row.style || "normal"}`}>
                        <td style={{ paddingLeft: `${8 + Number(row.level || 0) * 24}px` }}>{row.label}</td>
                        <td>{row.lineNo}</td>
                        <td className="is-number">{formatAmount(row.actualPeriod)}</td>
                        {criteria.includePreviousPeriod ? <td className="is-number">{formatAmount(row.previousPeriod)}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="scf-result-footer">
                <button type="button" className="sales-analysis-report__back-btn" onClick={() => setReport(null)}>{"<"}</button>
                <label>
                  <span>Level</span>
                  <select value={criteria.displayLevel} onChange={(event) => setField("displayLevel", Number(event.target.value))}>
                    {LEVEL_OPTIONS.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </label>
              </footer>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default StatementCashFlowReportPage;
