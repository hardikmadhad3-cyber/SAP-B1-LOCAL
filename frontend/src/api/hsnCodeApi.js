import apiClient from './client';

/**
 * Get all HSN Codes from SAP B1 via ODBC
 * @param {string} query - Optional search query
 * @returns {Promise} Array of HSN codes
 */
export const fetchHSNCodes = async (query = '') => {
  const params = query ? { query } : {};
  return apiClient.get('/hsn-codes', { params });
};

/**
 * Get all SAC service codes from SAP B1 via ODBC
 * @param {string} query - Optional search query
 * @returns {Promise} Array of SAC service codes
 */
export const fetchSACCodes = async (query = '') => {
  const params = query ? { query } : {};
  return apiClient.get('/hsn-codes/sac', { params });
};

/**
 * Get single HSN Code by ChapterID via ODBC
 * @param {string} code - HSN Code (ChapterID)
 * @returns {Promise} HSN code details
 */
export const fetchHSNCode = async (code) => {
  return apiClient.get(`/hsn-codes/${code}`);
};

/**
 * Get HSN Code from Item Master via ODBC
 * @param {string} itemCode - Item Code
 * @returns {Promise} HSN code from item
 */
export const fetchHSNCodeFromItem = async (itemCode) => {
  return apiClient.get(`/hsn-codes/item/${itemCode}`);
};

// Maintenance (HSN = SAP India Chapter ID / OCHP, SAC = OSAC); ids are internal keys.
export const createHSNCode = (data) => apiClient.post('/hsn-codes/create', data).then((r) => r.data);
export const updateHSNCode = (absEntry, data) => apiClient.patch(`/hsn-codes/entry/${absEntry}`, data).then((r) => r.data);
export const createSACCode = (data) => apiClient.post('/hsn-codes/sac/create', data).then((r) => r.data);
export const updateSACCode = (absEntry, data) => apiClient.patch(`/hsn-codes/sac/${absEntry}`, data).then((r) => r.data);
