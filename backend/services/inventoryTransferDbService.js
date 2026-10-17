const db = require('../db/odbc');
const { loadBusinessPartnerAddresses } = require('./businessPartnerAddressDbUtils');
const { getHeaderUdfValues, getLineUdfValues } = require('./udfMetadataService');
const { mapInventoryPriceLists } = require('./inventoryPriceListUtils');
const { getMarketingDocumentSeries } = require('./documentSeriesDbUtils');

const safe = async (promise) => {
  try {
    const result = await promise;
    return result.recordset || [];
  } catch (error) {
    console.error('[InventoryTransferDB] Query failed:', error.message);
    return [];
  }
};

const buildAddressText = (row) =>
  [row.Street, row.Block, row.City, row.ZipCode, row.State, row.Country]
    .filter(Boolean)
    .join(', ');

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

const quoteSqlIdentifier = (identifier) => `[${String(identifier || '').replace(/]/g, ']]')}]`;

const getColumnName = (columns, columnName) => (
  [...columns].find((candidate) => String(candidate).toLowerCase() === String(columnName).toLowerCase())
);

const optionalColumn = (columns, tableAlias, columnName, alias, fallback = 'NULL') => {
  const actualColumnName = getColumnName(columns, columnName);
  return actualColumnName
    ? `${tableAlias}.${quoteSqlIdentifier(actualColumnName)} AS ${quoteSqlIdentifier(alias)}`
    : `${fallback} AS ${quoteSqlIdentifier(alias)}`;
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
          CAST(ISNULL(T0.AvgPrice, 0) AS DECIMAL(19, 6)) AS ItemCost
        FROM OITM T0
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
    prices: priceMap[row.ItemCode] || {},
  }));
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
        City,
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
      city: row.City || '',
      branchId: row.BranchId != null ? String(row.BranchId) : '',
      locationCode: row.LocationCode != null ? String(row.LocationCode) : '',
    }))
  );
};

const getSeries = async (targetDate = null, { branch = '' } = {}) => {
  const rows = await getMarketingDocumentSeries({
    db,
    objectCode: '67',
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

const getBusinessPartners = async () =>
  safe(
    db.query(`
      SELECT
        CardCode,
        CardName,
        CardType,
        ListNum AS PriceListNum,
        CAST(ISNULL(Balance, 0) AS DECIMAL(19, 2)) AS Balance
      FROM OCRD
      WHERE ISNULL(validFor, 'Y') <> 'N'
        AND ISNULL(frozenFor, 'N') <> 'Y'
      ORDER BY CardCode
    `)
  ).then((rows) =>
    rows.map((row) => ({
      cardCode: row.CardCode,
      cardName: row.CardName,
      cardType: row.CardType || '',
      priceList: row.PriceListNum != null ? String(row.PriceListNum) : '',
      balance: Number(row.Balance || 0),
      currentAccountBalance: Number(row.Balance || 0),
    }))
  );

const getSalesEmployees = async () =>
  safe(
    db.query(`
      SELECT
        SlpCode,
        SlpName
      FROM OSLP
      WHERE ISNULL(Active, 'Y') <> 'N'
      ORDER BY SlpName
    `)
  ).then((rows) =>
    rows.map((row) => ({
      id: String(row.SlpCode),
      name: row.SlpName,
    }))
  );

const getBusinessPartnerDetails = async (cardCode) => {
  const [contactRows, addressGroups] = await Promise.all([
    safe(
      db.query(
        `
          SELECT
            CntctCode,
            Name
          FROM OCPR
          WHERE CardCode = @cardCode
          ORDER BY Name
        `,
        { cardCode }
      )
    ),
    loadBusinessPartnerAddresses(db, cardCode, { context: 'Inventory Transfer' }),
  ]);

  return {
    contacts: contactRows.map((row) => ({
      id: String(row.CntctCode),
      name: row.Name || '',
    })),
    shipToAddresses: addressGroups.shipTo.map((row) => ({
      id: row.Address || '',
      label: row.Address || '',
      fullAddress: buildAddressText(row),
    })),
  };
};

const getInventoryTransferList = async () =>
  safe(
    db.query(`
      SELECT TOP 100
        T0.DocEntry,
        T0.DocNum,
        T0.DocDate,
        T0.DocDueDate,
        T0.TaxDate,
        T0.CardCode,
        T0.CardName,
        T0.Filler AS FromWarehouse,
        T0.ToWhsCode AS ToWarehouse,
        T0.Comments,
        T0.JrnlMemo,
        CASE T0.DocStatus
          WHEN 'O' THEN 'Open'
          WHEN 'C' THEN 'Posted'
          ELSE T0.DocStatus
        END AS DocumentStatus
      FROM OWTR T0
      ORDER BY T0.DocEntry DESC
    `)
  ).then((rows) =>
    rows.map((row) => ({
      docEntry: row.DocEntry,
      docNum: row.DocNum,
      postingDate: row.DocDate,
      dueDate: row.DocDueDate,
      documentDate: row.TaxDate,
      businessPartner: row.CardCode || '',
      businessPartnerName: row.CardName || '',
      fromWarehouse: row.FromWarehouse || '',
      toWarehouse: row.ToWarehouse || '',
      remarks: row.Comments || '',
      journalRemark: row.JrnlMemo || '',
      documentStatus: row.DocumentStatus || 'Posted',
    }))
  );

const getInventoryTransfer = async (docEntry) => {
  const headerColumns = await getTableColumns('OWTR');
  const headerRows = await safe(
    db.query(
      `
        SELECT TOP 1
          T0.DocEntry,
          T0.DocNum,
          T0.Series,
          T0.DocDate,
          T0.DocDueDate,
          T0.TaxDate,
          T0.CardCode,
          T0.CardName,
          T0.CntctCode,
          C1.Name AS ContactPersonName,
          T0.ShipToCode,
          T0.Address,
          ${optionalColumn(headerColumns, 'T0', 'BPLId', 'BranchId')},
          C2.ListNum AS PriceListNum,
          T0.Filler AS FromWarehouse,
          T0.ToWhsCode AS ToWarehouse,
          T0.NumAtCard,
          T0.Comments,
          T0.JrnlMemo,
          T0.SlpCode,
          CASE T0.DocStatus
            WHEN 'O' THEN 'Open'
            WHEN 'C' THEN 'Posted'
            ELSE T0.DocStatus
          END AS DocumentStatus
        FROM OWTR T0
        LEFT JOIN OCPR C1
          ON C1.CardCode = T0.CardCode
         AND C1.CntctCode = T0.CntctCode
        LEFT JOIN OCRD C2
          ON C2.CardCode = T0.CardCode
        WHERE T0.DocEntry = @docEntry
      `,
      { docEntry }
    )
  );

  if (!headerRows.length) {
    throw new Error(`Inventory Transfer ${docEntry} not found.`);
  }

  const lineColumns = await getTableColumns('WTR1');
  const lineRows = await safe(
    db.query(
      `
        SELECT
          T0.LineNum,
          T0.ItemCode,
          T0.Dscription AS ItemDescription,
          CAST(ISNULL(T0.Quantity, 0) AS DECIMAL(19, 6)) AS Quantity,
          ISNULL(T0.FromWhsCod, T1.Filler) AS FromWarehouseCode,
          ISNULL(T0.WhsCode, T1.ToWhsCode) AS ToWarehouseCode,
          T0.LocCode AS LocationCode,
          T0.OcrCode AS DistributionRule,
          T0.OcrCode2 AS DistributionRule2,
          T0.OcrCode3 AS DistributionRule3,
          T0.OcrCode4 AS DistributionRule4,
          T0.OcrCode5 AS DistributionRule5,
          T0.unitMsr AS UoMCode,
          ${getColumnName(lineColumns, 'StockValue')
            ? `CAST(ISNULL(T0.${quoteSqlIdentifier(getColumnName(lineColumns, 'StockValue'))}, 0) AS DECIMAL(19, 6))`
            : 'CAST(0 AS DECIMAL(19, 6))'} AS AssessableValue
        FROM WTR1 T0
        INNER JOIN OWTR T1
          ON T1.DocEntry = T0.DocEntry
        WHERE T0.DocEntry = @docEntry
        ORDER BY T0.LineNum
      `,
      { docEntry }
    )
  );
  const [headerUdfs, lineUdfsByLineNum] = await Promise.all([
    getHeaderUdfValues({ tableId: 'OWTR', keyValue: docEntry }),
    getLineUdfValues({ tableId: 'WTR1', keyValue: docEntry }),
  ]);

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
        itemCost: Number(row.ItemCost || 0),
      };
      return acc;
    }, {});
  }

  const header = headerRows[0];

  return {
    docEntry: header.DocEntry,
    docNum: header.DocNum,
    headerUdfs: headerUdfs || {},
    header: {
      number: header.DocNum != null ? String(header.DocNum) : 'Auto',
      series: header.Series != null ? String(header.Series) : '',
      status: header.DocumentStatus || 'Posted',
      postingDate: header.DocDate ? header.DocDate.toISOString().split('T')[0] : '',
      dueDate: header.DocDueDate ? header.DocDueDate.toISOString().split('T')[0] : '',
      documentDate: header.TaxDate ? header.TaxDate.toISOString().split('T')[0] : '',
      businessPartner: header.CardCode || '',
      businessPartnerName: header.CardName || '',
      contactPerson: header.CntctCode != null ? String(header.CntctCode) : '',
      contactPersonName: header.ContactPersonName || '',
      shipTo: header.ShipToCode || '',
      shipToAddress: header.Address || '',
      vat: false,
      priceList: header.PriceListNum != null ? String(header.PriceListNum) : '',
      fromBranch: header.BranchId != null ? String(header.BranchId) : '',
      fromWarehouse: header.FromWarehouse || '',
      toWarehouse: header.ToWarehouse || '',
      referencedDocument: header.NumAtCard || '',
      salesEmployee: header.SlpCode != null && Number(header.SlpCode) >= 0 ? String(header.SlpCode) : '',
      dutyStatus: 'With Payment of Duty',
      journalRemark: header.JrnlMemo || 'Inventory Transfer',
      pickPackRemarks: '',
      remarks: header.Comments || '',
      createQrCodeFrom: '',
    },
    lines: lineRows.map((row) => {
      const itemInfo = itemMap[row.ItemCode] || {};
      return {
        itemCode: row.ItemCode || '',
        itemDescription: row.ItemDescription || '',
        fromWarehouse: row.FromWarehouseCode || '',
        toWarehouse: row.ToWarehouseCode || '',
        location: row.LocationCode != null ? String(row.LocationCode) : '',
        quantity: String(Number(row.Quantity || 0)),
        itemCost: itemInfo.itemCost != null ? String(itemInfo.itemCost) : '',
        distributionRule: row.DistributionRule || '',
        distributionRule2: row.DistributionRule2 || '',
        distributionRule3: row.DistributionRule3 || '',
        distributionRule4: row.DistributionRule4 || '',
        distributionRule5: row.DistributionRule5 || '',
        uomCode: row.UoMCode || '',
        uomName: itemInfo.uomName || '',
        branch: header.BranchId != null ? String(header.BranchId) : '',
        assessableValue: Number(row.AssessableValue || 0).toFixed(2),
        udf: lineUdfsByLineNum[row.LineNum] || {},
      };
    }),
  };
};

module.exports = {
  getItems,
  getWarehouses,
  getSeries,
  getPriceLists,
  getBranches,
  getBusinessPartners,
  getSalesEmployees,
  getBusinessPartnerDetails,
  getInventoryTransferList,
  getInventoryTransfer,
};
