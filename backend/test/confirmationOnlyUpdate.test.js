'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { updateDocumentConfirmationOnly } = require('../services/documentConfirmationUtils');

test('each document entity receives exactly one narrow Service Layer PATCH', async () => {
  for (const entity of ['DeliveryNotes', 'Orders', 'Quotations', 'Invoices', 'CreditNotes', 'PurchaseOrders',
    'PurchaseQuotations', 'PurchaseRequests', 'PurchaseDeliveryNotes', 'PurchaseInvoices', 'PurchaseCreditNotes']) {
    const calls = [];
    const sap = { request: async config => { calls.push(config); } };
    await updateDocumentConfirmationOnly(30, { company_id: 1, confirmation_only: true, header: { confirmed: true } }, entity, sap);
    assert.deepEqual(calls, [{ method: 'PATCH', url: `/${entity}(30)`, data: { Confirmed: 'tYES' } }]);
  }
});
test('rejects accidental extra fields and invalid identifiers before any SAP write', async () => {
  let calls = 0;
  const sap = { request: async () => { calls++; } };
  for (const extra of [{ lines: [] }, { freightCharges: [] }, { header_udfs: {} }, { header: { confirmed: true, tax: 0 } }]) {
    await assert.rejects(updateDocumentConfirmationOnly(30,
      { confirmation_only: true, header: { confirmed: true }, ...extra }, 'DeliveryNotes', sap), /Confirmation-only/);
  }
  await assert.rejects(updateDocumentConfirmationOnly('30)bad', { confirmation_only: true, header: { confirmed: true } }, 'DeliveryNotes', sap));
  assert.equal(calls, 0);
});
test('delivery narrow update bypasses the full financial/UDF builders', async () => {
  const source = fs.readFileSync(require.resolve('../services/deliveryService'), 'utf8');
  const start = source.indexOf('const updateDelivery = async');
  const end = source.indexOf('const getFreightCharges =', start);
  const calls = [];
  const update = vm.runInNewContext(source.slice(start, end) + '\nupdateDelivery', {
    updateDocumentConfirmationOnly, sapService: { request: async config => { calls.push(config); } },
    validateDeliveryDocument: () => { throw new Error('Full validation must not run'); },
  });
  await update(30, { confirmation_only: true, header: { confirmed: true } });
  assert.deepEqual(calls[0].data, { Confirmed: 'tYES' });
});
test('Service Layer does not add automatic audit UDFs to a narrow confirmation PATCH', async () => {
  const source = fs.readFileSync(require.resolve('../services/sapService'), 'utf8');
  const start = source.indexOf('const withAuthenticatedUserStamp = async');
  const end = source.indexOf('\n};', start) + 4;
  const stamp = vm.runInNewContext(source.slice(start, end) + '\nwithAuthenticatedUserStamp', {
    getServiceLayerEntity: () => 'DeliveryNotes', USER_STAMP_ENDPOINT_TABLES: new Map([['DeliveryNotes', 'ODLN']]),
    getAuthenticatedUserStamp: () => { throw new Error('Audit stamping must not run'); },
  });
  const data = { Confirmed: 'tYES' };
  assert.equal(await stamp({ method: 'PATCH', url: '/DeliveryNotes(30)', data }, 'TEST'), data);
});
