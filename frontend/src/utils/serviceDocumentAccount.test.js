import { hydrateServiceAccountLine, populateServiceAccountLine } from './serviceDocumentAccount';

const accounts = [{ code: '_SYS00028', formatCode: '100028', name: 'Service Revenue' }];

test('selecting a SQL formatted account fills the internal code, name, and empty description', () => {
  expect(populateServiceAccountLine({ glAccount: '', description: '' }, { value: '100028' }, accounts))
    .toMatchObject({ glAccount: '_SYS00028', glAccountName: 'Service Revenue', description: 'Service Revenue' });
});

test('a user description survives account selection and saved lines recover read-only account name', () => {
  expect(populateServiceAccountLine({ description: 'Consulting work' }, { value: '100028' }, accounts).description)
    .toBe('Consulting work');
  expect(hydrateServiceAccountLine({ glAccount: '100028', description: 'Saved text' }, accounts))
    .toMatchObject({ glAccountName: 'Service Revenue', description: 'Saved text' });
});
