import { fireEvent, render, screen } from '@testing-library/react';
import CompanyReportsPage from './CompanyReportsPage';
import { fetchCompanyReports } from '../api/companyReportsApi';

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ company: { companyId: 1, companyName: 'Demo Company' } }),
}));
jest.mock('../api/companyReportsApi', () => ({
  fetchCompanyReports: jest.fn(),
  fetchCompanyReport: jest.fn(),
  runCompanyReport: jest.fn(),
}));
jest.mock('../components/reports-studio/ReportPopupModal', () => () => null);
jest.mock('../components/reports-studio/PdfViewer', () => () => null);

test('filters company reports while typing and clears the search', async () => {
  fetchCompanyReports.mockResolvedValue({ items: [
    { code: 'R1', name: 'Brokerage Calc Report' },
    { code: 'R2', name: 'Soda Sales' },
  ] });
  render(<CompanyReportsPage />);

  expect(await screen.findByText('Brokerage Calc Report')).toBeInTheDocument();
  const input = screen.getByLabelText('Search company reports');
  fireEvent.change(input, { target: { value: 'soda' } });

  expect(screen.queryByText('Brokerage Calc Report')).not.toBeInTheDocument();
  expect(screen.getByText('Soda Sales')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Clear search'));
  expect(input).toHaveValue('');
  expect(screen.getByText('Brokerage Calc Report')).toBeInTheDocument();
  expect(fetchCompanyReports).toHaveBeenCalledTimes(1);
});
