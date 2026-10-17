const sapService = require('./sapService');
const itemDbService = require('./itemDbService');
const { cleanupItemCreatePayload } = require('./itemPayloadCleanup');

const extractSapError = (error, fallback) =>
  error.response?.data?.error?.message?.value ||
  error.response?.data?.error?.message ||
  error.response?.data?.detail ||
  error.response?.data ||
  error.message ||
  error.code ||
  fallback;

const UNSET_REFERENCE_FIELDS = [
  'WarrantyTemplate',
  'Manufacturer',
  'CustomsGroupCode',
  'ServiceCategoryEntry',
  'InventoryUoMEntry',
  'DefaultSalesUoMEntry',
  'DefaultPurchasingUoMEntry',
  'DefaultCountingUoMEntry',
];

const TREE_TYPE_MAP = {
  N: 'iNotATree',
  A: 'iAssemblyTree',
  P: 'iProductionTree',
  S: 'iSalesTree',
  T: 'iTemplateTree',
};

const getDuplicateSourceItemCode = (payload = {}) =>
  String(
    payload._duplicateFromItemCode
      || payload.duplicateFromItemCode
      || payload.DuplicateFromItemCode
      || ''
  ).trim();

const getServiceLayerItem = async (itemCode) => {
  const response = await sapService.request({
    method: 'GET',
    url: sapService.buildStringKeyPath('Items', itemCode),
  });
  return response.data || {};
};

const sanitizeSapPayload = (payload) => {
  const sanitized = cleanupItemCreatePayload(payload || {});

  UNSET_REFERENCE_FIELDS.forEach((field) => {
    if (sanitized[field] === '' || sanitized[field] == null || Number(sanitized[field]) === -1) {
      delete sanitized[field];
    }
  });

  if (TREE_TYPE_MAP[sanitized.TreeType]) {
    sanitized.TreeType = TREE_TYPE_MAP[sanitized.TreeType];
  }

  if (Array.isArray(sanitized.ItemPreferredVendors)) {
    sanitized.ItemPreferredVendors = sanitized.ItemPreferredVendors
      .map((vendor) => vendor?.BPCode || vendor?.VendorCode)
      .filter(Boolean)
      .map((BPCode) => ({ BPCode }));
    if (sanitized.ItemPreferredVendors.length === 0) {
      delete sanitized.ItemPreferredVendors;
    }
  }

  return sanitized;
};

const buildDuplicateCreatePayload = (sourceItem, requestedChanges = {}) => {
  const itemCode = String(requestedChanges.ItemCode || '').trim();
  const requestedItemName = String(requestedChanges.ItemName ?? '').trim();
  const itemName = requestedItemName || String(sourceItem.ItemName ?? '').trim();

  if (!itemCode) {
    throw new Error('ItemCode is required.');
  }
  if (!itemName) {
    throw new Error('ItemName is required.');
  }

  const payload = sanitizeSapPayload(sourceItem);
  payload.ItemCode = itemCode;
  payload.ItemName = itemName;

  if (requestedChanges.Series !== '' && requestedChanges.Series != null) {
    const numericSeries = Number(requestedChanges.Series);
    payload.Series = Number.isFinite(numericSeries) ? numericSeries : requestedChanges.Series;
  }

  return payload;
};

const sanitizeDuplicateCreatePayload = async (sourceItemCode, requestedChanges = {}) => {
  const sourceItem = await getServiceLayerItem(sourceItemCode);
  return buildDuplicateCreatePayload(sourceItem, requestedChanges);
};

const sanitizeCreatePayload = async (payload) => {
  const sanitized = sanitizeSapPayload(payload);

  if (Array.isArray(payload.ItemWarehouseInfoCollection) || payload.DefaultWarehouse) {
    const activeWarehouseCodes = new Set(
      (await itemDbService.getWarehouses()).map((warehouse) => warehouse.code)
    );

    if (Array.isArray(sanitized.ItemWarehouseInfoCollection)) {
      sanitized.ItemWarehouseInfoCollection = sanitized.ItemWarehouseInfoCollection.filter(
        (warehouse) => activeWarehouseCodes.has(warehouse.WarehouseCode)
      );
      if (sanitized.ItemWarehouseInfoCollection.length === 0) {
        delete sanitized.ItemWarehouseInfoCollection;
      }
    }

    if (payload.DefaultWarehouse && !activeWarehouseCodes.has(payload.DefaultWarehouse)) {
      delete sanitized.DefaultWarehouse;
    }
  }

  if (sanitized.Mainsupplier || Array.isArray(sanitized.ItemPreferredVendors)) {
    const activeVendorCodes = new Set(
      (await itemDbService.getVendors()).map((vendor) => vendor.code)
    );

    if (sanitized.Mainsupplier && !activeVendorCodes.has(sanitized.Mainsupplier)) {
      delete sanitized.Mainsupplier;
    }

    if (Array.isArray(sanitized.ItemPreferredVendors)) {
      sanitized.ItemPreferredVendors = sanitized.ItemPreferredVendors.filter(
        (vendor) => activeVendorCodes.has(vendor.BPCode)
      );
      if (sanitized.ItemPreferredVendors.length === 0) {
        delete sanitized.ItemPreferredVendors;
      }
    }
  }

  return sanitized;
};

const normalizeSapDate = (value) => {
  if (!value) return '';
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : value;
};

const getItem = async (itemCode) => {
  const [dbItem, sapItem] = await Promise.all([
    itemDbService.getItem(itemCode),
    getServiceLayerItem(itemCode),
  ]);

  const manageItemBy = sapItem.ManageSerialNumbers === 'tYES'
    ? 'Serial'
    : sapItem.ManageBatchNumbers === 'tYES'
      ? 'Batch'
      : 'None';

  return {
    ...dbItem,
    ...sapItem,
    ValidFrom: normalizeSapDate(sapItem.ValidFrom ?? dbItem.ValidFrom),
    ValidTo: normalizeSapDate(sapItem.ValidTo ?? dbItem.ValidTo),
    FrozenFrom: normalizeSapDate(sapItem.FrozenFrom ?? dbItem.FrozenFrom),
    FrozenTo: normalizeSapDate(sapItem.FrozenTo ?? dbItem.FrozenTo),
    CapitalizationDate: normalizeSapDate(sapItem.CapitalizationDate ?? dbItem.CapitalizationDate),
    CreateDate: normalizeSapDate(sapItem.CreateDate ?? dbItem.CreateDate),
    UpdateDate: normalizeSapDate(sapItem.UpdateDate ?? dbItem.UpdateDate),
    ManageItemBy: manageItemBy,
    SerialTrackingMethod:
      sapItem.ManageSerialNumbersOnReleaseOnly === 'tYES'
        ? 'OnReleaseOnly'
        : 'OnEveryTransaction',

    // Keep database enrichments that are display-ready but are not returned
    // by the Service Layer item endpoint.
    ItemsGroupName: dbItem.ItemsGroupName,
    ManufacturerName: dbItem.ManufacturerName,
    UoMGroupName: dbItem.UoMGroupName,
    DefaultVendorName: dbItem.DefaultVendorName,
    ChapterID: dbItem.ChapterID,
    Remarks: dbItem.Remarks,
    AvgStdPrice: dbItem.AvgStdPrice,
    PriceListNum: dbItem.PriceListNum,
    PriceListName: dbItem.PriceListName,
    Price: dbItem.Price,
    ItemPrices: dbItem.ItemPrices,
    ItemWarehouseInfoCollection: dbItem.ItemWarehouseInfoCollection,
    ItemBarCodeCollection: dbItem.ItemBarCodeCollection,
    ItemUnitOfMeasurementCollection: dbItem.ItemUnitOfMeasurementCollection,
    ItemPreferredVendors: dbItem.ItemPreferredVendors,
  };
};

const createItem = async (payload) => {
  try {
    const duplicateSourceItemCode = getDuplicateSourceItemCode(payload);
    const sanitizedPayload = duplicateSourceItemCode
      ? await sanitizeDuplicateCreatePayload(duplicateSourceItemCode, payload)
      : await sanitizeCreatePayload(payload);
    const response = await sapService.request({
      method: 'POST',
      url: '/Items',
      data: sanitizedPayload,
    });

    return response.data;
  } catch (error) {
    const detail = extractSapError(error, 'Failed to create item.');
    const sapError = new Error(detail);
    sapError.response = error.response;
    sapError.code = error.code;
    sapError.cause = error;
    throw sapError;
  }
};

const updateItem = async (itemCode, payload) => {
  try {
    const sanitizedPayload = sanitizeSapPayload(payload);
    delete sanitizedPayload.ItemCode;
    delete sanitizedPayload.Series;

    await sapService.request({
      method: 'PATCH',
      url: sapService.buildStringKeyPath('Items', itemCode),
      data: sanitizedPayload,
    });

    return getItem(itemCode);
  } catch (error) {
    const detail = extractSapError(error, 'Failed to update item.');
    const sapError = new Error(detail);
    sapError.response = error.response;
    sapError.code = error.code;
    sapError.cause = error;
    throw sapError;
  }
};

const createItemGroup = async (payload) => {
  const sapPayload = {
    GroupName: payload.GroupName,
    DefaultUoMGroup:
      payload.DefaultUoMGroup != null && payload.DefaultUoMGroup !== ''
        ? Number(payload.DefaultUoMGroup)
        : undefined,
    PlanningSystem: payload.PlanningSystem || 'bop_None',
    ProcurementMethod: payload.ProcurementMethod || 'bom_Buy',
    OrderIntervals:
      payload.OrderIntervals != null && payload.OrderIntervals !== ''
        ? Number(payload.OrderIntervals)
        : undefined,
    OrderMultiple:
      payload.OrderMultiple != null && payload.OrderMultiple !== ''
        ? Number(payload.OrderMultiple)
        : undefined,
    MinimumOrderQuantity:
      payload.MinimumOrderQuantity != null && payload.MinimumOrderQuantity !== ''
        ? Number(payload.MinimumOrderQuantity)
        : undefined,
    LeadTime:
      payload.LeadTime != null && payload.LeadTime !== ''
        ? Number(payload.LeadTime)
        : undefined,
    ToleranceDays:
      payload.ToleranceDays != null && payload.ToleranceDays !== ''
        ? Number(payload.ToleranceDays)
        : undefined,
    InventorySystem: payload.InventorySystem || 'bis_MovingAverage',
    ItemClass: payload.ItemClass || 'itcMaterial',
  };

  try {
    const response = await sapService.request({
      method: 'POST',
      url: '/ItemGroups',
      data: sapPayload,
    });

    return {
      code: String(response.data.Number),
      name: response.data.GroupName,
    };
  } catch (error) {
    const detail = extractSapError(error, 'Failed to create item group.');
    const sapError = new Error(detail);
    sapError.response = error.response;
    throw sapError;
  }
};

const createManufacturer = async ({ ManufacturerName }) => {
  try {
    const response = await sapService.request({
      method: 'POST',
      url: '/Manufacturers',
      data: { ManufacturerName },
    });

    return {
      code: String(response.data.Code || response.data.ManufacturerCode || ''),
      name: response.data.ManufacturerName || ManufacturerName,
    };
  } catch (error) {
    const detail = extractSapError(error, 'Failed to create manufacturer.');
    const sapError = new Error(detail);
    sapError.response = error.response;
    throw sapError;
  }
};

const getCustomsGroups = async (query = '') => {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  // ponytail: local companies have no customs groups (SAP OARG); add the master when import duty is needed.
  const response = await sapService.request({
    method: 'GET',
    url: '/CustomsGroups?$top=1000',
  }).catch((error) => {
    if (error.response?.status === 501) return { data: { value: [] } };
    throw error;
  });

  const rows = Array.isArray(response.data?.value) ? response.data.value : [];
  return rows
    .map((row) => ({
      code: String(row.Code ?? ''),
      name: row.Name || '',
      number: row.Number != null ? String(row.Number) : '',
      locked: row.Locked || '',
    }))
    .filter((row) => {
      if (!normalizedQuery) return true;
      return [row.code, row.name, row.number]
        .some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => Number(a.code) - Number(b.code));
};

module.exports = {
  createItem,
  updateItem,
  createItemGroup,
  createManufacturer,
  getItem,
  searchItems: itemDbService.searchItems,
  getRecentItemCodes: itemDbService.getRecentItemCodes,
  generateItemCode: itemDbService.generateItemCode,
  getItemCodePrefixes: itemDbService.getItemCodePrefixes,
  checkItemCodeExists: itemDbService.checkItemCodeExists,
  getItemPrices: itemDbService.getItemPrices,
  getItemStock: itemDbService.getItemStock,
  getItemGroups: itemDbService.getItemGroups,
  getManufacturers: itemDbService.getManufacturers,
  getHSNCodes: itemDbService.getHSNCodes,
  getPriceLists: itemDbService.getPriceLists,
  getVendors: itemDbService.getVendors,
  getWarehouses: itemDbService.getWarehouses,
  getGLAccounts: itemDbService.getGLAccounts,
  getUoMGroups: itemDbService.getUoMGroups,
  getCustomsGroups,
  getItemProperties: itemDbService.getItemProperties,
};
