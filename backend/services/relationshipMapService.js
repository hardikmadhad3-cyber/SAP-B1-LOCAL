const db = require('./dbService');
const { resolveDatabaseScope } = require('./salesDocumentDbCompatibility');

const DOCUMENT_TYPES = {
  23: { family: 'sales', rank: 10, label: 'Sales Quotation', header: 'OQUT', line: 'QUT1', partnerLabel: 'Business Partners' },
  17: { family: 'sales', rank: 20, label: 'Sales Order', header: 'ORDR', line: 'RDR1', partnerLabel: 'Business Partners' },
  15: { family: 'sales', rank: 30, label: 'Delivery', header: 'ODLN', line: 'DLN1', partnerLabel: 'Business Partners' },
  13: { family: 'sales', rank: 40, label: 'A/R Invoice', header: 'OINV', line: 'INV1', partnerLabel: 'Business Partners' },
  14: { family: 'sales', rank: 50, label: 'A/R Credit Memo', header: 'ORIN', line: 'RIN1', partnerLabel: 'Business Partners' },
  24: { family: 'banking', rank: 60, label: 'Incoming Payment', header: 'ORCT', line: null, paymentLine: 'RCT2', referenceColumn: 'CounterRef', partnerLabel: 'Business Partners' },
  1470000113: { family: 'purchase', rank: 5, label: 'Purchase Request', header: 'OPRQ', line: 'PRQ1', partnerLabel: 'Business Partners' },
  540000006: { family: 'purchase', rank: 10, label: 'Purchase Quotation', header: 'OPQT', line: 'PQT1', partnerLabel: 'Business Partners' },
  22: { family: 'purchase', rank: 20, label: 'Purchase Order', header: 'OPOR', line: 'POR1', partnerLabel: 'Business Partners' },
  20: { family: 'purchase', rank: 30, label: 'Goods Receipt PO', header: 'OPDN', line: 'PDN1', partnerLabel: 'Business Partners' },
  18: { family: 'purchase', rank: 40, label: 'A/P Invoice', header: 'OPCH', line: 'PCH1', partnerLabel: 'Business Partners' },
  19: { family: 'purchase', rank: 50, label: 'A/P Credit Memo', header: 'ORPC', line: 'RPC1', partnerLabel: 'Business Partners' },
  46: { family: 'banking', rank: 60, label: 'Outgoing Payment', header: 'OVPM', line: null, paymentLine: 'VPM2', referenceColumn: 'CounterRef', partnerLabel: 'Business Partners' },
  30: { family: 'financial', rank: 70, label: 'Journal Entry', header: 'OJDT', line: 'JDT1', keyField: 'TransId', referenceColumn: 'Memo', partnerLabel: 'Business Partners' },
};

const MAX_DEPTH = 5;
const columnCache = new Map();

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

const toType = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatSapDate = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
};

const scopedCacheKey = async (tableName) => {
  try {
    const scope = await resolveDatabaseScope(db);
    return `${scope.cacheKey}:${tableName}`;
  } catch (_error) {
    return '';
  }
};

const getTableColumns = async (tableName) => {
  const normalized = String(tableName || '').trim().toUpperCase();
  if (!normalized) return new Set();

  // Keyed by company connection, not by table name alone: two companies rarely
  // carry the same UDF columns, and a bare table-name key served one company's
  // column set to the next. An unresolvable scope only costs the cache, never
  // the lookup, so this stays as forgiving as it was before.
  const cacheKey = await scopedCacheKey(normalized);
  if (cacheKey && columnCache.has(cacheKey)) return columnCache.get(cacheKey);

  const rows = await safe(db.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = @tableName
  `, { tableName: normalized }));
  const columns = new Set(rows.map((row) => String(row.COLUMN_NAME || '').toUpperCase()));
  if (cacheKey) columnCache.set(cacheKey, columns);
  return columns;
};

const optionalColumn = (columns, alias, columnName, outputAlias, fallback = "''") => (
  columns.has(String(columnName).toUpperCase())
    ? `${alias}.${columnName} AS ${outputAlias}`
    : `${fallback} AS ${outputAlias}`
);

const toNodeType = (label) => (
  String(label || 'Document')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_match, chr) => (chr || '').toUpperCase())
    .replace(/^./, (chr) => chr.toLowerCase())
);

const getJournalEntryDocument = async (transId) => {
  const meta = DOCUMENT_TYPES[30];
  const rows = await safe(db.query(`
    SELECT
      T0.TransId,
      T0.Number,
      T0.RefDate,
      T0.DueDate,
      T0.TaxDate,
      T0.Memo,
      T0.Ref1,
      T0.Ref2,
      T0.TransType,
      T0.CreatedBy,
      T0.BaseRef,
      SUM(ISNULL(T1.Debit, 0)) AS DebitTotal,
      SUM(ISNULL(T1.Credit, 0)) AS CreditTotal
    FROM OJDT T0
    LEFT JOIN JDT1 T1 ON T1.TransId = T0.TransId
    WHERE T0.TransId = @transId
    GROUP BY
      T0.TransId, T0.Number, T0.RefDate, T0.DueDate, T0.TaxDate,
      T0.Memo, T0.Ref1, T0.Ref2, T0.TransType, T0.CreatedBy, T0.BaseRef
  `, { transId }));

  const row = rows[0];
  if (!row) return null;

  return {
    id: `30-${row.TransId}`,
    objectType: 30,
    type: 'journalEntry',
    family: meta.family,
    rank: meta.rank,
    label: meta.label,
    docEntry: row.TransId,
    docNum: row.Number || row.TransId,
    postingDate: formatSapDate(row.RefDate),
    deliveryDate: formatSapDate(row.DueDate),
    documentDate: formatSapDate(row.TaxDate || row.RefDate),
    customerRefNo: row.Memo || row.Ref1 || row.BaseRef || '',
    total: row.DebitTotal != null ? Number(row.DebitTotal) : Number(row.CreditTotal || 0),
    currency: 'INR',
    status: '',
    sourceObjectType: toType(row.TransType),
    sourceDocEntry: Number(row.CreatedBy || 0),
    baseRef: row.BaseRef || '',
  };
};

const getDocument = async (objectType, docEntry) => {
  const meta = DOCUMENT_TYPES[objectType];
  if (!meta) return null;
  if (objectType === 30) return getJournalEntryDocument(docEntry);

  const columns = await getTableColumns(meta.header);
  const keyField = meta.keyField || 'DocEntry';
  const referenceColumn = meta.referenceColumn || 'NumAtCard';
  const currencyColumn = columns.has('DOCCUR') ? 'DocCur' : columns.has('DOCCURR') ? 'DocCurr' : 'DocCur';
  const rows = await safe(db.query(`
    SELECT
      T0.${keyField} AS DocEntry,
      ${optionalColumn(columns, 'T0', 'DocNum', 'DocNum', `T0.${keyField}`)},
      ${optionalColumn(columns, 'T0', 'DocDate', 'DocDate', 'NULL')},
      ${optionalColumn(columns, 'T0', 'DocDueDate', 'DocDueDate', 'NULL')},
      ${optionalColumn(columns, 'T0', 'TaxDate', 'TaxDate', 'NULL')},
      ${optionalColumn(columns, 'T0', referenceColumn, 'NumAtCard')},
      ${optionalColumn(columns, 'T0', 'CardCode', 'CardCode')},
      ${optionalColumn(columns, 'T0', 'CardName', 'CardName')},
      ${optionalColumn(columns, 'T0', 'DocTotal', 'DocTotal', '0')},
      ${optionalColumn(columns, 'T0', currencyColumn, 'DocCur', "'INR'")},
      ${optionalColumn(columns, 'T0', 'DocStatus', 'DocStatus')},
      ${optionalColumn(columns, 'T0', 'CANCELED', 'CANCELED', "'N'")}
    FROM ${meta.header} T0
    WHERE T0.${keyField} = @docEntry
  `, { docEntry }));

  const row = rows[0];
  if (!row) return null;

  return {
    id: `${objectType}-${row.DocEntry}`,
    objectType,
    type: toNodeType(meta.label),
    family: meta.family,
    rank: meta.rank,
    label: meta.label,
    docEntry: row.DocEntry,
    docNum: row.DocNum,
    postingDate: formatSapDate(row.DocDate),
    deliveryDate: formatSapDate(row.DocDueDate),
    documentDate: formatSapDate(row.TaxDate || row.DocDate),
    customerRefNo: row.NumAtCard || '',
    cardCode: row.CardCode || '',
    cardName: row.CardName || '',
    total: row.DocTotal != null ? Number(row.DocTotal) : 0,
    currency: row.DocCur || 'INR',
    status: row.CANCELED === 'Y' ? 'Canceled' : row.DocStatus === 'O' ? 'Open' : row.DocStatus === 'C' ? 'Closed' : '',
  };
};

const getAncestorRefs = async (objectType, docEntry) => {
  const meta = DOCUMENT_TYPES[objectType];
  if (!meta) return [];

  if (objectType === 24 || objectType === 46) {
    const rows = await safe(db.query(`
      SELECT DISTINCT InvType, DocEntry
      FROM ${meta.paymentLine}
      WHERE DocNum = @docEntry
        AND InvType IS NOT NULL
        AND InvType > 0
        AND DocEntry IS NOT NULL
    `, { docEntry }));

    return rows
      .map((row) => ({ objectType: toType(row.InvType), docEntry: Number(row.DocEntry) }))
      .filter((row) => DOCUMENT_TYPES[row.objectType] && Number.isFinite(row.docEntry));
  }

  if (objectType === 30) {
    const rows = await safe(db.query(`
      SELECT TOP 1 TransType, CreatedBy
      FROM OJDT
      WHERE TransId = @docEntry
        AND TransType IS NOT NULL
        AND CreatedBy IS NOT NULL
    `, { docEntry }));

    return rows
      .map((row) => ({ objectType: toType(row.TransType), docEntry: Number(row.CreatedBy) }))
      .filter((row) => row.objectType !== 30 && DOCUMENT_TYPES[row.objectType] && Number.isFinite(row.docEntry) && row.docEntry > 0);
  }

  const columns = await getTableColumns(meta.line);
  if (!columns.has('BASETYPE') || !columns.has('BASEENTRY')) return [];

  const rows = await safe(db.query(`
    SELECT DISTINCT BaseType, BaseEntry
    FROM ${meta.line}
    WHERE DocEntry = @docEntry
      AND BaseType IS NOT NULL
      AND BaseType > 0
      AND BaseEntry IS NOT NULL
  `, { docEntry }));

  return rows
    .map((row) => ({ objectType: toType(row.BaseType), docEntry: Number(row.BaseEntry) }))
    .filter((row) => DOCUMENT_TYPES[row.objectType] && Number.isFinite(row.docEntry));
};

const getDescendantRefs = async (objectType, docEntry) => {
  if (objectType === 30) return [];

  const baseDocumentLookups = await Promise.all(
    Object.entries(DOCUMENT_TYPES).map(async ([childTypeText, childMeta]) => {
      const childType = Number(childTypeText);
      if (!childMeta.line) return [];
      const columns = await getTableColumns(childMeta.line);
      if (!columns.has('BASETYPE') || !columns.has('BASEENTRY')) return [];

      const rows = await safe(db.query(`
        SELECT DISTINCT T0.DocEntry
        FROM ${childMeta.header} T0
        INNER JOIN ${childMeta.line} T1 ON T1.DocEntry = T0.DocEntry
        WHERE T1.BaseType = @objectType
          AND T1.BaseEntry = @docEntry
      `, { objectType, docEntry }));

      return rows
        .map((row) => ({ objectType: childType, docEntry: Number(row.DocEntry) }))
        .filter((row) => Number.isFinite(row.docEntry));
    })
  );

  const paymentLookups = await Promise.all(
    [
      { objectType: 24, header: 'ORCT', line: 'RCT2' },
      { objectType: 46, header: 'OVPM', line: 'VPM2' },
    ].map(async (paymentMeta) => {
      const rows = await safe(db.query(`
        SELECT DISTINCT T0.DocEntry
        FROM ${paymentMeta.header} T0
        INNER JOIN ${paymentMeta.line} T1 ON T1.DocNum = T0.DocEntry
        WHERE T1.InvType = @objectType
          AND T1.DocEntry = @docEntry
          AND ISNULL(T0.Canceled, 'N') <> 'Y'
      `, { objectType, docEntry }));

      return rows
        .map((row) => ({ objectType: paymentMeta.objectType, docEntry: Number(row.DocEntry) }))
        .filter((row) => Number.isFinite(row.docEntry));
    })
  );

  const journalRows = await safe(db.query(`
    SELECT DISTINCT TransId
    FROM OJDT
    WHERE TransType = @objectType
      AND CreatedBy = @docEntry
  `, { objectType, docEntry }));
  const journalLookups = journalRows
    .map((row) => ({ objectType: 30, docEntry: Number(row.TransId) }))
    .filter((row) => Number.isFinite(row.docEntry));

  return [
    ...baseDocumentLookups.flat(),
    ...paymentLookups.flat(),
    ...journalLookups,
  ];
};

const getRelationshipMap = async ({ objectType, docEntry }) => {
  const normalizedObjectType = toType(objectType);
  const normalizedDocEntry = Number(docEntry);
  if (!DOCUMENT_TYPES[normalizedObjectType]) {
    throw new Error('Unsupported document type for relationship map.');
  }
  if (!Number.isFinite(normalizedDocEntry) || normalizedDocEntry <= 0) {
    throw new Error('Document DocEntry is required.');
  }

  const nodes = new Map();
  const edges = new Map();
  const visited = new Set();

  const addEdge = (fromType, fromEntry, toType, toEntry) => {
    const key = `${fromType}-${fromEntry}->${toType}-${toEntry}`;
    edges.set(key, {
      from: `${fromType}-${fromEntry}`,
      to: `${toType}-${toEntry}`,
      type: `${fromType}-to-${toType}`,
    });
  };

  const visit = async (type, entry, depth) => {
    const key = `${type}-${entry}`;
    if (visited.has(key) || depth > MAX_DEPTH) return;
    visited.add(key);

    const document = await getDocument(type, entry);
    if (!document) return;
    nodes.set(key, document);

    const [ancestors, descendants] = await Promise.all([
      getAncestorRefs(type, entry),
      getDescendantRefs(type, entry),
    ]);

    for (const ancestor of ancestors) {
      addEdge(ancestor.objectType, ancestor.docEntry, type, entry);
      await visit(ancestor.objectType, ancestor.docEntry, depth + 1);
    }

    for (const descendant of descendants) {
      addEdge(type, entry, descendant.objectType, descendant.docEntry);
      await visit(descendant.objectType, descendant.docEntry, depth + 1);
    }
  };

  await visit(normalizedObjectType, normalizedDocEntry, 0);

  const root = nodes.get(`${normalizedObjectType}-${normalizedDocEntry}`);
  if (!root) {
    throw new Error('Document not found.');
  }

  const partnerSource = [root, ...nodes.values()].find((node) => node.cardCode || node.cardName) || root;
  const partnerId = `bp-${partnerSource.cardCode || partnerSource.cardName || normalizedDocEntry}`;
  const partnerNode = {
    id: partnerId,
    type: 'businessPartner',
    label: DOCUMENT_TYPES[normalizedObjectType].partnerLabel,
    cardCode: partnerSource.cardCode || '',
    cardName: partnerSource.cardName || '',
  };

  const documentNodes = [...nodes.values()].sort((a, b) => (
    a.rank - b.rank ||
    (a.family || '').localeCompare(b.family || '') ||
    String(a.postingDate || '').localeCompare(String(b.postingDate || '')) ||
    Number(a.docNum || 0) - Number(b.docNum || 0)
  ));

  if (partnerNode.cardCode || partnerNode.cardName) {
    edges.set(`${partnerId}->${root.id}`, {
      from: partnerId,
      to: root.id,
      type: 'bp-to-document',
    });
  }

  return {
    document: root,
    businessPartner: {
      cardCode: partnerNode.cardCode,
      cardName: partnerNode.cardName,
    },
    nodes: [partnerNode, ...documentNodes],
    edges: [...edges.values()],
  };
};

module.exports = {
  DOCUMENT_TYPES,
  getRelationshipMap,
};
