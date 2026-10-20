import apiClient from './client';

export const fetchIssueReferenceData = (params = {}) =>
  apiClient.get('/issue-for-production/reference-data', { params }).then((r) => r.data);
export const fetchIssueSeries = (date, branch = '') =>
  apiClient.get('/issue-for-production/series', { params: { date, branch } }).then((r) => r.data);
export const fetchIssueAllocationOptions = (itemCode, warehouse) =>
  apiClient.get('/issue-for-production/allocation-options', { params: { itemCode, warehouse } }).then((r) => r.data);

export const fetchProductionOrderForIssue = (docEntry) =>
  apiClient.get(`/issue-for-production/production-order/${encodeURIComponent(docEntry)}`).then((r) => r.data);

export const fetchIssueList = (params = {}) =>
  apiClient.get('/issue-for-production/list', { params }).then((r) => r.data);

export const fetchIssueByDocEntry = (docEntry) =>
  apiClient.get(`/issue-for-production/${encodeURIComponent(docEntry)}`).then((r) => r.data);

export const createIssue = (data) =>
  apiClient.post('/issue-for-production', data).then((r) => r.data);

export const lookupProductionOrders = (query = '', type = '') =>
  apiClient.get('/issue-for-production/lookup/production-orders', { params: { query, type } }).then((r) => r.data);

export const cancelIssue = (docEntry) =>
  apiClient.post(`/issue-for-production/${encodeURIComponent(docEntry)}/cancel`).then((r) => r.data);

export const navigateIssue = (direction, from = '') =>
  apiClient.get('/issue-for-production/navigate', { params: { direction, from } }).then((r) => r.data);
