import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  createReport,
  createReportMenu,
  fetchAuthorizedReportCodes,
  fetchReportCodeParameters,
  fetchReportDetail,
  fetchReportMenus,
  runReport,
} from '../api/reportStudioApi';
import SapLookupModal from '../components/common/SapLookupModal';
import PdfViewer from '../components/reports-studio/PdfViewer';
import ReportForm from '../components/reports-studio/ReportForm';
import ReportPopupModal from '../components/reports-studio/ReportPopupModal';
import ReportTree from '../components/reports-studio/ReportTree';
import { base64ToPdfBlob } from '../utils/pdfUtils';
import '../styles/report-studio.css';

const buildMenuChoices = (menus, depth = 0) =>
  menus.flatMap((menu) => [
    {
      menuId: menu.menuId,
      label: `${' '.repeat(depth * 2)}${depth ? '> ' : ''}${menu.menuName}`,
    },
    ...buildMenuChoices(menu.children || [], depth + 1),
  ]);

const findSingleReportMenuTarget = (targets = [], menuId) =>
  (targets || []).find((target) => Number(target.menuId) === Number(menuId)) || null;

const normalizeError = (error, fallback) =>
  error?.response?.data?.detail ||
  error?.response?.data?.message ||
  error?.message ||
  fallback;

const initialMenuForm = {
  menuName: '',
  parentId: '',
  sortOrder: '0',
};

const initialReportForm = {
  reportName: '',
  reportCode: '',
  reportMenuId: '',
  apiUrl: '/rs/v1/ExportPDFData',
  reportType: 'GET',
  isPublic: false,
};

const formatDateForInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const shiftMonthsClamped = (date, monthDelta) => {
  const source = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const targetYear = source.getFullYear();
  const targetMonthIndex = source.getMonth() + monthDelta;
  const targetMonthStart = new Date(targetYear, targetMonthIndex, 1);
  const targetMonthEnd = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0);
  const nextDay = Math.min(source.getDate(), targetMonthEnd.getDate());

  return new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), nextDay);
};

const isFromDateParameter = (parameter) => {
  const lookup = `${parameter?.displayName || ''} ${parameter?.paramName || ''}`.toLowerCase();
  return lookup.includes('from date') || lookup.includes('fromdate') || lookup.includes('datefrom') || lookup.includes('start date');
};

const isToDateParameter = (parameter) => {
  const lookup = `${parameter?.displayName || ''} ${parameter?.paramName || ''}`.toLowerCase();
  return lookup.includes('to date') || lookup.includes('todate') || lookup.includes('dateto') || lookup.includes('end date');
};

const isDateParameter = (parameter) =>
  String(parameter?.paramType || '').trim().toLowerCase() === 'date';

const buildInitialRunValues = (parameters = []) => {
  const today = new Date();
  const todayValue = formatDateForInput(today);
  const fromDateValue = formatDateForInput(shiftMonthsClamped(today, -1));
  const nextValues = {};

  parameters.forEach((parameter) => {
    if (parameter.paramType === 'date' && isToDateParameter(parameter)) {
      nextValues[parameter.paramName] = todayValue;
      return;
    }

    if (parameter.paramType === 'date' && isFromDateParameter(parameter)) {
      nextValues[parameter.paramName] = fromDateValue;
      return;
    }

    nextValues[parameter.paramName] = isDateParameter(parameter) ? (parameter.defaultValue || todayValue) : '';
  });

  return nextValues;
};

const isLookupCodeParameter = (parameter) => {
  const identity = `${parameter?.displayName || ''} ${parameter?.paramName || ''}`.toLowerCase();
  return (
    identity.includes('item') ||
    identity.includes('product') ||
    identity.includes('customer') ||
    identity.includes('vendor') ||
    identity.includes('buyer') ||
    identity.includes('seller') ||
    identity.includes('business partner') ||
    identity.includes('card code') ||
    identity.includes('cardcode')
  );
};

const sanitizeRunValues = (parameters = [], values = {}) =>
  parameters.reduce((nextValues, parameter) => {
    const currentValue = values[parameter.paramName];
    if (typeof currentValue === 'string' && isLookupCodeParameter(parameter) && currentValue.includes(' - ')) {
      nextValues[parameter.paramName] = currentValue.split(' - ')[0].trim();
      return nextValues;
    }

    nextValues[parameter.paramName] = currentValue;
    return nextValues;
  }, { ...values });

function ReportsStudioPage() {
  const { menuId: routeMenuId, reportId: routeReportId } = useParams();
  const autoOpenedSidebarReportRef = useRef(null);
  const [catalog, setCatalog] = useState({ menus: [], flatMenus: [] });
  const [expandedMenus, setExpandedMenus] = useState({});
  const [selectedMenuId, setSelectedMenuId] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [reportDetail, setReportDetail] = useState(null);
  const [menuForm, setMenuForm] = useState(initialMenuForm);
  const [reportForm, setReportForm] = useState(initialReportForm);
  const [draftParameters, setDraftParameters] = useState([]);
  const [runValues, setRunValues] = useState({});
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [isReportCodeLookupOpen, setIsReportCodeLookupOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState({ fileName: '', previewUrl: '' });
  const [message, setMessage] = useState({ type: '', text: '' });
  const [loadedParameterCode, setLoadedParameterCode] = useState('');
  const [loading, setLoading] = useState({
    catalog: true,
    detail: false,
    menuSave: false,
    parameterLoad: false,
    reportSave: false,
    reportRun: false,
  });

  const menuOptions = useMemo(() => buildMenuChoices(catalog.menus || []), [catalog.menus]);
  const selectedReport = reportDetail?.report || null;
  const parameters = reportDetail?.parameters || [];
  const previewParameters = selectedReport ? parameters : draftParameters;

  useEffect(() => () => {
    if (pdfPreview.previewUrl) {
      URL.revokeObjectURL(pdfPreview.previewUrl);
    }
  }, [pdfPreview.previewUrl]);

  const applyMessage = (type, text) => setMessage({ type, text });

  const clearPdfPreview = useCallback(() => {
    setPdfPreview((current) => {
      if (current.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return { fileName: '', previewUrl: '' };
    });
    setIsPreviewModalOpen(false);
  }, []);

  const loadCatalog = useCallback(async (preferredSelection = {}) => {
    setLoading((current) => ({ ...current, catalog: true }));

    try {
      const response = await fetchReportMenus();
      setCatalog(response);

      if (preferredSelection.menuId) {
        setSelectedMenuId(preferredSelection.menuId);
      }

      if (preferredSelection.reportId) {
        setSelectedReportId(preferredSelection.reportId);
      }

      if (!preferredSelection.menuId && !preferredSelection.reportId && response.menus?.[0]) {
        setSelectedMenuId((current) => current || response.menus[0].menuId);
      }
    } catch (error) {
      applyMessage('error', normalizeError(error, 'Failed to load report menus.'));
    } finally {
      setLoading((current) => ({ ...current, catalog: false }));
    }
  }, []);

  const loadReport = useCallback(async (reportId) => {
    if (!reportId) return;

    setLoading((current) => ({ ...current, detail: true }));
    try {
      const response = await fetchReportDetail(reportId);
      setReportDetail(response);
      setDraftParameters([]);
      setLoadedParameterCode(response.report?.reportCode || '');
      setSelectedReportId(response.report.reportId);
      setSelectedMenuId(response.report.reportMenuId || null);
      applyMessage('', '');
    } catch (error) {
      applyMessage('error', normalizeError(error, 'Failed to load the selected report.'));
    } finally {
      setLoading((current) => ({ ...current, detail: false }));
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const nextReportId = Number(routeReportId);
    if (Number.isInteger(nextReportId) && nextReportId > 0) {
      if (selectedReportId !== nextReportId) {
        loadReport(nextReportId);
      }
      return;
    }

    const nextMenuId = Number(routeMenuId);
    if (!Number.isInteger(nextMenuId) || nextMenuId <= 0) {
      return;
    }

    const targetMenu = (catalog.flatMenus || []).find((menu) => Number(menu.menuId) === nextMenuId);
    const directReportTarget = findSingleReportMenuTarget(catalog.singleReportMenuTargets, nextMenuId);
    if (!targetMenu && !directReportTarget) {
      return;
    }

    if (directReportTarget) {
      if (selectedReportId !== Number(directReportTarget.reportId)) {
        loadReport(directReportTarget.reportId);
      }
      return;
    }

    if (selectedMenuId === nextMenuId) {
      return;
    }

    clearPdfPreview();
    setSelectedMenuId(nextMenuId);
    setSelectedReportId(null);
    setReportDetail(null);
    setMenuForm((current) => ({
      ...current,
      parentId: String(nextMenuId),
    }));
    setReportForm((current) => ({
      ...current,
      reportMenuId: String(nextMenuId),
    }));
  }, [
    catalog.flatMenus,
    clearPdfPreview,
    loadReport,
    routeMenuId,
    routeReportId,
    catalog.singleReportMenuTargets,
    selectedMenuId,
    selectedReportId,
  ]);

  useEffect(() => {
    const nextReportId = Number(routeReportId);
    const fallbackRouteReportId = Number(
      findSingleReportMenuTarget(catalog.singleReportMenuTargets, routeMenuId)?.reportId,
    );
    const targetReportId = Number.isInteger(nextReportId) && nextReportId > 0
      ? nextReportId
      : (Number.isInteger(fallbackRouteReportId) && fallbackRouteReportId > 0 ? fallbackRouteReportId : null);

    if (!targetReportId) {
      autoOpenedSidebarReportRef.current = null;
      return;
    }

    if (loading.detail || !selectedReport || Number(selectedReport.reportId) !== targetReportId) {
      return;
    }

    if (autoOpenedSidebarReportRef.current === targetReportId) {
      return;
    }

    setRunValues(buildInitialRunValues(parameters));
    setIsRunModalOpen(true);
    autoOpenedSidebarReportRef.current = targetReportId;
  }, [catalog.singleReportMenuTargets, loading.detail, parameters, routeMenuId, routeReportId, selectedReport]);

  const handleMenuSelection = (menu) => {
    clearPdfPreview();
    setSelectedMenuId(menu.menuId);
    setSelectedReportId(null);
    setReportDetail(null);
    setMenuForm((current) => ({
      ...current,
      parentId: String(menu.menuId),
    }));
    setReportForm((current) => ({
      ...current,
      reportMenuId: String(menu.menuId),
    }));
  };

  const loadParametersForReportCode = useCallback(async (rawReportCode, nextMessageOnEmpty = false) => {
    const reportCode = String(rawReportCode || '').trim().toUpperCase();

    if (!reportCode) {
      setDraftParameters([]);
      setLoadedParameterCode('');
      return;
    }

    setLoading((current) => ({ ...current, parameterLoad: true }));

    try {
      const response = await fetchReportCodeParameters(reportCode);
      setDraftParameters(response.parameters || []);
      setLoadedParameterCode(reportCode);
      applyMessage('', '');

      if (!response.parameters?.length && nextMessageOnEmpty) {
        applyMessage('info', 'No parameters were returned for the selected report code.');
      }
    } catch (error) {
      setDraftParameters([]);
      setLoadedParameterCode('');
      applyMessage('error', normalizeError(error, 'Failed to load parameters for the selected report code.'));
    } finally {
      setLoading((current) => ({ ...current, parameterLoad: false }));
    }
  }, []);

  const handleReportFormChange = (key, value) => {
    setReportForm((current) => ({ ...current, [key]: value }));

    if (key === 'reportCode') {
      clearPdfPreview();
      setSelectedReportId(null);
      setReportDetail(null);

      if (String(value || '').trim().toUpperCase() !== loadedParameterCode) {
        setDraftParameters([]);
      }
    }
  };

  const handleReportSelection = async (report) => {
    clearPdfPreview();
    setSelectedReportId(report.reportId);
    setSelectedMenuId(report.reportMenuId || null);
    await loadReport(report.reportId);
  };

  const handleCreateMenu = async () => {
    setLoading((current) => ({ ...current, menuSave: true }));

    try {
      const saved = await createReportMenu({
        menuName: menuForm.menuName,
        parentId: menuForm.parentId || null,
        sortOrder: menuForm.sortOrder || 0,
      });

      await loadCatalog({ menuId: saved.menuId });
      setSelectedMenuId(saved.menuId);
      setMenuForm({
        ...initialMenuForm,
        parentId: String(saved.menuId),
      });
      setReportForm((current) => ({
        ...current,
        reportMenuId: String(saved.menuId),
      }));
      applyMessage('success', 'Report menu created.');
    } catch (error) {
      applyMessage('error', normalizeError(error, 'Failed to create report menu.'));
    } finally {
      setLoading((current) => ({ ...current, menuSave: false }));
    }
  };

  const handleCreateReport = async () => {
    setLoading((current) => ({ ...current, reportSave: true }));

    try {
      const saved = await createReport({
        ...reportForm,
        reportMenuId: reportForm.reportMenuId || selectedMenuId,
        parameters: draftParameters,
      });

      await loadCatalog({
        menuId: saved.report?.reportMenuId,
        reportId: saved.report?.reportId,
      });
      setReportForm({
        ...initialReportForm,
        reportMenuId: saved.report?.reportMenuId ? String(saved.report.reportMenuId) : '',
      });
      clearPdfPreview();
      setReportDetail(saved);
      setDraftParameters(saved.parameters || []);
      setLoadedParameterCode(saved.report?.reportCode || '');
      setSelectedReportId(saved.report?.reportId || null);
      applyMessage('success', 'Report created.');
    } catch (error) {
      applyMessage('error', normalizeError(error, 'Failed to create report.'));
    } finally {
      setLoading((current) => ({ ...current, reportSave: false }));
    }
  };

  const handleOpenRunModal = () => {
    if (!selectedReport) {
      applyMessage('error', 'Select a report first.');
      return;
    }

    setRunValues(buildInitialRunValues(parameters));
    setIsRunModalOpen(true);
  };

  const handleRunReport = async () => {
    if (!selectedReport) return;

    setLoading((current) => ({ ...current, reportRun: true }));
    try {
      const response = await runReport({
        reportId: selectedReport.reportId,
        parameters: sanitizeRunValues(parameters, runValues),
      });

      const blob = base64ToPdfBlob(response.pdfBase64);
      if (pdfPreview.previewUrl) {
        URL.revokeObjectURL(pdfPreview.previewUrl);
      }

      const previewUrl = URL.createObjectURL(blob);
      setPdfPreview({
        fileName: response.fileName || `${selectedReport.reportCode}.pdf`,
        previewUrl,
      });
      setIsRunModalOpen(false);
      setIsPreviewModalOpen(true);
      applyMessage('success', 'Report generated successfully.');
    } catch (error) {
      applyMessage('error', normalizeError(error, 'Failed to run report.'));
    } finally {
      setLoading((current) => ({ ...current, reportRun: false }));
    }
  };

  const openPreviewInNewTab = () => {
    if (!pdfPreview.previewUrl) return;
    window.open(pdfPreview.previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenPreviewModal = () => {
    if (!pdfPreview.previewUrl) {
      applyMessage('info', 'Run a report first to preview the PDF.');
      return;
    }

    setIsPreviewModalOpen(true);
  };

  const loadReportCodeOptions = useCallback(async (query) => {
    const response = await fetchAuthorizedReportCodes(query);
    return response.items || [];
  }, []);

  return (
    <div className="rs-window sap-report-page sap-report-window">
      <div className="rs-window__titlebar sap-report-titlebar">
        <span>Report Layout Manager - SAP B1 Dynamic Report Manager</span>
      </div>

      {message.text ? (
        <div className={`rs-message is-${message.type || 'info'}`}>
          {message.text}
        </div>
      ) : null}

      <div className="rs-window__body">
        <aside className="rs-sidebar">
          <section className="rs-card rs-card--tree">
            <div className="rs-card__header">
              <h3>Report Menus</h3>
              <button type="button" className="rs-btn" onClick={() => loadCatalog()}>
                Refresh
              </button>
            </div>

            {loading.catalog ? (
              <div className="rs-panel__empty">Loading report menus...</div>
            ) : (
              <ReportTree
                menus={catalog.menus}
                expandedMenus={expandedMenus}
                selectedMenuId={selectedMenuId}
                selectedReportId={selectedReportId}
                onToggleMenu={(menuId) =>
                  setExpandedMenus((current) => ({
                    ...current,
                    [menuId]: !current[menuId],
                  }))
                }
                onSelectMenu={handleMenuSelection}
                onSelectReport={handleReportSelection}
              />
            )}
          </section>

          <section className="rs-card">
            <div className="rs-card__header">
              <h3>Create Menu</h3>
              {selectedMenuId ? <span className="rs-badge">Parent Ready</span> : null}
            </div>

            <form
              className="rs-form"
              onSubmit={(event) => {
                event.preventDefault();
                handleCreateMenu();
              }}
            >
              <label className="rs-field">
                <span>Parent Menu</span>
                <select
                  value={menuForm.parentId}
                  onChange={(event) => setMenuForm((current) => ({ ...current, parentId: event.target.value }))}
                >
                  <option value="">Top Level</option>
                  {menuOptions.map((option) => (
                    <option key={option.menuId} value={option.menuId}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rs-field">
                <span>Menu Name</span>
                <input
                  type="text"
                  value={menuForm.menuName}
                  onChange={(event) => setMenuForm((current) => ({ ...current, menuName: event.target.value }))}
                  placeholder="Management Reports"
                />
              </label>

              <label className="rs-field">
                <span>Sort Order</span>
                <input
                  type="number"
                  value={menuForm.sortOrder}
                  onChange={(event) => setMenuForm((current) => ({ ...current, sortOrder: event.target.value }))}
                />
              </label>

              <div className="rs-actions">
                <button type="submit" className="rs-btn rs-btn--primary" disabled={loading.menuSave}>
                  {loading.menuSave ? 'Saving...' : 'Save Menu'}
                </button>
              </div>
            </form>
          </section>
        </aside>

        <main className="rs-main">
          <ReportForm
            menuOptions={menuOptions}
            reportForm={reportForm}
            onChange={handleReportFormChange}
            onSubmit={handleCreateReport}
            isSaving={loading.reportSave}
            selectedReport={selectedReport}
            previewParameters={previewParameters}
            isLoadingParameters={loading.parameterLoad}
            onRun={handleOpenRunModal}
            onPreview={handleOpenPreviewModal}
            canPreview={Boolean(pdfPreview.previewUrl)}
            onReportCodeBlur={() => loadParametersForReportCode(reportForm.reportCode, true)}
            onOpenReportCodeLookup={() => setIsReportCodeLookupOpen(true)}
          />

          {loading.detail ? <div className="rs-inline-status">Loading report detail...</div> : null}
        </main>
      </div>

      <PdfViewer
        fileName={pdfPreview.fileName}
        previewUrl={pdfPreview.previewUrl}
        isOpen={isPreviewModalOpen}
        onClose={() => setIsPreviewModalOpen(false)}
        onOpen={openPreviewInNewTab}
      />

      <ReportPopupModal
        isOpen={isRunModalOpen}
        report={selectedReport}
        parameters={parameters}
        values={runValues}
        isRunning={loading.reportRun}
        onChange={(paramName, value) =>
          setRunValues((current) => ({
            ...current,
            [paramName]: value,
          }))
        }
        onClose={() => setIsRunModalOpen(false)}
        onRun={handleRunReport}
      />

      <SapLookupModal
        open={isReportCodeLookupOpen}
        title="Authorized Report Codes"
        columns={[
          { key: 'code', label: 'Code' },
          { key: 'name', label: 'Name' },
          { key: 'rootName', label: 'Root Name' },
        ]}
        fetchOptions={loadReportCodeOptions}
        initialQuery=""
        onClose={() => setIsReportCodeLookupOpen(false)}
        onSelect={async (row) => {
          const nextReportCode = String(row?.code || '').toUpperCase();

          setSelectedReportId(null);
          setReportDetail(null);
          setReportForm((current) => ({
            ...current,
            reportCode: nextReportCode,
            reportName: current.reportName || String(row?.name || '').trim(),
            apiUrl: current.apiUrl || initialReportForm.apiUrl,
          }));
          setIsReportCodeLookupOpen(false);
          await loadParametersForReportCode(nextReportCode, true);
        }}
      />
    </div>
  );
}

export default ReportsStudioPage;
