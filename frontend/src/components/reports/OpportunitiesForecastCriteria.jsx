import SapInput from '../common/SapInput';
import React, { useMemo, useState } from 'react';
import { matchesSapSearchText } from '../../utils/sapSearch';

export const OPPORTUNITIES_FORECAST_GROUP_BY_OPTIONS = [
  { value: '', label: '' },
  { value: 'CardCode', label: 'Business Partner' },
  { value: 'Territory', label: 'Territories' },
  { value: 'MainSalesEmp', label: 'Main Sales Emp.' },
  { value: 'LastSalesEmp', label: 'Last Sales Emp.' },
  { value: 'LastStage', label: 'Stages' },
  { value: 'Industry', label: 'Industry' },
  { value: 'ChannelCode', label: 'BP Channel Code' },
  { value: 'InterestLevel', label: 'Level of Interest' },
  { value: 'SourceName', label: 'Sources' },
  { value: 'PartnerName', label: 'Partners' },
  { value: 'CompetitorName', label: 'Competitors' },
  { value: 'ProjectCode', label: 'Project' },
];

export const OPPORTUNITIES_FORECAST_FILTER_ROWS = [
  [
    { key: 'businessPartner', label: 'Business Partner', type: 'bp' },
    { key: 'documents', label: 'Documents', type: 'select' },
  ],
  [
    { key: 'territories', label: 'Territories', type: 'select' },
    { key: 'amount', label: 'Amount', type: 'amountRange' },
  ],
  [
    { key: 'mainSalesEmp', label: 'Main Sales Emp.', type: 'salesEmp' },
    { key: 'percentageRate', label: 'Percentage Rate', type: 'numberRange' },
  ],
  [
    { key: 'lastSalesEmp', label: 'Last Sales Emp.', type: 'salesEmp' },
    { key: 'sources', label: 'Sources', type: 'select' },
  ],
  [
    { key: 'stages', label: 'Stages', type: 'select' },
    { key: 'partners', label: 'Partners', type: 'select' },
  ],
  [
    { key: 'dates', label: 'Dates', type: 'dateRange' },
    { key: 'competitors', label: 'Competitors', type: 'select' },
  ],
  [
    { key: 'industry', label: 'Industry', type: 'select' },
    null,
  ],
  [
    { key: 'channelCode', label: 'BP Channel Code', type: 'select' },
    { key: 'project', label: 'Project', type: 'select' },
  ],
  [
    { key: 'interestLevel', label: 'Level of Interest', type: 'select' },
    { key: 'userDefinedFields', label: 'User-Defined Fields', type: 'text' },
  ],
];

const EMPTY_LOOKUPS = {
  bpGroups: [],
  territories: [],
  documents: [],
  sources: [],
  partners: [],
  competitors: [],
  stages: [],
  industries: [],
  channelCodes: [],
  interestLevels: [],
  projects: [],
  statuses: [],
};

const lookupKeyByFilter = {
  territories: 'territories',
  documents: 'documents',
  sources: 'sources',
  partners: 'partners',
  competitors: 'competitors',
  stages: 'stages',
  industry: 'industries',
  channelCode: 'channelCodes',
  interestLevel: 'interestLevels',
  project: 'projects',
  status: 'statuses',
};

const getOptionLabel = (option) => {
  if (typeof option === 'string') return option;
  return option?.label || option?.name || option?.description || option?.value || option?.code || '';
};

const getOptionValue = (option) => {
  if (typeof option === 'string') return option;
  return option?.value ?? option?.code ?? option?.id ?? getOptionLabel(option);
};

function SelectionLookupModal({ title, rows, onClose, onApply }) {
  const [searchText, setSearchText] = useState('');
  const [selectedValue, setSelectedValue] = useState('');
  const normalizedRows = useMemo(
    () =>
      (rows || [])
        .map((row, index) => ({
          rowNo: index + 1,
          code: String(getOptionValue(row) || '').trim(),
          name: String(getOptionLabel(row) || '').trim(),
          description: String(row?.description || row?.remarks || '').trim(),
          raw: row,
        }))
        .filter((row) => {
          const needle = searchText.trim();
          if (!needle) return true;
          return [row.code, row.name, row.description].some((value) => matchesSapSearchText(value, needle));
        }),
    [rows, searchText],
  );
  const selectedRow = normalizedRows.find((row) => row.code === selectedValue) || null;

  return (
    <div className="opp-lookup-modal__backdrop" onClick={onClose}>
      <div className="opp-lookup-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="opp-lookup-modal__titlebar">
          <span>{title}</span>
          <button type="button" aria-label="Close" onClick={onClose}>x</button>
        </div>
        <div className="opp-lookup-modal__accent" />
        <div className="opp-lookup-modal__body">
          <div className="opp-lookup-modal__toolbar">
            <label htmlFor="opp-lookup-search">Find</label>
            <input
              id="opp-lookup-search"
              className="sap-report-input"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              autoFocus
            />
          </div>
          <div className="opp-lookup-modal__grid-wrap">
            <table className="opp-lookup-modal__grid sap-report-grid">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Key</th>
                  <th>Name</th>
                  <th>Choose</th>
                </tr>
              </thead>
              <tbody>
                {!normalizedRows.length ? (
                  <tr>
                    <td colSpan="4" className="opp-lookup-modal__empty">No records found.</td>
                  </tr>
                ) : (
                  normalizedRows.map((row) => (
                    <tr
                      key={`${row.code || row.name}-${row.rowNo}`}
                      className={selectedValue === row.code ? 'is-selected' : ''}
                      onClick={() => setSelectedValue(row.code)}
                      onDoubleClick={() => onApply(row.raw)}
                    >
                      <td>{row.rowNo}</td>
                      <td>{row.code}</td>
                      <td>{row.name}</td>
                      <td className="opp-lookup-modal__choose-cell">
                        <input
                          type="checkbox"
                          checked={selectedValue === row.code}
                          onChange={() => setSelectedValue(row.code)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="opp-lookup-modal__footer">
          <button type="button" className="sales-analysis__sap-btn sap-report-btn sap-report-btn--primary" disabled={!selectedRow} onClick={() => onApply(selectedRow.raw)}>
            OK
          </button>
          <button type="button" className="sales-analysis__sap-btn sap-report-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sales-analysis__sap-btn sap-report-btn"
            disabled={!normalizedRows.length}
            onClick={() => setSelectedValue(normalizedRows[0]?.code || '')}
          >
            Select All
          </button>
          <button type="button" className="sales-analysis__sap-btn sap-report-btn" onClick={() => setSelectedValue('')}>
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
}

function BusinessPartnerCriteriaModal({ value, bpGroups = [], onClose, onApply }) {
  const [localValue, setLocalValue] = useState(() => ({
    codeFrom: value?.codeFrom || '',
    codeTo: value?.codeTo || '',
    bpType: value?.bpType || 'All',
    customerGroup: value?.customerGroup || value?.group || 'All',
    vendorGroup: value?.vendorGroup || 'All',
    propertyMode: value?.propertyMode || 'Ignore',
  }));

  const setField = (field, fieldValue) => setLocalValue((current) => ({ ...current, [field]: fieldValue }));
  const groupOptions = [{ value: 'All', label: 'All' }, ...(bpGroups || [])];

  return (
    <div className="opp-lookup-modal__backdrop" onClick={onClose}>
      <div className="opp-bp-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="opp-lookup-modal__titlebar">
          <span>Business Partner</span>
          <button type="button" aria-label="Close" onClick={onClose}>x</button>
        </div>
        <div className="opp-lookup-modal__accent" />
        <div className="opp-bp-modal__body">
          <div className="opp-bp-modal__row">
            <label>Code</label>
            <span>From</span>
            <input className="sap-report-input" value={localValue.codeFrom} onChange={(event) => setField('codeFrom', event.target.value)} autoFocus />
            <span>To</span>
            <input className="sap-report-input" value={localValue.codeTo} onChange={(event) => setField('codeTo', event.target.value)} />
          </div>
          <div className="opp-bp-modal__row opp-bp-modal__row--select">
            <label>Business Partner Type</label>
            <select className="sap-report-input" value={localValue.bpType} onChange={(event) => setField('bpType', event.target.value)}>
              <option value="All">All</option>
              <option value="Customer">Customer</option>
              <option value="Vendor">Vendor</option>
              <option value="Lead">Lead</option>
            </select>
          </div>
          <div className="opp-bp-modal__row opp-bp-modal__row--select">
            <label>Customer Group</label>
            <select className="sap-report-input" value={localValue.customerGroup} onChange={(event) => setField('customerGroup', event.target.value)}>
              {groupOptions.map((group) => (
                <option key={`customer-${getOptionValue(group) || getOptionLabel(group)}`} value={getOptionLabel(group)}>{getOptionLabel(group)}</option>
              ))}
            </select>
          </div>
          <div className="opp-bp-modal__row opp-bp-modal__row--select">
            <label>Vendor Group</label>
            <select className="sap-report-input" value={localValue.vendorGroup} onChange={(event) => setField('vendorGroup', event.target.value)}>
              {groupOptions.map((group) => (
                <option key={`vendor-${getOptionValue(group) || getOptionLabel(group)}`} value={getOptionLabel(group)}>{getOptionLabel(group)}</option>
              ))}
            </select>
          </div>
          <div className="opp-bp-modal__properties">
            <button type="button" className="sales-analysis__sap-btn sap-report-btn">Properties</button>
            <input className="sap-report-input" value={localValue.propertyMode} readOnly />
          </div>
        </div>
        <div className="opp-bp-modal__footer">
          <button
            type="button"
            className="sales-analysis__sap-btn sap-report-btn sap-report-btn--primary"
            onClick={() => onApply({
              ...localValue,
              group: localValue.customerGroup && localValue.customerGroup !== 'All' ? localValue.customerGroup : '',
            })}
          >
            OK
          </button>
          <button type="button" className="sales-analysis__sap-btn sap-report-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sales-analysis__sap-btn sap-report-btn"
            onClick={() => setLocalValue((current) => ({ ...current, codeFrom: '', codeTo: '', customerGroup: 'All', vendorGroup: 'All' }))}
          >
            Select All
          </button>
        </div>
      </div>
    </div>
  );
}

function RangeCriteriaModal({ title, type, value, onClose, onApply }) {
  const [localValue, setLocalValue] = useState(() => ({
    from: value?.from || '',
    to: value?.to || '',
  }));
  const inputType = type === 'dateRange' ? 'date' : 'number';

  return (
    <div className="opp-lookup-modal__backdrop" onClick={onClose}>
      <div className="opp-range-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="opp-lookup-modal__titlebar">
          <span>{title}</span>
          <button type="button" aria-label="Close" onClick={onClose}>x</button>
        </div>
        <div className="opp-lookup-modal__accent" />
        <div className="opp-range-modal__body">
          <label>From</label>
          <SapInput className="sap-report-input" type={inputType} value={localValue.from} onChange={(event) => setLocalValue((current) => ({ ...current, from: event.target.value }))} autoFocus />
          <label>To</label>
          <SapInput className="sap-report-input" type={inputType} value={localValue.to} onChange={(event) => setLocalValue((current) => ({ ...current, to: event.target.value }))} />
        </div>
        <div className="opp-lookup-modal__footer">
          <button type="button" className="sales-analysis__sap-btn sap-report-btn sap-report-btn--primary" onClick={() => onApply(localValue)}>OK</button>
          <button type="button" className="sales-analysis__sap-btn sap-report-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function CriteriaRow({ config, value, lookups, onChange, onOpenExternalLookup }) {
  const [showLookup, setShowLookup] = useState(false);
  const [showBpModal, setShowBpModal] = useState(false);
  const [showRangeModal, setShowRangeModal] = useState(false);
  if (!config) return <div className="opp-criteria-line opp-criteria-line--blank" />;

  const enabled = Boolean(value?.enabled);
  const lookupKey = lookupKeyByFilter[config.key];
  const options = lookups[lookupKey] || [];

  const toggleEnabled = (checked) => onChange(`${config.key}.enabled`, checked);
  const setField = (field, fieldValue) => onChange(`${config.key}.${field}`, fieldValue);
  const openLookup = () => {
    toggleEnabled(true);
    if (config.type === 'bp') {
      setShowBpModal(true);
      return;
    }
    if (config.type === 'salesEmp') {
      onOpenExternalLookup(config.key);
      return;
    }
    if (['amountRange', 'numberRange', 'dateRange'].includes(config.type)) {
      setShowRangeModal(true);
      return;
    }
    setShowLookup(true);
  };
  const selectGeneric = (option) => {
    setField('value', getOptionValue(option));
    setField('label', getOptionLabel(option));
    setShowLookup(false);
  };
  const applyBusinessPartner = (nextValue) => {
    Object.entries(nextValue).forEach(([field, fieldValue]) => setField(field, fieldValue));
    setShowBpModal(false);
  };
  const applyRange = (nextValue) => {
    setField('from', nextValue.from || '');
    setField('to', nextValue.to || '');
    setShowRangeModal(false);
  };

  return (
    <div className={`opp-criteria-line${enabled ? ' is-enabled' : ''}`}>
      <label className="opp-criteria-line__check">
        <input type="checkbox" checked={enabled} onChange={(event) => toggleEnabled(event.target.checked)} />
        <span>{config.label}</span>
      </label>
      <button type="button" className="opp-criteria-line__lookup" onClick={openLookup} title={`Select ${config.label}`}>
        ...
      </button>

      {showLookup ? (
        <SelectionLookupModal
          title={config.label}
          rows={options}
          onClose={() => setShowLookup(false)}
          onApply={selectGeneric}
        />
      ) : null}
      {showBpModal ? (
        <BusinessPartnerCriteriaModal
          value={value}
          bpGroups={lookups.bpGroups}
          onClose={() => setShowBpModal(false)}
          onApply={applyBusinessPartner}
        />
      ) : null}
      {showRangeModal ? (
        <RangeCriteriaModal
          title={config.label}
          type={config.type}
          value={value}
          onClose={() => setShowRangeModal(false)}
          onApply={applyRange}
        />
      ) : null}
    </div>
  );
}

export default function OpportunitiesForecastCriteria({
  criteria,
  lookups = EMPTY_LOOKUPS,
  onChange,
  onOpenExternalLookup,
  onSubmit,
  onClear,
  onClose,
  loading,
  filterRows = OPPORTUNITIES_FORECAST_FILTER_ROWS,
  groupByOptions = OPPORTUNITIES_FORECAST_GROUP_BY_OPTIONS,
  groupBy2Options = groupByOptions,
  showGroupBy = true,
  showGroupBy2 = true,
  groupBy2Label = 'Group By (2):',
  extraGroupControls = null,
}) {
  return (
    <>
      <div className="opp-sap-selection-box">
        <div className="opp-sap-selection-grid">
          {filterRows.flatMap((pair) =>
            pair.map((config, index) => (
              <CriteriaRow
                key={`${pair[0]?.key || 'blank'}-${index}-${config?.key || 'blank'}`}
                config={config}
                value={config ? criteria?.filters?.[config.key] : null}
                lookups={lookups}
                onChange={(path, value) => onChange(`filters.${path}`, value)}
                onOpenExternalLookup={onOpenExternalLookup}
              />
            )),
          )}
        </div>
      </div>

      {showGroupBy ? (
        <div className={`opp-groupby-form${extraGroupControls ? ' opp-groupby-form--with-extra' : ''}`}>
          <label htmlFor="opp-group-by">Group By:</label>
          <select
            id="opp-group-by"
            className="sap-report-input"
            value={criteria?.groupBy || ''}
            onChange={(event) => onChange('groupBy', event.target.value)}
          >
            {groupByOptions.map((option) => (
              <option key={option.value || 'none'} value={option.value}>{option.label}</option>
            ))}
          </select>

          {extraGroupControls}

          {showGroupBy2 ? (
            <>
              <label htmlFor="opp-group-by-2">{groupBy2Label}</label>
              <select
                id="opp-group-by-2"
                className="sap-report-input"
                value={criteria?.groupBy2 || ''}
                onChange={(event) => onChange('groupBy2', event.target.value)}
              >
                {groupBy2Options.map((option) => (
                  <option key={option.value || 'none-2'} value={option.value}>{option.label}</option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="opp-window-footer">
        <button type="button" className="sales-analysis__sap-btn sap-report-btn sap-report-btn--primary" disabled={loading} onClick={onSubmit}>
          {loading ? 'Loading...' : 'OK'}
        </button>
        <button type="button" className="sales-analysis__sap-btn sap-report-btn" onClick={onClear}>
          Clear
        </button>
        <button type="button" className="sales-analysis__sap-btn sap-report-btn" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
