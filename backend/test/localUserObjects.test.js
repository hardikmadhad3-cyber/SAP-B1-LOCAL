// User-defined tables, fields and objects on the local engine: the Job Work and
// Gate Pass pages provision their UDTs/UDFs/UDOs through UserTablesMD /
// UserFieldsMD / UserObjectsMD, then save records through the UDO resources
// (/STTL_JWSM, /STGTPV ...) and /U_<Table>, and read them back with SQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const local = require('../services/localServiceLayer');
const jobWorkProvisioning = require('../services/jobWorkProvisioningService');
const jobWork = require('../services/jobWorkService');
const gatePassProvisioning = require('../services/gatePassProvisioningService');
const gatePass = require('../services/gatePassService');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

// The pages read "@<Table>" rows through dbService; pgDb must not bind the "@..."
// inside a quoted identifier as a parameter.
const readersWork = !pg.bindParams('SELECT 1 FROM "@T"', {}).sql.includes('$');

const day = '2026-10-17';
const setup = async ({ schema, sql, asUser }) => {
  await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C001', 'Acme Ltd', 'C', 1), ('V001', 'Job Worker', 'S', 2)`);
  await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod", "InvntItem") VALUES ('I001', 'Yarn', 1, 'Y')`);
  await sql(`INSERT INTO "OWHS" ("WhsCode", "WhsName", "BPLid", "Location", "BalInvntAc", "SaleCostAc", "RevenuesAc", "ExpensesAc", "TransferAc")
    VALUES ('02', 'At job worker', 1, 1, '120000', '500000', '400000', '510000', '220000')`);
  const goodsReceiptSeries = String((await sql(`SELECT "Series" FROM "NNM1" WHERE "ObjectCode" = '59'`)).rows[0].Series);
  const provision = () => asUser(async () => {
    jobWorkProvisioning.clearVerifiedCache();
    gatePassProvisioning.clearVerifiedCache();
    return [await jobWorkProvisioning.ensureSchema({ force: true }), await gatePassProvisioning.ensureSchema({ force: true })];
  });
  return {
    provision,
    goodsReceiptSeries,
    sl: async (method, url, data) => (await local.request({ method, url, data }, schema)).data,
    one: async (text, values) => (await sql(text, values)).rows[0],
  };
};

test('Job Work and Gate Pass provision their user-defined objects and post records through the UDOs', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('udo', async (company) => {
    const { schema, asUser } = company;
    const { provision, sl, one, goodsReceiptSeries } = await setup(company);

    // Metadata: missing objects answer 404, which the provisioning reads as "create it".
    assert.equal((await slFailure(sl('GET', "/UserTablesMD('STTL_JWSM')")))[0], 404);
    assert.equal((await slFailure(sl('GET', "/UserObjectsMD('STTL_JWSM')")))[0], 404);

    const [jobWorkRun, gatePassRun] = await provision();
    assert.equal(jobWorkRun.udosCreated, 6);
    assert.equal(gatePassRun.udosCreated, 3);
    assert.ok(jobWorkRun.tablesCreated > 20 && jobWorkRun.fieldsCreated > 200);
    assert.deepEqual(await sl('GET', "/UserTablesMD('STTL_JWSM')"), { TableName: 'STTL_JWSM', TableDescription: 'Jobwork Sales Master', TableType: 'bott_Document' });
    const udo = await sl('GET', "/UserObjectsMD('STTL_JWSM')");
    assert.equal(udo.ObjectType, 'boud_Document');
    assert.deepEqual(udo.UserObjectMD_ChildTables.map((child) => [child.TableName, child.ObjectName]), [['STTL_JWS1', '1'], ['STTL_JWS12', '2']]);
    assert.equal((await one(`SELECT COUNT(*)::int AS n FROM "CUFD" WHERE "TableID" = '@STTL_JWSM' AND "AliasID" = 'JWSts'`)).n, 1);
    // Standard-table UDFs used to link the stock documents back.
    assert.equal((await one(`SELECT COUNT(*)::int AS n FROM "CUFD" WHERE "TableID" = 'OIGN' AND "AliasID" = 'CustReceiptDocEntry'`)).n, 1);

    // Re-running is idempotent; creating an existing table answers SAP's "already exists" code.
    const [jobWorkAgain, gatePassAgain] = await provision();
    assert.deepEqual([jobWorkAgain.tablesCreated, jobWorkAgain.fieldsCreated, jobWorkAgain.udosCreated], [0, 0, 0]);
    assert.deepEqual([gatePassAgain.tablesCreated, gatePassAgain.fieldsCreated, gatePassAgain.udosCreated], [0, 0, 0]);
    const duplicate = await local.request({ method: 'POST', url: '/UserTablesMD', data: { TableName: 'STTL_JWSM', TableType: 'bott_Document' } }, schema).catch((e) => e);
    assert.equal(duplicate.response.data.error.code, -2035);

    // /U_<Table> rows of a table without an object.
    assert.equal((await sl('POST', '/U_STVSTR', { Code: '001', Name: 'Vendor' })).Code, '001');
    await sl('PATCH', "/U_STVSTR('001')", { Name: 'Supplier' });
    assert.equal((await sl('GET', "/U_STVSTR('001')")).Name, 'Supplier');
    await sl('DELETE', "/U_STVSTR('001')");
    assert.equal((await slFailure(sl('GET', "/U_STVSTR('001')")))[0], 404);

    // Gate In: header + two child collections; PATCH updates rows with a LineId and adds the rest.
    const gateIn = await asUser(() => gatePass.submitDocument('gateIn', {
      header: { DOCDATE: day, VCODE: 'V001', VNAME: 'Job Worker', VEHNO: 'GJ01AB1234', GPSTUS: 'Open', CHECK: 'No' },
      lines: { STGTPV1: [{ ICODE: 'I001', INAME: 'Yarn', QTY: 5 }], STGTPV2: [{ ADDITM: 'Empty cones', ADDQTY: 2 }] },
    }));
    assert.deepEqual([gateIn.doc_num, gateIn.series], [1, null]);
    await sl('PATCH', `/STGTPV(${gateIn.doc_entry})`, { U_GPSTUS: 'Closed', '1Collection': [{ LineId: 1, U_QTY: 6 }, { U_ICODE: 'I002', U_QTY: 1 }] });
    const savedGateIn = await sl('GET', `/STGTPV(${gateIn.doc_entry})`);
    assert.deepEqual([savedGateIn.U_GPSTUS, savedGateIn.U_VEHNO, savedGateIn.DocNum, savedGateIn.Status, savedGateIn.Object], ['Closed', 'GJ01AB1234', 1, 'O', 'STGTPV']);
    assert.deepEqual(savedGateIn['1Collection'].map((line) => [line.LineId, line.U_ICODE, line.U_QTY]), [[1, 'I001', 6], [2, 'I002', 1]]);
    assert.equal(savedGateIn['2Collection'].length, 1);
    // Valid values are enforced like SAP; unknown rows are refused.
    assert.match((await slFailure(sl('POST', '/STGTPV', { U_GPSTUS: 'Lost' })))[1], /must be one of: Open, Closed, Short Closed/);
    assert.match((await slFailure(sl('PATCH', `/STGTPV(${gateIn.doc_entry})`, { '1Collection': [{ LineId: 9 }] })))[1], /LineId 9 does not exist/);
    assert.equal((await sl('POST', '/STGTPV', {})).DocNum, 2);

    // Job Work Customer Receipt Note: posts a goods receipt first, then saves the UDO and links both ways.
    const receipt = await asUser(() => jobWork.submitDocument('customerReceiptNote', {
      header: { CCode: 'C001', CName: 'Acme Ltd', PDate: day, DocDate: day, JWSts: 'O', JWBranch: '1', GoodsReceiptSeries: goodsReceiptSeries },
      lines: { STTL_JWS12: [{ ICode: 'I001', IName: 'Yarn', Qty: 3, WhsCode: '01', Price: 10 }] },
    }));
    const grEntry = receipt.stock_movements.goodsReceipt.docEntry;
    assert.equal((await one('SELECT "U_CustReceiptDocEntry" FROM "OIGN" WHERE "DocEntry" = $1', [grEntry])).U_CustReceiptDocEntry, receipt.doc_entry);
    const savedReceipt = await sl('GET', `/STTL_JWSM(${receipt.doc_entry})`);
    assert.deepEqual([savedReceipt.U_WebGoodsRcptDocEntry, savedReceipt.U_CCode, savedReceipt['2Collection'][0].U_ICode], [grEntry, 'C001', 'I001']);

    // Jobwork Issue Note with a To Warehouse moves the material by inventory transfer.
    const issue = await asUser(() => jobWork.submitDocument('jobworkIssueNote', {
      header: { VENCOD: 'V001', VENNAME: 'Job Worker', PDATE: day, DOCDATE: day, BRNCH: '1' },
      lines: { STTL_JWP6: [{ MITMNO: 'I001', MDES: 'Yarn', MQTY: 1, MWHS: '01', TWHS: '02' }] },
    }));
    const transferEntry = issue.stock_movements.inventoryTransfer.docEntry;
    assert.equal((await one('SELECT "U_JobWorkDocEntry" FROM "OWTR" WHERE "DocEntry" = $1', [transferEntry])).U_JobWorkDocEntry, issue.doc_entry);
    assert.equal((await one(`SELECT "OnHand" FROM "OITW" WHERE "ItemCode" = 'I001' AND "WhsCode" = '02'`)).OnHand, 1);
    assert.equal((await sl('GET', `/STTL_JWPM(${issue.doc_entry})`))['6Collection'][0].U_MITMNO, 'I001');
  });
});

test('Job Work and Gate Pass pages list, open and update their records', {
  skip: !env.databaseUrl || (!readersWork && 'pgDb binds "@Table" identifiers as parameters'),
}, async () => {
  await withLocalCompany('udopg', async (company) => {
    const { asUser } = company;
    const { provision, one, goodsReceiptSeries } = await setup(company);
    await provision();
    await asUser(async () => {
      // Gate Pass masters through /U_STVSTR, numbered 001, 002...
      const first = await gatePass.createMasterRow('visitorType', { name: 'Vendor' });
      const second = await gatePass.createMasterRow('visitorType', { name: 'Contractor' });
      assert.deepEqual([first.code, second.code], ['001', '002']);
      await gatePass.updateMasterRow('visitorType', '002', { name: 'Sub-contractor' });
      assert.deepEqual((await gatePass.getMasterList('visitorType')).map((row) => [row.code, row.name]), [['002', 'Sub-contractor'], ['001', 'Vendor']]);
      await gatePass.deleteMasterRow('visitorType', '001');
      assert.deepEqual((await gatePass.getMasterList('visitorType')).map((row) => row.code), ['002']);

      // Gate In update: row 1 changes, a row is added, the removed STGTPV1 row is dropped.
      const created = await gatePass.submitDocument('gateIn', {
        header: { DOCDATE: day, VCODE: 'V001', VNAME: 'Job Worker', VEHNO: 'GJ01AB1234', GPSTUS: 'Open' },
        lines: { STGTPV1: [{ ICODE: 'I001', QTY: 5 }, { ICODE: 'I009', QTY: 9 }], STGTPV2: [{ ADDITM: 'Empty cones', ADDQTY: 2 }] },
      });
      await gatePass.updateDocument('gateIn', created.doc_entry, {
        header: { GPSTUS: 'Closed' },
        lines: { STGTPV1: [{ LineId: 1, ICODE: 'I001', QTY: 6 }, { ICODE: 'I002', QTY: 1 }] },
      });
      const saved = await gatePass.getByDocEntry('gateIn', created.doc_entry);
      assert.deepEqual([saved.header.U_GPSTUS, saved.header.U_VEHNO, saved.header.DocNum], ['Closed', 'GJ01AB1234', 1]);
      assert.deepEqual(saved.lines.STGTPV1.map((line) => [line.LineId, line.U_ICODE, Number(line.U_QTY)]), [[1, 'I001', 6], [2, 'I002', 1]]);
      assert.equal(saved.lines.STGTPV2.length, 1);
      assert.deepEqual((await gatePass.getList('gateIn')).documents.map((doc) => [doc.doc_num, doc.party_code, doc.status]), [[1, 'V001', 'Closed']]);

      // Job Work: once the stock is posted only the informational header fields change.
      const header = { CCode: 'C001', CName: 'Acme Ltd', PDate: day, DocDate: day, JWSts: 'O', JWBranch: '1', GoodsReceiptSeries: goodsReceiptSeries };
      const receipt = await jobWork.submitDocument('customerReceiptNote', {
        header, lines: { STTL_JWS12: [{ ICode: 'I001', IName: 'Yarn', Qty: 3, WhsCode: '01', Price: 10 }] },
      });
      const opened = await jobWork.getByDocEntry('customerReceiptNote', receipt.doc_entry);
      assert.deepEqual([opened.header.U_WebGoodsRcptDocEntry, opened.lines.length], [receipt.stock_movements.goodsReceipt.docEntry, 1]);
      await jobWork.updateDocument('customerReceiptNote', receipt.doc_entry, { header: { ...header, CCode: 'C999', VEHNO: 'GJ05' }, lines: {} });
      const updated = await jobWork.getByDocEntry('customerReceiptNote', receipt.doc_entry);
      assert.deepEqual([updated.header.U_VEHNO, updated.header.U_CCode], ['GJ05', 'C001']);
      assert.deepEqual((await jobWork.getList('customerReceiptNote')).documents.map((doc) => [doc.doc_num, doc.party_code]), [[1, 'C001']]);
      assert.equal((await one('SELECT COUNT(*)::int AS n FROM "OIGN"')).n, 1, 'a posted note is not posted again');
    });
  });
});
