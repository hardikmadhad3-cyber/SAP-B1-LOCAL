import { getSalesOrderCommissionDefaults } from './salesOrderCommissionDefault';

test('uses the requested Sales Order commission for each active company', () => {
  expect(getSalesOrderCommissionDefaults('DC_LIVEDB')).toEqual({ commission: '', commPercent: '2.5' });
  expect(getSalesOrderCommissionDefaults('NC_LIVE')).toEqual({ commission: '1.5', commPercent: '' });
});

test('uses SAP UDF metadata for other companies without carrying another company default', () => {
  const fields = [{ key: 'U_COMPRC', defaultValue: '3' }];
  expect(getSalesOrderCommissionDefaults('OTHER_COMPANY', fields)).toEqual({ commission: '3', commPercent: '' });
  expect(getSalesOrderCommissionDefaults('OTHER_COMPANY')).toEqual({ commission: '', commPercent: '' });
});
