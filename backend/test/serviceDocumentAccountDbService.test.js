const test = require('node:test');
const assert = require('node:assert/strict');

test('service account lookup handles optional SQL company columns and keeps account names', async () => {
  const target = require.resolve('../services/serviceDocumentAccountDbService');
  const dbTarget = require.resolve('../services/dbService');
  const compatibilityTarget = require.resolve('../services/salesDocumentDbCompatibility');
  const saved = [target, dbTarget, compatibilityTarget].map((id) => [id, require.cache[id]]);
  try {
    require.cache[dbTarget] = { id: dbTarget, loaded: true, exports: {
      query: async (sql) => {
        assert.match(sql, /A\.AcctCode, A\.AcctName/);
        assert.match(sql, /NULL AS FormatCode/);
        return { recordset: [
          { AcctCode: '100028', AcctName: 'Service Revenue', FrozenFor: 'N', Postable: 'Y' },
          { AcctCode: '100029', AcctName: 'Heading', FrozenFor: 'N', Postable: 'N' },
        ] };
      },
    } };
    require.cache[compatibilityTarget] = { id: compatibilityTarget, loaded: true, exports: {
      createTableColumnDetailsReader: () => async () => [
        { columnName: 'AcctCode' }, { columnName: 'AcctName' },
        { columnName: 'FrozenFor' }, { columnName: 'Postable' },
      ],
    } };
    delete require.cache[target];
    const { getServiceDocumentAccounts } = require(target);
    assert.deepEqual(await getServiceDocumentAccounts(), [{
      code: '100028', formatCode: '', name: 'Service Revenue', balance: 0, inactive: 'No',
    }]);
  } finally {
    saved.forEach(([id, entry]) => {
      if (entry) require.cache[id] = entry;
      else delete require.cache[id];
    });
  }
});
