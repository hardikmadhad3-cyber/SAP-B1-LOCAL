// SAP needs a Contact ID / Address ID to save a contact person or an address.
// A row the user filled in without one would otherwise be dropped from the save
// without a word, so the page stops and says which row needs its ID.

const PLACEHOLDER_NAME = 'Define New';
// Values a new row starts with; they are not user input.
const CONTACT_DEFAULTS = { Gender: ['gt_Undefined', 'gt_NotSpecified'], Active: ['tYES'], BlockSendingMarketingContent: ['tNO'], IsDefault: ['tNO'] };
const ADDRESS_DEFAULTS = { AddressType: ['bo_BillTo', 'bo_ShipTo'], Country: ['IN'] };
const IGNORED = new Set(['Name', 'AddressName', 'RowNum', 'BPCode', 'CardCode', 'InternalCode', '__isPlaceholder', 'PlaceOfBirthName']);

const hasUserData = (row = {}, defaults) => Object.entries(row).some(([key, value]) => {
  if (IGNORED.has(key) || value == null) return false;
  const text = String(value).trim();
  return text !== '' && !(defaults[key] || []).includes(text);
});
const missingId = (value) => !String(value || '').trim() || String(value).trim() === PLACEHOLDER_NAME;

export const findUnnamedRow = (form = {}) => {
  const contactIndex = (form.ContactEmployees || []).findIndex((contact) => missingId(contact.Name) && hasUserData(contact, CONTACT_DEFAULTS));
  if (contactIndex >= 0) {
    return { tab: 'contacts', message: `Contact person ${contactIndex + 1}: enter a Contact ID, or its details will not be saved.` };
  }
  const address = (form.BPAddresses || []).find((row) => missingId(row.AddressName) && hasUserData(row, ADDRESS_DEFAULTS));
  if (address) {
    const type = address.AddressType === 'bo_ShipTo' ? 'Ship To' : 'Bill To';
    return { tab: 'addresses', message: `${type} address: enter an Address ID, or its details will not be saved.` };
  }
  return null;
};
