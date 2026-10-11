import SapDateInput from '../components/common/SapDateInput';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import BusinessPartnerLookupModal from '../components/reports/BusinessPartnerLookupModal';
import ItemLookupModal from '../components/reports/ItemLookupModal';
import PropertiesSelectionModal from '../components/reports/PropertiesSelectionModal';
import SalesEmployeeLookupModal from '../components/reports/SalesEmployeeLookupModal';
import SalesAnalysisDetailModal from '../components/reports/SalesAnalysisDetailModal';
import useFloatingWindow from '../components/reports/useFloatingWindow';
import { useSapWindowTaskbarActions } from '../components/SapWindowTaskbarContext';
import { fetchBPGroups } from '../api/businessPartnerApi';
import { fetchItemGroups, fetchItemProperties } from '../api/itemApi';
import {
  fetchCustomerSalesAnalysisDetailReport,
  fetchCustomerSalesAnalysisReport,
  fetchItemSalesAnalysisReport,
  fetchSalesEmployeeSalesAnalysisReport,
} from '../api/salesAnalysisApi';
import { exportReportAsExcel, exportReportAsPdf } from '../utils/reportExportUtils';
import '../styles/sales-analysis-report.css';

const TAB_OPTIONS = [
  { id: 'customers', label: 'Customers' },
  { id: 'items', label: 'Items' },
  { id: 'salesEmployees', label: 'Sales Employees' },
];

const PERIOD_OPTIONS = [
  { value: 'annual', label: 'Annual Report' },
  { value: 'monthly', label: 'Monthly Report' },
  { value: 'quarterly', label: 'Quarterly Report' },
];

const DOCUMENT_OPTIONS = [
  { value: 'invoices', label: 'Invoices' },
  { value: 'orders', label: 'Orders' },
  { value: 'deliveryNotes', label: 'Delivery Notes' },
];

const DISPLAY_OPTIONS = [
  { value: 'individual', label: 'Individual Display' },
  { value: 'group', label: 'Group Display' },
];

const CUSTOMER_TOTAL_OPTIONS = [
  { value: 'customer', label: 'Total by Customer' },
  { value: 'blanketAgreement', label: 'Total by Blanket Agreement' },
];

const ITEM_TOTAL_OPTIONS = [
  { value: 'none', label: 'No Totals' },
  { value: 'customer', label: 'Total by Customer' },
  { value: 'salesEmployee', label: 'Total by Sales Employee' },
];

const EXPORT_DATE_LABELS = {
  postingDate: 'Reference Date',
  dueDate: 'Value Date',
  documentDate: 'Document Date',
};

const EXPORT_DOCUMENT_LABELS = {
  invoices: 'A/R Invoices',
  orders: 'Sales Orders',
  deliveryNotes: 'Delivery Notes',
};

const DEFAULT_BP_PROPERTIES = Array.from({ length: 64 }, (_, index) => ({
  number: index + 1,
  name: `Business Partners Property ${index + 1}`,
}));

const DEFAULT_ITEM_PROPERTIES = Array.from({ length: 64 }, (_, index) => ({
  number: index + 1,
  name: `Item Property ${index + 1}`,
}));

const parseSapDateToIso = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) {
    return raw;
  }

  const [, dayText, monthText, yearText] = match;
  const year = yearText.length === 2 ? `20${yearText}` : yearText;
  return `${year}-${monthText.padStart(2, '0')}-${dayText.padStart(2, '0')}`;
};

const isoToSapDate = (value) => {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';

  const [, year, month, day] = match;
  return `${day}/${month}/${year.slice(2)}`;
};

const formatAmount = (value, currencyCode = '') => {
  const formatted = Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return currencyCode ? `${currencyCode} ${formatted}` : formatted;
};

const formatPeriodAmount = (value, currencyCode = '') => {
  if (Math.abs(Number(value || 0)) < 0.005) {
    return '';
  }

  return formatAmount(value, currencyCode);
};

const formatQuantity = (value) => Number(value || 0).toFixed(3);

const getEnabledExportCriteriaRows = (dateRanges = {}) =>
  Object.entries(EXPORT_DATE_LABELS)
    .map(([key, label]) => {
      const range = dateRanges?.[key];
      if (!range?.enabled) {
        return null;
      }

      return {
        label,
        from: String(range.from || '').trim(),
        to: String(range.to || '').trim(),
      };
    })
    .filter(Boolean);

const getExportDocumentLabel = (documentType) =>
  EXPORT_DOCUMENT_LABELS[documentType] || 'Sales Documents';

const buildCriteriaPayload = (state) => ({
  activeTab: state.activeTab,
  periodType: state.periodType,
  documentType: state.documentType,
  displayMode: state.displayMode,
  customerTotals: state.customerTotals,
  itemTotals: state.itemTotals,
  displayInSystemCurrency: state.displayInSystemCurrency,
  dateRanges: Object.fromEntries(
    Object.entries(state.dateRanges).map(([key, range]) => [
      key,
      {
        ...range,
        from: parseSapDateToIso(range.from),
        to: parseSapDateToIso(range.to),
      },
    ]),
  ),
  customerSelection: state.customerSelection,
  itemSelection: state.itemSelection,
  salesEmployeeSelection: state.salesEmployeeSelection,
});

const createInitialState = () => ({
  activeTab: 'customers',
  periodType: 'annual',
  documentType: 'invoices',
  displayMode: 'individual',
  customerTotals: 'customer',
  itemTotals: 'none',
  dateRanges: {
    postingDate: { enabled: true, from: '01/04/24', to: '25/05/24' },
    dueDate: { enabled: false, from: '01/04/22', to: '31/03/23' },
    documentDate: { enabled: false, from: '', to: '' },
  },
  customerSelection: {
    codeFrom: '',
    codeTo: '',
    group: 'All',
    propertyMode: 'Ignore',
    propertyFilter: {
      ignoreProperties: true,
      linkMode: 'and',
      exactlyMatch: false,
      selectedPropertyNumbers: [],
    },
  },
  itemSelection: {
    codeFrom: 'M0001',
    codeTo: 'M0001',
    group: 'All',
    propertyMode: 'Ignore',
    secondarySelection: false,
    secondaryCustomerSelection: {
      codeFrom: '',
      codeTo: '',
      group: 'All',
      propertyMode: 'Ignore',
      propertyFilter: {
        ignoreProperties: true,
        linkMode: 'and',
        exactlyMatch: false,
        selectedPropertyNumbers: [],
      },
    },
    secondarySalesEmployeeSelection: {
      codeFrom: '',
      codeTo: '',
      calculateBySalespersonPerRow: false,
      includeInactive: false,
    },
    propertyFilter: {
      ignoreProperties: true,
      linkMode: 'and',
      exactlyMatch: false,
      selectedPropertyNumbers: [],
    },
  },
  salesEmployeeSelection: {
    codeFrom: '',
    codeTo: '',
    includeInactive: false,
  },
  displayInSystemCurrency: true,
});

function SalesAnalysisReportPage() {
  const navigate = useNavigate();
  const { closeActiveAndRestorePrevious } = useSapWindowTaskbarActions();
  const { company } = useAuth();
  const [formState, setFormState] = useState(createInitialState);
  const [statusMessage, setStatusMessage] = useState('');
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [reportResult, setReportResult] = useState(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailReport, setDetailReport] = useState(null);
  const [detailGraphType, setDetailGraphType] = useState('bar');
  const [printDiagram, setPrintDiagram] = useState(false);
  const [showCustomerLookup, setShowCustomerLookup] = useState(false);
  const [showItemLookup, setShowItemLookup] = useState(false);
  const [showSalesEmployeeLookup, setShowSalesEmployeeLookup] = useState(false);
  const [activeCustomerLookupTarget, setActiveCustomerLookupTarget] = useState('customerSelection');
  const [activeCustomerLookupField, setActiveCustomerLookupField] = useState('codeFrom');
  const [activeItemLookupField, setActiveItemLookupField] = useState('codeFrom');
  const [activeSalesEmployeeLookupTarget, setActiveSalesEmployeeLookupTarget] = useState({
    section: 'salesEmployeeSelection',
    field: 'codeFrom',
  });
  const [activePropertiesTarget, setActivePropertiesTarget] = useState('');
  const [itemProperties, setItemProperties] = useState(DEFAULT_ITEM_PROPERTIES);
  const [customerGroups, setCustomerGroups] = useState([{ code: '', name: 'All' }]);
  const [itemGroups, setItemGroups] = useState([{ code: '', name: 'All' }]);
  const dateNativeInputRefs = useRef({});
  const criteriaWindow = useFloatingWindow({
    isOpen: true,
    defaultTop: 22,
    taskId: 'sales-analysis-criteria',
    taskTitle: 'Sales Analysis Report - Selection Criteria',
    taskPath: '/reports/sales/analysis',
    bounds: 'parent',
  });
  const reportWindow = useFloatingWindow({
    isOpen: Boolean(reportResult),
    defaultTop: 12,
    taskId: 'sales-analysis-report',
    taskTitle: reportResult?.reportTitle || 'Sales Analysis Report',
    taskPath: '/reports/sales/analysis',
    bounds: 'parent',
  });

  const currentSelectionLabel =
    formState.activeTab === 'customers'
      ? 'Customer'
      : formState.activeTab === 'items'
        ? 'Item'
        : 'Sales Employee';

  useEffect(() => {
    let ignore = false;

    const loadItemProperties = async () => {
      try {
        const response = await fetchItemProperties();
        if (!ignore && Array.isArray(response) && response.length) {
          setItemProperties(
            response.map((property, index) => ({
              number: Number(property.number || index + 1),
              name: property.name || `Item Property ${index + 1}`,
            })),
          );
        }
      } catch (_error) {
        if (!ignore) {
          setItemProperties(DEFAULT_ITEM_PROPERTIES);
        }
      }
    };

    loadItemProperties();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    const loadItemGroups = async () => {
      try {
        const response = await fetchItemGroups();
        if (!ignore) {
          const normalizedGroups = Array.isArray(response)
            ? response
              .filter((group) => String(group?.name || '').trim())
              .map((group) => ({
                code: String(group.code || '').trim(),
                name: String(group.name || '').trim(),
              }))
            : [];

          setItemGroups(normalizedGroups.length ? normalizedGroups : [{ code: '', name: 'All' }]);
        }
      } catch (_error) {
        if (!ignore) {
          setItemGroups([{ code: '', name: 'All' }]);
        }
      }
    };

    loadItemGroups();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    const loadCustomerGroups = async () => {
      try {
        const response = await fetchBPGroups();
        if (!ignore) {
          const normalizedGroups = Array.isArray(response)
            ? response
              .filter((group) => String(group?.name || '').trim())
              .map((group) => ({
                code: String(group.code || '').trim(),
                name: String(group.name || '').trim(),
              }))
            : [];

          setCustomerGroups(normalizedGroups.length ? normalizedGroups : [{ code: '', name: 'All' }]);
        }
      } catch (_error) {
        if (!ignore) {
          setCustomerGroups([{ code: '', name: 'All' }]);
        }
      }
    };

    loadCustomerGroups();
    return () => {
      ignore = true;
    };
  }, []);

  const updateDateRange = (key, field, value) => {
    setFormState((current) => ({
      ...current,
      dateRanges: {
        ...current.dateRanges,
        [key]: {
          ...current.dateRanges[key],
          [field]: value,
        },
      },
    }));
  };

  const updateSelection = (section, field, value) => {
    setFormState((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: value,
      },
    }));
  };

  const updateNestedSelection = (section, nestedSection, field, value) => {
    setFormState((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [nestedSection]: {
          ...current[section][nestedSection],
          [field]: value,
        },
      },
    }));
  };

  const handleCancel = () => {
    setFormState(createInitialState());
    setReportResult(null);
    setStatusMessage('Selection criteria reset to the default SAP-style values.');
  };

  const handleOk = async () => {
    setIsLoadingReport(true);
    setStatusMessage('');

    try {
      const payload = buildCriteriaPayload(formState);
      let response;

      if (formState.activeTab === 'items') {
        response = await fetchItemSalesAnalysisReport(payload);
      } else if (formState.activeTab === 'salesEmployees') {
        response = await fetchSalesEmployeeSalesAnalysisReport(payload);
      } else {
        response = await fetchCustomerSalesAnalysisReport(payload);
      }

      setReportResult(response);
      setStatusMessage('');
      if (!criteriaWindow.isMinimized) {
        criteriaWindow.toggleMinimize();
      }
    } catch (error) {
      const selectionType =
        formState.activeTab === 'items'
          ? 'item'
          : formState.activeTab === 'salesEmployees'
            ? 'sales employee'
            : 'customer';

      setStatusMessage(
        error?.response?.data?.message
          || `Could not load Sales Analysis report for the selected ${selectionType} criteria.`,
      );
    } finally {
      setIsLoadingReport(false);
    }
  };

  const handleBackToCriteria = () => {
    setReportResult(null);
    setDetailReport(null);
    setStatusMessage('');
    if (criteriaWindow.isMinimized) {
      criteriaWindow.toggleMinimize();
    }
  };

  const handleCloseCriteriaWindow = () => {
    if (closeActiveAndRestorePrevious()) return;
    navigate('/dashboard');
  };

  const handleCloseReportWindow = () => {
    setReportResult(null);
    setDetailReport(null);
    if (criteriaWindow.isMinimized) {
      criteriaWindow.toggleMinimize();
    }
  };

  const handleMinimizeCriteriaWindow = () => {
    criteriaWindow.toggleMinimize();
    navigate('/dashboard');
  };

  const handleMinimizeReportWindow = () => {
    reportWindow.toggleMinimize();
    navigate('/dashboard');
  };

  const buildSummaryExportConfig = () => {
    if (!reportResult) {
      return null;
    }

    const exportBase = {
      companyName: company?.companyName || 'SAP Business One',
      reportTitle: reportResult?.reportTitle || 'Sales Analysis Report',
      documentLabel: getExportDocumentLabel(formState.documentType),
      criteriaRows: getEnabledExportCriteriaRows(formState.dateRanges),
      fileName: reportResult?.reportTitle || 'Sales Analysis Report',
    };

    if (reportResult?.reportKind === 'itemSummary') {
      return {
        ...exportBase,
        columns: [
          { label: '#', align: 'center' },
          { label: 'Item No.', align: 'left' },
          { label: 'Item Description', align: 'left' },
          { label: 'Quantity', align: 'right' },
          { label: 'Sales Amt', align: 'right' },
        ],
        rows: (reportResult.rows || []).map((row) => ([
          { value: row.rowNumber, align: 'center' },
          row.itemCode,
          row.itemName,
          { value: formatQuantity(row.quantity), align: 'right' },
          { value: formatAmount(row.salesAmount, reportResult.currencyCode), align: 'right' },
        ])),
        footer: [
          { value: '', colSpan: 2 },
          reportResult?.totals?.itemCount || 0,
          { value: formatQuantity(reportResult?.totals?.quantity), align: 'right' },
          { value: formatAmount(reportResult?.totals?.salesAmount, reportResult.currencyCode), align: 'right' },
        ],
      };
    }

    if (reportResult?.reportKind === 'salesEmployeeSummary') {
      return {
        ...exportBase,
        columns: [
          { label: '#', align: 'center' },
          { label: 'Sales Employee', align: 'left' },
          { label: reportResult?.rowLabel || 'A/R Invoice', align: 'right' },
          { label: `Total ${reportResult?.rowLabel || 'A/R Invoice'}`, align: 'right' },
          { label: 'Gross Profit', align: 'right' },
          { label: 'Gross Profit %', align: 'right' },
          { label: 'Total Open IN', align: 'right' },
        ],
        rows: (reportResult.rows || []).map((row) => ([
          { value: row.rowNumber, align: 'center' },
          row.salesEmployeeName || '-No Sales Employee -',
          { value: row.documentCount, align: 'right' },
          { value: formatAmount(row.totalAmount, reportResult.currencyCode), align: 'right' },
          { value: formatAmount(row.grossProfit, reportResult.currencyCode), align: 'right' },
          { value: Number(row.grossProfitPercent || 0).toFixed(3), align: 'right' },
          { value: formatAmount(row.openAmount, reportResult.currencyCode), align: 'right' },
        ])),
        footer: [
          { value: '', colSpan: 2 },
          { value: reportResult?.totals?.documentCount || 0, align: 'right' },
          { value: formatAmount(reportResult?.totals?.totalAmount, reportResult.currencyCode), align: 'right' },
          { value: formatAmount(reportResult?.totals?.grossProfit, reportResult.currencyCode), align: 'right' },
          { value: Number(reportResult?.totals?.grossProfitPercent || 0).toFixed(3), align: 'right' },
          { value: formatAmount(reportResult?.totals?.openAmount, reportResult.currencyCode), align: 'right' },
        ],
      };
    }

    if (reportResult?.reportLayout === 'period') {
      const periodColumns = Array.isArray(reportResult?.periodColumns) ? reportResult.periodColumns : [];

      return {
        ...exportBase,
        columns: [
          { label: '#', align: 'center' },
          { label: reportResult?.dimensionCodeLabel || 'Customer Code', align: 'left' },
          { label: reportResult?.dimensionNameLabel || 'Customer Name', align: 'left' },
          { label: reportResult?.annualTotalLabel || 'Annual Total', align: 'right' },
          ...periodColumns.map((column) => ({ label: column.label, align: 'right' })),
        ],
        rows: (reportResult.rows || []).map((row) => ([
          { value: row.rowNumber, align: 'center' },
          row.code,
          row.name,
          { value: formatAmount(row.annualTotal, reportResult.currencyCode), align: 'right' },
          ...periodColumns.map((column) => ({
            value: formatPeriodAmount(row.periodValues?.[column.key], reportResult.currencyCode),
            align: 'right',
          })),
        ])),
        footer: [
          { value: reportResult?.totals?.rowCount || 0, colSpan: 3 },
          { value: formatAmount(reportResult?.totals?.annualTotal, reportResult.currencyCode), align: 'right' },
          ...periodColumns.map((column) => ({
            value: formatPeriodAmount(reportResult?.totals?.periodTotals?.[column.key], reportResult.currencyCode),
            align: 'right',
          })),
        ],
      };
    }

    return {
      ...exportBase,
      columns: [
        { label: '#', align: 'center' },
        { label: reportResult?.dimensionCodeLabel || 'Customer Code', align: 'left' },
        { label: reportResult?.dimensionNameLabel || 'Customer Name', align: 'left' },
        { label: reportResult?.rowLabel || 'A/R Invoice', align: 'right' },
        { label: `Total ${reportResult?.rowLabel || 'A/R Invoice'}`, align: 'right' },
        { label: 'Gross Profit', align: 'right' },
        { label: 'Gross Profit %', align: 'right' },
        { label: 'Total Open IN', align: 'right' },
      ],
      rows: (reportResult.rows || []).map((row) => ([
        { value: row.rowNumber, align: 'center' },
        row.code,
        row.name,
        { value: row.documentCount, align: 'right' },
        { value: formatAmount(row.totalAmount, reportResult.currencyCode), align: 'right' },
        { value: formatAmount(row.grossProfit, reportResult.currencyCode), align: 'right' },
        { value: Number(row.grossProfitPercent || 0).toFixed(3), align: 'right' },
        { value: formatAmount(row.openAmount, reportResult.currencyCode), align: 'right' },
      ])),
      footer: [
        { value: reportResult?.totals?.customerCount || 0, colSpan: 3 },
        { value: reportResult?.totals?.documentCount || 0, align: 'right' },
        { value: formatAmount(reportResult?.totals?.totalAmount, reportResult.currencyCode), align: 'right' },
        { value: formatAmount(reportResult?.totals?.grossProfit, reportResult.currencyCode), align: 'right' },
        { value: Number(reportResult?.totals?.grossProfitPercent || 0).toFixed(3), align: 'right' },
        { value: formatAmount(reportResult?.totals?.openAmount, reportResult.currencyCode), align: 'right' },
      ],
    };
  };

  const handleExportSummaryExcel = () => {
    try {
      const config = buildSummaryExportConfig();
      if (!config) return;
      exportReportAsExcel(config);
    } catch (error) {
      setStatusMessage(error?.message || 'Could not export the report to Excel.');
    }
  };

  const handleExportSummaryPdf = () => {
    try {
      const config = buildSummaryExportConfig();
      if (!config) return;
      exportReportAsPdf(config);
    } catch (error) {
      setStatusMessage(error?.message || 'Could not export the report to PDF.');
    }
  };

  const renderReportFooter = () => (
    <div className="sales-analysis-report__footer">
      <button
        type="button"
        className="sales-analysis-report__back-btn"
        onClick={handleBackToCriteria}
        aria-label="Back to criteria"
      >
        &lt;
      </button>
      <div className="sales-analysis-report__action-group">
        <button
          type="button"
          className="sales-analysis__sap-btn sales-analysis__sap-btn--secondary"
          onClick={handleExportSummaryExcel}
        >
          Export Excel
        </button>
        <button
          type="button"
          className="sales-analysis__sap-btn sales-analysis__sap-btn--secondary"
          onClick={handleExportSummaryPdf}
        >
          Export PDF
        </button>
        <button
          type="button"
          className="sales-analysis__sap-btn"
          onClick={handleBackToCriteria}
        >
          OK
        </button>
      </div>
    </div>
  );

  const handleReportRowDoubleClick = async (row) => {
    if (!reportResult?.allowDetailDrilldown || row?.canOpenDetail === false || !row?.customerCode) {
      setStatusMessage('Detailed drilldown is available only for Individual Display with Total by Customer.');
      return;
    }

    setIsLoadingDetail(true);
    setDetailGraphType('bar');
    setPrintDiagram(false);
    setDetailReport({
      reportTitle: 'Sales Analysis Report by Customer (Detailed)',
      rows: [],
      totals: {},
      currencyCode: reportResult?.currencyCode || '',
    });

    try {
      const response = await fetchCustomerSalesAnalysisDetailReport(
        buildCriteriaPayload(formState),
        row.customerCode,
      );
      setDetailReport(response);
    } catch (error) {
      setDetailReport(null);
      setStatusMessage(
        error?.response?.data?.message || `Could not load the detailed report for ${row.customerCode}.`,
      );
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleOpenBusinessPartner = (customerCode) => {
    const normalizedCardCode = String(customerCode || '').trim();
    if (!normalizedCardCode) {
      return;
    }

    navigate(`/business-partner?cardCode=${encodeURIComponent(normalizedCardCode)}`);
  };

  const handleOpenInvoiceDocument = (row) => {
    const docEntry = Number(row?.docEntry || 0);
    if (!docEntry) {
      return;
    }

    navigate('/ar-invoice', {
      state: {
        arInvoiceDocEntry: docEntry,
      },
    });
  };

  const handleCustomerSelect = (businessPartner) => {
    const targetSelection = activeCustomerLookupTarget || 'customerSelection';
    const targetField = activeCustomerLookupField || 'codeFrom';
    const selectedCode = String(businessPartner?.CardCode || '');

    setFormState((current) => ({
      ...current,
      ...(targetSelection === 'secondaryCustomerSelection'
        ? {
          itemSelection: {
            ...current.itemSelection,
            secondaryCustomerSelection: {
              ...current.itemSelection.secondaryCustomerSelection,
              [targetField]: selectedCode,
            },
          },
        }
        : {
          customerSelection: {
            ...current.customerSelection,
            [targetField]: selectedCode,
          },
        }),
    }));
    setStatusMessage(
      `Customer ${businessPartner?.CardCode || ''}${businessPartner?.CardName ? ` - ${businessPartner.CardName}` : ''} selected for Sales Analysis.`,
    );
    setActiveCustomerLookupTarget('customerSelection');
    setActiveCustomerLookupField('codeFrom');
  };

  const handleItemSelect = (item) => {
    const targetField = activeItemLookupField || 'codeFrom';
    const selectedCode = String(item?.ItemCode || '');

    setFormState((current) => ({
      ...current,
      itemSelection: {
        ...current.itemSelection,
        [targetField]: selectedCode,
      },
    }));
    setStatusMessage(
      `Item ${selectedCode}${item?.ItemName ? ` - ${item.ItemName}` : ''} selected for Sales Analysis.`,
    );
    setActiveItemLookupField('codeFrom');
  };

  const handleSalesEmployeeSelect = (salesEmployee) => {
    const target = activeSalesEmployeeLookupTarget || {
      section: 'salesEmployeeSelection',
      field: 'codeFrom',
    };
    const selectedCode = String(salesEmployee?.code || '');

    if (target.section === 'secondarySalesEmployeeSelection') {
      updateNestedSelection('itemSelection', 'secondarySalesEmployeeSelection', target.field, selectedCode);
    } else {
      updateSelection('salesEmployeeSelection', target.field, selectedCode);
    }

    setStatusMessage(
      `Sales Employee ${salesEmployee?.name || selectedCode}${selectedCode ? ` (${selectedCode})` : ''} selected for Sales Analysis.`,
    );
    setActiveSalesEmployeeLookupTarget({
      section: 'salesEmployeeSelection',
      field: 'codeFrom',
    });
  };

  const buildPropertySummary = (propertyFilter, availableProperties, fallbackPrefix) => {
    if (!propertyFilter || propertyFilter.ignoreProperties) {
      return 'Ignore';
    }

    const selectedNumbers = Array.isArray(propertyFilter.selectedPropertyNumbers)
      ? propertyFilter.selectedPropertyNumbers
      : [];

    if (!selectedNumbers.length) {
      return 'None';
    }

    const propertyNameLookup = new Map(
      (availableProperties || []).map((property, index) => [
        Number(property.number || index + 1),
        property.name || `${fallbackPrefix} ${index + 1}`,
      ]),
    );

    const preview = selectedNumbers
      .slice(0, 2)
      .map((number) => propertyNameLookup.get(Number(number)) || `${fallbackPrefix} ${number}`)
      .join(', ');

    const suffix = selectedNumbers.length > 2 ? ` +${selectedNumbers.length - 2}` : '';
    return `${propertyFilter.linkMode === 'or' ? 'Or' : 'And'}: ${preview}${suffix}`;
  };

  const customerPropertiesSummary = useMemo(
    () =>
      buildPropertySummary(
        formState.customerSelection.propertyFilter,
        DEFAULT_BP_PROPERTIES,
        'Business Partners Property',
      ),
    [formState.customerSelection.propertyFilter],
  );

  const secondaryCustomerPropertiesSummary = useMemo(
    () =>
      buildPropertySummary(
        formState.itemSelection.secondaryCustomerSelection.propertyFilter,
        DEFAULT_BP_PROPERTIES,
        'Business Partners Property',
      ),
    [formState.itemSelection.secondaryCustomerSelection.propertyFilter],
  );

  const itemPropertiesSummary = useMemo(
    () =>
      buildPropertySummary(
        formState.itemSelection.propertyFilter,
        itemProperties,
        'Item Property',
      ),
    [formState.itemSelection.propertyFilter, itemProperties],
  );

  const handlePropertiesSave = (selectionKey, propertyFilter) => {
    const summary =
      selectionKey === 'customerSelection'
        ? buildPropertySummary(propertyFilter, DEFAULT_BP_PROPERTIES, 'Business Partners Property')
        : selectionKey === 'secondaryCustomerSelection'
          ? buildPropertySummary(propertyFilter, DEFAULT_BP_PROPERTIES, 'Business Partners Property')
        : buildPropertySummary(propertyFilter, itemProperties, 'Item Property');

    setFormState((current) => ({
      ...current,
      ...(selectionKey === 'secondaryCustomerSelection'
        ? {
          itemSelection: {
            ...current.itemSelection,
            secondaryCustomerSelection: {
              ...current.itemSelection.secondaryCustomerSelection,
              propertyFilter,
              propertyMode: summary,
            },
          },
        }
        : {
          [selectionKey]: {
            ...current[selectionKey],
            propertyFilter,
            propertyMode: summary,
          },
        }),
    }));

    setStatusMessage(
      `${selectionKey === 'itemSelection' ? 'Item' : 'Customer'} properties updated for Sales Analysis.`,
    );
  };

  const getDateNativeInputRef = (key, field) => (node) => {
    dateNativeInputRefs.current[`${key}-${field}`] = node;
  };

  const openDatePicker = (key, field) => {
    const input = dateNativeInputRefs.current[`${key}-${field}`];
    if (!input) return;

    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.focus();
      input.click();
    }
  };

  const renderDateRow = (key, label) => {
    const range = formState.dateRanges[key];

    const renderDatePickerButton = (field) => (
      <React.Fragment key={field}>
        <SapDateInput
          ref={getDateNativeInputRef(key, field)}
          
          className="sales-analysis__date-native-input"
          tabIndex={-1}
          value={parseSapDateToIso(range[field])}
          onChange={(event) => updateDateRange(key, field, isoToSapDate(event.target.value))}
        />
        <button
          type="button"
          className="sales-analysis__picker-btn"
          aria-label={`Open ${field === 'from' ? 'From' : 'To'} date picker`}
          onClick={() => openDatePicker(key, field)}
        >
          ...
        </button>
      </React.Fragment>
    );

    return (
      <div className="sales-analysis__date-row" key={key}>
        <label className="sales-analysis__checkbox-line">
          <input
            type="checkbox"
            checked={range.enabled}
            onChange={(event) => updateDateRange(key, 'enabled', event.target.checked)}
          />
          <span>{label}</span>
        </label>

        <div className="sales-analysis__date-fields">
          <span className="sales-analysis__field-label">From</span>
          <input
            type="text"
            value={range.from}
            onChange={(event) => updateDateRange(key, 'from', event.target.value)}
          />
          {renderDatePickerButton('from')}
          <span className="sales-analysis__field-label">To</span>
          <input
            type="text"
            value={range.to}
            onChange={(event) => updateDateRange(key, 'to', event.target.value)}
          />
          {renderDatePickerButton('to')}
        </div>
      </div>
    );
  };

  const renderSelectionGrid = ({
    rowLabel,
    selection,
    selectionKey,
    groupOptions,
    propertiesSummary,
    enableLookup = false,
    nestedSection = '',
    enableToLookup = false,
  }) => {
    const updateField = (field, value) => {
      if (nestedSection) {
        updateNestedSelection('itemSelection', nestedSection, field, value);
        return;
      }

      updateSelection(selectionKey, field, value);
    };

    return (
      <div className="sales-analysis__selection-grid">
        <div className="sales-analysis__selection-row-label">{rowLabel}</div>
        <div>
          <div className="sales-analysis__column-head">Code From</div>
          <div className="sales-analysis__lookup-wrap">
            <input
              type="text"
              value={selection.codeFrom}
              onChange={(event) => updateField('codeFrom', event.target.value)}
            />
            <button
              type="button"
              className="sales-analysis__lookup-btn"
              aria-label="Lookup code"
              onClick={() => {
                if (!enableLookup) {
                  return;
                }

                if (selectionKey === 'itemSelection') {
                  setActiveItemLookupField('codeFrom');
                  setShowItemLookup(true);
                } else {
                  setActiveCustomerLookupField('codeFrom');
                  setActiveCustomerLookupTarget(selectionKey);
                  setShowCustomerLookup(true);
                }
              }}
              disabled={!enableLookup}
            >
              ...
            </button>
          </div>
        </div>
        <div>
          <div className="sales-analysis__column-head">To</div>
          {enableToLookup ? (
            <div className="sales-analysis__lookup-wrap">
              <input
                type="text"
                value={selection.codeTo}
                onChange={(event) => updateField('codeTo', event.target.value)}
              />
              <button
                type="button"
                className="sales-analysis__lookup-btn"
                aria-label="Lookup to code"
                onClick={() => {
                  if (selectionKey === 'itemSelection') {
                    setActiveItemLookupField('codeTo');
                    setShowItemLookup(true);
                  } else {
                    setActiveCustomerLookupField('codeTo');
                    setActiveCustomerLookupTarget(selectionKey);
                    setShowCustomerLookup(true);
                  }
                }}
              >
                ...
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={selection.codeTo}
              onChange={(event) => updateField('codeTo', event.target.value)}
            />
          )}
        </div>
        <div>
          <div className="sales-analysis__column-head">Group</div>
          <select
            value={selection.group}
            onChange={(event) => updateField('group', event.target.value)}
          >
            {groupOptions.map((option) => (
              <option value={String(option.code || 'All')} key={`${option.code}-${option.name}`}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="sales-analysis__column-head sales-analysis__column-head--blank">&nbsp;</div>
          <button
            type="button"
            className="sales-analysis__sap-btn sales-analysis__sap-btn--field"
            onClick={() => setActivePropertiesTarget(selectionKey)}
          >
            Properties
          </button>
        </div>
        <div>
          <div className="sales-analysis__column-head">Properties</div>
          <input
            type="text"
            value={propertiesSummary}
            readOnly
          />
        </div>
      </div>
    );
  };

  const renderMainSelection = () => {
    if (formState.activeTab === 'salesEmployees') {
      return (
        <>
          <div className="sales-analysis__selection-grid sales-analysis__selection-grid--employees">
            <div className="sales-analysis__selection-row-label">{currentSelectionLabel}</div>
            <div>
              <div className="sales-analysis__column-head">Code From</div>
              <div className="sales-analysis__lookup-wrap">
                <input
                  type="text"
                  value={formState.salesEmployeeSelection.codeFrom}
                  onChange={(event) => updateSelection('salesEmployeeSelection', 'codeFrom', event.target.value)}
                />
                <button
                  type="button"
                  className="sales-analysis__lookup-btn"
                  aria-label="Lookup sales employee from"
                  onClick={() => {
                    setActiveSalesEmployeeLookupTarget({
                      section: 'salesEmployeeSelection',
                      field: 'codeFrom',
                    });
                    setShowSalesEmployeeLookup(true);
                  }}
                >
                  ...
                </button>
              </div>
            </div>
            <div>
              <div className="sales-analysis__column-head">To</div>
              <div className="sales-analysis__lookup-wrap">
                <input
                  type="text"
                  value={formState.salesEmployeeSelection.codeTo}
                  onChange={(event) => updateSelection('salesEmployeeSelection', 'codeTo', event.target.value)}
                />
                <button
                  type="button"
                  className="sales-analysis__lookup-btn"
                  aria-label="Lookup sales employee to"
                  onClick={() => {
                    setActiveSalesEmployeeLookupTarget({
                      section: 'salesEmployeeSelection',
                      field: 'codeTo',
                    });
                    setShowSalesEmployeeLookup(true);
                  }}
                >
                  ...
                </button>
              </div>
            </div>
          </div>

          <label className="sales-analysis__checkbox-line sales-analysis__sub-check">
            <input
              type="checkbox"
              checked={formState.salesEmployeeSelection.includeInactive}
              onChange={(event) =>
                updateSelection('salesEmployeeSelection', 'includeInactive', event.target.checked)
              }
            />
            <span>Include Inactive Sales Employee</span>
          </label>
        </>
      );
    }

    const selectionKey =
      formState.activeTab === 'customers' ? 'customerSelection' : 'itemSelection';
    const selection = formState[selectionKey];
    const groupOptions =
      selectionKey === 'customerSelection'
        ? customerGroups
        : itemGroups;

    return (
      <>
        {renderSelectionGrid({
          rowLabel: currentSelectionLabel,
          selection,
          selectionKey,
          groupOptions,
          propertiesSummary:
            selectionKey === 'customerSelection'
              ? customerPropertiesSummary
              : itemPropertiesSummary,
          enableLookup: formState.activeTab === 'customers' || selectionKey === 'itemSelection',
          enableToLookup: formState.activeTab === 'customers' || selectionKey === 'itemSelection',
        })}

        {formState.activeTab === 'items' ? (
          <>
            <label className="sales-analysis__checkbox-line sales-analysis__sub-check">
              <input
                type="checkbox"
                checked={formState.itemSelection.secondarySelection}
                onChange={(event) =>
                  updateSelection('itemSelection', 'secondarySelection', event.target.checked)
                }
              />
              <span>Secondary Selection</span>
            </label>

            {formState.itemSelection.secondarySelection ? (
              <div className="sales-analysis__secondary-block">
                {renderSelectionGrid({
                  rowLabel: 'Customer',
                  selection: formState.itemSelection.secondaryCustomerSelection,
                  selectionKey: 'secondaryCustomerSelection',
                  groupOptions: customerGroups,
                  propertiesSummary: secondaryCustomerPropertiesSummary,
                  enableLookup: true,
                  enableToLookup: true,
                  nestedSection: 'secondaryCustomerSelection',
                })}

                <div className="sales-analysis__selection-grid sales-analysis__selection-grid--secondary-employee">
                  <div className="sales-analysis__selection-row-label">Sales Employee</div>
                  <div>
                    <div className="sales-analysis__lookup-wrap">
                      <input
                        type="text"
                        value={formState.itemSelection.secondarySalesEmployeeSelection.codeFrom}
                        onChange={(event) =>
                          updateNestedSelection(
                            'itemSelection',
                            'secondarySalesEmployeeSelection',
                            'codeFrom',
                            event.target.value,
                          )
                        }
                      />
                      <button
                        type="button"
                        className="sales-analysis__lookup-btn"
                        aria-label="Lookup secondary sales employee from"
                        onClick={() => {
                          setActiveSalesEmployeeLookupTarget({
                            section: 'secondarySalesEmployeeSelection',
                            field: 'codeFrom',
                          });
                          setShowSalesEmployeeLookup(true);
                        }}
                      >
                        ...
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="sales-analysis__lookup-wrap">
                      <input
                        type="text"
                        value={formState.itemSelection.secondarySalesEmployeeSelection.codeTo}
                        onChange={(event) =>
                          updateNestedSelection(
                            'itemSelection',
                            'secondarySalesEmployeeSelection',
                            'codeTo',
                            event.target.value,
                          )
                        }
                      />
                      <button
                        type="button"
                        className="sales-analysis__lookup-btn"
                        aria-label="Lookup secondary sales employee to"
                        onClick={() => {
                          setActiveSalesEmployeeLookupTarget({
                            section: 'secondarySalesEmployeeSelection',
                            field: 'codeTo',
                          });
                          setShowSalesEmployeeLookup(true);
                        }}
                      >
                        ...
                      </button>
                    </div>
                  </div>
                  <div className="sales-analysis__secondary-checkbox-wrap">
                    <label className="sales-analysis__checkbox-line sales-analysis__checkbox-line--compact">
                      <input
                        type="checkbox"
                        checked={formState.itemSelection.secondarySalesEmployeeSelection.calculateBySalespersonPerRow}
                        onChange={(event) =>
                          updateNestedSelection(
                            'itemSelection',
                            'secondarySalesEmployeeSelection',
                            'calculateBySalespersonPerRow',
                            event.target.checked,
                          )
                        }
                      />
                      <span>Calculate by Salesperson per Row</span>
                    </label>
                  </div>
                </div>

                <label className="sales-analysis__checkbox-line sales-analysis__checkbox-line--secondary">
                  <input
                    type="checkbox"
                    checked={formState.itemSelection.secondarySalesEmployeeSelection.includeInactive}
                    onChange={(event) =>
                      updateNestedSelection(
                        'itemSelection',
                        'secondarySalesEmployeeSelection',
                        'includeInactive',
                        event.target.checked,
                      )
                    }
                  />
                  <span>Include Inactive Sales Employee</span>
                </label>
              </div>
            ) : null}
          </>
        ) : null}
      </>
    );
  };

  const renderReportView = () => {
    const rows = Array.isArray(reportResult?.rows) ? reportResult.rows : [];
    const totals = reportResult?.totals || {};
    const currencyCode = reportResult?.currencyCode || '';
    const dimensionCodeLabel = reportResult?.dimensionCodeLabel || 'Customer Code';
    const dimensionNameLabel = reportResult?.dimensionNameLabel || 'Customer Name';
    const periodColumns = Array.isArray(reportResult?.periodColumns) ? reportResult.periodColumns : [];

    const reportStyle = {
      ...(reportWindow.windowProps?.style || {}),
    };

    if (reportResult?.reportKind === 'itemSummary') {
      return (
          <div
            className={`sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? ' is-minimized' : ''}${reportWindow.isMaximized ? ' is-maximized' : ''}`}
            {...reportWindow.windowProps}
            style={reportStyle}
          >
            <div className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
              <div className="sales-analysis-window__title sap-report-title">
                {reportResult?.reportTitle || 'Sales Analysis by Items'}
              </div>
              <div className="sales-analysis-window__controls">
                <button
                  type="button"
                  aria-label={reportWindow.isMinimized ? 'Restore' : 'Minimize'}
                  onClick={handleMinimizeReportWindow}
                >
                  {reportWindow.isMinimized ? '□' : '-'}
                </button>
                <button type="button" aria-label={reportWindow.isMaximized ? 'Restore' : 'Maximize'} title={reportWindow.isMaximized ? 'Restore' : 'Maximize'} onClick={reportWindow.toggleMaximize}>[]</button>
                <button type="button" aria-label="Close" onClick={handleCloseReportWindow}>x</button>
              </div>
            </div>

            <div className="sales-analysis-window__accent" />

            {!reportWindow.isMinimized ? (
              <div className="sales-analysis-window__body sales-analysis-window__body--report">
              <div className="sales-analysis-report__hint">
                {reportResult?.reportSubtitle || 'Double-click on row number for a detailed display of all sales'}
              </div>

              <div className="sales-analysis-report__grid-wrap">
                <table className="sales-analysis-report__grid sales-analysis-report__grid--items">
                  <thead>
                    <tr>
                      <th className="is-row-number">#</th>
                      <th>Item No.</th>
                      <th>Item Description</th>
                      <th>Quantity</th>
                      <th>Sales Amt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? (
                      rows.map((row) => (
                        <tr key={`${row.itemCode || 'item'}-${row.rowNumber}`}>
                          <td className="is-row-number">{row.rowNumber}</td>
                          <td>{row.itemCode}</td>
                          <td>{row.itemName}</td>
                          <td className="is-numeric">{Number(row.quantity || 0).toFixed(3)}</td>
                          <td className="is-numeric">{formatAmount(row.salesAmount, currencyCode)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" className="sales-analysis-report__empty">
                          No item records matched the current selection criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {rows.length ? (
                    <tfoot>
                      <tr>
                        <td colSpan="2">&nbsp;</td>
                        <td>{totals.itemCount || 0}</td>
                        <td className="is-numeric">{Number(totals.quantity || 0).toFixed(3)}</td>
                        <td className="is-numeric">{formatAmount(totals.salesAmount, currencyCode)}</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </div>

              {renderReportFooter()}
              </div>
            ) : null}
          </div>
      );
    }

    if (reportResult?.reportKind === 'salesEmployeeSummary') {
      return (
          <div
            className={`sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? ' is-minimized' : ''}${reportWindow.isMaximized ? ' is-maximized' : ''}`}
            {...reportWindow.windowProps}
            style={reportStyle}
          >
            <div className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
              <div className="sales-analysis-window__title sap-report-title">
                {reportResult?.reportTitle || 'Sales Analysis by Sales Employee'}
              </div>
              <div className="sales-analysis-window__controls">
                <button
                  type="button"
                  aria-label={reportWindow.isMinimized ? 'Restore' : 'Minimize'}
                  onClick={handleMinimizeReportWindow}
                >
                  {reportWindow.isMinimized ? '□' : '-'}
                </button>
                <button type="button" aria-label={reportWindow.isMaximized ? 'Restore' : 'Maximize'} title={reportWindow.isMaximized ? 'Restore' : 'Maximize'} onClick={reportWindow.toggleMaximize}>[]</button>
                <button type="button" aria-label="Close" onClick={handleCloseReportWindow}>x</button>
              </div>
            </div>

            <div className="sales-analysis-window__accent" />

            {!reportWindow.isMinimized ? (
              <div className="sales-analysis-window__body sales-analysis-window__body--report">
              <div className="sales-analysis-report__hint">
                {reportResult?.reportSubtitle || 'The report is based on the selected Sales Employee range and date filters.'}
              </div>

              <div className="sales-analysis-report__grid-wrap">
                <table className="sales-analysis-report__grid sales-analysis-report__grid--employee">
                  <thead>
                    <tr>
                      <th className="is-row-number">#</th>
                      <th>Sales Employee</th>
                      <th>{reportResult?.rowLabel || 'A/R Invoice'}</th>
                      <th>Total {reportResult?.rowLabel || 'A/R Invoice'}</th>
                      <th>Gross Profit</th>
                      <th>Gross Profit %</th>
                      <th>Total Open IN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? (
                      rows.map((row) => (
                        <tr key={`${row.salesEmployeeCode ?? 'sales-employee'}-${row.rowNumber}`}>
                          <td className="is-row-number">{row.rowNumber}</td>
                          <td>{row.salesEmployeeName || '-No Sales Employee -'}</td>
                          <td className="is-numeric">{row.documentCount}</td>
                          <td className="is-numeric">{formatAmount(row.totalAmount, currencyCode)}</td>
                          <td className="is-numeric">{formatAmount(row.grossProfit, currencyCode)}</td>
                          <td className="is-numeric">{Number(row.grossProfitPercent || 0).toFixed(3)}</td>
                          <td className="is-numeric">{formatAmount(row.openAmount, currencyCode)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" className="sales-analysis-report__empty">
                          No sales employee records matched the current selection criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="2">&nbsp;</td>
                      <td className="is-numeric">{totals.documentCount || 0}</td>
                      <td className="is-numeric">{formatAmount(totals.totalAmount, currencyCode)}</td>
                      <td className="is-numeric">{formatAmount(totals.grossProfit, currencyCode)}</td>
                      <td className="is-numeric">{Number(totals.grossProfitPercent || 0).toFixed(3)}</td>
                      <td className="is-numeric">{formatAmount(totals.openAmount, currencyCode)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {renderReportFooter()}
              </div>
            ) : null}
          </div>
      );
    }

    if (reportResult?.reportLayout === 'period') {
      return (
          <div
            className={`sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? ' is-minimized' : ''}${reportWindow.isMaximized ? ' is-maximized' : ''}`}
            {...reportWindow.windowProps}
            style={reportStyle}
          >
            <div className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
              <div className="sales-analysis-window__title sap-report-title">
                {reportResult?.reportTitle || 'Sales Analysis by Customer'}
              </div>
              <div className="sales-analysis-window__controls">
                <button
                  type="button"
                  aria-label={reportWindow.isMinimized ? 'Restore' : 'Minimize'}
                  onClick={handleMinimizeReportWindow}
                >
                  {reportWindow.isMinimized ? '□' : '-'}
                </button>
                <button type="button" aria-label={reportWindow.isMaximized ? 'Restore' : 'Maximize'} title={reportWindow.isMaximized ? 'Restore' : 'Maximize'} onClick={reportWindow.toggleMaximize}>[]</button>
                <button type="button" aria-label="Close" onClick={handleCloseReportWindow}>x</button>
              </div>
            </div>

            <div className="sales-analysis-window__accent" />

            {!reportWindow.isMinimized ? (
              <div className="sales-analysis-window__body sales-analysis-window__body--report">
              <div className="sales-analysis-report__hint">
                {reportResult?.reportSubtitle || 'Period summary based on the selected report radio button'}
              </div>

              <div className="sales-analysis-report__grid-wrap">
                <table className="sales-analysis-report__grid sales-analysis-report__grid--period">
                  <thead>
                    <tr>
                      <th className="is-row-number">#</th>
                      <th>{dimensionCodeLabel}</th>
                      <th>{dimensionNameLabel}</th>
                      <th>{reportResult?.annualTotalLabel || 'Annual Total'}</th>
                      {periodColumns.map((column) => (
                        <th key={column.key}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length ? (
                      rows.map((row) => (
                        <tr key={`${row.code || 'row'}-${row.rowNumber}`}>
                          <td
                            className={`is-row-number${reportResult?.allowDetailDrilldown && row?.canOpenDetail !== false ? ' is-clickable' : ''}`}
                            onDoubleClick={() => handleReportRowDoubleClick(row)}
                          >
                            {row.rowNumber}
                          </td>
                          <td>
                            {row.canOpenBusinessPartner ? (
                              <button
                                type="button"
                                className="sales-analysis-report__link-cell"
                                onClick={() => handleOpenBusinessPartner(row.customerCode)}
                              >
                                <span className="sales-analysis-report__link-icon" aria-hidden="true">
                                  ➜
                                </span>
                                <span>{row.code}</span>
                              </button>
                            ) : (
                              <span>{row.code}</span>
                            )}
                          </td>
                          <td>
                            {row.canOpenBusinessPartner ? (
                              <button
                                type="button"
                                className="sales-analysis-report__link-cell"
                                onClick={() => handleOpenBusinessPartner(row.customerCode)}
                              >
                                <span className="sales-analysis-report__link-icon" aria-hidden="true">
                                  ➜
                                </span>
                                <span>{row.name}</span>
                              </button>
                            ) : (
                              <span>{row.name}</span>
                            )}
                          </td>
                          <td className="is-numeric">{formatAmount(row.annualTotal, currencyCode)}</td>
                          {periodColumns.map((column) => (
                            <td className="is-numeric" key={`${row.rowNumber}-${column.key}`}>
                              {formatPeriodAmount(row.periodValues?.[column.key], currencyCode)}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4 + periodColumns.length} className="sales-analysis-report__empty">
                          No customer records matched the current selection criteria.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="3">{totals.rowCount || 0}</td>
                      <td className="is-numeric">{formatAmount(totals.annualTotal, currencyCode)}</td>
                      {periodColumns.map((column) => (
                        <td className="is-numeric" key={`total-${column.key}`}>
                          {formatPeriodAmount(totals.periodTotals?.[column.key], currencyCode)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>

              {renderReportFooter()}
              </div>
            ) : null}
          </div>
      );
    }

    return (
        <div
          className={`sales-analysis-window sales-analysis-window--report sap-report-window${reportWindow.isMinimized ? ' is-minimized' : ''}${reportWindow.isMaximized ? ' is-maximized' : ''}`}
          {...reportWindow.windowProps}
          style={reportStyle}
        >
          <div className="sales-analysis-window__titlebar sap-report-titlebar" {...reportWindow.titleBarProps}>
            <div className="sales-analysis-window__title sap-report-title">
              {reportResult?.reportTitle || 'Sales Analysis by Customer'}
            </div>
            <div className="sales-analysis-window__controls">
              <button
                type="button"
                aria-label={reportWindow.isMinimized ? 'Restore' : 'Minimize'}
                onClick={handleMinimizeReportWindow}
              >
                {reportWindow.isMinimized ? '□' : '-'}
              </button>
              <button type="button" aria-label={reportWindow.isMaximized ? 'Restore' : 'Maximize'} title={reportWindow.isMaximized ? 'Restore' : 'Maximize'} onClick={reportWindow.toggleMaximize}>[]</button>
              <button type="button" aria-label="Close" onClick={handleCloseReportWindow}>x</button>
            </div>
          </div>

          <div className="sales-analysis-window__accent" />

          {!reportWindow.isMinimized ? (
            <div className="sales-analysis-window__body sales-analysis-window__body--report">
            <div className="sales-analysis-report__hint">
              {reportResult?.reportSubtitle || 'Double-click on row number for a detailed report'}
            </div>

            <div className="sales-analysis-report__grid-wrap">
              <table className="sales-analysis-report__grid sales-analysis-report__grid--customer">
                <thead>
                  <tr>
                    <th className="is-row-number">#</th>
                    <th>{dimensionCodeLabel}</th>
                    <th>{dimensionNameLabel}</th>
                    <th>{reportResult?.rowLabel || 'A/R Invoice'}</th>
                    <th>Total {reportResult?.rowLabel || 'A/R Invoice'}</th>
                    <th>Gross Profit</th>
                    <th>Gross Profit %</th>
                    <th>Total Open IN</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.map((row) => (
                      <tr key={row.customerCode || row.rowNumber}>
                        <td
                          className={`is-row-number${reportResult?.allowDetailDrilldown && row?.canOpenDetail !== false ? ' is-clickable' : ''}`}
                          onDoubleClick={() => handleReportRowDoubleClick(row)}
                        >
                          {row.rowNumber}
                        </td>
                        <td>
                          {row.canOpenBusinessPartner ? (
                            <button
                              type="button"
                              className="sales-analysis-report__link-cell"
                              onClick={() => handleOpenBusinessPartner(row.customerCode)}
                            >
                              <span className="sales-analysis-report__link-icon" aria-hidden="true">
                                ➜
                              </span>
                              <span>{row.code}</span>
                            </button>
                          ) : (
                            <span>{row.code}</span>
                          )}
                        </td>
                        <td>
                          {row.canOpenBusinessPartner ? (
                            <button
                              type="button"
                              className="sales-analysis-report__link-cell"
                              onClick={() => handleOpenBusinessPartner(row.customerCode)}
                            >
                              <span className="sales-analysis-report__link-icon" aria-hidden="true">
                                ➜
                              </span>
                              <span>{row.name}</span>
                            </button>
                          ) : (
                            <span>{row.name}</span>
                          )}
                        </td>
                        <td className="is-numeric">{row.documentCount}</td>
                        <td className="is-numeric">{formatAmount(row.totalAmount, currencyCode)}</td>
                        <td className="is-numeric">{formatAmount(row.grossProfit, currencyCode)}</td>
                        <td className="is-numeric">{Number(row.grossProfitPercent || 0).toFixed(3)}</td>
                        <td className="is-numeric">{formatAmount(row.openAmount, currencyCode)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8" className="sales-analysis-report__empty">
                        No customer records matched the current selection criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="3">{totals.customerCount || 0}</td>
                    <td className="is-numeric">{totals.documentCount || 0}</td>
                    <td className="is-numeric">{formatAmount(totals.totalAmount, currencyCode)}</td>
                    <td className="is-numeric">{formatAmount(totals.grossProfit, currencyCode)}</td>
                    <td className="is-numeric">{Number(totals.grossProfitPercent || 0).toFixed(3)}</td>
                    <td className="is-numeric">{formatAmount(totals.openAmount, currencyCode)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {renderReportFooter()}
            </div>
          ) : null}
        </div>
    );
  };

  return (
    <div className="sales-analysis-page sap-report-page" style={{ overflow: 'hidden', position: 'relative', width: '100%', height: '100%' }}>
      <div
        className={`sales-analysis-window sap-report-window${criteriaWindow.isMinimized ? ' is-minimized' : ''}${criteriaWindow.isMaximized ? ' is-maximized' : ''}`}
        {...criteriaWindow.windowProps}
        style={{
          ...(criteriaWindow.windowProps?.style || {}),
        }}
      >
        <div className="sales-analysis-window__titlebar sap-report-titlebar" {...criteriaWindow.titleBarProps}>
          <div className="sales-analysis-window__title sap-report-title">Sales Analysis Report - Selection Criteria</div>
          <div className="sales-analysis-window__controls">
            <button
              type="button"
              aria-label={criteriaWindow.isMinimized ? 'Restore' : 'Minimize'}
              onClick={handleMinimizeCriteriaWindow}
            >
              {criteriaWindow.isMinimized ? '□' : '-'}
            </button>
            <button type="button" aria-label={criteriaWindow.isMaximized ? 'Restore' : 'Maximize'} title={criteriaWindow.isMaximized ? 'Restore' : 'Maximize'} onClick={criteriaWindow.toggleMaximize}>[]</button>
            <button type="button" aria-label="Close" onClick={handleCloseCriteriaWindow}>x</button>
          </div>
        </div>

        <div className="sales-analysis-window__accent" />

        {!criteriaWindow.isMinimized ? (
          <div className="sales-analysis-window__body">
          <div className="sales-analysis-tabs" role="tablist" aria-label="Sales analysis filters">
            {TAB_OPTIONS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={formState.activeTab === tab.id}
                className={`sales-analysis-tabs__tab${formState.activeTab === tab.id ? ' is-active' : ''}`}
                onClick={() => setFormState((current) => ({ ...current, activeTab: tab.id }))}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="sales-analysis-panel">
            <div className="sales-analysis-panel__row">
              <div className="sales-analysis-panel__option-group">
                {PERIOD_OPTIONS.map((option) => (
                  <label className="sales-analysis__radio-line" key={option.value}>
                    <input
                      type="radio"
                      name="periodType"
                      checked={formState.periodType === option.value}
                      onChange={() => setFormState((current) => ({ ...current, periodType: option.value }))}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>

              <div className="sales-analysis-panel__option-group">
                {DOCUMENT_OPTIONS.map((option) => (
                  <label className="sales-analysis__radio-line" key={option.value}>
                    <input
                      type="radio"
                      name="documentType"
                      checked={formState.documentType === option.value}
                      onChange={() => setFormState((current) => ({ ...current, documentType: option.value }))}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>

              {formState.activeTab !== 'salesEmployees' ? (
                <>
                  <div className="sales-analysis-panel__option-group">
                    {DISPLAY_OPTIONS.map((option) => (
                      <label className="sales-analysis__radio-line" key={option.value}>
                        <input
                          type="radio"
                          name="displayMode"
                          checked={formState.displayMode === option.value}
                          onChange={() => setFormState((current) => ({ ...current, displayMode: option.value }))}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>

                  <div className="sales-analysis-panel__option-group">
                    {(formState.activeTab === 'customers' ? CUSTOMER_TOTAL_OPTIONS : ITEM_TOTAL_OPTIONS).map((option) => (
                      <label className="sales-analysis__radio-line" key={option.value}>
                        <input
                          type="radio"
                          name={formState.activeTab === 'customers' ? 'customerTotals' : 'itemTotals'}
                          checked={
                            formState.activeTab === 'customers'
                              ? formState.customerTotals === option.value
                              : formState.itemTotals === option.value
                          }
                          onChange={() =>
                            setFormState((current) => ({
                              ...current,
                              [formState.activeTab === 'customers' ? 'customerTotals' : 'itemTotals']: option.value,
                            }))
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="sales-analysis-divider" />

            <div className="sales-analysis__dates">
              {renderDateRow('postingDate', 'Posting Date')}
              {renderDateRow('dueDate', 'Due Date')}
              {renderDateRow('documentDate', 'Document Date')}
            </div>

            <div className="sales-analysis-divider" />

            <section className="sales-analysis__section">
              <div className="sales-analysis__section-title">Main Selection</div>
              {renderMainSelection()}
            </section>

            <label className="sales-analysis__checkbox-line sales-analysis__system-currency">
              <input
                type="checkbox"
                checked={formState.displayInSystemCurrency}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    displayInSystemCurrency: event.target.checked,
                  }))
                }
              />
              <span>Display Amounts in System Currency</span>
            </label>

            {isLoadingReport ? (
              <div className="sales-analysis__status">Loading Sales Analysis report...</div>
            ) : null}
            {statusMessage ? <div className="sales-analysis__status">{statusMessage}</div> : null}
          </div>

          <div className="sales-analysis-window__footer">
            <button type="button" className="sales-analysis__sap-btn" onClick={handleOk}>
              OK
            </button>
            <button
              type="button"
              className="sales-analysis__sap-btn sales-analysis__sap-btn--secondary"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
          </div>
        ) : null}
      </div>

      {reportResult && renderReportView()}

      <SalesAnalysisDetailModal
        isOpen={Boolean(detailReport)}
        isLoading={isLoadingDetail}
        report={detailReport}
        graphType={detailGraphType}
        onGraphTypeChange={setDetailGraphType}
        printDiagram={printDiagram}
        onPrintDiagramChange={setPrintDiagram}
        companyName={company?.companyName || 'SAP Business One'}
        dateRanges={formState.dateRanges}
        documentLabel={getExportDocumentLabel(formState.documentType)}
        onOpenDocument={handleOpenInvoiceDocument}
        onOpenCustomer={(row) => handleOpenBusinessPartner(row?.customerCode)}
        onExportError={(message) => setStatusMessage(message)}
        onClose={() => {
          setDetailReport(null);
          setIsLoadingDetail(false);
        }}
      />

      <BusinessPartnerLookupModal
        isOpen={showCustomerLookup}
        onClose={() => setShowCustomerLookup(false)}
        onSelect={handleCustomerSelect}
      />

      <ItemLookupModal
        isOpen={showItemLookup}
        onClose={() => setShowItemLookup(false)}
        onSelect={handleItemSelect}
      />

      <SalesEmployeeLookupModal
        isOpen={showSalesEmployeeLookup}
        onClose={() => setShowSalesEmployeeLookup(false)}
        onSelect={handleSalesEmployeeSelect}
      />

      <PropertiesSelectionModal
        isOpen={Boolean(activePropertiesTarget)}
        onClose={() => setActivePropertiesTarget('')}
        onSave={(propertyFilter) => handlePropertiesSave(activePropertiesTarget, propertyFilter)}
        title="Properties"
        propertyLabelPrefix={
          activePropertiesTarget === 'customerSelection' || activePropertiesTarget === 'secondaryCustomerSelection'
            ? 'Business Partners Property'
            : 'Item Property'
        }
        properties={
          activePropertiesTarget === 'customerSelection' || activePropertiesTarget === 'secondaryCustomerSelection'
            ? DEFAULT_BP_PROPERTIES
            : itemProperties
        }
        value={
          activePropertiesTarget === 'secondaryCustomerSelection'
            ? formState.itemSelection.secondaryCustomerSelection.propertyFilter
            : activePropertiesTarget
              ? formState[activePropertiesTarget]?.propertyFilter
              : undefined
        }
      />
    </div>
  );
}

export default SalesAnalysisReportPage;

