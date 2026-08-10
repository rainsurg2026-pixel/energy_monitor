# Desktop v2.3.1 - Clean-v1 parity audit

Audit date: 2026-08-10 (Asia/Bangkok), follow-up verification 2026-08-11.

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
- Commit the corrected `.worktrees/web-clean-v1` submodule gitlink on
  `feat/web-v3` (currently pinned 5 commits stale at `932395e` vs. actual
  HEAD `db15dc0`). Requires explicit Product Owner instruction to commit,
  per `.claude/rules/git.md`.

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
