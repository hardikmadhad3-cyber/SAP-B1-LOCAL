const { buildDocumentConfirmationPayload, updateDocumentConfirmationOnly } = require('./documentConfirmationUtils');
const sapService = require('./sapService');
const salesOrderDb = require('./salesOrderDbService');
const hsnCodeDbService = require('./hsnCodeDbService');
const { buildDocumentAdditionalExpenses } = require('./freightPayloadUtils');
const { getActiveCompanyConfig } = require('./companyConfigService');
const { getDocumentBpSelectionPolicy, assertDocumentBpSelection } = require('./documentBpSelectionPolicy');

const resolveHeaderCustomerCode = (header = {}) =>
  String(header.vendor || header.customerCode || header.customer || header.CardCode || '').trim();
const { getUdfDefinitionsOrEmpty } = require('./udfMetadataService');
const { isBlankUdfValue, normalizeUdfValues } = require('./udfPayloadUtils');
const { buildDocumentSeriesPayload } = require('./documentSeriesPayloadUtils');
const { buildDocumentRoundingPayload } = require('./documentRoundingPayloadUtils');
const {
  applySapDocumentCurrency,
  normalizeCopyDocumentRateForCompany,
} = require('./salesDocumentCurrencyService');
const {
  fromSapStoredRate,
  normalizeRateSettings,
  toSapStoredRate,
} = require('./currencyRateUtils');

const normalizeBranchId = (branch) => {
  const normalized = String(branch ?? '').trim();
  const branchId = Number(normalized);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : undefined;
};

const getUdfDefinitionsByKey = async (tableId) => {
  const definitions = await getUdfDefinitionsOrEmpty(tableId);
  return new Map(definitions.map((field) => [field.key, field]));
};

const validateRequiredBranchAndWarehouse = (payload = {}, options = {}) => {
  const header = payload.header || {};
  if (options.branchesEnabled && !String(header.branch || '').trim()) {
    throw new Error('Branch is required.');
  }

  if (!String(header.warehouse || '').trim()) {
    throw new Error('Warehouse is required.');
  }

  const lines = (payload.lines || []).filter((line) => String(line.itemNo || '').trim());
  for (let index = 0; index < lines.length; index += 1) {
    if (!String(lines[index].whse || header.warehouse || '').trim()) {
      throw new Error(`Line ${index + 1}: Warehouse is required.`);
    }
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null);
const isTruthyFlag = (value) => (['Y', 'YES', 'TRUE', '1', 'TYES'].includes(String(value ?? '').trim().toUpperCase()));
const hasFieldMetadata = (fieldMetadata, fieldName) => Object.keys(fieldMetadata || {}).some(
  (key) => String(key).trim().toLowerCase() === String(fieldName).trim().toLowerCase(),
);
const toSapString = (value) => (value === undefined || value === null ? undefined : String(value));
const addIfPresent = (target, key, value) => {
  if (value === undefined || value === null) return;
  target[key] = String(value);
};

const mergeCompanyCurrencyRows = ({
  currencies = [],
  localCurrency = '',
  systemCurrency = '',
} = {}) => {
  const byCode = new Map();
  const addCurrency = (currency = {}) => {
    const code = String(currency.CurrCode || currency.Code || '').trim();
    if (!code) return;
    const key = code.toUpperCase();
    const name = String(currency.CurrName || currency.Name || code).trim() || code;
    const existing = byCode.get(key);
    if (!existing || existing.CurrName === existing.CurrCode) {
      byCode.set(key, { CurrCode: code, CurrName: name });
    }
  };

  (Array.isArray(currencies) ? currencies : []).forEach(addCurrency);
  addCurrency({ CurrCode: localCurrency, CurrName: localCurrency });
  addCurrency({ CurrCode: systemCurrency, CurrName: systemCurrency });

  return [...byCode.values()]
    .sort((left, right) => left.CurrCode.localeCompare(right.CurrCode));
};

const resolveSalesOrderDocumentCurrency = (header = {}, referenceData = {}) => {
  const explicitCurrency = String(
    header.currency || header.DocCurrency || header.DocCur || '',
  ).trim();
  if (explicitCurrency) return explicitCurrency;

  const mode = String(header.currencyMode || 'BP').trim().toUpperCase();
  const localCurrency = String(referenceData.local_currency || '').trim();
  const systemCurrency = String(referenceData.system_currency || localCurrency).trim();
  if (mode === 'LOCAL') return localCurrency;
  if (mode === 'SYSTEM') return systemCurrency;

  const cardCode = String(header.vendor || header.customerCode || header.CardCode || '').trim();
  const businessPartner = (referenceData.vendors || referenceData.customers || []).find(
    (partner) => String(partner.CardCode || '').trim() === cardCode,
  );
  const businessPartnerCurrency = String(businessPartner?.Currency || '').trim();
  return businessPartnerCurrency && businessPartnerCurrency !== '##'
    ? businessPartnerCurrency
    : localCurrency;
};

const ADDRESS_EXTENSION_FIELDS = {
  ShipTo: {
    streetPoBox: 'ShipToStreet',
    streetNo: 'ShipToStreetNo',
    buildingFloorRoom: 'ShipToBuilding',
    block: 'ShipToBlock',
    city: 'ShipToCity',
    zipCode: 'ShipToZipCode',
    county: 'ShipToCounty',
    state: 'ShipToState',
    countryRegion: 'ShipToCountry',
    addressName2: 'ShipToAddress2',
    addressName3: 'ShipToAddress3',
    gln: 'ShipToGlobalLocationNumber',
  },
  BillTo: {
    streetPoBox: 'BillToStreet',
    streetNo: 'BillToStreetNo',
    buildingFloorRoom: 'BillToBuilding',
    block: 'BillToBlock',
    city: 'BillToCity',
    zipCode: 'BillToZipCode',
    county: 'BillToCounty',
    state: 'BillToState',
    countryRegion: 'BillToCountry',
    addressName2: 'BillToAddress2',
    addressName3: 'BillToAddress3',
    gln: 'BillToGlobalLocationNumber',
  },
};

const addAddressExtensionFields = (target, prefix, components = {}) => {
  const fieldMap = ADDRESS_EXTENSION_FIELDS[prefix] || {};
  Object.entries(fieldMap).forEach(([sourceKey, sapKey]) => {
    if (hasOwn(components, sourceKey)) {
      target[sapKey] = String(components[sourceKey] ?? '');
    }
  });
};

const buildSalesOrderAddressPayload = (header = {}) => {
  const addressPayload = {};
  const shipToCode = firstPresent(header.shipToCode);
  const payToCode = firstPresent(header.billToCode, header.payToCode);
  const shipToAddress = firstPresent(header.shipToAddress, header.shipTo);
  const billToAddress = firstPresent(header.billToAddress, header.payTo);

  addIfPresent(addressPayload, 'ShipToCode', shipToCode);
  addIfPresent(addressPayload, 'PayToCode', payToCode);
  if (shipToAddress !== undefined) addressPayload.Address = toSapString(shipToAddress);
  if (billToAddress !== undefined) addressPayload.Address2 = toSapString(billToAddress);

  const addressExtension = {};
  addAddressExtensionFields(addressExtension, 'ShipTo', header.shipToAddressComponents);
  addAddressExtensionFields(addressExtension, 'BillTo', header.billToAddressComponents);
  if (Object.keys(addressExtension).length) {
    addressPayload.AddressExtension = addressExtension;
  }

  return addressPayload;
};

/**
 * Convert Sales Employee name to code using ODBC data
 * @param {string|number} input - Sales Employee name or code
 * @param {Array} salesEmployees - Sales employees from ODBC
 * @returns {Promise<number|null>} SlpCode or null if ignored
 */
const DOCUMENT_REFERENCE_TYPES = [
  { value: '22', label: 'Purchase Order', serviceLayer: 'rot_PurchaseOrder' },
  { value: '17', label: 'Sales Order', serviceLayer: 'rot_SalesOrder' },
  { value: '15', label: 'Delivery', serviceLayer: 'rot_DeliveryNotes' },
  { value: '13', label: 'A/R Invoice', serviceLayer: 'rot_SalesInvoice' },
  { value: '14', label: 'A/R Credit Memo', serviceLayer: 'rot_SalesCreditNote' },
  { value: '23', label: 'Sales Quotation', serviceLayer: 'rot_SalesQuotation' },
  { value: '20', label: 'Goods Receipt PO', serviceLayer: 'rot_PurchaseDeliveryNotes' },
  { value: '18', label: 'A/P Invoice', serviceLayer: 'rot_PurchaseInvoice' },
  { value: '19', label: 'A/P Credit Memo', serviceLayer: 'rot_PurchaseCreditNote' },
  { value: '1470000113', label: 'Purchase Request', serviceLayer: 'rot_PurchaseRequest' },
  { value: '540000006', label: 'Purchase Quotation', serviceLayer: 'rot_PurchaseQuotation' },
];

const normalizeReferenceDocType = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const match = DOCUMENT_REFERENCE_TYPES.find((type) => (
    type.value === normalized ||
    type.label.toLowerCase() === normalized.toLowerCase() ||
    type.serviceLayer.toLowerCase() === normalized.toLowerCase()
  ));
  return match?.value || normalized;
};

const toOptionalReferenceNumber = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const buildDocumentReferencesPayload = (references = []) => {
  if (!Array.isArray(references)) return [];

  return references
    .filter((row) => String(row?.direction || 'to').toLowerCase() !== 'by')
    .map((row) => {
      const referencedObjectType = normalizeReferenceDocType(
        row.transactionType || row.referencedObjectType || row.RefObjType
      );
      const referencedDocEntry = toOptionalReferenceNumber(row.docEntry || row.referencedDocEntry || row.RefDocEntr);
      const referencedDocNumber = toOptionalReferenceNumber(row.docNumber || row.referencedDocNumber || row.RefDocNum);
      const externalReferencedDocNumber = String(
        row.extDocNumber || row.externalDocNumber || row.ExtDocNum || ''
      ).trim();

      if (!referencedObjectType || (!referencedDocEntry && !referencedDocNumber && !externalReferencedDocNumber)) {
        return null;
      }

      return {
        RefObjType: referencedObjectType,
        ...(referencedDocEntry !== undefined ? { RefDocEntr: referencedDocEntry } : {}),
        ...(referencedDocNumber !== undefined ? { RefDocNum: referencedDocNumber } : {}),
        ...(externalReferencedDocNumber ? { ExtDocNum: externalReferencedDocNumber } : {}),
        ...(row.issueDate ? { IssueDate: row.issueDate } : {}),
        ...(row.remark ? { Remark: row.remark } : {}),
      };
    })
    .filter(Boolean);
};

const convertSalesEmployeeToCode = async (input, salesEmployees = []) => {
  console.log('ðŸ” convertSalesEmployeeToCode called with input:', input, 'Type:', typeof input);
  
  // Handle empty or -1 values
  if (!input || input === '-1' || input === -1 || String(input).trim() === '') {
    console.log('ðŸ”¹ Sales Employee: Ignored (empty or -1)');
    return null;
  }

  // If numeric (and not -1), treat as SlpCode
  if (!isNaN(input) && Number(input) !== -1) {
    const code = Number(input);
    console.log('ðŸ”¹ Sales Employee: Using existing code', code);
    return code;
  }

  // It's a name, search in ODBC data first
  const name = String(input).trim();
  
  console.log('ðŸ” Searching for Sales Employee in ODBC data:', name);
  console.log('ðŸ” Available Sales Employees:', salesEmployees.map(e => e.SlpName).join(', '));
  
  // Search in ODBC data (case-insensitive)
  const found = salesEmployees.find(emp => 
    String(emp.SlpName || '').trim().toLowerCase() === name.toLowerCase()
  );
  
  if (found) {
    console.log('âœ… Sales Employee found in ODBC data:', name, 'â†’ Code:', found.SlpCode);
    return found.SlpCode;
  }

  // Not found in ODBC data, try Service Layer API
  console.log('âš ï¸ Sales Employee not found in ODBC data, trying Service Layer API...');
  
  const escapedName = name.replace(/'/g, "''");

  try {
    const searchResult = await sapService.request({
      method: 'get',
      url: `/SalesPersons?$filter=SalesEmployeeName eq '${escapedName}'&$select=SalesEmployeeCode,SalesEmployeeName`,
    });

    console.log('ðŸ” Service Layer search result:', JSON.stringify(searchResult.data, null, 2));

    if (searchResult.data?.value?.length > 0) {
      const slpCode = searchResult.data.value[0].SalesEmployeeCode;
      console.log('âœ… Sales Employee found via Service Layer:', name, 'â†’ Code:', slpCode);
      return slpCode;
    }

    // Not found, create new one
    console.log('âž• Creating new Sales Employee:', name);
    
    const createResult = await sapService.request({
      method: 'post',
      url: '/SalesPersons',
      data: {
        SalesEmployeeName: name,
        Active: 'tYES',
      },
    });

    const newSlpCode = createResult.data?.SalesEmployeeCode;
    console.log('âœ… Sales Employee created:', name, 'â†’ Code:', newSlpCode);
    
    return newSlpCode;

  } catch (error) {
    console.error('âŒ Failed to get/create Sales Employee:', name);
    console.error('Error:', error.response?.data || error.message);
    throw new Error(`Sales Employee '${name}' could not be created: ${error.message}`);
  }
};

/**
 * Convert Owner name to empID using ODBC data
 * @param {string|number} input - Owner name or empID
 * @param {Array} owners - Owners from ODBC
 * @returns {Promise<number|null>} empID or null if not found
 */
const convertOwnerToCode = async (input, owners = []) => {
  console.log('ðŸ” convertOwnerToCode called with input:', input, 'Type:', typeof input);
  
  // Handle empty values
  if (!input || String(input).trim() === '') {
    console.log('ðŸ”¹ Owner: Ignored (empty)');
    return null;
  }

  // If numeric, treat as empID
  if (!isNaN(input)) {
    const code = Number(input);
    console.log('ðŸ”¹ Owner: Using existing empID', code);
    return code;
  }

  // It's a name, search in ODBC data first
  const name = String(input).trim();
  
  // Search in ODBC data (check FullName, firstName, lastName)
  const found = owners.find(owner => {
    const fullName = String(owner.FullName || '').trim().toLowerCase();
    const firstName = String(owner.firstName || '').trim().toLowerCase();
    const lastName = String(owner.lastName || '').trim().toLowerCase();
    const searchName = name.toLowerCase();
    
    return fullName === searchName || 
           firstName === searchName || 
           lastName === searchName;
  });
  
  if (found) {
    console.log('âœ… Owner found in ODBC data:', name, 'â†’ empID:', found.empID);
    return found.empID;
  }

  // Not found in ODBC data, try Service Layer API
  console.log('âš ï¸ Owner not found in ODBC data, trying Service Layer API...');
  
  const escapedName = name.replace(/'/g, "''");

  try {
    const searchResult = await sapService.request({
      method: 'get',
      url: `/EmployeesInfo?$filter=FirstName eq '${escapedName}' or LastName eq '${escapedName}'&$select=EmployeeID,FirstName,LastName`,
    });

    console.log('ðŸ” Service Layer search result:', JSON.stringify(searchResult.data, null, 2));

    if (searchResult.data?.value?.length > 0) {
      const empID = searchResult.data.value[0].EmployeeID;
      console.log('âœ… Owner found via Service Layer:', name, 'â†’ empID:', empID);
      return empID;
    }

    console.log('âš ï¸ Owner not found:', name, '(Owner is optional, continuing without it)');
    return null;

  } catch (error) {
    console.warn('âš ï¸ Failed to search for Owner:', name);
    console.warn('Error:', error.response?.data || error.message);
    return null; // Owner is optional, don't fail the whole operation
  }
};

const formatDateForInput = (value) => {
  if (!value) return '';
  return String(value).split('T')[0];
};

const formatDocumentStatus = (value) => {
  const normalized = String(value || '').trim();
  if (normalized === 'bost_Open') return 'Open';
  if (normalized === 'bost_Close') return 'Closed';
  if (normalized === 'bost_Paid') return 'Paid';
  return normalized;
};

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const toOptionalNumber = (value) => {
  if (!hasValue(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toSapYesNo = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(normalized) ? 'tYES' : 'tNO';
};

const toRequiredNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getHeaderDiscountPercent = (header = {}) => {
  const rawValue = header.discount ?? header.DiscountPercent ?? header.DiscPrcnt;
  if (rawValue === undefined || rawValue === null) return undefined;
  const textValue = String(rawValue).replace(/,/g, '').trim();
  if (!textValue) return 0;
  const parsed = Number(textValue);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const toRequiredString = (value, fallback = '') => {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || fallback;
};

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

const getExplicitLineDiscountAmount = (line = {}) => (
  line.discountAmount ?? line.DiscountAmount ?? line.U_Rate ?? line.udf?.U_Rate
);

const getLineDiscountAmount = (line = {}) => {
  const explicitDiscountAmount = getExplicitLineDiscountAmount(line);
  if (hasValue(explicitDiscountAmount)) {
    return toRequiredNumber(explicitDiscountAmount, 0);
  }

  const unitPrice = toRequiredNumber(line.unitPrice ?? line.UnitPrice ?? line.Price, 0);
  const discountPercent = toRequiredNumber(line.stdDiscount ?? line.DiscountPercent ?? line.DiscPrcnt, 0);
  return unitPrice * discountPercent / 100;
};

const getLineDiscountPercent = (line = {}) => {
  const explicitPercent = toOptionalNumber(line.stdDiscount ?? line.DiscountPercent ?? line.DiscPrcnt);
  if (explicitPercent !== undefined) return explicitPercent;

  const unitPrice = toRequiredNumber(line.unitPrice ?? line.UnitPrice ?? line.Price, 0);
  if (unitPrice <= 0) return 0;
  return getLineDiscountAmount(line) * 100 / unitPrice;
};

const hasLineDiscountValue = (line = {}) => [
  line.discountAmount,
  line.DiscountAmount,
  line.U_Rate,
  line.udf?.U_Rate,
  line.stdDiscount,
  line.DiscountPercent,
  line.DiscPrcnt,
].some(hasValue);

const getLineForRate = (line = {}) => (
  line.forRate ??
  line.ForRate ??
  line.FORRate ??
  line.U_ForRate ??
  line.U_FORRATE ??
  line.U_FOR_RATE ??
  line.udf?.U_ForRate ??
  line.udf?.U_FORRATE ??
  line.udf?.U_FOR_RATE
);

const firstLineValueByAliases = (line = {}, aliases = []) => {
  for (const alias of aliases) {
    const value = line?.[alias] ?? line?.udf?.[alias];
    if (hasValue(value)) return value;
  }
  return undefined;
};

const SALES_ORDER_LINE_UDF_MAPPINGS = [
  { sapField: 'U_CostSheet', skipBlank: true, getValue: (line) => firstLineValueByAliases(line, ['U_CostSheet', 'U_Cost_Sheet', 'U_COSTSHEET', 'costSheet']) },
  { sapField: 'U_PackingType', skipBlank: true, getValue: (line) => firstLineValueByAliases(line, ['U_PackingType', 'U_PACKINGTYPE', 'U_Packing_Type', 'U_PackingStatus', 'packingType']) },
  { sapField: 'U_ContainerType', skipBlank: true, getValue: (line) => firstLineValueByAliases(line, ['U_ContainerType', 'U_CONTAINERTYPE', 'U_Container_Type', 'containerType']) },
  { sapField: 'U_GrossWt', skipBlank: true, getValue: (line) => firstLineValueByAliases(line, ['U_GrossWt', 'U_GROSSWT', 'U_Gross_Wt', 'U_GrossWeight', 'grossWt']) },
  { sapField: 'U_TotalPackage', skipBlank: true, getValue: (line) => firstLineValueByAliases(line, ['U_TotalPackage', 'U_TOTALPACKAGE', 'U_Total_Package', 'U_TotalPackge', 'totalPackage']) },
  { sapField: 'U_TAXCODE', skipBlank: true, getValue: (line) => firstLineValueByAliases(line, ['U_TAXCODE', 'U_TaxCode', 'taxCodeRepeat', 'taxCode']) },
  {
    sapField: 'U_PRICE',
    skipBlank: true,
    getValue: (line) => {
      const explicitValue = firstLineValueByAliases(line, ['U_PRICE', 'U_Price', 'price']);
      if (hasValue(explicitValue)) return explicitValue;
      return line.bomType === 'S' && line.bomRole === 'parent'
        ? line.unitPrice
        : undefined;
    },
  },
  { sapField: 'U_SPLRBT', getValue: (line) => firstLineValueByAliases(line, ['specialRebate', 'U_SPLRBT', 'U_SpecialRebate']) },
  { sapField: 'U_COMPRC', getValue: (line) => firstLineValueByAliases(line, ['commission', 'commision', 'U_COMPRC', 'U_Commision', 'U_Commission']) },
  { sapField: 'U_S_BrokPerQty', getValue: (line) => firstLineValueByAliases(line, ['sellerBrokeragePerQty', 'brokPerQty', 'U_S_BrokPerQty', 'U_S_BROKPERQTY']) },
  {
    sapField: 'U_Unit_Price',
    getValue: (line) => {
      if (hasValue(line.unitPriceUdf)) return line.unitPriceUdf;
      return line.bomType === 'S' && line.bomRole === 'parent'
        ? line.unitPrice
        : undefined;
    },
  },
  { sapField: 'U_Rate', getValue: (line) => (hasLineDiscountValue(line) ? getLineDiscountAmount(line) : undefined) },
  { sapField: 'U_ForRate', getValue: getLineForRate },
  { sapField: 'U_FORRATE', getValue: getLineForRate },
  { sapField: 'U_FOR_RATE', getValue: getLineForRate },
  { sapField: 'U_For_Rate', getValue: getLineForRate },
  { sapField: 'U_Brok_Seller', getValue: (line) => firstLineValueByAliases(line, ['sellerBrokerage', 'U_Brok_Seller', 'U_BROK_SELLER']) },
  { sapField: 'U_Brok_Buyer', getValue: (line) => firstLineValueByAliases(line, ['buyerBrokerage', 'U_Brok_Buyer', 'U_BROK_BUYER', 'U_Buyer_Brokerage']) },
  { sapField: 'U_Buyer_Delivery', getValue: (line) => firstLineValueByAliases(line, ['buyerDelivery', 'U_Buyer_Delivery', 'U_BUYER_DELIVERY']) },
  { sapField: 'U_Seller_Delivery', getValue: (line) => firstLineValueByAliases(line, ['sellerDelivery', 'U_Seller_Delivery', 'U_SELLER_DELIVERY']) },
  { sapField: 'U_Buyer_Payment_Terms', getValue: (line) => firstLineValueByAliases(line, ['buyerPaymentTerms', 'buyerTermsOfPayment', 'U_Buyer_Payment_Terms', 'U_BUYER_PAYMENT_TERMS']) },
  { sapField: 'U_Seller_Payment_Term', getValue: (line) => firstLineValueByAliases(line, ['sellerPaymentTerms', 'sellerPaymentTermsRepeat', 'sellerTermsOfPayment', 'U_Seller_Payment_Term', 'U_Seller_Payment_Terms', 'U_SELLER_PAYMENT_TERM', 'U_SELLER_PAYMENT_TERMS']) },
  { sapField: 'U_Buyer_Quality', getValue: (line) => firstLineValueByAliases(line, ['buyerQuality', 'U_Buyer_Quality', 'U_BUYER_QUALITY']) },
  { sapField: 'U_Seller_Quality', getValue: (line) => firstLineValueByAliases(line, ['sellerQuality', 'U_Seller_Quality', 'U_SELLER_QUALITY']) },
  { sapField: 'U_Buyer_Price', getValue: (line) => firstLineValueByAliases(line, ['buyerPrice', 'U_Buyer_Price', 'U_BUYER_PRICE']) },
  { sapField: 'U_Seller_Price', getValue: (line) => firstLineValueByAliases(line, ['sellerPrice', 'U_Seller_Price', 'U_SELLER_PRICE']) },
  { sapField: 'U_Seller_SPINS', getValue: (line) => firstLineValueByAliases(line, ['sellerSpecialInstruction', 'qtySpecialInstruction', 'U_Seller_SPINS', 'U_SELLER_SPINS']) },
  { sapField: 'U_Buyer_SPINS', getValue: (line) => firstLineValueByAliases(line, ['buyerSpecialInstruction', 'deliverySpecialInstruction', 'U_Buyer_SPINS', 'U_BUYER_SPINS']) },
  { sapField: 'U_Sel_Brok_AP', getValue: (line) => firstLineValueByAliases(line, ['sellerBrokerageAmtPer', 'sellerBrokerageAmountPer', 'U_Sel_Brok_AP', 'U_SEL_BROK_AP']) },
  { sapField: 'U_Seller_Brok_Per', getValue: (line) => firstLineValueByAliases(line, ['sellerBrokeragePercent', 'sellerBrokeragePercentage', 'U_Seller_Brok_Per', 'U_SELLER_BROK_PER']) },
  { sapField: 'U_Buyer_Bill_Disc', getValue: (line) => line.buyerBillDiscount },
  { sapField: 'U_Seller_Bill_Disc', getValue: (line) => line.sellerBillDiscount },
  { sapField: 'U_SELLTCODE', getValue: (line) => firstLineValueByAliases(line, ['stcode', 'STCODE', 'U_SELLTCODE', 'U_STCODE']) },
  { sapField: 'U_S_Item', getValue: (line) => firstLineValueByAliases(line, ['sellerItem', 'U_S_Item', 'U_S_ITEM', 'U_SItem']) },
  { sapField: 'U_S_Qty', getValue: (line) => firstLineValueByAliases(line, ['sellerQty', 'sellerQuantity', 'U_S_Qty', 'U_S_QTY']) },
  { sapField: 'U_Fix_Brock_B', skipBlank: true, getValue: (line) => firstLineValueByAliases(line, ['U_Fix_Brock_B', 'U_Fix_Brok_B', 'U_FIX_BROK_BUYER', 'U_FIXBROKBUYER', 'fixBrokBuyer']) },
  { sapField: 'U_Fix_Brock_S', skipBlank: true, getValue: (line) => firstLineValueByAliases(line, ['U_Fix_Brock_S', 'U_Fix_Brok_S', 'U_Fix_Brock_Seller', 'U_FIXBROCKSELLER', 'U_FIXBROKSELLER', 'fixBrockSeller']) },
  { sapField: 'U_Freight_pur', getValue: (line) => line.freightPurchase },
  { sapField: 'U_Freight_sales', getValue: (line) => line.freightSales },
  { sapField: 'U_Fr_trans', getValue: (line) => line.freightProvider },
  { sapField: 'U_Fr_trans_name', getValue: (line) => line.freightProviderName },
  { sapField: 'U_BDNum', getValue: (line) => line.brokerageNumber },
  { sapField: 'U_DocKey', getValue: (line, context) => context.docEntry },
  { sapField: 'U_ItemCode', getValue: (line) => line.itemNo },
  { sapField: 'U_Item_Desc', getValue: (line) => line.itemDescription },
  { sapField: 'U_UoM', getValue: (line) => (line.uomNameEdited ? line.uomName : (line.uomName || line.uomCode)) },
];

const normalizeSapUdfFieldName = (value) => String(value || '').trim().toUpperCase();
const compactSapUdfFieldName = (value) => normalizeSapUdfFieldName(value).replace(/[^A-Z0-9]/g, '');

const GENERIC_LINE_UDF_SKIP_KEYS = new Set([
  ...SALES_ORDER_LINE_UDF_MAPPINGS.map((mapping) => normalizeSapUdfFieldName(mapping.sapField)),
  'U_SELLER_PAYMENT_TERMS',
]);

const GENERIC_LINE_UDF_SKIP_FRAGMENTS = [
  'SAUDANODEREF',
  'SAUDANODHREF',
  'SAUDANODHNO',
  'APINVDOCKEY',
  'APINVDOCNUM',
  'APINVLINENUM',
  'ASSESSABLEVALUE',
  'BEDRATE',
  'BEDAMOUNT',
  'RG23DNO',
  'DOCUMENTCREATED',
];

const shouldSkipGenericLineUdf = (key) => {
  const normalized = normalizeSapUdfFieldName(key);
  const compact = compactSapUdfFieldName(key);
  return (
    GENERIC_LINE_UDF_SKIP_KEYS.has(normalized) ||
    GENERIC_LINE_UDF_SKIP_FRAGMENTS.some((fragment) => compact.includes(fragment))
  );
};

const setOptionalString = (target, field, value) => {
  if (hasValue(value)) {
    target[field] = String(value).trim();
  }
};

const setOptionalNumber = (target, field, value) => {
  const parsed = toOptionalNumber(value);
  if (parsed !== undefined) {
    target[field] = parsed;
  }
};

const firstAllowedUdfKey = (allowedHeaderUdfKeys = new Set(), aliases = []) => {
  const allowedKeys = Array.from(allowedHeaderUdfKeys || []);
  for (const alias of aliases) {
    if (allowedHeaderUdfKeys.has(alias)) return alias;

    const normalizedAlias = compactSapUdfFieldName(alias);
    const matchedKey = allowedKeys.find((key) => compactSapUdfFieldName(key) === normalizedAlias);
    if (matchedKey) return matchedKey;
  }
  return '';
};

const setOptionalHeaderUdf = (target, allowedHeaderUdfKeys, aliases, value) => {
  const field = firstAllowedUdfKey(allowedHeaderUdfKeys, aliases);
  if (!field || !hasValue(value)) return;
  target[field] = value;
};

const buildSalesOrderTaxHeaderUdfs = (header = {}, allowedHeaderUdfKeys = new Set()) => {
  const values = {};
  setOptionalHeaderUdf(values, allowedHeaderUdfKeys, ['U_TransCat', 'U_TransactionCategory'], header.transactionCategory);
  setOptionalHeaderUdf(values, allowedHeaderUdfKeys, ['U_FormNo', 'U_TaxFormNo'], header.taxFormNo);
  setOptionalHeaderUdf(values, allowedHeaderUdfKeys, ['U_DutyStatus'], header.dutyStatus);
  setOptionalHeaderUdf(values, allowedHeaderUdfKeys, ['U_Export', 'U_IsExport', 'U_Exported'], header.exportFlag ? 'Y' : 'N');
  setOptionalHeaderUdf(values, allowedHeaderUdfKeys, ['U_DiffPercent', 'U_DifferentialTaxRate', 'U_DiffTaxRate'], header.differentialTaxRate || '100');
  setOptionalHeaderUdf(values, allowedHeaderUdfKeys, ['U_SupplySec7', 'U_SupplUnSec', 'U_SupplyCovered'], header.supplyCovered === false ? 'N' : 'Y');
  return values;
};

const SALES_ORDER_TAX_INFO_UDF_ALIASES = {
  panNo: ['U_PANNo', 'U_PAN_No', 'U_PAN'],
  panCircleNo: ['U_PANCircleNo', 'U_PAN_Circle_No'],
  panWardNo: ['U_PANWardNo', 'U_PAN_Ward_No'],
  panAssessingOfficer: ['U_PANAssessingOfficer', 'U_PAN_Assessing_Officer'],
  deducteeRefNo: ['U_DeducteeRefNo', 'U_Deductee_Ref_No'],
  lstVatNo: ['U_LSTVATNo', 'U_LST_VAT_No', 'U_LSTVAT'],
  cstNo: ['U_CSTNo', 'U_CST_No'],
  tanNo: ['U_TANNo', 'U_TAN_No'],
  serviceTaxNo: ['U_ServiceTaxNo', 'U_Service_Tax_No'],
  companyType: ['U_CompanyType', 'U_Company_Type'],
  natureOfBusiness: ['U_NatureOfBusiness', 'U_Nature_Business'],
  assesseeType: ['U_AssesseeType', 'U_Assessee_Type'],
  tinNo: ['U_TINNo', 'U_TIN_No'],
  itrFiling: ['U_ITRFiling', 'U_ITR_Filing'],
  gstType: ['U_GSTType', 'U_GST_Type'],
  gstin: ['U_GSTIN', 'U_GSTINNo', 'U_GSTIN_No'],
};

const buildSalesOrderTaxInfoHeaderUdfs = (taxInfo = {}, allowedHeaderUdfKeys = new Set()) => {
  const values = {};
  Object.entries(SALES_ORDER_TAX_INFO_UDF_ALIASES).forEach(([key, aliases]) => {
    setOptionalHeaderUdf(values, allowedHeaderUdfKeys, aliases, taxInfo[key]);
  });
  return values;
};

const coerceValueForSqlType = (value, sqlDataType) => {
  if (!hasValue(value)) return undefined;

  const normalizedType = String(sqlDataType || '').trim().toLowerCase();

  if (NUMBER_DATA_TYPES.has(normalizedType)) {
    return toOptionalNumber(value);
  }

  if (DATE_DATA_TYPES.has(normalizedType)) {
    return formatDateForInput(value);
  }

  return String(value).trim();
};

const resolveMetadataFieldName = (fieldMetadata = {}, fieldName) => {
  if (fieldMetadata?.[fieldName]) return fieldName;
  const normalizedFieldName = compactSapUdfFieldName(fieldName);
  return Object.keys(fieldMetadata || {}).find((candidate) => compactSapUdfFieldName(candidate) === normalizedFieldName) || '';
};

const setValidatedRdr1Field = (target, fieldMetadata, fieldName, value) => {
  const resolvedFieldName = resolveMetadataFieldName(fieldMetadata, fieldName);
  const sqlDataType = fieldMetadata?.[resolvedFieldName];
  if (!sqlDataType) return;

  const coercedValue = coerceValueForSqlType(value, sqlDataType);
  if (coercedValue !== undefined) {
    target[resolvedFieldName] = coercedValue;
  }
};

const setValidatedRdr1Udf = (target, fieldMetadata, fieldName, value) => {
  const resolvedFieldName = resolveMetadataFieldName(fieldMetadata, fieldName);
  if (!resolvedFieldName) return;

  if (isBlankUdfValue(value)) {
    target[resolvedFieldName] = null;
    return;
  }

  setValidatedRdr1Field(target, fieldMetadata, resolvedFieldName, value);
};

const isSapYes = (value) => ['TYES', 'YES', 'Y', 'TRUE', '1'].includes(
  String(value || '').trim().toUpperCase().replace(/\s+/g, ''),
);

const buildDocumentLinePayload = async (line = {}, context = {}) => {
  const fieldMetadata = context.rdr1FieldMetadata || {};
  const itemDetails = context.itemDetailsByCode?.get(String(line.itemNo || '').trim());
  const hasGstRelevantFlag = String(itemDetails?.GSTRelevnt || '').trim() !== '';
  const isGstRelevant = hasGstRelevantFlag ? isSapYes(itemDetails.GSTRelevnt) : null;
  const documentLine = {
    ItemCode: toRequiredString(line.itemNo),
    Quantity: toRequiredNumber(line.quantity, 0),
    UnitPrice: toRequiredNumber(line.unitPrice, 0),
    WarehouseCode: toRequiredString(line.whse),
  };

  if (hasValue(line.taxCode) && isGstRelevant !== false) {
    documentLine.TaxCode = String(line.taxCode).trim();
  }

  if (hasValue(line.itemDescription)) {
    documentLine.ItemDescription = String(line.itemDescription).trim();
  }

  if (context.includeLineNum && line.lineNum != null && line.lineNum !== '') {
    documentLine.LineNum = Number(line.lineNum);
  }

  const uomNameEdited = isTruthyFlag(line.uomNameEdited);
  const manualUomEntry = Number(line.uomEntry ?? line.UoMEntry);
  const usesManualUom = uomNameEdited || (Number.isInteger(manualUomEntry) && manualUomEntry < 0);
  const rawUomValue = usesManualUom
    ? (line.uomName ?? line.UoMName ?? line.UomName ?? line.UnitMsr ?? line.unitMsr ?? line.uomCode)
    : (line.uomEntry ?? line.UoMEntry ?? line.uomName ?? line.UoMName ?? line.UomName ?? line.UnitMsr ?? line.unitMsr ?? line.uomCode);
  const resolvedUomEntry = await salesOrderDb.resolveSalesOrderLineUomEntry(
    documentLine.ItemCode,
    rawUomValue,
    { allowDefaultFallback: !usesManualUom },
  );
  if (resolvedUomEntry !== null && resolvedUomEntry !== undefined) {
    documentLine.UoMEntry = resolvedUomEntry;
  } else {
    const uomCode = String(rawUomValue || '').trim().toUpperCase() === 'MANUAL'
      ? (line.uomName || line.unitMsr || rawUomValue)
      : rawUomValue;
    if (hasValue(uomCode)) {
      if (usesManualUom) {
        documentLine.MeasureUnit = String(uomCode).trim();
      } else {
        documentLine.UoMCode = String(uomCode).trim();
      }
    }
  }

  if (hasLineDiscountValue(line)) {
    const discountPercent = getLineDiscountPercent(line);
    if (discountPercent !== undefined) {
      documentLine.DiscountPercent = discountPercent;
    }
  }

  if (hasValue(line.distRule)) {
    documentLine.CostingCode = String(line.distRule).trim();
  }
  if (hasValue(line.distRule2)) {
    documentLine.CostingCode2 = String(line.distRule2).trim();
  }
  if (hasValue(line.distRule3)) {
    documentLine.CostingCode3 = String(line.distRule3).trim();
  }
  if (hasValue(line.distRule4)) {
    documentLine.CostingCode4 = String(line.distRule4).trim();
  }
  if (hasValue(line.distRule5)) {
    documentLine.CostingCode5 = String(line.distRule5).trim();
  }

  if (hasValue(line.cogsDistRule) && hasFieldMetadata(fieldMetadata, 'CogsOcrCod')) {
    documentLine.COGSCostingCode = String(line.cogsDistRule).trim();
  }
  [2, 3, 4, 5].forEach((dimension) => {
    const value = line[`cogsDistRule${dimension}`];
    if (hasValue(value) && hasFieldMetadata(fieldMetadata, `CogsOcrCo${dimension}`)) {
      documentLine[`COGSCostingCode${dimension}`] = String(value).trim();
    }
  });

  if (hasValue(line.glAccount) && hasFieldMetadata(fieldMetadata, 'AcctCode')) {
    documentLine.AccountCode = String(line.glAccount).trim();
  }

  if (hasValue(line.freeText)) {
    documentLine.FreeText = String(line.freeText).trim();
  }

  if (
    hasValue(line.lineDeliveryDate ?? line.deliveryDate ?? line.ShipDate) &&
    hasFieldMetadata(fieldMetadata, 'ShipDate')
  ) {
    documentLine.ShipDate = formatDateForInput(line.lineDeliveryDate ?? line.deliveryDate ?? line.ShipDate);
  }

  if (hasValue(line.requiredDate ?? line.RequiredDate ?? line.ReqDate)
    && (hasFieldMetadata(fieldMetadata, 'ReqDate') || hasFieldMetadata(fieldMetadata, 'RequiredDate'))) {
    documentLine.RequiredDate = formatDateForInput(line.requiredDate ?? line.RequiredDate ?? line.ReqDate);
  }

  const packageQuantity = toOptionalNumber(
    line.noOfPackages ?? line.NoOfPackages ?? line.packageQuantity ?? line.PackageQuantity ?? line.PackQty
  );
  if (packageQuantity !== undefined
    && (hasFieldMetadata(fieldMetadata, 'PackQty') || hasFieldMetadata(fieldMetadata, 'PackageQuantity'))) {
    documentLine.PackageQuantity = packageQuantity;
  }

  const lineShippingType = toOptionalNumber(line.lineShippingType ?? line.shippingType ?? line.ShippingMethod ?? line.TrnsCode);
  if (lineShippingType !== undefined && hasFieldMetadata(fieldMetadata, 'TrnsCode')) {
    documentLine.ShippingMethod = lineShippingType;
  }

  if (
    hasValue(line.taxLiable ?? line.TaxLiable ?? line.TaxOnly) &&
    hasFieldMetadata(fieldMetadata, 'TaxOnly')
  ) {
    documentLine.TaxOnly = toSapYesNo(line.taxLiable ?? line.TaxLiable ?? line.TaxOnly);
  }

  if (
    hasValue(line.wTaxLiable ?? line.WTaxLiable ?? line.WTLiable) &&
    hasFieldMetadata(fieldMetadata, 'WtLiable')
  ) {
    documentLine.WTLiable = toSapYesNo(line.wTaxLiable ?? line.WTaxLiable ?? line.WTLiable);
  }

  const agreementNo = toOptionalNumber(
    line.blanketAgreementNo ?? line.agreementNo ?? line.AgreementNo ?? line.AgrNo,
  );
  if (agreementNo !== undefined && hasFieldMetadata(fieldMetadata, 'AgrNo')) {
    documentLine.AgreementNo = agreementNo;
  }

  const agreementRowNumber = toOptionalNumber(
    line.blanketAgreementLine ?? line.agreementRowNumber ?? line.AgreementRowNumber ?? line.AgrLnNum,
  );
  if (agreementRowNumber !== undefined && hasFieldMetadata(fieldMetadata, 'AgrLnNum')) {
    documentLine.AgreementRowNumber = agreementRowNumber;
  }

  const commissionPercent = toOptionalNumber(
    line.commPercent ?? line.commissionPercent ?? line.CommissionPercent,
  );
  if (
    commissionPercent !== undefined &&
    (hasFieldMetadata(fieldMetadata, 'CommPercent') || hasFieldMetadata(fieldMetadata, 'Commission'))
  ) {
    documentLine.CommissionPercent = commissionPercent;
  }

  if (
    hasValue(line.withoutQtyPosting ?? line.withoutInventoryMovement ?? line.WithoutInventoryMovement ?? line.NoInvtryMv) &&
    hasFieldMetadata(fieldMetadata, 'NoInvtryMv')
  ) {
    documentLine.WithoutInventoryMovement = toSapYesNo(
      line.withoutQtyPosting ?? line.withoutInventoryMovement ?? line.WithoutInventoryMovement ?? line.NoInvtryMv,
    );
  }

  const countryOrg = normalizeCountryOrgValue(line.countryOfOrigin);
  if (hasValue(line.countryOfOrigin) && !countryOrg) {
    console.warn(`[Sales Order Service] Skipping CountryOrg value because it is not a valid SAP country code: ${line.countryOfOrigin}`);
  }
  setValidatedRdr1Field(documentLine, fieldMetadata, 'CountryOrg', countryOrg);

  const locationCode = Number(line.loc ?? line.locCode ?? line.LocationCode ?? line.LocCode);
  if (
    hasValue(line.loc ?? line.locCode ?? line.LocationCode ?? line.LocCode) &&
    Number.isInteger(locationCode) &&
    locationCode >= 0 &&
    hasFieldMetadata(fieldMetadata, 'LocCode')
  ) {
    documentLine.LocationCode = locationCode;
  }

  const hsnValue = line.hsnCode ?? line.HSNCode ?? line.HSNEntry;
  if (hasValue(hsnValue) && hasFieldMetadata(fieldMetadata, 'HsnEntry')) {
    const hsnEntry = await hsnCodeDbService.resolveHSNCodeToAbsEntry(hsnValue);
    if (hsnEntry !== null && hsnEntry !== undefined) {
      documentLine.HSNEntry = hsnEntry;
    } else {
      console.warn(`[Sales Order Service] Skipping HSN value because it was not found in OCHP: ${hsnValue}`);
    }
  }

  const sacValue = line.sacCode ?? line.SACCode ?? line.SACEntry;
  if (hasValue(sacValue) && hasFieldMetadata(fieldMetadata, 'SACEntry')) {
    const sacEntry = await hsnCodeDbService.resolveSACCodeToAbsEntry(sacValue);
    if (sacEntry !== null && sacEntry !== undefined) {
      documentLine.SACEntry = sacEntry;
    } else {
      console.warn(`[Sales Order Service] Skipping SAC value because it was not found in OSAC/OCHP: ${sacValue}`);
    }
  }

  for (const mapping of SALES_ORDER_LINE_UDF_MAPPINGS) {
    const value = mapping.getValue(line, context);
    if (mapping.skipBlank && !hasValue(value)) continue;
    setValidatedRdr1Udf(documentLine, fieldMetadata, mapping.sapField, value);
  }

  Object.entries(line.udf || {}).forEach(([key, value]) => {
    if (normalizeSapUdfFieldName(key).startsWith('U_') && !shouldSkipGenericLineUdf(key)) {
      setValidatedRdr1Udf(documentLine, fieldMetadata, key, value);
    }
  });

  if (hasValue(line.baseEntry) && hasValue(line.baseType) && line.baseLine !== undefined && line.baseLine !== null) {
    documentLine.BaseEntry = Number(line.baseEntry);
    documentLine.BaseType = Number(line.baseType);
    documentLine.BaseLine = Number(line.baseLine);
  }

  if (line.batches && line.batches.length > 0) {
    documentLine.BatchNumbers = line.batches.map((batch) => ({
      BatchNumber: batch.batchNumber,
      Quantity: Number(batch.quantity),
    }));
  }

  return documentLine;
};

const buildDocumentLinesPayload = async (lines = [], includeLineNum = false, extraContext = {}) => {
  const rdr1FieldMetadata = await salesOrderDb.getSalesOrderLineFieldMetadata();
  const itemCodes = [...new Set(
    (lines || []).map((line) => String(line.itemNo || '').trim()).filter(Boolean),
  )];
  const itemDetailsRows = await Promise.all(
    itemCodes.map((itemCode) => salesOrderDb.getItemDetails(itemCode)),
  );
  const itemDetailsByCode = new Map(
    itemCodes.map((itemCode, index) => [itemCode, itemDetailsRows[index]]),
  );

  return Promise.all(
    (lines || []).map((line) => buildDocumentLinePayload(line, {
      ...extraContext,
      itemDetailsByCode,
      rdr1FieldMetadata,
      includeLineNum,
    }))
  );
};

const hasCompleteBaseReference = (line = {}) => (
  hasValue(line.baseEntry)
  && hasValue(line.baseType)
  && line.baseLine !== undefined
  && line.baseLine !== null
  && String(line.baseLine).trim() !== ''
);

const isUnbasedSalesBomComponent = (line = {}) => (
  line.bomType === 'S'
  && line.bomRole === 'component'
  && !hasCompleteBaseReference(line)
);

const getSalesOrderCreateSourceLines = (lines = []) => (
  (Array.isArray(lines) ? lines : []).filter((line) => !isUnbasedSalesBomComponent(line))
);

const getServiceLayerLineNum = (line = {}) => {
  const value = line.LineNum ?? line.lineNum;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getServiceLayerParentLineNum = (line = {}) => {
  const value = line.ParentLineNum ?? line.parentLineNum;
  if (!hasValue(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const getServiceLayerItemCode = (line = {}) => (
  String(line.ItemCode ?? line.itemNo ?? '').trim()
);

const getCreatedSalesOrderLines = async (responseData = {}, docEntry) => {
  if (Array.isArray(responseData.DocumentLines)) return responseData.DocumentLines;

  const createdOrderResponse = await sapService.request({
    method: 'get',
    url: `/Orders(${Number(docEntry)})`,
  });
  return Array.isArray(createdOrderResponse.data?.DocumentLines)
    ? createdOrderResponse.data.DocumentLines
    : [];
};

const applySalesBomComponentOverrides = async (responseData = {}, sourceLines = []) => {
  const editedComponents = (Array.isArray(sourceLines) ? sourceLines : []).filter((line) => (
    isUnbasedSalesBomComponent(line)
    && (
      isTruthyFlag(line.bomQuantityManuallyEdited)
      || isTruthyFlag(line.bomComponentManuallyEdited)
    )
  ));
  if (!editedComponents.length) return;

  const docEntry = responseData.DocEntry ?? responseData.docEntry;
  if (!hasValue(docEntry)) {
    throw new Error('SAP created the Sales Order but did not return DocEntry, so Sales BOM component adjustments could not be applied.');
  }

  const createdLines = await getCreatedSalesOrderLines(responseData, docEntry);
  const usedCreatedLineNums = new Set();
  const matchedComponents = [];
  let parentSearchStart = 0;
  const sourceParents = sourceLines.filter((line) => (
    line.bomType === 'S'
    && line.bomRole === 'parent'
    && editedComponents.some((component) => component.bomGroupId === line.bomGroupId)
  ));

  sourceParents.forEach((sourceParent) => {
    const parentIndex = createdLines.findIndex((createdLine, index) => (
      index >= parentSearchStart
      && getServiceLayerItemCode(createdLine) === String(sourceParent.itemNo || '').trim()
      && getServiceLayerParentLineNum(createdLine) === null
    ));
    if (parentIndex < 0) {
      throw new Error(`SAP created the Sales Order but the expanded Sales BOM parent ${sourceParent.itemNo} could not be matched for component adjustment.`);
    }

    parentSearchStart = parentIndex + 1;
    const createdParentLineNum = getServiceLayerLineNum(createdLines[parentIndex]);
    const createdComponents = createdLines.filter((createdLine) => (
      getServiceLayerParentLineNum(createdLine) === createdParentLineNum
    ));
    const sourceComponents = editedComponents.filter((component) => (
      component.bomGroupId === sourceParent.bomGroupId
    ));

    sourceComponents.forEach((sourceComponent) => {
      const createdComponent = createdComponents.find((candidate) => {
        const lineNum = getServiceLayerLineNum(candidate);
        return (
          !usedCreatedLineNums.has(lineNum)
          && getServiceLayerItemCode(candidate) === String(sourceComponent.itemNo || '').trim()
        );
      });
      const createdComponentLineNum = getServiceLayerLineNum(createdComponent);
      if (!createdComponent || createdComponentLineNum === null) {
        throw new Error(`SAP created the Sales Order but Sales BOM component ${sourceComponent.itemNo} could not be matched for adjustment.`);
      }

      usedCreatedLineNums.add(createdComponentLineNum);
      matchedComponents.push({
        ...sourceComponent,
        lineNum: createdComponentLineNum,
      });
    });
  });

  if (!matchedComponents.length) return;

  const componentPayloads = await buildDocumentLinesPayload(matchedComponents, true);

  await sapService.request({
    method: 'patch',
    url: `/Orders(${Number(docEntry)})`,
    data: { DocumentLines: componentPayloads },
  });
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ REFERENCE DATA (USING ODBC) â”€â”€â”€â”€â”€â”€â”€â”€â”€

const getUniqueTaxCodesForLog = (payload = {}, documentLines = [], documentAdditionalExpenses = []) => {
  const codes = new Set();
  const addCode = (value) => {
    const normalized = String(value || '').trim();
    if (normalized && normalized !== 'Select') {
      codes.add(normalized);
    }
  };

  (payload.lines || []).forEach((line) => {
    addCode(line.taxCode);
    addCode(line.stcode);
  });

  documentLines.forEach((line) => {
    addCode(line.TaxCode);
    addCode(line.U_SELLTCODE);
  });

  documentAdditionalExpenses.forEach((expense) => {
    addCode(expense.TaxCode);
  });

  return [...codes];
};

const summarizeTaxCodeDiagnostics = (rows = []) => {
  const byCode = new Map();

  rows.forEach((row) => {
    const code = String(row.Code || '').trim();
    if (!code) return;

    if (!byCode.has(code)) {
      byCode.set(code, {
        code,
        name: row.Name || '',
        locked: row.Lock || '',
        components: [],
        hasCGST: false,
        hasSGST: false,
        hasIGST: false,
        warnings: [],
      });
    }

    const entry = byCode.get(code);
    const staCode = String(row.STACode || '').trim();
    const upperStaCode = staCode.toUpperCase();

    if (staCode) {
      entry.components.push({
        staCode,
        staType: row.STAType,
        effectiveRate: row.EfctivRate,
        rate: row.Rate,
      });
    }

    if (upperStaCode.includes('CGST')) entry.hasCGST = true;
    if (upperStaCode.includes('SGST')) entry.hasSGST = true;
    if (upperStaCode.includes('IGST')) entry.hasIGST = true;
  });

  return [...byCode.values()].map((entry) => {
    if (entry.hasSGST && !entry.hasCGST) {
      entry.warnings.push('SGST component exists without CGST component');
    }
    if (entry.hasCGST && !entry.hasSGST) {
      entry.warnings.push('CGST component exists without SGST component');
    }
    if (!entry.components.length) {
      entry.warnings.push('No STC1 components found for tax code');
    }
    return entry;
  });
};

const logSalesOrderSaveTaxDiagnostics = async ({
  mode,
  docEntry,
  payload = {},
  documentLines = [],
  documentAdditionalExpenses = [],
}) => {
  try {
    const header = payload.header || {};
    const lines = payload.lines || [];
    const taxCodes = getUniqueTaxCodesForLog(payload, documentLines, documentAdditionalExpenses);

    console.log('[SalesOrderTaxSave] Save tax context:', JSON.stringify({
      mode,
      docEntry: docEntry || null,
      customer: header.vendor || header.customerCode || '',
      customerName: header.name || header.customerName || '',
      placeOfSupply: header.placeOfSupply || '',
      branch: header.branch || '',
      postingDate: header.postingDate || '',
      documentDate: header.documentDate || '',
      taxCodes,
      lines: lines.map((line, index) => ({
        line: index + 1,
        itemNo: line.itemNo || '',
        quantity: line.quantity || '',
        whse: line.whse || '',
        frontendTaxCode: line.taxCode || '',
        frontendStcode: line.stcode || '',
        sentTaxCode: documentLines[index]?.TaxCode || '',
        sentSellerTaxUdf: documentLines[index]?.U_SELLTCODE || '',
        taxAmount: line.taxAmount || '',
        total: line.total || '',
      })),
      freightCharges: documentAdditionalExpenses.map((expense, index) => ({
        line: index + 1,
        expenseCode: expense.ExpenseCode,
        taxCode: expense.TaxCode || '',
        lineTotal: expense.LineTotal,
      })),
    }, null, 2));

    if (!taxCodes.length) {
      console.warn('[SalesOrderTaxSave] No tax codes found in sales order save payload.');
      return;
    }

    const rows = await salesOrderDb.getTaxCodeDiagnostics(taxCodes);
    const summary = summarizeTaxCodeDiagnostics(rows);
    const foundCodes = new Set(summary.map((entry) => entry.code));
    const missingCodes = taxCodes.filter((code) => !foundCodes.has(code));

    console.log('[SalesOrderTaxSave] SAP tax code components:', JSON.stringify({
      summary,
      missingCodes,
    }, null, 2));

    const warnings = [
      ...summary.flatMap((entry) => entry.warnings.map((warning) => `${entry.code}: ${warning}`)),
      ...missingCodes.map((code) => `${code}: tax code not found in OSTC/STC1 diagnostics`),
    ];

    if (warnings.length) {
      console.warn('[SalesOrderTaxSave] Tax diagnostics warnings:', warnings);
    }
  } catch (error) {
    console.warn('[SalesOrderTaxSave] Failed to write tax diagnostics:', error.message);
  }
};

const getReferenceData = async (companyId) => {
  try {
    // Use ODBC/Direct SQL for GET operations
    const [data, companyConfig] = await Promise.all([
      salesOrderDb.getReferenceData(),
      getActiveCompanyConfig(),
    ]);
    const toVendorCode = String(
      companyConfig?.documentDefaults?.salesOrderToVendorCode || '',
    ).trim();

    let currencies = Array.isArray(data.currencies) ? data.currencies : [];
    if (currencies.length <= 1) {
      try {
        const response = await sapService.request({
          method: 'get',
          url: '/Currencies?$select=Code,Name',
        });
        const sapCurrencies = (response.data?.value || []).map((currency) => ({
          CurrCode: currency.Code || currency.CurrCode || '',
          CurrName: currency.Name || currency.CurrName || currency.Code || '',
        })).filter((currency) => currency.CurrCode);
        if (sapCurrencies.length > currencies.length) {
          currencies = sapCurrencies;
        }
      } catch (currencyError) {
        console.warn('[Sales Order Service] Failed to load SAP currencies via Service Layer:', currencyError.message);
      }
    }

    currencies = mergeCompanyCurrencyRows({
      currencies,
      localCurrency: data.local_currency,
      systemCurrency: data.system_currency,
    });

    console.log("Reference data:",data.tax_codes);
    const bpSelectionPolicy = await getDocumentBpSelectionPolicy('salesOrder');
    return {
      ...data,
      bp_selection_policy: bpSelectionPolicy,
      currencies,
      defaults: {
        ...(data.defaults || {}),
        toVendorCode,
      },
    };
  } catch (error) {
    console.error('[Sales Order Service] Failed to load reference data via ODBC:', error);
    // Return empty structure with warnings
    return {
      company: '',
      customers: [],
      vendors: [],
      items: [],
      warehouses: [],
      warehouse_addresses: [],
      payment_terms: [],
      payment_methods: [],
      shipping_types: [],
      branches: [],
      branches_enabled: false,
      local_currency: '',
      system_currency: '',
      currencies: [],
      countries: [],
      distribution_rules: [],
      tax_codes: [],
      uom_groups: [],
      quality_options: { buyer: [], seller: [] },
      price_options: { buyer: [], seller: [] },
      contacts: [],
      pay_to_addresses: [],
      company_address: {},
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ CUSTOMER DETAILS (USING ODBC) â”€â”€â”€â”€â”€â”€â”€â”€â”€

const getCustomerDetails = async (customerCode) => {
  try {
    // Use ODBC/Direct SQL for GET operations
    const data = await salesOrderDb.getCustomerDetails(customerCode);
    return data;
  } catch (error) {
    console.error('[Sales Order Service] Failed to load customer details via ODBC:', error);
    throw error;
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ SALES ORDER LIST (USING ODBC) â”€â”€â”€â”€â”€â”€â”€â”€â”€

const getSalesOrderList = async ({
  query = '',
  openOnly = true,
  docNum = '',
  customerRefNo = '',
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
    // Use ODBC for reading list
    const result = await salesOrderDb.getSalesOrderList({
      query,
      openOnly,
      docNum,
      customerRefNo,
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
    console.error('[Sales Order Service] Failed to load sales order list via ODBC:', error);
    return {
      orders: [],
      pagination: {
        page: Math.max(1, Number(page) || 1),
        pageSize: Math.min(200, Math.max(1, Number(pageSize) || 25)),
        totalCount: 0,
        totalPages: 1,
      },
    };
  }
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
  } catch (error) {
    console.error('[Sales Order Service] Failed to load customer filter options via ODBC:', error);
    return { options: [] };
  }
};

const getSalesOrderFilterOptions = async ({
  field = '',
  query = '',
  openOnly = true,
  docNum = '',
  customerRefNo = '',
  customerCode = '',
  customerName = '',
  sellerCode = '',
  sellerName = '',
  status = '',
  postingDateFrom = '',
  postingDateTo = '',
  top,
} = {}) => {
  try {
    return await salesOrderDb.getSalesOrderFilterOptions({
      field,
      query,
      openOnly,
      docNum,
      customerRefNo,
      customerCode,
      customerName,
      sellerCode,
      sellerName,
      status,
      postingDateFrom,
      postingDateTo,
      top,
    });
  } catch (error) {
    console.error('[Sales Order Service] Failed to load sales order filter options via ODBC:', error);
    return { options: [] };
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ GET SINGLE ORDER (USING ODBC) â”€â”€â”€â”€â”€â”€â”€â”€â”€

const getReferenceDocumentLookup = async ({
  transactionType = '',
  query = '',
  cardCode = '',
  top,
} = {}) => {
  try {
    return await salesOrderDb.getReferenceDocumentLookup({
      transactionType,
      query,
      cardCode,
      top,
    });
  } catch (error) {
    console.error('[Sales Order Service] Failed to load reference document lookup:', error);
    return { label: '', options: [] };
  }
};

const getSalesOrder = async (docEntry) => {
  try {
    // Use ODBC for reading single order
    const [result, companyCurrencyRows] = await Promise.all([
      salesOrderDb.getSalesOrder(docEntry),
      salesOrderDb.getCompanyCurrencyInfo(),
    ]);
    const header = result?.sales_order?.header;
    const companyCurrencyInfo = companyCurrencyRows?.[0] || {};
    if (header && !String(header.currency || '').trim()) {
      header.currency = String(companyCurrencyInfo.MainCurncy || '').trim();
    }
    if (header?.exchangeRate) {
      header.exchangeRate = String(fromSapStoredRate(header.exchangeRate, companyCurrencyInfo));
    }
    return result;
  } catch (error) {
    console.error('[Sales Order Service] Failed to load sales order via ODBC:', error);
    throw error;
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ CREATE ORDER (USING SERVICE LAYER) â”€â”€â”€â”€â”€â”€â”€â”€â”€

const submitSalesOrder = async (payload) => {
  try {
    assertDocumentBpSelection(await getDocumentBpSelectionPolicy('salesOrder'), resolveHeaderCustomerCode(payload.header || {}));
    const refData = await salesOrderDb.getReferenceData();
    const branchesEnabled = Boolean(refData.branches_enabled ?? (refData.branches || []).length > 0);
    validateRequiredBranchAndWarehouse(payload, { branchesEnabled });
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    console.log("ðŸ”¥ CREATE - RECEIVED PAYLOAD FROM FRONTEND:");
    console.log("  salesEmployee:", payload.header.salesEmployee);
    console.log("  purchaser:", payload.header.purchaser);
    console.log("  owner:", payload.header.owner);
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 1: Load ODBC Master Data
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const salesEmployees = refData.sales_employees || [];
    const owners = refData.owners || [];
    
    console.log('ðŸ“š ODBC Data Loaded:');
    console.log('  - Sales Employees:', salesEmployees.length);
    console.log('  - Owners:', owners.length);
    if (salesEmployees.length > 0) {
      console.log('  - Available Sales Employees:', salesEmployees.map(e => `${e.SlpName} (${e.SlpCode})`).join(', '));
    }
    
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 2: Determine Final Sales Employee Input (Fallback Logic)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let salesEmployeeInput = payload.header.salesEmployee;
    
    // Apply fallback: if salesEmployee is -1 or empty, use purchaser
    if (!salesEmployeeInput || salesEmployeeInput === '-1' || salesEmployeeInput === -1) {
      console.log('âš ï¸  salesEmployee is empty or -1, falling back to purchaser');
      salesEmployeeInput = payload.header.purchaser;
    }
    
    console.log('ðŸŽ¯ Final Sales Employee Input:', salesEmployeeInput);
    
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 3: Convert Name â†’ SlpCode using ODBC Data
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const SlpCode = await convertSalesEmployeeToCode(salesEmployeeInput, salesEmployees);
    console.log('âœ… Resolved SlpCode:', SlpCode);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 4: Convert Owner Name â†’ empID using ODBC Data
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const OwnerCode = await convertOwnerToCode(payload.header.owner, owners);
    console.log('âœ… Resolved OwnerCode:', OwnerCode);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 5: Extract Remarks and Freight
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const Remarks = payload.header.otherInstruction || payload.header.remarks || '';
    const JournalRemark = payload.header.journalRemark || '';
    const Freight = payload.header.freight ? Number(payload.header.freight) : 0;
    const DiscountPercent = getHeaderDiscountPercent(payload.header);
    const documentAdditionalExpenses = buildDocumentAdditionalExpenses(payload.freightCharges);
    const createSourceLines = getSalesOrderCreateSourceLines(payload.lines);
    const documentLines = await buildDocumentLinesPayload(createSourceLines);
    const documentReferences = payload.reference_documents_changed
      ? buildDocumentReferencesPayload(payload.reference_documents)
      : [];
    await logSalesOrderSaveTaxDiagnostics({
      mode: 'create',
      payload,
      documentLines,
      documentAdditionalExpenses,
    });

    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    console.log("ðŸ”¥ FINAL CONVERTED VALUES:");
    console.log({
      SalesPersonCode: SlpCode,
      DocumentsOwner: OwnerCode,
      Comments: Remarks,
      HeaderFreightInput: Freight,
      DocumentAdditionalExpenses: documentAdditionalExpenses.length
    });
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    
    // Transform payload to SAP format
    const sapPayload = {
      CardCode: payload.header.vendor.trim(),

      ...buildDocumentSeriesPayload(payload.header),

      DocDate: payload.header.postingDate,
      DocDueDate: payload.header.deliveryDate,
      TaxDate: payload.header.documentDate,

      ContactPersonCode: payload.header.contactPerson ? Number(payload.header.contactPerson) : undefined,
      
      // âœ… Branch mapping - try multiple field names
      ...(branchesEnabled && payload.header.branch ? {
        BPLId: normalizeBranchId(payload.header.branch),
        BPL_IDAssignedToInvoice: normalizeBranchId(payload.header.branch),
      } : {}),

      PaymentGroupCode: payload.header.paymentTerms ? Number(payload.header.paymentTerms) : undefined,
      ...(DiscountPercent !== undefined ? { DiscountPercent } : {}),
      ...(payload.header.paymentMethod ? { PaymentMethod: payload.header.paymentMethod } : {}),
      ...(JournalRemark ? { JournalMemo: JournalRemark } : {}),
      ...(toOptionalNumber(payload.header.shippingType) !== undefined ? { TransportationCode: toOptionalNumber(payload.header.shippingType) } : {}),
      ...(toOptionalNumber(payload.header.language) !== undefined ? { LanguageCode: toOptionalNumber(payload.header.language) } : {}),
      ...buildDocumentConfirmationPayload(payload.header),
      ...buildDocumentRoundingPayload(payload.header),

      // âœ… Add Sales Employee if present (converted from name to code)
      ...(SlpCode !== null && SlpCode !== undefined ? { SalesPersonCode: SlpCode } : {}),

      // âœ… Add Owner if present (converted from name to empID)
      ...(OwnerCode !== null && OwnerCode !== undefined ? { DocumentsOwner: OwnerCode } : {}),

      // âœ… Add Remarks
      ...(Remarks ? { Comments: Remarks } : {}),

      // âœ… Add Freight
      ...(documentAdditionalExpenses.length > 0 ? { DocumentAdditionalExpenses: documentAdditionalExpenses } : {}),
      ...(payload.reference_documents_changed ? { DocumentReferences: documentReferences } : {}),
      ...buildSalesOrderAddressPayload(payload.header),

      // âœ… Add NumAtCard for customer reference
      NumAtCard: payload.header.customerRefNo || payload.header.salesContractNo || undefined,

      DocumentLines: documentLines
    };
    applySapDocumentCurrency(sapPayload, {
      ...payload.header,
      currency: resolveSalesOrderDocumentCurrency(payload.header, refData),
    }, refData);

    // âœ… Only add U_PlaceOfSupply if it has a value (optional UDF)
    const headerUdfDefinitionsByKey = await getUdfDefinitionsByKey('ORDR');
    const allowedHeaderUdfKeys = new Set(headerUdfDefinitionsByKey.keys());
    if (payload.header.placeOfSupply && allowedHeaderUdfKeys.has('U_PlaceOfSupply')) {
      sapPayload.U_PlaceOfSupply = payload.header.placeOfSupply;
    }

    Object.assign(sapPayload, normalizeUdfValues({
      ...(payload.header_udfs || {}),
      ...buildSalesOrderTaxHeaderUdfs(payload.header, allowedHeaderUdfKeys),
      ...buildSalesOrderTaxInfoHeaderUdfs(payload.tax_info || payload.taxInfoForm || {}, allowedHeaderUdfKeys),
    }, allowedHeaderUdfKeys, headerUdfDefinitionsByKey));

    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    console.log("ðŸ”¥ SAP PAYLOAD TO BE SENT:");
    console.log(JSON.stringify(sapPayload, null, 2));
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");

    // Use Service Layer for POST operations
    const response = await sapService.request({
      method: 'post',
      url: '/Orders',
      data: sapPayload,
    });
    await applySalesBomComponentOverrides(response.data, payload.lines);

    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    console.log("âœ… SAP RESPONSE:");
    console.log(JSON.stringify(response.data, null, 2));
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");

    return {
      message: 'Sales order created successfully',
      doc_num: response.data?.DocNum,
      doc_entry: response.data?.DocEntry,
      DocNum: response.data?.DocNum,
      DocEntry: response.data?.DocEntry,
    };
  } catch (error) {
    console.error('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
    console.error('âŒ SAP ERROR RESPONSE:');
    console.error('Status:', error.response?.status);
    console.error('Status Text:', error.response?.statusText);
    console.error('Error Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•');
    
    // Extract meaningful error message from SAP
    if (String(error.code || '').startsWith('SAP_SERVICE_LAYER_LOGIN_')) {
      throw error;
    }

    let errorMessage = 'Sales order submission failed.';
    if (error.response?.data?.error?.message?.value) {
      errorMessage = error.response.data.error.message.value;
    } else if (error.response?.data?.error?.message) {
      errorMessage = error.response.data.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    // Create a new error with the SAP message
    const sapError = new Error(errorMessage);
    sapError.response = error.response;
    sapError.statusCode = error.statusCode || error.response?.status;
    sapError.code = error.code;
    throw sapError;
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ UPDATE ORDER (USING SERVICE LAYER) â”€â”€â”€â”€â”€â”€â”€â”€â”€

const updateSalesOrder = async (docEntry, payload) => {
  const confirmationResult = await updateDocumentConfirmationOnly(docEntry, payload, 'Orders', sapService);
  if (confirmationResult) return confirmationResult;
  try {
    const bpSelectionPolicy = await getDocumentBpSelectionPolicy('salesOrder');
    if (bpSelectionPolicy) {
      const existing = await salesOrderDb.getSalesOrder(docEntry);
      assertDocumentBpSelection(bpSelectionPolicy, resolveHeaderCustomerCode(payload.header || {}), {
        existingCode: existing?.sales_order?.header?.customerCode,
      });
    }
    const refData = await salesOrderDb.getReferenceData();
    const branchesEnabled = Boolean(refData.branches_enabled ?? (refData.branches || []).length > 0);
    validateRequiredBranchAndWarehouse(payload, { branchesEnabled });
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    console.log("ðŸ”¥ UPDATE - RECEIVED PAYLOAD FROM FRONTEND:");
    console.log("  DocEntry:", docEntry);
    console.log("  salesEmployee:", payload.header.salesEmployee);
    console.log("  purchaser:", payload.header.purchaser);
    console.log("  owner:", payload.header.owner);
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 1: Load ODBC Master Data
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const salesEmployees = refData.sales_employees || [];
    const owners = refData.owners || [];
    
    console.log('ðŸ“š ODBC Data Loaded:');
    console.log('  - Sales Employees:', salesEmployees.length);
    console.log('  - Owners:', owners.length);
    if (salesEmployees.length > 0) {
      console.log('  - Available Sales Employees:', salesEmployees.map(e => `${e.SlpName} (${e.SlpCode})`).join(', '));
    }
    
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 2: Determine Final Sales Employee Input (Fallback Logic)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let salesInput = payload.header.salesEmployee;
    
    // Apply fallback: if salesEmployee is -1 or empty, use purchaser
    if (!salesInput || salesInput === '-1' || salesInput === -1) {
      console.log('âš ï¸  salesEmployee is empty or -1, falling back to purchaser');
      salesInput = payload.header.purchaser;
    }
    
    console.log('ðŸŽ¯ Final Sales Employee Input:', salesInput);
    
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 3: Convert Name â†’ SlpCode using ODBC Data
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const SlpCode = await convertSalesEmployeeToCode(salesInput, salesEmployees);
    console.log('âœ… Resolved SlpCode:', SlpCode);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 4: Convert Owner Name â†’ empID using ODBC Data
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const OwnerCode = await convertOwnerToCode(payload.header.owner, owners);
    console.log('âœ… Resolved OwnerCode:', OwnerCode);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // STEP 5: Extract Remarks and Freight
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const Remarks = payload.header.otherInstruction || payload.header.remarks || '';
    const JournalRemark = payload.header.journalRemark || '';
    const Freight = Number(payload.header.freight) || 0;
    const DiscountPercent = getHeaderDiscountPercent(payload.header);
    const documentAdditionalExpenses = buildDocumentAdditionalExpenses(payload.freightCharges);
    const documentLines = await buildDocumentLinesPayload(payload.lines, true, {
      docEntry,
    });
    const documentReferences = payload.reference_documents_changed
      ? buildDocumentReferencesPayload(payload.reference_documents)
      : [];
    await logSalesOrderSaveTaxDiagnostics({
      mode: 'update',
      docEntry,
      payload,
      documentLines,
      documentAdditionalExpenses,
    });

    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    console.log("ðŸ”¥ FINAL CONVERTED VALUES:");
    console.log({
      SalesPersonCode: SlpCode,
      DocumentsOwner: OwnerCode,
      Comments: Remarks,
      HeaderFreightInput: Freight,
      DocumentAdditionalExpenses: documentAdditionalExpenses.length
    });
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");

    // =========================
    // âœ… BUILD PAYLOAD
    // =========================
    const sapPayload = {
      CardCode: payload.header.vendor?.trim(),

      DocDate: payload.header.postingDate,
      DocDueDate: payload.header.deliveryDate,
      TaxDate: payload.header.documentDate,

      ContactPersonCode: payload.header.contactPerson
        ? Number(payload.header.contactPerson)
        : undefined,

      ...(branchesEnabled && normalizeBranchId(payload.header.branch) !== undefined
        ? { BPL_IDAssignedToInvoice: normalizeBranchId(payload.header.branch) }
        : {}),

      PaymentGroupCode: payload.header.paymentTerms
        ? Number(payload.header.paymentTerms)
        : undefined,
      ...(DiscountPercent !== undefined ? { DiscountPercent } : {}),
      ...(payload.header.paymentMethod ? { PaymentMethod: payload.header.paymentMethod } : {}),
      ...(JournalRemark ? { JournalMemo: JournalRemark } : {}),
      ...(toOptionalNumber(payload.header.shippingType) !== undefined ? { TransportationCode: toOptionalNumber(payload.header.shippingType) } : {}),
      ...(toOptionalNumber(payload.header.language) !== undefined ? { LanguageCode: toOptionalNumber(payload.header.language) } : {}),
      ...buildDocumentConfirmationPayload(payload.header),
      ...buildDocumentRoundingPayload(payload.header),

      ...(SlpCode !== null && SlpCode !== undefined && { SalesPersonCode: SlpCode }),
      ...(OwnerCode !== null && OwnerCode !== undefined && { DocumentsOwner: OwnerCode }),
      ...(Remarks && { Comments: Remarks }),
      ...(documentAdditionalExpenses.length > 0 ? { DocumentAdditionalExpenses: documentAdditionalExpenses } : {}),
      ...(payload.reference_documents_changed ? { DocumentReferences: documentReferences } : {}),
      ...buildSalesOrderAddressPayload(payload.header),
      NumAtCard: payload.header.customerRefNo || payload.header.salesContractNo || undefined,

      DocumentLines: documentLines
    };
    applySapDocumentCurrency(sapPayload, {
      ...payload.header,
      currency: resolveSalesOrderDocumentCurrency(payload.header, refData),
    }, refData);

    // =========================
    // âœ… OPTIONAL UDF
    // =========================
    const headerUdfDefinitionsByKey = await getUdfDefinitionsByKey('ORDR');
    const allowedHeaderUdfKeys = new Set(headerUdfDefinitionsByKey.keys());
    if (payload.header.placeOfSupply && allowedHeaderUdfKeys.has('U_PlaceOfSupply')) {
      sapPayload.U_PlaceOfSupply = payload.header.placeOfSupply;
    }

    Object.assign(sapPayload, normalizeUdfValues({
      ...(payload.header_udfs || {}),
      ...buildSalesOrderTaxHeaderUdfs(payload.header, allowedHeaderUdfKeys),
      ...buildSalesOrderTaxInfoHeaderUdfs(payload.tax_info || payload.taxInfoForm || {}, allowedHeaderUdfKeys),
    }, allowedHeaderUdfKeys, headerUdfDefinitionsByKey));

    console.log("ðŸ”¥ FINAL SAP PAYLOAD:", JSON.stringify(sapPayload, null, 2));

    // =========================
    // âœ… PATCH CALL
    // =========================
    const response = await sapService.request({
      method: 'patch',
      url: `/Orders(${docEntry})`,
      data: sapPayload,
    });

    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");
    console.log("âœ… SAP UPDATE RESPONSE:");
    console.log(JSON.stringify(response.data, null, 2));
    console.log("â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•");

    return {
      message: 'Sales order updated successfully',
      doc_entry: docEntry,
    };

  } catch (error) {
    console.error("âŒ UPDATE ERROR:", error.response?.data || error.message);
    throw error;
  }
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€ DOCUMENT SERIES â”€â”€â”€â”€â”€â”€â”€â”€â”€

const getDocumentSeries = async (targetDate = null, { branch = '' } = {}) => {
  try {
    const series = await salesOrderDb.getDocumentSeries(targetDate, { branch });
    return { series };
  } catch (error) {
    console.error('[Sales Order Service] Failed to load document series:', error);
    throw error;
  }
};

const getNextNumber = async (seriesParam) => {
  try {
    const series = Number(seriesParam);
    if (isNaN(series)) {
      throw new Error('Invalid series number');
    }
    const result = await salesOrderDb.getNextNumber(series);
    return result;
  } catch (error) {
    console.error('[Sales Order Service] Failed to get next number:', error);
    throw error;
  }
};

const getStateFromAddress = async (cardCode, addressCode) => {
  try {
    const result = await salesOrderDb.getStateFromAddress(cardCode, addressCode);
    return result;
  } catch (error) {
    console.error('[Sales Order Service] Failed to get state from address:', error);
    return { state: '' };
  }
};

const getItemsForModal = async (whsCode = '') => {
  try {
    const items = await salesOrderDb.getItemsForModal(whsCode);
    return { items };
  } catch (error) {
    console.error('[Sales Order Service] Failed to get items for modal:', error);
    return { items: [] };
  }
};

const getFreightCharges = async (docEntry) => {
  try {
    const freightCharges = await salesOrderDb.getFreightCharges(docEntry);
    return { freightCharges };
  } catch (error) {
    console.error('[Sales Order Service] Failed to get freight charges:', error);
    return { freightCharges: [] };
  }
};

const getSalesOrderPrintLayouts = async () => {
  try {
    const layouts = await salesOrderDb.getSalesOrderPrintLayouts();
    return { layouts };
  } catch (error) {
    console.error('[Sales Order Service] Failed to get print layouts:', error);
    return { layouts: [] };
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

  const option = await salesOrderDb.createLookupValue(aliasId, value, description);
  const options = await salesOrderDb.getLookupValues(aliasId);

  return { option, options };
};

const getLookupOptions = async (source, { query = '', limit = 50 } = {}) => {
  try {
    return await salesOrderDb.getUdfLinkedTableLookupOptions(source, query, limit);
  } catch (error) {
    console.error('[Sales Order Service] Failed to load lookup options:', error);
    return { options: [] };
  }
};

const normalizeCurrencyCode = (value) => String(value || '').trim().toUpperCase();

const throwExchangeRateSapError = (error, action) => {
  if (Number(error?.response?.status) === 401) {
    const credentialError = new Error(
      `SAP Service Layer login failed while ${action} the exchange rate. Update the selected company's SAP username and password in the Admin Panel.`,
    );
    credentialError.statusCode = 502;
    credentialError.cause = error;
    throw credentialError;
  }

  throw error;
};

const normalizeSapRateDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const datePart = text.split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : '';
};

const toSapActionDate = (value) => String(value || '').replace(/-/g, '');

const getCurrencyRate = async ({ currency, date }) => {
  const Currency = normalizeCurrencyCode(currency);
  const RateDate = normalizeSapRateDate(date);

  if (!Currency) {
    const error = new Error('Currency is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!RateDate) {
    const error = new Error('Posting date is required to read the exchange rate.');
    error.statusCode = 400;
    throw error;
  }

  let response;
  let companyCurrencyRows;
  try {
    [response, companyCurrencyRows] = await Promise.all([
      sapService.request({
        method: 'post',
        url: '/SBOBobService_GetCurrencyRate',
        data: { Currency, Date: toSapActionDate(RateDate) },
      }),
      salesOrderDb.getCompanyCurrencyInfo(),
    ]);
  } catch (error) {
    throwExchangeRateSapError(error, 'reading');
  }
  const rawRate = response.data?.Rate ?? response.data?.rate ?? response.data?.value;
  const rate = Number(rawRate);
  const settings = normalizeRateSettings(companyCurrencyRows?.[0] || {});

  return {
    currency: Currency,
    date: RateDate,
    rate: Number.isFinite(rate) && rate > 0 ? fromSapStoredRate(rate, settings) : '',
    postingMethod: settings.postingMethod,
  };
};

const getExchangeRatesForMonth = async ({ year, month }) => {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  if (!Number.isInteger(normalizedYear) || normalizedYear < 1900 || normalizedYear > 9999) {
    const error = new Error('A valid year is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) {
    const error = new Error('A valid month is required.');
    error.statusCode = 400;
    throw error;
  }

  const [companyCurrencyRows, currencyRows, rateRows] = await Promise.all([
    salesOrderDb.getCompanyCurrencyInfo ? salesOrderDb.getCompanyCurrencyInfo() : Promise.resolve([]),
    salesOrderDb.getCurrencies(),
    salesOrderDb.getExchangeRateRows({ year: normalizedYear, month: normalizedMonth }),
  ]);
  const companyCurrencyInfo = companyCurrencyRows?.[0] || {};
  const localCurrency = String(companyCurrencyInfo.MainCurncy || '').trim();
  const settings = normalizeRateSettings(companyCurrencyInfo);
  const currencies = (currencyRows || [])
    .filter((currency) => String(currency.CurrCode || '').trim())
    .filter((currency) => !localCurrency || String(currency.CurrCode || '').trim() !== localCurrency)
    .map((currency) => ({
      code: String(currency.CurrCode || '').trim(),
      name: String(currency.CurrName || currency.CurrCode || '').trim(),
    }));
  const daysInMonth = new Date(normalizedYear, normalizedMonth, 0).getDate();
  const ratesByDay = {};
  (rateRows || []).forEach((row) => {
    const dateText = row.RateDate instanceof Date
      ? row.RateDate.toISOString().slice(0, 10)
      : String(row.RateDate || '').split('T')[0];
    const day = Number(dateText.slice(8, 10));
    const code = String(row.Currency || '').trim();
    if (!day || !code) return;
    if (!ratesByDay[day]) ratesByDay[day] = {};
    ratesByDay[day][code] = row.Rate != null ? fromSapStoredRate(row.Rate, settings) : '';
  });

  return {
    year: normalizedYear,
    month: normalizedMonth,
    localCurrency,
    postingMethod: settings.postingMethod,
    rateDecimalPlaces: settings.decimalPlaces,
    currencies,
    days: Array.from({ length: daysInMonth }, (_unused, index) => {
      const day = index + 1;
      return {
        day,
        rates: ratesByDay[day] || {},
      };
    }),
  };
};

const setCurrencyRate = async ({ currency, postingDate, date, rate }) => {
  const Currency = normalizeCurrencyCode(currency);
  const RateDate = normalizeSapRateDate(postingDate || date);
  const DisplayRate = Number(rate);

  if (!Currency) {
    const error = new Error('Currency is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!RateDate) {
    const error = new Error('Posting date is required to save the exchange rate.');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isFinite(DisplayRate) || DisplayRate <= 0) {
    const error = new Error('Exchange rate must be a positive number.');
    error.statusCode = 400;
    throw error;
  }

  const companyCurrencyRows = await salesOrderDb.getCompanyCurrencyInfo();
  const settings = normalizeRateSettings(companyCurrencyRows?.[0] || {});
  const Rate = toSapStoredRate(DisplayRate, settings);

  try {
    await sapService.request({
      method: 'post',
      url: '/SBOBobService_SetCurrencyRate',
      data: { Currency, RateDate: toSapActionDate(RateDate), Rate },
    });
  } catch (error) {
    throwExchangeRateSapError(error, 'saving');
  }

  return getCurrencyRate({ currency: Currency, date: RateDate });
};

module.exports = {
  getReferenceData,
  getCustomerDetails,
  getCustomerFilterOptions,
  getSalesOrderList,
  getSalesOrderFilterOptions,
  getReferenceDocumentLookup,
  getSalesOrder,
  submitSalesOrder,
  updateSalesOrder,
  getDocumentSeries,
  getNextNumber,
  getStateFromAddress,
  getItemsForModal,
  getFreightCharges,
  getSalesOrderPrintLayouts,
  createLookupValue,
  getLookupOptions,
  getCurrencyRate,
  getExchangeRatesForMonth,
  setCurrencyRate,
  _mergeCompanyCurrencyRows: mergeCompanyCurrencyRows,
  _resolveSalesOrderDocumentCurrency: resolveSalesOrderDocumentCurrency,
  _buildDocumentRoundingPayload: buildDocumentRoundingPayload,
  _buildDocumentLinePayload: buildDocumentLinePayload,
  getOpenSalesOrders:          async (customerCode = '') => { try { return { documents: await salesOrderDb.getOpenSalesOrders(customerCode) }; } catch(e) { return { documents: [] }; } },
  getSalesOrderForCopy:        async (d) => normalizeCopyDocumentRateForCompany(await salesOrderDb.getSalesOrderForCopy(d)),
  getOpenSalesQuotations:      async (customerCode = '') => { try { const sq = require('./salesQuotationDbService'); return { documents: await sq.getOpenSalesQuotations(customerCode) }; } catch(e) { return { documents: [] }; } },
  getSalesQuotationForCopy:    async (d) => { const sq = require('./salesQuotationDbService'); return normalizeCopyDocumentRateForCompany(await sq.getSalesQuotationForCopy(d)); },
};
