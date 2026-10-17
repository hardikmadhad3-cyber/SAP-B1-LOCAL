import apiClient from "./client";

const BASE = "/tax-codes";
const enc = encodeURIComponent;

// Tax codes (OSTC + rows STC1)
export const createTaxCode  = (data)       => apiClient.post(`${BASE}/create`, data).then((r) => r.data);
export const getTaxCode     = (code)       => apiClient.get(`${BASE}/${enc(code)}`).then((r) => r.data);
export const updateTaxCode  = (code, data) => apiClient.patch(`${BASE}/${enc(code)}`, data).then((r) => r.data);
export const searchTaxCodes = (query = "", category = "", top = 50, skip = 0) =>
  apiClient.get(`${BASE}/search`, { params: { query, category, top, skip } }).then((r) => r.data);
export const listSetupTaxCodes = (query = "") =>
  apiClient.get(`${BASE}/setup/codes`, { params: { query } }).then((r) => r.data);

// Tax components (SAP tax authorities, OSTA) and tax types (OSTT)
export const listTaxTypes       = ()           => apiClient.get(`${BASE}/types`).then((r) => r.data);
export const listTaxComponents  = (query = "") => apiClient.get(`${BASE}/components`, { params: { query } }).then((r) => r.data);
export const getTaxComponent    = (code)       => apiClient.get(`${BASE}/components/${enc(code)}`).then((r) => r.data);
export const createTaxComponent = (data)       => apiClient.post(`${BASE}/components/create`, data).then((r) => r.data);
export const updateTaxComponent = (code, data) => apiClient.patch(`${BASE}/components/${enc(code)}`, data).then((r) => r.data);

export const fetchTaxGLAccounts = (query = "") =>
  apiClient.get(`${BASE}/lookup/gl-accounts`, { params: { query } }).then((r) => r.data);
