import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { resolveSapDateShortcut } from '../../utils/sapDateShortcuts';
import './SapDateInput.css';

export const formatSapDateDisplay = (value) => {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value ?? '');
};

const isoDate = (value) => {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
};

const setNativeValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const SapDateInput = forwardRef(function SapDateInput({
  value,
  defaultValue,
  name,
  id,
  className = '',
  style,
  disabled,
  readOnly,
  required,
  min,
  max,
  onChange,
  onBlur,
  onFocus,
  onKeyDown,
  form,
  placeholder = 'dd/mm/yyyy',
  ...inputProps
}, forwardedRef) {
  const [internalValue, setInternalValue] = useState(() => isoDate(defaultValue));
  const currentValue = value === undefined ? internalValue : value;
  const [displayValue, setDisplayValue] = useState(() => formatSapDateDisplay(currentValue));
  const nativeRef = useRef(null);
  const textRef = useRef(null);
  const editingRef = useRef(false);
  const clearingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDisplayValue(formatSapDateDisplay(currentValue));
  }, [currentValue]);

  const emitDate = (nextValue, preserveEditing = false) => {
    clearingRef.current = preserveEditing;
    if (nativeRef.current) setNativeValue(nativeRef.current, nextValue);
    clearingRef.current = false;
    if (value === undefined) setInternalValue(nextValue);
  };

  const commit = (reportError = true) => {
    const raw = displayValue.trim();
    if (!raw) {
      editingRef.current = false;
      textRef.current?.setCustomValidity('');
      emitDate('');
      setDisplayValue('');
      return !required;
    }

    const result = resolveSapDateShortcut(raw);
    const rangeError = result.value && min && result.value < min
      ? `Date must be on or after ${formatSapDateDisplay(min)}.`
      : result.value && max && result.value > max
        ? `Date must be on or before ${formatSapDateDisplay(max)}.`
        : '';
    const error = result.error || rangeError;
    if (error) {
      textRef.current?.setCustomValidity(error);
      if (reportError) textRef.current?.reportValidity();
      editingRef.current = false;
      return false;
    }

    editingRef.current = false;
    textRef.current?.setCustomValidity('');
    setDisplayValue(formatSapDateDisplay(result.value));
    if (isoDate(currentValue) !== result.value) emitDate(result.value);
    return true;
  };

  const handleTextChange = (event) => {
    editingRef.current = true;
    textRef.current?.setCustomValidity('');
    setDisplayValue(event.target.value);
    if (isoDate(currentValue)) emitDate('', true);
  };

  const handleNativeChange = (event) => {
    const nextValue = event.target.value;
    if (!clearingRef.current) {
      editingRef.current = false;
      textRef.current?.setCustomValidity('');
      setDisplayValue(formatSapDateDisplay(nextValue));
    }
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(event);
  };

  const setTextRef = (node) => {
    textRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  return (
    <span className="sap-date-input" style={{
      flex: style?.flex,
      width: style?.width,
      minWidth: style?.minWidth,
      maxWidth: style?.maxWidth,
    }}>
      <input
        {...inputProps}
        ref={setTextRef}
        id={id}
        type="text"
        inputMode="numeric"
        className={`${className} sap-date-input__text`.trim()}
        style={style}
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        onChange={handleTextChange}
        onFocus={(event) => {
          editingRef.current = true;
          event.target.select();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          if (editingRef.current) commit(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if ((event.key === 'Tab' || event.key === 'Enter') && editingRef.current) {
            if (!commit()) event.preventDefault();
          }
          onKeyDown?.(event);
        }}
      />
      <span className="sap-date-input__icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3">
          <rect x="1.5" y="3" width="13" height="11.5" rx="1" />
          <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3M4.5 9h2M9.5 9h2M4.5 11.5h2M9.5 11.5h2" />
        </svg>
      </span>
      <input
        ref={nativeRef}
        className="sap-date-input__picker"
        type="date"
        name={name}
        form={form}
        value={isoDate(currentValue)}
        min={min}
        max={max}
        disabled={disabled || readOnly}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleNativeChange}
        onClick={(event) => {
          try { event.currentTarget.showPicker?.(); } catch (_error) { /* Native click remains available. */ }
        }}
      />
    </span>
  );
});

export default SapDateInput;
