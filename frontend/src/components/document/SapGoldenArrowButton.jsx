import React from 'react';

// SAP B1 "golden arrow" (open the linked record), drawn as a Fiori
// navigation button. Styles: `.sap-link-arrow-btn` in styles/sap-ui.css.
export default function SapGoldenArrowButton({
  disabled = false,
  title = 'Open linked document',
  onClick,
  className = '',
}) {
  return (
    <button
      type="button"
      className={`sap-link-arrow-btn ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
        <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
