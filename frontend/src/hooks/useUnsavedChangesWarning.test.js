import { renderHook } from '@testing-library/react';
import useUnsavedChangesWarning, { hasEnteredDocumentLines } from './useUnsavedChangesWarning';

test('a line counts as entered once it has an item, account or description', () => {
  expect(hasEnteredDocumentLines([{ itemNo: '' }, { quantity: '1' }])).toBe(false);
  expect(hasEnteredDocumentLines([{ itemNo: 'A100' }])).toBe(true);
  expect(hasEnteredDocumentLines([{ glAccount: '400100' }])).toBe(true);
  expect(hasEnteredDocumentLines(undefined)).toBe(false);
});

test('blocks browser unload only while there are unsaved changes', () => {
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const { rerender, unmount } = renderHook(({ active }) => useUnsavedChangesWarning(active), { initialProps: { active: true } });
  expect(unload()).toBe(true);
  rerender({ active: false });
  expect(unload()).toBe(false);
  unmount();
});
