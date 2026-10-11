import SapDateInput from '../../components/common/SapDateInput';
import React, { useEffect, useMemo, useState } from 'react';

const toNumber = (value) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmt = (value) => toNumber(value).toFixed(2);

function JournalEntryPreviewModal({
  isOpen,
  journalEntry,
  loading = false,
  error = '',
  onClose,
  onOpenLinkedMaster,
  onRegenerate,
  onOpenSource,
}) {
  const [activeEntryIndex, setActiveEntryIndex] = useState(0);

  useEffect(() => {
    setActiveEntryIndex(0);
  }, [journalEntry]);

  const entries = useMemo(() => {
    if (Array.isArray(journalEntry?.entries)) return journalEntry.entries;
    if (journalEntry?.lines) return [journalEntry];
    return [];
  }, [journalEntry]);
  const activeEntry = entries[activeEntryIndex] || entries[0] || null;
  const lines = useMemo(() => (activeEntry?.lines || []).map((line, index) => ({
    ...line,
    lineId: line.lineId || index + 1,
    debit: toNumber(line.debit),
    credit: toNumber(line.credit),
  })), [activeEntry]);
  const totals = useMemo(() => {
    const totalDebit = lines.reduce((sum, line) => sum + toNumber(line.debit), 0);
    const totalCredit = lines.reduce((sum, line) => sum + toNumber(line.credit), 0);
    return {
      totalDebit,
      totalCredit,
      difference: totalDebit - totalCredit,
    };
  }, [lines]);

  if (!isOpen) return null;

  const lineColumns = [
    ['account', 'G/L Acct/BP Code', '150'],
    ['name', 'G/L Acct/BP Name', '240'],
    ['debit', 'Debit', '120'],
    ['credit', 'Credit', '120'],
    ['currency', 'Currency', '90'],
    ['taxCode', 'Tax Code', '100'],
    ['remarks', 'Remarks', '210'],
    ['project', 'Project', '110'],
    ['location', 'Location', '120'],
    ['profitCenter', 'Profit Center', '130'],
  ];

  const balanced = Math.abs(totals.difference) < 0.01;
  const status = activeEntry?.status || 'Preview';
  const warnings = Array.isArray(journalEntry?.warnings) ? journalEntry.warnings : [];

  return (
    <div className="service-je-backdrop" role="dialog" aria-modal="true" data-document-dirty-ignore="true">
      <div className="service-je-window">
        <div className="service-je-titlebar">
          <span>Journal Entry Preview</span>
          <div className="service-je-actions">
            {onRegenerate && (
              <button type="button" className="del-btn" onClick={onRegenerate} disabled={loading}>
                Refresh
              </button>
            )}
            {onOpenSource && (
              <button type="button" className="del-btn" onClick={onOpenSource}>
                Source
              </button>
            )}
          </div>
          <button type="button" className="service-je-close" onClick={onClose}>x</button>
        </div>

        {loading && <div className="service-je-note">Generating journal entry preview...</div>}
        {error && <div className="service-je-note service-je-unbalanced">{error}</div>}
        {warnings.map((warning, index) => (
          <div className="service-je-note" key={`${warning}-${index}`}>{warning}</div>
        ))}

        {entries.length > 1 && (
          <div className="service-je-actions">
            {entries.map((entry, index) => (
              <button
                type="button"
                key={`${entry.origin || 'entry'}-${index}`}
                className={`del-btn${index === activeEntryIndex ? ' del-btn--primary' : ''}`}
                onClick={() => setActiveEntryIndex(index)}
              >
                Entry {index + 1}
              </button>
            ))}
          </div>
        )}

        <div className="service-je-header">
          <div>
            <label>Series</label>
            <input value={activeEntry?.series || ''} readOnly />
          </div>
          <div>
            <label>Number</label>
            <input value={activeEntry?.number || ''} readOnly />
          </div>
          <div>
            <label>Posting Date</label>
            <SapDateInput  value={activeEntry?.postingDate || ''} readOnly />
          </div>
          <div>
            <label>Due Date</label>
            <SapDateInput  value={activeEntry?.dueDate || ''} readOnly />
          </div>
          <div>
            <label>Document Date</label>
            <SapDateInput  value={activeEntry?.documentDate || ''} readOnly />
          </div>
          <div>
            <label>Origin</label>
            <input value={activeEntry?.origin || journalEntry?.source?.documentType || ''} readOnly />
          </div>
          <div>
            <label>Origin No</label>
            <input value={activeEntry?.originNo || ''} readOnly />
          </div>
          <div>
            <label>Trans No</label>
            <input value={activeEntry?.transNo || ''} readOnly />
          </div>
          <div>
            <label>Status</label>
            <input value={status} readOnly />
          </div>
          <div className="service-je-header__wide">
            <label>Remarks</label>
            <input value={activeEntry?.remarks || ''} readOnly />
          </div>
          <div>
            <label>Reference 1</label>
            <input value={activeEntry?.reference1 || ''} readOnly />
          </div>
          <div>
            <label>Reference 2</label>
            <input value={activeEntry?.reference2 || ''} readOnly />
          </div>
          <div>
            <label>Reference 3</label>
            <input value={activeEntry?.reference3 || ''} readOnly />
          </div>
          <div>
            <label>Project</label>
            <input value={activeEntry?.project || ''} readOnly />
          </div>
          <div>
            <label>Location</label>
            <input value={activeEntry?.location || ''} readOnly />
          </div>
        </div>

        <div className="service-je-grid-wrap">
          <table className="service-je-grid">
            <colgroup>
              <col style={{ width: 42 }} />
              {lineColumns.map((column) => <col key={column[0]} style={{ width: `${column[2]}px` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                {lineColumns.map((column) => <th key={column[0]}>{column[1]}</th>)}
              </tr>
            </thead>
            <tbody>
              {!loading && !lines.length && (
                <tr>
                  <td colSpan={lineColumns.length + 1} className="service-je-rownum">
                    No journal entry lines to show.
                  </td>
                </tr>
              )}
              {lines.map((line, index) => (
                <tr key={`${line.lineId}-${index}`}>
                  <td className="service-je-rownum">{index + 1}</td>
                  {lineColumns.map(([key], columnIndex) => (
                    <td key={key} className={['debit', 'credit'].includes(key) ? 'service-je-amount' : ''}>
                      <div className="service-je-cell">
                        {columnIndex === 0 && onOpenLinkedMaster && String(line.account || '').trim() ? (
                          <button type="button" className="service-je-golden" onClick={() => onOpenLinkedMaster(line)}>
                            {String(line[key] || '')}
                          </button>
                        ) : (
                          <input
                            value={['debit', 'credit'].includes(key) ? fmt(line[key]) : (line[key] || '')}
                            readOnly
                            style={{ textAlign: ['debit', 'credit'].includes(key) ? 'right' : 'left' }}
                          />
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Grid Footer Totals</td>
                <td className="service-je-total">{fmt(totals.totalDebit)}</td>
                <td className="service-je-total">{fmt(totals.totalCredit)}</td>
                <td colSpan={6}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="service-je-footer">
          <div>Total Debit : <strong>{fmt(totals.totalDebit)}</strong></div>
          <div>Total Credit: <strong>{fmt(totals.totalCredit)}</strong></div>
          <div className={balanced ? 'service-je-balanced' : 'service-je-unbalanced'}>
            Difference : <strong>{fmt(totals.difference)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

export default JournalEntryPreviewModal;
