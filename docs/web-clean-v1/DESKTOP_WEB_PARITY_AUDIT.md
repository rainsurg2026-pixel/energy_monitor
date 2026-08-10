# Desktop v2.3.1 - Clean-v1 parity audit

Audit date: 2026-08-10 (Asia/Bangkok)

## Scope and evidence

Authoritative Desktop package:

- D:\Project\Energy_Monitor\release\Energy Monitor-v2.3.1
- package executable: Energy Monitor-v2.3.1.exe
- package workbooks: DC_Rangsit.xlsm, DC_Srinakarin.xlsm

Authoritative Web source:

- branch: feat/web-clean-v1
- committed baseline audited: 130c9d4
- Admin UI parity fix is committed and deployed through the Git-connected Preview
  deployment
- Web entry point: src/main.tsx selects src/web-clean-v1/CleanWebApp.tsx for HTTP(S) runtime
- Vercel build: npm run vercel-build, with server/vercel/handler.ts bundled to api/runtime.js

Preview evidence:

- https://energy-monitor-aiw8z6xlu-dcm15.vercel.app/
- branch alias: https://energy-monitor-git-feat-web-clean-v1-dcm15.vercel.app
- /api/v1/health 200
- /api/v1/readiness 200
- anonymous /api/v1/auth/session 200 with authenticated:false
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

- Restore read access for Supabase project tofdgndrrpnnyhbuurbx.
- Verify remote migrations, tables, RLS, policies, display-period row, sites,
  and historical data. Do not apply migrations while access is unresolved.

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

### P2

- Obtain Desktop GUI screenshots for layout-level comparison if the owner
  can provide an interactive session.
- Reconcile any source-data completeness differences found by the remote
  historical audit; never invent missing readings.

## Current release decision

Preview is not Production-ready yet. Remaining blockers:

1. Supabase connector permission for actual project verification;
2. owner-controlled credentials/browser actions for authenticated UAT.

Production remains untouched.
