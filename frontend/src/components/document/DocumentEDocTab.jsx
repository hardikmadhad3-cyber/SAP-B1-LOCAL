import React from 'react';
import { DocField, DocTabColumn, DocTabColumns, DocTabPanel } from './DocumentTabLayout';

// SAP B1 (India) Electronic Documents tab: E-Way Bill on the left, Generic
// eDoc Protocol on the right. Purchase documents receive eDocs, so their
// generic block shows the imported total / date received instead of a
// generation type. Pages that pass no `onHeaderChange` get a read-only tab.
export const EDOC_GENERATION_TYPES = [
  { value: 'edocGenerate', label: 'Generate' },
  { value: 'edocGenerateLater', label: 'Generate - Later' },
  { value: 'edocNotRelevant', label: 'Not Relevant' },
  { value: 'edocGenerateOffline', label: 'Generate Offline' },
];

const DEFAULT_NAMES = {
  generationType: 'edocGenerationType',
  format: 'edocExportFormat',
  status: 'edocStatus',
  genericGenerationType: 'genericEdocGenerationType',
  genericFormat: 'genericEdocExportFormat',
  genericStatus: 'genericEdocStatus',
  totalImported: 'totalImportedDocument',
  dateReceived: 'dateReceived',
};

const formatOptions = (formats = [], selected = '') => {
  const options = (Array.isArray(formats) ? formats : []).map((format) => ({
    value: String(format.AbsEntry ?? format.value ?? format),
    label: format.Name || format.Descr || format.label || String(format.AbsEntry ?? format),
  }));
  const saved = String(selected ?? '');
  if (saved && !options.some((option) => option.value === saved)) options.unshift({ value: saved, label: saved });
  return options;
};

const statusText = (status, generationType) => status || (generationType === 'edocNotRelevant' ? 'Not Relevant' : 'Waiting');

export default function DocumentEDocTab({
  variant = 'sales',
  header = {},
  onHeaderChange,
  formats = [],
  genericFormats = [],
  onOpenEWayBill,
  isEditable = true,
  names: nameOverrides = {},
}) {
  const names = { ...DEFAULT_NAMES, ...nameOverrides };
  const disabled = !isEditable || typeof onHeaderChange !== 'function';
  const value = (key) => header[names[key]] ?? '';
  const select = (key, options) => (id) => (
    <select id={id} name={names[key]} value={value(key)} onChange={onHeaderChange} disabled={disabled}>
      <option value="">Select</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
  const readOnly = (text) => (id) => <input id={id} value={text} readOnly />;
  const isPurchase = variant === 'purchase';

  return (
    <DocTabPanel className="sap-doc-tab--edoc">
      <DocTabColumns>
        <DocTabColumn>
          <div className="sap-doc-tab__section-title">E-Way Bill</div>
          <DocField label="eDoc Generation Type">{select('generationType', EDOC_GENERATION_TYPES)}</DocField>
          <DocField label="eDoc Format">{select('format', formatOptions(formats, value('format')))}</DocField>
          <DocField label="Documents Mapping Determination">{readOnly('Double-click to open')}</DocField>
          <DocField label="Document Status">{readOnly(statusText(value('status'), value('generationType')))}</DocField>
          <DocField label="E-Way Bill Details">
            <button
              type="button"
              className="sap-doc-field__lookup-btn"
              onClick={onOpenEWayBill}
              disabled={!onOpenEWayBill}
              aria-label={isEditable ? 'Open E-Way Bill Details' : 'View E-Way Bill Details read-only'}
            >
              ...
            </button>
          </DocField>
        </DocTabColumn>

        <DocTabColumn>
          <div className="sap-doc-tab__section-title">Generic eDoc Protocol</div>
          {!isPurchase ? (
            <DocField label="eDoc Generation Type">{select('genericGenerationType', EDOC_GENERATION_TYPES)}</DocField>
          ) : null}
          <DocField label="eDoc Format">{select('genericFormat', formatOptions(genericFormats, value('genericFormat')))}</DocField>
          {!isPurchase ? <DocField label="Documents Mapping Determination">{readOnly('Double-click to open')}</DocField> : null}
          <DocField label="Document Status">{readOnly(statusText(value('genericStatus'), value('genericGenerationType')))}</DocField>
          {isPurchase ? (
            <>
              <DocField label="Total of Imported Document">{readOnly(value('totalImported') || '0.00')}</DocField>
              <DocField label="Date Received">{readOnly(value('dateReceived'))}</DocField>
            </>
          ) : null}
        </DocTabColumn>
      </DocTabColumns>
    </DocTabPanel>
  );
}
