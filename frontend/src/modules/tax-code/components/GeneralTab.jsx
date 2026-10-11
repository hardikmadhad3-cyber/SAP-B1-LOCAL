import SapDateInput from '../../../components/common/SapDateInput';
import React from "react";
import LookupField from "../../item-master/components/LookupField";

export default function GeneralTab({ form, onChange, setForm, fetchTaxGLAccounts }) {
  return (
    <div>
      <div className="im-section-title">Tax Definition</div>
      <div className="im-field-grid">

        <div className="im-field">
          <label className="im-field__label">Category</label>
          {/* VatGroupsTaxRegionEnum: vgtr_Input | vgtr_Output */}
          <select
            className="im-field__select"
            name="Category"
            value={form.Category || "vgtr_Output"}
            onChange={onChange}
          >
            <option value="vgtr_Output">Output Tax (Sales)</option>
            <option value="vgtr_Input">Input Tax (Purchasing)</option>
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Tax Type</label>
          {/* VatGroupsType: vgt_Regular | vgt_Freight | vgt_DownPayment */}
          <select
            className="im-field__select"
            name="TaxType"
            value={form.TaxType || "vgt_Regular"}
            onChange={onChange}
          >
            <option value="vgt_Regular">Regular</option>
            <option value="vgt_Freight">Freight</option>
            <option value="vgt_DownPayment">Down Payment</option>
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Inactive</label>
          {/* BoYesNoEnum */}
          <select
            className="im-field__select"
            name="Inactive"
            value={form.Inactive || "tNO"}
            onChange={onChange}
          >
            <option value="tNO">No</option>
            <option value="tYES">Yes</option>
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Item Level</label>
          {/* IsItemLevel: BoYesNoEnum — tax defined at item line level */}
          <select
            className="im-field__select"
            name="IsItemLevel"
            value={form.IsItemLevel || "tNO"}
            onChange={onChange}
          >
            <option value="tNO">No</option>
            <option value="tYES">Yes</option>
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Tax Account</label>
          <LookupField
            name="TaxAccount"
            value={form.TaxAccount || ""}
            displayValue={form.TaxAccountName || ""}
            onChange={onChange}
            onSelect={(row) =>
              setForm((p) => ({ ...p, TaxAccount: row.code, TaxAccountName: row.name }))
            }
            fetchOptions={fetchTaxGLAccounts}
            placeholder="G/L Account"
          />
        </div>

      </div>

      <div className="im-section-title" style={{ marginTop: 14 }}>Tax Rates</div>
      <div className="im-field-grid">

        <div className="im-field">
          <label className="im-field__label">Rate %</label>
          {/* Rate: decimal — primary tax rate */}
          <input
            className="im-field__input"
            name="Rate"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.Rate ?? ""}
            onChange={onChange}
          />
        </div>

        <div className="im-field">
          <label className="im-field__label">Effective From</label>
          <SapDateInput
            className="im-field__input"
            name="EffectiveFrom"
            
            value={form.EffectiveFrom || ""}
            onChange={onChange}
          />
        </div>

      </div>

      <div className="im-section-title" style={{ marginTop: 14 }}>Deductibility</div>
      <div className="im-field-grid">

        <div className="im-field">
          <label className="im-field__label">Deductible %</label>
          {/* Deductible: decimal — % of tax that is deductible */}
          <input
            className="im-field__input"
            name="Deductible"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.Deductible ?? ""}
            onChange={onChange}
          />
        </div>

        <div className="im-field">
          <label className="im-field__label">Non-Deductible %</label>
          {/* NonDeductible: decimal — % of tax that is non-deductible */}
          <input
            className="im-field__input"
            name="NonDeductible"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={form.NonDeductible ?? ""}
            onChange={onChange}
          />
        </div>

        <div className="im-field">
          <label className="im-field__label">Non-Deductible Acct</label>
          <LookupField
            name="NonDeductibleAccount"
            value={form.NonDeductibleAccount || ""}
            displayValue={form.NonDeductibleAccountName || ""}
            onChange={onChange}
            onSelect={(row) =>
              setForm((p) => ({ ...p, NonDeductibleAccount: row.code, NonDeductibleAccountName: row.name }))
            }
            fetchOptions={fetchTaxGLAccounts}
            placeholder="G/L Account"
          />
        </div>

      </div>
    </div>
  );
}
