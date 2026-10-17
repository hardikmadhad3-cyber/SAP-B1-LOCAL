import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import HsnSacCodes from './HsnSacCodes';

jest.mock('../../api/hsnCodeApi', () => ({
  fetchHSNCodes: () => Promise.resolve({ data: { value: [{ absEntry: 1, code: '8471', description: 'Computers' }] } }),
  fetchSACCodes: () => Promise.resolve({ data: [] }),
  createHSNCode: jest.fn(),
  updateHSNCode: jest.fn(),
  createSACCode: jest.fn(),
  updateSACCode: jest.fn(),
}));

test('uses the im-* setup skeleton with the toolbar above the tabs', () => {
  const { container } = render(<HsnSacCodes />);
  const toolbar = container.querySelector('.im-toolbar');
  const tabs = container.querySelector('.im-tabs');
  expect(toolbar).toHaveTextContent('HSN Codes - Setup');
  expect(toolbar.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector('[class*="tc-"]')).toBeNull();
  expect(screen.getByLabelText('HSN Code*')).toBeInTheDocument();
});

test('Find opens the shared lookup and loads OData-shaped results', async () => {
  render(<HsnSacCodes />);
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
  expect(await screen.findByText('Computers')).toBeInTheDocument();
});

test('switching to SAC shows the SAC setup title', () => {
  render(<HsnSacCodes />);
  fireEvent.click(screen.getByRole('tab', { name: 'SAC (Services)' }));
  expect(screen.getByText('SAC Codes - Setup')).toBeInTheDocument();
});
