const sapService = require("../services/sapService");
const masterDataDbService = require("../services/masterDataDbService");

// ── List BOMs ─────────────────────────────────────────────────────────────────
const listBOMs = async (req, res) => {
  try {
    const { query = "", top = 50, skip = 0 } = req.query;
    const rows = await masterDataDbService.listBOMs(query, top, skip);
    res.json(rows);
  } catch (err) {
    res.status(err.statusCode || err.response?.status || 500).json({ message: _sapMsg(err) });
  }
};

// ── Get single BOM ────────────────────────────────────────────────────────────
const getBOM = async (req, res) => {
  try {
    const code = req.params.treeCode;
    const bom = await masterDataDbService.getBOM(code);
    if (!bom) {
      return res.status(404).json({ message: `BOM "${code}" not found.` });
    }
    res.json(bom);
  } catch (err) {
    res.status(err.statusCode || err.response?.status || 500).json({ message: _sapMsg(err) });
  }
};

// ── Create BOM ────────────────────────────────────────────────────────────────
const createBOM = async (req, res) => {
  try {
    const payload = _buildPayload(req.body);
    
    await _assertNoCircularReferences(payload.TreeCode, payload.ProductTreeLines);
    
    const resp = await sapService.request({ method: "POST", url: "/ProductTrees", data: payload });
    const created = await masterDataDbService.getBOM(payload.TreeCode).catch(() => null);
    res.status(201).json(created || resp.data);
  } catch (err) {
    console.error("[BOM create]", _sapMsg(err), JSON.stringify(err.response?.data));
    if (_isDuplicateEntryError(err)) {
      return res.status(409).json({
        message: `A BOM already exists for item "${req.body?.TreeCode || "this item"}". Open the existing BOM instead of creating a new one.`,
      });
    }
    res.status(err.statusCode || err.response?.status || 500).json({ message: _sapMsg(err) });
  }
};

// ── Update BOM ────────────────────────────────────────────────────────────────
const updateBOM = async (req, res) => {
  try {
    const code = req.params.treeCode;
    const payload = _buildPayload(req.body);
    
    await _assertNoCircularReferences(payload.TreeCode || code, payload.ProductTreeLines);
    
    await sapService.request({ method: "PATCH", url: sapService.buildStringKeyPath("ProductTrees", code), data: payload });
    const updated = await masterDataDbService.getBOM(code);
    res.json(updated || payload);
  } catch (err) {
    console.error("[BOM update]", _sapMsg(err), JSON.stringify(err.response?.data));
    res.status(err.statusCode || err.response?.status || 500).json({ message: _sapMsg(err) });
  }
};

// ── Delete BOM ────────────────────────────────────────────────────────────────
const deleteBOM = async (req, res) => {
  try {
    await sapService.request({ method: "DELETE", url: sapService.buildStringKeyPath("ProductTrees", req.params.treeCode) });
    res.json({ success: true });
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: _sapMsg(err) });
  }
};

// First / Previous / Next / Last BOM (SAP record browsing).
const navigateBOM = async (req, res) => {
  try {
    const code = await require("../services/productionDbService").navigateRecord("bom", req.query.direction, req.query.from);
    if (!code) return res.status(404).json({ message: "No more bills of materials." });
    res.json(await masterDataDbService.getBOM(code));
  } catch (err) {
    res.status(err.status || 500).json({ message: _sapMsg(err) });
  }
};

const lookupResources = async (req, res) => {
  try {
    res.json(await require("../services/productionDbService").lookupResources(req.query.query || ""));
  } catch (err) { res.status(500).json({ message: _sapMsg(err) }); }
};

// ── Lookups ───────────────────────────────────────────────────────────────────
const lookupItems = async (req, res) => {
  try {
    const q = req.query.query || "";
    const items = await masterDataDbService.lookupBOMItems(q);
    res.json(items);
  } catch (err) { res.status(500).json({ message: _sapMsg(err) }); }
};

const lookupWarehouses = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupBOMWarehouses();
    res.json(rows);
  } catch (err) { res.status(500).json({ message: _sapMsg(err) }); }
};

const lookupPriceLists = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupBOMPriceLists();
    res.json(rows);
  } catch (err) { res.status(500).json({ message: _sapMsg(err) }); }
};

const lookupDistributionRules = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupDistributionRules();
    res.json(rows);
  } catch (err) { res.status(500).json({ message: _sapMsg(err) }); }
};

const lookupProjects = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupProjects();
    res.json(rows);
  } catch (err) { res.status(500).json({ message: _sapMsg(err) }); }
};

const lookupGLAccounts = async (req, res) => {
  try {
    const q = req.query.query || "";
    const rows = await masterDataDbService.lookupGLAccounts(q, 100);
    res.json(rows);
  } catch (err) { res.status(500).json({ message: _sapMsg(err) }); }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function _sapMsg(err) {
  return (
    err.response?.data?.error?.message?.value ||
    err.response?.data?.error?.message ||
    err.response?.data?.message ||
    err.message
  );
}

function _isDuplicateEntryError(err) {
  const message = _sapMsg(err) || "";
  const code = String(err.response?.data?.error?.code || "");
  return code.includes("-2035") || message.includes("ODBC -2035") || /already exists/i.test(message);
}

async function _getAllServiceLayerPages(initialUrl, limit) {
  const rows = [];
  const seen = new Set();
  let url = initialUrl;

  while (url && rows.length < limit && !seen.has(url)) {
    seen.add(url);
    const resp = await sapService.request({ method: "GET", url });
    const pageRows = resp.data?.value || [];
    rows.push(...pageRows);

    const nextLink = resp.data?.["odata.nextLink"] || resp.data?.["@odata.nextLink"];
    url = _normalizeServiceLayerNextLink(nextLink);
  }

  return rows.slice(0, limit);
}

function _normalizeServiceLayerNextLink(nextLink) {
  if (!nextLink) return "";
  const raw = String(nextLink);
  const serviceLayerMarker = "/b1s/v2/";
  const markerIndex = raw.indexOf(serviceLayerMarker);

  if (markerIndex >= 0) {
    return `/${raw.slice(markerIndex + serviceLayerMarker.length)}`;
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
}

function _buildPayload(body) {
  const opt = (v) => v !== "" && v != null;
  const validStageId = (v) => opt(v) && Number.isInteger(Number(v)) && Number(v) > 0;
  const p = {};

  p.TreeCode = body.TreeCode;
  p.TreeType = body.TreeType || "iProductionTree";
  p.Quantity = Number(body.Quantity) || 1;

  if (opt(body.Warehouse))        p.Warehouse        = body.Warehouse;
  if (opt(body.PriceList))        p.PriceList        = Number(body.PriceList);
  if (opt(body.PlanAvgProdSize))  p.PlanAvgProdSize  = Number(body.PlanAvgProdSize);
  if (body.TreeType === "iSalesTree" && opt(body.HideBOMComponentsInPrintout)) {
    p.HideBOMComponentsInPrintout = body.HideBOMComponentsInPrintout;
  }
  if (opt(body.DistributionRule)) p.DistributionRule = body.DistributionRule;
  if (opt(body.Project))          p.Project          = body.Project;

  // Route stages of the BOM; rows refer to them by StageID.
  if (Array.isArray(body.ProductTreeStages)) {
    p.ProductTreeStages = body.ProductTreeStages
      .filter((stage) => opt(stage.StageEntry))
      .map((stage) => ({
        StageEntry: Number(stage.StageEntry),
        ...(validStageId(stage.StageID) && { StageID: Number(stage.StageID) }),
        ...(opt(stage.Name) && { Name: stage.Name }),
      }));
  }

  if (Array.isArray(body.ProductTreeLines) && body.ProductTreeLines.length > 0) {
    p.ProductTreeLines = body.ProductTreeLines
      .filter((l) => l.ItemType === "pit_Text" ? (l.LineText || l.Comment) : l.ItemCode)
      .map((l, idx) => {
        const line = {
          Quantity:    Number(l.Quantity) || 1,
          // Confirmed SAP enum: im_Manual | im_Backflush
          IssueMethod: l.IssueMethod || "im_Manual",
          // Confirmed SAP enum: pit_Item (only value seen in live data)
          ItemType:    l.ItemType    || "pit_Item",
        };
        if (line.ItemType === "pit_Text") {
          line.LineText = l.LineText || l.Comment || "";
        } else {
          line.ItemCode = l.ItemCode;
        }
        if (opt(l.Warehouse))        line.Warehouse        = l.Warehouse;
        if (opt(l.PriceList))        line.PriceList        = Number(l.PriceList);
        if (opt(l.Comment))          line.Comment          = l.Comment;
        if (opt(l.WipAccount))       line.WipAccount       = l.WipAccount;
        if (opt(l.DistributionRule)) line.DistributionRule = l.DistributionRule;
        if (opt(l.Project))          line.Project          = l.Project;
        if (opt(l.AdditionalQuantity)) line.AdditionalQuantity = Number(l.AdditionalQuantity);
        if (validStageId(l.StageID)) {
          line.StageID = Number(l.StageID);
        } else if (validStageId(l.RouteSequence)) {
          line.StageID = Number(l.RouteSequence);
        }
        return line;
      });
  }

  return p;
}

async function _assertNoCircularReferences(parentCode, lines = []) {
  const parent = String(parentCode || "").trim();
  const roots = (lines || [])
    .filter((line) => line.ItemType !== "pit_Text")
    .map((line) => String(line.ItemCode || "").trim())
    .filter(Boolean);
  const visited = new Set();
  const visit = async (code, path, depth) => {
    if (code === parent) {
      const error = new Error(`Circular BOM reference detected: ${[...path, code].join(" -> ")}.`);
      error.statusCode = 400;
      throw error;
    }
    if (depth >= 20 || visited.has(code)) return;
    visited.add(code);
    const bom = await masterDataDbService.getBOM(code);
    if (!bom) return;
    for (const line of bom.ProductTreeLines || []) {
      if (line.ItemType === "pit_Text") continue;
      const child = String(line.ItemCode || "").trim();
      if (child) await visit(child, [...path, code], depth + 1);
    }
  };
  for (const code of roots) await visit(code, [parent], 0);
}

// ── Get Item Details (for auto-populating BOM fields) ────────────────────────
const getItemDetails = async (req, res) => {
  try {
    const itemCode = req.params.itemCode;
    const item = await masterDataDbService.getBOMItemDetails(itemCode);

    if (!item) {
      return res.status(404).json({ message: `Item "${itemCode}" not found.` });
    }

    res.json(item);
  } catch (err) {
    res.status(err.response?.status || 500).json({ message: _sapMsg(err) });
  }
};

module.exports = {
  listBOMs, getBOM, createBOM, updateBOM, deleteBOM, navigateBOM, lookupResources,
  lookupItems, lookupWarehouses, lookupPriceLists,
  lookupDistributionRules, lookupProjects, lookupGLAccounts,
  getItemDetails,
  _private: { _buildPayload, _assertNoCircularReferences },
};
