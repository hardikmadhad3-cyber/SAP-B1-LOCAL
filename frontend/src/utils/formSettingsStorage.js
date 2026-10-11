import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fetchFormSettings, saveFormSettings } from '../api/formSettingsApi';
import { isLineNumberMatrixField, reorderFormSettingPreferences } from './formSettingsColumns';
import { normalizeLayoutToken } from './liveDocumentLayout';
import { mergeSavedFormSettings } from './formSettingsPreferences';

const normalizeScopePart = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

const areSettingsEqual = (left, right) => {
  try {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
  } catch (_error) {
    return false;
  }
};

export const buildCompanyScopedFormSettingsKey = (baseKey, company = {}, user = {}) => {
  const safeCompany = company || {};
  const safeUser = user || {};
  const companyScope = [
    safeCompany.companyId !== undefined && safeCompany.companyId !== null ? `id:${safeCompany.companyId}` : '',
    safeCompany.dbName ? `db:${normalizeScopePart(safeCompany.dbName)}` : '',
    safeCompany.serverName ? `server:${normalizeScopePart(safeCompany.serverName)}` : '',
  ].filter(Boolean);
  const userScope = [
    safeUser.userId !== undefined && safeUser.userId !== null ? `id:${safeUser.userId}` : '',
    safeUser.UserId !== undefined && safeUser.UserId !== null ? `id:${safeUser.UserId}` : '',
    safeUser.username ? `username:${normalizeScopePart(safeUser.username)}` : '',
    safeUser.Username ? `username:${normalizeScopePart(safeUser.Username)}` : '',
  ].filter(Boolean);

  return `${baseKey}::user:${encodeURIComponent(userScope.join('|') || 'unselected')}::company:${encodeURIComponent(companyScope.join('|') || 'unselected')}`;
};

const normalizeScopeId = (value) => String(value ?? '').trim();

export const isFormSettingsPayloadForScope = (payload = {}, company = {}, user = {}) => {
  const expectedCompanyId = normalizeScopeId(company?.companyId);
  const expectedUserId = normalizeScopeId(user?.userId ?? user?.UserId);
  const payloadCompanyId = normalizeScopeId(payload?.companyId);
  const payloadUserId = normalizeScopeId(payload?.userId);

  if (expectedCompanyId && expectedCompanyId !== payloadCompanyId) return false;
  if (expectedUserId && expectedUserId !== payloadUserId) return false;
  return true;
};

const SQL_LAYOUT_FIELD_ALIASES = {
  lineno: ['__lineNumber'],
  rowno: ['__lineNumber'],
  rownumber: ['__lineNumber'],
  serialno: ['__lineNumber'],
  itemno: ['itemNo'],
  itemcode: ['itemNo'],
  itemdescription: ['itemDescription'],
  description: ['description', 'itemDescription'],
  glaccount: ['glAccount'],
  glaccountname: ['glAccountName'],
  sac: ['sac', 'sacCode'],
  requireddate: ['requiredDate'],
  quoteddate: ['quotedDate'],
  requiredqty: ['requiredQty'],
  requiredquantity: ['requiredQty'],
  quotedqty: ['quantity'],
  quotedquantity: ['quantity'],
  uomcode: ['uomCode'],
  wtaxliable: ['wtaxLiable'],
  blanketagreementno: ['blanketAgreementNo'],
  costsheet: ['costSheet'],
  containertype: ['containerType'],
  unitprice: ['unitPrice'],
  price: ['unitPrice', 'price'],
  totalbeforetax: ['totalLC', 'totalBeforeTax', 'total'],
  taxamount: ['taxAmount', 'taxAmountLC'],
  discountpercent: ['discountPercent', 'stdDiscount'],
  discountpct: ['stdDiscount'],
  discpercent: ['stdDiscount'],
  discprcnt: ['stdDiscount'],
  discount: ['stdDiscount'],
  taxcode: ['taxCode', 'taxCodeRepeat'],
  total: ['totalLC', 'total'],
  totallc: ['totalLC', 'total'],
  linetotal: ['totalLC', 'total'],
  grosstotal: ['grossTotal'],
  warehouse: ['whse'],
  warehousecode: ['whse'],
  whse: ['whse'],
  whscode: ['whse'],
  binlocationallocation: ['binLocationAllocation'],
  binallocation: ['binLocationAllocation'],
  priceafterdiscount: ['priceAfterDiscount'],
  priceafterdisc: ['priceAfterDisc', 'priceAfterDiscount'],
  itemcost: ['itemCost'],
  distrrule: ['distRule'],
  distributionrule: ['distRule'],
  cogsdistrrule: ['cogsDistRule'],
  countryregionoforigin: ['countryOfOrigin'],
  hsn: ['hsnCode'],
  hsncode: ['hsnCode'],
  grosswt: ['grossWt', 'U_GrossWt'],
  grossweight: ['grossWt', 'U_GrossWt'],
  totalpackage: ['totalPackage', 'U_TotalPackage'],
  totalpackages: ['totalPackage', 'U_TotalPackage'],
  deliveredqty: ['deliveredQty'],
  deliveredquantity: ['deliveredQty'],
  forrate: ['forRate'],
  buyertermsofpayment: ['buyerPaymentTerms'],
  sellertermsofpayment: ['sellerPaymentTerms'],
  buyerquality: ['buyerQuality'],
  sellerquality: ['sellerQuality'],
  buyerprice: ['buyerPrice'],
  sellerprice: ['sellerPrice'],
  buyerspecialinstruction: ['buyerSpecialInstruction'],
  sellerspecialinstruction: ['sellerSpecialInstruction'],
  sellerbrokerageamtper: ['sellerBrokerageAmtPer'],
  sellerbrokeragepercentage: ['sellerBrokeragePercent'],
  sellerbrokerageinpercentage: ['sellerBrokeragePercent'],
  sellerbrokerageinpercent: ['sellerBrokeragePercent'],
  stcode: ['stcode'],
  sitem: ['sellerItem'],
  sqty: ['sellerQty'],
  specialrebate: ['specialRebate'],
  comm: ['commission', 'commPercent'],
  commpercent: ['commission', 'commPercent'],
  commision: ['commission'],
  commission: ['commission'],
  brokperqty: ['sellerBrokeragePerQty'],
  brokerperqty: ['sellerBrokeragePerQty'],
  sellerbrokerageperqty: ['sellerBrokeragePerQty'],
  fixbrokbuyer: ['U_Fix_Brock_B', 'U_Fix_Brok_B'],
  fixbrockbuyer: ['U_Fix_Brock_B', 'U_Fix_Brok_B'],
  fixbrokseller: ['U_Fix_Brock_S', 'U_Fix_Brok_S'],
  fixbrockseller: ['U_Fix_Brock_S', 'U_Fix_Brok_S'],
  packingtype: ['U_PackingType', 'packingType'],
  freightpurchase: ['freightPurchase'],
  freightsales: ['freightSales'],
  freightprovider: ['freightProvider'],
  freightprovidername: ['freightProviderName'],
  brokeragenumber: ['brokerageNumber'],
};

const SQL_LAYOUT_SYNTHETIC_MATRIX_KEYS = new Set([
  '__lineNumber',
  'itemNo',
  'itemDescription',
  'quantity',
  'uomName',
  'uomCode',
  'hsnCode',
  'unitPrice',
  'stdDiscount',
  'taxCode',
  'totalLC',
  'grossTotal',
  'whse',
  'binLocationAllocation',
  'priceAfterDiscount',
  'itemCost',
  'distRule',
  'cogsDistRule',
  'countryOfOrigin',
  'loc',
  'deliveredQty',
  'forRate',
  'sellerBrokerage',
  'buyerBrokerage',
  'buyerDelivery',
  'sellerDelivery',
  'buyerPaymentTerms',
  'sellerPaymentTerms',
  'buyerQuality',
  'sellerQuality',
  'buyerPrice',
  'sellerPrice',
  'buyerSpecialInstruction',
  'sellerSpecialInstruction',
  'sellerBrokerageAmtPer',
  'sellerBrokeragePercent',
  'stcode',
  'sellerItem',
  'sellerQty',
  'specialRebate',
  'commission',
  'sellerBrokeragePerQty',
  'price',
]);

const tokensForField = (field = {}) => [
  field.key,
  field.valueKey,
  field.rendererKey,
  field.fieldName,
  field.layoutFieldName,
  field.sapField,
  field.aliasId,
  field.label,
  field.description,
  field.Descr,
  field.columnTitle,
  field.columnUid,
].map(normalizeLayoutToken).filter(Boolean);

const tokensForPublishedColumn = (column = {}) => {
  const baseTokens = [column.key, column.label, column.name, column.fieldName]
    .map(normalizeLayoutToken)
    .filter(Boolean);
  const aliasTokens = baseTokens.flatMap((token) => SQL_LAYOUT_FIELD_ALIASES[token] || [])
    .map(normalizeLayoutToken)
    .filter(Boolean);
  return [...new Set([...baseTokens, ...aliasTokens])];
};

const indexEditableLayoutFields = (matrixFields = [], rowUdfFields = []) => {
  const index = new Map();
  const addField = (field, group) => {
    if (!field?.key) return;
    const entry = { key: field.key, group };
    const extraTokens = Object.entries(SQL_LAYOUT_FIELD_ALIASES)
      .filter(([, keys]) => keys.some((key) => normalizeLayoutToken(key) === normalizeLayoutToken(field.key)))
      .map(([token]) => token);
    [...tokensForField(field), ...extraTokens].forEach((token) => {
      if (!index.has(token)) index.set(token, []);
      index.get(token).push(entry);
    });
  };
  (matrixFields || []).forEach((field) => addField(field, 'matrixColumns'));
  const matrixUdfKeys = new Set((matrixFields || [])
    .flatMap((field) => [field.key, field.valueKey, field.fieldName, field.sapField])
    .filter((value) => /^U_/i.test(String(value || '').trim()))
    .map(normalizeLayoutToken));
  (rowUdfFields || []).forEach((field) => {
    if (!matrixUdfKeys.has(normalizeLayoutToken(field.key))) addField(field, 'rowUdfs');
  });
  // Service grids render only their real definitions, not synthetic item renderers.
  if (!matrixFields.some((field) => field.key === 'glAccount')) {
    SQL_LAYOUT_SYNTHETIC_MATRIX_KEYS.forEach((key) => addField({ key, label: key }, 'matrixColumns'));
  }
  return index;
};

const settingKeyForFieldMatch = (candidate = {}) => `${candidate.group}:${candidate.key}`;

const findPreferredFieldMatch = (fieldIndex, preferredKeys = [], usedKeys = new Set()) => {
  for (const preferredKey of preferredKeys || []) {
    const normalizedPreferredKey = normalizeLayoutToken(preferredKey);
    if (!normalizedPreferredKey) continue;
    const candidates = fieldIndex.get(normalizedPreferredKey) || [];
    const exactKeyMatch = candidates.find((candidate) => (
      normalizeLayoutToken(candidate.key) === normalizedPreferredKey
      && !usedKeys.has(settingKeyForFieldMatch(candidate))
    ));
    if (exactKeyMatch) return exactKeyMatch;

    const tokenMatch = candidates.find((candidate) => !usedKeys.has(settingKeyForFieldMatch(candidate)));
    if (tokenMatch) return tokenMatch;
  }
  return null;
};

export const applyPublishedQueryLayoutToSettings = (settings = {}, queryLayout = null, readArgs = []) => {
  if (!queryLayout?.isPublished || !Array.isArray(queryLayout.columns) || !queryLayout.columns.length) {
    return settings;
  }

  const rowUdfFields = Array.isArray(readArgs?.[1]) ? readArgs[1] : [];
  const matrixFields = Array.isArray(readArgs?.[2]) ? readArgs[2] : [];
  const fieldIndex = indexEditableLayoutFields(matrixFields, rowUdfFields);
  if (!fieldIndex.size) return settings;

  const selected = { matrixColumns: new Map(), rowUdfs: new Map() };
  const usedKeys = new Set();
  queryLayout.columns.forEach((column, index) => {
    // An explicit physical UDF identity must not be matched to SAP Price by caption.
    const physicalUdf = [column.fieldName, column.name, column.key]
      .find((value) => /^U_/i.test(String(value || '').trim()));
    if (physicalUdf) {
      const match = findPreferredFieldMatch(fieldIndex, [physicalUdf], usedKeys);
      if (match) {
        usedKeys.add(settingKeyForFieldMatch(match));
        selected[match.group].set(match.key, { order: index + 1 });
      }
      return;
    }
    for (const token of tokensForPublishedColumn(column)) {
      const preferredMatch = findPreferredFieldMatch(fieldIndex, SQL_LAYOUT_FIELD_ALIASES[token], usedKeys);
      const match = preferredMatch
        || (fieldIndex.get(token) || []).find((candidate) => !usedKeys.has(settingKeyForFieldMatch(candidate)));
      if (!match) continue;
      usedKeys.add(settingKeyForFieldMatch(match));
      selected[match.group].set(match.key, { order: index + 1 });
      break;
    }
  });

  if (!selected.matrixColumns.size && !selected.rowUdfs.size) return settings;

  const applyGroup = (groupKey) => {
    const currentGroup = settings?.[groupKey] || {};
    const nextGroup = Object.keys(currentGroup).reduce((next, key) => {
      if (groupKey === 'matrixColumns' && isLineNumberMatrixField({ key })) {
        next[key] = { ...currentGroup[key], visible: true, order: 0, companyQueryLayout: true };
        return next;
      }

      const selectedColumn = selected[groupKey].get(key);
      next[key] = selectedColumn
        ? { ...currentGroup[key], visible: true, order: selectedColumn.order, companyQueryLayout: true }
        : { ...currentGroup[key], visible: false, companyQueryLayout: true };
      return next;
    }, {});

    selected[groupKey].forEach((selectedColumn, key) => {
      if (nextGroup[key]) return;
      nextGroup[key] = { visible: true, order: selectedColumn.order, companyQueryLayout: true };
    });

    return nextGroup;
  };

  return {
    ...(settings || {}),
    matrixColumns: applyGroup('matrixColumns'),
    rowUdfs: applyGroup('rowUdfs'),
    __companyQueryLayout: {
      formKey: queryLayout.formKey,
      version: queryLayout.version,
      isPublished: true,
      mode: 'editable-layout',
    },
  };
};

export const useCompanyScopedFormSettings = (
  baseStorageKey,
  readSavedFormSettings,
  readArgs = [],
  options = {},
) => {
  const { company, user } = useAuth();
  const saveMode = options?.saveMode === 'explicit' ? 'explicit' : 'auto';
  const followPublishedVersion = options?.followPublishedVersion === true;
  const selectedCompanyId = company?.companyId;
  const selectedUserId = user?.userId ?? user?.UserId;
  const storageKey = useMemo(
    () => buildCompanyScopedFormSettingsKey(baseStorageKey, company, user),
    [
      baseStorageKey,
      company?.companyId,
      company?.dbName,
      company?.serverName,
      user?.userId,
      user?.UserId,
      user?.username,
      user?.Username,
    ],
  );

  // Document pages obtain their live schema asynchronously. Always resolve
  // persisted preferences with the latest schema, rather than with the empty
  // schema that existed when a company-switch request started.
  const readArgsRef = useRef(readArgs);
  readArgsRef.current = readArgs;
  const hasLocalChangesRef = useRef(false);
  // A published SQL Content layout is a company default, not a permanent
  // lock. Track whether this user has a draft or a saved override separately
  // so an edit can start from that default and then take ownership of it.
  const hasUserOverrideRef = useRef(false);
  const hasSavedUserSettingsRef = useRef(false);
  const stateRef = useRef(null);
  const saveRequestRef = useRef(0);

  const readSettings = useCallback(
    (key = storageKey) => {
      const settings = readSavedFormSettings(...readArgsRef.current, key);
      // Page-specific schema reconcilers may intentionally drop unknown groups.
      // Keep publication provenance separate from their physical field allowlist.
      if (followPublishedVersion && typeof window !== 'undefined') {
        try {
          const saved = JSON.parse(window.localStorage.getItem(key) || '{}');
          if (saved?.__companyQueryLayout) return { ...settings, __companyQueryLayout: saved.__companyQueryLayout };
        } catch (_error) { /* Invalid preferences fall back to the current schema. */ }
      }
      return settings;
    },
    [followPublishedVersion, readSavedFormSettings, storageKey],
  );

  const [state, setState] = useState(() => ({
    storageKey,
    settings: readSettings(storageKey),
    loaded: false,
    saveVersion: 0,
    savedVersion: 0,
  }));
  stateRef.current = state;
  const activeStorageKeyRef = useRef(storageKey);
  activeStorageKeyRef.current = storageKey;
  const [persistence, setPersistence] = useState({
    saving: false,
    error: '',
  });
  const [queryLayout, setQueryLayout] = useState(null);
  const [hasUserOverride, setHasUserOverride] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    hasLocalChangesRef.current = false;
    hasUserOverrideRef.current = false;
    hasSavedUserSettingsRef.current = false;
    saveRequestRef.current += 1;

    setState({
      storageKey,
      settings: readSettings(storageKey),
      loaded: false,
      saveVersion: 0,
      savedVersion: 0,
    });
    setPersistence({ saving: false, error: '' });
    setQueryLayout(null);
    setHasUserOverride(false);

    fetchFormSettings(baseStorageKey)
      .then((payload) => {
        if (isCancelled || activeStorageKeyRef.current !== storageKey) return;
        if (!isFormSettingsPayloadForScope(
          payload,
          { companyId: selectedCompanyId },
          { userId: selectedUserId },
        )) {
          throw new Error('Ignored Form Settings returned for a different user or company.');
        }

        const backendSettings = payload?.settings;
        setQueryLayout(payload?.queryLayout?.isPublished ? payload.queryLayout : null);
        const hasBackendSettings =
          backendSettings && typeof backendSettings === 'object' && !Array.isArray(backendSettings)
          && Object.values(backendSettings).some((group) => group && typeof group === 'object'
            && !Array.isArray(group) && Object.keys(group).length > 0);

        // A saved per-user setting must always win over the company SQL
        // layout. Until then, the published layout is the starting default.
        if (!hasLocalChangesRef.current) {
          const layout = payload?.queryLayout;
          const marker = backendSettings?.__companyQueryLayout;
          const useOverride = hasBackendSettings && (!followPublishedVersion || !layout?.isPublished
            || (marker?.formKey === layout.formKey && Number(marker?.version) === Number(layout.version)));
          hasSavedUserSettingsRef.current = useOverride;
          hasUserOverrideRef.current = useOverride;
          setHasUserOverride(useOverride);
        }

        setState((previous) => {
          if (previous.storageKey !== storageKey) {
            return previous;
          }

          // An explicit web-form edit made while the request was in flight
          // must not be overwritten. A schema replacement does not mark this
          // flag, so the selected company's saved header/UDF preferences still
          // load after the live SAP layout is available.
          if (previous.saveVersion > 0 || hasLocalChangesRef.current) {
            return {
              ...previous,
              loaded: true,
            };
          }

          if (typeof window !== 'undefined' && window.localStorage) {
            if (hasBackendSettings) {
              window.localStorage.setItem(storageKey, JSON.stringify(backendSettings));
            } else {
              window.localStorage.removeItem(storageKey);
            }
          }

          return {
            storageKey,
            settings: readSettings(storageKey),
            loaded: true,
            saveVersion: 0,
            savedVersion: 0,
          };
        });
      })
      .catch((error) => {
        if (isCancelled || activeStorageKeyRef.current !== storageKey) return;
        console.warn('[FORM_SETTINGS] Unable to load backend settings:', error?.message || error);
        setQueryLayout(null);
        // Keep cached user preferences as an offline fallback only.
        const hasCachedSettings = typeof window !== 'undefined' && Boolean(window.localStorage?.getItem(storageKey));
        hasSavedUserSettingsRef.current = hasCachedSettings;
        if (!hasLocalChangesRef.current) {
          hasUserOverrideRef.current = hasCachedSettings;
          setHasUserOverride(hasCachedSettings);
        }
        setState((previous) => (
          previous.storageKey === storageKey
            ? { ...previous, loaded: true }
            : previous
        ));
      });

    return () => {
      isCancelled = true;
      saveRequestRef.current += 1;
    };
  }, [baseStorageKey, followPublishedVersion, readSettings, selectedCompanyId, selectedUserId, storageKey]);

  // Metadata and persisted settings load independently. Re-read the raw saved
  // preferences with the latest schema, including fields absent at first load.
  // This is hydration only: it must not create an override or schedule a save.
  useEffect(() => {
    if (!readArgsRef.current.length || state.storageKey !== storageKey || !state.loaded) return;
    const schemaSettings = readSettings(storageKey);
    setState((previous) => {
      if (previous.storageKey !== storageKey) return previous;
      const settings = hasLocalChangesRef.current
        ? mergeSavedFormSettings(schemaSettings, previous.settings)
        : schemaSettings;
      return areSettingsEqual(previous.settings, settings) ? previous : { ...previous, settings };
    });
  }, [readArgs[0], readArgs[1], readArgs[2], readSettings, state.loaded, state.storageKey, storageKey]);

  useEffect(() => {
    if (state.storageKey !== storageKey || typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    // Explicit mode keeps edits as a draft in component state. Do not let a
    // company switch or page close make an unsaved visibility choice appear
    // persisted in the browser cache.
    if (saveMode !== 'explicit' && state.loaded && state.saveVersion > 0) {
      window.localStorage.setItem(storageKey, JSON.stringify(state.settings));
    }

    if (saveMode === 'explicit' || !state.loaded || state.saveVersion <= state.savedVersion) return;

    const saveTimer = window.setTimeout(() => {
      const requestId = saveRequestRef.current + 1;
      const requestedVersion = state.saveVersion;
      saveRequestRef.current = requestId;
      setPersistence({ saving: true, error: '' });
      saveFormSettings(baseStorageKey, state.settings)
        .then((payload) => {
          if (activeStorageKeyRef.current !== storageKey || saveRequestRef.current !== requestId) return;
          if (!isFormSettingsPayloadForScope(
            payload,
            { companyId: selectedCompanyId },
            { userId: selectedUserId },
          )) {
            throw new Error('Ignored Form Settings save response for a different user or company.');
          }
          setState((previous) => (
            previous.storageKey === storageKey
              ? { ...previous, savedVersion: Math.max(previous.savedVersion || 0, requestedVersion) }
              : previous
          ));
          hasSavedUserSettingsRef.current = true;
          hasUserOverrideRef.current = true;
          setHasUserOverride(true);
          if (activeStorageKeyRef.current === storageKey && saveRequestRef.current === requestId) {
            setPersistence({ saving: false, error: '' });
          }
        })
        .catch((error) => {
          console.warn('[FORM_SETTINGS] Unable to save backend settings:', error?.message || error);
          if (activeStorageKeyRef.current === storageKey && saveRequestRef.current === requestId) {
            setPersistence({ saving: false, error: error?.message || 'Unable to save Form Settings.' });
          }
        });
    }, 250);

    return () => window.clearTimeout(saveTimer);
  }, [
    baseStorageKey,
    saveMode,
    selectedCompanyId,
    selectedUserId,
    state.loaded,
    state.savedVersion,
    state.saveVersion,
    state.settings,
    state.storageKey,
    storageKey,
  ]);

  const setScopedFormSettings = useCallback(
    (nextSettings) => {
      // Copy the effective company layout into this user's draft on the first
      // edit. Subsequent edits (and saved settings) use the user's own copy.
      const shouldSeedCompanyDefault = !hasUserOverrideRef.current;
      setState((previous) => {
        const isCurrentScope = previous.storageKey === storageKey;
        const currentSettings =
          isCurrentScope ? previous.settings : readSettings(storageKey);
        const editableSettings = shouldSeedCompanyDefault
          ? applyPublishedQueryLayoutToSettings(currentSettings, queryLayout, readArgsRef.current)
          : currentSettings;
        const resolvedSettings =
          typeof nextSettings === 'function' ? nextSettings(editableSettings) : nextSettings;
        const didChange = !areSettingsEqual(editableSettings, resolvedSettings);

        if (isCurrentScope && !didChange) {
          return previous;
        }

        if (didChange) {
          hasLocalChangesRef.current = true;
          hasUserOverrideRef.current = true;
          setHasUserOverride(true);
        }
        const ownedSettings = didChange && followPublishedVersion && queryLayout?.isPublished
          ? {
            ...resolvedSettings,
            __companyQueryLayout: {
              formKey: queryLayout.formKey || baseStorageKey,
              version: queryLayout.version,
              isPublished: true,
              mode: 'user-override',
            },
          }
          : resolvedSettings;
        return {
          storageKey,
          settings: ownedSettings,
          loaded: isCurrentScope ? previous.loaded : false,
          saveVersion: didChange ? (isCurrentScope ? (previous.saveVersion || 0) + 1 : 1) : previous.saveVersion,
          savedVersion: isCurrentScope ? (previous.savedVersion || 0) : 0,
        };
      });
    },
    [baseStorageKey, followPublishedVersion, queryLayout, readSettings, storageKey],
  );

  const replaceScopedFormSettings = useCallback(
    (nextSettings) => {
      setState((previous) => {
        const isCurrentScope = previous.storageKey === storageKey;
        const currentSettings = isCurrentScope ? previous.settings : readSettings(storageKey);
        const schemaSettings =
          typeof nextSettings === 'function' ? nextSettings(currentSettings) : nextSettings;
        const resolvedSettings = isCurrentScope && hasLocalChangesRef.current
          ? mergeSavedFormSettings(schemaSettings, currentSettings)
          : schemaSettings;
        if (followPublishedVersion && currentSettings?.__companyQueryLayout) {
          resolvedSettings.__companyQueryLayout = currentSettings.__companyQueryLayout;
        }

        if (isCurrentScope && !areSettingsEqual(currentSettings, resolvedSettings)) {
          return {
            ...previous,
            settings: resolvedSettings,
          };
        }

        if (isCurrentScope) return previous;

        return {
          storageKey,
          settings: resolvedSettings,
          loaded: false,
          saveVersion: 0,
          savedVersion: 0,
        };
      });
    },
    [followPublishedVersion, readSettings, storageKey],
  );

  const saveScopedFormSettings = useCallback(async () => {
    const current = stateRef.current;
    if (!current || current.storageKey !== storageKey || !current.loaded) return false;
    if ((current.saveVersion || 0) <= (current.savedVersion || 0)) return true;

    const requestId = saveRequestRef.current + 1;
    const requestedVersion = current.saveVersion || 0;
    saveRequestRef.current = requestId;
    setPersistence({ saving: true, error: '' });

    try {
      const payload = await saveFormSettings(baseStorageKey, current.settings);
      if (activeStorageKeyRef.current !== storageKey || saveRequestRef.current !== requestId) return false;
      if (!isFormSettingsPayloadForScope(
        payload,
        { companyId: selectedCompanyId },
        { userId: selectedUserId },
      )) {
        throw new Error('Ignored Form Settings save response for a different user or company.');
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(storageKey, JSON.stringify(current.settings));
      }
      setState((previous) => (
        previous.storageKey === storageKey
          ? { ...previous, savedVersion: Math.max(previous.savedVersion || 0, requestedVersion) }
          : previous
      ));
      hasSavedUserSettingsRef.current = true;
      hasUserOverrideRef.current = true;
      setHasUserOverride(true);
      if (activeStorageKeyRef.current === storageKey && saveRequestRef.current === requestId) {
        setPersistence({ saving: false, error: '' });
      }
      return true;
    } catch (error) {
      console.warn('[FORM_SETTINGS] Unable to save backend settings:', error?.message || error);
      if (activeStorageKeyRef.current === storageKey && saveRequestRef.current === requestId) {
        setPersistence({ saving: false, error: error?.message || 'Unable to save Form Settings.' });
      }
      return false;
    }
  }, [baseStorageKey, selectedCompanyId, selectedUserId, storageKey]);

  const discardScopedFormSettings = useCallback(() => {
    saveRequestRef.current += 1;
    hasLocalChangesRef.current = false;
    const restoreSavedUserSettings = hasSavedUserSettingsRef.current;
    hasUserOverrideRef.current = restoreSavedUserSettings;
    setHasUserOverride(restoreSavedUserSettings);
    setPersistence({ saving: false, error: '' });
    setState((previous) => {
      if (previous.storageKey !== storageKey) return previous;
      return {
        ...previous,
        settings: readSettings(storageKey),
        saveVersion: previous.savedVersion || 0,
      };
    });
    return true;
  }, [readSettings, storageKey]);

  const reorderScopedFormSettings = useCallback((orderedFields) => {
    setScopedFormSettings((previous) => reorderFormSettingPreferences(previous, orderedFields));
  }, [setScopedFormSettings]);

  const isCurrentScope = state.storageKey === storageKey;
  const formSettingsStatus = {
    loaded: isCurrentScope && state.loaded,
    loading: !isCurrentScope || !state.loaded,
    saving: persistence.saving,
    error: persistence.error,
    hasUnsavedChanges: isCurrentScope && state.saveVersion > state.savedVersion,
    saveMode,
    save: saveScopedFormSettings,
    discard: discardScopedFormSettings,
    reorder: reorderScopedFormSettings,
    scopeLabel: [
      normalizeScopePart(user?.username || user?.Username || selectedUserId),
      normalizeScopePart(company?.dbName || company?.companyName || company?.name || selectedCompanyId),
    ].filter(Boolean).join(' / '),
    queryModeActive: false,
    companyQueryLayoutActive: Boolean(queryLayout?.isPublished && !hasUserOverride),
    queryLayout,
  };

  const scopedSettings = isCurrentScope ? state.settings : readSettings(storageKey);
  const effectiveSettings = hasUserOverride
    ? scopedSettings
    : applyPublishedQueryLayoutToSettings(scopedSettings, queryLayout, readArgsRef.current);

  return [
    effectiveSettings,
    setScopedFormSettings,
    storageKey,
    replaceScopedFormSettings,
    formSettingsStatus,
  ];
};
