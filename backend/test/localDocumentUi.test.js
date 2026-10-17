const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('local document pages do not depend on the retired SAP layout client', () => {
  const root = path.resolve(__dirname, '../../frontend/src');
  for (const file of fs.readdirSync(root, { recursive: true })) {
    if (!/\.(js|jsx)$/.test(file)) continue;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /(?:from|require\()\s*['"][^'"]*(?:PrintLayoutToolbar|PurchasePrintLayoutActions|InventoryPrintLayoutActions|PrintSalesOrderActions|documentPrintApi|useDocumentLayouts)['"]/, file);
  }
});
