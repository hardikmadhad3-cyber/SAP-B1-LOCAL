import SapDateInput from '../../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from 'react';
import {
  createQcTransaction,
  createQcWorkflow,
  listQcForms,
  listQcTransactions,
  listQcWorkflows,
  updateQcTransaction,
  updateQcWorkflow,
} from '../../api/qcApi';
import './styles/qc-management.css';

const DEFAULT_QC_FORMS = [
  {
    file: 'frmBParMap.xml',
    title: 'BP Parameter Mapping',
    fields: ['Remarks', 'Item Code', 'Active', 'User', 'Document No.', 'SO Num', 'SO Key'],
    actions: ['OK', 'Cancel'],
  },
  {
    file: 'frmBR.xml',
    title: 'Batch Released Form',
    fields: ['Branch', 'Item Code', 'Item Name', 'Product Code', 'DocNum', 'DocDate', 'Status', 'IT Approved', 'IT Reject', 'CN Reject', 'Remarks', 'QC Done By', 'Item Group', 'Unit', 'Next Re-Test Days', 'Assay (Min-Max)', 'Water (Min-Max)', 'Good Issue (Sample Qty)', 'Specific Gravity', 'Water Per Volume', 'Min Sample Qty'],
    actions: ['Add', 'Cancel', 'Delete', 'Display', 'Browse', 'Process', 'Print Status'],
  },
  {
    file: 'frmCpyPara.xml',
    title: 'Select Item',
    fields: ['Search'],
    actions: ['Process', 'Cancel'],
  },
  {
    file: 'frmIQC.xml',
    title: 'Inward QC',
    fields: ['Item Code', 'Item Name', 'Document Key', 'Warehouse', 'Document No', 'Date', 'Quantity', 'Sample Qty', 'Remark', 'User', 'IT No', 'Reduce Sample Qty', 'Good Issue No', 'Reduce Qty Issue', 'QC Status', 'GL Account', 'Approver', 'Pass Whs', 'Reject Whs', 'Rework Whs', 'Document No.', 'GRPO', 'AR Credit Note', 'Ignore QC Result'],
    actions: ['OK', 'Cancel', 'Load Parameter'],
  },
  {
    file: 'frmIns.xml',
    title: 'Inspection',
    fields: ['Item Code', 'Item Name', 'Document No', 'Document Key', 'Line No'],
    actions: ['OK', 'Cancel'],
  },
  {
    file: 'frmInstrument.xml',
    title: 'Instrument Master',
    fields: ['Instrument Code', 'Instrument Name', 'Remarks', 'Active'],
    actions: ['OK', 'Cancel'],
  },
  {
    file: 'frmLic.xml',
    title: 'License',
    fields: [],
    actions: ['Cancel', 'OK'],
  },
  {
    file: 'frmLicAuth.xml',
    title: 'Add-On License Authorization',
    fields: ['Product Id', 'Authorization No'],
    actions: ['OK', 'Cancel'],
  },
  {
    file: 'frmLicAuth1.xml',
    title: 'New Form 2',
    fields: [],
    actions: [],
  },
  {
    file: 'frmLicImp.xml',
    title: 'Add-On License Import',
    fields: ['File Path :'],
    actions: ['Import File', '...'],
  },
  {
    file: 'frmPQC.xml',
    title: 'In-Process QC',
    fields: ['Item Code', 'Item Name', 'Document Key', 'Warehouse', 'Document No', 'Date', 'Quantity', 'Sample Qty', 'Remark', 'User', 'IT No.', 'Reduce Sample Qty', 'Good Issue No', 'Reduce Qty Issue', 'QC Status', 'GL Account', 'Approver', 'Pass Whs', 'Reject Whs', 'Rework Whs', 'Document No.', 'Ignore QC Result'],
    actions: ['OK', 'Cancel', 'Load Parameter'],
  },
  {
    file: 'frmParMap.xml',
    title: 'Parameter Mapping',
    fields: ['Remarks', 'Item Code', 'Item Group Code', 'Active', 'Item Wise', 'Item Group Wise', 'User', 'Document No.'],
    actions: ['OK', 'Cancel', 'Copy Parameter'],
  },
  {
    file: 'frmParameter.xml',
    title: 'Parameter Master',
    fields: ['Parameter Code', 'Parameter Name', 'Remarks', 'Active'],
    actions: ['OK', 'Cancel'],
  },
  {
    file: 'frmQueue.xml',
    title: 'Quality Check Queue',
    fields: ['From Date', 'To Date', 'ItemCode', 'Ignore QC Process'],
    actions: ['Cancel', 'OK', 'Load Data', 'Collapse', 'Expand'],
  },
  {
    file: 'frmRTQCR.xml',
    title: 'Retest QC Request Form',
    fields: ['Branch', 'Unit', 'Doc No', 'DocDate', 'Ref No'],
    actions: ['Fetch Data', 'Add', 'Cancel', 'Process'],
  },
  {
    file: 'frmReQC.xml',
    title: 'Re Process QC',
    fields: ['Item Code', 'Item Name', 'Document Key', 'Warehouse', 'Document No', 'Date', 'Quantity', 'Sample Qty', 'Remark', 'User', 'IT No.', 'Reduce Sample Qty', 'Good Issue No', 'Reduce Qty Issue', 'QC Status', 'GL Account', 'Approver', 'Pass Whs', 'Reject Whs', 'Rework Whs', 'Document No.', 'Ignore QC Result'],
    actions: ['OK', 'Cancel', 'Load Parameter'],
  },
  {
    file: 'frmUST.xml',
    title: 'User Settings',
    fields: ['Product Id', 'Document No'],
    actions: ['OK', 'Cancel'],
  },
];

const WORKFLOW_TYPES = ['Inbound', 'Outbound', 'Custom'];
const APPROVAL_TYPES = ['No Approval', 'Single Level', 'Multi-Level'];
const SOURCE_TYPES = ['GRPO', 'TRANSFER', 'CREDIT', 'PRODRCPT', 'GOODSRCPT', 'DELIVERY', 'GOODSISS', 'PRODISS'];
const DIRECTION_TYPES = ['Inward', 'Outward'];
const INSPECTION_STATUS = ['Open', 'In Progress', 'Closed', 'Released'];
const DECISION_TYPES = ['Pending', 'Accepted', 'Rejected', 'Rework'];

const DEFAULT_WORKFLOW = {
  workflow_name: '',
  workflow_type: 'Inbound',
  trigger_event: '',
  assigned_inspector: '',
  approval_required: 'No Approval',
  is_active: true,
};

const DEFAULT_TRANSACTION = {
  transaction_no: '',
  direction: 'Inward',
  source_type: 'GRPO',
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

const toCheck = (v) => v === 1 || v === '1' || v === true;

const newTransactionNo = () => `QC-${Date.now()}`;

function renderFieldInput(field) {
  const key = String(field || '');
  const normalized = key.toLowerCase();

  const content = (() => {
    if (normalized.includes('active') || normalized.includes('ignore') || normalized.includes('wise')) {
      return (
        <label className="qc-workspace__checkbox" key={`${field}-check`}>
          <input type="checkbox" />
          <span>{field}</span>
        </label>
      );
    }

    if (normalized.includes('remark')) {
      return <textarea className="qc-input qc-workspace__textarea" placeholder={`Enter ${field}`} />;
    }

    return <input className="qc-input" placeholder={`Enter ${field}`} />;
  })();

  if (field.toLowerCase().includes('active') || field.toLowerCase().includes('ignore') || field.toLowerCase().includes('wise')) {
    return (
      <div className="qc-workspace__field-row" key={key}>
        <span className="qc-workspace__field-label">{field}</span>
        {content}
      </div>
    );
  }

  return (
    <div className="qc-workspace__field-row" key={key}>
      <span className="qc-workspace__field-label">{field}</span>
      {content}
    </div>
  );
}

export default function QcAddonWorkspacePage() {
  const [activeTab, setActiveTab] = useState('forms');
  const [formSearch, setFormSearch] = useState('');
  const [formIndex, setFormIndex] = useState(0);
  const [forms, setForms] = useState(DEFAULT_QC_FORMS);

  const [workflowRows, setWorkflowRows] = useState([]);
  const [workflowForm, setWorkflowForm] = useState(DEFAULT_WORKFLOW);
  const [editingWorkflowId, setEditingWorkflowId] = useState(null);

  const [transactionRows, setTransactionRows] = useState([]);
  const [transactionForm, setTransactionForm] = useState({
    ...DEFAULT_TRANSACTION,
    transaction_no: newTransactionNo(),
  });
  const [editingTransactionId, setEditingTransactionId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);

  const filteredForms = useMemo(() => {
    const q = formSearch.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter((f) => `${f.title} ${f.file}`.toLowerCase().includes(q));
  }, [formSearch, forms]);

  const selectedForm = filteredForms[formIndex] || filteredForms[0] || forms[0] || DEFAULT_QC_FORMS[0];

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 3500);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [formsData, wf, tx] = await Promise.all([listQcForms(), listQcWorkflows(), listQcTransactions()]);
      setForms(Array.isArray(formsData) && formsData.length ? formsData : DEFAULT_QC_FORMS);
      setWorkflowRows(Array.isArray(wf) ? wf : []);
      setTransactionRows(Array.isArray(tx) ? tx : []);
    } catch (error) {
      setForms(DEFAULT_QC_FORMS);
      showAlert('error', error?.response?.data?.message || 'Failed to load QC module data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setFormIndex(0);
  }, [formSearch]);

  const saveWorkflow = async () => {
    if (!workflowForm.workflow_name.trim() || !workflowForm.trigger_event.trim() || !workflowForm.assigned_inspector.trim()) {
      showAlert('error', 'Workflow Name, Trigger Event and Inspector are required.');
      return;
    }

    setLoading(true);
    try {
      if (editingWorkflowId) {
        await updateQcWorkflow(editingWorkflowId, workflowForm);
        showAlert('success', 'Workflow updated.');
      } else {
        await createQcWorkflow(workflowForm);
        showAlert('success', 'Workflow created.');
      }
      setWorkflowForm(DEFAULT_WORKFLOW);
      setEditingWorkflowId(null);
      await loadData();
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to save workflow.');
    } finally {
      setLoading(false);
    }
  };

  const saveTransaction = async () => {
    const payload = {
      ...transactionForm,
      quantity: Number(transactionForm.quantity || 0),
    };

    if (!payload.transaction_no.trim() || !payload.item_code.trim() || payload.quantity <= 0) {
      showAlert('error', 'Transaction No, Item Code and Quantity are required.');
      return;
    }

    setLoading(true);
    try {
      if (editingTransactionId) {
        await updateQcTransaction(editingTransactionId, payload);
        showAlert('success', 'Transaction updated.');
      } else {
        await createQcTransaction(payload);
        showAlert('success', 'Transaction created.');
      }
      setTransactionForm({ ...DEFAULT_TRANSACTION, transaction_no: newTransactionNo() });
      setEditingTransactionId(null);
      await loadData();
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to save transaction.');
    } finally {
      setLoading(false);
    }
  };

  const setTransactionStage = async (row, stage) => {
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
      showAlert('success', `Transaction ${row.transaction_no} updated to ${stagePatch.inspection_status}.`);
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
          <span className="qc-toolbar__title">QC Control Module</span>
          <span className="qc-workspace__toolbar-subtitle">Forms, workflow, and transaction lifecycle</span>
        </div>
        <div className="qc-workspace__mode-tabs">
          <button type="button" className={`qc-btn qc-workspace__mode-btn ${activeTab === 'forms' ? 'qc-btn--primary' : ''}`} onClick={() => setActiveTab('forms')}>Forms</button>
          <button type="button" className={`qc-btn qc-workspace__mode-btn ${activeTab === 'workflow' ? 'qc-btn--primary' : ''}`} onClick={() => setActiveTab('workflow')}>Workflow</button>
          <button type="button" className={`qc-btn qc-workspace__mode-btn ${activeTab === 'transaction' ? 'qc-btn--primary' : ''}`} onClick={() => setActiveTab('transaction')}>Transactions</button>
        </div>
      </div>

      {alert ? <div className={`qc-alert qc-alert--${alert.type}`}>{alert.msg}</div> : null}

      {activeTab === 'forms' ? (
        <div className="qc-workspace__forms-layout">
          <div className="qc-grid qc-workspace__form-list">
            <div className="qc-workspace__form-list-head">
              <div className="qc-workspace__section-title">QC Form List</div>
              <input
                className="qc-input"
                placeholder="Search form by title or xml file"
                value={formSearch}
                onChange={(e) => setFormSearch(e.target.value)}
              />
              <div className="qc-workspace__meta-note">{filteredForms.length} forms</div>
            </div>
            <div className="qc-workspace__form-list-body">
              {filteredForms.map((form, index) => (
                <button
                  key={form.file}
                  type="button"
                  className={`qc-workspace__form-item ${selectedForm?.file === form.file ? 'is-active' : ''}`}
                  onClick={() => setFormIndex(index)}
                >
                  <span>{form.title}</span>
                  <small>{form.file}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="qc-grid qc-workspace__form-preview">
            <div className="qc-workspace__window-title">
              <strong>{selectedForm.title || 'QC Form'}</strong>
              <span>{selectedForm.file}</span>
            </div>
            <div className="qc-workspace__window-body">
              <div className="qc-workspace__field-grid">
                {selectedForm.fields.length ? selectedForm.fields.map((field) => renderFieldInput(field)) : (
                  <div className="qc-empty">No fields captured for this XML.</div>
                )}
              </div>
              <div className="qc-workspace__actions">
                {selectedForm.actions.length ? selectedForm.actions.map((action) => (
                  <button key={action} type="button" className={`qc-btn ${String(action).toLowerCase() === 'ok' ? 'qc-btn--primary' : ''}`}>{action}</button>
                )) : <div className="qc-empty">No action buttons captured for this XML.</div>}
              </div>
              <div className="qc-workspace__meta-note">Source: Backend QC forms metadata via <code>/api/qc/forms</code></div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'workflow' ? (
        <div className="qc-grid qc-workspace__block">
          <div className="qc-workspace__section-head">Workflow Designer</div>
          <div className="qc-workspace__workflow-form">
            <label><span>Workflow Name</span><input className="qc-input" value={workflowForm.workflow_name} onChange={(e) => setWorkflowForm((c) => ({ ...c, workflow_name: e.target.value }))} /></label>
            <label><span>Type</span><select className="qc-select" value={workflowForm.workflow_type} onChange={(e) => setWorkflowForm((c) => ({ ...c, workflow_type: e.target.value }))}>{WORKFLOW_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            <label><span>Trigger Event</span><input className="qc-input" value={workflowForm.trigger_event} onChange={(e) => setWorkflowForm((c) => ({ ...c, trigger_event: e.target.value }))} /></label>
            <label><span>Inspector</span><input className="qc-input" value={workflowForm.assigned_inspector} onChange={(e) => setWorkflowForm((c) => ({ ...c, assigned_inspector: e.target.value }))} /></label>
            <label><span>Approval</span><select className="qc-select" value={workflowForm.approval_required} onChange={(e) => setWorkflowForm((c) => ({ ...c, approval_required: e.target.value }))}>{APPROVAL_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            <label className="qc-workspace__checkbox qc-workspace__checkbox--inline"><input className="qc-checkbox" type="checkbox" checked={toCheck(workflowForm.is_active)} onChange={(e) => setWorkflowForm((c) => ({ ...c, is_active: e.target.checked }))} /><span>Active</span></label>
            <div className="qc-actions">
              <button type="button" className="qc-btn qc-btn--primary" disabled={loading} onClick={saveWorkflow}>{editingWorkflowId ? 'Update' : 'Add'}</button>
              <button type="button" className="qc-btn" disabled={loading} onClick={() => { setEditingWorkflowId(null); setWorkflowForm(DEFAULT_WORKFLOW); }}>Clear</button>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Workflow Name</th>
                <th>Type</th>
                <th>Trigger Event</th>
                <th>Inspector</th>
                <th>Approval</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {workflowRows.length ? workflowRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.workflow_name}</td>
                  <td>{row.workflow_type}</td>
                  <td>{row.trigger_event}</td>
                  <td>{row.assigned_inspector}</td>
                  <td>{row.approval_required}</td>
                  <td>{toCheck(row.is_active) ? 'Yes' : 'No'}</td>
                  <td>
                    <button
                      type="button"
                      className="qc-btn"
                      onClick={() => {
                        setEditingWorkflowId(row.id);
                        setWorkflowForm({
                          workflow_name: row.workflow_name || '',
                          workflow_type: row.workflow_type || 'Inbound',
                          trigger_event: row.trigger_event || '',
                          assigned_inspector: row.assigned_inspector || '',
                          approval_required: row.approval_required || 'No Approval',
                          is_active: toCheck(row.is_active),
                        });
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={7} className="qc-empty">No workflow records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {activeTab === 'transaction' ? (
        <div className="qc-grid qc-workspace__block">
          <div className="qc-workspace__section-head">Transaction Lifecycle</div>
          <div className="qc-workspace__transaction-form">
            <label><span>Transaction No</span><input className="qc-input" value={transactionForm.transaction_no} onChange={(e) => setTransactionForm((c) => ({ ...c, transaction_no: e.target.value }))} /></label>
            <label><span>Direction</span><select className="qc-select" value={transactionForm.direction} onChange={(e) => setTransactionForm((c) => ({ ...c, direction: e.target.value }))}>{DIRECTION_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            <label><span>Source Type</span><select className="qc-select" value={transactionForm.source_type} onChange={(e) => setTransactionForm((c) => ({ ...c, source_type: e.target.value }))}>{SOURCE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            <label><span>Source Doc No</span><input className="qc-input" value={transactionForm.source_doc_no} onChange={(e) => setTransactionForm((c) => ({ ...c, source_doc_no: e.target.value }))} /></label>
            <label><span>Party / Origin</span><input className="qc-input" value={transactionForm.party_name} onChange={(e) => setTransactionForm((c) => ({ ...c, party_name: e.target.value }))} /></label>
            <label><span>Item Code</span><input className="qc-input" value={transactionForm.item_code} onChange={(e) => setTransactionForm((c) => ({ ...c, item_code: e.target.value }))} /></label>
            <label><span>Lot / Batch</span><input className="qc-input" value={transactionForm.lot_no} onChange={(e) => setTransactionForm((c) => ({ ...c, lot_no: e.target.value }))} /></label>
            <label><span>Quantity</span><input className="qc-input" type="number" min="0" step="0.01" value={transactionForm.quantity} onChange={(e) => setTransactionForm((c) => ({ ...c, quantity: e.target.value }))} /></label>
            <label><span>UoM</span><input className="qc-input" value={transactionForm.uom} onChange={(e) => setTransactionForm((c) => ({ ...c, uom: e.target.value }))} /></label>
            <label><span>Status</span><select className="qc-select" value={transactionForm.inspection_status} onChange={(e) => setTransactionForm((c) => ({ ...c, inspection_status: e.target.value }))}>{INSPECTION_STATUS.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            <label><span>Decision</span><select className="qc-select" value={transactionForm.final_decision} onChange={(e) => setTransactionForm((c) => ({ ...c, final_decision: e.target.value }))}>{DECISION_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            <label><span>Inspector</span><input className="qc-input" value={transactionForm.inspector_name} onChange={(e) => setTransactionForm((c) => ({ ...c, inspector_name: e.target.value }))} /></label>
            <label><span>Inspection Date</span><SapDateInput className="qc-input"  value={transactionForm.inspection_date || ''} onChange={(e) => setTransactionForm((c) => ({ ...c, inspection_date: e.target.value }))} /></label>
            <label className="qc-workspace__transaction-remarks"><span>Remarks</span><textarea className="qc-input qc-workspace__textarea" value={transactionForm.remarks} onChange={(e) => setTransactionForm((c) => ({ ...c, remarks: e.target.value }))} /></label>
            <div className="qc-actions qc-workspace__transaction-actions">
              <button type="button" className="qc-btn qc-btn--primary" disabled={loading} onClick={saveTransaction}>{editingTransactionId ? 'Update' : 'Add'}</button>
              <button type="button" className="qc-btn" disabled={loading} onClick={() => { setEditingTransactionId(null); setTransactionForm({ ...DEFAULT_TRANSACTION, transaction_no: newTransactionNo() }); }}>Clear</button>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Transaction No</th>
                <th>Direction</th>
                <th>Source</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Decision</th>
                <th>Inspector</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transactionRows.length ? transactionRows.map((row) => (
                <tr key={row.id}>
                  <td>{row.transaction_no}</td>
                  <td>{row.direction}</td>
                  <td>{row.source_type}</td>
                  <td>{row.item_code}</td>
                  <td>{row.quantity}</td>
                  <td>{row.inspection_status}</td>
                  <td>{row.final_decision}</td>
                  <td>{row.inspector_name || ''}</td>
                  <td>
                    <div className="qc-actions qc-workspace__stage-actions">
                      <button type="button" className="qc-btn" onClick={() => setTransactionStage(row, 'start')}>Start</button>
                      <button type="button" className="qc-btn" onClick={() => setTransactionStage(row, 'pass')}>Pass</button>
                      <button type="button" className="qc-btn qc-btn--danger" onClick={() => setTransactionStage(row, 'reject')}>Reject</button>
                      <button type="button" className="qc-btn" onClick={() => setTransactionStage(row, 'rework')}>Rework</button>
                      <button type="button" className="qc-btn qc-btn--primary" onClick={() => setTransactionStage(row, 'release')}>Release</button>
                      <button
                        type="button"
                        className="qc-btn"
                        onClick={() => {
                          setEditingTransactionId(row.id);
                          setTransactionForm({
                            transaction_no: row.transaction_no || '',
                            direction: row.direction || 'Inward',
                            source_type: row.source_type || 'GRPO',
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
      ) : null}
    </div>
  );
}
