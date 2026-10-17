import SapDateInput from '../../../components/common/SapDateInput';
import React from "react";
import LookupField from "./LookupField";
import ManageItemBySection from "./ManageItemBySection";
import { fetchManufacturers, fetchHSNCodes } from "../../../api/itemApi";

export default function GeneralTab({ form, onChange, onDefineManufacturer, mode }) {
  const isServiceItem = form.ItemClass === "itcService";
  const isMaterialItem = form.ItemClass === "itcMaterial" || !form.ItemClass;
  const itemCategoryLocked = mode === "update" && Boolean(form.ItemCode);

  const handleGSTMaterialTypeChange = (e) => {
    onChange(e);
    onChange({ target: { name: "MaterialType", value: e.target.value } });
  };

  return (
    <div className="im-general-tab">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "40px" }}>
        
        {/* Left Column */}
        <div>
          <div className="im-field">
            <label className="im-checkbox-label" style={{ fontWeight: "bold" }}>
              <input
                type="checkbox"
                name="WTLiable"
                checked={form.WTLiable === "tYES"}
                onChange={onChange}
              />
              Withholding Tax Liable
            </label>
          </div>

          <div style={{ marginTop: "20px" }}>
            <div className="im-field">
              <label className="im-checkbox-label">
                <input
                  type="checkbox"
                  name="NoDiscounts"
                  checked={form.NoDiscounts === "tYES"}
                  onChange={onChange}
                />
                Do Not Apply Discount
              </label>
            </div>
          </div>

          <div style={{ marginTop: "10px" }}>
            <div className="im-field">
              <label className="im-field__label">Manufacturer</label>
              <LookupField
                name="Manufacturer"
                value={form.Manufacturer || ""}
                displayValue={form.ManufacturerName || ""}
                onChange={onChange}
                onSelect={(r) => onChange({ target: { name: "Manufacturer", value: r.code, label: r.name } })}
                fetchOptions={fetchManufacturers}
                placeholder="Select Manufacturer"
                onDefineNew={onDefineManufacturer}
              />
            </div>
            <div className="im-field">
              <label className="im-field__label">Additional Identifier</label>
              <input className="im-field__input" name="AdditionalIdentifier" value={form.AdditionalIdentifier || ""} onChange={onChange} />
            </div>
            <div className="im-field">
              <label className="im-field__label">Shipping Type</label>
              <select className="im-field__select" name="ShipType" value={form.ShipType || ""} onChange={onChange}>
                <option value="">- Select -</option>
                <option value="1">By Road</option>
                <option value="2">By Sea</option>
                <option value="3">By Air</option>
              </select>
            </div>

            {/* Manage Item By Section - Standalone */}
            <ManageItemBySection form={form} onChange={onChange} />
          </div>

          <div style={{ marginTop: "30px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="radio"
                  name="_status"
                  value="active"
                  checked={form.Valid === "tYES" && form.Frozen !== "tYES"}
                  onChange={() => {
                    onChange({ target: { name: "Valid",  value: "tYES" } });
                    onChange({ target: { name: "Frozen", value: "tNO"  } });
                  }}
                />
                Active
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="radio"
                  name="_status"
                  value="inactive"
                  checked={form.Valid === "tNO" && form.Frozen !== "tYES"}
                  onChange={() => {
                    onChange({ target: { name: "Valid",  value: "tNO" } });
                    onChange({ target: { name: "Frozen", value: "tNO" } });
                  }}
                />
                Inactive
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="radio"
                  name="_status"
                  value="advanced"
                  checked={form.Frozen === "tYES"}
                  onChange={() => {
                    onChange({ target: { name: "Valid",  value: "tNO"  } });
                    onChange({ target: { name: "Frozen", value: "tYES" } });
                  }}
                />
                Advanced
              </label>
            </div>
            
            <div style={{ marginTop: "10px", marginLeft: "25px", display: "flex", gap: "10px", alignItems: "center" }}>
              <span>From</span>
              <SapDateInput  className="im-field__input" style={{ width: "120px" }} name="ValidFrom" value={form.ValidFrom || ""} onChange={onChange} />
              <span>To</span>
              <SapDateInput  className="im-field__input" style={{ width: "120px" }} name="ValidTo" value={form.ValidTo || ""} onChange={onChange} />
            </div>
          </div>

          <div className="im-field" style={{ marginTop: "38px" }}>
            <label className="im-field__label">Advanced Rule Type</label>
            <select
              className="im-field__select"
              name="TypeOfAdvancedRules"
              value={form.TypeOfAdvancedRules || "toarGeneral"}
              onChange={onChange}
            >
              <option value="toarGeneral">General</option>
              <option value="toarWarehouse">Warehouse</option>
            </select>
          </div>
        </div>

        {/* Right Column */}
        <div>
          <div className="im-field">
            <label className="im-field__label" style={{ textDecoration: "underline" }}>Item Category</label>
            <div style={{ display: "flex", gap: "15px", marginLeft: "10px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="radio"
                  name="ItemClass"
                  value="itcService"
                  checked={isServiceItem}
                  onChange={onChange}
                  disabled={itemCategoryLocked}
                />
                Service
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="radio"
                  name="ItemClass"
                  value="itcMaterial"
                  checked={isMaterialItem}
                  onChange={onChange}
                  disabled={itemCategoryLocked}
                />
                Material
              </label>
            </div>
          </div>

          {isServiceItem && (
            <div className="im-field" style={{ marginTop: "10px" }}>
              <label className="im-field__label">Service Category</label>
              <select 
                className="im-field__select" 
                name="ServiceCategory" 
                value={form.ServiceCategory || ""} 
                onChange={onChange}
              >
                <option value="">-- Select --</option>
                <option value="sc_Regular">Regular</option>
                <option value="sc_JobWork">Job Work</option>
                <option value="sc_Professional">Professional</option>
                <option value="sc_Technical">Technical</option>
              </select>
            </div>
          )}

          <div style={{ display: "flex", gap: "20px", marginTop: "10px", marginLeft: "10px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="checkbox"
                name="Excisable"
                checked={form.Excisable === "tYES"}
                onChange={onChange}
              />
              Excisable
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="checkbox"
                name="GSTRelevnt"
                checked={form.GSTRelevnt === "tYES"}
                onChange={onChange}
              />
              GST
            </div>
          </div>

          {form.Excisable === "tYES" && (
            <div className="im-field" style={{ marginTop: "10px" }}>
              <label className="im-field__label">Excisable Type</label>
              <select className="im-field__select" name="_excisableType" onChange={onChange}>
                <option value="">- Select -</option>
                <option value="1">Type 1</option>
                <option value="2">Type 2</option>
              </select>
            </div>
          )}

          {form.GSTRelevnt === "tYES" && isMaterialItem && (
            <div className="im-field" style={{ marginTop: "10px" }}>
              <label className="im-field__label">Material Type</label>
              <select 
                className="im-field__select" 
                name="GSTMaterialType" 
                value={form.GSTMaterialType || ""} 
                onChange={handleGSTMaterialTypeChange}
              >
                <option value="">- Select -</option>
                <option value="Capital Goods">Capital Goods</option>
                <option value="Finished Goods">Finished Goods</option>
                <option value="Raw Materials">Raw Materials</option>
              </select>
            </div>
          )}

          {form.GSTRelevnt === "tYES" && (
            <div className="im-field">
              <label className="im-field__label">HSN/SAC Code</label>
              <LookupField
                name="ChapterID"
                value={form.ChapterID || ""}
                onChange={onChange}
                onSelect={(r) => onChange({ target: { name: "ChapterID", value: r.code } })}
                fetchOptions={fetchHSNCodes}
                placeholder="India Chapter ID"
                columns={[
                  { label: "Chapter", key: "chapter" },
                  { label: "Heading", key: "heading" },
                  { label: "Subheading", key: "subheading" },
                  { label: "Description", key: "name" },
                ]}
              />
            </div>
          )}

          {form.GSTRelevnt === "tYES" && (
            <div className="im-field">
              <label className="im-field__label">Tax Category</label>
              <select className="im-field__select" name="GSTTaxCategory" value={form.GSTTaxCategory || "gtc_Regular"} onChange={onChange}>
                <option value="gtc_Regular">Regular</option>
                <option value="gtc_NilRated">Nil Rated</option>
                <option value="gtc_Exempt">Exempt</option>
              </select>
            </div>
          )}

          {form.GSTRelevnt === "tYES" && (
            <div style={{ marginTop: "15px" }}>
              <div className="im-field">
                <label className="im-field__label">Capital Goods On Hold Percentage</label>
                <div style={{ display: "flex", alignItems: "center", gap: "5px", flex: 1 }}>
                  <input type="number" className="im-field__input" name="CapitalGoodsOnHoldPercent" value={form.CapitalGoodsOnHoldPercent || ""} onChange={onChange} style={{ textAlign: "right", flex: 1 }} />
                  <span>%</span>
                </div>
              </div>
              <div className="im-field">
                <label className="im-field__label">Capital Goods On Hold Amount Limit</label>
                <input type="number" className="im-field__input" name="CapitalGoodsOnHoldLimit" value={form.CapitalGoodsOnHoldLimit || ""} onChange={onChange} style={{ textAlign: "right" }} />
              </div>
              <div className="im-field">
                <label className="im-field__label">Assessable Value</label>
                <input type="number" className="im-field__input" name="AssessableValue" value={form.AssessableValue || ""} onChange={onChange} style={{ textAlign: "right" }} />
              </div>
              <div className="im-field">
                <label className="im-field__label">Assessable Value for WTR</label>
                <input type="number" className="im-field__input" name="AssVal4WTR" value={form.AssVal4WTR || ""} onChange={onChange} style={{ textAlign: "right" }} />
              </div>
            </div>
          )}

          <div className="im-field" style={{ marginTop: "15px" }}>
            <label className="im-field__label">Remarks</label>
            <input className="im-field__input" name="User_Text" aria-label="Remarks" value={form.User_Text || ""} onChange={onChange} />
          </div>

          <div className="im-field" style={{ marginTop: "40px" }}>
            <label className="im-field__label">Country/Region of Origin</label>
            <select className="im-field__select" name="ItemCountryOrg" value={form.ItemCountryOrg || ""} onChange={onChange}>
              <option value="">- Select -</option>
              <option value="IN">India</option>
              <option value="US">USA</option>
              <option value="UK">UK</option>
            </select>
          </div>
        </div>

      </div>
    </div>
  );
}
