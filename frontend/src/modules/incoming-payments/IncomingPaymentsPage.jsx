import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  fetchIncomingPaymentByDocEntry,
  fetchIncomingPaymentOpenInvoices,
  fetchIncomingPaymentReferenceData,
  searchIncomingPaymentBusinessPartners,
  searchIncomingPaymentControlAccounts,
  submitIncomingPayment,
} from "../../api/incomingPaymentsApi";
import { useRelationshipMapRegistration } from "../../components/relationship-map/RelationshipMapHost";
import JournalEntryPreviewButton from "../../components/journal-entry/JournalEntryPreviewButton";
import DocumentStatusActions from "../../components/document/DocumentStatusActions";
import { getDocumentStatusMessage } from "../../utils/copyToState";
import FormSettingsPanel from "../../components/purchase-order/FormSettingsPanel";
import PaymentMeansModal, {
  createDefaultPaymentMeans,
  paymentMeansTotal,
  validatePaymentMeans,
} from "../payments/PaymentMeansModal";
import SapLookupModal from "../../components/common/SapLookupModal";
import {
  INCOMING_PAYMENTS_FORM_SETTINGS_STORAGE_KEY,
  PAYMENT_ACCOUNT_COLUMNS,
  PAYMENT_FORM_SETTINGS_COLUMNS,
  PAYMENT_INVOICE_COLUMNS,
  readSavedBankingFormSettings,
} from "../../config/bankingFormSettings";
import { consumePendingLookupQuery } from "../../utils/sapTabNavigation";
import { matchesSapSearchText } from "../../utils/sapSearch";
import { useCompanyScopedFormSettings } from "../../utils/formSettingsStorage";
import { getOrderedVisibleMatrixColumns } from "../../utils/formSettingsColumns";
import { getSapVisibleDocumentSeries } from "../../utils/seriesDefaults";
import "./incomingPayments.css";

const today = new Date().toISOString().slice(0, 10);

const formatSapDate = (value) => {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year.slice(2)}` : value;
};

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const parseAmount = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").replace(/^INR\s*/i, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const clampPayment = (value, balanceDue) => {
  const balance = parseAmount(balanceDue);
  const amount = parseAmount(value);
  if (balance < 0) return Math.max(balance, Math.min(0, amount));
  if (balance > 0) return Math.min(Math.max(0, amount), balance);
  return 0;
};

const normalizePercent = (value) => {
  const parsed = Math.max(0, parseAmount(value));
  return Math.min(parsed, 100);
};

const calculateDiscountedPayment = (invoice, percentValue = invoice.cashDiscountPercent) => {
  const balanceDue = parseAmount(invoice.balanceDue);
  const percent = normalizePercent(percentValue);
  return clampPayment(balanceDue * (1 - percent / 100), balanceDue).toFixed(2);
};

const sapBusinessPartnerLookupColumns = [
  { label: "BP Name", key: "name", width: 300 },
  { label: "BP Code", key: "code", width: 100 },
  { label: "BP Balance", key: "balance", align: "right", width: 110, render: (row) => money(row.balance) },
  { label: "BP Type", key: "bpType", width: 95 },
  { label: "Active", key: "active", width: 70 },
  { label: "Inactive", key: "inactive", width: 80 },
  { label: "Bill-to Block", key: "billToBlock", width: 190 },
  { label: "Bill-to Building/Floor/Room", key: "billToBuilding", width: 260 },
  { label: "GTS Registration Number", key: "gstRegistrationNumber", width: 220 },
];

function SapLookupField({
  value,
  onChange,
  onSelect,
  fetchOptions,
  columns,
  title,
  className = "",
  readOnly = false,
  buttonLabel = "...",
  triggerOpen = 0,
  onBlur = () => {},
  paginated = false,
  pageSize = 100,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, pageSize, totalCount: 0, totalPages: 1 });
  const allRowsRef = useRef([]);
  const requestRef = useRef(0);

  const load = async (nextQuery = "", nextPage = 1) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    try {
      const data = await fetchOptions(nextQuery, nextPage, pageSize);
      if (requestId !== requestRef.current) return;
      const nextRows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      if (paginated) {
        setRows(nextRows);
        setPage(data?.pagination?.page || nextPage);
        setPagination(data?.pagination || { page: nextPage, pageSize, totalCount: nextRows.length, totalPages: 1 });
        return;
      }
      const term = String(nextQuery || "").trim();
      if (!term) {
        allRowsRef.current = nextRows;
        setRows(nextRows);
      } else if (nextRows.length) {
        setRows(nextRows);
      } else {
        setRows(allRowsRef.current.filter((row) =>
          Object.values(row || {}).some((value) => matchesSapSearchText(value, term)),
        ));
      }
    } catch (_error) {
      if (requestId !== requestRef.current) return;
      const term = String(nextQuery || "").trim();
      setRows(term
        ? allRowsRef.current.filter((row) =>
          Object.values(row || {}).some((value) => matchesSapSearchText(value, term)),
        )
        : []);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  const openModal = () => {
    if (readOnly) return;
    const pendingQuery = consumePendingLookupQuery();
    setOpen(true);
    setQuery(pendingQuery);
    setPage(1);
    load(pendingQuery, 1);
  };

  useEffect(() => {
    if (triggerOpen > 0) openModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerOpen]);

  useEffect(() => {
    if (!open || !paginated) return undefined;
    const timer = window.setInterval(() => load(query, page), 15000);
    return () => window.clearInterval(timer);
    // Refresh live SAP master data while the lookup remains open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paginated, query, page]);

  const pick = (row) => {
    if (!row) return;
    Promise.resolve(onSelect(row)).finally(() => {
      setOpen(false);
      window.SapB1TabNavigation?.completeLookup?.();
    });
  };

  const closeModal = () => {
    setOpen(false);
    window.SapB1TabNavigation?.restoreLookup?.();
  };

  const handleQueryChange = (nextQuery) => {
    setQuery(nextQuery);
    setPage(1);
    load(nextQuery, 1);
  };

  const rowColumns = useMemo(() => [
    {
      key: "rowNumber",
      label: "#",
      width: 44,
      searchable: false,
      render: (_row, index) => (paginated ? ((page - 1) * pagination.pageSize) + index + 1 : index + 1),
    },
    ...columns,
  ], [columns, page, paginated, pagination.pageSize]);

  const footerNote = paginated
    ? (pagination.totalCount
      ? `Showing ${((page - 1) * pagination.pageSize) + 1}-${Math.min(page * pagination.pageSize, pagination.totalCount)} of ${pagination.totalCount}`
      : "Showing 0")
    : undefined;

  const footerControls = paginated ? (
    <>
      <button type="button" className="sap-lookup-modal__btn" onClick={() => load(query, page)} disabled={loading}>Refresh</button>
      <button type="button" className="sap-lookup-modal__btn" onClick={() => load(query, page - 1)} disabled={loading || page <= 1}>Previous</button>
      <span>Page {page} of {pagination.totalPages}</span>
      <button type="button" className="sap-lookup-modal__btn" onClick={() => load(query, page + 1)} disabled={loading || page >= pagination.totalPages}>Next</button>
    </>
  ) : null;

  return (
    <>
      <span className={`sap-lookup ${className}`}>
        <input value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} readOnly={readOnly} />
        <button
          type="button"
          className="sap-lookup__arrow"
          data-sap-lookup-button="true"
          onClick={openModal}
          disabled={readOnly}
        >
          {buttonLabel}
        </button>
      </span>

      {open ? (
        <SapLookupModal
          open
          title={`List of ${title}`}
          columns={rowColumns}
          rows={rows}
          loading={loading}
          initialQuery={query}
          searchPlaceholder="Search by code, name, or type..."
          emptyMessage="No matching records found"
          footerNote={footerNote}
          footerControls={footerControls}
          onQueryChange={handleQueryChange}
          onClose={closeModal}
          onSelect={pick}
          getRowKey={(row, index) => `${row.code || row.docEntry || index}-${index}`}
          width="min(1180px, calc(100% - 40px))"
          portalTarget={() => document.querySelector(".ip-payment-means-layer") || document.querySelector(".app-shell__content") || document.body}
        />
      ) : null}
    </>
  );
}

const FieldRow = ({ label, children }) => (
  <label className="sap-field-row">
    <span>{label}</span>
    {children}
  </label>
);

const getBranchRegNo = (branches = [], branchCode = "") => {
  const branch = branches.find((item) => String(item.code) === String(branchCode));
  return branch?.branchRegNo || branch?.vatRegNum || branch?.taxIdNum || "";
};

const normalizeDistributionRules = (rows = []) =>
  (rows || [])
    .map((rule) => ({
      code: String(rule.code ?? rule.FactorCode ?? rule.OcrCode ?? rule.DistributionRule ?? "").trim(),
      name: String(rule.name ?? rule.FactorDescription ?? rule.OcrName ?? rule.Description ?? "").trim(),
    }))
    .filter((rule) => rule.code);

const normalizeLocations = (rows = []) =>
  (rows || [])
    .map((location) => ({
      code: String(location.code ?? location.Code ?? location.LocationCode ?? "").trim(),
      name: String(location.name ?? location.Location ?? location.Name ?? "").trim(),
    }))
    .filter((location) => location.code);

export default function IncomingPaymentsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedDocEntry = Number(location.state?.incomingPaymentDocEntry || 0);
  const createInitialHeader = (branch = "", transactionNumber = "", series = {}) => ({
    businessPartnerCode: "",
    businessPartnerName: "",
    bpType: "Customer",
    seriesCode: series.code || "",
    seriesName: series.name || "",
    documentNumber: series.nextNumber || "",
    billToCode: "",
    billToAddress: "",
    contactPerson: "",
    project: "",
    docCurrency: "INR",
    blanketAgreement: "",
    postingDate: today,
    dueDate: today,
    documentDate: today,
    referenceNumber: "",
    transactionNumber,
    branch,
    branchRegNo: "",
    referencedDocument: "",
    wtTaxCode: "",
    wtTaxBaseSum: "",
    controlAccount: "",
    controlAccountName: "",
    cashAccount: "",
    cashAccountName: "",
  });

  const [header, setHeader] = useState({
    businessPartnerCode: "",
    businessPartnerName: "",
    bpType: "Customer",
    seriesCode: "",
    seriesName: "",
    documentNumber: "",
    billToCode: "",
    billToAddress: "",
    contactPerson: "",
    project: "",
    docCurrency: "INR",
    blanketAgreement: "",
    postingDate: today,
    dueDate: today,
    documentDate: today,
    referenceNumber: "",
    transactionNumber: "",
    branch: "",
    branchRegNo: "",
    referencedDocument: "",
    wtTaxCode: "",
    wtTaxBaseSum: "",
    controlAccount: "",
    controlAccountName: "",
    cashAccount: "",
    cashAccountName: "",
  });
  const [branches, setBranches] = useState([]);
  const [documentSeries, setDocumentSeries] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [accountRows, setAccountRows] = useState([]);
  const [distributionRules, setDistributionRules] = useState([]);
  const [locations, setLocations] = useState([]);
  const [currentDocEntry, setCurrentDocEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [posting, setPosting] = useState(false);
  const [paymentOnAccount, setPaymentOnAccount] = useState(false);
  const [paymentOnAccountAmount, setPaymentOnAccountAmount] = useState("0.00");
  const [accountDistributionRule, setAccountDistributionRule] = useState("");
  const [accountLocation, setAccountLocation] = useState("");
  const [wtTaxAmount, setWtTaxAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [journalRemarks, setJournalRemarks] = useState("");
  const [bpLookupTrigger, setBpLookupTrigger] = useState(0);
  const [paymentMeansOpen, setPaymentMeansOpen] = useState(false);
  const [paymentMeans, setPaymentMeans] = useState(() => createDefaultPaymentMeans());
  const [formSettings, setFormSettings, , , formSettingsStatus] = useCompanyScopedFormSettings(
    INCOMING_PAYMENTS_FORM_SETTINGS_STORAGE_KEY,
    readSavedBankingFormSettings,
    [PAYMENT_FORM_SETTINGS_COLUMNS],
    { saveMode: 'explicit' },
  );
  const [formSettingsOpen, setFormSettingsOpen] = useState(false);
  const routedDocumentRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    fetchIncomingPaymentReferenceData()
      .then((data) => {
        if (!mounted) return;
        const seriesRows = data.series || [];
        const defaultSeries =
          seriesRows.find((series) => series.code === data.defaultSeriesCode) ||
          seriesRows.find((series) => series.isDefault) ||
          seriesRows[0] ||
          null;
        const branchRows = data.branches || [];
        const defaultCashAccount = data.defaultCashAccount || "";
        setBranches(branchRows);
        setDocumentSeries(seriesRows);
        setDistributionRules(normalizeDistributionRules(data.distributionRules || data.distribution_rules || []));
        setLocations(normalizeLocations(data.locations || []));
        setHeader((current) => {
          const selectedBranch = current.branch || branchRows[0]?.code || "";
          return {
            ...current,
            seriesCode: current.seriesCode || defaultSeries?.code || "",
            seriesName: current.seriesName || defaultSeries?.name || "",
            documentNumber: current.documentNumber || data.nextDocumentNumber || defaultSeries?.nextNumber || "",
            transactionNumber: data.nextTransactionNumber || current.transactionNumber,
            branch: selectedBranch,
            branchRegNo: getBranchRegNo(branchRows, selectedBranch),
            cashAccount: current.cashAccount || defaultCashAccount,
          };
        });
        setPaymentMeans((current) => ({
          ...current,
          currency: current.currency || "INR",
          cash: {
            ...(current.cash || {}),
            account: current.cash?.account || defaultCashAccount,
          },
        }));
      })
      .catch(() => {
        if (mounted) setLoadError("Reference data could not be loaded.");
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedTotal = useMemo(
    () =>
      invoices.reduce((sum, invoice) => {
        if (!invoice.selected) return sum;
        return sum + clampPayment(invoice.totalPayment, invoice.balanceDue);
      }, 0),
    [invoices],
  );

  const accountRowsTotal = useMemo(
    () => accountRows.reduce((sum, row) => sum + parseAmount(row.amount), 0),
    [accountRows],
  );
  const isFoundDocument = Boolean(currentDocEntry);
  const paymentOnAccountDue = header.bpType === "Account" || paymentOnAccount ? parseAmount(paymentOnAccountAmount) : 0;
  const totalAmountDue = accountRows.length
    ? accountRowsTotal
    : selectedTotal + paymentOnAccountDue;
  const openBalance = Math.max(0, paymentOnAccountDue);
  useRelationshipMapRegistration({
    enabled: Boolean(currentDocEntry),
    objectType: 24,
    docEntry: currentDocEntry,
    header,
    total: totalAmountDue,
  });

  const getPayableInvoiceTotal = (rows = invoices) =>
    rows.reduce((sum, invoice) => {
      if (!invoice.selected) return sum;
      const payment = clampPayment(invoice.totalPayment, invoice.balanceDue);
      return sum + payment;
    }, 0);

  const updateHeader = (field, value) => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setHeader((current) => ({ ...current, [field]: value }));
  };

  const changeSeries = (value) => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    if (value === "Manual") {
      setHeader((current) => ({
        ...current,
        seriesCode: "Manual",
        seriesName: "Manual",
        documentNumber: "",
      }));
      return;
    }

    const selectedSeries = documentSeries.find((series) => series.code === value);
    setHeader((current) => ({
      ...current,
      seriesCode: selectedSeries?.code || value,
      seriesName: selectedSeries?.name || "",
      documentNumber: selectedSeries?.nextNumber || current.documentNumber,
    }));
  };

  const normalizeInvoices = (rows = []) =>
    rows.map((row) => ({
      ...row,
      selected: false,
      cashDiscountPercent: "0.00",
      totalPayment: money(parseAmount(row.totalPayment ?? row.balanceDue)),
    }));

  const changeBpType = (bpType) => {
    if (isFoundDocument) return;
    setLoadError("");
    setSuccessMessage("");
    setInvoices([]);
    setAccountRows([]);
    setPaymentOnAccount(bpType === "Account");
    setPaymentOnAccountAmount("0.00");
    setPaymentMeans(createDefaultPaymentMeans({ currency: header.docCurrency || "INR" }));
    setAccountDistributionRule("");
    setAccountLocation("");
    setHeader((current) => ({
      ...current,
      bpType,
      businessPartnerCode: "",
      businessPartnerName: "",
      billToCode: "",
      billToAddress: "",
      contactPerson: "",
      blanketAgreement: "",
      docCurrency: current.docCurrency || "INR",
      controlAccount: "",
      controlAccountName: "",
    }));
    setJournalRemarks("");
  };

  const loadInvoices = async (cardCode, branch = header.branch) => {
    if (!cardCode) {
      setInvoices([]);
      return;
    }

    setLoading(true);
    setLoadError("");
    setSuccessMessage("");
    try {
      const rows = await fetchIncomingPaymentOpenInvoices(cardCode, branch);
      setInvoices(normalizeInvoices(rows || []));
      const firstControlAccount = rows?.find((row) => row.controlAccount)?.controlAccount || "";
      if (firstControlAccount) {
        setHeader((current) => ({
          ...current,
          controlAccount: current.controlAccount || firstControlAccount,
        }));
      }
    } catch (_error) {
      setLoadError("Open invoices could not be loaded for this business partner.");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  const changeBranch = (value) => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setHeader((current) => ({
      ...current,
      branch: value,
      branchRegNo: getBranchRegNo(branches, value),
    }));
    if (header.bpType === "Customer" && header.businessPartnerCode) {
      loadInvoices(header.businessPartnerCode, value);
    } else {
      setInvoices([]);
    }
  };

  const handleBusinessPartnerSelect = (row) => {
    if (isFoundDocument) return;
    setLoadError("");
    setSuccessMessage("");
    const partnerCurrency = row.currency && row.currency !== "##" ? row.currency : header.docCurrency || "INR";
    setHeader((current) => ({
      ...current,
      businessPartnerCode: row.code,
      businessPartnerName: row.name,
      billToCode: row.billToCode || current.billToCode,
      billToAddress: row.billToAddress || "",
      contactPerson: row.contactPerson || "",
      controlAccount: row.controlAccount || current.controlAccount,
      docCurrency: partnerCurrency,
    }));
    setPaymentOnAccount(false);
    setPaymentOnAccountAmount("0.00");
    setPaymentMeans(createDefaultPaymentMeans({
      currency: partnerCurrency,
      cashAccount: header.cashAccount || paymentMeans.cash?.account || "",
    }));
    setJournalRemarks(`Incoming Payments - ${row.code}`);
    if (header.bpType === "Customer") {
      loadInvoices(row.code);
    } else {
      setInvoices([]);
      setSuccessMessage(
        header.bpType === "Vendor"
          ? "Vendor selected. SAP B1 incoming payments for vendors are used for return/refund scenarios."
          : "Account selected. Enter Payment on Account and cash details before posting.",
      );
    }
  };

  const handleAccountSelect = (row) => {
    if (isFoundDocument) return;
    setLoadError("");
    setSuccessMessage("");
    setInvoices([]);
    setPaymentOnAccount(true);
    setAccountDistributionRule("");
    setAccountLocation("");
    setHeader((current) => ({
      ...current,
      businessPartnerCode: row.code,
      businessPartnerName: row.name,
      controlAccount: row.code,
    }));
    setJournalRemarks(`Incoming Payments - ${row.code}`);
  };

  const clearAccountSelection = () => {
    setHeader((current) => ({
      ...current,
      businessPartnerCode: "",
      businessPartnerName: "",
      controlAccount: "",
      controlAccountName: "",
    }));
  };

  const resolveAccountCode = async (value) => {
    if (isFoundDocument) return null;
    const accountCode = String(value || "").trim();
    if (!accountCode) {
      clearAccountSelection();
      return null;
    }

    try {
      const rows = await searchIncomingPaymentControlAccounts(accountCode);
      const match = (rows || []).find((row) => String(row.code || "").trim().toUpperCase() === accountCode.toUpperCase());
      if (!match) {
        clearAccountSelection();
        setLoadError(`G/L Account ${accountCode} is not a posting account. Choose a posting G/L account from the lookup, same as SAP B1.`);
        return null;
      }

      setLoadError("");
      setSuccessMessage("");
      setInvoices([]);
      setPaymentOnAccount(true);
      setHeader((current) => ({
        ...current,
        businessPartnerCode: match.code,
        businessPartnerName: match.name,
        controlAccount: match.code,
        controlAccountName: match.name,
      }));
      setJournalRemarks(`Incoming Payments - ${match.code}`);
      return match;
    } catch (_error) {
      clearAccountSelection();
      setLoadError(`G/L Account ${accountCode} could not be validated. Choose a posting G/L account from the lookup.`);
      return null;
    }
  };

  const toggleInvoice = (id, selected) => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === id
          ? {
              ...invoice,
              selected,
              cashDiscountPercent: selected ? normalizePercent(invoice.cashDiscountPercent).toFixed(2) : invoice.cashDiscountPercent,
              totalPayment: selected ? calculateDiscountedPayment(invoice) : "0.00",
            }
          : invoice,
      ),
    );
  };

  const changePayment = (id, value) => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === id
          ? {
              ...invoice,
              selected: Math.abs(parseAmount(value)) > 0 ? true : invoice.selected,
              totalPayment: value,
            }
          : invoice,
      ),
    );
  };

  const settlePayment = (id) => {
    if (isFoundDocument) return;
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === id
          ? {
              ...invoice,
              totalPayment: clampPayment(invoice.totalPayment, invoice.balanceDue).toFixed(2),
            }
          : invoice,
      ),
    );
  };

  const changeCashDiscount = (id, value) => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setInvoices((current) =>
      current.map((invoice) => {
        if (invoice.id !== id) return invoice;
        const percent = normalizePercent(value);
        return {
          ...invoice,
          selected: true,
          cashDiscountPercent: value,
          totalPayment: calculateDiscountedPayment(invoice, percent),
        };
      }),
    );
  };

  const settleCashDiscount = (id) => {
    if (isFoundDocument) return;
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === id
          ? {
              ...invoice,
              cashDiscountPercent: normalizePercent(invoice.cashDiscountPercent).toFixed(2),
              totalPayment: invoice.selected ? calculateDiscountedPayment(invoice) : invoice.totalPayment,
            }
          : invoice,
      ),
    );
  };

  const changeDistributionRule = (id, value) => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === id
          ? {
              ...invoice,
              distributionRule: value,
            }
          : invoice,
      ),
    );
  };

  const openInvoiceDocument = (invoice) => {
    if (!invoice?.documentNo) return;
    setSuccessMessage(`A/R Invoice ${invoice.documentNo} selected for reference.`);
  };

  const selectAll = () => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setInvoices((current) =>
      current.map((invoice) => ({
        ...invoice,
        selected: true,
        cashDiscountPercent: normalizePercent(invoice.cashDiscountPercent).toFixed(2),
        totalPayment: calculateDiscountedPayment(invoice),
      })),
    );
  };

  const deselectAll = () => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setInvoices((current) => current.map((invoice) => ({ ...invoice, selected: false, totalPayment: "0.00" })));
  };

  const openBusinessPartnerLookup = ({ clearMessages = true } = {}) => {
    if (clearMessages) {
      setLoadError("");
      setSuccessMessage("");
    }
    setBpLookupTrigger((value) => value + 1);
  };

  const openFind = () => {
    setLoadError("");
    setSuccessMessage("");
    navigate("/incoming-payments/find");
  };

  const handleIncomingPaymentSelect = async (row) => {
    setLoadError("");
    setSuccessMessage("");
    setLoading(true);
    try {
      const payment = row.docEntry ? await fetchIncomingPaymentByDocEntry(row.docEntry) : row;
      const selectedBranch = payment.branch || header.branch;
      const postedAccountRows = payment.accountRows || [];
      setAccountDistributionRule(postedAccountRows[0]?.distributionRule || "");
      setAccountLocation(postedAccountRows[0]?.location || "");
      setHeader((current) => ({
        ...current,
        businessPartnerCode: payment.businessPartnerCode || "",
        businessPartnerName: payment.businessPartnerName || "",
        bpType: postedAccountRows.length ? "Account" : current.bpType,
        billToCode: payment.billToCode || current.billToCode,
        billToAddress: payment.billToAddress || "",
        postingDate: payment.postingDate || current.postingDate,
        dueDate: payment.dueDate || payment.postingDate || current.dueDate,
        documentDate: payment.documentDate || current.documentDate,
        referenceNumber: payment.referenceNumber || "",
        transactionNumber: payment.transactionNumber || current.transactionNumber,
        documentNumber: payment.documentNo || payment.code || current.documentNumber,
        branch: selectedBranch || current.branch,
        branchRegNo: getBranchRegNo(branches, selectedBranch || current.branch),
        controlAccount: postedAccountRows[0]?.accountCode || current.controlAccount,
        controlAccountName: postedAccountRows[0]?.accountName || current.controlAccountName,
      }));
      const postedInvoices = (payment.invoices || []).map((invoice) => ({
        ...invoice,
        selected: true,
        cashDiscountPercent: invoice.cashDiscountPercent ?? "0.00",
        totalPayment: money(invoice.totalPayment),
      }));
      setInvoices(postedInvoices);
      setAccountRows(postedAccountRows);
      setCurrentDocEntry(payment.docEntry || row.docEntry || null);
      setJournalRemarks(payment.journalRemarks || `Incoming Payments - ${payment.businessPartnerCode || payment.code}`);
      setRemarks(payment.remarks || "");
      const postedAccountTotal = postedAccountRows.reduce((sum, account) => sum + parseAmount(account.amount), 0);
      const hasPaymentOnAccount = postedAccountRows.length > 0 || Number(payment.paymentOnAccountAmount || 0) > 0;
      setPaymentOnAccount(hasPaymentOnAccount);
      setPaymentOnAccountAmount(money(hasPaymentOnAccount ? payment.paymentOnAccountAmount || postedAccountTotal || payment.totalAmount : 0));
      setSuccessMessage(`Incoming payment ${payment.documentNo || payment.code} loaded in view mode.`);
    } catch (error) {
      setLoadError(getErrorMessage(error, "Incoming payment could not be loaded."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!requestedDocEntry || routedDocumentRef.current === requestedDocEntry) return;
    routedDocumentRef.current = requestedDocEntry;
    handleIncomingPaymentSelect({ docEntry: requestedDocEntry });
  }, [requestedDocEntry]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    const selectedSeries =
      documentSeries.find((series) => series.code === header.seriesCode) ||
      documentSeries.find((series) => series.isDefault) ||
      documentSeries[0] ||
      {};
    setHeader((current) => createInitialHeader(current.branch, current.transactionNumber, selectedSeries));
    setInvoices([]);
    setAccountRows([]);
    setCurrentDocEntry(null);
    setPaymentOnAccount(false);
    setPaymentOnAccountAmount("0.00");
    setPaymentMeans(createDefaultPaymentMeans({ currency: header.docCurrency || "INR" }));
    setAccountDistributionRule("");
    setAccountLocation("");
    setWtTaxAmount("");
    setRemarks("");
    setJournalRemarks("");
    setLoadError("");
    setSuccessMessage("");
  };

  const clearDraftAfterPost = (message) => {
    const selectedSeries =
      documentSeries.find((series) => series.code === header.seriesCode) ||
      documentSeries.find((series) => series.isDefault) ||
      documentSeries[0] ||
      {};
    setHeader((current) => ({
      ...createInitialHeader(current.branch, current.transactionNumber, selectedSeries),
      bpType: current.bpType,
      seriesCode: current.seriesCode || selectedSeries.code || "",
      seriesName: current.seriesName || selectedSeries.name || "",
      branch: current.branch,
      branchRegNo: current.branchRegNo,
      cashAccount: current.cashAccount,
      cashAccountName: current.cashAccountName,
    }));
    setInvoices([]);
    setAccountRows([]);
    setCurrentDocEntry(null);
    setPaymentOnAccount(header.bpType === "Account");
    setPaymentOnAccountAmount("0.00");
    setAccountDistributionRule("");
    setAccountLocation("");
    setWtTaxAmount("");
    setRemarks("");
    setJournalRemarks("");
    setLoadError("");
    setSuccessMessage(message);
  };

  const addInSequence = () => {
    if (isFoundDocument) return;
    setSuccessMessage("");
    setInvoices((current) => {
      const nextIndex = current.findIndex((invoice) => !invoice.selected && !invoice.blocked);
      if (nextIndex < 0) return current;

      return current.map((invoice, index) =>
        index === nextIndex
          ? {
              ...invoice,
              selected: true,
              totalPayment: calculateDiscountedPayment(invoice),
            }
          : invoice,
      );
    });
  };

  const getErrorMessage = (error, fallback) => {
    const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.message;
    if (typeof detail === "string") return detail;
    if (detail?.error?.message?.value) return detail.error.message.value;
    if (detail?.error?.message) return detail.error.message;
    return fallback;
  };

  const openPaymentMeans = () => {
    if (isFoundDocument) return;
    setPaymentMeans((current) => ({
      ...current,
      currency: header.docCurrency || current.currency || "INR",
      cash: {
        ...(current.cash || {}),
        account: current.cash?.account || header.cashAccount || "",
      },
    }));
    setPaymentMeansOpen(true);
  };

  const getPostingPaymentMeans = (payableTotal) => {
    const error = validatePaymentMeans(paymentMeans, payableTotal);
    if (error) {
      setLoadError(error);
      setPaymentMeansOpen(true);
      return null;
    }
    return paymentMeans;
  };

  const handleOk = async () => {
    setLoadError("");
    setSuccessMessage("");

    if (isFoundDocument) {
      setLoadError("Found incoming payments are display-only, like SAP B1.");
      return;
    }

    const isAccountPayment = header.bpType === "Account";

    if (!header.businessPartnerCode) {
      setLoadError(
        isAccountPayment
          ? "Select a G/L Account in the contents grid before adding the incoming payment."
          : "Select a business partner before adding the incoming payment.",
      );
      if (!isAccountPayment) openBusinessPartnerLookup({ clearMessages: false });
      return;
    }

    const resolvedAccount = isAccountPayment ? await resolveAccountCode(header.businessPartnerCode) : null;
    if (isAccountPayment && !resolvedAccount) return;
    const postingHeader = resolvedAccount
      ? {
          ...header,
          businessPartnerCode: resolvedAccount.code,
          businessPartnerName: resolvedAccount.name,
          controlAccount: resolvedAccount.code,
          controlAccountName: resolvedAccount.name,
        }
      : header;

    const payableInvoiceTotal = isAccountPayment ? 0 : getPayableInvoiceTotal();
    const accountPaymentAmount = parseAmount(paymentOnAccountAmount);
    const payableTotal = payableInvoiceTotal + (isAccountPayment || paymentOnAccount ? accountPaymentAmount : 0);

    if (payableTotal <= 0) {
      setLoadError(isAccountPayment ? "Enter an Amount in the account contents row before posting." : "Select at least one document or enter a Payment on Account amount.");
      return;
    }

    const postingPaymentMeans = getPostingPaymentMeans(payableTotal);
    if (!postingPaymentMeans) return;

    const invalidPayment = invoices.some(
      (invoice) => invoice.selected && Math.abs(clampPayment(invoice.totalPayment, invoice.balanceDue)) <= 0.01,
    );

    if (invalidPayment) {
      setLoadError("Selected documents must have a Total Payment amount.");
      return;
    }

    const payableInvoices = invoices
      .filter((invoice) => invoice.selected)
      .map((invoice) => {
        const payment = clampPayment(invoice.totalPayment, invoice.balanceDue);
        return Math.abs(payment) > 0.01
          ? {
              ...invoice,
              selected: true,
              cashDiscountPercent: normalizePercent(invoice.cashDiscountPercent).toFixed(2),
              totalPayment: payment.toFixed(2),
            }
          : invoice;
      })
      .filter((invoice) => Math.abs(clampPayment(invoice.totalPayment, invoice.balanceDue)) > 0.01);

    setInvoices((current) =>
      current.map((invoice) => {
        const match = payableInvoices.find((item) => item.id === invoice.id);
        return match || invoice;
      }),
    );

    const payload = {
      header: postingHeader,
      invoices: payableInvoices,
      paymentOnAccount: {
        enabled: isAccountPayment || paymentOnAccount,
        amount: paymentOnAccountAmount,
        remarks,
        distributionRule: accountDistributionRule,
        location: accountLocation,
      },
      wtTaxAmount,
      paymentMeans: postingPaymentMeans,
      remarks,
      journalRemarks,
    };

    setPosting(true);
    try {
      const response = await submitIncomingPayment(payload);
      const docNo = response?.doc_num || response?.DocNum;
      clearDraftAfterPost(
        docNo
          ? `Incoming payment posted to SAP. Doc No: ${docNo}.`
          : "Incoming payment posted to SAP.",
      );
    } catch (error) {
      setLoadError(getErrorMessage(error, "Incoming payment submission failed."));
    } finally {
      setPosting(false);
    }
  };

  const branchName = branches.find((branch) => branch.code === header.branch)?.name || "";
  const getRuleName = (code) => distributionRules.find((rule) => String(rule.code) === String(code))?.name || "";
  const getLocationName = (code) => locations.find((location) => String(location.code) === String(code))?.name || "";
  const findDistributionRules = async (query = "") => {
    const term = String(query || "").trim();
    if (!term) return distributionRules;
    return distributionRules.filter((rule) =>
      matchesSapSearchText(`${rule.code} ${rule.name}`, term),
    );
  };
  const isCustomer = header.bpType === "Customer";
  const isVendor = header.bpType === "Vendor";
  const isAccount = header.bpType === "Account";
  const draftAccountRow = {
    id: "account-draft",
    accountCode: header.businessPartnerCode || header.controlAccount,
    accountName: header.businessPartnerName || header.controlAccountName,
    remarks,
    amount: paymentOnAccountAmount,
    distributionRule: accountDistributionRule,
    location: accountLocation,
    branch: header.branch,
    isDraft: true,
  };
  const displayAccountRows = accountRows.length
    ? accountRows
    : isAccount
      ? [draftAccountRow]
      : [];
  const showAccountContentGrid = isAccount;
  const partnerLookupTitle = isVendor ? "Vendors" : isAccount ? "G/L Accounts" : "Business Partners";
  const partnerAddressLabel = isVendor ? "Pay To" : "Bill To";
  const changePaymentOnAccount = (checked) => {
    if (isFoundDocument || isAccount) return;
    setLoadError("");
    setSuccessMessage("");
    setPaymentOnAccount(checked);
    if (!checked) setPaymentOnAccountAmount("0.00");
  };

  const confirmPaymentMeans = (means) => {
    const paid = paymentMeansTotal(means);
    const shouldCreateAdvance =
      header.bpType === "Customer" &&
      !paymentOnAccount &&
      Math.abs(selectedTotal) <= 0.01 &&
      paid > 0;

    if (shouldCreateAdvance) {
      setPaymentOnAccount(true);
      setPaymentOnAccountAmount(money(paid));
    }

    setLoadError("");
    setPaymentMeansOpen(false);
  };

  const updateFormSetting = (groupKey, fieldKey, prop, value) => setFormSettings((previous) => ({
    ...previous,
    [groupKey]: {
      ...(previous[groupKey] || {}),
      [fieldKey]: {
        ...((previous[groupKey] || {})[fieldKey] || {}),
        [prop]: value,
      },
    },
  }));
  const toggleFormSettings = () => setFormSettingsOpen((open) => !open);
  const isColumnActive = (columnKey) => formSettings.matrixColumns?.[columnKey]?.active !== false;
  const getVisibleColumns = (columns) => {
    const visibleColumns = getOrderedVisibleMatrixColumns(columns, formSettings);
    return visibleColumns.length ? visibleColumns : columns.slice(0, 1);
  };
  const visibleInvoiceColumns = getVisibleColumns(PAYMENT_INVOICE_COLUMNS);
  const visibleAccountColumns = getVisibleColumns(PAYMENT_ACCOUNT_COLUMNS);
  const invoiceColumnCount = Math.max(1, visibleInvoiceColumns.length);
  const accountColumnCount = Math.max(1, visibleAccountColumns.length);
  const getTableMinWidth = (columns, fallback) =>
    Math.max(fallback, columns.reduce((total, column) => total + Number(column.minWidth || 90), 0));
  const cellStyle = (column) => ({ minWidth: `${column.minWidth || 90}px` });

  const renderAccountCell = (column, row, index, isDraftRow) => {
    const active = isColumnActive(column.key);

    switch (column.key) {
      case "accountRowNumber":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{index + 1}</td>;
      case "accountCode":
        return (
          <td className={isDraftRow ? "sap-cell--editable" : "sap-cell--readonly"} style={cellStyle(column)}>
            {isDraftRow ? (
              <SapLookupField
                value={row.accountCode}
                onChange={(value) =>
                  setHeader((current) => ({
                    ...current,
                    businessPartnerCode: value,
                    controlAccount: value,
                    businessPartnerName: "",
                    controlAccountName: "",
                  }))
                }
                onBlur={() => resolveAccountCode(row.accountCode)}
                onSelect={handleAccountSelect}
                fetchOptions={searchIncomingPaymentControlAccounts}
                title="G/L Accounts"
                columns={[{ label: "Code", key: "code" }, { label: "Name", key: "name" }]}
                readOnly={!active}
              />
            ) : (
              <span className="sap-link-cell">{row.accountCode}</span>
            )}
          </td>
        );
      case "accountName":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{row.accountName}</td>;
      case "accountRemarks":
        return (
          <td className={isDraftRow ? "sap-cell--editable" : "sap-cell--readonly"} style={cellStyle(column)}>
            {isDraftRow ? (
              <input className="sap-account-text-input" value={remarks} onChange={(event) => setRemarks(event.target.value)} disabled={!active} />
            ) : row.remarks}
          </td>
        );
      case "accountAmount":
        return (
          <td className={isDraftRow ? "sap-money sap-cell--editable" : "sap-money sap-cell--readonly"} style={cellStyle(column)}>
            {isDraftRow ? (
              <input
                className="sap-cell-input"
                value={paymentOnAccountAmount}
                disabled={!active}
                onChange={(event) => {
                  setPaymentOnAccount(true);
                  setPaymentOnAccountAmount(event.target.value);
                }}
                onBlur={() => setPaymentOnAccountAmount(money(parseAmount(paymentOnAccountAmount)))}
              />
            ) : `INR ${money(row.amount)}`}
          </td>
        );
      case "accountDistributionRule":
        return (
          <td className={isDraftRow ? "sap-cell--editable" : "sap-cell--readonly"} style={cellStyle(column)}>
            {isDraftRow ? (
              <select value={accountDistributionRule} onChange={(event) => setAccountDistributionRule(event.target.value)} disabled={!active}>
                <option value=""></option>
                {distributionRules.map((rule) => (
                  <option key={rule.code} value={rule.code}>{rule.code} - {rule.name}</option>
                ))}
              </select>
            ) : row.distributionRule ? `${row.distributionRule}${getRuleName(row.distributionRule) ? ` - ${getRuleName(row.distributionRule)}` : ""}` : ""}
          </td>
        );
      case "accountLocation":
        return (
          <td className={isDraftRow ? "sap-cell--editable" : "sap-cell--readonly"} style={cellStyle(column)}>
            {isDraftRow ? (
              <select value={accountLocation} onChange={(event) => setAccountLocation(event.target.value)} disabled={!active}>
                <option value=""></option>
                {locations.map((location) => (
                  <option key={location.code} value={location.code}>{location.code} - {location.name}</option>
                ))}
              </select>
            ) : row.location ? `${row.location}${getLocationName(row.location) ? ` - ${getLocationName(row.location)}` : ""}` : (row.branch ? `${row.branch} - ${branchName}` : branchName)}
          </td>
        );
      default:
        return null;
    }
  };

  const renderInvoiceCell = (column, invoice) => {
    const active = isColumnActive(column.key);

    switch (column.key) {
      case "selected":
        return <td className="sap-cell--editable" style={cellStyle(column)}><input type="checkbox" checked={Boolean(invoice.selected)} disabled={!active} onChange={(event) => toggleInvoice(invoice.id, event.target.checked)} /></td>;
      case "documentNo":
        return (
          <td className="sap-cell--readonly" style={cellStyle(column)}>
            <button type="button" className="sap-doc-arrow" onClick={() => openInvoiceDocument(invoice)} disabled={!active}>-&gt;</button>
            <span className="sap-link-cell">{invoice.documentNo}</span>
          </td>
        );
      case "installment":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{invoice.installment || "1 of 1"}</td>;
      case "documentType":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{invoice.documentTypeCode || (invoice.documentType === "A/R Invoice" ? "IN" : invoice.documentType)}</td>;
      case "date":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{formatSapDate(invoice.date)}</td>;
      case "dueDate":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{formatSapDate(invoice.dueDate)}</td>;
      case "marker":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>*</td>;
      case "overdueDays":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{invoice.overdueDays}</td>;
      case "total":
        return <td className="sap-money sap-cell--readonly" style={cellStyle(column)}>{money(invoice.total)}</td>;
      case "wTaxAmount":
        return <td className="sap-money sap-cell--readonly" style={cellStyle(column)}>0.00</td>;
      case "balanceDue":
        return <td className="sap-money sap-cell--readonly" style={cellStyle(column)}>{money(invoice.balanceDue)}</td>;
      case "blocked":
        return <td className="sap-cell--editable" style={cellStyle(column)}><input type="checkbox" disabled={!active} /></td>;
      case "cashDiscountPercent":
        return (
          <td className="sap-cell--editable" style={cellStyle(column)}>
            <input
              className="sap-cell-input"
              value={invoice.cashDiscountPercent ?? "0.00"}
              disabled={!active}
              onChange={(event) => changeCashDiscount(invoice.id, event.target.value)}
              onBlur={() => settleCashDiscount(invoice.id)}
            />
          </td>
        );
      case "totalRoundingAmount":
        return <td className="sap-money sap-cell--readonly" style={cellStyle(column)}></td>;
      case "totalPayment":
        return (
          <td style={cellStyle(column)}>
            <input
              className="sap-cell-input"
              value={invoice.totalPayment ?? ""}
              disabled={!active}
              onChange={(event) => changePayment(invoice.id, event.target.value)}
              onBlur={() => settlePayment(invoice.id)}
            />
          </td>
        );
      case "distributionRule":
        return (
          <td className="sap-cell--editable" style={cellStyle(column)}>
            <SapLookupField
              value={invoice.distributionRule || ""}
              onChange={(value) => changeDistributionRule(invoice.id, value)}
              onSelect={(row) => changeDistributionRule(invoice.id, row.code)}
              fetchOptions={findDistributionRules}
              title="Distribution Rules"
              columns={[{ label: "Code", key: "code" }, { label: "Name", key: "name" }]}
              readOnly={!active}
            />
          </td>
        );
      case "paymentOrderRun":
        return <td className="sap-cell--readonly" style={cellStyle(column)}><input type="checkbox" checked={Boolean(invoice.paymentOrderRun)} readOnly /></td>;
      case "branch":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{invoice.branchDisplay || (invoice.branch ? `${invoice.branch} - ${invoice.branchName || branchName}` : "")}</td>;
      case "blanketAgreement":
        return <td className="sap-cell--readonly" style={cellStyle(column)}>{header.blanketAgreement}</td>;
      default:
        return null;
    }
  };

  return (
    <div className="po-page sap-document-page ip-payments-page">
      <div className="po-toolbar">
        <span className="po-toolbar__title">Incoming Payments{isFoundDocument ? ` - #${header.documentNumber}` : ""}</span>
        <button type="button" className="po-btn po-btn--primary" onClick={handleOk} disabled={posting || isFoundDocument}>
          {posting ? "Posting..." : "OK"}
        </button>
        <JournalEntryPreviewButton
          documentType="incomingPayment"
          documentLabel="Incoming Payment"
          docEntry={currentDocEntry}
          buildPayload={() => ({ header, invoices, paymentMeans, selectedTotal })}
          disabled={posting}
          className="po-btn sap-document-toolbar__journal-preview"
        />
        <button type="button" className="po-btn" onClick={resetForm} disabled={posting}>Cancel</button>
<button type="button" className="po-btn" data-sap-find-action onClick={openFind}>Find</button>
        <DocumentStatusActions
          type="incoming-payments"
          docEntry={currentDocEntry}
          actions={['cancel']}
          className="po-btn"
          disabled={posting || loading}
          onDone={async (action) => {
            await handleIncomingPaymentSelect({ docEntry: currentDocEntry });
            setSuccessMessage(getDocumentStatusMessage(action));
          }}
          onError={setLoadError}
        />
        <button type="button" className="po-btn sap-document-toolbar__settings" onClick={toggleFormSettings}>Form Settings</button>
        <button type="button" className="po-btn" onClick={deselectAll} disabled={posting || isFoundDocument}>Deselect All</button>
        <button type="button" className="po-btn" onClick={selectAll} disabled={posting || isFoundDocument}>Select All</button>
        <button type="button" className="po-btn" onClick={addInSequence} disabled={posting || isFoundDocument}>Add in Sequence</button>
      </div>
      {loadError ? <div className="sap-alert sap-alert--top">{loadError}</div> : null}
      {successMessage ? <div className="sap-alert sap-alert--success sap-alert--top">{successMessage}</div> : null}

      <div className={`sap-banking-layout${formSettingsOpen ? " is-sidebar-open" : ""}`}>
      <div className="sap-banking-layout__main">
      <fieldset className={`sap-window sap-readonly-fieldset${isFoundDocument ? " sap-window--readonly" : ""}`} disabled={isFoundDocument}>
        <div className="sap-header-area">
          <div className="sap-header-left">
            <div className="sap-bp-row">
              <div>
                {isAccount ? (
                  <div className="sap-account-header-space" aria-hidden="true" />
                ) : (
                  <>
                    <FieldRow label="Code">
                      <SapLookupField
                        value={header.businessPartnerCode}
                        onChange={(value) => updateHeader("businessPartnerCode", value)}
                        onSelect={handleBusinessPartnerSelect}
                        fetchOptions={(query, page, pageSize) => searchIncomingPaymentBusinessPartners(query, header.bpType, page, pageSize)}
                        title={partnerLookupTitle}
                        columns={sapBusinessPartnerLookupColumns}
                        triggerOpen={bpLookupTrigger}
                        paginated
                      />
                    </FieldRow>
                    <FieldRow label="Name">
                      <input value={header.businessPartnerName} onChange={(event) => updateHeader("businessPartnerName", event.target.value)} />
                    </FieldRow>
                  <FieldRow label={partnerAddressLabel}>
                    <div className="sap-bill-to">
                      <select value={header.billToCode} onChange={(event) => updateHeader("billToCode", event.target.value)}>
                        <option value={header.billToCode}>{header.billToCode || partnerAddressLabel}</option>
                      </select>
                      <textarea value={header.billToAddress} onChange={(event) => updateHeader("billToAddress", event.target.value)} />
                    </div>
                  </FieldRow>
                  </>
                )}
              </div>

              <div className="sap-radio-stack">
                {["Customer", "Vendor", "Account"].map((type) => (
                  <label key={type}>
                    <input
                      type="radio"
                      name="ip-bp-type"
                      checked={header.bpType === type}
                      onChange={() => changeBpType(type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>

            {!isAccount ? (
              <FieldRow label="Contact Person">
                <input value={header.contactPerson} onChange={(event) => updateHeader("contactPerson", event.target.value)} />
              </FieldRow>
            ) : null}
            <FieldRow label="Project">
              <SapLookupField
                value={header.project}
                onChange={(value) => updateHeader("project", value)}
                onSelect={(row) => updateHeader("project", row.code)}
                fetchOptions={async () => []}
                title="Projects"
                columns={[{ label: "Code", key: "code" }, { label: "Name", key: "name" }]}
              />
            </FieldRow>
            {isAccount ? (
              <FieldRow label="Doc. Currency">
                <select value={header.docCurrency} onChange={(event) => updateHeader("docCurrency", event.target.value)}>
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
              </FieldRow>
            ) : null}
            {isCustomer ? (
              <FieldRow label="Blanket Agreement">
                <input value={header.blanketAgreement} onChange={(event) => updateHeader("blanketAgreement", event.target.value)} />
              </FieldRow>
            ) : null}
          </div>

          <div className="sap-header-right">
            <FieldRow label="No.">
              <div className="sap-dual">
                <select value={header.seriesCode || ""} onChange={(event) => changeSeries(event.target.value)}>
                  {!documentSeries.length ? <option value="">Series</option> : null}
                  {getSapVisibleDocumentSeries(documentSeries, {
                    selectedSeries: header.seriesCode,
                    postingDate: header.postingDate || header.documentDate,
                  }).map((series) => (
                    <option key={series.code} value={series.code}>{series.name}</option>
                  ))}
                  <option value="Manual">Manual</option>
                </select>
                <input
                  value={header.documentNumber}
                  readOnly={header.seriesCode !== "Manual"}
                  onChange={(event) => updateHeader("documentNumber", event.target.value)}
                />
              </div>
            </FieldRow>
            <FieldRow label="Posting Date">
              <input data-sap-date-input="true" aria-label="Posting Date" value={formatSapDate(header.postingDate)} onChange={(event) => updateHeader("postingDate", event.target.value)} readOnly={isFoundDocument} />
            </FieldRow>
            <FieldRow label="Due Date">
              <input data-sap-date-input="true" aria-label="Due Date" value={formatSapDate(header.dueDate)} onChange={(event) => updateHeader("dueDate", event.target.value)} readOnly={isFoundDocument} />
            </FieldRow>
            <FieldRow label="Document Date">
              <input data-sap-date-input="true" aria-label="Document Date" value={formatSapDate(header.documentDate)} onChange={(event) => updateHeader("documentDate", event.target.value)} readOnly={isFoundDocument} />
            </FieldRow>
            <FieldRow label="Reference">
              <input value={header.referenceNumber} onChange={(event) => updateHeader("referenceNumber", event.target.value)} />
            </FieldRow>
            <FieldRow label="Transaction No.">
              <SapLookupField
                value={header.transactionNumber}
                onChange={(value) => updateHeader("transactionNumber", value)}
                onSelect={(row) => updateHeader("transactionNumber", row.code)}
                fetchOptions={async () => [{ code: header.transactionNumber || "2562", name: "Current Transaction" }]}
                title="Transactions"
                columns={[{ label: "No.", key: "code" }, { label: "Description", key: "name" }]}
              />
            </FieldRow>
            <FieldRow label="WTax Code">
              <input value={header.wtTaxCode} onChange={(event) => updateHeader("wtTaxCode", event.target.value)} />
            </FieldRow>
            <FieldRow label="WTax Base Sum">
              <input value={header.wtTaxBaseSum} onChange={(event) => updateHeader("wtTaxBaseSum", event.target.value)} />
            </FieldRow>
          </div>
        </div>

        <div className="sap-mid-row">
          <FieldRow label="Branch">
            <select value={header.branch} onChange={(event) => changeBranch(event.target.value)}>
              <option value="">Branch</option>
              {branches.map((branch) => (
                <option key={branch.code} value={branch.code}>{branch.code} - {branch.name}</option>
              ))}
            </select>
          </FieldRow>
          <div className="sap-branch-right">
            <FieldRow label="Branch Reg. No.">
              <input value={header.branchRegNo} onChange={(event) => updateHeader("branchRegNo", event.target.value)} />
            </FieldRow>
            <FieldRow label="Referenced Document">
              <SapLookupField
                value={header.referencedDocument}
                onChange={(value) => updateHeader("referencedDocument", value)}
                onSelect={(row) => updateHeader("referencedDocument", row.code)}
                fetchOptions={async () => []}
                title="Referenced Documents"
                columns={[{ label: "Document", key: "code" }, { label: "Name", key: "name" }]}
              />
            </FieldRow>
          </div>
        </div>

        <div className="sap-tabs">
          <button type="button" className="is-active">Contents</button>
          <button type="button">Attachments</button>
        </div>

        <section className={`sap-grid-wrap${showAccountContentGrid ? " sap-grid-wrap--account" : ""}`}>
          {showAccountContentGrid ? (
            <table className="sap-grid sap-account-grid" style={{ minWidth: `${getTableMinWidth(visibleAccountColumns, 640)}px` }}>
              <thead>
                <tr>
                  {visibleAccountColumns.map((column) => (
                    <th key={column.key} style={cellStyle(column)}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayAccountRows.map((row, index) => {
                  const isDraftRow = row.isDraft && !isFoundDocument;
                  return (
                    <tr key={row.id || `${row.accountCode}-${index}`}>
                      {visibleAccountColumns.map((column) => (
                        <React.Fragment key={column.key}>{renderAccountCell(column, row, index, isDraftRow)}</React.Fragment>
                      ))}
                    </tr>
                  );
                })}
                {Array.from({ length: Math.max(3, 5 - displayAccountRows.length) }).map((_, index) => (
                  <tr key={`account-blank-${index}`} className="sap-blank-row">
                    {Array.from({ length: accountColumnCount }).map((__, colIndex) => <td key={colIndex}></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
          <table className="sap-grid" style={{ minWidth: `${getTableMinWidth(visibleInvoiceColumns, 840)}px` }}>
            <thead>
              <tr>
                {visibleInvoiceColumns.map((column) => (
                  <th key={column.key} style={cellStyle(column)}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={invoiceColumnCount} className="sap-empty">Loading open invoices...</td></tr>
              ) : invoices.length ? (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className={invoice.selected ? "is-selected" : ""}>
                    {visibleInvoiceColumns.map((column) => (
                      <React.Fragment key={column.key}>{renderInvoiceCell(column, invoice)}</React.Fragment>
                    ))}
                    {false && (
                      <>
                    <td className="sap-cell--editable"><input type="checkbox" checked={Boolean(invoice.selected)} onChange={(event) => toggleInvoice(invoice.id, event.target.checked)} /></td>
                    <td className="sap-cell--readonly">
                      <button type="button" className="sap-doc-arrow" onClick={() => openInvoiceDocument(invoice)}>→</button>
                      <span className="sap-link-cell">{invoice.documentNo}</span>
                    </td>
                    <td className="sap-cell--readonly">{invoice.installment || "1 of 1"}</td>
                    <td className="sap-cell--readonly">{invoice.documentTypeCode || (invoice.documentType === "A/R Invoice" ? "IN" : invoice.documentType)}</td>
                    <td className="sap-cell--readonly">{formatSapDate(invoice.date)}</td>
                    <td className="sap-cell--readonly">{formatSapDate(invoice.dueDate)}</td>
                    <td className="sap-cell--readonly">*</td>
                    <td className="sap-cell--readonly">{invoice.overdueDays}</td>
                    <td className="sap-money sap-cell--readonly">{money(invoice.total)}</td>
                    <td className="sap-money sap-cell--readonly">0.00</td>
                    <td className="sap-money sap-cell--readonly">{money(invoice.balanceDue)}</td>
                    <td className="sap-cell--editable"><input type="checkbox" /></td>
                    <td className="sap-cell--editable">
                      <input
                        className="sap-cell-input"
                        value={invoice.cashDiscountPercent ?? "0.00"}
                        onChange={(event) => changeCashDiscount(invoice.id, event.target.value)}
                        onBlur={() => settleCashDiscount(invoice.id)}
                      />
                    </td>
                    <td className="sap-money sap-cell--readonly"></td>
                    <td>
                      <input
                        className="sap-cell-input"
                        value={invoice.totalPayment ?? ""}
                        onChange={(event) => changePayment(invoice.id, event.target.value)}
                        onBlur={() => settlePayment(invoice.id)}
                      />
                    </td>
                    <td className="sap-cell--editable">
                      <SapLookupField
                        value={invoice.distributionRule || ""}
                        onChange={(value) => changeDistributionRule(invoice.id, value)}
                        onSelect={(row) => changeDistributionRule(invoice.id, row.code)}
                        fetchOptions={findDistributionRules}
                        title="Distribution Rules"
                        columns={[{ label: "Code", key: "code" }, { label: "Name", key: "name" }]}
                      />
                    </td>
                    <td className="sap-cell--readonly"><input type="checkbox" checked={Boolean(invoice.paymentOrderRun)} readOnly /></td>
                    <td className="sap-cell--readonly">{invoice.branchDisplay || (invoice.branch ? `${invoice.branch} - ${invoice.branchName || branchName}` : "")}</td>
                    <td className="sap-cell--readonly">{header.blanketAgreement}</td>
                      </>
                    )}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={invoiceColumnCount} className="sap-empty">
                    {isAccount
                      ? "Account payment mode does not display BP invoices. Use Payment on Account."
                      : isVendor
                        ? "Vendor mode does not display customer A/R invoices."
                        : header.businessPartnerCode
                          ? `No open invoices found${header.branch ? ` for branch ${header.branch} - ${branchName}` : ""}.`
                          : "Choose a customer to display invoices."}
                  </td>
                </tr>
              )}
              {Array.from({ length: Math.max(4, 8 - invoices.length) }).map((_, index) => (
                <tr key={`blank-${index}`} className="sap-blank-row">
                  {Array.from({ length: invoiceColumnCount }).map((__, colIndex) => <td key={colIndex}></td>)}
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </section>

        <div className="sap-payment-row">
          <div className="sap-payment-on-account">
            <label>
              <input type="checkbox" checked={isAccount || paymentOnAccount} disabled={isAccount || isFoundDocument} onChange={(event) => changePaymentOnAccount(event.target.checked)} />
              <span>Payment on Account</span>
            </label>
            <input
              value={paymentOnAccountAmount}
              inputMode="decimal"
              aria-label="Payment on Account amount"
              disabled={isFoundDocument}
              onChange={(event) => {
                setLoadError("");
                if (!isAccount && parseAmount(event.target.value) > 0) {
                  setPaymentOnAccount(true);
                }
                setPaymentOnAccountAmount(event.target.value);
              }}
              onBlur={() => {
                const amount = parseAmount(paymentOnAccountAmount);
                if (!isAccount && amount <= 0) setPaymentOnAccount(false);
                setPaymentOnAccountAmount(money(amount));
              }}
            />
          </div>
        </div>

        <div className="sap-footer-area">
          <div className="sap-footer-left">
            <FieldRow label="Remarks">
              <input className="sap-yellow" value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </FieldRow>
            <FieldRow label="Journal Remarks">
              <input value={journalRemarks} onChange={(event) => setJournalRemarks(event.target.value)} />
            </FieldRow>
            {isAccount || paymentOnAccount ? (
              <FieldRow label="Control Account">
                <SapLookupField
                  value={header.controlAccount}
                  onChange={(value) => updateHeader("controlAccount", value)}
                  onSelect={(row) =>
                    setHeader((current) => ({ ...current, controlAccount: row.code, controlAccountName: row.name }))
                  }
                  fetchOptions={searchIncomingPaymentControlAccounts}
                  title="G/L Accounts"
                  columns={[{ label: "Code", key: "code" }, { label: "Name", key: "name" }]}
                />
              </FieldRow>
            ) : null}
            <label className="sap-created">
              <input type="checkbox" disabled />
              <span>Created by Payment Wizard</span>
            </label>
          </div>

          <div className="sap-summary">
            <FieldRow label="WTax Amount">
              <input value={wtTaxAmount} onChange={(event) => setWtTaxAmount(event.target.value)} onBlur={() => setWtTaxAmount(money(parseAmount(wtTaxAmount)))} />
            </FieldRow>
            <FieldRow label="Total Amount Due">
              <div className="sap-amount-with-button">
                <input value={`INR ${money(totalAmountDue)}`} readOnly />
                <button type="button" onClick={openPaymentMeans} disabled={isFoundDocument}>...</button>
              </div>
            </FieldRow>
            <FieldRow label="Open Balance">
              <input value={openBalance ? `INR ${money(openBalance)}` : ""} readOnly />
            </FieldRow>
          </div>
        </div>
      </fieldset>
      </div>
      <FormSettingsPanel
        variant="sidebar"
        className="sap-banking-layout__sidebar"
        isOpen={formSettingsOpen}
        onClose={() => setFormSettingsOpen(false)}
        matrixFields={PAYMENT_FORM_SETTINGS_COLUMNS}
        headerUdfFields={[]}
        rowUdfFields={[]}
        formSettings={formSettings}
          onSettingChange={updateFormSetting}
          onColumnOrderChange={formSettingsStatus.reorder}
          settingsLoaded={formSettingsStatus.loaded}
          isSaving={formSettingsStatus.saving}
          hasUnsavedChanges={formSettingsStatus.hasUnsavedChanges}
          saveError={formSettingsStatus.error}
          onSave={formSettingsStatus.save}
          onCancel={formSettingsStatus.discard}
          settingsScopeLabel={formSettingsStatus.scopeLabel}
      />
      </div>
      <PaymentMeansModal
        open={paymentMeansOpen}
        value={paymentMeans}
        totalAmountDue={totalAmountDue}
        allowPaidAsTotalDue={header.bpType === "Customer"}
        onChange={setPaymentMeans}
        onClose={() => setPaymentMeansOpen(false)}
        onConfirm={confirmPaymentMeans}
        lookupAccounts={searchIncomingPaymentControlAccounts}
        AccountLookupField={SapLookupField}
      />
    </div>
  );
}
