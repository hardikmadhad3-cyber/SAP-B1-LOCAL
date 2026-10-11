import SapInput from '../components/common/SapInput';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAdminCompanyFormSettings,
  previewAdminCompanyFormQuery,
  publishAdminCompanyFormQuery,
  unpublishAdminCompanyFormQuery,
  copyAdminSalesPurchaseLayouts,
} from '../api/adminPanelApi';

export const FORM_OPTIONS = [
  ['sapb1.salesQuotation.formSettings.v1', 'Sales Quotation'],
  ['sapb1.salesOrder.formSettings.v2', 'Sales Order'],
  ['sapb1.delivery.formSettings.v3', 'Delivery'],
  ['sapb1.arInvoice.formSettings.v1', 'A/R Invoice'],
  ['sapb1.arCreditMemo.formSettings.v1', 'A/R Credit Memo'],
  ['sapb1.serviceArInvoice.formSettings.v7', 'Service A/R Invoice'],
  ['sapb1.serviceArCreditMemo.formSettings.v10', 'Service A/R Credit Memo'],
  ['sapb1.purchaseRequest.formSettings.v1', 'Purchase Request'],
  ['sapb1.purchaseQuotation.formSettings.v1', 'Purchase Quotation'],
  ['sapb1.purchaseOrder.formSettings.v1', 'Purchase Order'],
  ['sapb1.grpo.formSettings.v1', 'Goods Receipt PO'],
  ['sapb1.apInvoice.formSettings.v1', 'A/P Invoice'],
  ['sapb1.apCreditMemo.formSettings.v1', 'A/P Credit Memo'],
  ['sapb1.serviceApInvoice.formSettings.v10', 'Service A/P Invoice'],
  ['sapb1.serviceApCreditMemo.formSettings.v10', 'Service A/P Credit Memo'],
];

const EMPTY_CONTEXT = { docEntry: '', cardCode: '', postingDate: '', branchId: '' };
const getError = (error, fallback) =>
  error?.response?.data?.message || error?.message || fallback;

export default function CompanyFormSettings() {
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [formKey, setFormKey] = useState(FORM_OPTIONS[0][0]);
  const [queryText, setQueryText] = useState('');
  const [version, setVersion] = useState(0);
  const [published, setPublished] = useState(false);
  const [context, setContext] = useState(EMPTY_CONTEXT);
  const [preview, setPreview] = useState(null);
  const [validatedQuery, setValidatedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [targetCompanyId, setTargetCompanyId] = useState('');

  const dirty = useMemo(() => queryText !== validatedQuery, [queryText, validatedQuery]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setMessage('');
    setPreview(null);
    fetchAdminCompanyFormSettings({ companyId, formKey, signal: controller.signal })
      .then((payload) => {
        if (cancelled) return;
        const nextCompanies = payload.companies || [];
        setCompanies(nextCompanies);
        if (!companyId && nextCompanies[0]?.companyId) {
          const testCompany = nextCompanies.find((company) =>
            String(company.dbName || '').toUpperCase().includes('TEST'),
          );
          setCompanyId(String((testCompany || nextCompanies[0]).companyId));
          return;
        }
        if (!targetCompanyId && nextCompanies[1]?.companyId) {
          const liveCompany = nextCompanies.find((company) =>
            String(company.dbName || '').toUpperCase() === 'JKL_LIVEDB',
          ) || nextCompanies.find((company) =>
            String(company.dbName || '').toUpperCase().includes('LIVE'),
          );
          const fallbackTarget = nextCompanies.find((company) =>
            String(company.companyId) !== String(companyId),
          );
          if (liveCompany || fallbackTarget) {
            setTargetCompanyId(String((liveCompany || fallbackTarget).companyId));
          }
        }
        const layout = payload.queryLayout;
        setQueryText(layout?.queryText || '');
        setValidatedQuery('');
        setVersion(Number(layout?.version || 0));
        setPublished(Boolean(layout?.isPublished));
      })
      .catch((loadError) => {
        if (!cancelled && loadError?.name !== 'CanceledError') {
          setError(getError(loadError, 'Unable to load SQL Content settings.'));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [companyId, formKey]);

  const updateContext = (name, value) =>
    setContext((previous) => ({ ...previous, [name]: value }));

  const validateAndPreview = async () => {
    try {
      setWorking('preview');
      setError('');
      setMessage('');
      const result = await previewAdminCompanyFormQuery({
        companyId: Number(companyId), formKey, queryText, context,
      });
      setPreview(result);
      setValidatedQuery(queryText);
      setMessage('Validation succeeded. Review the preview, then publish.');
    } catch (previewError) {
      setPreview(null);
      setValidatedQuery('');
      setError(getError(previewError, 'Unable to validate the query.'));
    } finally {
      setWorking('');
    }
  };

  const publish = async () => {
    try {
      setWorking('publish');
      setError('');
      setMessage('');
      const layout = await publishAdminCompanyFormQuery({
        companyId: Number(companyId),
        formKey,
        queryText,
        context,
        expectedVersion: version,
      });
      setVersion(Number(layout.version || 0));
      setPublished(true);
      setValidatedQuery(queryText);
      setMessage('SQL Content layout published for every user in the selected company.');
    } catch (publishError) {
      setError(getError(publishError, 'Unable to publish the query.'));
    } finally {
      setWorking('');
    }
  };

  const unpublish = async () => {
    try {
      setWorking('unpublish');
      setError('');
      setMessage('');
      const layout = await unpublishAdminCompanyFormQuery({
        companyId: Number(companyId), formKey, expectedVersion: version,
      });
      setVersion(Number(layout.version || 0));
      setPublished(false);
      setMessage('SQL Content layout unpublished. The standard editable page is active again.');
    } catch (unpublishError) {
      setError(getError(unpublishError, 'Unable to unpublish the query.'));
    } finally {
      setWorking('');
    }
  };

  const copySalesPurchase = async () => {
    if (!targetCompanyId || String(targetCompanyId) === String(companyId)) {
      setError('Choose a different target company.');
      return;
    }
    try {
      setWorking('copy');
      setError('');
      setMessage('');
      const result = await copyAdminSalesPurchaseLayouts({
        sourceCompanyId: Number(companyId),
        targetCompanyId: Number(targetCompanyId),
      });
      setMessage(
        `Copied ${result.copiedCount} published Sales and Purchase layout(s). No company SQL was executed.`,
      );
    } catch (copyError) {
      setError(getError(copyError, 'Unable to copy Sales and Purchase layouts.'));
    } finally {
      setWorking('');
    }
  };

  return (
    <div className="admin-panel-page">
      <div className="admin-panel-entity__breadcrumb">
        <Link to="/admin">Admin Workspace</Link> / Company Form Settings
      </div>
      <section className="admin-panel-hero">
        <div className="admin-panel-hero__copy">
          <div className="admin-panel-hero__eyebrow">Company SQL layout</div>
          <h1>SQL Content layout for all users</h1>
          <p>Publish a SQL-derived Content column layout for one page and company. The document page stays editable with its normal rows, lookups, and save flow.</p>
        </div>
      </section>

      <section className="admin-panel-card" style={{ padding: 24, marginTop: 20 }}>
        <div className="admin-panel-form-grid">
          <label>Company
            <select className="admin-panel-input" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
              {companies.map((company) => (
                <option key={company.companyId} value={company.companyId}>
                  {company.companyName} ({company.dbName})
                </option>
              ))}
            </select>
          </label>
          <label>Page
            <select className="admin-panel-input" value={formKey} onChange={(event) => setFormKey(event.target.value)}>
              {FORM_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>Copy settings to
            <select className="admin-panel-input" value={targetCompanyId} onChange={(event) => setTargetCompanyId(event.target.value)}>
              <option value="">Select target company</option>
              {companies
                .filter((company) => String(company.companyId) !== String(companyId))
                .map((company) => (
                  <option key={company.companyId} value={company.companyId}>
                    {company.companyName} ({company.dbName})
                  </option>
                ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          className="admin-panel-button admin-panel-button--primary admin-panel-button--compact"
          onClick={copySalesPurchase}
          disabled={working !== '' || !targetCompanyId || String(targetCompanyId) === String(companyId)}
          style={{ marginTop: 12, width: 'max-content', maxWidth: '100%', display: 'inline-flex' }}
        >
          {working === 'copy' ? 'Copying settings...' : 'Copy Sales & Purchase Settings'}
        </button>

        {loading ? <div className="admin-panel-empty">Loading SQL Content settings...</div> : null}
        {error ? <div className="admin-panel-alert admin-panel-alert--error">{error}</div> : null}
        {message ? <div className="admin-panel-alert">{message}</div> : null}

        {!loading ? (
          <>
            <p className="admin-panel-help-text">
              Status: <strong>{published ? `Published (version ${version})` : 'Standard page behavior'}</strong>.
              {' '}Only one SELECT or WITH query is allowed. Result aliases define the Content column order.
            </p>
            <label style={{ display: 'block', marginTop: 18, fontWeight: 600 }}>SQL query
              <textarea
                className="admin-panel-input"
                value={queryText}
                onChange={(event) => {
                  setQueryText(event.target.value);
                  setPreview(null);
                }}
                spellCheck={false}
                rows={14}
                placeholder={'SELECT T0.ItemCode AS [Item Code]\nFROM QUT1 T0\nWHERE T0.DocEntry = {{docEntry}}'}
                style={{ marginTop: 6, width: '100%', resize: 'vertical', fontFamily: 'Consolas, monospace' }}
              />
            </label>
            <div className="admin-panel-help-text" style={{ marginTop: 8 }}>
              Approved placeholders: <code>{'{{docEntry}}'}</code>, <code>{'{{cardCode}}'}</code>, <code>{'{{postingDate}}'}</code>, <code>{'{{branchId}}'}</code>, <code>{'{{userId}}'}</code>.
            </div>

            <h3 style={{ marginTop: 22 }}>Preview context</h3>
            <div className="admin-panel-form-grid">
              {[
                ['docEntry', 'Document key', 'number'],
                ['cardCode', 'Business partner code', 'text'],
                ['postingDate', 'Posting date', 'date'],
                ['branchId', 'Branch ID', 'number'],
              ].map(([name, label, type]) => (
                <label key={name}>{label}
                  <SapInput
                    className="admin-panel-input"
                    type={type}
                    value={context[name]}
                    onChange={(event) => updateContext(name, event.target.value)}
                  />
                </label>
              ))}
            </div>

            <div className="admin-panel-entity__actions" style={{ marginTop: 18 }}>
              <button type="button" className="admin-panel-secondary-button" onClick={validateAndPreview} disabled={!companyId || !queryText.trim() || Boolean(working)}>
                {working === 'preview' ? 'Validating...' : 'Validate & Preview'}
              </button>
              <button type="button" className="admin-panel-primary-button" onClick={publish} disabled={!companyId || dirty || !preview || Boolean(working)}>
                {working === 'publish' ? 'Publishing...' : 'Save & Publish'}
              </button>
              <button type="button" className="admin-panel-secondary-button" onClick={unpublish} disabled={!published || Boolean(working)}>
                {working === 'unpublish' ? 'Unpublishing...' : 'Unpublish'}
              </button>
            </div>

            {preview ? (
              <div style={{ marginTop: 22, overflowX: 'auto' }}>
                <h3>Preview ({preview.rowCount} rows{preview.truncated ? ', limited' : ''})</h3>
                <table className="admin-panel-table">
                  <thead><tr>{preview.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
                  <tbody>
                    {preview.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {preview.columns.map((column) => <td key={column.key}>{String(row[column.key] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
