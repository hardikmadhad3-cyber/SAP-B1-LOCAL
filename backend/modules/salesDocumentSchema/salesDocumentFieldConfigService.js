'use strict';

const repository = require('./salesDocumentFieldConfigRepository');
const customLookupRepository = require('./salesDocumentCustomLookupRepository');
const schemaService = require('../newSalesOrder/newSalesOrderSchemaService');
const { LOOKUP_SOURCES, resolveSalesDocument } = require('../newSalesOrder/newSalesOrderConstants');
const { createHttpError } = require('../newSalesOrder/newSalesOrderContextService');

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const DYNAMIC_LOOKUP_SOURCES = new Set(['udf-valid-values', 'sap-user-values', 'udf-linked-table', 'udo']);

const LOOKUP_SOURCE_LABELS = Object.freeze({
  items: 'Items',
  'business-partners': 'Business Partners',
  warehouses: 'Warehouses',
  'tax-codes': 'Tax Codes',
  'uom-codes': 'Units of Measure',
  'distribution-rules': 'Distribution Rules',
  'sac-codes': 'SAC Codes',
  'hsn-codes': 'HSN Codes',
  countries: 'Countries/Regions',
  'sales-employees': 'Sales Employees',
  owners: 'Owners',
  'shipping-types': 'Shipping Types',
  'udf-valid-values': 'UDF Valid Values',
  'sap-user-values': 'SAP Form User-Defined Values',
  'udf-linked-table': 'UDF Linked Table',
  udo: 'User-Defined Object',
});

const getAllowedLookupSources = (field = {}, customSources = []) => {
  const allowed = LOOKUP_SOURCES.filter((source) => !DYNAMIC_LOOKUP_SOURCES.has(source));
  const isUdf = upper(field.storage) === 'UDF' || upper(field.databaseField).startsWith('U_');
  if (isUdf && Array.isArray(field.options) && field.options.length) allowed.push('udf-valid-values');
  if (Array.isArray(field.userValueOptions)) allowed.push('sap-user-values');
  if (isUdf && text(field.linkedTable)) allowed.push('udf-linked-table');
  if (isUdf && text(field.relUDO)) allowed.push('udo');
  return [...allowed, ...customSources];
};

const normalizeAssignmentInput = (assignments) => {
  if (!Array.isArray(assignments)) {
    throw createHttpError(400, 'assignments must be an array.', 'INVALID_FIELD_LOOKUP_ASSIGNMENTS');
  }
  return assignments.map((assignment, index) => {
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
      throw createHttpError(400, `Assignment ${index + 1} must be an object.`, 'INVALID_FIELD_LOOKUP_ASSIGNMENT');
    }
    const unknownKey = Object.keys(assignment).find((key) => !['fieldId', 'lookupSource'].includes(key));
    if (unknownKey) {
      throw createHttpError(400, `Unknown assignment field ${unknownKey}.`, 'UNKNOWN_FIELD_LOOKUP_ASSIGNMENT_KEY');
    }
    const fieldId = text(assignment.fieldId);
    const lookupSource = text(assignment.lookupSource).toLowerCase();
    if (!fieldId || !lookupSource) {
      throw createHttpError(400, `Assignment ${index + 1} requires fieldId and lookupSource.`, 'INVALID_FIELD_LOOKUP_ASSIGNMENT');
    }
    return { fieldId, lookupSource };
  });
};

const createSalesDocumentFieldConfigService = ({
  configurations = repository,
  schemas = schemaService,
  customLookups = null,
} = {}) => {
  const getConfiguration = async (context, rawDocumentType) => {
    const document = resolveSalesDocument(rawDocumentType);
    const schema = await schemas.getBaseSchema(context, document.documentType);
    const stored = await configurations.list(context.companyId, document.documentType);
    const customRows = customLookups ? await customLookups.list(context.companyId) : [];
    const customSources = customRows.map((row) => `custom:${Number(row.CustomLookupId)}`);
    const storedByField = new Map(stored.map((row) => [upper(row.FieldId), text(row.LookupSource).toLowerCase()]));
    const lookupSources = LOOKUP_SOURCES.map((source) => ({
      source,
      label: LOOKUP_SOURCE_LABELS[source] || source,
    })).concat(customRows.map((row) => ({
      source: `custom:${Number(row.CustomLookupId)}`,
      label: `Custom - ${text(row.LookupName)}`,
      custom: true,
    })));
    const lineFields = (schema.lineFields || []).map((field) => {
      const defaultLookupSource = text(field.lookup?.source || field.lookupSource).toLowerCase() || null;
      const configuredLookupSource = storedByField.get(upper(field.id)) || null;
      return {
        id: field.id,
        order: field.order,
        label: field.label,
        stateKey: field.stateKey,
        sapField: field.sapField,
        databaseField: field.databaseField,
        tableName: field.tableName,
        type: field.type,
        storage: field.storage,
        editable: field.editable !== false && !field.readOnly,
        readOnly: Boolean(field.readOnly || field.editable === false),
        defaultLookupSource,
        configuredLookupSource,
        effectiveLookupSource: configuredLookupSource || defaultLookupSource,
        allowedLookupSources: getAllowedLookupSources(field, customSources),
      };
    });

    return {
      success: true,
      companyId: Number(context.companyId),
      companyDb: context.companyDb,
      companyName: context.companyName,
      dialect: schema.dialect,
      documentType: document.documentType,
      objectType: document.objectType,
      lineTable: document.lineTable,
      schemaVersion: schema.schemaVersion,
      lookupSources,
      customLookups: customRows.map((row) => ({
        id: Number(row.CustomLookupId),
        source: `custom:${Number(row.CustomLookupId)}`,
        name: text(row.LookupName),
        queryText: text(row.QueryText),
      })),
      lineFields,
    };
  };

  const saveConfiguration = async (context, body = {}) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw createHttpError(400, 'A JSON request body is required.', 'INVALID_FIELD_LOOKUP_CONFIGURATION');
    }
    const unknownKey = Object.keys(body).find((key) => !['documentType', 'schemaVersion', 'assignments'].includes(key));
    if (unknownKey) {
      throw createHttpError(400, `Unknown request field ${unknownKey}.`, 'UNKNOWN_FIELD_LOOKUP_CONFIGURATION_KEY');
    }

    const document = resolveSalesDocument(body.documentType);
    const schema = await schemas.getBaseSchema(context, document.documentType);
    if (!text(body.schemaVersion) || body.schemaVersion !== schema.schemaVersion) {
      throw createHttpError(409, 'The document field schema changed. Reload the configuration.', 'STALE_SCHEMA_VERSION', {
        currentSchemaVersion: schema.schemaVersion,
      });
    }

    const assignments = normalizeAssignmentInput(body.assignments);
    const customRows = customLookups ? await customLookups.list(context.companyId) : [];
    const customSources = customRows.map((row) => `custom:${Number(row.CustomLookupId)}`);
    const fieldsById = new Map((schema.lineFields || []).map((field) => [upper(field.id), field]));
    const seen = new Set();
    const normalized = [];
    for (const assignment of assignments) {
      const fieldKey = upper(assignment.fieldId);
      if (seen.has(fieldKey)) {
        throw createHttpError(400, `Duplicate field assignment ${assignment.fieldId}.`, 'DUPLICATE_FIELD_LOOKUP_ASSIGNMENT');
      }
      seen.add(fieldKey);
      const field = fieldsById.get(fieldKey);
      if (!field) {
        throw createHttpError(400, `Line field ${assignment.fieldId} is not present in the active company schema.`, 'FIELD_NOT_IN_COMPANY_SCHEMA');
      }
      if (field.readOnly || field.editable === false) {
        throw createHttpError(400, `Line field ${field.id} is read-only and cannot use a configurable lookup.`, 'FIELD_NOT_EDITABLE');
      }
      const allowed = getAllowedLookupSources(field, customSources);
      if (!allowed.includes(assignment.lookupSource)) {
        throw createHttpError(400, `Lookup source ${assignment.lookupSource} is not compatible with ${field.id}.`, 'LOOKUP_SOURCE_NOT_COMPATIBLE');
      }
      const defaultLookupSource = text(field.lookup?.source || field.lookupSource).toLowerCase();
      if (assignment.lookupSource !== defaultLookupSource) {
        normalized.push({ fieldId: field.id, lookupSource: assignment.lookupSource });
      }
    }

    await configurations.replace({
      companyId: context.companyId,
      documentType: document.documentType,
      userId: context.userId,
      assignments: normalized,
    });
    return getConfiguration(context, document.documentType);
  };

  return { getConfiguration, saveConfiguration };
};

const productionService = createSalesDocumentFieldConfigService({ customLookups: customLookupRepository });

module.exports = productionService;
module.exports.LOOKUP_SOURCE_LABELS = LOOKUP_SOURCE_LABELS;
module.exports.createSalesDocumentFieldConfigService = createSalesDocumentFieldConfigService;
module.exports.getAllowedLookupSources = getAllowedLookupSources;
module.exports.normalizeAssignmentInput = normalizeAssignmentInput;
