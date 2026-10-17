import { buildCopyToState, reloadRouteDocument } from './copyToState';

describe('buildCopyToState', () => {
  test('rebases a GRPO line to the GRPO instead of its upstream purchase order', () => {
    const state = buildCopyToState({
      sourceDocType: 'grpo',
      sourceLabel: 'Goods Receipt PO',
      sourceDocEntry: 6,
      sourceDocNo: 6,
      baseType: 20,
      header: {},
      lines: [{
        lineNum: 5,
        baseType: 22,
        baseEntry: 3,
        baseLine: 1,
        itemNo: 'ITEM-1',
        openQty: '122',
      }],
    });

    expect(state.copyFrom.lines[0]).toMatchObject({
      previousBaseType: 22,
      previousBaseEntry: 3,
      previousBaseLine: 1,
      baseType: 20,
      baseEntry: 6,
      baseLine: 5,
      openQty: '122',
    });
  });

  test('retains target-supported copy extras such as freight rows', () => {
    const freightCharges = [{ expenseCode: '1', netAmount: '125.00' }];
    const state = buildCopyToState({
      sourceDocType: 'delivery',
      sourceLabel: 'Delivery',
      sourceDocEntry: 15,
      baseType: 15,
      header: {},
      lines: [],
      extraCopyFrom: { freightCharges },
    });

    expect(state.copyFrom.freightCharges).toEqual(freightCharges);
  });
});

describe('reloadRouteDocument', () => {
  test('re-opens the same document with the status message and keeps the SAP window', () => {
    const navigate = jest.fn();
    reloadRouteDocument(navigate, { pathname: '/ar-invoice', state: { sapWindow: { id: 'w1' }, copyFrom: {} } }, 'arInvoiceDocEntry', 12, 'cancel');
    const [path, options] = navigate.mock.calls[0];
    expect(path).toBe('/ar-invoice');
    expect(options.replace).toBe(true);
    expect(options.state).toMatchObject({ arInvoiceDocEntry: 12, sapWindow: { id: 'w1' }, documentStatusMessage: 'Document cancelled.' });
    expect(options.state.copyFrom).toBeUndefined();

    reloadRouteDocument(navigate, { pathname: '/sales-order', state: null }, 'salesOrderDocEntry', 3, 'close');
    expect(navigate.mock.calls[1][1].state.documentStatusMessage).toBe('Document closed.');
  });
});
