import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  createQcInstrument,
  createQcItemParameterMapping,
  deleteQcItemParameterMapping,
  listQcInstruments,
  listQcParameters,
  listQcItemParameterMappings,
  saveQcItemParameterMappingHeader,
  updateQcItemParameterMapping,
} from '../../api/qcApi';
import { searchItems } from '../../api/itemApi';
import './styles/qc-management.css';

const HEADER_DEFAULT = {
  remarks: '',
  item_code: '',
  item_name: '',
  is_active: true,
  user_name: '',
};

const LINE_DEFAULT = {
  parameter_code: '',
  parameter_name: '',
  instrument_code: '',
  instrument_name: '',
  uom: '',
  parameter_type: '',
  rule_name: '',
  from_value: '',
  to_value: '',
  expected_value: '',
  is_optional: false,
};

const toBool = (value) => value === true || value === 1 || value === '1';

const RULE_OPTIONS = [
  { value: '-', label: '-' },
  { value: '=', label: 'Equal' },
  { value: 'IR', label: 'In Range (Between)' },
  { value: '>', label: 'Greater than' },
  { value: '>=', label: 'Greater or equal' },
  { value: '<', label: 'Smaller than' },
  { value: '<=', label: 'Smaller or equal' },
];

const normalizeRuleValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'between') return 'IR';
  if (raw.toLowerCase() === 'in range') return 'IR';
  return raw;
};

const INSTRUMENT_DEFAULT = {
  instrument_code: '',
  instrument_name: '',
  remarks: '',
  is_active: true,
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

export default function QcItemParameterMappingsWorkspacePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [itemOptions, setItemOptions] = useState([]);
  const [parameterOptions, setParameterOptions] = useState([]);
  const [instrumentOptions, setInstrumentOptions] = useState([]);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [header, setHeader] = useState(HEADER_DEFAULT);
  const [line, setLine] = useState(LINE_DEFAULT);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [showInstrumentPopup, setShowInstrumentPopup] = useState(false);
  const [savingInstrument, setSavingInstrument] = useState(false);
  const [instrumentDraft, setInstrumentDraft] = useState(INSTRUMENT_DEFAULT);
  const [alert, setAlert] = useState(null);

  const queryItemCode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return String(params.get('itemCode') || '').trim();
  }, [location.search]);

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 3500);
  };

  const loadRows = async () => {
    setLoading(true);
    try {
      const data = await listQcItemParameterMappings();
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to load parameter mappings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  useEffect(() => {
    if (!queryItemCode) {
      // Leaving Find mode: keep New mode blank so users can create fresh mapping.
      setHeader(HEADER_DEFAULT);
      setItemSearchQuery('');
      setEditingId(null);
      setLine(LINE_DEFAULT);
      return;
    }

    setHeader((current) => ({
      ...current,
      item_code: queryItemCode,
    }));
    setItemSearchQuery(queryItemCode);
    setEditingId(null);
    setLine(LINE_DEFAULT);
  }, [queryItemCode]);

  useEffect(() => {
    if (!queryItemCode || !rows.length) return;
    const latestRow = [...rows]
      .filter((row) => String(row.item_code || '').trim().toLowerCase() === queryItemCode.toLowerCase())
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];

    if (!latestRow) return;

    setHeader((current) => ({
      ...current,
      item_code: queryItemCode,
      item_name: current.item_name || latestRow.item_name || '',
      user_name: current.user_name || latestRow.user_name || '',
      remarks: current.remarks || latestRow.remarks || '',
      // Preserve user edits only when already changed away from default.
      is_active: current.is_active === HEADER_DEFAULT.is_active
        ? toBool(latestRow.is_active)
        : current.is_active,
    }));
  }, [queryItemCode, rows]);

  const loadMasters = async () => {
    try {
      const [parameterData, instrumentData] = await Promise.all([
        listQcParameters(),
        listQcInstruments(),
      ]);
      setParameterOptions(Array.isArray(parameterData) ? parameterData : []);
      setInstrumentOptions(Array.isArray(instrumentData) ? instrumentData : []);
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to load Item/Parameter/Instrument masters.');
    }
  };

  useEffect(() => {
    loadMasters();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const itemData = await searchItems(itemSearchQuery, 120, 0);
        if (!cancelled) {
          setItemOptions(Array.isArray(itemData) ? itemData : []);
        }
      } catch (_error) {
        if (!cancelled) {
          setItemOptions([]);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [itemSearchQuery]);

  const filteredItemOptions = useMemo(() => {
    const q = String(itemSearchQuery || '').trim().toLowerCase();
    if (!q) return itemOptions;
    return itemOptions.filter((item) => {
      const code = String(item.ItemCode || '').toLowerCase();
      const name = String(item.ItemName || '').toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [itemOptions, itemSearchQuery]);

  const isFindMode = Boolean(String(queryItemCode || '').trim());

  const mappedItemCodes = useMemo(() => {
    const used = new Set();
    for (const row of rows) {
      const code = normalizeText(row?.item_code);
      if (code) used.add(code);
    }
    return used;
  }, [rows]);

  const canSelectItemCode = (itemCode) => {
    if (isFindMode) return true;
    return !mappedItemCodes.has(normalizeText(itemCode));
  };

  const applySelectedItem = (item, { silent = false } = {}) => {
    const itemCode = String(item?.ItemCode || '');
    const itemName = String(item?.ItemName || '');

    if (itemCode && !canSelectItemCode(itemCode)) {
      setHeader((s) => ({ ...s, item_code: '', item_name: '' }));
      if (!silent) {
        showAlert('error', 'Parameter mapping already exists for this item. Use Find mode to edit.');
      }
      return false;
    }

    setHeader((s) => ({
      ...s,
      item_code: itemCode,
      item_name: itemName,
    }));
    return true;
  };

  const pickItemFromSearch = (queryValue, { silent = true } = {}) => {
    const q = normalizeText(queryValue);
    if (!q) {
      setHeader((s) => ({ ...s, item_code: '', item_name: '' }));
      return;
    }

    const exactMatch = filteredItemOptions.find((item) => {
      const code = normalizeText(item?.ItemCode);
      const name = normalizeText(item?.ItemName);
      const pair = normalizeText(`${item?.ItemCode || ''} - ${item?.ItemName || ''}`);
      return q === code || q === name || q === pair;
    });

    if (exactMatch) {
      applySelectedItem(exactMatch, { silent });
      return;
    }

    const selectableMatches = filteredItemOptions.filter((item) => canSelectItemCode(item?.ItemCode));

    if (selectableMatches.length === 1) {
      applySelectedItem(selectableMatches[0], { silent });
      return;
    }

    applySelectedItem(selectableMatches[0] || null, { silent: true });
  };

  useEffect(() => {
    pickItemFromSearch(itemSearchQuery, { silent: true });
  }, [itemSearchQuery, filteredItemOptions]);

  const selectedParameter = useMemo(() => {
    const code = String(line.parameter_code || '').trim();
    if (!code) return null;
    return parameterOptions.find((row) => String(row.parameter_code || '').trim() === code) || null;
  }, [line.parameter_code, parameterOptions]);

  const selectedInstrument = useMemo(() => {
    const code = String(line.instrument_code || '').trim();
    if (!code) return null;
    return instrumentOptions.find((row) => String(row.instrument_code || '').trim() === code) || null;
  }, [line.instrument_code, instrumentOptions]);

  useEffect(() => {
    if (!selectedParameter) return;
    setLine((current) => ({
      ...current,
      parameter_name: current.parameter_name || selectedParameter.parameter_name || '',
      uom: current.uom || selectedParameter.uom || '',
      parameter_type: current.parameter_type || selectedParameter.parameter_type || '',
    }));
  }, [selectedParameter]);

  useEffect(() => {
    if (!selectedInstrument) return;
    setLine((current) => ({
      ...current,
      instrument_name: selectedInstrument.instrument_name || current.instrument_name || '',
    }));
  }, [selectedInstrument]);

  const visibleRows = useMemo(() => {
    const itemCode = String(header.item_code || '').trim().toLowerCase();
    // New mode should not show old mappings by default.
    if (!itemCode) return [];
    return rows.filter((row) => String(row.item_code || '').trim().toLowerCase() === itemCode);
  }, [rows, header.item_code]);

  const usedParameterCodesForItem = useMemo(() => {
    const itemCode = String(header.item_code || '').trim().toLowerCase();
    if (!itemCode) return new Set();
    const used = new Set();
    for (const row of rows) {
      const rowItemCode = String(row.item_code || '').trim().toLowerCase();
      if (rowItemCode !== itemCode) continue;
      if (editingId && Number(row.id) === Number(editingId)) continue;
      used.add(String(row.parameter_code || '').trim().toLowerCase());
    }
    return used;
  }, [rows, header.item_code, editingId]);

  const availableParameterOptions = useMemo(() => {
    if (!header.item_code) return parameterOptions;
    return parameterOptions.filter((parameter) => {
      const code = String(parameter.parameter_code || '').trim().toLowerCase();
      return !usedParameterCodesForItem.has(code);
    });
  }, [parameterOptions, header.item_code, usedParameterCodesForItem]);

  const canSaveMapping = useMemo(() => {
    const hasItem = Boolean(String(header.item_code || '').trim());
    const hasLoadedParameters = visibleRows.length > 0;
    return hasItem && hasLoadedParameters;
  }, [header.item_code, visibleRows.length]);

  const resetLine = () => {
    setEditingId(null);
    setLine(LINE_DEFAULT);
  };

  const resetHeader = () => {
    setHeader(HEADER_DEFAULT);
    setItemSearchQuery('');
  };

  const openNewMode = () => {
    navigate('/qc/item-parameter-mappings');
    setEditingId(null);
    setLine(LINE_DEFAULT);
    setHeader(HEADER_DEFAULT);
    setItemSearchQuery('');
  };

  const openFindMode = () => {
    navigate('/qc/item-parameter-mappings/find');
  };

  const saveCompletedMapping = async () => {
    const itemCode = String(header.item_code || '').trim();
    if (!itemCode) {
      showAlert('error', 'Select Item Code before saving mapping.');
      return;
    }

    const selectedRows = rows.filter((row) => String(row.item_code || '').trim().toLowerCase() === itemCode.toLowerCase());
    if (!selectedRows.length) {
      showAlert('error', 'Add at least one parameter line before saving mapping.');
      return;
    }

    const hasUnsavedLineDraft = Boolean(
      line.parameter_code
      || line.parameter_name
      || line.instrument_code
      || line.instrument_name
      || line.uom
      || line.parameter_type
      || line.rule_name
      || line.from_value
      || line.to_value
      || line.expected_value
      || line.is_optional,
    );

    if (hasUnsavedLineDraft) {
      showAlert('error', 'Please click Add Line/Update Line for current entry before Save Mapping.');
      return;
    }

    setSavingMapping(true);
    try {
      await saveQcItemParameterMappingHeader({
        item_code: itemCode,
        item_name: header.item_name,
        remarks: header.remarks,
        user_name: header.user_name,
        is_active: header.is_active ? 1 : 0,
      });

      await loadRows();
      showAlert('success', `Mapping saved for item ${itemCode}.`);
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to save mapping.');
    } finally {
      setSavingMapping(false);
    }
  };

  const buildPayload = () => ({
    ...line,
    ...header,
    item_code: String(header.item_code || '').trim(),
    item_name: String(header.item_name || '').trim(),
    parameter_code: String(line.parameter_code || '').trim(),
    is_active: header.is_active ? 1 : 0,
    is_optional: line.is_optional ? 1 : 0,
  });

  const save = async () => {
    const payload = buildPayload();
    if (!payload.item_code) {
      showAlert('error', 'Item Code is required.');
      return;
    }
    if (!payload.parameter_code) {
      showAlert('error', 'Parameter Code is required.');
      return;
    }

    const ruleValue = normalizeRuleValue(payload.rule_name);
    const fromValue = String(payload.from_value || '').trim();
    const toValue = String(payload.to_value || '').trim();

    if (ruleValue === 'IR') {
      if (!fromValue || !toValue) {
        showAlert('error', 'From and To are required for Between rule.');
        return;
      }

      const fromNum = Number(fromValue);
      const toNum = Number(toValue);
      if (Number.isFinite(fromNum) && Number.isFinite(toNum) && fromNum > toNum) {
        showAlert('error', 'From value cannot be greater than To value.');
        return;
      }
    }

    if (['=', '>', '>=', '<', '<='].includes(ruleValue) && !fromValue) {
      showAlert('error', 'From is required for selected rule.');
      return;
    }

    payload.rule_name = ruleValue;
    if (ruleValue !== 'IR') {
      payload.to_value = '';
    }

    const duplicateExists = rows.some((row) => (
      row.id !== editingId
      && String(row.item_code || '').trim().toLowerCase() === String(payload.item_code || '').trim().toLowerCase()
      && String(row.parameter_code || '').trim().toLowerCase() === String(payload.parameter_code || '').trim().toLowerCase()
    ));

    if (duplicateExists) {
      showAlert('error', 'This parameter is already mapped for the selected item.');
      return;
    }

    setLoading(true);
    try {
      if (editingId) {
        await updateQcItemParameterMapping(editingId, payload);
        showAlert('success', 'Parameter mapping updated.');
      } else {
        await createQcItemParameterMapping(payload);
        showAlert('success', 'Parameter mapping created.');
      }
      resetLine();
      await loadRows();
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to save parameter mapping.');
    } finally {
      setLoading(false);
    }
  };

  const saveInstrumentFromPopup = async () => {
    const payload = {
      instrument_code: String(instrumentDraft.instrument_code || '').trim(),
      instrument_name: String(instrumentDraft.instrument_name || '').trim(),
      remarks: String(instrumentDraft.remarks || '').trim(),
      is_active: instrumentDraft.is_active ? 1 : 0,
    };

    if (!payload.instrument_code) {
      showAlert('error', 'Instrument Code is required.');
      return;
    }
    if (!payload.instrument_name) {
      showAlert('error', 'Instrument Name is required.');
      return;
    }

    const exists = instrumentOptions.some((row) => (
      String(row.instrument_code || '').trim().toLowerCase() === payload.instrument_code.toLowerCase()
    ));
    if (exists) {
      showAlert('error', 'Instrument Code already exists.');
      return;
    }

    setSavingInstrument(true);
    try {
      const created = await createQcInstrument(payload);
      const refreshed = await listQcInstruments();
      setInstrumentOptions(Array.isArray(refreshed) ? refreshed : []);

      const nextCode = String(created?.instrument_code || payload.instrument_code);
      const nextName = String(created?.instrument_name || payload.instrument_name);
      setLine((current) => ({
        ...current,
        instrument_code: nextCode,
        instrument_name: nextName,
      }));

      setShowInstrumentPopup(false);
      setInstrumentDraft(INSTRUMENT_DEFAULT);
      showAlert('success', 'Instrument created and selected.');
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to create instrument.');
    } finally {
      setSavingInstrument(false);
    }
  };

  const editRow = (row) => {
    setEditingId(row.id);
    setHeader({
      remarks: row.remarks || '',
      item_code: row.item_code || '',
      item_name: row.item_name || '',
      is_active: toBool(row.is_active),
      user_name: row.user_name || '',
    });
    setLine({
      parameter_code: row.parameter_code || '',
      parameter_name: row.parameter_name || '',
      instrument_code: row.instrument_code || '',
      instrument_name: row.instrument_name || '',
      uom: row.uom || '',
      parameter_type: row.parameter_type || '',
      rule_name: normalizeRuleValue(row.rule_name),
      from_value: row.from_value || '',
      to_value: row.to_value || '',
      expected_value: row.expected_value || '',
      is_optional: toBool(row.is_optional),
    });
  };

  const removeRow = async (id) => {
    if (!window.confirm('Delete this parameter mapping line?')) return;

    setLoading(true);
    try {
      await deleteQcItemParameterMapping(id);
      showAlert('success', 'Parameter mapping deleted.');
      await loadRows();
      if (editingId === id) resetLine();
    } catch (error) {
      showAlert('error', error?.response?.data?.message || 'Failed to delete parameter mapping.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="qc-page sap-document-page qc-workspace qc-itemmap-page">
      <div className="qc-toolbar">
        <div className="qc-workspace__toolbar-head">
          <span className="qc-toolbar__title">Item-wise Parameter Mapping</span>
          <span className="qc-workspace__toolbar-subtitle">
            {queryItemCode ? `Loaded Item: ${queryItemCode}` : 'Create New or Find Existing Item Mapping'}
          </span>
        </div>
        <button type="button" className="qc-btn qc-btn--primary" onClick={openNewMode}>New</button>
        <button type="button" className="qc-btn qc-btn--primary" disabled={!canSaveMapping || loading || savingMapping} onClick={saveCompletedMapping}>Save</button>
<button type="button" className="qc-btn" data-sap-find-action onClick={openFindMode}>Find</button>
      </div>

      {alert ? <div className={`qc-alert qc-alert--${alert.type}`}>{alert.msg}</div> : null}

      <div className="qc-itemmap-page__top" style={{ marginBottom: 12 }}>
        <div className="qc-grid qc-workspace__block qc-itemmap-page__card">
          <div className="qc-workspace__section-head">Header</div>
          <div className="qc-workspace__transaction-form qc-itemmap-page__form qc-itemmap-page__header-form">
          <label className="qc-itemmap-page__field-full">
            <span>Item Selection</span>
            <input
              className="qc-input"
              placeholder="Search Item Code / Item Name"
              value={itemSearchQuery}
              onChange={(e) => setItemSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  pickItemFromSearch(itemSearchQuery, { silent: false });
                }
              }}
            />
            <select
              className="qc-select"
              value={header.item_code}
              onChange={(e) => {
                const code = e.target.value;
                const selectedItem = filteredItemOptions.find((item) => String(item.ItemCode || '') === code);
                if (!selectedItem) {
                  applySelectedItem({ ItemCode: code, ItemName: '' }, { silent: true });
                  setItemSearchQuery(String(code || ''));
                  return;
                }

                const applied = applySelectedItem(selectedItem, { silent: false });
                if (!applied) {
                  return;
                }
                setItemSearchQuery(String(code || ''));
              }}
            >
              <option value="">Select Item</option>
              {filteredItemOptions.map((item) => (
                <option
                  key={String(item.ItemCode || '')}
                  value={String(item.ItemCode || '')}
                  disabled={!canSelectItemCode(item.ItemCode)}
                >
                  {String(item.ItemCode || '')} - {String(item.ItemName || '')}
                  {!canSelectItemCode(item.ItemCode) ? ' (Already mapped)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Item Code</span>
            <input className="qc-input" value={header.item_code} readOnly />
          </label>
          <label>
            <span>Item Name</span>
            <input className="qc-input" value={header.item_name} readOnly />
          </label>
          <label>
            <span>User</span>
            <input className="qc-input" value={header.user_name} onChange={(e) => setHeader((s) => ({ ...s, user_name: e.target.value }))} />
          </label>
          <label>
            <span>Remarks</span>
            <textarea className="qc-input qc-workspace__textarea" value={header.remarks} onChange={(e) => setHeader((s) => ({ ...s, remarks: e.target.value }))} />
          </label>
          <label className="qc-workspace__checkbox qc-itemmap-page__field-full">
            <input type="checkbox" checked={header.is_active} onChange={(e) => setHeader((s) => ({ ...s, is_active: e.target.checked }))} />
            Active
          </label>
          <div className="qc-actions qc-workspace__transaction-actions qc-itemmap-page__field-full">
            <button type="button" className="qc-btn" disabled={loading} onClick={resetHeader}>Clear Header</button>
          </div>
        </div>
        </div>

        <div className="qc-grid qc-workspace__block qc-itemmap-page__card">
          <div className="qc-workspace__section-head">Parameter Line Entry</div>
          <div className="qc-workspace__transaction-form qc-itemmap-page__form">
          <label>
            <span>Parameter Code</span>
            <select
              className="qc-select"
              value={line.parameter_code}
              onChange={(e) => {
                const code = e.target.value;
                const selected = parameterOptions.find((row) => String(row.parameter_code || '').trim() === code);
                setLine((s) => ({
                  ...s,
                  parameter_code: code,
                  parameter_name: selected?.parameter_name || s.parameter_name,
                  uom: selected?.uom || s.uom,
                  parameter_type: selected?.parameter_type || s.parameter_type,
                }));
              }}
            >
              <option value="">Select Parameter</option>
              {availableParameterOptions.map((parameter) => (
                <option key={String(parameter.parameter_code || '')} value={String(parameter.parameter_code || '')}>
                  {String(parameter.parameter_code || '')} - {String(parameter.parameter_name || '')}
                </option>
              ))}
            </select>
            {header.item_code && !editingId && availableParameterOptions.length === 0 ? (
              <small className="qc-workspace__meta-note">All parameters are already mapped for this item.</small>
            ) : null}
          </label>
          <label>
            <span>Parameter Name</span>
            <input className="qc-input" value={line.parameter_name} onChange={(e) => setLine((s) => ({ ...s, parameter_name: e.target.value }))} />
          </label>
          <label>
            <span>Instrument Code</span>
            <div className="qc-actions" style={{ marginBottom: 4 }}>
              <button
                type="button"
                className="qc-btn"
                onClick={() => {
                  setShowInstrumentPopup(true);
                  setInstrumentDraft(INSTRUMENT_DEFAULT);
                }}
              >
                + Add Instrument
              </button>
            </div>
            <select
              className="qc-select"
              value={line.instrument_code}
              onChange={(e) => {
                const code = e.target.value;
                const selected = instrumentOptions.find((row) => String(row.instrument_code || '').trim() === code);
                setLine((s) => ({
                  ...s,
                  instrument_code: code,
                  instrument_name: selected?.instrument_name || s.instrument_name,
                }));
              }}
            >
              <option value="">Select Instrument</option>
              {instrumentOptions.map((instrument) => (
                <option key={String(instrument.instrument_code || '')} value={String(instrument.instrument_code || '')}>
                  {String(instrument.instrument_code || '')} - {String(instrument.instrument_name || '')}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Instrument Name</span>
            <input className="qc-input" value={line.instrument_name} onChange={(e) => setLine((s) => ({ ...s, instrument_name: e.target.value }))} />
          </label>
          <label>
            <span>UOM</span>
            <input className="qc-input" value={line.uom} onChange={(e) => setLine((s) => ({ ...s, uom: e.target.value }))} />
          </label>
          <label>
            <span>Type</span>
            <input className="qc-input" value={line.parameter_type} onChange={(e) => setLine((s) => ({ ...s, parameter_type: e.target.value }))} />
          </label>
          <label>
            <span>Rule</span>
            <select
              className="qc-select"
              value={line.rule_name}
              onChange={(e) => {
                const nextRule = normalizeRuleValue(e.target.value);
                setLine((s) => ({
                  ...s,
                  rule_name: nextRule,
                  to_value: nextRule === 'IR' ? s.to_value : '',
                }));
              }}
            >
              <option value="">Select Rule</option>
              {RULE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>From</span>
            <input className="qc-input" value={line.from_value} onChange={(e) => setLine((s) => ({ ...s, from_value: e.target.value }))} />
          </label>
          <label>
            <span>To</span>
            <input
              className="qc-input"
              value={line.to_value}
              disabled={normalizeRuleValue(line.rule_name) !== 'IR'}
              onChange={(e) => setLine((s) => ({ ...s, to_value: e.target.value }))}
            />
          </label>
          <label>
            <span>Expected Value</span>
            <input className="qc-input" value={line.expected_value} onChange={(e) => setLine((s) => ({ ...s, expected_value: e.target.value }))} />
          </label>
          <label className="qc-workspace__checkbox qc-workspace__checkbox--inline">
            <input type="checkbox" checked={line.is_optional} onChange={(e) => setLine((s) => ({ ...s, is_optional: e.target.checked }))} />
            Optional
          </label>
          <div className="qc-actions qc-workspace__transaction-actions">
            <button type="button" className="qc-btn qc-btn--primary" disabled={loading} onClick={save}>{editingId ? 'Update Line' : 'Add Line'}</button>
            <button type="button" className="qc-btn" disabled={loading} onClick={resetLine}>Clear Line</button>
          </div>
        </div>
        </div>
      </div>

      <div className="qc-grid qc-workspace__block qc-itemmap-page__table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Parameter Code</th>
              <th>Parameter Name</th>
              <th>Item Name</th>
              <th>Instrument Code</th>
              <th>Instrument Name</th>
              <th>UOM</th>
              <th>Type</th>
              <th>Rule</th>
              <th>From</th>
              <th>To</th>
              <th>Expected</th>
              <th>Optional</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? visibleRows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.parameter_code}</td>
                <td>{row.parameter_name || ''}</td>
                <td>{row.item_name || ''}</td>
                <td>{row.instrument_code || ''}</td>
                <td>{row.instrument_name || ''}</td>
                <td>{row.uom || ''}</td>
                <td>{row.parameter_type || ''}</td>
                <td>{row.rule_name || ''}</td>
                <td>{row.from_value || ''}</td>
                <td>{row.to_value || ''}</td>
                <td>{row.expected_value || ''}</td>
                <td>{toBool(row.is_optional) ? 'Y' : 'N'}</td>
                <td>{toBool(row.is_active) ? 'Y' : 'N'}</td>
                <td>
                  <div className="qc-actions">
                    <button type="button" className="qc-btn" onClick={() => editRow(row)} disabled={loading}>Edit</button>
                    <button type="button" className="qc-btn qc-btn--danger" onClick={() => removeRow(row.id)} disabled={loading}>Delete</button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={15} className="qc-empty">No parameter mappings found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showInstrumentPopup ? (
        <div className="qc-popup-backdrop" role="presentation" onClick={() => setShowInstrumentPopup(false)}>
          <div className="qc-popup" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="qc-workspace__section-head">Add Instrument Master</div>
            <div className="qc-popup__body">
              <label>
                <span>Instrument Code</span>
                <input
                  className="qc-input"
                  value={instrumentDraft.instrument_code}
                  onChange={(e) => setInstrumentDraft((s) => ({ ...s, instrument_code: e.target.value }))}
                />
              </label>
              <label>
                <span>Instrument Name</span>
                <input
                  className="qc-input"
                  value={instrumentDraft.instrument_name}
                  onChange={(e) => setInstrumentDraft((s) => ({ ...s, instrument_name: e.target.value }))}
                />
              </label>
              <label>
                <span>Remarks</span>
                <textarea
                  className="qc-input qc-workspace__textarea"
                  value={instrumentDraft.remarks}
                  onChange={(e) => setInstrumentDraft((s) => ({ ...s, remarks: e.target.value }))}
                />
              </label>
              <label className="qc-workspace__checkbox">
                <input
                  type="checkbox"
                  checked={instrumentDraft.is_active}
                  onChange={(e) => setInstrumentDraft((s) => ({ ...s, is_active: e.target.checked }))}
                />
                Active
              </label>
              <div className="qc-actions">
                <button type="button" className="qc-btn qc-btn--primary" onClick={saveInstrumentFromPopup} disabled={savingInstrument}>
                  Save Instrument
                </button>
                <button
                  type="button"
                  className="qc-btn"
                  onClick={() => {
                    setShowInstrumentPopup(false);
                    setInstrumentDraft(INSTRUMENT_DEFAULT);
                  }}
                  disabled={savingInstrument}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
