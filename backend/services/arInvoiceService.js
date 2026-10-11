const { buildDocumentConfirmationPayload, updateDocumentConfirmationOnly } = require('./documentConfirmationUtils');
const { buildDocumentSeriesPayload } = require('./documentSeriesPayloadUtils');
const sapService = require('./sapService');
const { buildDocumentRoundingPayload } = require('./documentRoundingPayloadUtils');
const arInvoiceDb = require('./arInvoiceDbService');
const { getDocumentBpSelectionPolicy, assertDocumentBpSelection } = require('./documentBpSelectionPolicy');
const salesOrderDb = require('./salesOrderDbService');
const { buildDocumentAdditionalExpenses } = require('./freightPayloadUtils');
const { buildMarketingDocumentAddressPayload } = require('./documentAddressPayloadUtils');
const { getUdfDefinitions } = require('./udfMetadataService');
const { applyUdfValues, isBlankUdfValue, normalizeUdfValue } = require('./udfPayloadUtils');
const hsnCodeDbService = require('./hsnCodeDbService');
const {
  applySapDocumentCurrency,
  fromStoredDocumentRate,
  loadCompanyCurrencyContext,
  loadDocumentCurrencyReferenceData,
  mergeCurrencyReferenceData,
  normalizeCopyDocumentRateForCompany,
} = require('./salesDocumentCurrencyService');
const {
  buildMetadataValidatedStandardLine,
  filterMetadataValidatedUdfDefinitions,
  filterMetadataValidatedUdfs,
  intersectPhysicalUdfKeys,
  resolveMetadataUdfKey,
} = require('./salesDocumentLinePayloadUtils');

const normalizeBranchId = (branch) => {
  const normalized = String(branch || '').trim();
  const branchId = Number(normalized);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : undefined;
};

const getSapErrorMessage = (error, fallback = '') => {
  if (error?.response?.data?.error?.message?.value) return error.response.data.error.message.value;
  if (error?.response?.data?.error?.message) return error.response.data.error.message;
  return error?.message || fallback;
};

const isNumberingSeriesError = (error) => String(getSapErrorMessage(error)).includes('10000521');
const isManualSeriesSelection = (series) => String(series || '').trim().toLowerCase() === '__sap_manual__';

const resolveARInvoiceSeries = async (header = {}, lines = []) => {
 const branchId = normalizeBranchId(header.branch);
 if (['-1','manual','__sap_manual__'].includes(String(header.series).toLowerCase())) return { series: -1, branchId };
 const rows = await arInvoiceDb.getDocumentSeries(header.postingDate || header.documentDate, header.transactionType || '', branchId || '');
 const selected = rows.find(row => Number(row.Series) === Number(header.series));
 if (!selected) throw new Error('Select an eligible numbering series for the posting date and branch.');
 return { series: Number(selected.Series), branchId };
};

const isUdfValuePresent = (value) => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const addIfPresent = (target, key, value) => {
  if (!isUdfValuePresent(value)) return;
  target[key] = value;
};

const normalizeOptionalNumber = (value) => {
  if (!isUdfValuePresent(value)) return undefined;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
};

const getHeaderDiscountPercent = (header = {}) => {
  const rawValue = header.discount ?? header.DiscountPercent ?? header.DiscPrcnt;
  if (rawValue === undefined || rawValue === null) return undefined;
  const textValue = String(rawValue).replace(/,/g, '').trim();
  if (!textValue) return 0;
  const parsed = Number(textValue);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const parseLineNumber = (value, fallback = 0) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const yesNo = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['y', 'yes', 'true', '1', 'tyes'].includes(normalized) ? 'tYES' : 'tNO';
};

const buildWithholdingTaxData = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.code || row?.WTCode || '').trim())
    .map((row) => ({
      WTCode: String(row.code || row.WTCode || '').trim(),
      TaxableAmount: parseLineNumber(row.taxableAmount, 0),
      WTAmount: parseLineNumber(row.wtaxAmount || row.WTAmount, 0),
      Category: 'I',
    }));

const getLineTotal = (line = {}) => {
  const total = normalizeOptionalNumber(line.total ?? line.totalLC ?? line.LineTotal);
  return total !== undefined && total > 0 ? total : undefined;
};

const getLineUnitPrice = (line = {}) => {
  const enteredUnitPrice = normalizeOptionalNumber(line.unitPrice);
  if (enteredUnitPrice !== undefined) {
    return enteredUnitPrice;
  }

  const total = getLineTotal(line);
  const quantity = parseLineNumber(line.quantity, 0);
  const discount = parseLineNumber(line.stdDiscount ?? line.discountPercent, 0);
  const discountFactor = 1 - discount / 100;

  if (total !== undefined && quantity > 0 && discountFactor > 0) {
    return total / quantity / discountFactor;
  }

  return normalizeOptionalNumber(line.unitPrice);
};

const getLineDiscountPercent = (line = {}) => normalizeOptionalNumber(
  line.stdDiscount
  ?? line.discountPercent
  ?? line.DiscountPercent
  ?? line.DiscPrcnt,
);

const getUdfDefinitionsByKey = async (tableId) => {
  const definitions = await getUdfDefinitions(tableId).catch((error) => {
    console.warn(`[ARInvoiceService] Live ${tableId} UDF metadata is unavailable; UDFs will be omitted.`, error.message);
    return [];
  });
  return new Map(definitions.map((field) => [field.key, field]));
};

const getAllowedUdfKeys = async (tableId) => {
  const definitions = await getUdfDefinitions(tableId).catch((error) => {
    console.warn(`[ARInvoiceService] Live ${tableId} UDF metadata is unavailable; UDFs will be omitted.`, error.message);
    return [];
  });
  return new Set(definitions.map((field) => field.key));
};

const buildARInvoiceStandardLine = async ({
  line: sourceLine = {},
  fieldMetadata = {},
  allowedLineUdfs = new Set(),
  includeLineNum = false,
  omitItemCodeForBaseDocument = false,
  includeBatches = false,
  defaultDiscountPercent,
} = {}) => {
  const rawBaseType = sourceLine.baseType ?? sourceLine.BaseType;
  const rawBaseEntry = sourceLine.baseEntry ?? sourceLine.BaseEntry;
  const rawBaseLine = sourceLine.baseLine ?? sourceLine.BaseLine;
  const hasBaseDocument = [rawBaseType, rawBaseEntry, rawBaseLine]
    .every((value) => value !== undefined && value !== null && String(value).trim() !== '');
  const line = await buildMetadataValidatedStandardLine({
    line: {
      ...sourceLine,
      unitPrice: getLineUnitPrice(sourceLine),
      cogsDistRule: sourceLine.cogsDistRule || sourceLine.distRule,
    },
    fieldMetadata,
    includeLineNum,
    includeItemCode: !(omitItemCodeForBaseDocument && hasBaseDocument),
    defaultDiscountPercent,
    resolveUomEntry: salesOrderDb.resolveSalesOrderLineUomEntry,
    resolveHsnEntry: hsnCodeDbService.resolveHSNCodeToAbsEntry,
    resolveSacEntry: hsnCodeDbService.resolveSACCodeToAbsEntry,
  });

  if (
    includeBatches
    && Number(rawBaseType) !== 15
    && Array.isArray(sourceLine.batches)
    && sourceLine.batches.length > 0
  ) {
    const batchNumbers = sourceLine.batches
      .filter((batch) => String(batch.batchNumber || '').trim() && Number(batch.quantity) > 0)
      .map((batch) => ({
        BatchNumber: String(batch.batchNumber).trim(),
        Quantity: Number(batch.quantity),
      }));
    if (batchNumbers.length) line.BatchNumbers = batchNumbers;
  }

  const physicalUdfKeys = intersectPhysicalUdfKeys(allowedLineUdfs, fieldMetadata);
  applyUdfValues(
    line,
    filterMetadataValidatedUdfs(sourceLine.udf, physicalUdfKeys, fieldMetadata),
    physicalUdfKeys,
  );
  return line;
};

const normalizeUdfAlias = (value) =>
  String(value || '')
    .replace(/^U_/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();

const resolveUdfOptionValue = (field, value) => {
  const text = String(value ?? '').trim();
  if (!text || !Array.isArray(field?.options) || !field.options.length) return text;

  const normalizedText = text.toLowerCase();
  const byValue = field.options.find((option) => String(option.value || '').trim().toLowerCase() === normalizedText);
  if (byValue) return String(byValue.value);

  const byLabel = field.options.find((option) => String(option.label || '').trim().toLowerCase() === normalizedText);
  if (byLabel) return String(byLabel.value);

  return text;
};

const DOCUMENT_TYPE_CODE_BY_LABEL = {
  gsttaxinvoice: 'INV',
  taxinvoice: 'INV',
  billofsupply: 'BIL',
  gstdebitmemo: 'DBN',
  debitmemo: 'DBN',
};

const resolveDocumentTypeCode = (value) => {
  const text = String(value ?? '').trim();
  return DOCUMENT_TYPE_CODE_BY_LABEL[normalizeUdfAlias(text)] || text;
};

const setKnownUdfValue = (target, definitionsByKey, aliases, value) => {
  if (value === undefined) return;

  const normalizedAliases = aliases.map(normalizeUdfAlias);
  const matchedKey = Array.from(definitionsByKey.keys()).find((key) => normalizedAliases.includes(normalizeUdfAlias(key)));
  if (!matchedKey) return;
  if (isBlankUdfValue(value)) {
    target[matchedKey] = null;
    return;
  }

  const resolvedValue = resolveUdfOptionValue(definitionsByKey.get(matchedKey), value);
  target[matchedKey] = normalizeUdfAlias(matchedKey) === 'doctype'
    ? resolveDocumentTypeCode(resolvedValue)
    : resolvedValue;

  const normalizedValue = normalizeUdfValue(value, definitionsByKey.get(matchedKey), matchedKey);
  if (normalizedValue !== undefined) target[matchedKey] = normalizedValue;

};

// ───────── REFERENCE DATA (USING ODBC) ─────────

const getReferenceData = async (companyId) => {
  try {
    // Use ODBC/Direct SQL for GET operations
    const [rawData, currencyContext] = await Promise.all([
      arInvoiceDb.getReferenceData(),
      loadCompanyCurrencyContext(),
    ]);
    const data = mergeCurrencyReferenceData(rawData, currencyContext);
    data.bp_selection_policy = await getDocumentBpSelectionPolicy('arInvoice');
    if (data.customers && !data.vendors) {
      data.vendors = data.customers;
      delete data.customers;
      console.warn("⚠️ AR Invoice service normalized customers->vendors");
    }
    console.log("✅ AR Invoice reference data loaded:", data.vendors?.length || 0, "vendors");
    console.log("🔍 AR Invoice refData keys:", Object.keys(data));
    return data;
  } catch (error) {
    console.error('[AR Invoice Service] Failed to load reference data via ODBC:', error);
    if (error?.status === 503 || /\bis busy\b/i.test(String(error?.message || ''))) {
      throw error;
    }
    return {
      company: '',
      vendors: [],
      contacts: [],
      pay_to_addresses: [],
      items: [],
      warehouses: [],
      warehouse_addresses: [],
      payment_terms: [],
      shipping_types: [],
      branches: [],
      tax_codes: [],
      withholding_tax_codes: [],
      uom_groups: [],
      decimal_settings: {
        QtyDec: 2,
        PriceDec: 2,
        SumDec: 2,
        RateDec: 2,
        PercentDec: 2
      },
      matrix_columns: [],
      line_field_metadata: { matrix_columns: [], sap_form: {} },
      udf_metadata: { header: [], rows: [] },
      warnings: [`Failed to load reference data: ${error.message}`],
    };
  }
};

// ───────── CUSTOMER DETAILS (USING ODBC) ─────────

const getCustomerDetails = async (customerCode) => {
  try {
    // Use ODBC/Direct SQL for GET operations
    const data = await arInvoiceDb.getCustomerDetails(customerCode);
    return data;
  } catch (error) {
    console.error('[AR Invoice Service] Failed to load customer details via ODBC:', error);
    throw error;
  }
};

// ───────── AR INVOICE LIST (USING ODBC) ─────────

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

const getARInvoiceList = async ({
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
    const result = await arInvoiceDb.getARInvoiceList({
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
    console.error('[AR Invoice Service] Failed to load AR invoice list via ODBC:', error);
    return {
      ar_invoices: [],
      pagination: {
        page: Math.max(1, Number(page) || 1),
        pageSize: Math.min(200, Math.max(1, Number(pageSize) || 25)),
        totalCount: 0,
        totalPages: 1,
      },
    };
  }
};

// ───────── GET SINGLE INVOICE (USING ODBC) ─────────

const getARInvoice = async (docEntry) => {
  try {
    // Use ODBC for reading single invoice
    const [result, currencyContext] = await Promise.all([
      arInvoiceDb.getARInvoice(docEntry),
      loadCompanyCurrencyContext(),
    ]);
    const referenceData = mergeCurrencyReferenceData({}, currencyContext);
    if (result?.ar_invoice?.header?.exchangeRate) {
      result.ar_invoice.header.exchangeRate = String(
        fromStoredDocumentRate(result.ar_invoice.header.exchangeRate, referenceData),
      );
    }
    return result;
  } catch (error) {
    console.error('[AR Invoice Service] Failed to load AR invoice via ODBC:', error);
    throw error;
  }
};

// ───────── CREATE INVOICE (USING SERVICE LAYER) ─────────

const submitARInvoice = async (payload) => {
  let lastSapPayload = null;

  try {
    console.log("🔥 [ARInvoiceService] RECEIVED AR INVOICE PAYLOAD:", JSON.stringify(payload, null, 2));

    // Validate required fields
    if (!payload.header) {
      throw new Error('Header is required');
    }
    
    console.log("🔍 [ARInvoiceService] Header vendor:", payload.header.vendor);
    console.log("🔍 [ARInvoiceService] Header customerCode:", payload.header.customerCode);
    
    // Use vendor or customerCode (frontend sends vendor)
    const customerCode = payload.header.vendor || payload.header.customerCode || payload.header.customer;
    assertDocumentBpSelection(await getDocumentBpSelectionPolicy('arInvoice'), customerCode);
    
    if (!customerCode) {
      throw new Error('Customer code is required');
    }
    
    console.log("🔍 [ARInvoiceService] Using customer code:", customerCode);
    const incomingLines = payload.lines || [];
    await arInvoiceDb.validateARInvoiceBaseDocuments(incomingLines);
    const submittedLines = incomingLines.map((line) => (
      Number(line?.baseType ?? line?.BaseType) === 15
        ? { ...line, batches: [] }
        : line
    ));
    const resolvedSeries = await resolveARInvoiceSeries(payload.header, submittedLines);
    const batchResult = await arInvoiceDb.validateBatchSelection(submittedLines);
    if (!batchResult.isValid) {
      const error = new Error(batchResult.errors.join('; '));
      error.status = 400;
      error.code = 'BATCH_SELECTION_REQUIRED';
      error.details = { lines: batchResult.lineErrors || [] };
      throw error;
    }
    const documentAdditionalExpenses = buildDocumentAdditionalExpenses(payload.freightCharges);
    const [allowedLineUdfs, headerUdfDefinitionsByKey, headerFieldMetadata, lineFieldMetadata] = await Promise.all([
      getAllowedUdfKeys('INV1'),
      getUdfDefinitionsByKey('OINV'),
      arInvoiceDb.getARInvoiceHeaderTableFieldMetadata().catch((error) => {
        console.warn('[ARInvoiceService] Live OINV field metadata is unavailable; header UDFs will be omitted.', error.message);
        return {};
      }),
      arInvoiceDb.getARInvoiceLineTableFieldMetadata().catch((error) => {
        console.warn('[ARInvoiceService] Live INV1 field metadata is unavailable; using SAP-standard line fields only.', error.message);
        return {};
      }),
    ]);
    const documentLines = await Promise.all(submittedLines.map((line) => (
      buildARInvoiceStandardLine({
        line,
        fieldMetadata: lineFieldMetadata,
        allowedLineUdfs,
        omitItemCodeForBaseDocument: true,
        includeBatches: true,
      })
    )));
    const physicalHeaderUdfDefinitions = filterMetadataValidatedUdfDefinitions(
      headerUdfDefinitionsByKey,
      headerFieldMetadata,
    );
    const physicalHeaderUdfs = new Set(physicalHeaderUdfDefinitions.keys());
    const DiscountPercent = getHeaderDiscountPercent(payload.header);
    // Transform payload to SAP format
    const sapPayload = {
      CardCode: String(customerCode).trim(),

      // Series for auto-numbering - only include if explicitly provided and valid
      ...buildDocumentSeriesPayload(payload.header),

      DocDate: payload.header.postingDate || payload.header.documentDate,
      DocDueDate: payload.header.deliveryDate || payload.header.dueDate,
      TaxDate: payload.header.documentDate || payload.header.postingDate,

      ContactPersonCode: payload.header.contactPerson ? Number(payload.header.contactPerson) : undefined,
      SalesPersonCode:
        payload.header.salesEmployee != null &&
        String(payload.header.salesEmployee).trim() !== '' &&
        String(payload.header.salesEmployee) !== '-1'
          ? Number(payload.header.salesEmployee)
          : undefined,

      // Branch mapping
      ...(resolvedSeries.branchId ? {
        BPLId: resolvedSeries.branchId,
        BPL_IDAssignedToInvoice: resolvedSeries.branchId,
      } : {}),

      PaymentGroupCode: payload.header.paymentTerms ? Number(payload.header.paymentTerms) : undefined,
      ...(DiscountPercent !== undefined ? { DiscountPercent } : {}),

      // Customer reference
      NumAtCard: payload.header.salesContractNo || payload.header.customerRefNo || undefined,

      // Comments
      Comments: payload.header.otherInstruction || payload.header.comments || undefined,
      DocumentAdditionalExpenses: documentAdditionalExpenses,
      ...buildDocumentRoundingPayload(payload.header),
      ...buildDocumentConfirmationPayload(payload.header),
      ...buildMarketingDocumentAddressPayload(payload.header),

      DocumentLines: documentLines,
    };
    applySapDocumentCurrency(
      sapPayload,
      payload.header,
      await loadDocumentCurrencyReferenceData(payload.header),
    );
    lastSapPayload = sapPayload;

    addIfPresent(sapPayload, 'ShipToCode', payload.header.shipToCode);
    addIfPresent(sapPayload, 'PayToCode', payload.header.billToCode || payload.header.payToCode);
    addIfPresent(sapPayload, 'TransportationCode', normalizeOptionalNumber(payload.header.shippingType));
    addIfPresent(sapPayload, 'PaymentMethod', payload.header.paymentMethod);
    addIfPresent(sapPayload, 'DocumentsOwner', normalizeOptionalNumber(payload.header.ownerCode));
    // Leave SAP's company default intact unless a confirmation choice is present.
    const placeOfSupplyKey = resolveMetadataUdfKey(
      physicalHeaderUdfDefinitions,
      ['U_PlaceOfSupply', 'U_PLACE_OF_SUPPLY'],
    );
    if (placeOfSupplyKey) addIfPresent(sapPayload, placeOfSupplyKey, payload.header.placeOfSupply);
    const withholdingTaxData = buildWithholdingTaxData(payload.withholdingTaxRows);
    if (withholdingTaxData.length) {
      sapPayload.WithholdingTaxDataWTXCollection = withholdingTaxData;
    }

    console.log("🔥 [ARInvoiceService] SAP AR INVOICE PAYLOAD:", JSON.stringify(sapPayload, null, 2));

    applyUdfValues(sapPayload, payload.header_udfs, physicalHeaderUdfs, physicalHeaderUdfDefinitions);
    setKnownUdfValue(
      sapPayload,
      physicalHeaderUdfDefinitions,
      ['TransactionType', 'TransType', 'DocumentType', 'DocType'],
      payload.header.transactionTypeCode || payload.header.transactionType,
    );
    setKnownUdfValue(sapPayload, physicalHeaderUdfDefinitions, ['Indicator'], payload.header.indicator);

    let response;
    try {
      response = await sapService.request({
        method: 'post',
        url: '/Invoices',
        data: sapPayload,
      });
    } catch (postError) { throw postError; }

    console.log("✅ [ARInvoiceService] SAP AR INVOICE RESPONSE:", JSON.stringify(response.data, null, 2));

    return {
      message: 'AR Invoice created successfully',
      doc_num: response.data?.DocNum,
      doc_entry: response.data?.DocEntry,
      DocNum: response.data?.DocNum,
      DocEntry: response.data?.DocEntry,
    };
  } catch (error) {
    console.error('❌ [ARInvoiceService] Failed to create AR invoice:', error);
    console.error('❌ [ARInvoiceService] Error details:', error.response?.data);
    console.error('❌ [ARInvoiceService] Error stack:', error.stack);

    // Extract meaningful error message from SAP
    let errorMessage = 'AR Invoice submission failed.';
    errorMessage = getSapErrorMessage(error, errorMessage);

    if (String(errorMessage).includes('10000521') && lastSapPayload) {
      const submittedContext = [
        lastSapPayload.Series ? `Series=${lastSapPayload.Series}` : '',
        lastSapPayload.BPLId ? `BPLId=${lastSapPayload.BPLId}` : '',
      ].filter(Boolean).join(', ');
      if (submittedContext) {
        errorMessage = `${errorMessage} (submitted ${submittedContext})`;
      }
    }

    // Create a new error with the SAP message
    const sapError = new Error(errorMessage);
    sapError.response = error.response;
    throw sapError;
  }
};

// ───────── UPDATE INVOICE (USING SERVICE LAYER) ─────────

const updateARInvoice = async (docEntry, payload) => {
  const confirmationResult = await updateDocumentConfirmationOnly(docEntry, payload, 'Invoices', sapService);
  if (confirmationResult) return confirmationResult;
  try {
    const bpSelectionPolicy = await getDocumentBpSelectionPolicy('arInvoice');
    if (bpSelectionPolicy) {
      const existing = await arInvoiceDb.getARInvoice(docEntry);
      const incomingCode = payload.header?.vendor || payload.header?.customerCode || payload.header?.customer;
      assertDocumentBpSelection(bpSelectionPolicy, incomingCode, {
        existingCode: existing?.ar_invoice?.header?.customerCode,
      });
    }
    console.log("🔥 [ARInvoiceService] UPDATING AR INVOICE:", docEntry, JSON.stringify(payload, null, 2));

    // Use vendor or customerCode (frontend sends vendor)
    const customerCode = payload.header.vendor || payload.header.customerCode || payload.header.customer;
    const documentAdditionalExpenses = buildDocumentAdditionalExpenses(payload.freightCharges);
    const [allowedLineUdfs, headerUdfDefinitionsByKey, headerFieldMetadata, lineFieldMetadata] = await Promise.all([
      getAllowedUdfKeys('INV1'),
      getUdfDefinitionsByKey('OINV'),
      arInvoiceDb.getARInvoiceHeaderTableFieldMetadata().catch((error) => {
        console.warn('[ARInvoiceService] Live OINV field metadata is unavailable; header UDFs will be omitted.', error.message);
        return {};
      }),
      arInvoiceDb.getARInvoiceLineTableFieldMetadata().catch((error) => {
        console.warn('[ARInvoiceService] Live INV1 field metadata is unavailable; using SAP-standard line fields only.', error.message);
        return {};
      }),
    ]);
    const documentLines = await Promise.all((payload.lines || []).map((line) => (
      buildARInvoiceStandardLine({
        line,
        fieldMetadata: lineFieldMetadata,
        allowedLineUdfs,
        includeLineNum: true,
        defaultDiscountPercent: 0,
      })
    )));
    const physicalHeaderUdfDefinitions = filterMetadataValidatedUdfDefinitions(
      headerUdfDefinitionsByKey,
      headerFieldMetadata,
    );
    const physicalHeaderUdfs = new Set(physicalHeaderUdfDefinitions.keys());
    const DiscountPercent = getHeaderDiscountPercent(payload.header);
    // Transform payload to SAP format (similar to submit)
    const sapPayload = {
      CardCode: String(customerCode).trim(),
      DocDate: payload.header.postingDate || payload.header.documentDate,
      DocDueDate: payload.header.deliveryDate || payload.header.dueDate,
      TaxDate: payload.header.documentDate || payload.header.postingDate,
      ContactPersonCode: payload.header.contactPerson ? Number(payload.header.contactPerson) : undefined,
      SalesPersonCode:
        payload.header.salesEmployee != null &&
        String(payload.header.salesEmployee).trim() !== '' &&
        String(payload.header.salesEmployee) !== '-1'
          ? Number(payload.header.salesEmployee)
          : undefined,
      PaymentGroupCode: payload.header.paymentTerms ? Number(payload.header.paymentTerms) : undefined,
      ...(DiscountPercent !== undefined ? { DiscountPercent } : {}),
      NumAtCard: payload.header.salesContractNo || payload.header.customerRefNo || undefined,
      Comments: payload.header.otherInstruction || payload.header.comments || undefined,
      DocumentAdditionalExpenses: documentAdditionalExpenses,
      ...buildDocumentRoundingPayload(payload.header),
      ...buildDocumentConfirmationPayload(payload.header),
      ...buildMarketingDocumentAddressPayload(payload.header),

      DocumentLines: documentLines,
    };
    applySapDocumentCurrency(
      sapPayload,
      payload.header,
      await loadDocumentCurrencyReferenceData(payload.header),
    );

    addIfPresent(sapPayload, 'ShipToCode', payload.header.shipToCode);
    addIfPresent(sapPayload, 'PayToCode', payload.header.billToCode || payload.header.payToCode);
    addIfPresent(sapPayload, 'TransportationCode', normalizeOptionalNumber(payload.header.shippingType));
    addIfPresent(sapPayload, 'PaymentMethod', payload.header.paymentMethod);
    addIfPresent(sapPayload, 'DocumentsOwner', normalizeOptionalNumber(payload.header.ownerCode));
    // Preserve the stored SAP confirmation state during an invoice update.
    const placeOfSupplyKey = resolveMetadataUdfKey(
      physicalHeaderUdfDefinitions,
      ['U_PlaceOfSupply', 'U_PLACE_OF_SUPPLY'],
    );
    if (placeOfSupplyKey) addIfPresent(sapPayload, placeOfSupplyKey, payload.header.placeOfSupply);
    const withholdingTaxData = buildWithholdingTaxData(payload.withholdingTaxRows);
    if (withholdingTaxData.length) {
      sapPayload.WithholdingTaxDataWTXCollection = withholdingTaxData;
    }

    applyUdfValues(sapPayload, payload.header_udfs, physicalHeaderUdfs, physicalHeaderUdfDefinitions);
    setKnownUdfValue(
      sapPayload,
      physicalHeaderUdfDefinitions,
      ['TransactionType', 'TransType', 'DocumentType', 'DocType'],
      payload.header.transactionTypeCode || payload.header.transactionType,
    );
    setKnownUdfValue(sapPayload, physicalHeaderUdfDefinitions, ['Indicator'], payload.header.indicator);

    // Use Service Layer for PATCH operations
    const response = await sapService.request({
      method: 'patch',
      url: `/Invoices(${docEntry})`,
      data: sapPayload,
    });

    console.log("✅ [ARInvoiceService] AR INVOICE UPDATED:", response.data);

    return {
      message: 'AR Invoice updated successfully',
      doc_num: response.data?.DocNum,
      doc_entry: response.data?.DocEntry,
    };
  } catch (error) {
    console.error('❌ [ARInvoiceService] Failed to update AR invoice:', error);
    console.error('❌ [ARInvoiceService] Error details:', error.response?.data);
    throw error;
  }
};

// ───────── DOCUMENT SERIES ─────────

const getDocumentSeries = async (targetDate = null, transactionType = '', branch = '') => {
  try {
    const result = await arInvoiceDb.getDocumentSeries(targetDate, transactionType, branch);
    return { series: result };
  } catch (error) {
    console.error('[AR Invoice Service] Failed to load document series:', error);
    throw error;
  }
};

// ───────── NEXT NUMBER ─────────

const getNextNumber = async (series) => {
  try {
    const result = await arInvoiceDb.getNextNumber(series);
    return result;
  } catch (error) {
    console.error('[AR Invoice Service] Failed to get next number:', error);
    return { nextNumber: '' };
  }
};

// ───────── STATE FROM ADDRESS ─────────

const getStateFromAddress = async (cardCode, addressCode) => {
  try {
    const result = await arInvoiceDb.getStateFromAddress(cardCode, addressCode);
    return result;
  } catch (error) {
    console.error('[AR Invoice Service] Failed to get state from address:', error);
    return { state: '' };
  }
};

const getWarehouseState = async (whsCode) => {
  try {
    const result = await arInvoiceDb.getWarehouseState(whsCode);
    return result;
  } catch (error) {
    console.error('[AR Invoice Service] Failed to get warehouse state:', error);
    return { state: '' };
  }
};

const getBatchesByItem = async (itemCode, whsCode) => {
  try {
    const result = await arInvoiceDb.getBatchesByItem(itemCode, whsCode);
    return result;
  } catch (error) {
    console.error('[AR Invoice Service] Failed to get batches by item:', error);
    return { batches: [] };
  }
};

const getFreightCharges = async (docEntry) => {
  try {
    const result = await arInvoiceDb.getFreightCharges(docEntry);
    return { freightCharges: result };
  } catch (error) {
    console.error('[AR Invoice Service] Failed to get freight charges:', error);
    return { freightCharges: [] };
  }
};

const getItemsForModal = async () => {
  try {
    const items = await arInvoiceDb.getItemsForModal();
    return { items };
  } catch (error) {
    console.error('[AR Invoice] Failed to get items for modal:', error);
    return { items: [] };
  }
};
module.exports = {
  getReferenceData,
  getCustomerDetails,
  getCustomerFilterOptions,
  getARInvoiceList,
  getARInvoice,
  submitARInvoice,
  updateARInvoice,
  getDocumentSeries,
  getNextNumber,
  getStateFromAddress,
  getWarehouseState,
  getBatchesByItem,
  getFreightCharges,
  getItemsForModal,
  getOpenSalesOrders:      async (customerCode = null) => { 
    try { 
      return { documents: await arInvoiceDb.getOpenSalesOrders(customerCode) }; 
    } catch(e) { 
      return { documents: [] }; 
    } 
  },
  getSalesOrderForCopy:    async (d) => normalizeCopyDocumentRateForCompany(await arInvoiceDb.getSalesOrderForCopy(d)),
  getOpenDeliveries:       async (customerCode = null) => { 
    try { 
      return { documents: await arInvoiceDb.getOpenDeliveries(customerCode) }; 
    } catch(e) { 
      return { documents: [] }; 
    } 
  },
  getDeliveryForCopy:      async (d) => normalizeCopyDocumentRateForCompany(await arInvoiceDb.getDeliveryForCopy(d)),
  getOpenSalesQuotations:  async (customerCode = null) => { try { return { documents: await arInvoiceDb.getOpenSalesQuotations(customerCode) }; } catch(e) { return { documents: [] }; } },
  getSalesQuotationForCopy:async (d) => normalizeCopyDocumentRateForCompany(await arInvoiceDb.getSalesQuotationForCopy(d)),
  _getLineUnitPrice: getLineUnitPrice,
  _getLineDiscountPercent: getLineDiscountPercent,
};
