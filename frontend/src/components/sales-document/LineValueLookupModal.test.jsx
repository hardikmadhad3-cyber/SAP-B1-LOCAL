import { fireEvent, render, screen } from '@testing-library/react';
import LineValueLookupModal from './LineValueLookupModal';

test('uses the text entered before Tab to search Header and row UDF values', () => {
  window.__sapB1PendingLookupQuery = 'te';
  render(
    <LineValueLookupModal
      isOpen
      onClose={jest.fn()}
      onSelect={jest.fn()}
      options={[{ value: 'TEST', description: 'Test value' }, { value: 'OTHER', description: 'Other value' }]}
    />,
  );

  expect(screen.getByPlaceholderText('Search values')).toHaveValue('te');
  expect(screen.getByText('TEST')).toBeInTheDocument();
  expect(screen.queryByText('OTHER')).not.toBeInTheDocument();
  expect(window.__sapB1PendingLookupQuery).toBe('');
  fireEvent.change(screen.getByPlaceholderText('Search values'), { target: { value: 'other' } });
  expect(screen.getByText('OTHER')).toBeInTheDocument();
});
