# Desktop v2.3.1 - Clean-v1 parity audit

Audit date: 2026-08-10 (Asia/Bangkok), follow-up verification 2026-08-11.

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
