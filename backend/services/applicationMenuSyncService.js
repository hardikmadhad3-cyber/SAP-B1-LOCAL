const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const authDbService = require('./authDbService');
const { syncStandardSalesRoleRights, removeRetiredSalesMenus } = require('./standardSalesRoleRightsService');

const APP_MENU_DEFINITIONS = [
  { key: 'dashboard', menuName: 'Dashboard', menuPath: '/dashboard', icon: 'dashboard', sortOrder: -1 },
  { key: 'sales', menuName: 'Sales', aliases: ['Sales - A/R', 'Sales A/R'], icon: 'sales', sortOrder: 1 },
  { key: 'sales-quotation', parentKey: 'sales', menuName: 'Sales Quotation', menuPath: '/sales-quotation', icon: 'document', sortOrder: 1, enforceSortOrder: true },
  { key: 'sales-order', parentKey: 'sales', menuName: 'Sales Order', menuPath: '/sales-order', icon: 'document', sortOrder: 2, enforceSortOrder: true },
  { key: 'delivery', parentKey: 'sales', menuName: 'Delivery', menuPath: '/delivery', icon: 'delivery', sortOrder: 6, enforceSortOrder: true },
  { key: 'ar-invoice', parentKey: 'sales', menuName: 'A/R Invoice', menuPath: '/ar-invoice', icon: 'invoice', sortOrder: 10, enforceSortOrder: true },
  { key: 'ar-credit-memo', parentKey: 'sales', menuName: 'A/R Credit Memo', menuPath: '/ar-credit-memo', icon: 'invoice', sortOrder: 11, enforceSortOrder: true },

  { key: 'services', menuName: 'Services', icon: 'invoice', sortOrder: 2 },
  { key: 'service-ar-invoice', parentKey: 'services', menuName: 'A/R Invoice', menuPath: '/services/ar-invoice', icon: 'invoice', sortOrder: 1, enforceSortOrder: true },
  { key: 'service-ap-invoice', parentKey: 'services', menuName: 'A/P Invoice', menuPath: '/services/ap-invoice', icon: 'invoice', sortOrder: 2, enforceSortOrder: true },
  { key: 'service-ap-credit-memo', parentKey: 'services', menuName: 'A/P Credit Memo', menuPath: '/services/ap-credit-memo', icon: 'invoice', sortOrder: 3, enforceSortOrder: true },
  { key: 'service-ar-credit-memo', parentKey: 'services', menuName: 'A/R Credit Memo', menuPath: '/services/ar-credit-memo', icon: 'invoice', sortOrder: 4, enforceSortOrder: true },

  { key: 'purchase', menuName: 'Purchase', aliases: ['Purchase - A/P', 'Purchase A/P', 'Purchasing', 'Purchasing - A/P', 'Purchasing A/P'], icon: 'purchase', sortOrder: 3 },
  { key: 'purchase-request', parentKey: 'purchase', menuName: 'Purchase Request', menuPath: '/purchase-request', icon: 'document', sortOrder: 1 },
  { key: 'purchase-quotation', parentKey: 'purchase', menuName: 'Purchase Quotation', menuPath: '/purchase-quotation', icon: 'document', sortOrder: 2 },
  { key: 'purchase-order', parentKey: 'purchase', menuName: 'Purchase Order', menuPath: '/purchase-order', icon: 'document', sortOrder: 3 },
  { key: 'grpo', parentKey: 'purchase', menuName: 'Goods Receipt PO', menuPath: '/grpo', icon: 'receipt', sortOrder: 4 },
  { key: 'ap-invoice', parentKey: 'purchase', menuName: 'A/P Invoice', menuPath: '/ap-invoice', icon: 'invoice', sortOrder: 5 },
  { key: 'ap-credit-memo', parentKey: 'purchase', menuName: 'A/P Credit Memo', menuPath: '/ap-credit-memo', icon: 'invoice', sortOrder: 6 },

  { key: 'master', menuName: 'Master', icon: 'master', sortOrder: 4 },
  { key: 'item-master', parentKey: 'master', menuName: 'Item Master', menuPath: '/item-master', icon: 'item', sortOrder: 1 },
  { key: 'business-partner', parentKey: 'master', menuName: 'Business Partner', menuPath: '/business-partner', icon: 'partner', sortOrder: 2 },
  { key: 'warehouse', parentKey: 'master', menuName: 'Warehouse', menuPath: '/warehouse', icon: 'warehouse', sortOrder: 3 },
  { key: 'price-list', parentKey: 'master', menuName: 'Price List', menuPath: '/price-list', icon: 'price', sortOrder: 4 },
  { key: 'tax-code', parentKey: 'master', menuName: 'Tax Code', menuPath: '/tax-code', icon: 'tax', sortOrder: 5 },
  { key: 'hsn-sac-codes', parentKey: 'master', menuName: 'HSN / SAC Codes', menuPath: '/hsn-sac-codes', icon: 'tax', sortOrder: 5.5 },
  { key: 'uom-group', parentKey: 'master', menuName: 'UoM Group', menuPath: '/uom-group', icon: 'uom', sortOrder: 6 },
  { key: 'payment-terms', parentKey: 'master', menuName: 'Payment Terms', menuPath: '/payment-terms', icon: 'terms', sortOrder: 7 },
  { key: 'shipping-type', parentKey: 'master', menuName: 'Shipping Type', menuPath: '/shipping-type', icon: 'shipping', sortOrder: 8 },
  { key: 'branch', parentKey: 'master', menuName: 'Branch', menuPath: '/branch', icon: 'branch', sortOrder: 9 },
  { key: 'chart-of-accounts', parentKey: 'master', menuName: 'Chart Of Accounts', menuPath: '/chart-of-accounts', icon: 'accounts', sortOrder: 10 },
  ...[
    ['item-groups', 'Item Groups'], ['bp-groups', 'BP Groups'], ['sales-employees', 'Sales Employees'],
    ['numbering-series', 'Numbering Series'], ['posting-periods', 'Posting Periods'], ['currencies', 'Currencies'],
    ['exchange-rates', 'Exchange Rates'], ['states', 'States'], ['locations', 'Locations'],
    ['gl-determination', 'G/L Account Determination'], ['account-template', 'Chart of Accounts Template'],
    ['cash-discounts', 'Cash Discounts'], ['payment-methods', 'Payment Methods'],
  ].map(([key, menuName], index) => ({ key: `setup-${key}`, parentKey: 'master', menuName, menuPath: `/setup/${key}`, icon: 'settings', sortOrder: 11 + index })),
  { key: 'opening-balances', parentKey: 'master', menuName: 'Opening Balances', menuPath: '/opening-balances', icon: 'accounts', sortOrder: 25 },

  { key: 'job-work', menuName: 'Job Work', icon: 'production', sortOrder: 4.5 },
  { key: 'job-work-sales', parentKey: 'job-work', menuName: 'Sales J/W', icon: 'sales', sortOrder: 1 },
  { key: 'customer-receipt-note', parentKey: 'job-work-sales', menuName: 'Customer Receipt Note', menuPath: '/customer-receipt-note', icon: 'receipt', sortOrder: 1 },
  { key: 'customer-issue-note', parentKey: 'job-work-sales', menuName: 'Customer Issue / Return Note', menuPath: '/customer-issue-note', icon: 'issue', sortOrder: 2 },
  { key: 'job-work-purchase', parentKey: 'job-work', menuName: 'Purchase J/W', icon: 'purchase', sortOrder: 2 },
  { key: 'jobwork-issue-note', parentKey: 'job-work-purchase', menuName: 'Jobwork Issue Note', menuPath: '/jobwork-issue-note', icon: 'issue', sortOrder: 1 },
  { key: 'jobwork-receipt-note', parentKey: 'job-work-purchase', menuName: 'Jobwork Receipt / Return Note', menuPath: '/jobwork-receipt-note', icon: 'receipt', sortOrder: 2 },

  { key: 'gate-pass', menuName: 'Gate Pass', icon: 'branch', sortOrder: 4.7 },
  { key: 'gate-pass-master', parentKey: 'gate-pass', menuName: 'Master', icon: 'master', sortOrder: 1 },
  { key: 'gate-pass-visitor-type', parentKey: 'gate-pass-master', menuName: 'Visitor Type', menuPath: '/gate-pass/visitor-type', icon: 'partner', sortOrder: 1 },
  { key: 'gate-pass-visit-type', parentKey: 'gate-pass-master', menuName: 'Visit Type', menuPath: '/gate-pass/visit-type', icon: 'document', sortOrder: 2 },
  { key: 'gate-pass-transactions', parentKey: 'gate-pass', menuName: 'Transactions', icon: 'document', sortOrder: 2 },
  { key: 'gate-pass-visitor-log', parentKey: 'gate-pass-transactions', menuName: 'Visitor Log', menuPath: '/gate-pass/visitor-log', icon: 'partner', sortOrder: 1 },
  { key: 'gate-pass-gate-in', parentKey: 'gate-pass-transactions', menuName: 'Gate In', menuPath: '/gate-pass/gate-in', icon: 'receipt', sortOrder: 2 },
  { key: 'gate-pass-gate-out', parentKey: 'gate-pass-transactions', menuName: 'Gate Out', menuPath: '/gate-pass/gate-out', icon: 'issue', sortOrder: 3 },

  { key: 'production', menuName: 'Production', icon: 'production', sortOrder: 5 },
  { key: 'bom', parentKey: 'production', menuName: 'Bill of Materials', menuPath: '/bom', icon: 'bom', sortOrder: 1 },
  { key: 'production-order', parentKey: 'production', menuName: 'Production Order', menuPath: '/production-order', icon: 'production', sortOrder: 2 },
  { key: 'issue-for-production', parentKey: 'production', menuName: 'Issue For Production', menuPath: '/issue-for-production', icon: 'issue', sortOrder: 3 },
  { key: 'receipt-from-production', parentKey: 'production', menuName: 'Receipt From Production', menuPath: '/receipt-from-production', icon: 'receipt', sortOrder: 4 },
  { key: 'setup-resources', parentKey: 'production', menuName: 'Resources', menuPath: '/setup/resources', icon: 'production', sortOrder: 5 },
  { key: 'setup-resource-groups', parentKey: 'production', menuName: 'Resource Groups', menuPath: '/setup/resource-groups', icon: 'settings', sortOrder: 6 },
  { key: 'setup-route-stages', parentKey: 'production', menuName: 'Route Stages', menuPath: '/setup/route-stages', icon: 'settings', sortOrder: 7 },

  { key: 'inventory', menuName: 'Inventory', icon: 'inventory', sortOrder: 6 },
  { key: 'goods-receipt', parentKey: 'inventory', menuName: 'Goods Receipt', menuPath: '/goods-receipt', icon: 'receipt', sortOrder: 1 },
  { key: 'goods-issue', parentKey: 'inventory', menuName: 'Goods Issue', menuPath: '/goods-issue', icon: 'issue', sortOrder: 2 },
  { key: 'inventory-transfer-request', parentKey: 'inventory', menuName: 'Inventory Transfer Request', menuPath: '/inventory-transfer-request', icon: 'transfer', sortOrder: 3 },
  { key: 'inventory-transfer', parentKey: 'inventory', menuName: 'Inventory Transfer', menuPath: '/inventory-transfer', icon: 'transfer', sortOrder: 4 },

  { key: 'quality-control', menuName: 'Quality Control', icon: 'report', sortOrder: 6.5 },
  { key: 'qc-addons', parentKey: 'quality-control', menuName: 'Add-on Management', menuPath: '/qc/addons', icon: 'settings', sortOrder: 1 },
  { key: 'qc-mappings', parentKey: 'quality-control', menuName: 'Document Mapping', menuPath: '/qc/document-mappings', icon: 'document', sortOrder: 2 },
  { key: 'qc-parameters', parentKey: 'quality-control', menuName: 'Parameters', menuPath: '/qc/parameters', icon: 'uom', sortOrder: 3 },
  { key: 'qc-item-parameter-mappings', parentKey: 'quality-control', menuName: 'Item-wise Parameter Mapping', menuPath: '/qc/item-parameter-mappings', icon: 'item', sortOrder: 4 },
  { key: 'qc-instruments', parentKey: 'quality-control', menuName: 'Instrument Master', menuPath: '/qc/instruments', icon: 'settings', sortOrder: 5 },
  { key: 'qc-workflows', parentKey: 'quality-control', menuName: 'Workflows', menuPath: '/qc/workflows', icon: 'production', sortOrder: 6 },
  { key: 'qc-inward', parentKey: 'quality-control', menuName: 'Inward QC', menuPath: '/qc/inward', icon: 'receipt', sortOrder: 7 },
  { key: 'qc-outward', parentKey: 'quality-control', menuName: 'Outward QC', menuPath: '/qc/outward', icon: 'issue', sortOrder: 8 },
  { key: 'qc-transactions', parentKey: 'quality-control', menuName: 'Transactions', menuPath: '/qc/transactions', icon: 'document', sortOrder: 9 },

  { key: 'whatsapp', menuName: 'WhatsApp', icon: 'chat', sortOrder: 6.7 },
  { key: 'whatsapp-inbox', parentKey: 'whatsapp', menuName: 'Inbox', menuPath: '/whatsapp', icon: 'chat', sortOrder: 1 },
  { key: 'whatsapp-configuration', parentKey: 'whatsapp', menuName: 'Configuration', menuPath: '/whatsapp/configuration', icon: 'settings', sortOrder: 2 },

  { key: 'banking', menuName: 'Banking', icon: 'banking', sortOrder: 7 },
  {
    key: 'incoming-payments',
    parentKey: 'banking',
    menuName: 'Incoming Payments',
    aliases: ['Incoming Payment'],
    menuPath: '/incoming-payments',
    legacyPaths: ['/incoming-payment', '/banking/incoming-payment', '/banking/incoming-payments'],
    icon: 'payments',
    sortOrder: 1,
    enforceSortOrder: true,
    enforceMenuName: true,
  },
  {
    key: 'outgoing-payments',
    parentKey: 'banking',
    menuName: 'Outgoing Payments',
    aliases: ['Outgoing Payment'],
    menuPath: '/outgoing-payments',
    legacyPaths: ['/outgoing-payment', '/banking/outgoing-payment', '/banking/outgoing-payments'],
    icon: 'payments',
    sortOrder: 2,
  },
  {
    key: 'journal-entry',
    parentKey: 'banking',
    menuName: 'Journal Entry',
    menuPath: '/journal-entry',
    icon: 'document',
    sortOrder: 3,
  },
  { key: 'internal-reconciliation', parentKey: 'banking', menuName: 'Internal Reconciliation', menuPath: '/internal-reconciliation', icon: 'document', sortOrder: 4 },

  { key: 'reports', menuName: 'Reports', icon: 'reports', sortOrder: 8 },
  { key: 'report-layout-manager', parentKey: 'reports', menuName: 'Report Layout Manager', menuPath: '/reportlayoutmanager', icon: 'report', sortOrder: 0, enforceSortOrder: true, enforceMenuName: true },
  { key: 'company-reports', parentKey: 'reports', menuName: 'Company Reports', menuPath: '/reports/company', icon: 'report', sortOrder: 1 },
  { key: 'sales-analysis', parentKey: 'reports', menuName: 'Sales Analysis', menuPath: '/reports/sales/analysis', icon: 'report', sortOrder: 1 },
  { key: 'item-list-report', parentKey: 'reports', menuName: 'Item List', menuPath: '/reports/item-list', icon: 'report', sortOrder: 2 },
  { key: 'inventory-in-warehouse-report', parentKey: 'reports', menuName: 'Inventory in Warehouse Report', menuPath: '/reports/inventory/in-warehouse', icon: 'report', sortOrder: 3 },

  { key: 'inventory-audit-report', parentKey: 'reports', menuName: 'Inventory Audit Report', menuPath: '/reports/inventory/audit', icon: 'report', sortOrder: 4 },
  { key: 'inventory-aging-report', parentKey: 'reports', menuName: 'Inventory Aging Report', menuPath: '/reports/inventory/aging', icon: 'report', sortOrder: 5 },
  { key: 'inventory-posting-list-report', parentKey: 'reports', menuName: 'Inventory Posting List', menuPath: '/reports/inventory/posting-list', icon: 'report', sortOrder: 6 },
  { key: 'purchase-analysis', parentKey: 'reports', menuName: 'Purchase Analysis', menuPath: '/reports/purchasing/analysis', icon: 'report', sortOrder: 7 },
  { key: 'purchase-request-report', parentKey: 'reports', menuName: 'Purchase Request Report', menuPath: '/reports/purchasing/purchase-request-report', icon: 'report', sortOrder: 8 },
  { key: 'reports-production', parentKey: 'reports', menuName: 'Production', icon: 'production', sortOrder: 9 },
  { key: 'bill-of-materials-report', parentKey: 'reports-production', menuName: 'Bill of Materials Report', menuPath: '/reports/production/bill-of-materials', icon: 'bom', sortOrder: 1 },
  { key: 'open-items-list-report', parentKey: 'reports-production', menuName: 'Open Items List', menuPath: '/reports/production/open-items-list', icon: 'report', sortOrder: 2 },
  { key: 'reports-crm', parentKey: 'reports', menuName: 'CRM', icon: 'partner', sortOrder: 10 },
  { key: 'reports-crm-my-activities', parentKey: 'reports-crm', menuName: 'My Activities', menuPath: '/reports/crm/my-activities', icon: 'report', sortOrder: 1 },
  { key: 'reports-crm-activities-overview', parentKey: 'reports-crm', menuName: 'Activities Overview', menuPath: '/reports/crm/activities-overview', icon: 'report', sortOrder: 2 },
  { key: 'reports-crm-inactive-customers', parentKey: 'reports-crm', menuName: 'Inactive Customers', menuPath: '/reports/crm/inactive-customers', icon: 'report', sortOrder: 3 },
  { key: 'reports-crm-campaigns-list', parentKey: 'reports-crm', menuName: 'Campaigns List', menuPath: '/reports/crm/campaigns-list', icon: 'report', sortOrder: 4 },
  { key: 'reports-crm-opportunities', parentKey: 'reports-crm', menuName: 'Opportunities', icon: 'report', sortOrder: 5 },
  { key: 'reports-crm-opportunities-electronic-reports', parentKey: 'reports-crm-opportunities', menuName: 'Electronic Reports', menuPath: '/reports/crm/opportunities/electronic-reports', icon: 'report', sortOrder: 1 },
  { key: 'reports-crm-opportunities-forecast', parentKey: 'reports-crm-opportunities', menuName: 'Opportunities Forecast Report', menuPath: '/reports/crm/opportunities/forecast', icon: 'report', sortOrder: 2 },
  { key: 'reports-crm-opportunities-forecast-over-time', parentKey: 'reports-crm-opportunities', menuName: 'Opportunities Forecast Over Time Report', menuPath: '/reports/crm/opportunities/forecast-over-time', icon: 'report', sortOrder: 3 },
  { key: 'reports-crm-opportunities-statistics', parentKey: 'reports-crm-opportunities', menuName: 'Opportunities Statistics Report', menuPath: '/reports/crm/opportunities/statistics', icon: 'report', sortOrder: 4 },
  { key: 'reports-crm-opportunities-report', parentKey: 'reports-crm-opportunities', menuName: 'Opportunities Report', menuPath: '/reports/crm/opportunities/report', icon: 'report', sortOrder: 5 },
  { key: 'reports-crm-opportunities-stage-analysis', parentKey: 'reports-crm-opportunities', menuName: 'Stage Analysis', menuPath: '/reports/crm/opportunities/stage-analysis', icon: 'report', sortOrder: 6 },
  { key: 'reports-crm-opportunities-info-source-distribution-over-time', parentKey: 'reports-crm-opportunities', menuName: 'Information Source Distribution Over Time Report', menuPath: '/reports/crm/opportunities/information-source-distribution-over-time', icon: 'report', sortOrder: 7 },
  { key: 'reports-crm-opportunities-won', parentKey: 'reports-crm-opportunities', menuName: 'Won Opportunities Report', menuPath: '/reports/crm/opportunities/won', icon: 'report', sortOrder: 8 },
  { key: 'reports-crm-opportunities-lost', parentKey: 'reports-crm-opportunities', menuName: 'Lost Opportunities Report', menuPath: '/reports/crm/opportunities/lost', icon: 'report', sortOrder: 9 },
  { key: 'reports-crm-opportunities-my-open', parentKey: 'reports-crm-opportunities', menuName: 'My Open Opportunities Report', menuPath: '/reports/crm/opportunities/my-open', icon: 'report', sortOrder: 10 },
  { key: 'reports-crm-opportunities-my-closed', parentKey: 'reports-crm-opportunities', menuName: 'My Closed Opportunities Report', menuPath: '/reports/crm/opportunities/my-closed', icon: 'report', sortOrder: 11 },
  { key: 'reports-crm-opportunities-pipeline', parentKey: 'reports-crm-opportunities', menuName: 'Opportunities Pipeline', menuPath: '/reports/crm/opportunities/pipeline', icon: 'report', sortOrder: 12 },
  { key: 'reports-crm-opportunities-test', parentKey: 'reports-crm-opportunities', menuName: 'test', menuPath: '/reports/crm/opportunities/test', icon: 'report', sortOrder: 13 },
  { key: 'reports-financial', parentKey: 'reports', menuName: 'Financial', icon: 'report', sortOrder: 11 },
  { key: 'reports-financial-accounting', parentKey: 'reports-financial', menuName: 'Accounting', icon: 'accounts', sortOrder: 1 },
  { key: 'gl-accounts-business-partners-report', parentKey: 'reports-financial-accounting', menuName: 'G/L Accounts and Business Partners', menuPath: '/reports/financial/accounting/gl-accounts-business-partners', icon: 'report', sortOrder: 1 },
  { key: 'general-ledger-report', parentKey: 'reports-financial-accounting', menuName: 'General Ledger', menuPath: '/reports/financial/accounting/general-ledger', icon: 'report', sortOrder: 2 },
  { key: 'accounting-aging-reports', parentKey: 'reports-financial-accounting', menuName: 'Aging', icon: 'report', sortOrder: 3 },
  { key: 'customer-receivables-aging-report', parentKey: 'accounting-aging-reports', menuName: 'Customer Receivables Aging', menuPath: '/reports/financial/accounting/aging/customer-receivables', icon: 'report', sortOrder: 1 },
  { key: 'vendor-liabilities-aging-report', parentKey: 'accounting-aging-reports', menuName: 'Vendor Liabilities Aging', menuPath: '/reports/financial/accounting/aging/vendor-liabilities', icon: 'report', sortOrder: 2 },
  { key: 'transaction-journal-report', parentKey: 'reports-financial-accounting', menuName: 'Transaction Journal Report', menuPath: '/reports/financial/accounting/transaction-journal', icon: 'report', sortOrder: 4 },
  { key: 'transaction-by-projects-report', parentKey: 'reports-financial-accounting', menuName: 'Transaction Report by Projects', menuPath: '/reports/financial/accounting/transaction-by-projects', icon: 'report', sortOrder: 5 },
  { key: 'journal-transaction-amount-range-report', parentKey: 'reports-financial-accounting', menuName: 'Locate Journal Transaction by Amount Range', menuPath: '/reports/financial/accounting/journal-transaction-amount-range', icon: 'report', sortOrder: 6 },
  { key: 'journal-transaction-fc-amount-range-report', parentKey: 'reports-financial-accounting', menuName: 'Locate Journal Transaction by FC Amount Range', menuPath: '/reports/financial/accounting/journal-transaction-fc-amount-range', icon: 'report', sortOrder: 7 },
  { key: 'transactions-received-from-voucher-report', parentKey: 'reports-financial-accounting', menuName: 'Transactions Received from Voucher Report', menuPath: '/reports/financial/accounting/transactions-received-from-voucher', icon: 'report', sortOrder: 8 },
  { key: 'document-journal-report', parentKey: 'reports-financial-accounting', menuName: 'Document Journal', menuPath: '/reports/financial/accounting/document-journal', icon: 'report', sortOrder: 9 },
  { key: 'reports-financial-statements', parentKey: 'reports-financial', menuName: 'Financial', icon: 'report', sortOrder: 2 },
  { key: 'balance-sheet-report', parentKey: 'reports-financial-statements', menuName: 'Balance Sheet', menuPath: '/reports/financial/financial/balance-sheet', icon: 'report', sortOrder: 1 },
  { key: 'trial-balance-report', parentKey: 'reports-financial-statements', menuName: 'Trial Balance', menuPath: '/reports/financial/financial/trial-balance', icon: 'report', sortOrder: 2 },
  { key: 'profit-loss-statement-report', parentKey: 'reports-financial-statements', menuName: 'Profit and Loss Statement', menuPath: '/reports/financial/financial/profit-and-loss-statement', icon: 'report', sortOrder: 3 },
  { key: 'cash-flow-report', parentKey: 'reports-financial-statements', menuName: 'Cash Flow', menuPath: '/reports/financial/financial/cash-flow', icon: 'report', sortOrder: 4 },
  { key: 'statement-cash-flows-report', parentKey: 'reports-financial-statements', menuName: 'Statement of Cash Flows', menuPath: '/reports/financial/financial/statement-of-cash-flows', icon: 'report', sortOrder: 5 },
  { key: 'cash-flow-reference-report', parentKey: 'reports-financial-statements', menuName: 'Cash Flow Reference Report', menuPath: '/reports/financial/financial/cash-flow-reference-report', icon: 'report', sortOrder: 6 },
  { key: 'business-assessment-report', parentKey: 'reports-financial-statements', menuName: 'Business Assessment Report', menuPath: '/reports/financial/financial/business-assessment-report', icon: 'report', sortOrder: 7 },

  { key: 'tools', menuName: 'Tools', icon: 'settings', sortOrder: 11 },
  { key: 'udf-management', parentKey: 'tools', menuName: 'User-Defined Fields - Management', menuPath: '/udf-management', icon: 'settings', sortOrder: 1 },
  { key: 'query-manager', menuName: 'Query Manager', menuPath: '/query-manager', icon: 'reports', sortOrder: 12 },
];

const normalizeText = (value) => String(value || '').trim();
const normalizePath = (value) => normalizeText(value).toLowerCase().replace(/\/+$/g, '');
const normalizeName = (value) => normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Add new code-owned sidebar pages here. They will appear in Admin > Menus automatically,
// but they will not show in the app sidebar until Role Rights grants CanView.
const hasMenusTable = async (db) => {
  void db;
  return authDbService.tableExists('Menus');
};

const hasRoleRightsTable = async (db) => {
  void db;
  return authDbService.tableExists('RoleRights');
};

const getExistingMenus = async (db) => db.queryRows(`
  SELECT MenuId, MenuName, MenuPath, ParentId, Icon, SortOrder
  FROM dbo.Menus
  ORDER BY MenuId ASC
`);

const findExistingMenu = (menus, definition, parentId) => {
  const menuPaths = new Set([definition.menuPath, ...(definition.legacyPaths || [])].map(normalizePath).filter(Boolean));
  if (menuPaths.size) {
    return menus.find((menu) => menuPaths.has(normalizePath(menu.MenuPath))) || null;
  }

  const menuNames = new Set([definition.menuName, ...(definition.aliases || [])].map(normalizeName));
  const matchingMenus = menus.filter((menu) => menuNames.has(normalizeName(menu.MenuName)));
  return matchingMenus.find((menu) => (menu.ParentId ?? null) === (parentId ?? null))
    || matchingMenus.find((menu) => Number(menu.ParentId) === Number(menu.MenuId))
    || (matchingMenus.length === 1 ? matchingMenus[0] : null);
};

const insertMenu = async (db, definition, parentId) => {
  const inserted = await db.query(`
    INSERT INTO dbo.Menus (
      MenuName,
      MenuPath,
      ParentId,
      Icon,
      SortOrder
    )
    OUTPUT INSERTED.MenuId, INSERTED.MenuName, INSERTED.MenuPath, INSERTED.ParentId, INSERTED.Icon, INSERTED.SortOrder
    VALUES (
      @menuName,
      @menuPath,
      @parentId,
      @icon,
      @sortOrder
    )
  `, {
    menuName: normalizeText(definition.menuName),
    menuPath: normalizeText(definition.menuPath) || null,
    parentId,
    icon: normalizeText(definition.icon) || null,
    sortOrder: Number.isFinite(Number(definition.sortOrder)) ? Number(definition.sortOrder) : 0,
  });

  return inserted.recordset?.[0] || null;
};

const updateMenuMetadata = async (db, menu, definition, shouldUseCanonicalPath) => {
  const nextMenuName = definition.enforceMenuName
    ? normalizeText(definition.menuName)
    : (normalizeText(menu.MenuName) || normalizeText(definition.menuName));
  const nextMenuPath = shouldUseCanonicalPath
    ? (normalizeText(definition.menuPath) || null)
    : (normalizeText(menu.MenuPath) || normalizeText(definition.menuPath) || null);
  const nextIcon = normalizeText(menu.Icon) || normalizeText(definition.icon) || null;
  const definitionSortOrder = Number.isFinite(Number(definition.sortOrder)) ? Number(definition.sortOrder) : 0;
  const nextSortOrder = definition.enforceSortOrder
    ? definitionSortOrder
    : (Number.isFinite(Number(menu.SortOrder)) ? Number(menu.SortOrder) : definitionSortOrder);
  // Admin > Menus owns the placement of existing entries. The definition only
  // supplies a parent when a menu is first inserted.
  const nextParentId = menu.ParentId ?? null;

  if (
    normalizeText(menu.MenuName) === nextMenuName
    && normalizeText(menu.MenuPath || '') === normalizeText(nextMenuPath || '')
    && normalizeText(menu.Icon || '') === normalizeText(nextIcon || '')
    && Number(menu.SortOrder ?? 0) === nextSortOrder
    && (menu.ParentId ?? null) === nextParentId
  ) {
    return menu;
  }

  await db.query(`
    UPDATE dbo.Menus
    SET
      MenuName = @menuName,
      MenuPath = @menuPath,
      ParentId = @parentId,
      Icon = @icon,
      SortOrder = @sortOrder
    WHERE MenuId = @menuId
  `, {
    menuId: menu.MenuId,
    menuName: nextMenuName,
    menuPath: nextMenuPath,
    parentId: nextParentId,
    icon: nextIcon,
    sortOrder: nextSortOrder,
  });

  return {
    ...menu,
    MenuName: nextMenuName,
    MenuPath: nextMenuPath,
    ParentId: nextParentId,
    Icon: nextIcon,
    SortOrder: nextSortOrder,
  };
};

const cloneRoleRightsForDuplicateMenu = async (db, sourceMenuId, targetMenuId) => {
  const normalizedSourceMenuId = Number(sourceMenuId);
  const normalizedTargetMenuId = Number(targetMenuId);

  if (
    !Number.isInteger(normalizedSourceMenuId) ||
    !Number.isInteger(normalizedTargetMenuId) ||
    normalizedSourceMenuId === normalizedTargetMenuId ||
    !(await hasRoleRightsTable(db))
  ) {
    return 0;
  }

  const result = await db.query(`
    INSERT INTO dbo.RoleRights (RoleId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
    SELECT
      RR.RoleId,
      @targetMenuId,
      RR.CanView,
      RR.CanAdd,
      RR.CanEdit,
      RR.CanDelete
    FROM dbo.RoleRights RR
    WHERE RR.MenuId = @sourceMenuId
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.RoleRights ExistingRight
        WHERE ExistingRight.RoleId = RR.RoleId
          AND ExistingRight.MenuId = @targetMenuId
      )
  `, {
    sourceMenuId: normalizedSourceMenuId,
    targetMenuId: normalizedTargetMenuId,
  });

  return result.rowsAffected?.[0] || 0;
};

const restrictMenuToAdminRoles = async (db, menuId) => {
  const normalizedMenuId = Number(menuId);
  if (!Number.isInteger(normalizedMenuId) || !(await hasRoleRightsTable(db))) return 0;

  const removed = await db.query(`
    DELETE FROM dbo.RoleRights
    WHERE MenuId = @menuId
      AND RoleId IN (
        SELECT RoleId
        FROM dbo.Roles
        WHERE LOWER(LTRIM(RTRIM(RoleName))) NOT IN ('admin', 'superadmin')
      )
  `, { menuId: normalizedMenuId });

  const added = await db.query(`
    INSERT INTO dbo.RoleRights (RoleId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
    SELECT R.RoleId, @menuId, 1, 1, 1, 0
    FROM dbo.Roles R
    WHERE LOWER(LTRIM(RTRIM(R.RoleName))) IN ('admin', 'superadmin')
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.RoleRights RR
        WHERE RR.RoleId = R.RoleId
          AND RR.MenuId = @menuId
      )
  `, { menuId: normalizedMenuId });

  return (removed.rowsAffected?.[0] || 0) + (added.rowsAffected?.[0] || 0);
};

const deleteDeprecatedReportLayoutManagerMenu = async (db, canonicalMenuId = null) => {
  const reportsRoot = await db.queryOne(`
    SELECT TOP (1) MenuId
    FROM dbo.Menus
    WHERE LOWER(LTRIM(RTRIM(COALESCE(MenuPath, '')))) = '/reports'
       OR LOWER(LTRIM(RTRIM(COALESCE(MenuName, '')))) = 'reports'
    ORDER BY
      CASE WHEN LOWER(LTRIM(RTRIM(COALESCE(MenuPath, '')))) = '/reports' THEN 0 ELSE 1 END,
      SortOrder ASC,
      MenuId ASC
  `);

  const rows = await db.queryRows(`
    SELECT MenuId, ParentId
    FROM dbo.Menus
    WHERE (
      LOWER(LTRIM(RTRIM(COALESCE(MenuPath, '')))) = '/reportlayoutmanager'
      OR (
        LOWER(LTRIM(RTRIM(COALESCE(MenuName, '')))) IN ('report layout manager', 'report studio')
        AND LOWER(LTRIM(RTRIM(COALESCE(MenuPath, '')))) NOT LIKE '/reportlayoutmanager/menu/%'
      )
    )
      AND (CAST(@canonicalMenuId AS INTEGER) IS NULL OR MenuId <> @canonicalMenuId)
  `, {
    canonicalMenuId: Number.isInteger(Number(canonicalMenuId)) ? Number(canonicalMenuId) : null,
  });

  if (!rows.length) return 0;

  let deleteCount = 0;
  for (const row of rows) {
    await db.query(`
      UPDATE dbo.Menus
      SET ParentId = @parentId
      WHERE ParentId = @menuId
    `, {
      menuId: row.MenuId,
      parentId: reportsRoot?.MenuId ?? row.ParentId ?? null,
    });

    if (await hasRoleRightsTable(db)) {
      await db.query(`
        DELETE FROM dbo.RoleRights
        WHERE MenuId = @menuId
      `, { menuId: row.MenuId });
    }

    const result = await db.query(`
      DELETE FROM dbo.Menus
      WHERE MenuId = @menuId
    `, { menuId: row.MenuId });

    deleteCount += result.rowsAffected?.[0] || 0;
  }

  return deleteCount;
};

const deleteDeprecatedTransactionFieldMenu = async (db) => {
  const rows = await db.queryRows(`
    SELECT MenuId FROM dbo.Menus
    -- Form ER-3/5/6 were pre-GST excise returns that never had a report behind them.
    WHERE LOWER(LTRIM(RTRIM(COALESCE(MenuPath, '')))) IN ('/transaction-field-configuration', '/new-sales-order',
      '/reports/financial/accounting/form-er-3', '/reports/financial/accounting/form-er-5', '/reports/financial/accounting/form-er-6')
       OR LOWER(LTRIM(RTRIM(COALESCE(MenuName, '')))) IN ('transaction field configuration', 'new sales order')
  `);
  let count = 0;
  for (const row of rows) {
    if (await hasRoleRightsTable(db)) {
      await db.query('DELETE FROM dbo.RoleRights WHERE MenuId = @menuId', { menuId: row.MenuId });
    }
    const result = await db.query('DELETE FROM dbo.Menus WHERE MenuId = @menuId', { menuId: row.MenuId });
    count += result.rowsAffected?.[0] || 0;
  }
  return count;
};

// These setup screens belong to Gate Pass and may still have the old top-level
// Master parent in databases created before the Gate Pass menu was introduced.
const moveGatePassMasterMenus = async (db, menuByKey) => {
  const parentId = menuByKey.get('gate-pass-master')?.MenuId;
  if (!parentId) return 0;

  // Match by path as well as the canonical rows. Older syncs could leave a
  // duplicate with the same path under the top-level Master menu.
  const result = await db.query(`
    UPDATE dbo.Menus
    SET ParentId = @parentId
    WHERE LOWER(LTRIM(RTRIM(COALESCE(MenuPath, '')))) IN ('/gate-pass/visitor-type', '/gate-pass/visit-type')
      AND MenuId <> @parentId
      AND (ParentId IS NULL OR ParentId <> @parentId)
  `, { parentId });

  for (const key of ['gate-pass-visitor-type', 'gate-pass-visit-type']) {
    const menu = menuByKey.get(key);
    if (menu) menu.ParentId = parentId;
  }
  return result.rowsAffected?.[0] || 0;
};

const syncApplicationSidebarMenus = async (db) => {
  if (!(await hasMenusTable(db))) {
    return 0;
  }

  const existingMenus = await getExistingMenus(db);
  const menuByKey = new Map();
  let syncCount = 0;

  for (const definition of APP_MENU_DEFINITIONS) {
    const parentId = definition.parentKey ? menuByKey.get(definition.parentKey)?.MenuId : null;
    if (definition.parentKey && !parentId) {
      throw createHttpError(500, `Missing parent menu definition for ${definition.key}.`);
    }

    const existingMenu = findExistingMenu(existingMenus, definition, parentId);
    const shouldUseCanonicalPath = Boolean(
      existingMenu
      && definition.menuPath
      && normalizePath(existingMenu.MenuPath) !== normalizePath(definition.menuPath),
    );
    const syncedMenu = existingMenu
      ? await updateMenuMetadata(db, existingMenu, definition, shouldUseCanonicalPath)
      : await insertMenu(db, definition, parentId);

    if (!existingMenu) {
      existingMenus.push(syncedMenu);
    } else {
      const existingIndex = existingMenus.findIndex((menu) => Number(menu.MenuId) === Number(existingMenu.MenuId));
      if (existingIndex >= 0) {
        existingMenus[existingIndex] = syncedMenu;
      }
    }

    menuByKey.set(definition.key, syncedMenu);
    syncCount += 1;
  }

  syncCount += await moveGatePassMasterMenus(db, menuByKey);
  syncCount += await deleteDeprecatedTransactionFieldMenu(db);
  const featureRights = [
    ['purchase', 'job-work'],
    ['sales', 'job-work-sales'],
    ['purchase', 'job-work-purchase'],
    ['grpo', 'jobwork-issue-note'],
    ['grpo', 'jobwork-receipt-note'],
    ['delivery', 'customer-receipt-note'],
    ['delivery', 'customer-issue-note'],
    ['purchase', 'gate-pass'],
    ['master', 'gate-pass-master'],
    ['gate-pass-master', 'gate-pass-visitor-type'],
    ['gate-pass-master', 'gate-pass-visit-type'],
    ['production', 'gate-pass-transactions'],
    ['grpo', 'gate-pass-visitor-log'],
    ['grpo', 'gate-pass-gate-in'],
    ['grpo', 'gate-pass-gate-out'],
    ['inventory', 'quality-control'],
    ['goods-receipt', 'qc-addons'],
    ['goods-receipt', 'qc-mappings'],
    ['goods-receipt', 'qc-parameters'],
    ['goods-receipt', 'qc-item-parameter-mappings'],
    ['goods-receipt', 'qc-instruments'],
    ['goods-receipt', 'qc-workflows'],
    ['goods-receipt', 'qc-inward'],
    ['goods-receipt', 'qc-outward'],
    ['goods-receipt', 'qc-transactions'],
  ];
  for (const [sourceKey, targetKey] of featureRights) {
    syncCount += await cloneRoleRightsForDuplicateMenu(
      db,
      menuByKey.get(sourceKey)?.MenuId,
      menuByKey.get(targetKey)?.MenuId,
    );
  }

  for (const menuKey of ['whatsapp', 'whatsapp-inbox', 'whatsapp-configuration', 'query-manager']) {
    syncCount += await restrictMenuToAdminRoles(db, menuByKey.get(menuKey)?.MenuId);
  }

  // Variant rights are migrated below, never cloned back from standard pages.
  syncCount += await cloneRoleRightsForDuplicateMenu(
    db,
    menuByKey.get('sales-analysis')?.MenuId,
    menuByKey.get('item-list-report')?.MenuId,
  );
  syncCount += await cloneRoleRightsForDuplicateMenu(
    db,
    menuByKey.get('reports')?.MenuId,
    menuByKey.get('report-layout-manager')?.MenuId,
  );
  syncCount += await cloneRoleRightsForDuplicateMenu(
    db,
    menuByKey.get('item-list-report')?.MenuId,
    menuByKey.get('inventory-posting-list-report')?.MenuId,
  );
  syncCount += await cloneRoleRightsForDuplicateMenu(
    db,
    menuByKey.get('reports')?.MenuId,
    menuByKey.get('reports-production')?.MenuId,
  );
  syncCount += await cloneRoleRightsForDuplicateMenu(
    db,
    menuByKey.get('bom')?.MenuId,
    menuByKey.get('bill-of-materials-report')?.MenuId,
  );
  syncCount += await cloneRoleRightsForDuplicateMenu(
    db,
    menuByKey.get('item-list-report')?.MenuId,
    menuByKey.get('open-items-list-report')?.MenuId,
  );
  syncCount += await cloneRoleRightsForDuplicateMenu(
    db,
    menuByKey.get('sales-analysis')?.MenuId,
    menuByKey.get('gl-accounts-business-partners-report')?.MenuId,
  );
  const financialAccountingReportKeys = [
    'general-ledger-report',
    'customer-receivables-aging-report',
    'vendor-liabilities-aging-report',
    'transaction-journal-report',
    'transaction-by-projects-report',
    'journal-transaction-amount-range-report',
    'journal-transaction-fc-amount-range-report',
    'transactions-received-from-voucher-report',
    'document-journal-report',
  ];

  for (const reportKey of financialAccountingReportKeys) {
    syncCount += await cloneRoleRightsForDuplicateMenu(
      db,
      menuByKey.get('gl-accounts-business-partners-report')?.MenuId,
      menuByKey.get(reportKey)?.MenuId,
    );
  }
  const financialStatementReportKeys = [
    'balance-sheet-report',
    'trial-balance-report',
    'profit-loss-statement-report',
    'cash-flow-report',
    'statement-cash-flows-report',
    'cash-flow-reference-report',
    'business-assessment-report',
  ];

  for (const reportKey of financialStatementReportKeys) {
    syncCount += await cloneRoleRightsForDuplicateMenu(
      db,
      menuByKey.get('gl-accounts-business-partners-report')?.MenuId,
      menuByKey.get(reportKey)?.MenuId,
    );
  }
  const crmReportKeys = [
    'reports-crm-my-activities',
    'reports-crm-activities-overview',
    'reports-crm-inactive-customers',
    'reports-crm-campaigns-list',
    'reports-crm-opportunities-electronic-reports',
    'reports-crm-opportunities-forecast',
    'reports-crm-opportunities-forecast-over-time',
    'reports-crm-opportunities-statistics',
    'reports-crm-opportunities-report',
    'reports-crm-opportunities-stage-analysis',
    'reports-crm-opportunities-info-source-distribution-over-time',
    'reports-crm-opportunities-won',
    'reports-crm-opportunities-lost',
    'reports-crm-opportunities-my-open',
    'reports-crm-opportunities-my-closed',
    'reports-crm-opportunities-pipeline',
    'reports-crm-opportunities-test',
  ];

  for (const reportKey of crmReportKeys) {
    syncCount += await cloneRoleRightsForDuplicateMenu(
      db,
      menuByKey.get('sales-analysis')?.MenuId,
      menuByKey.get(reportKey)?.MenuId,
    );
  }
  syncCount += await deleteDeprecatedReportLayoutManagerMenu(
    db,
    menuByKey.get('report-layout-manager')?.MenuId,
  );

  if (await hasRoleRightsTable(db)) syncCount += await syncStandardSalesRoleRights(db);
  syncCount += await removeRetiredSalesMenus(db);

  return syncCount;
};

module.exports = {
  APP_MENU_DEFINITIONS,
  syncApplicationSidebarMenus,
};
