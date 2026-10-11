'use strict';

// SELECT-only audit. Does not start the server, run migrations, or call SAP writes.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const env = require('../config/env');
const { buildCompanyConfig } = require('../services/companyConfigService');
const { assertStaticReadOnlySql } = require('../modules/newSalesOrder/newSalesOrderReadOnlyDbService');
const { createNewSalesOrderMetadataRepository } = require('../modules/newSalesOrder/newSalesOrderMetadataRepository');
const { buildDocumentSchema } = require('../modules/newSalesOrder/newSalesOrderSchemaService');
const { createNewSalesOrderLookupService } = require('../modules/newSalesOrder/newSalesOrderLookupService');
const { resolveSalesDocument } = require('../modules/newSalesOrder/newSalesOrderConstants');
const { selectEffectiveCprfRows, getSalesDocumentCprfDefinitions, findCprfStandardDefinition } = require('../services/sapFormPreferenceUtils');
const sql = require('mssql');

async function main() {
  const auth = new DatabaseSync(path.resolve(__dirname, '..', env.authSqlitePath), { readOnly: true });
  const names = ['DC_LiveDB', 'NC_LIVE', 'NOCPL_LIVE', 'NCPL_110126'];
  const report = { checkedAt: new Date().toISOString(), mode: 'SELECT only', companies: [] };
  for (const name of names) {
    const company = auth.prepare('SELECT * FROM Companies WHERE DbName = ?').get(name);
    if (!company) throw new Error(`Company configuration missing: ${name}`);
    const config = buildCompanyConfig(company).sql;
    const pool = new sql.ConnectionPool({
      server: config.server, database: name, user: config.user, password: config.password,
      ...(config.port ? { port: config.port } : {}),
      options: { encrypt: config.encrypt, trustServerCertificate: config.trustServerCertificate, readOnlyIntent: true },
      pool: { max: 1, min: 0 }, connectionTimeout: 15000, requestTimeout: 15000,
    });
    const entry = { database: name, documents: [] };
    report.companies.push(entry);
    try {
      await pool.connect();
      const readOnlyDb = {
        getDialect: async () => 'sqlserver',
        select: async ({ sql: statement, params = {} }) => {
          assertStaticReadOnlySql(statement);
          const request = pool.request();
          for (const [key, value] of Object.entries(params)) request.input(key, value);
          return (await request.query(statement)).recordset;
        },
      };
      const repository = createNewSalesOrderMetadataRepository({ readOnlyDb, authDb: {
        queryRows: async (statement, params) => {
          assertStaticReadOnlySql(statement);
          return auth.prepare(statement).all(params);
        },
      } });
      const context = { companyId: company.CompanyId, companyDb: name,
        userCode: process.argv[2] || buildCompanyConfig(company).serviceLayer.username || 'manager' };
      for (const documentType of ['SALES_ORDER', 'DELIVERY', 'AR_INVOICE']) {
        const metadata = await repository.getDocumentMetadata(context, documentType);
        const schema = buildDocumentSchema({ context, metadata, rawDocument: documentType });
        const lookups = createNewSalesOrderLookupService({ readOnlyDb, metadata: repository, schemas: { getSchema: async () => schema } });
        for (const field of [...schema.headerFields, ...schema.lineFields].filter(f => f.lookupSource === 'sap-user-values')) {
          const result = await lookups.getLookup(context, 'sap-user-values', { documentType, fieldId: field.id, limit: 100 });
          if (result.items.length !== Math.min(100, field.userValueOptions.length)) throw new Error(`Lookup count mismatch: ${field.id}`);
        }
        entry.documents.push({ documentType, ...metadata, mappedFields: {
          header: schema.headerFields.map(({ id, label, lookupSource, userValueOptions }) => ({ id, label, lookupSource, valueCount: userValueOptions?.length })),
          lines: schema.lineFields.map(({ id, label, order, visible, lookupSource, userValueOptions }) => ({ id, label, order, visible, lookupSource, valueCount: userValueOptions?.length })),
        } });
      }
      entry.userCode = context.userCode;
      entry.livePreferences = [];
      for (const formId of ['139', '140', '133']) {
        entry.livePreferences.push(...await readOnlyDb.select({ sql: "SELECT TOP (3000) P.FormID, P.ItemID, P.ColID, P.UserSign, P.TPLId, P.VisualIndx, P.VisInForm, P.EditInForm, P.Width FROM CPRF P INNER JOIN OUSR U ON U.USERID = P.UserSign WHERE P.FormID = @formId AND P.ItemID = '38' AND U.USER_CODE = @userCode ORDER BY P.TPLId, P.VisualIndx", params: { userCode: context.userCode, formId } }));
      }
      const templateColumns = await repository.getTableColumns(context, 'UIC4');
      const hasTemplates = ['TPLId', 'FormId', 'UserID'].every(name => templateColumns.some(c => c.columnName.toUpperCase() === name.toUpperCase()));
      const templates = hasTemplates ? await readOnlyDb.select({ sql: 'SELECT T.TPLId, T.FormId FROM UIC4 T INNER JOIN OUSR U ON U.USERID = T.UserID WHERE U.USER_CODE = @userCode', params: { userCode: context.userCode } }) : [];
      for (const doc of entry.documents) {
        const profile = resolveSalesDocument(doc.documentType);
        const rows = selectEffectiveCprfRows(entry.livePreferences.filter(p => p.FormID === profile.formType), {
          assignedTemplateIds: templates.filter(t => String(t.FormId) === profile.formType).map(t => t.TPLId),
        });
        doc.liveLayout = rows.map(row => {
          const standard = findCprfStandardDefinition({ row, preferredDefinitions: getSalesDocumentCprfDefinitions(doc.documentType) });
          const udf = doc.udfs[profile.lineTable].find(f => f.sapField.toUpperCase() === String(row.ColID).toUpperCase());
          if (!standard && !udf) return null;
          return { field: standard?.fieldName || udf.sapField, label: standard?.title || udf.label,
            order: row.VisualIndx, visible: row.VisInForm === 'Y', editable: row.EditInForm === 'Y', templateId: row.TPLId };
        }).filter(Boolean);
        doc.staleLayoutUdfs = doc.layout.filter(f => String(f.fieldName).startsWith('U_')
          && !doc.physical[profile.lineTable].some(p => p.columnName.toUpperCase() === f.fieldName.toUpperCase())).map(f => f.fieldName);
        doc.orphanedValueLists = [...new Set(doc.formValueLists.filter(v => String(v.itemId) === profile.matrixId
          && !doc.physical[profile.lineTable].some(p => p.columnName.toUpperCase() === String(v.columnId).toUpperCase())).map(v => v.columnId))];
      }
      const columns = await repository.getTableColumns(context, 'CSHS');
      if (columns.length) {
        entry.userDefinedValues = await readOnlyDb.select({ sql: "SELECT TOP (1000) FormID, ItemID, ColID, ActionT, IndexID FROM CSHS WHERE FormID IN ('139', '140', '133') ORDER BY FormID, ItemID, ColID" });
        entry.valueCounts = await readOnlyDb.select({ sql: "SELECT T0.FormID, T0.ItemID, T0.ColID, COUNT(*) AS valueCount FROM CSHS T0 INNER JOIN CUVV T1 ON T0.IndexID = T1.IndexID WHERE T0.FormID IN ('139', '140', '133') AND T0.ActionT = 1 GROUP BY T0.FormID, T0.ItemID, T0.ColID" });
      }
      console.log(JSON.stringify({ database: name, documents: entry.documents.map(d => ({ type: d.documentType, layouts: d.layout.length, lookups: [...d.mappedFields.header, ...d.mappedFields.lines].filter(f => f.valueCount !== undefined).map(f => ({ field: f.id, count: f.valueCount })) })), preferences: entry.livePreferences.length }));
      entry.documents = entry.documents.map(d => ({ documentType: d.documentType, lookupApiVerified: true,
        physicalColumnCounts: Object.fromEntries(Object.entries(d.physical).map(([table, fields]) => [table, fields.length])),
        udfCounts: Object.fromEntries(Object.entries(d.udfs).map(([table, fields]) => [table, fields.length])),
        savedLayoutRows: d.layout.length, liveLayout: d.liveLayout, staleLayoutUdfs: d.staleLayoutUdfs,
        orphanedValueLists: d.orphanedValueLists, mappedFields: d.mappedFields,
      }));
      delete entry.livePreferences;
    } catch (error) {
      entry.error = error.message;
      console.error(`${name}: ${error.message}`);
    } finally { await pool.close(); }
  }
  auth.close();
  const output = path.resolve(__dirname, '../../docs/sales-document-field-audit.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  if (report.companies.some(c => c.error)) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
