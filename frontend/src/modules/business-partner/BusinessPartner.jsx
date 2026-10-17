import React, { useState, useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../item-master/styles/itemMaster.css";
import "./styles/businessPartner.css";
import GeneralTab    from "./components/GeneralTab";
import PaymentTab    from "./components/PaymentTab";
import PaymentRunTab from "./components/PaymentRunTab";
import AccountingTab from "./components/AccountingTab";
import AddressTab    from "./components/AddressTab";
import ContactTab    from "./components/ContactTab";
import PropertiesTab from "./components/PropertiesTab";
import RemarksTab    from "./components/RemarksTab";
import { findUnnamedRow } from "./unnamedRows";
import {
  createBP, getBP, updateBP, searchBP,
  fetchBPGroups, fetchBPPriceLists, fetchPaymentTerms, fetchCurrencies, fetchBPCountries,
  fetchBPCompanyTypes,
  fetchSalesPersons, fetchNumberingSeries, getNextSeriesNumber,
  fetchBPCreditCards, createBPCreditCard, fetchBPBanks, fetchBPHouseBankAccounts, fetchBPWithholdingTaxCodes,
} from "../../api/businessPartnerApi";
import { searchShippingTypes } from "../../api/shippingTypeApi";
import { searchAccounts }      from "../../api/chartOfAccountsApi";
import { isRouteStateForActiveCompany } from "../../utils/companyStorageScope";
import { replaceRouteStatePreservingWindow } from "../../utils/copyToState";

const TABS  = ["General", "Contact Persons", "Addresses", "Payment Terms", "Payment Run", "Accounting", "Properties", "Remarks"];
const MODES = { ADD: "add", FIND: "find", UPDATE: "update" };
const DEFAULT_COMPANY_TYPE_OPTIONS = [
  { code: "cCompany", name: "Company" },
  { code: "cPrivate", name: "Private" },
];

const buildInitialProps = () => {
  const p = {};
  for (let i = 1; i <= 64; i++) p[`Properties${i}`] = "tNO";
  return p;
};

const normalizeDateInput = (value) => {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const normalizeConsolidationType = (value) =>
  value === "cDelivery_sum" ? "DeliveryConsolidation" : "PaymentConsolidation";

const normalizeWithholdingFlag = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["bonone", "bononeenum", "none", ""].includes(normalized)) return "boNONE";
  return ["tyes", "boyes", "yes", "y", "true", "1"].includes(normalized) ? "boYES" : "boNO";
};

const normalizeGenderValue = (value) => {
  if (value === "gt_NotSpecified") return "gt_Undefined";
  return value || "gt_Undefined";
};

const safeText = (value) => String(value ?? "");
const safeTrim = (value) => safeText(value).trim();

const getContactPersonName = (contact) => String(contact?.Name || "").trim();
const getDefaultContactPersonName = (contacts = []) => {
  const namedContacts = (contacts || []).filter((contact) => getContactPersonName(contact));
  const defaultContact = namedContacts.find((contact) => contact?.IsDefault === "tYES");
  return getContactPersonName(defaultContact || namedContacts[0]);
};

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

const hasTaxInfoValues = (taxInfo = buildEmptyTaxInfo()) =>
  Object.values(taxInfo).some((value) => String(value || "").trim() !== "");

const getPrimaryFiscalTaxRow = (rows = []) =>
  rows.find((row) => row?.Address === "" && row?.AddrType === "bo_ShipTo")
  || rows.find((row) => row?.AddrType === "bo_ShipTo")
  || rows[0]
  || null;

const deriveTaxInfoFromFiscalRows = (rows = []) => {
  const row = getPrimaryFiscalTaxRow(rows);
  if (!row) return buildEmptyTaxInfo();

  return {
    panNo: row.TaxId0 || "",
    panCircleNo: row.TaxId5 || "",
    panWardNo: row.TaxId6 || "",
    panAssessingOfficer: row.TaxId7 || "",
    deducteeRefNo: row.TaxId8 || "",
    lstVatNo: row.TaxId1 || "",
    cstNo: row.TaxId2 || "",
    tanNo: row.TaxId3 || "",
    serviceTaxNo: row.TaxId4 || "",
    companyType: row.TaxId9 || "",
    natureOfBusiness: row.TaxId10 || "",
    tinNo: row.TaxId11 || "",
    itrFiling: row.TaxId12 || "",
  };
};

const mergeTaxInfoIntoFiscalRows = (rows = [], taxInfo = buildEmptyTaxInfo()) => {
  if ((!rows || rows.length === 0) && !hasTaxInfoValues(taxInfo)) {
    return [];
  }

  const nextRows = (rows || []).map((row) => ({ ...row }));
  const targetIndex = nextRows.findIndex((row) => row?.Address === "" && row?.AddrType === "bo_ShipTo");
  const rowIndex = targetIndex >= 0 ? targetIndex : (nextRows.findIndex((row) => row?.AddrType === "bo_ShipTo") >= 0
    ? nextRows.findIndex((row) => row?.AddrType === "bo_ShipTo")
    : 0);

  if (nextRows.length === 0) {
    nextRows.push({
      Address: "",
      AddrType: "bo_ShipTo",
      AToRetrNFe: "tNO",
    });
  }

  const targetRow = {
    ...nextRows[rowIndex] || {},
    Address: nextRows[rowIndex]?.Address || "",
    AddrType: nextRows[rowIndex]?.AddrType || "bo_ShipTo",
    AToRetrNFe: nextRows[rowIndex]?.AToRetrNFe || "tNO",
    TaxId0: taxInfo.panNo || null,
    TaxId1: taxInfo.lstVatNo || null,
    TaxId2: taxInfo.cstNo || null,
    TaxId3: taxInfo.tanNo || null,
    TaxId4: taxInfo.serviceTaxNo || null,
    TaxId5: taxInfo.panCircleNo || null,
    TaxId6: taxInfo.panWardNo || null,
    TaxId7: taxInfo.panAssessingOfficer || null,
    TaxId8: taxInfo.deducteeRefNo || null,
    TaxId9: taxInfo.companyType || null,
    TaxId10: taxInfo.natureOfBusiness || null,
    TaxId11: taxInfo.tinNo || null,
    TaxId12: taxInfo.itrFiling || null,
  };

  nextRows[rowIndex] = targetRow;
  return nextRows;
};

const normalizeBP = (data) => {
  const d = { ...data };
  d.CardCode = safeText(d.CardCode);
  d.CardName = safeText(d.CardName);
  d.CardForeignName = safeText(d.CardForeignName);
  const bools = ["Valid","Frozen","BlockSendingMarketingContent","PartialDelivery","BackOrder",
    "SinglePayment","EndorsableChecksFromBP","AcceptsEndorsedChecks","PaymentBlock",
    "CollectionAuthorization","Affiliate","UseBillToAddrToDetermineTax",
    "BlockDunning","EffectivePriceConsidersPriceBeforeDiscount","NoDiscounts"];
  bools.forEach((f) => {
    if (d[f] === true  || d[f] === "Y") d[f] = "tYES";
    if (d[f] === false || d[f] === "N") d[f] = "tNO";
  });
  if (!["apNo","apInterestAndFee","apInterestOnly","apFeeOnly"].includes(d.AutomaticPosting))
    d.AutomaticPosting = "apNo";
  if (!d.BPAddresses)      d.BPAddresses      = [];
  if (!d.ContactEmployees) d.ContactEmployees = [];
  if (!d.BPPaymentDates)   d.BPPaymentDates   = [];
  if (!d.BPBankAccounts)   d.BPBankAccounts   = [];
  if (!d.BPWithholdingTaxCollection) d.BPWithholdingTaxCollection = [];
  if (!d.BPFiscalTaxIDCollection) d.BPFiscalTaxIDCollection = [];
  d.BPWithholdingTaxCollection = d.BPWithholdingTaxCollection.map((row) => ({
    ...row,
    WTCode: row.WTCode || "",
    WTCodeName: row.WTCodeName || row.name || "",
    AssesseeType: row.AssesseeType || row.assesseeType || "",
    AssesseeTypeLabel: row.AssesseeTypeLabel || row.assesseeTypeLabel || "",
    WTTaxCategoryLabel: row.WTTaxCategoryLabel || row.taxCategory || "",
  }));
  d.ContactEmployees = d.ContactEmployees.map((contact) => ({
    ...contact,
    Address: contact.Address || contact.Department || "",
    PlaceOfBirth: contact.PlaceOfBirth || "",
    Gender: normalizeGenderValue(contact.Gender),
  }));
  d.BPBankAccounts = d.BPBankAccounts.map((row, index) => ({
    ...row,
    BankName: row.BankName || (index === 0 ? d.PaymentBankName || "" : ""),
    CountryName: row.CountryName || (index === 0 ? d.PaymentBankCountryName || row.Country || "" : row.Country || ""),
  }));
  const firstBank = d.BPBankAccounts[0] || null;
  d.CreditCardCode = d.CreditCardCode == null || Number(d.CreditCardCode) < 0 ? "" : String(d.CreditCardCode);
  d.Priority = d.Priority == null || Number(d.Priority) < 0 ? "" : String(d.Priority);
  d.PayTermsGrpCode = d.PayTermsGrpCode == null || d.PayTermsGrpCode === "" ? "" : String(d.PayTermsGrpCode);
  d.PriceListNum = d.PriceListNum == null || d.PriceListNum === "" ? "" : String(d.PriceListNum);
  d.CreditCardExpiration = normalizeDateInput(d.CreditCardExpiration);
  d.ConsolidatingBP = d.ConsolidatingBP || d.FatherCard || "";
  d.ConsolidatingBPName = d.ConsolidatingBPName || d.FatherCardName || "";
  d.LinkedBusinessPartner = d.LinkedBusinessPartner || "";
  d.LinkedBusinessPartnerName = d.LinkedBusinessPartnerName || "";
  d.ConsolidationType = normalizeConsolidationType(d.FatherType);
  d.DunningLevel = d.DunningLevel == null || d.DunningLevel === "" ? "" : String(d.DunningLevel);
  d.DunningDate = normalizeDateInput(d.DunningDate);
  d.SubjectToWithholdingTax = normalizeWithholdingFlag(d.SubjectToWithholdingTax);
  d.WTCode = d.WTCode || "";
  d.WTCodeName = d.WTCodeName || "";
  d.WTTaxCategoryLabel = d.WTTaxCategoryLabel || "";
  d.CertificateNumber = d.CertificateNumber || "";
  d.ExpirationDate = normalizeDateInput(d.ExpirationDate);
  d.NationalInsuranceNum = d.NationalInsuranceNum || "";
  d.TypeReport = d.TypeReport || "atCompany";
  d.ThresholdOverlook = d.ThresholdOverlook || "tNO";
  d.SurchargeOverlook = d.SurchargeOverlook || "tNO";
  d.Remark1 = d.Remark1 == null || d.Remark1 === "" ? "" : String(d.Remark1);
  d.CertificateDetails = d.CertificateDetails || "";
  d.TaxInfo = deriveTaxInfoFromFiscalRows(d.BPFiscalTaxIDCollection);
  d.UseShippedGoodsAccount = d.UseShippedGoodsAccount || "tNO";
  d.EORINumber = d.EORINumber || "";
  d.HouseBankCountry = d.HouseBankCountry || "";
  d.HouseBank = d.HouseBank || "";
  d.HouseBankAccount = d.HouseBankAccount || "";
  d.HouseBankBranch = d.HouseBankBranch || "";
  d.HouseBankIBAN = d.HouseBankIBAN || "";
  d.HouseBankSwift = d.HouseBankSwift || "";
  d.HouseBankControlKey = d.HouseBankControlKey || "";
  d.PaymentBankCode = firstBank?.BankCode || "";
  d.PaymentBankName = d.PaymentBankName || firstBank?.BankName || firstBank?.BankCode || "";
  d.PaymentBankCountryCode = firstBank?.Country || d.BankCountry || "";
  d.PaymentBankCountryName = d.PaymentBankCountryName || firstBank?.CountryName || d.PaymentBankCountryCode || "";
  d.PaymentBankAccountNo = firstBank?.AccountNo || "";
  d.PaymentBankBranch = firstBank?.Branch || "";
  d.PaymentBankControlKey = firstBank?.ControlKey || "";
  d.PaymentBankIBAN = firstBank?.IBAN || "";
  d.PaymentBankBICSwiftCode = firstBank?.BICSwiftCode || "";
  d.PaymentBankAccountName = firstBank?.AccountName || "";
  d.PaymentBankCustomerIdNumber = firstBank?.CustomerIdNumber || "";
  d.PaymentBankMandateID = firstBank?.MandateID || "";
  d.PaymentBankSignatureDate = normalizeDateInput(firstBank?.SignatureDate);
  d.PaymentBankInternalKey = firstBank?.InternalKey ?? "";
  d.PaymentBankSelectedIndex = d.BPBankAccounts.length > 0 ? 0 : -1;
  d.IBAN = d.IBAN || "";
  d.DefaultBankCode =
    d.DefaultBankCode == null || d.DefaultBankCode === "-1"
      ? (firstBank?.BankCode || "")
      : String(d.DefaultBankCode);
  for (let i = 1; i <= 64; i++) {
    const k = `Properties${i}`;
    if (d[k] === true || d[k] === "Y") d[k] = "tYES";
    else if (!d[k] || d[k] === false || d[k] === "N") d[k] = "tNO";
  }
  return d;
};

const EMPTY_FORM = {
  Series: "", CardCode: "", CardType: "cCustomer",
  CardName: "", CardForeignName: "",
  GroupCode: "", GroupName: "",
  Currency: "", CurrencyName: "Local Currency",
  // General
  Phone1: "", Phone2: "", Cellular: "", Fax: "",
  EmailAddress: "", Website: "",
  ShippingType: "", ShippingTypeName: "",
  SalesPersonCode: "", SalesEmployeeName: "",
  PeymentMethodCode: "", ProjectCode: "", Indicator: "",
  CompanyPrivate: "cCompany",
  ContactPerson: "", FreeText: "",
  ChannelBP: "", Territory: "", LanguageCode: "",
  GTSRegNo: "", BlockSendingMarketingContent: "tNO",
  ECommerceMerchantID: "", UseBillToAddrToDetermineTax: "tNO",
  AliasName: "", BranchAssignment: "Active",
  Valid: "tYES", ValidFrom: "", ValidTo: "",
  Frozen: "tNO", FrozenFrom: "", FrozenTo: "",
  BilltoDefault: "", ShipToDefault: "",
  // Payment Terms
  PayTermsGrpCode: "", PayTermsName: "",
  IntrestRatePercent: "", PriceListNum: "", PriceListName: "",
  DiscountPercent: "", CreditLimit: "", MaxCommitment: "",
  DunningTerm: "", AutomaticPosting: "apNo",
  EffectiveDiscount: "dgrLowestDiscount", EffectivePrice: "epDefaultPriority",
  EffectivePriceConsidersPriceBeforeDiscount: "tNO",
  CreditCardCode: "", CreditCardName: "", CreditCardNum: "", CreditCardExpiration: "",
  AvarageLate: "", Priority: "",
  BlockDunning: "tNO", IBAN: "", BankCountry: "", DefaultBankCode: "",
  PaymentBankCode: "", PaymentBankName: "", PaymentBankCountryCode: "", PaymentBankCountryName: "",
  PaymentBankAccountNo: "", PaymentBankBranch: "", PaymentBankControlKey: "",
  PaymentBankIBAN: "", PaymentBankBICSwiftCode: "", PaymentBankAccountName: "",
  PaymentBankCustomerIdNumber: "", PaymentBankMandateID: "", PaymentBankSignatureDate: "",
  PaymentBankInternalKey: "", PaymentBankSelectedIndex: -1, NoDiscounts: "tNO",
  PartialDelivery: "tNO", BackOrder: "tNO", SinglePayment: "tNO",
  EndorsableChecksFromBP: "tYES", AcceptsEndorsedChecks: "tNO",
  // Payment Run
  HouseBankCountry: "", HouseBank: "", HouseBankAccount: "",
  HouseBankBranch: "", HouseBankIBAN: "", HouseBankSwift: "", HouseBankControlKey: "",
  PaymentBlock: "tNO", CollectionAuthorization: "tNO", BankChargesAllocationCode: "",
  BPPaymentMethods: [], BPPaymentDates: [], BPBankAccounts: [],
  // Accounting
  ConsolidationType: "PaymentConsolidation", ConsolidatingBP: "", ConsolidatingBPName: "",
  LinkedBusinessPartner: "", LinkedBusinessPartnerName: "",
  DebitorAccount: "", DebitorAccountName: "",
  DownPaymentClearAct: "", DownPaymentClearActName: "",
  DownPaymentInterimAccount: "", DownPaymentInterimAccountName: "",
  PlanningGroup: "", DunningLevel: "", DunningDate: "",
  SubjectToWithholdingTax: "boNO", WTCode: "", WTCodeName: "", WTTaxCategoryLabel: "",
  CertificateNumber: "", ExpirationDate: "", NationalInsuranceNum: "",
  TypeReport: "atCompany", ThresholdOverlook: "tNO", SurchargeOverlook: "tNO",
  Remark1: "", CertificateDetails: "", UseShippedGoodsAccount: "tNO",
  EORINumber: "", Affiliate: "tNO", TaxInfo: buildEmptyTaxInfo(),
  BPWithholdingTaxCollection: [], BPFiscalTaxIDCollection: [],
  // Remarks
  Notes: "",
  // Arrays
  BPAddresses: [], ContactEmployees: [],
  ...buildInitialProps(),
};

function buildPayload(form) {
  const opt = (v) => v !== "" && v != null;
  const num = (v) => (v !== "" && v != null && !isNaN(v) ? Number(v) : undefined);
  const isManualSeries = !form.Series || form.Series === "0" || form.Series === "";
  const p = {};

  p.CardCode = safeText(form.CardCode);
  p.CardName = safeText(form.CardName);
  p.CardType = form.CardType || "cCustomer";

  if (!isManualSeries && opt(form.Series)) { const v = num(form.Series); if (v != null) p.Series = v; }
  if (opt(form.CardForeignName)) p.CardForeignName = form.CardForeignName;
  if (opt(form.GroupCode))      { const v = num(form.GroupCode); if (v != null) p.GroupCode = v; }
  if (opt(form.Currency))        p.Currency = form.Currency;

  if (opt(form.Phone1))          p.Phone1 = form.Phone1;
  if (opt(form.Phone2))          p.Phone2 = form.Phone2;
  if (opt(form.Cellular))        p.Cellular = form.Cellular;
  if (opt(form.Fax))             p.Fax = form.Fax;
  if (opt(form.EmailAddress))    p.EmailAddress = form.EmailAddress;
  if (opt(form.Website))         p.Website = form.Website;
  if (opt(form.ShippingType))   { const v = num(form.ShippingType); if (v != null) p.ShippingType = v; }
  if (opt(form.SalesPersonCode)){ const v = num(form.SalesPersonCode); if (v != null) p.SalesPersonCode = v; }
  if (opt(form.PeymentMethodCode)) p.PeymentMethodCode = form.PeymentMethodCode;
  if (opt(form.ProjectCode))     p.ProjectCode = form.ProjectCode;
  if (opt(form.Indicator))       p.Indicator = form.Indicator;
  p.CompanyPrivate = form.CompanyPrivate || "cCompany";
  if (opt(form.ContactPerson))   p.ContactPerson = form.ContactPerson;
  if (opt(form.FreeText))        p.FreeText = form.FreeText;
  if (opt(form.ChannelBP))       p.ChannelBP = form.ChannelBP;
  if (opt(form.Territory))      { const v = num(form.Territory); if (v != null) p.Territory = v; }
  if (opt(form.LanguageCode))   { const v = num(form.LanguageCode); if (v != null) p.LanguageCode = v; }
  if (opt(form.GTSRegNo))        p.GTSRegNo = form.GTSRegNo;
  p.BlockSendingMarketingContent = form.BlockSendingMarketingContent || "tNO";
  if (opt(form.ECommerceMerchantID)) p.ECommerceMerchantID = form.ECommerceMerchantID;
  p.UseBillToAddrToDetermineTax = form.UseBillToAddrToDetermineTax || "tNO";
  if (opt(form.AliasName))       p.AliasName = form.AliasName;
  if (opt(form.BilltoDefault))   p.BilltoDefault = form.BilltoDefault;
  if (opt(form.ShipToDefault))   p.ShipToDefault = form.ShipToDefault;
  p.Valid  = form.Valid  || "tYES";
  if (opt(form.ValidFrom))       p.ValidFrom = form.ValidFrom;
  if (opt(form.ValidTo))         p.ValidTo   = form.ValidTo;
  p.Frozen = form.Frozen || "tNO";
  if (opt(form.FrozenFrom))      p.FrozenFrom = form.FrozenFrom;
  if (opt(form.FrozenTo))        p.FrozenTo   = form.FrozenTo;

  if (opt(form.PayTermsGrpCode)){ const v = num(form.PayTermsGrpCode); if (v != null) p.PayTermsGrpCode = v; }
  if (num(form.IntrestRatePercent) != null) p.IntrestRatePercent = num(form.IntrestRatePercent);
  if (opt(form.PriceListNum))   { const v = num(form.PriceListNum); if (v != null) p.PriceListNum = v; }
  if (num(form.DiscountPercent) != null) p.DiscountPercent = num(form.DiscountPercent);
  if (num(form.CreditLimit)     != null) p.CreditLimit     = num(form.CreditLimit);
  if (num(form.MaxCommitment)   != null) p.MaxCommitment   = num(form.MaxCommitment);
  if (opt(form.DunningTerm))     p.DunningTerm = form.DunningTerm;
  p.AutomaticPosting = form.AutomaticPosting || "apNo";
  if (opt(form.EffectiveDiscount)) p.EffectiveDiscount = form.EffectiveDiscount;
  if (opt(form.EffectivePrice))    p.EffectivePrice    = form.EffectivePrice;
  p.EffectivePriceConsidersPriceBeforeDiscount = form.EffectivePriceConsidersPriceBeforeDiscount || "tNO";
  if (opt(form.CreditCardCode)) { const v = num(form.CreditCardCode); if (v != null) p.CreditCardCode = v; }
  if (opt(form.CreditCardNum))   p.CreditCardNum = form.CreditCardNum;
  if (opt(form.CreditCardExpiration)) p.CreditCardExpiration = form.CreditCardExpiration;
  if (opt(form.Priority))       { const v = num(form.Priority); if (v != null) p.Priority = v; }
  if (opt(form.IBAN))            p.IBAN = form.IBAN;
  if (opt(form.PaymentBankCountryCode || form.BankCountry)) p.BankCountry = form.PaymentBankCountryCode || form.BankCountry;
  if (opt(form.DefaultBankCode || form.PaymentBankCode)) p.DefaultBankCode = form.DefaultBankCode || form.PaymentBankCode;
  p.BlockDunning           = form.BlockDunning           || "tNO";
  p.NoDiscounts            = form.NoDiscounts            || "tNO";
  p.PartialDelivery        = form.PartialDelivery        || "tNO";
  p.BackOrder              = form.BackOrder              || "tNO";
  p.SinglePayment          = form.SinglePayment          || "tNO";
  p.EndorsableChecksFromBP = form.EndorsableChecksFromBP || "tNO";
  p.AcceptsEndorsedChecks  = form.AcceptsEndorsedChecks  || "tNO";

  if (opt(form.HouseBankCountry))       p.HouseBankCountry       = form.HouseBankCountry;
  if (opt(form.HouseBank))              p.HouseBank              = form.HouseBank;
  if (opt(form.HouseBankAccount))       p.HouseBankAccount       = form.HouseBankAccount;
  if (opt(form.HouseBankBranch))        p.HouseBankBranch        = form.HouseBankBranch;
  if (opt(form.HouseBankIBAN))          p.HouseBankIBAN          = form.HouseBankIBAN;
  if (opt(form.HouseBankSwift))         p.HouseBankSwift         = form.HouseBankSwift;
  if (opt(form.HouseBankControlKey))    p.HouseBankControlKey    = form.HouseBankControlKey;
  p.PaymentBlock           = form.PaymentBlock           || "tNO";
  p.CollectionAuthorization= form.CollectionAuthorization|| "tNO";
  if (opt(form.BankChargesAllocationCode)) p.BankChargesAllocationCode = form.BankChargesAllocationCode;

  p.FatherType = form.ConsolidationType === "DeliveryConsolidation" ? "cDelivery_sum" : "cPayments_sum";
  p.FatherCard = opt(form.ConsolidatingBP) ? form.ConsolidatingBP : null;
  p.LinkedBusinessPartner = opt(form.LinkedBusinessPartner) ? form.LinkedBusinessPartner : null;
  if (opt(form.DebitorAccount))          p.DebitorAccount          = form.DebitorAccount;
  if (opt(form.DownPaymentClearAct))     p.DownPaymentClearAct     = form.DownPaymentClearAct;
  if (opt(form.DownPaymentInterimAccount)) p.DownPaymentInterimAccount = form.DownPaymentInterimAccount;
  if (opt(form.PlanningGroup))           p.PlanningGroup           = form.PlanningGroup;
  if (opt(form.DunningLevel) && !Number.isNaN(Number(form.DunningLevel))) p.DunningLevel = Number(form.DunningLevel);
  else if (form.DunningLevel === "") p.DunningLevel = null;
  if (opt(form.DunningDate)) p.DunningDate = form.DunningDate;
  else if (form.DunningDate === "") p.DunningDate = null;
  p.SubjectToWithholdingTax = normalizeWithholdingFlag(form.SubjectToWithholdingTax);
  p.WTCode = opt(form.WTCode) ? form.WTCode : null;
  if (opt(form.CertificateNumber)) p.CertificateNumber = form.CertificateNumber;
  else if (form.CertificateNumber === "") p.CertificateNumber = null;
  if (opt(form.ExpirationDate)) p.ExpirationDate = form.ExpirationDate;
  else if (form.ExpirationDate === "") p.ExpirationDate = null;
  if (opt(form.NationalInsuranceNum)) p.NationalInsuranceNum = form.NationalInsuranceNum;
  else if (form.NationalInsuranceNum === "") p.NationalInsuranceNum = null;
  p.TypeReport = form.TypeReport || "atCompany";
  p.ThresholdOverlook = form.ThresholdOverlook || "tNO";
  p.SurchargeOverlook = form.SurchargeOverlook || "tNO";
  if (opt(form.Remark1) && !Number.isNaN(Number(form.Remark1))) p.Remark1 = Number(form.Remark1);
  else if (form.Remark1 === "") p.Remark1 = null;
  if (opt(form.CertificateDetails)) p.CertificateDetails = form.CertificateDetails;
  else if (form.CertificateDetails === "") p.CertificateDetails = null;
  p.UseShippedGoodsAccount = form.UseShippedGoodsAccount || "tNO";
  if (opt(form.EORINumber)) p.EORINumber = form.EORINumber;
  else if (form.EORINumber === "") p.EORINumber = null;
  p.Affiliate = form.Affiliate || "tNO";
  if (opt(form.Notes)) p.Notes = form.Notes;

  for (let i = 1; i <= 64; i++) {
    if (form[`Properties${i}`] === "tYES") p[`Properties${i}`] = "tYES";
  }

  if (form.BPAddresses?.length > 0) {
    p.BPAddresses = form.BPAddresses
      .filter((a) => a.AddressName && a.AddressName !== "Define New")
      .map((a) => ({
        AddressName: a.AddressName, AddressType: a.AddressType || "bo_BillTo",
        AddressName2: a.AddressName2, AddressName3: a.AddressName3,
        Street: a.Street, StreetNo: a.StreetNo, Block: a.Block,
        BuildingFloorRoom: a.BuildingFloorRoom, City: a.City,
        ZipCode: a.ZipCode, County: a.County, Country: a.Country, State: a.State,
        TaxOffice: a.TaxOffice || undefined,
        GlobalLocationNumber: a.GlobalLocationNumber || undefined,
        GSTIN: a.GSTIN || undefined,
        GstType: a.GstType || undefined,
        U_GSTIN_No: a.U_GSTIN_No || undefined,
        ...(a.BPCode ? { BPCode: a.BPCode } : {}),
        ...(a.RowNum != null && a.RowNum !== "" ? { RowNum: Number(a.RowNum) } : {}),
      }));
  }

  if (form.ContactEmployees?.length > 0) {
    p.ContactEmployees = form.ContactEmployees
      .filter((c) => c.Name && c.Name !== "Define New")
      .map((c) => {
        const contact = {
          Name: c.Name,
          FirstName: c.FirstName,
          MiddleName: c.MiddleName,
          LastName: c.LastName,
          Title: c.Title,
          Position: c.Position,
          Address: c.Address || c.Department,
          Phone1: c.Phone1,
          Phone2: c.Phone2,
          MobilePhone: c.MobilePhone,
          Fax: c.Fax,
          E_Mail: c.E_Mail,
          Pager: c.Pager,
          Remarks1: c.Remarks1,
          Remarks2: c.Remarks2,
          Password: c.Password,
          DateOfBirth: c.DateOfBirth,
          Gender: normalizeGenderValue(c.Gender),
          Profession: c.Profession,
          PlaceOfBirth: c.PlaceOfBirth,
          Active: c.Active || "tYES",
          BlockSendingMarketingContent: c.BlockSendingMarketingContent || "tNO",
        };

        if (opt(c.CardCode)) contact.CardCode = c.CardCode;
        if (opt(c.InternalCode) && !Number.isNaN(Number(c.InternalCode))) {
          contact.InternalCode = Number(c.InternalCode);
        }
        if (opt(c.EmailGroup) && !Number.isNaN(Number(c.EmailGroup))) {
          contact.EmailGroupCode = Number(c.EmailGroup);
        }

        return Object.fromEntries(
          Object.entries(contact).filter(([, value]) => value !== "" && value != null)
        );
      });
  }

  const bankRows = (form.BPBankAccounts || []).length > 0 ? form.BPBankAccounts : [{
    BankCode: form.PaymentBankCode,
    Country: form.PaymentBankCountryCode || form.BankCountry,
    AccountNo: form.PaymentBankAccountNo,
    Branch: form.PaymentBankBranch,
    ControlKey: form.PaymentBankControlKey,
    IBAN: form.PaymentBankIBAN,
    BICSwiftCode: form.PaymentBankBICSwiftCode,
    AccountName: form.PaymentBankAccountName,
    CustomerIdNumber: form.PaymentBankCustomerIdNumber,
    MandateID: form.PaymentBankMandateID,
    SignatureDate: form.PaymentBankSignatureDate,
    InternalKey: form.PaymentBankInternalKey,
  }];

  const mappedBankRows = bankRows
    .map((row) => {
      const bankAccount = {};
      if (opt(row.BankCode)) bankAccount.BankCode = row.BankCode;
      if (opt(row.Country)) bankAccount.Country = row.Country;
      if (opt(row.AccountNo)) bankAccount.AccountNo = row.AccountNo;
      if (opt(row.Branch)) bankAccount.Branch = row.Branch;
      if (opt(row.ControlKey)) bankAccount.ControlKey = row.ControlKey;
      if (opt(row.IBAN)) bankAccount.IBAN = row.IBAN;
      if (opt(row.BICSwiftCode)) bankAccount.BICSwiftCode = row.BICSwiftCode;
      if (opt(row.AccountName)) bankAccount.AccountName = row.AccountName;
      if (opt(row.CustomerIdNumber)) bankAccount.CustomerIdNumber = row.CustomerIdNumber;
      if (opt(row.MandateID)) bankAccount.MandateID = row.MandateID;
      if (opt(row.SignatureDate)) bankAccount.SignatureDate = row.SignatureDate;
      if (opt(row.Street)) bankAccount.Street = row.Street;
      if (opt(row.StreetNo)) bankAccount.StreetNo = row.StreetNo;
      if (opt(row.BuildingFloorRoom)) bankAccount.BuildingFloorRoom = row.BuildingFloorRoom;
      if (opt(row.ZipCode)) bankAccount.ZipCode = row.ZipCode;
      if (opt(row.Block)) bankAccount.Block = row.Block;
      if (opt(row.City)) bankAccount.City = row.City;
      if (opt(row.County)) bankAccount.County = row.County;
      if (opt(row.State)) bankAccount.State = row.State;
      if (opt(row.UserNo1)) bankAccount.UserNo1 = row.UserNo1;
      if (opt(row.UserNo2)) bankAccount.UserNo2 = row.UserNo2;
      if (opt(row.UserNo3)) bankAccount.UserNo3 = row.UserNo3;
      if (opt(row.UserNo4)) bankAccount.UserNo4 = row.UserNo4;
      if (opt(row.BPCode)) bankAccount.BPCode = row.BPCode;
      if (opt(row.InternalKey) && !Number.isNaN(Number(row.InternalKey))) bankAccount.InternalKey = Number(row.InternalKey);
      return bankAccount;
    })
    .filter((row) => Object.keys(row).length > 0);

  if (mappedBankRows.length > 0) {
    p.BPBankAccounts = mappedBankRows;
  }

  if ((form.BPPaymentDates || []).length > 0) {
    p.BPPaymentDates = form.BPPaymentDates
      .filter((row) => opt(row?.PaymentDate))
      .map((row) => ({
        PaymentDate: row.PaymentDate,
        ...(row.BPCode ? { BPCode: row.BPCode } : {}),
        ...(row.RowNumber != null && row.RowNumber !== "" ? { RowNumber: Number(row.RowNumber) } : {}),
      }));
  }

  const fiscalTaxRows = mergeTaxInfoIntoFiscalRows(form.BPFiscalTaxIDCollection, form.TaxInfo);
  if (fiscalTaxRows.length > 0) {
    p.BPFiscalTaxIDCollection = fiscalTaxRows.map((row) => ({
      Address: row.Address || "",
      AddrType: row.AddrType || "bo_ShipTo",
      TaxId0: row.TaxId0 ?? null,
      TaxId1: row.TaxId1 ?? null,
      TaxId2: row.TaxId2 ?? null,
      TaxId3: row.TaxId3 ?? null,
      TaxId4: row.TaxId4 ?? null,
      TaxId5: row.TaxId5 ?? null,
      TaxId6: row.TaxId6 ?? null,
      TaxId7: row.TaxId7 ?? null,
      TaxId8: row.TaxId8 ?? null,
      TaxId9: row.TaxId9 ?? null,
      TaxId10: row.TaxId10 ?? null,
      TaxId11: row.TaxId11 ?? null,
      TaxId12: row.TaxId12 ?? null,
      TaxId13: row.TaxId13 ?? null,
      AToRetrNFe: row.AToRetrNFe || "tNO",
      ...(row.BPCode ? { BPCode: row.BPCode } : {}),
      ...(row.CNAECode != null ? { CNAECode: row.CNAECode } : {}),
    }));
  }

  p.BPWithholdingTaxCollection = (form.BPWithholdingTaxCollection || [])
    .filter((row) => opt(row?.WTCode))
    .map((row) => ({
      WTCode: String(row.WTCode || "").trim(),
      ...(row.BPCode ? { BPCode: row.BPCode } : {}),
    }));

  return p;
}

export default function BusinessPartnerModule() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode]       = useState(MODES.ADD);
  const [tab, setTab]         = useState(0);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [alert, setAlert]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [bpGroups, setBpGroups]           = useState([]);
  const [companyTypeOptions, setCompanyTypeOptions] = useState(DEFAULT_COMPANY_TYPE_OPTIONS);
  const [numberingSeries, setNumberingSeries] = useState([]);
  const [currencyModal, setCurrencyModal] = useState(false);
  const [currencyList, setCurrencyList]   = useState([]);
  const [currencyLoading, setCurrencyLoading] = useState(false);
  const [showCFL, setShowCFL]   = useState(false);
  const [cflResults, setCflResults] = useState([]);
  const [duplicateSourceCardCode, setDuplicateSourceCardCode] = useState("");

  const isManual  = (s)  => !s || s === "0" || s === "";
  const pickDefaultSeries = (rows = []) =>
    rows.find((row) => row.isDefault && !row.isManual)
    || rows.find((row) => !row.isManual)
    || rows.find((row) => row.isDefault)
    || rows[0]
    || null;

  // Load BP groups once
  useEffect(() => {
    fetchBPGroups("", form.CardType).then(setBpGroups).catch(() => setBpGroups([]));
  }, [form.CardType]);

  useEffect(() => {
    fetchBPCompanyTypes().then((rows) => {
      if (Array.isArray(rows) && rows.length > 0) {
        setCompanyTypeOptions(rows);
      }
    }).catch(() => {});
    // Try to load series from SAP — if none found, dropdown stays as Manual only
  }, []);

  useEffect(() => {
    if (mode === MODES.UPDATE) return;

    let ignore = false;
    fetchNumberingSeries(form.CardType)
      .then((rows) => {
        if (ignore) return;
        setNumberingSeries(rows);
        setForm((prev) => {
          if (!prev.Series) return prev;
          const selected = rows.find((row) => String(row.series) === String(prev.Series));
          if (selected) return prev;
          return { ...prev, Series: "", CardCode: "" };
        });
      })
      .catch(() => {
        if (!ignore) setNumberingSeries([]);
      });

    return () => {
      ignore = true;
    };
  }, [form.CardType, mode]);

  useEffect(() => {
    let ignore = false;
    const stateCardCode = location.state?.businessPartnerCardCode || location.state?.cardCode;
    const cardCode = stateCardCode || new URLSearchParams(location.search).get("cardCode");
    const normalizedCardCode = String(cardCode || "").trim();

    if (!normalizedCardCode) {
      return () => {
        ignore = true;
      };
    }

    if (stateCardCode && !isRouteStateForActiveCompany(location.state)) {
      replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
      return () => {
        ignore = true;
      };
    }

    const loadBusinessPartner = async () => {
      setLoading(true);
      try {
        const data = await getBP(normalizedCardCode);
        if (ignore) {
          return;
        }

        setForm({ ...EMPTY_FORM, ...normalizeBP(data) });
        setMode(MODES.UPDATE);
        setDuplicateSourceCardCode("");
        setTab(0);
        showAlert("success", `"${data.CardCode}" loaded.`);
        if (stateCardCode) {
          replaceRouteStatePreservingWindow(navigate, location.pathname, location.state);
        }
      } catch (error) {
        if (!ignore) {
          showAlert("error", error.response?.data?.message || `Could not load "${normalizedCardCode}".`);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    loadBusinessPartner();

    return () => {
      ignore = true;
    };
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    const currentContactPerson = String(form.ContactPerson || "").trim();
    const validContactNames = (form.ContactEmployees || [])
      .map((contact) => getContactPersonName(contact))
      .filter(Boolean);
    const fallbackContactPerson = getDefaultContactPersonName(form.ContactEmployees || []);
    const resolvedContactPerson = currentContactPerson && validContactNames.includes(currentContactPerson)
      ? currentContactPerson
      : fallbackContactPerson;

    if (currentContactPerson === resolvedContactPerson) {
      return;
    }

    setForm((prev) => {
      const prevContactPerson = String(prev.ContactPerson || "").trim();
      const prevValidContactNames = (prev.ContactEmployees || [])
        .map((contact) => getContactPersonName(contact))
        .filter(Boolean);
      const prevFallbackContactPerson = getDefaultContactPersonName(prev.ContactEmployees || []);
      const nextContactPerson = prevContactPerson && prevValidContactNames.includes(prevContactPerson)
        ? prevContactPerson
        : prevFallbackContactPerson;

      if (prevContactPerson === nextContactPerson) {
        return prev;
      }

      return {
        ...prev,
        ContactPerson: nextContactPerson,
      };
    });
  }, [form.ContactEmployees, form.ContactPerson]);

  const handleSeriesChange = async (e) => {
    const val = e.target.value;
    const selectedSeries = numberingSeries.find((s) => String(s.series) === String(val));
    if (isManual(val) || selectedSeries?.isManual) {
      setForm((p) => ({ ...p, Series: val, CardCode: "" }));
      setTimeout(() => document.querySelector('input[name="CardCode"]')?.focus(), 50);
      return;
    }
    // Auto series — fetch next number
    setForm((p) => ({ ...p, Series: val, CardCode: "..." }));
    try {
      const next = await getNextSeriesNumber(val, form.CardType);
      setForm((p) => ({ ...p, Series: val, CardCode: next.formattedCode || "" }));
    } catch {
      setForm((p) => ({ ...p, Series: val, CardCode: "" }));
    }
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setDuplicateSourceCardCode("");
    setTab(0);
    setAlert(null);
  };

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setForm((p) => {
      const nextValue = type === "checkbox" ? (checked ? "tYES" : "tNO") : value;
      if (name === "CardType" && nextValue !== p.CardType) {
        return {
          ...p,
          CardType: nextValue,
          Series: "",
          CardCode: "",
          GroupCode: "",
          GroupName: "",
          PeymentMethodCode: "",
          BPPaymentMethods: [],
          DefaultAccount: "",
          DebitorAccount: "",
          DebitorAccountName: "",
          DownPaymentClearAct: "",
          DownPaymentClearActName: "",
          DownPaymentInterimAccount: "",
          DownPaymentInterimAccountName: "",
          SubjectToWithholdingTax: "boNO",
          WTCode: "",
          WTCodeName: "",
          WTTaxCategoryLabel: "",
          BPWithholdingTaxCollection: [],
        };
      }
      return { ...p, [name]: nextValue };
    });
  }, []);

  const getFieldBG = (name) => {
    const searchable = ["CardCode","CardName","CardForeignName","Phone1","EmailAddress"];
    return mode === MODES.FIND && searchable.includes(name) ? "#FFFFCC" : "#fff";
  };

  const activateFind = useCallback(() => {
    navigate("/business-partner/find");
  }, [navigate]);

  // Lookup helpers
  const fetchShippingTypesLookup = async (q = "") => {
    try { return (await searchShippingTypes(q)).map((i) => ({ code: i.Code, name: i.Name })); }
    catch { return []; }
  };
  const fetchPaymentTermsLookup = async (q = "") => {
    try { return await fetchPaymentTerms(q); } catch { return []; }
  };
  const fetchGLAccountsLookup = async (q = "") => {
    try { return (await searchAccounts(q)).map((i) => ({ code: i.Code, name: i.Name })); }
    catch { return []; }
  };
  const fetchBusinessPartnersLookup = async (q = "") => {
    try {
      return (await searchBP(q, form.CardType, 50)).map((bp) => ({
        code: bp.CardCode,
        name: bp.CardName,
        type: bp.CardType === "cCustomer" ? "Customer" : bp.CardType === "cSupplier" ? "Supplier" : "Lead",
      }));
    } catch {
      return [];
    }
  };
  const fetchSuppliersLookup = async (q = "") => {
    try {
      return (await searchBP(q, "cSupplier", 50)).map((bp) => ({
        code: bp.CardCode,
        name: bp.CardName,
        type: "Supplier",
      }));
    } catch {
      return [];
    }
  };
  const fetchWithholdingTaxCodesLookup = async (q = "") => {
    try { return await fetchBPWithholdingTaxCodes(q); } catch { return []; }
  };
  const fetchSalesPersonsLookup = async (q = "") => {
    try { return await fetchSalesPersons(q); } catch { return []; }
  };
  const fetchCreditCardsLookup = async (q = "") => {
    try { return await fetchBPCreditCards(q); } catch { return []; }
  };
  const fetchBanksLookup = async (q = "", country = "") => {
    try { return await fetchBPBanks(q, country); } catch { return []; }
  };
  const fetchCountriesLookup = useCallback(async (q = "") => {
    try { return await fetchBPCountries(q); } catch { return []; }
  }, []);
  const normalizeContactBirthCountries = useCallback(async (sourceForm) => {
    const contacts = sourceForm.ContactEmployees || [];
    if (!contacts.length) return sourceForm;

    const lookupCache = new Map();
    let hasChanges = false;
    const normalizedContacts = await Promise.all(contacts.map(async (contact) => {
      const rawPlaceOfBirth = String(contact?.PlaceOfBirth || "").trim();
      if (!rawPlaceOfBirth) return contact;

      const cacheKey = rawPlaceOfBirth.toLowerCase();
      let exactCountry = lookupCache.get(cacheKey);
      if (exactCountry === undefined) {
        const options = await fetchCountriesLookup(rawPlaceOfBirth);
        exactCountry = options.find((option) => {
          const optionCode = String(option.code || "").trim().toLowerCase();
          const optionName = String(option.name || "").trim().toLowerCase();
          return optionCode === cacheKey || optionName === cacheKey;
        }) || null;
        lookupCache.set(cacheKey, exactCountry);
      }

      if (!exactCountry) {
        hasChanges = true;
        return {
          ...contact,
          PlaceOfBirth: "",
          PlaceOfBirthName: "",
        };
      }

      const nextCode = String(exactCountry.code || "").trim();
      const nextName = String(exactCountry.name || "").trim();
      if (rawPlaceOfBirth !== nextCode || String(contact.PlaceOfBirthName || "").trim() !== nextName) {
        hasChanges = true;
        return {
          ...contact,
          PlaceOfBirth: nextCode,
          PlaceOfBirthName: nextName,
        };
      }

      return contact;
    }));

    if (!hasChanges) return sourceForm;
    return {
      ...sourceForm,
      ContactEmployees: normalizedContacts,
    };
  }, [fetchCountriesLookup]);
  const createCreditCardLookup = async (payload) => createBPCreditCard(payload);

  const openCurrencyLookup = async () => {
    setCurrencyModal(true);
    setCurrencyLoading(true);
    try { setCurrencyList(await fetchCurrencies("")); }
    catch { setCurrencyList([]); }
    finally { setCurrencyLoading(false); }
  };

  // A contact or address filled in without its ID would be dropped by buildPayload; say so instead.
  const stopOnUnnamedRow = (sourceForm) => {
    const unnamed = findUnnamedRow(sourceForm);
    if (!unnamed) return false;
    setTab(TABS.indexOf(unnamed.tab === "contacts" ? "Contact Persons" : "Addresses"));
    showAlert("error", unnamed.message);
    return true;
  };

  // CRUD handlers
  const handleAdd = useCallback(async () => {
    const cardCode = safeTrim(form.CardCode);
    if (!cardCode) { showAlert("error", "Card Code is required."); return; }
    if (!safeTrim(form.CardName)) { showAlert("error", "Card Name is required."); return; }
    if (stopOnUnnamedRow(form)) return;
    setLoading(true);
    try {
      const normalizedForm = await normalizeContactBirthCountries(form);
      if (normalizedForm !== form) setForm(normalizedForm);
      const payload = buildPayload(normalizedForm);
      if (duplicateSourceCardCode) {
        payload._duplicateFromCardCode = duplicateSourceCardCode;
        payload.CardCode = cardCode;
        payload.CardType = normalizedForm.CardType || "cCustomer";
      }
      const created = await createBP(payload);
      const createdCardCode = safeTrim(created?.CardCode) || cardCode;
      const createdData = createdCardCode ? await getBP(createdCardCode) : created;
      if (createdData?.CardCode) {
        setForm({ ...EMPTY_FORM, ...normalizeBP(createdData) });
      }
      showAlert("success", `Business Partner "${createdCardCode}" created successfully.`);
      setMode(MODES.UPDATE);
      setDuplicateSourceCardCode("");
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to create.");
    } finally { setLoading(false); }
  }, [form, normalizeContactBirthCountries, duplicateSourceCardCode]);

  const handleFind = useCallback(async () => {
    const cardCode = safeTrim(form.CardCode);
    const searchTerm = cardCode
      || safeTrim(form.CardName)
      || safeTrim(form.CardForeignName)
      || safeTrim(form.Phone1)
      || safeTrim(form.EmailAddress);
    const shouldShowList = !searchTerm;

    setLoading(true);
    try {
      if (cardCode && !shouldShowList) {
        try {
          const data = await getBP(cardCode);
          setForm({ ...EMPTY_FORM, ...normalizeBP(data) });
          setMode(MODES.UPDATE);
          setDuplicateSourceCardCode("");
          showAlert("success", `"${data.CardCode}" loaded.`);
          return;
        } catch (_) {}
      }

      const results = await searchBP(searchTerm, form.CardType, 100);
      if (results.length === 0) { showAlert("error", "No matching business partners found."); }
      else if (results.length === 1 && !shouldShowList) {
        const data = await getBP(results[0].CardCode);
        setForm({ ...EMPTY_FORM, ...normalizeBP(data) });
        setMode(MODES.UPDATE);
        setDuplicateSourceCardCode("");
        showAlert("success", `"${data.CardCode}" loaded.`);
      } else {
        setCflResults(results);
        setShowCFL(true);
      }
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Search failed.");
    } finally { setLoading(false); }
  }, [form.CardCode, form.CardName, form.CardForeignName, form.Phone1, form.EmailAddress, form.CardType]);

  const handleCFLSelect = async (bp) => {
    setShowCFL(false);
    setLoading(true);
    try {
      const data = await getBP(bp.CardCode);
      setForm({ ...EMPTY_FORM, ...normalizeBP(data) });
      setMode(MODES.UPDATE);
      setDuplicateSourceCardCode("");
      showAlert("success", `"${data.CardCode}" loaded.`);
    } catch (err) {
      showAlert("error", err.response?.data?.message || "Failed to load.");
    } finally { setLoading(false); }
  };

  const handleDuplicate = useCallback(async () => {
    if (mode !== MODES.UPDATE || !form.CardCode) return;

    const sourceCardCode = safeTrim(form.CardCode);
    const sourceCardType = form.CardType || "cCustomer";
    const duplicatedAddresses = (form.BPAddresses || []).map(({ BPCode, RowNum, ...address }) => address);
    const duplicatedBanks = (form.BPBankAccounts || []).map(({ BPCode, InternalKey, ...bank }) => bank);
    const duplicatedContacts = (form.ContactEmployees || []).map(({ InternalCode, CardCode, ...contact }) => ({
      ...contact,
      PlaceOfBirth: safeTrim(contact.PlaceOfBirth),
      PlaceOfBirthName: safeText(contact.PlaceOfBirthName),
    }));
    const duplicatedPaymentMethods = (form.BPPaymentMethods || []).map(
      ({ BPCode, RowNumber, ...paymentMethod }) => paymentMethod
    );
    const duplicatedPaymentDates = (form.BPPaymentDates || []).map(
      ({ BPCode, RowNumber, ...paymentDate }) => paymentDate
    );
    const duplicatedWithholdingTax = (form.BPWithholdingTaxCollection || []).map(
      ({ BPCode, ...withholdingTax }) => withholdingTax
    );
    const duplicatedFiscalTax = (form.BPFiscalTaxIDCollection || []).map(
      ({ BPCode, ...fiscalTax }) => fiscalTax
    );

    const duplicateForm = {
      ...form,
      Series: "",
      CardCode: "",
      BPAddresses: duplicatedAddresses,
      BPBankAccounts: duplicatedBanks,
      ContactEmployees: duplicatedContacts,
      BPPaymentMethods: duplicatedPaymentMethods,
      BPPaymentDates: duplicatedPaymentDates,
      BPWithholdingTaxCollection: duplicatedWithholdingTax,
      BPFiscalTaxIDCollection: duplicatedFiscalTax,
      PaymentBankInternalKey: "",
      PaymentBankSelectedIndex: duplicatedBanks.length > 0 ? 0 : -1,
    };

    setLoading(true);
    setDuplicateSourceCardCode(sourceCardCode);
    setMode(MODES.ADD);
    setTab(0);
    setForm(duplicateForm);

    try {
      const rows = await fetchNumberingSeries(sourceCardType);
      setNumberingSeries(Array.isArray(rows) ? rows : []);
      const selectedSeries = pickDefaultSeries(Array.isArray(rows) ? rows : []);

      if (!selectedSeries || selectedSeries.isManual) {
        setForm((prev) => ({
          ...prev,
          Series: selectedSeries?.series || "",
          CardCode: "",
        }));
        showAlert("success", "Business partner duplicated. Enter a manual code and add it as a new business partner.");
        setTimeout(() => document.querySelector('input[name="CardCode"]')?.focus(), 50);
        return;
      }

      const next = await getNextSeriesNumber(selectedSeries.series, sourceCardType);
      setForm((prev) => ({
        ...prev,
        Series: selectedSeries.series,
        CardCode: next.formattedCode || "",
      }));
      showAlert("success", "Business partner duplicated with the live SAP B1 numbering series. Review and add it as a new business partner.");
    } catch (err) {
      setNumberingSeries([]);
      showAlert("error", err.response?.data?.message || "Business partner duplicated, but live numbering series could not be loaded.");
      setTimeout(() => document.querySelector('select[name="Series"]')?.focus(), 50);
    } finally {
      setLoading(false);
    }
  }, [form, mode]);

  const handleUpdate = useCallback(async () => {
    const cardCode = safeTrim(form.CardCode);
    if (!cardCode) { showAlert("error", "Card Code is required."); return; }
    if (!safeTrim(form.CardName)) { showAlert("error", "Card Name is required."); return; }
    if (stopOnUnnamedRow(form)) return;
    setLoading(true);
    try {
      const normalizedForm = await normalizeContactBirthCountries(form);
      if (normalizedForm !== form) setForm(normalizedForm);
      const updated = await updateBP(cardCode, buildPayload(normalizedForm));
      const updatedData = updated?.CardCode ? updated : await getBP(cardCode);
      setForm({ ...EMPTY_FORM, ...normalizeBP(updatedData) });
      showAlert("success", `"${cardCode}" updated successfully.`);
    } catch (err) {
      showAlert("error", err.response?.data?.message || err.message || "Failed to update.");
    } finally { setLoading(false); }
  }, [form, normalizeContactBirthCountries]);

  const handleSave = useCallback(() => {
    if (mode === MODES.ADD)    return handleAdd();
    if (mode === MODES.UPDATE) return handleUpdate();
    if (mode === MODES.FIND)   return handleFind();
  }, [mode, handleAdd, handleUpdate, handleFind]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.key === "f") { e.preventDefault(); activateFind(); }
      if (e.key === "F2")             { e.preventDefault(); activateFind(); }
      if (e.key === "Escape" && mode === MODES.FIND) { e.preventDefault(); setMode(MODES.ADD); resetForm(); }
      if (e.key === "Enter"  && mode === MODES.FIND) { e.preventDefault(); handleFind(); }
      if (e.ctrlKey && e.key === "s") { e.preventDefault(); handleSave(); }
      if (e.ctrlKey && e.key === "n") { e.preventDefault(); setMode(MODES.ADD); resetForm(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, activateFind, handleFind, handleSave]);

  return (
    <div className="im-page" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Toolbar */}
      <div className="im-toolbar">
        <span className="im-toolbar__title">Business Partner Master Data</span>
        <span className={`im-mode-badge im-mode-badge--${mode}`}>
          {mode === MODES.ADD ? "Add Mode" : mode === MODES.FIND ? "Find Mode" : "Update Mode"}
        </span>
        <button className="im-btn im-btn--primary" onClick={handleSave} disabled={loading}>
          {loading ? "..." : mode === MODES.FIND ? "Find" : mode === MODES.ADD ? "Add" : "Update"}
        </button>
        <button className="im-btn" onClick={() => { setMode(MODES.ADD); resetForm(); }}>New</button>
        <button className={`im-btn${mode === MODES.FIND ? " im-btn--find-active" : ""}`}
          onClick={activateFind} title="Ctrl+F">Find</button>
        {mode === MODES.UPDATE && (
          <button className="im-btn sap-document-toolbar__duplicate" onClick={handleDuplicate}>Duplicate</button>
        )}
        {mode === MODES.UPDATE && (
          <button className="im-btn" onClick={resetForm}>Cancel</button>
        )}
      </div>

      {alert && <div className={`im-alert im-alert--${alert.type}`}>{alert.msg}</div>}

      {/* Header card */}
      <div className="im-header-card">
        <div className="bp-header-section">
          <div className="bp-header-left">
            {/* Code row — SAP B1 style: Manual label + CardCode input + CardType */}
            <div className="im-field">
              <label className="im-field__label">Code</label>
              <select
                className="im-field__select"
                name="Series"
                value={form.Series}
                onChange={handleSeriesChange}
                disabled={mode === MODES.UPDATE}
                style={{ width: 120, flexShrink: 0 }}
              >
                <option value="">Select...</option>
                {numberingSeries.map((s) => (
                  <option key={s.series} value={s.series}>
                    {s.name}{s.isDefault ? " ✓" : ""}
                  </option>
                ))}
              </select>
              <input
                className="im-field__input"
                name="CardCode"
                value={form.CardCode}
                onChange={handleChange}
                readOnly={mode === MODES.UPDATE}
                placeholder="Enter Code"
                style={{ flex: 1, background: getFieldBG("CardCode") }}
                autoFocus={mode === MODES.ADD}
              />
              <select
                className="im-field__select"
                name="CardType"
                value={form.CardType}
                onChange={handleChange}
                disabled={mode === MODES.UPDATE}
                style={{ width: 110, flexShrink: 0 }}
              >
                <option value="cCustomer">Customer</option>
                <option value="cSupplier">Supplier</option>
                <option value="cLead">Lead</option>
              </select>
            </div>
            <div className="im-field">
              <label className="im-field__label">Name</label>
              <input className="im-field__input" name="CardName" value={form.CardName}
                onChange={handleChange} style={{ background: getFieldBG("CardName") }} />
            </div>
            <div className="im-field">
              <label className="im-field__label">Foreign Name</label>
              <input className="im-field__input" name="CardForeignName" value={form.CardForeignName} onChange={handleChange} />
            </div>
            <div className="im-field">
              <label className="im-field__label">Group</label>
              <select className="im-field__select" name="GroupCode" value={form.GroupCode} onChange={handleChange}>
                <option value="">-- Select Group --</option>
                {bpGroups.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}
              </select>
            </div>
            <div className="im-field">
              <label className="im-field__label">Currency</label>
              <input className="im-field__input" name="Currency" value={form.Currency}
                onChange={handleChange} placeholder="" style={{ flex: 1 }} />
              <button type="button" className="im-lookup-btn" onClick={openCurrencyLookup} title="Browse">…</button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="im-tabs">
        {TABS.map((t, i) => (
          <button key={t} type="button"
            className={`im-tab${tab === i ? " im-tab--active" : ""}`}
            onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* Tab panel */}
      <div className="im-tab-panel" style={{ flex: 1 }}>
        {tab === 0 && <GeneralTab form={form} onChange={handleChange} setForm={setForm}
          fetchShippingTypes={fetchShippingTypesLookup} fetchSalesPersons={fetchSalesPersonsLookup}
          companyTypeOptions={companyTypeOptions}
          getFieldBackground={getFieldBG} />}
        {tab === 1 && <ContactTab form={form} setForm={setForm} fetchCountries={fetchCountriesLookup} />}
        {tab === 2 && <AddressTab form={form} setForm={setForm} />}
        {tab === 3 && <PaymentTab form={form} onChange={handleChange} setForm={setForm}
          fetchBPPriceLists={fetchBPPriceLists}
          fetchPaymentTerms={fetchPaymentTermsLookup}
          fetchCreditCards={fetchCreditCardsLookup}
          fetchGLAccounts={fetchGLAccountsLookup}
          fetchBanks={fetchBanksLookup}
          fetchCountries={fetchCountriesLookup}
          createCreditCard={createCreditCardLookup}
          showAlert={showAlert} />}
        {tab === 4 && <PaymentRunTab
          form={form}
          onChange={handleChange}
          setForm={setForm}
          fetchBanks={fetchBanksLookup}
          fetchCountries={fetchCountriesLookup}
          fetchHouseBankAccounts={fetchBPHouseBankAccounts}
        />}
        {tab === 5 && <AccountingTab form={form} onChange={handleChange} setForm={setForm}
          fetchGLAccounts={fetchGLAccountsLookup}
          fetchBusinessPartners={fetchBusinessPartnersLookup}
          fetchSuppliers={fetchSuppliersLookup}
          fetchWithholdingTaxCodes={fetchWithholdingTaxCodesLookup} />}
        {tab === 6 && <PropertiesTab form={form} onChange={handleChange} />}
        {tab === 7 && <RemarksTab form={form} onChange={handleChange} />}
      </div>

      {/* Currency modal */}
      {currencyModal && (
        <div className="im-modal-overlay" onClick={() => setCurrencyModal(false)}>
          <div className="im-modal" onClick={(e) => e.stopPropagation()}>
            <div className="im-modal__header">
              <span>Select Currency</span>
              <button className="im-modal__close" onClick={() => setCurrencyModal(false)}>✕</button>
            </div>
            <div className="im-modal__body">
              {currencyLoading ? <div className="im-modal__empty">Loading...</div> : (
                <table className="im-lookup-table">
                  <thead><tr><th>Code</th><th>Name</th></tr></thead>
                  <tbody>
                    {currencyList.map((c) => (
                      <tr key={c.code} className="im-lookup-table__row"
                        onClick={() => { setForm((p) => ({ ...p, Currency: c.code, CurrencyName: c.name })); setCurrencyModal(false); }}>
                        <td>{c.code}</td><td>{c.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Choose From List */}
      {showCFL && (
        <div className="im-modal-overlay" onClick={() => setShowCFL(false)}>
          <div className="im-modal im-modal--cfl" onClick={(e) => e.stopPropagation()}>
            <div className="im-modal__header">
              <span>Choose From List — Business Partners</span>
              <button className="im-modal__close" onClick={() => setShowCFL(false)}>✕</button>
            </div>
            <div className="im-modal__body">
              <table className="im-lookup-table">
                <thead><tr><th>Card Code</th><th>Card Name</th><th>Type</th></tr></thead>
                <tbody>
                  {cflResults.map((bp) => (
                    <tr key={bp.CardCode} className="im-lookup-table__row"
                      onClick={() => handleCFLSelect(bp)}>
                      <td>{bp.CardCode}</td>
                      <td>{bp.CardName}</td>
                      <td>{bp.CardType === "cCustomer" ? "Customer" : bp.CardType === "cSupplier" ? "Supplier" : "Lead"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="im-modal__footer">
              <button className="im-btn" onClick={() => setShowCFL(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
