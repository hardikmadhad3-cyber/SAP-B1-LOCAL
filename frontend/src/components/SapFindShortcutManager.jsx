import { useEffect } from 'react';

const FIND_ACTION_SELECTOR = 'button.sap-document-toolbar__find, button[data-sap-find-action]';

const isVisible = (element) => {
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
};

export default function SapFindShortcutManager() {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (String(event.key || '').toLowerCase() !== 'f') return;
      if (event.target instanceof Element && event.target.closest('dialog, [role="dialog"]')) return;

      const findButton = Array.from(document.querySelectorAll(FIND_ACTION_SELECTOR))
        .find((button) => !button.disabled && !button.closest('dialog, [role="dialog"]') && isVisible(button));
      if (!findButton) return;

      event.preventDefault();
      findButton.click();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return null;
}
