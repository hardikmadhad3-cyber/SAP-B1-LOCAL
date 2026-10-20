import apiClient from './client';

export const fetchReceiptReferenceData = (params = {}) =>
  apiClient.get('/receipt-from-production/reference-data', { params }).then((r) => r.data);
export const fetchReceiptSeries = (date, branch = '') =>
  apiClient.get('/receipt-from-production/series', { params: { date, branch } }).then((r) => r.data);
export const fetchReceiptAllocationOptions = (itemCode, warehouse) =>
  apiClient.get('/receipt-from-production/allocation-options', { params: { itemCode, warehouse } }).then((r) => r.data);

export const fetchProductionOrderForReceipt = (docEntry) =>
  apiClient.get(`/receipt-from-production/production-order/${encodeURIComponent(docEntry)}`).then((r) => r.data);

export const fetchReceiptList = (params = {}) =>
  apiClient.get('/receipt-from-production/list', { params }).then((r) => r.data);

export const fetchReceiptByDocEntry = (docEntry) =>
  apiClient.get(`/receipt-from-production/${encodeURIComponent(docEntry)}`).then((r) => r.data);

export const createReceipt = (data) =>
  apiClient.post('/receipt-from-production', data).then((r) => r.data);

export const lookupProductionOrdersForReceipt = (query = '', type = '') =>
  apiClient.get('/receipt-from-production/lookup/production-orders', { params: { query, type } }).then((r) => r.data);

export const cancelReceipt = (docEntry) =>
  apiClient.post(`/receipt-from-production/${encodeURIComponent(docEntry)}/cancel`).then((r) => r.data);

export const navigateReceipt = (direction, from = '') =>
  apiClient.get('/receipt-from-production/navigate', { params: { direction, from } }).then((r) => r.data);
