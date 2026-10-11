import { hydrateWorkbookDocumentLine } from './workbookLineHydration';

const createLine = () => ({
  itemNo: '',
  uomName: '',
  inStock: '',
  qtyInWhse: '',
  cogsDistRule: '',
  lineDeliveryDate: '',
  udf: {},
});

test('hydrates SAP matrix display fields from database and Service Layer aliases', () => {
  const line = hydrateWorkbookDocumentLine({
    line: {
      ItemCode: 'A100',
      UnitMsr: 'BOX',
      OnHand: 125.5,
      WhsQty: 18,
      COGSCostingCode: 'EXPORT',
      ShipDate: '2026-08-30',
      GTotal: 250.75,
    },
    createLine,
    normalizeUdfState: (_fields, values) => values,
  });

  expect(line).toMatchObject({
    itemNo: 'A100',
    uomName: 'BOX',
    inStock: '125.5',
    qtyInWhse: '18',
    cogsDistRule: 'EXPORT',
    lineDeliveryDate: '2026-08-30',
    grossTotal: '250.75',
  });
});

test('keeps UoM and COGS fields separate from their SAP internal and distribution values', () => {
  const line = hydrateWorkbookDocumentLine({
    line: {
      ItemCode: 'A200',
      UomEntry: 17,
      DistributionRule: 'SALES-DIM',
    },
    createLine,
    normalizeUdfState: (_fields, values) => values,
  });

  expect(line.uomCode).toBe('');
  expect(line.uomEntry).toBe(17);
  expect(line.cogsDistRule).toBe('');
});

test('uses the saved document branch for lines without a physical branch field', () => {
  const base = { createLine, normalizeUdfState: (_fields, values) => values, fallbackBranch: '3' };
  expect(hydrateWorkbookDocumentLine({ ...base, line: { ItemCode: 'A200', WhsCode: 'SUN-FG' } }).branch).toBe('3');
  expect(hydrateWorkbookDocumentLine({ ...base, line: { ItemCode: 'A200', branch: '1' } }).branch).toBe('1');
});

test('hydrates SAP invoice package count, net price, unit factor, and exact UDF values', () => {
  const line = hydrateWorkbookDocumentLine({
    line: {
      ItemCode: 'SODIUM SULPHATE POWDER',
      NoOfPackages: 10,
      PriceAfterDiscount: 5700,
      ItemsPerUnit: 1,
      line_udfs: { U_Sample: 'NO', U_BoxWeight: '7.00', U_PackWt: '0.070' },
    },
    createLine,
    normalizeUdfState: (_fields, values) => values,
  });
  expect(line).toMatchObject({
    noOfPackages: '10',
    priceAfterDiscount: '5700',
    itemsPerUnit: '1',
    udf: { U_Sample: 'NO', U_BoxWeight: '7.00', U_PackWt: '0.070' },
  });
});
