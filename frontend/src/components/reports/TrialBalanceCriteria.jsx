import SapDateInput from '../common/SapDateInput';
import React, { useState } from "react";

const ACCOUNT_GROUPS = [
  { code: 1, name: "Asset" },
  { code: 2, name: "Liability" },
  { code: 3, name: "Equity" },
  { code: 4, name: "Revenue" },
  { code: 5, name: "Expenditure" },
];

const ORIGINAL_JOURNALS = [
  "Returns", "A/R Down Payment", "Delivery", "A/R Invoice", "A/R Credit Memo",
  "Goods Receipt PO", "Goods Return", "A/P Down Payment", "A/P Invoice",
  "A/P Credit Memo", "Landed Costs", "Outgoing Excise Invoice",
  "Incoming Excise Invoice", "Self Invoice", "Self Credit Memo", "TDS Adjustment",
  "Incoming Payment", "Deposit", "Outgoing Payment", "Checks for Payment",
  "Opening Balance", "Closing Balance",
];

const groupOptions = (items = []) => [
  { code: "All", name: "All" },
  ...items,
  { code: "None", name: "None" },
];

export function TrialBalanceCriteria({ criteria, lookups, setField, openModal }) {
  const selectedGroups = new Set(criteria.selectedAccountGroups || []);
  const toggleGroup = (code) => {
    const next = new Set(selectedGroups);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setField("selectedAccountGroups", [...next].sort());
  };

  const selectAll = () => {
    setField("includeBusinessPartners", true);
    setField("includeGlAccounts", true);
    setField("selectedAccountGroups", ACCOUNT_GROUPS.map((group) => group.code));
  };

  return (
    <div className="tb-criteria">
      <div className="tb-top-grid">
        <section className="tb-bp-panel">
          <label className="tb-check-heading">
            <input type="checkbox" checked={criteria.includeBusinessPartners} onChange={(event) => setField("includeBusinessPartners", event.target.checked)} />
            BP
          </label>
          <div className="tb-range-row">
            <span>From</span>
            <input value={criteria.bpFrom} disabled={!criteria.includeBusinessPartners} onChange={(event) => setField("bpFrom", event.target.value)} />
            <span>To</span>
            <input value={criteria.bpTo} disabled={!criteria.includeBusinessPartners} onChange={(event) => setField("bpTo", event.target.value)} />
          </div>
          <label className="tb-select-row"><span>Customer Group</span><select value={criteria.customerGroup} disabled={!criteria.includeBusinessPartners} onChange={(event) => setField("customerGroup", event.target.value)}>{groupOptions(lookups.customerGroups).map((item) => <option key={`c-${item.code}`} value={item.code}>{item.name}</option>)}</select></label>
          <label className="tb-select-row"><span>Vendor Group</span><select value={criteria.vendorGroup} disabled={!criteria.includeBusinessPartners} onChange={(event) => setField("vendorGroup", event.target.value)}>{groupOptions(lookups.vendorGroups).map((item) => <option key={`v-${item.code}`} value={item.code}>{item.name}</option>)}</select></label>
          <div className="tb-properties-row">
            <button type="button" className="sap-report-btn" disabled={!criteria.includeBusinessPartners} onClick={() => openModal("properties")}>Properties</button>
            <input readOnly value={criteria.propertyFilter?.ignoreProperties ? "Ignore" : `${criteria.propertyFilter?.selectedPropertyNumbers?.length || 0} Selected`} />
          </div>
        </section>

        <section className="tb-gl-panel">
          <div className="tb-gl-heading">
            <label className="tb-check-heading"><input type="checkbox" checked={criteria.includeGlAccounts} onChange={(event) => setField("includeGlAccounts", event.target.checked)} />G/L Accounts</label>
            <button type="button" className="sap-report-btn" onClick={() => setField("selectedAccountGroups", ACCOUNT_GROUPS.map((group) => group.code))}>Find</button>
            <select aria-label="Account hierarchy level" defaultValue="1"><option>1</option></select>
          </div>
          <div className="tb-account-grid">
            <div className="tb-account-grid__head"><span>#</span><span>x</span><span>Account</span></div>
            {ACCOUNT_GROUPS.map((group, index) => (
              <label key={group.code} className="tb-account-grid__row">
                <span>{index === 0 ? "1" : group.code === 2 ? "423" : group.code === 3 ? "791" : group.code === 4 ? "811" : "859"}</span>
                <input type="checkbox" disabled={!criteria.includeGlAccounts} checked={selectedGroups.has(group.code)} onChange={() => toggleGroup(group.code)} />
                <span className="tb-account-name">-&gt; {group.name}</span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="tb-date-row">
        <strong>Date</strong>
        <select value={criteria.dateType} onChange={(event) => setField("dateType", event.target.value)}>{lookups.dateTypes.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select>
        <span>From</span>
        <SapDateInput  value={criteria.dateFrom} onChange={(event) => setField("dateFrom", event.target.value)} />
        <span>To</span>
        <SapDateInput  value={criteria.dateTo} onChange={(event) => setField("dateTo", event.target.value)} />
      </div>

      <div className="tb-lower-grid">
        <fieldset className="tb-display-panel">
          <legend>Display in Report:</legend>
          <div className="tb-display-options">
            <label><input type="checkbox" checked={criteria.hideZeroBalance} onChange={(event) => setField("hideZeroBalance", event.target.checked)} />Hide Zero Balanced Acct</label>
            <label className="tb-indent"><input type="checkbox" checked={criteria.hideNoPostings} onChange={(event) => setField("hideNoPostings", event.target.checked)} />Hide Acct with No Postings</label>
            <label><input type="checkbox" checked={criteria.foreignName} onChange={(event) => setField("foreignName", event.target.checked)} />Foreign Names</label>
            <label><input type="checkbox" checked={criteria.externalCode} onChange={(event) => setField("externalCode", event.target.checked)} />External Code</label>
            <label><input type="checkbox" checked={criteria.openingBalanceForPeriod} onChange={(event) => setField("openingBalanceForPeriod", event.target.checked)} />Opening Balance for Period</label>
            <label><input type="checkbox" checked={criteria.displayCurrency === "foreign"} onChange={(event) => setField("displayCurrency", event.target.checked ? "foreign" : "local")} />Foreign Currency</label>
            <label><input type="checkbox" checked={criteria.displayCurrency === "system"} onChange={(event) => setField("displayCurrency", event.target.checked ? "system" : "local")} />System Currency</label>
            <label><input type="checkbox" checked={criteria.displayCurrency === "localAndSystem"} onChange={(event) => setField("displayCurrency", event.target.checked ? "localAndSystem" : "local")} />Local and System Currency</label>
          </div>
          <div className="tb-template-options">
            <label className="tb-template-row"><span>Template</span><select value={criteria.templateCode} onChange={(event) => setField("templateCode", event.target.value)}>{lookups.trialBalanceTemplates.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
            <label><input type="checkbox" checked={criteria.showControlAccountInfo} onChange={(event) => setField("showControlAccountInfo", event.target.checked)} />Show Info per Ctrl Acct</label>
            {[
              ["annual", "Annual Report"], ["quarterly", "Quarterly Report"],
              ["monthly", "Monthly Report"], ["periodic", "Periodic Report"],
            ].map(([value, label]) => <label key={value}><input type="radio" name="tb-period" checked={criteria.periodType === value} onChange={() => setField("periodType", value)} />{label}</label>)}
            <div className="tb-balance-mode">
              <label><input type="radio" name="tb-balance-mode" checked={criteria.balanceMode === "account"} onChange={() => setField("balanceMode", "account")} />Account Balance</label>
              <label><input type="radio" name="tb-balance-mode" checked={criteria.balanceMode === "trial"} onChange={() => setField("balanceMode", "trial")} />Trial Balance</label>
            </div>
          </div>
        </fieldset>

        <aside className="tb-side-options">
          <label><input type="checkbox" checked={criteria.addJournalVouchers} onChange={(event) => setField("addJournalVouchers", event.target.checked)} />Add Journal Vouchers</label>
          <label><input type="checkbox" checked={criteria.ignoreAdjustments} onChange={(event) => setField("ignoreAdjustments", event.target.checked)} />Ignore Adjustments</label>
          <label><input type="checkbox" checked={criteria.addClosingBalances} onChange={(event) => setField("addClosingBalances", event.target.checked)} />Add Closing Balances</label>
          <button type="button" className="sap-report-btn" disabled>Revaluation</button>
          <button type="button" className="sap-report-btn fac-expanded" onClick={() => openModal("trialExpanded")}>Expanded</button>
          <button type="button" className="sap-report-btn tb-select-all" onClick={selectAll}>Select All</button>
        </aside>
      </div>
    </div>
  );
}

export function TrialBalanceExpandedModal({ value, onChange, onOpenReferences, onOpenUdfs, onClose }) {
  const [draft, setDraft] = useState(value);
  const setField = (field, fieldValue) => setDraft((current) => ({ ...current, [field]: fieldValue }));
  const selected = new Set(draft.originalJournals || []);
  const toggleJournal = (name) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setField("originalJournals", [...next]);
  };

  return (
    <div className="fac-modal-backdrop">
      <section className="fac-modal fac-modal--trial-expanded">
        <header className="sap-report-titlebar fac-modal-titlebar"><span className="sap-report-title">Expanded Selection Criteria</span><div className="sales-analysis-window__controls"><button type="button" aria-label="Close" onClick={onClose}>x</button></div></header>
        <div className="sales-analysis-window__accent" />
        <div className="tb-expanded-body">
          <section><h4>Original Journal</h4><div className="tb-journal-list">{ORIGINAL_JOURNALS.map((name) => <label key={name}><input type="checkbox" checked={selected.has(name)} onChange={() => toggleJournal(name)} />{name}</label>)}</div></section>
          <section className="tb-parameter-list"><h4>Parameters</h4>
            <label><input type="checkbox" checked={draft.referenceFields} onChange={(event) => setField("referenceFields", event.target.checked)} />Reference Fields <button type="button" className="sap-report-btn" onClick={onOpenReferences}>...</button></label>
            <label><input type="checkbox" checked={draft.transactionCode} onChange={(event) => setField("transactionCode", event.target.checked)} />Trans. Code <input value={draft.transactionCodeFrom || ""} onChange={(event) => setField("transactionCodeFrom", event.target.value)} /><input value={draft.transactionCodeTo || ""} onChange={(event) => setField("transactionCodeTo", event.target.value)} /></label>
            <label><input type="checkbox" checked={draft.project} onChange={(event) => setField("project", event.target.checked)} />Project <input value={draft.projectFrom || ""} onChange={(event) => setField("projectFrom", event.target.value)} /><input value={draft.projectTo || ""} onChange={(event) => setField("projectTo", event.target.value)} /></label>
            <label><input type="checkbox" checked={draft.userDefinedFields} onChange={(event) => setField("userDefinedFields", event.target.checked)} />User-Defined Fields <button type="button" className="sap-report-btn" onClick={onOpenUdfs}>...</button></label>
            <label><input type="checkbox" checked={draft.division} onChange={(event) => setField("division", event.target.checked)} />Division <input value={draft.divisionFrom || ""} onChange={(event) => setField("divisionFrom", event.target.value)} /><input value={draft.divisionTo || ""} onChange={(event) => setField("divisionTo", event.target.value)} /></label>
            <label><input type="checkbox" checked={draft.buyer} onChange={(event) => setField("buyer", event.target.checked)} />Buyer <input value={draft.buyerFrom || ""} onChange={(event) => setField("buyerFrom", event.target.value)} /><input value={draft.buyerTo || ""} onChange={(event) => setField("buyerTo", event.target.value)} /></label>
            <label className="tb-blanket-row"><input type="checkbox" checked={draft.blanketAgreement} onChange={(event) => setField("blanketAgreement", event.target.checked)} />Blanket Agreement <input value={draft.blanketAgreementFrom || ""} onChange={(event) => setField("blanketAgreementFrom", event.target.value)} /><input value={draft.blanketAgreementTo || ""} onChange={(event) => setField("blanketAgreementTo", event.target.value)} /></label>
            <button type="button" className="sap-report-btn tb-series-btn">Series</button>
          </section>
        </div>
        <footer className="fac-modal-footer"><button type="button" className="sap-report-btn sap-report-btn--primary" onClick={() => { onChange(draft); onClose(); }}>OK</button><button type="button" className="sap-report-btn" onClick={onClose}>Cancel</button><button type="button" className="sap-report-btn fac-modal-clear" onClick={() => setDraft({})}>Clear Sel.</button></footer>
      </section>
    </div>
  );
}
