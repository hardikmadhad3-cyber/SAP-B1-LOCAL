const express = require("express");
const router  = express.Router();
const {
  listBOMs, getBOM, createBOM, updateBOM, deleteBOM, navigateBOM, lookupResources,
  lookupItems, lookupWarehouses, lookupPriceLists,
  lookupDistributionRules, lookupProjects, lookupGLAccounts,
  getItemDetails,
} = require("../controllers/bomController");

// Lookups (must be before /:treeCode)
router.get("/lookup/items",               lookupItems);
router.get("/lookup/item-details/:itemCode", getItemDetails);
router.get("/lookup/warehouses",          lookupWarehouses);
router.get("/lookup/price-lists",         lookupPriceLists);
router.get("/lookup/distribution-rules",  lookupDistributionRules);
router.get("/lookup/projects",            lookupProjects);
router.get("/lookup/gl-accounts",         lookupGLAccounts);
router.get("/lookup/resources",           lookupResources);
router.get("/navigate",                   navigateBOM);

// CRUD
router.get("/",             listBOMs);
router.get("/:treeCode",    getBOM);
router.post("/",            createBOM);
router.patch("/:treeCode",  updateBOM);
router.delete("/:treeCode", deleteBOM);

// Attachments tab (stored per company and record, like Item Master).
require('../controllers/attachmentController').mountAttachments(router, require('multer')({ dest: 'uploads/tmp/' }), { kind: 'bom', param: 'treeCode', baseUrl: '/bom' });

module.exports = router;
