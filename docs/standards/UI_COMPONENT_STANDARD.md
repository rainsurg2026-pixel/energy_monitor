# Mahindra After Sales Platform (MASP)
# UI Component Standard
# Release 1.0

## Objective

Document the reusable UI design system for MASP: every recurring
component, and the design tokens (spacing, typography, color, etc.) that
govern them.

**This is a documentation sprint only.** Nothing in this document changed
application code, redesigned a screen, or added a business feature. It
records what exists today, calls out where the same UI concept has
multiple, drifting implementations, and recommends (but does not perform)
consolidations for a future implementation sprint.

This document is separate from `docs/standards/DOMAIN_LANGUAGE_STANDARD.md`
(business terminology/localization) and
`docs/engineering/NAMING_CONVENTION.md` (source code naming).

## How to read this document

For each component: **Canonical pattern** (the version to standardize on
going forward — normally the version already shared/most consistent),
**Current implementations** (every place the pattern actually appears,
verbatim from the code), and **Verdict** (reuse as-is / consolidate /
extract new shared component).

---

## Frozen Design Tokens

These are already-in-use values, frozen as the standard — not new
choices. Any new UI must draw from this list rather than inventing a new
value.

### Color Palette

Defined in `tailwind.config.ts`:

| Token | Value | Usage |
|---|---|---|
| `brand.red` | `#c8102e` | Primary action color, links, accents |
| `brand.redDark` | `#9c0c24` | Gradient end, hover states |
| `brand.redLight` | `#e63950` | Gradient start |
| `brand.dark` | `#1a1d23` | Primary text, sidebar background |
| `brand.gray` | `#5b6168` | Secondary text |
| `gradient-primary` | `linear-gradient(135deg, #e0153a 0%, #9c0c24 100%)` | `.btn-primary`, sidebar active nav item |
| `gradient-dark` | `linear-gradient(135deg, #2a2e36 0%, #1a1d23 100%)` | Reserved, not yet used in a live screen |

Neutral grays and semantic colors (success/warning/error/info) use
Tailwind's stock palette directly (`gray-*`, `green-*`, `amber-*`,
`red-*`, `blue-*`, `orange-*`, `purple-*`) — no custom semantic-color
tokens exist. Standardize on this rather than introducing named tokens
like `color.success`.

### Status Colors

Authoritative table: `docs/standards/DOMAIN_LANGUAGE_STANDARD.md` → Status
Colors. Implemented today only in `src/app/(app)/records/page.tsx`'s
`statusColor` map (Tailwind `bg-*-100 text-*-700` pairs). Severity badges
(`Critical`/`Major`/`Minor`) use a separate, un-frozen ad-hoc map
(red/amber/blue) duplicated across `records/page.tsx`,
`records/[jobId]/page.tsx`, and `dashboard/page.tsx` — see **Status
Badges** below.

### Border Radius

| Token | Value | Usage |
|---|---|---|
| `rounded` | `0.25rem` | Inputs, small buttons, filter-bar controls |
| `rounded-lg` | `0.5rem` | `.btn` family |
| `rounded-xl` | `0.75rem` | Cards (`.card`), page panels |
| `rounded-full` | 9999px | Badges/pills, avatar-style elements |

Inconsistency found: several hand-rolled "card" containers use bare
`rounded` (4px) instead of `rounded-xl` (12px) — see **Cards** below.

### Shadow

| Token | Value | Usage |
|---|---|---|
| `shadow-card` | `0 1px 3px rgba(15,23,42,.06), 0 1px 2px rgba(15,23,42,.04)` | `.card` utility class |
| `shadow-card-hover` | `0 8px 24px rgba(15,23,42,.10), 0 2px 6px rgba(15,23,42,.06)` | `.card-interactive` hover state |
| `shadow-glow` | `0 4px 14px rgba(200,16,46,.28)` | `.btn-primary`, active sidebar nav item |
| `shadow-sm` (Tailwind stock) | — | Used ad-hoc in place of `shadow-card` in several screens (see **Cards**) |

### Typography

No custom font-size scale is defined — screens use Tailwind's stock type
scale directly. Observed (not yet fully consistent) convention:

| Role | Class(es) observed | Where |
|---|---|---|
| Page title (H1) | `text-2xl font-bold text-brand-dark` | `records/page.tsx`, `dashboard/page.tsx` |
| Page title (H1), smaller variant | `text-xl font-bold text-brand-dark` | `pm-records/[id]/page.tsx`, `vehicles/[serial]/page.tsx`, `records/[jobId]/page.tsx` (uses `text-2xl` here — inconsistent with the PM/Vehicle detail pages) |
| Section title (H2) | `text-lg font-semibold text-brand-dark` or `font-semibold text-brand-dark` (no explicit size, defaults to `text-base`) | Mixed across dashboard Panels vs. detail-page `<section>`s |
| Field/detail label | `text-xs uppercase tracking-wide text-gray-500` or `text-gray-400 text-xs` (no `uppercase`/`tracking-wide`) | Both patterns coexist — Vehicle 360/PM detail use the former, MQR detail uses the latter |
| Body text | `text-sm` | Universal |
| Sarabun (Thai) PDF body | `fontSize: 9` (react-pdf) | `lib/exportPdf.tsx`, `maintenancePdf.tsx` |

**Recommendation:** freeze page-title on `text-xl font-bold text-brand-dark`
(the majority pattern) and fix `records/[jobId]/page.tsx`'s outlier
`text-2xl` in a future pass; freeze field-label on
`text-xs uppercase tracking-wide text-gray-500` (the more deliberate,
detail-page pattern) and migrate MQR detail's plain `text-gray-400 text-xs`
to match. Not changed in this sprint (documentation only).

### Spacing

No custom spacing scale — Tailwind's stock 4px-step scale is used
directly. Observed conventions:

- Page-level vertical rhythm: `space-y-4` (detail pages) or `space-y-8`
  (dashboard, which has more distinct zones).
- Card/panel internal padding: `p-4` (compact — filter bars, dashboard
  filter form) or `p-5`/`p-6` (content cards — inconsistent, see **Cards**).
- Grid gaps: `gap-3` or `gap-4` for detail-row grids, `gap-6` for
  dashboard two-column panel grids.

### Icon Usage

Per `.claude/rules/04-ui-feedback-conventions.md`: **no icon library** —
inline SVG (nav chevrons/hamburger/close) or emoji (sidebar module icons,
per `DOMAIN_LANGUAGE_STANDARD.md`'s Official Menu Standard: 🏠 ⚠️ 🔧 🚜 ⚙️
👥) are the only two icon mechanisms. Do not introduce an icon library
without an explicit decision (see `docs/ROADMAP.md`).

### Button Hierarchy

Frozen in `globals.css` (`@layer components`) — this is the one area
that's already fully consolidated and should be reused everywhere:

| Class | Use for |
|---|---|
| `.btn-primary` | The one primary action per view (Save, + New Report, Export) |
| `.btn-secondary` | Secondary actions (Export Excel/PDF, Back, Cancel-as-navigation) |
| `.btn-outline-danger` | Destructive actions (Delete) |
| `.btn-ghost` | Low-emphasis inline actions |

**Inconsistency found:** several filter-bar "Filter" buttons
(`dashboard/page.tsx`, `records/page.tsx`) use a bespoke
`px-4 py-2 rounded border border-gray-300 text-sm bg-gray-50` instead of
`.btn-secondary`, which renders nearly identically but isn't sourced from
the shared class. Row-level action buttons in the 5 admin CRUD tables
(`ActionButtons.tsx`) intentionally use plain text-link-style buttons
(`text-blue-600 text-xs font-medium`, `text-brand-red text-xs font-medium`)
rather than the `.btn-*` family — a deliberate, already-shared exception
for dense table rows, not a bug.

### Form Layout

Two coexisting patterns:

1. **Shared field components** (`components/shared/forms/TextField.tsx`,
   `SelectField.tsx`) — used by the PM History Center
   (`maintenance-history.tsx`, `maintenance-search.tsx`) and the PM
   create/edit form.
2. **Raw `<input>`/`<select>` with a manually-written `<label>`** — used
   by the MQR records list/filter bar, the dashboard filter form, and the
   report form (`report-form.tsx`). Every one of these hand-rolls the same
   `block text-xs font-medium mb-1` label + `border border-gray-300 rounded
   px-3 py-2 text-sm` input classNames independently.

**Recommendation:** migrate the MQR-side filter bars to
`TextField`/`SelectField` in a future implementation sprint — the classes
are already byte-for-byte identical, so this is a pure extraction, not a
redesign.

### Table Layout

Three coexisting patterns:

1. **`AdminCrudTable`** (shared component) — the 5 admin master-data
   screens (Dealers, Branches, Technicians, Users, Problem Codes).
2. **`@tanstack/react-table`** — the PM History Center
   (`maintenance-history.tsx`, `maintenance-search.tsx`) only.
3. **Raw hand-written `<table>`** — MQR records list (`records/page.tsx`),
   dashboard's "Top Aging Jobs" and leaderboard tables
   (`dashboard/page.tsx`).

All three render visually similar tables (`bg-gray-50 text-gray-500`
header row, `border-t border-gray-100` row dividers, `px-3`/`px-4` cell
padding) but via three different code paths. Not consolidated in this
sprint — see **Recommended Consolidations**.

### Responsive Rules

Mobile-first throughout, per `.claude/rules/04-ui-feedback-conventions.md`
— base styles unprefixed, `sm:`/`md:`/`lg:` overrides layer on top. The
sidebar's mobile drawer pattern (`sidebar.tsx`: fixed off-canvas panel,
hamburger trigger, backdrop overlay, `md:static md:translate-x-0` to
become permanent on desktop) is the one fully-formed reusable responsive
pattern in the app and should be the reference for any future off-canvas
UI. Detail-page grids consistently step `grid-cols-1 → sm:grid-cols-2 →
lg:grid-cols-4` (or `lg:grid-cols-3`) — already consistent, no
consolidation needed.

---

## Component Standard

### Page Header

**Canonical pattern:** `<h1>` (page title) + optional `<p>` subtitle, in a
`flex items-center justify-between` row with a right-aligned action-button
cluster.

**Current implementations:** `records/page.tsx`, `pm-records/[id]/page.tsx`,
`vehicles/[serial]/page.tsx`, `records/[jobId]/page.tsx`,
`dashboard/page.tsx` — all follow the same structural shape but with the
title-size inconsistency noted above under Typography.

**Verdict:** Consolidate into a shared `<PageHeader title subtitle actions />`
component in a future sprint — the structure is already uniform, only the
title font-size and the presence/absence of a subtitle vary.

### Section Header

**Canonical pattern:** `<h2 className="font-semibold text-brand-dark">`
(optionally `text-lg` for dashboard-level sections, optionally with a
`text-xs text-gray-400` note line underneath), directly inside a card.

**Current implementations:** every `<section>`/card block on the MQR/PM
detail pages, every dashboard `Panel`.

**Verdict:** Already reasonably consistent. Fold into the same future
`PageHeader`/`SectionHeader` pair rather than a standalone effort.

### Toolbar

**Canonical pattern:** the page-header's right-aligned button cluster
(Export Excel / Export PDF / Export CSV / + New / Back to List), always
`.btn-secondary` for export/back and `.btn-primary` for the one create
action.

**Current implementations:** `records/page.tsx` (Excel/PDF/CSV export +
"+ รายงานปัญหาใหม่"), `pm-records/[id]/page.tsx` (Export PDF/Edit/Back/Unlock/Delete).

**Verdict:** Reuse as-is; this is really the same component as Page Header's
action slot, not a separate concept.

### Search Bar

**Canonical pattern:** a labeled text `<input>` inside the Filter Bar form
(no standalone search-only component exists).

**Current implementations:** `records/page.tsx`'s `q` field (raw input),
`maintenance-history.tsx`/`maintenance-search.tsx` (via `TextField`),
`vehicle-search-box.tsx` (a genuinely standalone, debounced,
results-dropdown search — structurally different from the others, and the
only "live-search-as-you-type" pattern in the app).

**Verdict:** `vehicle-search-box.tsx`'s live-search pattern is worth
extracting as a reusable `<LiveSearchBox />` if a second module ever needs
type-ahead search (PDI/NTR serial lookup, etc.) — not needed today with
only one caller.

### Filter Bar

**Canonical pattern:** `<form className="card p-4 flex flex-wrap gap-3 items-end">`
with labeled `<select>`/`<input>` fields, a "Filter" submit button, and a
conditional "Clear filter" link.

**Current implementations:** `records/page.tsx` (uses `.card`),
`dashboard/page.tsx` (uses ad-hoc
`bg-white rounded-xl shadow-sm border border-gray-100` instead of `.card`
— see **Cards** duplication below), `maintenance-history.tsx` (its own
filter panel, built on `TextField`/`SelectField` plus a quick-filter chip
row not present anywhere else).

**Verdict:** Consolidate the two MQR-side filter bars onto `.card` (trivial
className fix) and onto `TextField`/`SelectField` (matches PM's already-built
pattern) in a future sprint.

### Cards

**Canonical pattern:** the `.card` utility class
(`bg-white rounded-xl shadow-card border border-gray-100`), optionally
`.card-interactive` for hover lift.

**Current implementations — three drifting variants found:**

1. `.card` (correct) — `records/page.tsx`.
2. `bg-white rounded-xl shadow-sm border border-gray-100` (ad-hoc,
   `shadow-sm` instead of the frozen `shadow-card` token) —
   `dashboard/page.tsx`'s `KpiCard`/`Panel`, `records/[jobId]/page.tsx`'s
   `<section>` blocks.
3. `rounded border border-gray-200 bg-white p-6 shadow-sm` (ad-hoc, `rounded`
   4px instead of `rounded-xl` 12px, `border-gray-200` instead of
   `border-gray-100`) — `vehicles/[serial]/page.tsx`, `pm-records/[id]/page.tsx`.

**Verdict — the single highest-value consolidation in this audit:**
replace all three with `.card` (or a thin `<Card>` wrapper component if
per-instance padding needs a prop). Purely a className swap, zero visual
redesign intended (the token values are close enough that this is a
correction toward one intended look, not a new design).

### KPI Cards

**Canonical pattern:** `dashboard/page.tsx`'s local `KpiCard` — white
card, `text-sm text-gray-500` label, `text-3xl font-bold` value, optional
accent color and `text-xs text-gray-400` sub-label.

**Current implementations:** only exists as a **dashboard-local, unexported
function** — not shared. `vehicles/[serial]/page.tsx`'s Health
Score/Compliance stat tiles are visually the same concept (a labeled
number in a box) but implemented independently with smaller
padding/radius/font-size (`rounded border-gray-100 bg-gray-50 p-3`,
`text-2xl font-bold`, `text-xs uppercase` label) — a duplicate with visual
drift, not just a code duplicate.

**Verdict:** Extract `KpiCard` out of `dashboard/page.tsx` into
`components/shared/`, and migrate Vehicle 360's stat tiles onto it in a
future sprint. Until then, treat `dashboard/page.tsx`'s version as
canonical.

### Tables

See **Table Layout** under Frozen Design Tokens above — three coexisting
implementations (`AdminCrudTable`, TanStack react-table, raw `<table>`).
**Verdict:** do not unify all three in one sprint (real behavioral
differences: TanStack table has sorting/column-visibility/row-selection
that a raw `<table>` doesn't need for a 50-row-paginated MQR list) — but
any *new* module's list screen should default to `AdminCrudTable`-style
for simple CRUD, TanStack for anything needing client-side
sort/select/column control, and never introduce a fourth pattern.

### Status Badges

**Canonical pattern:** `<span className="rounded-full px-2 py-0.5 text-xs font-medium {colorClasses}">`.

**Current implementations:**
- `StatusBadge.tsx` (shared) — active/inactive pill, admin tables only.
- MQR status color map — `records/page.tsx` only (`records/[jobId]/page.tsx`'s
  own status badge is a flat, uncolored `bg-gray-100 text-gray-700`, not
  using the map at all — an inconsistency, not just a duplicate).
- Severity color map — duplicated ad-hoc (not extracted, not shared)
  across `records/page.tsx`, `records/[jobId]/page.tsx`, `dashboard/page.tsx`.
- PM lock/health/maintenance-due badges — each has its own inline color
  map (`DUE_COLOR_CLASS`, `HEALTH_STATUS_CLASS` in `vehicles/[serial]/page.tsx`).

**Verdict:** Extract one shared `<StatusPill status colorMap />` (generic
over any status→color record, not MQR-specific) that every one of the
above can pass its own map into — consolidates the *rendering*, keeps
each domain's *color mapping* separate (correct, since MQR status colors,
severity colors, and health colors are genuinely different vocabularies).

### Action Buttons

Covered under **Button Hierarchy** above. `ActionButtons.tsx` (shared) is
already correctly extracted and reused across all 5 admin tables — no
further consolidation needed there.

### Dialogs / Confirmation Dialogs / Toast Messages

**Canonical pattern:** `lib/swal.ts` — `swalConfirm()`,
`swalSuccess()`/`swalError()`/`swalInfo()`,
`swalSuccessToast()`/`swalErrorToast()`, `swalLoading()`/`swalUpdateLoading()`/`swalClose()`,
`swalPrompt()`. Per `.claude/rules/04-ui-feedback-conventions.md`, this is
the **only** permitted feedback mechanism app-wide (no `alert()`, no
`confirm()`, no inline banners).

**Current implementations:** already fully consolidated — every caller
found in this audit (`delete-button.tsx`s, `unlock-button.tsx`, admin
tables, report form, maintenance form) goes through `swal.ts`.

**Verdict:** No consolidation needed — this is the model the rest of the
system should follow.

### Empty States / Loading States

**Canonical pattern:** `LoadingState.tsx`/`EmptyState.tsx` (shared,
`<tr><td colSpan>message</td></tr>` row for `AdminCrudTable`).

**Current implementations:** the shared components exist but, per their
own doc comments, **are not wired into any of the 5 admin tables yet**
(none of those screens had a loading/empty row before they were
extracted). Other screens each hand-roll their own empty-state text
inline (`ยังไม่มีข้อมูล`, `ยังไม่มีประวัติ`, `ยังไม่มีเหตุการณ์ในประวัติรถคันนี้` — three
different wordings for the same "nothing here yet" concept, now at least
routed through the i18n dictionary per `DOMAIN_LANGUAGE_STANDARD.md`, but
still three different markup implementations: a `<tr><td>`, a `<p>` inside
a card, and a `<p>` inside an `<ol>`'s empty branch).

**Verdict:** Wire `LoadingState`/`EmptyState` into the 5 admin tables
(pure connection, they already exist and match); extract a
non-table-row variant (`<EmptyPanel message />`) for card/list contexts
in a future sprint.

### Timeline

**Canonical pattern:** none — genuinely duplicated, not just drifted.

**Current implementations:**
- MQR detail page's Audit Trail section (`records/[jobId]/page.tsx`):
  `<ol className="space-y-2 text-sm">`, each entry a `<li>` with a
  timestamp/event-type badge row and an optional field-change line.
- Vehicle 360's "Tractor Life Cycle" section (`vehicles/[serial]/page.tsx`):
  `<ol className="space-y-3">` with a separate `TimelineRow` function,
  same visual concept (timestamp, type badge, description, actor), built
  independently with different spacing (`space-y-2` vs `space-y-3`) and a
  different badge style (`rounded-full bg-brand-dark/5` vs no badge
  background at all on the MQR side's field-change line).
- PM detail's audit trail (implied by `AUDIT_EVENT_LABELS_TH`/`auditEvent`
  dictionary namespace being shared with MQR) is not yet rendered on the
  PM detail page at all — a real gap, not a duplication.

**Verdict:** Extract one shared `<Timeline events />` component consuming
the already-shared `AuditLogEntry`/`VehicleEvent`-shaped data — highest
duplication-to-consolidation payoff after Cards.

### Attachment Gallery / Photo Viewer

**Canonical pattern:** none — genuinely duplicated.

**Current implementations:**
- MQR detail page: `PHOTO_CATEGORIES.map(...)` → `grid grid-cols-2
  sm:grid-cols-4 gap-3` of `<a href={url} target="_blank"><img .../></a>`
  tiles, grouped by category with a category-label caption.
- PM detail page: a flat (non-categorized-loop) `grid gap-3 sm:grid-cols-3`
  of up to 3 fixed photo slots (meter/nameplate/report), each a bare
  `<img>` with no click-to-enlarge link at all (MQR's version opens the
  full image in a new tab; PM's version doesn't).
- Neither has an in-page lightbox/viewer — "Photo Viewer" as a distinct
  concept from "Attachment Gallery" doesn't exist yet anywhere in the app;
  both current implementations only open the raw image URL in a new
  browser tab.

**Verdict:** Extract a shared `<AttachmentGallery items />` (grid + new-tab
link, matching MQR's already-slightly-better behavior) and apply it to
both MQR and PM detail pages. A true in-app lightbox/Photo Viewer would be
a genuine new feature, not a consolidation — out of scope for this
documentation sprint and for any "no new business features" follow-up
unless separately requested.

### PDF Header / PDF Footer

**Canonical pattern:** `lib/exportPdf.tsx`'s `styles` (`StyleSheet.create`):
`headerRow` (brand title + printed-at timestamp + QR code with caption on
the right) and `footer` (absolute-positioned, bottom-right, the record's
public URL).

**Current implementations:** `maintenancePdf.tsx` (PM) defines its own
`StyleSheet.create({...})` with **byte-for-byte identical** `page`,
`headerRow`, `title`, `titleRule`, `subtitle`, `qr`, `qrCaption`,
`badgeRow`, `badge` style objects, copy-pasted rather than imported —
confirmed by direct comparison of both files. `lib/pdf/` already holds the
genuinely-shared pieces (`fonts.ts`, `fetchImage.ts`, `PdfBrandLogo.tsx`,
`brand.ts`), so the infrastructure for sharing the style sheet too already
exists; only the `StyleSheet.create()` call itself was never extracted.

**Verdict:** Move the shared subset of `styles` (page/headerRow/title/
titleRule/subtitle/qr/qrCaption/footer at minimum) into
`lib/pdf/sharedStyles.ts` and have both renderers import it. Zero visual
change — the styles are already identical, this only removes the
copy-paste.

---

## Component Inventory

| Component | Shared component exists? | Location | Reused by |
|---|---|---|---|
| Page Header | No | — (pattern only) | records, pm-records, vehicles, dashboard |
| Section Header | No | — (pattern only) | all detail pages, dashboard Panels |
| Toolbar | No | — (same as Page Header's action slot) | records, pm-records |
| Search Bar | Partial | `vehicle-search-box.tsx` (1 real component) | vehicles only |
| Filter Bar | No | — (pattern only) | records, dashboard, maintenance-history |
| Cards | Yes (`.card` CSS class) | `globals.css` | records only — 2 other pages use ad-hoc variants |
| KPI Cards | No | `dashboard/page.tsx` (local, unexported) | dashboard only |
| Tables | Yes (partial — 3 patterns) | `AdminCrudTable.tsx`, TanStack, raw | admin (5), PM history, MQR list/dashboard |
| Status Badges | Yes (partial) | `StatusBadge.tsx` (active/inactive only) | admin tables only |
| Action Buttons | Yes | `ActionButtons.tsx` | admin tables (5) |
| Dialogs / Confirm / Toast | Yes | `lib/swal.ts` | app-wide |
| Empty States | Yes (not wired up) | `EmptyState.tsx` | none yet |
| Loading States | Yes (not wired up) | `LoadingState.tsx` | none yet |
| Timeline | No | — (2 independent implementations) | MQR detail, Vehicle 360 |
| Attachment Gallery | No | — (2 independent implementations) | MQR detail, PM detail |
| Photo Viewer | Does not exist | — | — |
| PDF Header/Footer | No (duplicated) | `exportPdf.tsx` + `maintenancePdf.tsx` | MQR PDF, PM PDF |
| Form fields (Text/Select) | Yes (partial) | `components/shared/forms/` | PM history/search/form only |

## Duplicate Components

Ranked by how exact the duplication is (copy-paste first, drifted-clone last):

1. **PDF `StyleSheet` objects** — `exportPdf.tsx` vs `maintenancePdf.tsx`:
   byte-for-byte identical style objects, copy-pasted.
2. **Attachment Gallery** — MQR detail vs PM detail: same concept,
   different grid columns, different click-to-enlarge behavior.
3. **Timeline** — MQR Audit Trail vs Vehicle 360 Tractor Life Cycle: same
   concept, different spacing/badge styling, built independently.
4. **Cards** — 3 different className combinations for the same visual
   card across `records/page.tsx` / `dashboard/page.tsx` /
   `vehicles/[serial]/page.tsx` + `pm-records/[id]/page.tsx`.
5. **KPI/stat tiles** — dashboard's `KpiCard` vs Vehicle 360's inline stat
   boxes: same concept, different size/radius/font-scale.
6. **Filter bar form fields** — raw `<input>`/`<select>` (MQR, dashboard)
   vs `TextField`/`SelectField` (PM) for the identical visual result.
7. **Tables** — `AdminCrudTable` vs TanStack react-table vs raw
   `<table>`, three code paths for visually-similar tables.
8. **Empty-state wording** — three different literal phrasings for "no
   data yet" across MQR/PM/Vehicle 360, not routed through one component
   (now at least all pulled from the i18n dictionary, per the
   Localization Standard, but still three separate markup sites).

## Recommended Consolidations

*(Documented for a future implementation sprint — not performed here, per
this sprint's "documentation only" scope.)*

| Priority | Consolidation | Effort | Risk |
|---|---|---|---|
| 1 | Extract shared PDF `StyleSheet` into `lib/pdf/sharedStyles.ts` | Low | None — styles already identical |
| 2 | Replace ad-hoc card classNames with `.card` everywhere | Low | None — token values already close, pure className swap |
| 3 | Extract `<Timeline events />` from MQR Audit Trail + Vehicle 360 Life Cycle | Medium | Low — both already consume the same `AuditLogEntry`/event shape |
| 4 | Extract `<AttachmentGallery items />` from MQR + PM photo grids | Medium | Low — align PM's missing click-to-enlarge onto MQR's existing behavior |
| 5 | Extract `KpiCard` out of `dashboard/page.tsx` into `components/shared/` | Low | None |
| 6 | Wire `LoadingState`/`EmptyState` into the 5 admin tables | Low | None — components already exist and match |
| 7 | Migrate MQR/dashboard filter bars onto `TextField`/`SelectField` | Medium | Low — classNames already byte-identical to what's being replaced |
| 8 | Extract shared `<StatusPill status colorMap />` | Medium | Low — keeps each domain's color map separate, only unifies rendering |
| 9 | Extract `<PageHeader title subtitle actions />` | Medium | Low — fixes the title-size inconsistency as a side effect |

None of these are required before the next feature module (PDI/NTR) is
built — they reduce future duplication, not fix a defect blocking current
work.

## PASS / FAIL

**PASS**, with the findings above logged as follow-up debt rather than
sprint failures:

- ✅ `docs/standards/UI_COMPONENT_STANDARD.md` created.
- ✅ All 19 requested component categories documented with real
  file/line evidence, not assumptions.
- ✅ Design tokens (spacing, typography, color, status colors, radius,
  shadow, icon usage, button hierarchy, form layout, table layout,
  responsive rules) frozen from actual current usage.
- ✅ No application code changed, no screen redesigned, no business
  feature added.
- ✅ PDI/NTR not implemented or referenced beyond the terminology already
  established in `DOMAIN_LANGUAGE_STANDARD.md`.
- ⚠️ 8 duplicate-component findings and 9 recommended consolidations are
  real, pre-existing inconsistencies this sprint intentionally did not
  fix (out of scope by the sprint's own instruction) — tracked above for
  a future implementation sprint.

---

From the commit that introduces this file forward, any new component in
one of the 19 standardized categories must reuse the canonical pattern
documented here (or the shared component, where one exists) rather than
introducing a 4th/5th implementation of the same concept.
