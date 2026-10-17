import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SalesLogisticsTab from './SalesLogisticsTab';
import DocumentTaxTab from './DocumentTaxTab';
import DocumentAccountingTab from './DocumentAccountingTab';
import SalesOrderLogistics from '../../modules/sales-order/components/LogisticsTab';
import SalesQuotationLogistics from '../../modules/sales-quotation/components/LogisticsTab';
import DeliveryLogistics from '../../modules/Delivery/components/LogisticsTab';
import ARInvoiceLogistics from '../../modules/ar-invoice/components/LogisticsTab';
import ARCreditMemoLogistics from '../../modules/ar-CreditMemo/components/LogisticsTab';
import PurchaseLogisticsTab from '../purchase-order/PurchaseLogisticsTab';
import SalesOrderAccounting from '../../modules/sales-order/components/AccountingTab';
import SalesQuotationAccounting from '../../modules/sales-quotation/components/AccountingTab';
import DeliveryAccounting from '../../modules/Delivery/components/AccountingTab';
import ARInvoiceAccounting from '../../modules/ar-invoice/components/AccountingTab';
import ARCreditMemoAccounting from '../../modules/ar-CreditMemo/components/AccountingTab';
import PurchaseOrderAccounting from '../../modules/purchase-order/components/AccountingTab';
import APInvoiceAccounting from '../../modules/APInvoice/components/AccountingTab';
import GrpoAccounting from '../../modules/grpo/components/AccountingTab';
import SalesOrderTax from '../../modules/sales-order/components/TaxTab';
import SalesQuotationTax from '../../modules/sales-quotation/components/TaxTab';
import DeliveryTax from '../../modules/Delivery/components/TaxTab';
import ARInvoiceTax from '../../modules/ar-invoice/components/TaxTab';
import ARCreditMemoTax from '../../modules/ar-CreditMemo/components/TaxTab';
import PurchaseOrderTax from '../../modules/purchase-order/components/TaxTab';
import GrpoTax from '../../modules/grpo/components/TaxTab';
import APInvoiceTax from '../../modules/APInvoice/components/TaxTab';
import DocumentEDocTab from './DocumentEDocTab';
import DocumentAttachmentsTab from './DocumentAttachmentsTab';
import DeliveryEDoc from '../../modules/Delivery/components/ElectronicDocumentsTab';
import GrpoEDoc from '../../modules/grpo/components/ElectronicDocumentsTab';

const changedNames = (onHeaderChange) => onHeaderChange.mock.calls.map(([event]) => event.target.name);

test('sales logistics writes the page-specific header keys', () => {
  const onHeaderChange = jest.fn();
  render(<DeliveryLogistics header={{}} onHeaderChange={onHeaderChange} vendorShipToAddresses={[]} vendorBillToAddresses={[]} shipTypeOpts={[]} onOpenAddressModal={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('BP Channel Name'), { target: { value: 'C1' } });
  expect(changedNames(onHeaderChange)).toEqual(['languageCode', 'bpChannelCode']);
  expect(screen.getByLabelText('Tracking No.')).toBeInTheDocument();
  expect(screen.queryByText('Procure Drop-Ship Items')).not.toBeInTheDocument();
});

test('sales order logistics shows the SAP order-only fields', () => {
  render(<SalesLogisticsTab documentType="order" header={{}} onHeaderChange={jest.fn()} />);
  expect(screen.getByRole('checkbox', { name: 'Procure Drop-Ship Items' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Allow Partial Delivery' })).toBeChecked();
  expect(screen.queryByLabelText('Tracking No.')).not.toBeInTheDocument();
});

test('quotation logistics keeps its shipTo / payTo address keys', () => {
  const onHeaderChange = jest.fn();
  render(<SalesQuotationLogistics header={{ shipTo: 'Plant 1' }} onHeaderChange={onHeaderChange} vendorShipToAddresses={[]} vendorBillToAddresses={[]} vendorPayToAddresses={[]} shipTypeOpts={[]} onOpenAddressModal={jest.fn()} />);
  expect(screen.getByLabelText('Ship To address')).toHaveValue('Plant 1');
  fireEvent.change(screen.getByLabelText('Bill To address'), { target: { value: 'HQ' } });
  expect(changedNames(onHeaderChange)).toEqual(['payTo']);
});

test('tax tab shows Export for sales and Import for purchase documents', () => {
  const { unmount } = render(<DocumentTaxTab header={{}} onHeaderChange={jest.fn()} />);
  expect(screen.getByRole('checkbox', { name: 'Export' })).toBeInTheDocument();
  expect(screen.getByText('Supply Covered under Sec 7 of IGST Act')).toBeInTheDocument();
  unmount();
  render(<GrpoTax header={{ dutyStatus: 'Exempted' }} onHeaderChange={jest.fn()} />);
  expect(screen.getByRole('checkbox', { name: 'Import' })).toBeInTheDocument();
  expect(screen.getByLabelText('Duty Status')).toHaveValue('Exempted');
});

test('tax tab without a change handler is read-only', () => {
  render(<DocumentTaxTab header={{}} />);
  expect(screen.getByLabelText('Form No.')).toBeDisabled();
});

test('accounting tab maps names, shows A/P controls and company extra fields', () => {
  const onHeaderChange = jest.fn();
  const { unmount } = render(<APInvoiceAccounting header={{}} onHeaderChange={onHeaderChange} paymentTermOptions={[]} />);
  expect(screen.getByLabelText('Control Account')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Consolidating BP'), { target: { value: 'V1' } });
  expect(changedNames(onHeaderChange)).toEqual(['consolidatingBp']);
  unmount();
  render(<GrpoAccounting header={{ advanceAmt: '500' }} onHeaderChange={jest.fn()} paymentTermOptions={[]} />);
  expect(screen.getByLabelText('Advance Amount')).toHaveValue('500');
  expect(screen.getByLabelText('Central Bank Ind.')).toHaveAttribute('name', 'centralBankInd');
});

test('sales order accounting keeps its due-date keys and shipped goods flag', () => {
  const onHeaderChange = jest.fn();
  render(<DocumentAccountingTab header={{}} onHeaderChange={onHeaderChange} names={{ dueMonths: 'recalcSelectedDate' }} fields={{ shippedGoods: true }} />);
  fireEvent.change(screen.getByLabelText('Months'), { target: { value: '2' } });
  expect(changedNames(onHeaderChange)).toEqual(['recalcSelectedDate']);
  expect(screen.getByRole('checkbox', { name: 'Use Shipped Goods Account' })).toBeInTheDocument();
});

const logisticsProps = { header: {}, onHeaderChange: jest.fn(), vendorShipToAddresses: [], vendorBillToAddresses: [], vendorPayToAddresses: [], shipTypeOpts: [], onOpenAddressModal: jest.fn() };
const accountingProps = { header: {}, onHeaderChange: jest.fn(), payTermOpts: [], paymentTermOptions: [] };
const taxProps = { header: {}, onHeaderChange: jest.fn(), onOpenTaxInfoModal: jest.fn() };

test.each([
  ['SO logistics', SalesOrderLogistics, logisticsProps],
  ['A/R invoice logistics', ARInvoiceLogistics, logisticsProps],
  ['A/R credit memo logistics', ARCreditMemoLogistics, logisticsProps],
  ['purchase logistics', PurchaseLogisticsTab, logisticsProps],
  ['SO accounting', SalesOrderAccounting, accountingProps],
  ['SQ accounting', SalesQuotationAccounting, accountingProps],
  ['Delivery accounting', DeliveryAccounting, accountingProps],
  ['A/R invoice accounting', ARInvoiceAccounting, accountingProps],
  ['A/R credit memo accounting', ARCreditMemoAccounting, accountingProps],
  ['PO accounting', PurchaseOrderAccounting, accountingProps],
  ['SO tax', SalesOrderTax, taxProps],
  ['SQ tax', SalesQuotationTax, taxProps],
  ['Delivery tax', DeliveryTax, taxProps],
  ['A/R invoice tax', ARInvoiceTax, { ...taxProps, showTaxInvoiceReference: true }],
  ['A/R credit memo tax', ARCreditMemoTax, taxProps],
  ['PO tax', PurchaseOrderTax, taxProps],
  ['A/P invoice tax', APInvoiceTax, taxProps],
])('%s renders in the shared document tab layout', (_name, Tab, props) => {
  render(<Tab {...props} />);
  expect(screen.getByRole('tabpanel')).toHaveClass('sap-doc-tab');
});


test('electronic documents: sales generic block has a generation type, purchase shows received fields', () => {
  const { unmount } = render(<DeliveryEDoc header={{ edocExportFormat: '7' }} onHeaderChange={jest.fn()} formats={[{ AbsEntry: 7, Name: 'EWB JSON' }]} onOpenEWayBill={jest.fn()} />);
  expect(screen.getAllByLabelText('eDoc Format')[0]).toHaveValue('7');
  expect(screen.getAllByLabelText('eDoc Generation Type')).toHaveLength(2);
  unmount();
  const onHeaderChange = jest.fn();
  render(<GrpoEDoc header={{}} onHeaderChange={onHeaderChange} />);
  expect(screen.getByLabelText('Date Received')).toBeInTheDocument();
  fireEvent.change(screen.getAllByLabelText('eDoc Format')[1], { target: { value: 'XML' } });
  expect(changedNames(onHeaderChange)).toEqual(['edocFormat']);
});

test('electronic documents without a handler are read-only', () => {
  render(<DocumentEDocTab />);
  expect(screen.getAllByLabelText('eDoc Generation Type')[0]).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Open E-Way Bill Details' })).toBeDisabled();
});

test('attachments: Display/Delete act on the selected row when handlers exist', () => {
  const onDelete = jest.fn();
  render(<DocumentAttachmentsTab attachments={[{ id: 1, fileName: 'po.pdf' }]} onBrowseAttachment={jest.fn()} onDeleteAttachment={onDelete} />);
  const del = screen.getByRole('button', { name: 'Delete' });
  expect(del).toBeDisabled();
  fireEvent.click(screen.getByText('po.pdf'));
  fireEvent.click(del);
  expect(onDelete).toHaveBeenCalledWith({ id: 1, fileName: 'po.pdf' });
  expect(screen.getByRole('button', { name: 'Display' })).toBeDisabled();
});
