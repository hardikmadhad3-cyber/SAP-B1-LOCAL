import React from 'react';
import {
  getMatrixColumnSetting,
  getOrderedVisibleMatrixColumns,
  isMatrixColumnVisible,
  isRequiredVisibleMatrixField,
  mergeContentSettingsFields,
} from '../../utils/formSettingsColumns';

const tokens = (field = {}) => [
  field.key, field.valueKey, field.rendererKey, field.fieldName, field.sapField, field.aliasId,
].map((value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);

export const filterDuplicateRowUdfFields = (matrixFields = [], rowUdfFields = []) => {
  const known = new Set((matrixFields || []).flatMap(tokens));
  return (rowUdfFields || []).filter((field) => !tokens(field).some((token) => known.has(token)));
};

export default function FormSettingsPanel(props) {
  const {
    isOpen, onClose, matrixFields = [], rowUdfFields = [], headerUdfFields = [],
    showHeaderUdfSettings = false, formSettings = {},
    onSettingChange, onColumnOrderChange, isRefreshing = false, settingsLoaded = true,
    isSaving = false, hasUnsavedChanges = false, saveError = '', onSave, onCancel,
    settingsScopeLabel = '', variant = 'floating', className = '', style, showClose = true,
  } = props;
  const [draggedKey, setDraggedKey] = React.useState('');
  const fields = React.useMemo(
    () => mergeContentSettingsFields(matrixFields, rowUdfFields),
    [matrixFields, rowUdfFields],
  );
  const ordered = React.useMemo(
    () => getOrderedVisibleMatrixColumns(fields, formSettings, { includeHidden: true }),
    [fields, formSettings],
  );
  if (!isOpen) return null;
  const loading = isRefreshing || !settingsLoaded;
  const close = () => { onCancel?.(); onClose?.(); };
  const publish = (next) => {
    if (onColumnOrderChange) return onColumnOrderChange(next);
    next.forEach((field, index) => onSettingChange?.(
      field.settingsGroup || 'matrixColumns', field.key, 'order', index + 1,
    ));
    return undefined;
  };
  const move = (key, target) => {
    const source = ordered.findIndex((field) => field.key === key);
    const destination = Math.max(0, Math.min(target, ordered.length - 1));
    if (source < 0 || source === destination) return;
    const next = [...ordered];
    const [field] = next.splice(source, 1);
    next.splice(destination, 0, field);
    publish(next);
  };
  const sidebar = variant === 'sidebar';
  const wrapperStyle = sidebar
    ? { width: '100%', height: '100%', minWidth: 0, overflow: 'hidden', ...style }
    : { position: 'fixed', top: 172, right: 12, width: 400,
        height: 'calc(100vh - 184px)', zIndex: 1050, overflowY: 'auto', ...style };
  return (
    <div data-document-display-preferences="true"
      className={(sidebar ? 'sap-header-udf-panel ' : 'po-form-settings-floating ') + className} style={wrapperStyle}>
      <div className="card p-3 po-udf-sidebar-card h-100">
        <div className="po-udf-sidebar-header">
          <div>
            <h6 className="mb-1">Form Settings</h6>
            <small className="text-muted">
              {loading ? 'Loading company Form Settings...' : `${showHeaderUdfSettings ? 'Fields' : 'Content Columns'} for ${settingsScopeLabel || 'the selected scope'}`}
            </small>
          </div>
          {showClose ? <button type="button" onClick={close} aria-label="Close Form Settings"
            title="Close and discard unsaved changes" className="po-udf-sidebar-close" /> : null}
        </div>
        <div className="po-udf-sidebar-body overflow-auto" aria-busy={loading}>
          {loading ? <div className="small text-muted py-3">Loading saved Content-column settings...</div> : (
            <>
              <h6 className="border-bottom pb-2 mb-1">Content Columns</h6>
              <div className="small text-muted mb-2">Drag fields to arrange the Content tab.</div>
              {!ordered.length && <div className="small text-muted py-3">No configurable columns are available.</div>}
              {ordered.map((field, index) => {
                const setting = getMatrixColumnSetting(field, formSettings);
                const locked = isRequiredVisibleMatrixField(field, setting);
                const visible = isMatrixColumnVisible(field, setting);
                const label = field.label || field.columnTitle || field.caption || field.key;
                const group = field.settingsGroup || 'matrixColumns';
                const inputId = `form-setting-visible-${group}-${field.key}`;
                return (
                  <div key={`${group}:${field.key}`} draggable
                    className={`d-flex align-items-center gap-2 border rounded px-2 py-2 mb-2 ${draggedKey === field.key ? 'opacity-50' : ''}`}
                    onDragStart={(event) => {
                      setDraggedKey(field.key);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', field.key);
                    }}
                    onDragEnd={() => setDraggedKey('')}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      move(event.dataTransfer.getData('text/plain') || draggedKey, index);
                      setDraggedKey('');
                    }}>
                    <span title="Drag to reorder" style={{ cursor: 'grab', color: '#5b6572' }} aria-hidden="true">&#8942;&#8942;</span>
                    <span className="small flex-grow-1 text-truncate" title={label}>
                      {label}{locked && <span className="ms-1 text-muted" title="Required field is always visible">&#128274;</span>}
                    </span>
                    <button type="button" className="btn btn-outline-secondary btn-sm py-0 px-1"
                      aria-label={`Move ${label} up`} disabled={locked || index === 0}
                      onClick={() => move(field.key, index - 1)}>&#8593;</button>
                    <button type="button" className="btn btn-outline-secondary btn-sm py-0 px-1"
                      aria-label={`Move ${label} down`} disabled={locked || index === ordered.length - 1}
                      onClick={() => move(field.key, index + 1)}>&#8595;</button>
                    <div className="form-check mb-0">
                      <input id={inputId} type="checkbox" className="form-check-input"
                        checked={visible} disabled={locked}
                        onChange={(event) => onSettingChange?.(group, field.key, 'visible', event.target.checked)} />
                      <label className="form-check-label small" htmlFor={inputId}>Visible</label>
                    </div>
                  </div>
                );
              })}

              {showHeaderUdfSettings && headerUdfFields.length > 0 && (
                <>
                  <h6 className="border-bottom pb-2 mt-3 mb-2">Header User-Defined Fields</h6>
                  {headerUdfFields.map((field) => {
                    const setting = formSettings.headerUdfs?.[field.key] || {};
                    const inputId = `form-setting-visible-headerUdfs-${field.key}`;
                    return (
                      <div key={field.key} className="d-flex align-items-center gap-2 border rounded px-2 py-2 mb-2">
                        <span className="small flex-grow-1 text-truncate" title={field.label || field.key}>
                          {field.label || field.key}
                        </span>
                        <div className="form-check mb-0">
                          <input id={inputId} type="checkbox" className="form-check-input"
                            checked={setting.visible !== undefined ? setting.visible !== false : field.visible !== false}
                            onChange={(event) => onSettingChange?.('headerUdfs', field.key, 'visible', event.target.checked)} />
                          <label className="form-check-label small" htmlFor={inputId}>Visible</label>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
        {typeof onSave === 'function' && (
          <div className="border-top pt-3 mt-2">
            {saveError ? <div className="small text-danger mb-2" role="alert">{saveError}</div> : (
              <div className="small text-muted mb-2" aria-live="polite">
                {isSaving ? 'Saving for this user and company...' : hasUnsavedChanges
                  ? 'Field visibility or order has unsaved changes.'
                  : 'Form settings are saved.'}
              </div>
            )}
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-outline-secondary btn-sm flex-grow-1"
                onClick={close} disabled={isSaving}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm flex-grow-1"
                onClick={onSave} disabled={loading || isSaving || !hasUnsavedChanges}>
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
