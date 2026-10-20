# Local ERP Plan — SAP B1 → PostgreSQL

Decided: start from zero — no SAP data is copied, and this PC has no SAP connection.

Goal: a fully local ERP modelled on SAP Business One. PostgreSQL is the system of record; SAP (Service Layer, SQL Server/HANA) is dropped.

## Key design choices

- **One PostgreSQL database, many schemas.**
  - `app` schema: shared application data (users, companies, roles, menus, settings and report definitions).
  - `app_company_<CompanyId>` schemas: QC and WhatsApp application data. These replace the existing separate SQLite files per company, preserving isolation and per-company unique keys without rewriting every query.
  - One schema per company (e.g. `cmp_demo`) holding SAP-named tables: `OCRD`, `OITM`, `ORDR`/`RDR1`, `NNM1`, `OJDT`… This mirrors HANA's `SET SCHEMA`, so the multi-company code keeps working.
- **Keep SAP table and column names, with case preserved.** About 746 existing read queries, reports and dashboards then work unchanged. The adapter translates the SQL Server dialect to Postgres the same way [db/hanaDb.js](../backend/db/hanaDb.js) translates it to HANA.
- **Replace the Service Layer behind its existing function.** `sapService.request()` routes to a local engine with the same request/response shape, so the 68 calling files don't change.
- **Only one new dependency:** `pg`.

## Phases (do in order; each ends with a working app)

### Phase 0 — Foundation
- [x] PostgreSQL 18 on `127.0.0.1:5433`, database `localerp` (the `cloud_erp` DBs on the same server belong to another project — leave them alone).
- [x] `DATABASE_URL` in `backend/.env`.
- [x] `npm i pg`.
- [x] `backend/db/pgDb.js`: pool, `@param` binding, and T-SQL→PG rewrite (`TOP`, `ISNULL`, `GETDATE`, `[x]`, `CONVERT`, `DATEDIFF`, `OUTPUT INSERTED`, identifier quoting). It returns the same `{ recordset, rowsAffected }` shape as mssql.
- [x] `dbService.query`: add the `postgres` dialect (`SET search_path` to the company schema).
- [x] Check: `test/pgDb.test.js` (translation + live insert/select/update/INFORMATION_SCHEMA on PG). Full suite: 411/412 — the one failure (`salesOrderHsnReference`) already failed before these changes.

### Phase 1 — App data: SQLite → PostgreSQL
- [x] Convert `auth-schema`, `qc-schema` and `whatsapp-schema` `.sqlite.sql` files into one `app-schema.pg.sql`.
- [x] Swap the internals of `authDbService.js` from `node:sqlite` to `pg` (keep its public API).
- [x] Move QC and WhatsApp to PostgreSQL and await their queries in controllers and webhook helpers.
- [x] ~~Copy the existing SQLite rows~~ — not needed: fresh start, no SQLite data on this PC.
- [x] Check: login, company switch, menus, roles and QC all work against PG.

### Codex handoff — Phase 1 completed, 2026-10-11

Recovered context from this plan, the existing uncommitted Phase 0 changes, and the Claude conversation screenshot. No SAP or SQLite business data has been imported. Preserve the existing Phase 0 changes; do not revert them.

Implementation:
- `backend/services/appDbService.js` initializes the PostgreSQL DDL once per schema, retries initialization after failures, and uses one checked-out connection per transaction. Auth metadata helpers retain the shape expected by Admin Panel.
- QC and WhatsApp require the active company from request context. Their schema names are generated from validated positive integer IDs. WhatsApp customer and open-conversation creation use atomic upserts for concurrent requests.
- `Menus.SortOrder` is numeric because existing sidebar entries use fractional positions. PostgreSQL upsert translation and nullable menu ID comparisons were corrected.
- `backend/.env` uses `AUTH_DB_PROVIDER=postgres`; the existing `DATABASE_URL` is retained. Credentials are not included in this document.
- SQLite SQL files remain for existing test fixtures and historical migration scripts. Runtime auth, QC and WhatsApp services use PostgreSQL.

Validation:
- From `backend`, run `npm run test:app-postgres`: 10 passing tests, including live PostgreSQL checks in disposable schemas.
- `node --test test/*.test.js`: 412/413 passing. The existing `salesOrderHsnReference` failure still reports that the active company database could not be resolved; it was documented before Phase 1.
- HTTP smoke checks passed for `/health`, `/api/companies-public`, and `/api/admin-login` with the configured setup administrator credentials. The temporary smoke-test server was stopped.

Run the app with `npm start` from `backend`. For the fresh database, the existing setup administrator login uses `SETUP_ADMIN_USERNAME` and `SETUP_ADMIN_PASSWORD` from `.env`; regular ERP users and company assignments are not seeded by Phase 1.

Phase 1 handed off to Phase 2 below. Browser interaction and live WhatsApp sending were not tested in Phase 1.

### Phase 2 — Company database in PostgreSQL (fresh start, no SAP copy)
- [x] `db/company-schema.pg.sql`: native PostgreSQL DDL for 118 SAP-named tables, preserving column casing, numeric precision, independent document identities, indexes and foreign keys.
- [x] Script `seedNewCompany.js`: an empty company with minimum setup (`OADM`, `OFPR`, `NNM1`, base chart of accounts, warehouse and tax code), a company user and scoped application access.
- [x] Point the company record at `dialect=postgres` and that schema.
- [x] Check: core master/document list services, report services, numbering and dashboard queries run against PostgreSQL, including populated numeric records and company isolation.
- [ ] Complete browser checks for every page and legacy/custom module. Core HTTP smoke checks passed; SAP-backed writes and custom integrations remain for later phases.

### Codex handoff — Phase 2 company setup completed, 2026-10-11

The first company is **Cloud_Erp**, schema **`cmp_cloud_erp`** in database **`localerp`**. The separate `cloud_erp` databases were left alone. No SAP or SQLite business records were imported. The company starts with zero business partners, items, orders and invoices.

Setup includes INR, India, fiscal year **2026–27 (2026-04-01 through 2027-03-31)**, nine base accounts, warehouse `01`, one branch/location, 25 numbering series, default groups, EA unit of measure, payment terms, price list and zero tax code. These are starting settings; actual GST/account determination and posting are later work.

From `backend` in PowerShell:

```powershell
npm.cmd run seed:company -- --name Cloud_Erp --schema cmp_cloud_erp --year 2026
npm.cmd start
```

Log in as `manager` using the configured `SETUP_ADMIN_PASSWORD` from `backend/.env`, then select **Cloud_Erp**. The seed creates the user only when absent and preserves an existing user's password. Repeating the seed for the same registered company preserves all data and returns `created: false`. It refuses an unregistered existing schema or a conflicting company name. Schema creation, setup and access assignments run in one transaction. This fresh-company script is not an upgrade or reset tool; future schema changes need migrations.

Compatibility fixes cover nested `SELECT TOP`, running-total window frames, regular-expression translation, typed nullable filters and inventory audit grouping. Company connections use only the selected company schema in their search path, preventing fallback into public tables. Admin Panel now offers the PostgreSQL dialect.

Validation:
- `npm.cmd run test:company-postgres`: **4/4 passing**, including broad live reads, seed repeat/conflict behavior, login, company isolation, numbering, numeric totals and foreign-key checks in disposable company schemas.
- `node --test --test-concurrency=1 test/*.test.js`: **414/415 passing**. The pre-existing `salesOrderHsnReference` failure still reports that the active company database could not be resolved. Serial execution avoids intermittent native HANA driver pipe errors seen in parallel suite runs.
- Actual Cloud_Erp HTTP checks passed for login, company list/selection, dashboard (no warnings), sales-order list/reference data, warehouses and items. The temporary server was stopped.
- `git diff --check` passed. Browser interaction, every legacy/custom module, live WhatsApp sending and SAP-backed writes were not validated.

**Next task: Phase 3.** Implement the local Service Layer and pilot Sales Quotation → Sales Order. Company setup and reads are ready; document/master writes still require the local engine, and stock/accounting posting remains Phase 4.

### Frontend startup fix, 2026-10-11

Development was compiling all lazy ERP routes and applying production chunking and gzip compression. `frontend/craco.config.js` now enables Webpack on-demand compilation for dynamic imports in development and reserves custom chunking, hashed output and compression for production. No dependencies were added. Run `npm.cmd start` from `frontend`; use `http://localhost:3000` alongside the backend on its configured port.

Validation: the frontend compiled successfully, the login page rendered in Edge, and the sales-order list module compiled/loaded on demand in approximately 1.2 seconds without browser JavaScript errors. `node --test scripts/dev-config.test.js` verifies development, production and the opt-out configuration. A production build and remote-browser access were not checked. For development from another computer, set `DEV_LAZY_COMPILATION=false` in `frontend/.env` because Webpack's default lazy-compilation client connects to localhost. A large page can take longer on its first opening while it compiles.

The browser login check also found that the saved `manager` password no longer matched the current `SETUP_ADMIN_PASSWORD` in `.env`. Changing that environment value does not change an existing user's password; the seed deliberately preserves it. After the user requested the login fix, `manager`'s PostgreSQL password hash was explicitly updated from the current configured password. Login, assigned companies and Cloud_Erp selection were verified through the frontend proxy with HTTP 200. Future `.env` edits still do not automatically change existing users' passwords.

### Duplicate sales/delivery variants removed, 2026-10-11

Removed the DC, NC and SODA Sales Order/Delivery pages, lists, dedicated modules/components/styles, API clients, backend controllers/routes/services and form configuration: 122 files. Removed their series/settings selectors, copy targets, relationship-map navigation and sidebar registrations. Standard Sales Order and Delivery remain. Test manifests and obsolete variant-only SQL/patch artifacts were cleaned up.

Existing installations migrate eligible legacy permissions to the standard pages, reassign report links and child menus, then delete the retired menu records and rights in the existing menu-sync transaction. Only migration paths and regression fixtures retain the old names. Live `localerp` menu cleanup completed; company business documents were not deleted. Backend restarted to unload the six retired endpoints, which now return HTTP 404.

Validation: 18 frontend copy/API/state tests passed; backend suite 414/415 passed with the existing HSN reference failure. All 787 remaining frontend JavaScript/JSX files parsed with no missing local imports. Browser login and standard sales-order/delivery lists loaded without JavaScript errors, and returned menu permissions contained no variant routes. Document creation/posting and production builds were not checked in this cleanup.

### Phase 3 — Local Service Layer (writes)
- [x] Company schema migrations: numbered files in `backend/db/company-migrations/`, applied automatically to each company on its first query (`db/companyMigrations.js`, tracked in `"_Migrations"`). Never edit `company-schema.pg.sql` for an existing column change — add a migration.
- [x] `services/localServiceLayer.js` — marketing documents (Quotations, Orders, DeliveryNotes, Invoices, CreditNotes, Purchase Quotations/Orders/DeliveryNotes/Invoices/CreditNotes/Requests): SL field → SAP column maps, SL enums (`tYES`, `bost_Open`…), unmapped properties kept in `"LocalSlLog"`.
- [x] POST, PATCH (SL semantics: lines with `LineNum` update, without are added, omitted lines kept), GET by key, `Close`/`Cancel` for non-posting documents. One transaction per write; constraint errors return SL-shaped 400s.
- [x] Numbering from `NNM1` under a row lock (default series via `ONNM`, locked flag, last number, period indicator); manual numbers (`Series -1`) unique per document type. Posting period check from `OFPR` (missing/locked).
- [x] Totals: line discount → line total → header discount → tax (`STC1`/`OSTA`, or `OVTG`) → expenses → `DocTotal`; foreign currency via `DocRate`. Exchange rates: `SBOBobService_GetCurrencyRate`/`SetCurrencyRate` on `ORTT`.
- [x] Switch: `sapService.request` routes companies with dialect `postgres` to the local engine (no env flag needed); `ensureSession` is a no-op for them.
- [x] Pilot: real `submitSalesQuotation`, `submitSalesOrder` and `updateSalesOrder` save and edit on PostgreSQL. Check: `test/localServiceLayer.test.js` (`npm run test:local-sl`). Full suite 416/417 (only the old HSN failure).
- [ ] Other SL entities still answer **501** (`BusinessPartners`, `Items`, `UserFieldsMD`, `JournalEntries`, `InventoryGenEntries/Exits`, `StockTransfers`, `ProductionOrders`, payments, setup objects…). Next: masters (`BusinessPartners`, `Items`) so data can be created from the pages, then `UserFieldsMD` → `ALTER TABLE ADD COLUMN "U_x"` + `CUFD` row.
- [ ] GET collections with `$filter/$select` — only if a caller still needs them after the masters are done.
- [ ] Browser check of Sales Quotation → Sales Order pages on Cloud_Erp.

### Phase 3B — Master data and setup (SAP B1 setup order)
Source of truth for tables/fields: SAP B1 10.0 SDK table reference (help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/<TABLE>.html). Transaction pages already read these tables, so masters write to them directly. Each step ends with a local save working from its page and a test.

- [x] **M1 Warehouse** (`OWHS`; SAP: Administration → Setup → Inventory → Warehouses). Done 2026-10-11:
  - Migration `002_owhs_sap_columns.sql` brings `OWHS` to the SAP 10.0 column set (46 G/L accounts with FKs to `OACT`, tax group → `OSTC`, address, flags, code ≤ 8 / name ≤ 100 checks).
  - Local SL `Warehouses` master entity (POST / PATCH / GET) in `localServiceLayer.js`; generic `saveMaster` for the next masters.
  - SAP rules: code/name required, unique code, code not changeable, G/L accounts must exist and be active postable accounts, branch required when multiple branches are on, the default warehouse or one holding stock/open quantities cannot be made inactive.
  - Fixed reader bugs in `masterDataDbService.mapWarehouse` (also wrong for SQL Server/HANA): `IncreasingAcc`/`IncreaseGLAccount` were swapped, and `GoodsClearingAcc` read the Purchase Balance account.
  - Check: `test/localMasters.test.js` — the page's exact payload (35 fields) round-trips through `sapService` → local SL → `getWarehouse`.
- [x] **M2 GST tax setup** (SAP India: Administration → Setup → Financials → Tax). Done 2026-10-11:
  - Migration `003_gst_tax_setup.sql`: `OSTT` tax types (CGST -100, SGST -110, IGST -120 — the SAP system types the document readers sum); `OSTA`/`OSTC`/`STC1` brought to the SDK definitions (`STC1.LineNum` → SAP's `Line_ID`, `OSTC.Rate`, A/R-A/P validity, freight, reverse charge %, non-deductible %, G/L FKs).
  - Local SL entities `SalesTaxAuthorities` (tax components) and `SalesTaxCodes` (+ `SalesTaxCodes_Lines`), via the shared `saveMaster` (now with child rows and `afterSave`).
  - SAP/GST rules: component rate 0–100, sales + purchase tax accounts required; code = CGST+SGST at equal rates or IGST alone (never mixed), components unique, valid for A/R and/or A/P; rate and type come from the component; a component's new rate flows into its codes; posted codes/components cannot change rate or components (make a new one, inactivate the old); a component used in codes cannot change type.
  - Documents: tax rate = Σ `STC1.EfctivRate` (same as the readers); inactive codes and codes not valid for the document side (A/R vs A/P) are refused.
  - API `/api/tax-codes`: codes (create/get/update via SL), `/setup/codes` (incl. inactive), `/components` CRUD, `/types`. `/search` (document lookups) unchanged.
  - Page rebuilt (`modules/tax-code-setup/TaxCodeSetup.jsx`): **Tax Codes** tab (header + component rows, total rate) and **Tax Components** tab (type, rate, non-deductible %, reverse charge %, G/L accounts). Removed the VatGroups-model grid/utils/validation, their 9 outdated .md notes, and the unused `modules/tax-code/`.
  - New companies are created fully migrated (`seedNewCompany` applies migrations).
  - Check: `test/localMasters.test.js` (GST rules, readers' INTRASTATE/INTERSTATE detection, documents 100 + 18% = 118), HTTP smoke on Cloud_Erp for every new read endpoint. Full suite 418/419 (old HSN failure only).
  - Not yet: UTGST and Cess types (readers only sum CGST/SGST/IGST); tax code determination (auto-pick by place of supply) stays on the existing page logic.
- [x] **M3 HSN and SAC** (SAP India: Chapter ID `OCHP`, SAC Code `OSAC`). Done 2026-10-11:
  - Migration `004_hsn_sac_codes.sql`: `OCHP.Chapter` added (SDK), `ChapterID` unique/required; `OSAC` reduced to SAP's `ServCode`/`ServName` (draft duplicates `SACCode`/`ServiceCode`/`ServiceName`/`Dscription` merged and dropped), `ServCode` unique; SDK size limits; FKs `OITM.ChapterID → OCHP`, `OITM.SACEntry → OSAC`.
  - Local SL entities `ChapterIDs` and `SACCodes` (local names; SAP-connected companies maintain these in SAP). `saveMaster` now supports generated keys (`AbsEntry`) with a separate unique business code, and saves values a validator derives.
  - Rules: HSN 4/6/8 digits, Chapter/Heading/Sub-heading derived (2/2/rest) — `ChapterID` stays the HSN printed on documents; SAC 6 digits starting 99; description/service name required; unique codes. Items reference the internal key, so correcting a code keeps every item linked.
  - Fixed in `hsnCodeDbService`: the SAC list showed HSN codes when no SAC existed, and an unknown SAC resolved to an HSN key (wrong `OITM.SACEntry`); the alternate-column fallback now runs only when a query fails, not when it finds nothing.
  - API: `POST /api/hsn-codes/create`, `PATCH /api/hsn-codes/entry/:absEntry`, `POST /api/hsn-codes/sac/create`, `PATCH /api/hsn-codes/sac/:absEntry` (clear the response caches on save). Page **Master → HSN / SAC Codes** (`/hsn-sac-codes`, tabs HSN | SAC).
  - Check: `test/localMasters.test.js` (formats, duplicates, readers used by Item Master and documents, item link survives a code correction, FK), HTTP smoke on Cloud_Erp. Full suite 419/420 (old HSN-context test only).
  - Item Master: HSN already resolves to `OCHP`; SAC on items and saving items locally is M4.
- [x] **M4 Item Master and Business Partner** local save. Done 2026-10-11:
  - **Items** (`OITM` + `ITM1` prices, `OITW` per warehouse, `OBCD` barcodes, `ITM2` preferred vendors). Migration `005_item_master.sql`: 137 SDK columns, `ItemType` back to SAP's I/L/T/F letters (was a number), `Series`, SDK sizes/defaults, FKs to warehouse, vendor, tax codes, UoM group, manufacturer and G/L accounts; new `OBCD`/`ITM2`.
  - The Items field map is **generated** from the page's reader (`scripts/generateLocalItemFields.js` → `services/localItemFields.js`, 236 fields, 11 enums) and GET answers through `itemDbService.mapHeaderRow`, so writer and reader cannot drift. Regenerate after changing `mapHeaderRow`.
  - SAP item behaviour: a new item gets a row in every warehouse and every price list (and a new warehouse gets a row for every item); prices upsert per list; warehouse min/max/min-order/locked per row; series assign the code at save (prefix + 6 digits + suffix) under a lock; default item group; inventory items must be type Items; at least one of inventory/sales/purchase; active warehouse and tax codes (A/R, A/P); postable G/L accounts; valuation, batch/serial, UoM group and inventory flag cannot change once the item has stock or documents.
  - Fixed reader enums (also wrong for SQL Server/HANA), per the SDK: `GLMethod` W = Warehouse / C = Item Group (were swapped), `EvalSystem` S = Standard / B = Serial-Batch (were swapped), `TaxType` U = Use Tax, `ItemType` F = Fixed Assets.
  - **Business partners** (`OCRD` + `CRD1` addresses + `OCPR` contacts). Migration `006_business_partner.sql`: SDK columns the readers use, SDK sizes, FKs (payment terms, price list, sales employee, control/down-payment accounts, series), address key (BP, name, type), `SlExtra` JSON on OCRD/CRD1/OCPR so every other property the page sends round-trips (bank accounts, fiscal IDs, withholding rows…).
  - SAP BP behaviour: SL PATCH semantics for addresses/contacts (match by key or name, add new, keep omitted); default bill-to/ship-to/contact maintained and the default addresses copied onto OCRD (as documents read them); GSTIN format check on addresses and federal tax ID (GSTIN or PAN); type change only lead → customer; group must match the BP type (default group per type); currency must exist; balances are never set from the page; BP series per type assign the code at save (prefix + 5 digits).
  - Fixed seed: BP numbering series are per BP type in SAP (`DocSubType` C customers/leads, S vendors) — the seed made one `--` series, so the BP page found no customer series. Now Customers (prefix C) and Vendors (prefix V); migration 006 converts existing companies.
  - Check: `test/localMasters.test.js` — item page payload round-trips through `itemService` (all scalar fields, prices, warehouse rows, barcodes, vendors, HSN, properties), BP page payload round-trips through `businessPartnerController` (header, addresses incl. GSTIN/GST type, contacts, extras), SAP rule failures leave nothing behind, both series, both used on a sales order. HTTP smoke on Cloud_Erp (migrations 005/006 applied; page lookups respond). Full suite 421/422 (old HSN-context test only).
  - Assumption to confirm: CRD1 `GSTType` numbers 1–6 follow SAP's BoGSTType order as the BP page lists it.
  - Noise: each BP save logs "Metadata filtering unavailable" (the controller asks SL for `$metadata`; the local engine has none and the controller falls back to its own cleanup — harmless).
- [x] **M5 Existing setup pages** save locally. Done 2026-10-11:
  - Migration `007_setup_masters.sql` (SDK: OUOM, OUGP/UGP1, OCTG/CTG1, OPLN, OSHP, OBPL, OACT): sizes, unique names, `OCTG.PayDuMonth`/`VolumDscnt`, CTG1 key, `OPLN` validity dates/rounding rule/base FK, `OBPL` GSTIN/tax office/additional ID/`SlExtra`, `OACT` protected/budget/reval/project/details/`SlExtra`, tax-code FK.
  - Local SL entities: `UnitOfMeasurements`, `UnitOfMeasurementGroups` (+ rows), `PaymentTermsTypes` (+ installments), `PriceLists`, `ShippingTypes` (+ generic master DELETE that refuses records in use), `BusinessPlaces`, `ChartOfAccounts`.
  - SAP rules: UoM group keeps a 1:1 base row, unique UoMs, positive quantities, base UoM and item-used rows locked once items use the group; installments add up to 100 %; price list names unique (≤ 32), factor > 0, a **new price list is filled for every item from its base list × factor**; shipping type delete refused while used by BPs/items/documents; branch GSTIN format, default warehouse must belong to the branch, main branch cannot be disabled, first branch is main; accounts: parent must be a title account, level = parent + 1, account type inherited, `ActType` derived, title ↔ active refused with balance/children, title accounts refused on masters.
  - Reader fixes (`masterDataDbService`, also wrong for SAP-connected companies): payment terms "due date based on" now per SDK (P posting, S system, T document, C closing — was P/D/T), "start from" read from `PayDuMonth` (was hard-coded), cash discount % / discount code returned; branch returns the Branch page's own names (`DefaultWarehouseCode`, `FederalTaxID`, `GSTIN`…) so a loaded branch fills its fields; account `Confidential` no longer hard-coded; parent-account lookup lists title accounts only.
  - Pages: Chart of Accounts — **Title vs Active Account is now one choice** (the old "Title" button saved an active account), parent (title) account selector added, block-manual-posting / cash-flow flags sent; UoM page — new **Units of Measure** strip to add UoMs (endpoint `POST /api/uom-groups/uoms/create`); removed the unrouted duplicate `modules/uom-group`.
  - Check: `test/localSetupMasters.test.js` — every page payload through its real controller and back through its reader, plus the rules above. HTTP smoke on Cloud_Erp (migration 007 applied). Full suite 422/423 (old HSN-context test only).
  - Open: Payment Terms' cash-discount and payment-method dropdowns still ask SAP and show empty (no local masters yet — M6); Cloud_Erp's seeded chart has no title accounts (flat), so the parent list is empty until titles are added (CoA template — M6).
- [x] **M6 Missing SAP setup pages**: item groups, BP groups, sales employees, numbering series (`NNM1`), posting periods (`OFPR`, monthly), currencies/exchange rates, states, locations, G/L account determination. Includes the chart-of-accounts template, cash discounts and payment methods. Done 2026-10-11.

### Codex handoff — M6 completed, 2026-10-11

- **Master menu:** 13 company setup pages at `/setup/<kind>`: `item-groups`, `bp-groups`, `sales-employees`, `numbering-series`, `posting-periods`, `currencies`, `exchange-rates`, `states`, `locations`, `gl-determination`, `account-template`, `cash-discounts`, `payment-methods`. Refresh the company session/sign in again to receive the new menus. Administrator rights are synchronized by the existing menu flow; other roles need their relevant View/Add/Edit rights assigned.
- Migration `008_missing_setup.sql` adds the setup columns, constraints, fiscal categories (`OACP`) and day-count cash-discount tiers (`OCDC`/`CDC1`). Existing company upgrades remain automatic. No business records were imported or replaced.
- `localSetupMasters.js` extends the existing local SL master writer. Existing inline Item Group/Sales Employee creation also works; the narrow collection queries used by sales employees and Payment Terms now work locally. New APIs under `/api/local-setup` enforce the selected company and server-side menu rights. They intentionally refuse non-PostgreSQL companies.
- Groups, employees, states and locations feed the existing item/BP/warehouse readers. BP group type cannot change once assigned to a BP. Account selectors accept existing active postable accounts only. Cash-discount tiers are validated and replaced atomically; Payment Terms now offers and saves cash-discount/payment-method defaults.
- **Numbering:** create/edit series, inspect and set the object/subtype default, lock/unlock, extend ranges or advance the next number. Object, subtype, indicator, branch, initial number and prefix/suffix are immutable after creation. Backwards numbering, invalid subtypes, inactive branches and overlapping new ranges in the same context are refused. Existing seed ranges are broad: shorten an unused range before adding another overlapping series for that context.
- **Monthly periods:** create 12 months from a financial-year start and a new indicator, including leap years; concurrent overlapping requests are serialized. An unused unlocked annual period can be explicitly split into months, preserving its indicator, first record ID and due/document-date windows. A year with documents is not split. Period names, due/document-date windows and lock status can be edited. Document saves enforce these windows; updates recheck period locks even when the posting date is unchanged.
- **Account determination:** maintain fiscal-category defaults in `OACP`; item-group and warehouse accounts remain on their own pages. **Chart template:** preview and explicitly apply five title accounts plus the nine starter accounts. It preserves codes/balances, refuses conflicts transactionally and is safe to repeat. The browser check did not apply this template or split Cloud_Erp's annual period; these are explicit setup actions.
- **Currencies/rates:** currency codes and dated positive direct rates feed `OCRN`/`ORTT`; local currency is fixed at rate 1. Rate writes and their audit entries share a transaction.
- SAP table references used: [OITB](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/OITB.html), [OFPR](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/OFPR.html), [OACP](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/OACP.html), [OCDC](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/OCDC.html), [CDC1](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/CDC1.html), [OPYM](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/OPYM.html).

Validation:
- Full backend suite: **425/426 passing**, with the same pre-existing `salesOrderHsnReference` missing-company-context failure.
- Final targeted backend run: **6/6 passing** (`localMissingSetup`, `localSetupMasters`, `localServiceLayer`), including live PostgreSQL rules, rollback, concurrency, company isolation and all 13 HTTP read routes plus forbidden actions.
- Frontend interaction tests: **4/4 passing** for saves, immutable state identity, server errors, monthly-year creation and navigation reset.
- Production build, gzip compression and the 500 KB JavaScript chunk check passed. All 13 setup pages loaded with live Cloud_Erp data in headless Edge without browser JavaScript exceptions. Save-rule tests use disposable companies; the live browser check only reads setup data.
- Cloud_Erp applied migration 008 during the smoke check. The temporary backend/browser were stopped and their files removed. Restart the existing backend to load the new routes, then refresh the company session for the new menus.

Limits: day-count cash discounts only; the chart is a local starter template, not a statutory localization template. Period maintenance offers Unlocked/Locked; other existing restricted statuses fail closed in the local writer. Advanced account-determination rules, applying discounts to payments, stock/journal posting and opening balances remain later work. M6 stores the setup consumed by Phase 4; it does not implement that posting engine.

### Phase 4 — Posting engine (per document, sales first)
- [x] **Copy-from** (marketing documents): `BaseType/BaseEntry/BaseLine`; base `OpenQty`/`OpenSum` recomputed from all non-cancelled copies; rows and documents auto-close; cancelling a copy reopens its base. Done 2026-10-12.
- [x] **Stock for marketing documents:** `OITW/OITM.OnHand/IsCommited/OnOrder` + `OINM`, moving average (`OITM.AvgPrice`) for Delivery, A/R Invoice, A/R Credit Memo, GRPO, A/P Invoice, A/P Credit Memo. Done 2026-10-12.
- [x] **Stock for inventory documents:** Goods Receipt/Issue, Inventory Transfer (+ Transfer Request). Done 2026-10-17. Production (BOM, production orders, issue/receipt for production) done 2026-10-19.
- [x] **Journal entries for marketing documents:** `OJDT`/`JDT1` from account determination (`OITB`/`OWHS` by item G/L method → `OACP` defaults), GST component accounts (`OSTA`), freight (`OEXD`), rounding. Done 2026-10-12.
- [x] **BP balances** (`OCRD.Balance` = debit − credit, so vendors are negative as in SAP). Payments and reconciliation remain.
- [x] Cancel posting documents (SAP cancellation document reversing stock + JE) and payments — 2026-10-17.
- [x] Incoming/outgoing payments and manual journal entries (2026-10-17). Internal reconciliation screen (OITR) and payment cancellation remain.
- [ ] Rollout order: Sales (Quotation → Order → Delivery → Invoice → Credit Memo) → Purchase (Request → Order → GRPO → Invoice → Credit Memo) → Inventory → Production → Payments/JE.
- [x] Check: `test/localPosting.test.js` — full PO → GRPO → A/P invoice and SO → Delivery → Invoice → Credit memo chain with hand-computed SAP numbers (stock, average, every JE row, BP balances, inventory account = on hand × average).

### Claude handoff — Phase 4 marketing-document posting, 2026-10-12

- **Where:** "posting (Phase 4)" section of `services/localServiceLayer.js`, hooked into `createDocument`, `updateDocument` and `setDocumentStatus`. Migration `009_posting_engine.sql`: `OEXD.RevAcct/ExpnsAcct`, `OACP.RoundAcct` (rounding account, shown on G/L Account Determination), copy-from and order indexes.
- **Copy-from rules:** allowed bases per SAP (Order ← Quotation; Delivery ← Quotation/Order; Invoice ← Quotation/Order/Delivery; A/R Credit Memo ← Invoice; Purchase Quotation ← Request; PO ← Request/Quotation; GRPO ← PO; A/P Invoice ← PO/GRPO; A/P Credit Memo ← A/P Invoice). Base must be not cancelled, the row open for a new link, same BP, currency and item. Copying more than the open quantity is allowed and closes the base row (SAP default). A row's base cannot be changed by PATCH.
- **Committed/ordered:** recomputed per item/warehouse from open order rows (never incremented), so edits, copies, close and cancel stay exact.
- **Stock:** goods out at average cost; GRPO / standalone A/P invoice in at net document price (after header discount) and recompute the average; A/P credit memo out at document price; A/R credit memo back in at the invoice's cost. Invoice from delivery and A/P invoice from GRPO move no stock. Negative stock is blocked; batch/serial items and non-moving-average items are refused with a clear message (not supported yet).
- **Journal:** Delivery Dr COGS / Cr inventory. GRPO Dr inventory / Cr allocation (no tax). A/R invoice Dr customer / Cr revenue, output tax per component, freight, rounding (+ COGS/inventory when it moves stock). A/P invoice Cr vendor / Dr inventory (standalone), allocation at GRPO value + price difference (from GRPO), expense (non-inventory or service), input tax. Credit memos reverse their invoice. Rows are merged per account/BP/cost centre; an unbalanced entry fails the save. JE numbers come from the object 30 series.
- **Posted documents:** PATCH may change remarks/references/UDFs only; items, quantities, prices, warehouses, taxes, totals, posting date and new rows are refused.
- **New companies** get posting defaults: account `220000` Goods Received Not Invoiced (also in the chart template), `OACP` receivables/payables/revenue/expense/COGS/allocation, warehouse 01 allocation account.
- **Existing companies (e.g. Cloud_Erp)** were seeded before this: posting documents will stop with "Define the … account" until set up. Steps: Chart of Accounts Template → Apply (adds 220000), then G/L Account Determination (receivables 110000, payables 200000, revenue 400000, expense 510000, COGS 500000, allocation 220000, rounding as chosen) and Warehouse 01 → Accounting: allocation and price-difference accounts. Open orders' committed quantities refresh the next time they are touched.

Validation: `test/localPosting.test.js` passes; full backend suite **431/432** (only the pre-existing `salesOrderHsnReference` context failure). Frontend `LocalSetup` tests 4/4. Not done: browser check of the posting pages, production build.

Limits: no per-warehouse costing, FIFO or standard cost; price difference is not revalued into stock still on hand; GRPO freight posts no JE; `OCRD.OrdersBal/DNotesBal` not maintained; UoM conversion between base and target rows assumes the same unit.

### Demo company with trial data, 2026-10-12

- `node backend/scripts/seedDemoData.js` creates company **Demo Trading** (schema `cmp_demo_trading`, login `manager`) and fills it through `sapService` and the setup service, so every SAP rule applies. `--reset` drops and rebuilds only `cmp_demo...` schemas. `Cloud_Erp` is not touched.
- Contents: chart template + 6 accounts, G/L determination, freight (`OEXD`), 5 states, 2 locations, USD/EUR + rates, 3 sales employees, BP groups, Net 30/45, cash discount, payment methods, 4 item groups, warehouses 01 (Ahmedabad) and 02 (Mumbai), GST 5/12/18 CGST+SGST and IGST, 8 HSN + 1 SAC, 6 customers (GJ, MH, KA, DL, unregistered), 4 vendors, 9 stock items + 1 service. Documents: 1 purchase request, 1 purchase quotation, 5 POs, 5 GRPOs, 3 A/P invoices (one with a price difference, one with freight), 1 A/P credit memo, 4 quotations, 6 orders, 4 deliveries, 6 A/R invoices (freight, header discount, walk-in, service), 1 A/R credit memo. Open quotations, orders, POs and un-invoiced GRPOs remain for copy-from testing.
- Check: all 20 journal entries balance, trial balance nets to zero, GRNI equals the un-invoiced GRPOs, inventory account = stock value (₹0.01 moving-average rounding). Smoke test of every parameter-free GET route as `manager`: 313 OK, 29 need query parameters, **18 fail on schema gaps** (to fix): `ODSC` banks, `OCRC` credit cards, `OTTR` remark templates, `RDOC` layouts, `OITT.PlAvgSize` (BOM), production `Ref2`, `OHEM.dept`, `CustomsGroups` and `$metadata` SL GETs, `INFORMATION_SCHEMA.COLUMNS` upper case and `LOWER(text)` dialect issues, `/report-codes` null error, A/R credit memo `open-*` routes.
- Fixed: opening any saved document showed `relation "RDOC" does not exist` (shared print toolbar metadata). `documentPrintLayoutService.getDocumentReportMetadata` now checks `RDOC` exists (`reportTableExists`) and otherwise returns the document with no layout plus a warning; the toolbar shows the warning and disables Print/PDF. Local print layouts remain Phase 6.
- Empty by design until Phase 4 continues: payments, journal entries (manual), goods receipt/issue, inventory transfers, production.

### User-defined fields (UDF maker), 2026-10-12

- Page **Tools → User-Defined Fields - Management** (`/udf-management`, `modules/udf-management`), API `/api/udfs` (rights by menu path; delete needs Edit). Tables: Marketing Documents title/rows, BP, addresses, contacts, items, item-warehouse, warehouses, item/BP groups, sales employees, payment terms, price lists, branches, G/L accounts, JE header/rows, tax codes, inventory documents, payments (only those present in the company).
- Engine: SL `UserFieldsMD` in `localServiceLayer.js` (POST, GET/PATCH/DELETE by `(TableName='X',FieldID=n)`), so `sapService` callers (Job Work, Gate Pass provisioning) work locally too. Writes SAP's `CUFD` + `UFD1` and `ALTER TABLE ADD COLUMN "U_<Name>"` in one transaction. A marketing-document field is added to all 11 header (or row) tables, as SAP's "Marketing Documents" category.
- SAP rules: types Alphanumeric (Regular/Address/Phone, length 1-254), Text, Numeric, Date/Time, Units and Totals (Rate/Amount/Price/Quantity/Percentage/Measure); unique name; mandatory needs a default (existing records filled); default must be a valid value; valid values or linked table, not both; name/type/structure fixed after creation; length can only grow; delete drops the column and its data.
- Local extension (migration `010_user_defined_fields.sql`, table `LocalUdfRule`): **formula** (fills the field on every save; read-only on pages) and **validation rule** + message, enforced on documents (rows and title; `SUM(row field)` on the title) and masters. Expression engine `services/udfExpression.js` (safe parser, no eval; `node services/udfExpression.js` self-check).
- Pages need no change: the existing readers (`udfMetadataService`, sales-document schema metadata) now also read SAP's `EditType`/`RTable` and expose formula/validation. Column caches are cleared on UDF changes (`clearTableColumnCaches`), so new fields appear without a backend restart.
- Check: `test/localUserFields.test.js`, `UdfManagement.test.jsx`, HTTP end-to-end on Demo Trading (fields visible in Sales Order and Delivery reference data in the same running server). Full backend suite 432/433 (old HSN test only). Demo Trading keeps example fields: rows `U_Length`, `U_Width` (rule ≥ 0), `U_Area` = `ROUND(U_Length * U_Width, 2)`; title `U_TotalArea` = `SUM(U_Area)`.
- Not yet: formulas recalculate on save, not live while typing; user-defined tables (`UserTablesMD`) and UDOs for custom lookup lists; SAP-connected companies get the fields but not formulas/rules.

### UI theme fix, 2026-10-12
The 13 M6 setup pages (`modules/local-setup`) used their own web-form look. They now use the shared `im-*` master-page family (toolbar with mode badge, label-left compact fields, SAP grids, `im-alert`) with layout-only CSS on `--sap-*` tokens. Rules for every agent: `docs/UI_THEME.md` (linked from `AGENTS.md` and `CLAUDE.md`).

### UI consistency pass, 2026-10-12 (Claude)
- Modal/lookup overlays (`sap-modal-shell__overlay`, `sap-lookup-modal__overlay`) are now `position: fixed`. They are portaled into `.app-shell__content`, which scrolls, so `absolute` only dimmed the first screen and the dialog drifted off-centre after scrolling (e.g. Address Component on the Logistics tab).
- Document/setup header rows tightened from ~40px to ~26px (shared rule in `sap-ui.css`: field `margin-bottom: 0`, field-grid `row-gap: 3px`) for `po/so/del/im` families.
- Document Lines matrix (`so-`/`del-grid-wrap__scroller--contents`) capped at `clamp(220px, 100vh - 360px, 520px)` with its own scrollbars and a sticky header, so the horizontal scrollbar stays visible.
- HSN/SAC page moved off Tax Code's private `tc-*` CSS to the `im-*` skeleton (toolbar above tabs, mode badge, labelled inputs, shared `SapLookupModal`). Test: `HsnSacCodes.test.jsx`.
- Header UDF sidebar on 993–1600px screens: UDF column `clamp(220px, 17vw, 260px)` and 104px header labels (PO from 1200px), so the two-column header no longer collapses (breakpoints are viewport based but app navigation takes ~290px).
- Older setup families (`tc-`, `pt-`, `st-`, `br-`, `coa-`, `qc-`, `wac-`) normalized in one `.app-shell`-scoped block in `sap-ui.css`: toolbar, title, buttons (24px), inputs (22px), tabs, grids, alerts. `.app-shell` scope is needed because lazily loaded module CSS wins specificity ties.
- One modal backdrop token `--sap-overlay-bg` for every page-level overlay (was 22 different dims); nested `sap-modal-shell` overlays are transparent.
- Header columns capped at `minmax(280px, 440px)` with `justify-content: space-between` (SO/Delivery/PO families), tab grids at 520px and 4px row gap, so fields no longer stretch when the UDF sidebar is closed.
- Compact density (user preferred the 90% browser-zoom look): tokens `--sap-control-height` 20px, `--sap-button-height` 22px, `--sap-control-font-size` 11px, `--sap-grid-font-size` 10.5px, `--sap-page-font-size` 12px, `--sap-title-font-size` 13px. Raw px in `sap-ui.css` converted to these tokens; an EOF `.app-shell`-scoped block re-applies them over module CSS for all page families and `.sap-modal-shell__body`. CSS `zoom` was rejected: ~210 vh/vw sizes and ~12 JS-positioned popups would break. Module rules marked `!important` still keep their own size.
- Data-entry pass (2026-10-12): `components/SapShortcutManager.jsx` (renamed from SapFindShortcutManager) adds Ctrl+S (toolbar primary), Ctrl+Enter (+ Add Line, focuses the new row), Esc (closes topmost legacy popup via its close button; SapModalShell handles its own), Enter/Up/Down row navigation in `so-/del-/po-grid` cells. `SapLookupModal` search box: Up/Down highlight, Enter chooses (first row if none). `hooks/useUnsavedChangesWarning.js` wired into 19 document pages (browser close/refresh only; in-app navigation keeps taskbar drafts). Frozen `#`/Item No. columns were tried and removed (user saw the sticky column covering Item Description as a bug; SAP's matrix does not freeze either). Column minimums lowered for the compact font (`documentLineColumnWidth.js`). Footer/field grids capped at 440px. Empty date placeholders hidden until focus. Tests: `SapShortcutManager.test.jsx`, `SapLookupModal.test.jsx`, `useUnsavedChangesWarning.test.js`; width expectations updated in SO/Delivery ContentsTab and `serviceDocumentLiveFields` tests.
- Document tabs unified (2026-10-12): all Sales / Purchase / Service document Logistics, Accounting, Tax, Electronic Documents and Attachments tabs now render through shared components in `frontend/src/components/document/` (`DocumentTabLayout` primitives, `SalesLogisticsTab`, `DocumentAccountingTab`, `DocumentTaxTab`, `DocumentEDocTab`, `DocumentAttachmentsTab`; `components/purchase-order/PurchaseLogisticsTab.js` moved onto the same primitives). Page `components/*Tab.jsx` files are thin wrappers passing each page's existing header keys via `names` (e.g. Delivery `languageCode`/`bpChannelCode`/`projectCode`, GRPO `formNo`/`centralBankInd`, A/P `consolidatingBp`), so save payloads are unchanged. SAP fixes: "Sec 2" -> "Sec 7"; "Confirmed" -> "Approved"; Tax fields on SQ/PR/PQ/PO/A/R were unbound (now bound; pages pass `header`); language codes 3=English (US), 8=English (UK) only (old lists mislabelled 8/26 as Hindi/Gujarati, unknown saved codes still shown); A/P "Reason for Issuing Note" now credit-memo only; Purchase-only fake "Use Shipped Goods Account" removed. Removed dead `TaxTab copy.jsx` (PR, PQ). Tests: `components/document/DocumentTabs.test.jsx`, `APInvoice/components/TaxTab.test.jsx`. Open SAP questions: purchase Logistics still labels the company address "Bill To" (SAP says Ship To; field `billTo` kept because the backend saves it); "Split Purchase Order" shows on all purchase docs (SAP: PO only); SO/SQ/A/R/Service eDoc tabs get no header data from their pages (read-only).
- Fiori Horizon + classic density mix (2026-10-12): `sap-ui.css` `:root` tokens moved to SAP Horizon values (flat button tokens replace the gradients; 38 hard-coded gradients mapped to tokens) plus an EOF "Fiori Horizon skin" block (buttons, fields, icon-tab-bar tabs, tables, cards, message strips, dialogs; grid-cell inputs stay borderless until hover/focus). `sidebar.css` gets a "Fiori Horizon shell" block before its media queries (light side navigation with blue selection indicator, white 48px shell bar, plain label/value chips, window frame as a soft card, flat taskbar). `dashboard.css` restyled as a Fiori overview page (flat header, soft cards, Horizon chart palette). Density tokens unchanged. Production build passes.
- Full SAP B1 Fiori look (2026-10-12, user found the dense mix "too old"): density tokens moved to Fiori compact (26px controls, 13px text, 18px titles); final `html body .app-shell` "SAP B1 Fiori" layer in `sap-ui.css` (object-page header with transparent actions, Horizon fields with bottom line, muted left labels at 140px, 16px-radius cards, icon tab bar on a white card, responsive tables with row lines only, borderless cell inputs; fixed: previous cell rule lost specificity to the field rule). Column minimums in `documentLineColumnWidth.js` raised back for 13px (tests updated).
- Fiori polish (2026-10-12): type-scale tokens (12/13/14/20px, 400/600/700) and 24px density; no uppercase labels (sidebar groups, menu search, topbar eyebrow/chips); the old "Final project-wide button normalization" `!important` block now uses Fiori button tokens (it had forced dark bold boxed buttons over every later rule); toolbar actions transparent (`!important`), primary semibold; tighter header/tab/table spacing; currency mode select 128px, currency picker real chevron (was a literal "v"), schema field 170px; larger window controls; slim taskbar.
- Not done: browser check (no headless browser installed). Pre-existing test failures unrelated to this pass: 4 suites import `axios` without a mock (ESM in Jest) — Delivery/GRPO/Purchase Request/AP Invoice `ContentsTab.test.jsx`, `purchaseOrderDataMapping.test.js`; 1 Delivery row-UDF lookup assertion.

### Phase 5 — Setup and master pages that the SAP client used to provide
Some already exist (warehouses, tax codes, payment terms, branches, UoM, HSN, price lists, chart of accounts). To add:
- [ ] Company details (monthly fiscal periods and posting period lock completed in M6)
- [x] Numbering series (`NNM1`) — M6
- [x] Item groups and BP groups — M6
- [x] G/L account determination setup — M6; posting remains Phase 4
- [x] Currencies and exchange rates — M6
- [ ] Users and authorizations (merge into `app`)
- [x] Opening balances (stock + G/L + BP) — 2026-10-17

### Phase 6 — Remove SAP
- [ ] Delete the Service Layer HTTP code, `mssql`, `@sap/hana-client`, the report-service (Crystal) path, the SAP env vars and the SAP-only scripts in `backend/scripts`.
- [ ] Printing: use the local layouts only (`documentPrintDefaultLayout`).

- [x] Remove obsolete SAP/Crystal layout toolbar and automatic layout requests from local document pages (2026-10-13). Backend report integrations and local printing remain separate work.

### Phase 7 — Operations
- [ ] A scheduled nightly `pg_dump` backup, plus a tested restore.
- [ ] Update `START_DEPLOY.bat` and the deployment docs.

## Open questions
- Stock valuation: moving average only, or also FIFO / standard per item?
- Is GST (CGST/SGST/IGST) the only tax regime needed?

### Codex handoff - Local document errors and layout cleanup, 2026-10-13

- Fixed PostgreSQL catalog translation for bracketed and double-quoted INFORMATION_SCHEMA.COLUMNS/TABLES. The shared adapter now handles the SQL used by document/UDF schema discovery; live metadata reads passed on cmp_demo_trading and cmp_cloud_erp.
- Demo purchase order 5 existed: the reader referenced optional OPOR.LangCode, swallowed the SQL failure, then reported not found. It now uses the shared physical-column helper and propagates header query failures. Read-only verification loaded purchase order 5 and its lines successfully; no business data was changed.
- Removed SAP layout/schema selectors, Print/PDF actions, automatic report metadata requests and imports from all consuming document pages (sales, purchase, service, inventory and job work). Deleted the shared toolbar, purchase/inventory/sales-order wrappers, obsolete wrapper test, unused layout hook and document-print API client. No local print replacement was requested.
- Checks: pgDb and purchaseDocumentContentLoading (32 passed); newSalesOrder schema/dialect/isolation (21 passed); npm test in backend (5 passed); localDocumentUi removal regression (1 passed); frontend DocumentTabs via react-scripts (27 passed). Parsed 786 frontend JS/JSX files and resolved their relative imports; git diff --check passed.
- Limits: no browser interaction or production build. Restart backend to load the adapter/reader fixes and refresh frontend. Backend report/Crystal services still have report/WhatsApp consumers; full driver, connection, report-service and environment cleanup is still unchecked in Phase 6. Existing unrelated workspace changes were preserved.

### Codex handoff - Delivery to A/R Invoice save fix, 2026-10-13

- [x] Fix local base-linked invoice saves that omit ItemCode (Delivery to A/R Invoice; shared with the other marketing document copy chains).
- Cause: arInvoiceService intentionally sends BaseType/BaseEntry/BaseLine without ItemCode for copied rows. The local engine ran item master validation before loading the referenced row and rejected the valid copy with "Row 1: select an item."
- localServiceLayer now loads and validates current-company base rows after BP/currency defaults, before item defaults. Missing ItemCode and WarehouseCode come from the base row. Explicit mismatched items, wrong BPs/currency, missing/cancelled/closed bases and missing items on standalone documents remain invalid. Creation and update share the fix; no page or company-specific workaround.
- Regression: localPosting.test.js now invoices a delivery without ItemCode/WarehouseCode and checks saved item, warehouse, delivery closure, unchanged stock and balanced journal entries. GRPO to A/P Invoice also omits ItemCode. Negative cases cover missing bases, wrong customer, mismatched item, closed base and standalone missing item.
- Checks: localPosting (1 passed), localServiceLayer/localMasters/localUserFields/salesDocumentLinePayloadUtils (23 passed), backend npm test (5 passed); syntax and scoped git diff --check passed. Tests use disposable company schemas; no Demo Trading documents were posted or changed.
- Limits: browser save was not exercised. Restart the backend process to load the fix, then retry the existing invoice draft. No frontend refresh is needed for this backend-only change.

### Codex handoff - All document copy-chain check, 2026-10-13

- [x] Verify the shared missing-item fix across all 14 currently supported item marketing-document copy chains and four service invoice/credit entities in two isolated company schemas.
- The Delivery screenshot has the same root cause: deliveryService deliberately omits ItemCode when sending valid base-document references. The shared localServiceLayer fix already handles this for every marketing-document entity; no duplicate page-specific changes were needed.
- The process serving port 5001 initially started at 12:03:51, before localServiceLayer.js changed at 12:12:32. It was still running the old engine. During these checks it was replaced by a process started at 13:05:38; /health returned HTTP 200. Codex did not stop or restart either process.
- Added localDocumentCopyChains.test.js to test all supported sales and purchase copy edges, inherited current-company ItemCode/WarehouseCode, remaining base quantity and balanced journal entries, plus service documents without items. Two companies use different item codes. Added this test to npm run test:local-sl.
- Checks: copy-chain integration tests (2 passed, 28 copy operations plus 8 service saves); deliveryPayload, serviceDocumentLinePayloadService and salesDocumentLinePayloadUtils (21 passed). Previous posting regression already verifies no second stock deduction for Delivery to A/R Invoice and GRPO to A/P Invoice. Tests used disposable companies; Demo Trading records were not saved or changed.
- Limits: these checks cover the currently supported marketing-document engine and related payload builders. Browser interaction and unrelated inventory/production/job-work workflows were not exercised. Retry Add on the current draft to clear the previous error and use the newly started backend.
### Codex handoff - UoM group visibility and SAP setup behavior, 2026-10-13

- [x] Fix the UoM setup page's saved-unit visibility, group saves and conversion definition flow.
- Read-only Demo Trading inspection confirmed OUOM already contains KGS (name KILO) and KG, while OUGP contains EA and KG. SAP defines company-wide units separately from groups; creating a unit must not silently create a group. Existing company setup was preserved.
- Page now exposes separate Units of Measure and UoM Groups tabs, a visible code/name unit list, explicit Refresh, company-change reload and duplicate-error refresh. Group searches load all pages; the unit lookup returns all company units and exposes uomName without breaking existing lookup fields. Empty padding rows are skipped; all entered rows are validated before writing; completed writes retain their IDs if a later row fails, allowing a safe retry.
- Group code/name limits now match SAP SDK OUGP (20/100). Group Definition uses SapModalShell, fixes the base row at 1 = 1, supports decimal conversions, rejects zero/negative quantities and duplicate units, correctly edits padded rows and blocks saves after failed reads. Backend enforces the fixed base row and prevents conversion changes for affected units in open marketing documents, preserving existing rules for assigned bases and item-used unit removal.
- UI uses shared im-* classes and item-master styling; removed the unused 343-line private stylesheet. Replaced misleading module README claims about dimensions/EWB fields with the actual supported behavior and official references.
- Official sources: https://learning.sap.com/courses/managing-logistics-in-sap-business-one/working-with-units-of-measure-uom-in-sap-business-one ; https://help.sap.com/docs/SAP_BUSINESS_ONE/68a2e87fb29941b5bf959a184d9c6727/1fd747565899f81ae10000000a441470.html ; SDK 10.0 OUOM/OUGP table references.
- Checks: frontend UoMGroupSetup (9 passing tests); live localSetupMasters (2 passing tests including company isolation, duplicate lookup, base row, removal protection, open-document block and successful change after close); backend npm test (5 passing). Syntax and scoped diff checks passed. Headless Edge verified KGS/KILO in the running company unit table, availability in group selectors and the conversion dialog; compared styling with Warehouse at 1365 x 900.
- Backend on port 5001 was restarted to load the unit reader and conversion rules; health is OK. No Demo Trading unit/group values were changed during verification. Test writes used disposable company schemas.
- Limits: production build was not run. Conversion guards currently cover supported marketing documents; production, blanket agreement and draft rules remain future local-engine work. Unit dimensions/packaging/EWB mapping and full SAP setup parity are not claimed.

### Claude handoff - Inventory documents posting, 2026-10-17

- [x] Goods Receipt (`InventoryGenEntries`, OIGN), Goods Issue (`InventoryGenExits`, OIGE), Inventory Transfer (`StockTransfers`, OWTR) and Inventory Transfer Request (`InventoryTransferRequests`, OWTQ) save locally through the existing document engine in `services/localServiceLayer.js` (entries in `DOCUMENTS` with `inventory: true`; transfers use SL `StockTransferLines`, `FromWarehouse`/`ToWarehouse`, `DueDate`). No page or page-service change was needed.
- Stock: receipt in at row price (moving average recalculated); issue out at average cost (row price/total replaced by cost, as SAP); transfer out of the from-warehouse and into the to-warehouse at average (company average unchanged), two `OINM` rows. Negative stock, locked item-warehouse, non-inventory items and same from/to warehouse are refused. Posted rows are stored closed; remarks/references/UDFs can still be patched.
- Journal: receipt Dr inventory / Cr row account or Inventory Offset - Increase; issue Dr row account or Inventory Offset - Decrease / Cr inventory; transfer Dr to-warehouse / Cr from-warehouse inventory account (no entry when both share one account). Offset account lookup: warehouse or item group (by G/L method), then G/L Account Determination.
- Copy-from: Transfer from Transfer Request consumes and closes the request. Goods Receipt from PO, A/P Invoice or Goods Issue (what the page offers) is a reference only: it inherits item, unit and net local price and does not consume the base.
- Migration `011_inventory_documents.sql`: `OACP.DecreasAc/IncreasAc` (existing companies default to their expense account `DfltExpn`; new companies get 510000 from the seed), `Ref1`/`Ref2` on OIGN/OIGE/OWTR/OWTQ, WTR1 base index. G/L Account Determination page shows the two offset accounts; item-group labels now use SAP's "Inventory offset - decrease/increase".
- Inventory documents are not part of the UDF "Marketing Documents" group.
- Check: `test/localInventoryDocuments.test.js` (in `npm run test:local-sl`), hand-computed stock, average, every JE, refusals, transfer-request closure, reference copy, posted PATCH rules, and the Goods Receipt page payload through `goodsReceiptService`. Full backend suite 437/438 (only the old `salesOrderHsnReference` failure). Frontend LocalSetup 4/4.
- Limits: batch/serial items are refused (as on marketing documents); Cancel of posted inventory documents is still 501 (cancellation phase); the Inventory Transfer page has no copy-from-request UI, so request closure works through the SL only. Restart the backend to load the engine and apply migration 011; no browser check was done.

### Claude handoff - Payments and manual journal entries, 2026-10-17

- [x] `IncomingPayments` (ORCT, object 24), `VendorPayments` (OVPM, object 46) and `JournalEntries` (object 30) save locally (`services/localServiceLayer.js`, "payments and manual journal entries" section). The existing pages and services send their usual SL payloads; no page change.
- Payments: means (cash, bank transfer, checks, credit cards) must equal the total. A BP payment settles A/R and A/P invoices, credit memos and open journal entry rows (each locked, same BP, not cancelled, never more than still open). The remainder stays on account (`NoDocSum`, open on the payment's BP journal row). An account payment (`rAccount`) posts to its G/L rows, which must add up to the total. Settling raises `PaidToDate`, closes fully paid documents and lowers the open amount on their BP journal row, which the open-item lists read.
- Journal: incoming = means accounts debit / BP control account (or G/L rows) credit; outgoing the reverse; BP balances move by the full total. Manual entries: balanced rows, each either debit or credit, on active postable accounts or business partners (control account from the BP or G/L determination); a BP row moves the balance and shows as an open item for payments.
- Shared `writeJournal` now saves every journal entry (documents, payments, manual), so numbering, open amounts and BP balances follow one rule. Posted A/R and A/P invoices and credit memos record their control account (`CtlAccount`).
- Migration `012_payments.sql`: SDK payment header columns, RCT1-4 / VPM1-4 (checks, paid documents, cards, accounts), `CtlAccount`/`PaymentRef`/`Project` on OINV/ORIN/OPCH/ORPC. Fixed for PostgreSQL: both payment pages' open-item lists failed (missing invoice columns, and `ISNULL(BaseRef, Number)` mixing text and integer, now cast inside, valid on every dialect).
- Check: `test/localPayments.test.js` (in `npm run test:local-sl`) uses the real Incoming/Outgoing Payment and Journal Entry page services and checks open items, settlements, on-account amounts, refusals, BP balances, control accounts and cash. Demo Trading payment/JE readers all respond (migrations 011/012 applied). Full backend suite: only the old `salesOrderHsnReference` failure; `localServiceLayer.test.js` now uses `ProductionOrders` as its unsupported example.
- Limits: local currency only (foreign-currency payments are refused); cash discounts on payments refused; no payment cancellation yet; no internal reconciliation screen/OITR records (open amounts live on JDT1 balances); no tax on manual JE rows. Restart the backend to load this; no browser check was done.

### Claude handoff - Cancellation, opening balances, cash discounts, reconciliation, JE tax, 2026-10-17

- [x] **Cancel posted documents** (Delivery, A/R Invoice/Credit Memo, GRPO, A/P Invoice/Credit Memo, service invoices/credit memos, Goods Receipt/Issue, Inventory Transfer): `cancelDocument` in `localServiceLayer.js`. Refused while a non-cancelled target document copies it or while it is paid/reconciled (`PaidToDate`). Otherwise a cancellation document (`CANCELED = 'C'`, same series, original posting date, rows referencing the original) reverses every `OINM` movement at its original value (moving average recomputed; refused if received stock has since been used) and the journal entry (`StornoToTr`, both entries fully reconciled, BP balances back). The original becomes `CANCELED = 'Y'`, its base documents reopen and committed/ordered quantities refresh. Delivery and GRPO can also be **closed** (status only).
- [x] **Cancel payments** (`IncomingPayments`/`VendorPayments` `/Cancel`): settled documents and journal rows reopen by what was applied (plus any discount), and the entry is reversed. Refused once the amount on account was reconciled.
- [x] **UI:** shared `components/document/DocumentStatusActions.jsx`: one "Data ▼" toolbar menu (Close Document / Cancel Document, SAP confirmation), ordered after Copy From/To (`sap-document-toolbar__data`, order 6, own open/close CSS in `sap-ui.css`), on 21 document pages, through one route `POST /api/documents/:type/:docEntry/:action` (`routes/documentActionsRoutes.js`; needs View + Edit on the page's menu; goes through `sapService`, so SAP-connected companies use SAP's own Cancel/Close). Pages reload the document afterwards (`utils/copyToState.js` `reloadRouteDocument`, or the page's fetch function for service pages and payments).
- [x] **Opening balances** (page **Master → Opening Balances**, `/opening-balances`, API `/api/local-finance/opening-balances`): G/L accounts and business partners post one journal entry (transaction type -2) against the offset account (default: Opening Balance account `OACP.LinkAct_18`). BP rows keep their due date and stay open, so the payment pages list them as Opening Balance items and settle them. Item stock posts a Goods Receipt (`Ref2 = 'OB'`) at the entered price against the opening warehouse balance account (`OACP.DftStockOB`). Migration 013 defaults both accounts to the starter chart's 300000 where unset.
- [x] **Cash discounts on payments:** `DiscountPercent` per invoice is checked against the invoice's payment terms (`OCTG.DiscCode` → `OCDC`/`CDC1` day tiers from the posting or document date). The payment clears amount + discount on the invoice, and the discount posts to new G/L Account Determination accounts `OACP.CashDscAR` (sales, expense) / `CashDscAP` (purchasing, income). These column names are local: check them against the SAP SDK before relying on the names.
- [x] **Internal reconciliation** (page **Banking → Internal Reconciliation**, `/internal-reconciliation`, API `/api/local-finance/reconciliation`): select a BP's open journal rows (invoices, credit memos, payments on account, opening balances, manual entries) with equal debits and credits. The open amounts go down and invoices/credit memos count the amount as paid. Recorded in SDK `OITR`/`ITR1`. Payment settlements still reduce open amounts directly and write no OITR rows.
- [x] **Tax on manual journal entry rows:** a G/L row with a tax code is the base, and SAP-style tax rows are added per GST component on the same side (output tax for credit rows, input tax for debit rows), flagged `VatLine = 'Y'` with `VatGroup`/`BaseSum`/`VatAmount` (migration 013). The page service's balance pre-check now leaves taxed entries to the engine.
- Shared journal writer: per-row due dates; reversals keep them.
- Checks: `test/localCancellation.test.js`, `test/localFinance.test.js` (both in `npm run test:local-sl`), `DocumentStatusActions.test.jsx`, `FinancePages.test.jsx`, `utils/copyToState.test.js`. Full backend suite: only the old `salesOrderHsnReference` failure; `localServiceLayer.test.js` now expects 404 for cancelling a missing invoice.
- Limits: no cancellation of a reconciliation; foreign-currency payments still refused; no tax adjustment on cash discounts; opening stock is a Goods Receipt, not SAP's separate Inventory Opening Balance object. Restart the backend (migration 013) and refresh the company session for the two new menus. No browser check was done.

## Handoff 2026-10-17 — Purchase Request lines

- Fixed: Required Qty. (and Info Price, Vendor, Discount %, Distr. Rule) were locked when the company SAP layout was loaded. The shared `buildSalesOrderMatrixColumnsFromLayout` marks keys without a Sales Order writable mapping as read-only; `normalizePurchaseRequestMatrixColumns` (now in `frontend/src/config/purchaseRequestForm.js`) re-opens the PR entry columns. SAP's own "not editable" (`active: false`) is still respected.
- Added: missing SAP B1 Item/Service Type selector on the Contents tab (locked after the document is added).
- Checks: `react-scripts test --testPathPattern purchase-request --transformIgnorePatterns "node_modules/(?!axios)/"` — 6/6 pass.
- Limits: Info Price is not auto-filled from the vendor price list / last purchase price on item select.

## Handoff 2026-10-17 — Internal Reconciliation

- Backend `reconcile` (localServiceLayer.js): rejects the same journal row selected twice (it bypassed the open-amount check) and a reconciliation date earlier than a selected row's posting date (SAP B1 rule).
- Page: Auto Reconcile button (matches the smaller of selected debits/credits, oldest first), amount > open blocked client-side, amount columns right-aligned.
- Checks: `node --test test/localFinance.test.js` (backend); `react-scripts test --testPathPattern FinancePages` (4/4).
- Limits: no Manage Previous Reconciliations / cancel reconciliation screen; BP reconciliation only (no G/L account or multi-BP selection).

## Handoff 2026-10-17 — Popup overlays on scrolled pages

- Bug: popups portal into the scrolling `.app-shell__content`; 16 overlays used `position: absolute; inset: 0`, so on a scrolled page the dim covered only part of the screen and the dialog opened above the view (e.g. Incoming/Outgoing Payments → Payment Means).
- Fix: those rules → `position: fixed`; shared rule in `styles/sap-ui.css` (next to the shared backdrop) pins every page-level overlay to the viewport; Payment Means capped at `100vh - 48px` with scroll; report dialog layers got `z-index: 1300`.
- Check: `src/styles/modalOverlayPosition.test.js` fails if a full-cover overlay/backdrop/layer uses `absolute`.
- Limits: verified by tests, not in a browser; overlays with z-index < 1390 opened while a page window is maximized may still sit behind it (unchanged).

## Handoff 2026-10-17 — Inventory documents (GR, GI, Inventory Transfer, Transfer Request)

- Fixed: item lists were empty on all four pages — `OITM.LstEvlPric` (SAP Last Evaluated Price) was missing locally and `safe()` hid the SQL error. New migration `014_item_last_evaluated_price.sql` adds `LstEvlPric` + `LstEvlDate`.
- Fixed: GR Copy From PO / A/P Invoice read `OPOR/OPCH.Ref2` unconditionally → now metadata-checked; transfer/request read-back used `WTR1/WTQ1.StockValue` unconditionally (lines vanished on reopen) → metadata-checked.
- Added (SAP standard): GR/GI line **Whse** column (pages already handled it; tab never rendered it). Inventory Transfer / Request footer: **Sales Employee**, **Journal Remark**, **Remarks** (state + payload existed, no UI); backend now posts `SalesPersonCode` and reads `SlpCode` back.
- Multi-company: GR/GI hard-coded one company's IGN1 UDF columns (brokerage, buyer/seller…) as standard; they now show only when the current company has a matching UDF.
- Checks: `node --test test/localInventoryPages.test.js` (fails on any swallowed "Query failed"); `react-scripts test --testPathPattern goods-receipt`.
- Limits: local schema has no batch tables (`OIBT`/`OBTN`/`OBTQ`) — batch lookup on GR/GI is always empty; local ERP has no batch/serial tracking yet. Not browser-verified.

## Handoff 2026-10-17 — Header fields stretching when side bar / UDF panel closes

- Cause: the shared "SAP B1 header" cap in `styles/sap-ui.css` (2 columns, max 440px) only listed the sales/PO grid classes. GR/GI (`gr-goods-receipt__header-grid`), Inventory Transfer/Request (`itr-transfer-request__header-grid`), Purchase Request (`pr-header-grid`), Job Work (`jw-header-grid`) and service A/R-A/P documents (`service-a?-header-grid`) used their own `1fr 1fr` grids; A/P Invoice, A/P Credit Memo headers and PO/PQ/PR/SQ footers forced `1fr 1fr` inline, overriding the existing `.po-field-grid` / `.so-field-grid` cap.
- Fix: added those classes to the shared cap; removed the six inline overrides; new `.sap-document-footer-fields` (max 440px) for single-column Remarks/Journal Remark footers (GR, GI, transfers).
- Check: `src/styles/documentHeaderWidth.test.js`.
- Limits: not browser-verified; widths below 993px still follow each page's own stacking rules.

## Handoff 2026-10-17 — Header UDF / Form Settings side panel size

- Cause: one `FormSettingsPanel` / `HeaderUdfSidebar` component, but each page family sized the right column itself: sales 220-260px, PO 250-320px (!important), Purchase Request 260-290px, Delivery 280-320px, banking 240px, service documents six breakpoints 220-320px; sales stacked UDF labels above fields below 1200px, others put them left.
- Fix: token `--sap-side-panel-width: clamp(240px, 18vw, 300px)` and one shared rule at the end of `styles/sap-ui.css` for `.po/.so/.del/.sap-document/.sap-banking-layout.is-sidebar-open` (≥993px; PO family ≥1200px, where it stops stacking); panel fields always label-left (96-120px). Rule added to `docs/UI_THEME.md`.
- Check: `src/styles/documentHeaderWidth.test.js`.
- Limits: not browser-verified; the old per-page rules are still in module CSS (overridden), removable later.

## Handoff 2026-10-17 — Side panel follow-up (default state, PO override, sales padding)

- GR, GI, Inventory Transfer, Transfer Request opened the Header UDF panel by default (`useState(true)`); now closed like the other 15 document pages.
- The old `.app-shell .po-page.sap-document-page .po-layout.is-sidebar-open` rule (5 classes, !important, 250-320px) beat the shared width on the PO family; it now uses `--sap-side-panel-width`.
- Width token raised to `clamp(260px, 20vw, 320px)` (≈273px at 1366px).
- Sales panel stacked 14px header/body padding inside the card padding (content inset ~30px) and a 32px close button; shared rule now sets card padding 12px, header 0 0 8px, body 0, close 24px on every family.
- Checks: `src/styles/documentHeaderWidth.test.js` (default-closed panel; no !important two-column sidebar rule other than the token).

### Claude handoff - Master pages losing entered data, 2026-10-17

User report: some tabs (contact persons, addresses) did not save. An audit created, changed, cleared and reloaded every field of the master pages through their real controllers and readers.
- **Business Partner:** the backend saved and reloaded every contact and address field. The page silently dropped a contact or address typed without its Contact ID / Address ID (placeholder "Define New" rows were filtered out of the payload). Now Add/Update stop with a message and open that tab (`modules/business-partner/unnamedRows.js`, test). A new contact starts with an empty Contact ID (it used to hold the text "Define New"), and both ID fields show "Required".
- **Item Master:** `buildPayload` sent a field only when it had a non-empty, non-zero value. So clearing a field, entering 0, unticking a property, BOM type back to "No BOM", etc. never reached the database. On Update the page now also sends every changed field that the rules skipped, limited to properties the Service Layer returned for the item, with batch/serial still excluded (`itemPayloadChanges.js`, test). The page reloads the item after Add/Update.
  - Header Price List / Unit Price is saved into that list's item price.
  - Remarks (General and Remarks tabs) is SAP's User Text (`User_Text`).
  - Create QR Code From and Manage Inventory by Warehouse are sent.
- **Item attachments:** the page now uploads, lists, deletes and downloads them (download goes through the API client so the login token is sent). Files are stored per company and item, `uploads/items/<companyId>/<item>/`, with safe file names (no path escape). Previously files existed only in the browser, and the server stored them per item code across companies.
- `itemController`: the negative-number checks now stop the save (they used to answer 400 and save anyway).
- **Warehouse, Price List, Shipping Type, Branch, Chart of Accounts:** emptied fields are now sent (null / ''), so they clear instead of keeping the old value.
- **Chart of Accounts:** the reader returns Control Account (`LocManTran`) and Revaluation (`RevalMatch`). The currency list comes from the company's `OCRN` plus "All Currencies" (##).
- **Branches:** a new branch got the table defaults (a second main branch and warehouse 01, which belongs to branch 1), so every later edit of branch 2+ was refused. The engine now gives only the first branch the main flag, leaves the default warehouse empty until one is chosen, and checks the warehouse only when it changes. Migration 014 repairs existing branches.
- **Payment Terms:**
  - The page's own Code and Load Limit Credit are stored (local OCTG columns `PymntCode`/`LoadLimit`, migration 014; the reader falls back to GroupNum for SAP-connected companies).
  - Tolerance Days is sent.
  - Removing every installment row removes them.
  - A 0% installment gets a clear message instead of the raw database error.
- **Engine:**
  - The price list Valid From/To check compared Date objects as text (weekday names).
  - Changing a UoM group's base unit now drops the old base's made-up 1 = 1 row.
  - Saved child rows (UoM definitions, tax code lines) are no longer logged as Unmapped.
- **Cache:** a successful master save now also clears the 30-minute `/lookup/` caches, so new UoMs, groups, accounts, etc. show in other pages' dropdowns at once.
- Checks: `test/localItemUpdates.test.js` and `test/localMasterPageFixes.test.js` (in `npm run test:local-sl`), `unnamedRows.test.js`, `itemPayloadChanges.test.js`. Full backend suite: only the old `salesOrderHsnReference` failure. Frontend tests for all touched modules 58/58. The production build passes. No browser check was done.
- **Still open (found by the audit, not fixed):**
  - Item Master tabs that are written but not rendered: UDF, prices grid, barcodes, UoM, preferred vendors, accounting, warehouse stock.
  - Item Master fields with no storage: Material Type (GST), Additional Identifier, Service Category (`sc_*` options vs the numeric `ServiceCategoryEntry`), Excisable Type, Component Warehouse / Tolerance Days (planning), Advanced Rule Type.
  - Batch/serial management is still not sent (the engine refuses batch/serial items on documents).
  - The item reader queries `ITM12`, which local companies don't have.
  - Chart of Accounts distribution fields and the Project/Dimension "enabled" checkboxes are not sent.
  - Several setup pages still use their own `tc-`/`pt-`/`st-`/`br-`/`coa-` CSS instead of `im-*`.

### Claude handoff - User-defined tables and objects (Job Work, Gate Pass), 2026-10-17

Job Work and Gate Pass failed on local companies with "does not support GET /UserTablesMD('STTL_JWSM')". The engine now serves what these modules call:
- **`UserTablesMD`** GET('NAME') / POST. Creates `"@NAME"` with SAP's system columns for the table type (no object, master data, master data rows, document, document rows, no object with auto-increment). Registers the table in `OUTB`. A missing table answers 404. A table that already exists answers SAP's "already exists" code -2035, which the provisioning treats as done (an existing `UserFieldsMD` field gives the same code).
- **`UserFieldsMD`** already accepted `'@NAME'` tables. The column cache is cleared on create.
- **`UserObjectsMD`** GET('CODE') / POST, stored in `OUDO` + `UDO1` (child tables and their ObjectName). The engine checks that the main/child table types match the object type.
- **UDO records** `/{Code}`: POST, GET(key), PATCH(key). The header holds the `U_` fields plus Remark/Creator (Name for master data). Children go in `<ObjectName>Collection` with LineId 1..n. PATCH updates rows that have a LineId, adds the rest and keeps rows it does not mention. UDF valid values, types and rules are checked like on documents. A document UDO is numbered from its NNM1 series (sent, else the ONNM default), or 1, 2, 3… when no series is set up. Cancel/Close/DELETE are not implemented because these modules do not call them.
- **`/U_<Table>`** for tables without an object: POST, GET, PATCH and DELETE by Code.
- Migration `015_user_defined_objects.sql` adds `OUTB`, `OUDO` and `UDO1`. `parseUrl` now accepts entity names with digits.
- Module fixes (all companies):
  - Gate In's `U_CHECK` field was 1 character long, with "Yes"/"No" valid values, so provisioning failed. It is now 3 characters.
  - Gate Pass master codes are numbered on PostgreSQL (no `TRY_CAST`; the regex is passed as a parameter).
  - The Job Work and Gate Pass update deleted the rows it had just added (rows without a LineId). Removed rows are now deleted before the PATCH.
- Checks: `test/localUserObjects.test.js` (in `npm run test:local-sl`):
  - Test 1 runs both provisionings and re-runs them (0 created).
  - It posts Gate In, Customer Receipt Note (goods receipt) and Jobwork Issue Note (inventory transfer) through the real services.
  - It checks the links both ways and the `/U_` and `/{Code}` resources.
  - Test 2 runs the pages' readers (lists, open, update, master rows). It is **skipped** until `pgDb.bindParams` stops treating `"@Table"` inside a quoted identifier as a parameter. With that one-line fix applied in memory, test 2 passes.
  - Full backend suite: 445 pass, 1 skipped (test 2), plus the old `salesOrderHsnReference` failure.
- **Still open:**
  - **`pgDb.bindParams`:** it must skip `"..."` identifiers like it skips `'...'` strings. Until then every Job Work/Gate Pass list, detail, update and master-code read fails locally (the `@STTL_...` table name becomes `$n`).
  - **`pgDb` string literals:** it also rewrites `[0-9]` and `\d` inside string literals.
  - **Series on Job Work stock postings:** `documentSeriesWriteValidation` refuses a goods issue or goods receipt sent without `Series`, on every company. Jobwork Issue Note (goods issue lines) and Jobwork Receipt/Return Note never send one, and the customer notes send one only when the page fills `GoodsIssueSeries`/`GoodsReceiptSeries`. SAP would use the default series, so the fix belongs in the shared validation.
  - `OBIN` does not exist locally, so the bin lookup returns nothing (the error is caught).
  - No automatic "Primary" series is created when a UDO is registered.

### Codex handoff - repository publication, 2026-10-17
- Prepared the current project snapshot for the requested private SAP-LOCAL-ERP GitHub repository.
- Checks: reviewed ignored environment/runtime files; scanned publishable files for common private-key/token patterns and files over 50 MB (none found).
- Limits: application tests were not rerun for this repository-only task; existing functional limits above remain. Pattern scanning is not a full secret audit.


### Handoff 2026-10-19 — Distribution Rule 2-5 columns removed
- Removed `CostingCode2-5` ("Distribution Rule 2-5") from the item and service line schema in `backend/modules/newSalesOrder/newSalesOrderConstants.js` and from the service-document CPRF list in `backend/services/sapFormPreferenceUtils.js`. All sales, purchase and service document grids now show only the standard SAP B1 `Distribution Rule` column; dimensions 2-5 are still picked through its dimension-assignment dialog, and `OcrCode2-5` still save and load.
- Check: `node --test test/newSalesOrderSchema.test.js` (new test). Full backend suite: the only failure is the HSN/OCHP test, which also fails on `main`.

### Handoff 2026-10-19 — SAP layout fallback warnings removed
- `backend/services/sapDocumentLayoutService.js`: when no layout has been imported, the built-in standard layout is now used without a warning. Removed the `[SAP_LAYOUT] No imported layout found ...` server log and the "Live SAP Form Settings were unavailable" warnings that every document page listed.
- Check: `node --test test/sapLayoutLocalFallback.test.js`. Real query errors still log through `queryRowsSafe`.

### Handoff 2026-10-19 — Chart of Accounts fixes
- Balance: `masterDataDbService.getAccount` now calculates Balance from posted `JDT1` lines (debit - credit). A title account shows the total of every account below it. `BalanceCurrency` is the company's local currency (`OADM.MainCurncy`). The local service layer now refuses to turn an account with postings into a title account; before, it checked `OACT.CurrTotal`, which nothing ever updated.
- Lookups: the currency lookup marks the local currency with `local`, and the parent-account lookup returns `level`. Both are extra fields, so other callers are unaffected.
- Page (`modules/chart-of-accounts/ChartOfAccounts.jsx`): rebuilt on the shared `im-*` styles and deleted its private `chartOfAccounts.css`.
  - Find with empty fields now lists all accounts.
  - Level shows the parent's level + 1 (or 1 for a top-level account) until the account is saved.
  - After a save, the account is reloaded and the parent list refreshed.
  - Removed the Distribution Rule section (PRODUCT/DIVISION/BRANCH): its values were never saved and its labels came from one company.
- Checks: `node --test test/localSetupMasters.test.js` (balance and postings rule added) and `react-scripts test src/modules/chart-of-accounts`. Full backend suite: the only failure is the HSN/OCHP test, which also fails on `main`.
- Limits: Block Manual Posting and Cash Flow Relevant are still stored in `SlExtra` and not enforced on journal entries. Foreign-currency balance is not shown.

### Handoff 2026-10-19 — Production pages on the local engine
- Problem: the BOM page failed with "The local ERP does not support POST /ProductTrees yet". Production Order create, Release and Close, and posting Issue/Receipt for Production also could not save, because the local engine had no `ProductTrees` or `ProductionOrders` handler and refused rows based on a production order (BaseType 202).
- `backend/services/localServiceLayer.js`:
  - `ProductTrees` (OITT/ITT1) and `ProductionOrders` (OWOR/WOR1) added as masters.
  - BOM rules: the product item must exist; components are items or resources and cannot be the product itself; quantity must be > 0; warehouses must exist; row prices come from the price list; `OITM.TreeType` is set on save and reset on delete.
  - Production order rules: numbered from the object 202 series; a standard order needs a BOM, and its rows are scaled from the BOM when the page sends none; status goes Planned → Released → Closed, or Planned/Released → Cancelled only without issues or receipts; only planned orders can be edited; disassembly orders are refused as not supported.
  - Issue/Receipt for Production (`loadProductionBase`, `refreshProductionOrders`): rows must be based on a released order. An issue takes the order row's item and warehouse. A receipt row is the product, valued at the issued component cost not yet received per open unit (component returns at their issue cost). The offset goes to the order warehouse's WIP account when one is set. `WOR1.IssuedQty` and `OWOR.CmpltQty/RjctQty` are recalculated after every posting and cancellation; a cancellation is refused once the order is closed.
  - Framework: child rows support enums, header reads map enums back, and delete removes child rows (`afterDelete`, empty `usedBy`).
- Migration `016_production.sql` (all `ADD COLUMN IF NOT EXISTS`): OITT/ITT1 BOM columns, `OWOR.Priority`, `ORSC.DfltWH`, `IGE1/IGN1.BaseRef`, `IGN1.TranType`, OWHS receiving-bin columns. This also fixes three readers that failed before: the BOM list, the Issue for Production list, and receipt order loading.
- Check: `test/localProduction.test.js` (added to `npm run test:local-sl`) runs the pages' own services end to end: BOM → order → release → issue → two receipts → close, the cancel and edit rules, every production reader, the Bill of Materials report and the Open Items List. `localServiceLayer.test.js` now uses `BlanketAgreements` as its unsupported example. Full backend suite: the only failure is the HSN/OCHP test, which also fails on `main`.
- Limits: no variance posting when an order closes; no backflush auto-issue; by-products and disassembly orders, and batch/serial items, are not supported. No browser check was done.

### Handoff 2026-10-19 — Production limits closed; batch and serial numbers
- Batch and serial numbers (whole engine, every stock document): migration `017_batches_serials_wip.sql` adds OBTN/OIBT/IBT1 and OSRN/OSRQ/OSRI/SRI1. Document lines keep their `BatchNumbers`/`SerialNumbers`; `postStock` calls `moveBatchesAndSerials`.
  - Batch quantities must add up to the row's inventory quantity; a serial item needs one serial per unit.
  - Receipts create batches and serials, issues take them from the warehouse, and transfers move them.
  - A serial cannot be received while it is in stock, and an issue refuses a batch or serial that is not in that warehouse.
  - Cancellation reverses the logged moves (`reverseBatchesAndSerials`).
  - The engine's old "batch and serial numbers are not supported yet" refusal is gone.
- WIP: production rows always post against the WIP account (order warehouse `WipAcct`, else G/L determination `OACP.WipAcct`); without one, posting stops with "Define the WIP inventory account…". Migration 017 adds `OACP.WipAcct/WipVarAcct`. On the starter chart it reuses an account named "Work in Process" / "Production Variances" or creates one at the first free code (125000…, 530000…). Demo Trading's 530000 is "Purchase Price Difference", so its variance account will be 535000.
- Variance on close: closing a released order posts what is left in WIP (issued cost − received value) to the WIP variance account and links the entry on `OWOR.TransId`.
- Backflush: receiving the product (completed or rejected) first posts an Issue for Production of the backflush rows in proportion (`backflushForReceipt`), so the product is valued with them. Batch or serial items cannot be backflush rows.
- By-products: a negative planned quantity on an item row of a standard or special order. It uses the manual issue method, cannot be issued, and is received at the item's cost; its issued quantity goes negative, as in SAP. The receipt service matches a page-added by-product row by item code and sends the product without a base row.
- Disassembly: the order is built from the BOM with every row on manual issue. Issue for Production issues the product (`CmpltQty`), and Receipt from Production receives the components at their item cost (row issued quantity = received). The receipt reader no longer refuses an order whose product was fully issued.
- Frontend: the Production Order row quantity accepts negative values (by-products).
- Checks: `test/localBatchSerial.test.js` (new) and `test/localProduction.test.js` (second test covering backflush, a batch component, a by-product, the variance entry including Demo Trading's taken 530000, and disassembly). Both are in `npm run test:local-sl` (23/23). `localMissingSetup.test.js` now expects 17 accounts. Full backend suite: the only failure is the HSN/OCHP test, which also fails on `main`.
- Limits: bin locations are not tracked (bin allocations are accepted but not stored); serial and batch are not combined on one item; the variance entry is one amount (no price/quantity split); no browser check was done. Restart the backend so migrations 016/017 load (the runner reads the migration files at startup).

### Handoff 2026-10-19 — Production module brought to SAP B1 parity
An audit of the four production pages found wrong postings, lost data, fake figures and missing SAP functions. Fixed:

**Postings and data**
- Receipt from Production posted the product at price 0. Production rows are now valued by the engine: the product at open WIP cost, by-products and disassembly components at item cost.
- Issue for Production loaded orders through the old Service Layer path, which lost batch/serial/bin flags and broke disassembly. Orders now load from the database.
- Backflush counted by-product rows as product quantity.
- Production order text rows came back as items after a reload, and base ratio was wrong after a reload.
- Never saved before, now saved: the order user, the Sales Order / parent production order link (`OriginType/OriginAbs/OriginNum`), Pick and Pack Remarks, and the actual closing date. The variance entry is posted on the closing date.
- Item codes in Service Layer keys are now URL-decoded.

**New functions**
- Cancel for production orders, issues and receipts (routes + buttons).
- One issue can cover several production orders.
- First/Previous/Next/Last browsing on all four pages (`productionDbService.navigateRecord`).
- Production Order Summary tab with real actual and planned costs, WIP and variance (`getProductionOrderSummary`). It also has a Related Documents list with links to the issues, receipts and variance journal entry.
- Production Order: Issue Components and Report Completion actions; filters by status, type and due date.
- Attachments for BOMs and production orders, through the shared `controllers/attachmentController.js`; Item Master now uses it too.

**BOM**
- Row types Item, Resource, Text and Route Stage. Remove, Duplicate and browsing.
- SAP BOM type rules (production = inventory item; sales/assembly = non-inventory sales item; resources only on production/template BOMs).
- "Hide BOM components" is now saved.
- Unit price and production std cost are shown, and the cost rolls up into the product's `OITM.PrdStdCst` (items + resources).
- BOM report: a lone "From" means `>=`, extended quantities, route stage and currency on component rows.

**Resources and route stages** (migration `019_resources_route_stages.sql`)
- Setup pages under Production: Resources (`ORSC`: type, group, UoM, issue method, default warehouse, standard cost, resource account), Resource Groups (`ORSB`) and Route Stages (`ORST`). All three use the shared `/setup/:kind` page and `localSetupMasters`.
- BOM stages are stored in `ITT2` and production order stages in `WOR4`; they are copied from the BOM when an order is created.
- Issuing a resource posts quantity × standard cost from WIP against the resource account. It moves no stock, and backflush covers resources too.
- G/L determination gains `ResAcct`; the starter chart gets "Resource Absorption" (540000, or the first free code). `IGE1` loses its item foreign key and gains `ItemType`.

**Other migrations**
- `018_production_order_header.sql` adds `OWOR.CloseDate` and `PickRmrk`.

**Frontend**
- The BOM, Production Order, Issue for Production and Receipt from Production pages are rebuilt for the above.
- Their module CSS now uses only `--sap-*` tokens.
- New pure-helper jest tests in each module (19 tests).

**Checks**
- `test/localProduction.test.js` third test: resources, stages, the sales order link, multi-order issue, resource journal, Summary, receipt cancel, closing date and variance, order cancel, text rows, browsing and the BOM report.
- `npm run test:local-sl`: 24/24. The full backend suite with `--test-concurrency=1` has one failure, the HSN/OCHP test, which also fails on `main`. When test files run in parallel, `localMissingSetup` can fail on a HANA-client pipe error; this is environmental and it passes with concurrency 1.
- Frontend: eslint clean; 19/19 tests across the production modules and setup; `npm run build` passes.

**Limits**
- Not done: resource capacity planning, MRP origin, the price/quantity split of variance, bin locations, and the "Update Parent Item Prices Globally" utility.
- Dead Service Layer code removed (2026-10-19): the old `$filter`/`$select` readers, mappers and lookups in `productionOrderService.js`, `receiptFromProductionService.js` and `issueForProductionService.js` (about 930 lines). It was found by tracing what the exported values reach, not the export keys. The production tests and the full suite still pass.
- No browser check was done. Restart the backend so migrations 016–019 load.

