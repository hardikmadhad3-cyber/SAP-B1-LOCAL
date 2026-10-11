import SapDateInput from '../../components/common/SapDateInput';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../modules/item-master/styles/itemMaster.css";
import "../../modules/sales-order/styles/salesOrder.css";
import "../../styles/sales-analysis-report.css";
import SapLookupModal from "../../components/common/SapLookupModal";
import SalesAnalysisPropertiesModal from "../../components/reports/SalesAnalysisPropertiesModal";
import useFloatingWindow from "../../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../../components/SapWindowTaskbarContext";
import { exportPurchaseDetailPdf, exportPurchaseSummaryPdf } from "../../utils/analysisPdf";
import {
  fetchPurchaseAnalysisItemGroups,
  fetchPurchaseAnalysisItemProperties,
  fetchPurchaseAnalysisItems,
  fetchPurchaseAnalysisPurchasingEmployees,
  fetchPurchaseAnalysisVendorGroups,
  fetchPurchaseAnalysisVendorProperties,
  fetchPurchaseAnalysisVendors,
  runPurchaseAnalysis,
} from "../../services/purchaseAnalysisApi";

const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
const todayIso = today.toISOString().slice(0, 10);

const emptyRange = { codeFrom: "", codeTo: "" };

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());

const createInitialCriteria = () => ({
  tab: "customers",
  reportPeriod: "annual",
  documentType: "invoices",
  displayMode: "individual",
  totalType: "totalByCustomer",
  dateFilters: {
    postingDate: { enabled: true, from: monthStart, to: todayIso },
    dueDate: { enabled: false, from: monthStart, to: todayIso },
    documentDate: { enabled: false, from: monthStart, to: todayIso },
  },
  customer: {
    ...emptyRange,
    group: "All",
    propertiesMode: "Ignore",
    properties: [],
  },
  item: {
    ...emptyRange,
    group: "All",
    propertiesMode: "Ignore",
    properties: [],
    secondarySelection: false,
    secondaryFilters: {
      customer: { ...emptyRange },
      salesEmployee: { ...emptyRange },
      warehouse: { ...emptyRange },
    },
  },
  salesEmployee: {
    ...emptyRange,
    includeInactive: false,
  },
  displaySystemCurrency: false,
});

const formatAmount = (value, currencyCode = '') => {
  const formatted = Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currencyCode ? `${currencyCode} ${formatted}` : formatted;
};

const setDeepValue = (source, path, nextValue) => {
  const keys = path.split(".");
  const clone = { ...source };
  let cursor = clone;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = nextValue;
      return;
    }
    cursor[key] = Array.isArray(cursor[key]) ? [...cursor[key]] : { ...cursor[key] };
    cursor = cursor[key];
  });

  return clone;
};

const buildPropertySummary = (mode, properties, options) => {
  if (mode === "Ignore" || !properties.length) return "Ignore";
  const names = properties
    .map((propertyNumber) => options.find((option) => option.number === propertyNumber)?.name || `Property ${propertyNumber}`)
    .slice(0, 3);
  const suffix = properties.length > 3 ? ` +${properties.length - 3} more` : "";
  return `${mode}: ${names.join(", ")}${suffix}`;
};

const downloadCsv = (filename, rows) => {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", filename);
  link.click();
  URL.revokeObjectURL(link.href);
};

export default function PurchaseAnalysisReport() {
  const navigate = useNavigate();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const [criteria, setCriteria] = useState(createInitialCriteria);
  const [customerGroupOptions, setCustomerGroupOptions] = useState([{ code: "All", name: "All" }]);
  const [itemGroupOptions, setItemGroupOptions] = useState([{ code: "All", name: "All" }]);
  const [customerProperties, setCustomerProperties] = useState([]);
  const [itemProperties, setItemProperties] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [summaryResult, setSummaryResult] = useState(null);
  const [detailResult, setDetailResult] = useState(null);
  const [lookupState, setLookupState] = useState({ open: false, type: "vendors", rangeKey: "from" });
  const [propertiesModal, setPropertiesModal] = useState({ open: false, type: "customer" });
  const dateNativeInputRefs = useRef({});

  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 22,
    taskId: 'purchase-analysis-criteria',
    taskTitle: 'Purchase Analysis Report - Selection Criteria',
    taskPath: '/reports/purchase/analysis',
    bounds: 'parent',
  });

  const reportWindow = useFloatingWindow({
    isOpen: Boolean(summaryResult) || Boolean(detailResult),
    defaultTop: 12,
    taskId: 'purchase-analysis-report',
    taskTitle: summaryResult?.title || detailResult?.title || 'Purchase Analysis Report',
    taskPath: '/reports/purchase/analysis',
    bounds: 'parent',
  });

  useEffect(() => {
    Promise.all([
      fetchPurchaseAnalysisVendorGroups(),
      fetchPurchaseAnalysisItemGroups(),
      fetchPurchaseAnalysisVendorProperties(),
      fetchPurchaseAnalysisItemProperties(),
    ])
      .then(([customerGroups, itemGroups, bpProperties, itmProperties]) => {
        setCustomerGroupOptions(customerGroups);
        setItemGroupOptions(itemGroups);
        setCustomerProperties(bpProperties);
        setItemProperties(itmProperties);
      })
      .catch(() => {
        setMessage("Lookup data could not be loaded. Default values are still available.");
      });
  }, []);

  const currentSelectionLabel =
    criteria.tab === "customers" ? "Supplier" : criteria.tab === "items" ? "Item" : "Sales Employee";

  const customerPropertySummary = useMemo(
    () => buildPropertySummary(criteria.customer.propertiesMode, criteria.customer.properties, customerProperties),
    [criteria.customer.propertiesMode, criteria.customer.properties, customerProperties]
  );
  const itemPropertySummary = useMemo(
    () => buildPropertySummary(criteria.item.propertiesMode, criteria.item.properties, itemProperties),
    [criteria.item.propertiesMode, criteria.item.properties, itemProperties]
  );

  const validateCriteria = () => {
    const enabledFilters = Object.values(criteria.dateFilters).filter((filter) => filter.enabled);
    if (!enabledFilters.length) return "At least one date criterion must be selected";
    const invalidFilter = enabledFilters.find((filter) => !filter.from || !filter.to || filter.from > filter.to);
    if (invalidFilter) return "Enter valid date range";
    if (
      criteria.customer.codeFrom &&
      criteria.customer.codeTo &&
      criteria.customer.codeFrom > criteria.customer.codeTo
    ) {
      return "Invalid selection criteria";
    }
    if (
      criteria.item.codeFrom &&
      criteria.item.codeTo &&
      criteria.item.codeFrom > criteria.item.codeTo
    ) {
      return "Invalid selection criteria";
    }
    if (
      criteria.salesEmployee.codeFrom &&
      criteria.salesEmployee.codeTo &&
      criteria.salesEmployee.codeFrom > criteria.salesEmployee.codeTo
    ) {
      return "Invalid selection criteria";
    }
    return "";
  };

  const handleChange = (path, value) => {
    setCriteria((previous) => {
      const next = setDeepValue(previous, path, value);
      if (path === "tab") {
        if (value === "customers") next.totalType = "totalByCustomer";
        if (value === "items") next.totalType = "none";
      }
      return next;
    });
  };

  const handleCloseCriteriaWindow = () => {
    if (closeActiveAndRestorePrevious()) return;
    navigate('/dashboard');
  };

  const handleCloseReportWindow = () => {
    setSummaryResult(null);
    setDetailResult(null);
  };

  const handleMinimizeCriteriaWindow = () => {
    criteriaWindow.toggleMinimize();
    navigate("/dashboard");
  };

  const handleMinimizeReportWindow = () => {
    reportWindow.toggleMinimize();
    navigate("/dashboard");
  };

  const handleRun = async () => {
    const validationMessage = validateCriteria();
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setLoading(true);
    setMessage("");
    setDetailResult(null);

    try {
      const result = await runPurchaseAnalysis(criteria);
      setSummaryResult(result);
      if (result.message) setMessage(result.message);
    } catch (error) {
      setMessage(error.response?.data?.message || "Invalid selection criteria");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDetail = async (row) => {
    setLoading(true);
    setMessage("");
    try {
      const result = await runPurchaseAnalysis({
        ...criteria,
        detailContext: {
          entityCode: row.entityCode,
          entityName: row.entityName,
          periodKey: row.periodKey,
          secondaryCode: row.secondaryCode,
        },
      });
      setDetailResult(result);
    } catch (error) {
      setMessage(error.response?.data?.message || "No matching records found");
    } finally {
      setLoading(false);
    }
  };

  const getLookupFetcher = () => {
    if (lookupState.type === "vendors") return fetchPurchaseAnalysisVendors;
    if (lookupState.type === "items") return fetchPurchaseAnalysisItems;
    return (query) => fetchPurchaseAnalysisPurchasingEmployees(query, criteria.salesEmployee.includeInactive);
  };

  const handleLookupSelect = (row) => {
    let fieldPath = lookupState.targetPath;
    if (!fieldPath) {
      if (lookupState.type === "vendors") {
        fieldPath = lookupState.rangeKey === "from" ? "customer.codeFrom" : "customer.codeTo";
      } else if (lookupState.type === "items") {
        fieldPath = lookupState.rangeKey === "from" ? "item.codeFrom" : "item.codeTo";
      } else {
        fieldPath = lookupState.rangeKey === "from" ? "salesEmployee.codeFrom" : "salesEmployee.codeTo";
      }
    }
    const code = row.code || row.CardCode || row.ItemCode || "";
    handleChange(fieldPath, code);
    setLookupState((previous) => ({ ...previous, open: false }));
  };

  const handleToggleProperty = (type, propertyNumber) => {
    setCriteria((previous) => {
      const path = type === "customer" ? previous.customer.properties : previous.item.properties;
      const nextValues = path.includes(propertyNumber)
        ? path.filter((entry) => entry !== propertyNumber)
        : [...path, propertyNumber];
      return setDeepValue(previous, `${type}.properties`, nextValues);
    });
  };

  const getDateNativeInputRef = (key, field) => (node) => {
    dateNativeInputRefs.current[`${key}-${field}`] = node;
  };

  const openDatePicker = (key, field) => {
    const input = dateNativeInputRefs.current[`${key}-${field}`];
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  };

  const renderDateRow = (key, label) => {
    const range = criteria.dateFilters[key];

    const renderDatePickerButton = (field) => (
      <React.Fragment key={field}>
        <SapDateInput
          ref={getDateNativeInputRef(key, field)}
          
          className="sales-analysis__date-native-input"
          tabIndex={-1}
          value={isIsoDate(range[field]) ? range[field] : ""}
          onChange={(event) => handleChange(`dateFilters.${key}.${field}`, event.target.value)}
        />
        <button
          type="button"
          className="sales-analysis__picker-btn"
          aria-label={`Open ${field === "from" ? "From" : "To"} date picker`}
          onClick={() => openDatePicker(key, field)}
        >
          ...
        </button>
      </React.Fragment>
    );

    return (
      <div className="sales-analysis__date-row" key={key}>
        <label className="sales-analysis__checkbox-line">
          <input
            type="checkbox"
            checked={range.enabled}
            onChange={(event) => handleChange(`dateFilters.${key}.enabled`, event.target.checked)}
          />
          <span>{label}</span>
        </label>

        <div className="sales-analysis__date-fields">
          <span className="sales-analysis__field-label">From</span>
          <input
            type="text"
            value={range.from}
            onChange={(event) => handleChange(`dateFilters.${key}.from`, event.target.value)}
          />
          {renderDatePickerButton("from")}
          <span className="sales-analysis__field-label">To</span>
          <input
            type="text"
            value={range.to}
            onChange={(event) => handleChange(`dateFilters.${key}.to`, event.target.value)}
          />
          {renderDatePickerButton("to")}
        </div>
      </div>
    );
  };

  const renderSelectionGrid = ({
    rowLabel,
    selection,
    selectionKey,
    groupOptions,
    propertiesSummary,
    enableLookup = false,
    nestedSection = '',
    enableToLookup = false,
  }) => {
    const updateField = (field, value) => {
      if (nestedSection) {
        handleChange(`item.secondaryFilters.${nestedSection}.${field}`, value);
        return;
      }
      handleChange(`${selectionKey}.${field}`, value);
    };

    return (
      <div className="sales-analysis__selection-grid">
        <div className="sales-analysis__selection-row-label">{rowLabel}</div>
        <div>
          <div className="sales-analysis__column-head">Code From</div>
          <div className="sales-analysis__lookup-wrap">
            <input
              type="text"
              value={selection.codeFrom}
              onChange={(event) => updateField('codeFrom', event.target.value)}
            />
            <button
              type="button"
              className="sales-analysis__lookup-btn"
              aria-label="Lookup code"
              onClick={() => {
                if (!enableLookup) return;
                const basePath = nestedSection ? `item.secondaryFilters.${nestedSection}` : selectionKey;
                setLookupState({
                  open: true,
                  type: selectionKey === 'item' ? 'items' : (selectionKey === 'customer' || nestedSection === 'customer') ? 'vendors' : 'purchasingEmployees',
                  targetPath: `${basePath}.codeFrom`,
                });
              }}
              disabled={!enableLookup}
            >
              ...
            </button>
          </div>
        </div>
        <div>
          <div className="sales-analysis__column-head">To</div>
          {enableToLookup ? (
            <div className="sales-analysis__lookup-wrap">
              <input
                type="text"
                value={selection.codeTo}
                onChange={(event) => updateField('codeTo', event.target.value)}
              />
              <button
                type="button"
                className="sales-analysis__lookup-btn"
                aria-label="Lookup to code"
                onClick={() => {
                  const basePath = nestedSection ? `item.secondaryFilters.${nestedSection}` : selectionKey;
                  setLookupState({
                    open: true,
                    type: selectionKey === 'item' ? 'items' : (selectionKey === 'customer' || nestedSection === 'customer') ? 'vendors' : 'purchasingEmployees',
                    targetPath: `${basePath}.codeTo`,
                  });
                }}
              >
                ...
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={selection.codeTo}
              onChange={(event) => updateField('codeTo', event.target.value)}
            />
          )}
        </div>
        <div>
          <div className="sales-analysis__column-head">Group</div>
          <select
            value={selection.group || "All"}
            onChange={(event) => updateField('group', event.target.value)}
          >
            {groupOptions.map((option) => (
              <option value={String(option.code || 'All')} key={`${option.code}-${option.name}`}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="sales-analysis__column-head sales-analysis__column-head--blank">&nbsp;</div>
          <button
            type="button"
            className="sales-analysis__sap-btn sales-analysis__sap-btn--field"
            onClick={() => setPropertiesModal({ open: true, type: selectionKey === 'item' ? 'item' : 'customer' })}
          >
            Properties
          </button>
        </div>
        <div>
          <div className="sales-analysis__column-head">Properties</div>
          <input type="text" value={propertiesSummary} readOnly />
        </div>
      </div>
    );
  };

  const renderMainSelection = () => {
    if (criteria.tab === 'salesEmployees') {
      return (
        <>
          <div className="sales-analysis__selection-grid sales-analysis__selection-grid--employees">
            <div className="sales-analysis__selection-row-label">{currentSelectionLabel}</div>
            <div>
              <div className="sales-analysis__column-head">Code From</div>
              <div className="sales-analysis__lookup-wrap">
                <input
                  type="text"
                  value={criteria.salesEmployee.codeFrom}
                  onChange={(event) => handleChange('salesEmployee.codeFrom', event.target.value)}
                />
                <button
                  type="button"
                  className="sales-analysis__lookup-btn"
                  onClick={() => setLookupState({ open: true, type: 'purchasingEmployees', targetPath: 'salesEmployee.codeFrom' })}
                >
                  ...
                </button>
              </div>
            </div>
            <div>
              <div className="sales-analysis__column-head">To</div>
              <div className="sales-analysis__lookup-wrap">
                <input
                  type="text"
                  value={criteria.salesEmployee.codeTo}
                  onChange={(event) => handleChange('salesEmployee.codeTo', event.target.value)}
                />
                <button
                  type="button"
                  className="sales-analysis__lookup-btn"
                  onClick={() => setLookupState({ open: true, type: 'purchasingEmployees', targetPath: 'salesEmployee.codeTo' })}
                >
                  ...
                </button>
              </div>
            </div>
          </div>
          <label className="sales-analysis__checkbox-line sales-analysis__sub-check">
            <input
              type="checkbox"
              checked={criteria.salesEmployee.includeInactive}
              onChange={(event) => handleChange('salesEmployee.includeInactive', event.target.checked)}
            />
            <span>Include Inactive Sales Employee</span>
          </label>
        </>
      );
    }

    const selectionKey = criteria.tab === 'customers' ? 'customer' : 'item';
    const selection = criteria[selectionKey];
    const groupOptions = selectionKey === 'customer' ? customerGroupOptions : itemGroupOptions;

    return (
      <>
        {renderSelectionGrid({
          rowLabel: currentSelectionLabel,
          selection,
          selectionKey,
          groupOptions,
          propertiesSummary: selectionKey === 'customer' ? customerPropertySummary : itemPropertySummary,
          enableLookup: true,
          enableToLookup: true,
        })}

        {criteria.tab === 'items' ? (
          <>
            <label className="sales-analysis__checkbox-line sales-analysis__sub-check">
              <input
                type="checkbox"
                checked={criteria.item.secondarySelection}
                onChange={(event) => handleChange('item.secondarySelection', event.target.checked)}
              />
              <span>Secondary Selection</span>
            </label>

            {criteria.item.secondarySelection ? (
              <div className="sales-analysis__secondary-block">
                {renderSelectionGrid({
                  rowLabel: 'Supplier',
                  selection: criteria.item.secondaryFilters.customer,
                  selectionKey: 'customer',
                  groupOptions: customerGroupOptions,
                  propertiesSummary: "Ignore",
                  enableLookup: true,
                  enableToLookup: true,
                  nestedSection: 'customer',
                })}

                <div className="sales-analysis__selection-grid sales-analysis__selection-grid--secondary-employee">
                  <div className="sales-analysis__selection-row-label">Sales Employee</div>
                  <div>
                    <div className="sales-analysis__lookup-wrap">
                      <input
                        type="text"
                        value={criteria.item.secondaryFilters.salesEmployee.codeFrom}
                        onChange={(event) => handleChange('item.secondaryFilters.salesEmployee.codeFrom', event.target.value)}
                      />
                      <button
                        type="button"
                        className="sales-analysis__lookup-btn"
                        onClick={() => setLookupState({ open: true, type: 'purchasingEmployees', targetPath: 'item.secondaryFilters.salesEmployee.codeFrom' })}
                      >
                        ...
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="sales-analysis__lookup-wrap">
                      <input
                        type="text"
                        value={criteria.item.secondaryFilters.salesEmployee.codeTo}
                        onChange={(event) => handleChange('item.secondaryFilters.salesEmployee.codeTo', event.target.value)}
                      />
                      <button
                        type="button"
                        className="sales-analysis__lookup-btn"
                        onClick={() => setLookupState({ open: true, type: 'purchasingEmployees', targetPath: 'item.secondaryFilters.salesEmployee.codeTo' })}
                      >
                        ...
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </>
    );
  };

  const handleBackToCriteria = () => {
    setSummaryResult(null);
    setDetailResult(null);
    setMessage("");
  };

  const handleExportExcel = () => {
    if (detailResult) {
      downloadCsv("purchase-analysis-detail.csv", detailResult.rows);
    } else if (summaryResult) {
      downloadCsv("purchase-analysis-summary.csv", summaryResult.rows);
    }
  };

  const handleExportPdf = () => {
    if (detailResult) {
      exportPurchaseDetailPdf({ result: detailResult, criteria });
    } else if (summaryResult) {
      exportPurchaseSummaryPdf({
        result: summaryResult,
        criteria,
        tab: criteria.tab,
        customerLabel: "Supplier",
        salesEmployeeLabel: "Sales Employee",
        openAmountLabel: "Total Open PU",
      });
    }
  };

  const renderReportFooter = () => (
    <div className="sales-analysis-report__footer">
      <button
        type="button"
        className="sales-analysis-report__back-btn"
        onClick={detailResult ? () => setDetailResult(null) : handleBackToCriteria}
        aria-label="Back"
      >
        &lt;
      </button>
      <div className="sales-analysis-report__action-group">
        <button
          type="button"
          className="sales-analysis__sap-btn sales-analysis__sap-btn--secondary"
          onClick={handleExportExcel}
        >
          Export Excel
        </button>
        <button
          type="button"
          className="sales-analysis__sap-btn sales-analysis__sap-btn--secondary"
          onClick={handleExportPdf}
        >
          Export PDF
        </button>
        <button
          type="button"
          className="sales-analysis__sap-btn"
          onClick={handleBackToCriteria}
        >
          OK
        </button>
      </div>
    </div>
  );

  const renderSummaryGrid = () => {
    const rows = summaryResult.rows || [];
    const totals = summaryResult.totals || {};
    const currency = summaryResult.currencyCode || "";
    const isItem = criteria.tab === 'items';
    const isCustomer = criteria.tab === 'customers';
    const showPeriod = criteria.reportPeriod !== 'annual';

    return (
      <div className="sales-analysis-report__grid-wrap">
        <table className="sales-analysis-report__grid">
          <thead>
            <tr>
              <th className="is-row-number">#</th>
              {isItem ? (
                <>
                  <th>Item No.</th>
                  <th>Item Description</th>
                  {criteria.totalType === 'totalByCustomer' && <th>Supplier</th>}
                  {criteria.totalType === 'totalBySalesEmployee' && <th>Sales Employee</th>}
                </>
              ) : isCustomer ? (
                <>
                  <th>{criteria.displayMode === 'group' ? 'Group Code' : (criteria.totalType === 'totalByBlanketAgreement' ? 'Agreement No.' : 'Supplier Code')}</th>
                  <th>{criteria.displayMode === 'group' ? 'Group Name' : 'Supplier Name'}</th>
                </>
              ) : (
                <th>Sales Employee</th>
              )}
              {showPeriod && <th>Period</th>}
              {!isItem && <th>{summaryResult.documentLabel || 'Count'}</th>}
              {isItem && <th>Quantity</th>}
              <th>{summaryResult.amountLabel || 'Total Amount'}</th>
              {!isItem && <th>Total Open PU</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.key || row.rowNo}>
                  <td
                    className={`is-row-number${criteria.displayMode === 'individual' && !isItem ? ' is-clickable' : ''}`}
                    onDoubleClick={() => criteria.displayMode === 'individual' && !isItem && handleOpenDetail(row)}
                  >
                    {row.rowNo}
                  </td>
                  {isItem ? (
                    <>
                      <td>{row.entityCode}</td>
                      <td>{row.entityName}</td>
                      {criteria.totalType !== 'none' && <td>{row.secondaryName}</td>}
                    </>
                  ) : isCustomer ? (
                    <>
                      <td>
                        {criteria.displayMode === 'individual' && criteria.totalType !== 'totalByBlanketAgreement' && row.entityCode ? (
                          <button
                            type="button"
                            className="sales-analysis-report__link-cell"
                            onClick={() => {
                              navigate("/business-partner", { state: { cardCode: row.entityCode, cardType: "cSupplier", source: "purchase-analysis" } });
                            }}
                          >
                            <span className="sales-analysis-report__link-icon" aria-hidden="true">➜</span>
                            <span>{row.entityCode}</span>
                          </button>
                        ) : (
                          <span>{row.entityCode}</span>
                        )}
                      </td>
                      <td>{row.entityName}</td>
                    </>
                  ) : (
                    <td>{row.entityName}</td>
                  )}
                  {showPeriod && <td>{row.periodLabel}</td>}
                  {!isItem && <td className="is-numeric">{row.documentCount}</td>}
                  {isItem && <td className="is-numeric">{Number(row.quantity || 0).toFixed(3)}</td>}
                  <td className="is-numeric">{formatAmount(row.totalAmount, currency)}</td>
                  {!isItem && <td className="is-numeric">{formatAmount(row.openAmount, currency)}</td>}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="10" className="sales-analysis-report__empty">No matching records found.</td>
              </tr>
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr>
                <td>&nbsp;</td>
                {isItem ? (
                  <>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                    {criteria.totalType !== 'none' && <td>&nbsp;</td>}
                  </>
                ) : isCustomer ? (
                  <>
                    <td>&nbsp;</td>
                    <td>&nbsp;</td>
                  </>
                ) : (
                  <td>&nbsp;</td>
                )}
                {showPeriod && <td>&nbsp;</td>}
                {!isItem && <td className="is-numeric">{totals.documentCount}</td>}
                {isItem && <td className="is-numeric">{Number(totals.quantity || 0).toFixed(3)}</td>}
                <td className="is-numeric">{formatAmount(totals.totalAmount, currency)}</td>
                {!isItem && <td className="is-numeric">{formatAmount(totals.openAmount, currency)}</td>}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  };

  const renderDetailGrid = () => {
    const rows = detailResult.rows || [];
    const totals = detailResult.totals || {};
    const currency = detailResult.currencyCode || "";

    return (
      <div className="sales-analysis-report__grid-wrap">
        <table className="sales-analysis-report__grid">
          <thead>
            <tr>
              <th className="is-row-number">#</th>
              <th>Document</th>
              <th>Posting Date</th>
              <th>Due Date</th>
              <th>Supplier Code</th>
              <th>Supplier Name</th>
              <th>Sales Employee</th>
              <th>Purchased Amount</th>
              <th>Applied Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={`${row.docEntry}-${row.rowNo}`}>
                  <td className="is-row-number">{row.rowNo}</td>
                  <td>{row.documentRef}</td>
                  <td>{row.postingDate}</td>
                  <td>{row.dueDate}</td>
                  <td>{row.customerCode}</td>
                  <td>{row.customerName}</td>
                  <td>{row.salesEmployee}</td>
                  <td className="is-numeric">{formatAmount(row.purchasedAmount, currency)}</td>
                  <td className="is-numeric">{formatAmount(row.appliedAmount, currency)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="9" className="sales-analysis-report__empty">No detail records found.</td>
              </tr>
            )}
          </tbody>
          {rows.length ? (
            <tfoot>
              <tr>
                <td colSpan="7">&nbsp;</td>
                <td className="is-numeric">{formatAmount(totals.purchasedAmount, currency)}</td>
                <td className="is-numeric">{formatAmount(totals.appliedAmount, currency)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    );
  };

  const renderReportView = () => {
    const isDetail = Boolean(detailResult);
    const result = detailResult || summaryResult;

    const reportStyle = {
      ...(reportWindow.windowProps?.style || {}),
    };

    return (
      <div
        className={`sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? ' is-minimized' : ''}${reportWindow.isMaximized ? ' is-maximized' : ''}`}
        {...reportWindow.windowProps}
        style={reportStyle}
      >
        <div className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
          <div className="sales-analysis-window__title sap-report-title">
            {result?.title || 'Purchase Analysis Report'}
          </div>
          <div className="sales-analysis-window__controls">
            <button
              type="button"
              aria-label={reportWindow.isMinimized ? 'Restore' : 'Minimize'}
              onClick={handleMinimizeReportWindow}
            >
              {reportWindow.isMinimized ? '□' : '-'}
            </button>
            <button type="button" aria-label={reportWindow.isMaximized ? 'Restore' : 'Maximize'} title={reportWindow.isMaximized ? 'Restore' : 'Maximize'} onClick={reportWindow.toggleMaximize}>[]</button>
            <button type="button" aria-label="Close" onClick={handleCloseReportWindow}>x</button>
          </div>
        </div>

        <div className="sales-analysis-window__accent" />

        {!reportWindow.isMinimized ? (
          <div className="sales-analysis-window__body sales-analysis-window__body--report">
            <div className="sales-analysis-report__hint">
              {isDetail 
                ? "Double-click on a row to open document (if supported)." 
                : criteria.displayMode === 'individual' 
                  ? "Double-click on row number for a detailed display." 
                  : "The report is grouped based on your selection criteria."}
            </div>
            
            {isDetail ? renderDetailGrid() : renderSummaryGrid()}

            {renderReportFooter()}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="sales-analysis-page sap-report-page" style={{ overflow: 'hidden', position: 'relative', width: '100%', height: '100%' }}>
      {message && <div className="im-alert im-alert--error" style={{ margin: "10px 12px 0", position: "absolute", zIndex: 1000, top: 0, left: 0, right: 0 }}>{message}</div>}

      <div
        className={`sales-analysis-window sap-report-window${criteriaWindow.isMinimized ? ' is-minimized' : ''}${criteriaWindow.isMaximized ? ' is-maximized' : ''}`}
        {...criteriaWindow.windowProps}
        style={{
          ...(criteriaWindow.windowProps?.style || {}),
        }}
      >
        <div className="sales-analysis-window__titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
          <div className="sales-analysis-window__title sap-report-title">Purchase Analysis Report - Selection Criteria</div>
          <div className="sales-analysis-window__controls">
            <button
              type="button"
              aria-label={criteriaWindow.isMinimized ? 'Restore' : 'Minimize'}
              onClick={handleMinimizeCriteriaWindow}
            >
              {criteriaWindow.isMinimized ? '□' : '-'}
            </button>
            <button type="button" aria-label={criteriaWindow.isMaximized ? 'Restore' : 'Maximize'} title={criteriaWindow.isMaximized ? 'Restore' : 'Maximize'} onClick={criteriaWindow.toggleMaximize}>[]</button>
            <button type="button" aria-label="Close" onClick={handleCloseCriteriaWindow}>x</button>
          </div>
        </div>

        <div className="sales-analysis-window__accent" />

        {!criteriaWindow.isMinimized ? (
          <div className="sales-analysis-window__body">
            <div className="sales-analysis-tabs" role="tablist" aria-label="Purchase analysis filters">
              {[
                { id: 'customers', label: 'Suppliers' },
                { id: 'items', label: 'Items' },
                { id: 'salesEmployees', label: 'Sales Employees' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={criteria.tab === tab.id}
                  className={`sales-analysis-tabs__tab${criteria.tab === tab.id ? ' is-active' : ''}`}
                  onClick={() => handleChange('tab', tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="sales-analysis-panel">
              <div className="sales-analysis-panel__row">
                <div className="sales-analysis-panel__option-group">
                  {[
                    { value: 'annual', label: 'Annual Report' },
                    { value: 'monthly', label: 'Monthly Report' },
                    { value: 'quarterly', label: 'Quarterly Report' },
                  ].map((option) => (
                    <label className="sales-analysis__radio-line" key={option.value}>
                      <input
                        type="radio"
                        checked={criteria.reportPeriod === option.value}
                        onChange={() => handleChange('reportPeriod', option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>

                <div className="sales-analysis-panel__option-group">
                  {[
                    { value: 'invoices', label: 'A/P Invoices' },
                    { value: 'orders', label: 'Purchase Orders' },
                    { value: 'goodsReceiptPO', label: 'Goods Receipt PO' },
                  ].map((option) => (
                    <label className="sales-analysis__radio-line" key={option.value}>
                      <input
                        type="radio"
                        checked={criteria.documentType === option.value}
                        onChange={() => handleChange('documentType', option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>

                {criteria.tab !== 'salesEmployees' ? (
                  <>
                    <div className="sales-analysis-panel__option-group">
                      {[
                        { value: 'individual', label: 'Individual Display' },
                        { value: 'group', label: 'Group Display' },
                      ].map((option) => (
                        <label className="sales-analysis__radio-line" key={option.value}>
                          <input
                            type="radio"
                            checked={criteria.displayMode === option.value}
                            onChange={() => handleChange('displayMode', option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>

                    <div className="sales-analysis-panel__option-group">
                      {(criteria.tab === 'customers' 
                        ? [
                            { value: 'totalByCustomer', label: 'Group by Supplier' },
                            { value: 'totalByBlanketAgreement', label: 'Total by Blanket Agreement' },
                          ] 
                        : [
                            { value: 'none', label: 'No Totals' },
                            { value: 'totalByCustomer', label: 'Group by Supplier' },
                            { value: 'totalBySalesEmployee', label: 'Total by Sales Employee' },
                          ]
                      ).map((option) => (
                        <label className="sales-analysis__radio-line" key={option.value}>
                          <input
                            type="radio"
                            checked={criteria.totalType === option.value}
                            onChange={() => handleChange('totalType', option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>

              <div className="sales-analysis-divider" />

              <div className="sales-analysis__dates">
                {renderDateRow('postingDate', 'Posting Date')}
                {renderDateRow('dueDate', 'Due Date')}
                {renderDateRow('documentDate', 'Document Date')}
              </div>

              <div className="sales-analysis-divider" />

              <section className="sales-analysis__section">
                <div className="sales-analysis__section-title">Main Selection</div>
                {renderMainSelection()}
              </section>

              <label className="sales-analysis__checkbox-line sales-analysis__system-currency">
                <input
                  type="checkbox"
                  checked={criteria.displaySystemCurrency}
                  onChange={(event) => handleChange('displaySystemCurrency', event.target.checked)}
                />
                <span>Display Amounts in System Currency</span>
              </label>

              {loading ? <div className="sales-analysis__status">Loading Purchase Analysis report...</div> : null}
            </div>

            <div className="sales-analysis-window__footer">
              <button type="button" className="sales-analysis__sap-btn" onClick={handleRun}>OK</button>
              <button type="button" className="sales-analysis__sap-btn sales-analysis__sap-btn--secondary" onClick={() => { setCriteria(createInitialCriteria()); setMessage(""); }}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>

      { (summaryResult || detailResult) && renderReportView() }

      <SapLookupModal
        open={lookupState.open}
        title={
          lookupState.type === "vendors"
            ? "Choose From List - Suppliers"
            : lookupState.type === "items"
              ? "Choose From List - Items"
              : "Choose From List - Sales Employees"
        }
        columns={
          lookupState.type === "vendors"
            ? [
                { key: "code", label: "Code" },
                { key: "name", label: "Supplier Name" },
                { key: "groupName", label: "Group" },
              ]
            : lookupState.type === "items"
              ? [
                  { key: "code", label: "Code" },
                  { key: "name", label: "Item Description" },
                  { key: "groupName", label: "Item Group" },
                ]
              : [
                  { key: "code", label: "Code" },
                  { key: "name", label: "Sales Employee Name" },
                ]
        }
        fetchOptions={getLookupFetcher()}
        onClose={() => setLookupState((previous) => ({ ...previous, open: false }))}
        onSelect={handleLookupSelect}
      />

      <SalesAnalysisPropertiesModal
        open={propertiesModal.open}
        title={propertiesModal.type === "customer" ? "Supplier Properties" : "Item Properties"}
        mode={propertiesModal.type === "customer" ? criteria.customer.propertiesMode : criteria.item.propertiesMode}
        properties={propertiesModal.type === "customer" ? criteria.customer.properties : criteria.item.properties}
        options={propertiesModal.type === "customer" ? customerProperties : itemProperties}
        onModeChange={(value) => handleChange(`${propertiesModal.type}.propertiesMode`, value)}
        onToggleProperty={(propertyNumber) => handleToggleProperty(propertiesModal.type, propertyNumber)}
        onClose={() => setPropertiesModal({ open: false, type: propertiesModal.type })}
        onApply={() => setPropertiesModal({ open: false, type: propertiesModal.type })}
      />
    </div>
  );
}
