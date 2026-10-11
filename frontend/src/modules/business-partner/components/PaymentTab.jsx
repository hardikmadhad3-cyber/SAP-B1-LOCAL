import SapDateInput from '../../../components/common/SapDateInput';
import React, { useEffect, useState } from "react";
import LookupField from "../../item-master/components/LookupField";

const PRIORITY_OPTIONS = [
  { value: "", label: "" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
];

const EMPTY_CREDIT_CARD_FORM = {
  CreditCardCode: "",
  CreditCardName: "",
  GLAccount: "",
  GLAccountName: "",
  Telephone: "",
  CompanyID: "",
  CountryCode: "",
};

const createPaymentDateRows = (dates = []) => {
  const rows = (dates || []).map((row) => ({ PaymentDate: row.PaymentDate || "" }));
  const minRows = Math.max(rows.length + 1, 12);
  while (rows.length < minRows) rows.push({ PaymentDate: "" });
  return rows;
};

const createBlankBankRow = () => ({
  BankCode: "",
  BankName: "",
  Country: "",
  CountryName: "",
  InternalKey: "",
  AccountNo: "",
  AccountName: "",
  ControlKey: "",
  Branch: "",
  IBAN: "",
  BICSwiftCode: "",
  MandateID: "",
  SignatureDate: "",
  CustomerIdNumber: "",
  Street: "",
  StreetNo: "",
  BuildingFloorRoom: "",
  ZipCode: "",
  Block: "",
  City: "",
  County: "",
  State: "",
  UserNo1: "",
  UserNo2: "",
  UserNo3: "",
  UserNo4: "",
});

const hasBankRowData = (row) => Object.entries(row || {}).some(([key, value]) => {
  if (key === "CountryName" || key === "BankName") return false;
  return value !== "" && value != null;
});

const createBankRows = (form) => {
  const rows = (form.BPBankAccounts || []).map((row) => ({
    ...createBlankBankRow(),
    ...row,
    InternalKey: row.InternalKey ?? "",
    SignatureDate: row.SignatureDate ? String(row.SignatureDate).slice(0, 10) : "",
    BankName: row.BankName || "",
    CountryName: row.CountryName || row.Country || "",
  }));

  if (rows.length === 0 && (
    form.PaymentBankCode || form.PaymentBankCountryCode || form.PaymentBankAccountNo || form.PaymentBankAccountName
  )) {
    rows.push({
      ...createBlankBankRow(),
      BankCode: form.PaymentBankCode || "",
      BankName: form.PaymentBankName || "",
      Country: form.PaymentBankCountryCode || "",
      CountryName: form.PaymentBankCountryName || "",
      InternalKey: form.PaymentBankInternalKey || "",
      AccountNo: form.PaymentBankAccountNo || "",
      AccountName: form.PaymentBankAccountName || "",
      ControlKey: form.PaymentBankControlKey || "",
      Branch: form.PaymentBankBranch || "",
      IBAN: form.PaymentBankIBAN || "",
      BICSwiftCode: form.PaymentBankBICSwiftCode || "",
      MandateID: form.PaymentBankMandateID || "",
      SignatureDate: form.PaymentBankSignatureDate || "",
      CustomerIdNumber: form.PaymentBankCustomerIdNumber || "",
    });
  }

  rows.push(createBlankBankRow());
  return rows;
};

const normalizeBankRowsForSave = (rows = []) =>
  rows
    .filter((row) => hasBankRowData(row))
    .map((row) => ({
      BankCode: row.BankCode || "",
      BankName: row.BankName || "",
      Country: row.Country || "",
      CountryName: row.CountryName || row.Country || "",
      InternalKey: row.InternalKey || "",
      AccountNo: row.AccountNo || "",
      AccountName: row.AccountName || "",
      ControlKey: row.ControlKey || "",
      Branch: row.Branch || "",
      IBAN: row.IBAN || "",
      BICSwiftCode: row.BICSwiftCode || "",
      MandateID: row.MandateID || "",
      SignatureDate: row.SignatureDate || "",
      CustomerIdNumber: row.CustomerIdNumber || "",
      Street: row.Street || "",
      StreetNo: row.StreetNo || "",
      BuildingFloorRoom: row.BuildingFloorRoom || "",
      ZipCode: row.ZipCode || "",
      Block: row.Block || "",
      City: row.City || "",
      County: row.County || "",
      State: row.State || "",
      UserNo1: row.UserNo1 || "",
      UserNo2: row.UserNo2 || "",
      UserNo3: row.UserNo3 || "",
      UserNo4: row.UserNo4 || "",
    }));

export default function PaymentTab({
  form,
  onChange,
  setForm,
  fetchBPPriceLists,
  fetchPaymentTerms,
  fetchCreditCards,
  fetchGLAccounts,
  fetchBanks,
  fetchCountries,
  createCreditCard,
  showAlert,
}) {
  const [showPaymentDatesModal, setShowPaymentDatesModal] = useState(false);
  const [paymentDateRows, setPaymentDateRows] = useState(() => createPaymentDateRows(form.BPPaymentDates));
  const [showCreditCardSetup, setShowCreditCardSetup] = useState(false);
  const [creditCardForm, setCreditCardForm] = useState(EMPTY_CREDIT_CARD_FORM);
  const [creditCardSaving, setCreditCardSaving] = useState(false);
  const [showBankSetup, setShowBankSetup] = useState(false);
  const [bankRows, setBankRows] = useState(() => createBankRows(form));
  const [selectedBankIndex, setSelectedBankIndex] = useState(form.PaymentBankSelectedIndex >= 0 ? form.PaymentBankSelectedIndex : 0);
  const showSalesOrderPartialDelivery = form.CardType !== "cSupplier";
  const showPartialDeliveryPerRow = showSalesOrderPartialDelivery && form.PartialDelivery === "tYES";

  useEffect(() => {
    if (form.CardType === "cSupplier" && (form.PartialDelivery === "tYES" || form.BackOrder === "tYES")) {
      setForm((prev) => ({
        ...prev,
        PartialDelivery: "tNO",
        BackOrder: "tNO",
      }));
      return;
    }

    if (form.PartialDelivery !== "tYES" && form.BackOrder === "tYES") {
      setForm((prev) => ({
        ...prev,
        BackOrder: "tNO",
      }));
    }
  }, [form.BackOrder, form.CardType, form.PartialDelivery, setForm]);

  const paymentDates = form.BPPaymentDates || [];
  const paymentDateSummary = paymentDates.length > 0 ? paymentDates.map((row) => row.PaymentDate).join(", ") : "";

  const handleCheckboxChange = (name) => (e) => {
    onChange({
      target: {
        name,
        type: "checkbox",
        checked: e.target.checked,
      },
    });
  };

  const syncBankRowsToForm = (rows, selectedIndex = 0) => {
    const savedRows = normalizeBankRowsForSave(rows);
    const safeIndex = savedRows.length === 0 ? -1 : Math.min(Math.max(selectedIndex, 0), savedRows.length - 1);
    const selectedRow = safeIndex >= 0 ? savedRows[safeIndex] : null;

    setForm((prev) => ({
      ...prev,
      BPBankAccounts: savedRows,
      PaymentBankSelectedIndex: safeIndex,
      PaymentBankCode: selectedRow?.BankCode || "",
      PaymentBankName: selectedRow?.BankName || "",
      PaymentBankCountryCode: selectedRow?.Country || "",
      PaymentBankCountryName: selectedRow?.CountryName || "",
      BankCountry: selectedRow?.Country || "",
      DefaultBankCode: selectedRow?.BankCode || "",
      PaymentBankInternalKey: selectedRow?.InternalKey || "",
      PaymentBankAccountNo: selectedRow?.AccountNo || "",
      PaymentBankAccountName: selectedRow?.AccountName || "",
      PaymentBankControlKey: selectedRow?.ControlKey || "",
      PaymentBankBranch: selectedRow?.Branch || "",
      PaymentBankIBAN: selectedRow?.IBAN || "",
      PaymentBankBICSwiftCode: selectedRow?.BICSwiftCode || "",
      PaymentBankMandateID: selectedRow?.MandateID || "",
      PaymentBankSignatureDate: selectedRow?.SignatureDate || "",
      PaymentBankCustomerIdNumber: selectedRow?.CustomerIdNumber || "",
    }));
  };

  const openPaymentDatesModal = () => {
    setPaymentDateRows(createPaymentDateRows(form.BPPaymentDates));
    setShowPaymentDatesModal(true);
  };

  const openBankSetupModal = () => {
    const rows = createBankRows(form);
    setBankRows(rows);
    setSelectedBankIndex(form.PaymentBankSelectedIndex >= 0 ? form.PaymentBankSelectedIndex : 0);
    setShowBankSetup(true);
  };

  const handlePaymentDateChange = (index, value) => {
    setPaymentDateRows((prev) => {
      const next = prev.map((row, rowIndex) => rowIndex === index ? { ...row, PaymentDate: value } : row);
      const last = next[next.length - 1];
      if (last && last.PaymentDate) next.push({ PaymentDate: "" });
      return next;
    });
  };

  const handleSavePaymentDates = () => {
    const dates = paymentDateRows
      .filter((row) => row.PaymentDate)
      .map((row) => ({ PaymentDate: row.PaymentDate }));

    setForm((prev) => ({ ...prev, BPPaymentDates: dates }));
    setShowPaymentDatesModal(false);
  };

  const updateMainBankField = (fieldName, rowField) => (e) => {
    const value = e.target.value;
    setForm((prev) => {
      const targetIndex = prev.PaymentBankSelectedIndex >= 0 ? prev.PaymentBankSelectedIndex : 0;
      const rows = [...(prev.BPBankAccounts || [])];

      if (!rows[targetIndex]) rows[targetIndex] = createBlankBankRow();

      rows[targetIndex] = {
        ...rows[targetIndex],
        [rowField]: value,
      };

      return {
        ...prev,
        [fieldName]: value,
        ...(fieldName === "DefaultBankCode" ? { PaymentBankCode: value } : {}),
        BPBankAccounts: rows,
        PaymentBankSelectedIndex: targetIndex,
      };
    });
  };

  const handleMainBankLookupSelect = (row) => {
    const currentIndex = form.PaymentBankSelectedIndex >= 0 ? form.PaymentBankSelectedIndex : 0;
    const rows = [...(form.BPBankAccounts || [])];
    if (!rows[currentIndex]) rows[currentIndex] = createBlankBankRow();
    rows[currentIndex] = {
      ...rows[currentIndex],
      BankCode: row.code || "",
      BankName: row.name || "",
      Country: row.country || rows[currentIndex].Country || "",
      CountryName: row.countryName || row.country || rows[currentIndex].CountryName || "",
      BICSwiftCode: rows[currentIndex].BICSwiftCode || row.swift || "",
      IBAN: rows[currentIndex].IBAN || row.iban || "",
      Branch: rows[currentIndex].Branch || row.branch || "",
    };
    syncBankRowsToForm(rows, currentIndex);
  };

  const handleBankRowChange = (index, field, value) => {
    setBankRows((prev) => {
      const next = prev.map((row, rowIndex) => {
        if (rowIndex !== index) return row;

        const updatedRow = { ...row, [field]: value };
        if (field === "Country" && value !== row.Country) updatedRow.CountryName = "";
        if (field === "BankCode" && value !== row.BankCode) updatedRow.BankName = "";
        return updatedRow;
      });

      if (index === next.length - 1 && hasBankRowData(next[index])) next.push(createBlankBankRow());
      return next;
    });
  };

  const hydrateBankRow = async (index, baseRow = null) => {
    const row = baseRow || bankRows[index];
    if (!row) return;

    let nextRow = { ...row };

    if (row.Country) {
      try {
        const countries = await fetchCountries(row.Country);
        const exactCountry = countries.find((item) => item.code === row.Country);
        if (exactCountry) nextRow.CountryName = exactCountry.name || row.Country;
      } catch (_) {}
    }

    if (row.BankCode) {
      try {
        const banks = await fetchBanks(row.BankCode, row.Country || "");
        const exactBank = banks.find((item) => item.code === row.BankCode);
        if (exactBank) {
          nextRow = {
            ...nextRow,
            BankName: exactBank.name || nextRow.BankName,
            Country: exactBank.country || nextRow.Country,
            CountryName: exactBank.countryName || nextRow.CountryName,
            Branch: nextRow.Branch || exactBank.branch || "",
            IBAN: nextRow.IBAN || exactBank.iban || "",
            BICSwiftCode: nextRow.BICSwiftCode || exactBank.swift || "",
          };
        }
      } catch (_) {}
    }

    let nextRowsForSync = null;
    setBankRows((prev) => {
      nextRowsForSync = prev.map((item, rowIndex) => rowIndex === index ? nextRow : item);
      if (index === nextRowsForSync.length - 1 && hasBankRowData(nextRowsForSync[index])) {
        nextRowsForSync.push(createBlankBankRow());
      }
      return nextRowsForSync;
    });

    if (selectedBankIndex === index && nextRowsForSync) {
      syncBankRowsToForm(nextRowsForSync, index);
    }
  };

  const handleSelectBankRow = (index) => {
    setSelectedBankIndex(index);
    const row = bankRows[index];
    if (!row) return;
    syncBankRowsToForm(bankRows, index);
    if ((row.BankCode && !row.BankName) || (row.Country && !row.CountryName)) {
      hydrateBankRow(index, row);
    }
  };

  const handleSetDefaultBankRow = () => {
    if (selectedBankIndex <= 0) return;
    const nextRows = [...bankRows];
    const [selected] = nextRows.splice(selectedBankIndex, 1);
    nextRows.unshift(selected);
    setBankRows(nextRows);
    setSelectedBankIndex(0);
    syncBankRowsToForm(nextRows, 0);
  };

  const handleSaveBankSetup = () => {
    syncBankRowsToForm(bankRows, selectedBankIndex);
    setShowBankSetup(false);
  };

  const handleCreateCreditCard = async () => {
    if (!creditCardForm.CreditCardName.trim()) {
      showAlert?.("error", "Credit Card Name is required.");
      return;
    }

    if (!creditCardForm.GLAccount.trim()) {
      showAlert?.("error", "G/L Account is required.");
      return;
    }

    setCreditCardSaving(true);
    try {
      const result = await createCreditCard({
        CreditCardName: creditCardForm.CreditCardName.trim(),
        GLAccount: creditCardForm.GLAccount.trim(),
        Telephone: creditCardForm.Telephone.trim(),
        CompanyID: creditCardForm.CompanyID.trim(),
      });

      setForm((prev) => ({
        ...prev,
        CreditCardCode: result.code || "",
        CreditCardName: result.name || "",
      }));
      setCreditCardForm(EMPTY_CREDIT_CARD_FORM);
      setShowCreditCardSetup(false);
      showAlert?.("success", `Credit card "${result.name}" created.`);
    } catch (err) {
      showAlert?.("error", err.response?.data?.message || err.message || "Failed to create credit card.");
    } finally {
      setCreditCardSaving(false);
    }
  };

  return (
    <>
      <div className="bp-payment-layout">
        <div className="bp-payment-main">
          <div className="bp-payment-columns">
            <div className="bp-payment-column">
              <div className="im-field">
                <label className="im-field__label">Payment Terms</label>
                <LookupField
                  name="PayTermsGrpCode"
                  value={form.PayTermsGrpCode || ""}
                  displayValue={form.PayTermsName || ""}
                  onChange={onChange}
                  onSelect={(row) => setForm((prev) => ({
                    ...prev,
                    PayTermsGrpCode: row.code,
                    PayTermsName: row.name,
                  }))}
                  fetchOptions={fetchPaymentTerms}
                  placeholder="Payment Terms"
                />
              </div>

              <div className="im-field">
                <label className="im-field__label">Interest on Arrears %</label>
                <input className="im-field__input" name="IntrestRatePercent" type="number" step="0.01" value={form.IntrestRatePercent || ""} onChange={onChange} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Price List</label>
                <LookupField
                  name="PriceListNum"
                  value={form.PriceListNum || ""}
                  displayValue={form.PriceListName || ""}
                  onChange={onChange}
                  onSelect={(row) => setForm((prev) => ({
                    ...prev,
                    PriceListNum: row.code,
                    PriceListName: row.name,
                  }))}
                  fetchOptions={fetchBPPriceLists}
                  placeholder="Price List"
                />
              </div>

              <div className="im-field">
                <label className="im-field__label">Total Discount %</label>
                <input className="im-field__input" name="DiscountPercent" type="number" step="0.01" value={form.DiscountPercent || ""} onChange={onChange} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Credit Limit</label>
                <input className="im-field__input" name="CreditLimit" type="number" step="0.01" value={form.CreditLimit || ""} onChange={onChange} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Commitment Limit</label>
                <input className="im-field__input" name="MaxCommitment" type="number" step="0.01" value={form.MaxCommitment || ""} onChange={onChange} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Dunning Term</label>
                <select className="im-field__select" name="DunningTerm" value={form.DunningTerm || ""} onChange={onChange}>
                  <option value="">-- Select --</option>
                  <option value="1">Term 1</option>
                  <option value="2">Term 2</option>
                  <option value="3">Term 3</option>
                </select>
              </div>

              <div className="im-field">
                <label className="im-field__label">Effective Discount Groups</label>
                <select className="im-field__select" name="EffectiveDiscount" value={form.EffectiveDiscount || "dgrLowestDiscount"} onChange={onChange}>
                  <option value="dgrLowestDiscount">Lowest Discount</option>
                  <option value="dgrHighestDiscount">Highest Discount</option>
                  <option value="dgrMultipliedDiscount">Multiplied Discount</option>
                  <option value="dgrDiscountTotals">Discount Totals</option>
                  <option value="dgrAverageDiscount">Average Discount</option>
                </select>
              </div>

              <div className="im-field">
                <label className="im-field__label">Effective Price</label>
                <select className="im-field__select" name="EffectivePrice" value={form.EffectivePrice || "epDefaultPriority"} onChange={onChange}>
                  <option value="epDefaultPriority">Default Priority</option>
                  <option value="epLowestPrice">Lowest Price</option>
                  <option value="epHighestPrice">Highest Price</option>
                </select>
              </div>

              <div className="bp-payment-note-row">
                <label className="im-checkbox-label">
                  <input type="checkbox" checked={form.EffectivePriceConsidersPriceBeforeDiscount === "tYES"} onChange={handleCheckboxChange("EffectivePriceConsidersPriceBeforeDiscount")} />
                  <span>Effective Price Considers All Price Sources</span>
                </label>
              </div>
            </div>

            <div className="bp-payment-column">
              <div className="im-field">
                <label className="im-field__label">Credit Card Type</label>
                <LookupField
                  name="CreditCardCode"
                  value={form.CreditCardCode || ""}
                  displayValue={form.CreditCardName || ""}
                  onChange={onChange}
                  onSelect={(row) => setForm((prev) => ({
                    ...prev,
                    CreditCardCode: row.code,
                    CreditCardName: row.name,
                  }))}
                  fetchOptions={fetchCreditCards}
                  placeholder="Credit Card"
                  onDefineNew={() => setShowCreditCardSetup(true)}
                />
              </div>

              <div className="im-field">
                <label className="im-field__label">Credit Card No.</label>
                <input className="im-field__input" name="CreditCardNum" value={form.CreditCardNum || ""} onChange={onChange} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Expiration Date</label>
                <SapDateInput className="im-field__input" name="CreditCardExpiration"  value={form.CreditCardExpiration || ""} onChange={onChange} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Average Delay</label>
                <input className="im-field__input" name="AvarageLate" type="number" value={form.AvarageLate || ""} onChange={onChange} readOnly style={{ background: "#f0f2f5", color: "#555" }} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Priority</label>
                <select className="im-field__select" name="Priority" value={form.Priority || ""} onChange={onChange}>
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value || "blank"} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div className="im-field">
                <label className="im-field__label">Default IBAN</label>
                <input className="im-field__input" name="IBAN" value={form.IBAN || ""} onChange={onChange} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Payment Dates</label>
                <div className="bp-inline-action">
                  <input className="im-field__input" value={paymentDateSummary} readOnly />
                  <button type="button" className="im-lookup-btn" onClick={openPaymentDatesModal} title="Payment Dates Setup">...</button>
                </div>
              </div>

              <div className="bp-payment-flags">
                {showSalesOrderPartialDelivery && (
                  <label className="im-checkbox-label">
                    <input type="checkbox" checked={form.PartialDelivery === "tYES"} onChange={handleCheckboxChange("PartialDelivery")} />
                    <span>Allow Partial Delivery of Sales Order</span>
                  </label>
                )}
                {showPartialDeliveryPerRow && (
                  <label className="im-checkbox-label">
                    <input type="checkbox" checked={form.BackOrder === "tYES"} onChange={handleCheckboxChange("BackOrder")} />
                    <span>Allow Partial Delivery per Row</span>
                  </label>
                )}
                <label className="im-checkbox-label">
                  <input type="checkbox" checked={form.NoDiscounts === "tYES"} onChange={handleCheckboxChange("NoDiscounts")} />
                  <span>Do Not Apply Discount Groups</span>
                </label>
                <label className="im-checkbox-label">
                  <input type="checkbox" checked={form.EndorsableChecksFromBP === "tYES"} onChange={handleCheckboxChange("EndorsableChecksFromBP")} />
                  <span>Endorsable Checks from This BP</span>
                </label>
                <label className="im-checkbox-label">
                  <input type="checkbox" checked={form.AcceptsEndorsedChecks === "tYES"} onChange={handleCheckboxChange("AcceptsEndorsedChecks")} />
                  <span>This BP Accepts Endorsed Checks</span>
                </label>
              </div>
            </div>
          </div>

          <div className="bp-payment-bank">
            <div className="bp-payment-section-title">Business Partner Bank</div>

            <div className="bp-payment-bank-grid">
              <div className="im-field">
                <label className="im-field__label">Bank Country/Region</label>
                <div className="bp-inline-action">
                  <input className="im-field__input" value={form.PaymentBankCountryName || ""} readOnly />
                  <button type="button" className="im-lookup-btn" onClick={openBankSetupModal} title="Business Partner Bank Accounts - Setup">...</button>
                </div>
              </div>

              <div className="im-field">
                <label className="im-field__label">Bank Name</label>
                <LookupField
                  name="PaymentBankCode"
                  value={form.PaymentBankCode || ""}
                  displayValue={form.PaymentBankName || ""}
                  onChange={onChange}
                  onSelect={handleMainBankLookupSelect}
                  fetchOptions={(query) => fetchBanks(query, form.PaymentBankCountryCode || form.BankCountry || "")}
                  placeholder="Bank"
                />
              </div>

              <div className="im-field">
                <label className="im-field__label">Bank Code</label>
                <input className="im-field__input" value={form.DefaultBankCode || form.PaymentBankCode || ""} onChange={updateMainBankField("DefaultBankCode", "BankCode")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Account</label>
                <input className="im-field__input" value={form.PaymentBankAccountNo || ""} onChange={updateMainBankField("PaymentBankAccountNo", "AccountNo")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">BIC/SWIFT Code</label>
                <input className="im-field__input" value={form.PaymentBankBICSwiftCode || ""} onChange={updateMainBankField("PaymentBankBICSwiftCode", "BICSwiftCode")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Bank Account Name</label>
                <input className="im-field__input" value={form.PaymentBankAccountName || ""} onChange={updateMainBankField("PaymentBankAccountName", "AccountName")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Branch</label>
                <input className="im-field__input" value={form.PaymentBankBranch || ""} onChange={updateMainBankField("PaymentBankBranch", "Branch")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Ctrl Int. ID</label>
                <input className="im-field__input" value={form.PaymentBankControlKey || ""} onChange={updateMainBankField("PaymentBankControlKey", "ControlKey")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">ID Number</label>
                <input className="im-field__input" value={form.PaymentBankCustomerIdNumber || ""} onChange={updateMainBankField("PaymentBankCustomerIdNumber", "CustomerIdNumber")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">IBAN</label>
                <input className="im-field__input" value={form.PaymentBankIBAN || ""} onChange={updateMainBankField("PaymentBankIBAN", "IBAN")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Mandate ID</label>
                <input className="im-field__input" value={form.PaymentBankMandateID || ""} onChange={updateMainBankField("PaymentBankMandateID", "MandateID")} />
              </div>

              <div className="im-field">
                <label className="im-field__label">Date of Signature</label>
                <SapDateInput className="im-field__input"  value={form.PaymentBankSignatureDate || ""} onChange={updateMainBankField("PaymentBankSignatureDate", "SignatureDate")} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {showPaymentDatesModal && (
        <div className="im-modal-overlay" onClick={() => setShowPaymentDatesModal(false)}>
          <div className="im-modal bp-sap-modal bp-sap-modal--dates" onClick={(e) => e.stopPropagation()}>
            <div className="im-modal__header">
              <span>Payment Dates</span>
              <button className="im-modal__close" onClick={() => setShowPaymentDatesModal(false)}>x</button>
            </div>
            <div className="im-modal__body">
              <div className="bp-sap-grid-wrap">
                <table className="bp-sap-grid">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>Payment Dates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentDateRows.map((row, index) => (
                      <tr key={`pay-date-${index}`}>
                        <td>{index + 1}</td>
                        <td>
                          <SapDateInput
                            className={`bp-sap-grid__input${index === 0 ? " bp-sap-grid__input--active" : ""}`}
                            
                            value={row.PaymentDate}
                            onChange={(e) => handlePaymentDateChange(index, e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="im-modal__footer">
              <button className="im-btn im-btn--primary" onClick={handleSavePaymentDates}>OK</button>
              <button className="im-btn" onClick={() => setShowPaymentDatesModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showBankSetup && (
        <div className="im-modal-overlay" onClick={() => setShowBankSetup(false)}>
          <div className="im-modal bp-sap-modal bp-sap-modal--banks" onClick={(e) => e.stopPropagation()}>
            <div className="im-modal__header">
              <span>Business Partner Bank Accounts - Setup</span>
              <button className="im-modal__close" onClick={() => setShowBankSetup(false)}>x</button>
            </div>
            <div className="im-modal__body">
              <div className="bp-sap-grid-wrap bp-sap-grid-wrap--banks">
                <table className="bp-sap-grid bp-sap-grid--banks">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>#</th>
                      <th>Bank Code</th>
                      <th>Country/Region</th>
                      <th>Bank Internal ID</th>
                      <th>Account No.</th>
                      <th>Bank Account Name</th>
                      <th>Ctrl Int. ID</th>
                      <th>Branch</th>
                      <th>IBAN</th>
                      <th>BIC/SWIFT Code</th>
                      <th>Mandate ID</th>
                      <th>Date of Signature</th>
                      <th>ID Number</th>
                      <th>Street</th>
                      <th>Street No.</th>
                      <th>Building/Floor/Room</th>
                      <th>Zip Code</th>
                      <th>Block</th>
                      <th>City</th>
                      <th>County</th>
                      <th>State</th>
                      <th>User No. 1</th>
                      <th>User No. 2</th>
                      <th>User No. 3</th>
                      <th>User No. 4</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankRows.map((row, index) => (
                      <tr
                        key={`bank-row-${index}`}
                        className={selectedBankIndex === index ? "bp-sap-grid__row--selected" : ""}
                        onClick={() => handleSelectBankRow(index)}
                      >
                        <td>{index + 1}</td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.BankCode || ""} onChange={(e) => handleBankRowChange(index, "BankCode", e.target.value)} onBlur={() => hydrateBankRow(index)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.Country || ""} onChange={(e) => handleBankRowChange(index, "Country", e.target.value)} onBlur={() => hydrateBankRow(index)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.InternalKey || ""} onChange={(e) => handleBankRowChange(index, "InternalKey", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.AccountNo || ""} onChange={(e) => handleBankRowChange(index, "AccountNo", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.AccountName || ""} onChange={(e) => handleBankRowChange(index, "AccountName", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.ControlKey || ""} onChange={(e) => handleBankRowChange(index, "ControlKey", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.Branch || ""} onChange={(e) => handleBankRowChange(index, "Branch", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.IBAN || ""} onChange={(e) => handleBankRowChange(index, "IBAN", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.BICSwiftCode || ""} onChange={(e) => handleBankRowChange(index, "BICSwiftCode", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.MandateID || ""} onChange={(e) => handleBankRowChange(index, "MandateID", e.target.value)} />
                        </td>
                        <td>
                          <SapDateInput className="bp-sap-grid__input"  value={row.SignatureDate || ""} onChange={(e) => handleBankRowChange(index, "SignatureDate", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.CustomerIdNumber || ""} onChange={(e) => handleBankRowChange(index, "CustomerIdNumber", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.Street || ""} onChange={(e) => handleBankRowChange(index, "Street", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.StreetNo || ""} onChange={(e) => handleBankRowChange(index, "StreetNo", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.BuildingFloorRoom || ""} onChange={(e) => handleBankRowChange(index, "BuildingFloorRoom", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.ZipCode || ""} onChange={(e) => handleBankRowChange(index, "ZipCode", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.Block || ""} onChange={(e) => handleBankRowChange(index, "Block", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.City || ""} onChange={(e) => handleBankRowChange(index, "City", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.County || ""} onChange={(e) => handleBankRowChange(index, "County", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.State || ""} onChange={(e) => handleBankRowChange(index, "State", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.UserNo1 || ""} onChange={(e) => handleBankRowChange(index, "UserNo1", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.UserNo2 || ""} onChange={(e) => handleBankRowChange(index, "UserNo2", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.UserNo3 || ""} onChange={(e) => handleBankRowChange(index, "UserNo3", e.target.value)} />
                        </td>
                        <td>
                          <input className="bp-sap-grid__input" value={row.UserNo4 || ""} onChange={(e) => handleBankRowChange(index, "UserNo4", e.target.value)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="im-modal__footer">
              <button className="im-btn im-btn--primary" onClick={handleSaveBankSetup}>OK</button>
              <button className="im-btn" onClick={() => setShowBankSetup(false)}>Cancel</button>
              <button className="im-btn" onClick={handleSetDefaultBankRow} disabled={selectedBankIndex <= 0}>Set as Default</button>
            </div>
          </div>
        </div>
      )}

      {showCreditCardSetup && (
        <div className="im-modal-overlay" onClick={() => setShowCreditCardSetup(false)}>
          <div className="im-modal im-modal--setup" onClick={(e) => e.stopPropagation()}>
            <div className="im-modal__header">
              <span>Credit Cards - Setup</span>
              <button className="im-modal__close" onClick={() => setShowCreditCardSetup(false)}>x</button>
            </div>
            <div className="im-modal__body">
              <div className="bp-credit-card-setup-grid">
                <div className="im-field">
                  <label className="im-field__label">Code</label>
                  <input
                    className="im-field__input"
                    value={creditCardForm.CreditCardCode}
                    readOnly
                    placeholder="Auto assigned by SAP"
                    style={{ background: "#f0f2f5", color: "#555" }}
                  />
                </div>
                <div className="im-field">
                  <label className="im-field__label">Name</label>
                  <input className="im-field__input" value={creditCardForm.CreditCardName} onChange={(e) => setCreditCardForm((prev) => ({ ...prev, CreditCardName: e.target.value }))} autoFocus />
                </div>
                <div className="im-field">
                  <label className="im-field__label">G/L Account</label>
                  <LookupField
                    name="GLAccount"
                    value={creditCardForm.GLAccount}
                    displayValue={creditCardForm.GLAccountName || ""}
                    onChange={(e) => setCreditCardForm((prev) => ({
                      ...prev,
                      GLAccount: e.target.value,
                      GLAccountName: "",
                    }))}
                    onSelect={(row) => setCreditCardForm((prev) => ({
                      ...prev,
                      GLAccount: row.code || "",
                      GLAccountName: row.name || "",
                    }))}
                    fetchOptions={fetchGLAccounts}
                    placeholder="G/L Account"
                  />
                </div>
                <div className="im-field">
                  <label className="im-field__label">Telephone</label>
                  <input className="im-field__input" value={creditCardForm.Telephone} onChange={(e) => setCreditCardForm((prev) => ({ ...prev, Telephone: e.target.value }))} />
                </div>
                <div className="im-field">
                  <label className="im-field__label">Company ID</label>
                  <input className="im-field__input" value={creditCardForm.CompanyID} onChange={(e) => setCreditCardForm((prev) => ({ ...prev, CompanyID: e.target.value }))} />
                </div>
                <div className="im-field">
                  <label className="im-field__label">Country</label>
                  <input
                    className="im-field__input"
                    value={creditCardForm.CountryCode}
                    readOnly
                    placeholder="Not editable in SAP"
                    style={{ background: "#f0f2f5", color: "#555" }}
                  />
                </div>
              </div>
            </div>
            <div className="im-modal__footer">
              <button className="im-btn" onClick={() => setShowCreditCardSetup(false)}>Cancel</button>
              <button className="im-btn im-btn--primary" onClick={handleCreateCreditCard} disabled={creditCardSaving}>
                {creditCardSaving ? "Saving..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
