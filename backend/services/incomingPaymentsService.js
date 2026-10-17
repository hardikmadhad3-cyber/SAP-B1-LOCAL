const db = require("./dbService");
const env = require("../config/env");
const masterDataDbService = require("./masterDataDbService");
const sapService = require("./sapService");

const queryRows = async (sql, params = {}) => {
  const result = await db.query(sql, params);
  return result.recordset || [];
};

const toDateString = (value) => {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

const toNumber = (value) => Number(value || 0);

const formatAddress = (row = {}) => {
  const structuredAddress = [
    row.AddressStreet,
    row.AddressStreetNo,
    row.AddressBlock,
    row.AddressBuilding,
    row.AddressName2,
    row.AddressName3,
    [row.AddressCity, row.AddressZipCode].filter(Boolean).join(" "),
    row.AddressState,
    row.AddressCountry,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .filter((part, index, parts) => parts.findIndex((value) => value.toLowerCase() === part.toLowerCase()) === index)
    .join("\n");
  const storedAddress = String(row.PaymentAddress || row.Address || "").trim();
  return storedAddress.length > structuredAddress.length ? storedAddress : structuredAddress || storedAddress;
};

const parseAmount = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/^INR\s*/i, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const toSapDate = (value) => {
  if (!value) return undefined;
  const raw = String(value).trim();
  const sapMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (sapMatch) return `${sapMatch[1]}-${sapMatch[2]}-${sapMatch[3]}`;

  const shortMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (shortMatch) {
    const [, day, month, year] = shortMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month}-${day}`;
  }

  return raw;
};

const cleanObject = (source = {}) => {
  const target = { ...source };
  Object.keys(target).forEach((key) => {
    if (target[key] === undefined || target[key] === "" || target[key] == null || Number.isNaN(target[key])) {
      delete target[key];
    }
  });
  return target;
};

const toOptionalNumber = (value) => {
  if (value === undefined || value === "" || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getPaymentMeansAmount = (paymentMeans = {}) =>
  parseAmount(paymentMeans.cash?.amount) +
  parseAmount(paymentMeans.transfer?.amount) +
  parseAmount(paymentMeans.cheque?.amount) +
  parseAmount(paymentMeans.creditCard?.amount);

const INCOMING_PAYMENT_INVOICE_TYPES = {
  13: { code: "IN", label: "A/R Invoice", serviceLayer: "it_Invoice" },
  14: { code: "CN", label: "A/R Credit Memo", serviceLayer: "it_CredItnote" },
  30: { code: "JE", label: "Journal Entry", serviceLayer: "it_JournalEntry" },
  [-2]: { code: "OB", label: "Opening Balance", serviceLayer: "it_OpeningBalance" },
  [-3]: { code: "OB", label: "Opening Balance", serviceLayer: "it_OpeningBalance" },
};

const getIncomingPaymentInvoiceType = (value) => {
  const numericValue = Number(value);
  return INCOMING_PAYMENT_INVOICE_TYPES[numericValue] || {
    code: numericValue ? String(numericValue) : "",
    label: numericValue ? `Transaction ${numericValue}` : "Transaction",
    serviceLayer: numericValue ? `it_${numericValue}` : "it_Invoice",
  };
};

const buildPaymentMeansPayload = async ({ paymentMeans = {}, dueAmount = 0, fallbackCashAccount = "" } = {}) => {
  const totalDue = Number(dueAmount || 0);
  const normalizedMeans = paymentMeans;
  const totalPaid = getPaymentMeansAmount(normalizedMeans);

  if (totalPaid <= 0) {
    throw new Error("Enter and confirm Payment Means before adding the incoming payment.");
  }
  if (Math.abs(totalPaid - totalDue) > 0.01) {
    throw new Error("Payment Means paid amount must match Total Amount Due.");
  }

  const cashAmount = parseAmount(normalizedMeans.cash?.amount);
  const transferAmount = parseAmount(normalizedMeans.transfer?.amount);
  const chequeAmount = parseAmount(normalizedMeans.cheque?.amount);
  const cardAmount = parseAmount(normalizedMeans.creditCard?.amount);
  const result = {};

  if (cashAmount > 0) {
    const account = String(normalizedMeans.cash?.account || fallbackCashAccount || "").trim();
    if (!account) throw new Error("Cash G/L Account is required in Payment Means.");
    result.CashAccount = account;
    result.CashSum = Number(cashAmount.toFixed(2));
  }

  if (transferAmount > 0) {
    const account = String(normalizedMeans.transfer?.account || "").trim();
    if (!account) throw new Error("Bank Transfer G/L Account is required in Payment Means.");
    result.TransferAccount = account;
    result.TransferSum = Number(transferAmount.toFixed(2));
    result.TransferDate = toSapDate(normalizedMeans.transfer?.date) || toSapDate(new Date().toISOString().slice(0, 10));
    if (normalizedMeans.transfer?.reference) result.TransferReference = String(normalizedMeans.transfer.reference).trim();
  }

  if (chequeAmount > 0) {
    const cheque = normalizedMeans.cheque || {};
    result.PaymentChecks = [cleanObject({
      DueDate: toSapDate(cheque.dueDate) || toSapDate(new Date().toISOString().slice(0, 10)),
      CheckNumber: toOptionalNumber(cheque.checkNumber),
      CheckSum: Number(chequeAmount.toFixed(2)),
      CheckAccount: String(cheque.account || fallbackCashAccount || "").trim() || undefined,
      BankCode: String(cheque.bankCode || "").trim() || undefined,
      CountryCode: String(cheque.country || "").trim() || undefined,
    })];
  }

  if (cardAmount > 0) {
    const card = normalizedMeans.creditCard || {};
    result.PaymentCreditCards = [cleanObject({
      CreditCard: toOptionalNumber(card.cardName),
      CreditAcct: String(card.account || fallbackCashAccount || "").trim() || undefined,
      CreditCardNumber: String(card.cardNumber || "").trim() || undefined,
      CardValidUntil: toSapDate(card.validUntil) || undefined,
      OwnerIdNum: String(card.idNumber || "").trim() || undefined,
      OwnerPhone: String(card.telephone || "").trim() || undefined,
      PaymentMethodCode: String(card.paymentMethod || "").trim() || undefined,
      NumOfPayments: toOptionalNumber(card.noOfPayments) || 1,
      VoucherNum: String(card.voucherNo || "").trim() || undefined,
      CreditSum: Number(cardAmount.toFixed(2)),
    })];
  }

  return result;
};

const queryBusinessPartnerRows = (cardType, trimmed, offset, pageSize, { validForColumn = "validFor", frozenForColumn = "frozenFor" } = {}) =>
  queryRows(`
    SELECT
      COUNT(*) OVER() AS TotalCount,
      T0.CardCode,
      T0.CardName,
      T0.CardFName,
      T0.Currency,
      T0.Balance,
      T0.CardType,
      T0.${validForColumn} AS ValidFor,
      T0.${frozenForColumn} AS FrozenFor,
      T0.DebPayAcct,
      T0.BillToDef,
      T0.Address,
      T0.CntctPrsn,
      T1.Address AS AddressCode,
      T1.Building AS AddressBuilding,
      T1.Street AS AddressStreet,
      T1.StreetNo AS AddressStreetNo,
      T1.Block AS AddressBlock,
      T1.City AS AddressCity,
      T1.ZipCode AS AddressZipCode,
      T1.State AS AddressState,
      T1.Country AS AddressCountry,
      T1.Address2 AS AddressName2,
      T1.Address3 AS AddressName3,
      T1.GSTRegnNo AS GstRegistrationNumber
    FROM OCRD T0
    LEFT JOIN CRD1 T1
      ON T1.CardCode = T0.CardCode
      AND T1.AdresType = 'B'
      AND T1.LineNum = (
        SELECT MIN(TX.LineNum)
        FROM CRD1 TX
        WHERE TX.CardCode = T0.CardCode
          AND TX.AdresType = 'B'
          AND (COALESCE(T0.BillToDef, '') = '' OR TX.Address = T0.BillToDef)
      )
    WHERE (@cardType = '' OR T0.CardType = @cardType)
      AND ISNULL(T0.${frozenForColumn}, 'N') <> 'Y'
      AND (@query = ''
        OR UPPER(ISNULL(T0.CardCode, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.CardName, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.CardFName, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.LicTradNum, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.Phone1, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.E_Mail, '')) LIKE @likeUpper)
    ORDER BY T0.CardName, T0.CardCode
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
  `, { cardType, query: trimmed, likeUpper: `%${trimmed.toUpperCase()}%`, offset, pageSize });

const queryBasicBusinessPartnerRows = (cardType, trimmed, offset, pageSize) =>
  queryRows(`
    SELECT
      COUNT(*) OVER() AS TotalCount,
      T0.CardCode,
      T0.CardName,
      T0.CardFName,
      T0.Currency,
      T0.Balance,
      T0.CardType,
      '' AS ValidFor,
      'N' AS FrozenFor,
      T0.DebPayAcct,
      T0.BillToDef,
      T0.Address,
      T0.CntctPrsn,
      '' AS AddressCode,
      '' AS AddressBuilding,
      '' AS AddressStreet,
      '' AS AddressStreetNo,
      '' AS AddressBlock,
      '' AS AddressCity,
      '' AS AddressZipCode,
      '' AS AddressState,
      '' AS AddressCountry,
      '' AS AddressName2,
      '' AS AddressName3,
      '' AS GstRegistrationNumber
    FROM OCRD T0
    WHERE (@cardType = '' OR T0.CardType = @cardType)
      AND (@query = ''
        OR UPPER(ISNULL(T0.CardCode, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.CardName, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.CardFName, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.LicTradNum, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.Phone1, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.E_Mail, '')) LIKE @likeUpper)
    ORDER BY T0.CardName, T0.CardCode
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
  `, { cardType, query: trimmed, likeUpper: `%${trimmed.toUpperCase()}%`, offset, pageSize });

const searchBusinessPartners = async (query = "", bpType = "Customer", requestedPage = 1, requestedPageSize = 100) => {
  const trimmed = String(query || "").trim();
  const normalizedType = String(bpType || "").toLowerCase();
  const cardType = normalizedType === "all" ? "" : normalizedType === "vendor" ? "S" : "C";
  const page = Math.max(1, Number.parseInt(requestedPage, 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(requestedPageSize, 10) || 100));
  const offset = (page - 1) * pageSize;
  let rows;
  try {
    rows = await queryBusinessPartnerRows(cardType, trimmed, offset, pageSize);
  } catch (error) {
    console.warn("[IncomingPaymentsService] BP lookup using validFor/frozenFor failed:", error.message);
    try {
      rows = await queryBusinessPartnerRows(cardType, trimmed, offset, pageSize, { validForColumn: "ValidFor", frozenForColumn: "FrozenFor" });
    } catch (fallbackError) {
      console.warn("[IncomingPaymentsService] BP lookup using ValidFor/FrozenFor failed:", fallbackError.message);
      rows = await queryBasicBusinessPartnerRows(cardType, trimmed, offset, pageSize);
    }
  }

  const items = rows.map((row) => ({
    code: row.CardCode,
    name: row.CardName,
    currency: row.Currency || "",
    controlAccount: row.DebPayAcct || "",
    billToCode: row.BillToDef || row.AddressCode || "",
    billToAddress: formatAddress(row) || row.Address || "",
    contactPerson: row.CntctPrsn || "",
    balance: toNumber(row.Balance),
    bpType: row.CardType === "S" ? "Vendor" : row.CardType === "C" ? "Customer" : "Lead",
    active: row.ValidFor === "N" || row.FrozenFor === "Y" ? "No" : "Yes",
    inactive: row.FrozenFor === "Y" ? "Yes" : "No",
    billToBlock: row.AddressBlock || "",
    billToBuilding: row.AddressBuilding || "",
    gstRegistrationNumber: row.GstRegistrationNumber || "",
  }));
  const totalCount = Number(rows[0]?.TotalCount || 0);
  return {
    items,
    pagination: { page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) },
  };
};

const lookupControlAccounts = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 100 AcctCode, AcctName
    FROM OACT
    WHERE Postable = 'Y'
      AND ISNULL(FrozenFor, 'N') <> 'Y'
      AND (@query = ''
        OR AcctCode LIKE @like
        OR AcctName LIKE @like)
    ORDER BY AcctCode
  `, { query: trimmed, like: `%${trimmed}%` });
  return rows.map((row) => ({
    code: row.AcctCode,
    name: row.AcctName,
  }));
};

const assertPostableAccount = async (accountCode = "") => {
  const rows = await queryRows(`
    SELECT TOP 1 AcctCode, AcctName, Postable, FrozenFor
    FROM OACT
    WHERE AcctCode = @accountCode
  `, { accountCode });
  const account = rows[0];
  if (!account) {
    throw new Error(`G/L Account ${accountCode} was not found.`);
  }
  if (account.Postable !== "Y") {
    throw new Error(`G/L Account ${accountCode} is a title account. Select a posting G/L account, same as SAP B1.`);
  }
  if (account.FrozenFor === "Y") {
    throw new Error(`G/L Account ${accountCode} is frozen. Select an active posting G/L account.`);
  }
};

const getBusinessPartnerControlAccount = async (cardCode = "") => {
  const rows = await queryRows(`
    SELECT TOP 1 DebPayAcct
    FROM OCRD
    WHERE CardCode = @cardCode
  `, { cardCode });
  return String(rows[0]?.DebPayAcct || "").trim();
};

const lookupCashAccounts = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 100 AcctCode, AcctName
    FROM OACT
    WHERE Postable = 'Y'
      AND ISNULL(FrozenFor, 'N') <> 'Y'
      AND ISNULL(CashBox, 'N') = 'Y'
      AND (@query = ''
        OR AcctCode LIKE @like
        OR AcctName LIKE @like)
    ORDER BY AcctCode
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({
    code: row.AcctCode,
    name: row.AcctName,
  }));
};

const lookupPaymentMeansAccounts = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 100 AcctCode, AcctName
    FROM OACT
    WHERE Postable = 'Y'
      AND ISNULL(FrozenFor, 'N') <> 'Y'
      AND (@query = ''
        OR AcctCode LIKE @like
        OR AcctName LIKE @like)
    ORDER BY
      CASE
        WHEN AcctName LIKE '%cash%' THEN 0
        WHEN AcctName LIKE '%bank%' THEN 1
        ELSE 2
      END,
      AcctCode
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({
    code: row.AcctCode,
    name: row.AcctName,
  }));
};

const getDefaultCashAccount = async () => {
  const configured = String(env.incomingPaymentCashAccount || "").trim();
  if (configured) return configured;

  const cashBoxRows = await lookupCashAccounts("");
  if (cashBoxRows[0]?.code) return cashBoxRows[0].code;

  const paymentMeansRows = await lookupPaymentMeansAccounts("");
  return paymentMeansRows[0]?.code || "";
};

const getPaymentSeries = async () => {
  const rows = await queryRows(`
    SELECT
      T0.Series,
      T0.SeriesName,
      T0.Indicator,
      T0.NextNumber,
      CASE
        WHEN T1.AbsEntry IS NOT NULL THEN 1
        ELSE 0
      END AS IsCurrentPeriod
    FROM NNM1 T0
    LEFT JOIN OFPR T1
      ON T1.Indicator = T0.Indicator
      AND CONVERT(date, GETDATE()) BETWEEN T1.F_RefDate AND T1.T_RefDate
    WHERE T0.ObjectCode = '24'
      AND T0.Locked = 'N'
    ORDER BY
      CASE WHEN T1.AbsEntry IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN ISNULL(T0.Indicator, '') <> '' THEN 0 ELSE 1 END,
      T0.Series
  `);

  return rows.map((row, index) => ({
    code: String(row.Series || ""),
    name: row.Indicator || row.SeriesName || String(row.Series || ""),
    seriesName: row.SeriesName || "",
    indicator: row.Indicator || "",
    nextNumber: row.NextNumber ? String(row.NextNumber) : "",
    isDefault: row.IsCurrentPeriod === 1 || index === 0,
  }));
};

const searchIncomingPayments = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 500
      T0.DocEntry,
      T0.DocNum,
      T0.DocDate,
      T0.TaxDate,
      T0.CardCode,
      T0.CardName,
      T0.Address AS PaymentAddress,
      T0.CounterRef,
      T0.TransId,
      T0.BPLId,
      T0.JrnlMemo,
      T0.DocTotal,
      T0.NoDocSum,
      BP.BillToDef,
      BP.Address,
      AD.Address AS AddressCode,
      AD.Building AS AddressBuilding,
      AD.Street AS AddressStreet,
      AD.StreetNo AS AddressStreetNo,
      AD.Block AS AddressBlock,
      AD.City AS AddressCity,
      AD.ZipCode AS AddressZipCode,
      AD.State AS AddressState,
      AD.Country AS AddressCountry,
      AD.Address2 AS AddressName2,
      AD.Address3 AS AddressName3
    FROM ORCT T0
    LEFT JOIN OCRD BP ON BP.CardCode = T0.CardCode
    LEFT JOIN CRD1 AD
      ON AD.CardCode = BP.CardCode
      AND AD.AdresType = 'B'
      AND AD.LineNum = (
        SELECT MIN(TX.LineNum)
        FROM CRD1 TX
        WHERE TX.CardCode = BP.CardCode
          AND TX.AdresType = 'B'
          AND (COALESCE(BP.BillToDef, '') = '' OR TX.Address = BP.BillToDef)
      )
    WHERE T0.Canceled <> 'Y'
      AND (@query = ''
        OR UPPER(CAST(T0.DocNum AS NVARCHAR(30))) LIKE @likeUpper
        OR UPPER(ISNULL(T0.CardCode, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.CardName, '')) LIKE @likeUpper
        OR UPPER(ISNULL(T0.CounterRef, '')) LIKE @likeUpper
        OR UPPER(CAST(ISNULL(T0.TransId, 0) AS NVARCHAR(30))) LIKE @likeUpper)
    ORDER BY T0.DocDate DESC, T0.DocNum DESC
  `, { query: trimmed, likeUpper: `%${trimmed.toUpperCase()}%` });

  return rows.map((row) => ({
    code: String(row.DocNum || ""),
    docEntry: row.DocEntry,
    documentNo: String(row.DocNum || ""),
    postingDate: toDateString(row.DocDate),
    dueDate: toDateString(row.DocDate),
    documentDate: toDateString(row.TaxDate || row.DocDate),
    businessPartnerCode: row.CardCode || "",
    businessPartnerName: row.CardName || "",
    billToCode: row.BillToDef || row.AddressCode || "",
    billToAddress: formatAddress(row),
    referenceNumber: row.CounterRef || "",
    transactionNumber: row.TransId ? String(row.TransId) : "",
    branch: row.BPLId ? String(row.BPLId) : "",
    journalRemarks: row.JrnlMemo || "",
    totalAmount: toNumber(row.DocTotal),
    paymentOnAccountAmount: toNumber(row.NoDocSum),
  }));
};

const getIncomingPaymentByDocEntry = async (docEntry) => {
  const docEntryNumber = Number(docEntry || 0);
  if (!docEntryNumber) {
    throw new Error("Incoming payment DocEntry is required.");
  }

  const headerRows = await queryRows(`
    SELECT TOP 1
      T0.DocEntry,
      T0.DocNum,
      T0.DocDate,
      T0.TaxDate,
      T0.CardCode,
      T0.CardName,
      T0.Address AS PaymentAddress,
      T0.CounterRef,
      T0.TransId,
      T0.BPLId,
      T0.JrnlMemo,
      T0.Comments,
      T0.DocTotal,
      T0.NoDocSum,
      BP.BillToDef,
      BP.Address,
      AD.Address AS AddressCode,
      AD.Building AS AddressBuilding,
      AD.Street AS AddressStreet,
      AD.StreetNo AS AddressStreetNo,
      AD.Block AS AddressBlock,
      AD.City AS AddressCity,
      AD.ZipCode AS AddressZipCode,
      AD.State AS AddressState,
      AD.Country AS AddressCountry,
      AD.Address2 AS AddressName2,
      AD.Address3 AS AddressName3
    FROM ORCT T0
    LEFT JOIN OCRD BP ON BP.CardCode = T0.CardCode
    LEFT JOIN CRD1 AD
      ON AD.CardCode = BP.CardCode
      AND AD.AdresType = 'B'
      AND AD.LineNum = (
        SELECT MIN(TX.LineNum)
        FROM CRD1 TX
        WHERE TX.CardCode = BP.CardCode
          AND TX.AdresType = 'B'
          AND (COALESCE(BP.BillToDef, '') = '' OR TX.Address = BP.BillToDef)
      )
    WHERE T0.DocEntry = @docEntry
  `, { docEntry: docEntryNumber });

  const header = headerRows[0];
  if (!header) {
    throw new Error("Incoming payment was not found.");
  }

  const invoiceRows = await queryRows(`
    SELECT
      T1.DocEntry AS BaseDocEntry,
      T1.InvType,
      T1.InstId,
      T1.SumApplied,
      COALESCE(CAST(T2.DocNum AS NVARCHAR(30)), CAST(T4.DocNum AS NVARCHAR(30)), CAST(T5.Number AS NVARCHAR(30)), CAST(T1.DocEntry AS NVARCHAR(30))) AS DocNum,
      COALESCE(T2.DocDate, T4.DocDate, T5.RefDate) AS DocDate,
      COALESCE(T2.DocDueDate, T4.DocDueDate, T5.DueDate) AS DocDueDate,
      COALESCE(T2.DocTotal, T4.DocTotal, ABS(T1.SumApplied)) AS DocTotal,
      COALESCE(T2.DocTotal - T2.PaidToDate, -1 * (T4.DocTotal - T4.PaidToDate), T6.BalDueDeb - T6.BalDueCred, T1.SumApplied) AS BalanceDue,
      COALESCE(T2.DocCur, T4.DocCur, T6.FCCurrency) AS DocCur,
      COALESCE(T2.Project, T4.Project, T6.Project) AS Project,
      COALESCE(T2.PaymentRef, T4.PaymentRef, '') AS PaymentRef,
      COALESCE(T2.BPLId, T4.BPLId, T6.BPLId) AS BPLId,
      T3.BPLName
    FROM RCT2 T1
    LEFT JOIN OINV T2 ON T2.DocEntry = T1.DocEntry AND T1.InvType = 13
    LEFT JOIN ORIN T4 ON T4.DocEntry = T1.DocEntry AND T1.InvType = 14
    LEFT JOIN OJDT T5 ON T5.TransId = T1.DocEntry AND T1.InvType IN (30, -2, -3)
    LEFT JOIN JDT1 T6 ON T6.TransId = T1.DocEntry AND T6.ShortName = @cardCode AND T1.InvType IN (30, -2, -3)
    LEFT JOIN OBPL T3 ON T3.BPLId = COALESCE(T2.BPLId, T4.BPLId, T6.BPLId)
    WHERE T1.DocNum = @docEntry
    ORDER BY T1.DocEntry, T1.InvType, T1.InstId
  `, { docEntry: docEntryNumber, cardCode: header.CardCode || "" });

  const accountRows = await queryRows(`
    SELECT
      T1.AcctCode,
      T2.AcctName,
      T1.Descrip,
      T1.SumApplied,
      T1.OcrCode,
      T1.LocCode
    FROM RCT4 T1
    LEFT JOIN OACT T2 ON T2.AcctCode = T1.AcctCode
    WHERE T1.DocNum = @docEntry
    ORDER BY T1.AcctCode, T1.Descrip
  `, { docEntry: docEntryNumber });

  return {
    code: String(header.DocNum || ""),
    docEntry: header.DocEntry,
    documentNo: String(header.DocNum || ""),
    postingDate: toDateString(header.DocDate),
    dueDate: toDateString(header.DocDate),
    documentDate: toDateString(header.TaxDate || header.DocDate),
    businessPartnerCode: header.CardCode || "",
    businessPartnerName: header.CardName || "",
    billToCode: header.BillToDef || header.AddressCode || "",
    billToAddress: formatAddress(header),
    referenceNumber: header.CounterRef || "",
    transactionNumber: header.TransId ? String(header.TransId) : "",
    branch: header.BPLId ? String(header.BPLId) : "",
    journalRemarks: header.JrnlMemo || "",
    remarks: header.Comments || "",
    totalAmount: toNumber(header.DocTotal),
    paymentOnAccountAmount: toNumber(header.NoDocSum),
    invoices: invoiceRows.map((row, index) => {
      const type = getIncomingPaymentInvoiceType(row.InvType);
      return {
        id: `posted-${row.InvType || ""}-${row.BaseDocEntry || index}-${index}`,
        docEntry: row.BaseDocEntry,
        invoiceTypeCode: Number(row.InvType || 0),
        invoiceType: type.serviceLayer,
        documentTypeCode: type.code,
        documentNo: String(row.DocNum || row.BaseDocEntry || ""),
        installment: row.InstId ? String(row.InstId) : "1",
        documentType: type.label,
        date: toDateString(row.DocDate),
        dueDate: toDateString(row.DocDueDate),
        total: toNumber(row.DocTotal || row.SumApplied),
        balanceDue: toNumber(row.BalanceDue),
        totalPayment: toNumber(row.SumApplied),
        distributionRule: row.Project || "",
        overdueDays: 0,
        paymentOrderRun: row.PaymentRef || "",
        branch: row.BPLId ? String(row.BPLId) : "",
        branchName: row.BPLName || "",
        branchDisplay: row.BPLId ? `${row.BPLId} - ${row.BPLName || ""}`.trim() : "",
        currency: row.DocCur || "",
        selected: true,
        cashDiscountPercent: "0.00",
      };
    }),
    accountRows: accountRows.map((row, index) => ({
      id: `account-${row.AcctCode || index}-${index}`,
      accountCode: row.AcctCode || "",
      accountName: row.AcctName || "",
      remarks: row.Descrip || "",
      amount: toNumber(row.SumApplied),
      distributionRule: row.OcrCode || "",
      location: row.LocCode != null ? String(row.LocCode) : "",
      branch: header.BPLId ? String(header.BPLId) : "",
    })),
  };
};

const getReferenceData = async () => {
  const [branches, series, defaultCashAccount, distributionRules, locations] = await Promise.all([
    masterDataDbService.lookupBusinessPlaces(),
    getPaymentSeries(),
    getDefaultCashAccount(),
    masterDataDbService.lookupDistributionRules(),
    masterDataDbService.lookupWarehouseLocations(),
  ]);
  const defaultSeries = series.find((item) => item.isDefault) || series[0] || null;

  return {
    branches,
    series,
    defaultSeriesCode: defaultSeries?.code || "",
    defaultSeriesName: defaultSeries?.name || "",
    nextDocumentNumber: defaultSeries?.nextNumber || "",
    nextTransactionNumber: defaultSeries?.nextNumber || "",
    defaultCashAccount,
    distributionRules: (distributionRules || []).map((rule) => ({
      code: String(rule.code || rule.FactorCode || rule.OcrCode || ""),
      name: rule.name || rule.FactorDescription || rule.OcrName || "",
    })).filter((rule) => rule.code),
    locations,
  };
};

const getOpenInvoices = async (cardCode, branch = "") => {
  if (!cardCode) return [];
  const branchId = Number(branch || 0);

  const rows = await queryRows(`
    SELECT TOP 200
      OpenRows.DocEntry,
      OpenRows.DocNum,
      OpenRows.LineId,
      OpenRows.InvoiceTypeCode,
      OpenRows.DocDate,
      OpenRows.DocDueDate,
      OpenRows.DocTotal,
      OpenRows.BalanceDue,
      OpenRows.DocCur,
      OpenRows.BPLId,
      OpenRows.NumAtCard,
      OpenRows.Project,
      OpenRows.PaymentRef,
      OpenRows.JrnlMemo,
      OpenRows.CtlAccount,
      OpenRows.BPLName,
      DATEDIFF(DAY, OpenRows.DocDueDate, GETDATE()) AS OverdueDays
    FROM (
      SELECT
        T0.DocEntry,
        CAST(T0.DocNum AS NVARCHAR(30)) AS DocNum,
        0 AS LineId,
        13 AS InvoiceTypeCode,
        T0.DocDate,
        T0.DocDueDate,
        T0.DocTotal,
        T0.DocTotal - T0.PaidToDate AS BalanceDue,
        T0.DocCur,
        T0.BPLId,
        T0.NumAtCard,
        T0.Project,
        T0.PaymentRef,
        T0.JrnlMemo,
        T0.CtlAccount,
        T1.BPLName
      FROM OINV T0
      LEFT JOIN OBPL T1 ON T1.BPLId = T0.BPLId
      WHERE T0.CardCode = @cardCode
        AND (@branchId = 0 OR T0.BPLId = @branchId)
        AND T0.DocStatus = 'O'
        AND T0.CANCELED <> 'Y'
        AND (T0.DocTotal - T0.PaidToDate) > 0

      UNION ALL

      SELECT
        T0.DocEntry,
        CAST(T0.DocNum AS NVARCHAR(30)) AS DocNum,
        0 AS LineId,
        14 AS InvoiceTypeCode,
        T0.DocDate,
        T0.DocDueDate,
        T0.DocTotal,
        -1 * (T0.DocTotal - T0.PaidToDate) AS BalanceDue,
        T0.DocCur,
        T0.BPLId,
        T0.NumAtCard,
        T0.Project,
        T0.PaymentRef,
        T0.JrnlMemo,
        T0.CtlAccount,
        T1.BPLName
      FROM ORIN T0
      LEFT JOIN OBPL T1 ON T1.BPLId = T0.BPLId
      WHERE T0.CardCode = @cardCode
        AND (@branchId = 0 OR T0.BPLId = @branchId)
        AND T0.DocStatus = 'O'
        AND T0.CANCELED <> 'Y'
        AND (T0.DocTotal - T0.PaidToDate) > 0

      UNION ALL

      SELECT
        T0.TransId AS DocEntry,
        ISNULL(T0.BaseRef, CAST(T1.Number AS NVARCHAR(30))) AS DocNum,
        T0.Line_ID AS LineId,
        CASE WHEN T0.TransType IN (-2, -3) THEN -2 ELSE 30 END AS InvoiceTypeCode,
        T0.RefDate AS DocDate,
        T0.DueDate AS DocDueDate,
        CAST(ISNULL(T0.BalDueDeb, 0) - ISNULL(T0.BalDueCred, 0) AS DECIMAL(19, 6)) AS DocTotal,
        CAST(ISNULL(T0.BalDueDeb, 0) - ISNULL(T0.BalDueCred, 0) AS DECIMAL(19, 6)) AS BalanceDue,
        T0.FCCurrency AS DocCur,
        T0.BPLId,
        T1.Ref1 AS NumAtCard,
        T0.Project,
        '' AS PaymentRef,
        T1.Memo AS JrnlMemo,
        T0.Account AS CtlAccount,
        T2.BPLName
      FROM JDT1 T0
      INNER JOIN OJDT T1 ON T1.TransId = T0.TransId
      LEFT JOIN OBPL T2 ON T2.BPLId = T0.BPLId
      WHERE T0.ShortName = @cardCode
        AND (@branchId = 0 OR T0.BPLId = @branchId)
        AND ISNULL(T0.TransType, 30) NOT IN (13, 14, 24, 46)
        AND ABS(ISNULL(T0.BalDueDeb, 0) - ISNULL(T0.BalDueCred, 0)) > 0.000001
    ) OpenRows
    ORDER BY OpenRows.DocDueDate, OpenRows.DocNum
  `, { cardCode, branchId });

  return rows.map((row) => {
    const type = getIncomingPaymentInvoiceType(row.InvoiceTypeCode);
    return {
      id: `${row.InvoiceTypeCode || ""}-${row.DocEntry}-${row.LineId || 0}`,
      docEntry: row.DocEntry,
      invoiceTypeCode: Number(row.InvoiceTypeCode || 0),
      invoiceType: type.serviceLayer,
      documentTypeCode: type.code,
      documentNo: String(row.DocNum || ""),
      installment: "1",
      documentType: type.label,
      date: toDateString(row.DocDate),
      dueDate: toDateString(row.DocDueDate),
      total: toNumber(row.DocTotal),
      balanceDue: toNumber(row.BalanceDue),
      totalPayment: toNumber(row.BalanceDue),
      distributionRule: row.Project || "",
      overdueDays: Math.max(0, toNumber(row.OverdueDays)),
      paymentOrderRun: row.PaymentRef || "",
      branch: row.BPLId ? String(row.BPLId) : "",
      branchName: row.BPLName || "",
      branchDisplay: row.BPLId ? `${row.BPLId} - ${row.BPLName || ""}`.trim() : "",
      reference: row.NumAtCard || "",
      controlAccount: row.CtlAccount || "",
      currency: row.DocCur || "",
      journalMemo: row.JrnlMemo || "",
    };
  });
};

const createIncomingPayment = async (payload = {}) => {
  const header = payload.header || {};
  const invoices = Array.isArray(payload.invoices) ? payload.invoices : [];
  const paymentOnAccount = payload.paymentOnAccount || {};

  const cardCode = String(header.businessPartnerCode || "").trim();
  const defaultCashAccount = String(header.cashAccount || await getDefaultCashAccount()).trim();
  if (!cardCode) {
    throw new Error("Business Partner is required.");
  }

  const selectedInvoices = invoices
    .map((invoice) => ({
      ...invoice,
      appliedAmount: parseAmount(invoice.totalPayment),
      balanceDue: parseAmount(invoice.balanceDue),
      invoiceType: invoice.invoiceType || getIncomingPaymentInvoiceType(invoice.invoiceTypeCode).serviceLayer,
    }))
    .filter((invoice) => Number(invoice.docEntry) > 0 && Math.abs(invoice.appliedAmount) > 0.01);

  const overAppliedInvoice = selectedInvoices.find(
    (invoice) => Math.abs(invoice.balanceDue) > 0.01 && Math.abs(invoice.appliedAmount) - Math.abs(invoice.balanceDue) > 0.01,
  );
  if (overAppliedInvoice) {
    throw new Error(`Payment amount is greater than invoice amount for document ${overAppliedInvoice.documentNo || overAppliedInvoice.docEntry}.`);
  }

  const paymentOnAccountAmount = paymentOnAccount.enabled ? parseAmount(paymentOnAccount.amount) : 0;
  const accountDistributionRule = String(paymentOnAccount.distributionRule || paymentOnAccount.distRule || "").trim();
  const accountLocation = String(paymentOnAccount.location || paymentOnAccount.loc || paymentOnAccount.locCode || "").trim();
  const accountLocationCode = Number(accountLocation);
  const appliedTotal = selectedInvoices.reduce((sum, invoice) => sum + invoice.appliedAmount, 0);
  const dueAmount = appliedTotal + paymentOnAccountAmount;
  const isAccountPayment = header.bpType === "Account";
  let controlAccount = String(header.controlAccount || "").trim();

  if (dueAmount <= 0) {
    throw new Error("Incoming payment amount must be greater than zero.");
  }

  if (isAccountPayment && paymentOnAccountAmount <= 0) {
    throw new Error("Payment on Account amount is required for Account incoming payments.");
  }
  if (isAccountPayment) {
    await assertPostableAccount(cardCode);
  } else if (paymentOnAccountAmount > 0 && !controlAccount) {
    controlAccount = await getBusinessPartnerControlAccount(cardCode);
    if (!controlAccount) {
      throw new Error("Control Account is required for a Payment on Account.");
    }
  }

  const paymentMeansPayload = await buildPaymentMeansPayload({
    paymentMeans: payload.paymentMeans || {},
    dueAmount,
    fallbackCashAccount: defaultCashAccount,
  });

  const sapPayload = {
    DocType: header.bpType === "Vendor" ? "rSupplier" : isAccountPayment ? "rAccount" : "rCustomer",
    CardCode: isAccountPayment ? undefined : cardCode,
    DocDate: toSapDate(header.postingDate),
    DueDate: toSapDate(header.dueDate || header.postingDate),
    TaxDate: toSapDate(header.documentDate || header.postingDate),
    VatDate: toSapDate(header.documentDate || header.postingDate),
    DocCurrency: selectedInvoices.find((invoice) => invoice.currency)?.currency || header.docCurrency || undefined,
    PaymentType: "bopt_None",
    Series: header.seriesCode && header.seriesCode !== "Manual" ? Number(header.seriesCode) : undefined,
    DocNum: header.seriesCode === "Manual" && header.documentNumber ? Number(header.documentNumber) : undefined,
    BPLID: Number(header.branch) > 0 ? Number(header.branch) : undefined,
    CounterReference: header.referenceNumber || undefined,
    ControlAccount: !isAccountPayment ? controlAccount || undefined : undefined,
    Remarks: payload.remarks || undefined,
    JournalRemarks: payload.journalRemarks || undefined,
    ...paymentMeansPayload,
    PaymentInvoices: !isAccountPayment && selectedInvoices.length
      ? selectedInvoices.map((invoice) => ({
          DocEntry: Number(invoice.docEntry),
          InvoiceType: invoice.invoiceType || "it_Invoice",
          SumApplied: Number(invoice.appliedAmount.toFixed(2)),
          DiscountPercent: parseAmount(invoice.cashDiscountPercent),
          DistributionRule: String(invoice.distributionRule || "").trim() || undefined,
        }))
      : undefined,
    PaymentAccounts: isAccountPayment
      ? [{
          AccountCode: cardCode,
          SumPaid: Number(paymentOnAccountAmount.toFixed(2)),
          GrossAmount: Number(paymentOnAccountAmount.toFixed(2)),
          Decription: paymentOnAccount.remarks || payload.remarks || undefined,
          ProfitCenter: accountDistributionRule || undefined,
          LocationCode: accountLocation && Number.isFinite(accountLocationCode) ? accountLocationCode : undefined,
        }]
      : undefined,
  };

  Object.keys(sapPayload).forEach((key) => {
    if (sapPayload[key] === undefined || sapPayload[key] === "") delete sapPayload[key];
  });

  console.log("[IncomingPaymentsService] SAP Incoming Payment payload:", JSON.stringify(sapPayload, null, 2));

  const response = await sapService.request({
    method: "post",
    url: "/IncomingPayments",
    data: sapPayload,
  });

  console.log("[IncomingPaymentsService] SAP Incoming Payment response:", JSON.stringify(response.data, null, 2));

  return {
    message: "Incoming payment created successfully",
    doc_num: response.data?.DocNum,
    doc_entry: response.data?.DocEntry,
    DocNum: response.data?.DocNum,
    DocEntry: response.data?.DocEntry,
    sapPayload,
  };
};

module.exports = {
  createIncomingPayment,
  getReferenceData,
  getOpenInvoices,
  getIncomingPaymentByDocEntry,
  lookupCashAccounts,
  lookupControlAccounts,
  searchIncomingPayments,
  searchBusinessPartners,
};
