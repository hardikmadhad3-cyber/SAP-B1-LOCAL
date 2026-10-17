import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchAdminGeneralSettings,
  fetchAdminGeneralSettingsBootstrap,
  fetchAdminGeneralSettingsOptions,
  saveAdminGeneralSettings,
} from '../../api/generalSettingsApi';
import './styles/generalSettings.css';

const today = () => new Date().toISOString().split('T')[0];

const DOCUMENT_DEFAULTS = [
  { key: 'sales', label: 'Sales Order', warehouseKey: 'salesWarehouse', seriesKey: 'salesSeries', seriesGroup: 'sales' },
  { key: 'salesQuotation', label: 'Sales Quotation', warehouseKey: 'salesQuotationWarehouse', seriesKey: 'salesQuotationSeries', seriesGroup: 'salesQuotation' },
  { key: 'arInvoice', label: 'A/R Invoice', warehouseKey: 'arInvoiceWarehouse', seriesKey: 'arInvoiceSeries', seriesGroup: 'arInvoice' },
  { key: 'arCreditMemo', label: 'A/R Credit Memo', warehouseKey: 'arCreditMemoWarehouse', seriesKey: 'arCreditMemoSeries', seriesGroup: 'arCreditMemo' },
  { key: 'delivery', label: 'Delivery', warehouseKey: 'deliveryWarehouse', seriesKey: 'deliverySeries', seriesGroup: 'delivery' },
  { key: 'purchaseRequest', label: 'Purchase Request', warehouseKey: 'purchaseRequestWarehouse', seriesKey: 'purchaseRequestSeries', seriesGroup: 'purchaseRequest' },
  { key: 'purchaseQuotation', label: 'Purchase Quotation', warehouseKey: 'purchaseQuotationWarehouse', seriesKey: 'purchaseQuotationSeries', seriesGroup: 'purchaseQuotation' },
  { key: 'purchaseOrder', label: 'Purchase Order', warehouseKey: 'purchaseOrderWarehouse', seriesKey: 'purchaseOrderSeries', seriesGroup: 'purchaseOrder' },
  { key: 'grpo', label: 'Goods Receipt PO', warehouseKey: 'grpoWarehouse', seriesKey: 'grpoSeries', seriesGroup: 'grpo' },
  { key: 'apInvoice', label: 'A/P Invoice', warehouseKey: 'apInvoiceWarehouse', seriesKey: 'apInvoiceSeries', seriesGroup: 'apInvoice' },
  { key: 'apCreditMemo', label: 'A/P Credit Memo', warehouseKey: 'apCreditMemoWarehouse', seriesKey: 'apCreditMemoSeries', seriesGroup: 'apCreditMemo' },
];

const EMPTY_FORM = DOCUMENT_DEFAULTS.reduce((settings, documentType) => ({
  ...settings,
  [documentType.warehouseKey]: '',
  [documentType.seriesKey]: '',
}), {});

const getWarehouseCode = (warehouse = {}) =>
  String(warehouse.WhsCode || warehouse.whsCode || warehouse.WarehouseCode || warehouse.code || '').trim();

const getWarehouseName = (warehouse = {}) =>
  String(warehouse.WhsName || warehouse.whsName || warehouse.WarehouseName || warehouse.name || '').trim();

const getSeriesLabel = (series = {}) =>
  String(series.SeriesName || series.Name || series.Series || '').trim();

export default function GeneralSettings() {
  const [companies, setCompanies] = useState([]);
  const [users, setUsers] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [userId, setUserId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [warehouses, setWarehouses] = useState([]);
  const [seriesByGroup, setSeriesByGroup] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    let ignore = false;
    fetchAdminGeneralSettingsBootstrap()
      .then((payload) => {
        if (ignore) return;
        setCompanies(payload.companies || []);
        setUsers(payload.users || []);
        setAssignments(payload.assignments || []);
        const firstAssignment = payload.assignments?.[0];
        if (firstAssignment) {
          setCompanyId(String(firstAssignment.CompanyId));
          setUserId(String(firstAssignment.UserId));
        }
      })
      .catch((error) => {
        if (!ignore) setAlert({ type: 'error', msg: error.response?.data?.message || error.message });
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => { ignore = true; };
  }, []);

  const availableUsers = useMemo(() => {
    const assignedUserIds = new Set(
      assignments
        .filter((assignment) => String(assignment.CompanyId) === String(companyId))
        .map((assignment) => String(assignment.UserId)),
    );
    return users.filter((user) => assignedUserIds.has(String(user.UserId)));
  }, [assignments, companyId, users]);

  useEffect(() => {
    if (!companyId) {
      setUserId('');
      return;
    }
    if (!availableUsers.some((user) => String(user.UserId) === String(userId))) {
      setUserId(availableUsers[0] ? String(availableUsers[0].UserId) : '');
    }
  }, [availableUsers, companyId, userId]);

  useEffect(() => {
    if (!companyId || !userId) {
      setForm(EMPTY_FORM);
      setWarehouses([]);
      setSeriesByGroup({});
      return;
    }

    let ignore = false;
    setLoading(true);
    setAlert(null);
    Promise.all([
      fetchAdminGeneralSettings(companyId, userId),
      fetchAdminGeneralSettingsOptions(companyId, userId, today()),
    ])
      .then(([settingsPayload, optionsPayload]) => {
        if (ignore) return;
        setForm({ ...EMPTY_FORM, ...(settingsPayload.settings || {}) });
        setWarehouses(optionsPayload.warehouses || []);
        setSeriesByGroup(optionsPayload.seriesByGroup || {});
      })
      .catch((error) => {
        if (!ignore) setAlert({ type: 'error', msg: error.response?.data?.message || error.message });
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => { ignore = true; };
  }, [companyId, userId]);

  const handleSave = async () => {
    if (!companyId || !userId) return;
    try {
      setSaving(true);
      setAlert(null);
      const payload = await saveAdminGeneralSettings(companyId, userId, form);
      setForm({ ...EMPTY_FORM, ...(payload.settings || {}) });
      setAlert({ type: 'success', msg: 'Defaults assigned successfully. The user will receive them on the next company login.' });
    } catch (error) {
      setAlert({ type: 'error', msg: error.response?.data?.message || error.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-entity-page general-settings-page">
      <section className="admin-entity-banner">
        <div>
          <div className="admin-entity-banner__eyebrow">Admin Section</div>
          <h1>General Settings</h1>
          <p>Assign document defaults to a specific user within a specific company.</p>
        </div>
        <div className="admin-entity-banner__actions">
          <button className="admin-panel-button" type="button" onClick={handleSave} disabled={loading || saving || !userId}>
            {saving ? 'Saving...' : 'Save Defaults'}
          </button>
          <button className="admin-panel-button admin-panel-button--ghost" type="button" onClick={() => setForm(EMPTY_FORM)} disabled={saving}>
            Clear Values
          </button>
        </div>
      </section>

      {alert ? <div className={`admin-panel-alert admin-panel-alert--${alert.type}`}>{alert.msg}</div> : null}

      <section className="admin-form-panel general-settings-page__assignment">
        <div className="admin-form-panel__header">
          <div>
            <h2>Default Owner</h2>
            <p>Only users assigned to the selected company are available.</p>
          </div>
        </div>
        <div className="admin-form-grid">
          <label className="admin-form-field">
            <span>Company</span>
            <select className="admin-panel-input" value={companyId} onChange={(event) => setCompanyId(event.target.value)} disabled={loading || saving}>
              <option value="">Select company</option>
              {companies.map((company) => (
                <option key={company.CompanyId} value={company.CompanyId}>
                  {company.CompanyName || company.DbName} ({company.CompanyId})
                </option>
              ))}
            </select>
          </label>
          <label className="admin-form-field">
            <span>User</span>
            <select className="admin-panel-input" value={userId} onChange={(event) => setUserId(event.target.value)} disabled={loading || saving || !companyId}>
              <option value="">Select user</option>
              {availableUsers.map((user) => (
                <option key={user.UserId} value={user.UserId}>
                  {user.FullName || user.Username} ({user.Username})
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="admin-form-panel">
        <div className="admin-form-panel__header">
          <div>
            <h2>Document Defaults</h2>
            <p>These values are applied when the selected user opens a new document.</p>
          </div>
        </div>
        <div className="general-settings-page__table">
          <div className="general-settings-page__table-head">Document</div>
          <div className="general-settings-page__table-head">Warehouse</div>
          <div className="general-settings-page__table-head">Series</div>
          {DOCUMENT_DEFAULTS.map((documentType) => (
            <React.Fragment key={documentType.key}>
              <div className="general-settings-page__document-label">{documentType.label}</div>
              <select
                className="admin-panel-input"
                value={form[documentType.warehouseKey] || ''}
                onChange={(event) => setForm((current) => ({ ...current, [documentType.warehouseKey]: event.target.value }))}
                disabled={loading || saving || !userId}
              >
                <option value="">No default warehouse</option>
                {warehouses.map((warehouse) => {
                  const code = getWarehouseCode(warehouse);
                  return <option key={`${documentType.key}-${code}`} value={code}>{code} - {getWarehouseName(warehouse)}</option>;
                })}
              </select>
              <select
                className="admin-panel-input"
                value={form[documentType.seriesKey] || ''}
                onChange={(event) => setForm((current) => ({ ...current, [documentType.seriesKey]: event.target.value }))}
                disabled={loading || saving || !userId}
              >
                <option value="">No default series</option>
                {(seriesByGroup[documentType.seriesGroup] || []).map((series) => (
                  <option key={`${documentType.key}-${series.Series}`} value={series.Series}>
                    {getSeriesLabel(series)} ({series.Series})
                  </option>
                ))}
              </select>
            </React.Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}
