const dbService = require('./dbService');
const reportService = require('./reportService');
const { getActiveCompanyConfig } = require('./companyConfigService');
const { reportTableExists } = require('./reportMetadataService');
const {
  getSapDefaultReportCode,
  selectSapDefaultReportRow,
} = require('../utils/documentPrintDefaultLayout');

const DOCUMENT_PRINT_CONFIG = {
  salesQuotation: {
    aliases: ['sales-quotation', 'salesquotation', 'quotation', 'qut', '23'],
    label: 'Sales Quotation',
    objectType: '23',
    typeCode: 'QUT2',
    tableName: 'OQUT',
    filePrefix: 'sales-quotation',
  },
  delivery: {
    aliases: ['delivery', 'deliveries', 'dln', '15'],
    label: 'Delivery',
    objectType: '15',
    typeCode: 'DLN2',
    tableName: 'ODLN',
    filePrefix: 'delivery',
  },
  arInvoice: {
    aliases: ['ar-invoice', 'arinvoice', 'a/r-invoice', 'invoice', 'inv', '13'],
    label: 'A/R Invoice',
    objectType: '13',
    typeCode: 'INV2',
    tableName: 'OINV',
    filePrefix: 'ar-invoice',
  },
  serviceArInvoice: {
    aliases: ['service-ar-invoice', 'servicearinvoice', 'services-ar-invoice', 'service-invoice', 'serviceinv'],
    label: 'Service A/R Invoice',
    objectType: '13',
    typeCode: 'INV1',
    typeCodePrefix: 'INV',
    tableName: 'OINV',
    filePrefix: 'service-ar-invoice',
    contentType: 'service',
  },
  serviceApInvoice: {
    aliases: ['service-ap-invoice', 'serviceapinvoice', 'services-ap-invoice', 'service-purchase-invoice', 'servicepch'],
    label: 'Service A/P Invoice',
    objectType: '18',
    typeCode: 'PCH1',
    typeCodePrefix: 'PCH',
    tableName: 'OPCH',
    filePrefix: 'service-ap-invoice',
    contentType: 'service',
  },
  serviceApCreditMemo: {
    aliases: ['service-ap-credit-memo', 'serviceapcreditmemo', 'services-ap-credit-memo', 'service-purchase-credit-memo', 'servicerpc'],
    label: 'Service A/P Credit Memo',
    objectType: '19',
    typeCode: 'RPC1',
    typeCodePrefix: 'RPC',
    tableName: 'ORPC',
    filePrefix: 'service-ap-credit-memo',
    contentType: 'service',
  },
  serviceArCreditMemo: {
    aliases: ['service-ar-credit-memo', 'servicearcreditmemo', 'services-ar-credit-memo', 'service-sales-credit-memo', 'servicerin'],
    label: 'Service A/R Credit Memo',
    objectType: '14',
    typeCode: 'RIN1',
    typeCodePrefix: 'RIN',
    tableName: 'ORIN',
    filePrefix: 'service-ar-credit-memo',
    contentType: 'service',
  },
  arCreditMemo: {
    aliases: ['ar-credit-memo', 'arcreditmemo', 'a/r-credit-memo', 'credit-memo', 'rin', '14'],
    label: 'A/R Credit Memo',
    objectType: '14',
    typeCode: 'RIN2',
    tableName: 'ORIN',
    filePrefix: 'ar-credit-memo',
  },
  salesOrder: {
    aliases: ['sales-order', 'salesorder', 'order', 'rdr', '17'],
    label: 'Sales Order',
    objectType: '17',
    typeCode: 'RDR2',
    tableName: 'ORDR',
    filePrefix: 'sales-order',
  },
  purchaseQuotation: {
    aliases: ['purchase-quotation', 'purchasequotation', 'purchase-quote', 'pqt', '540000006'],
    label: 'Purchase Quotation',
    objectType: '540000006',
    typeCode: 'PQT2',
    tableName: 'OPQT',
    filePrefix: 'purchase-quotation',
  },
  purchaseOrder: {
    aliases: ['purchase-order', 'purchaseorder', 'po', 'por', '22'],
    label: 'Purchase Order',
    objectType: '22',
    typeCode: 'POR2',
    tableName: 'OPOR',
    filePrefix: 'purchase-order',
  },
  goodsReceiptPo: {
    aliases: ['goods-receipt-po', 'goodsreceiptpo', 'grpo', 'pdn', '20'],
    label: 'Goods Receipt PO',
    objectType: '20',
    typeCode: 'PDN2',
    tableName: 'OPDN',
    filePrefix: 'goods-receipt-po',
  },
  goodsReturn: {
    aliases: ['goods-return', 'goodsreturn', 'return', 'returns', 'rpd', '21'],
    label: 'Goods Return',
    objectType: '21',
    typeCode: 'RPD2',
    tableName: 'ORPD',
    filePrefix: 'goods-return',
  },
  goodsReceipt: {
    aliases: ['goods-receipt', 'goodsreceipt', 'inventory-goods-receipt', 'ign', '59'],
    label: 'Goods Receipt',
    objectType: '59',
    typeCode: 'IGN2',
    tableName: 'OIGN',
    filePrefix: 'goods-receipt',
  },
  goodsIssue: {
    aliases: ['goods-issue', 'goodsissue', 'inventory-goods-issue', 'ige', '60'],
    label: 'Goods Issue',
    objectType: '60',
    typeCode: 'IGE2',
    tableName: 'OIGE',
    filePrefix: 'goods-issue',
  },
  inventoryTransferRequest: {
    aliases: ['inventory-transfer-request', 'inventorytransferrequest', 'transfer-request', 'wtq', '1250000001'],
    label: 'Inventory Transfer Request',
    objectType: '1250000001',
    typeCode: 'WTQ2',
    tableName: 'OWTQ',
    filePrefix: 'inventory-transfer-request',
  },
  inventoryTransfer: {
    aliases: ['inventory-transfer', 'inventorytransfer', 'stock-transfer', 'wtr', '67'],
    label: 'Inventory Transfer',
    objectType: '67',
    typeCode: 'WTR2',
    tableName: 'OWTR',
    filePrefix: 'inventory-transfer',
  },
  apInvoice: {
    aliases: ['ap-invoice', 'apinvoice', 'a/p-invoice', 'purchase-invoice', 'pch', '18'],
    label: 'A/P Invoice',
    objectType: '18',
    typeCode: 'PCH2',
    tableName: 'OPCH',
    filePrefix: 'ap-invoice',
  },
  apCreditMemo: {
    aliases: ['ap-credit-memo', 'apcreditmemo', 'a/p-credit-memo', 'purchase-credit-memo', 'rpc', '19'],
    label: 'A/P Credit Memo',
    objectType: '19',
    typeCode: 'RPC2',
    tableName: 'ORPC',
    filePrefix: 'ap-credit-memo',
  },
};

const DOCUMENT_TYPE_BY_ALIAS = Object.entries(DOCUMENT_PRINT_CONFIG).reduce((map, [key, config]) => {
  map.set(key.toLowerCase(), key);
  config.aliases.forEach((alias) => map.set(alias.toLowerCase(), key));
  return map;
}, new Map());

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const normalizeDocumentType = (documentType) => {
  const normalized = String(documentType || '').trim().toLowerCase();
  const key = DOCUMENT_TYPE_BY_ALIAS.get(normalized);

  if (!key) {
    throw createHttpError(400, 'Unsupported document type for printing.');
  }

  return key;
};

const getDocumentPrintConfig = (documentType) => {
  const key = normalizeDocumentType(documentType);
  return {
    key,
    ...DOCUMENT_PRINT_CONFIG[key],
  };
};

const resolveActiveDatabaseSchema = async () => {
  const companyConfig = await getActiveCompanyConfig();

  const configuredSchema = String(
    companyConfig.sql.database ||
      companyConfig.reportService.defaultSchema ||
      companyConfig.reportService.companyDb ||
      companyConfig.serviceLayer.companyDb ||
      '',
  ).trim();

  if (configuredSchema) return configuredSchema;

  try {
    const databaseName = await dbService.resolveDatabaseName();
    if (databaseName) return String(databaseName).trim();
  } catch (_error) {
    // Fall through to the validation error raised by the caller.
  }

  return '';
};

const getAllowedPrintSchemas = async () => {
  const companyConfig = await getActiveCompanyConfig();
  return [
    companyConfig.sql.database,
    companyConfig.reportService.defaultSchema,
    companyConfig.reportService.companyDb,
    companyConfig.serviceLayer.companyDb,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
};

const resolvePrintSchema = async (schema) => {
  const defaultSchema = await resolveActiveDatabaseSchema();
  const normalizedSchema = toRequiredString(schema || defaultSchema, 'Schema');
  const allowedSchemas = await getAllowedPrintSchemas();
  const allowedSchemaSet = new Set(allowedSchemas.map((value) => value.toLowerCase()));

  if (allowedSchemaSet.size && !allowedSchemaSet.has(normalizedSchema.toLowerCase())) {
    throw createHttpError(
      403,
      `Schema ${normalizedSchema} is not assigned to the selected company session.`,
    );
  }

  return normalizedSchema;
};

const toRequiredString = (value, fieldName) => {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw createHttpError(400, `${fieldName} is required.`);
  }

  return normalized;
};

const toRequiredPositiveIntegerString = (value, fieldName) => {
  const normalized = toRequiredString(value, fieldName);

  if (!/^\d+$/.test(normalized) || Number(normalized) <= 0) {
    throw createHttpError(400, `${fieldName} must be a valid positive internal document key.`);
  }

  return normalized;
};

const requirePrintPermission = (auth) => {
  if (!auth?.userId || !auth?.companyId) {
    throw createHttpError(403, 'A valid company session is required to print document layouts.');
  }
};

const isActiveLayout = (layout = {}) => {
  const status = String(layout.status_code || layout.Status || '').trim().toUpperCase();
  return !status || status === 'A';
};

const isCrystalLayout = (layout = {}) => {
  const category = String(layout.category_code || layout.Category || '').trim().toUpperCase();
  if (category) return category === 'C';

  const type = String(layout.layout_type || '').trim().toLowerCase();
  return type.includes('crystal');
};

const isLayoutAvailableForDocumentMode = (config, layout) => {
  if (!isActiveLayout(layout)) return false;
  return String(layout.TypeCode || layout.type_code || '').trim().toUpperCase()
    === String(config.typeCode || '').trim().toUpperCase();
};

const filterActiveSapLayouts = (config, layouts = []) =>
  layouts.filter((layout) => isLayoutAvailableForDocumentMode(config, layout));

const filterDocumentLayouts = (config, layouts = []) =>
  filterActiveSapLayouts(config, layouts).filter((layout) => isCrystalLayout(layout));

const SAP_DEFAULT_LAYOUT_FLAG_COLUMNS = [
  'IsDefault',
  'IsDflt',
  'Dflt',
  'DfltLayout',
  'DfltReport',
  'PrintDefault',
  'DefaultLayout',
];

const serviceLayoutTypeCodeCache = new Map();

const resolveLayoutTypeCode = async (config, schema) => {
  if (config.contentType !== 'service') return config.typeCode;

  const cacheKey = `${String(schema || '').trim().toUpperCase()}:${config.key}`;
  if (serviceLayoutTypeCodeCache.has(cacheKey)) {
    return serviceLayoutTypeCodeCache.get(cacheKey);
  }

  const prefix = String(config.typeCodePrefix || config.typeCode || '').trim().toUpperCase();
  const result = await dbService.query(`
    SELECT TOP 1
      T0.TypeCode,
      T1.NAME AS TypeName
    FROM RDOC T0
    LEFT JOIN RTYP T1 ON T1.CODE = T0.TypeCode
    WHERE T0.Status = 'A'
      AND UPPER(T0.TypeCode) LIKE @typeCodePrefix
      AND (
        UPPER(T0.DocName) LIKE @servicePattern
        OR UPPER(COALESCE(T1.NAME, '')) LIKE @servicePattern
      )
    ORDER BY
      CASE WHEN UPPER(COALESCE(T1.NAME, '')) LIKE @servicePattern THEN 0 ELSE 1 END,
      T0.TypeCode
  `, {
    typeCodePrefix: `${prefix}%`,
    servicePattern: '%SERVICE%',
  }, { databaseName: schema });

  const detectedTypeCode = String(result.recordset?.[0]?.TypeCode || '').trim();
  const resolvedTypeCode = detectedTypeCode || config.typeCode;
  if (detectedTypeCode) {
    serviceLayoutTypeCodeCache.set(cacheKey, resolvedTypeCode);
  }
  return resolvedTypeCode;
};

const isTruthySapFlag = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ['1', 'Y', 'YES', 'T', 'TRUE'].includes(normalized);
};

const resolveMappedSapUserId = async (schema) => {
  const companyConfig = await getActiveCompanyConfig();
  const sapUserCode = String(
    companyConfig.userMapping?.sapUserCode
      || companyConfig.userMapping?.companySapUserCode
      || companyConfig.serviceLayer?.username
      || '',
  ).trim();
  if (!sapUserCode) return null;

  const result = await dbService.query(`
    SELECT TOP 1 USERID
    FROM OUSR
    WHERE USER_CODE = @sapUserCode
       OR U_NAME = @sapUserCode
    ORDER BY CASE WHEN USER_CODE = @sapUserCode THEN 0 ELSE 1 END, USERID
  `, { sapUserCode }, { databaseName: schema });

  return result.recordset?.[0]?.USERID ?? null;
};

const getSapAssignedDefaultLayout = async ({ typeCode, cardCode, schema }) => {
  const requiredColumns = ['DoumntDode', 'UserId', 'DfltReport', 'CardCode'];
  const optionalColumns = ['TYPE'];
  const availableColumns = await getExistingTableColumns(
    'RDFL',
    [...requiredColumns, ...optionalColumns],
    schema,
  );
  const availableColumnTokens = new Set(
    [...availableColumns].map((columnName) => String(columnName).trim().toUpperCase()),
  );
  if (requiredColumns.some((columnName) => !availableColumnTokens.has(columnName.toUpperCase()))) {
    return {
      docCode: '',
      source: 'SAP B1 RDFL unavailable',
      warnings: ['SAP B1 default-layout assignments are unavailable in this company schema.'],
    };
  }

  const typeSelect = availableColumnTokens.has('TYPE') ? ', TYPE' : '';
  const result = await dbService.query(`
    SELECT DoumntDode, UserId, DfltReport, CardCode${typeSelect}
    FROM RDFL
    WHERE DoumntDode = @typeCode
  `, { typeCode }, { databaseName: schema });
  const userId = await resolveMappedSapUserId(schema);
  const selectedRow = selectSapDefaultReportRow({
    rows: result.recordset || [],
    userId,
    cardCode,
  });

  return {
    docCode: getSapDefaultReportCode(selectedRow),
    source: selectedRow
      ? 'SAP B1 RDFL default (user/business partner)'
      : 'SAP B1 RDFL has no matching default',
    warnings: [],
    userId,
  };
};

const getSapLayoutRows = async (config, schema) => {
  const resolvedTypeCode = await resolveLayoutTypeCode(config, schema);
  const availableColumnSet = await getExistingTableColumns('RDOC', SAP_DEFAULT_LAYOUT_FLAG_COLUMNS, schema);
  const defaultFlagColumnSet = new Set(
    SAP_DEFAULT_LAYOUT_FLAG_COLUMNS.filter((columnName) => availableColumnSet.has(columnName)),
  );
  const defaultFlagColumns = [...defaultFlagColumnSet];
  const defaultFlagSelect = defaultFlagColumns.length
    ? `,\n      ${defaultFlagColumns.map((columnName) => `T0.${columnName} AS ${columnName}`).join(',\n      ')}`
    : '';

  const result = await dbService.query(`
    SELECT
      T0.DocCode AS layout_id,
      T0.DocName AS layout_name,
      CASE
        WHEN T0.Category = 'P' THEN 'PLD'
        WHEN T0.Category = 'C' THEN 'Crystal Reports'
        ELSE T0.Category
      END AS layout_type,
      CASE T0.Language
        WHEN 8 THEN 'English (UK)'
        WHEN 3 THEN 'English'
        WHEN 1 THEN 'Default'
        ELSE ''
      END AS language_name,
      T0.TypeCode AS type_code,
      T0.Category AS category_code,
      T0.Language AS language_code,
      T0.Status AS status_code,
      CASE
        WHEN T0.Category = 'C' THEN 1
        ELSE 0
      END AS is_export_supported,
      T0.DocCode,
      T0.DocName,
      T0.TypeCode,
      T0.Category,
      T0.Language,
      T0.Status
      ${defaultFlagSelect}
    FROM RDOC T0
    WHERE T0.TypeCode = @typeCode
      AND T0.Status = 'A'
    ORDER BY T0.DocCode
  `, { typeCode: resolvedTypeCode }, { databaseName: schema });

  return {
    layouts: result.recordset || [],
    defaultFlagColumns,
    typeCode: resolvedTypeCode,
  };
};

const selectSapAssignedLayout = ({
  config,
  layouts,
  defaultFlagColumns,
  docCode = '',
  assignedDefault = null,
}) => {
  const activeLayouts = filterActiveSapLayouts(config, layouts);
  const crystalLayouts = filterDocumentLayouts(config, layouts);
  const normalizedDocCode = String(docCode || '').trim();

  if (!activeLayouts.length) {
    throw createHttpError(404, `SAP B1 has no active layout assigned for ${config.label} (${config.typeCode}).`);
  }

  if (!crystalLayouts.length) {
    return {
      layout: null,
      layoutCandidates: activeLayouts,
      requiresLayoutSelection: true,
      selectionSource: 'SAP B1 Choose Layout list',
      warnings: [`SAP B1 has active ${config.label} layouts, but none are Crystal Report layouts available for PDF export.`],
    };
  }

  if (normalizedDocCode) {
    const selectedLayout = crystalLayouts.find((layout) =>
      String(layout.DocCode || layout.layout_id || '').trim().toLowerCase() === normalizedDocCode.toLowerCase(),
    );

    if (!selectedLayout) {
      throw createHttpError(404, `Layout ${normalizedDocCode} is not an active SAP B1 Crystal layout for ${config.label}.`);
    }

    return {
      layout: selectedLayout,
      layoutCandidates: activeLayouts,
      requiresLayoutSelection: false,
      selectionSource: 'SAP B1 Choose Layout selection',
      warnings: [],
    };
  }

  const assignedDocCode = String(assignedDefault?.docCode || '').trim();
  if (assignedDocCode) {
    const assignedLayout = crystalLayouts.find((layout) =>
      String(layout.DocCode || layout.layout_id || '').trim().toLowerCase()
        === assignedDocCode.toLowerCase(),
    );
    if (assignedLayout) {
      return {
        layout: assignedLayout,
        layoutCandidates: activeLayouts,
        requiresLayoutSelection: false,
        selectionSource: assignedDefault.source || 'SAP B1 RDFL default',
        warnings: assignedDefault.warnings || [],
      };
    }
  }

  const defaultLayouts = defaultFlagColumns.length
    ? crystalLayouts.filter((layout) => defaultFlagColumns.some((columnName) => isTruthySapFlag(layout[columnName])))
    : [];

  if (defaultLayouts.length === 1) {
    return {
      layout: defaultLayouts[0],
      layoutCandidates: activeLayouts,
      requiresLayoutSelection: false,
      selectionSource: `RDOC default flag (${defaultFlagColumns.join(', ')})`,
      warnings: [],
    };
  }

  if (defaultLayouts.length > 1) {
    return {
      layout: defaultLayouts[0],
      layoutCandidates: activeLayouts,
      requiresLayoutSelection: false,
      selectionSource: `RDOC default flag fallback (${defaultFlagColumns.join(', ')})`,
      warnings: [`SAP B1 exposes multiple legacy default flags for ${config.label}; the first active Crystal layout was selected.`],
    };
  }

  if (crystalLayouts.length === 1) {
    return {
      layout: crystalLayouts[0],
      layoutCandidates: activeLayouts,
      requiresLayoutSelection: false,
      selectionSource: 'Single active SAP B1 Crystal layout',
      warnings: defaultFlagColumns.length
        ? []
        : ['SAP RDOC default flag columns were not exposed; the only active Crystal layout was used.'],
    };
  }

  return {
    layout: crystalLayouts[0],
    layoutCandidates: activeLayouts,
    requiresLayoutSelection: false,
    selectionSource: 'First active SAP B1 Crystal layout fallback',
    warnings: [
      ...(assignedDefault?.warnings || []),
      `SAP B1 has no matching RDFL default for ${config.label}; the first active Crystal layout was selected.`,
    ],
  };
};

const getLayouts = async (documentType) => {
  const config = getDocumentPrintConfig(documentType);
  const defaultSchema = await resolvePrintSchema();
  const { layouts, typeCode } = await getSapLayoutRows(config, defaultSchema);
  const resolvedConfig = { ...config, typeCode };

  return {
    documentType: config.key,
    documentLabel: config.label,
    objectType: config.objectType,
    typeCode,
    defaultDocCode: '',
    defaultSchema,
    companyDatabase: defaultSchema,
    layouts: filterActiveSapLayouts(resolvedConfig, layouts),
    warnings: [],
  };
};

const getLayoutParameters = async ({
  documentType,
  docCode,
  schema,
  auth,
} = {}) => {
  requirePrintPermission(auth);

  const config = getDocumentPrintConfig(documentType);
  const normalizedDocCode = toRequiredString(docCode, 'Layout DocCode');
  const normalizedSchema = await resolvePrintSchema(schema);
  const typeCode = await resolveLayoutTypeCode(config, normalizedSchema);
  const layout = await getLayoutForDocument({ ...config, typeCode }, normalizedDocCode, normalizedSchema);
  const parameters = await reportService.loadReportParameters(normalizedDocCode, {
    reportCompanyDb: normalizedSchema,
  });
  const promptParameters = (parameters || [])
    .filter((parameter) => !reportService.isDocumentPrintSystemParameter(parameter.paramName))
    .map((parameter) => ({
      ...parameter,
      layoutDocCode: normalizedDocCode,
      layoutName: String(layout.DocName || '').trim(),
    }));

  return {
    documentType: config.key,
    documentLabel: config.label,
    objectType: config.objectType,
    typeCode,
    docCode: normalizedDocCode,
    layoutName: String(layout.DocName || '').trim(),
    schema: normalizedSchema,
    parameters: promptParameters,
  };
};

const normalizeOptionalText = (value) => String(value ?? '').trim();

const valuesMatch = (left, right) =>
  normalizeOptionalText(left).toLowerCase() === normalizeOptionalText(right).toLowerCase();

const appendDocumentContentTypeFilter = (config, filters) => {
  if (config.contentType === 'service') {
    filters.push("DocType = 'S'");
  }
};

const documentMatchesPrintIdentity = (document, { docNum = '', series = '', cardCode = '' } = {}) => {
  if (!document) return false;

  const expectedDocNum = normalizeOptionalText(docNum);
  const expectedSeries = normalizeOptionalText(series);
  const expectedCardCode = normalizeOptionalText(cardCode);

  if (expectedDocNum && !valuesMatch(document.DocNum, expectedDocNum)) return false;
  if (expectedSeries && !valuesMatch(document.Series, expectedSeries)) return false;
  if (expectedCardCode && !valuesMatch(document.CardCode, expectedCardCode)) return false;

  return true;
};

const getDocumentByPrintIdentity = async (
  config,
  { docNum = '', series = '', cardCode = '' } = {},
  { schema = '' } = {},
) => {
  const normalizedDocNum = normalizeOptionalText(docNum);
  const normalizedSeries = normalizeOptionalText(series);
  const normalizedCardCode = normalizeOptionalText(cardCode);

  if (!normalizedDocNum || (!normalizedSeries && !normalizedCardCode)) {
    return null;
  }

  const filters = ['DocNum = @docNum'];
  const params = { docNum: normalizedDocNum };
  appendDocumentContentTypeFilter(config, filters);

  if (normalizedSeries) {
    filters.push('Series = @series');
    params.series = normalizedSeries;
  }

  if (normalizedCardCode) {
    filters.push('UPPER(LTRIM(RTRIM(CardCode))) = @cardCode');
    params.cardCode = normalizedCardCode.toUpperCase();
  }

  const result = await dbService.query(`
    SELECT TOP 1 DocEntry, DocNum, Series, CardCode, CardName
    FROM ${config.tableName}
    WHERE ${filters.join('\n      AND ')}
    ORDER BY DocEntry DESC
  `, params, schema ? { databaseName: schema } : {});

  return result.recordset?.[0] || null;
};

const getDocumentSummary = async (config, docEntry, {
  schema = '',
  docNum = '',
  series = '',
  cardCode = '',
} = {}) => {
  const normalizedDocEntry = toRequiredPositiveIntegerString(docEntry, 'DocEntry');
  const filters = ['DocEntry = @docEntry'];
  appendDocumentContentTypeFilter(config, filters);
  const result = await dbService.query(`
    SELECT TOP 1 DocEntry, DocNum, Series, CardCode, CardName
    FROM ${config.tableName}
    WHERE ${filters.join('\n      AND ')}
  `, {
    docEntry: normalizedDocEntry,
  }, schema ? { databaseName: schema } : {});

  const document = result.recordset?.[0];

  if (document && documentMatchesPrintIdentity(document, { docNum, series, cardCode })) {
    return document;
  }

  const documentByPrintIdentity = await getDocumentByPrintIdentity(
    config,
    { docNum, series, cardCode },
    { schema },
  );

  if (documentByPrintIdentity) {
    if (document && String(document.DocEntry) !== String(documentByPrintIdentity.DocEntry)) {
      console.warn('[DocumentPrint] Corrected mismatched document key before Crystal export', {
        documentType: config.key,
        requestedDocEntry: normalizedDocEntry,
        requestedDocNum: normalizeOptionalText(docNum),
        requestedSeries: normalizeOptionalText(series),
        requestedCardCode: normalizeOptionalText(cardCode),
        correctedDocEntry: documentByPrintIdentity.DocEntry,
      });
    }

    return documentByPrintIdentity;
  }

  if (!document) {
    throw createHttpError(404, `${config.label} DocEntry ${normalizedDocEntry} was not found.`);
  }

  const expectedParts = [
    normalizeOptionalText(docNum) ? `DocNum ${normalizeOptionalText(docNum)}` : '',
    normalizeOptionalText(series) ? `Series ${normalizeOptionalText(series)}` : '',
    normalizeOptionalText(cardCode) ? `CardCode ${normalizeOptionalText(cardCode)}` : '',
  ].filter(Boolean).join(', ');

  throw createHttpError(
    409,
    `${config.label} DocEntry ${normalizedDocEntry} does not match the open document${expectedParts ? ` (${expectedParts})` : ''}. Reopen the document from Find and try printing again.`,
  );
};

const normalizeReportParameter = (parameter = {}, layout, resolvedSystemParameters = []) => {
  const paramName = String(parameter.paramName || parameter.name || '').trim();
  const resolvedSystemParameter = resolvedSystemParameters.find(
    (entry) => String(entry.name || '').trim().toUpperCase() === paramName.toUpperCase(),
  );

  return {
    ...parameter,
    paramName,
    name: paramName,
    type: parameter.paramType || parameter.type || resolvedSystemParameter?.type || 'string',
    value: resolvedSystemParameter?.value ?? parameter.value ?? parameter.defaultValue ?? '',
    layoutDocCode: String(layout.DocCode || layout.layout_id || '').trim(),
    layoutName: String(layout.DocName || layout.layout_name || '').trim(),
  };
};

const buildLayoutMetadata = (layout = {}, { selectionSource = '' } = {}) => ({
  docCode: String(layout.DocCode || layout.layout_id || '').trim(),
  layoutId: String(layout.DocCode || layout.layout_id || '').trim(),
  docName: String(layout.DocName || layout.layout_name || '').trim(),
  reportName: String(layout.DocName || layout.layout_name || '').trim(),
  typeCode: String(layout.TypeCode || layout.type_code || '').trim(),
  category: String(layout.Category || layout.category_code || '').trim(),
  status: String(layout.Status || layout.status_code || '').trim(),
  language: layout.Language ?? layout.language_code ?? '',
  languageName: String(layout.language_name || '').trim(),
  isCrystal: isCrystalLayout(layout),
  isExportSupported: Boolean(Number(layout.is_export_supported ?? 0)) || isCrystalLayout(layout),
  selectionSource,
});

const getDocumentReportMetadata = async ({
  documentType,
  docEntry,
  docNum,
  series,
  schema,
  docCode,
  cardCode,
  auth,
} = {}) => {
  requirePrintPermission(auth);

  const config = getDocumentPrintConfig(documentType);
  const normalizedDocEntry = toRequiredPositiveIntegerString(docEntry, 'DocEntry');
  const normalizedSchema = await resolvePrintSchema(schema);
  const document = await getDocumentSummary(config, normalizedDocEntry, {
    schema: normalizedSchema,
    docNum,
    series,
    cardCode,
  });
  const resolvedDocEntry = toRequiredPositiveIntegerString(document.DocEntry || normalizedDocEntry, 'Resolved DocEntry');
  const resolvedDocNum = String(document.DocNum || docNum || '').trim();
  const resolvedCardCode = String(document.CardCode || cardCode || '').trim();
  const documentMetadata = {
    docEntry: resolvedDocEntry,
    docNum: resolvedDocNum,
    series: String(document.Series || series || '').trim(),
    cardCode: resolvedCardCode,
    cardName: String(document.CardName || '').trim(),
  };
  // Companies without SAP's Crystal layout tables (e.g. local PostgreSQL companies)
  // have no SAP layouts to resolve; the document itself still loads.
  if (!(await reportTableExists('RDOC', { databaseName: normalizedSchema }))) {
    return {
      documentType: config.key,
      documentLabel: config.label,
      objectType: config.objectType,
      typeCode: config.typeCode,
      schema: normalizedSchema,
      companyDatabase: normalizedSchema,
      tableName: config.tableName,
      document: documentMetadata,
      layoutCandidates: [],
      requiresLayoutSelection: false,
      warnings: ['No SAP B1 Crystal layouts in this company (RDOC is not available).'],
      diagnostics: { layoutSource: 'RDOC unavailable', activeCrystalLayoutCount: 0 },
      layout: null,
      systemParameters: [],
      promptParameters: [],
      parameters: [],
    };
  }
  const { layouts, defaultFlagColumns, typeCode } = await getSapLayoutRows(config, normalizedSchema);
  const resolvedConfig = { ...config, typeCode };
  const assignedDefault = await getSapAssignedDefaultLayout({
    typeCode,
    cardCode: resolvedCardCode,
    schema: normalizedSchema,
  });
  const {
    layout,
    layoutCandidates,
    requiresLayoutSelection,
    selectionSource,
    warnings,
  } = selectSapAssignedLayout({
    config: resolvedConfig,
    layouts,
    defaultFlagColumns,
    docCode,
    assignedDefault,
  });
  const layoutCandidateMetadata = (layoutCandidates || []).map((candidate) =>
    buildLayoutMetadata(candidate, { selectionSource: 'SAP B1 active layout' }));
  const baseMetadata = {
    documentType: config.key,
    documentLabel: config.label,
    objectType: config.objectType,
    typeCode,
    schema: normalizedSchema,
    companyDatabase: normalizedSchema,
    tableName: config.tableName,
    document: documentMetadata,
    layoutCandidates: layoutCandidateMetadata,
    requiresLayoutSelection: Boolean(requiresLayoutSelection),
    warnings,
    diagnostics: {
      layoutSource: selectionSource,
      activeCrystalLayoutCount: filterDocumentLayouts(resolvedConfig, layouts).length,
      defaultFlagColumns,
      sapDefaultLayout: assignedDefault.docCode || '',
      sapDefaultUserId: assignedDefault.userId ?? null,
      reportService: 'SAP Business One Report Service / Crystal Reports',
    },
  };

  if (!layout) {
    return {
      ...baseMetadata,
      layout: null,
      systemParameters: [],
      promptParameters: [],
      parameters: [],
    };
  }

  const normalizedDocCode = String(layout.DocCode || layout.layout_id || '').trim();
  const parameters = await reportService.loadReportParameters(normalizedDocCode, {
    reportCompanyDb: normalizedSchema,
  });
  const systemParameters = await reportService.buildDocumentPrintParameters({
    docCode: normalizedDocCode,
    docEntry: resolvedDocEntry,
    docKeyValue: resolvedDocEntry,
    docNum: resolvedDocNum,
    schema: normalizedSchema,
    cardCode: resolvedCardCode,
    objectType: config.objectType,
  });
  const promptParameters = (parameters || [])
    .filter((parameter) => !reportService.isDocumentPrintSystemParameter(parameter.paramName || parameter.name))
    .map((parameter) => normalizeReportParameter(parameter, layout));

  return {
    ...baseMetadata,
    layout: buildLayoutMetadata(layout, { selectionSource }),
    systemParameters: systemParameters.map((parameter) => normalizeReportParameter(parameter, layout, systemParameters)),
    promptParameters,
    parameters: promptParameters,
  };
};

const getLayoutForDocument = async (config, docCode, schema = '') => {
  const normalizedDocCode = toRequiredString(docCode, 'Layout DocCode');
  const result = await dbService.query(`
    SELECT TOP 1 DocCode, DocName, TypeCode, Category, Status
    FROM RDOC
    WHERE DocCode = @docCode
      AND TypeCode = @typeCode
      AND Status = 'A'
  `, {
    docCode: normalizedDocCode,
    typeCode: config.typeCode,
  }, schema ? { databaseName: schema } : {});

  const layout = result.recordset?.[0];

  if (!layout) {
    throw createHttpError(404, `Layout ${normalizedDocCode} was not found for ${config.label}.`);
  }

  if (String(layout.Category || '').trim().toUpperCase() !== 'C') {
    throw createHttpError(422, `Layout ${normalizedDocCode} is a PLD layout. The PDF API exports Crystal layouts only.`);
  }

  return layout;
};

const SALES_ORDER_PRINT_UDF_SETTERS = {
  U_DocKey: 'DocEntry',
  U_ItemCode: 'ItemCode',
  U_Item_Desc: 'Dscription',
  U_UoM: "COALESCE(NULLIF(unitMsr, ''), NULLIF(UomCode, ''))",
};

const getExistingTableColumns = async (tableName, columnNames, schema) => {
  const result = await dbService.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = @tableName
      AND COLUMN_NAME IN (${columnNames.map((_, index) => `@columnName${index}`).join(', ')})
  `, columnNames.reduce((params, columnName, index) => ({
    ...params,
    [`columnName${index}`]: columnName,
  }), { tableName }), { databaseName: schema });

  return new Set((result.recordset || []).map((row) => String(row.COLUMN_NAME || '').trim()));
};

const hydrateSalesOrderPrintFields = async (config, docEntry, schema) => {
  if (config.key !== 'salesOrder') {
    return;
  }

  const normalizedDocEntry = toRequiredPositiveIntegerString(docEntry, 'DocEntry');
  const columnsToHydrate = Object.keys(SALES_ORDER_PRINT_UDF_SETTERS);
  const existingColumns = await getExistingTableColumns('RDR1', columnsToHydrate, schema);
  const setClauses = columnsToHydrate
    .filter((columnName) => existingColumns.has(columnName))
    .map((columnName) => `${columnName} = ${SALES_ORDER_PRINT_UDF_SETTERS[columnName]}`);

  if (!setClauses.length) {
    console.info('[DocumentPrint] Skipped sales order Crystal print UDF sync; no expected RDR1 UDF columns exist', {
      docEntry: normalizedDocEntry,
      schema,
      expectedColumns: columnsToHydrate,
    });
    return;
  }

  const result = await dbService.query(`
    UPDATE RDR1
    SET
      ${setClauses.join(',\n      ')}
    WHERE DocEntry = @docEntry
  `, {
    docEntry: normalizedDocEntry,
  }, { databaseName: schema });

  console.info('[DocumentPrint] Synced sales order Crystal print UDFs', {
    docEntry: normalizedDocEntry,
    rowsAffected: result.rowsAffected,
    columns: setClauses.map((clause) => clause.split('=')[0].trim()),
  });
};

const buildFileName = ({ config, docEntry, docNum, docCode }) =>
  `${config.filePrefix}-${docNum || docEntry}-${docCode}.pdf`;

const printDocument = async ({
  documentType,
  docEntry,
  docNum,
  series,
  schema,
  docCode,
  cardCode,
  reportParameters,
  auth,
} = {}) => {
  requirePrintPermission(auth);

  const metadata = await getDocumentReportMetadata({
    documentType,
    docEntry,
    docNum,
    series,
    schema,
    docCode,
    cardCode,
    auth,
  });

  const config = getDocumentPrintConfig(documentType);
  if (metadata.requiresLayoutSelection || !metadata.layout?.docCode) {
    throw createHttpError(
      400,
      `Choose a SAP B1 layout before printing ${metadata.documentLabel}.`,
    );
  }

  const normalizedDocCode = metadata.layout.docCode;

  const normalizedSchema = metadata.schema;
  const resolvedDocEntry = metadata.document.docEntry;
  const resolvedDocNum = metadata.document.docNum;
  const resolvedCardCode = metadata.document.cardCode;

  await hydrateSalesOrderPrintFields(config, resolvedDocEntry, normalizedSchema);

  console.info('[DocumentPrint] Starting document-key print', {
    documentType: config.key,
    documentLabel: config.label,
    tableName: config.tableName,
    docEntry: resolvedDocEntry,
    docCode: normalizedDocCode,
    series: metadata.document.series,
    schema: normalizedSchema,
    query: `SELECT TOP 1 DocEntry, DocNum, CardCode, CardName FROM ${config.tableName} WHERE DocEntry = @docEntry`,
    queryParameters: { docEntry: resolvedDocEntry },
    layoutSource: metadata.diagnostics.layoutSource,
  });

  const genericResponse = await reportService.exportDocumentPdf({
    docEntry: resolvedDocEntry,
    schema: normalizedSchema,
    docCode: normalizedDocCode,
    cardCode: resolvedCardCode,
    docNum: resolvedDocNum,
    objectType: config.objectType,
    reportParameters,
    documentLabel: config.label,
    fileName: buildFileName({
      config,
      docEntry: resolvedDocEntry,
      docNum: resolvedDocNum,
      docCode: normalizedDocCode,
    }),
  });

  return {
    message: `${config.label} PDF generated successfully.`,
    base64Pdf: genericResponse.base64Pdf,
    mimeType: genericResponse.mimeType,
    fileName: genericResponse.fileName,
    documentType: config.key,
    documentLabel: config.label,
    objectType: config.objectType,
    typeCode: config.typeCode,
    docEntry: resolvedDocEntry,
    docNum: resolvedDocNum,
    series: metadata.document.series,
    cardCode: resolvedCardCode,
    cardName: metadata.document.cardName,
    docKeyValue: genericResponse.docKeyValue,
    docCode: normalizedDocCode,
    layoutName: metadata.layout.docName,
    schema: normalizedSchema,
    reportMetadata: metadata,
  };
};

const downloadAllLayouts = async ({
  documentType,
  auth,
} = {}) => {
  requirePrintPermission(auth);
  const config = getDocumentPrintConfig(documentType);
  throw createHttpError(
    410,
    `Bulk export of every ${config.label} layout is disabled. Document printing must use the single active SAP B1 Crystal layout.`,
  );
};

// Document types the WhatsApp configuration page lists: { key, label }.
const listDocumentTypes = () => Object.entries(DOCUMENT_PRINT_CONFIG).map(([key, config]) => ({ key, label: config.label || key }));

module.exports = {
  listDocumentTypes,
  getDocumentPrintConfig,
  getLayouts,
  getLayoutParameters,
  getDocumentReportMetadata,
  printDocument,
  downloadAllLayouts,
};
