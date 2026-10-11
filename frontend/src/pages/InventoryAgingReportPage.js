import SapDateInput from '../components/common/SapDateInput';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchItemGroups, fetchItemProperties } from "../api/itemApi";
import { fetchInventoryAgingLookups, fetchInventoryAgingReport } from "../api/inventoryAgingApi";
import ItemLookupModal from "../components/reports/ItemLookupModal";
import PropertiesSelectionModal from "../components/reports/PropertiesSelectionModal";
import WarehouseLookupModal from "../components/reports/WarehouseLookupModal";
import useFloatingWindow from "../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../components/SapWindowTaskbarContext";
import { matchesSapSearchText } from "../utils/sapSearch";
import "../styles/inventory-aging-report.css";
import "../styles/sales-analysis-report.css";
import "../styles/inventory-report-common.css";

const DEFAULT_PROPERTIES = Array.from({ length: 64 }, (_, index) => ({
  number: index + 1,
  name: `Items Property ${index + 1}`,
}));

const EMPTY_INTERVALS = Array.from({ length: 5 }, () => ({ days: "", from: "", to: "" }));

const formatSapShortDate = (date = new Date()) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
};

const initialCriteria = {
  reportDate: formatSapShortDate(),
  issueStrategy: "lifo",
  valuation: "document",
  itemFrom: "",
  itemTo: "",
  groupCode: "*",
  propertyFilter: {
    ignoreProperties: true,
    linkMode: "or",
    exactlyMatch: false,
    selectedPropertyNumbers: [],
  },
  includeWarehouses: false,
  includeWarehouseFrom: "",
  includeWarehouseTo: "",
  excludeWarehouses: false,
  excludeWarehouseFrom: "",
  excludeWarehouseTo: "",
  intervals: EMPTY_INTERVALS,
};

const parseSapDateToIso = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return "";

  const [, dayText, monthText, yearText] = match;
  const year = yearText.length === 2 ? `20${yearText}` : yearText;
  return `${year}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}`;
};

const isoToSapDate = (value) => {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  return `${day}/${month}/${year.slice(2)}`;
};

const formatQuantity = (value) =>
  Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const formatAmount = (value) =>
  Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const getIntervalLabel = (interval) => {
  if (!interval) return "";
  if (interval.to === null || interval.to === "") return `${interval.from}+`;
  return `${interval.from}-${interval.to}`;
};

function InventoryAgingReportPage() {
  const navigate = useNavigate();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const [criteria, setCriteria] = useState(initialCriteria);
  const [groups, setGroups] = useState([{ code: "*", name: "All" }]);
  const [warehouses, setWarehouses] = useState([]);
  const [properties, setProperties] = useState(DEFAULT_PROPERTIES);
  const [lookupTarget, setLookupTarget] = useState("");
  const [showProperties, setShowProperties] = useState(false);
  const [report, setReport] = useState(null);
  const [findText, setFindText] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const reportDateNativeInputRef = useRef(null);

  const filterWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 16,
    taskId: "inventory-aging-filter",
    taskTitle: "Inventory Aging Report Filter",
    taskPath: "/reports/inventory/aging",
    bounds: "parent",
  });
  const reportWindow = useFloatingWindow({
    isOpen: Boolean(report),
    defaultTop: 12,
    taskId: "inventory-aging-report",
    taskTitle: "Inventory Aging Report",
    taskPath: "/reports/inventory/aging",
    bounds: "parent",
  });

  useEffect(() => {
    let mounted = true;

    Promise.allSettled([
      fetchInventoryAgingLookups(),
      fetchItemGroups(""),
      fetchItemProperties(),
    ]).then(([agingLookupResult, itemGroupResult, itemPropertyResult]) => {
      if (!mounted) return;

      if (agingLookupResult.status === "fulfilled") {
        const data = agingLookupResult.value || {};
        const lookupGroups = Array.isArray(data.itemGroups) && data.itemGroups.length ? data.itemGroups : [{ code: "*", name: "All" }];
        setGroups(lookupGroups);
        setWarehouses(Array.isArray(data.warehouses) ? data.warehouses : []);
      } else {
        const error = agingLookupResult.reason;
        setMessage(error?.response?.status === 404
          ? "Report API was not found. Restart the backend service and refresh this page."
          : error?.response?.data?.message || error?.message || "Could not load Inventory Aging lookups.");
      }

      if (itemGroupResult.status === "fulfilled") {
        const itemGroups = itemGroupResult.value;
        if (Array.isArray(itemGroups) && itemGroups.length) {
          setGroups(itemGroups);
        }
      }

      if (itemPropertyResult.status === "fulfilled") {
        const itemProperties = itemPropertyResult.value;
        setProperties(Array.isArray(itemProperties) && itemProperties.length ? itemProperties : DEFAULT_PROPERTIES);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const setField = (field, value) => {
    setCriteria((current) => ({ ...current, [field]: value }));
  };

  const propertyLabel = criteria.propertyFilter.ignoreProperties
    ? "Ignore"
    : `${criteria.propertyFilter.selectedPropertyNumbers.length} Selected`;

  const filteredRows = useMemo(() => {
    const rows = report?.rows || [];
    const search = findText.trim();
    if (!search) return rows;
    return rows.filter((row) =>
      matchesSapSearchText(`${row.itemCode} ${row.itemName} ${row.whsCode} ${row.whsName}`, search),
    );
  }, [findText, report]);

  const setIntervalField = (index, field, value) => {
    setCriteria((current) => {
      const intervals = current.intervals.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [field]: value } : row
      ));

      if (field === "days" && value !== "") {
        const days = Number(value);
        if (Number.isFinite(days) && days > 0) {
          const previousTo = index > 0 ? Number(intervals[index - 1].to) : -1;
          const from = Number.isFinite(previousTo) && previousTo >= 0 ? previousTo + 1 : 0;
          intervals[index] = {
            ...intervals[index],
            from: String(from),
            to: String(from + Math.floor(days) - 1),
          };
        }
      }

      return { ...current, intervals };
    });
  };

  const handleRun = async () => {
    setLoading(true);
    setMessage("");
    try {
      setReport(await fetchInventoryAgingReport(criteria));
      setFindText("");
    } catch (error) {
      setReport(null);
      setMessage(error?.response?.data?.message || error?.message || "Could not load Inventory Aging report.");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseFilter = () => {
    if (!closeActiveAndRestorePrevious()) navigate("/dashboard");
  };

  const handleSelectItem = (row) => {
    if (lookupTarget === "itemFrom" || lookupTarget === "itemTo") {
      setField(lookupTarget, row.ItemCode || "");
    }
    setLookupTarget("");
  };

  const handleSelectWarehouse = (warehouse) => {
    if (lookupTarget) setField(lookupTarget, warehouse.code || "");
    setLookupTarget("");
  };

  const openReportDatePicker = () => {
    const input = reportDateNativeInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  };

  const renderControls = (windowFrame, onClose) => (
    <div className="iag-window__controls sales-analysis-window__controls">
      <button type="button" aria-label={windowFrame.isMinimized ? "Restore" : "Minimize"} onClick={windowFrame.toggleMinimize}>
        {windowFrame.isMinimized ? "[]" : "-"}
      </button>
      <button type="button" aria-label={windowFrame.isMaximized ? "Restore Down" : "Maximize"} onClick={windowFrame.toggleMaximize}>[]</button>
      <button type="button" aria-label="Close" onClick={onClose}>x</button>
    </div>
  );

  const renderFilterWindow = () => (
    <section className={`iag-window sales-analysis-window sap-report-window${filterWindow.isMinimized ? " is-minimized" : ""}${filterWindow.isMaximized ? " is-maximized" : ""}`} {...filterWindow.windowProps}>
      <header className="iag-window__titlebar sales-analysis-window__titlebar sap-report-titlebar" {...filterWindow.titleBarProps}>
        <span className="sales-analysis-window__title sap-report-title">Inventory Aging Report Filter</span>
        {renderControls(filterWindow, handleCloseFilter)}
      </header>
      <div className="iag-window__accent sales-analysis-window__accent" />
      {!filterWindow.isMinimized ? (
        <div className="iag-window__body sales-analysis-window__body">
          <div className="iag-layout">
            <div className="iag-left">
              <div className="iag-report-date">
                <label>Report Date</label>
                <div className="iag-date-input">
                  <input value={criteria.reportDate} onChange={(event) => setField("reportDate", event.target.value)} />
                  <SapDateInput
                    ref={reportDateNativeInputRef}
                    
                    className="iag-date-native-input"
                    tabIndex={-1}
                    value={parseSapDateToIso(criteria.reportDate)}
                    onChange={(event) => setField("reportDate", isoToSapDate(event.target.value))}
                  />
                  <button type="button" aria-label="Open calendar" onClick={openReportDatePicker}>...</button>
                </div>
              </div>

              <section className="iag-section">
                <div className="iag-section__title">Items</div>
                <div className="iag-items">
                  <div className="iag-range-row">
                    <label>Code From</label>
                    <div className="iag-lookup">
                      <input value={criteria.itemFrom} onDoubleClick={() => setLookupTarget("itemFrom")} onChange={(event) => setField("itemFrom", event.target.value)} />
                      <button type="button" onClick={() => setLookupTarget("itemFrom")}>...</button>
                    </div>
                    <span>To</span>
                    <div className="iag-lookup">
                      <input value={criteria.itemTo} onDoubleClick={() => setLookupTarget("itemTo")} onChange={(event) => setField("itemTo", event.target.value)} />
                      <button type="button" onClick={() => setLookupTarget("itemTo")}>...</button>
                    </div>
                  </div>

                  <div className="iag-group-row">
                    <label>Item Group</label>
                    <select value={criteria.groupCode} onChange={(event) => setField("groupCode", event.target.value)}>
                      <option value="*">All</option>
                      {groups.filter((group) => group.code !== "*").map((group) => (
                        <option key={group.code} value={group.code}>{group.name || group.code}</option>
                      ))}
                    </select>
                  </div>

                  <div className="iag-property-row">
                    <button type="button" className="iag-btn iag-btn--field sap-report-btn sap-report-property-btn" onClick={() => setShowProperties(true)}>Properties</button>
                    <input value={propertyLabel} readOnly />
                  </div>
                </div>
              </section>

              <section className="iag-section iag-section--warehouses">
                <div className="iag-section__title">Warehouses</div>
                <div className="iag-warehouse-ranges">
                  <label><input type="checkbox" checked={criteria.includeWarehouses} onChange={(event) => setField("includeWarehouses", event.target.checked)} /> Including</label>
                  <span>From</span>
                  <div className="iag-lookup">
                    <input value={criteria.includeWarehouseFrom} disabled={!criteria.includeWarehouses} onChange={(event) => setField("includeWarehouseFrom", event.target.value)} />
                    <button type="button" disabled={!criteria.includeWarehouses} onClick={() => setLookupTarget("includeWarehouseFrom")}>...</button>
                  </div>
                  <span>To</span>
                  <div className="iag-lookup">
                    <input value={criteria.includeWarehouseTo} disabled={!criteria.includeWarehouses} onChange={(event) => setField("includeWarehouseTo", event.target.value)} />
                    <button type="button" disabled={!criteria.includeWarehouses} onClick={() => setLookupTarget("includeWarehouseTo")}>...</button>
                  </div>

                  <label><input type="checkbox" checked={criteria.excludeWarehouses} onChange={(event) => setField("excludeWarehouses", event.target.checked)} /> Excluding</label>
                  <span>From</span>
                  <div className="iag-lookup">
                    <input value={criteria.excludeWarehouseFrom} disabled={!criteria.excludeWarehouses} onChange={(event) => setField("excludeWarehouseFrom", event.target.value)} />
                    <button type="button" disabled={!criteria.excludeWarehouses} onClick={() => setLookupTarget("excludeWarehouseFrom")}>...</button>
                  </div>
                  <span>To</span>
                  <div className="iag-lookup">
                    <input value={criteria.excludeWarehouseTo} disabled={!criteria.excludeWarehouses} onChange={(event) => setField("excludeWarehouseTo", event.target.value)} />
                    <button type="button" disabled={!criteria.excludeWarehouses} onClick={() => setLookupTarget("excludeWarehouseTo")}>...</button>
                  </div>
                </div>
              </section>
            </div>

            <div className="iag-divider" />

            <div className="iag-right">
              <div className="iag-option-block">
                <span>Issue Strategy</span>
                <label><input type="radio" name="issueStrategy" checked={criteria.issueStrategy === "lifo"} onChange={() => setField("issueStrategy", "lifo")} /> LIFO</label>
                <label><input type="radio" name="issueStrategy" checked={criteria.issueStrategy === "fifo"} onChange={() => setField("issueStrategy", "fifo")} /> FIFO</label>
              </div>

              <div className="iag-option-block iag-option-block--valuation">
                <span>Valuation</span>
                <label><input type="radio" name="valuation" checked={criteria.valuation === "document"} onChange={() => setField("valuation", "document")} /> Document Price</label>
                <label><input type="radio" name="valuation" checked={criteria.valuation === "current"} onChange={() => setField("valuation", "current")} /> Current Price</label>
              </div>

              <section className="iag-section iag-section--intervals">
                <div className="iag-section__title">Time Intervals</div>
                <div className="iag-interval-grid">
                  <div className="iag-interval-grid__header">
                    <span>#</span>
                    <span>Days</span>
                    <span>From</span>
                    <span>To</span>
                  </div>
                  {criteria.intervals.map((row, index) => (
                    <div className="iag-interval-grid__row" key={index}>
                      <span>{index + 1}</span>
                      <input value={row.days} onChange={(event) => setIntervalField(index, "days", event.target.value)} />
                      <input value={row.from} onChange={(event) => setIntervalField(index, "from", event.target.value)} />
                      <input value={row.to} onChange={(event) => setIntervalField(index, "to", event.target.value)} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {message ? <div className="iag-status">{message}</div> : null}

          <footer className="iag-footer sales-analysis-window__footer">
            <button type="button" className="iag-btn sap-report-btn sap-report-btn--primary" disabled={loading} onClick={handleRun}>{loading ? "Loading..." : "OK"}</button>
            <button type="button" className="iag-btn iag-btn--secondary sap-report-btn" onClick={handleCloseFilter}>Cancel</button>
          </footer>
        </div>
      ) : null}
    </section>
  );

  const renderReportWindow = () => report ? (
    <section className={`iag-window iag-window--report sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? " is-minimized" : ""}${reportWindow.isMaximized ? " is-maximized" : ""}`} {...reportWindow.windowProps}>
      <header className="iag-window__titlebar sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
        <span className="sales-analysis-window__title sap-report-title">Inventory Aging Report</span>
        {renderControls(reportWindow, () => setReport(null))}
      </header>
      <div className="iag-window__accent sales-analysis-window__accent" />
      {!reportWindow.isMinimized ? (
        <div className="iag-report-body sales-analysis-window__body sales-analysis-window__body--report">
          <div className="iag-report-toolbar">
            <label>Find <input value={findText} onChange={(event) => setFindText(event.target.value)} /></label>
            <span>{report.sourceTable ? `Source: ${report.sourceTable}` : ""}</span>
          </div>
          <div className="iag-report-grid-wrap sales-analysis-report__grid-wrap">
            <table className="iag-report-grid sales-analysis-report__grid">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item No.</th>
                  <th>Item Description</th>
                  <th>Whse</th>
                  <th>In Stock</th>
                  <th>Total Value</th>
                  {(report.intervals || []).map((interval) => (
                    <React.Fragment key={interval.index}>
                      <th>{getIntervalLabel(interval)} Qty</th>
                      <th>{getIntervalLabel(interval)} Value</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length ? filteredRows.map((row, index) => (
                  <tr key={`${row.itemCode}-${row.whsCode}-${index}`}>
                    <td className="is-row-number">{index + 1}</td>
                    <td>
                      <button type="button" className="iag-item-link sales-analysis-report__link-cell" onClick={() => navigate(`/item-master?itemCode=${encodeURIComponent(row.itemCode)}`)}>
                        <span className="sales-analysis-report__link-icon" aria-hidden="true">-></span>
                        <span>{row.itemCode}</span>
                      </button>
                    </td>
                    <td>{row.itemName}</td>
                    <td title={row.whsName}>{row.whsCode}</td>
                    <td className="is-number">{formatQuantity(row.closingQuantity)}</td>
                    <td className="is-number">{formatAmount(row.totalValue)}</td>
                    {(report.intervals || []).map((interval, bucketIndex) => {
                      const bucket = row.buckets?.[bucketIndex] || {};
                      return (
                        <React.Fragment key={`${row.itemCode}-${interval.index}`}>
                          <td className="is-number">{formatQuantity(bucket.quantity)}</td>
                          <td className="is-number">{formatAmount(bucket.value)}</td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                )) : (
                  <tr>
                    <td className="sales-analysis-report__empty" colSpan={6 + ((report.intervals || []).length * 2)}>No inventory aging rows found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="sales-analysis-report__footer">
            <button type="button" className="iag-back sales-analysis-report__back-btn" aria-label="Back to selection criteria" onClick={() => setReport(null)}>{"<"}</button>
          </div>
        </div>
      ) : null}
    </section>
  ) : null;

  return (
    <div className="iag-page sales-analysis-page sap-report-page">
      {renderFilterWindow()}
      {renderReportWindow()}

      <ItemLookupModal
        isOpen={lookupTarget === "itemFrom" || lookupTarget === "itemTo"}
        onClose={() => setLookupTarget("")}
        onSelect={handleSelectItem}
      />
      <WarehouseLookupModal
        isOpen={lookupTarget.toLowerCase().includes("warehouse")}
        onClose={() => setLookupTarget("")}
        onSelect={handleSelectWarehouse}
        warehouses={warehouses}
      />
      <PropertiesSelectionModal
        isOpen={showProperties}
        title="Properties"
        propertyLabelPrefix="Items Property"
        properties={properties}
        value={criteria.propertyFilter}
        onClose={() => setShowProperties(false)}
        onSave={(value) => setField("propertyFilter", value)}
      />
    </div>
  );
}

export default InventoryAgingReportPage;
