const companyDbService = require('./dbService');
const authDbService = require('./authDbService');
const env = require('../config/env');

const REPORT_LAYOUT_STORAGE_TABLE_PATTERN = /\b(?:dbo\.)?(ReportLayoutMenuEntries|ReportLayouts|ReportLayoutVersions)\b/i;
const dbService = {
  query: (sql, params = {}, options = {}) => (
    REPORT_LAYOUT_STORAGE_TABLE_PATTERN.test(String(sql || ''))
      ? authDbService.query(sql, params)
      : companyDbService.query(sql, params, options)
  ),
};

const SAP_B1_MENU_CATEGORIES = [
  'Administration',
  'Financials',
  'CRM',
  'Opportunities',
  'Sales - A/R',
  'Purchasing - A/P',
  'Business Partners',
  'Banking',
  'Inventory',
  'Resources',
  'Production',
  'MRP',
  'Service',
  'Human Resources',
  'Lost Reports',
  'Add-On Layouts',
];

const REPORT_DEFINITIONS = {
  SALES_REGISTER: {
    code: 'SALES_REGISTER',
    name: 'Sales Register',
    description: 'Invoice-wise sales register with customer and line-level values.',
    previewTitle: 'Sales Register',
    filters: [
      { key: 'fromDate', label: 'From Date', type: 'date' },
      { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'customerCode', label: 'Customer Code', type: 'text' },
    ],
    fields: [
      { key: 'docNum', label: 'Invoice No', type: 'number', source: 'OINV.DocNum' },
      { key: 'postingDate', label: 'Posting Date', type: 'date', source: 'OINV.DocDate' },
      { key: 'dueDate', label: 'Due Date', type: 'date', source: 'OINV.DocDueDate' },
      { key: 'customerCode', label: 'Customer Code', type: 'text', source: 'OINV.CardCode' },
      { key: 'customerName', label: 'Customer Name', type: 'text', source: 'OINV.CardName' },
      { key: 'itemCode', label: 'Item Code', type: 'text', source: 'INV1.ItemCode' },
      { key: 'itemDescription', label: 'Item Description', type: 'text', source: 'INV1.Dscription' },
      { key: 'qty', label: 'Quantity', type: 'number', source: 'INV1.Quantity' },
      { key: 'price', label: 'Price', type: 'currency', source: 'INV1.Price' },
      { key: 'lineTotal', label: 'Line Total', type: 'currency', source: 'INV1.LineTotal' },
      { key: 'docTotal', label: 'Document Total', type: 'currency', source: 'OINV.DocTotal' },
      { key: 'salesEmployee', label: 'Sales Employee', type: 'text', source: 'OSLP.SlpName' },
    ],
    sampleRows: [
      {
        docNum: 91001,
        postingDate: '2026-04-28',
        dueDate: '2026-05-05',
        customerCode: 'C20001',
        customerName: 'Northwind Traders',
        itemCode: 'FG-1001',
        itemDescription: 'Industrial Pump',
        qty: 4,
        price: 1250,
        lineTotal: 5000,
        docTotal: 6480,
        salesEmployee: 'Anita Rao',
      },
      {
        docNum: 91001,
        postingDate: '2026-04-28',
        dueDate: '2026-05-05',
        customerCode: 'C20001',
        customerName: 'Northwind Traders',
        itemCode: 'SP-2205',
        itemDescription: 'Seal Kit',
        qty: 6,
        price: 180,
        lineTotal: 1080,
        docTotal: 6480,
        salesEmployee: 'Anita Rao',
      },
      {
        docNum: 91002,
        postingDate: '2026-04-29',
        dueDate: '2026-05-06',
        customerCode: 'C20044',
        customerName: 'Blue Ocean Retail',
        itemCode: 'FG-1055',
        itemDescription: 'Flow Meter',
        qty: 2,
        price: 2140,
        lineTotal: 4280,
        docTotal: 5050.4,
        salesEmployee: 'Rajat Shah',
      },
    ],
  },
  STOCK_REPORT: {
    code: 'STOCK_REPORT',
    name: 'Stock Report',
    description: 'Warehouse stock snapshot including on-hand, committed, and available quantities.',
    previewTitle: 'Stock Availability',
    filters: [
      { key: 'warehouseCode', label: 'Warehouse', type: 'text' },
      { key: 'itemCode', label: 'Item Code', type: 'text' },
    ],
    fields: [
      { key: 'itemCode', label: 'Item Code', type: 'text', source: 'OITM.ItemCode' },
      { key: 'itemName', label: 'Item Name', type: 'text', source: 'OITM.ItemName' },
      { key: 'warehouseCode', label: 'Warehouse Code', type: 'text', source: 'OITW.WhsCode' },
      { key: 'warehouseName', label: 'Warehouse Name', type: 'text', source: 'OWHS.WhsName' },
      { key: 'uom', label: 'UoM', type: 'text', source: 'OITM.InvntryUom' },
      { key: 'onHand', label: 'On Hand', type: 'number', source: 'OITW.OnHand' },
      { key: 'committed', label: 'Committed', type: 'number', source: 'OITW.IsCommited' },
      { key: 'onOrder', label: 'On Order', type: 'number', source: 'OITW.OnOrder' },
      { key: 'available', label: 'Available', type: 'number', source: '(OnHand - IsCommited + OnOrder)' },
    ],
    sampleRows: [
      {
        itemCode: 'RM-1001',
        itemName: 'Stainless Steel Sheet',
        warehouseCode: 'RM01',
        warehouseName: 'Raw Material Main',
        uom: 'KG',
        onHand: 1260,
        committed: 180,
        onOrder: 240,
        available: 1320,
      },
      {
        itemCode: 'FG-1001',
        itemName: 'Industrial Pump',
        warehouseCode: 'FG01',
        warehouseName: 'Finished Goods',
        uom: 'NOS',
        onHand: 38,
        committed: 6,
        onOrder: 12,
        available: 44,
      },
      {
        itemCode: 'SP-2205',
        itemName: 'Seal Kit',
        warehouseCode: 'SP01',
        warehouseName: 'Spares Warehouse',
        uom: 'NOS',
        onHand: 420,
        committed: 55,
        onOrder: 100,
        available: 465,
      },
    ],
  },
  INVOICE_PRINT: {
    code: 'INVOICE_PRINT',
    name: 'Invoice Print',
    description: 'Customer invoice print layout with document header, lines, and totals.',
    previewTitle: 'Tax Invoice',
    filters: [
      { key: 'docNum', label: 'Invoice No', type: 'text' },
      { key: 'customerCode', label: 'Customer Code', type: 'text' },
    ],
    fields: [
      { key: 'docNum', label: 'Invoice No', type: 'number', source: 'OINV.DocNum' },
      { key: 'postingDate', label: 'Posting Date', type: 'date', source: 'OINV.DocDate' },
      { key: 'customerCode', label: 'Customer Code', type: 'text', source: 'OINV.CardCode' },
      { key: 'customerName', label: 'Customer Name', type: 'text', source: 'OINV.CardName' },
      { key: 'customerRef', label: 'Customer Ref', type: 'text', source: 'OINV.NumAtCard' },
      { key: 'lineNumber', label: 'Line No', type: 'number', source: 'INV1.LineNum + 1' },
      { key: 'itemCode', label: 'Item Code', type: 'text', source: 'INV1.ItemCode' },
      { key: 'itemDescription', label: 'Item Description', type: 'text', source: 'INV1.Dscription' },
      { key: 'qty', label: 'Quantity', type: 'number', source: 'INV1.Quantity' },
      { key: 'price', label: 'Price', type: 'currency', source: 'INV1.Price' },
      { key: 'lineTotal', label: 'Line Total', type: 'currency', source: 'INV1.LineTotal' },
      { key: 'discountTotal', label: 'Discount Total', type: 'currency', source: 'OINV.DiscSum' },
      { key: 'taxTotal', label: 'Tax Total', type: 'currency', source: 'OINV.VatSum' },
      { key: 'docTotal', label: 'Document Total', type: 'currency', source: 'OINV.DocTotal' },
    ],
    sampleRows: [
      {
        docNum: 82045,
        postingDate: '2026-04-30',
        customerCode: 'C30011',
        customerName: 'Vertex Engineering',
        customerRef: 'PO-VE-2208',
        lineNumber: 1,
        itemCode: 'FG-1001',
        itemDescription: 'Industrial Pump',
        qty: 2,
        price: 1250,
        lineTotal: 2500,
        discountTotal: 100,
        taxTotal: 432,
        docTotal: 2832,
      },
      {
        docNum: 82045,
        postingDate: '2026-04-30',
        customerCode: 'C30011',
        customerName: 'Vertex Engineering',
        customerRef: 'PO-VE-2208',
        lineNumber: 2,
        itemCode: 'SP-2205',
        itemDescription: 'Seal Kit',
        qty: 4,
        price: 180,
        lineTotal: 720,
        discountTotal: 100,
        taxTotal: 432,
        docTotal: 2832,
      },
    ],
  },
};

const DEFAULT_MANAGER_ENTRIES = [
  {
    menuCode: 'SALES_REGISTER',
    menuName: 'Sales Register',
    menuCategory: 'Sales - A/R',
    reportCode: 'SALES_REGISTER',
    entryType: 'Report',
    searchKeywords: 'sales register invoice register sales layout',
    isSystem: true,
  },
  {
    menuCode: 'STOCK_REPORT',
    menuName: 'Stock Report',
    menuCategory: 'Inventory',
    reportCode: 'STOCK_REPORT',
    entryType: 'Report',
    searchKeywords: 'stock inventory warehouse availability',
    isSystem: true,
  },
  {
    menuCode: 'INVOICE_PRINT',
    menuName: 'Invoice Print',
    menuCategory: 'Sales - A/R',
    reportCode: 'INVOICE_PRINT',
    entryType: 'Document Type',
    searchKeywords: 'invoice print customer invoice tax invoice',
    isSystem: true,
  },
];

const SAMPLE_LOGO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="56" viewBox="0 0 180 56">
      <rect width="180" height="56" rx="12" fill="#12324d"/>
      <rect x="8" y="8" width="40" height="40" rx="10" fill="#d79b38"/>
      <text x="28" y="35" text-anchor="middle" font-size="18" font-family="Segoe UI, Arial" fill="#12324d" font-weight="700">SB</text>
      <text x="62" y="25" font-size="15" font-family="Segoe UI, Arial" fill="#f6f7fb" font-weight="700">SAP B1</text>
      <text x="62" y="40" font-size="12" font-family="Segoe UI, Arial" fill="#bfd1df">Report Layout Manager</text>
    </svg>`,
  );

const REPORT_LAYOUT_MENU = {
  menuId: 990001,
  menuName: 'Report Layout Manager',
  menuPath: '/reportlayoutmanager',
  parentId: null,
  icon: 'RL',
  sortOrder: 990001,
  rights: {
    canView: true,
    canAdd: true,
    canEdit: true,
    canDelete: true,
  },
  children: [],
};

const toCode = (value) => String(value || '').trim().toUpperCase();
const clone = (value) => JSON.parse(JSON.stringify(value));

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const createActorLabel = (auth) => {
  if (auth?.username) return auth.username;
  if (auth?.userId) return `User ${auth.userId}`;
  return 'System';
};

const slugify = (value, fallback = 'CUSTOM_MENU') => {
  const slug = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);

  return slug || fallback;
};

const RDOC_PREFIX_TARGETS = {
  ACB: { categoryPath: 'Financials > Financial Reports', menuName: 'Account Balance' },
  ACT: { categoryPath: 'Financials > Financial Reports', menuName: 'Account Index' },
  AGE: { categoryPath: 'Financials > Financial Reports', menuName: 'Aging' },
  BIN: { categoryPath: 'Inventory', menuName: 'Bins' },
  CLG: { categoryPath: 'CRM', menuName: 'Activities' },
  CRD: { categoryPath: 'Business Partners', menuName: 'Business Partner' },
  DLN: { categoryPath: 'Sales - A/R', menuName: 'Delivery' },
  IGE: { categoryPath: 'Inventory', menuName: 'Goods Issue' },
  IGN: { categoryPath: 'Inventory', menuName: 'Goods Receipt' },
  INV: { categoryPath: 'Sales - A/R', menuName: 'A/R Invoice' },
  ITM: { categoryPath: 'Inventory', menuName: 'Items' },
  JDT: { categoryPath: 'Financials', menuName: 'Journal Entry' },
  JVC: { categoryPath: 'Financials', menuName: 'Journal Vouchers' },
  PCH: { categoryPath: 'Purchasing - A/P', menuName: 'A/P Invoice' },
  PDN: { categoryPath: 'Purchasing - A/P', menuName: 'Goods Receipt PO' },
  POR: { categoryPath: 'Purchasing - A/P', menuName: 'Purchase Order' },
  PQT: { categoryPath: 'Purchasing - A/P', menuName: 'Purchase Quotation' },
  PRQ: { categoryPath: 'Purchasing - A/P', menuName: 'Purchase Request' },
  QUT: { categoryPath: 'Sales - A/R', menuName: 'Sales Quotation' },
  RCR: { categoryPath: 'Financials', menuName: 'Internal Reconciliations' },
  RDN: { categoryPath: 'Sales - A/R', menuName: 'Return' },
  RDR: { categoryPath: 'Sales - A/R', menuName: 'Sales Order' },
  RIN: { categoryPath: 'Sales - A/R', menuName: 'A/R Credit Memo' },
  RPC: { categoryPath: 'Purchasing - A/P', menuName: 'A/P Credit Memo' },
  SCL: { categoryPath: 'Service', menuName: 'Service Call' },
  TAX: { categoryPath: 'Financials', menuName: 'Tax' },
  VAT: { categoryPath: 'Financials', menuName: 'Tax' },
  WHT: { categoryPath: 'Financials', menuName: 'Tax' },
  WKO: { categoryPath: 'Production', menuName: 'Production Order' },
  WTR: { categoryPath: 'Inventory', menuName: 'Inventory Transfer' },
  WTQ: { categoryPath: 'Inventory', menuName: 'Inventory Transfer Request' },
};

const stripSystemSuffix = (value) =>
  String(value || '')
    .replace(/\s*\(System\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const getRdocPrefix = (row = {}) => String(row.DocCode || row.TypeCode || '').trim().slice(0, 3).toUpperCase();

const resolveRdocTarget = (row = {}) => {
  const prefix = getRdocPrefix(row);
  const mapped = RDOC_PREFIX_TARGETS[prefix];
  if (mapped) {
    return {
      prefix,
      categoryPath: mapped.categoryPath,
      menuName: mapped.menuName,
    };
  }

  const fallbackName = stripSystemSuffix(row.DocName) || prefix || 'Layouts';
  return {
    prefix,
    categoryPath: 'Add-On Layouts',
    menuName: fallbackName,
  };
};

const sanitizeRdocLayoutRow = (row) => ({
  layoutId: String(row.DocCode || '').trim(),
  layoutName: String(row.DocName || '').trim() || String(row.DocCode || '').trim(),
  docCode: String(row.DocCode || '').trim(),
  typeCode: String(row.TypeCode || '').trim(),
  robjCode: toNullableInteger(row.RobjCode),
  layoutType: String(row.Category || '').trim().toUpperCase() === 'C' ? 'Crystal Reports' : 'PLD',
  status: String(row.Status || '').trim(),
  author: String(row.Author || '').trim(),
  description: String(row.Notes || '').trim(),
  localization: String(row.Local || '').trim(),
  printer: String(row.Printer || '').trim(),
  numCopies: toNullableInteger(row.NumCopy) ?? 1,
  languageCode: toNullableInteger(row.Language),
  b1Version: String(row.B1Version || '').trim(),
  crVersion: String(row.CRVersion || '').trim(),
  createdDate: row.CreateDate || null,
  updatedDate: row.UpdateDate || null,
  isDefault: false,
});

const compareCategoryPaths = (left, right) => {
  const leftRoot = SAP_B1_MENU_CATEGORIES.indexOf(String(left || '').split(' > ')[0]);
  const rightRoot = SAP_B1_MENU_CATEGORIES.indexOf(String(right || '').split(' > ')[0]);
  const leftOrder = leftRoot === -1 ? Number.MAX_SAFE_INTEGER : leftRoot;
  const rightOrder = rightRoot === -1 ? Number.MAX_SAFE_INTEGER : rightRoot;

  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  return String(left || '').localeCompare(String(right || ''));
};

const listRdocRows = async () => {
  const result = await dbService.query(`
    SELECT
      DocCode,
      DocName,
      TypeCode,
      RobjCode,
      Category,
      Status,
      Author,
      Notes,
      CreateDate,
      UpdateDate,
      B1Version,
      CRVersion,
      Local,
      Printer,
      NumCopy,
      Language
    FROM RDOC
    WHERE ISNULL(Status, 'A') = 'A'
    ORDER BY DocCode ASC
  `);

  return result.recordset || [];
};

const buildRdocCatalog = (rows = [], { includeLayouts = true } = {}) => {
  const groups = new Map();

  rows.forEach((row) => {
    const target = resolveRdocTarget(row);
    const groupKey = `${target.categoryPath}||${target.menuName}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        menuEntryId: `sap-rdoc:${slugify(target.categoryPath, 'CATEGORY')}:${slugify(target.menuName, 'MENU')}`,
        menuCode: target.prefix || 'RDOC',
        menuName: target.menuName,
        menuCategory: target.categoryPath,
        menuSequence: null,
        reportCode: '',
        entryType: 'Layout Group',
        searchKeywords: '',
        isSystem: true,
        source: 'sap-rdoc',
        layouts: [],
      });
    }

    groups.get(groupKey).layouts.push(sanitizeRdocLayoutRow(row));
  });

  const flatItems = [...groups.values()]
    .map((item) => ({
      ...item,
      layouts: includeLayouts
        ? [...item.layouts].sort((left, right) => {
            if (left.layoutName !== right.layoutName) {
              return left.layoutName.localeCompare(right.layoutName);
            }
            return left.layoutId.localeCompare(right.layoutId);
          })
        : [],
    }))
    .sort((left, right) => {
      const categoryComparison = compareCategoryPaths(left.menuCategory, right.menuCategory);
      if (categoryComparison !== 0) {
        return categoryComparison;
      }

      return left.menuName.localeCompare(right.menuName);
    });

  const categoryMap = new Map();
  flatItems.forEach((item) => {
    if (!categoryMap.has(item.menuCategory)) {
      categoryMap.set(item.menuCategory, {
        name: item.menuCategory,
        items: [],
      });
    }

    categoryMap.get(item.menuCategory).items.push(item);
  });

  const categories = [...categoryMap.values()].sort((left, right) => compareCategoryPaths(left.name, right.name));

  return {
    categories,
    flatItems,
  };
};

const toNullableInteger = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toBoolean = (value) => Boolean(value);

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const safeJsonParse = (value, fallbackValue) => {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallbackValue;
  }
};

const normalizeDateInput = (value) => {
  const text = String(value || '').trim();
  return text || null;
};

const createBlock = (id, type, overrides = {}) => ({
  id,
  type,
  label: overrides.label || type,
  content: overrides.content || '',
  src: overrides.src || '',
  style: {
    align: overrides.style?.align || 'left',
    width: overrides.style?.width || 'full',
    emphasis: overrides.style?.emphasis || 'normal',
    fontSize: overrides.style?.fontSize || 'medium',
    height: overrides.style?.height || 'md',
    borderStyle: overrides.style?.borderStyle || 'solid',
    accent: overrides.style?.accent || 'steel',
  },
});

const buildLayoutTemplate = (reportCode) => {
  const report = REPORT_DEFINITIONS[reportCode];
  if (!report) {
    throw createHttpError(400, `Unsupported report code: ${reportCode}`);
  }

  const commonHeader = [
    createBlock('header-logo', 'image', {
      label: 'Company Logo',
      src: 'logo://company',
      style: { align: 'left', width: 'sm', height: 'md' },
    }),
    createBlock('header-company', 'text', {
      label: 'Company Name',
      content: '{{company.companyName}}',
      style: { align: 'left', emphasis: 'title', fontSize: 'xl' },
    }),
    createBlock('header-title', 'text', {
      label: 'Report Title',
      content: report.previewTitle,
      style: { align: 'left', emphasis: 'heading', fontSize: 'lg' },
    }),
  ];

  const filtersBlock = [
    createBlock('filters-text', 'text', {
      label: 'Filters Summary',
      content: '{{filtersSummary}}',
      style: { align: 'left', emphasis: 'muted', fontSize: 'sm' },
    }),
  ];

  const footerBlocks = [
    createBlock('footer-line', 'line', {
      label: 'Footer Separator',
      style: { accent: 'steel' },
    }),
    createBlock('footer-total', 'text', {
      label: 'Footer Totals',
      content: 'Rows: {{summary.rowCount}} | Grand Total: {{summary.docTotal}}',
      style: { align: 'right', emphasis: 'heading', fontSize: 'sm' },
    }),
    createBlock('footer-signature', 'box', {
      label: 'Signature Box',
      content: 'Authorised Signatory',
      style: { align: 'right', width: 'md', height: 'lg', borderStyle: 'dashed' },
    }),
  ];

  if (reportCode === 'SALES_REGISTER') {
    return {
      version: 1,
      reportCode,
      page: { size: 'A4', orientation: 'portrait', pageSize: 12, margins: { top: 18, right: 16, bottom: 18, left: 16 } },
      header: { elements: commonHeader },
      filtersSection: { elements: filtersBlock },
      table: {
        showGrid: true,
        columns: [
          { id: 'docNum', kind: 'field', field: 'docNum', label: 'Invoice No', width: 120, align: 'left', dataType: 'number', showTotal: false },
          { id: 'postingDate', kind: 'field', field: 'postingDate', label: 'Posting Date', width: 120, align: 'left', dataType: 'date', showTotal: false },
          { id: 'customerName', kind: 'field', field: 'customerName', label: 'Customer', width: 220, align: 'left', dataType: 'text', showTotal: false },
          { id: 'itemDescription', kind: 'field', field: 'itemDescription', label: 'Item Description', width: 220, align: 'left', dataType: 'text', showTotal: false },
          { id: 'qty', kind: 'field', field: 'qty', label: 'Qty', width: 90, align: 'right', dataType: 'number', showTotal: true },
          { id: 'price', kind: 'field', field: 'price', label: 'Price', width: 100, align: 'right', dataType: 'currency', showTotal: false },
          { id: 'lineTotal', kind: 'field', field: 'lineTotal', label: 'Line Total', width: 120, align: 'right', dataType: 'currency', showTotal: true },
        ],
      },
      footer: { elements: footerBlocks },
    };
  }

  if (reportCode === 'STOCK_REPORT') {
    return {
      version: 1,
      reportCode,
      page: { size: 'A4', orientation: 'landscape', pageSize: 13, margins: { top: 16, right: 14, bottom: 16, left: 14 } },
      header: { elements: commonHeader },
      filtersSection: { elements: filtersBlock },
      table: {
        showGrid: true,
        columns: [
          { id: 'itemCode', kind: 'field', field: 'itemCode', label: 'Item Code', width: 120, align: 'left', dataType: 'text', showTotal: false },
          { id: 'itemName', kind: 'field', field: 'itemName', label: 'Item Name', width: 240, align: 'left', dataType: 'text', showTotal: false },
          { id: 'warehouseName', kind: 'field', field: 'warehouseName', label: 'Warehouse', width: 180, align: 'left', dataType: 'text', showTotal: false },
          { id: 'onHand', kind: 'field', field: 'onHand', label: 'On Hand', width: 110, align: 'right', dataType: 'number', showTotal: true },
          { id: 'committed', kind: 'field', field: 'committed', label: 'Committed', width: 110, align: 'right', dataType: 'number', showTotal: true },
          { id: 'onOrder', kind: 'field', field: 'onOrder', label: 'On Order', width: 110, align: 'right', dataType: 'number', showTotal: true },
          { id: 'available', kind: 'field', field: 'available', label: 'Available', width: 110, align: 'right', dataType: 'number', showTotal: true },
        ],
      },
      footer: { elements: footerBlocks },
    };
  }

  return {
    version: 1,
    reportCode,
    page: { size: 'A4', orientation: 'portrait', pageSize: 10, margins: { top: 18, right: 18, bottom: 18, left: 18 } },
    header: { elements: commonHeader },
    filtersSection: {
      elements: [
        ...filtersBlock,
        createBlock('invoice-banner', 'box', {
          label: 'Invoice Banner',
          content: 'Customer: {{firstRow.customerName}} | Reference: {{firstRow.customerRef}}',
          style: { align: 'left', width: 'full', height: 'md', borderStyle: 'solid', accent: 'amber' },
        }),
      ],
    },
    table: {
      showGrid: true,
      columns: [
        { id: 'lineNumber', kind: 'field', field: 'lineNumber', label: '#', width: 50, align: 'center', dataType: 'number', showTotal: false },
        { id: 'itemCode', kind: 'field', field: 'itemCode', label: 'Item Code', width: 120, align: 'left', dataType: 'text', showTotal: false },
        { id: 'itemDescription', kind: 'field', field: 'itemDescription', label: 'Description', width: 250, align: 'left', dataType: 'text', showTotal: false },
        { id: 'qty', kind: 'field', field: 'qty', label: 'Qty', width: 90, align: 'right', dataType: 'number', showTotal: true },
        { id: 'price', kind: 'field', field: 'price', label: 'Price', width: 100, align: 'right', dataType: 'currency', showTotal: false },
        { id: 'lineTotal', kind: 'field', field: 'lineTotal', label: 'Line Total', width: 120, align: 'right', dataType: 'currency', showTotal: true },
        { id: 'discountTotal', kind: 'field', field: 'discountTotal', label: 'Discount', width: 110, align: 'right', dataType: 'currency', showTotal: false },
        { id: 'taxTotal', kind: 'field', field: 'taxTotal', label: 'Tax', width: 90, align: 'right', dataType: 'currency', showTotal: false },
        { id: 'docTotal', kind: 'field', field: 'docTotal', label: 'Doc Total', width: 120, align: 'right', dataType: 'currency', showTotal: false },
      ],
    },
    footer: {
      elements: [
        ...footerBlocks,
        createBlock('invoice-note', 'text', {
          label: 'Invoice Note',
          content: 'Amount Payable: {{summary.docTotal}}',
          style: { align: 'right', emphasis: 'title', fontSize: 'md' },
        }),
      ],
    },
  };
};

let ensureSchemaPromise = null;

const getReportDefinition = (reportCode) => {
  const normalized = toCode(reportCode);
  const definition = REPORT_DEFINITIONS[normalized];
  if (!definition) {
    throw createHttpError(400, `Unsupported report code: ${reportCode}`);
  }
  return definition;
};

const normalizeLayoutJson = (layoutJson, reportCode) => {
  if (layoutJson && typeof layoutJson === 'object') {
    return layoutJson;
  }

  return buildLayoutTemplate(reportCode);
};

const sanitizeMenuEntryRow = (row) => ({
  menuEntryId: row.MenuEntryID,
  menuCode: row.MenuCode,
  menuName: row.MenuName,
  menuCategory: row.MenuCategory,
  menuSequence: row.MenuSequence == null ? null : Number(row.MenuSequence),
  reportCode: row.ReportCode,
  entryType: row.EntryType,
  searchKeywords: row.SearchKeywords || '',
  isSystem: Boolean(row.IsSystem),
  createdBy: row.CreatedBy,
  createdDate: row.CreatedDate,
  updatedBy: row.UpdatedBy || '',
  updatedDate: row.UpdatedDate || null,
  layoutCount: Number(row.LayoutCount || 0),
  defaultLayoutCount: Number(row.DefaultLayoutCount || 0),
});

const sanitizeLayoutRow = (row) => ({
  layoutId: row.LayoutID,
  menuEntryId: row.MenuEntryID || null,
  layoutName: row.LayoutName,
  reportCode: row.ReportCode,
  layoutJson: safeJsonParse(row.LayoutJSON, buildLayoutTemplate(row.ReportCode)),
  isDefault: Boolean(row.IsDefault),
  createdBy: row.CreatedBy,
  createdDate: row.CreatedDate,
  updatedBy: row.UpdatedBy || '',
  updatedDate: row.UpdatedDate || null,
  assignedUserId: row.AssignedUserId,
  assignedRoleId: row.AssignedRoleId,
  menuName: row.MenuName || '',
  menuCategory: row.MenuCategory || '',
  menuCode: row.MenuCode || '',
});

const normalizeMenuEntryPayload = (payload = {}, auth = null) => {
  const report = getReportDefinition(payload.reportCode);
  const menuName = String(payload.menuName || '').trim();
  if (!menuName) {
    throw createHttpError(400, 'Menu name is required.');
  }

  const menuCategory = String(payload.menuCategory || 'Add-On Layouts').trim() || 'Add-On Layouts';
  const rawMenuSequence = payload.menuSequence;
  const menuSequence = rawMenuSequence === '' || rawMenuSequence === null || rawMenuSequence === undefined
    ? null
    : toNullableInteger(rawMenuSequence);
  const entryType = ['REPORT', 'DOCUMENT TYPE'].includes(toCode(payload.entryType).replace(/_/g, ' '))
    ? (toCode(payload.entryType).replace(/_/g, ' ') === 'DOCUMENT TYPE' ? 'Document Type' : 'Report')
    : 'Report';

  return {
    menuCode: slugify(payload.menuCode || menuName),
    menuName,
    menuCategory,
    menuSequence,
    reportCode: report.code,
    entryType,
    searchKeywords: String(payload.searchKeywords || '').trim(),
    isSystem: toBoolean(payload.isSystem),
    createdBy: String(payload.createdBy || '').trim() || createActorLabel(auth),
    updatedBy: createActorLabel(auth),
  };
};

const normalizeLayoutPayload = async (payload = {}, auth = null) => {
  const menuEntryId = toNullableInteger(payload.menuEntryId);
  let reportCode = payload.reportCode;

  if (menuEntryId) {
    const menuEntry = await getMenuEntryById(menuEntryId);
    reportCode = menuEntry.reportCode;
  }

  const report = getReportDefinition(reportCode);
  const layoutName = String(payload.layoutName || '').trim();
  if (!layoutName) {
    throw createHttpError(400, 'Layout name is required.');
  }

  return {
    layoutName,
    reportCode: report.code,
    menuEntryId,
    layoutJson: normalizeLayoutJson(payload.layoutJson, report.code),
    isDefault: toBoolean(payload.isDefault),
    createdBy: String(payload.createdBy || '').trim() || createActorLabel(auth),
    updatedBy: createActorLabel(auth),
    assignedUserId: toNullableInteger(payload.assignedUserId),
    assignedRoleId: toNullableInteger(payload.assignedRoleId),
  };
};

const queryMenuEntryById = async (menuEntryId) => {
  const result = await dbService.query(`
    SELECT MenuEntryID, MenuCode, MenuName, MenuCategory, MenuSequence, ReportCode, EntryType, SearchKeywords, IsSystem, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
    FROM dbo.ReportLayoutMenuEntries
    WHERE MenuEntryID = @menuEntryId
  `, { menuEntryId });

  const row = result.recordset?.[0];
  return row ? sanitizeMenuEntryRow(row) : null;
};

const queryMenuEntryByCode = async (menuCode) => {
  const result = await dbService.query(`
    SELECT MenuEntryID, MenuCode, MenuName, MenuCategory, MenuSequence, ReportCode, EntryType, SearchKeywords, IsSystem, CreatedBy, CreatedDate, UpdatedBy, UpdatedDate
    FROM dbo.ReportLayoutMenuEntries
    WHERE MenuCode = @menuCode
  `, { menuCode });

  const row = result.recordset?.[0];
  return row ? sanitizeMenuEntryRow(row) : null;
};

const getMenuEntryById = async (menuEntryId) => {
  await ensureSchema();
  const row = await queryMenuEntryById(menuEntryId);
  if (!row) {
    throw createHttpError(404, 'Menu entry not found.');
  }

  return row;
};

const findMenuEntryByCode = async (menuCode) => {
  await ensureSchema();
  return queryMenuEntryByCode(menuCode);
};

const getLayoutById = async (layoutId) => {
  await ensureSchema();
  const result = await dbService.query(`
    SELECT
      l.*,
      m.MenuCode,
      m.MenuName,
      m.MenuCategory
    FROM dbo.ReportLayouts l
    LEFT JOIN dbo.ReportLayoutMenuEntries m
      ON m.MenuEntryID = l.MenuEntryID
    WHERE l.LayoutID = @layoutId
  `, { layoutId });

  const row = result.recordset?.[0];
  if (!row) {
    throw createHttpError(404, 'Layout not found.');
  }

  return sanitizeLayoutRow(row);
};

const getOrCreateDefaultMenuEntry = async (reportCode) => {
  await ensureSchema();
  const existing = await dbService.query(`
    SELECT TOP 1 MenuEntryID
    FROM dbo.ReportLayoutMenuEntries
    WHERE ReportCode = @reportCode
    ORDER BY IsSystem DESC, MenuEntryID ASC
  `, { reportCode });

  const menuEntryId = existing.recordset?.[0]?.MenuEntryID;
  if (menuEntryId) {
    return getMenuEntryById(menuEntryId);
  }

  const seed = DEFAULT_MANAGER_ENTRIES.find((entry) => entry.reportCode === reportCode) || {
    menuCode: slugify(reportCode),
    menuName: reportCode,
    menuCategory: 'Add-On Layouts',
    reportCode,
    entryType: 'Report',
    searchKeywords: reportCode,
    isSystem: false,
  };

  return createMenuEntry(seed, { username: 'System' });
};

const clearDefaultLayouts = async ({ reportCode, menuEntryId = null, assignedUserId = null, assignedRoleId = null }) => {
  await dbService.query(`
    UPDATE dbo.ReportLayouts
    SET IsDefault = 0
    WHERE ReportCode = @reportCode
      AND ISNULL(MenuEntryID, -1) = ISNULL(@menuEntryId, -1)
      AND ISNULL(AssignedUserId, -1) = ISNULL(@assignedUserId, -1)
      AND ISNULL(AssignedRoleId, -1) = ISNULL(@assignedRoleId, -1)
  `, {
    reportCode,
    menuEntryId,
    assignedUserId,
    assignedRoleId,
  });
};

const getNextVersionNumber = async (layoutId) => {
  const result = await dbService.query(`
    SELECT ISNULL(MAX(VersionNo), 0) + 1 AS NextVersionNo
    FROM dbo.ReportLayoutVersions
    WHERE LayoutID = @layoutId
  `, { layoutId });

  return Number(result.recordset?.[0]?.NextVersionNo || 1);
};

const writeVersionSnapshot = async ({ layoutId, layoutJson, changedBy, changeNote }) => {
  const versionNo = await getNextVersionNumber(layoutId);
  await dbService.query(`
    INSERT INTO dbo.ReportLayoutVersions (
      LayoutID,
      VersionNo,
      LayoutJSON,
      ChangeNote,
      ChangedBy
    )
    VALUES (
      @layoutId,
      @versionNo,
      @layoutJson,
      @changeNote,
      @changedBy
    )
  `, {
    layoutId,
    versionNo,
    layoutJson: JSON.stringify(layoutJson),
    changeNote: changeNote || null,
    changedBy,
  });
};

const ensureSchema = async () => {
  if (!ensureSchemaPromise) {
    ensureSchemaPromise = (async () => {
      await authDbService.ensureSchema();

      for (const seedEntry of DEFAULT_MANAGER_ENTRIES) {
        const existing = await queryMenuEntryByCode(seedEntry.menuCode);
        if (existing) continue;

        await dbService.query(`
          INSERT INTO dbo.ReportLayoutMenuEntries (
            MenuCode,
            MenuName,
            MenuCategory,
            ReportCode,
            EntryType,
            SearchKeywords,
            IsSystem,
            CreatedBy,
            UpdatedBy,
            UpdatedDate
          )
          VALUES (
            @menuCode,
            @menuName,
            @menuCategory,
            @reportCode,
            @entryType,
            @searchKeywords,
            @isSystem,
            @createdBy,
            @updatedBy,
            SYSUTCDATETIME()
          )
        `, {
          menuCode: seedEntry.menuCode,
          menuName: seedEntry.menuName,
          menuCategory: seedEntry.menuCategory,
          reportCode: seedEntry.reportCode,
          entryType: seedEntry.entryType,
          searchKeywords: seedEntry.searchKeywords,
          isSystem: seedEntry.isSystem ? 1 : 0,
          createdBy: 'System',
          updatedBy: 'System',
        });
      }

      const seededMenusResult = await dbService.query(`
        SELECT MenuEntryID, MenuCode, ReportCode
        FROM dbo.ReportLayoutMenuEntries
      `);
      const menuIdByReportCode = new Map();
      for (const row of seededMenusResult.recordset || []) {
        if (!menuIdByReportCode.has(row.ReportCode)) {
          menuIdByReportCode.set(row.ReportCode, row.MenuEntryID);
        }
      }

      for (const [reportCode, menuEntryId] of menuIdByReportCode.entries()) {
        await dbService.query(`
          UPDATE dbo.ReportLayouts
          SET MenuEntryID = @menuEntryId
          WHERE ReportCode = @reportCode
            AND MenuEntryID IS NULL
        `, {
          menuEntryId,
          reportCode,
        });
      }

      for (const entry of DEFAULT_MANAGER_ENTRIES) {
        const menuEntry = await queryMenuEntryByCode(entry.menuCode);
        const countResult = await dbService.query(`
          SELECT COUNT(1) AS LayoutCount
          FROM dbo.ReportLayouts
          WHERE ReportCode = @reportCode
            AND ISNULL(MenuEntryID, -1) = ISNULL(@menuEntryId, -1)
        `, {
          reportCode: entry.reportCode,
          menuEntryId: menuEntry.menuEntryId,
        });

        const layoutCount = Number(countResult.recordset?.[0]?.LayoutCount || 0);
        if (layoutCount > 0) {
          continue;
        }

        const template = buildLayoutTemplate(entry.reportCode);
        const inserted = await dbService.query(`
          INSERT INTO dbo.ReportLayouts (
            MenuEntryID,
            LayoutName,
            ReportCode,
            LayoutJSON,
            IsDefault,
            CreatedBy,
            UpdatedBy,
            UpdatedDate,
            AssignedUserId,
            AssignedRoleId
          )
          OUTPUT INSERTED.LayoutID
          VALUES (
            @menuEntryId,
            @layoutName,
            @reportCode,
            @layoutJson,
            1,
            'System',
            'System',
            SYSUTCDATETIME(),
            NULL,
            NULL
          )
        `, {
          menuEntryId: menuEntry.menuEntryId,
          layoutName: `${entry.menuName} - Standard`,
          reportCode: entry.reportCode,
          layoutJson: JSON.stringify(template),
        });

        const layoutId = inserted.recordset?.[0]?.LayoutID;
        if (layoutId) {
          await writeVersionSnapshot({
            layoutId,
            layoutJson: template,
            changedBy: 'System',
            changeNote: 'Seeded standard sample layout',
          });
        }
      }
    })().catch((error) => {
      ensureSchemaPromise = null;
      throw error;
    });
  }

  return ensureSchemaPromise;
};

const listReports = async () =>
  Object.values(REPORT_DEFINITIONS).map((report) => ({
    code: report.code,
    name: report.name,
    description: report.description,
    filters: report.filters,
    fieldCount: report.fields.length,
  }));

const getReportFields = async (reportCode) => {
  const definition = getReportDefinition(reportCode);
  return {
    report: {
      code: definition.code,
      name: definition.name,
      description: definition.description,
      previewTitle: definition.previewTitle,
    },
    filters: definition.filters,
    fields: definition.fields,
  };
};

const listManagerCatalog = async ({ userId, roleId, includeLayouts = true, query = '', entryType = '' } = {}) => {
  await ensureSchema();
  const _userId = userId;
  const _roleId = roleId;
  const _query = query;
  const _entryType = entryType;
  void _userId;
  void _roleId;
  void _query;
  void _entryType;

  const rows = await listRdocRows();
  return buildRdocCatalog(rows, { includeLayouts });
};

const searchManagerCatalog = async ({ userId, roleId, query, entryType }) => {
  const _userId = userId;
  const _roleId = roleId;
  const _entryType = entryType;
  void _userId;
  void _roleId;
  void _entryType;

  const catalog = buildRdocCatalog(await listRdocRows(), { includeLayouts: true });
  const normalizedQuery = String(query || '').trim().toLowerCase();

  if (!normalizedQuery) {
    return {
      results: catalog.flatItems,
    };
  }

  return {
    results: catalog.flatItems.filter((item) => {
      const searchableParts = [
        item.menuCode,
        item.menuName,
        item.menuCategory,
        ...item.layouts.flatMap((layout) => [
          layout.layoutId,
          layout.layoutName,
          layout.typeCode,
          layout.author,
        ]),
      ];

      return searchableParts.some((part) => String(part || '').toLowerCase().includes(normalizedQuery));
    }),
  };
};

const listLayouts = async ({ reportCode, menuEntryId, userId, roleId }) => {
  await ensureSchema();
  let menuEntry = null;
  let definition = null;

  if (menuEntryId) {
    menuEntry = await getMenuEntryById(toNullableInteger(menuEntryId));
    definition = getReportDefinition(menuEntry.reportCode);
  } else {
    definition = getReportDefinition(reportCode);
  }

  const result = await dbService.query(`
    SELECT
      l.*,
      m.MenuCode,
      m.MenuName,
      m.MenuCategory
    FROM dbo.ReportLayouts l
    LEFT JOIN dbo.ReportLayoutMenuEntries m
      ON m.MenuEntryID = l.MenuEntryID
    WHERE l.ReportCode = @reportCode
      AND (CAST(@menuEntryId AS INTEGER) IS NULL OR l.MenuEntryID = @menuEntryId)
      AND (l.AssignedUserId IS NULL OR l.AssignedUserId = @userId)
      AND (l.AssignedRoleId IS NULL OR l.AssignedRoleId = @roleId)
    ORDER BY
      CASE WHEN l.AssignedUserId = @userId THEN 0 ELSE 1 END,
      CASE WHEN l.AssignedRoleId = @roleId THEN 0 ELSE 1 END,
      l.IsDefault DESC,
      l.LayoutName ASC
  `, {
    reportCode: definition.code,
    menuEntryId: toNullableInteger(menuEntryId),
    userId: toNullableInteger(userId),
    roleId: toNullableInteger(roleId),
  });

  return {
    report: {
      code: definition.code,
      name: definition.name,
      description: definition.description,
    },
    menuEntry,
    layouts: (result.recordset || []).map(sanitizeLayoutRow),
  };
};

const createMenuEntry = async (payload, auth) => {
  await ensureSchema();
  const normalized = normalizeMenuEntryPayload(payload, auth);
  const existing = await findMenuEntryByCode(normalized.menuCode);
  if (existing) {
    throw createHttpError(409, 'A menu entry with the same code already exists.');
  }

  const inserted = await dbService.query(`
    INSERT INTO dbo.ReportLayoutMenuEntries (
      MenuCode,
      MenuName,
      MenuCategory,
      MenuSequence,
      ReportCode,
      EntryType,
      SearchKeywords,
      IsSystem,
      CreatedBy,
      UpdatedBy,
      UpdatedDate
    )
    OUTPUT INSERTED.MenuEntryID
    VALUES (
      @menuCode,
      @menuName,
      @menuCategory,
      @menuSequence,
      @reportCode,
      @entryType,
      @searchKeywords,
      @isSystem,
      @createdBy,
      @updatedBy,
      SYSUTCDATETIME()
    )
  `, {
    menuCode: normalized.menuCode,
    menuName: normalized.menuName,
    menuCategory: normalized.menuCategory,
    menuSequence: normalized.menuSequence,
    reportCode: normalized.reportCode,
    entryType: normalized.entryType,
    searchKeywords: normalized.searchKeywords,
    isSystem: normalized.isSystem ? 1 : 0,
    createdBy: normalized.createdBy,
    updatedBy: normalized.updatedBy,
  });

  return getMenuEntryById(inserted.recordset?.[0]?.MenuEntryID);
};

const updateMenuEntry = async (menuEntryId, payload, auth) => {
  await ensureSchema();
  const existing = await getMenuEntryById(menuEntryId);
  if (existing.isSystem) {
    throw createHttpError(403, 'System menu entries cannot be renamed. Create a custom menu entry instead.');
  }

  const normalized = normalizeMenuEntryPayload({
    ...existing,
    ...payload,
    reportCode: payload.reportCode || existing.reportCode,
    menuName: payload.menuName || existing.menuName,
    menuCategory: payload.menuCategory || existing.menuCategory,
    menuSequence: payload.menuSequence ?? existing.menuSequence,
    menuCode: payload.menuCode || existing.menuCode,
    entryType: payload.entryType || existing.entryType,
    searchKeywords: payload.searchKeywords ?? existing.searchKeywords,
  }, auth);

  const duplicate = await findMenuEntryByCode(normalized.menuCode);
  if (duplicate && duplicate.menuEntryId !== menuEntryId) {
    throw createHttpError(409, 'Another menu entry already uses this code.');
  }

  if (normalized.reportCode !== existing.reportCode) {
    const layoutsResult = await dbService.query(`
      SELECT COUNT(1) AS LayoutCount
      FROM dbo.ReportLayouts
      WHERE MenuEntryID = @menuEntryId
    `, { menuEntryId });

    if (Number(layoutsResult.recordset?.[0]?.LayoutCount || 0) > 0) {
      throw createHttpError(400, 'You cannot change the linked report template after layouts have been created for this menu.');
    }
  }

  await dbService.query(`
    UPDATE dbo.ReportLayoutMenuEntries
    SET
      MenuCode = @menuCode,
      MenuName = @menuName,
      MenuCategory = @menuCategory,
      MenuSequence = @menuSequence,
      ReportCode = @reportCode,
      EntryType = @entryType,
      SearchKeywords = @searchKeywords,
      UpdatedBy = @updatedBy,
      UpdatedDate = SYSUTCDATETIME()
    WHERE MenuEntryID = @menuEntryId
  `, {
    menuEntryId,
    menuCode: normalized.menuCode,
    menuName: normalized.menuName,
    menuCategory: normalized.menuCategory,
    menuSequence: normalized.menuSequence,
    reportCode: normalized.reportCode,
    entryType: normalized.entryType,
    searchKeywords: normalized.searchKeywords,
    updatedBy: normalized.updatedBy,
  });

  return getMenuEntryById(menuEntryId);
};

const deleteMenuEntry = async (menuEntryId) => {
  await ensureSchema();
  const existing = await getMenuEntryById(menuEntryId);
  if (existing.isSystem) {
    throw createHttpError(403, 'System menu entries cannot be deleted.');
  }

  const layoutsResult = await dbService.query(`
    SELECT LayoutID
    FROM dbo.ReportLayouts
    WHERE MenuEntryID = @menuEntryId
  `, { menuEntryId });

  for (const row of layoutsResult.recordset || []) {
    await dbService.query(`DELETE FROM dbo.ReportLayoutVersions WHERE LayoutID = @layoutId`, { layoutId: row.LayoutID });
  }

  await dbService.query(`DELETE FROM dbo.ReportLayouts WHERE MenuEntryID = @menuEntryId`, { menuEntryId });
  await dbService.query(`DELETE FROM dbo.ReportLayoutMenuEntries WHERE MenuEntryID = @menuEntryId`, { menuEntryId });

  return {
    success: true,
    deletedMenuEntryId: menuEntryId,
  };
};

const createLayout = async (payload, auth) => {
  await ensureSchema();
  const normalized = await normalizeLayoutPayload(payload, auth);
  const menuEntry =
    normalized.menuEntryId
      ? await getMenuEntryById(normalized.menuEntryId)
      : await getOrCreateDefaultMenuEntry(normalized.reportCode);

  if (normalized.isDefault) {
    await clearDefaultLayouts({
      reportCode: normalized.reportCode,
      menuEntryId: menuEntry.menuEntryId,
      assignedUserId: normalized.assignedUserId,
      assignedRoleId: normalized.assignedRoleId,
    });
  }

  const inserted = await dbService.query(`
    INSERT INTO dbo.ReportLayouts (
      MenuEntryID,
      LayoutName,
      ReportCode,
      LayoutJSON,
      IsDefault,
      CreatedBy,
      UpdatedBy,
      UpdatedDate,
      AssignedUserId,
      AssignedRoleId
    )
    OUTPUT INSERTED.LayoutID
    VALUES (
      @menuEntryId,
      @layoutName,
      @reportCode,
      @layoutJson,
      @isDefault,
      @createdBy,
      @updatedBy,
      SYSUTCDATETIME(),
      @assignedUserId,
      @assignedRoleId
    )
  `, {
    menuEntryId: menuEntry.menuEntryId,
    layoutName: normalized.layoutName,
    reportCode: normalized.reportCode,
    layoutJson: JSON.stringify(normalized.layoutJson),
    isDefault: normalized.isDefault ? 1 : 0,
    createdBy: normalized.createdBy,
    updatedBy: normalized.updatedBy,
    assignedUserId: normalized.assignedUserId,
    assignedRoleId: normalized.assignedRoleId,
  });

  const layoutId = inserted.recordset?.[0]?.LayoutID;
  await writeVersionSnapshot({
    layoutId,
    layoutJson: normalized.layoutJson,
    changedBy: normalized.updatedBy,
    changeNote: 'Layout created',
  });

  return getLayoutById(layoutId);
};

const updateLayout = async (layoutId, payload, auth) => {
  await ensureSchema();
  const existing = await getLayoutById(layoutId);
  const normalized = await normalizeLayoutPayload({
    ...existing,
    ...payload,
    reportCode: payload.reportCode || existing.reportCode,
    menuEntryId: payload.menuEntryId ?? existing.menuEntryId,
    layoutName: payload.layoutName || existing.layoutName,
    layoutJson: payload.layoutJson || existing.layoutJson,
    assignedUserId: payload.assignedUserId ?? existing.assignedUserId,
    assignedRoleId: payload.assignedRoleId ?? existing.assignedRoleId,
    isDefault: payload.isDefault ?? existing.isDefault,
    createdBy: existing.createdBy,
  }, auth);

  const menuEntry =
    normalized.menuEntryId
      ? await getMenuEntryById(normalized.menuEntryId)
      : await getOrCreateDefaultMenuEntry(normalized.reportCode);

  if (normalized.isDefault) {
    await clearDefaultLayouts({
      reportCode: normalized.reportCode,
      menuEntryId: menuEntry.menuEntryId,
      assignedUserId: normalized.assignedUserId,
      assignedRoleId: normalized.assignedRoleId,
    });
  }

  await dbService.query(`
    UPDATE dbo.ReportLayouts
    SET
      MenuEntryID = @menuEntryId,
      LayoutName = @layoutName,
      ReportCode = @reportCode,
      LayoutJSON = @layoutJson,
      IsDefault = @isDefault,
      UpdatedBy = @updatedBy,
      UpdatedDate = SYSUTCDATETIME(),
      AssignedUserId = @assignedUserId,
      AssignedRoleId = @assignedRoleId
    WHERE LayoutID = @layoutId
  `, {
    layoutId,
    menuEntryId: menuEntry.menuEntryId,
    layoutName: normalized.layoutName,
    reportCode: normalized.reportCode,
    layoutJson: JSON.stringify(normalized.layoutJson),
    isDefault: normalized.isDefault ? 1 : 0,
    updatedBy: normalized.updatedBy,
    assignedUserId: normalized.assignedUserId,
    assignedRoleId: normalized.assignedRoleId,
  });

  await writeVersionSnapshot({
    layoutId,
    layoutJson: normalized.layoutJson,
    changedBy: normalized.updatedBy,
    changeNote: String(payload.changeNote || 'Layout updated').trim() || 'Layout updated',
  });

  return getLayoutById(layoutId);
};

const deleteLayout = async (layoutId) => {
  await ensureSchema();
  const layout = await getLayoutById(layoutId);
  await dbService.query(`DELETE FROM dbo.ReportLayoutVersions WHERE LayoutID = @layoutId`, { layoutId });
  await dbService.query(`DELETE FROM dbo.ReportLayouts WHERE LayoutID = @layoutId`, { layoutId });

  return {
    success: true,
    deletedLayoutId: layoutId,
    reportCode: layout.reportCode,
    menuEntryId: layout.menuEntryId,
  };
};

const setDefaultLayout = async ({ layoutId }, auth) => {
  await ensureSchema();
  const layout = await getLayoutById(layoutId);
  await clearDefaultLayouts({
    reportCode: layout.reportCode,
    menuEntryId: layout.menuEntryId,
    assignedUserId: layout.assignedUserId,
    assignedRoleId: layout.assignedRoleId,
  });

  await dbService.query(`
    UPDATE dbo.ReportLayouts
    SET
      IsDefault = 1,
      UpdatedBy = @updatedBy,
      UpdatedDate = SYSUTCDATETIME()
    WHERE LayoutID = @layoutId
  `, {
    layoutId,
    updatedBy: createActorLabel(auth),
  });

  return getLayoutById(layoutId);
};

const copyLayout = async (layoutId, payload, auth) => {
  await ensureSchema();
  const source = await getLayoutById(layoutId);
  return createLayout({
    layoutName: String(payload.layoutName || `${source.layoutName} Copy`).trim(),
    reportCode: source.reportCode,
    menuEntryId: payload.menuEntryId ?? source.menuEntryId,
    layoutJson: clone(source.layoutJson),
    isDefault: false,
    assignedUserId: payload.assignedUserId ?? source.assignedUserId,
    assignedRoleId: payload.assignedRoleId ?? source.assignedRoleId,
  }, auth);
};

const getLayoutVersions = async (layoutId) => {
  await ensureSchema();
  await getLayoutById(layoutId);

  const result = await dbService.query(`
    SELECT TOP 20
      VersionID,
      LayoutID,
      VersionNo,
      ChangeNote,
      ChangedBy,
      ChangedDate
    FROM dbo.ReportLayoutVersions
    WHERE LayoutID = @layoutId
    ORDER BY VersionNo DESC
  `, { layoutId });

  return {
    layoutId,
    versions: (result.recordset || []).map((row) => ({
      versionId: row.VersionID,
      layoutId: row.LayoutID,
      versionNo: row.VersionNo,
      changeNote: row.ChangeNote || '',
      changedBy: row.ChangedBy,
      changedDate: row.ChangedDate,
    })),
  };
};

const resolveCompanyProfile = async () => {
  try {
    const result = await dbService.query(`
      SELECT TOP 1 CompnyName AS CompanyName
      FROM OADM
    `);

    return {
      companyName: result.recordset?.[0]?.CompanyName || env.dbName || 'SAP Business One Company',
      logo: SAMPLE_LOGO,
    };
  } catch (_error) {
    return {
      companyName: env.dbName || 'SAP Business One Company',
      logo: SAMPLE_LOGO,
    };
  }
};

const fetchSalesRegisterRows = async (filters = {}) => {
  const result = await dbService.query(`
    SELECT TOP (@limit)
      inv.DocNum AS docNum,
      CONVERT(VARCHAR(10), inv.DocDate, 23) AS postingDate,
      CONVERT(VARCHAR(10), inv.DocDueDate, 23) AS dueDate,
      inv.CardCode AS customerCode,
      inv.CardName AS customerName,
      line.ItemCode AS itemCode,
      line.Dscription AS itemDescription,
      CAST(line.Quantity AS DECIMAL(18, 2)) AS qty,
      CAST(line.Price AS DECIMAL(18, 2)) AS price,
      CAST(line.LineTotal AS DECIMAL(18, 2)) AS lineTotal,
      CAST(inv.DocTotal AS DECIMAL(18, 2)) AS docTotal,
      slp.SlpName AS salesEmployee
    FROM OINV inv
    INNER JOIN INV1 line
      ON line.DocEntry = inv.DocEntry
    LEFT JOIN OSLP slp
      ON slp.SlpCode = inv.SlpCode
    WHERE (@fromDate IS NULL OR inv.DocDate >= @fromDate)
      AND (@toDate IS NULL OR inv.DocDate <= @toDate)
      AND (@customerCode IS NULL OR inv.CardCode = @customerCode)
    ORDER BY inv.DocDate DESC, inv.DocNum DESC, line.LineNum ASC
  `, {
    limit: 80,
    fromDate: normalizeDateInput(filters.fromDate),
    toDate: normalizeDateInput(filters.toDate),
    customerCode: String(filters.customerCode || '').trim() || null,
  });

  return result.recordset || [];
};

const fetchStockReportRows = async (filters = {}) => {
  const itemCode = String(filters.itemCode || '').trim();
  const warehouseCode = String(filters.warehouseCode || '').trim();

  const result = await dbService.query(`
    SELECT TOP (@limit)
      item.ItemCode AS itemCode,
      item.ItemName AS itemName,
      stock.WhsCode AS warehouseCode,
      whs.WhsName AS warehouseName,
      item.InvntryUom AS uom,
      CAST(stock.OnHand AS DECIMAL(18, 2)) AS onHand,
      CAST(stock.IsCommited AS DECIMAL(18, 2)) AS committed,
      CAST(stock.OnOrder AS DECIMAL(18, 2)) AS onOrder,
      CAST(stock.OnHand - stock.IsCommited + stock.OnOrder AS DECIMAL(18, 2)) AS available
    FROM OITW stock
    INNER JOIN OITM item
      ON item.ItemCode = stock.ItemCode
    INNER JOIN OWHS whs
      ON whs.WhsCode = stock.WhsCode
    WHERE (@warehouseCode IS NULL OR stock.WhsCode = @warehouseCode)
      AND (@itemCodeLike IS NULL OR stock.ItemCode LIKE @itemCodeLike)
    ORDER BY item.ItemCode ASC, stock.WhsCode ASC
  `, {
    limit: 100,
    warehouseCode: warehouseCode || null,
    itemCodeLike: itemCode ? `%${itemCode}%` : null,
  });

  return result.recordset || [];
};

const fetchInvoicePrintRows = async (filters = {}) => {
  const docNum = String(filters.docNum || '').trim();
  const customerCode = String(filters.customerCode || '').trim();

  const result = await dbService.query(`
    SELECT TOP (@limit)
      inv.DocNum AS docNum,
      CONVERT(VARCHAR(10), inv.DocDate, 23) AS postingDate,
      inv.CardCode AS customerCode,
      inv.CardName AS customerName,
      inv.NumAtCard AS customerRef,
      line.LineNum + 1 AS lineNumber,
      line.ItemCode AS itemCode,
      line.Dscription AS itemDescription,
      CAST(line.Quantity AS DECIMAL(18, 2)) AS qty,
      CAST(line.Price AS DECIMAL(18, 2)) AS price,
      CAST(line.LineTotal AS DECIMAL(18, 2)) AS lineTotal,
      CAST(inv.DiscSum AS DECIMAL(18, 2)) AS discountTotal,
      CAST(inv.VatSum AS DECIMAL(18, 2)) AS taxTotal,
      CAST(inv.DocTotal AS DECIMAL(18, 2)) AS docTotal
    FROM OINV inv
    INNER JOIN INV1 line
      ON line.DocEntry = inv.DocEntry
    WHERE (@docNum IS NULL OR CAST(inv.DocNum AS NVARCHAR(50)) = @docNum)
      AND (@customerCode IS NULL OR inv.CardCode = @customerCode)
    ORDER BY inv.DocDate DESC, inv.DocNum DESC, line.LineNum ASC
  `, {
    limit: 60,
    docNum: docNum || null,
    customerCode: customerCode || null,
  });

  return result.recordset || [];
};

const fetchReportRows = async (reportCode, filters = {}) => {
  const definition = getReportDefinition(reportCode);

  try {
    if (definition.code === 'SALES_REGISTER') {
      const rows = await fetchSalesRegisterRows(filters);
      return {
        rows: rows.length ? rows : definition.sampleRows,
        dataMode: rows.length ? 'live' : 'sample',
      };
    }

    if (definition.code === 'STOCK_REPORT') {
      const rows = await fetchStockReportRows(filters);
      return {
        rows: rows.length ? rows : definition.sampleRows,
        dataMode: rows.length ? 'live' : 'sample',
      };
    }

    const rows = await fetchInvoicePrintRows(filters);
    return {
      rows: rows.length ? rows : definition.sampleRows,
      dataMode: rows.length ? 'live' : 'sample',
    };
  } catch (_error) {
    return {
      rows: definition.sampleRows,
      dataMode: 'sample',
    };
  }
};

const evaluateFormula = (formula, row) => {
  const text = String(formula || '').trim();
  if (!text) return 0;

  const substituted = text.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (token) => {
    const value = row[token];
    if (value === undefined || value === null || value === '') {
      return '0';
    }
    return String(toNumber(value));
  });

  if (!/^[0-9+\-*/().\s]+$/.test(substituted)) {
    return 0;
  }

  try {
    return Number(Function(`"use strict"; return (${substituted});`)()) || 0;
  } catch (_error) {
    return 0;
  }
};

const enrichRowsWithLayoutColumns = (rows, layoutJson) => {
  const columns = layoutJson?.table?.columns || [];
  return rows.map((row) => {
    const next = { ...row };

    for (const column of columns) {
      if (!column?.id) continue;

      if (column.kind === 'formula') {
        next[column.id] = evaluateFormula(column.formula, next);
      } else if (column.field && next[column.id] === undefined) {
        next[column.id] = next[column.field];
      }
    }

    return next;
  });
};

const buildSummary = (rows, layoutJson) => {
  const columns = layoutJson?.table?.columns || [];
  const summary = {
    rowCount: rows.length,
  };

  for (const column of columns) {
    if (!column?.id) continue;
    if (!column.showTotal && !['number', 'currency'].includes(column.dataType)) continue;
    summary[column.id] = rows.reduce((total, row) => total + toNumber(row[column.id]), 0);
  }

  if (summary.docTotal === undefined) {
    summary.docTotal = rows.reduce((total, row) => total + toNumber(row.docTotal), 0);
  }

  return summary;
};

const buildFiltersSummary = (definition, filters = {}) => {
  const entries = definition.filters
    .map((filter) => ({
      label: filter.label,
      value: String(filters[filter.key] || '').trim(),
    }))
    .filter((entry) => entry.value);

  if (!entries.length) {
    return 'No filters applied';
  }

  return entries.map((entry) => `${entry.label}: ${entry.value}`).join(' | ');
};

const previewLayout = async ({ reportCode, layoutId, layoutJson, filters = {} }) => {
  await ensureSchema();
  let resolvedReportCode = reportCode;
  let resolvedLayout = layoutJson;

  if (!resolvedLayout && layoutId) {
    const stored = await getLayoutById(layoutId);
    resolvedLayout = stored.layoutJson;
    resolvedReportCode = stored.reportCode;
  }

  const definition = getReportDefinition(resolvedReportCode);
  resolvedLayout = normalizeLayoutJson(resolvedLayout, definition.code);

  const company = await resolveCompanyProfile();
  const reportData = await fetchReportRows(definition.code, filters);
  const rows = enrichRowsWithLayoutColumns(reportData.rows, resolvedLayout);
  const summary = buildSummary(rows, resolvedLayout);
  const pageSize = Number(resolvedLayout?.page?.pageSize || 12);

  return {
    report: {
      code: definition.code,
      name: definition.name,
      title: definition.previewTitle,
      description: definition.description,
    },
    company,
    layout: resolvedLayout,
    filters,
    filtersSummary: buildFiltersSummary(definition, filters),
    dataMode: reportData.dataMode,
    rows,
    summary,
    generatedAt: new Date().toISOString(),
    pagination: {
      pageSize,
      totalRows: rows.length,
      totalPages: Math.max(Math.ceil(rows.length / pageSize), 1),
    },
    firstRow: rows[0] || {},
  };
};

const appendVirtualLayoutManagerMenu = (menuPayload = {}) => {
  const menus = Array.isArray(menuPayload.menus) ? [...menuPayload.menus] : [];
  const menuPaths = Array.isArray(menuPayload.menuPaths) ? [...menuPayload.menuPaths] : [];
  const hasMenu = menus.some((menu) => menu.menuPath === REPORT_LAYOUT_MENU.menuPath);

  if (!hasMenu) {
    menus.push(clone(REPORT_LAYOUT_MENU));
  }

  if (!menuPaths.includes(REPORT_LAYOUT_MENU.menuPath)) {
    menuPaths.push(REPORT_LAYOUT_MENU.menuPath);
  }

  return {
    menus,
    menuPaths,
  };
};

module.exports = {
  REPORT_DEFINITIONS,
  REPORT_LAYOUT_MENU,
  SAP_B1_MENU_CATEGORIES,
  appendVirtualLayoutManagerMenu,
  listReports,
  getReportFields,
  listManagerCatalog,
  searchManagerCatalog,
  listLayouts,
  createMenuEntry,
  updateMenuEntry,
  deleteMenuEntry,
  createLayout,
  updateLayout,
  deleteLayout,
  setDefaultLayout,
  copyLayout,
  getLayoutVersions,
  previewLayout,
};
