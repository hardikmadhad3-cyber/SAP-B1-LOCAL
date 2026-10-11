'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSapFormValueLists, applySapFormValueLists } = require('../modules/newSalesOrder/sapFormValueLists');
const { SALES_DOCUMENTS, SALES_ORDER_DOCUMENT } = require('../modules/newSalesOrder/newSalesOrderConstants');
const { assertStaticReadOnlySql } = require('../modules/newSalesOrder/newSalesOrderReadOnlyDbService');
const { createNewSalesOrderLookupService } = require('../modules/newSalesOrder/newSalesOrderLookupService');

test('form lists use only SELECT, exact document scope, optional metadata, and SAP value order on both dialects', async () => {
  for (const dialect of ['sqlserver', 'hana']) {
    for (const document of Object.values(SALES_DOCUMENTS)) {
      const calls = [];
      await readSapFormValueLists({
        context: { companyDb: 'COMPANY_A' }, document, dialect,
        getTableColumns: async (_context, table) => (table === 'CSHS'
          ? ['FormID', 'ItemID', 'ColID', 'ActionT', 'IndexID'] : ['IndexID', 'Value', 'LineNum'])
          .map(columnName => ({ columnName })),
        readOnlyDb: { select: async request => { calls.push(request); return []; } },
      });
      assert.equal(calls.length, 1);
      assertStaticReadOnlySql(calls[0].sql);
      assert.deepEqual(calls[0].params, { formId: document.formType });
      assert.match(calls[0].sql, /ActionT.*= 1/);
      assert.match(calls[0].sql, /ORDER BY.*IndexID.*LineNum/);
      assert.doesNotMatch(calls[0].sql, /OUQR/);
    }
  }
  assert.deepEqual(await readSapFormValueLists({ context: {}, document: SALES_ORDER_DOCUMENT,
    getTableColumns: async () => [], readOnlyDb: { select: () => assert.fail('Missing optional table must not be queried') },
  }), []);
});

const field = id => ({ id, storage: 'udf', databaseField: id.split('.')[1], sapField: id.split('.')[1], options: [], lookup: null });
const base = { headerFields: [field('ORDR.U_Transport')], lineFields: [field('RDR1.U_Seller_Quality'), field('RDR1.U_Buyer_Payment_Terms')] };
test('maps exact field and matrix identities without attaching orphaned payment-term lists or enforcing suggestions', () => {
  const schema = applySapFormValueLists(base, [
    { itemId: '38', columnId: 'U_Seller_Quality', value: '15 FFA MAX.' },
    { itemId: '39', columnId: 'U_Seller_Quality', value: 'WRONG MATRIX' },
    { itemId: '38', columnId: 'U_Buyer_Payment_Term', value: 'ORPHANED LIST' },
    { itemId: 'U_Transport', columnId: '-1', value: 'Carrier' },
  ], SALES_ORDER_DOCUMENT);
  assert.deepEqual(schema.lineFields[0].userValueOptions, [{ value: '15 FFA MAX.', label: '15 FFA MAX.' }]);
  assert.equal(schema.lineFields[0].lookup.allowFreeText, true);
  assert.deepEqual(schema.lineFields[0].options, []);
  assert.equal(schema.lineFields[1].lookup, null);
  assert.equal(schema.headerFields[0].lookupSource, 'sap-user-values');
  assert.equal(applySapFormValueLists(base, [], SALES_ORDER_DOCUMENT).lineFields[0].lookup, null);
});

test('live API pages/searches CUVV, permits an empty SAP list, and does not use historical values', async () => {
  const schema = applySapFormValueLists(base, Array.from({ length: 105 }, (_, i) => ({
    itemId: '38', columnId: 'U_Seller_Quality', value: `Quality ${i}`,
  })), SALES_ORDER_DOCUMENT);
  const service = createNewSalesOrderLookupService({ readOnlyDb: { select: () => assert.fail('No stored SQL execution') },
    metadata: {}, schemas: { getSchema: async () => schema } });
  const input = { fieldId: 'RDR1.U_Seller_Quality', documentType: 'SALES_ORDER', limit: 100 };
  const first = await service.getLookup({ companyId: 1, companyDb: 'A' }, 'sap-user-values', input);
  assert.equal(first.items.length, 100);
  assert.equal(first.hasMore, true);
  const second = await service.getLookup({ companyId: 1, companyDb: 'A' }, 'sap-user-values', { ...input, page: 2 });
  assert.equal(second.items.length, 5);
  assert.equal(second.hasMore, false);
  const match = await service.getLookup({ companyId: 1, companyDb: 'A' }, 'sap-user-values', { ...input, q: 'Quality 104' });
  assert.equal(match.items[0].value, 'Quality 104');
  schema.lineFields[0].userValueOptions[1] = schema.lineFields[0].userValueOptions[0];
  const duplicatePage = await service.getLookup({ companyId: 1, companyDb: 'A' }, 'sap-user-values', input);
  assert.equal(duplicatePage.items.length, 100);
  assert.equal(duplicatePage.hasMore, true);
  assert.equal(duplicatePage.items[0].value, duplicatePage.items[1].value);
  assert.deepEqual(await service.validateLookupValue({ field: schema.lineFields[0], value: 'Custom text' }), { valid: true });
  schema.lineFields[0].userValueOptions = [];
  assert.equal((await service.getLookup({ companyId: 1, companyDb: 'A' }, 'sap-user-values', input)).items.length, 0);
});
