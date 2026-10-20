const db = require("./dbService");
const masterDataDbService = require("./masterDataDbService");
const { resolveMarketingDocumentSeries } = require("./documentSeriesDbUtils");

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatDate = (value) => {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(value).split("T")[0];
};
const yesNo = (value) => (String(value || "").toUpperCase() === "Y" ? "tYES" : "tNO");
const toBool = (value) => value === true || Number(value) === 1 || String(value || "").toUpperCase() === "Y";

const PRODUCTION_STATUS_TO_SL = {
  P: "boposPlanned",
  R: "boposReleased",
  L: "boposClosed",
  C: "boposCancelled",
};

const PRODUCTION_TYPE_TO_SL = {
  S: "bopotStandard",
  P: "bopotSpecial",
  D: "bopotDisassemble",
};

const ISSUE_METHOD_TO_SL = {
  B: "im_Backflush",
  M: "im_Manual",
};

const ITEM_TYPE_TO_SL = {
  4: "pit_Item",
  290: "pit_Resource",
  "-18": "pit_Text",
};

const PRODUCTION_PRIORITY_OPTIONS = [
  { value: 50, label: "Low" },
  { value: 100, label: "Normal" },
  { value: 150, label: "High" },
];

const queryRows = async (sql, params = {}) => {
  const result = await db.query(sql, params);
  return result.recordset || [];
};

const queryOne = async (sql, params = {}) => {
  const rows = await queryRows(sql, params);
  return rows[0] || null;
};

const tableColumnCache = new Map();

const getMetadataScopeKey = async (tableName) => {
  const config = await db.resolveSqlConnectionConfig();
  return JSON.stringify([
    config.dialect || "sqlserver",
    config.server || "",
    config.port || 0,
    config.database || "",
    String(tableName || "").toUpperCase(),
  ]);
};

const getTableColumns = async (tableName) => {
  const table = String(tableName || "").toUpperCase();
  const key = await getMetadataScopeKey(table);
  if (!tableColumnCache.has(key)) {
    const pending = queryRows(
        `
          SELECT COLUMN_NAME
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @tableName
        `,
        { tableName: table }
      )
      .then((rows) => new Set(rows.map((row) => String(row.COLUMN_NAME || "").toUpperCase())))
      .catch((error) => {
        tableColumnCache.delete(key);
        throw error;
      });
    tableColumnCache.set(key, pending);
  }
  return tableColumnCache.get(key);
};

const selectOptionalColumn = (columns, tableAlias, columnName, aliasName, fallback = "''") =>
  columns.has(String(columnName).toUpperCase())
    ? `${tableAlias}.${columnName} AS ${aliasName}`
    : `${fallback} AS ${aliasName}`;

const tableExists = async (tableName) => {
  const rows = await queryRows(
    `
      SELECT 1 AS ExistsFlag
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_NAME = @tableName
    `,
    { tableName: String(tableName || "").toUpperCase() }
  );
  return rows.length > 0;
};

const toProductionStatus = (value) => PRODUCTION_STATUS_TO_SL[String(value || "").toUpperCase()] || "boposPlanned";
const toProductionType = (value) => PRODUCTION_TYPE_TO_SL[String(value || "").toUpperCase()] || "bopotStandard";
const toIssueMethod = (value) => ISSUE_METHOD_TO_SL[String(value || "").toUpperCase()] || "im_Manual";
const toItemType = (value) => {
  if (typeof value === "string" && value.startsWith("pit_")) return value;
  return ITEM_TYPE_TO_SL[Number(value)] || "pit_Item";
};

const toLinkedToValue = (value) => {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  if (raw === "17" || raw === "S" || raw.includes("SALES")) return "sales_order";
  if (raw === "202" || raw === "P" || raw.includes("PRODUCTION")) return "production_order";
  return String(value || "").trim();
};

const pagingParams = (top, skip) => ({
  top: Math.max(1, toInt(top, 50)),
  skip: Math.max(0, toInt(skip, 0)),
});

const mapSeriesRow = (row) => ({
  Series: row.Series,
  SeriesName: row.SeriesName || `Series ${row.Series}`,
  Name: row.SeriesName || `Series ${row.Series}`,
  Indicator: row.Indicator || "",
  NextNumber: row.NextNumber ?? row.InitialNum ?? null,
  BeginStr: row.BeginStr || "",
  EndStr: row.EndStr || "",
  Locked: yesNo(row.Locked),
  IsManual: yesNo(row.IsManual),
  IsDefault: toBool(row.IsDefault),
  isDefault: toBool(row.IsDefault),
  IsCurrentPeriod: toBool(row.IsCurrentPeriod),
});

const lookupSeriesContext = (objectCode, postingDate = new Date(), branch = "") =>
  resolveMarketingDocumentSeries({
    db,
    objectCode: String(objectCode),
    targetDate: postingDate,
    branch,
    purpose: "display",
  });

const lookupSeries = async (objectCode, postingDate = new Date(), branch = "") =>
  (await lookupSeriesContext(objectCode, postingDate, branch)).series;

const pickDefaultSeries = (seriesRows = []) =>
  seriesRows.find((row) => row.IsCurrentPeriod) ||
  seriesRows.find((row) => row.IsDefault) ||
  seriesRows[0] ||
  null;

const lookupProdWarehouses = async (branch = "") => {
  const columns = await getTableColumns("OWHS");
  const branchId = String(branch || "").trim() === "" ? null : toInt(branch, null);
  const rows = await queryRows(`
    SELECT WhsCode, WhsName,
           ${selectOptionalColumn(columns, "OWHS", "BinActivat", "BinActivat", "'N'")},
           ${selectOptionalColumn(columns, "OWHS", "RecBinEnab", "RecBinEnab", "'N'")},
           ${selectOptionalColumn(columns, "OWHS", "DftBinAbs", "DftBinAbs", "NULL")},
           ${selectOptionalColumn(columns, "OWHS", "AutoRecvMd", "AutoRecvMd", "0")},
           ${selectOptionalColumn(columns, "OWHS", "BPLid", "BPLID", "NULL")}
    FROM OWHS
    WHERE ${columns.has("INACTIVE") ? "ISNULL(Inactive, 'N') <> 'Y'" : "1 = 1"}
      ${columns.has("BPLID") ? "AND (@branchId IS NULL OR BPLid = @branchId)" : ""}
    ORDER BY WhsCode
  `, { branchId });

  return rows.map((row) => ({
    WarehouseCode: row.WhsCode,
    WarehouseName: row.WhsName || "",
    EnableBinLocations: yesNo(row.BinActivat),
    EnableReceivingBinLocations: yesNo(row.RecBinEnab),
    DefaultBin: row.DftBinAbs ?? null,
    AutoAllocOnReceipt: row.AutoRecvMd === 1 ? "tYES" : "tNO",
    BPLID: row.BPLID ?? null,
  }));
};

const lookupDistributionRules = async () => {
  if (!(await tableExists("OOCR"))) return [];
  return queryRows(`
    SELECT TOP 200 OcrCode AS FactorCode, OcrName AS FactorDescription
    FROM OOCR
    WHERE Active <> 'N'
    ORDER BY OcrCode
  `);
};

const lookupProjects = async () => {
  if (!(await tableExists("OPRJ"))) return [];
  return queryRows(`
    SELECT TOP 200 PrjCode AS Code, PrjName AS Name
    FROM OPRJ
    ORDER BY PrjCode
  `);
};

const lookupBranches = async () => {
  if (!(await tableExists("OBPL"))) return [];
  const columns = await getTableColumns("OBPL");
  const rows = await queryRows(`
    SELECT BPLId, BPLName
    FROM OBPL
    WHERE ${columns.has("DISABLED") ? "ISNULL(Disabled, 'N') <> 'Y'" : "1 = 1"}
    ORDER BY BPLId
  `);

  return rows.map((row) => ({
    BPLID: row.BPLId,
    BPLName: row.BPLName || "",
  }));
};

const lookupRouteStages = async (query = "") => {
  if (!(await tableExists("ORST"))) return [];
  const columns = await getTableColumns("ORST");
  const trimmed = String(query || "").trim();
  const rows = await queryRows(
    `
      SELECT TOP 200 AbsEntry, Code,
             ${selectOptionalColumn(columns, "ORST", "Desc", "Description", "''")}
      FROM ORST
      WHERE @query = ''
         OR Code LIKE @like
         ${columns.has("DESC") ? "OR [Desc] LIKE @like" : ""}
      ORDER BY AbsEntry
    `,
    { query: trimmed, like: `%${trimmed}%` }
  );

  return rows.map((row) => ({
    InternalNumber: row.AbsEntry,
    Code: row.Code || "",
    Description: row.Description || "",
  }));
};

const lookupCustomers = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(
    `
      SELECT TOP 50 CardCode, CardName
      FROM OCRD
      WHERE CardType = 'C'
        AND (
          @query = ''
          OR CardCode LIKE @like
          OR CardName LIKE @like
        )
      ORDER BY CardCode
    `,
    { query: trimmed, like: `%${trimmed}%` }
  );

  return rows.map((row) => ({
    CardCode: row.CardCode,
    CardName: row.CardName || "",
  }));
};

const lookupUsers = async () => {
  const userColumns = await getTableColumns("OUSR");
  const lockedFilter = userColumns.has("LOCKED") ? "WHERE ISNULL(Locked, 'N') <> 'Y'" : "";
  const rows = await queryRows(`
    SELECT USERID, USER_CODE, U_NAME
    FROM OUSR
    ${lockedFilter}
    ORDER BY USER_CODE
  `);

  return rows.map((row) => ({
    UserID: row.USERID,
    UserCode: row.USER_CODE || "",
    UserName: row.U_NAME || row.USER_CODE || "",
  }));
};

const lookupLinkedToOptions = async () => {
  const [hasSalesOrders, hasProductionOrders] = await Promise.all([
    tableExists("ORDR"),
    tableExists("OWOR"),
  ]);
  const options = [];
  if (hasProductionOrders) {
    options.push({ value: "production_order", label: "Production Order", object_type: 202 });
  }
  if (hasSalesOrders) {
    options.push({ value: "sales_order", label: "Sales Order", object_type: 17 });
  }
  return options;
};

const lookupLinkedOrders = async (linkedTo = "", query = "") => {
  const type = toLinkedToValue(linkedTo);
  const trimmed = String(query || "").trim();
  const params = { query: trimmed, like: `%${trimmed}%` };

  if (type === "sales_order") {
    const rows = await queryRows(
      `
        SELECT TOP 50 T0.DocEntry, T0.DocNum, T0.CardCode, T0.CardName, T0.DocDate, T0.DocDueDate
        FROM ORDR T0
        WHERE ISNULL(T0.CANCELED, 'N') = 'N'
          AND ISNULL(T0.DocStatus, 'O') = 'O'
          AND (
            @query = ''
            OR CAST(T0.DocNum AS NVARCHAR(50)) LIKE @like
            OR ISNULL(T0.CardCode, '') LIKE @like
            OR ISNULL(T0.CardName, '') LIKE @like
          )
        ORDER BY T0.DocEntry DESC
      `,
      params
    );

    return rows.map((row) => ({
      DocEntry: row.DocEntry,
      DocNum: row.DocNum,
      CardCode: row.CardCode || "",
      CardName: row.CardName || "",
      DocDate: formatDate(row.DocDate),
      DueDate: formatDate(row.DocDueDate),
      LinkedTo: "sales_order",
    }));
  }

  if (type === "production_order") {
    const rows = await queryRows(
      `
        SELECT TOP 50 DocEntry, DocNum, ItemCode, ProdName, PlannedQty, Status, DueDate
        FROM OWOR
        WHERE Status IN ('P', 'R')
          AND (
            @query = ''
            OR CAST(DocNum AS NVARCHAR(50)) LIKE @like
            OR ISNULL(ItemCode, '') LIKE @like
            OR ISNULL(ProdName, '') LIKE @like
          )
        ORDER BY DocEntry DESC
      `,
      params
    );

    return rows.map((row) => ({
      DocEntry: row.DocEntry,
      DocNum: row.DocNum,
      ItemNo: row.ItemCode || "",
      ProductDescription: row.ProdName || "",
      PlannedQuantity: row.PlannedQty ?? 0,
      Status: toProductionStatus(row.Status),
      DueDate: formatDate(row.DueDate),
      LinkedTo: "production_order",
    }));
  }

  return [];
};

const itemWarehouseFallbackJoin = `
      LEFT JOIN (
        SELECT ItemCode, WhsCode
        FROM (
          SELECT
            W.ItemCode,
            W.WhsCode,
            ROW_NUMBER() OVER (
              PARTITION BY W.ItemCode
              ORDER BY
                CASE WHEN ISNULL(W.Locked, 'N') <> 'Y' AND ISNULL(WH.Inactive, 'N') <> 'Y' THEN 0 ELSE 1 END,
                CASE WHEN ISNULL(W.OnHand, 0) > 0 THEN 0 ELSE 1 END,
                W.WhsCode
            ) AS RowNum
          FROM OITW W
          LEFT JOIN OWHS WH ON WH.WhsCode = W.WhsCode
        ) RankedWarehouses
        WHERE RowNum = 1
      ) IW ON IW.ItemCode = I.ItemCode
`;

const lookupProductionOrderItems = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(
    `
      SELECT
             T.Code AS TreeCode,
             T.Name AS ProductDescription,
             T.Qauntity AS BOMQuantity,
             T.ToWH AS BOMWarehouse,
             T.TreeType,
             I.ItemCode,
             I.ItemName,
             I.InvntryUom,
             COALESCE(NULLIF(I.DfltWH, ''), IW.WhsCode, '') AS DefaultWarehouse,
             CAST(ISNULL(I.OnHand, 0) AS DECIMAL(19, 6)) AS QuantityOnStock,
             I.PrcrmntMtd AS ProcurementMethod
      FROM OITM I
      INNER JOIN OITT T ON T.Code = I.ItemCode
        AND T.TreeType = 'P'
      ${itemWarehouseFallbackJoin}
      WHERE (
        @query = ''
        OR T.Code LIKE @like
        OR T.Name LIKE @like
        OR I.ItemCode LIKE @like
        OR I.ItemName LIKE @like
      )
        AND ISNULL(I.validFor, 'Y') = 'Y'
        AND ISNULL(I.frozenFor, 'N') = 'N'
      ORDER BY T.Code
    `,
    { query: trimmed, like: `%${trimmed}%` }
  );

  return rows.map((row) => ({
    TreeCode: row.TreeCode,
    ItemCode: row.TreeCode || row.ItemCode,
    ProductDescription: row.ProductDescription || row.ItemName || "",
    ItemName: row.ProductDescription || row.ItemName || "",
    InventoryUOM: row.InvntryUom || "",
    UoMName: row.InvntryUom || "",
    BOMQuantity: row.BOMQuantity ?? 1,
    BOMWarehouse: row.BOMWarehouse || "",
    Warehouse: row.BOMWarehouse || row.DefaultWarehouse || "",
    DefaultWarehouse: row.DefaultWarehouse || "",
    TreeType: "iProductionTree",
    QuantityOnStock: row.QuantityOnStock ?? 0,
    InStock: row.QuantityOnStock ?? 0,
    ProcurementMethod: row.ProcurementMethod || "",
  }));
};

const lookupFinishItems = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(
    `
      SELECT
             I.ItemCode,
             I.ItemName,
             CAST(ISNULL(I.OnHand, 0) AS DECIMAL(19, 6)) AS InStock,
             G.ItmsGrpNam AS ItemGroup,
             I.InvntryUom,
             COALESCE(NULLIF(I.DfltWH, ''), IW.WhsCode, '') AS DefaultWarehouse
      FROM OITM I
      LEFT JOIN OITB G ON G.ItmsGrpCod = I.ItmsGrpCod
      ${itemWarehouseFallbackJoin}
      WHERE (
        @query = ''
        OR I.ItemCode LIKE @like
        OR I.ItemName LIKE @like
      )
        AND ISNULL(I.validFor, 'Y') = 'Y'
        AND ISNULL(I.frozenFor, 'N') = 'N'
      ORDER BY I.ItemName, I.ItemCode
    `,
    { query: trimmed, like: `%${trimmed}%` }
  );

  return rows.map((row) => ({
    ItemDescription: row.ItemName || "",
    ItemNo: row.ItemCode || "",
    ItemCode: row.ItemCode || "",
    ItemName: row.ItemName || "",
    InStock: row.InStock ?? 0,
    ItemGroup: row.ItemGroup || "",
    InventoryUOM: row.InvntryUom || "",
    UoMName: row.InvntryUom || "",
    DefaultWarehouse: row.DefaultWarehouse || "",
    Warehouse: row.DefaultWarehouse || "",
  }));
};

const lookupComponentItems = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(
    `
      SELECT
        I.ItemCode,
        I.ItemName,
        I.InvntryUom,
        COALESCE(NULLIF(I.DfltWH, ''), IW.WhsCode, '') AS DefaultWarehouse,
        I.ManSerNum,
        I.ManBtchNum
      FROM OITM I
      ${itemWarehouseFallbackJoin}
      WHERE I.InvntItem = 'Y'
        AND (
          @query = ''
          OR I.ItemCode LIKE @like
          OR I.ItemName LIKE @like
        )
      ORDER BY I.ItemCode
    `,
    { query: trimmed, like: `%${trimmed}%` }
  );

  return rows.map((row) => ({
    ItemCode: row.ItemCode,
    ItemName: row.ItemName || "",
    InventoryUOM: row.InvntryUom || "",
    DefaultWarehouse: row.DefaultWarehouse || "",
    ManageSerialNumbers: yesNo(row.ManSerNum),
    ManageBatchNumbers: yesNo(row.ManBtchNum),
  }));
};

const lookupResources = async (query = "") => {
  if (!(await tableExists("ORSC"))) return [];
  const columns = await getTableColumns("ORSC");
  const trimmed = String(query || "").trim();
  const rows = await queryRows(
    `
      SELECT TOP 500 ResCode, ResName,
             ${selectOptionalColumn(columns, "ORSC", "DfltWH", "DfltWH", "''")}
      FROM ORSC
      WHERE ${columns.has("PRODRES") ? "ProdRes = 'Y'" : "1 = 1"}
        AND (
          @query = ''
          OR ResCode LIKE @like
          OR ResName LIKE @like
        )
      ORDER BY ResCode
    `,
    { query: trimmed, like: `%${trimmed}%` }
  );

  return rows.map((row) => ({
    Code: row.ResCode,
    Name: row.ResName || "",
    DefaultWarehouse: row.DfltWH || "",
    IssueMethod: "rimManually",
  }));
};

const mapProductionOrderSummary = (row) => ({
  doc_entry: row.DocEntry,
  doc_num: row.DocNum,
  item_code: row.ItemCode || "",
  item_name: row.ProdName || "",
  planned_qty: row.PlannedQty ?? 0,
  completed_qty: row.CmpltQty ?? 0,
  due_date: formatDate(row.DueDate),
  posting_date: formatDate(row.PostDate),
  status: toProductionStatus(row.Status),
  type: toProductionType(row.Type),
  warehouse: row.Warehouse || "",
});

const buildProductionOrderWhere = (query = "", status = "", type = "", dateFrom = "", dateTo = "") => {
  const trimmed = String(query || "").trim();
  const clauses = [
    `(@query = '' OR T0.ItemCode LIKE @like OR T0.ProdName LIKE @like OR CAST(T0.DocNum AS NVARCHAR(50)) LIKE @like)`,
  ];

  const statusCode =
    status === "boposPlanned"
      ? "P"
      : status === "boposReleased"
        ? "R"
        : status === "boposClosed"
          ? "L"
          : status === "boposCancelled"
            ? "C"
            : "";

  if (statusCode) clauses.push(`T0.Status = @statusCode`);
  const typeCode = { bopotStandard: "S", bopotSpecial: "P", bopotDisassemble: "D" }[type] || "";
  if (typeCode) clauses.push(`T0.Type = @typeCode`);
  if (dateFrom) clauses.push(`T0.DueDate >= @dateFrom`);
  if (dateTo) clauses.push(`T0.DueDate <= @dateTo`);

  return {
    where: clauses.join(" AND "),
    params: { query: trimmed, like: `%${trimmed}%`, statusCode, typeCode, dateFrom: dateFrom || null, dateTo: dateTo || null },
  };
};

// List / Find: text search plus SAP filters (status, type, due date range).
const getProductionOrders = async ({ query = "", top = 50, skip = 0, status = "", type = "", dateFrom = "", dateTo = "" } = {}) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const where = buildProductionOrderWhere(query, status, type, dateFrom, dateTo);
  const rows = await queryRows(
    `
      SELECT T0.DocEntry, T0.DocNum, T0.ItemCode, T0.ProdName, T0.PlannedQty, T0.CmpltQty,
             T0.DueDate, T0.PostDate, T0.Status, T0.Type, T0.Warehouse
      FROM OWOR T0
      WHERE ${where.where}
      ORDER BY T0.DocEntry DESC
      OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
    `,
    { ...where.params, top: limit, skip: offset }
  );

  return { orders: rows.map(mapProductionOrderSummary) };
};

// SAP Production Order "Summary" tab: actual costs from the non-cancelled issues
// and receipts, planned costs from the component rows, the closing variance, and
// the documents posted against the order.
const getProductionOrderSummary = async (row) => {
  const entry = row.DocEntry;
  const [issues, receipts, planned, variance] = await Promise.all([
    queryRows(`
      SELECT H.DocEntry, H.DocNum, H.DocDate, H.CANCELED, L.ItemCode, L.LineTotal, L.Quantity, L.ItemType
      FROM OIGE H INNER JOIN IGE1 L ON L.DocEntry = H.DocEntry
      WHERE L.BaseType = 202 AND L.BaseEntry = @entry
      ORDER BY H.DocEntry`, { entry }),
    queryRows(`
      SELECT H.DocEntry, H.DocNum, H.DocDate, H.CANCELED, L.ItemCode, L.LineTotal, L.Quantity
      FROM OIGN H INNER JOIN IGN1 L ON L.DocEntry = H.DocEntry
      WHERE L.BaseType = 202 AND L.BaseEntry = @entry
      ORDER BY H.DocEntry`, { entry }),
    queryRows(`
      SELECT T1.ItemCode, T1.ItemType, T1.PlannedQty, ISNULL(I.AvgPrice, 0) AS AvgPrice, ISNULL(R.StdCost, 0) AS ResourceCost
      FROM WOR1 T1 LEFT JOIN OITM I ON I.ItemCode = T1.ItemCode LEFT JOIN ORSC R ON R.ResCode = T1.ItemCode
      WHERE T1.DocEntry = @entry`, { entry }),
    row.TransId ? queryRows(`SELECT Account, Debit, Credit FROM JDT1 WHERE TransId = @transId`, { transId: row.TransId }) : [],
  ]);
  const posted = (rows) => rows.filter((line) => line.CANCELED === 'N');
  const sum = (rows) => rows.reduce((total, line) => total + Number(line.LineTotal || 0), 0);
  const isProduct = (line) => line.ItemCode === row.ItemCode;
  const disassembly = String(row.Type || '').toUpperCase() === 'D';
  const issued = posted(issues);
  const received = posted(receipts);
  const isResource = (line) => Number(line.ItemType) === 290;
  const resourceCost = sum(issued.filter(isResource));
  const componentCost = sum(issued.filter((line) => !isResource(line) && (disassembly || !isProduct(line))));
  const productCost = disassembly ? sum(received) : sum(received.filter(isProduct));
  const byProductValue = disassembly ? 0 : sum(received.filter((line) => !isProduct(line)));
  const plannedComponentCost = planned
    .filter((line) => Number(line.ItemType) === 4 && Number(line.PlannedQty) > 0)
    .reduce((total, line) => total + Number(line.PlannedQty) * Number(line.AvgPrice), 0);
  const plannedResourceCost = planned
    .filter((line) => Number(line.ItemType) === 290 && Number(line.PlannedQty) > 0)
    .reduce((total, line) => total + Number(line.PlannedQty) * Number(line.ResourceCost), 0);
  const wip = componentCost + resourceCost - productCost - byProductValue;
  const closingVariance = variance.reduce((total, line) => total + Number(line.Debit || 0), 0);
  const documents = (rows, type) => [...new Map(rows.map((line) => [line.DocEntry, line])).values()].map((line) => ({
    type, doc_entry: line.DocEntry, doc_num: line.DocNum, posting_date: formatDate(line.DocDate),
    cancelled: line.CANCELED !== 'N',
    total: rows.filter((other) => other.DocEntry === line.DocEntry).reduce((total, other) => total + Number(other.LineTotal || 0), 0),
  }));
  return {
    summary: {
      actual_component_cost: componentCost,
      actual_resource_cost: resourceCost,
      actual_additional_cost: 0,
      total_actual_cost: componentCost + resourceCost,
      actual_product_cost: productCost,
      by_product_value: byProductValue,
      planned_component_cost: plannedComponentCost,
      planned_resource_cost: plannedResourceCost,
      total_planned_cost: plannedComponentCost + plannedResourceCost,
      wip_balance: row.TransId ? 0 : wip,
      total_variance: row.TransId ? closingVariance : wip,
      variance_trans_id: row.TransId ?? null,
    },
    related_documents: [...documents(issues, 'Issue for Production'), ...documents(receipts, 'Receipt from Production')],
  };
};

// SAP record browsing (First / Previous / Next / Last) per production object.
const NAVIGATION = {
  'production-order': { table: 'OWOR', key: 'DocEntry', numeric: true },
  bom: { table: 'OITT', key: 'Code', numeric: false },
  'issue-for-production': { table: 'OIGE', key: 'DocEntry', numeric: true, line: 'IGE1' },
  'receipt-from-production': { table: 'OIGN', key: 'DocEntry', numeric: true, line: 'IGN1' },
};
const navigateRecord = async (kind, direction = 'next', from = '') => {
  const nav = NAVIGATION[kind];
  if (!nav) throw Object.assign(new Error(`Unknown object ${kind}.`), { status: 400 });
  const hasFrom = from !== '' && from != null;
  let dir = String(direction || 'next').toLowerCase();
  if (!hasFrom && dir === 'next') dir = 'first';
  if (!hasFrom && dir === 'prev') dir = 'last';
  const conditions = [];
  if (nav.line) conditions.push(`T.CANCELED <> 'C' AND EXISTS (SELECT 1 FROM ${nav.line} X WHERE X.DocEntry = T.DocEntry AND X.BaseType = 202)`);
  if (dir === 'next') conditions.push(`T.${nav.key} > @from`);
  if (dir === 'prev') conditions.push(`T.${nav.key} < @from`);
  const descending = dir === 'last' || dir === 'prev';
  const row = await queryOne(`
    SELECT TOP 1 T.${nav.key} AS RecordKey FROM ${nav.table} T
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY T.${nav.key} ${descending ? 'DESC' : 'ASC'}
  `, { from: nav.numeric ? toInt(from, 0) : String(from || '') });
  return row ? row.RecordKey : null;
};

const getProductionOrderByDocEntry = async (docEntry) => {
  const entry = toInt(docEntry, 0);
  const [oworColumns, wor1Columns] = await Promise.all([
    getTableColumns("OWOR"),
    getTableColumns("WOR1"),
  ]);

  const row = await queryOne(
    `
      SELECT T0.DocEntry, T0.DocNum, T0.ItemCode, T0.ProdName, T0.PlannedQty, T0.CmpltQty, T0.RjctQty,
             T0.DueDate, T0.PostDate, T0.StartDate, T0.Status, T0.Type, T0.Warehouse, T0.OcrCode,
             T0.Project, T0.JrnlMemo, T0.Comments, T0.Series, T0.OriginNum, T0.CardCode,
             BP.CardName, I.InvntryUom AS UoMName, USR.USERID AS UserID, USR.USER_CODE AS UserCode, USR.U_NAME AS UserName,
             ${selectOptionalColumn(oworColumns, "T0", "Priority", "Priority", "100")},
             ${selectOptionalColumn(oworColumns, "T0", "OriginType", "OriginType", "''")},
             ${selectOptionalColumn(oworColumns, "T0", "OriginAbs", "OriginAbs", "NULL")},
             ${selectOptionalColumn(oworColumns, "T0", "BPLId", "BPLId", "NULL")},
             ${selectOptionalColumn(oworColumns, "T0", "CloseDate", "CloseDate", "NULL")},
             ${selectOptionalColumn(oworColumns, "T0", "PickRmrk", "PickRmrk", "''")},
             ${selectOptionalColumn(oworColumns, "T0", "TransId", "TransId", "NULL")}
      FROM OWOR T0
      LEFT JOIN OCRD BP ON BP.CardCode = T0.CardCode
      LEFT JOIN OITM I ON I.ItemCode = T0.ItemCode
      LEFT JOIN OUSR USR ON USR.USERID = T0.UserSign
      WHERE T0.DocEntry = @docEntry
    `,
    { docEntry: entry }
  );

  if (!row) return null;

  const lines = await queryRows(
    `
      SELECT T1.DocEntry, T1.LineNum, T1.ItemCode, T1.ItemName, T1.LineText, T1.BaseQty, T1.PlannedQty,
             T1.IssuedQty, T1.UomCode, T1.wareHouse, T1.IssueType, T1.OcrCode, T1.Project,
             T1.AdditQty, T1.StageId, T1.ItemType, T1.VisOrder,
             I.InvntryUom AS UoMName, I.PrcrmntMtd AS ProcurementMethod,
             CAST(ISNULL(W.OnHand, I.OnHand) - ISNULL(W.IsCommited, I.IsCommited) AS DECIMAL(19, 6)) AS AvailableQty,
             ${selectOptionalColumn(wor1Columns, "T1", "WipActCode", "WipAccount", "''")}
      FROM WOR1 T1
      LEFT JOIN OITM I ON I.ItemCode = T1.ItemCode
      LEFT JOIN OITW W ON W.ItemCode = T1.ItemCode AND W.WhsCode = T1.wareHouse
      WHERE T1.DocEntry = @docEntry
      ORDER BY T1.LineNum
    `,
    { docEntry: entry }
  );

  const { summary, related_documents: relatedDocuments } = await getProductionOrderSummary(row);
  const stages = await masterDataDbService.stagesOf("WOR4", "DocEntry", entry);
  return {
    production_order: {
      summary,
      related_documents: relatedDocuments,
      stages,
      closing_date: formatDate(row.CloseDate),
      pick_remarks: row.PickRmrk || "",
      doc_entry: row.DocEntry,
      doc_num: row.DocNum,
      item_code: row.ItemCode || "",
      item_name: row.ProdName || "",
      uom_name: row.UoMName || "",
      planned_qty: row.PlannedQty ?? 1,
      completed_qty: row.CmpltQty ?? 0,
      rejected_qty: row.RjctQty ?? 0,
      due_date: formatDate(row.DueDate),
      posting_date: formatDate(row.PostDate),
      start_date: formatDate(row.StartDate),
      order_date: formatDate(row.PostDate),
      status: toProductionStatus(row.Status),
      type: toProductionType(row.Type),
      warehouse: row.Warehouse || "",
      priority: row.Priority ?? 100,
      distribution_rule: row.OcrCode || "",
      project: row.Project || "",
      journal_remark: row.JrnlMemo || "",
      remarks: row.Comments || "",
      series: row.Series != null ? String(row.Series) : "",
      origin_num: row.OriginNum != null ? String(row.OriginNum) : "",
      origin: { S: "Sales Order", P: "Production Order", R: "MRP" }[String(row.OriginType || "").toUpperCase()] || "Manual",
      linked_to: toLinkedToValue(row.OriginType),
      linked_order: row.OriginAbs != null ? String(row.OriginAbs) : "",
      user_id: row.UserID != null ? String(row.UserID) : "",
      user: row.UserCode || row.UserName || "",
      branch: row.BPLId != null ? String(row.BPLId) : "",
      branch_name: "",
      customer_code: row.CardCode || "",
      customer_name: row.CardName || "",
      lines: lines.map((line) => ({
        _id: line.LineNum ?? Math.random(),
        line_num: line.LineNum ?? 0,
        item_code: line.ItemCode || "",
        item_name: line.ItemName || line.LineText || "",
        line_text: line.LineText || "",
        base_qty: line.BaseQty ?? 1,
        base_ratio: row.PlannedQty ? Number((((line.PlannedQty ?? 0) - (line.AdditQty ?? 0)) / row.PlannedQty).toFixed(6)) : (line.BaseQty ?? 1),
        planned_qty: line.PlannedQty ?? 1,
        issued_qty: line.IssuedQty ?? 0,
        available_qty: line.AvailableQty ?? 0,
        uom: line.UomCode || line.UoMName || "",
        uom_code: line.UomCode || line.UoMName || "",
        uom_name: line.UoMName || line.UomCode || "",
        warehouse: line.wareHouse || "",
        issue_method: toIssueMethod(line.IssueType),
        wip_account: line.WipAccount || "",
        distribution_rule: line.OcrCode || "",
        project: line.Project || "",
        location: "",
        additional_qty: line.AdditQty ?? 0,
        stage_id: line.StageId ?? "",
        route_sequence: line.StageId ?? "",
        procurement_method: line.ProcurementMethod || "",
        component_type: toItemType(line.ItemType),
      })),
    },
  };
};

const explodeBOM = async (itemCode, qty = 1) => {
  const bom = await masterDataDbService.getBOM(itemCode);
  if (!bom) {
    const error = new Error(`No BOM found for item "${itemCode}".`);
    error.status = 404;
    throw error;
  }

  const stockRows = await queryRows(
    `
      SELECT L.ChildNum, L.Code, L.Warehouse,
             CAST(ISNULL(W.OnHand, I.OnHand) - ISNULL(W.IsCommited, I.IsCommited) AS DECIMAL(19, 6)) AS AvailableQty,
             I.InvntryUom AS UoMName,
             I.PrcrmntMtd AS ProcurementMethod,
             R.ResName AS ResourceName,
             R.DfltWH AS ResourceWarehouse
      FROM ITT1 L
      LEFT JOIN OITM I ON I.ItemCode = L.Code
      LEFT JOIN ORSC R ON R.ResCode = L.Code
      LEFT JOIN OITW W
        ON W.ItemCode = L.Code
       AND W.WhsCode = COALESCE(NULLIF(L.Warehouse, ''), NULLIF(@warehouse, ''))
      WHERE L.Father = @itemCode
    `,
    { itemCode, warehouse: bom.Warehouse || "" }
  );
  const detailByChild = new Map(
    stockRows.map((row) => [`${row.ChildNum ?? ""}:${row.Code || ""}`, row])
  );

  const factor = Number(qty) / (bom.Quantity || 1);
  return {
    item_code: bom.TreeCode,
    item_name: bom.ProductDescription || "",
    bom_qty: bom.Quantity ?? 1,
    warehouse: bom.Warehouse || "",
    uom_name: bom.InventoryUOM || "",
    distribution_rule: bom.DistributionRule || "",
    project: bom.Project || "",
    stages: bom.ProductTreeStages || [],
    lines: (bom.ProductTreeLines || []).map((line, idx) => {
      const detail = detailByChild.get(`${line.ChildNum ?? ""}:${line.ItemCode || ""}`) || {};
      const baseQty = line.Quantity ?? 1;
      const additionalQty = line.AdditionalQuantity ?? 0;
      const componentType = toItemType(line.ItemType);
      const uom = line.InventoryUOM || detail.UoMName || "";
      const plannedQty = (baseQty * factor) + Number(additionalQty || 0);
      return {
        _id: Date.now() + idx + Math.random(),
        line_num: idx,
        item_code: line.ItemCode || "",
        item_name: line.ItemName || detail.ResourceName || "",
        line_text: line.Comment || "",
        base_qty: baseQty,
        base_ratio: Number((baseQty / (bom.Quantity || 1)).toFixed(6)),
        planned_qty: parseFloat(plannedQty.toFixed(6)),
        issued_qty: 0,
        available_qty: componentType === "pit_Item" ? (detail.AvailableQty ?? 0) : 0,
        uom,
        uom_code: uom,
        uom_name: detail.UoMName || uom,
        warehouse: line.Warehouse || detail.ResourceWarehouse || bom.Warehouse || "",
        issue_method: line.IssueMethod || "im_Manual",
        wip_account: line.WipAccount || "",
        distribution_rule: line.DistributionRule || bom.DistributionRule || "",
        project: line.Project || bom.Project || "",
        location: "",
        additional_qty: additionalQty,
        stage_id: line.StageID ?? "",
        route_sequence: line.RouteSequence || line.StageID || "",
        procurement_method: detail.ProcurementMethod || "",
        component_type: componentType,
      };
    }),
  };
};

const getProductionOrderReferenceData = async ({ postingDate = new Date(), branch = "" } = {}) => {
  const [warehouses, distributionRules, projects, productionSeries, branches, routeStages, users, linkedToOptions] = await Promise.all([
    lookupProdWarehouses(branch),
    lookupDistributionRules(),
    lookupProjects(),
    lookupSeries("202", postingDate, branch),
    lookupBranches(),
    lookupRouteStages(""),
    lookupUsers(),
    lookupLinkedToOptions(),
  ]);
  const defaultSeries = pickDefaultSeries(productionSeries);

  return {
    warehouses,
    distribution_rules: distributionRules,
    projects,
    series: productionSeries,
    default_series: defaultSeries?.Series != null ? String(defaultSeries.Series) : "",
    branches,
    route_stages: routeStages,
    users,
    linked_to_options: linkedToOptions,
    production_order_statuses: [
      { value: "boposPlanned", label: "Planned" },
      { value: "boposReleased", label: "Released" },
      { value: "boposClosed", label: "Closed" },
      { value: "boposCancelled", label: "Cancelled" },
    ],
    production_order_types: [
      { value: "bopotStandard", label: "Standard" },
      { value: "bopotSpecial", label: "Special" },
      { value: "bopotDisassemble", label: "Disassemble" },
    ],
    production_order_priorities: PRODUCTION_PRIORITY_OPTIONS,
    warnings: [],
  };
};

const lookupOpenProductionOrders = async (query = "", releasedOnly = false, type = "", options = {}) => {
  const trimmed = String(query || "").trim();
  const normalizedType = String(type || "").toLowerCase();
  const typeCode = normalizedType === "disassembly" ? "D" : "";
  const excludeDisassembly = normalizedType === "production" ? 1 : 0;
  const issueableOnly = Boolean(options.issueableOnly);
  const receiptOpenOnly = Boolean(options.receiptOpenOnly);
  const issueableClause = issueableOnly
    ? `
        AND EXISTS (
          SELECT 1
          FROM WOR1 L
          WHERE L.DocEntry = T0.DocEntry
            AND ISNULL(L.IssueType, 'M') <> 'B'
            AND CAST(ISNULL(L.PlannedQty, 0) - ISNULL(L.IssuedQty, 0) AS DECIMAL(19, 6)) > 0
        )
      `
    : "";
  const receiptOpenClause = receiptOpenOnly
    ? "AND CAST(ISNULL(T0.PlannedQty, 0) - ISNULL(T0.CmpltQty, 0) AS DECIMAL(19, 6)) > 0"
    : "";
  const orderBy = issueableOnly || receiptOpenOnly
    ? "ORDER BY T0.DueDate ASC, T0.DocNum ASC"
    : "ORDER BY T0.DocEntry DESC";
  const rows = await queryRows(
    `
      SELECT TOP 50 T0.DocEntry, T0.DocNum, T0.ItemCode, T0.ProdName, T0.PlannedQty, T0.CmpltQty,
             T0.Status, T0.Type, T0.Warehouse, T0.DueDate, T0.PostDate, T0.StartDate,
             T0.Series, S.SeriesName
      FROM OWOR T0
      LEFT JOIN NNM1 S ON S.Series = T0.Series AND S.ObjectCode = '202'
      WHERE T0.Status IN (${releasedOnly ? `'R'` : `'P','R'`})
        AND (@typeCode = '' OR T0.Type = @typeCode)
        AND (@excludeDisassembly = 0 OR ISNULL(T0.Type, '') <> 'D')
        ${issueableClause}
        ${receiptOpenClause}
        AND (
          @query = ''
          OR T0.ItemCode LIKE @like
          OR T0.ProdName LIKE @like
          OR S.SeriesName LIKE @like
          OR CAST(T0.DocNum AS NVARCHAR(50)) LIKE @like
        )
      ${orderBy}
    `,
    { query: trimmed, like: `%${trimmed}%`, typeCode, excludeDisassembly }
  );

  return rows.map((row) => ({
    DocEntry: row.DocEntry,
    DocNum: row.DocNum,
    Series: row.Series,
    SeriesName: row.SeriesName || "",
    Type: toProductionType(row.Type),
    ItemNo: row.ItemCode || "",
    ProductDescription: row.ProdName || "",
    PlannedQuantity: row.PlannedQty ?? 0,
    CompletedQuantity: row.CmpltQty ?? 0,
    ProductionOrderStatus: toProductionStatus(row.Status),
    Warehouse: row.Warehouse || "",
    DueDate: formatDate(row.DueDate),
    PostingDate: formatDate(row.PostDate),
    StartDate: formatDate(row.StartDate),
  }));
};

const getProductionOrderForIssue = async (docEntry) => {
  const entry = toInt(docEntry, 0);
  const row = await queryOne(
    `
      SELECT T0.DocEntry, T0.DocNum, T0.ItemCode, T0.ProdName, T0.PlannedQty, T0.CmpltQty,
             T0.Status, T0.Type, T0.Warehouse, T0.DueDate, T0.PostDate, T0.StartDate,
             T0.Series, S.SeriesName,
             I.ManBtchNum AS ParentManBtchNum, I.ManSerNum AS ParentManSerNum,
             IW.OnHand AS ParentOnHand, I.AvgPrice AS ParentAvgPrice,
             WH.BinActivat AS ParentBinActivat
      FROM OWOR T0
      LEFT JOIN NNM1 S ON S.Series = T0.Series AND S.ObjectCode = '202'
      LEFT JOIN OITM I ON I.ItemCode = T0.ItemCode
      LEFT JOIN OITW IW ON IW.ItemCode = T0.ItemCode AND IW.WhsCode = T0.Warehouse
      LEFT JOIN OWHS WH ON WH.WhsCode = T0.Warehouse
      WHERE T0.DocEntry = @docEntry
    `,
    { docEntry: entry }
  );

  if (!row) return null;
  if (String(row.Status || "").toUpperCase() !== "R") {
    throw new Error("Production order must be Released before issuing components.");
  }

  const lines = await queryRows(
    `
      SELECT T1.LineNum, T1.ItemCode, T1.ItemName, T1.PlannedQty, T1.IssuedQty, T1.UomCode, T1.wareHouse,
             T1.IssueType, T1.OcrCode, T1.Project, T1.ItemType,
             I.ManBtchNum, I.ManSerNum, COALESCE(I.AvgPrice, R.StdCost) AS AvgPrice, W.OnHand, L.Location AS LocationName
      FROM WOR1 T1
      LEFT JOIN OITM I ON I.ItemCode = T1.ItemCode
      LEFT JOIN ORSC R ON R.ResCode = T1.ItemCode
      LEFT JOIN OITW W ON W.ItemCode = T1.ItemCode AND W.WhsCode = T1.wareHouse
      LEFT JOIN OWHS WH ON WH.WhsCode = T1.wareHouse
      LEFT JOIN OLCT L ON L.Code = WH.Location
      WHERE T1.DocEntry = @docEntry
      ORDER BY T1.LineNum
    `,
    { docEntry: entry }
  );

  const isDisassembly = String(row.Type || "").toUpperCase() === "D";
  const manualLines = isDisassembly
    ? [{
        LineNum: 0,
        ItemCode: row.ItemCode,
        ItemName: row.ProdName,
        PlannedQty: row.PlannedQty,
        IssuedQty: row.CmpltQty,
        UomCode: "",
        wareHouse: row.Warehouse,
        IssueType: "M",
        ManBtchNum: row.ParentManBtchNum,
        ManSerNum: row.ParentManSerNum,
        AvgPrice: row.ParentAvgPrice,
        OnHand: row.ParentOnHand,
        BinActivat: row.ParentBinActivat,
      }]
    : lines.filter((line) => toIssueMethod(line.IssueType) !== "im_Backflush" && Number(line.PlannedQty ?? 0) > 0
      && [4, 290].includes(Number(line.ItemType ?? 4)));

  return {
    doc_entry: row.DocEntry,
    doc_num: row.DocNum,
    series: row.Series != null ? String(row.Series) : "",
    series_name: row.SeriesName || "",
    item_code: row.ItemCode || "",
    item_name: row.ProdName || "",
    planned_qty: row.PlannedQty ?? 1,
    completed_qty: row.CmpltQty ?? 0,
    status: toProductionStatus(row.Status),
    type: toProductionType(row.Type),
    warehouse: row.Warehouse || "",
    due_date: formatDate(row.DueDate),
    posting_date: formatDate(row.PostDate),
    start_date: formatDate(row.StartDate),
    lines_total_count: lines.length,
    lines: manualLines.map((line) => ({
      _id: line.LineNum ?? Math.random(),
      line_num: line.LineNum ?? 0,
      order_no: row.DocNum != null ? String(row.DocNum) : "",
      series_no: row.SeriesName || "",
      line_type: Number(line.ItemType) === 290 ? "Resource" : "Item",
      component_type: Number(line.ItemType) === 290 ? "pit_Resource" : "pit_Item",
      item_code: line.ItemCode || "",
      item_name: line.ItemName || "",
      planned_qty: line.PlannedQty ?? 0,
      issued_qty: line.IssuedQty ?? 0,
      remaining_qty: Math.max(0, (line.PlannedQty ?? 0) - (line.IssuedQty ?? 0)),
      issue_qty: Math.max(0, (line.PlannedQty ?? 0) - (line.IssuedQty ?? 0)),
      uom: line.UomCode || "",
      uom_name: line.UomCode || "",
      warehouse: line.wareHouse || row.Warehouse || "",
      item_cost: line.AvgPrice ?? "",
      available_qty: line.OnHand ?? "",
      location: line.LocationName || "",
      sauda_node_ref: "",
      ap_inv_doc_key: "",
      issue_method: toIssueMethod(line.IssueType),
      distribution_rule: line.OcrCode || "",
      project: line.Project || "",
      base_entry: row.DocEntry,
      base_line: line.LineNum ?? 0,
      base_type: 202,
      manage_batch: String(line.ManBtchNum || "").toUpperCase() === "Y",
      manage_serial: String(line.ManSerNum || "").toUpperCase() === "Y",
      enable_bin_locations: String(line.BinActivat || "").toUpperCase() === "Y",
      batch_numbers: [],
      serial_numbers: [],
      bin_allocations: [],
    })),
  };
};

const getIssueReferenceData = async ({ postingDate = new Date(), branch = "" } = {}) => ({
  warehouses: await lookupProdWarehouses(branch),
  distribution_rules: await lookupDistributionRules(),
  projects: await lookupProjects(),
  branches: await lookupBranches(),
  series: await lookupSeries("60", postingDate, branch),
  warnings: [],
});

const getIssueList = async ({ query = "", top = 50, skip = 0 } = {}) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const rows = await queryRows(
    `
      SELECT
        T0.DocEntry,
        T0.DocNum,
        T0.DocDate,
        T0.TaxDate,
        T0.Ref2,
        T0.Comments,
        T0.JrnlMemo,
        T0.CANCELED,
        MIN(T1.BaseRef) AS ProductionOrderNo,
        COUNT(T1.LineNum) AS TotalLines
      FROM OIGE T0
      INNER JOIN IGE1 T1 ON T1.DocEntry = T0.DocEntry
      WHERE EXISTS (
        SELECT 1
        FROM IGE1 X
        WHERE X.DocEntry = T0.DocEntry
          AND X.BaseType = 202
      )
        AND (
          @query = ''
          OR CAST(T0.DocNum AS NVARCHAR(50)) LIKE @like
          OR ISNULL(T0.Comments, '') LIKE @like
          OR ISNULL(T0.Ref2, '') LIKE @like
          OR ISNULL(T0.JrnlMemo, '') LIKE @like
          OR ISNULL(T1.BaseRef, '') LIKE @like
        )
      GROUP BY T0.DocEntry, T0.DocNum, T0.DocDate, T0.TaxDate, T0.Ref2, T0.Comments, T0.JrnlMemo, T0.CANCELED
      ORDER BY T0.DocEntry DESC
      OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
    `,
    { query: trimmed, like: `%${trimmed}%`, top: limit, skip: offset }
  );

  return {
    issues: rows.map((row) => ({
      doc_entry: row.DocEntry,
      doc_num: row.DocNum,
      posting_date: formatDate(row.DocDate),
      document_date: formatDate(row.TaxDate),
      ref_2: row.Ref2 || "",
      journal_remark: row.JrnlMemo || "",
      production_order_no: row.ProductionOrderNo || "",
      remarks: row.Comments || "",
      total_lines: row.TotalLines ?? 0,
      cancelled: row.CANCELED === "Y",
    })),
  };
};

const getIssueByDocEntry = async (docEntry) => {
  const entry = toInt(docEntry, 0);
  const headerColumns = await getTableColumns("OIGE");
  const row = await queryOne(
    `
      SELECT DocEntry, DocNum, Series, DocDate, TaxDate, Ref2, Comments, JrnlMemo, CANCELED, TransId,
             ${selectOptionalColumn(headerColumns, "OIGE", "BPLId", "BPLId", "NULL")}
      FROM OIGE
      WHERE DocEntry = @docEntry
    `,
    { docEntry: entry }
  );

  if (!row) return null;

  const lines = await queryRows(
    `
      SELECT LineNum, BaseRef, ItemCode, Dscription, Quantity, StockPrice, UomCode, unitMsr, WhsCode, BaseEntry, BaseLine, BaseType, OcrCode, Project, AcctCode, LocCode
      FROM IGE1
      WHERE DocEntry = @docEntry
      ORDER BY LineNum
    `,
    { docEntry: entry }
  );

  const prodBaseEntry = lines.find((line) => line.BaseType === 202)?.BaseEntry ?? null;

  return {
    issue: {
      cancelled: row.CANCELED === "Y",
      trans_id: row.TransId ?? null,
      doc_entry: row.DocEntry,
      doc_num: row.DocNum,
      series: row.Series != null ? String(row.Series) : "",
      posting_date: formatDate(row.DocDate),
      document_date: formatDate(row.TaxDate),
      ref_2: row.Ref2 || "",
      branch: row.BPLId != null ? String(row.BPLId) : "",
      remarks: row.Comments || "",
      journal_remark: row.JrnlMemo || "",
      prod_order_entry: prodBaseEntry,
      lines: lines.map((line) => ({
        _id: line.LineNum ?? Math.random(),
        line_num: line.LineNum ?? 0,
        order_no: line.BaseRef || "",
        series_no: "",
        line_type: "Item",
        item_code: line.ItemCode || "",
        item_name: line.Dscription || "",
        issue_qty: line.Quantity ?? 0,
        item_cost: line.StockPrice ?? "",
        uom: line.UomCode || line.unitMsr || "",
        uom_name: line.unitMsr || line.UomCode || "",
        warehouse: line.WhsCode || "",
        available_qty: "",
        location: line.LocCode || "",
        sauda_node_ref: "",
        ap_inv_doc_key: "",
        base_entry: line.BaseEntry ?? null,
        base_line: line.BaseLine ?? null,
        base_type: line.BaseType ?? 202,
        distribution_rule: line.OcrCode || "",
        project: line.Project || "",
        account_code: line.AcctCode || "",
      })),
    },
  };
};

const getProductionOrderForReceipt = async (docEntry) => {
  const entry = toInt(docEntry, 0);
  const row = await queryOne(
    `
      SELECT T0.DocEntry, T0.DocNum, T0.ItemCode, T0.ProdName, T0.PlannedQty, T0.CmpltQty,
             T0.Status, T0.Type, T0.Warehouse, T0.DueDate, T0.Series, S.SeriesName,
             I.InvntryUom, I.ManBtchNum, I.ManSerNum,
             W.BinActivat, W.RecBinEnab, W.DftBinAbs, W.AutoRecvMd
      FROM OWOR T0
      LEFT JOIN OITM I ON I.ItemCode = T0.ItemCode
      LEFT JOIN OWHS W ON W.WhsCode = T0.Warehouse
      LEFT JOIN NNM1 S ON S.Series = T0.Series AND S.ObjectCode = '202'
      WHERE T0.DocEntry = @docEntry
    `,
    { docEntry: entry }
  );

  if (!row) return null;
  if (String(row.Status || "").toUpperCase() !== "R") {
    throw new Error("Production order must be Released before receipt from production.");
  }

  const isDisassembly = String(row.Type || "").toUpperCase() === "D";
  const remainingQty = Math.max(0, (row.PlannedQty ?? 0) - (row.CmpltQty ?? 0));
  // A disassembly completes when its product is issued; its components are still received.
  if (remainingQty <= 0 && !isDisassembly) {
    throw new Error("Production order is fully completed. No remaining quantity to receive.");
  }

  const lines = await queryRows(
    `
      SELECT T1.LineNum, T1.ItemCode, T1.ItemName, T1.PlannedQty, T1.IssuedQty, T1.UomCode, T1.wareHouse,
             T1.IssueType, T1.OcrCode, T1.Project,
             I.InvntryUom, I.ManBtchNum, I.ManSerNum, I.AvgPrice,
             W.BinActivat, L.Location AS LocationName
      FROM WOR1 T1
      LEFT JOIN OITM I ON I.ItemCode = T1.ItemCode
      LEFT JOIN OWHS W ON W.WhsCode = T1.wareHouse
      LEFT JOIN OLCT L ON L.Code = W.Location
      WHERE T1.DocEntry = @docEntry
      ORDER BY T1.LineNum
    `,
    { docEntry: entry }
  );

  const backflushLines = lines.filter((line) => toIssueMethod(line.IssueType) === "im_Backflush");
  const manualLines = lines.filter((line) => toIssueMethod(line.IssueType) !== "im_Backflush");

  return {
    doc_entry: row.DocEntry,
    doc_num: row.DocNum,
    series: row.Series != null ? String(row.Series) : "",
    series_name: row.SeriesName || "",
    type: toProductionType(row.Type),
    item_code: row.ItemCode || "",
    item_name: row.ProdName || "",
    planned_qty: row.PlannedQty ?? 1,
    completed_qty: row.CmpltQty ?? 0,
    remaining_qty: remainingQty,
    status: toProductionStatus(row.Status),
    warehouse: row.Warehouse || "",
    due_date: formatDate(row.DueDate),
    inventory_uom: row.InvntryUom || "",
    uom_code: row.InvntryUom || "",
    uom_name: row.InvntryUom || "",
    manage_batch: String(row.ManBtchNum || "").toUpperCase() === "Y",
    manage_serial: String(row.ManSerNum || "").toUpperCase() === "Y",
    issue_primarily_by: "",
    enable_bin_locations: yesNo(row.BinActivat),
    enable_receiving_bin_locations: yesNo(row.RecBinEnab),
    default_bin: row.DftBinAbs ?? null,
    auto_alloc_on_receipt: row.AutoRecvMd === 1 ? "tYES" : "tNO",
    backflush_lines: backflushLines.map((line) => ({
      _id: line.LineNum ?? Math.random(),
      line_num: line.LineNum ?? 0,
      item_code: line.ItemCode || "",
      item_name: line.ItemName || "",
      bom_qty: line.PlannedQty ?? 0,
      issued_qty: line.IssuedQty ?? 0,
      uom: line.UomCode || "",
      warehouse: line.wareHouse || row.Warehouse || "",
      issue_method: "im_Backflush",
    })),
    manual_lines_count: manualLines.length,
    receipt_lines: (isDisassembly ? lines : lines.filter((line) => Number(line.PlannedQty ?? 0) < 0))
      .map((line, index) => ({
          _id: line.LineNum ?? Math.random(),
          line_num: line.LineNum ?? 0,
          order_no: row.DocNum != null ? String(row.DocNum) : "",
          series_no: row.SeriesName || "",
          item_code: line.ItemCode || "",
          item_name: line.ItemName || "",
          trans_type: "Complete",
          quantity: Math.max(0, Math.abs(line.PlannedQty ?? 0) - Math.abs(line.IssuedQty ?? 0)),
          unit_price: line.AvgPrice ?? 0,
          value: 0,
          item_cost: line.AvgPrice ?? 0,
          planned: Math.abs(line.PlannedQty ?? 0),
          completed: Math.abs(line.IssuedQty ?? 0),
          inventory_uom: line.InvntryUom || line.UomCode || "",
          uom_code: line.UomCode || line.InvntryUom || "",
          uom_name: line.UomCode || line.InvntryUom || "",
          items_per_unit: 1,
          warehouse: line.wareHouse || row.Warehouse || "",
          location: line.LocationName || "",
          branch: "",
          uom_group: "",
          by_product: !isDisassembly || index > 0,
          distribution_rule: line.OcrCode || "",
          project: line.Project || "",
          base_entry: row.DocEntry,
          base_line: line.LineNum ?? 0,
          base_type: 202,
          manage_batch: String(line.ManBtchNum || "").toUpperCase() === "Y",
          manage_serial: String(line.ManSerNum || "").toUpperCase() === "Y",
          issue_primarily_by: "",
          enable_bin_locations: String(line.BinActivat || "").toUpperCase() === "Y",
          batch_numbers: [],
          serial_numbers: [],
          bin_allocations: [],
        })),
  };
};

const getReceiptReferenceData = async ({ postingDate = new Date(), branch = "" } = {}) => ({
  warehouses: await lookupProdWarehouses(branch),
  distribution_rules: await lookupDistributionRules(),
  projects: await lookupProjects(),
  branches: await lookupBranches(),
  series: await lookupSeries("59", postingDate, branch),
  warnings: [],
});

const getReceiptList = async ({ query = "", top = 50, skip = 0 } = {}) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const rows = await queryRows(
    `
      SELECT T0.DocEntry, T0.DocNum, T0.DocDate, T0.Comments, T0.CANCELED, MIN(T1.BaseRef) AS ProductionOrderNo, COUNT(T1.LineNum) AS TotalLines
      FROM OIGN T0
      INNER JOIN IGN1 T1 ON T1.DocEntry = T0.DocEntry
      WHERE EXISTS (
        SELECT 1
        FROM IGN1 X
        WHERE X.DocEntry = T0.DocEntry
          AND X.BaseType = 202
      )
        AND (
          @query = ''
          OR CAST(T0.DocNum AS NVARCHAR(50)) LIKE @like
          OR ISNULL(T0.Comments, '') LIKE @like
        )
      GROUP BY T0.DocEntry, T0.DocNum, T0.DocDate, T0.Comments, T0.CANCELED
      ORDER BY T0.DocEntry DESC
      OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
    `,
    { query: trimmed, like: `%${trimmed}%`, top: limit, skip: offset }
  );

  return {
    receipts: rows.map((row) => ({
      doc_entry: row.DocEntry,
      doc_num: row.DocNum,
      posting_date: formatDate(row.DocDate),
      remarks: row.Comments || "",
      production_order_no: row.ProductionOrderNo || "",
      total_lines: row.TotalLines ?? 0,
      cancelled: row.CANCELED === "Y",
    })),
  };
};

const getReceiptByDocEntry = async (docEntry) => {
  const entry = toInt(docEntry, 0);
  const headerColumns = await getTableColumns("OIGN");
  const row = await queryOne(
    `
      SELECT DocEntry, DocNum, Series, DocDate, TaxDate, Ref2, Comments, JrnlMemo, CANCELED, TransId,
             ${selectOptionalColumn(headerColumns, "OIGN", "BPLId", "BPLId", "NULL")}
      FROM OIGN
      WHERE DocEntry = @docEntry
    `,
    { docEntry: entry }
  );

  if (!row) return null;

  const lines = await queryRows(
    `
      SELECT L.LineNum, L.BaseRef, L.ItemCode, L.Dscription, L.Quantity, L.Price, L.LineTotal,
             L.StockPrice, L.UomCode, L.unitMsr, L.WhsCode, L.LocCode,
             L.BaseEntry, L.BaseLine, L.BaseType, L.OcrCode, L.Project,
             PO.Series AS ProductionSeries, PS.SeriesName AS ProductionSeriesName,
             PL.PlannedQty, PL.IssuedQty,
             I.InvntryUom, I.ManBtchNum, I.ManSerNum,
             W.BinActivat, LOC.Location AS LocationName
      FROM IGN1 L
      LEFT JOIN OWOR PO ON PO.DocEntry = L.BaseEntry AND L.BaseType = 202
      LEFT JOIN NNM1 PS ON PS.Series = PO.Series AND PS.ObjectCode = '202'
      LEFT JOIN WOR1 PL ON PL.DocEntry = L.BaseEntry AND PL.LineNum = L.BaseLine AND L.BaseType = 202
      LEFT JOIN OITM I ON I.ItemCode = L.ItemCode
      LEFT JOIN OWHS W ON W.WhsCode = L.WhsCode
      LEFT JOIN OLCT LOC ON LOC.Code = W.Location
      WHERE L.DocEntry = @docEntry
      ORDER BY L.LineNum
    `,
    { docEntry: entry }
  );

  const prodBaseEntry = lines.find((line) => line.BaseType === 202)?.BaseEntry ?? null;

  return {
    receipt: {
      cancelled: row.CANCELED === "Y",
      trans_id: row.TransId ?? null,
      doc_entry: row.DocEntry,
      doc_num: row.DocNum,
      series: row.Series != null ? String(row.Series) : "",
      posting_date: formatDate(row.DocDate),
      document_date: formatDate(row.TaxDate),
      ref_2: row.Ref2 || "",
      branch: row.BPLId != null ? String(row.BPLId) : "",
      uop: "",
      remarks: row.Comments || "",
      journal_remark: row.JrnlMemo || "",
      prod_order_entry: prodBaseEntry,
      lines: lines.map((line) => ({
        _id: line.LineNum ?? Math.random(),
        line_num: line.LineNum ?? 0,
        item_code: line.ItemCode || "",
        item_name: line.Dscription || "",
        trans_type: "Complete",
        quantity: line.Quantity ?? 0,
        unit_price: line.Price ?? 0,
        value: line.LineTotal ?? 0,
        item_cost: line.StockPrice ?? 0,
        planned: line.PlannedQty ?? 0,
        completed: line.IssuedQty ?? 0,
        inventory_uom: line.InvntryUom || "",
        uom_code: line.UomCode || line.unitMsr || "",
        uom_name: line.UomCode || line.unitMsr || "",
        items_per_unit: 1,
        warehouse: line.WhsCode || "",
        location: line.LocationName || line.LocCode || "",
        branch: "",
        uom_group: "",
        by_product: false,
        distribution_rule: line.OcrCode || "",
        project: line.Project || "",
        base_entry: line.BaseEntry ?? null,
        base_line: line.BaseLine ?? null,
        base_type: line.BaseType ?? 202,
        order_no: line.BaseRef || "",
        series_no: line.ProductionSeriesName || "",
        manage_batch: String(line.ManBtchNum || "").toUpperCase() === "Y",
        manage_serial: String(line.ManSerNum || "").toUpperCase() === "Y",
        issue_primarily_by: "",
        enable_bin_locations: String(line.BinActivat || "").toUpperCase() === "Y",
        batch_numbers: [],
        serial_numbers: [],
        bin_allocations: [],
      })),
    },
  };
};

const lookupBinLocations = async (warehouse) => {
  if (!(await tableExists("OBIN"))) return { value: [] };
  const columns = await getTableColumns("OBIN");
  const rows = await queryRows(
    `
      SELECT AbsEntry, BinCode, WhsCode AS Warehouse
      FROM OBIN
      WHERE WhsCode = @warehouse
        ${columns.has("DISABLED") ? "AND ISNULL(Disabled, 'N') <> 'Y'" : ""}
        ${columns.has("DELETED") ? "AND ISNULL(Deleted, 'N') <> 'Y'" : ""}
      ORDER BY BinCode
    `,
    { warehouse: String(warehouse || "").trim() }
  );

  return { value: rows };
};

const lookupBatchesByItem = async (itemCode, warehouse) => {
  if (!(await tableExists("OIBT"))) return { value: [] };
  const rows = await queryRows(
    `
      SELECT BatchNum AS BatchNumber, Quantity, ExpDate
      FROM OIBT
      WHERE ItemCode = @itemCode
        AND WhsCode = @warehouse
        AND Quantity > 0
      ORDER BY ExpDate, BatchNum
    `,
    { itemCode, warehouse }
  );

  return { value: rows };
};

const lookupSerialsByItem = async (itemCode, warehouse) => {
  if (!(await tableExists("OSRI"))) return { value: [] };
  const columns = await getTableColumns("OSRI");
  const rows = await queryRows(
    `
      SELECT TOP 500 IntrSerial AS InternalSerialNumber,
             ${selectOptionalColumn(columns, "OSRI", "SysSerial", "SystemSerialNumber", "NULL")}
      FROM OSRI
      WHERE ItemCode = @itemCode
        AND WhsCode = @warehouse
        ${columns.has("STATUS") ? "AND ISNULL(Status, 0) = 0" : ""}
      ORDER BY IntrSerial
    `,
    { itemCode, warehouse }
  );
  return { value: rows };
};

const getAllocationOptions = async (itemCode, warehouse, direction = "issue") => {
  const code = String(itemCode || "").trim();
  const whsCode = String(warehouse || "").trim();
  if (!code || !whsCode) {
    const error = new Error("Item code and warehouse are required.");
    error.statusCode = 400;
    throw error;
  }
  const [itemColumns, warehouseColumns] = await Promise.all([
    getTableColumns("OITM"),
    getTableColumns("OWHS"),
  ]);
  const row = await queryOne(`
    SELECT I.ItemCode,
           ${selectOptionalColumn(itemColumns, "I", "ManBtchNum", "ManBtchNum", "'N'")},
           ${selectOptionalColumn(itemColumns, "I", "ManSerNum", "ManSerNum", "'N'")},
           ${selectOptionalColumn(warehouseColumns, "W", "BinActivat", "BinActivat", "'N'")},
           ${selectOptionalColumn(warehouseColumns, "W", "BPLid", "BPLID", "NULL")}
    FROM OITM I
    INNER JOIN OWHS W ON W.WhsCode = @warehouse
    WHERE I.ItemCode = @itemCode
  `, { itemCode: code, warehouse: whsCode });
  if (!row) {
    const error = new Error("Item or warehouse was not found in the selected company.");
    error.statusCode = 404;
    throw error;
  }
  const manageBatch = String(row.ManBtchNum || "").toUpperCase() === "Y";
  const manageSerial = String(row.ManSerNum || "").toUpperCase() === "Y";
  const binEnabled = String(row.BinActivat || "").toUpperCase() === "Y";
  const [batches, serials, bins] = await Promise.all([
    direction === "issue" && manageBatch ? lookupBatchesByItem(code, whsCode) : { value: [] },
    direction === "issue" && manageSerial ? lookupSerialsByItem(code, whsCode) : { value: [] },
    binEnabled ? lookupBinLocations(whsCode) : { value: [] },
  ]);
  return {
    itemCode: code, warehouse: whsCode, branch: row.BPLID ?? null,
    manageBatch, manageSerial, binEnabled,
    batches: batches.value, serials: serials.value, bins: bins.value,
  };
};

const validateBranchWarehouses = async (branch, warehouses = []) => {
  const uniqueWarehouses = [...new Set((warehouses || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const oadmColumns = await getTableColumns("OADM");
  const admin = oadmColumns.has("MLTPBRNCHS") ? await queryOne("SELECT MltpBrnchs FROM OADM") : null;
  const multipleBranches = String(admin?.MltpBrnchs || "N").toUpperCase() === "Y";
  const branchText = String(branch || "").trim();
  if (multipleBranches && !branchText) {
    const error = new Error("Branch is required when multiple branches are enabled.");
    error.statusCode = 422;
    throw error;
  }
  if (!uniqueWarehouses.length) return;
  const warehouseColumns = await getTableColumns("OWHS");
  if (!warehouseColumns.has("BPLID") || !branchText) return;
  const params = Object.fromEntries(uniqueWarehouses.map((value, index) => [`warehouse${index}`, value]));
  const placeholders = uniqueWarehouses.map((_, index) => `@warehouse${index}`).join(", ");
  const rows = await queryRows(`SELECT WhsCode, BPLid FROM OWHS WHERE WhsCode IN (${placeholders})`, params);
  const valid = new Set(rows.filter((row) => String(row.BPLid) === branchText).map((row) => String(row.WhsCode)));
  const invalidWarehouse = uniqueWarehouses.find((value) => !valid.has(value));
  if (invalidWarehouse) {
    const error = new Error(`Warehouse "${invalidWarehouse}" is not assigned to the selected branch.`);
    error.statusCode = 422;
    throw error;
  }
};

module.exports = {
  navigateRecord,
  getProductionOrderReferenceData,
  getIssueReferenceData,
  getReceiptReferenceData,
  getProductionOrders,
  getProductionOrderByDocEntry,
  explodeBOM,
  lookupProductionOrderItems,
  lookupFinishItems,
  lookupComponentItems,
  lookupResources,
  lookupRouteStages,
  lookupProdWarehouses,
  lookupDistributionRules,
  lookupProjects,
  lookupBranches,
  lookupCustomers,
  lookupUsers,
  lookupLinkedToOptions,
  lookupLinkedOrders,
  lookupOpenProductionOrders,
  getProductionOrderForIssue,
  getIssueList,
  getIssueByDocEntry,
  getProductionOrderForReceipt,
  getReceiptList,
  getReceiptByDocEntry,
  lookupBinLocations,
  lookupBatchesByItem,
  lookupSerialsByItem,
  getAllocationOptions,
  validateBranchWarehouses,
  lookupSeries,
  lookupSeriesContext,
  getTableColumns,
};
