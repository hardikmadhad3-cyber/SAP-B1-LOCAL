import SapDateInput from '../../../components/common/SapDateInput';
import React from "react";
import LookupField from "../../item-master/components/LookupField";

export default function GeneralTab({ form, onChange, setForm, fetchBasePriceLists }) {
  return (
    <div>
      <div className="im-section-title">Pricing Settings</div>
      <div className="im-field-grid">

        <div className="im-field">
          <label className="im-field__label">Rounding Method</label>
          {/* BoRoundingMethod SAP enum */}
          <select
            className="im-field__select"
            name="RoundingMethod"
            value={form.RoundingMethod || "borm_NoRounding"}
            onChange={onChange}
          >
            <option value="borm_NoRounding">No Rounding</option>
            <option value="borm_Ceiling">Ceiling</option>
            <option value="borm_Commercial">Commercial</option>
            <option value="borm_Floor">Floor</option>
            <option value="borm_HalfDown">Half Down</option>
            <option value="borm_HalfUp">Half Up</option>
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Gross Price</label>
          {/* IsGrossPrice: BoYesNoEnum — price includes tax */}
          <select
            className="im-field__select"
            name="IsGrossPrice"
            value={form.IsGrossPrice || "tNO"}
            onChange={onChange}
          >
            <option value="tNO">No (Net)</option>
            <option value="tYES">Yes (Gross)</option>
          </select>
        </div>

      </div>

      <div className="im-section-title" style={{ marginTop: 14 }}>Base Price List</div>
      <div className="im-field-grid">

        <div className="im-field">
          <label className="im-field__label">Base Price List</label>
          {/* BasePriceList: integer — source list for factor-based pricing */}
          <LookupField
            name="BasePriceList"
            value={form.BasePriceList != null ? String(form.BasePriceList) : ""}
            displayValue={form.BasePriceListName || ""}
            onChange={onChange}
            onSelect={(row) =>
              setForm((p) => ({ ...p, BasePriceList: row.code, BasePriceListName: row.name }))
            }
            fetchOptions={fetchBasePriceLists}
            placeholder="Base Price List"
          />
        </div>

        <div className="im-field">
          <label className="im-field__label">Factor</label>
          {/* Factor: decimal multiplier applied to base price list */}
          <input
            className="im-field__input"
            name="Factor"
            type="number"
            step="0.0001"
            min="0"
            value={form.Factor ?? "1"}
            onChange={onChange}
          />
        </div>

      </div>

      <div className="im-section-title" style={{ marginTop: 14 }}>Validity</div>
      <div className="im-field-grid">

        <div className="im-field">
          <label className="im-field__label">Valid From</label>
          <SapDateInput
            className="im-field__input"
            name="ValidFrom"
            
            value={form.ValidFrom || ""}
            onChange={onChange}
          />
        </div>

        <div className="im-field">
          <label className="im-field__label">Valid To</label>
          <SapDateInput
            className="im-field__input"
            name="ValidTo"
            
            value={form.ValidTo || ""}
            onChange={onChange}
          />
        </div>

      </div>
    </div>
  );
}
