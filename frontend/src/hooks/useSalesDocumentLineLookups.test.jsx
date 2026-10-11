import { act, renderHook, waitFor } from '@testing-library/react';
import useSalesDocumentLineLookups from './useSalesDocumentLineLookups';
import { fetchSalesDocumentLookup, fetchSalesDocumentSchema } from '../api/salesDocumentSchemaApi';

let mockActiveCompany;
jest.mock('../auth/AuthContext', () => ({ useAuth: () => ({ company: mockActiveCompany }) }));
jest.mock('../api/salesDocumentSchemaApi', () => ({ fetchSalesDocumentLookup: jest.fn(), fetchSalesDocumentSchema: jest.fn() }));

const refData = {
  payment_terms: [], sac_codes: [],
  quality_options: { seller: [{ value: 'OLD', label: 'Old cached value' }] },
  line_field_metadata: { live_schema: { lineFields: [{
    id: 'RDR1.U_Seller_Quality', lookup: { source: 'udf-valid-values' },
  }] } },
};

test('opens seller quality from live values in the active company', async () => {
  mockActiveCompany = { companyId: 2, dbName: 'COMPANY_TWO' };
  fetchSalesDocumentLookup.mockResolvedValue({
    items: [{ value: '15 FFA MAX.', label: '15 FFA MAX.' }], hasMore: false,
  });
  const { result } = renderHook(() => useSalesDocumentLineLookups({
    refData, setRefData: jest.fn(), setLines: jest.fn(),
  }));
  act(() => result.current.openQualityModal('sellerQuality', 0));
  await waitFor(() => expect(result.current.lineLookupModal.options)
    .toEqual([{ value: '15 FFA MAX.', label: '15 FFA MAX.', description: '' }]));
  expect(fetchSalesDocumentLookup).toHaveBeenCalledWith('udf-valid-values', expect.objectContaining({
    fieldId: 'RDR1.U_Seller_Quality', documentType: 'SALES_ORDER',
  }));
});

test('a previous company response cannot fill the next company modal', async () => {
  mockActiveCompany = { companyId: 2, dbName: 'COMPANY_TWO' };
  let resolveOld;
  fetchSalesDocumentLookup.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  fetchSalesDocumentLookup.mockResolvedValueOnce({
    items: [{ value: 'NEW', label: 'New company value' }], hasMore: false,
  });
  const { result, rerender } = renderHook(() => useSalesDocumentLineLookups({
    refData, setRefData: jest.fn(), setLines: jest.fn(),
  }));
  act(() => result.current.openQualityModal('sellerQuality', 0));
  mockActiveCompany = { companyId: 3, dbName: 'COMPANY_THREE' };
  rerender();
  act(() => result.current.openQualityModal('sellerQuality', 0));
  await waitFor(() => expect(result.current.lineLookupModal.options[0]?.value).toBe('NEW'));
  await act(async () => resolveOld({ items: [{ value: 'OLD' }], hasMore: false }));
  expect(result.current.lineLookupModal.options[0].value).toBe('NEW');
});

test('uses the SAP form list and preserves an empty live list without cached fallback or New action', async () => {
  mockActiveCompany = { companyId: 2, dbName: 'NCPL_110126' };
  fetchSalesDocumentLookup.mockResolvedValue({ items: [], hasMore: false });
  const { result } = renderHook(() => useSalesDocumentLineLookups({
    refData: { ...refData, line_field_metadata: { live_schema: { lineFields: [{
      id: 'DLN1.U_Seller_Quality', lookup: { source: 'sap-user-values' },
    }] } } },
    documentType: 'DELIVERY', lineTable: 'DLN1', setRefData: jest.fn(), setLines: jest.fn(),
  }));
  act(() => result.current.openQualityModal('sellerQuality', 0));
  await waitFor(() => expect(result.current.lineLookupModal.emptyMessage).toBe('No seller quality values found'));
  expect(fetchSalesDocumentLookup).toHaveBeenLastCalledWith('sap-user-values', expect.objectContaining({
    fieldId: 'DLN1.U_Seller_Quality', documentType: 'DELIVERY',
  }));
  expect(result.current.lineLookupModal.options).toEqual([]);
  expect(result.current.lineLookupModal.allowCreate).toBe(false);
});

test('company-specific pages discover the live form lookup when reference data has no shared schema', async () => {
  fetchSalesDocumentSchema.mockResolvedValue({ lineFields: [{ id: 'RDR1.U_Seller_Quality', lookupSource: 'sap-user-values' }] });
  fetchSalesDocumentLookup.mockResolvedValue({ items: [{ value: '15 FFA MAX.' }], hasMore: false });
  const { result } = renderHook(() => useSalesDocumentLineLookups({
    refData: { payment_terms: [], sac_codes: [] }, setRefData: jest.fn(), setLines: jest.fn(),
  }));
  act(() => result.current.openQualityModal('sellerQuality', 0));
  await waitFor(() => expect(result.current.lineLookupModal.options[0]?.value).toBe('15 FFA MAX.'));
  expect(fetchSalesDocumentLookup).toHaveBeenLastCalledWith('sap-user-values', expect.objectContaining({ fieldId: 'RDR1.U_Seller_Quality' }));
});
