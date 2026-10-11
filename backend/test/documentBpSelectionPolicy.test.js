const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveDocumentBpSelectionPolicy,
  assertDocumentBpSelection,
  filterBpOptions,
} = require('../services/documentBpSelectionPolicy');

test('restricts only the requested documents in NCPL_110126', () => {
  assert.deepEqual(resolveDocumentBpSelectionPolicy('NCPL_110126', 'salesOrder'), { preferredCardCode: 'CUS00938', excludedCardCodes: ['AC00350'] });
  assert.deepEqual(resolveDocumentBpSelectionPolicy('NCPL_110126', 'delivery'), { preferredCardCode: 'CUS00938', excludedCardCodes: ['AC00350'] });
  assert.deepEqual(resolveDocumentBpSelectionPolicy('NCPL_110126', 'arInvoice'), { preferredCardCode: 'AC00350', excludedCardCodes: ['CUS00938'] });
  assert.equal(resolveDocumentBpSelectionPolicy('NOCPL_LIVE', 'salesOrder'), null);
  assert.equal(resolveDocumentBpSelectionPolicy('NCPL_110126', 'salesQuotation'), null);
});

test('keeps unrelated customers and excludes only the wrong duplicate BP', () => {
  const policy = resolveDocumentBpSelectionPolicy('NCPL_110126', 'salesOrder');
  assert.deepEqual(filterBpOptions([{ CardCode: 'AC00350' }, { CardCode: 'CUS00938' }, { CardCode: 'OTHER123' }], policy),
    [{ CardCode: 'CUS00938' }, { CardCode: 'OTHER123' }]);
  assert.throws(() => assertDocumentBpSelection(policy, 'AC00350'), /CUS00938/);
  assert.doesNotThrow(() => assertDocumentBpSelection(policy, 'cus00938'));
  assert.doesNotThrow(() => assertDocumentBpSelection(policy, 'OTHER123'));
});

test('allows existing document BPs and changes to unrelated customers', () => {
  const policy = resolveDocumentBpSelectionPolicy('NCPL_110126', 'arInvoice');
  assert.doesNotThrow(() => assertDocumentBpSelection(policy, 'OLD123', { existingCode: 'OLD123' }));
  assert.throws(() => assertDocumentBpSelection(policy, 'CUS00938', { existingCode: 'OLD123' }), /AC00350/);
  assert.doesNotThrow(() => assertDocumentBpSelection(policy, 'OTHER', { existingCode: 'OLD123' }));
});
