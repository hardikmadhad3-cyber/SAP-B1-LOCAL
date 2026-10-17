import React, { useCallback, useEffect, useState } from "react";
import "./styles/taxCodeSetup.css";
import LookupModal from "./components/LookupModal";
import {
  createTaxCode, getTaxCode, updateTaxCode, listSetupTaxCodes,
  listTaxTypes, listTaxComponents, getTaxComponent, createTaxComponent, updateTaxComponent,
  fetchTaxGLAccounts,
} from "../../api/taxCodeApi";

// SAP B1 India GST setup:
//   Tax Components (tax authorities) - e.g. CGST9: type CGST, rate 9%, sales/purchase tax accounts.
//   Tax Codes - e.g. GST18 = CGST9 + SGST9 (intra-state) or IGST18 (inter-state).
// The server enforces SAP's rules; this page shows its messages as they come.

const yes = (value) => (value ? "tYES" : "tNO");
const errorText = (err, fallback) => err.response?.data?.message || err.message || fallback;
const formatRate = (value) => Number(value || 0).toFixed(2);

function useAlert() {
  const [alert, setAlert] = useState(null);
  const show = useCallback((type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 6000);
  }, []);
  return [alert, show];
}

function Toolbar({ title, mode, loading, onSave, onNew, onFind }) {
  return (
    <div className="tc-toolbar">
      <span className="tc-toolbar__title">{title}</span>
      <button className="tc-btn tc-btn--primary" onClick={onSave} disabled={loading}>
        {loading ? "..." : mode === "add" ? "Add" : "Update"}
      </button>
      <button className="tc-btn" onClick={onNew}>New</button>
      <button className="tc-btn" onClick={onFind}>Find</button>
    </div>
  );
}

function Field({ label, children, wide }) {
  return (
    <div className={`tc-field${wide ? " tc-field--wide" : ""}`}>
      <label className="tc-field__label">{label}</label>
      {children}
    </div>
  );
}

function Check({ id, label, checked, onChange, disabled }) {
  return (
    <div className="tc-field tc-field--checkbox">
      <input type="checkbox" id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

// ---- Tax Codes ---------------------------------------------------------------

const EMPTY_CODE = { Code: "", Name: "", ValidForAR: true, ValidForAP: true, Freight: false, Inactive: false, Lines: [] };

function TaxCodesTab() {
  const [form, setForm] = useState(EMPTY_CODE);
  const [mode, setMode] = useState("add");
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [alert, showAlert] = useAlert();
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const totalRate = form.Lines.reduce((sum, line) => sum + Number(line.Rate || 0), 0);

  const load = async (code) => {
    setLoading(true);
    try {
      const [data, components] = await Promise.all([getTaxCode(code), listTaxComponents("")]);
      const byCode = new Map(components.map((component) => [component.Code, component]));
      setForm({
        Code: data.Code,
        Name: data.Name || "",
        ValidForAR: data.ValidForAR !== "tNO",
        ValidForAP: data.ValidForAP !== "tNO",
        Freight: data.Freight === "tYES",
        Inactive: data.Inactive === "tYES",
        Lines: (data.SalesTaxCodes_Lines || []).map((line) => ({
          STACode: line.STACode,
          Name: byCode.get(line.STACode)?.Name || "",
          TypeName: byCode.get(line.STACode)?.TypeName || "",
          Rate: line.EffectiveRate,
        })),
      });
      setMode("update");
    } catch (err) {
      showAlert("error", errorText(err, "Tax code not found."));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    const payload = {
      Code: form.Code.trim(),
      Name: form.Name.trim(),
      ValidForAR: yes(form.ValidForAR),
      ValidForAP: yes(form.ValidForAP),
      Freight: yes(form.Freight),
      Inactive: yes(form.Inactive),
      SalesTaxCodes_Lines: form.Lines.map((line) => ({ STACode: line.STACode })),
    };
    setLoading(true);
    try {
      if (mode === "add") await createTaxCode(payload);
      else await updateTaxCode(payload.Code, payload);
      showAlert("success", `Tax code "${payload.Code}" ${mode === "add" ? "added" : "updated"}.`);
      await load(payload.Code);
    } catch (err) {
      showAlert("error", errorText(err, "Could not save the tax code."));
    } finally {
      setLoading(false);
    }
  };

  const addComponent = (component) => {
    setLookup(null);
    if (form.Lines.some((line) => line.STACode === component.Code)) return;
    set({ Lines: [...form.Lines, { STACode: component.Code, Name: component.Name, TypeName: component.TypeName, Rate: component.Rate }] });
  };

  return (
    <>
      <Toolbar title="Tax Codes - Setup" mode={mode} loading={loading} onSave={save}
        onNew={() => { setForm(EMPTY_CODE); setMode("add"); }} onFind={() => setLookup("find")} />
      {alert && <div className={`tc-alert tc-alert--${alert.type}`}>{alert.msg}</div>}

      <div className="tc-header">
        <div className="tc-header-row">
          <Field label="Code*">
            <input className="tc-field__input tc-field__input--code" value={form.Code} maxLength={8}
              readOnly={mode === "update"} onChange={(e) => set({ Code: e.target.value.toUpperCase() })} autoFocus />
          </Field>
          <Field label="Description*" wide>
            <input className="tc-field__input" value={form.Name} maxLength={100} onChange={(e) => set({ Name: e.target.value })} />
          </Field>
          <Field label="Total Rate %">
            <input className="tc-field__input tc-field__input--rate tc-field__input--readonly" value={formatRate(totalRate)} readOnly
              title="Sum of the component rates" />
          </Field>
        </div>
        <div className="tc-header-row">
          <Check id="tc-ar" label="Valid for Sales (A/R)" checked={form.ValidForAR} onChange={(v) => set({ ValidForAR: v })} />
          <Check id="tc-ap" label="Valid for Purchasing (A/P)" checked={form.ValidForAP} onChange={(v) => set({ ValidForAP: v })} />
          <Check id="tc-freight" label="Freight" checked={form.Freight} onChange={(v) => set({ Freight: v })} />
          <Check id="tc-inactive" label="Inactive" checked={form.Inactive} onChange={(v) => set({ Inactive: v })} />
        </div>
      </div>

      <div className="tc-grid-section">
        <div className="tc-grid-wrap">
          <table className="tc-grid">
            <thead>
              <tr><th>#</th><th>Component</th><th>Description</th><th>Tax Type</th><th>Rate %</th><th /></tr>
            </thead>
            <tbody>
              {form.Lines.length === 0 && (
                <tr><td colSpan={6} className="tc-grid__cell--center">Add components, e.g. CGST + SGST (intra-state) or IGST (inter-state).</td></tr>
              )}
              {form.Lines.map((line, index) => (
                <tr key={line.STACode}>
                  <td className="tc-grid__cell--center">{index + 1}</td>
                  <td>{line.STACode}</td>
                  <td>{line.Name}</td>
                  <td>{line.TypeName}</td>
                  <td className="tc-grid__cell--center">{formatRate(line.Rate)}</td>
                  <td className="tc-grid__cell--center">
                    <button className="tc-grid__delete-btn" title="Remove"
                      onClick={() => set({ Lines: form.Lines.filter((_, i) => i !== index) })}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="tc-grid-actions">
          <button className="tc-btn tc-btn--small" onClick={() => setLookup("component")}>Add Component</button>
        </div>
      </div>

      {lookup === "find" && (
        <LookupModal title="Find Tax Code" onClose={() => setLookup(null)} fetchOptions={listSetupTaxCodes}
          onSelect={(row) => { setLookup(null); load(row.Code); }}
          columns={[{ key: "Code", label: "Code" }, { key: "Name", label: "Description" }, { key: "Rate", label: "Rate %" }, { key: "Lock", label: "Inactive" }]} />
      )}
      {lookup === "component" && (
        <LookupModal title="Select Tax Component" onClose={() => setLookup(null)} fetchOptions={listTaxComponents}
          onSelect={addComponent}
          columns={[{ key: "Code", label: "Code" }, { key: "Name", label: "Description" }, { key: "TypeName", label: "Tax Type" }, { key: "Rate", label: "Rate %" }]} />
      )}
    </>
  );
}

// ---- Tax Components ------------------------------------------------------------

const EMPTY_COMPONENT = {
  Code: "", Name: "", Type: "", Rate: "0", SalesTaxAccount: "", PurchaseTaxAccount: "",
  NonDeductiblePercent: "0", NonDeductibleAccount: "", ReverseChargePercent: "0",
};
const ACCOUNT_FIELDS = [
  ["SalesTaxAccount", "Sales Tax Account*"],
  ["PurchaseTaxAccount", "Purchase Tax Account*"],
  ["NonDeductibleAccount", "Non-Deductible Account"],
];

function TaxComponentsTab() {
  const [form, setForm] = useState(EMPTY_COMPONENT);
  const [types, setTypes] = useState([]);
  const [mode, setMode] = useState("add");
  const [loading, setLoading] = useState(false);
  const [lookup, setLookup] = useState(null);
  const [alert, showAlert] = useAlert();
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    listTaxTypes().then(setTypes).catch((err) => showAlert("error", errorText(err, "Could not load tax types.")));
  }, [showAlert]);

  const load = async (code) => {
    setLoading(true);
    try {
      const data = await getTaxComponent(code);
      setForm({
        Code: data.Code, Name: data.Name || "", Type: String(data.Type ?? ""), Rate: String(data.Rate ?? 0),
        SalesTaxAccount: data.SalesTaxAccount || "", PurchaseTaxAccount: data.PurchaseTaxAccount || "",
        NonDeductiblePercent: String(data.NonDeductiblePercent ?? 0), NonDeductibleAccount: data.NonDeductibleAccount || "",
        ReverseChargePercent: String(data.ReverseChargePercent ?? 0),
      });
      setMode("update");
    } catch (err) {
      showAlert("error", errorText(err, "Tax component not found."));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    const payload = {
      ...form,
      Code: form.Code.trim(),
      Name: form.Name.trim(),
      Type: form.Type === "" ? null : Number(form.Type),
      Rate: Number(form.Rate || 0),
      NonDeductiblePercent: Number(form.NonDeductiblePercent || 0),
      ReverseChargePercent: Number(form.ReverseChargePercent || 0),
    };
    setLoading(true);
    try {
      if (mode === "add") await createTaxComponent(payload);
      else await updateTaxComponent(payload.Code, payload);
      showAlert("success", `Tax component "${payload.Code}" ${mode === "add" ? "added" : "updated"}.`);
      await load(payload.Code);
    } catch (err) {
      showAlert("error", errorText(err, "Could not save the tax component."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Toolbar title="Tax Components - Setup" mode={mode} loading={loading} onSave={save}
        onNew={() => { setForm(EMPTY_COMPONENT); setMode("add"); }} onFind={() => setLookup("find")} />
      {alert && <div className={`tc-alert tc-alert--${alert.type}`}>{alert.msg}</div>}

      <div className="tc-header">
        <div className="tc-header-row">
          <Field label="Code*">
            <input className="tc-field__input tc-field__input--code" value={form.Code} maxLength={8}
              readOnly={mode === "update"} onChange={(e) => set({ Code: e.target.value.toUpperCase() })} autoFocus />
          </Field>
          <Field label="Description*" wide>
            <input className="tc-field__input" value={form.Name} maxLength={100} onChange={(e) => set({ Name: e.target.value })} />
          </Field>
        </div>
        <div className="tc-header-row">
          <Field label="Tax Type*">
            <select className="tc-field__select" value={form.Type} onChange={(e) => set({ Type: e.target.value })}>
              <option value="" />
              {types.map((type) => <option key={type.AbsId} value={type.AbsId}>{type.Name}</option>)}
            </select>
          </Field>
          <Field label="Rate %*">
            <input className="tc-field__input tc-field__input--rate" type="number" min="0" max="100" step="0.01"
              value={form.Rate} onChange={(e) => set({ Rate: e.target.value })} />
          </Field>
          <Field label="Non-Deductible %">
            <input className="tc-field__input tc-field__input--rate" type="number" min="0" max="100" step="0.01"
              value={form.NonDeductiblePercent} onChange={(e) => set({ NonDeductiblePercent: e.target.value })} />
          </Field>
          <Field label="Reverse Charge %">
            <input className="tc-field__input tc-field__input--rate" type="number" min="0" max="100" step="0.01"
              value={form.ReverseChargePercent} onChange={(e) => set({ ReverseChargePercent: e.target.value })} />
          </Field>
        </div>
        <div className="tc-header-row">
          {ACCOUNT_FIELDS.map(([field, label]) => (
            <Field key={field} label={label}>
              <div className="tc-grid__lookup">
                <input className="tc-field__input" value={form[field]} onChange={(e) => set({ [field]: e.target.value })} />
                <button className="tc-grid__lookup-btn" title="Select account" onClick={() => setLookup(field)}>…</button>
              </div>
            </Field>
          ))}
        </div>
      </div>

      {lookup === "find" && (
        <LookupModal title="Find Tax Component" onClose={() => setLookup(null)} fetchOptions={listTaxComponents}
          onSelect={(row) => { setLookup(null); load(row.Code); }}
          columns={[{ key: "Code", label: "Code" }, { key: "Name", label: "Description" }, { key: "TypeName", label: "Tax Type" }, { key: "Rate", label: "Rate %" }]} />
      )}
      {ACCOUNT_FIELDS.some(([field]) => field === lookup) && (
        <LookupModal title="Select G/L Account" onClose={() => setLookup(null)} fetchOptions={fetchTaxGLAccounts}
          onSelect={(row) => { set({ [lookup]: row.code }); setLookup(null); }}
          columns={[{ key: "code", label: "Account" }, { key: "name", label: "Name" }]} />
      )}
    </>
  );
}

// ---- Page ------------------------------------------------------------------------

export default function TaxCodeSetup() {
  const [tab, setTab] = useState("codes");
  return (
    <div className="tc-page">
      <div className="tc-tabs">
        <button className={`tc-tab${tab === "codes" ? " tc-tab--active" : ""}`} onClick={() => setTab("codes")}>Tax Codes</button>
        <button className={`tc-tab${tab === "components" ? " tc-tab--active" : ""}`} onClick={() => setTab("components")}>Tax Components</button>
      </div>
      {tab === "codes" ? <TaxCodesTab /> : <TaxComponentsTab />}
    </div>
  );
}
