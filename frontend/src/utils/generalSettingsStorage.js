import {
  buildActiveCompanyScopedSessionKey,
  buildCompanyScopedSessionKey,
} from './companyStorageScope';
import { getAuthSession } from '../auth/storage';

export const GENERAL_SETTINGS_STORAGE_KEY = 'sapb1.generalSettings.v1';

const EMPTY_GENERAL_SETTINGS = {
  salesWarehouse: '',
  deliveryWarehouse: '',
  salesSeries: '',
  deliverySeries: '',
  salesQuotationWarehouse: '',
  salesQuotationSeries: '',
  arInvoiceWarehouse: '',
  arInvoiceSeries: '',
  arCreditMemoWarehouse: '',
  arCreditMemoSeries: '',
  purchaseRequestWarehouse: '',
  purchaseRequestSeries: '',
  purchaseQuotationWarehouse: '',
  purchaseQuotationSeries: '',
  purchaseOrderWarehouse: '',
  purchaseOrderSeries: '',
  grpoWarehouse: '',
  grpoSeries: '',
  apInvoiceWarehouse: '',
  apInvoiceSeries: '',
  apCreditMemoWarehouse: '',
  apCreditMemoSeries: '',
};

const normalizeSettings = (settings = {}) => ({
  ...Object.keys(EMPTY_GENERAL_SETTINGS).reduce((acc, key) => ({
    ...acc,
    [key]: String(settings[key] || '').trim(),
  }), {}),
});

const getStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const normalizeScopePart = (value) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

const decodeJwtPayload = (token = '') => {
  const payload = String(token || '').split('.')[1];
  if (!payload) return {};

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(window.atob(padded));
  } catch {
    return {};
  }
};

const getUserIdentityValue = (source = {}) =>
  source.userId ??
  source.UserId ??
  source.UserID ??
  source.id ??
  source.Id ??
  source.username ??
  source.userName ??
  source.UserName ??
  source.loginName ??
  source.LoginName ??
  source.email ??
  source.Email ??
  source.name ??
  source.Name ??
  source.sub ??
  source.preferred_username ??
  '';

const getActiveUserStorageScope = () => {
  const session = getAuthSession?.() || {};
  const tokenClaims = decodeJwtPayload(session.token || session.accessToken || session.access_token);
  const identitySources = [
    session.user,
    session.currentUser,
    session.loginUser,
    session.userProfile,
    session.profile,
    session.account,
    session.login,
    session,
    tokenClaims,
  ];
  const userValue = identitySources
    .map((source) => getUserIdentityValue(source || {}))
    .find((value) => normalizeScopePart(value));

  return encodeURIComponent(normalizeScopePart(userValue) || 'unknown-user');
};

const buildGeneralSettingsStorageKey = (companyOrScope) => {
  const companyKey = companyOrScope
    ? buildCompanyScopedSessionKey(GENERAL_SETTINGS_STORAGE_KEY, companyOrScope)
    : buildActiveCompanyScopedSessionKey(GENERAL_SETTINGS_STORAGE_KEY);

  return `${companyKey}::user:${getActiveUserStorageScope()}`;
};

export const readGeneralSettings = (companyOrScope) => {
  const session = getAuthSession?.();
  if (session?.token) {
    return normalizeSettings(session.generalSettings || {});
  }

  const storage = getStorage();
  if (!storage) return EMPTY_GENERAL_SETTINGS;

  const key = buildGeneralSettingsStorageKey(companyOrScope);
  const legacyCompanyKey = companyOrScope
    ? buildCompanyScopedSessionKey(GENERAL_SETTINGS_STORAGE_KEY, companyOrScope)
    : buildActiveCompanyScopedSessionKey(GENERAL_SETTINGS_STORAGE_KEY);

  try {
    const saved = storage.getItem(key);
    if (saved) return normalizeSettings(JSON.parse(saved));

    return normalizeSettings(JSON.parse(storage.getItem(legacyCompanyKey) || '{}'));
  } catch {
    return EMPTY_GENERAL_SETTINGS;
  }
};

export const saveGeneralSettings = (settings = {}, companyOrScope) => {
  const storage = getStorage();
  const normalized = normalizeSettings(settings);
  if (!storage) return normalized;

  const key = buildGeneralSettingsStorageKey(companyOrScope);

  storage.setItem(key, JSON.stringify(normalized));
  return normalized;
};
