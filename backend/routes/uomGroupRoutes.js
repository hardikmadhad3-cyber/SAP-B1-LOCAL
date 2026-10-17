const express = require("express");
const router  = express.Router();
const {
  createUoMGroup, getUoMGroup, updateUoMGroup, searchUoMGroups,
  lookupUoMs, createUoM, updateUoM,
} = require("../controllers/uomGroupController");

// Lookups (must come before /:absEntry)
router.get("/lookup/uoms", lookupUoMs);

// Units of measure (OUOM)
router.post("/uoms/create", createUoM);
router.patch("/uoms/:absEntry", updateUoM);

// Search
router.get("/search", searchUoMGroups);

// CRUD
router.post("/create",       createUoMGroup);
router.get("/:absEntry",     getUoMGroup);
router.patch("/:absEntry",   updateUoMGroup);

module.exports = router;
