import SapDateInput from '../components/common/SapDateInput';
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import SapLookupModal from "../components/common/SapLookupModal";
import PropertiesSelectionModal from "../components/reports/PropertiesSelectionModal";
import useFloatingWindow from "../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../components/SapWindowTaskbarContext";
import {
  fetchPurchaseRequestReportBranches,
  fetchPurchaseRequestReportDepartments,
  fetchPurchaseRequestReportEmployees,
  fetchPurchaseRequestReportItemGroups,
  fetchPurchaseRequestReportItemProperties,
  fetchPurchaseRequestReportItems,
  fetchPurchaseRequestReportProjects,
  fetchPurchaseRequestReportUsers,
  fetchPurchaseRequestReportVendors,
  runPurchaseRequestReport,
} from "../services/purchaseRequestReportApi";
import "../styles/sales-analysis-report.css";
import "../styles/purchase-request-report.css";

const createInitialCriteria = () => ({
  type: "Item",
  requesterType: "usersAndEmployees",
  requesterUser: { enabled: false, code: "", name: "" },
  requesterEmployee: { enabled: false, code: "", name: "" },
  codeRange: { from: "", to: "" },
  preferredVendorRange: { from: "", to: "" },
  itemGroup: "All",
  properties: {
    ignoreProperties: true,
    linkMode: "and",
    exactlyMatch: false,
    selectedPropertyNumbers: [],
  },
  branch: { enabled: false, code: "", name: "" },
  department: { enabled: false, code: "", name: "" },
  project: { enabled: false, code: "", name: "" },
  documentNumberRange: { from: "", to: "" },
  postingDateRange: { from: "", to: "" },
  validUntilRange: { from: "", to: "" },
  documentDateRange: { from: "", to: "" },
  requiredDateRange: { from: "", to: "" },
  displayOpenOnly: true,
  displayMrpOnly: false,
});

const getErrorMessage = (error, fallbackMessage) => {
  const detail = error?.response?.data?.message || error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  return error?.message || fallbackMessage;
};

const buildPropertySummary = (properties, availableProperties) => {
  if (properties.ignoreProperties || !properties.selectedPropertyNumbers.length) {
    return "Ignore";
  }

  if (properties.exactlyMatch) {
    return `Exactly Match (${properties.selectedPropertyNumbers.length} selected)`;
  }

  const names = properties.selectedPropertyNumbers
    .map((number) => availableProperties.find((entry) => entry.number === number)?.name || `Property ${number}`)
    .slice(0, 3);
  const moreCount = properties.selectedPropertyNumbers.length - names.length;

  return `${properties.linkMode === "and" ? "And" : "Or"}: ${names.join(", ")}${moreCount > 0 ? ` +${moreCount} more` : ""}`;
};

const formatSelectorSummary = (selector) => (
  selector?.enabled && selector?.code
    ? `${selector.code}${selector.name ? ` - ${selector.name}` : ""}`
    : "All"
);

function PurchaseRequestReportPage() {
  const navigate = useNavigate();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const [criteria, setCriteria] = useState(createInitialCriteria);
  const [itemGroupOptions, setItemGroupOptions] = useState([{ code: "All", name: "All" }]);
  const [itemProperties, setItemProperties] = useState([]);
  const [lookupState, setLookupState] = useState({ open: false, type: "", rangeKey: "from" });
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [pageState, setPageState] = useState({
    loadingLookups: true,
    loadingReport: false,
    error: "",
  });
  const [reportResult, setReportResult] = useState(null);

  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 22,
    resetOnClose: true,
    bounds: "parent",
    taskId: "prr-criteria",
    taskPath: "/reports/purchasing/purchase-request-report",
    taskTitle: "Purchase Request Report - Selection Criteria",
  });

  const reportWindow = useFloatingWindow({
    isOpen: Boolean(reportResult),
    defaultTop: 22,
    resetOnClose: true,
    bounds: "parent",
    taskId: "prr-report",
    taskPath: "/reports/purchasing/purchase-request-report",
    taskTitle: "Purchase Request Report",
  });

  useEffect(() => {
    let ignore = false;

    const loadLookups = async () => {
      setPageState((current) => ({ ...current, loadingLookups: true, error: "" }));
      try {
        const [groups, properties] = await Promise.all([
          fetchPurchaseRequestReportItemGroups(),
          fetchPurchaseRequestReportItemProperties(),
        ]);

        if (!ignore) {
          setItemGroupOptions(Array.isArray(groups) && groups.length ? groups : [{ code: "All", name: "All" }]);
          setItemProperties(Array.isArray(properties) ? properties : []);
          setPageState((current) => ({ ...current, loadingLookups: false }));
        }
      } catch (error) {
        if (!ignore) {
          setPageState((current) => ({
            ...current,
            loadingLookups: false,
            error: getErrorMessage(error, "Failed to load report reference data."),
          }));
        }
      }
    };

    loadLookups();

    return () => {
      ignore = true;
    };
  }, []);

  const propertySummary = useMemo(
    () => buildPropertySummary(criteria.properties, itemProperties),
    [criteria.properties, itemProperties],
  );

  const updateCriteria = useCallback((updater) => {
    setCriteria((current) => (typeof updater === "function" ? updater(current) : updater));
  }, []);

  const updateCodeRange = (section, side, value) => {
    updateCriteria((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [side]: value,
      },
    }));
  };

  const updateSelector = (section, nextValue) => {
    updateCriteria((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...nextValue,
      },
    }));
  };

  const getLookupConfig = useCallback(() => {
    switch (lookupState.type) {
      case "item":
        return {
          title: "Choose From List - Items",
          columns: [
            { key: "code", label: "Code" },
            { key: "name", label: "Item Description" },
            { key: "groupName", label: "Item Group" },
          ],
          fetchOptions: fetchPurchaseRequestReportItems,
        };
      case "vendor":
        return {
          title: "Choose From List - Preferred Vendors",
          columns: [
            { key: "code", label: "Code" },
            { key: "name", label: "Vendor Name" },
            { key: "groupName", label: "Group" },
          ],
          fetchOptions: fetchPurchaseRequestReportVendors,
        };
      case "branch":
        return {
          title: "Choose From List - Branches",
          columns: [
            { key: "code", label: "Code" },
            { key: "name", label: "Branch Name" },
          ],
          fetchOptions: fetchPurchaseRequestReportBranches,
        };
      case "department":
        return {
          title: "Choose From List - Departments",
          columns: [
            { key: "code", label: "Code" },
            { key: "name", label: "Department Name" },
          ],
          fetchOptions: fetchPurchaseRequestReportDepartments,
        };
      case "project":
        return {
          title: "Choose From List - Projects",
          columns: [
            { key: "code", label: "Code" },
            { key: "name", label: "Project Name" },
          ],
          fetchOptions: fetchPurchaseRequestReportProjects,
        };
      case "requesterUser":
        return {
          title: "Choose From List - Users",
          columns: [
            { key: "code", label: "Code" },
            { key: "userCode", label: "User Code" },
            { key: "name", label: "User Name" },
          ],
          fetchOptions: fetchPurchaseRequestReportUsers,
        };
      case "requesterEmployee":
        return {
          title: "Choose From List - Employees",
          columns: [
            { key: "code", label: "Code" },
            { key: "name", label: "Employee Name" },
          ],
          fetchOptions: fetchPurchaseRequestReportEmployees,
        };
      default:
        return {
          title: "",
          columns: [],
          fetchOptions: async () => [],
        };
    }
  }, [lookupState.type]);

  const handleLookupSelect = (row) => {
    if (!row) return;

    if (lookupState.type === "item") {
      updateCodeRange("codeRange", lookupState.rangeKey, row.code || "");
    } else if (lookupState.type === "vendor") {
      updateCodeRange("preferredVendorRange", lookupState.rangeKey, row.code || "");
    } else if (lookupState.type === "branch") {
      updateSelector("branch", { enabled: true, code: row.code || "", name: row.name || "" });
    } else if (lookupState.type === "department") {
      updateSelector("department", { enabled: true, code: row.code || "", name: row.name || "" });
    } else if (lookupState.type === "project") {
      updateSelector("project", { enabled: true, code: row.code || "", name: row.name || "" });
    } else if (lookupState.type === "requesterUser") {
      updateSelector("requesterUser", { enabled: true, code: row.code || "", name: row.name || row.userCode || "" });
    } else if (lookupState.type === "requesterEmployee") {
      updateSelector("requesterEmployee", { enabled: true, code: row.code || "", name: row.name || "" });
    }

    setLookupState({ open: false, type: "", rangeKey: "from" });
  };

  const handleRunReport = async () => {
    setPageState((current) => ({ ...current, loadingReport: true, error: "" }));
    try {
      const result = await runPurchaseRequestReport(criteria);
      setReportResult(result);
      setPageState((current) => ({ ...current, loadingReport: false }));
    } catch (error) {
      setReportResult(null);
      setPageState((current) => ({
        ...current,
        loadingReport: false,
        error: getErrorMessage(error, "Failed to run purchase request report."),
      }));
    }
  };

  const handleReset = () => {
    setCriteria(createInitialCriteria());
    setReportResult(null);
    setPageState((current) => ({ ...current, error: "" }));
  };

  const handleBackToCriteria = () => {
    setReportResult(null);
    setPageState((current) => ({ ...current, error: "" }));
  };

  const handleCloseCriteriaWindow = () => {
    if (closeActiveAndRestorePrevious()) return;
    navigate('/dashboard');
  };

  const handleCloseReportWindow = () => {
    setReportResult(null);
  };

  const handleMinimizeCriteria = () => {
    criteriaWindow.toggleMinimize();
    navigate("/dashboard");
  };

  const handleMinimizeReport = () => {
    reportWindow.toggleMinimize();
    navigate("/dashboard");
  };

  const lookupConfig = getLookupConfig();
  const isShowingResults = Boolean(reportResult);
  const criteriaWindowStyle = {
    ...(criteriaWindow.windowProps?.style || {}),
    ...(criteriaWindow.isMinimized
      ? {
          bottom: 0,
          left: "auto",
          right: 0,
          top: "auto",
          transform: "none",
          width: 350,
        }
      : {}),
  };
  const reportWindowStyle = {
    ...(reportWindow.windowProps?.style || {}),
    ...(reportWindow.isMinimized
      ? {
          bottom: 0,
          left: "auto",
          right: 0,
          top: "auto",
          transform: "none",
          width: 350,
        }
      : {}),
  };

  return (
    <div className="prr-page sap-report-page">
      {!isShowingResults ? (
        <div
          className={`prr-window sap-report-window${criteriaWindow.isMinimized ? " is-minimized" : ""}${criteriaWindow.isMaximized ? " is-maximized" : ""}`}
          {...criteriaWindow.windowProps}
          style={criteriaWindowStyle}
        >
          <div className="prr-titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
            <span>Purchase Request Report - Selection Criteria</span>
            <div className="prr-titlebar-actions">
              <button
                type="button"
                aria-label={criteriaWindow.isMinimized ? "Restore" : "Minimize"}
                className="prr-titlebar-btn"
                onClick={handleMinimizeCriteria}
              />
              <button
                type="button"
                aria-label={criteriaWindow.isMaximized ? "Restore" : "Maximize"} title={criteriaWindow.isMaximized ? "Restore" : "Maximize"}
                className="prr-titlebar-btn"
                onClick={criteriaWindow.toggleMaximize}
              />
              <button
                type="button"
                aria-label="Close"
                className="prr-titlebar-btn"
                onClick={handleCloseCriteriaWindow}
              />
            </div>
          </div>
          <div className="prr-accent" />

          {!criteriaWindow.isMinimized && (
            <>
            <div className="prr-body">
              {pageState.error ? <div className="prr-error">{pageState.error}</div> : null}
              {pageState.loadingLookups ? <div className="prr-loading">Loading report criteria...</div> : null}

              <div style={{ display: isShowingResults ? "none" : undefined }}>
                <div className="prr-grid">
                  <div className="prr-label">Type</div>
                  <div>
                    <select
                      className="prr-select"
                      value={criteria.type}
                      onChange={(event) => updateCriteria((current) => ({ ...current, type: event.target.value }))}
                    >
                      <option value="Item">Item</option>
                      <option value="Service">Service</option>
                    </select>
                  </div>

                  <div className="prr-label">Code</div>
                  <div className={`prr-inline-range${criteria.type === "Service" ? " prr-range-no-button" : " prr-inline-range--dual-lookup"}`}>
                    <span className="prr-sub-label">From</span>
                    <input
                      className="prr-input"
                      value={criteria.codeRange.from}
                      onChange={(event) => updateCodeRange("codeRange", "from", event.target.value)}
                    />
                    {criteria.type === "Item" ? (
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "item", rangeKey: "from" })}
                        title="Choose item code from SAP"
                      >
                        ...
                      </button>
                    ) : null}
                    <span className="prr-sub-label">To</span>
                    <input
                      className="prr-input"
                      value={criteria.codeRange.to}
                      onChange={(event) => updateCodeRange("codeRange", "to", event.target.value)}
                    />
                    {criteria.type === "Item" ? (
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "item", rangeKey: "to" })}
                        title="Choose item code to SAP"
                      >
                        ...
                      </button>
                    ) : null}
                  </div>

                  <div className="prr-label">Preferred Vendor</div>
                  <div className={`prr-inline-range${criteria.type === "Service" ? " prr-range-no-button" : " prr-inline-range--dual-lookup"}`}>
                    <span className="prr-sub-label">From</span>
                    <input
                      className="prr-input"
                      value={criteria.preferredVendorRange.from}
                      onChange={(event) => updateCodeRange("preferredVendorRange", "from", event.target.value)}
                      disabled={criteria.type === "Service"}
                    />
                    {criteria.type === "Item" ? (
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "vendor", rangeKey: "from" })}
                        title="Choose preferred vendor from SAP"
                      >
                        ...
                      </button>
                    ) : null}
                    <span className="prr-sub-label">To</span>
                    <input
                      className="prr-input"
                      value={criteria.preferredVendorRange.to}
                      onChange={(event) => updateCodeRange("preferredVendorRange", "to", event.target.value)}
                      disabled={criteria.type === "Service"}
                    />
                    {criteria.type === "Item" ? (
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "vendor", rangeKey: "to" })}
                        title="Choose preferred vendor to SAP"
                      >
                        ...
                      </button>
                    ) : null}
                  </div>

                  <div className="prr-label">Item Group</div>
                  <div>
                    <select
                      className="prr-select"
                      value={criteria.itemGroup}
                      onChange={(event) => updateCriteria((current) => ({ ...current, itemGroup: event.target.value }))}
                      disabled={criteria.type === "Service"}
                    >
                      {itemGroupOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="prr-properties-row">
                  <button
                    type="button"
                    className="prr-button"
                    onClick={() => setPropertiesOpen(true)}
                    disabled={criteria.type === "Service"}
                  >
                    Properties
                  </button>
                  <div className="prr-properties-summary">{criteria.type === "Service" ? "Not used for service requests" : propertySummary}</div>
                </div>

                <div className="prr-requesters">
                  <div className="prr-requesters-box">
                    <div className="prr-requesters-title">Requesters</div>

                    <div className="prr-requester-row">
                      <div>
                        <label className="prr-radio-line">
                          <input
                            type="radio"
                            name="requesterType"
                            checked={criteria.requesterType === "users"}
                            onChange={() => updateCriteria((current) => ({ ...current, requesterType: "users" }))}
                          />
                          <span>Users</span>
                        </label>
                        {criteria.requesterUser.code ? (
                          <div className="prr-selected-note">Selected: {formatSelectorSummary(criteria.requesterUser)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "requesterUser", rangeKey: "from" })}
                        title="Choose requester user"
                      >
                        ...
                      </button>
                    </div>

                    <div className="prr-requester-row">
                      <div>
                        <label className="prr-radio-line">
                          <input
                            type="radio"
                            name="requesterType"
                            checked={criteria.requesterType === "employees"}
                            onChange={() => updateCriteria((current) => ({ ...current, requesterType: "employees" }))}
                          />
                          <span>Employees</span>
                        </label>
                        {criteria.requesterEmployee.code ? (
                          <div className="prr-selected-note">Selected: {formatSelectorSummary(criteria.requesterEmployee)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "requesterEmployee", rangeKey: "from" })}
                        title="Choose requester employee"
                      >
                        ...
                      </button>
                    </div>

                    <div className="prr-requester-row" style={{ marginBottom: 0 }}>
                      <label className="prr-radio-line">
                        <input
                          type="radio"
                          name="requesterType"
                          checked={criteria.requesterType === "usersAndEmployees"}
                          onChange={() => updateCriteria((current) => ({ ...current, requesterType: "usersAndEmployees" }))}
                        />
                        <span>Users and Employees</span>
                      </label>
                      <span />
                    </div>
                  </div>

                  <div>
                    <div className="prr-selector-row">
                      <div>
                        <label className="prr-checkbox-line">
                          <input
                            type="checkbox"
                            checked={criteria.branch.enabled}
                            onChange={(event) => updateSelector("branch", { enabled: event.target.checked })}
                          />
                          <span>Branch</span>
                        </label>
                        {criteria.branch.code ? (
                          <div className="prr-selected-note">{formatSelectorSummary(criteria.branch)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "branch", rangeKey: "from" })}
                        title="Choose branch"
                      >
                        ...
                      </button>
                    </div>

                    <div className="prr-selector-row">
                      <div>
                        <label className="prr-checkbox-line">
                          <input
                            type="checkbox"
                            checked={criteria.department.enabled}
                            onChange={(event) => updateSelector("department", { enabled: event.target.checked })}
                          />
                          <span>Department</span>
                        </label>
                        {criteria.department.code ? (
                          <div className="prr-selected-note">{formatSelectorSummary(criteria.department)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "department", rangeKey: "from" })}
                        title="Choose department"
                      >
                        ...
                      </button>
                    </div>

                    <div className="prr-selector-row" style={{ marginBottom: 0 }}>
                      <div>
                        <label className="prr-checkbox-line">
                          <input
                            type="checkbox"
                            checked={criteria.project.enabled}
                            onChange={(event) => updateSelector("project", { enabled: event.target.checked })}
                          />
                          <span>Project</span>
                        </label>
                        {criteria.project.code ? (
                          <div className="prr-selected-note">{formatSelectorSummary(criteria.project)}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="prr-button prr-chooser-btn"
                        onClick={() => setLookupState({ open: true, type: "project", rangeKey: "from" })}
                        title="Choose project"
                      >
                        ...
                      </button>
                    </div>
                  </div>
                </div>

                <div className="prr-date-grid">
                  <div className="prr-label">Document No.</div>
                  <div className="prr-inline-range prr-range-no-button">
                    <span className="prr-sub-label">From</span>
                    <input
                      className="prr-input"
                      value={criteria.documentNumberRange.from}
                      onChange={(event) => updateCodeRange("documentNumberRange", "from", event.target.value)}
                    />
                    <span className="prr-sub-label">To</span>
                    <input
                      className="prr-input"
                      value={criteria.documentNumberRange.to}
                      onChange={(event) => updateCodeRange("documentNumberRange", "to", event.target.value)}
                    />
                  </div>

                  <div className="prr-label">Posting Date</div>
                  <div className="prr-inline-range prr-range-no-button">
                    <span className="prr-sub-label">From</span>
                    <SapDateInput
                      
                      className="prr-input"
                      value={criteria.postingDateRange.from}
                      onChange={(event) => updateCodeRange("postingDateRange", "from", event.target.value)}
                    />
                    <span className="prr-sub-label">To</span>
                    <SapDateInput
                      
                      className="prr-input"
                      value={criteria.postingDateRange.to}
                      onChange={(event) => updateCodeRange("postingDateRange", "to", event.target.value)}
                    />
                  </div>

                  <div className="prr-label">Valid Until</div>
                  <div className="prr-inline-range prr-range-no-button">
                    <span className="prr-sub-label">From</span>
                    <SapDateInput
                      
                      className="prr-input"
                      value={criteria.validUntilRange.from}
                      onChange={(event) => updateCodeRange("validUntilRange", "from", event.target.value)}
                    />
                    <span className="prr-sub-label">To</span>
                    <SapDateInput
                      
                      className="prr-input"
                      value={criteria.validUntilRange.to}
                      onChange={(event) => updateCodeRange("validUntilRange", "to", event.target.value)}
                    />
                  </div>

                  <div className="prr-label">Document Date</div>
                  <div className="prr-inline-range prr-range-no-button">
                    <span className="prr-sub-label">From</span>
                    <SapDateInput
                      
                      className="prr-input"
                      value={criteria.documentDateRange.from}
                      onChange={(event) => updateCodeRange("documentDateRange", "from", event.target.value)}
                    />
                    <span className="prr-sub-label">To</span>
                    <SapDateInput
                      
                      className="prr-input"
                      value={criteria.documentDateRange.to}
                      onChange={(event) => updateCodeRange("documentDateRange", "to", event.target.value)}
                    />
                  </div>

                  <div className="prr-label">Required Date</div>
                  <div className="prr-inline-range prr-range-no-button">
                    <span className="prr-sub-label">From</span>
                    <SapDateInput
                      
                      className="prr-input"
                      value={criteria.requiredDateRange.from}
                      onChange={(event) => updateCodeRange("requiredDateRange", "from", event.target.value)}
                    />
                    <span className="prr-sub-label">To</span>
                    <SapDateInput
                      
                      className="prr-input"
                      value={criteria.requiredDateRange.to}
                      onChange={(event) => updateCodeRange("requiredDateRange", "to", event.target.value)}
                    />
                  </div>
                </div>

                <div className="prr-checks">
                  <label className="prr-checkbox-line">
                    <input
                      type="checkbox"
                      checked={criteria.displayOpenOnly}
                      onChange={(event) => updateCriteria((current) => ({ ...current, displayOpenOnly: event.target.checked }))}
                    />
                    <span>Display Open Purchase Requests Only</span>
                  </label>

                  <label className="prr-checkbox-line">
                    <input
                      type="checkbox"
                      checked={criteria.displayMrpOnly}
                      onChange={(event) => updateCriteria((current) => ({ ...current, displayMrpOnly: event.target.checked }))}
                    />
                    <span>Display Purchase Requests from MRP Only</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="prr-actions">
              <button
                type="button"
                className="prr-button"
                onClick={handleRunReport}
                disabled={pageState.loadingLookups || pageState.loadingReport}
              >
                {pageState.loadingReport ? "Running..." : "OK"}
              </button>
              <button
                type="button"
                className="prr-button"
                onClick={handleReset}
                disabled={pageState.loadingReport}
              >
                Cancel
              </button>
            </div>
            </>
          )}
        </div>
      ) : null}

      {isShowingResults ? (
        <div
          className={`prr-window sap-report-window${reportWindow.isMinimized ? " is-minimized" : ""}${reportWindow.isMaximized ? " is-maximized" : ""}`}
          {...reportWindow.windowProps}
          style={reportWindowStyle}
        >
          <div className="prr-titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
            <span>Purchase Request Report</span>
            <div className="prr-titlebar-actions">
              <button
                type="button"
                aria-label={reportWindow.isMinimized ? "Restore" : "Minimize"}
                className="prr-titlebar-btn"
                onClick={handleMinimizeReport}
              />
              <button
                type="button"
                aria-label={reportWindow.isMaximized ? "Restore" : "Maximize"} title={reportWindow.isMaximized ? "Restore" : "Maximize"}
                className="prr-titlebar-btn"
                onClick={reportWindow.toggleMaximize}
              />
              <button
                type="button"
                aria-label="Close"
                className="prr-titlebar-btn"
                onClick={handleCloseReportWindow}
              />
            </div>
          </div>
          <div className="prr-accent" />

          {!reportWindow.isMinimized && (
            <div className="prr-body">
            <div className="prr-results">
              <div className="prr-results-header">
                <div>
                  <div className="prr-results-title">Purchase Request Report Results</div>
                  <div className="prr-results-meta">
                    {reportResult.totals?.documentCount || 0} documents | {reportResult.totals?.matchingLineCount || 0} matching lines | Requested Qty {Number(reportResult.totals?.requestedQuantity || 0).toFixed(2)} | Open Qty {Number(reportResult.totals?.openQuantity || 0).toFixed(2)}
                  </div>
                </div>
                <div className="prr-results-actions">
                  <button
                    type="button"
                    className="sales-analysis-report__back-btn"
                    onClick={handleBackToCriteria}
                    aria-label="Back to criteria"
                  >
                    &lt;
                  </button>
                  <button type="button" className="prr-button" onClick={handleBackToCriteria}>
                    Selection Criteria
                  </button>
                </div>
              </div>

              {Array.isArray(reportResult.rows) && reportResult.rows.length ? (
                <div className="prr-results-wrap">
                  <table className="prr-table">
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Doc No.</th>
                        <th>{criteria.type === "Service" ? "Account Code" : "Item Code"}</th>
                        <th>Description</th>
                        <th>Preferred Vendor</th>
                        <th>Requester</th>
                        <th>Branch</th>
                        <th>Department</th>
                        <th>Project</th>
                        <th>Posting Date</th>
                        <th>Valid Until</th>
                        <th>Document Date</th>
                        <th>Required Date</th>
                        <th>Lines</th>
                        <th>Requested Qty</th>
                        <th>Open Qty</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportResult.rows.map((row) => (
                        <tr key={row.docEntry}>
                          <td>
                            <button
                              type="button"
                              className="prr-link-btn"
                              onClick={() => navigate("/purchase-request", { state: { purchaseRequestDocEntry: row.docEntry } })}
                            >
                              Open
                            </button>
                          </td>
                          <td>{row.docNum}</td>
                          <td>{row.code || "-"}</td>
                          <td>{row.description || "-"}</td>
                          <td>{row.preferredVendorCode ? `${row.preferredVendorCode}${row.preferredVendorName ? ` - ${row.preferredVendorName}` : ""}` : "-"}</td>
                          <td>{row.requester || "-"}</td>
                          <td>{row.branchName || row.branchCode || "-"}</td>
                          <td>{row.departmentName || row.departmentCode || "-"}</td>
                          <td>{row.projectName || row.projectCode || "-"}</td>
                          <td>{row.postingDate || "-"}</td>
                          <td>{row.validUntil || "-"}</td>
                          <td>{row.documentDate || "-"}</td>
                          <td>{row.requiredDate || "-"}</td>
                          <td className="is-number">{row.matchingLineCount}</td>
                          <td className="is-number">{Number(row.requestedQuantity || 0).toFixed(2)}</td>
                          <td className="is-number">{Number(row.openQuantity || 0).toFixed(2)}</td>
                          <td>{row.status || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="prr-empty">No matching purchase requests found for the selected criteria.</div>
              )}
            </div>
            </div>
          )}
        </div>
      ) : null}

      <SapLookupModal
        open={lookupState.open}
        title={lookupConfig.title}
        columns={lookupConfig.columns}
        fetchOptions={lookupConfig.fetchOptions}
        onClose={() => setLookupState({ open: false, type: "", rangeKey: "from" })}
        onSelect={handleLookupSelect}
      />

      <PropertiesSelectionModal
        isOpen={propertiesOpen}
        onClose={() => setPropertiesOpen(false)}
        onSave={(value) => updateCriteria((current) => ({ ...current, properties: value }))}
        title="Item Properties"
        propertyLabelPrefix="Property"
        properties={itemProperties}
        value={criteria.properties}
      />
    </div>
  );
}

export default PurchaseRequestReportPage;


