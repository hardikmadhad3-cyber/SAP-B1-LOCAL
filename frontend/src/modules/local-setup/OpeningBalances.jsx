import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchOpeningBalances, postOpeningBalances } from '../../api/localFinanceApi';
import '../item-master/styles/itemMaster.css';
import './localSetup.css';

const today = () => new Date().toLocaleDateString('en-CA');
// SAP: G/L accounts and business partners post a journal entry (Opening Balance);
// item stock is received at its price against the opening balance account.
const TABS = {
  accounts: {
    label: 'G/L Accounts',
    columns: [['AccountCode', 'G/L account', 'accounts'], ['Debit', 'Debit', 'number'], ['Credit', 'Credit', 'number'], ['Remarks', 'Remarks', 'text']],
  },
  partners: {
    label: 'Business Partners',
    columns: [['CardCode', 'Business partner', 'partners'], ['Debit', 'Debit', 'number'], ['Credit', 'Credit', 'number'], ['DueDate', 'Due date', 'date'], ['Reference', 'Reference', 'text']],
  },
  items: {
    label: 'Items',
    columns: [['ItemCode', 'Item', 'items'], ['WhsCode', 'Warehouse', 'warehouses'], ['Quantity', 'Quantity', 'number'], ['Price', 'Price', 'number']],
  },
};
const emptyRows = () => [{}, {}, {}];
const message = (error) => error.response?.data?.message || error.message || 'The request failed.';
const display = (value) => (value == null ? '' : String(value).slice(0, 10));

export default function OpeningBalances() {
  const [tab, setTab] = useState('accounts');
  const [data, setData] = useState({ entries: [], accounts: [], partners: [], items: [], warehouses: [] });
  const [header, setHeader] = useState({ date: today(), offsetAccount: '', memo: '' });
  const [rows, setRows] = useState(emptyRows);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try { setData(await fetchOpeningBalances()); } catch (error) { setNotice({ error: true, text: message(error) }); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const lists = useMemo(() => ({
    accounts: data.accounts.map((a) => [a.AcctCode, `${a.AcctCode} - ${a.AcctName}`]),
    partners: data.partners.map((p) => [p.CardCode, `${p.CardCode} - ${p.CardName}`]),
    items: data.items.map((i) => [i.ItemCode, `${i.ItemCode} - ${i.ItemName}`]),
    warehouses: data.warehouses.map((w) => [w.WhsCode, `${w.WhsCode} - ${w.WhsName}`]),
  }), [data]);

  const switchTab = (next) => { setTab(next); setRows(emptyRows()); setNotice(null); };
  const setCell = (index, name, value) => setRows((current) => current.map((row, i) => (i === index ? { ...row, [name]: value } : row)));
  const filled = rows.filter((row) => Object.values(row).some((value) => value !== '' && value != null));
  const totals = filled.reduce((sum, row) => ({ debit: sum.debit + Number(row.Debit || 0), credit: sum.credit + Number(row.Credit || 0) }), { debit: 0, credit: 0 });

  const post = async (event) => {
    event.preventDefault();
    if (!filled.length) { setNotice({ error: true, text: 'Enter at least one opening balance row.' }); return; }
    setBusy(true); setNotice(null);
    try {
      const result = await postOpeningBalances(tab, { ...header, rows: filled });
      setRows(emptyRows());
      setNotice({ text: result.DocNum ? `Opening stock posted (goods receipt ${result.DocNum}).` : `Opening balance posted (journal entry ${result.Number}).` });
      await load();
    } catch (error) {
      setNotice({ error: true, text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const input = (row, index, [name, label, type]) => {
    const common = { className: 'im-grid__input', 'aria-label': `${label} row ${index + 1}`, value: row[name] ?? '', disabled: busy, onChange: (e) => setCell(index, name, e.target.value) };
    if (lists[type]) {
      return <select {...common}><option value="">Select</option>{lists[type].map(([code, text]) => <option key={code} value={code}>{text}</option>)}</select>;
    }
    return <input {...common} type={type} min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined} />;
  };

  const { columns } = TABS[tab];
  return <div className="im-page local-setup">
    <form onSubmit={post}>
      <div className="im-toolbar">
        <span className="im-toolbar__title">Opening Balances - Setup</span>
        <span className="im-mode-badge im-mode-badge--add">ADD</span>
        <button type="submit" className="im-btn im-btn--primary" disabled={busy}>{busy ? 'Posting...' : 'Post'}</button>
        <button type="button" className="im-btn" disabled={busy} onClick={() => { setRows(emptyRows()); setNotice(null); }}>Cancel</button>
      </div>
      {notice && <div role={notice.error ? 'alert' : 'status'} className={`im-alert im-alert--${notice.error ? 'error' : 'success'}`}>{notice.text}</div>}
      <div className="im-header-card">
        <div className="im-section-title">General</div>
        <div className="im-field-grid">
          <label className="im-field"><span className="im-field__label">Posting date</span>
            <input className="im-field__input" type="date" required value={header.date} disabled={busy} onChange={(e) => setHeader({ ...header, date: e.target.value })} /></label>
          <label className="im-field"><span className="im-field__label">Offset account</span>
            <select className="im-field__input im-field__select" value={header.offsetAccount} disabled={busy} onChange={(e) => setHeader({ ...header, offsetAccount: e.target.value })}>
              <option value="">Default (G/L Account Determination)</option>
              {lists.accounts.map(([code, text]) => <option key={code} value={code}>{text}</option>)}
            </select></label>
          <label className="im-field"><span className="im-field__label">Remarks</span>
            <input className="im-field__input" maxLength={254} value={header.memo} disabled={busy} onChange={(e) => setHeader({ ...header, memo: e.target.value })} /></label>
        </div>
      </div>
      <div className="im-tabs" role="tablist">
        {Object.entries(TABS).map(([key, { label }]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`im-tab${tab === key ? ' im-tab--active' : ''}`} onClick={() => switchTab(key)}>{label}</button>
        ))}
      </div>
      <div className="im-tab-panel">
        <div className="im-grid-wrap">
          <table className="im-grid">
            <thead><tr><th>#</th>{columns.map(([name, label]) => <th key={name}>{label}</th>)}<th aria-label="Remove row" /></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={index}>
                  <td>{index + 1}</td>
                  {columns.map((column) => <td key={column[0]}>{input(row, index, column)}</td>)}
                  <td><button type="button" className="im-btn" disabled={busy || rows.length === 1} onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ls-actions">
          <button type="button" className="im-btn" disabled={busy} onClick={() => setRows([...rows, {}])}>Add Row</button>
          {tab !== 'items' && <span className="ls-note">Debit {totals.debit.toFixed(2)} · Credit {totals.credit.toFixed(2)} · The offset account takes the difference.</span>}
        </div>
      </div>
    </form>
    <section className="ls-card ls-card--last">
      <div className="im-section-title">Posted opening balances</div>
      <div className="im-grid-wrap">
        <table className="im-grid">
          <thead><tr><th>Journal entry</th><th>Posting date</th><th>Remarks</th><th>Total</th></tr></thead>
          <tbody>
            {data.entries.length ? data.entries.map((entry) => (
              <tr key={entry.TransId}><td>{entry.Number}</td><td>{display(entry.RefDate)}</td><td>{entry.Memo}</td><td>{Number(entry.LocTotal || 0).toFixed(2)}</td></tr>
            )) : <tr><td colSpan={4}>No opening balances posted yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
