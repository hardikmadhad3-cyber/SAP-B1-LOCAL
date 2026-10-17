import apiClient from './client';

// SAP Data > Cancel / Data > Close for a saved document (type = page key, e.g. 'ar-invoice').
export const runDocumentAction = (type, docEntry, action) =>
  apiClient.post(`/documents/${type}/${encodeURIComponent(docEntry)}/${action}`).then((r) => r.data);
