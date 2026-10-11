import React, { forwardRef, useEffect, useState } from 'react';

/** Keeps a lookup search phrase editable until Tab resolves it to a record. */
const SapLookupTextInput = forwardRef(function SapLookupTextInput({ value, onChange, onFocus, onBlur, ...props }, ref) {
  const [draft, setDraft] = useState(() => String(value ?? ''));

  useEffect(() => {
    setDraft(String(value ?? ''));
  }, [value]);

  return (
    <input
      {...props}
      ref={ref}
      value={draft}
      onFocus={onFocus}
      onChange={(event) => {
        setDraft(event.target.value);
        // Clearing the field must also clear the selected record in the form.
        if (!event.target.value) onChange?.(event);
      }}
      onBlur={onBlur}
    />
  );
});

export default SapLookupTextInput;
