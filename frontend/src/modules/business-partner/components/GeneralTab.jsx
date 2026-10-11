import SapDateInput from '../../../components/common/SapDateInput';
import React from "react";
import LookupField from "../../item-master/components/LookupField";

export default function GeneralTab({
  form,
  onChange,
  setForm,
  fetchShippingTypes,
  fetchSalesPersons,
  companyTypeOptions,
  getFieldBackground,
}) {
  const getBG = (name) => getFieldBackground ? getFieldBackground(name) : "#fff";

  return (
    <div>
      <div className="bp-general-layout">
        {/* Left Column */}
        <div className="bp-general-left">
          <div className="im-field">
            <label className="im-field__label">Tel 1</label>
            <input 
              className="im-field__input" 
              name="Phone1" 
              value={form.Phone1 || ""} 
              onChange={onChange} 
              style={{ background: getBG('Phone1') }}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Tel 2</label>
            <input className="im-field__input" name="Phone2" value={form.Phone2 || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">Mobile Phone</label>
            <input className="im-field__input" name="Cellular" value={form.Cellular || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">Fax</label>
            <input className="im-field__input" name="Fax" value={form.Fax || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">E-Mail</label>
            <input 
              className="im-field__input" 
              name="EmailAddress" 
              value={form.EmailAddress || ""} 
              onChange={onChange} 
              style={{ background: getBG('EmailAddress') }}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Web Site</label>
            <input className="im-field__input" name="Website" value={form.Website || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">Shipping Type</label>
            <LookupField
              name="ShippingType"
              value={form.ShippingType || ""}
              displayValue={form.ShippingTypeName || ""}
              onChange={onChange}
              onSelect={(row) => setForm((p) => ({ ...p, ShippingType: row.code, ShippingTypeName: row.name }))}
              fetchOptions={fetchShippingTypes}
              placeholder="Shipping Type"
              allowManualEntry={false}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Sales Employee</label>
            <LookupField
              name="SalesPersonCode"
              value={form.SalesPersonCode || ""}
              displayValue={form.SalesEmployeeName || ""}
              onChange={onChange}
              onSelect={(row) => setForm((p) => ({ ...p, SalesPersonCode: row.code, SalesEmployeeName: row.name }))}
              fetchOptions={fetchSalesPersons}
              placeholder="Sales Employee"
              allowManualEntry={false}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">Payment Method</label>
            <input className="im-field__input" name="PeymentMethodCode" value={form.PeymentMethodCode || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">Project Code</label>
            <input className="im-field__input" name="ProjectCode" value={form.ProjectCode || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">Indicator</label>
            <input className="im-field__input" name="Indicator" value={form.Indicator || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">Type of Business</label>
            <select className="im-field__select" name="CompanyPrivate" value={form.CompanyPrivate || "cCompany"} onChange={onChange}>
              {companyTypeOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right Column */}
        <div className="bp-general-right">
          <div className="im-field">
            <label className="im-field__label">Contact Person</label>
            <input
              className="im-field__input"
              name="ContactPerson"
              value={form.ContactPerson || ""}
              readOnly
              placeholder="Managed from Contact Persons tab"
            />
          </div>

          <div className="im-field" style={{ alignItems: "flex-start" }}>
            <label className="im-field__label" style={{ paddingTop: "6px" }}>Remarks</label>
            <textarea 
              className="im-textarea" 
              name="FreeText" 
              value={form.FreeText || ""} 
              onChange={onChange}
              rows={4}
              style={{ flex: 1 }}
            />
          </div>

          <div className="im-field">
            <label className="im-field__label">BP Channel Code</label>
            <input className="im-field__input" name="ChannelBP" value={form.ChannelBP || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">Territory</label>
            <input className="im-field__input" name="Territory" type="number" value={form.Territory || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label">Language</label>
            <select className="im-field__select" name="LanguageCode" value={form.LanguageCode || ""} onChange={onChange}>
              <option value="">-- Select Language --</option>
              <option value="1">English</option>
              <option value="2">Spanish</option>
              <option value="3">French</option>
              <option value="4">German</option>
            </select>
          </div>

          <div className="im-field">
            <label className="im-field__label">GLN</label>
            <input className="im-field__input" name="GTSRegNo" value={form.GTSRegNo || ""} onChange={onChange} />
          </div>

          <div className="im-field">
            <label className="im-field__label"></label>
            <div className="im-checkbox-label">
              <input 
                type="checkbox" 
                name="BlockSendingMarketingContent" 
                checked={form.BlockSendingMarketingContent === "tYES"} 
                onChange={onChange}
              />
              <span>Block Sending Marketing Content</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alias Name */}
      <div style={{ marginTop: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", maxWidth: "500px" }}>
          <label style={{ flex: "0 0 140px", textAlign: "right", fontSize: "12px", color: "#444" }}>Alias Name</label>
          <input 
            style={{ 
              width: "260px", 
              minWidth: "260px", 
              maxWidth: "260px",
              height: "22px",
              padding: "0 5px",
              fontSize: "12px",
              border: "1px solid #a0aab4",
              borderRadius: "2px",
              background: "#fff"
            }} 
            name="AliasName" 
            value={form.AliasName || ""} 
            onChange={onChange} 
          />
        </div>
      </div>

      {/* Branch Assignment */}
      <div style={{ marginTop: "14px" }}>
        <div className="im-section-title">Branch Assignment</div>
        <div style={{ display: "flex", gap: "20px", marginTop: "8px", marginLeft: "146px" }}>
          <label className="im-checkbox-label">
            <input 
              type="radio" 
              name="BranchAssignment" 
              value="Active"
              checked={form.BranchAssignment === "Active"} 
              onChange={onChange}
            />
            <span>Active</span>
          </label>
          <label className="im-checkbox-label">
            <input 
              type="radio" 
              name="BranchAssignment" 
              value="Inactive"
              checked={form.BranchAssignment === "Inactive"} 
              onChange={onChange}
            />
            <span>Inactive</span>
          </label>
          <label className="im-checkbox-label">
            <input 
              type="radio" 
              name="BranchAssignment" 
              value="Advanced"
              checked={form.BranchAssignment === "Advanced"} 
              onChange={onChange}
            />
            <span>Advanced</span>
          </label>
        </div>
      </div>

      {/* Valid Section */}
      <div style={{ marginTop: "20px" }}>
        <div className="im-section-title">Valid</div>
        <div style={{ display: "flex", gap: "20px", marginTop: "8px", marginLeft: "146px", alignItems: "center" }}>
          <label className="im-checkbox-label">
            <input 
              type="checkbox" 
              name="Valid" 
              checked={form.Valid === "tYES"} 
              onChange={onChange}
            />
            <span>Active</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "12px", color: "#444" }}>From:</label>
            <SapDateInput 
               
              className="im-field__input"
              name="ValidFrom" 
              value={form.ValidFrom || ""} 
              onChange={onChange}
              style={{ width: "140px" }}
            />
            <label style={{ fontSize: "12px", color: "#444" }}>To:</label>
            <SapDateInput 
               
              className="im-field__input"
              name="ValidTo" 
              value={form.ValidTo || ""} 
              onChange={onChange}
              style={{ width: "140px" }}
            />
          </div>
        </div>
      </div>

      {/* Frozen Section */}
      <div style={{ marginTop: "14px" }}>
        <div className="im-section-title">Frozen</div>
        <div style={{ display: "flex", gap: "20px", marginTop: "8px", marginLeft: "146px", alignItems: "center" }}>
          <label className="im-checkbox-label">
            <input 
              type="checkbox" 
              name="Frozen" 
              checked={form.Frozen === "tYES"} 
              onChange={onChange}
            />
            <span>Blocked</span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ fontSize: "12px", color: "#444" }}>From:</label>
            <SapDateInput 
               
              className="im-field__input"
              name="FrozenFrom" 
              value={form.FrozenFrom || ""} 
              onChange={onChange}
              style={{ width: "140px" }}
            />
            <label style={{ fontSize: "12px", color: "#444" }}>To:</label>
            <SapDateInput 
               
              className="im-field__input"
              name="FrozenTo" 
              value={form.FrozenTo || ""} 
              onChange={onChange}
              style={{ width: "140px" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
