/**
 * Local replacement for the SAP B1 Service Layer. sapService.request() routes
 * PostgreSQL companies here, so callers keep sending SL-shaped requests
 * (`POST /Orders`, `PATCH /Orders(5)`, `GET /Orders(5)`) and get SL-shaped
 * responses and errors back, while the data lands in the SAP-named tables.
 *
 * Covered: marketing documents (create, update, read, Close/Cancel on
 * non-posting documents) with copy-from, committed/ordered quantities, stock
 * (moving average) and journal entries for posting documents; masters and
 * exchange rates; inventory documents; incoming/outgoing payments and manual
 * journal entries. Anything else answers 501 so a gap is loud.
 */
const pgDb = require('../db/pgDb');
const { ensureCompanyMigrated } = require('../db/companyMigrations');
const ITEM_FIELDS = require('./localItemFields');

const DOCUMENTS = {
  Quotations: { header: 'OQUT', lines: 'QUT1', expenses: 'QUT3', objType: '23' },
  Orders: { header: 'ORDR', lines: 'RDR1', expenses: 'RDR3', objType: '17' },
  DeliveryNotes: { header: 'ODLN', lines: 'DLN1', expenses: 'DLN3', objType: '15' },
  Invoices: { header: 'OINV', lines: 'INV1', expenses: 'INV3', objType: '13' },
  CreditNotes: { header: 'ORIN', lines: 'RIN1', expenses: 'RIN3', objType: '14' },
  PurchaseQuotations: { header: 'OPQT', lines: 'PQT1', objType: '540000006' },
  PurchaseOrders: { header: 'OPOR', lines: 'POR1', expenses: 'POR3', objType: '22' },
  PurchaseDeliveryNotes: { header: 'OPDN', lines: 'PDN1', expenses: 'PDN3', objType: '20' },
  PurchaseInvoices: { header: 'OPCH', lines: 'PCH1', expenses: 'PCH3', objType: '18' },
  PurchaseCreditNotes: { header: 'ORPC', lines: 'RPC1', expenses: 'RPC3', objType: '19' },
  PurchaseRequests: { header: 'OPRQ', lines: 'PRQ1', objType: '1470000113', noCard: true },
  // Inventory documents: local currency, no business partner required; transfers
  // send their rows as StockTransferLines (SL StockTransfers shape).
  InventoryGenEntries: { header: 'OIGN', lines: 'IGN1', objType: '59', noCard: true, inventory: true },
  InventoryGenExits: { header: 'OIGE', lines: 'IGE1', objType: '60', noCard: true, inventory: true },
  StockTransfers: { header: 'OWTR', lines: 'WTR1', objType: '67', noCard: true, inventory: true, linesKey: 'StockTransferLines' },
  InventoryTransferRequests: { header: 'OWTQ', lines: 'WTQ1', objType: '1250000001', noCard: true, inventory: true, linesKey: 'StockTransferLines' },
};
// Documents that post nothing yet, so Close/Cancel is only a status change.
const STATUS_ONLY_DOCUMENTS = new Set(['Quotations', 'Orders', 'PurchaseQuotations', 'PurchaseOrders', 'PurchaseRequests', 'InventoryTransferRequests']);

// SL property -> table column. A property missing here is stored only when a
// column of the same name exists (UDFs `U_*`, `Project`, ...); otherwise it is
// kept in LocalSlLog.Unmapped.
const HEADER_FIELDS = {
  DocumentSubType: 'DocSubType', DocumentStatus: 'DocStatus', Cancelled: 'CANCELED',
  DocCurrency: 'DocCur', DocTotalFc: 'DocTotalFC', DocTotalSys: 'DocTotalSy',
  DiscountPercent: 'DiscPrcnt', TotalDiscount: 'DiscSum', RoundingDiffAmount: 'RoundDif',
  PaymentGroupCode: 'GroupNum', SalesPersonCode: 'SlpCode', DocumentsOwner: 'OwnerCode',
  ContactPersonCode: 'CntctCode', BPL_IDAssignedToInvoice: 'BPLId', TransportationCode: 'TrnspCode',
  JournalMemo: 'JrnlMemo', CreationDate: 'CreateDate', Reference1: 'Ref1', Reference2: 'Ref2',
};
// SL StockTransfers / InventoryTransferRequests header names.
const TRANSFER_HEADER_FIELDS = { ...HEADER_FIELDS, DueDate: 'DocDueDate', FromWarehouse: 'Filler', ToWarehouse: 'ToWhsCode' };
const headerFieldsOf = (definition) => (definition.linesKey ? TRANSFER_HEADER_FIELDS : HEADER_FIELDS);
const LINE_FIELDS = {
  ItemDescription: 'Dscription', RemainingOpenQuantity: 'OpenQty', UnitPrice: 'PriceBefDi',
  DiscountPercent: 'DiscPrcnt', RowTotalFC: 'TotalFrgn', RowTotalSC: 'TotalSumSy', TaxTotal: 'VatSum',
  TaxPercentagePerRow: 'VatPrcnt', WarehouseCode: 'WhsCode', MeasureUnit: 'unitMsr', UoMCode: 'UomCode',
  UoMEntry: 'UomEntry', UnitsOfMeasurment: 'NumPerMsr', UseBaseUnits: 'UseBaseUn', TargetEntry: 'TrgetEntry',
  AccountCode: 'AcctCode', CostingCode: 'OcrCode', CostingCode2: 'OcrCode2', CostingCode3: 'OcrCode3',
  CostingCode4: 'OcrCode4', CostingCode5: 'OcrCode5', COGSCostingCode: 'CogsOcrCod', ProjectCode: 'Project',
  AgreementNo: 'AgrNo', GrossProfit: 'GrssProfit', LocationCode: 'LocCode', VisualOrder: 'VisOrder',
  FromWarehouseCode: 'FromWhsCod', TransactionType: 'TranType',
};
const EXPENSE_FIELDS = { ExpenseCode: 'ExpnsCode', TaxSum: 'VatSum', Remarks: 'Comments' };
// Consumed by the engine itself, never stored as columns.
const CONTROL_PROPERTIES = new Set(['DocumentLines', 'StockTransferLines', 'DocumentAdditionalExpenses', 'HandWritten', 'Rounding', 'DocObjectCode']);

// SL enums <-> SAP single-letter column values.
const ENUMS = {
  Confirmed: { tYES: 'Y', tNO: 'N' },
  Cancelled: { tYES: 'Y', tNO: 'N' },
  UseBaseUnits: { tYES: 'Y', tNO: 'N' },
  DocumentStatus: { bost_Open: 'O', bost_Close: 'C' },
  LineStatus: { bost_Open: 'O', bost_Close: 'C' },
  DocType: { dDocument_Items: 'I', dDocument_Service: 'S' },
  TransactionType: { botrntComplete: 'C', botrntReject: 'R' },
};

const reverse = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
const REVERSE = {
  header: reverse(HEADER_FIELDS), transferHeader: reverse(TRANSFER_HEADER_FIELDS), lines: reverse(LINE_FIELDS), expenses: reverse(EXPENSE_FIELDS),
};

const slError = (status, message, cause) => {
  const error = new Error(message);
  error.response = { status, data: { error: { code: -1, message: { lang: 'en-us', value: message } } } };
  if (cause) error.cause = cause;
  return error;
};

// SAP's DI "already exists" code (-2035); add-on provisioning treats it as done.
const alreadyExists = (message) => {
  const error = slError(400, message);
  error.response.data.error.code = -2035;
  return error;
};

const localToday = () => new Date().toLocaleDateString('en-CA');
const hasValue = (value) => value !== undefined && value !== null && value !== '';
const toNumber = (value, fallback = 0) => (hasValue(value) && Number.isFinite(Number(value)) ? Number(value) : fallback);
// ponytail: JS doubles rounded per value to the company's SumDec; switch to a decimal library if totals ever drift.
const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const toSapValue = (property, value, enums = ENUMS) => {
  if (enums[property] && Object.prototype.hasOwnProperty.call(enums[property], value)) return enums[property][value];
  // Keep the local CHAR(1) columns compatible with Service Layer enum labels
  // even when a payload came from an older client without the metadata map.
  if (property === 'CardType') {
    return { cCustomer: 'C', cSupplier: 'S', cLead: 'L', cLid: 'L' }[value] || value;
  }
  if (property === 'CompanyPrivate') {
    return { cCompany: 'C', cPrivate: 'I', cGovernment: 'G' }[value] || value;
  }
  if (property === 'AddressType') {
    return { bo_BillTo: 'B', bo_ShipTo: 'S' }[value] || value;
  }
  // Every SL boolean (BoYesNoEnum) is stored as SAP's Y/N.
  if (value === true || value === 'tYES') return 'Y';
  if (value === false || value === 'tNO') return 'N';
  // Some SAP enum fields use BoYesNoEnum names instead of tYES/tNO.
  if (value === 'boYES') return 'Y';
  if (value === 'boNO') return 'N';
  return value;
};
const toSlValue = (property, value) => {
  if (ENUMS[property]) return reverse(ENUMS[property])[value] ?? value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
};

// ---- schema metadata --------------------------------------------------------

// ponytail: cached per process; clear it when UDF columns get added at runtime (UserFieldsMD).
const columnCache = new Map();
const getColumns = async (client, schema, table) => {
  const key = `${schema}.${table}`;
  if (!columnCache.has(key)) {
    const { rows } = await client.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      [schema, table],
    );
    columnCache.set(key, new Set(rows.map((row) => row.column_name)));
  }
  return columnCache.get(key);
};

// Split an SL object into { row (columns), unmapped (everything else) }.
const toRow = (source = {}, fieldMap, columns, enums = ENUMS) => {
  const row = {};
  const unmapped = {};
  for (const [property, value] of Object.entries(source || {})) {
    if (CONTROL_PROPERTIES.has(property) || value === undefined) continue;
    const column = fieldMap[property] || property;
    if (columns.has(column) && (value === null || typeof value !== 'object')) {
      if (!(column in row) || fieldMap[property]) row[column] = toSapValue(property, value, enums);
    } else if (value !== null) {
      unmapped[property] = value;
    }
  }
  return { row, unmapped };
};

const fromRow = (row, reverseMap) => {
  const result = {};
  for (const [column, value] of Object.entries(row)) {
    const property = reverseMap[column] || column;
    result[property] = toSlValue(property, value);
  }
  return result;
};

// ---- SQL helpers (native PostgreSQL; identifiers are SAP-cased) ---------------

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

const insertRow = async (client, table, columns, row) => {
  const keys = Object.keys(row).filter((key) => columns.has(key) && row[key] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO ${quote(table)} (${keys.map(quote).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    keys.map((key) => row[key]),
  );
  return rows[0];
};

const withTransaction = async (schema, callback) => {
  const client = await pgDb.getPool(schema).connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    // Constraint violations become SL-style 400s the pages already display.
    if (/^23/.test(String(error.code || ''))) throw slError(400, error.detail || error.message, error);
    throw error;
  } finally {
    client.release();
  }
};

// ---- business rules -----------------------------------------------------------

const getCompany = async (client) => (await client.query(
  'SELECT "MainCurncy", "SysCurrncy", "SumDec", "DfltWhs" FROM "OADM" LIMIT 1',
)).rows[0] || { MainCurncy: 'INR', SysCurrncy: 'INR', SumDec: 2, DfltWhs: '01' };

const getPostingPeriod = async (client, docDate, dates = {}) => {
  const period = (await client.query(
    `SELECT "Indicator", "Category", "PeriodStat",
      ($2::date IS NULL OR $2::date BETWEEN "F_DueDate" AND "T_DueDate") AS "DueAllowed",
      ($3::date IS NULL OR $3::date BETWEEN "F_TaxDate" AND "T_TaxDate") AS "TaxAllowed"
      FROM "OFPR" WHERE $1::date BETWEEN "F_RefDate" AND "T_RefDate" ORDER BY "F_RefDate" DESC LIMIT 1 FOR SHARE`,
    [docDate, dates.DocDueDate ?? null, dates.TaxDate ?? null],
  )).rows[0];
  if (!period) throw slError(400, `No posting period is defined for ${docDate}. Create the fiscal period first.`);
  if (period.PeriodStat !== 'N') throw slError(400, `The posting period for ${docDate} is locked or restricted.`);
  if (!period.DueAllowed) throw slError(400, 'The due date is outside the posting period due-date range.');
  if (!period.TaxAllowed) throw slError(400, 'The document date is outside the posting period document-date range.');
  return period;
};

// Picks the series and claims the next number under a row lock, following the
// NNM1 rules: default series per object/subtype, locked flag, number range and
// period indicator.
const assignDocNum = async (client, { table, objType, subType, series, manualDocNum, period }) => {
  // Manual numbering (Series -1, already permission-checked by
  // documentSeriesWriteValidation) has no series row; keep its number unique.
  if (manualDocNum !== null) {
    if (!(manualDocNum > 0)) throw slError(400, 'Enter a positive manual document number.');
    const taken = (await client.query(
      `SELECT 1 FROM ${quote(table)} WHERE "Series" IS NULL AND "DocNum" = $1 LIMIT 1`, [manualDocNum],
    )).rowCount > 0;
    if (taken) throw slError(400, `Manual document number ${manualDocNum} is already used.`);
    return { Series: null, DocNum: manualDocNum };
  }
  let seriesId = toNumber(series, null);
  if (seriesId === null) {
    seriesId = (await client.query(
      'SELECT COALESCE("DfltSeries", "DfltSerie") AS "Series" FROM "ONNM" WHERE "ObjectCode" = $1 AND "DocSubType" = $2',
      [objType, subType],
    )).rows[0]?.Series ?? null;
  }
  if (seriesId === null) throw slError(400, `No numbering series is defined for object ${objType}.`);
  const row = (await client.query(
    'SELECT * FROM "NNM1" WHERE "Series" = $1 AND "ObjectCode" = $2 FOR UPDATE',
    [seriesId, objType],
  )).rows[0];
  if (!row) throw slError(400, `Series ${seriesId} does not belong to object ${objType}.`);
  if (row.Locked === 'Y') throw slError(400, `Series "${row.SeriesName}" is locked.`);
  if (row.Indicator && row.Indicator !== 'Default' && row.Indicator !== period.Indicator) {
    throw slError(400, `Series "${row.SeriesName}" is not valid for posting period ${period.Indicator}.`);
  }
  const docNum = toNumber(row.NextNumber, 1);
  if (hasValue(row.LastNum) && docNum > Number(row.LastNum)) {
    throw slError(400, `Series "${row.SeriesName}" has reached its last number (${row.LastNum}).`);
  }
  await client.query('UPDATE "NNM1" SET "NextNumber" = $1 WHERE "Series" = $2', [docNum + 1, seriesId]);
  return { Series: seriesId, DocNum: docNum };
};

// Purchasing object types; everything else in DOCUMENTS is sales (A/R).
const PURCHASE_OBJECTS = new Set(['540000006', '22', '20', '18', '19', '1470000113']);

// A tax code's rate is the sum of its rows' effective rates (what the document
// readers show). SAP refuses inactive codes and codes not valid for the side.
const getTaxRate = async (client, taxRates, code, side) => {
  if (!hasValue(code)) return 0;
  if (!taxRates.has(code)) {
    const tax = (await client.query(`
      SELECT c."Lock", c."ValidForAR", c."ValidForAP",
             (SELECT COALESCE(SUM(s."EfctivRate"), 0) FROM "STC1" s WHERE s."STCCode" = c."Code") AS "Rate"
      FROM "OSTC" c WHERE c."Code" = $1`, [code])).rows[0];
    if (!tax) throw slError(400, `Tax code "${code}" does not exist.`);
    if (tax.Lock === 'Y') throw slError(400, `Tax code "${code}" is inactive.`);
    if (side === 'AR' && tax.ValidForAR === 'N') throw slError(400, `Tax code "${code}" is not valid for sales documents.`);
    if (side === 'AP' && tax.ValidForAP === 'N') throw slError(400, `Tax code "${code}" is not valid for purchasing documents.`);
    taxRates.set(code, toNumber(tax.Rate));
  }
  return taxRates.get(code);
};

// SAP order of operations: line price after line discount -> line total (local
// currency) -> header discount -> tax on the discounted base -> document total.
const computeTotals = async (client, header, lines, expenses, company) => {
  const taxRates = new Map();
  const side = PURCHASE_OBJECTS.has(String(header.ObjType)) ? 'AP' : 'AR';
  const sumDec = toNumber(company.SumDec, 2);
  const isForeign = header.DocCur && header.DocCur !== company.MainCurncy;
  const rate = isForeign ? toNumber(header.DocRate, 0) : 1;
  if (isForeign && rate <= 0) throw slError(400, `Enter an exchange rate for ${header.DocCur}.`);
  header.DocRate = rate;

  let subtotal = 0;
  for (const line of lines) {
    const quantity = toNumber(line.Quantity, 1);
    const discount = toNumber(line.DiscPrcnt);
    const factor = 1 - discount / 100;
    let priceBefore = line.PriceBefDi;
    if (!hasValue(priceBefore) && hasValue(line.Price)) priceBefore = factor ? toNumber(line.Price) / factor : 0;
    if (!hasValue(priceBefore) && hasValue(line.LineTotal) && quantity) {
      priceBefore = factor ? toNumber(line.LineTotal) / rate / quantity / factor : 0;
    }
    priceBefore = toNumber(priceBefore);
    const price = priceBefore * factor;
    const totalDocCurrency = roundTo(quantity * price, sumDec);
    Object.assign(line, {
      Quantity: quantity,
      PriceBefDi: priceBefore,
      Price: price,
      LineTotal: roundTo(totalDocCurrency * rate, sumDec),
      TotalFrgn: isForeign ? totalDocCurrency : 0,
      TotalSumSy: roundTo(totalDocCurrency * rate, sumDec),
      Currency: header.DocCur,
      Rate: rate,
    });
    subtotal += line.LineTotal;
  }

  if (!hasValue(header.DiscPrcnt) && hasValue(header.DiscSum) && subtotal) {
    header.DiscPrcnt = (toNumber(header.DiscSum) / subtotal) * 100;
  }
  const headerFactor = 1 - toNumber(header.DiscPrcnt) / 100;
  header.DiscSum = roundTo(subtotal * (1 - headerFactor), sumDec);

  let vatSum = 0;
  for (const line of lines) {
    line.VatPrcnt = await getTaxRate(client, taxRates, line.TaxCode, side);
    line.VatSum = roundTo(line.LineTotal * headerFactor * (line.VatPrcnt / 100), sumDec);
    vatSum += line.VatSum;
  }
  let totalExpenses = 0;
  for (const expense of expenses) {
    expense.LineTotal = roundTo(toNumber(expense.LineTotal), sumDec);
    expense.VatSum = roundTo(expense.LineTotal * ((await getTaxRate(client, taxRates, expense.TaxCode, side)) / 100), sumDec);
    totalExpenses += expense.LineTotal;
    vatSum += expense.VatSum;
  }

  header.TotalExpns = roundTo(totalExpenses, sumDec);
  header.VatSum = roundTo(vatSum, sumDec);
  header.DocTotal = roundTo(subtotal - header.DiscSum + header.TotalExpns + header.VatSum + toNumber(header.RoundDif), sumDec);
  header.DocTotalFC = isForeign ? roundTo(header.DocTotal / rate, sumDec) : 0;
  header.VatSumFC = isForeign ? roundTo(header.VatSum / rate, sumDec) : 0;
  header.DocTotalSy = header.DocTotal;
  header.VatSumSy = header.VatSum;
};

// Defaults SAP fills in from master data: BP name/currency, item name/warehouse.
const applyMasterDefaults = async (client, entity, header, lines, company, previousLines = []) => {
  const definition = DOCUMENTS[entity];
  if (hasValue(header.CardCode)) {
    const bp = (await client.query(
      'SELECT "CardName", "Currency", "validFor", "frozenFor" FROM "OCRD" WHERE "CardCode" = $1', [header.CardCode],
    )).rows[0];
    if (!bp) throw slError(400, `Business partner "${header.CardCode}" does not exist.`);
    if (bp.frozenFor === 'Y' || bp.validFor === 'N') throw slError(400, `Business partner "${header.CardCode}" is inactive.`);
    if (!hasValue(header.CardName)) header.CardName = bp.CardName;
    if (!hasValue(header.DocCur)) header.DocCur = bp.Currency && bp.Currency !== '##' ? bp.Currency : company.MainCurncy;
  } else if (!definition.noCard) {
    throw slError(400, 'Select a business partner (CardCode) for this document.');
  }
  // Inventory documents are valued in local currency only.
  if (!hasValue(header.DocCur) || definition.inventory) header.DocCur = company.MainCurncy;
  if (definition.linesKey) {
    lines.forEach((line, index) => {
      if (!hasValue(line.FromWhsCod)) line.FromWhsCod = header.Filler;
      if (!hasValue(line.WhsCode)) line.WhsCode = header.ToWhsCode;
      if (!hasValue(line.FromWhsCod) || !hasValue(line.WhsCode)) throw slError(400, `Row ${index + 1}: select the from and to warehouses.`);
      if (line.FromWhsCod === line.WhsCode) throw slError(400, `Row ${index + 1}: the from and to warehouses must differ.`);
    });
  }

  // Base-linked payloads can omit ItemCode; resolve it before master validation.
  await loadProductionBase(client, { ...header, ObjType: definition.objType }, lines);
  await loadBaseLines(client, { ...header, ObjType: definition.objType }, lines, previousLines);
  const itemCodes = [...new Set(lines.map((line) => line.ItemCode).filter(hasValue))];
  const items = new Map((await client.query(
    'SELECT "ItemCode", "ItemName", "DfltWH", "validFor", "frozenFor" FROM "OITM" WHERE "ItemCode" = ANY($1)', [itemCodes],
  )).rows.map((item) => [item.ItemCode, item]));
  lines.forEach((line, index) => {
    if (line.resource) return;
    if (!hasValue(line.ItemCode)) {
      if (header.DocType !== 'S') throw slError(400, `Row ${index + 1}: select an item.`);
      return;
    }
    const item = items.get(line.ItemCode);
    if (!item) throw slError(400, `Row ${index + 1}: item "${line.ItemCode}" does not exist.`);
    if (item.frozenFor === 'Y' || item.validFor === 'N') throw slError(400, `Row ${index + 1}: item "${line.ItemCode}" is inactive.`);
    if (!hasValue(line.Dscription)) line.Dscription = item.ItemName;
    if (!hasValue(line.WhsCode)) line.WhsCode = item.DfltWH || company.DfltWhs;
  });
};

// ---- posting (Phase 4): copy-from, committed/ordered, stock, journal entries ------

const OBJECT_ENTITY = Object.fromEntries(Object.entries(DOCUMENTS).map(([entity, d]) => [d.objType, entity]));
// SAP copy-from: target object -> objects it can be based on.
const BASE_OBJECTS = {
  17: ['23'], 15: ['23', '17'], 13: ['23', '17', '15'], 14: ['13'],
  540000006: ['1470000113'], 22: ['1470000113', '540000006'], 20: ['22'], 18: ['22', '20'], 19: ['18'],
  67: ['1250000001'],
};
// Copy-from that only references the base (item, price, unit): the base row's
// open quantity is not consumed. The Goods Receipt page copies from these.
const REFERENCE_BASES = { 59: ['22', '18', '60'] };
// Documents that post stock and a journal entry: inventory direction (+1 in,
// -1 out, 0 = transfer between warehouses).
const STOCK_DIRECTION = { 15: -1, 13: -1, 14: 1, 20: 1, 18: 1, 19: -1, 59: 1, 60: -1, 67: 0 };
const INVENTORY_POSTING = new Set(['59', '60', '67']);
// A row copied from this base already moved the stock (invoice from delivery, A/P invoice from GRPO).
const STOCK_MOVED_BY = { 13: '15', 18: '20' };
const JOURNAL_MEMO = {
  13: 'A/R Invoices', 14: 'A/R Credit Memo', 15: 'Deliveries', 18: 'A/P Invoices', 19: 'A/P Credit Memos', 20: 'Goods Receipt PO',
  59: 'Goods Receipt', 60: 'Goods Issue', 67: 'Inventory Transfer',
};
const isPosting = (objType) => STOCK_DIRECTION[objType] !== undefined;
const baseOf = (line) => (hasValue(line.BaseEntry) && hasValue(line.BaseType) && Number(line.BaseType) !== -1
  ? { type: String(line.BaseType), entry: Number(line.BaseEntry), line: Number(line.BaseLine) } : null);
const baseKey = (base) => `${base.type}:${base.entry}:${base.line}`;
// Quantity in the item's inventory unit; StockPrice is kept per inventory unit.
const inventoryQty = (line) => toNumber(line.Quantity) * (line.UseBaseUn === 'Y' ? 1 : (toNumber(line.NumPerMsr, 1) || 1));

// Checks each copied row against its base row (SAP: base not cancelled, a new
// link needs an open row, same business partner, currency and item) and keeps
// the base row on the line for valuation.
const loadBaseLines = async (client, header, lines, previousLines = []) => {
  const known = new Set(previousLines.map((line) => baseOf(line) && `${line.LineNum}|${baseKey(baseOf(line))}`).filter(Boolean));
  for (const [index, line] of lines.entries()) {
    const base = baseOf(line);
    if (!base || base.type === '202') continue;
    const row = `Row ${index + 1}`;
    const consumes = (BASE_OBJECTS[header.ObjType] || []).includes(base.type);
    if (!consumes && !(REFERENCE_BASES[header.ObjType] || []).includes(base.type)) {
      throw slError(400, `${row}: this document cannot be copied from object ${base.type}.`);
    }
    const definition = DOCUMENTS[OBJECT_ENTITY[base.type]];
    const baseHeader = (await client.query(
      `SELECT "CardCode", "DocCur", "CANCELED" FROM ${quote(definition.header)} WHERE "DocEntry" = $1 FOR UPDATE`, [base.entry],
    )).rows[0];
    const baseLine = baseHeader && (await client.query(
      `SELECT * FROM ${quote(definition.lines)} WHERE "DocEntry" = $1 AND "LineNum" = $2 FOR UPDATE`, [base.entry, base.line],
    )).rows[0];
    if (!baseLine) throw slError(400, `${row}: base document row ${base.entry}/${base.line} does not exist.`);
    if (baseHeader.CANCELED === 'Y') throw slError(400, `${row}: the base document is cancelled.`);
    if (consumes && hasValue(baseHeader.CardCode) && hasValue(header.CardCode) && baseHeader.CardCode !== header.CardCode) {
      throw slError(400, `${row}: the base document belongs to another business partner.`);
    }
    if (consumes && hasValue(baseHeader.DocCur) && baseHeader.DocCur !== header.DocCur) throw slError(400, `${row}: the base document is in ${baseHeader.DocCur}.`);
    if (!hasValue(line.ItemCode)) line.ItemCode = baseLine.ItemCode;
    if (!hasValue(line.WhsCode)) line.WhsCode = baseLine.WhsCode;
    if ((line.ItemCode || null) !== (baseLine.ItemCode || null)) throw slError(400, `${row}: the item differs from the base document row.`);
    if (consumes && !known.has(`${line.LineNum}|${baseKey(base)}`) && baseLine.LineStatus !== 'O') throw slError(400, `${row}: the base document row is closed.`);
    if (!consumes) {
      // A reference copy takes the base row's unit and net local price when the page sends none.
      if (!hasValue(line.Price) && !hasValue(line.PriceBefDi)) line.Price = toNumber(baseLine.Price) * (toNumber(baseLine.Rate, 1) || 1);
      for (const column of ['UomCode', 'UomEntry', 'unitMsr', 'NumPerMsr', 'UseBaseUn']) {
        if (!hasValue(line[column])) line[column] = baseLine[column];
      }
    }
    line.baseRow = { ...baseLine, BaseObject: base.type };
  }
};

// Issue / Receipt for Production: rows based on a released production order
// (BaseType 202).
// - Standard / special order: an issue row is a component row (item and warehouse
//   from the order); a receipt row is the product (valued at the issued cost not yet
//   received, per open unit) or a by-product row (planned quantity < 0).
// - Disassembly order: the product is issued and the component rows are received.
// Every row posts against the order warehouse's work-in-process account.
const SAME_ROW = 1e-6;
const productionAccount = async (client, warehouse, column) => {
  const own = (await client.query(`SELECT ${quote(column)} AS "Account" FROM "OWHS" WHERE "WhsCode" = $1`, [warehouse])).rows[0]?.Account;
  const account = own || (await client.query(`SELECT ${quote(column)} AS "Account" FROM "OACP" WHERE ${quote(column)} IS NOT NULL ORDER BY "FinancYear" DESC LIMIT 1`)).rows[0]?.Account;
  if (!hasValue(account)) {
    const label = column === 'WipAcct' ? 'WIP inventory' : 'WIP variance';
    throw slError(400, `Define the ${label} account for warehouse ${warehouse} or in G/L Account Determination.`);
  }
  return account;
};

// Value still in WIP for an order: issued cost minus everything received.
const productionWipBalance = async (client, entry) => toNumber((await client.query(`SELECT
    COALESCE((SELECT SUM(l."LineTotal") FROM "IGE1" l JOIN "OIGE" h ON h."DocEntry" = l."DocEntry"
      WHERE h."CANCELED" = 'N' AND l."BaseType" = 202 AND l."BaseEntry" = $1), 0)
  - COALESCE((SELECT SUM(l."LineTotal") FROM "IGN1" l JOIN "OIGN" h ON h."DocEntry" = l."DocEntry"
      WHERE h."CANCELED" = 'N' AND l."BaseType" = 202 AND l."BaseEntry" = $1), 0) AS "Value"`, [entry])).rows[0].Value);

const loadProductionBase = async (client, header, lines) => {
  const objType = String(header.ObjType);
  for (const [index, line] of lines.entries()) {
    const base = baseOf(line);
    if (base?.type !== '202') continue;
    const row = `Row ${index + 1}`;
    if (!['59', '60'].includes(objType)) throw slError(400, `${row}: only issues and receipts can be based on a production order.`);
    const order = (await client.query('SELECT * FROM "OWOR" WHERE "DocEntry" = $1 FOR UPDATE', [base.entry])).rows[0];
    if (!order) throw slError(400, `${row}: production order ${base.entry} does not exist.`);
    if (order.Status !== 'R') throw slError(400, `${row}: production order ${order.DocNum} is not released.`);
    line.BaseRef = String(order.DocNum);
    const disassembly = order.Type === 'D';
    const component = Number.isInteger(base.line) && base.line >= 0
      ? (await client.query('SELECT * FROM "WOR1" WHERE "DocEntry" = $1 AND "LineNum" = $2', [base.entry, base.line])).rows[0] : null;
    // The product row: a disassembly issue, or a receipt that does not name a component
    // and is not based on a by-product row (SAP sends the product without a base row).
    const isProduct = disassembly
      ? objType === '60' && (!hasValue(line.ItemCode) || line.ItemCode === order.ItemCode)
      : objType === '59' && (hasValue(line.ItemCode) ? line.ItemCode === order.ItemCode : !(component && toNumber(component.PlannedQty) < 0));
    if (isProduct) {
      Object.assign(line, { ItemCode: order.ItemCode, BaseLine: -1 });
      if (!hasValue(line.WhsCode)) line.WhsCode = order.Warehouse;
      if (objType === '59') {
        if (!hasValue(line.TranType)) line.TranType = 'C';
        if (!hasValue(line.Price) && !hasValue(line.PriceBefDi)) {
          // ponytail: product valued at unreceived WIP per open unit; the rest is posted as variance when the order closes.
          const openQty = toNumber(order.PlannedQty) - toNumber(order.CmpltQty) - toNumber(order.RjctQty);
          const unit = openQty > 0 ? Math.max(0, await productionWipBalance(client, base.entry)) / openQty : 0;
          line.Price = unit > 0 ? unit : toNumber((await client.query('SELECT "AvgPrice" FROM "OITM" WHERE "ItemCode" = $1', [order.ItemCode])).rows[0]?.AvgPrice);
        }
      }
    } else if (component && Number(component.ItemType) === 290) {
      // A resource row: issued (hours, units) at its standard cost into WIP; no stock moves.
      if (objType !== '60' || disassembly) throw slError(400, `${row}: a resource is issued to a production order, not received.`);
      if (hasValue(line.ItemCode) && line.ItemCode !== component.ItemCode) throw slError(400, `${row}: the resource differs from the production order row.`);
      const resource = (await client.query('SELECT "ResName", "StdCost", "DfltWH" FROM "ORSC" WHERE "ResCode" = $1', [component.ItemCode])).rows[0];
      if (!resource) throw slError(400, `${row}: resource "${component.ItemCode}" does not exist.`);
      Object.assign(line, { ItemCode: component.ItemCode, ItemType: 290, resource: true, Dscription: line.Dscription || resource.ResName });
      if (!hasValue(line.WhsCode)) line.WhsCode = component.wareHouse || resource.DfltWH || order.Warehouse;
      if (!hasValue(line.Price) && !hasValue(line.PriceBefDi)) line.Price = toNumber(resource.StdCost);
    } else {
      if (!component || Number(component.ItemType) !== 4) throw slError(400, `${row}: production order ${order.DocNum} has no item row ${base.line}.`);
      if (hasValue(line.ItemCode) && line.ItemCode !== component.ItemCode) throw slError(400, `${row}: the item differs from the production order row.`);
      line.ItemType = 4;
      const byProduct = toNumber(component.PlannedQty) < 0;
      if (objType === '60' && (disassembly || byProduct)) {
        throw slError(400, `${row}: ${disassembly ? 'a disassembly order issues its product' : 'a by-product is received with Receipt from Production'}, not this row.`);
      }
      line.ItemCode = component.ItemCode;
      if (!hasValue(line.WhsCode)) line.WhsCode = component.wareHouse;
      if (!hasValue(line.UomCode) && hasValue(component.UomCode)) line.UomCode = component.UomCode;
      if (objType === '59' && !hasValue(line.Price) && !hasValue(line.PriceBefDi)) {
        if (disassembly || byProduct) {
          // Components of a disassembly and by-products come in at the item's cost.
          line.Price = toNumber((await client.query('SELECT "AvgPrice" FROM "OITM" WHERE "ItemCode" = $1', [component.ItemCode])).rows[0]?.AvgPrice);
        } else {
          // A component returned to stock comes back at the cost it was issued at.
          const issued = (await client.query(`SELECT SUM(l."LineTotal") AS "Value", SUM(l."Quantity") AS "Qty" FROM "IGE1" l
            JOIN "OIGE" h ON h."DocEntry" = l."DocEntry" WHERE h."CANCELED" = 'N' AND l."BaseType" = 202 AND l."BaseEntry" = $1 AND l."BaseLine" = $2`,
          [base.entry, base.line])).rows[0];
          if (!(toNumber(issued.Qty) > 0)) throw slError(400, `${row}: nothing was issued for production order ${order.DocNum} row ${base.line}.`);
          line.Price = toNumber(issued.Value) / toNumber(issued.Qty);
        }
      }
    }
    line.AcctCode = await productionAccount(client, order.Warehouse, 'WipAcct');
  }
};

// Production order quantities are recomputed from the non-cancelled issues and
// receipts: issued per row (receipts of by-products and returns count negative;
// a disassembly row counts what was received), completed / rejected on the header
// (a disassembly completes the product quantity issued).
const refreshProductionOrders = async (client, lines) => {
  const entries = [...new Set(lines.map(baseOf).filter((base) => base?.type === '202').map((base) => base.entry))];
  for (const entry of entries) {
    const order = (await client.query('SELECT "DocNum", "Status", "ItemCode", "Type" FROM "OWOR" WHERE "DocEntry" = $1 FOR UPDATE', [entry])).rows[0];
    if (order.Status !== 'R') throw slError(400, `Production order ${order.DocNum} is not released.`);
    const posted = (table, header, extra) => `COALESCE((SELECT SUM(l."Quantity") FROM ${quote(table)} l JOIN ${quote(header)} h ON h."DocEntry" = l."DocEntry"
      WHERE h."CANCELED" = 'N' AND l."BaseType" = 202 AND l."BaseEntry" = $1 ${extra}), 0)`;
    const issuedRow = posted('IGE1', 'OIGE', 'AND l."BaseLine" = w."LineNum" AND l."ItemCode" <> $2');
    const receivedRow = posted('IGN1', 'OIGN', 'AND l."BaseLine" = w."LineNum" AND l."ItemCode" <> $2');
    await client.query(`UPDATE "WOR1" w SET "IssuedQty" = ${order.Type === 'D' ? `${receivedRow} - ${issuedRow}` : `${issuedRow} - ${receivedRow}`}
      WHERE w."DocEntry" = $1`, [entry, order.ItemCode]);
    if (order.Type === 'D') {
      await client.query(`UPDATE "OWOR" SET "CmpltQty" = ${posted('IGE1', 'OIGE', 'AND l."ItemCode" = $2')}, "RjctQty" = 0 WHERE "DocEntry" = $1`, [entry, order.ItemCode]);
    } else {
      await client.query(`UPDATE "OWOR" SET
        "CmpltQty" = ${posted('IGN1', 'OIGN', `AND l."ItemCode" = $2 AND COALESCE(l."TranType", 'C') <> 'R'`)},
        "RjctQty" = ${posted('IGN1', 'OIGN', `AND l."ItemCode" = $2 AND l."TranType" = 'R'`)}
        WHERE "DocEntry" = $1`, [entry, order.ItemCode]);
    }
  }
};

// SAP backflush: receiving the product (completed or rejected) issues the order's
// backflush components in proportion, as a separate Issue for Production posted
// first, so the product is valued with them.
const backflushForReceipt = async (client, schema, data) => {
  const received = new Map();
  for (const line of data.DocumentLines || []) {
    if (Number(line.BaseType) !== 202 || !hasValue(line.BaseEntry)) continue;
    const order = (await client.query('SELECT "DocEntry", "DocNum", "ItemCode", "PlannedQty", "Type", "Status" FROM "OWOR" WHERE "DocEntry" = $1', [Number(line.BaseEntry)])).rows[0];
    if (!order || order.Type === 'D' || (hasValue(line.ItemCode) && line.ItemCode !== order.ItemCode)) continue;
    if (Number.isInteger(Number(line.BaseLine)) && Number(line.BaseLine) >= 0 && hasValue(line.BaseLine)) {
      const row = (await client.query('SELECT "PlannedQty" FROM "WOR1" WHERE "DocEntry" = $1 AND "LineNum" = $2', [order.DocEntry, Number(line.BaseLine)])).rows[0];
      if (row && toNumber(row.PlannedQty) < 0) continue;
    }
    const current = received.get(order.DocEntry) || { order, qty: 0 };
    current.qty += toNumber(line.Quantity);
    received.set(order.DocEntry, current);
  }
  for (const { order, qty } of received.values()) {
    if (order.Status !== 'R' || !(qty > 0)) continue;
    const components = (await client.query(
      `SELECT "LineNum", "PlannedQty", "wareHouse" FROM "WOR1" WHERE "DocEntry" = $1 AND "IssueType" = 'B' AND "ItemType" IN (4, 290) AND "PlannedQty" > 0 ORDER BY "LineNum"`,
      [order.DocEntry],
    )).rows;
    if (!components.length) continue;
    await createDocumentIn(client, schema, 'InventoryGenExits', {
      DocDate: data.DocDate, BPL_IDAssignedToInvoice: data.BPL_IDAssignedToInvoice, Comments: `Backflush - production order ${order.DocNum}`,
      DocumentLines: components.map((component) => ({
        BaseType: 202, BaseEntry: order.DocEntry, BaseLine: component.LineNum, WarehouseCode: component.wareHouse,
        Quantity: toNumber(component.PlannedQty) * qty / toNumber(order.PlannedQty),
      })),
    });
  }
};

// Closing an order clears what is left in WIP to the WIP variance account.
const postProductionVariance = async (client, schema, entry) => {
  const order = (await client.query('SELECT * FROM "OWOR" WHERE "DocEntry" = $1', [entry])).rows[0];
  const company = await getCompany(client);
  const balance = roundTo(await productionWipBalance(client, entry), toNumber(company.SumDec, 2));
  if (balance === 0) return null;
  const wip = await productionAccount(client, order.Warehouse, 'WipAcct');
  const variance = await productionAccount(client, order.Warehouse, 'WipVarAcct');
  const today = order.CloseDate ? localDay(order.CloseDate) : localToday();
  const journal = await writeJournal(client, schema, {
    rows: [{ account: variance, amount: balance, ProfitCode: order.OcrCode, Project: order.Project }, { account: wip, amount: -balance, ProfitCode: order.OcrCode, Project: order.Project }],
    objType: '202', period: await getPostingPeriod(client, today), company, memo: `Production order ${order.DocNum} - variance`,
    refDate: today, dueDate: today, taxDate: today, baseRef: String(order.DocNum), ref1: String(order.DocNum), createdBy: order.DocEntry, bplId: order.BPLId,
  });
  await client.query('UPDATE "OWOR" SET "TransId" = $2 WHERE "DocEntry" = $1', [entry, journal.TransId]);
  return journal;
};

// Base rows' open quantity = quantity - everything copied from them by
// non-cancelled targets; a row with nothing open closes, and so does a document
// with no open rows. Recomputed (not decremented) so edits and cancels stay exact.
const refreshBaseLines = async (client, objType, lines) => {
  const consumed = BASE_OBJECTS[objType] || [];
  const links = new Map(lines.map(baseOf).filter((base) => base && consumed.includes(base.type)).map((base) => [baseKey(base), base]));
  const documents = new Map();
  for (const base of links.values()) {
    const definition = DOCUMENTS[OBJECT_ENTITY[base.type]];
    const targets = Object.entries(BASE_OBJECTS).filter(([, bases]) => bases.includes(base.type)).map(([target]) => DOCUMENTS[OBJECT_ENTITY[target]]);
    const copies = (await client.query(targets.map((target) => `
      SELECT l."Quantity", ${Number(target.objType)} AS "Type", l."DocEntry" FROM ${quote(target.lines)} l
      JOIN ${quote(target.header)} h ON h."DocEntry" = l."DocEntry"
      WHERE h."CANCELED" = 'N' AND l."BaseType" = $1 AND l."BaseEntry" = $2 AND l."BaseLine" = $3`).join(' UNION ALL '),
    [Number(base.type), base.entry, base.line])).rows;
    const copied = copies.reduce((sum, copy) => sum + toNumber(copy.Quantity), 0);
    const last = copies.at(-1);
    await client.query(
      `UPDATE ${quote(definition.lines)} SET "OpenQty" = GREATEST("Quantity" - $3, 0),
         "OpenSum" = GREATEST("Quantity" - $3, 0) * "Price" * COALESCE(NULLIF("Rate", 0), 1),
         "LineStatus" = CASE WHEN "Quantity" - $3 > 0 THEN 'O' ELSE 'C' END, "TargetType" = $4, "TrgetEntry" = $5
       WHERE "DocEntry" = $1 AND "LineNum" = $2`,
      [base.entry, base.line, copied, last ? last.Type : -1, last ? last.DocEntry : null],
    );
    documents.set(`${base.type}:${base.entry}`, { definition, entry: base.entry });
  }
  for (const { definition, entry } of documents.values()) {
    await client.query(
      `UPDATE ${quote(definition.header)} SET "DocStatus" = CASE WHEN EXISTS (
         SELECT 1 FROM ${quote(definition.lines)} WHERE "DocEntry" = $1 AND "LineStatus" = 'O') THEN 'O' ELSE 'C' END
       WHERE "DocEntry" = $1 AND "CANCELED" = 'N'`, [entry],
    );
  }
};

// OITW.IsCommited / OnOrder = open quantity of open sales / purchase order rows,
// recomputed for the touched item-warehouse pairs; OITM holds the totals.
// ponytail: scans RDR1/POR1 by (ItemCode, WhsCode) index; fine at local volumes.
const openOrderQty = (lines, header) => `COALESCE((SELECT SUM(l."OpenQty" * CASE WHEN l."UseBaseUn" = 'Y' THEN 1 ELSE COALESCE(NULLIF(l."NumPerMsr", 0), 1) END)
  FROM ${quote(lines)} l JOIN ${quote(header)} h ON h."DocEntry" = l."DocEntry"
  WHERE h."CANCELED" = 'N' AND l."LineStatus" = 'O' AND l."ItemCode" = w."ItemCode" AND l."WhsCode" = w."WhsCode"), 0)`;
const refreshOrdered = async (client, lines) => {
  const pairs = new Map();
  for (const line of lines) {
    if (line.resource || Number(line.ItemType) === 290) continue; // resources have no stock
    for (const row of [line, line.baseRow].filter(Boolean)) {
      if (hasValue(row.ItemCode) && hasValue(row.WhsCode)) pairs.set(`${row.ItemCode}\u0000${row.WhsCode}`, [row.ItemCode, row.WhsCode]);
    }
  }
  if (!pairs.size) return;
  const sorted = [...pairs.values()].sort(([a, x], [b, y]) => a.localeCompare(b) || x.localeCompare(y));
  const items = [...new Set(sorted.map(([item]) => item))];
  // Lock items before warehouse rows, the same order stock posting uses.
  await client.query('SELECT 1 FROM "OITM" WHERE "ItemCode" = ANY($1) ORDER BY "ItemCode" FOR UPDATE', [items]);
  const itemCodes = sorted.map(([item]) => item);
  const warehouses = sorted.map(([, whs]) => whs);
  await client.query(`INSERT INTO "OITW" ("ItemCode", "WhsCode") SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT DO NOTHING`, [itemCodes, warehouses]);
  await client.query(
    `UPDATE "OITW" w SET "IsCommited" = ${openOrderQty('RDR1', 'ORDR')}, "OnOrder" = ${openOrderQty('POR1', 'OPOR')}
     FROM unnest($1::text[], $2::text[]) AS p("ItemCode", "WhsCode"), "OITM" i
     WHERE w."ItemCode" = p."ItemCode" AND w."WhsCode" = p."WhsCode" AND i."ItemCode" = w."ItemCode" AND i."InvntItem" = 'Y'`,
    [itemCodes, warehouses],
  );
  await client.query(
    `UPDATE "OITM" i SET "IsCommited" = t."IsCommited", "OnOrder" = t."OnOrder"
     FROM (SELECT "ItemCode", SUM("IsCommited") AS "IsCommited", SUM("OnOrder") AS "OnOrder" FROM "OITW" WHERE "ItemCode" = ANY($1) GROUP BY "ItemCode") t
     WHERE i."ItemCode" = t."ItemCode"`, [items],
  );
};

// Moves stock for a posting document at moving average (OITM.AvgPrice, one cost
// per company as in SAP without per-warehouse costing) and writes OINM. Goods out
// leave at average cost; purchases come in at their net document price; an A/P
// credit memo leaves at its document price; an A/R credit memo returns at the
// base invoice's cost. Sets each row's StockPrice (per inventory unit) and
// stockValue (what the journal posts).
const postStock = async (client, { header, lines, company }) => {
  const objType = String(header.ObjType);
  const direction = STOCK_DIRECTION[objType];
  const sumDec = toNumber(company.SumDec, 2);
  const headerFactor = 1 - toNumber(header.DiscPrcnt) / 100;
  const codes = [...new Set(lines.map((line) => line.ItemCode).filter(hasValue))].sort();
  const items = new Map((await client.query(
    `SELECT "ItemCode", "InvntItem", "ManBtchNum", "ManSerNum", "EvalSystem", "OnHand", "AvgPrice" FROM "OITM"
     WHERE "ItemCode" = ANY($1) ORDER BY "ItemCode" FOR UPDATE`, [codes],
  )).rows.map((item) => [item.ItemCode, item]));
  for (const [index, line] of lines.entries()) {
    const item = items.get(line.ItemCode);
    line.stockValue = 0;
    const row = `Row ${index + 1}`;
    if (line.resource) continue;
    if (INVENTORY_POSTING.has(objType) && item?.InvntItem !== 'Y') throw slError(400, `${row}: item "${line.ItemCode}" is not an inventory item.`);
    if (!item || item.InvntItem !== 'Y' || header.DocType === 'S') continue;
    const qty = inventoryQty(line);
    const base = line.baseRow;
    if (base && STOCK_MOVED_BY[objType] === base.BaseObject) {
      line.StockPrice = toNumber(base.StockPrice);
      if (objType === '13') line.GrssProfit = roundTo(line.LineTotal * headerFactor - line.StockPrice * qty, sumDec);
      continue;
    }
    if (item.EvalSystem && item.EvalSystem !== 'A') throw slError(400, `${row}: only moving average valuation is supported (item "${item.ItemCode}").`);
    if (!(qty > 0)) throw slError(400, `${row}: enter a quantity greater than zero.`);
    // A transfer leaves the from warehouse and enters the to warehouse; everything else moves one warehouse.
    const moves = objType === '67' ? [[line.FromWhsCod, -qty], [line.WhsCode, qty]] : [[line.WhsCode, direction * qty]];
    for (const [whsCode, delta] of moves) {
      await client.query('INSERT INTO "OITW" ("ItemCode", "WhsCode") VALUES ($1, $2) ON CONFLICT DO NOTHING', [line.ItemCode, whsCode]);
      const stock = (await client.query(
        'SELECT "OnHand", "Locked" FROM "OITW" WHERE "ItemCode" = $1 AND "WhsCode" = $2 FOR UPDATE', [line.ItemCode, whsCode],
      )).rows[0];
      if (stock.Locked === 'Y') throw slError(400, `${row}: item "${line.ItemCode}" is locked in warehouse ${whsCode}.`);
      // ponytail: negative stock is always blocked (moving average needs it); add a company switch if SAP's "allow negative" is wanted.
      if (delta < 0 && toNumber(stock.OnHand) < -delta) {
        throw slError(400, `${row}: quantity falls into negative inventory for item "${line.ItemCode}" in warehouse ${whsCode}.`);
      }
    }
    if (item.ManBtchNum === 'Y' || item.ManSerNum === 'Y') {
      await moveBatchesAndSerials(client, { objType, header, line, item, qty, moves, row });
    }
    const onHand = toNumber(item.OnHand);
    const average = toNumber(item.AvgPrice);
    const net = roundTo(line.LineTotal * headerFactor, sumDec);
    let value;
    if (objType === '14') value = roundTo(qty * (base ? toNumber(base.StockPrice) : average), sumDec);
    else if ((direction < 0 && objType !== '19') || objType === '67') value = roundTo(qty * average, sumDec);
    else value = net;
    const newOnHand = onHand + direction * qty;
    let newAverage = average;
    if (newOnHand > 0 && (direction > 0 || objType === '19')) newAverage = Math.max(0, (onHand * average + direction * value) / newOnHand);
    for (const [whsCode, delta] of moves) {
      await client.query('UPDATE "OITW" SET "OnHand" = "OnHand" + $3 WHERE "ItemCode" = $1 AND "WhsCode" = $2', [line.ItemCode, whsCode, delta]);
    }
    await client.query('UPDATE "OITM" SET "OnHand" = $2, "AvgPrice" = $3 WHERE "ItemCode" = $1', [line.ItemCode, newOnHand, newAverage]);
    await client.query('UPDATE "OITW" SET "AvgPrice" = $2 WHERE "ItemCode" = $1', [line.ItemCode, newAverage]);
    Object.assign(item, { OnHand: newOnHand, AvgPrice: newAverage });
    for (const [whsCode, delta] of moves) {
      await client.query(
        `INSERT INTO "OINM" ("TransType", "CreatedBy", "DocLineNum", "DocDate", "ItemCode", "Dscription", "Warehouse",
           "InQty", "OutQty", "Price", "TransValue", "CalcPrice", "CardCode", "BASE_REF", "Currency", "Balance")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $12, $13, $14, $15)`,
        [Number(objType), header.DocEntry, line.LineNum, header.DocDate, line.ItemCode, line.Dscription, whsCode,
          delta > 0 ? qty : 0, delta < 0 ? qty : 0, value / qty, Math.sign(delta) * value, header.CardCode,
          String(header.DocNum), company.MainCurncy, roundTo(newOnHand * newAverage, sumDec)],
      );
    }
    line.StockPrice = value / qty;
    line.stockValue = value;
    if (['13', '15'].includes(objType)) line.GrssProfit = roundTo(net - value, sumDec);
    // Goods issues and transfers are valued at cost, whatever price the page sent.
    if (objType === '60' || objType === '67') {
      const price = value / toNumber(line.Quantity);
      Object.assign(line, { Price: price, PriceBefDi: price, LineTotal: value, TotalSumSy: value });
    }
  }
  if (['20', '18'].includes(objType)) {
    for (const line of lines.filter((l) => items.has(l.ItemCode))) {
      await client.query('UPDATE "OITM" SET "LastPurPrc" = $2, "LastPurCur" = $3, "LastPurDat" = $4 WHERE "ItemCode" = $1',
        [line.ItemCode, toNumber(line.Price), header.DocCur, header.DocDate]);
    }
  }
};

// ---- batch and serial numbers -----------------------------------------------------
// SAP: every stock move of a batch item names its batches (quantities add up to the
// row's inventory quantity); a serial item names one serial per unit. Receipts create
// them, issues take them from the warehouse, transfers move them. Each move is logged
// in IBT1 / SRI1 so a cancellation reverses exactly what was posted.

const moveBatch = async (client, { itemCode, batch, whsCode, delta, objType, docEntry, lineNum, docDate, details = {}, row }) => {
  let master = (await client.query('SELECT "SysNumber", "ExpDate" FROM "OBTN" WHERE "ItemCode" = $1 AND "DistNumber" = $2', [itemCode, batch])).rows[0];
  if (!master) {
    if (delta < 0) throw slError(400, `${row}: batch "${batch}" of item "${itemCode}" does not exist.`);
    master = (await client.query(
      `INSERT INTO "OBTN" ("ItemCode", "SysNumber", "DistNumber", "MnfSerial", "LotNumber", "ExpDate", "MnfDate", "InDate", "Notes")
       VALUES ($1, (SELECT COALESCE(MAX("SysNumber"), 0) + 1 FROM "OBTN" WHERE "ItemCode" = $1), $2, $3, $4, $5, $6, $7, $8) RETURNING "SysNumber", "ExpDate"`,
      [itemCode, batch, details.ManufacturerSerialNumber || null, details.InternalSerialNumber || null,
        details.ExpiryDate || null, details.ManufacturingDate || null, details.AddmisionDate || docDate, details.Notes || null],
    )).rows[0];
  }
  await client.query(`INSERT INTO "OIBT" ("ItemCode", "BatchNum", "WhsCode", "SysNumber", "ExpDate", "InDate")
    VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`, [itemCode, batch, whsCode, master.SysNumber, master.ExpDate, docDate]);
  const stock = (await client.query('SELECT "Quantity" FROM "OIBT" WHERE "ItemCode" = $1 AND "BatchNum" = $2 AND "WhsCode" = $3 FOR UPDATE', [itemCode, batch, whsCode])).rows[0];
  if (delta < 0 && toNumber(stock.Quantity) + delta < -1e-6) {
    throw slError(400, `${row}: batch "${batch}" of item "${itemCode}" has only ${toNumber(stock.Quantity)} in warehouse ${whsCode}.`);
  }
  await client.query('UPDATE "OIBT" SET "Quantity" = "Quantity" + $4 WHERE "ItemCode" = $1 AND "BatchNum" = $2 AND "WhsCode" = $3', [itemCode, batch, whsCode, delta]);
  await client.query(`INSERT INTO "IBT1" ("ItemCode", "BatchNum", "WhsCode", "SysNumber", "BaseType", "BaseEntry", "BaseLinNum", "Quantity", "Direction", "DocDate")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [itemCode, batch, whsCode, master.SysNumber, Number(objType), docEntry, lineNum, Math.abs(delta), delta > 0 ? 0 : 1, docDate]);
};

const moveSerial = async (client, { itemCode, serial, whsCode, delta, objType, docEntry, lineNum, docDate, details = {}, row }) => {
  let master = (await client.query('SELECT "SysNumber" FROM "OSRN" WHERE "ItemCode" = $1 AND "DistNumber" = $2', [itemCode, serial])).rows[0];
  if (delta > 0) {
    if (master) {
      const inStock = (await client.query('SELECT "WhsCode" FROM "OSRQ" WHERE "ItemCode" = $1 AND "SysNumber" = $2 AND "Quantity" > 0', [itemCode, master.SysNumber])).rows[0];
      if (inStock) throw slError(400, `${row}: serial number "${serial}" of item "${itemCode}" is already in stock (warehouse ${inStock.WhsCode}).`);
    } else {
      master = (await client.query(
        `INSERT INTO "OSRN" ("ItemCode", "SysNumber", "DistNumber", "MnfSerial", "LotNumber", "ExpDate", "MnfDate", "InDate", "Notes")
         VALUES ($1, (SELECT COALESCE(MAX("SysNumber"), 0) + 1 FROM "OSRN" WHERE "ItemCode" = $1), $2, $3, $4, $5, $6, $7, $8) RETURNING "SysNumber"`,
        [itemCode, serial, details.ManufacturerSerialNumber || null, details.BatchID || null,
          details.ExpiryDate || null, details.ManufactureDate || null, docDate, details.Notes || null],
      )).rows[0];
    }
  } else {
    const inWarehouse = master && (await client.query(
      'SELECT 1 FROM "OSRQ" WHERE "ItemCode" = $1 AND "SysNumber" = $2 AND "WhsCode" = $3 AND "Quantity" > 0 FOR UPDATE', [itemCode, master.SysNumber, whsCode],
    )).rowCount;
    if (!inWarehouse) throw slError(400, `${row}: serial number "${serial}" of item "${itemCode}" is not in stock in warehouse ${whsCode}.`);
  }
  const sign = delta > 0 ? 1 : -1;
  await client.query(`INSERT INTO "OSRQ" ("ItemCode", "SysNumber", "WhsCode", "Quantity") VALUES ($1, $2, $3, $4)
    ON CONFLICT ("ItemCode", "SysNumber", "WhsCode") DO UPDATE SET "Quantity" = "OSRQ"."Quantity" + EXCLUDED."Quantity"`, [itemCode, master.SysNumber, whsCode, sign]);
  await client.query(`INSERT INTO "OSRI" ("ItemCode", "SysSerial", "IntrSerial", "SuppSerial", "WhsCode", "Status", "InDate")
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT ("ItemCode", "SysSerial") DO UPDATE SET "WhsCode" = EXCLUDED."WhsCode", "Status" = EXCLUDED."Status"`,
  [itemCode, master.SysNumber, serial, details.ManufacturerSerialNumber || null, whsCode, sign > 0 ? 0 : 1, docDate]);
  await client.query(`INSERT INTO "SRI1" ("ItemCode", "SysSerial", "IntrSerial", "WhsCode", "BaseType", "BaseEntry", "BaseLinNum", "Direction", "DocDate")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [itemCode, master.SysNumber, serial, whsCode, Number(objType), docEntry, lineNum, sign > 0 ? 0 : 1, docDate]);
};

const moveBatchesAndSerials = async (client, { objType, header, line, item, qty, moves, row }) => {
  const base = { itemCode: item.ItemCode, objType, docEntry: header.DocEntry, lineNum: line.LineNum, docDate: header.DocDate, row };
  if (item.ManBtchNum === 'Y') {
    const batches = (line.batches || []).filter((batch) => hasValue(batch.BatchNumber));
    if (!batches.length) throw slError(400, `${row}: enter the batch numbers for item "${item.ItemCode}".`);
    if (batches.some((batch) => !(toNumber(batch.Quantity) > 0))) throw slError(400, `${row}: each batch needs a quantity greater than zero.`);
    const total = batches.reduce((sum, batch) => sum + toNumber(batch.Quantity), 0);
    if (Math.abs(total - qty) > 1e-6) throw slError(400, `${row}: batch quantities (${total}) must equal the row quantity (${qty}).`);
    for (const [whsCode, delta] of moves) {
      for (const batch of batches) {
        await moveBatch(client, { ...base, batch: String(batch.BatchNumber).trim(), whsCode, delta: Math.sign(delta) * toNumber(batch.Quantity), details: batch });
      }
    }
    return;
  }
  const serials = (line.serials || [])
    .map((serial) => ({ ...serial, number: String(serial.InternalSerialNumber ?? serial.ManufacturerSerialNumber ?? '').trim() }))
    .filter((serial) => serial.number);
  if (!Number.isInteger(qty)) throw slError(400, `${row}: a serial-managed item needs a whole quantity.`);
  if (serials.length !== qty) throw slError(400, `${row}: enter ${qty} serial number(s) for item "${item.ItemCode}" (${serials.length} entered).`);
  if (new Set(serials.map((serial) => serial.number)).size !== serials.length) throw slError(400, `${row}: a serial number is entered twice.`);
  for (const [whsCode, delta] of moves) {
    for (const serial of serials) await moveSerial(client, { ...base, serial: serial.number, whsCode, delta: Math.sign(delta), details: serial });
  }
};

// Undoes a document's batch / serial moves (latest first) for its cancellation document.
const reverseBatchesAndSerials = async (client, { objType, originalEntry, cancelEntry, docDate }) => {
  const batches = (await client.query('SELECT * FROM "IBT1" WHERE "BaseType" = $1 AND "BaseEntry" = $2 ORDER BY "LogEntry" DESC', [Number(objType), originalEntry])).rows;
  for (const move of batches) {
    await moveBatch(client, { itemCode: move.ItemCode, batch: move.BatchNum, whsCode: move.WhsCode, delta: (move.Direction === 0 ? -1 : 1) * toNumber(move.Quantity),
      objType, docEntry: cancelEntry, lineNum: move.BaseLinNum, docDate, row: 'Cannot cancel' });
  }
  const serials = (await client.query('SELECT * FROM "SRI1" WHERE "BaseType" = $1 AND "BaseEntry" = $2 ORDER BY "LogEntry" DESC', [Number(objType), originalEntry])).rows;
  for (const move of serials) {
    await moveSerial(client, { itemCode: move.ItemCode, serial: move.IntrSerial, whsCode: move.WhsCode, delta: move.Direction === 0 ? -1 : 1,
      objType, docEntry: cancelEntry, lineNum: move.BaseLinNum, docDate, row: 'Cannot cancel' });
  }
};

// G/L accounts per SAP account determination: item rows by the item's G/L method
// (C = item group, W = warehouse; L item level falls back to warehouse), then the
// fiscal category defaults (OACP); BP rows by the BP's control account.
const ACP_DEFAULT = {
  SaleCostAc: 'COGM_Act', RevenuesAc: 'DfltIncom', ExpensesAc: 'DfltExpn', TransferAc: 'AlocCstAct', DecreasAc: 'DecreasAc', IncreasAc: 'IncreasAc',
};
const ACCOUNT_LABEL = {
  BalInvntAc: 'inventory', SaleCostAc: 'cost of goods sold', RevenuesAc: 'revenue', ExpensesAc: 'expense',
  TransferAc: 'allocation (goods received not invoiced)', PriceDifAc: 'price difference',
  DecreasAc: 'inventory offset - decrease', IncreasAc: 'inventory offset - increase',
};
const accountResolver = async (client, period) => {
  const acp = (await client.query(
    'SELECT * FROM "OACP" ORDER BY ("PeriodCat" = $1) DESC, "FinancYear" DESC LIMIT 1', [period.Category || period.Indicator],
  )).rows[0] || {};
  const cache = new Map();
  const load = async (sql, key) => {
    const id = `${sql}|${key}`;
    if (!cache.has(id)) cache.set(id, (await client.query(sql, [key])).rows[0] || null);
    return cache.get(id);
  };
  const item = (code) => load('SELECT "ItemCode", "GLMethod", "ItmsGrpCod", "InvntItem" FROM "OITM" WHERE "ItemCode" = $1', code);
  return {
    acp,
    item,
    isInventory: async (line) => hasValue(line.ItemCode) && (await item(line.ItemCode))?.InvntItem === 'Y',
    itemAccount: async (line, column) => {
      const master = await item(line.ItemCode);
      const group = master && await load('SELECT * FROM "OITB" WHERE "ItmsGrpCod" = $1', master.ItmsGrpCod);
      const warehouse = await load('SELECT * FROM "OWHS" WHERE "WhsCode" = $1', line.WhsCode);
      const sources = master?.GLMethod === 'C' ? [group, warehouse] : [warehouse, group];
      const account = sources.map((source) => source?.[column]).find(hasValue) || acp[ACP_DEFAULT[column]];
      if (!hasValue(account)) {
        throw slError(400, `Define the ${ACCOUNT_LABEL[column]} account for item "${line.ItemCode}" in its item group, warehouse ${line.WhsCode} or G/L Account Determination.`);
      }
      return account;
    },
    bpAccount: async (cardCode, sales) => {
      const bp = await load('SELECT "DebPayAcct" FROM "OCRD" WHERE "CardCode" = $1', cardCode);
      const account = bp?.DebPayAcct || acp[sales ? 'LinkAct_1' : 'LinkAct_10'];
      if (!hasValue(account)) throw slError(400, `Define the ${sales ? 'receivables' : 'payables'} control account for "${cardCode}" or in G/L Account Determination.`);
      return account;
    },
    taxRows: (code) => load(`SELECT json_agg(json_build_object('code', s."STACode", 'rate', s."EfctivRate", 'sales', a."SalesTax", 'purchase', a."PurchTax") ORDER BY s."Line_ID") AS "Rows"
      FROM "STC1" s LEFT JOIN "OSTA" a ON a."Code" = s."STACode" AND a."Type" = s."STAType" WHERE s."STCCode" = $1`, code),
    expenseAccount: async (code, sales) => {
      const expense = await load('SELECT "RevAcct", "ExpnsAcct" FROM "OEXD" WHERE "ExpnsCode" = $1', code);
      const account = expense?.[sales ? 'RevAcct' : 'ExpnsAcct'] || acp[sales ? 'DfltIncom' : 'DfltExpn'];
      if (!hasValue(account)) throw slError(400, `Define the ${sales ? 'revenue' : 'expense'} account for freight ${code} or in G/L Account Determination.`);
      return account;
    },
  };
};

// Builds and saves the document's journal entry (OJDT/JDT1), links it on the
// header and moves the BP balance. Amounts are local currency; debit positive.
const postJournal = async (client, schema, { header, lines, expenses, company, period }) => {
  const objType = String(header.ObjType);
  const sumDec = toNumber(company.SumDec, 2);
  const sales = !PURCHASE_OBJECTS.has(objType);
  // Credit memos post their invoice's entry reversed.
  const sign = ['14', '19'].includes(objType) ? -1 : 1;
  const accounts = await accountResolver(client, period);
  const entries = [];
  const add = (account, amount, source = {}) => {
    if (roundTo(amount, sumDec) !== 0) entries.push({ account, amount: roundTo(amount * sign, sumDec), ...source });
  };
  const rowSource = (line) => ({ ProfitCode: line.OcrCode, OcrCode2: line.OcrCode2, OcrCode3: line.OcrCode3, Project: line.Project });

  if (INVENTORY_POSTING.has(objType)) {
    // Goods receipt: inventory against the row's account or the increase offset; goods
    // issue: the decrease offset against inventory; transfer: to- against from-warehouse
    // inventory account (nothing to post when both warehouses share one).
    for (const line of lines.filter((l) => l.stockValue)) {
      const inventory = await accounts.itemAccount(line, 'BalInvntAc');
      if (objType === '67') {
        add(inventory, line.stockValue, rowSource(line));
        add(await accounts.itemAccount({ ...line, WhsCode: line.FromWhsCod }, 'BalInvntAc'), -line.stockValue, rowSource(line));
        continue;
      }
      const inward = objType === '59' ? 1 : -1;
      const offset = hasValue(line.AcctCode) ? line.AcctCode : await accounts.itemAccount(line, inward > 0 ? 'IncreasAc' : 'DecreasAc');
      add(inventory, inward * line.stockValue, rowSource(line));
      add(offset, -inward * line.stockValue, rowSource(line));
    }
    // Resources issued to production: WIP against the resource absorption account.
    for (const line of lines.filter((l) => l.resource && toNumber(l.LineTotal))) {
      add(line.AcctCode, toNumber(line.LineTotal), rowSource(line));
      add(await resourceAccount(client, line.ItemCode), -toNumber(line.LineTotal), rowSource(line));
    }
  } else if (objType === '15' || objType === '20') {
    // Delivery: COGS against inventory. GRPO: inventory against allocation (tax posts with the A/P invoice).
    for (const line of lines.filter((l) => l.stockValue)) {
      const inventory = await accounts.itemAccount(line, 'BalInvntAc');
      const offset = await accounts.itemAccount(line, objType === '15' ? 'SaleCostAc' : 'TransferAc');
      add(objType === '15' ? offset : inventory, line.stockValue, rowSource(line));
      add(objType === '15' ? inventory : offset, -line.stockValue, rowSource(line));
    }
  } else {
    const bpSide = sales ? 1 : -1; // customer debit / vendor credit
    header.CtlAccount = await accounts.bpAccount(header.CardCode, sales);
    add(header.CtlAccount, bpSide * toNumber(header.DocTotal), { ShortName: header.CardCode, bp: true });
    // Net rows after header discount; the rounding remainder goes on the last row.
    const nets = lines.map((line) => roundTo(toNumber(line.LineTotal) * (1 - toNumber(header.DiscPrcnt) / 100), sumDec));
    if (nets.length) {
      const total = lines.reduce((sum, line) => sum + toNumber(line.LineTotal), 0) - toNumber(header.DiscSum);
      nets[nets.length - 1] = roundTo(nets.at(-1) + total - nets.reduce((a, b) => a + b, 0), sumDec);
    }
    for (const [index, line] of lines.entries()) {
      const net = nets[index];
      const source = rowSource(line);
      const glAccount = async (column) => {
        if (hasValue(line.AcctCode)) return line.AcctCode;
        if (!hasValue(line.ItemCode)) throw slError(400, `Row ${index + 1}: select a G/L account.`);
        return accounts.itemAccount(line, column);
      };
      if (sales) {
        add(await glAccount('RevenuesAc'), -net, source);
        if (line.stockValue) {
          add(await accounts.itemAccount(line, 'SaleCostAc'), line.stockValue, source);
          add(await accounts.itemAccount(line, 'BalInvntAc'), -line.stockValue, source);
        }
      } else if (line.baseRow?.BaseObject === '20' && await accounts.isInventory(line)) {
        // A/P invoice from GRPO clears the allocation at the receipt value; any price change goes to price difference.
        const received = roundTo(toNumber(line.baseRow.StockPrice) * inventoryQty(line), sumDec);
        add(await accounts.itemAccount(line, 'TransferAc'), received, source);
        add(await accounts.itemAccount(line, 'PriceDifAc'), net - received, source);
      } else if (header.DocType !== 'S' && await accounts.isInventory(line)) {
        add(await accounts.itemAccount(line, 'BalInvntAc'), net, source);
      } else {
        add(await glAccount('ExpensesAc'), net, source);
      }
    }
    // Tax: each row's tax split over its components' accounts by rate.
    for (const row of [...lines, ...expenses].filter((r) => toNumber(r.VatSum))) {
      const components = (await accounts.taxRows(row.TaxCode))?.Rows || [];
      const totalRate = components.reduce((sum, c) => sum + toNumber(c.rate), 0);
      if (!totalRate) throw slError(400, `Tax code "${row.TaxCode}" has no components to post.`);
      let remaining = toNumber(row.VatSum);
      for (const [i, component] of components.entries()) {
        const amount = i === components.length - 1 ? remaining : roundTo(toNumber(row.VatSum) * toNumber(component.rate) / totalRate, sumDec);
        remaining = roundTo(remaining - amount, sumDec);
        const account = sales ? component.sales : component.purchase;
        if (!hasValue(account)) throw slError(400, `Define the ${sales ? 'sales' : 'purchase'} tax account for tax component "${component.code}".`);
        add(account, -bpSide * amount);
      }
    }
    for (const expense of expenses) add(await accounts.expenseAccount(expense.ExpnsCode, sales), -bpSide * toNumber(expense.LineTotal));
    if (toNumber(header.RoundDif)) {
      if (!hasValue(accounts.acp.RoundAcct)) throw slError(400, 'Define the rounding account in G/L Account Determination.');
      add(accounts.acp.RoundAcct, -bpSide * toNumber(header.RoundDif));
    }
  }
  if (!entries.length) return null;

  // One row per account (and BP), as SAP shows document journal entries.
  const merged = new Map();
  for (const entry of entries) {
    const key = `${entry.account}|${entry.ShortName || ''}|${entry.ProfitCode || ''}|${entry.Project || ''}`;
    if (merged.has(key)) merged.get(key).amount = roundTo(merged.get(key).amount + entry.amount, sumDec);
    else merged.set(key, { ...entry });
  }
  const rows = [...merged.values()].filter((entry) => entry.amount !== 0);
  if (!rows.length) return null;
  const isForeign = header.DocCur && header.DocCur !== company.MainCurncy;
  rows.forEach((entry) => {
    if (entry.bp && isForeign) Object.assign(entry, { fcAmount: toNumber(header.DocTotalFC), fcCurrency: header.DocCur });
  });
  const memo = hasValue(header.JrnlMemo) ? header.JrnlMemo : [JOURNAL_MEMO[objType], header.CardCode].filter(hasValue).join(' - ');
  const reference = String(header.DocNum);
  return writeJournal(client, schema, {
    rows, objType, period, company, memo, refDate: header.DocDate, dueDate: header.DocDueDate, taxDate: header.TaxDate,
    baseRef: reference, ref1: reference, ref2: header.NumAtCard || null, createdBy: header.DocEntry, bplId: header.BPLId,
  });
};

// Saves a balanced journal entry (OJDT/JDT1) and moves the balances of the
// business partners on it. rows: { account, amount (debit +), ShortName, bp,
// LineMemo, ProfitCode..., balDue (open amount left for reconciliation; default
// the full amount), fcAmount/fcCurrency }.
const writeJournal = async (client, schema, j) => {
  const sumDec = toNumber(j.company.SumDec, 2);
  const { rows } = j;
  const balance = roundTo(rows.reduce((sum, entry) => sum + entry.amount, 0), sumDec);
  if (balance !== 0) throw slError(400, `The journal entry does not balance (difference ${balance}).`);
  const { DocNum: number, Series } = await assignDocNum(client, {
    table: 'OJDT', objType: '30', subType: '--', series: j.series ?? null, manualDocNum: null, period: j.period,
  });
  const debit = roundTo(rows.reduce((sum, entry) => sum + Math.max(entry.amount, 0), 0), sumDec);
  const journal = (await client.query(
    `INSERT INTO "OJDT" ("Number", "Series", "RefDate", "DueDate", "TaxDate", "Memo", "TransType", "BaseRef", "Ref1", "Ref2", "Ref3", "CreatedBy", "LocTotal")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING "TransId"`,
    [number, Series, j.refDate, j.dueDate, j.taxDate, j.memo, Number(j.objType), j.baseRef ?? null, j.ref1 ?? null, j.ref2 ?? null, j.ref3 ?? null, j.createdBy ?? null, debit],
  )).rows[0].TransId;
  if (j.stornoTo) await client.query('UPDATE "OJDT" SET "StornoToTr" = $2 WHERE "TransId" = $1', [journal, j.stornoTo]);
  // A manual entry is its own base document.
  if (j.createdBy === undefined) await client.query('UPDATE "OJDT" SET "CreatedBy" = "TransId", "BaseRef" = COALESCE("BaseRef", "Number"::text) WHERE "TransId" = $1', [journal]);
  const columns = await getColumns(client, schema, 'JDT1');
  const bpRow = rows.find((entry) => entry.bp);
  for (const [index, entry] of rows.entries()) {
    const Debit = Math.max(entry.amount, 0);
    const Credit = Math.max(-entry.amount, 0);
    const open = entry.balDue === undefined ? Math.abs(entry.amount) : entry.balDue;
    const foreign = toNumber(entry.fcAmount);
    await insertRow(client, 'JDT1', columns, {
      TransId: journal, Line_ID: index, Account: entry.account, ShortName: entry.ShortName || entry.account,
      Debit, Credit, SYSDeb: Debit, SYSCred: Credit,
      BalDueDeb: Debit ? open : 0, BalDueCred: Credit ? open : 0, BalScDeb: Debit ? open : 0, BalScCred: Credit ? open : 0,
      FCDebit: Debit ? foreign : 0, FCCredit: Credit ? foreign : 0, BalFcDeb: Debit ? foreign : 0, BalFcCred: Credit ? foreign : 0,
      FCCurrency: foreign ? entry.fcCurrency : null, RefDate: j.refDate, DueDate: entry.DueDate || j.dueDate, TaxDate: j.taxDate,
      LineMemo: entry.LineMemo || j.memo, TransType: Number(j.objType), BaseRef: j.baseRef ?? String(number), Ref1: j.ref1 ?? null, Ref2: j.ref2 ?? null,
      ContraAct: entry.bp ? rows.find((other) => !other.bp)?.account : (bpRow ? bpRow.ShortName : null),
      ProfitCode: entry.ProfitCode, OcrCode2: entry.OcrCode2, OcrCode3: entry.OcrCode3, OcrCode4: entry.OcrCode4, OcrCode5: entry.OcrCode5,
      Project: entry.Project, BPLId: j.bplId, CreatedBy: j.createdBy ?? journal,
      VatGroup: entry.VatGroup, BaseSum: entry.BaseSum, VatAmount: entry.VatAmount, VatLine: entry.VatLine,
    });
  }
  for (const entry of rows.filter((row) => row.bp)) {
    await client.query('UPDATE "OCRD" SET "Balance" = COALESCE("Balance", 0) + $2 WHERE "CardCode" = $1', [entry.ShortName, entry.amount]);
  }
  return { TransId: journal, JrnlMemo: j.memo, Number: number };
};

// Stock then journal for a just-inserted posting document (one transaction).
const postDocument = async (client, schema, context) => {
  await postStock(client, context);
  const journal = await postJournal(client, schema, context);
  const { header, lines } = context;
  const grossProfit = lines.reduce((sum, line) => sum + toNumber(line.GrssProfit), 0);
  await client.query(
    `UPDATE ${quote(DOCUMENTS[OBJECT_ENTITY[String(header.ObjType)]].header)} SET "TransId" = $2, "JrnlMemo" = COALESCE($3, "JrnlMemo"), "GrosProfit" = $4 WHERE "DocEntry" = $1`,
    [header.DocEntry, journal?.TransId ?? null, journal?.JrnlMemo ?? null, grossProfit],
  );
  if (['13', '14', '18', '19'].includes(String(header.ObjType))) {
    // The control account the BP row posted to; payments on account default to it.
    await client.query(`UPDATE ${quote(DOCUMENTS[OBJECT_ENTITY[String(header.ObjType)]].header)} SET "CtlAccount" = $2 WHERE "DocEntry" = $1`, [header.DocEntry, header.CtlAccount]);
  }
  if (INVENTORY_POSTING.has(String(header.ObjType))) {
    // Issues and transfers were revalued at cost; their total follows. Nothing stays open to copy.
    header.DocTotal = roundTo(lines.reduce((sum, line) => sum + toNumber(line.LineTotal), 0), toNumber(context.company.SumDec, 2));
    await client.query(`UPDATE ${quote(DOCUMENTS[OBJECT_ENTITY[String(header.ObjType)]].header)} SET "DocTotal" = $2, "DocTotalSy" = $2 WHERE "DocEntry" = $1`,
      [header.DocEntry, header.DocTotal]);
    lines.forEach((line) => Object.assign(line, { LineStatus: 'C', OpenQty: 0, OpenSum: 0 }));
  }
};

// A posted document keeps its stock and journal: SAP only lets non-financial
// fields (remarks, references, UDFs...) change after posting.
const assertPostingUnchanged = (existing, header, before, after) => {
  const same = (a, b) => Math.abs(toNumber(a) - toNumber(b)) < 1e-6;
  const day = (value) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
  const changed = !same(existing.DocTotal, header.DocTotal) || day(existing.DocDate) !== day(header.DocDate)
    || existing.DocCur !== header.DocCur || before.length !== after.length
    || before.some((line, i) => line.ItemCode !== after[i].ItemCode || line.WhsCode !== after[i].WhsCode || (line.TaxCode || '') !== (after[i].TaxCode || '')
      || !same(line.Quantity, after[i].Quantity) || !same(line.LineTotal, after[i].LineTotal) || !same(line.VatSum, after[i].VatSum));
  if (changed) {
    throw slError(400, 'A posted document cannot change its items, quantities, prices, warehouses, taxes, totals or posting date. Create a credit memo or return instead.');
  }
};

// ---- document operations --------------------------------------------------------

const readDocument = async (client, schema, entity, docEntry) => {
  const definition = DOCUMENTS[entity];
  const header = (await client.query(`SELECT * FROM ${quote(definition.header)} WHERE "DocEntry" = $1`, [docEntry])).rows[0];
  if (!header) throw slError(404, `No matching records found (${entity} ${docEntry}).`);
  const lines = (await client.query(
    `SELECT * FROM ${quote(definition.lines)} WHERE "DocEntry" = $1 ORDER BY "VisOrder", "LineNum"`, [docEntry],
  )).rows;
  const expenses = definition.expenses ? (await client.query(
    `SELECT * FROM ${quote(definition.expenses)} WHERE "DocEntry" = $1 ORDER BY "LineNum"`, [docEntry],
  )).rows : [];
  return {
    ...fromRow(header, definition.linesKey ? REVERSE.transferHeader : REVERSE.header),
    BPLId: header.BPLId,
    [definition.linesKey || 'DocumentLines']: lines.map((line) => fromRow(line, REVERSE.lines)),
    DocumentAdditionalExpenses: expenses.map((expense) => fromRow(expense, REVERSE.expenses)),
  };
};

const logWrite = (client, { entity, objType, docEntry, method, payload, unmapped }) => client.query(
  `INSERT INTO "LocalSlLog" ("Entity", "ObjType", "DocEntry", "Method", "Payload", "Unmapped")
   VALUES ($1, $2, $3, $4, $5, $6)`,
  [entity, objType, docEntry, method, JSON.stringify(payload || {}), Object.keys(unmapped).length ? JSON.stringify(unmapped) : null],
);

const mapCollections = async (client, schema, definition, data) => {
  const lineColumns = await getColumns(client, schema, definition.lines);
  const expenseColumns = definition.expenses ? await getColumns(client, schema, definition.expenses) : new Set();
  const unmapped = {};
  const linesKey = definition.linesKey || 'DocumentLines';
  const lines = (data[linesKey] || []).map((source, index) => {
    const mapped = toRow(source, LINE_FIELDS, lineColumns);
    if (!hasValue(mapped.row.TaxCode) && hasValue(source.VatGroup)) mapped.row.TaxCode = source.VatGroup;
    delete mapped.unmapped.VatGroup;
    // Batch / serial rows travel with the line to stock posting (not table columns).
    if (Array.isArray(source.BatchNumbers)) mapped.row.batches = source.BatchNumbers;
    if (Array.isArray(source.SerialNumbers)) mapped.row.serials = source.SerialNumbers;
    delete mapped.unmapped.BatchNumbers;
    delete mapped.unmapped.SerialNumbers;
    if (Object.keys(mapped.unmapped).length) unmapped[`${linesKey}[${index}]`] = mapped.unmapped;
    return mapped.row;
  });
  const expenses = (data.DocumentAdditionalExpenses || []).map((source, index) => {
    const mapped = toRow(source, EXPENSE_FIELDS, expenseColumns);
    if (Object.keys(mapped.unmapped).length) unmapped[`DocumentAdditionalExpenses[${index}]`] = mapped.unmapped;
    return mapped.row;
  });
  return { lines, expenses, lineColumns, expenseColumns, unmapped };
};

const writeCollections = async (client, definition, docEntry, lines, expenses, lineColumns, expenseColumns) => {
  for (const line of lines) await insertRow(client, definition.lines, lineColumns, { ...line, DocEntry: docEntry });
  if (definition.expenses) {
    for (const expense of expenses) await insertRow(client, definition.expenses, expenseColumns, { ...expense, DocEntry: docEntry });
  } else if (expenses.length) {
    throw slError(400, 'This document type does not take freight or additional expenses.');
  }
};

const createDocument = async (schema, entity, data = {}) => withTransaction(schema, async (client) => {
  if (entity === 'InventoryGenEntries') await backflushForReceipt(client, schema, data);
  return createDocumentIn(client, schema, entity, data);
});

const createDocumentIn = async (client, schema, entity, data = {}) => {
  const definition = DOCUMENTS[entity];
  const company = await getCompany(client);
  const headerColumns = await getColumns(client, schema, definition.header);
  const { row: header, unmapped } = toRow(data, headerFieldsOf(definition), headerColumns);
  const collections = await mapCollections(client, schema, definition, data);
  Object.assign(unmapped, collections.unmapped);
  const { lines, expenses } = collections;
  if (!lines.length) throw slError(400, 'Add at least one row to the document.');

  header.DocDate = hasValue(header.DocDate) ? header.DocDate : localToday();
  header.DocDueDate = hasValue(header.DocDueDate) ? header.DocDueDate : header.DocDate;
  header.TaxDate = hasValue(header.TaxDate) ? header.TaxDate : header.DocDate;
  if (!hasValue(header.DocSubType)) header.DocSubType = '--';
  const period = await getPostingPeriod(client, header.DocDate, header);
  await applyMasterDefaults(client, entity, header, lines, company);

  Object.assign(header, await assignDocNum(client, {
    table: definition.header,
    objType: definition.objType,
    subType: header.DocSubType,
    series: header.Series,
    manualDocNum: data.HandWritten === 'tYES' && hasValue(data.DocNum) ? toNumber(data.DocNum) : null,
    period,
  }));

  lines.forEach((line, index) => {
    line.LineNum = index;
    line.VisOrder = index;
    line.LineStatus = 'O';
  });
  expenses.forEach((expense, index) => { expense.LineNum = index; });
  header.ObjType = definition.objType;
  await computeTotals(client, header, lines, expenses, company);
  for (const [index, line] of lines.entries()) await applyUserFields(client, definition.lines, line, [], `Row ${index + 1}`);
  await applyUserFields(client, definition.header, header, lines);
  lines.forEach((line) => { line.OpenQty = line.Quantity; line.OpenSum = line.LineTotal; });

  delete header.DocEntry;
  Object.assign(header, { ObjType: definition.objType, DocStatus: 'O', CANCELED: 'N' });
  const saved = await insertRow(client, definition.header, headerColumns, header);
  if (isPosting(definition.objType)) {
    await postDocument(client, schema, { header: { ...header, DocEntry: saved.DocEntry }, lines, expenses, company, period });
  }
  await writeCollections(client, definition, saved.DocEntry, lines, expenses, collections.lineColumns, collections.expenseColumns);
  await refreshBaseLines(client, definition.objType, lines);
  await refreshProductionOrders(client, lines);
  await refreshOrdered(client, lines);
  await logWrite(client, { entity, objType: definition.objType, docEntry: saved.DocEntry, method: 'POST', payload: data, unmapped });
  return readDocument(client, schema, entity, saved.DocEntry);
};

// SL PATCH semantics: header fields overwrite; a line with a LineNum updates that
// line, a line without one is added; lines left out are kept.
const updateDocument = async (schema, entity, docEntry, data = {}) => withTransaction(schema, async (client) => {
  const definition = DOCUMENTS[entity];
  const company = await getCompany(client);
  const headerColumns = await getColumns(client, schema, definition.header);
  const existing = (await client.query(
    `SELECT * FROM ${quote(definition.header)} WHERE "DocEntry" = $1 FOR UPDATE`, [docEntry],
  )).rows[0];
  if (!existing) throw slError(404, `No matching records found (${entity} ${docEntry}).`);
  if (existing.CANCELED === 'Y' || existing.DocStatus === 'C') throw slError(400, 'Closed or cancelled documents cannot be updated.');

  const { row: patch, unmapped } = toRow(data, headerFieldsOf(definition), headerColumns);
  ['DocEntry', 'DocNum', 'Series', 'ObjType', 'DocStatus', 'CANCELED'].forEach((column) => delete patch[column]);
  const header = { ...existing, ...patch };
  if (hasValue(patch.DiscSum) && !hasValue(patch.DiscPrcnt)) delete header.DiscPrcnt;
  if (patch.CardCode && patch.CardCode !== existing.CardCode) {
    throw slError(400, 'The business partner of an existing document cannot be changed.');
  }

  const collections = await mapCollections(client, schema, definition, data);
  Object.assign(unmapped, collections.unmapped);
  const currentLines = (await client.query(
    `SELECT * FROM ${quote(definition.lines)} WHERE "DocEntry" = $1 ORDER BY "LineNum"`, [docEntry],
  )).rows;
  const lines = currentLines.map((line) => ({ ...line }));
  let nextLineNum = Math.max(-1, ...lines.map((line) => line.LineNum)) + 1;
  const posted = isPosting(definition.objType);
  if (posted && collections.lines.some((change) => !hasValue(change.LineNum))) {
    throw slError(400, 'Rows cannot be added to a posted document.');
  }
  for (const change of collections.lines) {
    const target = hasValue(change.LineNum) ? lines.find((line) => line.LineNum === Number(change.LineNum)) : null;
    if (hasValue(change.LineNum) && !target) throw slError(400, `Row with LineNum ${change.LineNum} does not exist.`);
    if (target) {
      if (target.LineStatus === 'C') throw slError(400, `Row ${target.LineNum + 1} is closed and cannot be changed.`);
      const delivered = toNumber(target.Quantity) - toNumber(target.OpenQty);
      const linked = baseOf(target) && baseKey(baseOf(target));
      Object.assign(target, change, { LineNum: target.LineNum });
      if (linked !== (baseOf(target) && baseKey(baseOf(target)))) throw slError(400, `Row ${target.LineNum + 1}: the base document of a row cannot be changed.`);
      target.OpenQty = toNumber(target.Quantity) - delivered;
      if (target.OpenQty < 0) throw slError(400, `Row ${target.LineNum + 1}: quantity is below what was already copied to a target document.`);
    } else {
      lines.push({ ...change, LineNum: nextLineNum, VisOrder: nextLineNum, LineStatus: 'O', OpenQty: toNumber(change.Quantity, 1) });
      nextLineNum += 1;
    }
  }

  let expenses = definition.expenses ? (await client.query(
    `SELECT * FROM ${quote(definition.expenses)} WHERE "DocEntry" = $1 ORDER BY "LineNum"`, [docEntry],
  )).rows : [];
  if (data.DocumentAdditionalExpenses) {
    expenses = collections.expenses.map((expense, index) => ({ ...expense, LineNum: index }));
  }

  await getPostingPeriod(client, header.DocDate, header);
  await applyMasterDefaults(client, entity, header, lines, company, currentLines);
  // Posted inventory rows hold their cost valuation, not a price to recompute; rows cannot change anyway.
  if (!(posted && definition.inventory)) await computeTotals(client, header, lines, expenses, company);
  if (posted) assertPostingUnchanged(existing, header, currentLines, lines);
  for (const [index, line] of lines.entries()) await applyUserFields(client, definition.lines, line, [], `Row ${index + 1}`);
  await applyUserFields(client, definition.header, header, lines);
  lines.forEach((line) => { line.OpenSum = roundTo(toNumber(line.OpenQty) * toNumber(line.Price) * (toNumber(line.Rate, 1) || 1), toNumber(company.SumDec, 2)); });
  header.UpdateDate = localToday();

  const columns = Object.keys(header).filter((key) => headerColumns.has(key) && key !== 'DocEntry');
  await client.query(
    `UPDATE ${quote(definition.header)} SET ${columns.map((column, i) => `${quote(column)} = $${i + 2}`).join(', ')} WHERE "DocEntry" = $1`,
    [docEntry, ...columns.map((column) => header[column])],
  );
  // Rewriting the collections keeps one code path for totals; line identity is (DocEntry, LineNum).
  await client.query(`DELETE FROM ${quote(definition.lines)} WHERE "DocEntry" = $1`, [docEntry]);
  if (definition.expenses) await client.query(`DELETE FROM ${quote(definition.expenses)} WHERE "DocEntry" = $1`, [docEntry]);
  await writeCollections(client, definition, docEntry, lines, expenses, collections.lineColumns, collections.expenseColumns);
  if (!posted) {
    await refreshBaseLines(client, definition.objType, [...currentLines, ...lines]);
    await refreshOrdered(client, [...currentLines, ...lines]);
  }
  await logWrite(client, { entity, objType: definition.objType, docEntry, method: 'PATCH', payload: data, unmapped });
});

// Posting documents SAP lets you close without invoicing (nothing is reversed).
const CLOSABLE_POSTING_DOCUMENTS = new Set(['DeliveryNotes', 'PurchaseDeliveryNotes']);

const setDocumentStatus = async (schema, entity, docEntry, action) => withTransaction(schema, async (client) => {
  if (!STATUS_ONLY_DOCUMENTS.has(entity) && !(action === 'Close' && CLOSABLE_POSTING_DOCUMENTS.has(entity))) {
    throw slError(400, `${action} is not available for this document.`);
  }
  const definition = DOCUMENTS[entity];
  const existing = (await client.query(
    `SELECT "DocStatus", "CANCELED" FROM ${quote(definition.header)} WHERE "DocEntry" = $1 FOR UPDATE`, [docEntry],
  )).rows[0];
  if (!existing) throw slError(404, `No matching records found (${entity} ${docEntry}).`);
  if (existing.DocStatus === 'C') throw slError(400, 'The document is already closed or cancelled.');
  const copied = (await client.query(
    `SELECT 1 FROM ${quote(definition.lines)} WHERE "DocEntry" = $1 AND "OpenQty" < "Quantity" LIMIT 1`, [docEntry],
  )).rowCount > 0;
  if (action === 'Cancel' && copied) throw slError(400, 'Documents already copied to a target document cannot be cancelled; close them instead.');
  await client.query(
    `UPDATE ${quote(definition.header)} SET "DocStatus" = 'C', "CANCELED" = $2, "UpdateDate" = CURRENT_DATE WHERE "DocEntry" = $1`,
    [docEntry, action === 'Cancel' ? 'Y' : 'N'],
  );
  await client.query(`UPDATE ${quote(definition.lines)} SET "LineStatus" = 'C' WHERE "DocEntry" = $1`, [docEntry]);
  const lines = (await client.query(`SELECT * FROM ${quote(definition.lines)} WHERE "DocEntry" = $1`, [docEntry])).rows;
  // A cancelled copy gives its quantity back to the base document; closing keeps it consumed.
  if (action === 'Cancel') await refreshBaseLines(client, definition.objType, lines);
  await refreshOrdered(client, lines);
  await logWrite(client, { entity, objType: definition.objType, docEntry, method: `POST ${action}`, payload: {}, unmapped: {} });
});

// ---- cancellation of posted documents ----------------------------------------------

// Puts back every stock movement of a document at its original value (SAP
// cancellation): goods out return at the cost they left with, goods in leave at
// the value they came in with; the moving average is recomputed. Refused when
// stock received by the document has since been used.
const reverseStock = async (client, { objType, originalEntry, cancelEntry, header, company }) => {
  const sumDec = toNumber(company.SumDec, 2);
  const moves = (await client.query(
    'SELECT * FROM "OINM" WHERE "TransType" = $1 AND "CreatedBy" = $2 ORDER BY "TransNum"', [Number(objType), originalEntry],
  )).rows;
  if (!moves.length) return;
  await reverseBatchesAndSerials(client, { objType, originalEntry, cancelEntry, docDate: header.DocDate });
  const codes = [...new Set(moves.map((move) => move.ItemCode))].sort();
  const items = new Map((await client.query(
    'SELECT "ItemCode", "OnHand", "AvgPrice" FROM "OITM" WHERE "ItemCode" = ANY($1) ORDER BY "ItemCode" FOR UPDATE', [codes],
  )).rows.map((item) => [item.ItemCode, item]));
  for (const move of moves) {
    const received = toNumber(move.InQty) - toNumber(move.OutQty);
    const stock = (await client.query(
      'SELECT "OnHand" FROM "OITW" WHERE "ItemCode" = $1 AND "WhsCode" = $2 FOR UPDATE', [move.ItemCode, move.Warehouse],
    )).rows[0];
    if (received > 0 && toNumber(stock?.OnHand) < received) {
      throw slError(400, `Cannot cancel: item "${move.ItemCode}" would fall into negative inventory in warehouse ${move.Warehouse}.`);
    }
    const item = items.get(move.ItemCode);
    const onHand = toNumber(item.OnHand);
    const average = toNumber(item.AvgPrice);
    const newOnHand = onHand - received;
    const newAverage = newOnHand > 0 ? Math.max(0, (onHand * average - toNumber(move.TransValue)) / newOnHand) : average;
    await client.query('UPDATE "OITW" SET "OnHand" = "OnHand" - $3 WHERE "ItemCode" = $1 AND "WhsCode" = $2', [move.ItemCode, move.Warehouse, received]);
    await client.query('UPDATE "OITM" SET "OnHand" = $2, "AvgPrice" = $3 WHERE "ItemCode" = $1', [move.ItemCode, newOnHand, newAverage]);
    await client.query('UPDATE "OITW" SET "AvgPrice" = $2 WHERE "ItemCode" = $1', [move.ItemCode, newAverage]);
    Object.assign(item, { OnHand: newOnHand, AvgPrice: newAverage });
    await client.query(
      `INSERT INTO "OINM" ("TransType", "CreatedBy", "DocLineNum", "DocDate", "ItemCode", "Dscription", "Warehouse",
         "InQty", "OutQty", "Price", "TransValue", "CalcPrice", "CardCode", "BASE_REF", "Currency", "Balance")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $12, $13, $14, $15)`,
      [Number(objType), cancelEntry, move.DocLineNum, header.DocDate, move.ItemCode, move.Dscription, move.Warehouse,
        move.OutQty, move.InQty, move.Price, -toNumber(move.TransValue), move.CardCode, String(header.DocNum), move.Currency,
        roundTo(newOnHand * newAverage, sumDec)],
    );
  }
};

// Reverses a journal entry (debits and credits swapped, linked by StornoToTr);
// both entries are fully reconciled with each other, and BP balances move back.
const reverseJournal = async (client, schema, transId, j) => {
  if (!transId) return null;
  const lines = (await client.query('SELECT * FROM "JDT1" WHERE "TransId" = $1 ORDER BY "Line_ID"', [transId])).rows;
  const original = (await client.query('SELECT "Memo" FROM "OJDT" WHERE "TransId" = $1', [transId])).rows[0];
  await client.query(`UPDATE "JDT1" SET "BalDueDeb" = 0, "BalDueCred" = 0, "BalScDeb" = 0, "BalScCred" = 0, "BalFcDeb" = 0, "BalFcCred" = 0
    WHERE "TransId" = $1`, [transId]);
  const rows = lines.map((line) => ({
    account: line.Account, amount: toNumber(line.Credit) - toNumber(line.Debit), ShortName: line.ShortName, bp: line.ShortName !== line.Account,
    LineMemo: line.LineMemo, ProfitCode: line.ProfitCode, OcrCode2: line.OcrCode2, OcrCode3: line.OcrCode3, OcrCode4: line.OcrCode4,
    OcrCode5: line.OcrCode5, Project: line.Project, DueDate: line.DueDate, balDue: 0, fcAmount: toNumber(line.FCDebit) + toNumber(line.FCCredit), fcCurrency: line.FCCurrency,
  }));
  return writeJournal(client, schema, { ...j, rows, memo: `Cancellation - ${original?.Memo || ''}`.trim(), stornoTo: transId });
};

const targetsOf = (objType) => Object.entries(BASE_OBJECTS).filter(([, bases]) => bases.includes(String(objType)))
  .map(([target]) => DOCUMENTS[OBJECT_ENTITY[target]]);

// SAP cancellation of a posted document: refused while a target document or a
// payment uses it; otherwise a cancellation document (CANCELED 'C', same series,
// original posting date) reverses its stock and journal entry, the original is
// marked cancelled and its base documents reopen.
const cancelDocument = async (schema, entity, docEntry) => withTransaction(schema, async (client) => {
  const definition = DOCUMENTS[entity];
  const company = await getCompany(client);
  const original = (await client.query(`SELECT * FROM ${quote(definition.header)} WHERE "DocEntry" = $1 FOR UPDATE`, [docEntry])).rows[0];
  if (!original) throw slError(404, `No matching records found (${entity} ${docEntry}).`);
  if (original.CANCELED === 'C') throw slError(400, 'A cancellation document cannot be cancelled.');
  if (original.CANCELED === 'Y') throw slError(400, 'The document is already cancelled.');
  for (const target of targetsOf(definition.objType)) {
    const copied = (await client.query(
      `SELECT h."DocNum" FROM ${quote(target.lines)} l JOIN ${quote(target.header)} h ON h."DocEntry" = l."DocEntry"
       WHERE h."CANCELED" = 'N' AND l."BaseType" = $1 AND l."BaseEntry" = $2 LIMIT 1`, [Number(definition.objType), docEntry],
    )).rows[0];
    if (copied) throw slError(400, `The document was copied to a target document (${copied.DocNum}); cancel that document first.`);
  }
  if (toNumber(original.PaidToDate) > 0.005) throw slError(400, 'The document is paid or reconciled; cancel the payments first.');

  const period = await getPostingPeriod(client, original.DocDate);
  const lines = (await client.query(`SELECT * FROM ${quote(definition.lines)} WHERE "DocEntry" = $1 ORDER BY "LineNum"`, [docEntry])).rows;
  const expenses = definition.expenses
    ? (await client.query(`SELECT * FROM ${quote(definition.expenses)} WHERE "DocEntry" = $1 ORDER BY "LineNum"`, [docEntry])).rows : [];
  const numbering = await assignDocNum(client, {
    table: definition.header, objType: definition.objType, subType: original.DocSubType || '--', series: original.Series, manualDocNum: null, period,
  });
  const headerColumns = await getColumns(client, schema, definition.header);
  const cancellation = { ...original, ...numbering, CANCELED: 'C', DocStatus: 'C', TransId: null, PaidToDate: 0, CreateDate: localToday(), UpdateDate: null };
  delete cancellation.DocEntry;
  const saved = await insertRow(client, definition.header, headerColumns, cancellation);
  const cancelLines = lines.map((line) => ({
    ...line, LineStatus: 'C', OpenQty: 0, OpenSum: 0, BaseType: Number(definition.objType), BaseEntry: docEntry, BaseLine: line.LineNum,
  }));
  await writeCollections(client, definition, saved.DocEntry, cancelLines, expenses,
    await getColumns(client, schema, definition.lines), definition.expenses ? await getColumns(client, schema, definition.expenses) : new Set());

  const header = { ...cancellation, DocEntry: saved.DocEntry };
  if (isPosting(definition.objType)) {
    await reverseStock(client, { objType: definition.objType, originalEntry: docEntry, cancelEntry: saved.DocEntry, header, company });
    const journal = await reverseJournal(client, schema, original.TransId, {
      objType: definition.objType, period, company, refDate: original.DocDate, dueDate: original.DocDueDate, taxDate: original.TaxDate,
      baseRef: String(header.DocNum), ref1: String(header.DocNum), ref2: original.NumAtCard || null, createdBy: saved.DocEntry, bplId: original.BPLId,
    });
    if (journal) await client.query(`UPDATE ${quote(definition.header)} SET "TransId" = $2 WHERE "DocEntry" = $1`, [saved.DocEntry, journal.TransId]);
  }
  await client.query(`UPDATE ${quote(definition.header)} SET "CANCELED" = 'Y', "DocStatus" = 'C', "UpdateDate" = CURRENT_DATE WHERE "DocEntry" = $1`, [docEntry]);
  await client.query(`UPDATE ${quote(definition.lines)} SET "LineStatus" = 'C' WHERE "DocEntry" = $1`, [docEntry]);
  await refreshBaseLines(client, definition.objType, lines);
  await refreshProductionOrders(client, lines);
  await refreshOrdered(client, lines);
  await logWrite(client, { entity, objType: definition.objType, docEntry, method: 'POST Cancel', payload: { cancellation: saved.DocEntry }, unmapped: {} });
  return { DocEntry: saved.DocEntry, DocNum: header.DocNum };
});

// ---- payments and manual journal entries (Phase 4) ---------------------------------

const PAYMENTS = {
  IncomingPayments: { header: 'ORCT', checks: 'RCT1', invoices: 'RCT2', cards: 'RCT3', accounts: 'RCT4', objType: '24', side: 1, memo: 'Incoming Payments' },
  VendorPayments: { header: 'OVPM', checks: 'VPM1', invoices: 'VPM2', cards: 'VPM3', accounts: 'VPM4', objType: '46', side: -1, memo: 'Outgoing Payments' },
};
// SL InvoiceType -> paid document and the side its BP row sits on (+1 debit, -1 credit).
// Journal entries (and opening balances) are matched by their open BP row instead.
const PAID_DOCUMENTS = {
  it_Invoice: { type: 13, table: 'OINV', direction: 1 },
  it_CredItnote: { type: 14, table: 'ORIN', direction: -1 },
  it_PurchaseInvoice: { type: 18, table: 'OPCH', direction: -1 },
  it_PurchaseCreditNote: { type: 19, table: 'ORPC', direction: 1 },
  it_JournalEntry: { type: 30 },
  it_OpeningBalance: { type: -2 },
};
const PAYMENT_DOC_TYPE = { rCustomer: 'C', rSupplier: 'S', rAccount: 'A' };

// Lowers the open (unreconciled) amount of a business partner's journal row.
const reduceOpenRow = (client, transId, lineId, amount) => client.query(
  `UPDATE "JDT1" SET
     "BalDueDeb" = GREATEST("BalDueDeb" - $3, 0), "BalScDeb" = GREATEST("BalScDeb" - $3, 0),
     "BalDueCred" = GREATEST("BalDueCred" - $3, 0), "BalScCred" = GREATEST("BalScCred" - $3, 0)
   WHERE "TransId" = $1 AND "Line_ID" = $2`, [transId, lineId, amount],
);

// SAP payment: the payment means (cash, transfer, checks, cards) must equal the
// total; a BP payment settles the selected documents and leaves the rest on
// account, an account payment posts to the G/L rows. One journal entry:
// incoming = means debit / BP or accounts credit, outgoing the reverse.
const createPayment = async (schema, entity, data = {}) => withTransaction(schema, async (client) => {
  const definition = PAYMENTS[entity];
  const { side } = definition;
  const company = await getCompany(client);
  const sumDec = toNumber(company.SumDec, 2);
  const docType = PAYMENT_DOC_TYPE[data.DocType || (side > 0 ? 'rCustomer' : 'rSupplier')];
  if (!docType) throw slError(400, `Unknown payment type "${data.DocType}".`);
  if (hasValue(data.DocCurrency) && data.DocCurrency !== company.MainCurncy) {
    // ponytail: local currency only; foreign payments need exchange-rate differences on reconciliation.
    throw slError(400, `Payments in ${data.DocCurrency} are not supported yet; pay in ${company.MainCurncy}.`);
  }
  const docDate = hasValue(data.DocDate) ? data.DocDate : localToday();
  const dates = { DocDueDate: data.DueDate ?? null, TaxDate: data.TaxDate ?? null };
  const period = await getPostingPeriod(client, docDate, dates);

  // Payment means.
  const money = (value) => roundTo(toNumber(value), sumDec);
  const means = [];
  if (money(data.CashSum)) means.push({ account: data.CashAccount, amount: money(data.CashSum), label: 'cash' });
  if (money(data.TransferSum)) means.push({ account: data.TransferAccount, amount: money(data.TransferSum), label: 'bank transfer' });
  const checks = (data.PaymentChecks || []).filter((check) => money(check.CheckSum));
  const cards = (data.PaymentCreditCards || []).filter((card) => money(card.CreditSum));
  checks.forEach((check) => means.push({ account: check.CheckAccount, amount: money(check.CheckSum), label: 'check' }));
  cards.forEach((card) => means.push({ account: card.CreditAcct, amount: money(card.CreditSum), label: 'credit card' }));
  if (means.some((mean) => mean.amount < 0)) throw slError(400, 'Payment means amounts cannot be negative.');
  const missing = means.find((mean) => !hasValue(mean.account));
  if (missing) throw slError(400, `Select the G/L account for the ${missing.label} payment.`);
  const total = roundTo(means.reduce((sum, mean) => sum + mean.amount, 0), sumDec);
  if (!(total > 0)) throw slError(400, 'Enter the payment means; the payment total must be greater than zero.');

  // Business partner or G/L accounts.
  let bp = null;
  if (docType !== 'A') {
    bp = (await client.query(
      'SELECT "CardCode", "CardName", "CardType", "DebPayAcct", "validFor", "frozenFor" FROM "OCRD" WHERE "CardCode" = $1', [data.CardCode],
    )).rows[0];
    if (!bp) throw slError(400, `Business partner "${data.CardCode ?? ''}" does not exist.`);
    if (bp.frozenFor === 'Y' || bp.validFor === 'N') throw slError(400, `Business partner "${bp.CardCode}" is inactive.`);
    if ((docType === 'S') !== (bp.CardType === 'S')) throw slError(400, `"${bp.CardCode}" is not a ${docType === 'S' ? 'vendor' : 'customer'}.`);
  }
  const accountRows = docType === 'A' ? (data.PaymentAccounts || []).filter((row) => money(row.SumPaid)) : [];
  if (docType === 'A' && !accountRows.length) throw slError(400, 'Add at least one G/L account row to the payment.');
  if (docType === 'A' && roundTo(accountRows.reduce((sum, row) => sum + money(row.SumPaid), 0), sumDec) !== total) {
    throw slError(400, 'The G/L account rows must add up to the payment total.');
  }

  // Settled documents: lock each, check it belongs to the BP and is still open by that much.
  const settled = [];
  for (const [index, invoice] of (data.PaymentInvoices || []).entries()) {
    const row = `Document row ${index + 1}`;
    const paid = PAID_DOCUMENTS[invoice.InvoiceType || (side > 0 ? 'it_Invoice' : 'it_PurchaseInvoice')];
    if (!paid) throw slError(400, `${row}: invoice type "${invoice.InvoiceType}" cannot be paid.`);
    if (docType === 'A') throw slError(400, 'An account payment cannot settle documents.');
    const amount = money(Math.abs(toNumber(invoice.SumApplied)));
    const discountPercent = toNumber(invoice.DiscountPercent);
    if (!amount) continue;
    if (discountPercent && (!paid.table || paid.direction * side < 0)) throw slError(400, `${row}: a cash discount applies to invoices only.`);
    if (discountPercent < 0 || discountPercent >= 100) throw slError(400, `${row}: enter a cash discount between 0 and 100%.`);
    let target;
    if (paid.table) {
      const doc = (await client.query(
        `SELECT "DocEntry", "DocNum", "CardCode", "CANCELED", "DocTotal", "PaidToDate", "TransId", "DocCur", "DocDate", "TaxDate", "GroupNum"
         FROM ${quote(paid.table)} WHERE "DocEntry" = $1 FOR UPDATE`,
        [Number(invoice.DocEntry)],
      )).rows[0];
      if (!doc || doc.CANCELED === 'Y') throw slError(400, `${row}: document ${invoice.DocEntry} does not exist or is cancelled.`);
      if (doc.CardCode !== bp.CardCode) throw slError(400, `${row}: document ${doc.DocNum} belongs to another business partner.`);
      if (hasValue(doc.DocCur) && doc.DocCur !== company.MainCurncy) throw slError(400, `${row}: document ${doc.DocNum} is in ${doc.DocCur}; foreign currency payments are not supported yet.`);
      const open = roundTo(toNumber(doc.DocTotal) - toNumber(doc.PaidToDate), sumDec);
      if (discountPercent) {
        // SAP: the discount the payment terms allow for the days since the base date (smallest tier still reached).
        const terms = (await client.query(
          `SELECT c."BaseDate", (SELECT d."Discount" FROM "CDC1" d WHERE d."CdcCode" = c."Code"
             AND d."NumOfDays" >= ($2::date - (CASE WHEN c."BaseDate" = 'T' THEN $4::date ELSE $3::date END)) ORDER BY d."NumOfDays" LIMIT 1) AS "Allowed"
           FROM "OCTG" t JOIN "OCDC" c ON c."Code" = t."DiscCode"
           WHERE t."GroupNum" = COALESCE($1, (SELECT "GroupNum" FROM "OCRD" WHERE "CardCode" = $5))`,
          [doc.GroupNum, docDate, doc.DocDate, doc.TaxDate || doc.DocDate, bp.CardCode],
        )).rows[0];
        if (discountPercent > toNumber(terms?.Allowed) + 1e-9) {
          throw slError(400, `${row}: document ${doc.DocNum} allows a cash discount of ${toNumber(terms?.Allowed)}% on ${docDate}.`);
        }
      }
      // What the payment clears on the document: the amount paid plus the discount taken.
      const discount = discountPercent ? money(amount * discountPercent / (100 - discountPercent)) : 0;
      if (amount + discount > open + 0.005) throw slError(400, `${row}: ${roundTo(amount + discount, sumDec)} is more than the ${open} still open on document ${doc.DocNum}.`);
      const bpLine = doc.TransId && (await client.query(
        'SELECT "Line_ID" FROM "JDT1" WHERE "TransId" = $1 AND "ShortName" = $2 ORDER BY "Line_ID" LIMIT 1 FOR UPDATE', [doc.TransId, bp.CardCode],
      )).rows[0];
      target = { ...paid, doc, open, discount, transId: doc.TransId, lineId: bpLine?.Line_ID, direction: paid.direction };
    } else {
      const line = (await client.query(
        `SELECT "TransId", "Line_ID", "BalDueDeb", "BalDueCred" FROM "JDT1"
         WHERE "TransId" = $1 AND "ShortName" = $2 AND ("BalDueDeb" > 0 OR "BalDueCred" > 0)
         ORDER BY "Line_ID" LIMIT 1 FOR UPDATE`, [Number(invoice.DocEntry), bp.CardCode],
      )).rows[0];
      if (!line) throw slError(400, `${row}: journal entry ${invoice.DocEntry} has nothing open for "${bp.CardCode}".`);
      const open = roundTo(toNumber(line.BalDueDeb) + toNumber(line.BalDueCred), sumDec);
      if (amount > open) throw slError(400, `${row}: ${amount} is more than the ${open} still open on journal entry ${invoice.DocEntry}.`);
      target = { ...paid, discount: 0, transId: line.TransId, lineId: line.Line_ID, direction: toNumber(line.BalDueDeb) > 0 ? 1 : -1 };
    }
    // An incoming payment settles BP debits (+) and uses up BP credits (-); outgoing the reverse.
    settled.push({ ...target, amount, signed: amount * target.direction * side, invoice });
  }
  const applied = roundTo(settled.reduce((sum, item) => sum + item.signed, 0), sumDec);
  const onAccount = docType === 'A' ? 0 : roundTo(total - applied, sumDec);
  if (onAccount < 0) throw slError(400, `The selected documents (${applied}) exceed the payment total (${total}).`);
  const discountTotal = roundTo(settled.reduce((sum, item) => sum + item.discount, 0), sumDec);

  const accounts = await accountResolver(client, period);
  const controlAccount = docType === 'A' ? null : (hasValue(data.ControlAccount) ? data.ControlAccount : await accounts.bpAccount(bp.CardCode, docType === 'C'));
  // Cash discount granted to customers is an expense; taken from vendors, income (G/L Account Determination).
  const discountAccount = discountTotal ? accounts.acp[docType === 'S' ? 'CashDscAP' : 'CashDscAR'] : null;
  if (discountTotal && !hasValue(discountAccount)) throw slError(400, `Define the ${docType === 'S' ? 'purchasing' : 'sales'} cash discount account in G/L Account Determination.`);
  await validateAccounts(client, [...means.map((mean) => mean.account), controlAccount, discountAccount, ...accountRows.map((r) => r.AccountCode)]);

  // Header and number.
  const Series = hasValue(data.Series) ? Number(data.Series) : null;
  const numbering = await assignDocNum(client, {
    table: definition.header, objType: definition.objType, subType: '--', series: Series,
    manualDocNum: Series === null && hasValue(data.DocNum) ? toNumber(data.DocNum) : null, period,
  });
  const headerColumns = await getColumns(client, schema, definition.header);
  const header = {
    ...numbering, DocType: docType, ObjType: definition.objType, DocDate: docDate, DocDueDate: data.DueDate || docDate,
    TaxDate: data.TaxDate || docDate, CardCode: bp?.CardCode ?? null, CardName: bp?.CardName ?? null,
    Address: data.Address ?? null, CounterRef: data.CounterReference ?? null, BPLId: data.BPLID ?? data.BPL_IDAssignedToInvoice ?? null,
    JrnlMemo: data.JournalRemarks || [definition.memo, bp?.CardCode].filter(hasValue).join(' - '), Comments: data.Remarks ?? null,
    DocTotal: total, NoDocSum: onAccount, PayNoDoc: onAccount > 0 ? 'Y' : 'N', Canceled: 'N', DocCurr: company.MainCurncy, DocRate: 1,
    CashAcct: data.CashAccount ?? null, CashSum: money(data.CashSum), TrsfrAcct: data.TransferAccount ?? null, TrsfrSum: money(data.TransferSum),
    TrsfrDate: data.TransferDate ?? null, TrsfrRef: data.TransferReference ?? null, CheckAcct: checks[0]?.CheckAccount ?? null,
    CheckSum: roundTo(checks.reduce((sum, check) => sum + money(check.CheckSum), 0), sumDec),
    CreditSum: roundTo(cards.reduce((sum, card) => sum + money(card.CreditSum), 0), sumDec), BpAct: controlAccount,
  };
  const saved = await insertRow(client, definition.header, headerColumns, header);

  // Child rows.
  const insertChild = async (table, rows) => {
    const columns = await getColumns(client, schema, table);
    for (const row of rows) await insertRow(client, table, columns, { DocNum: saved.DocEntry, ...row });
  };
  await insertChild(definition.invoices, settled.map((item, index) => ({
    InvoiceId: index, DocEntry: item.doc ? item.doc.DocEntry : item.transId, InvType: item.type, DocLine: item.doc ? null : item.lineId,
    SumApplied: item.amount * (item.direction * side), DcntSum: item.discount, OcrCode: item.invoice.DistributionRule ?? null,
  })));
  await insertChild(definition.accounts, accountRows.map((row, index) => ({
    LineId: index, AcctCode: row.AccountCode, SumApplied: money(row.SumPaid), Descrip: row.Decription ?? row.Description ?? null,
    OcrCode: row.ProfitCenter ?? null, LocCode: row.LocationCode ?? null, Project: row.ProjectCode ?? null,
  })));
  await insertChild(definition.checks, checks.map((check, index) => ({
    LineID: index, DueDate: check.DueDate ?? docDate, CheckNum: check.CheckNumber ?? null, BankCode: check.BankCode ?? null,
    CountryCod: check.CountryCode ?? null, CheckSum: money(check.CheckSum), CheckAct: check.CheckAccount,
  })));
  await insertChild(definition.cards, cards.map((card, index) => ({
    LineID: index, CreditCard: card.CreditCard ?? null, CreditAcct: card.CreditAcct, CrCardNum: card.CreditCardNumber ?? null,
    CardValid: card.CardValidUntil ?? null, VoucherNum: card.VoucherNum ?? null, OwnerIdNum: card.OwnerIdNum ?? null,
    OwnerPhone: card.OwnerPhone ?? null, NumOfPmnts: card.NumOfPayments ?? 1, CreditSum: money(card.CreditSum),
  })));

  // Settle the documents and their open journal rows.
  for (const item of settled) {
    if (item.doc) {
      await client.query(
        `UPDATE ${quote(item.table)} SET "PaidToDate" = COALESCE("PaidToDate", 0) + $2,
           "DocStatus" = CASE WHEN "DocTotal" - COALESCE("PaidToDate", 0) - $2 <= 0.005 THEN 'C' ELSE "DocStatus" END
         WHERE "DocEntry" = $1`, [item.doc.DocEntry, item.amount + item.discount],
      );
    }
    if (item.transId && hasValue(item.lineId)) await reduceOpenRow(client, item.transId, item.lineId, item.amount + item.discount);
  }

  // Journal entry: means against the BP (only the on-account part stays open) or the G/L rows.
  const rows = means.map((mean) => ({ account: mean.account, amount: side * mean.amount }));
  if (docType === 'A') {
    accountRows.forEach((row) => rows.push({
      account: row.AccountCode, amount: -side * money(row.SumPaid), LineMemo: row.Decription ?? row.Description, ProfitCode: row.ProfitCenter, Project: row.ProjectCode,
    }));
  } else {
    if (discountTotal) rows.push({ account: discountAccount, amount: side * discountTotal, LineMemo: 'Cash discount' });
    rows.push({ account: controlAccount, amount: -side * (total + discountTotal), ShortName: bp.CardCode, bp: true, balDue: onAccount });
  }
  const journal = await writeJournal(client, schema, {
    rows, objType: definition.objType, period, company, memo: header.JrnlMemo, refDate: docDate, dueDate: header.DocDueDate,
    taxDate: header.TaxDate, baseRef: String(header.DocNum), ref1: String(header.DocNum), ref2: header.CounterRef,
    createdBy: saved.DocEntry, bplId: header.BPLId,
  });
  await client.query(`UPDATE ${quote(definition.header)} SET "TransId" = $2 WHERE "DocEntry" = $1`, [saved.DocEntry, journal.TransId]);
  await logWrite(client, { entity, objType: definition.objType, docEntry: saved.DocEntry, method: 'POST', payload: data, unmapped: {} });
  return readPayment(client, entity, saved.DocEntry);
});

// SAP payment cancellation: the settled documents and journal rows open again by
// what the payment applied, and its journal entry is reversed. Refused once the
// amount left on account has been reconciled elsewhere.
const cancelPayment = async (schema, entity, docEntry) => withTransaction(schema, async (client) => {
  const definition = PAYMENTS[entity];
  const company = await getCompany(client);
  const payment = (await client.query(`SELECT * FROM ${quote(definition.header)} WHERE "DocEntry" = $1 FOR UPDATE`, [docEntry])).rows[0];
  if (!payment) throw slError(404, `No matching records found (${entity} ${docEntry}).`);
  if (payment.Canceled === 'Y') throw slError(400, 'The payment is already cancelled.');
  const period = await getPostingPeriod(client, payment.DocDate);
  if (payment.TransId && toNumber(payment.NoDocSum) > 0) {
    const open = (await client.query(
      'SELECT COALESCE(SUM("BalDueDeb" + "BalDueCred"), 0) AS "Open" FROM "JDT1" WHERE "TransId" = $1 AND "ShortName" = $2', [payment.TransId, payment.CardCode],
    )).rows[0].Open;
    if (toNumber(open) + 0.005 < toNumber(payment.NoDocSum)) throw slError(400, 'The amount on account is reconciled; cancel that reconciliation first.');
  }
  const settled = (await client.query(`SELECT * FROM ${quote(definition.invoices)} WHERE "DocNum" = $1 ORDER BY "InvoiceId"`, [docEntry])).rows;
  for (const row of settled) {
    const amount = Math.abs(toNumber(row.SumApplied)) + toNumber(row.DcntSum);
    const paid = Object.values(PAID_DOCUMENTS).find((type) => type.type === Number(row.InvType));
    let transId = row.DocEntry;
    let lineId = row.DocLine;
    if (paid?.table) {
      const doc = (await client.query(`SELECT "DocEntry", "TransId", "CardCode" FROM ${quote(paid.table)} WHERE "DocEntry" = $1 FOR UPDATE`, [row.DocEntry])).rows[0];
      const lines = DOCUMENTS[OBJECT_ENTITY[String(paid.type)]].lines;
      await client.query(
        `UPDATE ${quote(paid.table)} SET "PaidToDate" = GREATEST(COALESCE("PaidToDate", 0) - $2, 0),
           "DocStatus" = CASE WHEN EXISTS (SELECT 1 FROM ${quote(lines)} WHERE "DocEntry" = $1 AND "LineStatus" = 'O') THEN 'O' ELSE "DocStatus" END
         WHERE "DocEntry" = $1`, [row.DocEntry, amount],
      );
      transId = doc.TransId;
      lineId = transId && (await client.query(
        'SELECT "Line_ID" FROM "JDT1" WHERE "TransId" = $1 AND "ShortName" = $2 ORDER BY "Line_ID" LIMIT 1', [transId, doc.CardCode],
      )).rows[0]?.Line_ID;
    }
    if (transId && hasValue(lineId)) {
      await client.query(
        `UPDATE "JDT1" SET
           "BalDueDeb" = "BalDueDeb" + CASE WHEN "Debit" > 0 THEN $3 ELSE 0 END, "BalScDeb" = "BalScDeb" + CASE WHEN "Debit" > 0 THEN $3 ELSE 0 END,
           "BalDueCred" = "BalDueCred" + CASE WHEN "Credit" > 0 THEN $3 ELSE 0 END, "BalScCred" = "BalScCred" + CASE WHEN "Credit" > 0 THEN $3 ELSE 0 END
         WHERE "TransId" = $1 AND "Line_ID" = $2`, [transId, lineId, amount],
      );
    }
  }
  const journal = await reverseJournal(client, schema, payment.TransId, {
    objType: definition.objType, period, company, refDate: payment.DocDate, dueDate: payment.DocDueDate || payment.DocDate,
    taxDate: payment.TaxDate || payment.DocDate, baseRef: String(payment.DocNum), ref1: String(payment.DocNum), ref2: payment.CounterRef,
    createdBy: payment.DocEntry, bplId: payment.BPLId,
  });
  await client.query(`UPDATE ${quote(definition.header)} SET "Canceled" = 'Y' WHERE "DocEntry" = $1`, [docEntry]);
  await logWrite(client, { entity, objType: definition.objType, docEntry, method: 'POST Cancel', payload: { reversal: journal?.TransId }, unmapped: {} });
});

const readPayment = async (client, entity, docEntry) => {
  const definition = PAYMENTS[entity];
  const header = (await client.query(`SELECT * FROM ${quote(definition.header)} WHERE "DocEntry" = $1`, [docEntry])).rows[0];
  if (!header) throw slError(404, `No matching records found (${entity} ${docEntry}).`);
  const rows = async (table) => (await client.query(`SELECT * FROM ${quote(table)} WHERE "DocNum" = $1 ORDER BY 2`, [docEntry])).rows;
  const typeName = Object.fromEntries(Object.entries(PAID_DOCUMENTS).map(([name, paid]) => [paid.type, name]));
  return {
    DocEntry: header.DocEntry, DocNum: header.DocNum, Series: header.Series, DocType: reverse(PAYMENT_DOC_TYPE)[header.DocType],
    DocDate: toSlValue('DocDate', header.DocDate), CardCode: header.CardCode, CardName: header.CardName, DocCurrency: header.DocCurr,
    CashAccount: header.CashAcct, CashSum: header.CashSum, TransferAccount: header.TrsfrAcct, TransferSum: header.TrsfrSum,
    CounterReference: header.CounterRef, Remarks: header.Comments, JournalRemarks: header.JrnlMemo, ControlAccount: header.BpAct,
    DocTotal: header.DocTotal, PaymentOnAccount: header.NoDocSum, TransId: header.TransId, Cancelled: header.Canceled === 'Y' ? 'tYES' : 'tNO',
    PaymentInvoices: (await rows(definition.invoices)).map((row) => ({
      LineNum: row.InvoiceId, DocEntry: row.DocEntry, InvoiceType: typeName[row.InvType] || `it_${row.InvType}`, SumApplied: row.SumApplied, DocLine: row.DocLine,
    })),
    PaymentAccounts: (await rows(definition.accounts)).map((row) => ({ LineNum: row.LineId, AccountCode: row.AcctCode, SumPaid: row.SumApplied, Decription: row.Descrip })),
    PaymentChecks: (await rows(definition.checks)).map((row) => ({ LineNum: row.LineID, CheckNumber: row.CheckNum, CheckSum: row.CheckSum, CheckAccount: row.CheckAct })),
    PaymentCreditCards: (await rows(definition.cards)).map((row) => ({ LineNum: row.LineID, CreditAcct: row.CreditAcct, CreditSum: row.CreditSum })),
  };
};

// Manual journal entry (SL JournalEntries): balanced rows on G/L accounts or
// business partners (a BP row posts to its control account and moves its balance).
const createJournalEntry = async (schema, data = {}) => withTransaction(schema, async (client) => {
  const company = await getCompany(client);
  const sumDec = toNumber(company.SumDec, 2);
  const refDate = hasValue(data.ReferenceDate) ? data.ReferenceDate : localToday();
  const period = await getPostingPeriod(client, refDate, { DocDueDate: data.DueDate ?? null, TaxDate: data.TaxDate ?? null });
  const source = data.JournalEntryLines || [];
  if (source.length < 2) throw slError(400, 'A journal entry needs at least two rows.');
  const accounts = await accountResolver(client, period);
  const rows = [];
  for (const [index, line] of source.entries()) {
    const row = `Row ${index + 1}`;
    const debit = roundTo(toNumber(line.Debit), sumDec);
    const credit = roundTo(toNumber(line.Credit), sumDec);
    if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) throw slError(400, `${row}: enter either a debit or a credit amount.`);
    const shortName = hasValue(line.ShortName) ? line.ShortName : line.AccountCode;
    if (!hasValue(shortName)) throw slError(400, `${row}: select a G/L account or business partner.`);
    // A short name that is not the G/L account itself is a business partner.
    const bp = shortName !== line.AccountCode ? (await client.query(
      'SELECT "CardCode", "CardType", "validFor", "frozenFor" FROM "OCRD" WHERE "CardCode" = $1', [shortName],
    )).rows[0] : null;
    if (bp && (bp.frozenFor === 'Y' || bp.validFor === 'N')) throw slError(400, `${row}: business partner "${bp.CardCode}" is inactive.`);
    const account = bp ? (hasValue(line.AccountCode) ? line.AccountCode : await accounts.bpAccount(bp.CardCode, bp.CardType !== 'S')) : shortName;
    const base = {
      account, amount: debit - credit, ShortName: bp ? bp.CardCode : account, bp: Boolean(bp), LineMemo: line.LineMemo,
      ProfitCode: line.CostingCode, OcrCode2: line.CostingCode2, OcrCode3: line.CostingCode3, OcrCode4: line.CostingCode4, OcrCode5: line.CostingCode5,
      Project: line.ProjectCode ?? data.ProjectCode,
    };
    rows.push(base);
    if (hasValue(line.TaxCode)) {
      // SAP: a G/L row with a tax code is the base; the tax goes to each component's
      // output (credit row) or input (debit row) tax account on the same side.
      if (bp) throw slError(400, `${row}: a tax code applies to G/L account rows only.`);
      const sales = base.amount < 0;
      const rate = await getTaxRate(client, new Map(), line.TaxCode, sales ? 'AR' : 'AP');
      const components = (await accounts.taxRows(line.TaxCode))?.Rows || [];
      const tax = roundTo(Math.abs(base.amount) * rate / 100, sumDec);
      Object.assign(base, { VatGroup: line.TaxCode, BaseSum: Math.abs(base.amount), VatAmount: tax });
      let remaining = tax;
      for (const [i, component] of (tax ? components : []).entries()) {
        const share = i === components.length - 1 ? remaining : roundTo(tax * toNumber(component.rate) / rate, sumDec);
        remaining = roundTo(remaining - share, sumDec);
        const taxAccount = sales ? component.sales : component.purchase;
        if (!hasValue(taxAccount)) throw slError(400, `Define the ${sales ? 'sales' : 'purchase'} tax account for tax component "${component.code}".`);
        if (share) {
          rows.push({ account: taxAccount, amount: Math.sign(base.amount) * share, ShortName: taxAccount, LineMemo: `${line.TaxCode} ${component.code}`,
            VatGroup: line.TaxCode, BaseSum: Math.abs(base.amount), VatLine: 'Y', Project: base.Project, ProfitCode: base.ProfitCode });
        }
      }
    }
  }
  await validateAccounts(client, rows.map((row) => row.account));
  const journal = await writeJournal(client, schema, {
    rows, objType: '30', series: hasValue(data.Series) ? Number(data.Series) : null, period, company, memo: data.Memo || '',
    refDate, dueDate: data.DueDate || refDate, taxDate: data.TaxDate || refDate,
    ref1: data.Reference ?? null, ref2: data.Reference2 ?? null, ref3: data.Reference3 ?? null,
  });
  await logWrite(client, { entity: 'JournalEntries', objType: '30', docEntry: journal.TransId, method: 'POST', payload: data, unmapped: {} });
  return readJournalEntry(client, journal.TransId);
});

const readJournalEntry = async (client, transId) => {
  const header = (await client.query('SELECT * FROM "OJDT" WHERE "TransId" = $1', [transId])).rows[0];
  if (!header) throw slError(404, `No matching records found (JournalEntries ${transId}).`);
  const lines = (await client.query('SELECT * FROM "JDT1" WHERE "TransId" = $1 ORDER BY "Line_ID"', [transId])).rows;
  return {
    JdtNum: header.TransId, Number: header.Number, Series: header.Series, ReferenceDate: toSlValue('RefDate', header.RefDate),
    DueDate: toSlValue('DueDate', header.DueDate), TaxDate: toSlValue('TaxDate', header.TaxDate), Memo: header.Memo,
    Reference: header.Ref1, Reference2: header.Ref2, Reference3: header.Ref3, TransactionType: header.TransType,
    JournalEntryLines: lines.map((line) => ({
      Line_ID: line.Line_ID, AccountCode: line.Account, ShortName: line.ShortName, Debit: line.Debit, Credit: line.Credit,
      LineMemo: line.LineMemo, CostingCode: line.ProfitCode, ProjectCode: line.Project,
    })),
  };
};

// ---- opening balances --------------------------------------------------------------

// SAP opening balances: G/L accounts and business partners post one journal entry
// (transaction type -2, Opening Balance) against an offset account, by default the
// Opening Balance account in G/L Account Determination; BP rows stay open so
// payments can settle them. Item stock is received like a goods receipt whose
// offset is the opening warehouse balance account.
const postOpeningBalances = async (schema, kind, body = {}) => {
  const date = hasValue(body.date) ? body.date : localToday();
  const rows = (body.rows || []).filter((row) => Object.values(row).some(hasValue));
  if (!rows.length) throw slError(400, 'Enter at least one opening balance row.');
  if (kind === 'items') {
    const offset = await withTransaction(schema, async (client) => {
      const acp = (await accountResolver(client, await getPostingPeriod(client, date))).acp;
      return hasValue(body.offsetAccount) ? body.offsetAccount : acp.DftStockOB || acp.LinkAct_18;
    });
    if (!hasValue(offset)) throw slError(400, 'Select the opening balance offset account (or define it in G/L Account Determination).');
    rows.forEach((row, index) => {
      if (!(toNumber(row.Quantity) > 0)) throw slError(400, `Row ${index + 1}: enter a quantity greater than zero.`);
      if (toNumber(row.Price) < 0) throw slError(400, `Row ${index + 1}: the price cannot be negative.`);
    });
    const receipt = await createDocument(schema, 'InventoryGenEntries', {
      DocDate: date, Comments: body.memo || 'Opening balance', JournalMemo: body.memo || 'Opening Balance', Reference2: 'OB',
      DocumentLines: rows.map((row) => ({ ItemCode: row.ItemCode, WarehouseCode: row.WhsCode, Quantity: toNumber(row.Quantity), Price: toNumber(row.Price), AccountCode: offset })),
    });
    return { kind, DocEntry: receipt.DocEntry, DocNum: receipt.DocNum, TransId: receipt.TransId };
  }
  if (!['accounts', 'partners'].includes(kind)) throw slError(404, 'Unknown opening balance type.');
  return withTransaction(schema, async (client) => {
    const company = await getCompany(client);
    const sumDec = toNumber(company.SumDec, 2);
    const period = await getPostingPeriod(client, date);
    const accounts = await accountResolver(client, period);
    const offset = hasValue(body.offsetAccount) ? body.offsetAccount : accounts.acp.LinkAct_18;
    if (!hasValue(offset)) throw slError(400, 'Select the opening balance offset account (or define it in G/L Account Determination).');
    const lines = [];
    for (const [index, row] of rows.entries()) {
      const label = `Row ${index + 1}`;
      const debit = roundTo(toNumber(row.Debit), sumDec);
      const credit = roundTo(toNumber(row.Credit), sumDec);
      if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) throw slError(400, `${label}: enter either a debit or a credit amount.`);
      if (kind === 'accounts') {
        if (row.AccountCode === offset) throw slError(400, `${label}: the offset account cannot take an opening balance of its own here.`);
        lines.push({ account: row.AccountCode, amount: debit - credit, ShortName: row.AccountCode, LineMemo: row.Remarks });
      } else {
        const bp = (await client.query('SELECT "CardCode", "CardType", "validFor", "frozenFor" FROM "OCRD" WHERE "CardCode" = $1', [row.CardCode])).rows[0];
        if (!bp) throw slError(400, `${label}: business partner "${row.CardCode ?? ''}" does not exist.`);
        lines.push({
          account: await accounts.bpAccount(bp.CardCode, bp.CardType !== 'S'), amount: debit - credit, ShortName: bp.CardCode, bp: true,
          LineMemo: row.Remarks || row.Reference, DueDate: row.DueDate || date,
        });
      }
    }
    const total = roundTo(lines.reduce((sum, line) => sum + line.amount, 0), sumDec);
    if (total) lines.push({ account: offset, amount: -total, ShortName: offset, LineMemo: 'Opening balance offset' });
    await validateAccounts(client, lines.map((line) => line.account));
    const journal = await writeJournal(client, schema, {
      rows: lines, objType: -2, period, company, memo: body.memo || (kind === 'partners' ? 'Opening Balance - Business Partners' : 'Opening Balance - G/L Accounts'),
      refDate: date, dueDate: date, taxDate: date, ref1: body.reference || null,
    });
    await logWrite(client, { entity: 'OpeningBalances', objType: '-2', docEntry: journal.TransId, method: `POST ${kind}`, payload: body, unmapped: {} });
    return { kind, TransId: journal.TransId, Number: journal.Number };
  });
};

// Posted opening balances plus what the page offers to choose from.
// ponytail: full master lists in one response; page them if a company has many thousands.
const listOpeningBalances = (schema) => withTransaction(schema, async (client) => ({
  entries: (await client.query(
    `SELECT h."TransId", h."Number", h."RefDate", h."Memo", h."TransType", h."LocTotal" FROM "OJDT" h
     WHERE h."TransType" = -2 OR (h."TransType" = 59 AND h."CreatedBy" IN (SELECT "DocEntry" FROM "OIGN" WHERE "Ref2" = 'OB'))
     ORDER BY h."TransId" DESC LIMIT 200`,
  )).rows,
  accounts: (await client.query(`SELECT "AcctCode", "AcctName" FROM "OACT" WHERE "Postable" = 'Y' AND "FrozenFor" = 'N' ORDER BY "AcctCode"`)).rows,
  partners: (await client.query(`SELECT "CardCode", "CardName", "CardType" FROM "OCRD" WHERE COALESCE("frozenFor", 'N') <> 'Y' ORDER BY "CardCode"`)).rows,
  items: (await client.query(`SELECT "ItemCode", "ItemName" FROM "OITM" WHERE "InvntItem" = 'Y' AND COALESCE("frozenFor", 'N') <> 'Y' ORDER BY "ItemCode"`)).rows,
  warehouses: (await client.query('SELECT "WhsCode", "WhsName" FROM "OWHS" ORDER BY "WhsCode"')).rows,
}));

// Business partners that have open (unreconciled) journal rows.
const listReconcilablePartners = (schema) => withTransaction(schema, async (client) => (await client.query(
  `SELECT p."CardCode", p."CardName", p."CardType", COUNT(*)::int AS "OpenRows" FROM "JDT1" l JOIN "OCRD" p ON p."CardCode" = l."ShortName"
   WHERE l."BalDueDeb" > 0 OR l."BalDueCred" > 0 GROUP BY p."CardCode", p."CardName", p."CardType" ORDER BY p."CardCode"`,
)).rows);

// ---- internal reconciliation (OITR/ITR1) ---------------------------------------------

// Open journal rows of a business partner: what is still unreconciled, signed debit +.
const listOpenRows = (schema, cardCode) => withTransaction(schema, async (client) => (await client.query(
  `SELECT l."TransId", l."Line_ID" AS "LineId", l."TransType", l."CreatedBy", l."BaseRef", l."RefDate", l."DueDate", l."LineMemo", l."Account",
          l."Debit" - l."Credit" AS "Amount", l."BalDueDeb" - l."BalDueCred" AS "Open"
   FROM "JDT1" l WHERE l."ShortName" = $1 AND (l."BalDueDeb" > 0 OR l."BalDueCred" > 0)
   ORDER BY l."RefDate", l."TransId", l."Line_ID"`, [cardCode],
)).rows);

// SAP internal reconciliation: the selected open rows of one business partner,
// debits and credits equal; each row's open amount goes down and an invoice or
// credit memo it belongs to counts as paid by that amount.
const DOCUMENT_BY_TRANSTYPE = { 13: 'OINV', 14: 'ORIN', 18: 'OPCH', 19: 'ORPC' };
const reconcile = (schema, body = {}) => withTransaction(schema, async (client) => {
  const company = await getCompany(client);
  const sumDec = toNumber(company.SumDec, 2);
  const cardCode = body.CardCode;
  const selected = (body.Rows || []).filter((row) => toNumber(row.Amount));
  if (selected.length < 2) throw slError(400, 'Select at least two rows to reconcile.');
  const date = hasValue(body.ReconDate) ? body.ReconDate : localToday();
  const lines = [];
  const seen = new Set();
  for (const [index, choice] of selected.entries()) {
    const rowKey = `${Number(choice.TransId)}:${Number(choice.LineId)}`;
    if (seen.has(rowKey)) throw slError(400, `Row ${index + 1}: journal row ${choice.TransId}/${choice.LineId} is selected twice.`);
    seen.add(rowKey);
    const row = (await client.query(
      `SELECT * FROM "JDT1" WHERE "TransId" = $1 AND "Line_ID" = $2 AND "ShortName" = $3 FOR UPDATE`, [Number(choice.TransId), Number(choice.LineId), cardCode],
    )).rows[0];
    if (!row) throw slError(400, `Row ${index + 1}: journal row ${choice.TransId}/${choice.LineId} is not an open item of "${cardCode ?? ''}".`);
    // SAP B1: the reconciliation date cannot be earlier than a selected transaction's posting date.
    const postedOn = row.RefDate instanceof Date ? row.RefDate.toISOString().slice(0, 10) : String(row.RefDate || '').slice(0, 10);
    if (postedOn && String(date).slice(0, 10) < postedOn) {
      throw slError(400, `Row ${index + 1}: the reconciliation date ${String(date).slice(0, 10)} is earlier than its posting date ${postedOn}.`);
    }
    const open = roundTo(toNumber(row.BalDueDeb) + toNumber(row.BalDueCred), sumDec);
    const amount = roundTo(Math.abs(toNumber(choice.Amount)), sumDec);
    if (amount > open) throw slError(400, `Row ${index + 1}: ${amount} is more than the ${open} still open.`);
    lines.push({ row, amount, credit: toNumber(row.BalDueCred) > 0 });
  }
  const difference = roundTo(lines.reduce((sum, line) => sum + (line.credit ? -line.amount : line.amount), 0), sumDec);
  if (difference !== 0) throw slError(400, `Debits and credits to reconcile must be equal (difference ${difference}).`);
  const recon = (await client.query(
    `INSERT INTO "OITR" ("ReconDate", "IsCard", "CardOrAcct", "ReconType", "Total") VALUES ($1, 'C', $2, 0, $3) RETURNING "ReconNum"`,
    [date, cardCode, roundTo(lines.filter((line) => !line.credit).reduce((sum, line) => sum + line.amount, 0), sumDec)],
  )).rows[0].ReconNum;
  for (const [index, { row, amount, credit }] of lines.entries()) {
    await reduceOpenRow(client, row.TransId, row.Line_ID, amount);
    const table = DOCUMENT_BY_TRANSTYPE[row.TransType];
    if (table) {
      await client.query(
        `UPDATE ${quote(table)} SET "PaidToDate" = COALESCE("PaidToDate", 0) + $2,
           "DocStatus" = CASE WHEN "DocTotal" - COALESCE("PaidToDate", 0) - $2 <= 0.005 THEN 'C' ELSE "DocStatus" END
         WHERE "DocEntry" = $1`, [row.CreatedBy, amount],
      );
    }
    await client.query(
      `INSERT INTO "ITR1" ("ReconNum", "LineSeq", "ShortName", "Account", "TransId", "TransRowId", "SrcObjTyp", "SrcObjAbs", "ReconSum", "IsCredit")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [recon, index, cardCode, row.Account, row.TransId, row.Line_ID, String(row.TransType), row.CreatedBy, amount, credit ? 'C' : 'D'],
    );
  }
  await logWrite(client, { entity: 'InternalReconciliations', objType: '321', docEntry: recon, method: 'POST', payload: body, unmapped: {} });
  return { ReconNum: recon };
});

// ---- exchange rates (SBOBobService) ----------------------------------------------

const getCurrencyRate = async (schema, { Currency, Date: rateDate } = {}) => withTransaction(schema, async (client) => {
  const company = await getCompany(client);
  if (!Currency || Currency === company.MainCurncy) return { value: 1 };
  const row = (await client.query(
    'SELECT "Rate" FROM "ORTT" WHERE "Currency" = $1 AND "RateDate" = $2::date', [Currency, String(rateDate).slice(0, 10)],
  )).rows[0];
  if (!row) throw slError(404, `No exchange rate is defined for ${Currency} on ${String(rateDate).slice(0, 10)}.`);
  return { value: Number(row.Rate) };
});

const setCurrencyRate = async (schema, { Currency, RateDate, Rate } = {}) => withTransaction(schema, async (client) => {
  if (!(toNumber(Rate) > 0)) throw slError(400, 'The exchange rate must be greater than zero.');
  const company = await getCompany(client);
  if (Currency === company.MainCurncy && Number(Rate) !== 1) throw slError(400, 'The local currency rate must be 1.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(RateDate))) throw slError(400, 'Enter the exchange rate date as YYYY-MM-DD.');
  await client.query(
    `INSERT INTO "ORTT" ("RateDate", "Currency", "Rate") VALUES ($1::date, $2, $3)
     ON CONFLICT ("RateDate", "Currency") DO UPDATE SET "Rate" = EXCLUDED."Rate"`,
    [String(RateDate).slice(0, 10), Currency, toNumber(Rate)],
  );
  await logWrite(client, { entity: 'CurrencyRates', method: 'SETUP', payload: { Currency, RateDate, Rate }, unmapped: {} });
  return {};
});

// ---- master data ------------------------------------------------------------------

const UGP1_FIELDS = { AlternateUoM: 'UomEntry', AlternateQuantity: 'AltQty', BaseQuantity: 'BaseQty' };

// SL property -> column for master objects, from SAP B1 10.0 SDK table
// references and the property names the existing pages already send.
// ---- production helpers (BOMs, production orders) ---------------------------------
const ISSUE_METHODS = { im_Manual: 'M', im_Backflush: 'B' };
const PRODUCTION_ITEM_TYPES = { pit_Item: 4, pit_Resource: 290, pit_Text: -18 };
const PRODUCTION_STATUS_LABEL = { P: 'Planned', R: 'Released', L: 'Closed', C: 'Cancelled' };

const localDay = (value) => (value instanceof Date ? value.toLocaleDateString('en-CA') : String(value || '').slice(0, 10));

// The signed-in user's company user (OUSR), through the SAP user code assigned
// to them for this company (Admin Panel); null when none is assigned.
const currentUserSign = async (client) => {
  const auth = require('./requestContextService').getRequestContext()?.req?.auth;
  if (!(Number(auth?.userId) > 0) || !(Number(auth?.companyId) > 0)) return null;
  const link = await require('./authDbService').queryOne(
    'SELECT SapUserCode FROM UserCompanies WHERE UserId = @userId AND CompanyId = @companyId', { userId: Number(auth.userId), companyId: Number(auth.companyId) },
  );
  if (!hasValue(link?.SapUserCode)) return null;
  return (await client.query('SELECT "USERID" FROM "OUSR" WHERE "USER_CODE" = $1', [link.SapUserCode])).rows[0]?.USERID ?? null;
};

// Production order origin (SAP "Linked To"): a sales order (its number and
// customer come with it) or a parent production order; otherwise manual.
const applyProductionOrigin = async (client, row) => {
  if (!['S', 'P'].includes(row.OriginType) || !hasValue(row.OriginAbs)) {
    Object.assign(row, { OriginType: 'M', OriginAbs: null, OriginNum: null });
    return;
  }
  const table = row.OriginType === 'S' ? 'ORDR' : 'OWOR';
  const origin = (await client.query(`SELECT * FROM ${quote(table)} WHERE "DocEntry" = $1`, [row.OriginAbs])).rows[0];
  const label = row.OriginType === 'S' ? 'Sales order' : 'Production order';
  if (!origin) throw slError(400, `${label} ${row.OriginAbs} does not exist.`);
  if (origin.CANCELED === 'Y' || ['C', 'L'].includes(origin.Status)) throw slError(400, `${label} ${origin.DocNum} is cancelled or closed.`);
  if (row.OriginType === 'P' && Number(origin.DocEntry) === Number(row.DocEntry)) throw slError(400, 'A production order cannot be linked to itself.');
  row.OriginNum = origin.DocNum;
  if (row.OriginType === 'S' && !hasValue(row.CardCode)) row.CardCode = origin.CardCode;
};

const resourceAccount = async (client, code) => {
  const own = (await client.query('SELECT "ResAcct" FROM "ORSC" WHERE "ResCode" = $1', [code])).rows[0]?.ResAcct;
  const account = own || (await client.query('SELECT "ResAcct" FROM "OACP" WHERE "ResAcct" IS NOT NULL ORDER BY "FinancYear" DESC LIMIT 1')).rows[0]?.ResAcct;
  if (!hasValue(account)) throw slError(400, `Define the resource account for resource "${code}" or in G/L Account Determination.`);
  return account;
};

// Route stages of a BOM / production order: each points at a route stage (ORST);
// rows refer to a stage by StageId. Sequence follows the list order.
const validateStages = async (client, stages) => {
  const ids = new Set();
  for (const [index, stage] of stages.entries()) {
    const master = (await client.query('SELECT "Code", "Desc" FROM "ORST" WHERE "AbsEntry" = $1', [stage.StgEntry])).rows[0];
    if (!master) throw slError(400, `Stage ${index + 1}: route stage ${stage.StgEntry ?? ''} does not exist.`);
    if (!hasValue(stage.StageId)) stage.StageId = index + 1;
    if (!(Number.isInteger(Number(stage.StageId)) && Number(stage.StageId) > 0) || ids.has(Number(stage.StageId))) {
      throw slError(400, `Stage ${index + 1}: the stage ID must be a unique positive number.`);
    }
    ids.add(Number(stage.StageId));
    stage.SeqNum = index + 1;
    if (!hasValue(stage.Name)) stage.Name = master.Desc || master.Code;
  }
  return ids;
};
const assertRowStages = (rows, stageIds, column) => {
  // Older documents may carry a route sequence without stages; only check once stages exist.
  if (!stageIds.size) return;
  rows.forEach((line, index) => {
    if (hasValue(line[column]) && !stageIds.has(Number(line[column]))) throw slError(400, `Row ${index + 1}: route stage ${line[column]} is not a stage of this document.`);
  });
};

const assertWarehouses = async (client, codes) => {
  for (const code of codes.filter(hasValue)) {
    const warehouse = (await client.query('SELECT "Inactive" FROM "OWHS" WHERE "WhsCode" = $1', [code])).rows[0];
    if (!warehouse) throw slError(400, `Warehouse "${code}" does not exist.`);
    if (warehouse.Inactive === 'Y') throw slError(400, `Warehouse "${code}" is inactive.`);
  }
};

// A BOM / production order row is an item (type 4) or a resource (type 290);
// the type is taken from the master when the page does not send it.
const productionComponent = async (client, line, row, productCode) => {
  if (!hasValue(line.Code)) throw slError(400, `${row}: select a component.`);
  if (line.Code === productCode) throw slError(400, `${row}: a product cannot be its own component.`);
  if (Number(line.Type) !== 290) {
    const item = (await client.query(
      'SELECT "ItemName", "DfltWH", "IssueMthd", "InvntryUom", "InvntItem", "ManBtchNum", "ManSerNum", "validFor", "frozenFor" FROM "OITM" WHERE "ItemCode" = $1', [line.Code],
    )).rows[0];
    if (item) {
      if (item.frozenFor === 'Y' || item.validFor === 'N') throw slError(400, `${row}: item "${line.Code}" is inactive.`);
      line.Type = 4;
      return { ...item, Type: 4 };
    }
  }
  const resource = (await client.query('SELECT "ResName" FROM "ORSC" WHERE "ResCode" = $1', [line.Code])).rows[0];
  if (!resource) throw slError(400, `${row}: item or resource "${line.Code}" does not exist.`);
  line.Type = 290;
  return { ItemName: resource.ResName, Type: 290 };
};

const MASTERS = {
  ...require('./localSetupMasters')({ slError }),
  Warehouses: {
    table: 'OWHS',
    key: 'WhsCode',
    label: 'Warehouse',
    required: { WhsCode: 'warehouse code', WhsName: 'warehouse name' },
    fields: {
      WarehouseCode: 'WhsCode', WarehouseName: 'WhsName', AllowUseTax: 'UseTax',
      ManageSerialAndBatchNumbers: 'ManageSnB', BusinessPlaceID: 'BPLid', TaxGroup: 'VatGroup',
      FederalTaxID: 'FedTaxID', GlobalLocationNumber: 'GlblLocNum', WHShipToName: 'WhShipTo',
      Storekeeper: 'StorKeeper', EnableBinLocations: 'BinActivat', BinLocCodeSeparator: 'BinSeptor',
      DefaultBin: 'DftBinAbs', DefaultBinEnforced: 'DftBinEnfd', BuildingFloorRoom: 'Building',
      AddressType: 'AddrType', AddressName2: 'Address2', AddressName3: 'Address3',
      StockAccount: 'BalInvntAc', DecreasingAccount: 'DecreasAc', IncreasingAcc: 'IncreasAc',
      DecreaseGLAccount: 'DecresGlAc', IncreaseGLAccount: 'IncresGlAc', CostOfGoodsSold: 'SaleCostAc',
      TransfersAcc: 'TransferAc', PriceDifferencesAccount: 'PriceDifAc', VarianceAccount: 'VarianceAc',
      NegativeInventoryAdjustmentAccount: 'NegStckAct', PurchaseAccount: 'PurchaseAc',
      PurchaseReturningAccount: 'PAReturnAc', PurchaseOffsetAccount: 'PurchOfsAc', ExpenseAccount: 'ExpensesAc',
      ExpensesClearingAccount: 'ExpClrAct', GoodsClearingAcc: 'BalanceAcc', RevenuesAccount: 'RevenuesAc',
      ReturningAccount: 'ReturnAc', ExemptRevenuesAccount: 'ExmptIncom', ExpenseOffsetingAct: 'ExpOfstAct',
      WIPMaterialAccount: 'WipAcct', WIPMaterialVarianceAccount: 'WipVarAcct',
      WipOffsetProfitAndLossAccount: 'WipOffset', InventoryOffsetProfitAndLossAccount: 'StockOffst',
      ForeignRevenuesAcc: 'FrRevenuAc', EURevenuesAccount: 'EURevenuAc', ForeignExpensesAccount: 'FrExpensAc',
      EUExpensesAccount: 'EUExpensAc', ExchangeRateDifferencesAccount: 'ExchangeAc',
      StockInflationAdjustAccount: 'StokRvlAct', StockInflationOffsetAccount: 'StkOffsAct',
      CostInflationAccount: 'CostRvlAct', CostInflationOffsetAccount: 'CstOffsAct',
      ShippedGoodsAccount: 'ShpdGdsAct', StockInTransitAccount: 'StkInTnAct', PurchaseBalanceAccount: 'PurBalAct',
      PurchaseCreditAcc: 'APCMAct', EUPurchaseCreditAcc: 'APCMEUAct', ForeignPurchaseCreditAcc: 'APCMFrnAct',
      SalesCreditAcc: 'ARCMAct', SalesCreditEUAcc: 'ARCMEUAct', SalesCreditForeignAcc: 'ARCMFrnAct',
      ExemptedCredits: 'RevRetAct', VATInRevenueAccount: 'VatRevAct', WHIncomingCenvatAccount: 'WhICenAct',
      WHOutgoingCenvatAccount: 'WhOCenAct',
    },
    accounts: [
      'BalInvntAc', 'SaleCostAc', 'RevenuesAc', 'ExpensesAc', 'DecreasAc', 'IncreasAc', 'DecresGlAc', 'IncresGlAc',
      'TransferAc', 'PriceDifAc', 'VarianceAc', 'NegStckAct', 'PurchaseAc', 'PAReturnAc', 'PurchOfsAc', 'ExpClrAct',
      'BalanceAcc', 'ReturnAc', 'ExmptIncom', 'ExpOfstAct', 'WipAcct', 'WipVarAcct', 'WipOffset', 'StockOffst',
      'FrRevenuAc', 'EURevenuAc', 'FrExpensAc', 'EUExpensAc', 'ExchangeAc', 'StokRvlAct', 'StkOffsAct', 'CostRvlAct',
      'CstOffsAct', 'ShpdGdsAct', 'StkInTnAct', 'PurBalAct', 'APCMAct', 'APCMEUAct', 'APCMFrnAct', 'ARCMAct',
      'ARCMEUAct', 'ARCMFrnAct', 'RevRetAct', 'VatRevAct', 'WhICenAct', 'WhOCenAct',
    ],
    flags: ['Inactive', 'Locked', 'DropShip', 'Nettable', 'UseTax', 'Excisable', 'ManageSnB', 'BinActivat', 'DftBinEnfd'],
    validate: async (client, row, existing) => {
      const company = (await client.query('SELECT "DfltWhs", "MltpBrnchs" FROM "OADM" LIMIT 1')).rows[0] || {};
      if (company.MltpBrnchs === 'Y' && !hasValue(row.BPLid)) throw slError(400, 'Assign the warehouse to a branch.');
      if (row.Inactive === 'Y' && (!existing || existing.Inactive !== 'Y')) {
        if (row.WhsCode === company.DfltWhs) {
          throw slError(400, `Warehouse "${row.WhsCode}" is the company default warehouse and cannot be inactive.`);
        }
        const stocked = (await client.query(
          'SELECT 1 FROM "OITW" WHERE "WhsCode" = $1 AND ("OnHand" <> 0 OR "IsCommited" <> 0 OR "OnOrder" <> 0) LIMIT 1',
          [row.WhsCode],
        )).rowCount > 0;
        if (stocked) throw slError(400, `Warehouse "${row.WhsCode}" has stock or open quantities and cannot be inactive.`);
      }
    },
    afterSave: async (client, whsCode) => {
      await client.query(`INSERT INTO "OITW" ("ItemCode", "WhsCode") SELECT "ItemCode", $1 FROM "OITM"
        ON CONFLICT DO NOTHING`, [whsCode]);
    },
  },
  // Tax components (SAP: Sales Tax Authorities, OSTA). India GST types come from OSTT.
  SalesTaxAuthorities: {
    table: 'OSTA',
    key: 'Code',
    label: 'Tax component',
    required: { Code: 'component code', Name: 'component name', Type: 'tax type' },
    fields: {
      SalesTaxAccount: 'SalesTax', PurchaseTaxAccount: 'PurchTax', UseTaxAccount: 'UseTax',
      DeferredTaxAccount: 'deferrAcct', NonDeductiblePercent: 'NonDdctPrc', NonDeductibleAccount: 'NonDdctAct',
      ReverseChargePercent: 'RvsCrgPrc', SalesTaxRCMAccount: 'SaleTaxRCM', SalesRCMClearingAccount: 'SaleRCMClr',
      EffectiveDate: 'EfctDate', TaxInPrice: 'TaxInPrice',
    },
    accounts: ['SalesTax', 'PurchTax', 'UseTax', 'deferrAcct', 'NonDdctAct', 'SaleTaxRCM', 'SaleRCMClr'],
    flags: ['TaxInPrice', 'Exempt', 'IsSystem'],
    validate: async (client, row, existing) => {
      const type = (await client.query('SELECT "Name", "Locked" FROM "OSTT" WHERE "AbsId" = $1', [row.Type])).rows[0];
      if (!type) throw slError(400, `Tax type ${row.Type} does not exist.`);
      if (type.Locked === 'Y') throw slError(400, `Tax type ${type.Name} is locked.`);
      const rate = toNumber(row.Rate, NaN);
      if (!(rate >= 0 && rate <= 100)) throw slError(400, 'The component rate must be between 0 and 100.');
      if (!hasValue(row.SalesTax) || !hasValue(row.PurchTax)) throw slError(400, 'Enter the sales and purchase tax accounts.');
      if (existing && Number(existing.Type) !== Number(row.Type)) {
        const inUse = (await client.query('SELECT 1 FROM "STC1" WHERE "STACode" = $1 LIMIT 1', [row.Code])).rowCount > 0;
        if (inUse) throw slError(400, `Tax component "${row.Code}" is used in tax codes; its tax type cannot change.`);
      }
      if (existing && (toNumber(existing.Rate) !== rate || Number(existing.Type) !== Number(row.Type))) {
        await assertTaxNotPosted(client, 'Tax component', row.Code,
          'SELECT DISTINCT "STCCode" AS "Code" FROM "STC1" WHERE "STACode" = $1', [row.Code]);
      }
    },
    // Rows carry the component's rate: keep them and the code totals in step.
    afterSave: async (client, code) => {
      await client.query(`UPDATE "STC1" s SET "EfctivRate" = a."Rate", "STAType" = a."Type"
        FROM "OSTA" a WHERE a."Code" = s."STACode" AND s."STACode" = $1`, [code]);
      await client.query(`UPDATE "OSTC" c SET "Rate" = (SELECT COALESCE(SUM("EfctivRate"), 0) FROM "STC1" s WHERE s."STCCode" = c."Code")
        WHERE c."Code" IN (SELECT "STCCode" FROM "STC1" WHERE "STACode" = $1)`, [code]);
    },
  },
  // Tax codes (SAP: Sales Tax Codes, OSTC + rows STC1), e.g. GST18 = CGST9 + SGST9.
  SalesTaxCodes: {
    table: 'OSTC',
    key: 'Code',
    label: 'Tax code',
    required: { Code: 'tax code', Name: 'description' },
    fields: { Inactive: 'Lock', IsItemLevel: 'IsItmLevel', EffectiveDate: 'EfctDate' },
    flags: ['Lock', 'Freight', 'ValidForAR', 'ValidForAP', 'IsItmLevel', 'IsSystem'],
    children: {
      SalesTaxCodes_Lines: {
        table: 'STC1', parentKey: 'STCCode', lineKey: 'Line_ID',
        fields: { LineNumber: 'Line_ID', EffectiveRate: 'EfctivRate' },
      },
    },
    validate: async (client, row, existing, children) => {
      if (row.ValidForAR === 'N' && row.ValidForAP === 'N') throw slError(400, 'A tax code must be valid for sales, purchasing or both.');
      const lines = children.SalesTaxCodes_Lines;
      if (!lines) {
        if (!existing) throw slError(400, 'Add at least one tax component.');
        return;
      }
      if (!lines.length) throw slError(400, 'Add at least one tax component.');
      const codes = lines.map((line) => line.STACode);
      if (codes.some((code) => !hasValue(code))) throw slError(400, 'Select a tax component on every row.');
      if (new Set(codes).size !== codes.length) throw slError(400, 'A tax component can appear only once in a tax code.');
      const components = new Map((await client.query(
        `SELECT a."Code", a."Type", a."Rate", t."Name" AS "TypeName"
         FROM "OSTA" a JOIN "OSTT" t ON t."AbsId" = a."Type" WHERE a."Code" = ANY($1)`, [codes],
      )).rows.map((component) => [component.Code, component]));
      for (const line of lines) {
        const component = components.get(line.STACode);
        if (!component) throw slError(400, `Tax component "${line.STACode}" does not exist.`);
        // The component decides type and rate; the page never overrides them.
        line.STAType = component.Type;
        line.EfctivRate = toNumber(component.Rate);
      }
      // GST: CGST and SGST together at equal rates (intra-state), or IGST alone (inter-state).
      const rateOf = (type) => lines.filter((line) => Number(line.STAType) === type).reduce((sum, line) => sum + line.EfctivRate, 0);
      const has = (type) => lines.some((line) => Number(line.STAType) === type);
      if (has(-120) && (has(-100) || has(-110))) throw slError(400, 'IGST cannot be combined with CGST or SGST in one tax code.');
      if ((has(-100) || has(-110)) && rateOf(-100) + rateOf(-110) > 0 && (!has(-100) || !has(-110) || rateOf(-100) !== rateOf(-110))) {
        throw slError(400, 'CGST and SGST must be used together with equal rates.');
      }
      if (existing) {
        const before = (await client.query(
          'SELECT "STACode" FROM "STC1" WHERE "STCCode" = $1 ORDER BY "STACode"', [row.Code],
        )).rows.map((line) => line.STACode).join(',');
        if (before !== [...codes].sort().join(',')) {
          await assertTaxNotPosted(client, 'Tax code', row.Code, 'SELECT $1::text AS "Code"', [row.Code]);
        }
      }
      row.Rate = lines.reduce((sum, line) => sum + line.EfctivRate, 0);
    },
    afterSave: async (client, code) => {
      await client.query(`UPDATE "OSTC" SET "Rate" = (SELECT COALESCE(SUM("EfctivRate"), 0) FROM "STC1" WHERE "STCCode" = $1),
        "UpdateDate" = CURRENT_DATE WHERE "Code" = $1`, [code]);
    },
  },
  // Business partners (OCRD + addresses CRD1 + contacts OCPR). The BP page reads
  // through GET, so it gets SAP's SL shape back, extras included.
  BusinessPartners: {
    table: 'OCRD',
    key: 'CardCode',
    label: 'Business partner',
    required: { CardCode: 'BP code', CardName: 'BP name', CardType: 'BP type' },
    extraColumn: 'SlExtra',
    collections: ['BPAddresses', 'ContactEmployees'],
    fields: {
      CardForeignName: 'CardFName', EmailAddress: 'E_Mail', Website: 'IntrntSite', ContactPerson: 'CntctPrsn',
      FreeText: 'Free_Text', PayTermsGrpCode: 'GroupNum', PriceListNum: 'ListNum', CreditLimit: 'CreditLine',
      MaxCommitment: 'DebtLine', DiscountPercent: 'Discount', IntrestRatePercent: 'IntrstRate', SalesPersonCode: 'SlpCode',
      PeymentMethodCode: 'PymCode', DebitorAccount: 'DebPayAcct', DownPaymentClearAct: 'DpmClear',
      DownPaymentInterimAccount: 'DpmIntAct', Valid: 'validFor', ValidFrom: 'validFrom', ValidTo: 'validTo', Frozen: 'frozenFor',
      FrozenFrom: 'frozenFrom', FrozenTo: 'frozenTo', BilltoDefault: 'BillToDef', ShipToDefault: 'ShipToDef',
      CompanyPrivate: 'CmpPrivate', SubjectToWithholdingTax: 'WTLiable', FederalTaxID: 'LicTradNum', ProjectCode: 'ProjectCod',
      LinkedBusinessPartner: 'ConnBP', ShippingType: 'ShipType', LanguageCode: 'LangCode',
      CurrentAccountBalance: 'Balance', OpenOrdersBalance: 'OrdersBal', OpenDeliveryNotesBalance: 'DNotesBal',
      ...Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`Properties${i + 1}`, `QryGroup${i + 1}`])),
    },
    enums: {
      // SL calls a lead cLid; the BP page's series lookup uses cLead.
      CardType: { cCustomer: 'C', cSupplier: 'S', cLid: 'L', cLead: 'L' },
      CompanyPrivate: { cCompany: 'C', cPrivate: 'I', cGovernment: 'G' },
    },
    flags: ['validFor', 'frozenFor', 'WTLiable', ...Array.from({ length: 64 }, (_, i) => `QryGroup${i + 1}`)],
    accounts: ['DebPayAcct', 'DpmClear', 'DpmIntAct'],
    validate: async (client, row, existing) => {
      // Balances are SAP's running totals, never set from the page.
      ['Balance', 'OrdersBal', 'DNotesBal'].forEach((column) => { if (existing) row[column] = existing[column]; else delete row[column]; });
      if (!['C', 'S', 'L'].includes(row.CardType)) throw slError(400, 'BP type must be customer, vendor or lead.');
      if (existing && existing.CardType !== row.CardType && !(existing.CardType === 'L' && row.CardType === 'C')) {
        throw slError(400, 'The BP type cannot change (only a lead can become a customer).');
      }
      if (!existing && hasValue(row.Series)) {
        const { code } = await assignMasterCode(client, row.Series, {
          objectCodes: ['2'], label: 'business partner', digits: 5, subType: row.CardType === 'S' ? 'S' : 'C',
        });
        if (code) row.CardCode = code;
      }
      const groupType = row.CardType === 'S' ? 'S' : 'C';
      if (!hasValue(row.GroupCode)) {
        row.GroupCode = (await client.query('SELECT MIN("GroupCode") AS "Code" FROM "OCRG" WHERE "GroupType" = $1', [groupType])).rows[0].Code;
        if (row.GroupCode === null) throw slError(400, 'Create a BP group for this type first.');
      } else {
        const group = (await client.query('SELECT "GroupType" FROM "OCRG" WHERE "GroupCode" = $1', [row.GroupCode])).rows[0];
        if (!group) throw slError(400, `BP group ${row.GroupCode} does not exist.`);
        if (group.GroupType !== groupType) throw slError(400, `BP group ${row.GroupCode} is not a ${groupType === 'S' ? 'vendor' : 'customer'} group.`);
      }
      if (hasValue(row.Currency) && row.Currency !== '##') {
        const currency = (await client.query('SELECT 1 FROM "OCRN" WHERE "CurrCode" = $1', [row.Currency])).rowCount;
        if (!currency) throw slError(400, `Currency "${row.Currency}" does not exist.`);
      }
      if (hasValue(row.LicTradNum) && !GSTIN.test(String(row.LicTradNum).toUpperCase()) && !PAN.test(String(row.LicTradNum).toUpperCase())) {
        throw slError(400, `Federal tax ID "${row.LicTradNum}" is not a valid GSTIN or PAN.`);
      }
    },
    afterSave: async (client, cardCode, { data }) => {
      await mergeBpAddresses(client, cardCode, data.BPAddresses);
      await mergeBpContacts(client, cardCode, data.ContactEmployees);
      await syncBpDefaults(client, cardCode);
    },
    read: async (row, client, toSl) => {
      const definition = MASTERS.BusinessPartners;
      const result = toSl(row, definition.fields, definition.flags, definition.enums);
      const addresses = (await client.query('SELECT * FROM "CRD1" WHERE "CardCode" = $1 ORDER BY "LineNum"', [row.CardCode])).rows;
      result.BPAddresses = addresses.map((address) => ({
        ...(address.SlExtra || {}),
        ...toSl(Object.fromEntries(Object.entries(address).filter(([column]) => column !== 'SlExtra')), ADDRESS_FIELDS, [], ADDRESS_ENUMS),
      }));
      const contacts = (await client.query('SELECT * FROM "OCPR" WHERE "CardCode" = $1 ORDER BY "CntctCode"', [row.CardCode])).rows;
      result.ContactEmployees = contacts.map((contact) => ({
        ...(contact.SlExtra || {}),
        ...toSl(Object.fromEntries(Object.entries(contact).filter(([column]) => column !== 'SlExtra')), CONTACT_FIELDS, ['Active']),
      }));
      return result;
    },
  },
  // ---- setup masters (M5) --------------------------------------------------------
  UnitOfMeasurements: {
    table: 'OUOM', key: 'UomEntry', generatedKey: true, uniqueKey: 'UomCode', label: 'Unit of measure',
    required: { UomCode: 'UoM code', UomName: 'UoM name' },
    fields: { AbsEntry: 'UomEntry', Code: 'UomCode', Name: 'UomName' },
  },
  // UoM groups: rows convert alternate UoMs to the base UoM (SAP keeps a 1:1 base row).
  UnitOfMeasurementGroups: {
    table: 'OUGP', key: 'UgpEntry', generatedKey: true, uniqueKey: 'UgpCode', label: 'UoM group',
    required: { UgpCode: 'UoM group code', BaseUom: 'base UoM' },
    fields: { AbsEntry: 'UgpEntry', Code: 'UgpCode', Name: 'UgpName', BaseUoM: 'BaseUom' },
    children: {
      UoMGroupDefinitionCollection: { table: 'UGP1', parentKey: 'UgpEntry', lineKey: 'LineNum', fields: UGP1_FIELDS },
      UnitOfMeasurementGroupLines: { table: 'UGP1', parentKey: 'UgpEntry', lineKey: 'LineNum', fields: UGP1_FIELDS },
    },
    validate: async (client, row, existing, children) => {
      if (!(await client.query('SELECT 1 FROM "OUOM" WHERE "UomEntry" = $1', [row.BaseUom])).rowCount) {
        throw slError(400, `Unit of measure ${row.BaseUom} does not exist.`);
      }
      const lines = children.UoMGroupDefinitionCollection || children.UnitOfMeasurementGroupLines;
      if (lines) {
        const uoms = lines.map((line) => Number(line.UomEntry));
        if (new Set(uoms).size !== uoms.length) throw slError(400, 'A unit of measure can appear only once in a group.');
        for (const line of lines) {
          if (!(toNumber(line.AltQty, 1) > 0 && toNumber(line.BaseQty, 1) > 0)) throw slError(400, 'Quantities must be greater than zero.');
          if (Number(line.UomEntry) === Number(row.BaseUom) && (toNumber(line.AltQty, 1) !== 1 || toNumber(line.BaseQty, 1) !== 1)) {
            throw slError(400, 'The base unit of measure converts 1 to 1.');
          }
        }
        // SAP always keeps the base row.
        if (!uoms.includes(Number(row.BaseUom))) lines.unshift({ UomEntry: row.BaseUom, AltQty: 1, BaseQty: 1 });
      }
      if (existing) {
        const usedBy = (await client.query('SELECT "ItemCode", "IUoMEntry", "SUoMEntry", "PUoMEntry" FROM "OITM" WHERE "UgpEntry" = $1', [existing.UgpEntry])).rows;
        if (usedBy.length && Number(existing.BaseUom) !== Number(row.BaseUom)) {
          throw slError(400, `UoM group "${existing.UgpCode}" is used by items; its base UoM cannot change.`);
        }
        if (Number(existing.BaseUom) !== Number(row.BaseUom)) {
          // The old base's 1 = 1 row was relative to the old base; it is not a conversion
          // to the new one. Keep that UoM only if the page sends a real conversion for it.
          const isOldBaseRow = (line) => Number(line.UomEntry) === Number(existing.BaseUom) && toNumber(line.AltQty, 1) === 1 && toNumber(line.BaseQty, 1) === 1;
          if (lines) {
            for (let i = lines.length - 1; i >= 0; i -= 1) if (isOldBaseRow(lines[i])) lines.splice(i, 1);
          } else {
            await client.query('DELETE FROM "UGP1" WHERE "UgpEntry" = $1 AND "UomEntry" = $2 AND "AltQty" = 1 AND "BaseQty" = 1', [existing.UgpEntry, existing.BaseUom]);
          }
        }
        if (lines) {
          const kept = new Set(lines.map((line) => Number(line.UomEntry)));
          const removed = usedBy.flatMap((item) => [item.IUoMEntry, item.SUoMEntry, item.PUoMEntry]).filter((uom) => uom != null && !kept.has(Number(uom)));
          if (removed.length) throw slError(400, `UoM group "${existing.UgpCode}" rows used by items cannot be removed.`);
          const previous = (await client.query('SELECT "UomEntry", "AltQty", "BaseQty" FROM "UGP1" WHERE "UgpEntry" = $1', [existing.UgpEntry])).rows;
          const changed = previous.filter((old) => {
            const next = lines.find((line) => Number(line.UomEntry) === Number(old.UomEntry));
            return !next || toNumber(next.BaseQty, 1) / toNumber(next.AltQty, 1) !== toNumber(old.BaseQty) / toNumber(old.AltQty);
          }).map((line) => Number(line.UomEntry));
          if (usedBy.length && changed.length) {
            for (const document of Object.values(DOCUMENTS)) {
              const open = await client.query(`SELECT 1 FROM ${quote(document.lines)} l
                JOIN ${quote(document.header)} h ON h."DocEntry" = l."DocEntry"
                JOIN "OITM" i ON i."ItemCode" = l."ItemCode"
                WHERE i."UgpEntry" = $1 AND h."CANCELED" = 'N' AND h."DocStatus" = 'O' AND l."LineStatus" = 'O'
                  AND (l."UomEntry" = ANY($2) OR l."UomEntry" IS NULL) LIMIT 1`, [existing.UgpEntry, changed]);
              if (open.rowCount) throw slError(400, 'Close or cancel open documents using this UoM before changing its conversion rule.');
            }
          }
        }
      }
    },
    afterSave: async (client, ugpEntry) => {
      await client.query(`INSERT INTO "UGP1" ("UgpEntry", "LineNum", "UomEntry", "AltQty", "BaseQty")
        SELECT g."UgpEntry", COALESCE((SELECT MAX("LineNum") + 1 FROM "UGP1" WHERE "UgpEntry" = g."UgpEntry"), 0), g."BaseUom", 1, 1
        FROM "OUGP" g WHERE g."UgpEntry" = $1
          AND NOT EXISTS (SELECT 1 FROM "UGP1" WHERE "UgpEntry" = g."UgpEntry" AND "UomEntry" = g."BaseUom")`, [ugpEntry]);
    },
  },
  PaymentTermsTypes: {
    table: 'OCTG', key: 'GroupNum', generatedKey: true, uniqueKey: 'PymntGroup', label: 'Payment terms',
    required: { PymntGroup: 'payment terms code' },
    fields: {
      GroupNumber: 'GroupNum', PaymentTermsGroupName: 'PymntGroup', BaselineDate: 'BslineDate', StartFrom: 'PayDuMonth',
      NumberOfAdditionalMonths: 'ExtraMonth', NumberOfAdditionalDays: 'ExtraDays', ToleranceDays: 'TolDays',
      NumberOfInstallments: 'InstNum', OpenIncomingPaymentsByDueDate: 'OpenRcpt', CreditLimit: 'CredLimit',
      PriceListNo: 'ListNum', CashDiscountPercent: 'VolumDscnt', DiscountCode: 'DiscCode', PaymentMethod: 'PymCode',
      // Local columns (migration 014): the page's own short code and Load Limit Credit.
      PaymentTermsGroupCode: 'PymntCode', LoadLimitCredit: 'LoadLimit',
    },
    enums: {
      BaselineDate: { bld_PostingDate: 'P', bld_SystemDate: 'S', bld_DueDate: 'T', bld_TaxDate: 'T', bld_ClosingDate: 'C' },
      StartFrom: { ptsf_MonthEnd: 'E', ptsf_HalfMonth: 'H', ptsf_MonthStart: 'Y', ptsf_DayOfMonth: 'N' },
      OpenIncomingPaymentsByDueDate: { tYES: 'Y', tNO: 'N' },
    },
    children: {
      PaymentTermsInstallments: {
        table: 'CTG1', parentKey: 'CTGCode', orderBy: 'IntsNo',
        fields: { InstallmentNumber: 'IntsNo', Percent: 'InstPrcnt', NumberOfAdditionalMonths: 'InstMonth', NumberOfAdditionalDays: 'InstDays' },
      },
    },
    validate: async (client, row, existing, children) => {
      for (const column of ['ExtraMonth', 'ExtraDays', 'TolDays']) {
        if (toNumber(row[column]) < 0) throw slError(400, 'Months, days and tolerance days cannot be negative.');
      }
      if (hasValue(row.DiscCode) && !(await client.query('SELECT 1 FROM "OCDC" WHERE "Code"=$1', [row.DiscCode])).rowCount) {
        throw slError(400, 'Select an existing cash discount policy.');
      }
      const installments = children.PaymentTermsInstallments;
      if (installments && installments.length) {
        installments.forEach((line, index) => {
          line.IntsNo = index + 1;
          if (!(toNumber(line.InstPrcnt) > 0)) throw slError(400, `Installment ${index + 1}: enter a percentage greater than 0.`);
        });
        const total = roundTo(installments.reduce((sum, line) => sum + toNumber(line.InstPrcnt), 0), 4);
        if (total !== 100) throw slError(400, `Installment percentages must add up to 100 (now ${total}).`);
        row.InstNum = installments.length;
      } else if (installments) {
        row.InstNum = 1; // all installments removed: one payment
      }
    },
  },
  PriceLists: {
    table: 'OPLN', key: 'ListNum', generatedKey: true, uniqueKey: 'ListName', label: 'Price list',
    required: { ListName: 'price list name' },
    fields: {
      PriceListNo: 'ListNum', PriceListName: 'ListName', RoundingMethod: 'RoundSys', Active: 'ValidFor',
      IsGrossPrice: 'IsGrossPrc', BasePriceList: 'BASE_NUM', PriceListCurrency: 'PrimCurr',
    },
    enums: {
      RoundingMethod: { borm_NoRounding: 0, borm_Ceiling: 1, borm_Floor: 2, borm_Commercial: 3, borm_HalfUp: 4, borm_HalfDown: 5 },
    },
    validate: async (client, row, existing) => {
      if (hasValue(row.Factor) && !(toNumber(row.Factor) > 0)) throw slError(400, 'The factor must be greater than zero.');
      if (hasValue(row.BASE_NUM) && !(existing && Number(row.BASE_NUM) === Number(existing.ListNum))) {
        if (!(await client.query('SELECT 1 FROM "OPLN" WHERE "ListNum" = $1', [row.BASE_NUM])).rowCount) {
          throw slError(400, `Base price list ${row.BASE_NUM} does not exist.`);
        }
      }
      if (hasValue(row.PrimCurr) && !(await client.query('SELECT 1 FROM "OCRN" WHERE "CurrCode" = $1', [row.PrimCurr])).rowCount) {
        throw slError(400, `Currency "${row.PrimCurr}" does not exist.`);
      }
      // Stored dates come back as Date objects (local midnight), new ones as 'YYYY-MM-DD'.
      const day = (value) => (value instanceof Date ? value.toLocaleDateString('en-CA') : String(value).slice(0, 10));
      if (row.ValidFrom && row.ValidTo && day(row.ValidFrom) > day(row.ValidTo)) throw slError(400, 'Valid from must be on or before valid to.');
    },
    // SAP fills a new price list for every item from its base list x factor.
    afterSave: async (client, listNum, { existing }) => {
      if (existing) return;
      await client.query(`UPDATE "OPLN" SET "BASE_NUM" = COALESCE("BASE_NUM", "ListNum"), "Factor" = COALESCE("Factor", 1) WHERE "ListNum" = $1`, [listNum]);
      await client.query(`INSERT INTO "ITM1" ("ItemCode", "PriceList", "Price", "Currency", "BasePLNum", "Factor")
        SELECT i."ItemCode", p."ListNum", COALESCE(b."Price", 0) * p."Factor",
               COALESCE(p."PrimCurr", b."Currency", (SELECT "MainCurncy" FROM "OADM" LIMIT 1)), p."BASE_NUM", p."Factor"
        FROM "OITM" i JOIN "OPLN" p ON p."ListNum" = $1
        LEFT JOIN "ITM1" b ON b."ItemCode" = i."ItemCode" AND b."PriceList" = p."BASE_NUM" AND p."BASE_NUM" <> p."ListNum"
        ON CONFLICT DO NOTHING`, [listNum]);
    },
  },
  ShippingTypes: {
    table: 'OSHP', key: 'TrnspCode', generatedKey: true, uniqueKey: 'TrnspName', label: 'Shipping type',
    required: { TrnspName: 'shipping type name' },
    fields: { Code: 'TrnspCode', Name: 'TrnspName', Website: 'WebSite' },
    // SAP refuses to delete a shipping type in use.
    usedBy: [['OCRD', 'ShipType'], ['OITM', 'ShipType'], ...Object.values(DOCUMENTS).map((d) => [d.header, 'TrnspCode'])],
  },
  BusinessPlaces: {
    table: 'OBPL', key: 'BPLId', generatedKey: true, uniqueKey: 'BPLName', label: 'Branch',
    required: { BPLName: 'branch name' },
    extraColumn: 'SlExtra',
    fields: {
      BPLID: 'BPLId', BPLNameForeign: 'BPLFrName', DefaultWarehouseCode: 'DflWhs', DflWhs: 'DflWhs',
      FederalTaxID: 'TaxIdNum', AdditionalID: 'AddtnlId', TaxOfficeName: 'TaxOffice', GSTIN: 'GSTRegnNo',
    },
    flags: ['MainBPL', 'Disabled'],
    validate: async (client, row, existing) => {
      if (hasValue(row.GSTRegnNo) && !GSTIN.test(String(row.GSTRegnNo).toUpperCase())) {
        throw slError(400, `GSTIN "${row.GSTRegnNo}" is not valid.`);
      }
      // A new branch has no default warehouse until one is chosen (the table default '01'
      // belongs to the first branch); the rule is checked only when the warehouse changes.
      if (!existing && !hasValue(row.DflWhs)) row.DflWhs = null;
      if (hasValue(row.DflWhs) && row.DflWhs !== existing?.DflWhs) {
        const warehouse = (await client.query('SELECT "BPLid" FROM "OWHS" WHERE "WhsCode" = $1', [row.DflWhs])).rows[0];
        if (!warehouse) throw slError(400, `Warehouse "${row.DflWhs}" does not exist.`);
        if (existing && warehouse.BPLid != null && Number(warehouse.BPLid) !== Number(existing.BPLId)) {
          throw slError(400, `Warehouse "${row.DflWhs}" belongs to another branch.`);
        }
      }
      if (row.Disabled === 'Y' && (row.MainBPL === 'Y' || existing?.MainBPL === 'Y')) throw slError(400, 'The main branch cannot be disabled.');
      // SAP has one main branch: the first one. Later branches are not main.
      if (!existing) row.MainBPL = (await client.query('SELECT 1 FROM "OBPL"')).rowCount ? 'N' : 'Y';
      else if (row.MainBPL !== existing.MainBPL) row.MainBPL = existing.MainBPL;
    },
  },
  // Chart of accounts. Title accounts hold child accounts; only active accounts post.
  ChartOfAccounts: {
    table: 'OACT', key: 'AcctCode', label: 'G/L account',
    required: { AcctCode: 'G/L account code', AcctName: 'account name' },
    extraColumn: 'SlExtra',
    fields: {
      Code: 'AcctCode', Name: 'AcctName', ForeignName: 'FrgnName', AccountType: 'GroupMask', FatherAccountKey: 'FatherNum',
      ExternalCode: 'ExportCode', IsTitleAccount: 'Postable', ActiveAccount: 'FrozenFor', CashAccount: 'CashBox',
      AccountCurrency: 'ActCurr', TaxGroup: 'DfltTax', BudgetAccount: 'Budget', ProjectCode: 'Project', Remarks: 'Details',
      ControlAccount: 'LocManTran', RevaluationCoordinated: 'RevalMatch',
    },
    // The reader's account types (GroupMask) and SAP's inverted flags.
    enums: {
      AccountType: { sat_Assets: 1, sat_Liabilities: 2, sat_Equity: 3, sat_Revenues: 4, sat_Expenditure: 5, sat_Other: 6 },
      IsTitleAccount: { tYES: 'N', tNO: 'Y' },
      ActiveAccount: { tYES: 'N', tNO: 'Y' },
    },
    validate: async (client, row, existing) => {
      if (hasValue(row.FatherNum)) {
        if (row.FatherNum === row.AcctCode) throw slError(400, 'An account cannot be its own parent.');
        const father = (await client.query('SELECT "Postable", "Levels", "GroupMask" FROM "OACT" WHERE "AcctCode" = $1', [row.FatherNum])).rows[0];
        if (!father) throw slError(400, `Parent account "${row.FatherNum}" does not exist.`);
        if (father.Postable !== 'N') throw slError(400, `Parent account "${row.FatherNum}" must be a title account.`);
        row.Levels = toNumber(father.Levels, 1) + 1;
        if (!hasValue(row.GroupMask)) row.GroupMask = father.GroupMask;
      } else {
        row.Levels = 1;
      }
      if (!hasValue(row.GroupMask)) row.GroupMask = 6;
      row.ActType = { 4: 'I', 5: 'E' }[Number(row.GroupMask)] || 'N';
      if (hasValue(row.ActCurr) && row.ActCurr !== '##' && !(await client.query('SELECT 1 FROM "OCRN" WHERE "CurrCode" = $1', [row.ActCurr])).rowCount) {
        throw slError(400, `Currency "${row.ActCurr}" does not exist.`);
      }
      if (existing && existing.Postable !== row.Postable) {
        if (row.Postable === 'N' && (await client.query('SELECT 1 FROM "JDT1" WHERE "Account" = $1 LIMIT 1', [existing.AcctCode])).rowCount) {
          throw slError(400, 'An account with postings cannot become a title account.');
        }
        if (row.Postable === 'Y' && (await client.query('SELECT 1 FROM "OACT" WHERE "FatherNum" = $1', [existing.AcctCode])).rowCount) {
          throw slError(400, 'A title account with child accounts cannot become an active account.');
        }
      }
    },
  },
  // Bill of materials: one per product item (OITT), component/resource/text rows (ITT1).
  ProductTrees: {
    table: 'OITT', key: 'Code', label: 'Bill of materials', usedBy: [],
    required: { Code: 'product number' },
    fields: {
      TreeCode: 'Code', ProductDescription: 'Name', Quantity: 'Qauntity', Warehouse: 'ToWH', PlanAvgProdSize: 'PlAvgSize',
      DistributionRule: 'OcrCode', HideBOMComponentsInPrintout: 'HideComp',
    },
    enums: {
      TreeType: { iProductionTree: 'P', iSalesTree: 'S', iAssemblyTree: 'A', iTemplateTree: 'T' },
      HideBOMComponentsInPrintout: { tYES: 'Y', tNO: 'N' },
    },
    children: {
      ProductTreeLines: {
        table: 'ITT1', parentKey: 'Father', lineKey: 'ChildNum',
        fields: {
          ItemCode: 'Code', IssueMethod: 'IssueMthd', ItemType: 'Type', WipAccount: 'WipActCode', DistributionRule: 'OcrCode',
          AdditionalQuantity: 'AddQuant', StageID: 'StageId', VisualOrder: 'VisOrder',
        },
        enums: { IssueMethod: ISSUE_METHODS, ItemType: PRODUCTION_ITEM_TYPES },
      },
      ProductTreeStages: {
        table: 'ITT2', parentKey: 'Father', orderBy: 'SeqNum',
        fields: { StageID: 'StageId', SequenceNumber: 'SeqNum', StageEntry: 'StgEntry' },
      },
    },
    validate: async (client, row, existing, children) => {
      const stageIds = children.ProductTreeStages
        ? await validateStages(client, children.ProductTreeStages)
        : new Set((await client.query('SELECT "StageId" FROM "ITT2" WHERE "Father" = $1', [row.Code])).rows.map((stage) => Number(stage.StageId)));
      if (children.ProductTreeLines) assertRowStages(children.ProductTreeLines, stageIds, 'StageId');
      const product = (await client.query('SELECT "ItemName", "DfltWH", "InvntItem", "SellItem" FROM "OITM" WHERE "ItemCode" = $1', [row.Code])).rows[0];
      if (!product) throw slError(400, `Item "${row.Code}" does not exist.`);
      row.Name = product.ItemName;
      if (!hasValue(row.TreeType)) row.TreeType = 'P';
      // SAP BOM types: a production BOM makes an inventory item; sales and assembly
      // BOMs sell a non-inventory sales item built from their components.
      if (row.TreeType === 'P' && product.InvntItem !== 'Y') throw slError(400, `A production BOM needs an inventory item; "${row.Code}" is not one.`);
      if (['S', 'A'].includes(row.TreeType) && (product.InvntItem === 'Y' || product.SellItem !== 'Y')) {
        throw slError(400, `A ${row.TreeType === 'S' ? 'sales' : 'assembly'} BOM needs a sales item that is not an inventory item; "${row.Code}" is not one.`);
      }
      if (!(toNumber(row.Qauntity, 1) > 0)) throw slError(400, 'The BOM quantity must be greater than zero.');
      if (!hasValue(row.ToWH)) row.ToWH = product.DfltWH || (await getCompany(client)).DfltWhs;
      await assertWarehouses(client, [row.ToWH]);
      if (hasValue(row.PriceList) && !(await client.query('SELECT 1 FROM "OPLN" WHERE "ListNum" = $1', [row.PriceList])).rowCount) {
        throw slError(400, `Price list ${row.PriceList} does not exist.`);
      }
      const lines = children.ProductTreeLines;
      if (!lines) {
        if (!existing) throw slError(400, 'Add at least one component to the bill of materials.');
        return;
      }
      if (!lines.some((line) => Number(line.Type) !== -18)) throw slError(400, 'Add at least one component to the bill of materials.');
      let total = 0;
      for (const [index, line] of lines.entries()) {
        line.VisOrder = index;
        if (Number(line.Type) === -18) {
          Object.assign(line, { Code: null, Quantity: 0, LineText: line.LineText || line.Comment || '' });
          continue;
        }
        const component = await productionComponent(client, line, `Row ${index + 1}`, row.Code);
        if (component.Type === 290 && ['S', 'A'].includes(row.TreeType)) throw slError(400, `Row ${index + 1}: resources can only be used in production and template BOMs.`);
        if (!(toNumber(line.Quantity) > 0)) throw slError(400, `Row ${index + 1}: enter a quantity greater than zero.`);
        if (!hasValue(line.Warehouse)) line.Warehouse = component.DfltWH || row.ToWH;
        await assertWarehouses(client, [line.Warehouse]);
        // SAP prices each row from its price list (the row's, else the BOM's).
        const priceList = hasValue(line.PriceList) ? line.PriceList : row.PriceList;
        const price = hasValue(priceList) && Number(line.Type) === 4
          ? (await client.query('SELECT "Price", "Currency" FROM "ITM1" WHERE "ItemCode" = $1 AND "PriceList" = $2', [line.Code, priceList])).rows[0]
          : null;
        line.Price = toNumber(price?.Price);
        if (price?.Currency) line.Currency = price.Currency;
        total += line.Price * toNumber(line.Quantity);
      }
      row.Price = total;
    },
    // The item carries its BOM type, as in SAP (OITM.TreeType).
    // A production BOM rolls its components' standard cost (else average cost) up into
    // the product's production standard cost, per unit (SAP "update production std cost").
    afterSave: async (client, code) => {
      await client.query('UPDATE "OITM" SET "TreeType" = (SELECT "TreeType" FROM "OITT" WHERE "Code" = $1) WHERE "ItemCode" = $1', [code]);
      await client.query(`UPDATE "OITM" p SET "PrdStdCst" = (
          SELECT SUM(l."Quantity" * COALESCE(NULLIF(i."PrdStdCst", 0), i."AvgPrice", r."StdCost", 0)) / NULLIF(t."Qauntity", 0)
          FROM "OITT" t JOIN "ITT1" l ON l."Father" = t."Code"
          LEFT JOIN "OITM" i ON i."ItemCode" = l."Code" LEFT JOIN "ORSC" r ON r."ResCode" = l."Code"
          WHERE t."Code" = $1 GROUP BY t."Qauntity")
        WHERE p."ItemCode" = $1 AND EXISTS (SELECT 1 FROM "OITT" WHERE "Code" = $1 AND "TreeType" = 'P')`, [code]);
    },
    afterDelete: async (client, code) => {
      await client.query(`UPDATE "OITM" SET "TreeType" = 'N' WHERE "ItemCode" = $1`, [code]);
    },
  },
  // Production orders (OWOR/WOR1). Status: Planned -> Released -> Closed; Planned or
  // Released without postings -> Cancelled. Only planned orders can be edited.
  ProductionOrders: {
    table: 'OWOR', key: 'DocEntry', generatedKey: true, label: 'Production order',
    required: { ItemCode: 'product number', PlannedQty: 'planned quantity', DueDate: 'due date', Warehouse: 'warehouse' },
    fields: {
      AbsoluteEntry: 'DocEntry', DocumentNumber: 'DocNum', ItemNo: 'ItemCode', ProductDescription: 'ProdName',
      PlannedQuantity: 'PlannedQty', CompletedQuantity: 'CmpltQty', RejectedQuantity: 'RjctQty', PostingDate: 'PostDate',
      ProductionOrderStatus: 'Status', ProductionOrderType: 'Type', DistributionRule: 'OcrCode', JournalRemarks: 'JrnlMemo',
      Remarks: 'Comments', CustomerCode: 'CardCode', BPL_IDAssignedToInvoice: 'BPLId',
      ProductionOrderOrigin: 'OriginType', ProductionOrderOriginEntry: 'OriginAbs', ProductionOrderOriginNumber: 'OriginNum',
      UserSignature: 'UserSign', ClosingDate: 'CloseDate', PickRemarks: 'PickRmrk',
    },
    enums: {
      ProductionOrderStatus: { boposPlanned: 'P', boposReleased: 'R', boposClosed: 'L', boposCancelled: 'C' },
      ProductionOrderType: { bopotStandard: 'S', bopotSpecial: 'P', bopotDisassemble: 'D' },
      ProductionOrderOrigin: { bopooManual: 'M', bopooSalesOrder: 'S', bopooProductionOrder: 'P' },
    },
    children: {
      ProductionOrderLines: {
        table: 'WOR1', parentKey: 'DocEntry', lineKey: 'LineNum',
        fields: {
          LineNumber: 'LineNum', ItemNo: 'ItemCode', BaseQuantity: 'BaseQty', PlannedQuantity: 'PlannedQty', IssuedQuantity: 'IssuedQty',
          Warehouse: 'wareHouse', ProductionOrderIssueType: 'IssueType', DistributionRule: 'OcrCode', AdditionalQuantity: 'AdditQty',
          StageID: 'StageId', UoMCode: 'UomCode', VisualOrder: 'VisOrder',
        },
        enums: { ProductionOrderIssueType: ISSUE_METHODS, ItemType: PRODUCTION_ITEM_TYPES },
      },
      ProductionOrdersStages: {
        table: 'WOR4', parentKey: 'DocEntry', orderBy: 'SeqNum',
        fields: { StageID: 'StageId', SequenceNumber: 'SeqNum', StageEntry: 'StgEntry' },
      },
    },
    validate: async (client, row, existing, children) => {
      const lines = children.ProductionOrderLines;
      if (existing) {
        // Numbering and posted quantities never come from the page.
        for (const column of ['DocNum', 'Series', 'CmpltQty', 'RjctQty', 'PostDate']) row[column] = existing[column];
        const edited = lines !== undefined || row.ItemCode !== existing.ItemCode || row.Warehouse !== existing.Warehouse
          || row.Type !== existing.Type || toNumber(row.PlannedQty) !== toNumber(existing.PlannedQty);
        if (edited && existing.Status !== 'P') throw slError(400, 'Only planned production orders can be changed.');
        if (row.Status !== existing.Status) {
          const allowed = { P: ['R', 'C'], R: ['L', 'C'] }[existing.Status] || [];
          if (!allowed.includes(row.Status)) {
            throw slError(400, `Production order ${existing.DocNum} cannot change from ${PRODUCTION_STATUS_LABEL[existing.Status]} to ${PRODUCTION_STATUS_LABEL[row.Status] || row.Status}.`);
          }
          const posted = toNumber(existing.CmpltQty) + toNumber(existing.RjctQty) > 0
            || (await client.query('SELECT 1 FROM "WOR1" WHERE "DocEntry" = $1 AND "IssuedQty" <> 0', [existing.DocEntry])).rowCount > 0;
          if (row.Status === 'C' && posted) throw slError(400, `Production order ${existing.DocNum} has issues or receipts; close it instead of cancelling.`);
        }
        // Closing stamps the actual closing date (the variance entry is posted on it).
        if (row.Status === 'L' && existing.Status !== 'L') {
          if (!hasValue(row.CloseDate)) row.CloseDate = localToday();
          if (String(row.CloseDate).slice(0, 10) < localDay(existing.PostDate)) throw slError(400, 'The closing date cannot be before the order date.');
        } else if (row.Status !== 'L') {
          row.CloseDate = existing.CloseDate ?? null;
        }
        if (!edited) return;
      } else {
        if (!hasValue(row.Status)) row.Status = 'P';
        if (!['P', 'R'].includes(row.Status)) throw slError(400, 'A new production order can only be Planned or Released.');
        if (!hasValue(row.PostDate)) row.PostDate = localToday();
        Object.assign(row, { CmpltQty: 0, RjctQty: 0 },
          await assignDocNum(client, { table: 'OWOR', objType: '202', subType: '--', series: row.Series, manualDocNum: null, period: await getPostingPeriod(client, row.PostDate) }));
      }
      if (!hasValue(row.Type)) row.Type = 'S';
      if (!hasValue(row.StartDate)) row.StartDate = row.PostDate;
      if (!(toNumber(row.PlannedQty) > 0)) throw slError(400, 'The planned quantity must be greater than zero.');
      const product = (await client.query('SELECT "ItemName", "InvntItem" FROM "OITM" WHERE "ItemCode" = $1', [row.ItemCode])).rows[0];
      if (!product) throw slError(400, `Item "${row.ItemCode}" does not exist.`);
      if (product.InvntItem !== 'Y') throw slError(400, `Item "${row.ItemCode}" is not an inventory item.`);
      row.ProdName = product.ItemName;
      await applyProductionOrigin(client, row);
      if (hasValue(row.UserSign)) {
        if (!(await client.query('SELECT 1 FROM "OUSR" WHERE "USERID" = $1', [row.UserSign])).rowCount) throw slError(400, `User ${row.UserSign} does not exist.`);
      } else if (!existing) {
        row.UserSign = await currentUserSign(client);
      }
      await assertWarehouses(client, [row.Warehouse]);
      const bom = (await client.query('SELECT * FROM "OITT" WHERE "Code" = $1', [row.ItemCode])).rows[0];
      if (row.Type !== 'P' && !bom) throw slError(400, `Item "${row.ItemCode}" has no bill of materials; create one first.`);
      // A standard order without rows takes its components from the BOM, scaled to the planned quantity.
      if (!lines && bom && !existing) {
        const factor = toNumber(row.PlannedQty) / (toNumber(bom.Qauntity, 1) || 1);
        children.ProductionOrderLines = (await client.query('SELECT * FROM "ITT1" WHERE "Father" = $1 ORDER BY "ChildNum"', [bom.Code])).rows
          .map((line) => ({
            ItemCode: line.Code, LineText: line.LineText, ItemType: line.Type, BaseQty: line.Quantity, PlannedQty: toNumber(line.Quantity) * factor,
            wareHouse: line.Warehouse, IssueType: line.IssueMthd, OcrCode: line.OcrCode, Project: line.Project, AdditQty: line.AddQuant, StageId: line.StageId,
          }));
      }
      // Route stages come from the BOM when the page sends none.
      if (!children.ProductionOrdersStages && bom && !existing) {
        children.ProductionOrdersStages = (await client.query('SELECT "StageId", "StgEntry", "Name" FROM "ITT2" WHERE "Father" = $1 ORDER BY "SeqNum"', [bom.Code])).rows;
      }
      const stageIds = children.ProductionOrdersStages
        ? await validateStages(client, children.ProductionOrdersStages)
        : new Set((await client.query('SELECT "StageId" FROM "WOR4" WHERE "DocEntry" = $1', [existing?.DocEntry ?? 0])).rows.map((stage) => Number(stage.StageId)));
      if (children.ProductionOrderLines) assertRowStages(children.ProductionOrderLines, stageIds, 'StageId');
      if (existing && !children.ProductionOrderLines) return;
      const rows = children.ProductionOrderLines || [];
      if (!rows.some((line) => Number(line.ItemType) !== -18)) throw slError(400, 'Add at least one component to the production order.');
      for (const [index, line] of rows.entries()) {
        Object.assign(line, { VisOrder: index, IssuedQty: 0 });
        if (Number(line.ItemType) === -18) {
          Object.assign(line, { ItemCode: null, PlannedQty: 0 });
          continue;
        }
        const component = await productionComponent(client, { ...line, Type: line.ItemType, Code: line.ItemCode }, `Row ${index + 1}`, row.ItemCode);
        line.ItemType = component.Type;
        line.ItemName = component.ItemName;
        // A negative planned quantity is a by-product (standard / special orders, manual issue, items only).
        const planned = toNumber(line.PlannedQty);
        if (planned === 0) throw slError(400, `Row ${index + 1}: enter a planned quantity.`);
        if (planned < 0 && (row.Type === 'D' || component.Type !== 4)) throw slError(400, `Row ${index + 1}: only item rows of a standard or special order can be by-products.`);
        if (!hasValue(line.IssueType)) line.IssueType = planned < 0 ? 'M' : component.IssueMthd || 'M';
        // Disassembly rows are received, never issued, so backflush does not apply.
        if (row.Type === 'D') line.IssueType = 'M';
        if (line.IssueType === 'B') {
          if (planned < 0) throw slError(400, `Row ${index + 1}: a by-product uses the manual issue method.`);
          if (component.ManBtchNum === 'Y' || component.ManSerNum === 'Y') {
            throw slError(400, `Row ${index + 1}: item "${line.ItemCode}" is managed by batch or serial numbers and cannot be backflushed; use the manual issue method.`);
          }
        }
        if (!hasValue(line.BaseQty)) line.BaseQty = toNumber(line.PlannedQty) / toNumber(row.PlannedQty);
        if (!hasValue(line.wareHouse)) line.wareHouse = component.DfltWH || row.Warehouse;
        if (!hasValue(line.UomCode)) line.UomCode = component.InvntryUom || null;
        await assertWarehouses(client, [line.wareHouse]);
      }
    },
    // Closing a released order posts what is left in WIP as variance.
    afterSave: async (client, entry, { existing, schema }) => {
      if (existing?.Status !== 'R') return;
      const { Status } = (await client.query('SELECT "Status" FROM "OWOR" WHERE "DocEntry" = $1', [entry])).rows[0];
      if (Status === 'L') await postProductionVariance(client, schema, entry);
    },
  },
  // Item master (OITM). Field map generated from the page's reader
  // (scripts/generateLocalItemFields.js); GET answers through that reader too.
  Items: {
    table: 'OITM',
    key: 'ItemCode',
    label: 'Item',
    required: { ItemCode: 'item code', ItemName: 'item description' },
    fields: { ...ITEM_FIELDS.fields, Series: 'Series' },
    enums: Object.fromEntries(Object.entries(ITEM_FIELDS.enums).map(([property, map]) => [property, reverse(map)])),
    read: (row) => require('./itemDbService').mapHeaderRow(row),
    accounts: ['IncomeAcct', 'ExmptIncom', 'ExpensAcct', 'FrgnInAcct', 'ECInAcct', 'FrgnExpAcc', 'ECExpAcc'],
    children: {
      ItemBarCodeCollection: {
        table: 'OBCD', parentKey: 'ItemCode', orderBy: 'BcdEntry',
        fields: { AbsEntry: 'BcdEntry', Barcode: 'BcdCode', UoMEntry: 'UomEntry', FreeText: 'BcdName' },
      },
      ItemPreferredVendors: { table: 'ITM2', parentKey: 'ItemCode', orderBy: 'VendorCode', fields: { BPCode: 'VendorCode' } },
    },
    validate: async (client, row, existing) => {
      // SAP uses -1 for "none" on reference fields; here "none" is NULL so foreign keys hold.
      for (const [column, kind] of Object.entries(ITEM_FIELDS.kinds)) {
        if (kind === 'int' && Number(row[column]) === -1) row[column] = null;
      }
      if (!existing && hasValue(row.Series)) {
        const { code } = await assignMasterCode(client, row.Series, { objectCodes: ['4', 'OITM'], label: 'item', digits: 6 });
        if (code) row.ItemCode = code;
      }
      if (!hasValue(row.ItmsGrpCod)) {
        row.ItmsGrpCod = (await client.query('SELECT MIN("ItmsGrpCod") AS "Code" FROM "OITB"')).rows[0].Code;
        if (row.ItmsGrpCod === null) throw slError(400, 'Create an item group first.');
      }
      if (row.InvntItem === 'Y' && row.ItemType && row.ItemType !== 'I') {
        throw slError(400, 'Only items of type Items can be inventory items.');
      }
      if (row.SellItem === 'N' && row.PrchseItem === 'N' && row.InvntItem === 'N') {
        throw slError(400, 'Select at least one of inventory, sales or purchase item.');
      }
      if (hasValue(row.DfltWH)) {
        const warehouse = (await client.query('SELECT "Inactive" FROM "OWHS" WHERE "WhsCode" = $1', [row.DfltWH])).rows[0];
        if (!warehouse) throw slError(400, `Warehouse "${row.DfltWH}" does not exist.`);
        if (warehouse.Inactive === 'Y') throw slError(400, `Warehouse "${row.DfltWH}" is inactive.`);
      }
      for (const [column, side, label] of [['TaxCodeAR', 'ValidForAR', 'sales'], ['TaxCodeAP', 'ValidForAP', 'purchasing']]) {
        if (!hasValue(row[column])) continue;
        const tax = (await client.query(`SELECT "Lock", "${side}" AS "Valid" FROM "OSTC" WHERE "Code" = $1`, [row[column]])).rows[0];
        if (!tax) throw slError(400, `Tax code "${row[column]}" does not exist.`);
        if (tax.Lock === 'Y' || tax.Valid === 'N') throw slError(400, `Tax code "${row[column]}" is not active for ${label}.`);
      }
      if (existing) {
        // SAP: once an item has stock or transactions these define how they were valued and counted.
        const changed = (column) => hasValue(row[column]) && String(row[column]) !== String(existing[column]);
        const locked = ['EvalSystem', 'ManBtchNum', 'ManSerNum', 'UgpEntry', 'InvntItem'].filter(changed);
        if (locked.length && await itemHasActivity(client, existing.ItemCode)) {
          throw slError(400, `Item "${existing.ItemCode}" already has stock or documents; ${locked.join(', ')} cannot change.`);
        }
      }
    },
    // SAP keeps one row per item and warehouse and per item and price list.
    afterSave: async (client, itemCode, { data }) => {
      await client.query(`INSERT INTO "OITW" ("ItemCode", "WhsCode") SELECT $1, "WhsCode" FROM "OWHS"
        ON CONFLICT DO NOTHING`, [itemCode]);
      await client.query(`INSERT INTO "ITM1" ("ItemCode", "PriceList", "Currency", "BasePLNum", "Factor")
        SELECT $1, "ListNum", COALESCE("PrimCurr", (SELECT "MainCurncy" FROM "OADM" LIMIT 1)), "BASE_NUM", COALESCE("Factor", 1)
        FROM "OPLN" ON CONFLICT DO NOTHING`, [itemCode]);
      for (const price of data.ItemPrices || []) {
        const priceValue = toNumber(price.Price, 0);
        if (priceValue < 0) throw slError(400, 'Prices cannot be negative.');
        const { rowCount } = await client.query(`UPDATE "ITM1" SET "Price" = $3, "Currency" = COALESCE($4, "Currency"),
          "AddPrice1" = $5, "Currency1" = $6, "AddPrice2" = $7, "Currency2" = $8, "Factor" = $9
          WHERE "ItemCode" = $1 AND "PriceList" = $2`, [itemCode, price.PriceList, priceValue, price.Currency || null,
          toNumber(price.AdditionalPrice1, 0), price.AdditionalCurrency1 || null, toNumber(price.AdditionalPrice2, 0),
          price.AdditionalCurrency2 || null, toNumber(price.Factor, 1)]);
        if (!rowCount) throw slError(400, `Price list ${price.PriceList} does not exist.`);
      }
      for (const info of data.ItemWarehouseInfoCollection || []) {
        const { rowCount } = await client.query(`UPDATE "OITW" SET
          "MinStock" = COALESCE($3, "MinStock"), "MaxStock" = COALESCE($4, "MaxStock"),
          "MinOrder" = COALESCE($5, "MinOrder"), "Locked" = COALESCE($6, "Locked")
          WHERE "ItemCode" = $1 AND "WhsCode" = $2`, [itemCode, info.WarehouseCode,
          hasValue(info.MinimalStock) ? toNumber(info.MinimalStock) : null,
          hasValue(info.MaximalStock) ? toNumber(info.MaximalStock) : null,
          hasValue(info.MinimalOrder) ? toNumber(info.MinimalOrder) : null,
          hasValue(info.Locked) ? toSapValue('Locked', info.Locked) : null]);
        if (!rowCount) throw slError(400, `Warehouse "${info.WarehouseCode}" does not exist.`);
      }
    },
  },
  // HSN codes (SAP India "Chapter ID", OCHP). ChapterID is the HSN printed on
  // documents; Chapter/Heading/SubHeading are its 2/2/4-digit parts.
  ChapterIDs: {
    table: 'OCHP',
    key: 'AbsEntry',
    generatedKey: true,
    uniqueKey: 'ChapterID',
    label: 'HSN code',
    required: { ChapterID: 'HSN code', Dscription: 'description' },
    fields: { Description: 'Dscription' },
    validate: async (client, row) => {
      row.ChapterID = String(row.ChapterID).trim();
      if (!/^(\d{4}|\d{6}|\d{8})$/.test(row.ChapterID)) throw slError(400, 'An HSN code has 4, 6 or 8 digits.');
      row.Chapter = row.ChapterID.slice(0, 2);
      row.Heading = row.ChapterID.slice(2, 4);
      row.SubHeading = row.ChapterID.slice(4);
    },
  },
  // SAC codes (OSAC): GST services accounting codes, 6 digits starting with 99.
  SACCodes: {
    table: 'OSAC',
    key: 'AbsEntry',
    generatedKey: true,
    uniqueKey: 'ServCode',
    label: 'SAC code',
    required: { ServCode: 'SAC code', ServName: 'service name' },
    fields: { ServiceCode: 'ServCode', ServiceName: 'ServName' },
    validate: async (client, row) => {
      row.ServCode = String(row.ServCode).trim();
      if (!/^99\d{4}$/.test(row.ServCode)) throw slError(400, 'A SAC code has 6 digits and starts with 99.');
    },
  },
};

// ---- business partner collections -----------------------------------------------------
// India GSTIN: 2-digit state, PAN (5 letters, 4 digits, letter), entity, 'Z', check character.
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const ADDRESS_FIELDS = {
  AddressName: 'Address', AddressName2: 'Address2', AddressName3: 'Address3', AddressType: 'AdresType',
  BuildingFloorRoom: 'Building', GSTIN: 'GSTRegnNo', GstType: 'GSTType', RowNum: 'LineNum', BPCode: 'CardCode',
};
// ponytail: GstType numbers follow SAP's BoGSTType order as the BP page lists it; confirm against an SAP India company.
const ADDRESS_ENUMS = {
  AddressType: { bo_BillTo: 'B', bo_ShipTo: 'S' },
  GstType: {
    gstRegularTDSISD: 1, gstCasualTaxablePerson: 2, gstCompositionLevy: 3, gstGoverDepartPSU: 4,
    gstNonResidentTaxablePerson: 5, gstUNAgencyEmbassy: 6,
  },
};
const CONTACT_FIELDS = { InternalCode: 'CntctCode', Phone1: 'Tel1', Phone2: 'Tel2', MobilePhone: 'Cellolar', E_Mail: 'E_MailL' };

// SL PATCH semantics: a row matching by key (RowNum / InternalCode) or by name is
// updated, a new name is added, rows not sent are kept. Extra properties are kept too.
const mergeCollection = async (client, { table, cardCode, sources, fields, enums, keyColumn, matchColumns, label }) => {
  if (!Array.isArray(sources)) return;
  const columns = await getColumns(client, (await client.query('SELECT current_schema() AS s')).rows[0].s, table);
  for (const source of sources) {
    const { row, unmapped } = toRow(source, fields, columns, enums);
    delete row.CardCode;
    if (!hasValue(row[matchColumns[0]])) throw slError(400, `Enter the ${label} name.`);
    const current = (await client.query(`SELECT * FROM ${quote(table)} WHERE "CardCode" = $1`, [cardCode])).rows;
    const target = (hasValue(row[keyColumn]) && current.find((existing) => Number(existing[keyColumn]) === Number(row[keyColumn])))
      || current.find((existing) => matchColumns.every((column) => String(existing[column] ?? '') === String(row[column] ?? '')));
    const extra = JSON.stringify({ ...(target?.SlExtra || {}), ...unmapped });
    if (target) {
      delete row[keyColumn];
      const keys = Object.keys(row);
      await client.query(
        `UPDATE ${quote(table)} SET ${[...keys, 'SlExtra'].map((column, i) => `${quote(column)} = $${i + 3}`).join(', ')}
         WHERE "CardCode" = $1 AND ${quote(keyColumn)} = $2`,
        [cardCode, target[keyColumn], ...keys.map((column) => row[column]), extra],
      );
    } else {
      if (table === 'CRD1') row.LineNum = Math.max(-1, ...current.map((existing) => existing.LineNum)) + 1;
      else delete row[keyColumn];
      await insertRow(client, table, columns, { ...row, CardCode: cardCode, SlExtra: extra });
    }
  }
};

const mergeBpAddresses = async (client, cardCode, addresses) => {
  for (const address of addresses || []) {
    const gstin = String(address.GSTIN || '').toUpperCase();
    if (gstin && !GSTIN.test(gstin)) throw slError(400, `GSTIN "${address.GSTIN}" on address "${address.AddressName}" is not valid.`);
    if (address.AddressType && !ADDRESS_ENUMS.AddressType[address.AddressType]) throw slError(400, 'Address type must be bill-to or ship-to.');
    if (!address.AddressType) address.AddressType = 'bo_BillTo';
  }
  await mergeCollection(client, {
    table: 'CRD1', cardCode, sources: addresses, fields: ADDRESS_FIELDS, enums: ADDRESS_ENUMS,
    keyColumn: 'LineNum', matchColumns: ['Address', 'AdresType'], label: 'address',
  });
};

const mergeBpContacts = (client, cardCode, contacts) => mergeCollection(client, {
  table: 'OCPR', cardCode, sources: contacts, fields: CONTACT_FIELDS, enums: ENUMS,
  keyColumn: 'CntctCode', matchColumns: ['Name'], label: 'contact person',
});

// SAP keeps a default bill-to/ship-to and contact on the BP and copies the
// default addresses onto OCRD, which documents and reports read.
const syncBpDefaults = async (client, cardCode) => {
  await client.query(`UPDATE "OCRD" c SET
      "BillToDef" = COALESCE((SELECT "Address" FROM "CRD1" WHERE "CardCode" = c."CardCode" AND "AdresType" = 'B' AND "Address" = c."BillToDef"),
                             (SELECT "Address" FROM "CRD1" WHERE "CardCode" = c."CardCode" AND "AdresType" = 'B' ORDER BY "LineNum" LIMIT 1)),
      "ShipToDef" = COALESCE((SELECT "Address" FROM "CRD1" WHERE "CardCode" = c."CardCode" AND "AdresType" = 'S' AND "Address" = c."ShipToDef"),
                             (SELECT "Address" FROM "CRD1" WHERE "CardCode" = c."CardCode" AND "AdresType" = 'S' ORDER BY "LineNum" LIMIT 1)),
      "CntctPrsn" = COALESCE((SELECT "Name" FROM "OCPR" WHERE "CardCode" = c."CardCode" AND "Name" = c."CntctPrsn"),
                             (SELECT "Name" FROM "OCPR" WHERE "CardCode" = c."CardCode" ORDER BY "CntctCode" LIMIT 1))
    WHERE c."CardCode" = $1`, [cardCode]);
  await client.query(`UPDATE "OCRD" c SET
      "Address" = b."Street", "City" = b."City", "ZipCode" = b."ZipCode", "County" = b."County", "State1" = b."State", "Country" = b."Country"
    FROM "CRD1" b WHERE c."CardCode" = $1 AND b."CardCode" = c."CardCode" AND b."AdresType" = 'B' AND b."Address" = c."BillToDef"`, [cardCode]);
  await client.query(`UPDATE "OCRD" c SET
      "MailAddres" = s."Street", "MailCity" = s."City", "MailZipCod" = s."ZipCode", "MailCounty" = s."County", "State2" = s."State", "MailCountr" = s."Country"
    FROM "CRD1" s WHERE c."CardCode" = $1 AND s."CardCode" = c."CardCode" AND s."AdresType" = 'S' AND s."Address" = c."ShipToDef"`, [cardCode]);
};

// Master numbering (items: 6 digits, BPs: 5): SAP assigns the code from the
// series at save time, under a lock, as prefix + number + suffix (the format the pages preview).
const assignMasterCode = async (client, series, { objectCodes, label, digits, subType }) => {
  const row = (await client.query(
    'SELECT * FROM "NNM1" WHERE "Series" = $1 AND "ObjectCode" = ANY($2) FOR UPDATE', [series, objectCodes],
  )).rows[0];
  if (!row) throw slError(400, `Series ${series} is not a ${label} numbering series.`);
  if (subType && row.DocSubType && !['--', subType].includes(row.DocSubType)) {
    throw slError(400, `Series "${row.SeriesName}" is not for this ${label} type.`);
  }
  if (row.Locked === 'Y') throw slError(400, `Series "${row.SeriesName}" is locked.`);
  if (row.IsManual === 'Y') return { Series: series, code: null };
  const next = toNumber(row.NextNumber, 1);
  if (hasValue(row.LastNum) && next > Number(row.LastNum)) throw slError(400, `Series "${row.SeriesName}" has reached its last number.`);
  await client.query('UPDATE "NNM1" SET "NextNumber" = $1 WHERE "Series" = $2', [next + 1, series]);
  return { Series: series, code: `${row.BeginStr || ''}${String(next).padStart(digits, '0')}${row.EndStr || ''}` };
};

const DOCUMENT_ITEM_LINE_TABLES = [...new Set(Object.values(DOCUMENTS).map((d) => d.lines))];
const itemHasActivity = async (client, itemCode) => (await client.query(
  [`SELECT 1 FROM "OITW" WHERE "ItemCode" = $1 AND ("OnHand" <> 0 OR "IsCommited" <> 0 OR "OnOrder" <> 0)`,
    ...DOCUMENT_ITEM_LINE_TABLES.map((table) => `SELECT 1 FROM ${quote(table)} WHERE "ItemCode" = $1`)].join(' UNION ALL ') + ' LIMIT 1',
  [itemCode],
)).rowCount > 0;

// SAP keeps posted documents reproducible: once a tax code is used on a
// document line, its components (and their rates) cannot change. Make a new
// code and set the old one inactive instead.
const DOCUMENT_LINE_TABLES = [...new Set(Object.values(DOCUMENTS).flatMap((d) => [d.lines, d.expenses].filter(Boolean)))];
const assertTaxNotPosted = async (client, label, key, codesSql, params) => {
  const codes = (await client.query(codesSql, params)).rows.map((row) => row.Code);
  if (!codes.length) return;
  const used = (await client.query(
    DOCUMENT_LINE_TABLES.map((table) => `SELECT 1 FROM ${quote(table)} WHERE "TaxCode" = ANY($1)`).join(' UNION ALL ') + ' LIMIT 1',
    [codes],
  )).rowCount > 0;
  if (used) {
    throw slError(400, `${label} "${key}" is already used in documents; its rate or components cannot change. Create a new one and set this one inactive.`);
  }
};

// SAP refuses unknown, title (non-postable) or inactive G/L accounts on masters.
const validateAccounts = async (client, codes) => {
  const unique = [...new Set(codes.filter(hasValue))];
  if (!unique.length) return;
  const found = new Map((await client.query(
    'SELECT "AcctCode", "Postable", "FrozenFor" FROM "OACT" WHERE "AcctCode" = ANY($1)', [unique],
  )).rows.map((account) => [account.AcctCode, account]));
  for (const code of unique) {
    const account = found.get(code);
    if (!account) throw slError(400, `G/L account "${code}" does not exist.`);
    if (account.Postable === 'N') throw slError(400, `G/L account "${code}" is a title account; select an active account.`);
    if (account.FrozenFor === 'Y') throw slError(400, `G/L account "${code}" is inactive.`);
  }
};

const readMaster = async (client, entity, key) => {
  const definition = MASTERS[entity];
  const row = (await client.query(
    `SELECT * FROM ${quote(definition.table)} WHERE ${quote(definition.key)} = $1`, [key],
  )).rows[0];
  if (!row) throw slError(404, `No matching records found (${definition.label} "${key}").`);
  const toSl = (record, fields, flagList = [], enums = {}) => {
    const reverseFields = reverse(fields);
    const flags = new Set(flagList);
    return Object.fromEntries(Object.entries(record).map(([column, value]) => {
      const property = reverseFields[column] || column;
      if (flags.has(column)) return [property, value === 'Y' ? 'tYES' : 'tNO'];
      if (enums[property]) return [property, reverse(enums[property])[value] ?? value];
      return [property, toSlValue(column, value)];
    }));
  };
  const result = definition.read ? await definition.read(row, client, toSl) : toSl(row, definition.fields, definition.flags, definition.enums);
  if (definition.extraColumn) {
    const extras = row[definition.extraColumn] || {};
    delete result[definition.extraColumn];
    for (const [property, value] of Object.entries(extras)) if (!(property in result)) result[property] = value;
  }
  for (const [property, child] of Object.entries(definition.children || {})) {
    const { rows } = await client.query(
      `SELECT * FROM ${quote(child.table)} WHERE ${quote(child.parentKey)} = $1 ORDER BY ${quote(child.lineKey || child.orderBy)}`, [key],
    );
    result[property] = rows.map((childRow) => toSl(childRow, child.fields, [], child.enums));
  }
  return result;
};

const deleteMaster = async (schema, entity, key) => withTransaction(schema, async (client) => {
  const definition = MASTERS[entity];
  if (!definition.usedBy) throw slError(501, `Deleting ${definition.label.toLowerCase()} records is not supported.`);
  const existing = (await client.query(
    `SELECT 1 FROM ${quote(definition.table)} WHERE ${quote(definition.key)} = $1 FOR UPDATE`, [key],
  )).rowCount;
  if (!existing) throw slError(404, `No matching records found (${definition.label} "${key}").`);
  const used = definition.usedBy.length > 0 && (await client.query(
    definition.usedBy.map(([table, column]) => `SELECT 1 FROM ${quote(table)} WHERE ${quote(column)} = $1`).join(' UNION ALL ') + ' LIMIT 1',
    [key],
  )).rowCount > 0;
  if (used) throw slError(400, `${definition.label} ${key} is in use and cannot be deleted.`);
  for (const child of new Set(Object.values(definition.children || {}).map((c) => `${c.table}|${c.parentKey}`))) {
    const [table, parentKey] = child.split('|');
    await client.query(`DELETE FROM ${quote(table)} WHERE ${quote(parentKey)} = $1`, [key]);
  }
  await client.query(`DELETE FROM ${quote(definition.table)} WHERE ${quote(definition.key)} = $1`, [key]);
  await definition.afterDelete?.(client, key);
  await logWrite(client, { entity, objType: null, docEntry: null, method: `DELETE ${key}`, payload: {}, unmapped: {} });
});

// POST (key undefined) or PATCH of a master object; returns the saved object.
const saveMaster = async (schema, entity, key, data = {}) => withTransaction(schema, async (client) => {
  const definition = MASTERS[entity];
  const columns = await getColumns(client, schema, definition.table);
  const { row, unmapped } = toRow(data, definition.fields, columns, definition.enums || ENUMS);
  // Collections handled by afterSave are not "unmapped".
  [...(definition.collections || []), ...Object.keys(definition.children || {})].forEach((property) => delete unmapped[property]);
  let existing = null;
  if (key !== undefined) {
    existing = (await client.query(
      `SELECT * FROM ${quote(definition.table)} WHERE ${quote(definition.key)} = $1 FOR UPDATE`, [key],
    )).rows[0];
    if (!existing) throw slError(404, `No matching records found (${definition.label} "${key}").`);
    if (!definition.generatedKey && hasValue(row[definition.key]) && row[definition.key] !== key) {
      throw slError(400, `The ${definition.required[definition.key]} cannot be changed.`);
    }
  }
  // Everything else the page sent is kept with the record (and merged on later saves).
  if (definition.extraColumn) {
    const extras = Object.fromEntries(Object.entries(unmapped).filter(([property]) => !(property in (definition.children || {}))));
    if (Object.keys(extras).length || !existing) {
      row[definition.extraColumn] = JSON.stringify({ ...(existing?.[definition.extraColumn] || {}), ...extras });
    }
    Object.keys(extras).forEach((property) => delete unmapped[property]);
  }
  // A generated key (AbsEntry) is never taken from the payload.
  if (existing || definition.generatedKey) delete row[definition.key];
  const merged = { ...(existing || {}), ...row };
  for (const [column, label] of Object.entries(definition.required)) {
    if (!hasValue(merged[column])) throw slError(400, `Enter the ${label}.`);
  }
  // Uniqueness is on the business code: the key, or uniqueKey when the key is generated.
  const uniqueColumn = definition.uniqueKey || definition.key;
  if (!existing || merged[uniqueColumn] !== existing[uniqueColumn]) {
    const duplicate = (await client.query(
      `SELECT 1 FROM ${quote(definition.table)} WHERE ${quote(uniqueColumn)} = $1`, [merged[uniqueColumn]],
    )).rowCount > 0;
    if (duplicate) throw slError(400, `${definition.label} "${merged[uniqueColumn]}" already exists.`);
  }
  await validateAccounts(client, (definition.accounts || []).map((column) => row[column]));
  // Child collections (e.g. tax code rows) are replaced as a whole when sent.
  const children = {};
  for (const [property, child] of Object.entries(definition.children || {})) {
    if (!Array.isArray(data[property])) continue;
    const childColumns = await getColumns(client, schema, child.table);
    children[property] = data[property].map((source, index) => {
      const mapped = toRow(source, child.fields, childColumns, child.enums || ENUMS);
      if (Object.keys(mapped.unmapped).length) unmapped[`${property}[${index}]`] = mapped.unmapped;
      return mapped.row;
    });
  }
  await definition.validate?.(client, merged, existing, children);
  await applyUserFields(client, definition.table, merged);
  // Values a validator derived (e.g. HSN chapter parts, a code's total rate) are saved too.
  for (const [column, value] of Object.entries(merged)) {
    // The key is fixed once a record exists; on create a validator may assign it (item series).
    if (columns.has(column) && (column !== definition.key || !existing) && (!existing || value !== existing[column])) row[column] = value;
  }

  let savedKey = existing ? key : row[definition.key];
  if (existing) {
    if (columns.has('updateDate')) row.updateDate = localToday();
    const keys = Object.keys(row).filter((column) => columns.has(column));
    if (keys.length) {
      await client.query(
        `UPDATE ${quote(definition.table)} SET ${keys.map((column, i) => `${quote(column)} = $${i + 2}`).join(', ')}
         WHERE ${quote(definition.key)} = $1`,
        [key, ...keys.map((column) => row[column])],
      );
    }
  } else {
    const inserted = await insertRow(client, definition.table, columns, row);
    savedKey = inserted[definition.key];
  }
  for (const [property, rows] of Object.entries(children)) {
    const child = definition.children[property];
    const childColumns = await getColumns(client, schema, child.table);
    await client.query(`DELETE FROM ${quote(child.table)} WHERE ${quote(child.parentKey)} = $1`, [savedKey]);
    for (const [index, childRow] of rows.entries()) {
      await insertRow(client, child.table, childColumns, {
        ...childRow, [child.parentKey]: savedKey, ...(child.lineKey ? { [child.lineKey]: index } : {}),
      });
    }
  }
  await definition.afterSave?.(client, savedKey, { data, existing, schema });
  await logWrite(client, {
    entity, objType: null, docEntry: null, method: `${existing ? 'PATCH' : 'POST'} ${savedKey}`, payload: data, unmapped,
  });
  return readMaster(client, entity, savedKey);
});

// ---- user-defined fields (SL UserFieldsMD) ---------------------------------------
//
// A UDF is a CUFD row (+ UFD1 valid values) and a physical "U_<Name>" column, as
// in SAP. A field on one marketing document header (or row) table is added to
// every marketing document header (or row) table, like SAP's "Marketing
// Documents" category. LocalUdfRule adds an optional formula and validation rule.

const MARKETING_DOCUMENTS = Object.values(DOCUMENTS).filter((d) => !d.inventory);
const MARKETING_HEADERS = [...new Set(MARKETING_DOCUMENTS.map((d) => d.header))];
const MARKETING_LINES = [...new Set(MARKETING_DOCUMENTS.map((d) => d.lines))];
const udfTableGroup = (table) => {
  if (MARKETING_HEADERS.includes(table)) return MARKETING_HEADERS;
  if (MARKETING_LINES.includes(table)) return MARKETING_LINES;
  return [table];
};
const lineTableOf = (table) => Object.values(DOCUMENTS).find((d) => d.header === table)?.lines;
// SL type -> CUFD TypeID, allowed SL subtypes -> CUFD EditType, PostgreSQL column type.
const UDF_TYPES = {
  db_Alpha: { id: 'A', label: 'Alphanumeric', subTypes: { st_None: '', st_Address: '?', st_Phone: '#' }, size: [1, 254, 10], sql: (size) => `VARCHAR(${size})` },
  db_Memo: { id: 'M', label: 'Text', subTypes: { st_None: '' }, sql: () => 'TEXT' },
  db_Numeric: { id: 'N', label: 'Numeric', subTypes: { st_None: '' }, size: [1, 11, 11], sql: () => 'INTEGER' },
  // ponytail: time is kept as 'HH:MM' text (SAP stores an HHMM integer); switch if a report needs time arithmetic.
  db_Date: { id: 'D', label: 'Date/Time', subTypes: { st_None: '', st_Time: 'T' }, sql: (_, subType) => (subType === 'T' ? 'VARCHAR(5)' : 'DATE') },
  db_Float: {
    id: 'B', label: 'Units and Totals', sql: () => 'NUMERIC(19,6)',
    subTypes: { st_Rate: 'R', st_Sum: 'S', st_Price: 'P', st_Quantity: 'Q', st_Percentage: '%', st_Measurement: 'M' },
  },
};
const UDF_TYPE_BY_ID = Object.fromEntries(Object.entries(UDF_TYPES).map(([name, type]) => [type.id, { name, ...type }]));
const UDF_DENIED_TABLES = new Set(['CUFD', 'UFD1', 'OADM', 'OUSR', 'USR6', 'NNM1', 'ONNM', 'NNM2', 'OFPR', 'OACP', 'OJDT', 'JDT1', 'OINM']);
const compiledExpressions = new Map();
const compileExpression = (source) => {
  if (!compiledExpressions.has(source)) compiledExpressions.set(source, require('./udfExpression').compile(source));
  return compiledExpressions.get(source);
};

const clearColumnCaches = (schema, tables) => {
  tables.forEach((table) => columnCache.delete(`${schema}.${table}`));
  require('./salesDocumentDbCompatibility').clearTableColumnCaches();
};

// A value checked against the field type; '' and null mean "no value".
const parseUdfValue = (type, subType, value, label) => {
  if (!hasValue(value)) return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
  if (type === 'N') {
    if (!/^-?\d+$/.test(text) || Math.abs(Number(text)) > 2147483647) throw slError(400, `${label} must be a whole number.`);
    return Number(text);
  }
  if (type === 'B') {
    if (!Number.isFinite(Number(text))) throw slError(400, `${label} must be a number.`);
    return Number(text);
  }
  if (type === 'D' && subType === 'T') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw slError(400, `${label} must be a time (HH:MM).`);
    return text;
  }
  if (type === 'D') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text.slice(0, 10)) || Number.isNaN(Date.parse(text.slice(0, 10)))) throw slError(400, `${label} must be a date (YYYY-MM-DD).`);
    return text.slice(0, 10);
  }
  return value instanceof Date ? text : String(value);
};
const sqlLiteral = (value) => (typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`);

const readUserField = async (client, table, fieldId) => {
  const field = (await client.query('SELECT * FROM "CUFD" WHERE "TableID" = $1 AND "FieldID" = $2', [table, fieldId])).rows[0];
  if (!field) throw slError(404, `No matching records found (user-defined field ${table} ${fieldId}).`);
  const values = (await client.query(
    'SELECT "FldValue", "Descr" FROM "UFD1" WHERE "TableID" = $1 AND "FieldID" = $2 ORDER BY "IndexID"', [table, fieldId],
  )).rows;
  const rule = (await client.query(
    'SELECT * FROM "LocalUdfRule" WHERE "TableID" = $1 AND lower("AliasID") = lower($2)', [table, field.AliasID],
  )).rows[0] || {};
  const type = UDF_TYPE_BY_ID[field.TypeID] || UDF_TYPES.db_Alpha;
  return {
    TableName: field.TableID, FieldID: field.FieldID, Name: field.AliasID, Description: field.Descr,
    Type: type.name || 'db_Alpha',
    SubType: Object.entries(type.subTypes).find(([, code]) => code === (field.EditType || ''))?.[0] || 'st_None',
    Size: field.SizeID, EditSize: field.EditSize, DefaultValue: field.Dflt ?? null,
    Mandatory: field.NotNull === 'Y' ? 'tYES' : 'tNO', LinkedTable: field.RTable || null, LinkedUDO: field.RelUDO || null,
    ValidValuesMD: values.map((value) => ({ Value: value.FldValue, Description: value.Descr })),
    Formula: rule.Formula || null, Validation: rule.Validation || null, ValidationMessage: rule.Message || null,
  };
};

// Checks the editable settings (SAP rules) and returns the CUFD/UFD1/rule values to store.
const prepareUserField = async (client, schema, table, current, data) => {
  const merged = { ...current, ...data };
  const type = UDF_TYPES[merged.Type];
  if (!type) throw slError(400, `Select a field type (${Object.keys(UDF_TYPES).join(', ')}).`);
  const subType = merged.SubType ?? (type.subTypes.st_None === '' ? 'st_None' : undefined);
  if (!(subType in type.subTypes)) throw slError(400, `Structure ${subType || '(none)'} is not valid for ${type.label} fields.`);
  const editType = type.subTypes[subType];
  const description = String(merged.Description || '').trim();
  if (!description || description.length > 80) throw slError(400, 'Enter a description (up to 80 characters).');
  let size = null;
  if (type.size) {
    size = toNumber(merged.EditSize ?? merged.Size, type.size[2]);
    if (!Number.isInteger(size) || size < type.size[0] || size > type.size[1]) throw slError(400, `Length must be ${type.size[0]}-${type.size[1]}.`);
    if (current && size < toNumber(current.EditSize)) throw slError(400, 'The length of an existing field cannot be reduced.');
  }
  const label = `"${description}"`;
  const values = (merged.ValidValuesMD || []).filter((value) => hasValue(value?.Value));
  const seen = new Set();
  const validValues = values.map((value) => {
    const parsed = parseUdfValue(type.id, editType, value.Value, `Valid value of ${label}`);
    const key = String(parsed).toLowerCase();
    if (seen.has(key)) throw slError(400, `Valid value "${value.Value}" is entered twice.`);
    seen.add(key);
    if (size && String(parsed).length > size) throw slError(400, `Valid value "${value.Value}" is longer than ${size} characters.`);
    return { value: String(parsed), description: String(value.Description || parsed).slice(0, 254) };
  });
  const defaultValue = parseUdfValue(type.id, editType, merged.DefaultValue, `Default value of ${label}`);
  if (defaultValue !== null && size && String(defaultValue).length > size) throw slError(400, `The default value is longer than ${size} characters.`);
  if (defaultValue !== null && validValues.length && !validValues.some((value) => value.value === String(defaultValue))) {
    throw slError(400, 'The default value must be one of the valid values.');
  }
  const mandatory = merged.Mandatory === 'tYES' || merged.Mandatory === true || merged.Mandatory === 'Y';
  if (mandatory && defaultValue === null) throw slError(400, 'A mandatory field needs a default value (SAP fills existing records with it).');
  const linkedTable = hasValue(merged.LinkedTable) ? String(merged.LinkedTable).trim() : null;
  if (linkedTable) {
    if (validValues.length) throw slError(400, 'A field links to a table or has valid values, not both.');
    if (!(await getColumns(client, schema, linkedTable)).size) throw slError(400, `Linked table "${linkedTable}" does not exist.`);
  }

  // Formula and validation may use this table's columns; header formulas may SUM row columns.
  const columns = new Set([...(await getColumns(client, schema, table))].map((c) => c.toLowerCase()));
  columns.add(`u_${merged.Name}`.toLowerCase());
  const lineColumns = lineTableOf(table) ? new Set([...(await getColumns(client, schema, lineTableOf(table)))].map((c) => c.toLowerCase())) : null;
  const checkExpression = (source, what) => {
    if (!hasValue(source)) return null;
    const text = String(source).trim();
    if (text.length > 1000) throw slError(400, `The ${what} is too long.`);
    let compiled;
    try { compiled = compileExpression(text); } catch (error) { throw slError(400, `${what[0].toUpperCase()}${what.slice(1)}: ${error.message}`); }
    const unknown = compiled.fields.find((name) => !columns.has(name.toLowerCase()));
    if (unknown) throw slError(400, `The ${what} uses "${unknown}", which is not a field of ${table}.`);
    if (compiled.sums.length && !lineColumns) throw slError(400, `SUM(...) can only be used on a document header field.`);
    const unknownSum = compiled.sums.find((name) => !lineColumns.has(name.toLowerCase()));
    if (unknownSum) throw slError(400, `SUM uses "${unknownSum}", which is not a row field.`);
    return { text, compiled };
  };
  const formula = checkExpression(merged.Formula, 'formula');
  if (formula?.compiled.fields.some((name) => name.toLowerCase() === `u_${merged.Name}`.toLowerCase())) {
    throw slError(400, 'A formula cannot use its own field.');
  }
  const validation = checkExpression(merged.Validation, 'validation rule');
  return {
    type, editType, size, description, defaultValue, mandatory, linkedTable, validValues,
    linkedUdo: hasValue(merged.LinkedUDO) ? String(merged.LinkedUDO).trim() : null,
    formula: formula?.text || null, validation: validation?.text || null,
    message: hasValue(merged.ValidationMessage) ? String(merged.ValidationMessage).trim().slice(0, 254) : null,
  };
};

const writeUserFieldRows = async (client, table, fieldId, name, settings) => {
  await client.query(
    `UPDATE "CUFD" SET "Descr" = $3, "EditSize" = $4, "SizeID" = $4, "Dflt" = $5, "NotNull" = $6, "RTable" = $7, "RelUDO" = $8
     WHERE "TableID" = $1 AND "FieldID" = $2`,
    [table, fieldId, settings.description, settings.size, settings.defaultValue === null ? null : String(settings.defaultValue),
      settings.mandatory ? 'Y' : 'N', settings.linkedTable, settings.linkedUdo],
  );
  await client.query('DELETE FROM "UFD1" WHERE "TableID" = $1 AND "FieldID" = $2', [table, fieldId]);
  for (const [index, value] of settings.validValues.entries()) {
    await client.query('INSERT INTO "UFD1" ("TableID", "FieldID", "IndexID", "FldValue", "Descr") VALUES ($1, $2, $3, $4, $5)',
      [table, fieldId, index, value.value, value.description]);
  }
  await client.query('DELETE FROM "LocalUdfRule" WHERE "TableID" = $1 AND lower("AliasID") = lower($2)', [table, name]);
  if (settings.formula || settings.validation) {
    await client.query('INSERT INTO "LocalUdfRule" ("TableID", "AliasID", "Formula", "Validation", "Message") VALUES ($1, $2, $3, $4, $5)',
      [table, name, settings.formula, settings.validation, settings.message]);
  }
};

const createUserField = async (schema, data = {}) => withTransaction(schema, async (client) => {
  const table = String(data.TableName || '').trim();
  const name = String(data.Name || '').trim().replace(/^U_/i, '');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(name)) throw slError(400, 'Enter a field name of 1-50 letters, digits or _, starting with a letter (without "U_").');
  if (!/^@?[A-Za-z][A-Za-z0-9_]*$/.test(table) || UDF_DENIED_TABLES.has(table.toUpperCase()) || /^(Local|_)/.test(table)) {
    throw slError(400, `User-defined fields cannot be added to table "${table}".`);
  }
  const tables = udfTableGroup(table);
  for (const target of tables) {
    const columns = await getColumns(client, schema, target);
    if (!columns.size) throw slError(400, `Table "${target}" does not exist.`);
    if ([...columns].some((column) => column.toLowerCase() === `u_${name}`.toLowerCase())) throw alreadyExists(`Field U_${name} already exists in ${target}.`);
  }
  const settings = await prepareUserField(client, schema, table, null, { ...data, Name: name });
  const fieldId = (await client.query(
    'SELECT COALESCE(MAX("FieldID"), -1) + 1 AS "Next" FROM "CUFD" WHERE "TableID" = ANY($1)', [tables],
  )).rows[0].Next;
  const columnType = settings.type.sql(settings.size, settings.editType);
  const defaultClause = settings.defaultValue === null ? '' : ` DEFAULT ${sqlLiteral(settings.defaultValue)}`;
  for (const target of tables) {
    await client.query(`ALTER TABLE ${quote(target)} ADD COLUMN ${quote(`U_${name}`)} ${columnType}${defaultClause}`);
    await client.query(
      `INSERT INTO "CUFD" ("TableID", "FieldID", "AliasID", "Descr", "TypeID", "EditType", "Sys") VALUES ($1, $2, $3, $4, $5, $6, 'N')`,
      [target, fieldId, name, settings.description, settings.type.id, settings.editType],
    );
    await writeUserFieldRows(client, target, fieldId, name, settings);
  }
  clearColumnCaches(schema, tables);
  await logWrite(client, { entity: 'UserFieldsMD', objType: null, docEntry: null, method: `POST ${table}.U_${name}`, payload: data, unmapped: {} });
  return readUserField(client, table, fieldId);
});

const updateUserField = async (schema, table, fieldId, data = {}) => withTransaction(schema, async (client) => {
  const current = await readUserField(client, table, fieldId);
  for (const fixed of ['Name', 'Type', 'SubType', 'TableName']) {
    if (hasValue(data[fixed]) && String(data[fixed]).replace(/^U_/i, '') !== String(current[fixed])) {
      throw slError(400, `The ${fixed === 'SubType' ? 'structure' : fixed.toLowerCase()} of an existing field cannot be changed. Remove the field and add a new one.`);
    }
  }
  const settings = await prepareUserField(client, schema, table, current, { ...data, Name: current.Name });
  const tables = udfTableGroup(table);
  const column = quote(`U_${current.Name}`);
  for (const target of tables) {
    if (settings.size && settings.size !== toNumber(current.EditSize) && settings.type.id === 'A') {
      await client.query(`ALTER TABLE ${quote(target)} ALTER COLUMN ${column} TYPE VARCHAR(${settings.size})`);
    }
    await client.query(`ALTER TABLE ${quote(target)} ALTER COLUMN ${column} ${settings.defaultValue === null ? 'DROP DEFAULT' : `SET DEFAULT ${sqlLiteral(settings.defaultValue)}`}`);
    // SAP fills existing records when a field becomes mandatory.
    if (settings.mandatory && current.Mandatory !== 'tYES') {
      await client.query(`UPDATE ${quote(target)} SET ${column} = $1 WHERE ${column} IS NULL`, [settings.defaultValue]);
    }
    await writeUserFieldRows(client, target, fieldId, current.Name, settings);
  }
  clearColumnCaches(schema, tables);
  await logWrite(client, { entity: 'UserFieldsMD', objType: null, docEntry: null, method: `PATCH ${table}.U_${current.Name}`, payload: data, unmapped: {} });
});

const deleteUserField = async (schema, table, fieldId) => withTransaction(schema, async (client) => {
  const current = await readUserField(client, table, fieldId);
  const tables = udfTableGroup(table);
  for (const target of tables) {
    await client.query(`ALTER TABLE ${quote(target)} DROP COLUMN IF EXISTS ${quote(`U_${current.Name}`)}`);
    await client.query('DELETE FROM "UFD1" WHERE "TableID" = $1 AND "FieldID" = $2', [target, fieldId]);
    await client.query('DELETE FROM "CUFD" WHERE "TableID" = $1 AND "FieldID" = $2', [target, fieldId]);
    await client.query('DELETE FROM "LocalUdfRule" WHERE "TableID" = $1 AND lower("AliasID") = lower($2)', [target, current.Name]);
  }
  clearColumnCaches(schema, tables);
  await logWrite(client, { entity: 'UserFieldsMD', objType: null, docEntry: null, method: `DELETE ${table}.U_${current.Name}`, payload: {}, unmapped: {} });
});

// On every save: formulas fill their field, then mandatory, valid values and
// validation rules are checked. `rows` are the document rows (for SUM).
// ponytail: CUFD is read per save; cache per schema with invalidation if saves get slow.
const applyUserFields = async (client, table, row, rows = [], where = '') => {
  const fields = (await client.query(
    `SELECT c."AliasID", c."Descr", c."TypeID", c."EditType", c."EditSize", c."NotNull", r."Formula", r."Validation", r."Message",
       (SELECT array_agg(u."FldValue") FROM "UFD1" u WHERE u."TableID" = c."TableID" AND u."FieldID" = c."FieldID") AS "Values"
     FROM "CUFD" c LEFT JOIN "LocalUdfRule" r ON r."TableID" = c."TableID" AND lower(r."AliasID") = lower(c."AliasID")
     WHERE c."TableID" = $1 ORDER BY c."FieldID"`, [table],
  )).rows;
  const prefix = where ? `${where}: ` : '';
  for (const field of fields) {
    const column = Object.keys(row).find((key) => key.toLowerCase() === `u_${field.AliasID}`.toLowerCase()) || `U_${field.AliasID}`;
    const label = `"${field.Descr || field.AliasID}"`;
    if (field.Formula) {
      let value = compileExpression(field.Formula).run(row, rows);
      if (field.TypeID === 'N') value = value === null ? null : Math.round(toNumber(value));
      else if (field.TypeID === 'B') value = value === null ? null : roundTo(toNumber(value), 6);
      else if (value !== null) value = String(value);
      row[column] = value;
    }
    // A field that was not sent keeps its column default, so only sent values are checked.
    if (Object.prototype.hasOwnProperty.call(row, column)) {
      let value = row[column];
      if (value === '' && field.TypeID !== 'A' && field.TypeID !== 'M') value = row[column] = null;
      if (hasValue(value)) value = row[column] = parseUdfValue(field.TypeID, field.EditType, value, `${prefix}${label}`);
      if (field.NotNull === 'Y' && !hasValue(value)) throw slError(400, `${prefix}enter ${label}.`);
      if (hasValue(value) && field.TypeID === 'A' && field.EditSize && String(value).length > field.EditSize) {
        throw slError(400, `${prefix}${label} is longer than ${field.EditSize} characters.`);
      }
      if (hasValue(value) && field.Values?.length && !field.Values.includes(String(value))) {
        throw slError(400, `${prefix}${label} must be one of: ${field.Values.join(', ')}.`);
      }
    }
    if (field.Validation && !compileExpression(field.Validation).run(row, rows)) {
      throw slError(400, `${prefix}${field.Message || `${label} does not meet the rule ${field.Validation}.`}`);
    }
  }
};

// ---- user-defined tables and objects ---------------------------------------------
// A UDT is an "@<Name>" table listed in OUTB with SAP's system columns for its
// type. A UDO (OUDO + UDO1) exposes its table as /<Code>, child rows as
// "<ObjectName>Collection"; a table without an object is exposed as /U_<Name>.

const UDT_STAMP = ['"Object" VARCHAR(20)', '"LogInst" INTEGER', '"UserSign" INTEGER', `"Transfered" CHAR(1) DEFAULT 'N'`,
  '"CreateDate" DATE', '"CreateTime" SMALLINT', '"UpdateDate" DATE', '"UpdateTime" SMALLINT', '"DataSource" CHAR(1)'];
const UDT_CODE_NAME = ['"Code" VARCHAR(50) PRIMARY KEY', '"Name" VARCHAR(100)'];
const UDT_TYPES = {
  bott_NoObject: { id: 0, columns: UDT_CODE_NAME },
  bott_MasterData: { id: 1, columns: [...UDT_CODE_NAME, '"DocEntry" INTEGER GENERATED BY DEFAULT AS IDENTITY UNIQUE', `"Canceled" CHAR(1) DEFAULT 'N'`, ...UDT_STAMP] },
  bott_MasterDataLines: { id: 2, columns: ['"Code" VARCHAR(50) NOT NULL', '"LineId" INTEGER NOT NULL', '"Object" VARCHAR(20)', '"LogInst" INTEGER', 'PRIMARY KEY ("Code", "LineId")'] },
  bott_Document: {
    id: 3,
    columns: ['"DocEntry" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY', '"DocNum" INTEGER', '"Period" INTEGER', '"Instance" SMALLINT DEFAULT 0',
      '"Series" INTEGER', `"Handwrtten" CHAR(1) DEFAULT 'N'`, `"Canceled" CHAR(1) DEFAULT 'N'`, ...UDT_STAMP,
      `"Status" CHAR(1) DEFAULT 'O'`, `"RequestStatus" CHAR(1) DEFAULT 'W'`, '"Creator" VARCHAR(155)', '"Remark" TEXT'],
  },
  bott_DocumentLines: { id: 4, columns: ['"DocEntry" INTEGER NOT NULL', '"LineId" INTEGER NOT NULL', '"VisOrder" INTEGER', '"Object" VARCHAR(20)', '"LogInst" INTEGER', 'PRIMARY KEY ("DocEntry", "LineId")'] },
  bott_NoObjectAutoIncrement: { id: 5, columns: UDT_CODE_NAME },
};
const UDT_TYPE_BY_ID = Object.fromEntries(Object.entries(UDT_TYPES).map(([name, type]) => [type.id, name]));
// UDO object type -> its header table type and child table type (OUTB.ObjectType).
const UDO_TYPES = { boud_MasterData: { id: 1, header: 1, child: 2 }, boud_Document: { id: 3, header: 3, child: 4 } };
const yesNo = (value) => (toSapValue('', value) === 'Y' ? 'Y' : 'N');
const slYesNo = (value) => (value === 'Y' ? 'tYES' : 'tNO');
const slRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]));
const nowStamp = () => {
  const now = new Date();
  return { date: localToday(), time: now.getHours() * 100 + now.getMinutes() };
};

const readUserTable = async (client, name) => {
  const row = (await client.query('SELECT * FROM "OUTB" WHERE "TableName" = $1', [String(name).replace(/^@/, '')])).rows[0];
  if (!row) throw slError(404, `No matching records found (user-defined table ${name}).`);
  return { TableName: row.TableName, TableDescription: row.Descr, TableType: UDT_TYPE_BY_ID[row.ObjectType] };
};

const createUserTable = async (schema, data = {}) => withTransaction(schema, async (client) => {
  const name = String(data.TableName || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,18}$/.test(name)) throw slError(400, 'Enter a table name of 1-19 letters, digits or _, starting with a letter (without "@").');
  const typeName = data.TableType || 'bott_NoObject';
  const type = UDT_TYPES[typeName];
  if (!type) throw slError(400, `Select a table type (${Object.keys(UDT_TYPES).join(', ')}).`);
  if ((await client.query('SELECT 1 FROM "OUTB" WHERE upper("TableName") = upper($1)', [name])).rowCount) {
    throw alreadyExists(`User-defined table ${name} already exists.`);
  }
  await client.query(`CREATE TABLE ${quote(`@${name}`)} (${type.columns.join(', ')})`);
  await client.query('INSERT INTO "OUTB" ("TableName", "Descr", "ObjectType") VALUES ($1, $2, $3)',
    [name, String(data.TableDescription || name).trim().slice(0, 100), type.id]);
  clearColumnCaches(schema, [`@${name}`]);
  await logWrite(client, { entity: 'UserTablesMD', objType: null, docEntry: null, method: `POST ${name}`, payload: data, unmapped: {} });
  return readUserTable(client, name);
});

const readUserObject = async (client, code) => {
  const row = (await client.query('SELECT * FROM "OUDO" WHERE "Code" = $1', [code])).rows[0];
  if (!row) throw slError(404, `No matching records found (user-defined object ${code}).`);
  const children = (await client.query('SELECT * FROM "UDO1" WHERE "Code" = $1 ORDER BY "SonNum"', [code])).rows;
  return {
    Code: row.Code, Name: row.Name, TableName: row.TableName,
    ObjectType: Object.keys(UDO_TYPES).find((key) => UDO_TYPES[key].id === row.TYPE),
    ManageSeries: slYesNo(row.MngSeries), CanDelete: slYesNo(row.CanDelete), CanClose: slYesNo(row.CanClose),
    CanCancel: slYesNo(row.CanCancel), CanFind: slYesNo(row.CanFind), CanLog: slYesNo(row.CanLog), CanCreateDefaultForm: slYesNo(row.CanDefForm),
    UserObjectMD_ChildTables: children.map((child) => ({ SonNumber: child.SonNum, TableName: child.TableName, ObjectName: child.SonName })),
  };
};

const createUserObject = async (schema, data = {}) => withTransaction(schema, async (client) => {
  const code = String(data.Code || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(code)) throw slError(400, 'Enter an object code of 1-20 letters, digits or _, starting with a letter.');
  const type = UDO_TYPES[data.ObjectType];
  if (!type) throw slError(400, `Select an object type (${Object.keys(UDO_TYPES).join(', ')}).`);
  if ((await client.query('SELECT 1 FROM "OUDO" WHERE upper("Code") = upper($1)', [code])).rowCount) {
    throw alreadyExists(`User-defined object ${code} already exists.`);
  }
  const tableOf = async (name, objectType, role) => {
    const table = String(name || '').trim().replace(/^@/, '');
    const row = (await client.query('SELECT "ObjectType" FROM "OUTB" WHERE "TableName" = $1', [table])).rows[0];
    if (!row) throw slError(400, `User-defined table ${table || '(none)'} does not exist.`);
    if (row.ObjectType !== objectType) throw slError(400, `Table ${table} must be of type ${UDT_TYPE_BY_ID[objectType]} to be the ${role} of a ${data.ObjectType} object.`);
    return table;
  };
  const table = await tableOf(data.TableName, type.header, 'main table');
  if ((await client.query('SELECT 1 FROM "OUDO" WHERE "TableName" = $1 UNION SELECT 1 FROM "UDO1" WHERE "TableName" = $1', [table])).rowCount) {
    throw slError(400, `Table ${table} already belongs to another object.`);
  }
  const children = [];
  for (const child of data.UserObjectMD_ChildTables || data.ChildTables || []) {
    const childTable = await tableOf(child.TableName, type.child, 'child table');
    children.push({ table: childTable, son: String(child.ObjectName || childTable).trim() });
  }
  if (new Set(children.map((child) => child.son.toLowerCase())).size !== children.length) throw slError(400, 'Each child table needs its own object name.');
  await client.query(
    `INSERT INTO "OUDO" ("Code", "Name", "TableName", "TYPE", "MngSeries", "CanDelete", "CanClose", "CanCancel", "CanFind", "CanLog", "CanDefForm")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [code, String(data.Name || code).trim().slice(0, 100), table, type.id, yesNo(data.ManageSeries), yesNo(data.CanDelete), yesNo(data.CanClose),
      yesNo(data.CanCancel), yesNo(data.CanFind), yesNo(data.CanLog), yesNo(data.CanCreateDefaultForm)],
  );
  for (const [index, child] of children.entries()) {
    await client.query('INSERT INTO "UDO1" ("Code", "SonNum", "TableName", "SonName") VALUES ($1, $2, $3, $4)', [code, index + 1, child.table, child.son]);
  }
  await logWrite(client, { entity: 'UserObjectsMD', objType: null, docEntry: null, method: `POST ${code}`, payload: data, unmapped: {} });
  return readUserObject(client, code);
});

// The UDO or no-object table an SL entity name refers to, or null.
const resolveUserEntity = async (client, entity) => {
  const udo = (await client.query('SELECT * FROM "OUDO" WHERE "Code" = $1', [entity])).rows[0];
  if (udo) {
    const children = (await client.query('SELECT * FROM "UDO1" WHERE "Code" = $1 ORDER BY "SonNum"', [entity])).rows;
    return {
      code: udo.Code, table: `@${udo.TableName}`, document: udo.TYPE === 3, key: udo.TYPE === 3 ? 'DocEntry' : 'Code',
      children: children.map((child) => ({ table: `@${child.TableName}`, collection: `${child.SonName}Collection` })),
    };
  }
  if (!/^U_/.test(entity)) return null;
  const table = (await client.query('SELECT * FROM "OUTB" WHERE "TableName" = $1 AND "ObjectType" IN (0, 1, 5)', [entity.slice(2)])).rows[0];
  return table && { table: `@${table.TableName}`, autoCode: table.ObjectType === 5 };
};

// Writable SL properties of a UDO/UDT row: its U_ fields plus the listed system ones.
const userRow = (source, columns, writable) => {
  const row = {};
  const unmapped = {};
  for (const [property, value] of Object.entries(source || {})) {
    if (value === undefined || /Collection$/.test(property)) continue;
    if (columns.has(property) && (/^U_/.test(property) || writable.includes(property)) && (value === null || typeof value !== 'object')) row[property] = value;
    else if (value !== null) unmapped[property] = value;
  }
  return { row, unmapped };
};
const UDO_HEADER_WRITABLE = { document: ['Remark', 'Creator'], master: ['Name', 'Remark'] };

const readUdoRecord = async (client, udo, key) => {
  const header = (await client.query(`SELECT * FROM ${quote(udo.table)} WHERE ${quote(udo.key)} = $1`, [key])).rows[0];
  if (!header) throw slError(404, `No matching records found (${udo.code} ${key}).`);
  const result = slRow(header);
  for (const child of udo.children) {
    result[child.collection] = (await client.query(
      `SELECT * FROM ${quote(child.table)} WHERE ${quote(udo.key)} = $1 ORDER BY "LineId"`, [key],
    )).rows.map(slRow);
  }
  return result;
};

// Adds (no LineId) or updates (LineId) the rows sent in each child collection; rows left out are kept.
const writeUdoChildren = async (client, schema, udo, key, data, unmapped) => {
  for (const child of udo.children) {
    const sent = data[child.collection];
    if (sent === undefined || sent === null) continue;
    if (!Array.isArray(sent)) throw slError(400, `${child.collection} must be a list of rows.`);
    const columns = await getColumns(client, schema, child.table);
    const existing = (await client.query(`SELECT * FROM ${quote(child.table)} WHERE ${quote(udo.key)} = $1 ORDER BY "LineId"`, [key])).rows;
    let nextLineId = Math.max(0, ...existing.map((row) => row.LineId)) + 1;
    for (const [index, source] of sent.entries()) {
      const { LineId: lineId, ...fields } = source || {};
      const mapped = userRow(fields, columns, []);
      if (Object.keys(mapped.unmapped).length) unmapped[`${child.collection}[${index}]`] = mapped.unmapped;
      await applyUserFields(client, child.table, mapped.row, [], `${child.collection} row ${index + 1}`);
      if (hasValue(lineId)) {
        const target = existing.find((row) => row.LineId === Number(lineId));
        if (!target) throw slError(400, `${child.collection}: row with LineId ${lineId} does not exist.`);
        const changed = Object.keys(mapped.row);
        if (changed.length) {
          await client.query(
            `UPDATE ${quote(child.table)} SET ${changed.map((column, i) => `${quote(column)} = $${i + 3}`).join(', ')} WHERE ${quote(udo.key)} = $1 AND "LineId" = $2`,
            [key, target.LineId, ...changed.map((column) => mapped.row[column])],
          );
        }
      } else {
        await insertRow(client, child.table, columns, {
          ...mapped.row, [udo.key]: key, LineId: nextLineId, VisOrder: nextLineId - 1, Object: udo.code,
        });
        nextLineId += 1;
      }
    }
  }
};

// Document UDOs take the object's numbering series (sent, else its default in
// ONNM) like any SAP document; without one set up they number 1, 2, 3...
const numberUdoDocument = async (client, udo, data) => {
  const period = (await client.query(
    'SELECT * FROM "OFPR" WHERE $1::date BETWEEN "F_RefDate" AND "T_RefDate" ORDER BY "F_RefDate" DESC LIMIT 1', [localToday()],
  )).rows[0] || {};
  let series = toNumber(data.Series, null);
  if (series === null) {
    series = (await client.query(
      'SELECT COALESCE("DfltSeries", "DfltSerie") AS "Series" FROM "ONNM" WHERE "ObjectCode" = $1 ORDER BY "DocSubType" LIMIT 1', [udo.code],
    )).rows[0]?.Series ?? null;
  }
  if (series !== null) {
    const numbered = await assignDocNum(client, { table: udo.table, objType: udo.code, subType: '--', series, manualDocNum: null, period });
    return { ...numbered, Period: period.AbsEntry ?? null };
  }
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`udo-docnum:${udo.code}`]);
  const next = (await client.query(`SELECT COALESCE(MAX("DocNum"), 0) + 1 AS "Next" FROM ${quote(udo.table)}`)).rows[0].Next;
  return { Series: null, DocNum: Number(next), Period: period.AbsEntry ?? null };
};

const createUdoRecord = async (schema, udo, data = {}) => withTransaction(schema, async (client) => {
  const columns = await getColumns(client, schema, udo.table);
  const writable = udo.document ? UDO_HEADER_WRITABLE.document : ['Code', ...UDO_HEADER_WRITABLE.master];
  const { row, unmapped } = userRow(data, columns, writable);
  delete unmapped.Series;
  if (!udo.document && !hasValue(row.Code)) throw slError(400, 'Enter a code.');
  await applyUserFields(client, udo.table, row);
  const stamp = nowStamp();
  Object.assign(row, { Object: udo.code, CreateDate: stamp.date, CreateTime: stamp.time, Canceled: 'N' });
  if (udo.document) Object.assign(row, await numberUdoDocument(client, udo, data), { Status: 'O' });
  const saved = await insertRow(client, udo.table, columns, row);
  await writeUdoChildren(client, schema, udo, saved[udo.key], data, unmapped);
  await logWrite(client, { entity: udo.code, objType: udo.code, docEntry: udo.document ? saved.DocEntry : null, method: 'POST', payload: data, unmapped });
  return readUdoRecord(client, udo, saved[udo.key]);
});

const updateUdoRecord = async (schema, udo, key, data = {}) => withTransaction(schema, async (client) => {
  const columns = await getColumns(client, schema, udo.table);
  const existing = (await client.query(`SELECT * FROM ${quote(udo.table)} WHERE ${quote(udo.key)} = $1 FOR UPDATE`, [key])).rows[0];
  if (!existing) throw slError(404, `No matching records found (${udo.code} ${key}).`);
  if (existing.Canceled === 'Y' || existing.Status === 'C') throw slError(400, 'Closed or cancelled documents cannot be updated.');
  const writable = udo.document ? UDO_HEADER_WRITABLE.document : UDO_HEADER_WRITABLE.master;
  const { row, unmapped } = userRow(data, columns, writable);
  delete unmapped.Series;
  await applyUserFields(client, udo.table, row);
  const stamp = nowStamp();
  Object.assign(row, { UpdateDate: stamp.date, UpdateTime: stamp.time });
  const changed = Object.keys(row).filter((column) => columns.has(column));
  await client.query(
    `UPDATE ${quote(udo.table)} SET ${changed.map((column, i) => `${quote(column)} = $${i + 2}`).join(', ')} WHERE ${quote(udo.key)} = $1`,
    [key, ...changed.map((column) => row[column])],
  );
  await writeUdoChildren(client, schema, udo, key, data, unmapped);
  await logWrite(client, { entity: udo.code, objType: udo.code, docEntry: udo.document ? key : null, method: 'PATCH', payload: data, unmapped });
});

// /U_<Table> rows of a table without an object, keyed by Code.
const saveUserTableRow = async (schema, target, code, data = {}) => withTransaction(schema, async (client) => {
  const columns = await getColumns(client, schema, target.table);
  const { row, unmapped } = userRow(data, columns, code === undefined ? ['Code', 'Name'] : ['Name']);
  await applyUserFields(client, target.table, row);
  const stamp = nowStamp();
  if (code === undefined) {
    if (!hasValue(row.Code) && target.autoCode) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`udt-code:${target.table}`]);
      row.Code = String((await client.query(`SELECT COALESCE(MAX(CASE WHEN "Code" ~ '^[0-9]+$' THEN "Code"::bigint END), 0) + 1 AS "Next" FROM ${quote(target.table)}`)).rows[0].Next);
    }
    if (!hasValue(row.Code)) throw slError(400, 'Enter a code.');
    if (!hasValue(row.Name)) row.Name = row.Code;
    const saved = await insertRow(client, target.table, columns, { ...row, CreateDate: stamp.date, CreateTime: stamp.time });
    await logWrite(client, { entity: `U_${target.table.slice(1)}`, objType: null, docEntry: null, method: `POST ${saved.Code}`, payload: data, unmapped });
    return slRow(saved);
  }
  const patch = { ...row, UpdateDate: stamp.date, UpdateTime: stamp.time };
  const changed = Object.keys(patch).filter((column) => columns.has(column));
  const updated = (await client.query(changed.length
    ? `UPDATE ${quote(target.table)} SET ${changed.map((column, i) => `${quote(column)} = $${i + 2}`).join(', ')} WHERE "Code" = $1`
    : `SELECT 1 FROM ${quote(target.table)} WHERE "Code" = $1`,
  [code, ...changed.map((column) => patch[column])])).rowCount;
  if (!updated) throw slError(404, `No matching records found (${target.table} ${code}).`);
  await logWrite(client, { entity: `U_${target.table.slice(1)}`, objType: null, docEntry: null, method: `PATCH ${code}`, payload: data, unmapped });
  return null;
});

// ---- dispatcher ------------------------------------------------------------------

const parseUrl = (url = '') => {
  const path = String(url).split('?')[0];
  const match = path.match(/^\/?([A-Za-z_][A-Za-z0-9_]*)(?:\((.+)\))?(?:\/([A-Za-z_]+))?$/);
  if (!match) return null;
  const rawKey = match[2];
  const decode = (value) => { try { return decodeURIComponent(value); } catch { return value; } };
  const key = rawKey === undefined ? undefined : (/^'.*'$/.test(rawKey) ? decode(rawKey.slice(1, -1)).replace(/''/g, "'") : Number(rawKey));
  return { entity: match[1], key, action: match[3], hasQuery: String(url).includes('?') };
};

const request = async (config = {}, schema) => {
  const method = String(config.method || 'GET').toUpperCase();
  const target = parseUrl(config.url);
  const unsupported = () => slError(501, `The local ERP does not support ${method} ${config.url} yet.`);
  if (!target) throw unsupported();
  await ensureCompanyMigrated(schema);
  const { entity, key, action } = target;

  if (entity === 'SBOBobService_GetCurrencyRate' && method === 'POST') return { status: 200, data: await getCurrencyRate(schema, config.data) };
  if (entity === 'SBOBobService_SetCurrencyRate' && method === 'POST') return { status: 204, data: await setCurrencyRate(schema, config.data) };

  if (entity === 'UserFieldsMD') {
    // SAP key: UserFieldsMD(TableName='ORDR',FieldID=3)
    const fieldKey = String(config.url).match(/\(\s*TableName\s*=\s*'([^']+)'\s*,\s*FieldID\s*=\s*(\d+)\s*\)/);
    if (method === 'POST' && !fieldKey) return { status: 201, data: await createUserField(schema, config.data) };
    if (fieldKey && !target.hasQuery) {
      const [, table, fieldId] = fieldKey;
      if (method === 'GET') return { status: 200, data: await withTransaction(schema, (client) => readUserField(client, table, Number(fieldId))) };
      if (method === 'PATCH') { await updateUserField(schema, table, Number(fieldId), config.data); return { status: 204, data: {} }; }
      if (method === 'DELETE') { await deleteUserField(schema, table, Number(fieldId)); return { status: 204, data: {} }; }
    }
    throw unsupported();
  }

  if (entity === 'UserTablesMD' || entity === 'UserObjectsMD') {
    const tables = entity === 'UserTablesMD';
    if (method === 'POST' && key === undefined) return { status: 201, data: await (tables ? createUserTable : createUserObject)(schema, config.data) };
    if (method === 'GET' && key !== undefined && !action && !target.hasQuery) {
      return { status: 200, data: await withTransaction(schema, (client) => (tables ? readUserTable : readUserObject)(client, String(key))) };
    }
    throw unsupported();
  }

  if (PAYMENTS[entity]) {
    if (method === 'POST' && key === undefined) return { status: 201, data: await createPayment(schema, entity, config.data) };
    if (method === 'GET' && key !== undefined && !action && !target.hasQuery) {
      return { status: 200, data: await withTransaction(schema, (client) => readPayment(client, entity, Number(key))) };
    }
    if (method === 'POST' && key !== undefined && action === 'Cancel') {
      await cancelPayment(schema, entity, Number(key));
      return { status: 204, data: {} };
    }
    throw unsupported();
  }
  if (entity === 'JournalEntries') {
    if (method === 'POST' && key === undefined) return { status: 201, data: await createJournalEntry(schema, config.data) };
    if (method === 'GET' && key !== undefined && !action && !target.hasQuery) {
      return { status: 200, data: await withTransaction(schema, (client) => readJournalEntry(client, Number(key))) };
    }
    throw unsupported();
  }

  if (MASTERS[entity]) {
    // Only the collection queries used by the existing setup callers are supported.
    if (method === 'GET' && key === undefined && ['SalesPersons', 'CashDiscounts', 'PaymentMethods'].includes(entity)) {
      const query = new URLSearchParams(String(config.url).split('?')[1] || '');
      const filter = query.get('$filter');
      const match = filter?.match(/^SalesEmployeeName eq '((?:[^']|'')*)'$/);
      if ([...query.keys()].some((name) => !['$select', '$top', '$filter'].includes(name)) || (filter && (entity !== 'SalesPersons' || !match))) throw unsupported();
      const definition = MASTERS[entity];
      const top = Number(query.get('$top') || 200);
      if (!Number.isInteger(top) || top < 1 || top > 1000) throw slError(400, 'Invalid collection limit.');
      return { status: 200, data: await withTransaction(schema, async (client) => {
        const rows = (await client.query(`SELECT ${quote(definition.key)} FROM ${quote(definition.table)} ${match ? 'WHERE "SlpName"=$2' : ''} ORDER BY ${quote(definition.key)} LIMIT $1`,
          match ? [top, match[1].replace(/''/g, "'")] : [top])).rows;
        const value = [];
        for (const row of rows) value.push(await readMaster(client, entity, row[definition.key]));
        return { value };
      }) };
    }
    if (method === 'POST' && key === undefined) return { status: 201, data: await saveMaster(schema, entity, undefined, config.data) };
    if (method === 'PATCH' && key !== undefined && !action) {
      await saveMaster(schema, entity, String(key), config.data);
      return { status: 204, data: {} };
    }
    if (method === 'GET' && key !== undefined && !action && !target.hasQuery) {
      return { status: 200, data: await withTransaction(schema, (client) => readMaster(client, entity, String(key))) };
    }
    if (method === 'DELETE' && key !== undefined && !action) {
      await deleteMaster(schema, entity, String(key));
      return { status: 204, data: {} };
    }
  }

  if (DOCUMENTS[entity]) {
    const docEntry = key === undefined ? undefined : Number(key);
    if (key !== undefined && !Number.isInteger(docEntry)) throw slError(400, `Invalid document key: ${key}.`);
    if (method === 'POST' && docEntry === undefined) return { status: 201, data: await createDocument(schema, entity, config.data) };
    if (method === 'PATCH' && docEntry !== undefined && !action) {
      await updateDocument(schema, entity, docEntry, config.data);
      return { status: 204, data: {} };
    }
    if (method === 'GET' && docEntry !== undefined && !action && !target.hasQuery) {
      return { status: 200, data: await withTransaction(schema, (client) => readDocument(client, schema, entity, docEntry)) };
    }
    if (method === 'POST' && docEntry !== undefined && action === 'Cancel' && !STATUS_ONLY_DOCUMENTS.has(entity)) {
      await cancelDocument(schema, entity, docEntry);
      return { status: 204, data: {} };
    }
    if (method === 'POST' && docEntry !== undefined && ['Close', 'Cancel'].includes(action)) {
      await setDocumentStatus(schema, entity, docEntry, action);
      return { status: 204, data: {} };
    }
  }

  // User-defined objects (/<Code>) and tables without an object (/U_<Table>).
  if (!DOCUMENTS[entity] && !MASTERS[entity] && !action && !target.hasQuery) {
    const user = await withTransaction(schema, (client) => resolveUserEntity(client, entity));
    if (user?.code) {
      const recordKey = user.document ? Number(key) : (key === undefined ? undefined : String(key));
      if (user.document && key !== undefined && !Number.isInteger(recordKey)) throw slError(400, `Invalid document key: ${key}.`);
      if (method === 'POST' && key === undefined) return { status: 201, data: await createUdoRecord(schema, user, config.data) };
      if (method === 'GET' && key !== undefined) return { status: 200, data: await withTransaction(schema, (client) => readUdoRecord(client, user, recordKey)) };
      if (method === 'PATCH' && key !== undefined) { await updateUdoRecord(schema, user, recordKey, config.data); return { status: 204, data: {} }; }
    } else if (user) {
      if (method === 'POST' && key === undefined) return { status: 201, data: await saveUserTableRow(schema, user, undefined, config.data) };
      if (method === 'PATCH' && key !== undefined) { await saveUserTableRow(schema, user, String(key), config.data); return { status: 204, data: {} }; }
      if ((method === 'GET' || method === 'DELETE') && key !== undefined) {
        return withTransaction(schema, async (client) => {
          const sql = method === 'GET' ? 'SELECT *' : 'DELETE';
          const { rows, rowCount } = await client.query(`${sql} FROM ${quote(user.table)} WHERE "Code" = $1${method === 'DELETE' ? ' RETURNING *' : ''}`, [String(key)]);
          if (!rowCount) throw slError(404, `No matching records found (${entity} ${key}).`);
          if (method === 'GET') return { status: 200, data: slRow(rows[0]) };
          await logWrite(client, { entity, objType: null, docEntry: null, method: `DELETE ${key}`, payload: {}, unmapped: {} });
          return { status: 204, data: {} };
        });
      }
    }
  }
  throw unsupported();
};

module.exports = {
  DOCUMENTS, MASTERS, UDF_TYPES, udfTableGroup, parseUrl, request, withTransaction, validateAccounts,
  postOpeningBalances, listOpeningBalances, listReconcilablePartners, listOpenRows, reconcile,
};
