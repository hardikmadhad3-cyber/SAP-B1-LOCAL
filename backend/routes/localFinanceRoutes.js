const router = require('express').Router();
const finance = require('../services/localFinanceService');
const authDb = require('../services/authDbService');
const { clearCache } = require('../middleware/cacheMiddleware');

// Menu rights on the server: View to read, Add to post.
const authorize = (path) => async (req, res, next) => {
  try {
    const right = req.method === 'GET' ? 'CanView' : 'CanAdd';
    const rows = await authDb.queryRows(`SELECT rr.CanView, rr.${right} AS Allowed FROM RoleRights rr
      JOIN Menus m ON m.MenuId=rr.MenuId JOIN UserRoles ur ON ur.RoleId=rr.RoleId
      WHERE ur.UserId=@userId AND ur.CompanyId=@companyId AND ur.RoleId=@roleId AND m.MenuPath=@path`,
    { userId: req.auth?.userId, companyId: req.auth?.companyId, roleId: req.auth?.roleId, path });
    if (!rows.some((row) => row.CanView && row.Allowed)) return res.status(403).json({ message: 'You do not have permission for this page.' });
    next();
  } catch (error) { next(error); }
};
const respond = (handler) => async (req, res) => {
  try {
    const result = await handler(req);
    if (req.method !== 'GET') clearCache();
    res.json(result ?? { success: true });
  } catch (error) {
    res.status(error.statusCode || (error.response?.status < 500 ? error.response.status : 0) || (/^(22|23)/.test(error.code || '') ? 400 : 500)).json({
      message: error.response?.data?.error?.message?.value || error.message,
    });
  }
};

const opening = authorize('/opening-balances');
const reconciliation = authorize('/internal-reconciliation');
router.get('/opening-balances', opening, respond(() => finance.listOpeningBalances()));
router.post('/opening-balances/:kind', opening, respond((req) => finance.postOpeningBalances(req.params.kind, req.body)));
router.get('/reconciliation', reconciliation, respond(() => finance.listReconcilablePartners()));
router.get('/reconciliation/:cardCode', reconciliation, respond((req) => finance.listOpenRows(req.params.cardCode)));
router.post('/reconciliation', reconciliation, respond((req) => finance.reconcile(req.body)));

module.exports = router;
