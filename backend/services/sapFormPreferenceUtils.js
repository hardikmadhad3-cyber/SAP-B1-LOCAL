const normalizePreferenceToken = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^U_/, '')
    .replace(/[^A-Z0-9]/g, '');

const isNumericOnly = (value) => /^\d+$/.test(String(value || '').trim());

const selectEffectiveCprfRows = (rows = [], { assignedTemplateIds = [] } = {}) => {
  const safeRows = (rows || []).filter(Boolean);
  if (!safeRows.length) return [];

  const assignedIds = [...new Set((assignedTemplateIds || [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))];
  const assignedTemplateId = assignedIds.find((templateId) => (
    safeRows.some((row) => Number(row.TPLId) === templateId)
  ));
  if (Number.isFinite(assignedTemplateId)) {
    return safeRows.filter((row) => Number(row.TPLId) === assignedTemplateId);
  }

  // TPLId 0 is the user's own Form Settings. Rows from configurable UI
  // templates can coexist in CPRF and must never be merged into that personal
  // layout, otherwise visibility and VisualIndx come from different layouts.
  const personalRows = safeRows.filter((row) => Number(row.TPLId || 0) === 0);
  if (personalRows.length) return personalRows;

  // Older companies can expose only template rows. Keep one template intact
  // rather than combining several templates into a layout SAP never renders.
  const firstTemplateId = safeRows
    .map((row) => Number(row.TPLId))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  return Number.isFinite(firstTemplateId)
    ? safeRows.filter((row) => Number(row.TPLId) === firstTemplateId)
    : safeRows;
};

const uniqueTokens = (values = []) => [...new Set(
  (values || []).map(normalizePreferenceToken).filter(Boolean)
)];

const findDefinitionByTokens = (tokens = [], definitions = []) => (
  (definitions || []).find((definition) => {
    const definitionTokens = uniqueTokens([
      definition.title,
      definition.fieldName,
      ...(definition.aliases || []),
      ...(definition.sapColumnIds || []),
    ]);
    return tokens.some((token) => definitionTokens.includes(token));
  }) || null
);

const findCprfStandardDefinition = ({
  row = {},
  preferredDefinitions = [],
  fallbackDefinitions = [],
} = {}) => {
  const hasExplicitUdfIdentity = [row.ColID, row.ItemUID]
    .some((value) => String(value || '').trim().toUpperCase().startsWith('U_'));
  if (hasExplicitUdfIdentity) return null;

  const descriptiveTokens = uniqueTokens([
    row.Caption,
    row.Title,
    row.Descr,
    row.ColAlias,
  ]);
  const identityTokens = uniqueTokens([
    row.ColID,
    row.ItemUID,
  ]);

  // A real caption is the safest identity across SAP patch levels. Within
  // each identity class, a document-specific definition must win over a
  // generic marketing-document fallback because numeric matrix IDs are not
  // universal across document forms.
  return findDefinitionByTokens(descriptiveTokens, preferredDefinitions)
    || findDefinitionByTokens(descriptiveTokens, fallbackDefinitions)
    || findDefinitionByTokens(identityTokens, preferredDefinitions)
    || findDefinitionByTokens(identityTokens, fallbackDefinitions);
};

const findCprfUdfDefinition = (row = {}, udfDefinitions = []) => {
  const explicitUdfIdentities = [row.ColID, row.ItemUID]
    .filter((value) => String(value || '').trim().toUpperCase().startsWith('U_'));
  const rowTokens = uniqueTokens([
    ...explicitUdfIdentities,
    row.Caption,
    row.Title,
    row.Descr,
    row.ColAlias,
  ]);

  return (udfDefinitions || []).find((field) => {
    const fieldTokens = uniqueTokens([
      field.key,
      field.sapField,
      field.aliasId,
      field.label,
      field.description,
    ]);
    return rowTokens.some((token) => fieldTokens.includes(token));
  }) || null;
};

const createSalesDocumentCprfDefinitions = ({
  totalLcColumnIds = [],
  totalDocColumnIds = [],
  warehouseColumnIds,
  uomCodeColumnIds,
  uomNameColumnIds,
}) => [
  { title: '#', fieldName: 'LineNum', aliases: ['#', 'LineNum'], sapColumnIds: ['0', '#', 'LineNum'], width: 42, dataType: 'number' },
  { title: 'Item No.', fieldName: 'ItemCode', aliases: ['Item No.', 'ItemNo'], sapColumnIds: ['1', 'ItemCode', 'Item No.', 'ItemNo'], width: 160, dataType: 'string' },
  { title: 'Item Description', fieldName: 'Dscription', aliases: ['Item Description'], sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Item Description'], width: 240, dataType: 'string' },
  { title: 'Quantity', fieldName: 'Quantity', aliases: ['Quantity', 'Qty'], sapColumnIds: ['11', 'Quantity', 'Qty'], width: 90, dataType: 'number' },
  { title: 'Unit Price', fieldName: 'Price', aliases: ['Unit Price'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'UnitPrice', 'Unit Price'], width: 110, dataType: 'number' },
  { title: 'Discount %', fieldName: 'DiscPrcnt', aliases: ['Discount %', 'Disc%'], sapColumnIds: ['15', 'DiscPrcnt', 'Discount %', 'Disc%'], width: 95, dataType: 'number' },
  { title: 'Tax Code', fieldName: 'TaxCode', aliases: ['Tax Code'], sapColumnIds: ['160', '234000377', 'VatGroup', 'TaxCode', 'Tax Code'], width: 115, dataType: 'string' },
  { title: 'Total (LC)', fieldName: 'LineTotal', aliases: ['Total (LC)', 'Total LC', 'Total'], sapColumnIds: [...totalLcColumnIds, 'LineTotal', 'Total (LC)', 'Total LC', 'Total'], width: 115, dataType: 'number' },
  { title: 'Total (Doc)', fieldName: 'TotalFrgn', aliases: ['Total (Doc)', 'Total Doc', 'Total (FC)', 'Total FC'], sapColumnIds: [...totalDocColumnIds, 'TotalFrgn', 'Total (Doc)', 'Total Doc', 'Total (FC)', 'Total FC'], width: 115, dataType: 'number' },
  { title: 'Gross Total', fieldName: 'GTotal', aliases: ['Gross Total', 'GrossTotal'], sapColumnIds: ['GTotal', 'GrossTotal', 'Gross Total'], width: 120, dataType: 'number' },
  { title: 'Whse', fieldName: 'WhsCode', aliases: ['Whse', 'Warehouse'], sapColumnIds: [...warehouseColumnIds, 'WhsCode', 'WarehouseCode', 'Warehouse', 'Whse'], width: 90, dataType: 'string' },
  { title: 'Distr. Rule', fieldName: 'OcrCode', aliases: ['Distr. Rule', 'Distribution Rule'], sapColumnIds: ['21', 'OcrCode', 'Distr. Rule', 'DistributionRule'], width: 105, dataType: 'string' },
  { title: 'UoM Code', fieldName: 'UomCode', aliases: ['UoM Code', 'UoM'], sapColumnIds: [...uomCodeColumnIds, 'UomCode', 'UoMCode', 'UoM Code'], width: 105, dataType: 'string' },
  { title: 'COGS Distr. Rule', fieldName: 'CogsOcrCod', aliases: ['COGS Distr. Rule'], sapColumnIds: ['29', 'CogsOcrCod', 'COGS Distr. Rule'], width: 135, dataType: 'string' },
  { title: 'Country/Region of Origin', fieldName: 'CountryOrg', aliases: ['Country/Region of Origin'], sapColumnIds: ['10002037', 'CountryOrg', 'Country/Region of Origin'], width: 185, dataType: 'string' },
  { title: 'Loc.', fieldName: 'LocCode', aliases: ['Loc.', 'Location'], sapColumnIds: ['10002047', '2000002049', 'LocCode', 'Location', 'Loc.'], width: 115, dataType: 'string' },
  { title: 'Blanket Agreement No.', fieldName: 'AgrNo', aliases: ['Blanket Agreement No.'], sapColumnIds: ['1000', 'AgrNo', 'Blanket Agreement No.'], width: 170, dataType: 'string' },
  { title: 'HSN', fieldName: 'HsnEntry', aliases: ['HSN', 'HSN/SAC'], sapColumnIds: ['254000391', 'HsnEntry', 'HsnCode', 'HSN', 'HSN/SAC'], width: 115, dataType: 'string' },
  { title: 'SAC', fieldName: 'SacEntry', aliases: ['SAC'], sapColumnIds: ['254000393', 'SacEntry', 'SACEntry', 'SacCode', 'SAC'], width: 95, dataType: 'string' },
  { title: 'In Stock', fieldName: 'OnHand', aliases: ['In Stock', 'InStock', 'On Hand'], sapColumnIds: ['OnHand', 'InStock', 'In Stock', 'On Hand'], width: 105, dataType: 'number' },
  { title: 'UoM Name', fieldName: 'unitMsr', aliases: ['UoM Name', 'UOM Name'], sapColumnIds: [...uomNameColumnIds, 'unitMsr', 'UomName', 'UoM Name'], width: 120, dataType: 'string' },
  { title: 'Qty in Whse', fieldName: 'WhsQty', aliases: ['Qty in Whse', 'Qty in Warehouse'], sapColumnIds: ['WhsQty', 'QtyInWhse', 'Qty in Whse', 'Qty in Warehouse'], width: 115, dataType: 'number' },
  { title: 'Delivery Date', fieldName: 'ShipDate', aliases: ['Delivery Date', 'Del. Date'], sapColumnIds: ['25', 'ShipDate', 'Delivery Date', 'Del. Date'], width: 125, dataType: 'date' },
];

// SAP reuses marketing-document matrix column IDs when the document switches
// from Item to Service mode. In particular, ColID 1 represents the G/L
// Account, not ItemCode, and ColID 3 is the service Description. Keep these
// definitions ahead of the generic item-document definitions.
const createServiceDocumentCprfDefinitions = () => [
  { title: '#', fieldName: 'LineNum', aliases: ['#', 'LineNum'], sapColumnIds: ['0', '#', 'LineNum'], width: 42, dataType: 'number' },
  { title: 'G/L Account', fieldName: 'AcctCode', aliases: ['G/L Account', 'GL Account', 'Account Code'], sapColumnIds: ['1', 'AcctCode', 'AccountCode', 'G/L Account', 'GL Account'], width: 145, dataType: 'string' },
  { title: 'Description', fieldName: 'Dscription', aliases: ['Description', 'Item Description'], sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Description', 'Item Description'], width: 240, dataType: 'string' },
  { title: 'Quantity', fieldName: 'Quantity', aliases: ['Quantity', 'Qty'], sapColumnIds: ['11', 'Quantity', 'Qty'], width: 90, dataType: 'number' },
  { title: 'Unit Price', fieldName: 'Price', aliases: ['Unit Price'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'UnitPrice', 'Unit Price'], width: 110, dataType: 'number' },
  { title: 'Discount %', fieldName: 'DiscPrcnt', aliases: ['Discount %', 'Disc%'], sapColumnIds: ['15', 'DiscPrcnt', 'Discount %', 'Disc%'], width: 95, dataType: 'number' },
  { title: 'Tax Code', fieldName: 'VatGroup', aliases: ['Tax Code'], sapColumnIds: ['160', '234000377', 'VatGroup', 'TaxCode', 'Tax Code'], width: 115, dataType: 'string' },
  { title: 'Total (LC)', fieldName: 'LineTotal', aliases: ['Total (LC)', 'Total LC', 'Total'], sapColumnIds: ['17', 'LineTotal', 'Total (LC)', 'Total LC', 'Total'], width: 115, dataType: 'number' },
  { title: 'Total (Doc)', fieldName: 'TotalFrgn', aliases: ['Total (Doc)', 'Total Doc', 'Total (FC)', 'Total FC'], sapColumnIds: ['23', 'TotalFrgn', 'RowTotalFC', 'Total (Doc)', 'Total Doc'], width: 115, dataType: 'number' },
  { title: 'Distr. Rule', fieldName: 'OcrCode', aliases: ['Distr. Rule', 'Distribution Rule'], sapColumnIds: ['21', 'OcrCode', 'CostingCode', 'Distr. Rule', 'Distribution Rule'], width: 120, dataType: 'string' },
  { title: 'Project', fieldName: 'Project', aliases: ['Project', 'Project Code'], sapColumnIds: ['Project', 'ProjectCode'], width: 125, dataType: 'string' },
  { title: 'WTax Liable', fieldName: 'WTLiable', aliases: ['WTax Liable', 'WT Liable'], sapColumnIds: ['WTLiable', 'WTaxLiable'], width: 105, dataType: 'yesNo' },
  { title: 'SAC', fieldName: 'SacEntry', aliases: ['SAC'], sapColumnIds: ['254000393', 'SacEntry', 'SACEntry', 'SacCode', 'SAC'], width: 95, dataType: 'string' },
  { title: 'Loc.', fieldName: 'LocCode', aliases: ['Loc.', 'Location'], sapColumnIds: ['10002047', '2000002049', 'LocCode', 'Location', 'Loc.'], width: 115, dataType: 'string' },
  { title: 'Blanket Agreement No.', fieldName: 'AgrNo', aliases: ['Blanket Agreement No.'], sapColumnIds: ['1000', 'AgrNo', 'AgreementNo', 'Blanket Agreement No.'], width: 170, dataType: 'string' },
  { title: 'Tax Amount (LC)', fieldName: 'VatSum', aliases: ['Tax Amount (LC)', 'Tax Amount'], sapColumnIds: ['VatSum', 'TaxAmount', 'Tax Amount (LC)'], width: 125, dataType: 'number' },
];

const createPurchaseRequestCprfDefinitions = () => [
  { title: '#', fieldName: 'LineNum', aliases: ['#', 'LineNum'], sapColumnIds: ['0', '#', 'LineNum'], width: 42, dataType: 'number' },
  { title: 'Item No.', fieldName: 'ItemCode', aliases: ['Item No.', 'ItemNo'], sapColumnIds: ['1', 'ItemCode', 'Item No.', 'ItemNo'], width: 130, dataType: 'string' },
  { title: 'Item Description', fieldName: 'Dscription', aliases: ['Item Description', 'Description'], sapColumnIds: ['3', 'Dscription', 'ItemDescription', 'Item Description'], width: 220, dataType: 'string' },
  { title: 'Vendor', fieldName: 'LineVendor', aliases: ['Vendor', 'Preferred Vendor'], sapColumnIds: ['LineVendor', 'Vendor', 'Preferred Vendor'], width: 120, dataType: 'string' },
  { title: 'Required Date', fieldName: 'ReqDate', aliases: ['Required Date'], sapColumnIds: ['5', 'ReqDate', 'RequiredDate', 'Required Date'], width: 125, dataType: 'date' },
  { title: 'Required Qty.', fieldName: 'Quantity', aliases: ['Required Qty.', 'Required Qty', 'Required Quantity', 'Quantity', 'Qty'], sapColumnIds: ['11', 'Quantity', 'ReqQty', 'Required Qty.', 'Required Qty'], width: 100, dataType: 'number' },
  { title: 'Info Price', fieldName: 'Price', aliases: ['Info Price', 'Unit Price'], sapColumnIds: ['14', 'Price', 'PriceBefDi', 'UnitPrice', 'Info Price'], width: 100, dataType: 'number' },
  { title: 'Discount %', fieldName: 'DiscPrcnt', aliases: ['Discount %', 'Disc%'], sapColumnIds: ['15', 'DiscPrcnt', 'Discount %', 'Disc%'], width: 95, dataType: 'number' },
  { title: 'Tax Code', fieldName: 'TaxCode', aliases: ['Tax Code'], sapColumnIds: ['160', '234000377', 'VatGroup', 'TaxCode', 'Tax Code'], width: 105, dataType: 'string' },
  { title: 'Total (LC)', fieldName: 'LineTotal', aliases: ['Total (LC)', 'Total LC', 'Total'], sapColumnIds: ['17', 'LineTotal', 'Total (LC)', 'Total LC', 'Total'], width: 110, dataType: 'number' },
  { title: 'Distr. Rule', fieldName: 'OcrCode', aliases: ['Distr. Rule', 'Distribution Rule'], sapColumnIds: ['21', 'OcrCode', 'Distr. Rule', 'DistributionRule'], width: 105, dataType: 'string' },
  { title: 'UoM Code', fieldName: 'UomCode', aliases: ['UoM Code', 'UoM'], sapColumnIds: ['1470002149', 'UomCode', 'UoMCode', 'UoM Code'], width: 100, dataType: 'string' },
  { title: 'Whse', fieldName: 'WhsCode', aliases: ['Whse', 'Warehouse'], sapColumnIds: ['24', 'WhsCode', 'WarehouseCode', 'Warehouse', 'Whse'], width: 85, dataType: 'string' },
];

const DOCUMENT_CPRF_COLUMN_DEFS = {
  SALES_QUOTATION: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: [],
    warehouseColumnIds: [],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  SALES_ORDER: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: ['23'],
    warehouseColumnIds: ['24'],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  DELIVERY: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    // Delivery numeric column IDs can differ by SAP patch/localization. Keep
    // Total (Doc) caption/field matching live without inventing an unsafe ID.
    totalDocColumnIds: [],
    warehouseColumnIds: ['174'],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  AR_INVOICE: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: [],
    warehouseColumnIds: [],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  AR_CREDIT_MEMO: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: [],
    warehouseColumnIds: [],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  PURCHASE_REQUEST: createPurchaseRequestCprfDefinitions(),
  PURCHASE_QUOTATION: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: ['23'],
    warehouseColumnIds: ['24'],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  PURCHASE_ORDER: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: ['23'],
    warehouseColumnIds: ['24'],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  GRPO: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: ['23'],
    warehouseColumnIds: ['24'],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  AP_INVOICE: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: ['23'],
    warehouseColumnIds: ['24'],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  AP_CREDIT_MEMO: createSalesDocumentCprfDefinitions({
    totalLcColumnIds: ['17'],
    totalDocColumnIds: ['23'],
    warehouseColumnIds: ['24'],
    uomCodeColumnIds: ['1470002149'],
    uomNameColumnIds: ['1470002145'],
  }),
  SERVICE_AR_INVOICE: createServiceDocumentCprfDefinitions(),
  SERVICE_AR_CREDIT_MEMO: createServiceDocumentCprfDefinitions(),
  SERVICE_AP_INVOICE: createServiceDocumentCprfDefinitions(),
  SERVICE_AP_CREDIT_MEMO: createServiceDocumentCprfDefinitions(),
};

const getSalesDocumentCprfDefinitions = (documentType) => (
  DOCUMENT_CPRF_COLUMN_DEFS[String(documentType || '').trim().toUpperCase()] || []
);

const getLayoutColumnDedupeKey = (column = {}) => {
  const fieldKey = normalizePreferenceToken(column.fieldName);
  const titleKey = normalizePreferenceToken(column.columnTitle);
  const rawFieldKey = String(column.fieldName || column.columnUid || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '');
  return column.isUdf
    ? `UDF|${rawFieldKey || fieldKey || titleKey}|${titleKey || fieldKey}`
    : `STD|${fieldKey || titleKey}|${titleKey || fieldKey}`;
};

const shouldReplaceCprfLayoutColumn = (current, next) => {
  if (!current) return true;

  // The physical SAP/UDF column is authoritative. Generated numeric matrix
  // companions can carry different visibility/order values for the same
  // semantic field and must not override it.
  const currentNumericUid = isNumericOnly(current.columnUid);
  const nextNumericUid = isNumericOnly(next.columnUid);
  if (currentNumericUid !== nextNumericUid) return !nextNumericUid;

  if (current.visible !== next.visible) return next.visible;
  if (current.editable !== next.editable) return next.editable;

  const currentOrder = Number(current.columnOrder);
  const nextOrder = Number(next.columnOrder);
  if (Number.isFinite(currentOrder) && Number.isFinite(nextOrder) && currentOrder !== nextOrder) {
    return nextOrder < currentOrder;
  }

  return Number(next.width || 0) > Number(current.width || 0);
};

const mergeDuplicateCprfLayoutColumns = (columns = []) => {
  const preferredByKey = new Map();
  const insertionOrder = [];

  (columns || []).forEach((column) => {
    if (!column) return;
    const key = getLayoutColumnDedupeKey(column);
    if (!key) {
      insertionOrder.push({ key: '', column });
      return;
    }
    if (!preferredByKey.has(key)) insertionOrder.push({ key });
    if (shouldReplaceCprfLayoutColumn(preferredByKey.get(key), column)) {
      preferredByKey.set(key, column);
    }
  });

  return insertionOrder.map((entry) => entry.key
    ? preferredByKey.get(entry.key)
    : entry.column);
};

module.exports = {
  findCprfStandardDefinition,
  findCprfUdfDefinition,
  getSalesDocumentCprfDefinitions,
  getLayoutColumnDedupeKey,
  mergeDuplicateCprfLayoutColumns,
  normalizePreferenceToken,
  selectEffectiveCprfRows,
};
