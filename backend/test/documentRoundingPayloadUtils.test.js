'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDocumentRoundingPayload,
} = require('../services/documentRoundingPayloadUtils');

test('maps an enabled document rounding difference to the SAP Service Layer', () => {
  assert.deepEqual(buildDocumentRoundingPayload({
    rounding: true,
    roundingAmount: '-0.3776',
    roundingAmountIsManual: true,
  }), {
    Rounding: 'tYES',
    RoundingDiffAmount: -0.3776,
  });
});

test('accepts formatted and SAP-shaped rounding values', () => {
  assert.deepEqual(buildDocumentRoundingPayload({
    Rounding: 'tYES',
    RoundingDiffAmount: '1,234.50',
    roundingAmountIsManual: true,
  }), {
    Rounding: 'tYES',
    RoundingDiffAmount: 1234.5,
  });
});

test('lets SAP calculate an enabled difference when the client omitted the amount', () => {
  assert.deepEqual(buildDocumentRoundingPayload({ rounding: true }), {
    Rounding: 'tYES',
  });
});

test('clears a stale difference when document rounding is disabled', () => {
  assert.deepEqual(buildDocumentRoundingPayload({
    rounding: false,
    roundingAmount: '-0.3776',
  }), {
    Rounding: 'tNO',
    RoundingDiffAmount: 0,
  });
});

test('delegates calculated or loaded differences to SAP for each company policy', () => {
  for (const roundingAmount of ['0.08', '-0.416', '0', '', 'invalid']) {
    assert.deepEqual(buildDocumentRoundingPayload({ rounding: true, roundingAmount }), {
      Rounding: 'tYES',
    });
  }
});

test('rejects an incomplete manual amount instead of silently using automatic rounding', () => {
  for (const amount of ['', '-', '.', 'not a number']) {
    assert.throws(() => buildDocumentRoundingPayload({
      rounding: true, roundingAmount: amount, roundingAmountIsManual: true,
    }), /valid rounding amount/);
  }
  assert.deepEqual(buildDocumentRoundingPayload({
    rounding: true, roundingAmount: '0', roundingAmountIsManual: true,
  }), { Rounding: 'tYES', RoundingDiffAmount: 0 });
});
