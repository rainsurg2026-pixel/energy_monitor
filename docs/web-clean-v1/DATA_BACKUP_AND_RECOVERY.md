# Data Storage, Backup, and Recovery

Written 2026-08-11, updated 2026-08-11 (Admin-configurable backup
destination). Covers the CleanWebApp (`feat/web-clean-v1`) data
architecture: where user-entered data lives, how it is backed up, and how
to recover it. Read alongside `docs/web-clean-v1/DESKTOP_WEB_PARITY_AUDIT.md`.

## 1. Database as Source of Truth

Supabase/PostgreSQL is, and remains, the system's **only** Source of Truth
for user-entered operational data. Nothing in this document changes that.
Google Sheets (Section 3) is a downstream backup/recovery copy only - it is
never read back into Supabase, and the application never depends on Sheets
being available or correct.

## 2. User-entered data storage

This schema already existed before this session (`db/migrations/001_phase2_foundation.sql`)
and was not duplicated or redesigned - only inspected and confirmed:

| Concern | Table(s) |
| --- | --- |
| Facility/site identity | `sites`, `site_profiles`, `electrical_profiles` |
| Device/meter master data | `devices`, `air_meters`, `dc_panels`, `ups_groups`, `ups_group_members` |
| One record per site+month, with optimistic-concurrency `row_version` | `monthly_periods` |
| Authoritative raw operational readings | `ups_readings`, `air_meter_readings`, `dc_readings`, `electrical_phase_readings`, `energy_cost_inputs` |
| Rack Capacity | `rack_capacity_snapshots`, `rack_assets`, `rack_capacity_records`, `rack_unit_capacity_snapshots`, `rack_unit_capacity_images` |
| Global Display Period | `global_settings` |
| UPS Group History (fixed 2026-08-11, see the parity audit) | `ups_group_history` |
| Data provenance / source tracking | `provenance_records`, `migration_batches`, `migration_errors`, `legacy_cached_evidence` |
| Calculation results (for audit/debugging, not authoritative) | `calculation_runs`, `calculation_output_values` |

**No new operational-data tables were created this session.** The write path
(`server/db/postgresRepository.ts`'s `saveMonthlyLog`) already writes to the
correct normalized tables inside a single transaction, keyed by `period_id`.

## 3. Data audit trail (already existed, verified not rebuilt)

`audit_events` (id, actor_type, actor_user_id, occurred_at, action,
entity_type, entity_id, previous_value, new_value, correlation_id) already
existed and is already written by every operational-data save
(`saveMonthlyLog`) and every Global Display Period change
(`updateGlobalSettings`), with the acting user's ID, a before/after JSON
snapshot including `row_version`, and a correlation ID. This answers
WHO/WHAT/WHEN for every change without a second audit system.

## 4. Google Sheets backup architecture

New this session (`server/backup/`). Distinct from, and does not touch or
duplicate, the existing per-user OAuth Google Sheets integration
(`src/sheetsService.ts`, `src/googleSheetsDriver.ts`,
`src/data/GoogleSheetsProvider.ts`, migration `004_google_sheets_oauth.sql`)
- that is a separate, pre-existing Desktop feature letting an individual
user connect their own Google account, unrelated to system backup.

```
Admin clicks "Backup Now"           Vercel Cron (daily, 00:00 GMT+7)
        |                                    |
        v                                    v
POST /api/v1/admin/backup/run      POST /api/v1/cron/backup
  (session + backupRestoreManage)    (CRON_SECRET bearer only)
        \                                   /
         \                                 /
          v                               v
              server/backup/backupService.ts
                          |
        reads authoritative data via the EXISTING
        BackendRepository (listSites, listPeriods,
        getMonthlyLogs) - no new/duplicate queries
                          |
        server-side JWT service-account auth (jose,
        already a dependency - reused, not added)
                          |
              Google Sheets API v4 (REST, fetch)
                          |
              logs the run to public.backup_log
```

Google API calls happen exclusively in `server/backup/`, executed
server-side. The browser never sees a Google credential, access token, or
service-account key at any point.

### 4.1 Backup destination is Admin-configurable (added 2026-08-11)

The backup **destination** (which Google Sheet) and the backup
**credential** (the service account that can write to it) are two
separate concerns, stored two different ways:

| Concern | Where it lives | Who can see/change it |
| --- | --- | --- |
| Destination (`spreadsheet_id`, `sheet_url`, `enabled`) | `public.backup_config` (DB, migration `009_backup_config.sql`) - a singleton row, same pattern as `global_settings` | Admin, via Settings -> Data Backup or the API; never a secret, safe to store in the DB |
| Credential (`GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON`) | Server environment variable only | Never leaves the server process; never read by, or written through, any API route |

`server/backup/googleSheetsUrl.ts` is the single place a pasted Google
Sheets URL becomes a trusted spreadsheet ID: it requires `https:` and
`docs.google.com`, matches `/spreadsheets/d/<ID>/...`, and validates the ID
against the shape of a real Google spreadsheet ID (20-100
`[a-zA-Z0-9_-]` characters). The browser can only ever submit a URL - the
ID used for every Google API call is always the one this function
extracted server-side, never a value read directly off the request body.
`maskSpreadsheetId()` produces the only spreadsheet-identifying string the
browser or `audit_events` ever receives (e.g. `1Bx…9Q7z`), never the full
ID or URL with query parameters.

## 5. Manual backup vs. scheduled backup

- **Manual**: Admin -> Settings -> Data Backup -> "Backup Now" ->
  `POST /api/v1/admin/backup/run`, gated by the existing
  `backupRestoreManage` permission (already defined in `authz/permissions.ts`
  before this session - reused, not invented). Always runs against
  whichever destination is currently saved in `backup_config`, read fresh
  at the start of `runBackup()` - never a value cached from an earlier
  request. A manual run always attempts to write, even if the destination
  is currently marked "disabled" (disabled only skips the *scheduled* run,
  since an Admin clicking "Backup Now" is an explicit, one-off request).
- **Scheduled**: `vercel.json`'s `crons` entry calls
  `POST /api/v1/cron/backup` daily at `0 17 * * *` UTC (00:00 GMT+7,
  matching the existing daily-at-00:00-GMT+7 scheduling convention already
  used elsewhere in this codebase). Authenticated by `CRON_SECRET` as a
  bearer token - Vercel's documented convention for securing cron
  endpoints - never a user session. This route is explicitly exempted from
  the global CSRF middleware and from `READ_ONLY_MODE`'s mutation block
  (backup reads data and writes only to Sheets/backup_log, never to
  operational tables). Like the manual path, it reads `backup_config` fresh
  on every invocation - changing the destination in Settings -> Data
  Backup takes effect on the very next scheduled run, with **no code
  change or redeploy**. If the destination is disabled, the scheduled run
  logs a `success` entry with 0 records and an explanatory
  `error_summary` ("Scheduled backup skipped: disabled...") rather than
  silently doing nothing or reporting a failure.

Default schedule: **daily**, per the task's own recommendation. Not yet
configurable per-admin; changing the time means editing `vercel.json`. The
*destination* (Section 4.1), unlike the schedule, is fully Admin-configurable
without a deploy.

## 6. Backup does not block Data Entry

`saveMonthlyLog` and `runBackup` are entirely independent code paths - the
API route for saving a month's data (`PUT /sites/:id/periods/:month`) never
calls, awaits, or depends on the backup service in any way. A user's save
completes and returns 200 regardless of whether Google Sheets is reachable,
configured, or even exists as a concept to that request. Backup status is
observed later, separately, via the admin panel.

## 7. Backup status and configuration (Admin UI)

Settings -> Data Backup (visible only when `isAdmin`) now has two parts:

- **Configuration form**: an Enabled toggle, a Google Sheet URL field
  (pre-filled from `backup_config`), "Test Connection", and "Save
  Settings". Saving calls `PUT /api/v1/admin/backup/config`, which
  re-validates and re-extracts the spreadsheet ID server-side (Section
  4.1) before ever writing it - an unusable URL is rejected with `400
  INVALID_SHEET_URL` and never saved. "Test Connection" calls
  `POST /api/v1/admin/backup/test-connection`, which authenticates with
  the server-side service account, confirms the spreadsheet is reachable,
  and ensures the two required tabs (`Data_Backup`, `Backup_Log`) exist or
  can be created - all without writing any backup data - and reports one
  of: connected (with the real spreadsheet title, the only Google-supplied
  string ever shown to the browser), invalid URL, spreadsheet not
  accessible, service account lacks access ("Please share this Google
  Sheet with the configured backup service account" - the app never
  attempts to change Google sharing permissions itself), or Google
  authentication failed (no server credential configured).
- **Status display**: whether the destination is enabled, the last run's
  timestamp/status/record count, the schedule, a "Backup Now" button, and
  the 10 most recent runs. On failure, the recorded `error_summary` is
  shown (e.g. "Google API unavailable") - never a raw stack trace or
  credential-containing error string, since `server/backup/*` truncates
  and only ever throws `Error` messages built from HTTP status + a
  truncated response body, never a caught credential value.

Both parts are gated by the same `backupRestoreManage` permission
server-side (`GET /status`, `PUT /config`, `POST /test-connection`,
`POST /run` all call `withPermission`) - a `user`-role session gets `403
FORBIDDEN` from every one of these routes even called directly, not just a
hidden button in the UI.

## 8. Backup logging

`public.backup_log` (migration `008_backup_log.sql`): `id`, `backup_type`
(`scheduled`|`manual`), `status` (`running`|`success`|`partial`|`failed`),
`started_at`, `completed_at`, `records_processed`, `records_success`,
`records_failed`, `error_summary`, `initiated_by` (nullable FK to `users`,
null for scheduled runs). A dedicated table, not folded into the generic
`audit_events` shape - a backup run's fields (record counts, a single
overall status, a start/complete pair) don't fit `audit_events`'
before/after-value model for a single entity change, and forcing it in
would have made both harder to query.

## 9. Backup data scope and format: snapshot, not append-only

**Data_Backup** sheet: one row per (facility, month, section, field,
metric) - a flattened long-format table covering the same UPS/Air/DC/Energy
readings that `saveMonthlyLog` persists. Each backup run **overwrites**
this sheet's content with a fresh snapshot (clear, then write) rather than
appending a new copy of every record on every run.

This was a deliberate choice, not the default: the task instructions
explicitly asked to inspect actual data volume before choosing append-only
vs. snapshot, and to document the decision. **Live data volume could not be
inspected this session** (Supabase MCP access remains blocked - see
Section 14) - so this is the practical default given that constraint, not
a volume-informed decision. Rationale: an append-only design that writes
every reading on every daily run would grow the sheet by its full record
count every single day indefinitely, which risks exactly the "millions of
duplicated rows" outcome the instructions warned against, for a use case
(daily reporting-period backups) that doesn't need row-level history in
the backup layer - point-in-time recovery is already available via Google
Sheets' own built-in Version History (File -> Version history), which a
snapshot-per-run approach benefits from "for free," and via `backup_log`'s
own row-per-run record for identifying which historical version corresponds
to which run. If actual production volume, once inspectable, turns out to
need row-level backup history, that is a schema/format change to
`Data_Backup`'s writer, not a change to this architecture.

**Backup_Log** sheet: genuinely append-only (`appendBackupLogRow`) - one
row per completed run, mirroring `public.backup_log`. This one really is a
revision log, because each row represents a distinct event (a backup run),
not a snapshot of mutable current state.

## 10. Google Sheet structure

A dedicated spreadsheet, chosen by an Admin via Settings -> Data Backup
(Section 4.1 - `backup_config.spreadsheet_id`, no longer a fixed env var),
never mixed into any operational/user-facing spreadsheet:

- `Data_Backup` - current snapshot of authoritative operational data.
- `Backup_Log` - append-only run history.

`testBackupConnection()` and `runBackup()` both create either sheet if it
doesn't already exist in the configured spreadsheet (`ensureSheetsExist`),
so pointing the backup at a brand-new, otherwise-empty Google Sheet works
without any manual sheet-tab setup - only sharing the spreadsheet with the
service account is required of the Admin.

### 10.1 Changing the destination (Sheet A -> Sheet B)

Saving a new URL only updates the single `backup_config` row - it never
touches the previously configured spreadsheet:

- The next "Backup Now" and the next scheduled run both write to B.
- A is never automatically modified or deleted; its last-written
  `Data_Backup` snapshot and full `Backup_Log` history remain exactly as
  they were.
- Every `backup_log` row (both DB and the `Backup_Log` sheet) records
  which spreadsheet it was written to (`spreadsheet_id`, added to
  `backup_log` by migration `009_backup_config.sql`), so the run history
  makes the A -> B switch point visible after the fact.
- The change itself is audited (Section 13).

(`Backup_Metadata`, suggested in the task instructions as a third sheet,
was not created - its content would duplicate `public.backup_log`, which
is already the authoritative backup-run record; adding a third sheet to
keep in sync with the same data seemed like exactly the kind of
unnecessary duplication "reuse before rewrite" warns against. If a
metadata sheet is wanted for a reason `backup_log` doesn't cover, that is
a scoped follow-up, not something invented here without a stated need.)

## 11. Backup scope: what is and is not backed up

**Backed up**: authoritative operational readings (UPS/Air/DC/Energy) for
every active site, for every month with data, sourced via the same
`BackendRepository.getMonthlyLogs`/`listPeriods` the rest of the app
already uses.

**Never backed up** (enforced structurally - `flattenToRows` in
`server/backup/backupService.ts` only ever touches `MonthlyLog` fields, it
has no code path that could reach any of these): sessions, CSRF tokens,
password hashes, `SESSION_SECRET`, `CSRF_SECRET`, `DATABASE_URL`,
`GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON` itself, any other API key, or
transient/calculated-only values. `test:backup-service` asserts the
generated backup rows never match `/password|secret|token|credential/i`.

## 12. Recovery procedure

**No automated restore is implemented.** This is stated explicitly, not
implied by omission, per the task's own instruction not to claim automated
disaster recovery that doesn't exist.

Manual recovery procedure:

1. Identify the backup version to restore from: `Backup_Log` (or
   `public.backup_log`) gives the exact `started_at`/`completed_at` for
   every run; `Data_Backup`'s content at that point in time is recovered
   via Google Sheets' native File -> Version history on the backup
   spreadsheet (find the version whose timestamp matches the desired
   `backup_log` row).
2. Export or copy the historical `Data_Backup` version's rows.
3. **Do not write Sheets data back into Supabase automatically or via any
   existing tool** - there is no reverse-sync path, by design (Section 1).
   Restoring a specific record into Supabase is a manual,
   admin-supervised, reviewed operation: identify the affected
   `site`/`period_month`/reading, and use the existing authenticated
   `PUT /api/v1/sites/:siteId/periods/:month` save path (the same one Data
   Entry already uses) with the recovered values, going through the same
   validation, row-version, and audit-logging path as any other save.
4. Who is authorized to restore: the same people authorized to make any
   other Data Entry save for that facility, i.e. any authenticated user
   with `operationalDataWrite` (currently both `admin` and `user` roles) -
   restoring is not a privileged operation beyond an ordinary save, since
   it goes through the exact same write path and audit trail.

**Known limitations**: no one-click restore UI; no automated
consistency check between a `Data_Backup` snapshot and the live database at
recovery time (a manual reconciliation step); recovery granularity is
whatever Google Sheets' version history granularity happens to be (not
guaranteed to align exactly with `backup_log` timestamps, since Sheets
saves its own versions on its own cadence).

## 13. Security

- Google API calls happen only in `server/backup/*`, server-side. Never in
  browser/client code.
- `GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON` is read from the environment at
  request time, never logged, never included in any API response, never
  written to `backup_log` (only a truncated *message* about a failure is
  stored, never the credential that caused it).
- `CRON_SECRET` authenticates the scheduled endpoint; a session
  authenticates the manual one. Neither can be used interchangeably for
  the other endpoint.
- RBAC: both backup endpoints reuse the existing `backupRestoreManage`
  permission (`authz/permissions.ts`) - already defined, admin-only,
  before this session. No new/parallel RBAC system was introduced.
- RLS on `public.backup_log` and `public.backup_config` follows the exact
  same `energy_monitor_runtime`-only pattern as every other table added
  this sprint (`007_ups_group_history.sql`, etc.) - `anon`/`authenticated`/
  `service_role` are explicitly revoked.
- `backup_config` never stores a credential field - only
  `spreadsheet_id`/`sheet_url`/`enabled`/`updated_by`/`updated_at`. A
  database compromise that exposed this table would reveal which Google
  Sheet is used for backup, never a way to access it.
- Changing the destination writes an `audit_events` row
  (`action: "backup_destination_change"`) with the actor, a masked
  previous/new spreadsheet reference (`maskSpreadsheetId`, e.g.
  `1Bx…9Q7z`), the enabled flag, and a timestamp - never the full ID/URL
  and never a credential.

## 14. User roles and authorization (verified, largely pre-existing)

- Roles: `admin`, `user` (`authz/permissions.ts`, pre-existing).
- Add User: Role select already existed and already defaulted to `user`
  (never silently defaulting to admin).
- **Edit Role for an existing user**: the backend
  (`PATCH /admin/users/:id/role`) already existed and was already tested,
  but there was no frontend control to reach it - added a per-row Role
  `<select>` in the User Management table this session (see the parity
  audit for detail). This was the one genuine UI gap found in this area.
- Server-side enforcement: every admin route uses
  `withPermission(res, PERMISSIONS.*)`, which throws (403 `FORBIDDEN`)
  before the handler body runs - never a frontend-only guard.
  `test:api` explicitly verifies a `user`-role session gets 403 from
  `POST /api/v1/admin/users`, `PATCH /api/v1/admin/users/:id/role`, and
  the new backup routes.
- **Last-admin protection**: `setUserActive`, `setUserRole`, `deleteUser`
  in `server/auth/repository.ts` all take an advisory Postgres lock and
  reject (`409 LAST_ADMIN`) if the action would leave zero active admins -
  pre-existing, re-verified via `test:api`'s
  `"last active admin cannot be demoted"` assertion.
- **Session revocation on privilege reduction**: `setUserActive(false)`
  and `resetUserPassword` both call `revokeAllSessions()` - pre-existing,
  re-verified via `test:api`'s `"deactivation rejects existing session"`
  and `"password reset revokes target sessions"` assertions. Role
  *demotion* specifically (admin -> user) does not itself force session
  revocation - the demoted session simply re-evaluates its (now-lower)
  permission on its very next request, since permissions are derived from
  the DB role on each check, not cached in the session token; `test:api`'s
  `"role change takes effect on next request"` assertion (originally
  written for promotion) confirms the same mechanism applies to demotion.
- **Role-change audit**: every `role_change` call to
  `setUserRole`/`PATCH .../role` writes an `audit_events` row with actor,
  target, previous/new role, and timestamp - pre-existing, re-verified via
  `test:api`'s audited-actions assertion.

## 15. Known limitations (honest, not hidden)

- **Google Sheets integration: NOT VERIFIED - EXTERNAL CREDENTIAL BLOCKER.**
  No real Google service-account credentials are available in this
  session (and per this project's credential-handling rules, none would
  be entered here even if supplied). All backup logic, including the new
  destination-configuration and Test Connection flows, is verified against
  a locally-generated, throwaway RSA keypair with `fetch` fully mocked
  (`test:backup-service`, 38 assertions) - real Google API behavior,
  quota limits, and error response shapes beyond what was mocked remain
  unverified until a real service account is configured in an approved
  environment.
- **Migrations `008_backup_log.sql` and `009_backup_config.sql` were not
  applied to any live database.** Supabase MCP access remains blocked this
  session; no local Docker was available to validate them against a
  throwaway Postgres either. `009` extends `008` (adds `backup_config` and
  a `spreadsheet_id` column on `backup_log`) rather than modifying it, and
  was written by hand-matching the exact structure of the prior
  migrations; both should be reviewed before being applied to Preview.
- **No automated restore** (Section 12) - manual procedure only.
- **Backup schedule (the daily cron time) is fixed** via `vercel.json`;
  the backup *destination* is now Admin-configurable without a deploy
  (Section 4.1) - only the time-of-day is not.
- **Browser UAT: NOT VERIFIED - EXTERNAL BLOCKER.** Chrome extension not
  connected this session; the Data Backup configuration form (URL field,
  Enabled toggle, Test Connection, Save Settings), Backup Now button, and
  Edit Role dropdown have not been seen rendering or clicked in an actual
  browser.
- **Supabase live verification: NOT VERIFIED - EXTERNAL BLOCKER**, for the
  same reason as every other phase this session - MCP access to
  `tofdgndrrpnnyhbuurbx` was never restored.
