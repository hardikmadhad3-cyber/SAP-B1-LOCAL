import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../../modules/item-master/styles/itemMaster.css";
import "./bom.css";
import BOMLines, { STAGE_TYPE } from "./components/BOMLines";
import ItemSearchModal from "./components/ItemSearchModal";
import DocumentAttachmentsTab from "../../components/document/DocumentAttachmentsTab";
import {
  getBOM,
  createBOM,
  updateBOM,
  deleteBOM,
  navigateBOM,
  fetchBOMItems,
  fetchBOMResources,
  fetchBOMWarehouses,
  fetchBOMPriceLists,
  fetchBOMDistributionRules,
  fetchBOMProjects,
  fetchBOMAttachments,
  uploadBOMAttachment,
  deleteBOMAttachment,
  downloadBOMAttachment,
  getItemDetails,
} from "../../api/bomApi";
import { fetchProdOrderRouteStages } from "../../api/productionOrderApi";

const MODES = { ADD: "add", FIND: "find", UPDATE: "update" };
const TABS = ["Contents", "Attachments"];


const BOM_TYPES = [
  { value: "iProductionTree", label: "Production" },
  { value: "iSalesTree", label: "Sales" },
  { value: "iTemplateTree", label: "Template" },
  { value: "iAssemblyTree", label: "Assembly" },
];

const EMPTY_HEADER = {
  TreeCode: "",
  ProductDescription: "",
  TreeType: "iProductionTree",
  Quantity: 1,
  ProductionStdCost: 0,
  ProductPrice: 0,
  Currency: "",
  PlanAvgProdSize: 1,
  HideBOMComponentsInPrintout: "tNO",
  Warehouse: "",
  PriceList: "",
  DistributionRule: "",
  Project: "",
};

const getDefaultWarehouseCode = (warehouses = []) => warehouses[0]?.WarehouseCode || "";

const getDefaultPriceListNo = (priceLists = []) => {
  const value = priceLists[0]?.PriceListNo ?? "";
  return value === "" || value == null ? "" : String(value);
};

const getHeaderDefaults = (warehouses = [], priceLists = []) => ({
  ...EMPTY_HEADER,
  Warehouse: getDefaultWarehouseCode(warehouses),
  PriceList: getDefaultPriceListNo(priceLists),
});

export const EMPTY_LINE = () => ({
  _id: Date.now() + Math.random(),
  ItemType: "pit_Item",
  ItemCode: "",
  ItemName: "",
  Quantity: 1,
  AdditionalQuantity: 0,
  InventoryUOM: "",
  Warehouse: "",
  IssueMethod: "im_Manual",
  ProductionStdCost: 0,
  PriceList: "",
  Price: 0,
  Comment: "",
  DistributionRule: "",
  WipAccount: "",
  Project: "",
  StageID: null,
  StageEntry: "",
});

const isComponentFilled = (line) =>
  line.ItemType === "pit_Text"
    ? Boolean(String(line.Comment || "").trim())
    : Boolean(String(line.ItemCode || "").trim());

// Stage rows -> ProductTreeStages (StageID 1..n in grid order, StageEntry =
// route stage InternalNumber); each following component row gets its stage's
// StageID. Rows above the first stage have no stage.
export function splitStageRows(rows = []) {
  const stages = [];
  const components = [];
  let current = null;
  for (const row of rows) {
    if (row.ItemType === STAGE_TYPE) {
      if (row.StageEntry === "" || row.StageEntry == null) continue;
      current = stages.length + 1;
      stages.push({ StageID: current, StageEntry: Number(row.StageEntry), Name: row.ItemName || "" });
    } else {
      components.push({ ...row, StageID: current });
    }
  }
  return { stages, components };
}

// ProductTreeStages + lines' StageID -> grid rows with a stage row heading
// each stage's components. Lines with no (known) stage stay at the top.
export function buildRowsWithStages(stages = [], lines = [], makeRow = EMPTY_LINE) {
  const ordered = [...stages].sort(
    (a, b) => Number(a.SequenceNumber ?? a.StageID) - Number(b.SequenceNumber ?? b.StageID)
  );
  const stageIds = new Set(ordered.map((stage) => Number(stage.StageID)));
  const rows = lines.filter((line) => !stageIds.has(Number(line.StageID)));
  for (const stage of ordered) {
    rows.push({
      ...makeRow(),
      ItemType: STAGE_TYPE,
      StageEntry: stage.StageEntry,
      ItemCode: stage.StageCode || "",
      ItemName: stage.Name || "",
    });
    rows.push(...lines.filter((line) => Number(line.StageID) === Number(stage.StageID)));
  }
  return rows;
}

const mapLoadedLine = (line) => ({
  ...EMPTY_LINE(),
  ItemType: line.ItemType || "pit_Item",
  ItemCode: line.ItemCode || "",
  ItemName: line.ItemName || line.ItemDescription || "",
  Quantity: line.Quantity ?? 1,
  AdditionalQuantity: line.AdditionalQuantity ?? 0,
  InventoryUOM: line.UoMName || line.InventoryUOM || line.UomCode || "",
  Warehouse: line.Warehouse || "",
  IssueMethod: line.IssueMethod || "im_Manual",
  ProductionStdCost: line.ProductionStdCost ?? 0,
  PriceList: line.PriceList != null ? String(line.PriceList) : "",
  Price: line.Price ?? 0,
  Comment: line.Comment || line.LineText || "",
  DistributionRule: line.DistributionRule || "",
  WipAccount: line.WipAccount || "",
  Project: line.Project || "",
  StageID: line.StageID ?? null,
});

const errorMessage = (err, fallback) => err?.response?.data?.message || err?.message || fallback;

// The row's unit price from the picked item's price for that price list.
export const priceFromDetails = (details, priceList) => {
  const price = (details?.Prices || []).find((entry) => String(entry.PriceList) === String(priceList));
  return price ? { Price: price.Price, Currency: price.Currency } : {};
};

export default function BOMModule() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState(MODES.ADD);
  const [tab, setTab] = useState(0);
  const [header, setHeader] = useState(EMPTY_HEADER);
  const [lines, setLines] = useState(() => [EMPTY_LINE()]);
  const [selectedLineId, setSelectedLineId] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);

  const [warehouses, setWarehouses] = useState([]);
  const [priceLists, setPriceLists] = useState([]);
  const [distRules, setDistRules] = useState([]);
  const [projects, setProjects] = useState([]);

  // kind: header | item | resource | stage; target: "header" or a line id.
  const [lookup, setLookup] = useState(null);

  const alertTimer = useRef(null);
  const fileInputRef = useRef(null);
  const isProductionBOM = header.TreeType === "iProductionTree";
  const isSalesBOM = header.TreeType === "iSalesTree";
  const savedTreeCode = mode === MODES.UPDATE ? String(header.TreeCode || "").trim() : "";

  useEffect(() => {
    fetchBOMWarehouses()
      .then((rows) => {
        setWarehouses(rows);
        setHeader((prev) => ({ ...prev, Warehouse: prev.Warehouse || getDefaultWarehouseCode(rows) }));
      })
      .catch(() => {});
    fetchBOMPriceLists()
      .then((rows) => {
        setPriceLists(rows);
        setHeader((prev) => ({ ...prev, PriceList: prev.PriceList || getDefaultPriceListNo(rows) }));
      })
      .catch(() => {});
    fetchBOMDistributionRules().then(setDistRules).catch(() => {});
    fetchBOMProjects().then(setProjects).catch(() => {});
  }, []);

  const showAlert = useCallback((type, msg) => {
    clearTimeout(alertTimer.current);
    setAlert({ type, msg });
    alertTimer.current = setTimeout(() => setAlert(null), 6000);
  }, []);

  // Show a BOM returned by the backend (prices and std costs are computed there).
  const applyBOM = useCallback((data) => {
    setHeader({
      ...EMPTY_HEADER,
      TreeCode: data.TreeCode || "",
      ProductDescription: data.ProductDescription || "",
      TreeType: data.TreeType || "iProductionTree",
      Quantity: data.Quantity ?? 1,
      ProductionStdCost: data.ProductionStdCost ?? 0,
      ProductPrice: data.ProductPrice ?? 0,
      Currency: data.Currency || "",
      PlanAvgProdSize: data.PlanAvgProdSize ?? 1,
      HideBOMComponentsInPrintout: data.HideBOMComponentsInPrintout || "tNO",
      Warehouse: data.TreeType === "iProductionTree" ? data.Warehouse || "" : "",
      PriceList: data.PriceList != null ? String(data.PriceList) : "",
      DistributionRule: data.DistributionRule || "",
      Project: data.Project || "",
    });
    const rows = buildRowsWithStages(data.ProductTreeStages || [], (data.ProductTreeLines || []).map(mapLoadedLine));
    const nextRows = rows.length ? rows : [EMPTY_LINE()];
    setLines(nextRows);
    setSelectedLineId(nextRows[0]._id);
    setMode(MODES.UPDATE);
    setAttachments([]);
    if (data.TreeCode) {
      fetchBOMAttachments(data.TreeCode).then(setAttachments).catch(() => setAttachments([]));
    }
  }, []);

  const loadExistingBOM = useCallback(
    async (treeCode, message) => {
      const data = await getBOM(treeCode);
      applyBOM(data);
      if (message) showAlert("info", message);
      return data;
    },
    [applyBOM, showAlert]
  );

  // New / Cancel / after Remove: Add mode with fresh defaults (or a duplicate seed).
  const startAddMode = useCallback((seed = null) => {
    const seedLines = seed?.lines?.length ? seed.lines : [EMPTY_LINE()];
    setMode(MODES.ADD);
    setHeader(seed?.header || getHeaderDefaults(warehouses, priceLists));
    setLines(seedLines);
    setSelectedLineId(seedLines[0]._id);
    setAttachments([]);
    setTab(0);
    setAlert(null);
  }, [priceLists, warehouses]);

  const handleHeaderChange = useCallback((e) => {
    const { name, value } = e.target;
    const nextValue = e.target.type === "checkbox" ? (e.target.checked ? "tYES" : "tNO") : value;
    setHeader((prev) => ({
      ...prev,
      [name]: nextValue,
      ...(name === "TreeType" && value === "iProductionTree" && !prev.Warehouse
        ? { Warehouse: getDefaultWarehouseCode(warehouses) }
        : {}),
      ...(name === "TreeType" && value !== "iProductionTree" ? { Warehouse: "" } : {}),
      ...(name === "TreeType" && value !== "iSalesTree" ? { HideBOMComponentsInPrintout: "tNO" } : {}),
    }));
  }, [warehouses]);

  const patchLine = useCallback((id, patch) => {
    setLines((prev) => prev.map((line) => (line._id === id ? { ...line, ...patch } : line)));
  }, []);

  const handleLookupSelect = useCallback(
    async (row) => {
      const current = lookup;
      setLookup(null);
      if (!current) return;
      const { kind, target } = current;

      if (kind === "resource") {
        patchLine(target, {
          ItemCode: row.Code,
          ItemName: row.Name || "",
          Warehouse: row.DefaultWarehouse || "",
          InventoryUOM: "",
        });
        return;
      }
      if (kind === "stage") {
        patchLine(target, { StageEntry: row.InternalNumber, ItemCode: row.Code || "", ItemName: row.Description || "" });
        return;
      }

      if (kind === "header" && mode === MODES.ADD) {
        try {
          await loadExistingBOM(row.ItemCode, `BOM "${row.ItemCode}" already exists, so it was opened in Update Mode.`);
          return;
        } catch {
          // No BOM exists yet, continue with create flow.
        }
      }

      let details = null;
      try {
        details = await getItemDetails(row.ItemCode);
      } catch {
        // Fall back to the lookup row.
      }
      const item = details || row;
      if (kind === "header") {
        setHeader((prev) => ({
          ...prev,
          TreeCode: item.ItemCode,
          ProductDescription: item.ItemName || "",
          Warehouse: details?.DefaultWarehouse || prev.Warehouse,
        }));
        return;
      }
      setLines((prev) =>
        prev.map((line) =>
          line._id === target
            ? {
                ...line,
                ItemCode: item.ItemCode,
                ItemName: item.ItemName || "",
                InventoryUOM: item.UoMName || item.InventoryUOM || "",
                Warehouse: details?.DefaultWarehouse || line.Warehouse,
                IssueMethod: details?.IssuePrimarilyBy || line.IssueMethod,
                DistributionRule: details?.DistributionRule || line.DistributionRule,
                Project: details?.Project || line.Project,
                // Shown right away; the backend recomputes both on save.
                ProductionStdCost: details?.ProductionStdCost ?? line.ProductionStdCost,
                ...priceFromDetails(details, line.PriceList || header.PriceList),
              }
            : line
        )
      );
    },
    [header.PriceList, loadExistingBOM, lookup, mode, patchLine]
  );

  const handleLineChange = useCallback((id, field, value) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line._id !== id) return line;
        // A new row type starts from a blank row (codes are not shared between types).
        if (field === "ItemType") return { ...EMPTY_LINE(), _id: line._id, ItemType: value };
        return { ...line, [field]: value };
      })
    );
  }, []);

  const addLine = useCallback(() => {
    const newLine = EMPTY_LINE();
    setLines((prev) => {
      const selectedIndex = prev.findIndex((line) => line._id === selectedLineId);
      if (selectedIndex === -1) return [...prev, newLine];
      const next = [...prev];
      next.splice(selectedIndex + 1, 0, newLine);
      return next;
    });
    setSelectedLineId(newLine._id);
  }, [selectedLineId]);

  const deleteLine = useCallback((id) => {
    setLines((prev) => {
      if (prev.length <= 1) {
        const replacement = EMPTY_LINE();
        setSelectedLineId(replacement._id);
        return [replacement];
      }
      const index = prev.findIndex((line) => line._id === id);
      if (index === -1) return prev;
      const next = prev.filter((line) => line._id !== id);
      setSelectedLineId(next[Math.min(index, next.length - 1)]?._id ?? null);
      return next;
    });
  }, []);

  const priced = lines.filter((line) => line.ItemType === "pit_Item" || line.ItemType === "pit_Resource");
  const totalStdCost = priced.reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.ProductionStdCost) || 0), 0);
  const totalPrice = priced.reduce((sum, l) => sum + (Number(l.Quantity) || 0) * (Number(l.Price) || 0), 0);

  // Returns { ok, warning }. Duplicate components are allowed in SAP B1, so they only warn.
  const validate = useCallback(() => {
    if (!String(header.TreeCode || "").trim()) return { ok: false, error: "Product No. is required." };
    if (Number(header.Quantity) <= 0) return { ok: false, error: "Quantity must be > 0." };
    if (lines.some((line) => line.ItemType === STAGE_TYPE && (line.StageEntry === "" || line.StageEntry == null))) {
      return { ok: false, error: "Select a route stage for every Route Stage row." };
    }
    const filled = lines.filter((line) => line.ItemType !== STAGE_TYPE && isComponentFilled(line));
    if (!filled.length) return { ok: false, error: "At least one component required." };
    const codes = filled.filter((line) => line.ItemType !== "pit_Text").map((line) => `${line.ItemType}:${line.ItemCode}`);
    const warning = new Set(codes).size !== codes.length ? "Note: the BOM contains duplicate components." : "";
    return { ok: true, warning };
  }, [header.Quantity, header.TreeCode, lines]);

  const buildPayload = useCallback(() => {
    const opt = (value) => value !== "" && value != null;
    const { stages, components } = splitStageRows(lines);
    return {
      TreeCode: header.TreeCode,
      TreeType: header.TreeType,
      Quantity: Number(header.Quantity),
      ...(header.TreeType === "iProductionTree" && opt(header.Warehouse) && { Warehouse: header.Warehouse }),
      ...(opt(header.PriceList) && { PriceList: Number(header.PriceList) }),
      ...(opt(header.PlanAvgProdSize) && { PlanAvgProdSize: Number(header.PlanAvgProdSize) }),
      ...(header.TreeType === "iSalesTree" && {
        HideBOMComponentsInPrintout: header.HideBOMComponentsInPrintout || "tNO",
      }),
      ...(opt(header.DistributionRule) && { DistributionRule: header.DistributionRule }),
      ...(opt(header.Project) && { Project: header.Project }),
      ProductTreeStages: stages,
      ProductTreeLines: components.filter(isComponentFilled).map((line) => {
        const isText = line.ItemType === "pit_Text";
        return {
          ItemType: line.ItemType || "pit_Item",
          ...(isText ? { LineText: line.Comment, Comment: line.Comment } : {
            ItemCode: line.ItemCode,
            Quantity: Number(line.Quantity) || 1,
            AdditionalQuantity: Number(line.AdditionalQuantity) || 0,
            IssueMethod: line.IssueMethod || "im_Manual",
            ...(opt(line.Warehouse) && { Warehouse: line.Warehouse }),
            ...(opt(line.PriceList) && { PriceList: Number(line.PriceList) }),
            ...(opt(line.Comment) && { Comment: line.Comment }),
            ...(opt(line.WipAccount) && { WipAccount: line.WipAccount }),
            ...(opt(line.DistributionRule) && { DistributionRule: line.DistributionRule }),
            ...(opt(line.Project) && { Project: line.Project }),
          }),
          ...(line.StageID && { StageID: line.StageID }),
        };
      }),
    };
  }, [header, lines]);

  const handleFind = useCallback(async () => {
    const code = String(header.TreeCode || "").trim();
    if (!code) {
      setLookup({ kind: "header", target: "header" });
      return;
    }
    setLoading(true);
    try {
      const data = await loadExistingBOM(code);
      showAlert("success", `BOM "${data.TreeCode}" loaded.`);
    } catch (err) {
      showAlert("error", errorMessage(err, "BOM search failed."));
    } finally {
      setLoading(false);
    }
  }, [header.TreeCode, loadExistingBOM, showAlert]);

  const handleSave = useCallback(async () => {
    if (mode === MODES.FIND) {
      await handleFind();
      return;
    }
    const check = validate();
    if (!check.ok) {
      showAlert("error", check.error);
      return;
    }

    setLoading(true);
    const code = header.TreeCode;
    try {
      const payload = buildPayload();
      const saved = mode === MODES.ADD ? await createBOM(payload) : await updateBOM(code, payload);
      applyBOM(saved?.TreeCode ? saved : await getBOM(code));
      showAlert("success", `BOM "${code}" ${mode === MODES.ADD ? "created" : "updated"}.${check.warning ? ` ${check.warning}` : ""}`);
    } catch (err) {
      const message = errorMessage(err, "Save failed.");
      if (mode === MODES.ADD && /already exists|ODBC -2035/i.test(message)) {
        try {
          await loadExistingBOM(code, `BOM "${code}" already exists, so it was opened in Update Mode.`);
          return;
        } catch {
          // Fall back to the original error.
        }
      }
      showAlert("error", message);
    } finally {
      setLoading(false);
    }
  }, [applyBOM, buildPayload, handleFind, header.TreeCode, loadExistingBOM, mode, showAlert, validate]);

  const handleRemove = useCallback(async () => {
    if (!savedTreeCode || !window.confirm(`Remove Bill of Materials "${savedTreeCode}"?`)) return;
    setLoading(true);
    try {
      await deleteBOM(savedTreeCode);
      startAddMode();
      showAlert("success", `BOM "${savedTreeCode}" removed.`);
    } catch (err) {
      showAlert("error", errorMessage(err, "Remove failed."));
    } finally {
      setLoading(false);
    }
  }, [savedTreeCode, showAlert, startAddMode]);

  // Duplicate: same header and rows in Add mode; choose a new Product No.
  const handleDuplicate = useCallback(() => {
    startAddMode({
      header: { ...header, TreeCode: "", ProductDescription: "", ProductionStdCost: 0, ProductPrice: 0 },
      lines: lines.map((line) => ({ ...line, _id: Date.now() + Math.random() })),
    });
  }, [header, lines, startAddMode]);

  const handleBrowse = useCallback(async (direction) => {
    setLoading(true);
    try {
      applyBOM(await navigateBOM(direction, savedTreeCode));
      setAlert(null);
    } catch (err) {
      if (err?.response?.status === 404) showAlert("info", "No more records.");
      else showAlert("error", errorMessage(err, "Could not load BOM."));
    } finally {
      setLoading(false);
    }
  }, [applyBOM, savedTreeCode, showAlert]);

  // Attachments (server-side per company and BOM; only once the BOM is saved).
  const refreshAttachments = useCallback(async () => {
    setAttachments(await fetchBOMAttachments(savedTreeCode));
  }, [savedTreeCode]);

  const handleAttachmentFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !savedTreeCode) return;
    try {
      for (const file of files) await uploadBOMAttachment(savedTreeCode, file);
      await refreshAttachments();
    } catch (err) {
      showAlert("error", errorMessage(err, "Upload failed."));
    }
  };

  const handleDisplayAttachment = async (row) => {
    try {
      const url = URL.createObjectURL(await downloadBOMAttachment(savedTreeCode, row.id));
      Object.assign(document.createElement("a"), { href: url, download: row.name || row.fileName }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      showAlert("error", errorMessage(err, "Download failed."));
    }
  };

  const handleDeleteAttachment = async (row) => {
    try {
      await deleteBOMAttachment(savedTreeCode, row.id);
      await refreshAttachments();
    } catch (err) {
      showAlert("error", errorMessage(err, "Delete failed."));
    }
  };

  useEffect(() => {
    const stateTreeCode = location.state?.bomTreeCode || location.state?.treeCode;
    const queryTreeCode = new URLSearchParams(location.search).get("treeCode");
    const treeCodeToLoad = String(stateTreeCode || queryTreeCode || "").trim();
    if (!treeCodeToLoad) return;

    let ignore = false;
    setLoading(true);
    loadExistingBOM(treeCodeToLoad)
      .then((data) => {
        if (ignore) return;
        showAlert("success", `BOM "${data.TreeCode || treeCodeToLoad}" loaded.`);
        if (stateTreeCode) {
          navigate(location.pathname, {
            replace: true,
            state: { ...(location.state || {}), bomTreeCode: undefined, treeCode: undefined },
          });
        }
      })
      .catch((err) => {
        if (!ignore) showAlert("error", errorMessage(err, `Could not load BOM "${treeCodeToLoad}".`));
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [loadExistingBOM, location.pathname, location.search, location.state, navigate, showAlert]);

  useEffect(() => {
    if (!lines.length) return;
    if (!selectedLineId || !lines.some((line) => line._id === selectedLineId)) {
      setSelectedLineId(lines[0]._id);
    }
  }, [lines, selectedLineId]);

  const openRowLookup = (lineId) => {
    const line = lines.find((l) => l._id === lineId);
    const kind = line?.ItemType === "pit_Resource" ? "resource" : line?.ItemType === STAGE_TYPE ? "stage" : "item";
    setLookup({ kind, target: lineId });
  };

  const money = (value) => `${Number(value || 0).toFixed(2)}${header.Currency ? ` ${header.Currency}` : ""}`;

  const lookupProps = {
    resource: {
      title: "List of Resources",
      fetchItems: fetchBOMResources,
      columns: [
        { key: "Code", label: "Resource Code" },
        { key: "Name", label: "Resource Name" },
        { key: "DefaultWarehouse", label: "Default Warehouse" },
      ],
      emptyMessage: "No resources found.",
    },
    stage: {
      title: "List of Route Stages",
      fetchItems: fetchProdOrderRouteStages,
      columns: [
        { key: "Code", label: "Code" },
        { key: "Description", label: "Description" },
      ],
      emptyMessage: "No route stages found.",
    },
    item: {
      title: "List of Items",
      fetchItems: (query) =>
        fetchBOMItems(query).then((items) => items.filter((item) => item.ItemCode !== header.TreeCode)),
      columns: [
        { key: "ItemCode", label: "Item Code" },
        { key: "ItemName", label: "Item Description" },
        { key: "QuantityOnStock", label: "In Stock", align: "right", render: (value) => Number(value || 0).toFixed(3) },
        { key: "ItemsGroupCode", label: "Item Group" },
        { key: "WTaxLiable", label: "WTax Liable", render: (value) => (value === "tNO" || value === "No" ? "No" : "Yes") },
      ],
    },
  };
  const activeLookup = lookup && lookupProps[lookup.kind === "header" ? "item" : lookup.kind];

  return (
    <div className="im-page bom-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">Bill of Materials</span>
        <span className={`im-mode-badge im-mode-badge--${mode}`}>
          {mode === MODES.ADD ? "Add Mode" : mode === MODES.FIND ? "Find Mode" : "Update Mode"}
        </span>
        <button type="button" className="im-btn im-btn--primary" onClick={handleSave} disabled={loading}>
          {loading ? "..." : mode === MODES.ADD ? "Add" : mode === MODES.FIND ? "Find" : "Update"}
        </button>
        <button type="button" className="im-btn" onClick={() => startAddMode()}>Cancel</button>
        <button type="button" className="im-btn" onClick={() => navigate("/bom/find")}>Find</button>
        <button type="button" className="im-btn" onClick={() => startAddMode()}>New</button>
        <button type="button" className="im-btn" onClick={handleDuplicate}>Duplicate</button>
        <button type="button" className="im-btn" onClick={handleRemove} disabled={!savedTreeCode || loading}>Remove</button>
        <button type="button" className="im-btn" onClick={() => handleBrowse("first")} disabled={loading}>First</button>
        <button type="button" className="im-btn" onClick={() => handleBrowse("prev")} disabled={loading}>Previous</button>
        <button type="button" className="im-btn" onClick={() => handleBrowse("next")} disabled={loading}>Next</button>
        <button type="button" className="im-btn" onClick={() => handleBrowse("last")} disabled={loading}>Last</button>
      </div>

      {alert && (
        <div className={`im-alert im-alert--${alert.type}`} role={alert.type === "error" ? "alert" : "status"}>
          {alert.msg}
        </div>
      )}

      <div className="im-header-card bom-header-card">
        <div className="bom-header-layout">
          <div className="bom-header-left">
            <div className="im-field">
              <label className="im-field__label bom-lbl" htmlFor="bom-tree-code">Product No.</label>
              <div className="im-lookup-wrap">
                <input
                  id="bom-tree-code"
                  className="im-field__input bom-code-input"
                  name="TreeCode"
                  value={header.TreeCode}
                  onChange={handleHeaderChange}
                  readOnly={mode === MODES.UPDATE}
                  autoFocus
                />
                {mode !== MODES.UPDATE && (
                  <button
                    type="button"
                    className="im-lookup-btn"
                    aria-label="Choose product"
                    onClick={() => setLookup({ kind: "header", target: "header" })}
                  >
                    ...
                  </button>
                )}
              </div>
              <label className="bom-field__hint" htmlFor="bom-quantity">X Quantity</label>
              <input
                id="bom-quantity"
                className="im-field__input bom-qty-input"
                name="Quantity"
                type="number"
                min="0.001"
                step="any"
                value={header.Quantity}
                onChange={handleHeaderChange}
              />
            </div>

            <div className="im-field">
              <label className="im-field__label bom-lbl" htmlFor="bom-description">Product Description</label>
              <input
                id="bom-description"
                className="im-field__input bom-readonly bom-field__input--grow"
                value={header.ProductDescription}
                readOnly
              />
            </div>

            <div className="im-field">
              <label className="im-field__label bom-lbl" htmlFor="bom-type">BOM Type</label>
              <select
                id="bom-type"
                className="im-field__select bom-field__select"
                name="TreeType"
                value={header.TreeType}
                onChange={handleHeaderChange}
              >
                {BOM_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label bom-lbl" htmlFor="bom-std-cost">Production Std Cost</label>
              <input
                id="bom-std-cost"
                className="im-field__input bom-readonly bom-field__input--compact"
                value={money(header.ProductionStdCost)}
                readOnly
              />
            </div>

            <div className="im-field">
              <label className="im-field__label bom-lbl" htmlFor="bom-plan-size">Planned Avg Production Size</label>
              <input
                id="bom-plan-size"
                className="im-field__input bom-field__input--compact"
                name="PlanAvgProdSize"
                type="number"
                min="0"
                step="any"
                value={header.PlanAvgProdSize}
                onChange={handleHeaderChange}
              />
            </div>

            {isSalesBOM && (
              <label className="bom-checkbox-field">
                <span className="bom-checkbox-spacer" />
                <input
                  type="checkbox"
                  name="HideBOMComponentsInPrintout"
                  checked={header.HideBOMComponentsInPrintout === "tYES"}
                  onChange={handleHeaderChange}
                />
                <span>Hide BOM Components in Printout</span>
              </label>
            )}
          </div>

          <div className="bom-header-right">
            {isProductionBOM && (
              <div className="im-field">
                <label className="im-field__label bom-lbl-r" htmlFor="bom-warehouse">Warehouse</label>
                <select
                  id="bom-warehouse"
                  className="im-field__select bom-field__select"
                  name="Warehouse"
                  value={header.Warehouse}
                  onChange={handleHeaderChange}
                >
                  <option value="">--</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.WarehouseCode} value={warehouse.WarehouseCode}>{warehouse.WarehouseCode}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="im-field">
              <label className="im-field__label bom-lbl-r" htmlFor="bom-price-list">Price List</label>
              <select
                id="bom-price-list"
                className="im-field__select bom-field__select"
                name="PriceList"
                value={header.PriceList}
                onChange={handleHeaderChange}
              >
                <option value="">--</option>
                {priceLists.map((priceList) => (
                  <option key={priceList.PriceListNo} value={priceList.PriceListNo}>{priceList.PriceListName}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label bom-lbl-r" htmlFor="bom-distr-rule">Distr. Rule</label>
              <select
                id="bom-distr-rule"
                className="im-field__select bom-field__select"
                name="DistributionRule"
                value={header.DistributionRule}
                onChange={handleHeaderChange}
              >
                <option value="">--</option>
                {distRules.map((rule) => (
                  <option key={rule.FactorCode} value={rule.FactorCode}>{rule.FactorCode} - {rule.FactorDescription}</option>
                ))}
              </select>
            </div>

            <div className="im-field">
              <label className="im-field__label bom-lbl-r" htmlFor="bom-project">Project</label>
              <select
                id="bom-project"
                className="im-field__select bom-field__select"
                name="Project"
                value={header.Project}
                onChange={handleHeaderChange}
              >
                <option value="">--</option>
                {projects.map((project) => (
                  <option key={project.Code} value={project.Code}>{project.Code} - {project.Name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="im-tabs">
        {TABS.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`im-tab${tab === index ? " im-tab--active" : ""}`}
            onClick={() => setTab(index)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="im-tab-panel bom-tab-panel">
        {tab === 0 && (
          <BOMLines
            lines={lines}
            treeType={header.TreeType}
            selectedLineId={selectedLineId}
            warehouses={warehouses}
            priceLists={priceLists}
            distRules={distRules}
            projects={projects}
            totalStdCost={totalStdCost}
            totalPrice={totalPrice}
            onChange={handleLineChange}
            onAdd={addLine}
            onDelete={deleteLine}
            onSelectLine={setSelectedLineId}
            onItemSearch={openRowLookup}
          />
        )}
        {tab === 1 && (
          <>
            {!savedTreeCode && <div className="im-alert">Add the Bill of Materials first, then attach files.</div>}
            <input ref={fileInputRef} type="file" multiple hidden aria-label="Attachment file" onChange={handleAttachmentFiles} />
            <DocumentAttachmentsTab
              attachments={attachments}
              isEditable={Boolean(savedTreeCode)}
              onBrowseAttachment={() => fileInputRef.current?.click()}
              onDisplayAttachment={handleDisplayAttachment}
              onDeleteAttachment={handleDeleteAttachment}
            />
          </>
        )}
      </div>

      <div className="bom-bottom-bar">
        <label className="im-field">
          <span className="im-field__label">Product Price</span>
          <input className="im-field__input bom-readonly bom-field__input--compact" value={money(header.ProductPrice)} readOnly />
        </label>
        <label className="im-field">
          <span className="im-field__label">Total</span>
          <input className="im-field__input bom-readonly bom-field__input--compact" value={money(totalPrice)} readOnly />
        </label>
      </div>

      {activeLookup && (lookup.kind !== "header" || mode !== MODES.FIND) && (
        <ItemSearchModal
          onSelect={handleLookupSelect}
          onClose={() => setLookup(null)}
          fetchItems={activeLookup.fetchItems}
          columns={activeLookup.columns}
          title={activeLookup.title}
          emptyMessage={activeLookup.emptyMessage}
        />
      )}
    </div>
  );
}
