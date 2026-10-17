const sapService = require("../services/sapService");
const masterDataDbService = require("../services/masterDataDbService");

const createUoMGroup = async (req, res) => {
  const data = req.body;
  if (!data.Name) return res.status(400).json({ message: "Name is required." });
  try {
    const result = await sapService.request({ method: "POST", url: "/UnitOfMeasurementGroups", data });
    res.status(201).json(result.data);
  } catch (err) {
    const msg =
      err.response?.data?.error?.message?.value ||
      err.response?.data?.error?.message ||
      err.message;
    console.error("[SAP createUoMGroup error]", msg, JSON.stringify(err.response?.data));
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

const getUoMGroup = async (req, res) => {
  try {
    const row = await masterDataDbService.getUoMGroup(req.params.absEntry);
    if (!row) return res.status(404).json({ message: "UoM Group not found." });
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateUoMGroup = async (req, res) => {
  const { absEntry } = req.params;
  try {
    await sapService.request({
      method: "PATCH",
      url: `/UnitOfMeasurementGroups(${encodeURIComponent(absEntry)})`,
      data: req.body,
    });
    const row = await masterDataDbService.getUoMGroup(absEntry);
    res.json(row || { AbsEntry: absEntry });
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    console.error("[SAP updateUoMGroup error]", msg, JSON.stringify(err.response?.data));
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

const searchUoMGroups = async (req, res) => {
  try {
    const { query = "", top = 50, skip = 0 } = req.query;
    const rows = await masterDataDbService.searchUoMGroups(query, top, skip);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupUoMs = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupUoMs(req.query.query || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Units of measure (OUOM) themselves: SAP's Units of Measure setup.
const saveUoM = (method) => async (req, res) => {
  try {
    const url = method === "POST" ? "/UnitOfMeasurements" : `/UnitOfMeasurements(${Number(req.params.absEntry)})`;
    const result = await sapService.request({ method, url, data: req.body });
    const saved = method === "POST" ? result.data : (await sapService.request({ method: "GET", url })).data;
    res.status(method === "POST" ? 201 : 200).json(saved);
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

module.exports = {
  createUoM: saveUoM("POST"),
  updateUoM: saveUoM("PATCH"),
  createUoMGroup,
  getUoMGroup,
  updateUoMGroup,
  searchUoMGroups,
  lookupUoMs,
};
