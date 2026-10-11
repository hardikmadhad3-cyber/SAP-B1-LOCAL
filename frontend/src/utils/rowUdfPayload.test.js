import { buildVisibleEnteredRowUdfPayload } from './rowUdfPayload';

test('omits entered row UDF values when the current form hides them', () => {
  expect(
    buildVisibleEnteredRowUdfPayload(
      [{ key: 'U_Fix_Brock_S', visible: true, active: true }],
      { U_Fix_Brock_S: '123.45' },
      { rowUdfs: { U_Fix_Brock_S: { visible: false, active: false } } }
    )
  ).toEqual({});
});

test('omits hidden mapped row UDFs even when unmapped UDF preservation is enabled', () => {
  expect(buildVisibleEnteredRowUdfPayload(
    [{ key: 'U_CurrentCompany', visible: true, active: true }],
    { U_CurrentCompany: 'hidden', U_Extra: 'legacy' },
    { rowUdfs: { U_CurrentCompany: { visible: false } } },
  )).toEqual({ U_Extra: 'legacy' });
});

test('repeated company columns post their physical UDF while either displayed alias is visible', () => {
  const definitions = [{ key: 'U_S_BrokPerQty', visible: true, active: true }];
  const values = { U_S_BrokPerQty: '12.50' };
  const settings = { matrixColumns: {
    U_S_BrokPerQty: { valueKey: 'U_S_BrokPerQty', visible: false },
    U_S_BrokPerQty__layout_24: { valueKey: 'U_S_BrokPerQty', visible: true },
  } };
  expect(buildVisibleEnteredRowUdfPayload(definitions, values, settings, { preserveUnmappedUdfs: false }))
    .toEqual(values);
  settings.matrixColumns.U_S_BrokPerQty__layout_24.visible = false;
  expect(buildVisibleEnteredRowUdfPayload(definitions, values, settings, { preserveUnmappedUdfs: false }))
    .toEqual({});
});

test('keeps extra entered SAP row UDF values discovered from live matrix state', () => {
  expect(
    buildVisibleEnteredRowUdfPayload(
      [],
      { U_Fix_Brock_S: '123.45', localNote: 'not a SAP UDF' },
      {}
    )
  ).toEqual({ U_Fix_Brock_S: '123.45' });
});

test('strict live-schema mode omits entered SAP UDFs absent from current definitions', () => {
  expect(
    buildVisibleEnteredRowUdfPayload(
      [{ key: 'U_CurrentCompany', visible: true, active: true }],
      {
        U_CurrentCompany: 'live',
        U_PreviousCompany: 'stale',
        localNote: 'not a SAP UDF',
      },
      {},
      { preserveUnmappedUdfs: false }
    )
  ).toEqual({ U_CurrentCompany: 'live' });
});
