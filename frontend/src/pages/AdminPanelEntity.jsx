import SapInput from '../components/common/SapInput';
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useMatch, useNavigate, useParams } from 'react-router-dom';
import {
  createAdminRecord,
  deleteAdminRecord,
  fetchAdminEntityBootstrap,
  updateAdminRecord,
} from '../api/adminPanelApi';
import { matchesSapSearchText } from '../utils/sapSearch';

const EMPTY_RECORDS = [];
const EMPTY_LOOKUPS = {};
const COMPANY_DB_SOURCE_FIELD = 'SapCompanyDb';
const COMPANY_DB_TARGET_FIELDS = ['AuthDbName', 'ReportServiceCompanyDb', 'ReportServiceDefaultSchema', 'DbName'];
const LONG_TEXT_FIELD_PATTERN = /(description|remarks|notes|comment|message|body|content|template|query|json)/i;

const formatDateTimeForInput = (value) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (part) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const formatCellValue = (value, column, lookupLabels) => {
  if (Array.isArray(value)) {
    const labels = value
      .map((entry) => lookupLabels?.get(String(entry)) || String(entry))
      .filter(Boolean);
    return labels.length ? labels.join(', ') : '-';
  }

  if (lookupLabels?.has(String(value))) {
    return lookupLabels.get(String(value));
  }

  if (value === null || value === undefined || value === '') {
    return '-';
  }

  if (column.dataType === 'bit') {
    return value ? 'Yes' : 'No';
  }

  if (['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'].includes(column.dataType)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  }

  return String(value);
};

const buildEmptyForm = (schema) =>
  Object.fromEntries(
    (schema?.columns || [])
      .filter((column) => column.editable)
      .map((column) => {
        if (column.multiSelect) {
          return [column.name, []];
        }

        if (column.dataType === 'bit') {
          return [column.name, column.nullable ? '' : false];
        }

        return [column.name, ''];
      }),
  );

const buildFormFromRecord = (schema, record) => {
  const nextForm = buildEmptyForm(schema);

  for (const column of schema.columns || []) {
    if (!column.editable) continue;

    const value = record?.[column.name];
    if (column.multiSelect) {
      nextForm[column.name] = value === null || value === undefined || value === '' ? [] : [String(value)];
      continue;
    }

    if (column.dataType === 'bit') {
      nextForm[column.name] = column.nullable
        ? (value === null || value === undefined ? '' : String(Boolean(value)))
        : Boolean(value);
      continue;
    }

    if (column.inputType === 'datetime-local') {
      nextForm[column.name] = formatDateTimeForInput(value);
      continue;
    }

    nextForm[column.name] = value === null || value === undefined ? '' : String(value);
  }

  return nextForm;
};

const getRoleGroupLabel = (record, lookupLabelMaps) => {
  const roleValue = record?.RoleId;
  return lookupLabelMaps.RoleId?.get(String(roleValue)) || String(roleValue || 'Unassigned Role');
};

const COMMON_MENU_ICONS = [
  'dashboard',
  'sales',
  'purchase',
  'invoice',
  'document',
  'delivery',
  'payments',
  'inventory',
  'production',
  'banking',
  'reports',
  'master',
  'admin',
  'tax',
  'warehouse',
  'branch',
  'uom',
  'price',
];

const slugifyMenuName = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const getRecordId = (record) => record?.MenuId ?? record?.menuId ?? record?.id;

const getMenuRecordById = (records, menuId) =>
  records.find((record) => String(getRecordId(record)) === String(menuId));

const buildMenuOptionLabel = (record, records) => {
  const parent = record.ParentId ? getMenuRecordById(records, record.ParentId) : null;
  const suffix = record.MenuPath ? record.MenuPath : 'section';
  const parentName = parent?.MenuName ? `${parent.MenuName} / ` : '';
  return `${parentName}${record.MenuName || 'Untitled'} (${suffix})`;
};

const getMenuParentOptions = (records, selectedRecord) =>
  records
    .filter((record) => String(getRecordId(record)) !== String(getRecordId(selectedRecord)))
    .sort((first, second) => {
      const firstParent = Number(first.ParentId || 0);
      const secondParent = Number(second.ParentId || 0);
      if (firstParent !== secondParent) return firstParent - secondParent;
      const firstOrder = Number(first.SortOrder || 0);
      const secondOrder = Number(second.SortOrder || 0);
      if (firstOrder !== secondOrder) return firstOrder - secondOrder;
      return String(first.MenuName || '').localeCompare(String(second.MenuName || ''));
    });

const buildSuggestedMenuPath = (formData, records) => {
  const menuSlug = slugifyMenuName(formData.MenuName);
  if (!menuSlug) return '';

  const parent = formData.ParentId ? getMenuRecordById(records, formData.ParentId) : null;
  if (!parent) return `/${menuSlug}`;

  const parentPath = String(parent.MenuPath || '').trim();
  if (parentPath && parentPath !== '-') {
    return `${parentPath.replace(/\/+$/g, '')}/${menuSlug}`;
  }

  const parentSlug = slugifyMenuName(parent.MenuName);
  return parentSlug ? `/${parentSlug}/${menuSlug}` : `/${menuSlug}`;
};

const AdminMultiSelectDropdown = ({ column, value, options, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const selectedValues = useMemo(() => (Array.isArray(value) ? value.map(String) : []), [value]);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const optionValues = useMemo(() => options.map((option) => String(option.value)), [options]);
  const allSelected = optionValues.length > 0 && optionValues.every((optionValue) => selectedSet.has(optionValue));
  const fieldId = `admin-field-${column.name}`;

  useEffect(() => {
    if (!isOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [isOpen]);

  const updateSelection = (nextValues) => {
    onChange(column, nextValues);
  };

  const toggleValue = (optionValue) => {
    const nextSet = new Set(selectedSet);
    if (nextSet.has(optionValue)) {
      nextSet.delete(optionValue);
    } else {
      nextSet.add(optionValue);
    }

    updateSelection(optionValues.filter((valueItem) => nextSet.has(valueItem)));
  };

  const toggleAll = () => {
    updateSelection(allSelected ? [] : optionValues);
  };

  const selectedLabel = (() => {
    if (!selectedValues.length) return `Select ${column.label}`;
    if (allSelected) return `All ${column.label} selected`;
    if (selectedValues.length === 1) {
      const selectedOption = options.find((option) => String(option.value) === selectedValues[0]);
      return selectedOption?.label || selectedValues[0];
    }
    return `${selectedValues.length} selected`;
  })();

  return (
    <div className="admin-multi-select" ref={dropdownRef}>
      <button
        id={fieldId}
        type="button"
        className={`admin-multi-select__button${isOpen ? ' is-open' : ''}`}
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="admin-multi-select__value">{selectedLabel}</span>
        <span className="admin-multi-select__caret" aria-hidden="true">v</span>
      </button>

      {isOpen ? (
        <div className="admin-multi-select__panel" role="listbox" aria-labelledby={fieldId}>
          <label className="admin-multi-select__option admin-multi-select__option--select-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
            />
            <span>Select All</span>
          </label>

          {options.length ? options.map((option) => {
            const optionValue = String(option.value);
            return (
              <label key={`${column.name}-${optionValue}`} className="admin-multi-select__option">
                <input
                  type="checkbox"
                  checked={selectedSet.has(optionValue)}
                  onChange={() => toggleValue(optionValue)}
                />
                <span>{option.label}</span>
              </label>
            );
          }) : (
            <div className="admin-multi-select__empty">No options found.</div>
          )}
        </div>
      ) : null}
    </div>
  );
};

const renderField = (column, value, selectedRecord, isCreating, lookups, handleFieldChange, context = {}) => {
  const fieldId = `admin-field-${column.name}`;
  const isMenusEntity = context.entityKey === 'menus';
  const isPasswordField = column.inputType === 'password';
  const isPasswordVisible = Boolean(context.visiblePasswordFields?.has(column.name));
  const hasPasswordValue = isPasswordField && value !== null && value !== undefined && value !== '';
  const helpText = isPasswordField && hasPasswordValue
    ? 'Saved password loaded. Use See to view it, or clear the field to keep the stored value unchanged.'
    : column.helpText;

  if (!column.editable) {
    return (
      <div key={column.name} className="admin-form-field admin-form-field--readonly">
        <label htmlFor={fieldId}>{column.label}</label>
        <input
          id={fieldId}
          className="admin-panel-input"
          value={isCreating ? 'Auto generated' : selectedRecord?.[column.name] ?? ''}
          readOnly
        />
      </div>
    );
  }

  if (isMenusEntity && column.name === 'ParentId') {
    const parentOptions = getMenuParentOptions(context.records || EMPTY_RECORDS, selectedRecord);

    return (
      <div key={column.name} className="admin-form-field">
        <label htmlFor={fieldId}>{column.label}</label>
        <select
          id={fieldId}
          className="admin-panel-input"
          value={value ?? ''}
          onChange={(event) => handleFieldChange(column, event.target.value)}
        >
          <option value="">Root section</option>
          {parentOptions.map((option) => (
            <option key={`menu-parent-${getRecordId(option)}`} value={getRecordId(option)}>
              {buildMenuOptionLabel(option, context.records || EMPTY_RECORDS)}
            </option>
          ))}
        </select>
        <small>Select the sidebar section this screen belongs under. Use Root section for a top-level menu.</small>
      </div>
    );
  }

  if (isMenusEntity && column.name === 'MenuPath') {
    const suggestedPath = buildSuggestedMenuPath(context.formData || {}, context.records || EMPTY_RECORDS);

    return (
      <div key={column.name} className="admin-form-field admin-form-field--wide">
        <label htmlFor={fieldId}>{column.label}</label>
        <div className="admin-input-with-action">
          <input
            id={fieldId}
            className="admin-panel-input"
            value={value ?? ''}
            maxLength={column.maxLength && column.maxLength > 0 ? column.maxLength : undefined}
            placeholder={suggestedPath || 'Leave blank for a menu section'}
            onChange={(event) => handleFieldChange(column, event.target.value)}
          />
          <button
            type="button"
            className="admin-panel-button admin-panel-button--ghost"
            onClick={() => handleFieldChange(column, suggestedPath)}
            disabled={!suggestedPath}
          >
            Generate Path
          </button>
        </div>
        <small>For a parent section leave this blank. For a screen, generate from menu name and parent.</small>
      </div>
    );
  }

  if (isMenusEntity && column.name === 'Icon') {
    const iconOptions = COMMON_MENU_ICONS.includes(String(value || ''))
      ? COMMON_MENU_ICONS
      : [String(value || '').trim(), ...COMMON_MENU_ICONS].filter(Boolean);

    return (
      <div key={column.name} className="admin-form-field">
        <label htmlFor={fieldId}>{column.label}</label>
        <select
          id={fieldId}
          className="admin-panel-input"
          value={value ?? ''}
          onChange={(event) => handleFieldChange(column, event.target.value)}
        >
          <option value="">Select icon</option>
          {iconOptions.map((iconName) => (
            <option key={`menu-icon-${iconName}`} value={iconName}>
              {iconName}
            </option>
          ))}
        </select>
        <small>Choose the icon key used by the sidebar.</small>
      </div>
    );
  }

  if (isMenusEntity && column.name === 'SortOrder') {
    return (
      <div key={column.name} className="admin-form-field">
        <label htmlFor={fieldId}>{column.label}</label>
        <input
          id={fieldId}
          className="admin-panel-input"
          type="number"
          min="0"
          step="1"
          value={value ?? ''}
          onChange={(event) => handleFieldChange(column, event.target.value)}
        />
        <small>Lower numbers appear first inside the selected parent section.</small>
      </div>
    );
  }

  if (column.multiSelect) {
    return (
      <div key={column.name} className="admin-form-field">
        <label htmlFor={fieldId}>{column.label}</label>
        <AdminMultiSelectDropdown
          column={column}
          value={value}
          options={lookups[column.name] || []}
          onChange={handleFieldChange}
        />
        {column.helpText ? <small>{column.helpText}</small> : null}
      </div>
    );
  }

  if (Array.isArray(column.options) && column.options.length) {
    return (
      <div key={column.name} className="admin-form-field">
        <label htmlFor={fieldId}>{column.label}</label>
        <select
          id={fieldId}
          className="admin-panel-input"
          value={value ?? ''}
          onChange={(event) => handleFieldChange(column, event.target.value)}
        >
          <option value="">Select {column.label}</option>
          {column.options.map((option) => (
            <option key={`${column.name}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {column.helpText ? <small>{column.helpText}</small> : null}
      </div>
    );
  }

  if (column.isForeignKey) {
    return (
      <div key={column.name} className="admin-form-field">
        <label htmlFor={fieldId}>{column.label}</label>
        <select
          id={fieldId}
          className="admin-panel-input"
          value={value ?? ''}
          onChange={(event) => handleFieldChange(column, event.target.value)}
        >
          <option value="">Select {column.label}</option>
          {(lookups[column.name] || []).map((option) => (
            <option key={`${column.name}-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {column.helpText ? <small>{column.helpText}</small> : null}
      </div>
    );
  }

  if (column.dataType === 'bit' && column.nullable) {
    return (
      <div key={column.name} className="admin-form-field">
        <label htmlFor={fieldId}>{column.label}</label>
        <select
          id={fieldId}
          className="admin-panel-input"
          value={value ?? ''}
          onChange={(event) => handleFieldChange(column, event.target.value)}
        >
          <option value="">Not set</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        {column.helpText ? <small>{column.helpText}</small> : null}
      </div>
    );
  }

  if (column.dataType === 'bit') {
    return (
      <div key={column.name} className="admin-form-field admin-form-field--checkbox">
        <label htmlFor={fieldId}>{column.label}</label>
        <div className="admin-checkbox-row">
          <input
            id={fieldId}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => handleFieldChange(column, event.target.checked)}
          />
          <span>{Boolean(value) ? 'Enabled' : 'Disabled'}</span>
        </div>
        {column.helpText ? <small>{column.helpText}</small> : null}
      </div>
    );
  }

  const isLongText =
    !isPasswordField &&
    (column.maxLength === -1 ||
      (column.maxLength && column.maxLength > 500) ||
      LONG_TEXT_FIELD_PATTERN.test(column.name));

  return (
    <div
      key={column.name}
      className={`admin-form-field${isLongText ? ' admin-form-field--wide' : ''}`}
    >
      <label htmlFor={fieldId}>{column.label}</label>
      {isLongText ? (
        <textarea
          id={fieldId}
          className="admin-panel-input admin-panel-textarea"
          value={value ?? ''}
          maxLength={column.maxLength && column.maxLength > 0 ? column.maxLength : undefined}
          onChange={(event) => handleFieldChange(column, event.target.value)}
        />
      ) : isPasswordField ? (
        <div className="admin-input-with-action admin-password-field">
          <SapInput
            id={fieldId}
            className="admin-panel-input"
            type={isPasswordVisible ? 'text' : 'password'}
            value={value ?? ''}
            maxLength={column.maxLength && column.maxLength > 0 ? column.maxLength : undefined}
            onChange={(event) => handleFieldChange(column, event.target.value)}
          />
          <button
            type="button"
            className="admin-password-field__toggle"
            onClick={() => context.onTogglePasswordVisibility?.(column.name)}
            aria-label={`${isPasswordVisible ? 'Hide' : 'Show'} ${column.label}`}
            aria-pressed={isPasswordVisible}
          >
            {isPasswordVisible ? 'Hide' : 'See'}
          </button>
        </div>
      ) : (
        <SapInput
          id={fieldId}
          className="admin-panel-input"
          type={column.inputType}
          value={value ?? ''}
          maxLength={column.maxLength && column.maxLength > 0 ? column.maxLength : undefined}
          onChange={(event) => handleFieldChange(column, event.target.value)}
        />
      )}
      {helpText ? <small>{helpText}</small> : null}
    </div>
  );
};

const AdminPanelEntity = () => {
  const { entityKey = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const createMatch = useMatch('/admin/:entityKey/new');
  const editMatch = useMatch('/admin/:entityKey/:recordId');
  const isCreating = Boolean(createMatch);
  const editingRecordId = isCreating ? null : editMatch?.params?.recordId || null;
  const pageMode = isCreating ? 'create' : editingRecordId ? 'edit' : 'list';

  const [bootstrap, setBootstrap] = useState(null);
  const [formData, setFormData] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state?.notice || '');
  const [openRoleGroups, setOpenRoleGroups] = useState(() => new Set());
  const [visiblePasswordFields, setVisiblePasswordFields] = useState(() => new Set());
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const schema = bootstrap?.schema || null;
  const primaryKey = schema?.primaryKey || '';
  const records = bootstrap?.records || EMPTY_RECORDS;
  const lookups = bootstrap?.lookups || EMPTY_LOOKUPS;

  useEffect(() => {
    if (location.state?.notice) {
      setNotice(location.state.notice);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    let isCancelled = false;

    const loadBootstrap = async () => {
      try {
        setIsLoading(true);
        setError('');
        const payload = await fetchAdminEntityBootstrap(entityKey);
        if (!isCancelled) {
          setBootstrap(payload);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError.response?.data?.message || loadError.message || 'Unable to load admin records.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadBootstrap();
    return () => {
      isCancelled = true;
    };
  }, [entityKey]);

  const lookupLabelMaps = useMemo(
    () => Object.fromEntries(
      Object.entries(lookups).map(([columnName, options]) => [
        columnName,
        new Map((options || []).map((option) => [String(option.value), option.label])),
      ]),
    ),
    [lookups],
  );

  const visibleColumns = useMemo(() => {
    if (!schema) return [];

    const listColumnNames = bootstrap?.entity?.listColumns || schema.entity?.listColumns || [];
    return listColumnNames
      .map((columnName) => schema.columns.find((column) => column.name === columnName))
      .filter((column) => column && !column.hidden);
  }, [bootstrap?.entity?.listColumns, schema]);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = deferredSearchTerm.trim();
    if (!normalizedSearch) return records;

    return records.filter((record) =>
      visibleColumns.some((column) => {
        const cellValue = formatCellValue(record[column.name], column, lookupLabelMaps[column.name]);
        return matchesSapSearchText(cellValue, normalizedSearch);
      }),
    );
  }, [deferredSearchTerm, lookupLabelMaps, records, visibleColumns]);

  const roleRightGroups = useMemo(() => {
    if (entityKey !== 'role-rights') return [];

    const grouped = new Map();
    for (const record of filteredRecords) {
      const roleKey = String(record.RoleId ?? 'unassigned');
      const roleLabel = getRoleGroupLabel(record, lookupLabelMaps);
      if (!grouped.has(roleKey)) {
        grouped.set(roleKey, {
          key: roleKey,
          label: roleLabel,
          records: [],
        });
      }

      grouped.get(roleKey).records.push(record);
    }

    return Array.from(grouped.values()).sort((first, second) =>
      first.label.localeCompare(second.label, undefined, { sensitivity: 'base' }),
    );
  }, [entityKey, filteredRecords, lookupLabelMaps]);

  const formSections = useMemo(() => {
    if (!schema) return [];

    const visibleFormColumns = (schema.columns || []).filter((column) => !column.hidden);
    const configuredSections = schema.entity?.formSections || bootstrap?.entity?.formSections || [];
    if (!configuredSections.length) return [];

    const usedColumnNames = new Set();
    const sections = configuredSections
      .map((section) => {
        const sectionColumnNames = new Set(section.columns || []);
        const columns = visibleFormColumns.filter((column) => sectionColumnNames.has(column.name));
        columns.forEach((column) => usedColumnNames.add(column.name));

        return {
          key: section.key,
          title: section.title,
          columns,
        };
      })
      .filter((section) => section.columns.length);

    const uncategorizedColumns = visibleFormColumns.filter((column) => !usedColumnNames.has(column.name));
    if (uncategorizedColumns.length) {
      sections.push({
        key: 'other-fields',
        title: 'Other Fields',
        columns: uncategorizedColumns,
      });
    }

    return sections;
  }, [bootstrap?.entity?.formSections, schema]);

  useEffect(() => {
    if (entityKey !== 'role-rights') return;

    setOpenRoleGroups((current) => {
      const availableKeys = new Set(roleRightGroups.map((group) => group.key));
      const nextSet = new Set([...current].filter((key) => availableKeys.has(key)));

      if (!nextSet.size && roleRightGroups.length === 1) {
        nextSet.add(roleRightGroups[0].key);
      }

      return nextSet;
    });
  }, [entityKey, roleRightGroups]);

  const selectedRecord = useMemo(() => {
    if (!primaryKey || !editingRecordId) return null;
    return records.find((record) => String(record[primaryKey]) === String(editingRecordId)) || null;
  }, [editingRecordId, primaryKey, records]);

  const initialFormData = useMemo(() => {
    if (!schema) return {};

    if (pageMode === 'create') {
      return buildEmptyForm(schema);
    }

    if (pageMode === 'edit') {
      return selectedRecord ? buildFormFromRecord(schema, selectedRecord) : {};
    }

    return {};
  }, [pageMode, schema, selectedRecord]);

  const editableColumnCount = useMemo(
    () => (schema?.columns || []).filter((column) => column.editable).length,
    [schema],
  );

  useEffect(() => {
    setFormData(initialFormData);
  }, [initialFormData]);

  useEffect(() => {
    setVisiblePasswordFields(new Set());
  }, [editingRecordId, entityKey, pageMode]);

  useEffect(() => {
    if (pageMode === 'edit' && schema && records.length && !selectedRecord) {
      setError('The selected record was not found.');
    }
  }, [pageMode, records.length, schema, selectedRecord]);

  const openNewRecord = () => {
    setNotice('');
    setError('');
    navigate(`/admin/${entityKey}/new`);
  };

  const openExistingRecord = (record) => {
    setNotice('');
    setError('');
    navigate(`/admin/${entityKey}/${record[primaryKey]}`);
  };

  const toggleRoleGroup = (roleKey) => {
    setOpenRoleGroups((current) => {
      const nextSet = new Set(current);
      if (nextSet.has(roleKey)) {
        nextSet.delete(roleKey);
      } else {
        nextSet.add(roleKey);
      }

      return nextSet;
    });
  };

  const handleFieldChange = (column, nextValue) => {
    setFormData((current) => {
      const nextFormData = {
        ...current,
        [column.name]: nextValue,
      };

      if (entityKey === 'companies' && column.name === COMPANY_DB_SOURCE_FIELD) {
        COMPANY_DB_TARGET_FIELDS.forEach((targetFieldName) => {
          if (Object.prototype.hasOwnProperty.call(nextFormData, targetFieldName)) {
            nextFormData[targetFieldName] = nextValue;
          }
        });
      }

      return nextFormData;
    });
  };

  const togglePasswordVisibility = (columnName) => {
    setVisiblePasswordFields((current) => {
      const nextSet = new Set(current);
      if (nextSet.has(columnName)) {
        nextSet.delete(columnName);
      } else {
        nextSet.add(columnName);
      }

      return nextSet;
    });
  };

  const handleRefresh = async () => {
    try {
      setIsLoading(true);
      setError('');
      const payload = await fetchAdminEntityBootstrap(entityKey);
      setBootstrap(payload);
    } catch (refreshError) {
      setError(refreshError.response?.data?.message || refreshError.message || 'Unable to refresh records.');
    } finally {
      setIsLoading(false);
    }
  };

  const goToList = (nextNotice = '', replace = false) => {
    navigate(`/admin/${entityKey}`, {
      replace,
      state: nextNotice ? { notice: nextNotice } : null,
    });
  };

  const handleResetForm = () => {
    setError('');
    setNotice('');
    setFormData(initialFormData);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!schema) return;

    try {
      setIsSaving(true);
      setError('');
      setNotice('');

      if (pageMode === 'create') {
        const updatedBootstrap = await createAdminRecord(entityKey, formData);
        setBootstrap(updatedBootstrap);
        goToList('Record created successfully.', true);
        return;
      }

      const updatedBootstrap = await updateAdminRecord(entityKey, editingRecordId, formData);
      setBootstrap(updatedBootstrap);
      goToList('Record updated successfully.', true);
    } catch (saveError) {
      setError(saveError.response?.data?.message || saveError.message || 'Unable to save the record.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!schema || pageMode !== 'edit' || editingRecordId === null || editingRecordId === undefined) return;

    const confirmed = window.confirm(`Delete this ${bootstrap?.entity?.title || 'record'} entry?`);
    if (!confirmed) return;

    try {
      setIsSaving(true);
      setError('');
      setNotice('');
      const updatedBootstrap = await deleteAdminRecord(entityKey, editingRecordId);
      setBootstrap(updatedBootstrap);
      goToList('Record deleted successfully.', true);
    } catch (deleteError) {
      setError(deleteError.response?.data?.message || deleteError.message || 'Unable to delete the record.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderAdminField = (column) =>
    column.hidden
      ? null
      : renderField(
        column,
        formData[column.name],
        selectedRecord,
        pageMode === 'create',
        lookups,
        handleFieldChange,
        {
          entityKey,
          records,
          formData,
          visiblePasswordFields,
          onTogglePasswordVisibility: togglePasswordVisibility,
        },
      );

  const formActions = (
    <div className="admin-form-actions">
      <button type="submit" className="admin-panel-button" disabled={isSaving}>
        {isSaving ? 'Saving...' : pageMode === 'create' ? 'Create Record' : 'Save Changes'}
      </button>
      <button
        type="button"
        className="admin-panel-button admin-panel-button--ghost"
        onClick={handleResetForm}
        disabled={isSaving}
      >
        Reset Form
      </button>
    </div>
  );

  if (isLoading) {
    return <div className="admin-panel-empty">Loading {entityKey}...</div>;
  }

  if (error && !bootstrap) {
    return (
      <div className="admin-panel-page">
        <div className="admin-panel-alert admin-panel-alert--error">{error}</div>
        <button type="button" className="admin-panel-button" onClick={() => navigate('/admin')}>
          Back to Admin Panel
        </button>
      </div>
    );
  }

  if (pageMode === 'list') {
    return (
      <div className="admin-entity-page">
        <section className="admin-entity-banner">
          <div>
            <div className="admin-entity-banner__eyebrow">Admin Section</div>
            <h1>{bootstrap?.entity?.title || 'Admin Data'}</h1>
            <p>{bootstrap?.entity?.description}</p>
            <div className="admin-entity-banner__meta">
              <span>{records.length} records</span>
              <span>{editableColumnCount} editable fields</span>
              <span>List view</span>
            </div>
          </div>

          <div className="admin-entity-banner__actions">
            <Link className="admin-panel-button admin-panel-button--ghost" to="/admin">
              All Sections
            </Link>
            <button type="button" className="admin-panel-button admin-panel-button--ghost" onClick={handleRefresh}>
              Refresh
            </button>
            <button type="button" className="admin-panel-button" onClick={openNewRecord}>
              New Record
            </button>
          </div>
        </section>

        {error ? <div className="admin-panel-alert admin-panel-alert--error">{error}</div> : null}
        {notice ? <div className="admin-panel-alert admin-panel-alert--success">{notice}</div> : null}

        <section className="admin-records-page">
          <div className="admin-records-panel">
            <div className="admin-records-panel__toolbar">
              <input
                type="search"
                className="admin-panel-input"
                placeholder={`Search ${bootstrap?.entity?.title || 'records'}`}
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
              <div className="admin-records-panel__meta">
                {filteredRecords.length} / {records.length} rows
              </div>
            </div>

            {entityKey === 'role-rights' ? (
              <div className="admin-role-rights-groups">
                {roleRightGroups.length ? (
                  roleRightGroups.map((group) => {
                    const isOpen = openRoleGroups.has(group.key);
                    const accessSummary = group.records.reduce(
                      (summary, record) => ({
                        view: summary.view + (record.CanView ? 1 : 0),
                        add: summary.add + (record.CanAdd ? 1 : 0),
                        edit: summary.edit + (record.CanEdit ? 1 : 0),
                      }),
                      { view: 0, add: 0, edit: 0 },
                    );

                    return (
                      <section key={group.key} className={`admin-role-rights-group${isOpen ? ' is-open' : ''}`}>
                        <button
                          type="button"
                          className="admin-role-rights-group__header"
                          onClick={() => toggleRoleGroup(group.key)}
                          aria-expanded={isOpen}
                        >
                          <span className="admin-role-rights-group__chevron">{isOpen ? '^' : 'v'}</span>
                          <span className="admin-role-rights-group__title">{group.label}</span>
                          <span className="admin-role-rights-group__count">{group.records.length} rights</span>
                          <span className="admin-role-rights-group__summary">
                            View {accessSummary.view} | Add {accessSummary.add} | Edit {accessSummary.edit}
                          </span>
                        </button>

                        {isOpen ? (
                          <div className="admin-records-table-wrap admin-role-rights-group__table">
                            <table className="admin-records-table">
                              <thead>
                                <tr>
                                  {visibleColumns
                                    .filter((column) => column.name !== 'RoleId')
                                    .map((column) => (
                                      <th key={column.name}>{column.label}</th>
                                    ))}
                                </tr>
                              </thead>
                              <tbody>
                                {group.records.map((record) => (
                                  <tr
                                    key={record[primaryKey]}
                                    onClick={() => openExistingRecord(record)}
                                  >
                                    {visibleColumns
                                      .filter((column) => column.name !== 'RoleId')
                                      .map((column) => (
                                        <td key={column.name}>
                                          {formatCellValue(record[column.name], column, lookupLabelMaps[column.name])}
                                        </td>
                                      ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </section>
                    );
                  })
                ) : (
                  <div className="admin-panel-empty admin-panel-empty--inline">
                    No matching records found.
                  </div>
                )}
              </div>
            ) : (
              <div className="admin-records-table-wrap">
                <table className="admin-records-table">
                  <thead>
                    <tr>
                      {visibleColumns.map((column) => (
                        <th key={column.name}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.length ? (
                      filteredRecords.map((record) => (
                        <tr
                          key={record[primaryKey]}
                          onClick={() => openExistingRecord(record)}
                        >
                          {visibleColumns.map((column) => (
                            <td key={column.name}>
                              {formatCellValue(record[column.name], column, lookupLabelMaps[column.name])}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={Math.max(visibleColumns.length, 1)}>
                          <div className="admin-panel-empty admin-panel-empty--inline">
                            No matching records found.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-entity-page">
      <section className="admin-entity-banner">
        <div>
          <div className="admin-entity-banner__eyebrow">Admin Section</div>
          <h1>{pageMode === 'create' ? `Create ${bootstrap?.entity?.title}` : `Edit ${bootstrap?.entity?.title}`}</h1>
          <p>
            {pageMode === 'create'
              ? 'Create a fresh record using the form below.'
              : bootstrap?.entity?.description}
          </p>
          <div className="admin-entity-banner__meta">
            <span>{records.length} records</span>
            <span>{editableColumnCount} editable fields</span>
            <span>{pageMode === 'create' ? 'Create mode' : 'Edit mode'}</span>
          </div>
        </div>

        <div className="admin-entity-banner__actions">
          <button type="button" className="admin-panel-button admin-panel-button--ghost" onClick={() => goToList()}>
            Back to List
          </button>
          <button type="button" className="admin-panel-button admin-panel-button--ghost" onClick={handleRefresh}>
            Refresh
          </button>
        </div>
      </section>

      {error ? <div className="admin-panel-alert admin-panel-alert--error">{error}</div> : null}
      {notice ? <div className="admin-panel-alert admin-panel-alert--success">{notice}</div> : null}

      <section className="admin-form-page">
        <div className="admin-form-panel">
          <div className="admin-form-panel__header">
            <div>
              <h2>{pageMode === 'create' ? `Create ${bootstrap?.entity?.title}` : `Edit ${bootstrap?.entity?.title}`}</h2>
              <p>
                {pageMode === 'create'
                  ? 'Fill in the fields below to add a new record.'
                  : `Primary key: ${selectedRecord?.[primaryKey] ?? 'Not selected'}`}
              </p>
            </div>

            {pageMode === 'edit' && selectedRecord ? (
              <button
                type="button"
                className="admin-panel-button admin-panel-button--danger"
                onClick={handleDelete}
                disabled={isSaving}
              >
                Delete
              </button>
            ) : null}
          </div>

          <form onSubmit={handleSubmit}>
            {formSections.length ? (
              <div className="admin-form-section-list">
                {formSections.map((section) => (
                  <section
                    key={section.key}
                    className="admin-form-section"
                  >
                    <div className="admin-form-section__header">
                      <h3>{section.title}</h3>
                      <span>{section.columns.length} fields</span>
                    </div>
                    <div className="admin-form-grid">
                      {section.columns.map(renderAdminField)}
                    </div>
                  </section>
                ))}
                {formActions}
              </div>
            ) : (
              <div className="admin-form-grid">
                {(schema?.columns || []).map(renderAdminField)}
                {formActions}
              </div>
            )}
          </form>
        </div>
      </section>
    </div>
  );
};

export default AdminPanelEntity;
