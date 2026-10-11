import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SapDateInput, { formatSapDateDisplay } from './SapDateInput';

test('displays ISO dates as DD/MM/YYYY while retaining ISO values for document handlers', () => {
  const onChange = jest.fn();
  const Form = () => {
    const [date, setDate] = useState('2026-09-24');
    return <SapDateInput id="posting-date" name="postingDate" value={date}
      onChange={(event) => { onChange(event.target.name, event.target.value); setDate(event.target.value); }} />;
  };

  render(<Form />);
  const input = screen.getByRole('textbox');
  expect(input).toHaveValue('24/09/2026');

  fireEvent.change(input, { target: { value: '19' } });
  fireEvent.keyDown(input, { key: 'Tab' });

  const expected = new Date();
  const iso = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-19`;
  expect(onChange).toHaveBeenLastCalledWith('postingDate', iso);
  expect(input).toHaveValue(formatSapDateDisplay(iso));
});

test('accepts a full day/month/year date and an existing date picker selection', () => {
  const onChange = jest.fn();
  render(<SapDateInput name="documentDate" defaultValue="2026-09-24"
    onChange={(event) => onChange(event.target.value)} />);
  const input = screen.getByRole('textbox');

  fireEvent.change(input, { target: { value: '05/10/2026' } });
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(input).toHaveValue('05/10/2026');
  expect(onChange).toHaveBeenLastCalledWith('2026-10-05');

  fireEvent.change(document.querySelector('.sap-date-input__picker'), { target: { value: '2026-12-31' } });
  expect(input).toHaveValue('31/12/2026');
});

test('rejects invalid dates without retaining an old value', () => {
  const onChange = jest.fn();
  const Form = () => {
    const [date, setDate] = useState('2026-09-24');
    return <SapDateInput value={date} onChange={(event) => { onChange(event.target.value); setDate(event.target.value); }} />;
  };
  render(<Form />);
  const input = screen.getByRole('textbox');

  fireEvent.change(input, { target: { value: '31/02/2026' } });
  fireEvent.keyDown(input, { key: 'Tab' });

  expect(onChange).toHaveBeenCalledWith('');
  expect(input.validationMessage).toBe('Enter a valid calendar date.');
});
