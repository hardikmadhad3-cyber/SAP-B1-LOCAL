# Codex Changes

Updated: **11 October 2026** (Asia/Calcutta).

This records the changes made during this conversation: the Claude handoff, PostgreSQL application migration, fresh company setup, frontend startup fix, manager login fix, and duplicate Sales Order/Delivery removal. Validation results describe the checks performed at the time of each change.

## 1. Claude handoff and existing foundation

- Recovered the migration context from the Claude screenshot, repository code and project plan.
- Created and maintained [docs/LOCAL_ERP_PLAN.md](docs/LOCAL_ERP_PLAN.md) with completed phases, implementation notes, test results and next steps.
- Preserved the existing, uncommitted Phase 0 PostgreSQL foundation. The initial PostgreSQL installation, `pg` dependency and adapter groundwork were already present; they are not all newly authored Codex changes.
- Continued the agreed fresh start: no SAP or SQLite business records imported.
- Used database `localerp` on local PostgreSQL port `5433`. The separate `cloud_erp` databases belonging to another project were left alone.

## 2. Phase 1: application data moved to PostgreSQL

### Storage and configuration

- Added [backend/db/app-schema.pg.sql](backend/db/app-schema.pg.sql) for application users, companies, roles, menus, settings, reports, QC and WhatsApp tables.
- Added [backend/services/appDbService.js](backend/services/appDbService.js), providing PostgreSQL queries, metadata and transactions. Schema initialization runs once per schema, can retry after failure, and transactions use one checked-out connection.
- Changed `authDbService.js` to use PostgreSQL while retaining its public API and cache helpers.
- Stored shared application data in schema `app`.
- Stored company-specific QC and WhatsApp data in validated `app_company_<CompanyId>` schemas.
- Updated `backend/config/env.js`, `.env.example` and local `.env` to support/use `AUTH_DB_PROVIDER=postgres`, retaining the existing database connection.
- Updated company configuration, database dispatch, Admin Panel and report-layout compatibility where needed for PostgreSQL.
- Kept SQLite SQL files for historical scripts and existing test fixtures; runtime auth, QC and WhatsApp use PostgreSQL.

### Controllers and compatibility

- Updated QC, WhatsApp and webhook controllers/helpers to await PostgreSQL operations.
- Required active-company context for company-specific QC/WhatsApp storage.
- Used atomic WhatsApp upserts for customer and open-conversation creation.
- Made menu sort positions numeric to preserve fractional sidebar ordering.
- Corrected PostgreSQL upsert translation, quoted `SET` handling and nullable menu-ID comparisons.
- Extended adapter keyword compatibility through the shared HANA SQL normalizer.

### Files and checks

Principal edited files: `backend/services/authDbService.js`, `qcDbService.js`, `whatsappDbService.js`, `companyConfigService.js`, `dbService.js`, `adminPanelService.js`, `reportLayoutService.js`, `applicationMenuSyncService.js`; `backend/controllers/qcController.js`, `whatsappController.js`, `whatsappWebhookController.js`; `backend/db/pgDb.js`, `hanaDb.js`; backend environment examples, configuration, package scripts and lockfile.

- Added `backend/test/appDb.test.js` and extended `pgDb.test.js` and `transferredFeatureSafety.test.js`.
- Added backend command `npm.cmd run test:app-postgres`.
- Phase 1 PostgreSQL checks: **10 passing tests**.
- Phase 1 full backend suite: **412/413 passed**; the pre-existing `salesOrderHsnReference` failure remained.
- HTTP checks passed for health, public companies and setup-administrator login.

## 3. Phase 2: fresh Cloud_Erp company setup

### Company schema

- Added [backend/db/company-schema.pg.sql](backend/db/company-schema.pg.sql): native PostgreSQL DDL for **118 SAP-named tables**.
- Preserved SAP table/column casing and defined numeric precision, primary keys, indexes, defaults and foreign keys.
- Covered setup, business-partner/item masters, sales/purchase headers and lines, freight/address data, inventory, production, payments, journals and core report lookup tables.
- Gave copied document tables independent identities and restored foreign keys that PostgreSQL `LIKE` does not copy.
- Added compatibility fields and query-group flags required by existing read services.

### Seed and actual database changes

- Added [backend/scripts/seedNewCompany.js](backend/scripts/seedNewCompany.js) and backend command `seed:company`.
- Validated company name, `cmp_` schema identifier, fiscal year and username before creating data.
- Used a transaction and advisory locks for company creation and bootstrap-user setup.
- Made repeated setup preserve the existing registered company's data. Conflicting company names and unregistered existing schemas are refused.
- Created **Cloud_Erp** in **`localerp.cmp_cloud_erp`**, registered with dialect `postgres`.
- Created/mapped application user `manager`, company `OUSR` access, assignment and scoped SuperAdmin role access. Existing users' passwords are preserved by the seed.
- Seeded the following minimum setup:

| Setting | Initial value |
| --- | --- |
| Currency / country | INR / India |
| Fiscal year | 2026–27: 1 April 2026 through 31 March 2027 |
| Base chart of accounts | 9 accounts |
| Numbering series | 25 |
| Warehouse | `01` |
| Branch / location | One default branch and location |
| Groups / unit | General item group, Customers/Vendors groups, EA unit and conversion |
| Other defaults | Due Immediately terms, Base Price List, Standard shipping, Unassigned salesperson |
| Tax | Zero tax code `ZERO` |

The initial company contained **zero business partners, items, orders and invoices**. The seed is for fresh companies, not schema upgrades or database resets.

### Read-service compatibility

- Enhanced `backend/db/pgDb.js` to translate nested `SELECT TOP` queries within their owning scopes, running-total window frames and regular-expression predicates.
- Validated company schema identifiers and restricted connection search paths to the selected company schema, preventing fallback into public tables.
- Added integer casts to nullable group/branch filters in `masterDataDbService.js`.
- Corrected inventory-audit grouping when the optional account expression is a literal fallback.
- Added the PostgreSQL dialect option and schema help text to Admin Panel.

### Checks

- Added `backend/test/companyPostgres.test.js` and expanded `pgDb.test.js`; added `test:company-postgres` command.
- PostgreSQL company tests: **4/4 passed**. Checks included disposable companies, repeat/conflict setup, authentication, isolation, master/document lists, report reads, numbering, numeric totals and foreign-key rejection.
- Phase 2 full serial backend suite: **414/415 passed**, with the same existing HSN reference failure.
- Actual Cloud_Erp HTTP checks passed for login, company list/selection, dashboard without warnings, sales-order list/reference data, warehouse search and items.
- Temporary test schemas were cleaned up and temporary smoke-test servers were stopped.

## 4. Frontend startup performance fix

The development build was compiling all lazy ERP pages and applying production chunking and gzip compression.

- Changed [frontend/craco.config.js](frontend/craco.config.js) to compile dynamic imports on demand during development.
- Reserved custom chunk splitting, hashed output filenames and gzip compression for production builds.
- Added `DEV_LAZY_COMPILATION` to `frontend/.env.example`. Set it to `false` for remote-browser development because Webpack's default lazy client connects to localhost.
- Added [frontend/scripts/dev-config.test.js](frontend/scripts/dev-config.test.js): **3 tests passed** for development, production and the opt-out.
- Restarted the frontend on port `3000` and verified the login page in Edge.
- Verified on-demand sales-order list module loading in approximately **1.2 seconds**, with no browser JavaScript errors. This is a module-load measurement, not a guaranteed whole-app startup time.
- No new dependencies were added for this fix. The Browserslist warning was not the startup blocker; no framework migration was performed.

## 5. Manager login password fix

Changing `SETUP_ADMIN_PASSWORD` in `.env` did not change the already-created `manager` password in PostgreSQL.

- At the user's request, updated only `manager`'s password hash in `app.Users` to match the current configured `SETUP_ADMIN_PASSWORD`.
- Used bcrypt with cost 12 and a transaction; verified the database was `localerp` and the account was active.
- Kept password values, hashes and authentication tokens out of this documentation.
- Verified manager login, assigned companies and Cloud_Erp selection through the frontend proxy: **HTTP 200**.
- No automatic password synchronization was added. Future `.env` edits still do not update existing users' passwords.

## 6. Duplicate Sales Order and Delivery variants removed

Removed **DC, NC and SODA** Sales Order/Delivery implementations while retaining the standard Sales Order and Delivery pages. **122 dedicated files** were deleted.

### Deleted code and artifacts

- All six directories under `frontend/src/modules/`: `dc-sales-order`, `nc-sales-order`, `soda-sales-order`, `dc-delivery`, `nc-delivery`, `soda-delivery`, including their dedicated forms, components and CSS.
- Their twelve page/list wrappers under `frontend/src/pages/`.
- Their six API clients under `frontend/src/api/` and six form configurations under `frontend/src/config/`.
- Their eighteen backend files: six controllers, six routes and six service wrappers for `dcSalesOrder`, `ncSalesOrder`, `sodaSalesOrder`, `dcDelivery`, `ncDelivery`, `sodaDelivery`.
- Obsolete `docs/nc-live-delivery-layout.sql`.

### Shared code updated

| File | Change |
| --- | --- |
| `frontend/src/App.js` | Removed variant imports and page/list routes |
| `frontend/src/components/Sidebar.js` | Removed variant sidebar ordering entries |
| `frontend/src/api/copyFromApi.js` | Removed variant copy API exports |
| `frontend/src/services/documentCopyService.js` | Removed variant copy targets, labels and object mappings |
| `frontend/src/components/relationship-map/RelationshipMapHost.jsx` | Routed Sales Order/Delivery nodes to standard pages |
| `frontend/src/hooks/useDocumentSeries.js` | Removed variant numbering-setting mappings |
| `frontend/src/utils/generalSettingsStorage.js` | Removed variant settings defaults |
| `frontend/src/modules/general-settings/GeneralSettings.jsx` | Removed variant warehouse/series selectors |
| `backend/server.js` | Removed variant route registrations/imports |
| `backend/services/generalSettingsService.js` | Removed variant settings keys |
| `backend/services/journalEntryService.js` | Removed variant document-type entries |
| `backend/services/applicationMenuSyncService.js` | Removed variant menu definitions and invoked legacy menu cleanup |
| `backend/services/standardSalesRoleRightsService.js` | Added retirement of existing variant menus after permission migration |
| `backend/test/standardSalesRoleRights.test.js` | Added cleanup/idempotency regression coverage |
| `backend/test/confirmationOnlyUpdate.test.js` | Removed tests for deleted wrappers |
| `backend/test/documentSeriesPageManifest.json` | Removed deleted page entries |
| `docs/series-review/pending-integration.json` and `.patch` | Removed obsolete variant integration entries |

### Database cleanup and checks

- Applied menu cleanup to the live application database and restarted the backend to unload removed routes.
- Kept legacy route names only in migration code and regression fixtures, so existing installations can clean up their stored menus.
- Migrated eligible legacy rights to standard pages; reassigned report links and child menus before removing obsolete menus/rights in the menu-sync transaction.
- Preserved company business records and report definitions.
- Verified all six retired backend endpoints return **HTTP 404**.
- Verified returned menu permissions retain standard `/sales-order` and `/delivery` paths without variant routes.
- Frontend copy/API/state tests: **18/18 passed** across three suites.
- Full serial backend suite: **414/415 passed**, with the same pre-existing HSN reference failure. Parallel runs also encountered an existing intermittent native HANA pipe error; the final serial run avoided it.
- Parsed all **787 remaining frontend JavaScript/JSX files** and found no missing local imports.
- Browser login and standard sales-order/delivery list loading passed without JavaScript errors; duplicate menu labels were absent.
- `git diff --check` passed after cleanup.

## 7. How to run and verify

From the project root, use separate PowerShell terminals:

```powershell
cd backend
npm.cmd start
```

```powershell
cd frontend
npm.cmd start
```

Open `http://localhost:3000`, log in as `manager` with the password last explicitly set from `backend/.env`, and select **Cloud_Erp**.

Backend verification commands:

```powershell
npm.cmd run test:app-postgres
npm.cmd run test:company-postgres
node --test --test-concurrency=1 test/*.test.js
```

Frontend configuration check:

```powershell
node --test scripts/dev-config.test.js
```

These commands are run from their respective backend/frontend directories. Use `npm.cmd` in this Windows environment to avoid the PowerShell execution-policy restriction affecting `npm.ps1`.

## 8. Remaining work and limits

- **Next: Phase 3**, the local Service Layer for master/document writes, beginning with Sales Quotation to Sales Order.
- **Phase 4** stock movements, valuation, accounting posting, balances and payment reconciliation remain unimplemented.
- Real GST/account determination, complete company administration, opening balances, removing SAP dependencies, printing/deployment work and tested backup/restore remain on the project plan.
- Core PostgreSQL reads and selected browser flows were checked; not every legacy/custom module or browser page was verified.
- Production frontend builds, remote-browser access, live WhatsApp sending and complete document creation/posting were not checked in these changes.
- Known existing backend failure: `salesOrderHsnReference` reports that the active company database could not be resolved.
- Work remains uncommitted; no PR, deployment or publication was performed.
- The root `package-lock.json` Browserslist update shown in the user's terminal was not a Codex-authored application change.

This documentation update adds the conversation-wide change record; it does not modify runtime behavior or rerun the application test suites.
