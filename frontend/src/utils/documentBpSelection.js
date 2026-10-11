const normalizeCode = (value) => String(value || '').trim().toUpperCase();

export const isSelectableBpCode = (code, policy) => (
  !policy?.excludedCardCodes?.some((excluded) => normalizeCode(excluded) === normalizeCode(code))
);

export const getSelectableBusinessPartners = (partners = [], policy) => (
  policy?.excludedCardCodes?.length
    ? partners.filter((partner) => isSelectableBpCode(partner.CardCode, policy))
    : partners
);

// A complete code typed into a BP field is already resolved; Tab can continue
// to the next field. Partial codes and name searches still open the lookup.
export const markResolvedBpLookup = (input, value, partners = [], policy) => {
  if (!input?.dataset) return;
  const isResolved = isSelectableBpCode(value, policy) && partners.some(
    (partner) => String(partner.CardCode || '').trim() === String(value || '').trim()
  );
  if (isResolved) input.dataset.sapLookupResolvedValue = value;
  else delete input.dataset.sapLookupResolvedValue;
};
