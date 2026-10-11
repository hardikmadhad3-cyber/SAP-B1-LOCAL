const { buildDocumentConfirmationPayload, updateDocumentConfirmationOnly } = require('./documentConfirmationUtils');
const sapService = require('./sapService');
const { buildDocumentRoundingPayload } = require('./documentRoundingPayloadUtils');
const apInvoiceDb = require('./apInvoiceDbService');
const purchaseOrderDb = require('./purchaseOrderDbService');
const { getDocumentFreightCharges } = require('./freightChargesDbService');
const { buildDocumentAdditionalExpenses } = require('./freightPayloadUtils');
const { getUdfDefinitions } = require('./udfMetadataService');
const { applyUdfValues, isBlankUdfValue, normalizeUdfValue } = require('./udfPayloadUtils');
const { buildAPInvoiceDocumentLine } = require('./apInvoicePayloadUtils');
const { applyPlaceOfSupplyUdf } = require('./placeOfSupplyUtils');
const { buildDocumentSeriesPayload } = require('./documentSeriesPayloadUtils');
const {
  applySapDocumentCurrency,
  loadCompanyCurrencyContext,
  loadDocumentCurrencyReferenceData,
  mergeCurrencyReferenceData,
  normalizeCopyDocumentRate,
} = require('./salesDocumentCurrencyService');

const formatDateForSAP = (value) => {
  if (!value) return null;
  return String(value).split('T')[0];
};

const parseNum = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const BATCH_QTY_TOLERANCE = 0.001;
const getRequiredBatchQty = (line = {}) => {
  const explicitFactor = parseNum(line.uomFactor ?? line.UomFactor ?? line.NumPerMsr);
  const factor = explicitFactor > 0 ? explicitFactor : 1;
  return parseNum(line.quantity ?? line.Quantity) * factor;
};

const createBatchSelectionError = (message, lineIndex, itemCode, type) => {
  const error = new Error(message);
  error.code = 'BATCH_SELECTION_REQUIRED';
  error.status = 400;
  error.statusCode = 400;
  error.details = { lines: [{ lineIndex, itemCode, type, message }] };
  return error;
};

const toSapYesNo = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ['Y', 'YES', 'TRUE', '1', 'TYES'].includes(normalized) ? 'tYES' : 'tNO';
};

const normalizeState = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const isGstTaxCode = (taxCode) => {
  const value = String(taxCode || '').trim().toUpperCase();
  return Boolean(value) && value.includes('GST') && !value.includes('NON-GST') && !value.includes('NONGST');
};

const buildSmartGstValidation = async (header, lines, vendor) => {
  const normalizedHeader = { ...(header || {}) };
  const populatedLines = (lines || []).filter((line) => line.itemNo && String(line.itemNo).trim());
  const headerGstin = String(normalizedHeader.gstin || vendor?.GSTIN || '').trim();
  const headerVendorState = String(normalizedHeader.vendorState || vendor?.State || '').trim();
  const placeOfSupply = String(normalizedHeader.placeOfSupply || '').trim();
  const expectedGstType =
    placeOfSupply && headerVendorState
      ? normalizeState(placeOfSupply) === normalizeState(headerVendorState) ? 'INTRASTATE' : 'INTERSTATE'
      : null;

  normalizedHeader.gstin = headerGstin;
  normalizedHeader.vendorState = headerVendorState;

  return {
    header: normalizedHeader,
    lines: populatedLines,
    warning: headerGstin
      ? null
      : {
        type: 'warning',
        code: 'GSTIN_MISSING',
        message: 'GSTIN missing - please verify tax calculation.',
      },
    expectedGstType,
  };
};

const getAllowedUdfKeys = async (tableId) => {
  const definitions = await getUdfDefinitions(tableId);
  return new Set(definitions.map((field) => field.key));
};

const getUdfDefinitionsByKey = async (tableId) => {
  const definitions = await getUdfDefinitions(tableId);
  return new Map(definitions.map((field) => [field.key, field]));
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

const setKnownUdfValue = (target, definitionsByKey, aliases, value) => {
  if (value === undefined) return;

  const normalizedAliases = aliases.map(normalizeUdfAlias);
  const matchedKey = Array.from(definitionsByKey.keys()).find((key) => normalizedAliases.includes(normalizeUdfAlias(key)));
  if (!matchedKey) return;
  if (isBlankUdfValue(value)) {
    target[matchedKey] = null;
    return;
  }
  const normalizedValue = normalizeUdfValue(value, definitionsByKey.get(matchedKey), matchedKey);
  if (normalizedValue !== undefined) target[matchedKey] = normalizedValue;
};

const calculateExpectedTotal = (header, lines) => {
  const subtotal = lines
    .filter((l) => l.itemNo && String(l.itemNo).trim())
    .reduce((sum, line) => {
      const qty = parseNum(line.quantity);
      const price = parseNum(line.unitPrice);
      const disc = parseNum(line.stdDiscount);
      return sum + (qty * price * (1 - disc / 100));
    }, 0);

  const headerDiscount = parseNum(header.discount);
  const freight = parseNum(header.freight);
  const tax = parseNum(header.tax);
  const discounted = subtotal - (subtotal * headerDiscount / 100);
  return Number((discounted + freight + tax).toFixed(2));
};

const buildWithholdingTaxData = (rows = []) =>
  (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.code || row?.WTCode || '').trim())
    .map((row) => {
      const category = String(row.categoryCode || row.category || 'I').trim().toUpperCase();
      return {
        WTCode: String(row.code || row.WTCode || '').trim(),
        TaxableAmount: parseNum(row.taxableAmount),
        WTAmount: parseNum(row.wtaxAmount ?? row.WTAmount),
        Category: category.startsWith('P') ? 'P' : 'I',
      };
    });

const validateAPInvoicePayload = async (payload, docEntry = null) => {
  const { header = {}, lines = [] } = payload || {};

  const cardCode = String(header.vendor || '').trim();
  if (!cardCode) throw new Error('CardCode present');

  const postingDate = formatDateForSAP(header.postingDate);
  if (!postingDate) throw new Error('DocDate present');

  const documentDate = formatDateForSAP(header.documentDate);
  if (!documentDate) throw new Error('Document Date is required');

  const dueDate = formatDateForSAP(header.deliveryDate || header.postingDate);
  if (!dueDate) throw new Error('Due Date is required');
  if (dueDate < postingDate) throw new Error('Due Date must be greater than or equal to Posting Date');

  const populatedLines = lines.filter((line) => line.itemNo && String(line.itemNo).trim());
  if (!populatedLines.length) throw new Error('DocumentLines not empty');

  const vendor = await apInvoiceDb.getVendorValidation(cardCode);
  if (!vendor || vendor.CardType !== 'S' || String(vendor.FrozenFor || '').toUpperCase() === 'Y') {
    throw new Error('Invalid vendor');
  }

  const branchesEnabled = await apInvoiceDb.getBranchEnabled();
  if (branchesEnabled && !String(header.branch || '').trim()) {
    throw new Error('Branch is required');
  }

  if (header.salesContractNo && await apInvoiceDb.isDuplicateVendorInvoiceNumber(cardCode, String(header.salesContractNo).trim(), docEntry)) {
    throw new Error('Duplicate vendor invoice number');
  }

  const smartGstValidation = await buildSmartGstValidation(header, populatedLines, vendor);

  const effectiveLines = smartGstValidation.lines;
  const expectedGstType = smartGstValidation.expectedGstType;
  const warnings = [];
  if (smartGstValidation.warning) {
    warnings.push(smartGstValidation.warning.message);
  }

  await apInvoiceDb.validateAPInvoiceBaseDocuments(effectiveLines);

  for (const [lineIndex, line] of effectiveLines.entries()) {
    const itemCode = String(line.itemNo || '').trim();
    if (!itemCode) throw new Error('ItemCode is required');

    const item = await apInvoiceDb.getItemValidation(itemCode);
    if (!item || item.PrchseItem !== 'Y' || String(item.validFor || '').toUpperCase() === 'N' || String(item.frozenFor || '').toUpperCase() === 'Y') {
      throw new Error(`Invalid item '${itemCode}'`);
    }

    if (parseNum(line.quantity) <= 0) throw new Error('Quantity must be > 0');
    if (parseNum(line.unitPrice) < 0) throw new Error('Price must be >= 0');

    // A direct Purchase Order -> A/P Invoice posts the receipt itself. Like
    // SAP B1, it therefore requires incoming batch allocation. A GRPO-based
    // invoice must not allocate batches again because stock was posted by GRPO.
    const requiresBatchAllocation = Number(line.baseType ?? line.BaseType) !== 20
      && String(item.ManBtchNum || '').trim().toUpperCase() === 'Y';
    if (requiresBatchAllocation) {
      const batches = Array.isArray(line.batches) ? line.batches : [];
      if (!batches.length) {
        throw createBatchSelectionError(
          `Batch selection is mandatory for batch-managed item ${itemCode}`,
          lineIndex,
          itemCode,
          'missing',
        );
      }
      const allocatedQty = batches.reduce(
        (total, batch) => total + parseNum(batch.quantity ?? batch.Quantity),
        0,
      );
      const requiredQty = getRequiredBatchQty(line);
      if (Math.abs(allocatedQty - requiredQty) > BATCH_QTY_TOLERANCE) {
        const inventoryUom = String(line.inventoryUOM || item.InvntryUom || line.uomCode || 'Base UoM').trim();
        throw createBatchSelectionError(
          `Batch quantity must match base quantity for item ${itemCode}. Required: ${requiredQty.toFixed(2)} ${inventoryUom}, Allocated: ${allocatedQty.toFixed(2)} ${inventoryUom}`,
          lineIndex,
          itemCode,
          'quantity',
        );
      }
    }

    const taxCode = String(line.taxCode || '').trim();
    if (!taxCode) throw new Error('TaxCode is required');
    if (!isGstTaxCode(taxCode)) throw new Error(`Tax code '${taxCode}' must be a valid GST tax code`);

    const taxCodeRow = await apInvoiceDb.getTaxCodeValidation(taxCode);
    if (!taxCodeRow) throw new Error(`Tax code '${taxCode}' is not valid`);
    if (expectedGstType && taxCodeRow.GSTType && taxCodeRow.GSTType !== 'OTHER' && taxCodeRow.GSTType !== expectedGstType) {
      warnings.push(`Tax code '${taxCode}' does not match derived GST type ${expectedGstType}.`);
    }

    const hasBaseDoc =
      line.baseEntry != null && line.baseEntry !== '' &&
      line.baseType != null && line.baseType !== '' &&
      line.baseLine != null && line.baseLine !== '';

    if (hasBaseDoc) {
      const baseType = parseInt(line.baseType, 10);
      const baseDocument = apInvoiceDb.resolveApInvoiceBaseDocument(baseType);
      if (!baseDocument) {
        const allowed = Object.values(apInvoiceDb.AP_INVOICE_BASE_DOCUMENTS)
          .map((item) => `${item.label} (${item.baseType})`)
          .join(' or ');
        throw new Error(`BaseType must be ${allowed}`);
      }
      const baseLineRow = await apInvoiceDb.getBaseDocumentOpenLineValidation(
        baseType, parseInt(line.baseEntry, 10), parseInt(line.baseLine, 10),
      );
      if (!baseLineRow) {
        throw new Error('BaseEntry must exist');
      }
      if (parseNum(line.quantity) > parseNum(baseLineRow.OpenQty)) {
        throw new Error(`Quantity exceeds open ${baseDocument.label} quantity`);
      }
    }

    const hasGlAccount = await apInvoiceDb.hasItemGLAccount(itemCode);
    if (!hasGlAccount) {
      throw new Error('G/L account missing');
    }
  }

  let populatedLineIndex = 0;
  return {
    header: smartGstValidation.header,
    lines: lines.map((line) => {
      if (!(line.itemNo && String(line.itemNo).trim())) {
        return line;
      }

      const effectiveLine = effectiveLines[populatedLineIndex];
      populatedLineIndex += 1;
      return effectiveLine ? { ...line, ...effectiveLine } : line;
    }),
    warning: warnings.length ? { type: 'warning', code: 'GST_WARNING', message: warnings.join(' ') } : null,
  };
};

const getReferenceData = async () => {
  try {
    const [data, currencyContext] = await Promise.all([
      apInvoiceDb.getReferenceData(),
      loadCompanyCurrencyContext(),
    ]);
    return mergeCurrencyReferenceData(data, currencyContext);
  } catch (error) {
    return {
      company: '',
      company_state: '',
      vendors: [],
      items: [],
      warehouses: [],
      warehouse_addresses: [],
      payment_terms: [],
      sales_employees: [],
      shipping_types: [],
      branches: [],
      states: [],
      tax_codes: [],
      withholding_tax_codes: [],
      uom_groups: [],
      contacts: [],
      pay_to_addresses: [],
      ship_to_addresses: [],
      bill_to_addresses: [],
      company_address: {},
      decimal_settings: { QtyDec: 2, PriceDec: 2, SumDec: 2, RateDec: 2, PercentDec: 2 },
      udf_metadata: { header: [], rows: [] },
      warnings: [`Failed to load reference data: ${error.message}`],
    };
  }
};

const getVendorDetails = async (vendorCode) => {
  try {
    return await apInvoiceDb.getVendorDetails(vendorCode);
  } catch (error) {
    console.error('[AP Invoice Service] Failed to load vendor details:', error);
    throw error;
  }
};

const getVendorFilterOptions = async ({
  query = '',
  vendorCode = '',
  vendorName = '',
  top,
  display = 'code',
} = {}) => {
  try {
    const rows = await purchaseOrderDb.searchVendors({
      query,
      cardCode: vendorCode,
      cardName: vendorName,
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

const getAPInvoiceList = async ({
  query = '',
  openOnly = false,
  docNum = '',
  vendorCode = '',
  vendorName = '',
  status = '',
  postingDateFrom = '',
  postingDateTo = '',
  page = 1,
  pageSize = 25,
} = {}) => {
  try {
    return await apInvoiceDb.getAPInvoiceList({
      query,
      openOnly,
      docNum,
      vendorCode,
      vendorName,
      status,
      postingDateFrom,
      postingDateTo,
      page,
      pageSize,
    });
  } catch (_error) {
    return {
      apInvoices: [],
      pagination: {
        page: Math.max(1, Number(page) || 1),
        pageSize: Math.min(200, Math.max(1, Number(pageSize) || 25)),
        totalCount: 0,
        totalPages: 1,
      },
    };
  }
};

const getAPInvoice = async (docEntry) => {
  try {
    return normalizeCopyDocumentRate(
      await apInvoiceDb.getAPInvoice(docEntry),
      await loadDocumentCurrencyReferenceData(),
    );
  } catch (error) {
    throw new Error(`Failed to load A/P Invoice: ${error.message}`);
  }
};

const getDocumentSeries = async (options = {}) => {
  try {
    return await apInvoiceDb.getDocumentSeries(options);
  } catch (_error) {
    return { series: [] };
  }
};

const getNextNumber = async (series) => {
  try {
    return await apInvoiceDb.getNextNumber(series);
  } catch (_error) {
    return { nextNumber: null };
  }
};

const getStateFromWarehouse = async (whsCode) => {
  try {
    return await apInvoiceDb.getStateFromWarehouse(whsCode);
  } catch (_error) {
    return { state: '' };
  }
};

const getOpenGRPO = async (vendorCode = null) => {
  try {
    return await apInvoiceDb.getOpenGRPO(vendorCode);
  } catch (_error) {
    return { orders: [] };
  }
};

const getBaseDocumentForCopy = async (docEntry, baseType) => {
  const baseDocument = apInvoiceDb.resolveApInvoiceBaseDocument(baseType);
  try {
    return normalizeCopyDocumentRate(
      await apInvoiceDb.getBaseDocumentForCopy(docEntry, baseType),
      await loadDocumentCurrencyReferenceData(),
    );
  } catch (error) {
    error.message = `Failed to load ${baseDocument?.label || 'base document'}: ${error.message}`;
    throw error;
  }
};

const getPurchaseOrderForCopy = (docEntry) => getBaseDocumentForCopy(docEntry, 22);

const getGRPOForCopy = async (docEntry) => {
  try {
    return normalizeCopyDocumentRate(
      await apInvoiceDb.getGRPOForCopy(docEntry),
      await loadDocumentCurrencyReferenceData(),
    );
  } catch (error) {
    error.message = `Failed to load GRPO: ${error.message}`;
    throw error;
  }
};

const submitAPInvoice = async (payload) => {
  try {
    const validatedPayload = await validateAPInvoicePayload(payload);
    const header = validatedPayload.header;
    const lines = validatedPayload.lines;
    const { header_udfs } = payload;
    const [allowedHeaderUdfs, allowedLineUdfs, headerUdfDefinitionsByKey, lineUdfDefinitionsByKey] = await Promise.all([
      getAllowedUdfKeys('OPCH'),
      getAllowedUdfKeys('PCH1'),
      getUdfDefinitionsByKey('OPCH'),
      getUdfDefinitionsByKey('PCH1'),
    ]);
    console.log('Validated Payload:', { header, lines, header_udfs });
    if (!String(header.gstin || '').trim()) {
      console.warn('GSTIN missing -> SAP may reject GST tax');
    }

    const documentLines = [];
    for (const l of lines.filter((line) => line.itemNo && String(line.itemNo).trim())) {
      documentLines.push(buildAPInvoiceDocumentLine(l, allowedLineUdfs, lineUdfDefinitionsByKey));
    }

    const documentAdditionalExpenses = buildDocumentAdditionalExpenses(payload.freightCharges);
    const withholdingTaxData = buildWithholdingTaxData(payload.withholdingTaxRows);

    const sapPayload = {
      CardCode: String(header.vendor || '').trim(),
      DocDate: formatDateForSAP(header.postingDate),
      DocDueDate: formatDateForSAP(header.deliveryDate || header.postingDate),
      TaxDate: formatDateForSAP(header.documentDate),
      Comments: header.otherInstruction || '',
      JournalMemo: header.journalRemark || '',
      NumAtCard: header.salesContractNo || '',
      DiscountPercent: header.discount ? parseFloat(header.discount) : 0,
      DocumentAdditionalExpenses: documentAdditionalExpenses,
      ...buildDocumentRoundingPayload(header),
      ...buildDocumentConfirmationPayload(header),
      DocumentLines: documentLines,
    };
    if (withholdingTaxData.length) {
      sapPayload.WithholdingTaxDataWTXCollection = withholdingTaxData;
    }

    Object.assign(sapPayload, buildDocumentSeriesPayload(header));
    if (header.shipToCode) sapPayload.ShipToCode = String(header.shipToCode).trim();
    if (header.payToCode) sapPayload.PayToCode = String(header.payToCode).trim();
    if (header.branch) sapPayload.BPLId = parseInt(header.branch, 10);
    if (header.paymentTerms) sapPayload.PaymentGroupCode = parseInt(header.paymentTerms, 10);
    if (header.salesEmployee !== '' && header.salesEmployee != null) sapPayload.SalesPersonCode = parseInt(header.salesEmployee, 10);
    if (header.freight) sapPayload.TotalExpenses = parseFloat(header.freight);
    if (header.shipToCode) sapPayload.ShipToCode = String(header.shipToCode).trim();
    if (header.payToCode) sapPayload.PayToCode = String(header.payToCode).trim();

    applyUdfValues(sapPayload, header_udfs, allowedHeaderUdfs, headerUdfDefinitionsByKey);
    applyPlaceOfSupplyUdf(sapPayload, headerUdfDefinitionsByKey, header.placeOfSupply);
    setKnownUdfValue(sapPayload, headerUdfDefinitionsByKey, ['TransactionType', 'TransType', 'DocumentType', 'DocType'], header.transactionType);
    setKnownUdfValue(sapPayload, headerUdfDefinitionsByKey, ['Indicator'], header.indicator);
    applySapDocumentCurrency(
      sapPayload,
      header,
      await loadDocumentCurrencyReferenceData(header),
    );
    console.log('Constructed SAP Payload:', sapPayload);

    const response = await sapService.request({
      method: 'POST',
      url: '/PurchaseInvoices',
      data: sapPayload,
    });

    return {
      success: true,
      message: 'A/P Invoice created successfully.',
      doc_entry: response.data.DocEntry,
      doc_num: response.data.DocNum,
      warning: validatedPayload.warning,
    };
  } catch (error) {
    throw error;
  }
};

const updateAPInvoice = async (docEntry, payload) => {
  const confirmationResult = await updateDocumentConfirmationOnly(docEntry, payload, 'PurchaseInvoices', sapService);
  if (confirmationResult) return confirmationResult;
  try {
    const validatedPayload = await validateAPInvoicePayload(payload, docEntry);
    const header = validatedPayload.header;
    const { header_udfs } = payload;
    const [allowedHeaderUdfs, headerUdfDefinitionsByKey] = await Promise.all([
      getAllowedUdfKeys('OPCH'),
      getUdfDefinitionsByKey('OPCH'),
    ]);
    const documentAdditionalExpenses = buildDocumentAdditionalExpenses(payload.freightCharges);
    const sapPayload = {
      Comments: header.otherInstruction || '',
      JournalMemo: header.journalRemark || '',
      DiscountPercent: header.discount ? parseFloat(header.discount) : 0,
      DocumentAdditionalExpenses: documentAdditionalExpenses,
      ...buildDocumentRoundingPayload(header),
      ...buildDocumentConfirmationPayload(header),
    };

    if (header.freight) sapPayload.TotalExpenses = parseFloat(header.freight);

    applyUdfValues(sapPayload, header_udfs, allowedHeaderUdfs, headerUdfDefinitionsByKey);
    applyPlaceOfSupplyUdf(sapPayload, headerUdfDefinitionsByKey, header.placeOfSupply);
    setKnownUdfValue(sapPayload, headerUdfDefinitionsByKey, ['TransactionType', 'TransType', 'DocumentType', 'DocType'], header.transactionType);
    setKnownUdfValue(sapPayload, headerUdfDefinitionsByKey, ['Indicator'], header.indicator);
    applySapDocumentCurrency(
      sapPayload,
      header,
      await loadDocumentCurrencyReferenceData(header),
    );

    await sapService.request({
      method: 'PATCH',
      url: `/PurchaseInvoices(${docEntry})`,
      data: sapPayload,
    });

    return {
      success: true,
      message: 'A/P Invoice updated successfully.',
      doc_entry: docEntry,
      warning: validatedPayload.warning,
    };
  } catch (error) {
    throw error;
  }
};

const getItemsForModal = async () => {
  try {
    const result = await apInvoiceDb.getItemsForModal();
    return { items: result };
  } catch (error) {
    throw new Error('Failed to fetch items: ' + error.message);
  }
};

const getFreightCharges = async (docEntry) => {
  try {
    const freightCharges = await getDocumentFreightCharges('PCH3', docEntry);
    return { freightCharges };
  } catch (_error) {
    return { freightCharges: [] };
  }
};

module.exports = {
  getReferenceData,
  getVendorDetails,
  getVendorFilterOptions,
  getAPInvoiceList,
  getAPInvoice,
  getDocumentSeries,
  getNextNumber,
  getStateFromWarehouse,
  getOpenGRPO,
  getBaseDocumentForCopy,
  getGRPOForCopy,
  getPurchaseOrderForCopy,
  submitAPInvoice,
  updateAPInvoice,
  getItemsForModal,
  getFreightCharges,
};
