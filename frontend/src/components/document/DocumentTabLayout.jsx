import React, { useId } from 'react';

// One layout for every marketing-document tab (Logistics, Accounting, Tax,
// Electronic Documents, Attachments) on
// Sales, Purchase and Service documents. SAP B1 layout: two columns, label on
// the left of each control, checkboxes aligned with the controls, address
// text under its selector. Styles: `.sap-doc-tab*` in styles/sap-ui.css.

export function DocTabPanel({ children, className = '' }) {
  return <div role="tabpanel" className={`sap-tab-panel sap-doc-tab ${className}`.trim()}>{children}</div>;
}

export function DocTabColumns({ children }) {
  return <div className="sap-doc-tab__columns">{children}</div>;
}

export function DocTabColumn({ children }) {
  return <section className="sap-doc-tab__column">{children}</section>;
}

// Full-width block under the two columns (e.g. Manually Recalculate Due Date).
export function DocTabSection({ title, children }) {
  return (
    <section className="sap-doc-tab__section">
      {title ? <div className="sap-doc-tab__section-title">{title}</div> : null}
      {children}
    </section>
  );
}

// Label + control row. `children` is a render prop receiving the control id
// so the label is always associated with its input.
export function DocField({ label, children, className = '' }) {
  const id = useId();
  return (
    <div className={`sap-doc-field ${className}`.trim()}>
      {label ? <label className="sap-doc-field__label" htmlFor={id}>{label}</label> : <span aria-hidden="true" />}
      <div className="sap-doc-field__control">{typeof children === 'function' ? children(id) : children}</div>
    </div>
  );
}

export function DocCheckbox({ label, className = '', ...inputProps }) {
  return (
    <div className={`sap-doc-field sap-doc-field--checkbox ${className}`.trim()}>
      <span aria-hidden="true" />
      <label className="sap-doc-field__checkbox">
        <input type="checkbox" {...inputProps} />
        <span>{label}</span>
      </label>
    </div>
  );
}

// Control followed by the SAP "..." lookup button.
export function DocLookup({ children, onLookup, disabled = false, title = 'Select' }) {
  return (
    <div className="sap-doc-field__lookup">
      {children}
      <button type="button" className="sap-doc-field__lookup-btn" onClick={onLookup} disabled={disabled} title={title} aria-label={title}>
        ...
      </button>
    </div>
  );
}
