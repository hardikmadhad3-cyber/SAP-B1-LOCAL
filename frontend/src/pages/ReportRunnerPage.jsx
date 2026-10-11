import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchReportDetail,
  fetchReportMenus,
  runReport,
} from '../api/reportStudioApi';
import PdfViewer from '../components/reports-studio/PdfViewer';
import ReportPopupModal from '../components/reports-studio/ReportPopupModal';
import { base64ToPdfBlob } from '../utils/pdfUtils';
import '../styles/report-studio.css';

const normalizeError = (error, fallback) =>
  error?.response?.data?.detail ||
  error?.response?.data?.message ||
  error?.message ||
  fallback;

const findSingleReportMenuTarget = (targets = [], menuId) =>
  (targets || []).find((target) => Number(target.menuId) === Number(menuId)) || null;

const formatDateForInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const shiftMonthsClamped = (date, monthDelta) => {
  const source = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const targetMonthStart = new Date(source.getFullYear(), source.getMonth() + monthDelta, 1);
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

function ReportRunnerPage() {
  const { menuId: routeMenuId, reportId: routeReportId } = useParams();
  const openedReportRef = useRef(null);
  const [reportDetail, setReportDetail] = useState(null);
  const [runValues, setRunValues] = useState({});
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState({ fileName: '', previewUrl: '' });
  const [message, setMessage] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState({ target: true, reportRun: false });

  const selectedReport = reportDetail?.report || null;
  const parameters = useMemo(() => reportDetail?.parameters || [], [reportDetail?.parameters]);

  useEffect(() => () => {
    if (pdfPreview.previewUrl) {
      URL.revokeObjectURL(pdfPreview.previewUrl);
    }
  }, [pdfPreview.previewUrl]);

  const loadReport = useCallback(async (reportId) => {
    setLoading((current) => ({ ...current, target: true }));
    try {
      const response = await fetchReportDetail(reportId);
      setReportDetail(response);
      setMessage({ type: '', text: '' });
    } catch (error) {
      setReportDetail(null);
      setMessage({ type: 'error', text: normalizeError(error, 'Failed to load the selected report.') });
    } finally {
      setLoading((current) => ({ ...current, target: false }));
    }
  }, []);

  useEffect(() => {
    const resolveTargetReport = async () => {
      const directReportId = Number(routeReportId);
      if (Number.isInteger(directReportId) && directReportId > 0) {
        await loadReport(directReportId);
        return;
      }

      const menuId = Number(routeMenuId);
      if (!Number.isInteger(menuId) || menuId <= 0) {
        setMessage({ type: 'error', text: 'No report was selected.' });
        setLoading((current) => ({ ...current, target: false }));
        return;
      }

      setLoading((current) => ({ ...current, target: true }));
      try {
        const catalog = await fetchReportMenus();
        const target = findSingleReportMenuTarget(catalog.singleReportMenuTargets, menuId);

        if (!target?.reportId) {
          setReportDetail(null);
          setMessage({ type: 'info', text: 'Select a report from the sidebar to run it.' });
          setLoading((current) => ({ ...current, target: false }));
          return;
        }

        await loadReport(target.reportId);
      } catch (error) {
        setReportDetail(null);
        setMessage({ type: 'error', text: normalizeError(error, 'Failed to load the selected report.') });
        setLoading((current) => ({ ...current, target: false }));
      }
    };

    openedReportRef.current = null;
    setIsRunModalOpen(false);
    resolveTargetReport();
  }, [loadReport, routeMenuId, routeReportId]);

  useEffect(() => {
    if (loading.target || !selectedReport) {
      return;
    }

    if (openedReportRef.current === selectedReport.reportId) {
      return;
    }

    setRunValues(buildInitialRunValues(parameters));
    setIsRunModalOpen(true);
    openedReportRef.current = selectedReport.reportId;
  }, [loading.target, parameters, selectedReport]);

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
      setMessage({ type: 'success', text: 'Report generated successfully.' });
    } catch (error) {
      setMessage({ type: 'error', text: normalizeError(error, 'Failed to run report.') });
    } finally {
      setLoading((current) => ({ ...current, reportRun: false }));
    }
  };

  const openPreviewInNewTab = () => {
    if (!pdfPreview.previewUrl) return;
    window.open(pdfPreview.previewUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="rs-direct-runner">
      {loading.target ? (
        <div className="rs-direct-runner__status">Loading report...</div>
      ) : null}

      {message.text ? (
        <div className={`rs-message is-${message.type || 'info'}`}>
          {message.text}
        </div>
      ) : null}

      {selectedReport && !isRunModalOpen && !isPreviewModalOpen ? (
        <button
          type="button"
          className="rs-btn rs-btn--primary rs-direct-runner__button"
          onClick={() => {
            setRunValues(buildInitialRunValues(parameters));
            setIsRunModalOpen(true);
          }}
        >
          Run Report
        </button>
      ) : null}

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
    </div>
  );
}

export default ReportRunnerPage;
