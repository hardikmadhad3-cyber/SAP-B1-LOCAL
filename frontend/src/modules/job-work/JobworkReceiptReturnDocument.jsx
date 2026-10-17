import SapDateInput from '../../components/common/SapDateInput';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../purchase-order/styles/purchaseOrder.css';
import '../../styles/sales-order-list.css';
import './styles/customerGoodsReceipt.css';
import ItemSelectionModal from '../../components/common/ItemSelectionModal';
import BusinessPartnerModal from '../sales-order/components/BusinessPartnerModal';
import BatchAllocationModal from '../../components/BatchAllocationModal';
import { createActiveCompanyScopedRouteState } from '../../utils/companyStorageScope';
import { fetchGoodsIssueBatchesByItem, fetchGoodsIssueSeries } from '../../api/goodsIssueApi';
import { fetchGoodsReceiptBatchesByItem, fetchGoodsReceiptNextBatchNumber, fetchGoodsReceiptSeries } from '../../api/goodsReceiptApi';
import { fetchInventoryTransferSeries } from '../../api/inventoryTransferApi';
import {
  fetchJobWorkBins,
  fetchJobWorkByDocEntry,
  fetchJobWorkConsumableIssues,
  fetchJobWorkList,
  fetchJobWorkPartyAddresses,
  fetchJobWorkReferenceData,
  fetchJobWorkSeries,
  submitJobWork,
  updateJobWork,
} from '../../api/jobWorkApi';
import { JOB_WORK_TRANSACTIONS } from './jobWorkTransactions';

const TRANSACTION = JOB_WORK_TRANSACTIONS.jobworkReceiptReturnNote;
const today = () => new Date().toISOString().split('T')[0];

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

const emptyHeader = () => ({ DOCDATE: today(), PDATE: today(), DDATE: today(), JWTYP: 'R' });

const findItem = (items, itemCode) => (items || []).find((item) => item.ItemCode === itemCode);
const isBatchManagedItem = (item) => String(item?.BatchManaged || '').trim().toUpperCase() === 'Y';
const isWarehouseBinEnabled = (warehouses, whsCode) => {
  const warehouse = (warehouses || []).find((wh) => wh.WhsCode === whsCode);
  return String(warehouse?.BinEnabled || '').trim().toUpperCase() === 'Y';
};

const binOptionsWithCurrentValue = (bins, currentValue) => {
  const trimmedCurrent = String(currentValue || '').trim();
  const list = bins || [];
  if (!trimmedCurrent || list.some((bin) => String(bin.BinCode || '').trim() === trimmedCurrent)) {
    return list;
  }
  return [{ BinAbsEntry: `current-${trimmedCurrent}`, BinCode: trimmedCurrent }, ...list];
};

// A single consumption-row shape is used in the UI regardless of JWTYP, and
// only mapped to the real STTL_JWPR8 (Receipt) / STTL_JWPR6 (Return) wire
// field names at submit time (buildConsumptionLinePayload below) — the two
// tables' fields overlap in meaning (item/qty/warehouse/batch/source-issue)
// but use different literal names, and only one table is ever relevant for
// a given document (only its type can change, never mid-edit).
const emptyConsumptionRow = () => ({
  srcDocEntry: '', srcDocNum: '', srcLineId: '',
  itemCode: '', itemName: '', uom: '',
  whsCode: '', binCode: '', qty: '', balanceQty: 0,
  batch: '', batches: [],
});

const emptyReceiptRow = () => ({
  ICode: '', IName: '', Qty: '', WhsCode: '', UOM: '', Batch: '', BinCode: '', Price: '', Remarks: '',
  batches: [],
});

const getStockMovementRefs = (header) => ({
  goodsIssueDocEntry: header.WebGoodsIssDocEntry ? Number(header.WebGoodsIssDocEntry) : null,
  goodsIssueDocNum: header.WebGoodsIssDocNum ? Number(header.WebGoodsIssDocNum) : null,
  goodsReceiptDocEntry: header.WebGoodsRcptDocEntry ? Number(header.WebGoodsRcptDocEntry) : null,
  goodsReceiptDocNum: header.WebGoodsRcptDocNum ? Number(header.WebGoodsRcptDocNum) : null,
  invTraRtnDocEntry: header.WebInvTraRtnDocEntry ? Number(header.WebInvTraRtnDocEntry) : null,
  invTraRtnDocNum: header.WebInvTraRtnDocNum ? Number(header.WebInvTraRtnDocNum) : null,
});

export default function JobworkReceiptReturnDocument() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('list');

  const [documents, setDocuments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, totalCount: 0, totalPages: 1 });
  const [searchQuery, setSearchQuery] = useState('');
  const [listLoading, setListLoading] = useState(false);

  const [referenceData, setReferenceData] = useState({ parties: [], warehouses: [], items: [], paymentTerms: [], salesEmployees: [], branches: [] });

  const [docEntry, setDocEntry] = useState(null);
  const [header, setHeader] = useState(emptyHeader);
  const [consumptionLines, setConsumptionLines] = useState([]);
  const [receiptLines, setReceiptLines] = useState([emptyReceiptRow()]);
  const [pageState, setPageState] = useState({ loading: false, saving: false, error: '', success: '' });
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [itemModal, setItemModal] = useState({ open: false, lineIndex: -1 });
  const [batchModal, setBatchModal] = useState({ open: false, mode: 'issue', lineIndex: -1, availableBatches: [], loading: false, error: '' });
  const [activeTab, setActiveTab] = useState('Consumption');
  const [binsByWarehouse, setBinsByWarehouse] = useState({});
  const [partyAddresses, setPartyAddresses] = useState({ list: [], billToDefault: '', shipToDefault: '' });

  const [documentSeriesOptions, setDocumentSeriesOptions] = useState([]);
  const [goodsIssueSeriesOptions, setGoodsIssueSeriesOptions] = useState([]);
  const [goodsReceiptSeriesOptions, setGoodsReceiptSeriesOptions] = useState([]);
  const [invTraSeriesOptions, setInvTraSeriesOptions] = useState([]);

  const [availableIssues, setAvailableIssues] = useState([]);
  const [issuesLoading, setIssuesLoading] = useState(false);

  const isReturn = String(header.JWTYP || '').trim().toUpperCase() === 'RE';

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
    fetchJobWorkSeries(TRANSACTION.apiKey)
      .then(({ data }) => setDocumentSeriesOptions(Array.isArray(data) ? data : []))
      .catch(() => setDocumentSeriesOptions([]));
    fetchGoodsIssueSeries()
      .then(({ data }) => setGoodsIssueSeriesOptions(Array.isArray(data) ? data : []))
      .catch(() => setGoodsIssueSeriesOptions([]));
    fetchGoodsReceiptSeries()
      .then(({ data }) => setGoodsReceiptSeriesOptions(Array.isArray(data) ? data : []))
      .catch(() => setGoodsReceiptSeriesOptions([]));
    fetchInventoryTransferSeries()
      .then(({ data }) => setInvTraSeriesOptions(Array.isArray(data) ? data : []))
      .catch(() => setInvTraSeriesOptions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (docEntry || !documentSeriesOptions.length) return;
    setHeader((current) => {
      if (current.Series) return current;
      const defaultSeries = documentSeriesOptions.find((s) => s.isDefault) || documentSeriesOptions[0];
      return defaultSeries ? { ...current, Series: defaultSeries.Series } : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentSeriesOptions, docEntry]);

  const loadIssuesForVendor = (vendorCode) => {
    if (!vendorCode) {
      setAvailableIssues([]);
      return;
    }
    setIssuesLoading(true);
    fetchJobWorkConsumableIssues(TRANSACTION.apiKey, vendorCode)
      .then(({ data }) => setAvailableIssues(Array.isArray(data) ? data : []))
      .catch(() => setAvailableIssues([]))
      .finally(() => setIssuesLoading(false));
  };

  const openNew = () => {
    setDocEntry(null);
    setHeader(emptyHeader());
    setConsumptionLines([]);
    setReceiptLines([emptyReceiptRow()]);
    setAvailableIssues([]);
    setPartyAddresses({ list: [], billToDefault: '', shipToDefault: '' });
    setPageState({ loading: false, saving: false, error: '', success: '' });
    setActiveTab('Consumption');
    setMode('form');
  };

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

  const handleAddressSelect = (addressType, addressId) => {
    const address = partyAddresses.list.find((a) => a.address_type === addressType && a.address_id === addressId);
    const fields = addressType === 'B' ? TRANSACTION.addressFields.billTo : TRANSACTION.addressFields.shipFrom;
    setHeader((current) => ({ ...current, ...applyAddressToHeader(fields, address) }));
  };

  const selectVendor = (code) => {
    const party = referenceData.parties.find((p) => p.CardCode === code);
    setHeader((current) => ({ ...current, VENCOD: code, VENNAME: party?.CardName || '' }));
    setConsumptionLines([]);
    loadIssuesForVendor(code);
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
      return { ...current, [whsCode]: null };
    });
  }, [referenceData.warehouses]);

  // Reconstructs the normalized consumption-row shape from a saved document's
  // STTL_JWPR8 (Receipt) or STTL_JWPR6 (Return) rows — whichever the saved
  // JWTYP used — for display on reopen. Once posted, these rows are locked.
  const linesFromSavedDocument = (data) => {
    const type = String(data.header?.JWTYP || '').trim().toUpperCase();
    if (type === 'RE') {
      return (data.lines?.STTL_JWPR6 || []).map(stripUdfPrefix).map((line) => ({
        srcDocEntry: line.PJWDEN, srcDocNum: line.PJWNO, srcLineId: '',
        itemCode: line.MITMNO, itemName: line.MDES, uom: line.MUOM,
        whsCode: line.MWHS, binCode: line.MBinCode, qty: line.MQTY, balanceQty: line.TOTQTY,
        batch: line.MBatch, batches: [],
      }));
    }
    return (data.lines?.STTL_JWPR8 || []).map(stripUdfPrefix).map((line) => ({
      srcDocEntry: line.PJWDEN, srcDocNum: line.PJWNO, srcLineId: '',
      itemCode: line.MRITMNO, itemName: line.MRDES, uom: line.MRUOM,
      whsCode: line.MRWHS, binCode: line.MRBinCode, qty: line.MRQTY, balanceQty: line.BalQTY,
      batch: line.MRBatch, batches: [],
    }));
  };

  const openDocument = async (row) => {
    setPageState({ loading: true, saving: false, error: '', success: '' });
    try {
      const { data } = await fetchJobWorkByDocEntry(TRANSACTION.apiKey, row.doc_entry);
      setDocEntry(row.doc_entry);
      const loadedHeader = stripUdfPrefix(data.header);
      setHeader(loadedHeader);
      loadPartyAddressOptions(loadedHeader.VENCOD);
      setConsumptionLines(linesFromSavedDocument(data));
      const receiptRows = (data.lines?.STTL_JWPR9 || []).map(stripUdfPrefix).map((line) => ({
        ICode: line.MRITMNO, IName: line.MRDES, Qty: line.MRQTY, WhsCode: line.MRWHS,
        UOM: line.MRUOM, Batch: line.MRBatch, BinCode: line.MRBinCode, Price: line.Price,
        Remarks: line.Remarks, batches: [],
      }));
      setReceiptLines(receiptRows.length ? receiptRows : [emptyReceiptRow()]);
      setMode('form');
    } catch (err) {
      setPageState({ loading: false, saving: false, error: err.response?.data?.detail || err.message || 'Failed to load document.', success: '' });
      return;
    }
    setPageState((current) => ({ ...current, loading: false }));
  };

  const backToList = () => {
    setMode('list');
    loadList(pagination.page);
  };

  const handleHeaderChange = (name, value) => {
    setHeader((current) => ({ ...current, [name]: value }));
  };

  const handleTypeChange = (value) => {
    setHeader((current) => ({ ...current, JWTYP: value }));
    // Switching type changes which real table the consumption rows map to —
    // rather than silently reinterpreting stale rows under the new type's
    // meaning, clear them so the user re-adds from the (still-loaded) issue list.
    setConsumptionLines([]);
  };

  // ---- Top matrix: consumption / return rows, sourced from Issue Notes ----

  const addConsumptionRowFromIssue = (issueLine) => {
    setConsumptionLines((current) => {
      const alreadyAdded = current.some((row) => row.srcDocEntry === issueLine.doc_entry && row.srcLineId === issueLine.line_id);
      if (alreadyAdded) return current;
      ensureBinsLoaded(issueLine.whs_code);
      return [...current, {
        ...emptyConsumptionRow(),
        srcDocEntry: issueLine.doc_entry,
        srcDocNum: issueLine.doc_num,
        srcLineId: issueLine.line_id,
        itemCode: issueLine.item_code,
        itemName: issueLine.item_name,
        uom: issueLine.uom,
        whsCode: issueLine.whs_code,
        binCode: issueLine.bin_code,
        balanceQty: issueLine.balance_qty,
        batch: issueLine.batch,
      }];
    });
  };

  const removeConsumptionRow = (index) => setConsumptionLines((current) => current.filter((_, i) => i !== index));

  const handleConsumptionQtyChange = (index, value) => {
    setConsumptionLines((current) => current.map((row, i) => (i === index ? { ...row, qty: value } : row)));
  };

  // ---- Bottom matrix: finished-goods receipt rows (Receipt type only) ----

  const handleReceiptLineChange = (index, name, value) => {
    if (name === 'WhsCode') ensureBinsLoaded(value);
    setReceiptLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      if (name === 'ICode') {
        const item = findItem(referenceData.items, value);
        return {
          ...line, ICode: value, IName: item?.ItemName || '', UOM: item?.InventoryUOM || '',
          WhsCode: line.WhsCode || item?.DefaultWarehouse || '',
          _batchManaged: isBatchManagedItem(item), batches: [], Batch: '',
        };
      }
      if (name === 'WhsCode') return { ...line, WhsCode: value, BinCode: '', batches: [], Batch: '' };
      return { ...line, [name]: value };
    }));
  };

  const handleItemModalSelect = (item) => {
    if (itemModal.lineIndex < 0) return;
    handleReceiptLineChange(itemModal.lineIndex, 'ICode', item?.ItemCode || item?.itemCode || '');
  };

  const addReceiptLine = () => setReceiptLines((current) => [...current, emptyReceiptRow()]);
  const removeReceiptLine = (index) => setReceiptLines((current) => (
    current.length > 1 ? current.filter((_, i) => i !== index) : [emptyReceiptRow()]
  ));

  // ---- Shared batch modal (issue mode for consumption rows, receipt mode for finished-goods rows) ----

  const openConsumptionBatchModal = async (lineIndex) => {
    const line = consumptionLines[lineIndex];
    if (!line?.itemCode || !line?.whsCode) return;
    setBatchModal({ open: true, mode: 'issue', lineIndex, availableBatches: [], loading: true, error: '' });
    try {
      const response = await fetchGoodsIssueBatchesByItem(line.itemCode, line.whsCode);
      setBatchModal((current) => (current.lineIndex === lineIndex
        ? { ...current, availableBatches: response.data?.batches || [], loading: false }
        : current));
    } catch (err) {
      setBatchModal((current) => (current.lineIndex === lineIndex
        ? { ...current, availableBatches: [], loading: false, error: err.response?.data?.detail || err.message || 'Failed to load warehouse batches.' }
        : current));
    }
  };

  const openReceiptBatchModal = async (lineIndex) => {
    const line = receiptLines[lineIndex];
    if (!String(line?.ICode || '').trim() || !String(line?.WhsCode || '').trim()) {
      setPageState((current) => ({ ...current, error: 'Select an item and warehouse before allocating batches.' }));
      return;
    }
    setBatchModal({ open: true, mode: 'receipt', lineIndex, availableBatches: [], loading: true, error: '' });
    try {
      const response = await fetchGoodsReceiptBatchesByItem(line.ICode, line.WhsCode);
      setBatchModal((current) => (current.lineIndex === lineIndex
        ? { ...current, availableBatches: response.data?.batches || [], loading: false }
        : current));
    } catch (err) {
      setBatchModal((current) => (current.lineIndex === lineIndex
        ? { ...current, availableBatches: [], loading: false, error: err.response?.data?.detail || err.message || 'Failed to load warehouse batches.' }
        : current));
    }
  };

  const closeBatchModal = () => setBatchModal({ open: false, mode: 'issue', lineIndex: -1, availableBatches: [], loading: false, error: '' });

  const saveBatchModal = (nextBatches) => {
    if (batchModal.lineIndex < 0) return;
    const batchSummary = nextBatches.map((b) => b.batchNumber).join(', ');
    if (batchModal.mode === 'issue') {
      setConsumptionLines((current) => current.map((row, i) => (
        i === batchModal.lineIndex ? { ...row, batches: nextBatches, batch: batchSummary } : row
      )));
    } else {
      setReceiptLines((current) => current.map((line, i) => (
        i === batchModal.lineIndex ? { ...line, batches: nextBatches, Batch: batchSummary } : line
      )));
    }
    closeBatchModal();
  };

  const generateNextBatchNumber = () => fetchGoodsReceiptNextBatchNumber();

  // ---- Validation + save ----

  const validate = () => {
    if (!String(header.VENCOD || '').trim()) return 'Vendor is required.';
    if (referenceData.branches.length && !String(header.BRNCH || '').trim()) return 'Branch is required.';
    if (!consumptionLines.length) return `Add at least one Jobwork Issue Note line ${isReturn ? 'to return' : 'consumed'} before saving.`;
    for (let i = 0; i < consumptionLines.length; i += 1) {
      const line = consumptionLines[i];
      const qty = Number(line.qty);
      const rowLabel = `${isReturn ? 'Return' : 'Consumption'} line ${i + 1}`;
      if (!(qty > 0)) return `${rowLabel}: ${isReturn ? 'Return' : 'Used'} Qty must be greater than zero.`;
      if (qty > Number(line.balanceQty) + 0.0001) return `${rowLabel}: ${qty} exceeds the available balance of ${line.balanceQty}.`;
    }
    if (!isReturn) {
      const validReceiptLines = receiptLines.filter((l) => String(l.ICode || '').trim());
      if (!validReceiptLines.length) return 'Add at least one finished-goods line received before saving.';
      for (let i = 0; i < validReceiptLines.length; i += 1) {
        const line = validReceiptLines[i];
        if (!(Number(line.Qty) > 0)) return `Receipt line ${i + 1}: Quantity must be greater than zero.`;
        if (!String(line.WhsCode || '').trim()) return `Receipt line ${i + 1}: Warehouse is required.`;
      }
    }
    return null;
  };

  const buildConsumptionLinePayload = () => consumptionLines.map((row) => (
    isReturn
      ? {
        MITMNO: row.itemCode, MDES: row.itemName, MQTY: row.qty, MWHS: row.whsCode, TWHS: header.RtnWhsCode || row.whsCode,
        MUOM: row.uom, MBatch: row.batch, MBinCode: row.binCode, PJWNO: row.srcDocNum, PJWDEN: row.srcDocEntry,
        RETQTY: row.qty, TOTQTY: row.balanceQty, batches: row.batches,
      }
      : {
        MRITMNO: row.itemCode, MRDES: row.itemName, MRQTY: row.qty, MRWHS: row.whsCode, MRUOM: row.uom,
        MRBatch: row.batch, MRBinCode: row.binCode, PJWNO: row.srcDocNum, PJWDEN: row.srcDocEntry,
        BalQTY: row.balanceQty - Number(row.qty || 0), batches: row.batches,
      }
  ));

  const buildReceiptLinePayload = () => receiptLines
    .filter((line) => String(line.ICode || '').trim())
    .map((line) => ({
      MRITMNO: line.ICode, MRDES: line.IName, MRQTY: line.Qty, MRWHS: line.WhsCode, MRUOM: line.UOM,
      MRBatch: line.Batch, MRBinCode: line.BinCode, Price: line.Price, Remarks: line.Remarks, batches: line.batches,
    }));

  const handleSave = async () => {
    const validationMessage = validate();
    if (validationMessage) {
      setPageState((current) => ({ ...current, error: validationMessage, success: '' }));
      return;
    }

    setPageState((current) => ({ ...current, saving: true, error: '', success: '' }));
    try {
      const lines = isReturn
        ? { STTL_JWPR6: buildConsumptionLinePayload() }
        : { STTL_JWPR8: buildConsumptionLinePayload(), STTL_JWPR9: buildReceiptLinePayload() };
      const payload = { header, lines };
      const { data } = docEntry
        ? await updateJobWork(TRANSACTION.apiKey, docEntry, payload)
        : await submitJobWork(TRANSACTION.apiKey, payload);

      const movements = data.stock_movements || {};
      const successMessage = `${data.message || 'Jobwork Receipt/Return Note saved.'}`
        + `${data.doc_num ? ` Doc No: ${data.doc_num}.` : ''}`
        + `${movements.goodsIssue?.docNum ? ` Goods Issue Doc No: ${movements.goodsIssue.docNum}.` : ''}`
        + `${movements.goodsReceipt?.docNum ? ` Goods Receipt Doc No: ${movements.goodsReceipt.docNum}.` : ''}`
        + `${movements.inventoryTransferReturn?.docNum ? ` Return Transfer Doc No: ${movements.inventoryTransferReturn.docNum}.` : ''}`;

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

  // ---------------- LIST VIEW ----------------
  if (mode === 'list') {
    return (
      <div className="container-fluid sap-find-page">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h2 className="mb-1">Jobwork Receipt / Return Note</h2>
            <small className="text-muted">Consume raw material against a Jobwork Issue Note, receive finished goods back, or return unused material.</small>
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
                  <tr><td colSpan={6} className="text-center py-4">Loading Jobwork Receipt/Return Notes...</td></tr>
                )}
                {!listLoading && !documents.length && (
                  <tr><td colSpan={6} className="text-center text-muted py-4">No Jobwork Receipt/Return Notes found.</td></tr>
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
  const branchFilteredWarehouses = header.BRNCH
    ? referenceData.warehouses.filter((wh) => !wh.BranchId || String(wh.BranchId) === String(header.BRNCH))
    : referenceData.warehouses;
  const { goodsIssueDocEntry, goodsIssueDocNum, goodsReceiptDocEntry, goodsReceiptDocNum, invTraRtnDocEntry, invTraRtnDocNum } = getStockMovementRefs(header);
  const isLocked = Boolean(docEntry) && Boolean(goodsIssueDocEntry || invTraRtnDocEntry);
  const addedIssueKeys = new Set(consumptionLines.map((row) => `${row.srcDocEntry}|${row.srcLineId}`));
  const pickableIssues = availableIssues.filter((issue) => !addedIssueKeys.has(`${issue.doc_entry}|${issue.line_id}`));

  const openLinkedDoc = (path, stateKey, entry) => {
    if (!entry) return;
    navigate(path, { state: createActiveCompanyScopedRouteState({ [stateKey]: entry }) });
  };

  return (
    <div className="po-page jw-receipt-note-page">
      <div className="po-toolbar">
        <div className="po-toolbar__title">
          Jobwork Receipt / Return Note{docEntry ? ` - #${docEntry}` : ''}
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

      <div className="po-header-card jw-header-card">
        {isLocked ? (
          <div className="jw-header-lockband">
            🔒 Stock movement already posted for this document — vendor, type and consumption/receipt lines are locked. Only the logistics fields below can still be edited.
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
              <label className="po-field__label">Transaction Type</label>
              <select className="po-field__select" value={header.JWTYP || 'R'} disabled={isLocked} onChange={(e) => handleTypeChange(e.target.value)}>
                <option value="R">Receipt (consume RM + receive finished goods)</option>
                <option value="RE">Return (unused material back to warehouse)</option>
              </select>
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Own Work Order Ref</label>
              <input className="po-field__input" value={header.OWOR || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('OWOR', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">JW Ref No</label>
              <input className="po-field__input" value={header.PONo || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('PONo', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Vendor PO No</label>
              <input className="po-field__input" value={header.VPONo || ''} onChange={(e) => handleHeaderChange('VPONo', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Vendor PO Date</label>
              <SapDateInput  className="po-field__input" value={header.VPODT || ''} onChange={(e) => handleHeaderChange('VPODT', e.target.value)} />
            </div>
          </div>

          <div className="jw-header-column">
            <div className="po-field jw-field">
              <label className="po-field__label">Document Series</label>
              {docEntry ? (
                <input
                  className="po-field__input"
                  value={[documentSeriesOptions.find((s) => String(s.Series) === String(header.Series))?.SeriesName, header.DocNum].filter(Boolean).join(' - ')}
                  readOnly
                />
              ) : (
                <select className="po-field__select" value={header.Series || ''} onChange={(e) => handleHeaderChange('Series', e.target.value)}>
                  <option value="">Select Series</option>
                  {documentSeriesOptions.map((s) => (
                    <option key={s.Series} value={s.Series}>{s.SeriesName || s.DisplayName || s.Series}</option>
                  ))}
                </select>
              )}
            </div>

            {!isReturn ? (
              <>
                <div className="po-field jw-field">
                  <label className="po-field__label">Goods Issue Series</label>
                  {goodsIssueDocEntry ? (
                    <div className="jw-field__selector">
                      <input className="po-field__input" value={`Doc No: ${goodsIssueDocNum || goodsIssueDocEntry}`} readOnly />
                      <button type="button" onClick={() => openLinkedDoc('/goods-issue', 'goodsIssueDocEntry', goodsIssueDocEntry)} title="Open Goods Issue"
                        style={{ minWidth: 30, height: 25, cursor: 'pointer', border: 'none', background: 'transparent', color: '#c98a00', fontSize: 18, lineHeight: 1, fontWeight: 700 }}>↗</button>
                    </div>
                  ) : (
                    <select className="po-field__select" value={header.GoodsIssueSeries || ''} onChange={(e) => handleHeaderChange('GoodsIssueSeries', e.target.value)}>
                      <option value="">Select Series</option>
                      {goodsIssueSeriesOptions.map((s) => (
                        <option key={s.Series} value={s.Series}>{s.SeriesName || s.DisplayName || s.Series}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="po-field jw-field">
                  <label className="po-field__label">Goods Receipt Series</label>
                  {goodsReceiptDocEntry ? (
                    <div className="jw-field__selector">
                      <input className="po-field__input" value={`Doc No: ${goodsReceiptDocNum || goodsReceiptDocEntry}`} readOnly />
                      <button type="button" onClick={() => openLinkedDoc('/goods-receipt', 'goodsReceiptDocEntry', goodsReceiptDocEntry)} title="Open Goods Receipt"
                        style={{ minWidth: 30, height: 25, cursor: 'pointer', border: 'none', background: 'transparent', color: '#c98a00', fontSize: 18, lineHeight: 1, fontWeight: 700 }}>↗</button>
                    </div>
                  ) : (
                    <select className="po-field__select" value={header.GoodsReceiptSeries || ''} onChange={(e) => handleHeaderChange('GoodsReceiptSeries', e.target.value)}>
                      <option value="">Select Series</option>
                      {goodsReceiptSeriesOptions.map((s) => (
                        <option key={s.Series} value={s.Series}>{s.SeriesName || s.DisplayName || s.Series}</option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            ) : (
              <div className="po-field jw-field">
                <label className="po-field__label">Return Transfer Series</label>
                {invTraRtnDocEntry ? (
                  <div className="jw-field__selector">
                    <input className="po-field__input" value={`Doc No: ${invTraRtnDocNum || invTraRtnDocEntry}`} readOnly />
                    <button type="button" onClick={() => openLinkedDoc('/inventory-transfer', 'inventoryTransferDocEntry', invTraRtnDocEntry)} title="Open Inventory Transfer"
                      style={{ minWidth: 30, height: 25, cursor: 'pointer', border: 'none', background: 'transparent', color: '#c98a00', fontSize: 18, lineHeight: 1, fontWeight: 700 }}>↗</button>
                  </div>
                ) : (
                  <select className="po-field__select" value={header.InvTraRtnSeries || ''} onChange={(e) => handleHeaderChange('InvTraRtnSeries', e.target.value)}>
                    <option value="">Select Series</option>
                    {invTraSeriesOptions.map((s) => (
                      <option key={s.Series} value={s.Series}>{s.SeriesName || s.DisplayName || s.Series}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="po-field jw-field">
              <label className="po-field__label">Document Date</label>
              <SapDateInput  className="po-field__input" value={header.DOCDATE || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('DOCDATE', e.target.value)} />
            </div>
            <div className="po-field jw-field">
              <label className="po-field__label">Posting Date</label>
              <SapDateInput  className="po-field__input" value={header.PDATE || ''} disabled={isLocked} onChange={(e) => handleHeaderChange('PDATE', e.target.value)} />
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
        {[isReturn ? 'Return' : 'Consumption', ...(isReturn ? [] : ['Finished Goods']), 'Bill To / Ship To'].map((tabName) => (
          <button key={tabName} type="button" className={`po-tab${activeTab === tabName ? ' po-tab--active' : ''}`} onClick={() => setActiveTab(tabName)}>
            {tabName}
          </button>
        ))}
      </div>

      {(activeTab === 'Consumption' || activeTab === 'Return') && (
        <div className="po-tab-panel">
          <div className="po-section-title">{isReturn ? 'Available Issue Note Lines to Return' : 'Available Issue Note Lines to Consume'}</div>
          <div className="po-grid-wrap" style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 14 }}>
            <table className="po-grid">
              <thead>
                <tr>
                  <th>Issue Doc No</th><th>Item Code</th><th>Item Name</th><th>Issued Qty</th><th>Used So Far</th><th>Balance Qty</th><th>Batch</th><th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {issuesLoading && <tr><td colSpan={8} className="po-grid__cell--muted" style={{ textAlign: 'center' }}>Loading Issue Notes...</td></tr>}
                {!issuesLoading && !pickableIssues.length && (
                  <tr><td colSpan={8} className="po-grid__cell--muted" style={{ textAlign: 'center' }}>
                    {header.VENCOD ? 'No open Issue Note lines with remaining balance for this vendor.' : 'Select a vendor to see its open Issue Note lines.'}
                  </td></tr>
                )}
                {pickableIssues.map((issue) => (
                  <tr key={`${issue.doc_entry}-${issue.line_id}`}>
                    <td>{issue.doc_num}</td>
                    <td>{issue.item_code}</td>
                    <td>{issue.item_name}</td>
                    <td style={{ textAlign: 'right' }}>{issue.issued_qty}</td>
                    <td style={{ textAlign: 'right' }}>{issue.used_qty}</td>
                    <td style={{ textAlign: 'right' }}>{issue.balance_qty}</td>
                    <td>{issue.batch}</td>
                    <td style={{ textAlign: 'center' }}>
                      {!isLocked && (
                        <button type="button" className="po-btn po-btn--primary" style={{ padding: '1px 8px' }} onClick={() => addConsumptionRowFromIssue(issue)}>+</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="po-section-title">{isReturn ? 'Return Lines' : 'Consumption Lines'}</div>
          <div className="po-grid-wrap">
            <table className="po-grid">
              <thead>
                <tr>
                  <th>Issue Doc No</th><th>Item Code</th><th>Item Name</th><th>Warehouse</th><th>UoM</th>
                  <th>Batch</th><th>Bin Code</th><th>Balance Qty</th><th>{isReturn ? 'Return Qty' : 'Used Qty'}</th><th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {!consumptionLines.length && (
                  <tr><td colSpan={10} className="po-grid__cell--muted" style={{ textAlign: 'center' }}>Add lines from the Issue Notes above.</td></tr>
                )}
                {consumptionLines.map((line, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={index}>
                    <td>{line.srcDocNum}</td>
                    <td>{line.itemCode}</td>
                    <td>{line.itemName}</td>
                    <td>{line.whsCode}</td>
                    <td>{line.uom}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <input className="po-grid__input po-grid__input--text" value={line.batches?.length ? line.batches.map((b) => b.batchNumber).join(', ') : (line.batch || '')} readOnly />
                        <button type="button" onClick={() => openConsumptionBatchModal(index)} disabled={isLocked}
                          style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                          title="Allocate Batches">...</button>
                      </div>
                    </td>
                    <td>
                      {isWarehouseBinEnabled(referenceData.warehouses, line.whsCode) ? (
                        <select className="po-grid__input po-grid__input--text" value={line.binCode || ''} disabled>
                          {binOptionsWithCurrentValue(binsByWarehouse[line.whsCode], line.binCode).map((bin) => (
                            <option key={bin.BinAbsEntry} value={bin.BinCode}>{bin.BinCode}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="po-grid__input po-grid__input--text" value={line.binCode || ''} readOnly />
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{line.balanceQty}</td>
                    <td>
                      <input className="po-grid__input" type="number" value={line.qty || ''} disabled={isLocked} onChange={(e) => handleConsumptionQtyChange(index, e.target.value)} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {!isLocked && (
                        <button type="button" className="po-btn po-btn--danger" style={{ padding: '1px 7px' }} onClick={() => removeConsumptionRow(index)}>x</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'Finished Goods' && !isReturn && (
        <div className="po-tab-panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div className="po-section-title" style={{ marginBottom: 0 }}>Finished Goods Received</div>
            {!isLocked && <button type="button" className="po-btn po-btn--primary" onClick={addReceiptLine}>+ Add Line</button>}
          </div>
          <div className="po-grid-wrap">
            <table className="po-grid">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th><th>Item Code</th><th>Description</th><th>Quantity</th><th>Warehouse</th>
                  <th>UoM</th><th>Batch</th><th>Bin Code</th><th>Price</th><th>Remarks</th><th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {receiptLines.map((line, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={index}>
                    <td className="po-grid__cell--muted" style={{ textAlign: 'center' }}>{index + 1}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <input className="po-grid__input po-grid__input--text" value={line.ICode || ''} placeholder="Item Code" disabled={isLocked} onChange={(e) => handleReceiptLineChange(index, 'ICode', e.target.value)} />
                        <button type="button" onClick={() => setItemModal({ open: true, lineIndex: index })} disabled={isLocked}
                          style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                          title="Select Item">...</button>
                      </div>
                    </td>
                    <td><input className="po-grid__input po-grid__input--text" value={line.IName || ''} readOnly /></td>
                    <td><input className="po-grid__input" type="number" value={line.Qty || ''} disabled={isLocked} onChange={(e) => handleReceiptLineChange(index, 'Qty', e.target.value)} /></td>
                    <td>
                      <select className="po-grid__input po-grid__input--text" value={line.WhsCode || ''} disabled={isLocked} onChange={(e) => handleReceiptLineChange(index, 'WhsCode', e.target.value)}>
                        <option value="">Select</option>
                        {branchFilteredWarehouses.map((wh) => (
                          <option key={wh.WhsCode} value={wh.WhsCode}>{wh.WhsCode} - {wh.WhsName}</option>
                        ))}
                      </select>
                    </td>
                    <td><input className="po-grid__input po-grid__input--text" value={line.UOM || ''} readOnly /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <input className="po-grid__input po-grid__input--text" value={line.batches?.length ? line.batches.map((b) => b.batchNumber).join(', ') : (line.Batch || '')} readOnly placeholder={line._batchManaged ? 'Create batch' : 'Batch'} />
                        <button type="button" onClick={() => openReceiptBatchModal(index)} disabled={isLocked}
                          style={{ padding: '0 6px', fontSize: 11, border: '1px solid #a0aab4', background: 'linear-gradient(180deg,#fff 0%,#e8ecf0 100%)', minWidth: 24, height: 22, cursor: 'pointer', borderRadius: 2 }}
                          title="Create/Allocate Batches">...</button>
                      </div>
                    </td>
                    <td>
                      {isWarehouseBinEnabled(referenceData.warehouses, line.WhsCode) ? (
                        <select className="po-grid__input po-grid__input--text" value={line.BinCode || ''} disabled={isLocked} onChange={(e) => handleReceiptLineChange(index, 'BinCode', e.target.value)}>
                          <option value="">Select Bin</option>
                          {binOptionsWithCurrentValue(binsByWarehouse[line.WhsCode], line.BinCode).map((bin) => (
                            <option key={bin.BinAbsEntry} value={bin.BinCode}>{bin.BinCode}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="po-grid__input po-grid__input--text" value={line.BinCode || ''} onChange={(e) => handleReceiptLineChange(index, 'BinCode', e.target.value)} disabled={isLocked || !line.WhsCode} placeholder={line.WhsCode ? '' : 'Select warehouse first'} />
                      )}
                    </td>
                    <td><input className="po-grid__input" type="number" value={line.Price || ''} disabled={isLocked} onChange={(e) => handleReceiptLineChange(index, 'Price', e.target.value)} /></td>
                    <td><input className="po-grid__input po-grid__input--text" value={line.Remarks || ''} disabled={isLocked} onChange={(e) => handleReceiptLineChange(index, 'Remarks', e.target.value)} /></td>
                    <td style={{ textAlign: 'center' }}>
                      {!isLocked && (
                        <button type="button" className="po-btn po-btn--danger" style={{ padding: '1px 7px' }} onClick={() => removeReceiptLine(index)}>x</button>
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
                  <label className="po-field__label">Address ID</label>
                  {billToAddresses.length > 1 ? (
                    <select className="po-field__select" value={header[TRANSACTION.addressFields.billTo.addressId] || ''} onChange={(e) => handleAddressSelect('B', e.target.value)}>
                      {billToAddresses.map((address) => (
                        <option key={address.address_id} value={address.address_id}>{address.address_id}{address.city ? ` - ${address.city}` : ''}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.addressId] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.addressId, e.target.value)} />
                  )}
                </div>
                <div className="po-field">
                  <label className="po-field__label">City</label>
                  <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.city] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.city, e.target.value)} />
                </div>
                <div className="po-field">
                  <label className="po-field__label">GSTIN</label>
                  <input className="po-field__input" value={header[TRANSACTION.addressFields.billTo.gstin] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.billTo.gstin, e.target.value)} />
                </div>
              </div>
              <div className="col-md-6">
                <div className="po-section-title">Ship From</div>
                <div className="po-field">
                  <label className="po-field__label">Address ID</label>
                  {shipFromAddresses.length > 1 ? (
                    <select className="po-field__select" value={header[TRANSACTION.addressFields.shipFrom.addressId] || ''} onChange={(e) => handleAddressSelect('S', e.target.value)}>
                      {shipFromAddresses.map((address) => (
                        <option key={address.address_id} value={address.address_id}>{address.address_id}{address.city ? ` - ${address.city}` : ''}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.addressId] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.addressId, e.target.value)} />
                  )}
                </div>
                <div className="po-field">
                  <label className="po-field__label">City</label>
                  <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.city] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.city, e.target.value)} />
                </div>
                <div className="po-field">
                  <label className="po-field__label">GSTIN</label>
                  <input className="po-field__input" value={header[TRANSACTION.addressFields.shipFrom.gstin] || ''} onChange={(e) => handleHeaderChange(TRANSACTION.addressFields.shipFrom.gstin, e.target.value)} />
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
        mode={batchModal.mode}
        line={batchModal.lineIndex >= 0 ? (
          batchModal.mode === 'issue'
            ? {
              itemNo: consumptionLines[batchModal.lineIndex]?.itemCode,
              whse: consumptionLines[batchModal.lineIndex]?.whsCode,
              quantity: consumptionLines[batchModal.lineIndex]?.qty,
              inventoryUOM: consumptionLines[batchModal.lineIndex]?.uom,
              batches: consumptionLines[batchModal.lineIndex]?.batches || [],
            }
            : {
              itemNo: receiptLines[batchModal.lineIndex]?.ICode,
              whse: receiptLines[batchModal.lineIndex]?.WhsCode,
              quantity: receiptLines[batchModal.lineIndex]?.Qty,
              inventoryUOM: receiptLines[batchModal.lineIndex]?.UOM,
              batches: receiptLines[batchModal.lineIndex]?.batches || [],
            }
        ) : null}
        availableBatches={batchModal.availableBatches}
        loading={batchModal.loading}
        error={batchModal.error}
        onGenerateBatchNumber={batchModal.mode === 'receipt' ? generateNextBatchNumber : undefined}
        onClose={closeBatchModal}
        onSave={saveBatchModal}
      />
    </div>
  );
}
