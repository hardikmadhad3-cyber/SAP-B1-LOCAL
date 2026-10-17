const sapService = require('./sapService');
const inventoryTransferDb = require('./inventoryTransferDbService');
const masterDataDbService = require('./masterDataDbService');
const { getMarketingDocumentUdfs, getUdfDefinitions } = require('./udfMetadataService');
const { applyUdfValues } = require('./udfPayloadUtils');

const toIsoDate = (value) => {
  if (!value) return null;
  return String(value).split('T')[0];
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const extractSapError = (error, fallback) =>
  error.response?.data?.error?.message?.value ||
  error.response?.data?.error?.message ||
  error.response?.data?.detail ||
  error.message ||
  fallback;

const loadBusinessPartnerPayload = async (header = {}) => {
  const cardCode = String(header.businessPartner || '').trim();
  if (!cardCode) return {};

  const bpResponse = await sapService.request({
    method: 'GET',
    url: sapService.buildStringKeyPath('BusinessPartners', cardCode),
  });
  const businessPartner = bpResponse.data || {};
  const documentBranch = String(header.fromBranch || '').trim();
  const activeAssignments = Array.isArray(businessPartner.BPBranchAssignment)
    ? businessPartner.BPBranchAssignment.filter(
        (assignment) => String(assignment.DisabledForBP || '').toLowerCase() !== 'tyes'
      ).map((assignment) => String(assignment.BPLID))
    : [];

  if (
    documentBranch &&
    activeAssignments.length &&
    !activeAssignments.includes(documentBranch)
  ) {
    throw new Error(
      `Selected business partner ${cardCode} is not assigned to branch ${documentBranch}.`
    );
  }

  let shipToAddress = String(header.shipToAddress || '').trim();
  if (!shipToAddress && header.shipTo) {
    const details = await inventoryTransferDb.getBusinessPartnerDetails(cardCode);
    const matchedAddress = (details.shipToAddresses || []).find(
      (address) => address.id === header.shipTo || address.label === header.shipTo
    );
    shipToAddress = matchedAddress?.fullAddress || '';
  }

  const partnerPayload = {
    CardCode: cardCode,
  };

  if (header.contactPerson) {
    partnerPayload.ContactPerson = Number(header.contactPerson);
  }

  if (header.shipTo) {
    partnerPayload.ShipToCode = header.shipTo;
  }

  if (shipToAddress) {
    partnerPayload.Address = shipToAddress;
  }

  const selectedPriceList = Number(header.priceList);
  if (Number.isFinite(selectedPriceList) && selectedPriceList > 0) {
    partnerPayload.PriceList = selectedPriceList;
  } else if (businessPartner.PriceListNum != null) {
    partnerPayload.PriceList = Number(businessPartner.PriceListNum);
  }

  return partnerPayload;
};

const getMetadata = async () => {
  const [
    priceLists,
    branches,
    businessPartners,
    salesEmployees,
    distributionRules,
    locations,
    paymentTerms,
    udfMetadata,
  ] = await Promise.all([
    inventoryTransferDb.getPriceLists(),
    inventoryTransferDb.getBranches(),
    inventoryTransferDb.getBusinessPartners(),
    inventoryTransferDb.getSalesEmployees(),
    masterDataDbService.lookupDistributionRules(),
    masterDataDbService.lookupWarehouseLocations(),
    masterDataDbService.lookupPaymentTerms(''),
    getMarketingDocumentUdfs({ headerTable: 'OWTR', lineTable: 'WTR1' }),
  ]);

  return {
    priceLists,
    branches,
    businessPartners,
    salesEmployees,
    distributionRules,
    locations,
    paymentTerms,
    udfMetadata,
  };
};

const getItems = async () => inventoryTransferDb.getItems();
const getWarehouses = async () => inventoryTransferDb.getWarehouses();
const getDistributionRules = async () => masterDataDbService.lookupDistributionRules();
const getSeries = async (targetDate = null, options = {}) =>
  inventoryTransferDb.getSeries(targetDate, options);
const getBusinessPartnerDetails = async (cardCode) =>
  inventoryTransferDb.getBusinessPartnerDetails(cardCode);
const getInventoryTransfers = async () => inventoryTransferDb.getInventoryTransferList();
const getInventoryTransfer = async (docEntry) =>
  inventoryTransferDb.getInventoryTransfer(docEntry);

const validatePayload = ({ header, lines }) => {
  if (!Array.isArray(lines) || !lines.length) {
    throw new Error('Add at least one line before saving.');
  }

  const activeLines = lines.filter((line) => line.itemCode);
  if (!activeLines.length) {
    throw new Error('Add at least one valid row before saving.');
  }

  activeLines.forEach((line, index) => {
    if (!String(line.itemCode || '').trim()) {
      throw new Error(`Line ${index + 1}: Item No is required.`);
    }
    if (toNumber(line.quantity, 0) <= 0) {
      throw new Error(`Line ${index + 1}: Quantity must be greater than zero.`);
    }
    if (!String(line.fromWarehouse || header?.fromWarehouse || '').trim()) {
      throw new Error(`Line ${index + 1}: From Warehouse is required.`);
    }
    if (!String(line.toWarehouse || header?.toWarehouse || '').trim()) {
      throw new Error(`Line ${index + 1}: To Warehouse is required.`);
    }
  });

  if (!header?.postingDate) {
    throw new Error('Posting Date is required.');
  }

  if (!header?.dueDate) {
    throw new Error('Due Date is required.');
  }

  if (!header?.documentDate) {
    throw new Error('Document Date is required.');
  }
};

const createInventoryTransfer = async (payload) => {
  validatePayload(payload);

  const { header, lines = [] } = payload;
  const [headerUdfDefinitions, lineUdfDefinitions] = await Promise.all([
    getUdfDefinitions('OWTR'),
    getUdfDefinitions('WTR1'),
  ]);
  const allowedHeaderUdfs = new Set(headerUdfDefinitions.map((field) => field.key));
  const allowedLineUdfs = new Set(lineUdfDefinitions.map((field) => field.key));
  const activeLines = lines.filter((line) => line.itemCode);
  const firstLine = activeLines[0] || {};
  const documentFromWarehouse = header.fromWarehouse || firstLine.fromWarehouse || '';
  const documentToWarehouse = header.toWarehouse || firstLine.toWarehouse || '';

  const sapPayload = {
    DocDate: toIsoDate(header.postingDate),
    DueDate: toIsoDate(header.dueDate || header.postingDate),
    TaxDate: toIsoDate(header.documentDate),
    Comments: header.remarks || '',
    JournalMemo: header.journalRemark || 'Inventory Transfer',
    ...(header.salesEmployee ? { SalesPersonCode: Number(header.salesEmployee) } : {}),
    FromWarehouse: documentFromWarehouse,
    ToWarehouse: documentToWarehouse,
    StockTransferLines: activeLines
      .map((line) => {
        const documentLine = {
          ItemCode: line.itemCode,
          Quantity: toNumber(line.quantity, 0),
          FromWarehouseCode: line.fromWarehouse || documentFromWarehouse,
          WarehouseCode: line.toWarehouse || documentToWarehouse,
        };

        if (line.uomCode) {
          documentLine.UoMCode = line.uomCode;
        }

        if (line.distributionRule) {
          documentLine.CostingCode = line.distributionRule;
        }
        if (line.distributionRule2) {
          documentLine.CostingCode2 = line.distributionRule2;
        }
        if (line.distributionRule3) {
          documentLine.CostingCode3 = line.distributionRule3;
        }
        if (line.distributionRule4) {
          documentLine.CostingCode4 = line.distributionRule4;
        }
        if (line.distributionRule5) {
          documentLine.CostingCode5 = line.distributionRule5;
        }
        if (line.location !== '' && line.location != null && Number.isFinite(Number(line.location))) {
          documentLine.LocationCode = Number(line.location);
        }
        applyUdfValues(documentLine, line.udf, allowedLineUdfs);

        return documentLine;
      }),
  };

  if (header.series) {
    sapPayload.Series = Number(header.series);
  }

  Object.assign(sapPayload, await loadBusinessPartnerPayload(header));

  if (header.referencedDocument) {
    sapPayload.Reference2 = header.referencedDocument;
  }
  applyUdfValues(sapPayload, payload.header_udfs || payload.headerUdfs, allowedHeaderUdfs);

  console.debug('[InventoryTransfer] Posting payload:', JSON.stringify(sapPayload, null, 2));

  try {
    const response = await sapService.request({
      method: 'POST',
      url: '/StockTransfers',
      data: sapPayload,
    });

    return {
      success: true,
      message: 'Inventory Transfer created successfully.',
      docEntry: response.data.DocEntry,
      docNum: response.data.DocNum,
    };
  } catch (error) {
    const detail = extractSapError(error, 'Failed to create Inventory Transfer.');
    console.error('[InventoryTransfer] SAP error:', detail);
    throw new Error(detail);
  }
};

const updateInventoryTransfer = async (docEntry, payload) => {
  validatePayload(payload);

  const { header } = payload;
  const headerUdfDefinitions = await getUdfDefinitions('OWTR');
  const allowedHeaderUdfs = new Set(headerUdfDefinitions.map((field) => field.key));
  const sapPayload = {
    Comments: header.remarks || '',
    JournalMemo: header.journalRemark || 'Inventory Transfer',
    ...(header.salesEmployee ? { SalesPersonCode: Number(header.salesEmployee) } : {}),
  };

  if (header.referencedDocument) {
    sapPayload.Reference2 = header.referencedDocument;
  }
  applyUdfValues(sapPayload, payload.header_udfs || payload.headerUdfs, allowedHeaderUdfs);

  try {
    await sapService.request({
      method: 'PATCH',
      url: `/StockTransfers(${docEntry})`,
      data: sapPayload,
    });

    return {
      success: true,
      message: 'Inventory Transfer updated successfully.',
      docEntry: Number(docEntry),
      docNum: header.number || '',
    };
  } catch (error) {
    const detail = extractSapError(error, 'Failed to update Inventory Transfer.');
    console.error('[InventoryTransfer] SAP update error:', detail);
    throw new Error(detail);
  }
};

module.exports = {
  getMetadata,
  getItems,
  getWarehouses,
  getDistributionRules,
  getSeries,
  getBusinessPartnerDetails,
  getInventoryTransfers,
  getInventoryTransfer,
  createInventoryTransfer,
  updateInventoryTransfer,
};
