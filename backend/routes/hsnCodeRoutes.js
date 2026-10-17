const express = require("express");
const router = express.Router();
const {
  getHSNCodes,
  getSACCodes,
  getHSNCode,
  getHSNCodeFromItem,
  createHSNCode,
  updateHSNCode,
  createSACCode,
  updateSACCode,
} = require("../controllers/hsnCodeController");

// Get all HSN codes (with optional search)
router.get("/", getHSNCodes);

// Get all SAC service codes (with optional search)
router.get("/sac", getSACCodes);

// Maintain HSN (OCHP) and SAC (OSAC) codes; :absEntry is the internal key
router.post("/create", createHSNCode);
router.patch("/entry/:absEntry", updateHSNCode);
router.post("/sac/create", createSACCode);
router.patch("/sac/:absEntry", updateSACCode);

// Get HSN code from item master
router.get("/item/:itemCode", getHSNCodeFromItem);

// Get single HSN code by ChapterID
router.get("/:code", getHSNCode);

module.exports = router;
