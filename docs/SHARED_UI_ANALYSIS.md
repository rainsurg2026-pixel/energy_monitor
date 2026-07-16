# Shared UI Analysis

> Status as of Sprint 3 (Shared UI Inventory). This document is analysis and
> documentation only — no production files were modified to produce it.
> Source of truth: the live `main` branch on GitHub (`patamin-lab/mqr-mahindra`),
> scanned file-by-file on 2026-06-26. The `mqr-webapp-new` local clone in this
> workspace was **not** used as a source — it is a single-point-in-time clone
> with no fetches since, and is missing the SweetAlert2/`fetchJson` migration
> that is already live on `main` (confirmed by diffing its `branches-table.tsx`
> against the live version). Anyone re-running this analysis later should scan
> `main` directly, not this local folder, unless it has been re-cloned.

## 1. Scoring legend

- **Reusability score** — 1 (single page, not generic) to 5 (already generic
  and/or already used in 2+ places).
- **Migration priority** — High / Medium / Low. How much value moving this
  into `shared/ui/` unlocks, independent of effort.
- **Estimated migration risk** — Low / Medium / High. How likely a move is to
  break something, based on how entangled the code is with business logic,
  data fetching, or other in-flight work.

## 2. Inventory

### 2.1 SweetAlert wrapper — `src/lib/swal.ts`

| Field | Detail |
|---|---|
| Current location | `src/lib/swal.ts` (93 lines) |
| Purpose | Wraps `sweetalert2` with brand-styled `swalSuccess`, `swalError`, `swalInfo`, `swalConfirm`, plus `swalLoading`/`swalClose` (seen in call sites, not yet read line-by-line but used consistently as a pair). Gives every form/table a single consistent toast/confirm/loading-popup vocabulary. |
| Dependencies | `sweetalert2` package; `.mqr-swal` CSS overrides in `src/app/globals.css` (icon/button colors keyed to brand red `#c8102e`). |
| Reusability score | 5/5 — already imported by `login/page.tsx`, `admin/branches/branches-table.tsx`, `records/[jobId]/delete-button.tsx`, `records/[jobId]/update-form.tsx`, and (by consistent "Task #83" commit messages) all 5 admin `*-table.tsx` files. |
| Recommended shared location | `shared/ui/feedback/swal.ts` (or `shared/services/swal.ts` if the team prefers to keep non-visual wrappers out of `ui/`) |
| Migration priority | High — do this first. Nothing else depends on where it lives, but almost everything else depends on its behavior staying identical. |
| Estimated migration risk | Low — pure path move + import update, no logic change. |

### 2.2 Fetch/API wrapper — `src/lib/fetchJson.ts`

| Field | Detail |
|---|---|
| Current location | `src/lib/fetchJson.ts` (64 lines) |
| Purpose | Wraps `fetch` so API routes that return non-`{ok,...}` shapes (Vercel 413 page, auth-gateway HTML, cold-start timeouts) don't crash callers with a raw JSON-parse error. Also standardizes session-expiry (401) handling via a `FetchJsonError`. This is a **shared service**, not a visual component, but it is a load-bearing dependency for nearly every other item in this inventory. |
| Dependencies | None outside the browser `fetch` API. |
| Reusability score | 5/5 — same consumer list as 2.1. |
| Recommended shared location | `shared/services/fetchJson.ts` (flagged explicitly as non-UI; do not file under `shared/ui/`) |
| Migration priority | High — move alongside `swal.ts` in the same pass. |
| Estimated migration risk | Low. |

### 2.3 Sidebar / Navigation shell — `src/app/(app)/sidebar.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/sidebar.tsx` (123 lines) |
| Purpose | The app's combined sidebar + header. Renders the brand title, logged-in user's name/role, primary `NAV` links, a conditional admin nav section (gated by `canManageMasterData`/`seesAllDealers` from `@/lib/scope`), a mobile hamburger toggle with a `fixed inset-0 bg-black/50` overlay drawer, and the logout button. There is **no separate Header component** — this file plays both roles. |
| Dependencies | `next/link`, `next/navigation` (`usePathname`, `useRouter`), `SessionUser` type, `roleLabelTh`/`canManageMasterData`/`seesAllDealers` from `@/lib/scope`. |
| Reusability score | 2/5 — only one consumer (`src/app/(app)/layout.tsx`) today, but it is cleanly self-contained. |
| Recommended shared location | `shared/ui/layout/Sidebar.tsx` |
| Migration priority | Low — single consumer, so moving it has no reuse payoff; value is purely organizational. |
| Estimated migration risk | Medium — pulls in session/role types and `@lib/types` vs `@/lib/types` alias usage was inconsistent between files observed; verify path aliases resolve correctly before any future move. |

### 2.4 Language toggle — `src/app/language-toggle.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/language-toggle.tsx` (170 lines) |
| Purpose | TH/EN toggle built on the Google Translate Element widget, driven by a `googtrans` cookie, rendered as a slide-down dropdown (per its own commit message: "move language toggle off mobile hamburger, use slide-down dropdown"). Rendered once in the root layout, outside the authenticated app shell. |
| Dependencies | Google Translate Element script (loaded at runtime via `window.googleTranslateElementInit`); CSS in `globals.css` that force-hides Google's own banner/tooltip UI (`#google_translate_element { display: none !important }` etc.). |
| Reusability score | 2/5 — single consumer (`src/app/layout.tsx`), self-contained. |
| Recommended shared location | `shared/ui/layout/LanguageToggle.tsx` |
| Migration priority | Low. |
| Estimated migration risk | Low — no business-logic coupling. |

### 2.5 Charts — `src/app/(app)/dashboard/charts.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/dashboard/charts.tsx` (133 lines) |
| Purpose | Five named, data-driven Recharts wrappers: `MonthlyTrendChart`, `ParetoChart`, `StatusBarChart`, `SimpleBarChart`, `AgingBarChart`. All take a typed `data` prop and render `ResponsiveContainer`-wrapped charts with brand colors (`AGING_COLORS` array, `#c8102e` bar fill); none contain business logic or data-fetching. |
| Dependencies | `recharts`. |
| Reusability score | 4/5 — only used by `dashboard/page.tsx` today, but every export is already generic/presentational and reusable as-is. |
| Recommended shared location | `shared/ui/charts/` (one file per chart, or keep as a single module) |
| Migration priority | Medium. |
| Estimated migration risk | Low — pure presentational, no side effects. |

### 2.6 KPI Card — inline `KpiCard()` in `dashboard/page.tsx`

| Field | Detail |
|---|---|
| Current location | Defined inline (unexported) inside `src/app/(app)/dashboard/page.tsx` |
| Purpose | Small stat card: `{ label, value, accent?, sub? }` → label + big number + optional accent color + optional sub-caption. Used repeatedly across the dashboard's KPI row. |
| Dependencies | None beyond Tailwind classes. |
| Reusability score | 4/5 — trivially generic, zero business logic, but not yet extracted to its own file. This matches the extraction already predicted in Sprint 2's `docs/ROADMAP.md`. |
| Recommended shared location | `shared/ui/cards/KpiCard.tsx` |
| Migration priority | High — cheap, safe, immediately useful win. |
| Estimated migration risk | Low. |

### 2.7 Panel (card/section wrapper) — inline `Panel()` in `dashboard/page.tsx`

| Field | Detail |
|---|---|
| Current location | Defined inline (unexported) inside `src/app/(app)/dashboard/page.tsx` |
| Purpose | Generic `{ title, note?, children }` section/card wrapper used to frame every chart and table on the dashboard (`<Panel title="...">...</Panel>`). |
| Dependencies | None. |
| Reusability score | 4/5. |
| Recommended shared location | `shared/ui/cards/Panel.tsx` |
| Migration priority | High. |
| Estimated migration risk | Low. |

### 2.8 Status/Severity badge styling — **three independent implementations**

| Field | Detail |
|---|---|
| Current location | `severityBadgeClass()` in `dashboard/page.tsx`; a `SEVERITY_COLORS` record in `records/[jobId]/print-view.tsx`; a separate `statusColor` record in `records/page.tsx`. |
| Purpose | Maps a status or severity value to a Tailwind badge color class (e.g. `bg-red-100 text-red-700` for Critical, `bg-amber-100 text-amber-700` for Major/`Open`, etc.). |
| Dependencies | `STATUS_LABELS`/`SEVERITY_LABELS` from `src/lib/types.ts` (already centralized — only the *color* mapping is duplicated, not the Thai labels). |
| Reusability score | 1/5 today — three separately-maintained color tables that can silently drift out of sync with each other; conceptually this is one concern implemented three times. |
| Recommended shared location | `shared/ui/badges/StatusBadge.tsx` + `SeverityBadge.tsx` |
| Migration priority | High — this is the clearest "rule of three" duplication in the codebase and a real consistency risk today, independent of any folder-reorg goal. |
| Estimated migration risk | Medium — not a pure file move; requires reconciling three color tables and a visual check that all three call sites render identically afterward. |

### 2.9 Dashboard filter bar — inline `<select>` group in `dashboard/page.tsx`

| Field | Detail |
|---|---|
| Current location | Inline JSX inside `dashboard/page.tsx`, server-rendered, backed by `searchParams` (year/month/model/dealer/branch) |
| Purpose | A row of native `<label className="block text-sm font-medium mb-1">` + `<select className="border border-gray-300 rounded px-3 py-2">` filters. The exact same label+select markup pattern reappears in `report/report-form.tsx` (severity select). |
| Dependencies | `THAI_MONTHS_FULL`, `buildYearOptions` from `@/lib/thaiDate`; `stats.filterOptions` from the page's own data fetch. |
| Reusability score | 3/5 — markup pattern is reused informally (copy-pasted) across at least 2 files; underlying options/data sources differ per use. |
| Recommended shared location | `shared/ui/forms/SelectField.tsx` (label+select wrapper only — keep options/handlers as props) |
| Migration priority | Medium. |
| Estimated migration risk | Low. |

### 2.10 Admin CRUD table pattern — 5 near-identical files

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/admin/{branches,dealers,problem-codes,technicians,users}/*-table.tsx`. Read in full: `branches-table.tsx` (184 lines). The other four were not opened line-by-line, but share the identical "Task #83: add loading popup feedback to *X* admin table" commit message and directory structure, which is strong (though not byte-for-byte confirmed) evidence of the same pattern. |
| Purpose | Inline-editable admin table: native `<table>`, a per-row `isEditing` toggle that swaps a `<td>`'s text for an `<input>`, and `createX()`/`saveEdit()`/`deleteX()` handlers that each follow `setBusy(true)` → `swalLoading()` → `fetchJson()` → `swalClose()` / `showError()` → `setBusy(false)`. |
| Dependencies | `fetchJson`, `swalError`/`swalLoading`/`swalClose`, entity types from `@/lib/types`. |
| Reusability score | 2/5 today (5 hand-written near-duplicates) but very high latent reusability — this is the single largest duplication footprint in the app, exactly as predicted in Sprint 2's `docs/ROADMAP.md` ("generic `AdminCrudTable`"). |
| Recommended shared location | `shared/ui/tables/AdminCrudTable.tsx` (column-config + CRUD-handler props) |
| Migration priority | Medium-High in value, but **deliberately not first** in the migration order below — see §3. |
| Estimated migration risk | High — the only item in this inventory where extraction touches live business/API logic across 5 production admin sections at once, not just presentation. Any future attempt should be its own sprint with explicit approval per Sprint 3's STOP clause, not folded into a simple file move. |

### 2.11 Delete button — `records/[jobId]/delete-button.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/records/[jobId]/delete-button.tsx` (44 lines) |
| Purpose | `swalConfirm()` → `fetchJson()` DELETE → redirect via `useRouter()`. Currently hardcoded to the `/api/records/[jobId]` endpoint. |
| Dependencies | `fetchJson`, `swalConfirm`/`swalError`/`swalLoading`/`swalClose`, `next/navigation`. |
| Reusability score | 3/5 — generic shape, one hardcoded endpoint. |
| Recommended shared location | `shared/ui/buttons/ConfirmDeleteButton.tsx` (parametrize endpoint + redirect target) |
| Migration priority | Medium. |
| Estimated migration risk | Low. |

### 2.12 Print button — `records/[jobId]/print-button.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/records/[jobId]/print-button.tsx` (13 lines, fully read) |
| Purpose | Zero-prop button that calls `window.print()`; styled `print:hidden` so it disappears in the printed output itself. |
| Dependencies | None. |
| Reusability score | 5/5 — no props, no state, trivially reusable anywhere a print trigger is needed. |
| Recommended shared location | `shared/ui/buttons/PrintButton.tsx` |
| Migration priority | High — trivial, zero-risk, good first real component move. |
| Estimated migration risk | Low. |

### 2.13 Print view + PDF export — two parallel ~500-line implementations

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/records/[jobId]/print-view.tsx` (224 lines) and `src/lib/exportPdf.tsx` (497 lines) |
| Purpose | `print-view.tsx`'s own header comment states it is "built to mirror the PDF export (`src/lib/exportPdf.tsx`) layout exactly, so 'พิมพ์รายงาน' (print) and 'Export PDF' produce visually matching documents." `exportPdf.tsx` renders the same record via `@react-pdf/renderer` (`Document`/`Page`/`Text`/`View`/`StyleSheet`/`Image`) plus a `qrcode` library, for server-side PDF generation. |
| Dependencies | `print-view.tsx`: `MqrRecord`, `STATUS_LABELS`/`SEVERITY_LABELS`/`PHOTO_CATEGORIES`, `formatThaiDateTime`. `exportPdf.tsx`: `@react-pdf/renderer`, `qrcode`, same type/date deps. |
| Reusability score | 1/5 today — two independently-maintained ~500-line layouts manually kept in sync by hand, by the original author's own admission in code comments. |
| Recommended shared location | Longer-term target only: `shared/documents/` (or similar), once the team decides whether to actually unify a DOM-based print layout with a `@react-pdf/renderer`-based PDF layout — these are two different rendering engines, so true unification is a design decision, not a mechanical file move. |
| Migration priority | Low for a Sprint-3-style migration — too large and too easy to silently desync if touched casually. |
| Estimated migration risk | High. |

### 2.14 Excel export — `src/lib/exportExcel.ts`

| Field | Detail |
|---|---|
| Current location | `src/lib/exportExcel.ts` (122 lines) |
| Purpose | Column-config-driven (`LIST_COLUMNS: {header,key,width}[]`) Excel export of the records list, via `exceljs`. A shared *service*, not a UI component. |
| Dependencies | `exceljs`, `MqrRecord` type, `formatThaiDateTime`. |
| Reusability score | 3/5 — the config-driven pattern generalizes cleanly, but has one consumer today. |
| Recommended shared location | `shared/services/exportExcel.ts` |
| Migration priority | Low. |
| Estimated migration risk | Low. |

### 2.15 Report form — `src/app/(app)/report/report-form.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/report/report-form.tsx` (1007 lines — by far the largest single component in the app) |
| Purpose | The "submit a quality report" form: vehicle-serial search/autofill (calls `/api/vehicles/[serial]` on blur, with a preloaded dropdown plus a live fallback lookup), severity select, location picker integration, photo/video file inputs, and a **chunked Google Drive resumable-upload relay** (`putFileViaServerRelay`) with its own retry loop — all defined inline in this one file. The relay function's own comment documents a confirmed-live (2026-06-25) CORS failure mode it works around. |
| Dependencies | `ProblemCode`/`PhotoLink`/`Dealer`/`Branch`/`Technician`/`Severity` types, `next/navigation`, the in-file upload relay logic, `LocationPicker` (2.16). |
| Reusability score | 1/5 as a whole — monolithic and page-specific; too large/coupled to extract wholesale. Contains at least two sub-patterns worth extracting individually (see below). |
| Recommended shared location | Not recommended for wholesale migration. Two narrower extractions are worth tracking separately: (a) the upload relay → `shared/services/driveUpload.ts`; (b) the vehicle-serial search/autofill → `shared/ui/forms/SerialAutocomplete.tsx`. |
| Migration priority | Low for the file as a whole (flag as a future "split this file up" refactor, out of scope for a pure file-move migration); Medium for the upload-relay extraction specifically, since `update-form.tsx` likely needs equivalent photo-replace capability. |
| Estimated migration risk | High for any wholesale move; Medium for the upload-relay extraction alone (it wraps a documented, fragile CORS workaround and must be re-tested live, not just moved). |

### 2.16 Location picker + map — `report/location-picker.tsx`, `report/map-view.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/report/location-picker.tsx` (155 lines, fully read); `src/app/(app)/report/map-view.tsx` (referenced via `next/dynamic`, not opened directly — its existence and role are confirmed by the dynamic import and directory listing, but its internals were not read) |
| Purpose | A place-search box backed by the Nominatim/OpenStreetMap geocoding API (`accept-language=th` for Thai place names), with a results dropdown, searching/error states, and a `leaflet`-based map (dynamically imported with `ssr: false` plus an explicit "กำลังโหลดแผนที่..." loading skeleton, since Leaflet touches `window` at import time). |
| Dependencies | `leaflet` (type-only import here, loaded inside `map-view.tsx`), Nominatim public API, `next/dynamic`. |
| Reusability score | 3/5 — one current consumer (`report-form.tsx`) but cleanly self-contained and already SSR-safe. |
| Recommended shared location | `shared/ui/maps/LocationPicker.tsx` + `MapView.tsx` |
| Migration priority | Medium. |
| Estimated migration risk | Low. |

### 2.17 Update form — `records/[jobId]/update-form.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/(app)/records/[jobId]/update-form.tsx` (227 lines) |
| Purpose | Status/severity update form for an existing record. Top-level imports confirmed (`MqrRecord`, `STATUS_VALUES`/`STATUS_LABELS`, `SEVERITY_VALUES`/`SEVERITY_LABELS`, `PhotoLink`); shares the same "Task #83" commit as `delete-button.tsx`, strongly suggesting the same `fetchJson`+`swal` pattern, though the full body was not screenshotted line-by-line. |
| Dependencies | Likely `fetchJson`, `swal*` helpers (pattern-consistent with every other confirmed form in the app, not independently verified line-by-line here). |
| Reusability score | 1/5 — single page, record-shape specific. |
| Recommended shared location | None recommended; documented for completeness only. |
| Migration priority | Low. |
| Estimated migration risk | Low. |

### 2.18 Login form — `src/app/login/page.tsx`

| Field | Detail |
|---|---|
| Current location | `src/app/login/page.tsx` (74 lines, fully read) |
| Purpose | Username/password form using `useState`, `fetchJson`, and `swalLoading`/`swalError`/`swalClose` — the same confirmed pattern as every other form in the app. |
| Dependencies | `fetchJson`, `swal*` helpers, `next/navigation`. |
| Reusability score | 2/5 — small, single-use, but a clean reference example of the form pattern. |
| Recommended shared location | None recommended. |
| Migration priority | Low. |
| Estimated migration risk | Low. |

### 2.19 Empty state — inline row in `records/page.tsx`

| Field | Detail |
|---|---|
| Current location | Inline conditional inside `src/app/(app)/records/page.tsx`: `{records.length === 0 && (<tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr>)}` |
| Purpose | The only confirmed "no data" placeholder found anywhere in the scanned codebase. Not present (or at least not confirmed) in the admin tables. |
| Dependencies | None. |
| Reusability score | 1/5 — one inline instance, not abstracted. |
| Recommended shared location | `shared/ui/tables/EmptyState.tsx` |
| Migration priority | Medium — cheap, and prevents future lists from inventing inconsistent "no data" wording/styling. |
| Estimated migration risk | Low. |

### 2.20 Loading states — fragmented, no shared component

| Field | Detail |
|---|---|
| Current location | `location-picker.tsx`'s map-loading skeleton box (`h-64 w-full rounded border border-gray-200 bg-gray-50 flex items-center justify-...` + "กำลังโหลดแผนที่..."); `swalLoading()` for async submit actions app-wide; ad hoc `vehicleLoading`/`searching`/`busy` booleans in individual forms. |
| Purpose | Communicate in-progress state. Today this is solved three different ways depending on context (inline skeleton box, modal popup via SweetAlert, or just a disabled button) rather than one shared primitive. |
| Dependencies | Varies per call site. |
| Reusability score | 2/5 — `swalLoading()` is already a de-facto shared solution for the "blocking async action" case; only the inline-skeleton case (`location-picker.tsx`) has no shared equivalent. |
| Recommended shared location | `shared/ui/feedback/LoadingState.tsx` (a small labeled skeleton/placeholder box, as a companion to the already-shared `swalLoading()`) |
| Migration priority | Low. |
| Estimated migration risk | Low. |

### 2.21 Pagination — not implemented

No pagination control was found anywhere in the live codebase. Both the records list (`records/page.tsx`) and every admin table render their entire filtered result set with no page breaks. This is a genuine gap, not a migration candidate: there is nothing to move into `shared/ui/` today. **Recommendation:** if/when any list grows large enough to need it, build one shared `shared/ui/tables/Pagination.tsx` from day one rather than letting it get reinvented per-page the way the status/severity badge logic was (see 2.8).

### 2.22 Design tokens — `tailwind.config.ts` + `globals.css`

| Field | Detail |
|---|---|
| Current location | `tailwind.config.ts` (`theme.extend.colors.brand`: `red #c8102e`, `redDark #9c0c24`, `redLight #e63950`, `dark #1a1d23`, `gray #5b6168`); `src/app/globals.css` (`.mqr-swal` SweetAlert2 overrides, global `input/select/textarea:focus` ring color, Google Translate widget hiding rules). |
| Purpose | Not a component, but the implicit shared dependency underneath every other item above — every badge, button, and focus ring in this inventory references these same five brand colors. |
| Dependencies | Tailwind CSS. |
| Reusability score | N/A (already global/shared by construction). |
| Recommended shared location | Stays in `tailwind.config.ts`/`globals.css`; just noted here as a dependency so future `shared/ui/` components don't hardcode colors that already have names. |
| Migration priority | N/A. |
| Estimated migration risk | N/A. |

## 3. Recommended migration order

This order optimizes for "prove the pattern works, then move outward from
zero-risk to highest-risk," and deliberately defers anything that touches
live business logic to its own future sprint with explicit approval, per
Sprint 3's safety rules.

1. **Shared dependencies first:** `swal.ts`, `fetchJson.ts` (2.1, 2.2). Pure
   path moves; everything else's imports only need to be updated once.
2. **Zero-prop / trivial presentational atoms:** `PrintButton` (2.12),
   `KpiCard` (2.6), `Panel` (2.7). Cheap wins that validate the `shared/ui/`
   pattern end-to-end before anything riskier is attempted.
3. **Self-contained, single-consumer shells:** `LanguageToggle` (2.4),
   `Sidebar`/`NavLink` (2.3). Low risk, but double-check `@/lib/...` vs
   `@lib/...` path-alias usage before moving.
4. **Generic, multi-export, presentation-only modules:** `charts.tsx` (2.5).
5. **Consolidation-driven extraction (logic merge, not a pure move):**
   status/severity badge components (2.8). Do this only after steps 1-4 have
   proven the migration mechanics, since this step requires reconciling three
   existing implementations, not just relocating one.
6. **Self-contained modules with real async/data dependencies:**
   `LocationPicker`/`MapView` (2.16), `EmptyState` (2.19), `SelectField`
   (2.9), `ConfirmDeleteButton` (2.11).
7. **Service-layer (non-UI) extractions, tested in isolation:**
   `exportExcel.ts` (2.14), the Google Drive upload relay out of
   `report-form.tsx` (2.15a) — re-test live given its documented CORS
   workaround.
8. **Explicitly deferred — do not fold into a simple migration:**
   the `AdminCrudTable` generalization (2.10, touches 5 live admin sections'
   business logic), the print-view/PDF-export unification (2.13, two
   different rendering engines), and any decomposition of `report-form.tsx`
   itself (2.15, 1007 lines). Each of these should be its own future sprint
   with explicit approval before any production code is touched, per Sprint
   3's STOP-and-ask clause.

## 4. Verification

No production files were read-and-modified in the course of this analysis —
only read. No imports, routing, or business logic were changed. The only new
artifacts this sprint produces are this document, `docs/COMPONENT_CATALOG.md`,
and `shared/ui/README.md`.
