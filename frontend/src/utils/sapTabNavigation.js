import { useCallback } from 'react';

const FOCUSABLE_SELECTOR = [
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const NATIVE_TAB_STOP_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const getItemCode = (item = {}) =>
  String(item.ItemCode ?? item.itemCode ?? item.code ?? '').trim();

const getItemName = (item = {}) =>
  String(item.ItemName ?? item.itemName ?? item.name ?? item.ItemDescription ?? '').trim();

const getItemForeignName = (item = {}) =>
  String(item.ForeignName ?? item.FrgnName ?? item.foreignName ?? '').trim();

const isElementVisible = (element) => {
  if (!element || element.hidden) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rects = element.getClientRects();
  return rects.length > 0;
};

export const isEditableTabStop = (element) => {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (!element.matches(FOCUSABLE_SELECTOR)) return false;
  if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
  if (element.dataset.sapSkipTab === 'true') return false;
  if (element.tagName === 'INPUT' && element.type === 'hidden') return false;
  if (element.readOnly && element.dataset.sapTabReadonly !== 'true') return false;
  return isElementVisible(element);
};

const getFocusableElements = (root = document) =>
  Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isEditableTabStop);

const isNativeTabStop = (element) => {
  if (!element || !(element instanceof HTMLElement)) return false;
  if (!element.matches(NATIVE_TAB_STOP_SELECTOR)) return false;
  if (element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
  if (element.tabIndex < 0) return false;
  if (element.dataset.sapSkipTab === 'true') return false;
  if (element.tagName === 'INPUT' && element.type === 'hidden') return false;
  return isElementVisible(element);
};

const getNativeTabStops = (root = document) =>
  Array.from(root.querySelectorAll(NATIVE_TAB_STOP_SELECTOR)).filter(isNativeTabStop);

export const focusElement = (element) => {
  if (!element) return false;
  element.focus({ preventScroll: true });
  element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  const canSelectText = element instanceof HTMLTextAreaElement || (
    element instanceof HTMLInputElement
    && !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type)
  );
  if (canSelectText) element.select();
  return document.activeElement === element;
};

const getElementIdentity = (element) => {
  if (!element || !(element instanceof HTMLElement)) return null;

  const table = element.closest('table');
  const row = element.closest('tr');
  const rowIndex = row && table
    ? Array.from(table.querySelectorAll('tbody tr')).indexOf(row)
    : -1;

  return {
    element,
    name: element.getAttribute('name') || '',
    rowIndex,
    sapRowIndex: element.dataset.sapRowIndex || '',
    documentIndex: getFocusableElements(document).indexOf(element),
  };
};

const findElementByIdentity = (identity) => {
  if (!identity) return null;
  if (identity.element && document.contains(identity.element) && isEditableTabStop(identity.element)) {
    return identity.element;
  }

  const nameSelector = identity.name ? `[name="${CSS.escape(identity.name)}"]` : '';
  const rowSelector = identity.sapRowIndex ? `[data-sap-row-index="${CSS.escape(identity.sapRowIndex)}"]` : '';
  const namedCandidates = nameSelector
    ? getFocusableElements(document).filter((element) => element.matches(`${nameSelector}${rowSelector}`))
    : [];

  if (namedCandidates.length) return namedCandidates[0];

  if (identity.name && identity.rowIndex >= 0) {
    const rowMatches = Array.from(document.querySelectorAll('tbody tr'))
      .map((row) => getFocusableElements(row).find((element) => element.getAttribute('name') === identity.name))
      .filter(Boolean);
    if (rowMatches[identity.rowIndex]) return rowMatches[identity.rowIndex];
  }

  const fields = getFocusableElements(document);
  return fields[identity.documentIndex] || null;
};

const getLookupValue = (element) => String(element?.value || '').trim();

const markLookupResolved = (element) => {
  if (!element || !(element instanceof HTMLElement)) return;
  const value = getLookupValue(element);
  if (value) {
    element.dataset.sapLookupResolvedValue = value;
    element.dataset.sapValueOnFocus = value;
  } else {
    delete element.dataset.sapLookupResolvedValue;
  }
};

const isLookupDialogContainer = (element) => {
  if (!element || element === document.body || !(element instanceof HTMLElement)) return false;

  const buttons = Array.from(element.querySelectorAll('button'));
  const hasChoose = buttons.some((button) => /^choose$/i.test(String(button.textContent || '').trim()));
  const hasCancel = buttons.some((button) => /^cancel$/i.test(String(button.textContent || '').trim()));
  const hasTable = Boolean(element.querySelector('table tbody'));
  const hasSearch = Array.from(element.querySelectorAll('input')).some(isEditableTabStop);

  return hasChoose && hasCancel && hasTable && hasSearch;
};

const getLookupDialog = (target) => {
  let current = target instanceof HTMLElement ? target : target?.parentElement;
  while (current && current !== document.body) {
    if (isLookupDialogContainer(current)) return current;
    current = current.parentElement;
  }
  return null;
};

const getLookupRows = (dialog) =>
  Array.from(dialog.querySelectorAll('tbody tr')).filter((row) => {
    if (!isElementVisible(row)) return false;
    if (row.querySelector('td[colspan]')) return false;
    return row.cells.length > 1;
  });

const getLookupButtons = (dialog) => {
  const buttons = Array.from(dialog.querySelectorAll('button')).filter((button) => (
    isElementVisible(button) && button.tabIndex !== -1 && button.getAttribute('aria-hidden') !== 'true'
  ));

  return {
    choose: buttons.find((button) => /^choose$/i.test(String(button.textContent || '').trim())) || null,
    cancel: buttons.find((button) => /^cancel$/i.test(String(button.textContent || '').trim())) || null,
    paging: buttons.filter((button) => /^[<>]$/.test(String(button.textContent || '').trim())),
    actionButtons: buttons.filter((button) => /^(choose|cancel|new)$/i.test(String(button.textContent || '').trim())),
  };
};

const getLookupSearchInput = (dialog) =>
  Array.from(dialog.querySelectorAll('input')).find(isEditableTabStop) || null;

const getStyledSelectedRowIndex = (rows) => rows.findIndex((row) => {
  const color = window.getComputedStyle(row).backgroundColor;
  return color === 'rgb(255, 248, 197)' || color === 'rgb(255, 255, 204)';
});

const getCurrentLookupRowIndex = (dialog, rows) => {
  const focusedRow = document.activeElement?.closest?.('tbody tr');
  const focusedIndex = rows.indexOf(focusedRow);
  if (focusedIndex >= 0) return focusedIndex;

  const styledIndex = getStyledSelectedRowIndex(rows);
  if (styledIndex >= 0) return styledIndex;

  const storedIndex = Number(dialog.dataset.sapLookupRowIndex);
  return Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < rows.length ? storedIndex : -1;
};

const focusLookupRow = (dialog, rows, index) => {
  if (!rows.length) return false;

  const nextIndex = Math.max(0, Math.min(rows.length - 1, index));
  const row = rows[nextIndex];
  dialog.dataset.sapLookupRowIndex = String(nextIndex);
  row.tabIndex = 0;
  row.click();
  row.focus({ preventScroll: true });
  row.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return true;
};

const focusFirstLookupControl = (controls) => {
  const next = controls.find((control) => control && !control.disabled);
  return focusElement(next);
};

const chooseLookupRow = (dialog, rows) => {
  if (!rows.length) return false;

  const index = getCurrentLookupRowIndex(dialog, rows);
  const row = rows[index >= 0 ? index : 0];
  dialog.dataset.sapLookupRowIndex = String(rows.indexOf(row));
  row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  return true;
};

const handleLookupDialogKeyDown = (event) => {
  const dialog = getLookupDialog(event.target);
  if (!dialog) return false;

  const rows = getLookupRows(dialog);
  const searchInput = getLookupSearchInput(dialog);
  const buttons = getLookupButtons(dialog);
  const currentIndex = getCurrentLookupRowIndex(dialog, rows);
  const targetRow = event.target?.closest?.('tbody tr');

  if (event.key === 'Escape') {
    event.preventDefault();
    (buttons.cancel || dialog.querySelector('[aria-label="Close"]'))?.click();
    return true;
  }

  if (event.key === 'ArrowDown' && rows.length) {
    event.preventDefault();
    focusLookupRow(dialog, rows, currentIndex < 0 ? 0 : currentIndex + 1);
    return true;
  }

  if (event.key === 'ArrowUp' && rows.length) {
    event.preventDefault();
    focusLookupRow(dialog, rows, currentIndex < 0 ? rows.length - 1 : currentIndex - 1);
    return true;
  }

  if (event.key === 'Enter') {
    if (event.target instanceof HTMLButtonElement) return false;
    event.preventDefault();
    if (chooseLookupRow(dialog, rows)) return true;
    buttons.choose?.click();
    return true;
  }

  if (event.key !== 'Tab') return false;

  event.preventDefault();

  const forwardControls = [
    ...buttons.paging,
    buttons.choose,
    buttons.cancel,
  ].filter(Boolean);

  const backwardControls = [
    buttons.cancel,
    buttons.choose,
    ...buttons.paging.slice().reverse(),
  ].filter(Boolean);

  if (event.shiftKey) {
    if (event.target === searchInput) {
      focusFirstLookupControl(backwardControls);
      return true;
    }

    if (event.target instanceof HTMLButtonElement) {
      const controlIndex = forwardControls.indexOf(event.target);
      if (controlIndex > 0) {
        focusElement(forwardControls[controlIndex - 1]);
        return true;
      }
      if (rows.length) {
        focusLookupRow(dialog, rows, currentIndex >= 0 ? currentIndex : 0);
        return true;
      }
    }

    focusElement(searchInput);
    return true;
  }

  if (event.target === searchInput) {
    if (rows.length) {
      focusLookupRow(dialog, rows, currentIndex >= 0 ? currentIndex : 0);
      return true;
    }
    focusFirstLookupControl(forwardControls);
    return true;
  }

  if (targetRow) {
    focusFirstLookupControl(forwardControls);
    return true;
  }

  if (event.target instanceof HTMLButtonElement) {
    const controlIndex = forwardControls.indexOf(event.target);
    if (controlIndex >= 0 && controlIndex < forwardControls.length - 1) {
      focusElement(forwardControls[controlIndex + 1]);
      return true;
    }
  }

  focusElement(searchInput);
  return true;
};

export const focusFirstSapField = (delay = 160) => {
  if (typeof window === 'undefined') return;

  window.setTimeout(() => {
    if (getLookupDialog(document.activeElement)) return;
    if (document.querySelector('[role="dialog"], .po-modal, .im-modal')) return;

    const root =
      document.querySelector('fieldset:not([disabled])') ||
      document.querySelector('.po-layout__main, .so-layout__main, .del-layout__main, .im-page, main') ||
      document.body;

    const firstField = getFocusableElements(root).find((element) => (
      element.dataset.sapSkipInitialFocus !== 'true' &&
      !element.closest('.sap-document-toolbar, .app-header, .sidebar, .modal-footer') &&
      element.type !== 'search'
    ));

    if (firstField) focusElement(firstField);
  }, delay);
};

export const focusNextSapField = (fromElement = document.activeElement, direction = 1) => {
  if (direction > 0 && focusNewGridRowAfterAdd(fromElement)) return true;

  const fields = getFocusableElements(document);
  if (!fields.length) return false;

  const currentIndex = fields.indexOf(fromElement);
  const nextIndex = currentIndex >= 0
    ? currentIndex + direction
    : direction > 0 ? 0 : fields.length - 1;

  const boundedIndex = Math.max(0, Math.min(fields.length - 1, nextIndex));
  return focusElement(fields[boundedIndex]);
};

const keepNativeTabInsideDocument = (event, target) => {
  const tabStops = getNativeTabStops(document);
  if (!tabStops.length) return false;

  const currentIndex = tabStops.indexOf(target);
  if (currentIndex < 0) return false;

  const isFirst = currentIndex === 0;
  const isLast = currentIndex === tabStops.length - 1;
  if ((!event.shiftKey && !isLast) || (event.shiftKey && !isFirst)) return false;

  event.preventDefault();
  return focusElement(event.shiftKey ? tabStops[tabStops.length - 1] : tabStops[0]);
};

const pendingLookupFocus = {
  element: null,
  identity: null,
};

export const consumePendingLookupQuery = () => {
  if (typeof window === 'undefined') return '';
  const query = String(window.__sapB1PendingLookupQuery || '').trim();
  window.__sapB1PendingLookupQuery = '';
  return query;
};

export const setPendingLookupFocus = (element) => {
  pendingLookupFocus.element = element || document.activeElement;
  pendingLookupFocus.identity = getElementIdentity(pendingLookupFocus.element);
};

const clearPendingLookupFocus = () => {
  pendingLookupFocus.element = null;
  pendingLookupFocus.identity = null;
};

export const completePendingLookupFocus = (delay = 80) => {
  const identity = pendingLookupFocus.identity || getElementIdentity(pendingLookupFocus.element);
  if (!identity) return false;

  clearPendingLookupFocus();
  window.setTimeout(() => {
    const origin = findElementByIdentity(identity) || document.activeElement;
    markLookupResolved(origin);
    focusNextSapField(origin, 1);
  }, delay);
  return true;
};

export const restorePendingLookupFocus = (delay = 80) => {
  const identity = pendingLookupFocus.identity || getElementIdentity(pendingLookupFocus.element);
  if (!identity) return false;

  clearPendingLookupFocus();
  window.setTimeout(() => {
    const origin = findElementByIdentity(identity);
    if (origin) focusElement(origin);
  }, delay);
  return true;
};

const focusNewGridRowAfterAdd = (element) => {
  const table = element?.closest('table');
  if (!table) return false;

  const tableFields = getFocusableElements(table);
  if (!tableFields.length || tableFields[tableFields.length - 1] !== element) return false;

  const panel = table.closest('.so-tab-panel, .del-tab-panel, .po-tab-panel, .gr-document__tab-body') || table.parentElement;
  const addButton = Array.from(panel?.querySelectorAll('button') || [])
    .find((button) => /add\s+line/i.test(button.textContent || '') && !button.disabled);
  if (!addButton) return false;

  const previousRowCount = table.querySelectorAll('tbody tr').length;
  addButton.click();

  window.setTimeout(() => {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const newRow = rows[previousRowCount] || rows[rows.length - 1];
    const firstEditable = getFocusableElements(newRow)[0];
    if (firstEditable) focusElement(firstEditable);
  }, 80);

  return true;
};

const installWindowApi = () => {
  window.SapB1TabNavigation = {
    ...(window.SapB1TabNavigation || {}),
    focusNext: focusNextSapField,
    setPendingLookupFocus,
    completeLookup: completePendingLookupFocus,
    restoreLookup: restorePendingLookupFocus,
  };
};

const LOOKUP_CONTAINER_SELECTOR = [
  '.po-udf-lookup-control',
  '.im-lookup-wrap',
  '.so-lookup-wrap',
  '.del-lookup-wrap',
  '.po-lookup-wrap',
  '.sap-lookup-wrap',
  '.sap-lookup',
].join(',');

const isLookupButton = (button) => {
  if (!button || button.disabled || button.dataset.sapSkipTab === 'true') return false;

  const label = `${button.dataset.sapLookupButton || ''} ${button.title || ''} ${button.textContent || ''}`
    .trim()
    .toLowerCase();

  return (
    button.dataset.sapLookupButton === 'true' ||
    label === '...' ||
    label.includes('...') ||
    /\b(select|list|lookup|choose|find|search)\b/.test(label)
  );
};

const findLookupButtonForField = (target) => {
  const explicitLookupId = target?.dataset?.sapLookupTarget;
  if (explicitLookupId) {
    const explicitButton = document.getElementById(explicitLookupId);
    if (isLookupButton(explicitButton)) return explicitButton;
  }

  const container = target?.closest(LOOKUP_CONTAINER_SELECTOR) || target?.parentElement;
  const containerButton = Array.from(container?.querySelectorAll('button') || []).find(isLookupButton);
  if (containerButton) return containerButton;

  const sibling = target?.nextElementSibling;
  if (sibling?.tagName === 'BUTTON' && isLookupButton(sibling)) return sibling;

  return null;
};

const findLookupFieldForButton = (button) => {
  const container = button?.closest(LOOKUP_CONTAINER_SELECTOR) || button?.parentElement;
  if (!container) return null;
  return getFocusableElements(container).find((element) => element !== button) || null;
};

const openLookupFromFieldIfNeeded = (event, target) => {
  if (event.shiftKey) return false;

  const value = String(target?.value || '').trim();
  const lookupButton = findLookupButtonForField(target);
  if (!lookupButton) return false;

  const valueOnFocus = String(target.dataset.sapValueOnFocus || '').trim();
  const resolvedValue = String(target.dataset.sapLookupResolvedValue || '').trim();
  const hasUnchangedFilledValue = value && value === valueOnFocus;
  const hasResolvedValue = value && value === resolvedValue;
  if (hasUnchangedFilledValue || hasResolvedValue) {
    return false;
  }

  event.preventDefault();
  window.__sapB1PendingLookupQuery = value;
  setPendingLookupFocus(target);
  lookupButton.click();
  return true;
};

export const installSapTabNavigation = () => {
  if (typeof window === 'undefined' || window.__sapB1TabNavigationInstalled) {
    installWindowApi();
    return () => {};
  }

  window.__sapB1TabNavigationInstalled = true;
  installWindowApi();

  const handleFocusIn = (event) => {
    const target = event.target;
    if (!isEditableTabStop(target)) return;
    target.dataset.sapValueOnFocus = getLookupValue(target);
  };

  const handleInput = (event) => {
    const target = event.target;
    if (!target || !(target instanceof HTMLElement)) return;
    if (getLookupValue(target) !== String(target.dataset.sapLookupResolvedValue || '').trim()) {
      delete target.dataset.sapLookupResolvedValue;
    }
  };

  const handlePointerDown = (event) => {
    const button = event.target?.closest?.('button');
    if (!isLookupButton(button)) return;

    const field = findLookupFieldForButton(button);
    if (field) setPendingLookupFocus(field);
  };

  const handleKeyDown = (event) => {
    if (handleLookupDialogKeyDown(event)) return;

    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.defaultPrevented) return;

    const target = event.target;
    if (!isEditableTabStop(target)) {
      const keptInside = keepNativeTabInsideDocument(event, target);
      if (!keptInside && (target === document.body || target === document.documentElement)) {
        event.preventDefault();
        focusNextSapField(null, event.shiftKey ? -1 : 1);
      }
      return;
    }
    if (target.dataset.sapNativeTab === 'true') {
      keepNativeTabInsideDocument(event, target);
      return;
    }
    if (openLookupFromFieldIfNeeded(event, target)) return;

    // Let the browser move between ordinary document fields. React-controlled
    // matrix cells can rerender during change/blur; cancelling Tab and looking
    // up the old element after that rerender can resolve back to the same cell
    // (most visibly on Discount %). Custom focus remains limited to lookups,
    // lookup dialogs, and the first/last document boundary.
    keepNativeTabInsideDocument(event, target);
  };

  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('input', handleInput);
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('keydown', handleKeyDown);

  return () => {
    document.removeEventListener('focusin', handleFocusIn);
    document.removeEventListener('input', handleInput);
    document.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('keydown', handleKeyDown);
    window.__sapB1TabNavigationInstalled = false;
  };
};

export const resolveSapItemLookup = (query, items = []) => {
  const needle = normalize(query);
  if (!needle) return { status: 'empty', matches: [] };

  const source = Array.isArray(items) ? items : [];
  const exactMatches = source.filter((item) => normalize(getItemCode(item)) === needle);
  if (exactMatches.length === 1) {
    return { status: 'single', item: exactMatches[0], matches: exactMatches };
  }

  const matches = source.filter((item) => {
    const haystack = [
      getItemCode(item),
      getItemName(item),
      getItemForeignName(item),
      item.ItemGroup,
      item.itemGroup,
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  });

  if (matches.length === 1) return { status: 'single', item: matches[0], matches };
  if (matches.length > 1) return { status: 'multiple', matches };
  return { status: 'none', matches: [] };
};

const showFieldValidation = (element, message) => {
  if (!element) return;
  element.setCustomValidity(message);
  element.reportValidity?.();
  element.focus();
  window.setTimeout(() => {
    if (document.activeElement === element) {
      element.setCustomValidity('');
    }
  }, 2500);
};

export function useSapItemCodeTab({
  lineItemOptions,
  onLineChange,
  onOpenItemModal,
}) {
  const handleItemCodeTab = useCallback(async (event, rowIndex) => {
    if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const input = event.currentTarget;
    const query = String(input.value || '').trim();
    const items = Array.isArray(lineItemOptions)
      ? lineItemOptions
      : lineItemOptions?.[rowIndex] || [];

    if (!query) {
      event.preventDefault();
      event.stopPropagation();
      window.__sapB1PendingLookupQuery = '';
      setPendingLookupFocus(input);
      onOpenItemModal?.(rowIndex, '', items);
      return;
    }

    const result = resolveSapItemLookup(query, items);

    if (result.status === 'empty') return;

    event.preventDefault();
    event.stopPropagation();

    if (result.status === 'none') {
      // Reference data can be a subset of the company item master. Let the
      // lookup search its full data source before declaring the entry invalid.
      window.__sapB1PendingLookupQuery = query;
      setPendingLookupFocus(input);
      onOpenItemModal?.(rowIndex, query, []);
      return;
    }

    if (result.status === 'multiple'
      || (result.status === 'single' && normalize(getItemCode(result.item)) !== normalize(query))) {
      window.__sapB1PendingLookupQuery = query;
      setPendingLookupFocus(input);
      onOpenItemModal?.(rowIndex, query, result.matches);
      return;
    }

    const itemCode = getItemCode(result.item);
    if (!itemCode) {
      showFieldValidation(input, `No item code found for "${query}".`);
      return;
    }

    setPendingLookupFocus(input);
    input.setCustomValidity('');
    await Promise.resolve(onLineChange?.(rowIndex, {
      target: {
        name: input.name || 'itemNo',
        value: itemCode,
      },
    }));

    completePendingLookupFocus(80);
  }, [lineItemOptions, onLineChange, onOpenItemModal]);

  return { handleItemCodeTab };
}
