# Production Gate Evidence

Date: 2026-08-10  
Desktop baseline: Energy Monitor v2.3.1  
Decision: **NOT Production Ready**

## Current probe override (2026-08-10, latest objective run)

This section supersedes older deployment identifiers retained in historical
rows below. `vercel.cmd whoami` returned `rainsurg2026-pixel`; linked project
is `dcm15/energy-monitor` (`prj_RcljXiIL1xH9EmY2FTC2lcmtEGlV`). Latest READY
Preview is `dpl_Aumgawj2xSnzqNJ7iaFDZajC2ocZ` at
`https://energy-monitor-eyqtgq7id-dcm15.vercel.app`. Preview root,
`/dashboard`, `/login`, and `/api/v1/health` return HTTP 200;
`/api/v1/health/ready`, `/api/v1/auth/session`, and
`/api/v1/dashboard?siteId=1` return HTTP 503. The redacted Preview env audit
still reports invalid database/TLS/session configuration and an empty
effective service-role value. The current worktree remote build completed;
the runtime configuration remains the blocker.
Two Git-triggered Preview deployments from `main` failed before runtime
because that baseline commit does not contain the `vercel-build` script;
this was diagnosed from their build logs and is separate from the current
local-source Preview artifact.
Production remains the older alias with application API paths returning HTTP
404. No Production deployment was attempted.

This ledger records evidence collected during the release audit. A local test
proves the local implementation only; hosted, live-data, visual, security and
UAT gates remain open until their stated verification method is executed.

## Latest live Supabase verification (2026-08-10)

The explicitly authorized target was verified before and after applying the
database changes: Supabase project `dnnufamiwxapqibdhwyj`,
`supabase-cerise-kettle`, organization
`vercel_icfg_LS0wec22LdImWVF7t594p5E9`, region
`ap-southeast-2`, status `ACTIVE_HEALTHY`. Vercel Preview points to
this project; the Production environment points to a different project.
No Production database or configuration was modified.

Repository-approved migrations 001-007 were applied in order. Connector
migration state is:

- `energy_monitor_001_phase2_foundation`
- `energy_monitor_002_phase3_auth_security`
- `energy_monitor_003_workbook_source_retention`
- `energy_monitor_004_google_sheets_oauth`
- `energy_monitor_005_rack_history_and_images`
- `energy_monitor_006_section_save_timestamps`
- `energy_monitor_007_ups_group_history`

File provenance is recorded precisely: all seven migration files are tracked
under `db/migrations`. Files `003`-`007` were committed in
`932395e` (`Add Preview schema migrations 003-007`) after the authorized
Preview/test preflight content/hash checks passed. No repository history was
rewritten and no push or Production deployment was made.

The application `public.schema_migrations` ledger contains the matching
seven versions. Live schema/security checks returned 40/40 expected public
tables, zero missing tables, zero public tables with RLS disabled, all four
migration-006 `last_saved_*` columns, and zero migration-error rows.
The four policy-less metadata tables
(`schema_migrations`, `legacy_cached_evidence`,
`migration_batches`, `migration_errors`) match migration 002's
intentional exemption. All other expected tables have runtime policies.

The live runtime group is `NOLOGIN` and `NOBYPASSRLS`, with 134
table privilege entries across 36 tables and 27 sequence usage grants. A
focused security contract query confirms all 36 runtime tables are selectable,
runtime has no `TRUNCATE`, `REFERENCES`, or `TRIGGER`
privileges, and browser roles have zero public table grant entries. Public
schema/table grants for `anon`, `authenticated`, and
`service_role` are absent. The observed membership is
`postgres -> energy_monitor_runtime`; `postgres` itself has
`BYPASSRLS`. This membership was not broadened by the agent. The hosted
application now verifies at startup that its actual login identity is a
member of `energy_monitor_runtime` and is `NOBYPASSRLS`; the observed
operator `postgres` identity therefore fails the hosted runtime guard and
must not be used by Vercel. The `postgres`-owned default table/sequence privileges are
owner-only. Supabase-managed `supabase_admin` defaults and standard
function `EXECUTE` defaults were not altered because the operator does
not own that system role and the application defines no public functions.

The two required Storage buckets exist and are private:
`workbooks` and `rack-unit-images`. `storage.objects` has RLS
enabled and zero browser policies. The server-side Storage API test is still
blocked by the empty effective `SUPABASE_SERVICE_ROLE_KEY`; no object
data was created. Live public function/view/trigger enumeration returned
none, which matches the repository migrations.

The operator SQL connection reported PostgreSQL 17.6, SSL enabled, TLS 1.3,
and `TLS_AES_256_GCM_SHA384`. This proves live connector TLS; it does
not yet prove the Vercel runtime pooler path because `DATABASE_URL` and
`SUPABASE_DB_CA_CERT` remain invalid in Preview. Supabase security
advisor output contains only the four intentional policy-less-table INFO
notices. Performance advisor INFO notices include 26 unindexed foreign keys
and unused indexes on the empty database; these are workload-review items,
not security failures or a reason to add blind indexes.

## Local implementation evidence

Latest configuration-hardening verification passed locally: `test:phase3`
reported 31 focused tests plus 54 API assertions; `lint` and
`vercel-build` also passed. The covered contracts include hosted Transaction
Pooler port `6543`, PEM CA newline normalization, distinct 32-character
session/CSRF secrets, and fail-closed rejection of a bypass-RLS runtime
identity. These results are local evidence only; the current Preview artifact
is READY but its runtime configuration still fails closed.

The latest broader local gate run also passed all 20 selected suites covering
the Vercel adapter, migration tooling, image Storage, Google Sheets security,
workbook import/retention/restore, reports and artifacts, workbook
round-trip/integrity, section-save/editor/history/rack parity, and UPS Group
History/image migration behavior. No live database or Production data was
written by these tests.

The following checks passed against the working tree:

The final release sweep ran 25 parity/release suites in one clean run; all 25
passed. The individual evidence below is retained for the gate-specific
mapping.

- `npm.cmd run lint`
- `npm.cmd run vercel-build`
- `npm.cmd audit --audit-level=high` — 0 vulnerabilities after pinning
  ExcelJS's transitive UUID dependency to fixed `uuid@11.1.1`.
- `npm.cmd run test:domain-parity` â€” 24 assertions, Desktop formula version
  `desktop-v2.3.1`
- `npm.cmd run test:phase3` â€” authentication/security and 54 API assertions;
  authorization suite â€” 124 assertions
- `npm.cmd run test:phase35` â€” 46 assertions
- `npm.cmd run test:phase6` â€” 20 assertions
- `npm.cmd run test:migration-tooling` â€” 11 assertions
- `npm.cmd run test:vercel-adapter`
- `npm.cmd run test:web-reporting` â€” 18 assertions, including Desktop section
  selection, reporting period, 12-row history window and verified Rack Unit
  image embedding
- `npm.cmd run test:web-report-artifacts` â€” 14 assertions for PDF/PNG/ZIP
  signatures and the Desktop ZIP member contract
- `npm.cmd run test:web-chromium-renderer` â€” real local Chromium generated a
  30,755-byte PDF and a 14,601-byte PNG
- `npm.cmd run test:web-import` â€” 20 assertions covering monthly/Rack/history/
  image-source import, transaction rollback, backup restore, source-hash
  idempotency and provenance
- `npm.cmd run test:web-integrity` â€” 5 assertions
- `npm.cmd run test:web-workbook-export` â€” 7 assertions
- `npm.cmd run test:web-workbook-roundtrip` â€” source workbook size changed from
  119,901 to 119,899 bytes while VBA and pivot package members were preserved
- `npm.cmd run test:web-workbook-integrity` â€” VBA, pivot, chart, drawing and
  Desktop-reader validation evidence
- `npm.cmd run test:web-google-sheets` â€” OAuth/PKCE state binding, encrypted
  verifier storage and fail-closed configuration/auth boundary
- `npm.cmd run test:rack-capacity-history`
- `npm.cmd run test:all-report:pdf` — Desktop native PDF smoke baseline passed:
  17 pages, 172,203 bytes
- `npm.cmd run test:web-section-save-parity` — per-section Desktop save
  timestamps, imported timestamp preservation, API section validation and
  optimistic versioning
- `npm.cmd run test:web-editor-parity` — validation dialog, missing-field
  highlight/focus, historical confirmation and canceled-save UI contracts
- `npm.cmd run test:web-history-rack-edit` — Historical Logs route data, Rack
  Capacity optimistic save/history snapshot, Rack Unit save and validated image
  storage contract, and persisted UPS Group History projection
- `npm.cmd run test:ups-group-history` — 26 persistence checks covering legacy
  backfill, metadata, idempotency, byte-preservation, incremental updates and
  Dashboard-FAC reconciliation
- `npm.cmd run test:ups-group-history-migration` — 11 migration-on-open checks
  using preserved v2.2.0 legacy fixtures; first-open migration and second-open
  byte-identical no-op both pass
- `npm.cmd run desktop:build`
- `npm.cmd run test:rack-unit-capacity-image-history`
- `npm.cmd run test:rack-capacity-image-migration`
- `git diff --check`

### Latest priority-gap rerun after the dependency fix

After pinning ExcelJS's transitive `uuid` dependency to the CommonJS-compatible
fixed release `11.1.1`, the following priority-gap tests were rerun and passed:

- `test:web-reporting`, `test:web-report-artifacts`, `test:web-chromium-renderer`
- `test:web-import`, `test:web-integrity`, `test:web-workbook-export`,
  `test:web-workbook-roundtrip`, `test:web-workbook-integrity`
- `test:web-google-sheets`, `test:rack-capacity-history`,
  `test:rack-unit-capacity-image-history`, `test:rack-capacity-image-migration`
- `test:ups-group-history`, `test:ups-group-history-migration`
- `test:save-formatting`, `test:web-editor-parity`, `test:web-section-save-parity`

The rerun also included the shared Desktop Rack Capacity surface/UPS Group
History parity checks (`test:web-editor-parity`: 9 structural checks and
`test:web-history-rack-edit`: PASS). It produced the same validated PDF/PNG, workbook preservation, source
hash/backup-restore, Google Sheets security-contract, image-history and
per-section-save results. `npm.cmd audit --audit-level=high` reports 0
vulnerabilities and `npm.cmd ls uuid --all` reports `exceljs -> uuid@11.1.1
overridden`.

These results support the local implementation portions of the matrix. They do
not prove live Supabase, Google API, hosted Chromium, visual, UAT, rollback or
Production gates.

## Real-browser shell evidence

Puppeteer/Chrome sweep against the current Preview `/login` route:

- Desktop 1440x900: HTTP 200, `h1=เข้าสู่ระบบ`, `scrollWidth=clientWidth=1440`,
  no page exceptions, failed requests or horizontal overflow were observed; the
  expected configuration failure from `/api/v1/auth/session` emitted one browser
  resource-error console message.
- Mobile 390x844: HTTP 304, `h1=เข้าสู่ระบบ`, `scrollWidth=clientWidth=390`,
  no page exceptions, failed requests or horizontal overflow were observed; the
  same `/api/v1/auth/session` 503 emitted one browser resource-error console
  message.
- Screenshots were captured and inspected at
  `%TEMP%/energy-monitor-visual-preview-20260810-latest/desktop.png` and
  `%TEMP%/energy-monitor-visual-preview-20260810-latest/mobile.png`.

This is login-boundary shell evidence only. It is not authenticated populated
Desktop/Web visual UAT and does not close Visual/UI Parity or Cross-browser
Verification.

## Vercel evidence

- `vercel.cmd whoami` succeeded as `rainsurg2026-pixel`.
- Linked project: `energy-monitor`, project ID
  `prj_RcljXiIL1xH9EmY2FTC2lcmtEGlV`, framework Vite, build
  `npm run vercel-build`, output `dist`.
- READY Preview deployment:
  `dpl_Aumgawj2xSnzqNJ7iaFDZajC2ocZ`
- Preview URL:
  `https://energy-monitor-eyqtgq7id-dcm15.vercel.app`
- Preview inspector:
  `https://vercel.com/dcm15/energy-monitor/Aumgawj2xSnzqNJ7iaFDZajC2ocZ`
- Preview root, `/dashboard` and `/login`: HTTP 200,
  `text/html; charset=utf-8`.
- Preview `GET /api/v1/health`: HTTP 200 with
  `{"ok":true,"data":{"status":"ok","service":"energy-monitor-api"}}`.
- Preview `GET /api/v1/health/ready`: HTTP 503 with
  `SERVICE_UNAVAILABLE`; redacted environment validation identifies the
  configuration blocker.
- Preview `GET /api/v1/dashboard?siteId=1`: HTTP 503 with the same configuration
  failure.
- Preview `GET /api/v1/auth/session`: HTTP 503 with
  `SERVICE_UNAVAILABLE` for the same runtime configuration failure.
- Preview remote build: READY; `npm run vercel-build` completed successfully.
- Current Preview request logs for health/readiness/dashboard contain no
  invocation errors. An earlier candidate using `uuid@14.0.1` was rejected:
  Vercel logged `ERR_REQUIRE_ESM` from ExcelJS; `uuid@11.1.1` removed that
  regression and the current `/api/v1/health` probe is HTTP 200.
- `npm.cmd run test:preview-http` correctly refuses to run without
  `PREVIEW_URL`; with the Preview URL it then requires `DEV_ADMIN_PASSWORD`.

The Preview artifact is deployed, but it is not a passing Preview gate because
the runtime cannot reach readiness and authenticated verification cannot start.

## Sanitized Preview environment audit

`vercel env pull` for Preview branch `feat/web-v3` was inspected for
presence and non-secret format validity only; values were not printed or
retained. The current audit found:

| Variable | Result |
| --- | --- |
| `DATABASE_URL` | Present / **Invalid** |
| `DIRECT_DATABASE_URL` | Missing / optional for API runtime |
| `SUPABASE_DB_CA_CERT` | Present / **Invalid** |
| `SESSION_SECRET` | Present / **Invalid** |
| `CSRF_SECRET` | Present / **Invalid** |
| `SUPABASE_URL` | Present / Valid; matches the authorized Preview project |
| `SUPABASE_SERVICE_ROLE_KEY` | Missing effective value / **Invalid** |
| `SUPABASE_WORKBOOK_BUCKET` | Present / Valid |
| `SUPABASE_IMAGE_BUCKET` | Present / Valid |
| `GOOGLE_CLIENT_ID` | Missing / optional while Google Sheets is disabled |
| `GOOGLE_CLIENT_SECRET` | Missing / optional while Google Sheets is disabled |
| `GOOGLE_OAUTH_REDIRECT_URI` | Missing / optional while Google Sheets is disabled |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Missing / optional while Google Sheets is disabled |
| `GOOGLE_OAUTH_SUCCESS_REDIRECT` | Missing / optional while Google Sheets is disabled |

The temporary secret-bearing audit file was deleted after inspection.

The complete current variable-by-variable contract, owner action list, and
Supabase verification sequence are recorded in
`docs/web-v3/ENVIRONMENT_CONFIGURATION_CHECKLIST.md`. The validator/runtime
hardening now also rejects malformed PostgreSQL URLs, non-HTTPS hosted
origins/Google redirects, and incomplete hosted Storage configuration before
pool creation. Local lint, build, phase-3, and Vercel-adapter checks pass after
that change.

A live Supabase operator connection now succeeds. PostgreSQL 17.6 reports SSL
enabled, TLS 1.3, and `TLS_AES_256_GCM_SHA384`. This verifies live
operator connectivity/TLS; the Vercel runtime path remains unverified until
the owner supplies valid `DATABASE_URL` and
`SUPABASE_DB_CA_CERT`.

## Latest redacted external-state update

- Preview non-secret configuration now has a valid `SUPABASE_URL`,
  `SUPABASE_WORKBOOK_BUCKET`, and `SUPABASE_IMAGE_BUCKET`.
- The connected Supabase project is `ACTIVE_HEALTHY`, and migrations
  001-007 are applied in order.
- The application's `public.schema_migrations` ledger contains all seven
  versions; 40/40 expected tables are present, all public tables have RLS,
  and zero migration-error rows exist.
- The required private `workbooks` and `rack-unit-images` buckets
  exist; Storage object RLS is enabled.
- Security advisor INFO notices are limited to the four intentional metadata
  tables without runtime policies. Performance INFO notices are recorded as
  workload-review items on the empty database.

The remaining hosted runtime secrets, Storage service key, authenticated UAT
account/data, Google live credentials (if that gate is in scope), and
backup/rollback permissions remain external blockers. Production deployment is
still prohibited.

## Production evidence

- `vercel.cmd ls energy-monitor --prod` identifies the existing Production
  deployment at `https://energy-monitor-1cgkwuc7o-dcm15.vercel.app`.
- The current Production `/api/v1/health`, `/api/v1/health/ready` and
  `/api/v1/auth/session` paths return HTTP 404, demonstrating that the current
  alias is not the verified release API.
- Production environment-name inspection does not show verified application
  runtime variables such as `DATABASE_URL`, `SESSION_SECRET`, `CSRF_SECRET` or
  `SUPABASE_DB_CA_CERT`.
- The release was not promoted to Production because Preview readiness and live
  Supabase/UAT gates are not passing.

## Open gates and exact external action

1. Preview/live Supabase: the Vercel/Supabase project owner must provide valid
   branch-scoped pooled database/TLS/storage runtime configuration, apply and
   inspect migrations 001-007, verify RLS/grants/functions/storage/TLS, and
   expose a populated test dataset.
2. Authentication, authorization, sessions, visual parity and cross-browser:
   the UAT account/data provider must provide approved credentials and execute
   the authenticated Desktop/Web scenario and browser matrix.
3. Google Sheets Sync: the Google Cloud owner must provide an OAuth client,
   consent/test account and test spreadsheet for live read-back reconciliation.
4. Backup and Recovery/Rollback: the infrastructure owner must provide PITR/
   storage-retention and Vercel rollback permissions, then record a reversible
   data and deployment drill with RPO/RTO.
5. Production: the Vercel project owner must configure and approve Production
   runtime variables, deploy only after Preview passes, and run the complete
   Production Verification Checklist and authenticated UAT.

Until these actions are completed, the project status is:

**Not Production Ready â€” Preview deployed, runtime configuration and live/UAT
verification blocked by external dependencies.**
