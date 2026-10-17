const test = require('node:test');
const assert = require('node:assert/strict');
const { compile } = require('../services/udfExpression');

test('an empty numeric UDF passes a ">= 0" validation rule (blank counts as 0)', () => {
  assert.equal(compile('U_Width >= 0').run({ U_Width: null }), true);
  assert.equal(compile('U_Width >= 0').run({}), true);
  assert.equal(compile('U_Width >= 0').run({ U_Width: -1 }), false);
  assert.equal(compile("U_Code <> ''").run({ U_Code: null }), false);
});
