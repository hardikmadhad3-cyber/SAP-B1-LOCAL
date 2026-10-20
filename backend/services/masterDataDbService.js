const db = require("./dbService");
const { appendSapSearchCondition } = require("./documentListUtils");
const { escapeLikeValue, LIKE_ESCAPE_SQL, createTableFieldMetadataReader } = require('./salesDocumentDbCompatibility');
const { aggregatePayableTaxRates } = require('./documentTaxUtils');
const readTaxAuthorityMetadata = createTableFieldMetadataReader({ database: db });

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toYesNo = (value) => (String(value || "").toUpperCase() === "Y" ? "tYES" : "tNO");
const toCardType = (value) => {
  const code = String(value || "").toUpperCase();
  if (code === "C") return "cCustomer";
  if (code === "S") return "cSupplier";
  if (code === "L") return "cLead";
  return "cCustomer";
};

const toCompanyPrivate = (value) => (String(value || "").toUpperCase() === "P" ? "cPrivate" : "cCompany");
const toBPGstType = (value) => {
  if (value == null || value === "") return "";
  if (typeof value === "string" && value.startsWith("gst")) return value;

  const map = {
    0: "invalid",
    1: "gstRegularTDSISD",
    2: "gstCasualTaxablePerson",
    3: "gstCompositionLevy",
    4: "gstGoverDepartPSU",
    5: "gstNonResidentTaxablePerson",
    6: "gstUNAgencyEmbassy",
  };

  return map[Number(value)] || "";
};

const toAccountType = (groupMask) => {
  const map = {
    1: "sat_Assets",
    2: "sat_Liabilities",
    3: "sat_Equity",
    4: "sat_Revenues",
    5: "sat_Expenditure",
    6: "sat_Other",
  };
  return map[Number(groupMask)] || "sat_Other";
};

const toRoundingMethod = (value) => {
  const map = {
    0: "borm_NoRounding",
    1: "borm_Ceiling",
    2: "borm_Floor",
    3: "borm_Commercial",
    4: "borm_HalfUp",
    5: "borm_HalfDown",
  };
  return map[Number(value)] || "borm_NoRounding";
};

// SDK OCTG.BslineDate: P posting, S system, T document date, C closing.
const toBaselineDate = (value) => {
  const map = {
    P: "bld_PostingDate",
    S: "bld_SystemDate",
    T: "bld_DueDate",
    C: "bld_ClosingDate",
  };
  return map[String(value || "").toUpperCase()] || "bld_PostingDate";
};

const toTreeType = (value) => {
  const map = {
    P: "iProductionTree",
    S: "iSalesTree",
    T: "iTemplateTree",
    A: "iAssemblyTree",
  };
  return map[String(value || "").toUpperCase()] || "iProductionTree";
};

const toIssueMethod = (value) => {
  const map = {
    M: "im_Manual",
    B: "im_Backflush",
  };
  return map[String(value || "").toUpperCase()] || "im_Manual";
};

const toItemType = (value) => {
  if (typeof value === "string" && value.startsWith("pit_")) return value;
  const map = {
    4: "pit_Item",
    290: "pit_Resource",
  };
  return map[Number(value)] || "pit_Item";
};

const pagingParams = (top, skip) => ({
  top: Math.max(1, toInt(top, 50)),
  skip: Math.max(0, toInt(skip, 0)),
});

const queryRows = async (sql, params = {}, options = {}) => {
  const result = await db.query(sql, params, options);
  return result.recordset || [];
};

const queryOne = async (sql, params = {}, options = {}) => {
  const rows = await queryRows(sql, params, options);
  return rows[0] || null;
};

const mapBranch = (row) => ({
  ...(row.SlExtra || {}),
  BPLID: row.BPLId,
  BPLName: row.BPLName || "",
  BPLNameForeign: row.BPLFrName || "",
  VATRegNum: row.VATRegNum || row.TaxIdNum || "",
  RepName: row.RepName || "",
  Industry: row.Industry || "",
  MainBPL: toYesNo(row.MainBPL),
  Disabled: toYesNo(row.Disabled),
  Address: row.Address || "",
  Street: row.Street || "",
  StreetNo: row.StreetNo || "",
  Block: row.Block || "",
  Building: row.Building || "",
  ZipCode: row.ZipCode || "",
  City: row.City || "",
  State: row.State || "",
  County: row.County || "",
  Country: row.Country || "",
  DflWhs: row.DflWhs || "",
  TaxIdNum: row.TaxIdNum || "",
  // The names the Branch page sends, so a loaded branch fills the same fields.
  DefaultWarehouseCode: row.DflWhs || "",
  FederalTaxID: row.TaxIdNum || "",
  AdditionalID: row.AddtnlId || "",
  TaxOfficeName: row.TaxOffice || "",
  GSTIN: row.GSTRegnNo || "",
  GSTType: row.GSTType || "",
});

const mapWarehouse = (row) => ({
  WarehouseCode: row.WhsCode || "",
  WarehouseName: row.WhsName || "",
  DropShip: toYesNo(row.DropShip),
  Nettable: toYesNo(row.Nettable),
  Inactive: toYesNo(row.Inactive),
  AllowUseTax: toYesNo(row.UseTax),
  Excisable: toYesNo(row.Excisable),
  ManageSerialAndBatchNumbers: toYesNo(row.ManageSnB),
  Location: row.Location ?? "",
  BusinessPlaceID: row.BPLid ?? "",
  TaxGroup: row.VatGroup || "",
  FederalTaxID: row.FedTaxID || "",
  GlobalLocationNumber: row.GlblLocNum || "",
  WHShipToName: row.WhShipTo || "",
  Storekeeper: row.StorKeeper || "",
  Shipper: row.Shipper || "",
  EnableBinLocations: toYesNo(row.BinActivat),
  BinLocCodeSeparator: row.BinSeptor || "-",
  DefaultBin: row.DftBinAbs ?? "",
  DefaultBinEnforced: toYesNo(row.DftBinEnfd),
  Street: row.Street || "",
  StreetNo: row.StreetNo || "",
  Block: row.Block || "",
  BuildingFloorRoom: row.Building || "",
  City: row.City || "",
  ZipCode: row.ZipCode || "",
  County: row.County || "",
  State: row.State || "",
  Country: row.Country || "",
  AddressType: row.AddrType || "",
  AddressName2: row.Address2 || "",
  AddressName3: row.Address3 || "",
  StockAccount: row.BalInvntAc || "",
  DecreasingAccount: row.DecreasAc || "",
  IncreasingAcc: row.IncreasAc || "",
  CostOfGoodsSold: row.SaleCostAc || "",
  TransfersAcc: row.TransferAc || "",
  PriceDifferencesAccount: row.PriceDifAc || "",
  VarianceAccount: row.VarianceAc || "",
  NegativeInventoryAdjustmentAccount: row.NegStckAct || "",
  PurchaseAccount: row.PurchaseAc || "",
  PurchaseReturningAccount: row.PAReturnAc || "",
  PurchaseOffsetAccount: row.PurchOfsAc || "",
  ExpenseAccount: row.ExpensesAc || "",
  ExpensesClearingAccount: row.ExpClrAct || "",
  GoodsClearingAcc: row.BalanceAcc || "",
  RevenuesAccount: row.RevenuesAc || "",
  ReturningAccount: row.ReturnAc || "",
  ExemptRevenuesAccount: row.ExmptIncom || "",
  ExpenseOffsetingAct: row.ExpOfstAct || "",
  WIPMaterialAccount: row.WipAcct || "",
  WIPMaterialVarianceAccount: row.WipVarAcct || "",
  WipOffsetProfitAndLossAccount: row.WipOffset || "",
  InventoryOffsetProfitAndLossAccount: row.StockOffst || "",
  ForeignRevenuesAcc: row.FrRevenuAc || "",
  EURevenuesAccount: row.EURevenuAc || "",
  ForeignExpensesAccount: row.FrExpensAc || "",
  EUExpensesAccount: row.EUExpensAc || "",
  ExchangeRateDifferencesAccount: row.ExchangeAc || "",
  StockInflationAdjustAccount: row.StokRvlAct || "",
  StockInflationOffsetAccount: row.StkOffsAct || "",
  CostInflationAccount: row.CostRvlAct || "",
  CostInflationOffsetAccount: row.CstOffsAct || "",
  ShippedGoodsAccount: row.ShpdGdsAct || "",
  StockInTransitAccount: row.StkInTnAct || "",
  PurchaseBalanceAccount: row.PurBalAct || "",
  PurchaseCreditAcc: row.APCMAct || "",
  EUPurchaseCreditAcc: row.APCMEUAct || "",
  ForeignPurchaseCreditAcc: row.APCMFrnAct || "",
  SalesCreditAcc: row.ARCMAct || "",
  SalesCreditEUAcc: row.ARCMEUAct || "",
  SalesCreditForeignAcc: row.ARCMFrnAct || "",
  ExemptedCredits: row.RevRetAct || "",
  VATInRevenueAccount: row.VatRevAct || "",
  WHIncomingCenvatAccount: row.WhICenAct || "",
  WHOutgoingCenvatAccount: row.WhOCenAct || "",
  IncreaseGLAccount: row.IncresGlAc || "",
  DecreaseGLAccount: row.DecresGlAc || "",
  AutoAllocOnIssue: row.AutoIssMtd === 1 ? "whsBinSingleChoiceOnly" : "whsBinSingleChoiceOnly",
  AutoAllocOnReceipt: row.AutoRecvMd === 1 ? "aaormOnEveryTransaction" : "aaormDefaultBin",
  EnableReceivingBinLocations: toYesNo(row.RecBinEnab),
  ReceivingBinLocationsBy: row.RecItemsBy === 1 ? "rblmAlternativeSortCodeOrder" : "rblmBinLocationCodeOrder",
  RestrictReceiptToEmptyBinLocation: row.RecvUpTo === "1" ? "tYES" : "tNO",
  ReceiveUpToMaxQuantity: toYesNo(row.RecvMaxQty),
  ReceiveUpToMaxWeight: toYesNo(row.RecvMaxWT),
  ReceiveUpToMethod: row.RecvUpTo === "1" ? "rutmMaximumWeight" : "rutmMaximumQty",
});

// SDK OCTG.PayDuMonth (Start From): E month end, H half month, Y month start, N selected day.
const toStartFrom = (value) => ({
  E: "ptsf_MonthEnd",
  H: "ptsf_HalfMonth",
  Y: "ptsf_MonthStart",
}[String(value || "").toUpperCase()] || "ptsf_DayOfMonth");

const mapPaymentTerms = (row, installments = []) => ({
  GroupNumber: row.GroupNum,
  // PymntCode/LoadLimit are local columns; SAP-connected companies fall back to GroupNum.
  PaymentTermsGroupCode: row.PymntCode || String(row.GroupNum),
  PaymentTermsGroupName: row.PymntGroup || "",
  BaselineDate: toBaselineDate(row.BslineDate),
  StartFrom: toStartFrom(row.PayDuMonth),
  CashDiscountPercent: row.VolumDscnt ?? 0,
  DiscountCode: row.DiscCode || "",
  PaymentMethod: row.PymCode || "",
  NumberOfAdditionalMonths: row.ExtraMonth ?? 0,
  NumberOfAdditionalDays: row.ExtraDays ?? 0,
  ToleranceDays: row.TolDays ?? 0,
  NumberOfInstallments: installments.length || row.InstNum || 1,
  OpenIncomingPaymentsByDueDate: toYesNo(row.OpenRcpt),
  CreditLimit: row.CredLimit ?? 0,
  LoadLimitCredit: toYesNo(row.LoadLimit),
  PriceListNo: row.ListNum ?? "",
  PaymentTermsInstallments: installments,
});

const mapUoMGroup = (row, lines = []) => ({
  AbsEntry: row.UgpEntry,
  Code: row.UgpCode || "",
  Name: row.UgpName || "",
  BaseUoM: row.BaseUom ?? "",
  BaseUoMCode: row.BaseUoMCode || "",
  UnitOfMeasurementGroupLines: lines,
  UoMGroupDefinitionCollection: lines,
});

const mapTaxCode = (row) => ({
  Code: row.Code || "",
  Name: row.Name || "",
  Category: row.Category || "",
  TaxAccount: row.Account || "",
  Inactive: toYesNo(row.Inactive),
  IsItemLevel: "tNO",
  Rate: row.Rate ?? 0,
  TaxType: row.TaxType || "",
});

const mapShippingType = (row) => ({
  Code: row.TrnspCode,
  Name: row.TrnspName || "",
  Website: row.WebSite || "",
  ShippingCompany: row.ShippingCompany || "",
});

const mapPriceList = (row, baseName) => ({
  PriceListNo: row.ListNum,
  PriceListName: row.ListName || "",
  RoundingMethod: toRoundingMethod(row.RoundSys),
  Active: toYesNo(row.ValidFor),
  IsGrossPrice: toYesNo(row.IsGrossPrc),
  BasePriceList: row.BASE_NUM ?? "",
  BasePriceListName: baseName || "",
  Factor: row.Factor ?? 1,
  PriceListCurrency: row.PrimCurr || "",
  PriceListCurrencyName: row.CurrName || "",
  ValidFrom: row.ValidFrom || "",
  ValidTo: row.ValidTo || "",
});

const mapAccount = (row, fatherName = "", taxName = "") => ({
  ...(row.SlExtra || {}),
  Code: row.AcctCode || "",
  Name: row.AcctName || "",
  ForeignName: row.FrgnName || "",
  AccountType: toAccountType(row.GroupMask),
  FatherAccountKey: row.FatherNum || "",
  FatherAccountName: fatherName || "",
  ExternalCode: row.ExportCode || "",
  Level: row.Levels ?? "",
  ActiveAccount: row.FrozenFor === "Y" ? "tNO" : "tYES",
  Locked: toYesNo(row.FrozenFor),
  IsTitleAccount: row.Postable === "N" ? "tYES" : "tNO",
  Confidential: row.SlExtra?.Confidential || "tNO",
  Protected: toYesNo(row.Protected),
  Balance: row.CurrTotal ?? 0,
  BalanceFC: row.FcTotal ?? 0,
  BalanceSC: row.SysTotal ?? 0,
  AccountCurrency: row.ActCurr || "",
  AccountCurrencyName: row.AccountCurrencyName || "",
  TaxGroup: row.DfltTax || "",
  TaxGroupName: taxName || "",
  TaxLiable: row.DfltTax ? "tYES" : "tNO",
  CashAccount: toYesNo(row.CashBox),
  // SDK OACT: LocManTran = control account, RevalMatch = revaluation coordinated.
  ControlAccount: toYesNo(row.LocManTran),
  RevaluationCoordinated: toYesNo(row.RevalMatch),
  RevaluationAccount: row.RevalAcct || "",
  AllowMultipleCurrencies: row.ActCurr === "##" ? "tYES" : "tNO",
  BudgetAccount: toYesNo(row.Budget),
  ProjectCode: row.Project || "",
  Remarks: row.Details || "",
});

const mapBPAddress = (row) => ({
  AddressType: String(row.AdresType || row.AddrType || "").toUpperCase().startsWith("B") ? "bo_BillTo" : "bo_ShipTo",
  AddressName: row.Address || "",
  AddressName2: row.Address2 || "",
  AddressName3: row.Address3 || "",
  Street: row.Street || "",
  StreetNo: row.StreetNo || "",
  Block: row.Block || "",
  BuildingFloorRoom: row.Building || "",
  City: row.City || "",
  ZipCode: row.ZipCode || "",
  County: row.County || "",
  Country: row.Country || "",
  State: row.State || "",
  TaxOffice: row.TaxOffice || "",
  GlobalLocationNumber: row.GlblLocNum || "",
  GSTIN: row.GSTRegnNo || "",
  GstType: toBPGstType(row.GSTType),
  U_GSTIN_No: row.U_GSTIN_No || "",
  RowNum: row.LineNum ?? null,
});

const mapBPContact = (row) => ({
  CntctCode: row.CntctCode ?? "",
  Name: row.Name || "",
  FirstName: row.FirstName || "",
  LastName: row.LastName || "",
  Title: row.Title || "",
  Position: row.Position || "",
  Department: "",
  Phone1: row.Tel1 || "",
  Phone2: row.Tel2 || "",
  MobilePhone: row.Cellolar || "",
  Fax: row.Fax || "",
  E_Mail: row.E_MailL || "",
  Active: toYesNo(row.Active),
});

const mapBP = (row, addresses = [], contacts = []) => {
  const payload = {
    CardCode: row.CardCode || "",
    CardName: row.CardName || "",
    CardForeignName: row.CardFName || "",
    CardType: toCardType(row.CardType),
    GroupCode: row.GroupCode ?? "",
    Currency: row.Currency || "##",
    Phone1: row.Phone1 || "",
    Phone2: row.Phone2 || "",
    Fax: row.Fax || "",
    Cellular: row.Cellular || "",
    EmailAddress: row.E_Mail || "",
    Website: row.IntrntSite || "",
    FederalTaxID: row.LicTradNum || "",
    VatIDNum: row.VatIDNum || "",
    VATRegistrationNumber: row.VATRegNum || "",
    CompanyPrivate: toCompanyPrivate(row.CmpPrivate),
    LanguageCode: row.LangCode ?? "",
    SalesPersonCode: row.SlpCode ?? "",
    Territory: row.Territory ?? "",
    Industry: row.Industry ?? "",
    Valid: toYesNo(row.validFor),
    ValidFrom: row.validFrom || "",
    ValidTo: row.validTo || "",
    Frozen: toYesNo(row.frozenFor),
    FrozenFrom: row.frozenFrom || "",
    FrozenTo: row.frozenTo || "",
    PayTermsGrpCode: row.GroupNum ?? "",
    PriceListNum: row.ListNum ?? "",
    CreditLimit: row.CreditLine ?? 0,
    MaxCommitment: row.DebtLine ?? 0,
    DiscountPercent: row.Discount ?? 0,
    PeymentMethodCode: row.PymCode || "",
    DebitorAccount: row.DebPayAcct || row.DflAccount || "",
    DownPaymentClearAct: row.DpmClear || "",
    DownPaymentInterimAccount: row.DpmIntAct || "",
    ECommerceMerchantID: row.MerchantID || "",
    UseBillToAddrToDetermineTax: String(row.LocMth || "").toUpperCase() === "N" ? "tYES" : "tNO",
    BilltoDefault: row.BillToDef || "",
    ShipToDefault: row.ShipToDef || "",
    VatGroup: row.VatGroup || "",
    FreeText: row.Free_Text || "",
    Notes: row.Notes || "",
    CurrentAccountBalance: row.Balance ?? 0,
    OpenOrdersBalance: row.OrdersBal ?? 0,
    OpenDeliveryNotesBalance: row.DNotesBal ?? 0,
    BPAddresses: addresses,
    ContactEmployees: contacts,
  };

  for (let i = 1; i <= 64; i += 1) {
    payload[`Properties${i}`] = toYesNo(row[`QryGroup${i}`]);
  }

  return payload;
};

const mapBOMHeader = (row) => ({
  TreeCode: row.Code || "",
  ProductDescription: row.Name || "",
  TreeType: toTreeType(row.TreeType),
  Quantity: row.Qauntity ?? 1,
  Warehouse: row.ToWH || "",
  PriceList: row.PriceList ?? "",
  DistributionRule: row.OcrCode || "",
  Project: row.Project || "",
  PlanAvgProdSize: row.PlAvgSize ?? 1,
  HideBOMComponentsInPrintout: row.HideComp === "Y" ? "tYES" : "tNO",
  ComponentTotal: row.Price ?? 0,
  ProductPrice: row.ProductPrice ?? 0,
  Currency: row.ProductCurrency || "",
  ProductionStdCost: row.PrdStdCst ?? 0,
});

const mapBOMLine = (row) => {
  const hasItemCode = Boolean(String(row.Code || "").trim());
  const lineText = row.Comment || row.LineText || "";

  return {
    ItemCode: row.Code || "",
    ItemName: row.ItemName || row.ItemMasterName || "",
    Quantity: row.Quantity ?? 1,
    Warehouse: row.Warehouse || "",
    Price: row.Price ?? 0,
    PriceList: row.PriceList ?? "",
    IssueMethod: toIssueMethod(row.IssueMthd),
    ItemType: hasItemCode ? toItemType(row.Type) : "pit_Text",
    DistributionRule: row.OcrCode || "",
    Project: row.Project || "",
    WipAccount: row.WipActCode || "",
    Comment: lineText,
    AdditionalQuantity: row.AddQuant ?? row.AdditionalQuantity ?? 0,
    InventoryUOM: row.UoMName || row.InvntryUom || "",
    UoMName: row.UoMName || row.InvntryUom || "",
    // SAP shows each component's production standard cost (item master), else its average cost.
    ProductionStdCost: Number(row.ComponentStdCost) > 0 ? Number(row.ComponentStdCost) : Number(row.ComponentAvgPrice || 0),
    Currency: row.Currency || "",
    ChildNum: row.ChildNum ?? 0,
    VisualOrder: row.VisOrder ?? 0,
    StageID: row.StageId ?? row.StageID ?? "",
    RouteSequence: row.StageId ?? row.StageID ?? "",
  };
};

const getBranch = async (bplid) => {
  const row = await queryOne(`
    SELECT *
    FROM OBPL
    WHERE BPLId = @bplid
  `, { bplid: toInt(bplid, 0) });

  return row ? mapBranch(row) : null;
};

const searchBranches = async (query = "", top = 50, skip = 0) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const like = `%${String(query || "").trim()}%`;
  const rows = await queryRows(`
    SELECT BPLId, BPLName, BPLFrName, VATRegNum, TaxIdNum, RepName, Industry, MainBPL, Disabled
    FROM OBPL
    WHERE @query = ''
      OR BPLName LIKE @like
      OR ISNULL(BPLFrName, '') LIKE @like
    ORDER BY BPLId
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { query: String(query || "").trim(), like, top: limit, skip: offset });

  return rows.map(mapBranch);
};

const lookupBranchWarehouses = async (query = "", branchId = "") => {
  const branchIdNum = toInt(branchId, null);
  const rows = await queryRows(`
    SELECT TOP 100 WhsCode, WhsName, BPLid
    FROM OWHS
    WHERE (@query = ''
      OR WhsCode LIKE @like
      OR ISNULL(WhsName, '') LIKE @like)
      AND (CAST(@branchId AS INTEGER) IS NULL OR BPLid = @branchId)
    ORDER BY WhsCode
  `, { query: String(query || "").trim(), like: `%${String(query || "").trim()}%`, branchId: branchIdNum });

  return rows.map((row) => ({
    code: row.WhsCode,
    name: row.WhsName,
    branchId: row.BPLid,
  }));
};

const getWarehouse = async (whCode) => {
  const row = await queryOne(`
    SELECT *
    FROM OWHS
    WHERE WhsCode = @whCode
  `, { whCode });

  return row ? mapWarehouse(row) : null;
};

const searchWarehouses = async (query = "", top = 50, skip = 0) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT WhsCode, WhsName, Street, City, Country, Inactive
    FROM OWHS
    WHERE @query = ''
      OR WhsCode LIKE @like
      OR ISNULL(WhsName, '') LIKE @like
    ORDER BY WhsCode
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { query: trimmed, like: `%${trimmed}%`, top: limit, skip: offset });

  return rows.map((row) => ({
    WarehouseCode: row.WhsCode,
    WarehouseName: row.WhsName,
    Street: row.Street || "",
    City: row.City || "",
    Country: row.Country || "",
    Inactive: toYesNo(row.Inactive),
  }));
};

const lookupCountries = async (query = "", options = {}) => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 200 Code, Name
    FROM OCRY
    WHERE @query = ''
      OR Code LIKE @like
      OR Name LIKE @like
    ORDER BY Code
  `, { query: trimmed, like: `%${trimmed}%` }, options);

  return rows.map((row) => ({ code: row.Code, name: row.Name }));
};

const getCountryByCode = async (code) => {
  const trimmed = String(code || "").trim();
  if (!trimmed) return null;

  const row = await queryOne(`
    SELECT TOP 1 Code, Name
    FROM OCRY
    WHERE Code = @code
    ORDER BY Code
  `, { code: trimmed });

  return row ? { code: row.Code, name: row.Name || "" } : null;
};

const lookupStates = async (country = "", options = {}) => {
  const trimmed = String(country || "").trim();
  const rows = await queryRows(`
    SELECT Code, Name, Country
    FROM OCST
    WHERE (@country = '' OR Country = @country)
    ORDER BY Country, Code
  `, { country: trimmed }, options);

  return rows.map((row) => ({ code: row.Code, name: row.Name, country: row.Country || "" }));
};

const lookupWarehouseLocations = async () => {
  const rows = await queryRows(`
    SELECT Code, Location
    FROM OLCT
    ORDER BY Code
  `);

  return rows.map((row) => ({ code: String(row.Code), name: row.Location || "" }));
};

const lookupBusinessPlaces = async () => {
  const rows = await queryRows(`
    SELECT BPLId, BPLName, VATRegNum, TaxIdNum
    FROM OBPL
    WHERE Disabled <> 'Y'
    ORDER BY BPLId
  `);

  return rows.map((row) => ({
    code: String(row.BPLId),
    name: row.BPLName || "",
    vatRegNum: row.VATRegNum || "",
    taxIdNum: row.TaxIdNum || "",
    branchRegNo: row.VATRegNum || row.TaxIdNum || "",
  }));
};

const lookupGLAccounts = async (query = "", top = 100) => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP (${Math.max(1, toInt(top, 100))}) AcctCode, AcctName
    FROM OACT
    WHERE @query = ''
      OR AcctCode LIKE @like
      OR AcctName LIKE @like
    ORDER BY AcctCode
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({ code: row.AcctCode, name: row.AcctName }));
};

const getPaymentTerms = async (groupNumber) => {
  const row = await queryOne(`
    SELECT *
    FROM OCTG
    WHERE GroupNum = @groupNumber
  `, { groupNumber: toInt(groupNumber, 0) });

  if (!row) return null;

  const lines = await queryRows(`
    SELECT CTGCode, IntsNo, InstMonth, InstDays, InstPrcnt
    FROM CTG1
    WHERE CTGCode = @groupNumber
    ORDER BY IntsNo
  `, { groupNumber: toInt(groupNumber, 0) });

  const mappedLines = lines.map((line, index) => ({
    InstallmentNumber: index + 1,
    Percent: line.InstPrcnt ?? 0,
    NumberOfAdditionalMonths: line.InstMonth ?? 0,
    NumberOfAdditionalDays: line.InstDays ?? 0,
    BaselineDate: toBaselineDate(row.BslineDate),
    StartFrom: toStartFrom(row.PayDuMonth),
  }));

  return mapPaymentTerms(row, mappedLines);
};

const searchPaymentTerms = async (query = "", top = 50, skip = 0) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT *
    FROM OCTG
    WHERE @query = ''
      OR PymntGroup LIKE @like
      OR CAST(GroupNum AS NVARCHAR(50)) LIKE @like
    ORDER BY GroupNum
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { query: trimmed, like: `%${trimmed}%`, top: limit, skip: offset });

  return rows.map((row) => ({
    GroupNumber: row.GroupNum,
    PaymentTermsGroupName: row.PymntGroup || "",
    PaymentTermsGroupCode: row.PymntCode || String(row.GroupNum),
    CashDiscountPercent: row.VolumDscnt ?? 0,
    NumberOfAdditionalMonths: row.ExtraMonth ?? 0,
    NumberOfAdditionalDays: row.ExtraDays ?? 0,
    CreditLimit: row.CredLimit ?? 0,
    DiscountCode: row.DiscCode || "",
    LoadLimitCredit: toYesNo(row.LoadLimit),
    OpenIncomingPaymentsByDueDate: toYesNo(row.OpenRcpt),
    BaselineDate: toBaselineDate(row.BslineDate),
    StartFrom: toStartFrom(row.PayDuMonth),
    PaymentMethod: row.PymCode || "",
  }));
};

const getUoMGroup = async (absEntry) => {
  const row = await queryOne(`
    SELECT G.UgpEntry, G.UgpCode, G.UgpName, G.BaseUom, U.UomCode AS BaseUoMCode
    FROM OUGP G
    LEFT JOIN OUOM U ON U.UomEntry = G.BaseUom
    WHERE G.UgpEntry = @absEntry
  `, { absEntry: toInt(absEntry, 0) });

  if (!row) return null;

  const lines = await queryRows(`
    SELECT L.UomEntry, L.AltQty, L.BaseQty, L.LineNum, U.UomCode, U.UomName
    FROM UGP1 L
    LEFT JOIN OUOM U ON U.UomEntry = L.UomEntry
    WHERE L.UgpEntry = @absEntry
    ORDER BY L.LineNum
  `, { absEntry: toInt(absEntry, 0) });

  const mappedLines = lines.map((line) => ({
    AlternateUoM: line.UomEntry,
    AlternateQuantity: line.AltQty ?? 1,
    BaseQuantity: line.BaseQty ?? 1,
    UoMType: "uomtAdditional",
    UoMCode: line.UomCode || "",
    UoMName: line.UomName || "",
  }));

  return mapUoMGroup(row, mappedLines);
};

const searchUoMGroups = async (query = "", top = 50, skip = 0) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT UgpEntry, UgpCode, UgpName, BaseUom
    FROM OUGP
    WHERE @query = ''
      OR UgpCode LIKE @like
      OR UgpName LIKE @like
      OR CAST(UgpEntry AS NVARCHAR(50)) LIKE @like
    ORDER BY UgpEntry
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { query: trimmed, like: `%${trimmed}%`, top: limit, skip: offset });

  return rows.map((row) => ({
    AbsEntry: row.UgpEntry,
    Code: row.UgpCode || "",
    Name: row.UgpName || "",
    BaseUoM: row.BaseUom ?? "",
  }));
};

const lookupUoMs = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT UomEntry, UomCode, UomName
    FROM OUOM
    WHERE @query = ''
      OR UomCode LIKE @like
      OR UomName LIKE @like
    ORDER BY UomCode
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({
    code: String(row.UomEntry),
    name: `${row.UomCode} - ${row.UomName}`,
    uomCode: row.UomCode,
    uomName: row.UomName || "",
  }));
};

const normalizeTaxCodeDocumentType = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["sales", "ar", "a/r", "output", "sale", "s", "o", "vgoutputtax"].includes(normalized)) return "sales";
  if (["purchase", "ap", "a/p", "input", "purchasing", "p", "i", "vginputtax"].includes(normalized)) return "purchase";
  return "";
};

const mapDocumentTaxCode = (row) => ({
  Code: row.Code || "",
  Name: row.Name || "",
  Rate: row.Rate ?? 0,
  GSTType: row.GSTType || "",
  Category: row.Category || "",
  Components: row.Components || "",
});

const queryDocumentTaxCodes = async (query = "", documentType = "", top = 500, skip = 0, useCategoryFilter = true) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const normalizedType = normalizeTaxCodeDocumentType(documentType);
  const categoryFilter = "";

  const rows = await queryRows(`
    SELECT
      T0.Code,
      T0.Name,
      CAST(SUM(ISNULL(T1.EfctivRate, 0)) AS DECIMAL(19, 6)) AS Rate,
      CASE
        WHEN MAX(CASE WHEN UPPER(ISNULL(T1.STACode, '')) LIKE '%CGST%' OR UPPER(ISNULL(T1.STACode, '')) LIKE 'CG%' THEN 1 ELSE 0 END) = 1
         AND MAX(CASE WHEN UPPER(ISNULL(T1.STACode, '')) LIKE '%SGST%' OR UPPER(ISNULL(T1.STACode, '')) LIKE 'SG%' THEN 1 ELSE 0 END) = 1 THEN 'INTRASTATE'
        WHEN MAX(CASE WHEN UPPER(ISNULL(T1.STACode, '')) LIKE '%IGST%' OR UPPER(ISNULL(T1.STACode, '')) LIKE 'IG%' THEN 1 ELSE 0 END) = 1 THEN 'INTERSTATE'
        ELSE 'OTHER'
      END AS GSTType,
      '' AS Category,
      '' AS Components
    FROM OSTC T0
    INNER JOIN STC1 T1
      ON T0.Code = T1.STCCode
     AND T1.STAType IN ('-100', '-110', '-120')
    WHERE ISNULL(T0.Lock, 'N') <> 'Y'
      AND (@query = ''
        OR T0.Code LIKE @like ${LIKE_ESCAPE_SQL}
        OR ISNULL(T0.Name, '') LIKE @like ${LIKE_ESCAPE_SQL}
        OR CAST(ISNULL(T1.EfctivRate, 0) AS NVARCHAR(50)) LIKE @like ${LIKE_ESCAPE_SQL})
      ${categoryFilter}
    GROUP BY T0.Code, T0.Name
    ORDER BY T0.Code
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, {
    query: trimmed,
    like: `%${escapeLikeValue(trimmed)}%`,
    top: limit,
    skip: offset,
  });

  const mappedRows = rows.map(mapDocumentTaxCode);
  const taxCodes = mappedRows.map((row) => row.Code).filter(Boolean);
  if (!taxCodes.length) return mappedRows;

  const componentParams = {};
  const componentPlaceholders = taxCodes.map((code, index) => {
    const key = `componentCode${index}`;
    componentParams[key] = code;
    return `@${key}`;
  });
  const authorityFields = await readTaxAuthorityMetadata('OSTA');
  const authorityColumn = name => Object.keys(authorityFields).find(field => field.toLowerCase() === name.toLowerCase());
  const reverseColumn = authorityColumn('RvsCrgPrc');
  const authorityCodeColumn = authorityColumn('Code');
  const authorityTypeColumn = authorityColumn('Type');
  const quoteAuthorityColumn = name => `[${name.replace(/]/g, ']]')}]`;
  const canReadReverse = reverseColumn && authorityCodeColumn && authorityTypeColumn;
  const authorityJoin = canReadReverse
    ? `LEFT JOIN OSTA TA ON TA.${quoteAuthorityColumn(authorityCodeColumn)} = T0.STACode AND TA.${quoteAuthorityColumn(authorityTypeColumn)} = T0.STAType`
    : '';
  const componentRows = await queryRows(`
    SELECT
      T0.STCCode AS Code,
      T0.STACode,
      T0.EfctivRate,
      ${canReadReverse ? `ISNULL(TA.${quoteAuthorityColumn(reverseColumn)}, 0)` : '0'} AS ReverseChargePercent
    FROM STC1 T0
    ${authorityJoin}
    WHERE T0.STCCode IN (${componentPlaceholders.join(', ')})
      AND T0.STAType IN ('-100', '-110', '-120')
    ORDER BY T0.STCCode, T0.STACode
  `, componentParams);
  const componentsByCode = componentRows.reduce((acc, row) => {
    const code = String(row.Code || '').trim();
    const componentCode = String(row.STACode || '').trim();
    if (!code || !componentCode) return acc;
    if (!acc.has(code)) acc.set(code, []);
    acc.get(code).push(`${componentCode}:${Number(row.EfctivRate || 0)}`);
    return acc;
  }, new Map());

  const payableRates = aggregatePayableTaxRates(componentRows);
  return mappedRows.map((row) => ({
    ...row,
    PayableRate: payableRates.get(row.Code) ?? Number(row.Rate || 0),
    Components: (componentsByCode.get(row.Code) || []).join(', '),
  }));
};

const searchDocumentTaxCodes = async (query = "", documentType = "", top = 500, skip = 0) => {
  const normalizedType = normalizeTaxCodeDocumentType(documentType);
  const filtered = await queryDocumentTaxCodes(query, normalizedType, top, skip, true);
  if (filtered.length || !normalizedType) return filtered;
  return queryDocumentTaxCodes(query, "", top, skip, false);
};

const getTaxCode = async (code) => {
  const normalizedCode = String(code || "").trim().toLowerCase();
  if (!normalizedCode) return null;

  const rows = await searchDocumentTaxCodes(String(code).trim(), "", 20, 0);
  const row = rows.find((tax) => String(tax.Code || "").trim().toLowerCase() === normalizedCode) || null;

  return row || null;
};

const searchTaxCodes = async (query = "", category = "", top = 50, skip = 0) => {
  return searchDocumentTaxCodes(query, category, top, skip);
};

// Tax setup lists (Tax Code - Setup page): include inactive codes, unlike the
// document lookups above which only offer usable ones.
const listTaxCodesForSetup = async (query = "") => queryRows(`
  SELECT TOP 200 T0.Code, T0.Name, ISNULL(T0.Rate, 0) AS Rate, ISNULL(T0.Lock, 'N') AS Lock
  FROM OSTC T0
  WHERE @query = '' OR T0.Code LIKE @like OR ISNULL(T0.Name, '') LIKE @like
  ORDER BY T0.Code
`, { query: String(query || "").trim(), like: `%${String(query || "").trim()}%` });

const listTaxComponents = async (query = "") => queryRows(`
  SELECT TOP 200 T0.Code, T0.Name, T0.Type, T1.Name AS TypeName, ISNULL(T0.Rate, 0) AS Rate,
    T0.SalesTax, T0.PurchTax
  FROM OSTA T0
  LEFT JOIN OSTT T1 ON T1.AbsId = T0.Type
  WHERE @query = '' OR T0.Code LIKE @like OR ISNULL(T0.Name, '') LIKE @like
  ORDER BY T0.Code
`, { query: String(query || "").trim(), like: `%${String(query || "").trim()}%` });

const listTaxTypes = async () => queryRows(`
  SELECT AbsId, Name FROM OSTT WHERE ISNULL(Locked, 'N') <> 'Y' ORDER BY AbsId DESC
`);

const getShippingType = async (code) => {
  const row = await queryOne(`
    SELECT TrnspCode, TrnspName, WebSite, '' AS ShippingCompany
    FROM OSHP
    WHERE TrnspCode = @code
  `, { code: toInt(code, 0) });

  return row ? mapShippingType(row) : null;
};

const searchShippingTypes = async (query = "", top = 50, skip = 0) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TrnspCode, TrnspName, WebSite, '' AS ShippingCompany
    FROM OSHP
    WHERE @query = ''
      OR TrnspName LIKE @like
      OR CAST(TrnspCode AS NVARCHAR(50)) LIKE @like
    ORDER BY TrnspCode
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { query: trimmed, like: `%${trimmed}%`, top: limit, skip: offset });

  return rows.map(mapShippingType);
};

const getPriceList = async (priceListNo) => {
  const row = await queryOne(`
    SELECT P.*, C.CurrName, B.ListName AS BasePriceListName
    FROM OPLN P
    LEFT JOIN OCRN C ON C.CurrCode = P.PrimCurr
    LEFT JOIN OPLN B ON B.ListNum = P.BASE_NUM
    WHERE P.ListNum = @priceListNo
  `, { priceListNo: toInt(priceListNo, 0) });

  return row ? mapPriceList(row, row.BasePriceListName) : null;
};

const searchPriceLists = async (query = "", top = 50, skip = 0) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT ListNum, ListName, BASE_NUM, Factor, RoundSys, IsGrossPrc, ValidFor
    FROM OPLN
    WHERE @query = ''
      OR ListName LIKE @like
      OR CAST(ListNum AS NVARCHAR(50)) LIKE @like
    ORDER BY ListNum
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { query: trimmed, like: `%${trimmed}%`, top: limit, skip: offset });

  return rows.map((row) => ({
    PriceListNo: row.ListNum,
    PriceListName: row.ListName || "",
    BasePriceList: row.BASE_NUM ?? "",
    Factor: row.Factor ?? 1,
    RoundingMethod: toRoundingMethod(row.RoundSys),
    Active: toYesNo(row.ValidFor),
    IsGrossPrice: toYesNo(row.IsGrossPrc),
  }));
};

const lookupPriceLists = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 200 ListNum, ListName
    FROM OPLN
    WHERE @query = ''
      OR ListName LIKE @like
      OR CAST(ListNum AS NVARCHAR(50)) LIKE @like
    ORDER BY ListNum
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({
    code: String(row.ListNum),
    name: row.ListName,
  }));
};

const lookupCurrencies = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 200 CurrCode, CurrName
    FROM OCRN
    WHERE @query = ''
      OR CurrCode LIKE @like
      OR CurrName LIKE @like
    ORDER BY CurrCode
  `, { query: trimmed, like: `%${trimmed}%` });
  const company = await queryOne("SELECT MainCurncy FROM OADM").catch(() => null);

  return rows.map((row) => ({ code: row.CurrCode, name: row.CurrName, local: row.CurrCode === company?.MainCurncy }));
};

const getAccount = async (code) => {
  const row = await queryOne(`
    SELECT A.*, F.AcctName AS FatherAccountName, T.Name AS TaxGroupName, C.CurrName AS AccountCurrencyName
    FROM OACT A
    LEFT JOIN OACT F ON F.AcctCode = A.FatherNum
    LEFT JOIN OVTG T ON T.Code = A.DfltTax
    LEFT JOIN OCRN C ON C.CurrCode = A.ActCurr
    WHERE A.AcctCode = @code
  `, { code });

  if (!row) return null;
  const account = mapAccount(row, row.FatherAccountName, row.TaxGroupName);
  account.Balance = await getAccountBalance(row.AcctCode, row.Postable === "N");
  const company = await queryOne("SELECT MainCurncy FROM OADM").catch(() => null);
  account.BalanceCurrency = company?.MainCurncy || "";
  return account;
};

// SAP B1 shows the posted balance (debit - credit, local currency). A title
// account shows the sum of every account below it.
const getAccountBalance = async (code, isTitle) => {
  if (!isTitle) {
    const row = await queryOne("SELECT SUM(Debit - Credit) AS Balance FROM JDT1 WHERE Account = @code", { code });
    return Number(row?.Balance || 0);
  }
  // ponytail: loads the whole tree + per-account totals; fine for a chart of accounts, add a recursive CTE if it grows huge.
  const [tree, totals] = await Promise.all([
    queryRows("SELECT AcctCode, FatherNum FROM OACT"),
    queryRows("SELECT Account, SUM(Debit - Credit) AS Balance FROM JDT1 GROUP BY Account"),
  ]);
  const children = new Map();
  tree.forEach((acct) => {
    if (!acct.FatherNum) return;
    if (!children.has(acct.FatherNum)) children.set(acct.FatherNum, []);
    children.get(acct.FatherNum).push(acct.AcctCode);
  });
  const balances = new Map(totals.map((t) => [t.Account, Number(t.Balance || 0)]));
  let sum = 0;
  const stack = [code];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    sum += balances.get(current) || 0;
    stack.push(...(children.get(current) || []));
  }
  return sum;
};

const searchAccounts = async (query = "", accountType = "", top = 50, skip = 0) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const groupMask = {
    sat_Assets: 1,
    sat_Liabilities: 2,
    sat_Equity: 3,
    sat_Revenues: 4,
    sat_Expenditure: 5,
    sat_Other: 6,
  }[accountType] ?? null;

  const rows = await queryRows(`
    SELECT AcctCode, AcctName, FatherNum, GroupMask, FrozenFor, ExportCode, Levels, Postable, CurrTotal
    FROM OACT
    WHERE (@query = ''
      OR AcctCode LIKE @like
      OR AcctName LIKE @like)
      AND (CAST(@groupMask AS INTEGER) IS NULL OR GroupMask = @groupMask)
    ORDER BY AcctCode
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { query: trimmed, like: `%${trimmed}%`, groupMask, top: limit, skip: offset });

  return rows.map((row) => ({
    Code: row.AcctCode,
    Name: row.AcctName,
    FatherAccountKey: row.FatherNum || "",
    AccountType: toAccountType(row.GroupMask),
    ActiveAccount: row.FrozenFor === "Y" ? "tNO" : "tYES",
    Locked: toYesNo(row.FrozenFor),
    ExternalCode: row.ExportCode || "",
    Level: row.Levels ?? "",
    IsTitleAccount: row.Postable === "N" ? "tYES" : "tNO",
    Balance: row.CurrTotal ?? 0,
  }));
};

const lookupParentAccounts = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 100 AcctCode, AcctName, Levels
    FROM OACT
    WHERE FrozenFor <> 'Y'
      AND Postable = 'N'
      AND (@query = ''
        OR AcctCode LIKE @like
        OR AcctName LIKE @like)
    ORDER BY AcctCode
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({ code: row.AcctCode, name: `${row.AcctCode} - ${row.AcctName}`, level: Number(row.Levels) || 1 }));
};

const lookupTaxCodes = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 100 Code, Name, Category
    FROM OVTG
    WHERE @query = ''
      OR Code LIKE @like
      OR Name LIKE @like
    ORDER BY Code
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({ code: row.Code, name: `${row.Code} - ${row.Name}`, category: row.Category || "" }));
};

const getBP = async (cardCode) => {
  const row = await queryOne(`
    SELECT *
    FROM OCRD
    WHERE CardCode = @cardCode
  `, { cardCode });

  if (!row) return null;

  const addresses = await queryRows(`
    SELECT *
    FROM CRD1
    WHERE CardCode = @cardCode
    ORDER BY LineNum
  `, { cardCode });

  const contacts = await queryRows(`
    SELECT *
    FROM OCPR
    WHERE CardCode = @cardCode
    ORDER BY CntctCode
  `, { cardCode });

  return mapBP(row, addresses.map(mapBPAddress), contacts.map(mapBPContact));
};

const searchBP = async (query = "", type = "", top = 50, skip = 0, options = {}) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const cardType = type === "cCustomer" ? "C" : type === "cSupplier" ? "S" : type === "cLead" ? "L" : "";
  const searchClauses = [];
  const searchParams = {};
  appendSapSearchCondition(
    searchClauses,
    searchParams,
    ["CardCode", "CardName", "CardFName", "Phone1", "E_Mail"],
    trimmed,
    "bpQuery",
  );
  const rows = await queryRows(`
    SELECT
      CardCode,
      CardName,
      CardType,
      GroupCode,
      Phone1,
      E_Mail,
      Currency,
      Balance,
      validFor,
      frozenFor,
      BillToDef,
      Address,
      LicTradNum
    FROM OCRD
      WHERE (${searchClauses.length ? searchClauses.join(" AND ") : "1 = 1"})
        AND (@cardType = '' OR CardType = @cardType)
      ORDER BY CardName, CardCode
      OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
    `, {
      ...searchParams,
      cardType,
      top: limit,
      skip: offset,
    }, options);

    return rows.map((row) => ({
      CardCode: row.CardCode,
      CardName: row.CardName,
      CardType: toCardType(row.CardType),
      GroupCode: row.GroupCode ?? "",
      Phone1: row.Phone1 || "",
      EmailAddress: row.E_Mail || "",
      Currency: row.Currency || "##",
      Balance: row.Balance ?? 0,
      Active: String(row.validFor || '').toUpperCase() === 'N' ? 'No' : 'Yes',
      Inactive: String(row.frozenFor || '').toUpperCase() === 'Y' ? 'Yes' : 'No',
      BillToBlock: row.BillToDef || "",
      BillToBuildingFloorRoom: row.Address || "",
      GTSRegistrationNumber: row.LicTradNum || "",
    }));
  };

const lookupBPGroups = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 200 GroupCode, GroupName
    FROM OCRG
    WHERE @query = ''
      OR CAST(GroupCode AS NVARCHAR(50)) LIKE @like
      OR GroupName LIKE @like
    ORDER BY GroupCode
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({ code: String(row.GroupCode), name: row.GroupName }));
};

const lookupPaymentTerms = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 200 GroupNum, PymntGroup
    FROM OCTG
    WHERE @query = ''
      OR CAST(GroupNum AS NVARCHAR(50)) LIKE @like
      OR PymntGroup LIKE @like
    ORDER BY GroupNum
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({ code: String(row.GroupNum), name: row.PymntGroup }));
};

const getCreditCardByCode = async (code) => {
  const numericCode = toInt(code, null);
  if (numericCode == null || numericCode < 0) return null;

  const row = await queryOne(`
    SELECT CreditCard, CardName, AcctCode, Phone, CompanyId, Country
    FROM OCRC
    WHERE CreditCard = @code
  `, { code: numericCode });

  if (!row) return null;

  return {
    code: String(row.CreditCard),
    name: row.CardName || "",
    glAccount: row.AcctCode || "",
    telephone: row.Phone || "",
    companyId: row.CompanyId || "",
    country: row.Country || "",
  };
};

const lookupCreditCards = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 200 CreditCard, CardName, AcctCode, Phone, CompanyId, Country
    FROM OCRC
    WHERE @query = ''
      OR CAST(CreditCard AS NVARCHAR(50)) LIKE @like
      OR ISNULL(CardName, '') LIKE @like
    ORDER BY CreditCard
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({
    code: String(row.CreditCard),
    name: row.CardName || "",
    glAccount: row.AcctCode || "",
    telephone: row.Phone || "",
    companyId: row.CompanyId || "",
    country: row.Country || "",
  }));
};

const mapWithholdingTaxCode = (row) => ({
  code: row.WTCode || "",
  name: row.WTName || "",
  assesseeType: Number(row.Assessee) === 1 ? "atCompany" : "atOthers",
  assesseeTypeLabel: Number(row.Assessee) === 1 ? "Company" : "Others",
  taxCategory: row.EBWTaxCate == null || row.EBWTaxCate === "" ? (row.Category || "") : String(row.EBWTaxCate),
  threshold: row.Threshold ?? 0,
  surcharge: row.Surcharge ?? 0,
  officialCode: row.OffclCode || "",
  rate: row.Rate ?? 0,
  baseTypeCode: row.BaseType || "N",
  baseType: ({ G: "Gross", N: "Net", V: "VAT", U: "UoM", H: "Gross - VAT" })[String(row.BaseType || "N").toUpperCase()] || row.BaseType || "Net",
  basePercentage: row.PrctBsAmnt ?? 100,
  account: row.ApTdsAcc || row.Account || "",
  tdsAccount: row.ApTdsAcc || row.Account || "",
  surchargeAccount: row.ApSurAcc || "",
  cessAccount: row.ApCessAcc || "",
  hscAccount: row.ApHscAcc || "",
  igstAccount: row.ApIgstAcc || "",
  cgstAccount: row.ApCgstAcc || "",
  sgstAccount: row.ApSgstAcc || "",
  utgstAccount: row.ApUtgstAcc || "",
  cessGstAccount: row.ApCsgstAcc || "",
  tdsTypeCode: row.TDSType || "E",
  tdsType: ({ E: "eTDS", D: "GST TDS", C: "GST TCS", S: "SALES TCS" })[String(row.TDSType || "E").toUpperCase()] || row.TDSType || "eTDS",
  tdsRate: row.TdsRate ?? row.Rate ?? 0,
  surchargeRate: row.SurRate ?? row.Surcharge ?? 0,
  cessRate: row.CessRate ?? 0,
  hscRate: row.HscRate ?? 0,
  igstRate: row.IgstRate ?? 0,
  cgstRate: row.CgstRate ?? 0,
  sgstRate: row.SgstRate ?? 0,
  utgstRate: row.UtgstRate ?? 0,
  cessGstRate: row.CsgstRate ?? 0,
  inactive: toYesNo(row.Inactive),
});

const getWithholdingTaxCode = async (code) => {
  const trimmed = String(code || "").trim();
  if (!trimmed) return null;

  const row = await queryOne(`
    SELECT TOP 1 WTCode, WTName, Assessee, Threshold, Surcharge, EBWTaxCate, Category, OffclCode, Rate,
      BaseType, PrctBsAmnt, Account, Inactive
    FROM OWHT
    WHERE WTCode = @code
    ORDER BY WTCode
  `, { code: trimmed });

  return row ? mapWithholdingTaxCode(row) : null;
};

const lookupWithholdingTaxCodes = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
      SELECT TOP 200 W.WTCode, W.WTName, W.Assessee, W.Threshold, W.Surcharge, W.EBWTaxCate,
        W.Category, W.OffclCode, W.Rate, W.BaseType, W.PrctBsAmnt, W.Account, W.Inactive,
        W.ApTdsAcc, W.ApSurAcc, W.ApCessAcc, W.ApHscAcc, W.TDSType,
        W.ApIgstAcc, W.ApCgstAcc, W.ApSgstAcc, W.ApUtgstAcc, W.ApCsgstAcc
      FROM OWHT W
      WHERE @query = ''
        OR W.WTCode LIKE @like
        OR ISNULL(W.WTName, '') LIKE @like
        OR ISNULL(W.OffclCode, '') LIKE @like
      ORDER BY W.WTCode
  `, { query: trimmed, like: `%${trimmed}%` });

  let rateRows = [];
  try {
    rateRows = await queryRows(`
      SELECT TOP 1000 WTCode, EffecDate, LineNum, TdsRate, SurRate, CessRate, HscRate,
        IgstRate, CgstRate, SgstRate, UtgstRate, CsgstRate
      FROM AWH1
      ORDER BY WTCode, EffecDate DESC, LineNum DESC
    `);
  } catch (_error) {
    rateRows = [];
  }

  const latestRatesByCode = new Map();
  rateRows.forEach((row) => {
    const code = String(row.WTCode || '').trim();
    if (code && !latestRatesByCode.has(code)) latestRatesByCode.set(code, row);
  });

  return rows.map((row) => mapWithholdingTaxCode({
    ...row,
    ...(latestRatesByCode.get(String(row.WTCode || '').trim()) || {}),
  }));
};

const getNextCreditCardCode = async () => {
  const row = await queryOne(`
    SELECT ISNULL(MAX(CreditCard), 0) + 1 AS NextCode
    FROM OCRC
  `);

  return row?.NextCode ?? 1;
};

const getBankByCode = async (bankCode, country = "") => {
  const trimmedCode = String(bankCode || "").trim();
  if (!trimmedCode) return null;

  const row = await queryOne(`
    SELECT TOP 1 B.BankCode, B.BankName, B.CountryCod, B.SwiftNum, B.IBAN, B.DfltBranch, C.Name AS CountryName
    FROM ODSC B
    LEFT JOIN OCRY C ON C.Code = B.CountryCod
    WHERE B.BankCode = @bankCode
      AND (@country = '' OR B.CountryCod = @country)
    ORDER BY B.BankCode
  `, { bankCode: trimmedCode, country: String(country || "").trim() });

  if (!row) return null;

  return {
    code: row.BankCode || "",
    name: row.BankName || "",
    country: row.CountryCod || "",
    countryName: row.CountryName || row.CountryCod || "",
    swift: row.SwiftNum || "",
    iban: row.IBAN || "",
    branch: row.DfltBranch || "",
  };
};

const lookupBanks = async (query = "", country = "") => {
  const trimmed = String(query || "").trim();
  const countryCode = String(country || "").trim();
  const rows = await queryRows(`
    SELECT TOP 200 B.BankCode, B.BankName, B.CountryCod, B.SwiftNum, B.IBAN, B.DfltBranch, C.Name AS CountryName
    FROM ODSC B
    LEFT JOIN OCRY C ON C.Code = B.CountryCod
    WHERE (@query = ''
      OR B.BankCode LIKE @like
      OR ISNULL(B.BankName, '') LIKE @like)
      AND (@country = '' OR B.CountryCod = @country)
    ORDER BY B.CountryCod, B.BankCode
  `, { query: trimmed, like: `%${trimmed}%`, country: countryCode });

  return rows.map((row) => ({
    code: row.BankCode || "",
    name: row.BankName || "",
    country: row.CountryCod || "",
    countryName: row.CountryName || row.CountryCod || "",
    swift: row.SwiftNum || "",
    iban: row.IBAN || "",
    branch: row.DfltBranch || "",
  }));
};

const lookupHouseBankAccounts = async (bankCode = "", country = "") => {
  const trimmedBankCode = String(bankCode || "").trim();
  const trimmedCountry = String(country || "").trim();
  if (!trimmedBankCode) return [];

  const rows = await queryRows(`
    SELECT
      D.BankCode,
      D.Account,
      COALESCE(NULLIF(D.BranchName, ''), NULLIF(D.Branch, ''), NULLIF(B.DfltBranch, '')) AS Branch,
      COALESCE(NULLIF(D.IBAN, ''), NULLIF(B.IBAN, '')) AS IBAN,
      COALESCE(NULLIF(D.SwiftNum, ''), NULLIF(B.SwiftNum, '')) AS SwiftNum,
      D.ControlKey,
      D.Country,
      B.BankName,
      C.Name AS CountryName
    FROM DSC1 D
    LEFT JOIN ODSC B
      ON B.BankCode = D.BankCode
     AND (@country = '' OR B.CountryCod = @country)
    LEFT JOIN OCRY C
      ON C.Code = D.Country
    WHERE D.BankCode = @bankCode
      AND (@country = '' OR D.Country = @country)
    ORDER BY D.Account
  `, { bankCode: trimmedBankCode, country: trimmedCountry });

  return rows.map((row) => ({
    bankCode: row.BankCode || "",
    bankName: row.BankName || row.BankCode || "",
    account: row.Account || "",
    branch: row.Branch || "",
    iban: row.IBAN || "",
    swift: row.SwiftNum || "",
    controlKey: row.ControlKey || "",
    country: row.Country || "",
    countryName: row.CountryName || row.Country || "",
  }));
};

const lookupSalesPersons = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 200 SlpCode, SlpName, Memo
    FROM OSLP
    WHERE @query = ''
      OR CAST(SlpCode AS NVARCHAR(50)) LIKE @like
      OR SlpName LIKE @like
    ORDER BY SlpCode
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({
    code: String(row.SlpCode),
    name: row.SlpName,
    remarks: row.Memo || "",
  }));
};

const resolveBPSeriesDocSubTypes = (bpType = "") => {
  const normalizedType = String(bpType || "").trim();
  if (normalizedType === "cSupplier") return ["S"];
  if (normalizedType === "cCustomer" || normalizedType === "cLead") return ["C"];
  return [];
};

const lookupBPSeries = async (bpType = "") => {
  const docSubTypes = resolveBPSeriesDocSubTypes(bpType);
  const rows = await queryRows(`
    SELECT Series, SeriesName, InitialNum, NextNumber, BeginStr, EndStr, Indicator, Locked, IsManual, DocSubType
    FROM NNM1
    WHERE ObjectCode = '2'
      AND Locked <> 'Y'
      AND (
        @docSubType1 = ''
        OR DocSubType = @docSubType1
        OR DocSubType = @docSubType2
      )
    ORDER BY SeriesName, Series
  `, {
    docSubType1: docSubTypes[0] || "",
    docSubType2: docSubTypes[1] || "",
  });

  const seenDisplayNames = new Set();

  return rows.map((row) => {
    const seriesName = row.SeriesName || `Series ${row.Series}`;
    const isManual =
      String(row.IsManual || "").toUpperCase() === "Y" ||
      seriesName.trim().toLowerCase() === "manual";

    return {
      series: String(row.Series),
      name: seriesName,
      prefix: row.BeginStr || "",
      suffix: row.EndStr || "",
      indicator: row.Indicator || "",
      nextNumber: row.NextNumber ?? row.InitialNum ?? null,
      locked: String(row.Locked || "").toUpperCase() === "Y",
      isManual,
      docSubType: row.DocSubType || "",
      isDefault: false,
    };
  }).filter((row) => {
    const key = `${row.docSubType}:${row.isManual ? "manual" : row.name.trim().toLowerCase()}`;
    if (seenDisplayNames.has(key)) return false;
    seenDisplayNames.add(key);
    return true;
  });
};

const getBPSeriesNextNumber = async (series, bpType = "") => {
  const docSubTypes = resolveBPSeriesDocSubTypes(bpType);
  const row = await queryOne(`
    SELECT TOP 1 Series, SeriesName, InitialNum, NextNumber, BeginStr, EndStr, Indicator, Locked, IsManual, DocSubType
    FROM NNM1
    WHERE Series = @series
      AND ObjectCode = '2'
      AND Locked <> 'Y'
      AND (
        @docSubType1 = ''
        OR DocSubType = @docSubType1
        OR DocSubType = @docSubType2
      )
  `, {
    series: toInt(series, 0),
    docSubType1: docSubTypes[0] || "",
    docSubType2: docSubTypes[1] || "",
  });

  if (!row) return null;

  const seriesName = row.SeriesName || `Series ${row.Series}`;
  const isManual =
    String(row.IsManual || "").toUpperCase() === "Y" ||
    seriesName.trim().toLowerCase() === "manual";
  const nextNumber = row.NextNumber ?? row.InitialNum ?? null;
  const padded = nextNumber == null ? "" : String(nextNumber).padStart(5, "0");

  return {
    series: String(row.Series),
    nextNumber,
    prefix: row.BeginStr || "",
    suffix: row.EndStr || "",
    indicator: row.Indicator || "",
    seriesName,
    isManual,
    formattedCode: isManual ? "" : `${row.BeginStr || ""}${padded}${row.EndStr || ""}`,
  };
};

const listBOMs = async (query = "", top = 50, skip = 0) => {
  const { top: limit, skip: offset } = pagingParams(top, skip);
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT Code, TreeType, Qauntity, Name, ToWH, PriceList, PlAvgSize
    FROM OITT
    WHERE @query = ''
      OR Code LIKE @like
      OR Name LIKE @like
    ORDER BY Code
    OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY
  `, { query: trimmed, like: `%${trimmed}%`, top: limit, skip: offset });

  return rows.map((row) => ({
    TreeCode: row.Code,
    TreeType: toTreeType(row.TreeType),
    Quantity: row.Qauntity ?? 1,
    ProductDescription: row.Name || "",
    Warehouse: row.ToWH || "",
    PriceList: row.PriceList ?? "",
    PlanAvgProdSize: row.PlAvgSize ?? 1,
  }));
};

const stagesOf = async (table, parentColumn, key) => {
  const rows = await queryRows(`
    SELECT S.StageId, S.SeqNum, S.StgEntry, S.Name, R.Code AS StageCode
    FROM ${table} S LEFT JOIN ORST R ON R.AbsEntry = S.StgEntry
    WHERE S.${parentColumn} = @key ORDER BY S.SeqNum`, { key });
  return rows.map((stage) => ({
    StageID: stage.StageId, SequenceNumber: stage.SeqNum, StageEntry: stage.StgEntry, Name: stage.Name || "", StageCode: stage.StageCode || "",
  }));
};

const getBOM = async (treeCode) => {
  const row = await queryOne(`
    SELECT T.*, I.PrdStdCst, P.Price AS ProductPrice, P.Currency AS ProductCurrency
    FROM OITT T
    LEFT JOIN OITM I ON I.ItemCode = T.Code
    LEFT JOIN ITM1 P ON P.ItemCode = T.Code AND P.PriceList = T.PriceList
    WHERE T.Code = @treeCode
  `, { treeCode });

  if (!row) return null;

  const lines = await queryRows(`
    SELECT L.*,
           COALESCE(NULLIF(I.ItemName, ''), NULLIF(R.ResName, '')) AS ItemMasterName,
           I.InvntryUom, I.PrdStdCst AS ComponentStdCost, I.AvgPrice AS ComponentAvgPrice,
           COALESCE(NULLIF(I.InvntryUom, ''), NULLIF(U.UomCode, ''), NULLIF(U.UomName, '')) AS UoMName
    FROM ITT1 L
    LEFT JOIN OITM I ON I.ItemCode = L.Code
    LEFT JOIN ORSC R ON R.ResCode = L.Code
    LEFT JOIN OUOM U ON U.UomEntry = I.IUoMEntry
    WHERE L.Father = @treeCode
    ORDER BY L.ChildNum
  `, { treeCode });

  return {
    ...mapBOMHeader(row),
    ProductTreeLines: lines.map(mapBOMLine),
    ProductTreeStages: await stagesOf("ITT2", "Father", treeCode),
  };
};

const lookupBOMItems = async (query = "") => {
  const trimmed = String(query || "").trim();
  const rows = await queryRows(`
    SELECT TOP 5000
      ItemCode,
      ItemName,
      InvntryUom AS InventoryUOM,
      PrchseItem AS PurchaseItem,
      SellItem AS SalesItem,
      InvntItem AS InventoryItem,
      OnHand AS QuantityOnStock,
      ItmsGrpCod AS ItemsGroupCode,
      WTLiable
    FROM OITM
    WHERE @query = ''
      OR ItemCode LIKE @like
      OR ItemName LIKE @like
    ORDER BY ItemCode
  `, { query: trimmed, like: `%${trimmed}%` });

  return rows.map((row) => ({
    ItemCode: row.ItemCode,
    ItemName: row.ItemName,
    InventoryUOM: row.InventoryUOM || "",
    PurchaseItem: toYesNo(row.PurchaseItem),
    SalesItem: toYesNo(row.SalesItem),
    InventoryItem: toYesNo(row.InventoryItem),
    QuantityOnStock: row.QuantityOnStock ?? 0,
    ItemsGroupCode: row.ItemsGroupCode ?? "",
    WTaxLiable: toYesNo(row.WTLiable),
  }));
};

const lookupBOMWarehouses = async () =>
  queryRows(`
    SELECT WhsCode AS WarehouseCode, WhsName AS WarehouseName
    FROM OWHS
    ORDER BY WhsCode
  `);

const lookupBOMPriceLists = async () =>
  queryRows(`
    SELECT ListNum AS PriceListNo, ListName AS PriceListName
    FROM OPLN
    ORDER BY ListNum
  `);

const lookupDistributionRules = async () =>
  queryRows(`
    SELECT TOP 200 OcrCode AS FactorCode, OcrName AS FactorDescription
    FROM OOCR
    WHERE ISNULL(Active, 'Y') <> 'N'
    ORDER BY OcrCode
  `);

const lookupProjects = async () =>
  queryRows(`
    SELECT TOP 100 PrjCode AS Code, PrjName AS Name
    FROM OPRJ
    ORDER BY PrjCode
  `);

const getBOMItemDetails = async (itemCode) => {
  const row = await queryOne(`
    SELECT TOP 1 ItemCode, ItemName, InvntryUom, DfltWH, ManSerNum, ManBtchNum, IssueMthd, PrdStdCst, AvgPrice
    FROM OITM
    WHERE ItemCode = @itemCode
  `, { itemCode });

  if (!row) return null;
  // Prices per price list, so a new BOM row shows its unit price before saving.
  const prices = await queryRows(`SELECT PriceList, Price, Currency FROM ITM1 WHERE ItemCode = @itemCode`, { itemCode });

  return {
    ItemCode: row.ItemCode,
    ItemName: row.ItemName || "",
    InventoryUOM: row.InvntryUom || "",
    DefaultWarehouse: row.DfltWH || "",
    DistributionRule: "",
    Project: "",
    ManageSerialNumbers: toYesNo(row.ManSerNum),
    ManageBatchNumbers: toYesNo(row.ManBtchNum),
    IssuePrimarilyBy: toIssueMethod(row.IssueMthd),
    ProductionStdCost: Number(row.PrdStdCst) > 0 ? Number(row.PrdStdCst) : Number(row.AvgPrice || 0),
    Prices: prices.map((price) => ({ PriceList: price.PriceList, Price: Number(price.Price || 0), Currency: price.Currency || "" })),
  };
};

module.exports = {
  getBranch,
  searchBranches,
  lookupBranchWarehouses,
  getWarehouse,
  searchWarehouses,
  lookupCountries,
  getCountryByCode,
  lookupStates,
  lookupWarehouseLocations,
  lookupBusinessPlaces,
  lookupGLAccounts,
  getPaymentTerms,
  searchPaymentTerms,
  getUoMGroup,
  searchUoMGroups,
  lookupUoMs,
  getTaxCode,
  searchTaxCodes,
  listTaxCodesForSetup,
  listTaxComponents,
  listTaxTypes,
  searchDocumentTaxCodes,
  getShippingType,
  searchShippingTypes,
  getPriceList,
  searchPriceLists,
  lookupPriceLists,
  lookupCurrencies,
  getAccount,
  searchAccounts,
  lookupParentAccounts,
  lookupTaxCodes,
  getBP,
  searchBP,
  lookupBPGroups,
  lookupPaymentTerms,
  getCreditCardByCode,
  lookupCreditCards,
  getWithholdingTaxCode,
  lookupWithholdingTaxCodes,
  getNextCreditCardCode,
  getBankByCode,
  lookupBanks,
  lookupHouseBankAccounts,
  lookupSalesPersons,
  lookupBPSeries,
  getBPSeriesNextNumber,
  listBOMs,
  getBOM,
  stagesOf,
  lookupBOMItems,
  lookupBOMWarehouses,
  lookupBOMPriceLists,
  lookupDistributionRules,
  lookupProjects,
  getBOMItemDetails,
};
