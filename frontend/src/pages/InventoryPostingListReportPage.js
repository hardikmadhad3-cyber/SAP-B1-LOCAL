import SapDateInput from '../components/common/SapDateInput';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchInventoryPostingList, fetchInventoryPostingListLookups } from "../api/inventoryPostingListApi";
import { fetchItemGroups, fetchItemProperties, fetchWarehouses } from "../api/itemApi";
import BusinessPartnerLookupModal from "../components/reports/BusinessPartnerLookupModal";
import ItemLookupModal from "../components/reports/ItemLookupModal";
import PropertiesSelectionModal from "../components/reports/PropertiesSelectionModal";
import ResourceLookupModal from "../components/reports/ResourceLookupModal";
import WarehouseLookupModal from "../components/reports/WarehouseLookupModal";
import useFloatingWindow from "../components/reports/useFloatingWindow";
import { useSapWindowTaskbarActions } from "../components/SapWindowTaskbarContext";
import "../styles/item-list-report.css";
import "../styles/inventory-posting-list-report.css";
import "../styles/sales-analysis-report.css";
import "../styles/inventory-report-common.css";

const DEFAULT_ITEM_PROPERTIES = Array.from({ length: 64 }, (_, index) => ({
  number: index + 1,
  name: `Items Property ${index + 1}`,
}));

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

const ITEM_TABS = [
  { key: "items", label: "Items" },
  { key: "resources", label: "Resources" },
  { key: "bp", label: "BP" },
  { key: "other", label: "Other" },
];

const OTHER_SELECTION_OPTIONS = [
  ["warehouseCode", "Warehouse Code"],
  ["salesEmployee", "Sales Employee"],
  ["projectCode", "Project Code"],
  ["blockNumber", "Block Number"],
  ["vendorCatalogNo", "Vendor Catalog No."],
  ["serialNumber", "Serial Number"],
  ["receiptQuantity", "Receipt Quantity"],
  ["issueQuantity", "Issue Quantity"],
  ["importLog", "Import Log"],
  ["location", "Location"],
  ["document", "Document"],
];

const ORIGINAL_JOURNAL_GROUPS = [
  [
    ["delivery", "Delivery"],
    ["return", "Return"],
    ["arInvoice", "A/R Invoice"],
    ["arCreditMemo", "A/R Credit Memo"],
  ],
  [
    ["goodsReceiptPO", "Goods Receipt PO"],
    ["goodsReturn", "Goods Return"],
    ["apInvoice", "A/P Invoice"],
    ["apCreditMemo", "A/P Credit Memo"],
  ],
  [
    ["goodsReceipt", "Goods Receipt"],
    ["goodsIssue", "Goods Issue"],
    ["inventoryTransfer", "Inventory Transfer"],
  ],
  [
    ["inventoryOpeningBalance", "Inventory Opening Balance"],
    ["inventoryPosting", "Inventory Posting"],
    ["inventoryRevaluation", "Inventory Revaluation"],
  ],
  [
    ["receiptFromProduction", "Receipt from Production"],
    ["issueForProduction", "Issue for Production"],
  ],
];

const GENERAL_PARAMETER_ROWS = [
  ["reference", "Reference"],
  ["reference2", "Reference 2"],
  ["quantityReceived", "Quantity Received", "0.000", "0.000"],
  ["quantityReleased", "Quantity Released", "0.000", "0.000"],
  ["price", "Price", "0.00", "0.00"],
  ["dueDate", "Due Date"],
  ["salesEmployee", "Sales Employee", "", "Zankhana"],
  ["detailsContained", "Details Contained"],
  ["project", "Project"],
  ["blockNo", "Block No."],
  ["importLog", "Import Log"],
  ["batch", "Batch"],
  ["batchAttribute1", "Batch Attribute 1"],
  ["batchAttribute2", "Batch Attribute 2"],
  ["serialNumber", "Serial Number"],
  ["mfrSerialNo", "Mfr Serial No."],
  ["lotNumber", "Lot Number"],
  ["itemCode", "Item Code", "", "", true],
  ["bpCode", "BP Code"],
  ["routeStage", "Route Stage"],
  ["routeSequence", "Route Sequence"],
];

const makeGeneralParameters = () =>
  GENERAL_PARAMETER_ROWS.reduce((rows, [key, , from = "", to = ""]) => ({
    ...rows,
    [key]: { enabled: false, from, to },
  }), {});

const createInitialState = () => ({
  itemFrom: "",
  itemTo: "",
  groupCode: "*",
  hideNoStock: false,
  dateEnabled: true,
  dateFrom: "01/01/23",
  dateTo: "31/03/23",
  hideTransWithoutQtyChange: false,
  sort: false,
  splitByBatchSerial: false,
  printSeparatePage: false,
  printDirectly: false,
  displaySubtotals: {
    daily: true,
    monthly: true,
    yearly: true,
  },
  propertyFilter: {
    ignoreProperties: true,
    linkMode: "and",
    exactlyMatch: false,
    selectedPropertyNumbers: [],
  },
  resourceSelection: {
    codeFrom: "",
    codeTo: "",
    groupCode: "*",
    propertyFilter: {
      ignoreProperties: true,
      linkMode: "and",
      exactlyMatch: false,
      selectedPropertyNumbers: [],
    },
  },
  bpSelection: {
    codeFrom: "",
    codeTo: "",
    customerGroup: "*",
    vendorGroup: "*",
    propertyFilter: {
      ignoreProperties: true,
      linkMode: "and",
      exactlyMatch: false,
      selectedPropertyNumbers: [],
    },
  },
  otherSelection: {
    by: "warehouseCode",
    selectedValues: [],
  },
  locationSelection: {
    mode: "location",
    locationCodes: [],
    warehouseCodes: [],
  },
  warehouseSelection: {
    mode: "location",
    includeEnabled: true,
    includeFrom: "",
    includeTo: "",
    excludeEnabled: false,
    excludeFrom: "",
    excludeTo: "",
  },
  expanded: {
    documentTypes: {},
    generalParameters: makeGeneralParameters(),
  },
});

const normalizeWarehouse = (warehouse) => ({
  code: warehouse.WarehouseCode || warehouse.WhsCode || warehouse.code || "",
  name: warehouse.WarehouseName || warehouse.WhsName || warehouse.name || "",
  locationCode: String(warehouse.LocationCode || warehouse.Location || warehouse.locationCode || warehouse.City || "General"),
  locationName: warehouse.LocationName || warehouse.Location || warehouse.locationName || warehouse.City || "General",
});

const formatQuantity = (value, decimals = 3) =>
  Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

const formatCurrency = (value) =>
  `INR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getFullYear()).slice(-2)}`;
};

const getDateKey = (value, mode) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (mode === "year") return String(year);
  if (mode === "month") return `${year}-${month}`;
  return `${year}-${month}-${day}`;
};

const getSubtotalLabel = (mode) => {
  if (mode === "year") return "Yearly Subtotal";
  if (mode === "month") return "Monthly Subtotal";
  return "Daily Subtotal";
};

const addToSubtotal = (subtotal, row) => ({
  recQty: subtotal.recQty + Number(row.recQty || 0),
  issQty: subtotal.issQty + Number(row.issQty || 0),
});

const emptySubtotal = () => ({ recQty: 0, issQty: 0 });

const buildDisplayRows = (rows, displaySubtotals) => {
  const output = [];
  const sortedRows = [...(rows || [])].sort((left, right) =>
    String(left.itemCode || "").localeCompare(String(right.itemCode || ""))
    || new Date(left.postingDate || 0) - new Date(right.postingDate || 0)
    || String(left.document || "").localeCompare(String(right.document || "")),
  );

  let currentItem = "";
  let dailyKey = "";
  let monthlyKey = "";
  let yearlyKey = "";
  let dailySubtotal = emptySubtotal();
  let monthlySubtotal = emptySubtotal();
  let yearlySubtotal = emptySubtotal();

  const flush = (type) => {
    const mode = type === "yearly" ? "year" : type === "monthly" ? "month" : "day";
    const enabled = displaySubtotals[type];
    const subtotal = type === "yearly" ? yearlySubtotal : type === "monthly" ? monthlySubtotal : dailySubtotal;
    if (!enabled || (!subtotal.recQty && !subtotal.issQty)) return;
    output.push({
      kind: "subtotal",
      id: `${currentItem}-${type}-${output.length}`,
      label: getSubtotalLabel(mode),
      recQty: subtotal.recQty,
      issQty: subtotal.issQty,
    });
  };

  sortedRows.forEach((row, index) => {
    const nextItem = row.itemCode || "";
    const nextDailyKey = getDateKey(row.postingDate, "day");
    const nextMonthlyKey = getDateKey(row.postingDate, "month");
    const nextYearlyKey = getDateKey(row.postingDate, "year");

    if (currentItem && nextItem !== currentItem) {
      flush("daily");
      flush("monthly");
      flush("yearly");
      dailySubtotal = emptySubtotal();
      monthlySubtotal = emptySubtotal();
      yearlySubtotal = emptySubtotal();
      dailyKey = "";
      monthlyKey = "";
      yearlyKey = "";
    } else {
      if (dailyKey && nextDailyKey !== dailyKey) {
        flush("daily");
        dailySubtotal = emptySubtotal();
      }
      if (monthlyKey && nextMonthlyKey !== monthlyKey) {
        flush("monthly");
        monthlySubtotal = emptySubtotal();
      }
      if (yearlyKey && nextYearlyKey !== yearlyKey) {
        flush("yearly");
        yearlySubtotal = emptySubtotal();
      }
    }

    if (nextItem !== currentItem) {
      currentItem = nextItem;
      output.push({
        kind: "item",
        id: `${nextItem || "item"}-${index}`,
        itemCode: row.itemCode,
        itemName: row.itemName,
        balance: row.balance,
      });
    }

    dailyKey = nextDailyKey;
    monthlyKey = nextMonthlyKey;
    yearlyKey = nextYearlyKey;
    dailySubtotal = addToSubtotal(dailySubtotal, row);
    monthlySubtotal = addToSubtotal(monthlySubtotal, row);
    yearlySubtotal = addToSubtotal(yearlySubtotal, row);
    output.push({ kind: "row", id: `${row.itemCode}-${row.document}-${index}`, ...row });
  });

  if (currentItem) {
    flush("daily");
    flush("monthly");
    flush("yearly");
  }

  return output;
};

function InventoryPostingListReportPage() {
  const navigate = useNavigate();
  const { company } = useAuth();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const [formState, setFormState] = useState(createInitialState);
  const [activeItemTab, setActiveItemTab] = useState("items");
  const [activeLocationTab, setActiveLocationTab] = useState("location");
  const [itemGroups, setItemGroups] = useState([{ code: "*", name: "*" }]);
  const [bpGroups, setBpGroups] = useState([]);
  const [resources, setResources] = useState([]);
  const [salesEmployees, setSalesEmployees] = useState([]);
  const [projects, setProjects] = useState([]);
  const [itemProperties, setItemProperties] = useState(DEFAULT_ITEM_PROPERTIES);
  const [warehouses, setWarehouses] = useState([]);
  const [expandedLocations, setExpandedLocations] = useState(() => new Set());
  const [propertiesTarget, setPropertiesTarget] = useState("");
  const [showExpanded, setShowExpanded] = useState(false);
  const [showOtherSelection, setShowOtherSelection] = useState(false);
  const [bpLookupTarget, setBpLookupTarget] = useState("");
  const [lookupTarget, setLookupTarget] = useState("");
  const [resourceLookupTarget, setResourceLookupTarget] = useState("");
  const [warehouseLookupTarget, setWarehouseLookupTarget] = useState("");
  const dateNativeInputRefs = useRef({});
  const [reportResult, setReportResult] = useState(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);

  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 20,
    taskId: "inventory-posting-list-criteria",
    taskTitle: "Inventory Posting List - Selection Criteria",
    taskPath: "/reports/inventory/posting-list",
    bounds: "parent",
  });

  const reportWindow = useFloatingWindow({
    isOpen: Boolean(reportResult),
    defaultTop: 12,
    taskId: "inventory-posting-list-report",
    taskTitle: "Inventory Posting List",
    taskPath: "/reports/inventory/posting-list",
    bounds: "parent",
  });

  useEffect(() => {
    let isMounted = true;
    Promise.all([fetchItemGroups(""), fetchItemProperties(), fetchWarehouses(""), fetchInventoryPostingListLookups()])
      .then(([groups, properties, warehouseRows, lookups]) => {
        if (!isMounted) return;
        setItemGroups(Array.isArray(groups) && groups.length ? groups : [{ code: "*", name: "*" }]);
        setItemProperties(Array.isArray(properties) && properties.length ? properties : DEFAULT_ITEM_PROPERTIES);
        setBpGroups(Array.isArray(lookups?.bpGroups) ? lookups.bpGroups : []);
        setResources(Array.isArray(lookups?.resources) ? lookups.resources : []);
        setSalesEmployees(Array.isArray(lookups?.salesEmployees) ? lookups.salesEmployees : []);
        setProjects(Array.isArray(lookups?.projects) ? lookups.projects : []);
        const normalizedWarehouses = (Array.isArray(warehouseRows) ? warehouseRows : []).map(normalizeWarehouse);
        setWarehouses(normalizedWarehouses);
        setExpandedLocations(new Set(normalizedWarehouses.map((warehouse) => warehouse.locationCode)));
      })
      .catch((error) => {
        if (!isMounted) return;
        setStatusMessage(error?.response?.data?.message || error?.message || "Could not load inventory posting list lookups.");
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const locations = useMemo(() => {
    const map = new Map();
    warehouses.forEach((warehouse) => {
      const key = warehouse.locationCode || "General";
      if (!map.has(key)) {
        map.set(key, {
          code: key,
          name: warehouse.locationName || key,
          warehouses: [],
        });
      }
      map.get(key).warehouses.push(warehouse);
    });
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [warehouses]);

  const otherSelectionRows = useMemo(() => {
    if (formState.otherSelection.by === "warehouseCode") {
      return warehouses.map((row) => ({ code: row.code, name: row.name }));
    }
    if (formState.otherSelection.by === "location") {
      return locations.map((row) => ({ code: row.code, name: row.name }));
    }
    if (formState.otherSelection.by === "salesEmployee") {
      return salesEmployees;
    }
    if (formState.otherSelection.by === "projectCode") {
      return projects;
    }
    return [];
  }, [formState.otherSelection.by, locations, projects, salesEmployees, warehouses]);

  const displayRows = useMemo(
    () => buildDisplayRows(reportResult?.rows || [], formState.displaySubtotals),
    [formState.displaySubtotals, reportResult?.rows],
  );

  const propertyModeLabel = formState.propertyFilter.ignoreProperties
    ? "Ignore"
    : `${formState.propertyFilter.selectedPropertyNumbers.length} Selected`;

  const propertyLabel = (filter = {}) => filter.ignoreProperties
    ? "Ignore"
    : `${filter.selectedPropertyNumbers?.length || 0} Selected`;

  const customerGroups = bpGroups.filter((group) => !group.type || String(group.type).toUpperCase() === "C");
  const vendorGroups = bpGroups.filter((group) => !group.type || String(group.type).toUpperCase() === "S");

  const setField = (field, value) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const setNested = (section, patch) => {
    setFormState((current) => ({
      ...current,
      [section]: {
        ...current[section],
        ...patch,
      },
    }));
  };

  const setExpandedDocumentType = (key, checked) => {
    setFormState((current) => ({
      ...current,
      expanded: {
        ...current.expanded,
        documentTypes: {
          ...current.expanded.documentTypes,
          [key]: checked,
        },
      },
    }));
  };

  const setExpandedParameter = (key, patch) => {
    setFormState((current) => ({
      ...current,
      expanded: {
        ...current.expanded,
        generalParameters: {
          ...current.expanded.generalParameters,
          [key]: {
            ...current.expanded.generalParameters[key],
            ...patch,
          },
        },
      },
    }));
  };

  const toggleCode = (section, field, code) => {
    setFormState((current) => {
      const currentValues = current[section][field] || [];
      const exists = currentValues.includes(code);
      return {
        ...current,
        [section]: {
          ...current[section],
          [field]: exists ? currentValues.filter((value) => value !== code) : [...currentValues, code],
        },
      };
    });
  };

  const toggleLocationExpanded = (code) => {
    setExpandedLocations((current) => {
      const next = new Set(current);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const handleItemSelect = (item) => {
    const itemCode = String(item?.ItemCode || item?.itemCode || "");
    if (lookupTarget === "itemFrom" || lookupTarget === "itemTo") {
      setField(lookupTarget, itemCode);
    } else if (lookupTarget === "expanded.itemCode.from") {
      setExpandedParameter("itemCode", { from: itemCode });
    } else if (lookupTarget === "expanded.itemCode.to") {
      setExpandedParameter("itemCode", { to: itemCode });
    }
    setLookupTarget("");
  };

  const openItemLookup = (target) => {
    setLookupTarget(target);
    setStatusMessage("");
  };

  const handleBpSelect = (bp) => {
    if (bpLookupTarget) {
      setNested("bpSelection", { [bpLookupTarget]: String(bp?.CardCode || "") });
    }
    setBpLookupTarget("");
  };

  const handleResourceSelect = (resource) => {
    if (resourceLookupTarget) {
      setNested("resourceSelection", { [resourceLookupTarget]: resource?.code || "" });
    }
    setResourceLookupTarget("");
  };

  const handleWarehouseRangeSelect = (warehouse) => {
    if (warehouseLookupTarget) {
      setNested("warehouseSelection", { [warehouseLookupTarget]: warehouse?.code || "" });
    }
    setWarehouseLookupTarget("");
  };

  const getDateNativeInputRef = (field) => (node) => {
    dateNativeInputRefs.current[field] = node;
  };

  const openDatePicker = (field) => {
    const input = dateNativeInputRefs.current[field];
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  };

  const handleOk = async () => {
    setIsLoadingReport(true);
    setStatusMessage("");
    try {
      const payload = {
        ...formState,
        activeSelectionTab: activeItemTab,
        locationSelection: {
          ...formState.locationSelection,
          mode: activeLocationTab,
        },
        warehouseSelection: {
          ...formState.warehouseSelection,
          mode: activeLocationTab,
        },
      };
      const response = await fetchInventoryPostingList(payload);
      setReportResult(response);
      setSelectedRowIndex(0);
    } catch (error) {
      setReportResult(null);
      setStatusMessage(error?.response?.data?.message || error?.message || "Could not load Inventory Posting List report.");
    } finally {
      setIsLoadingReport(false);
    }
  };

  const handleCloseCriteriaWindow = () => {
    if (closeActiveAndRestorePrevious()) return;
    navigate("/dashboard");
  };

  const handleMinimizeCriteriaWindow = () => {
    criteriaWindow.toggleMinimize();
    navigate("/dashboard");
  };

  const handleCloseReportWindow = () => {
    setReportResult(null);
  };

  const handleMinimizeReportWindow = () => {
    reportWindow.toggleMinimize();
    navigate("/dashboard");
  };

  const handleOpenArInvoice = (row) => {
    const docEntry = Number(row?.documentDocEntry || 0);
    const transType = Number(row?.documentTransType || 0);
    if (transType !== 13 || !docEntry) {
      setStatusMessage("A/R Invoice drilldown is available only for A/R Invoice rows.");
      return;
    }

    navigate("/ar-invoice", {
      state: {
        arInvoiceDocEntry: docEntry,
      },
    });
  };

  const handleOpenWarehouse = (whsCode) => {
    const normalizedWhsCode = String(whsCode || "").trim();
    if (!normalizedWhsCode) return;
    navigate(`/warehouse?warehouseCode=${encodeURIComponent(normalizedWhsCode)}`);
  };

  const handleOpenBusinessPartner = (cardCode) => {
    const normalizedCardCode = String(cardCode || "").trim();
    if (!normalizedCardCode) return;
    navigate(`/business-partner?cardCode=${encodeURIComponent(normalizedCardCode)}`);
  };

  const selectAllWarehouses = () => {
    setNested("locationSelection", {
      warehouseCodes: warehouses.map((warehouse) => warehouse.code).filter(Boolean),
      locationCodes: locations.map((location) => location.code).filter(Boolean),
    });
  };

  const clearExpandedSelections = () => {
    setFormState((current) => ({
      ...current,
      expanded: {
        documentTypes: {},
        generalParameters: makeGeneralParameters(),
      },
    }));
  };

  const renderWindowControls = (windowFrame, onMinimize, onClose) => (
    <div className="item-list-window__controls">
      <button className="sap-report-window-control" type="button" aria-label={windowFrame.isMinimized ? "Restore" : "Minimize"} onClick={onMinimize}>
        {windowFrame.isMinimized ? "[]" : "-"}
      </button>
      <button className="sap-report-window-control" type="button" aria-label={windowFrame.isMaximized ? "Restore" : "Maximize"} onClick={windowFrame.toggleMaximize}>
        []
      </button>
      <button className="sap-report-window-control" type="button" aria-label="Close" onClick={onClose}>x</button>
    </div>
  );

  const renderDateRangeRow = () => (
    <div className="ipl-criteria__date-row">
      <label className="item-list-criteria__checkbox">
        <input
          type="checkbox"
          checked={formState.dateEnabled}
          onChange={(event) => setField("dateEnabled", event.target.checked)}
        />
        <span>Date</span>
      </label>
      <span>From</span>
      <div className="ipl-date-field">
        <input value={formState.dateFrom} onChange={(event) => setField("dateFrom", event.target.value)} />
        <SapDateInput
          ref={getDateNativeInputRef("dateFrom")}
          
          className="ipl-date-native-input"
          tabIndex={-1}
          value={parseSapDateToIso(formState.dateFrom)}
          onChange={(event) => setField("dateFrom", isoToSapDate(event.target.value))}
        />
        <button type="button" className="ipl-lookup-btn" aria-label="Open from date picker" onClick={() => openDatePicker("dateFrom")}>...</button>
      </div>
      <span>To</span>
      <div className="ipl-date-field">
        <input value={formState.dateTo} onChange={(event) => setField("dateTo", event.target.value)} />
        <SapDateInput
          ref={getDateNativeInputRef("dateTo")}
          
          className="ipl-date-native-input"
          tabIndex={-1}
          value={parseSapDateToIso(formState.dateTo)}
          onChange={(event) => setField("dateTo", isoToSapDate(event.target.value))}
        />
        <button type="button" className="ipl-lookup-btn" aria-label="Open to date picker" onClick={() => openDatePicker("dateTo")}>...</button>
      </div>
      <button type="button" className="item-list-btn" onClick={() => setShowExpanded(true)}>
        Expanded
      </button>
    </div>
  );

  const renderItemsTab = () => (
    <div className="ipl-criteria__left-panel">
      <div className="ipl-criteria__code-row">
        <div className="ipl-criteria__row-label">Item Code</div>
        <div>
          <div className="ipl-criteria__column-head">From</div>
          <div className="item-list-criteria__lookup-wrap">
            <input
              value={formState.itemFrom}
              onChange={(event) => setField("itemFrom", event.target.value)}
              onDoubleClick={() => openItemLookup("itemFrom")}
            />
            <button
              type="button"
              className="ipl-lookup-btn"
              aria-label="Lookup item code from"
              onClick={() => openItemLookup("itemFrom")}
            >
              ...
            </button>
          </div>
        </div>
        <div>
          <div className="ipl-criteria__column-head">To</div>
          <div className="item-list-criteria__lookup-wrap">
            <input
              value={formState.itemTo}
              onChange={(event) => setField("itemTo", event.target.value)}
              onDoubleClick={() => openItemLookup("itemTo")}
            />
            <button
              type="button"
              className="ipl-lookup-btn"
              aria-label="Lookup item code to"
              onClick={() => openItemLookup("itemTo")}
            >
              ...
            </button>
          </div>
        </div>
      </div>

      <div className="ipl-criteria__group-row">
        <label>Item Group</label>
        <select value={formState.groupCode} onChange={(event) => setField("groupCode", event.target.value)}>
          {itemGroups.map((group) => (
            <option key={`${group.code}-${group.name}`} value={group.code}>
              {group.code === "*" || group.name === "*" ? "All" : group.name || group.code}
            </option>
          ))}
          <option value="none">None</option>
        </select>
      </div>

      <div className="ipl-criteria__property-row">
        <button type="button" className="item-list-btn item-list-btn--wide sap-report-btn sap-report-property-btn" onClick={() => setPropertiesTarget("items")}>
          Properties
        </button>
        <input type="text" value={propertyModeLabel} readOnly />
      </div>

      <label className="item-list-criteria__checkbox">
        <input
          type="checkbox"
          checked={formState.hideNoStock}
          onChange={(event) => setField("hideNoStock", event.target.checked)}
        />
        <span>Hide Items with No Quantity in Stock</span>
      </label>

      <div className="ipl-criteria__section-title">Trans. Selection Criteria</div>
      {renderDateRangeRow()}

      <label className="item-list-criteria__checkbox">
        <input
          type="checkbox"
          checked={formState.hideTransWithoutQtyChange}
          onChange={(event) => setField("hideTransWithoutQtyChange", event.target.checked)}
        />
        <span>Hide Trans. without Qty Change</span>
      </label>

      <label className="item-list-criteria__checkbox">
        <input checked={formState.sort} type="checkbox" onChange={(event) => setField("sort", event.target.checked)} />
        <span>Sort</span>
      </label>
    </div>
  );

  const renderCodeRange = ({ label, section, fromField = "codeFrom", toField = "codeTo", onLookup }) => (
    <div className="ipl-criteria__code-row">
      <div className="ipl-criteria__row-label">{label}</div>
      <div>
        <div className="ipl-criteria__column-head">From</div>
        <div className={onLookup ? "item-list-criteria__lookup-wrap" : ""}>
          <input value={formState[section][fromField]} onChange={(event) => setNested(section, { [fromField]: event.target.value })} />
          {onLookup ? <button type="button" className="ipl-lookup-btn" onClick={() => onLookup(fromField)}>...</button> : null}
        </div>
      </div>
      <div>
        <div className="ipl-criteria__column-head">To</div>
        <div className={onLookup ? "item-list-criteria__lookup-wrap" : ""}>
          <input value={formState[section][toField]} onChange={(event) => setNested(section, { [toField]: event.target.value })} />
          {onLookup ? <button type="button" className="ipl-lookup-btn" onClick={() => onLookup(toField)}>...</button> : null}
        </div>
      </div>
    </div>
  );

  const renderSharedTransactionCriteria = () => (
    <>
      <div className="ipl-criteria__section-title">Trans. Selection Criteria</div>
      {renderDateRangeRow()}
      <label className="item-list-criteria__checkbox">
        <input type="checkbox" checked={formState.hideTransWithoutQtyChange} onChange={(event) => setField("hideTransWithoutQtyChange", event.target.checked)} />
        <span>Hide Trans. without Qty Change</span>
      </label>
      <label className="item-list-criteria__checkbox">
        <input checked={formState.sort} type="checkbox" onChange={(event) => setField("sort", event.target.checked)} />
        <span>Sort</span>
      </label>
    </>
  );

  const renderResourcesTab = () => (
    <div className="ipl-criteria__left-panel">
      {renderCodeRange({ label: "Resource Code", section: "resourceSelection", onLookup: setResourceLookupTarget })}
      <div className="ipl-other-summary">{resources.length} resources available</div>
      <div className="ipl-criteria__group-row">
        <label>Resource Group</label>
        <select value={formState.resourceSelection.groupCode} onChange={(event) => setNested("resourceSelection", { groupCode: event.target.value })}>
          <option value="*">All</option>
          <option value="none">None</option>
        </select>
      </div>
      <div className="ipl-criteria__property-row">
        <button type="button" className="item-list-btn item-list-btn--wide sap-report-btn sap-report-property-btn" onClick={() => setPropertiesTarget("resources")}>Properties</button>
        <input value={propertyLabel(formState.resourceSelection.propertyFilter)} readOnly />
      </div>
      {renderSharedTransactionCriteria()}
    </div>
  );

  const renderBpTab = () => (
    <div className="ipl-criteria__left-panel">
      {renderCodeRange({ label: "BP Code", section: "bpSelection", onLookup: setBpLookupTarget })}
      <div className="ipl-criteria__group-row">
        <label>Customer Group</label>
        <select value={formState.bpSelection.customerGroup} onChange={(event) => setNested("bpSelection", { customerGroup: event.target.value })}>
          <option value="*">All</option>
          {customerGroups.map((group) => <option key={`c-${group.code}`} value={group.code}>{group.name || group.code}</option>)}
          <option value="none">None</option>
        </select>
      </div>
      <div className="ipl-criteria__group-row">
        <label>Vendor Group</label>
        <select value={formState.bpSelection.vendorGroup} onChange={(event) => setNested("bpSelection", { vendorGroup: event.target.value })}>
          <option value="*">All</option>
          {vendorGroups.map((group) => <option key={`v-${group.code}`} value={group.code}>{group.name || group.code}</option>)}
          <option value="none">None</option>
        </select>
      </div>
      <div className="ipl-criteria__property-row">
        <button type="button" className="item-list-btn item-list-btn--wide sap-report-btn sap-report-property-btn" onClick={() => setPropertiesTarget("bp")}>Properties</button>
        <input value={propertyLabel(formState.bpSelection.propertyFilter)} readOnly />
      </div>
      {renderSharedTransactionCriteria()}
    </div>
  );

  const renderOtherTab = () => (
    <div className="ipl-criteria__left-panel">
      <div className="ipl-criteria__group-row">
        <label>By</label>
        <select value={formState.otherSelection.by} onChange={(event) => setNested("otherSelection", { by: event.target.value, selectedValues: [] })}>
          {OTHER_SELECTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <button type="button" className="item-list-btn item-list-btn--wide" onClick={() => setShowOtherSelection(true)}>Selection</button>
      <div className="ipl-other-summary">{formState.otherSelection.selectedValues.length} selected</div>
      {renderSharedTransactionCriteria()}
    </div>
  );

  const renderSelectionTab = () => {
    if (activeItemTab === "items") return renderItemsTab();
    if (activeItemTab === "resources") return renderResourcesTab();
    if (activeItemTab === "bp") return renderBpTab();
    return renderOtherTab();
  };

  const renderLocationPanel = () => (
    <div className="ipl-location-panel">
      <div className="sap-report-tabs ipl-location-tabs">
        <button
          type="button"
          className={`sap-report-tab${activeLocationTab === "location" ? " is-active" : ""}`}
          onClick={() => activeLocationTab !== "location" && setActiveLocationTab("location")}
        >
          By Location
        </button>
        <button
          type="button"
          className={`sap-report-tab${activeLocationTab === "warehouse" ? " is-active" : ""}`}
          onClick={() => setActiveLocationTab("warehouse")}
        >
          By Warehouse
        </button>
      </div>

      {activeLocationTab === "location" ? (
        <div className="ipl-location-panel__body">
          <div className="ipl-location-grid">
            <div className="ipl-location-grid__header">
              <span />
              <span>Location</span>
              <span>Whse Code</span>
              <span />
            </div>
            <div className="ipl-location-grid__body">
              {locations.map((location) => {
                const isExpanded = expandedLocations.has(location.code);
                return (
                  <React.Fragment key={location.code}>
                    <label className="ipl-location-grid__row is-location">
                      <input
                        type="checkbox"
                        checked={formState.locationSelection.locationCodes.includes(location.code)}
                        onChange={() => toggleCode("locationSelection", "locationCodes", location.code)}
                      />
                      <button type="button" onClick={() => toggleLocationExpanded(location.code)}>
                        {isExpanded ? "v" : ">"}
                      </button>
                      <span>{location.name}</span>
                      <span />
                    </label>
                    {isExpanded ? location.warehouses.map((warehouse) => (
                      <label className="ipl-location-grid__row" key={warehouse.code}>
                        <input
                          type="checkbox"
                          checked={formState.locationSelection.warehouseCodes.includes(warehouse.code)}
                          onChange={() => toggleCode("locationSelection", "warehouseCodes", warehouse.code)}
                        />
                        <span />
                        <span>{warehouse.code}</span>
                        <span>{warehouse.name}</span>
                      </label>
                    )) : null}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          <div className="ipl-location-panel__actions">
            <button type="button" className="item-list-btn" onClick={() => setExpandedLocations(new Set(locations.map((location) => location.code)))}>
              Expand
            </button>
            <button type="button" className="item-list-btn" onClick={() => setExpandedLocations(new Set())}>
              Collapse
            </button>
          </div>
        </div>
      ) : (
        <div className="ipl-location-panel__body ipl-warehouse-range">
          <label>
            <input
              type="checkbox"
              checked={formState.warehouseSelection.includeEnabled}
              onChange={(event) => setNested("warehouseSelection", { includeEnabled: event.target.checked })}
            />
            <span>Including</span>
          </label>
          <span>From</span>
          <div className="item-list-criteria__lookup-wrap">
            <input
              disabled={!formState.warehouseSelection.includeEnabled}
              value={formState.warehouseSelection.includeFrom}
              onChange={(event) => setNested("warehouseSelection", { includeFrom: event.target.value })}
            />
            <button type="button" className="ipl-lookup-btn" disabled={!formState.warehouseSelection.includeEnabled} onClick={() => setWarehouseLookupTarget("includeFrom")}>...</button>
          </div>
          <span>To</span>
          <div className="item-list-criteria__lookup-wrap">
            <input
              disabled={!formState.warehouseSelection.includeEnabled}
              value={formState.warehouseSelection.includeTo}
              onChange={(event) => setNested("warehouseSelection", { includeTo: event.target.value })}
            />
            <button type="button" className="ipl-lookup-btn" disabled={!formState.warehouseSelection.includeEnabled} onClick={() => setWarehouseLookupTarget("includeTo")}>...</button>
          </div>

          <label>
            <input
              type="checkbox"
              checked={formState.warehouseSelection.excludeEnabled}
              onChange={(event) => setNested("warehouseSelection", { excludeEnabled: event.target.checked })}
            />
            <span>Excluding</span>
          </label>
          <span>From</span>
          <div className="item-list-criteria__lookup-wrap">
            <input
              disabled={!formState.warehouseSelection.excludeEnabled}
              value={formState.warehouseSelection.excludeFrom}
              onChange={(event) => setNested("warehouseSelection", { excludeFrom: event.target.value })}
            />
            <button type="button" className="ipl-lookup-btn" disabled={!formState.warehouseSelection.excludeEnabled} onClick={() => setWarehouseLookupTarget("excludeFrom")}>...</button>
          </div>
          <span>To</span>
          <div className="item-list-criteria__lookup-wrap">
            <input
              disabled={!formState.warehouseSelection.excludeEnabled}
              value={formState.warehouseSelection.excludeTo}
              onChange={(event) => setNested("warehouseSelection", { excludeTo: event.target.value })}
            />
            <button type="button" className="ipl-lookup-btn" disabled={!formState.warehouseSelection.excludeEnabled} onClick={() => setWarehouseLookupTarget("excludeTo")}>...</button>
          </div>
        </div>
      )}
    </div>
  );

  const renderExpandedModal = () => {
    if (!showExpanded) return null;

    return (
      <div className="ipl-expanded-modal__backdrop" onClick={() => setShowExpanded(false)}>
        <div className="ipl-expanded-modal sap-report-window" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="sap-report-titlebar ipl-expanded-modal__titlebar">
            <div className="sap-report-title">Expanded Selection Criteria</div>
            <div className="item-list-window__controls">
              <button className="sap-report-window-control" type="button" aria-label="Minimize">-</button>
              <button className="sap-report-window-control" type="button" aria-label="Close" onClick={() => setShowExpanded(false)}>x</button>
            </div>
          </div>
          <div className="item-list-window__accent" />

          <div className="ipl-expanded-modal__body">
            <div className="ipl-expanded-modal__journals">
              <div className="ipl-expanded-modal__heading">Original Journal</div>
              {ORIGINAL_JOURNAL_GROUPS.map((group, index) => (
                <div className="ipl-expanded-modal__journal-group" key={index}>
                  {group.map(([key, label]) => (
                    <label className="item-list-criteria__checkbox" key={key}>
                      <input
                        type="checkbox"
                        checked={Boolean(formState.expanded.documentTypes[key])}
                        onChange={(event) => setExpandedDocumentType(key, event.target.checked)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>

            <div className="ipl-expanded-modal__general">
              <div className="ipl-expanded-modal__heading">General Parameters</div>
              <div className="ipl-expanded-modal__general-head">
                <span />
                <span />
                <span>From</span>
                <span>To</span>
              </div>
              {GENERAL_PARAMETER_ROWS.map(([key, label, , , hasLookup]) => {
                const row = formState.expanded.generalParameters[key] || {};
                return (
                  <div className="ipl-expanded-modal__general-row" key={key}>
                    <input
                      type="checkbox"
                      checked={Boolean(row.enabled)}
                      onChange={(event) => setExpandedParameter(key, { enabled: event.target.checked })}
                    />
                    <span>{label}</span>
                    <div className={hasLookup ? "item-list-criteria__lookup-wrap" : ""}>
                      <input
                        value={row.from || ""}
                        onChange={(event) => setExpandedParameter(key, { from: event.target.value })}
                        onDoubleClick={hasLookup ? () => openItemLookup("expanded.itemCode.from") : undefined}
                      />
                      {hasLookup ? (
                        <button
                          type="button"
                          className="ipl-lookup-btn"
                          aria-label="Lookup expanded item code from"
                          onClick={() => openItemLookup("expanded.itemCode.from")}
                        >
                          ...
                        </button>
                      ) : null}
                    </div>
                    <div className={hasLookup ? "item-list-criteria__lookup-wrap" : ""}>
                      <input
                        value={row.to || ""}
                        onChange={(event) => setExpandedParameter(key, { to: event.target.value })}
                        onDoubleClick={hasLookup ? () => openItemLookup("expanded.itemCode.to") : undefined}
                      />
                      {hasLookup ? (
                        <button
                          type="button"
                          className="ipl-lookup-btn"
                          aria-label="Lookup expanded item code to"
                          onClick={() => openItemLookup("expanded.itemCode.to")}
                        >
                          ...
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ipl-expanded-modal__footer">
            <button type="button" className="item-list-btn sap-report-btn sap-report-btn--primary" onClick={() => setShowExpanded(false)}>OK</button>
            <button type="button" className="item-list-btn sap-report-btn" onClick={() => setShowExpanded(false)}>Cancel</button>
            <button type="button" className="item-list-btn sap-report-btn ipl-expanded-modal__clear" onClick={clearExpandedSelections}>Clear Selections</button>
          </div>
        </div>
      </div>
    );
  };

  const renderOtherSelectionModal = () => {
    if (!showOtherSelection) return null;
    const selected = new Set(formState.otherSelection.selectedValues);
    const label = OTHER_SELECTION_OPTIONS.find(([value]) => value === formState.otherSelection.by)?.[1] || "Selection";

    return (
      <div className="ipl-expanded-modal__backdrop" onClick={() => setShowOtherSelection(false)}>
        <div className="ipl-selection-modal sap-report-window" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="sap-report-titlebar ipl-expanded-modal__titlebar">
            <div className="sap-report-title">Inventory Posting List - {label} Selection</div>
            <button className="sap-report-window-control" type="button" aria-label="Close" onClick={() => setShowOtherSelection(false)}>x</button>
          </div>
          <div className="item-list-window__accent" />
          <div className="ipl-selection-modal__grid">
            <div className="ipl-selection-modal__header"><span>#</span><span>Display</span><span>{label}</span></div>
            {otherSelectionRows.length ? otherSelectionRows.map((row, index) => (
              <label className="ipl-selection-modal__row" key={`${row.code}-${index}`}>
                <span>{index + 1}</span>
                <input
                  type="checkbox"
                  checked={selected.has(row.code)}
                  onChange={() => toggleCode("otherSelection", "selectedValues", row.code)}
                />
                <span>{row.code}{row.name ? ` - ${row.name}` : ""}</span>
              </label>
            )) : <div className="ipl-selection-modal__empty">Enter this criterion through Expanded Selection Criteria.</div>}
          </div>
          <div className="ipl-selection-modal__footer">
            <button type="button" className="item-list-btn sap-report-btn sap-report-btn--primary" onClick={() => setShowOtherSelection(false)}>OK</button>
            <button type="button" className="item-list-btn sap-report-btn" onClick={() => setShowOtherSelection(false)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  };

  const renderReportWindow = () => (
    <div
      className={`item-list-window item-list-window--report ipl-report-window sap-report-window${reportWindow.isMinimized ? " is-minimized" : ""}${reportWindow.isMaximized ? " is-maximized" : ""}`}
      {...reportWindow.windowProps}
    >
      <div className="item-list-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
        <div className="item-list-window__title sap-report-title">Inventory Posting List</div>
        {renderWindowControls(reportWindow, handleMinimizeReportWindow, handleCloseReportWindow)}
      </div>
      <div className="item-list-window__accent" />

      {!reportWindow.isMinimized ? (
        <div className="item-list-window__body item-list-window__body--report">
          <div className="ipl-report-toolbar">
            <span>Display Subtotal:</span>
            {[
              ["daily", "Daily"],
              ["monthly", "Monthly"],
              ["yearly", "Yearly"],
            ].map(([key, label]) => (
              <label className="item-list-criteria__checkbox" key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(formState.displaySubtotals[key])}
                  onChange={(event) =>
                    setNested("displaySubtotals", {
                      [key]: event.target.checked,
                    })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="ipl-report-grid-wrap">
            <table className="ipl-report-grid">
              <thead>
                <tr>
                  <th>Posting Date</th>
                  <th>Document</th>
                  <th>Doc. Row</th>
                  <th>Whse</th>
                  <th>G/L Acct/BP Code</th>
                  <th>G/L Acct/BP Name</th>
                  <th>Rec. Qty</th>
                  <th>Iss. Qty</th>
                  <th>Inventory UoM</th>
                  <th>Price after Disc.</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {!displayRows.length ? (
                  <tr>
                    <td colSpan={11} className="item-list-report__state-cell">No inventory postings found.</td>
                  </tr>
                ) : displayRows.map((row, index) => {
                  if (row.kind === "item") {
                    return (
                      <tr key={row.id} className="ipl-report-grid__item-row">
                        <td colSpan={10}>
                          <button type="button" className="ipl-report-grid__link" onClick={() => navigate(`/item-master?itemCode=${encodeURIComponent(row.itemCode || "")}`)}>
                            {row.itemCode}
                          </button>
                          <span>{row.itemName ? ` ${row.itemName}` : ""}</span>
                        </td>
                        <td>{formatQuantity(row.balance, 1)}</td>
                      </tr>
                    );
                  }

                  if (row.kind === "subtotal") {
                    return (
                      <tr key={row.id} className="ipl-report-grid__subtotal-row">
                        <td />
                        <td>{row.label}</td>
                        <td colSpan={4} />
                        <td>{formatQuantity(row.recQty)}</td>
                        <td>{formatQuantity(row.issQty)}</td>
                        <td colSpan={3} />
                      </tr>
                    );
                  }

                  const canOpenArInvoice = Number(row.documentTransType || 0) === 13 && Number(row.documentDocEntry || 0);
                  const canOpenWarehouse = Boolean(String(row.whsCode || "").trim());
                  const canOpenBusinessPartner = Boolean(String(row.glBpCode || "").trim());

                  return (
                    <tr
                      key={row.id}
                      className={selectedRowIndex === index ? "is-selected" : ""}
                      onClick={() => setSelectedRowIndex(index)}
                    >
                      <td>{formatDate(row.postingDate)}</td>
                      <td>
                        {canOpenArInvoice ? (
                          <button
                            type="button"
                            className="ipl-report-grid__drill-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenArInvoice(row);
                            }}
                          >
                            <span className="ipl-report-grid__arrow" aria-hidden="true">-&gt;</span>
                            <span className="ipl-report-grid__drill-text">{row.document}</span>
                          </button>
                        ) : (
                          <>
                            <span className="ipl-report-grid__arrow" aria-hidden="true">-&gt;</span>
                            {row.document}
                          </>
                        )}
                      </td>
                      <td>{row.docRow}</td>
                      <td>
                        {canOpenWarehouse ? (
                          <button
                            type="button"
                            className="ipl-report-grid__drill-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenWarehouse(row.whsCode);
                            }}
                          >
                            <span className="ipl-report-grid__arrow" aria-hidden="true">-&gt;</span>
                            <span className="ipl-report-grid__drill-text">{row.whsCode}</span>
                          </button>
                        ) : null}
                      </td>
                      <td>
                        {canOpenBusinessPartner ? (
                          <button
                            type="button"
                            className="ipl-report-grid__drill-link"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenBusinessPartner(row.glBpCode);
                            }}
                          >
                            <span className="ipl-report-grid__arrow" aria-hidden="true">-&gt;</span>
                            <span className="ipl-report-grid__drill-text">{row.glBpCode}</span>
                          </button>
                        ) : null}
                      </td>
                      <td>{row.glBpName}</td>
                      <td className="is-numeric">{row.recQty ? formatQuantity(row.recQty) : ""}</td>
                      <td className="is-numeric">{row.issQty ? formatQuantity(row.issQty) : ""}</td>
                      <td>{row.inventoryUom}</td>
                      <td className="is-numeric">{row.priceAfterDisc ? formatCurrency(row.priceAfterDisc) : ""}</td>
                      <td className="is-numeric">{formatQuantity(row.balance, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="item-list-report__footer">
            <div className="item-list-report__footer-left">
              <button type="button" className="item-list-report__back-btn" aria-label="Back to selection criteria" onClick={handleCloseReportWindow}>
                &lt;-
              </button>
              <button type="button" className="item-list-btn sap-report-btn sap-report-btn--primary" onClick={handleCloseReportWindow}>OK</button>
            </div>
            <label className="item-list-criteria__checkbox">
              <input
                type="checkbox"
                checked={formState.splitByBatchSerial}
                onChange={(event) => setField("splitByBatchSerial", event.target.checked)}
              />
              <span>Split Display by Batch/Serial Numbers</span>
            </label>
            <span>{company?.companyName || company?.dbName || "SAP Business One"}</span>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="item-list-page ipl-page sap-report-page">
      <div
        className={`item-list-window ipl-criteria-window sap-report-window${criteriaWindow.isMinimized ? " is-minimized" : ""}${criteriaWindow.isMaximized ? " is-maximized" : ""}`}
        {...criteriaWindow.windowProps}
      >
        <div className="item-list-window__titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
          <div className="item-list-window__title sap-report-title">Inventory Posting List - Selection Criteria</div>
          {renderWindowControls(criteriaWindow, handleMinimizeCriteriaWindow, handleCloseCriteriaWindow)}
        </div>
        <div className="item-list-window__accent" />

        {!criteriaWindow.isMinimized ? (
          <div className="item-list-window__body ipl-criteria-window__body">
            <div className="ipl-criteria-layout">
              <div>
                <div className="sap-report-tabs ipl-item-tabs">
                  {ITEM_TABS.map((tab) => (
                    <button
                      type="button"
                      key={tab.key}
                      className={`sap-report-tab${activeItemTab === tab.key ? " is-active" : ""}`}
                      onClick={() => setActiveItemTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                {renderSelectionTab()}
              </div>

              <div>{renderLocationPanel()}</div>
            </div>

            <div className="ipl-bottom-options">
              <div />
              <div>
                <label className="item-list-criteria__checkbox">
                  <input checked={formState.splitByBatchSerial} type="checkbox" onChange={(event) => setField("splitByBatchSerial", event.target.checked)} />
                  <span>Split Display by Batch/Serial Numbers</span>
                </label>
                <label className="item-list-criteria__checkbox">
                  <input checked={formState.printSeparatePage} type="checkbox" onChange={(event) => setField("printSeparatePage", event.target.checked)} />
                  <span>Print BP/Item/Resource on Separate Page</span>
                </label>
                <label className="item-list-criteria__checkbox">
                  <input checked={formState.printDirectly} type="checkbox" onChange={(event) => setField("printDirectly", event.target.checked)} />
                  <span>Print Directly</span>
                </label>
              </div>
            </div>

            {isLoadingReport ? <div className="item-list-status">Loading Inventory Posting List report...</div> : null}
            {statusMessage ? <div className="item-list-status">{statusMessage}</div> : null}

            <div className="ipl-window-footer">
              <div>
                <button type="button" className="item-list-btn sap-report-btn sap-report-btn--primary" onClick={handleOk}>OK</button>
                <button type="button" className="item-list-btn sap-report-btn" onClick={handleCloseCriteriaWindow}>Cancel</button>
              </div>
              <button type="button" className="item-list-btn sap-report-btn" onClick={selectAllWarehouses}>Select All</button>
            </div>
          </div>
        ) : null}
      </div>

      {reportResult ? renderReportWindow() : null}
      {renderExpandedModal()}
      {renderOtherSelectionModal()}

      <ItemLookupModal isOpen={Boolean(lookupTarget)} onClose={() => setLookupTarget("")} onSelect={handleItemSelect} />
      <BusinessPartnerLookupModal isOpen={Boolean(bpLookupTarget)} type="" onClose={() => setBpLookupTarget("")} onSelect={handleBpSelect} />
      <ResourceLookupModal isOpen={Boolean(resourceLookupTarget)} onClose={() => setResourceLookupTarget("")} onSelect={handleResourceSelect} resources={resources} />
      <WarehouseLookupModal isOpen={Boolean(warehouseLookupTarget)} onClose={() => setWarehouseLookupTarget("")} onSelect={handleWarehouseRangeSelect} warehouses={warehouses} />

      <PropertiesSelectionModal
        isOpen={Boolean(propertiesTarget)}
        title="Properties"
        propertyLabelPrefix={propertiesTarget === "bp" ? "Business Partners Property" : propertiesTarget === "resources" ? "Resources Property" : "Items Property"}
        properties={itemProperties}
        value={propertiesTarget === "bp"
          ? formState.bpSelection.propertyFilter
          : propertiesTarget === "resources"
            ? formState.resourceSelection.propertyFilter
            : formState.propertyFilter}
        onClose={() => setPropertiesTarget("")}
        onSave={(nextFilter) => {
          if (propertiesTarget === "bp") setNested("bpSelection", { propertyFilter: nextFilter });
          else if (propertiesTarget === "resources") setNested("resourceSelection", { propertyFilter: nextFilter });
          else setField("propertyFilter", nextFilter);
        }}
      />
    </div>
  );
}

export default InventoryPostingListReportPage;
