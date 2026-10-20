'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Local ERP: the built-in standard layout is the normal path, so pages and the
// server log must not report "No imported layout" / SAP Form Settings warnings.
test('document layout fallback is silent in the local ERP', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/sapDocumentLayoutService.js'), 'utf8');
  assert.doesNotMatch(source, /No imported layout found/);
  assert.doesNotMatch(source, /Live SAP Form Settings were unavailable/);
});
