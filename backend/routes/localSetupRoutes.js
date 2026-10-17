const router = require('express').Router();
const setup = require('../services/localSetupService');
const authDb = require('../services/authDbService');
const { clearCache } = require('../middleware/cacheMiddleware');

// Setup rights are checked on the server, including action endpoints.
const authorize = async (req, res, next) => {
  try {
    if (!Object.hasOwn(setup.SETUPS, req.params.kind)) return res.status(404).json({ message: 'Unknown setup page.' });
    const right = req.method === 'GET' ? 'CanView' : req.params.action === 'create-months' ? 'CanAdd' : req.method === 'PATCH' || req.params.action ? 'CanEdit' : 'CanAdd';
    const rows = await authDb.queryRows(`SELECT rr.CanView, rr.CanAdd, rr.${right} AS Allowed FROM RoleRights rr
      JOIN Menus m ON m.MenuId=rr.MenuId JOIN UserRoles ur ON ur.RoleId=rr.RoleId
      WHERE ur.UserId=@userId AND ur.CompanyId=@companyId AND ur.RoleId=@roleId AND m.MenuPath=@path`,
    { userId: req.auth?.userId, companyId: req.auth?.companyId, roleId: req.auth?.roleId, path: `/setup/${req.params.kind}` });
    if (!rows.some((row) => row.CanView && row.Allowed && (req.params.action !== 'apply' || row.CanAdd))) return res.status(403).json({ message: 'You do not have permission for this setup action.' });
    next();
  } catch (error) { next(error); }
};
const respond = (handler) => async (req,res) => {
  try {
    const result = await handler(req);
    if (req.method !== 'GET') clearCache();
    res.json(result || { success:true });
  } catch (error) {
    res.status(error.statusCode || error.response?.status || (/^(22|23)/.test(error.code || '') ? 400 : 500)).json({
      message: error.response?.data?.error?.message?.value || error.message,
    });
  }
};
router.get('/:kind', authorize, respond((req)=>setup.list(req.params.kind)));
router.post('/:kind/actions/:action', authorize, respond((req)=>setup.action(req.params.kind,req.params.action,req.body)));
router.post('/:kind', authorize, respond((req)=>setup.save(req.params.kind,null,req.body)));
router.patch('/:kind/:key', authorize, respond((req)=>setup.save(req.params.kind,req.params.key,req.body)));
module.exports = router;
