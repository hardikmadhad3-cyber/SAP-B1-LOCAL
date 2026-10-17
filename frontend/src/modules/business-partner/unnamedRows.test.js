import { findUnnamedRow } from './unnamedRows';

describe('findUnnamedRow', () => {
  it('passes named rows and untouched placeholders', () => {
    expect(findUnnamedRow({
      ContactEmployees: [
        { Name: 'Ravi', Phone1: '999' },
        { Name: '', Gender: 'gt_Undefined', Active: 'tYES', BlockSendingMarketingContent: 'tNO' },
        { Name: 'Define New', FirstName: '' },
      ],
      BPAddresses: [
        { AddressName: 'Head Office', City: 'Ahmedabad' },
        { AddressName: '', AddressType: 'bo_ShipTo', Country: 'IN', RowNum: null, __isPlaceholder: true },
      ],
    })).toBeNull();
  });

  it('stops a contact filled in without its Contact ID', () => {
    expect(findUnnamedRow({ ContactEmployees: [{ Name: 'Ravi' }, { Name: '', FirstName: 'Meena', E_Mail: 'm@acme.in' }] }))
      .toEqual({ tab: 'contacts', message: 'Contact person 2: enter a Contact ID, or its details will not be saved.' });
    expect(findUnnamedRow({ ContactEmployees: [{ Name: 'Define New', Phone1: '111' }] })?.tab).toBe('contacts');
  });

  it('stops an address filled in without its Address ID', () => {
    expect(findUnnamedRow({ BPAddresses: [{ AddressName: '', AddressType: 'bo_ShipTo', Country: 'IN', City: 'Surat', __isPlaceholder: true }] }))
      .toEqual({ tab: 'addresses', message: 'Ship To address: enter an Address ID, or its details will not be saved.' });
  });
});
