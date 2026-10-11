import SapDateInput from '../../components/common/SapDateInput';
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "../../modules/item-master/styles/itemMaster.css";
import "./productionOrder.css";
import ProductionOrderLines from "./components/ProductionOrderLines";
import ProductionOrderList  from "./components/ProductionOrderList";
import ItemSearchModal       from "../bom/components/ItemSearchModal";
import CustomerSearchModal   from "./components/CustomerSearchModal";
import { useAuth } from "../../auth/AuthContext";
import {
  fetchProductionOrderReferenceData,
  fetchProductionOrderSeries,
  fetchProductionOrderByDocEntry,
  createProductionOrder,
  updateProductionOrder,
  releaseProductionOrder,
  closeProductionOrder,
  explodeBOM,
  fetchProdOrderItems,
  fetchProdOrderFinishItems,
  fetchProdOrderComponentItems,
  fetchProdOrderWarehouses,
  fetchProdOrderDistributionRules,
  fetchProdOrderProjects,
  fetchProdOrderCustomers,
  fetchProdOrderResources,
  fetchProdOrderUsers,
  fetchProdOrderLinkedOrders,
} from "../../api/productionOrderApi";
import { getSapVisibleDocumentSeries } from "../../utils/seriesDefaults";

const MODES = { ADD: "add", FIND: "find", UPDATE: "update", LIST: "list" };
const TABS  = ["Components", "Summary", "Attachments"];

const today = () => new Date().toISOString().slice(0, 10);

const createEmptyHeader = (defaultSeries = "") => ({
  doc_num:           "",
  item_code:         "",
  item_name:         "",
  uom_name:          "",
  bom_qty:           1,
  planned_qty:       1,
  completed_qty:     0,
  rejected_qty:      0,
  due_date:          today(),
  posting_date:      today(),
  start_date:        today(),
  order_date:        today(),
  status:            "boposPlanned",
  type:              "bopotStandard",
  warehouse:         "",
  priority:          100,
  routing_date_calc: "start",
  procure_items:     false,
  distribution_rule: "",
  project:           "",
  branch:            "",
  branch_name:       "",
  customer_code:     "",
  customer_name:     "",
  origin:            "",
  linked_to:         "",
  linked_order:      "",
  linked_order_entry:"",
  user_id:           "",
  user:              "",
  journal_remark:    "",
  remarks:           "",
  pick_pack_remarks: "",
  series:            defaultSeries,
  origin_num:        "",
});

const EMPTY_HEADER = createEmptyHeader();

const getSeriesCode = (seriesItem) => (
  seriesItem?.Series != null ? String(seriesItem.Series) : ""
);

const getDefaultSeriesValue = (seriesList = [], preferredSeries = "") => {
  const preferred = typeof preferredSeries === "object"
    ? getSeriesCode(preferredSeries)
    : String(preferredSeries || "").trim();
  if (preferred) return preferred;

  const defaultSeries =
    seriesList.find((s) => s.IsCurrentPeriod || s.isCurrentPeriod) ||
    seriesList.find((s) => s.IsDefault || s.isDefault) ||
    seriesList[0];

  return getSeriesCode(defaultSeries);
};

const EMPTY_LINE = () => ({
  _id:              Date.now() + Math.random(),
  line_num:         0,
  item_code:        "",
  item_name:        "",
  line_text:        "",
  base_qty:         1,
  base_ratio:       1,
  planned_qty:      1,
  issued_qty:       0,
  available_qty:    0,
  uom:              "",
  uom_code:         "",
  uom_name:         "",
  warehouse:        "",
  issue_method:     "im_Manual",
  wip_account:      "",
  distribution_rule:"",
  project:          "",
  location:         "",
  additional_qty:   0,
  stage_id:         "",
  route_sequence:   "",
  procurement_method:"",
  component_type:   "pit_Item",
});

const STATUS_LABELS = {
  boposPlanned:   "Planned",
  boposReleased:  "Released",
  boposClosed:    "Closed",
  boposCancelled: "Cancelled",
};

const TYPE_LABELS = {
  bopotStandard:    "Standard",
  bopotSpecial:     "Special",
  bopotDisassemble: "Disassemble",
};

const formatSummaryNumber = (value) => Number(value || 0).toFixed(2);
const firstWarehouse = (...values) => (
  values.map((value) => String(value || "").trim()).find(Boolean) || ""
);

const normalizeLookupText = (value) => String(value || "").trim().toLowerCase();
const getUserId = (user) => (user?.UserID != null ? String(user.UserID) : "");
const getUserCode = (user) => String(user?.UserCode || "").trim();
const getUserName = (user) => String(user?.UserName || "").trim();
const getUserDisplay = (user) => getUserCode(user) || getUserName(user);
const getUserDetail = (user) => {
  const code = getUserCode(user);
  const name = getUserName(user);
  return code && name && code !== name ? name : "";
};

const findUserById = (users = [], userId = "") => (
  users.find((user) => getUserId(user) === String(userId || ""))
);

const findDefaultSapUser = (users = [], authUser = {}) => {
  const candidates = [authUser?.username, authUser?.fullName]
    .map(normalizeLookupText)
    .filter(Boolean);

  if (!candidates.length) return null;

  return users.find((user) => {
    const code = normalizeLookupText(getUserCode(user));
    const name = normalizeLookupText(getUserName(user));
    return candidates.some((candidate) => (
      code === candidate ||
      name === candidate ||
      code.endsWith(`-${candidate}`) ||
      name.endsWith(`-${candidate}`)
    ));
  }) || null;
};

function UserPicker({ users, value, displayValue, disabled, onSelect, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const selectedUser = findUserById(users, value);
  const currentDisplay = selectedUser ? getUserDisplay(selectedUser) : (displayValue || "--");

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const filteredUsers = users.filter((user) => {
    const search = normalizeLookupText(query);
    if (!search) return true;
    return (
      normalizeLookupText(getUserCode(user)).includes(search) ||
      normalizeLookupText(getUserName(user)).includes(search)
    );
  });

  const openPicker = () => {
    if (disabled) return;
    setOpen(true);
    onRefresh?.();
  };

  const chooseUser = (user) => {
    onSelect(user);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="po-user-picker" ref={wrapRef}>
      <button
        type="button"
        className="po-user-picker__field"
        onClick={openPicker}
        disabled={disabled}
        title={currentDisplay}
      >
        <span>{currentDisplay}</span>
        <span className="po-user-picker__arrow">v</span>
      </button>
      {open && (
        <div className="po-user-picker__menu">
          <input
            className="po-user-picker__search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find user"
            autoFocus
          />
          <div className="po-user-picker__list">
            {filteredUsers.length ? filteredUsers.map((user) => {
              const id = getUserId(user);
              return (
                <button
                  key={id || getUserDisplay(user)}
                  type="button"
                  className={`po-user-picker__option${id === String(value || "") ? " is-selected" : ""}`}
                  onClick={() => chooseUser(user)}
                >
                  <span className="po-user-picker__code">{getUserDisplay(user)}</span>
                  {getUserDetail(user) && <span className="po-user-picker__name">{getUserDetail(user)}</span>}
                </button>
              );
            }) : (
              <div className="po-user-picker__empty">No users found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductionOrderModule() {
  const { user: authUser } = useAuth();
  const [mode,    setMode]    = useState(MODES.ADD);
  const [tab,     setTab]     = useState(0);
  const [header,  setHeader]  = useState(EMPTY_HEADER);
  const [lines,   setLines]   = useState([EMPTY_LINE()]);
  const [alert,   setAlert]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [docEntry, setDocEntry] = useState(null);
  const [listQuery, setListQuery] = useState("");

  // Lookup data
  const [warehouses,  setWarehouses]  = useState([]);
  const [distRules,   setDistRules]   = useState([]);
  const [projects,    setProjects]    = useState([]);
  const [series,      setSeries]      = useState([]);
  const [branches,    setBranches]    = useState([]);
  const [defaultSeries, setDefaultSeries] = useState("");
  const [routeStages, setRouteStages] = useState([]);
  const [prodTypes,   setProdTypes]   = useState([]);
  const [prodStatuses,setProdStatuses]= useState([]);
  const [users,       setUsers]       = useState([]);
  const [linkedToOptions, setLinkedToOptions] = useState([]);
  const branchWarehouses = useMemo(() => {
    if (mode !== MODES.ADD || !header.branch) return warehouses;
    return warehouses.filter((warehouse) => warehouse.BPLID == null || String(warehouse.BPLID) === String(header.branch));
  }, [header.branch, mode, warehouses]);

  // Item search modal: target = "header" | line._id
  const [itemModal, setItemModal] = useState({ open: false, target: null });
  
  // Customer search modal
  const [customerModal, setCustomerModal] = useState(false);
  const [linkedOrderModal, setLinkedOrderModal] = useState(false);

  const alertTimer = useRef(null);

  const loadUsersLive = useCallback(() => (
    fetchProdOrderUsers()
      .then((loadedUsers) => {
        const nextUsers = Array.isArray(loadedUsers) ? loadedUsers : [];
        setUsers(nextUsers);
        return nextUsers;
      })
      .catch(() => [])
  ), []);

  useEffect(() => {
    // Load reference data
    fetchProductionOrderReferenceData()
      .then((d) => {
        setWarehouses(d.warehouses || []);
        setDistRules(d.distribution_rules || []);
        setProjects(d.projects || []);
        const loadedBranches = d.branches || [];
        setBranches(loadedBranches);
        const loadedSeries = d.series || [];
        const loadedDefaultSeries = getDefaultSeriesValue(loadedSeries, d.default_series);
        setSeries(loadedSeries);
        setDefaultSeries(loadedDefaultSeries);
        setHeader((prev) => ({
          ...prev,
          series: prev.series || loadedDefaultSeries,
          branch: prev.branch || (loadedBranches[0]?.BPLID != null ? String(loadedBranches[0].BPLID) : ""),
        }));
        setRouteStages(d.route_stages || []);
        setProdTypes(d.production_order_types || []);
        setProdStatuses(d.production_order_statuses || []);
        setUsers(d.users || []);
        loadUsersLive();
        const loadedLinkedToOptions = d.linked_to_options || [];
        setLinkedToOptions(loadedLinkedToOptions);
        const defaultLinkedTo =
          loadedLinkedToOptions.find((option) => option.value === "sales_order") ||
          loadedLinkedToOptions[0];
        if (defaultLinkedTo) {
          setHeader((prev) => (
            prev.linked_to ? prev : { ...prev, linked_to: defaultLinkedTo.value }
          ));
        }
      })
      .catch(() => {
        // Fallback: load individually
        fetchProdOrderWarehouses().then(setWarehouses).catch(() => {});
        fetchProdOrderDistributionRules().then(setDistRules).catch(() => {});
        fetchProdOrderProjects().then(setProjects).catch(() => {});
        loadUsersLive();
      });
  }, [loadUsersLive]);

  useEffect(() => {
    if (mode !== MODES.ADD || !header.posting_date) return undefined;
    let active = true;
    fetchProductionOrderSeries(header.posting_date, header.branch)
      .then((context) => {
        if (!active) return;
        const nextSeries = context.series || [];
        const preferred = context.defaultSeries != null ? String(context.defaultSeries) : "";
        setSeries(nextSeries);
        setDefaultSeries(preferred || getDefaultSeriesValue(nextSeries));
        setHeader((prev) => {
          const valid = nextSeries.some((entry) => String(entry.Series) === String(prev.series));
          return { ...prev, series: valid ? prev.series : (preferred || getDefaultSeriesValue(nextSeries)) };
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [header.branch, header.posting_date, mode]);

  useEffect(() => {
    if (mode !== MODES.ADD || header.user_id || header.user || !users.length) return;
    const defaultUser = findDefaultSapUser(users, authUser);
    if (!defaultUser) return;
    setHeader((prev) => (
      prev.user_id || prev.user
        ? prev
        : {
            ...prev,
            user_id: getUserId(defaultUser),
            user: getUserDisplay(defaultUser),
          }
    ));
  }, [authUser, header.user, header.user_id, mode, users]);

  const showAlert = useCallback((type, msg) => {
    clearTimeout(alertTimer.current);
    setAlert({ type, msg });
    alertTimer.current = setTimeout(() => setAlert(null), 6000);
  }, []);

  const resetForm = () => {
    setHeader({
      ...createEmptyHeader(defaultSeries || getDefaultSeriesValue(series)),
      branch: branches[0]?.BPLID != null ? String(branches[0].BPLID) : "",
    });
    setLines([EMPTY_LINE()]);
    setTab(0);
    setAlert(null);
    setDocEntry(null);
    setListQuery("");
  };

  const handleHeaderChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    const nextValue = type === "checkbox" ? checked : value;
    setHeader((prev) => ({
      ...prev,
      [name]: nextValue,
      ...(name === "linked_to" ? { linked_order: "", linked_order_entry: "" } : {}),
      ...(name === "type" && mode === MODES.ADD
        ? { item_code: "", item_name: "", uom_name: "", warehouse: "" }
        : {}),
    }));

    if (name === "type" && mode === MODES.ADD) {
      setLines([EMPTY_LINE()]);
    }
    
    // When planned_qty changes, recalculate all component planned quantities
    if (name === 'planned_qty') {
      const newPlannedQty = Number(value) || 1;
      setLines((prevLines) =>
        prevLines.map((line) => ({
          ...line,
          planned_qty: parseFloat((((line.base_ratio ?? line.base_qty ?? 1) || 1) * newPlannedQty).toFixed(6)),
        }))
      );
    }
  }, []);

  const handleUserSelect = useCallback((selected) => {
    setHeader((prev) => ({
      ...prev,
      user_id: getUserId(selected),
      user: getUserDisplay(selected),
    }));
  }, []);

  // ── Item selected from modal ───────────────────────────────────────────────
  const handleItemSelect = useCallback(async (item) => {
    const { target } = itemModal;
    setItemModal({ open: false, target: null });
    
    if (target === "header") {
      const isSpecialOrder = header.type === "bopotSpecial";
      const selectedItemCode = item.ItemNo || item.ItemCode || item.TreeCode || item.Code || "";
      const selectedItemName = item.ItemDescription || item.ItemName || item.ProductDescription || item.Name || "";
      const selectedWarehouse = firstWarehouse(
        item.BOMWarehouse,
        item.Warehouse,
        item.DefaultWarehouse,
        item.WarehouseCode,
        item.WhsCode
      );
      const selectedUom = item.UoMName || item.InventoryUOM || item.InventoryUOMName || "";

      setHeader((prev) => ({
        ...prev,
        item_code: selectedItemCode,
        item_name: selectedItemName,
        uom_name: selectedUom || prev.uom_name,
        warehouse: selectedWarehouse || prev.warehouse,
      }));

      if (isSpecialOrder) {
        setLines((prev) => (prev.length ? prev : [EMPTY_LINE()]));
        showAlert("success", `Item selected: ${selectedItemCode}`);
        return;
      }
      
      // Automatically explode BOM for the selected item
      try {
        const bomData = await explodeBOM(selectedItemCode, header.planned_qty || 1);
        
        // Auto-populate warehouse and other header fields from BOM
        setHeader((prev) => ({
          ...prev,
          item_code: bomData.item_code,
          item_name: bomData.item_name,
          uom_name: bomData.uom_name || selectedUom || prev.uom_name,
          bom_qty: bomData.bom_qty ?? prev.bom_qty,
          warehouse: bomData.warehouse || selectedWarehouse || prev.warehouse,
          distribution_rule: bomData.distribution_rule || prev.distribution_rule,
          project: bomData.project || prev.project,
        }));
        
        // Load BOM lines as production order components
        if (bomData.lines && bomData.lines.length > 0) {
          setLines(bomData.lines.map((line, idx) => ({
            _id: Date.now() + idx + Math.random(),
            line_num: idx,
            item_code: line.item_code || '',
            item_name: line.item_name || '',
            line_text: line.line_text || '',
            base_qty: line.base_qty || 1,
            base_ratio: line.base_ratio ?? line.base_qty ?? 1,
            planned_qty: line.planned_qty || 1,
            issued_qty: line.issued_qty || 0,
            available_qty: line.available_qty || 0,
            uom: line.uom || line.uom_code || line.uom_name || '',
            uom_code: line.uom_code || line.uom || '',
            uom_name: line.uom_name || line.uom || '',
            warehouse: line.warehouse || '',
            issue_method: line.issue_method || 'im_Manual',
            wip_account: line.wip_account || '',
            distribution_rule: line.distribution_rule || '',
            project: line.project || '',
            location: line.location || '',
            additional_qty: line.additional_qty || 0,
            stage_id: line.stage_id || '',
            route_sequence: line.route_sequence || line.stage_id || '',
            procurement_method: line.procurement_method || '',
            component_type: line.component_type || 'pit_Item',
          })));
          showAlert("success", `BOM exploded: ${bomData.lines.length} components loaded.`);
        }
      } catch (err) {
        showAlert("warning", `Item selected but BOM explosion failed: ${err.message}`);
      }
    } else {
      const currentLine = lines.find((l) => l._id === target);
      const isResource = currentLine?.component_type === "pit_Resource";
      const selectedWarehouse = firstWarehouse(
        item.DefaultWarehouse,
        item.Warehouse,
        item.WarehouseCode,
        item.WhsCode,
        currentLine?.warehouse,
        header.warehouse
      );
      setLines((prev) =>
        prev.map((l) =>
          l._id === target
            ? {
                ...l,
                item_code: isResource ? item.Code : item.ItemCode,
                item_name: isResource ? item.Name : item.ItemName,
                line_text: isResource ? "" : l.line_text,
                uom: isResource ? "" : item.InventoryUOM || "",
                uom_code: isResource ? "" : item.InventoryUOM || "",
                uom_name: isResource ? "" : item.UoMName || item.InventoryUOM || "",
                warehouse: selectedWarehouse,
                issue_method: isResource
                  ? (item.IssueMethod === "rimBackflush" ? "im_Backflush" : "im_Manual")
                  : l.issue_method,
              }
            : l
        )
      );
    }
  }, [itemModal, header.planned_qty, header.type, header.warehouse, lines, showAlert]);

  // ── Customer selected from modal ───────────────────────────────────────────
  const handleCustomerSelect = useCallback((customer) => {
    setCustomerModal(false);
    setHeader((prev) => ({
      ...prev,
      customer_code: customer.CardCode,
      customer_name: customer.CardName,
    }));
  }, []);

  const handleLinkedOrderSelect = useCallback((order) => {
    setLinkedOrderModal(false);
    setHeader((prev) => ({
      ...prev,
      linked_order_entry: order.DocEntry != null ? String(order.DocEntry) : "",
      linked_order: order.DocNum != null ? String(order.DocNum) : "",
      ...(order.LinkedTo === "sales_order"
        ? {
            customer_code: order.CardCode || prev.customer_code,
            customer_name: order.CardName || prev.customer_name,
          }
        : {}),
    }));
  }, []);

  // ── Line changes ───────────────────────────────────────────────────────────
  const handleLineChange = useCallback((id, field, value) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l._id !== id) return l;
        if (field === "component_type") {
          if (value === "pit_Text") {
            return {
              ...l,
              component_type: value,
              item_code: "",
              item_name: "",
              uom: "",
              uom_code: "",
              uom_name: "",
              warehouse: "",
              issue_method: "im_Manual",
            };
          }
          return {
            ...l,
            component_type: value,
            item_code: "",
            item_name: "",
            line_text: "",
            uom: "",
            uom_code: "",
            uom_name: "",
            warehouse: "",
            issue_method: "im_Manual",
          };
        }
        return { ...l, [field]: value };
      })
    );
  }, []);

  const addLine    = () => setLines((prev) => [...prev, EMPTY_LINE()]);
  const deleteLine = useCallback((id) => setLines((prev) => prev.filter((l) => l._id !== id)), []);

  // ── Validate ───────────────────────────────────────────────────────────────
  const validate = () => {
    if (!header.item_code.trim())       { showAlert("error", "Finished goods item is required.");  return false; }
    if (Number(header.planned_qty) <= 0){ showAlert("error", "Planned quantity must be > 0.");     return false; }
    if (!header.due_date)               { showAlert("error", "Due date is required.");             return false; }
    return true;
  };

  // ── Build payload ──────────────────────────────────────────────────────────
  const buildPayload = () => ({
    item_code:         header.item_code,
    planned_qty:       Number(header.planned_qty),
    due_date:          header.due_date,
    posting_date:      header.posting_date,
    start_date:        header.start_date,
    status:            header.status,
    type:              header.type,
    warehouse:         header.warehouse,
    priority:          Number(header.priority) || 100,
    distribution_rule: header.distribution_rule,
    project:           header.project,
    branch:            header.branch,
    customer_code:     header.customer_code,
    linked_to:         header.linked_to,
    linked_order_entry:header.linked_order_entry,
    user_id:           header.user_id,
    journal_remark:    header.journal_remark,
      remarks:           header.remarks,
      pick_pack_remarks: header.pick_pack_remarks,
      series:            header.series,
    lines: lines
      .filter((l) =>
        l.component_type === "pit_Text"
          ? Boolean((l.line_text || l.item_name || "").trim())
          : Boolean((l.item_code || "").trim())
      )
      .map((l, idx) => ({ ...l, line_num: idx })),
  });

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (mode === MODES.FIND) { await handleFind(); return; }
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = buildPayload();
      if (mode === MODES.ADD) {
        const result = await createProductionOrder(payload);
        showAlert("success", `Production Order #${result.doc_num} created.`);
        // Load the created order
        if (result.doc_entry) {
          const loaded = await fetchProductionOrderByDocEntry(result.doc_entry);
          _loadOrder(loaded.production_order);
          setDocEntry(result.doc_entry);
          setMode(MODES.UPDATE);
        }
      } else {
        // Check if user is trying to close the order via status dropdown
        if (payload.status === 'boposClosed') {
          if (!window.confirm("Close this production order?")) {
            setLoading(false);
            return;
          }
          const result = await closeProductionOrder(docEntry);
          if (result.production_order) {
            _loadOrder(result.production_order);
          }
          showAlert("success", "Production order closed successfully.");
        } else if (payload.status === 'boposReleased' && header.status === 'boposPlanned') {
          // User is trying to release via status dropdown
          const result = await releaseProductionOrder(docEntry);
          if (result.production_order) {
            _loadOrder(result.production_order);
          }
          showAlert("success", "Production order released successfully.");
        } else {
          // Normal update
          const result = await updateProductionOrder(docEntry, payload);
          _loadOrder(result.production_order);
          showAlert("success", "Production order updated.");
        }
      }
    } catch (err) {
      showAlert("error", err.response?.data?.detail || err.message || "Save failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleFind = async () => {
    const query = String(header.doc_num || "").trim() || header.item_code.trim() || header.item_name.trim();
    setListQuery(query);
    setMode(MODES.LIST);
  };

  const openFind = () => {
    const query = String(header.doc_num || "").trim() || header.item_code.trim() || header.item_name.trim();
    setListQuery(query);
    setMode(MODES.LIST);
  };

  const handleClose = async () => {
    if (!docEntry) return;
    if (!window.confirm("Close this production order?")) return;
    setLoading(true);
    try {
      const result = await closeProductionOrder(docEntry);
      if (result.production_order) {
        _loadOrder(result.production_order);
      } else {
        setHeader((prev) => ({ ...prev, status: "boposClosed" }));
      }
      showAlert("success", "Production order closed.");
    } catch (err) {
      showAlert("error", err.response?.data?.message || "Close failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleRelease = async () => {
    if (!docEntry) return;
    if (!window.confirm("Release this production order?")) return;
    setLoading(true);
    try {
      const result = await releaseProductionOrder(docEntry);
      if (result.production_order) {
        _loadOrder(result.production_order);
      } else {
        setHeader((prev) => ({ ...prev, status: "boposReleased" }));
      }
      showAlert("success", "Production order released.");
    } catch (err) {
      showAlert("error", err.response?.data?.message || "Release failed.");
    } finally {
      setLoading(false);
    }
  };

  // ── Load order from SAP response ───────────────────────────────────────────
  const _loadOrder = (data) => {
    setHeader({
      doc_num:           data.doc_num           || "",
      item_code:         data.item_code         || "",
      item_name:         data.item_name         || "",
      uom_name:          data.uom_name          || "",
      bom_qty:           data.bom_qty           ?? 1,
      planned_qty:       data.planned_qty        ?? 1,
      completed_qty:     data.completed_qty      ?? 0,
      rejected_qty:      data.rejected_qty       ?? 0,
      due_date:          data.due_date           || today(),
      posting_date:      data.posting_date       || today(),
      start_date:        data.start_date         || today(),
      order_date:        data.order_date         || today(),
      status:            data.status             || "boposPlanned",
      type:              data.type               || "bopotStandard",
      warehouse:         data.warehouse          || "",
      priority:          data.priority           ?? 100,
      routing_date_calc: data.routing_date_calc  || "start",
      procure_items:     Boolean(data.procure_items),
      distribution_rule: data.distribution_rule  || "",
      project:           data.project            || "",
      branch:            data.branch             || "",
      branch_name:       data.branch_name        || "",
      customer_code:     data.customer_code      || "",
      customer_name:     data.customer_name      || "",
      origin:            data.origin             || "",
      linked_to:         data.linked_to          || "",
      linked_order:      data.linked_order       || "",
      linked_order_entry:data.linked_order_entry || "",
      user_id:           data.user_id            || "",
      user:              data.user               || "",
      journal_remark:    data.journal_remark     || "",
      remarks:           data.remarks            || "",
      pick_pack_remarks: data.pick_pack_remarks  || "",
      series:            data.series             || "",
      origin_num:        data.origin_num         || "",
    });
    setLines(
      (data.lines || []).map((l) => ({
        _id:              Date.now() + Math.random(),
        line_num:         l.line_num         ?? 0,
        item_code:        l.item_code        || "",
        item_name:        l.item_name        || "",
        line_text:        l.line_text        || "",
        base_qty:         l.base_qty         ?? 1,
        base_ratio:       l.base_ratio       ?? l.base_qty ?? 1,
        planned_qty:      l.planned_qty      ?? 1,
        issued_qty:       l.issued_qty       ?? 0,
        available_qty:    l.available_qty    ?? 0,
        uom:              l.uom              || l.uom_code || l.uom_name || "",
        uom_code:         l.uom_code         || l.uom || "",
        uom_name:         l.uom_name         || l.uom || "",
        warehouse:        l.warehouse        || "",
        issue_method:     l.issue_method     || "im_Manual",
        wip_account:      l.wip_account      || "",
        distribution_rule:l.distribution_rule|| "",
        project:          l.project          || "",
        location:         l.location         || "",
        additional_qty:   l.additional_qty   ?? 0,
        stage_id:         l.stage_id         ?? "",
        route_sequence:   l.route_sequence   ?? l.stage_id ?? "",
        procurement_method:l.procurement_method || "",
        component_type:   l.component_type   || "pit_Item",
      }))
    );
  };

  // ── Select from list ───────────────────────────────────────────────────────
  const handleSelectFromList = async (de) => {
    if (de === null) {
      setMode(MODES.ADD);
      resetForm();
      return;
    }
    setLoading(true);
    try {
      console.log('[ProductionOrder] Loading order with DocEntry:', de);
      const data = await fetchProductionOrderByDocEntry(de);
      console.log('[ProductionOrder] Order data received:', data);
      _loadOrder(data.production_order);
      setDocEntry(de);
      setMode(MODES.UPDATE);
      showAlert("success", `Production Order #${data.production_order.doc_num} loaded.`);
    } catch (err) {
      console.error('[ProductionOrder] Load error:', err);
      const errorMsg = err.response?.data?.detail || err.response?.data?.message || err.message || "Load failed.";
      showAlert("error", errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const isReadOnly = header.status === "boposClosed" || header.status === "boposCancelled";
  const isSpecialType = header.type === "bopotSpecial";
  const statusKey  = STATUS_LABELS[header.status] || header.status;
  const canEditStatus = mode === MODES.UPDATE && !isReadOnly;
  const componentCount = lines.filter((line) => line.item_code || line.line_text).length;
  const dueDateValue = header.due_date || "";
  const actualClosingDate = header.status === "boposClosed" ? (header.due_date || "") : "";
  const overdueDays = (() => {
    if (!header.due_date || header.status === "boposClosed" || header.status === "boposCancelled") return "";
    const due = new Date(header.due_date);
    const now = new Date();
    due.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    const diffMs = now.getTime() - due.getTime();
    if (diffMs <= 0) return "";
    return String(Math.floor(diffMs / 86400000));
  })();
  const totalRunTime = formatSummaryNumber(componentCount);
  const itemModalLine = itemModal.target === "header"
    ? null
    : lines.find((line) => line._id === itemModal.target);
  const isResourceItemModal = itemModalLine?.component_type === "pit_Resource";
  const itemModalTitle = itemModal.target === "header"
    ? (isSpecialType ? "List of Items" : "List of Bill of Materials")
    : isResourceItemModal
      ? "Resource Search"
      : "Component Search";
  const itemModalFetchItems = itemModal.target === "header"
    ? (isSpecialType ? fetchProdOrderFinishItems : fetchProdOrderItems)
    : isResourceItemModal
      ? fetchProdOrderResources
      : fetchProdOrderComponentItems;
  const itemModalColumns = itemModal.target === "header"
    ? isSpecialType
      ? [
          { key: "ItemDescription", label: "Item Description" },
          { key: "ItemNo", label: "Item No." },
          { key: "InStock", label: "In Stock", className: "im-lookup-table__num", render: (value) => Number(value || 0).toFixed(2) },
          { key: "ItemGroup", label: "Item Group" },
        ]
      : [
          { key: "ItemCode", label: "Item No." },
          { key: "ItemName", label: "Item Description" },
          { key: "InStock", label: "In Stock", className: "im-lookup-table__num", render: (value) => Number(value || 0).toFixed(2) },
        ]
    : isResourceItemModal
      ? [
          { key: "Code", label: "Resource Code" },
          { key: "Name", label: "Resource Name" },
          { key: "DefaultWarehouse", label: "Whse" },
          { key: "IssueMethod", label: "Issue Method" },
        ]
      : undefined;

  // ── List view ──────────────────────────────────────────────────────────────
  if (mode === MODES.LIST) {
    return <ProductionOrderList initialQuery={listQuery} onSelect={handleSelectFromList} />;
  }

  return (
    <div className="im-page po-page">
      {/* Toolbar */}
      <div className="im-toolbar">
        <span className="im-toolbar__title">Production Order</span>
        <span className={`im-mode-badge im-mode-badge--${mode}`}>
          {mode === MODES.ADD ? "Add Mode" : mode === MODES.FIND ? "Find Mode" : "Update Mode"}
        </span>
        {header.status && (
          <span className={`po-status-badge po-status-badge--${statusKey.toLowerCase()}`}>
            {statusKey}
          </span>
        )}

        <button className="im-btn im-btn--primary" onClick={handleSave} disabled={loading || isReadOnly}>
          {loading ? "…" : mode === MODES.FIND ? "Find" : mode === MODES.ADD ? "Add" : "Update"}
        </button>
        <button className="im-btn" onClick={() => { setMode(MODES.ADD); resetForm(); }}>New</button>
<button className="im-btn" data-sap-find-action onClick={openFind}>Find</button>
        
        {/* Conditional action buttons based on status */}
        {mode === MODES.UPDATE && header.status === "boposPlanned" && (
          <button className="im-btn" onClick={handleRelease} disabled={loading}>Release</button>
        )}
        {mode === MODES.UPDATE && header.status === "boposReleased" && (
          <button className="im-btn" onClick={handleClose} disabled={loading}>Close Order</button>
        )}
        
        <button className="im-btn" onClick={resetForm}>Cancel</button>
      </div>

      {alert && <div className={`im-alert im-alert--${alert.type}`}>{alert.msg}</div>}

      {/* ── Header ── */}
      <div className="im-header-card">
        <div className="po-header-layout">

          {/* Left column */}
          <div className="po-header-left">
            <div className="im-field">
              <label className="im-field__label po-lbl">Type</label>
              <select className="im-field__select" name="type" value={header.type}
                onChange={handleHeaderChange} disabled={mode === MODES.UPDATE} style={{ width: 160 }}>
                {(prodTypes.length ? prodTypes : Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))).map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl">Status</label>
              <select className="im-field__select" name="status" value={header.status}
                onChange={handleHeaderChange} disabled={!canEditStatus} style={{ width: 160 }}>
                {(prodStatuses.length ? prodStatuses : Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))).map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl">Product No.</label>
              <div className="im-lookup-wrap">
                <input className="im-field__input" name="item_code" value={header.item_code}
                  onChange={handleHeaderChange} readOnly={mode === MODES.UPDATE || isSpecialType}
                  style={{ width: 130 }} autoFocus />
                {mode !== MODES.UPDATE && !isSpecialType && (
                  <button className="im-lookup-btn" onClick={() => setItemModal({ open: true, target: "header" })}>…</button>
                )}
              </div>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl">Product Description</label>
              {isSpecialType && mode !== MODES.UPDATE ? (
                <div className="im-lookup-wrap" style={{ flex: 1 }}>
                  <input className="im-field__input" name="item_name" value={header.item_name}
                    onChange={handleHeaderChange} style={{ flex: 1 }} />
                  <button className="im-lookup-btn" onClick={() => setItemModal({ open: true, target: "header" })}>…</button>
                </div>
              ) : (
                <input className="im-field__input" name="item_name" value={header.item_name}
                  onChange={handleHeaderChange} style={{ flex: 1 }} />
              )}
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl">Planned Qty</label>
              <input className="im-field__input" name="planned_qty" type="number" min="0.001" step="any"
                value={header.planned_qty} onChange={handleHeaderChange}
                readOnly={isReadOnly} style={{ width: 100 }} />
              <label className="im-field__label po-uom-lbl">UoM Name</label>
              <input className="im-field__input po-readonly" value={header.uom_name} readOnly style={{ width: 120 }} />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl">Warehouse</label>
              <select className="im-field__select" name="warehouse" value={header.warehouse}
                onChange={handleHeaderChange} disabled={isReadOnly} style={{ width: 160 }}>
                <option value="">--</option>
                {branchWarehouses.map((w) => (
                  <option key={w.WarehouseCode} value={w.WarehouseCode}>{w.WarehouseCode}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl">Branch</label>
              <select className="im-field__select" name="branch" value={header.branch}
                onChange={handleHeaderChange} disabled={isReadOnly} style={{ width: 200 }}>
                <option value="">--</option>
                {branches.map((branch) => (
                  <option key={branch.BPLID} value={branch.BPLID}>{branch.BPLName}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl">Priority</label>
              <input className="im-field__input" name="priority" type="number" min="1" step="1"
                value={header.priority} onChange={handleHeaderChange}
                readOnly={isReadOnly} style={{ width: 100 }} />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl">Routing Date Calculation</label>
              <select className="im-field__select" name="routing_date_calc" value={header.routing_date_calc}
                onChange={handleHeaderChange} disabled={isReadOnly} style={{ width: 160 }}>
                <option value="start">On Start Date</option>
                <option value="due">On Due Date</option>
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl"></label>
              <label className="po-checkline">
                <input
                  type="checkbox"
                  name="procure_items"
                  checked={header.procure_items}
                  onChange={handleHeaderChange}
                  disabled={isReadOnly}
                />
                <span>Procure Items</span>
              </label>
            </div>

          </div>

          {/* Right column */}
          <div className="po-header-right">
            <div className="im-field">
              <label className="im-field__label po-lbl-r">No.</label>
              <select className="im-field__select" name="series" value={header.series}
                onChange={handleHeaderChange} disabled={isReadOnly} style={{ width: 100 }}>
                <option value="">--</option>
                {getSapVisibleDocumentSeries(series, {
                  selectedSeries: header.series,
                  postingDate: header.posting_date || header.order_date,
                }).map((s) => (
                  <option key={s.Series} value={s.Series}>{s.DisplayName || s.SeriesName || s.Name}</option>
                ))}
              </select>
              <input className="im-field__input po-readonly" value={header.doc_num || (mode === MODES.ADD ? "(auto)" : "")} readOnly style={{ width: 90, marginLeft: 4 }} />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Order Date</label>
              <SapDateInput className="im-field__input po-readonly" name="order_date" 
                value={header.order_date} readOnly style={{ width: 140 }} />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Start Date</label>
              <SapDateInput className="im-field__input" name="start_date" 
                value={header.start_date} onChange={handleHeaderChange}
                readOnly={isReadOnly} style={{ width: 140 }} />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Due Date</label>
              <SapDateInput className="im-field__input" name="due_date" 
                value={header.due_date} onChange={handleHeaderChange}
                readOnly={isReadOnly} style={{ width: 140 }} />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Origin</label>
              <input className="im-field__input po-readonly" name="origin" 
                value={header.origin || "Manual"} readOnly style={{ width: 140 }} />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Linked To</label>
              <select className="im-field__select" name="linked_to" value={header.linked_to}
                onChange={handleHeaderChange} disabled={isReadOnly} style={{ width: 160 }}>
                <option value="">--</option>
                {linkedToOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Linked Order</label>
              <div className="im-lookup-wrap">
                <input
                  className="im-field__input po-readonly"
                  value={header.linked_order || ""}
                  readOnly
                  style={{ width: 140 }}
                />
                {!isReadOnly && header.linked_to && (
                  <button className="im-lookup-btn" onClick={() => setLinkedOrderModal(true)}>…</button>
                )}
              </div>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">User</label>
              <UserPicker
                users={users}
                value={header.user_id}
                displayValue={header.user}
                disabled={isReadOnly}
                onSelect={handleUserSelect}
                onRefresh={loadUsersLive}
              />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Customer</label>
              <div className="im-lookup-wrap">
                <input className="im-field__input" name="customer_code" 
                  value={header.customer_code} onChange={handleHeaderChange}
                  readOnly={isReadOnly} style={{ width: 100 }} />
                {!isReadOnly && (
                  <button className="im-lookup-btn" onClick={() => setCustomerModal(true)}>…</button>
                )}
              </div>
              <input className="im-field__input po-readonly" 
                value={header.customer_name} readOnly style={{ flex: 1, marginLeft: 4 }} />
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Distr. Rule</label>
              <select className="im-field__select" name="distribution_rule" value={header.distribution_rule}
                onChange={handleHeaderChange} disabled={isReadOnly} style={{ width: 160 }}>
                <option value="">--</option>
                {distRules.map((d) => (
                  <option key={d.FactorCode} value={d.FactorCode}>{d.FactorCode} – {d.FactorDescription}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label po-lbl-r">Project</label>
              <select className="im-field__select" name="project" value={header.project}
                onChange={handleHeaderChange} disabled={isReadOnly} style={{ width: 160 }}>
                <option value="">--</option>
                {projects.map((p) => (
                  <option key={p.Code} value={p.Code}>{p.Code} – {p.Name}</option>
                ))}
              </select>
            </div>

          </div>

        </div>
      </div>

      {/* Tabs */}
      <div className="im-tabs">
        {TABS.map((t, i) => (
          <button key={t} type="button"
            className={`im-tab${tab === i ? " im-tab--active" : ""}`}
            onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div className="im-tab-panel po-tab-panel">
        {tab === 0 && (
          <ProductionOrderLines
            lines={lines}
            warehouses={branchWarehouses}
            distRules={distRules}
            projects={projects}
            routeStages={routeStages}
            readOnly={isReadOnly}
            onChange={handleLineChange}
            onAdd={addLine}
            onDelete={deleteLine}
            onItemSearch={(lineId) => setItemModal({ open: true, target: lineId })}
          />
        )}
        {tab === 1 && (
          <div className="po-summary-panel">
            <div className="po-summary-columns">
              <div className="po-summary-group">
                <div className="po-summary-group__title">Costs</div>
                <div className="po-summary-field">
                  <label>Actual Item Component Cost</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Actual Resource Component Cost</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Actual Additional Cost</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Actual Product Cost</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Actual By-Product Cost</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Total Variance</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
              </div>

              <div className="po-summary-group">
                <div className="po-summary-group__title">Quantities</div>
                <div className="po-summary-field">
                  <label>Planned Quantity</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(header.planned_qty)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Completed Quantity</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(header.completed_qty)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Rejected Quantity</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(header.rejected_qty)} readOnly />
                </div>

                <div className="po-summary-group__title po-summary-group__title--spaced">Dates</div>
                <div className="po-summary-field">
                  <label>Due Date</label>
                  <input className="im-field__input po-readonly" value={dueDateValue} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Actual Closing Date</label>
                  <input className="im-field__input po-readonly" value={actualClosingDate} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Overdue</label>
                  <input className="im-field__input po-readonly" value={overdueDays} readOnly />
                </div>
              </div>

              <div className="po-summary-group">
                <div className="po-summary-group__title">Planned Times</div>
                <div className="po-summary-field">
                  <label>Total Production Time</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Total Additional Time</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Total Run Time</label>
                  <input className="im-field__input po-readonly" value={totalRunTime} readOnly />
                </div>

                <div className="po-summary-group__title po-summary-group__title--spaced">Planned Days</div>
                <div className="po-summary-field">
                  <label>Total Required Days</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Total Waiting Days</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
                <div className="po-summary-field">
                  <label>Total Days</label>
                  <input className="im-field__input po-readonly" value={formatSummaryNumber(0)} readOnly />
                </div>
              </div>
            </div>

            <div className="po-summary-footer">
              <div className="po-summary-field po-summary-field--wide">
                <label>Journal Remark</label>
                <input className="im-field__input po-readonly" value={header.journal_remark || ""} readOnly />
              </div>
              <div className="po-summary-field po-summary-field--wide">
                <label>Referenced Document</label>
                <input className="im-field__input po-readonly" value={header.linked_order || header.origin_num || ""} readOnly />
              </div>
            </div>
          </div>
        )}
        {tab === 2 && (
          <div className="po-attachments-panel">
            <input className="im-field__input" type="file" multiple disabled={isReadOnly} />
          </div>
        )}
      </div>

      <div className="po-remarks-row">
        <div className="po-remarks-field">
          <label className="im-field__label">Remarks</label>
          <textarea
            name="remarks"
            value={header.remarks}
            onChange={handleHeaderChange}
            readOnly={isReadOnly}
            rows={2}
          />
        </div>
        <div className="po-remarks-field">
          <label className="im-field__label">Pick and Pack Remarks</label>
          <textarea
            name="pick_pack_remarks"
            value={header.pick_pack_remarks}
            onChange={handleHeaderChange}
            readOnly={isReadOnly}
            rows={2}
          />
        </div>
      </div>

      {/* Item search modal */}
      {itemModal.open && (
        <ItemSearchModal
          onSelect={handleItemSelect}
          onClose={() => setItemModal({ open: false, target: null })}
          title={itemModalTitle}
          fetchItems={itemModalFetchItems}
          autoSearchOnOpen
          emptyMessage={itemModal.target === "header" ? "" : "No items found."}
          columns={itemModalColumns}
        />
      )}

      {linkedOrderModal && (
        <ItemSearchModal
          onSelect={handleLinkedOrderSelect}
          onClose={() => setLinkedOrderModal(false)}
          title={`List of ${linkedToOptions.find((option) => option.value === header.linked_to)?.label || "Linked Orders"}`}
          fetchItems={(query) => fetchProdOrderLinkedOrders(header.linked_to, query)}
          autoSearchOnOpen={false}
          emptyMessage=""
          columns={
            header.linked_to === "sales_order"
              ? [
                  { key: "DocNum", label: "Document No." },
                  { key: "CardCode", label: "Customer Code" },
                  { key: "CardName", label: "Customer Name" },
                  { key: "DueDate", label: "Due Date" },
                ]
              : [
                  { key: "DocNum", label: "Document No." },
                  { key: "ItemNo", label: "Product No." },
                  { key: "ProductDescription", label: "Product Description" },
                  { key: "Status", label: "Status" },
                ]
          }
        />
      )}

      {/* Customer search modal */}
      {customerModal && (
        <CustomerSearchModal
          onSelect={handleCustomerSelect}
          onClose={() => setCustomerModal(false)}
          fetchCustomers={fetchProdOrderCustomers}
        />
      )}
    </div>
  );
}
