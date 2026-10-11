import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SapFindShortcutManager from './SapFindShortcutManager';

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
      <SapFindShortcutManager />
      <DocumentForm />
    </>,
  );

  expect(pressFind().defaultPrevented).toBe(true);
  expect(screen.getByText('/sales-order/find')).toBeInTheDocument();
});

test('Ctrl+F enters the same inline Find mode as the form button', () => {
  render(<><SapFindShortcutManager /><InlineFindForm /></>);
  expect(screen.getByText('Add mode')).toBeInTheDocument();
  expect(pressFind().defaultPrevented).toBe(true);
  expect(screen.getByText('Find mode')).toBeInTheDocument();
});

test('list or report pages without a primary Find action keep browser Ctrl+F', () => {
  render(<><SapFindShortcutManager /><div>Sales Order List</div><button>Find in report</button></>);
  expect(pressFind().defaultPrevented).toBe(false);
  expect(screen.getByText('Sales Order List')).toBeInTheDocument();
});

test('disabled, hidden, and dialog Find actions are ignored', () => {
  const disabledClick = jest.fn();
  const hiddenClick = jest.fn();
  const dialogClick = jest.fn();
  render(
    <>
      <SapFindShortcutManager />
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
  render(<><SapFindShortcutManager /><button data-sap-find-action onClick={onFind}>Find</button></>);
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
  expect(onFind).toHaveBeenCalledTimes(1);
  pressFind();
  expect(onFind).toHaveBeenCalledTimes(2);
});
