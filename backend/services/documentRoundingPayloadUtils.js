'use strict';

const ROUNDING_TRUE_VALUES = new Set(['Y', 'YES', 'TRUE', '1', 'TYES']);

const isRoundingEnabled = (value) => ROUNDING_TRUE_VALUES.has(
  String(value ?? '').trim().toUpperCase(),
);

const toOptionalRoundingAmount = (value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return undefined;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : undefined;
};

const buildDocumentRoundingPayload = (header = {}) => {
  const enabled = isRoundingEnabled(header.rounding ?? header.Rounding);
  const Rounding = enabled ? 'tYES' : 'tNO';

  if (!enabled) {
    return { Rounding, RoundingDiffAmount: 0 };
  }

  const roundingAmount = toOptionalRoundingAmount(
    header.roundingAmount ?? header.RoundingDiffAmount ?? header.RoundDif,
  );
  if (header.roundingAmountIsManual === true && roundingAmount === undefined) {
    const error = new Error('Enter a valid rounding amount.');
    error.statusCode = 400;
    throw error;
  }

  return {
    Rounding,
    // A calculated/display amount must never override the active company's SAP
    // rounding policy. Only a deliberately entered manual difference is writable.
    ...(header.roundingAmountIsManual === true && roundingAmount !== undefined
      ? { RoundingDiffAmount: roundingAmount } : {}),
  };
};

module.exports = {
  buildDocumentRoundingPayload,
  isRoundingEnabled,
  toOptionalRoundingAmount,
};
