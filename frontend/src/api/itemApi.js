import apiClient from "./client";

export const createItem = (data) =>
  apiClient.post("/items/create", data).then((r) => r.data);

export const generateItemCode = (prefix) =>
  apiClient.get("/items/generate-code", { params: { prefix } }).then((r) => r.data);

export const checkItemCodeExists = (itemCode) =>
  apiClient.get(`/items/check-exists/${encodeURIComponent(itemCode)}`).then((r) => r.data);

export const fetchRecentItemCodes = (query = "") => {
  console.log('[API] Fetching recent item codes, query:', query);
  return apiClient.get("/items/recent-codes", { params: query ? { query } : {} })
    .then((r) => {
      console.log('[API] Recent item codes response:', r.data);
      return r.data;
    })
    .catch((err) => {
      console.error('[API] Failed to fetch recent item codes:', err);
      throw err;
    });
};

export const getItem = (itemCode) =>
  apiClient.get(`/items/${encodeURIComponent(itemCode)}`).then((r) => r.data);

export const updateItem = (itemCode, data) =>
  apiClient.patch(`/items/${encodeURIComponent(itemCode)}`, data).then((r) => r.data);

export const searchItems = (query = "", top = 50, skip = 0) =>
  apiClient.get("/items/search", { params: { query, top, skip } }).then((r) => r.data);

// Lookup helpers
export const fetchItemGroups = (query = "") =>
  apiClient.get("/items/lookup/item-groups", { params: { query } }).then((r) => r.data);

export const createItemGroup = (data) =>
  apiClient.post("/items/lookup/item-groups", data).then((r) => r.data);

export const fetchManufacturers = (query = "") =>
  apiClient.get("/items/lookup/manufacturers", { params: { query } }).then((r) => r.data);

export const fetchHSNCodes = (query = "") =>
  apiClient.get("/items/lookup/hsn-codes", { params: { query } }).then((r) => r.data);

export const createManufacturer = (data) =>
  apiClient.post("/items/lookup/manufacturers", data).then((r) => r.data);

export const fetchVendors = (query = "") =>
  apiClient.get("/items/lookup/vendors", { params: { query } }).then((r) => r.data);

export const fetchWarehouses = (query = "") =>
  apiClient.get("/items/lookup/warehouses", { params: { query } })
    .then((r) => {
      console.log('Warehouses fetched:', r.data);
      return r.data;
    })
    .catch((error) => {
      console.error('Error fetching warehouses:', error);
      throw error;
    });

export const fetchUoMGroups = (query = "") =>
  apiClient.get("/items/lookup/uom-groups", { params: { query } }).then((r) => r.data);

export const fetchCustomsGroups = (query = "") =>
  apiClient.get("/items/lookup/customs-groups", { params: { query } }).then((r) => r.data);

export const fetchItemProperties = () =>
  apiClient.get("/items/lookup/item-properties").then((r) => r.data);

export const fetchGLAccounts = (query = "") =>
  apiClient.get("/items/lookup/gl-accounts", { params: { query } }).then((r) => r.data);

export const fetchPriceLists = (query = "") =>
  apiClient.get("/items/lookup/price-lists", { params: { query } }).then((r) => r.data);

export const fetchItemCodePrefixes = () =>
  apiClient.get("/items/lookup/item-code-prefixes").then((r) => r.data);

// Per-item data
export const getItemPrices = (itemCode) =>
  apiClient.get(`/items/${encodeURIComponent(itemCode)}/prices`).then((r) => r.data);

export const getItemStock = (itemCode) =>
  apiClient.get(`/items/${encodeURIComponent(itemCode)}/stock`).then((r) => r.data);

export const uploadAttachment = (itemCode, formData) =>
  apiClient.post(`/items/${encodeURIComponent(itemCode)}/attachments`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);

export const deleteAttachment = (itemCode, attachmentId) =>
  apiClient.delete(`/items/${encodeURIComponent(itemCode)}/attachments/${encodeURIComponent(attachmentId)}`).then((r) => r.data);

export const fetchAttachments = (itemCode) =>
  apiClient.get(`/items/${encodeURIComponent(itemCode)}/attachments`).then((r) => r.data);

// Through the API client (it carries the login token); a plain link would not.
export const downloadAttachment = (itemCode, attachmentId) =>
  apiClient.get(`/items/${encodeURIComponent(itemCode)}/attachments/${encodeURIComponent(attachmentId)}`, { responseType: "blob" })
    .then((r) => r.data);
