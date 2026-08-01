# Release Notes — v2.2.4 (Corrective Release)

## Why this document was rewritten

The v2.2.4 tag/commit previously in this repository (`a2fcfa2`) was **not** an
implementation of the v2.2.4 acceptance scope. A source-level audit
(`git diff v2.2.3..v2.2.4 --stat`) showed only 5 non-application files
changed (25 lines total: a version bump, an `electron-builder.yml` tweak,
and these two doc files as literal placeholders reading "Pending build and
verification"). Neither Google Sheets authentication reliability nor the
Rack Capacity UI redesign — the two requirements v2.2.4 was supposed to
deliver — existed in that commit.

This document describes what was **actually implemented, tested, and
verified** in the corrective pass that produced the final v2.2.4 commit.
The version number stays 2.2.4 (per explicit instruction — this is a
correction, not a new release).

## Summary

Two workstreams, both scoped to v2.2.4:

- **A — Google Sheets authentication reliability**: replaced a renderer-side
  Firebase popup/redirect flow (built for a different, iframe-embedded
  deployment target) with a real Electron main-process OAuth 2.0
  Authorization Code + PKCE flow, per RFC 8252/RFC 7636.
- **B — Rack Capacity and Utilization UI/UX redesign**: one shared canonical
  status config now drives status order and color everywhere (cards, donut,
  legend, zone table, Historical Explorer, PDF); the donut/legend gained
  real progress bars and a Total-Racks center label; the zone table gained
  data bars, an em dash for zero cells, and a distinctly-styled Grand Total
  row; the obsolete "U-capacity metrics are unavailable... and are not
  inferred" claim was removed and replaced with a real, month-scoped
  Rack Unit Capacity second dimension; the Historical Operations Explorer
  gained a Rack Capacity tab (real persisted history, not the live table
  relabeled); Quick Jump was fixed to show only real, chronological,
  single-reporting-year months.

## A. Google Sheets Authentication

### Root cause

The existing implementation ran Firebase Auth's `signInWithPopup`/
`signInWithRedirect` inside the Electron renderer's own `BrowserWindow`,
caching the resulting Google access token in that window's `localStorage`
with no real refresh path (Firebase's client SDK does not refresh the
underlying Google OAuth access token, only its own Firebase ID token). The
UI still carried literal "AI Studio Preview Iframe Notice" text, direct
evidence this flow was built for a browser/iframe preview context and never
adapted for the Electron desktop shipping target.

### What was built

- `src/electron/googleAuthPure.ts` / `src/electron/googleAuth.ts` — a
  main-process OAuth engine:
  - Authorization Code flow with PKCE (S256), verified against the
    official RFC 7636 Appendix B test vector.
  - `state` parameter generated and validated on callback (CSRF
    protection), with a 5-minute timeout and listener cleanup.
  - System-browser consent via `shell.openExternal()` — never Electron's
    own `BrowserWindow` — with a loopback `http://127.0.0.1:51820`
    callback listener (RFC 8252), not the deprecated OOB flow.
  - Access + refresh token exchange; automatic silent refresh before
    expiry (60s skew).
  - Token persistence via `safeStorage` (OS-DPAPI-backed encryption on
    Windows) in the app's existing portable `config/` folder (this app
    stores all state beside the exe rather than in `app.getPath('userData')`
    — an established, pre-existing convention; the checklist's "preferably
    userData" guidance was intentionally not followed here to match it).
    Corrupted/unreadable token files and revoked tokens are handled by
    falling back to "not signed in" rather than crashing.
  - A lightweight Sheets API call (`fetchUserEmail`) verifies the token
    actually works after exchange.
  - Sign-out clears the persisted token file.
- `src/electron/ipc/googleSheets.ts` + preload/`desktop.d.ts` bridge — the
  renderer never receives a raw token; every privileged step happens over
  IPC, and `broadcastAuthState()` pushes 5 states to the UI: disconnected,
  connecting, connected, authentication-required, error.
- `src/googleSheetsDriver.ts` — a `GoogleSheetsDriver` interface with a
  `DesktopGoogleSheetsDriver` (IPC-backed) and the original
  `BrowserGoogleSheetsDriver` (Firebase, unchanged) kept side by side via
  the same `isDesktop()` switch `ProviderFactory.ts` already uses. The
  browser/iframe deployment's UI (including the AI Studio preview notice)
  was preserved unchanged for that path.
- `google-oauth-desktop-config.example.json` — a committed template for the
  desktop OAuth `client_id`/`client_secret` (Desktop-app type, from Google
  Cloud Console); the real file (`google-oauth-desktop-config.json`) is
  gitignored and never committed, matching this repo's credential-handling
  rules.

### Security posture

- No OAuth token or authorization code ever appears in application logs.
- No token is committed to git (real config file gitignored; only the
  placeholder template is tracked).
- Token file is OS-encrypted at rest via `safeStorage`; a plaintext file
  from a prior run without encryption available is still readable, not
  silently corrupted.
- A Google failure never breaks Excel/desktop mode — this was verified,
  not just asserted (see Bug Fix below).

### Testing (Google Sheets)

- `scripts/test-google-auth.ts` — 18/18 unit tests on the pure PKCE/state/
  token-expiry/credential-validation logic, including the official RFC 7636
  test vector. Run via `npm run` (not yet wired to a package.json script
  name; run directly with `node node_modules/tsx/dist/cli.mjs
  scripts/test-google-auth.ts`).
- `scripts/e2e-cdp.mjs` — real Electron CDP run: the desktop "Sign in with
  Google" button is clicked and the flow is driven to the point only real
  Google user consent can pass — with no `google-oauth-desktop-config.json`
  present, it correctly and gracefully surfaces "Connection Error" naming
  the missing file, and the renderer does not crash (all 6 nav tabs remain
  present afterward).
- `scripts/verify-packaged-rack-ui-visual.mjs` — the same sign-in attempt
  was driven against the **packaged** portable EXE; the Connection Error
  state was confirmed to appear there too.

### Live authentication status

**NOT TESTED — USER ACTION REQUIRED.** A real Google Cloud Console "Desktop
app" OAuth client (`client_id`/`client_secret`) is required to test a real
consent flow end to end, and cannot be created or entered by an AI agent
(this requires Google Cloud Console access, and the repository's security
rules forbid entering credentials into any file/command on the user's
behalf regardless). To complete live verification:

1. Create an OAuth 2.0 Client ID of type **Desktop app** in Google Cloud
   Console, with the Google Sheets API enabled on the project.
2. Copy `google-oauth-desktop-config.example.json` to
   `google-oauth-desktop-config.json` (same folder — the app root) and
   fill in the real `clientId`/`clientSecret` yourself.
3. Launch the app, go to Settings, enable Google Sheets, and click "Sign in
   with Google" — the system browser should open a real Google consent
   screen; after approval the app should report "Connected" with your
   email.

## B. Rack Capacity and Utilization UI/UX Redesign

### Canonical status config (single source, not scattered arrays)

`src/utils/rackStatusConfig.ts` is now the one place that defines status
order (`In Use → Available → Reserved → Pending Dismantle → Other`,
reusing the existing `RACK_CANONICAL_STATUSES` from `rackCapacity.ts`
rather than redefining it), labels (TH/EN), and colors (one hex per
status: emerald `#10b981` / sky `#0ea5e9` / amber `#f59e0b` / rose
`#f43f5e` / slate `#94a3b8`). `RackCapacitySummaryCard.tsx`'s previous
locally-hardcoded `PIVOT_STATUSES` (in the **wrong** order: Reserved,
Pending Dismantle, In Use, Available) and `DONUT_COLORS`, and
`reportHtml.ts`'s separate `DONUT_COLORS`, were removed in favor of this
one module. "Other" is appended only when it actually has data.

### Donut + distribution panel

- Donut stays left, compact status distribution stays right.
- Donut center now shows the Total Racks count (e.g. "358") with a
  "Total Racks"/"แร็คทั้งหมด" label — no redundant percentage.
- Each distribution row shows a colored dot, status label, count, exact
  percentage (2 decimals), and a real DOM-rendered progress bar
  (`RackStatusBar.tsx` — a `<div>` with a width-scaled fill, never ASCII),
  clamped to [0, 1] via a shared `clampRatio()` helper.
- The redundant "Usage"/"Availability" summary rows (duplicating the
  In Use %/Available % already shown per-status) were removed; the
  underlying `inUse`/`available` metrics themselves are untouched.

### Rack Zone table (renamed from "Pivot Table" to "Rack Zone Capacity Table")

- Column order: Rack Zone, In Use, Available, Reserved, Pending Dismantle,
  (Other, only if present), Grand Total — matching the donut/legend order.
- Every non-zero cell shows count, 1-decimal percentage, and a data bar.
  Zone rows use that **zone's own total** as the bar/percentage
  denominator; the Grand Total row uses the **facility total** — this was
  already correct in the underlying `calculateRackCapacityMetrics()`
  calculation (verified by the pre-existing `test-rack-capacity-metrics.ts`
  suite) and the redesign now surfaces it visually per-row instead of just
  in the number.
- Zero-count cells render "—", never "0 (0.0%)", and never a progress fill.
- The Grand Total row has a stronger background, a top divider, and
  semibold values.
- The zone-name drilldown and per-cell drilldown (click a value to inspect
  the underlying records) were preserved; the new progress bars are
  `pointer-events-none` and `aria-hidden`, so they can never intercept a
  click or appear as a separate, confusing accessibility-tree entry (the
  count/percentage text next to them is the accessible value). Clicking
  the new "Other" column filters by "not a canonical status" via an
  internal sentinel, not a literal string that could collide with real
  data.

### Rack Unit Capacity (second dimension)

The literal obsolete text — "U-capacity metrics are unavailable in the
source workbook and are not inferred." / its Thai equivalent — has been
removed from `RackCapacitySummaryCard.tsx`. In its place, the card now
shows Total (U) / Used (U) / Available (U) / Availability Capacity (%) for
the **currently selected month** (the same month state shared with the
Rack Unit Capacity panel below it), with an explicit note that this never
shares a denominator with the rack-count Availability % above it. If the
selected month has no U-capacity row, the card shows "No Rack Unit
Capacity data for the selected month." — never the old blanket claim.
Verified end-to-end via CDP: before saving, the empty-state message shows;
after saving Total=400/Used=350, the card updates live to show
Available=50, Availability=12.50%.

### Historical Operations Explorer

- Added a "Rack Capacity History"/"ประวัติความจุแร็ค" tab, which renders
  the existing `RackCapacityHistoryPanel` (real persisted Rack Capacity
  History snapshots, never the live current table relabeled) plus a new
  Rack Unit Capacity History table (real persisted rows only).
- **Quick Jump bug fix**: previously showed `logs.slice(0, 10)` — an
  arbitrary slice in whatever order `logs` happened to be in, with no year
  scoping. It now shows only real months present in the (already
  facility-scoped) workbook, restricted to the single most recent active
  reporting year, in real newest-first chronological order, and
  recalculates automatically on facility switch (it derives from the same
  `logs` prop the rest of the view already uses).

### PDF ("Export All Report")

`reportHtml.ts`'s Rack Capacity page already used the shared
`calculateRackCapacityMetrics()` and was already in canonical order; it now
also imports its donut/table colors from the same `rackStatusHex()` shared
config instead of a second hardcoded map (the Pending Dismantle color
shifted from a one-off `#e05b4c` to the shared `#f43f5e` — a presentation
adjustment, not a data change). PDF smoke tests confirm generation still
succeeds (15 pages, both the current-page and Export All paths).

## Bug fix: Google connection state was silently breaking Excel/desktop mode

While adding the deeper Historical Explorer checks above, a real,
pre-existing regression surfaced: `App.tsx`'s single Google auth-state
listener called `setSyncedLogs(null)` on **any** non-"connected" state —
including the very first "connecting"/"error" transition of a **failed**
sign-in attempt. Since `syncedLogs` in desktop mode is populated from the
local Excel workbook and has nothing to do with Google at all, this meant
a single failed or cancelled Google sign-in attempt would permanently blank
the Historical Operations Explorer (and anything else reading
`syncedLogs`) for the rest of the session — a direct violation of "a Google
failure must never break Excel mode." Root-caused via the OBSERVE → TRACE
→ PROVE process (traced from a failing new E2E check back through
`HistoricalExplorer` → `syncedLogs` → the auth-state `useEffect`) and fixed
with a one-line, minimal, targeted condition: `if (!isDesktopApp &&
state.status !== "connected") setSyncedLogs(null);` — the browser/iframe
path (where `syncedLogs` genuinely does come from Google Sheets) keeps its
original clear-on-disconnect behavior unchanged.

## Full Regression Testing

Full regression, all green:

- `npm run lint` (renderer + Electron strict typecheck)
- `npm run build`
- `npm run validate:formatting` (also fixed 2 pre-existing violations this
  surfaced: a duplicated `formatRatioPercent`-equivalent in
  `RackUnitCapacityPanel.tsx`, and a raw `.toFixed()` chart-value rounding
  in `RackCapacityHistoryPanel.tsx`, both replaced with shared formatting
  utilities)
- `test:excel`, `test:rack-capacity-metrics`, `test:rack-capacity-write`,
  `test:rack-capacity-image`, `test:rack-capacity-image-embed`,
  `test:rack-capacity-history`, `test:rack-status-config` (new, 26 checks),
  `test:facility-isolation`, `test:facility-comparison`,
  `test:dashboard-facility-isolation`, `test:dashboard-config-driven`,
  `test:dashboard-workbook-mapping`, `test:ups-group-history`,
  `test:ups-group-history-migration`, `test:energy-cost-dashboard`,
  `test:air-validation`, `test:srinakarin`, `test:srinakarin:roundtrip`,
  `test:srinakarin:aggregate`, `test:save-formatting`, `test:rc3`,
  `test:batch-save-merge`, `test:production-stress-fault`,
  `test:all-report`, `test:all-report:pdf`
- `test:e2e` — 74 checks, all passing (37 of them new or extended for this
  corrective pass: Google Sheets desktop sign-in flow, and the full Rack
  Capacity redesign — canonical order, progress bars, donut center,
  redundant-row removal, zone table order/bars/em-dash/Grand-Total styling,
  drilldown, U-capacity second dimension including its live save/reflect
  cycle, Historical Explorer's new tab, and Quick Jump's chronological/
  year/facility scoping)
- `test:packaged-report` — packaged portable EXE, both facilities'
  isolated Rack Capacity numbers verified (Rangsit 358/294, Srinakarin
  237/218), PDF export verified
- `scripts/verify-packaged-rack-ui-visual.mjs` — direct visual screenshot
  inspection of the packaged EXE's redesigned Rack Capacity view for both
  facilities, and the Google sign-in attempt reaching Connection Error

## Known limitations

- Live Google OAuth consent has not been exercised end-to-end (see above —
  requires the user's own Google Cloud Console credentials).
- The Rack Zone table's "Other" bucket drilldown (filtering by a
  non-canonical status) is code-reviewed-correct but not independently
  CDP-verified against a rendered "Other" cell, because neither reference
  workbook (Rangsit: 294+8+32+24=358, Srinakarin: 218+3+13+3=237) currently
  contains any non-canonical rack status.
