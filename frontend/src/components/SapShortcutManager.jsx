import { useEffect } from 'react';

// SAP B1 keyboard behaviour for every page. Each shortcut clicks the same
// visible button the user would click, so page logic stays in one place:
//   Ctrl+F      Find            Ctrl+S      Add / Update (toolbar primary)
//   Ctrl+Enter  + Add Line      Esc         close the topmost legacy popup
//   Enter / Up / Down inside a Document Lines grid move to the cell below/above.
const FIND_ACTION_SELECTOR = 'button.sap-document-toolbar__find, button[data-sap-find-action]';
const PRIMARY_ACTION_SELECTOR = 'button.sap-document-toolbar__primary, button[data-sap-primary-action], .im-toolbar > button.im-btn--primary';
const DIALOG_SELECTOR = 'dialog, [role="dialog"]';
// Popups not built on SapModalShell (which handles Esc itself).
const LEGACY_OVERLAY_SELECTOR = [
  '.so-modal-overlay', '.del-modal-overlay', '.po-modal-overlay', '.im-modal-overlay',
  '.pt-modal-overlay', '.tc-modal-overlay', '.uom-modal-overlay', '.so-reference-modal-overlay',
  '.ifp-po-modal-overlay', '.rfp-po-modal-overlay', '.rfp-alloc-modal-overlay', '.batch-serial-modal-overlay',
].join(', ');
const LEGACY_CLOSE_SELECTOR = '[class*="modal__close"], [aria-label^="Close"]';
const GRID_SELECTOR = 'table.so-grid, table.del-grid, table.po-grid';
const FOCUSABLE_CELL_CONTROL = 'input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])';

const isVisible = (element) => {
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
};

const isInDialog = (element) => element instanceof Element && Boolean(element.closest(DIALOG_SELECTOR));

const findPageButton = (selector, predicate = () => true) => (
  Array.from(document.querySelectorAll(selector))
    .find((button) => !button.disabled && !isInDialog(button) && predicate(button) && isVisible(button))
);

const isAddLineButton = (button) => button.hasAttribute('data-sap-add-line') || /^\+\s*Add Line$/i.test(button.textContent.trim());

const focusCellControl = (cell) => {
  const control = cell?.querySelector(FOCUSABLE_CELL_CONTROL);
  if (!control) return false;
  control.focus();
  if (typeof control.select === 'function' && control.tagName === 'INPUT') control.select();
  return true;
};

// Enter / ArrowUp / ArrowDown in a grid cell -> same column, next/previous row.
const moveInGrid = (event) => {
  const target = event.target;
  if (!(target instanceof Element) || !target.matches('input, select')) return false;
  if (target.matches('[type="checkbox"], [type="radio"]') || target.getAttribute('aria-expanded') === 'true') return false;
  const isEnter = event.key === 'Enter';
  // Arrows already mean something in selects and number inputs.
  if (!isEnter && (target.tagName === 'SELECT' || target.type === 'number')) return false;
  const cell = target.closest('td');
  const table = cell?.closest(GRID_SELECTOR);
  if (!cell || !table) return false;
  const row = cell.parentElement;
  const nextRow = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
  if (!nextRow) return false;
  event.preventDefault();
  const move = () => {
    // A cell's own Enter handler may have opened a lookup; leave focus to it.
    if (document.querySelector(DIALOG_SELECTOR)) return;
    focusCellControl(nextRow.cells[cell.cellIndex]);
  };
  if (isEnter) window.setTimeout(move, 0);
  else move();
  return true;
};

const closeTopLegacyPopup = () => {
  if (document.querySelector('.sap-modal-shell__overlay')) return false;
  const overlays = Array.from(document.querySelectorAll(LEGACY_OVERLAY_SELECTOR)).filter(isVisible);
  const top = overlays[overlays.length - 1];
  const closeButton = top && Array.from(top.querySelectorAll(LEGACY_CLOSE_SELECTOR)).find((button) => !button.disabled);
  if (!closeButton) return false;
  closeButton.click();
  return true;
};

export default function SapShortcutManager() {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.altKey || event.metaKey) return;
      const key = String(event.key || '');

      if (key === 'Escape' && !event.ctrlKey && !event.shiftKey) {
        if (closeTopLegacyPopup()) event.preventDefault();
        return;
      }

      if (!event.ctrlKey && !event.shiftKey && ['Enter', 'ArrowDown', 'ArrowUp'].includes(key)) {
        moveInGrid(event);
        return;
      }

      if (!event.ctrlKey || event.shiftKey || event.repeat || isInDialog(event.target)) return;
      const lowerKey = key.toLowerCase();

      let button = null;
      if (lowerKey === 'f') button = findPageButton(FIND_ACTION_SELECTOR);
      else if (lowerKey === 's') button = findPageButton(PRIMARY_ACTION_SELECTOR);
      else if (key === 'Enter') button = findPageButton('button', isAddLineButton);
      if (!button) return;

      event.preventDefault();
      if (lowerKey === 's') {
        // Commit the focused field (onBlur formatting) before saving, as a mouse click would.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.setTimeout(() => button.click(), 0);
        return;
      }
      button.click();
      if (key === 'Enter') {
        window.setTimeout(() => {
          const panel = button.closest('[class*="tab-panel"]') || document;
          const rows = panel.querySelectorAll(`${GRID_SELECTOR.split(', ').map((grid) => `${grid} tbody tr`).join(', ')}`);
          const lastRow = rows[rows.length - 1];
          if (lastRow) Array.from(lastRow.cells).some(focusCellControl);
        }, 0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}
