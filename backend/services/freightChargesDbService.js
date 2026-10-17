const db = require('./dbService');

const ALLOWED_FREIGHT_TABLES = new Set([
  'POR3',
  'PQT3',
  'PRQ3',
  'PDN3',
  'PCH3',
  'RPC3',
]);

const PURCHASE_FREIGHT_TEMPLATE = [
  { ExpnsName: 'Cash Discount RS 5/', DistributionMethod: 'N' },
  { ExpnsName: 'Damarage Settlement', DistributionMethod: 'N' },
  { ExpnsName: 'Discount', DistributionMethod: 'Q' },
  { ExpnsName: 'Freight', DistributionMethod: 'V' },
  { ExpnsName: 'Insurance', DistributionMethod: 'W' },
  { ExpnsName: 'Offer Discount', DistributionMethod: 'E' },
];

const safe = async (promise) => {
  try {
    const result = await promise;
    return result.recordset || [];
  } catch (_error) {
    // Logged, not hidden: a failing query would otherwise look like "no data".
    console.warn('[DB] query failed, returning no rows:', _error?.message || _error);
    return [];
  }
};

const applyPurchaseFreightTemplate = (rows = []) =>
  PURCHASE_FREIGHT_TEMPLATE.map((templateRow, index) => {
    const sourceRow = rows[index] || {};
    return {
      ExpnsCode: sourceRow.ExpnsCode || `PUR-FRT-${index + 1}`,
      ExpnsName: templateRow.ExpnsName,
      DistributionMethod: templateRow.DistributionMethod,
      FreightTaxDistributionMethod: 'N',
      TaxLiable: sourceRow.TaxLiable ?? 'Y',
      DefaultAmount: 0,
      Status: 'O',
      LineTotal: Number(sourceRow.LineTotal || 0),
      TaxCode: sourceRow.TaxCode || '',
      TaxAmount: Number(sourceRow.TaxAmount || 0),
      Comments: sourceRow.Comments || '',
    };
  });

const getDocumentFreightCharges = async (detailTable, docEntry) => {
  if (!ALLOWED_FREIGHT_TABLES.has(detailTable)) {
    throw new Error(`Unsupported freight detail table: ${detailTable}`);
  }

  if (!docEntry) {
    const rows = await safe(db.query(`
      SELECT
        T0.ExpnsCode,
        T0.ExpnsName,
        T0.DistrbMthd AS DistributionMethod,
        'N' AS FreightTaxDistributionMethod,
        T0.TaxLiable,
        0 AS DefaultAmount,
        'O' AS Status,
        0 AS LineTotal,
        '' AS TaxCode,
        0 AS TaxAmount,
        '' AS Comments
      FROM OEXD T0
      ORDER BY T0.ExpnsName
    `));
    return applyPurchaseFreightTemplate(rows);
  }

  const rows = await safe(db.query(`
    SELECT
      T0.ExpnsCode,
      T0.ExpnsName,
      T0.DistrbMthd AS DistributionMethod,
      'N' AS FreightTaxDistributionMethod,
      T0.TaxLiable,
      0 AS DefaultAmount,
      'O' AS Status,
      ISNULL(T1.LineTotal, 0) AS LineTotal,
      ISNULL(T1.TaxCode, '') AS TaxCode,
      ISNULL(T1.VatSum, 0) AS TaxAmount,
      ISNULL(T1.Comments, '') AS Comments
    FROM OEXD T0
    LEFT JOIN ${detailTable} T1
      ON T0.ExpnsCode = T1.ExpnsCode
     AND T1.DocEntry = @DocEntry
    ORDER BY T0.ExpnsName
  `, { DocEntry: docEntry }));
  return applyPurchaseFreightTemplate(rows);
};

module.exports = {
  getDocumentFreightCharges,
};
