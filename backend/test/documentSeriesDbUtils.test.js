'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { AsyncLocalStorage } = require('node:async_hooks');
const { resolveMarketingDocumentSeries, createSeriesReader } = require('../services/documentSeriesDbUtils');
const { chooseDefaultSeries, normalizeDocumentSubType, dateOnly, dedupeSeriesRows } = require('../services/documentSeriesPolicy');

const base = () => ({
  NNM1: [{ Series: 127, SeriesName: 'Misleading1999', ObjectCode: '17', Indicator: 'SUMMER',
    NextNumber: 335, Locked: 'N', InitialNum: 1, LastNum: 999, BPLId: null, DocSubType: '--',
    GroupCode: 1, IsForCncl: 'N', SeriesType: 'D' }],
  OFPR: [{ Indicator: 'SUMMER', F_RefDate: '2025-07-01', T_RefDate: '2026-06-30', Name: 'Custom fiscal period' }],
  ONNM: [{ ObjectCode: '17', DocSubType: '--', DfltSeries: 97 }],
  NNM2: [{ ObjectCode: '17', UserSign: 1, Series: 127, DocSubType: '--' }],
  OADM: [{ MltpBrnchs: 'N', Country: 'US' }],
});
const access = async () => ({ userId: 1, manualAllowed: true, canUseGroup: async group => Number(group) === 1 });
function fixture(dialect, tables = base()) {
  const calls = [];
  const db = { getDialect: async () => dialect, resolveDatabaseName: async () => 'Company', resolveSqlConnectionConfig: async () => ({ server: 'server' }),
    query: async (sql, params = {}) => {
      calls.push({ sql, params });
      if (params.tableName) return { recordset: Object.keys(tables[params.tableName]?.[0] || {}).map(columnName => ({ columnName, dataType: 'nvarchar' })) };
      const table = sql.match(/ FROM ["[](\w+)["\]]/)[1];
      const aliases = [...sql.split(' FROM ')[0].matchAll(/(?:^SELECT |, )(.+?) AS ["[](\w+)["\]]/g)];
      const filters = [...sql.matchAll(/["[](\w+)["\]] = @(p\d+)/g)];
      const rows = (tables[table] || []).filter(row => filters.every(([, field, key]) => String(row[field]) === String(params[key])))
        .map(row => Object.fromEntries(aliases.map(([, expr, name]) => {
          const field = expr.match(/^["[](\w+)["\]]$/)?.[1];
          return [dialect === 'hana' ? name.toUpperCase() : name, field ? row[field] : expr === 'NULL' ? null : expr.replace(/^'|'$/g, '')];
        })));
      return dialect === 'hana' ? rows : { recordset: rows };
    } };
  return { db, calls, tables };
}
const run = (f, args = {}) => resolveMarketingDocumentSeries({ db: f.db, objectCode: '17', targetDate: '2026-02-15', accessLoader: access, ...args });

for (const dialect of ['hana', 'sqlserver']) {
  test(dialect + ': uses configured period, ignores names and invalid default', async () => {
    const f = fixture(dialect), result = await run(f);
    assert.deepEqual(result.series.map(row => row.Series), [127]);
    assert.equal(result.defaultSeries, 127);
    assert.equal(result.series[0].NextNumber, 335);
    assert.equal(result.manualAllowed, true);
    const query = f.calls.find(call => call.sql.includes('FROM ' + (dialect === 'hana' ? '"NNM1"' : '[NNM1]')));
    assert.match(query.sql, /@p0/);
    assert.deepEqual(query.params, { p0: '17' });
  });
  test(dialect + ': creation has no fallback outside configured posting periods', async () => {
    const result = await run(fixture(dialect), { targetDate: '2026-09-08', purpose: 'posting' });
    assert.deepEqual(result.series, []);
    assert.equal(result.manualAllowed, false);
    assert.match(result.reason, /No posting period/);
  });
  test(dialect + ': closing period keeps its series for SAP to authorize at submission', async () => {
    const f = fixture(dialect);
    f.tables.OFPR[0].PeriodStat = 'C';
    const result = await run(f, { purpose: 'posting' });
    assert.equal(result.postingPeriodValid, true);
    assert.deepEqual(result.series.map(row => row.Series), [127]);
    assert.equal(result.series[0].PostingEligible, true);
  });
  test(dialect + ': display after calendar end uses last configured period, never series names', async () => {
    const f = fixture(dialect);
    f.tables.OFPR.push({Indicator:'OLD',F_RefDate:'2024-07-01',T_RefDate:'2025-06-30',Name:'Old period'});
    f.tables.NNM1.push({...f.tables.NNM1[0],Series:97,SeriesName:'Future2099',Indicator:'OLD'});
    f.tables.NNM1.push({...f.tables.NNM1[0],Series:128,SeriesName:'Another allowed series'});
    const result=await run(f,{targetDate:'2026-09-09'});
    assert.deepEqual(result.series.map(row=>row.Series),[127,128]);
    assert.equal(result.series[0].NextNumber,335);
    assert.equal(result.manualAllowed,true);
    assert.equal(result.reason,'');
    assert.equal(result.postingPeriodValid,false);
    assert.equal(result.periodContextSource,'last-configured-period');
    assert.equal(result.series[0].PostingEligible,false);
    assert.equal(result.series[0].IsCurrentPeriod,false);
  });
  test(dialect + ': display does not fill calendar gaps or bypass locks and permissions', async () => {
    const f=fixture(dialect);
    f.tables.OFPR.push({Indicator:'FUTURE',F_RefDate:'2027-01-01',T_RefDate:'2027-12-31',Name:'Future period'});
    assert.deepEqual((await run(f,{targetDate:'2026-09-09'})).series,[]);
    f.tables.OFPR.pop();
    f.tables.NNM1[0].Locked='Y';
    assert.deepEqual((await run(f,{targetDate:'2026-09-09'})).series,[]);
    f.tables.NNM1[0].Locked='N'; f.tables.NNM1[0].GroupCode=2;
    assert.deepEqual((await run(f,{targetDate:'2026-09-09'})).series,[]);
  });
  test(dialect + ': preserves all eligible choices, prioritizes eligible user default', async () => {
    const f = fixture(dialect);
    f.tables.NNM1.push({ ...f.tables.NNM1[0], Series: 128, SeriesName: '2026' });
    f.tables.ONNM[0].DfltSeries = 128;
    assert.deepEqual((await run(f)).series.map(row => row.Series), [127, 128]);
    f.tables.NNM2[0].Series = 999;
    assert.equal((await run(f)).defaultSeries, 128);
    f.tables.ONNM[0].DfltSeries = 999;
    assert.equal((await run(f)).defaultSeries, 127);
  });
  test(dialect + ': filters locked, exhausted, cancellation, other subtype and denied groups', async () => {
    const f = fixture(dialect), row = f.tables.NNM1[0];
    const changes = [{Locked:'Y'}, {NextNumber:1000}, {NextNumber:0}, {IsForCncl:'Y'}, {DocSubType:'GA'}, {GroupCode:2}];
    changes.forEach((change, i) => f.tables.NNM1.push({...row, Series:200+i,...change}));
    assert.deepEqual((await run(f)).series.map(row => row.Series), [127]);
  });
  test(dialect + ': requires selected branch and exact series branch', async () => {
    const f = fixture(dialect);
    f.tables.OADM[0].MltpBrnchs = 'Y'; f.tables.NNM1[0].BPLId = 2;
    f.tables.OBPL = [{BPLId:1,Disabled:'N'}, {BPLId:2,Disabled:'N'}];
    assert.deepEqual((await run(f)).series.map(row => row.Series), [127]);
    assert.equal((await run(f)).reason, '');
    assert.equal((await run(f,{branch:1})).series.length, 0);
    assert.equal((await run(f,{branch:2})).series.length, 1);
    assert.equal((await run(f,{purpose:'posting'})).series.length, 0);
  });
  test(dialect + ': blank document branch displays current series from assigned active branches', async () => {
    const f = fixture(dialect);
    f.tables.OADM[0].MltpBrnchs = 'Y';
    f.tables.OBPL = [{ BPLId: 1, Disabled: 'N' }, { BPLId: 2, Disabled: 'Y' }, { BPLId: 3, Disabled: 'N' }, {BPLId:4,Disabled:'N'}];
    f.tables.USR6 = [{ UserCode: 'manager', BPLId: 1 }, { UserCode: 'manager', BPLId: 3 }];
    f.tables.NNM1 = [
      {...f.tables.NNM1[0],Series:237,SeriesName:'TRA-2627',BPLId:1,NextNumber:1001,LastNum:9999},
      {...f.tables.NNM1[0],Series:238,SeriesName:'BS-2627',BPLId:3,NextNumber:2007,LastNum:9999},
      {...f.tables.NNM1[0],Series:239,SeriesName:'PI-2627',BPLId:3,NextNumber:3001,LastNum:9999},
      {...f.tables.NNM1[0],Series:240,BPLId:2},
      {...f.tables.NNM1[0],Series:241,BPLId:4},
      {...f.tables.NNM1[0],Series:140,BPLId:null,Indicator:'OLD'},
    ];
    const userAccess = async () => ({ ...await access(), userCode: 'manager', superuser: true });
    const result = await run(f, { accessLoader: userAccess });
    assert.deepEqual(result.series.map(row => row.Series), [237,238,239]);
    assert.equal(result.defaultSeries, 237);
    assert.equal(result.series[0].NextNumber, 1001);
    assert.equal(result.manualAllowed, true);
    assert.equal(result.reason, '');
    assert.deepEqual((await run(f, { branch: 1, accessLoader: userAccess })).series.map(row => row.Series), [237]);
    assert.deepEqual((await run(f, { branch: 3, accessLoader: userAccess })).series.map(row => row.Series), [238,239]);
    assert.deepEqual((await run(f, { branch: 4, accessLoader: userAccess })).series, []);
    assert.deepEqual((await run(f, { purpose:'posting', accessLoader: userAccess })).series, []);
  });
  test(dialect + ': unassigned series remain available to every assigned branch when none have a branch', async () => {
    const f = fixture(dialect);
    f.tables.OADM[0].MltpBrnchs = 'Y';
    f.tables.OBPL = [{BPLId:1,Disabled:'N'}, {BPLId:2,Disabled:'N'}];
    assert.deepEqual((await run(f)).series.map(row => row.Series), [127]);
    assert.deepEqual((await run(f,{branch:2})).series.map(row => row.Series), [127]);
  });
  test(dialect + ': optional columns are projected with safe defaults', async () => {
    const f = fixture(dialect);
    for (const name of ['BPLId','DocSubType','LastNum','InitialNum','SeriesType','IsForCncl']) delete f.tables.NNM1[0][name];
    f.tables.ONNM = [{ObjectCode:'17',DfltSerie:127}];
    delete f.tables.NNM2;
    assert.equal((await run(f)).series.length, 1);
    const sql = f.calls.find(c => /FROM ["[]NNM1/.test(c.sql)).sql;
    assert.match(sql, /NULL AS ["[]LastNum/);
    assert.match(sql, /'--' AS ["[]DocSubType/);
  });
  test(dialect + ': missing required metadata is an error, not an empty result', async () => {
    const f=fixture(dialect); delete f.tables.NNM1[0].Indicator;
    await assert.rejects(run(f), /NNM1.Indicator/);
  });
  test(dialect + ': India GST uses actual subtype and never label similarity', async () => {
    const f=fixture(dialect); f.tables.OADM[0].Country='IN';
    f.tables.NNM1[0].ObjectCode='13'; f.tables.NNM1[0].DocSubType='GA';
    f.tables.NNM1.push({...f.tables.NNM1[0],Series:128,DocSubType:'--',SeriesName:'GST tax invoice'});
    assert.deepEqual((await run(f,{objectCode:'13',transactionType:'GST Tax Invoice'})).series.map(r=>r.Series),[127]);
    assert.deepEqual((await run(f,{objectCode:'13',transactionType:'Bill Of Supply'})).series.map(r=>r.Series),[128]);
  });
}
for (const dialect of ['hana', 'sqlserver']) {
  for (const objectCode of ['13', '14', '18', '19']) {
    test(`${dialect}: object ${objectCode} item/service GST defaults use eligible series keys when configured defaults are historical`, async () => {
      const f = fixture(dialect);
      const row = { ...f.tables.NNM1[0], ObjectCode: objectCode, Indicator: 'FY2026-27', DocSubType: 'GA', LastNum: 99999 };
      f.tables.NNM1 = [
        { ...row, Series: 274, SeriesName: 'CAN2627', NextNumber: 30002 },
        { ...row, Series: 273, SeriesName: 'JKLC2627', NextNumber: 10033 },
        { ...row, Series: 272, SeriesName: 'JKLD2627', NextNumber: 1587 },
        { ...row, Series: 271, SeriesName: 'JKLD2627', DocSubType: '--', NextNumber: 1 },
        { ...row, Series: 275, SeriesName: 'JKLDN26', DocSubType: 'GD', NextNumber: 8 },
        { ...row, Series: 191, SeriesName: 'JKLD2425', Indicator: 'FY2024-25' },
        { ...row, Series: 190, SeriesName: 'Cancel', IsForCncl: 'Y' },
      ];
      f.tables.OADM[0].Country = 'IN';
      f.tables.OFPR = [
        { Indicator: 'FY2024-25', F_RefDate: '2024-04-01', T_RefDate: '2025-03-31', Name: 'Old' },
        { Indicator: 'FY2026-27', F_RefDate: '2026-04-01', T_RefDate: '2027-03-31', Name: 'Current' },
      ];
      f.tables.ONNM = [{ ObjectCode: objectCode, DocSubType: 'GA', DfltSeries: 191 }];
      f.tables.NNM2 = [{ ObjectCode: objectCode, UserSign: 1, DocSubType: 'GA', Series: 191 }];
      const resolve = transactionType => run(f, { objectCode, targetDate: '2026-09-17', transactionType });
      const tax = await resolve('GST Tax Invoice');
      assert.equal(tax.defaultSeries, 272);
      assert.equal(tax.series[0].NextNumber, 1587);
      // CAN is actually marked N in the reported company: keep it selectable.
      assert.deepEqual(tax.series.map(r => r.Series), [272, 273, 274]);
      const bill = await resolve('Bill Of Supply');
      assert.equal(bill.defaultSeries, 271);
      assert.equal(bill.series[0].NextNumber, 1);
      const debit = await resolve('GST Debit Memo');
      assert.equal(debit.defaultSeries, 275);
      assert.equal(debit.series[0].NextNumber, 8);
      // An eligible SAP user default must still override fallback order.
      f.tables.NNM2[0].Series = 274;
      assert.equal((await resolve('GST Tax Invoice')).defaultSeries, 274);
      f.tables.NNM2[0].Series = 191;
      f.tables.ONNM[0].DfltSeries = 273;
      assert.equal((await resolve('GST Tax Invoice')).defaultSeries, 273);
    });
  }
}

test('metadata and user-sensitive results are isolated across concurrent request contexts', async () => {
  const context=new AsyncLocalStorage(), a=fixture('hana'), b=fixture('sqlserver');
  b.tables.NNM1[0].SeriesName='Company B'; b.tables.NNM1[0].GroupCode=2;
  delete b.tables.NNM1[0].LastNum;
  const db={
    getDialect:async()=>context.getStore().dialect,
    resolveDatabaseName:async()=>context.getStore().name,
    resolveSqlConnectionConfig:async()=>({server:context.getStore().server}),
    query:async(...args)=>{await new Promise(resolve=>setImmediate(resolve));return context.getStore().fixture.db.query(...args);}
  };
  const request=(name,dialect,fixture,userId,allowed)=>context.run({name,dialect,fixture,server:name},()=>resolveMarketingDocumentSeries({
    db,objectCode:'17',targetDate:'2026-02-15',accessLoader:async()=>({userId,manualAllowed:false,canUseGroup:async group=>Number(group)===allowed})
  }));
  const results=await Promise.all([request('A','hana',a,1,1),request('B','sqlserver',b,2,2),request('A','hana',a,2,2),request('B','sqlserver',b,1,1)]);
  assert.equal(results[0].series[0].SeriesName,'Misleading1999');
  assert.equal(results[1].series[0].SeriesName,'Company B');
  assert.deepEqual(results[2].series,[]); assert.deepEqual(results[3].series,[]);
});
test('database failure propagates and failed metadata can be retried', async()=>{
  const f=fixture('hana'), query=f.db.query; let failed=false;
  f.db.query=async(...args)=>{if(!failed){failed=true;throw new Error('connection lost');} return query(...args);};
  await assert.rejects(createSeriesReader(f.db).then(r=>r.read('NNM1',['Series'])),/connection lost/);
  assert.equal((await run(f)).series.length,1);
});
test('policy chooses SAP series-key order when defaults are invalid and validates dates',()=>{
  assert.equal(chooseDefaultSeries([{Series:2,SeriesName:'A'},{Series:1,SeriesName:'Z'}],[9],[8]),1);
  assert.equal(normalizeDocumentSubType('bod_DebitMemo'),'DN');
  assert.throws(()=>dateOnly('2026-02-30'),/valid posting date/);
  assert.equal(dedupeSeriesRows([{Series:1,SeriesName:'first'},{Series:1,SeriesName:'second'}])[0].SeriesName,'first');
});
