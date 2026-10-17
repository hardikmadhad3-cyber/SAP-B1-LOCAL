import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentStatusActions from './DocumentStatusActions';
import { runDocumentAction } from '../../api/documentActionsApi';

jest.mock('../../api/documentActionsApi', () => ({ runDocumentAction: jest.fn() }));

const menuOf = () => screen.getByRole('button', { name: 'Data ▼' }).parentElement;

describe('DocumentStatusActions', () => {
  beforeEach(() => {
    runDocumentAction.mockReset();
    window.confirm = jest.fn(() => true);
  });

  it('renders nothing for an unsaved document', () => {
    const { container } = render(<DocumentStatusActions type="ar-invoice" docEntry={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is one Data menu in the page dropdown family, ordered after Copy To', () => {
    render(<DocumentStatusActions type="grpo" docEntry={7} actions={['close', 'cancel']} className="po-btn" />);
    expect(menuOf()).toHaveClass('po-dropdown', 'sap-document-toolbar__data');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Close Document', 'Cancel Document']);
    fireEvent.click(screen.getByRole('button', { name: 'Data ▼' }));
    expect(menuOf()).toHaveClass('active');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menuOf()).not.toHaveClass('active');
    fireEvent.click(screen.getByRole('button', { name: 'Data ▼' }));
    fireEvent.click(document.body);
    expect(menuOf()).not.toHaveClass('active');
  });

  it('cancels after confirmation and reports success', async () => {
    runDocumentAction.mockResolvedValue({ success: true });
    const onDone = jest.fn();
    render(<DocumentStatusActions type="delivery" docEntry={7} actions={['close', 'cancel']} className="del-btn" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Data ▼' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel Document' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('cancel', { success: true }));
    expect(runDocumentAction).toHaveBeenCalledWith('delivery', 7, 'cancel');
    expect(menuOf()).not.toHaveClass('active');
  });

  it('does nothing when the confirmation is declined and shows server errors', async () => {
    window.confirm = jest.fn(() => false);
    const onError = jest.fn();
    const { rerender } = render(<DocumentStatusActions type="ar-invoice" docEntry={3} onError={onError} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel Document' }));
    expect(runDocumentAction).not.toHaveBeenCalled();

    window.confirm = jest.fn(() => true);
    runDocumentAction.mockRejectedValue({ response: { data: { message: 'The document is paid or reconciled; cancel the payments first.' } } });
    rerender(<DocumentStatusActions type="ar-invoice" docEntry={3} onError={onError} />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel Document' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('The document is paid or reconciled; cancel the payments first.'));
  });
});
