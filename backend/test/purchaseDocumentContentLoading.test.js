const test = require('node:test');
const assert = require('node:assert/strict');

const loadService = (serviceName, query, scope = {}) => {
  const mocks = {
    dbService: {
      query,
      resolveDatabaseName: async () => scope.company || 'COMPANY_A',
      getDialect: async () => scope.dialect || 'sqlserver',
      resolveSqlConnectionConfig: async () => ({ server: scope.server || 'test-server' }),
    },
    udfMetadataService: {
      getHeaderUdfValues: async () => ({}),
      getLineUdfValues: async () => ({ 0: { U_PackingType: 'Carton' } }),
      getMarketingDocumentUdfs: async () => ({ header: [], rows: [] }),
    },
    masterDataDbService: {},
    businessPartnerAddressDbUtils: {},
    documentListUtils: {},
    documentSeriesDbUtils: {},
    documentUnitPriceDbUtils: { getDocumentUnitPriceSql: async () => 'T0.Price' },
    placeOfSupplyUtils: { getPlaceOfSupplyUdfValue: () => '' },
  };
  const saved = [];
  const target = require.resolve('../services/' + serviceName);
  try {
    for (const [name, exports] of Object.entries(mocks)) {
      const id = require.resolve('../services/' + name);
      saved.push([id, require.cache[id]]);
      require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    delete require.cache[target];
    return require(target);
  } finally {
    delete require.cache[target];
    for (const [id, previous] of saved) {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    }
  }
};

for (const [moduleName, method, headerTable, lineTable, resultKey] of [
  ['apInvoiceDbService', 'getAPInvoice', 'OPCH', 'PCH1', 'apInvoice'],
  ['apCreditMemoDbService', 'getAPCreditMemo', 'ORPC', 'RPC1', 'apCreditMemo'],
]) {
  test(moduleName + ' loads persisted Bill To and Pay To addresses in Find mode', async () => {
    const service = loadService(moduleName, async (sql, params = {}) => {
      if (params.tableName) {
        const columns = params.tableName === headerTable
          ? ['BPLId', 'ShipToCode', 'PayToCode', 'Address', 'Address2']
          : [];
        return { recordset: columns.map((columnName) => ({ columnName })) };
      }
      if (sql.includes('FROM ' + headerTable + ' T0')) {
        return { recordset: [{
          DocEntry: 17,
          DocNum: 17,
          ShipToCode: 'BUYER',
          BillToAddress: 'Buyer plant address',
          PayToCode: 'VENDOR',
          PayToAddress: 'Vendor remittance address',
        }] };
      }
      if (sql.includes('FROM ' + lineTable + ' T0')) {
        return { recordset: [{ LineNum: 0, ItemCode: 'RM-001', Quantity: 1, UnitPrice: 10 }] };
      }
      return { recordset: [] };
    });
    const result = await service[method](17);
    expectAddressHeader(result[resultKey].header);
  });
}

for (const moduleName of ['apInvoiceDbService', 'apCreditMemoDbService']) {
  test(moduleName + ' exposes the complete company address for Bill To defaults', async () => {
    const service = loadService(moduleName, async (sql) => {
      if (sql.includes('FROM OADM')) {
        return { recordset: [{
          CompnyName: 'Buyer Company',
          Address: 'Registered office, Gujarat',
          State: 'GJ',
          MainCurncy: 'INR',
        }] };
      }
      return { recordset: [] };
    });
    const referenceData = await service.getReferenceData();
    assert.deepEqual(referenceData.company_address, {
      Address: 'Registered office, Gujarat',
      State: 'GJ',
    });
  });
}

const expectAddressHeader = (header) => {
  assert.equal(header.billToCode, 'BUYER');
  assert.equal(header.billTo, 'Buyer plant address');
  assert.equal(header.billToAddress, 'Buyer plant address');
  assert.equal(header.payToCode, 'VENDOR');
  assert.equal(header.payTo, 'Vendor remittance address');
  assert.equal(header.payToAddress, 'Vendor remittance address');
};

const optionalFields = [
  'SacEntry', 'OcrCode', 'CountryOrg', 'AgrNo', 'U_Cost_Sheet',
  'U_PackingType', 'U_ContainerType', 'U_GrossWt', 'U_TotalPackage',
];

for (const columns of [optionalFields, []]) {
  test('Purchase Order loads lines with ' + (columns.length ? 'overlapping item-master fields' : 'no optional company fields'), async () => {
    let lineSql;
    const service = loadService('purchaseOrderDbService', async (sql, params) => {
      if (/INFORMATION_SCHEMA.COLUMNS/.test(sql)) {
        return { recordset: params.tableName === 'POR1'
          ? columns.map((COLUMN_NAME) => ({ COLUMN_NAME }))
          : [] };
      }
      if (/FROM POR1 T0/.test(sql)) {
        lineSql = sql;
        // SQL Server rejects unqualified fields shared by POR1 and OITM.
        for (const field of columns) {
          if (new RegExp('(?:^|,)[\\s]*' + field + '[\\s]+AS', 'im').test(sql)) {
            throw new Error('Ambiguous column name ' + field);
          }
        }
        return { recordset: [{ LineNum: 0, ItemCode: 'RM-001', Quantity: 5, UnitPrice: 10, LineTotal: 50 }] };
      }
      return { recordset: [{ DocEntry: 17, DocNum: 17, CardCode: 'V001' }] };
    });
    const result = await service.getPurchaseOrder(17);
    assert.equal(result.purchase_order.lines.length, 1);
    assert.equal(result.purchase_order.lines[0].itemNo, 'RM-001');
    assert.equal(result.purchase_order.lines[0].total, '50');
    assert.equal(result.purchase_order.lines[0].udf.U_PackingType, 'Carton');
    for (const field of optionalFields) {
      if (columns.length) assert.ok(lineSql.includes('T0.[' + field + '] AS'));
      else assert.ok(!lineSql.includes('T0.[' + field + ']'));
    }
  });
}

const loaders = [
  ['purchaseOrderDbService', 'getPurchaseOrder', 'OPOR', 'POR1'],
  ['purchaseQuotationDbService', 'getPurchaseQuotation', 'OPQT', 'PQT1'],
  ['apInvoiceDbService', 'getAPInvoice', 'OPCH', 'PCH1'],
  ['apCreditMemoDbService', 'getAPCreditMemo', 'ORPC', 'RPC1'],
  ['grpoDbService', 'getGRPO', 'OPDN', 'PDN1'],
];

for (const [moduleName, method, headerTable, lineTable] of loaders) {
  for (const failure of ['query error', 'empty result']) {
    test(moduleName + ' reports line-loading ' + failure + ' instead of a loaded blank grid', async () => {
      const expected = new Error('Line query failed');
      const service = loadService(moduleName, async (sql) => {
        if (sql.includes('FROM ' + lineTable + ' T0')) {
          if (failure === 'query error') throw expected;
          return { recordset: [] };
        }
        if (sql.includes('FROM ' + headerTable + ' T0')) {
          return { recordset: [{ DocEntry: 17, DocNum: 17 }] };
        }
        return { recordset: [] };
      });
      assert.equal(typeof service[method], 'function', method);
      await assert.rejects(service[method](17), failure === 'query error'
        ? (error) => error === expected
        : /content lines could not be loaded/i);
    });
  }
}

for (const dialect of ['sqlserver', 'hana']) {
  for (const [moduleName, method, headerTable, lineTable] of loaders) {
    test(moduleName + ' loads contents with physical mixed-case fields on ' + dialect, async () => {
      let checkedLines = false;
      const service = loadService(moduleName, async (sql, params = {}) => {
        if (params.tableName) {
          return { recordset: ['SacEntry', 'U_PACKINGTYPE', 'BPLId'].map((columnName) => ({ columnName })) };
        }
        if (sql.includes('FROM ' + headerTable + ' T0')) {
          assert.ok(sql.includes('T0.[BPLId] AS [Branch]'));
          return { recordset: [{ DocEntry: 17, DocNum: 17, CardCode: 'V001' }] };
        }
        if (sql.includes('FROM ' + lineTable + ' T0')) {
          checkedLines = true;
          const hanaSql = require('../db/hanaDb').normalizeSql(sql);
          assert.doesNotMatch(hanaSql, /T0\."SACEntry"|T0\."U_PackingType"/);
          if (moduleName !== 'apInvoiceDbService' && moduleName !== 'purchaseQuotationDbService') {
            assert.match(hanaSql, /T0\."SacEntry"/);
          }
          return { recordset: [{
            LineNum: 0, ItemCode: 'RM-001', ItemDescription: 'Raw material',
            Quantity: 5, OpenQty: 5, UnitPrice: 10, LineTotal: 50,
            Warehouse: 'W1', UoMCode: 'EA', SACCode: 7,
          }] };
        }
        return { recordset: [] };
      }, { dialect });
      const result = await service[method](17);
      const document = result.purchase_order || result.purchase_quotation || result.apInvoice || result.apCreditMemo || result.grpo;
      assert.equal(checkedLines, true);
      assert.equal(document.lines.length, 1);
      assert.equal(document.lines[0].itemNo, 'RM-001');
    });
  }
}

test('A/P Credit Memo copy-from emits exact HANA SAC casing and joins its salesperson', async () => {
  let checkedLines = false;
  const service = loadService('apCreditMemoDbService', async (sql, params = {}) => {
    if (params.tableName) return { recordset: ['SacEntry', 'BPLId'].map((columnName) => ({ columnName })) };
    if (sql.includes('FROM OPDN T0')) {
      assert.match(sql, /LEFT JOIN OSLP T1 ON T1.SlpCode = T0.SlpCode/);
      return { recordset: [{ DocEntry: 17, DocNum: 17 }] };
    }
    if (sql.includes('FROM PDN1 T0')) {
      checkedLines = true;
      assert.match(require('../db/hanaDb').normalizeSql(sql), /T0\."SacEntry" AS "SACCode"/);
      return { recordset: [] };
    }
    return { recordset: [] };
  }, { dialect: 'hana' });
  await service.getGRPOForCopy(17);
  assert.equal(checkedLines, true);
});

for (const languageExists of [false, true]) {
  test('Purchase Order reads optional language metadata: ' + languageExists, async () => {
    const service = loadService('purchaseOrderDbService', async (sql, params = {}) => {
      if (params.tableName) return { recordset: languageExists ? [{ columnName: 'LangCode' }] : [] };
      if (sql.includes('FROM OPOR T0')) {
        assert.equal(sql.includes('T0.[LangCode] AS [Language]'), languageExists);
        return { recordset: [{ DocEntry: 17, DocNum: 17, Language: languageExists ? 3 : null }] };
      }
      if (sql.includes('FROM POR1 T0')) return { recordset: [{ LineNum: 0, ItemCode: 'ITEM', Quantity: 1 }] };
      return { recordset: [] };
    }, { company: 'LANGUAGE_' + languageExists });
    const result = await service.getPurchaseOrder(17);
    assert.equal(result.purchase_order.doc_entry, 17);
  });
}
test('Purchase Order preserves a header query failure instead of reporting not found', async () => {
  const failure = new Error('Database unavailable');
  const service = loadService('purchaseOrderDbService', async (sql) => {
    if (sql.includes('FROM OPOR T0')) throw failure;
    return { recordset: [] };
  });
  await assert.rejects(service.getPurchaseOrder(17), (error) => error === failure);
});
