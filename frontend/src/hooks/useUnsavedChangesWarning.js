import { useEffect } from 'react';

// Fields that mean the user has started a line: item documents (itemNo /
// itemCode), service documents (glAccount / description), inventory docs
// (accountCode).
const LINE_ENTRY_FIELDS = ['itemNo', 'itemCode', 'ItemCode', 'glAccount', 'description', 'accountCode'];

export const hasEnteredDocumentLines = (lines = []) => (
  (Array.isArray(lines) ? lines : []).some((line) => (
    LINE_ENTRY_FIELDS.some((field) => String(line?.[field] ?? '').trim())
  ))
);

// Browser close / refresh / typed URL loses an unsaved document, so ask first.
// In-app navigation is left alone: open documents are kept as taskbar drafts.
export default function useUnsavedChangesWarning(active) {
  useEffect(() => {
    if (!active) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [active]);
}
