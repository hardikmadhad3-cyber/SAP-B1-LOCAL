const sapService = require("../services/sapService");
const masterDataDbService = require("../services/masterDataDbService");
const authDbService = require("../services/authDbService");
const businessPartnerDbService = require("../services/businessPartnerDbService");
const {
  normalizeBusinessPartnerDuplicateForTargetType,
  preserveBusinessPartnerUpdateCollectionKeys,
  sanitizeBusinessPartnerDuplicateOverrides,
  sanitizeBusinessPartnerForDuplicate,
  sanitizeBusinessPartnerPayloadForSap,
} = require("../services/businessPartnerPayloadCleanup");

const parseMetadataEnumMembers = (metadataXml, enumName) => {
  const enumStart = metadataXml.indexOf(`<EnumType Name="${enumName}"`);
  if (enumStart < 0) return [];

  const enumEnd = metadataXml.indexOf("</EnumType>", enumStart);
  if (enumEnd < 0) return [];

  const enumBlock = metadataXml.slice(enumStart, enumEnd);
  return [...enumBlock.matchAll(/<Member Name="([^"]+)"/g)].map((match) => match[1]);
};

const sanitizePayloadForActiveSap = async (payload) => {
  const companyDb = await sapService.resolveCompanyDb();
  const { payload: sanitizedPayload, removedPaths } = await sanitizeBusinessPartnerPayloadForSap(payload, {
    companyDb,
    loadMetadataXml: async () => {
      const response = await sapService.request({ method: "GET", url: "/$metadata" });
      return typeof response.data === "string" ? response.data : String(response.data || "");
    },
  });

  if (removedPaths.length > 0) {
    console.warn(`[SAP BP payload] Removed unsupported properties for ${companyDb}: ${removedPaths.join(", ")}`);
  }
  return sanitizedPayload;
};

// The local PostgreSQL adapter stores SAP yes/no fields as CHAR(1). Keep the
// withholding flag in the same tYES/tNO form as the other BP flags before the
// payload reaches either the local adapter or a real Service Layer.
const normalizeBusinessPartnerEnums = (payload = {}) => {
  const next = { ...payload };
  if (next.SubjectToWithholdingTax === "boYES") next.SubjectToWithholdingTax = "tYES";
  if (next.SubjectToWithholdingTax === "boNO") next.SubjectToWithholdingTax = "tNO";
  return next;
};

const formatSapEnumLabel = (value) =>
  String(value || "")
    .replace(/^[a-z](?=[A-Z])/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();

const getRequestDatabaseName = async (req) => {
  if (!req.auth?.userId || !req.auth?.companyId) return "";

  const assignedCompany = await authDbService.getAssignedCompanyForUser(req.auth.userId, req.auth.companyId);
  return String(assignedCompany?.DbName || "").trim();
};

const normalizeLookupToken = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const normalizeCountryCode = (value) => {
  const token = normalizeLookupToken(value);
  if (!token) return "";
  if (token === "INDIA" || token === "IND") return "IN";
  return String(value || "").trim().toUpperCase();
};

const normalizeAssesseeType = (value) =>
  String(value || "").trim() === "atCompany" ? "atCompany" : "atOthers";

const isWithholdingCodeCompatible = (withholdingTaxCode, assesseeType) => {
  if (!withholdingTaxCode?.assesseeType) return true;
  return normalizeAssesseeType(withholdingTaxCode.assesseeType) === normalizeAssesseeType(assesseeType);
};

const findStateMatch = (states = [], value) => {
  const token = normalizeLookupToken(value);
  if (!token) return null;

  return states.find((state) =>
    [state.code, state.Code, state.name, state.Name].some((candidate) => normalizeLookupToken(candidate) === token)
  ) || null;
};

const inferIndianStateName = (address = {}) => {
  const cityToken = normalizeLookupToken(address.City);
  const cityStateMap = {
    LUDHIANA: "Punjab",
    AMRITSAR: "Punjab",
    JALANDHAR: "Punjab",
    PATIALA: "Punjab",
    CHANDIGARH: "Chandigarh",
    MUMBAI: "Maharashtra",
    PUNE: "Maharashtra",
    NAGPUR: "Maharashtra",
    AHMEDABAD: "Gujarat",
    SURAT: "Gujarat",
    VADODARA: "Gujarat",
    DELHI: "Delhi",
    NEWDELHI: "Delhi",
    BENGALURU: "Karnataka",
    BANGALORE: "Karnataka",
    CHENNAI: "Tamil Nadu",
    HYDERABAD: "Telangana",
    KOLKATA: "West Bengal",
    JAIPUR: "Rajasthan",
    LUCKNOW: "Uttar Pradesh",
    KANPUR: "Uttar Pradesh",
    INDORE: "Madhya Pradesh",
    BHOPAL: "Madhya Pradesh",
    KOCHI: "Kerala",
    COCHIN: "Kerala",
  };
  if (cityStateMap[cityToken]) return cityStateMap[cityToken];

  const pin = String(address.ZipCode || "").replace(/\D/g, "");
  if (pin.length < 2) return "";
  const prefix = pin.slice(0, 2);
  if (["14", "15"].includes(prefix) || pin.startsWith("160")) return "Punjab";
  if (["12", "13"].includes(prefix)) return "Haryana";
  if (prefix === "11") return "Delhi";
  if (prefix === "17") return "Himachal Pradesh";
  if (["18", "19"].includes(prefix)) return "Jammu and Kashmir";
  if (["30", "31", "32", "33", "34"].includes(prefix)) return "Rajasthan";
  if (["36", "37", "38", "39"].includes(prefix)) return "Gujarat";
  if (["40", "41", "42", "43", "44"].includes(prefix)) return "Maharashtra";
  if (["45", "46", "47", "48"].includes(prefix)) return "Madhya Pradesh";
  if (prefix === "49") return "Chhattisgarh";
  if (prefix === "50") return "Telangana";
  if (["51", "52", "53"].includes(prefix)) return "Andhra Pradesh";
  if (["56", "57", "58", "59"].includes(prefix)) return "Karnataka";
  if (["60", "61", "62", "63", "64"].includes(prefix)) return "Tamil Nadu";
  if (["67", "68", "69"].includes(prefix)) return "Kerala";
  if (["70", "71", "72", "73", "74"].includes(prefix)) return "West Bengal";
  if (["75", "76", "77"].includes(prefix)) return "Odisha";
  if (prefix === "78") return "Assam";
  if (["80", "81", "82", "83", "84", "85"].includes(prefix)) return "Bihar";
  return "";
};

const normalizeBusinessPartnerAddressPayload = async (data, req) => {
  if (!Array.isArray(data.BPAddresses) || data.BPAddresses.length === 0) return;

  const databaseName = await getRequestDatabaseName(req);
  const stateCache = new Map();
  const getStates = async (country) => {
    const countryCode = normalizeCountryCode(country);
    if (!countryCode) return [];
    if (!stateCache.has(countryCode)) {
      stateCache.set(
        countryCode,
        masterDataDbService.lookupStates(countryCode, { databaseName: databaseName || undefined }).catch(() => [])
      );
    }
    return stateCache.get(countryCode);
  };

  data.BPAddresses = await Promise.all(data.BPAddresses.map(async (address) => {
    const next = { ...address };
    const countryCode = normalizeCountryCode(next.Country);
    if (countryCode) next.Country = countryCode;

    const states = await getStates(countryCode);
    const explicitState = findStateMatch(states, next.State);
    if (explicitState) {
      next.State = explicitState.code || explicitState.Code;
      return next;
    }

    const inferredStateName = countryCode === "IN" ? inferIndianStateName(next) : "";
    const inferredState = findStateMatch(states, inferredStateName);
    if (inferredState) {
      next.State = inferredState.code || inferredState.Code;
      return next;
    }

    if (!String(next.State || "").trim()) delete next.State;
    return next;
  }));
};

const enrichBP = async (bp) => {
  if (!bp || !bp.CardCode) return bp;
  const withholdingCollectionCodes = [
    ...new Set(
      (bp.BPWithholdingTaxCollection || [])
        .map((row) => String(row?.WTCode || "").trim())
        .filter(Boolean),
    ),
  ];

  const [
    paymentTerms,
    priceList,
    creditCard,
    bank,
    country,
    fatherBP,
    linkedVendorBP,
    debitorAccount,
    downPaymentClearAccount,
    downPaymentInterimAccount,
    withholdingTaxCode,
    withholdingCollectionDetails,
  ] = await Promise.all([
    bp.PayTermsGrpCode != null && bp.PayTermsGrpCode !== "" && Number(bp.PayTermsGrpCode) >= 0
      ? masterDataDbService.getPaymentTerms(bp.PayTermsGrpCode).catch(() => null)
      : Promise.resolve(null),
    bp.PriceListNum != null && bp.PriceListNum !== "" && Number(bp.PriceListNum) >= 0
      ? masterDataDbService.getPriceList(bp.PriceListNum).catch(() => null)
      : Promise.resolve(null),
    bp.CreditCardCode != null && bp.CreditCardCode !== "" && Number(bp.CreditCardCode) >= 0
      ? masterDataDbService.getCreditCardByCode(bp.CreditCardCode).catch(() => null)
      : Promise.resolve(null),
    bp.BPBankAccounts?.[0]?.BankCode
      ? masterDataDbService.getBankByCode(bp.BPBankAccounts[0].BankCode, bp.BPBankAccounts[0].Country).catch(() => null)
      : Promise.resolve(null),
    bp.BPBankAccounts?.[0]?.Country
      ? masterDataDbService.getCountryByCode(bp.BPBankAccounts[0].Country).catch(() => null)
      : Promise.resolve(null),
    bp.FatherCard
      ? masterDataDbService.getBP(bp.FatherCard).catch(() => null)
      : Promise.resolve(null),
    bp.LinkedBusinessPartner
      ? masterDataDbService.getBP(bp.LinkedBusinessPartner).catch(() => null)
      : Promise.resolve(null),
    bp.DebitorAccount
      ? masterDataDbService.getAccount(bp.DebitorAccount).catch(() => null)
      : Promise.resolve(null),
    bp.DownPaymentClearAct
      ? masterDataDbService.getAccount(bp.DownPaymentClearAct).catch(() => null)
      : Promise.resolve(null),
    bp.DownPaymentInterimAccount
      ? masterDataDbService.getAccount(bp.DownPaymentInterimAccount).catch(() => null)
      : Promise.resolve(null),
    bp.WTCode
      ? masterDataDbService.getWithholdingTaxCode(bp.WTCode).catch(() => null)
      : Promise.resolve(null),
    Promise.all(
      withholdingCollectionCodes.map((code) =>
        masterDataDbService.getWithholdingTaxCode(code).catch(() => null),
      ),
    ),
  ]);
  const withholdingDetailsByCode = new Map(
    withholdingCollectionDetails
      .filter(Boolean)
      .map((row) => [String(row.code || "").trim().toUpperCase(), row]),
  );
  const enrichedWithholdingCollection = (bp.BPWithholdingTaxCollection || []).map((row) => {
    const details = withholdingDetailsByCode.get(String(row?.WTCode || "").trim().toUpperCase());
    return {
      ...row,
      WTCodeName: details?.name || row.WTCodeName || "",
      AssesseeType: details?.assesseeType || row.AssesseeType || "",
      AssesseeTypeLabel: details?.assesseeTypeLabel || row.AssesseeTypeLabel || "",
      WTTaxCategoryLabel: details?.taxCategory || row.WTTaxCategoryLabel || "",
    };
  });

  return {
    ...bp,
    FatherCardName: fatherBP?.CardName || bp.FatherCardName || "",
    ConsolidatingBPName: fatherBP?.CardName || bp.ConsolidatingBPName || "",
    LinkedBusinessPartnerName: linkedVendorBP?.CardName || bp.LinkedBusinessPartnerName || "",
    PayTermsName: paymentTerms?.PaymentTermsGroupName || bp.PayTermsName || "",
    PriceListName: priceList?.PriceListName || bp.PriceListName || "",
    CreditCardName: creditCard?.name || bp.CreditCardName || "",
    DebitorAccountName: debitorAccount?.Name || bp.DebitorAccountName || "",
    DownPaymentClearActName: downPaymentClearAccount?.Name || bp.DownPaymentClearActName || "",
    DownPaymentInterimAccountName: downPaymentInterimAccount?.Name || bp.DownPaymentInterimAccountName || "",
    WTCodeName: withholdingTaxCode?.name || bp.WTCodeName || "",
    WTTaxCategoryLabel: withholdingTaxCode?.taxCategory || bp.WTTaxCategoryLabel || "",
    BPWithholdingTaxCollection: enrichedWithholdingCollection,
    PaymentBankName: bank?.name || bp.PaymentBankName || "",
    PaymentBankCountryName: country?.name || bank?.countryName || bp.PaymentBankCountryName || "",
  };
};

const createBP = async (req, res) => {
  const data = req.body;

  try {
    const duplicateFromCardCode = String(data._duplicateFromCardCode || "").trim();
    if (duplicateFromCardCode) {
      let newCardCode = String(data.CardCode || "").trim();
      const cardType = data.CardType || "cCustomer";
      const series = String(data.Series ?? "");
      let isManual = !series || series === "0";
      const next = !isManual ? await masterDataDbService.getBPSeriesNextNumber(series, cardType) : null;
      isManual = isManual || Boolean(next?.isManual);

      if (!newCardCode && isManual) {
        return res.status(400).json({ message: "CardCode is required for duplicate business partner." });
      }
      if (!String(data.CardName || "").trim()) {
        return res.status(400).json({ message: "CardName is required for duplicate business partner." });
      }

      if (!newCardCode && !isManual) {
        if (!next || next.isManual || !next.formattedCode) {
          return res.status(400).json({ message: `Could not get next number for series '${series}'.` });
        }
        newCardCode = next.formattedCode;
      }

      const sourceResponse = await sapService.request({
        method: "GET",
        url: sapService.buildStringKeyPath("BusinessPartners", duplicateFromCardCode),
      });

      let duplicatePayload = sanitizeBusinessPartnerForDuplicate(sourceResponse.data, {
        CardCode: newCardCode,
        ...(Object.prototype.hasOwnProperty.call(data, "CardName") ? { CardName: data.CardName } : {}),
      });
      duplicatePayload = normalizeBusinessPartnerDuplicateForTargetType(
        duplicatePayload,
        sourceResponse.data.CardType,
        cardType,
      );

      const requestOverrides = sanitizeBusinessPartnerDuplicateOverrides(data);
      if (sourceResponse.data.CardType !== cardType) {
        [
          "BPPaymentMethods",
          "PeymentMethodCode",
          "DefaultAccount",
          "DebitorAccount",
          "DownPaymentClearAct",
          "DownPaymentInterimAccount",
          "BPWithholdingTaxCollection",
          "WTCode",
          "SubjectToWithholdingTax",
          "WithholdingTaxCertified",
        ].forEach((field) => delete requestOverrides[field]);
      }
      Object.entries(requestOverrides).forEach(([key, value]) => {
        if (value !== undefined) duplicatePayload[key] = value;
      });

      duplicatePayload.CardCode = newCardCode;
      duplicatePayload.CardType = cardType;
      if (Array.isArray(duplicatePayload.BPFiscalTaxIDCollection)) {
        duplicatePayload.BPFiscalTaxIDCollection = duplicatePayload.BPFiscalTaxIDCollection.map((row) => {
          const nextRow = { ...row };
          const taxId12 = String(nextRow.TaxId12 || "");
          if (taxId12.includes(duplicateFromCardCode)) {
            if (isManual) {
              nextRow.TaxId12 = taxId12.replaceAll(duplicateFromCardCode, newCardCode);
            } else {
              delete nextRow.TaxId12;
            }
          }
          return nextRow;
        });
      }
      if (!isManual) {
        duplicatePayload.Series = Number(series);
      } else {
        delete duplicatePayload.Series;
      }
      await normalizeBusinessPartnerAddressPayload(duplicatePayload, req);
      const sanitizedDuplicatePayload = await sanitizePayloadForActiveSap(
        normalizeBusinessPartnerEnums(duplicatePayload),
      );

      const result = await sapService.request({
        method: "POST",
        url: "/BusinessPartners",
        data: sanitizedDuplicatePayload,
        preserveEmptyStrings: true,
      });
      return res.status(201).json(result.data);
    }

    if (!data.CardType) return res.status(400).json({ message: "CardType is required." });
    data.CardName = String(data.CardName ?? "");
    if (!data.CardName.trim()) return res.status(400).json({ message: "CardName is required." });
    const series = String(data.Series ?? "");
    let isManual = !series || series === "0";

    await normalizeBusinessPartnerAddressPayload(data, req);

    const next = !isManual ? await masterDataDbService.getBPSeriesNextNumber(series, data.CardType) : null;
    isManual = isManual || Boolean(next?.isManual);

    if (isManual && !data.CardCode) {
      return res.status(400).json({ message: "CardCode is required for manual entry." });
    }

    if (!data.CardCode && !isManual) {
      if (!next || next.isManual || !next.formattedCode) {
        return res.status(400).json({ message: `Could not get next number for series '${series}'.` });
      }
      data.CardCode = next.formattedCode;
    }

    if (isManual) {
      delete data.Series;
    }

    const result = await sapService.createItem_generic(
      "/BusinessPartners",
      await sanitizePayloadForActiveSap(normalizeBusinessPartnerEnums(data)),
    );
    res.status(201).json(result);
  } catch (err) {
    const msg =
      err.response?.data?.error?.message?.value ||
      err.response?.data?.error?.message ||
      err.message;
    console.error("[SAP createBP error]", msg, JSON.stringify(err.response?.data));
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

const getBP = async (req, res) => {
  try {
    const response = await sapService.request({
      method: "GET",
      url: sapService.buildStringKeyPath("BusinessPartners", req.params.cardCode),
    });
    res.json(await enrichBP(response.data));
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

const updateBP = async (req, res) => {
  const { cardCode } = req.params;
  try {
    const payload = { ...req.body };
    delete payload.CardCode;
    delete payload.CardType;
    delete payload.Series;
    delete payload._duplicateFromCardCode;
    await normalizeBusinessPartnerAddressPayload(payload, req);
    const currentResponse = await sapService.request({
      method: "GET",
      url: sapService.buildStringKeyPath("BusinessPartners", cardCode),
    });
    const payloadWithCollectionKeys = preserveBusinessPartnerUpdateCollectionKeys(
      payload,
      currentResponse.data,
    );
    const incomingWithholdingRows = Array.isArray(payload.BPWithholdingTaxCollection)
      ? payload.BPWithholdingTaxCollection
      : null;
    if (incomingWithholdingRows) {
      delete payloadWithCollectionKeys.BPWithholdingTaxCollection;
    }
    const hasWithholdingCollection = Object.prototype.hasOwnProperty.call(payload, "BPWithholdingTaxCollection");
    const requestedAssesseeType = normalizeAssesseeType(payload.TypeReport || currentResponse.data.TypeReport || "atCompany");
    const requestedWithholdingCodes = [
      ...new Set([
        ...(hasWithholdingCollection
          ? (payload.BPWithholdingTaxCollection || []).map((row) => String(row?.WTCode || "").trim())
          : []),
        String(payload.WTCode || "").trim(),
      ].filter(Boolean)),
    ];
    const requestedWithholdingDetails = await Promise.all(
      requestedWithholdingCodes.map((code) =>
        masterDataDbService.getWithholdingTaxCode(code).catch(() => null),
      ),
    );
    const requestedWithholdingDetailsByCode = new Map(
      requestedWithholdingDetails
        .filter(Boolean)
        .map((row) => [String(row.code || "").trim().toUpperCase(), row]),
    );

    if (payloadWithCollectionKeys.WTCode) {
      const defaultDetails = requestedWithholdingDetailsByCode.get(
        String(payloadWithCollectionKeys.WTCode || "").trim().toUpperCase(),
      );
      if (defaultDetails && !isWithholdingCodeCompatible(defaultDetails, requestedAssesseeType)) {
        payloadWithCollectionKeys.WTCode = null;
      }
    }

    const existingWithholdingCodes = new Set(
      (currentResponse.data.BPWithholdingTaxCollection || [])
        .map((row) => String(row?.WTCode || "").trim().toUpperCase())
        .filter(Boolean),
    );
    const compatibleIncomingWithholdingRows = hasWithholdingCollection
      ? (payload.BPWithholdingTaxCollection || [])
          .filter((row) => String(row?.WTCode || "").trim())
          .filter((row) => {
            const details = requestedWithholdingDetailsByCode.get(String(row.WTCode || "").trim().toUpperCase());
            return !details || isWithholdingCodeCompatible(details, requestedAssesseeType);
          })
      : [];
    const newWithholdingRows = hasWithholdingCollection
      ? compatibleIncomingWithholdingRows
          .filter((row) => !existingWithholdingCodes.has(String(row.WTCode || "").trim().toUpperCase()))
          .map((row) => ({ WTCode: String(row.WTCode || "").trim() }))
      : [];
    const withholdingCollectionPayload = hasWithholdingCollection && newWithholdingRows.length
      ? { BPWithholdingTaxCollection: newWithholdingRows }
      : null;
    const sanitizedPayload = await sanitizePayloadForActiveSap(
      normalizeBusinessPartnerEnums(payloadWithCollectionKeys),
    );

    await sapService.request({
      method: "PATCH",
      url: sapService.buildStringKeyPath("BusinessPartners", cardCode),
      data: sanitizedPayload,
    });
    if (withholdingCollectionPayload) {
      await sapService.request({
        method: "PATCH",
        url: sapService.buildStringKeyPath("BusinessPartners", cardCode),
        data: withholdingCollectionPayload,
      });
    }
    const response = await sapService.request({
      method: "GET",
      url: sapService.buildStringKeyPath("BusinessPartners", cardCode),
    });
    res.json(await enrichBP(response.data));
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    console.error("[SAP updateBP error]", msg, JSON.stringify(err.response?.data));
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

const searchBP = async (req, res) => {
  try {
    const { query = "", type = "", top = 50, skip = 0 } = req.query;
    let databaseName = '';

    if (req.auth?.userId && req.auth?.companyId) {
      const assignedCompany = await authDbService.getAssignedCompanyForUser(req.auth.userId, req.auth.companyId);
      databaseName = String(assignedCompany?.DbName || '').trim();
    }

    const rows = await masterDataDbService.searchBP(query, type, top, skip, {
      databaseName: databaseName || undefined,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupBPGroups = async (req, res) => {
  try {
    let databaseName = '';

    if (req.auth?.userId && req.auth?.companyId) {
      const assignedCompany = await authDbService.getAssignedCompanyForUser(req.auth.userId, req.auth.companyId);
      databaseName = String(assignedCompany?.DbName || '').trim();
    }

    const rows = await businessPartnerDbService.getBusinessPartnerGroups(req.query.query || "", {
      databaseName: databaseName || undefined,
      bpType: req.query.bpType || "",
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Could not load BP groups: " + err.message });
  }
};

const lookupBPProperties = async (req, res) => {
  try {
    let databaseName = '';

    if (req.auth?.userId && req.auth?.companyId) {
      const assignedCompany = await authDbService.getAssignedCompanyForUser(req.auth.userId, req.auth.companyId);
      databaseName = String(assignedCompany?.DbName || '').trim();
    }

    const rows = await businessPartnerDbService.getBusinessPartnerProperties({
      databaseName: databaseName || undefined,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: "Could not load BP properties: " + err.message });
  }
};

const lookupPaymentTerms = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupPaymentTerms(req.query.query || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupSalesPersons = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupSalesPersons(req.query.query || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupPriceLists = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupPriceLists(req.query.query || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupCurrencies = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupCurrencies(req.query.query || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupCountries = async (req, res) => {
  try {
    const databaseName = await getRequestDatabaseName(req);
    const rows = await masterDataDbService.lookupCountries(req.query.query || "", {
      databaseName: databaseName || undefined,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupCompanyTypes = async (_req, res) => {
  try {
    const response = await sapService.request({
      method: "GET",
      url: "/$metadata",
    });

    const metadataXml = typeof response.data === "string" ? response.data : String(response.data || "");
    const members = parseMetadataEnumMembers(metadataXml, "BoCardCompanyTypes");
    const rows = members.map((value) => ({
      code: value,
      name: formatSapEnumLabel(value) || value,
    }));

    res.json(rows);
  } catch (err) {
    // Local companies have no SL $metadata; SAP's BoCardCompanyTypes values are fixed.
    if (err.response?.status === 501) {
      return res.json(["cCompany", "cPrivate", "cGovernment"].map((code) => ({ code, name: formatSapEnumLabel(code) || code })));
    }
    res.status(err.response?.status || 500).json({
      message: err.response?.data?.error?.message?.value || err.message,
    });
  }
};

const lookupCreditCards = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupCreditCards(req.query.query || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createCreditCard = async (req, res) => {
  try {
    const CreditCardName = String(req.body.CreditCardName || "").trim();
    if (!CreditCardName) {
      return res.status(400).json({ message: "Credit Card Name is required." });
    }

    const GLAccount = String(req.body.GLAccount || "").trim();
    if (!GLAccount) {
      return res.status(400).json({ message: "G/L Account is required." });
    }

    const account = await masterDataDbService.getAccount(GLAccount);
    if (!account) {
      return res.status(400).json({ message: `G/L Account "${GLAccount}" was not found.` });
    }

    const payload = {
      CreditCardName,
      GLAccount,
    };

    if (req.body.Telephone) payload.Telephone = String(req.body.Telephone).trim();
    if (req.body.CompanyID) payload.CompanyID = String(req.body.CompanyID).trim();

    const response = await sapService.request({
      method: "POST",
      url: "/CreditCards",
      data: payload,
    });

    res.status(201).json({
      code: String(response.data?.CreditCardCode ?? response.data?.CreditCard ?? ""),
      name: response.data?.CreditCardName || response.data?.CardName || CreditCardName,
      glAccount: response.data?.GLAccount || response.data?.AcctCode || payload.GLAccount || "",
      telephone: response.data?.Telephone || response.data?.Phone || payload.Telephone || "",
      companyId: response.data?.CompanyID || response.data?.CompanyId || payload.CompanyID || "",
      country: response.data?.CountryCode || response.data?.Country || "",
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message?.value || err.message;
    res.status(err.response?.status || 500).json({ message: msg });
  }
};

const lookupBanks = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupBanks(req.query.query || "", req.query.country || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupHouseBankAccounts = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupHouseBankAccounts(req.query.bankCode || "", req.query.country || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupWithholdingTaxCodes = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupWithholdingTaxCodes(req.query.query || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const lookupNumberingSeries = async (req, res) => {
  try {
    const rows = await masterDataDbService.lookupBPSeries(req.query.bpType || "");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getNextNumber = async (req, res) => {
  const { series } = req.params;
  if (String(series) === "0") {
    return res.json({
      series: "0",
      nextNumber: null,
      prefix: "",
      suffix: "",
      indicator: "",
      formattedCode: "",
      seriesName: "Manual",
      isManual: true,
    });
  }

  try {
    const row = await masterDataDbService.getBPSeriesNextNumber(series, req.query.bpType || "");
    if (!row) {
      return res.status(404).json({ message: `Series ${series} not found.` });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  createBP,
  getBP,
  updateBP,
  searchBP,
  lookupBPGroups,
  lookupBPProperties,
  lookupPaymentTerms,
  lookupSalesPersons,
  lookupPriceLists,
  lookupCurrencies,
  lookupCountries,
  lookupCompanyTypes,
  lookupCreditCards,
  createCreditCard,
  lookupBanks,
  lookupHouseBankAccounts,
  lookupWithholdingTaxCodes,
  lookupNumberingSeries,
  getNextNumber,
};
