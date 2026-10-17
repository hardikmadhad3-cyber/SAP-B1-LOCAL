import React, { useCallback, useEffect, useState } from 'react';
import { fetchOpenRows, fetchReconcilablePartners, reconcileRows } from '../../api/localFinanceApi';
import '../item-master/styles/itemMaster.css';
import './localSetup.css';

const ORIGIN = {
  13: 'A/R Invoice', 14: 'A/R Credit Memo', 18: 'A/P Invoice', 19: 'A/P Credit Memo', 24: 'Incoming Payment',
  46: 'Outgoing Payment', 30: 'Journal Entry', '-2': 'Opening Balance', 15: 'Delivery', 20: 'Goods Receipt PO',
};
const today = () => new Date().toLocaleDateString('en-CA');
const message = (error) => error.response?.data?.message || error.message || 'The request failed.';
const money = (value) => Number(value || 0).toFixed(2);
const keyOf = (row) => `${row.TransId}:${row.LineId}`;

// SAP Internal Reconciliation: match a business partner's open debits and credits
// (e.g. a payment on account with an invoice, a credit memo with an invoice).
export default function InternalReconciliation() {
  const [partners, setPartners] = useState([]);
  const [cardCode, setCardCode] = useState('');
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState([]);
  const [chosen, setChosen] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const loadPartners = useCallback(async () => {
    try { setPartners(await fetchReconcilablePartners()); } catch (error) { setNotice({ error: true, text: message(error) }); }
  }, []);
  const loadRows = useCallback(async (code) => {
    setChosen({});
    if (!code) { setRows([]); return; }
    try { setRows(await fetchOpenRows(code)); } catch (error) { setNotice({ error: true, text: message(error) }); }
  }, []);
  useEffect(() => { loadPartners(); }, [loadPartners]);

  const toggle = (row) => setChosen((current) => {
    const next = { ...current };
    if (next[keyOf(row)] !== undefined) delete next[keyOf(row)];
    else next[keyOf(row)] = money(Math.abs(row.Open));
    return next;
  });
  const selected = rows.filter((row) => chosen[keyOf(row)] !== undefined);
  // Debits count positive, credits negative; they must net to zero.
  const difference = selected.reduce((sum, row) => sum + Math.sign(row.Open) * Number(chosen[keyOf(row)] || 0), 0);
  const overOpen = selected.some((row) => Number(chosen[keyOf(row)] || 0) > Math.abs(row.Open) + 0.005);
  const balanced = selected.length >= 2 && Math.abs(difference) < 0.005 && !overOpen;

  // SAP "Auto Reconcile": the smaller of selected debits/credits is matched on both
  // sides, oldest rows first (rows are listed by posting date).
  const autoReconcile = () => {
    const cents = (value) => Math.round(Math.abs(Number(value || 0)) * 100);
    const side = (sign) => selected.filter((row) => Math.sign(row.Open) === sign).reduce((sum, row) => sum + cents(row.Open), 0);
    const left = { 1: Math.min(side(1), side(-1)) };
    left[-1] = left[1];
    const next = {};
    selected.forEach((row) => {
      const sign = Math.sign(row.Open);
      const amount = Math.min(cents(row.Open), left[sign] || 0);
      left[sign] = (left[sign] || 0) - amount;
      next[keyOf(row)] = money(amount / 100);
    });
    setChosen(next);
  };

  const reconcile = async () => {
    setBusy(true); setNotice(null);
    try {
      const result = await reconcileRows({
        CardCode: cardCode, ReconDate: date,
        Rows: selected.map((row) => ({ TransId: row.TransId, LineId: row.LineId, Amount: Number(chosen[keyOf(row)]) })),
      });
      setNotice({ text: `Reconciliation ${result.ReconNum} saved.` });
      await loadRows(cardCode);
      await loadPartners();
    } catch (error) {
      setNotice({ error: true, text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  return <div className="im-page local-setup">
    <div className="im-toolbar">
      <span className="im-toolbar__title">Internal Reconciliation</span>
      <span className="im-mode-badge im-mode-badge--add">ADD</span>
      <button type="button" className="im-btn im-btn--primary" disabled={busy || !balanced} onClick={reconcile}>{busy ? 'Reconciling...' : 'Reconcile'}</button>
      <button type="button" className="im-btn" disabled={busy || selected.length < 2} onClick={autoReconcile}>Auto Reconcile</button>
      <button type="button" className="im-btn" disabled={busy} onClick={() => setChosen({})}>Cancel</button>
    </div>
    {notice && <div role={notice.error ? 'alert' : 'status'} className={`im-alert im-alert--${notice.error ? 'error' : 'success'}`}>{notice.text}</div>}
    <div className="im-header-card">
      <div className="im-section-title">Selection</div>
      <div className="im-field-grid">
        <label className="im-field"><span className="im-field__label">Business partner</span>
          <select className="im-field__input im-field__select" value={cardCode} disabled={busy}
            onChange={(e) => { setCardCode(e.target.value); setNotice(null); loadRows(e.target.value); }}>
            <option value="">Select</option>
            {partners.map((p) => <option key={p.CardCode} value={p.CardCode}>{`${p.CardCode} - ${p.CardName} (${p.OpenRows})`}</option>)}
          </select></label>
        <label className="im-field"><span className="im-field__label">Reconciliation date</span>
          <input className="im-field__input" type="date" value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
    </div>
    <section className="ls-card ls-card--last">
      <div className="im-section-title">Open transactions</div>
      <div className="im-grid-wrap">
        <table className="im-grid">
          <thead><tr><th aria-label="Select" /><th>Origin</th><th>Origin no.</th><th>Posting date</th><th>Due date</th><th>Remarks</th><th className="im-grid__cell--num">Open amount</th><th className="im-grid__cell--num">Amount to reconcile</th></tr></thead>
          <tbody>
            {rows.length ? rows.map((row) => {
              const key = keyOf(row);
              const isChosen = chosen[key] !== undefined;
              return <tr key={key} className={isChosen ? 'ls-row--selected' : undefined}>
                <td><input type="checkbox" aria-label={`Select ${ORIGIN[row.TransType] || 'transaction'} ${row.BaseRef || row.TransId}`} checked={isChosen} disabled={busy} onChange={() => toggle(row)} /></td>
                <td>{ORIGIN[row.TransType] || `Transaction ${row.TransType}`}</td>
                <td>{row.BaseRef || row.TransId}</td>
                <td>{String(row.RefDate || '').slice(0, 10)}</td>
                <td>{String(row.DueDate || '').slice(0, 10)}</td>
                <td>{row.LineMemo}</td>
                <td className="im-grid__cell--num">{money(row.Open)}</td>
                <td className="im-grid__cell--num">{isChosen && <input className="im-grid__input im-grid__cell--num" type="number" min="0" step="any" max={Math.abs(row.Open)} aria-label={`Amount to reconcile ${row.BaseRef || row.TransId}`}
                  value={chosen[key]} disabled={busy} onChange={(e) => setChosen({ ...chosen, [key]: e.target.value })} />}</td>
              </tr>;
            }) : <tr><td colSpan={8}>{cardCode ? 'No open transactions.' : 'Select a business partner.'}</td></tr>}
          </tbody>
        </table>
      </div>
      {selected.length > 0 && <p className="ls-note">Difference {money(difference)} — debits and credits must be equal to reconcile.</p>}
      {overOpen && <p role="alert" className="im-alert im-alert--error">Amount to reconcile cannot be more than the open amount.</p>}
    </section>
  </div>;
}
