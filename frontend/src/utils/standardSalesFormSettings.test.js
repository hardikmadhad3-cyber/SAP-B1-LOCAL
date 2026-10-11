import { renderHook, waitFor } from '@testing-library/react';
import { useAuth } from '../auth/AuthContext';
import { fetchFormSettings } from '../api/formSettingsApi';
import { useStandardSalesFormSettings } from './standardSalesFormSettings';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../api/formSettingsApi', () => ({ fetchFormSettings: jest.fn(), saveFormSettings: jest.fn() }));

const readSettings = (headers, rows, matrix) => ({
  headerUdfs: Object.fromEntries(headers.map((field) => [field.key, { visible: true }])),
  rowUdfs: Object.fromEntries(rows.map((field) => [field.key, { visible: true }])),
  matrixColumns: Object.fromEntries(matrix.map((field) => [field.key, { visible: true, valueKey: field.valueKey }])),
});

test('published sales matrix fields follow the active company and discard the previous company UDF', async () => {
  let company = { companyId: 7, dbName: 'COMPANY_A' };
  useAuth.mockImplementation(() => ({ company, user: { userId: 10, username: 'manager' } }));
  fetchFormSettings.mockImplementation(async () => ({
    companyId: company.companyId,
    userId: 10,
    settings: {},
    queryLayout: {
      formKey: 'sapb1.delivery.formSettings.v3',
      version: 1,
      isPublished: true,
      columns: [
        { key: 'Item_No', fieldName: 'ItemCode' },
        { key: 'Agent', fieldName: company.companyId === 7 ? 'U_AgentA' : 'U_AgentB' },
      ],
    },
  }));
  const propsForCompany = () => ({
    formKey: 'sapb1.delivery.formSettings.v3',
    readSavedFormSettings: readSettings,
    headerUdfDefinitions: [],
    rowUdfDefinitions: [{ key: company.companyId === 7 ? 'U_AgentA' : 'U_AgentB', label: 'Agent' }],
    matrixColumnDefinitions: [{ key: 'itemNo', sapField: 'ItemCode', label: 'Item No.' }],
    companyId: company.companyId,
    companyDb: company.dbName,
    hydratedFieldMetadataScope: `${company.companyId}::${company.dbName.toLowerCase()}`,
  });
  const { result, rerender } = renderHook(({ options }) => useStandardSalesFormSettings(options), {
    initialProps: { options: propsForCompany() },
  });
  await waitFor(() => expect(result.current[6]).toBe(true));
  expect(result.current[5].map((field) => field.valueKey)).toEqual(['__lineNumber', 'itemNo', 'U_AgentA']);

  company = { companyId: 8, dbName: 'COMPANY_B' };
  rerender({ options: propsForCompany() });
  expect(result.current[6]).toBe(false);
  await waitFor(() => expect(result.current[6]).toBe(true));
  expect(result.current[5].map((field) => field.valueKey)).toEqual(['__lineNumber', 'itemNo', 'U_AgentB']);
  expect(result.current[5].some((field) => field.valueKey === 'U_AgentA')).toBe(false);
});

test('published purchase matrix uses its SQL captions without a second row-number column', async () => {
  const company = { companyId: 9, dbName: 'PURCHASE_CO' };
  useAuth.mockImplementation(() => ({ company, user: { userId: 10, username: 'manager' } }));
  fetchFormSettings.mockResolvedValue({
    companyId: 9, userId: 10, settings: {},
    queryLayout: {
      formKey: 'sapb1.purchaseOrder.formSettings.v2', version: 1, isPublished: true,
      columns: [
        { key: 'Item_No', label: 'Item No.', fieldName: 'ItemCode' },
        { key: 'Buyer', label: 'Buyer', fieldName: 'U_Buyer' },
      ],
    },
  });
  const { result } = renderHook(() => useStandardSalesFormSettings({
    formKey: 'sapb1.purchaseOrder.formSettings.v2',
    readSavedFormSettings: readSettings,
    headerUdfDefinitions: [],
    rowUdfDefinitions: [{ key: 'U_Buyer', label: 'Buyer' }],
    matrixColumnDefinitions: [{ key: 'itemNo', sapField: 'ItemCode', label: 'Item No.' }],
    companyId: 9, companyDb: 'PURCHASE_CO', includeLineNumber: false,
  }));
  await waitFor(() => expect(result.current[6]).toBe(true));
  expect(result.current[5].map((field) => field.valueKey)).toEqual(['itemNo', 'U_Buyer']);
  expect(result.current[5].map((field) => field.label)).toEqual(['Item No.', 'Buyer']);
});
