import SapInput from '../../components/common/SapInput';
import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchGatePassByDocEntry,
  fetchGatePassList,
  fetchGatePassMasterList,
  submitGatePassDocument,
  updateGatePassDocument,
} from '../../api/gatePassApi';
import '../../styles/gate-pass.css';

const stripUdfPrefix = (row = {}) => Object.entries(row).reduce((acc, [key, value]) => {
  const name = key.startsWith('U_') ? key.slice(2) : key;
  acc[name] = value instanceof Date ? value.toISOString().split('T')[0] : value;
  return acc;
}, {});

const emptyLine = (fields) => fields.reduce((acc, field) => {
  acc[field.name] = '';
  return acc;
}, {});

/**
 * Generic header + line-grid document form, config-driven off gatePassTransactions.js —
 * one component reused for Visitor Log, Gate In, and Gate Out (mirrors
 * JobWorkDocumentPage.jsx's pattern for the Job Work module).
 */
export default function GatePassTransactionForm({ transaction }) {
  const [mode, setMode] = useState('list');
  const [documents, setDocuments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, totalCount: 0, totalPages: 1 });
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [masterOptions, setMasterOptions] = useState({ visitorType: [], visitType: [] });

  const [docEntry, setDocEntry] = useState(null);
  const [header, setHeader] = useState({});
  const [lines, setLines] = useState([emptyLine(transaction.lineFields)]);
  const [secondaryLines, setSecondaryLines] = useState(
    transaction.secondaryLineTable ? [emptyLine(transaction.secondaryLineFields)] : [],
  );

  const loadList = useCallback(async (page = 1, query = searchQuery) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await fetchGatePassList(transaction.apiKey, { query, page, pageSize: pagination.pageSize });
      setDocuments(data.documents || []);
      setPagination(data.pagination || pagination);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction.apiKey]);

  useEffect(() => {
    loadList(1, '');
    Promise.all([
      fetchGatePassMasterList('visitorType').catch(() => ({ data: { rows: [] } })),
      fetchGatePassMasterList('visitType').catch(() => ({ data: { rows: [] } })),
    ]).then(([visitorTypeRes, visitTypeRes]) => {
      setMasterOptions({
        visitorType: visitorTypeRes.data.rows || [],
        visitType: visitTypeRes.data.rows || [],
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction.apiKey]);

  const openNew = () => {
    setDocEntry(null);
    setHeader({});
    setLines([emptyLine(transaction.lineFields)]);
    setSecondaryLines(transaction.secondaryLineTable ? [emptyLine(transaction.secondaryLineFields)] : []);
    setError('');
    setMode('form');
  };

  const openDocument = async (row) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await fetchGatePassByDocEntry(transaction.apiKey, row.doc_entry);
      setDocEntry(row.doc_entry);
      setHeader(stripUdfPrefix(data.header));
      const primaryRows = (data.lines?.[transaction.lineTable] || []).map(stripUdfPrefix);
      setLines(primaryRows.length ? primaryRows : [emptyLine(transaction.lineFields)]);
      if (transaction.secondaryLineTable) {
        const secondaryRows = (data.lines?.[transaction.secondaryLineTable] || []).map(stripUdfPrefix);
        setSecondaryLines(secondaryRows.length ? secondaryRows : [emptyLine(transaction.secondaryLineFields)]);
      }
      setMode('form');
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load document.');
    } finally {
      setLoading(false);
    }
  };

  const handleHeaderChange = (name, value) => setHeader((current) => ({ ...current, [name]: value }));

  const handleLineChange = (setter, index, name, value) => {
    setter((current) => current.map((line, i) => (i === index ? { ...line, [name]: value } : line)));
  };

  const addLine = (setter, fields) => setter((current) => [...current, emptyLine(fields)]);
  const removeLine = (setter) => (index) => setter((current) => (
    current.length > 1 ? current.filter((_, i) => i !== index) : current
  ));

  const resolveOptions = (field) => {
    if (Array.isArray(field.options)) return field.options.map((o) => ({ value: o.value, label: o.label }));
    const rows = masterOptions[field.options] || [];
    return rows.map((row) => ({ value: row.name, label: row.name }));
  };

  const renderField = (field, value, onChange) => {
    if (field.type === 'select') {
      const options = resolveOptions(field);
      return (
        <select value={value || ''} onChange={(e) => onChange(field.name, e.target.value)}>
          <option value="">Select {field.label}</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
    }
    if (field.type === 'textarea') {
      return <textarea value={value || ''} onChange={(e) => onChange(field.name, e.target.value)} />;
    }
    return (
      <SapInput
        type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
        value={value || ''}
        onChange={(e) => onChange(field.name, e.target.value)}
      />
    );
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const validLines = lines.filter((line) => transaction.lineFields.some((f) => String(line[f.name] || '').trim()));
      const validSecondaryLines = secondaryLines.filter((line) => (transaction.secondaryLineFields || [])
        .some((f) => String(line[f.name] || '').trim()));

      const payloadLines = { [transaction.lineTable]: validLines };
      if (transaction.secondaryLineTable) payloadLines[transaction.secondaryLineTable] = validSecondaryLines;

      const payload = { header, lines: payloadLines };
      const { data } = docEntry
        ? await updateGatePassDocument(transaction.apiKey, docEntry, payload)
        : await submitGatePassDocument(transaction.apiKey, payload);
      if (data?.warning) {
        // eslint-disable-next-line no-alert
        window.alert(data.warning);
      }
      setMode('list');
      loadList(pagination.page);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to save document.');
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'list') {
    return (
      <div className="sap-document-page gp-page">
        <div className="sap-document-toolbar">
          <span className="sap-document-toolbar__title">{transaction.menuName}</span>
          <input
            type="search"
            placeholder={`Search doc no / ${transaction.partyLabel.toLowerCase()}`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadList(1); }}
          />
          <button type="button" className="gp-btn" onClick={() => loadList(1)}>Search</button>
          <button type="button" className="gp-btn gp-btn--primary" onClick={openNew}>New</button>
        </div>
        {error ? <div className="gp-error">{error}</div> : null}
        <table className="gp-table">
          <thead>
            <tr>
              <th>Doc No</th>
              <th>{transaction.partyLabel}</th>
              <th>Party Name</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.doc_entry} onClick={() => openDocument(doc)}>
                <td>{doc.doc_num}</td>
                <td>{doc.party_code}</td>
                <td>{doc.party_name}</td>
                <td>{doc.posting_date}</td>
                <td>{doc.status}</td>
              </tr>
            ))}
            {!loading && !documents.length ? (
              <tr><td colSpan={5} className="gp-empty">No documents found.</td></tr>
            ) : null}
          </tbody>
        </table>
        <div className="gp-pagination">
          <button type="button" className="gp-btn" disabled={pagination.page <= 1} onClick={() => loadList(pagination.page - 1)}>Prev</button>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <button type="button" className="gp-btn" disabled={pagination.page >= pagination.totalPages} onClick={() => loadList(pagination.page + 1)}>Next</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sap-document-page gp-page">
      <div className="sap-document-toolbar">
        <span className="sap-document-toolbar__title">
          {transaction.menuName} {docEntry ? `#${docEntry}` : '(New)'}
        </span>
        <button type="button" className="gp-btn" onClick={() => setMode('list')}>Back to List</button>
        <button type="button" className="gp-btn gp-btn--primary" onClick={handleSave} disabled={loading}>
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? <div className="gp-error">{error}</div> : null}

      <fieldset className="gp-main">
        <legend>Main</legend>
        <div className="gp-main__grid">
          {transaction.headerFields.map((field) => (
            <label key={field.name}>
              {field.label}
              {renderField(field, header[field.name], handleHeaderChange)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="gp-main">
        <legend>Remarks</legend>
        <div className="gp-main__grid">
          {(transaction.remarksFields || []).map((field) => (
            <label key={field.name} className="gp-main__remarks">
              {field.label}
              {renderField(field, header[field.name], handleHeaderChange)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="gp-lines">
        <legend>{transaction.docLabel === 'Visitor' ? 'Materials' : 'Items'}</legend>
        <table className="gp-table">
          <thead>
            <tr>
              {transaction.lineFields.map((field) => <th key={field.name}>{field.label}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <tr key={index}>
                {transaction.lineFields.map((field) => (
                  <td key={field.name}>{renderField(field, line[field.name], (name, value) => handleLineChange(setLines, index, name, value))}</td>
                ))}
                <td>
                  <button type="button" className="gp-btn" onClick={() => removeLine(setLines)(index)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="gp-btn" onClick={() => addLine(setLines, transaction.lineFields)}>Add Line</button>
      </fieldset>

      {transaction.secondaryLineTable ? (
        <fieldset className="gp-lines">
          <legend>{transaction.secondaryLineLabel}</legend>
          <table className="gp-table">
            <thead>
              <tr>
                {transaction.secondaryLineFields.map((field) => <th key={field.name}>{field.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {secondaryLines.map((line, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={index}>
                  {transaction.secondaryLineFields.map((field) => (
                    <td key={field.name}>{renderField(field, line[field.name], (name, value) => handleLineChange(setSecondaryLines, index, name, value))}</td>
                  ))}
                  <td>
                    <button type="button" className="gp-btn" onClick={() => removeLine(setSecondaryLines)(index)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="gp-btn" onClick={() => addLine(setSecondaryLines, transaction.secondaryLineFields)}>Add Line</button>
        </fieldset>
      ) : null}
    </div>
  );
}
