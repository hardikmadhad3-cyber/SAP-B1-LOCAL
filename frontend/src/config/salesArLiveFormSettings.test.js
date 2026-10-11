import {
  FORM_SETTINGS_STORAGE_KEY as SALES_QUOTATION_STORAGE_KEY,
  normalizeUdfState as normalizeSalesQuotationUdfs,
  readSavedFormSettings as readSalesQuotationSettings,
} from './salesQuotationForm';
import {
  FORM_SETTINGS_STORAGE_KEY as AR_INVOICE_STORAGE_KEY,
  normalizeUdfState as normalizeARInvoiceUdfs,
  readSavedFormSettings as readARInvoiceSettings,
} from './arInvoiceForm';
import {
  FORM_SETTINGS_STORAGE_KEY as AR_CREDIT_MEMO_STORAGE_KEY,
  readSavedFormSettings as readARCreditMemoSettings,
} from './arCreditMemoForm';
import {
  FORM_SETTINGS_STORAGE_KEY as SALES_ORDER_STORAGE_KEY,
  readSavedFormSettings as readSalesOrderSettings,
} from './salesOrderForm';
import {
  FORM_SETTINGS_STORAGE_KEY as DELIVERY_STORAGE_KEY,
  readSavedFormSettings as readDeliverySettings,
} from './deliveryForm';

const readers = [
  ['Sales Quotation', readSalesQuotationSettings],
  ['Sales Order', readSalesOrderSettings],
  ['Delivery', readDeliverySettings],
  ['A/R Invoice', readARInvoiceSettings],
  ['A/R Credit Memo', readARCreditMemoSettings],
];

describe.each(readers)('%s live form settings', (_name, readSettings) => {
  beforeEach(() => localStorage.clear());

  test('drops stale company fields and retains only user visibility over current live line fields', () => {
    const storageKey = `test.${_name}`;
    localStorage.setItem(storageKey, JSON.stringify({
      matrixColumns: {
        itemNo: { visible: false, active: false, order: 999, minWidth: 999 },
        U_OtherCompany: { visible: true, active: true },
      },
      rowUdfs: {
        U_Current: { visible: false, active: true, order: 999, minWidth: 999 },
        U_OtherCompany: { visible: true, active: true },
      },
      headerUdfs: {
        U_Header: { visible: false, active: false },
      },
    }));

    const settings = readSettings(
      [{ key: 'U_Header', visible: true, active: true, sapControlled: true }],
      [{
        key: 'U_Current',
        visible: true,
        active: false,
        order: 3,
        minWidth: 120,
        sapControlled: true,
      }],
      [{
        key: 'itemNo',
        visible: true,
        active: true,
        order: 2,
        minWidth: 150,
        sapControlled: true,
      }],
      storageKey,
    );

    expect(settings.matrixColumns).toEqual({
      itemNo: {
        visible: false,
        active: true,
        order: 1,
        minWidth: 150,
        sapControlled: true,
      },
    });
    expect(settings.rowUdfs.U_Current).toEqual({
      visible: false,
      active: false,
      order: 2,
      minWidth: 120,
      sapControlled: true,
    });
    expect(settings.headerUdfs.U_Header.visible).toBe(!['Sales Order', 'Delivery', 'A/R Invoice'].includes(_name));
    expect(settings.headerUdfs.U_Header.active).toBe(true);
    expect(settings.rowUdfs.U_OtherCompany).toBeUndefined();
  });
});

test('uses a distinct persistent document key for each standard Sales/A-R page', () => {
  expect(new Set([
    SALES_QUOTATION_STORAGE_KEY,
    SALES_ORDER_STORAGE_KEY,
    DELIVERY_STORAGE_KEY,
    AR_INVOICE_STORAGE_KEY,
    AR_CREDIT_MEMO_STORAGE_KEY,
  ])).toHaveProperty('size', 5);
});

test.each([
  ['Sales Quotation', normalizeSalesQuotationUdfs],
  ['A/R Invoice and Credit Memo', normalizeARInvoiceUdfs],
])('%s can remove UDF values that are absent from the current company schema', (_name, normalizeUdfs) => {
  expect(normalizeUdfs(
    [{ key: 'U_Current', defaultValue: '' }],
    { U_Current: 'kept', U_OtherCompany: 'removed' },
    { preserveExtra: false },
  )).toEqual({ U_Current: 'kept' });
});
