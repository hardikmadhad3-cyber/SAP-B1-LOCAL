import {
  getSelectableBusinessPartners,
  isSelectableBpCode,
  markResolvedBpLookup,
} from './documentBpSelection';

const partners = [
  { CardCode: 'AC00350', CardName: 'NATURE PULSE BOTANICALS PVT LTD' },
  { CardCode: 'CUS00938', CardName: 'NATURE PULSE BOTANICALS PVT LTD' },
  { CardCode: 'OTHER123', CardName: 'Another customer' },
];

test('Sales Order and Delivery hide only the wrong duplicate BP', () => {
  const policy = { preferredCardCode: 'CUS00938', excludedCardCodes: ['AC00350'] };
  expect(getSelectableBusinessPartners(partners, policy)).toEqual(partners.slice(1));
  expect(isSelectableBpCode('cus00938', policy)).toBe(true);
  expect(isSelectableBpCode('OTHER123', policy)).toBe(true);
  expect(isSelectableBpCode('ac00350', policy)).toBe(false);
});

test('A/R Invoice uses the other duplicate BP and keeps unrelated customers', () => {
  const policy = { preferredCardCode: 'AC00350', excludedCardCodes: ['CUS00938'] };
  expect(getSelectableBusinessPartners(partners, policy)).toEqual([partners[0], partners[2]]);
});

test('exact selectable codes let Tab continue while name searches use lookup', () => {
  const policy = { preferredCardCode: 'CUS00938', excludedCardCodes: ['AC00350'] };
  const input = document.createElement('input');
  markResolvedBpLookup(input, 'OTHER123', partners, policy);
  expect(input.dataset.sapLookupResolvedValue).toBe('OTHER123');
  markResolvedBpLookup(input, 'nature', partners, policy);
  expect(input.dataset.sapLookupResolvedValue).toBeUndefined();
  markResolvedBpLookup(input, 'AC00350', partners, policy);
  expect(input.dataset.sapLookupResolvedValue).toBeUndefined();
});

test('leaves partner selection unchanged without a company policy', () => {
  expect(getSelectableBusinessPartners(partners, null)).toEqual(partners);
  expect(isSelectableBpCode('AC00350', null)).toBe(true);
});
