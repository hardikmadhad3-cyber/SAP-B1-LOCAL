const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const roundDocumentValue = (value, decimals = 2) => {
  const precision = Math.max(0, Number(decimals) || 0);
  const factor = 10 ** precision;
  return Math.round((toFiniteNumber(value) + Number.EPSILON) * factor) / factor;
};

export const calculateDocumentRounding = (value, enabled, decimals = 2, savedHeader = null, policy = null) => {
  const totalBeforeRounding = roundDocumentValue(value, decimals);
  const manualAmount = savedHeader?.roundingAmount;
  if (enabled && savedHeader?.roundingAmountIsManual === true
      && manualAmount !== '' && manualAmount !== null && manualAmount !== undefined
      && Number.isFinite(Number(manualAmount))) {
    return {
      totalBeforeRounding,
      roundingAmount: Number(manualAmount),
      total: roundDocumentValue(totalBeforeRounding + Number(manualAmount), decimals),
    };
  }
  // RoundDif and DocTotal are SAP-owned values, not a whole-currency-unit rule.
  // Reuse a saved result only while its monetary basis still matches the form.
  const savedAmount = savedHeader?.roundingAmount ?? savedHeader?.RoundingDiffAmount ?? savedHeader?.RoundDif;
  const savedTotal = savedHeader?.totalPaymentDue ?? savedHeader?.DocTotal;
  const hasNumber = (amount) => amount !== null && amount !== undefined
    && String(amount).trim() !== '' && Number.isFinite(Number(amount));
  const unchanged = savedHeader && (enabled || Number(savedAmount) === 0)
    && hasNumber(savedAmount) && hasNumber(savedTotal)
    && Math.abs(Number(savedTotal) - Number(savedAmount) - toFiniteNumber(value))
      <= Math.max(0.000001, 10 ** -Math.max(0, Number(decimals) || 0));
  const step = enabled && String(policy?.method || '').toUpperCase() === 'Y'
    ? ({ 0: 0, 1: 0.1, 2: 1, 3: 10, 4: 0.05 }[Number(policy?.roundingSystem)] || 0) : 0;
  const rounded = step ? roundDocumentValue(
    Math.sign(totalBeforeRounding) * Math.round((Math.abs(totalBeforeRounding) + Number.EPSILON) / step) * step,
    decimals,
  ) : totalBeforeRounding;
  const roundingAmount = unchanged ? Number(savedAmount) : roundDocumentValue(rounded - totalBeforeRounding, decimals);
  // Preserve stored precision, even when the current display uses fewer decimals.
  const total = unchanged ? Number(savedTotal) : rounded;

  return { totalBeforeRounding, roundingAmount, total };
};

export const getDocumentRoundingPolicy = (referenceData = {}, header = {}) => {
  const code = String(header.currency || header.DocCur || referenceData.local_currency || '').toUpperCase();
  const rows = referenceData.rounding_settings?.currencies || referenceData.currencies || [];
  const currency = rows.find(row => String(row.CurrCode || row.code || '').toUpperCase() === code);
  return { method: referenceData.rounding_settings?.method, roundingSystem: currency?.RoundSys };
};

export const getDocumentRoundingPayloadAmount = (header, calculatedAmount) => (
  header?.roundingAmountIsManual === true ? header.roundingAmount : calculatedAmount
);

// Small saved SAP adjustments must not disappear at the document's display precision.
export const formatDocumentRoundingAmount = (value, decimals = 2) => {
  const amount = toFiniteNumber(value);
  const fraction = amount.toFixed(6).replace(/0+$/, '').split('.')[1] || '';
  const precision = Math.max(Math.min(6, Math.max(0, Number(decimals) || 0)), fraction.length);
  return amount.toFixed(precision);
};
