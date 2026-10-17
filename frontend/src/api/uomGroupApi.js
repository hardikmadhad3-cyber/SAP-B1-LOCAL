import apiClient from "./client";

const BASE = "/uom-groups";

export const createUoMGroup  = (data)                => apiClient.post(`${BASE}/create`, data).then((r) => r.data);
export const getUoMGroup     = (absEntry)            => apiClient.get(`${BASE}/${encodeURIComponent(absEntry)}`).then((r) => r.data);
export const updateUoMGroup  = (absEntry, data)      => apiClient.patch(`${BASE}/${encodeURIComponent(absEntry)}`, data).then((r) => r.data);
export const searchUoMGroups = (query = "", top = 50, skip = 0) =>
  apiClient.get(`${BASE}/search`, { params: { query, top, skip } }).then((r) => r.data);

export const fetchUoMs = (query = "") =>
  apiClient.get(`${BASE}/lookup/uoms`, { params: { query } }).then((r) => r.data);

// Units of measure (SAP: Units of Measure setup, OUOM)
export const createUoM = (data) => apiClient.post(`${BASE}/uoms/create`, data).then((r) => r.data);
