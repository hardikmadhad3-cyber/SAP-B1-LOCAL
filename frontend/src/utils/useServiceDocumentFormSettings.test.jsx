import { act, renderHook, waitFor } from '@testing-library/react';

let mockAuthState;

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

jest.mock('../api/formSettingsApi', () => ({
  fetchFormSettings: jest.fn(),
  saveFormSettings: jest.fn(),
}));

import { fetchFormSettings, saveFormSettings } from '../api/formSettingsApi';
import { readServiceDocumentFormSettings } from './serviceDocumentFormSettingsConfig';
import useServiceDocumentFormSettings from './useServiceDocumentFormSettings';

const FORM_KEY = 'sapb1.serviceArInvoice.formSettings.v2';

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const readSettings = (headerUdfs, rowUdfs, matrixColumns, storageKey) => (
  readServiceDocumentFormSettings({
    headerUdfs,
    rowUdfs,
    matrixColumns,
    storageKey,
  })
);

const companyA = {
  companyId: 7,
  companyName: 'Company A',
  dbName: 'COMPANY_A',
  serverName: 'SAP01',
};

const companyB = {
  companyId: 8,
  companyName: 'Company B',
  dbName: 'COMPANY_B',
  serverName: 'SAP01',
};

const descriptionColumn = {
  key: 'description',
  visible: true,
  active: true,
  sapControlled: true,
};

describe('useServiceDocumentFormSettings company/schema lifecycle', () => {
  let warnSpy;

  beforeEach(() => {
    mockAuthState = {
      company: companyA,
      user: { userId: 10, username: 'manager' },
    };
    window.localStorage.clear();
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('clears Company A fields before Company B metadata can become ready', async () => {
    const requestA = createDeferred();
    const requestB = createDeferred();
    fetchFormSettings
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);

    const { result, rerender } = renderHook(({
      company,
      headerUdfs,
      rowUdfs,
      matrixColumns,
    }) => useServiceDocumentFormSettings({
      company,
      baseStorageKey: FORM_KEY,
      readSavedFormSettings: readSettings,
      headerUdfDefinitions: headerUdfs,
      rowUdfDefinitions: rowUdfs,
      matrixColumnDefinitions: matrixColumns,
    }), {
      initialProps: {
        company: companyA,
        headerUdfs: [],
        rowUdfs: [{ key: 'U_CompanyA', visible: true, active: true, sapControlled: true }],
        matrixColumns: [descriptionColumn],
      },
    });

    act(() => {
      result.current.hydrateFormSettings(
        [],
        [{ key: 'U_CompanyA', visible: true, active: true, sapControlled: true }],
        [descriptionColumn],
      );
    });
    expect(result.current.formSettingsReady).toBe(false);

    await act(async () => {
      requestA.resolve({
        companyId: 7,
        userId: 10,
        settings: {},
      });
      await requestA.promise;
    });
    await waitFor(() => expect(result.current.formSettingsReady).toBe(true));
    expect(result.current.formSettings.rowUdfs.U_CompanyA).toBeDefined();

    mockAuthState = { ...mockAuthState, company: companyB };
    rerender({
      company: companyB,
      headerUdfs: [],
      rowUdfs: [],
      matrixColumns: [descriptionColumn],
    });

    expect(result.current.formSettingsReady).toBe(false);
    expect(result.current.formSettings.rowUdfs.U_CompanyA).toBeUndefined();

    const companyBRowUdfs = [
      { key: 'U_CompanyB', visible: true, active: false, sapControlled: true },
    ];
    rerender({
      company: companyB,
      headerUdfs: [],
      rowUdfs: companyBRowUdfs,
      matrixColumns: [descriptionColumn],
    });
    act(() => {
      result.current.hydrateFormSettings(
        [],
        companyBRowUdfs,
        [descriptionColumn],
      );
    });

    await act(async () => {
      requestB.resolve({
        companyId: 8,
        userId: 10,
        settings: {},
      });
      await requestB.promise;
    });
    await waitFor(() => expect(result.current.formSettingsReady).toBe(true));

    expect(result.current.formSettings.rowUdfs.U_CompanyA).toBeUndefined();
    expect(result.current.formSettings.rowUdfs.U_CompanyB).toBeDefined();
    expect(saveFormSettings).not.toHaveBeenCalled();
  });

  test('published service fields use only the active company SQL layout', async () => {
    fetchFormSettings.mockImplementation(async () => ({
      companyId: mockAuthState.company.companyId,
      userId: 10,
      settings: {},
      queryLayout: {
        formKey: FORM_KEY, version: 1, isPublished: true,
        columns: [
          { key: 'Description', fieldName: 'Dscription' },
          { key: 'Agent', fieldName: mockAuthState.company.companyId === 7 ? 'U_CompanyA' : 'U_CompanyB' },
        ],
      },
    }));
    const propsForCompany = () => ({
      company: mockAuthState.company,
      headerUdfDefinitions: [],
      rowUdfDefinitions: [{ key: mockAuthState.company.companyId === 7 ? 'U_CompanyA' : 'U_CompanyB' }],
      matrixColumnDefinitions: [{ key: 'description', fieldName: 'Dscription', label: 'Description' }],
    });
    const { result, rerender } = renderHook((props) => useServiceDocumentFormSettings({
      ...props, baseStorageKey: FORM_KEY, readSavedFormSettings: readSettings,
    }), { initialProps: propsForCompany() });
    act(() => result.current.hydrateFormSettings([], propsForCompany().rowUdfDefinitions, propsForCompany().matrixColumnDefinitions));
    await waitFor(() => expect(result.current.formSettingsReady).toBe(true));
    expect(result.current.effectiveMatrixColumns.map((field) => field.valueKey)).toEqual(['description', 'U_CompanyA']);

    mockAuthState = { ...mockAuthState, company: companyB };
    rerender(propsForCompany());
    expect(result.current.formSettingsReady).toBe(false);
    act(() => result.current.hydrateFormSettings([], propsForCompany().rowUdfDefinitions, propsForCompany().matrixColumnDefinitions));
    await waitFor(() => expect(result.current.formSettingsReady).toBe(true));
    expect(result.current.effectiveMatrixColumns.map((field) => field.valueKey)).toEqual(['description', 'U_CompanyB']);
  });
});
