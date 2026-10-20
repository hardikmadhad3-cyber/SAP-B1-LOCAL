const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/receiptFromProductionController');

// Lookups (before /:docEntry)
router.get('/lookup/production-orders',   ctrl.lookupProductionOrders);
router.get('/reference-data',             ctrl.getReferenceData);
router.get('/series',                     ctrl.getSeries);
router.get('/allocation-options',         ctrl.getAllocationOptions);

// Load production order for receipt form
router.get('/production-order/:docEntry', ctrl.getProductionOrderForReceipt);

// Receipt document
router.get('/list',       ctrl.getReceiptList);
router.get('/navigate', ctrl.navigateDocument);
router.get('/:docEntry',  ctrl.getReceiptByDocEntry);
router.post('/',          ctrl.createReceipt);
router.post('/:docEntry/cancel', ctrl.cancelDocument);

module.exports = router;
