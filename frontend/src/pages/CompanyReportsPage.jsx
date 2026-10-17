import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import ReportPopupModal from '../components/reports-studio/ReportPopupModal';
import PdfViewer from '../components/reports-studio/PdfViewer';
import { fetchCompanyReport, fetchCompanyReports, runCompanyReport } from '../api/companyReportsApi';
import { base64ToPdfBlob } from '../utils/pdfUtils';
import { matchesSapSearchText } from '../utils/sapSearch';
import '../styles/report-studio.css';
import '../styles/company-reports.css';

const errorText = (error, fallback) =>
  error?.response?.data?.detail || error?.response?.data?.message || error?.message || fallback;

const formatDate = (date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const previousMonthClamped = (date) => {
  const first = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), lastDay));
};

const initialValues = (parameters) => {
  const today = new Date();
  const previousMonth = previousMonthClamped(today);
  return Object.fromEntries(parameters.map((parameter) => {
    const identity = `${parameter.displayName || ''} ${parameter.paramName || ''}`.toLowerCase();
    if (parameter.paramType === 'date' && /from.?date|date.?from|start.?date/.test(identity)) {
      return [parameter.paramName, formatDate(previousMonth)];
    }
    if (parameter.paramType === 'date' && /to.?date|date.?to|end.?date/.test(identity)) {
      return [parameter.paramName, formatDate(today)];
    }
    return [parameter.paramName, parameter.defaultValue || ''];
  }));
};

export default function CompanyReportsPage() {
  const { company } = useAuth();
  const companyId = company?.companyId ?? company?.CompanyId;
  const activeCompanyId = useRef(companyId);
  activeCompanyId.current = companyId;
  const [catalog, setCatalog] = useState([]);
  const [query, setQuery] = useState('');
  const listRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [values, setValues] = useState({});
  const [preview, setPreview] = useState({ fileName: '', url: '' });
  const [loading, setLoading] = useState({ catalog: true, detail: false, run: false });
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setCatalog([]);
    setSelected(null);
    setMessage('');
    setNotice('');
    setPreview({ fileName: '', url: '' });
    setLoading((current) => ({ ...current, catalog: true }));
    fetchCompanyReports()
      .then((result) => { if (active) { setCatalog(result.items || []); setNotice(result.message || ''); } })
      .catch((error) => { if (active) setMessage(errorText(error, 'Could not load company reports.')); })
      .finally(() => { if (active) setLoading((current) => ({ ...current, catalog: false })); });
    return () => { active = false; };
  }, [companyId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query]);

  useEffect(() => () => {
    if (preview.url) URL.revokeObjectURL(preview.url);
  }, [preview.url]);

  const filtered = useMemo(() => {
    return catalog.filter((report) =>
      matchesSapSearchText(`${report.name} ${report.code}`, query));
  }, [catalog, query]);

  const openReport = async (code) => {
    const requestedCompanyId = companyId;
    setMessage('');
    setLoading((current) => ({ ...current, detail: true }));
    try {
      const detail = await fetchCompanyReport(code);
      if (activeCompanyId.current !== requestedCompanyId) return;
      setValues(initialValues(detail.parameters || []));
      setSelected(detail);
    } catch (error) {
      if (activeCompanyId.current === requestedCompanyId) {
        setMessage(errorText(error, 'Could not load report parameters.'));
      }
    } finally {
      setLoading((current) => ({ ...current, detail: false }));
    }
  };

  const runSelected = async () => {
    if (!selected) return;
    setMessage('');
    setLoading((current) => ({ ...current, run: true }));
    try {
      const result = await runCompanyReport(selected.report.code, values);
      const url = URL.createObjectURL(base64ToPdfBlob(result.pdfBase64));
      setPreview({ fileName: result.fileName || `${selected.report.code}.pdf`, url });
      setSelected(null);
    } catch (error) {
      setMessage(errorText(error, 'Could not generate the report.'));
    } finally {
      setLoading((current) => ({ ...current, run: false }));
    }
  };

  return (
    <div className="rs-window company-reports-page">
      <header className="rs-window__titlebar company-reports-page__title">
        <div>
          <h1>Company Reports</h1>
          <p>Live reports for {company?.companyName || company?.CompanyName || 'the selected company'}</p>
        </div>
        <span className="rs-badge">{catalog.length} reports</span>
      </header>
      <main className="company-reports-page__body">
        <section className="rs-card company-reports-page__card">
          <div className="rs-card__header">
            <h3>Available reports</h3>
            <div className="company-reports-page__search">
              <input
                aria-label="Search company reports"
                type="search"
                placeholder="Search by report name or code"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? <button type="button" className="rs-btn" onClick={() => setQuery('')}>Clear search</button> : null}
            </div>
          </div>
          {message ? <div className="rs-message is-error" role="alert">{message}</div> : null}
          {loading.catalog ? <div className="company-reports-page__empty">Loading company reports...</div> : null}
          {!loading.catalog && !filtered.length ? (
            <div className="company-reports-page__empty">{notice || 'No matching company reports found.'}</div>
          ) : null}
          <div className="company-reports-page__list" ref={listRef}>
            {filtered.map((report) => (
              <button key={report.code} type="button" className="company-reports-page__row"
                onClick={() => openReport(report.code)} disabled={loading.detail}>
                <span>{report.name}</span><small>{report.code}</small>
              </button>
            ))}
          </div>
        </section>
      </main>
      <ReportPopupModal
        isOpen={Boolean(selected)}
        report={selected ? { reportName: selected.report.name, reportCode: selected.report.code, reportType: 'Crystal' } : null}
        parameters={selected?.parameters || []}
        values={values}
        isRunning={loading.run}
        errorMessage={message}
        onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
        onClose={() => setSelected(null)}
        onRun={runSelected}
      />
      <PdfViewer
        fileName={preview.fileName}
        previewUrl={preview.url}
        isOpen={Boolean(preview.url)}
        onClose={() => setPreview({ fileName: '', url: '' })}
        onOpen={() => window.open(preview.url, '_blank', 'noopener,noreferrer')}
      />
    </div>
  );
}
