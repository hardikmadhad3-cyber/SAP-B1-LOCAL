import React, { useEffect, useState } from 'react';
import { runDocumentAction } from '../../api/documentActionsApi';

const LABELS = { cancel: 'Cancel Document', close: 'Close Document' };
// SAP's confirmation texts for Data > Cancel and Data > Close.
const CONFIRM = {
  cancel: 'Cancelling a document is irreversible. A cancellation document will reverse its postings. Continue?',
  close: 'Closing a document is irreversible. Continue?',
};

// SAP's Data menu (Close / Cancel) for a saved document, as one toolbar dropdown in
// the page's own dropdown family (className 'po-btn' -> 'po-dropdown'). Shown only
// for a loaded document; the page reloads it in onDone and shows errors via onError.
export default function DocumentStatusActions({
  type, docEntry, actions = ['cancel'], disabled = false, className = 'so-btn', onDone, onError,
}) {
  const [busy, setBusy] = useState(false);
  // Close on a click elsewhere or Escape (not every page closes its dropdowns itself).
  useEffect(() => {
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      document.querySelectorAll('.sap-document-toolbar__data.active').forEach((node) => {
        if (event.type === 'keydown' || !node.contains(event.target)) node.classList.remove('active');
      });
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  if (!docEntry) return null;
  const family = className.split(/\s+/)[0].replace(/-btn$/, '');
  const closeMenus = () => document.querySelectorAll(`.${family}-dropdown, .sap-document-toolbar__data`)
    .forEach((node) => node.classList.remove('active'));

  // Same open/close behaviour as the pages' Copy From / Copy To dropdowns.
  const toggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const dropdown = event.currentTarget.parentElement;
    const isActive = dropdown.classList.contains('active');
    closeMenus();
    if (!isActive) dropdown.classList.add('active');
  };

  const run = async (event, action) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenus();
    if (!window.confirm(CONFIRM[action])) return;
    setBusy(true);
    try {
      const result = await runDocumentAction(type, docEntry, action);
      onDone?.(action, result);
    } catch (error) {
      const message = error.response?.data?.message || error.message || `Could not ${action} the document.`;
      if (onError) onError(message); else window.alert(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${family}-dropdown sap-document-toolbar__data`}>
      <button type="button" className={className} disabled={disabled || busy} aria-haspopup="menu" onClick={toggle}>
        {busy ? 'Working...' : 'Data ▼'}
      </button>
      <div className={`${family}-dropdown-menu`} role="menu">
        {actions.map((action) => (
          <button key={action} type="button" role="menuitem" onClick={(event) => run(event, action)}>{LABELS[action]}</button>
        ))}
      </div>
    </div>
  );
}
