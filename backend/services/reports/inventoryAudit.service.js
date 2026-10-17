const { reportTableExists, getReportTableColumns } = require('../reportMetadataService');
const db = require("../dbService");

const normalizeText = (value) => String(value || "").trim();
const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};



const DOCUMENT_TYPES = {
  13: { label: "A/R Invoice", prefix: "IN" },
  14: { label: "A/R Credit Memo", prefix: "CN" },
  15: { label: "Delivery", prefix: "DN" },
  16: { label: "Return", prefix: "RE" },
  18: { label: "A/P Invoice", prefix: "PU" },
  19: { label: "A/P Credit Memo", prefix: "PC" },
  20: { label: "Goods Receipt PO", prefix: "PD" },
  21: { label: "Goods Return", prefix: "GR" },
  59: { label: "Goods Receipt", prefix: "IN" },
  60: { label: "Goods Issue", prefix: "IN" },
  67: { label: "Inventory Transfer", prefix: "IM" },
  162: { label: "Inventory Revaluation", prefix: "MR" },
  10000071: { label: "Inventory Posting", prefix: "IP" },
  310000001: { label: "Inventory Opening Balance", prefix: "OB" },
};

const quoteIdentifier = (columnName) => `[${String(columnName).replace(/]/g, "]]")}]`;
const columnExpression = (alias, columnName) => `${alias}.${quoteIdentifier(columnName)}`;

const queryRows = async (sql, params = {}, options = {}) => {
  const result = await db.query(sql, params, options);
  return result.recordset || result || [];
};

const tableExists = reportTableExists;

const getTableColumns = getReportTableColumns;

const firstExistingColumn = async (tableName, candidates, options = {}) => {
  if (!(await tableExists(tableName, options))) return "";

  const columns = await getTableColumns(tableName, options);
  return candidates.find((column) => columns.has(normalizeText(column).toUpperCase())) || "";
};

const parseSapDate = (value) => {
  const text = normalizeText(value);
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!match) return text;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearPart = Number(match[3]);
  const year = yearPart < 100 ? 2000 + yearPart : yearPart;

  if (!day || !month || day > 31 || month > 12) {
    return text;
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
};

const buildRangeCondition = (columnSql, fromValue, toValue, params, prefix) => {
  const from = normalizeText(fromValue);
  const to = normalizeText(toValue);
  const clauses = [];

  if (from && to) {
    params[`${prefix}From`] = from;
    params[`${prefix}To`] = to;
    clauses.push(`${columnSql} BETWEEN @${prefix}From AND @${prefix}To`);
  } else if (from) {
    params[`${prefix}From`] = from;
    clauses.push(`${columnSql} >= @${prefix}From`);
  } else if (to) {
    params[`${prefix}To`] = to;
    clauses.push(`${columnSql} <= @${prefix}To`);
  }

  return clauses;
};

const buildDateRangeCondition = (columnSql, fromValue, toValue, params, prefix) => {
  const from = parseSapDate(fromValue);
  const to = parseSapDate(toValue);
  const clauses = [];

  if (from) {
    params[`${prefix}From`] = from;
    clauses.push(`CAST(${columnSql} AS DATE) >= CAST(@${prefix}From AS DATE)`);
  }

  if (to) {
    params[`${prefix}To`] = to;
    clauses.push(`CAST(${columnSql} AS DATE) <= CAST(@${prefix}To AS DATE)`);
  }

  return clauses;
};

const appendPropertyFilter = (whereClauses, propertyFilter = {}) => {
  if (propertyFilter.ignoreProperties !== false) return;

  const selectedNumbers = (propertyFilter.selectedPropertyNumbers || [])
    .map(Number)
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= 64);
  if (!selectedNumbers.length) return;

  const selectedSet = new Set(selectedNumbers);
  const operator = propertyFilter.linkMode === "or" ? " OR " : " AND ";
  whereClauses.push(`(${selectedNumbers.map((number) => `ISNULL(I.QryGroup${number}, 'N') = 'Y'`).join(operator)})`);

  if (propertyFilter.exactlyMatch) {
    const unselected = [];
    for (let number = 1; number <= 64; number += 1) {
      if (!selectedSet.has(number)) {
        unselected.push(`ISNULL(I.QryGroup${number}, 'N') <> 'Y'`);
      }
    }
    whereClauses.push(`(${unselected.join(" AND ")})`);
  }
};

const appendInClause = (whereClauses, columnSql, values, params, prefix) => {
  const normalizedValues = [...new Set((values || []).map(normalizeText).filter(Boolean))];
  if (!normalizedValues.length) return;

  const placeholders = normalizedValues.map((value, index) => {
    const key = `${prefix}${index}`;
    params[key] = value;
    return `@${key}`;
  });

  whereClauses.push(`${columnSql} IN (${placeholders.join(", ")})`);
};

const buildNullableCoalesce = (expressions) => {
  const filtered = expressions.filter(Boolean);
  if (!filtered.length) return "''";
  return `COALESCE(${filtered.map((expression) => `NULLIF(${expression}, '')`).join(", ")}, '')`;
};

const numericExpression = (expression, type = "BIGINT") =>
  `CASE WHEN ISNUMERIC(CAST(${expression} AS NVARCHAR(100))) = 1 THEN CAST(${expression} AS ${type}) ELSE 0 END`;

const getMovementDefinition = async (options = {}) => {
  const useValuationLog = await tableExists("OIVL", options);
  const tableName = useValuationLog ? "OIVL" : "OINM";

  if (!(await tableExists(tableName, options))) {
    const error = new Error("Inventory valuation data was not found. SAP B1 tables OIVL/OINM are unavailable in the selected company database.");
    error.status = 500;
    throw error;
  }

  const [
    postingDateColumn,
    systemDateColumn,
    warehouseColumn,
    inQtyColumn,
    outQtyColumn,
    valueColumn,
    calcPriceColumn,
    priceColumn,
    transSeqColumn,
    transNumColumn,
    createdByColumn,
    transTypeColumn,
    baseRefColumn,
    docLineColumn,
    descriptionColumn,
    accountColumn,
    serialBatchColumn,
  ] = await Promise.all([
    firstExistingColumn(tableName, ["DocDate", "TaxDate", "RefDate"], options),
    firstExistingColumn(tableName, ["CreateDate", "CreatedDate", "UpdateDate", "DocDate"], options),
    firstExistingColumn(tableName, ["LocCode", "Warehouse", "WhsCode"], options),
    firstExistingColumn(tableName, ["InQty", "DebitQty"], options),
    firstExistingColumn(tableName, ["OutQty", "CreditQty"], options),
    firstExistingColumn(tableName, ["TransValue", "TransVal", "Balance"], options),
    firstExistingColumn(tableName, ["CalcPrice", "Cost", "Price"], options),
    firstExistingColumn(tableName, ["Price", "CalcPrice"], options),
    firstExistingColumn(tableName, ["TransSeq", "TransNum", "LogInstanc"], options),
    firstExistingColumn(tableName, ["TransNum", "TransSeq", "MessageID"], options),
    firstExistingColumn(tableName, ["CreatedBy", "BASE_REF", "BaseRef"], options),
    firstExistingColumn(tableName, ["TransType", "TransObjType", "ObjType"], options),
    firstExistingColumn(tableName, ["BASE_REF", "BaseRef", "Ref1"], options),
    firstExistingColumn(tableName, ["DocLineNum", "DocLine", "LineNum"], options),
    firstExistingColumn(tableName, ["Dscription", "ItemName"], options),
    firstExistingColumn(tableName, ["InvntAct", "InvntAcct", "BalanceAct", "AcctCode"], options),
    firstExistingColumn(tableName, ["SNBMDAbs", "SnbMDAbs", "MdAbsEntry", "SysNumber"], options),
  ]);

  return {
    sourceTable: tableName,
    sourceLabel: useValuationLog ? "OIVL" : "OINM",
    postingDateColumn,
    systemDateColumn: systemDateColumn || postingDateColumn,
    warehouseColumn,
    inQtyColumn,
    outQtyColumn,
    valueColumn,
    calcPriceColumn,
    priceColumn,
    transSeqColumn,
    transNumColumn,
    createdByColumn,
    transTypeColumn,
    baseRefColumn,
    docLineColumn,
    descriptionColumn,
    accountColumn,
    serialBatchColumn,
  };
};

const getInventoryAccountExpression = async (movementDefinition, options = {}) => {
  const [oitwAccountColumn, oitmAccountColumn, oitbAccountColumn] = await Promise.all([
    firstExistingColumn("OITW", ["BalInvntAc", "InvntAcct", "InventoryAct"], options),
    firstExistingColumn("OITM", ["InvntAcct", "InvntAct", "InventoryAct"], options),
    firstExistingColumn("OITB", ["BalInvntAc", "InvntAcct", "InventoryAct"], options),
  ]);

  return buildNullableCoalesce([
    movementDefinition.accountColumn ? columnExpression("T0", movementDefinition.accountColumn) : "",
    oitwAccountColumn ? columnExpression("S", oitwAccountColumn) : "",
    oitmAccountColumn ? columnExpression("I", oitmAccountColumn) : "",
    oitbAccountColumn ? columnExpression("G", oitbAccountColumn) : "",
  ]);
};

const getLookups = async (options = {}) => {
  const [hasLocations, hasAccounts, hasGroups] = await Promise.all([
    tableExists("OLCT", options),
    tableExists("OACT", options),
    tableExists("OITB", options),
  ]);

  const [warehouses, locations, accounts, itemGroups] = await Promise.all([
    queryRows(`
      SELECT WhsCode, ISNULL(WhsName, '') AS WhsName,
             CAST(ISNULL([Location], 0) AS NVARCHAR(50)) AS LocationCode
      FROM OWHS
      ORDER BY CAST(ISNULL([Location], 0) AS NVARCHAR(50)), WhsCode
    `, {}, options),
    hasLocations
      ? queryRows(`
        SELECT CAST(Code AS NVARCHAR(50)) AS LocationCode, ISNULL([Location], '') AS LocationName
        FROM OLCT
        ORDER BY [Location], Code
      `, {}, options)
      : [],
    hasAccounts
      ? queryRows(`
        SELECT TOP 1000
          AcctCode,
          ISNULL(FormatCode, AcctCode) AS FormatCode,
          ISNULL(AcctName, '') AS AcctName,
          ISNULL(Postable, 'Y') AS Postable
        FROM OACT
        WHERE ISNULL(Postable, 'Y') = 'Y'
        ORDER BY FormatCode, AcctCode
      `, {}, options)
      : [],
    hasGroups
      ? queryRows(`
        SELECT ItmsGrpCod, ISNULL(ItmsGrpNam, '') AS ItmsGrpNam
        FROM OITB
        ORDER BY ItmsGrpNam, ItmsGrpCod
      `, {}, options)
      : [],
  ]);

  const locationByCode = new Map(locations.map((row) => [row.LocationCode || "", row.LocationName || ""]));
  const mappedWarehouses = warehouses.map((row) => ({
    code: row.WhsCode || "",
    name: row.WhsName || "",
    locationCode: row.LocationCode || "0",
    locationName: locationByCode.get(row.LocationCode || "0") || row.LocationCode || "General",
  }));

  const warehouseLocationCodes = new Set(mappedWarehouses.map((warehouse) => warehouse.locationCode));
  const mappedLocations = [
    ...locations.map((row) => ({
      code: row.LocationCode || "",
      name: row.LocationName || row.LocationCode || "General",
    })),
    ...[...warehouseLocationCodes]
      .filter((code) => !locations.some((row) => (row.LocationCode || "") === code))
      .map((code) => ({ code, name: code === "0" ? "General" : code })),
  ].filter((location) => location.code !== "");

  return {
    warehouses: mappedWarehouses,
    locations: mappedLocations,
    accounts: accounts.map((row) => ({
      code: row.AcctCode || "",
      formatCode: row.FormatCode || row.AcctCode || "",
      name: row.AcctName || "",
      postable: row.Postable || "Y",
    })),
    itemGroups: [
      { code: "*", name: "All" },
      ...itemGroups.map((row) => ({
        code: String(row.ItmsGrpCod ?? ""),
        name: row.ItmsGrpNam || String(row.ItmsGrpCod ?? ""),
      })),
    ],
  };
};

const documentMetaForTransType = (transType) =>
  DOCUMENT_TYPES[Number(transType)] || { label: `Transaction ${transType || ""}`, prefix: "TR" };

const formatDocumentNumber = (row) => {
  if (row.rowKind === "opening") return "Opening Balance";

  const meta = documentMetaForTransType(row.transType);
  const number = normalizeText(row.baseRef) || normalizeText(row.createdBy) || normalizeText(row.transNum);
  return number ? `${meta.prefix} ${number}` : "";
};

const buildPartitionKey = (row, criteria) => {
  if (criteria.displayMode === "byAccount") {
    return row.accountCode || "Unassigned";
  }

  if (criteria.groupByWarehouses) {
    return `${row.itemCode || ""}\u0001${row.whsCode || ""}`;
  }

  return row.itemCode || "";
};

const summarizeAccounts = (rows) => {
  const accountMap = new Map();

  rows.forEach((row) => {
    const code = row.accountCode || "Unassigned";
    if (!accountMap.has(code)) {
      accountMap.set(code, {
        accountCode: code,
        formatCode: row.accountFormatCode || code,
        accountName: row.accountName || "",
        openingQuantity: 0,
        openingValue: 0,
        inQuantity: 0,
        outQuantity: 0,
        netQuantity: 0,
        transactionValue: 0,
        closingQuantity: 0,
        closingValue: 0,
      });
    }

    const summary = accountMap.get(code);
    if (!summary.accountName && row.accountName) summary.accountName = row.accountName;

    if (row.rowKind === "opening") {
      summary.openingQuantity += row.quantity;
      summary.openingValue += row.transValue;
    } else {
      summary.inQuantity += row.inQty;
      summary.outQuantity += row.outQty;
      summary.netQuantity += row.quantity;
      summary.transactionValue += row.transValue;
    }
  });

  return [...accountMap.values()]
    .map((row) => ({
      ...row,
      closingQuantity: row.openingQuantity + row.netQuantity,
      closingValue: row.openingValue + row.transactionValue,
    }))
    .sort((left, right) => String(left.formatCode || left.accountCode).localeCompare(String(right.formatCode || right.accountCode)));
};

const getReport = async (criteria = {}, options = {}) => {
  const movementDefinition = await getMovementDefinition(options);
  const params = {};
  const baseWhere = ["1 = 1"];

  const postingDateSql = movementDefinition.postingDateColumn
    ? columnExpression("T0", movementDefinition.postingDateColumn)
    : "NULL";
  const systemDateSql = movementDefinition.systemDateColumn
    ? columnExpression("T0", movementDefinition.systemDateColumn)
    : postingDateSql;
  const activeDateSql = criteria.dateType === "posting" ? postingDateSql : systemDateSql;

  if (!movementDefinition.postingDateColumn && !movementDefinition.systemDateColumn) {
    const error = new Error(`No usable date column was found in SAP B1 table ${movementDefinition.sourceTable}.`);
    error.status = 500;
    throw error;
  }

  const warehouseSql = movementDefinition.warehouseColumn
    ? columnExpression("T0", movementDefinition.warehouseColumn)
    : "''";
  const inQtySql = movementDefinition.inQtyColumn
    ? `ISNULL(${columnExpression("T0", movementDefinition.inQtyColumn)}, 0)`
    : "0";
  const outQtySql = movementDefinition.outQtyColumn
    ? `ISNULL(${columnExpression("T0", movementDefinition.outQtyColumn)}, 0)`
    : "0";
  const itemDescriptionSql = movementDefinition.descriptionColumn
    ? columnExpression("T0", movementDefinition.descriptionColumn)
    : "''";
  const calcPriceFallbackSql = movementDefinition.calcPriceColumn
    ? `ISNULL(${columnExpression("T0", movementDefinition.calcPriceColumn)}, 0)`
    : movementDefinition.priceColumn
      ? `ISNULL(${columnExpression("T0", movementDefinition.priceColumn)}, 0)`
      : "ISNULL(I.AvgPrice, 0)";
  const transValueSql = movementDefinition.valueColumn
    ? `ISNULL(${columnExpression("T0", movementDefinition.valueColumn)}, 0)`
    : `((${inQtySql}) - (${outQtySql})) * (${calcPriceFallbackSql})`;
  const transSeqSql = movementDefinition.transSeqColumn
    ? numericExpression(columnExpression("T0", movementDefinition.transSeqColumn), "BIGINT")
    : "0";
  const transNumSql = movementDefinition.transNumColumn
    ? numericExpression(columnExpression("T0", movementDefinition.transNumColumn), "BIGINT")
    : transSeqSql;
  const createdBySql = movementDefinition.createdByColumn
    ? numericExpression(columnExpression("T0", movementDefinition.createdByColumn), "BIGINT")
    : "0";
  const transTypeSql = movementDefinition.transTypeColumn
    ? numericExpression(columnExpression("T0", movementDefinition.transTypeColumn), "INT")
    : "0";
  const docLineSql = movementDefinition.docLineColumn
    ? numericExpression(columnExpression("T0", movementDefinition.docLineColumn), "INT")
    : "0";
  const baseRefSql = movementDefinition.baseRefColumn
    ? `ISNULL(CAST(${columnExpression("T0", movementDefinition.baseRefColumn)} AS NVARCHAR(50)), '')`
    : "''";
  const accountSql = await getInventoryAccountExpression(movementDefinition, options);
  const accountJoinSql = accountSql;

  baseWhere.push(...buildRangeCondition("T0.ItemCode", criteria.itemFrom, criteria.itemTo, params, "item"));

  const groupCode = normalizeText(criteria.groupCode);
  if (groupCode && !["*", "all"].includes(groupCode.toLowerCase())) {
    params.groupCode = groupCode;
    baseWhere.push("CAST(I.ItmsGrpCod AS NVARCHAR(50)) = @groupCode");
  }

  appendPropertyFilter(baseWhere, criteria.propertyFilter);
  appendInClause(baseWhere, warehouseSql, criteria.selectedWarehouseCodes, params, "warehouse");

  if (criteria.glAccountsEnabled && Array.isArray(criteria.selectedAccountCodes) && criteria.selectedAccountCodes.length) {
    appendInClause(baseWhere, accountSql, criteria.selectedAccountCodes, params, "account");
  }

  if (criteria.hideSerialBatchForNonSerialBatch && movementDefinition.serialBatchColumn) {
    baseWhere.push(`(
      ${numericExpression(columnExpression("T0", movementDefinition.serialBatchColumn), "INT")} = 0
      OR ISNULL(I.ManSerNum, 'N') = 'Y'
      OR ISNULL(I.ManBtchNum, 'N') = 'Y'
    )`);
  }

  const dateFrom = parseSapDate(criteria.dateFrom);
  const dateTo = parseSapDate(criteria.dateTo);
  const periodDateWhere = [
    ...buildDateRangeCondition(activeDateSql, dateFrom, dateTo, params, "auditDate"),
  ];
  const openingDate = dateFrom;
  params.openingDate = openingDate || "1900-01-01";

  const baseWhereSql = baseWhere.join("\n          AND ");
  const periodWhereSql = [baseWhereSql, ...periodDateWhere].join("\n          AND ");
  const openingWhereSql = openingDate
    ? `${baseWhereSql}\n          AND CAST(${activeDateSql} AS DATE) < CAST(@openingDate AS DATE)`
    : "1 = 0";

  const partitionSql = criteria.displayMode === "byAccount"
    ? "AccountCode"
    : criteria.groupByWarehouses
      ? "ItemCode, WhsCode"
      : "ItemCode";

  const rows = await queryRows(
    `
      WITH PeriodRows AS (
        SELECT TOP 5000
          'movement' AS RowKind,
          1 AS RowRank,
          CAST(${activeDateSql} AS DATE) AS RowDate,
          CAST(${postingDateSql} AS DATE) AS PostingDate,
          CAST(${systemDateSql} AS DATE) AS SystemDate,
          ${transSeqSql} AS SortSeq,
          ${transNumSql} AS TransNum,
          ${createdBySql} AS CreatedBy,
          ${transTypeSql} AS TransType,
          ${baseRefSql} AS BaseRef,
          ${docLineSql} AS DocLineNum,
          T0.ItemCode,
          ISNULL(I.ItemName, ${itemDescriptionSql}) AS ItemName,
          ISNULL(I.InvntryUom, '') AS InventoryUom,
          ISNULL(${warehouseSql}, '') AS WhsCode,
          ISNULL(W.WhsName, '') AS WhsName,
          CAST(ISNULL(W.[Location], 0) AS NVARCHAR(50)) AS LocationCode,
          ISNULL(L.[Location], '') AS LocationName,
          ${accountSql} AS AccountCode,
          ISNULL(A.FormatCode, ${accountSql}) AS AccountFormatCode,
          ISNULL(A.AcctName, '') AS AccountName,
          CAST(${inQtySql} AS DECIMAL(19, 6)) AS InQty,
          CAST(${outQtySql} AS DECIMAL(19, 6)) AS OutQty,
          CAST((${inQtySql}) - (${outQtySql}) AS DECIMAL(19, 6)) AS Quantity,
          CAST(${transValueSql} AS DECIMAL(19, 6)) AS TransValue,
          CAST(${calcPriceFallbackSql} AS DECIMAL(19, 6)) AS UnitCost
        FROM ${movementDefinition.sourceTable} T0
        LEFT JOIN OITM I
          ON I.ItemCode = T0.ItemCode
        LEFT JOIN OITW S
          ON S.ItemCode = T0.ItemCode
          AND S.WhsCode = ${warehouseSql}
        LEFT JOIN OITB G
          ON G.ItmsGrpCod = I.ItmsGrpCod
        LEFT JOIN OWHS W
          ON W.WhsCode = ${warehouseSql}
        LEFT JOIN OLCT L
          ON L.Code = W.[Location]
        LEFT JOIN OACT A
          ON A.AcctCode = ${accountJoinSql}
        WHERE ${periodWhereSql}
      ),
      OpeningRows AS (
        SELECT
          'opening' AS RowKind,
          0 AS RowRank,
          CAST(@openingDate AS DATE) AS RowDate,
          CAST(@openingDate AS DATE) AS PostingDate,
          CAST(@openingDate AS DATE) AS SystemDate,
          CAST(0 AS BIGINT) AS SortSeq,
          CAST(0 AS BIGINT) AS TransNum,
          CAST(0 AS BIGINT) AS CreatedBy,
          CAST(0 AS INT) AS TransType,
          CAST('' AS NVARCHAR(50)) AS BaseRef,
          CAST(0 AS INT) AS DocLineNum,
          T0.ItemCode,
          MAX(ISNULL(I.ItemName, ${itemDescriptionSql})) AS ItemName,
          MAX(ISNULL(I.InvntryUom, '')) AS InventoryUom,
          ISNULL(${warehouseSql}, '') AS WhsCode,
          MAX(ISNULL(W.WhsName, '')) AS WhsName,
          MAX(CAST(ISNULL(W.[Location], 0) AS NVARCHAR(50))) AS LocationCode,
          MAX(ISNULL(L.[Location], '')) AS LocationName,
          ${accountSql} AS AccountCode,
          MAX(ISNULL(A.FormatCode, ${accountSql})) AS AccountFormatCode,
          MAX(ISNULL(A.AcctName, '')) AS AccountName,
          CAST(CASE WHEN SUM((${inQtySql}) - (${outQtySql})) > 0 THEN SUM((${inQtySql}) - (${outQtySql})) ELSE 0 END AS DECIMAL(19, 6)) AS InQty,
          CAST(CASE WHEN SUM((${inQtySql}) - (${outQtySql})) < 0 THEN ABS(SUM((${inQtySql}) - (${outQtySql}))) ELSE 0 END AS DECIMAL(19, 6)) AS OutQty,
          CAST(SUM((${inQtySql}) - (${outQtySql})) AS DECIMAL(19, 6)) AS Quantity,
          CAST(SUM(${transValueSql}) AS DECIMAL(19, 6)) AS TransValue,
          CAST(0 AS DECIMAL(19, 6)) AS UnitCost
        FROM ${movementDefinition.sourceTable} T0
        LEFT JOIN OITM I
          ON I.ItemCode = T0.ItemCode
        LEFT JOIN OITW S
          ON S.ItemCode = T0.ItemCode
          AND S.WhsCode = ${warehouseSql}
        LEFT JOIN OITB G
          ON G.ItmsGrpCod = I.ItmsGrpCod
        LEFT JOIN OWHS W
          ON W.WhsCode = ${warehouseSql}
        LEFT JOIN OLCT L
          ON L.Code = W.[Location]
        LEFT JOIN OACT A
          ON A.AcctCode = ${accountJoinSql}
        WHERE ${openingWhereSql}
        GROUP BY T0.ItemCode, ISNULL(${warehouseSql}, '')${accountSql === "''" ? '' : `, ${accountSql}`}
        HAVING ABS(SUM((${inQtySql}) - (${outQtySql}))) > 0.000001
          OR ABS(SUM(${transValueSql})) > 0.000001
      ),
      NumberedRows AS (
        SELECT
          *,
          SUM(Quantity) OVER (
            PARTITION BY ${partitionSql}
            ORDER BY RowRank, RowDate, SortSeq, TransNum, CreatedBy, DocLineNum
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS CumulativeQuantity,
          SUM(TransValue) OVER (
            PARTITION BY ${partitionSql}
            ORDER BY RowRank, RowDate, SortSeq, TransNum, CreatedBy, DocLineNum
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS CumulativeValue
        FROM (
          SELECT * FROM PeriodRows
          UNION ALL
          SELECT * FROM OpeningRows
        ) CombinedRows
      )
      SELECT TOP 5000 *
      FROM NumberedRows
      ORDER BY ${criteria.displayMode === "byAccount" ? "AccountFormatCode, RowRank, RowDate, SortSeq" : "ItemCode, RowRank, RowDate, SortSeq"}
    `,
    params,
    options,
  );

  let mappedRows = rows.map((row, index) => {
    const documentMeta = documentMetaForTransType(row.TransType);
    const mapped = {
      rowNo: index + 1,
      rowKind: row.RowKind || "movement",
      date: row.RowDate,
      postingDate: row.PostingDate,
      systemDate: row.SystemDate,
      transSeq: Number(row.SortSeq || 0),
      transNum: Number(row.TransNum || 0),
      createdBy: Number(row.CreatedBy || 0),
      transType: Number(row.TransType || 0),
      documentType: row.RowKind === "opening" ? "Opening Balance" : documentMeta.label,
      baseRef: row.BaseRef || "",
      document: "",
      docLineNum: Number(row.DocLineNum || 0),
      itemCode: row.ItemCode || "",
      itemName: row.ItemName || "",
      inventoryUom: row.InventoryUom || "",
      whsCode: row.WhsCode || "",
      whsName: row.WhsName || "",
      locationCode: row.LocationCode || "",
      locationName: row.LocationName || "",
      accountCode: row.AccountCode || "",
      accountFormatCode: row.AccountFormatCode || row.AccountCode || "",
      accountName: row.AccountName || "",
      inQty: toNumber(row.InQty),
      outQty: toNumber(row.OutQty),
      quantity: toNumber(row.Quantity),
      transValue: toNumber(row.TransValue),
      unitCost: Math.abs(toNumber(row.Quantity)) > 0.000001
        ? Math.abs(toNumber(row.TransValue) / toNumber(row.Quantity))
        : toNumber(row.UnitCost),
      cumulativeQuantity: toNumber(row.CumulativeQuantity),
      cumulativeValue: toNumber(row.CumulativeValue),
    };

    mapped.document = formatDocumentNumber(mapped);
    return mapped;
  });

  if (criteria.displayMode !== "byAccount" && criteria.hideItemsWithCumulativeQuantityZero) {
    const finalQuantityByPartition = new Map();
    mappedRows.forEach((row) => {
      finalQuantityByPartition.set(buildPartitionKey(row, criteria), row.cumulativeQuantity);
    });
    mappedRows = mappedRows.filter((row) => Math.abs(finalQuantityByPartition.get(buildPartitionKey(row, criteria)) || 0) > 0.000001);
  }

  if (!criteria.displayOpeningBalances) {
    const partitionsWithMovements = new Set();
    mappedRows.forEach((row) => {
      if (row.rowKind !== "opening") {
        partitionsWithMovements.add(buildPartitionKey(row, criteria));
      }
    });
    mappedRows = mappedRows.filter((row) =>
      row.rowKind !== "opening" || partitionsWithMovements.has(buildPartitionKey(row, criteria)),
    );
  }

  mappedRows = mappedRows.map((row, index) => ({ ...row, rowNo: index + 1 }));

  return {
    reportTitle: "Inventory Audit Report",
    generatedAt: new Date().toISOString(),
    sourceTable: movementDefinition.sourceLabel,
    totalRows: mappedRows.length,
    criteria: {
      dateType: criteria.dateType === "posting" ? "posting" : "system",
      dateFrom,
      dateTo,
      displayMode: criteria.displayMode === "byAccount" ? "byAccount" : "byItems",
      groupByWarehouses: Boolean(criteria.groupByWarehouses),
    },
    rows: mappedRows,
    accountRows: summarizeAccounts(mappedRows),
  };
};

module.exports = {
  getLookups,
  getReport,
};
