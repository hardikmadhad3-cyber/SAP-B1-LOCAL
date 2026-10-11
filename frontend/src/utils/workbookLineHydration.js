const firstValue = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value) !== '') return value;
  }
  return '';
};

const firstString = (...values) => {
  const value = firstValue(...values);
  return value === '' ? '' : String(value);
};

const firstUomEntry = (...values) => {
  const numericValue = Number(firstValue(...values));
  return Number.isInteger(numericValue) && numericValue !== 0 ? numericValue : null;
};

const normalizeToken = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^U_/, '')
    .replace(/[^A-Z0-9]+/g, '');

const pickUdfs = (source = {}) =>
  Object.entries(source || {}).reduce((acc, [key, value]) => {
    if (String(key).startsWith('U_')) acc[key] = value == null ? '' : value;
    return acc;
  }, {});

const normalizeUdfMap = (source = {}) =>
  Object.entries(source || {}).reduce((acc, [key, value]) => {
    if (key) acc[key] = value == null ? '' : value;
    return acc;
  }, {});

export const getWorkbookLineUdfs = (line = {}) => ({
  ...pickUdfs(line),
  ...normalizeUdfMap(line.line_udfs),
  ...normalizeUdfMap(line.lineUdfs),
  ...normalizeUdfMap(line.udf),
});

const mergeSapUdfExtras = (normalized = {}, source = {}) => {
  const merged = { ...(normalized || {}) };

  Object.entries(source || {}).forEach(([key, value]) => {
    if (String(key || '').startsWith('U_') && !Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = value == null ? '' : value;
    }
  });

  return merged;
};

const findUdfValue = (udfs = {}, aliases = []) => {
  const entries = Object.entries(udfs || {});
  for (const alias of aliases) {
    const aliasToken = normalizeToken(alias);
    const match = entries.find(([key]) => normalizeToken(key) === aliasToken);
    if (match && match[1] !== undefined && match[1] !== null && String(match[1]) !== '') {
      return match[1];
    }
  }
  return '';
};

const udfAlias = {
  packingType: ['U_PackingType', 'U_Packing_Type', 'Packing-Type', 'PackingType'],
  grossWt: ['U_GrossWt', 'U_Gross_Wt', 'GrossWt', 'GrossWeight'],
  totalPackage: ['U_TotalPackage', 'U_Total_Package', 'Total-Package', 'TotalPackage'],
  costSheet: ['U_CostSheet', 'U_Cost_Sheet', 'U_COSTSHEET', 'Cost-Sheet'],
  containerType: ['U_ContainerType', 'U_Container_Type', 'Container Type'],
  specialRebate: ['U_SPLRBT', 'Special Rebate'],
  commission: ['U_COMPRC', 'Commision', 'Commission'],
  sellerBrokeragePerQty: ['U_S_BROKPERQTY', 'BrokPerQty'],
  sellerBrokerage: ['U_BROK_SELLER', 'Seller Brokerage'],
  buyerBrokerage: ['U_BROK_BUYER', 'Buyer Brokerage'],
  buyerDelivery: ['U_BUYER_DELIVERY', 'Buyer - Delivery'],
  sellerDelivery: ['U_SELLER_DELIVERY', 'Seller - Delivery'],
  buyerPaymentTerms: ['U_BUYER_PAYMENT_TERMS', 'U_Buyer_Payment_Term', 'Buyer - Terms of payment'],
  sellerPaymentTerms: ['U_SELLER_PAYMENT_TERM', 'U_SELLER_PAYMENT_TERMS', 'U_Seller_Payment_Ter', 'Seller - Terms of Payment'],
  buyerQuality: ['U_BUYER_QUALITY', 'Buyer - Quality'],
  sellerQuality: ['U_SELLER_QUALITY', 'Seller - Quality'],
  buyerPrice: ['U_BUYER_PRICE', 'Buyer - Price'],
  sellerPrice: ['U_SELLER_PRICE', 'Seller - Price'],
  buyerSpecialInstruction: ['U_BUYER_SPINS', 'Buyer - Special Instruction'],
  sellerSpecialInstruction: ['U_SELLER_SPINS', 'Seller - Special Instruction'],
  sellerBrokerageAmtPer: ['U_SEL_BROK_AP', 'Seller Brokerage(Amt./Per)'],
  sellerBrokeragePercent: ['U_SELLER_BROK_PER', 'Seller Brokerage in Percentage'],
  stcode: ['U_SELLTCODE', 'U_STCODE', 'STCODE'],
  sellerItem: ['U_S_ITEM', 'U_SItem', 'S_Item'],
  sellerQty: ['U_S_QTY', 'S_Qty'],
  taxCodeRepeat: ['U_TAXCODE', 'U_TaxCode'],
  price: ['U_PRICE', 'U_Price'],
  forRate: ['U_ForRate', 'U_FORRATE', 'U_FOR_RATE', 'U_For_Rate', 'U_FORRate', 'FOR Rate', 'FORRATE', 'Rate'],
  fixBrokBuyer: ['U_Fix_Brock_B', 'U_Fix_Brok_B', 'U_FIX_BROK_BUYER', 'U_FIXBROKBUYER', 'FIX Brok BUYER'],
  fixBrockSeller: ['U_Fix_Brock_S', 'U_Fix_Brok_S', 'U_Fix_Brock_Seller', 'U_FIXBROCKSELLER', 'U_FIXBROKSELLER', 'Fix Brock Seller'],
};

const canonicalUdfFields = [
  { canonical: ['U_PackingType', 'U_PACKINGTYPE'], aliases: udfAlias.packingType, lineAliases: ['packingType', 'PackingType', 'U_PackingType', 'U_PACKINGTYPE', 'U_Packing_Type'] },
  { canonical: ['U_GrossWt', 'U_GROSSWT'], aliases: udfAlias.grossWt, lineAliases: ['grossWt', 'GrossWt', 'GrossWeight', 'U_GrossWt', 'U_Gross_Wt'] },
  { canonical: ['U_TotalPackage', 'U_TOTALPACKAGE'], aliases: udfAlias.totalPackage, lineAliases: ['totalPackage', 'TotalPackage', 'U_TotalPackage', 'U_Total_Package'] },
  { canonical: ['U_CostSheet', 'U_Cost_Sheet', 'U_COSTSHEET', 'U_COST_SHEET'], aliases: udfAlias.costSheet, lineAliases: ['costSheet', 'U_CostSheet', 'U_Cost_Sheet'] },
  { canonical: ['U_ContainerType', 'U_CONTAINERTYPE'], aliases: udfAlias.containerType, lineAliases: ['containerType', 'U_ContainerType'] },
  { canonical: ['U_SPLRBT'], aliases: udfAlias.specialRebate, lineAliases: ['specialRebate', 'SpecialRebate'] },
  { canonical: ['U_COMPRC'], aliases: udfAlias.commission, lineAliases: ['commission', 'Commission'] },
  { canonical: ['U_S_BrokPerQty', 'U_S_BROKPERQTY'], aliases: udfAlias.sellerBrokeragePerQty, lineAliases: ['sellerBrokeragePerQty', 'SellerBrokeragePerQty'] },
  { canonical: ['U_Brok_Seller', 'U_BROK_SELLER'], aliases: udfAlias.sellerBrokerage, lineAliases: ['sellerBrokerage', 'SellerBrokerage'] },
  { canonical: ['U_Brok_Buyer', 'U_BROK_BUYER'], aliases: udfAlias.buyerBrokerage, lineAliases: ['buyerBrokerage', 'BuyerBrokerage'] },
  { canonical: ['U_Buyer_Delivery', 'U_BUYER_DELIVERY'], aliases: udfAlias.buyerDelivery, lineAliases: ['buyerDelivery', 'BuyerDelivery'] },
  { canonical: ['U_Seller_Delivery', 'U_SELLER_DELIVERY'], aliases: udfAlias.sellerDelivery, lineAliases: ['sellerDelivery', 'SellerDelivery'] },
  { canonical: ['U_Buyer_Payment_Terms', 'U_BUYER_PAYMENT_TERMS'], aliases: udfAlias.buyerPaymentTerms, lineAliases: ['buyerPaymentTerms', 'BuyerPaymentTerms'] },
  { canonical: ['U_Seller_Payment_Term', 'U_Seller_Payment_Terms', 'U_SELLER_PAYMENT_TERM', 'U_SELLER_PAYMENT_TERMS'], aliases: udfAlias.sellerPaymentTerms, lineAliases: ['sellerPaymentTerms', 'SellerPaymentTerms', 'SellerPaymentTerm'] },
  { canonical: ['U_Buyer_Quality', 'U_BUYER_QUALITY'], aliases: udfAlias.buyerQuality, lineAliases: ['buyerQuality', 'BuyerQuality'] },
  { canonical: ['U_Seller_Quality', 'U_SELLER_QUALITY'], aliases: udfAlias.sellerQuality, lineAliases: ['sellerQuality', 'SellerQuality'] },
  { canonical: ['U_Buyer_Price', 'U_BUYER_PRICE'], aliases: udfAlias.buyerPrice, lineAliases: ['buyerPrice', 'BuyerPrice'] },
  { canonical: ['U_Seller_Price', 'U_SELLER_PRICE'], aliases: udfAlias.sellerPrice, lineAliases: ['sellerPrice', 'SellerPrice'] },
  { canonical: ['U_Buyer_SPINS', 'U_BUYER_SPINS'], aliases: udfAlias.buyerSpecialInstruction, lineAliases: ['buyerSpecialInstruction', 'BuyerSpecialInstruction'] },
  { canonical: ['U_Seller_SPINS', 'U_SELLER_SPINS'], aliases: udfAlias.sellerSpecialInstruction, lineAliases: ['sellerSpecialInstruction', 'SellerSpecialInstruction'] },
  { canonical: ['U_Sel_Brok_AP', 'U_SEL_BROK_AP'], aliases: udfAlias.sellerBrokerageAmtPer, lineAliases: ['sellerBrokerageAmtPer', 'SellerBrokerageAmtPer'] },
  { canonical: ['U_Seller_Brok_Per', 'U_SELLER_BROK_PER'], aliases: udfAlias.sellerBrokeragePercent, lineAliases: ['sellerBrokeragePercent', 'SellerBrokeragePercent'] },
  { canonical: ['U_SELLTCODE', 'U_STCODE'], aliases: udfAlias.stcode, lineAliases: ['stcode', 'STCODE', 'STCode', 'STACode'] },
  { canonical: ['U_S_Item', 'U_S_ITEM', 'U_SItem'], aliases: udfAlias.sellerItem, lineAliases: ['sellerItem', 'SellerItem'] },
  { canonical: ['U_S_Qty', 'U_S_QTY'], aliases: udfAlias.sellerQty, lineAliases: ['sellerQty', 'SellerQty'] },
  { canonical: ['U_TAXCODE', 'U_TaxCode'], aliases: udfAlias.taxCodeRepeat, lineAliases: ['taxCodeRepeat', 'TaxCodeRepeat', 'U_TAXCODE', 'U_TaxCode'] },
  { canonical: ['U_PRICE', 'U_Price'], aliases: udfAlias.price, lineAliases: ['U_PRICE', 'U_Price'] },
  { canonical: ['U_ForRate', 'U_FORRATE'], aliases: udfAlias.forRate, lineAliases: ['forRate', 'ForRate', 'FORRate', 'U_ForRate', 'U_FORRATE', 'U_FOR_RATE'] },
  { canonical: ['U_Fix_Brock_B', 'U_Fix_Brok_B', 'U_FIX_BROK_BUYER'], aliases: udfAlias.fixBrokBuyer, lineAliases: ['U_Fix_Brock_B', 'fixBrokBuyer'] },
  { canonical: ['U_Fix_Brock_S', 'U_Fix_Brok_S', 'U_Fix_Brock_Seller'], aliases: udfAlias.fixBrockSeller, lineAliases: ['U_Fix_Brock_S', 'fixBrockSeller'] },
];

const valueFromLineOrUdf = (line, udfs, key, aliases, ...lineAliases) =>
  firstString(
    line?.[key],
    ...lineAliases.map((alias) => line?.[alias]),
    findUdfValue(udfs, aliases)
  );

export const normalizeLineUdfAliases = (values = {}, line = {}) => {
  const next = { ...(values || {}) };

  canonicalUdfFields.forEach(({ canonical, aliases, lineAliases = [] }) => {
    const resolved = firstString(
      ...lineAliases.map((alias) => line?.[alias]),
      findUdfValue(next, [...canonical, ...aliases])
    );
    if (!resolved) return;

    canonical.forEach((key) => {
      next[key] = next[key] || resolved;
    });
  });

  return next;
};

export const hydrateWorkbookDocumentLine = ({
  line,
  createLine,
  rowUdfDefinitions = [],
  normalizeUdfState,
  items = [],
  fallbackWarehouse = '',
  fallbackBranch = '',
}) => {
  const source = line || {};
  const udfs = getWorkbookLineUdfs(source);
  const itemCode = firstString(source.itemNo, source.ItemCode, source.itemCode);
  const item = (items || []).find((candidate) => String(candidate?.ItemCode || '').trim() === itemCode) || {};
  const normalizeUdfs = typeof normalizeUdfState === 'function'
    ? normalizeUdfState
    : (_definitions, values) => values || {};
  const normalizedUdfs = normalizeLineUdfAliases(
    mergeSapUdfExtras(normalizeUdfs(rowUdfDefinitions, udfs), udfs),
    source
  );
  const baseLine = typeof createLine === 'function' ? createLine(rowUdfDefinitions) : {};
  const quantity = firstString(source.quantity, source.Quantity, source.OpenQty);
  const unitPrice = firstString(source.unitPrice, source.UnitPrice, source.Price);
  const taxCode = firstString(
    source.taxCode,
    source.TaxCode,
    source.VatGroup,
    source.VatGroupCode,
    source.SavedTaxCode
  );
  const taxCodeManuallyOverridden = firstValue(
    source.taxCodeManuallyOverridden,
    source.TaxCodeManuallyOverridden,
    Boolean(taxCode)
  );
  const packingTypeValue = valueFromLineOrUdf(
    source,
    udfs,
    'packingType',
    udfAlias.packingType,
    'PackingType',
    'U_PackingType',
    'U_PACKINGTYPE',
    'U_Packing_Type'
  );
  if (packingTypeValue) {
    normalizedUdfs.U_PackingType = packingTypeValue;
    normalizedUdfs.U_PACKINGTYPE = normalizedUdfs.U_PACKINGTYPE || packingTypeValue;
  }

  return {
    ...baseLine,
    ...source,
    itemNo: itemCode,
    itemDescription: firstString(source.itemDescription, source.ItemDescription, source.Dscription, source.description, source.itemName, item.ItemName),
    quantity,
    openQty: firstString(source.openQty, source.OpenQuantity, source.OpenQty, quantity),
    requiredQty: firstString(source.requiredQty, source.RequiredQty, source.RequiredQuantity),
    requiredDate: firstString(source.requiredDate, source.RequiredDate, source.ReqDate),
    noOfPackages: firstString(
      source.noOfPackages,
      source.NoOfPackages,
      source.packageQuantity,
      source.PackageQuantity,
      source.PackQty,
      source.Packages,
      source.NumOfPacks
    ),
    quotedDate: firstString(source.quotedDate, source.QuotedDate, source.ShipDate),
    unitPrice,
    price: firstString(source.price, source.U_PRICE, source.U_Price, findUdfValue(normalizedUdfs, udfAlias.price)),
    forRate: valueFromLineOrUdf(source, udfs, 'forRate', udfAlias.forRate, 'ForRate', 'FORRate', 'LineRate', 'Rate', 'U_ForRate', 'U_FORRATE', 'U_FOR_RATE'),
    unitPriceUdf: firstString(source.unitPriceUdf, source.UnitPriceUdf, findUdfValue(udfs, ['U_Unit_Price'])),
    stdDiscount: firstString(source.stdDiscount, source.DiscountPercent, source.DiscPrcnt),
    taxCode,
    taxCodeRepeat: firstString(source.taxCodeRepeat, source.TaxCodeRepeat, source.U_TAXCODE, source.U_TaxCode, findUdfValue(normalizedUdfs, udfAlias.taxCodeRepeat)),
    taxCodeManuallyOverridden: Boolean(taxCodeManuallyOverridden),
    wTaxLiable: firstString(source.wTaxLiable, source.wtaxLiable, source.WTLiable, 'N'),
    taxLiable: firstString(source.taxLiable, source.TaxLiable, source.TaxOnly, 'N'),
    total: firstString(source.total, source.LineTotal, source.TotalLC, source.Total),
    totalLC: firstString(source.totalLC, source.total, source.LineTotal, source.TotalLC, source.Total),
    grossTotal: firstString(source.grossTotal, source.GrossTotal, source.GTotal, source.TotalDoc),
    whse: firstString(source.whse, source.Warehouse, source.WarehouseCode, source.WhsCode, fallbackWarehouse),
    glAccount: firstString(source.glAccount, source.GLAccount, source.AccountCode, source.AcctCode),
    distRule: firstString(source.distRule, source.DistributionRule, source.OcrCode),
    cogsDistRule: firstString(
      source.cogsDistRule,
      source.COGSDistributionRule,
      source.COGSCostingCode,
      source.CogsOcrCod,
      source.CogsOcrCode
    ),
    // UoMEntry is SAP's numeric internal key, not the user-facing UoM code.
    uomEntry: firstUomEntry(source.uomEntry, source.UoMEntry, source.UomEntry),
    uomCode: firstString(source.uomCode, source.UoMCode, source.UomCode, source.UOMCode),
    uomName: firstString(
      source.uomName,
      source.UoMName,
      source.UomName,
      source.UnitMsr,
      source.unitMsr,
      source.MeasureUnit,
      source.UnitOfMeasureName,
      source.uomCode,
      source.UoMCode,
      item.SalesUnit,
      item.InventoryUOM
    ),
    inStock: firstString(
      source.inStock,
      source.InStock,
      source.QuantityOnStock,
      source.OnHandQty,
      source.OnHand,
      item.InStock,
      item.QuantityOnStock,
      item.OnHand
    ),
    qtyInWhse: firstString(
      source.qtyInWhse,
      source.QtyInWhse,
      source.QtyInWarehouse,
      source.QuantityInWarehouse,
      source.WarehouseQuantity,
      source.WarehouseStock,
      source.WhsQty
    ),
    countryOfOrigin: firstString(source.countryOfOrigin, source.CountryOfOrigin, source.CountryOrg),
    loc: firstString(source.loc, source.Loc, source.LocCode, source.LocationCode, source.Location),
    branch: firstString(source.branch, source.Branch, source.BranchCode, fallbackBranch),
    hsnCode: firstString(source.hsnCode, source.HSNCode, source.HsnCode, item.HSNCode, item.SWW, item.U_HSNCode),
    sacCode: firstString(source.sacCode, source.SACCode, source.SacCode),
    taxAmount: firstString(source.taxAmount, source.TaxAmount, source.LineTaxAmount, source.VatSum),
    weight: firstString(source.weight, source.Weight, source.Weight1),
    binLocationAllocation: firstString(source.binLocationAllocation, source.BinLocationAllocation),
    priceAfterDiscount: firstString(source.priceAfterDiscount, source.PriceAfterDiscount),
    itemsPerUnit: firstString(source.itemsPerUnit, source.ItemsPerUnit, source.NumPerMsr),
    itemCost: firstString(source.itemCost, source.ItemCost, item.ItemCost, item.AvgPrice),
    commPercent: firstString(source.commPercent, source.CommissionPercent, source.CommPercent),
    assessableValue: firstString(source.assessableValue, source.AssessableValue),
    blanketAgreementNo: firstString(source.blanketAgreementNo, source.BlanketAgreementNo, source.AgrNo),
    enableSettingCost: firstString(source.enableSettingCost, source.EnableSettingCost, source.EnSetCost, 'N'),
    withoutQtyPosting: firstString(source.withoutQtyPosting, source.WithoutQtyPosting, source.WithoutInventoryMovement, 'N'),
    returnCost: firstString(source.returnCost, source.ReturnCost, source.RetCost),
    deliveredQty: firstString(source.deliveredQty, source.DeliveredQty, source.DelivrdQty),
    lineDeliveryDate: firstString(source.lineDeliveryDate, source.DeliveryDate, source.ShipDate, source.DelDate),
    documentCreated: firstString(source.documentCreated, source.DocumentCreated),
    packingType: packingTypeValue,
    grossWt: valueFromLineOrUdf(source, udfs, 'grossWt', udfAlias.grossWt, 'GrossWt', 'GrossWeight', 'U_GrossWt', 'U_Gross_Wt'),
    totalPackage: valueFromLineOrUdf(source, udfs, 'totalPackage', udfAlias.totalPackage, 'TotalPackage', 'U_TotalPackage', 'U_Total_Package'),
    costSheet: valueFromLineOrUdf(source, udfs, 'costSheet', udfAlias.costSheet),
    containerType: valueFromLineOrUdf(source, udfs, 'containerType', udfAlias.containerType),
    specialRebate: valueFromLineOrUdf(source, udfs, 'specialRebate', udfAlias.specialRebate, 'SpecialRebate'),
    commission: valueFromLineOrUdf(source, udfs, 'commission', udfAlias.commission, 'Commission'),
    sellerBrokeragePerQty: valueFromLineOrUdf(source, udfs, 'sellerBrokeragePerQty', udfAlias.sellerBrokeragePerQty, 'SellerBrokeragePerQty'),
    sellerBrokerage: valueFromLineOrUdf(source, udfs, 'sellerBrokerage', udfAlias.sellerBrokerage, 'SellerBrokerage'),
    buyerBrokerage: valueFromLineOrUdf(source, udfs, 'buyerBrokerage', udfAlias.buyerBrokerage, 'BuyerBrokerage'),
    buyerDelivery: valueFromLineOrUdf(source, udfs, 'buyerDelivery', udfAlias.buyerDelivery, 'BuyerDelivery'),
    sellerDelivery: valueFromLineOrUdf(source, udfs, 'sellerDelivery', udfAlias.sellerDelivery, 'SellerDelivery'),
    buyerPaymentTerms: valueFromLineOrUdf(source, udfs, 'buyerPaymentTerms', udfAlias.buyerPaymentTerms, 'BuyerPaymentTerms'),
    sellerPaymentTerms: valueFromLineOrUdf(source, udfs, 'sellerPaymentTerms', udfAlias.sellerPaymentTerms, 'SellerPaymentTerms', 'SellerPaymentTerm'),
    sellerPaymentTermsRepeat: valueFromLineOrUdf(source, udfs, 'sellerPaymentTermsRepeat', udfAlias.sellerPaymentTerms, 'SellerPaymentTermsRepeat', 'SellerTermsOfPaymentRepeat'),
    buyerQuality: valueFromLineOrUdf(source, udfs, 'buyerQuality', udfAlias.buyerQuality, 'BuyerQuality'),
    sellerQuality: valueFromLineOrUdf(source, udfs, 'sellerQuality', udfAlias.sellerQuality, 'SellerQuality'),
    buyerPrice: valueFromLineOrUdf(source, udfs, 'buyerPrice', udfAlias.buyerPrice, 'BuyerPrice'),
    sellerPrice: valueFromLineOrUdf(source, udfs, 'sellerPrice', udfAlias.sellerPrice, 'SellerPrice'),
    buyerSpecialInstruction: valueFromLineOrUdf(source, udfs, 'buyerSpecialInstruction', udfAlias.buyerSpecialInstruction, 'BuyerSpecialInstruction'),
    sellerSpecialInstruction: valueFromLineOrUdf(source, udfs, 'sellerSpecialInstruction', udfAlias.sellerSpecialInstruction, 'SellerSpecialInstruction'),
    sellerBrokerageAmtPer: valueFromLineOrUdf(source, udfs, 'sellerBrokerageAmtPer', udfAlias.sellerBrokerageAmtPer, 'SellerBrokerageAmtPer'),
    sellerBrokeragePercent: valueFromLineOrUdf(source, udfs, 'sellerBrokeragePercent', udfAlias.sellerBrokeragePercent, 'SellerBrokeragePercent'),
    stcode: valueFromLineOrUdf(source, udfs, 'stcode', udfAlias.stcode, 'STCODE', 'STCode', 'STACode'),
    sellerItem: valueFromLineOrUdf(source, udfs, 'sellerItem', udfAlias.sellerItem, 'SellerItem'),
    sellerQty: valueFromLineOrUdf(source, udfs, 'sellerQty', udfAlias.sellerQty, 'SellerQty'),
    fixBrokBuyer: valueFromLineOrUdf(source, udfs, 'fixBrokBuyer', udfAlias.fixBrokBuyer),
    fixBrockSeller: valueFromLineOrUdf(source, udfs, 'fixBrockSeller', udfAlias.fixBrockSeller),
    U_PackingType: firstString(source.U_PackingType, source.U_PACKINGTYPE, source.U_Packing_Type, source.PackingType, findUdfValue(udfs, udfAlias.packingType)),
    U_GrossWt: firstString(source.U_GrossWt, source.U_Gross_Wt, source.GrossWt, source.GrossWeight, findUdfValue(udfs, udfAlias.grossWt)),
    U_TotalPackage: firstString(source.U_TotalPackage, source.U_Total_Package, source.TotalPackage, findUdfValue(udfs, udfAlias.totalPackage)),
    U_Cost_Sheet: firstString(source.U_Cost_Sheet, source.U_CostSheet, findUdfValue(udfs, udfAlias.costSheet)),
    U_ContainerType: firstString(source.U_ContainerType, findUdfValue(udfs, udfAlias.containerType)),
    U_ForRate: firstString(source.U_ForRate, source.U_FORRATE, source.U_FOR_RATE, source.forRate, source.ForRate, findUdfValue(udfs, udfAlias.forRate)),
    U_Fix_Brock_B: firstString(source.U_Fix_Brock_B, source.U_FIX_BROK_BUYER, findUdfValue(udfs, udfAlias.fixBrokBuyer)),
    U_Fix_Brock_S: firstString(source.U_Fix_Brock_S, source.U_Fix_Brock_Seller, findUdfValue(udfs, udfAlias.fixBrockSeller)),
    lineNum: source.lineNum ?? source.LineNum,
    baseEntry: source.baseEntry ?? source.BaseEntry ?? null,
    baseType: source.baseType ?? source.BaseType ?? null,
    baseLine: source.baseLine ?? source.BaseLine ?? null,
    udf: normalizedUdfs,
  };
};
