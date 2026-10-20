import SapDateInput from '../../components/common/SapDateInput';
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../modules/item-master/styles/itemMaster.css";
import "./receiptFromProduction.css";
import ReceiptAllocationModal from "./components/ReceiptAllocationModal";
import ReceiptList from "./components/ReceiptList";
import ReceiptLines from "./components/ReceiptLines";
import ProductionOrderSearchModal from "./components/ProductionOrderSearchModal";
import BackflushPreview from "./components/BackflushPreview";
import { toQty, getPostingLines, toPayloadLine } from "./receiptHelpers";
import ItemSearchModal from "../bom/components/ItemSearchModal";
import {
  fetchReceiptReferenceData,
  fetchReceiptSeries,
  fetchProductionOrderForReceipt,
  fetchReceiptByDocEntry,
  createReceipt,
  cancelReceipt,
  navigateReceipt,
} from "../../api/receiptFromProductionApi";
import { fetchBOMItems, getItemDetails } from "../../api/bomApi";
import { getSapVisibleDocumentSeries } from "../../utils/seriesDefaults";

const MODES = { ADD: "add", VIEW: "view", LIST: "list" };
const TABS = ["Contents", "Attachments", "Electronic Documents"];

const today = () => new Date().toISOString().slice(0, 10);
const EPSILON = 0.000001;

const EMPTY_HEADER = {
  doc_entry: null,
  cancelled: false,
  trans_id: null,
  doc_num: "",
  series: "",
  posting_date: today(),
  document_date: today(),
  ref_2: "",
  branch: "",
  qr_code_from: "",
  remarks: "",
  journal_remark: "Receipt from Production",
};

const pickDefaultSeries = (seriesRows = []) =>
  seriesRows.find((entry) => entry.IsCurrentPeriod) ||
  seriesRows.find((entry) => entry.IsDefault) ||
  seriesRows[0] ||
  null;

const pickDefaultBranch = (branchRows = []) => branchRows[0] || null;

const EMPTY_LINE = (overrides = {}) => ({
  _id: Date.now() + Math.random(),
  order_no: "",
  series_no: "",
  item_code: "",
  item_name: "",
  trans_type: "Complete",
  quantity: 0,
  unit_price: 0,
  value: 0,
  item_cost: 0,
  planned: 0,
  completed: 0,
  inventory_uom: "",
  uom_code: "",
  uom_name: "",
  items_per_unit: 1,
  warehouse: "",
  location: "",
  branch: "",
  uom_group: "",
  by_product: false,
  distribution_rule: "",
  project: "",
  base_entry: null,
  base_line: null,
  base_type: 202,
  manage_batch: false,
  manage_serial: false,
  issue_primarily_by: "",
  enable_bin_locations: false,
  batch_numbers: [],
  serial_numbers: [],
  bin_allocations: [],
  ...overrides,
});

const isYes = (value) => value === true || value === "tYES" || value === "Y";

const getWarehouseMeta = (warehouses, code) =>
  warehouses.find((warehouse) => warehouse.WarehouseCode === code) || null;

const applyWarehouseSettings = (line, warehouses, warehouseCode) => {
  const warehouse = getWarehouseMeta(warehouses, warehouseCode);
  const enableBins = isYes(warehouse?.EnableBinLocations);

  return {
    ...line,
    warehouse: warehouseCode,
    enable_bin_locations: enableBins,
    bin_allocations: enableBins ? line.bin_allocations || [] : [],
  };
};

const normalizeItemManagement = (details = {}) => ({
  manage_batch: isYes(details.ManageBatchNumbers),
  manage_serial: isYes(details.ManageSerialNumbers),
  issue_primarily_by: details.IssuePrimarilyBy || "",
});

const getPrimaryLine = (rows) =>
  rows.find((line) => line.item_code?.trim() && !line.by_product) ||
  rows.find((line) => line.item_code?.trim()) ||
  null;

const getBatchTotal = (line) =>
  (line.batch_numbers || []).reduce((sum, row) => sum + toQty(row.quantity), 0);

const getBinTotal = (line) =>
  (line.bin_allocations || []).reduce((sum, row) => sum + toQty(row.quantity), 0);

const getAllocationError = (line) => {
  const qty = toQty(line.quantity);
  if (!qty || qty <= 0) return null;

  if (line.manage_batch) {
    const validBatches = (line.batch_numbers || []).filter(
      (row) => row.batch_number && toQty(row.quantity) > 0
    );
    if (validBatches.length === 0) {
      return `Line ${line.item_code}: batch numbers are required.`;
    }
    if (Math.abs(getBatchTotal({ batch_numbers: validBatches }) - qty) > EPSILON) {
      return `Line ${line.item_code}: batch quantity must equal ${qty}.`;
    }
  }

  if (line.manage_serial) {
    if (!Number.isInteger(qty)) {
      return `Line ${line.item_code}: serial-managed quantity must be a whole number.`;
    }
    const validSerials = (line.serial_numbers || []).filter((row) => row.serial_number);
    if (validSerials.length === 0) {
      return `Line ${line.item_code}: serial numbers are required.`;
    }
    if (validSerials.length !== Math.floor(qty)) {
      return `Line ${line.item_code}: serial count must equal ${Math.floor(qty)}.`;
    }
  }

  if (line.enable_bin_locations) {
    const validBins = (line.bin_allocations || []).filter(
      (row) => row.bin_abs != null && row.bin_abs !== "" && toQty(row.quantity) > 0
    );
    if (validBins.length === 0) {
      return `Line ${line.item_code}: bin allocations are required.`;
    }
    if (Math.abs(getBinTotal({ bin_allocations: validBins }) - qty) > EPSILON) {
      return `Line ${line.item_code}: bin quantity must equal ${qty}.`;
    }
  }

  return null;
};

export default function ReceiptFromProductionModule() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState(MODES.ADD);
  const [tab, setTab] = useState(0);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState([EMPTY_LINE()]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [poInfo, setPoInfo] = useState(null);
  const [backflushLines, setBackflushLines] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [distRules, setDistRules] = useState([]);
  const [projects, setProjects] = useState([]);
  const [branches, setBranches] = useState([]);
  const [series, setSeries] = useState([]);
  const [poModal, setPoModal] = useState(null);
  const [itemModal, setItemModal] = useState({ open: false, target: null });
  const [allocationModal, setAllocationModal] = useState({ open: false, lineId: null });
  const branchWarehouses = useMemo(() => {
    if (mode !== MODES.ADD || !header.branch) return warehouses;
    return warehouses.filter((warehouse) => warehouse.BPLID == null || String(warehouse.BPLID) === String(header.branch));
  }, [header.branch, mode, warehouses]);

  const alertTimer = useRef(null);

  useEffect(() => {
    fetchReceiptReferenceData()
      .then((data) => {
        setWarehouses(data.warehouses || []);
        setDistRules(data.distribution_rules || []);
        setProjects(data.projects || []);
        const nextBranches = data.branches || [];
        setBranches(nextBranches);
        const nextSeries = data.series || [];
        setSeries(nextSeries);
        const defaultSeries = pickDefaultSeries(nextSeries);
        const defaultBranch = pickDefaultBranch(nextBranches);
        setHeader((prev) => ({
          ...prev,
          series: prev.series || (defaultSeries?.Series != null ? String(defaultSeries.Series) : ""),
          branch: prev.branch || (defaultBranch?.BPLID != null ? String(defaultBranch.BPLID) : ""),
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (mode !== MODES.ADD || !header.posting_date) return undefined;
    let active = true;
    fetchReceiptSeries(header.posting_date, header.branch)
      .then((context) => {
        if (!active) return;
        const nextSeries = context.series || [];
        const preferred = context.defaultSeries != null ? String(context.defaultSeries) : "";
        setSeries(nextSeries);
        setHeader((prev) => {
          const valid = nextSeries.some((entry) => String(entry.Series) === String(prev.series));
          const fallback = preferred || (pickDefaultSeries(nextSeries)?.Series ?? "");
          return { ...prev, series: valid ? prev.series : String(fallback) };
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [header.branch, header.posting_date, mode]);

  const showAlert = useCallback((type, msg) => {
    clearTimeout(alertTimer.current);
    setAlert({ type, msg });
    alertTimer.current = setTimeout(() => setAlert(null), 7000);
  }, []);

  const resetForm = useCallback(() => {
    const defaultSeries = pickDefaultSeries(series);
    setHeader({
      ...EMPTY_HEADER,
      series: defaultSeries?.Series != null ? String(defaultSeries.Series) : "",
      branch: pickDefaultBranch(branches)?.BPLID != null ? String(pickDefaultBranch(branches).BPLID) : "",
      posting_date: today(),
      document_date: today(),
    });
    setLines([EMPTY_LINE()]);
    setBackflushLines([]);
    setPoInfo(null);
    setTab(0);
    setAlert(null);
    setPoModal(null);
    setItemModal({ open: false, target: null });
    setAllocationModal({ open: false, lineId: null });
  }, [branches, series]);

  const handleHeaderChange = useCallback((e) => {
    const { name, value } = e.target;
    setHeader((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleLineChange = useCallback((id, field, value) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line._id !== id) return line;
        if (field === "warehouse") {
          return applyWarehouseSettings(
            {
              ...line,
              warehouse: value,
            },
            warehouses,
            value
          );
        }
        return { ...line, [field]: value };
      })
    );
  }, [warehouses]);

  const addLine = useCallback(() => {
    const seeded = poInfo
      ? {
          order_no: String(poInfo.doc_num || ""),
          warehouse: poInfo.warehouse || "",
          base_entry: poInfo.doc_entry,
          base_line: null,
          base_type: 202,
          by_product: true,
        }
      : {};

    setLines((prev) => [
      ...prev,
      applyWarehouseSettings(EMPTY_LINE(seeded), warehouses, seeded.warehouse || ""),
    ]);
  }, [poInfo, warehouses]);

  const deleteLine = useCallback((id) => {
    setLines((prev) => prev.filter((line) => line._id !== id));
  }, []);

  const loadProductionOrder = async (docEntry) => {
    setLoading(true);
    try {
      const data = await fetchProductionOrderForReceipt(docEntry);
      const receiptLines = Array.isArray(data.receipt_lines) ? data.receipt_lines : [];

      setPoInfo({
        doc_entry: data.doc_entry,
        doc_num: data.doc_num,
        item_code: data.item_code,
        item_name: data.item_name,
        planned_qty: data.planned_qty,
        completed_qty: data.completed_qty,
        remaining_qty: data.remaining_qty,
        status: data.status,
        type: data.type || "",
        series: data.series || "",
        series_name: data.series_name || "",
        warehouse: data.warehouse,
        due_date: data.due_date,
        manual_lines_count: data.manual_lines_count || 0,
        by_products: receiptLines.filter((line) => line.by_product),
      });

      const isReturnComponents = data.type === "bopotDisassemble";

      if (isReturnComponents && receiptLines.length > 0) {
        setLines(
          receiptLines.map((line) =>
            applyWarehouseSettings(
              EMPTY_LINE({
                ...line,
                quantity: toQty(line.quantity),
                planned: line.planned ?? 0,
                completed: line.completed ?? 0,
                warehouse: line.warehouse || data.warehouse || "",
                order_no: line.order_no || String(data.doc_num || ""),
                series_no: line.series_no || data.series_name || "",
                enable_bin_locations: isYes(line.enable_bin_locations),
              }),
              warehouses,
              line.warehouse || data.warehouse || ""
            )
          )
        );
        setBackflushLines([]);
        showAlert("success", `Return Components loaded from Disassembly Order #${data.doc_num}.`);
        setTab(0);
        return;
      }

      const primaryLine = applyWarehouseSettings(
        EMPTY_LINE({
          item_code: data.item_code || "",
          item_name: data.item_name || "",
          quantity: data.remaining_qty > 0 ? data.remaining_qty : 0,
          planned: data.planned_qty ?? 0,
          completed: data.completed_qty ?? 0,
          warehouse: data.warehouse || "",
          inventory_uom: data.inventory_uom || "",
          uom_code: data.uom_code || "",
          uom_name: data.uom_name || "",
          base_entry: data.doc_entry,
          base_line: 0,
          base_type: 202,
          order_no: String(data.doc_num || ""),
          series_no: data.series_name || "",
          by_product: false,
          manage_batch: isYes(data.manage_batch),
          manage_serial: isYes(data.manage_serial),
          issue_primarily_by: data.issue_primarily_by || "",
          enable_bin_locations: isYes(data.enable_bin_locations),
        }),
        warehouses,
        data.warehouse || ""
      );

      // By-products (planned < 0 on the order): the user enters what was produced; 0 rows are not posted.
      const byProductLines = receiptLines
        .filter((line) => line.by_product)
        .map((line) =>
          applyWarehouseSettings(
            EMPTY_LINE({
              ...line,
              quantity: 0,
              by_product: true,
              base_entry: data.doc_entry,
              order_no: line.order_no || String(data.doc_num || ""),
              series_no: line.series_no || data.series_name || "",
              manage_batch: isYes(line.manage_batch),
              manage_serial: isYes(line.manage_serial),
              enable_bin_locations: isYes(line.enable_bin_locations),
            }),
            warehouses,
            line.warehouse || data.warehouse || ""
          )
        );

      setLines([
        {
          ...primaryLine,
          enable_bin_locations: isYes(data.enable_bin_locations) || primaryLine.enable_bin_locations,
        },
        ...byProductLines,
      ]);

      setBackflushLines(data.backflush_lines || []);

      const messages = [`Production Order #${data.doc_num} loaded.`];
      if (data.backflush_lines?.length > 0) {
        messages.push(`${data.backflush_lines.length} backflush component(s) will auto-issue on receipt.`);
      }
      if (byProductLines.length > 0) {
        messages.push(`${byProductLines.length} by-product row(s) added; enter the produced quantity.`);
      }
      if (data.manual_lines_count > 0) {
        messages.push(`${data.manual_lines_count} manual component(s) must be issued separately via Issue for Production.`);
      }
      showAlert("success", messages.join(" "));
      setTab(0);
    } catch (err) {
      showAlert("error", err.response?.data?.detail || err.message || "Failed to load production order.");
    } finally {
      setLoading(false);
    }
  };

  const handleItemSelect = useCallback(async (item) => {
    const { target } = itemModal;
    setItemModal({ open: false, target: null });
    if (!target) return;

    let details = null;
    try {
      details = await getItemDetails(item.ItemCode);
    } catch (err) {
      details = null;
    }

    setLines((prev) =>
      prev.map((line) => {
        if (line._id !== target) return line;

        const itemManagement = normalizeItemManagement(details || {});
        const nextWarehouse =
          details?.DefaultWarehouse || line.warehouse || poInfo?.warehouse || "";
        const orderRow = line.by_product
          ? (poInfo?.by_products || []).find((row) => row.item_code === item.ItemCode)
          : null;

        return applyWarehouseSettings(
          {
            ...line,
            item_code: item.ItemCode,
            item_name: item.ItemName,
            inventory_uom: details?.InventoryUOM || item.InventoryUOM || "",
            uom_code: details?.InventoryUOM || item.InventoryUOM || "",
            uom_name: details?.InventoryUOM || item.InventoryUOM || "",
            warehouse: nextWarehouse,
            manage_batch: itemManagement.manage_batch,
            manage_serial: itemManagement.manage_serial,
            issue_primarily_by: itemManagement.issue_primarily_by,
            batch_numbers: [],
            serial_numbers: [],
            bin_allocations: [],
            ...(orderRow && { base_line: orderRow.base_line }),
          },
          warehouses,
          nextWarehouse
        );
      })
    );
  }, [itemModal, poInfo, warehouses]);

  const handlePoSelect = (po) => {
    setPoModal(null);
    loadProductionOrder(po.DocEntry);
  };

  const handleAllocationSave = useCallback((lineId, allocations) => {
    setLines((prev) =>
      prev.map((line) =>
        line._id === lineId
          ? {
              ...line,
              batch_numbers: allocations.batch_numbers || [],
              serial_numbers: allocations.serial_numbers || [],
              bin_allocations: allocations.bin_allocations || [],
            }
          : line
      )
    );
    setAllocationModal({ open: false, lineId: null });
  }, []);

  const validate = () => {
    if (!poInfo?.doc_entry) {
      showAlert("error", "Select a Production Order first.");
      return false;
    }
    if (!header.posting_date) {
      showAlert("error", "Posting date is required.");
      return false;
    }

    const validLines = getPostingLines(lines);
    if (validLines.length === 0) {
      showAlert("error", "At least one receipt line with an item is required.");
      return false;
    }

    const isReturnComponents = poInfo?.type === "bopotDisassemble";
    const mainLines = validLines.filter((line) => !line.by_product);
    if (!isReturnComponents && mainLines.length === 0) {
      showAlert("error", "One main finished goods line is required.");
      return false;
    }
    if (!isReturnComponents && mainLines.length > 1) {
      showAlert("error", "Only one main finished goods line is allowed. Mark the others as by-products.");
      return false;
    }

    const primaryLine = mainLines[0] || validLines[0];
    if (!isReturnComponents && toQty(primaryLine.quantity) > toQty(poInfo.remaining_qty) + EPSILON) {
      showAlert(
        "error",
        `Receipt quantity (${toQty(primaryLine.quantity).toFixed(2)}) exceeds remaining quantity (${toQty(poInfo.remaining_qty).toFixed(2)}).`
      );
      return false;
    }

    for (const line of validLines) {
      const qty = toQty(line.quantity);
      if (!qty || qty <= 0) {
        showAlert("error", `Line ${line.item_code}: Quantity must be greater than 0.`);
        return false;
      }
      if (!line.warehouse) {
        showAlert("error", `Line ${line.item_code}: Warehouse is required.`);
        return false;
      }

      const allocationError = getAllocationError(line);
      if (allocationError) {
        showAlert("error", allocationError);
        return false;
      }
    }

    return true;
  };

  const handlePost = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const postingLines = getPostingLines(lines);
      const primaryLine = getPrimaryLine(postingLines);
      const isReturnComponents = poInfo?.type === "bopotDisassemble";
      const payload = {
        prod_order_entry: poInfo.doc_entry,
        return_components: isReturnComponents,
        item_code: primaryLine?.item_code || "",
        receipt_qty: toQty(primaryLine?.quantity),
        remaining_qty: toQty(poInfo?.remaining_qty),
        warehouse: primaryLine?.warehouse || "",
        uom: primaryLine?.uom_code || "",
        distribution_rule: primaryLine?.distribution_rule || "",
        project: primaryLine?.project || "",
        posting_date: header.posting_date,
        document_date: header.document_date || header.posting_date,
        series: header.series,
        ref_2: header.ref_2,
        branch: header.branch,
        remarks: header.remarks,
        journal_remark: header.journal_remark || "Receipt from Production",
        lines: postingLines.map((line) => toPayloadLine(line, poInfo.doc_entry)),
      };

      const result = await createReceipt(payload);
      const totalPostedQty = postingLines.reduce((sum, line) => sum + toQty(line.quantity), 0);

      showAlert(
        "success",
        `Receipt #${result.doc_num} added. Total quantity: ${totalPostedQty.toFixed(2)}.` +
          (backflushLines.length > 0 ? ` ${backflushLines.length} backflush component(s) issued by the system.` : "")
      );
      resetForm();
    } catch (err) {
      showAlert("error", err.response?.data?.detail || err.message || "Add failed.");
    } finally {
      setLoading(false);
    }
  };

  const applyReceipt = (receipt) => {
      setHeader({
        doc_entry: receipt.doc_entry ?? null,
        cancelled: Boolean(receipt.cancelled),
        trans_id: receipt.trans_id ?? null,
        doc_num: receipt.doc_num || "",
        series: receipt.series || "",
        posting_date: receipt.posting_date || today(),
        document_date: receipt.document_date || today(),
        ref_2: receipt.ref_2 || "",
        branch: receipt.branch || "",
        qr_code_from: receipt.qr_code_from || "",
        remarks: receipt.remarks || "",
        journal_remark: receipt.journal_remark || "",
      });

      setLines(
        (receipt.lines || []).map((line) => {
          const mapped = applyWarehouseSettings(
            EMPTY_LINE({
              order_no: line.order_no || "",
              series_no: line.series_no || "",
              item_code: line.item_code || "",
              item_name: line.item_name || "",
              trans_type: line.trans_type || "Complete",
              quantity: line.quantity ?? 0,
              unit_price: line.unit_price ?? 0,
              value: line.value ?? 0,
              item_cost: line.item_cost ?? 0,
              planned: line.planned ?? 0,
              completed: line.completed ?? 0,
              inventory_uom: line.inventory_uom || "",
              uom_code: line.uom_code || "",
              uom_name: line.uom_name || "",
              items_per_unit: line.items_per_unit ?? 1,
              warehouse: line.warehouse || "",
              location: line.location || "",
              branch: line.branch || "",
              uom_group: line.uom_group || "",
              by_product: line.by_product || false,
              distribution_rule: line.distribution_rule || "",
              project: line.project || "",
              base_entry: line.base_entry ?? null,
              base_line: line.base_line ?? null,
              base_type: line.base_type ?? 202,
              manage_batch: isYes(line.manage_batch),
              manage_serial: isYes(line.manage_serial),
              enable_bin_locations:
                isYes(line.enable_bin_locations) || isYes(getWarehouseMeta(warehouses, line.warehouse)?.EnableBinLocations),
              batch_numbers: line.batch_numbers || [],
              serial_numbers: line.serial_numbers || [],
              bin_allocations: line.bin_allocations || [],
            }),
            warehouses,
            line.warehouse || ""
          );

          return {
            ...mapped,
            enable_bin_locations:
              isYes(line.enable_bin_locations) ||
              mapped.enable_bin_locations ||
              (line.bin_allocations || []).length > 0,
          };
        })
      );

      setPoInfo(receipt.prod_order_entry ? { doc_entry: receipt.prod_order_entry } : null);
      setBackflushLines([]);
      setTab(0);
      setMode(MODES.VIEW);
  };

  const loadReceipt = async (docEntry, announce = true) => {
    setLoading(true);
    try {
      const data = await fetchReceiptByDocEntry(docEntry);
      applyReceipt(data.receipt);
      if (announce) showAlert("success", `Receipt #${data.receipt.doc_num} loaded.`);
    } catch (err) {
      showAlert("error", err.response?.data?.detail || "Load failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFromList = (docEntry) => loadReceipt(docEntry);

  const handleNavigate = async (direction) => {
    setLoading(true);
    try {
      const data = await navigateReceipt(direction, mode === MODES.VIEW ? header.doc_entry ?? "" : "");
      applyReceipt(data.receipt);
    } catch (err) {
      showAlert(err.response?.status === 404 ? "success" : "error", err.response?.data?.detail || "No more documents.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelDocument = async () => {
    if (!header.doc_entry || header.cancelled) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Cancel Receipt from Production #${header.doc_num}? SAP creates a cancellation document.`)) return;
    setLoading(true);
    try {
      const data = await cancelReceipt(header.doc_entry);
      if (data?.receipt) applyReceipt(data.receipt);
      else await loadReceipt(header.doc_entry, false);
      showAlert("success", data?.message || `Receipt #${header.doc_num} cancelled.`);
    } catch (err) {
      showAlert("error", err.response?.data?.detail || err.message || "Cancel failed.");
    } finally {
      setLoading(false);
    }
  };

  // Deep links (Production Order "Report Completion"): router state or query string.
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current) return;
    const params = new URLSearchParams(location.search || "");
    const prodOrderEntry = location.state?.prodOrderEntry ?? params.get("prodOrder");
    const receiptEntry = location.state?.docEntry ?? params.get("docEntry");
    if (prodOrderEntry == null && receiptEntry == null) return;
    deepLinkDone.current = true;
    if (receiptEntry != null) loadReceipt(receiptEntry);
    else loadProductionOrder(prodOrderEntry);
  }, [location]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalQty = lines.reduce((sum, line) => sum + toQty(line.quantity), 0);
  const primaryLine = getPrimaryLine(lines);
  const activeAllocationLine = lines.find((line) => line._id === allocationModal.lineId) || null;

  if (mode === MODES.LIST) {
    return (
      <ReceiptList
        onSelect={handleSelectFromList}
        onNew={() => {
          resetForm();
          setMode(MODES.ADD);
        }}
      />
    );
  }

  const isView = mode === MODES.VIEW;

  return (
    <div className="im-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">Receipt from Production</span>
        <span className={`im-mode-badge im-mode-badge--${isView ? "update" : "add"}`}>
          {isView ? "View Mode" : "Add Mode"}
        </span>
        {isView && header.cancelled && <span className="im-mode-badge rfp-cancelled-badge">Cancelled</span>}

        {!isView && (
          <button className="im-btn im-btn--primary" onClick={handlePost} disabled={loading || !poInfo}>
            {loading ? "..." : "Add"}
          </button>
        )}
        <button className="im-btn" onClick={() => { resetForm(); setMode(MODES.ADD); }}>New</button>
        <button className="im-btn" data-sap-find-action onClick={() => setMode(MODES.LIST)}>Find</button>
        {!isView && <button className="im-btn" onClick={resetForm}>Clear</button>}
        {isView && header.trans_id && (
          <button
            className="im-btn"
            onClick={() => navigate("/journal-entry", { state: { journalEntryTransId: header.trans_id } })}
          >
            Journal Entry
          </button>
        )}
        {isView && header.doc_entry && !header.cancelled && (
          <button className="im-btn" onClick={handleCancelDocument} disabled={loading}>Cancel Document</button>
        )}
        <span className="rfp-browse" role="group" aria-label="Browse documents">
          <button className="im-btn" onClick={() => handleNavigate("first")} disabled={loading}>First</button>
          <button className="im-btn" onClick={() => handleNavigate("prev")} disabled={loading}>Previous</button>
          <button className="im-btn" onClick={() => handleNavigate("next")} disabled={loading}>Next</button>
          <button className="im-btn" onClick={() => handleNavigate("last")} disabled={loading}>Last</button>
        </span>
      </div>

      {alert && <div className={`im-alert im-alert--${alert.type}`}>{alert.msg}</div>}

      <div className="im-header-card rfp-header-card">
        <div className="rfp-header-layout">
          <div className="rfp-header-left">
            <div className="im-field">
              <label className="im-field__label rfp-lbl">Number</label>
              <input
                className="im-field__input rfp-readonly"
                value={header.doc_num || (mode === MODES.ADD ? "(auto)" : "")}
                readOnly
                style={{ width: 100 }}
              />
            </div>

            <div className="im-field">
              <label className="im-field__label rfp-lbl">Series</label>
              <select
                className="im-field__select"
                name="series"
                value={header.series}
                onChange={handleHeaderChange}
                disabled={isView}
                style={{ width: 160 }}
              >
                <option value="">--</option>
                {getSapVisibleDocumentSeries(series, {
                  selectedSeries: header.series,
                  postingDate: header.posting_date || header.document_date,
                }).map((entry) => (
                  <option key={entry.Series} value={entry.Series}>
                    {entry.DisplayName || entry.SeriesName || entry.Name}
                  </option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label rfp-lbl">Branch</label>
              <select
                className="im-field__select"
                name="branch"
                value={header.branch}
                onChange={handleHeaderChange}
                disabled={isView}
                style={{ width: 200 }}
              >
                <option value="">--</option>
                {branches.map((branch) => (
                  <option key={branch.BPLID} value={branch.BPLID}>
                    {branch.BPLName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="rfp-header-right">
            <div className="im-field">
              <label className="im-field__label rfp-lbl-r">Posting Date</label>
              <SapDateInput
                className="im-field__input"
                name="posting_date"
                
                value={header.posting_date}
                onChange={handleHeaderChange}
                readOnly={isView}
                style={{ width: 150 }}
              />
            </div>

            <div className="im-field">
              <label className="im-field__label rfp-lbl-r">Document Date</label>
              <SapDateInput
                className="im-field__input"
                name="document_date"
                
                value={header.document_date}
                onChange={handleHeaderChange}
                readOnly={isView}
                style={{ width: 150 }}
              />
            </div>

            <div className="im-field">
              <label className="im-field__label rfp-lbl-r">Ref. 2</label>
              <input
                className="im-field__input"
                name="ref_2"
                value={header.ref_2}
                onChange={handleHeaderChange}
                readOnly={isView}
                style={{ width: 150 }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="im-tabs">
        {TABS.map((tabName, index) => (
          <button
            key={tabName}
            type="button"
            className={`im-tab${tab === index ? " im-tab--active" : ""}`}
            onClick={() => setTab(index)}
          >
            {tabName}
          </button>
        ))}
      </div>

      <div className="im-tab-panel rfp-tab-panel">
        {tab === 0 && (
          <ReceiptLines
            lines={lines}
            warehouses={branchWarehouses}
            distRules={distRules}
            projects={projects}
            branches={branches}
            readOnly={isView}
            onChange={handleLineChange}
            onAdd={addLine}
            onDelete={deleteLine}
            onItemSearch={(lineId) => setItemModal({ open: true, target: lineId })}
            onAllocate={(lineId) => setAllocationModal({ open: true, lineId })}
          />
        )}
        {tab === 0 && !isView && (
          <BackflushPreview
            lines={backflushLines}
            receiptQty={primaryLine && !primaryLine.by_product ? toQty(primaryLine.quantity) : 0}
            plannedQty={toQty(poInfo?.planned_qty)}
          />
        )}

        {tab === 1 && (
          <div className="rfp-attachment-panel">
            <div className="rfp-grid-scroll">
              <table className="rfp-grid rfp-attachment-grid">
                <thead>
                  <tr>
                    <th className="rfp-th" style={{ width: 40 }}>#</th>
                    <th className="rfp-th" style={{ width: 330 }}>Target Path</th>
                    <th className="rfp-th" style={{ width: 270 }}>File Name</th>
                    <th className="rfp-th" style={{ width: 190 }}>Attachment Date</th>
                    <th className="rfp-th" style={{ width: 160 }}>Free Text</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 14 }).map((_, index) => (
                    <tr key={index} className="rfp-grid__row rfp-grid__row--empty">
                      <td className="rfp-grid__cell rfp-grid__cell--num">{index === 0 ? 1 : ""}</td>
                      <td className="rfp-grid__cell" />
                      <td className="rfp-grid__cell" />
                      <td className="rfp-grid__cell" />
                      <td className="rfp-grid__cell" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rfp-attachment-actions">
              <button className="im-btn" disabled>Browse</button>
              <button className="im-btn" disabled>Display</button>
              <button className="im-btn" disabled>Delete</button>
            </div>
          </div>
        )}

        {tab === 2 && (
          <div className="rfp-edoc-panel">
            <div className="rfp-edoc-row rfp-edoc-title">Generic eDoc Protocol</div>
            <div className="rfp-edoc-row"><span>eDoc Generation Type</span><input readOnly value="Not Relevant" /></div>
            <div className="rfp-edoc-row"><span>eDoc Format</span><input readOnly value="" /></div>
            <div className="rfp-edoc-row"><span>Documents Mapping Determination</span><input readOnly value="Double-click to open" /></div>
            <div className="rfp-edoc-row"><span>Document Status</span><input readOnly value="" /></div>
          </div>
        )}
      </div>

      {poModal && (
        <ProductionOrderSearchModal
          title={poModal.title}
          type={poModal.type}
          onSelect={handlePoSelect}
          onClose={() => setPoModal(null)}
        />
      )}

      {itemModal.open && (
        <ItemSearchModal
          onSelect={handleItemSelect}
          onClose={() => setItemModal({ open: false, target: null })}
          fetchItems={fetchBOMItems}
          title="Item Search"
        />
      )}

      {allocationModal.open && activeAllocationLine && (
        <ReceiptAllocationModal
          line={activeAllocationLine}
          readOnly={isView}
          createBatches
          postingDate={header.posting_date}
          onSave={(allocations) => handleAllocationSave(activeAllocationLine._id, allocations)}
          onClose={() => setAllocationModal({ open: false, lineId: null })}
        />
      )}

      <div className="rfp-form-footer">
        <div className="rfp-footer-left">
          <div className="im-field rfp-footer-field">
            <label className="im-field__label">Remarks</label>
            <textarea
              name="remarks"
              value={header.remarks}
              onChange={handleHeaderChange}
              readOnly={isView}
              rows={2}
              className="rfp-footer-textarea"
            />
          </div>
          <div className="im-field rfp-footer-field">
            <label className="im-field__label">Journal Remark</label>
            <input
              className="im-field__input"
              name="journal_remark"
              value={header.journal_remark}
              onChange={handleHeaderChange}
              readOnly={isView}
              style={{ width: 170 }}
            />
          </div>
        </div>

        <div className="rfp-footer-right">
          <div className="im-field rfp-footer-field">
            <label className="im-field__label">Create QR Code From</label>
            <input
              className="im-field__input rfp-qr-input"
              name="qr_code_from"
              value={header.qr_code_from}
              onChange={handleHeaderChange}
              readOnly={isView}
            />
          </div>
        </div>
      </div>

      <div className="rfp-bottom-bar">
        <div className="rfp-bottom-bar__totals">
          <span>
            Total Qty: <span className="rfp-bottom-bar__total-val">{totalQty.toFixed(2)}</span>
          </span>
          {primaryLine && (
            <span>
              FG Qty: <span className="rfp-bottom-bar__total-val">{toQty(primaryLine.quantity).toFixed(2)}</span>
            </span>
          )}
        </div>
        <div className="rfp-footer-actions">
          <button
            type="button"
            className="im-btn"
            onClick={() => setPoModal({ type: "production", title: "List of Production Orders" })}
            disabled={isView || loading}
          >
            Production Order
          </button>
          <button
            type="button"
            className="im-btn"
            onClick={() => setPoModal({ type: "disassembly", title: "List of Disassembly Orders" })}
            disabled={isView || loading}
          >
            Return Components
          </button>
        </div>
      </div>
    </div>
  );
}
