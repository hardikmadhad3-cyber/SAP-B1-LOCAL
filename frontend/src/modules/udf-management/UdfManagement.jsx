import React, { useEffect, useState } from 'react';
import api from '../../api/client';
import '../item-master/styles/itemMaster.css';
import './udfManagement.css';

// SAP B1: Tools > Customization Tools > User-Defined Fields - Management.
const STRUCTURES = {
  st_None: 'Regular', st_Address: 'Address', st_Phone: 'Phone', st_Time: 'Time', st_Rate: 'Rate', st_Sum: 'Amount',
  st_Price: 'Price', st_Quantity: 'Quantity', st_Percentage: 'Percentage', st_Measurement: 'Measure',
};
const EMPTY = { Name: '', Description: '', Type: 'db_Alpha', SubType: 'st_None', EditSize: 10, DefaultValue: '', Mandatory: 'tNO',
  LinkedTable: '', ValidValuesMD: [], Formula: '', Validation: '', ValidationMessage: '' };
const message = (error) => error.response?.data?.message || error.message;

export default function UdfManagement() {
  const [meta, setMeta] = useState({ groups: [], types: [], linkable: [], local: true });
  const [table, setTable] = useState('');
  const [fields, setFields] = useState([]);
  const [sharedWith, setSharedWith] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    api.get('/udfs/tables').then((r) => {
      setMeta(r.data);
      setTable(r.data.groups[0]?.tables[0]?.code || '');
    }).catch((e) => setNotice({ error: true, text: message(e) })).finally(() => setBusy(false));
  }, []);

  const load = async (code) => {
    const r = await api.get('/udfs', { params: { table: code } });
    setFields(r.data.fields);
    setSharedWith(r.data.sharedWith || []);
  };
  useEffect(() => {
    if (!table) return;
    setBusy(true);
    setSelected(null);
    setForm(EMPTY);
    load(table).catch((e) => setNotice({ error: true, text: message(e) })).finally(() => setBusy(false));
  }, [table]);

  const type = meta.types.find((t) => t.name === form.Type);
  const change = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));
  const changeType = (value) => {
    const next = meta.types.find((t) => t.name === value);
    setForm((prev) => ({ ...prev, Type: value, SubType: next?.subTypes[0] || 'st_None', EditSize: next?.size ? next.size[2] : '', DefaultValue: '' }));
  };
  const newField = () => { setSelected(null); setForm(EMPTY); setNotice(null); };
  const edit = (field) => {
    setSelected(field.FieldID);
    setForm({ ...EMPTY, ...field, LinkedTable: field.LinkedTable || '', DefaultValue: field.DefaultValue ?? '',
      Formula: field.Formula || '', Validation: field.Validation || '', ValidationMessage: field.ValidationMessage || '',
      ValidValuesMD: field.ValidValuesMD || [] });
    setNotice(null);
  };
  const run = async (operation, done) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await operation();
      await load(table);
      if (result?.data?.FieldID !== undefined) edit(result.data); else newField();
      setNotice({ text: done });
    } catch (e) {
      setNotice({ error: true, text: message(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = (event) => {
    event.preventDefault();
    const payload = { ...form, TableName: table, ValidValuesMD: form.ValidValuesMD.filter((v) => String(v.Value).trim() !== '') };
    if (!type?.size) delete payload.EditSize;
    return selected == null
      ? run(() => api.post('/udfs', payload), `Field U_${form.Name} added. It now appears on the ${sharedWith.length > 1 ? 'marketing document' : 'master'} pages (Show UDFs).`)
      : run(() => api.patch(`/udfs/${table}/${selected}`, payload), 'Field updated.');
  };
  const remove = () => {
    // SAP warns the same way: the column and its data are dropped.
    if (!window.confirm(`Remove U_${form.Name}? The field and all values stored in it will be deleted.`)) return;
    run(() => api.delete(`/udfs/${table}/${selected}`), `Field U_${form.Name} removed.`);
  };
  const values = form.ValidValuesMD;
  const setValue = (index, key, value) => change('ValidValuesMD', values.map((v, i) => (i === index ? { ...v, [key]: value } : v)));
  const defaultInputType = form.Type === 'db_Date' ? (form.SubType === 'st_Time' ? 'time' : 'date')
    : ['db_Numeric', 'db_Float'].includes(form.Type) ? 'number' : 'text';
  const tableLabel = meta.groups.flatMap((g) => g.tables).find((t) => t.code === table)?.label || table;

  return <div className="im-page udf-page">
    <div className="im-toolbar">
      <span className="im-toolbar__title">User-Defined Fields - Management</span>
      <span className={`im-mode-badge im-mode-badge--${selected == null ? 'add' : 'update'}`}>{selected == null ? 'ADD' : 'UPDATE'}</span>
      <button type="button" className="im-btn" disabled={busy || !table} onClick={newField}>New</button>
    </div>
    {notice && <div role={notice.error ? 'alert' : 'status'} className={`im-alert im-alert--${notice.error ? 'error' : 'success'}`}>{notice.text}</div>}
    <div className="udf-layout">
      <nav className="udf-card udf-tree" aria-label="Tables">
        {meta.groups.map((group) => <div key={group.group}>
          <div className="im-section-title">{group.group}</div>
          {group.tables.map((t) => <button key={t.code} type="button" aria-current={t.code === table ? 'true' : undefined}
            className={`udf-tree__item${t.code === table ? ' udf-tree__item--active' : ''}`} onClick={() => setTable(t.code)}>
            {t.label} <span className="udf-muted">{t.code}</span>
          </button>)}
        </div>)}
      </nav>
      <div className="udf-main">
        <section className="udf-card">
          <div className="im-section-title">Fields of {tableLabel}</div>
          {sharedWith.length > 1 && <p className="udf-note">Marketing document fields are added to every marketing document ({sharedWith.join(', ')}), as in SAP B1.</p>}
          <div className="im-grid-wrap"><table className="im-grid">
            <thead><tr><th>Field</th><th>Description</th><th>Type</th><th>Length</th><th>Mandatory</th><th>Default</th><th>Logic</th><th></th></tr></thead>
            <tbody>{fields.map((field) => <tr key={field.FieldID} className={field.FieldID === selected ? 'udf-row--selected' : undefined}>
              <td>U_{field.Name}</td><td>{field.Description}</td>
              <td>{meta.types.find((t) => t.name === field.Type)?.label || field.Type}{field.SubType && field.SubType !== 'st_None' ? ` / ${STRUCTURES[field.SubType] || field.SubType}` : ''}</td>
              <td>{field.EditSize ?? ''}</td><td>{field.Mandatory === 'tYES' ? 'Yes' : ''}</td><td>{field.DefaultValue ?? ''}</td>
              <td>{[field.ValidValuesMD?.length && 'Valid values', field.LinkedTable && `Lookup: ${field.LinkedTable}`, field.Formula && 'Formula', field.Validation && 'Rule'].filter(Boolean).join(', ')}</td>
              <td><button type="button" className="im-btn" disabled={busy} onClick={() => edit(field)}>Edit</button></td>
            </tr>)}</tbody>
          </table></div>
          {!busy && !fields.length && <p className="udf-note">No user-defined fields on this table yet.</p>}
        </section>

        {table && <form className="udf-card" onSubmit={save}>
          <div className="im-section-title">{selected == null ? 'Add field' : `Edit U_${form.Name}`}</div>
          <fieldset className="udf-fieldset" disabled={busy}>
            <div className="im-field-grid">
              <label className="im-field"><span className="im-field__label">Field name*</span>
                <span className="udf-prefixed"><span className="udf-muted">U_</span>
                  <input aria-label="Field name*" className={`im-field__input${selected != null ? ' im-field__input--readonly' : ''}`} value={form.Name} readOnly={selected != null}
                    maxLength={50} required onChange={(e) => change('Name', e.target.value.replace(/^U_/i, ''))} /></span></label>
              <label className="im-field"><span className="im-field__label">Description*</span>
                <input className="im-field__input" value={form.Description} maxLength={80} required onChange={(e) => change('Description', e.target.value)} /></label>
              <label className="im-field"><span className="im-field__label">Type</span>
                <select className="im-field__input im-field__select" value={form.Type} disabled={selected != null} onChange={(e) => changeType(e.target.value)}>
                  {meta.types.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}</select></label>
              <label className="im-field"><span className="im-field__label">Structure</span>
                <select className="im-field__input im-field__select" value={form.SubType} disabled={selected != null} onChange={(e) => change('SubType', e.target.value)}>
                  {(type?.subTypes || []).map((s) => <option key={s} value={s}>{STRUCTURES[s] || s}</option>)}</select></label>
              {type?.size && <label className="im-field"><span className="im-field__label">Length</span>
                <input className="im-field__input" type="number" min={type.size[0]} max={type.size[1]} value={form.EditSize ?? ''} onChange={(e) => change('EditSize', e.target.value)} /></label>}
              <label className="im-field"><span className="im-field__label">Default value</span>
                {values.length ? <select className="im-field__input im-field__select" value={form.DefaultValue ?? ''} onChange={(e) => change('DefaultValue', e.target.value)}>
                  <option value="">(none)</option>{values.filter((v) => v.Value !== '').map((v) => <option key={v.Value} value={v.Value}>{v.Value} - {v.Description || v.Value}</option>)}</select>
                  : <input className="im-field__input" type={defaultInputType} step="any" value={form.DefaultValue ?? ''} onChange={(e) => change('DefaultValue', e.target.value)} />}</label>
              <label className="im-field"><span className="im-field__label">Mandatory</span>
                <input type="checkbox" checked={form.Mandatory === 'tYES'} onChange={(e) => change('Mandatory', e.target.checked ? 'tYES' : 'tNO')} /></label>
              <label className="im-field"><span className="im-field__label">Lookup (linked table)</span>
                <select className="im-field__input im-field__select" value={form.LinkedTable} disabled={values.length > 0} onChange={(e) => change('LinkedTable', e.target.value)}>
                  <option value="">(none)</option>{meta.linkable.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
            </div>

            <div className="udf-section">
              <div className="im-section-title">Valid values (drop-down list)</div>
              <div className="im-grid-wrap"><table className="im-grid udf-values">
                <thead><tr><th>#</th><th>Value</th><th>Description</th><th></th></tr></thead>
                <tbody>{values.map((v, index) => <tr key={index}>
                  <td>{index + 1}</td>
                  <td><input className="im-grid__input" aria-label={`Value ${index + 1}`} value={v.Value} onChange={(e) => setValue(index, 'Value', e.target.value)} /></td>
                  <td><input className="im-grid__input" aria-label={`Description ${index + 1}`} value={v.Description || ''} onChange={(e) => setValue(index, 'Description', e.target.value)} /></td>
                  <td><button type="button" className="im-btn" onClick={() => change('ValidValuesMD', values.filter((_, i) => i !== index))}>Remove</button></td>
                </tr>)}</tbody>
              </table></div>
              <div className="udf-actions"><button type="button" className="im-btn" disabled={Boolean(form.LinkedTable)}
                onClick={() => change('ValidValuesMD', [...values, { Value: '', Description: '' }])}>Add value</button></div>
            </div>

            {meta.local && <div className="udf-section">
              <div className="im-section-title">Logic</div>
              <label className="im-field udf-wide"><span className="im-field__label">Formula</span>
                <input className="im-field__input" value={form.Formula} placeholder="e.g. U_Length * U_Width   or   Quantity * U_Rate   or   SUM(U_Weight)"
                  onChange={(e) => change('Formula', e.target.value)} /></label>
              <label className="im-field udf-wide"><span className="im-field__label">Validation rule</span>
                <input className="im-field__input" value={form.Validation} placeholder="e.g. U_A + U_B = 100   or   U_Discount <= 10 AND U_Code <> ''"
                  onChange={(e) => change('Validation', e.target.value)} /></label>
              <label className="im-field udf-wide"><span className="im-field__label">Error message</span>
                <input className="im-field__input" value={form.ValidationMessage} maxLength={254} placeholder="Shown when the rule fails"
                  onChange={(e) => change('ValidationMessage', e.target.value)} /></label>
              <p className="udf-note">A formula fills the field when the record is saved (the field becomes read-only); a validation rule stops the save with your message.
                Use field names of this table (Quantity, Price, LineTotal, DocTotal, U_...). Operators: + - * / = &lt;&gt; &lt; &lt;= &gt; &gt;= AND OR NOT;
                functions ROUND(x, d), ABS, MIN, MAX, IF(condition, a, b), LEN; on a document title SUM(row field) adds up the rows.</p>
            </div>}

            <div className="udf-actions">
              <button type="submit" className="im-btn im-btn--primary">{selected == null ? 'Add' : 'Update'}</button>
              {selected != null && <button type="button" className="im-btn" onClick={newField}>Cancel</button>}
              {selected != null && <button type="button" className="im-btn im-btn--danger" onClick={remove}>Remove</button>}
            </div>
          </fieldset>
        </form>}
      </div>
    </div>
  </div>;
}
