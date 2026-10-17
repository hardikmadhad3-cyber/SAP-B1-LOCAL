import { changedFieldsNotSent } from './itemPayloadChanges';

describe('changedFieldsNotSent', () => {
  const initial = { ForeignName: 'Old', LeadTime: 5, Properties1: 'tYES', TreeType: 'iSalesTree', ItemName: 'Widget', ManageBatchNumbers: 'tNO', Remarks: 'x' };
  const keys = new Set(['ForeignName', 'LeadTime', 'Properties1', 'TreeType', 'ItemName', 'ManageBatchNumbers']);

  it('sends cleared fields as null, zeros as numbers and unticked boxes', () => {
    const form = { ...initial, ForeignName: '', LeadTime: '0', Properties1: 'tNO', TreeType: 'iNotATree' };
    expect(changedFieldsNotSent(form, { ItemName: 'Widget' }, { form: initial, keys }))
      .toEqual({ ForeignName: null, LeadTime: 0, Properties1: 'tNO', TreeType: 'iNotATree' });
  });

  it('leaves out unchanged fields, fields already sent, non-SL fields and batch management', () => {
    const form = { ...initial, ItemName: 'New', ManageBatchNumbers: 'tYES', Remarks: 'changed' };
    expect(changedFieldsNotSent(form, { ItemName: 'New' }, { form: initial, keys })).toEqual({});
  });
});
