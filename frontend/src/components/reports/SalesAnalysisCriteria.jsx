import SapDateInput from '../common/SapDateInput';
import React from "react";
import SalesAnalysisCustomerTab from "./SalesAnalysisCustomerTab";
import SalesAnalysisItemTab from "./SalesAnalysisItemTab";
import SalesAnalysisSalesEmployeeTab from "./SalesAnalysisSalesEmployeeTab";

const reportPeriodOptions = [
  { value: "annual", label: "Annual Report" },
  { value: "monthly", label: "Monthly Report" },
  { value: "quarterly", label: "Quarterly Report" },
];

const defaultDocumentTypeOptions = [
  { value: "invoices", label: "Invoices" },
  { value: "orders", label: "Orders" },
  { value: "deliveryNotes", label: "Delivery Notes" },
];

const displayModeOptions = [
  { value: "individual", label: "Individual Display" },
  { value: "group", label: "Group Display" },
];

const customerTotalTypeOptions = [
  { value: "totalByCustomer", label: "Total by Customer" },
  { value: "totalByBlanketAgreement", label: "Total by Blanket Agreement" },
];

const itemTotalTypeOptions = [
  { value: "none", label: "No Totals" },
  { value: "totalByCustomer", label: "Total by Customer" },
  { value: "totalBySalesEmployee", label: "Total by Sales Employee" },
];

function DateFieldRow({ label, filter, onToggle, onChange }) {
  return (
    <div className="sar-date-row">
      <label className="im-checkbox-label sar-date-row__toggle">
        <input type="checkbox" checked={filter.enabled} onChange={(event) => onToggle(event.target.checked)} />
        {label}
      </label>
      <SapDateInput
        className="im-field__input"
        
        value={filter.from || ""}
        disabled={!filter.enabled}
        onChange={(event) => onChange("from", event.target.value)}
      />
      <span className="sar-date-separator">To</span>
      <SapDateInput
        className="im-field__input"
        
        value={filter.to || ""}
        disabled={!filter.enabled}
        onChange={(event) => onChange("to", event.target.value)}
      />
    </div>
  );
}

export default function SalesAnalysisCriteria({
  criteria,
  title = "Sales Analysis Report - Selection Criteria",
  customerTabLabel = "Customers",
  customerLabel = "Customer",
  salesEmployeeTabLabel = "Sales Employees",
  salesEmployeeLabel = "Sales Employee",
  customerGroupOptions,
  itemGroupOptions,
  customerPropertySummary,
  itemPropertySummary,
  documentTypeOptions = defaultDocumentTypeOptions,
  customerTotalTypeOptions: customerTotalTypeOptionsProp = customerTotalTypeOptions,
  itemTotalTypeOptions: itemTotalTypeOptionsProp = itemTotalTypeOptions,
  onChange,
  onOpenLookup,
  onOpenCustomerProperties,
  onOpenItemProperties,
  onSubmit,
  onCancel,
  loading,
}) {
  const compactCriteriaLayout = criteria.tab !== "salesEmployees";

  const renderTabBody = () => {
    if (criteria.tab === "customers") {
      return (
        <SalesAnalysisCustomerTab
          value={criteria.customer}
          customerLabel={customerLabel}
          groupOptions={customerGroupOptions}
          propertySummary={customerPropertySummary}
          onChange={(field, value) => onChange(`customer.${field}`, value)}
          onOpenLookup={(rangeKey) => onOpenLookup("customers", rangeKey)}
          onOpenProperties={onOpenCustomerProperties}
        />
      );
    }

    if (criteria.tab === "items") {
      return (
        <SalesAnalysisItemTab
          value={criteria.item}
          customerLabel={customerLabel}
          salesEmployeeLabel={salesEmployeeLabel}
          groupOptions={itemGroupOptions}
          propertySummary={itemPropertySummary}
          onChange={(field, value) => onChange(`item.${field}`, value)}
          onOpenLookup={(rangeKey) => onOpenLookup("items", rangeKey)}
          onOpenProperties={onOpenItemProperties}
        />
      );
    }

    return (
      <SalesAnalysisSalesEmployeeTab
        value={criteria.salesEmployee}
        salesEmployeeLabel={salesEmployeeLabel}
        onChange={(field, value) => onChange(`salesEmployee.${field}`, value)}
        onOpenLookup={(rangeKey) => onOpenLookup("salesEmployees", rangeKey)}
      />
    );
  };

  return (
    <div className="sar-window">
      <div className="sar-window__titlebar">
        <span>{title}</span>
      </div>
      <div className="sar-window__underline" />

      <div className="im-tabs">
        {[
          { key: "customers", label: customerTabLabel },
          { key: "items", label: "Items" },
          { key: "salesEmployees", label: salesEmployeeTabLabel },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`im-tab${criteria.tab === tab.key ? " im-tab--active" : ""}`}
            onClick={() => onChange("tab", tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="sar-window__body">
        <div className={`sar-criteria-grid${compactCriteriaLayout ? " sar-criteria-grid--compact" : ""}`}>
          <div className="sar-criteria-left">
            <div className="sar-section-box">
              <div className="sar-section-caption">Report Period</div>
              <div className="sar-radio-stack">
                {reportPeriodOptions.map((option) => (
                  <label key={option.value} className="im-checkbox-label">
                    <input
                      type="radio"
                      checked={criteria.reportPeriod === option.value}
                      onChange={() => onChange("reportPeriod", option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="sar-section-box">
              <div className="sar-section-caption">Document Type</div>
              <div className="sar-radio-stack">
                {documentTypeOptions.map((option) => (
                  <label key={option.value} className="im-checkbox-label">
                    <input
                      type="radio"
                      checked={criteria.documentType === option.value}
                      onChange={() => onChange("documentType", option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>

            {criteria.tab !== "salesEmployees" && (
              <div className="sar-section-box">
                <div className="sar-section-caption">Display Mode</div>
                <div className="sar-radio-stack">
                  {displayModeOptions.map((option) => (
                    <label key={option.value} className="im-checkbox-label">
                      <input
                        type="radio"
                        checked={criteria.displayMode === option.value}
                        onChange={() => onChange("displayMode", option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {criteria.tab !== "salesEmployees" && (
              <div className="sar-section-box">
                <div className="sar-section-caption">Total Type</div>
                <div className="sar-radio-stack">
                  {(criteria.tab === "customers" ? customerTotalTypeOptionsProp : itemTotalTypeOptionsProp).map((option) => (
                    <label key={option.value} className="im-checkbox-label">
                      <input
                        type="radio"
                        checked={criteria.totalType === option.value}
                        onChange={() => onChange("totalType", option.value)}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="sar-criteria-right">
            <div className="sar-section-box">
              <div className="sar-section-caption">Date Selection</div>
              <DateFieldRow
                label="Posting Date"
                filter={criteria.dateFilters.postingDate}
                onToggle={(enabled) => onChange("dateFilters.postingDate.enabled", enabled)}
                onChange={(field, value) => onChange(`dateFilters.postingDate.${field}`, value)}
              />
              <DateFieldRow
                label="Due Date"
                filter={criteria.dateFilters.dueDate}
                onToggle={(enabled) => onChange("dateFilters.dueDate.enabled", enabled)}
                onChange={(field, value) => onChange(`dateFilters.dueDate.${field}`, value)}
              />
              <DateFieldRow
                label="Document Date"
                filter={criteria.dateFilters.documentDate}
                onToggle={(enabled) => onChange("dateFilters.documentDate.enabled", enabled)}
                onChange={(field, value) => onChange(`dateFilters.documentDate.${field}`, value)}
              />
            </div>

            {renderTabBody()}
          </div>
        </div>

        <div className="sar-footer-options">
          <label className="im-checkbox-label">
            <input
              type="checkbox"
              checked={criteria.displaySystemCurrency}
              onChange={(event) => onChange("displaySystemCurrency", event.target.checked)}
            />
            Display Amounts in System Currency
          </label>
        </div>
      </div>

      <div className="sar-window__footer">
        <button type="button" className="im-btn im-btn--primary" disabled={loading} onClick={onSubmit}>
          {loading ? "Loading..." : "OK"}
        </button>
        <button type="button" className="im-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
