import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReportPopupModal from './ReportPopupModal';
import { fetchReportParameterLookupOptions } from '../../api/reportStudioApi';
import { installSapDateShortcuts } from '../../utils/sapDateShortcuts';

jest.mock('../../api/reportStudioApi', () => ({
  fetchReportParameterLookupOptions: jest.fn(),
}));

const props = {
  isOpen: true,
  report: { reportName: 'Sales', reportCode: 'R1', reportType: 'Crystal' },
  parameters: [{ paramName: 'ItemCode', displayName: 'Select Item', paramType: 'string' }],
  values: { ItemCode: '' },
  onChange: jest.fn(),
  onClose: jest.fn(),
  onRun: jest.fn(),
};

afterEach(() => jest.clearAllMocks());

test('runs a report with blank optional item and partner filters', () => {
  render(<ReportPopupModal {...props} parameters={[
    ...['Item', 'Buyer', 'Buyer2', 'Seller'].map((name) => ({
      paramName: name, displayName: `Select ${name}`, paramType: 'string', isRequired: false,
    })),
  ]} values={{ Item: '', Buyer: '', Buyer2: '', Seller: '' }} />);
  screen.getAllByRole('textbox').forEach((input) => expect(input).not.toBeRequired());
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  expect(props.onRun).toHaveBeenCalledTimes(1);
});

test('resolves one typed item on Tab', async () => {
  fetchReportParameterLookupOptions.mockResolvedValue({ items: [{ ItemCode: 'I101', ItemName: 'Test Item' }] });
  render(<ReportPopupModal {...props} />);

  const input = screen.getByPlaceholderText('Type or select Select Item');
  fireEvent.change(input, { target: { value: 'I101' } });
  fireEvent.keyDown(input, { key: 'Tab' });

  await waitFor(() => expect(props.onChange).toHaveBeenCalledWith('ItemCode', 'I101'));
  expect(input).toHaveValue('I101 - Test Item');
  expect(fetchReportParameterLookupOptions).toHaveBeenCalledWith(expect.objectContaining({ table: 'OITM' }), 'I101', { top: 101 });
});

test('opens a filtered lookup when typed text matches multiple items', async () => {
  fetchReportParameterLookupOptions.mockResolvedValue({ items: [
    { ItemCode: 'I101', ItemName: 'Soda One' },
    { ItemCode: 'I102', ItemName: 'Soda Two' },
  ] });
  render(<ReportPopupModal {...props} />);

  const input = screen.getByPlaceholderText('Type or select Select Item');
  fireEvent.change(input, { target: { value: 'Soda' } });
  fireEvent.keyDown(input, { key: 'Tab' });

  await waitFor(() => expect(screen.getByLabelText('Find in all records')).toHaveValue('Soda'));
  expect(await screen.findByText('Soda One')).toBeInTheDocument();
});

test('commits a day shortcut in a report date field', () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 8, 24));
  const uninstall = installSapDateShortcuts();
  try {
    render(<ReportPopupModal {...props} parameters={[
      { paramName: 'FromDate', displayName: 'From Date', paramType: 'date' },
    ]} values={{ FromDate: '2026-09-01' }} />);

    const input = screen.getByLabelText('From Date');
    fireEvent.change(input, { target: { value: '19' } });
    fireEvent.keyDown(input, { key: 'Tab' });

    expect(props.onChange).toHaveBeenCalledWith('FromDate', '2026-09-19');
  } finally {
    uninstall();
    jest.useRealTimers();
  }
});

test('asks for required lookup values before running a company report', () => {
  render(<ReportPopupModal {...props} parameters={[
    { paramName: 'SCode@Select * from OCRD', displayName: 'Select Seller', paramType: 'string', isRequired: true },
  ]} values={{ 'SCode@Select * from OCRD': '' }} />);

  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  expect(screen.getByText('Select Seller is required.')).toBeInTheDocument();
  expect(props.onRun).not.toHaveBeenCalled();
});
