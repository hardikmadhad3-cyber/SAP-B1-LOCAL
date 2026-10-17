import React, { useState, useEffect } from 'react';
import '../item-master/styles/itemMaster.css';
import UoMGroupsGrid from './components/UoMGroupsGrid';
import GroupDefinitionModal from './components/GroupDefinitionModal';
import { createUoMGroup, updateUoMGroup, searchUoMGroups, fetchUoMs, createUoM } from '../../api/uomGroupApi';
import { useAuth } from '../../auth/AuthContext';

const errorMessage = (error) => error.response?.data?.message || error.message || 'Unable to load or save setup.';
const loadAllGroups = async () => {
  const rows = [];
  let page;
  do {
    page = await searchUoMGroups('', 50, rows.length);
    rows.push(...page);
  } while (page.length === 50);
  return rows;
};

export default function UoMGroupSetup() {
  const { company } = useAuth();
  const [groups, setGroups] = useState([]);
  const [uomOptions, setUomOptions] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('groups');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [newUoM, setNewUoM] = useState({ Code: '', Name: '' });

  useEffect(() => {
    let cancelled = false;
    setGroups([]);
    setUomOptions([]);
    setSelectedGroup(null);
    setNewUoM({ Code: '', Name: '' });
    setAlert(null);
    setLoading(true);
    Promise.all([fetchUoMs(), loadAllGroups()]).then(([units, rows]) => {
      if (!cancelled) { setUomOptions(units); setGroups(rows); }
    }).catch((error) => {
      if (!cancelled) setAlert({ type: 'error', msg: errorMessage(error) });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [company?.companyId, company?.dbName]);

  const reload = async () => {
    setLoading(true);
    try {
      const [units, rows] = await Promise.all([fetchUoMs(), loadAllGroups()]);
      setUomOptions(units);
      setGroups(rows);
      setSelectedGroup(null);
      setAlert(null);
    } catch (error) {
      setAlert({ type: 'error', msg: errorMessage(error) });
    } finally { setLoading(false); }
  };

  const handleSave = async () => {
    const filled = groups.filter((group) => group.AbsEntry != null || group.Code?.trim() || group.Name?.trim() || String(group.BaseUoM ?? '') !== '');
    if (filled.some((group) => !group.Code?.trim() || !group.Name?.trim() || String(group.BaseUoM ?? '') === '')) {
      setAlert({ type: 'error', msg: 'Code, Name and Base UoM are required for each entered group.' });
      return;
    }
    const codes = filled.map((group) => group.Code.trim().toUpperCase());
    if (new Set(codes).size !== codes.length) {
      setAlert({ type: 'error', msg: 'Each UoM group must have a unique code.' });
      return;
    }
    setLoading(true);
    try {
      for (const group of filled) {
        const data = { Name: group.Name.trim(), BaseUoM: Number(group.BaseUoM) };
        if (group.isNew || group.isModified) {
          const saved = group.isNew ? await createUoMGroup({ ...data, Code: group.Code.trim() }) : await updateUoMGroup(group.AbsEntry, data);
          setGroups((current) => current.map((row) => row === group ? { ...group, ...saved, isNew: false, isModified: false } : row));
        }
      }
      setGroups(await loadAllGroups());
      setAlert({ type: 'success', msg: 'UoM Groups saved successfully.' });
    } catch (error) {
      setAlert({ type: 'error', msg: errorMessage(error) });
    } finally { setLoading(false); }
  };

  const handleAddUoM = async () => {
    setLoading(true);
    try {
      await createUoM({ Code: newUoM.Code.trim(), Name: newUoM.Name.trim() });
      setAlert({ type: 'success', msg: 'Unit of measure added. Select it as a group base or in Group Definition.' });
      setNewUoM({ Code: '', Name: '' });
    } catch (error) {
      setAlert({ type: 'error', msg: errorMessage(error) });
    } finally {
      // Refresh even after a duplicate: another page may have created the unit.
      try { setUomOptions(await fetchUoMs()); }
      catch (error) { setAlert({ type: 'error', msg: errorMessage(error) }); }
      setLoading(false);
    }
  };

  return (
    <div className="im-page">
      <div className="im-toolbar">
        <span className="im-toolbar__title">Unit of Measurement Groups - Setup</span>
        {tab === 'groups' && <button className="im-btn im-btn--primary" onClick={handleSave} disabled={loading}>Update</button>}
        <button className="im-btn" onClick={reload} disabled={loading}>Cancel</button>
        <button className="im-btn" onClick={reload} disabled={loading}>Refresh</button>
      </div>
      {alert && <div role="alert" className={'im-alert im-alert--' + alert.type}>{alert.msg}</div>}
      <div className="im-tabs" role="tablist" aria-label="Unit of measure setup">
        <button role="tab" aria-selected={tab === 'groups'} className={'im-tab' + (tab === 'groups' ? ' im-tab--active' : '')} onClick={() => setTab('groups')}>UoM Groups</button>
        <button role="tab" aria-selected={tab === 'units'} className={'im-tab' + (tab === 'units' ? ' im-tab--active' : '')} onClick={() => setTab('units')}>Units of Measure</button>
      </div>
      {loading && <div role="status">Loading...</div>}
      {tab === 'units' ? (
        <div className="im-tab-panel">
          <div className="im-section-title">Company units of measure</div>
          <p>Create units here, then select them in a UoM group and define conversions.</p>
          <div className="im-field-grid">
            <label className="im-field"><span className="im-field__label">UoM Code*</span><input className="im-field__input" maxLength={20} value={newUoM.Code} disabled={loading} onChange={(e) => setNewUoM({ ...newUoM, Code: e.target.value })} /></label>
            <label className="im-field"><span className="im-field__label">UoM Name*</span><input className="im-field__input" maxLength={100} value={newUoM.Name} disabled={loading} onChange={(e) => setNewUoM({ ...newUoM, Name: e.target.value })} /></label>
          </div>
          <button className="im-btn im-btn--primary" onClick={handleAddUoM} disabled={loading || !newUoM.Code.trim() || !newUoM.Name.trim()}>Add UoM</button>
          <div className="im-grid-wrap"><table className="im-grid" aria-label="Company units of measure"><thead><tr><th>Code</th><th>Name</th></tr></thead><tbody>{uomOptions.map((unit) => <tr key={unit.code}><td>{unit.uomCode}</td><td>{unit.uomName}</td></tr>)}</tbody></table></div>
        </div>
      ) : <UoMGroupsGrid groups={groups} setGroups={setGroups} uomOptions={uomOptions} onOpenDefinition={setSelectedGroup} disabled={loading} />}
      {selectedGroup && <GroupDefinitionModal group={selectedGroup} uomOptions={uomOptions} onClose={() => setSelectedGroup(null)} onSave={reload} />}
    </div>
  );
}
