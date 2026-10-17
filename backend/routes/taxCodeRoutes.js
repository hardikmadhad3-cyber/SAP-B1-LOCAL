const express = require("express");
const router  = express.Router();
const {
  createTaxCode, getTaxCode, updateTaxCode, searchTaxCodes, listSetupTaxCodes,
  listTaxComponents, listTaxTypes, getTaxComponent, createTaxComponent, updateTaxComponent,
  lookupGLAccounts,
} = require("../controllers/taxCodeController");

// Lookups and lists (must come before /:code)
router.get("/lookup/gl-accounts", lookupGLAccounts);
router.get("/search", searchTaxCodes);
router.get("/setup/codes", listSetupTaxCodes);
router.get("/types", listTaxTypes);

// Tax components (SAP tax authorities)
router.get("/components", listTaxComponents);
router.post("/components/create", createTaxComponent);
router.get("/components/:code", getTaxComponent);
router.patch("/components/:code", updateTaxComponent);

// Tax codes
router.post("/create",  createTaxCode);
router.get("/:code",    getTaxCode);
router.patch("/:code",  updateTaxCode);

module.exports = router;
