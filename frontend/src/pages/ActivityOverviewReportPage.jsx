import SapDateInput from '../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import BusinessPartnerLookupModal from "../components/reports/BusinessPartnerLookupModal";
import PropertiesSelectionModal from "../components/reports/PropertiesSelectionModal";
import useFloatingWindow from "../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../components/SapWindowTaskbarContext";
import {
  fetchActivityOverviewEmployees,
  fetchActivityOverviewLookups,
  fetchActivityOverviewRecipientLists,
  fetchActivityOverviewUserDefinedFields,
  fetchActivityOverviewUsers,
  runActivityOverviewReport,
} from "../api/activityOverviewApi";
import "../styles/sales-analysis-report.css";
import "../styles/crm-report.css";
import "../styles/activity-overview-report.css";

const DEFAULT_LOOKUPS = {
  activities: [
    { value: "All Activities", label: "All Activities" },
    { value: "C", label: "Phone Call" },
    { value: "M", label: "Meeting" },
    { value: "T", label: "Task" },
    { value: "N", label: "Note" },
    { value: "E", label: "Campaign" },
    { value: "P", label: "Other" },
  ],
  sourceTypes: [
    { value: "All Types", label: "All Types" },
    { value: "Business Partner", label: "Business Partner" },
    { value: "Contact Person", label: "Contact Person" },
    { value: "User", label: "User" },
    { value: "Employee", label: "Employee" },
  ],
  customerGroups: [{ value: "All", label: "All" }],
  vendorGroups: [{ value: "All", label: "All" }],
  activityTypes: [{ value: "All Types", label: "All Types" }],
  subjects: [{ value: "All Subjects", label: "All Subjects" }],
  meetingLocations: [{ value: "All Locations", label: "All Locations" }],
};

const INITIAL_FORM = {
  bpFrom: "",
  bpTo: "",
  users: [],
  userNames: [],
  employees: [],
  employeeNames: [],
  recipientLists: [],
  recipientListNames: [],
  customerGroup: "All",
  vendorGroup: "All",
  contactPerson: "All",
  propertyMode: "Ignore",
  propertyFilter: {
    ignoreProperties: true,
    linkMode: "and",
    exactlyMatch: false,
    selectedPropertyNumbers: [],
  },
  activity: "All Activities",
  sourceType: "All Types",
  activityType: "All Types",
  meetingLocation: "All Locations",
  subject: "All Subjects",
  remarks: "",
  startDateFrom: "",
  startDateTo: "",
  closeDateFrom: "",
  closeDateTo: "",
  userDefinedFields: [],
  displayScheduledServiceCalls: false,
  displayOnlyOpen: true,
};

const DEFAULT_BP_PROPERTIES = Array.from({ length: 64 }, (_, index) => ({
  number: index + 1,
  name: `Business Partners Property ${index + 1}`,
}));

const REPORT_COLUMNS = [
  { key: "number", label: "Number", width: "78px", linked: true },
  { key: "startDate", label: "Start Date", width: "110px" },
  { key: "startTime", label: "Start Time", width: "90px" },
  { key: "handledBy", label: "Handled By", width: "108px" },
  { key: "activity", label: "Activity", width: "104px" },
  { key: "recurrence", label: "Recurrence", width: "104px" },
  { key: "bpName", label: "BP Name", width: "360px", linked: true },
  { key: "contactPerson", label: "Contact Person", width: "210px", linked: true },
  { key: "status", label: "Status", width: "100px" },
  { key: "remarks", label: "Remarks", width: "490px" },
  { key: "assignedBy", label: "Assigned By", width: "130px" },
];

const asOptions = (items = [], fallback) => {
  const rows = Array.isArray(items) ? items : [];
  return rows.length ? rows : fallback;
};

const optionValue = (option) => String(option.value ?? option.code ?? option.label ?? option.name ?? "");
const optionLabel = (option) => String(option.label ?? option.name ?? option.value ?? option.code ?? "");

function SelectLookupModal({
  isOpen,
  title,
  columns,
  fetchRows,
  onClose,
  onApply,
  initialSelected = [],
  emptyMessage = "No records found.",
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(new Set(initialSelected));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const windowFrame = useFloatingWindow({ isOpen, defaultTop: 56 });

  const loadRows = async (search = "") => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchRows(search);
      setRows(Array.isArray(result) ? result : []);
    } catch (loadError) {
      setRows([]);
      setError(loadError?.response?.data?.message || loadError?.message || "Could not load lookup records.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) {
      setRows([]);
      setQuery("");
      setError("");
      return;
    }
    setSelected(new Set(initialSelected));
    loadRows("");
  }, [isOpen, initialSelected.join("|")]);

  const normalizedRows = useMemo(
    () => rows.map((row, index) => ({ ...row, rowNo: index + 1, code: String(row.code ?? row.id ?? index) })),
    [rows]
  );

  const toggleRow = (row) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.code)) next.delete(row.code);
      else next.add(row.code);
      return next;
    });
  };

  const handleOk = () => {
    const selectedRows = normalizedRows.filter((row) => selected.has(row.code));
    onApply(selectedRows);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="activity-lookup-modal__backdrop" onClick={onClose}>
      <div
        className="activity-lookup-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        {...windowFrame.windowProps}
      >
        <div className="activity-lookup-modal__titlebar" {...windowFrame.titleBarProps}>
          <div className="activity-lookup-modal__title">{title}</div>
          <div className="activity-lookup-modal__controls">
            <button type="button" aria-label={windowFrame.isMinimized ? "Restore" : "Minimize"} onClick={windowFrame.toggleMinimize}>
              {windowFrame.isMinimized ? "[]" : "-"}
            </button>
            <button type="button" aria-label="Restore" onClick={windowFrame.restoreWindow}>[]</button>
            <button type="button" aria-label="Close" onClick={onClose}>x</button>
          </div>
        </div>
        <div className="activity-lookup-modal__accent" />

        {!windowFrame.isMinimized ? (
          <>
            <div className="activity-lookup-modal__body">
              <div className="activity-lookup-modal__toolbar">
                <label htmlFor={`${title}-find`}>Find</label>
                <input
                  id={`${title}-find`}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      loadRows(query);
                    }
                  }}
                  autoFocus
                />
              </div>

              <div className="activity-lookup-modal__grid-wrap">
                <table className="activity-lookup-modal__grid">
                  <thead>
                    <tr>
                      <th className="is-index">#</th>
                      {columns.map((column) => (
                        <th key={column.key} style={{ width: column.width }}>{column.label}</th>
                      ))}
                      <th className="is-select">Select</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={columns.length + 2} className="activity-lookup-modal__state">Loading...</td></tr>
                    ) : error ? (
                      <tr><td colSpan={columns.length + 2} className="activity-lookup-modal__state is-error">{error}</td></tr>
                    ) : normalizedRows.length ? (
                      normalizedRows.map((row) => (
                        <tr key={row.code} className={selected.has(row.code) ? "is-selected" : ""} onClick={() => toggleRow(row)}>
                          <td className="is-index">{row.rowNo}</td>
                          {columns.map((column) => (
                            <td key={column.key}>{row[column.key] ?? ""}</td>
                          ))}
                          <td className="is-select">
                            <input type="checkbox" checked={selected.has(row.code)} onChange={() => toggleRow(row)} onClick={(event) => event.stopPropagation()} />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={columns.length + 2} className="activity-lookup-modal__state">{emptyMessage}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="activity-lookup-modal__footer">
              <button type="button" className="activity-lookup-modal__action-btn" onClick={handleOk}>OK</button>
              <button type="button" className="activity-lookup-modal__action-btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ActivityOverviewReportPage() {
  const navigate = useNavigate();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const [form, setForm] = useState(INITIAL_FORM);
  const [lookups, setLookups] = useState(DEFAULT_LOOKUPS);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [bpTarget, setBpTarget] = useState("");
  const [selectLookup, setSelectLookup] = useState("");
  const [showProperties, setShowProperties] = useState(false);

  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 18,
    taskId: "activity-overview-criteria",
    taskTitle: "Activity Overview - Selection Criteria",
    taskPath: "/reports/crm/activities-overview",
    bounds: "parent",
  });
  const reportWindow = useFloatingWindow({
    isOpen: Boolean(report),
    defaultTop: 8,
    taskId: "activity-overview-report",
    taskTitle: "Activities Overview",
    taskPath: "/reports/crm/activities-overview",
    bounds: "parent",
  });

  useEffect(() => {
    let ignore = false;
    fetchActivityOverviewLookups()
      .then((data) => {
        if (!ignore) {
          setLookups({
            activities: asOptions(data.activities, DEFAULT_LOOKUPS.activities),
            sourceTypes: asOptions(data.sourceTypes, DEFAULT_LOOKUPS.sourceTypes),
            customerGroups: asOptions(data.customerGroups, DEFAULT_LOOKUPS.customerGroups),
            vendorGroups: asOptions(data.vendorGroups, DEFAULT_LOOKUPS.vendorGroups),
            activityTypes: asOptions(data.activityTypes, DEFAULT_LOOKUPS.activityTypes),
            subjects: asOptions(data.subjects, DEFAULT_LOOKUPS.subjects),
            meetingLocations: asOptions(data.meetingLocations, DEFAULT_LOOKUPS.meetingLocations),
          });
        }
      })
      .catch(() => {
        if (!ignore) setLookups(DEFAULT_LOOKUPS);
      });
    return () => { ignore = true; };
  }, []);

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const handleCloseCriteria = () => {
    if (closeActiveAndRestorePrevious()) return;
    navigate("/dashboard");
  };

  const handleRun = async () => {
    setLoading(true);
    setStatus("");
    try {
      const result = await runActivityOverviewReport(form);
      setReport(result);
    } catch (error) {
      setStatus(error?.response?.data?.message || "Could not load Activities Overview.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm(INITIAL_FORM);
    setReport(null);
    setStatus("");
  };

  const handlePropertiesSave = (propertyFilter) => {
    const selectedCount = Array.isArray(propertyFilter.selectedPropertyNumbers)
      ? propertyFilter.selectedPropertyNumbers.length
      : 0;
    setForm((current) => ({
      ...current,
      propertyFilter,
      propertyMode: propertyFilter.ignoreProperties || !selectedCount ? "Ignore" : "Use",
    }));
  };

  const handleBpSelect = (row) => {
    if (!bpTarget) return;
    updateField(bpTarget, row.CardCode || "");
    setBpTarget("");
  };

  const openBusinessPartner = (row) => {
    const code = String(row?.bpCode || "").trim();
    if (!code) return;
    navigate(`/business-partner?cardCode=${encodeURIComponent(code)}`);
  };

  const openActivity = (row) => {
    const number = String(row?.number || "").trim();
    if (!number) return;
    navigate(`/activity?activityNo=${encodeURIComponent(number)}`);
  };

  const selectionSummary = (names, empty = "") => {
    if (!names.length) return empty;
    if (names.length === 1) return names[0];
    return `${names.length} selected`;
  };

  const selectConfigs = {
    users: {
      title: "Users",
      columns: [
        { key: "name", label: "User Name", width: "160px" },
        { key: "department", label: "Department", width: "150px" },
        { key: "branch", label: "Branch", width: "140px" },
      ],
      fetchRows: fetchActivityOverviewUsers,
      selected: form.users,
      onApply: (rows) => setForm((current) => ({ ...current, users: rows.map((row) => row.code), userNames: rows.map((row) => row.name) })),
    },
    employees: {
      title: "Employees",
      columns: [
        { key: "name", label: "Employee Name", width: "180px" },
        { key: "department", label: "Department", width: "150px" },
        { key: "branch", label: "Branch", width: "140px" },
      ],
      fetchRows: fetchActivityOverviewEmployees,
      selected: form.employees,
      onApply: (rows) => setForm((current) => ({ ...current, employees: rows.map((row) => row.code), employeeNames: rows.map((row) => row.name) })),
    },
    recipientLists: {
      title: "Recipient Lists",
      columns: [{ key: "name", label: "Recipient List", width: "300px" }],
      fetchRows: fetchActivityOverviewRecipientLists,
      selected: form.recipientLists,
      onApply: (rows) => setForm((current) => ({ ...current, recipientLists: rows.map((row) => row.code), recipientListNames: rows.map((row) => row.name) })),
    },
    userDefinedFields: {
      title: "User-Defined Fields",
      columns: [
        { key: "name", label: "Field", width: "360px" },
        { key: "rule", label: "Rule", width: "190px" },
        { key: "value", label: "Value", width: "170px" },
        { key: "toValue", label: "To Value", width: "170px" },
      ],
      fetchRows: fetchActivityOverviewUserDefinedFields,
      selected: form.userDefinedFields,
      onApply: (rows) => setForm((current) => ({ ...current, userDefinedFields: rows.map((row) => row.code) })),
    },
  };
  const activeSelectConfig = selectConfigs[selectLookup];

  const renderSelect = (field, options) => (
    <select value={form[field]} onChange={(event) => updateField(field, event.target.value)}>
      {options.map((option) => (
        <option key={`${field}-${optionValue(option)}`} value={optionValue(option)}>
          {optionLabel(option)}
        </option>
      ))}
    </select>
  );

  const rows = Array.isArray(report?.rows) ? report.rows : [];
  const fillerRows = Array.from({ length: Math.max(0, 32 - rows.length) }, (_, index) => index);

  const renderCriteria = () => (
    <div
      className={`sales-analysis-window activity-overview-window sap-report-window${criteriaWindow.isMinimized ? " is-minimized" : ""}${criteriaWindow.isMaximized ? " is-maximized" : ""}`}
      {...criteriaWindow.windowProps}
      style={criteriaWindow.windowProps?.style}
    >
      <div className="sales-analysis-window__titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
        <div className="sales-analysis-window__title sap-report-title">Activity Overview - Selection Criteria</div>
        <div className="sales-analysis-window__controls">
          <button type="button" aria-label={criteriaWindow.isMinimized ? "Restore" : "Minimize"} onClick={() => { criteriaWindow.toggleMinimize(); navigate("/dashboard"); }}>
            {criteriaWindow.isMinimized ? "[]" : "-"}
          </button>
          <button type="button" aria-label={criteriaWindow.isMaximized ? "Restore" : "Maximize"} onClick={criteriaWindow.toggleMaximize}>[]</button>
          <button type="button" aria-label="Close" onClick={handleCloseCriteria}>x</button>
        </div>
      </div>
      <div className="sales-analysis-window__accent" />

      {!criteriaWindow.isMinimized ? (
        <div className="sales-analysis-window__body activity-overview-criteria">
          <div className="activity-overview-grid">
            <label>BP Code</label>
            <span className="activity-overview-from">From</span>
            <div className="activity-overview-lookup-input">
              <input value={form.bpFrom} onChange={(event) => updateField("bpFrom", event.target.value)} />
              <button type="button" onClick={() => setBpTarget("bpFrom")}>...</button>
            </div>
            <span className="activity-overview-to">To</span>
            <div className="activity-overview-lookup-input">
              <input value={form.bpTo} onChange={(event) => updateField("bpTo", event.target.value)} />
              <button type="button" onClick={() => setBpTarget("bpTo")}>...</button>
            </div>

            <label>Handled By:</label>
            <span>User</span>
            <div className="activity-overview-chooser">
              <span>{selectionSummary(form.userNames)}</span>
              <button type="button" onClick={() => setSelectLookup("users")}>...</button>
            </div>
            <span />
            <span />

            <span />
            <span>Employee</span>
            <div className="activity-overview-chooser">
              <span>{selectionSummary(form.employeeNames)}</span>
              <button type="button" onClick={() => setSelectLookup("employees")}>...</button>
            </div>
            <span />
            <span />

            <span />
            <span>Recipient List</span>
            <div className="activity-overview-chooser">
              <span>{selectionSummary(form.recipientListNames)}</span>
              <button type="button" onClick={() => setSelectLookup("recipientLists")}>...</button>
            </div>
            <span />
            <span />

            <label>Customer Group</label>
            <div className="activity-overview-span2">{renderSelect("customerGroup", lookups.customerGroups)}</div>
            <span />
            <span />

            <label>Vendor Group</label>
            <div className="activity-overview-span2">{renderSelect("vendorGroup", lookups.vendorGroups)}</div>
            <span />
            <span />

            <label>Contact Person</label>
            <div className="activity-overview-span2">
              <select value={form.contactPerson} onChange={(event) => updateField("contactPerson", event.target.value)}>
                <option value="All">All</option>
              </select>
            </div>
            <span />
            <span />
          </div>

          <div className="activity-overview-property-row">
            <button type="button" className="sales-analysis__sap-btn" onClick={() => setShowProperties(true)}>
              Properties
            </button>
            <input value={form.propertyMode} readOnly />
          </div>

          <div className="activity-overview-section">
            <div className="activity-overview-grid activity-overview-grid--two-side">
              <label>Activity</label>
              <div>{renderSelect("activity", lookups.activities)}</div>
              <label>Source Type</label>
              <div>{renderSelect("sourceType", lookups.sourceTypes)}</div>
              <label>Type</label>
              <div>{renderSelect("activityType", lookups.activityTypes)}</div>
              <label>Meeting Location</label>
              <div>{renderSelect("meetingLocation", lookups.meetingLocations)}</div>
              <label>Subject</label>
              <div>{renderSelect("subject", lookups.subjects)}</div>
              <span />
              <label>Remarks</label>
              <div className="activity-overview-wide"><input value={form.remarks} onChange={(event) => updateField("remarks", event.target.value)} /></div>
            </div>
          </div>

          <div className="activity-overview-dates">
            <label>Activity Start Date</label>
            <span>From</span>
            <SapDateInput  value={form.startDateFrom} onChange={(event) => updateField("startDateFrom", event.target.value)} />
            <span>To</span>
            <SapDateInput  value={form.startDateTo} onChange={(event) => updateField("startDateTo", event.target.value)} />
            <label>Activity Closing Date</label>
            <span>From</span>
            <SapDateInput  value={form.closeDateFrom} onChange={(event) => updateField("closeDateFrom", event.target.value)} />
            <span>To</span>
            <SapDateInput  value={form.closeDateTo} onChange={(event) => updateField("closeDateTo", event.target.value)} />
          </div>

          <div className="activity-overview-checks">
            <label className="sales-analysis__checkbox-line">
              <input
                type="checkbox"
                checked={form.userDefinedFields.length > 0}
                onChange={(event) => {
                  if (event.target.checked) setSelectLookup("userDefinedFields");
                  else updateField("userDefinedFields", []);
                }}
              />
              <span>User-Defined Fields</span>
            </label>
            <button type="button" className="activity-overview-mini-btn" onClick={() => setSelectLookup("userDefinedFields")}>...</button>
            <label className="sales-analysis__checkbox-line activity-overview-service-call">
              <input checked={form.displayScheduledServiceCalls} onChange={(event) => updateField("displayScheduledServiceCalls", event.target.checked)} type="checkbox" />
              <span>Display Scheduled Service Calls</span>
            </label>
          </div>

          {loading ? <div className="sales-analysis__status">Loading Activities Overview...</div> : null}
          {status ? <div className="sales-analysis__status">{status}</div> : null}

          <div className="sales-analysis-window__footer activity-overview-footer">
            <button type="button" className="sales-analysis__sap-btn" onClick={handleRun}>OK</button>
            <button type="button" className="sales-analysis__sap-btn" onClick={handleReset}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );

  const renderReport = () => !report ? null : (
    <div
      className={`sales-analysis-window sales-analysis-window--report sap-report-window crm-activities-window${reportWindow.isMinimized ? " is-minimized" : ""}${reportWindow.isMaximized ? " is-maximized" : ""}`}
      {...reportWindow.windowProps}
      style={reportWindow.windowProps?.style}
    >
      <div className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
        <div className="sales-analysis-window__title sap-report-title">Activities Overview</div>
        <div className="sales-analysis-window__controls">
          <button type="button" aria-label={reportWindow.isMinimized ? "Restore" : "Minimize"} onClick={() => { reportWindow.toggleMinimize(); navigate("/dashboard"); }}>
            {reportWindow.isMinimized ? "[]" : "-"}
          </button>
          <button type="button" aria-label={reportWindow.isMaximized ? "Restore" : "Maximize"} onClick={reportWindow.toggleMaximize}>[]</button>
          <button type="button" aria-label="Close" onClick={() => setReport(null)}>x</button>
        </div>
      </div>
      <div className="sales-analysis-window__accent" />

      {!reportWindow.isMinimized ? (
        <div className="sales-analysis-window__body sales-analysis-window__body--report crm-activities-body">
          <div className="crm-activities-options">
            <label className="sales-analysis__checkbox-line crm-activities-option">
              <input type="checkbox" checked={form.displayOnlyOpen} onChange={(event) => updateField("displayOnlyOpen", event.target.checked)} />
              <span>Display Only Open Activities</span>
            </label>
          </div>

          <div className="crm-activities-grid-wrap">
            <table className="crm-activities-grid activity-overview-report-grid">
              <colgroup>
                {REPORT_COLUMNS.map((column) => (
                  <col key={column.key} style={{ width: column.width }} />
                ))}
              </colgroup>
              <thead>
                <tr>{REPORT_COLUMNS.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.number || "activity"}-${index}`}>
                    {REPORT_COLUMNS.map((column) => {
                      const value = row[column.key] || "";
                      const linked = column.linked && value;
                      const canOpenActivity = column.key === "number" && value;
                      const canOpenBusinessPartner = ["bpName", "contactPerson"].includes(column.key) && row.bpCode;
                      const handleOpenLinkedCell = () => {
                        if (canOpenActivity) openActivity(row);
                        if (canOpenBusinessPartner) openBusinessPartner(row);
                      };
                      return (
                        <td key={column.key}>
                          {linked ? (
                            <button
                              type="button"
                              className="crm-activities-link-cell"
                              onClick={handleOpenLinkedCell}
                              disabled={!canOpenActivity && !canOpenBusinessPartner}
                            >
                              <span className="crm-activities-link-icon">-&gt;</span>
                              <span>{value}</span>
                            </button>
                          ) : value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {fillerRows.map((rowIndex) => (
                  <tr key={`empty-${rowIndex}`} aria-hidden="true">
                    {REPORT_COLUMNS.map((column) => <td key={column.key}>&nbsp;</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="crm-activities-footer">
            <button type="button" className="sales-analysis-report__back-btn" onClick={() => setReport(null)}>&lt;</button>
            <div className="activity-overview-report-actions">
              <button type="button" className="sales-analysis__sap-btn" onClick={() => setReport(null)}>OK</button>
              <button type="button" className="sales-analysis__sap-btn" onClick={() => setReport(null)}>Cancel</button>
            </div>
          </footer>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="sales-analysis-page sap-report-page activity-overview-page">
      {renderCriteria()}
      {renderReport()}
      <BusinessPartnerLookupModal isOpen={Boolean(bpTarget)} onClose={() => setBpTarget("")} onSelect={handleBpSelect} type="" />
      <PropertiesSelectionModal
        isOpen={showProperties}
        onClose={() => setShowProperties(false)}
        onSave={handlePropertiesSave}
        title="Properties"
        propertyLabelPrefix="Business Partners Property"
        properties={DEFAULT_BP_PROPERTIES}
        value={form.propertyFilter}
      />
      {activeSelectConfig ? (
        <SelectLookupModal
          isOpen={Boolean(selectLookup)}
          title={activeSelectConfig.title}
          columns={activeSelectConfig.columns}
          fetchRows={activeSelectConfig.fetchRows}
          onClose={() => setSelectLookup("")}
          onApply={activeSelectConfig.onApply}
          initialSelected={activeSelectConfig.selected}
        />
      ) : null}
    </div>
  );
}

export default ActivityOverviewReportPage;
