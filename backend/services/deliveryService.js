const { buildDocumentConfirmationPayload, updateDocumentConfirmationOnly } = require('./documentConfirmationUtils');
const sapService = require('./sapService');
const deliveryDb = require('./deliveryDbService');
const salesOrderDb = require('./salesOrderDbService');
const hsnCodeDbService = require('./hsnCodeDbService');
const { buildDocumentAdditionalExpenses } = require('./freightPayloadUtils');
const { buildMarketingDocumentAddressPayload } = require('./documentAddressPayloadUtils');
const { buildDocumentRoundingPayload } = require('./documentRoundingPayloadUtils');
const {
  applySapDocumentCurrency,
  fromStoredDocumentRate,
  loadCompanyCurrencyContext,
  loadDocumentCurrencyReferenceData,
  mergeCurrencyReferenceData,
  normalizeCopyDocumentRateForCompany,
} = require('./salesDocumentCurrencyService');
const { buildDocumentReferencesPayload, normalizeReferenceDocType } = require('./documentReferencesPayloadUtils');
const { getUdfDefinitionsOrEmpty } = require('./udfMetadataService');
const { getActiveCompanyConfig } = require('./companyConfigService');
const { getDocumentBpSelectionPolicy, assertDocumentBpSelection } = require('./documentBpSelectionPolicy');
const { isBlankUdfValue, normalizeUdfValue } = require('./udfPayloadUtils');
const {
  isManualDocumentSeries,
  buildDocumentSeriesPayload,
} = require('./documentSeriesPayloadUtils');

// ───────── HELPERS ─────────

const formatDateForSAP = (value) => {
  if (!value) return null;
  return String(value).split('T')[0];
};

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const firstPresent = (...values) => values.find(hasValue);

const isManualUomPlaceholder = (value) =>
  String(value || '').trim().toUpperCase() === 'MANUAL';

const isTruthyFlag = (value) => (
  value === true || value === 1 || ['Y', 'YES', 'TRUE', '1'].includes(String(value ?? '').trim().toUpperCase())
);

const hasManualUomEntry = (line = {}) => {
  const entry = Number(line.uomEntry ?? line.UoMEntry);
  return Number.isInteger(entry) && entry < 0;
};

const getDeliveryLineRawUomValue = (line = {}) => {
  if (isTruthyFlag(line.uomNameEdited) || hasManualUomEntry(line)) {
    return line.uomName ?? line.UoMName ?? line.UomName ?? line.UnitMsr ?? line.unitMsr ?? line.uomCode;
  }
  return hasValue(line.uomEntry)
    ? line.uomEntry
    : hasValue(line.UoMEntry)
      ? line.UoMEntry
      : line.uomName || line.UoMName || line.UomName || line.UnitMsr || line.unitMsr || line.uomCode;
};

const getDeliveryLineUomValue = (line = {}) => {
  const rawValue = getDeliveryLineRawUomValue(line);

  if (!isManualUomPlaceholder(rawValue)) {
    return rawValue;
  }

  return line.inventoryUOM
    || line.inventoryUom
    || line.InventoryUOM
    || line.uomName
    || line.unitMsr
    || line.MeasureUnit
    || rawValue;
};

const normalizeBranchValue = (value) => {
  const normalized = String(value ?? '').trim();
  const lowered = normalized.toLowerCase();
  if (!normalized || lowered === '0' || lowered === '-1' || lowered === 'no branch' || lowered === 'select branch') {
    return '';
  }

  return normalized;
};

const normalizeBranchId = (branch) => {
  const normalized = normalizeBranchValue(branch);
  return normalized === '' ? -1 : Number(normalized);
};

const normalizeHeaderBranch = (header = {}) => ({
  ...(header || {}),
  branch: normalizeBranchValue(header?.branch),
});

const resolveHeaderCustomerCode = (header = {}) =>
  String(
    header.customerCode ||
    header.customer ||
    header.vendor ||
    header.cardCode ||
    header.CardCode ||
    header.buyerCode ||
    ''
  ).trim();

const toOptionalNumber = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toRequiredNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getLineDiscountPercent = (line = {}) => {
  const explicitPercent = toOptionalNumber(line.stdDiscount ?? line.DiscountPercent ?? line.DiscPrcnt);
  if (explicitPercent !== undefined) return explicitPercent;

  const discountAmount = toOptionalNumber(line.discountAmount ?? line.DiscountAmount);
  const unitPrice = toOptionalNumber(line.unitPrice ?? line.UnitPrice ?? line.Price);
  if (discountAmount !== undefined && unitPrice !== undefined && unitPrice > 0) {
    return (discountAmount * 100) / unitPrice;
  }

  return 0;
};

const toRequiredString = (value, fallback = '') => {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || fallback;
};

const toBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'y', 'tyes'].includes(String(value || '').trim().toLowerCase());
};

const toSapYesNo = (value) => (toBoolean(value) ? 'tYES' : 'tNO');

const hasDeliveryLineColumn = (fieldMetadata = {}, ...columnNames) => {
  const availableColumns = new Set(Object.keys(fieldMetadata || {}).map((key) => String(key).toUpperCase()));
  return columnNames.some((columnName) => availableColumns.has(String(columnName || '').toUpperCase()));
};

const normalizeEWayBillToken = (value) =>
  String(value || '').trim().toUpperCase().replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');

const EWAY_BILL_CODE_ALIASES = {
  subSupplyType: {
    SUPPLY: '1',
    IMPORT: '2',
    EXPORT: '3',
    JOBWORK: '4',
    FOROWNUSE: '5',
    JOBWORKRETURNS: '6',
    SALESRETURN: '7',
    OTHERS: '8',
    SKDCKDLOTS: '9',
    LINESALES: '10',
    RECIPIENTNOTKNOWN: '11',
    EXHIBITIONORFAIRS: '12',
  },
  documentType: {
    TAXINVOICE: 'INV',
    INVOICE: 'INV',
    BILLOFSUPPLY: 'BIL',
    BILL: 'BIL',
    BILLOFENTRY: 'BOE',
    DELIVERYCHALLAN: 'CHL',
    CHALLAN: 'CHL',
    OTHERS: 'OTH',
  },
  transactionType: {
    REGULAR: '1',
    BILLTOSHIPTO: '2',
    BILLFROMSHIPFROM: '3',
    COMBINATIONOF2AND3: '4',
    COMBINATION: '4',
  },
  mode: {
    ROAD: '1',
    RAIL: '2',
    AIR: '3',
    SHIP: '4',
  },
  vehicleType: {
    REGULAR: 'R',
    ODC: 'O',
    OVERDIMENSIONALCARGO: 'O',
  },
};

const normalizeEWayBillCode = (field, value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return EWAY_BILL_CODE_ALIASES[field]?.[normalizeEWayBillToken(raw)] || raw;
};

const normalizeEDocGenerationTypeForSAP = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const token = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases = {
    n: 'edocNotRelevant',
    no: 'edocNotRelevant',
    notrelevant: 'edocNotRelevant',
    edocnotrelevant: 'edocNotRelevant',
    g: 'edocGenerate',
    generate: 'edocGenerate',
    edocgenerate: 'edocGenerate',
    l: 'edocGenerateLater',
    later: 'edocGenerateLater',
    generatelater: 'edocGenerateLater',
    edocgeneratelater: 'edocGenerateLater',
    o: 'edocGenerateOffline',
    offline: 'edocGenerateOffline',
    generateoffline: 'edocGenerateOffline',
    edocgenerateoffline: 'edocGenerateOffline',
  };
  return aliases[token] || raw;
};

const assignElectronicDocumentPayload = (sapPayload, header = {}) => {
  const generationType = normalizeEDocGenerationTypeForSAP(
    header.genericEdocGenerationType || header.edocGenerationType,
  );
  if (generationType) sapPayload.EDocGenerationType = generationType;

  const exportFormat = header.genericEdocExportFormat || header.edocExportFormat;
  if (Number.isFinite(Number(exportFormat)) && String(exportFormat).trim() !== '') {
    sapPayload.EDocExportFormat = Number(exportFormat);
  }
};

const buildEWayBillDetailsPayload = async (details = {}) => {
  if (!details || typeof details !== 'object' || !Object.keys(details).length) return null;

  const meaningfulEntries = Object.entries(details).filter(([key, value]) => {
    if (key === 'supplyType') return false;
    return hasValue(value);
  });
  if (!meaningfulEntries.length) return null;

  const documentType = normalizeEWayBillCode('documentType', details.documentType);
  const subSupplyType = normalizeEWayBillCode('subSupplyType', details.subSupplyType);
  const transactionType = normalizeEWayBillCode('transactionType', details.transactionType);
  const transportationMode = normalizeEWayBillCode('mode', details.mode);
  const vehicleType = normalizeEWayBillCode('vehicleType', details.vehicleType);

  if (!hasValue(documentType)) {
    const error = new Error('E-Way Bill document type is required when E-Way Bill details are entered.');
    error.statusCode = 400;
    throw error;
  }

  const addressParts = (value) => {
    const text = String(value || '').trim();
    return [text.slice(0, 120), text.slice(120, 240)];
  };
  const fromAddress = addressParts(details.dispatchFromAddress);
  const toAddress = addressParts(details.shipToAddress);
  const numberOrUndefined = (value) => {
    const parsed = Number(value);
    return String(value ?? '').trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
  };

  let mainHSNEntry = numberOrUndefined(details.mainHSNEntry);
  if (mainHSNEntry === undefined && hasValue(details.mainHSN)) {
    mainHSNEntry = await deliveryDb.resolveEWayBillHSNEntry(details.mainHSN);
  }
  const [billFromState, dispatchFromState, billToState, shipToState] = await Promise.all([
    deliveryDb.resolveEWayBillStateCode(details.billFromState),
    deliveryDb.resolveEWayBillStateCode(details.dispatchFromState),
    deliveryDb.resolveEWayBillStateCode(details.billToState),
    deliveryDb.resolveEWayBillStateCode(details.shipToState),
  ]);

  const result = {
    SupplyType: String(details.supplyType || '').toLowerCase() === 'inward' ? 'ewb_st_Inward' : 'ewb_st_Outward',
    SubType: numberOrUndefined(subSupplyType),
    DocumentType: documentType,
    TransactionType: numberOrUndefined(transactionType),
    MainHSNEntry: mainHSNEntry ?? undefined,
    EWayBillNo: String(details.ewayBillNo || ''),
    EWayBillDate: hasValue(details.ewayBillDate) ? formatDateForSAP(details.ewayBillDate) : undefined,
    EWayBillExpirationDate: hasValue(details.expirationDate) ? formatDateForSAP(details.expirationDate) : undefined,
    TransporterEntry: numberOrUndefined(details.transporterEntry),
    TransporterName: String(details.transporterName || ''),
    TransporterID: String(details.transporterId || ''),
    TransportationMode: numberOrUndefined(transportationMode),
    VehicleType: vehicleType,
    VehicleNo: String(details.vehicleNo || ''),
    Distance: numberOrUndefined(details.distanceInKM),
    TransporterDocNo: String(details.transporterDocNo || ''),
    TransporterDocDate: hasValue(details.transporterDocDate) ? formatDateForSAP(details.transporterDocDate) : undefined,
    BillFromName: String(details.billFromName || ''),
    BillFromGSTIN: String(details.billFromGSTIN || ''),
    BillFromStateGSTCode: billFromState,
    DispatchFromAddress1: fromAddress[0],
    DispatchFromAddress2: fromAddress[1],
    DispatchFromPlace: String(details.dispatchFromPlace || ''),
    DispatchFromZipCode: String(details.dispatchFromZipCode || ''),
    DispatchFromStateGSTCode: dispatchFromState,
    BillToName: String(details.billToName || ''),
    BillToGSTIN: String(details.billToGSTIN || ''),
    BillToStateGSTCode: billToState,
    ShipToAddress1: toAddress[0],
    ShipToAddress2: toAddress[1],
    ShipToPlace: String(details.shipToPlace || ''),
    ShipToZipCode: String(details.shipToZipCode || ''),
    ShipToStateGSTCode: shipToState,
  };

  return Object.fromEntries(Object.entries(result).filter(([, value]) => hasValue(value)));
};

const mapServiceLayerEWayBillDetails = (details = {}) => {
  if (!details || typeof details !== 'object') return {};
  const dateValue = (value) => value ? String(value).slice(0, 10) : '';
  const supplyType = String(details.SupplyType ?? '').toLowerCase();

  return {
    supplyType: supplyType.includes('inward') || supplyType === '0' ? 'Inward' : 'Outward',
    subSupplyType: details.SubType != null ? String(details.SubType) : '',
    documentType: details.DocumentType || '',
    transactionType: details.TransactionType != null ? String(details.TransactionType) : '',
    mainHSNEntry: details.MainHSNEntry != null ? String(details.MainHSNEntry) : '',
    ewayBillNo: details.EWayBillNo || '',
    ewayBillDate: dateValue(details.EWayBillDate),
    expirationDate: dateValue(details.EWayBillExpirationDate),
    transporterEntry: details.TransporterEntry != null ? String(details.TransporterEntry) : '',
    transporterName: details.TransporterName || '',
    transporterId: details.TransporterID || '',
    mode: details.TransportationMode != null ? String(details.TransportationMode) : '',
    vehicleType: details.VehicleType || '',
    vehicleNo: details.VehicleNo || '',
    distanceInKM: details.Distance != null ? String(details.Distance) : '',
    transporterDocNo: details.TransporterDocNo || '',
    transporterDocDate: dateValue(details.TransporterDocDate),
    billFromName: details.BillFromName || '',
    billFromGSTIN: details.BillFromGSTIN || '',
    billFromState: details.BillFromStateGSTCode || '',
    dispatchFromAddress: [details.DispatchFromAddress1, details.DispatchFromAddress2].filter(Boolean).join(' '),
    dispatchFromPlace: details.DispatchFromPlace || '',
    dispatchFromZipCode: details.DispatchFromZipCode || '',
    dispatchFromState: details.DispatchFromStateGSTCode || '',
    billToName: details.BillToName || '',
    billToGSTIN: details.BillToGSTIN || '',
    billToState: details.BillToStateGSTCode || '',
    shipToAddress: [details.ShipToAddress1, details.ShipToAddress2].filter(Boolean).join(' '),
    shipToPlace: details.ShipToPlace || '',
    shipToZipCode: details.ShipToZipCode || '',
    shipToState: details.ShipToStateGSTCode || '',
  };
};

const applyUdfs = (target, udfValues = {}, allowedKeys = null, fieldMetadata = null, udfDefinitionsByKey = null) => {
  Object.entries(udfValues || {}).forEach(([key, value]) => {
    if (!String(key || '').startsWith('U_')) return;
    if (allowedKeys && !allowedKeys.has(key)) return;

    if (isBlankUdfValue(value)) {
      return;
    }

    const normalizedValue = normalizeUdfValue(value, udfDefinitionsByKey?.get(key), key);
    if (normalizedValue === undefined) return;

    if (fieldMetadata) {
      setValidatedDeliveryField(target, fieldMetadata, key, normalizedValue);
      return;
    }

    target[key] = normalizedValue;
  });
};

const getAllowedUdfKeys = async (tableId) => {
  const definitions = await getUdfDefinitionsOrEmpty(tableId);
  return new Set(definitions.map((field) => field.key));
};

const getUdfDefinitionsByKey = async (tableId) => {
  const definitions = await getUdfDefinitionsOrEmpty(tableId);
  return new Map(definitions.map((field) => [field.key, field]));
};

const resolveSalesEmployeeCode = (input, salesEmployees = []) => {
  if (!hasValue(input) || input === '-1' || input === -1) {
    return undefined;
  }

  if (!Number.isNaN(Number(input)) && Number(input) !== -1) {
    return Number(input);
  }

  const normalizedName = String(input || '').trim().toLowerCase();
  const match = salesEmployees.find((employee) => (
    String(employee.SlpName || '').trim().toLowerCase() === normalizedName
  ));

  return match ? Number(match.SlpCode) : undefined;
};

const buildSalesPersonPayload = (employee = {}) => {
  const name = toRequiredString(employee.SlpName || employee.salesEmployeeName || employee.name, '');
  if (!name) {
    const error = new Error('Sales Employee Name is required.');
    error.statusCode = 400;
    throw error;
  }

  const payload = {
    SalesEmployeeName: name,
    Active: toBoolean(employee.Active ?? employee.active ?? true) ? 'tYES' : 'tNO',
  };

  if (hasValue(employee.Memo ?? employee.remarks)) {
    payload.Remarks = String(employee.Memo ?? employee.remarks).trim();
  }

  const commission = toOptionalNumber(employee.Commission ?? employee.commission);
  if (commission !== undefined) {
    payload.CommissionForSalesEmployee = commission;
  }

  return payload;
};

const NUMBER_DATA_TYPES = new Set([
  'bigint',
  'decimal',
  'float',
  'int',
  'money',
  'numeric',
  'real',
  'smallint',
  'smallmoney',
  'tinyint',
]);

const DATE_DATA_TYPES = new Set([
  'date',
  'datetime',
  'datetime2',
  'datetimeoffset',
  'smalldatetime',
  'time',
]);

const COUNTRY_ORIGIN_ALIASES = new Map([
  ['INDIA', 'IN'],
  ['IND', 'IN'],
  ['BHARAT', 'IN'],
  ['CHINA', 'CN'],
  ['JAPAN', 'JP'],
  ['GERMANY', 'DE'],
  ['UNITEDARABEMIRATES', 'AE'],
  ['UAE', 'AE'],
  ['UNITEDSTATES', 'US'],
  ['UNITEDSTATESOFAMERICA', 'US'],
  ['USA', 'US'],
  ['US', 'US'],
  ['UNITEDKINGDOM', 'UK'],
  ['GREATBRITAIN', 'UK'],
  ['BRITAIN', 'UK'],
  ['UK', 'UK'],
]);

const normalizeCountryOrgValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const upper = raw.toUpperCase();
  const compact = upper.replace(/[^A-Z0-9]/g, '');

  if (COUNTRY_ORIGIN_ALIASES.has(compact)) return COUNTRY_ORIGIN_ALIASES.get(compact);
  if (/^[A-Z0-9]{1,3}$/.test(compact)) return compact;
  return '';
};

const DELIVERY_LINE_UDF_MAPPINGS = [
  { sapField: 'U_SPLRBT', getValue: (line) => line.specialRebate },
  { sapField: 'U_COMPRC', getValue: (line) => line.commission },
  { sapField: 'U_S_BrokPerQty', getValue: (line) => line.sellerBrokeragePerQty },
  { sapField: 'U_Unit_Price', getValue: (line) => line.unitPriceUdf },
  { sapField: 'U_Rate', getValue: (line) => line.discountAmount ?? line.DiscountAmount },
  { sapField: 'U_Brok_Seller', getValue: (line) => line.sellerBrokerage },
  { sapField: 'U_Brok_Buyer', getValue: (line) => line.buyerBrokerage },
  { sapField: 'U_Buyer_Delivery', getValue: (line) => line.buyerDelivery },
  { sapField: 'U_Seller_Delivery', getValue: (line) => line.sellerDelivery },
  { sapField: 'U_Buyer_Payment_Terms', getValue: (line) => line.buyerPaymentTerms },
  { sapField: 'U_Seller_Payment_Terms', getValue: (line) => line.sellerPaymentTerms },
  { sapField: 'U_Buyer_Quality', getValue: (line) => line.buyerQuality },
  { sapField: 'U_Seller_Quality', getValue: (line) => line.sellerQuality },
  { sapField: 'U_Buyer_Price', getValue: (line) => line.buyerPrice },
  { sapField: 'U_Seller_Price', getValue: (line) => line.sellerPrice },
  { sapField: 'U_Buyer_SPINS', getValue: (line) => line.buyerSpecialInstruction },
  { sapField: 'U_Seller_SPINS', getValue: (line) => line.sellerSpecialInstruction },
  { sapField: 'U_Sel_Brok_AP', getValue: (line) => line.sellerBrokerageAmtPer },
  { sapField: 'U_Seller_Brok_Per', getValue: (line) => line.sellerBrokeragePercent },
  { sapField: 'U_Buyer_Bill_Disc', getValue: (line) => line.buyerBillDiscount },
  { sapField: 'U_Seller_Bill_Disc', getValue: (line) => line.sellerBillDiscount },
  { sapField: 'U_SELLTCODE', getValue: (line) => line.stcode },
  { sapField: 'U_S_Item', getValue: (line) => line.sellerItem },
  { sapField: 'U_S_Qty', getValue: (line) => line.sellerQty },
  { sapField: 'U_Freight_pur', getValue: (line) => line.freightPurchase },
  { sapField: 'U_Freight_sales', getValue: (line) => line.freightSales },
  { sapField: 'U_Fr_trans', getValue: (line) => line.freightProvider },
  { sapField: 'U_Fr_trans_name', getValue: (line) => line.freightProviderName },
  { sapField: 'U_BDNum', getValue: (line) => line.brokerageNumber },
  { sapField: 'U_PackingType', getValue: (line) => firstPresent(line.U_PackingType, line.packingType, line.udf?.U_PackingType) },
  { sapField: 'U_GrossWt', getValue: (line) => firstPresent(line.U_GrossWt, line.grossWt, line.udf?.U_GrossWt) },
  { sapField: 'U_TotalPackage', getValue: (line) => firstPresent(line.U_TotalPackage, line.totalPackage, line.udf?.U_TotalPackage) },
];

const DELIVERY_LOOKUP_UDF_FIELDS = new Set([
  'U_Buyer_Quality',
  'U_Seller_Quality',
  'U_Buyer_Price',
  'U_Seller_Price',
]);

const coerceValueForSqlType = (value, sqlDataType) => {
  if (!hasValue(value)) return undefined;

  const normalizedType = String(sqlDataType || '').trim().toLowerCase();

  if (NUMBER_DATA_TYPES.has(normalizedType)) {
    return toOptionalNumber(value);
  }

  if (DATE_DATA_TYPES.has(normalizedType)) {
    return formatDateForSAP(value);
  }

  return String(value).trim();
};

const setValidatedDeliveryField = (target, fieldMetadata, fieldName, value) => {
  const resolvedFieldName = Object.keys(fieldMetadata || {}).find(
    (candidate) => String(candidate).trim().toLowerCase() === String(fieldName).trim().toLowerCase(),
  );
  const sqlDataType = fieldMetadata?.[resolvedFieldName];
  if (!sqlDataType) return;

  const coercedValue = coerceValueForSqlType(value, sqlDataType);
  if (coercedValue !== undefined) {
    target[resolvedFieldName] = coercedValue;
  }
};

const setValidatedDeliveryUdf = (target, fieldMetadata, fieldName, value) => {
  const resolvedFieldName = Object.keys(fieldMetadata || {}).find(
    (candidate) => String(candidate).trim().toLowerCase() === String(fieldName).trim().toLowerCase(),
  );
  if (!resolvedFieldName) return;

  if (isBlankUdfValue(value)) {
    return;
  }

  setValidatedDeliveryField(target, fieldMetadata, resolvedFieldName, value);
};

const normalizeLookupToken = (value) => String(value || '').trim().toLowerCase();

const buildDeliveryLookupResolvers = async () => {
  const entries = await Promise.all(
    [...DELIVERY_LOOKUP_UDF_FIELDS].map(async (fieldName) => [
      fieldName,
      await deliveryDb.getLookupValues(fieldName).catch(() => []),
    ])
  );

  return entries.reduce((acc, [fieldName, options]) => {
    const tokens = new Map();

    for (const option of options || []) {
      const value = String(option?.value || '').trim();
      const description = String(option?.description || '').trim();
      const label = String(option?.label || '').trim();
      if (!value) continue;

      [value, description, label].forEach((token) => {
        const normalizedToken = normalizeLookupToken(token);
        if (normalizedToken) {
          tokens.set(normalizedToken, value);
        }
      });
    }

    acc[fieldName] = {
      hasFixedValues: tokens.size > 0,
      tokens,
    };
    return acc;
  }, {});
};

const resolveDeliveryLookupValue = (fieldName, value, lookupResolvers = {}) => {
  if (!DELIVERY_LOOKUP_UDF_FIELDS.has(fieldName) || !hasValue(value)) {
    return value;
  }

  const resolver = lookupResolvers[fieldName];
  if (!resolver?.hasFixedValues) {
    return value;
  }

  const resolvedValue = resolver.tokens.get(normalizeLookupToken(value));
  if (resolvedValue) {
    return resolvedValue;
  }

  console.warn(`[Delivery] Ignoring invalid ${fieldName} lookup value "${value}" because it is not configured for Delivery.`);
  return undefined;
};

const buildDocumentLinePayload = async (line = {}, fieldMetadata = {}, includeLineNum = false, lookupResolvers = {}, allowedLineUdfs = null, lineIndex = 0, includeBatchNumbers = true) => {
  let isBaseDocumentLine = hasValue(line.baseEntry)
    && hasValue(line.baseType)
    && line.baseLine !== undefined
    && line.baseLine !== null
    && line.baseLine !== '';
  if (isBaseDocumentLine && Number(line.baseType) === 17 && hasValue(line.itemNo)) {
    const baseItemCode = await deliveryDb.getBaseSalesOrderLineItemCode(line.baseEntry, line.baseLine);
    if (baseItemCode && baseItemCode !== String(line.itemNo || '').trim()) {
      isBaseDocumentLine = false;
    }
  }
  const documentLine = {
    Quantity: toRequiredNumber(line.quantity, 0),
    UnitPrice: toRequiredNumber(line.unitPrice ?? line.UnitPrice ?? line.Price, 0),
  };

  if (
    hasValue(line.stdDiscount)
    || hasValue(line.DiscountPercent)
    || hasValue(line.DiscPrcnt)
    || hasValue(line.discountAmount)
    || hasValue(line.DiscountAmount)
  ) {
    documentLine.DiscountPercent = getLineDiscountPercent(line);
  }

  if (includeLineNum && line.lineNum != null && line.lineNum !== '') {
    documentLine.LineNum = Number(line.lineNum);
  }

  if (isBaseDocumentLine) {
    documentLine.BaseEntry = Number(line.baseEntry);
    documentLine.BaseType = Number(line.baseType);
    documentLine.BaseLine = Number(line.baseLine);
    if (hasValue(line.whse)) {
      documentLine.WarehouseCode = String(line.whse).trim();
    }
  } else {
    documentLine.ItemCode = toRequiredString(line.itemNo, '');
    documentLine.WarehouseCode = toRequiredString(line.whse, '');
  }

  if (hasValue(line.itemDescription)) {
    documentLine.ItemDescription = String(line.itemDescription).trim();
  }

  if (!isBaseDocumentLine) {
    const uomNameEdited = isTruthyFlag(line.uomNameEdited);
    const usesManualUom = uomNameEdited || hasManualUomEntry(line);
    const rawUomValue = getDeliveryLineRawUomValue(line);
    const uomValue = getDeliveryLineUomValue(line);
    const resolvedUomEntry = await deliveryDb.resolveDeliveryLineUomEntry(
      line.itemNo,
      rawUomValue,
      { allowDefaultFallback: !usesManualUom },
    );
    if (resolvedUomEntry !== null && resolvedUomEntry !== undefined) {
      documentLine.UoMEntry = resolvedUomEntry;
    } else if (hasValue(uomValue)) {
      if (usesManualUom) {
        documentLine.MeasureUnit = String(uomValue).trim();
      } else {
        documentLine.UoMCode = String(uomValue).trim();
      }
    }
  }

  const taxCode = firstPresent(line.taxCode, line.TaxCode, line.VatGroup);
  if (hasValue(taxCode)) {
    documentLine.TaxCode = String(taxCode).trim();
  }

  if (hasValue(line.distRule)) {
    documentLine.CostingCode = String(line.distRule).trim();
  }
  [2, 3, 4, 5].forEach((dimension) => {
    const value = line[`distRule${dimension}`];
    if (hasValue(value) && hasDeliveryLineColumn(fieldMetadata, `OcrCode${dimension}`)) {
      documentLine[`CostingCode${dimension}`] = String(value).trim();
    }
  });

  if (hasValue(line.cogsDistRule) && hasDeliveryLineColumn(fieldMetadata, 'CogsOcrCod')) {
    documentLine.COGSCostingCode = String(line.cogsDistRule).trim();
  }

  [2, 3, 4, 5].forEach((dimension) => {
    const value = line[`cogsDistRule${dimension}`];
    if (hasValue(value) && hasDeliveryLineColumn(fieldMetadata, `CogsOcrCo${dimension}`)) {
      documentLine[`COGSCostingCode${dimension}`] = String(value).trim();
    }
  });

  if (hasValue(line.glAccount) && hasDeliveryLineColumn(fieldMetadata, 'AcctCode')) {
    documentLine.AccountCode = String(line.glAccount).trim();
  }

  if (hasValue(line.freeText)) {
    documentLine.FreeText = String(line.freeText).trim();
  }

  const lineDeliveryDate = firstPresent(line.lineDeliveryDate, line.deliveryDate, line.ShipDate);
  if (lineDeliveryDate && hasDeliveryLineColumn(fieldMetadata, 'ShipDate')) {
    documentLine.ShipDate = formatDateForSAP(lineDeliveryDate);
  }

  const requiredDate = firstPresent(line.requiredDate, line.RequiredDate, line.ReqDate);
  if (requiredDate && hasDeliveryLineColumn(fieldMetadata, 'ReqDate', 'RequiredDate')) {
    documentLine.RequiredDate = formatDateForSAP(requiredDate);
  }

  const packageQuantity = toOptionalNumber(firstPresent(
    line.noOfPackages,
    line.NoOfPackages,
    line.packageQuantity,
    line.PackageQuantity,
    line.PackQty,
  ));
  if (packageQuantity !== undefined && hasDeliveryLineColumn(fieldMetadata, 'PackQty', 'PackageQuantity')) {
    documentLine.PackageQuantity = packageQuantity;
  }

  const lineShippingType = toOptionalNumber(firstPresent(
    line.lineShippingType,
    line.shippingType,
    line.ShippingMethod,
    line.TrnsCode,
  ));
  if (lineShippingType !== undefined && hasDeliveryLineColumn(fieldMetadata, 'TrnsCode')) {
    documentLine.ShippingMethod = lineShippingType;
  }

  const taxLiable = firstPresent(line.taxLiable, line.TaxLiable, line.TaxOnly);
  if (taxLiable !== undefined && hasDeliveryLineColumn(fieldMetadata, 'TaxOnly')) {
    documentLine.TaxOnly = toSapYesNo(taxLiable);
  }

  const wTaxLiable = firstPresent(line.wTaxLiable, line.WTaxLiable, line.WTLiable);
  if (wTaxLiable !== undefined && hasDeliveryLineColumn(fieldMetadata, 'WtLiable')) {
    documentLine.WTLiable = toSapYesNo(wTaxLiable);
  }

  const locationCode = toOptionalNumber(firstPresent(
    line.loc,
    line.locCode,
    line.LocationCode,
    line.LocCode,
  ));
  if (locationCode !== undefined && locationCode >= 0 && hasDeliveryLineColumn(fieldMetadata, 'LocCode')) {
    documentLine.LocationCode = locationCode;
  }

  const agreementNo = toOptionalNumber(firstPresent(
    line.blanketAgreementNo,
    line.agreementNo,
    line.AgreementNo,
    line.AgrNo,
  ));
  if (agreementNo !== undefined && hasDeliveryLineColumn(fieldMetadata, 'AgrNo')) {
    documentLine.AgreementNo = agreementNo;
  }

  const agreementRowNumber = toOptionalNumber(firstPresent(
    line.blanketAgreementLine,
    line.agreementRowNumber,
    line.AgreementRowNumber,
    line.AgrLnNum,
  ));
  if (agreementRowNumber !== undefined && hasDeliveryLineColumn(fieldMetadata, 'AgrLnNum')) {
    documentLine.AgreementRowNumber = agreementRowNumber;
  }

  const commissionPercent = toOptionalNumber(firstPresent(
    line.commPercent,
    line.commissionPercent,
    line.CommissionPercent,
  ));
  if (commissionPercent !== undefined && hasDeliveryLineColumn(fieldMetadata, 'CommPercent', 'Commission')) {
    documentLine.CommissionPercent = commissionPercent;
  }

  const withoutInventoryMovement = firstPresent(
    line.withoutQtyPosting,
    line.withoutInventoryMovement,
    line.WithoutInventoryMovement,
    line.NoInvtryMv,
  );
  if (withoutInventoryMovement !== undefined && hasDeliveryLineColumn(fieldMetadata, 'NoInvtryMv')) {
    documentLine.WithoutInventoryMovement = toSapYesNo(withoutInventoryMovement);
  }

  const hsnValue = firstPresent(line.hsnCode, line.HSNCode, line.HSNEntry);
  if (hsnValue && hasDeliveryLineColumn(fieldMetadata, 'HsnEntry')) {
    const hsnEntry = await hsnCodeDbService.resolveHSNCodeToAbsEntry(hsnValue);
    if (hsnEntry !== null && hsnEntry !== undefined) {
      documentLine.HSNEntry = hsnEntry;
    }
  }

  const sacValue = firstPresent(line.sacCode, line.SACCode, line.SACEntry);
  if (sacValue && hasDeliveryLineColumn(fieldMetadata, 'SACEntry', 'SacEntry')) {
    const sacEntry = await hsnCodeDbService.resolveSACCodeToAbsEntry(sacValue);
    if (sacEntry !== null && sacEntry !== undefined) {
      documentLine.SACEntry = sacEntry;
    }
  }

  const countryOrg = normalizeCountryOrgValue(line.countryOfOrigin);
  if (hasValue(line.countryOfOrigin) && !countryOrg) {
    console.warn(`[Delivery Service] Skipping CountryOrg value because it is not a valid SAP country code: ${line.countryOfOrigin}`);
  }
  setValidatedDeliveryField(documentLine, fieldMetadata, 'CountryOrg', countryOrg);

  const normalizedLineUdfs = Object.entries(line.udf || {}).reduce((acc, [key, value]) => {
    acc[key] = resolveDeliveryLookupValue(key, value, lookupResolvers);
    return acc;
  }, {});
  applyUdfs(documentLine, normalizedLineUdfs, allowedLineUdfs, fieldMetadata);

  for (const mapping of DELIVERY_LINE_UDF_MAPPINGS) {
    const value = resolveDeliveryLookupValue(
      mapping.sapField,
      mapping.getValue(line),
      lookupResolvers,
    );
    setValidatedDeliveryUdf(documentLine, fieldMetadata, mapping.sapField, value);
  }

  if (includeBatchNumbers && line.batches && line.batches.length > 0) {
    documentLine.BatchNumbers = line.batches.map((batch) => ({
      BatchNumber: String(batch.batchNumber || '').trim(),
      Quantity: Number(batch.quantity),
    }));
  }

  if (includeBatchNumbers && Array.isArray(line.serialNumbers) && line.serialNumbers.length > 0) {
    documentLine.SerialNumbers = line.serialNumbers.map((serial) => ({
      InternalSerialNumber: String(serial.serialNumber || '').trim(),
      ...(hasValue(serial.systemSerialNumber)
        ? { SystemSerialNumber: Number(serial.systemSerialNumber) }
        : {}),
      Quantity: 1,
    }));
  }

  if (includeBatchNumbers && Array.isArray(line.binAllocations) && line.binAllocations.length > 0) {
    documentLine.DocumentLinesBinAllocations = line.binAllocations.map((allocation) => ({
      BinAbsEntry: Number(allocation.binAbsEntry),
      Quantity: Number(allocation.quantity),
      BaseLineNumber: lineIndex,
      ...(hasValue(allocation.allocationIndex)
        ? { SerialAndBatchNumbersBaseLine: Number(allocation.allocationIndex) }
        : {}),
    }));
  }

  return documentLine;
};

const buildDocumentLinesPayload = async (lines = [], includeLineNum = false, includeBatchNumbers = true) => {
  const [dln1FieldMetadata, lookupResolvers, allowedLineUdfs] = await Promise.all([
    deliveryDb.getDeliveryLineFieldMetadata(),
    buildDeliveryLookupResolvers(),
    getAllowedUdfKeys('DLN1'),
  ]);

  const sourceLines = (lines || []).filter((line) => hasValue(line.itemNo));
  return Promise.all(
    sourceLines.map((line, index) => buildDocumentLinePayload(line, dln1FieldMetadata, includeLineNum, lookupResolvers, allowedLineUdfs, index, includeBatchNumbers))
  );
};

// ───────── REFERENCE DATA (USING ODBC) ─────────

const resolveDefaultReferenceObjectType = (lines = []) => {
  const baseTypes = [...new Set((lines || [])
    .map((line) => String(line?.baseType ?? line?.BaseType ?? '').trim())
    .filter(Boolean))];

  return baseTypes.length === 1 ? baseTypes[0] : '';
};

const resolveReferenceDocumentsForSubmit = async (references = [], lines = []) => {
  if (!Array.isArray(references) || !references.length) return [];

  const defaultObjectType = resolveDefaultReferenceObjectType(lines);

  return Promise.all(references.map(async (row) => {
    const direction = String(row?.direction || 'to').toLowerCase();
    if (direction === 'by') return row;

    const rawType = row?.transactionType || row?.referencedObjectType || row?.RefObjType || defaultObjectType;
    const transactionType = normalizeReferenceDocType(rawType);
    const docEntry = String(row?.docEntry || row?.referencedDocEntry || row?.RefDocEntr || '').trim();
    const docNumber = String(row?.docNumber || row?.referencedDocNumber || row?.RefDocNum || '').trim();

    if (!transactionType || docEntry || !docNumber) {
      return {
        ...row,
        transactionType: row?.transactionType || transactionType,
      };
    }

    try {
      const lookup = await salesOrderDb.getReferenceDocumentLookup({
        transactionType,
        query: docNumber,
        top: 20,
      });
      const exact = (lookup.options || []).find((option) => String(option.docNumber || '') === docNumber);
      if (!exact?.docEntry) {
        return {
          ...row,
          transactionType,
        };
      }

      return {
        ...row,
        transactionType,
        docEntry: exact.docEntry,
        docNumber: exact.docNumber || docNumber,
        extDocNumber: row?.extDocNumber || exact.extDocNumber || '',
      };
    } catch (error) {
      console.warn(`[Delivery] Could not resolve referenced document ${transactionType}/${docNumber}: ${error.message}`);
      return {
        ...row,
        transactionType,
      };
    }
  }));
};

const getReferenceData = async (companyId) => {
  try {
    const [data, companyConfig, currencyContext] = await Promise.all([
      deliveryDb.getReferenceData(),
      getActiveCompanyConfig(),
      loadCompanyCurrencyContext(),
    ]);
    const toVendorCode = String(
      companyConfig?.documentDefaults?.salesOrderToVendorCode || '',
    ).trim();

    const bpSelectionPolicy = await getDocumentBpSelectionPolicy('delivery');
    return mergeCurrencyReferenceData({
      ...data,
      bp_selection_policy: bpSelectionPolicy,
      defaults: {
        ...(data.defaults || {}),
        toVendorCode,
      },
    }, currencyContext);
  } catch (error) {
    return {
      company: '',
      company_state: '',
      vendors: [],
      customers: [],
      items: [],
      warehouses: [],
      warehouse_addresses: [],
      payment_terms: [],
      shipping_types: [],
      branches: [],
      distribution_rules: [],
      tax_codes: [],
      uom_groups: [],
      quality_options: { buyer: [], seller: [] },
      price_options: { buyer: [], seller: [] },
      contacts: [],
      pay_to_addresses: [],
      company_address: {},
      local_currency: '',
      system_currency: '',
      currencies: [],
      defaults: {
        toVendorCode: '',
      },
      decimal_settings: {
        QtyDec: 2,
        PriceDec: 2,
        SumDec: 2,
        RateDec: 2,
        PercentDec: 2
      },
      warnings: [`Failed to load reference data: ${error.message}`],
    };
  }
};

// ───────── CUSTOMER DETAILS (USING ODBC) ─────────

const getCustomerDetails = async (customerCode) => {
  try {
    const result = await deliveryDb.getCustomerDetails(customerCode);
    return result;
  } catch (error) {
    console.error('[Delivery Service] Failed to load customer details:', error);
    throw error;
  }
};

// ───────── DELIVERY LIST (USING ODBC) ─────────

const saveSalesEmployeesSetup = async (employees = []) => {
  if (!Array.isArray(employees)) {
    const error = new Error('Sales employee setup rows must be an array.');
    error.statusCode = 400;
    throw error;
  }

  const saved = [];
  const existingSalesEmployees = await deliveryDb.getSalesEmployees().catch(() => []);
  let nextSalesEmployeeCode = existingSalesEmployees.reduce((maxCode, employee) => {
    const code = toOptionalNumber(employee.SlpCode);
    return code !== undefined && code > maxCode ? code : maxCode;
  }, 0) + 1;

  for (const employee of employees) {
    if (String(employee?.SlpCode) === '-1') {
      continue;
    }

    const name = String(employee?.SlpName || employee?.salesEmployeeName || employee?.name || '').trim();
    if (!name) {
      continue;
    }

    const payload = buildSalesPersonPayload({ ...employee, SlpName: name });
    const slpCode = toOptionalNumber(employee.SlpCode);

    if (slpCode !== undefined && slpCode !== -1) {
      if (!toBoolean(employee.Changed ?? employee.changed ?? false)) {
        continue;
      }

      await sapService.request({
        method: 'PATCH',
        url: `/SalesPersons(${slpCode})`,
        data: payload,
      });

      saved.push({ SlpCode: slpCode, SlpName: name, updated: true });
      continue;
    }

    const newSalesEmployeeCode = nextSalesEmployeeCode;
    nextSalesEmployeeCode += 1;
    payload.SalesEmployeeCode = newSalesEmployeeCode;

    let response;
    try {
      response = await sapService.request({
        method: 'POST',
        url: '/SalesPersons',
        data: payload,
      });
    } catch (error) {
      const minimalPayload = {
        SalesEmployeeCode: newSalesEmployeeCode,
        SalesEmployeeName: payload.SalesEmployeeName,
        Active: payload.Active,
      };

      response = await sapService.request({
        method: 'POST',
        url: '/SalesPersons',
        data: minimalPayload,
      });
    }

    saved.push({
      SlpCode: response.data?.SalesEmployeeCode ?? newSalesEmployeeCode,
      SlpName: name,
      created: true,
    });
  }

  return {
    success: true,
    message: 'Sales employees setup saved.',
    sales_employees: await deliveryDb.getSalesEmployees(),
    saved,
  };
};

const getCustomerFilterOptions = async ({
  query = '',
  customerCode = '',
  customerName = '',
  top,
  display = 'code',
} = {}) => {
  try {
    const rows = await salesOrderDb.searchCustomers({
      query,
      cardCode: customerCode,
      cardName: customerName,
      top,
      sortBy: display === 'name' ? 'name' : 'code',
    });

    return {
      options: rows.map((row) => ({
        code: display === 'name'
          ? String(row.CardName || '').trim()
          : String(row.CardCode || '').trim(),
        name: display === 'name'
          ? String(row.CardCode || '').trim()
          : String(row.CardName || '').trim(),
      })).filter((option) => option.code),
    };
  } catch (_error) {
    return { options: [] };
  }
};

const getDeliveryList = async ({
  query = '',
  openOnly = false,
  docNum = '',
  customerCode = '',
  customerName = '',
  sellerCode = '',
  sellerName = '',
  status = '',
  postingDateFrom = '',
  postingDateTo = '',
  page = 1,
  pageSize = 25,
} = {}) => {
  try {
    const result = await deliveryDb.getDeliveryList({
      query,
      openOnly,
      docNum,
      customerCode,
      customerName,
      sellerCode,
      sellerName,
      status,
      postingDateFrom,
      postingDateTo,
      page,
      pageSize,
    });
    return result;
  } catch (error) {
    return {
      deliveries: [],
      pagination: {
        page: Math.max(1, Number(page) || 1),
        pageSize: Math.min(200, Math.max(1, Number(pageSize) || 25)),
        totalCount: 0,
        totalPages: 1,
      },
    };
  }
};

// ───────── GET SINGLE DELIVERY (USING ODBC) ─────────

const getDelivery = async (docEntry) => {
  try {
    const result = await deliveryDb.getDelivery(docEntry);
    const currencyReferenceData = mergeCurrencyReferenceData(
      {},
      await loadCompanyCurrencyContext(),
    );
    if (result?.delivery?.header?.exchangeRate) {
      result.delivery.header.exchangeRate = String(
        fromStoredDocumentRate(result.delivery.header.exchangeRate, currencyReferenceData),
      );
    }
    try {
      const response = await sapService.request({
        method: 'GET',
        url: `/DeliveryNotes(${Number(docEntry)})?$select=EWayBillDetails`,
      });
      const serviceLayerDetails = mapServiceLayerEWayBillDetails(response.data?.EWayBillDetails);
      const enteredServiceLayerDetails = Object.fromEntries(
        Object.entries(serviceLayerDetails).filter(([, value]) => value !== '' && value !== null && value !== undefined),
      );
      if (result?.delivery && Object.keys(enteredServiceLayerDetails).length) {
        const enteredDatabaseDetails = Object.fromEntries(
          Object.entries(result.delivery.eway_bill_details || {}).filter(([, value]) => value !== '' && value !== null && value !== undefined),
        );
        result.delivery.eway_bill_details = {
          ...enteredServiceLayerDetails,
          ...enteredDatabaseDetails,
        };
      }
    } catch (eWayBillError) {
      // 501: the local ERP keeps E-Way Bill details in the database only.
      if (eWayBillError.response?.status !== 501) console.warn(`[Delivery] Could not load E-Way Bill details from Service Layer for ${docEntry}: ${eWayBillError.message}`);
    }
    return result;
  } catch (error) {
    throw new Error(`Failed to load Delivery: ${error.message}`);
  }
};

// ───────── DOCUMENT SERIES (USING ODBC) ─────────

const getDocumentSeries = async (targetDate = null, { branch = '' } = {}) => {
  try {
    const result = await deliveryDb.getDocumentSeries(targetDate, { branch });
    return result;
  } catch (error) {
    return { series: [] };
  }

};

const getNextNumber = async (series, options = {}) => {
  try {
    const result = await deliveryDb.getNextNumber(series, options);
    return result;
  } catch (error) {
    return { nextNumber: null };
  }
};

// ───────── STATE FROM WAREHOUSE (USING ODBC) ─────────

const getStateFromWarehouse = async (whsCode) => {
  try {
    const result = await deliveryDb.getStateFromWarehouse(whsCode);
    return result;
  } catch (error) {
    return { state: '' };
  }
};

// ───────── OPEN SALES ORDERS (USING ODBC) ─────────

const getOpenSalesOrders = async (customerCode = null) => {
  try {
    const result = await deliveryDb.getOpenSalesOrders(customerCode);
    return result;
  } catch (error) {
    return { orders: [] };
  }
};

const getSalesOrderForCopy = async (docEntry) => {
  try {
    const result = await deliveryDb.getSalesOrderForCopy(docEntry);
    return normalizeCopyDocumentRateForCompany(result);
  } catch (error) {
    throw new Error(`Failed to load Sales Order: ${error.message}`);
  }
};

const getOpenArReserveInvoices = async (customerCode = null) => (
  deliveryDb.getOpenArReserveInvoices(customerCode)
);

const getArReserveInvoiceForCopy = async (docEntry) => normalizeCopyDocumentRateForCompany(
  await deliveryDb.getArReserveInvoiceForCopy(docEntry),
);

// ───────── GET DELIVERY FOR COPY TO CREDIT MEMO ─────────

const getDeliveryForCopyToCreditMemo = async (docEntry) => {
  try {
    const result = await deliveryDb.getDeliveryForCopyToCreditMemo(docEntry);
    return normalizeCopyDocumentRateForCompany(result);
  } catch (error) {
    throw new Error(`Failed to load Delivery for copy: ${error.message}`);
  }
};

// ───────── BATCHES (USING ODBC) ─────────

const getBatchesByItem = async (itemCode, whsCode) => {
  try {
    const result = await deliveryDb.getBatchesByItem(itemCode, whsCode);
    return result;
  } catch (error) {
    return { batches: [] };
  }
};

const getAvailableSerials = (itemCode, whsCode) => deliveryDb.getAvailableSerials(itemCode, whsCode);
const getAvailableBins = (itemCode, whsCode) => deliveryDb.getAvailableBins(itemCode, whsCode);

// ───────── SUBMIT DELIVERY (USING SERVICE LAYER) ─────────

const submitDelivery = async (payload) => {
  try {
    assertDocumentBpSelection(
      await getDocumentBpSelectionPolicy('delivery'),
      resolveHeaderCustomerCode(payload.header || {}),
    );
    const validationResult = await validateDeliveryDocument(payload);
    if (!validationResult.isValid) {
      const error = new Error(validationResult.errors.join('\n'));
      error.statusCode = 400;
      throw error;
    }

    const { company_id, lines, header_udfs } = payload;
    const header = normalizeHeaderBranch(payload.header);
    const customerCode = resolveHeaderCustomerCode(header);
console.log("Payload:", payload );
    const documentAdditionalExpenses = buildDocumentAdditionalExpenses(payload.freightCharges);
    const resolvedReferenceDocuments = payload.reference_documents_changed
      ? await resolveReferenceDocumentsForSubmit(payload.reference_documents, lines)
      : [];
    const documentReferences = payload.reference_documents_changed
      ? buildDocumentReferencesPayload(resolvedReferenceDocuments, {
          defaultObjectType: resolveDefaultReferenceObjectType(lines),
        })
      : [];
    const hasDocumentReferences = documentReferences.length > 0;
    const [documentLines, headerUdfDefinitionsByKey, headerFieldMetadata] = await Promise.all([
      buildDocumentLinesPayload(lines),
      getUdfDefinitionsByKey('ODLN'),
      deliveryDb.getDeliveryHeaderFieldMetadata(),
    ]);
    const allowedHeaderUdfs = new Set(headerUdfDefinitionsByKey.keys());
    const salesEmployees = await deliveryDb.getSalesEmployees();
    const salesPersonCode = resolveSalesEmployeeCode(
      header.salesEmployee ?? header.purchaser,
      salesEmployees,
    );
    // Build SAP Service Layer payload
    const sapPayload = {
      CardCode: customerCode,
      DocDate: formatDateForSAP(header.postingDate),
      DocDueDate: formatDateForSAP(header.deliveryDate || header.postingDate),
      TaxDate: formatDateForSAP(header.documentDate),
      Comments: header.otherInstruction || '',
      JournalMemo: header.journalRemark || '',
      NumAtCard: header.salesContractNo || '',
      DiscountPercent: header.discount ? parseFloat(header.discount) : 0,
      DocumentAdditionalExpenses: documentAdditionalExpenses,
      ...buildMarketingDocumentAddressPayload(header, { shipAddressField: 'Address2', billAddressField: 'Address' }),
      ...(hasDocumentReferences ? { DocumentReferences: documentReferences } : {}),
      DocumentLines: documentLines,
    };
console.log("SAP Payload:", sapPayload);
    Object.assign(sapPayload, buildDocumentSeriesPayload(header));
    const currencyReferenceData = await loadDocumentCurrencyReferenceData(header);
    applySapDocumentCurrency(sapPayload, header, currencyReferenceData);
    if (headerFieldMetadata.BPLId && hasValue(header.branch)) sapPayload.BPLId = normalizeBranchId(header.branch);
    if (headerFieldMetadata.BPL_IDAssignedToInvoice && hasValue(header.branch)) {
      sapPayload.BPL_IDAssignedToInvoice = normalizeBranchId(header.branch);
    }
    const contactPersonCode = toOptionalNumber(header.contactPerson);
    const shippingMethod = toOptionalNumber(header.shippingType);
    const documentsOwner = toOptionalNumber(header.ownerCode ?? header.owner);
    if (contactPersonCode !== undefined) sapPayload.ContactPersonCode = contactPersonCode;
    if (shippingMethod !== undefined) sapPayload.ShippingMethod = shippingMethod;
    if (documentsOwner !== undefined) sapPayload.DocumentsOwner = documentsOwner;
    Object.assign(sapPayload, buildDocumentConfirmationPayload(header));
    if (header.paymentTerms) sapPayload.PaymentGroupCode = parseInt(header.paymentTerms);
    if (header.paymentMethod) sapPayload.PaymentMethod = header.paymentMethod;
    if (header.freight) sapPayload.TotalExpenses = parseFloat(header.freight);
    Object.assign(sapPayload, buildDocumentRoundingPayload(header));
    if (salesPersonCode !== undefined) sapPayload.SalesPersonCode = salesPersonCode;
    assignElectronicDocumentPayload(sapPayload, header);
    const eWayBillDetails = await buildEWayBillDetailsPayload(payload.eway_bill_details);
    if (eWayBillDetails) sapPayload.EWayBillDetails = eWayBillDetails;

    applyUdfs(sapPayload, header_udfs, allowedHeaderUdfs, null, headerUdfDefinitionsByKey);

    console.log('[Delivery] Submit payload:', JSON.stringify(sapPayload, null, 2));

    // Post to SAP Service Layer
    const response = await sapService.request({
      method: 'POST',
      url: '/DeliveryNotes',
      data: sapPayload,
    });

    console.log('[Delivery] Submit response:', JSON.stringify(response.data, null, 2));

    const savedDocEntry = response.data.DocEntry;
    try {
      const savedLines = await deliveryDb.getSavedDeliveryQuantities(savedDocEntry);
      const requestedLines = lines
        .filter(l => String(l.itemNo || '').trim())
        .map((line, index) => ({
          lineNum: index,
          itemCode: line.itemNo || '',
          requestedQty: parseFloat(line.quantity) || 0,
          requestedBatchQty: Array.isArray(line.batches)
            ? line.batches.reduce((sum, batch) => sum + (parseFloat(batch.quantity) || 0), 0)
            : 0,
          uomCode: line.uomCode || '',
          warehouse: line.whse || '',
        }));

      const savedSummary = savedLines.map((savedLine) => {
        const requestedLine = requestedLines.find(
          (line) => line.lineNum === savedLine.lineNum || line.itemCode === savedLine.itemCode
        );

        return {
          lineNum: savedLine.lineNum,
          itemCode: savedLine.itemCode,
          warehouse: savedLine.warehouse,
          uomCode: savedLine.uomCode,
          requestedQty: requestedLine?.requestedQty ?? null,
          savedQty: savedLine.quantity,
          savedOpenQty: savedLine.openQty,
          requestedBatchQty: requestedLine?.requestedBatchQty ?? null,
          savedBatchQty: savedLine.batchQuantity,
        };
      });

      console.log(
        `[Delivery] Saved quantity check for DocEntry ${savedDocEntry}:`,
        JSON.stringify(savedSummary, null, 2)
      );
    } catch (logError) {
      console.warn(
        `[Delivery] Could not read saved quantities for DocEntry ${savedDocEntry}: ${logError.message}`
      );
    }

    return {
      success: true,
      message: 'Delivery created successfully.',
      doc_entry: response.data.DocEntry,
      doc_num: response.data.DocNum,
    };
  } catch (error) {
    console.error('[Delivery] Submit failed:', error.message);
    if (error.response?.data) {
      console.error('[Delivery] SAP error response:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
};

// ───────── UPDATE DELIVERY (USING SERVICE LAYER) ─────────

const updateDelivery = async (docEntry, payload) => {
  const confirmationResult = await updateDocumentConfirmationOnly(docEntry, payload, 'DeliveryNotes', sapService);
  if (confirmationResult) return confirmationResult;
  try {
    const bpSelectionPolicy = await getDocumentBpSelectionPolicy('delivery');
    if (bpSelectionPolicy) {
      const existing = await deliveryDb.getDelivery(docEntry);
      assertDocumentBpSelection(bpSelectionPolicy, resolveHeaderCustomerCode(payload.header || {}), {
        existingCode: existing?.delivery?.header?.customerCode,
      });
    }
    const includeDocumentLines = payload.include_document_lines === true;
    const validationResult = await validateDeliveryDocument({
      ...payload,
      _isUpdate: true,
      validateDocumentLines: includeDocumentLines,
    });
    if (!validationResult.isValid) {
      const error = new Error(validationResult.errors.join('\n'));
      error.statusCode = 400;
      throw error;
    }

    const { lines, header_udfs } = payload;
    const header = normalizeHeaderBranch(payload.header);
    const documentAdditionalExpenses = buildDocumentAdditionalExpenses(payload.freightCharges);
    const resolvedReferenceDocuments = payload.reference_documents_changed
      ? await resolveReferenceDocumentsForSubmit(payload.reference_documents, lines)
      : [];
    const documentReferences = payload.reference_documents_changed
      ? buildDocumentReferencesPayload(resolvedReferenceDocuments, {
          defaultObjectType: resolveDefaultReferenceObjectType(lines),
        })
      : [];
    const hasDocumentReferences = documentReferences.length > 0;
    const [documentLines, headerUdfDefinitionsByKey] = await Promise.all([
      includeDocumentLines ? buildDocumentLinesPayload(lines, true, false) : Promise.resolve([]),
      getUdfDefinitionsByKey('ODLN'),
    ]);
    const allowedHeaderUdfs = new Set(headerUdfDefinitionsByKey.keys());
    const salesEmployees = await deliveryDb.getSalesEmployees();
    const salesPersonCode = resolveSalesEmployeeCode(
      header.salesEmployee ?? header.purchaser,
      salesEmployees,
    );

    const sapPayload = {
      Comments: header.otherInstruction || '',
      JournalMemo: header.journalRemark || '',
      DiscountPercent: header.discount ? parseFloat(header.discount) : 0,
      DocumentAdditionalExpenses: documentAdditionalExpenses,
      ...buildMarketingDocumentAddressPayload(header, { shipAddressField: 'Address2', billAddressField: 'Address' }),
      ...(hasDocumentReferences ? { DocumentReferences: documentReferences } : {}),
    };
    if (includeDocumentLines) sapPayload.DocumentLines = documentLines;
    Object.assign(sapPayload, buildDocumentConfirmationPayload(header));
    const currencyReferenceData = await loadDocumentCurrencyReferenceData(header);
    applySapDocumentCurrency(sapPayload, header, currencyReferenceData);

    if (header.paymentMethod) sapPayload.PaymentMethod = header.paymentMethod;
    if (header.freight) sapPayload.TotalExpenses = parseFloat(header.freight);
    Object.assign(sapPayload, buildDocumentRoundingPayload(header));
    if (salesPersonCode !== undefined) sapPayload.SalesPersonCode = salesPersonCode;
    assignElectronicDocumentPayload(sapPayload, header);
    const eWayBillDetails = await buildEWayBillDetailsPayload(payload.eway_bill_details);
    if (eWayBillDetails) sapPayload.EWayBillDetails = eWayBillDetails;

    applyUdfs(sapPayload, header_udfs, allowedHeaderUdfs, null, headerUdfDefinitionsByKey);

    await sapService.request({
      method: 'PATCH',
      url: `/DeliveryNotes(${docEntry})`,
      data: sapPayload,
    });

    return {
      success: true,
      message: 'Delivery updated successfully.',
      doc_entry: docEntry,
    };
  } catch (error) {
    throw error;
  }
};

const getFreightCharges = async (docEntry) => {
  try {
    const freightCharges = await deliveryDb.getFreightCharges(docEntry);
    return { freightCharges };
  } catch (error) {
    console.error('[Delivery Service] Failed to get freight charges:', error);
    return { freightCharges: [] };
  }
};

const createLookupValue = async ({ field, value, description }) => {
  const fieldMap = {
    buyerQuality: 'U_Buyer_Quality',
    sellerQuality: 'U_Seller_Quality',
    buyerPrice: 'U_Buyer_Price',
    sellerPrice: 'U_Seller_Price',
  };

  const aliasId = fieldMap[String(field || '').trim()] || String(field || '').trim();
  if (!aliasId) {
    throw new Error('Lookup field is required.');
  }

  const option = await deliveryDb.createLookupValue(aliasId, value, description);
  const options = await deliveryDb.getLookupValues(aliasId);

  return { option, options };
};

const getItemsForModal = async (whsCode = '') => {
  try {
    const items = await deliveryDb.getItemsForModal(whsCode);
    return { items };
  } catch (error) {
    console.error('[Delivery Service] Failed to get items for modal:', error);
    return { items: [] };
  }
};

const getUomConversionFactor = async (itemCode, uomCode) => {
  try {
    const result = await deliveryDb.getUomConversionFactor(itemCode, uomCode);
    return result;
  } catch (error) {
    console.error('[Delivery Service] Failed to get UoM conversion factor:', error);
    return {
      inventoryUOM: '',
      uomCode: uomCode,
      baseQty: 1,
      altQty: 1,
      factor: 1
    };
  }
};

// // ───────── EXPORTS ─────────

// module.exports = {
//   getReferenceData,
//   getCustomerDetails,
//   getDeliveryList,
//   getDelivery,
//   submitDelivery,
//   updateDelivery,
//   getDocumentSeries,
//   getNextNumber,
//   getStateFromWarehouse,
//   getOpenSalesOrders,
//   getSalesOrderForCopy,
//   getBatchesByItem,
//   getFreightCharges,
//   validateDeliveryDocument,
// };

// ─── Validation Service Functions ───────────────────────────────────────────────

const validateDeliveryDocument = async (payload) => {
  const header = normalizeHeaderBranch(payload.header);
  const { lines } = payload;
  const isUpdate = Boolean(payload._isUpdate);
  const validateDocumentLines = !isUpdate || payload.validateDocumentLines !== false;
  const documentLines = (lines || []).filter((line) => hasValue(line.itemNo));
  const customerCode = resolveHeaderCustomerCode(header);
  const errors = [];
  
  // 1. Mandatory fields validation
  if (!customerCode) {
    errors.push('Customer Code is required');
  }
  if (!header.postingDate) {
    errors.push('Posting Date is required');
  }
  if (!header.documentDate) {
    errors.push('Document Date is required');
  }
  if (validateDocumentLines && !documentLines.length) {
    errors.push('At least one document line is required');
  }

  if (!isUpdate && hasValue(header.currency)) {
    const companyCurrencyRows = salesOrderDb.getCompanyCurrencyInfo
      ? await salesOrderDb.getCompanyCurrencyInfo()
      : [];
    const localCurrency = String(companyCurrencyRows?.[0]?.MainCurncy || '').trim();
    const documentCurrency = String(header.currency || '').trim();
    if (localCurrency && documentCurrency !== localCurrency) {
      const exchangeRate = Number(header.exchangeRate);
      if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
        errors.push(`A positive exchange rate is required for ${documentCurrency}`);
      }
    }
  }
  
  if (errors.length > 0) {
    return { isValid: false, errors };
  }
  
  // 2. Branch validation is optional for databases without branch setup.
  if (hasValue(header.branch)) {
    const branchResult = await deliveryDb.validateBranch(header.branch);
    if (!branchResult.isValid) {
      errors.push(...branchResult.errors);
    }
  }
  
  // 3. Series validation
  if ((!isUpdate || hasValue(header.series)) && !isManualDocumentSeries(header.series)) {
    const seriesResult = await deliveryDb.validateSeries(header.series, header.branch, header.postingDate);
    if (!seriesResult.isValid) {
      errors.push(...seriesResult.errors);
    }
  }
  
  // 4. Warehouse-Branch validation for all lines
  for (const line of validateDocumentLines ? documentLines : []) {
    if (line.whse && header.branch) {
      const whResult = await deliveryDb.validateWarehouseBranch(line.whse, header.branch);
      if (!whResult.isValid) {
        errors.push(...whResult.errors);
      }
    }
  }

  // 5. SAP B1 live master-data validation for item, UoM, HSN, warehouse, price and tax.
  if (validateDocumentLines) {
    const baseDocumentResult = await deliveryDb.validateDeliveryBaseDocumentLines(documentLines, customerCode);
    if (!baseDocumentResult.isValid) errors.push(...baseDocumentResult.errors);

    const masterDataResult = await deliveryDb.validateLineMasterData(documentLines);
    if (!masterDataResult.isValid) errors.push(...masterDataResult.errors);

    const udfResult = await deliveryDb.validateLineUdfValues(documentLines);
    if (!udfResult.isValid) errors.push(...udfResult.errors);

    const taxResult = deliveryDb.validateTaxCodes(documentLines);
    if (!taxResult.isValid) errors.push(...taxResult.errors);

    if (!isUpdate) {
      const stockResult = await deliveryDb.validateStockAvailability(documentLines);
      if (!stockResult.isValid) errors.push(...stockResult.errors);

      const batchResult = await deliveryDb.validateBatchSelection(documentLines);
      if (!batchResult.isValid) errors.push(...batchResult.errors);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  getReferenceData,
  getCustomerDetails,
  saveSalesEmployeesSetup,
  getCustomerFilterOptions,
  getDeliveryList,
  getDelivery,
  getDocumentSeries,
  getNextNumber,
  getStateFromWarehouse,
  getOpenSalesOrders,
  getSalesOrderForCopy,
  getOpenArReserveInvoices,
  getArReserveInvoiceForCopy,
  getDeliveryForCopyToCreditMemo,
  getBatchesByItem,
  getAvailableSerials,
  getAvailableBins,
  getItemsForModal,
  getUomConversionFactor,
  getFreightCharges,
  createLookupValue,
  validateDeliveryDocument,
  submitDelivery,
  updateDelivery,
  _buildDocumentLinePayload: buildDocumentLinePayload,
};
