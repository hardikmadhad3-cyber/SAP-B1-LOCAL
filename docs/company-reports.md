# Live company reports

The **Reports → Company Reports** page lists Crystal report layouts for the selected SAP Business One company. It calls SAP Report Service `LoadAuthorizedCRList` on each load or refresh and uses `RDOC` to exclude inactive and document print layouts when direct company SQL is available. The page reuses the project's selection criteria modal and PDF viewer. Report definitions are not copied from the deployment package into SQLite.

The catalog and run endpoints require the current role's **Reports** view permission. They validate the requested report code against the selected company's catalog before loading parameters or exporting a PDF. The company database and Report Service session are resolved from the active company context.

Companies need SAP Report Service URL, username, password, and company DB settings in Admin Panel → Companies. For this workspace, `backend/scripts/configureSharedCompanyReportService.js --apply` fills missing settings for `NOCPL_LIVE` and `TEST_NOCPL_VENT` from the verified shared service account configured for `NCPL_110126`. The script checks both logins first and does not print credentials; without `--apply` it only checks them.

`TEST_NOCPL_VENT` currently rejects its direct SQL login. Its catalog can still load from SAP Report Service, and report runs use service validation when `RDOC` cannot be read. In this case the catalog response sets `statusVerified: false`; SAP Report Service is responsible for rejecting an unavailable layout.
