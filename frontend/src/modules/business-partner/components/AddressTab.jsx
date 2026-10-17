import React, { useEffect, useMemo, useState } from "react";

const EMPTY_ADDR = {
  AddressType: "bo_BillTo",
  AddressName: "",
  AddressName2: "",
  AddressName3: "",
  Street: "",
  StreetNo: "",
  Block: "",
  BuildingFloorRoom: "",
  City: "",
  ZipCode: "",
  County: "",
  State: "",
  Country: "IN",
  TaxOffice: "",
  GlobalLocationNumber: "",
  GSTIN: "",
  GstType: "",
  U_GSTIN_No: "",
  RowNum: null,
  __isPlaceholder: true,
};

const COUNTRIES = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "AE", name: "UAE" },
  { code: "SG", name: "Singapore" },
  { code: "AU", name: "Australia" },
];

const GST_TYPES = [
  { value: "", label: "-- Select GST Type --" },
  { value: "gstRegularTDSISD", label: "Regular / TDS / ISD" },
  { value: "gstCasualTaxablePerson", label: "Casual Taxable Person" },
  { value: "gstCompositionLevy", label: "Composition Levy" },
  { value: "gstGoverDepartPSU", label: "Government Department / PSU" },
  { value: "gstNonResidentTaxablePerson", label: "Non-Resident Taxable Person" },
  { value: "gstUNAgencyEmbassy", label: "UN Agency / Embassy" },
];

const ADDRESS_TYPES = ["bo_BillTo", "bo_ShipTo"];

const makePlaceholder = (type) => ({ ...EMPTY_ADDR, AddressType: type });
const isPlaceholderAddress = (address) => Boolean(address?.__isPlaceholder);

const ensurePlaceholders = (addresses = []) => {
  let changed = false;
  let next = Array.isArray(addresses) ? [...addresses] : [];

  ADDRESS_TYPES.forEach((type) => {
    const hasPlaceholder = next.some((address) => address.AddressType === type && isPlaceholderAddress(address));
    if (!hasPlaceholder) {
      next.push(makePlaceholder(type));
      changed = true;
    }
  });

  return changed ? next : addresses;
};

export default function AddressTab({ form, setForm }) {
  const addresses = useMemo(() => form.BPAddresses || [], [form.BPAddresses]);
  const [selectedIndex, setSelectedIndex] = useState(null);

  useEffect(() => {
    const next = ensurePlaceholders(addresses);
    if (next !== addresses) {
      setForm((prev) => ({ ...prev, BPAddresses: next }));
    }
  }, [addresses, setForm]);

  useEffect(() => {
    if (!addresses.length) {
      if (selectedIndex !== null) setSelectedIndex(null);
      return;
    }

    if (selectedIndex == null || !addresses[selectedIndex]) {
      setSelectedIndex(0);
    }
  }, [addresses, selectedIndex]);

  const entries = useMemo(
    () => addresses.map((address, fullIndex) => ({ ...address, fullIndex })),
    [addresses]
  );
  const billTos = entries.filter((address) => address.AddressType === "bo_BillTo");
  const shipTos = entries.filter((address) => address.AddressType === "bo_ShipTo");
  const current = selectedIndex != null ? addresses[selectedIndex] : null;

  const updateAddresses = (updater) => {
    setForm((prev) => {
      const currentAddresses = prev.BPAddresses || [];
      const nextAddresses = typeof updater === "function" ? updater(currentAddresses) : updater;
      return { ...prev, BPAddresses: nextAddresses };
    });
  };

  const selectAddr = (fullIndex) => setSelectedIndex(fullIndex);

  const addNew = (type) => {
    const placeholderIndex = addresses.findIndex(
      (address) => address.AddressType === type && isPlaceholderAddress(address)
    );

    if (placeholderIndex >= 0) {
      setSelectedIndex(placeholderIndex);
      return;
    }

    const next = [...addresses, makePlaceholder(type)];
    updateAddresses(next);
    setSelectedIndex(next.length - 1);
  };

  const saveField = (e) => {
    if (selectedIndex == null) return;

    const { name, value } = e.target;
    updateAddresses((currentAddresses) => {
      const next = [...currentAddresses];
      const currentAddress = next[selectedIndex];
      if (!currentAddress) return currentAddresses;

      const updatedAddress = { ...currentAddress, [name]: value };
      if (name === "AddressName" && String(value || "").trim() !== "") {
        updatedAddress.__isPlaceholder = false;
      }

      next[selectedIndex] = updatedAddress;
      return ensurePlaceholders(next);
    });
  };

  const handleHeaderFieldChange = (e) => {
    const { name, type, checked, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? (checked ? "tYES" : "tNO") : value,
    }));
  };

  const setDefault = () => {
    if (!current || isPlaceholderAddress(current) || !current.AddressName) return;

    const key = current.AddressType === "bo_BillTo" ? "BilltoDefault" : "ShipToDefault";
    setForm((prev) => ({ ...prev, [key]: current.AddressName }));
  };

  const renderListLabel = (address) => {
    const fallback = "Define New";
    if (isPlaceholderAddress(address) || !address.AddressName) return fallback;

    const isDefault =
      (address.AddressType === "bo_BillTo" && form.BilltoDefault === address.AddressName) ||
      (address.AddressType === "bo_ShipTo" && form.ShipToDefault === address.AddressName);

    return isDefault ? `${address.AddressName} (Default)` : address.AddressName;
  };

  const AddrList = ({ type, label, list }) => (
    <div style={{ marginBottom: 6 }}>
      <div
        style={{
          background: "#d0d8e4",
          padding: "3px 8px",
          fontSize: 11,
          fontWeight: 700,
          color: "#003366",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{`\u25BC ${label}`}</span>
        <button
          type="button"
          className="im-btn"
          style={{ padding: "1px 6px", fontSize: 11 }}
          onClick={() => addNew(type)}
        >
          +
        </button>
      </div>
      {list.map((address, idx) => (
        <div
          key={`${type}-${address.fullIndex}`}
          onClick={() => selectAddr(address.fullIndex)}
          style={{
            padding: "4px 16px",
            fontSize: 12,
            cursor: "pointer",
            background:
              selectedIndex === address.fullIndex
                ? "#cce0f5"
                : idx % 2 === 0
                  ? "#fff"
                  : "#f8fafc",
            borderBottom: "1px solid #e8ecf0",
          }}
        >
          {renderListLabel(address)}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 420 }}>
      <div style={{ width: 250, borderRight: "1px solid #c8d0da", flexShrink: 0 }}>
        <AddrList type="bo_BillTo" label="Bill To" list={billTos} />
        <AddrList type="bo_ShipTo" label="Ship To" list={shipTos} />
        <div style={{ padding: "8px 10px" }}>
          <button
            type="button"
            className="im-btn"
            style={{ width: "100%", fontSize: 11 }}
            onClick={setDefault}
            disabled={!current || isPlaceholderAddress(current) || !current.AddressName}
          >
            Set as Default
          </button>
        </div>
        <div style={{ padding: "0 10px 10px" }}>
          <div className="im-field" style={{ marginBottom: 8, alignItems: "center" }}>
            <label className="im-field__label" style={{ flex: "0 0 165px", textAlign: "left" }}>
              E-commerce Merchant ID
            </label>
            <input
              className="im-field__input"
              name="ECommerceMerchantID"
              value={form.ECommerceMerchantID || ""}
              onChange={handleHeaderFieldChange}
            />
          </div>
          <label className="im-checkbox-label" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              name="UseBillToAddrToDetermineTax"
              checked={form.UseBillToAddrToDetermineTax === "tYES"}
              onChange={handleHeaderFieldChange}
            />
            <span>Use Bill to Address to Determine Tax</span>
          </label>
        </div>
      </div>

      <div style={{ flex: 1, paddingLeft: 18 }}>
        {!current ? (
          <div style={{ color: "#888", fontSize: 12, padding: 20 }}>Select or add an address.</div>
        ) : (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#003366" }}>
                {current.AddressType === "bo_BillTo" ? "Bill To" : "Ship To"}
              </span>
              <a
                href="#map"
                style={{ fontSize: 11, color: "#0070c0" }}
                onClick={(e) => e.preventDefault()}
              >
                Show Location in Web Browser
              </a>
            </div>

            {[
              ["Address ID", "AddressName"],
              ["Address Name 2", "AddressName2"],
              ["Address Name 3", "AddressName3"],
              ["Street / PO Box", "Street"],
              ["Block", "Block"],
              ["City", "City"],
              ["Zip Code", "ZipCode"],
              ["County", "County"],
              ["State", "State"],
            ].map(([label, name]) => (
              <div className="im-field" key={name} style={{ marginBottom: 3 }}>
                <label className="im-field__label" style={{ flex: "0 0 180px", textAlign: "right" }}>
                  {label}
                </label>
                <input
                  className="im-field__input"
                  name={name}
                  value={current[name] || ""}
                  onChange={saveField}
                  placeholder={name === "AddressName" ? "Required" : undefined}
                  aria-required={name === "AddressName" || undefined}
                  style={{ maxWidth: 350 }}
                />
              </div>
            ))}

            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 180px", textAlign: "right" }}>
                Country/Region
              </label>
              <select
                className="im-field__select"
                name="Country"
                value={current.Country || "IN"}
                onChange={saveField}
                style={{ maxWidth: 350 }}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 180px", textAlign: "right" }}>
                Street No.
              </label>
              <input
                className="im-field__input"
                name="StreetNo"
                value={current.StreetNo || ""}
                onChange={saveField}
                style={{ maxWidth: 350 }}
              />
            </div>

            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 180px", textAlign: "right" }}>
                Building/Floor/Room
              </label>
              <input
                className="im-field__input"
                name="BuildingFloorRoom"
                value={current.BuildingFloorRoom || ""}
                onChange={saveField}
                style={{ maxWidth: 350 }}
              />
            </div>

            {[
              ["Tax Office", "TaxOffice"],
              ["GLN", "GlobalLocationNumber"],
              ["GSTIN", "GSTIN"],
            ].map(([label, name]) => (
              <div className="im-field" key={name} style={{ marginBottom: 3 }}>
                <label className="im-field__label" style={{ flex: "0 0 180px", textAlign: "right" }}>
                  {label}
                </label>
                <input
                  className="im-field__input"
                  name={name}
                  value={current[name] || ""}
                  onChange={saveField}
                  placeholder={name === "AddressName" ? "Required" : undefined}
                  aria-required={name === "AddressName" || undefined}
                  style={{ maxWidth: 350 }}
                />
              </div>
            ))}

            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 180px", textAlign: "right" }}>
                GST Type
              </label>
              <select
                className="im-field__select"
                name="GstType"
                value={current.GstType || ""}
                onChange={saveField}
                style={{ maxWidth: 350 }}
              >
                {GST_TYPES.map((option) => (
                  <option key={option.value || "blank"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="im-field" style={{ marginBottom: 3 }}>
              <label className="im-field__label" style={{ flex: "0 0 180px", textAlign: "right" }}>
                GSTIN No
              </label>
              <input
                className="im-field__input"
                name="U_GSTIN_No"
                value={current.U_GSTIN_No || ""}
                onChange={saveField}
                style={{ maxWidth: 350 }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
