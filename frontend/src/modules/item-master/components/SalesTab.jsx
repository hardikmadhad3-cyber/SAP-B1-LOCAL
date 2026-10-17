import React from "react";

const LENGTH_UNITS = [
  { value: "1", label: "mm" },
  { value: "2", label: "cm" },
  { value: "3", label: "m" },
  { value: "4", label: "in" },
  { value: "5", label: "ft" },
];

const VOLUME_UNITS = [
  { value: "1", label: "mL" },
  { value: "2", label: "cL" },
  { value: "3", label: "dL" },
  { value: "4", label: "L" },
  { value: "5", label: "m³" },
  { value: "6", label: "ft³" },
];

const WEIGHT_UNITS = [
  { value: "1", label: "g" },
  { value: "2", label: "kg" },
  { value: "3", label: "t" },
  { value: "4", label: "oz" },
  { value: "5", label: "lb" },
];

export default function SalesTab({ form, onChange }) {
  return (
    <div>
      <div className="im-field-grid">

        <div className="im-field">
          <label className="im-field__label">Sales UoM Name</label>
          <input className="im-field__input" name="SalesUnit" value={form.SalesUnit || ""} onChange={onChange} />
        </div>

        <div className="im-field">
          <label className="im-field__label">Items per Sales Unit</label>
          <input className="im-field__input" name="SalesItemsPerUnit" type="number" value={form.SalesItemsPerUnit || ""} onChange={onChange} />
        </div>

        <div className="im-field">
          <label className="im-field__label">Packaging UoM Name</label>
          <input className="im-field__input" name="SalesPackagingUnit" value={form.SalesPackagingUnit || ""} onChange={onChange} />
        </div>

        <div className="im-field">
          <label className="im-field__label">Quantity per Package</label>
          <input className="im-field__input" name="SalesQtyPerPackUnit" type="number" value={form.SalesQtyPerPackUnit || ""} onChange={onChange} />
        </div>

      </div>

      {/* Dimensions */}
      <div className="im-section-title" style={{ marginTop: 14 }}>Dimensions</div>
      <div className="im-field-grid">

        <div className="im-field">
          <label className="im-field__label">Length</label>
          <input className="im-field__input" name="SalesUnitLength" type="number" value={form.SalesUnitLength || ""} onChange={onChange} style={{ flex: "0 0 80px" }} />
          <select className="im-field__select" name="SalesLengthUnit" value={form.SalesLengthUnit || "3"} onChange={onChange} style={{ flex: "0 0 60px" }}>
            {LENGTH_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Width</label>
          <input className="im-field__input" name="SalesUnitWidth" type="number" value={form.SalesUnitWidth || ""} onChange={onChange} style={{ flex: "0 0 80px" }} />
          <select className="im-field__select" name="SalesWidthUnit" value={form.SalesWidthUnit || "3"} onChange={onChange} style={{ flex: "0 0 60px" }}>
            {LENGTH_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Height</label>
          <input className="im-field__input" name="SalesUnitHeight" type="number" value={form.SalesUnitHeight || ""} onChange={onChange} style={{ flex: "0 0 80px" }} />
          <select className="im-field__select" name="SalesHeightUnit" value={form.SalesHeightUnit || "3"} onChange={onChange} style={{ flex: "0 0 60px" }}>
            {LENGTH_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Volume</label>
          <input className="im-field__input" name="SalesUnitVolume" type="number" value={form.SalesUnitVolume || ""} onChange={onChange} style={{ flex: "0 0 80px" }} />
          <select className="im-field__select" name="SalesVolumeUnit" value={form.SalesVolumeUnit || "4"} onChange={onChange} style={{ flex: "0 0 60px" }}>
            {VOLUME_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>

        <div className="im-field">
          <label className="im-field__label">Weight</label>
          <input className="im-field__input" name="SalesUnitWeight" type="number" value={form.SalesUnitWeight || ""} onChange={onChange} style={{ flex: "0 0 80px" }} />
          <select className="im-field__select" name="SalesWeightUnit" value={form.SalesWeightUnit || "2"} onChange={onChange} style={{ flex: "0 0 60px" }}>
            {WEIGHT_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>

      </div>

      {/* Factors */}
      <div className="im-section-title" style={{ marginTop: 14 }}>Unit Conversion Factors</div>
      <div className="im-field-grid">
        {[1, 2, 3, 4].map((n) => (
          <div className="im-field" key={n}>
            <label className="im-field__label">Factor {n}</label>
            <input className="im-field__input" name={`SalesFactor${n}`} type="number" value={form[`SalesFactor${n}`] || ""} onChange={onChange} />
          </div>
        ))}
      </div>

      {/* QR Code */}
      <div className="im-section-title" style={{ marginTop: 14 }}>QR Code</div>
      <div className="im-field-grid">
        <div className="im-field">
          <label className="im-field__label">Create QR Code From</label>
          <input className="im-field__input" name="CreateQRCodeFrom" value={form.CreateQRCodeFrom || ""} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}
