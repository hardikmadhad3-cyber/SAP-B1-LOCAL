// User-defined fields: SAP CUFD/UFD1 + physical U_ columns, plus local formula
// and validation rules enforced on every save.
const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../config/env');
const pg = require('../db/pgDb');
const { withLocalCompany, slFailure } = require('./helpers/localCompany');

test.after(() => pg.closeAll());

test('UDFs are created like SAP B1 and their formulas and rules apply on save', { skip: !env.databaseUrl }, async () => {
  await withLocalCompany('udf', async ({ sql, asUser }) => asUser(async () => {
    const sap = require('../services/sapService');
    const sl = async (method, url, data) => (await sap.request({ method, url, data })).data;
    const columnsOf = async (table) => (await sql(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table],
    )).rows.map((row) => row.column_name);
    const series = async (objType) => (await sql('SELECT "DfltSeries" FROM "ONNM" WHERE "ObjectCode" = $1 AND "DocSubType" = \'--\'', [objType])).rows[0].DfltSeries;
    const order = async (data) => sl('POST', '/Orders', { CardCode: 'C1', DocDate: '2026-10-12', Series: await series('17'), ...data });

    await sql(`INSERT INTO "OCRD" ("CardCode", "CardName", "CardType", "GroupCode") VALUES ('C1', 'Cust', 'C', 1)`);
    await sql(`INSERT INTO "OITM" ("ItemCode", "ItemName", "ItmsGrpCod") VALUES ('I1', 'Board', 1)`);
    // A document before any UDF exists, so the engine has cached the old columns.
    await order({ DocumentLines: [{ ItemCode: 'I1', Quantity: 1, UnitPrice: 10 }] });

    // Row fields: length x width -> area (formula), width must be positive (rule).
    await sl('POST', '/UserFieldsMD', { TableName: 'RDR1', Name: 'Length', Description: 'Length (m)', Type: 'db_Float', SubType: 'st_Measurement' });
    await sl('POST', '/UserFieldsMD', { TableName: 'RDR1', Name: 'Width', Description: 'Width (m)', Type: 'db_Float', SubType: 'st_Measurement',
      Validation: 'U_Width > 0', ValidationMessage: 'Width must be greater than zero.' });
    const area = await sl('POST', '/UserFieldsMD', { TableName: 'RDR1', Name: 'Area', Description: 'Area (m2)', Type: 'db_Float', SubType: 'st_Quantity',
      Formula: 'ROUND(U_Length * U_Width, 2)' });
    assert.equal(area.Formula, 'ROUND(U_Length * U_Width, 2)');
    // Header fields: total area (SUM over rows), approval (mandatory, valid values) with a rule on the total.
    await sl('POST', '/UserFieldsMD', { TableName: 'ORDR', Name: 'TotalArea', Description: 'Total area', Type: 'db_Float', SubType: 'st_Quantity',
      Formula: 'SUM(U_Area)' });
    await sl('POST', '/UserFieldsMD', { TableName: 'ORDR', Name: 'Approved', Description: 'Approved', Type: 'db_Alpha', EditSize: 1,
      Mandatory: 'tYES', DefaultValue: 'N', ValidValuesMD: [{ Value: 'Y', Description: 'Yes' }, { Value: 'N', Description: 'No' }],
      Validation: "U_Approved = 'Y' OR DocTotal < 1000", ValidationMessage: 'Orders of 1000 or more need approval.' });

    // SAP "Marketing Documents": the field is on every header/row table, with a CUFD row each.
    for (const table of ['OQUT', 'ORDR', 'ODLN', 'OINV', 'ORIN', 'OPOR', 'OPDN', 'OPCH', 'ORPC', 'OPRQ', 'OPQT']) {
      assert.ok((await columnsOf(table)).includes('U_Approved'), `${table} has U_Approved`);
    }
    assert.ok((await columnsOf('PCH1')).includes('U_Area'));
    assert.equal((await sql(`SELECT count(*)::int AS n FROM "CUFD" WHERE "AliasID" = 'Area'`)).rows[0].n, 11);
    assert.deepEqual((await sql(`SELECT "FldValue" FROM "UFD1" WHERE "TableID" = 'OINV' ORDER BY "IndexID"`)).rows.map((r) => r.FldValue), ['Y', 'N']);

    // Formulas fill on save; the mandatory field takes its default.
    const saved = await order({ DocumentLines: [
      { ItemCode: 'I1', Quantity: 1, UnitPrice: 100, U_Length: 2.5, U_Width: 1.5 },
      { ItemCode: 'I1', Quantity: 1, UnitPrice: 100, U_Length: '2', U_Width: '3', U_Area: 999 },
    ] });
    assert.deepEqual(saved.DocumentLines.map((line) => line.U_Area), [3.75, 6], 'formula wins over a typed value');
    assert.equal(saved.U_TotalArea, 9.75);
    assert.equal(saved.U_Approved, 'N');

    // Rules and SAP checks refuse the save with the user's message.
    assert.deepEqual(await slFailure(order({ DocumentLines: [{ ItemCode: 'I1', Quantity: 1, UnitPrice: 10, U_Length: 1, U_Width: 0 }] })),
      [400, 'Row 1: Width must be greater than zero.']);
    assert.deepEqual(await slFailure(order({ DocumentLines: [{ ItemCode: 'I1', Quantity: 1, UnitPrice: 1000, U_Width: 1 }] })),
      [400, 'Orders of 1000 or more need approval.']);
    assert.equal((await order({ U_Approved: 'Y', DocumentLines: [{ ItemCode: 'I1', Quantity: 1, UnitPrice: 1000, U_Width: 1 }] })).U_Approved, 'Y');
    assert.deepEqual(await slFailure(order({ U_Approved: 'X', DocumentLines: [{ ItemCode: 'I1', U_Width: 1 }] })),
      [400, '"Approved" must be one of: Y, N.']);
    assert.deepEqual(await slFailure(order({ U_Approved: '', DocumentLines: [{ ItemCode: 'I1', U_Width: 1 }] })), [400, 'enter "Approved".']);
    assert.deepEqual(await slFailure(order({ DocumentLines: [{ ItemCode: 'I1', U_Width: 'abc' }] })), [400, 'Row 1: "Width (m)" must be a number.']);

    // Updates recalculate.
    await sl('PATCH', `/Orders(${saved.DocEntry})`, { DocumentLines: [{ LineNum: 1, U_Width: 4 }] });
    const updated = await sl('GET', `/Orders(${saved.DocEntry})`);
    assert.deepEqual([updated.DocumentLines[1].U_Area, updated.U_TotalArea], [8, 11.75]);

    // The pages' UDF reader sees type, options, mandatory and the formula (read-only).
    const { getUdfDefinitions } = require('../services/udfMetadataService');
    const rowFields = await getUdfDefinitions('RDR1');
    const areaField = rowFields.find((field) => field.key === 'U_Area');
    assert.deepEqual([areaField.type, areaField.readOnly, areaField.formula], ['number', true, 'ROUND(U_Length * U_Width, 2)']);
    const approved = (await getUdfDefinitions('OINV')).find((field) => field.key === 'U_Approved');
    assert.deepEqual([approved.type, approved.required, approved.options.map((o) => o.value)], ['select', true, ['Y', 'N']]);

    // Master data: a BP field with a rule, saved through the BP engine.
    await sl('POST', '/UserFieldsMD', { TableName: 'OCRD', Name: 'CreditDays', Description: 'Credit days', Type: 'db_Numeric',
      DefaultValue: 30, Validation: 'U_CreditDays <= 90', ValidationMessage: 'Credit days cannot exceed 90.' });
    await sl('POST', '/BusinessPartners', { CardCode: 'C2', CardName: 'Second', CardType: 'cCustomer', U_CreditDays: 45 });
    assert.equal((await sql(`SELECT "U_CreditDays" FROM "OCRD" WHERE "CardCode" = 'C2'`)).rows[0].U_CreditDays, 45);
    assert.equal((await sql(`SELECT "U_CreditDays" FROM "OCRD" WHERE "CardCode" = 'C1'`)).rows[0].U_CreditDays, 30, 'existing records get the default');
    assert.deepEqual(await slFailure(sl('POST', '/BusinessPartners', { CardCode: 'C3', CardName: 'Third', CardType: 'cCustomer', U_CreditDays: 120 })),
      [400, 'Credit days cannot exceed 90.']);

    // SAP restrictions on definitions.
    const fail = async (data) => (await slFailure(sl('POST', '/UserFieldsMD', { TableName: 'ORDR', Description: 'X', Type: 'db_Alpha', ...data })))[1];
    assert.equal(await fail({ Name: 'Approved' }), 'Field U_Approved already exists in OQUT.');
    assert.equal(await fail({ Name: 'Must', Mandatory: 'tYES' }), 'A mandatory field needs a default value (SAP fills existing records with it).');
    assert.equal(await fail({ Name: 'Calc', Formula: 'U_Nope * 2' }), 'The formula uses "U_Nope", which is not a field of ORDR.');
    assert.equal(await fail({ Name: 'Calc', Formula: 'U_Calc + 1' }), 'A formula cannot use its own field.');
    assert.match(await fail({ Name: 'Calc', Validation: 'DocTotal >' }), /^Validation rule: /);
    assert.equal(await fail({ Name: 'Bad Name' }), 'Enter a field name of 1-50 letters, digits or _, starting with a letter (without "U_").');
    assert.equal((await slFailure(sl('POST', '/UserFieldsMD', { TableName: 'CUFD', Name: 'X', Description: 'X', Type: 'db_Alpha' })))[1],
      'User-defined fields cannot be added to table "CUFD".');
    const approvedId = (await sql(`SELECT "FieldID" FROM "CUFD" WHERE "TableID" = 'ORDR' AND "AliasID" = 'Approved'`)).rows[0].FieldID;
    const url = `/UserFieldsMD(TableName='ORDR',FieldID=${approvedId})`;
    assert.match((await slFailure(sl('PATCH', url, { Type: 'db_Numeric' })))[1], /type of an existing field cannot be changed/);
    assert.equal((await slFailure(sl('PATCH', url, { EditSize: 0 })))[1], 'Length must be 1-254.');

    // Edits: description, a new valid value, longer length — on every marketing table.
    await sl('PATCH', url, { Description: 'Approval', EditSize: 2, ValidValuesMD: [{ Value: 'Y' }, { Value: 'N' }, { Value: 'P', Description: 'Pending' }] });
    const edited = await sl('GET', `/UserFieldsMD(TableName='OPOR',FieldID=${approvedId})`);
    assert.deepEqual([edited.Description, edited.EditSize, edited.ValidValuesMD.length], ['Approval', 2, 3]);

    // Delete removes the column and its metadata everywhere.
    const areaUrl = `/UserFieldsMD(TableName='RDR1',FieldID=${area.FieldID})`;
    await sap.request({ method: 'DELETE', url: areaUrl });
    assert.ok(!(await columnsOf('INV1')).includes('U_Area'));
    assert.equal((await sql(`SELECT count(*)::int AS n FROM "CUFD" WHERE "AliasID" = 'Area'`)).rows[0].n, 0);
  }));
});
