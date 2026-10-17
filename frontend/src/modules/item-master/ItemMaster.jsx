import React, { useState, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./styles/itemMaster.css";
import GeneralTab        from "./components/GeneralTab";
import PurchasingTab     from "./components/PurchasingTab";
import SalesTab          from "./components/SalesTab";
import InventoryTab      from "./components/InventoryTab";
import PlanningTab       from "./components/PlanningTab";
import ProductionDataTab from "./components/ProductionDataTab";
import PropertiesTab     from "./components/PropertiesTab";
import RemarksTab        from "./components/RemarksTab";
import AttachmentsTab    from "./components/AttachmentsTab";
import AddOnTab          from "./components/AddOnTab";
import LookupField       from "./components/LookupField";
import { changedFieldsNotSent } from "./itemPayloadChanges";
import ItemGroupSetup     from "./components/ItemGroupSetup";
import ManufacturerSetup  from "./components/ManufacturerSetup";
import { useAuth } from "../../auth/AuthContext";
import { isRouteStateForActiveCompany } from "../../utils/companyStorageScope";
import { replaceRouteStatePreservingWindow } from "../../utils/copyToState";
import {
  createItem, getItem, updateItem, checkItemCodeExists,
  fetchItemGroups, fetchVendors, fetchPriceLists, fetchUoMGroups, fetchItemCodePrefixes,
  fetchWarehouses, fetchCustomsGroups, searchItems, generateItemCode,
  fetchAttachments, uploadAttachment, deleteAttachment, downloadAttachment,
} from "../../api/itemApi";

const YARN_COTTON_TAB = "Yarn Cotton";

const BASE_TABS = [
  "General", "Purchasing Data", "Sales Data", "Inventory Data",
  "Planning Data", "Production Data", "Properties", "Remarks", "Attachments",
];

const TABS = [YARN_COTTON_TAB, ...BASE_TABS];
const REQUIRED_TABS = new Set(["General"]);
const LS_KEY = "itemMaster_visibleTabs";

const loadVisibleTabs = () => {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved).filter((tab) => TABS.includes(tab));
      REQUIRED_TABS.forEach((t) => { if (!parsed.includes(t)) parsed.push(t); });
      TABS.forEach((t) => { if (!parsed.includes(t)) parsed.push(t); });
      return new Set(parsed);
    }
  } catch (_) {}
  return new Set(TABS);
};

const MODES = { ADD: "add", FIND: "find", UPDATE: "update" };

const buildInitialProps = () => {
  const p = {};
  for (let i = 1; i <= 64; i++) p[`Properties${i}`] = "tNO";
  return p;
};

const normalizeGroupName = (value) =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const isYarnCottonGroup = (form = {}) =>
  normalizeGroupName(form.ItemsGroupName) === "yarn cotton" ||
  normalizeGroupName(form.ItemsGroupCode) === "yarn cotton";

const getTabs = (form = {}) =>
  isYarnCottonGroup(form) ? [YARN_COTTON_TAB, ...BASE_TABS] : BASE_TABS;

const clonePlain = (value) => {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clonePlain(entry)]));
  }
  return value;
};

const hasControlCharacters = (value) =>
  Array.from(String(value || "")).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

const normalizeGSTMaterialType = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-1") return "";

  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map = {
    capitalgoods: "Capital Goods",
    mtcapitalgoods: "Capital Goods",
    1: "Capital Goods",
    finishedgoods: "Finished Goods",
    mtfinishedgoods: "Finished Goods",
    3: "Finished Goods",
    rawmaterial: "Raw Materials",
    rawmaterials: "Raw Materials",
    mtrawmaterial: "Raw Materials",
    mtrawmaterials: "Raw Materials",
    2: "Raw Materials",
  };

  return map[normalized] || raw;
};

const EMPTY_FORM = {
  ItemCode: "", ItemCodePrefix: "", ItemCodeNumber: "", BarCode: "", ItemName: "", ForeignName: "",
  PriceListNum: "", PriceListName: "", Price: "",
  ItemsGroupCode: "", ItemsGroupName: "",
  UoMGroupEntry: "", UoMGroupName: "",
  InventoryItem: "tYES", SalesItem: "tYES", PurchaseItem: "tYES", AssetItem: "tNO",
  // General
  ItemType: "itItems", ItemClass: "itcMaterial",
  MaterialType: "", MaterialGroup: "",
  TreeType: "iNotATree", IsPhantom: "tNO", NoDiscounts: "tNO",
  SupplierCatalogNo: "", ItemCountryOrg: "", IssueMethod: "im_Manual",
  VatLiable: "tYES", WTLiable: "tYES", IndirectTax: "tNO",
  ArTaxCode: "", ApTaxCode: "",
  ManageSerialNumbers: "tNO", ManageBatchNumbers: "tNO",
  SRIAndBatchManageMethod: "bomm_OnEveryTransaction",
  ForceSelectionOfSerialNumber: "tNO", ManageSerialNumbersOnReleaseOnly: "tNO",
  AutoCreateSerialNumbersOnRelease: "tNO", IssuePrimarilyBy: "ipbSerialAndBatchNumbers",
  ManageItemBy: "None",
  BlockMultipleReceiptsForSameBatch: "tNO",
  SerialTrackingMethod: "",
  Valid: "tYES", ValidFrom: "", ValidTo: "", ValidRemarks: "",
  Frozen: "tNO", FrozenFrom: "", FrozenTo: "", FrozenRemarks: "",
  LinkedResource: "",
  Excisable: "tNO",
  GSTRelevnt: "tNO",
  GSTMaterialType: "",
  ChapterID: "",
  GSTTaxCategory: "gtc_Regular",
  CapitalGoodsOnHoldPercent: "",
  CapitalGoodsOnHoldLimit: "",
  AssessableValue: "",
  AssVal4WTR: "",
  AdditionalIdentifier: "",
  ServiceCategory: "",
  U_Application: "",
  U_Attribute: "",
  U_Count: "",
  U_CottonType: "",
  U_SpinningProcess: "",
  U_YarnPly: "",
  // Purchasing
  Mainsupplier: "", DefaultVendorName: "",
  PurchaseUnit: "", PurchaseItemsPerUnit: "", PurchasePackagingUnit: "", PurchaseQtyPerPackUnit: "",
  PurchaseUnitLength: "", PurchaseLengthUnit: "3",
  PurchaseUnitWidth: "", PurchaseWidthUnit: "3",
  PurchaseUnitHeight: "", PurchaseHeightUnit: "3",
  PurchaseUnitVolume: "", PurchaseVolumeUnit: "4",
  PurchaseUnitWeight: "", PurchaseWeightUnit: "2",
  PurchaseUnitWeight1: "", PurchaseWeightUnit1: "5",
  PurchaseFactor1: "", PurchaseFactor2: "", PurchaseFactor3: "", PurchaseFactor4: "",
  PurchaseVATGroup: "", LeadTime: "", ExpanseAccount: "",
  DefaultPurchasingUoMEntry: "", CustomsGroupCode: "-1",
  // Sales
  SalesUnit: "", SalesItemsPerUnit: "", SalesPackagingUnit: "", SalesQtyPerPackUnit: "",
  SalesUnitLength: "", SalesLengthUnit: "3",
  SalesUnitWidth: "", SalesWidthUnit: "3",
  SalesUnitHeight: "", SalesHeightUnit: "3",
  SalesUnitVolume: "", SalesVolumeUnit: "4",
  SalesUnitWeight: "", SalesWeightUnit: "2",
  SalesUnitWeight1: "", SalesWeightUnit1: "5",
  SalesFactor1: "", SalesFactor2: "", SalesFactor3: "", SalesFactor4: "",
  SalesVATGroup: "", WarrantyTemplate: "",
  CommissionPercent: "", CommissionGroup: "", CommissionSum: "",
  IncomeAccount: "", ExemptIncomeAccount: "",
  ForeignRevenuesAccount: "", ECRevenuesAccount: "",
  ForeignExpensesAccount: "", ECExpensesAccount: "",
  DefaultSalesUoMEntry: "", QRCodeSource: "",
  // Inventory
  InventoryUOM: "", InventoryUoMEntry: "",
  CostAccountingMethod: "", GLMethod: "glm_WH", TaxType: "tt_Yes",
  ManageStockByWarehouse: "tNO", DefaultWarehouse: "",
  MinInventory: "", MaxInventory: "", DesiredInventory: "",
  ProdStdCost: "", InCostRollup: "tYES",
  MovingAveragePrice: "", AvgStdPrice: "",
  QuantityOnStock: "", QuantityOrderedByCustomers: "", QuantityOrderedFromVendors: "",
  InventoryWeight: "", InventoryWeightUnit: "2",
  InventoryWeight1: "", InventoryWeightUnit1: "5",
  DefaultCountingUnit: "", CountingItemsPerUnit: "", DefaultCountingUoMEntry: "",
  // Planning
  PlanningSystem: "bop_None", ProcurementMethod: "bom_Buy",
  ComponentWarehouse: "bomcw_BOM",
  OrderIntervals: "", OrderMultiple: "", MinOrderQuantity: "",
  ToleranceDays: "", TypeOfAdvancedRules: "toarGeneral",
  DemandSource: "ds_SalesOrders", HorizonDays: "", FreezeDays: "",
  // Production
  NoOfItemComponents: 0, NoOfResourceComponents: 0, NoOfRouteStages: 0,
  // Remarks
  User_Text: "", Remarks: "",
  ...buildInitialProps(),
};

export default function ItemMaster() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode]       = useState(MODES.ADD);
  const [duplicateSourceItemCode, setDuplicateSourceItemCode] = useState("");
  const [tab, setTab]         = useState(0);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [initialForm, setInitialForm] = useState(EMPTY_FORM); // For dirty detection
  // Service Layer properties of the loaded item: what an Update may send back.
  const [loadedKeys, setLoadedKeys] = useState(() => new Set());
  const [alert, setAlert]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [visibleTabs] = useState(loadVisibleTabs);
  const [itemCodeError, setItemCodeError] = useState("");

  const [prices, setPrices]         = useState([]);
  const [stock, setStock]           = useState([]);
  const [barcodes, setBarcodes]     = useState([]);
  const [uoms, setUoms]             = useState([]);
  const [prefVendors, setPrefVendors] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [itemCodePrefixes, setItemCodePrefixes] = useState([]);
  const [showCFL, setShowCFL] = useState(false);
  const [cflResults, setCflResults] = useState([]);
  const [showItemGroupSetup, setShowItemGroupSetup] = useState(false);
  const [showManufacturerSetup, setShowManufacturerSetup] = useState(false);
  
  // Warehouse reference data
  const [warehouses, setWarehouses] = useState([]);
  const [customsGroups, setCustomsGroups] = useState([]);

  // Dirty form detection
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  // Helper: show alert
  const showAlert = useCallback((type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 5000);
  }, []);

  // Reset form
  const resetForm = useCallback(() => {
    if (isDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    setForm(EMPTY_FORM);
    setInitialForm(EMPTY_FORM);
    setLoadedKeys(new Set());
    setPrices([]); setStock([]); setBarcodes([]);
    setUoms([]); setPrefVendors([]); setAttachments([]);
    setDuplicateSourceItemCode("");
    setTab(0); setAlert(null); setItemCodeError("");
  }, [isDirty]);

  // Activate Find Mode
  const activateFindMode = useCallback(() => {
    if (isDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    navigate("/item-master/find");
  }, [isDirty, navigate]);

  // Handle New
  const handleNew = useCallback(async () => {
    if (isDirty && !window.confirm("You have unsaved changes. Discard them?")) return;
    setMode(MODES.ADD);
    resetForm();
    // Reinitialize warehouse stock for new items using cached warehouse data
    if (warehouses.length > 0) {
      const warehouseStock = warehouses.map(wh => ({
        WarehouseCode: wh.code,
        WarehouseName: wh.name,
        Branch: "",
        Locked: "tNO",
        InStock: 0,
        Committed: 0,
        Ordered: 0,
        MinimalStock: "",
        MaximalStock: "",
        MinimalOrder: "",
        StandardAveragePrice: 0
      }));
      setStock(warehouseStock);
    }
  }, [isDirty, resetForm, warehouses]);

  // Load item prefixes and warehouses on mount
  useEffect(() => {
    // Load item code prefixes
    fetchItemCodePrefixes()
      .then(setItemCodePrefixes)
      .catch((err) => {
        console.error("Failed to load item numbering series:", err);
        setItemCodePrefixes([]);
      });
    
    // Load warehouses for warehouse stock table
    fetchWarehouses()
      .then(data => {
        console.log('Warehouses loaded:', data);
        setWarehouses(data);
        // Initialize stock array with all warehouses for new items
        const warehouseStock = data.map(wh => ({
          WarehouseCode: wh.code,
          WarehouseName: wh.name,
          Branch: "",
          Locked: "tNO",
          InStock: 0,
          Committed: 0,
          Ordered: 0,
          MinimalStock: "",
          MaximalStock: "",
          MinimalOrder: "",
          StandardAveragePrice: 0
        }));
        setStock(warehouseStock);
      })
      .catch(err => {
        console.error("Failed to load warehouses:", err);
      });

    fetchCustomsGroups()
      .then(setCustomsGroups)
      .catch((err) => {
        console.error("Failed to load customs groups:", err);
        setCustomsGroups([]);
      });
  }, []);

  // Split ItemCode into prefix and number when loading existing item
  const splitItemCode = useCallback((itemCode) => {
    if (!itemCode) return { prefix: "", number: "" };
    const match = itemCode.match(/^([A-Za-z]+)-?(.*)$/);
    if (match) {
      return { prefix: match[1], number: match[2] };
    }
    return { prefix: "", number: itemCode };
  }, []);

  const prepareItemForForm = useCallback((source) => {
    const data = clonePlain(source || {});
    data.GSTMaterialType = normalizeGSTMaterialType(data.GSTMaterialType || data.MaterialType);
    const SAP_UNSET_INT = -1;
    const intFields = [
      "InventoryUoMEntry", "DefaultSalesUoMEntry",
      "DefaultPurchasingUoMEntry", "DefaultCountingUoMEntry",
      "ShipType", "Manufacturer", "CommissionGroup", "ServiceGroup", "MaterialGroup", "WarrantyTemplate",
    ];
    intFields.forEach((f) => { if (data[f] === SAP_UNSET_INT) data[f] = ""; });
    const unitDefaults = {
      InventoryWeightUnit: "2", InventoryWeightUnit1: "5",
      PurchaseWeightUnit: "2", PurchaseWeightUnit1: "5",
      SalesWeightUnit: "2", SalesWeightUnit1: "5",
      PurchaseLengthUnit: "3", PurchaseWidthUnit: "3", PurchaseHeightUnit: "3",
      SalesLengthUnit: "3", SalesWidthUnit: "3", SalesHeightUnit: "3",
      PurchaseVolumeUnit: "4", SalesVolumeUnit: "4",
    };
    Object.entries(unitDefaults).forEach(([f, def]) => { if (data[f] == null) data[f] = def; });
    let prefix = "";
    let number = data.ItemCode || "";
    // If there is a series (number series) defined, use it as prefix
    if (data.Series !== undefined && data.Series !== null && data.Series !== "" && data.Series !== "-1") {
      prefix = String(data.Series);
      // Keep number as ItemCode (assumed to be the numeric part)
      number = data.ItemCode || "";
    } else {
      // Fallback to splitting ItemCode to derive prefix and number
      const { prefix: p, number: n } = splitItemCode(data.ItemCode);
      prefix = p;
      number = n;
    }
    const manageItemBy = data.ManageSerialNumbers === "tYES"
      ? "Serial"
      : data.ManageBatchNumbers === "tYES"
        ? "Batch"
        : "None";
    const loadedForm = {
      ...EMPTY_FORM,
      ...data,
      ManageItemBy: data.ManageItemBy || manageItemBy,
      ItemCodePrefix: prefix,
      ItemCodeNumber: number,
    };
    return { data, loadedForm };
  }, [splitItemCode]);

  // Load Item logic
  const loadItem = useCallback(async (itemCode) => {
    const source = await getItem(itemCode.trim());
    const { data, loadedForm } = prepareItemForForm(source);
    setForm(loadedForm);
    setInitialForm(loadedForm); // Set as clean state
    setLoadedKeys(new Set(Object.keys(source || {})));
    setPrices(data.ItemPrices || []);
    setStock(data.ItemWarehouseInfoCollection || []);
    setBarcodes(data.ItemBarCodeCollection || []);
    setUoms(data.ItemUnitOfMeasurementCollection || []);
    setPrefVendors(data.ItemPreferredVendors || []);
    setAttachments(await fetchAttachments(itemCode.trim()).catch(() => []));
    setDuplicateSourceItemCode("");
    setMode(MODES.UPDATE);
  }, [prepareItemForForm]);

  useEffect(() => {
    const stateItemCode = location.state?.itemMasterItemCode || location.state?.itemCode;
    const queryItemCode = new URLSearchParams(location.search).get("itemCode");
    const validStateItemCode = stateItemCode && isRouteStateForActiveCompany(location.state)
      ? stateItemCode
      : "";
    const itemCodeToLoad = String(validStateItemCode || queryItemCode || "").trim();

    if (!itemCodeToLoad) return;

    let ignore = false;
    setLoading(true);
    loadItem(itemCodeToLoad)
      .then(() => {
        if (!ignore) {
          showAlert("success", `Item "${itemCodeToLoad}" loaded.`);
          if (validStateItemCode) {
            replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
          }
        }
      })
      .catch((err) => {
        if (!ignore) {
          showAlert("error", err.response?.data?.message || `Could not load "${itemCodeToLoad}".`);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [location.pathname, location.search, location.state, loadItem, navigate, showAlert]);

  // Handle Find logic
  const handleFind = useCallback(async () => {
    const itemCode = String(form.ItemCode || "").trim();
    const itemCodeNumber = String(form.ItemCodeNumber || "").trim();
    const searchTerm = itemCode
      || itemCodeNumber
      || String(form.ItemName || "").trim()
      || String(form.ForeignName || "").trim()
      || String(form.BarCode || "").trim();
    if (!searchTerm) { 
      showAlert("error", "Enter an Item Code, Name, Foreign Name, or Barcode to search."); 
      return; 
    }
    setLoading(true);
    try {
      if (itemCode || itemCodeNumber) {
        try {
          await loadItem(itemCode || itemCodeNumber);
          showAlert("success", `Item "${itemCode || itemCodeNumber}" loaded.`);
          return;
        } catch (_) {}
      }

      const results = await searchItems(searchTerm, 100);
      if (results.length === 0) {
        showAlert("error", "No matching items found.");
      } else if (results.length === 1) {
        await loadItem(results[0].ItemCode);
        showAlert("success", `Item "${results[0].ItemCode}" loaded.`);
      } else {
        setCflResults(results);
        setShowCFL(true);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || "Search failed.";
      showAlert("error", errorMsg);
    } finally { 
      setLoading(false); 
    }
  }, [form.ItemCode, form.ItemCodeNumber, form.ItemName, form.ForeignName, form.BarCode, loadItem, showAlert]);

  // Smart default value logic based on item properties
  const applySmartDefaults = useCallback((sourceForm, fieldName, value) => {
    const newForm = { ...sourceForm, [fieldName]: value };
    
    // Set defaults based on item type changes
    if (fieldName === 'ItemType') {
      if (value === 'itItems') {
        newForm.ItemClass = 'itcMaterial';
      } else if (value === 'itService') {
        newForm.ItemClass = 'itcService';
        newForm.InventoryItem = 'tNO';
        newForm.SalesItem = 'tYES';
        newForm.PurchaseItem = 'tYES';
      }
    }
    
    // Set defaults based on inventory item flag
    if (fieldName === 'InventoryItem') {
      if (value === 'tYES') {
        if (!newForm.GLMethod) {
          newForm.GLMethod = 'glm_WH';
        }
      }
    }

    if (fieldName === 'ManageItemBy') {
      newForm.ManageSerialNumbers = value === 'Serial' ? 'tYES' : 'tNO';
      newForm.ManageBatchNumbers = value === 'Batch' ? 'tYES' : 'tNO';
      if (value === 'Serial' || value === 'Batch') {
        newForm.CostAccountingMethod = 'bis_SNB';
      }
    }
    
    // Set defaults based on sales item flag
    if (fieldName === 'SalesItem') {
      if (value === 'tYES') {
        // Sales item defaults are handled via ItemPrices collection
      }
    }
    
    // Set tax defaults based on VAT liability
    if (fieldName === 'VatLiable') {
      if (value === 'tYES') {
        // Enable withholding tax by default for VAT liable items
        newForm.WTLiable = 'tYES';
      }
    }
    
    // Set UoM defaults when UoM group changes
    if (fieldName === 'UoMGroupEntry' && value) {
      // Default the inventory, sales, and purchasing UoMs to the group's default
      if (!newForm.DefaultSalesUoMEntry) {
        newForm.DefaultSalesUoMEntry = value;
      }
      if (!newForm.DefaultPurchasingUoMEntry) {
        newForm.DefaultPurchasingUoMEntry = value;
      }
      if (!newForm.InventoryUoMEntry) {
        newForm.InventoryUoMEntry = value;
      }
    }
    
    // Set planning defaults
    if (fieldName === 'PlanningSystem') {
      if (value === 'bop_MRP') {
        if (!newForm.ProcurementMethod) {
          newForm.ProcurementMethod = 'bom_Buy';
        }
        if (!newForm.DemandSource) {
          newForm.DemandSource = 'ds_SalesOrders';
        }
      }
    }
    
    // Clear dependent fields when primary fields are cleared
    if (fieldName === 'ItemsGroupCode' && !value) {
      newForm.ItemsGroupName = '';
    }
    
    if (fieldName === 'UoMGroupEntry' && !value) {
      newForm.UoMGroupName = '';
      newForm.DefaultSalesUoMEntry = '';
      newForm.DefaultPurchasingUoMEntry = '';
      newForm.InventoryUoMEntry = '';
    }
    
    return newForm;
  }, []);

  // Enhanced change handler with smart defaults
  const handleChange = useCallback((e) => {
    const { name, value, type, checked, label } = e.target;
    const finalValue = type === 'checkbox' ? (checked ? 'tYES' : 'tNO') : value;
    
    setForm((prev) => {
      const updated = applySmartDefaults(prev, name, finalValue);
      
      // Handle label for lookups (e.g. ManufacturerName)
      if (label !== undefined) {
        updated[`${name}Name`] = label;
      }
      
      // Mutually exclusive: Excisable and GSTRelevnt
      if (type === "checkbox" && checked) {
        if (name === "Excisable") updated.GSTRelevnt = "tNO";
        if (name === "GSTRelevnt") updated.Excisable = "tNO";
      }
      
      // Item code generation logic
      if (name === "ItemCodePrefix" || name === "ItemCodeNumber") {
        const prefix = name === "ItemCodePrefix" ? value : prev.ItemCodePrefix;
        const number = name === "ItemCodeNumber" ? value : prev.ItemCodeNumber;
        if (prefix === "Manual") updated.ItemCode = number;
        else updated.ItemCode = number || "";
      }
      
      return updated;
    });
    
    // Auto-generate item code for non-manual prefixes
    if (name === "ItemCodePrefix" && value && value !== "Manual" && mode === MODES.ADD) {
      setLoading(true);
      generateItemCode(value)
        .then((data) => {
          if (data.itemCode) {
            setForm(prev => ({
              ...prev,
              ItemCodeNumber: data.itemCode,
              ItemCode: data.itemCode
            }));
          }
        })
        .catch(() => showAlert("error", "Failed to auto-generate item number."))
        .finally(() => setLoading(false));
    } else if (name === "ItemCodePrefix" && value === "Manual" && mode === MODES.ADD) {
      setForm(prev => ({ ...prev, ItemCodeNumber: "", ItemCode: "" }));
    }
    
    // Clear item code errors when relevant fields change
    if (name === "ItemCode" || name === "ItemCodePrefix" || name === "ItemCodeNumber") {
      setItemCodeError("");
    }
  }, [applySmartDefaults, mode, showAlert]);

  // Comprehensive validation function
  const validateItemForm = useCallback((isUpdate = false) => {
    const errors = [];
    
    // Basic Required Fields
    if (!String(form.ItemCode || "").trim()) {
      errors.push("Item Code is required.");
    }
    if (!String(form.ItemName || "").trim()) {
      errors.push("Item Name is required.");
    }
    
    // SAP B1 Mandatory Fields
    if (!String(form.ItemsGroupCode || "").trim()) {
      errors.push("Item Group is required.");
    }
    
    // UoM Group validation - required for inventory items
    if (form.InventoryItem === 'tYES' && !String(form.UoMGroupEntry || "").trim()) {
      errors.push("UoM Group is required for inventory items.");
    }
    
    // Sales Item validations - ItemPrices collection is used instead of a single PriceListNum field
  // The UI Price List selection is handled via ItemPrices collection in buildPayload
    
    // Asset Item validations
    if (form.AssetItem === 'tYES') {
      if (!String(form.IncomeAccount || "").trim()) {
        errors.push("Income Account is required for asset items.");
      }
    }
    
    // GST Validations
    if (form.GSTRelevnt === 'tYES') {
      if (!String(form.ChapterID || "").trim()) {
        errors.push("HSN/SAC Code is required when GST is enabled.");
      }
      if (!String(form.GSTTaxCategory || "").trim()) {
        errors.push("GST Tax Category is required when GST is enabled.");
      }
    }
    
    // Date Range Validations
    if (form.ValidFrom && form.ValidTo) {
      const validFrom = new Date(form.ValidFrom);
      const validTo = new Date(form.ValidTo);
      if (validFrom > validTo) {
        errors.push("Valid From date cannot be after Valid To date.");
      }
    }
    
    if (form.FrozenFrom && form.FrozenTo) {
      const frozenFrom = new Date(form.FrozenFrom);
      const frozenTo = new Date(form.FrozenTo);
      if (frozenFrom > frozenTo) {
        errors.push("Frozen From date cannot be after Frozen To date.");
      }
    }
    
    // Numeric Range Validations
    const validatePositiveNumber = (value, fieldName) => {
      if (value !== undefined && value !== "" && (isNaN(value) || parseFloat(value) < 0)) {
        errors.push(`${fieldName} must be a positive number.`);
      }
    };
    
    validatePositiveNumber(form.CommissionPercent, "Commission Percent");
    validatePositiveNumber(form.MinInventory, "Minimum Inventory");
    validatePositiveNumber(form.MaxInventory, "Maximum Inventory");
    validatePositiveNumber(form.DesiredInventory, "Desired Inventory");
    validatePositiveNumber(form.OrderMultiple, "Order Multiple");
    validatePositiveNumber(form.MinOrderQuantity, "Minimum Order Quantity");
    
    // Item Code Format Validation
    const itemCode = String(form.ItemCode || "").trim();
    if (itemCode) {
      if (hasControlCharacters(itemCode)) {
        errors.push("Item Code cannot contain control characters.");
      }
      
      // Check minimum length
      if (itemCode.length < 3) {
        errors.push("Item Code must be at least 3 characters long.");
      }
      
      // Check maximum length
      if (itemCode.length > 50) {
        errors.push("Item Code cannot exceed 50 characters.");
      }
    }
    
    // Check for existing validation errors
    if (itemCodeError) {
      errors.push("Please fix item code validation errors.");
    }
    
    return errors;
  }, [form, itemCodeError]);

  const validateDuplicateItemForm = useCallback(() => {
    const errors = [];

    if (!String(form.ItemCode || "").trim()) {
      errors.push("Item Code is required.");
    }
    if (!String(form.ItemName || "").trim()) {
      errors.push("Item Name is required.");
    }
    if (itemCodeError) {
      errors.push("Please fix item code validation errors.");
    }

    return errors;
  }, [form.ItemCode, form.ItemName, itemCodeError]);

  // Attachments: stored on the server per company and item. A new item keeps the
  // chosen files until Add, then uploads them; a saved item uploads at once.
  const uploadFiles = useCallback(async (itemCode, files) => {
    for (const file of files) {
      const body = new FormData();
      body.append("file", file);
      await uploadAttachment(itemCode, body);
    }
  }, []);
  const savedItemCode = mode === MODES.UPDATE ? String(form.ItemCode || "").trim() : "";
  const addAttachments = async (files) => {
    if (!savedItemCode) {
      setAttachments((p) => [...p, ...files.map((f, i) => ({ id: `new-${Date.now()}-${i}`, name: f.name, size: f.size, type: f.type, file: f }))]);
      return;
    }
    try {
      await uploadFiles(savedItemCode, files);
      setAttachments(await fetchAttachments(savedItemCode));
    } catch (err) { showAlert("error", extractSapError(err)); }
  };
  const removeAttachment = async (attachment) => {
    if (attachment.file || !savedItemCode) { setAttachments((p) => p.filter((a) => a.id !== attachment.id)); return; }
    try {
      await deleteAttachment(savedItemCode, attachment.id);
      setAttachments(await fetchAttachments(savedItemCode));
    } catch (err) { showAlert("error", extractSapError(err)); }
  };
  const openAttachment = async (attachment) => {
    try {
      const url = URL.createObjectURL(await downloadAttachment(savedItemCode, attachment.id));
      const link = Object.assign(document.createElement("a"), { href: url, download: attachment.name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { showAlert("error", extractSapError(err)); }
  };

  // Handle Add logic
  const handleAdd = useCallback(async () => {
    const sourceItemCode = String(duplicateSourceItemCode || form._duplicateFromItemCode || "").trim();
    const errors = sourceItemCode ? validateDuplicateItemForm() : validateItemForm(false);
    if (errors.length > 0) {
      showAlert("error", errors[0]); // Show first error
      return;
    }
    
    setLoading(true);
    try {
      const payload = sourceItemCode
        ? buildDuplicatePayload(form, sourceItemCode, user)
        : buildPayload(form, prices, barcodes, uoms, prefVendors, stock, user);
      const created = await createItem(payload);
      const savedCode = String(created?.ItemCode || form.ItemCode || "").trim();
      // Reload what was stored so the next Update compares with the saved item.
      if (savedCode) {
        await uploadFiles(savedCode, attachments.filter((a) => a.file).map((a) => a.file));
        await loadItem(savedCode);
      } else {
        const savedForm = { ...form };
        delete savedForm._duplicateFromItemCode;
        setForm(savedForm);
        setInitialForm(savedForm);
        setMode(MODES.UPDATE);
      }
      showAlert("success", `Item "${savedCode || form.ItemCode}" created successfully.`);
      setDuplicateSourceItemCode("");
    } catch (err) {
      showAlert("error", extractSapError(err));
    } finally { setLoading(false); }
  }, [duplicateSourceItemCode, form, loadItem, uploadFiles, attachments, prices, barcodes, uoms, prefVendors, stock, user, validateDuplicateItemForm, validateItemForm, showAlert]);

  // Handle Update logic
  const handleUpdate = useCallback(async () => {
    const errors = validateItemForm(true);
    if (errors.length > 0) {
      showAlert("error", errors[0]); // Show first error
      return;
    }
    
    setLoading(true);
    try {
      await updateItem(form.ItemCode.trim(), buildPayload(form, prices, barcodes, uoms, prefVendors, stock, user, { form: initialForm, keys: loadedKeys }));
      // Reload so the page shows what was stored (and the next Update compares with it).
      await loadItem(form.ItemCode.trim());
      showAlert("success", `Item "${form.ItemCode}" updated successfully.`);
    } catch (err) {
      showAlert("error", extractSapError(err));
    } finally { setLoading(false); }
  }, [form, initialForm, loadedKeys, loadItem, prices, barcodes, uoms, prefVendors, stock, user, validateItemForm, showAlert]);

  // handleSave logic
  const handleSave = useCallback(() => {
    if (mode === MODES.ADD)    return handleAdd();
    if (mode === MODES.UPDATE) return handleUpdate();
    if (mode === MODES.FIND)   return handleFind();
  }, [mode, handleAdd, handleUpdate, handleFind]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === "f") { e.preventDefault(); activateFindMode(); }
      if (e.key === "F2") { e.preventDefault(); activateFindMode(); }
      if (e.key === "Escape" && mode === MODES.FIND) { e.preventDefault(); handleNew(); }
      if (e.key === "Enter" && mode === MODES.FIND) { e.preventDefault(); handleFind(); }
      if (e.ctrlKey && e.key === "s") { e.preventDefault(); handleSave(); }
      if (e.ctrlKey && e.key === "n") { e.preventDefault(); handleNew(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, activateFindMode, handleFind, handleNew, handleSave]);

  // Warn on unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Close tab settings on click outside
  const handleItemCodeBlur = async () => {
    if (mode !== MODES.ADD || !String(form.ItemCode || "").trim()) return;
    try {
      const { exists } = await checkItemCodeExists(String(form.ItemCode || "").trim());
      if (exists) setItemCodeError("Item code already exists");
      else setItemCodeError("");
    } catch (err) {
      console.error("Failed to check item code:", err);
    }
  };

  const handleWarehouseChange = (i, field, value) =>
    setStock((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const handleDuplicate = useCallback(async () => {
    if (mode !== MODES.UPDATE || !form.ItemCode) return;

    const sourceItemCode = String(form.ItemCode || "").trim();
    setLoading(true);
    try {
      const source = await getItem(sourceItemCode);
      const { data, loadedForm } = prepareItemForForm(source);
      const duplicatedForm = {
        ...loadedForm,
        _duplicateFromItemCode: sourceItemCode,
        ItemCode: "",
        ItemCodePrefix: "",
        ItemCodeNumber: "",
      };

      setForm(duplicatedForm);
      setInitialForm(EMPTY_FORM);
      setPrices(clonePlain(data.ItemPrices || []));
      setStock(clonePlain(data.ItemWarehouseInfoCollection || []));
      setBarcodes(clonePlain(data.ItemBarCodeCollection || []));
      setUoms(clonePlain(data.ItemUnitOfMeasurementCollection || []));
      setPrefVendors(clonePlain(data.ItemPreferredVendors || []));
      setAttachments(clonePlain(attachments));
      setDuplicateSourceItemCode(sourceItemCode);
      setItemCodeError("");
      setMode(MODES.ADD);
      showAlert("success", `Item "${sourceItemCode}" duplicated. Enter a new item number, then click Add.`);
      setTimeout(() => document.querySelector('input[name="ItemCodeNumber"]')?.focus(), 50);
    } catch (err) {
      showAlert("error", err.response?.data?.message || "Failed to duplicate item.");
    } finally {
      setLoading(false);
    }
  }, [attachments, form.ItemCode, mode, prepareItemForForm, showAlert]);

  const handleCFLSelect = async (item) => {
    setShowCFL(false);
    setLoading(true);
    try {
      await loadItem(item.ItemCode);
      showAlert("success", `Item "${item.ItemCode}" loaded.`);
    } catch (err) {
      showAlert("error", err.response?.data?.message || "Failed to load item.");
    } finally { setLoading(false); }
  };

  const getFieldBackground = (fieldName) => {
    const searchableFields = ['ItemCodePrefix', 'ItemCodeNumber', 'ItemCode', 'ItemName', 'ForeignName', 
                              'BarCode', 'ItemsGroupCode', 'UoMGroupEntry', 'PriceListNum'];
    if (mode === MODES.FIND && searchableFields.includes(fieldName)) return '#FFFFCC';
    return '#FFFFFF';
  };

  const visibleTabList = getTabs(form).filter((t) => visibleTabs.has(t));
  const activeTabName  = visibleTabList[tab] ?? visibleTabList[0];

  return (
    <div className="im-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">Item Master Data</span>
        {isDirty && <span className="im-dirty-indicator" title="Unsaved changes">●</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span className={`im-mode-badge im-mode-badge--${mode}`}>
            {mode === MODES.ADD ? "Add Mode" : mode === MODES.FIND ? "Find Mode" : "Update Mode"}
          </span>
          <button className="im-btn im-btn--primary" onClick={handleSave} disabled={loading}>
            {loading ? "..." : mode === MODES.FIND ? "Find" : mode === MODES.ADD ? "Add" : "Update"}
          </button>
          <button className="im-btn" onClick={handleNew} title="Ctrl+N">New</button>
          <button 
            className={`im-btn${mode === MODES.FIND ? " im-btn--find-active" : ""}`} 
            onClick={activateFindMode} 
            title="Ctrl+F"
          >
            Find
          </button>
          {mode === MODES.UPDATE && (
            <button className="im-btn sap-document-toolbar__duplicate" onClick={handleDuplicate}>
              Duplicate
            </button>
          )}
          {mode === MODES.UPDATE && (
            <button className="im-btn im-btn--danger" onClick={resetForm}>Cancel</button>
          )}
        </div>
      </div>

      {alert && <div className={`im-alert im-alert--${alert.type}`}>{alert.msg}</div>}

      <div className="im-header-card">
        <div className="im-header-left">
          <div className="im-field im-field--header">
            <label className="im-field__label">Item No.</label>
            <div style={{ display: "flex", gap: "4px", flex: 1 }}>
              <select
                className="im-field__select"
                name="ItemCodePrefix"
                value={form.ItemCodePrefix}
                onChange={handleChange}
                disabled={mode === MODES.UPDATE}
                style={{ flex: "0 0 100px", background: getFieldBackground('ItemCodePrefix') }}
              >
                <option value="">Select...</option>
                {itemCodePrefixes.map((prefix) => (
                  <option key={prefix.code} value={prefix.code}>
                    {prefix.isManual
                      ? "Manual"
                      : `${prefix.prefix || prefix.name || prefix.code}${prefix.name && prefix.prefix ? ` - ${prefix.name}` : ""}`}
                  </option>
                ))}
              </select>
              <input
                className={`im-field__input${itemCodeError ? " im-field__input--error" : ""}`}
                name="ItemCodeNumber"
                value={form.ItemCodeNumber}
                onChange={handleChange}
                onBlur={handleItemCodeBlur}
                readOnly={mode === MODES.UPDATE || (form.ItemCodePrefix && form.ItemCodePrefix !== "Manual" && mode === MODES.ADD)}
                placeholder={form.ItemCodePrefix === "Manual" ? "Enter item number" : "Auto-generated"}
                autoFocus
                style={{ flex: 1, background: getFieldBackground('ItemCodeNumber') }}
              />
            </div>
            {itemCodeError && <span className="im-field__error">{itemCodeError}</span>}
          </div>
          <div className="im-field im-field--header">
            <label className="im-field__label">Description</label>
            <input className="im-field__input im-field__input--wide" name="ItemName"
              value={form.ItemName} onChange={handleChange} 
              style={{ background: getFieldBackground('ItemName') }}
            />
          </div>
          <div className="im-field im-field--header">
            <label className="im-field__label">Foreign Name</label>
            <input className="im-field__input im-field__input--wide" name="ForeignName"
              value={form.ForeignName} onChange={handleChange} 
              style={{ background: getFieldBackground('ForeignName') }}
            />
          </div>
          <div className="im-field im-field--header">
            <label className="im-field__label">Item Type</label>
            <select className="im-field__select" name="ItemType"
              value={form.ItemType || "itItems"} onChange={handleChange}>
              <option value="itItems">Items</option>
              <option value="itLabor">Labor</option>
              <option value="itTravel">Travel</option>
            </select>
          </div>
          <div className="im-field im-field--header">
            <label className="im-field__label">Item Group</label>
            <LookupField name="ItemsGroupCode" value={form.ItemsGroupCode}
              displayValue={form.ItemsGroupName} onChange={handleChange}
              onSelect={(r) => setForm((p) => ({ ...p, ItemsGroupCode: r.code, ItemsGroupName: r.name }))}
              fetchOptions={fetchItemGroups} placeholder="Select group" 
              style={{ background: getFieldBackground('ItemsGroupCode') }}
              onDefineNew={() => setShowItemGroupSetup(true)}
            />
          </div>
          <div className="im-field im-field--header">
            <label className="im-field__label">UoM Group</label>
            <LookupField name="UoMGroupEntry" value={form.UoMGroupEntry}
              displayValue={form.UoMGroupName} onChange={handleChange}
              onSelect={(r) => setForm((p) => ({ ...p, UoMGroupEntry: r.code, UoMGroupName: r.name }))}
              fetchOptions={fetchUoMGroups} placeholder="Select UoM group" 
              style={{ background: getFieldBackground('UoMGroupEntry') }}
            />
          </div>
        </div>

        <div className="im-header-right">
          <div className="im-field im-field--header">
            <label className="im-field__label">Bar Code</label>
            <input className="im-field__input" name="BarCode" value={form.BarCode} onChange={handleChange} 
              style={{ background: getFieldBackground('BarCode') }}
            />
          </div>
          <div className="im-field im-field--header">
            <label className="im-field__label">Price List</label>
            <LookupField name="PriceListNum" value={form.PriceListNum}
              displayValue={form.PriceListName} onChange={handleChange}
              onSelect={(r) => setForm((p) => ({ ...p, PriceListNum: r.code, PriceListName: r.name }))}
              fetchOptions={fetchPriceLists} placeholder="Select price list" 
              style={{ background: getFieldBackground('PriceListNum') }}
            />
          </div>
          <div className="im-field im-field--header">
            <label className="im-field__label">Unit Price</label>
            <input className="im-field__input" name="Price" type="number"
              value={form.Price} onChange={handleChange} />
            <span className="im-field__unit">Primary Currency</span>
          </div>
        </div>

        <div className="im-header-flags">
          {[
            { name: "InventoryItem", label: "Inventory Item" },
            { name: "SalesItem",     label: "Sales Item" },
            { name: "PurchaseItem",  label: "Purchasing Item" },
          ].map(({ name, label }) => (
            <label key={name} className="im-checkbox-label">
              <input type="checkbox" name={name} checked={form[name] === "tYES"} onChange={handleChange} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="im-tabs">
        {visibleTabList.map((t, i) => (
          <button key={t} type="button"
            className={`im-tab${t === activeTabName ? " im-tab--active" : ""}`}
            onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>

      <div className="im-tab-panel">
        {activeTabName === YARN_COTTON_TAB && <AddOnTab form={form} onChange={handleChange} mode={mode} />}
        {activeTabName === "General"        && <GeneralTab        form={form} onChange={handleChange} onDefineManufacturer={() => setShowManufacturerSetup(true)} mode={mode} />}
        {activeTabName === "Purchasing Data" && <PurchasingTab    form={form} onChange={handleChange} fetchVendors={fetchVendors} customsGroups={customsGroups} />}
        {activeTabName === "Sales Data"      && <SalesTab         form={form} onChange={handleChange} />}
        {activeTabName === "Inventory Data"  && <InventoryTab     form={form} onChange={handleChange} stock={stock} onWarehouseChange={handleWarehouseChange} fetchWarehouses={fetchWarehouses} />}
        {activeTabName === "Planning Data"   && <PlanningTab      form={form} onChange={handleChange} />}
        {activeTabName === "Production Data" && <ProductionDataTab form={form} onChange={handleChange} />}
        {activeTabName === "Properties"      && <PropertiesTab    form={form} onChange={handleChange} />}
        {activeTabName === "Remarks"         && <RemarksTab       form={form} onChange={handleChange} />}
        {activeTabName === "Attachments"     && (
          <AttachmentsTab
            attachments={attachments}
            onAdd={addAttachments}
            onRemove={(id) => removeAttachment(attachments.find((a) => a.id === id) || { id })}
            onOpen={savedItemCode ? openAttachment : undefined}
          />
        )}
      </div>

      {showCFL && (
        <div className="im-modal-overlay" onClick={() => setShowCFL(false)}>
          <div className="im-modal im-modal--cfl" onClick={(e) => e.stopPropagation()}>
            <div className="im-modal__header">
              <span>Choose From List - Items</span>
              <button className="im-modal__close" onClick={() => setShowCFL(false)}>✕</button>
            </div>
            <div className="im-modal__body">
              {cflResults.length === 0 ? (
                <div className="im-modal__empty">No items found.</div>
              ) : (
                <table className="im-lookup-table">
                  <thead>
                    <tr>
                      <th>Item Code</th>
                      <th>Description</th>
                      <th>Item Group</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cflResults.map((item) => (
                      <tr
                        key={item.ItemCode}
                        className="im-lookup-table__row"
                        onClick={() => handleCFLSelect(item)}
                        onDoubleClick={() => handleCFLSelect(item)}
                      >
                        <td>{item.ItemCode}</td>
                        <td>{item.ItemName}</td>
                        <td>{item.ItemsGroupName || item.ItemsGroupCode || '-'}</td>
                        <td>{item.Price ? `${Number(item.Price).toFixed(2)}` : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="im-modal__footer">
              <button className="im-btn im-btn--primary" onClick={() => setShowCFL(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showItemGroupSetup && (
        <ItemGroupSetup
          onClose={() => setShowItemGroupSetup(false)}
          onSave={(group) => {
            setForm((p) => ({ ...p, ItemsGroupCode: group.code, ItemsGroupName: group.name }));
          }}
          showAlert={showAlert}
        />
      )}
      {showManufacturerSetup && (
        <ManufacturerSetup
          onClose={() => setShowManufacturerSetup(false)}
          onSave={(m) => {
            setForm((p) => ({ ...p, Manufacturer: m.code, ManufacturerName: m.name }));
          }}
          showAlert={showAlert}
        />
      )}
    </div>
  );
}

const extractSapError = (err) =>
  err.response?.data?.error?.message?.value ||
  err.response?.data?.error?.message ||
  err.response?.data?.message ||
  err.message ||
  "An error occurred.";

function buildDuplicatePayload(form, duplicateSourceItemCode, currentUser = null) {
  const payload = {
    _duplicateFromItemCode: duplicateSourceItemCode,
    ItemCode: form.ItemCode,
    ItemName: form.ItemName,
  };
  const currentUserName = String(currentUser?.fullName || currentUser?.username || "").trim();
  const currentUserCode = currentUser?.userId != null ? String(currentUser.userId).trim() : "";

  if (currentUserName) payload.U_WEBUSER = currentUserName;
  if (currentUserCode) payload.U_WEBUSERCODE = currentUserCode;
  if (form.ItemCodePrefix && form.ItemCodePrefix !== "Manual" && !Number.isNaN(Number(form.ItemCodePrefix))) {
    payload.Series = Number(form.ItemCodePrefix);
  }

  return payload;
}

function buildPayload(form, prices = [], barcodes = [], uoms = [], prefVendors = [], stock = [], currentUser = null, baseline = null) {
  const opt = (v) => v !== "" && v != null;
  const num = (v) => v !== "" && v != null && !isNaN(v) ? Number(v) : undefined;
  const currentUserName = String(currentUser?.fullName || currentUser?.username || "").trim();
  const currentUserCode = currentUser?.userId != null ? String(currentUser.userId).trim() : "";
  const p = {};
  p.ItemCode  = form.ItemCode;
  p.ItemName  = form.ItemName;
  if (currentUserName) p.U_WEBUSER = currentUserName;
  if (currentUserCode) p.U_WEBUSERCODE = currentUserCode;
  if (form.ItemCodePrefix && form.ItemCodePrefix !== "Manual" && !Number.isNaN(Number(form.ItemCodePrefix))) {
    p.Series = Number(form.ItemCodePrefix);
  }
  p.InventoryItem = form.InventoryItem || "tNO";
  p.SalesItem     = form.SalesItem     || "tNO";
  p.PurchaseItem  = form.PurchaseItem  || "tNO";
  if (form.AssetItem === "tYES") p.AssetItem = "tYES";
  if (opt(form.ForeignName))       p.ForeignName       = form.ForeignName;
  if (opt(form.ItemType))          p.ItemType          = form.ItemType;
  if (opt(form.ItemClass))         p.ItemClass         = form.ItemClass;
  if (opt(form.TreeType) && form.TreeType !== "iNotATree") p.TreeType = form.TreeType;
  if (opt(form.IsPhantom) && form.IsPhantom === "tYES")    p.IsPhantom = "tYES";
  if (opt(form.NoDiscounts))       p.NoDiscounts       = form.NoDiscounts;
  if (opt(form.SupplierCatalogNo)) p.SupplierCatalogNo = form.SupplierCatalogNo;
  if (opt(form.ItemCountryOrg))    p.ItemCountryOrg    = form.ItemCountryOrg;
  if (opt(form.VatLiable))         p.VatLiable         = form.VatLiable;
  if (opt(form.WTLiable))          p.WTLiable          = form.WTLiable;
  if (opt(form.ArTaxCode))         p.ArTaxCode         = form.ArTaxCode;
  if (opt(form.ApTaxCode))         p.ApTaxCode         = form.ApTaxCode;
  if (opt(form.ShipType))          p.ShipType          = num(form.ShipType);
  if (opt(form.Manufacturer))      p.Manufacturer      = num(form.Manufacturer);
  // Serial/batch fields omitted — can trigger SLD connectivity check on some SAP B1 versions
  p.Valid = form.Valid || "tYES";
  if (opt(form.ValidFrom))    p.ValidFrom    = form.ValidFrom;
  if (opt(form.ValidTo))      p.ValidTo      = form.ValidTo;
  if (opt(form.ValidRemarks)) p.ValidRemarks = form.ValidRemarks;
  if (opt(form.Frozen))       p.Frozen       = form.Frozen;
  if (opt(form.FrozenFrom))   p.FrozenFrom   = form.FrozenFrom;
  if (opt(form.FrozenTo))     p.FrozenTo     = form.FrozenTo;
  if (opt(form.FrozenRemarks))p.FrozenRemarks= form.FrozenRemarks;
  if (opt(form.Excisable))    p.Excisable    = form.Excisable;
  if (opt(form.GSTRelevnt))   p.GSTRelevnt   = form.GSTRelevnt;
  // GSTMaterialType is UI-only field, not sent to SAP (no corresponding field exists)
  if (opt(form.ChapterID) && form.ChapterID !== "" && form.ChapterID !== "-1") {
    p.ChapterID = String(form.ChapterID).trim();
  }
  
  // Normalize GSTTaxCategory - convert display names to SAP enum values
  if (opt(form.GSTTaxCategory)) {
    const taxCategoryMap = {
      'Regular': 'gtc_Regular',
      'Exempt': 'gtc_Exempt',
      'Nil Rated': 'gtc_NilRated',
      'NilRated': 'gtc_NilRated'
    };
    p.GSTTaxCategory = taxCategoryMap[form.GSTTaxCategory] || form.GSTTaxCategory;
  }
  
  if (num(form.CapitalGoodsOnHoldPercent)) p.CapitalGoodsOnHoldPercent = num(form.CapitalGoodsOnHoldPercent);
  if (num(form.CapitalGoodsOnHoldLimit))   p.CapitalGoodsOnHoldLimit   = num(form.CapitalGoodsOnHoldLimit);
  if (num(form.AssessableValue))           p.AssessableValue           = num(form.AssessableValue);
  if (num(form.AssVal4WTR))                p.AssVal4WTR                = num(form.AssVal4WTR);
  if (opt(form.ItemCountryOrg))            p.ItemCountryOrg            = form.ItemCountryOrg;
  // AdditionalIdentifier, ManageItemBy, and BlockMultipleReceiptsForSameBatch are UI-only fields, not sent to SAP
  ["U_Application", "U_Attribute", "U_Count", "U_CottonType", "U_SpinningProcess", "U_YarnPly"].forEach((field) => {
    if (isYarnCottonGroup(form) && opt(form[field])) p[field] = form[field];
  });
  if (opt(form.NoDiscounts))               p.NoDiscounts               = form.NoDiscounts;
  if (opt(form.ServiceCategoryEntry) && form.ServiceCategoryEntry !== "" && form.ServiceCategoryEntry !== "-1") 
    p.ServiceCategoryEntry = Number(form.ServiceCategoryEntry);
  if (opt(form.ItemsGroupCode)) { const v = num(form.ItemsGroupCode); if (v != null) p.ItemsGroupCode = v; }
  if (opt(form.BarCode))      p.BarCode = form.BarCode;
  if (num(form.UoMGroupEntry) != null) p.UoMGroupEntry = num(form.UoMGroupEntry);
  if (opt(form.Mainsupplier))           p.Mainsupplier           = form.Mainsupplier;
  if (opt(form.PurchaseUnit))           p.PurchaseUnit           = form.PurchaseUnit;
  if (num(form.PurchaseItemsPerUnit))   p.PurchaseItemsPerUnit   = num(form.PurchaseItemsPerUnit);
  if (opt(form.PurchasePackagingUnit))  p.PurchasePackagingUnit  = form.PurchasePackagingUnit;
  if (num(form.PurchaseQtyPerPackUnit)) p.PurchaseQtyPerPackUnit = num(form.PurchaseQtyPerPackUnit);
  if (num(form.PurchaseUnitLength))     p.PurchaseUnitLength     = num(form.PurchaseUnitLength);
  if (opt(form.PurchaseLengthUnit))     p.PurchaseLengthUnit     = form.PurchaseLengthUnit;
  if (num(form.PurchaseUnitWidth))      p.PurchaseUnitWidth      = num(form.PurchaseUnitWidth);
  if (opt(form.PurchaseWidthUnit))      p.PurchaseWidthUnit      = form.PurchaseWidthUnit;
  if (num(form.PurchaseUnitHeight))     p.PurchaseUnitHeight     = num(form.PurchaseUnitHeight);
  if (opt(form.PurchaseHeightUnit))     p.PurchaseHeightUnit     = form.PurchaseHeightUnit;
  if (num(form.PurchaseUnitVolume))     p.PurchaseUnitVolume     = num(form.PurchaseUnitVolume);
  if (opt(form.PurchaseVolumeUnit))     p.PurchaseVolumeUnit     = form.PurchaseVolumeUnit;
  if (num(form.PurchaseUnitWeight))     p.PurchaseUnitWeight     = num(form.PurchaseUnitWeight);
  if (opt(form.PurchaseWeightUnit))     p.PurchaseWeightUnit     = form.PurchaseWeightUnit;
  if (num(form.PurchaseUnitWeight1))    p.PurchaseUnitWeight1    = num(form.PurchaseUnitWeight1);
  if (opt(form.PurchaseWeightUnit1))    p.PurchaseWeightUnit1    = form.PurchaseWeightUnit1;
  [1,2,3,4].forEach((n) => { if (num(form[`PurchaseFactor${n}`])) p[`PurchaseFactor${n}`] = num(form[`PurchaseFactor${n}`]); });
  if (opt(form.PurchaseVATGroup))  p.PurchaseVATGroup  = form.PurchaseVATGroup;
  if (num(form.LeadTime))          p.LeadTime          = num(form.LeadTime);
  if (opt(form.ExpanseAccount))    p.ExpanseAccount    = form.ExpanseAccount;
  if (num(form.CustomsGroupCode) != null && num(form.CustomsGroupCode) !== -1) {
    p.CustomsGroupCode = num(form.CustomsGroupCode);
  }
  if (opt(form.SalesUnit))              p.SalesUnit              = form.SalesUnit;
  if (num(form.SalesItemsPerUnit))      p.SalesItemsPerUnit      = num(form.SalesItemsPerUnit);
  if (opt(form.SalesPackagingUnit))     p.SalesPackagingUnit     = form.SalesPackagingUnit;
  if (num(form.SalesQtyPerPackUnit))    p.SalesQtyPerPackUnit    = num(form.SalesQtyPerPackUnit);
  if (num(form.SalesUnitLength))        p.SalesUnitLength        = num(form.SalesUnitLength);
  if (opt(form.SalesLengthUnit))        p.SalesLengthUnit        = form.SalesLengthUnit;
  if (num(form.SalesUnitWidth))         p.SalesUnitWidth         = num(form.SalesUnitWidth);
  if (opt(form.SalesWidthUnit))         p.SalesWidthUnit         = form.SalesWidthUnit;
  if (num(form.SalesUnitHeight))        p.SalesUnitHeight        = num(form.SalesUnitHeight);
  if (opt(form.SalesHeightUnit))        p.SalesHeightUnit        = form.SalesHeightUnit;
  if (num(form.SalesUnitVolume))        p.SalesUnitVolume        = num(form.SalesUnitVolume);
  if (opt(form.SalesVolumeUnit))        p.SalesVolumeUnit        = form.SalesVolumeUnit;
  if (num(form.SalesUnitWeight))        p.SalesUnitWeight        = num(form.SalesUnitWeight);
  if (opt(form.SalesWeightUnit))        p.SalesWeightUnit        = form.SalesWeightUnit;
  if (num(form.SalesUnitWeight1))       p.SalesUnitWeight1       = num(form.SalesUnitWeight1);
  if (opt(form.SalesWeightUnit1))       p.SalesWeightUnit1       = form.SalesWeightUnit1;
  [1,2,3,4].forEach((n) => { if (num(form[`SalesFactor${n}`])) p[`SalesFactor${n}`] = num(form[`SalesFactor${n}`]); });
  if (opt(form.SalesVATGroup))          p.SalesVATGroup          = form.SalesVATGroup;
  if (opt(form.WarrantyTemplate) && String(form.WarrantyTemplate) !== "-1") {
    p.WarrantyTemplate = form.WarrantyTemplate;
  }
  if (num(form.CommissionPercent))      p.CommissionPercent      = num(form.CommissionPercent);
  if (num(form.CommissionGroup))        p.CommissionGroup        = num(form.CommissionGroup);
  if (opt(form.IncomeAccount))          p.IncomeAccount          = form.IncomeAccount;
  if (opt(form.ExemptIncomeAccount))    p.ExemptIncomeAccount    = form.ExemptIncomeAccount;
  if (opt(form.ForeignRevenuesAccount)) p.ForeignRevenuesAccount = form.ForeignRevenuesAccount;
  if (opt(form.ECRevenuesAccount))      p.ECRevenuesAccount      = form.ECRevenuesAccount;
  if (opt(form.ForeignExpensesAccount)) p.ForeignExpensesAccount = form.ForeignExpensesAccount;
  if (opt(form.ECExpensesAccount))      p.ECExpensesAccount      = form.ECExpensesAccount;
  if (opt(form.InventoryUOM))           p.InventoryUOM           = form.InventoryUOM;
  if (num(form.InventoryUoMEntry) != null && num(form.InventoryUoMEntry) !== -1) p.InventoryUoMEntry = num(form.InventoryUoMEntry);
  if (opt(form.CostAccountingMethod))   p.CostAccountingMethod   = form.CostAccountingMethod;
  if (opt(form.GLMethod))               p.GLMethod               = form.GLMethod;
  if (opt(form.DefaultWarehouse))       p.DefaultWarehouse       = form.DefaultWarehouse;
  if (num(form.MinInventory) != null)   p.MinInventory           = num(form.MinInventory);
  if (num(form.MaxInventory) != null)   p.MaxInventory           = num(form.MaxInventory);
  if (num(form.DesiredInventory) != null) p.DesiredInventory     = num(form.DesiredInventory);
  if (num(form.ProdStdCost) != null)    p.ProdStdCost            = num(form.ProdStdCost);
  if (opt(form.InCostRollup))           p.InCostRollup           = form.InCostRollup;
  if (num(form.InventoryWeight))        p.InventoryWeight        = num(form.InventoryWeight);
  if (opt(form.InventoryWeightUnit))    p.InventoryWeightUnit    = form.InventoryWeightUnit;
  if (opt(form.PlanningSystem))    p.PlanningSystem    = form.PlanningSystem;
  if (opt(form.ProcurementMethod)) p.ProcurementMethod = form.ProcurementMethod;
  if (opt(form.ComponentWarehouse)) p.ComponentWarehouse = form.ComponentWarehouse;
  if (opt(form.TypeOfAdvancedRules)) p.TypeOfAdvancedRules = form.TypeOfAdvancedRules;
  if (num(form.OrderIntervals))    p.OrderIntervals    = num(form.OrderIntervals);
  if (num(form.OrderMultiple))     p.OrderMultiple     = num(form.OrderMultiple);
  if (num(form.MinOrderQuantity))  p.MinOrderQuantity  = num(form.MinOrderQuantity);
  if (num(form.ToleranceDays))     p.ToleranceDays     = num(form.ToleranceDays);
  // SAP keeps the item's Remarks tab in OITM.UserText (SL User_Text).
  if (opt(form.User_Text)) p.User_Text = form.User_Text;
  if (opt(form.ManageStockByWarehouse)) p.ManageStockByWarehouse = form.ManageStockByWarehouse;
  if (opt(form.CreateQRCodeFrom)) p.CreateQRCodeFrom = form.CreateQRCodeFrom;
  for (let i = 1; i <= 64; i++) { if (form[`Properties${i}`] === "tYES") p[`Properties${i}`] = "tYES"; }
  // Header Price List / Unit Price is that list's row of the item prices.
  if (opt(form.PriceListNum) && num(form.Price) != null) {
    const list = Number(form.PriceListNum);
    prices = prices.some((r) => Number(r.PriceList) === list)
      ? prices.map((r) => (Number(r.PriceList) === list ? { ...r, Price: num(form.Price) } : r))
      : [...prices, { PriceList: list, Price: num(form.Price) }];
  }
  if (prices.length > 0) {
    p.ItemPrices = prices.map((r) => ({
      PriceList: r.PriceList, Price: Number(r.Price) || 0, Currency: r.Currency || null,
      AdditionalPrice1: Number(r.AdditionalPrice1) || 0, AdditionalCurrency1: r.AdditionalCurrency1 || null,
      AdditionalPrice2: Number(r.AdditionalPrice2) || 0, AdditionalCurrency2: r.AdditionalCurrency2 || null,
      BasePriceList: r.BasePriceList, Factor: Number(r.Factor) || 1,
    }));
  }
  if (barcodes.filter((b) => b.Barcode).length > 0) {
    p.ItemBarCodeCollection = barcodes.filter((b) => b.Barcode).map((b) => ({ Barcode: b.Barcode, UoMEntry: b.UoMEntry ? Number(b.UoMEntry) : null, Quantity: Number(b.Quantity) || 1 }));
  }
  if (prefVendors.filter((v) => v.VendorCode).length > 0) {
    p.ItemPreferredVendors = prefVendors
      .filter((v) => v.VendorCode)
      .map((v) => ({ BPCode: v.VendorCode }));
  }
  const warehouseRows = stock
    .filter((row) => row.WarehouseCode)
    .map((row) => {
      const warehouse = { WarehouseCode: row.WarehouseCode };
      if (opt(row.Locked)) warehouse.Locked = row.Locked;
      if (num(row.MinimalStock) != null) warehouse.MinimalStock = num(row.MinimalStock);
      if (num(row.MaximalStock) != null) warehouse.MaximalStock = num(row.MaximalStock);
      if (num(row.MinimalOrder) != null) warehouse.MinimalOrder = num(row.MinimalOrder);
      return warehouse;
    })
    .filter((row) => Object.keys(row).length > 1);
  if (warehouseRows.length > 0) p.ItemWarehouseInfoCollection = warehouseRows;
  if (baseline) Object.assign(p, changedFieldsNotSent(form, p, baseline));
  return p;
}


