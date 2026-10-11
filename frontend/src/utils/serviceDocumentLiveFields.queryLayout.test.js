import { buildServiceCompanyQueryColumns } from './serviceDocumentLiveFields';

test('service SQL columns retain captions and map duplicated aliases to the same SAP payload field', () => {
  const columns = buildServiceCompanyQueryColumns({
    queryLayout: { isPublished: true, columns: [
      { key: 'GL_Account', label: 'G/L Account', fieldName: 'AcctCode' },
      { key: 'Commission', label: 'Commission', fieldName: 'U_Com' },
      { key: 'Commission_2', label: 'Commission', fieldName: 'U_Com' },
      { key: 'Old_Company_Field', fieldName: 'U_OldCompany' },
    ] },
    liveMatrixColumns: [{ key: 'glAccount', fieldName: 'AcctCode', label: 'Account', lookup: 'account' }],
    rowUdfFields: [{ key: 'U_Com', label: 'Commission', type: 'number' }],
  });
  expect(columns.map((column) => column.label)).toEqual(['G/L Account', 'Commission', 'Commission']);
  expect(columns.map((column) => column.key)).toEqual(['glAccount', 'udf:U_Com', 'udf:U_Com:2']);
  expect(columns.map((column) => column.valueKey)).toEqual(['glAccount', 'U_Com', 'U_Com']);
  expect(columns[0].lookup).toBe('account');
  expect(columns.slice(1).every((column) => column.udfKey === 'U_Com' && column.isUdf)).toBe(true);
});

test('service SQL read-only captions bind to loaded display values', () => {
  const columns = buildServiceCompanyQueryColumns({
    queryLayout: { isPublished: true, columns: [
      { key: 'GL_Account_Name', label: 'G/L Account Name', fieldName: 'AccountName' },
      { key: 'Tax_Amount', label: 'Tax Amount (LC)', fieldName: 'VatSum' },
    ] },
    liveMatrixColumns: [
      { key: 'glAccountName', label: 'G/L Account Name', readOnly: true },
      { key: 'taxAmountLC', label: 'Tax Amount (LC)', readOnly: true, numeric: true },
    ],
  });
  expect(columns.map((column) => [column.key, column.readOnly])).toEqual([
    ['glAccountName', true], ['taxAmountLC', true],
  ]);
});
