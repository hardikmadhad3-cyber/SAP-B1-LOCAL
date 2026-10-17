import React from "react";

const EMPTY_ROW = {
  Code: "",
  Name: "",
  BaseUoM: "",
  isNew: true,
};

export default function UoMGroupsGrid({ groups, setGroups, uomOptions, onOpenDefinition, disabled = false }) {
  // Ensure minimum 5 rows
  const displayRows = [...groups];
  while (displayRows.length < 5) {
    displayRows.push({ ...EMPTY_ROW });
  }

  const handleCellChange = (rowIndex, field, value) => {
    const newGroups = [...displayRows];
    newGroups[rowIndex] = {
      ...newGroups[rowIndex],
      [field]: value,
      isModified: !newGroups[rowIndex].isNew,
    };
    setGroups(newGroups);
  };

  const handleAddRow = () => {
    setGroups([...displayRows, { ...EMPTY_ROW }]);
  };

  return (
    <div className="im-tab-panel">
      <div className="im-grid-wrap">
        <table className="im-grid">
          <thead>
            <tr>
              <th style={{ width: "40px" }}>#</th>
              <th style={{ width: "120px" }}>Code*</th>
              <th style={{ width: "300px" }}>Name*</th>
              <th style={{ width: "200px" }}>Base UoM*</th>
              <th style={{ width: "80px" }}>...</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, idx) => (
              <tr key={idx}>
                <td className="">{idx + 1}</td>
                <td>
                  <input disabled={disabled}
                    className="im-grid__input"
                    aria-label={"Group code " + (idx + 1)} value={row.Code || ""}
                    onChange={(e) => handleCellChange(idx, "Code", e.target.value)}
                    maxLength={20}
                    placeholder="Max 20 chars"
                    readOnly={!row.isNew}
                  />
                </td>
                <td>
                  <input disabled={disabled}
                    className="im-grid__input"
                    aria-label={"Group name " + (idx + 1)} value={row.Name || ""}
                    onChange={(e) => handleCellChange(idx, "Name", e.target.value)}
                    maxLength={100}
                    placeholder="Group name"
                  />
                </td>
                <td>
                  <select disabled={disabled}
                    className="im-grid__input"
                    aria-label={"Base UoM " + (idx + 1)} value={row.BaseUoM ?? ""}
                    onChange={(e) => handleCellChange(idx, "BaseUoM", e.target.value)}
                  >
                    <option value="">-- Select --</option>
                    {uomOptions.map((uom) => (
                      <option key={uom.code} value={uom.code}>
                        {uom.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="">
                  {row.AbsEntry && (
                    <button disabled={disabled}
                      className="im-btn"
                      onClick={() => onOpenDefinition(row)}
                      title="Group Definition"
                    >
                      ...
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="im-grid-actions">
        <button disabled={disabled} className="im-btn" onClick={handleAddRow}>
          + Add Row
        </button>
      </div>
    </div>
  );
}
