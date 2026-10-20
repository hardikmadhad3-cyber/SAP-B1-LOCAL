import SapDateInput from '../../components/common/SapDateInput';
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "../../modules/item-master/styles/itemMaster.css";
import "./productionOrder.css";
import ProductionOrderLines from "./components/ProductionOrderLines";
import ProductionOrderList  from "./components/ProductionOrderList";
import ItemSearchModal       from "../bom/components/ItemSearchModal";
import CustomerSearchModal   from "./components/CustomerSearchModal";
import DocumentAttachmentsTab from "../../components/document/DocumentAttachmentsTab";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { applyLineEdit, buildProductionOrderPayload, recalcPlannedQty } from "./productionOrderHelpers";
import {
  fetchProductionOrderReferenceData,
  fetchProductionOrderSeries,
  fetchProductionOrderByDocEntry,
  createProductionOrder,
  updateProductionOrder,
  releaseProductionOrder,
  closeProductionOrder,
  cancelProductionOrder,
  navigateProductionOrder,
  fetchProductionOrderAttachments,
  uploadProductionOrderAttachment,
  deleteProductionOrderAttachment,
  downloadProductionOrderAttachment,
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
  pick_remarks:      "",
  series:            defaultSeries,
  origin_num:        "",
  closing_date:      "",
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
const errorText = (err, fallback) => err.response?.data?.detail || err.response?.data?.message || err.message || fallback;
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
  const navigate = useNavigate();
  const [mode,    setMode]    = useState(MODES.ADD);
  const [tab,     setTab]     = useState(0);
  const [header,  setHeader]  = useState(EMPTY_HEADER);
  const [lines,   setLines]   = useState([EMPTY_LINE()]);
  const [alert,   setAlert]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [docEntry, setDocEntry] = useState(null);
  const [listQuery, setListQuery] = useState("");
  const [stages, setStages] = useState([]);
  const [summary, setSummary] = useState({});
  const [relatedDocuments, setRelatedDocuments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [closeDate, setCloseDate] = useState(null); // null = closing-date bar hidden
  const fileInputRef = useRef(null);

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
    setStages([]);
    setSummary({});
    setRelatedDocuments([]);
    setAttachments([]);
    setCloseDate(null);
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
      setStages([]);
    }

    // SAP: row planned qty = base ratio x header planned qty + additional qty.
    if (name === "planned_qty") {
      setLines((prevLines) => prevLines.map((line) => recalcPlannedQty(line, value)));
    }
  }, [mode]);

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
        setStages([]);
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

        setStages(bomData.stages || []);
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
        showAlert("error", `Item selected but BOM explosion failed: ${err.message}`);
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
        return applyLineEdit(l, field, value, header.planned_qty, header.bom_qty);
      })
    );
  }, [header.planned_qty, header.bom_qty]);

  const addStage = useCallback((stageEntry) => {
    const routeStage = routeStages.find((stage) => String(stage.InternalNumber) === String(stageEntry));
    if (!routeStage) return;
    setStages((prev) => {
      const nextId = prev.reduce((max, stage) => Math.max(max, Number(stage.StageID) || 0), 0) + 1;
      return [...prev, {
        StageID: nextId,
        SequenceNumber: nextId,
        StageEntry: routeStage.InternalNumber,
        Name: routeStage.Description || routeStage.Code,
        StageCode: routeStage.Code,
      }];
    });
  }, [routeStages]);

  const addLine    = () => setLines((prev) => [...prev, EMPTY_LINE()]);
  const deleteLine = useCallback((id) => setLines((prev) => prev.filter((l) => l._id !== id)), []);

  // ── Validate ───────────────────────────────────────────────────────────────
  const validate = () => {
    if (!header.item_code.trim())       { showAlert("error", "Finished goods item is required.");  return false; }
    if (Number(header.planned_qty) <= 0){ showAlert("error", "Planned quantity must be > 0.");     return false; }
    if (!header.due_date)               { showAlert("error", "Due date is required.");             return false; }
    return true;
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (mode === MODES.FIND) { await handleFind(); return; }
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = buildProductionOrderPayload(header, lines, stages);
      if (mode === MODES.ADD) {
        const result = await createProductionOrder(payload);
        showAlert("success", `Production Order #${result.doc_num} created.`);
        if (result.doc_entry) {
          const loaded = await fetchProductionOrderByDocEntry(result.doc_entry);
          _loadOrder(loaded.production_order);
          setMode(MODES.UPDATE);
        }
      } else {
        const result = await updateProductionOrder(docEntry, payload);
        _loadOrder(result.production_order);
        showAlert("success", "Production order updated.");
      }
    } catch (err) {
      showAlert("error", errorText(err, "Save failed."));
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

  // Runs a status action (release / close / cancel) and reloads the order it returns.
  const runAction = async (action, successMsg) => {
    setLoading(true);
    try {
      const result = await action();
      if (result.production_order) _loadOrder(result.production_order);
      showAlert("success", successMsg);
      return true;
    } catch (err) {
      showAlert("error", errorText(err, "Action failed."));
      return false;
    } finally {
      setLoading(false);
    }
  };

  // SAP closes on an actual closing date; leftover WIP posts as variance on it.
  const handleClose = async () => {
    if (!docEntry || !closeDate) return;
    if (await runAction(() => closeProductionOrder(docEntry, closeDate), "Production order closed.")) setCloseDate(null);
  };

  const handleRelease = async () => {
    if (!docEntry || !window.confirm("Release this production order?")) return;
    await runAction(() => releaseProductionOrder(docEntry), "Production order released.");
  };

  const handleCancelOrder = async () => {
    if (!docEntry || !window.confirm("Cancel this production order? This cannot be undone.")) return;
    await runAction(() => cancelProductionOrder(docEntry), "Production order cancelled.");
  };

  const handleBrowse = async (direction) => {
    setLoading(true);
    try {
      const data = await navigateProductionOrder(direction, docEntry || "");
      _loadOrder(data.production_order);
      setMode(MODES.UPDATE);
    } catch (err) {
      showAlert("error", errorText(err, "No more production orders."));
    } finally {
      setLoading(false);
    }
  };

  // SAP Duplicate: same header and rows as a new Planned order in Add mode.
  const handleDuplicate = () => {
    setHeader((prev) => ({
      ...prev,
      doc_num: "",
      status: "boposPlanned",
      completed_qty: 0,
      rejected_qty: 0,
      posting_date: today(),
      order_date: today(),
      closing_date: "",
      origin: "",
      origin_num: "",
      series: defaultSeries || getDefaultSeriesValue(series),
    }));
    setLines((prev) => prev.map((line) => ({ ...line, _id: Date.now() + Math.random(), issued_qty: 0 })));
    setSummary({});
    setRelatedDocuments([]);
    setAttachments([]);
    setCloseDate(null);
    setDocEntry(null);
    setMode(MODES.ADD);
    showAlert("success", "Order duplicated. Review it and choose Add.");
  };

  // ── Attachments (stored once the order is saved) ───────────────────────────
  const reloadAttachments = (entry) => (
    fetchProductionOrderAttachments(entry)
      .then((rows) => setAttachments(Array.isArray(rows) ? rows : []))
      .catch(() => setAttachments([]))
  );
  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    try {
      for (const file of files) await uploadProductionOrderAttachment(docEntry, file);
    } catch (err) {
      showAlert("error", errorText(err, "Upload failed."));
    }
    reloadAttachments(docEntry);
  };
  const handleDisplayAttachment = async (attachment) => {
    try {
      const url = URL.createObjectURL(await downloadProductionOrderAttachment(docEntry, attachment.id));
      Object.assign(document.createElement("a"), { href: url, download: attachment.name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      showAlert("error", errorText(err, "Download failed."));
    }
  };
  const handleDeleteAttachment = async (attachment) => {
    try {
      await deleteProductionOrderAttachment(docEntry, attachment.id);
    } catch (err) {
      showAlert("error", errorText(err, "Delete failed."));
    }
    reloadAttachments(docEntry);
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
      distribution_rule: data.distribution_rule  || "",
      project:           data.project            || "",
      branch:            data.branch             || "",
      branch_name:       data.branch_name        || "",
      customer_code:     data.customer_code      || "",
      customer_name:     data.customer_name      || "",
      origin:            data.origin             || "",
      linked_to:         data.linked_to          || "",
      // linked_order is the origin DocEntry; origin_num is its document number.
      linked_order:      data.origin_num         || data.linked_order || "",
      linked_order_entry:data.linked_order       || "",
      user_id:           data.user_id            || "",
      user:              data.user               || "",
      journal_remark:    data.journal_remark     || "",
      remarks:           data.remarks            || "",
      pick_remarks:      data.pick_remarks       || "",
      series:            data.series             || "",
      origin_num:        data.origin_num         || "",
      closing_date:      data.closing_date       || "",
    });
    setStages(data.stages || []);
    setSummary(data.summary || {});
    setRelatedDocuments(data.related_documents || []);
    if (data.doc_entry) {
      setDocEntry(data.doc_entry);
      reloadAttachments(data.doc_entry);
    }
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
      const data = await fetchProductionOrderByDocEntry(de);
      _loadOrder(data.production_order);
      setMode(MODES.UPDATE);
      showAlert("success", `Production Order #${data.production_order.doc_num} loaded.`);
    } catch (err) {
      showAlert("error", errorText(err, "Load failed."));
    } finally {
      setLoading(false);
    }
  };

  // SAP: only Planned orders can be edited; status changes only through the actions.
  const isReadOnly = header.status !== "boposPlanned";
  const isSpecialType = header.type === "bopotSpecial";
  const isReleased = mode === MODES.UPDATE && header.status === "boposReleased";
  const statusKey  = STATUS_LABELS[header.status] || header.status;
  const dueDateValue = header.due_date || "";
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
        <button className="im-btn" onClick={() => handleBrowse("first")} disabled={loading} aria-label="First record">|&lt;</button>
        <button className="im-btn" onClick={() => handleBrowse("prev")} disabled={loading} aria-label="Previous record">&lt;</button>
        <button className="im-btn" onClick={() => handleBrowse("next")} disabled={loading} aria-label="Next record">&gt;</button>
        <button className="im-btn" onClick={() => handleBrowse("last")} disabled={loading} aria-label="Last record">&gt;|</button>
        {mode === MODES.UPDATE && (
          <button className="im-btn" onClick={handleDuplicate} disabled={loading}>Duplicate</button>
        )}

        {/* Status changes only through these actions (SAP B1). */}
        {mode === MODES.UPDATE && header.status === "boposPlanned" && (
          <button className="im-btn" onClick={handleRelease} disabled={loading}>Release</button>
        )}
        {isReleased && (
          <>
            <button className="im-btn" onClick={() => navigate("/issue-for-production", { state: { prodOrderEntry: docEntry } })}>Issue Components</button>
            <button className="im-btn" onClick={() => navigate("/receipt-from-production", { state: { prodOrderEntry: docEntry } })}>Report Completion</button>
            <button className="im-btn" onClick={() => setCloseDate(today())} disabled={loading}>Close Order</button>
          </>
        )}
        {mode === MODES.UPDATE && (header.status === "boposPlanned" || header.status === "boposReleased") && (
          <button className="im-btn" onClick={handleCancelOrder} disabled={loading}>Cancel Order</button>
        )}

        <button className="im-btn" onClick={resetForm}>Cancel</button>
      </div>

      {alert && <div className={`im-alert im-alert--${alert.type}`} role={alert.type === "error" ? "alert" : undefined}>{alert.msg}</div>}

      {closeDate !== null && (
        <div className="im-header-card po-close-bar">
          <label className="im-field">
            <span className="im-field__label">Actual Closing Date</span>
            <SapDateInput className="im-field__input" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} style={{ width: 140 }} />
          </label>
          <button className="im-btn im-btn--primary" onClick={handleClose} disabled={loading || !closeDate}>Close Order</button>
          <button className="im-btn" onClick={() => setCloseDate(null)}>Cancel</button>
        </div>
      )}

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
                disabled title="Status changes through Release, Close Order and Cancel Order" style={{ width: 160 }}>
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
                  onChange={handleHeaderChange} readOnly={isReadOnly} style={{ flex: 1 }} />
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
            stages={stages}
            warehouses={branchWarehouses}
            distRules={distRules}
            projects={projects}
            routeStages={routeStages}
            readOnly={isReadOnly}
            isDisassembly={header.type === "bopotDisassemble"}
            onChange={handleLineChange}
            onAdd={addLine}
            onDelete={deleteLine}
            onAddStage={addStage}
            onItemSearch={(lineId) => setItemModal({ open: true, target: lineId })}
          />
        )}
        {tab === 1 && (
          <div className="po-summary-panel">
            <div className="po-summary-columns">
              <div className="po-summary-group">
                <div className="po-summary-group__title">Actual Costs</div>
                {[
                  ["Actual Item Component Cost", summary.actual_component_cost],
                  ["Actual Resource Component Cost", summary.actual_resource_cost],
                  ["Actual Additional Cost", summary.actual_additional_cost],
                  ["Total Actual Cost", summary.total_actual_cost],
                  ["Actual Product Cost", summary.actual_product_cost],
                  ["Actual By-Product Cost", summary.by_product_value],
                  ["WIP Balance", summary.wip_balance],
                  ["Total Variance", summary.total_variance],
                ].map(([label, value]) => (
                  <label key={label} className="po-summary-field">
                    <span>{label}</span>
                    <input className="im-field__input po-readonly" value={formatSummaryNumber(value)} readOnly />
                  </label>
                ))}
              </div>

              <div className="po-summary-group">
                <div className="po-summary-group__title">Quantities</div>
                {[
                  ["Planned Quantity", header.planned_qty],
                  ["Completed Quantity", header.completed_qty],
                  ["Rejected Quantity", header.rejected_qty],
                ].map(([label, value]) => (
                  <label key={label} className="po-summary-field">
                    <span>{label}</span>
                    <input className="im-field__input po-readonly" value={formatSummaryNumber(value)} readOnly />
                  </label>
                ))}

                <div className="po-summary-group__title po-summary-group__title--spaced">Dates</div>
                {[
                  ["Due Date", dueDateValue],
                  ["Actual Closing Date", header.closing_date],
                  ["Overdue (Days)", overdueDays],
                ].map(([label, value]) => (
                  <label key={label} className="po-summary-field">
                    <span>{label}</span>
                    <input className="im-field__input po-readonly" value={value || ""} readOnly />
                  </label>
                ))}
              </div>

              <div className="po-summary-group">
                <div className="po-summary-group__title">Planned Costs</div>
                {[
                  ["Planned Item Component Cost", summary.planned_component_cost],
                  ["Planned Resource Cost", summary.planned_resource_cost],
                  ["Total Planned Cost", summary.total_planned_cost],
                ].map(([label, value]) => (
                  <label key={label} className="po-summary-field">
                    <span>{label}</span>
                    <input className="im-field__input po-readonly" value={formatSummaryNumber(value)} readOnly />
                  </label>
                ))}
              </div>
            </div>

            <div className="po-summary-footer">
              <label className="po-summary-field po-summary-field--wide">
                <span>Journal Remark</span>
                <input className={`im-field__input${isReadOnly ? " po-readonly" : ""}`} name="journal_remark"
                  value={header.journal_remark || ""} onChange={handleHeaderChange} readOnly={isReadOnly} />
              </label>
              <label className="po-summary-field po-summary-field--wide">
                <span>Referenced Document</span>
                <input className="im-field__input po-readonly" value={header.linked_order || header.origin_num || ""} readOnly />
              </label>
            </div>

            <div className="po-summary-group__title">Related Documents</div>
            <div className="im-grid-wrap">
              <table className="im-grid">
                <thead>
                  <tr><th>Document</th><th>No.</th><th>Posting Date</th><th>Total</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {relatedDocuments.map((doc) => (
                    <tr key={`${doc.type}-${doc.doc_entry}`}>
                      <td>{doc.type}</td>
                      <td>
                        <button type="button" className="po-link-btn"
                          onClick={() => navigate(doc.type === "Issue for Production" ? "/issue-for-production" : "/receipt-from-production", { state: { docEntry: doc.doc_entry } })}>
                          {doc.doc_num}
                        </button>
                      </td>
                      <td>{doc.posting_date}</td>
                      <td className="po-num">{formatSummaryNumber(doc.total)}</td>
                      <td>{doc.cancelled ? "Cancelled" : "Posted"}</td>
                    </tr>
                  ))}
                  {summary.variance_trans_id && (
                    <tr>
                      <td>Journal Entry (Variance)</td>
                      <td>
                        <button type="button" className="po-link-btn"
                          onClick={() => navigate("/journal-entry", { state: { journalEntryTransId: summary.variance_trans_id } })}>
                          {summary.variance_trans_id}
                        </button>
                      </td>
                      <td>{header.closing_date}</td>
                      <td className="po-num">{formatSummaryNumber(summary.total_variance)}</td>
                      <td>Posted</td>
                    </tr>
                  )}
                  {!relatedDocuments.length && !summary.variance_trans_id && (
                    <tr><td colSpan={5}>No issues or receipts posted yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 2 && (
          <>
            {!docEntry && <p className="po-hint">Add the order first, then attach files.</p>}
            <input ref={fileInputRef} type="file" multiple hidden onChange={handleAttachFiles} aria-label="Attachment files" />
            <DocumentAttachmentsTab
              attachments={attachments.map((row) => ({ ...row, fileName: row.fileName || row.name, targetPath: row.type }))}
              isEditable={Boolean(docEntry)}
              onBrowseAttachment={docEntry ? () => fileInputRef.current?.click() : undefined}
              onDisplayAttachment={docEntry ? handleDisplayAttachment : undefined}
              onDeleteAttachment={docEntry ? handleDeleteAttachment : undefined}
            />
          </>
        )}
      </div>

      <div className="po-remarks-row">
        <label className="po-remarks-field">
          <span className="im-field__label">Remarks</span>
          <textarea
            name="remarks"
            value={header.remarks}
            onChange={handleHeaderChange}
            readOnly={isReadOnly}
            rows={2}
          />
        </label>
        <label className="po-remarks-field">
          <span className="im-field__label">Pick and Pack Remarks</span>
          <textarea
            name="pick_remarks"
            value={header.pick_remarks}
            onChange={handleHeaderChange}
            readOnly={isReadOnly}
            rows={2}
          />
        </label>
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
