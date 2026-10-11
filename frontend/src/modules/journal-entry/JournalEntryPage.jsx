import SapDateInput from '../../components/common/SapDateInput';
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAccount, searchAccounts } from "../../api/chartOfAccountsApi";
import { getBP, searchBP } from "../../api/businessPartnerApi";
import {
  addJournalEntry,
  fetchJournalEntryByTransId,
  fetchJournalEntryReferenceData,
  fetchJournalRemarkTemplates,
} from "../../api/journalEntryApi";
import SapLookupModal from "../../components/common/SapLookupModal";
import FormSettingsPanel from "../../components/purchase-order/FormSettingsPanel";
import { useRelationshipMapRegistration } from "../../components/relationship-map/RelationshipMapHost";
import {
  JOURNAL_ENTRY_COLUMNS,
  JOURNAL_ENTRY_FORM_SETTINGS_STORAGE_KEY,
  readSavedBankingFormSettings,
} from "../../config/bankingFormSettings";
import { useCompanyScopedFormSettings } from "../../utils/formSettingsStorage";
import { getOrderedVisibleMatrixColumns } from "../../utils/formSettingsColumns";
import "../purchase-order/styles/purchaseOrder.css";
import "./journalEntry.css";

const today = new Date().toISOString().slice(0, 10);
const LOOKUP_MAX_ROWS = 5000;

const makeLine = (index) => ({
  id: `je-line-${index}-${Date.now()}`,
  accountCode: "",
  accountName: "",
  accountType: "account",
  debit: "",
  credit: "",
  remarks: "",
  taxCode: "",
  federalTaxId: "",
  taxAmount: "",
  receiptNumber: "",
  grossValue: "",
  primaryFormItem: "",
  materialType: "",
  gstComponent: "",
  distRule: "",
  location: "",
});

const makeLines = (count = 18) => Array.from({ length: count }, (_, index) => makeLine(index + 1));

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const parseAmount = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeAccount = (row = {}) => ({
  code: row.Code || row.code || "",
  name: row.Name || row.name || "",
  balance: row.Balance ?? row.balance ?? 0,
  inactive: row.ActiveAccount === "tNO" || row.Locked === "tYES" ? "Yes" : "No",
  level: row.Level || "",
});

const normalizeBusinessPartner = (row = {}) => ({
  code: row.CardCode || row.code || "",
  name: row.CardName || row.name || "",
  balance: row.Balance ?? row.balance ?? 0,
  type: row.CardType || row.type || "",
  inactive: row.Inactive || "No",
});

const blankHeader = () => ({
  series: "",
  number: "",
  postingDate: today,
  dueDate: today,
  documentDate: today,
  remarks: "",
  origin: "",
  originNo: "",
  transNo: "",
  templateType: "",
  template: "",
  indicator: "",
  project: "",
  transCode: "",
  reference1: "",
  reference2: "",
  reference3: "",
  location: "",
  blanketAgreement: "",
  revaluationRate: false,
  reverse: false,
  period13: false,
  exciseRegNo: false,
  automaticTax: false,
  displayInFc: false,
  displayInSc: false,
});

function AccountLookupModal({ open, query, onClose, onSelect }) {
  const [search, setSearch] = useState(query || "");

  useEffect(() => {
    if (!open) return;
    setSearch(query || "");
  }, [open, query]);

  const fetchAccounts = useCallback(async (nextSearch = "") => {
    const data = await searchAccounts(nextSearch, "", LOOKUP_MAX_ROWS, 0);
    return (data || []).map(normalizeAccount);
  }, []);

  const choose = (row) => {
    if (!row) return;
    onSelect(row);
    onClose();
  };

  return (
    <SapLookupModal
      open={open}
      title="List of Accounts"
      columns={[
        { key: "rowNumber", label: "#", width: 44, searchable: false, render: (_row, index) => index + 1 },
        { key: "code", label: "Account Number", width: 220 },
        { key: "name", label: "Account Name" },
        { key: "balance", label: "Account Balance", width: 160, align: "right", render: (row) => money(row.balance) },
        { key: "inactive", label: "Inactive", width: 120 },
      ]}
      fetchOptions={fetchAccounts}
      initialQuery={search}
      searchPlaceholder="Search accounts"
      emptyMessage="No matching accounts found"
      onQueryChange={setSearch}
      onClose={onClose}
      onSelect={choose}
      getRowKey={(row, index) => `${row.code}-${index}`}
      width="min(1180px, calc(100% - 40px))"
    />
  );
}

function BusinessPartnerLookupModal({ open, query, onClose, onSelect }) {
  const fetchPartners = useCallback(async (nextSearch = "") => {
    const data = await searchBP(nextSearch, "", LOOKUP_MAX_ROWS, 0);
    return (data || []).map(normalizeBusinessPartner);
  }, []);

  return (
    <SapLookupModal
      open={open}
      title="List of Business Partners"
      columns={[
        { key: "rowNumber", label: "#", width: 44, searchable: false, render: (_row, index) => index + 1 },
        { key: "name", label: "BP Name" },
        { key: "code", label: "BP Code", width: 180 },
        { key: "balance", label: "Account Balance", width: 180, align: "right", render: (row) => money(row.balance) },
        { key: "type", label: "BP Type", width: 140 },
      ]}
      fetchOptions={fetchPartners}
      initialQuery={query}
      searchPlaceholder="Search business partners"
      emptyMessage="No matching business partners found"
      onClose={onClose}
      onSelect={(row) => {
        onSelect(row);
        onClose();
      }}
      getRowKey={(row, index) => `${row.code}-${index}`}
      width="min(980px, calc(100% - 40px))"
    />
  );
}

function RemarkTemplateLookupModal({ open, onClose, onSelect }) {
  const fetchTemplates = useCallback(async (query = "") => {
    const templates = await fetchJournalRemarkTemplates(query);
    return Array.isArray(templates) ? templates : [];
  }, []);

  return (
    <SapLookupModal
      open={open}
      title="List of Remark Template"
      columns={[
        { key: "rowNumber", label: "#", width: 44, searchable: false, render: (_row, index) => index + 1 },
        { key: "description", label: "Template Description" },
      ]}
      fetchOptions={fetchTemplates}
      initialQuery=""
      searchPlaceholder="Search remark templates"
      emptyMessage="No remark templates are defined in SAP Business One"
      onClose={onClose}
      onSelect={(row) => {
        onSelect(row);
        onClose();
      }}
      getRowKey={(row, index) => `${row.id}-${index}`}
      width="min(640px, calc(100% - 40px))"
    />
  );
}

function Field({ label, children, wide = false }) {
  return (
    <label className={`po-field je-field${wide ? " je-field--wide" : ""}`}>
      <span className="po-field__label">{label}</span>
      {children}
    </label>
  );
}

function CheckboxField({ label, checked, onChange, disabled = false }) {
  return (
    <label className="po-checkbox-label je-checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

export default function JournalEntryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const requestedTransId = Number(location.state?.journalEntryTransId || 0);
  const [header, setHeader] = useState(blankHeader);
  const [lines, setLines] = useState(() => makeLines());
  const [activeTab, setActiveTab] = useState("contents");
  const [lookup, setLookup] = useState({ open: false, rowIndex: null, query: "" });
  const [bpLookup, setBpLookup] = useState({ open: false, rowIndex: null, query: "" });
  const [remarkLookup, setRemarkLookup] = useState({ open: false, rowIndex: null });
  const [contextMenu, setContextMenu] = useState(null);
  const [referenceData, setReferenceData] = useState({ series: [], remarkTemplates: [] });
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [currentTransId, setCurrentTransId] = useState(0);
  const [formSettings, setFormSettings, , , formSettingsStatus] = useCompanyScopedFormSettings(
    JOURNAL_ENTRY_FORM_SETTINGS_STORAGE_KEY,
    readSavedBankingFormSettings,
    [JOURNAL_ENTRY_COLUMNS],
    { saveMode: 'explicit' },
  );
  const [formSettingsOpen, setFormSettingsOpen] = useState(false);
  const hasLoadedEntry = Boolean(requestedTransId || currentTransId);
  const isViewMode = hasLoadedEntry;

  useEffect(() => {
    let ignore = false;
    fetchJournalEntryReferenceData(header.postingDate)
      .then((data) => {
        if (ignore) return;
        const nextReferenceData = {
          series: Array.isArray(data?.series) ? data.series : [],
          remarkTemplates: Array.isArray(data?.remarkTemplates) ? data.remarkTemplates : [],
        };
        setReferenceData(nextReferenceData);
        setHeader((current) => {
          if (requestedTransId) return current;
          const currentSeries = nextReferenceData.series.find((row) => String(row.series) === String(current.series));
          if (current.series && currentSeries) {
            return currentSeries.manual
              ? current
              : { ...current, number: String(currentSeries.nextNumber ?? "") };
          }
          const defaultSeries = nextReferenceData.series.find((row) => row.isDefault && !row.manual)
            || nextReferenceData.series.find((row) => !row.manual)
            || nextReferenceData.series[0];
          return defaultSeries
            ? { ...current, series: defaultSeries.series, number: String(defaultSeries.nextNumber ?? "") }
            : current;
        });
      })
      .catch((error) => {
        if (!ignore) {
          setMessage({
            type: "error",
            text: error?.response?.data?.message || "Could not load live Journal Entry series from SAP Business One.",
          });
        }
      });
    return () => {
      ignore = true;
    };
  }, [header.postingDate, requestedTransId]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!requestedTransId) return;
    let ignore = false;
    setSaving(true);
    fetchJournalEntryByTransId(requestedTransId)
      .then((journal) => {
        if (ignore) return;
        setHeader((current) => ({
          ...current,
          series: journal.series || current.series,
          number: journal.number || "",
          postingDate: journal.postingDate || today,
          dueDate: journal.dueDate || journal.postingDate || today,
          documentDate: journal.documentDate || journal.postingDate || today,
          remarks: journal.remarks || "",
          origin: journal.origin || "Journal Entry",
          originNo: journal.originNo || "",
          transNo: journal.transNo || requestedTransId,
          reference1: journal.reference1 || "",
          reference2: journal.reference2 || "",
          reference3: journal.reference3 || "",
        }));
        setLines((journal.lines || []).map((line, index) => ({
            ...makeLine(index + 1),
            accountCode: line.account || "",
            accountName: line.name || "",
            accountType: line.goldenArrowTarget === "businessPartner" ? "businessPartner" : "account",
            debit: line.debit ? String(line.debit) : "",
            credit: line.credit ? String(line.credit) : "",
            remarks: line.remarks || "",
            taxCode: line.taxCode || "",
            distRule: line.profitCenter || "",
            location: line.location || "",
          })));
        setCurrentTransId(requestedTransId);
        setMessage({ type: "success", text: `Journal Entry ${requestedTransId} loaded in view mode.` });
      })
      .catch((error) => {
        if (!ignore) setMessage({ type: "error", text: error?.response?.data?.message || "Failed to load Journal Entry." });
      })
      .finally(() => {
        if (!ignore) setSaving(false);
      });
    return () => {
      ignore = true;
    };
  }, [requestedTransId]);

  const totals = useMemo(() => {
    const totalDebit = lines.reduce((sum, line) => sum + parseAmount(line.debit), 0);
    const totalCredit = lines.reduce((sum, line) => sum + parseAmount(line.credit), 0);
    return {
      debit: totalDebit,
      credit: totalCredit,
      difference: totalDebit - totalCredit,
    };
  }, [lines]);
  useRelationshipMapRegistration({
    enabled: Boolean(currentTransId),
    objectType: 30,
    docEntry: currentTransId,
    header,
    total: totals.debit,
  });

  const setHeaderValue = (field, value) => {
    setHeader((prev) => ({ ...prev, [field]: value }));
  };

  const handleSeriesChange = (seriesValue) => {
    const selected = referenceData.series.find((row) => String(row.series) === String(seriesValue));
    setHeader((prev) => ({
      ...prev,
      series: seriesValue,
      number: selected?.manual ? "" : String(selected?.nextNumber ?? ""),
    }));
  };

  const updateLine = (rowIndex, field, value) => {
    setLines((prev) => {
      const next = prev.map((line, index) => {
        if (index !== rowIndex) return line;
        const updated = { ...line, [field]: value };
        if (field === "debit" && parseAmount(value) > 0) updated.credit = "";
        if (field === "credit" && parseAmount(value) > 0) updated.debit = "";
        return updated;
      });

      const lastLine = next[next.length - 1];
      if (lastLine && Object.values(lastLine).some((fieldValue, valueIndex) => valueIndex > 0 && String(fieldValue || "").trim())) {
        next.push(makeLine(next.length + 1));
      }
      return next;
    });
  };

  const selectAccount = (rowIndex, account) => {
    if (rowIndex == null) return;
    setLines((prev) => prev.map((line, index) => (
      index === rowIndex
        ? { ...line, accountCode: account.code, accountName: account.name, accountType: "account" }
        : line
    )));
  };

  const selectBusinessPartner = (rowIndex, partner) => {
    if (rowIndex == null) return;
    setLines((prev) => prev.map((line, index) => (
      index === rowIndex
        ? { ...line, accountCode: partner.code, accountName: partner.name, accountType: "businessPartner" }
        : line
    )));
  };

  const resolveAccount = async (rowIndex, value, mode = "code") => {
    const query = String(value || "").trim();
    if (!query) {
      setLines((prev) => prev.map((line, index) => (
        index === rowIndex ? { ...line, accountCode: "", accountName: "" } : line
      )));
      return;
    }

    try {
      if (mode === "code") {
        try {
          const account = normalizeAccount(await getAccount(query));
          if (account.code) {
            selectAccount(rowIndex, account);
            return;
          }
        } catch (_accountError) {
          const partner = normalizeBusinessPartner(await getBP(query));
          if (partner.code) {
            selectBusinessPartner(rowIndex, partner);
            return;
          }
        }
        return;
      }

      const matches = (await searchAccounts(query, "", 10, 0)).map(normalizeAccount);
      const exactMatch = matches.find((account) => account.name.toLowerCase() === query.toLowerCase()) || matches[0];
      if (exactMatch?.code) selectAccount(rowIndex, exactMatch);
    } catch (_error) {
      if (mode === "code") {
        setLines((prev) => prev.map((line, index) => (
          index === rowIndex ? { ...line, accountName: "" } : line
        )));
      }
    }
  };

  const openAccountLookup = (rowIndex, query = "") => {
    setLookup({ open: true, rowIndex, query });
  };

  const openBusinessPartnerLookup = (rowIndex, query = "") => {
    setBpLookup({ open: true, rowIndex, query });
  };

  const openAccountContextMenu = (event, rowIndex, query = "") => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, rowIndex, query });
  };

  const filledLines = lines
    .map((line) => ({
      ...line,
      debit: parseAmount(line.debit),
      credit: parseAmount(line.credit),
    }))
    .filter((line) => line.accountCode || line.accountName || line.debit || line.credit || line.remarks);

  const validate = () => {
    if (!filledLines.length) return "Enter at least one journal row.";
    if (filledLines.length < 2) return "Enter at least two journal rows.";
    if (filledLines.some((line) => !line.accountCode)) return "G/L Acct/BP Code is required on every entered row.";
    if (filledLines.some((line) => line.debit > 0 && line.credit > 0)) return "A row cannot have both debit and credit.";
    if (filledLines.some((line) => line.debit <= 0 && line.credit <= 0)) return "Every entered row must have debit or credit.";
    if (Math.abs(totals.difference) >= 0.005) return "Debit and credit totals must be equal.";
    return "";
  };

  const handleAdd = async () => {
    const validation = validate();
    if (validation) {
      setMessage({ type: "error", text: validation });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await addJournalEntry({
        header,
        lines: filledLines,
      });
      const postedTransId = result?.data?.TransId || result?.data?.JdtNum || 0;
      setHeader((prev) => ({
        ...prev,
        transNo: postedTransId || prev.transNo,
        number: result?.data?.Number || prev.number,
      }));
      if (postedTransId) setCurrentTransId(Number(postedTransId));
      setMessage({ type: "success", text: result?.message || "Journal Entry added successfully." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error.response?.data?.message || error.message || "Failed to add Journal Entry.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    const resetHeader = blankHeader();
    const defaultSeries = referenceData.series.find((row) => row.isDefault && !row.manual)
      || referenceData.series.find((row) => !row.manual)
      || referenceData.series[0];
    if (defaultSeries) {
      resetHeader.series = defaultSeries.series;
      resetHeader.number = String(defaultSeries.nextNumber ?? "");
    }
    setHeader(resetHeader);
    setLines(makeLines());
    setCurrentTransId(0);
    setActiveTab("contents");
    setMessage(null);
    navigate("/journal-entry", { replace: true, state: null });
  };

  const handlePrimaryAction = () => {
    if (isViewMode) {
      handleCancel();
      return;
    }
    handleAdd();
  };

  const currentSeriesKnown = referenceData.series.some((row) => String(row.series) === String(header.series));
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
  const visibleJournalColumns = (() => {
    const visibleColumns = getOrderedVisibleMatrixColumns(JOURNAL_ENTRY_COLUMNS, formSettings);
    return visibleColumns.length ? visibleColumns : JOURNAL_ENTRY_COLUMNS.slice(0, 1);
  })();
  const journalColumnCount = Math.max(1, visibleJournalColumns.length);
  const journalTableMinWidth = Math.max(
    640,
    visibleJournalColumns.reduce((sum, column) => sum + Number(column.minWidth || 90), 0),
  );
  const journalCellStyle = (column) => ({ width: `${column.minWidth || 90}px` });

  const renderJournalCell = (column, row, rowIndex) => {
    const active = isColumnActive(column.key);

    switch (column.key) {
      case "rowNumber":
        return <td className="je-row-number" style={journalCellStyle(column)}>{rowIndex + 1}</td>;
      case "accountCode":
        return (
          <td className="je-account-cell" style={journalCellStyle(column)}>
            <span className="je-account-picker">
              <input
                value={row.accountCode}
                disabled={!active || isViewMode}
                onChange={(event) => updateLine(rowIndex, "accountCode", event.target.value)}
                onBlur={(event) => resolveAccount(rowIndex, event.target.value, "code")}
                onDoubleClick={() => openAccountLookup(rowIndex, row.accountCode)}
                onContextMenu={(event) => openAccountContextMenu(event, rowIndex, row.accountCode)}
                onKeyDown={(event) => {
                  if (event.key === "F2") openAccountLookup(rowIndex, row.accountCode);
                  if (event.key === "Enter") resolveAccount(rowIndex, event.currentTarget.value, "code");
                }}
              />
              <button type="button" onClick={() => openAccountLookup(rowIndex, row.accountCode)} disabled={!active || isViewMode}>...</button>
            </span>
          </td>
        );
      case "accountName":
        return (
          <td className="je-account-cell je-account-cell--name" style={journalCellStyle(column)}>
            <span className="je-account-picker">
              <input
                value={row.accountName}
                disabled={!active || isViewMode}
                onChange={(event) => updateLine(rowIndex, "accountName", event.target.value)}
                onBlur={(event) => resolveAccount(rowIndex, event.target.value, "name")}
                onDoubleClick={() => openAccountLookup(rowIndex, row.accountName)}
                onKeyDown={(event) => {
                  if (event.key === "F2") openAccountLookup(rowIndex, row.accountName);
                  if (event.key === "Enter") resolveAccount(rowIndex, event.currentTarget.value, "name");
                }}
              />
              <button type="button" onClick={() => openAccountLookup(rowIndex, row.accountName)} disabled={!active || isViewMode}>...</button>
            </span>
          </td>
        );
      case "debit":
      case "credit":
      case "taxAmount":
      case "grossValue":
        return (
          <td style={journalCellStyle(column)}>
            <input
              className="je-amount"
              value={row[column.key]}
              disabled={!active || isViewMode}
              onChange={(event) => updateLine(rowIndex, column.key, event.target.value)}
            />
          </td>
        );
      case "remarks":
        return (
          <td className="je-account-cell" style={journalCellStyle(column)}>
            <span className="je-account-picker je-remark-picker">
              <input
                value={row.remarks}
                disabled={!active || isViewMode}
                onChange={(event) => updateLine(rowIndex, "remarks", event.target.value)}
                onDoubleClick={() => setRemarkLookup({ open: true, rowIndex })}
                onKeyDown={(event) => {
                  if (event.key === "F2") setRemarkLookup({ open: true, rowIndex });
                }}
              />
              <button
                type="button"
                aria-label="Choose remark template"
                title="List of Remark Template"
                onClick={() => setRemarkLookup({ open: true, rowIndex })}
                disabled={!active || isViewMode}
              >...</button>
            </span>
          </td>
        );
      default:
        return (
          <td style={journalCellStyle(column)}>
            <input
              value={row[column.key]}
              disabled={!active || isViewMode}
              onChange={(event) => updateLine(rowIndex, column.key, event.target.value)}
            />
          </td>
        );
    }
  };

  return (
    <div className={`po-page sap-document-page je-page${formSettingsOpen ? " po-page--sidebar-open" : ""}`}>
      <div className="po-toolbar sap-document-toolbar">
        <span className="po-toolbar__title sap-document-toolbar__title">
          Journal Entry{currentTransId ? ` - #${header.transNo || currentTransId}` : ""}
        </span>
        <button
          type="button"
          className="po-btn po-btn--primary sap-document-toolbar__primary"
          onClick={handlePrimaryAction}
          disabled={saving && !hasLoadedEntry}
        >
          {saving && !hasLoadedEntry ? "Loading..." : hasLoadedEntry ? "OK" : "Add"}
        </button>
        <button type="button" className="po-btn sap-document-toolbar__cancel" onClick={handleCancel}>Cancel</button>
        <button type="button" className="po-btn sap-document-toolbar__find" onClick={() => navigate("/journal-entry/find")}>Find</button>
        <button type="button" className="po-btn sap-document-toolbar__new" onClick={handleCancel}>New</button>
        <button type="button" className="po-btn sap-document-toolbar__settings" onClick={toggleFormSettings}>Form Settings</button>
      </div>

      {message && <div className={`po-alert po-alert--${message.type}`}>{message.text}</div>}

      <div className={`sap-banking-layout je-banking-layout${formSettingsOpen ? " is-sidebar-open" : ""}`}>
      <div className="sap-banking-layout__main">
      <div className="po-header-card je-header">
        <div className="je-header-grid">
          <Field label="Series">
            <select value={header.series} onChange={(event) => handleSeriesChange(event.target.value)} disabled={Boolean(currentTransId)}>
              {!header.series && <option value="">Loading series...</option>}
              {header.series && !currentSeriesKnown && <option value={header.series}>{header.series}</option>}
              {referenceData.series.map((series) => (
                <option key={series.series} value={series.series}>
                  {series.name}{series.indicator ? ` (${series.indicator})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Number"><input value={header.number} onChange={(event) => setHeaderValue("number", event.target.value)} readOnly={header.series !== "-1" || Boolean(currentTransId)} /></Field>
          <Field label="Posting Date"><SapDateInput  value={header.postingDate} onChange={(event) => setHeaderValue("postingDate", event.target.value)} disabled={isViewMode} /></Field>
          <Field label="Due Date"><SapDateInput  value={header.dueDate} onChange={(event) => setHeaderValue("dueDate", event.target.value)} disabled={isViewMode} /></Field>
          <Field label="Doc. Date"><SapDateInput  value={header.documentDate} onChange={(event) => setHeaderValue("documentDate", event.target.value)} disabled={isViewMode} /></Field>
          <Field label="Remarks" wide><input value={header.remarks} onChange={(event) => setHeaderValue("remarks", event.target.value)} readOnly={isViewMode} /></Field>

          <Field label="Origin"><input value={header.origin} onChange={(event) => setHeaderValue("origin", event.target.value)} readOnly /></Field>
          <Field label="Origin No."><input value={header.originNo} onChange={(event) => setHeaderValue("originNo", event.target.value)} readOnly /></Field>
          <Field label="Trans. No."><input value={header.transNo} onChange={(event) => setHeaderValue("transNo", event.target.value)} readOnly /></Field>
          <Field label="Template Type">
            <select value={header.templateType} onChange={(event) => setHeaderValue("templateType", event.target.value)} disabled={isViewMode}>
              <option value=""></option>
              <option value="Percentage">Percentage</option>
              <option value="Recurring Posting">Recurring Posting</option>
            </select>
          </Field>
          <Field label="Template"><input value={header.template} onChange={(event) => setHeaderValue("template", event.target.value)} readOnly /></Field>
          <Field label="Indicator">
            <select value={header.indicator} onChange={(event) => setHeaderValue("indicator", event.target.value)} disabled={isViewMode}>
              <option value=""></option>
              <option value="EM">EM - EXPELLER MAIZE (CRUDE) OIL</option>
              <option value="JV">JV - Journal Entry</option>
              <option value="MG">MG - MAIZE GERMS</option>
              <option value="MH">MH - MAIZE HUSK</option>
              <option value="RM">RM - REFINED MAIZE OIL</option>
              <option value="RS">RS - REFINED SOYA OIL</option>
            </select>
          </Field>
          <Field label="Project"><input value={header.project} onChange={(event) => setHeaderValue("project", event.target.value)} readOnly={isViewMode} /></Field>

          <Field label="Trans. Code">
            <select value={header.transCode} onChange={(event) => setHeaderValue("transCode", event.target.value)} disabled={isViewMode}>
              <option value=""></option>
              <option value="*">*</option>
              <option value="Maze">Maze</option>
            </select>
          </Field>
          <Field label="Ref. 1"><input value={header.reference1} onChange={(event) => setHeaderValue("reference1", event.target.value)} readOnly={isViewMode} /></Field>
          <Field label="Ref. 2"><input value={header.reference2} onChange={(event) => setHeaderValue("reference2", event.target.value)} readOnly={isViewMode} /></Field>
          <Field label="Ref. 3"><input value={header.reference3} onChange={(event) => setHeaderValue("reference3", event.target.value)} readOnly={isViewMode} /></Field>
          <Field label="Loc.">
            <select value={header.location} onChange={(event) => setHeaderValue("location", event.target.value)} disabled={isViewMode}>
              <option value=""></option>
            </select>
          </Field>
        </div>

        <div className="je-header-checks">
          <CheckboxField label="Revaluation Reporting Exch. Rate" checked={header.revaluationRate} onChange={(value) => setHeaderValue("revaluationRate", value)} disabled={isViewMode} />
          <CheckboxField label="Reverse" checked={header.reverse} onChange={(value) => setHeaderValue("reverse", value)} disabled={isViewMode} />
          <CheckboxField label="Adj. Trans. (Period 13)" checked={header.period13} onChange={(value) => setHeaderValue("period13", value)} disabled={isViewMode} />
          <CheckboxField label="Automatic Tax" checked={header.automaticTax} onChange={(value) => setHeaderValue("automaticTax", value)} disabled={isViewMode} />
        </div>

        <div className="je-header-bottom">
          <CheckboxField label="Generate Excise Reg. No." checked={header.exciseRegNo} onChange={(value) => setHeaderValue("exciseRegNo", value)} disabled={isViewMode} />
          <Field label="Blanket Agreement"><input value={header.blanketAgreement} onChange={(event) => setHeaderValue("blanketAgreement", event.target.value)} readOnly /></Field>
        </div>
      </div>

      <div className="po-tabs je-tabs">
        <button type="button" className={`po-tab${activeTab === "contents" ? " po-tab--active" : ""}`} onClick={() => setActiveTab("contents")}>Contents</button>
        <button type="button" className={`po-tab${activeTab === "attachments" ? " po-tab--active" : ""}`} onClick={() => setActiveTab("attachments")}>Attachments</button>
      </div>

      <div className="po-tab-panel je-tab-panel">
        {activeTab === "contents" ? (
          <>
            <button type="button" className="je-expand" disabled={isViewMode}>Expand Editing Mode</button>
            <div className="po-grid-wrap je-table-wrap">
              <table className="po-grid je-lines-table" style={{ minWidth: `${journalTableMinWidth}px` }}>
                <thead>
                  <tr>
                    {visibleJournalColumns.map((column) => (
                      <th key={column.key} style={journalCellStyle(column)}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row, rowIndex) => (
                    <tr key={row.id}>
                      {visibleJournalColumns.map((column) => (
                        <React.Fragment key={column.key}>{renderJournalCell(column, row, rowIndex)}</React.Fragment>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={journalColumnCount}>
                      Total Debit: {money(totals.debit)} | Total Credit: {money(totals.credit)} | Difference: {money(totals.difference)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <div className="je-attachments">
            <div className="po-grid-wrap je-table-wrap">
            <table className="po-grid je-lines-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Target Path</th>
                  <th>File Name</th>
                  <th>File Extension</th>
                  <th>File Size</th>
                  <th>Attachment Date</th>
                  <th>Attached By</th>
                  <th>Free Text</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 16 }, (_, index) => (
                  <tr key={index}>
                    <td className="je-row-number">{index + 1}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="je-attach-actions">
              <button type="button" className="po-btn" disabled={isViewMode}>Browse</button>
              <button type="button" className="po-btn" disabled>Display</button>
              <button type="button" className="po-btn" disabled>Delete</button>
            </div>
          </div>
        )}
      </div>

      <div className="je-footer">
        <CheckboxField label="Display in FC" checked={header.displayInFc} onChange={(value) => setHeaderValue("displayInFc", value)} disabled={isViewMode} />
        <CheckboxField label="Display in SC" checked={header.displayInSc} onChange={(value) => setHeaderValue("displayInSc", value)} disabled={isViewMode} />
        <div className="je-footer-right">
          <button type="button" className="po-btn" disabled={isViewMode}>Import From Excel</button>
          <button type="button" className="po-btn" disabled>Cancel Template</button>
        </div>
      </div>
      </div>

      <FormSettingsPanel
        variant="sidebar"
        className="sap-banking-layout__sidebar"
        isOpen={formSettingsOpen}
        onClose={() => setFormSettingsOpen(false)}
        matrixFields={JOURNAL_ENTRY_COLUMNS}
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

      <AccountLookupModal
        open={lookup.open}
        query={lookup.query}
        onClose={() => setLookup({ open: false, rowIndex: null, query: "" })}
        onSelect={(account) => selectAccount(lookup.rowIndex, account)}
      />

      <BusinessPartnerLookupModal
        open={bpLookup.open}
        query={bpLookup.query}
        onClose={() => setBpLookup({ open: false, rowIndex: null, query: "" })}
        onSelect={(partner) => selectBusinessPartner(bpLookup.rowIndex, partner)}
      />

      <RemarkTemplateLookupModal
        open={remarkLookup.open}
        onClose={() => setRemarkLookup({ open: false, rowIndex: null })}
        onSelect={(template) => updateLine(remarkLookup.rowIndex, "remarks", template.description)}
      />

      {contextMenu && (
        <div
          className="je-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              openAccountLookup(contextMenu.rowIndex, contextMenu.query);
              setContextMenu(null);
            }}
          >List of Accounts</button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              openBusinessPartnerLookup(contextMenu.rowIndex, contextMenu.query);
              setContextMenu(null);
            }}
          >List of Business Partners</button>
        </div>
      )}

    </div>
  );
}
