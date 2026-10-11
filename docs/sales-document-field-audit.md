Sales document field and lookup audit — 2026-09-26

Checked DC_LiveDB, NC_LIVE, NOCPL_LIVE, and NCPL_110126, for Sales Order (ORDR/RDR1), Delivery (ODLN/DLN1), and A/R Invoice (OINV/INV1).

All live checks used guarded SELECT statements through a single-connection pool per company. The local company configuration database was opened read-only. No SAP documents, master data, UDF definitions, value lists, form settings, or stored SQL queries were changed or executed. Only application code and local audit files were written. The application server was not started and this change has not been deployed.

The screenshot-style lists were missing because the shared schema read CUFD/UFD1 and linked tables but did not read CSHS/CUVV. The new `sap-user-values` source reads ActionT=1 lists from the current company and exact document form. It preserves SAP row order, duplicate entries, pagination, empty lists, and the actual selected text. It exposes the existing searchable lookup modal and keeps free-text suggestion fields separate from UDF constraints. It does not expose a New/write action for these lists.

| Company | Sales Order form lists now mapped | Delivery form lists now mapped | A/R Invoice form lists now mapped |
| --- | --- | --- | --- |
| DC_LiveDB | U_CUSTNAM (1); U_UoM (1) | U_UoM (1) | U_TRNS (17) |
| NC_LIVE | U_CUSTNAM (1); U_UoM (1) | U_UoM (1) | U_TRNS (17) |
| NOCPL_LIVE | Seller Quality (20); Buyer Quality (17); Seller Price (3); Buyer Price (3) | Seller/Buyer Quality configured, both empty | No ActionT=1 lists |
| NCPL_110126 | Seller Quality (20); Buyer Quality (17); Seller Price (3); Buyer Price (3) | Seller/Buyer Quality configured, both empty | No ActionT=1 lists |

These counts concern CSHS/CUVV lists only. Existing item, customer, warehouse, tax, UFD1, linked-table, and UDO lookup mechanisms remain available.

The standard Sales Order, Delivery, and A/R Invoice pages already request `refresh: true` for SAP layouts. They use live CPRF column order/visibility and current-company physical fields. The audit inspected the configured SAP user (manager, with an explicit manager fallback for NOCPL_LIVE). This does not prove an identical layout for a different SAP user. NCPL_110126 Sales Order's leading fields match the screenshot: Item No., Item Description, Seller Quality, Buyer Quality, Quantity, Unit Price, Seller Price, Buyer Price. Related document profiles use the same shared schema and metadata reader, including quotations, credit memos, purchase orders, GRPO, and purchase invoices. Legacy company-specific quality/price popups now discover the shared schema when their reference response lacks it.

Remaining SAP configuration differences:

- Both Neshiel companies have Sales Order lists assigned to `U_Seller_Payment_Ter` (32 rows) and `U_Buyer_Payment_Term` (31 rows), but those exact physical line fields do not exist. Current payment-term fields have different names, and some have query-based assignments. The application deliberately does not guess a replacement binding.
- Delivery quality assignments have zero CUVV rows; Sales Order values are not copied into them.
- NCPL_110126 has obsolete UDF references in stored layouts. Existing current-company schema filtering excludes these references. The JSON audit lists them.
- Query-based formatted searches (CSHS ActionT=2) are inventoried but not executed or newly supported by this change. They can depend on SAP desktop field/row context and need separate explicit mappings; this audit does not claim parity for every query-based field.

Validation: the new lookup service was exercised against all 12 live metadata combinations without writes. Backend regression coverage includes SQL Server/HANA SQL generation, company/document field scope, pagination with duplicates, empty/missing metadata, free-text semantics, and existing layout mapping. Frontend coverage includes lookup discovery, company switching, exact row-UDF selection, SAP field order, and existing Sales Order/Delivery rendering. Browser testing against a logged-in production session was not performed.

Re-run the read-only audit from the repository root with `node backend/scripts/auditSalesDocumentFields.js`. Pass a SAP user code as the first argument to inspect that user's layout. Results are written to [sales-document-field-audit.json](sales-document-field-audit.json). Credentials are not included in the report.

SAP references: [CSHS assignments](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/CSHS.html) and [CUVV list values](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/CUVV.html).
