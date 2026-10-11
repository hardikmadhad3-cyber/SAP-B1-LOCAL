import SapDateInput from '../../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from 'react';
import {
  createQcTransaction,
  listQcAddons,
  listQcTransactions,
  updateQcTransaction,
} from '../../api/qcApi';
import './styles/qc-management.css';

const DIRECTION_TYPES = ['Inward', 'Outward'];
const INSPECTION_STATUS = ['Open', 'In Progress', 'Closed', 'Released'];
const DECISION_TYPES = ['Pending', 'Accepted', 'Rejected', 'Rework'];
const DEFAULT_SOURCE_TYPES = ['GRPO', 'TRANSFER', 'CREDIT', 'PRODRCPT', 'GOODSRCPT', 'DELIVERY', 'GOODSISS', 'PRODISS'];

const DEFAULT_FORM = {
  transaction_no: '',
  direction: 'Inward',
  source_type: '',
  source_doc_no: '',
  party_name: '',
  item_code: '',
  lot_no: '',
  quantity: '',
  uom: '',
  inspection_status: 'Open',
  final_decision: 'Pending',
  inspector_name: '',
  inspection_date: '',
  remarks: '',
};

const newTransactionNo = () => `QC-${Date.now()}`;

const buildInitialForm = (directionFilter = null) => ({
  ...DEFAULT_FORM,
  direction: directionFilter || 'Inward',
  transaction_no: newTransactionNo(),
});

export default function QcTransactionsWorkspacePage({
  directionFilter = null,
  title = 'QC Transactions',
}) {
  const [rows, setRows] = useState([]);
  const [addons, setAddons] = useState([]);
  const [form, setForm] = useState(() => buildInitialForm(directionFilter));
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);

  const sourceTypeOptions = useMemo(() => {
    const fromAddons = addons
      .map((row) => String(row.addon_name || '').trim())
      .filter(Boolean);
    const merged = [...fromAddons, ...DEFAULT_SOURCE_TYPES];
    return [...new Set(merged)];
  }, [addons]);

  const visibleRows = useMemo(() => {
    if (!directionFilter) return rows;
    return rows.filter((row) => String(row.direction || '').toLowerCase() === directionFilter.toLowerCase());
  }, [rows, directionFilter]);

  useEffect(() => {
    if (!form.source_type && sourceTypeOptions.length) {
      setForm((current) => ({ ...current, source_type: sourceTypeOptions[0] }));
    }
  }, [sourceTypeOptions, form.source_type]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      direction: directionFilter || current.direction || 'Inward',
    }));
  }, [directionFilter]);

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 3500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [transactionData, addonsData] = await Promise.all([listQcTransactions(), listQcAddons()]);
      setRows(Array.isArray(transactionData) ? transactionData : []);
      setAddons(Array.isArray(addonsData) ? addonsData : []);
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setForm({
      ...buildInitialForm(directionFilter),
      source_type: sourceTypeOptions[0] || '',
    });
  };

  const save = async () => {
    const payload = {
      ...form,
      quantity: Number(form.quantity || 0),
    };

    if (!payload.transaction_no.trim() || !payload.source_type.trim() || !payload.item_code.trim() || payload.quantity <= 0) {
      showAlert('error', 'Transaction No, Transaction Name, Item Code and Quantity are required.');
      return;
    }

    setLoading(true);
    try {
      if (editingId) {
        await updateQcTransaction(editingId, payload);
        showAlert('success', 'Transaction updated.');
      } else {
        await createQcTransaction(payload);
        showAlert('success', 'Transaction created.');
      }
      resetForm();
      await loadData();
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to save transaction.');
    } finally {
      setLoading(false);
    }
  };

  const setStage = async (row, stage) => {
    const stagePatch = {
      start: { inspection_status: 'In Progress', final_decision: 'Pending' },
      pass: { inspection_status: 'Closed', final_decision: 'Accepted' },
      reject: { inspection_status: 'Closed', final_decision: 'Rejected' },
      rework: { inspection_status: 'Closed', final_decision: 'Rework' },
      release: { inspection_status: 'Released' },
    }[stage];

    if (!stagePatch) return;

    setLoading(true);
    try {
      await updateQcTransaction(row.id, { ...row, ...stagePatch });
      await loadData();
      showAlert('success', `Transaction ${row.transaction_no} moved to ${stagePatch.inspection_status}.`);
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to update transaction stage.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="qc-page sap-document-page qc-workspace">
      <div className="qc-toolbar">
        <div className="qc-workspace__toolbar-head">
          <span className="qc-toolbar__title">{title}</span>
          <span className="qc-workspace__toolbar-subtitle">
            Transaction names are read from Add-on Management
            {directionFilter ? ` | Direction: ${directionFilter}` : ''}
          </span>
        </div>
      </div>

      {alert ? <div className={`qc-alert qc-alert--${alert.type}`}>{alert.msg}</div> : null}

      <div className="qc-grid qc-workspace__block">
        <div className="qc-workspace__section-head">Transaction Entry</div>
        <div className="qc-workspace__transaction-form">
          <label><span>Transaction No</span><input className="qc-input" value={form.transaction_no} onChange={(e) => setForm((c) => ({ ...c, transaction_no: e.target.value }))} /></label>
          <label>
            <span>Transaction Name</span>
            <select className="qc-select" value={form.source_type} onChange={(e) => setForm((c) => ({ ...c, source_type: e.target.value }))}>
              {sourceTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span>Direction</span>
            <select
              className="qc-select"
              value={form.direction}
              disabled={Boolean(directionFilter)}
              onChange={(e) => setForm((c) => ({ ...c, direction: e.target.value }))}
            >
              {DIRECTION_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label><span>Source Doc No</span><input className="qc-input" value={form.source_doc_no} onChange={(e) => setForm((c) => ({ ...c, source_doc_no: e.target.value }))} /></label>
          <label><span>Party / Origin</span><input className="qc-input" value={form.party_name} onChange={(e) => setForm((c) => ({ ...c, party_name: e.target.value }))} /></label>
          <label><span>Item Code</span><input className="qc-input" value={form.item_code} onChange={(e) => setForm((c) => ({ ...c, item_code: e.target.value }))} /></label>
          <label><span>Lot / Batch</span><input className="qc-input" value={form.lot_no} onChange={(e) => setForm((c) => ({ ...c, lot_no: e.target.value }))} /></label>
          <label><span>Quantity</span><input className="qc-input" type="number" min="0" step="0.01" value={form.quantity} onChange={(e) => setForm((c) => ({ ...c, quantity: e.target.value }))} /></label>
          <label><span>UoM</span><input className="qc-input" value={form.uom} onChange={(e) => setForm((c) => ({ ...c, uom: e.target.value }))} /></label>
          <label>
            <span>Status</span>
            <select className="qc-select" value={form.inspection_status} onChange={(e) => setForm((c) => ({ ...c, inspection_status: e.target.value }))}>
              {INSPECTION_STATUS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span>Decision</span>
            <select className="qc-select" value={form.final_decision} onChange={(e) => setForm((c) => ({ ...c, final_decision: e.target.value }))}>
              {DECISION_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label><span>Inspector</span><input className="qc-input" value={form.inspector_name} onChange={(e) => setForm((c) => ({ ...c, inspector_name: e.target.value }))} /></label>
          <label><span>Inspection Date</span><SapDateInput className="qc-input"  value={form.inspection_date || ''} onChange={(e) => setForm((c) => ({ ...c, inspection_date: e.target.value }))} /></label>
          <label className="qc-workspace__transaction-remarks"><span>Remarks</span><textarea className="qc-input qc-workspace__textarea" value={form.remarks} onChange={(e) => setForm((c) => ({ ...c, remarks: e.target.value }))} /></label>
          <div className="qc-actions qc-workspace__transaction-actions">
            <button type="button" className="qc-btn qc-btn--primary" disabled={loading} onClick={save}>{editingId ? 'Update' : 'Add'}</button>
            <button type="button" className="qc-btn" disabled={loading} onClick={resetForm}>Clear</button>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Transaction No</th>
              <th>Transaction Name</th>
              <th>Direction</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Status</th>
              <th>Decision</th>
              <th>Inspector</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? visibleRows.map((row) => (
              <tr key={row.id}>
                <td>{row.transaction_no}</td>
                <td>{row.source_type}</td>
                <td>{row.direction}</td>
                <td>{row.item_code}</td>
                <td>{row.quantity}</td>
                <td>{row.inspection_status}</td>
                <td>{row.final_decision}</td>
                <td>{row.inspector_name || ''}</td>
                <td>
                  <div className="qc-actions qc-workspace__stage-actions">
                    <button type="button" className="qc-btn" onClick={() => setStage(row, 'start')}>Start</button>
                    <button type="button" className="qc-btn" onClick={() => setStage(row, 'pass')}>Pass</button>
                    <button type="button" className="qc-btn qc-btn--danger" onClick={() => setStage(row, 'reject')}>Reject</button>
                    <button type="button" className="qc-btn" onClick={() => setStage(row, 'rework')}>Rework</button>
                    <button type="button" className="qc-btn qc-btn--primary" onClick={() => setStage(row, 'release')}>Release</button>
                    <button
                      type="button"
                      className="qc-btn"
                      onClick={() => {
                        setEditingId(row.id);
                        setForm({
                          transaction_no: row.transaction_no || '',
                          direction: row.direction || 'Inward',
                          source_type: row.source_type || sourceTypeOptions[0] || '',
                          source_doc_no: row.source_doc_no || '',
                          party_name: row.party_name || '',
                          item_code: row.item_code || '',
                          lot_no: row.lot_no || '',
                          quantity: row.quantity ?? '',
                          uom: row.uom || '',
                          inspection_status: row.inspection_status || 'Open',
                          final_decision: row.final_decision || 'Pending',
                          inspector_name: row.inspector_name || '',
                          inspection_date: row.inspection_date || '',
                          remarks: row.remarks || '',
                        });
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={9} className="qc-empty">No transaction records found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
