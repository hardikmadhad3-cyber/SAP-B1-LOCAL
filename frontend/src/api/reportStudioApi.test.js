import apiClient from './client';
import { fetchReportParameterLookupOptions } from './reportStudioApi';

jest.mock('./client', () => ({ get: jest.fn() }));

afterEach(() => jest.clearAllMocks());

test.each([
  ['OITM', '/items/search', undefined],
  ['OCRD_CUSTOMERS', '/lookups/customers', undefined],
  ['OCRD_SUPPLIERS', '/business-partners/search', 'cSupplier'],
  ['OCRD', '/business-partners/search', undefined],
])('pages %s report lookups through the company search endpoint', async (table, endpoint, type) => {
  apiClient.get.mockResolvedValue({ data: [] });

  await fetchReportParameterLookupOptions({ table, columns: [] }, 'test', { skip: 200, top: 100 });

  expect(apiClient.get).toHaveBeenCalledWith(endpoint, {
    params: expect.objectContaining({ query: 'test', skip: 200, top: 100, ...(type ? { type } : {}) }),
  });
});
