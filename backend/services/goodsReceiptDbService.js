const db = require('../db/odbc');
const { getHeaderUdfValues, getLineUdfValues } = require('./udfMetadataService');
const { mapInventoryPriceLists } = require('./inventoryPriceListUtils');
const { getMarketingDocumentSeries } = require('./documentSeriesDbUtils');

const safe = async (promise) => {
  try {
    const result = await promise;
    return result.recordset || [];
  } catch (error) {
    console.error('[GoodsReceiptDB] Query failed:', error.message);
    return [];
  }
};

const getTableColumns = async (tableName) => {
  const rows = await safe(
    db.query(
      `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @tableName
      `,
      { tableName }
    )
  );

  return new Set(rows.map((row) => row.COLUMN_NAME));
};

const getColumnName = (columns, columnName) => (
  [...columns].find((candidate) => String(candidate).toLowerCase() === String(columnName).toLowerCase())
);

const optionalColumn = (columns, tableAlias, columnName, alias, fallback = 'NULL') => {
  const actualColumnName = getColumnName(columns, columnName);
  return actualColumnName
    ? `${tableAlias}.${quoteSqlIdentifier(actualColumnName)} AS ${quoteSqlIdentifier(alias)}`
    : `${fallback} AS ${quoteSqlIdentifier(alias)}`;
};

const quoteSqlIdentifier = (identifier) => `[${String(identifier || '').replace(/]/g, ']]')}]`;

const pickFirstValue = (row = {}, candidates = []) => {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate) && row[candidate] != null && row[candidate] !== '') {
      return row[candidate];
    }
  }
  return '';
};

const formatSqlDate = (value) => {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  return String(value).split('T')[0];
};

const getInventoryReferenceDocuments = async (tableName, docEntry) => {
  const columns = await getTableColumns(tableName);
  if (!columns.has('DocEntry')) return [];

  const orderBy = columns.has('LineNum') ? 'ORDER BY [LineNum]' : '';
  const rows = await safe(
    db.query(
      `
        SELECT TOP 200 *
        FROM ${quoteSqlIdentifier(tableName)}
        WHERE [DocEntry] = @docEntry
        ${orderBy}
      `,
      { docEntry }
    )
  );

  return rows.map((row, index) => ({
    lineNum: row.LineNum != null ? Number(row.LineNum) : index,
    direction: 'to',
    transactionType: String(
      pickFirstValue(row, ['RefObjType', 'RefType', 'ObjType', 'ObjectType', 'RefObjCode', 'RefObj']) || ''
    ),
    docEntry: String(
      pickFirstValue(row, ['RefDocEntr', 'RefDocEntry', 'RefDocEnt', 'RefDocEn', 'LinkedDocEntry']) || ''
    ),
    docNumber: String(
      pickFirstValue(row, ['RefDocNum', 'RefDocNo', 'RefDocNumber', 'DocNum', 'RefDoc']) || ''
    ),
    extDocNumber: String(
      pickFirstValue(row, ['ExtDocNum', 'ExtDocNo', 'ExtDocNumber', 'ExternalRefNo', 'ExternalReferencedDocNumber']) || ''
    ),
    issueDate: formatSqlDate(pickFirstValue(row, ['IssueDate', 'RefDate', 'DocDate'])),
    remark: String(pickFirstValue(row, ['Remark', 'Remarks', 'Comments']) || ''),
  })).filter((row) =>
    String(row.transactionType || row.docEntry || row.docNumber || row.extDocNumber || '').trim()
  );
};

const getDefaultSeriesSql = async () => {
  const numberingColumns = await getTableColumns('ONNM');
  const defaultSeriesColumn = getColumnName(numberingColumns, 'DfltSeries');

  if (!defaultSeriesColumn) {
    return {
      join: '',
      select: '0',
      order: 'T0.SeriesName',
    };
  }

  const quotedDefaultSeriesColumn = quoteSqlIdentifier(defaultSeriesColumn);
  return {
    join: `LEFT JOIN ONNM DEF ON DEF.ObjectCode = T0.ObjectCode AND DEF.${quotedDefaultSeriesColumn} = T0.Series`,
    select: `CASE WHEN DEF.${quotedDefaultSeriesColumn} IS NOT NULL THEN 1 ELSE 0 END`,
    order: 'IsDefault DESC, T0.SeriesName',
  };
};

const getItems = async () => {
  const [itemRows, priceRows] = await Promise.all([
    safe(
      db.query(`
        SELECT
          T0.ItemCode,
          T0.ItemName,
          T0.BuyUnitMsr AS UoMCode,
          T0.InvntryUom AS UoMName,
          T0.DfltWH AS DefaultWarehouse,
          CAST(ISNULL(T0.OnHand, 0) AS DECIMAL(19, 2)) AS InStock,
          CAST(ISNULL(T0.LastPurPrc, 0) AS DECIMAL(19, 6)) AS LastPurchasePrice,
          CAST(COALESCE(T0.LstEvlPric, T0.AvgPrice, 0) AS DECIMAL(19, 6)) AS LastEvaluatedPrice,
          CAST(ISNULL(T0.AvgPrice, 0) AS DECIMAL(19, 6)) AS ItemCost,
          T0.ExpensAcct AS AccountCode,
          T0.ManBtchNum AS BatchManaged,
          T0.ManSerNum AS SerialManaged,
          T0.PUoMEntry AS UoMGroupEntry,
          CHP.ChapterID AS HSNCode
        FROM OITM T0
        LEFT JOIN OCHP CHP ON CHP.AbsEntry = T0.ChapterID
        WHERE T0.InvntItem = 'Y'
          AND ISNULL(T0.validFor, 'Y') <> 'N'
          AND ISNULL(T0.frozenFor, 'N') <> 'Y'
        ORDER BY T0.ItemCode
      `)
    ),
    safe(
      db.query(`
        SELECT
          T0.ItemCode,
          T0.PriceList,
          CAST(ISNULL(T0.Price, 0) AS DECIMAL(19, 6)) AS Price
        FROM ITM1 T0
        INNER JOIN OITM T1 ON T1.ItemCode = T0.ItemCode
        WHERE T1.InvntItem = 'Y'
      `)
    ),
  ]);

  const priceMap = priceRows.reduce((acc, row) => {
    if (!acc[row.ItemCode]) {
      acc[row.ItemCode] = {};
    }
    acc[row.ItemCode][String(row.PriceList)] = Number(row.Price || 0);
    return acc;
  }, {});

  return itemRows.map((row) => ({
    itemCode: row.ItemCode,
    itemName: row.ItemName,
    uomCode: row.UoMCode || '',
    uomName: row.UoMName || '',
    defaultWarehouse: row.DefaultWarehouse || '',
    inStock: Number(row.InStock || 0),
    InStock: Number(row.InStock || 0),
    lastPurchasePrice: Number(row.LastPurchasePrice || 0),
    lastEvaluatedPrice: Number(row.LastEvaluatedPrice || 0),
    itemCost: Number(row.ItemCost || 0),
    accountCode: row.AccountCode || '',
    batchManaged: String(row.BatchManaged || '').toUpperCase() === 'Y',
    serialManaged: String(row.SerialManaged || '').toUpperCase() === 'Y',
    uomGroupEntry: row.UoMGroupEntry || null,
    hsnCode: row.HSNCode || '',
    prices: priceMap[row.ItemCode] || {},
  }));
};

const getBatchesByItem = async (itemCode, whsCode) => {
  const result = await safe(
    db.query(
      `
        SELECT
          T0.BatchNum AS BatchNumber,
          T0.Quantity AS AvailableQty,
          T0.ExpDate AS ExpiryDate
        FROM OIBT T0
        WHERE T0.ItemCode = @itemCode
          AND T0.WhsCode = @whsCode
          AND T0.Quantity > 0
        ORDER BY T0.ExpDate
      `,
      { itemCode, whsCode }
    )
  );

  return { batches: result };
};

const getWarehouses = async () => {
  const warehouseColumns = await getTableColumns('OWHS');
  const locationColumn = getColumnName(warehouseColumns, 'Location');
  const branchColumn = getColumnName(warehouseColumns, 'BPLId') || getColumnName(warehouseColumns, 'BPLid');
  const locationExpression = locationColumn ? quoteSqlIdentifier(locationColumn) : 'NULL';
  const branchExpression = branchColumn ? quoteSqlIdentifier(branchColumn) : 'NULL';

  return safe(
    db.query(`
      SELECT
        WhsCode,
        WhsName,
        ${branchExpression} AS BranchId,
        ${locationExpression} AS LocationCode
      FROM OWHS
      WHERE ISNULL(Inactive, 'N') <> 'Y'
      ORDER BY WhsCode
    `)
  ).then((rows) =>
    rows.map((row) => ({
      whsCode: row.WhsCode,
      whsName: row.WhsName,
      branchId: row.BranchId != null ? String(row.BranchId) : '',
      locationCode: row.LocationCode != null ? String(row.LocationCode) : '',
    }))
  );
};

const getDistributionRules = async () => {
  const [ruleColumns, dimensionColumns] = await Promise.all([
    getTableColumns('OOCR'),
    getTableColumns('ODIM'),
  ]);
  const hasDimensionCode = ruleColumns.has('DimCode');
  const dimensionCodeExpression = hasDimensionCode ? 'T0.DimCode' : '1';
  const dimensionNameColumn = ['DimName', 'DimDesc', 'Name'].find((columnName) =>
    dimensionColumns.has(columnName)
  );
  const dimensionJoin = dimensionColumns.has('DimCode')
    ? `LEFT JOIN ODIM T1 ON T1.DimCode = ${dimensionCodeExpression}`
    : '';
  const dimensionFallbackExpression = `CONCAT('Dimension ', CAST(${dimensionCodeExpression} AS NVARCHAR(10)))`;
  const dimensionNameExpression = dimensionNameColumn
    ? `COALESCE(T1.${quoteSqlIdentifier(dimensionNameColumn)}, ${dimensionFallbackExpression})`
    : dimensionFallbackExpression;

  return safe(
    db.query(`
      SELECT TOP 500
        T0.OcrCode AS FactorCode,
        T0.OcrName AS FactorDescription,
        ${dimensionCodeExpression} AS DimensionCode,
        ${dimensionNameExpression} AS DimensionName
      FROM OOCR T0
      ${dimensionJoin}
      WHERE ISNULL(T0.Active, 'Y') <> 'N'
      ORDER BY ${dimensionCodeExpression}, T0.OcrCode
    `)
  );
};

const getSeries = async (targetDate = null, { branch = '' } = {}) => {
  const rows = await getMarketingDocumentSeries({
    db,
    objectCode: '59',
    targetDate,
    branch,
    docSubType: '--',
    collapseToSapVisible: true,
  });

  return rows.map((row) => ({
    ...row,
    series: String(row.Series),
    seriesName: row.SeriesName,
    indicator: row.Indicator || '',
    nextNumber: row.NextNumber != null ? String(row.NextNumber) : '',
    isDefault: Boolean(row.IsDefault),
  }));
};

const getPriceLists = async () =>
  safe(
    db.query(`
      SELECT
        ListNum,
        ListName
      FROM OPLN
      ORDER BY ListNum
    `)
  ).then(mapInventoryPriceLists);

const getBranches = async () => {
  const branchColumns = await getTableColumns('OBPL');
  const idColumn = getColumnName(branchColumns, 'BPLId') || getColumnName(branchColumns, 'BPLID');
  const nameColumn = getColumnName(branchColumns, 'BPLName');
  const disabledColumn = getColumnName(branchColumns, 'Disabled');

  if (!idColumn || !nameColumn) return [];

  return safe(
    db.query(`
      SELECT
        ${quoteSqlIdentifier(idColumn)} AS BPLId,
        ${quoteSqlIdentifier(nameColumn)} AS BPLName
      FROM OBPL
      ${disabledColumn ? `WHERE ISNULL(${quoteSqlIdentifier(disabledColumn)}, 'N') <> 'Y'` : ''}
      ORDER BY ${quoteSqlIdentifier(nameColumn)}
    `)
  ).then((rows) =>
    rows.map((row) => ({
      id: String(row.BPLId),
      name: row.BPLName,
    }))
  );
};

const getPurchaseOrders = async () => {
  const headerColumns = await getTableColumns('OPOR');

  return safe(
    db.query(`
      SELECT TOP 100
        T0.DocEntry,
        T0.DocNum,
        T0.CardCode,
        T0.CardName,
        T0.DocDate,
        T0.DocTotal,
        ${optionalColumn(headerColumns, 'T0', 'BPLId', 'BranchId')},
        ${optionalColumn(headerColumns, 'T0', 'Ref2', 'Ref2')}
      FROM OPOR T0
      WHERE T0.DocStatus = 'O'
      ORDER BY T0.DocEntry DESC
    `)
  ).then((rows) =>
    rows.map((row) => ({
      docEntry: row.DocEntry,
      docNum: row.DocNum,
      cardCode: row.CardCode,
      cardName: row.CardName,
      docDate: row.DocDate,
      docTotal: Number(row.DocTotal || 0),
      branchId: row.BranchId != null ? String(row.BranchId) : '',
      ref2: row.Ref2 || '',
      sourceType: 'purchase-order',
      sourceLabel: 'Purchase Order',
    }))
  );
};

const getPurchaseInvoices = async () => {
  const headerColumns = await getTableColumns('OPCH');

  return safe(
    db.query(`
      SELECT TOP 100
        T0.DocEntry,
        T0.DocNum,
        T0.CardCode,
        T0.CardName,
        T0.DocDate,
        T0.DocTotal,
        ${optionalColumn(headerColumns, 'T0', 'BPLId', 'BranchId')},
        ${optionalColumn(headerColumns, 'T0', 'Ref2', 'Ref2')}
      FROM OPCH T0
      WHERE T0.DocStatus = 'O'
      ORDER BY T0.DocEntry DESC
    `)
  ).then((rows) =>
    rows.map((row) => ({
      docEntry: row.DocEntry,
      docNum: row.DocNum,
      cardCode: row.CardCode,
      cardName: row.CardName,
      docDate: row.DocDate,
      docTotal: Number(row.DocTotal || 0),
      branchId: row.BranchId != null ? String(row.BranchId) : '',
      ref2: row.Ref2 || '',
      sourceType: 'purchase-invoice',
      sourceLabel: 'Purchase Invoice',
    }))
  );
};

const getGoodsIssues = async () =>
  safe(
    db.query(`
      SELECT
        T0.DocEntry,
        T0.DocNum,
        T0.DocDate,
        T0.DocTotal,
        T0.Comments
      FROM OIGE T0
      ORDER BY T0.DocEntry DESC
    `)
  ).then((rows) =>
    rows.map((row) => ({
      docEntry: row.DocEntry,
      docNum: row.DocNum,
      docDate: row.DocDate,
      docTotal: Number(row.DocTotal || 0),
      details: row.Comments || '',
      sourceType: 'goods-issue',
      sourceLabel: 'Goods Issue',
    }))
  );

const getDocumentDetails = async ({
  headerTable,
  lineTable,
  baseType,
  docEntry,
  useOpenQty,
}) => {
  const headerColumns = await getTableColumns(headerTable);
  const headerRows = await safe(
    db.query(
      `
        SELECT TOP 1
          T0.DocEntry,
          T0.DocNum,
          T0.CardCode,
        T0.CardName,
        T0.DocDate,
        T0.TaxDate,
        T0.Ref2,
        ${optionalColumn(headerColumns, 'T0', 'BPLId', 'BranchId')},
        T0.Comments,
        T0.JrnlMemo
      FROM ${headerTable} T0
        WHERE T0.DocEntry = @docEntry
      `,
      { docEntry }
    )
  );

  if (!headerRows.length) {
    throw new Error(`Source document ${docEntry} not found.`);
  }

  const quantityExpression = useOpenQty
    ? 'CAST(ISNULL(T0.OpenQty, T0.Quantity) AS DECIMAL(19, 6))'
    : 'CAST(T0.Quantity AS DECIMAL(19, 6))';

  const statusPredicate = useOpenQty
    ? "AND T0.LineStatus = 'O' AND ISNULL(T0.OpenQty, 0) > 0"
    : '';

  const lineRows = await safe(
    db.query(
      `
        SELECT
          T0.LineNum,
          T0.ItemCode,
          T0.Dscription AS ItemDescription,
          ${quantityExpression} AS QuantityToCopy,
          CAST(ISNULL(T0.Price, 0) AS DECIMAL(19, 6)) AS UnitPrice,
          CAST(ISNULL(T0.LineTotal, 0) AS DECIMAL(19, 6)) AS LineTotal,
          T0.WhsCode AS WarehouseCode,
          T0.unitMsr AS UoMCode,
          T0.OcrCode AS DistributionRule,
          T0.OcrCode2 AS DistributionRule2,
          T0.OcrCode3 AS DistributionRule3,
          T0.OcrCode4 AS DistributionRule4,
          T0.OcrCode5 AS DistributionRule5,
          T0.LocCode AS LocationCode
        FROM ${lineTable} T0
        WHERE T0.DocEntry = @docEntry
          ${statusPredicate}
        ORDER BY T0.LineNum
      `,
      { docEntry }
    )
  );

  const itemCodes = [...new Set(lineRows.map((row) => row.ItemCode).filter(Boolean))];
  let itemMap = {};

  if (itemCodes.length) {
    const params = itemCodes.reduce((acc, code, index) => {
      acc[`item${index}`] = code;
      return acc;
    }, {});

    const itemRows = await safe(
      db.query(
        `
          SELECT
            T0.ItemCode,
            T0.InvntryUom AS UoMName,
            T0.ExpensAcct AS AccountCode,
            CAST(ISNULL(T0.AvgPrice, 0) AS DECIMAL(19, 6)) AS ItemCost,
            T0.ManBtchNum AS BatchManaged,
            T0.ManSerNum AS SerialManaged
          FROM OITM T0
          WHERE T0.ItemCode IN (${itemCodes.map((_, index) => `@item${index}`).join(', ')})
        `,
        params
      )
    );

    itemMap = itemRows.reduce((acc, row) => {
      acc[row.ItemCode] = {
        uomName: row.UoMName || '',
        accountCode: row.AccountCode || '',
        itemCost: Number(row.ItemCost || 0),
        batchManaged: String(row.BatchManaged || '').toUpperCase() === 'Y',
        serialManaged: String(row.SerialManaged || '').toUpperCase() === 'Y',
      };
      return acc;
    }, {});
  }

  const batchRows = await safe(
    db.query(
      `
        SELECT
          BaseLinNum AS BaseLineNum,
          BatchNum,
          Quantity
        FROM IBT1
        WHERE BaseEntry = @docEntry
          AND BaseType = 59
        ORDER BY BaseLinNum, BatchNum
      `,
      { docEntry }
    )
  );

  const batchesByLine = {};
  batchRows.forEach((row) => {
    if (!batchesByLine[row.BaseLineNum]) {
      batchesByLine[row.BaseLineNum] = [];
    }
    batchesByLine[row.BaseLineNum].push({
      batchNumber: row.BatchNum || '',
      quantity: String(row.Quantity || 0),
      expiryDate: '',
    });
  });

  const header = headerRows[0];

  return {
    header: {
      number: header.DocNum != null ? String(header.DocNum) : 'Auto',
      postingDate: header.DocDate ? header.DocDate.toISOString().split('T')[0] : '',
      documentDate: header.TaxDate ? header.TaxDate.toISOString().split('T')[0] : '',
      ref2: header.Ref2 || '',
      priceList: '',
      branch: header.BranchId != null ? String(header.BranchId) : '',
      journalRemark: header.JrnlMemo || 'Goods Receipt',
      remarks: header.Comments || '',
      cardCode: header.CardCode || '',
      cardName: header.CardName || '',
      referencedDocument: {
        sourceType: baseType === 22 ? 'purchase-order' : 'purchase-invoice',
        sourceLabel: baseType === 22 ? 'Purchase Order' : 'Purchase Invoice',
        docEntry: header.DocEntry,
        docNum: header.DocNum,
      },
    },
    lines: lineRows.map((row) => {
      const itemInfo = itemMap[row.ItemCode] || {};
      return {
        itemCode: row.ItemCode || '',
        itemDescription: row.ItemDescription || '',
        quantity: Number(row.QuantityToCopy || 0),
        unitPrice: Number(row.UnitPrice || 0),
        total: Number(row.LineTotal || 0),
        warehouse: row.WarehouseCode || '',
        accountCode: itemInfo.accountCode || '',
        itemCost: itemInfo.itemCost || 0,
        uomCode: row.UoMCode || '',
        uomName: itemInfo.uomName || '',
        distributionRule: row.DistributionRule || '',
        distributionRule2: row.DistributionRule2 || '',
        distributionRule3: row.DistributionRule3 || '',
        distributionRule4: row.DistributionRule4 || '',
        distributionRule5: row.DistributionRule5 || '',
        location: row.LocationCode != null ? String(row.LocationCode) : '',
        branch: header.BranchId != null ? String(header.BranchId) : '',
        baseEntry: header.DocEntry,
        baseLine: row.LineNum,
        baseType,
        lockedByCopy: true,
      };
    }),
  };
};

const getPurchaseOrderForCopy = async (docEntry) =>
  getDocumentDetails({
    headerTable: 'OPOR',
    lineTable: 'POR1',
    baseType: 22,
    docEntry,
    useOpenQty: true,
  });

const getPurchaseInvoiceForCopy = async (docEntry) =>
  getDocumentDetails({
    headerTable: 'OPCH',
    lineTable: 'PCH1',
    baseType: 18,
    docEntry,
    useOpenQty: false,
  });

const getGoodsIssueForCopy = async (docEntry) => {
  const headerColumns = await getTableColumns('OIGE');
  const headerRows = await safe(
    db.query(
      `
        SELECT TOP 1
          T0.DocEntry,
          T0.DocNum,
          T0.DocDate,
          T0.TaxDate,
          T0.Comments,
          T0.JrnlMemo,
          ${optionalColumn(headerColumns, 'T0', 'BPLId', 'BranchId')}
        FROM OIGE T0
        WHERE T0.DocEntry = @docEntry
      `,
      { docEntry }
    )
  );

  if (!headerRows.length) {
    throw new Error(`Goods Issue ${docEntry} not found.`);
  }

  const lineRows = await safe(
    db.query(
      `
        SELECT
          T0.LineNum,
          T0.ItemCode,
          T0.Dscription AS ItemDescription,
          CAST(ISNULL(T0.Quantity, 0) AS DECIMAL(19, 6)) AS QuantityToCopy,
          CAST(ISNULL(T0.Price, 0) AS DECIMAL(19, 6)) AS UnitPrice,
          CAST(ISNULL(T0.LineTotal, 0) AS DECIMAL(19, 6)) AS LineTotal,
          T0.WhsCode AS WarehouseCode,
          T0.unitMsr AS UoMCode,
          T0.OcrCode AS DistributionRule,
          T0.OcrCode2 AS DistributionRule2,
          T0.OcrCode3 AS DistributionRule3,
          T0.OcrCode4 AS DistributionRule4,
          T0.OcrCode5 AS DistributionRule5,
          T0.LocCode AS LocationCode
        FROM IGE1 T0
        WHERE T0.DocEntry = @docEntry
        ORDER BY T0.LineNum
      `,
      { docEntry }
    )
  );

  const itemCodes = [...new Set(lineRows.map((row) => row.ItemCode).filter(Boolean))];
  let itemMap = {};

  if (itemCodes.length) {
    const params = itemCodes.reduce((acc, code, index) => {
      acc[`item${index}`] = code;
      return acc;
    }, {});

    const itemRows = await safe(
      db.query(
        `
          SELECT
            T0.ItemCode,
            T0.InvntryUom AS UoMName,
            T0.ExpensAcct AS AccountCode,
            CAST(ISNULL(T0.AvgPrice, 0) AS DECIMAL(19, 6)) AS ItemCost
          FROM OITM T0
          WHERE T0.ItemCode IN (${itemCodes.map((_, index) => `@item${index}`).join(', ')})
        `,
        params
      )
    );

    itemMap = itemRows.reduce((acc, row) => {
      acc[row.ItemCode] = {
        uomName: row.UoMName || '',
        accountCode: row.AccountCode || '',
        itemCost: Number(row.ItemCost || 0),
      };
      return acc;
    }, {});
  }

  const header = headerRows[0];

  return {
    header: {
      number: header.DocNum != null ? String(header.DocNum) : 'Auto',
      postingDate: header.DocDate ? header.DocDate.toISOString().split('T')[0] : '',
      documentDate: header.TaxDate ? header.TaxDate.toISOString().split('T')[0] : '',
      ref2: '',
      priceList: '',
      branch: header.BranchId != null ? String(header.BranchId) : '',
      journalRemark: header.JrnlMemo || 'Goods Receipt',
      remarks: header.Comments || '',
      referencedDocument: {
        sourceType: 'goods-issue',
        sourceLabel: 'Goods Issue',
        docEntry: header.DocEntry,
        docNum: header.DocNum,
      },
    },
    lines: lineRows.map((row) => {
      const itemInfo = itemMap[row.ItemCode] || {};
      return {
        itemCode: row.ItemCode || '',
        itemDescription: row.ItemDescription || '',
        quantity: Number(row.QuantityToCopy || 0),
        unitPrice: Number(row.UnitPrice || 0),
        total: Number(row.LineTotal || 0),
        warehouse: row.WarehouseCode || '',
        accountCode: itemInfo.accountCode || '',
        itemCost: itemInfo.itemCost || 0,
        uomCode: row.UoMCode || '',
        uomName: itemInfo.uomName || '',
        distributionRule: row.DistributionRule || '',
        distributionRule2: row.DistributionRule2 || '',
        distributionRule3: row.DistributionRule3 || '',
        distributionRule4: row.DistributionRule4 || '',
        distributionRule5: row.DistributionRule5 || '',
        location: row.LocationCode != null ? String(row.LocationCode) : '',
        branch: header.BranchId != null ? String(header.BranchId) : '',
        baseEntry: null,
        baseLine: null,
        baseType: null,
        lockedByCopy: false,
      };
    }),
  };
};

const getGoodsReceiptList = async () =>
  safe(
    db.query(`
      SELECT TOP 100
        T0.DocEntry,
        T0.DocNum,
        T0.DocDate,
        T0.TaxDate,
        T0.DocTotal,
        CASE
          WHEN ISNULL(T0.CANCELED, 'N') = 'Y' THEN 'Cancelled'
          ELSE 'Posted'
        END AS DocumentStatus,
        T0.Comments,
        T0.JrnlMemo
      FROM OIGN T0
      WHERE ISNULL(T0.CANCELED, 'N') <> 'Y'
      ORDER BY T0.DocEntry DESC
    `)
  ).then((rows) =>
    rows.map((row) => ({
      docEntry: row.DocEntry,
      docNum: row.DocNum,
      postingDate: row.DocDate,
      documentDate: row.TaxDate,
      docTotal: Number(row.DocTotal || 0),
      documentStatus: row.DocumentStatus || 'Open',
      remarks: row.Comments || '',
      journalRemark: row.JrnlMemo || '',
    }))
  );

const getGoodsReceipt = async (docEntry) => {
  const headerColumns = await getTableColumns('OIGN');
  const headerRows = await safe(
    db.query(
      `
        SELECT TOP 1
          T0.DocEntry,
          T0.DocNum,
          T0.Series,
          T0.DocDate,
          T0.TaxDate,
          T0.Ref2,
          ${optionalColumn(headerColumns, 'T0', 'BPLId', 'BranchId')},
          T0.Comments,
          T0.JrnlMemo,
          CASE
            WHEN ISNULL(T0.CANCELED, 'N') = 'Y' THEN 'Cancelled'
            ELSE 'Posted'
          END AS DocumentStatus
        FROM OIGN T0
        WHERE T0.DocEntry = @docEntry
      `,
      { docEntry }
    )
  );

  if (!headerRows.length) {
    throw new Error(`Goods Receipt ${docEntry} not found.`);
  }

  const [lineRows, headerUdfs, lineUdfsByLineNum, batchRows, referenceDocuments] = await Promise.all([
    safe(db.query(
      `
        SELECT
          T0.LineNum,
          T0.ItemCode,
          T0.Dscription AS ItemDescription,
          CAST(ISNULL(T0.Quantity, 0) AS DECIMAL(19, 6)) AS Quantity,
          CAST(ISNULL(T0.Price, 0) AS DECIMAL(19, 6)) AS UnitPrice,
          CAST(ISNULL(T0.LineTotal, 0) AS DECIMAL(19, 6)) AS LineTotal,
          T0.WhsCode AS WarehouseCode,
          T0.AcctCode AS AccountCode,
          CAST(ISNULL(T0.StockPrice, 0) AS DECIMAL(19, 6)) AS ItemCost,
          T0.UomCode AS UoMCode,
          T0.unitMsr AS UoMName,
          T0.OcrCode AS DistributionRule,
          T0.OcrCode2 AS DistributionRule2,
          T0.OcrCode3 AS DistributionRule3,
          T0.OcrCode4 AS DistributionRule4,
          T0.OcrCode5 AS DistributionRule5,
          T0.LocCode AS LocationCode,
          T0.BaseEntry,
          T0.BaseType,
          T0.BaseLine
        FROM IGN1 T0
        WHERE T0.DocEntry = @docEntry
        ORDER BY T0.LineNum
      `,
      { docEntry }
    )),
    getHeaderUdfValues({ tableId: 'OIGN', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'IGN1', keyValue: docEntry }),
    safe(db.query(`
      SELECT BaseLinNum AS BaseLineNum, BatchNum, Quantity
      FROM IBT1
      WHERE BaseEntry = @docEntry
        AND BaseType = 59
      ORDER BY BaseLinNum, BatchNum
    `, { docEntry })),
    getInventoryReferenceDocuments('IGN21', docEntry),
  ]);

  const batchesByLine = batchRows.reduce((acc, row) => {
    if (!acc[row.BaseLineNum]) acc[row.BaseLineNum] = [];
    acc[row.BaseLineNum].push({
      batchNumber: row.BatchNum || '',
      quantity: String(row.Quantity || 0),
      expiryDate: '',
    });
    return acc;
  }, {});

  const itemCodes = [...new Set(lineRows.map((row) => row.ItemCode).filter(Boolean))];
  let itemMap = {};

  if (itemCodes.length) {
    const params = itemCodes.reduce((acc, code, index) => {
      acc[`item${index}`] = code;
      return acc;
    }, {});

    const itemRows = await safe(
      db.query(
        `
          SELECT
            T0.ItemCode,
            T0.InvntryUom AS UoMName,
            T0.ExpensAcct AS AccountCode,
            CAST(ISNULL(T0.AvgPrice, 0) AS DECIMAL(19, 6)) AS ItemCost,
            T0.ManBtchNum AS BatchManaged,
            T0.ManSerNum AS SerialManaged
          FROM OITM T0
          WHERE T0.ItemCode IN (${itemCodes.map((_, index) => `@item${index}`).join(', ')})
        `,
        params
      )
    );

    itemMap = itemRows.reduce((acc, row) => {
      acc[row.ItemCode] = {
        uomName: row.UoMName || '',
        accountCode: row.AccountCode || '',
        itemCost: Number(row.ItemCost || 0),
        batchManaged: String(row.BatchManaged || '').toUpperCase() === 'Y',
        serialManaged: String(row.SerialManaged || '').toUpperCase() === 'Y',
      };
      return acc;
    }, {});
  }

  const header = headerRows[0];
  const firstBaseLine = lineRows.find((row) => row.BaseEntry != null && row.BaseType != null);
  const referencedDocument =
    firstBaseLine &&
    (firstBaseLine.BaseType === 60 ||
      firstBaseLine.BaseType === 202 ||
      firstBaseLine.BaseType === 67)
      ? {
          sourceType:
            firstBaseLine.BaseType === 60
              ? 'goods-issue'
              : firstBaseLine.BaseType === 202
                ? 'receipt-from-production'
                : 'inventory-transfer',
          sourceLabel:
            firstBaseLine.BaseType === 60
              ? 'Goods Issue'
              : firstBaseLine.BaseType === 202
                ? 'Receipt from Production'
                : 'Inventory Transfer',
          docEntry: firstBaseLine.BaseEntry,
          docNum: firstBaseLine.BaseEntry,
        }
      : null;

  return {
    docEntry: header.DocEntry,
    docNum: header.DocNum,
    reference_documents: referenceDocuments,
    headerUdfs: headerUdfs || {},
    header: {
      number: header.DocNum != null ? String(header.DocNum) : 'Auto',
      series: header.Series != null ? String(header.Series) : '',
      postingDate: header.DocDate ? header.DocDate.toISOString().split('T')[0] : '',
      documentDate: header.TaxDate ? header.TaxDate.toISOString().split('T')[0] : '',
      ref2: header.Ref2 || '',
      priceList: '',
      branch: header.BranchId != null ? String(header.BranchId) : '',
      remarks: header.Comments || '',
      journalRemark: header.JrnlMemo || 'Goods Receipt',
      referencedDocument,
      status: header.DocumentStatus || 'Open',
    },
    lines: lineRows.map((row) => {
      const itemInfo = itemMap[row.ItemCode] || {};
      return {
        itemCode: row.ItemCode || '',
        itemDescription: row.ItemDescription || '',
        quantity: String(Number(row.Quantity || 0)),
        unitPrice: String(Number(row.UnitPrice || 0)),
        total: Number(row.LineTotal || 0).toFixed(2),
        warehouse: row.WarehouseCode || '',
        accountCode: row.AccountCode || itemInfo.accountCode || '',
        itemCost: row.ItemCost != null ? String(Number(row.ItemCost || 0)) : itemInfo.itemCost != null ? String(itemInfo.itemCost) : '',
        uomCode: row.UoMCode || '',
        uomName: row.UoMName || itemInfo.uomName || '',
        distributionRule: row.DistributionRule || '',
        distributionRule2: row.DistributionRule2 || '',
        distributionRule3: row.DistributionRule3 || '',
        distributionRule4: row.DistributionRule4 || '',
        distributionRule5: row.DistributionRule5 || '',
        location: row.LocationCode != null ? String(row.LocationCode) : '',
        branch: header.BranchId != null ? String(header.BranchId) : '',
        batchManaged: !!itemInfo.batchManaged,
        serialManaged: !!itemInfo.serialManaged,
        batches: batchesByLine[row.LineNum] || [],
        inventoryUOM: itemInfo.uomName || row.UoMCode || '',
        uomFactor: 1,
        baseEntry: row.BaseEntry ?? null,
        baseLine: row.BaseLine ?? null,
        baseType: row.BaseType ?? null,
        lockedByCopy: row.BaseEntry != null,
        udf: lineUdfsByLineNum[row.LineNum] || {},
      };
    }),
  };
};

module.exports = {
  getItems,
  getBatchesByItem,
  getWarehouses,
  getDistributionRules,
  getSeries,
  getPriceLists,
  getBranches,
  getPurchaseOrders,
  getPurchaseInvoices,
  getGoodsIssues,
  getPurchaseOrderForCopy,
  getPurchaseInvoiceForCopy,
  getGoodsIssueForCopy,
  getGoodsReceiptList,
  getGoodsReceipt,
};
