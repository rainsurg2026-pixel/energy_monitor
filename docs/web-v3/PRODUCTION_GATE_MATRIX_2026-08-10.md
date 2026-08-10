# Production Gate Matrix

Date: 2026-08-10  
Baseline: Energy Monitor Desktop v2.3.1  
Decision rule: a gate is PASS only when the Web result is verified against the
Desktop behavior and the evidence is reproducible. Source inspection or local
unit tests alone cannot close a live, visual, deployment or UAT gate.

## Current implementation update (2026-08-10)

The Desktop per-section save metadata gap is closed in code. Migration
`db/migrations/006_section_save_timestamps.sql` adds the four monthly-period
timestamps; the Web API accepts validated `changed_sections`, the in-memory and
Postgres repositories preserve/import timestamps, and the structured editor
passes one timestamp scope per save and confirms historical-month saves. The
automated evidence is `npm.cmd run test:web-section-save-parity` and
`npm.cmd run test:web-editor-parity` (PASS) plus `npm.cmd run lint` and
`npm.cmd run vercel-build` (PASS). This closes the local
implementation portion only; live migration application, authenticated UAT and
visual parity remain open, so the matrix status remains **BLOCKED — NOT
PRODUCTION READY**.

The source audit also closed the previously unrecorded local navigation/editing
gaps: Web now exposes `/history` with the Desktop Historical Charts/Explorer,
Rack Capacity editing with optimistic concurrency and history snapshots, Rack
Unit Capacity editing, the shared Desktop Rack Capacity executive surface
(alerts, KPI cards, health gauge, forecast, zone summary, timeline and history),
and validated Rack Unit image upload/storage. Web workbook import now also
retains the Desktop `2. UPS Group History` rows in the same transaction and
exposes them to the Historical Explorer. Evidence:
`npm.cmd run test:web-history-rack-edit`, `npm.cmd run lint` and
`npm.cmd run vercel-build` (PASS). Live migration/schema/RLS/grant/TLS
inspection now passes for the Preview database; server-side Storage API,
visual and UAT verification remain open.

## Current deployment evidence override (2026-08-10)

The latest probe supersedes older Preview rows below: Vercel account
`rainsurg2026-pixel`, linked project `dcm15/energy-monitor`, READY Preview
`dpl_Aumgawj2xSnzqNJ7iaFDZajC2ocZ` at
`https://energy-monitor-eyqtgq7id-dcm15.vercel.app`; root, `/dashboard`,
`/login`, and public health return 200, while readiness, session, and
dashboard API return 503 `SERVICE_UNAVAILABLE` because the redacted runtime
configuration audit is invalid. Production was not deployed; the current
Production alias returns 404 for the API paths.
The release remains **BLOCKED — NOT PRODUCTION READY**.

## Latest live Supabase gate update (2026-08-10)

The authorized Preview/test Supabase target is project
`dnnufamiwxapqibdhwyj` (`ACTIVE_HEALTHY`), while the Vercel
Production environment points to a different project. No Production data or
configuration was changed.

Migrations 001-007 are applied in order and recorded in both the connector
migration state and `public.schema_migrations`. Live verification found
40/40 expected public tables, all public tables with RLS enabled, 38 intended
runtime policies, the four intentional policy-less migration metadata tables,
the `energy_monitor_runtime` role as `NOLOGIN/NOBYPASSRLS`, expected
runtime table/sequence grants, and the two private Storage buckets
`workbooks` and `rack-unit-images`. The operator SQL connection
verified SSL/TLS 1.3. No required public views, functions, or triggers were
found. Security advisor output contains only intentional INFO notices. The
previous migration provenance blocker is closed: files `003`-`007` are now
tracked in commit `932395e` (`Add Preview schema migrations 003-007`).

Local runtime validation now requires hosted `DATABASE_URL` port `6543`,
normalizes escaped PEM CA newlines, rejects identical session/CSRF secrets,
and fails closed when the actual database login is not a non-bypass member of
`energy_monitor_runtime`.

This closes the live Preview database migration/schema/RLS/grant/TLS
inspection portion of the matrix. It does not close the Vercel runtime gate:
Preview still has invalid `DATABASE_URL`, invalid
`SUPABASE_DB_CA_CERT`, invalid `SESSION_SECRET` and
`CSRF_SECRET`, and no effective `SUPABASE_SERVICE_ROLE_KEY`.
Therefore Preview has not been redeployed and authenticated UAT has not
started.

## Evidence index

- Local code/test parity: `docs/web-v3/PARITY_AUDIT_2026-08-09.md`
- Local release audit: `docs/web-v3/FINAL_READINESS_AUDIT_2026-08-10.md`
- Current release evidence: `docs/web-v3/PRODUCTION_GATE_EVIDENCE_2026-08-10.md`
- Live verification procedure: `docs/web-v3/PRODUCTION_VERIFICATION_CHECKLIST.md`
- Preview contract: `docs/web-v3/PHASE7_1_VERCEL_PREVIEW.md`
- Preview runner: `docs/web-v3/PREVIEW_VERIFICATION.md`
- Rollback procedure: `docs/web-v3/ROLLBACK_PLAN.md`

## Gate results

| Gate | Status | Objective evidence | Root cause / required closure |
| --- | --- | --- | --- |
| Functional Parity | **PARTIAL** | Core entry/dashboard/historical logs/rack editors/report artifact/workbook integrity/round-trip/Google Sheets routes now exist and have local contract tests; Rack Capacity History and Rack Unit image projection are now retained and rendered locally. Live backup/recovery, populated visual UAT and deployment remain open. | Live verification and hosted recovery controls are still missing. |
| Visual/UI Parity | **BLOCKED** | Real Chrome renders the login boundary at `/login` at desktop/mobile sizes with no page exceptions, failed requests or horizontal overflow; the expected `/api/v1/auth/session` configuration 503 emits a browser resource-error console message. Data routes still fail readiness with HTTP 503 `reason=configuration`, and no authenticated populated Desktop/Web comparison exists. | Preview/UAT credentials, valid runtime configuration and a populated comparison session are required. Capture matched Desktop/Web screenshots at the required viewport matrix. |
| Business Logic Parity | **PASS (LOCAL)** | `npm run test:domain-parity`: 24 assertions, formula `desktop-v2.3.1`; shared domain functions are used by Web APIs. | Production gate still requires live populated-data verification. |
| Database Schema & Data Parity | **PARTIAL** | Core model plus `003_workbook_source_retention.sql`, `004_google_sheets_oauth.sql`, `005_rack_history_and_images.sql`, `006_section_save_timestamps.sql` and `007_ups_group_history.sql` are present; local history/image/UPS-history/retention/round-trip/integrity/section-save tests pass; live Preview catalog verification confirms 40/40 tables, all RLS, grants and migration state. | Reconcile populated row counts/hashes, storage objects and authenticated application behavior after valid Preview runtime configuration is supplied. |
| Dashboard Parity | **PASS (LOCAL)** | Dashboard snapshot/API and domain tests pass; `test:api` and dashboard regression evidence are recorded in the parity audit. | Authenticated populated Preview comparison remains required. |
| Reports Parity | **PARTIAL** | Web reuses the Desktop HTML renderer and has server-side PDF/PNG/ZIP artifact paths; `test:web-reporting` (18 assertions), `test:web-report-artifacts` (14 assertions) and `test:web-chromium-renderer` pass locally. Rack history/image hosted verification and populated visual comparison remain open. | Hosted renderer availability, Desktop screenshot comparison and live Storage projection are not verified. |
| Excel Import | **PASS (LOCAL RETENTION)** | `test:web-import`: 20 assertions including monthly/Rack import, source retention, validation, backup restore, rollback, idempotency and provenance hash; `test:rack-capacity-history`, `test:rack-unit-capacity-image-history` and `test:rack-capacity-image-migration` verify Desktop history/image extraction and migration behavior. | Run against live development Supabase, storage and approved Preview account. |
| Excel Export | **PARTIAL (LOCAL CORE + SOURCE)** | New styled XLSX export and retained-source workbook export both exist; `test:web-workbook-export` and source round-trip tests pass. | Final Desktop comparison, live storage and authenticated Excel reopen are not complete. |
| Workbook Round-trip | **PARTIAL (LOCAL OOXML)** | Source `.xlsm` is retained, patched through the Desktop-compatible writer and returned; `test:web-workbook-roundtrip` preserves VBA/pivot package members and backup restore is covered by `test:web-import`. | Live object storage, representative workbook set and Excel/UAT validation remain open. |
| Workbook Integrity | **PASS (LOCAL PACKAGE) / LIVE OPEN** | `/integrity/workbook` uses Desktop reader validation and reports VBA/pivot/chart/drawing/image evidence; `test:web-workbook-integrity` passes. | Run on approved live source workbooks and reconcile findings in authenticated UAT. |
| PDF Export | **PARTIAL (LOCAL ARTIFACT)** | Server-side Chromium renderer returns validated PDF bytes; `test:web-chromium-renderer` and `test:web-report-artifacts` pass. | Hosted Vercel Chromium availability and visual/content comparison with Desktop remain unverified. |
| PNG Export | **PARTIAL (LOCAL ARTIFACT)** | Server-side Chromium renderer returns validated PNG bytes and the Web route downloads them; real renderer test passes. | Hosted runtime and matched Desktop screenshot comparison remain unverified. |
| ZIP Export | **PARTIAL (LOCAL CONTRACT)** | Web ZIP contains the Desktop member contract and validity checks pass in `test:web-report-artifacts`. | Hosted artifact generation and populated Desktop package comparison remain unverified. |
| Google Sheets Sync | **PARTIAL (LOCAL CODE / EXTERNAL LIVE)** | Web now has server-side OAuth/PKCE state binding, encrypted refresh-token storage, sync/export/import routes and `/settings/google-sheets`; local fail-closed/security contract test passes. | Google Cloud OAuth credentials, consent account, test spreadsheet and live reconciliation are missing. |
| Backup & Recovery | **PARTIAL / INFRASTRUCTURE** | Web now exposes retained workbook backup history and transactional SHA-256-verified restore; application-level backup test passes. Supabase PITR/RPO/RTO and deployment rollback are not verified. | Configure/verify Supabase backup/PITR and storage retention, then execute isolated data restore and deployment rollback drills. |
| Authentication | **PASS (LOCAL) / LIVE OPEN** | Local Phase 3 auth/session tests pass; deployed Preview root and public health endpoint respond, but authenticated runner stops because runtime readiness is `503 SERVICE_UNAVAILABLE` and approved UAT credentials are unavailable. | Correct Preview runtime configuration, seed approved Preview accounts and execute login/logout/expiry/revocation checks over HTTPS. |
| Authorization / RBAC | **PASS (LOCAL) / LIVE OPEN** | Local authz tests pass (124 assertions); API authorization tests pass. | Verify admin/user matrices against the live seeded accounts and record 401/403 evidence. |
| Session Management | **PASS (LOCAL) / LIVE OPEN** | Local JWT, revocation, expiry, password-change and cookie/CSRF tests pass. | Execute live cookie, expiry, revocation, multi-tab and password-reset UAT. |
| Live Supabase (Schema, RLS, Functions, Storage, TLS) | **PARTIAL / VERCEL RUNTIME OPEN** | Operator SQL verification passes for the authorized Preview project: migrations 001-007, 40/40 tables, RLS, policies, grants, private buckets, no required public functions/views/triggers, and TLS 1.3. The deployed Vercel runtime still returns `503` because its database/TLS/secret configuration is invalid. | Supply valid Preview runtime variables, then verify the exact pooled application connection and server-only Storage API path. |
| Security Review | **LOCAL PASS / LIVE OPEN** | Local CSRF/CORS/cookie/RBAC/rate-limit/redaction tests pass; live configuration and deployment review are absent. | Review Vercel env scopes, TLS, headers, origin allowlists, secret rotation, rate limiting and data exposure in Preview/Production. |
| Performance Review | **OPEN** | Vercel build passes but warns about approximately 626 kB App, 651 kB CapacityAlerts and 940 kB ExcelJS chunks; no authenticated Web performance trace exists. | Run populated Preview Lighthouse/Web Vitals/API latency/DB pool checks and fix regressions before sign-off. |
| Cross-browser Verification | **BLOCKED** | Only local Chrome login-boundary inspection was possible; no authenticated data session or browser matrix was executed. | Provide Preview access and run Chrome/Edge/Firefox responsive checks at the checklist viewports. |
| Preview Deployment | **PARTIAL / BLOCKED CONFIGURATION** | Vercel authentication and project linkage are verified: account `rainsurg2026-pixel`, project `energy-monitor` (`prj_RcljXiIL1xH9EmY2FTC2lcmtEGlV`). Current Preview `dpl_Aumgawj2xSnzqNJ7iaFDZajC2ocZ` is READY at `https://energy-monitor-eyqtgq7id-dcm15.vercel.app`; root, `/dashboard`, `/login` and `/api/v1/health` return 200, but `/api/v1/health/ready`, `/api/v1/auth/session` and `/api/v1/dashboard?siteId=1` return 503. | Provide valid runtime configuration, then run the complete Preview checklist and authenticated UAT. |
| Production Deployment | **BLOCKED** | The current Production alias points to an older deployment whose API health/session paths return HTTP 404. This release has not been promoted, and Production application runtime variables are not verified. | Fix Preview runtime configuration, configure/verify Production variables, pass all Preview/live gates, then deploy the verified release commit and capture Production URL/id/logs. |
| Rollback Drill | **NOT RUN** | `ROLLBACK_PLAN.md` exists but explicitly has no automated rollback script and no live drill/RPO evidence. | Execute a reversible Preview/Production rollback drill, verify health/readiness/data integrity and record timestamps. |
| Authenticated UAT | **BLOCKED** | A Preview URL exists, but readiness fails before authentication and no approved Preview/UAT credentials or populated dataset are available. | Correct Preview runtime, provide approved credentials and execute the Desktop-v2.3.1 scenario matrix with screenshots and result logs. |
| No Critical Issues | **NOT SIGNED OFF** | No local test reported a Critical failure, but live/production evidence does not exist. | Complete all live, UAT, performance and deployment gates; triage every defect. |
| No High Severity Issues | **NOT SIGNED OFF** | Local controls pass, but High live-auth/UAT/deployment gates remain open. | Close or explicitly resolve each High finding with owner, remediation and retest evidence. |

## Explicit gate-by-gate audit matrix

The table below is the authoritative audit record. A local result is not a
Production PASS unless the verification method has been executed against the
same populated data and workflow as Desktop v2.3.1.

The Gate results table and the deployment evidence record are authoritative for
the current Vercel state. An older Preview wording retained in the historical
detailed-row audit is superseded by the current Preview result above and by
`PRODUCTION_GATE_EVIDENCE_2026-08-10.md`.

| Gate | Desktop capability | Current Web capability | Status | Root cause | Evidence | Required fix | External dependency (if any) | Verification method |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Functional Parity | Complete navigation, data entry, calculations, reports, exports, sync, backup and recovery workflows. | Core dashboard, entry, report artifacts, workbook retention/round-trip, integrity, history/image projection and Google Sheets server routes exist; live checks and UAT remain open. | **PARTIAL** | Hosted infrastructure and populated Desktop/Web verification are not available; PITR/RPO/RTO and live external sync remain unverified. | `docs/web-v3/PARITY_AUDIT_2026-08-09.md`; `npm run test:web-reporting`; `npm run test:web-report-artifacts`; `npm run test:web-workbook-roundtrip`; `npm run test:rack-unit-capacity-image-history`; `npm run test:web-google-sheets`. | Verify hosted backup/recovery, then execute live scenario matrix. | Vercel, Supabase/storage, Google OAuth and UAT access. | Desktop-v2.3.1 scenario matrix plus automated contract tests and populated UAT. |
| Visual/UI Parity | Desktop screens, report layouts, charts and export renderings are the baseline. | Current Preview login boundary was inspected in real Chrome at 1440x900 and 390x844 with no page exceptions, failed requests or horizontal overflow; `/api/v1/auth/session` configuration 503 emits a browser resource-error console message. Readiness remains blocked for data routes, and no authenticated populated comparison is available. | **BLOCKED** | No authorized populated Preview session and no matched viewport capture; readiness is externally blocked. | `PRODUCTION_GATE_EVIDENCE_2026-08-10.md` real-browser shell evidence and inspected screenshots; no authenticated evidence. | Correct Preview runtime configuration, then capture matched Desktop/Web screenshots and fix measurable differences. | Preview URL, UAT credentials, populated dataset and valid runtime configuration. | Chrome/Edge/Firefox at checklist viewports with screenshot diff review and clean network/console evidence. |
| Business Logic Parity | Desktop formulas, aggregations, validation and facility isolation from v2.3.1. | Shared domain functions and Web API calculations pass local parity tests. | **PASS (LOCAL)** | Live populated verification has not been run. | `npm run test:domain-parity` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â 24 assertions, `desktop-v2.3.1`. | Re-run against live seeded data and record results. | Supabase access and Preview account. | Formula fixtures plus Desktop/Web result reconciliation. |
| Database Schema & Data Parity | Workbook-backed entities, history, images and relationships are retained. | Core model plus workbook source, Google OAuth, Rack History/image metadata, per-section timestamps and UPS Group History migrations are implemented; local source/hash/history/image/UPS-history tests pass; live catalog/RLS/storage bucket verification passes, while populated row/hash and object reconciliation remains open. | **PARTIAL** | Preview runtime and populated UAT data are unavailable. | `db/migrations/003_workbook_source_retention.sql`; `db/migrations/004_google_sheets_oauth.sql`; `db/migrations/005_rack_history_and_images.sql`; `db/migrations/006_section_save_timestamps.sql`; `db/migrations/007_ups_group_history.sql`; `server/services/importService.ts`; `npm run test:web-import`; `npm run test:ups-group-history`; `npm run test:ups-group-history-migration`; `npm run test:rack-capacity-image-migration`. | Supply valid Preview runtime and populated test data, then reconcile source hashes, rows, history and images. | Preview runtime, Supabase Storage service key and approved dataset. | Migration/security inspection, row-count/hash reconciliation and restore test. |
| Dashboard Parity | Desktop dashboard metrics, filters, charts and facility isolation. | Local dashboard API/domain path is covered; populated visual comparison is open. | **PASS (LOCAL)** | Live visual/data verification is missing. | `npm run test:api`; dashboard evidence in parity audit. | Execute populated Desktop/Web comparison. | Preview URL, credentials and matching dataset. | API reconciliation plus screenshot and interaction checklist. |
| Reports Parity | Desktop report center renders all selected sections with history/images and export actions. | Web reuses the HTML renderer, offers PDF/PNG/ZIP/XLSX/source-workbook actions and validates local artifacts; history rows, image metadata and image embedding now have a local end-to-end path. | **PARTIAL** | Live repository history/images and populated Desktop/Web visual comparison are not available. | `server/services/reportService.ts`; `server/services/reportArtifactService.ts`; `npm run test:web-reporting`; `npm run test:web-chromium-renderer`; `npm run test:web-report-artifacts`; `npm run test:rack-unit-capacity-image-history`. | Validate hosted renderer/Storage and compare every selected section/artifact with Desktop. | Supabase Storage for live image verification; Vercel/Chromium runtime. | Compare rendered section content, binary validity, ZIP members and Desktop fixtures/screenshots. |
| Excel Import | Desktop reads the workbook including monthly logs, capacity sheets, history and image-related content. | Web imports monthly logs, Rack Capacity, Rack Unit Capacity, Rack Capacity History and legacy image-history content, retains the source object, validates transactionally and is idempotent by source hash. | **PASS (LOCAL RETENTION) / LIVE OPEN** | Full Desktop workbook coverage and live DB/storage verification are not complete. | `npm run test:web-import` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â 20 assertions; `npm run test:rack-capacity-history`; `npm run test:rack-unit-capacity-image-history`; `server/services/importService.ts`; `server/storage/objectStorage.ts`. | Run live migration/storage test and compare approved workbooks. | Supabase database/storage access. | Import fixture, source hash, row count, rollback, re-import, history row and image hash reconciliation. |
| Excel Export | Desktop writes styled `.xlsm`/OOXML workbook content, charts, pivots, images and history. | Web has a styled new `.xlsx` export plus retained-source `.xlsx`/`.xlsm` download path. | **PARTIAL (LOCAL + LIVE OPEN)** | New export is not arbitrary OOXML-preserving; source path needs live storage and authenticated Excel verification. | `src/reporting/reportWorkbook.ts`; `server/services/workbookRoundTripService.ts`; `npm run test:web-workbook-export`; `npm run test:web-workbook-roundtrip`. | Complete live source retention, source export and Desktop package comparison. | Supabase object storage and approved workbook/UAT. | OOXML package diff, reopen in Excel, formulas/styles/images/pivots validation. |
| Workbook Round-trip | Desktop read ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ edit ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ save retains workbook structure and content. | Web retains the uploaded source object and patches it with Desktop-compatible writers; VBA/pivot package members are preserved in the fixture test and backup restore returns the selected source version. | **PARTIAL (LOCAL OOXML)** | Live object storage, representative workbook set and Excel/UAT comparison are unavailable. | `server/services/workbookRoundTripService.ts`; `server/services/workbookBackupService.ts`; `db/migrations/003_workbook_source_retention.sql`; `npm run test:web-workbook-roundtrip`; `npm run test:web-import`. | Verify live object storage, all approved workbook variants and authenticated Excel reopen/reconciliation. | Supabase object storage and Excel/UAT environment. | Fixture import/export/reopen plus package-level preservation and Desktop output comparison. |
| Workbook Integrity | Desktop integrity checks cover duplicate keys, devices, format and workbook structure. | Web exposes `/integrity/workbook` using the Desktop reader and package evidence for VBA/pivots/charts/drawings/images; Postgres projection remains separate. | **PASS (LOCAL PACKAGE) / LIVE OPEN** | Live source workbook runs and populated UAT are unavailable. | `server/services/workbookIntegrityService.ts`; `npm run test:web-workbook-integrity`. | Run approved live workbooks and reconcile all findings against Desktop Integrity Center. | Approved source workbooks and Preview/UAT access. | Negative fixtures plus live upload, report comparison and screenshot evidence. |
| PDF Export | Native Electron `printToPDF`, A4 landscape, background printing, PDF header/page validation. | Server-side Puppeteer/Chromium renders the same report HTML to A4 landscape PDF and validates header/page bytes. | **PARTIAL (LOCAL ARTIFACT)** | Hosted Vercel Chromium bundle/runtime and matched populated visual comparison are not verified. | `server/services/reportArtifactService.ts`; `npm run test:web-chromium-renderer`; `npm run test:web-report-artifacts`; Desktop baseline `npm run test:all-report:pdf` (17 pages / 172,203 bytes). | Validate hosted runtime, output size/cold start and compare PDF content/layout with Desktop. | Vercel deployment and hosted Chromium support. | Automated header/page/content checks plus Desktop PDF visual comparison. |
| PNG Export | Native `webContents.capturePage().toPNG()` of the report/dashboard. | Server-side Chromium captures the report page to PNG and downloads it through the authenticated API. | **PARTIAL (LOCAL ARTIFACT)** | Hosted runtime and matched Desktop screenshot comparison are not verified. | `server/services/reportArtifactService.ts`; `npm run test:web-chromium-renderer`. | Validate hosted capture, dimensions/content and compare against Desktop capture. | Vercel deployment and hosted Chromium support. | PNG signature/dimensions/content checks and screenshot comparison. |
| ZIP Export | Desktop ZIP contains PDF, XLSX, Dashboard.png, section CSVs, optional integrity text and README manifest. | Web packages valid PDF/PNG, styled workbook, section CSVs, integrity report and README using the same member names. | **PARTIAL (LOCAL CONTRACT)** | Hosted artifact generation and populated Desktop package comparison are not verified. | `server/services/reportArtifactService.ts`; `npm run test:web-report-artifacts`. | Verify hosted package, member hashes/validity and Desktop fixture parity. | Vercel deployment and populated data. | Open ZIP and assert every member, file validity, manifest and Desktop comparison. |
| Google Sheets Sync | Desktop OAuth sign-in/out, month sync, export-all and import-all through Google Sheets IPC/service. | Web server implements OAuth/PKCE, session-bound state, encrypted refresh tokens, connection status, active-month sync, export-all and import-and-persist UI/routes by reusing `src/sheetsService.ts`. | **PARTIAL (LOCAL CODE / EXTERNAL LIVE)** | No Google Cloud OAuth client, consent account or test spreadsheet is available for real API reconciliation. | `server/services/googleSheetsService.ts`; `db/migrations/004_google_sheets_oauth.sql`; `/settings/google-sheets`; `npm run test:web-google-sheets`. | Configure/test OAuth and execute duplicate guard, targeted patch, read-back verification and import reconciliation against Desktop. | Google Cloud OAuth client, redirect URI, consent/account and test spreadsheet. | OAuth flow plus sync/export/import reconciliation and evidence from Google Sheets API. |
| Backup & Recovery | Desktop filesystem backup/recovery IPC with recoverable workbook state. | Web exposes immutable retained source versions, backup list and admin restore through the validated import transaction; DB/PITR recovery remains infrastructure-level. | **PARTIAL / INFRASTRUCTURE** | Supabase backup/PITR policy, storage retention and measured RPO/RTO have not been verified. | `server/services/workbookBackupService.ts`; `/settings/backups`; `npm run test:web-import` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â backup restore assertions; `docs/web-v3/ROLLBACK_PLAN.md`. | Configure/verify Supabase PITR/storage retention and execute isolated DB + object restore and deployment rollback drill. | Supabase/Vercel backup permissions and approval. | Restore into isolated target, reconcile source hashes/rows, record RPO/RTO and verify application rollback. |
| Authentication | Desktop local authentication boundary; Web has username/password auth service. | Local auth/session tests pass; live HTTPS account flow is not verified. | **PASS (LOCAL) / LIVE OPEN** | No live deployment credentials/evidence. | `npm run test:phase3`; `server/auth/*`. | Run live login/logout/expiry/revocation/password checks. | Preview/Production URL and seeded accounts. | Authenticated HTTP/browser checklist over HTTPS. |
| Authorization / RBAC | Desktop role/permission behavior is required for operational actions. | Local RBAC and API authorization tests pass. | **PASS (LOCAL) / LIVE OPEN** | Live role matrix not exercised. | `server/authz/*`; `npm run test:phase3` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â 124 assertions. | Verify admin/user/denied actions in live environment. | Seeded accounts and live DB. | 200/401/403 matrix with audit evidence. |
| Session Management | Desktop session behavior; Web implements JWT/cookie/CSRF/revocation controls. | Local tests pass; browser cookie/expiry/revocation UAT is not complete. | **PASS (LOCAL) / LIVE OPEN** | No authenticated deployed browser session. | `server/auth/sessionJwt.ts`; `server/http/security/*`; phase 3 tests. | Run live expiry, revocation, multi-tab and password-reset checks. | Preview/Production deployment and accounts. | Browser/network trace and server log correlation. |
| Live Supabase (Schema, RLS, Functions, Storage, TLS) | Desktop-equivalent data and image persistence with secure operational access. | Operator connection verifies the authorized Preview schema, RLS, grants, private buckets and TLS; exact Vercel application path remains unverified because Preview configuration is invalid. | **PARTIAL / RUNTIME OPEN** | `DATABASE_URL`, `SUPABASE_DB_CA_CERT`, session/CSRF secrets and the effective Storage service key are invalid or missing. | Supabase migration ledger, catalog SQL, security/performance advisor output and TLS probe; Preview readiness still returns HTTP 503 `reason=configuration`. | Supply valid Preview variables, redeploy, then run pooled DB, Storage API and authenticated application checks. | Vercel/Supabase owner must supply server-only runtime values. | SQL migration log, advisor output, RLS negative tests, Storage/TLS checks and authenticated Preview API evidence. |
| Security Review | Desktop/Web operational data must be protected; Web local controls include CSRF/CORS/cookies/RBAC/rate limit/redaction. | Local security tests and dependency audit pass; hosted env/header/secret review remains open. | **LOCAL PASS / LIVE OPEN** | Preview runtime is reachable but database/TLS configuration is invalid; live Supabase and Production configuration remain unverified. | `npm run test:phase3`; `npm audit --audit-level=high` (0 vulnerabilities); `server/http/security/*`; current Preview request logs. | Review deployment env scopes, TLS, headers, origin allowlist, secrets and exposure. | Vercel/Supabase access. | Security checklist, headers scan, negative auth tests and log review. |
| Performance Review | Desktop report/dashboard behavior must remain operational at expected data volumes. | Build passes but large App/CapacityAlerts/ExcelJS chunks; no populated Preview trace. | **OPEN** | No authenticated production-like load/trace. | `npm run vercel-build` warnings: ~626 kB App, ~651 kB CapacityAlerts and ~940 kB ExcelJS chunks. | Measure and remediate Web Vitals/API/DB latency and bundle impact. | Preview URL and populated data/load access. | Lighthouse/Web Vitals, API timings, DB pool/EXPLAIN and stress run. |
| Cross-browser Verification | Desktop is single UI baseline; Web must behave consistently in supported browsers. | Only local Chrome login boundary inspected. | **BLOCKED** | No authenticated deployed session. | Browser DOM/screenshot evidence only for login boundary. | Run populated Chrome/Edge/Firefox viewport matrix. | Preview URL and UAT credentials. | Screenshot/interaction checklist and console/network logs. |
| Preview Deployment | A deployable Web build must be reachable and verifiable before Production. | Vercel authentication/linkage is available and a READY Preview exists; root, `/dashboard`, `/login` and public health pass, but readiness and dashboard API return HTTP 503 `reason=configuration`, so the release is not verifiable. | **PARTIAL (DEPLOYED / READINESS FAIL)** | Preview application runtime configuration is not usable, and authenticated UAT credentials are unavailable. | `vercel whoami: rainsurg2026-pixel`; current deployment `dpl_4bBMXFV1JuJ44nex138UjQkqGLZg`; `https://energy-monitor-brdjulzp4-dcm15.vercel.app`; root/`/dashboard`/`/login`/health HTTP 200; readiness/dashboard API HTTP 503; `test:preview-http` stops at `DEV_ADMIN_PASSWORD` requirement. | Correct Preview runtime variables, rerun readiness, then execute the full Preview checklist and UAT. | Vercel/Supabase project owner and approved UAT account provider. | Deployment logs, HTTPS health/readiness checks, authenticated browser/API checklist and evidence bundle. |
| Production Deployment | Verified release is deployed to the linked Production project. | Current Production alias is an older deployment; this release has not been promoted. | **BLOCKED** | Production runtime variables are not verified and Preview readiness has not passed. | `vercel ls --prod` ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢ `https://energy-monitor-1cgkwuc7o-dcm15.vercel.app`; current Production API health/session paths return HTTP 404; Production env listing lacks verified app variables such as `DATABASE_URL`, `SESSION_SECRET`, `CSRF_SECRET` and `SUPABASE_DB_CA_CERT`. | Configure and verify Production runtime variables, pass Preview gates, deploy this release and run smoke/authenticated verification. | Vercel project owner must configure/approve Production; Supabase owner must provide runtime database/storage/TLS values. | Deployment ID/log, HTTPS health/readiness, authenticated UAT, security/performance checklist and rollback drill. |
| Rollback Drill | Desktop recovery must be operational; Web release must have reversible deployment/data recovery. | Rollback document exists; no live drill or data restore evidence. | **NOT RUN** | No deployed target and no approved restore target. | `docs/web-v3/ROLLBACK_PLAN.md`; no drill log. | Execute reversible Preview/Production rollback and data restore drill. | Vercel deployment permission and Supabase backup/restore access. | Timestamped rollback, health, data-integrity and RPO/RTO evidence. |
| Authenticated UAT | Desktop-v2.3.1 scenarios completed by an authenticated operator using populated data. | Preview URL exists, but readiness fails before authentication; no approved UAT credentials or populated dataset is available. | **BLOCKED** | Hosted runtime configuration and test-account/data provisioning are external dependencies. | Preview readiness HTTP 503 `reason=configuration`; `test:preview-http` reports `DEV_ADMIN_PASSWORD` required; no authenticated UAT log. | Correct Preview runtime, provide populated test data and approved credentials, then execute the full scenario matrix with evidence and defect retests. | Vercel/Supabase project owner and UAT account/data provider. | Signed UAT checklist with screenshots, exports, reconciliation and browser/network logs. |
| No Critical Issues | Release has no unresolved Critical defects after all gates. | Cannot be signed off while required gates are open. | **NOT SIGNED OFF** | Live/UAT/deployment evidence absent. | Gate statuses above. | Complete gates and triage all findings. | Same external dependencies as open gates. | Release Manager defect register and final test report. |
| No High Severity Issues | Release has no unresolved High defects after all gates. | Cannot be signed off while live security/UAT/deployment gates are open. | **NOT SIGNED OFF** | High-severity risk cannot be excluded from local tests. | Gate statuses above and live security gaps. | Remediate or formally resolve every High finding and retest. | Same external dependencies as open gates. | Security/UAT/performance reports and Release Manager sign-off. |

## Current external blockers

Current deployment evidence:
Vercel authentication, project linkage and Preview artifact deployment are complete. The READY Preview deployment is `dpl_Aumgawj2xSnzqNJ7iaFDZajC2ocZ` at `https://energy-monitor-eyqtgq7id-dcm15.vercel.app`; root, `/dashboard`, `/login` and `/api/v1/health` return 200, while `/api/v1/health/ready`, `/api/v1/auth/session` and `/api/v1/dashboard?siteId=1` return 503 because the redacted Preview configuration audit is invalid.
The following dependencies prevent the remaining live gates from being verified:

1. Valid branch-scoped Vercel Preview/Production runtime configuration:
   real `DATABASE_URL`/`DIRECT_DATABASE_URL`, a valid PEM
   `SUPABASE_DB_CA_CERT`, sufficiently strong `SESSION_SECRET` and
   `CSRF_SECRET`, and the required Supabase URL/service-role/storage values.
2. Approved Preview admin/UAT credentials and a populated dataset for the
   authenticated Desktop/Web comparison.
3. The exact hosted application path still needs live verification: the valid
   pooled `DATABASE_URL` and `SUPABASE_DB_CA_CERT` must initialize
   the Vercel pool, and `SUPABASE_SERVICE_ROLE_KEY` must allow the
   server-only Storage adapter to exercise the two private buckets. Catalog
   migration/RLS/grant/TLS inspection is complete.
4. Google OAuth client configuration, consent/account and test spreadsheet for
   the Desktop-required synchronization workflow.
5. Infrastructure approval for backup/PITR and rollback-drill execution.
6. Production-only infrastructure approval for backup/PITR and the
   rollback-drill execution remains external; migration reproducibility is
   already closed by commit `932395e`.

These blockers do not make the known Web implementation gaps PASS. Vercel
authentication and Preview project linkage are no longer blockers, but the
unverified runtime configuration prevents live verification. The project must
resume with configuration correction and live verification; production approval
is prohibited until every row above is PASS.
