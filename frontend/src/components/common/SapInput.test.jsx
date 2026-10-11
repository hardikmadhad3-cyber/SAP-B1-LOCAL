import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SapInput from './SapInput';

test('dynamic date fields display DD/MM/YYYY and emit ISO values', () => {
  const onChange = jest.fn();
  render(<SapInput type="date" value="2026-09-24" onChange={(event) => onChange(event.target.value)} />);
  expect(screen.getByRole('textbox')).toHaveValue('24/09/2026');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '25/09/2026' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Tab' });
  expect(onChange).toHaveBeenLastCalledWith('2026-09-25');
});

test('other dynamic field types retain native input behavior', () => {
  render(<SapInput type="number" value={42} readOnly />);
  expect(screen.getByRole('spinbutton')).toHaveValue(42);
});
