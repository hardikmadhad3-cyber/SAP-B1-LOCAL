// Requested Sales Order defaults for these company databases. Other companies
// use the current company's SAP UDF default when one is configured.
const COMPANY_COMMISSION_DEFAULTS = Object.freeze({
  dc_livedb: Object.freeze({ commPercent: '2.5' }),
  nc_live: Object.freeze({ commission: '1.5' }),
});

export const getSalesOrderCommissionDefaults = (companyDb, rowUdfDefinitions = []) => {
  const companyDefault = COMPANY_COMMISSION_DEFAULTS[String(companyDb || '').trim().toLowerCase()];
  const commissionUdf = (rowUdfDefinitions || []).find((field) =>
    String(field?.key || field?.sapField || '').trim().toUpperCase() === 'U_COMPRC'
  );
  return {
    commission: companyDefault?.commission ?? String(commissionUdf?.defaultValue ?? '').trim(),
    commPercent: companyDefault?.commPercent ?? '',
  };
};
