# Component Catalog

> Status as of Sprint 3 (Shared UI Inventory). Every entry below was located
> by reading the live `main` branch on GitHub directly (not the local
> `mqr-webapp-new` clone in this workspace, which is confirmed stale — see
> `docs/SHARED_UI_ANALYSIS.md` §0). Organized by the category list from the
> Sprint 3 brief. For migration scoring (reusability/priority/risk), see
> `docs/SHARED_UI_ANALYSIS.md`; this document is the plain reference catalog.

## Sidebar

**`Sidebar`** — `src/app/(app)/sidebar.tsx` (123 lines)
Props: `{ session: SessionUser }`. Renders the brand title, the logged-in
user's name and Thai role label (`roleLabelTh[session.role]`), the primary
nav (`NAV`: หน้าหลัก / รายงานปัญหาคุณภาพ / ติดตามรายงานปัญหาคุณภาพ), a
conditional admin-nav block gated by `canManageMasterData`/`seesAllDealers`,
a mobile hamburger button with a slide-in drawer (`translate-x-0` /
`-translate-x-full`) and a `fixed inset-0 bg-black/50` close-on-click overlay,
and a logout button. Used by exactly one consumer: `src/app/(app)/layout.tsx`.

## Header

No standalone Header component exists. `Sidebar` (above) renders the
brand/user-identity block that would normally live in a Header, and
`LanguageToggle` (below) is rendered separately at the root layout level,
outside the authenticated shell. If a true shared Header is ever wanted, it
would need to be split out of `Sidebar`, not copied from an existing file.

## Navigation

**`NAV` / `adminNav` arrays + inline `NavLink`** — defined inside
`src/app/(app)/sidebar.tsx`. `NAV` is a static `{ href, label }[]`; `adminNav`
is built conditionally based on role. Rendered via
`NAV.map(item => <NavLink key={item.href} {...item} />)`. `NavLink` itself is
a local helper in the same file (not independently exported).

## Buttons

**`PrintButton`** — `src/app/(app)/records/[jobId]/print-button.tsx` (13
lines, no props). `<button onClick={() => window.print()} className="print:hidden ...">พิมพ์รายงาน</button>`.

**`DeleteButton`** — `src/app/(app)/records/[jobId]/delete-button.tsx` (44
lines). Props: `{ jobId: string }`. `swalConfirm()` → `fetchJson()` DELETE →
`router` redirect on success, `swalError()` on failure.

**Primary submit buttons** — no shared component; every form (`report-form.tsx`,
`login/page.tsx`, admin tables) hand-rolls its own `<button disabled={submitting} className="... bg-brand-red hover:bg-brand-redDark ...">`. The class string is consistent enough across files to be worth extracting later (see analysis doc, not yet done).

## Cards

**`KpiCard`** — inline in `src/app/(app)/dashboard/page.tsx`. Props:
`{ label, value, accent?, sub? }`. Small stat card (label + big number).

**`Panel`** — inline in `src/app/(app)/dashboard/page.tsx`. Props:
`{ title, note?, children }`. Generic titled section wrapper, used around
every chart/table on the dashboard.

## Tables

No shared table component exists. Two independent hand-rolled patterns:

- **Admin inline-edit table** — `src/app/(app)/admin/{branches,dealers,problem-codes,technicians,users}/*-table.tsx`. Native `<table>` with a per-row `isEditing` toggle that swaps display text for an `<input>`, plus `createX`/`saveEdit`/`deleteX` handlers. Read in full for `branches-table.tsx` (184 lines); the other four share the same "Task #83" commit message and directory shape.
- **Read-only data table** — e.g. the "Top 10 aging jobs" table inline in `dashboard/page.tsx`, and the records list table in `records/page.tsx`. Plain `<table>`/`<thead>`/`<tbody>`, no shared markup with the admin tables.

## Forms

**`ReportForm`** — `src/app/(app)/report/report-form.tsx` (1007 lines). The
largest single file in the app: vehicle-serial search/autofill, severity
select, location-picker integration, photo/video upload (including a
chunked Google Drive resumable-upload relay), and submit handling, all in one
component.

**`UpdateForm`** — `src/app/(app)/records/[jobId]/update-form.tsx` (227
lines). Status/severity update form for an existing record.

**Login form** — `src/app/login/page.tsx` (74 lines). Username/password,
`fetchJson` + `swal*` pattern.

**Admin inline-edit forms** — see Tables above; each admin table embeds its
own create/edit form fields directly in the table rows rather than a
separate form component.

## Inputs

No shared `<Input>` component. Every text/number input is a native `<input>`
styled ad hoc per file. Global focus styling is centralized in
`src/app/globals.css` (`input, select, textarea { outline: none }` +
`:focus { box-shadow: 0 0 0 2px rgba(200,16,46,.35); border-color: #c8102e }`),
so the *look* is already consistent even though the markup isn't shared.

## Selects

No shared `<Select>` component. The same `<label className="block text-sm font-medium mb-1">` + `<select className="border border-gray-300 rounded px-3 py-2">` markup pattern is hand-repeated in at least two places: the dashboard filter bar (`dashboard/page.tsx`: year/month/model/dealer/branch) and the severity select in `report-form.tsx`.

## Dialogs / Modals

No standalone Dialog/Modal React component. Two existing mechanisms cover
this need today:

- **SweetAlert2** (see below) handles every confirm/alert/info popup.
- **Mobile sidebar drawer overlay** — `Sidebar`'s `{open && (<div className="md:hidden fixed inset-0 bg-black/50 z-40 print:hidden" onClick={() => setOpen(false)} />)}` is the closest existing precedent for an on-page modal/overlay, though it's purpose-built for the drawer, not generic.

## SweetAlert wrappers

**`swal.ts`** — `src/lib/swal.ts` (93 lines, fully read). Exports:
`swalSuccess(message, title?)`, `swalError(message, title?)`,
`swalInfo(message, title?)`, `swalConfirm(message, opts?) => Promise<boolean>`,
plus `swalLoading`/`swalClose` (used consistently at call sites). Shared
`baseConfig` sets `customClass: { popup: 'mqr-swal' }` and Thai button text
(`ตกลง`/`ยืนยัน`/`ยกเลิก`). This is the single most reused module in the
codebase — already a de-facto shared component.

## Charts

**`src/app/(app)/dashboard/charts.tsx`** (133 lines, fully read). Five named
exports, all `recharts`-based and data-driven:
- `MonthlyTrendChart({ data })`
- `ParetoChart({ data })` — bar chart with rotated labels + cumulative %
- `StatusBarChart({ data })`
- `SimpleBarChart({ data, dataKey, ... })` — generic vertical bar chart, used for by-model breakdown, status backlog, aging buckets per its own doc comment
- `AgingBarChart({ data })` — per-bucket colored bars via `AGING_COLORS`

## KPI Cards

See **Cards** above (`KpiCard`).

## Filters

Dashboard filter bar — inline in `dashboard/page.tsx`, a row of native
`<select>`s (year/month/model/dealer/branch) backed by `searchParams`, built
from `THAI_MONTHS_FULL`/`buildYearOptions` (`@/lib/thaiDate`) and
`stats.filterOptions`. No shared `FilterBar` component.

## Search bars

**Vehicle serial autofill** — inline in `report-form.tsx`. Looks up
`/api/vehicles/[serial]` on blur (`checkSerialExact`) to autofill model/vehicle
data, with a `vehicleLoading`/`vehicleChecked` state pair.

**Place search** — `location-picker.tsx` (155 lines, fully read). Queries
`https://nominatim.openstreetmap.org/search?...&accept-language=th` (Thai
place names preferred), shows a results dropdown, `searching`/`searchError`
states, and `selectResult()` to commit a chosen lat/lng.

## Pagination

**Not implemented anywhere.** Both `records/page.tsx` and every admin table
render their full result set with no page controls. Confirmed absent, not
just unobserved — flagged as a gap in `docs/SHARED_UI_ANALYSIS.md` §2.21.

## Empty States

**Inline "no data" row** — `records/page.tsx`: `{records.length === 0 && (<tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr>)}`. The only confirmed empty-state UI found in the scanned codebase; not confirmed present in the admin tables.

## Loading States

- `swalLoading()` / `swalClose()` (part of `swal.ts`) — the de-facto shared "blocking async action" loading indicator, used by every form/table's create/save/delete handlers.
- Map-loading skeleton — `location-picker.tsx`'s `next/dynamic` `loading: () => (<div className="h-64 w-full rounded border border-gray-200 bg-gray-50 flex items-center justify-...">กำลังโหลดแผนที่...</div>)`, shown while `map-view.tsx` loads client-side (Leaflet needs `window`, so it's dynamically imported with `ssr: false`).
- Various local booleans (`vehicleLoading`, `searching`, `busy`, `submitting`) gate disabled states on buttons/inputs throughout forms; no shared spinner/skeleton component backs these.

## Print Components

**`PrintButton`** — see Buttons above.

**`PrintView`** — `src/app/(app)/records/[jobId]/print-view.tsx` (224 lines).
Its own header comment states it is "built to mirror the PDF export
(`src/lib/exportPdf.tsx`) layout exactly." Defines its own `SEVERITY_COLORS`
map (a third, independent copy of the badge-color logic — see
`docs/SHARED_UI_ANALYSIS.md` §2.8). Hidden on screen, shown only via
`@media print` (`hidden print:block`).

## Export Components

**`exportPdf.tsx`** — `src/lib/exportPdf.tsx` (497 lines). Server-side PDF
generation via `@react-pdf/renderer` (`Document`/`Page`/`Text`/`View`/
`StyleSheet`/`Font`/`Image`/`Link`/`renderToBuffer`) plus a `qrcode` library
for an embedded QR code.

**`exportExcel.ts`** — `src/lib/exportExcel.ts` (122 lines). `exceljs`-based,
column-config-driven (`LIST_COLUMNS: { header, key, width }[]`) export of the
records list (job ID, found date, model, serial, customer, problem code,
hours, warranty status, status, ...).

## Upload Components

No standalone upload component — the logic lives inline inside
`report-form.tsx`:

**`putFileViaServerRelay()`** — an inline async function in `report-form.tsx`
that uploads a file to a Google Drive resumable-upload session in ≤4 MiB
chunks, relayed through the app's own `/api/upload/chunk` route (to avoid a
documented, confirmed-live 2026-06-25 CORS failure on a direct browser→Drive
PUT), with a 3-attempt retry loop and an `onProgress` callback. Plain
`<input type="file" accept="video/*">` / image inputs trigger it.

## Shared non-UI services worth tracking alongside this catalog

- **`fetchJson.ts`** — `src/lib/fetchJson.ts` (64 lines). Fetch wrapper +
  `FetchJsonError`, used by every form/table that talks to an API route.
- **Brand design tokens** — `tailwind.config.ts` (`brand.red #c8102e`,
  `redDark #9c0c24`, `redLight #e63950`, `dark #1a1d23`, `gray #5b6168`) and
  `src/app/globals.css` (`.mqr-swal` overrides, global input focus ring,
  Google Translate widget hiding). Every component above ultimately depends
  on these.

## Cross-references

- Migration scoring (reusability/priority/risk) for each item above:
  `docs/SHARED_UI_ANALYSIS.md` §2.
- Recommended migration order: `docs/SHARED_UI_ANALYSIS.md` §3.
- Target folder for future migrations (currently empty, README only):
  `shared/ui/README.md`.
