import apiClient from './client';

export const fetchReportMenus = () =>
  apiClient.get('/report-menus').then((response) => response.data);

export const fetchAuthorizedReportCodes = (query = '') =>
  apiClient.get('/report-codes', { params: { query } }).then((response) => response.data);

export const fetchReportCodeParameters = (reportCode) =>
  apiClient.get(`/report-codes/${encodeURIComponent(reportCode)}/parameters`).then((response) => response.data);

export const createReportMenu = (payload) =>
  apiClient.post('/report-menus', payload).then((response) => response.data);

export const createReport = (payload) =>
  apiClient.post('/reports', payload).then((response) => response.data);

export const addReportParameter = (payload) =>
  apiClient.post('/report-parameters', payload).then((response) => response.data);

export const fetchReportDetail = (reportId) =>
  apiClient.get(`/reports/${reportId}`).then((response) => response.data);

export const runReport = (payload) =>
  apiClient.post('/reports/run', payload).then((response) => response.data);

const normalizeReportLookupResponse = (table, columns, items) => ({
  table,
  columns,
  items: Array.isArray(items) ? items : [],
});

const normalizeBusinessPartnerLookupRows = (rows = [], typeLabel = '') =>
  (rows || []).map((row) => ({
    ...row,
    CardTypeLabel: typeLabel || normalizeBusinessPartnerTypeLabel(row.CardType),
    Balance: Number(row.Balance || 0).toFixed(2),
    Country: row.Country || '',
    Active: row.Active || '',
    Inactive: row.Inactive || '',
    BillToBlock: row.BillToBlock || '',
    BillToBuildingFloorRoom: row.BillToBuildingFloorRoom || '',
    GTSRegistrationNumber: row.GTSRegistrationNumber || '',
    VendorTypeId: row.VendorTypeId || '',
    VendorOccupation: row.VendorOccupation || '',
  }));

const normalizeBusinessPartnerTypeLabel = (cardType) => {
  const value = String(cardType || '').trim().toLowerCase();
  if (value === 'ccustomer' || value === 'c') return 'Customer';
  if (value === 'csupplier' || value === 's') return 'Vendor';
  if (value === 'clead' || value === 'l') return 'Lead';
  return cardType || '';
};

export const fetchReportParameterLookupOptions = async (lookup, query = '', { skip = 0, top = 100 } = {}) => {
  const table = String(lookup?.table || '').trim().toUpperCase();

  if (table === 'OITM') {
    const items = await apiClient
      .get('/items/search', { params: { query, top, skip } })
      .then((response) => response.data);

    return normalizeReportLookupResponse(table, lookup?.columns || [], items);
  }

  if (table === 'OCRD_CUSTOMERS') {
    const items = await apiClient
      .get('/lookups/customers', { params: { query, top, skip } })
      .then((response) => normalizeBusinessPartnerLookupRows(response.data, 'Customer'));

    return normalizeReportLookupResponse(table, lookup?.columns || [], items);
  }

  if (table === 'OCRD_SUPPLIERS') {
    const items = await apiClient
      .get('/business-partners/search', { params: { query, type: 'cSupplier', top, skip } })
      .then((response) => normalizeBusinessPartnerLookupRows(response.data, 'Vendor'));

    return normalizeReportLookupResponse(table, lookup?.columns || [], items);
  }

  if (table === 'OCRD') {
    const items = await apiClient
      .get('/business-partners/search', { params: { query, top, skip } })
      .then((response) => normalizeBusinessPartnerLookupRows(response.data));

    return normalizeReportLookupResponse(table, lookup?.columns || [], items);
  }

  return apiClient.get('/lookups/report-parameters/options', {
    params: {
      table: lookup?.table,
      query,
    },
  }).then((response) => response.data);
};
