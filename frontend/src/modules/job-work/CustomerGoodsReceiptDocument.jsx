import SapDateInput from '../../components/common/SapDateInput';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import '../purchase-order/styles/purchaseOrder.css';
import '../../styles/sales-order-list.css';
import './styles/customerGoodsReceipt.css';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import BatchAllocationModal from '../../components/BatchAllocationModal';
import PrintLayoutToolbar from '../../components/print-layout/PrintLayoutToolbar';
import AccountLookupModal from '../../components/common/AccountLookupModal';
import { createActiveCompanyScopedRouteState } from '../../utils/companyStorageScope';
import { fetchGoodsReceiptBatchesByItem, fetchGoodsReceiptNextBatchNumber } from '../../api/goodsReceiptApi';
import { fetchGLAccounts } from '../../api/invoiceApi';
import {
  fetchJobWorkBins,
  fetchJobWorkByDocEntry,
  fetchJobWorkGoodsReceiptSeries,
  fetchJobWorkList,
  fetchJobWorkPartyAddresses,
  fetchJobWorkReferenceData,
  fetchJobWorkSeries,
  submitJobWork,
  updateJobWork,
} from '../../api/jobWorkApi';
import { JOB_WORK_TRANSACTIONS } from './jobWorkTransactions';

const TRANSACTION = JOB_WORK_TRANSACTIONS.customerReceiptNote;
const today = () => new Date().toISOString().split('T')[0];

// Dates arrive over the wire as JSON strings (e.g. "2026-08-13T00:00:00.000Z"),
// never as actual Date instances — JSON has no date type, so an `instanceof
// Date` check here is always false. <input type="date"> needs exactly
// "YYYY-MM-DD", so truncate any ISO datetime string at the "T" too.
const toDateInputValue = (value) => {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  if (typeof value === 'string' && value.includes('T')) return value.split('T')[0];
  return value;
};

const stripUdfPrefix = (row = {}) => Object.entries(row).reduce((acc, [key, value]) => {
  const name = key.startsWith('U_') ? key.slice(2) : key;
  acc[name] = toDateInputValue(value);
  return acc;
}, {});

const isTransientKey = (name) => name.startsWith('_');

// Backend stores the linked Inventory Goods Receipt reference in a dedicated
// field pair (see jobWorkSchema.js's WebGoodsRcptDocEntry/DocNum) — separate
// from the legacy GRNo/GRSeries free-text fields, which aren't a real SAP link.
const getStockMovementRefs = (header) => ({
  goodsReceiptDocEntry: header.WebGoodsRcptDocEntry ? Number(header.WebGoodsRcptDocEntry) : null,
  goodsReceiptDocNum: header.WebGoodsRcptDocNum ? Number(header.WebGoodsRcptDocNum) : null,
});

const emptyLine = () => ({
  ...TRANSACTION.lineFields.reduce((acc, field) => {
    acc[field.name] = '';
    return acc;
  }, {}),
  batches: [],
});

const emptyHeader = () => ({ DocDate: today(), PDate: today(), DDate: today() });

const findItem = (items, itemCode) => (items || []).find((item) => item.ItemCode === itemCode);
const isBatchManagedItem = (item) => String(item?.BatchManaged || '').trim().toUpperCase() === 'Y';
const isWarehouseBinEnabled = (warehouses, whsCode) => {
  const warehouse = (warehouses || []).find((wh) => wh.WhsCode === whsCode);
  return String(warehouse?.BinEnabled || '').trim().toUpperCase() === 'Y';
};

// The bin list for a warehouse loads asynchronously (and a document's saved
// bin value could in theory no longer be in the active list) — always
// including the currently-set value as an option means the dropdown shows
// what's actually saved instead of silently resetting to blank whenever the
// exact string isn't found among the fetched options yet.
const binOptionsWithCurrentValue = (bins, currentValue) => {
  const trimmedCurrent = String(currentValue || '').trim();
  const list = bins || [];
  if (!trimmedCurrent || list.some((bin) => String(bin.BinCode || '').trim() === trimmedCurrent)) {
    return list;
  }
  return [{ BinAbsEntry: `current-${trimmedCurrent}`, BinCode: trimmedCurrent }, ...list];
};

export default function CustomerGoodsReceiptDocument() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('list');

  // --- list state ---
  const [documents, setDocuments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, totalCount: 0, totalPages: 1 });
  const [searchQuery, setSearchQuery] = useState('');
  const [listLoading, setListLoading] = useState(false);

  // --- reference data ---
  const [referenceData, setReferenceData] = useState({ parties: [], warehouses: [], items: [], paymentTerms: [], salesEmployees: [], branches: [] });

  // --- form state ---
  const [docEntry, setDocEntry] = useState(null);
  const [header, setHeader] = useState(emptyHeader);
  const [lines, setLines] = useState([emptyLine()]);
  const [pageState, setPageState] = useState({ loading: false, saving: false, error: '', success: '' });
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1 });
  const [batchModal, setBatchModal] = useState({ open: false, lineIndex: -1, availableBatches: [], loading: false, error: '' });
  // Account picker — mirrors the item/customer modal pattern; lineIndex -1
  // means "the header Default Account field" rather than a specific line.
  const [accountModal, setAccountModal] = useState({ open: false, lineIndex: -1 });
  const [activeTab, setActiveTab] = useState('Materials');
  // Bin lists are fetched lazily per warehouse (only bin-managed ones ever need them) and cached here.
  const [binsByWarehouse, setBinsByWarehouse] = useState({});
  // The customer's saved Bill-To / Ship-From addresses (SAP CRD1), plus SAP's
  // own default address codes (OCRD.BillToDef/ShipToDef) — lets the UI offer
  // a picker only when there's more than one address to choose from.
  const [partyAddresses, setPartyAddresses] = useState({ list: [], billToDefault: '', shipToDefault: '' });
  // G/L accounts for the per-line Account Code column (same lookup Goods
  // Receipt itself uses) — the header's "Default Account" field is a pure UI
  // convenience that fills every line's AccountCode at once, not a saved field.
  const [glAccounts, setGlAccounts] = useState([]);
  // Numbering series pickers: one for this document's own UDO series (SAP
  // object STTL_JWSM), one for the linked Inventory Goods Receipt it creates
  // (SAP object 59) — two separate SAP documents, two separate series lists.
  const [documentSeriesOptions, setDocumentSeriesOptions] = useState([]);
  const [goodsReceiptSeriesOptions, setGoodsReceiptSeriesOptions] = useState([]);

  const loadList = useCallback(async (page = 1, query = searchQuery) => {
    setListLoading(true);
    setPageState((current) => ({ ...current, error: '' }));
    try {
      const { data } = await fetchJobWorkList(TRANSACTION.apiKey, { query, page, pageSize: pagination.pageSize });
      setDocuments(data.documents || []);
      setPagination(data.pagination || pagination);
    } catch (err) {
      setPageState((current) => ({ ...current, error: err.response?.data?.detail || err.message || 'Failed to load documents.' }));
    } finally {
      setListLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadList(1, '');
    fetchJobWorkReferenceData(TRANSACTION.apiKey)
      .then(({ data }) => setReferenceData(data))
      .catch(() => setReferenceData({ parties: [], warehouses: [], items: [], paymentTerms: [], salesEmployees: [], branches: [] }));
    fetchGLAccounts('')
      .then((data) => setGlAccounts(Array.isArray(data) ? data : []))
      .catch(() => setGlAccounts([]));
    fetchJobWorkSeries(TRANSACTION.apiKey)
      .then(({ data }) => setDocumentSeriesOptions(Array.isArray(data) ? data : []))
      .catch(() => setDocumentSeriesOptions([]));
    fetchJobWorkGoodsReceiptSeries(TRANSACTION.apiKey)
      .then(({ data }) => setGoodsReceiptSeriesOptions(Array.isArray(data) ? data : []))
      .catch(() => setGoodsReceiptSeriesOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Default each series picker to SAP's own default series (or the only one,
  // if there's just one) the moment its options load — only for a brand-new
  // document; a loaded document already has its series fixed from creation.
  useEffect(() => {
    if (docEntry || !documentSeriesOptions.length) return;
    setHeader((current) => {
      if (current.Series) return current;
      const defaultSeries = documentSeriesOptions.find((s) => s.isDefault) || documentSeriesOptions[0];
      return defaultSeries ? { ...current, Series: defaultSeries.Series } : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentSeriesOptions, docEntry]);

  useEffect(() => {
    if (docEntry || !goodsReceiptSeriesOptions.length) return;
    setHeader((current) => {
      if (current.GoodsReceiptSeries) return current;
      const defaultSeries = goodsReceiptSeriesOptions.find((s) => s.isDefault) || goodsReceiptSeriesOptions[0];
      return defaultSeries ? { ...current, GoodsReceiptSeries: defaultSeries.Series } : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goodsReceiptSeriesOptions, docEntry]);

  const openNew = () => {
    setDocEntry(null);
    setHeader(emptyHeader());
    setLines([emptyLine()]);
    setPartyAddresses({ list: [], billToDefault: '', shipToDefault: '' });
    setPageState({ loading: false, saving: false, error: '', success: '' });
    setMode('form');
  };

  // Picks SAP's own default address for a side (OCRD.BillToDef/ShipToDef)
  // when one is set and still present in the list; otherwise falls back to
  // the first address of that type so something sensible always loads.
  const pickDefaultAddress = (list, addressType, defaultCode) => {
    const candidates = (list || []).filter((a) => a.address_type === addressType);
    if (!candidates.length) return null;
    if (defaultCode) {
      const matched = candidates.find((a) => a.address_id === defaultCode);
      if (matched) return matched;
    }
    return candidates[0];
  };

  const applyAddressToHeader = (fields, address) => ({
    [fields.addressId]: address?.address_id || '',
    [fields.street]: address?.street || '',
    [fields.streetNo]: address?.street_no || '',
    [fields.building]: address?.building || '',
    [fields.block]: address?.block || '',
    [fields.city]: address?.city || '',
    [fields.zip]: address?.zip_code || '',
    [fields.county]: address?.county || '',
    [fields.country]: address?.country || '',
    [fields.state]: address?.state || '',
    [fields.gstin]: address?.gstin || '',
    [fields.gstType]: address?.gst_type || '',
  });

  // Only loads the address list/defaults for a picker — does not touch the
  // header, so reopening a saved document keeps its already-saved address
  // while still letting the user pick a different one if more exist.
  const loadPartyAddressOptions = (code) => {
    if (!code) {
      setPartyAddresses({ list: [], billToDefault: '', shipToDefault: '' });
      return;
    }
    fetchJobWorkPartyAddresses(TRANSACTION.apiKey, code)
      .then(({ data }) => setPartyAddresses({
        list: data.addresses || [],
        billToDefault: data.billToDefault || '',
        shipToDefault: data.shipToDefault || '',
      }))
      .catch(() => setPartyAddresses({ list: [], billToDefault: '', shipToDefault: '' }));
  };

  // Auto-loads SAP's default Bill-To / Ship-From address when a customer is
  // (re)selected — the user can still switch to a different saved address
  // afterwards if the customer has more than one.
  const applyPartyAddresses = (data) => {
    const list = data.addresses || [];
    const billToDefault = data.billToDefault || '';
    const shipToDefault = data.shipToDefault || '';
    setPartyAddresses({ list, billToDefault, shipToDefault });

    const billTo = pickDefaultAddress(list, 'B', billToDefault);
    const shipFrom = pickDefaultAddress(list, 'S', shipToDefault);
    const { billTo: b, shipFrom: s } = TRANSACTION.addressFields;
    setHeader((current) => ({
      ...current,
      ...(billTo ? applyAddressToHeader(b, billTo) : {}),
      ...(shipFrom ? applyAddressToHeader(s, shipFrom) : {}),
    }));
  };

  // Lets the user pick a different saved address once the customer has more
  // than one Bill-To or Ship-From on file.
  const handleAddressSelect = (addressType, addressId) => {
    const address = partyAddresses.list.find((a) => a.address_type === addressType && a.address_id === addressId);
    const fields = addressType === 'B' ? TRANSACTION.addressFields.billTo : TRANSACTION.addressFields.shipFrom;
    setHeader((current) => ({ ...current, ...applyAddressToHeader(fields, address) }));
  };

  const selectCustomer = (code) => {
    const party = referenceData.parties.find((p) => p.CardCode === code);
    setHeader((current) => ({
      ...current,
      CCode: code,
      CName: party?.CardName || '',
    }));
    if (!code) {
      setPartyAddresses({ list: [], billToDefault: '', shipToDefault: '' });
      return;
    }
    fetchJobWorkPartyAddresses(TRANSACTION.apiKey, code)
      .then(({ data }) => applyPartyAddresses(data))
      .catch(() => { /* address auto-fill is a convenience */ });
  };

  const handleCustomerModalSelect = (bp) => selectCustomer(bp?.CardCode || '');

  const ensureBinsLoaded = useCallback((whsCode) => {
    if (!whsCode || !isWarehouseBinEnabled(referenceData.warehouses, whsCode)) return;
    setBinsByWarehouse((current) => {
      if (current[whsCode]) return current;
      fetchJobWorkBins(TRANSACTION.apiKey, whsCode)
        .then(({ data }) => setBinsByWarehouse((latest) => ({ ...latest, [whsCode]: data.bins || [] })))
        .catch(() => setBinsByWarehouse((latest) => ({ ...latest, [whsCode]: [] })));
      return { ...current, [whsCode]: null }; // mark as "loading" so we don't fetch twice
    });
  }, [referenceData.warehouses]);

  const openDocument = async (row) => {
    setPageState({ loading: true, saving: false, error: '', success: '' });
    try {
      const { data } = await fetchJobWorkByDocEntry(TRANSACTION.apiKey, row.doc_entry);
      setDocEntry(row.doc_entry);
      const loadedHeader = stripUdfPrefix(data.header);
      setHeader(loadedHeader);
      loadPartyAddressOptions(loadedHeader.CCode);
      const rows = (data.lines || []).map(stripUdfPrefix).map((line) => ({
        ...line,
        _batchManaged: isBatchManagedItem(findItem(referenceData.items, line.ICode)),
      }));
      setLines(rows.length ? rows : [emptyLine()]);
      rows.forEach((line) => ensureBinsLoaded(line.WhsCode));
      setMode('form');
    } catch (err) {
      setPageState({ loading: false, saving: false, error: err.response?.data?.detail || err.message || 'Failed to load document.', success: '' });
      return;
    }
    setPageState((current) => ({ ...current, loading: false }));
  };

  // Reciprocal golden arrow entry point (matches the Jobwork Issue Note
  // pattern) — reserved for whenever another page links back here with
  // { customerReceiptDocEntry } in route state.
  useEffect(() => {
    const targetDocEntry = location.state?.customerReceiptDocEntry;
    if (!targetDocEntry) return;
    openDocument({ doc_entry: targetDocEntry }).finally(() => {
      navigate(location.pathname, { replace: true, state: null });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const backToList = () => {
    setMode('list');
    loadList(pagination.page);
  };

  const handleHeaderChange = (name, value) => {
    setHeader((current) => ({ ...current, [name]: value }));
    if (name === 'JWBranch') {
      // Drop any line warehouse selection that no longer belongs to the newly picked branch.
      const stillValid = (whsCode) => {
        if (!whsCode) return true;
        const warehouse = referenceData.warehouses.find((wh) => wh.WhsCode === whsCode);
        return !warehouse?.BranchId || String(warehouse.BranchId) === String(value);
      };
      setLines((current) => current.map((line) => ({
        ...line,
        WhsCode: stillValid(line.WhsCode) ? line.WhsCode : '',
      })));
    }
  };

  const handleLineChange = (index, name, value) => {
    if (name === 'WhsCode') ensureBinsLoaded(value);

    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      if (name === 'ICode') {
        const item = findItem(referenceData.items, value);
        return {
          ...line,
          ICode: value,
          IName: item?.ItemName || '',
          UOM: item?.InventoryUOM || '',
          WhsCode: line.WhsCode || item?.DefaultWarehouse || '',
          _batchManaged: isBatchManagedItem(item),
          // A different item invalidates any batches already created for the old one.
          batches: [],
          Batch: '',
        };
      }
      if (name === 'WhsCode') {
        // Bin/batch selection is warehouse-specific — clear the stale allocations.
        return { ...line, WhsCode: value, BinCode: '', batches: [], Batch: '' };
      }
      return { ...line, [name]: value };
    }));
  };

  const handleItemModalSelect = (item) => {
    const lineIndex = itemModal.lineIndex;
    if (lineIndex < 0) return;
    handleLineChange(lineIndex, 'ICode', item?.ItemCode || item?.itemCode || '');
  };

  // Header-level Warehouse and Bin defaults — set once, applied to every
  // current row (and to new rows going forward), still editable per row after.
  const handleHeaderWarehouseChange = (value) => {
    ensureBinsLoaded(value);
    // A warehouse change invalidates any bin picked for the OLD warehouse, so
    // the header's own bin default is cleared here too — otherwise it stayed
    // populated while every line's BinCode below got wiped, leaving the two
    // out of sync (header shows a bin, the line silently doesn't have one).
    setHeader((current) => ({ ...current, HWhsCode: value, HBinCode: '' }));
    setLines((current) => current.map((line) => ({ ...line, WhsCode: value, BinCode: '' })));
  };

  const handleHeaderBinChange = (value) => {
    setHeader((current) => ({ ...current, HBinCode: value }));
    setLines((current) => current.map((line) => ({ ...line, BinCode: value })));
  };

  const handleDefaultAccountChange = (value) => {
    setHeader((current) => ({ ...current, HAccountCode: value }));
    setLines((current) => current.map((line) => ({ ...line, AccountCode: value })));
  };

  const handleAccountModalSelect = (account) => {
    if (accountModal.lineIndex < 0) {
      handleDefaultAccountChange(account?.code || '');
    } else {
      handleLineChange(accountModal.lineIndex, 'AccountCode', account?.code || '');
    }
    setAccountModal({ open: false, lineIndex: -1 });
  };

  const addLine = () => setLines((current) => [
    ...current,
    { ...emptyLine(), WhsCode: header.HWhsCode || '', BinCode: header.HBinCode || '', AccountCode: header.HAccountCode || '' },
  ]);
  const removeLine = (index) => setLines((current) => (
    current.length > 1 ? current.filter((_, i) => i !== index) : [emptyLine()]
  ));

  // Batch handling mirrors the real Goods Receipt page (frontend/src/modules/goods-receipt/GoodsReceipt.jsx):
  // BatchAllocationModal in "receipt" mode lets the user CREATE new batch
  // numbers (with quantity + expiry date) rather than just pick from
  // existing stock, since this document is adding new inventory, not
  // drawing down existing batches.
  const openBatchModal = async (lineIndex) => {
    const line = lines[lineIndex];
    if (!String(line?.ICode || '').trim()) {
      setPageState((current) => ({ ...current, error: 'Select an item before allocating batches.' }));
      return;
    }
    if (!String(line?.WhsCode || '').trim()) {
      setPageState((current) => ({ ...current, error: 'Select a Warehouse before allocating batches.' }));
      return;
    }

    setBatchModal({ open: true, lineIndex, availableBatches: [], loading: true, error: '' });
    try {
      const response = await fetchGoodsReceiptBatchesByItem(line.ICode, line.WhsCode);
      setBatchModal((current) => (
        current.lineIndex === lineIndex
          ? { ...current, availableBatches: response.data?.batches || [], loading: false }
          : current
      ));
    } catch (err) {
      setBatchModal((current) => (
        current.lineIndex === lineIndex
          ? { ...current, availableBatches: [], loading: false, error: err.response?.data?.detail || err.message || 'Failed to load warehouse batches.' }
          : current
      ));
    }
  };

  const closeBatchModal = () => setBatchModal({ open: false, lineIndex: -1, availableBatches: [], loading: false, error: '' });

  const saveLineBatches = (nextBatches) => {
    if (batchModal.lineIndex < 0) return;
    setLines((current) => current.map((line, i) => (
      i === batchModal.lineIndex
        ? { ...line, batches: nextBatches, Batch: nextBatches.map((b) => b.batchNumber).join(', ') }
        : line
    )));
    closeBatchModal();
  };

  const generateNextBatchNumber = () => fetchGoodsReceiptNextBatchNumber();

  const validate = (validLines) => {
    if (!String(header.CCode || '').trim()) return 'Customer is required.';
    if (referenceData.branches.length && !String(header.JWBranch || '').trim()) return 'Branch is required.';
    if (!validLines.length) return 'Add at least one material line before saving.';
    for (let i = 0; i < validLines.length; i += 1) {
      const line = validLines[i];
      const rowLabel = `Line ${i + 1}`;
      if (!String(line.ICode || '').trim()) return `${rowLabel}: Item Code is required.`;
      if (!(Number(line.Qty) > 0)) return `${rowLabel}: Quantity must be greater than zero.`;
      if (!String(line.WhsCode || '').trim()) return `${rowLabel}: Warehouse is required.`;
      if (line._batchManaged && !(Array.isArray(line.batches) && line.batches.length)) {
        return `${rowLabel}: Item ${line.ICode} is batch-managed — at least one Batch allocation is required.`;
      }
      if (isWarehouseBinEnabled(referenceData.warehouses, line.WhsCode) && !String(line.BinCode || '').trim()) {
        return `${rowLabel}: Warehouse ${line.WhsCode} requires a Bin Location.`;
      }
    }
    return null;
  };

  const handleSave = async () => {
    const validLines = lines
      .filter((line) => TRANSACTION.lineFields.some((f) => String(line[f.name] || '').trim()))
      .map((line) => Object.fromEntries(Object.entries(line).filter(([key]) => !isTransientKey(key))));

    const validationMessage = validate(validLines);
    if (validationMessage) {
      setPageState((current) => ({ ...current, error: validationMessage, success: '' }));
      return;
    }

    setPageState((current) => ({ ...current, saving: true, error: '', success: '' }));
    try {
      const payload = { header, lines: { [TRANSACTION.lineTable]: validLines } };
      const { data } = docEntry
        ? await updateJobWork(TRANSACTION.apiKey, docEntry, payload)
        : await submitJobWork(TRANSACTION.apiKey, payload);
      const goodsReceiptDocNum = data.stock_movements?.goodsReceipt?.docNum;
      const successMessage = `${data.message || 'Customer Receipt Note saved.'}`
        + `${data.doc_num ? ` Doc No: ${data.doc_num}.` : ''}`
        + `${goodsReceiptDocNum ? ` Goods Receipt Doc No: ${goodsReceiptDocNum}.` : ''}`;
      if (data.warning) {
        // eslint-disable-next-line no-alert
        window.alert(data.warning);
      }
      // Reopen the saved document (rather than resetting to the list) so any
      // linked Inventory Goods Receipt created by the save is immediately visible.
      await openDocument({ doc_entry: data.doc_entry });
      setPageState((current) => ({ ...current, success: successMessage }));
    } catch (err) {
      setPageState((current) => ({
        ...current,
        saving: false,
        error: err.response?.data?.detail || err.message || 'Failed to save document.',
      }));
    }
  };

  const totalQuantity = lines
    .filter((line) => line.ICode)
    .reduce((sum, line) => sum + Number(line.Qty || 0), 0)
    .toFixed(2);

  // ---------------- LIST VIEW ----------------
  if (mode === 'list') {
    return (
      <div className="container-fluid sap-find-page">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2 className="mb-1">Customer Receipt Note</h2>
            <small className="text-muted">Material received back from a customer after job work.</small>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={openNew}>+ New</button>
        </div>

        {pageState.error && <div className="alert alert-danger" role="alert">{pageState.error}</div>}

        <div className="card p-3 sap-find-card">
          <div className="sap-find-results-row mb-3">
            <div className="sap-find-global-field">
              <label className="form-label mb-1">Search</label>
              <input
                type="search"
                className="form-control"
                placeholder="Search by Doc No or Customer"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') loadList(1); }}
              />
            </div>
            <div className="sap-find-results-tools">
              <div className="d-flex align-items-center justify-content-sm-end gap-2 h-100">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => loadList(1)}>Search</button>
              </div>
            </div>
          </div>

          <div className="table-responsive sap-find-table-wrap">
            <table className="table table-bordered table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Action</th>
                  <th>Doc No</th>
                  <th>Customer Code</th>
                  <th>Customer Name</th>
                  <th>Posting Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {listLoading && (
                  <tr><td colSpan={6} className="text-center py-4">Loading Customer Receipt Notes...</td></tr>
                )}
                {!listLoading && !documents.length && (
                  <tr><td colSpan={6} className="text-center text-muted py-4">No Customer Receipt Notes found.</td></tr>
                )}
                {!listLoading && documents.map((doc) => (
                  <tr key={doc.doc_entry} onDoubleClick={() => openDocument(doc)} style={{ cursor: 'pointer' }}>
                    <td>
                      <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => openDocument(doc)}>Select</button>
                    </td>
                    <td>{doc.doc_num}</td>
                    <td>{doc.party_code}</td>
                    <td>{doc.party_name}</td>
                    <td>{doc.posting_date}</td>
                    <td>{doc.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="d-flex justify-content-between align-items-center mt-3">
            <small className="text-muted">Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} total)</small>
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="btn btn-outline-secondary btn-sm" disabled={pagination.page <= 1} onClick={() => loadList(pagination.page - 1)}>Previous</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" disabled={pagination.page >= pagination.totalPages} onClick={() => loadList(pagination.page + 1)}>Next</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- FORM VIEW ----------------
  const modeBadgeClass = docEntry ? 'po-mode-badge--update' : 'po-mode-badge--add';
  const billToAddresses = partyAddresses.list.filter((a) => a.address_type === 'B');
  const shipFromAddresses = partyAddresses.list.filter((a) => a.address_type === 'S');
  // Warehouses with no branch assigned stay visible regardless of the selected branch.
  const branchFilteredWarehouses = header.JWBranch
    ? referenceData.warehouses.filter((wh) => !wh.BranchId || String(wh.BranchId) === String(header.JWBranch))
    : referenceData.warehouses;
  const { goodsReceiptDocEntry, goodsReceiptDocNum } = getStockMovementRefs(header);
  // Once the real Inventory Goods Receipt has been posted, everything that
  // could desync from what SAP actually moved (customer, dates, branch,
  // warehouse, bins, lines, addresses) is locked — only the informational
  // fields in LOCKED_EDITABLE_FIELDS stay editable, and Update never re-posts.
  const isLocked = Boolean(docEntry) && Boolean(goodsReceiptDocEntry);
  const openLinkedGoodsReceipt = () => {
    if (!goodsReceiptDocEntry) return;
    navigate('/goods-receipt', {
      state: createActiveCompanyScopedRouteState({ goodsReceiptDocEntry }),
    });
  };

  return (
    <div className="po-page jw-receipt-note-page">
      <div className="po-toolbar">
        <div className="po-toolbar__title">
          Customer Receipt Note{docEntry ? ` - #${docEntry}` : ''}
        </div>
        <span className={`po-mode-badge ${modeBadgeClass}`}>{docEntry ? 'Update' : 'Add'} Mode</span>
        <button type="button" className="po-btn po-btn--primary" onClick={handleSave} disabled={pageState.saving}>
          {pageState.saving ? 'Saving...' : docEntry ? 'Update' : 'Add'}
        </button>
        <button type="button" className="po-btn" onClick={backToList}>Cancel</button>
<button type="button" className="po-btn" data-sap-find-action onClick={backToList}>Find</button>
        <button type="button" className="po-btn" onClick={openNew}>New</button>
        {goodsReceiptDocEntry ? (
          <PrintLayoutToolbar
            documentType="inventoryGoodsReceipt"
            documentLabel="Inventory Goods Receipt"
            docEntry={goodsReceiptDocEntry}
            docNumber={goodsReceiptDocNum}
            classPrefix="po"
            onSuccess={(message) => setPageState((current) => ({ ...current, error: '', success: message }))}
            onError={(message) => setPageState((current) => ({ ...current, error: message, success: '' }))}
          />
        ) : null}
      </div>

      {pageState.loading && <div className="po-alert po-alert--success">Loading...</div>}
      {pageState.error && <div className="po-alert po-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="po-alert po-alert--success">{pageState.success}</div>}

      <div className="po-header-card jw-header-card">
        {isLocked ? (
          <div className="jw-header-lockband">
            🔒 Stock already received for this document — customer, dates, warehouse and bins are locked. Only the logistics fields below can still be edited.
          </div>
        ) : null}

        <div className="jw-header-grid">
          <div className="jw-header-column">
            <div className="po-field jw-field">
              <label className="po-field__label">Customer</label>
              <div className="jw-field__selector">
                <input
                  className="po-field__input"
                  value={header.CCode || ''}
                  placeholder="Customer Code"
                  disabled={isLocked}
                  onChange={(e) => setHeader((current) => ({ ...current, CCode: e.target.value }))}
                  onBlur={() => {
                    const code = String(header.CCode || '').trim();
                    const matched = referenceData.parties.find((p) => p.CardCode.toLowerCase() === code.toLowerCase());
                    if (matched) selectCustomer(matched.CardCode);
                  }}
                />
                <button type="button" className="po-btn" style={{ minWidth: 36, paddingInline: 0 }} onClick={() => setCustomerModalOpen(true)} disabled={isLocked} title="Select Customer">...</button>
              </div>
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Name</label>
              <input className="po-field__input" value={header.CName || ''} readOnly />
            </div>
            {referenceData.branches.length > 0 ? (
              <div className="po-field jw-field">
                <label className="po-field__label">Branch</label>
                <select className="po-field__select" value={header.JWBranch || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('JWBranch', e.target.value)}>
                  <option value="">Select Branch</option>
                  {referenceData.branches.map((branch) => (
                    <option key={branch.BPLId} value={branch.BPLId}>{branch.BPLName}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="po-field jw-field">
              <label className="po-field__label">Warehouse</label>
              <select className="po-field__select" value={header.HWhsCode || ''} disabled={isLocked} onChange={(e) => handleHeaderWarehouseChange(e.target.value)}>
                <option value="">Select (applies to all lines)</option>
                {branchFilteredWarehouses.map((wh) => (
                  <option key={wh.WhsCode} value={wh.WhsCode}>{wh.WhsCode} - {wh.WhsName}</option>
                ))}
              </select>
            </div>
            {isWarehouseBinEnabled(referenceData.warehouses, header.HWhsCode) ? (
              <div className="po-field jw-field">
                <label className="po-field__label">Bin</label>
                <select className="po-field__select" value={header.HBinCode || ''} disabled={isLocked} onChange={(e) => handleHeaderBinChange(e.target.value)}>
                  <option value="">Select Bin</option>
                  {binOptionsWithCurrentValue(binsByWarehouse[header.HWhsCode], header.HBinCode).map((bin) => (
                    <option key={bin.BinAbsEntry} value={bin.BinCode}>{bin.BinCode}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="po-field jw-field">
              <label className="po-field__label">Kata Weight</label>
              <input className="po-field__input" value={header.KNTWEIGHT || ''} onChange={(e) => handleHeaderChange('KNTWEIGHT', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Default Account</label>
              <div className="jw-field__selector">
                <input
                  className="po-field__input"
                  value={header.HAccountCode || ''}
                  placeholder="Account Code (applies to all lines)"
                  disabled={isLocked}
                  onChange={(e) => handleDefaultAccountChange(e.target.value)}
                />
                <button type="button" className="po-btn" style={{ minWidth: 36, paddingInline: 0 }} onClick={() => setAccountModal({ open: true, lineIndex: -1 })} disabled={isLocked} title="Select Account">...</button>
              </div>
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Nature Of Process</label>
              <input className="po-field__input" value={header.NatureP || ''} onChange={(e) => handleHeaderChange('NatureP', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">E-Way Bill No</label>
              <input className="po-field__input" value={header.EWBILLNO || ''} onChange={(e) => handleHeaderChange('EWBILLNO', e.target.value)} />
            </div>
          </div>

          <div className="jw-header-column">
            <div className="po-field jw-field">
              <label className="po-field__label">Document Series</label>
              {docEntry ? (
                <input
                  className="po-field__input"
                  value={[
                    documentSeriesOptions.find((s) => String(s.Series) === String(header.Series))?.SeriesName,
                    header.DocNum,
                  ].filter(Boolean).join(' - ')}
                  readOnly
                />
              ) : (
                <div className="jw-field__selector">
                  <select className="po-field__select" value={header.Series || ''} onChange={(e) => handleHeaderChange('Series', e.target.value)}>
                    <option value="">Select Series</option>
                    {documentSeriesOptions.map((s) => (
                      <option key={s.Series} value={s.Series}>{s.SeriesName || s.DisplayName || s.Series}</option>
                    ))}
                  </select>
                  {/* Preview only — SAP assigns the real number at posting time, since
                      this can change if another document uses the series first; the
                      number itself is never sent, only the chosen Series id. */}
                  <input
                    className="po-field__input"
                    style={{ maxWidth: 90 }}
                    value={header.Series ? (documentSeriesOptions.find((s) => String(s.Series) === String(header.Series))?.NextNumber ?? '—') : ''}
                    placeholder="Next No"
                    readOnly
                  />
                </div>
              )}
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Goods Receipt Series</label>
              {goodsReceiptDocEntry ? (
                <div className="jw-field__selector">
                  <input className="po-field__input" value={`Doc No: ${goodsReceiptDocNum || goodsReceiptDocEntry}`} readOnly />
                  <button
                    type="button"
                    onClick={openLinkedGoodsReceipt}
                    title="Open Goods Receipt"
                    style={{
                      minWidth: 30, height: 25, cursor: 'pointer', border: 'none', background: 'transparent',
                      color: '#c98a00', fontSize: 18, lineHeight: 1, fontWeight: 700,
                    }}
                  >
                    ↗
                  </button>
                </div>
              ) : (
                <div className="jw-field__selector">
                  <select className="po-field__select" value={header.GoodsReceiptSeries || ''} onChange={(e) => handleHeaderChange('GoodsReceiptSeries', e.target.value)}>
                    <option value="">Select Series</option>
                    {goodsReceiptSeriesOptions.map((s) => (
                      <option key={s.Series} value={s.Series}>{s.SeriesName || s.DisplayName || s.Series}</option>
                    ))}
                  </select>
                  <input
                    className="po-field__input"
                    style={{ maxWidth: 90 }}
                    value={header.GoodsReceiptSeries ? (goodsReceiptSeriesOptions.find((s) => String(s.Series) === String(header.GoodsReceiptSeries))?.NextNumber ?? '—') : ''}
                    placeholder="Next No"
                    readOnly
                  />
                </div>
              )}
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Document Date</label>
              <SapDateInput  className="po-field__input" value={header.DocDate || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('DocDate', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Posting Date</label>
              <SapDateInput  className="po-field__input" value={header.PDate || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('PDate', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Challan No</label>
              <input className="po-field__input" value={header.ChallanNo || ''} onChange={(e) => handleHeaderChange('ChallanNo', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Challan Date</label>
              <SapDateInput  className="po-field__input" value={header.ChallanDt || ''} onChange={(e) => handleHeaderChange('ChallanDt', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Transporter Name</label>
              <input className="po-field__input" value={header.TranName || ''} onChange={(e) => handleHeaderChange('TranName', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Vehicle Number</label>
              <input className="po-field__input" value={header.VEHNO || ''} onChange={(e) => handleHeaderChange('VEHNO', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="po-tabs">
        {['Materials', 'Bill To / Ship To'].map((tabName) => (
          <button
            key={tabName}
            type="button"
            className={`po-tab${activeTab === tabName ? ' po-tab--active' : ''}`}
            onClick={() => setActiveTab(tabName)}
          >
            {tabName}
          </button>
        ))}
      </div>

      {activeTab === 'Materials' && (
      <div className="po-tab-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="po-section-title" style={{ marginBottom: 0 }}>Materials</div>
          {isLocked ? (
            <span className="po-mode-badge" title="The Inventory Goods Receipt for this document has already been posted — items, quantities, warehouse and bins can no longer change.">Locked — stock movement posted</span>
          ) : (
            <button type="button" className="po-btn po-btn--primary" onClick={addLine}>+ Add Line</button>
          )}
        </div>

        <div className="po-grid-wrap">
          <table className="po-grid">
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th style={{ width: 50 }}>Line ID</th>
                <th>Item Code</th>
                <th>Description</th>
                <th>Quantity</th>
                <th>Warehouse</th>
                <th>UoM</th>
                <th>Batch</th>
                <th>Bin Code</th>
                <th>Price</th>
                <th>Account Code</th>
                <th>Remarks</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={index}>
                  <td className="po-grid__cell--muted" style={{ textAlign: 'center' }}>{index + 1}</td>
                  <td className="po-grid__cell--muted" style={{ textAlign: 'center' }} title="SAP's internal line identifier — blank until this row is saved">
                    {line.LineId ?? '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <input
                        className="po-grid__input po-grid__input--text"
                        value={line.ICode || ''}
                        placeholder="Item Code"
                        disabled={isLocked}
                        onChange={(e) => handleLineChange(index, 'ICode', e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setItemModal({ open: true, lineIndex: index })}
                        disabled={isLocked}
                        style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                        title="Select Item"
                      >
                        ...
                      </button>
                    </div>
                  </td>
                  <td><input className="po-grid__input po-grid__input--text" value={line.IName || ''} readOnly /></td>
                  <td><input className="po-grid__input" type="number" value={line.Qty || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'Qty', e.target.value)} /></td>
                  <td>
                    <select className="po-grid__input po-grid__input--text" value={line.WhsCode || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'WhsCode', e.target.value)}>
                      <option value="">Select</option>
                      {branchFilteredWarehouses.map((wh) => (
                        <option key={wh.WhsCode} value={wh.WhsCode}>{wh.WhsCode} - {wh.WhsName}</option>
                      ))}
                    </select>
                  </td>
                  <td><input className="po-grid__input po-grid__input--text" value={line.UOM || ''} readOnly /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <input
                        className="po-grid__input po-grid__input--text"
                        value={line.batches?.length ? line.batches.map((b) => b.batchNumber).join(', ') : (line.Batch || '')}
                        readOnly
                        placeholder={line._batchManaged ? 'Create batch' : 'Batch'}
                      />
                      <button
                        type="button"
                        onClick={() => openBatchModal(index)}
                        disabled={isLocked}
                        style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                        title="Create/Allocate Batches"
                      >
                        ...
                      </button>
                    </div>
                    {line._batchManaged ? <div className="po-error-feedback">required</div> : null}
                  </td>
                  <td>
                    {isWarehouseBinEnabled(referenceData.warehouses, line.WhsCode) ? (
                      <select className="po-grid__input po-grid__input--text" value={line.BinCode || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'BinCode', e.target.value)}>
                        <option value="">Select Bin</option>
                        {binOptionsWithCurrentValue(binsByWarehouse[line.WhsCode], line.BinCode).map((bin) => (
                          <option key={bin.BinAbsEntry} value={bin.BinCode}>{bin.BinCode}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="po-grid__input po-grid__input--text" value={line.BinCode || ''} onChange={(e) => handleLineChange(index, 'BinCode', e.target.value)} disabled={isLocked || !line.WhsCode} placeholder={line.WhsCode ? '' : 'Select warehouse first'} />
                    )}
                  </td>
                  <td><input className="po-grid__input" type="number" value={line.Price || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'Price', e.target.value)} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <input
                        className="po-grid__input po-grid__input--text"
                        value={line.AccountCode || ''}
                        placeholder="Account Code"
                        disabled={isLocked}
                        onChange={(e) => handleLineChange(index, 'AccountCode', e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setAccountModal({ open: true, lineIndex: index })}
                        disabled={isLocked}
                        style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                        title="Select Account"
                      >
                        ...
                      </button>
                    </div>
                  </td>
                  <td><input className="po-grid__input po-grid__input--text" value={line.Remarks || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'Remarks', e.target.value)} /></td>
                  <td style={{ textAlign: 'center' }}>
                    {!isLocked && (
                      <button type="button" className="po-btn po-btn--danger" style={{ padding: '1px 7px' }} onClick={() => removeLine(index)}>x</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {activeTab === 'Bill To / Ship To' && (
      <div className="po-tab-panel">
        <fieldset disabled={isLocked} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="row g-2">
          <div className="col-md-6">
            <div className="po-section-title">Bill To</div>
            <div className="po-field">
              <label className="po-field__label">Bill To</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.toggle] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.toggle, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Address ID</label>
              {billToAddresses.length > 1 ? (
                <select
                  className="po-field__select"
                  value={header[TRANSACTION.addressFields.billTo.addressId] || ''}
                  onChange={(e) => handleAddressSelect('B', e.target.value)}
                >
                  {billToAddresses.map((address) => (
                    <option key={address.address_id} value={address.address_id}>
                      {address.address_id}{address.city ? ` - ${address.city}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.addressId] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.addressId, e.target.value)} />
              )}
            </div>
            <div className="po-field">
              <label className="po-field__label">Street</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.street] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.street, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Street No</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.streetNo] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.streetNo, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Building/Floor/Room</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.building] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.building, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Block</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.block] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.block, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">City</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.city] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.city, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Zip Code</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.zip] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.zip, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">County</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.county] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.county, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Country</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.country] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.country, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">State</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.state] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.state, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">GSTIN</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.gstin] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.gstin, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">GST Type</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.gstType] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.gstType, e.target.value)} />
            </div>
          </div>

          <div className="col-md-6">
            <div className="po-section-title">Ship From</div>
            <div className="po-field">
              <label className="po-field__label">Ship From</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.toggle] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.toggle, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Address ID</label>
              {shipFromAddresses.length > 1 ? (
                <select
                  className="po-field__select"
                  value={header[TRANSACTION.addressFields.shipFrom.addressId] || ''}
                  onChange={(e) => handleAddressSelect('S', e.target.value)}
                >
                  {shipFromAddresses.map((address) => (
                    <option key={address.address_id} value={address.address_id}>
                      {address.address_id}{address.city ? ` - ${address.city}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.addressId] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.addressId, e.target.value)} />
              )}
            </div>
            <div className="po-field">
              <label className="po-field__label">Street</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.street] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.street, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Street No</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.streetNo] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.streetNo, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Building/Floor/Room</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.building] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.building, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Block</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.block] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.block, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">City</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.city] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.city, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Zip Code</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.zip] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.zip, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">County</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.county] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.county, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">Country</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.country] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.country, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">State</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.state] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.state, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">GSTIN</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.gstin] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.gstin, e.target.value)} />
            </div>
            <div className="po-field">
              <label className="po-field__label">GST Type</label>
              <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.gstType] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.gstType, e.target.value)} />
            </div>
          </div>
        </div>
        </fieldset>
      </div>
      )}

      <div className="po-field" style={{ maxWidth: 480 }}>
        <label className="po-field__label" style={{ paddingTop: 4 }}>Remarks</label>
        <textarea className="po-textarea" rows={3} value={header[TRANSACTION.remarksField] || ''} disabled={isLocked} onChange={(e) => handleHeaderChange(TRANSACTION.remarksField, e.target.value)} />
      </div>

      <div className="po-toolbar">
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <label className="po-field__label" style={{ width: 'auto' }}>Total Qty</label>
          <input className="po-field__input" style={{ width: 120 }} value={totalQuantity} readOnly />
        </div>
      </div>

      <ItemSelectionModal
        isOpen={itemModal.open}
        onClose={() => setItemModal({ open: false, lineIndex: -1 })}
        onSelect={handleItemModalSelect}
        items={referenceData.items.map((item) => ({ ItemCode: item.ItemCode, ItemName: item.ItemName }))}
      />

      <BusinessPartnerModal
        isOpen={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
        onSelect={handleCustomerModalSelect}
        businessPartners={referenceData.parties.map((p) => ({ CardCode: p.CardCode, CardName: p.CardName, CardType: p.CardType }))}
        title="List of Customers"
      />

      <BatchAllocationModal
        isOpen={batchModal.open}
        mode="receipt"
        line={batchModal.lineIndex >= 0 ? {
          itemNo: lines[batchModal.lineIndex]?.ICode,
          whse: lines[batchModal.lineIndex]?.WhsCode,
          quantity: lines[batchModal.lineIndex]?.Qty,
          inventoryUOM: lines[batchModal.lineIndex]?.UOM,
          batches: lines[batchModal.lineIndex]?.batches || [],
        } : null}
        availableBatches={batchModal.availableBatches}
        loading={batchModal.loading}
        error={batchModal.error}
        onGenerateBatchNumber={generateNextBatchNumber}
        onClose={closeBatchModal}
        onSave={saveLineBatches}
      />

      <AccountLookupModal
        isOpen={accountModal.open}
        onClose={() => setAccountModal({ open: false, lineIndex: -1 })}
        onSelect={handleAccountModalSelect}
        accounts={glAccounts}
        title="List of Accounts"
      />
    </div>
  );
}
