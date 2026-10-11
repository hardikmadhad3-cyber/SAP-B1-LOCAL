import { calculateDocumentRounding, getDocumentRoundingPolicy, getDocumentRoundingPayloadAmount, formatDocumentRoundingAmount } from './documentRounding';

test.each([[0.003,2,'0.003'],[-0.00001,2,'-0.00001'],[0,2,'0.00'],[0.01,4,'0.0100'],[-0.416,4,'-0.4160']])('saved rounding stays visible (%s)', (value,decimals,expected)=>{
 expect(formatDocumentRoundingAmount(value,decimals)).toBe(expected);
});

describe('calculateDocumentRounding', () => {
  test('does not invent whole-unit rounding before SAP calculates it', () => {
    expect(calculateDocumentRounding(31220.3776, true, 4)).toEqual({
      totalBeforeRounding: 31220.3776,
      roundingAmount: 0,
      total: 31220.3776,
    });
  });

  test('keeps the calculated total unchanged when rounding is disabled', () => {
    expect(calculateDocumentRounding(31220.3776, false, 4)).toEqual({
      totalBeforeRounding: 31220.3776,
      roundingAmount: 0,
      total: 31220.3776,
    });
  });
});

test('a manually entered difference overrides currency rounding and updates the total', () => {
  const header = { rounding: true, roundingAmount: '-0.15', roundingAmountIsManual: true };
  const policy = { method: 'Y', roundingSystem: 2 };
  expect(calculateDocumentRounding(100.4, true, 2, header, policy)).toEqual({
    totalBeforeRounding: 100.4, roundingAmount: -0.15, total: 100.25,
  });
  expect(calculateDocumentRounding(100.4, false, 2, header, policy).roundingAmount).toBe(0);
});

test('keeps the exact manual difference even when the displayed total has fewer decimals', () => {
  expect(calculateDocumentRounding(100, true, 2, {
    roundingAmount: '-0.416', roundingAmountIsManual: true,
  })).toEqual({ totalBeforeRounding: 100, roundingAmount: -0.416, total: 99.58 });
});

test('sends the exact entered difference instead of the displayed rounded amount', () => {
  expect(getDocumentRoundingPayloadAmount({ roundingAmountIsManual: true, roundingAmount: '-0.416' }, '-0.42')).toBe('-0.416');
  expect(getDocumentRoundingPayloadAmount({ roundingAmountIsManual: false, roundingAmount: '-0.416' }, '-0.42')).toBe('-0.42');
});

test('preserves the saved SAP delivery difference and total without losing precision', () => {
  expect(calculateDocumentRounding(394369.92, true, 2, {
    rounding: true, roundingAmount: '-0.416000', totalPaymentDue: '394369.504000',
  })).toEqual({ totalBeforeRounding: 394369.92, roundingAmount: -0.416, total: 394369.504 });
});

test('does not reuse a previous document or company rounding on a changed basis', () => {
  const saved = { rounding: true, roundingAmount: '-0.416', totalPaymentDue: '394369.504' };
  expect(calculateDocumentRounding(100.25, true, 2, saved).roundingAmount).toBe(0);
  expect(calculateDocumentRounding(394369.92, false, 2, saved).roundingAmount).toBe(0);
  expect(calculateDocumentRounding(100.25, true, 2).total).toBe(100.25);
});

test('retains a valid zero saved rounding difference', () => {
  expect(calculateDocumentRounding(100.125, true, 3, {
    roundingAmount: '0', totalPaymentDue: '100.125',
  }).total).toBe(100.125);
});

test.each([[0, 123.4567], [1, 123.5], [2, 123], [3, 120], [4, 123.45]])('uses SAP currency rounding system %s', (roundingSystem, total) => {
  expect(calculateDocumentRounding(123.4567, true, 4, null, { method: 'Y', roundingSystem }).total).toBe(total);
});

test('new copied invoice uses current company currency rule, not historical source RoundDif', () => {
  const source = { roundingAmount: '-0.416', totalPaymentDue: '394369.504' };
  const policy = getDocumentRoundingPolicy({ local_currency: 'INR', rounding_settings: {
    method: 'Y', currencies: [{ CurrCode: 'INR', RoundSys: 0 }],
  } }, { currency: 'INR' });
  expect(calculateDocumentRounding(394369.92, true, 4, source, policy).total).toBe(394369.504);
  expect(calculateDocumentRounding(394369.92, true, 4, null, policy)).toEqual({
    totalBeforeRounding: 394369.92, roundingAmount: 0, total: 394369.92,
  });
});

test('partial copies and changed totals are rounded on the target basis', () => {
  const policy = { method: 'Y', roundingSystem: 2 };
  const source = { roundingAmount: '-0.4', totalPaymentDue: '100' };
  expect(calculateDocumentRounding(50.2, true, 4, null, policy).total).toBe(50);
  expect(calculateDocumentRounding(50.2, true, 4, source, policy).roundingAmount).toBe(-0.2);
  expect(calculateDocumentRounding(50.2, false, 4, null, policy).total).toBe(50.2);
});

test('purchase total 154358.4000 rounds to the whole currency unit from SAP policy', () => {
  const policy = getDocumentRoundingPolicy({
    local_currency: 'INR',
    rounding_settings: {
      method: 'Y',
      currencies: [{ CurrCode: 'INR', RoundSys: 2 }],
    },
  }, { currency: 'INR' });

  expect(calculateDocumentRounding(154358.4, true, 4, null, policy)).toEqual({
    totalBeforeRounding: 154358.4,
    roundingAmount: -0.4,
    total: 154358,
  });
});

test('rounding policy stays isolated by active company and currency', () => {
  const a = { local_currency: 'INR', rounding_settings: { method: 'Y', currencies: [{ CurrCode: 'INR', RoundSys: 2 }] } };
  const b = { local_currency: 'INR', rounding_settings: { method: 'Y', currencies: [{ CurrCode: 'INR', RoundSys: 0 }] } };
  expect(calculateDocumentRounding(10.4, true, 4, null, getDocumentRoundingPolicy(a)).total).toBe(10);
  expect(calculateDocumentRounding(10.4, true, 4, null, getDocumentRoundingPolicy(b)).total).toBe(10.4);
  expect(getDocumentRoundingPolicy(a, { currency: 'USD' }).roundingSystem).toBeUndefined();
});
