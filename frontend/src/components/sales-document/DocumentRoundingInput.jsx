import React, { useEffect } from 'react';

const NUMERIC_DRAFT = /^-?(?:\d+)?(?:\.\d*)?$/;

export default function DocumentRoundingInput({
  header, setHeader, formattedAmount, className, disabled = false, onManualChange, style,
}) {
  const manual = header.rounding && header.roundingAmountIsManual === true;
  const editable = header.rounding && !disabled;
  const value = manual ? String(header.roundingAmount ?? '') : formattedAmount;

  useEffect(() => {
    if (!header.rounding && header.roundingAmountIsManual) {
      setHeader((previous) => ({ ...previous, roundingAmount: '', roundingAmountIsManual: false }));
    }
  }, [header.rounding, header.roundingAmountIsManual, setHeader]);

  const changeAmount = (event) => {
    if (!editable) return;
    const next = event.target.value.replace(/,/g, '');
    if (!NUMERIC_DRAFT.test(next)) return;
    setHeader((previous) => ({ ...previous, rounding: true, roundingAmount: next, roundingAmountIsManual: true }));
    onManualChange?.(event);
  };

  const finishEdit = () => {
    if (!manual) return;
    const entered = String(header.roundingAmount ?? '').trim();
    if (entered === '' || !Number.isFinite(Number(entered))) {
      setHeader((previous) => ({ ...previous, roundingAmount: '', roundingAmountIsManual: false }));
    }
  };

  return (
    <input
      aria-label="Rounding amount"
      className={className}
      style={style}
      inputMode="decimal"
      value={value}
      onChange={changeAmount}
      onBlur={finishEdit}
      onFocus={(event) => { if (!manual) event.target.select(); }}
      readOnly={!editable}
    />
  );
}
