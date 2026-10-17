const db = require('../db/odbc');
const hsnCodeDbService = require('./hsnCodeDbService');
const { appendSapSearchCondition } = require('./documentListUtils');

const safe = async (promise, fallback = []) => {
  try {
    const result = await promise;
    return result.recordset || fallback;
  } catch (error) {
    console.error('[ItemDB] Query failed:', error.message);
    return fallback;
  }
};

const toSapBool = (value) => {
  if (value === 'tYES' || value === 'tNO') return value;
  return String(value || '').toUpperCase() === 'Y' ? 'tYES' : 'tNO';
};

const toIsoDate = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? '' : asDate.toISOString().split('T')[0];
};

const toNumberOrBlank = (value) => {
  if (value == null || value === '') return '';
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : '';
};

const toIntOrDefault = (value, fallback = -1) => {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const mapCostAccountingMethod = (value) => {
  const map = {
    A: 'bis_MovingAverage',
    S: 'bis_Standard',
    F: 'bis_FIFO',
    B: 'bis_SNB',
  };
  return map[value] || value || '';
};

const mapGLMethod = (value) => {
  const map = {
    W: 'glm_WH',
    C: 'glm_ItemClass',
    L: 'glm_ItemLevel',
  };
  return map[value] || value || '';
};

const mapTaxType = (value) => {
  const map = {
    Y: 'tt_Yes',
    U: 'tt_UseTax',
    N: 'tt_No',
  };
  return map[value] || value || '';
};

const mapPlanningSystem = (value) => {
  const map = {
    N: 'bop_None',
    M: 'bop_MRP',
  };
  return map[value] || value || '';
};

const mapProcurementMethod = (value) => {
  const map = {
    B: 'bom_Buy',
    M: 'bom_Make',
  };
  return map[value] || value || '';
};

const mapIssueMethod = (value) => {
  const map = {
    M: 'im_Manual',
    B: 'im_Backflush',
  };
  return map[value] || value || '';
};

const mapManageMethod = (value) => {
  const map = {
    A: 'bomm_OnEveryTransaction',
    R: 'bomm_OnReleaseOnly',
  };
  return map[value] || value || '';
};

const mapItemType = (value) => {
  const map = {
    I: 'itItems',
    L: 'itLabor',
    T: 'itTravel',
    F: 'itFixedAssets',
  };
  return map[value] || value || '';
};

const mapItemClass = (value) => {
  const map = {
    1: 'itcService',
    2: 'itcMaterial',
    3: 'itcLabor',
    4: 'itcTravel',
  };
  return map[value] || value || '';
};

const mapTreeType = (value) => {
  const map = {
    N: 'iNotATree',
    A: 'iAssemblyTree',
    P: 'iProductionTree',
    S: 'iSalesTree',
    T: 'iTemplateTree',
  };
  return map[value] || value || '';
};

const mapIssuePrimarilyBy = (value) => {
  const map = {
    0: 'ipbSerialAndBatchNumbers',
    1: 'ipbSerialNumbers',
    2: 'ipbBatchNumbers',
  };
  return map[String(value)] || '';
};

const mapGstTaxCategory = (value) => {
  const map = {
    R: 'gtc_Regular',
    E: 'gtc_Exempt',
    N: 'gtc_NilRated',
  };
  return map[value] || value || '';
};

const mapUomType = (value) => {
  const map = {
    I: 'uomtInventory',
    P: 'uomtPurchasing',
    S: 'uomtSales',
  };
  return map[value] || 'uomtPurchasing';
};

const buildLike = (query) => `%${String(query || '').trim()}%`;

const mapWarehouseRows = (rows) =>
  rows.map((row) => ({
    WarehouseCode: row.WarehouseCode,
    WarehouseName: row.WarehouseName || row.WarehouseCode,
    Branch: row.BranchId != null ? String(row.BranchId) : '',
    Locked: toSapBool(row.Locked),
    InStock: Number(row.InStock || 0),
    Committed: Number(row.Committed || 0),
    Ordered: Number(row.Ordered || 0),
    MinimalStock: toNumberOrBlank(row.MinimalStock),
    MaximalStock: toNumberOrBlank(row.MaximalStock),
    MinimalOrder: toNumberOrBlank(row.MinimalOrder),
    StandardAveragePrice: Number(row.StandardAveragePrice || 0),
  }));

const mapHeaderRow = (row) => {
  if (!row) return null;

  const item = {
    ItemCode: row.ItemCode || '',
    ItemName: row.ItemName || '',
    ForeignName: row.FrgnName || '',
    ItemsGroupCode: toIntOrDefault(row.ItmsGrpCod, ''),
    ItemsGroupName: row.ItemsGroupName || '',
    CustomsGroupCode: toIntOrDefault(row.CstGrpCode),
    SalesVATGroup: row.VatGourpSa || '',
    BarCode: row.CodeBars || '',
    VatLiable: toSapBool(row.VATLiable),
    PurchaseItem: toSapBool(row.PrchseItem),
    SalesItem: toSapBool(row.SellItem),
    InventoryItem: toSapBool(row.InvntItem),
    IncomeAccount: row.IncomeAcct || '',
    ExemptIncomeAccount: row.ExmptIncom || '',
    ExpanseAccount: row.ExpensAcct || '',
    Mainsupplier: row.CardCode || '',
    DefaultVendorName: row.DefaultVendorName || '',
    SupplierCatalogNo: row.SuppCatNum || '',
    DesiredInventory: toNumberOrBlank(row.ReorderQty),
    MinInventory: toNumberOrBlank(row.MinLevel),
    MaxInventory: toNumberOrBlank(row.MaxLevel),
    DefaultWarehouse: row.DfltWH || '',
    PurchaseUnit: row.BuyUnitMsr || '',
    PurchaseItemsPerUnit: toNumberOrBlank(row.NumInBuy),
    SalesUnit: row.SalUnitMsr || '',
    SalesItemsPerUnit: toNumberOrBlank(row.NumInSale),
    PurchasePackagingUnit: row.PurPackMsr || '',
    PurchaseQtyPerPackUnit: toNumberOrBlank(row.PurPackUn),
    SalesPackagingUnit: row.SalPackMsr || '',
    SalesQtyPerPackUnit: toNumberOrBlank(row.SalPackUn),
    PurchaseUnitLength: toNumberOrBlank(row.BLength1),
    PurchaseLengthUnit: row.BLen1Unit || '',
    PurchaseUnitWidth: toNumberOrBlank(row.BWidth1),
    PurchaseWidthUnit: row.BWdth1Unit || '',
    PurchaseUnitHeight: toNumberOrBlank(row.BHeight1),
    PurchaseHeightUnit: row.BHght1Unit || '',
    PurchaseUnitVolume: toNumberOrBlank(row.BVolume),
    PurchaseVolumeUnit: row.BVolUnit || '',
    PurchaseUnitWeight: toNumberOrBlank(row.BWeight1),
    PurchaseWeightUnit: row.BWght1Unit || '',
    PurchaseUnitWeight1: toNumberOrBlank(row.BWeight2),
    PurchaseWeightUnit1: row.BWght2Unit || '',
    SalesUnitLength: toNumberOrBlank(row.SLength1),
    SalesLengthUnit: row.SLen1Unit || '',
    SalesUnitWidth: toNumberOrBlank(row.SWidth1),
    SalesWidthUnit: row.SWdth1Unit || '',
    SalesUnitHeight: toNumberOrBlank(row.SHeight1),
    SalesHeightUnit: row.SHght1Unit || '',
    SalesUnitVolume: toNumberOrBlank(row.SVolume),
    SalesVolumeUnit: row.SVolUnit || '',
    SalesUnitWeight: toNumberOrBlank(row.SWeight1),
    SalesWeightUnit: row.SWght1Unit || '',
    SalesUnitWeight1: toNumberOrBlank(row.SWeight2),
    SalesWeightUnit1: row.SWght2Unit || '',
    CommissionPercent: toNumberOrBlank(row.CommisPcnt),
    CommissionSum: toNumberOrBlank(row.CommisSum),
    CommissionGroup: toIntOrDefault(row.CommisGrp),
    TreeType: mapTreeType(row.TreeType),
    AssetItem: toSapBool(row.AssetItem),
    DataExportCode: row.ExportCode || '',
    Manufacturer: toIntOrDefault(row.FirmCode),
    ManufacturerName: row.ManufacturerName || '',
    QuantityOnStock: Number(row.OnHand || 0),
    QuantityOrderedFromVendors: Number(row.OnOrder || 0),
    QuantityOrderedByCustomers: Number(row.IsCommited || 0),
    ManageSerialNumbers: toSapBool(row.ManSerNum),
    ManageBatchNumbers: toSapBool(row.ManBtchNum),
    Valid: toSapBool(row.validFor),
    ValidFrom: toIsoDate(row.validFrom),
    ValidTo: toIsoDate(row.validTo),
    ValidRemarks: row.ValidComm || '',
    Frozen: toSapBool(row.frozenFor),
    FrozenFrom: toIsoDate(row.frozenFrom),
    FrozenTo: toIsoDate(row.frozenTo),
    FrozenRemarks: row.FrozenComm || '',
    MovingAveragePrice: toNumberOrBlank(row.AvgPrice),
    AvgStdPrice: toNumberOrBlank(row.LstEvlPric ?? row.AvgPrice),
    LastPurPrc: toNumberOrBlank(row.LastPurPrc),
    PurchaseVATGroup: row.VatGroupPu || '',
    SalesFactor1: toNumberOrBlank(row.SalFactor1),
    SalesFactor2: toNumberOrBlank(row.SalFactor2),
    SalesFactor3: toNumberOrBlank(row.SalFactor3),
    SalesFactor4: toNumberOrBlank(row.SalFactor4),
    PurchaseFactor1: toNumberOrBlank(row.PurFactor1),
    PurchaseFactor2: toNumberOrBlank(row.PurFactor2),
    PurchaseFactor3: toNumberOrBlank(row.PurFactor3),
    PurchaseFactor4: toNumberOrBlank(row.PurFactor4),
    ForeignRevenuesAccount: row.FrgnInAcct || '',
    ECRevenuesAccount: row.ECInAcct || '',
    ForeignExpensesAccount: row.FrgnExpAcc || '',
    ECExpensesAccount: row.ECExpAcc || '',
    ShipType: toIntOrDefault(row.ShipType),
    GLMethod: mapGLMethod(row.GLMethod),
    TaxType: mapTaxType(row.TaxType),
    ManageStockByWarehouse: toSapBool(row.ByWh),
    WTLiable: toSapBool(row.WTLiable),
    CostAccountingMethod: mapCostAccountingMethod(row.EvalSystem),
    WarrantyTemplate: row.WarrntTmpl || '',
    IndirectTax: toSapBool(row.IndirctTax),
    ArTaxCode: row.TaxCodeAR || '',
    ApTaxCode: row.TaxCodeAP || '',
    BaseUnitName: row.BaseUnit || '',
    ItemCountryOrg: row.CountryOrg || '',
    IssueMethod: mapIssueMethod(row.IssueMthd),
    SRIAndBatchManageMethod: mapManageMethod(row.MngMethod),
    IsPhantom: toSapBool(row.Phantom),
    InventoryUOM: row.InvntryUom || '',
    PlanningSystem: mapPlanningSystem(row.PlaningSys),
    ProcurementMethod: mapProcurementMethod(row.PrcrmntMtd),
    OrderIntervals: toNumberOrBlank(row.OrdrIntrvl),
    OrderMultiple: toNumberOrBlank(row.OrdrMulti),
    LeadTime: toNumberOrBlank(row.LeadTime),
    MinOrderQuantity: toNumberOrBlank(row.MinOrdrQty),
    ItemType: mapItemType(row.ItemType),
    ItemClass: mapItemClass(row.ItemClass),
    OutgoingServiceCode: row.OSvcCode || '',
    IncomingServiceCode: row.ISvcCode || '',
    ServiceGroup: toIntOrDefault(row.ServiceGrp),
    NCMCode: row.NCMCode || '',
    MaterialType: toIntOrDefault(row.MatType),
    MaterialGroup: toIntOrDefault(row.MatGrp),
    ProductSource: row.ProductSrc || '',
    User_Text: row.UserText || '',
    Remarks: row.UserText || '',
    SerialNum: row.SerialNum || '',
    NoDiscounts: toSapBool(row.NoDiscount),
    AssetClass: toIntOrDefault(row.AssetClass),
    AssetGroup: toIntOrDefault(row.AssetGroup),
    InventoryNumber: row.InventryNo || '',
    Technician: toIntOrDefault(row.Technician),
    Employee: toIntOrDefault(row.Employee),
    Location: toIntOrDefault(row.Location),
    AssetStatus: toIntOrDefault(row.AsstStatus),
    CapitalizationDate: toIsoDate(row.CapDate),
    StatisticalAsset: toSapBool(row.StatAsset),
    Cession: toSapBool(row.Cession),
    DeactivateAfterUsefulLife: toSapBool(row.DeacAftUL),
    ManageByQuantity: toSapBool(row.MgrByQty),
    UoMGroupEntry: toIntOrDefault(row.UgpEntry),
    UoMGroupName: row.UoMGroupName || '',
    InventoryUoMEntry: toIntOrDefault(row.IUoMEntry),
    DefaultSalesUoMEntry: toIntOrDefault(row.SUoMEntry),
    DefaultPurchasingUoMEntry: toIntOrDefault(row.PUoMEntry),
    DepreciationGroup: toIntOrDefault(row.DeprGroup),
    AssetSerialNumber: row.AssetSerNo || '',
    InventoryWeight: toNumberOrBlank(row.IWeight1),
    InventoryWeightUnit: row.IWght1Unit || '',
    InventoryWeight1: toNumberOrBlank(row.IWeight2),
    InventoryWeightUnit1: row.IWght2Unit || '',
    DefaultCountingUnit: row.CntUnitMsr || '',
    CountingItemsPerUnit: toNumberOrBlank(row.NumInCnt),
    DefaultCountingUoMEntry: toIntOrDefault(row.INUoMEntry),
    Excisable: toSapBool(row.Excisable),
    ChapterID: row.ChapterCode || (row.ChapterID != null ? String(row.ChapterID) : ''),
    ScsCode: row.ScsCode || '',
    SpProdType: row.SpProdType || '',
    ProdStdCost: toNumberOrBlank(row.PrdStdCst),
    InCostRollup: toSapBool(row.InCostRoll),
    VirtualAssetItem: toSapBool(row.VirtAstItm),
    EnforceAssetSerialNumbers: toSapBool(row.EnAstSeri),
    AttachmentEntry: toIntOrDefault(row.AtcEntry),
    LinkedResource: row.LinkRsc || '',
    GSTRelevnt: toSapBool(row.GSTRelevnt),
    SACEntry: toIntOrDefault(row.SACEntry),
    GSTTaxCategory: mapGstTaxCategory(row.GstTaxCtg),
    ServiceCategoryEntry: toIntOrDefault(row.ServiceCtg),
    CapitalGoodsOnHoldPercent: toNumberOrBlank(row.OnHldPert),
    CapitalGoodsOnHoldLimit: toNumberOrBlank(row.onHldLimt),
    AssessableValue: toNumberOrBlank(row.AssblValue),
    AssVal4WTR: toNumberOrBlank(row.AssVal4WTR),
    SOIExcisable: toSapBool(row.SOIExc),
    TNVED: row.TNVED || '',
    ImportedItem: toSapBool(row.Imported),
    PricingUnit: toNumberOrBlank(row.PriceUnit),
    CreateQRCodeFrom: row.QRCodeSrc || '',
    TraceableItem: toSapBool(row.Traceable),
    CommodityClassification: row.CommClass || '',
    WeightOfRecycledPlastic: toNumberOrBlank(row.PlPaWght),
    PlasticPackageTaxCategory: row.PlPaTaxCat || '',
    PlasticPackageExemptionReasonForPurchase: row.PPTExReSa || '',
    PlasticPackageExemptionReasonForProduction: row.PPTExRePr || '',
    SAFTProductType: row.ProdctType || '',
    SAFTProductTypeEx: row.ProdTypeEx || '',
  };

  for (let i = 1; i <= 64; i += 1) {
    item[`Properties${i}`] = toSapBool(row[`QryGroup${i}`]);
  }

  Object.keys(row).forEach((key) => {
    if (key.startsWith('U_')) {
      item[key] = row[key];
    }
  });

  return item;
};

const getItemHeader = async (itemCode) => {
  const rows = await safe(
    db.query(
      `
        SELECT TOP 1
          T0.*,
          T1.ItmsGrpNam AS ItemsGroupName,
          T2.FirmName AS ManufacturerName,
          T3.ChapterID AS ChapterCode,
          T4.UgpName AS UoMGroupName,
          T5.CardName AS DefaultVendorName
        FROM OITM T0
        LEFT JOIN OITB T1
          ON T1.ItmsGrpCod = T0.ItmsGrpCod
        LEFT JOIN OMRC T2
          ON T2.FirmCode = T0.FirmCode
        LEFT JOIN OCHP T3
          ON T3.AbsEntry = T0.ChapterID
        LEFT JOIN OUGP T4
          ON T4.UgpEntry = T0.UgpEntry
        LEFT JOIN OCRD T5
          ON T5.CardCode = T0.CardCode
        WHERE T0.ItemCode = @itemCode
      `,
      { itemCode }
    )
  );

  return rows[0] || null;
};

const getItemPrices = async (itemCode) => {
  const rows = await safe(
    db.query(
      `
        SELECT
          T0.PriceList AS PriceList,
          CAST(ISNULL(T0.Price, 0) AS DECIMAL(19, 6)) AS Price,
          T0.Currency AS Currency,
          CAST(ISNULL(T0.AddPrice1, 0) AS DECIMAL(19, 6)) AS AdditionalPrice1,
          T0.Currency1 AS AdditionalCurrency1,
          CAST(ISNULL(T0.AddPrice2, 0) AS DECIMAL(19, 6)) AS AdditionalPrice2,
          T0.Currency2 AS AdditionalCurrency2,
          T0.BasePLNum AS BasePriceList,
          CAST(ISNULL(T0.Factor, 1) AS DECIMAL(19, 6)) AS Factor,
          T1.ListName AS PriceListName
        FROM ITM1 T0
        LEFT JOIN OPLN T1
          ON T1.ListNum = T0.PriceList
        WHERE T0.ItemCode = @itemCode
        ORDER BY T0.PriceList
      `,
      { itemCode }
    )
  );

  return rows.map((row) => ({
    PriceList: row.PriceList,
    Price: Number(row.Price || 0),
    Currency: row.Currency || null,
    AdditionalPrice1: Number(row.AdditionalPrice1 || 0),
    AdditionalCurrency1: row.AdditionalCurrency1 || null,
    AdditionalPrice2: Number(row.AdditionalPrice2 || 0),
    AdditionalCurrency2: row.AdditionalCurrency2 || null,
    BasePriceList: row.BasePriceList,
    Factor: Number(row.Factor || 1),
    PriceListName: row.PriceListName || `List ${row.PriceList}`,
  }));
};

const getItemWarehouseInfoCollection = async (itemCode) => {
  const rows = await safe(
    db.query(
      `
        SELECT
          T0.WhsCode AS WarehouseCode,
          T1.WhsName AS WarehouseName,
          T1.BPLid AS BranchId,
          T0.Locked,
          CAST(ISNULL(T0.OnHand, 0) AS DECIMAL(19, 6)) AS InStock,
          CAST(ISNULL(T0.IsCommited, 0) AS DECIMAL(19, 6)) AS Committed,
          CAST(ISNULL(T0.OnOrder, 0) AS DECIMAL(19, 6)) AS Ordered,
          CAST(ISNULL(T0.MinStock, 0) AS DECIMAL(19, 6)) AS MinimalStock,
          CAST(ISNULL(T0.MaxStock, 0) AS DECIMAL(19, 6)) AS MaximalStock,
          CAST(ISNULL(T0.MinOrder, 0) AS DECIMAL(19, 6)) AS MinimalOrder,
          CAST(ISNULL(T0.AvgPrice, 0) AS DECIMAL(19, 6)) AS StandardAveragePrice
        FROM OITW T0
        LEFT JOIN OWHS T1
          ON T1.WhsCode = T0.WhsCode
        WHERE T0.ItemCode = @itemCode
        ORDER BY T0.WhsCode
      `,
      { itemCode }
    )
  );

  return mapWarehouseRows(rows);
};

const getItemBarcodes = async (itemCode) => {
  const rows = await safe(
    db.query(
      `
        SELECT
          BcdEntry,
          BcdCode AS Barcode,
          UomEntry
        FROM OBCD
        WHERE ItemCode = @itemCode
        ORDER BY BcdEntry
      `,
      { itemCode }
    )
  );

  return rows.map((row) => ({
    Barcode: row.Barcode || '',
    UoMEntry: row.UomEntry != null ? Number(row.UomEntry) : null,
    Quantity: 1,
  }));
};

const getItemUoms = async (itemCode, ugpEntry) => {
  if (!Number.isInteger(Number(ugpEntry)) || Number(ugpEntry) <= 0) {
    return [];
  }

  const rows = await safe(
    db.query(
      `
        SELECT
          T0.UomEntry AS AlternateUoM,
          CAST(ISNULL(T0.BaseQty, 1) AS DECIMAL(19, 6)) AS BaseQuantity,
          CAST(ISNULL(T0.AltQty, 1) AS DECIMAL(19, 6)) AS AlternateQuantity,
          T1.UomType,
          T2.UomCode,
          T2.UomName
        FROM UGP1 T0
        LEFT JOIN ITM12 T1
          ON T1.ItemCode = @itemCode
         AND T1.UomEntry = T0.UomEntry
        LEFT JOIN OUOM T2
          ON T2.UomEntry = T0.UomEntry
        WHERE T0.UgpEntry = @ugpEntry
        ORDER BY T0.LineNum
      `,
      { itemCode, ugpEntry }
    )
  );

  return rows.map((row) => ({
    AlternateUoM: Number(row.AlternateUoM),
    AlternateUoMName: row.UomName || row.UomCode || '',
    BaseQuantity: Number(row.BaseQuantity || 1),
    AlternateQuantity: Number(row.AlternateQuantity || 1),
    UoMType: mapUomType(row.UomType),
  }));
};

const getPreferredVendors = async (itemCode) => {
  const rows = await safe(
    db.query(
      `
        SELECT
          T0.VendorCode,
          T1.CardName AS VendorName
        FROM ITM2 T0
        LEFT JOIN OCRD T1
          ON T1.CardCode = T0.VendorCode
        WHERE T0.ItemCode = @itemCode
        ORDER BY T0.VendorCode
      `,
      { itemCode }
    )
  );

  return rows.map((row) => ({
    VendorCode: row.VendorCode || '',
    VendorName: row.VendorName || '',
  }));
};

const getItem = async (itemCode) => {
  const headerRow = await getItemHeader(itemCode);

  if (!headerRow) {
    throw new Error(`Item ${itemCode} not found.`);
  }

  const [prices, warehouses, barcodes, uoms, preferredVendors] = await Promise.all([
    getItemPrices(itemCode),
    getItemWarehouseInfoCollection(itemCode),
    getItemBarcodes(itemCode),
    getItemUoms(itemCode, headerRow.UgpEntry),
    getPreferredVendors(itemCode),
  ]);

  return {
    ...mapHeaderRow(headerRow),
    PriceListNum: prices[0]?.PriceList != null ? String(prices[0].PriceList) : '',
    PriceListName: prices[0]?.PriceListName || '',
    Price: prices[0]?.Price != null ? Number(prices[0].Price) : '',
    ItemPrices: prices,
    ItemWarehouseInfoCollection: warehouses,
    ItemBarCodeCollection: barcodes,
    ItemUnitOfMeasurementCollection: uoms,
    ItemPreferredVendors: preferredVendors,
  };
};

const searchItems = async (query = '', top = 50, skip = 0) => {
  const hasQuery = Boolean(String(query || '').trim());
  const whereClauses = [];
  const searchParams = {};
  if (hasQuery) {
    appendSapSearchCondition(
      whereClauses,
      searchParams,
      ['T0.ItemCode', 'T0.ItemName'],
      query,
      'itemQuery',
    );
  }
  const rows = await safe(
    db.query(
      `
        SELECT
          T0.ItemCode,
          T0.ItemName,
          T0.ItmsGrpCod AS ItemsGroupCode,
          T1.ItmsGrpNam AS ItemsGroupName,
          CAST(ISNULL(T2.Price, 0) AS DECIMAL(19, 6)) AS Price,
          T0.InvntItem AS InventoryItem,
          T0.SellItem AS SalesItem,
          T0.PrchseItem AS PurchaseItem,
          T0.AssetItem AS AssetItem,
          T0.validFor AS Valid,
          T0.frozenFor AS Frozen,
          T0.ItemType,
          T0.ItemClass
        FROM OITM T0
        LEFT JOIN OITB T1
          ON T1.ItmsGrpCod = T0.ItmsGrpCod
        LEFT JOIN (
          SELECT
            PX.ItemCode,
            PX.Price,
            ROW_NUMBER() OVER (
              PARTITION BY PX.ItemCode
              ORDER BY CASE WHEN PX.PriceList = 1 THEN 0 ELSE 1 END, PX.PriceList
            ) AS PriceRank
          FROM ITM1 PX
        ) T2
          ON T2.ItemCode = T0.ItemCode
         AND T2.PriceRank = 1
        WHERE (@hasQuery = 0
          ${whereClauses.length ? `OR ${whereClauses.join(' OR ')}` : ''})
        ORDER BY T0.ItemCode
        OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        ...searchParams,
        top: Number(top) || 50,
        skip: Number(skip) || 0,
      }
    )
  );

  return rows.map((row) => ({
    ItemCode: row.ItemCode,
    ItemName: row.ItemName || '',
    ItemsGroupCode: row.ItemsGroupCode,
    ItemsGroupName: row.ItemsGroupName || '',
    Price: Number(row.Price || 0),
    InventoryItem: toSapBool(row.InventoryItem),
    SalesItem: toSapBool(row.SalesItem),
    PurchaseItem: toSapBool(row.PurchaseItem),
    AssetItem: toSapBool(row.AssetItem),
    Valid: toSapBool(row.Valid),
    Frozen: toSapBool(row.Frozen),
    ItemType: mapItemType(row.ItemType),
    ItemClass: mapItemClass(row.ItemClass),
  }));
};

const getRecentItemCodes = async (query = '') => {
  const hasQuery = Boolean(String(query || '').trim());
  const rows = await safe(
    db.query(
      `
        SELECT TOP 100
          ItemCode,
          ItemName
        FROM OITM
        WHERE (@hasQuery = 0
          OR ItemCode LIKE @query
          OR ItemName LIKE @query)
        ORDER BY UpdateDate DESC, ItemCode DESC
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        query: buildLike(query),
      }
    )
  );

  return rows.map((row) => ({
    code: row.ItemCode,
    name: row.ItemName || '',
  }));
};

const generateItemCode = async (prefix) => {
  const seriesCode = String(prefix || '').trim();
  const seriesRows = await safe(
    db.query(
      `
        SELECT TOP 1
          Series,
          SeriesName,
          InitialNum,
          NextNumber,
          BeginStr,
          EndStr,
          Indicator,
          Locked,
          IsManual
        FROM NNM1
        WHERE ObjectCode IN ('4', 'OITM')
          AND Series = @series
          AND ISNULL(Locked, 'N') <> 'Y'
      `,
      { series: Number(seriesCode) || 0 }
    )
  );

  if (seriesRows.length > 0) {
    const row = seriesRows[0];
    const isManual = String(row.IsManual || '').toUpperCase() === 'Y';
    const nextNumber = row.NextNumber ?? row.InitialNum ?? null;
    const number = nextNumber == null ? '' : String(nextNumber).padStart(6, '0');
    return {
      itemCode: isManual ? '' : `${row.BeginStr || ''}${number}${row.EndStr || ''}`,
      nextNumber,
      prefix: row.BeginStr || '',
      suffix: row.EndStr || '',
      series: String(row.Series),
      seriesName: row.SeriesName || `Series ${row.Series}`,
      isManual,
    };
  }

  const rows = await safe(
    db.query(
      `
        SELECT ItemCode
        FROM OITM
        WHERE ItemCode LIKE @prefix
      `,
      { prefix: `${prefix}-%` }
    )
  );

  const usedNumbers = new Set();
  rows.forEach((row) => {
    const parts = String(row.ItemCode || '').split('-');
    const candidate = Number(parts[parts.length - 1]);
    if (Number.isInteger(candidate)) {
      usedNumbers.add(candidate);
    }
  });

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }

  return { itemCode: String(nextNumber).padStart(6, '0') };
};

const getItemCodePrefixes = async () => {
  const rows = await safe(
    db.query(
      `
        SELECT
          Series,
          SeriesName,
          InitialNum,
          NextNumber,
          BeginStr,
          EndStr,
          Indicator,
          Locked,
          IsManual
        FROM NNM1
        WHERE ObjectCode IN ('4', 'OITM')
        ORDER BY CASE WHEN IsManual = 'Y' THEN 0 ELSE 1 END, Series
      `
    )
  );

  return rows.map((row) => {
    const isManual = String(row.IsManual || '').toUpperCase() === 'Y';
    return {
      code: isManual ? 'Manual' : String(row.Series),
      name: row.SeriesName || (isManual ? 'Manual' : `Series ${row.Series}`),
      prefix: row.BeginStr || '',
      suffix: row.EndStr || '',
      indicator: row.Indicator || '',
      nextNumber: row.NextNumber ?? row.InitialNum ?? null,
      locked: String(row.Locked || '').toUpperCase() === 'Y',
      isManual,
    };
  });
};

const checkItemCodeExists = async (itemCode) => {
  const rows = await safe(
    db.query(
      `
        SELECT TOP 1 ItemCode
        FROM OITM
        WHERE ItemCode = @itemCode
      `,
      { itemCode }
    )
  );

  return { exists: rows.length > 0 };
};

const getItemGroups = async (query = '') => {
  const hasQuery = Boolean(String(query || '').trim());
  const rows = await safe(
    db.query(
      `
        SELECT
          ItmsGrpCod,
          ItmsGrpNam
        FROM OITB
        WHERE ISNULL(Locked, 'N') <> 'Y'
          AND (@hasQuery = 0
            OR CAST(ItmsGrpCod AS NVARCHAR(50)) LIKE @query
            OR ItmsGrpNam LIKE @query)
        ORDER BY ItmsGrpNam
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        query: buildLike(query),
      }
    )
  );

  const mappedGroups = rows.map((row) => ({
    code: String(row.ItmsGrpCod),
    name: row.ItmsGrpNam || '',
  }));

  if (!hasQuery) {
    return [
      { code: '*', name: '*' },
      ...mappedGroups,
      { code: '', name: 'All' },
    ];
  }

  return mappedGroups;
};

const getManufacturers = async (query = '') => {
  const hasQuery = Boolean(String(query || '').trim());
  const rows = await safe(
    db.query(
      `
        SELECT
          FirmCode,
          FirmName
        FROM OMRC
        WHERE (@hasQuery = 0
          OR CAST(FirmCode AS NVARCHAR(50)) LIKE @query
          OR FirmName LIKE @query)
        ORDER BY FirmName
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        query: buildLike(query),
      }
    )
  );

  return rows.map((row) => ({
    code: String(row.FirmCode),
    name: row.FirmName || '',
  }));
};

const getHSNCodes = async (query = '') => {
  const rows = await hsnCodeDbService.getHSNCodes(query, 100, 0);
  return rows.map((row) => ({
    code: row.code || '',
    name: row.description || '',
    chapter: row.code || '',
    heading: row.heading || '',
    subheading: row.subHeading || '',
  }));
};

const getPriceLists = async (query = '') => {
  const hasQuery = Boolean(String(query || '').trim());
  const rows = await safe(
    db.query(
      `
        SELECT
          ListNum,
          ListName
        FROM OPLN
        WHERE (@hasQuery = 0
          OR CAST(ListNum AS NVARCHAR(50)) LIKE @query
          OR ListName LIKE @query)
        ORDER BY ListNum
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        query: buildLike(query),
      }
    )
  );

  return rows.map((row) => ({
    code: String(row.ListNum),
    name: row.ListName || '',
  }));
};

const getVendors = async (query = '') => {
  const hasQuery = Boolean(String(query || '').trim());
  const rows = await safe(
    db.query(
      `
        SELECT
          CardCode,
          CardName
        FROM OCRD
        WHERE CardType = 'S'
          AND ISNULL(validFor, 'Y') <> 'N'
          AND ISNULL(frozenFor, 'N') <> 'Y'
          AND (@hasQuery = 0
            OR CardCode LIKE @query
            OR CardName LIKE @query)
        ORDER BY CardCode
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        query: buildLike(query),
      }
    )
  );

  return rows.map((row) => ({
    code: row.CardCode,
    name: row.CardName || '',
  }));
};

const getWarehouses = async (query = '') => {
  const hasQuery = Boolean(String(query || '').trim());
  const rows = await safe(
    db.query(
      `
        SELECT
          WhsCode,
          WhsName,
          BPLid AS BranchId
        FROM OWHS
        WHERE ISNULL(Inactive, 'N') <> 'Y'
          AND (@hasQuery = 0
            OR WhsCode LIKE @query
            OR WhsName LIKE @query)
        ORDER BY WhsCode
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        query: buildLike(query),
      }
    )
  );

  return rows.map((row) => ({
    code: row.WhsCode,
    name: row.WhsName || '',
    branchId: row.BranchId != null ? String(row.BranchId) : '',
  }));
};

const getGLAccounts = async (query = '') => {
  const hasQuery = Boolean(String(query || '').trim());
  const rows = await safe(
    db.query(
      `
        SELECT
          AcctCode,
          AcctName
        FROM OACT
        WHERE Postable = 'Y'
          AND ISNULL(FrozenFor, 'N') <> 'Y'
          AND (@hasQuery = 0
            OR AcctCode LIKE @query
            OR AcctName LIKE @query)
        ORDER BY AcctCode
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        query: buildLike(query),
      }
    )
  );

  return rows.map((row) => ({
    code: row.AcctCode,
    name: row.AcctName || '',
  }));
};

const getUoMGroups = async (query = '') => {
  const hasQuery = Boolean(String(query || '').trim());
  const rows = await safe(
    db.query(
      `
        SELECT
          UgpEntry,
          UgpCode,
          UgpName
        FROM OUGP
        WHERE (UgpEntry = -1 OR ISNULL(Locked, 'N') <> 'Y')
          AND (@hasQuery = 0
            OR CAST(UgpEntry AS NVARCHAR(50)) LIKE @query
            OR UgpCode LIKE @query
            OR UgpName LIKE @query)
        ORDER BY UgpEntry
      `,
      {
        hasQuery: hasQuery ? 1 : 0,
        query: buildLike(query),
      }
    )
  );

  return rows.map((row) => ({
    code: String(row.UgpEntry),
    name: row.UgpName || row.UgpCode || '',
  }));
};

const getItemProperties = async () => {
  const rows = await safe(
    db.query(`
      SELECT
        ItmsTypCod,
        ItmsGrpNam
      FROM OITG
      ORDER BY ItmsTypCod
    `)
  );

  const nameMap = rows.reduce((acc, row) => {
    acc[Number(row.ItmsTypCod)] = row.ItmsGrpNam || `Property ${row.ItmsTypCod}`;
    return acc;
  }, {});

  return Array.from({ length: 64 }, (_, index) => ({
    number: index + 1,
    name: nameMap[index + 1] || `Property ${index + 1}`,
  }));
};

module.exports = {
  getItem,
  mapHeaderRow,
  searchItems,
  getRecentItemCodes,
  generateItemCode,
  getItemCodePrefixes,
  checkItemCodeExists,
  getItemPrices,
  getItemStock: getItemWarehouseInfoCollection,
  getItemGroups,
  getManufacturers,
  getHSNCodes,
  getPriceLists,
  getVendors,
  getWarehouses,
  getGLAccounts,
  getUoMGroups,
  getItemProperties,
};
