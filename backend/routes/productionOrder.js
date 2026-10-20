const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/productionOrderController');

// Lookups (before /:docEntry)
router.get('/lookup/items',              ctrl.lookupItems);
router.get('/lookup/finish-items',       ctrl.lookupFinishItems);
router.get('/lookup/component-items',    ctrl.lookupComponentItems);
router.get('/lookup/resources',          ctrl.lookupResources);
router.get('/lookup/route-stages',       ctrl.lookupRouteStages);
router.get('/lookup/warehouses',         ctrl.lookupWarehouses);
router.get('/lookup/distribution-rules', ctrl.lookupDistributionRules);
router.get('/lookup/projects',           ctrl.lookupProjects);
router.get('/lookup/branches',           ctrl.lookupBranches);
router.get('/lookup/customers',          ctrl.lookupCustomers);
router.get('/lookup/users',              ctrl.lookupUsers);
router.get('/lookup/linked-orders',      ctrl.lookupLinkedOrders);

// Reference data
router.get('/reference-data', ctrl.getReferenceData);
router.get('/series',         ctrl.getSeries);

// BOM explosion
router.get('/bom-explode/:itemCode', ctrl.explodeBOM);

// CRUD
router.get('/list',         ctrl.getProductionOrders);
router.get('/navigate',     ctrl.navigateProductionOrder);
router.get('/:docEntry',    ctrl.getProductionOrderByDocEntry);
router.post('/',            ctrl.createProductionOrder);
router.patch('/:docEntry',  ctrl.updateProductionOrder);
router.post('/:docEntry/release', ctrl.releaseProductionOrder);
router.post('/:docEntry/close', ctrl.closeProductionOrder);
router.post('/:docEntry/cancel', ctrl.cancelProductionOrder);

// Attachments tab (stored per company and record, like Item Master).
require('../controllers/attachmentController').mountAttachments(router, require('multer')({ dest: 'uploads/tmp/' }), { kind: 'production-orders', param: 'docEntry', baseUrl: '/production-order' });

module.exports = router;
