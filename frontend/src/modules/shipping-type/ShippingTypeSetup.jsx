import React, { useState, useEffect } from "react";
import "./styles/shippingTypeSetup.css";
import {
  createShippingType,
  updateShippingType,
  deleteShippingType,
  searchShippingTypes,
} from "../../api/shippingTypeApi";

export default function ShippingTypeSetup() {
  const [shippingTypes, setShippingTypes] = useState([]);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deletedCodes, setDeletedCodes] = useState([]);

  useEffect(() => {
    loadShippingTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadShippingTypes = async () => {
    setLoading(true);
    try {
      const data = await searchShippingTypes("", 200);
      setShippingTypes(data.map(st => ({
        ...st,
        isModified: false,
        isNew: false,
      })));
      setDeletedCodes([]);
    } catch (err) {
      console.error("Failed to load shipping types:", err);
      showAlert("error", "Failed to load shipping types.");
    } finally {
      setLoading(false);
    }
  };

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleAddRow = () => {
    setShippingTypes((prev) => [
      ...prev,
      {
        Code: "",
        Name: "",
        Website: "",
        isNew: true,
        isModified: false,
      },
    ]);
  };

  const handleCellChange = (index, field, value) => {
    setShippingTypes((prev) =>
      prev.map((row, i) =>
        i === index
          ? { ...row, [field]: value, isModified: !row.isNew }
          : row
      )
    );
  };

  const handleDeleteRow = (index) => {
    const row = shippingTypes[index];
    
    // If it's an existing record, mark for deletion
    if (!row.isNew && row.Code) {
      if (window.confirm(`Are you sure you want to delete "${row.Name}"?`)) {
        setDeletedCodes((prev) => [...prev, row.Code]);
        setShippingTypes((prev) => prev.filter((_, i) => i !== index));
      }
    } else {
      // If it's a new unsaved record, just remove it
      setShippingTypes((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleSave = async () => {
    // Validate all rows
    for (const st of shippingTypes) {
      if (!st.Name || !st.Name.trim()) {
        showAlert("error", "Name is required for all shipping types.");
        return;
      }
    }

    setLoading(true);
    try {
      // Process deletions first
      for (const code of deletedCodes) {
        await deleteShippingType(code);
      }

      // Process new records
      for (const st of shippingTypes.filter((s) => s.isNew)) {
        const payload = {
          Name: st.Name.trim(),
        };
        if (st.Website?.trim()) {
          payload.Website = st.Website.trim();
        }
        await createShippingType(payload);
      }

      // Process modified records
      for (const st of shippingTypes.filter((s) => s.isModified && !s.isNew)) {
        // An emptied Web Site is sent as null so it is cleared.
        const payload = {
          Name: st.Name.trim(),
          Website: st.Website?.trim() || null,
        };
        await updateShippingType(st.Code, payload);
      }

      showAlert("success", "Shipping types saved successfully.");
      await loadShippingTypes();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Failed to save.";
      showAlert("error", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    loadShippingTypes();
    setAlert(null);
  };

  return (
    <div className="st-page">
      {/* Toolbar */}
      <div className="st-toolbar">
        <span className="st-toolbar__title">Shipping Types - Setup</span>
        <button
          className="st-btn st-btn--primary"
          onClick={handleSave}
          disabled={loading}
        >
          {loading ? "..." : "OK"}
        </button>
        <button className="st-btn" onClick={handleCancel}>
          Cancel
        </button>
      </div>

      {alert && (
        <div className={`st-alert st-alert--${alert.type}`}>{alert.msg}</div>
      )}

      {/* Grid Section */}
      <div className="st-grid-section">
        <div className="st-grid-wrap">
          <table className="st-grid">
            <thead>
              <tr>
                <th style={{ width: "40px" }}>#</th>
                <th style={{ width: "80px" }}>Code</th>
                <th style={{ width: "300px" }}>Name*</th>
                <th style={{ width: "400px" }}>Web Site</th>
                <th style={{ width: "60px" }}></th>
              </tr>
            </thead>
            <tbody>
              {shippingTypes.length === 0 ? (
                <tr>
                  <td colSpan="5" className="st-grid__empty">
                    No shipping types found. Click "Add Row" to create one.
                  </td>
                </tr>
              ) : (
                shippingTypes.map((row, index) => (
                  <tr key={index}>
                    <td className="st-grid__cell--center">{index + 1}</td>
                    <td className="st-grid__cell--center">
                      {row.isNew ? (
                        <span className="st-grid__readonly">Auto</span>
                      ) : (
                        row.Code
                      )}
                    </td>
                    <td>
                      <input
                        type="text"
                        className="st-grid__input"
                        value={row.Name}
                        onChange={(e) =>
                          handleCellChange(index, "Name", e.target.value)
                        }
                        placeholder="Enter shipping type name"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="st-grid__input"
                        value={row.Website || ""}
                        onChange={(e) =>
                          handleCellChange(index, "Website", e.target.value)
                        }
                        placeholder="https://www.example.com/tracking"
                      />
                    </td>
                    <td className="st-grid__cell--center">
                      <button
                        type="button"
                        className="st-grid__delete-btn"
                        onClick={() => handleDeleteRow(index)}
                        title="Delete"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="st-grid-actions">
          <button
            type="button"
            className="st-btn st-btn--small"
            onClick={handleAddRow}
          >
            Add Row
          </button>
        </div>
      </div>
    </div>
  );
}
