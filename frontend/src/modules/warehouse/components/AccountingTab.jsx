
import { useState } from "react";
import { searchAccounts } from "../../../api/chartOfAccountsApi";

export default function AccountingTab({ form, onChange }) {
  const [accountModal, setAccountModal] = useState(null);
  const [accountList, setAccountList] = useState([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");

  const openAccountLookup = async (fieldName) => {
    setAccountModal(fieldName);
    setAccountSearch("");
    setAccountLoading(true);
    try {
      const results = await searchAccounts("", "", 100);
      setAccountList(results);
    } catch (err) {
      console.error("Failed to load accounts:", err);
      setAccountList([]);
    } finally {
      setAccountLoading(false);
    }
  };

  const handleAccountSearch = async (query) => {
    setAccountSearch(query);
    if (!query.trim()) {
      setAccountLoading(true);
      try {
        const results = await searchAccounts("", "", 100);
        setAccountList(results);
      } catch {
        setAccountList([]);
      } finally {
        setAccountLoading(false);
      }
      return;
    }
    setAccountLoading(true);
    try {
      const results = await searchAccounts(query, "", 100);
      setAccountList(results);
    } catch {
      setAccountList([]);
    } finally {
      setAccountLoading(false);
    }
  };

  const selectAccount = (account) => {
    onChange({
      target: {
        name: accountModal,
        value: account.Code,
        type: "text",
      },
    });
    setAccountModal(null);
  };

  const accountFields = [
    { name: "InventoryAccount", label: "Inventory Account" },
    { name: "CostOfGoodsSoldAccount", label: "Cost Of Goods Sold Account" },
    { name: "TransferAccount", label: "Allocation Account" },
    { name: "PriceDifferencesAccount", label: "Price Difference Account" },
    { name: "ReturnsAccount", label: "Returns Account" },
    { name: "DecreasingAccount", label: "Decreasing Account" },
    { name: "IncreasingAccount", label: "Increasing Account" },
    { name: "PurchaseAccount", label: "Purchase Account" },
    { name: "PurchaseReturnAccount", label: "PA Return Account" },
    { name: "PurchaseOffsetAccount", label: "Purchase Offset Acct" },
    { name: "WipAccount", label: "WIP Account" },
    { name: "ExpenseClearingAccount", label: "Expense Clearing Acct" },
    { name: "TaxGroup", label: "Tax Group" },
  ];

  return (
    <>
      <div className="wh-accounting-grid">
        {accountFields.map((field) => (
          <div key={field.name} className="im-field">
            <label className="im-field__label">{field.label}</label>
            <input
              className="im-field__input"
              name={field.name}
              value={form[field.name] || ""}
              onChange={onChange}
              style={{ flex: 1 }}
            />
            {field.name !== "TaxGroup" && (
              <button
                type="button"
                className="im-lookup-btn"
                onClick={() => openAccountLookup(field.name)}
                title="Browse Accounts"
              >
                …
              </button>
            )}
          </div>
        ))}
      </div>

      {accountModal && (
        <div className="im-modal-overlay" onClick={() => setAccountModal(null)}>
          <div className="im-modal" onClick={(e) => e.stopPropagation()}>
            <div className="im-modal__header">
              <span>Select Account</span>
              <button className="im-modal__close" onClick={() => setAccountModal(null)}>
                ✕
              </button>
            </div>
            <div className="im-modal__search">
              <input
                type="text"
                placeholder="Search by code or name..."
                value={accountSearch}
                onChange={(e) => handleAccountSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="im-modal__body">
              {accountLoading ? (
                <div className="im-modal__empty">Loading...</div>
              ) : accountList.length === 0 ? (
                <div className="im-modal__empty">No accounts found</div>
              ) : (
                <table className="im-lookup-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountList.map((account) => (
                      <tr
                        key={account.Code}
                        className="im-lookup-table__row"
                        onClick={() => selectAccount(account)}
                      >
                        <td>{account.Code}</td>
                        <td>{account.Name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
