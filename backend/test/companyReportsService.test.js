const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const authDbService = require('../services/authDbService');
const dbService = require('../services/dbService');
const reportService = require('../services/reportService');
const service = require('../services/companyReportsService');

const auth = { companyId: 2, roleId: 1 };
const withMocks = async (replacements, run) => {
  const stubs = [];
  for (const [object, method, implementation] of replacements) {
    stubs.push(mock.method(object, method, implementation));
  }
  try { await run(); } finally { stubs.forEach((stub) => stub.mock.restore()); }
};

test('catalog requires Company Reports permission', async () => {
  await withMocks([
    [authDbService, 'queryOne', async () => null],
    [reportService, 'loadAuthorizedCrList', async () => { throw new Error('must not load'); }],
  ], async () => {
    await assert.rejects(service.listCompanyReports(auth), { statusCode: 403 });
  });
});

test('Company Reports access does not require granting the broader Reports menu', async () => {
  await withMocks([
    [authDbService, 'queryOne', async (_sql, params) => {
      assert.equal(params.path, '/reports/company');
      return { CanView: 1 };
    }],
    [reportService, 'loadAuthorizedCrList', async () => []],
    [dbService, 'query', async () => ({ recordset: [] })],
  ], async () => assert.deepEqual((await service.listCompanyReports({ companyId: 2, roleId: 5 })).items, []));
});

test('blank optional company report filters stay blank instead of restoring defaults', async () => {
  let exported;
  await withMocks([
    [authDbService, 'queryOne', async () => ({ CanView: 1 })],
    [reportService, 'loadAuthorizedCrList', async () => [{ code: 'RCRI0108', name: 'Soda Sales' }]],
    [dbService, 'query', async () => ({ recordset: [{ DocCode: 'RCRI0108', Status: 'A' }] })],
    [reportService, 'loadReportParameters', async () => [
      { paramName: 'FromDate', displayName: 'From Date', paramType: 'date', isRequired: true },
      ...['Item', 'Buyer', 'Buyer2', 'Seller'].map((name) => ({
        paramName: `Select${name}`, apiName: `Select${name} `, displayName: name,
        paramType: 'string', isRequired: false, defaultValue: 'OLD-CODE',
      })),
    ]],
    [reportService, 'exportReportPdf', async (payload) => { exported = payload; return { base64Pdf: 'JVBERi0=' }; }],
  ], async () => {
    await service.runCompanyReport(auth, 'RCRI0108', {
      FromDate: '2026-09-26', SelectItem: '', SelectBuyer: '', SelectBuyer2: '', SelectSeller: '',
    });
    assert.deepEqual(exported.parameters.slice(1).map((parameter) => parameter.value), ['', '', '', '']);
    assert.equal(exported.parameters[1].name, 'SelectItem ');
  });
});

test('catalog includes only active general reports for the selected company', async () => {
  await withMocks([
    [authDbService, 'queryOne', async () => ({ CanView: 1 })],
    [reportService, 'loadAuthorizedCrList', async () => [
      { code: 'RCRI0099', name: 'Brokerage' },
      { code: 'RCRI0099', name: 'Brokerage duplicate' },
      { code: 'RCRI0050', name: 'Inactive' },
      { code: 'RDR20010', name: 'Document print' },
    ]],
    [dbService, 'query', async () => ({ recordset: [
      { DocCode: 'RCRI0099', Status: 'A' },
      { DocCode: 'RCRI0050', Status: 'I' },
    ] })],
  ], async () => {
    const catalog = await service.listCompanyReports(auth);
    assert.deepEqual(catalog.items, [{ code: 'RCRI0099', name: 'Brokerage' }]);
    assert.equal(catalog.statusVerified, true);
    await assert.rejects(service.getCompanyReport(auth, 'RCRI0050'), { statusCode: 404 });
  });
});

test('Report Service catalog remains available when direct SQL is unavailable', async () => {
  await withMocks([
    [authDbService, 'queryOne', async () => ({ CanView: 1 })],
    [reportService, 'loadAuthorizedCrList', async () => [{ code: 'RCRI0099', name: 'Brokerage' }]],
    [dbService, 'query', async () => { throw new Error('SQL login failed'); }],
  ], async () => {
    const catalog = await service.listCompanyReports(auth);
    assert.equal(catalog.items.length, 1);
    assert.equal(catalog.statusVerified, false);
  });
});

test('run validates criteria and exports only a cataloged company report', async () => {
  let exported;
  await withMocks([
    [authDbService, 'queryOne', async () => ({ CanView: 1 })],
    [reportService, 'loadAuthorizedCrList', async () => [{ code: 'RCRI0099', name: 'Brokerage' }]],
    [dbService, 'query', async () => ({ recordset: [{ DocCode: 'RCRI0099', Status: 'A' }] })],
    [reportService, 'loadReportParameters', async () => [
      { paramName: 'FromDate', displayName: 'From Date', paramType: 'date', isRequired: true },
      { paramName: 'ToDate', displayName: 'To Date', paramType: 'date', isRequired: true },
      { paramName: 'ITEMCODE@SELECT * FROM OITM', apiName: 'ITEMCODE@SELECT * FROM OITM ', displayName: 'Select Item', paramType: 'string', isRequired: true },
      { paramName: 'SCode@Select * from OCRD', displayName: 'Select Seller', paramType: 'string', isRequired: true },
    ]],
    [reportService, 'exportReportPdf', async (payload) => { exported = payload; return { base64Pdf: 'JVBERi0=' }; }],
  ], async () => {
    await assert.rejects(
      service.runCompanyReport(auth, 'RCRI0099', { FromDate: 'bad', ToDate: '2026-09-24' }),
      { statusCode: 400 },
    );
    await assert.rejects(service.runCompanyReport(auth, 'RCRI0001', {}), { statusCode: 404 });
    await assert.rejects(
      service.runCompanyReport(auth, 'RCRI0099', {
        FromDate: '2026-08-31', ToDate: '2026-09-24', 'ITEMCODE@SELECT * FROM OITM': 'M0003',
      }),
      { statusCode: 400, message: 'Select Seller is required.' },
    );
    const result = await service.runCompanyReport(auth, 'RCRI0099', {
      FromDate: '2026-08-31', ToDate: '2026-09-24', 'ITEMCODE@SELECT * FROM OITM': 'M0003 - Item',
      'SCode@Select * from OCRD': 'VEN001',
    });
    assert.equal(result.reportCode, 'RCRI0099');
    assert.equal(exported.docCode, 'RCRI0099');
    assert.equal(exported.parameters[2].value, 'M0003');
    assert.equal(exported.parameters[2].name, 'ITEMCODE@SELECT * FROM OITM ');
    assert.equal(exported.allowUnavailableLayoutMetadata, true);
  });
});
