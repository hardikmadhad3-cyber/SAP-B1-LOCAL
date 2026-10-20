import apiClient from './client';

export const fetchProductionOrderReferenceData = (params = {}) =>
  apiClient.get('/production-order/reference-data', { params }).then((r) => r.data);
export const fetchProductionOrderSeries = (date, branch = '') =>
  apiClient.get('/production-order/series', { params: { date, branch } }).then((r) => r.data);

export const fetchProductionOrders = (params = {}) =>
  apiClient.get('/production-order/list', { params }).then((r) => r.data);

export const fetchProductionOrderByDocEntry = (docEntry) =>
  apiClient.get(`/production-order/${encodeURIComponent(docEntry)}`).then((r) => r.data);

export const createProductionOrder = (data) =>
  apiClient.post('/production-order', data).then((r) => r.data);

export const updateProductionOrder = (docEntry, data) =>
  apiClient.patch(`/production-order/${encodeURIComponent(docEntry)}`, data).then((r) => r.data);

export const releaseProductionOrder = (docEntry) =>
  apiClient.post(`/production-order/${encodeURIComponent(docEntry)}/release`).then((r) => r.data);

export const closeProductionOrder = (docEntry, closingDate) =>
  apiClient.post(`/production-order/${encodeURIComponent(docEntry)}/close`, { closing_date: closingDate }).then((r) => r.data);

export const cancelProductionOrder = (docEntry) =>
  apiClient.post(`/production-order/${encodeURIComponent(docEntry)}/cancel`).then((r) => r.data);

// SAP record browsing: direction = first | prev | next | last, from = current DocEntry.
export const navigateProductionOrder = (direction, from = '') =>
  apiClient.get('/production-order/navigate', { params: { direction, from } }).then((r) => r.data);

const attachmentsUrl = (docEntry) => `/production-order/${encodeURIComponent(docEntry)}/attachments`;
export const fetchProductionOrderAttachments = (docEntry) =>
  apiClient.get(attachmentsUrl(docEntry)).then((r) => r.data);
export const uploadProductionOrderAttachment = (docEntry, file) => {
  const body = new FormData();
  body.append('file', file);
  return apiClient.post(attachmentsUrl(docEntry), body, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
};
export const deleteProductionOrderAttachment = (docEntry, id) =>
  apiClient.delete(`${attachmentsUrl(docEntry)}/${encodeURIComponent(id)}`).then((r) => r.data);
// Through the API client (it carries the login token); a plain link would not.
export const downloadProductionOrderAttachment = (docEntry, id) =>
  apiClient.get(`${attachmentsUrl(docEntry)}/${encodeURIComponent(id)}`, { responseType: 'blob' }).then((r) => r.data);

export const explodeBOM = (itemCode, qty = 1) =>
  apiClient.get(`/production-order/bom-explode/${encodeURIComponent(itemCode)}`, { params: { qty } }).then((r) => r.data);

// Lookups
export const fetchProdOrderItems = (query = '') =>
  apiClient.get('/production-order/lookup/items', { params: { query } }).then((r) => r.data);

export const fetchProdOrderFinishItems = (query = '') =>
  apiClient.get('/production-order/lookup/finish-items', { params: { query } }).then((r) => r.data);

export const fetchProdOrderComponentItems = (query = '') =>
  apiClient.get('/production-order/lookup/component-items', { params: { query } }).then((r) => r.data);

export const fetchProdOrderResources = (query = '') =>
  apiClient.get('/production-order/lookup/resources', { params: { query, top: 500 } }).then((r) => r.data);

export const fetchProdOrderRouteStages = (query = '') =>
  apiClient.get('/production-order/lookup/route-stages', { params: { query } }).then((r) => r.data);

export const fetchProdOrderWarehouses = () =>
  apiClient.get('/production-order/lookup/warehouses').then((r) => r.data);

export const fetchProdOrderDistributionRules = () =>
  apiClient.get('/production-order/lookup/distribution-rules').then((r) => r.data);

export const fetchProdOrderProjects = () =>
  apiClient.get('/production-order/lookup/projects').then((r) => r.data);

export const fetchProdOrderBranches = () =>
  apiClient.get('/production-order/lookup/branches').then((r) => r.data);

export const fetchProdOrderCustomers = (query = '') =>
  apiClient.get('/production-order/lookup/customers', { params: { query } }).then((r) => r.data);

export const fetchProdOrderUsers = () =>
  apiClient.get('/production-order/lookup/users', { params: { _: Date.now() } }).then((r) => r.data);

export const fetchProdOrderLinkedOrders = (linkedTo = '', query = '') =>
  apiClient.get('/production-order/lookup/linked-orders', { params: { linkedTo, query } }).then((r) => r.data);
