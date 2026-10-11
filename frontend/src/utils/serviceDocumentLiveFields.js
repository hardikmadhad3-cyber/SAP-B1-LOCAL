import { buildSalesOrderRowUdfDefinitionsFromSchema } from '../modules/sales-order/documentLayout';
import { filterLayoutToCurrentSchema, isSalesDocumentSchemaForCompany } from './salesDocumentLiveFields';
import { normalizeSalesDocumentSchema } from './salesDocumentSchema';

const token = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/^U_/, '')
  .replace(/[^A-Z0-9]+/g, '');

const SERVICE_FIELD_KEYS = Object.freeze({
  LINENUM: '__lineNumber',
  DESCRIPTION: 'description',
  ITEMDESCRIPTION: 'description',
  DSCRIPTION: 'description',
  GLACCOUNT: 'glAccount',
  ACCOUNT: 'glAccount',
  ACCOUNTCODE: 'glAccount',
  ACCTCODE: 'glAccount',
  GLACCOUNTNAME: 'glAccountName',
  ACCOUNTNAME: 'glAccountName',
  ACCTNAME: 'glAccountName',
  QUANTITY: 'sQty',
  SQTY: 'sQty',
  UNITPRICE: 'unitPrice',
  PRICE: 'unitPrice',
  DISCOUNTPERCENT: 'discountPercent',
  DISCPRCNT: 'discountPercent',
  TAXCODE: 'taxCode',
  VATGROUP: 'taxCode',
  COSTINGCODE: 'distRule',
  DISTRIBUTIONRULE: 'distRule',
  OCRCODE: 'distRule',
  COSTINGCODE2: 'distRule2',
  OCRCODE2: 'distRule2',
  COSTINGCODE3: 'distRule3',
  OCRCODE3: 'distRule3',
  COSTINGCODE4: 'distRule4',
  OCRCODE4: 'distRule4',
  COSTINGCODE5: 'distRule5',
  OCRCODE5: 'distRule5',
  PROJECTCODE: 'projectCode',
  PROJECT: 'projectCode',
  WTLIABLE: 'wtaxLiable',
  WTAXLIABLE: 'wtaxLiable',
  SACENTRY: 'sac',
  SAC: 'sac',
  LOCATIONCODE: 'loc',
  LOCCODE: 'loc',
  LOCATION: 'loc',
  AGREEMENTNO: 'blanketAgreementNo',
  AGRNO: 'blanketAgreementNo',
  LINETOTAL: 'totalLC',
  TOTALFRGN: 'totalDocumentCurrency',
  ROWTOTALFC: 'totalDocumentCurrency',
  PRICEAFTERDISCOUNT: 'priceAfterDisc',
  PRICEAFTERDISC: 'priceAfterDisc',
  TAXAMOUNT: 'taxAmountLC',
  VATSUM: 'taxAmountLC',
  COSTSHEET: 'costSheet',
  CONTAINERTYPE: 'containerType',
  TAXCODEREPEAT: 'taxCodeRepeat',
  REQUIREDDATE: 'requiredDate',
  REQDATE: 'requiredDate',
  PACKAGEQUANTITY: 'noOfPackages',
  PACKQTY: 'noOfPackages',
  PACKAGES: 'noOfPackages',
  NUMOFPACKS: 'noOfPackages',
});

const WRITABLE_SERVICE_KEYS = new Set([
  'description',
  'glAccount',
  'sQty',
  'unitPrice',
  'priceAfterDisc',
  'discountPercent',
  'taxCode',
  'distRule',
  'distRule2',
  'distRule3',
  'distRule4',
  'distRule5',
  'projectCode',
  'wtaxLiable',
  'sac',
  'loc',
  'blanketAgreementNo',
  'requiredDate',
  'noOfPackages',
  'totalLC',
]);

// SAP stores LineTotal as a calculated database column, but in the service
// document matrix it is a direct-entry amount. Metadata sourced from the
// physical table can therefore report it as non-editable even when the SAP
// client allows entry. Keep this UI capability separate from storage flags.
const DIRECT_ENTRY_SERVICE_KEYS = new Set([
  'totalLC',
]);

// Service documents share the marketing-document tables with item documents,
// but their line matrix uses account-oriented renderers.  Schema metadata
// describes the physical field and may provide a generic lookup object; it
// must not replace the SAP renderer key used by the service form.
const SERVICE_LOOKUP_RENDERERS = Object.freeze({
  glAccount: 'account',
  taxCode: 'tax',
  distRule: 'distRule',
  distRule2: 'distRule',
  distRule3: 'distRule',
  distRule4: 'distRule',
  distRule5: 'distRule',
  wtaxLiable: 'yesNo',
  sac: 'sac',
  loc: 'location',
});

const ITEM_ONLY_SERVICE_TOKENS = new Set([
  'ITEMCODE',
  'WAREHOUSECODE',
  'WHSCODE',
  'UOMCODE',
  'UOMENTRY',
  'BARCODE',
  'NUMPERMSR',
  'INVENTORYQUANTITY',
  'USEBASEUNITS',
]);

export const SAP_STANDARD_SERVICE_MATRIX_COLUMNS = Object.freeze([
  Object.freeze({ key: 'glAccountName', label: 'G/L Account Name', width: 220, visible: false, readOnly: true, source: 'service-display' }),
  Object.freeze({ key: 'priceAfterDisc', label: 'Price after Discount', width: 140, visible: false, numeric: true, readOnly: false, source: 'service-display' }),
  Object.freeze({ key: 'blanketAgreementNo', fieldName: 'AgrNo', label: 'Blanket Agreement No.', width: 150, visible: false, source: 'service-standard' }),
  Object.freeze({ key: 'costSheet', label: 'Cost Sheet', width: 140, visible: false, readOnly: true, source: 'service-display' }),
  Object.freeze({ key: 'containerType', label: 'Container Type', width: 140, visible: false, readOnly: true, source: 'service-display' }),
  Object.freeze({ key: 'description', fieldName: 'Dscription', sapField: 'ItemDescription', label: 'Description', width: 240, visible: true, requiredVisible: true, source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'glAccount', fieldName: 'AcctCode', sapField: 'AccountCode', label: 'G/L Account', width: 145, visible: true, requiredVisible: true, lookup: 'account', source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'unitPrice', fieldName: 'Price', sapField: 'UnitPrice', label: 'Unit Price', width: 120, visible: true, numeric: true, source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'discountPercent', fieldName: 'DiscPrcnt', sapField: 'DiscountPercent', label: 'Discount %', width: 105, visible: true, numeric: true, source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'taxCode', fieldName: 'VatGroup', sapField: 'TaxCode', label: 'Tax Code', width: 120, visible: true, lookup: 'tax', source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'distRule', fieldName: 'OcrCode', sapField: 'CostingCode', label: 'Distribution Rule', width: 145, visible: true, lookup: 'distRule', source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'wtaxLiable', fieldName: 'WTLiable', sapField: 'WTLiable', label: 'WTax Liable', width: 105, visible: true, lookup: 'yesNo', source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'sac', fieldName: 'SacEntry', sapField: 'SACEntry', label: 'SAC', width: 110, visible: true, lookup: 'sac', source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'loc', fieldName: 'LocCode', sapField: 'LocationCode', label: 'Loc.', width: 115, visible: true, lookup: 'location', source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'totalLC', fieldName: 'LineTotal', sapField: 'LineTotal', label: 'Total (LC)', width: 120, visible: true, numeric: true, readOnly: false, source: 'sap-standard-service-fallback' }),
  Object.freeze({ key: 'taxAmountLC', fieldName: 'VatSum', sapField: 'TaxAmount', label: 'Tax Amount (LC)', width: 130, visible: true, numeric: true, readOnly: true, source: 'sap-standard-service-fallback' }),
]);

export const getSapStandardServiceMatrixColumns = () => (
  SAP_STANDARD_SERVICE_MATRIX_COLUMNS.map((column, index) => ({
    ...column,
    order: index + 1,
    columnOrder: index + 1,
    minWidth: column.width,
    active: !column.readOnly,
  }))
);

// Published SQL aliases describe the visible matrix; the physical SAP field
// still determines which document-line property is edited and sent to SAP.
export const buildServiceCompanyQueryColumns = ({ queryLayout, liveMatrixColumns = [], rowUdfFields = [] } = {}) => {
  if (!queryLayout?.isPublished || !Array.isArray(queryLayout.columns) || !queryLayout.columns.length) return null;
  const udfs = new Map(rowUdfFields.map((field) => [String(field.key || '').toUpperCase(), field]));
  const usedKeys = new Set();
  return queryLayout.columns.map((column, index) => {
    const alias = String(column.key || column.label || '').trim();
    const physical = String(column.fieldName || alias).trim();
    if (token(physical) === 'LINENUM' || token(alias) === 'LINENUMBER' || alias === '#') return null;
    const udf = /^U_/i.test(physical) ? udfs.get(physical.toUpperCase()) : null;
    if (/^U_/i.test(physical) && !udf) return null;
    const valueKey = udf ? udf.key : (
      liveMatrixColumns.find((field) => [field.fieldName, field.sapField, field.key, field.valueKey]
        .some((candidate) => token(candidate) === token(physical)))?.valueKey
      || SERVICE_FIELD_KEYS[token(physical)]
      || SERVICE_FIELD_KEYS[token(alias)]
      || ''
    );
    const base = udf || liveMatrixColumns.find((field) => field.key === valueKey) || {};
    const rawKey = udf ? `udf:${udf.key}` : (valueKey || `query:${alias || index}`);
    let key = rawKey;
    let duplicate = 2;
    while (usedKeys.has(key)) key = `${rawKey}:${duplicate++}`;
    usedKeys.add(key);
    const width = Number(base.minWidth || base.width) || 140;
    return {
      ...base,
      key,
      valueKey: valueKey || key,
      udfKey: udf?.key,
      isUdf: Boolean(udf),
      fieldName: physical,
      label: String(column.label || alias).replace(/_/g, ' '),
      width,
      minWidth: width,
      order: Number(column.order) || index + 1,
      columnOrder: Number(column.order) || index + 1,
      visible: true,
      readOnly: !udf && !valueKey ? true : Boolean(base.readOnly),
      active: !(!udf && !valueKey) && !base.readOnly
        && (udf ? udf.editable !== false : base.active !== false),
      companyQueryLayoutColumn: true,
    };
  }).filter(Boolean);
};

const isUdf = (field = {}) => (
  String(field.storage || '').toLowerCase() === 'udf'
  || String(field.sapField || field.databaseField || '').toUpperCase().startsWith('U_')
);

const resolveServiceKey = (field = {}) => {
  const candidates = [
    field.stateKey,
    field.sapField,
    field.databaseField,
    field.label,
  ];
  for (const candidate of candidates) {
    const key = SERVICE_FIELD_KEYS[token(candidate)];
    if (key) return key;
  }
  return '';
};

const inputType = (field = {}) => {
  const normalized = String(field.type || field.renderer || '').toLowerCase();
  if (['number', 'integer'].includes(normalized)) return 'number';
  if (normalized === 'date') return 'date';
  if (['checkbox', 'boolean'].includes(normalized)) return 'checkbox';
  return 'text';
};

const fieldTokens = (field = {}) => new Set([
  field.sapField,
  field.databaseField,
  field.stateKey,
  field.label,
].map(token).filter(Boolean));

const layoutTokens = (column = {}) => [
  column.fieldName,
  column.columnUid,
  column.columnTitle,
  column.label,
].map(token).filter(Boolean);

const findLayout = (field, layoutColumns) => {
  const tokens = fieldTokens(field);
  return layoutColumns.find((column) => layoutTokens(column).some((value) => tokens.has(value)));
};

const buildStandardColumn = (field, index, layout) => {
  const key = resolveServiceKey(field);
  const writable = WRITABLE_SERVICE_KEYS.has(key);
  const unsupportedKey = `sapLayout_${String(field.databaseField || field.sapField || index + 1).replace(/[^A-Za-z0-9_]+/g, '_')}`;
  const width = Number(layout?.width || field.width) || 125;
  // SAP's live matrix layout is authoritative for a supported field. The
  // schema describes physical storage and commonly labels LineTotal as a
  // calculated column even though SAP service documents allow direct entry.
  const readOnly = !writable || (
    layout?.editable === false
    && !DIRECT_ENTRY_SERVICE_KEYS.has(key)
  );
  return {
    key: key || unsupportedKey,
    valueKey: key || unsupportedKey,
    rendererKey: key || unsupportedKey,
    fieldName: field.databaseField || field.sapField || '',
    sapField: field.sapField || field.databaseField || '',
    label: layout?.columnTitle || layout?.label || field.label || field.sapField,
    width,
    minWidth: width,
    order: Number(layout?.columnOrder ?? layout?.order ?? field.order) || index + 1,
    columnOrder: Number(layout?.columnOrder ?? layout?.order ?? field.order) || index + 1,
    visible: layout ? layout.visible !== false : field.visible !== false,
    active: !readOnly,
    readOnly,
    numeric: inputType(field) === 'number',
    type: inputType(field),
    lookupSource: field.lookup?.source || field.lookupSource || undefined,
    lookup: SERVICE_LOOKUP_RENDERERS[key] || field.lookup,
    options: field.options || [],
    schemaFieldId: field.id,
    sapControlled: true,
    schemaDriven: true,
    displayOnly: !writable,
    requiredVisible: key === 'description' || key === 'glAccount',
    source: 'service-live-schema',
  };
};

export const buildServiceDocumentLiveFields = ({
  schema,
  documentType,
  headerTable,
  lineTable,
  companyId,
  companyDb,
  layoutResponse,
} = {}) => {
  const schemaMatchesCompany = isSalesDocumentSchemaForCompany(schema, { companyId, companyDb });
  const normalizedSchema = schemaMatchesCompany
    ? normalizeSalesDocumentSchema(schema, documentType)
    : null;
  const headerFields = normalizedSchema?.headerFields || [];
  const lineFields = normalizedSchema?.lineFields || [];
  const layout = layoutResponse?.data || layoutResponse || {};
  const hasLayout = String(layout.source || '').toLowerCase() !== 'fallback'
    && Array.isArray(layout.columns)
    && layout.columns.length > 0;
  const layoutColumns = hasLayout
    ? filterLayoutToCurrentSchema(layout.columns, lineFields)
    : [];
  const headerUdfFields = buildSalesOrderRowUdfDefinitionsFromSchema(headerFields, { lineTable: headerTable })
    .map((field) => ({ ...field, schemaDriven: true }));
  const rowUdfFields = buildSalesOrderRowUdfDefinitionsFromSchema(lineFields, { lineTable })
    .map((field, index) => {
      const udfLayout = findLayout(field, layoutColumns);
      const width = Number(udfLayout?.width || field.minWidth || field.width) || 125;
      return {
        ...field,
        label: udfLayout?.columnTitle || udfLayout?.label || field.label,
        visible: Boolean(udfLayout && udfLayout.visible !== false),
        active: Boolean(
          udfLayout
          && udfLayout.editable !== false
          && field.editable !== false
          && !field.readOnly
        ),
        readOnly: Boolean(field.readOnly || field.editable === false || udfLayout?.editable === false),
        order: Number(udfLayout?.columnOrder ?? udfLayout?.order ?? field.order) || 1000 + index,
        columnOrder: Number(udfLayout?.columnOrder ?? udfLayout?.order ?? field.order) || 1000 + index,
        minWidth: width,
        width,
        schemaDriven: true,
        sapControlled: Boolean(udfLayout),
      };
    });

  const standardFields = lineFields.filter((field) => (
    !isUdf(field)
    && ![field.stateKey, field.sapField, field.databaseField, field.label]
      .some((value) => ITEM_ONLY_SERVICE_TOKENS.has(token(value)))
  ));
  // A physical service line table contains many internal/item-mode columns.
  // Only fields present in the selected SAP user's matrix layout are eligible
  // for the live matrix. Without a usable layout, use the curated SAP service
  // fallback instead of exposing every physical column.
  const schemaColumns = (hasLayout ? standardFields : [])
    .map((field, index) => ({
      field,
      layout: findLayout(field, layoutColumns),
      index,
    }))
    .filter(({ layout }) => Boolean(layout))
    .map(({ field, layout: fieldLayout, index }) => buildStandardColumn(field, index, fieldLayout))
    .filter((column) => column.key !== '__lineNumber')
    .sort((left, right) => left.order - right.order)
    .filter((column, index, columns) => (
      columns.findIndex((candidate) => candidate.key === column.key) === index
    ));
  const matrixColumns = schemaColumns.length
    ? [...schemaColumns, ...getSapStandardServiceMatrixColumns()
      .filter((column) => !schemaColumns.some((existing) => existing.key === column.key))
      .map((column) => ({ ...column, visible: false, requiredVisible: false }))]
    : getSapStandardServiceMatrixColumns();

  return {
    documentType,
    schemaMatchesCompany,
    liveSchema: normalizedSchema,
    headerUdfFields,
    rowUdfFields,
    matrixColumns,
    importedLayout: layout,
    liveAvailable: Boolean(normalizedSchema && lineFields.length),
    usedSapLayout: hasLayout,
  };
};
