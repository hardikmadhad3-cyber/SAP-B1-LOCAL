import React, { useEffect, useMemo, useState } from 'react';
import { matchesSapSearchText } from '../../utils/sapSearch';
import SapModalShell from '../common/SapModalShell';
import { consumePendingLookupQuery } from '../../utils/sapTabNavigation';

export default function LineValueLookupModal({
  isOpen,
  onClose,
  onSelect,
  onCreate,
  options = [],
  title = 'List of User-Defined Values',
  searchPlaceholder = 'Search values',
  emptyMessage = 'No values found',
  allowCreate = true,
  columns = null,
  createValueLabel = 'Value',
  createDescriptionLabel = 'Description',
  portalTarget,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newValue, setNewValue] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;

    return options.filter((option) => {
      const searchableValues = [
        option?.value,
        option?.description,
        option?.label,
        ...Object.values(option || {}),
      ];
      return searchableValues.some((item) => matchesSapSearchText(item, searchQuery));
    });
  }, [options, searchQuery]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery(consumePendingLookupQuery());
    } else {
      setSearchQuery('');
      setSelectedIndex(-1);
      setShowCreateForm(false);
      setNewValue('');
      setNewDescription('');
      setCreateError('');
      setSaving(false);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [searchQuery, options]);

  const resetModal = () => {
    setSearchQuery('');
    setSelectedIndex(-1);
    setShowCreateForm(false);
    setNewValue('');
    setNewDescription('');
    setCreateError('');
    setSaving(false);
  };

  const closeModal = () => {
    resetModal();
    onClose();
    window.SapB1TabNavigation?.restoreLookup?.();
  };

  const chooseOption = (option) => {
    const selection = onSelect(option);
    resetModal();
    onClose();
    Promise.resolve(selection).finally(() => {
      window.SapB1TabNavigation?.completeLookup?.();
    });
  };

  const handleChoose = () => {
    if (selectedIndex < 0 || !filteredOptions[selectedIndex]) return;
    chooseOption(filteredOptions[selectedIndex]);
  };

  const handleCreate = async () => {
    const normalizedValue = String(newValue || '').trim();
    const normalizedDescription = String(newDescription || normalizedValue).trim();

    if (!normalizedValue) {
      setCreateError('Value is required.');
      return;
    }

    if (!onCreate) return;

    try {
      setSaving(true);
      setCreateError('');
      const createdOption = await onCreate({
        value: normalizedValue,
        description: normalizedDescription,
      });

      if (createdOption) chooseOption(createdOption);
    } catch (error) {
      setCreateError(error?.response?.data?.detail || error?.message || 'Failed to create value.');
    } finally {
      setSaving(false);
    }
  };

  const effectiveColumns = Array.isArray(columns) && columns.length
    ? columns
    : null;

  const showDescriptionColumn = !effectiveColumns && filteredOptions.some(
    (option) => option?.description && option.description !== option.value
  );
  const totalColumns = effectiveColumns ? effectiveColumns.length + 1 : (showDescriptionColumn ? 3 : 2);

  if (!isOpen) return null;

  return (
    <SapModalShell
      open={isOpen}
      title={title}
      onClose={closeModal}
      size="wide"
      width={820}
      bodyClassName="sap-line-value-modal__body"
      loading={saving}
      portalTarget={portalTarget}
      footer={(
        <>
          {allowCreate && showCreateForm ? (
            <>
              <button type="button" onClick={handleCreate} disabled={saving} className="sap-modal-shell__button sap-modal-shell__button--primary">{saving ? 'Saving...' : 'Save'}</button>
              <button type="button" onClick={() => { setShowCreateForm(false); setCreateError(''); setNewValue(''); setNewDescription(''); }} className="sap-modal-shell__button">Cancel New</button>
            </>
          ) : allowCreate ? (
            <button type="button" onClick={() => { setShowCreateForm(true); setCreateError(''); setNewValue(searchQuery.trim()); setNewDescription(searchQuery.trim()); }} className="sap-modal-shell__button sap-modal-shell__button--primary">New</button>
          ) : null}
          <button type="button" onClick={handleChoose} disabled={selectedIndex < 0} className="sap-modal-shell__button sap-modal-shell__button--primary">Choose</button>
          <button type="button" onClick={closeModal} className="sap-modal-shell__button">Cancel</button>
        </>
      )}
    >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sap-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 600, minWidth: 40 }}>Find</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={searchPlaceholder}
              style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid var(--sap-border-strong)', borderRadius: 'var(--sap-radius-xs)' }}
              autoFocus
            />
          </div>
        </div>

        {allowCreate && showCreateForm && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--sap-border)', background: 'var(--sap-surface-soft)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>{createValueLabel}</label>
              <input type="text" value={newValue} onChange={(event) => setNewValue(event.target.value)} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--sap-border-strong)', borderRadius: 'var(--sap-radius-xs)' }} autoFocus />
              <label style={{ fontSize: 12, fontWeight: 600 }}>{createDescriptionLabel}</label>
              <input type="text" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} style={{ padding: '4px 8px', fontSize: 12, border: '1px solid var(--sap-border-strong)', borderRadius: 'var(--sap-radius-xs)' }} />
            </div>
            {createError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--sap-danger)' }}>{createError}</div>}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 8 }}>
            <thead>
              <tr style={{ background: 'var(--sap-toolbar-bg)', borderBottom: '1px solid var(--sap-border)' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, width: 40 }}>#</th>
                {effectiveColumns ? (
                  effectiveColumns.map((column) => (
                    <th
                      key={column.key}
                      style={{
                        padding: '6px 8px',
                        textAlign: column.align || 'left',
                        fontWeight: 600,
                        width: column.width,
                      }}
                    >
                      {column.label}
                    </th>
                  ))
                ) : (
                  <>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Value</th>
                    {showDescriptionColumn && <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, width: '35%' }}>Description</th>}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredOptions.length === 0 ? (
                <tr>
                  <td colSpan={totalColumns} style={{ padding: 20, textAlign: 'center', color: 'var(--sap-text-muted)' }}>{emptyMessage}</td>
                </tr>
              ) : (
                filteredOptions.map((option, index) => (
                  <tr
                    key={`${option.value}-${index}`}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={() => chooseOption(option)}
                    style={{ backgroundColor: selectedIndex === index ? 'var(--sap-primary-soft)' : index % 2 === 0 ? 'var(--sap-surface)' : 'var(--sap-row-even)', cursor: 'pointer', borderBottom: '1px solid var(--sap-border-soft)' }}
                  >
                    <td style={{ padding: '6px 8px', color: 'var(--sap-text-muted)' }}>{index + 1}</td>
                    {effectiveColumns ? (
                      effectiveColumns.map((column) => (
                        <td
                          key={column.key}
                          style={{
                            padding: '6px 8px',
                            fontWeight: column.primary ? 500 : 400,
                            textAlign: column.align || 'left',
                          }}
                        >
                          {option[column.key] ?? ''}
                        </td>
                      ))
                    ) : (
                      <>
                        <td style={{ padding: '6px 8px', fontWeight: 500 }}>{option.value}</td>
                        {showDescriptionColumn && <td style={{ padding: '6px 8px' }}>{option.description || ''}</td>}
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

    </SapModalShell>
  );
}
