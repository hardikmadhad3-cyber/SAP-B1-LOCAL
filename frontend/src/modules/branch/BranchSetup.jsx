import React, { useState, useEffect } from "react";
import "./styles/branchSetup.css";
import {
  createBranch,
  updateBranch,
  searchBranches,
} from "../../api/branchApi";

export default function BranchSetup() {
  const [branches, setBranches] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBranches = async () => {
    setLoading(true);
    try {
      const data = await searchBranches("", 200);
      setBranches(data.map(branch => ({
        BPLID: branch.BPLID || "",
        BPLName: branch.BPLName || "",
        BPLNameForeign: branch.BPLNameForeign || "",
        VATRegNum: branch.VATRegNum || "",
        RepName: branch.RepName || "",
        Industry: branch.Industry || "",
        MainBPL: branch.MainBPL || "tNO",
        Disabled: branch.Disabled || "tNO",
        isModified: false,
        isNew: false,
      })));
    } catch (err) {
      console.error("Failed to load branches:", err);
      showAlert("error", "Failed to load branches.");
    } finally {
      setLoading(false);
    }
  };

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleAddRow = () => {
    setBranches((prev) => [
      ...prev,
      {
        BPLID: "",
        BPLName: "",
        BPLNameForeign: "",
        VATRegNum: "",
        RepName: "",
        Industry: "",
        isNew: true,
        isModified: false,
      },
    ]);
  };

  const handleCellChange = (index, field, value) => {
    setBranches((prev) =>
      prev.map((row, i) =>
        i === index
          ? { ...row, [field]: value, isModified: !row.isNew }
          : row
      )
    );
  };

  const handleSave = async () => {
    // Validate all rows
    for (const branch of branches) {
      if (!branch.BPLName || !branch.BPLName.trim()) {
        showAlert("error", "Branch Name is required for all branches.");
        return;
      }
    }

    setLoading(true);
    try {
      // Process new records
      for (const branch of branches.filter((b) => b.isNew)) {
        const payload = buildPayload(branch);
        await createBranch(payload);
      }

      // Process modified records
      for (const branch of branches.filter((b) => b.isModified && !b.isNew)) {
        const payload = buildPayload(branch);
        await updateBranch(branch.BPLID, payload);
      }

      showAlert("success", "Branches saved successfully.");
      await loadBranches();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Failed to save.";
      showAlert("error", msg);
    } finally {
      setLoading(false);
    }
  };

  const buildPayload = (branch) => {
    const payload = {
      BPLName: branch.BPLName.trim(),
    };

    // Optional fields are always sent, so an emptied field is cleared.
    payload.BPLNameForeign = branch.BPLNameForeign?.trim() || "";
    payload.VATRegNum = branch.VATRegNum?.trim() || "";
    payload.RepName = branch.RepName?.trim() || "";
    payload.Industry = branch.Industry?.trim() || "";

    return payload;
  };

  const handleCancel = () => {
    loadBranches();
    setAlert(null);
  };

  return (
    <div className="br-page">
      {/* Toolbar */}
      <div className="br-toolbar">
        <span className="br-toolbar__title">Branches - Setup</span>
        <button
          className="br-btn br-btn--primary"
          onClick={handleSave}
          disabled={loading}
        >
          {loading ? "..." : "OK"}
        </button>
        <button className="br-btn" onClick={handleCancel}>
          Cancel
        </button>
      </div>

      {alert && (
        <div className={`br-alert br-alert--${alert.type}`}>{alert.msg}</div>
      )}

      {/* Grid Section */}
      <div className="br-grid-section">
        <div className="br-grid-wrap">
          <table className="br-grid">
            <thead>
              <tr>
                <th style={{ width: "40px" }}>#</th>
                <th style={{ width: "80px" }}>Code</th>
                <th style={{ width: "300px" }}>Branch Name*</th>
                <th style={{ width: "250px" }}>Branch Name (Foreign)</th>
                <th style={{ width: "180px" }}>GST/VAT No.</th>
                <th style={{ width: "180px" }}>Rep Name</th>
                <th style={{ width: "150px" }}>Industry</th>
              </tr>
            </thead>
            <tbody>
              {branches.length === 0 ? (
                <tr>
                  <td colSpan="7" className="br-grid__empty">
                    No branches found. Click "Add Row" to create one.
                  </td>
                </tr>
              ) : (
                branches.map((row, index) => (
                  <tr key={index}>
                    <td className="br-grid__cell--center">{index + 1}</td>
                    <td className="br-grid__cell--center">
                      {row.isNew ? (
                        <span className="br-grid__readonly">Auto</span>
                      ) : (
                        row.BPLID
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        className="br-grid__input"
                        value={row.BPLName}
                        onChange={(e) =>
                          handleCellChange(index, "BPLName", e.target.value)
                        }
                        placeholder="Enter branch name"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="br-grid__input"
                        value={row.BPLNameForeign || ""}
                        onChange={(e) =>
                          handleCellChange(index, "BPLNameForeign", e.target.value)
                        }
                        placeholder="Foreign name"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="br-grid__input"
                        value={row.VATRegNum || ""}
                        onChange={(e) =>
                          handleCellChange(index, "VATRegNum", e.target.value)
                        }
                        placeholder="GST/VAT number"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="br-grid__input"
                        value={row.RepName || ""}
                        onChange={(e) =>
                          handleCellChange(index, "RepName", e.target.value)
                        }
                        placeholder="Representative"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="br-grid__input"
                        value={row.Industry || ""}
                        onChange={(e) =>
                          handleCellChange(index, "Industry", e.target.value)
                        }
                        placeholder="Industry"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="br-grid-actions">
          <button
            type="button"
            className="br-btn br-btn--small"
            onClick={handleAddRow}
          >
            Add Row
          </button>
        </div>
      </div>
    </div>
  );
}
