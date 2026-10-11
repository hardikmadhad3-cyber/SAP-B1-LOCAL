import React, { forwardRef } from 'react';
import SapDateInput from './SapDateInput';

const SapInput = forwardRef(function SapInput({ type = 'text', ...props }, ref) {
  if (type === 'date') return <SapDateInput {...props} ref={ref} />;
  return <input {...props} type={type} ref={ref} />;
});

export default SapInput;
