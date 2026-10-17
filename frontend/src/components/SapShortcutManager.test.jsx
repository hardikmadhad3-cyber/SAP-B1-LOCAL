import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SapShortcutManager from './SapShortcutManager';

const pressFind = () => {
  const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => { window.dispatchEvent(event); });
  return event;
};

function DocumentForm() {
  const [page, setPage] = useState('/sales-order');
  return (
    <>
      <span>{page}</span>
      <button className="sap-document-toolbar__find" onClick={() => setPage('/sales-order/find')}>Find</button>
    </>
  );
}

function InlineFindForm() {
  const [mode, setMode] = useState('Add');
  return (
    <>
      <span>{mode} mode</span>
      <button data-sap-find-action onClick={() => setMode('Find')}>Find</button>
    </>
  );
}

test('Ctrl+F invokes the same document Find action as clicking the toolbar button', () => {
  render(
    <>
      <SapShortcutManager />
      <DocumentForm />
    </>,
  );

  expect(pressFind().defaultPrevented).toBe(true);
  expect(screen.getByText('/sales-order/find')).toBeInTheDocument();
});

test('Ctrl+F enters the same inline Find mode as the form button', () => {
  render(<><SapShortcutManager /><InlineFindForm /></>);
  expect(screen.getByText('Add mode')).toBeInTheDocument();
  expect(pressFind().defaultPrevented).toBe(true);
  expect(screen.getByText('Find mode')).toBeInTheDocument();
});

test('list or report pages without a primary Find action keep browser Ctrl+F', () => {
  render(<><SapShortcutManager /><div>Sales Order List</div><button>Find in report</button></>);
  expect(pressFind().defaultPrevented).toBe(false);
  expect(screen.getByText('Sales Order List')).toBeInTheDocument();
});

test('disabled, hidden, and dialog Find actions are ignored', () => {
  const disabledClick = jest.fn();
  const hiddenClick = jest.fn();
  const dialogClick = jest.fn();
  render(
    <>
      <SapShortcutManager />
      <button data-sap-find-action disabled onClick={disabledClick}>Disabled Find</button>
      <div hidden><button data-sap-find-action onClick={hiddenClick}>Hidden Find</button></div>
      <div role="dialog"><button data-sap-find-action onClick={dialogClick}>Dialog Find</button></div>
    </>,
  );

  expect(pressFind().defaultPrevented).toBe(false);
  expect(disabledClick).not.toHaveBeenCalled();
  expect(hiddenClick).not.toHaveBeenCalled();
  expect(dialogClick).not.toHaveBeenCalled();
});

test('a primary Find button click retains its existing action', () => {
  const onFind = jest.fn();
  render(<><SapShortcutManager /><button data-sap-find-action onClick={onFind}>Find</button></>);
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
  expect(onFind).toHaveBeenCalledTimes(1);
  pressFind();
  expect(onFind).toHaveBeenCalledTimes(2);
});

const press = (key, init = {}, target = window) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
};

test('Ctrl+S clicks the toolbar Add/Update button after committing the focused field', () => {
  jest.useFakeTimers();
  const onSave = jest.fn();
  render(<><SapShortcutManager /><button className="sap-document-toolbar__primary" onClick={onSave}>Add</button></>);
  expect(press('s', { ctrlKey: true }).defaultPrevented).toBe(true);
  act(() => { jest.runAllTimers(); });
  expect(onSave).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test('Ctrl+Enter clicks + Add Line', () => {
  const onAdd = jest.fn();
  render(<><SapShortcutManager /><button onClick={onAdd}>+ Add Line</button></>);
  press('Enter', { ctrlKey: true });
  expect(onAdd).toHaveBeenCalledTimes(1);
});

test('Esc closes the topmost legacy popup through its close button', () => {
  const onClose = jest.fn();
  render(
    <>
      <SapShortcutManager />
      <div className="so-modal-overlay"><div className="so-modal"><button className="so-modal__close" onClick={onClose}>x</button></div></div>
    </>,
  );
  expect(press('Escape').defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Enter and arrows move between rows of a document lines grid', () => {
  jest.useFakeTimers();
  render(
    <>
      <SapShortcutManager />
      <table className="so-grid">
        <tbody>
          <tr><td><input aria-label="Item 1" /></td><td><input aria-label="Qty 1" /></td></tr>
          <tr><td><input aria-label="Item 2" /></td><td><input aria-label="Qty 2" /></td></tr>
        </tbody>
      </table>
    </>,
  );
  const qty1 = screen.getByLabelText('Qty 1');
  qty1.focus();
  press('Enter', {}, qty1);
  act(() => { jest.runAllTimers(); });
  expect(screen.getByLabelText('Qty 2')).toHaveFocus();
  press('ArrowUp', {}, screen.getByLabelText('Qty 2'));
  expect(qty1).toHaveFocus();
  jest.useRealTimers();
});
