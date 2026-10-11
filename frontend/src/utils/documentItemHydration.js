import { getItemDefaultUom } from './documentUom';

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

export const mergeItemMaster = (selectedItem = {}, items = []) => {
  const itemCode = selectedItem.ItemCode || selectedItem.itemCode || '';
  const masterItem = (items || []).find(
    (candidate) => String(candidate.ItemCode || candidate.itemCode || '') === String(itemCode)
  ) || {};

  return { ...masterItem, ...selectedItem };
};

export const getItemPrice = (item = {}, side = 'sales') => {
  const values = side === 'purchase'
    ? [item.UnitPrice, item.Price, item.LastPurPrc, item.LastPurchasePrice, item.MovingAveragePrice, item.AvgStdPrice]
    : [item.UnitPrice, item.Price, item.SalesPrice, item.MovingAveragePrice, item.AvgStdPrice];

  const value = values.find(hasValue);
  return hasValue(value) ? String(value) : '';
};

const firstItemValue = (item = {}, keys = []) => {
  const value = keys.map((key) => item[key]).find(hasValue);
  return hasValue(value) ? String(value) : '';
};

export const getItemPurchaseUom = (item = {}, uomGroups = []) => {
  if (uomGroups.length) return getItemDefaultUom(item, uomGroups, 'purchase');
  const rawEntry = item.PurchaseUomEntry ?? item.PUoMEntry;
  const numericEntry = Number(rawEntry);
  const rawGroupEntry = item.UoMGroupEntry ?? item.UgpEntry;
  const numericGroupEntry = Number(rawGroupEntry);
  const uomCode = firstItemValue(item, [
    'PurchaseUomCode', 'PurchaseUoMCode', 'UomCode', 'PurchaseUnit', 'InventoryUOM',
  ]);
  const uomName = firstItemValue(item, [
    'PurchaseUomName', 'PurchaseUoMName', 'PurchaseUnit', 'UomName',
  ]) || uomCode;
  const explicitUomEntry = Number.isInteger(numericEntry) && numericEntry !== 0 ? numericEntry : null;
  const isManualGroup = Number.isInteger(numericGroupEntry) && numericGroupEntry <= 0;
  const uomEntry = explicitUomEntry ?? (isManualGroup && (uomName || uomCode) ? -1 : null);
  return {
    uomEntry,
    uomCode,
    uomName,
    uomNameEdited: false,
    uomGroupEntry: rawGroupEntry ?? null,
  };
};

export const hydrateDocumentLineFromItem = (line = {}, item = {}, {
  side = 'sales',
  hsnCode = '',
  fallbackWarehouse = '',
  resolveLineLocation,
  headerBranch = '',
  preservePrice = false,
  preserveQuantity = true,
  syncUnitPriceUdf = false,
  calcLineTotal,
  formatTotal,
  uomGroups = [],
} = {}) => {
  const itemCode = item.ItemCode || item.itemCode || '';
  const selectedUom = getItemDefaultUom(item, uomGroups, side);
  const uomCode = selectedUom.uomCode || (side === 'purchase'
    ? getItemPurchaseUom(item).uomCode
    : String(item.SalesUnit || item.InventoryUOM || '').trim());
  const defaultWarehouse =
    item.DefaultWarehouse ||
    item.defaultWarehouse ||
    item.DfltWH ||
    item.dfltWH ||
    item.DfltWh ||
    item.Warehouse ||
    item.warehouse ||
    item.WarehouseCode ||
    item.warehouseCode ||
    item.WhsCode ||
    item.whsCode ||
    item.Whse ||
    item.whse ||
    fallbackWarehouse ||
    '';
  const itemPrice = getItemPrice(item, side);
  const salesGlAccount = firstItemValue(item, [
    'SalesGLAccount',
    'IncomeAccount',
    'IncomeAcct',
    'RevenuesAccount',
    'RevenueAccount',
    'RevenuesAc',
    'AccountCode',
    'AcctCode',
  ]);
  const distributionRule = firstItemValue(item, ['DistributionRule', 'OcrCode']);
  const cogsDistributionRule = firstItemValue(item, [
    'COGSDistributionRule',
    'COGSCostingCode',
    'CogsOcrCod',
    'CogsOcrCode',
    'CogsOcrCode1',
    'DistributionRule',
    'OcrCode',
  ]);
  const itemInStock = firstItemValue(item, [
    'InStock',
    'QuantityOnStock',
    'OnHandQty',
    'OnHand',
  ]);
  const itemWarehouseQuantity = firstItemValue(item, [
    'QtyInWhse',
    'QtyInWarehouse',
    'QuantityInWarehouse',
    'WarehouseQuantity',
    'WarehouseStock',
    'WhsQty',
  ]);

  const next = {
    ...line,
    itemNo: itemCode,
    itemDescription: item.ItemName || item.itemName || line.itemDescription || '',
    hsnCode: hsnCode || item.HSNCode || item.SWW || item.U_HSNCode || line.hsnCode || '',
    uomCode: uomCode || line.uomCode || '',
    uomName: selectedUom.uomName || line.uomName || uomCode || line.uomCode || '',
    countryOfOrigin: item.ItemCountryOrg || item.CountryOrg || line.countryOfOrigin || '',
    sacCode: item.SACEntry != null ? String(item.SACEntry) : (line.sacCode || ''),
    glAccount: line.glAccount || salesGlAccount || '',
    distRule: line.distRule || distributionRule || '',
    cogsDistRule: line.cogsDistRule || cogsDistributionRule || line.distRule || distributionRule || '',
    inStock: hasValue(line.inStock) ? line.inStock : itemInStock,
    qtyInWhse: hasValue(line.qtyInWhse) ? line.qtyInWhse : itemWarehouseQuantity,
    whse: line.whse || defaultWarehouse,
    inventoryUOM: item.InventoryUOM || line.inventoryUOM || '',
    batchManaged: item.BatchManaged === 'Y' || item.ManageBatchNumbers === 'tYES' || item.ManBtchNum === 'Y' || line.batchManaged || false,
  };

  if (uomGroups.length) Object.assign(next, selectedUom);
  else if (side === 'purchase') Object.assign(next, getItemPurchaseUom(item));

  // Some SAP B1 layouts expose a company row UDF named "Unit" (U_UoM)
  // alongside the standard UoM fields. Its item default is the selected
  // item's sales or purchase UoM name, not the internal UoM code.
  const unitUdfKey = Object.keys(line.udf || {}).find(
    (key) => String(key).replace(/[^a-z0-9]/gi, '').toUpperCase() === 'UUOM'
  );
  const unitName = String(next.uomName || '').trim();
  if (unitUdfKey && unitName) {
    next.udf = { ...line.udf, [unitUdfKey]: unitName };
  }

  if (side === 'sales') {
    next.stcode = line.stcode || '';
  } else if (!line.taxCodeManuallyOverridden) {
    next.taxCode = line.taxCode || item.TaxCodeAP || item.VatGroupPu || item.ApTaxCode || '';
  }

  if (!preservePrice || !hasValue(next.unitPrice)) {
    if (hasValue(itemPrice)) {
      next.unitPrice = itemPrice;
      if (syncUnitPriceUdf) {
        next.unitPriceUdf = line.unitPriceUdf || itemPrice;
      }
    }
  }

  if (preserveQuantity && !hasValue(next.quantity)) {
    next.quantity = '1';
  }

  if (resolveLineLocation) {
    next.loc = resolveLineLocation(next.whse, next.branch || headerBranch);
  }

  if (calcLineTotal && formatTotal) {
    next.total = formatTotal(calcLineTotal(next));
  }

  return next;
};
