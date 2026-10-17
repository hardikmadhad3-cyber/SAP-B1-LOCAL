import React, { useState, useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import "../item-master/styles/itemMaster.css";
import "./styles/warehouse.css";
import FindResultsModal from "../../components/FindResultsModal";
import GeneralTab from "./components/GeneralTab";
import AccountingTab from "./components/AccountingTab";
import {
  createWarehouse,
  getWarehouse,
  updateWarehouse,
  searchWarehouses,
  fetchWHLocations,
  fetchWHBusinessPlaces,
} from "../../api/warehouseApi";

const TABS = ["General", "Accounting"];

const EMPTY_FORM = {
  // Header
  WarehouseCode: "",
  WarehouseName: "",

  // General Tab - Checkboxes
  Inactive: "tNO",
  DropShip: "tNO",
  Nettable: "tYES",
  Excisable: "tNO",
  EnableBinLocations: "tNO",

  // General Tab - Dropdowns
  Location: "",
  ShipToName: "",
  BusinessPlaceID: "",

  // General Tab - Address Fields
  AddressType: "",
  Street: "",
  StreetNo: "",
  Block: "",
  BuildingFloorRoom: "",
  ZipCode: "",
  City: "",
  County: "",
  Country: "",
  State: "",

  // General Tab - Other Fields
  GlobalLocationNumber: "",
  AddressName2: "",
  AddressName3: "",

  // Accounting Tab
  InventoryAccount: "",
  CostOfGoodsSoldAccount: "",
  TransferAccount: "",
  PriceDifferencesAccount: "",
  ReturnsAccount: "",
  DecreasingAccount: "",
  IncreasingAccount: "",
  PurchaseAccount: "",
  PurchaseReturnAccount: "",
  PurchaseOffsetAccount: "",
  WipAccount: "",
  ExpenseClearingAccount: "",
  TaxGroup: "",
};

function buildPayload(form) {
  const payload = {
    WarehouseCode: form.WarehouseCode,
    WarehouseName: form.WarehouseName,
    Inactive: form.Inactive || "tNO",
    DropShip: form.DropShip || "tNO",
    Nettable: form.Nettable || "tYES",
    Excisable: form.Excisable || "tNO",
    EnableBinLocations: form.EnableBinLocations || "tNO",
  };

  // Optional fields — using exact SAP field names. An emptied field is sent as null
  // so the stored value is cleared (it used to be left out and stay unchanged).
  payload.Location = form.Location ? Number(form.Location) : null;
  payload.WHShipToName = form.ShipToName ? form.ShipToName : null;
  if (form.BusinessPlaceID && Number(form.BusinessPlaceID) > 0) payload.BusinessPlaceID = Number(form.BusinessPlaceID);
  payload.AddressType = form.AddressType ? form.AddressType : null;
  payload.Street = form.Street ? form.Street : null;
  payload.StreetNo = form.StreetNo ? form.StreetNo : null;
  payload.Block = form.Block ? form.Block : null;
  payload.BuildingFloorRoom = form.BuildingFloorRoom ? form.BuildingFloorRoom : null;
  payload.ZipCode = form.ZipCode ? form.ZipCode : null;
  payload.City = form.City ? form.City : null;
  payload.County = form.County ? form.County : null;
  payload.Country = form.Country ? form.Country : null;
  payload.State = form.State ? form.State : null;
  payload.GlobalLocationNumber = form.GlobalLocationNumber ? form.GlobalLocationNumber : null;
  payload.AddressName2 = form.AddressName2 ? form.AddressName2 : null;
  payload.AddressName3 = form.AddressName3 ? form.AddressName3 : null;

  // Accounting fields — using exact SAP field names
  payload.StockAccount = form.InventoryAccount ? form.InventoryAccount : null;
  payload.CostOfGoodsSold = form.CostOfGoodsSoldAccount ? form.CostOfGoodsSoldAccount : null;
  payload.TransfersAcc = form.TransferAccount ? form.TransferAccount : null;
  payload.PriceDifferencesAccount = form.PriceDifferencesAccount ? form.PriceDifferencesAccount : null;
  payload.ReturningAccount = form.ReturnsAccount ? form.ReturnsAccount : null;
  payload.DecreasingAccount = form.DecreasingAccount ? form.DecreasingAccount : null;
  payload.IncreasingAcc = form.IncreasingAccount ? form.IncreasingAccount : null;
  payload.PurchaseAccount = form.PurchaseAccount ? form.PurchaseAccount : null;
  payload.PurchaseReturningAccount = form.PurchaseReturnAccount ? form.PurchaseReturnAccount : null;
  payload.PurchaseOffsetAccount = form.PurchaseOffsetAccount ? form.PurchaseOffsetAccount : null;
  payload.WIPMaterialAccount = form.WipAccount ? form.WipAccount : null;
  payload.ExpensesClearingAccount = form.ExpenseClearingAccount ? form.ExpenseClearingAccount : null;
  payload.TaxGroup = form.TaxGroup ? form.TaxGroup : null;

  return payload;
}

function mapSapToForm(data) {
  return {
    ...EMPTY_FORM,
    WarehouseCode: data.WarehouseCode || "",
    WarehouseName: data.WarehouseName || "",
    Inactive: data.Inactive || "tNO",
    DropShip: data.DropShip || "tNO",
    Nettable: data.Nettable || "tYES",
    Excisable: data.Excisable || "tNO",
    EnableBinLocations: data.EnableBinLocations || "tNO",
    Location: data.Location || "",
    ShipToName: data.WHShipToName || "",
    BusinessPlaceID: data.BusinessPlaceID || "",
    AddressType: data.AddressType || "",
    Street: data.Street || "",
    StreetNo: data.StreetNo || "",
    Block: data.Block || "",
    BuildingFloorRoom: data.BuildingFloorRoom || "",
    ZipCode: data.ZipCode || "",
    City: data.City || "",
    County: data.County || "",
    Country: data.Country || "",
    State: data.State || "",
    GlobalLocationNumber: data.GlobalLocationNumber || "",
    AddressName2: data.AddressName2 || "",
    AddressName3: data.AddressName3 || "",
    // Accounting — map SAP names to frontend names
    InventoryAccount: data.StockAccount || "",
    CostOfGoodsSoldAccount: data.CostOfGoodsSold || "",
    TransferAccount: data.TransfersAcc || "",
    PriceDifferencesAccount: data.PriceDifferencesAccount || "",
    ReturnsAccount: data.ReturningAccount || "",
    DecreasingAccount: data.DecreasingAccount || "",
    IncreasingAccount: data.IncreasingAcc || "",
    PurchaseAccount: data.PurchaseAccount || "",
    PurchaseReturnAccount: data.PurchaseReturningAccount || "",
    PurchaseOffsetAccount: data.PurchaseOffsetAccount || "",
    WipAccount: data.WIPMaterialAccount || "",
    ExpenseClearingAccount: data.ExpensesClearingAccount || "",
    TaxGroup: data.TaxGroup || "",
  };
}


export default function WarehouseModule() {
  const location = useLocation();
  const [tab, setTab] = useState(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isUpdateMode, setIsUpdateMode] = useState(false);
  const [mode, setMode] = useState("add");
  const [findResults, setFindResults] = useState([]);
  const [showFindResults, setShowFindResults] = useState(false);

  // Lookup data
  const [locations, setLocations] = useState([]);
  const [businessPlaces, setBusinessPlaces] = useState([]);

  useEffect(() => {
    console.log('Loading warehouse lookup data...');
    loadLookupData();
  }, []);

  const loadLookupData = async () => {
    try {
      const [locationsData, businessPlacesData] = await Promise.all([
        fetchWHLocations().catch(err => {
          console.error("Failed to load locations:", err);
          return [];
        }),
        fetchWHBusinessPlaces().catch(err => {
          console.error("Failed to load business places:", err);
          return [];
        }),
      ]);
      setLocations(locationsData);
      setBusinessPlaces(businessPlacesData);
    } catch (err) {
      console.error("Failed to load lookup data:", err);
    }
  };

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (checked ? "tYES" : "tNO") : value,
    }));
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setTab(0);
    setAlert(null);
    setIsUpdateMode(false);
    setMode("add");
    setFindResults([]);
    setShowFindResults(false);
  };

  const loadWarehouse = async (warehouseCode) => {
    const data = await getWarehouse(warehouseCode);
    setForm(mapSapToForm(data));
    setIsUpdateMode(true);
    setMode("update");
    showAlert("success", `"${data.WarehouseCode}" loaded.`);
  };

  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams(location.search);
    const routedWarehouseCode = String(
      location.state?.warehouseCode
      || location.state?.whsCode
      || params.get("warehouseCode")
      || params.get("whsCode")
      || "",
    ).trim();

    if (!routedWarehouseCode) {
      return () => {
        ignore = true;
      };
    }

    const loadRoutedWarehouse = async () => {
      setLoading(true);
      try {
        const data = await getWarehouse(routedWarehouseCode);
        if (ignore) return;
        setForm(mapSapToForm(data));
        setIsUpdateMode(true);
        setMode("update");
        setTab(0);
        setFindResults([]);
        setShowFindResults(false);
        showAlert("success", `"${data.WarehouseCode}" loaded.`);
      } catch (err) {
        if (!ignore) {
          showAlert("error", err.response?.data?.message || err.message || `Could not load warehouse "${routedWarehouseCode}".`);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    loadRoutedWarehouse();

    return () => {
      ignore = true;
    };
  }, [location.search, location.state]);

  const validateForm = () => {
    if (!form.WarehouseCode.trim()) {
      showAlert("error", "Warehouse Code is required.");
      return false;
    }
    if (form.WarehouseCode.length > 8) {
      showAlert("error", "Warehouse Code cannot exceed 8 characters.");
      return false;
    }
    if (!form.WarehouseName.trim()) {
      showAlert("error", "Warehouse Name is required.");
      return false;
    }
    if (form.WarehouseName.length > 100) {
      showAlert("error", "Warehouse Name cannot exceed 100 characters.");
      return false;
    }
    if (form.GlobalLocationNumber && !/^[0-9]{13}$/.test(form.GlobalLocationNumber)) {
      showAlert("error", "GLN must be exactly 13 digits.");
      return false;
    }
    return true;
  };

  const handleAdd = async () => {
    if (!validateForm()) return;

    // Check for duplicate
    try {
      await getWarehouse(form.WarehouseCode.trim());
      showAlert("error", "Warehouse Code already exists.");
      return;
    } catch (err) {
      // Expected - warehouse doesn't exist, proceed with creation
    }

    setLoading(true);
    try {
      await createWarehouse(buildPayload(form));
      showAlert("success", `Warehouse "${form.WarehouseCode}" created successfully.`);
      setIsUpdateMode(true);
      setMode("update");
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to create warehouse.");
    } finally {
      setLoading(false);
    }
  };

  const handleFind = async () => {
    const code = form.WarehouseCode.trim();
    const query = code || form.WarehouseName.trim();
    if (!query) {
      showAlert("error", "Enter a Warehouse Code or Warehouse Name to search.");
      return;
    }
    setLoading(true);
    try {
      if (code) {
        try {
          await loadWarehouse(code);
          return;
        } catch (_) {}
      }

      const results = await searchWarehouses(query, 100);
      if (results.length === 0) {
        showAlert("error", "No matching warehouses found.");
      } else if (results.length === 1) {
        await loadWarehouse(results[0].WarehouseCode);
      } else {
        setFindResults(results);
        setShowFindResults(true);
      }
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Warehouse search failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleFindResultSelect = async (row) => {
    setShowFindResults(false);
    setLoading(true);
    try {
      await loadWarehouse(row.WarehouseCode);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to load warehouse.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!validateForm()) return;
    if (!form.WarehouseCode.trim()) return;

    setLoading(true);
    try {
      await updateWarehouse(form.WarehouseCode.trim(), buildPayload(form));
      showAlert("success", `"${form.WarehouseCode}" updated successfully.`);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to update.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (mode === "add") return handleAdd();
    if (mode === "update") return handleUpdate();
    if (mode === "find") return handleFind();
  };

  return (
    <div className="im-page">
      {/* Toolbar */}
      <div className="im-toolbar">
        <span className="im-toolbar__title">Warehouses - Setup</span>
        <span className={`im-mode-badge im-mode-badge--${mode}`}>
          {mode === "add" ? "Add Mode" : mode === "find" ? "Find Mode" : "Update Mode"}
        </span>
        <button className="im-btn im-btn--primary" onClick={handleSave} disabled={loading}>
          {loading ? "..." : mode === "find" ? "Find" : mode === "add" ? "Add" : "Update"}
        </button>
        <button className="im-btn" onClick={() => { setMode("add"); resetForm(); }}>
          New
        </button>
        <button className="im-btn" onClick={() => { setMode("find"); resetForm(); }}>
          Find
        </button>
        {mode === "update" && (
          <button className="im-btn im-btn--danger" onClick={resetForm}>
            Cancel
          </button>
        )}
      </div>

      {alert && (
        <div className={`im-alert im-alert--${alert.type}`}>{alert.msg}</div>
      )}

      {/* Header Fields */}
      <div className="im-header-card">
        <div className="im-field-grid">
          <div className="im-field">
            <label className="im-field__label">Warehouse Code*</label>
            <input
              className="im-field__input"
              name="WarehouseCode"
              value={form.WarehouseCode}
              onChange={handleChange}
              readOnly={isUpdateMode}
              maxLength={8}
              autoFocus
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Warehouse Name*</label>
            <input
              className="im-field__input"
              name="WarehouseName"
              value={form.WarehouseName}
              onChange={handleChange}
              maxLength={100}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="im-tabs">
        {TABS.map((t, i) => (
          <button
            key={t}
            type="button"
            className={`im-tab${tab === i ? " im-tab--active" : ""}`}
            onClick={() => setTab(i)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="im-tab-panel">
        {tab === 0 && (
          <GeneralTab
            form={form}
            onChange={handleChange}
            locations={locations}
            businessPlaces={businessPlaces}
          />
        )}
        {tab === 1 && (
          <AccountingTab
            form={form}
            onChange={handleChange}
          />
        )}
      </div>

      <FindResultsModal
        open={showFindResults}
        title="Warehouse Search Results"
        columns={[
          { key: "WarehouseCode", label: "Code" },
          { key: "WarehouseName", label: "Warehouse Name" },
          { key: "City", label: "City" },
          { key: "Country", label: "Country" },
        ]}
        rows={findResults}
        getRowKey={(row) => row.WarehouseCode}
        onClose={() => setShowFindResults(false)}
        onSelect={handleFindResultSelect}
      />
    </div>
  );
}
