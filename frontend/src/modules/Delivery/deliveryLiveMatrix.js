import {
  buildSalesOrderMatrixColumnsFromLayout,
  buildSalesOrderMatrixColumnsFromSchema,
} from '../sales-order/documentLayout';

const normalizeColumnKey = (column = {}) => String(
  column.rendererKey || column.valueKey || column.key || ''
).trim();

const normalizeUdfKey = (value) => String(value || '').trim().toUpperCase();
const normalizeFieldToken = (value) => normalizeUdfKey(value).replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');

// SAP form layouts can reuse a column UID across versions/companies. In that
// case the physical field can say ShipDate while the visible SAP caption says
// Unit Price. Standard Delivery captions are therefore resolved to their
// semantic line keys before the layout data type is allowed to choose a
// renderer. UDFs remain identified by their company-specific U_ field.
const DELIVERY_STANDARD_KEY_BY_LABEL = new Map(Object.entries({
  ITEMNO: 'itemNo',
  ITEMDESCRIPTION: 'itemDescription',
  QUANTITY: 'quantity',
  QTYTOSHIP: 'qtyToShip',
  ORDEREDQTY: 'orderedQty',
  BALQTY: 'balanceQty',
  UNITPRICE: 'unitPrice',
  DISCOUNT: 'stdDiscount',
  DISCOUNTPERCENT: 'stdDiscount',
  TOTAL: 'totalLC',
  TOTALLC: 'totalLC',
  TOTALDOC: 'grossTotal',
  TOTALDOCUMENT: 'grossTotal',
  WEIGHT: 'weight',
  TAXCODE: 'taxCode',
  COUNTRYREGIONOFORIGIN: 'countryOfOrigin',
  UOMCODE: 'uomCode',
  UOMNAME: 'uomName',
  COGSDISTRULE: 'cogsDistRule',
  COGSDISTRRULE: 'cogsDistRule',
  INSTOCK: 'inStock',
  QTYINWHSE: 'qtyInWhse',
  QTYINWAREHOUSE: 'qtyInWhse',
  LOC: 'loc',
  RETURNCOSTLC: 'returnCost',
  HSN: 'hsnCode',
  SAC: 'sacCode',
  TAXAMOUNTLC: 'taxAmount',
  WTAXLIABLE: 'wTaxLiable',
  WHSE: 'whse',
  GLACCOUNT: 'glAccount',
  DISTRRULE: 'distRule',
  DISTRIBUTIONRULE: 'distRule',
  TAXLIABLE: 'taxLiable',
  NOOFPACKAGES: 'noOfPackages',
  COMM: 'commPercent',
  COMMPERCENT: 'commPercent',
  ENABLESETTINGCOST: 'enableSettingCost',
  BLANKETAGREEMENTNO: 'blanketAgreementNo',
  QUOTEDDATE: 'lineDeliveryDate',
  DELIVERYDATE: 'lineDeliveryDate',
}));

const DELIVERY_STANDARD_FIELD_OVERRIDES = Object.freeze({
  itemNo: Object.freeze({ type: 'text', minWidth: 160 }),
  itemDescription: Object.freeze({ type: 'text', minWidth: 240 }),
  quantity: Object.freeze({ type: 'number', numeric: true, minWidth: 100 }),
  qtyToShip: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 110 }),
  orderedQty: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 105 }),
  openQty: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 105 }),
  balanceQty: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 105 }),
  unitPrice: Object.freeze({ type: 'number', numeric: true, minWidth: 110 }),
  stdDiscount: Object.freeze({ type: 'number', numeric: true, minWidth: 100 }),
  totalLC: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 115 }),
  grossTotal: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 120 }),
  weight: Object.freeze({ type: 'number', numeric: true, minWidth: 100 }),
  taxCode: Object.freeze({ type: 'text', minWidth: 115 }),
  countryOfOrigin: Object.freeze({ type: 'text', minWidth: 185 }),
  uomCode: Object.freeze({ type: 'text', minWidth: 110 }),
  uomName: Object.freeze({ type: 'text', readOnly: false, active: true, minWidth: 120 }),
  cogsDistRule: Object.freeze({ type: 'text', minWidth: 135 }),
  inStock: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 105 }),
  qtyInWhse: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 115 }),
  loc: Object.freeze({ type: 'text', minWidth: 115 }),
  returnCost: Object.freeze({ type: 'number', numeric: true, minWidth: 125 }),
  hsnCode: Object.freeze({ type: 'text', minWidth: 105 }),
  sacCode: Object.freeze({ type: 'text', minWidth: 100 }),
  taxAmount: Object.freeze({ type: 'number', numeric: true, readOnly: true, minWidth: 125 }),
  wTaxLiable: Object.freeze({ type: 'checkbox', minWidth: 105 }),
  whse: Object.freeze({ type: 'text', minWidth: 105 }),
  glAccount: Object.freeze({ type: 'text', minWidth: 140 }),
  distRule: Object.freeze({ type: 'text', minWidth: 115 }),
  taxLiable: Object.freeze({ type: 'checkbox', minWidth: 105 }),
  noOfPackages: Object.freeze({ type: 'number', numeric: true, minWidth: 130 }),
  commPercent: Object.freeze({ type: 'number', numeric: true, minWidth: 100 }),
  enableSettingCost: Object.freeze({ type: 'checkbox', minWidth: 145 }),
  blanketAgreementNo: Object.freeze({ type: 'text', minWidth: 175 }),
  lineDeliveryDate: Object.freeze({ type: 'date', minWidth: 130 }),
});

const hasExplicitUdfIdentity = (column = {}) => Boolean(
  [
    column.sapField,
    column.fieldName,
    column.layoutFieldName,
    column.key,
    column.valueKey,
  ].some((value) => normalizeUdfKey(value).startsWith('U_'))
);

const isUdfColumn = (column = {}) => Boolean(
  hasExplicitUdfIdentity(column) || column.isUdf || column.isUdfBacked
);

export const resolveDeliveryStandardFieldKey = (column = {}) => {
  // Some imported SAP rows incorrectly carry isUdf=true. Only an actual U_
  // identity is strong enough to prevent a known standard caption from being
  // normalized.
  if (hasExplicitUdfIdentity(column)) return '';
  return DELIVERY_STANDARD_KEY_BY_LABEL.get(
    normalizeFieldToken(column.label || column.columnTitle)
  ) || '';
};

export const normalizeDeliveryMatrixColumn = (column = {}) => {
  const standardKey = resolveDeliveryStandardFieldKey(column);
  if (!standardKey) return column;

  const standardOverride = DELIVERY_STANDARD_FIELD_OVERRIDES[standardKey] || {};
  const configuredWidth = Math.max(
    Number(column.minWidth) || 0,
    Number(column.width) || 0,
    Number(standardOverride.minWidth) || 0,
  );

  return {
    ...column,
    ...standardOverride,
    key: standardKey,
    valueKey: standardKey,
    rendererKey: standardKey,
    minWidth: configuredWidth || 125,
    width: configuredWidth || 125,
    isUdf: false,
    isUdfBacked: false,
    field: undefined,
    readOnly: Boolean(standardOverride.readOnly ?? column.readOnly),
  };
};

const getColumnTokens = (column = {}) => [
  column.key,
  column.valueKey,
  column.rendererKey,
  column.sapField,
  column.fieldName,
  column.layoutFieldName,
  column.label,
  ...(column.alternativeFields || []),
  ...(column.sapColumnIds || []),
].map(normalizeFieldToken).filter(Boolean);

const getRowUdfTokens = (field = {}) => [
  field.key,
  field.sapField,
  field.aliasId,
  field.label,
  field.description,
].map(normalizeFieldToken).filter(Boolean);

const buildUniqueColumnMap = (columns = [], tokenSelector) => {
  const map = new Map();
  (columns || []).forEach((column) => {
    const token = tokenSelector(column);
    if (!token) return;
    map.set(token, map.has(token) ? null : column);
  });
  return map;
};

const reconcileLayoutColumnsWithCompanySchema = (layoutMatrixColumns = [], companyColumns = []) => {
  const companyColumnByKey = buildUniqueColumnMap(
    companyColumns,
    (column) => normalizeFieldToken(normalizeColumnKey(column))
  );
  const companyColumnByLabel = buildUniqueColumnMap(
    companyColumns,
    (column) => normalizeFieldToken(column.label || column.columnTitle)
  );

  return (layoutMatrixColumns || []).map((layoutColumn) => {
    const labelToken = normalizeFieldToken(layoutColumn.label || layoutColumn.columnTitle);
    const canonicalKey = resolveDeliveryStandardFieldKey(layoutColumn);
    const schemaColumn = (
      canonicalKey
        ? companyColumnByKey.get(normalizeFieldToken(canonicalKey))
        : companyColumnByLabel.get(labelToken)
    );
    // A CPRF row is already scoped to the active company and SAP B1 user. If
    // this client does not have a schema payload mapping, keep the SAP field
    // as a display-only column instead of hiding it from Form Settings.
    if (canonicalKey && !schemaColumn) return normalizeDeliveryMatrixColumn(layoutColumn);
    if (!schemaColumn) return layoutColumn;

    const authoritativeKey = canonicalKey
      || schemaColumn.valueKey
      || schemaColumn.rendererKey
      || schemaColumn.key;
    const standardOverride = canonicalKey
      ? DELIVERY_STANDARD_FIELD_OVERRIDES[canonicalKey] || {}
      : {};
    return normalizeDeliveryMatrixColumn({
      ...layoutColumn,
      key: authoritativeKey,
      valueKey: authoritativeKey,
      rendererKey: canonicalKey || schemaColumn.rendererKey || authoritativeKey,
      fieldName: schemaColumn.fieldName || schemaColumn.sapField || layoutColumn.fieldName,
      sapField: schemaColumn.sapField || layoutColumn.sapField,
      type: standardOverride.type || schemaColumn.type || layoutColumn.type,
      numeric: standardOverride.numeric ?? schemaColumn.numeric ?? layoutColumn.numeric ?? false,
      isUdf: Boolean(schemaColumn.isUdf),
      field: schemaColumn.field || layoutColumn.field,
      lookupSource: schemaColumn.lookupSource || layoutColumn.lookupSource,
      lookupTable: schemaColumn.lookupTable || layoutColumn.lookupTable,
      lookup: schemaColumn.lookup || layoutColumn.lookup,
      options: schemaColumn.options || layoutColumn.options,
      readOnly: Boolean(standardOverride.readOnly ?? schemaColumn.readOnly ?? layoutColumn.readOnly),
      // SAP's CPRF EditInForm value is the Form Settings authority. Schema
      // safety is represented separately by readOnly, so it must not change
      // the Active checkbox shown for the selected SAP user/company.
      active: layoutColumn.active !== false,
      schemaDriven: Boolean(schemaColumn.schemaDriven || layoutColumn.schemaDriven),
      lookupConfigured: Boolean(schemaColumn.lookupConfigured || layoutColumn.lookupConfigured),
      schemaFieldId: schemaColumn.schemaFieldId || layoutColumn.schemaFieldId,
      fieldId: schemaColumn.fieldId || layoutColumn.fieldId,
      serviceLayerField: schemaColumn.serviceLayerField || layoutColumn.serviceLayerField,
      payloadKey: schemaColumn.payloadKey || layoutColumn.payloadKey,
      writableStandardField: Boolean(schemaColumn.writableStandardField),
    });
  }).filter(Boolean);
};

const buildCompanyFallbackColumns = (referenceMatrixColumns = [], rowUdfFields = []) => {
  const companyUdfTokens = new Set((rowUdfFields || []).flatMap(getRowUdfTokens));
  const columns = (referenceMatrixColumns || []).filter((column) => (
    !isUdfColumn(column) || getColumnTokens(column).some((token) => companyUdfTokens.has(token))
  ));
  const representedTokens = new Set(columns.flatMap(getColumnTokens));

  (rowUdfFields || []).forEach((field, index) => {
    const fieldTokens = getRowUdfTokens(field);
    if (fieldTokens.some((token) => representedTokens.has(token))) return;
    const key = field.key || field.sapField;
    if (!key) return;
    const column = {
      key,
      valueKey: key,
      rendererKey: key,
      label: field.label || key,
      minWidth: Number(field.minWidth || field.width) || (field.type === 'textarea' ? 180 : 125),
      order: Number(field.order) || columns.length + index + 1,
      visible: field.visible !== false,
      active: field.active !== false,
      readOnly: Boolean(field.readOnly),
      type: field.type || 'text',
      options: field.options,
      lookupSource: field.lookupSource,
      lookupTable: field.lookupTable,
      lookup: field.lookup,
      isUdf: true,
      field,
      sapControlled: true,
      importedLayout: true,
      source: 'company-delivery-udf',
    };
    columns.push(column);
    getColumnTokens(column).forEach((token) => representedTokens.add(token));
  });

  return columns;
};

const enrichRowUdfFieldsFromSchema = (rowUdfFields = [], schemaLineFields = []) => {
  const schemaUdfByKey = new Map(
    (schemaLineFields || [])
      .filter((field) => String(field.storage || '').toLowerCase() === 'udf'
        || normalizeUdfKey(field.sapField || field.databaseField || field.stateKey).startsWith('U_'))
      .map((field) => [
        normalizeUdfKey(field.sapField || field.databaseField || field.stateKey),
        field,
      ])
  );

  return (rowUdfFields || []).map((field) => {
    const schemaField = schemaUdfByKey.get(normalizeUdfKey(field.sapField || field.key));
    if (!schemaField) return field;
    return {
      ...field,
      lookup: field.lookup || schemaField.lookup,
      lookupTable: field.lookupTable || schemaField.lookupTable || schemaField.linkedTable,
      linkedTable: field.linkedTable || schemaField.linkedTable,
      relUDO: field.relUDO || schemaField.relUDO,
      schemaFieldId: field.schemaFieldId || schemaField.id,
      fieldId: field.fieldId || schemaField.fieldId || schemaField.lookup?.fieldId,
    };
  });
};

export const buildDeliveryLiveMatrixColumns = ({
  schemaLineFields = [],
  referenceMatrixColumns = [],
  rowUdfFields = [],
  layoutColumns = [],
} = {}) => {
  const companySchemaLineFields = Array.isArray(schemaLineFields) ? schemaLineFields : [];
  const companyRowUdfFields = Array.isArray(rowUdfFields) ? rowUdfFields : [];
  const enrichedRowUdfFields = enrichRowUdfFieldsFromSchema(
    companyRowUdfFields,
    companySchemaLineFields,
  );
  const schemaColumns = buildSalesOrderMatrixColumnsFromSchema({
    schemaLineFields: companySchemaLineFields,
    liveMatrixColumns: referenceMatrixColumns,
    rowUdfFields: enrichedRowUdfFields,
    lineTable: 'DLN1',
  });
  const companyColumns = schemaColumns.length
    ? schemaColumns
    : buildCompanyFallbackColumns(referenceMatrixColumns, enrichedRowUdfFields);

  const layoutMatrixColumns = buildSalesOrderMatrixColumnsFromLayout({
    layoutColumns,
    liveMatrixColumns: companyColumns,
    rowUdfFields: enrichedRowUdfFields,
    includeLineNumber: false,
    appendMissingLiveColumns: false,
  });
  const reconciledColumns = reconcileLayoutColumnsWithCompanySchema(layoutMatrixColumns, companyColumns);
  // Older saved layouts omit these standard SAP columns. Add only missing
  // fields; retain the current company's explicit visibility and ordering.
  let quantityIndex = reconciledColumns.findIndex(column => normalizeColumnKey(column) === 'quantity');
  for (const [key, label, sapField] of [
    ['qtyToShip', 'Qty to Ship', 'QtyToShip'],
    ['orderedQty', 'Ordered Qty', 'OrderedQty'],
  ]) {
    const existingIndex = reconciledColumns.findIndex(column => normalizeColumnKey(column) === key);
    if (existingIndex >= 0) { quantityIndex = existingIndex; continue; }
    if (quantityIndex < 0) continue;
    const reference = referenceMatrixColumns.find(column => column.key === key);
    const precedingOrder = Number(reconciledColumns[quantityIndex].order ?? quantityIndex + 1);
    const followingOrder = Number(reconciledColumns[quantityIndex + 1]?.order ?? precedingOrder + 1);
    reconciledColumns.splice(++quantityIndex, 0, normalizeDeliveryMatrixColumn({
      ...reference, key, label, sapField, visible: reference?.visible !== false,
      order: precedingOrder + (followingOrder - precedingOrder) / 2,
    }));
  }
  const activeCompanyUdfTokens = new Set([
    ...(companySchemaLineFields || []).filter((field) => {
      const sapField = field?.sapField || field?.databaseField || field?.stateKey || '';
      return String(field?.storage || '').trim().toLowerCase() === 'udf'
        || normalizeUdfKey(sapField).startsWith('U_');
    }),
    ...enrichedRowUdfFields,
  ].flatMap(getRowUdfTokens));
  const hasStandardUnitPrice = reconciledColumns.some((column) => (
    normalizeColumnKey(column) === 'unitPrice'
  ));
  const seenColumnKeys = new Set();

  return reconciledColumns.filter((column) => (
    normalizeColumnKey(column) !== '__lineNumber'
    // A UDF not present in the active-company schema is an old cached layout
    // field, not a live current-company Form Settings field.
    && (!column.isUdf || getColumnTokens(column).some((token) => activeCompanyUdfTokens.has(token)))
    // SAP layouts from older companies can contain an obsolete U_Unit_Price
    // UDF alongside the standard Price field. Keep the standard numeric
    // renderer and suppress only this proven duplicate.
    && !(
      hasStandardUnitPrice
      && normalizeFieldToken(column.fieldName || column.sapField || column.key) === 'UNITPRICE'
      && normalizeFieldToken(column.label || column.columnTitle) === 'UNITPRICE'
      && isUdfColumn(column)
    )
    && (() => {
      const identity = normalizeFieldToken(normalizeColumnKey(column));
      if (!identity || seenColumnKeys.has(identity)) return false;
      seenColumnKeys.add(identity);
      return true;
    })()
  ));
};
