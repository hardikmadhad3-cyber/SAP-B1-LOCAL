import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PdfViewer from './PdfViewer';
import { loadPdfDocument } from '../../utils/pdfRenderer';
import { downloadPdfUrl } from '../../utils/pdfUtils';

jest.mock('../../utils/pdfRenderer', () => ({ loadPdfDocument: jest.fn() }));
jest.mock('../../utils/pdfUtils', () => ({ downloadPdfUrl: jest.fn() }));

let getPage;
let renderPage;
beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({});
  renderPage = jest.fn(() => ({ promise: Promise.resolve(), cancel: jest.fn() }));
  getPage = jest.fn().mockResolvedValue({
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }), render: renderPage,
  });
  loadPdfDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 25, getPage }), destroy: jest.fn().mockResolvedValue(),
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });
const props = { isOpen: true, previewUrl: 'blob:report', fileName: 'Report.pdf', onClose: jest.fn(), onOpen: jest.fn() };

test('renders only the chosen page and supports navigation and zoom', async () => {
  render(<PdfViewer {...props} />);
  await screen.findByText('Current page: 1 / 25');
  expect(getPage).toHaveBeenCalledWith(1);
  expect(document.querySelectorAll('canvas')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Current page: 2 / 25');
  expect(document.querySelectorAll('canvas')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Page number'), { target: { value: '25' } });
  fireEvent.keyDown(screen.getByLabelText('Page number'), { key: 'Enter' });
  await screen.findByText('Current page: 25 / 25');
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '150' } });
  await waitFor(() => expect(renderPage).toHaveBeenLastCalledWith(expect.objectContaining({ viewport: { width: 1200, height: 1600 } })));
});

test('shared download uses the Save As helper', async () => {
  downloadPdfUrl.mockResolvedValue({ saved: true });
  render(<PdfViewer {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await screen.findByText('PDF saved.');
  expect(downloadPdfUrl).toHaveBeenCalledWith('blob:report', 'Report.pdf');
});

test('closing and reopening a report does not reuse its destroyed worker', async () => {
  const tasks = [];
  loadPdfDocument.mockImplementation(() => {
    let destroyed = false;
    const document = {
      numPages: 25,
      getPage: jest.fn((page) => {
        if (destroyed) throw new TypeError("Cannot read properties of null (reading 'sendWithPromise')");
        return getPage(page);
      }),
    };
    const task = { promise: Promise.resolve(document), destroy: jest.fn(async () => { destroyed = true; }), document };
    tasks.push(task);
    return task;
  });
  const { rerender } = render(<React.StrictMode><PdfViewer {...props} /></React.StrictMode>);
  await screen.findByText('Current page: 1 / 25');
  const first = tasks[tasks.length - 1];
  rerender(<React.StrictMode><PdfViewer {...props} isOpen={false} /></React.StrictMode>);
  expect(first.destroy).toHaveBeenCalledTimes(1);
  const callsBeforeReopen = first.document.getPage.mock.calls.length;
  rerender(<React.StrictMode><PdfViewer {...props} /></React.StrictMode>);
  await screen.findByText('Current page: 1 / 25');
  expect(first.document.getPage).toHaveBeenCalledTimes(callsBeforeReopen);
  const reopened = tasks[tasks.length - 1];
  rerender(<React.StrictMode><PdfViewer {...props} previewUrl="blob:another-report" /></React.StrictMode>);
  await screen.findByText('Current page: 1 / 25');
  expect(reopened.destroy).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a synchronous PDF worker failure stays inside the preview', async () => {
  getPage.mockImplementation(() => {
    throw new TypeError("Cannot read properties of null (reading 'sendWithPromise')");
  });
  render(<PdfViewer {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not render this page');
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Close preview' })).toBeEnabled();
});
