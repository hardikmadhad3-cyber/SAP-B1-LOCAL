// Close / Cancel for any document page (SAP Data > Cancel, Data > Close). One
// route for every page; the page's menu right is checked on the server and the
// action goes through sapService, so SAP and local companies behave the same.
const router = require('express').Router();
const sapService = require('../services/sapService');
const authDb = require('../services/authDbService');
const { clearCache } = require('../middleware/cacheMiddleware');

// Page type -> Service Layer entity, menu path and which actions SAP offers.
const DOCUMENT_TYPES = {
  'sales-quotation': { entity: 'Quotations', path: '/sales-quotation', actions: ['close', 'cancel'] },
  'sales-order': { entity: 'Orders', path: '/sales-order', actions: ['close', 'cancel'] },
  delivery: { entity: 'DeliveryNotes', path: '/delivery', actions: ['close', 'cancel'] },
  'ar-invoice': { entity: 'Invoices', path: '/ar-invoice', actions: ['cancel'] },
  'ar-credit-memo': { entity: 'CreditNotes', path: '/ar-credit-memo', actions: ['cancel'] },
  'service-ar-invoice': { entity: 'Invoices', path: '/services/ar-invoice', actions: ['cancel'] },
  'service-ar-credit-memo': { entity: 'CreditNotes', path: '/services/ar-credit-memo', actions: ['cancel'] },
  'purchase-request': { entity: 'PurchaseRequests', path: '/purchase-request', actions: ['close', 'cancel'] },
  'purchase-quotation': { entity: 'PurchaseQuotations', path: '/purchase-quotation', actions: ['close', 'cancel'] },
  'purchase-order': { entity: 'PurchaseOrders', path: '/purchase-order', actions: ['close', 'cancel'] },
  grpo: { entity: 'PurchaseDeliveryNotes', path: '/grpo', actions: ['close', 'cancel'] },
  'ap-invoice': { entity: 'PurchaseInvoices', path: '/ap-invoice', actions: ['cancel'] },
  'ap-credit-memo': { entity: 'PurchaseCreditNotes', path: '/ap-credit-memo', actions: ['cancel'] },
  'service-ap-invoice': { entity: 'PurchaseInvoices', path: '/services/ap-invoice', actions: ['cancel'] },
  'service-ap-credit-memo': { entity: 'PurchaseCreditNotes', path: '/services/ap-credit-memo', actions: ['cancel'] },
  'goods-receipt': { entity: 'InventoryGenEntries', path: '/goods-receipt', actions: ['cancel'] },
  'goods-issue': { entity: 'InventoryGenExits', path: '/goods-issue', actions: ['cancel'] },
  'inventory-transfer-request': { entity: 'InventoryTransferRequests', path: '/inventory-transfer-request', actions: ['close', 'cancel'] },
  'inventory-transfer': { entity: 'StockTransfers', path: '/inventory-transfer', actions: ['cancel'] },
  'incoming-payments': { entity: 'IncomingPayments', path: '/incoming-payments', actions: ['cancel'] },
  'outgoing-payments': { entity: 'VendorPayments', path: '/outgoing-payments', actions: ['cancel'] },
};

// Cancelling or closing changes a posted document: needs View + Edit on its page.
const authorize = async (req, res, next) => {
  try {
    const type = DOCUMENT_TYPES[req.params.type];
    if (!type || !type.actions.includes(req.params.action)) return res.status(404).json({ message: 'This action is not available for this document.' });
    if (!(Number(req.params.docEntry) > 0)) return res.status(400).json({ message: 'Select a saved document.' });
    const rows = await authDb.queryRows(`SELECT rr.CanView, rr.CanEdit FROM RoleRights rr
      JOIN Menus m ON m.MenuId=rr.MenuId JOIN UserRoles ur ON ur.RoleId=rr.RoleId
      WHERE ur.UserId=@userId AND ur.CompanyId=@companyId AND ur.RoleId=@roleId AND m.MenuPath=@path`,
    { userId: req.auth?.userId, companyId: req.auth?.companyId, roleId: req.auth?.roleId, path: type.path });
    if (!rows.some((row) => row.CanView && row.CanEdit)) return res.status(403).json({ message: 'You do not have permission to change this document.' });
    req.documentType = type;
    next();
  } catch (error) { next(error); }
};

router.post('/:type/:docEntry/:action', authorize, async (req, res) => {
  const action = req.params.action === 'cancel' ? 'Cancel' : 'Close';
  try {
    await sapService.request({ method: 'POST', url: `/${req.documentType.entity}(${Number(req.params.docEntry)})/${action}` });
    clearCache();
    res.json({ success: true, message: action === 'Cancel' ? 'Document cancelled.' : 'Document closed.' });
  } catch (error) {
    res.status(error.response?.status && error.response.status < 500 ? error.response.status : 500).json({
      message: error.response?.data?.error?.message?.value || error.message,
    });
  }
});

module.exports = router;
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
