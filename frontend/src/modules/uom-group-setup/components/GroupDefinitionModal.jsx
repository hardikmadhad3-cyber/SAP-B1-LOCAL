import React, { useState, useEffect } from 'react';
import { getUoMGroup, updateUoMGroup } from '../../../api/uomGroupApi';
import SapModalShell from '../../../components/common/SapModalShell';

const EMPTY_LINE = { AlternateUoM: '', BaseQuantity: 1, AlternateQuantity: 1 };

export default function GroupDefinitionModal({ group, uomOptions, onClose, onSave }) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getUoMGroup(group.AbsEntry).then((data) => {
      if (cancelled) return;
      const base = data.BaseUoM ?? group.BaseUoM;
      const rows = data.UoMGroupDefinitionCollection || [];
      setLines([
        { AlternateUoM: base, AlternateQuantity: 1, BaseQuantity: 1 },
        ...rows.filter((row) => Number(row.AlternateUoM) !== Number(base)),
      ]);
      setLoaded(true);
    }).catch((error) => {
      if (!cancelled) setAlert(error.response?.data?.message || error.message);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [group.AbsEntry, group.BaseUoM]);

  const displayLines = [...lines];
  while (displayLines.length < 3) displayLines.push({ ...EMPTY_LINE });
  const handleCellChange = (index, field, value) => {
    const next = [...displayLines];
    next[index] = { ...next[index], [field]: value };
    setLines(next);
  };

  const handleSave = async () => {
    const filled = lines.filter((line) => String(line.AlternateUoM ?? '') !== '');
    if (filled.some((line) => !Number.isFinite(Number(line.BaseQuantity)) || !Number.isFinite(Number(line.AlternateQuantity)) || Number(line.BaseQuantity) <= 0 || Number(line.AlternateQuantity) <= 0)) {
      setAlert('Quantities must be greater than zero.');
      return;
    }
    if (new Set(filled.map((line) => Number(line.AlternateUoM))).size !== filled.length) {
      setAlert('A unit of measure can appear only once in a group.');
      return;
    }
    setLoading(true);
    try {
      await updateUoMGroup(group.AbsEntry, {
        UoMGroupDefinitionCollection: filled.map((line) => ({ AlternateUoM: Number(line.AlternateUoM), BaseQuantity: Number(line.BaseQuantity), AlternateQuantity: Number(line.AlternateQuantity) })),
      });
      await onSave();
      onClose();
    } catch (error) {
      setAlert(error.response?.data?.message || error.message || 'Failed to save definition.');
    } finally { setLoading(false); }
  };

  return (
    <SapModalShell open title={'Group Definition - ' + group.Code + ' - Setup'} onClose={onClose} disabled={loading} footer={(
      <>
        <button className="sap-modal-shell__button sap-modal-shell__button--primary" onClick={handleSave} disabled={loading || !loaded}>Update</button>
        <button className="sap-modal-shell__button" onClick={onClose} disabled={loading}>Cancel</button>
      </>
    )}>
      {alert && <div role="alert" className="im-alert im-alert--error">{alert}</div>}
      {loading && <div role="status">Loading...</div>}
      <p>Alternate Quantity x alternate UoM = Base Quantity x base UoM. The base row is fixed at 1 = 1.</p>
      <div className="im-grid-wrap">
        <table className="im-grid" aria-label="Group conversion rules">
          <thead><tr><th>#</th><th>Alternate UoM*</th><th>Alternate Quantity</th><th>Base Quantity</th><th>Actions</th></tr></thead>
          <tbody>{displayLines.map((line, index) => {
            const isBase = index === 0;
            return (
              <tr key={index}>
                <td>{index + 1}</td>
                <td><select className="im-grid__input" aria-label={'Alternate UoM ' + (index + 1)} value={line.AlternateUoM ?? ''} disabled={loading || !loaded || isBase} onChange={(event) => handleCellChange(index, 'AlternateUoM', event.target.value)}>
                  <option value="">-- Select --</option>
                  {uomOptions.map((unit) => <option key={unit.code} value={unit.code}>{unit.name}</option>)}
                </select></td>
                {['AlternateQuantity', 'BaseQuantity'].map((field) => <td key={field}><input className="im-grid__input" aria-label={field + ' ' + (index + 1)} type="number" step="any" value={line[field] ?? ''} disabled={loading || !loaded || isBase} onChange={(event) => handleCellChange(index, field, event.target.value)} /></td>)}
                <td><button className="im-btn" aria-label={'Delete row ' + (index + 1)} disabled={loading || !loaded || isBase} onClick={() => setLines(displayLines.filter((_, row) => row !== index))}>Delete</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <button className="im-btn" onClick={() => setLines([...displayLines, { ...EMPTY_LINE }])} disabled={loading || !loaded}>+ Add Row</button>
    </SapModalShell>
  );
}
