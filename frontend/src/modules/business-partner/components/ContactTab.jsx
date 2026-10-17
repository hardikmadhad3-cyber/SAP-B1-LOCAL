import SapDateInput from '../../../components/common/SapDateInput';
import React, { useState } from "react";
import LookupField from "../../item-master/components/LookupField";

const normalizeGenderValue = (value) => {
  if (value === "gt_NotSpecified") return "gt_Undefined";
  return value || "gt_Undefined";
};

const EMPTY_CONTACT = {
  // Empty until the user types the Contact ID; the list still shows "Define New".
  Name: "",
  FirstName: "", MiddleName: "", LastName: "",
  Title: "", Position: "", Address: "",
  Phone1: "", Phone2: "", MobilePhone: "", Fax: "", E_Mail: "",
  EmailGroup: "", Pager: "", Remarks1: "", Remarks2: "",
  Password: "", DateOfBirth: "", Gender: "gt_Undefined",
  Profession: "", PlaceOfBirth: "",
  BlockSendingMarketingContent: "tNO",
  Active: "tYES",
};

const GENDER_OPTIONS = [
  { value: "gt_Undefined", label: "Not Specified" },
  { value: "gt_Male", label: "Male" },
  { value: "gt_Female", label: "Female" },
  { value: "gt_Masked", label: "Masked" },
  { value: "gt_Invalid", label: "Invalid" },
];

export default function ContactTab({ form, setForm, fetchCountries }) {
  const contacts = form.ContactEmployees || [];
  const [selected, setSelected] = useState(0);
  const [draft, setDraft] = useState(contacts[0] || { ...EMPTY_CONTACT });

  const selectContact = (i) => {
    setSelected(i);
    setDraft({ ...contacts[i] });
  };

  const addNew = () => {
    const newContact = { ...EMPTY_CONTACT };
    const updated = [...contacts, newContact];
    setForm((p) => ({ ...p, ContactEmployees: updated }));
    setSelected(updated.length - 1);
    setDraft({ ...newContact });
  };

  const saveField = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === "checkbox" ? (checked ? "tYES" : "tNO") : value;
    const updated = [...contacts];
    if (updated[selected]) {
      const previousName = String(updated[selected].Name || "").trim();
      updated[selected] = {
        ...updated[selected],
        [name]: name === "Gender" ? normalizeGenderValue(val) : val,
      };
      setForm((p) => {
        const nextForm = { ...p, ContactEmployees: updated };
        if (name === "Name" && previousName && String(p.ContactPerson || "").trim() === previousName) {
          nextForm.ContactPerson = String(val || "").trim();
        }
        return nextForm;
      });
    }
    setDraft((p) => ({ ...p, [name]: val }));
  };

  const setDefault = () => {
    const updated = contacts.map((c, i) => ({ ...c, IsDefault: i === selected ? "tYES" : "tNO" }));
    setForm((p) => ({
      ...p,
      ContactEmployees: updated,
      ContactPerson: String(updated[selected]?.Name || "").trim(),
    }));
  };

  const current = contacts[selected] || draft;
  const updateSelectedContact = (updater) => {
    if (!contacts[selected]) return;

    const updated = [...contacts];
    updated[selected] = typeof updater === "function"
      ? updater(updated[selected])
      : { ...updated[selected], ...updater };

    setForm((p) => ({
      ...p,
      ContactEmployees: updated,
    }));
    setDraft({ ...updated[selected] });
  };
  const placeOfBirthDisplayValue =
    current.PlaceOfBirthName && current.PlaceOfBirthName !== current.PlaceOfBirth
      ? current.PlaceOfBirthName
      : "";

  return (
    <div style={{ display: "flex", gap: 0, height: "100%", minHeight: 340 }}>
      {/* Left: Contact list */}
      <div style={{ width: 180, borderRight: "1px solid #c8d0da", paddingRight: 0, flexShrink: 0 }}>
        <div
          style={{
            background: "#e8edf2", borderBottom: "1px solid #c8d0da",
            padding: "3px 8px", fontSize: 11, fontWeight: 700, color: "#003366",
            display: "flex", justifyContent: "space-between", alignItems: "center"
          }}
        >
          <span>Contacts</span>
          <button className="im-btn" style={{ padding: "1px 6px", fontSize: 11 }} onClick={addNew}>+</button>
        </div>
        {contacts.length === 0 && (
          <div
            style={{ padding: "6px 10px", fontSize: 12, color: "#888", cursor: "pointer", background: "#fffde7" }}
            onClick={addNew}
          >
            Define New
          </div>
        )}
        {contacts.map((c, i) => (
          <div
            key={i}
            onClick={() => selectContact(i)}
            style={{
              padding: "5px 10px", fontSize: 12, cursor: "pointer",
              background: selected === i ? "#cce0f5" : i % 2 === 0 ? "#fff" : "#f8fafc",
              borderBottom: "1px solid #e8ecf0",
              fontWeight: selected === i ? 700 : 400,
            }}
          >
            {c.Name || c.FirstName || "Define New"}
          </div>
        ))}
        {contacts.length > 0 && (
          <div style={{ padding: "8px 10px" }}>
            <button className="im-btn" style={{ width: "100%", fontSize: 11 }} onClick={setDefault}>
              Set as Default
            </button>
          </div>
        )}
      </div>

      {/* Right: Contact detail form */}
      <div style={{ flex: 1, paddingLeft: 16, overflowY: "auto" }}>
        {contacts.length === 0 ? (
          <div style={{ color: "#888", fontSize: 12, padding: 20 }}>Click + to add a contact person.</div>
        ) : (
          <div>
            {[
              ["Contact ID", "Name"],
              ["First Name", "FirstName"],
              ["Middle Name", "MiddleName"],
              ["Last Name", "LastName"],
              ["Title", "Title"],
              ["Position", "Position"],
              ["Address", "Address"],
              ["Telephone 1", "Phone1"],
              ["Telephone 2", "Phone2"],
              ["Mobile Phone", "MobilePhone"],
              ["Fax", "Fax"],
              ["E-Mail", "E_Mail"],
              ["E-Mail Group", "EmailGroup"],
              ["Pager", "Pager"],
              ["Remarks 1", "Remarks1"],
              ["Remarks 2", "Remarks2"],
              ["Password", "Password"],
            ].map(([label, name]) => (
              <div className="im-field" key={name} style={{ marginBottom: 3 }}>
                <label className="im-field__label" style={{ flex: "0 0 160px", textAlign: "right" }}>{label}</label>
                <input
                  className="im-field__input"
                  name={name}
                  value={current[name] || ""}
                  onChange={saveField}
                  placeholder={name === "Name" ? "Required" : undefined}
                  aria-required={name === "Name" || undefined}
                  style={{ maxWidth: 280 }}
                />
              </div>
            ))}
            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 160px", textAlign: "right" }}>Date of Birth</label>
              <SapDateInput
                className="im-field__input"  name="DateOfBirth"
                value={current.DateOfBirth || ""} onChange={saveField} style={{ maxWidth: 280 }}
              />
            </div>
            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 160px", textAlign: "right" }}>Gender</label>
              <select
                className="im-field__select"
                name="Gender"
                value={normalizeGenderValue(current.Gender)}
                onChange={saveField}
                style={{ maxWidth: 280 }}
              >
                {GENDER_OPTIONS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            {[["Profession", "Profession"]].map(([label, name]) => (
              <div className="im-field" key={name} style={{ marginBottom: 3 }}>
                <label className="im-field__label" style={{ flex: "0 0 160px", textAlign: "right" }}>{label}</label>
                <input className="im-field__input" name={name} value={current[name] || ""} onChange={saveField} style={{ maxWidth: 280 }} />
              </div>
            ))}
            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 160px", textAlign: "right" }}>Country/Region of Birth</label>
              <LookupField
                name="PlaceOfBirth"
                value={current.PlaceOfBirth || ""}
                displayValue={placeOfBirthDisplayValue}
                onChange={() => {}}
                onSelect={(row) => updateSelectedContact({
                  PlaceOfBirth: row.code || "",
                  PlaceOfBirthName: row.name || "",
                })}
                fetchOptions={fetchCountries}
                columns={[
                  { label: "Code", key: "code" },
                  { label: "Country/Region", key: "name" },
                ]}
                placeholder="Country/Region of Birth"
                allowManualEntry={false}
                style={{ maxWidth: 280 }}
              />
            </div>
            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 160px", textAlign: "right" }}></label>
              <label className="im-checkbox-label">
                <input type="checkbox" name="BlockSendingMarketingContent"
                  checked={current.BlockSendingMarketingContent === "tYES"} onChange={saveField} />
                <span>Block Sending Marketing Content</span>
              </label>
            </div>
            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 160px", textAlign: "right" }}></label>
              <label className="im-checkbox-label">
                <input type="checkbox" name="Active"
                  checked={current.Active !== "tNO"} onChange={saveField} />
                <span>Active</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
