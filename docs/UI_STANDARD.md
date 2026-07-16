# UI Standard — Current State

**This document describes what is actually built and in production
today** (Enterprise UI/UX Standardization, shipped on top of MASP
Platform Foundation v1.1.0). It supersedes the now-partially-stale
findings in `docs/standards/UI_COMPONENT_STANDARD.md` (a documentation-
only audit from an earlier sprint - several of that document's "not yet
extracted" items have since been built; where the two disagree, this
document wins for current state). `docs/DESIGN_SYSTEM.md` remains the
longer-range target vision.

## Shared component library

| Component | Location | Used by |
|---|---|---|
| Platform Header | `components/shared/layout/PlatformHeader.tsx` | Every authenticated page, via `AppShell` |
| App Shell | `components/shared/layout/AppShell.tsx` | `(app)/layout.tsx` - owns the mobile drawer's open/close state so Header and Sidebar agree on one source of truth |
| Sidebar (desktop + mobile drawer) | `app/(app)/sidebar.tsx` | `AppShell` |
| Language Selector | `components/shared/i18n/LanguageSelector.tsx` | `PlatformHeader`, `/login` |
| Google Translate legacy bridge | `components/shared/i18n/GoogleTranslateBridge.tsx` | Root layout only (invisible, mount-once) |
| Notification Bell | `components/shared/layout/NotificationBell.tsx` | `PlatformHeader` (disabled placeholder - no notification backend exists yet) |
| Card | `components/shared/layout/Card.tsx` | Dashboard, NTR/PM/Records/Vehicle detail pages |
| KPI Card | `components/shared/dashboard/KpiCard.tsx` | Dashboard |
| Page Header | `components/shared/layout/PageHeader.tsx` | Every list/detail page |
| Search Toolbar / Filter Bar | `components/shared/layout/SearchToolbar.tsx` | Records, NTR list pages |
| Dealer/Branch Selector | `components/shared/scope/DealerBranchSelector.tsx` + `useDealerBranchScope.ts` | Dashboard, NTR, PM, Records, Report, Maintenance search |
| Attachment Photo Tile | `components/shared/attachments/AttachmentPhotoTile.tsx` | NTR create form, PM create/edit forms |
| Attachment Gallery / Viewer | `components/shared/attachments/AttachmentGallery.tsx` / `AttachmentViewer.tsx` | Record/NTR/PM detail pages |
| Text Field / Select Field | `components/shared/forms/TextField.tsx` / `SelectField.tsx` | NTR, PM, admin tables |
| Status Pill / Status Badge | `components/shared/status/StatusPill.tsx` / `StatusBadge.tsx` | Records list, admin tables |
| Admin CRUD Table shell | `components/shared/admin/AdminCrudTable.tsx` | 9 admin master-data screens |
| Empty State / Loading State (skeleton) | `components/shared/admin/EmptyState.tsx` / `LoadingState.tsx` | Records list, NTR list, PM History Center, admin tables |
| Timeline | `components/shared/timeline/Timeline.tsx` / `TimelineItem.tsx` | Vehicle 360, MQR/PM audit trails |
| Detail Row | `components/shared/layout/DetailRow.tsx` | Every detail page |
| GPS Picker / Map | `components/shared/gps/` | NTR, PM, Report forms |
| PDF shared styles | `lib/pdf/sharedStyles.ts` + `PdfBrandLogo.tsx`/`fonts.ts`/`fetchImage.ts` | MQR PDF (`exportPdf.tsx`), PM PDF (`maintenancePdf.tsx`) |

**Dialogs / confirmations / toasts**: `lib/swal.ts` is the **only**
permitted feedback mechanism app-wide (`.claude/rules/04-ui-feedback-
conventions.md`) - no separate "Dialog" component exists or should be
built; every confirm/alert/toast/loading-progress call goes through it.

## Design tokens (`tailwind.config.ts`)

| Token | Value | Notes |
|---|---|---|
| `colors.brand.red` | `#c8102e` | Primary action color |
| `colors.brand.redDark` / `redLight` | `#9c0c24` / `#e63950` | Gradient stops |
| `colors.brand.dark` | `#1a1d23` | Header/sidebar background, primary text |
| `colors.brand.gray` | `#5b6168` | Secondary text |
| `colors.status.success/warning/danger/info/neutral` | `#16a34a`/`#d97706`/`#dc2626`/`#2563eb`/`#6b7280` | New (this release) - named aliases for the Tailwind stock colors already used ad hoc across status/severity maps. Each domain's own color map is unchanged; new code should reference these names. |
| `borderRadius.card` / `control` | `0.75rem` / `0.25rem` | New (this release) - aliases for the already-used `rounded-xl`/`rounded` values |
| `boxShadow.card` / `card-hover` / `glow` | — | `.card`/`.card-interactive`/`.btn-primary` |
| `backgroundImage.gradient-primary` / `gradient-dark` | — | `.btn-primary`, header/sidebar background |

## Buttons (frozen, `globals.css`)

`.btn-primary` (one primary action per view) / `.btn-secondary`
(secondary actions) / `.btn-outline-danger` (destructive) / `.btn-ghost`
(low-emphasis inline). Reuse these - do not hand-roll a new button
className combination.

## Cards (frozen)

`.card` CSS class, or `<Card variant="elevated" | "flat" | "compact">`
where per-instance padding/layout is needed. All three visual variants
found in the original UI Component Standard audit are now served by this
one component - no further consolidation needed.

## Forms

`TextField`/`SelectField` (`components/shared/forms/`) support a
`required` prop (added this release) rendering a consistent
`text-brand-red` asterisk after the label - the one required-indicator
convention for new/updated forms, replacing a caller manually baking
`" *"` into its own label string.

## Tables

Sticky header, search (via the page's own Filter Bar/Search Toolbar),
pagination, export button, loading skeleton, empty state, and
consistent row actions - implemented today across the MQR records list,
NTR registry list, PM History Center (TanStack table), and the 9 admin
CRUD tables. `AdminCrudTable` is the reference shell for simple CRUD
tables; the PM History Center's TanStack table is the reference for
anything needing client-side sort/column-visibility.

## Attachment Standard

One shared upload tile (`AttachmentPhotoTile`) everywhere: fixed 16:9
frame, `object-contain` (never crop, whole photo always visible), EXIF
auto-rotation happens once at upload time
(`components/shared/attachments/imageProcessing.ts`'s
`processImageForUpload()`), not re-detected at display time.

- **NTR required**: ID Card, Tractor Name Plate (`serial_plate`),
  Delivery Report (`signed_document`). Optional: Hour Meter Photo
  (demoted), Booking Form, Tax Invoice, CRM Lead, Video. Removed from
  the create form: Customer with Tractor Photo (column/existing data on
  older records untouched, just no longer offered on new registrations).
- **PM required**: Service Report only. Optional: Meter Photo, Nameplate
  Photo, Video.
- **Known follow-on scope, not yet built**: PM's newly-requested optional
  slots that don't exist as columns yet (Before Repair, After Repair,
  Failed Part, Machine Overview, Customer Signature) require their own
  migration + type/schema/repository wiring, sized similarly to this
  release's NTR PDI Number addition (see
  `docs/releases/MASP_PLATFORM_FOUNDATION_V1.1.md`) - left as explicit
  future work.

## Accessibility

- `:focus-visible` ring (branded, `#c8102e`, keyboard/programmatic focus
  only) on every `a`/`button`/`[role="menuitem"]`/`[tabindex]` element,
  in addition to the pre-existing branded focus style on form inputs.
- Every interactive control added this release (`PlatformHeader`,
  `LanguageSelector`, `NotificationBell`) uses native `<button>` elements
  (keyboard-operable by default) with `aria-label`/`aria-haspopup`/
  `aria-expanded`/`role="menu"`/`role="menuitem"` as appropriate.
- **Known, accepted, pre-existing lint findings** (not introduced this
  release, not fixed): `jsx-a11y/alt-text` flags `react-pdf`'s `<Image>`
  component in `exportPdf.tsx`/`maintenancePdf.tsx`/`ntrPdf.tsx`/
  `PdfBrandLogo.tsx` - a false positive, since these are PDF documents,
  not HTML pages, and `react-pdf`'s `Image` has no `alt` concept.
- **Not independently verifiable in this environment**: real screen-reader
  testing, precise WCAG contrast-ratio measurement, and physical mobile/
  tablet device testing. Code-level review only (semantic HTML, ARIA
  attributes, focus management) was performed - flagged as manual-
  verification-required in the release report.

## Icon usage

No icon library - inline SVG (nav chevrons, hamburger/close, language
globe, notification bell) or emoji (sidebar module icons, per
`docs/standards/DOMAIN_LANGUAGE_STANDARD.md`'s Official Menu Standard).
Do not introduce an icon library without an explicit decision.
