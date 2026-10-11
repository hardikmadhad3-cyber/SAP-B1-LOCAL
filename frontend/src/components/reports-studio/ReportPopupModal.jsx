import SapInput from '../common/SapInput';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SapLookupModal from '../common/SapLookupModal';
import { fetchReportParameterLookupOptions } from '../../api/reportStudioApi';

const buildInputType = (paramType) => {
  if (paramType === 'date') return 'date';
  if (paramType === 'number') return 'number';
  return 'text';
};

const INFERRED_LOOKUPS = {
  item: {
    table: 'OITM',
    title: 'List of Items',
    columns: [
      { key: 'ItemCode', label: 'Item Code' },
      { key: 'ItemName', label: 'Item Name' },
    ],
    valueKey: 'ItemCode',
    displayKey: 'ItemName',
  },
  buyer: {
    table: 'OCRD_CUSTOMERS',
    title: 'List of Buyers',
    columns: [
      { key: 'CardName', label: 'BP Name' },
      { key: 'CardCode', label: 'BP Code' },
      { key: 'Balance', label: 'BP Balance' },
      { key: 'CardTypeLabel', label: 'BP Type' },
      { key: 'Active', label: 'Active' },
      { key: 'Inactive', label: 'Inactive' },
      { key: 'BillToBlock', label: 'Bill-to Block' },
      { key: 'BillToBuildingFloorRoom', label: 'Bill-to Building/Floor/Room' },
      { key: 'GTSRegistrationNumber', label: 'GTS Registration Number' },
    ],
    valueKey: 'CardCode',
    displayKey: 'CardName',
    modalWidth: 'min(1280px, calc(100vw - 40px))',
  },
  seller: {
    table: 'OCRD_SUPPLIERS',
    title: 'List of Sellers',
    columns: [
      { key: 'CardName', label: 'BP Name' },
      { key: 'CardCode', label: 'BP Code' },
      { key: 'Balance', label: 'BP Balance' },
      { key: 'CardTypeLabel', label: 'BP Type' },
      { key: 'Active', label: 'Active' },
      { key: 'Inactive', label: 'Inactive' },
      { key: 'BillToBlock', label: 'Bill-to Block' },
      { key: 'BillToBuildingFloorRoom', label: 'Bill-to Building/Floor/Room' },
      { key: 'GTSRegistrationNumber', label: 'GTS Registration Number' },
    ],
    valueKey: 'CardCode',
    displayKey: 'CardName',
    modalWidth: 'min(1280px, calc(100vw - 40px))',
  },
  businessPartner: {
    table: 'OCRD',
    title: 'List of Business Partners',
    columns: [
      { key: 'CardCode', label: 'BP Code' },
      { key: 'CardName', label: 'BP Name' },
      { key: 'Country', label: 'Country' },
      { key: 'CardTypeLabel', label: 'BP Type' },
      { key: 'Balance', label: 'Account Balance' },
      { key: 'Active', label: 'Active' },
      { key: 'VendorTypeId', label: 'Vendor Type ID' },
      { key: 'VendorOccupation', label: 'Vendor Occupation' },
    ],
    valueKey: 'CardCode',
    displayKey: 'CardCode',
    modalWidth: 'min(1280px, calc(100vw - 40px))',
  },
};

const inferParameterLookup = (parameter) => {
  const identity = `${parameter?.displayName || ''} ${parameter?.paramName || ''}`.toLowerCase();
  const lookupTable = String(parameter?.lookup?.table || '').trim().toUpperCase();

  if (identity.includes('seller') || identity.includes('vendor')) {
    return INFERRED_LOOKUPS.seller;
  }

  if (identity.includes('buyer') || identity.includes('customer')) {
    return INFERRED_LOOKUPS.buyer;
  }

  if (identity.includes('item') || identity.includes('product')) {
    return INFERRED_LOOKUPS.item;
  }

  if (
    lookupTable === 'OCRD' ||
    identity.includes('card code') ||
    identity.includes('cardcode') ||
    identity.includes('select * from ocrd')
  ) {
    return INFERRED_LOOKUPS.businessPartner;
  }

  return null;
};

const isEnterTypeParameter = (parameter) => {
  const identity = `${parameter?.displayName || ''} ${parameter?.paramName || ''}`.toLowerCase();
  return identity.includes('enter type') || identity.includes('type');
};

const normalizeOptionValue = (option) => String(
  option && typeof option === 'object'
    ? (option.value ?? option.label ?? '')
    : option,
).trim();

const normalizeOptionLabel = (option) => String(
  option && typeof option === 'object'
    ? (option.label ?? option.value ?? '')
    : option,
).trim();

const normalizeSelectOptions = (parameter) => {
  const sourceOptions = Array.isArray(parameter?.options) ? parameter.options : [];
  const options = sourceOptions
    .map((option) => ({
      value: normalizeOptionValue(option),
      label: normalizeOptionLabel(option),
    }))
    .filter((option) => option.value || option.label);

  if (!isEnterTypeParameter(parameter)) {
    return options;
  }

  const nextOptions = [...options];
  ['Soda', 'Sale'].forEach((label) => {
    const exists = nextOptions.some((option) =>
      String(option.value || option.label).trim().toLowerCase() === label.toLowerCase()
    );

    if (!exists) {
      nextOptions.push({ value: label, label });
    }
  });

  return nextOptions;
};

function ReportPopupModal({
  isOpen,
  report,
  parameters,
  values,
  isRunning,
  errorMessage,
  onChange,
  onClose,
  onRun,
}) {
  const [activeLookupParameter, setActiveLookupParameter] = useState(null);
  const [lookupDisplayValues, setLookupDisplayValues] = useState({});
  const [lookupErrors, setLookupErrors] = useState({});
  const [resolvingLookup, setResolvingLookup] = useState('');
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef(null);
  const modalRef = useRef(null);
  const lookupRequestRef = useRef(0);

  useEffect(() => {
    if (!isOpen) {
      lookupRequestRef.current += 1;
      setActiveLookupParameter(null);
      setLookupDisplayValues({});
      setLookupErrors({});
      setResolvingLookup('');
      setDragOffset({ x: 0, y: 0 });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleMouseMove = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      setDragOffset({
        x: dragState.originX + Math.min(
          Math.max(deltaX, 12 - dragState.rect.left),
          window.innerWidth - 12 - dragState.rect.right,
        ),
        y: dragState.originY + Math.min(
          Math.max(deltaY, 12 - dragState.rect.top),
          window.innerHeight - 12 - dragState.rect.bottom,
        ),
      });
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleLookupClose = () => setActiveLookupParameter(null);
  const openLookup = (parameter, lookup, initialQuery = '') => setActiveLookupParameter({ ...parameter, lookup, initialQuery });
  const selectLookupRow = (parameter, lookup, row) => {
    lookupRequestRef.current += 1;
    setResolvingLookup('');
    const nextValue = row?.[lookup.valueKey] ?? '';
    const nextDisplay = [
      row?.[lookup.valueKey],
      lookup.displayKey !== lookup.valueKey ? row?.[lookup.displayKey] : null,
    ].filter(Boolean).join(' - ');
    onChange(parameter.paramName, nextValue);
    setLookupDisplayValues((current) => ({
      ...current,
      [parameter.paramName]: nextDisplay || String(nextValue || ''),
    }));
    setLookupErrors((current) => ({ ...current, [parameter.paramName]: '' }));
    handleLookupClose();
  };
  const resolveTypedLookup = async (parameter, lookup, input) => {
    const typed = input.value.trim();
    if (!typed) {
      onChange(parameter.paramName, '');
      setLookupErrors((current) => ({ ...current, [parameter.paramName]: '' }));
      return;
    }
    setResolvingLookup(parameter.paramName);
    const requestId = ++lookupRequestRef.current;
    setLookupErrors((current) => ({ ...current, [parameter.paramName]: '' }));
    try {
      const response = await fetchReportParameterLookupOptions(lookup, typed, { top: 101 });
      if (requestId !== lookupRequestRef.current || input.value.trim() !== typed) return;
      const matches = response?.items || [];
      const normalized = typed.toLocaleLowerCase();
      const codeMatch = matches.find((row) => String(row?.[lookup.valueKey] ?? '').trim().toLocaleLowerCase() === normalized);
      const exactNames = matches.filter((row) => String(row?.[lookup.displayKey] ?? '').trim().toLocaleLowerCase() === normalized);
      const choice = codeMatch || (matches.length < 101 && exactNames.length === 1 ? exactNames[0] : null) || (matches.length === 1 ? matches[0] : null);
      if (choice) {
        selectLookupRow(parameter, lookup, choice);
        const nextField = input.closest('.rs-field')?.nextElementSibling?.querySelector('input, select, button');
        (nextField || input.closest('.rs-modal')?.querySelector('.rs-modal__footer button'))?.focus();
      } else if (matches.length) {
        openLookup(parameter, lookup, typed);
      } else {
        setLookupErrors((current) => ({ ...current, [parameter.paramName]: 'No matching records found.' }));
      }
    } catch (_error) {
      if (requestId === lookupRequestRef.current) {
        setLookupErrors((current) => ({ ...current, [parameter.paramName]: 'Could not search records. Try again.' }));
      }
    } finally {
      if (requestId === lookupRequestRef.current) setResolvingLookup('');
    }
  };
  const runWithValidation = () => {
    const missingIndex = parameters.findIndex((parameter) =>
      parameter.isRequired && !String(values[parameter.paramName] ?? '').trim());
    if (missingIndex >= 0) {
      const parameter = parameters[missingIndex];
      const field = modalRef.current?.querySelectorAll('.rs-field')[missingIndex]?.querySelector('input, select');
      const lookup = inferParameterLookup(parameter) || parameter.lookup;
      if (lookup) {
        setLookupErrors((current) => ({
          ...current,
          [parameter.paramName]: `${parameter.displayName} is required.`,
        }));
      }
      field?.focus();
      field?.reportValidity?.();
      return;
    }
    onRun?.();
  };
  const handleDragStart = (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = modalRef.current?.getBoundingClientRect();
    if (!rect) return;

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
      rect,
    };
  };

  const lookupColumns = useMemo(
    () => activeLookupParameter?.lookup?.columns || [],
    [activeLookupParameter],
  );

  const fetchLookupOptions = useCallback(
    async (query, paging) => {
      if (!activeLookupParameter?.lookup) {
        return [];
      }

      const response = await fetchReportParameterLookupOptions(activeLookupParameter.lookup, query, paging);
      return response?.items || [];
    },
    [activeLookupParameter],
  );

  if (!isOpen || !report) {
    return null;
  }

  return (
    <div className="rs-modal__backdrop" role="presentation" onClick={(event) => event.stopPropagation()}>
      <div
        ref={modalRef}
        className="rs-modal rs-modal--criteria"
        role="dialog"
        aria-modal="true"
        aria-label={`${report.reportName} - Selection Criteria`}
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="rs-modal__titlebar rs-modal__titlebar--draggable" onMouseDown={handleDragStart}>
          <span title={`${report.reportName} - Selection Criteria`}>{report.reportName} - Selection Criteria</span>
          <button type="button" className="rs-modal__close" aria-label="Close selection criteria" onClick={onClose}>
            x
          </button>
        </div>

        <div className="rs-modal__body">
          {errorMessage ? <div className="rs-message is-error" role="alert">{errorMessage}</div> : null}
          <div className="rs-modal__summary">
            <div><strong>Code:</strong> {report.reportCode}</div>
            <div><strong>Type:</strong> {report.reportType}</div>
          </div>

          <div className="rs-modal__fields">
            {parameters.length ? (
              parameters.map((parameter, index) => {
                const options = normalizeSelectOptions(parameter);
                const parameterLookup = inferParameterLookup(parameter) || parameter.lookup;
                const hasLookup = Boolean(parameterLookup);
                const isRequired = Boolean(parameter.isRequired);
                const displayValue =
                  lookupDisplayValues[parameter.paramName] ??
                  values[parameter.paramName] ??
                  '';

                return (
                  <label key={parameter.parameterId || `${parameter.paramName}-${index}`} className="rs-field">
                    <span>
                      {parameter.displayName}
                      {isRequired ? ' *' : ''}
                    </span>

                    {hasLookup ? (
                      <>
                      <div className="rs-lookup-field">
                        <input
                          type="text"
                          value={displayValue}
                          required={isRequired}
                          placeholder={`Type or select ${parameter.displayName}`}
                          aria-invalid={Boolean(lookupErrors[parameter.paramName])}
                          onChange={(event) => {
                            lookupRequestRef.current += 1;
                            setResolvingLookup('');
                            setLookupDisplayValues((current) => ({ ...current, [parameter.paramName]: event.target.value }));
                            setLookupErrors((current) => ({ ...current, [parameter.paramName]: '' }));
                            onChange(parameter.paramName, '');
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Tab' && event.currentTarget.value.trim() && !values[parameter.paramName] && !resolvingLookup) {
                              event.preventDefault();
                              resolveTypedLookup(parameter, parameterLookup, event.currentTarget);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="rs-btn rs-btn--lookup"
                          aria-label={`Browse ${parameter.displayName}`}
                          onClick={() => openLookup(parameter, parameterLookup, values[parameter.paramName] ? '' : displayValue)}
                        >
                          ...
                        </button>
                      </div>
                      {lookupErrors[parameter.paramName] ? <small className="rs-lookup-field__error" role="alert">{lookupErrors[parameter.paramName]}</small> : null}
                      </>
                    ) : options.length ? (
                      <select
                        value={values[parameter.paramName] ?? ''}
                        onChange={(event) => onChange(parameter.paramName, event.target.value)}
                        required={isRequired}
                      >
                        <option value="">Select</option>
                        {options.map((option) => (
                          <option key={`${parameter.paramName}-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <SapInput
                        type={buildInputType(parameter.paramType)}
                        title={parameter.paramType === 'date' ? 'Type a day number, then press Tab to use the current month.' : undefined}
                        value={values[parameter.paramName] ?? ''}
                        onChange={(event) => onChange(parameter.paramName, event.target.value)}
                        required={isRequired}
                      />
                    )}
                  </label>
                );
              })
            ) : (
              <div className="rs-panel__empty">This report has no parameters, so it can run directly.</div>
            )}
          </div>
        </div>

        <div className="rs-modal__footer">
          <button type="button" className="rs-btn rs-btn--primary" onClick={runWithValidation} disabled={isRunning}>
            {isRunning ? 'Running...' : 'OK'}
          </button>
          <button type="button" className="rs-btn" onClick={onClose} disabled={isRunning}>
            Cancel
          </button>
        </div>
      </div>

      <SapLookupModal
        open={Boolean(activeLookupParameter?.lookup)}
        title={activeLookupParameter?.lookup?.title || 'Select Value'}
        columns={lookupColumns}
        fetchOptions={fetchLookupOptions}
        pageSize={100}
        initialQuery={activeLookupParameter?.initialQuery || ''}
        searchLabel="Find in all records"
        searchPlaceholder="Search all records by code or name"
        width={activeLookupParameter?.lookup?.modalWidth}
        onClose={handleLookupClose}
        onSelect={(row) => {
          if (!activeLookupParameter?.lookup) {
            return;
          }

          selectLookupRow(activeLookupParameter, activeLookupParameter.lookup, row);
        }}
      />
    </div>
  );
}

export default ReportPopupModal;
