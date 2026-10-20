import apiClient from "./client";

export const listBOMs  = (query = "", top = 50, skip = 0) =>
  apiClient.get("/bom", { params: { query, top, skip } }).then((r) => r.data);

export const getBOM    = (treeCode) =>
  apiClient.get(`/bom/${encodeURIComponent(treeCode)}`).then((r) => r.data);

export const createBOM = (data) =>
  apiClient.post("/bom", data).then((r) => r.data);

export const updateBOM = (treeCode, data) =>
  apiClient.patch(`/bom/${encodeURIComponent(treeCode)}`, data).then((r) => r.data);

export const deleteBOM = (treeCode) =>
  apiClient.delete(`/bom/${encodeURIComponent(treeCode)}`).then((r) => r.data);

// Lookups
export const fetchBOMItems             = (query = "", top = 5000, skip = 0) =>
  apiClient.get("/bom/lookup/items", { params: { query, top, skip, _: Date.now() } }).then((r) => r.data);

export const fetchBOMList              = (query = "") =>
  apiClient.get("/bom", { params: { query, top: 100 } }).then((r) => r.data);

export const fetchBOMWarehouses        = () =>
  apiClient.get("/bom/lookup/warehouses", { params: { _: Date.now() } }).then((r) => r.data);

export const fetchBOMPriceLists        = () =>
  apiClient.get("/bom/lookup/price-lists", { params: { _: Date.now() } }).then((r) => r.data);

export const fetchBOMDistributionRules = () =>
  apiClient.get("/bom/lookup/distribution-rules", { params: { _: Date.now() } }).then((r) => r.data);

export const fetchBOMProjects          = () =>
  apiClient.get("/bom/lookup/projects", { params: { _: Date.now() } }).then((r) => r.data);

export const fetchBOMGLAccounts        = (query = "") =>
  apiClient.get("/bom/lookup/gl-accounts", { params: { query, _: Date.now() } }).then((r) => r.data);

export const getItemDetails = (itemCode) =>
  apiClient.get(`/bom/lookup/item-details/${encodeURIComponent(itemCode)}`, { params: { _: Date.now() } }).then((r) => r.data);

// Browse: first | prev | next | last from the current product (404 when none).
export const navigateBOM = (direction, from = "") =>
  apiClient.get("/bom/navigate", { params: { direction, from, _: Date.now() } }).then((r) => r.data);

export const fetchBOMResources = (query = "") =>
  apiClient.get("/bom/lookup/resources", { params: { query, _: Date.now() } }).then((r) => r.data);

// Attachments tab (stored on the server per company and BOM, like Item Master).
const attachmentsPath = (treeCode) => `/bom/${encodeURIComponent(treeCode)}/attachments`;

export const fetchBOMAttachments = (treeCode) =>
  apiClient.get(attachmentsPath(treeCode), { params: { _: Date.now() } }).then((r) => r.data);

export const uploadBOMAttachment = (treeCode, file) => {
  const body = new FormData();
  body.append("file", file);
  return apiClient.post(attachmentsPath(treeCode), body, {
    headers: { "Content-Type": "multipart/form-data" },
  }).then((r) => r.data);
};

export const deleteBOMAttachment = (treeCode, id) =>
  apiClient.delete(`${attachmentsPath(treeCode)}/${encodeURIComponent(id)}`).then((r) => r.data);

// Through the API client (it carries the login token); a plain link would not.
export const downloadBOMAttachment = (treeCode, id) =>
  apiClient.get(`${attachmentsPath(treeCode)}/${encodeURIComponent(id)}`, { responseType: "blob" }).then((r) => r.data);
