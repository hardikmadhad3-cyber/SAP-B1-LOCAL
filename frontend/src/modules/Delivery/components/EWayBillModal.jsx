import SapInput from '../../../components/common/SapInput';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchHSNCodes } from '../../../api/hsnCodeApi';
import { matchesSapSearchText } from '../../../utils/sapSearch';

const FIELD_ALIASES = {
  ewayBillNo: ['U_EwbNo'],
  ewayBillDate: ['U_EwbDt'],
  expirationDate: ['U_EwbVliDt'],
  subSupplyType: ['U_SubSuply'],
  documentType: ['U_DocType'],
  transactionType: ['U_TraType'],
  transporterCode: ['U_TrfCode'],
  transporterName: ['U_TrfName'],
  transporterId: ['U_TrfId'],
  mode: ['U_TrfMode'],
  vehicleType: ['U_TrfVType'],
  vehicleNo: ['U_TrfVehi', 'U_VEHNO'],
  distanceInKM: ['U_TrfDist'],
  transporterDocNo: ['U_LRNO', 'U_VC_LRNo'],
  transporterDocDate: ['U_LRDT', 'U_LRDate'],
};

const FALLBACK_OPTIONS = {
  subSupplyType: [
    ['1', 'Supply'], ['2', 'Import'], ['3', 'Export'], ['4', 'Job Work'],
    ['5', 'For Own Use'], ['6', 'Job Work Returns'], ['7', 'Sales Return'],
    ['8', 'Others'], ['9', 'SKD/CKD/Lots'], ['10', 'Line Sales'],
    ['11', 'Recipient Not Known'], ['12', 'Exhibition Or Fairs'],
  ],
  documentType: [['INV', 'Tax Invoice'], ['BIL', 'Bill Of Supply'], ['BOE', 'Bill Of Entry'], ['CHL', 'Delivery Challan'], ['OTH', 'Others']],
  transactionType: [['1', 'Regular'], ['2', 'Bill To-Ship To'], ['3', 'Bill From-Ship From'], ['4', 'Combination Of 2 and 3']],
  mode: [['1', 'Road'], ['2', 'Rail'], ['3', 'Air'], ['4', 'Ship']],
  vehicleType: [['R', 'Regular'], ['O', 'ODC']],
};

const token = (value) => String(value || '').trim().toUpperCase().replace(/^U_/, '').replace(/[^A-Z0-9]/g, '');
const EWB_CODE_ALIASES = {
  subSupplyType: {
    SUPPLY: '1',
    IMPORT: '2',
    EXPORT: '3',
    JOBWORK: '4',
    FOROWNUSE: '5',
    JOBWORKRETURNS: '6',
    SALESRETURN: '7',
    OTHERS: '8',
    SKDCKDLOTS: '9',
    LINESALES: '10',
    RECIPIENTNOTKNOWN: '11',
    EXHIBITIONORFAIRS: '12',
  },
  documentType: {
    TAXINVOICE: 'INV',
    INVOICE: 'INV',
    BILLOFSUPPLY: 'BIL',
    BILL: 'BIL',
    BILLOFENTRY: 'BOE',
    DELIVERYCHALLAN: 'CHL',
    CHALLAN: 'CHL',
    OTHERS: 'OTH',
  },
  transactionType: {
    REGULAR: '1',
    BILLTOSHIPTO: '2',
    BILLFROMSHIPFROM: '3',
    COMBINATIONOF2AND3: '4',
    COMBINATION: '4',
  },
  mode: {
    ROAD: '1',
    RAIL: '2',
    AIR: '3',
    SHIP: '4',
  },
  vehicleType: {
    REGULAR: 'R',
    ODC: 'O',
    OVERDIMENSIONALCARGO: 'O',
  },
};

const normalizeOptionCode = (field, value, options = []) => {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const rawToken = token(raw);
  const exact = (options || []).find((option) => token(option.value) === rawToken);
  if (exact) return String(exact.value ?? '').trim();
  const labelMatch = (options || []).find((option) => token(option.label) === rawToken);
  if (labelMatch) return String(labelMatch.value ?? '').trim();
  return EWB_CODE_ALIASES[field]?.[rawToken] || raw;
};

const normalizeDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : text.slice(0, 10);
};

const findDefinition = (definitions, aliases) => {
  const aliasesSet = new Set((aliases || []).map(token));
  return (definitions || []).find((field) => [field.key, field.sapField, field.aliasId].some((value) => aliasesSet.has(token(value))));
};

const readUdfValue = (values, definitions, aliases) => {
  const definition = findDefinition(definitions, aliases);
  const wanted = new Set([definition?.key, ...(aliases || [])].map(token));
  const match = Object.entries(values || {}).find(([key]) => wanted.has(token(key)));
  return match ? match[1] ?? '' : '';
};

export const buildInitialForm = (values, definitions, liveData) => Object.keys(FIELD_ALIASES).reduce((form, field) => {
  const udfValue = readUdfValue(values, definitions, FIELD_ALIASES[field]);
  const savedEWayBillValue = liveData[field];
  // SAP B1 displays the standard document E-Way Bill fields from the
  // document's E-Way Bill table (DLN26 for Delivery).
  // Header UDFs may contain older duplicate values, so use them only when
  // the standard E-Way Bill field has no saved value.
  const effectiveValue = String(savedEWayBillValue ?? '').trim() === '' ? udfValue : savedEWayBillValue;
  form[field] = field.toLowerCase().includes('date') ? normalizeDate(effectiveValue) : String(effectiveValue ?? '');
  return form;
}, {
  supplyType: liveData.supplyType || 'Outward',
  mainHSN: liveData.mainHSN || '',
  mainHSNEntry: liveData.mainHSNEntry || '',
  transporterEntry: liveData.transporterEntry || '',
  billFromName: liveData.billFromName || '',
  billFromGSTIN: liveData.billFromGSTIN || '',
  billFromState: liveData.billFromState || '',
  dispatchFromAddress: liveData.dispatchFromAddress || '',
  dispatchFromPlace: liveData.dispatchFromPlace || '',
  dispatchFromZipCode: liveData.dispatchFromZipCode || '',
  dispatchFromState: liveData.dispatchFromState || '',
  billToName: liveData.billToName || '',
  billToGSTIN: liveData.billToGSTIN || '',
  billToState: liveData.billToState || '',
  shipToAddress: liveData.shipToAddress || '',
  shipToPlace: liveData.shipToPlace || '',
  shipToZipCode: liveData.shipToZipCode || '',
  shipToState: liveData.shipToState || '',
});

function SelectField({ label, name, value, options, onChange, disabled }) {
  return (
    <label className="del-ewb-field">
      <span>{label}</span>
      <select name={name} value={value || ''} onChange={onChange} disabled={disabled}>
        <option value="">Select</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function TextField({ label, name, value, onChange, type = 'text', readOnly = false, onLookup }) {
  return (
    <label className="del-ewb-field">
      <span>{label}</span>
      <span className={onLookup ? 'del-ewb-lookup-input' : ''}>
        <SapInput name={name} type={type} value={value || ''} onChange={onChange} readOnly={readOnly} />
        {onLookup ? <button type="button" onClick={onLookup} title={`Select ${label}`}>...</button> : null}
      </span>
    </label>
  );
}

const getRowValue = (row, keys) => {
  const entries = Object.entries(row || {});
  for (const key of keys) {
    const match = entries.find(([rowKey, value]) => token(rowKey) === token(key) && value != null && String(value).trim() !== '');
    if (match) return match[1];
  }
  return '';
};

function LookupDialog({ title, rows, loading, columns, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const filteredRows = rows.filter((row) => columns.some((column) => matchesSapSearchText(column.value(row), query)));

  return (
    <div className="del-ewb-lookup-overlay" onClick={onClose}>
      <div className="del-ewb-lookup-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="del-modal__header"><strong>{title}</strong><button type="button" className="del-modal__close" onClick={onClose}>×</button></div>
        <div className="del-ewb-lookup-search"><label>Find</label><input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus /></div>
        <div className="del-ewb-lookup-grid">
          {loading ? <div className="del-ewb-lookup-empty">Loading live SAP data...</div> : (
            <table className="del-grid">
              <thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead>
              <tbody>
                {filteredRows.map((row, index) => (
                  <tr
                    key={`${columns[0].value(row)}-${index}`}
                    className={selectedIndex === index ? 'is-selected' : ''}
                    onClick={() => setSelectedIndex(index)}
                    onDoubleClick={() => onSelect(row)}
                  >
                    {columns.map((column) => <td key={column.label}>{column.value(row)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && !filteredRows.length ? <div className="del-ewb-lookup-empty">No matching records found.</div> : null}
        </div>
        <div className="del-modal__footer">
          <button type="button" className="del-btn del-btn--primary" disabled={selectedIndex < 0} onClick={() => onSelect(filteredRows[selectedIndex])}>Choose</button>
          <button type="button" className="del-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function EWayBillModal({
  isOpen,
  onClose,
  onSave,
  udfValues = {},
  udfDefinitions = [],
  liveData = {},
  transporters = [],
  dropdownOptions = {},
  workspaceRef,
  disabled = false,
}) {
  const [form, setForm] = useState(() => buildInitialForm(udfValues, udfDefinitions, liveData));
  const [message, setMessage] = useState('');
  const [lookup, setLookup] = useState(null);
  const [workspaceBounds, setWorkspaceBounds] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setForm(buildInitialForm(udfValues, udfDefinitions, liveData));
    setMessage('');
  }, [isOpen, udfValues, udfDefinitions, liveData]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const updateBounds = () => {
      const rect = workspaceRef?.current?.getBoundingClientRect?.();
      if (!rect) return setWorkspaceBounds(null);
      const topbarBottom = document.querySelector('.topbar')?.getBoundingClientRect?.().bottom || 0;
      const top = Math.max(0, rect.top, topbarBottom);
      setWorkspaceBounds({
        top,
        left: Math.max(0, rect.left),
        right: 'auto',
        bottom: 'auto',
        width: Math.max(320, window.innerWidth - Math.max(0, rect.left)),
        height: Math.max(240, window.innerHeight - top),
      });
    };
    updateBounds();
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds, true);
    return () => {
      window.removeEventListener('resize', updateBounds);
      window.removeEventListener('scroll', updateBounds, true);
    };
  }, [isOpen, workspaceRef]);

  const options = useMemo(() => Object.keys(FALLBACK_OPTIONS).reduce((result, field) => {
    const definition = findDefinition(udfDefinitions, FIELD_ALIASES[field]);
    const source = dropdownOptions[field]?.length
      ? dropdownOptions[field]
      : (definition?.options?.length ? definition.options : FALLBACK_OPTIONS[field].map(([value, label]) => ({ value, label })));
    const normalized = source.map((option) => typeof option === 'string' ? { value: option, label: option } : {
      value: normalizeOptionCode(field, option.value ?? option.label ?? ''),
      label: String(option.label ?? option.value ?? ''),
    });
    const savedValue = String(liveData[field] ?? '');
    const savedLabel = String(liveData[`${field}Label`] ?? '');
    const fallbackLabel = FALLBACK_OPTIONS[field].find(([value]) => String(value) === savedValue)?.[1] || '';
    const savedIndex = normalized.findIndex((option) => String(option.value) === savedValue);
    if (savedValue && savedIndex < 0) {
      normalized.push({ value: savedValue, label: savedLabel || fallbackLabel || savedValue });
    } else if (savedIndex >= 0 && (savedLabel || fallbackLabel)) {
      normalized[savedIndex] = { ...normalized[savedIndex], label: savedLabel || fallbackLabel };
    }
    result[field] = normalized;
    return result;
  }, {}), [dropdownOptions, liveData, udfDefinitions]);

  useEffect(() => {
    if (!isOpen) return;
    setForm((current) => {
      const normalized = {
        ...current,
        subSupplyType: normalizeOptionCode('subSupplyType', current.subSupplyType, options.subSupplyType),
        documentType: normalizeOptionCode('documentType', current.documentType, options.documentType),
        transactionType: normalizeOptionCode('transactionType', current.transactionType, options.transactionType),
        mode: normalizeOptionCode('mode', current.mode, options.mode),
        vehicleType: normalizeOptionCode('vehicleType', current.vehicleType, options.vehicleType),
      };
      return JSON.stringify(normalized) === JSON.stringify(current) ? current : normalized;
    });
  }, [isOpen, options]);

  if (!isOpen) return null;

  const handleChange = (event) => {
    const { name, value } = event.target;
    const normalizedValue = FALLBACK_OPTIONS[name] ? normalizeOptionCode(name, value, options[name]) : value;
    setForm((current) => ({ ...current, [name]: normalizedValue }));
    setMessage('');
  };

  const validate = () => {
    const missing = [
      ['Sub Supply Type', form.subSupplyType],
      ['Document Type', form.documentType],
      ['Transaction Type', form.transactionType],
      ['Main HSN', form.mainHSN],
      ['Transport Mode', form.mode],
    ].filter(([, value]) => !String(value || '').trim()).map(([label]) => label);
    if (String(form.mode) === '1' && !String(form.vehicleNo || '').trim()) missing.push('Vehicle No.');
    if (missing.length) {
      setMessage(`Complete: ${missing.join(', ')}.`);
      return false;
    }
    setMessage('E-Way Bill details are complete.');
    return true;
  };

  const save = () => {
    const normalizedForm = {
      ...form,
      subSupplyType: normalizeOptionCode('subSupplyType', form.subSupplyType, options.subSupplyType),
      documentType: normalizeOptionCode('documentType', form.documentType, options.documentType),
      transactionType: normalizeOptionCode('transactionType', form.transactionType, options.transactionType),
      mode: normalizeOptionCode('mode', form.mode, options.mode),
      vehicleType: normalizeOptionCode('vehicleType', form.vehicleType, options.vehicleType),
    };
    const updates = {};
    Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
      const definition = findDefinition(udfDefinitions, aliases);
      updates[definition?.key || aliases[0]] = normalizedForm[field] || '';
    });
    onSave({ udfUpdates: updates, details: normalizedForm });
    onClose();
  };

  const openHsnLookup = async () => {
    setLookup({ type: 'hsn', rows: [], loading: true });
    try {
      const response = await fetchHSNCodes('');
      setLookup({ type: 'hsn', rows: Array.isArray(response.data) ? response.data : [], loading: false });
    } catch (_error) {
      setLookup({ type: 'hsn', rows: [], loading: false });
    }
  };

  const chooseLookupRow = (row) => {
    if (!row) return;
    if (lookup?.type === 'hsn') {
      setForm((current) => ({
        ...current,
        mainHSN: row.code || row.ChapterID || '',
        mainHSNEntry: row.absEntry || row.AbsEntry || '',
      }));
    } else {
      setForm((current) => ({
        ...current,
        transporterEntry: String(getRowValue(row, ['AbsEntry', 'TspEntry'])),
        transporterCode: String(getRowValue(row, ['TransCode', 'Code', 'AbsEntry'])),
        transporterName: String(getRowValue(row, ['TransName', 'Name', 'TransporterName'])),
        transporterId: String(getRowValue(row, ['TransID', 'GSTIN', 'GSTRegnNo', 'TaxIdNum'])),
        mode: String(getRowValue(row, ['TransMode', 'Mode', 'TransportationMode'])) || current.mode,
        vehicleType: String(getRowValue(row, ['VehicleTyp', 'VehicleType', 'VehType'])) || current.vehicleType,
        vehicleNo: String(getRowValue(row, ['VehicleNo', 'VehicleNum', 'VehNo'])) || current.vehicleNo,
      }));
    }
    setLookup(null);
  };

  return createPortal(
    <div className="del-modal-overlay del-ewb-workspace-overlay" style={workspaceBounds || undefined} onClick={onClose}>
      <div className="del-modal del-ewb-modal" onClick={(event) => event.stopPropagation()}>
        <div className="del-modal__header">
          <strong>E-Way Bill</strong>
          <button type="button" className="del-modal__close" onClick={onClose}>×</button>
        </div>
        <div className="del-modal__body del-ewb-modal__body">
          <section>
            <h6>EWB Details</h6>
            <SelectField label="Supply Type" name="supplyType" value={form.supplyType} options={[{ value: 'Outward', label: 'Outward' }, { value: 'Inward', label: 'Inward' }]} onChange={handleChange} disabled={disabled} />
            <SelectField label="Subtype" name="subSupplyType" value={form.subSupplyType} options={options.subSupplyType} onChange={handleChange} disabled={disabled} />
            <SelectField label="Document Type" name="documentType" value={form.documentType} options={options.documentType} onChange={handleChange} disabled={disabled} />
            <SelectField label="Transaction Type" name="transactionType" value={form.transactionType} options={options.transactionType} onChange={handleChange} disabled={disabled} />
            <TextField label="Main HSN" name="mainHSN" value={form.mainHSN} onChange={handleChange} readOnly={disabled} onLookup={disabled ? null : openHsnLookup} />
            <TextField label="E-Way Bill No." name="ewayBillNo" value={form.ewayBillNo} onChange={handleChange} readOnly={disabled} />
            <TextField label="E-Way Bill Date" name="ewayBillDate" value={form.ewayBillDate} onChange={handleChange} type="date" readOnly={disabled} />
            <TextField label="EWB Expiration Date" name="expirationDate" value={form.expirationDate} onChange={handleChange} type="date" readOnly={disabled} />
          </section>

          <section>
            <h6>Transportation Details</h6>
            <TextField label="Transporter Code" name="transporterCode" value={form.transporterCode} onChange={handleChange} readOnly={disabled} onLookup={disabled ? null : () => setLookup({ type: 'transporter', rows: transporters, loading: false })} />
            <TextField label="Transporter Name" name="transporterName" value={form.transporterName} onChange={handleChange} readOnly={disabled} />
            <TextField label="Transporter ID" name="transporterId" value={form.transporterId} onChange={handleChange} readOnly={disabled} />
            <SelectField label="Mode" name="mode" value={form.mode} options={options.mode} onChange={handleChange} disabled={disabled} />
            <SelectField label="Vehicle Type" name="vehicleType" value={form.vehicleType} options={options.vehicleType} onChange={handleChange} disabled={disabled} />
            <TextField label="Vehicle No." name="vehicleNo" value={form.vehicleNo} onChange={handleChange} readOnly={disabled} />
            <TextField label="Distance(in KM)" name="distanceInKM" value={form.distanceInKM} onChange={handleChange} type="number" readOnly={disabled} />
            <TextField label="Transporter Doc No." name="transporterDocNo" value={form.transporterDocNo} onChange={handleChange} readOnly={disabled} />
            <TextField label="Transporter Doc. Date" name="transporterDocDate" value={form.transporterDocDate} onChange={handleChange} type="date" readOnly={disabled} />
          </section>

          <section>
            <h6>Bill From</h6>
            <TextField label="Name" name="billFromName" value={form.billFromName} onChange={handleChange} readOnly={disabled} />
            <TextField label="GSTIN" name="billFromGSTIN" value={form.billFromGSTIN} onChange={handleChange} readOnly={disabled} />
            <TextField label="State" name="billFromState" value={form.billFromState} onChange={handleChange} readOnly={disabled} />
            <h6>Dispatch From</h6>
            <TextField label="Address" name="dispatchFromAddress" value={form.dispatchFromAddress} onChange={handleChange} readOnly={disabled} />
            <TextField label="Place" name="dispatchFromPlace" value={form.dispatchFromPlace} onChange={handleChange} readOnly={disabled} />
            <TextField label="Zip Code" name="dispatchFromZipCode" value={form.dispatchFromZipCode} onChange={handleChange} readOnly={disabled} />
            <TextField label="Actual State" name="dispatchFromState" value={form.dispatchFromState} onChange={handleChange} readOnly={disabled} />
          </section>

          <section>
            <h6>Bill To</h6>
            <TextField label="Name" name="billToName" value={form.billToName} onChange={handleChange} readOnly={disabled} />
            <TextField label="GSTIN" name="billToGSTIN" value={form.billToGSTIN} onChange={handleChange} readOnly={disabled} />
            <TextField label="State" name="billToState" value={form.billToState} onChange={handleChange} readOnly={disabled} />
            <h6>Ship To</h6>
            <TextField label="Address" name="shipToAddress" value={form.shipToAddress} onChange={handleChange} readOnly={disabled} />
            <TextField label="Place" name="shipToPlace" value={form.shipToPlace} onChange={handleChange} readOnly={disabled} />
            <TextField label="Zip Code" name="shipToZipCode" value={form.shipToZipCode} onChange={handleChange} readOnly={disabled} />
            <TextField label="Actual State" name="shipToState" value={form.shipToState} onChange={handleChange} readOnly={disabled} />
          </section>
        </div>
        {message ? <div className={`del-ewb-modal__message ${message.startsWith('Complete:') ? 'is-error' : ''}`}>{message}</div> : null}
        <div className="del-modal__footer">
          {disabled ? (
            <button type="button" className="del-btn del-btn--primary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button type="button" className="del-btn del-btn--primary" onClick={save}>OK</button>
              <button type="button" className="del-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="del-btn" onClick={validate} style={{ marginLeft: 'auto' }}>Validate</button>
            </>
          )}
        </div>
        {lookup ? (
          <LookupDialog
            title={lookup.type === 'hsn' ? 'List of India Chapter ID' : 'List of E-Way Bill Transporters'}
            rows={lookup.rows || []}
            loading={lookup.loading}
            columns={lookup.type === 'hsn'
              ? [
                  { label: 'Chapter', value: (row) => row.code || row.ChapterID || '' },
                  { label: 'Heading', value: (row) => row.heading || '' },
                  { label: 'Subheading', value: (row) => row.subHeading || '' },
                  { label: 'Description', value: (row) => row.description || '' },
                ]
              : [
                  { label: 'Code', value: (row) => getRowValue(row, ['TransCode', 'Code', 'AbsEntry']) },
                  { label: 'Transporter Name', value: (row) => getRowValue(row, ['TransName', 'Name', 'TransporterName']) },
                  { label: 'Transporter ID', value: (row) => getRowValue(row, ['TransID', 'GSTIN', 'GSTRegnNo', 'TaxIdNum']) },
                ]}
            onClose={() => setLookup(null)}
            onSelect={chooseLookupRow}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
