import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DocumentRoundingInput from './DocumentRoundingInput';
import { calculateDocumentRounding } from '../../utils/documentRounding';

function RoundingForm({ disabled = false }) {
  const [header, setHeader] = useState({ rounding: true, roundingAmount: '' });
  const totals = calculateDocumentRounding(100.4, header.rounding, 2, header, {
    method: 'Y', roundingSystem: 2,
  });
  return <>
    <button type="button" onClick={() => setHeader((previous) => ({ ...previous, rounding: !previous.rounding }))}>Toggle rounding</button>
    <DocumentRoundingInput
      header={header}
      setHeader={setHeader}
      formattedAmount={`${totals.roundingAmount.toFixed(2)} INR`}
      disabled={disabled}
    />
    <output aria-label="Document total">{totals.total.toFixed(2)}</output>
  </>;
}

test('accepts a signed manual rounding difference and recalculates the total', () => {
  render(<RoundingForm />);
  const input = screen.getByRole('textbox', { name: 'Rounding amount' });
  expect(input.readOnly).toBe(false);
  expect(input.value).toBe('-0.40 INR');
  fireEvent.change(input, { target: { value: '-0.15' } });
  expect(input.value).toBe('-0.15');
  expect(screen.getByLabelText('Document total').textContent).toBe('100.25');
});

test('keeps the rounding amount read-only when the document is closed', () => {
  render(<RoundingForm disabled />);
  expect(screen.getByRole('textbox', { name: 'Rounding amount' }).readOnly).toBe(true);
});

test('turning rounding off clears a manual difference', () => {
  render(<RoundingForm />);
  const input = screen.getByRole('textbox', { name: 'Rounding amount' });
  fireEvent.change(input, { target: { value: '-0.15' } });
  fireEvent.click(screen.getByRole('button', { name: 'Toggle rounding' }));
  expect(input.readOnly).toBe(true);
  expect(screen.getByLabelText('Document total').textContent).toBe('100.40');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle rounding' }));
  expect(input.value).toBe('-0.40 INR');
  expect(screen.getByLabelText('Document total').textContent).toBe('100.00');
});
