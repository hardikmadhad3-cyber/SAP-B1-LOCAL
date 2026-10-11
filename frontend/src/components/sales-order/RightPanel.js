import SapDateInput from '../common/SapDateInput';
import React from 'react';
import { HEADER_FIELDS } from '../../config/salesOrderMetadata';

function RightPanel({ header, onHeaderChange }) {
  const renderField = (fieldKey, fieldConfig) => {
    const value = header[fieldKey] || '';

    switch (fieldConfig.type) {
      case 'date':
        return (
          <SapDateInput
            
            className="so-input so-input-sm"
            value={value}
            onChange={(e) => onHeaderChange(fieldKey, e.target.value)}
          />
        );
      
      case 'number':
        return (
          <input
            type="text"
            className="so-input so-input-sm so-input-right"
            value={value}
            onChange={(e) => onHeaderChange(fieldKey, e.target.value)}
          />
        );
      
      case 'textarea':
        return (
          <textarea
            className="so-textarea so-textarea-sm"
            rows={2}
            value={value}
            onChange={(e) => onHeaderChange(fieldKey, e.target.value)}
          />
        );
      
      default:
        return (
          <input
            type="text"
            className="so-input so-input-sm"
            value={value}
            onChange={(e) => onHeaderChange(fieldKey, e.target.value)}
          />
        );
    }
  };

  const rightPanelFields = Object.entries(HEADER_FIELDS).filter(
    ([_, config]) => config.section === 'rightPanel' || 
                     config.section === 'address' || 
                     config.section === 'invoice' || 
                     config.section === 'udf'
  );

  return (
    <div className="so-right-panel">
      <div className="so-right-panel-header">
        <h3>Additional Information</h3>
      </div>

      <div className="so-right-panel-content">
        {rightPanelFields.map(([fieldKey, fieldConfig]) => (
          <div key={fieldKey} className="so-form-group-sm">
            <label className="so-label-sm">{fieldConfig.label}</label>
            {renderField(fieldKey, fieldConfig)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default RightPanel;
