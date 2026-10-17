const sapService = require("../services/sapService");
const masterDataDbService = require("../services/masterDataDbService");

// India GST tax setup on SAP's objects: tax codes (SalesTaxCodes -> OSTC/STC1)
// made of tax components (SalesTaxAuthorities -> OSTA) of a tax type (OSTT).
const sendError = (res, err, label) => {
  const msg = err.response?.data?.error?.message?.value || err.response?.data?.error?.message || err.message;
  console.error(`[${label}]`, msg);
  res.status(err.response?.status || 500).json({ message: msg });
};
const keyPath = (entity, code) => sapService.buildStringKeyPath(entity, code);

const handle = (label, action) => async (req, res) => {
  try {
    await action(req, res);
  } catch (err) {
    sendError(res, err, label);
  }
};

const createTaxCode = handle("createTaxCode", async (req, res) => {
  const result = await sapService.request({ method: "POST", url: "/SalesTaxCodes", data: req.body });
  res.status(201).json(result.data);
});

const getTaxCode = handle("getTaxCode", async (req, res) => {
  const result = await sapService.request({ method: "GET", url: keyPath("SalesTaxCodes", req.params.code) });
  res.json(result.data);
});

const updateTaxCode = handle("updateTaxCode", async (req, res) => {
  await sapService.request({ method: "PATCH", url: keyPath("SalesTaxCodes", req.params.code), data: req.body });
  const result = await sapService.request({ method: "GET", url: keyPath("SalesTaxCodes", req.params.code) });
  res.json(result.data);
});

// Active codes for document lines (used by the transaction pages).
const searchTaxCodes = handle("searchTaxCodes", async (req, res) => {
  const { query = "", category = "", top = 50, skip = 0 } = req.query;
  res.json(await masterDataDbService.searchTaxCodes(query, category, top, skip));
});

// All codes, including inactive ones, for the setup page's Find.
const listSetupTaxCodes = handle("listSetupTaxCodes", async (req, res) => {
  res.json(await masterDataDbService.listTaxCodesForSetup(req.query.query || ""));
});

const listTaxComponents = handle("listTaxComponents", async (req, res) => {
  res.json(await masterDataDbService.listTaxComponents(req.query.query || ""));
});

const listTaxTypes = handle("listTaxTypes", async (_req, res) => {
  res.json(await masterDataDbService.listTaxTypes());
});

const getTaxComponent = handle("getTaxComponent", async (req, res) => {
  const result = await sapService.request({ method: "GET", url: keyPath("SalesTaxAuthorities", req.params.code) });
  res.json(result.data);
});

const createTaxComponent = handle("createTaxComponent", async (req, res) => {
  const result = await sapService.request({ method: "POST", url: "/SalesTaxAuthorities", data: req.body });
  res.status(201).json(result.data);
});

const updateTaxComponent = handle("updateTaxComponent", async (req, res) => {
  await sapService.request({ method: "PATCH", url: keyPath("SalesTaxAuthorities", req.params.code), data: req.body });
  const result = await sapService.request({ method: "GET", url: keyPath("SalesTaxAuthorities", req.params.code) });
  res.json(result.data);
});

const lookupGLAccounts = handle("lookupGLAccounts", async (req, res) => {
  res.json(await masterDataDbService.lookupGLAccounts(req.query.query || "", 50));
});

module.exports = {
  createTaxCode,
  getTaxCode,
  updateTaxCode,
  searchTaxCodes,
  listSetupTaxCodes,
  listTaxComponents,
  listTaxTypes,
  getTaxComponent,
  createTaxComponent,
  updateTaxComponent,
  lookupGLAccounts,
};
