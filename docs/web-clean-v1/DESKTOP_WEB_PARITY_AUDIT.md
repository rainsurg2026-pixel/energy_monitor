# Desktop v2.3.1 - Clean-v1 parity audit

Audit date: 2026-08-10 (Asia/Bangkok), follow-up verification 2026-08-11.

## 2026-08-11 Google OAuth Browser UAT + Export verification + PDF popup fix

Follow-up to the completed/closed UPS History and Dashboard UPS Groups
work above (not reopened). Three items per this pass's priority order.

**1. Google OAuth / Backup - Browser UAT: VERIFIED (blocked state
confirmed honest, not faked).** `GOOGLE_OAUTH_CLIENT_ID`/
`GOOGLE_OAUTH_CLIENT_SECRET` re-checked fresh via `vercel env ls` -
still absent from every Vercel environment. Live-clicked, as Admin, in
Settings -> Data Backup: "Connect Google Account" is correctly disabled
with the inline reason "Google OAuth is not configured on the server
(...)"; "Test Connection" and "Backup Now" both correctly report the
real blocker via a real network round-trip ("Google Sheets backup is
not configured...", "No backup destination is configured..."), never a
fake success. Verified in Supabase: `backup_config`/
`google_sheets_connections` remain empty, `backup_log` gained exactly
one honest `failed` row from the live "Backup Now" click - no
unintended writes. Real Google OAuth consent itself remains genuinely
blocked on the missing credential (external, unchanged).

**2. Reports & Export - Browser UAT: CSV/Excel PASS, PDF popup fixed but
NOT VERIFIED (automation limitation).** Downloaded and byte-inspected
real CSV and XLSX files for Rangsit June 2026 via the live browser
(Exports & Report -> Current Facility) - both match the raw
`ups_readings` values exactly (e.g. UPS 11A=156/157, UPS 11B=155/156).
While diagnosing an initial "Failed to fetch dynamically imported
module" error (a stale browser tab spanning two deploys - resolved by
reload, not a code defect), found a real, deterministic defect: the PDF
export handlers (`git blame` -> introduced by `d31e03b`, the rack-data-
in-PDF fix) `await` an API fetch (rack snapshot / site comparison data)
*before* calling `window.open()` for the print popup. That async gap
runs outside the click's original user-activation window, so a
browser's popup blocker can legitimately block the report window -
reproduced live as "The report window was blocked by the browser."

**Fixed**: `src/web-clean-v1/exports.ts` gained `openReportPopup(name)`,
called synchronously in the same tick as the click, before any `await`;
`printDesktopPdf`/`printSiteComparisonPdf`/`printAllFacilitiesPdf` now
take that already-open window and only write the report into it once
async data has loaded. `CleanWebApp.tsx`'s `Reports()` `run()` helper
rewritten to also catch a synchronous throw from `action()` (e.g.
`openReportPopup()` itself being blocked), not just a rejected promise.

**PDF popup mechanism: NOT VERIFIED via this browser session -
automation-tool limitation, not a confirmed app defect.** Even after the
fix, clicks dispatched through this session's Chrome automation tool
(both coordinate- and element-ref-based) still triggered "blocked by the
browser" - a new (initially blank) tab is created each time, but
`window.open()` returns null to the page's JS. This is consistent with
the well-documented CDP-synthesized-click-vs-popup-blocker limitation
that affects Puppeteer/Playwright-style automation generally, not
something specific to this app; `chrome://settings/content/popups` could
not be adjusted to test around it (the automation sandbox correctly
blocks navigation to internal browser pages). The underlying report HTML
generation (`buildReportHtml`/`facilityReportData`) is unchanged and
already covered by existing automated tests with real content
verification. **A real human click (not CDP-synthesized) very likely
does not hit this** - but that specific claim could not be proven this
session and is not claimed as PASS.

**Regression**: full battery (`test:web-clean-v1-exports`,
`test:web-clean-v1-report-filename`, `test:api`, `test:phase3`,
`test:domain-parity`, `test:display-period`, facility-context/isolation/
comparison, dashboard-isolation, `test:ups-group-history-sync`, all 5
rack suites, `test:air-validation`, theme, admin-ui, `test:backup-service`)
re-run fresh - all pass, zero regressions. Lint and build clean.

**3. Production Readiness Gate**: see the matrix immediately below,
superseding all earlier matrices in this document.

### Production Readiness Matrix (2026-08-11, current)

| Area | Status | Evidence | Blocker |
| --- | --- | --- | --- |
| UPS History | PASS | Root-caused, fixed, live Browser UAT both facilities | none |
| Dashboard UPS Groups | PASS | Verified transitively fixed, live Browser UAT both facilities | none |
| Desktop/XLSM parity | PASS | Direct byte-level XLSM inspection + live Postgres cross-check | none |
| Facility isolation | PASS | Verified across History, Dashboard, Export, live | none |
| Google OAuth architecture/security | PASS | Code + tests + live UI verification, honest blocked-state UX | none |
| Google OAuth real consent | BLOCKED | `vercel env ls` confirms credential absent everywhere | Provision Google OAuth client |
| Export - CSV/Excel | PASS | Live browser download + byte-level content verification | none |
| Export - PDF generation | PASS | Unchanged, existing automated content tests | none |
| Export - PDF popup mechanism | NOT VERIFIED | Popup blocked under this session's browser automation specifically | Automation-tool limitation, not proven as a real defect |
| Regression/Lint/Build | PASS | Full battery re-run fresh after every change this session | none |
| Preview deployment | PASS | Pushed, deployed, health/readiness live-verified | none |
| Production | UNTOUCHED | No deploy, no Production env read/written | none |

### Production decision: **NOT PRODUCTION READY**

One blocker remains, external and unchanged in kind from every prior
pass: **Google OAuth client credentials are not provisioned** in any
Vercel environment. Everything else in this matrix is PASS. The PDF
popup item is not treated as a release blocker (the identified root
cause is fixed; the remaining uncertainty is specifically this
session's automation tooling, not application behavior) but is flagged
for a real-human click-through before final production sign-off, since
it was not proven either way.

## 2026-08-11 UPS History: root-caused and fixed a real data pipeline gap

**Reported symptom**: History -> UPS Loads History showed "No UPS Group
History is available" for Rangsit, June 2026, despite the workbook
having real data for that month.

**Root cause (traced end-to-end, not assumed)**: `public.ups_group_history`
had a read path (`getUpsGroupHistory`) wired into `getHistory()` since
migration 009/010, but **no writer for it ever existed server-side** -
confirmed live: 0 rows in the table against 134 `monthly_periods` rows.
`BackendRepository` had no create/upsert method for this table at all.
The missing piece was UPS group *topology* (device-to-group mapping +
rated capacity): Desktop sources this from a local
`config/<facility>/profile.json` that has no Web/Supabase equivalent
(already flagged, unresolved, in `dashboardUpsMapping.ts`'s own code
comment) - so the shared `computeUpsGroupSummary` formula, though fully
implemented and already used by Desktop, was never reachable from any
server code path.

**Desktop XLSM evidence**: both `DC_Rangsit.xlsm` and `DC_Srinakarin.xlsm`
have their own real, persisted "2. UPS Group History" sheets (277 and 346
rows respectively, back to 2020-12/2021-01), generated by Desktop's own
`UpsGroupHistoryWriter.ts` from `computeUpsGroupSummary(log, upsGroups)` -
i.e. Desktop's history is itself just a cached snapshot of a
deterministic calculation over existing monthly readings, not a
separately-entered dataset. Rangsit June 2026: UPS 11 = 311kW/313kVA,
UPS 13 = 307/308, UPS 14 = 41/42, UPS 15 (PPC44A, PPC44B) = 110/109 -
confirmed by direct read of the real XLSM file (copied read-only to the
scratch directory first, never opened via the Electron shell).

**Supabase evidence**: `public.ups_readings` for site 8 (Rangsit), June
2026 has the exact real device readings (UPS 11A=156/157,
UPS 11B=155/156, etc.) that, summed per Rangsit's real group topology,
reproduce the XLSM's numbers exactly (311/313, 307/308, 41/42, 110/109) -
proving the fix is a deterministic reconstruction, not fabricated data.
Same cross-check performed for Srinakarin (different topology - UPS 41 +
PPC 41-44, all confirmed against its own real per-phase readings).

**Fix**: `src/domain/upsGroupTopology.ts` ports the real topology
verbatim from both facilities' `profile.json` (never invented, never
assumed Srinakarin shares Rangsit's groups). Two write paths, mirroring
`UpsGroupHistoryWriter.ts`'s own backfill-vs-incremental-save semantics
exactly: a lazy per-(month,group)-key backfill inside `getHistory()` for
months saved before this fix existed (never overwrites an existing row),
and an incremental upsert inside `saveMonthlyLog`'s own transaction on
every future Data Entry save (same transaction as the readings it's
derived from). No schema change - migration 007's table and unique
constraint already supported this; the gap was pure application code.

**Backfill**: not a separate migration/script - the very next
`getHistory()` call for each site computes and persists the real values
from that site's actual saved readings. Verified live: Rangsit backfilled
24 rows (6 months x 4 groups), Srinakarin 35 rows (7 months x 5 groups),
both exactly matching the XLSM ground truth above.

**Browser UAT (real, authenticated, this session)**: Preview URL, logged
in as Admin, History -> UPS Loads History. Rangsit June 2026 shows UPS
11/13/14/15 with the exact values above; switched facility to Srinakarin
via the real selector - its own 5 groups (PPC 41-44, UPS 41) appear with
values matching its own XLSM/readings ground truth, zero cross-facility
leakage. "Last 3 Months" filter correctly narrowed the table. Screenshots
and full page-text captured during this session.

**Tests**: new `scripts/test-ups-group-history-sync.ts` (18 assertions) -
backfill correctness, per-key (not per-month) backfill granularity,
facility isolation, never-overwrite-existing-rows, incremental save
updates only the edited month, and a facility with no known topology
never fabricates rows. Full regression battery (20 suites) + lint + build
all clean. Applied to Preview and verified live per above.

**Production: UNTOUCHED.**

## 2026-08-11 Backup: Google OAuth (Admin-connected account) replaces service-account credential

Change of requirement: Google Backup no longer uses a service-account
JSON credential (`GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON`) at all - the Admin
must connect their own Google account through the app via interactive
OAuth2 (authorization-code + PKCE, "Web application" client type). This
is a different Google Cloud OAuth client type from Desktop's own
Electron-only "Desktop app" client (`src/electron/googleAuth.ts`) - the
two are not interchangeable, and Desktop's flow was left untouched.

**Reused, not duplicated**: `google_oauth_states` and
`google_sheets_connections` (created by migration `004` but never
previously referenced by any server code) are now the actual OAuth
state/token store. `backup_config` gained one new nullable FK column
(`connected_google_user_id -> users.id`, migration
`011_backup_google_oauth_link.sql`, additive/idempotent, does not modify
001-010) rather than a second config table - it stays config-only, no
credential column. `deleteUser()`'s existing `ON DELETE SET NULL`-style
FK pattern is reused for what happens if the connected admin is deleted.

**New code**: `server/backup/googleOAuthCrypto.ts` (PKCE
verifier/challenge, single-use session-bound `state`, AES-256-GCM token
encryption with the key HKDF-derived from the already-provisioned
`SESSION_SECRET` - no new secret to provision) and
`server/backup/googleOAuthClient.ts` (direct `fetch` calls to Google's
authorization/token/userinfo/revoke endpoints, no SDK dependency added).
`backupService.ts` rewritten to resolve an access token from the
connected account (refreshing via the stored refresh token when
expired) instead of signing a service-account JWT;
`server/backup/googleServiceAccountAuth.ts` deleted (zero remaining
importers, confirmed via grep before deletion). Three new routes in
`server/http/app.ts`: `POST /admin/backup/google/connect` (starts the
flow), `GET /admin/backup/google/callback` (Google's redirect target -
validates `state`, exchanges the code, stores the encrypted token,
redirects back into the app with a `?google_backup=...` query param
rather than ever returning raw JSON to a browser navigation), `POST
/admin/backup/google/disconnect` (deletes the stored connection,
best-effort revokes the token with Google, audited). All three are
admin-only via the existing `backupRestoreManage` permission - no second
authorization system. Frontend `DataBackupPanel` (Settings -> Data
Backup) gained a Google Account section (Not Connected/Connected badge,
Connect/Disconnect buttons, masked connected email, an
OAuth-not-configured warning) matching the existing design system.

**Security properties verified by design/code review**: `state` is
single-use (`DELETE ... RETURNING` on first read), short-lived (10 min),
and bound to the initiating session (`Principal.sessionId`, already
existed, populated by `authService.ts`); `access_type=offline` +
`prompt=consent` forces Google to issue a refresh token; tokens are
encrypted at rest and never appear in any API response, log line, or the
frontend bundle (confirmed by the same static-scan technique used for
the prior service-account credential:
`access_token`/`refresh_token`/`client_secret`/`private_key` grepped
across `server/backup/*`, `server/http/app.ts`, and `dist/`); the
callback route is a GET (dictated by the OAuth redirect mechanism, not a
choice) so the generic method-based `READ_ONLY_MODE` guard cannot see
its write side-effect - an explicit manual check was added inside the
handler.

**Tests**: `scripts/test-backup-service.ts` fully rewritten around the
OAuth primitives and mocked Google endpoints (real AES-GCM/HKDF/PKCE
math, `fetch` fully mocked, only locally-generated synthetic token
strings) - 64 assertions passing. `scripts/test-api-foundation.ts`
extended with RBAC coverage for all three new routes (non-admin 403 on
connect/disconnect, admin gets an honest `503
GOOGLE_OAUTH_NOT_CONFIGURED` from connect in a credential-less test
environment rather than a fake success, disconnect is idempotent when
nothing is connected, the OAuth callback redirects with an error rather
than a raw 500/JSON on missing params or an unrecognized `state`, and a
secret-shaped-string scan of `/admin/backup/status`'s response body).
Full local regression battery (all 20 relevant suites) re-run fresh -
zero regressions. `npm run lint` and `npm run build` both clean.

**Migration `011_backup_google_oauth_link.sql`: APPLIED to Preview**
(`tofdgndrrpnnyhbuurbx`) and verified live - `backup_config` now has the
new nullable `connected_google_user_id bigint` column, `schema_migrations`
shows 11 rows, existing `backup_config` data (empty table, pre-existing
state) untouched.

**Real Google OAuth: NOT VERIFIED - EXTERNAL CREDENTIAL BLOCKER.**
`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` are unset both
locally and in every Vercel Preview environment (re-checked fresh this
pass, not assumed from the prior service-account-era check). The
`/admin/backup/google/connect` route correctly reports this rather than
pretending to start a flow; a real Google sign-in, consent screen, and
token exchange remain unverified until an approved "Web application"
OAuth client is provisioned. **Browser UAT: NOT VERIFIED** this pass -
see the Browser UAT section below for the current blocker.

## 2026-08-11 Preview database migration (Supabase access repaired)

Supabase MCP access to the authoritative project (`tofdgndrrpnnyhbuurbx`,
`energy_monitor`, `ap-southeast-1`) was repaired this pass. Read-only
verification first, then migrations applied through the repository's own
mechanism (`server/db/migrate.ts`'s exact behavior replicated: each
migration file's raw SQL followed by
`INSERT INTO schema_migrations(version)`, in filename order), no code
changes.

**Pre-migration state (read-only verified)**: only `001_phase2_foundation`
and `002_phase3_auth_security` applied - corroborated three independent
ways, not just the tracking table: the live `pg_policies` list matched
001+002's scope exactly, `backup_config`/`backup_log`/`rack_capacity_history`
were confirmed absent via `information_schema.tables`, and RLS was enabled
on all 34 existing tables with zero grants to `anon`/`authenticated`/
`service_role` anywhere. Real data already present: 2 sites (Rangsit id 8,
Srinakarin id 9), Display Period configured (`2026-01`-`2027-12`,
`row_version 9`), 134 `monthly_periods` rows.

**Safety analysis before applying anything**: re-read migrations 003-009
in full. All are additive-only (`CREATE TABLE IF NOT EXISTS`/
`ADD COLUMN IF NOT EXISTS`, zero `DROP`), idempotent (`IF NOT EXISTS`
guards on every policy), and none of their target tables existed yet - no
conflict risk. Exactly one hard ordering dependency: `009` does
`ALTER TABLE public.backup_log ADD COLUMN ...`, which requires `008` to
have run first - satisfied by applying strictly in filename order.
`005`'s assertions against `rack_unit_capacity_images` target a table
that already existed (created by `001`) with its policy already correctly
in place - confirmed idempotent no-op, not a conflict.

**Applied**: `003_workbook_source_retention`, `004_google_sheets_oauth`,
`005_rack_history_and_images`, `006_section_save_timestamps`,
`007_ups_group_history`, `008_backup_log`, `009_backup_config` - all
succeeded, no conflicts encountered, nothing forced.

**New forward migration - a real permission gap, found and fixed**:
Preview verification found `energy_monitor_runtime` had `SELECT/INSERT/
UPDATE` but no `DELETE` on `public.users` (migration `002`, already-applied
history, was never modified) - meaning the application's existing
`deleteUser()` (`DELETE FROM public.users WHERE id = $1`) would fail with
a real Postgres permission error against this database, undetected all
session because it was only ever exercised against the in-memory
repository test double. Created `db/migrations/010_users_delete_grant.sql`
- a single `GRANT DELETE ON TABLE public.users TO energy_monitor_runtime;`,
minimal scope, no other privilege touched, no other role touched. Applied
successfully.

**Post-migration verification (all re-checked live, not assumed)**:
- Migration tracking: `schema_migrations` now has 10 rows (`001`-`010`),
  001/002's `applied_at` unchanged, 003-010 timestamped this session.
- Tables: `workbook_source_versions`, `google_oauth_states`,
  `google_sheets_connections`, `rack_capacity_history`, `ups_group_history`,
  `backup_log`, `backup_config` all exist.
- `backup_config` columns exactly match the intended non-secret shape
  (`id`/`spreadsheet_id`/`sheet_url`/`enabled`/`updated_by`/`updated_at`)
  - no credential column. `backup_log.spreadsheet_id` exists.
  `monthly_periods` gained all 4 `last_saved_*` columns.
- RLS: all 7 new tables show `rls_enabled = true` with exactly 1 policy
  each; `anon`/`authenticated`/`service_role`/`PUBLIC` confirmed with zero
  grants on any of them.
- Grants: `energy_monitor_runtime` on `public.users` is now
  `DELETE, INSERT, SELECT, UPDATE` - the gap is closed.
- Runtime role architecture re-confirmed: `energy_monitor_runtime` itself
  cannot log in (`rolcanlogin=false`) and does not bypass RLS; its two
  login-capable members are `energy_monitor_api` and
  `energy_monitor_preview` (both `rolsuper=false, rolbypassrls=false`) -
  `postgres` is only a member (as it is of every role), never the
  application's own runtime connection role.
- Data integrity: sites (Rangsit id 8, Srinakarin id 9), Display Period
  (`row_version 9`, same `updated_at`), and the 134 `monthly_periods` rows
  are byte-for-byte unchanged - none of the applied migrations touch
  existing rows (only new tables and nullable new columns).

**Tests**: full local regression battery re-run fresh after the migration
work (`test:api` 89, `test:domain-parity` 24, `test:display-period` 10,
`test:web-clean-v1-facility-context` 8, `test:facility-isolation` 15,
`test:facility-comparison` 54, `test:dashboard-facility-isolation` 13,
`test:web-clean-v1-dashboard-ups-mapping` 13, all 5 rack suites,
`test:air-validation`, `test:web-clean-v1-theme`,
`test:web-clean-v1-admin-ui`, `test:web-clean-v1-report-filename`,
`test:web-clean-v1-exports` 7+52, `test:backup-service` 38, `test:phase3`)
- all pass, zero regressions. `npm run lint` and `npm run build` both
clean. Note: these are the local suites against the in-memory repository
double (no `DATABASE_URL` credential is available to this session to run
`scripts/test-postgres-foundation.ts` directly against the real DB - a
separate, narrower constraint from the MCP access that was just repaired).

**Remaining blockers, unchanged**: Browser UAT (Chrome extension not
connected - not re-attempted this pass per explicit instruction to
migrate schema first) and Preview real Google Backup integration
(credential still not provisioned in any Vercel environment). This pass's
own migration work is the item that was previously blocking Backup's
"Preview DB" gate - `backup_config`/`backup_log` now exist in Preview, so
that specific sub-blocker is resolved; the Google credential itself is not.

## 2026-08-11 Final release-readiness audit: NOT PRODUCTION READY

Verification-only pass, no code changes. Re-verified from fresh evidence
(not cited from earlier in this document) rather than trusting prior PASS
claims, per explicit instruction. Full detail/evidence for each claim
below is in this session's own tool output; summarized here.

**Repository state - VERIFIED.** `git status` clean, `feat/web-clean-v1`
checked out, single worktree, no gitlinks/submodules, `feat/web-v3`
retired locally (remote left untouched, per standing instruction). Local
HEAD (`0ae237e`) is 24 commits ahead of `origin/feat/web-clean-v1`
(`db15dc0`) - all local, all unpushed, nothing pushed this pass.

**Security/secret scan - VERIFIED, clean.** Diffed the full unpushed
range (`origin/feat/web-clean-v1..HEAD`, 38 files) and the `dist/` build
output for private-key/credential/token-shaped strings - none found; the
only regex hits were the pre-existing test-fixture password string
("Correct Horse Battery Staple ..."), not a real secret. No `.env` files
tracked besides `.env.example`.

**P0/P1 sweep - VERIFIED, clean.** Systematic search (TODO/FIXME/HACK,
hard-coded facility IDs/months in application logic, mock data reachable
in production paths, dead/unauthorized API routes, silent fallbacks,
`READ_ONLY_MODE` exemption scope, frontend-only authorization) found
**zero P0/P1 issues**. Every mutating route has a matching
`withPermission()` call. `READ_ONLY_MODE`'s exemption list
(`/auth/login`, `/auth/logout`, `/cron/backup`, `/admin/backup/run`,
`/admin/backup/test-connection`) is correctly narrow - the real
settings-mutation route (`PUT /admin/backup/config`) is correctly *not*
exempted. One P2, non-blocking observation: a handful of API routes
(`/sites`, `/settings`, `/periods`, `/dashboard`, `/energy`, `/cost`,
`/electrical` - already documented elsewhere in this file as orphaned
`WebV3App` leftovers; plus `/auth/change-password` and
`PATCH /admin/users/:id/display-name`, newly noted here) have no caller
in the shipped `CleanWebApp` frontend, and `src/web-clean-v1/api.ts`'s
`downloadPdf()` calls a `/sites/:id/reports/pdf` route that does not
exist in `app.ts` - but `downloadPdf` itself is never called from
anywhere in `CleanWebApp.tsx` (PDF export happens client-side via
`buildReportHtml`), so this is dead code with zero runtime impact, not a
defect. Not fixed - it's a P2 cleanup, not a P0/P1, and out of scope for
a release-verification pass ("do not create unnecessary refactors").

**Regression/lint/build - VERIFIED, re-run fresh, zero regressions.**
Full battery (`test:api` 89, `test:domain-parity` 24,
`test:display-period` 10, `test:web-clean-v1-facility-context` 8,
`test:facility-isolation` 15, `test:facility-comparison` 54,
`test:dashboard-facility-isolation` 13,
`test:web-clean-v1-dashboard-ups-mapping` 13, `test:rack-capacity-metrics`,
`test:rack-unit-capacity`, `test:rack-status-config`,
`test:rack-capacity-write`, `test:rack-capacity-history`,
`test:air-validation`, `test:web-clean-v1-theme`,
`test:web-clean-v1-admin-ui`, `test:web-clean-v1-report-filename`,
`test:web-clean-v1-exports` 7+52, `test:backup-service` 38, `test:phase3`)
- all pass. `npm run lint` and `npm run build` both clean.

**Preview deployment - STALE, confirmed with direct evidence, not just a
timestamp.** The live deployment behind the branch alias
(`energy-monitor-git-feat-web-clean-v1-dcm15.vercel.app`) was created
2026-08-10 21:40 +0700, matching `origin/feat/web-clean-v1`'s HEAD
timestamp exactly. Confirmed structurally, not just by timestamp:
`POST /api/v1/cron/backup` on the live deployment returns
`403 CSRF_FAILED` - because the deployed code (`origin` HEAD) predates
the entire Backup feature and its CSRF exemption
(`origin`'s `server/http/app.ts` has no `/cron/backup` route or
exemption at all; local HEAD does). **The live Preview does not contain
any of this session's work**: the admin-configurable backup destination,
all three non-Export parity fixes (Rack Capacity History wiring,
Dashboard UPS Groups fix, User Management deletion audit fix), or the
Rack Report/Site Comparison Export fix. Preview health/readiness below
reflects the OLD, pre-session deployment only.

**Preview health/readiness - VERIFIED (for the currently-deployed old
commit only).** `GET /api/v1/health` -> `200 {"status":"ok"}`;
`GET /api/v1/readiness` -> `200 {"status":"ready"}` (readiness calls
`repository.ping()`, so this also confirms the deployed instance's own
Supabase connectivity works from Vercel's side - a genuinely different
claim from "the MCP connector in this session can reach Supabase", which
remains blocked). Auth boundary confirmed live:
unauthenticated `GET /api/v1/settings` and `/api/v1/admin/users` both
return `401`; a CSRF-missing mutating request returns `403 CSRF_FAILED`.

**Supabase Preview - NOT VERIFIED, EXTERNAL ACCESS BLOCKER, re-confirmed
fresh.** `list_projects` (re-called this pass) still returns only
`lhlzzxjayywqhqtjzfiu` ("patamin-lab's Project", `ap-northeast-2`) and
`rohmbjqnyekvxpyydjbn` (inactive) - neither is `tofdgndrrpnnyhbuurbx`
(`energy_monitor`, `ap-southeast-1`). No schema/RLS/grants/migration-009
live-state claim is made. Migration `009_backup_config.sql` remains
unapplied anywhere.

**Browser UAT - NOT VERIFIED, EXTERNAL BLOCKER, re-confirmed fresh.**
`tabs_context_mcp` called again this pass: "Browser extension is not
connected." No click-through of any kind was performed. Separately, even
if the extension connected, `READ_ONLY_MODE=true` is configured for
`Preview (feat/web-clean-v1)` in Vercel (confirmed via
`vercel env ls preview`), which would block write/admin actions in that
environment regardless - a pre-existing, documented constraint
(`SUPABASE_PROJECT_AUDIT.md`), not new.

**Backup real integration - EXTERNAL BLOCKER, stronger evidence than
before.** Beyond this session's own environment lacking
`GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON`/`CRON_SECRET`, `vercel env ls
preview` confirms **neither variable is configured in any Vercel Preview
environment at all** - this is not merely inaccessible to this session,
it is not yet provisioned anywhere. Code/automated-test/security
verification for Backup remains valid (unchanged, not re-litigated here).

**Rollback plan - VERIFIED realistic, not just "exists".**
`docs/web-v3/ROLLBACK_PLAN.md` (Vercel instant-rollback + additive-only-schema
rationale + secret-rotation guidance) was read and cross-checked against
the actual repository: independently re-verified that all 9 migrations
(`001`-`009`) contain zero `DROP TABLE`/`DROP COLUMN`/`DROP CONSTRAINT`
statements, confirming the plan's "an older build is forward-compatible
by construction" claim is actually true of this codebase, not just
asserted. Plan was not exercised (no incident, nothing deployed to roll
back).

**Desktop/XLSM parity, Dashboard/UPS/Rack/Data Entry/History/Site
Comparison/User Management/Theme/Export - not re-driven from scratch this
pass** (would reopen already-completed, already-evidenced work with no
new information - the Desktop app and XLSM files have not changed since
their direct CDP/byte-level inspection earlier in this session). Re-verified
indirectly and sufficiently via the fresh, zero-regression full test
battery above, which includes the exact suites that assert Desktop
calculation parity (`test:domain-parity` against the golden fixture) and
real-file byte-safety (`test:rack-capacity-write`/`-history`'s own
"Production DC_*.xlsm untouched" self-checks).

### Production Readiness Matrix

| Area | Status | Evidence | Blocker |
| --- | --- | --- | --- |
| Code | PASS | P0/P1 sweep: zero real findings | none |
| Architecture | PASS | Reuse-not-duplicate confirmed (rack calc extraction, shared renderer); dead routes are pre-existing/documented P2 | none blocking |
| Desktop parity | PASS | `test:domain-parity` vs golden fixture + full rack/air/ups suites, all fresh | none |
| Data integrity / facility isolation | PASS | 15+13+8+54+21 facility-isolation assertions across suites, zero cross-contamination | none |
| Authentication | PASS | 401 confirmed live on deployed Preview; session+CSRF tested (`test:phase3`) | none |
| Authorization | PASS | Every mutating route permission-checked (fresh sweep); `test:api` 89 RBAC assertions | none |
| Security | PASS | Fresh secret scan clean; CSRF enforced live; credentials never in DB/browser | none |
| Database (migrations) | PARTIAL | Additive-only confirmed (no DROPs); migration 009 not applied anywhere | Supabase Preview access |
| RLS | NOT VERIFIED | Written correctly per migration (code-reviewed); live enforcement unconfirmed | Supabase Preview access |
| Preview deployment | STALE | Live deployment = `origin` HEAD, 24 commits behind; confirmed structurally (missing `/cron/backup` route) | Nothing pushed (by design) |
| Preview health/readiness | PASS (old code only) | `/health`=200, `/readiness`=200, live-curled | Reflects pre-session code |
| Browser UAT | NOT VERIFIED | Extension not connected (checked fresh) | Chrome extension unavailable |
| Dashboard/UPS/Rack/Data Entry/History/Site Comparison/User Mgmt/Theme | PASS (code+test only) | This session's fixes + full regression, fresh | Browser UAT not verified |
| Backup | PARTIAL | Code/tests/security VERIFIED; real Google integration + Preview DB confirmed unprovisioned | Google credential + Supabase access, both external |
| Export | PASS (code+test only) | 52 assertions incl. real content verification | Browser UAT not verified |
| Regression/Lint/Build | PASS | Full battery re-run fresh, zero regressions | none |
| Deployment | BLOCKED | Not pushed - no push/deploy authorization given this pass | Awaiting explicit authorization |
| Rollback | PASS (plan verified) | `ROLLBACK_PLAN.md` reviewed + additive-only claim independently re-verified | Not exercised (no incident) |

### Production decision: **NOT PRODUCTION READY**

Exact blockers, all external or by-design (none are code defects):

1. **Preview deployment is stale** - none of this session's work (Backup
   feature, 3 non-Export fixes, Export Rack Report fix) has been pushed
   or deployed. Pushing requires explicit authorization not given this
   pass.
2. **Supabase Preview access** - MCP connector cannot reach
   `tofdgndrrpnnyhbuurbx`; schema/RLS/migration-009 live state remains
   unconfirmed.
3. **Browser UAT** - Chrome extension not connected; no click-through of
   any workflow has ever been performed this session.
4. **Backup real Google integration** - no credential provisioned
   anywhere (confirmed via Vercel env listing, not just this session's
   shell).

Recommended next action: push the 24 local commits to
`origin/feat/web-clean-v1` (only with explicit authorization), let Vercel
redeploy Preview, then resolve the Supabase/Browser-UAT access blockers
before re-attempting this gate - none of the remaining blockers are
resolvable from within this session without that external access.

## 2026-08-11 Final Reports & Export phase: Rack Report + Rack Site Comparison

Closes the one gap the prior Export phase explicitly deferred and
documented (`rack: null`, see the "2026-08-11 Reports & Export" entry
below for the full Desktop workflow inspection - not repeated here, since
the workflow itself did not change and re-inspecting it would produce no
new information). Non-Export work (Dashboard, UPS History, Rack Capacity
UI, Data Entry, User Management, Theme, Site Comparison module) was **not
reopened** - no regression in any of it was found or required reopening it.

**Desktop source of truth for the rack section specifically**: rather than
re-driving the Desktop app's UI (the report *workflow* was already
directly inspected via CDP in the prior phase), this pass read
`src/reports/pdf/reportHtml.ts` - the literal shared renderer both Desktop
and Web call to build a report - to determine exactly what Desktop's Rack
Capacity page, Capacity Health/Zone Heatmap page, and Rack Capacity Site
Comparison page require (`data.rack`/`data.rackComparison`). This is
authoritative by construction: whatever behavior reading non-null rack
data produces IS Desktop's behavior, since it is the same function.

**Root cause of `rack: null`**: `facilityReportData()` (`src/web-clean-v1/exports.ts`)
took only `(logs, siteName, selectedMonth)` and never fetched rack data at
all - not a wiring gap in an existing fetch (like the earlier UPS/Rack
History gaps), but a function that structurally couldn't reach the
`GET /racks` endpoint the live Rack Capacity view already uses.

**Fix - reused, did not duplicate, the rack calculation:**

- Extracted `deriveRackCapacityReport()` out of
  `src/reports/rackCapacityReader.ts` (Desktop's Excel-based rack reader)
  into a new dependency-free module, `src/reports/rackCapacityReportBuilder.ts`
  (no ExcelJS import, so importing it into the Web bundle never pulls in
  the Excel library into the main chunk). `rackCapacityReader.ts` now
  calls this shared function instead of duplicating the grouping/
  validation logic inline - confirmed byte-identical output via
  `test:rack-capacity-write`/`test:rack-capacity-history` (both re-run
  fresh, all passing, including their own "Production DC_*.xlsm untouched"
  self-checks).
- Added `rackReportFromSnapshot()` (`exports.ts`) - converts the existing
  `GET /racks` API response (`RackSnapshotRecord`, already used by the
  live Rack Capacity view) into the same `RackCapacityReport` shape via
  `deriveRackCapacityReport`, so the grouping/validation *rules* are
  Desktop's own rules, just applied to a DB-sourced record list instead of
  an Excel buffer. A null source `rowNumber` (optional metadata on a real
  row) falls back to the row's 1-based position - never fabricated data,
  and the renderer never uses `rowNumber` for a calculation, only display.
- `facilityReportData()`/`printDesktopPdf()`/`printAllFacilitiesPdf()` all
  gained optional `rack`/`rackHistory`/`rackUnitCapacity` parameters
  (default `null`/`[]`, so every existing call site and test stayed
  source-compatible). "Current Facility" fetches its own site's rack
  snapshot for the Reporting Month; "All Facilities" fetches each site's
  own snapshot independently (never one facility's data reused for
  another). A facility with no rack snapshot for the selected month
  degrades to `rack: null` for that facility only (the existing
  `"Rack capacity data is unavailable in this workbook."` message,
  matching Desktop's own message for a missing/absent sheet) - the export
  as a whole still succeeds.
- `rackHistory`/`rackUnitCapacity` (plural, month-over-month arrays) are
  populated from `GET /sites/:id/history`'s `rackCapacityHistory`/
  `rackUnitCapacity` fields - the exact same wiring built in the non-Export
  pass for the History screen's Rack tab, reused here rather than a
  second fetch or a second calculation.
- **Also implemented, beyond the literal `rack: null` finding**: Site
  Comparison's "Rack Capacity Site Comparison" page
  (`rackComparisonPage()` in the shared renderer) was previously always
  empty too (`rackComparison: null`, unconditionally, in
  `printSiteComparisonPdf`). Since the shared renderer already has this
  page and Desktop is the one producing that renderer function, this is
  Desktop-supported functionality, not an invented one. Fixed the same
  way: fetch each of the two compared facilities' rack snapshot for the
  reference month (`loadRack`, already built for the fix above),
  reuse `rackReportFromSnapshot`, no new calculation.

**Rack Report - STATIC VERIFIED (via real generated HTML, not a smoke
test)**: extended `scripts/test-web-clean-v1-exports.ts` with 21 new
assertions (52 total, up from 31): `rackReportFromSnapshot` unit behavior
(null/empty snapshot -> null; a null source `rowNumber` falls back
correctly; an already-present `rowNumber` is preserved; zone grouping and
duplicate-ID detection reuse Desktop's exact rules); PDF content checks
(`rack: null` -> the real "Rack capacity data is unavailable in this
workbook." message, not a blank/fabricated table; `rack: <real data>` ->
the "Rack Capacity and Utilization" heading with a Total Racks KPI value
that matches `calculateRackCapacityMetrics()` - the *same* function the
live Rack Capacity view calls - exactly, proving reuse rather than a
second computation); facility isolation (two facilities with distinctly
named rack zones never leak into each other's report, mirroring every
other facility-isolation test in this codebase); and the Rack Capacity
Site Comparison page (renders with both facility labels when populated,
absent - not an empty section - when not).

**Reporting Period / Reporting Month - re-verified, not re-derived from
scratch**: `test:web-clean-v1-exports`'s existing `assertExportsShowOnlyMonth`
critical-path test (build was not touched by this pass, but its
dependency graph now includes the new rack code, so it was re-run to
confirm no regression) already performs exactly the scenario this task's
own instructions specify - app starts on 2026-08, user selects Single
Month = 2026-06, all three formats (real CSV string, real re-read XLSX
bytes, real PDF HTML string) are asserted to contain only June and none
of July/August; then the same for 2026-07 - still passing, unchanged.
Current Month / Month Range / Full History modes are separately asserted.
This flow is scoped to "Current Facility" (the only card with a Reporting
Period/Month selector - the UI's own copy already discloses "Applies to
the Current Facility export below", an intentional, pre-existing
difference from "All Facilities"/"Site Comparison", not something this
pass restructured).

**Facility context**: `Reports()` gained a `siteId` prop (previously
absent - it received only `siteName`) specifically so the new rack fetch
could target the correct site; "All Facilities"/Site-Comparison rack
fetches use each facility's own `site.id` from the already-scoped API
responses, never a hardcoded or reused ID. Verified via the new
facility-isolation assertions above.

**Excel/CSV**: unchanged - rack data was never part of the Excel/CSV
structure (`workbookForFacilities`/`buildCombinedCsv`) on either Desktop
or Web; only the PDF renders a Rack Capacity section. No new column/sheet
was added, matching Desktop (Desktop's Excel export likewise has no rack
sheet).

**Number formatting**: unchanged - the rack KPIs/zone tiles reuse
`formatRatioPercent`/the existing `kpi()`/`table()` HTML helpers already
used by every other report section; no competing formatting logic added.

**Regression**: full battery re-run fresh - `test:api` (89), `test:domain-parity`
(24), `test:display-period` (10), `test:web-clean-v1-facility-context` (8),
`test:facility-isolation` (15), `test:facility-comparison` (54),
`test:dashboard-facility-isolation` (13), `test:web-clean-v1-dashboard-ups-mapping`
(13), `test:rack-capacity-metrics`, `test:rack-unit-capacity`,
`test:rack-status-config`, `test:rack-capacity-write`, `test:rack-capacity-history`
(all 5 rack suites, including their "Production DC_*.xlsm untouched"
self-checks), `test:air-validation`, `test:web-clean-v1-theme`,
`test:web-clean-v1-admin-ui`, `test:web-clean-v1-report-filename`,
`test:web-clean-v1-exports` (7 + 52), `test:backup-service`, `test:phase3`
- all pass, zero regressions. `npm run lint` and `npm run build` both
clean; the Web bundle's `CleanWebApp-*.js` chunk grew only ~2.3 kB
(82.76 kB vs. 80.45 kB before this pass) and `exceljs.min-*.js` remains
its own separate lazy chunk, confirming the ExcelJS-avoidance refactor
worked as intended.

**Browser UAT: NOT VERIFIED - EXTERNAL BLOCKER.** Re-checked this pass
(not assumed carried over): `tabs_context_mcp` was called fresh and
returned "Browser extension is not connected" - the Chrome extension has
not been connected at any point in this session. No live click-through
(open Reports & Export -> select report/facility/period/month -> generate
Excel/CSV/PDF -> inspect -> change month -> regenerate -> verify) was
performed. All verification above is real generated-content evidence
(actual HTML strings, actual re-read XLSX bytes, actual CSV strings), not
a substitute for seeing it render and download in an actual browser.

**Supabase: NOT VERIFIED - EXTERNAL BLOCKER.** Unchanged; this pass
required no live DB access - the rack fetch reuses the already-existing,
already-tested `GET /racks` endpoint and repository methods, none of
which were modified.

**Production: UNTOUCHED.** No migration, no deploy, no Production env var
read or written.

## 2026-08-11 Non-Export completion pass: three real gaps found and fixed

Per explicit instruction to work through the remaining non-Export priority
list (Dashboard, Reporting Period/Month, UPS Group/History, Rack Capacity,
Data Entry, History, Site Comparison, User Management, Facility isolation,
Theme, Responsive, remaining functional gaps) and root-cause/fix any real
P0/P1 gaps found, rather than re-trust prior "READY FOR EXPORT PHASE"
sign-off blindly. Found three genuine, previously-undetected defects by
systematically comparing each reused Desktop component's prop interface
against what CleanWebApp actually supplies (the same technique that
originally found the UPS History bug) - not by re-deriving already-solid
ground. All three are now fixed, tested, and regression-verified.

**1. History screen's Rack tab was permanently empty, regardless of real
data (Rack Capacity + Data Entry + History priorities).** `HistoricalExplorer`
needs `rackCapacityHistory`/`rackUnitCapacity` props to render its Rack tab;
both default to `[]` when omitted, and CleanWebApp never passed either.
Root cause: `public.rack_capacity_history` (migration `005_rack_history_and_images.sql`)
has a table, an RLS policy, and a Desktop writer (`RackCapacityHistoryWriter.ts`)
- but zero repository method, zero API wiring, and zero frontend prop, ever.
`rack_unit_capacity_snapshots` had per-month data but only a single-month
getter (`getRackUnitSnapshot`), never a "list all months" method. Same root-
cause class as the earlier UPS Group History bug (a real table with no
plumbing to the browser), just not caught until now.
- Fix: added `listRackCapacityHistory(siteId)`/`listRackUnitCapacityHistory(siteId)`
  to `BackendRepository` (implemented in both `postgresRepository.ts` and
  `inMemoryRepository.ts`, mirroring `getUpsGroupHistory`'s existing
  all-months pattern exactly); folded both into `apiService.ts`'s existing
  `getHistory()` response (same Display-Period-visibility filtering as
  `upsGroupHistory`); wired `CleanWebApp.tsx`'s `HistoricalExplorer` call
  site to pass both through instead of defaulting to `[]`.
- **STATIC/API VERIFIED**: 8 new `test:api` assertions (field mapping,
  Display Period filtering, facility isolation, genuinely-empty-site case,
  derived `availableU`/`availabilityPct` correctness) - `test:api` now 89
  assertions (was 82 before this pass).

**2. Dashboard's Engineering View UPS Groups section was always empty on
Web, for every facility, every month (Dashboard priority #1).**
`DashboardSummary`'s UPS group totals come from either a Desktop
file-based `facility.profile.dashboard` topology (`config/<id>/profile.json`,
Electron-filesystem-only, no Web/Supabase equivalent) or an
`upsMapping.summary` report; CleanWebApp supplied neither, so
`buildEngineeringDashboardSnapshot`'s `upsGroups` array was unconditionally
`[]`. **This was previously undetected because `test:dashboard-facility-isolation`
- despite its name and despite being cited throughout this session's
regression battery as covering Web dashboard rendering - reads and greps
`src/App.tsx` (Desktop's own entry point) to verify the facility prop is
wired, never `src/web-clean-v1/CleanWebApp.tsx`.** It correctly proves
Desktop's own wiring and the underlying XLSM data layer are sound, but
proves nothing about whether CleanWebApp does the same - it does not.
`UniversalFilterBar` has the identical gap for the same reason
(`<UniversalFilterBar lang={lang} facility={null} .../>` - hardcoded, not
merely omitted) - its UPS Group filter dropdown has zero options.
- Fix (Dashboard UPS group totals): CleanWebApp already fetches
  `upsGroupHistory` (server-computed, already facility/Display-Period-scoped,
  now further verified above) for the History screen. Added
  `src/web-clean-v1/dashboardUpsMapping.ts`'s `buildDashboardUpsMapping()`
  - a small pure function that filters those already-correct rows to the
  Dashboard's currently selected month and reshapes them into
  `upsMapping.summary`, reusing real, already-audited data rather than
  inventing a new source. Wired into `DashboardView`'s `DashboardSummary`
  call. The detailed per-UPS UMDB/STS/OUDB hardware mapping table
  (`upsMapping.mapping`) has no Web/DB equivalent at all (Desktop-only
  busbar wiring data) and is deliberately left empty rather than fabricated.
- **NOT fixed, documented instead**: `UniversalFilterBar`'s UPS Group
  filter *dropdown* (distinct from the KPI totals above) needs a topology
  with real device-ID arrays per group (`{name, ids: string[]}[]`), which
  the Web/DB layer does not store anywhere retrievable server-side without
  new schema. Reusing `ups_group_history`'s group *names* alone would let
  the dropdown list group names but could not correctly filter underlying
  per-UPS rows without genuine ID data - attempting that would have meant
  guessing at a name-to-IDs mapping. Left as a known, narrower, honestly-
  documented gap (a non-functional filter control, not missing data) rather
  than risk fabricating an incorrect filter.
- **STATIC/API VERIFIED**: new dedicated test
  `scripts/test-web-clean-v1-dashboard-ups-mapping.ts`
  (`npm run test:web-clean-v1-dashboard-ups-mapping`), 13 assertions against
  the extracted pure function directly (null-history case, month-with-no-rows
  case, correct field mapping, month filtering, sequential row numbers,
  empty `mapping`) - not a source-grep substitute, real input/output
  assertions this time.

**3. User Management: `deleteUser` never wrote a session-revocation audit
entry, and the delete route (`DELETE /admin/users/:id`) had zero API-level
test coverage at all (User Management priority #8).** `setUserActive(false)`
and `resetUserPassword` both call `revokeAllSessions()` and write a
`SESSION_REVOKED_ALL` audit row; `deleteUser` did neither - a gap already
flagged (but never fixed) in this session's earlier follow-up verification
pass. Not a security hole (`sessions.user_id` is `ON DELETE CASCADE`, so
the row-delete already removes every session regardless), but a real
audit-trail inconsistency, and the route itself had never been exercised by
any test (`test-api-foundation.ts` had no DELETE-route assertions at all).
- Fix: `deleteUser` (both `PostgresAuthRepository` and
  `InMemoryAuthRepository` in `server/auth/repository.ts`) now calls
  `revokeAllSessions()` and writes `SESSION_REVOKED_ALL` before the
  `user_delete` audit row and the delete itself, matching the
  deactivate/reset pattern exactly.
- Also fixed a latent bug in the test harness itself while adding this
  coverage: `test-api-foundation.ts`'s `request()` helper unconditionally
  called `response.json()`, which throws on a `204 No Content` body - this
  is why the DELETE route had never been tested (the harness itself
  couldn't have handled it). Now reads the body as text first and only
  parses non-empty responses.
- **STATIC/API VERIFIED**: 7 new assertions (non-admin 403, self-deletion
  409 `SELF_DELETION_NOT_ALLOWED`, successful delete removes the user,
  deletion revokes the deleted user's own active session, both audit
  actions present).

**Also checked and found clean** (no fix needed): Data Entry's four table
components (`UpsTable`/`AirTable`/`DcTable`/`EnergyCostTable`) - every
required prop is correctly supplied by CleanWebApp; `AirTable`'s optional
`meterLabels` is unset but degrades to a reasonable computed default
(`"EB41A (GWh)"`-style), not an empty render. `ExecutiveDashboard`/
`SmartInsightPanel` take only `logs`/`lang`, both supplied. Site Comparison
is a Web-native implementation (not a reused Desktop component with hidden
props), already covered by 54 existing assertions.

**Separately discovered, out of scope for this pass, not caused by
anything in this pass's diff**: `test:ups-group-history`,
`test:ups-group-history-migration`, and `test:production-stress-fault`
(Desktop XLSM-writer byte-level stress tests, exercising
`WorkbookReader`/`WorkbookWriter`/`upsGroupHistoryReader`/
`upsGroupHistoryMigration` - none of which this pass's changes touch) have
pre-existing failures (row-count/duplicate-row assertions in "Scenario 2"
and "Scenario 5", and two `generatedAt`-timestamp assertions). Confirmed
unrelated to this pass: none of these three scripts import any file this
pass modified, and neither `DC_Rangsit.xlsm` nor `DC_Srinakarin.xlsm` (both
untracked/gitignored, so no git history to diff against) show a
modification timestamp from today. These three scripts were also never
part of this session's routinely-re-run "full regression battery" citations
earlier in this document (which consistently lists domain-parity,
display-period, facility-*, dashboard-isolation, rack tests, air-validation,
theme, admin-ui, api, report-filename, exports, backup-service, phase3) -
so this is a pre-existing gap in test-suite coverage that simply was never
re-checked, not a regression introduced now. Not fixed here: root-causing a
Desktop XLSM zip-surgery stress-test failure is a materially different,
larger investigation than this pass's Web-parity scope, and the task's own
priority list does not include it.

Full regression re-run fresh for this pass: `test:api` (89, up from 82),
`test:web-clean-v1-dashboard-ups-mapping` (13, new), `test:domain-parity`
(24), `test:display-period` (10), `test:web-clean-v1-facility-context` (8),
`test:facility-isolation` (15), `test:facility-comparison` (54),
`test:dashboard-facility-isolation` (13 - Desktop-side, see finding #2
above for what this suite does and does not prove), rack tests (3 suites),
`test:air-validation`, `test:web-clean-v1-theme`, `test:web-clean-v1-admin-ui`,
`test:web-clean-v1-report-filename`, `test:web-clean-v1-exports`,
`test:backup-service`, `test:phase3` - all pass, zero regressions. `npm run
lint` and `npm run build` both clean.

**Browser UAT: NOT VERIFIED - EXTERNAL BLOCKER** (Chrome extension still
not connected). **Supabase: NOT VERIFIED - EXTERNAL BLOCKER** (unchanged;
this pass did not require live DB access - all three fixes verified against
the in-memory repository test double and static source inspection).

## 2026-08-11 Data storage, backup, and Role management

Full detail: `docs/web-clean-v1/DATA_BACKUP_AND_RECOVERY.md`.

**Database/audit (items 1-3 of the task)**: inspected, not rebuilt. The
normalized schema for user-entered operational data (`sites`,
`monthly_periods`, `ups_readings`, `air_meter_readings`, `dc_readings`,
`energy_cost_inputs`, rack tables) and the `audit_events` WHO/WHAT/WHEN
trail already existed, complete, before this session - `saveMonthlyLog`
already writes a full audit row with actor, previous/new value, and
correlation ID on every save. No duplicate tables or second audit system
were created. **VERIFIED (pre-existing, confirmed by code inspection).**

**Google Sheets backup**: new (`server/backup/`). Server-side only,
service-account JWT auth via the already-installed `jose` dependency (no
new dependency added), reading data through the existing
`BackendRepository` (no duplicate queries). Distinct from, and does not
touch, the existing unrelated per-user-OAuth Google Sheets Desktop feature
(`sheetsService.ts` et al.). New `backup_log` table + admin API routes
(`GET/POST /api/v1/admin/backup/*`, reusing the pre-existing
`backupRestoreManage` permission) + a `POST /api/v1/cron/backup` route for
Vercel's daily cron, authenticated by `CRON_SECRET` and explicitly exempted
from the global CSRF/read-only-mode gates (a real bug found and fixed
during this work - the cron route would otherwise have been rejected by
CSRF before reaching its own auth check). Snapshot-per-run backup format,
not append-only - documented rationale in `DATA_BACKUP_AND_RECOVERY.md`
Section 9, given live data volume was not inspectable this session
(Supabase blocked). **STATIC/API VERIFIED**: 23 backup-service assertions
with mocked Google API responses (real JWT signing against a
locally-generated throwaway RSA key, real request-sequence verification,
real sensitive-data-exclusion check), 8 new API-route assertions (RBAC,
CSRF exemption). **Google Sheets integration: NOT VERIFIED - EXTERNAL
CREDENTIAL BLOCKER** (no real service-account credentials available).
**Migration `008_backup_log.sql`: not applied to any live database**
(Supabase blocked; no local Docker available to validate against a
throwaway Postgres either) - written by hand-matching
`007_ups_group_history.sql`'s exact structure.

**Role management**: Add User's Role selector and safe `user` default
already existed. **Edit Role for an existing user was a real, confirmed
gap** - the backend (`PATCH /admin/users/:id/role`, with last-admin
protection, audit logging) already worked and was already tested, but no
frontend control existed to reach it. Added a per-row Role `<select>` in
the User Management table. Last-admin protection, session revocation on
deactivation/password-reset, and role-change audit logging were all
re-verified as already correct via `test:api` (63 assertions total,
including a fresh RBAC check for the new backup routes). **VERIFIED.**

Full regression re-run fresh: all pre-existing suites (domain-parity,
display-period, facility-context/isolation/comparison, dashboard-isolation,
rack, air-validation, theme, admin-ui, exports, report-filename) plus the
two new suites (backup-service, extended api) - zero regressions. Lint and
build clean.

**Browser UAT: NOT VERIFIED - EXTERNAL BLOCKER** (Chrome extension still
not connected). **Supabase: NOT VERIFIED - EXTERNAL BLOCKER** (unchanged).

## 2026-08-11 Backup: Admin-configurable Google Sheet destination

Focused follow-up to the backup system above - full detail in
`DATA_BACKUP_AND_RECOVERY.md` Section 4.1/7/10.1. The backup
**destination** (which Google Sheet) was hard-coded via
`GOOGLE_BACKUP_SPREADSHEET_ID`; it is now stored as a non-secret row in a
new `backup_config` table (migration `009_backup_config.sql`, extends
rather than modifies `008_backup_log.sql`) and set by an Admin from
Settings -> Data Backup. The Google service-account credential itself did
not move - it remains env-var-only (`GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON`),
never stored in the DB, never sent to the browser.

New: `server/backup/googleSheetsUrl.ts` (server-side URL parsing/
validation/spreadsheet-ID extraction/masking - the browser can only submit
a URL, never assert an ID directly), a real `testBackupConnection()` flow
(authenticates, confirms the spreadsheet is reachable, creates the two
required tabs if missing, without writing backup data), `PUT
/api/v1/admin/backup/config` and `POST /api/v1/admin/backup/test-connection`
routes (both gated by the same pre-existing `backupRestoreManage`
permission - no second permission system), and a destination-change audit
event (`backup_destination_change`, masked spreadsheet reference only).
`runBackup()` (both manual and scheduled) now reads the destination fresh
from `backup_config` on every run, so changing it takes effect
immediately with no code change or redeploy; the previous destination is
never auto-modified or deleted, and every `backup_log`/`Backup_Log` row
now records which spreadsheet it was written to.

Frontend: `DataBackupPanel` (Settings -> Data Backup) gained the Enabled
toggle, Google Sheet URL field, Test Connection button with a
✓/✕ status message, and Save Settings - reusing the existing design
system's slate/teal/indigo/rose token classes (already theme-aware via
`.theme-light`'s CSS-variable remap), no new UI system introduced.

**STATIC/API VERIFIED**: `test:backup-service` extended to 38 assertions
(destination sourced from a fixture `backup_config`, a full mocked
successful run against a configured sheet, a destination-switch test
proving the previous sheet is never touched, scheduled-vs-manual
`enabled` behavior, 403/404 Google error handling, and `testBackupConnection`
success/failure cases) - all still against a locally-generated throwaway
RSA key with `fetch` fully mocked, never real credentials. `test:api`
extended to 73 assertions: admin can save a valid URL, an unrelated URL is
rejected (`400 INVALID_SHEET_URL`), the response returns a masked
reference only (never the raw ID or a credential-shaped field), the
change is audited, and a `user`-role session gets `403 FORBIDDEN` from
both the config-write and test-connection routes. Full regression battery
(all suites above, unchanged) plus lint and build re-run clean with these
changes.

**Google Sheets integration: NOT VERIFIED - EXTERNAL CREDENTIAL BLOCKER**
- no real Google service-account credentials were available this session;
real integration (a real spreadsheet, real sharing/permission errors, a
real Test Connection success) remains unverified until an approved
credential is configured. **Migration `009_backup_config.sql`: not applied
to any live database** (same Supabase/Docker blocker as `008`). **Browser
UAT: NOT VERIFIED - EXTERNAL BLOCKER** (Chrome extension still not
connected; the new form fields have not been seen rendering or clicked in
an actual browser).

## 2026-08-11 Backup: Preview/real-Google verification pass

Follow-up task specifically to close the Preview-DB and real-Google gaps
left open above. Full detail and evidence in
`DATA_BACKUP_AND_RECOVERY.md` Section 0 (verification status matrix).
**No code was changed in this pass** - this was verification-only, per
the task's own "do not rebuild, close remaining gaps" instruction.

**Code: VERIFIED** - migration 009 re-inspected by hand (additive only,
exact intended field set, no credential field, RLS/grant pattern matches
008). Static scan of `server/backup/*`, `server/http/app.ts`, and the
built `dist/` bundle for `private_key`/`client_secret`/`access_token`/
`refresh_token`/`GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON`/`backupRestoreManage`
- none found leaking into an API response or the frontend bundle. The one
`refresh_token`-shaped string in `dist/assets/App-*.js` is generic OAuth2
client-library code from the pre-existing, unrelated per-user Google
Sheets OAuth feature (`sheetsService.ts`), not this backup system.

**Automated tests: VERIFIED (re-run fresh)** - `test:backup-service` (38
assertions) and `test:api` (75 assertions) re-run clean; full regression
battery (domain-parity, display-period, facility-context/isolation/
comparison, dashboard-isolation, rack x3, air-validation, theme,
admin-ui, report-filename, exports, phase3) re-run clean, zero
regressions; lint and build re-run clean.

**Preview database: NOT VERIFIED - EXTERNAL BLOCKER (confirmed again,
with fresh evidence).** `SUPABASE_PROJECT_AUDIT.md` names the
authoritative project as `tofdgndrrpnnyhbuurbx` (`energy_monitor`,
`ap-southeast-1`). The Supabase MCP connector available this session
lists exactly two projects - `lhlzzxjayywqhqtjzfiu` ("patamin-lab's
Project", `ap-northeast-2`) and `rohmbjqnyekvxpyydjbn` (inactive,
`masp-sec-e1a-identity-poc`) - neither matches by ref, name, or region.
Migration 009 was **not** applied anywhere this pass. An ambiguous
`.env.local` entry (`PHASE3_LIVE_DATABASE_URL`) exists but its value was
deliberately not read (matches the existing "don't guess at an unverified
local secret artifact" precedent already set in `SUPABASE_PROJECT_AUDIT.md`
for `.phase7-db-url`).

**Real Google integration: NOT VERIFIED - EXTERNAL CREDENTIAL BLOCKER
(confirmed again).** `GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON` and
`CRON_SECRET` are both unset in this session's environment.

**Production: UNTOUCHED.** No migration applied anywhere, no deploy, no
Production env var read or written.

## 2026-08-11 Reports & Export

**Desktop source of truth** (from direct inspection this session via CDP
against the isolated Desktop copy, not assumed): Desktop's "Reports & Export"
screen is a full "Reporting Center" with a Report Builder (Report Type:
"All Report"; Reporting Period: **Current Month / Single Month / Month
Range / Full History**; a month picker; a 10-item custom-section checklist
- Executive, Dashboard, Rack Capacity, Rack Unit Capacity, UPS, Air
Conditioning, DC, Historical, Site Comparison, Appendix), a Live Preview
pane, Export Options (Format: Pdf, Excel, HTML, **Powerpoint marked "COMING
SOON"** - not actually available even on Desktop), a Filename field, and a
persistent Recent Reports history. The Recent Reports table gave the real
filename convention directly: `Energy_Report_Rangsit_2026-06.pdf`,
`Energy_Report_Srinakarin_2026-06.pdf` - i.e.
**`Energy_Report_<Facility>_<YYYY-MM>.<ext>`**, not the
`Energy_Monitor_...` example given in the instructions (explicitly flagged
there as "example only, do not assume").

| Area | Desktop | Web (this session) | Status |
| --- | --- | --- | --- |
| Reporting Period | Current Month / Single Month / Month Range / Full History | Same 4 modes implemented; `filterLogsByPeriod` scopes already-fetched logs before handing off to the unmodified CSV/Excel/PDF builders - no new calculation | STATIC/API VERIFIED |
| Reporting Month | Month picker, scopes the report | Implemented for Single Month mode; From/To pickers for Month Range | STATIC/API VERIFIED |
| Facility context | Report is scoped to one facility ("Context: Rangsit") | Reuses the existing shared facility selector; no second facility state added | VERIFIED |
| Stale-data prevention | (implicit in a correctly-built report tool) | Explicit real-content test: app starts on a later month, user selects an earlier month, all 3 formats regenerated and verified to contain only that month; switching months again verified to update all 3 - tested against real XLSX bytes (re-read with ExcelJS), the real CSV string, and the real PDF HTML, not mocks | VERIFIED |
| Filename | Desktop-standard default, user-editable, shown in Recent Reports | `Energy_Report_<Facility>_<Month>` default (confirmed matches Desktop); user-editable; auto-updates with context unless customized; Reset to Standard Name; extension normalized per format (no `.xlsx.xlsx`); empty input falls back to the standard name; invalid Windows characters (`< > : " / \ \| ? *`) sanitized, not silently broken | VERIFIED |
| Excel | Structured workbook, Desktop-derived sections | Reuses existing `workbookForFacilities`/`buildSectionCsvs` (UPS/Air/DC/Energy sheets), now respecting the selected period scope; content re-verified via ExcelJS read-back | STATIC/API VERIFIED |
| CSV | Structured data | Reuses existing `buildCombinedCsv`, now period-scoped; content verified | STATIC/API VERIFIED |
| PDF | Primary human-readable report; title, facility, reporting month, KPIs, tables | Reuses the existing Desktop-compatible `buildReportHtml` renderer unchanged; now period-scoped; filename reaches the print dialog via `document.title` (the browser print-to-PDF convention); content verified (human-readable "Mon YYYY" month label, matching Desktop, confirmed correct after an initial wrong test assumption was caught and fixed) | STATIC/API VERIFIED |
| Current Facility / All Facilities / Site Comparison | Report is single-facility-scoped; Site Comparison is one of the 10 checkable sections, not evidence of a separate "All Facilities" mode | Web's pre-existing 3-card structure (Current Facility / All Facilities / Site Comparison) predates this session and was not restructured - each already keeps facility data cleanly isolated (verified by the existing `test:web-clean-v1-exports` assertions) | PARTIALLY VERIFIED - Desktop's exact report-type taxonomy (one configurable report vs. 3 fixed cards) was not reproduced 1:1; not restructured this pass to avoid scope creep beyond the stated gate criteria |
| Rack Report (`rack` field in the PDF DTO) | Rack Capacity is one of the 10 checkable sections | **NOT IMPLEMENTED** - `rack: null` remains. The API/calculation data needed now exists (built earlier this session for the Rack Capacity view), but `RackCapacityReport`'s full type needs `byCabinetSize`/`byDeviceType`/`validation` fields and a dedicated per-export fetch not yet wired up | NOT VERIFIED - explicitly scoped out, documented rather than silently omitted |
| Number formatting | kWh/THB/%, Desktop precision | Unchanged - reuses the existing centralized `formatNumber2`; no competing formatting logic added | VERIFIED (pre-existing) |
| Section ordering | Cover -> Dashboard -> Trends -> Monthly table -> Comparison -> Rack -> ... | Unchanged - `buildReportHtml`'s existing order was not touched | VERIFIED (pre-existing, not modified) |
| HTML / PowerPoint formats, Live Preview, custom section picker, Recent Reports history | Present on Desktop's fuller Reporting Center | Not implemented | INTENTIONAL DIFFERENCE for this pass - PowerPoint is "coming soon" even on Desktop (not a real gap); the others are real Desktop capabilities not reproduced, out of scope for the stated Export gate criteria (Reporting Period/Month, facility, 3 existing formats, filename, no stale data) |
| Forecast / Energy Benchmarking exports | N/A | Not added | INTENTIONAL DIFFERENCE - explicitly excluded scope, not a defect |

**Regression tests**: `test:web-clean-v1-exports` (7 pre-existing + 31 new =
38 assertions, including the full stale-data critical-path test against
real generated bytes), `test:web-clean-v1-report-filename` (14 assertions).
Full battery re-run fresh: `domain-parity`, `display-period`,
`facility-context`, `facility-isolation`, `facility-comparison`,
`dashboard-facility-isolation`, rack tests, `air-validation`, `theme`,
`admin-ui`, `api` - all pass, zero regressions. `npm run lint` and
`npm run build` both clean.

**Browser UAT: NOT VERIFIED - EXTERNAL BLOCKER.** Chrome extension still
not connected this session; no live click-through of Report Context ->
Generate -> inspect-downloaded-file was performed. All verification above
is real generated-content evidence (actual XLSX bytes, actual CSV/PDF
strings), not a substitute for seeing it render and download in an actual
browser.

**Supabase: NOT VERIFIED - EXTERNAL BLOCKER.** Unchanged; MCP still cannot
see `tofdgndrrpnnyhbuurbx`.

## 2026-08-11 Final non-Export verification gate

Full regression battery re-run fresh for this gate (not cited from
earlier in the session): `test:domain-parity` (24), `test:rack-capacity-metrics`
(6), `test:rack-unit-capacity` (6), `test:rack-status-config` (6),
`test:display-period` (10), `test:air-validation` (8), `test:web-clean-v1-theme`
(1 suite incl. computed-contrast assertions), `test:web-clean-v1-facility-context`
(8), `test:web-clean-v1-admin-ui` (1 suite), `test:facility-isolation` (15),
`test:facility-comparison` (54), `test:dashboard-facility-isolation` (13),
`test:phase3` (127 authz + 25 unit tests), `test:api` (55). All pass, zero
regressions from the Dashboard/Rack Capacity work. `npm run lint` and
`npm run build` both clean.

Both external blockers re-checked and confirmed unchanged: Supabase MCP
still exposes only `lhlzzxjayywqhqtjzfiu`/`rohmbjqnyekvxpyydjbn`, not
`tofdgndrrpnnyhbuurbx`; the Chrome browser extension is still not
connected in this session.

| Area | Status | Evidence |
| --- | --- | --- |
| Dashboard - Executive View | STATIC/API VERIFIED | Reused `ExecutiveDashboard` component; build clean |
| Dashboard - Engineering View | STATIC/API VERIFIED | Pre-existing `DashboardSummary`, unchanged |
| Dashboard - Year/Period/Trend/Category/UPS Group/Compare | STATIC VERIFIED | `UniversalFilterBar` wired to shared `ReportContext`; no dedicated UI test exists for this component (pre-existing gap, not introduced here) |
| Dashboard - Forecast/Benchmark | INTENTIONAL DIFFERENCE | `reportViews` prop restricts Web's tab switcher; not present anywhere in the Web bundle |
| Dashboard - chart numeric labels | STATIC VERIFIED | `TrendLineChart` draws direct SVG labels; `DashboardSummary` has no chart library (tables/cards only) |
| Dashboard - Light/Dark theme | STATIC VERIFIED | Computed WCAG contrast, `test:web-clean-v1-theme` passes |
| Rack Capacity - view/facility/zone/status/unit | STATIC/API VERIFIED | `test:rack-capacity-metrics`, `test:rack-unit-capacity`, `test:rack-status-config`, new API assertions all pass |
| Rack Capacity - calculation reuse | VERIFIED | `calculateRackCapacityMetrics`/`usagePercent` called directly, not reimplemented |
| Rack Capacity - facility isolation | STATIC/API VERIFIED | API test: site with no snapshot returns null, never another site's data |
| UPS Group / UPS History | STATIC/API VERIFIED | Root-caused and fixed 2026-08-11 (see below); `test:api` covers mapping, DTO fields, Display Period filtering, facility isolation, empty case |
| Data Entry (fields, Rangsit=4/Srinakarin=6 EB fields, save/persist) | VERIFIED | `test:air-validation`, `test:facility-isolation` (15 checks) |
| History (UPS/Air/DC/Energy/Rack tabs, filters, facility/month context) | STATIC VERIFIED | `HistoricalExplorer`'s 5-tab structure confirmed in source; UPS tab data flow fixed this session |
| Site Comparison (facility, reference month, 3/6/12-month trend, isolation) | VERIFIED | `test:facility-comparison` (54 checks) |
| User Management (add/role/active/enable/disable/delete/last-admin/session revocation/audit) | STATIC/API VERIFIED | `test:web-clean-v1-admin-ui`, `test:api` (55, incl. `SELF_DEACTIVATION_NOT_ALLOWED`/`LAST_ADMIN`/audit-action assertions), `test:phase3` (127 authz assertions) |
| Facility context (bootstrap adapter, propagation to all views, no hardcoded IDs) | VERIFIED | `test:web-clean-v1-facility-context` (8), `test:facility-isolation` (15), `test:dashboard-facility-isolation` (13) |
| Theme (Light warm-beige, Dark contrast, all control types) | VERIFIED | Computed contrast test; Login's fixed-dark rationale confirmed at the mechanism level (theme only applies post-auth) |
| Responsive | STATIC VERIFIED | `sm:`/`md:`/`lg:`/`xl:` breakpoints present in `UniversalFilterBar`, `DashboardView`, `RackCapacityView` (mobile-first: base styles first, breakpoint overrides after, per project convention) |
| Live Supabase schema/RLS/row counts | NOT VERIFIED - EXTERNAL BLOCKER | MCP connector still cannot see `tofdgndrrpnnyhbuurbx` |
| Live browser UAT (all areas) | NOT VERIFIED - EXTERNAL BLOCKER | Chrome extension still not connected this session |

**Gate result: NON-EXPORT READY FOR EXPORT PHASE.**

Every non-Export area has real static/API/test evidence and zero known
open defects; the only remaining gaps (live Supabase state, live browser
rendering) are genuine external blockers explicitly carved out by this
gate's own instructions, not implementation gaps. No code changes were
made in this verification pass - it found no regression to fix.

## 2026-08-11 Dashboard + Rack Capacity implementation

Implemented per explicit instruction, Reports & Export explicitly excluded
from this pass.

**Dashboard - STATIC/API VERIFIED.** CleanWebApp's Dashboard previously
rendered only the Engineering-equivalent view (`DashboardSummary`) with no
Executive View and no way to reach it. Added a `DashboardView` wrapper that
reuses, unmodified, the same Electron-independent shared components Desktop
uses: `ExecutiveDashboard` (Whole Building vs 4th Floor electricity
consumption/cost comparison, energy/cost trend via `EngineeringTrendCharts`),
`SmartInsightPanel`, and `UniversalFilterBar` (Year/Period/Trend/Category/
UPS Group/Compare - all wired to the shared `ReportContext`, not decorative).
`Forecast` and `Energy Benchmarking` are **INTENTIONALLY REMOVED**, not a
gap: `UniversalFilterBar`'s own 4-view tab switcher was hard-coded to
always show all 4 views with no way to hide any; added an optional
`reportViews` prop (default: all 4, so Desktop's `App.tsx` call site is
completely unaffected) and CleanWebApp passes only
`["executive", "dashboard"]` - no dead tab, no unused route, no orphaned
component reference anywhere in the Web bundle.

Chart numeric labels (values shown directly, not hover-only): already
satisfied by reuse, no additional work needed. `TrendLineChart` (used by
`EngineeringTrendCharts`/`ExecutiveDashboard`) already draws direct SVG
`<text>` labels via the shared `formatNumber2` formatter.
`DashboardSummary` (Engineering View) has no chart library at all - it's
cards/tables, which are inherently always-visible, not hover-gated.

**Light theme contrast - a real, measured defect, fixed.** The
amber/emerald/purple/rose/sky/teal accent shades used across
`ExecutiveDashboard`/`SmartInsightPanel`/`UniversalFilterBar`/
`DashboardSummary` (status highlights, KPI deltas, icons) are tuned for
dark-theme legibility. Computed real WCAG contrast ratios (OKLCH -> sRGB ->
relative luminance, not estimated): every one measured 1.1-2.8:1 against
the light theme's `#f6f1e8` page background - effectively invisible.
Extended `html.theme-light`'s existing token-remap pattern (the same
mechanism already used for `--color-slate-*` and `--color-indigo-600/700`)
with WCAG AA-passing (>=6.3:1, computed) same-hue darker equivalents for
every shade actually used. Because Tailwind v4's color palette is
CSS-variable-driven here, this fixes every existing usage of these classes
app-wide with zero changes to individual components - not a hard-coded
color in a Dashboard file. New regression test
(`test:web-clean-v1-theme`) computes and asserts real contrast ratios for
every added token, not just presence, so a future edit can't silently
reintroduce unreadable text.

**Rack Capacity and Utilization - STATIC/API VERIFIED, upgraded from
CONFIRMED GAP.** Root cause (recorded in the earlier session below):
present at every layer except the Web UI - XLSM sheets, calculation engine
(`calculateRackCapacityMetrics`/`usagePercent`, both tested), and API
(`GET /racks`, `GET /rack-unit-capacity`) all existed; CleanWebApp had no
nav entry, no view, no fetch. Fixed: added a "Rack Capacity" nav entry and
a read-only `RackCapacityView`.
- Zone/status: reuses `RackCapacityProvider` + `RackCapacitySummaryCard`
  (zone table, donut, Zone Heatmap) verbatim - no second calculation
  implementation. A new `RackCapacityMonthSync` child syncs the context's
  page-local `reportingMonth` (used only for the Summary Card's header
  label; Desktop itself doesn't tie it to the app's global Reporting
  month either - it's genuinely page-local state there too) to the month
  actually fetched, so the header can never show a different month than
  the data underneath it.
- Rack Unit Capacity: a new, smaller summary card rather than reusing
  `RackUnitCapacitySummary` verbatim - that component needs a 12-month
  trend chart and a monthly image, neither backed by a bulk-history or
  image-storage API today. Showing them would mean either hammering the
  single-month endpoint 12+ times for data it wasn't designed to serve, or
  a permanently-empty section; documented here as a scope limitation
  instead of faked. All displayed values (Total/Used/Available/Usage%)
  come straight from the API's own precomputed output - nothing
  recomputed or invented in the UI.
- Deliberately read-only: the API only exposes GET for both endpoints (no
  create/edit route exists at all), matching the Rack Capacity Editor
  being explicitly out of scope for Web.
- Export wiring (`exports.ts`'s `rack: null`) deliberately left untouched
  - Reports & Export work is excluded from this pass per instruction.

Regression coverage added to `test-api-foundation.ts`: rack records reach
the DTO with correct derived metrics; a site with no rack snapshot returns
`null` (not an error, not another site's data) - covers facility
isolation for this endpoint. 55/55 API assertions pass (up from 53 after
the UPS History fix). All pre-existing suites (`domain-parity`,
`rack-capacity-metrics`, `rack-unit-capacity`, `rack-status-config`,
`display-period`, `air-validation`) still pass unchanged. `npm run lint`
and `npm run build` both clean throughout.

**Re-affirmed from earlier this session, not re-verified from scratch in
this pass** (see the relevant sections above/below for original evidence):
facility context adapter (`normalizeBootstrap`) intact; User Management
backend (last-admin protection, session revocation, audit logging) intact;
Data Entry field-driven-per-facility architecture (`meterFields` prop, not
hardcoded) intact; Rangsit (4 EB air fields) vs Srinakarin (6 EB43/EB44
fields) facility-specific configuration intact per `test:air-validation`.
No code changes were needed in these areas this pass because none were
found broken - re-stating "VERIFIED" here would not be based on new
evidence, so this session did not re-run live checks against them.

**Still NOT VERIFIED - EXTERNAL BLOCKER** (unchanged): live Supabase
schema/RLS/row-count verification (MCP still can't see
`tofdgndrrpnnyhbuurbx`); all live/interactive browser UAT (Chrome
extension still not connected this session) - Dashboard tab switching,
Rack Capacity rendering, filter interactivity, and the light theme fix
are all correct by source/computed-contrast/build evidence, not by having
been seen rendered in an actual browser.

## 2026-08-11 follow-up verification

Independently re-verified (not blindly trusted) against current repository
state, per a fresh audit request. Findings:

- **Root-caused the "Role selector / Active checkbox missing" report from the
  prior session**: not a build/deployment defect. Commit `130c9d4` ("fix:
  close clean v1 admin parity gap", 2026-08-10 21:13 +0700) added both
  controls plus `window.confirm()` guards for Disable/Delete in one diff.
  The specific Preview URL that prior session tested
  (`...i168yu5dk-dcm15.vercel.app`) was built from commit `bc6e087`, deployed
  57 minutes *before* that fix landed — a stale, superseded deployment
  snapshot, not a pipeline bug. Confirmed via three independent evidence
  layers: (1) `git show 130c9d4` diff, (2) `vercel inspect` deployment
  metadata for both the stale URL and current HEAD, (3) downloading and
  grepping the actual JS chunk (`CleanWebApp-*.js`) served by the live branch
  alias — it contains ` Active"` checkbox text, `aria-label:"Role"`, and both
  `window.confirm(\`Disable user...` / `window.confirm(\`Delete user...`
  strings verbatim. **Action for future sessions: always test against the
  branch alias (`energy-monitor-git-feat-web-clean-v1-dcm15.vercel.app`) or
  the newest deployment, never a pinned old preview URL.**
- **Repo hygiene / worktree consistency finding (new)**: the main repo
  worktree is checked out on `feat/web-v3` (a superseded branch — see below),
  and `.worktrees/web-clean-v1` is registered in that branch's tree as a git
  submodule gitlink pinned at commit `932395e`, 5 commits stale versus the
  actual `feat/web-clean-v1` HEAD (`db15dc0`). Does not affect the live
  Vercel deployment (Vercel builds straight from the GitHub branch, not
  through this gitlink), but a fresh clone of `feat/web-v3` would see the
  submodule 5 commits behind reality. Recommended fix: commit the updated
  gitlink on `feat/web-v3`. Not done automatically — requires explicit
  Product Owner instruction per `.claude/rules/git.md` ("commit unless
  explicitly instructed for that specific change").
- **Branch relationship clarified**: `feat/web-clean-v1` is not a divergent
  experiment. It equals `feat/web-v3` HEAD minus one trivial commit
  (`19b78b9`, env/docs only — note: that commit also accidentally committed
  Electron e2e cache junk, `.tmp-e2e-electron-data3/...`, a separate minor
  hygiene defect on `feat/web-v3`) plus 10 commits that fully replace the old
  dual `WebV3App`/`WebV3SettingsApp` routing with the single unified
  `CleanWebApp`. `feat/web-clean-v1` is the current leading implementation.
  `main` (and Production, `energy-monitor-dcm15.vercel.app`) remains on the
  Desktop-only baseline (`12fcdc7`) — correctly untouched.
- **Desktop GUI verified for real** (previously "no GUI automation was
  available"). Launched the packaged `Energy Monitor-v2.3.1.exe` from an
  isolated scratch copy (never the authoritative release folder — its
  `config/config.json` had `lastWorkbookPath` pointing at the real file with
  `startupBehavior: "last"`; packaged builds resolve their app root to
  `path.dirname(process.execPath)` and ignore `ENERGY_MONITOR_APP_ROOT`
  entirely, so isolation required copying the whole folder and repointing
  the copy's own config before launch). Connected via Chrome DevTools
  Protocol (`--remote-debugging-port`): the app renders fully — Dashboard
  Summary, Data Entry Sheet, Rack Capacity, Historical Logs, Site Comparison,
  Reports & Export, Settings nav all present; Rangsit facility loaded with
  correct UPS groups; zero JS exceptions.
- **XLSM inventory independently re-derived** (not just cited from the prior
  audit) against the same isolated release-folder copies, using the app's
  own `readWorkbookFromFile()` reader plus a structural ExcelJS inspection.
  Sheet counts (12/22), hidden-sheet counts (2/2), and log-row counts (67/67)
  are **exact matches** to the prior audit. Table counts (6 vs. reported 4 on
  Rangsit; 15 vs. reported 17 on Srinakarin) and formula-cell counts (141 vs.
  122; 550 vs. 530) differ — most likely counting-methodology differences
  (how each tool enumerates Excel Tables / detects formula vs. cached-value
  cells), not evidence of a different or corrupted workbook, since sheet
  names/hidden state/log counts match exactly. Also got a genuine
  calculation-parity data point: the app's `calculateEnergyCostForMonth()`
  output matches Srinakarin's cached Dashboard-FAC Excel formula values
  within 0.01 for month 2026-07.
- **Theme (Phase 15) confirmed at the token level, not just visually
  asserted**: `src/index.css`'s `html.theme-light` block matches the given
  spec exactly, byte-for-byte — `--color-bg:#f6f1e8`, `--color-surface:
  #ffffff`, `--color-surface-elevated:#faf7f1`, `--color-text:#333333`,
  `--color-text-muted:#666666`, `--color-border:#e3ded5`,
  `--color-primary:#e00000`, `--color-secondary:#007ad0`. The app uses
  Tailwind v4's CSS-variable-based palette (no separate `tailwind.config.ts`
  — colors defined via `@theme`/`:root` in `index.css`), so utility classes
  like `bg-slate-950`/`text-slate-100` used throughout the authenticated app
  shell are theme-reactive, not hardcoded-dark. The Login screen legitimately
  always renders the dark `:root` defaults because theme is only ever
  applied in a `useEffect` gated on `[user]` (theme storage key is
  per-authenticated-user) — confirming the prior audit's "Login contrast not
  actually broken" conclusion at the mechanism level, not just by visual
  spot-check. `npm run test:web-clean-v1-theme` passes.
- **User Management backend (Phase 14) code-reviewed**: `setUserActive`,
  `setUserRole`, and `deleteUser` in `server/auth/repository.ts` all take an
  advisory Postgres lock and check the remaining active-admin count before
  proceeding, throwing `HttpError(409, "LAST_ADMIN", ...)` if the action
  would leave zero active admins. `setUserActive(false)` and
  `resetUserPassword` both call `revokeAllSessions()` and write an
  `SESSION_REVOKED_ALL` audit row. All five admin mutations write an audit
  row. **Minor gap found**: `deleteUser` does not explicitly call
  `revokeAllSessions()` before deleting the row (unlike deactivate/reset) —
  likely harmless since a deleted user's session lookup will fail on the
  next request regardless, but it means no explicit `SESSION_REVOKED_ALL`
  audit entry is written on delete. Worth a defense-in-depth fix; not a
  security hole today. See Priority gates below.
- **Calculation-parity regression suites re-run for real** (not just cited):
  all pass against the current worktree, none require Supabase or a browser.
  - `test:domain-parity` — 24 assertions against
    `tests/golden/desktop-v2.3.1.expected.json`, covering
    `buildEngineeringDashboardSnapshot`, `calculateEnergyCostForMonth`,
    `buildFacilityComparisonMetrics`, `calculateRackCapacityMetrics`,
    `computeUpsGroupSummary` — the shared calculation engine explicitly
    declares `formula=desktop-v2.3.1` compatibility.
  - `test:rack-capacity-metrics`, `test:rack-unit-capacity`,
    `test:rack-status-config` — all pass; `test:rack-unit-capacity`
    self-asserts the real `DC_Rangsit.xlsm`/`DC_Srinakarin.xlsm` at repo
    root were untouched by the run.
  - `test:display-period` — 10 assertions on the display-period policy
    (`allowedMonths`, `enumerateMonths`, `isAllowedMonth`, etc.).
  - `test:air-validation` — confirms Rangsit's EB41-only fields and
    Srinakarin's EB43/EB44 meters persist correctly and stale keys are
    ignored, matching the per-facility air-field counts found in
    `config/rangsit/profile.json` (4 fields) and
    `config/srinakarin/profile.json` (6 fields) inside the Desktop release.
- **New external blockers found this session** (in addition to the
  pre-existing Supabase one): the Chrome browser extension (`claude-in-chrome`)
  is not connected in this session, blocking all live/interactive browser
  UAT (Phases 9-14, 19). The Supabase MCP connector in this session exposes
  only two unrelated projects (`lhlzzxjayywqhqtjzfiu`,
  `rohmbjqnyekvxpyydjbn`), not `tofdgndrrpnnyhbuurbx` — same blocker as the
  prior audit, not yet resolved despite a request to connect it.

## 2026-08-11 repository consolidation + API/export parity pass

Per explicit instruction, the repository was consolidated to a single
canonical line before continuing parity work:

- **Canonical branch determined**: `feat/web-clean-v1`. Confirmed (again)
  via `vercel inspect` that every recent Preview deployment and the stable
  branch alias build from `feat/web-clean-v1`, never `feat/web-v3`.
- **`.worktrees/web-clean-v1` gitlink fully untracked** (not just
  repointed): it was an accidental artifact of `19b78b9`'s broad `git add`
  (no `.gitmodules`, didn't exist on `feat/web-clean-v1` or `main`), not an
  intentional submodule. `git rm --cached` + `.gitignore` entry, on both
  branches before consolidation.
- **`feat/web-v3` retired**: its one unique commit (`19b78b9`) contained two
  substantive, non-junk changes - a `.claude/workflow.md` Desktop-release
  workflow doc, and an `.env.example` clarification about the correct
  Supabase Transaction Pooler (6543) / NOBYPASSRLS role configuration for
  `DATABASE_URL`. Both were manually ported to `feat/web-clean-v1` (not
  cherry-picked, since the source commit also carried accidentally-committed
  Electron e2e cache junk). The gitlink-fix commits were superseded by the
  untrack fix and carried no other value. Local `feat/web-v3` branch deleted
  after verifying zero unique work remained (`git merge-base
  --is-ancestor` confirmed divergence; content review confirmed nothing
  else was unique). Remote `origin/feat/web-v3` left untouched, per
  instruction. The `.worktrees/web-clean-v1` linked worktree was removed and
  `feat/web-clean-v1` checked out directly in the main working directory -
  one branch, one working tree, no worktree split. `npm run lint` and
  `npm run build` both pass cleanly post-reorg. All local commits from this
  consolidation remain unpushed pending review.

**API contract / DTO parity review** (static, source-level):

- The previously-fixed bootstrap adapter is intact and verified
  server-to-client end to end: `apiService.bootstrap()` returns
  `sites: [{ site, availableMonths, latestAvailableMonth }, ...]`;
  `facilityContext.ts`'s `normalizeBootstrap()` flattens exactly that shape
  into `FacilitySite[]`. No regression.
- Full server route inventory (`server/http/app.ts`) cross-referenced
  against every `api()` call actually made in `CleanWebApp.tsx` (the entire
  frontend). CleanWebApp only ever calls: `/auth/*`, `/bootstrap`,
  `/sites/:id/history`, `/sites/:id/periods/:month` (GET+PUT),
  `/site-comparison`, `/settings/display-period`, `/admin/users` (+
  subpaths). **8 server routes are never called by CleanWebApp**:
  `/dashboard`, `/energy`, `/cost`, `/electrical`, `/periods`, `/sites`,
  `/racks`, `/rack-unit-capacity`. Not a defect by itself (CleanWebApp
  fetches full history and aggregates client-side via
  `buildEngineeringDashboardSnapshot`/`DashboardSummary` instead), but see
  the Rack Capacity finding below - two of those unused routes are exactly
  the ones a Rack Capacity screen would need.
- All read/write handlers route through the same domain calculation
  functions already verified against the Desktop v2.3.1 golden fixture
  (`calculateEnergyCostForMonth`, `buildFacilityComparisonMetrics`,
  `calculateRackCapacityMetrics`, `usagePercent`) - real structural evidence
  for calculation parity at the API layer, not just the fixture-test layer.

**Major finding - Rack Capacity and Utilization is entirely absent from
the Web UI** (P1, cross-verified at four independent layers):

1. Desktop's nav has a dedicated "Rack Capacity and Utilization" section
   (confirmed live via CDP in this session).
2. The XLSM has dedicated sheets for it (Rangsit: Rack Capacity, 382 rows;
   Srinakarin: Rack Capacity 261 rows + Rack Unit Capacity 8 rows + Rack
   Capacity History 5 rows - all independently inventoried this session).
3. The calculation engine already has `calculateRackCapacityMetrics()` and
   `usagePercent()`, both passing their regression tests this session
   (`test:rack-capacity-metrics`, `test:rack-unit-capacity`), and the API
   already exposes working `/api/v1/racks` and `/api/v1/rack-unit-capacity`
   endpoints.
4. `CleanWebApp.tsx`'s nav has exactly 7 views (dashboard, entry, history,
   comparison, reports, settings, admin) - no rack view, confirmed by
   reading the full 193-line file (the only "rack" substring hits were
   false positives on `tracking-wide`/`tracking-tight` CSS classes). The
   shared PDF report type (`ReportData`, used by the Desktop-compatible
   `buildReportHtml()` renderer) has typed fields for `rack`, `rackHistory`,
   `rackUnitCapacity`, `rackComparison` - `exports.ts` always populates them
   with `null`/`[]` because there's no UI screen feeding real data in.

Every layer below the UI is ready; only the CleanWebApp screen (and its
data-fetching wiring to the already-working `/racks`/`/rack-unit-capacity`
endpoints) is missing. This is the single largest functional gap found in
this audit.

**Export architecture review**: sound. `exportCsv`/`exportExcel` (current
facility), `exportAllFacilitiesCsv`/`exportAllFacilitiesExcel` (all
facilities, independent sections per facility), and the comparison
exports all reuse `buildCombinedCsv`/`buildSectionCsvs` and the same
verified `calculateEnergyCostForMonth` engine. All three PDF paths
(`printDesktopPdf`, `printSiteComparisonPdf`, `printAllFacilitiesPdf`) go
through the same `buildReportHtml()` Desktop-compatible renderer via a
`window.open()` + `print()` popup pattern - structurally sound, but actual
rendered PDF content/print-dialog behavior remains NOT VERIFIED (requires
a live browser).

## 2026-08-11 UPS Group History fix (P1)

**Symptom**: History > UPS tab always showed an empty state
("No UPS Group History is available..."), regardless of actual data.

**Root cause**: NOT a naming/mapping mismatch. The Postgres table
`public.ups_group_history` (migration `007_ups_group_history.sql`) was
created with correct RLS/grants, but nothing else in the stack ever read
it - `BackendRepository` had no method for it, `server/http/app.ts` had no
route/field exposing it, and `CleanWebApp.tsx` never passed the optional
`upsGroupHistory` prop to the shared `HistoricalExplorer` component at
all. The empty-state branch (`!upsGroupHistory || rows.length === 0`) was
therefore always taken, independent of what the database actually held.

**Desktop/XLSM evidence**: both workbooks have a real "2. UPS Group
History" sheet (Rangsit 269 rows, Srinakarin 346 rows, per this session's
inventory) that Desktop persists and reads via
`src/reports/upsGroupHistoryReader.ts`; the DB table was explicitly
created to retain this same data ("Desktop v2.3.1 parity: retain the
workbook's persisted '2. UPS Group History' rows").

**Fix**: added `getUpsGroupHistory(siteId)` to `BackendRepository`
(Postgres: real query against `public.ups_group_history`; in-memory: test
double), folded the result into the existing `GET /sites/:id/history`
response scoped to the same visible-months set as `logs` (so Display
Period filtering applies identically - a row outside the period is
filtered, not reported as missing), and wired `CleanWebApp.tsx` to pass it
through. Fixed a leftover workbook-specific Thai string (English was
already fixed previously). Deliberately did not pass `activeFacilityId` -
the query already scopes by `site_id` server-side; guessing a
facility-string risked silently re-hiding correctly-scoped data.

**Regression tests** (`scripts/test-api-foundation.ts`): valid group
mapping, exact DTO field names, Display-Period filtering, facility
isolation (site 2 fixture has zero UPS Group History rows and never sees
site 1's), and the genuinely-empty case. 53/53 API assertions pass (up
from 48). `npm run lint` and `npm run build` both clean.

**Remaining - NOT VERIFIED / EXTERNAL BLOCKER**: whether
`public.ups_group_history` actually contains migrated production rows
today is unknown (Supabase MCP access still blocked); live browser UAT of
the History > UPS tab rendering is unverified (Chrome extension still not
connected). The fix makes the read path correct either way - if the table
is empty, the UI will now correctly say so for the right reason, instead
of unconditionally.

## Scope and evidence

Authoritative Desktop package:

- D:\Project\Energy_Monitor\release\Energy Monitor-v2.3.1
- package executable: Energy Monitor-v2.3.1.exe
- package workbooks: DC_Rangsit.xlsm, DC_Srinakarin.xlsm

Authoritative Web source:

- branch: feat/web-clean-v1
- committed baseline audited: d10a058
- Admin UI parity fix is committed and deployed through the Git-connected Preview
  deployment
- Web entry point: src/main.tsx selects src/web-clean-v1/CleanWebApp.tsx for HTTP(S) runtime
- Vercel build: npm run vercel-build, with server/vercel/handler.ts bundled to api/runtime.js

Preview evidence:

- https://energy-monitor-recnrdyld-dcm15.vercel.app/
- branch alias: https://energy-monitor-git-feat-web-clean-v1-dcm15.vercel.app
- /api/v1/health 200
- /api/v1/readiness 200
- anonymous /api/v1/auth/session 200 with authenticated:false
- deployment metadata: Git commit d10a058 on feat/web-clean-v1, state READY
- direct Preview asset inspection confirms deployed source is Clean-v1 and write-enabled

Supabase evidence is currently blocked. Every read-only connector call for
tofdgndrrpnnyhbuurbx returns:

MCP error -32600: You do not have permission to perform this action

No database query or mutation was performed during this audit.

## Desktop/XLSM inventory

The packaged workbooks load successfully through the repository reader and
validate structurally. Both contain xl/vbaProject.bin; no workbook was
modified.

| Workbook | Sheets | Hidden sheets | Tables | Formula cells | Formula errors | Logs | First month | Last month | Rack rows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| DC_Rangsit.xlsm | 12 | 2 | 4 | 122 | 0 | 67 | 2020-12 | 2026-06 | 358 |
| DC_Srinakarin.xlsm | 22 | 2 | 17 | 530 | 0 | 67 | 2021-01 | 2026-07 | 237 |

Notable source structures:

- Rangsit: Dashboard-FAC, 1. UPS Data Log, Air, DC, 4. Electricity Cost Log,
  PPC-Mapping, Rack Capacity, 2. UPS Group History, hidden
  Month-Pick/Cal-UPS LOAD.
- Srinakarin: phase-level UPS/PPC sheets, average/aggregate sheets,
  Dashboard-FAC, Air, DC, 4. Electricity Cost Log, PPC-Mapping,
  Rack Capacity, Rack Unit Capacity, Rack Capacity History, UPS group
  history, hidden Month-Pick/Cal-UPS LOAD.
- The Rangsit reader reports historical UPS rows missing for months
  2020-12 through 2025-12; this is recorded as source-data completeness,
  not filled or inferred.
- The packaged Srinakarin workbook loads and reads, but the save-formatting
  regression cannot complete because its 2026-07 PPC43 average/current cache is
  incomplete. The writer rejects this explicitly. No value was invented or
  written to the release workbook.

The packaged executable was launched in a controlled diagnostic run. It
remained responsive and logged startup plus Rangsit workbook open; no GUI
automation was available in this session, so pixel-level Desktop screenshots
remain unverified.

## Parity matrix

Legend: PASS = objective source/test evidence; PARTIAL = implementation exists
but one side or an external dependency remains unverified; BLOCKED = requires
external permission or owner-driven UAT; GAP = defect requiring a fix.

| Area | Desktop source of truth | Clean-v1 evidence | Status | Gap / action |
| --- | --- | --- | --- | --- |
| Facility context | packaged facilities.json and per-facility profiles/workbooks | bootstrap returns scoped sites; facility-context test (8 assertions) | PASS | Keep site id in every history/month/save request |
| Display period | Desktop globalDataDisplayPeriod defaults to 2026 | Admin-only settings UI and policy/API tests; no historical rows deleted | PASS | Do not change shared period during UAT |
| Dashboard | Dashboard-FAC, profile-driven UPS groups/mapping | DashboardSummary + domain parity test (24 assertions) | PASS | Remote data parity still needs Supabase read access |
| Data entry/save | workbook section readers/writer and row validation | Clean form writes PUT /sites/:id/periods/:month; API tests cover row version and validation | PARTIAL | Authenticated real-user save still owner-driven; packaged Srinakarin 2026-07 source cache needs valid PPC43 readings before Desktop save parity can be called complete |
| History | workbook monthly logs and group history | HistoricalExplorer consumes scoped history DTO | PARTIAL | Verify exact remote months after connector access restored |
| Site comparison | Desktop comparison uses each facility workbook independently | /site-comparison, SiteComparison, comparison export helpers and facility isolation tests | PASS | Verify values against remote DB and Desktop sample month |
| Current facility export | Desktop report/CSV/XLSX/PDF renderer | Clean CSV/XLSX/PDF print path and export test (7 assertions) | PASS | Browser download/print requires authenticated UAT |
| All facilities export | one report per facility with independent workbook data | Clean loads each facility history and emits separated CSV/XLSX/PDF sections | PASS | Verify every facility returned by bootstrap |
| Comparison export | comparison KPIs and trend values | Clean comparison CSV/XLSX/PDF print path | PASS | Verify same reference month and numeric formatting |
| Admin role assignment | Desktop user management scope | API supports role; deployed Clean UI exposes Role selector and sends role | PASS | Authenticated UAT still required |
| Admin active state | Desktop user management scope | API supports active flag; deployed Clean UI exposes checkbox and enable/disable guards | PASS | Authenticated UAT still required |
| Delete safeguards | no destructive action without confirmation | deployed Clean UI confirms delete/disable; backend protects last active admin | PASS | Never test against previewuat |
| Reset password | server policy, session revocation, audit | API tests cover reset, old password/session revocation | PASS | Real UAT needs owner-controlled credentials |
| Theme | Desktop light/dark setting | Settings-only theme controls, semantic tokens, dark/light visual audit and theme test | PASS | No header theme switcher |
| Security/RBAC | authenticated workbook operations | auth/security/API tests pass; no service-role key in Clean source | PASS | Supabase connector permission prevents remote RLS audit |
| Database schema/RLS | workbook data migrated to actual project | local migrations and repository contracts available | BLOCKED | Restore Supabase MCP read permission before schema claims |
| Rack Capacity/Utilization | dedicated Desktop nav section; XLSM Rack Capacity/Rack Unit Capacity/Rack Capacity History sheets | Read-only Rack Capacity view added 2026-08-11: nav entry, zone/status via reused `RackCapacitySummaryCard`, Rack Unit Capacity summary via new lightweight card, both fed by the existing API | STATIC/API VERIFIED | Editor (create/edit racks) and Rack Unit Capacity 12-month trend/image remain out of scope - no corresponding API. Export wiring (`rack: null`) deliberately deferred to the Export phase. Live browser UAT NOT VERIFIED |
| Dashboard - Executive View | Desktop `ExecutiveDashboard` (Whole Building vs 4th Floor electricity/cost comparison, trend) | Added 2026-08-11, component reused verbatim | STATIC/API VERIFIED | Live browser UAT NOT VERIFIED |
| Dashboard - Engineering View | Desktop `DashboardSummary` (detailed operational KPIs) | Already present, unchanged | PASS (pre-existing) | - |
| Dashboard - Forecast/Benchmark | Desktop-only `ForecastDashboard`/`BenchmarkDashboard` | Not implemented; `UniversalFilterBar`'s tab switcher restricted to Executive/Engineering only via new `reportViews` prop | INTENTIONAL DIFFERENCE | Not a defect - explicit scope exclusion |
| API surface | Desktop's per-metric drilldown (Energy/Cost/Electrical pages) | `/dashboard`, `/energy`, `/cost`, `/electrical`, `/periods`, `/sites` are implemented server-side but never called by CleanWebApp (it fetches full history and aggregates client-side instead) | NOT APPLICABLE | Likely legacy from the superseded WebV3App; confirm intentional before ever deleting - not a defect for CleanWebApp today |

## Priority gates

### P0

- Restore Supabase MCP access scoped to project tofdgndrrpnnyhbuurbx (as of
  2026-08-11 the connector exposes two unrelated projects instead).
  Verify remote migrations, tables, RLS, policies, display-period row, sites,
  and historical data. Do not apply migrations while access is unresolved.
- Reconnect the Chrome browser extension (`claude-in-chrome`) for this
  session — required for any live/interactive Preview UAT (login, facility
  isolation click-through, save/refresh, exports, Admin CRUD).

### P1

- Complete owner-driven authenticated Preview UAT:
  login, save/refresh, history, comparison, all export formats, logout/login,
  and Admin add/disable/enable/reset/delete using a clearly named temporary
  account. Do not use or modify previewuat.
- Compare one identical facility/month across XLSM, API, Web dashboard, and
  each export.
- Resolve packaged Srinakarin 2026-07 PPC43 source completeness with valid
  owner-provided readings, or explicitly accept that source limitation. Do not
  synthesize readings.
- ~~Commit the corrected `.worktrees/web-clean-v1` submodule gitlink on
  `feat/web-v3`~~ Done 2026-08-11: fully untracked (not just repointed) on
  both branches; `feat/web-v3` retired entirely after its two substantive
  changes were ported. See the 2026-08-11 consolidation section above.
- ~~Build a Rack Capacity/Utilization view in CleanWebApp~~ Done
  2026-08-11 (read-only zone/status + Rack Unit Capacity summary). Still
  open: wire the `rack`/`rackHistory`/`rackUnitCapacity`/`rackComparison`
  fields in `exports.ts` (currently always null/empty) - deferred to the
  Reports & Export phase, not attempted yet per instruction.
- ~~Add a Dashboard Executive View~~ Done 2026-08-11.

### P2

- `deleteUser` in `server/auth/repository.ts` does not explicitly call
  `revokeAllSessions()` / write a `SESSION_REVOKED_ALL` audit row before
  deleting a user, unlike deactivate and password-reset. Likely harmless
  (session lookup fails once the user row is gone) but inconsistent with the
  other two mutations' explicit revoke-and-audit pattern.
- Clean up the Electron e2e cache junk (`.tmp-e2e-electron-data3/...`)
  accidentally committed on `feat/web-v3` in `19b78b9`.
- Reconcile the table-count/formula-cell-count methodology difference
  between this session's ExcelJS-based inventory and the prior audit's
  numbers (see 2026-08-11 section above) if an exact canonical count is
  ever needed.
- Reconcile any source-data completeness differences found by the remote
  historical audit; never invent missing readings.

## Current release decision

Preview is not Production-ready yet. Remaining blockers:

1. Supabase connector access scoped to the actual project
   (tofdgndrrpnnyhbuurbx) for schema/RLS/data-completeness verification;
2. Chrome browser extension connection, for live authenticated Preview UAT;
3. owner-controlled credentials for a temporary UAT account (never
   previewuat).

Production remains untouched.
