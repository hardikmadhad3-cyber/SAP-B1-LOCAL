const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/issueForProductionController');

// Lookups (must be before /:docEntry)
router.get('/lookup/production-orders', ctrl.lookupProductionOrders);
router.get('/reference-data',           ctrl.getReferenceData);
router.get('/series',                   ctrl.getSeries);
router.get('/allocation-options',       ctrl.getAllocationOptions);

// Load production order components for issue form
router.get('/production-order/:docEntry', ctrl.getProductionOrderForIssue);

// Issue document CRUD
router.get('/list',        ctrl.getIssueList);
router.get('/navigate', ctrl.navigateDocument);
router.get('/:docEntry',   ctrl.getIssueByDocEntry);
router.post('/',           ctrl.createIssue);
router.post('/:docEntry/cancel', ctrl.cancelDocument);

module.exports = router;
