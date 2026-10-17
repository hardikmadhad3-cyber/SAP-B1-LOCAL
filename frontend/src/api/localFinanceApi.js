import apiClient from './client';

export const fetchOpeningBalances = () => apiClient.get('/local-finance/opening-balances').then((r) => r.data);
export const postOpeningBalances = (kind, body) => apiClient.post(`/local-finance/opening-balances/${kind}`, body).then((r) => r.data);
export const fetchReconcilablePartners = () => apiClient.get('/local-finance/reconciliation').then((r) => r.data);
export const fetchOpenRows = (cardCode) => apiClient.get(`/local-finance/reconciliation/${encodeURIComponent(cardCode)}`).then((r) => r.data);
export const reconcileRows = (body) => apiClient.post('/local-finance/reconciliation', body).then((r) => r.data);
