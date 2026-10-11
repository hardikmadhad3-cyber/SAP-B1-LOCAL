import { Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import Layout from "./components/Layout";
import LazyLoadErrorBoundary from "./components/LazyLoadErrorBoundary";
import RelationshipMapHost from "./components/relationship-map/RelationshipMapHost";
import RouteLoadingFallback from "./components/RouteLoadingFallback";
import SapFindShortcutManager from "./components/SapFindShortcutManager";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import {
  RequireAdminAuth,
  RequireAuth,
  RequirePendingSelection,
  RouteFallback,
} from "./auth/RouteGuards";

import Dashboard from "./pages/Dashboard";
import AdminLoginPage from "./pages/AdminLoginPage";
import LoginPage from "./pages/LoginPage";
import lazyWithRetry from "./utils/lazyWithRetry";
import { focusFirstSapField, installSapTabNavigation } from "./utils/sapTabNavigation";
import "./styles/auth.css";
import "./styles/admin-panel.css";
import "./styles/sap-ui.css";
import "./styles/route-loading.css";

const ItemMaster = lazyWithRetry(() => import("./pages/ItemMaster"));
const ItemMasterList = lazyWithRetry(() => import("./pages/ItemMasterList"));
const BusinessPartner = lazyWithRetry(() => import("./pages/BusinessPartner"));
const BusinessPartnerList = lazyWithRetry(() => import("./pages/BusinessPartnerList"));
const Warehouse = lazyWithRetry(() => import("./pages/Warehouse"));
const GeneralSettings = lazyWithRetry(() => import("./pages/GeneralSettings"));
const PriceList = lazyWithRetry(() => import("./pages/PriceList"));
const Delivery = lazyWithRetry(() => import("./pages/Delivery"));
const DeliveryList = lazyWithRetry(() => import("./pages/DeliveryList"));
const DCDelivery = lazyWithRetry(() => import("./pages/DCDelivery"));
const DCDeliveryList = lazyWithRetry(() => import("./pages/DCDeliveryList"));
const NCDelivery = lazyWithRetry(() => import("./pages/NCDelivery"));
const NCDeliveryList = lazyWithRetry(() => import("./pages/NCDeliveryList"));
const SODADelivery = lazyWithRetry(() => import("./pages/SODADelivery"));
const SODADeliveryList = lazyWithRetry(() => import("./pages/SODADeliveryList"));
const TaxCode = lazyWithRetry(() => import("./pages/TaxCode"));
const UoMGroup = lazyWithRetry(() => import("./pages/UoMGroup"));
const PaymentTerms = lazyWithRetry(() => import("./pages/PaymentTerms"));
const ShippingType = lazyWithRetry(() => import("./pages/ShippingType"));
const QcAddonsPage = lazyWithRetry(() => import("./pages/QcAddonsPage"));
const QcDocumentMappingsPage = lazyWithRetry(() => import("./pages/QcDocumentMappingsPage"));
const QcParametersPage = lazyWithRetry(() => import("./pages/QcParametersPage"));
const QcWorkflowsPage = lazyWithRetry(() => import("./pages/QcWorkflowsPage"));
const QcTransactionsPage = lazyWithRetry(() => import("./pages/QcTransactionsPage"));
const QcInwardPage = lazyWithRetry(() => import("./pages/QcInwardPage"));
const QcOutwardPage = lazyWithRetry(() => import("./pages/QcOutwardPage"));
const QcItemParameterMappingsPage = lazyWithRetry(() => import("./pages/QcItemParameterMappingsPage"));
const QcItemParameterMappingsFindPage = lazyWithRetry(() => import("./pages/QcItemParameterMappingsFindPage"));
const QcInstrumentsPage = lazyWithRetry(() => import("./pages/QcInstrumentsPage"));
const WhatsAppDashboardPage = lazyWithRetry(() => import("./pages/WhatsAppDashboardPage"));
const WhatsAppConfigurationPage = lazyWithRetry(() => import("./pages/WhatsAppConfigurationPage"));
const Branch = lazyWithRetry(() => import("./pages/Branch"));
const ChartOfAccounts = lazyWithRetry(() => import("./pages/ChartOfAccounts"));
const GoodsReceipt = lazyWithRetry(() => import("./pages/GoodsReceipt"));
const GoodsReceiptList = lazyWithRetry(() => import("./pages/GoodsReceiptList"));
const GoodsIssue = lazyWithRetry(() => import("./pages/GoodsIssue"));
const GoodsIssueList = lazyWithRetry(() => import("./pages/GoodsIssueList"));
const InventoryTransferRequest = lazyWithRetry(() => import("./pages/InventoryTransferRequest"));
const InventoryTransferRequestList = lazyWithRetry(() => import("./pages/InventoryTransferRequestList"));
const InventoryTransfer = lazyWithRetry(() => import("./pages/InventoryTransfer"));
const InventoryTransferList = lazyWithRetry(() => import("./pages/InventoryTransferList"));
const PurchaseOrder = lazyWithRetry(() => import("./pages/PurchaseOrder"));
const PurchaseOrderList = lazyWithRetry(() => import("./pages/PurchaseOrderList"));
const PurchaseQuotation = lazyWithRetry(() => import("./pages/PurchaseQuotation"));
const PurchaseQuotationList = lazyWithRetry(() => import("./pages/PurchaseQuotationList"));
const PurchaseRequest = lazyWithRetry(() => import("./pages/PurchaseRequest"));
const PurchaseRequestList = lazyWithRetry(() => import("./pages/PurchaseRequestList"));
const GoodsReceiptPO = lazyWithRetry(() => import("./pages/GRPO"));
const GRPOList = lazyWithRetry(() => import("./pages/GRPOList"));
const SalesOrder = lazyWithRetry(() => import("./pages/SalesOrder"));
const TransactionFieldConfiguration = lazyWithRetry(() => import("./pages/TransactionFieldConfiguration"));
const SalesOrderList = lazyWithRetry(() => import("./pages/SalesOrderList"));
const DCSalesOrder = lazyWithRetry(() => import("./pages/DCSalesOrder"));
const DCSalesOrderList = lazyWithRetry(() => import("./pages/DCSalesOrderList"));
const NCSalesOrder = lazyWithRetry(() => import("./pages/NCSalesOrder"));
const NCSalesOrderList = lazyWithRetry(() => import("./pages/NCSalesOrderList"));
const SODASalesOrder = lazyWithRetry(() => import("./pages/SODASalesOrder"));
const SODASalesOrderList = lazyWithRetry(() => import("./pages/SODASalesOrderList"));
const BOM = lazyWithRetry(() => import("./pages/BOM"));
const BOMList = lazyWithRetry(() => import("./pages/BOMList"));
const ProductionOrder = lazyWithRetry(() => import("./pages/ProductionOrder"));
const IssueForProduction = lazyWithRetry(() => import("./pages/IssueForProduction"));
const ReceiptFromProduction = lazyWithRetry(() => import("./pages/ReceiptFromProduction"));
const APInvoice = lazyWithRetry(() => import("./pages/APInvoice"));
const APInvoiceList = lazyWithRetry(() => import("./pages/APInvoiceList"));
const ARInvoice = lazyWithRetry(() => import("./pages/ARInvoice"));
const ARInvoiceList = lazyWithRetry(() => import("./pages/ARInvoiceList"));
const ServiceARInvoice = lazyWithRetry(() => import("./pages/ServiceARInvoice"));
const ServiceARInvoiceList = lazyWithRetry(() => import("./pages/ServiceARInvoiceList"));
const ServiceAPInvoice = lazyWithRetry(() => import("./pages/ServiceAPInvoice"));
const ServiceAPInvoiceList = lazyWithRetry(() => import("./pages/ServiceAPInvoiceList"));
const ServiceAPCreditMemo = lazyWithRetry(() => import("./pages/ServiceAPCreditMemo"));
const ServiceAPCreditMemoList = lazyWithRetry(() => import("./pages/ServiceAPCreditMemoList"));
const ServiceARCreditMemo = lazyWithRetry(() => import("./pages/ServiceARCreditMemo"));
const ServiceARCreditMemoList = lazyWithRetry(() => import("./pages/ServiceARCreditMemoList"));
const APCreditMemo = lazyWithRetry(() => import("./pages/APCreditMemo"));
const APCreditMemoList = lazyWithRetry(() => import("./pages/APCreditMemoList"));
const ARCreditMemo = lazyWithRetry(() => import("./pages/ARCreditMemo"));
const ARCreditMemoList = lazyWithRetry(() => import("./pages/ARCreditMemoList"));
const IncomingPayments = lazyWithRetry(() => import("./pages/IncomingPayments"));
const IncomingPaymentsList = lazyWithRetry(() => import("./pages/IncomingPaymentsList"));
const OutgoingPayments = lazyWithRetry(() => import("./pages/OutgoingPayments"));
const OutgoingPaymentsList = lazyWithRetry(() => import("./pages/OutgoingPaymentsList"));
const JournalEntry = lazyWithRetry(() => import("./pages/JournalEntry"));
const JournalEntryList = lazyWithRetry(() => import("./pages/JournalEntryList"));
const SalesQuotation = lazyWithRetry(() => import("./pages/SalesQuotation"));
const SalesQuotationList = lazyWithRetry(() => import("./pages/SalesQuotationList"));
const SalesAnalysisReportPage = lazyWithRetry(() => import("./pages/SalesAnalysisReportPage"));
const CompanyReportsPage = lazyWithRetry(() => import("./pages/CompanyReportsPage"));
const BillOfMaterialsReportPage = lazyWithRetry(() => import("./pages/BillOfMaterialsReportPage"));
const OpportunitiesForecastReportPage = lazyWithRetry(() => import("./pages/OpportunitiesForecastReportPage"));
const OpportunitiesForecastOverTimeReportPage = lazyWithRetry(() => import("./pages/OpportunitiesForecastOverTimeReportPage"));
const OpportunitiesStatisticsReportPage = lazyWithRetry(() => import("./pages/OpportunitiesStatisticsReportPage"));
const OpportunitiesReportPage = lazyWithRetry(() => import("./pages/OpportunitiesReportPage"));
const OpportunitiesPipelineReportPage = lazyWithRetry(() => import("./pages/OpportunitiesPipelineReportPage"));
const OpportunitiesStageAnalysisReportPage = lazyWithRetry(() => import("./pages/OpportunitiesStageAnalysisReportPage"));
const WonOpportunitiesReportPage = lazyWithRetry(() => import("./pages/WonOpportunitiesReportPage"));
const LostOpportunitiesReportPage = lazyWithRetry(() => import("./pages/LostOpportunitiesReportPage"));
const InformationSourceDistributionOverTimeReportPage = lazyWithRetry(() => import("./pages/InformationSourceDistributionOverTimeReportPage"));
const ItemListReportPage = lazyWithRetry(() => import("./pages/ItemListReportPage"));
const ProductionOpenItemsReportPage = lazyWithRetry(() => import("./pages/ProductionOpenItemsReportPage"));
const InventoryPostingListReportPage = lazyWithRetry(() => import("./pages/InventoryPostingListReportPage"));
const InventoryInWarehouseReportPage = lazyWithRetry(() => import("./pages/InventoryInWarehouseReportPage"));
const InventoryAuditReportPage = lazyWithRetry(() => import("./pages/InventoryAuditReportPage"));
const InventoryAgingReportPage = lazyWithRetry(() => import("./pages/InventoryAgingReportPage"));
const PurchaseAnalysisReport = lazyWithRetry(() => import("./pages/PurchaseAnalysisReport"));
const PurchaseRequestReportPage = lazyWithRetry(() => import("./pages/PurchaseRequestReportPage"));
const ActivityOverviewReportPage = lazyWithRetry(() => import("./pages/ActivityOverviewReportPage"));
const CampaignsListReportPage = lazyWithRetry(() => import("./pages/CampaignsListReportPage"));
const ActivityPage = lazyWithRetry(() => import("./pages/ActivityPage"));
const CRMReportPage = lazyWithRetry(() => import("./pages/CRMReportPage"));
const InactiveCustomersReportPage = lazyWithRetry(() => import("./pages/InactiveCustomersReportPage"));
const GLAccountsBusinessPartnersReportPage = lazyWithRetry(() => import("./pages/GLAccountsBusinessPartnersReportPage"));
const GeneralLedgerReportPage = lazyWithRetry(() => import("./pages/GeneralLedgerReportPage"));
const FinancialAccountingReportPage = lazyWithRetry(() => import("./pages/FinancialAccountingReportPage"));
const FinancialStatementReportPage = lazyWithRetry(() => import("./pages/FinancialStatementReportPage"));
const StatementCashFlowReportPage = lazyWithRetry(() => import("./pages/StatementCashFlowReportPage"));
const BusinessAssessmentReportPage = lazyWithRetry(() => import("./pages/BusinessAssessmentReportPage"));
const CustomerReceivablesAgingReportPage = lazyWithRetry(() => import("./pages/CustomerReceivablesAgingReportPage"));
const VendorLiabilitiesAgingReportPage = lazyWithRetry(() => import("./pages/VendorLiabilitiesAgingReportPage"));
const ReportsStudioPage = lazyWithRetry(() => import("./pages/ReportsStudioPage"));
const ReportRunnerPage = lazyWithRetry(() => import("./pages/ReportRunnerPage"));
const QueryManagerPage = lazyWithRetry(() => import("./pages/QueryManagerPage"));
const JobworkIssueNotePage = lazyWithRetry(() => import("./pages/JobworkIssueNotePage"));
const JobworkReceiptReturnNotePage = lazyWithRetry(() => import("./pages/JobworkReceiptReturnNotePage"));
const CustomerReceiptNotePage = lazyWithRetry(() => import("./pages/CustomerReceiptNotePage"));
const CustomerIssueReturnNotePage = lazyWithRetry(() => import("./pages/CustomerIssueReturnNotePage"));
const GatePassVisitorTypePage = lazyWithRetry(() => import("./pages/GatePassVisitorTypePage"));
const GatePassVisitTypePage = lazyWithRetry(() => import("./pages/GatePassVisitTypePage"));
const VisitorLogPage = lazyWithRetry(() => import("./pages/VisitorLogPage"));
const GateInPage = lazyWithRetry(() => import("./pages/GateInPage"));
const GateOutPage = lazyWithRetry(() => import("./pages/GateOutPage"));
const AdminPanelHome = lazyWithRetry(() => import("./pages/AdminPanelHome"));
const AdminPanelEntity = lazyWithRetry(() => import("./pages/AdminPanelEntity"));
const CompanyFormSettings = lazyWithRetry(() => import("./pages/CompanyFormSettings"));

const DEFAULT_DOCUMENT_TITLE = "SAP Business One";

const getCompanyDocumentTitle = (company) => {
  const companyName = String(company?.companyName || "").trim();
  const dbName = String(company?.dbName || "").trim();

  return companyName || dbName || DEFAULT_DOCUMENT_TITLE;
};

function CompanyTitleManager() {
  const { company, isAuthenticated, isAdminAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      document.title = getCompanyDocumentTitle(company);
      return;
    }

    document.title = isAdminAuthenticated ? "SAP B1 Admin" : DEFAULT_DOCUMENT_TITLE;
  }, [company?.companyName, company?.dbName, isAuthenticated, isAdminAuthenticated]);

  return null;
}

function SapInitialFocusManager() {
  const location = useLocation();

  useEffect(() => {
    focusFirstSapField(180);
    focusFirstSapField(520);
  }, [location.pathname, location.search]);

  return null;
}

function App() {
  useEffect(() => installSapTabNavigation(), []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <CompanyTitleManager />
        <SapInitialFocusManager />
        <SapFindShortcutManager />
        <LazyLoadErrorBoundary>
          <RelationshipMapHost />
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route
                path="/login"
                element={<LoginPage />}
              />

              <Route
                path="/admin-login"
                element={<AdminLoginPage />}
              />
              <Route path="/transaction-field-configuration" element={<Navigate to="/admin/transaction-field-configuration" replace />} />
              <Route path="/new-sales-order" element={<Navigate to="/admin/transaction-field-configuration" replace />} />

              <Route
                path="/company-select"
                element={
                  <RequirePendingSelection>
                    <Navigate to="/login" replace />
                  </RequirePendingSelection>
                }
              />

              <Route element={<RequireAuth />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/item-master" element={<ItemMaster />} />
                  <Route path="/item-master/find" element={<ItemMasterList />} />
                  <Route path="/business-partner" element={<BusinessPartner />} />
                  <Route path="/business-partner/find" element={<BusinessPartnerList />} />
                  <Route path="/warehouse" element={<Warehouse />} />
                  <Route path="/price-list" element={<PriceList />} />
                  <Route path="/tax-code" element={<TaxCode />} />
                  <Route path="/uom-group" element={<UoMGroup />} />
                  <Route path="/payment-terms" element={<PaymentTerms />} />
                  <Route path="/goods-receipt" element={<GoodsReceipt />} />
                  <Route path="/goods-receipt/find" element={<GoodsReceiptList />} />
                  <Route path="/goods-issue" element={<GoodsIssue />} />
                  <Route path="/goods-issue/find" element={<GoodsIssueList />} />
                  <Route path="/inventory-transfer-request" element={<InventoryTransferRequest />} />
                  <Route path="/inventory-transfer-request/find" element={<InventoryTransferRequestList />} />
                  <Route path="/inventory-transfer" element={<InventoryTransfer />} />
                  <Route path="/inventory-transfer/find" element={<InventoryTransferList />} />
                  <Route path="/delivery" element={<Delivery />} />
                  <Route path="/delivery/new" element={<Delivery />} />
                  <Route path="/Delivery" element={<Navigate to="/delivery" replace />} />
                  <Route path="/delivery/find" element={<DeliveryList />} />
                  <Route path="/dc-delivery" element={<DCDelivery />} />
                  <Route path="/dc-delivery/new" element={<DCDelivery />} />
                  <Route path="/dc-delivery/find" element={<DCDeliveryList />} />
                  <Route path="/nc-delivery" element={<NCDelivery />} />
                  <Route path="/nc-delivery/new" element={<NCDelivery />} />
                  <Route path="/nc-delivery/find" element={<NCDeliveryList />} />
                  <Route path="/soda-delivery" element={<SODADelivery />} />
                  <Route path="/soda-delivery/new" element={<SODADelivery />} />
                  <Route path="/soda-delivery/find" element={<SODADeliveryList />} />
                  <Route path="/shipping-type" element={<ShippingType />} />
                  <Route path="/whatsapp" element={<WhatsAppDashboardPage />} />
                  <Route path="/whatsapp/configuration" element={<WhatsAppConfigurationPage />} />
                  <Route path="/qc/addons" element={<QcAddonsPage />} />
                  <Route path="/qc/document-mappings" element={<QcDocumentMappingsPage />} />
                  <Route path="/qc/parameters" element={<QcParametersPage />} />
                  <Route path="/qc/workflows" element={<QcWorkflowsPage />} />
                  <Route path="/qc/transactions" element={<QcTransactionsPage />} />
                  <Route path="/qc/inward" element={<QcInwardPage />} />
                  <Route path="/qc/outward" element={<QcOutwardPage />} />
                  <Route path="/qc/item-parameter-mappings" element={<QcItemParameterMappingsPage />} />
                  <Route path="/qc/item-parameter-mappings/find" element={<QcItemParameterMappingsFindPage />} />
                  <Route path="/qc/instruments" element={<QcInstrumentsPage />} />
                  <Route path="/branch" element={<Branch />} />
                  <Route path="/chart-of-accounts" element={<ChartOfAccounts />} />
                  <Route path="/purchase-order" element={<PurchaseOrder />} />
                  <Route path="/purchase-order/find" element={<PurchaseOrderList />} />
                  <Route path="/purchase-quotation" element={<PurchaseQuotation />} />
                  <Route path="/purchase-quotation/find" element={<PurchaseQuotationList />} />
                  <Route path="/purchase-request" element={<PurchaseRequest />} />
                  <Route path="/purchase-request/find" element={<PurchaseRequestList />} />
                  <Route path="/grpo" element={<GoodsReceiptPO />} />
                  <Route path="/grpo/find" element={<GRPOList />} />
                  <Route path="/sales-order" element={<SalesOrder />} />
                  <Route path="/sales-order/old" element={<SalesOrder />} />
                  <Route path="/sales-order/find" element={<SalesOrderList />} />
                  <Route path="/dc-sales-order" element={<DCSalesOrder />} />
                  <Route path="/dc-sales-order/find" element={<DCSalesOrderList />} />
                  <Route path="/nc-sales-order" element={<NCSalesOrder />} />
                  <Route path="/nc-sales-order/find" element={<NCSalesOrderList />} />
                  <Route path="/soda-sales-order" element={<SODASalesOrder />} />
                  <Route path="/soda-sales-order/find" element={<SODASalesOrderList />} />
                  <Route path="/sales-quotation" element={<SalesQuotation />} />
                  <Route path="/sales-quotation/find" element={<SalesQuotationList />} />
                  <Route path="/reportlayoutmanager" element={<ReportsStudioPage />} />
                  <Route path="/reportlayoutmanager/menu/:menuId" element={<ReportRunnerPage />} />
                  <Route path="/reportlayoutmanager/report/:reportId" element={<ReportRunnerPage />} />
                  <Route path="/reports" element={<Navigate to="/reportlayoutmanager" replace />} />
                  <Route path="/reports/menu/:menuId" element={<ReportRunnerPage />} />
                  <Route path="/reports/report/:reportId" element={<ReportRunnerPage />} />
                  <Route path="/query-manager" element={<QueryManagerPage />} />
                  <Route path="/jobwork-issue-note" element={<JobworkIssueNotePage />} />
                  <Route path="/jobwork-receipt-note" element={<JobworkReceiptReturnNotePage />} />
                  <Route path="/customer-receipt-note" element={<CustomerReceiptNotePage />} />
                  <Route path="/customer-issue-note" element={<CustomerIssueReturnNotePage />} />
                  <Route path="/gate-pass/visitor-type" element={<GatePassVisitorTypePage />} />
                  <Route path="/gate-pass/visit-type" element={<GatePassVisitTypePage />} />
                  <Route path="/gate-pass/visitor-log" element={<VisitorLogPage />} />
                  <Route path="/gate-pass/gate-in" element={<GateInPage />} />
                  <Route path="/gate-pass/gate-out" element={<GateOutPage />} />
                  <Route path="/reports/sales/analysis" element={<SalesAnalysisReportPage />} />
                  <Route path="/reports/company" element={<CompanyReportsPage />} />
                  <Route path="/reports/crm/opportunities/forecast" element={<OpportunitiesForecastReportPage />} />
                  <Route path="/reports/crm/opportunities/forecast-over-time" element={<OpportunitiesForecastOverTimeReportPage />} />
                  <Route path="/reports/crm/opportunities/statistics" element={<OpportunitiesStatisticsReportPage />} />
                  <Route path="/reports/crm/opportunities/report" element={<OpportunitiesReportPage />} />
                  <Route path="/reports/crm/opportunities/stage-analysis" element={<OpportunitiesStageAnalysisReportPage />} />
                  <Route path="/reports/crm/opportunities/pipeline" element={<OpportunitiesPipelineReportPage />} />
                  <Route path="/reports/crm/opportunities/information-source-distribution-over-time" element={<InformationSourceDistributionOverTimeReportPage />} />
                  <Route path="/reports/crm/opportunities/won" element={<WonOpportunitiesReportPage />} />
                  <Route path="/reports/crm/opportunities/lost" element={<LostOpportunitiesReportPage />} />
                  <Route path="/reports/item-list" element={<ItemListReportPage />} />
                  <Route path="/reports/production/open-items-list" element={<ProductionOpenItemsReportPage />} />
                  <Route path="/reports/inventory/posting-list" element={<InventoryPostingListReportPage />} />
                  <Route path="/reports/inventory/in-warehouse" element={<InventoryInWarehouseReportPage />} />
                  <Route path="/reports/inventory/audit" element={<InventoryAuditReportPage />} />
                  <Route path="/reports/inventory/aging" element={<InventoryAgingReportPage />} />
                  <Route path="/reports/purchasing/analysis" element={<PurchaseAnalysisReport />} />
                  <Route path="/reports/purchase-analysis" element={<PurchaseAnalysisReport />} />
                  <Route path="/reports/purchase/analysis" element={<PurchaseAnalysisReport />} />
                  <Route path="/reports/purchasing/purchase-request-report" element={<PurchaseRequestReportPage />} />
                  <Route path="/reports/crm/activities-overview" element={<ActivityOverviewReportPage />} />
                  <Route path="/reports/crm/campaigns-list" element={<CampaignsListReportPage />} />
                  <Route path="/reports/crm/inactive-customers" element={<InactiveCustomersReportPage />} />
                  <Route path="/reports/crm/*" element={<CRMReportPage />} />
                  <Route path="/activity" element={<ActivityPage />} />
                  <Route path="/reports/financial/accounting/gl-accounts-business-partners" element={<GLAccountsBusinessPartnersReportPage />} />
                  <Route path="/reports/financial/accounting/general-ledger" element={<GeneralLedgerReportPage />} />
                  <Route path="/reports/financial/accounting/aging/customer-receivables" element={<CustomerReceivablesAgingReportPage />} />
                  <Route path="/reports/financial/accounting/aging/vendor-liabilities" element={<VendorLiabilitiesAgingReportPage />} />
                  <Route path="/reports/financial/accounting/aging/:agingReportKey" element={<FinancialAccountingReportPage />} />
                  <Route path="/reports/financial/accounting/:reportKey" element={<FinancialAccountingReportPage />} />
                  <Route path="/reports/financial/financial/statement-of-cash-flows" element={<StatementCashFlowReportPage />} />
                  <Route path="/reports/financial/financial/business-assessment-report" element={<BusinessAssessmentReportPage />} />
                  <Route path="/reports/financial/financial/:reportKey" element={<FinancialStatementReportPage />} />
                  <Route path="/reports/production/bill-of-materials" element={<BillOfMaterialsReportPage />} />
                  <Route path="/bom" element={<BOM />} />
                  <Route path="/bom/find" element={<BOMList />} />
                  <Route path="/production-order" element={<ProductionOrder />} />
                  <Route path="/issue-for-production" element={<IssueForProduction />} />
                  <Route path="/receipt-from-production" element={<ReceiptFromProduction />} />
                  <Route path="/ap-invoice" element={<APInvoice />} />
                  <Route path="/ap-invoice/find" element={<APInvoiceList />} />
                  <Route path="/ar-invoice" element={<ARInvoice />} />
                  <Route path="/ar-invoice/find" element={<ARInvoiceList />} />
                  <Route path="/services/ar-invoice" element={<ServiceARInvoice />} />
                  <Route path="/services/ar-invoice/find" element={<ServiceARInvoiceList />} />
                  <Route path="/services/ap-invoice" element={<ServiceAPInvoice />} />
                  <Route path="/services/ap-invoice/find" element={<ServiceAPInvoiceList />} />
                  <Route path="/services/ap-credit-memo" element={<ServiceAPCreditMemo />} />
                  <Route path="/services/ap-credit-memo/find" element={<ServiceAPCreditMemoList />} />
                  <Route path="/services/ar-credit-memo" element={<ServiceARCreditMemo />} />
                  <Route path="/services/ar-credit-memo/find" element={<ServiceARCreditMemoList />} />
                  <Route path="/ar-credit-memo" element={<ARCreditMemo />} />
                  <Route path="/ar-credit-memo/find" element={<ARCreditMemoList />} />
                  <Route path="/ap-credit-memo" element={<APCreditMemo />} />
                  <Route path="/ap-credit-memo/find" element={<APCreditMemoList />} />
                  <Route path="/incoming-payments" element={<IncomingPayments />} />
                  <Route path="/incoming-payments/find" element={<IncomingPaymentsList />} />
                  <Route path="/outgoing-payments" element={<OutgoingPayments />} />
                  <Route path="/outgoing-payments/find" element={<OutgoingPaymentsList />} />
                  <Route path="/journal-entry" element={<JournalEntry />} />
                  <Route path="/journal-entry/find" element={<JournalEntryList />} />
                </Route>
              </Route>

              <Route element={<RequireAdminAuth />}>
                <Route element={<Layout />}>
                  <Route path="/adminpanel" element={<Navigate to="/admin" replace />} />
                  <Route path="/admin" element={<AdminPanelHome />} />
                  <Route path="/admin/general-settings" element={<GeneralSettings />} />
                  <Route path="/admin/transaction-field-configuration" element={<TransactionFieldConfiguration />} />
                  <Route path="/admin/company-form-settings" element={<CompanyFormSettings />} />
                  <Route path="/admin/:entityKey" element={<AdminPanelEntity />} />
                  <Route path="/admin/:entityKey/new" element={<AdminPanelEntity />} />
                  <Route path="/admin/:entityKey/:recordId" element={<AdminPanelEntity />} />
                </Route>
              </Route>

              <Route path="*" element={<RouteFallback />} />
            </Routes>
          </Suspense>
        </LazyLoadErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
