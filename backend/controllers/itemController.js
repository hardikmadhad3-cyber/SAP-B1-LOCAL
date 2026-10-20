const itemService = require("../services/itemService");
const hsnCodeDbService = require("../services/hsnCodeDbService");

// ── CRUD ──────────────────────────────────────────────────────────────────────

const normalizeGSTChapterID = async (data) => {
  if (!Object.prototype.hasOwnProperty.call(data, "ChapterID")) {
    return { ok: true };
  }

  const rawChapterID = String(data.ChapterID ?? "").trim();
  if (!rawChapterID || rawChapterID === "-1") {
    data.ChapterID = "";
    return { ok: true };
  }

  const absEntry = await hsnCodeDbService.resolveHSNCodeToAbsEntry(rawChapterID);
  if (absEntry == null) {
    return {
      ok: false,
      message: "Invalid HSN/SAC Code. Select a valid code from the list.",
    };
  }

  data.ChapterID = absEntry;
  return { ok: true };
};

const omitUnsetCreateReferences = (data) => {
  if (Number(data.CustomsGroupCode) === -1) {
    delete data.CustomsGroupCode;
  }
};

const getDuplicateSourceItemCode = (data = {}) =>
  String(
    data._duplicateFromItemCode
      || data.duplicateFromItemCode
      || data.DuplicateFromItemCode
      || ""
  ).trim();

const validateItemCodeFormatValue = (itemCode) => {
  if (/[\u0000-\u001F\u007F]/.test(itemCode)) {
    return "Item Code cannot contain control characters.";
  }
  if (itemCode.length < 3) {
    return "Item Code must be at least 3 characters long.";
  }
  if (itemCode.length > 50) {
    return "Item Code cannot exceed 50 characters.";
  }
  return "";
};

const sendCreateItemError = (res, err) => {
  const sapError = err.response?.data?.error?.message?.value
    || err.response?.data?.error?.message
    || err.message;
  const isHangUp = err.code === "ECONNRESET" || err.code === "EPIPE" || err.message?.includes("socket hang up");
  console.error("[SAP createItem error]", {
    message: sapError,
    code: err.code,
    status: err.response?.status,
    response: err.response?.data,
    causeMessage: err.cause?.message,
    causeCode: err.cause?.code,
  });
  res.status(err.response?.status || (isHangUp ? 502 : 500)).json({
    message: isHangUp
      ? "SAP server closed the connection. The payload may contain an invalid field value. Check server logs."
      : sapError,
  });
};

const createItem = async (req, res) => {
  const data = req.body;
  const duplicateSourceItemCode = getDuplicateSourceItemCode(data);

  if (duplicateSourceItemCode) {
    const itemCode = String(data.ItemCode || "").trim();
    if (!itemCode) {
      return res.status(400).json({ message: "ItemCode is required." });
    }

    const itemCodeFormatMessage = validateItemCodeFormatValue(itemCode);
    if (itemCodeFormatMessage) {
      return res.status(400).json({ message: itemCodeFormatMessage });
    }

    try {
      const result = await itemService.createItem(data);
      return res.status(201).json(result);
    } catch (err) {
      return sendCreateItemError(res, err);
    }
  }

  omitUnsetCreateReferences(data);

  const hsnNormalization = await normalizeGSTChapterID(data);
  if (!hsnNormalization.ok) {
    return res.status(400).json({ message: hsnNormalization.message });
  }
  
  // === Basic Required Fields ===
  if (!data.ItemCode || !data.ItemCode.trim()) {
    return res.status(400).json({ message: "ItemCode is required." });
  }
  if (!data.ItemName || !data.ItemName.trim()) {
    return res.status(400).json({ message: "ItemName is required." });
  }
  
  // === SAP B1 Mandatory Fields ===
  if (!data.ItemsGroupCode || data.ItemsGroupCode === "") {
    return res.status(400).json({ message: "Item Group is required." });
  }
  
  // UoM Group validation - required for inventory items
  if (data.InventoryItem === 'tYES' && (!data.UoMGroupEntry || data.UoMGroupEntry === "")) {
    return res.status(400).json({ message: "UoM Group is required for inventory items." });
  }
  
  // Sales Item validations - ItemPrices collection is used instead of a single PriceListNum field
  // The UI Price List selection is handled via ItemPrices collection
  
  // Purchase Item validations
  if (data.PurchaseItem === 'tYES') {
    // Preferred vendor is recommended but not mandatory
    if (data.Mainsupplier && data.Mainsupplier.trim() === "") {
      data.Mainsupplier = ""; // Clear empty values
    }
  }
  
  // Asset Item validations
  if (data.AssetItem === 'tYES') {
    if (!data.IncomeAccount || data.IncomeAccount === "") {
      return res.status(400).json({ message: "Income Account is required for asset items." });
    }
  }
  
  // === GST Validations ===
  if (data.GSTRelevnt === 'tYES') {
    const chapterID = String(data.ChapterID || "").trim();
    if (!chapterID || chapterID === "" || chapterID === "-1") {
      return res.status(400).json({ message: "HSN/SAC Code is required when GST is enabled." });
    }
    if (!data.GSTTaxCategory || data.GSTTaxCategory === "") {
      return res.status(400).json({ message: "GST Tax Category is required when GST is enabled." });
    }
  }
  
  // === Item Type and Class Validation ===
  if (data.ItemType === 'itItems' && !data.ItemClass) {
    data.ItemClass = 'itcMaterial'; // Default for material items
  }
  
  // === Date Range Validations ===
  if (data.ValidFrom && data.ValidTo) {
    const validFrom = new Date(data.ValidFrom);
    const validTo = new Date(data.ValidTo);
    if (validFrom > validTo) {
      return res.status(400).json({ message: "Valid From date cannot be after Valid To date." });
    }
  }
  
  if (data.FrozenFrom && data.FrozenTo) {
    const frozenFrom = new Date(data.FrozenFrom);
    const frozenTo = new Date(data.FrozenTo);
    if (frozenFrom > frozenTo) {
      return res.status(400).json({ message: "Frozen From date cannot be after Frozen To date." });
    }
  }
  
  // === Numeric Range Validations ===
  // Stop at the first invalid value (the response must not be followed by a save).
  const negative = [
    ["CommissionPercent", "Commission Percent"], ["MinInventory", "Minimum Inventory"],
    ["MaxInventory", "Maximum Inventory"], ["DesiredInventory", "Desired Inventory"],
    ["OrderMultiple", "Order Multiple"], ["MinOrderQuantity", "Minimum Order Quantity"],
  ].find(([key]) => data[key] != null && data[key] !== "" && (isNaN(data[key]) || parseFloat(data[key]) < 0));
  if (negative) return res.status(400).json({ message: `${negative[1]} must be a positive number.` });
  
  // === UoM Consistency Validation ===
  const validateUoMConsistency = () => {
    const purchasingUoM = data.DefaultPurchasingUoMEntry;
    const salesUoM = data.DefaultSalesUoMEntry;
    const inventoryUoM = data.InventoryUoMEntry;
    
    if (purchasingUoM && salesUoM && purchasingUoM !== salesUoM) {
      // Warning only - different UoMs are allowed but should be intentional
      console.warn(`[Item Validation] Purchasing UoM (${purchasingUoM}) differs from Sales UoM (${salesUoM})`);
    }
  };
  validateUoMConsistency();
  
  // === Item Code Format Validation ===
  const validateItemCodeFormat = () => {
    const itemCode = data.ItemCode.trim();
    
    // Check for valid characters (alphanumeric, hyphens, underscores)
    const itemCodeFormatMessage = validateItemCodeFormatValue(itemCode);
    if (itemCodeFormatMessage) {
      return res.status(400).json({ message: itemCodeFormatMessage });
    }
  };
  validateItemCodeFormat();
  
  try {
    const result = await itemService.createItem(data);
    res.status(201).json(result);
  } catch (err) {
    sendCreateItemError(res, err);
  }
};

const generateItemCode = async (req, res) => {
  try {
    const { prefix } = req.query;
    if (!prefix || prefix === "Manual") {
      return res.json({ itemCode: "" });
    }

    res.json(await itemService.generateItemCode(prefix));
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

const checkItemCodeExists = async (req, res) => {
  const { itemCode } = req.params;
  try {
    res.json(await itemService.checkItemCodeExists(itemCode));
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

const getItem = async (req, res) => {
  try {
    res.json(await itemService.getItem(req.params.itemCode));
  } catch (err) {
    const sapError = err.response?.data?.error?.message?.value
      || err.response?.data?.error?.message
      || err.message;
    res.status(err.response?.status || 500).json({ message: sapError });
  }
};

const updateItem = async (req, res) => {
  const { itemCode } = req.params;
  const data = req.body;

  const hsnNormalization = await normalizeGSTChapterID(data);
  if (!hsnNormalization.ok) {
    return res.status(400).json({ message: hsnNormalization.message });
  }
  
  // === Basic Required Fields ===
  if (!data.ItemName || !data.ItemName.trim()) {
    return res.status(400).json({ message: "ItemName is required." });
  }
  
  // === SAP B1 Mandatory Fields ===
  if (data.ItemsGroupCode !== undefined && data.ItemsGroupCode === "") {
    return res.status(400).json({ message: "Item Group cannot be empty." });
  }
  
  // UoM Group validation - required for inventory items
  if (data.InventoryItem === 'tYES' && data.UoMGroupEntry !== undefined && data.UoMGroupEntry === "") {
    return res.status(400).json({ message: "UoM Group is required for inventory items." });
  }
  
  // Sales Item validations - ItemPrices collection is used instead of a single PriceListNum field
  // The UI Price List selection is handled via ItemPrices collection
  
  // Asset Item validations
  if (data.AssetItem === 'tYES') {
    if (data.IncomeAccount !== undefined && data.IncomeAccount === "") {
      return res.status(400).json({ message: "Income Account is required for asset items." });
    }
  }
  
  // === GST Validations ===
  if (data.GSTRelevnt === 'tYES') {
    if (data.ChapterID !== undefined) {
      const chapterID = String(data.ChapterID || "").trim();
      if (chapterID === "" || chapterID === "-1") {
        return res.status(400).json({ message: "HSN/SAC Code is required when GST is enabled." });
      }
    }
    if (data.GSTTaxCategory !== undefined && data.GSTTaxCategory === "") {
      return res.status(400).json({ message: "GST Tax Category is required when GST is enabled." });
    }
  }
  
  // === Date Range Validations ===
  if (data.ValidFrom && data.ValidTo) {
    const validFrom = new Date(data.ValidFrom);
    const validTo = new Date(data.ValidTo);
    if (validFrom > validTo) {
      return res.status(400).json({ message: "Valid From date cannot be after Valid To date." });
    }
  }
  
  if (data.FrozenFrom && data.FrozenTo) {
    const frozenFrom = new Date(data.FrozenFrom);
    const frozenTo = new Date(data.FrozenTo);
    if (frozenFrom > frozenTo) {
      return res.status(400).json({ message: "Frozen From date cannot be after Frozen To date." });
    }
  }
  
  // === Numeric Range Validations ===
  // Stop at the first invalid value (the response must not be followed by a save).
  const negative = [
    ["CommissionPercent", "Commission Percent"], ["MinInventory", "Minimum Inventory"],
    ["MaxInventory", "Maximum Inventory"], ["DesiredInventory", "Desired Inventory"],
    ["OrderMultiple", "Order Multiple"], ["MinOrderQuantity", "Minimum Order Quantity"],
  ].find(([key]) => data[key] != null && data[key] !== "" && (isNaN(data[key]) || parseFloat(data[key]) < 0));
  if (negative) return res.status(400).json({ message: `${negative[1]} must be a positive number.` });
  
  // === UoM Consistency Validation ===
  const validateUoMConsistency = () => {
    const purchasingUoM = data.DefaultPurchasingUoMEntry;
    const salesUoM = data.DefaultSalesUoMEntry;
    const inventoryUoM = data.InventoryUoMEntry;
    
    if (purchasingUoM && salesUoM && purchasingUoM !== salesUoM) {
      // Warning only - different UoMs are allowed but should be intentional
      console.warn(`[Item Validation] Purchasing UoM (${purchasingUoM}) differs from Sales UoM (${salesUoM})`);
    }
  };
  validateUoMConsistency();
  
  try {
    const result = await itemService.updateItem(itemCode, data);
    res.json(result);
  } catch (err) {
    const sapError = err.response?.data?.error?.message?.value
      || err.response?.data?.error?.message
      || err.message;
    const isHangUp = err.code === "ECONNRESET" || err.code === "EPIPE" || err.message?.includes("socket hang up");
    console.error("[SAP updateItem error]", {
      message: sapError,
      code: err.code,
      status: err.response?.status,
      response: err.response?.data,
      causeMessage: err.cause?.message,
      causeCode: err.cause?.code,
    });
    res.status(err.response?.status || (isHangUp ? 502 : 500)).json({
      message: isHangUp
        ? "SAP server closed the connection. The payload may contain an invalid field value. Check server logs."
        : sapError,
    });
  }
};

const searchItems = async (req, res) => {
  try {
    const { query = "", top = 50, skip = 0 } = req.query;
    res.json(await itemService.searchItems(query, Number(top), Number(skip)));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Search failed." });
  }
};

const getRecentItemCodes = async (req, res) => {
  try {
    res.json(await itemService.getRecentItemCodes(req.query.query || ""));
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    console.error("[Item getRecentItemCodes error]", msg);
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

// ── Prices ────────────────────────────────────────────────────────────────────

const getItemPrices = async (req, res) => {
  try {
    res.json(await itemService.getItemPrices(req.params.itemCode));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Failed to load prices." });
  }
};

// ── Warehouse stock ───────────────────────────────────────────────────────────

const getItemStock = async (req, res) => {
  try {
    res.json(await itemService.getItemStock(req.params.itemCode));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Failed to load stock." });
  }
};

// ── Lookup endpoints ──────────────────────────────────────────────────────────

const lookupItemGroups = async (req, res) => {
  try {
    res.json(await itemService.getItemGroups(req.query.query || ""));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Failed to load item groups." });
  }
};

const lookupHSNCodes = async (req, res) => {
  try {
    res.json(await itemService.getHSNCodes(req.query.query || ""));
  } catch (err) {
    console.error('[HSN Lookup Global Error]', err.message);
    res.json([]);
  }
};

const createItemGroup = async (req, res) => {
  try {
    const data = req.body;
    if (!data.GroupName) return res.status(400).json({ message: "Group Name is required." });

    res.json(await itemService.createItemGroup(data));
  } catch (err) {
    const sapError = err.response?.data?.error?.message?.value
      || err.response?.data?.error?.message
      || err.message;
    res.status(err.response?.status || 500).json({ message: sapError });
  }
};

const lookupManufacturers = async (req, res) => {
  try {
    res.json(await itemService.getManufacturers(req.query.query || ""));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Failed to load manufacturers." });
  }
};

const createManufacturer = async (req, res) => {
  try {
    const { ManufacturerName } = req.body;
    console.log('[Controller] Creating manufacturer:', ManufacturerName);
    if (!ManufacturerName) return res.status(400).json({ message: "Manufacturer Name is required." });
    const result = await itemService.createManufacturer({ ManufacturerName });
    console.log('[Controller] SAP response:', result);
    res.json(result);
  } catch (err) {
    const sapError = err.response?.data?.error?.message?.value
      || err.response?.data?.error?.message
      || err.message;
    console.error('[Controller] Error creating manufacturer:', sapError);
    if (err.response) {
      console.error('[Controller] SAP Error Body:', JSON.stringify(err.response.data));
    }
    res.status(err.response?.status || 500).json({ message: sapError });
  }
};

const lookupPriceLists = async (req, res) => {
  try {
    res.json(await itemService.getPriceLists(req.query.query || ""));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Failed to load price lists." });
  }
};

const lookupVendors = async (req, res) => {
  try {
    res.json(await itemService.getVendors(req.query.query || ""));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Failed to load vendors." });
  }
};

const lookupWarehouses = async (req, res) => {
  try {
    console.log('Warehouse lookup called with query:', req.query.query);
    const warehouses = await itemService.getWarehouses(req.query.query || "");
    console.log('Warehouses found:', warehouses);
    res.json(warehouses);
  } catch (error) {
    console.error('Error in lookupWarehouses:', error);
    res.status(500).json({ error: 'Failed to fetch warehouses' });
  }
};

const lookupGLAccounts = async (req, res) => {
  try {
    res.json(await itemService.getGLAccounts(req.query.query || ""));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Failed to load G/L accounts." });
  }
};

// ── Item Properties (QryGroup names from SAP ItemProperties) ─────────────────

const lookupUoMGroups = async (req, res) => {
  try {
    res.json(await itemService.getUoMGroups(req.query.query || ""));
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: err.message || "Failed to load UoM groups." });
  }
};

const lookupCustomsGroups = async (req, res) => {
  try {
    res.json(await itemService.getCustomsGroups(req.query.query || ""));
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value
      || err.response?.data?.error?.message
      || err.message;
    res.status(err.response?.status || 500).json({ message: msg || "Failed to load customs groups." });
  }
};

const lookupItemProperties = async (req, res) => {
  try {
    res.json(await itemService.getItemProperties());
  } catch (err) {
    const sapError = err.response?.data?.error?.message?.value
      || err.response?.data?.error?.message
      || err.message;
    res.status(err.response?.status || 500).json({ message: sapError });
  }
};

// ── Item Code Prefixes ────────────────────────────────────────────────────────
const lookupItemCodePrefixes = async (req, res) => {
  try {
    const prefixes = await itemService.getItemCodePrefixes();
    res.json(prefixes);
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

// ── Attachments ───────────────────────────────────────────────────────────────
// Per company and item (uploads/items/<companyId>/<item>/), shared with BOMs and production orders.
const itemAttachments = require("./attachmentController").makeAttachmentHandlers({ kind: "items", param: "itemCode", baseUrl: "/items" });
const getAttachments = itemAttachments.list;
const uploadAttachment = itemAttachments.upload;
const deleteAttachment = itemAttachments.remove;
const serveAttachment = itemAttachments.serve;

module.exports = {
  createItem, getItem, updateItem, searchItems, getRecentItemCodes,
  generateItemCode, checkItemCodeExists,
  getItemPrices, getItemStock,
  lookupItemGroups, createItemGroup, lookupManufacturers, createManufacturer, lookupPriceLists, lookupVendors, lookupWarehouses, lookupGLAccounts,
  lookupHSNCodes,
  lookupUoMGroups, lookupCustomsGroups, lookupItemProperties, lookupItemCodePrefixes,
  getAttachments, uploadAttachment, deleteAttachment, serveAttachment,
};
