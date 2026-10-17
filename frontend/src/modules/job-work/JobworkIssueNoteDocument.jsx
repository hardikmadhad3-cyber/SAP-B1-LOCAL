import SapDateInput from '../../components/common/SapDateInput';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import '../purchase-order/styles/purchaseOrder.css';
import '../../styles/sales-order-list.css';
import './styles/jobworkIssueNote.css';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import BatchAllocationModal from '../../components/BatchAllocationModal';
import { fetchGoodsIssueBatchesByItem } from '../../api/goodsIssueApi';
import { sumBatchQty } from '../../utils/batchQuantity';
import { createActiveCompanyScopedRouteState } from '../../utils/companyStorageScope';
import {
  fetchJobWorkBins,
  fetchJobWorkByDocEntry,
  fetchJobWorkList,
  fetchJobWorkPartyAddresses,
  fetchJobWorkReferenceData,
  submitJobWork,
  updateJobWork,
} from '../../api/jobWorkApi';
import { JOB_WORK_TRANSACTIONS } from './jobWorkTransactions';

const TRANSACTION = JOB_WORK_TRANSACTIONS.jobworkIssueNote;
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

// Backend stores the linked Inventory Transfer / Goods Issue reference in
// dedicated fields (see jobWorkSchema.js's WebInvTraDocEntry etc.) — kept
// separate from the legacy InvTraNo field, which is stuck at a 1-character
// size in this company's DB.
const getStockMovementRefs = (header) => ({
  inventoryTransferDocEntry: header.WebInvTraDocEntry ? Number(header.WebInvTraDocEntry) : null,
  inventoryTransferDocNum: header.WebInvTraDocNum ? Number(header.WebInvTraDocNum) : null,
  goodsIssueDocEntry: header.WebGoodsIssDocEntry ? Number(header.WebGoodsIssDocEntry) : null,
  goodsIssueDocNum: header.WebGoodsIssDocNum ? Number(header.WebGoodsIssDocNum) : null,
});

const emptyLine = () => ({
  ...TRANSACTION.lineFields.reduce((acc, field) => {
    acc[field.name] = '';
    return acc;
  }, {}),
  batches: [],
});

const emptyHeader = () => ({ DOCDATE: today(), PDATE: today(), DDATE: today() });

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

export default function JobworkIssueNoteDocument() {
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
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1 });
  const [batchModal, setBatchModal] = useState({ open: false, lineIndex: -1, availableBatches: [], loading: false, error: '' });
  const [activeTab, setActiveTab] = useState('Materials');
  // Bin lists are fetched lazily per warehouse (only bin-managed ones ever need them) and cached here.
  const [binsByWarehouse, setBinsByWarehouse] = useState({});
  // The vendor's saved Bill-To / Ship-From addresses (SAP CRD1), plus SAP's
  // own default address codes (OCRD.BillToDef/ShipToDef) — lets the UI offer
  // a picker only when there's more than one address to choose from.
  const [partyAddresses, setPartyAddresses] = useState({ list: [], billToDefault: '', shipToDefault: '' });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setDocEntry(null);
    setHeader(emptyHeader());
    setLines([emptyLine()]);
    setPartyAddresses({ list: [], billToDefault: '', shipToDefault: '' });
    setPageState({ loading: false, saving: false, error: '', success: '' });
    setMode('form');
  };

  const openDocument = async (row) => {
    setPageState({ loading: true, saving: false, error: '', success: '' });
    try {
      const { data } = await fetchJobWorkByDocEntry(TRANSACTION.apiKey, row.doc_entry);
      setDocEntry(row.doc_entry);
      const loadedHeader = stripUdfPrefix(data.header);
      setHeader(loadedHeader);
      loadPartyAddressOptions(loadedHeader.VENCOD);
      const rows = (data.lines || []).map(stripUdfPrefix).map((line) => ({
        ...line,
        _batchManaged: isBatchManagedItem(findItem(referenceData.items, line.MITMNO)),
      }));
      setLines(rows.length ? rows : [emptyLine()]);
      rows.forEach((line) => {
        ensureBinsLoaded(line.MWHS);
        ensureBinsLoaded(line.TWHS);
      });
      setMode('form');
    } catch (err) {
      setPageState({ loading: false, saving: false, error: err.response?.data?.detail || err.message || 'Failed to load document.', success: '' });
      return;
    }
    setPageState((current) => ({ ...current, loading: false }));
  };

  // Reciprocal golden arrow: arriving here from the Inventory Transfer page's
  // "Jobwork Issue Note" link opens that document directly instead of the list.
  useEffect(() => {
    const targetDocEntry = location.state?.jobworkIssueNoteDocEntry;
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
    if (name === 'BRNCH') {
      // Drop any line warehouse selections that no longer belong to the newly picked branch.
      const stillValid = (whsCode) => {
        if (!whsCode) return true;
        const warehouse = referenceData.warehouses.find((wh) => wh.WhsCode === whsCode);
        return !warehouse?.BranchId || String(warehouse.BranchId) === String(value);
      };
      setLines((current) => current.map((line) => ({
        ...line,
        MWHS: stillValid(line.MWHS) ? line.MWHS : '',
        TWHS: stillValid(line.TWHS) ? line.TWHS : '',
      })));
    }
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

  // Auto-loads SAP's default Bill-To / Ship-From address when a vendor is
  // (re)selected — the user can still switch to a different saved address
  // afterwards if the vendor has more than one.
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

  // Lets the user pick a different saved address once the vendor has more
  // than one Bill-To or Ship-From on file.
  const handleAddressSelect = (addressType, addressId) => {
    const address = partyAddresses.list.find((a) => a.address_type === addressType && a.address_id === addressId);
    const fields = addressType === 'B' ? TRANSACTION.addressFields.billTo : TRANSACTION.addressFields.shipFrom;
    setHeader((current) => ({ ...current, ...applyAddressToHeader(fields, address) }));
  };

  const selectVendor = (code) => {
    const party = referenceData.parties.find((p) => p.CardCode === code);
    setHeader((current) => ({
      ...current,
      VENCOD: code,
      VENNAME: party?.CardName || '',
      JWOPAYT: party?.GroupNum ?? '',
      SLSEMP: party?.SlpCode ?? '',
    }));
    if (!code) {
      setPartyAddresses({ list: [], billToDefault: '', shipToDefault: '' });
      return;
    }
    fetchJobWorkPartyAddresses(TRANSACTION.apiKey, code)
      .then(({ data }) => applyPartyAddresses(data))
      .catch(() => { /* address auto-fill is a convenience */ });
  };

  const handleVendorModalSelect = (bp) => selectVendor(bp?.CardCode || '');

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

  const handleLineChange = (index, name, value) => {
    if (name === 'MWHS' || name === 'TWHS') ensureBinsLoaded(value);

    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      if (name === 'MITMNO') {
        const item = findItem(referenceData.items, value);
        return {
          ...line,
          MITMNO: value,
          MDES: item?.ItemName || '',
          MUOM: item?.InventoryUOM || '',
          MWHS: line.MWHS || item?.DefaultWarehouse || '',
          _batchManaged: isBatchManagedItem(item),
          // A different item invalidates any batches already picked for the old one.
          batches: [],
          MBatch: '',
        };
      }
      if (name === 'MWHS') {
        // Available batches/bins are warehouse-specific — clear the stale allocations.
        return { ...line, MWHS: value, batches: [], MBatch: '', MBinCode: '' };
      }
      if (name === 'TWHS') {
        return { ...line, TWHS: value, ToBinCode: '' };
      }
      return { ...line, [name]: value };
    }));
  };

  const handleItemModalSelect = (item) => {
    const lineIndex = itemModal.lineIndex;
    if (lineIndex < 0) return;
    handleLineChange(lineIndex, 'MITMNO', item?.ItemCode || item?.itemCode || '');
  };

  // Header-level From/To Warehouse and Bin defaults — set once, applied to every
  // current row (and to new rows going forward), still editable per row after.
  const handleHeaderWarehouseChange = (headerField, lineField, value) => {
    setHeader((current) => ({ ...current, [headerField]: value }));
    ensureBinsLoaded(value);
    const binField = lineField === 'MWHS' ? 'MBinCode' : 'ToBinCode';
    setLines((current) => current.map((line) => ({ ...line, [lineField]: value, [binField]: '' })));
  };

  const handleHeaderBinChange = (headerField, lineField, value) => {
    setHeader((current) => ({ ...current, [headerField]: value }));
    setLines((current) => current.map((line) => ({ ...line, [lineField]: value })));
  };

  const addLine = () => setLines((current) => [
    ...current,
    {
      ...emptyLine(),
      MWHS: header.HMWHS || '',
      TWHS: header.HTWHS || '',
      MBinCode: header.HMBinCode || '',
      ToBinCode: header.HToBinCode || '',
    },
  ]);
  const removeLine = (index) => setLines((current) => (
    current.length > 1 ? current.filter((_, i) => i !== index) : [emptyLine()]
  ));

  const openBatchModal = async (lineIndex) => {
    const line = lines[lineIndex];
    if (!String(line?.MITMNO || '').trim()) {
      setPageState((current) => ({ ...current, error: 'Select an item before allocating batches.' }));
      return;
    }
    if (!String(line?.MWHS || '').trim()) {
      setPageState((current) => ({ ...current, error: 'Select a From Warehouse before allocating batches.' }));
      return;
    }

    setBatchModal({ open: true, lineIndex, availableBatches: [], loading: true, error: '' });
    try {
      const response = await fetchGoodsIssueBatchesByItem(line.MITMNO, line.MWHS);
      setBatchModal((current) => (
        current.lineIndex === lineIndex
          ? { ...current, availableBatches: response.data?.batches || [], loading: false }
          : current
      ));
    } catch (err) {
      setBatchModal((current) => (
        current.lineIndex === lineIndex
          ? { ...current, availableBatches: [], loading: false, error: err.response?.data?.detail || err.message || 'Failed to load available batches.' }
          : current
      ));
    }
  };

  const closeBatchModal = () => setBatchModal({ open: false, lineIndex: -1, availableBatches: [], loading: false, error: '' });

  const saveLineBatches = (nextBatches) => {
    if (batchModal.lineIndex < 0) return;
    setLines((current) => current.map((line, i) => (
      i === batchModal.lineIndex
        ? { ...line, batches: nextBatches, MBatch: nextBatches.map((b) => b.batchNumber).join(', ') }
        : line
    )));
    closeBatchModal();
  };

  const validate = (validLines) => {
    if (!String(header.VENCOD || '').trim()) return 'Vendor is required.';
    if (referenceData.branches.length && !String(header.BRNCH || '').trim()) return 'Branch is required.';
    if (!validLines.length) return 'Add at least one material line before saving.';
    for (let i = 0; i < validLines.length; i += 1) {
      const line = validLines[i];
      const rowLabel = `Line ${i + 1}`;
      if (!String(line.MITMNO || '').trim()) return `${rowLabel}: Item Code is required.`;
      if (!(Number(line.MQTY) > 0)) return `${rowLabel}: Quantity must be greater than zero.`;
      if (!String(line.MWHS || '').trim()) return `${rowLabel}: From Warehouse is required.`;
      if (line._batchManaged && !String(line.MBatch || '').trim()) {
        return `${rowLabel}: Item ${line.MITMNO} is batch-managed — a Batch allocation is required.`;
      }
      if (Array.isArray(line.batches) && line.batches.length) {
        const allocated = sumBatchQty(line.batches);
        if (Math.abs(allocated - Number(line.MQTY || 0)) > 0.001) {
          return `${rowLabel}: Allocated batch quantity (${allocated}) must match line quantity (${line.MQTY}).`;
        }
      }
      if (isWarehouseBinEnabled(referenceData.warehouses, line.MWHS) && !String(line.MBinCode || '').trim()) {
        return `${rowLabel}: Warehouse ${line.MWHS} requires a Bin Location.`;
      }
      if (line.TWHS && isWarehouseBinEnabled(referenceData.warehouses, line.TWHS) && !String(line.ToBinCode || '').trim()) {
        return `${rowLabel}: To Warehouse ${line.TWHS} requires a To Bin Location.`;
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
      const successMessage = `${data.message || 'Jobwork Issue Note saved.'}${data.doc_num ? ` Doc No: ${data.doc_num}` : ''}`;
      if (data.warning) {
        // eslint-disable-next-line no-alert
        window.alert(data.warning);
      }
      // Reopen the saved document (rather than resetting to the list) so any
      // linked Inventory Transfer created by the save is immediately visible.
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
    .filter((line) => line.MITMNO)
    .reduce((sum, line) => sum + Number(line.MQTY || 0), 0)
    .toFixed(2);

  // ---------------- LIST VIEW ----------------
  if (mode === 'list') {
    return (
      <div className="container-fluid sap-find-page">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2 className="mb-1">Jobwork Issue Note</h2>
            <small className="text-muted">Material sent out to a job worker for processing.</small>
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
                placeholder="Search by Doc No or Vendor"
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
                  <th>Vendor Code</th>
                  <th>Vendor Name</th>
                  <th>Posting Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {listLoading && (
                  <tr><td colSpan={6} className="text-center py-4">Loading Jobwork Issue Notes...</td></tr>
                )}
                {!listLoading && !documents.length && (
                  <tr><td colSpan={6} className="text-center text-muted py-4">No Jobwork Issue Notes found.</td></tr>
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
  // Warehouses with no branch assigned stay visible regardless of the selected
  // branch (matches Inventory Transfer's own from-warehouse filtering).
  const billToAddresses = partyAddresses.list.filter((a) => a.address_type === 'B');
  const shipFromAddresses = partyAddresses.list.filter((a) => a.address_type === 'S');
  const branchFilteredWarehouses = header.BRNCH
    ? referenceData.warehouses.filter((wh) => !wh.BranchId || String(wh.BranchId) === String(header.BRNCH))
    : referenceData.warehouses;
  const { inventoryTransferDocEntry, inventoryTransferDocNum, goodsIssueDocEntry } = getStockMovementRefs(header);
  // Once the real stock movement has been posted, everything that could
  // desync from what SAP actually moved (vendor, dates, branch, warehouses,
  // bins, lines, addresses) is locked — only the informational fields below
  // (mirrored server-side in jobWorkService.js's LOCKED_ISSUE_NOTE_EDITABLE_FIELDS)
  // stay editable, and Update never re-posts a stock movement.
  const isLocked = Boolean(docEntry) && Boolean(inventoryTransferDocEntry || goodsIssueDocEntry);
  const openLinkedInventoryTransfer = () => {
    if (!inventoryTransferDocEntry) return;
    navigate('/inventory-transfer', {
      state: createActiveCompanyScopedRouteState({ inventoryTransferDocEntry }),
    });
  };

  return (
    <div className="po-page jw-issue-note-page">
      <div className="po-toolbar">
        <div className="po-toolbar__title">
          Jobwork Issue Note{docEntry ? ` - #${docEntry}` : ''}
        </div>
        <span className={`po-mode-badge ${modeBadgeClass}`}>{docEntry ? 'Update' : 'Add'} Mode</span>
        <button type="button" className="po-btn po-btn--primary" onClick={handleSave} disabled={pageState.saving}>
          {pageState.saving ? 'Saving...' : docEntry ? 'Update' : 'Add'}
        </button>
        <button type="button" className="po-btn" onClick={backToList}>Cancel</button>
<button type="button" className="po-btn" data-sap-find-action onClick={backToList}>Find</button>
        <button type="button" className="po-btn" onClick={openNew}>New</button>
      </div>

      {pageState.loading && <div className="po-alert po-alert--success">Loading...</div>}
      {pageState.error && <div className="po-alert po-alert--error">{pageState.error}</div>}
      {pageState.success && <div className="po-alert po-alert--success">{pageState.success}</div>}

      {inventoryTransferDocEntry ? (
        <div className="po-field" style={{ maxWidth: 420 }}>
          <label className="po-field__label">Inventory Transfer</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
            <input className="po-field__input" value={`Doc Entry: ${inventoryTransferDocEntry}`} readOnly />
            <button
              type="button"
              onClick={openLinkedInventoryTransfer}
              title="Open Inventory Transfer"
              style={{
                minWidth: 30, height: 26, cursor: 'pointer', border: 'none', background: 'transparent',
                color: '#c98a00', fontSize: 18, lineHeight: 1, fontWeight: 700,
              }}
            >
              ↗
            </button>
          </div>
        </div>
      ) : null}

      <div className="po-header-card jw-header-card">
        {isLocked ? (
          <div className="jw-header-lockband">
            🔒 Stock already moved for this document — vendor, dates, warehouses and bins are locked. Only the logistics fields below can still be edited.
          </div>
        ) : null}

        <div className="jw-header-grid">
          <div className="jw-header-column">
            <div className="po-field jw-field">
              <label className="po-field__label">Vendor</label>
              <div className="jw-field__selector">
                <input
                  className="po-field__input"
                  value={header.VENCOD || ''}
                  placeholder="Vendor Code"
                  disabled={isLocked}
                  onChange={(e) => setHeader((current) => ({ ...current, VENCOD: e.target.value }))}
                  onBlur={() => {
                    const code = String(header.VENCOD || '').trim();
                    const matched = referenceData.parties.find((p) => p.CardCode.toLowerCase() === code.toLowerCase());
                    if (matched) selectVendor(matched.CardCode);
                  }}
                />
                <button type="button" className="po-btn" style={{ minWidth: 36, paddingInline: 0 }} onClick={() => setVendorModalOpen(true)} disabled={isLocked} title="Select Vendor">...</button>
              </div>
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Name</label>
              <input className="po-field__input" value={header.VENNAME || ''} readOnly />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Own Work Order Ref</label>
              <input className="po-field__input" value={header.OWOR || ''} onChange={(e) => handleHeaderChange('OWOR', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Payment Term</label>
              <select className="po-field__select" value={header.JWOPAYT || ''} onChange={(e) => handleHeaderChange('JWOPAYT', e.target.value)}>
                <option value="">Select Payment Term</option>
                {referenceData.paymentTerms.map((pt) => (
                  <option key={pt.GroupNum} value={pt.GroupNum}>{pt.PymntGroup}</option>
                ))}
              </select>
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Sales Employee</label>
              <select className="po-field__select" value={header.SLSEMP || ''} onChange={(e) => handleHeaderChange('SLSEMP', e.target.value)}>
                <option value="">Select Sales Employee</option>
                {referenceData.salesEmployees.map((emp) => (
                  <option key={emp.SlpCode} value={emp.SlpCode}>{emp.SlpName}</option>
                ))}
              </select>
            </div>
            {referenceData.branches.length > 0 ? (
              <div className="po-field jw-field">
                <label className="po-field__label">Branch</label>
                <select className="po-field__select" value={header.BRNCH || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('BRNCH', e.target.value)}>
                  <option value="">Select Branch</option>
                  {referenceData.branches.map((branch) => (
                    <option key={branch.BPLId} value={branch.BPLId}>{branch.BPLName}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="po-field jw-field">
              <label className="po-field__label">From Warehouse</label>
              <select className="po-field__select" value={header.HMWHS || ''} disabled={isLocked} onChange={(e) => handleHeaderWarehouseChange('HMWHS', 'MWHS', e.target.value)}>
                <option value="">Select (applies to all lines)</option>
                {branchFilteredWarehouses.map((wh) => (
                  <option key={wh.WhsCode} value={wh.WhsCode}>{wh.WhsCode} - {wh.WhsName}</option>
                ))}
              </select>
            </div>
            {isWarehouseBinEnabled(referenceData.warehouses, header.HMWHS) ? (
              <div className="po-field jw-field">
                <label className="po-field__label">From Bin</label>
                <select className="po-field__select" value={header.HMBinCode || ''} disabled={isLocked} onChange={(e) => handleHeaderBinChange('HMBinCode', 'MBinCode', e.target.value)}>
                  <option value="">Select Bin</option>
                  {binOptionsWithCurrentValue(binsByWarehouse[header.HMWHS], header.HMBinCode).map((bin) => (
                    <option key={bin.BinAbsEntry} value={bin.BinCode}>{bin.BinCode}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="po-field jw-field">
              <label className="po-field__label">To Warehouse</label>
              <select className="po-field__select" value={header.HTWHS || ''} disabled={isLocked} onChange={(e) => handleHeaderWarehouseChange('HTWHS', 'TWHS', e.target.value)}>
                <option value="">Select (applies to all lines)</option>
                {branchFilteredWarehouses.map((wh) => (
                  <option key={wh.WhsCode} value={wh.WhsCode}>{wh.WhsCode} - {wh.WhsName}</option>
                ))}
              </select>
            </div>
            {isWarehouseBinEnabled(referenceData.warehouses, header.HTWHS) ? (
              <div className="po-field jw-field">
                <label className="po-field__label">To Bin</label>
                <select className="po-field__select" value={header.HToBinCode || ''} disabled={isLocked} onChange={(e) => handleHeaderBinChange('HToBinCode', 'ToBinCode', e.target.value)}>
                  <option value="">Select Bin</option>
                  {binOptionsWithCurrentValue(binsByWarehouse[header.HTWHS], header.HToBinCode).map((bin) => (
                    <option key={bin.BinAbsEntry} value={bin.BinCode}>{bin.BinCode}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="jw-header-column">
            <div className="po-field jw-field">
              <label className="po-field__label">Document Date</label>
              <SapDateInput  className="po-field__input" value={header.DOCDATE || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('DOCDATE', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Posting Date</label>
              <SapDateInput  className="po-field__input" value={header.PDATE || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('PDATE', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Delivery Date</label>
              <SapDateInput  className="po-field__input" value={header.DDATE || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('DDATE', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Transporter Name</label>
              <input className="po-field__input" value={header.TranName || ''} onChange={(e) => handleHeaderChange('TranName', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Vehicle Number</label>
              <input className="po-field__input" value={header.VEHNO || ''} onChange={(e) => handleHeaderChange('VEHNO', e.target.value)} />
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
              <label className="po-field__label">Nature Of Process</label>
              <input className="po-field__input" value={header.NatureP || ''} onChange={(e) => handleHeaderChange('NatureP', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">E-Way Bill No</label>
              <input className="po-field__input" value={header.EWBILLNO || ''} onChange={(e) => handleHeaderChange('EWBILLNO', e.target.value)} />
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
            <span className="po-mode-badge" title="The Inventory Transfer / Goods Issue for this document has already been posted — items, quantities, warehouses and bins can no longer change.">Locked — stock movement posted</span>
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
                <th>From Warehouse</th>
                <th>To Warehouse</th>
                <th>UoM</th>
                <th>Batch</th>
                <th>Bin Code</th>
                <th>To Bin Code</th>
                <th>Rate</th>
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
                        value={line.MITMNO || ''}
                        placeholder="Item Code"
                        disabled={isLocked}
                        onChange={(e) => handleLineChange(index, 'MITMNO', e.target.value)}
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
                  <td><input className="po-grid__input po-grid__input--text" value={line.MDES || ''} readOnly /></td>
                  <td><input className="po-grid__input" type="number" value={line.MQTY || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'MQTY', e.target.value)} /></td>
                  <td>
                    <select className="po-grid__input po-grid__input--text" value={line.MWHS || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'MWHS', e.target.value)}>
                      <option value="">Select</option>
                      {branchFilteredWarehouses.map((wh) => (
                        <option key={wh.WhsCode} value={wh.WhsCode}>{wh.WhsCode} - {wh.WhsName}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="po-grid__input po-grid__input--text" value={line.TWHS || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'TWHS', e.target.value)}>
                      <option value="">Select</option>
                      {branchFilteredWarehouses.map((wh) => (
                        <option key={wh.WhsCode} value={wh.WhsCode}>{wh.WhsCode} - {wh.WhsName}</option>
                      ))}
                    </select>
                  </td>
                  <td><input className="po-grid__input po-grid__input--text" value={line.MUOM || ''} readOnly /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <input
                        className="po-grid__input po-grid__input--text"
                        value={line.batches?.length ? line.batches.map((b) => b.batchNumber).join(', ') : (line.MBatch || '')}
                        readOnly
                        placeholder={line._batchManaged ? 'Allocate batches' : 'Batch'}
                      />
                      <button
                        type="button"
                        onClick={() => openBatchModal(index)}
                        disabled={isLocked}
                        style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                        title="Allocate Batches"
                      >
                        ...
                      </button>
                    </div>
                    {line._batchManaged ? <div className="po-error-feedback">required</div> : null}
                  </td>
                  <td>
                    {isWarehouseBinEnabled(referenceData.warehouses, line.MWHS) ? (
                      <select className="po-grid__input po-grid__input--text" value={line.MBinCode || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'MBinCode', e.target.value)}>
                        <option value="">Select Bin</option>
                        {binOptionsWithCurrentValue(binsByWarehouse[line.MWHS], line.MBinCode).map((bin) => (
                          <option key={bin.BinAbsEntry} value={bin.BinCode}>{bin.BinCode}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="po-grid__input po-grid__input--text" value={line.MBinCode || ''} onChange={(e) => handleLineChange(index, 'MBinCode', e.target.value)} disabled={isLocked || !line.MWHS} placeholder={line.MWHS ? '' : 'Select warehouse first'} />
                    )}
                  </td>
                  <td>
                    {isWarehouseBinEnabled(referenceData.warehouses, line.TWHS) ? (
                      <select className="po-grid__input po-grid__input--text" value={line.ToBinCode || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'ToBinCode', e.target.value)}>
                        <option value="">Select Bin</option>
                        {binOptionsWithCurrentValue(binsByWarehouse[line.TWHS], line.ToBinCode).map((bin) => (
                          <option key={bin.BinAbsEntry} value={bin.BinCode}>{bin.BinCode}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="po-grid__input po-grid__input--text" value={line.ToBinCode || ''} onChange={(e) => handleLineChange(index, 'ToBinCode', e.target.value)} disabled={isLocked || !line.TWHS} placeholder={line.TWHS ? '' : 'Select warehouse first'} />
                    )}
                  </td>
                  <td><input className="po-grid__input" type="number" value={line.Rate || ''} disabled={isLocked} onChange={(e) => handleLineChange(index, 'Rate', e.target.value)} /></td>
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
        <textarea className="po-textarea" rows={3} value={header.REMARKS || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('REMARKS', e.target.value)} />
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
        isOpen={vendorModalOpen}
        onClose={() => setVendorModalOpen(false)}
        onSelect={handleVendorModalSelect}
        businessPartners={referenceData.parties.map((p) => ({ CardCode: p.CardCode, CardName: p.CardName, CardType: p.CardType }))}
        title="List of Vendors"
      />

      <BatchAllocationModal
        isOpen={batchModal.open}
        mode="issue"
        line={batchModal.lineIndex >= 0 ? {
          itemNo: lines[batchModal.lineIndex]?.MITMNO,
          whse: lines[batchModal.lineIndex]?.MWHS,
          quantity: lines[batchModal.lineIndex]?.MQTY,
          inventoryUOM: lines[batchModal.lineIndex]?.MUOM,
          batches: lines[batchModal.lineIndex]?.batches || [],
        } : null}
        availableBatches={batchModal.availableBatches}
        loading={batchModal.loading}
        error={batchModal.error}
        onClose={closeBatchModal}
        onSave={saveLineBatches}
      />
    </div>
  );
}
