import { normalizeUdfState, readSavedFormSettings } from './salesOrderForm';

test('can limit Sales Order UDF state to the current live definitions', () => {
  expect(normalizeUdfState(
    [{ key: 'U_Current', defaultValue: '' }],
    { U_Current: 'kept', U_OtherCompany: 'removed' },
    { preserveExtra: false },
  )).toEqual({ U_Current: 'kept' });
});

test('keeps Sales Order metadata authoritative except for saved line visibility', () => {
  const storageKey = 'sales-order-form-settings-test';
  window.localStorage.setItem(storageKey, JSON.stringify({
    matrixColumns: {
      hsnCode: { visible: false, active: false, order: 999, minWidth: 5 },
      U_CompanyAOnly: { visible: true, active: true },
    },
  }));

  const settings = readSavedFormSettings(
    [],
    [],
    [{
      key: 'hsnCode',
      label: 'HSN',
      visible: true,
      active: true,
      order: 14,
      minWidth: 95,
      sapControlled: true,
    }],
    storageKey,
  );

  expect(settings.matrixColumns).toEqual({
    hsnCode: {
      visible: false,
      active: true,
      order: 1,
      minWidth: 95,
      sapControlled: true,
    },
  });
  expect(settings.matrixColumns.U_CompanyAOnly).toBeUndefined();

  window.localStorage.removeItem(storageKey);
});

test('Sales Order keeps only current-company header UDFs and their saved visibility', () => {
  const storageKey = 'sales-order-header-udfs-test';
  window.localStorage.setItem(storageKey, JSON.stringify({
    headerUdfs: {
      U_Buyer: { visible: false, active: false },
      U_OtherCompany: { visible: true },
    },
  }));

  const settings = readSavedFormSettings(
    [{ key: 'U_Buyer', visible: true, active: true, sapControlled: true }],
    [], [], storageKey,
  );

  expect(settings.headerUdfs.U_Buyer.visible).toBe(false);
  expect(settings.headerUdfs.U_Buyer.active).toBe(true);
  expect(settings.headerUdfs.U_OtherCompany).toBeUndefined();
  window.localStorage.removeItem(storageKey);
});
