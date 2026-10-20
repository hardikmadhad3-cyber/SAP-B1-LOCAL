const svc = require('../services/issueForProductionService');

const errPayload = (error) => ({
  detail:
    error.response?.data?.error?.message?.value ||
    error.response?.data?.error?.message ||
    error.response?.data ||
    error.message ||
    'Unknown error',
});

const getReferenceData = async (req, res) => {
  try {
    res.json(await svc.getReferenceData({ postingDate: req.query.date, branch: req.query.branch || '' }));
  } catch (e) {
    console.error('[IssueForProd] refData:', e.response?.data || e.message);
    res.status(500).json(errPayload(e));
  }
};

const getSeries = async (req, res) => {
  try {
    res.json(await svc.getSeries(req.query.date, req.query.branch || ''));
  } catch (e) {
    res.status(e.statusCode || 500).json(errPayload(e));
  }
};

const getAllocationOptions = async (req, res) => {
  try {
    res.json(await svc.getAllocationOptions(req.query.itemCode, req.query.warehouse));
  } catch (e) {
    res.status(e.statusCode || 500).json(errPayload(e));
  }
};

const getProductionOrderForIssue = async (req, res) => {
  try {
    res.json(await svc.getProductionOrderForIssue(req.params.docEntry));
  } catch (e) {
    console.error('[IssueForProd] getPO:', e.response?.data || e.message);
    res.status(e.statusCode || e.response?.status || 400).json(errPayload(e));
  }
};

const getIssueList = async (req, res) => {
  try {
    res.json(await svc.getIssueList(req.query));
  } catch (e) {
    console.error('[IssueForProd] list:', e.response?.data || e.message);
    res.status(500).json(errPayload(e));
  }
};

const getIssueByDocEntry = async (req, res) => {
  try {
    res.json(await svc.getIssueByDocEntry(req.params.docEntry));
  } catch (e) {
    console.error('[IssueForProd] get:', e.response?.data || e.message);
    res.status(e.statusCode || e.response?.status || 500).json(errPayload(e));
  }
};

const createIssue = async (req, res) => {
  try {
    const result = await svc.createIssue(req.body);
    res.status(201).json(result);
  } catch (e) {
    console.error('[IssueForProd] create:', e.response?.data || e.message);
    res.status(e.statusCode || e.response?.status || 400).json(errPayload(e));
  }
};

const lookupProductionOrders = async (req, res) => {
  try {
    const data = await svc.lookupProductionOrders(req.query.query || '', req.query.type || '');
    res.json(data);
  } catch (e) {
    console.error('[IssueForProd] lookupPO error:', e.response?.data || e.message);
    res.status(500).json(errPayload(e));
  }
};

const cancelDocument = async (req, res) => {
  try {
    res.json(await svc.cancelIssue(req.params.docEntry));
  } catch (e) {
    console.error('[IssueForProd] cancel:', e.response?.data || e.message);
    res.status(e.statusCode || e.response?.status || 500).json(errPayload(e));
  }
};

// First / Previous / Next / Last document (SAP record browsing).
const navigateDocument = async (req, res) => {
  try {
    const docEntry = await require('../services/productionDbService').navigateRecord('issue-for-production', req.query.direction, req.query.from);
    if (!docEntry) return res.status(404).json({ detail: 'No more documents.' });
    res.json(await svc.getIssueByDocEntry(docEntry));
  } catch (e) {
    res.status(e.statusCode || e.status || 500).json(errPayload(e));
  }
};

module.exports = {
  cancelDocument,
  navigateDocument,
  getReferenceData,
  getSeries,
  getAllocationOptions,
  getProductionOrderForIssue,
  getIssueList,
  getIssueByDocEntry,
  createIssue,
  lookupProductionOrders,
};
