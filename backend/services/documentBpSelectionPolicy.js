const { getActiveCompanyConfig } = require('./companyConfigService');

const COMPANY_DB = 'NCPL_110126';
// Only the duplicate BP pair differs by document; all other BPs stay available.
const DUPLICATE_BP_CODES = Object.freeze({
  salesOrder: { preferredCardCode: 'CUS00938', excludedCardCodes: ['AC00350'] },
  delivery: { preferredCardCode: 'CUS00938', excludedCardCodes: ['AC00350'] },
  arInvoice: { preferredCardCode: 'AC00350', excludedCardCodes: ['CUS00938'] },
});

const resolveDocumentBpSelectionPolicy = (companyDb, documentType) => {
  if (String(companyDb || '').trim().toUpperCase() !== COMPANY_DB) return null;
  return DUPLICATE_BP_CODES[documentType] || null;
};

const getDocumentBpSelectionPolicy = async (documentType) => {
  const config = await getActiveCompanyConfig();
  return resolveDocumentBpSelectionPolicy(config?.sql?.database, documentType);
};

const isAllowedBp = (policy, code) => !policy || !(policy.excludedCardCodes || []).some(
  (excluded) => excluded.toUpperCase() === String(code || '').trim().toUpperCase()
);

const assertDocumentBpSelection = (policy, code, { existingCode = '' } = {}) => {
  if (isAllowedBp(policy, code)) return;
  if (existingCode && String(existingCode).trim().toUpperCase() === String(code || '').trim().toUpperCase()) return;
  const error = new Error(`Use business partner ${policy.preferredCardCode} for this customer on this document.`);
  error.statusCode = 403;
  throw error;
};

const filterBpOptions = (rows, policy) => (
  policy ? (rows || []).filter((row) => isAllowedBp(policy, row.CardCode || row.code || row.name)) : rows
);

module.exports = {
  resolveDocumentBpSelectionPolicy,
  getDocumentBpSelectionPolicy,
  assertDocumentBpSelection,
  filterBpOptions,
};
