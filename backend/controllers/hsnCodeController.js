const hsnCodeDb = require("../services/hsnCodeDbService");

/**
 * Get all HSN Codes from SAP B1 OCHP table via ODBC
 * GET /api/hsn-codes
 */
const getHSNCodes = async (req, res) => {
  try {
    const { query = "", top = 100, skip = 0 } = req.query;
    
    // Use ODBC/Direct SQL for GET operations
    const hsnCodes = await hsnCodeDb.getHSNCodes(
      query,
      parseInt(top) || 100,
      parseInt(skip) || 0
    );
    
    res.json(hsnCodes);
  } catch (err) {
    const msg = err.message || "Failed to fetch HSN codes";
    console.error("[HSN Code Controller] getHSNCodes error:", msg, err);
    res.status(500).json({ 
      message: msg,
      detail: { error: { message: msg } }
    });
  }
};

/**
 * Get all India SAC service codes from SAP B1 OSAC table via ODBC
 * GET /api/hsn-codes/sac
 */
const getSACCodes = async (req, res) => {
  try {
    const { query = "", top = 5000, skip = 0 } = req.query;

    const sacCodes = await hsnCodeDb.getSACCodes(
      query,
      parseInt(top) || 5000,
      parseInt(skip) || 0
    );

    res.json(sacCodes);
  } catch (err) {
    const msg = err.message || "Failed to fetch SAC codes";
    console.error("[HSN Code Controller] getSACCodes error:", msg, err);
    res.status(500).json({
      message: msg,
      detail: { error: { message: msg } }
    });
  }
};

/**
 * Get single HSN Code by ChapterID via ODBC
 * GET /api/hsn-codes/:code
 */
const getHSNCode = async (req, res) => {
  try {
    const { code } = req.params;
    
    // Use ODBC/Direct SQL for GET operations
    const hsnCode = await hsnCodeDb.getHSNCode(code);
    
    if (!hsnCode) {
      return res.status(404).json({ message: "HSN Code not found" });
    }
    
    res.json(hsnCode);
  } catch (err) {
    const msg = err.message || "Failed to fetch HSN code";
    console.error("[HSN Code Controller] getHSNCode error:", msg, err);
    res.status(500).json({ message: msg });
  }
};

/**
 * Get HSN Code from Item Master via ODBC
 * GET /api/hsn-codes/item/:itemCode
 */
const getHSNCodeFromItem = async (req, res) => {
  try {
    const { itemCode } = req.params;
    
    // Use ODBC/Direct SQL to get HSN from item
    const hsnData = await hsnCodeDb.getHSNCodeFromItem(itemCode);
    
    res.json(hsnData);
  } catch (err) {
    const msg = err.message || "Failed to fetch HSN code from item";
    console.error("[HSN Code Controller] getHSNCodeFromItem error:", msg, err);
    res.status(500).json({ message: msg });
  }
};

// ---- HSN / SAC maintenance (SAP India Chapter ID and SAC Code setup) ----

const sapService = require("../services/sapService");
const { clearCache } = require("../middleware/cacheMiddleware");

// Saves go through the Service Layer path (local engine for PostgreSQL companies).
// ponytail: clears every response cache; HSN/SAC saves are rare. Scope it if that ever shows.
const saveCode = (entity, method) => async (req, res) => {
  const id = req.params.absEntry;
  if (method === "PATCH" && !/^\d+$/.test(String(id))) {
    return res.status(400).json({ message: "A valid internal key is required." });
  }
  try {
    const url = method === "POST" ? `/${entity}` : `/${entity}(${Number(id)})`;
    const result = await sapService.request({ method, url, data: req.body });
    clearCache();
    const saved = method === "POST"
      ? result.data
      : (await sapService.request({ method: "GET", url })).data;
    res.status(method === "POST" ? 201 : 200).json(saved);
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

module.exports = {
  getHSNCodes,
  getSACCodes,
  getHSNCode,
  getHSNCodeFromItem,
  createHSNCode: saveCode("ChapterIDs", "POST"),
  updateHSNCode: saveCode("ChapterIDs", "PATCH"),
  createSACCode: saveCode("SACCodes", "POST"),
  updateSACCode: saveCode("SACCodes", "PATCH"),
};
