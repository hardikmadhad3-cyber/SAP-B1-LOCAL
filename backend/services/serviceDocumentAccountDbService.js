const db = require('./dbService');
const { createTableColumnDetailsReader } = require('./salesDocumentDbCompatibility');

const readColumns = createTableColumnDetailsReader({ database: db });

// Service documents need every posting account, including accounts beyond the
// first page of the Chart of Accounts. Optional OACT fields vary by company.
const getServiceDocumentAccounts = async () => {
  const details = await readColumns('OACT');
  const columns = new Map(details.map((row) => [String(row.columnName || '').toUpperCase(), row.columnName]));
  const optional = (name, fallback = 'NULL') => columns.has(name.toUpperCase())
    ? `A.${columns.get(name.toUpperCase())}` : fallback;
  const result = await db.query(`
    SELECT A.AcctCode, A.AcctName,
      ${optional('FormatCode')} AS FormatCode,
      ${optional('FrozenFor', "'N'")} AS FrozenFor,
      ${optional('Postable', "'Y'")} AS Postable,
      ${optional('CurrTotal', '0')} AS CurrTotal
    FROM OACT A
    ORDER BY A.AcctCode
  `);
  return (result.recordset || [])
    .filter((row) => String(row.FrozenFor || '').toUpperCase() !== 'Y'
      && String(row.Postable || '').toUpperCase() !== 'N')
    .map((row) => ({
      code: String(row.AcctCode || '').trim(),
      formatCode: String(row.FormatCode || '').trim(),
      name: String(row.AcctName || '').trim(),
      balance: Number(row.CurrTotal || 0),
      inactive: 'No',
    }))
    .filter((row) => row.code);
};

module.exports = { getServiceDocumentAccounts };
