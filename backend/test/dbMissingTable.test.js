const test = require('node:test');
const assert = require('node:assert/strict');
const { isMissingTableError } = require('../services/dbService');

test('a missing optional SAP table is recognised on PostgreSQL, SQL Server and HANA', () => {
  assert.equal(isMissingTableError(new Error('relation "IBT1" does not exist')), true);
  assert.equal(isMissingTableError(new Error("Invalid object name 'DLN26'.")), true);
  assert.equal(isMissingTableError(new Error('invalid table name:  Could not find table/view OITL')), true);
  assert.equal(isMissingTableError(new Error('column "Foo" does not exist')), false);
});
