import SapInput from '../../components/common/SapInput';
import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchJobWorkByDocEntry,
  fetchJobWorkList,
  fetchJobWorkPartyAddresses,
  fetchJobWorkReferenceData,
  submitJobWork,
  updateJobWork,
} from '../../api/jobWorkApi';
import JobWorkAddressBlock from './JobWorkAddressBlock';
import '../../styles/job-work.css';

const stripUdfPrefix = (row = {}) => Object.entries(row).reduce((acc, [key, value]) => {
  const name = key.startsWith('U_') ? key.slice(2) : key;
  acc[name] = value instanceof Date ? value.toISOString().split('T')[0] : value;
  return acc;
}, {});

// `_` prefixed keys (e.g. `_batchManaged`) are UI-only state derived from the picked item —
// they must never be sent to the API, so payload builders filter them out.
const isTransientKey = (name) => name.startsWith('_');

const emptyLine = (transaction) => transaction.lineFields.reduce((acc, field) => {
  acc[field.name] = '';
  return acc;
}, {});

const findItem = (referenceData, itemCode) => (referenceData.items || [])
  .find((item) => item.ItemCode === itemCode);

const isBatchManagedItem = (item) => String(item?.BatchManaged || '').trim().toUpperCase() === 'Y';

export default function JobWorkDocumentPage({ transaction }) {
  const [mode, setMode] = useState('list');
  const [documents, setDocuments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, totalCount: 0, totalPages: 1 });
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [referenceData, setReferenceData] = useState({ parties: [], warehouses: [], items: [], paymentTerms: [], salesEmployees: [] });

  const [docEntry, setDocEntry] = useState(null);
  const [header, setHeader] = useState({});
  const [lines, setLines] = useState([emptyLine(transaction)]);

  const loadList = useCallback(async (page = 1, query = searchQuery) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await fetchJobWorkList(transaction.apiKey, { query, page, pageSize: pagination.pageSize });
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
    fetchJobWorkReferenceData(transaction.apiKey)
      .then(({ data }) => setReferenceData(data))
      .catch(() => setReferenceData({ parties: [], warehouses: [], items: [], paymentTerms: [], salesEmployees: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction.apiKey]);

  const openNew = () => {
    setDocEntry(null);
    setHeader({});
    setLines([emptyLine(transaction)]);
    setError('');
    setMode('form');
  };

  const openDocument = async (row) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await fetchJobWorkByDocEntry(transaction.apiKey, row.doc_entry);
      setDocEntry(row.doc_entry);
      setHeader(stripUdfPrefix(data.header));
      const rows = (data.lines || []).map(stripUdfPrefix).map((line) => (
        transaction.itemField
          ? { ...line, _batchManaged: isBatchManagedItem(findItem(referenceData, line[transaction.itemField])) }
          : line
      ));
      setLines(rows.length ? rows : [emptyLine(transaction)]);
      setMode('form');
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to load document.');
    } finally {
      setLoading(false);
    }
  };

  const handleHeaderChange = (name, value) => {
    setHeader((current) => ({ ...current, [name]: value }));
  };

  const handlePartyChange = (code) => {
    const party = referenceData.parties.find((p) => p.CardCode === code);
    setHeader((current) => ({
      ...current,
      [transaction.partyCodeField]: code,
      [transaction.partyNameField]: party?.CardName || '',
      ...(transaction.paymentTermField ? { [transaction.paymentTermField]: party?.GroupNum ?? '' } : {}),
      ...(transaction.salesEmployeeField ? { [transaction.salesEmployeeField]: party?.SlpCode ?? '' } : {}),
    }));

    if (!code) return;
    fetchJobWorkPartyAddresses(transaction.apiKey, code)
      .then(({ data }) => {
        const billTo = (data.addresses || []).find((a) => a.address_type === 'B');
        const shipFrom = (data.addresses || []).find((a) => a.address_type === 'S');
        const { billTo: billToMap, shipFrom: shipFromMap } = transaction.addressFields;
        setHeader((current) => ({
          ...current,
          ...(billTo ? {
            [billToMap.addressId]: billTo.address_id,
            [billToMap.street]: billTo.street,
            [billToMap.streetNo]: billTo.street_no,
            [billToMap.building]: billTo.building,
            [billToMap.block]: billTo.block,
            [billToMap.city]: billTo.city,
            [billToMap.zip]: billTo.zip_code,
            [billToMap.county]: billTo.county,
            [billToMap.country]: billTo.country,
            [billToMap.state]: billTo.state,
            [billToMap.gstin]: billTo.gstin,
            [billToMap.gstType]: billTo.gst_type,
          } : {}),
          ...(shipFrom ? {
            [shipFromMap.addressId]: shipFrom.address_id,
            [shipFromMap.street]: shipFrom.street,
            [shipFromMap.streetNo]: shipFrom.street_no,
            [shipFromMap.building]: shipFrom.building,
            [shipFromMap.block]: shipFrom.block,
            [shipFromMap.city]: shipFrom.city,
            [shipFromMap.zip]: shipFrom.zip_code,
            [shipFromMap.county]: shipFrom.county,
            [shipFromMap.country]: shipFrom.country,
            [shipFromMap.state]: shipFrom.state,
            [shipFromMap.gstin]: shipFrom.gstin,
            [shipFromMap.gstType]: shipFrom.gst_type,
          } : {}),
        }));
      })
      .catch(() => { /* address auto-fill is a convenience; leave fields editable on failure */ });
  };

  const handleLineChange = (index, name, value) => {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      if (name === transaction.itemField) {
        const item = findItem(referenceData, value);
        return {
          ...line,
          [name]: value,
          ...(transaction.itemDescriptionField ? { [transaction.itemDescriptionField]: item?.ItemName || '' } : {}),
          ...(transaction.itemUomField ? { [transaction.itemUomField]: item?.InventoryUOM || '' } : {}),
          _batchManaged: isBatchManagedItem(item),
        };
      }
      return { ...line, [name]: value };
    }));
  };

  const addLine = () => setLines((current) => [...current, emptyLine(transaction)]);
  const removeLine = (index) => setLines((current) => (
    current.length > 1 ? current.filter((_, i) => i !== index) : current
  ));

  const validateBeforeSave = (validLines) => {
    if (transaction.apiKey !== 'jobworkIssueNote') return null;
    if (!String(header[transaction.partyCodeField] || '').trim()) {
      return `${transaction.partyLabel} is required.`;
    }
    if (!validLines.length) {
      return 'Add at least one material line before saving.';
    }
    for (let i = 0; i < validLines.length; i += 1) {
      const line = validLines[i];
      const rowLabel = `Line ${i + 1}`;
      if (!String(line.MITMNO || '').trim()) return `${rowLabel}: Item Code is required.`;
      if (!(Number(line.MQTY) > 0)) return `${rowLabel}: Quantity must be greater than zero.`;
      if (!String(line.MWHS || '').trim()) return `${rowLabel}: From Warehouse is required.`;
      if (line._batchManaged && !String(line.MBatch || '').trim()) {
        return `${rowLabel}: Item ${line.MITMNO} is batch-managed — a Batch number is required.`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const validLines = lines
        .filter((line) => transaction.lineFields.some((f) => String(line[f.name] || '').trim()))
        .map((line) => Object.fromEntries(Object.entries(line).filter(([key]) => !isTransientKey(key))));

      const validationMessage = validateBeforeSave(validLines);
      if (validationMessage) {
        setError(validationMessage);
        setLoading(false);
        return;
      }

      const payload = { header, lines: { [transaction.lineTable]: validLines } };
      const { data } = docEntry
        ? await updateJobWork(transaction.apiKey, docEntry, payload)
        : await submitJobWork(transaction.apiKey, payload);
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
      <div className="sap-document-page job-work-page">
        <div className="sap-document-toolbar">
          <span className="sap-document-toolbar__title">{transaction.menuName}</span>
          <input
            type="search"
            placeholder="Search doc no / party"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') loadList(1); }}
          />
          <button type="button" onClick={() => loadList(1)}>Search</button>
          <button type="button" className="sap-document-toolbar__new" onClick={openNew}>New</button>
        </div>
        {error ? <div className="job-work-error">{error}</div> : null}
        <table className="job-work-table">
          <thead>
            <tr>
              <th>Doc No</th>
              <th>{transaction.partyLabel} Code</th>
              <th>{transaction.partyLabel} Name</th>
              <th>Posting Date</th>
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
              <tr><td colSpan={5} className="job-work-empty">No documents found.</td></tr>
            ) : null}
          </tbody>
        </table>
        <div className="job-work-pagination">
          <button type="button" disabled={pagination.page <= 1} onClick={() => loadList(pagination.page - 1)}>Prev</button>
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => loadList(pagination.page + 1)}>Next</button>
        </div>
      </div>
    );
  }

  return (
    <div className="sap-document-page job-work-page">
      <div className="sap-document-toolbar">
        <span className="sap-document-toolbar__title">
          {transaction.menuName} {docEntry ? `#${docEntry}` : '(New)'}
        </span>
        <button type="button" onClick={() => setMode('list')}>Back to List</button>
        <button type="button" className="sap-document-toolbar__primary" onClick={handleSave} disabled={loading}>
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? <div className="job-work-error">{error}</div> : null}

      <fieldset className="job-work-main">
        <legend>Main</legend>
        <div className="job-work-main__grid">
          <label>
            {transaction.partyLabel}
            <select
              value={header[transaction.partyCodeField] || ''}
              onChange={(e) => handlePartyChange(e.target.value)}
            >
              <option value="">Select {transaction.partyLabel}</option>
              {referenceData.parties.map((party) => (
                <option key={party.CardCode} value={party.CardCode}>
                  {party.CardCode} — {party.CardName}
                </option>
              ))}
            </select>
          </label>
          {transaction.headerFields.map((field) => (
            <label key={field.name}>
              {field.label}
              {field.type === 'select' ? (
                <select
                  value={header[field.name] ?? ''}
                  onChange={(e) => handleHeaderChange(field.name, e.target.value)}
                >
                  <option value="">Select {field.label}</option>
                  {(referenceData[field.optionsKey] || []).map((option) => (
                    <option key={option[field.valueKey]} value={option[field.valueKey]}>
                      {option[field.textKey]}
                    </option>
                  ))}
                </select>
              ) : (
                <SapInput
                  type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                  value={header[field.name] || ''}
                  onChange={(e) => handleHeaderChange(field.name, e.target.value)}
                />
              )}
            </label>
          ))}
          <label className="job-work-main__remarks">
            Remarks
            <textarea
              value={header[transaction.remarksField] || ''}
              onChange={(e) => handleHeaderChange(transaction.remarksField, e.target.value)}
            />
          </label>
        </div>
      </fieldset>

      <JobWorkAddressBlock addressFields={transaction.addressFields} header={header} onFieldChange={handleHeaderChange} />

      <fieldset className="job-work-lines">
        <legend>Materials</legend>
        <table className="job-work-table">
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
                  <td key={field.name}>
                    {field.type === 'select' ? (
                      <select
                        value={line[field.name] || ''}
                        onChange={(e) => handleLineChange(index, field.name, e.target.value)}
                      >
                        <option value="">Select {field.label}</option>
                        {(referenceData[field.optionsKey] || []).map((option) => (
                          <option key={option[field.valueKey]} value={option[field.valueKey]}>
                            {option[field.textKey]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <SapInput
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={line[field.name] || ''}
                        onChange={(e) => handleLineChange(index, field.name, e.target.value)}
                      />
                    )}
                    {field.name === 'MBatch' && line._batchManaged ? (
                      <span className="job-work-required-hint">required</span>
                    ) : null}
                  </td>
                ))}
                <td>
                  <button type="button" onClick={() => removeLine(index)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={addLine}>Add Line</button>
      </fieldset>
    </div>
  );
}
