import { buildCopyToState, createCopyToWindowId, openCopyToDocument } from '../utils/copyToState';

const copyTargetConfig = {
  purchaseRequest: {
    purchaseQuotation: {
      targetDocType: 'purchaseQuotation',
      targetLabel: 'Purchase Quotation',
      targetPath: '/purchase-quotation',
    },
    purchaseOrder: {
      targetDocType: 'purchaseOrder',
      targetLabel: 'Purchase Order',
      targetPath: '/purchase-order',
    },
  },
  salesQuotation: {
    'sales-order': {
      targetDocType: 'salesOrder',
      targetLabel: 'Sales Order',
      targetPath: '/sales-order',
    },
    delivery: {
      targetDocType: 'delivery',
      targetLabel: 'Delivery',
      targetPath: '/delivery/new',
      targetAliases: ['/delivery'],
    },
    'ar-invoice': {
      targetDocType: 'arInvoice',
      targetLabel: 'A/R Invoice',
      targetPath: '/ar-invoice',
    },
  },
  salesOrder: {
    delivery: {
      targetDocType: 'delivery',
      targetLabel: 'Delivery',
      targetPath: '/delivery/new',
      targetAliases: ['/delivery'],
    },
    'ar-invoice': {
      targetDocType: 'arInvoice',
      targetLabel: 'A/R Invoice',
      targetPath: '/ar-invoice',
    },
  },
  delivery: {
    'ar-invoice': {
      targetDocType: 'arInvoice',
      targetLabel: 'A/R Invoice',
      targetPath: '/ar-invoice',
    },
  },
  serviceArInvoice: {
    arCreditMemo: {
      targetDocType: 'serviceArCreditMemo',
      targetLabel: 'Service A/R Credit Memo',
      targetPath: '/services/ar-credit-memo',
    },
    'ar-credit-memo': {
      targetDocType: 'serviceArCreditMemo',
      targetLabel: 'Service A/R Credit Memo',
      targetPath: '/services/ar-credit-memo',
    },
  },
  serviceApInvoice: {
    apCreditMemo: {
      targetDocType: 'serviceApCreditMemo',
      targetLabel: 'Service A/P Credit Memo',
      targetPath: '/services/ap-credit-memo',
    },
    'ap-credit-memo': {
      targetDocType: 'serviceApCreditMemo',
      targetLabel: 'Service A/P Credit Memo',
      targetPath: '/services/ap-credit-memo',
    },
  },
  purchaseQuotation: {
    'purchase-order': {
      targetDocType: 'purchaseOrder',
      targetLabel: 'Purchase Order',
      targetPath: '/purchase-order',
    },
    purchaseOrder: {
      targetDocType: 'purchaseOrder',
      targetLabel: 'Purchase Order',
      targetPath: '/purchase-order',
    },
  },
  purchaseOrder: {
    grpo: {
      targetDocType: 'grpo',
      targetLabel: 'Goods Receipt PO',
      targetPath: '/grpo',
    },
    // SAP B1 allows an A/P Invoice to be drawn straight from an open Purchase
    // Order; the invoice then receives the stock instead of a Goods Receipt PO.
    'ap-invoice': {
      targetDocType: 'apInvoice',
      targetLabel: 'A/P Invoice',
      targetPath: '/ap-invoice',
    },
    apInvoice: {
      targetDocType: 'apInvoice',
      targetLabel: 'A/P Invoice',
      targetPath: '/ap-invoice',
    },
  },
  grpo: {
    'ap-invoice': {
      targetDocType: 'apInvoice',
      targetLabel: 'A/P Invoice',
      targetPath: '/ap-invoice',
    },
    apInvoice: {
      targetDocType: 'apInvoice',
      targetLabel: 'A/P Invoice',
      targetPath: '/ap-invoice',
    },
  },
  apInvoice: {
    'ap-credit-memo': {
      targetDocType: 'apCreditMemo',
      targetLabel: 'A/P Credit Memo',
      targetPath: '/ap-credit-memo',
    },
    apCreditMemo: {
      targetDocType: 'apCreditMemo',
      targetLabel: 'A/P Credit Memo',
      targetPath: '/ap-credit-memo',
    },
  },
};

const sourceLabels = {
  purchaseRequest: 'Purchase Request',
  salesQuotation: 'Sales Quotation',
  salesOrder: 'Sales Order',
  delivery: 'Delivery',
  arInvoice: 'A/R Invoice',
  serviceArInvoice: 'Service A/R Invoice',
  serviceApInvoice: 'Service A/P Invoice',
  serviceApCreditMemo: 'Service A/P Credit Memo',
  serviceArCreditMemo: 'Service A/R Credit Memo',
  purchaseQuotation: 'Purchase Quotation',
  purchaseOrder: 'Purchase Order',
  grpo: 'Goods Receipt PO',
  apInvoice: 'A/P Invoice',
};

const sourceBaseTypes = {
  purchaseRequest: 1470000113,
  salesQuotation: 23,
  salesOrder: 17,
  delivery: 15,
  arInvoice: 13,
  serviceArInvoice: 13,
  serviceApInvoice: 18,
  serviceApCreditMemo: 19,
  serviceArCreditMemo: 14,
  purchaseQuotation: 540000006,
  purchaseOrder: 22,
  grpo: 20,
  apInvoice: 18,
};

// Resolves one Copy To target, accepting either the hyphenated toolbar key or
// its camelCase alias.
export const getCopyToTarget = (sourceDocType, targetType) => (
  (copyTargetConfig[sourceDocType] || {})[targetType] || null
);

export const getCopyToTargets = (sourceDocType) => {
  const sourceConfig = copyTargetConfig[sourceDocType] || {};
  return Object.entries(sourceConfig)
    .filter(([key]) => !key.includes('-') || !sourceConfig[key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())])
    .map(([key, config]) => ({
      key,
      label: config.targetLabel,
      targetDocType: config.targetDocType,
      targetPath: config.targetPath,
    }));
};

// Only open lines can be drawn into a target document. A Goods Receipt PO and
// a Purchase Order both carry line status and open quantity, so both are
// filtered; other sources copy in full.
const OPEN_LINE_FILTERED_SOURCES = new Set(['grpo', 'purchaseOrder']);

export const getCopyableSourceLines = (sourceDocType, lines = []) => {
  const sourceLines = Array.isArray(lines) ? lines : [];
  if (!OPEN_LINE_FILTERED_SOURCES.has(sourceDocType)) return sourceLines;

  return sourceLines.filter((line = {}) => {
    const lineStatus = String(line.lineStatus ?? line.LineStatus ?? '').trim().toUpperCase();
    if (lineStatus && !['O', 'OPEN'].includes(lineStatus)) return false;

    const rawOpenQty = line.openQty ?? line.OpenQty ?? line.OpenQuantity;
    if (rawOpenQty !== undefined && rawOpenQty !== null && String(rawOpenQty).trim() !== '') {
      return Number(rawOpenQty) > 0;
    }

    return Number(line.quantity ?? line.Quantity ?? 0) > 0;
  });
};

export const copyToDocument = async ({
  sourceDocType,
  targetType,
  sourceDocEntry,
  sourceDocNo,
  sourcePath,
  sourceSnapshot = {},
  restoreState = {},
  navigate,
  upsertTask,
  removeTask,
  beforeNavigate,
  setError,
  errorMessage,
}) => {
  const sourceConfig = copyTargetConfig[sourceDocType] || {};
  const targetConfig = sourceConfig[targetType];
  const sourceLabel = sourceLabels[sourceDocType] || 'Document';
  const baseType = sourceBaseTypes[sourceDocType];

  if (!sourceDocEntry) {
    setError?.(errorMessage || `Open a saved ${sourceLabel.toLowerCase()} before using Copy To.`);
    return false;
  }

  if (!targetConfig) {
    setError?.('Copy To is not configured for this target document.');
    return false;
  }

  console.info('[CopyTo] requested', {
    sourceDocType,
    sourceDocEntry,
    targetType,
    targetRoute: targetConfig.targetPath,
  });

  const copyableLines = getCopyableSourceLines(sourceDocType, sourceSnapshot.lines);
  if (OPEN_LINE_FILTERED_SOURCES.has(sourceDocType) && !copyableLines.length) {
    setError?.(`This ${sourceLabel} has no open quantity left. It has already been fully copied.`);
    return false;
  }

  // Keep source-document details that are not part of the common header/line
  // shape (for example freight rows). Target pages decide which extras apply.
  const {
    header: sourceHeader,
    headerUdfs: sourceHeaderUdfs,
  } = sourceSnapshot || {};
  const extraCopyFrom = { ...(sourceSnapshot || {}) };
  delete extraCopyFrom.header;
  delete extraCopyFrom.lines;
  delete extraCopyFrom.headerUdfs;

  const copyState = buildCopyToState({
    sourceDocType,
    sourceLabel,
    sourceDocEntry,
    sourceDocNo,
    header: sourceHeader,
    lines: copyableLines,
    headerUdfs: sourceHeaderUdfs,
    baseType,
    extraCopyFrom,
    extraState: targetConfig.extraState,
  });

  console.info('[CopyTo] final open request', {
    sourceDocEntry,
    targetDocType: targetConfig.targetDocType,
    targetRoute: targetConfig.targetPath,
    targetWindowId: createCopyToWindowId(targetConfig.targetDocType, sourceDocType, sourceDocEntry),
  });

  return openCopyToDocument({
    sourceDocType,
    sourceLabel,
    sourceDocEntry,
    sourceDocNo,
    sourcePath,
    targetDocType: targetConfig.targetDocType,
    targetLabel: targetConfig.targetLabel,
    targetPath: targetConfig.targetPath,
    targetAliases: targetConfig.targetAliases,
    copyState,
    restoreState,
    navigate,
    upsertTask,
    removeTask,
    beforeNavigate,
    setError,
    errorMessage,
  });
};
