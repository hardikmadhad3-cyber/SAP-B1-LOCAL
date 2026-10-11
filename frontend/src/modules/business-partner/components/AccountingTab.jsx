import SapDateInput from '../../../components/common/SapDateInput';
import React, { useMemo, useState } from "react";
import LookupField from "../../item-master/components/LookupField";

const ACCOUNT_COLUMNS = [
  { label: "Code", key: "code" },
  { label: "Name", key: "name" },
];

const BP_COLUMNS = [
  { label: "Code", key: "code" },
  { label: "Name", key: "name" },
  { label: "Type", key: "type" },
];

const ASSESSEE_OPTIONS = [
  { value: "atCompany", label: "Company" },
  { value: "atOthers", label: "Others" },
];

const REMARK_OPTIONS = [
  { value: "", label: "" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
];

const TAX_INFO_FIELDS = [
  { key: "panNo", label: "P.A.N. No." },
  { key: "panCircleNo", label: "P.A.N. Circle No." },
  { key: "panWardNo", label: "P.A.N. Ward No." },
  { key: "panAssessingOfficer", label: "P.A.N. Assessing Officer" },
  { key: "deducteeRefNo", label: "Deductee Ref. No." },
  { key: "lstVatNo", label: "LST/VAT No." },
  { key: "cstNo", label: "CST No." },
  { key: "tanNo", label: "TAN No." },
  { key: "serviceTaxNo", label: "Service Tax No." },
  { key: "companyType", label: "Company Type" },
  { key: "natureOfBusiness", label: "Nature of Business" },
  { key: "tinNo", label: "TIN No." },
  { key: "itrFiling", label: "ITR Filing" },
];

const buildEmptyTaxInfo = () => ({
  panNo: "",
  panCircleNo: "",
  panWardNo: "",
  panAssessingOfficer: "",
  deducteeRefNo: "",
  lstVatNo: "",
  cstNo: "",
  tanNo: "",
  serviceTaxNo: "",
  companyType: "",
  natureOfBusiness: "",
  tinNo: "",
  itrFiling: "",
});

const getWithholdingSummary = (rows = [], defaultCode = "", defaultName = "") => {
  const codes = rows.map((row) => row.WTCode).filter(Boolean);
  if (codes.length === 0) return "No withholding codes selected";

  const base = codes.join(", ");
  if (!defaultCode) return base;

  const defaultLabel = defaultName ? `${defaultCode} - ${defaultName}` : defaultCode;
  return `${base} | Default: ${defaultLabel}`;
};

const hasAnyTaxInfoValue = (taxInfo = {}) =>
  Object.values(taxInfo).some((value) => String(value || "").trim() !== "");

const isYesValue = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["tyes", "boyes", "yes", "y", "true", "1"].includes(normalized);
};

const normalizeAssesseeType = (value) =>
  String(value || "").trim() === "atCompany" ? "atCompany" : "atOthers";

const isCodeCompatibleWithAssessee = (row, assesseeType) => {
  const rowType = row?.assesseeType || row?.AssesseeType;
  return !rowType || normalizeAssesseeType(rowType) === normalizeAssesseeType(assesseeType);
};

export default function AccountingTab({
  form,
  onChange,
  setForm,
  fetchGLAccounts,
  fetchBusinessPartners,
  fetchSuppliers,
  fetchWithholdingTaxCodes,
}) {
  const [activeTab, setActiveTab] = useState("general");
  const [taxInfoOpen, setTaxInfoOpen] = useState(false);
  const [taxInfoDraft, setTaxInfoDraft] = useState(form.TaxInfo || buildEmptyTaxInfo());
  const [withholdingModalOpen, setWithholdingModalOpen] = useState(false);
  const [withholdingRows, setWithholdingRows] = useState([]);
  const [withholdingLoading, setWithholdingLoading] = useState(false);
  const [selectedWithholdingCodes, setSelectedWithholdingCodes] = useState([]);
  const [defaultWithholdingCode, setDefaultWithholdingCode] = useState("");
  const [activeWithholdingCode, setActiveWithholdingCode] = useState("");
  const [withholdingMode, setWithholdingMode] = useState("cash");
  const currentAssesseeType = normalizeAssesseeType(form.TypeReport || "atCompany");

  const compatibleWithholdingRows = useMemo(
    () => withholdingRows.filter((row) => isCodeCompatibleWithAssessee(row, currentAssesseeType)),
    [withholdingRows, currentAssesseeType]
  );

  const handleLookupInputChange = (event, nameField) => {
    onChange(event);
    setForm((previous) => ({ ...previous, [nameField]: "" }));
  };

  const setLookupValue = (codeField, nameField, row) => {
    setForm((previous) => ({
      ...previous,
      [codeField]: row.code,
      [nameField]: row.name,
    }));
  };

  const openTaxInfoModal = () => {
    setTaxInfoDraft({ ...buildEmptyTaxInfo(), ...(form.TaxInfo || {}) });
    setTaxInfoOpen(true);
  };

  const saveTaxInfoModal = () => {
    setForm((previous) => ({
      ...previous,
      TaxInfo: { ...taxInfoDraft },
    }));
    setTaxInfoOpen(false);
  };

  const handleTaxInfoChange = (event) => {
    const { name, value } = event.target;
    setTaxInfoDraft((previous) => ({ ...previous, [name]: value }));
  };

  const openWithholdingModal = async () => {
    setWithholdingModalOpen(true);
    setWithholdingLoading(true);

    try {
      const rows = await fetchWithholdingTaxCodes("");
      const compatibleCodes = new Set(
        rows
          .filter((row) => isCodeCompatibleWithAssessee(row, currentAssesseeType))
          .map((row) => row.code)
      );
      const selectedCodes = (form.BPWithholdingTaxCollection || [])
        .map((row) => row.WTCode)
        .filter((code) => code && compatibleCodes.has(code));
      const initialDefault = compatibleCodes.has(form.WTCode)
        ? form.WTCode
        : selectedCodes[0] || "";

      setWithholdingRows(rows);
      setSelectedWithholdingCodes(selectedCodes);
      setDefaultWithholdingCode(initialDefault);
      setActiveWithholdingCode(initialDefault);
    } catch {
      setWithholdingRows([]);
      setSelectedWithholdingCodes([]);
      setDefaultWithholdingCode("");
      setActiveWithholdingCode("");
    } finally {
      setWithholdingLoading(false);
    }
  };

  const toggleWithholdingCode = (code) => {
    if (!compatibleWithholdingRows.some((row) => row.code === code)) return;

    setSelectedWithholdingCodes((previous) => {
      const next = previous.includes(code)
        ? previous.filter((item) => item !== code)
        : [...previous, code];

      if (defaultWithholdingCode === code && !next.includes(code)) {
        setDefaultWithholdingCode(next[0] || "");
      }

      return next;
    });
  };

  const setDefaultFromActiveRow = () => {
    if (!activeWithholdingCode || !compatibleWithholdingRows.some((row) => row.code === activeWithholdingCode)) {
      return;
    }

    setSelectedWithholdingCodes((previous) =>
      previous.includes(activeWithholdingCode)
        ? previous
        : [...previous, activeWithholdingCode]
    );
    setDefaultWithholdingCode(activeWithholdingCode);
  };

  const saveWithholdingCodes = () => {
    const compatibleCodes = new Set(compatibleWithholdingRows.map((row) => row.code));
    const compatibleSelectedCodes = selectedWithholdingCodes.filter((code) => compatibleCodes.has(code));
    const effectiveDefault = compatibleSelectedCodes.includes(defaultWithholdingCode)
      ? defaultWithholdingCode
      : compatibleSelectedCodes[0] || "";
    const defaultRow = withholdingRows.find((row) => row.code === effectiveDefault);

    setForm((previous) => ({
      ...previous,
      SubjectToWithholdingTax: compatibleSelectedCodes.length ? "boYES" : previous.SubjectToWithholdingTax,
      WTCode: effectiveDefault,
      WTCodeName: defaultRow?.name || "",
      WTTaxCategoryLabel: defaultRow?.taxCategory || "",
      BPWithholdingTaxCollection: compatibleSelectedCodes.map((code) => {
        const row = withholdingRows.find((item) => item.code === code);
        return {
          WTCode: code,
          WTCodeName: row?.name || "",
          AssesseeType: row?.assesseeType || "",
          WTTaxCategoryLabel: row?.taxCategory || "",
        };
      }),
    }));

    setWithholdingModalOpen(false);
  };

  const handleAssesseeTypeChange = (event) => {
    const nextType = normalizeAssesseeType(event.target.value);
    setForm((previous) => ({
      ...previous,
      TypeReport: nextType,
      WTCode: "",
      WTCodeName: "",
      WTTaxCategoryLabel: "",
      BPWithholdingTaxCollection: [],
    }));
  };

  const currentWithholdingSummary = useMemo(
    () =>
      getWithholdingSummary(
        form.BPWithholdingTaxCollection || [],
        form.WTCode || "",
        form.WTCodeName || ""
      ),
    [form.BPWithholdingTaxCollection, form.WTCode, form.WTCodeName]
  );

  const taxInfoSummary = useMemo(() => {
    if (!hasAnyTaxInfoValue(form.TaxInfo || {})) return "No tax information entered";
    const panLabel = form.TaxInfo?.panNo ? `PAN: ${form.TaxInfo.panNo}` : "Tax information entered";
    const tanLabel = form.TaxInfo?.tanNo ? ` | TAN: ${form.TaxInfo.tanNo}` : "";
    return `${panLabel}${tanLabel}`;
  }, [form.TaxInfo]);

  return (
    <div className="bp-accounting-layout">
      <div className="bp-accounting-subtabs">
        <button
          type="button"
          className={`bp-accounting-subtab${activeTab === "general" ? " bp-accounting-subtab--active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          General
        </button>
        <button
          type="button"
          className={`bp-accounting-subtab${activeTab === "tax" ? " bp-accounting-subtab--active" : ""}`}
          onClick={() => setActiveTab("tax")}
        >
          Tax
        </button>
      </div>

      {activeTab === "general" && (
        <div className="bp-accounting-panel">
          <div className="bp-accounting-section">
            <div className="bp-accounting-section-title">Consolidating Business Partner</div>
            <div className="bp-accounting-radio-row">
              <label className="im-checkbox-label">
                <input
                  type="radio"
                  name="ConsolidationType"
                  value="PaymentConsolidation"
                  checked={form.ConsolidationType !== "DeliveryConsolidation"}
                  onChange={() =>
                    setForm((previous) => ({ ...previous, ConsolidationType: "PaymentConsolidation" }))
                  }
                />
                <span>Payment Consolidation</span>
              </label>
              <label className="im-checkbox-label">
                <input
                  type="radio"
                  name="ConsolidationType"
                  value="DeliveryConsolidation"
                  checked={form.ConsolidationType === "DeliveryConsolidation"}
                  onChange={() =>
                    setForm((previous) => ({ ...previous, ConsolidationType: "DeliveryConsolidation" }))
                  }
                />
                <span>Delivery Consolidation</span>
              </label>
            </div>
            <div className="bp-accounting-field">
              <label className="bp-accounting-field__label">Consolidating BP</label>
              <LookupField
                name="ConsolidatingBP"
                value={form.ConsolidatingBP || ""}
                displayValue={form.ConsolidatingBPName || ""}
                onChange={(event) => handleLookupInputChange(event, "ConsolidatingBPName")}
                onSelect={(row) => setLookupValue("ConsolidatingBP", "ConsolidatingBPName", row)}
                fetchOptions={fetchBusinessPartners}
                columns={BP_COLUMNS}
                placeholder="Business Partners"
              />
            </div>
          </div>

          <div className="bp-accounting-section">
            <div className="bp-accounting-section-title">Control Accounts</div>
            <div className="bp-accounting-stack">
              <div className="bp-accounting-field">
                <label className="bp-accounting-field__label">Accounts Receivable</label>
                <LookupField
                  name="DebitorAccount"
                  value={form.DebitorAccount || ""}
                  displayValue={form.DebitorAccountName || ""}
                  onChange={(event) => handleLookupInputChange(event, "DebitorAccountName")}
                  onSelect={(row) => setLookupValue("DebitorAccount", "DebitorAccountName", row)}
                  fetchOptions={fetchGLAccounts}
                  columns={ACCOUNT_COLUMNS}
                  placeholder="Accounts Receivable"
                />
              </div>

              <div className="bp-accounting-field">
                <label className="bp-accounting-field__label">Down Payment Clearing Account</label>
                <LookupField
                  name="DownPaymentClearAct"
                  value={form.DownPaymentClearAct || ""}
                  displayValue={form.DownPaymentClearActName || ""}
                  onChange={(event) => handleLookupInputChange(event, "DownPaymentClearActName")}
                  onSelect={(row) => setLookupValue("DownPaymentClearAct", "DownPaymentClearActName", row)}
                  fetchOptions={fetchGLAccounts}
                  columns={ACCOUNT_COLUMNS}
                  placeholder="Down Payment Clearing Account"
                />
              </div>

              <div className="bp-accounting-field">
                <label className="bp-accounting-field__label">Down Payment Interim Account</label>
                <LookupField
                  name="DownPaymentInterimAccount"
                  value={form.DownPaymentInterimAccount || ""}
                  displayValue={form.DownPaymentInterimAccountName || ""}
                  onChange={(event) => handleLookupInputChange(event, "DownPaymentInterimAccountName")}
                  onSelect={(row) => setLookupValue("DownPaymentInterimAccount", "DownPaymentInterimAccountName", row)}
                  fetchOptions={fetchGLAccounts}
                  columns={ACCOUNT_COLUMNS}
                  placeholder="Down Payment Interim Account"
                />
              </div>
            </div>
          </div>

          <div className="bp-accounting-grid">
            <div className="bp-accounting-column">
              <label className="im-checkbox-label bp-accounting-flag">
                <input
                  type="checkbox"
                  name="BlockDunning"
                  checked={form.BlockDunning === "tYES"}
                  onChange={onChange}
                />
                <span>Block Dunning Letters</span>
              </label>

              <div className="bp-accounting-field">
                <label className="bp-accounting-field__label">Dunning Level</label>
                <input
                  className="im-field__input"
                  name="DunningLevel"
                  value={form.DunningLevel || ""}
                  onChange={onChange}
                  inputMode="numeric"
                />
              </div>

              <div className="bp-accounting-field">
                <label className="bp-accounting-field__label">Dunning Date</label>
                <SapDateInput
                  className="im-field__input"
                  
                  name="DunningDate"
                  value={form.DunningDate || ""}
                  onChange={onChange}
                />
              </div>

              <div className="bp-accounting-field">
                <label className="bp-accounting-field__label">Connected Vendor</label>
                <LookupField
                  name="LinkedBusinessPartner"
                  value={form.LinkedBusinessPartner || ""}
                  displayValue={form.LinkedBusinessPartnerName || ""}
                  onChange={(event) => handleLookupInputChange(event, "LinkedBusinessPartnerName")}
                  onSelect={(row) => setLookupValue("LinkedBusinessPartner", "LinkedBusinessPartnerName", row)}
                  fetchOptions={fetchSuppliers}
                  columns={BP_COLUMNS}
                  placeholder="Suppliers"
                />
              </div>

              <div className="bp-accounting-field">
                <label className="bp-accounting-field__label">Planning Group</label>
                <input
                  className="im-field__input"
                  name="PlanningGroup"
                  value={form.PlanningGroup || ""}
                  onChange={onChange}
                />
              </div>

              <label className="im-checkbox-label bp-accounting-flag">
                <input
                  type="checkbox"
                  name="UseShippedGoodsAccount"
                  checked={form.UseShippedGoodsAccount === "tYES"}
                  onChange={onChange}
                />
                <span>Use Shipped Goods Account</span>
              </label>

              <label className="im-checkbox-label bp-accounting-flag">
                <input
                  type="checkbox"
                  name="Affiliate"
                  checked={form.Affiliate === "tYES"}
                  onChange={onChange}
                />
                <span>Affiliate</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {activeTab === "tax" && (
        <div className="bp-accounting-panel bp-accounting-panel--tax">
          <div className="bp-accounting-tax-layout">
            <div className="bp-accounting-tax-left">
              <div className="bp-accounting-tax-inline">
                <label className="bp-accounting-field__label bp-accounting-field__label--tax-inline">
                  Tax Information
                </label>
                <button type="button" className="im-lookup-btn" onClick={openTaxInfoModal}>
                  ...
                </button>
              </div>
              <div className="bp-accounting-tax-summary">{taxInfoSummary}</div>

              <label className="im-checkbox-label bp-accounting-tax-checkbox">
                <input
                  type="checkbox"
                  checked={isYesValue(form.SubjectToWithholdingTax)}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      SubjectToWithholdingTax: event.target.checked ? "boYES" : "boNO",
                    }))
                  }
                />
                <span>Subject to Withholding Tax</span>
              </label>

              <div className="bp-accounting-tax-inline bp-accounting-tax-inline--withholding">
                <label className="bp-accounting-field__label bp-accounting-field__label--tax-inline">
                  WTax Codes Allowed
                </label>
                <button type="button" className="im-lookup-btn" onClick={openWithholdingModal}>
                  ...
                </button>
              </div>
              <div className="bp-accounting-tax-summary">{currentWithholdingSummary}</div>

              <div className="bp-accounting-tax-radio-group">
                <label className="im-checkbox-label">
                  <input
                    type="radio"
                    name="WithholdingMode"
                    value="accrual"
                    checked={withholdingMode === "accrual"}
                    onChange={() => setWithholdingMode("accrual")}
                  />
                  <span>Accrual</span>
                </label>
                <label className="im-checkbox-label">
                  <input
                    type="radio"
                    name="WithholdingMode"
                    value="cash"
                    checked={withholdingMode === "cash"}
                    onChange={() => setWithholdingMode("cash")}
                  />
                  <span>Cash</span>
                </label>
              </div>

              <label className="im-checkbox-label bp-accounting-tax-checkbox">
                <input
                  type="checkbox"
                  name="ThresholdOverlook"
                  checked={form.ThresholdOverlook === "tYES"}
                  onChange={onChange}
                />
                <span>Threshold Overlook</span>
              </label>

              <div className="bp-accounting-field bp-accounting-field--tax-eori">
                <label className="bp-accounting-field__label">EORI Number</label>
                <input
                  className="im-field__input"
                  name="EORINumber"
                  value={form.EORINumber || ""}
                  onChange={onChange}
                />
              </div>
            </div>

            <div className="bp-accounting-tax-right">
              <div className="bp-accounting-field bp-accounting-field--short">
                <label className="bp-accounting-field__label">Certificate No.</label>
                <input
                  className="im-field__input"
                  name="CertificateNumber"
                  value={form.CertificateNumber || ""}
                  onChange={onChange}
                />
              </div>

              <div className="bp-accounting-field bp-accounting-field--short">
                <label className="bp-accounting-field__label">Expiration Date</label>
                <SapDateInput
                  className="im-field__input"
                  
                  name="ExpirationDate"
                  value={form.ExpirationDate || ""}
                  onChange={onChange}
                />
              </div>

              <div className="bp-accounting-field bp-accounting-field--short">
                <label className="bp-accounting-field__label">NI Number</label>
                <input
                  className="im-field__input"
                  name="NationalInsuranceNum"
                  value={form.NationalInsuranceNum || ""}
                  onChange={onChange}
                />
              </div>

              <div className="bp-accounting-field bp-accounting-field--short bp-accounting-field--spacer">
                <label className="bp-accounting-field__label">Assessee Type</label>
                <select
                  className="im-field__select"
                  name="TypeReport"
                  value={form.TypeReport || "atCompany"}
                  onChange={handleAssesseeTypeChange}
                >
                  {ASSESSEE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bp-accounting-field bp-accounting-field--short">
                <label className="bp-accounting-field__label">WT Tax Category</label>
                <input className="im-field__input" value={form.WTTaxCategoryLabel || ""} readOnly />
              </div>

              <label className="im-checkbox-label bp-accounting-tax-checkbox bp-accounting-tax-checkbox--right">
                <input
                  type="checkbox"
                  name="SurchargeOverlook"
                  checked={form.SurchargeOverlook === "tYES"}
                  onChange={onChange}
                />
                <span>Surcharge Overlook</span>
              </label>

              <div className="bp-accounting-field bp-accounting-field--short bp-accounting-field--spacer">
                <label className="bp-accounting-field__label">Remark 1</label>
                <select
                  className="im-field__select"
                  name="Remark1"
                  value={form.Remark1 || ""}
                  onChange={onChange}
                >
                  {REMARK_OPTIONS.map((option) => (
                    <option key={option.value || "blank"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bp-accounting-field bp-accounting-field--short">
                <label className="bp-accounting-field__label">Certificate No. for 26Q</label>
                <input
                  className="im-field__input"
                  name="CertificateDetails"
                  value={form.CertificateDetails || ""}
                  onChange={onChange}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {taxInfoOpen && (
        <div className="im-modal-overlay" onClick={() => setTaxInfoOpen(false)}>
          <div
            className="im-modal bp-sap-modal bp-accounting-tax-info-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="im-modal__header">
              <span>Tax Information</span>
              <button className="im-modal__close" onClick={() => setTaxInfoOpen(false)}>
                X
              </button>
            </div>
            <div className="im-modal__body">
              <div className="bp-accounting-tax-info-form">
                {TAX_INFO_FIELDS.map((field) => (
                  <div key={field.key} className="bp-accounting-tax-info-row">
                    <label className="bp-accounting-tax-info-row__label">{field.label}</label>
                    <input
                      className="im-field__input"
                      name={field.key}
                      value={taxInfoDraft[field.key] || ""}
                      onChange={handleTaxInfoChange}
                    />
                  </div>
                ))}
                <div className="bp-accounting-tax-info-row">
                  <label className="bp-accounting-tax-info-row__label">Assessee Type</label>
                  <select
                    className="im-field__select"
                    name="TypeReport"
                    value={form.TypeReport || "atCompany"}
                    onChange={handleAssesseeTypeChange}
                  >
                    {ASSESSEE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="im-modal__footer">
              <button type="button" className="im-btn im-btn--primary" onClick={saveTaxInfoModal}>
                OK
              </button>
              <button type="button" className="im-btn" onClick={() => setTaxInfoOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {withholdingModalOpen && (
        <div className="im-modal-overlay" onClick={() => setWithholdingModalOpen(false)}>
          <div
            className="im-modal bp-sap-modal bp-accounting-withholding-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="im-modal__header">
              <span>WTax Codes Allowed</span>
              <button className="im-modal__close" onClick={() => setWithholdingModalOpen(false)}>
                X
              </button>
            </div>
            <div className="im-modal__body">
              {withholdingLoading ? (
                <div className="im-modal__empty">Loading...</div>
              ) : (
                <div className="bp-sap-grid-wrap">
                  <table className="bp-sap-grid bp-accounting-withholding-grid">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th style={{ width: 110 }}>Code</th>
                        <th>Description</th>
                        <th style={{ width: 80 }}>Choose</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compatibleWithholdingRows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="im-modal__empty">
                            No withholding tax codes match the selected assessee type.
                          </td>
                        </tr>
                      ) : (
                        compatibleWithholdingRows.map((row, index) => {
                          const isSelected = selectedWithholdingCodes.includes(row.code);
                          const isDefault = defaultWithholdingCode === row.code;

                          return (
                            <tr
                              key={row.code}
                              className={activeWithholdingCode === row.code ? "bp-sap-grid__row--selected" : ""}
                              onClick={() => setActiveWithholdingCode(row.code)}
                            >
                              <td>{index + 1}</td>
                              <td>{isDefault ? `${row.code} *` : row.code}</td>
                              <td>{row.name}</td>
                              <td style={{ textAlign: "center" }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleWithholdingCode(row.code)}
                                />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="bp-accounting-tax-default-note">
                {defaultWithholdingCode ? `Default code: ${defaultWithholdingCode}` : "No default code selected"}
              </div>
            </div>
            <div className="im-modal__footer">
              <button type="button" className="im-btn im-btn--primary" onClick={saveWithholdingCodes}>
                OK
              </button>
              <button type="button" className="im-btn" onClick={() => setWithholdingModalOpen(false)}>
                Cancel
              </button>
              <button type="button" className="im-btn" onClick={setDefaultFromActiveRow} disabled={!activeWithholdingCode}>
                Set as Default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
