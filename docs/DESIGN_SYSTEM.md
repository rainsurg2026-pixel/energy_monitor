# Design System

> **Status update (Enterprise UI/UX Standardization, part of the
> post-v1.1.0 development line):** several items this document originally
> described as forward-looking are now real, shipped code - PM Record and
> NTR are fully built business modules (not hypothetical), and the
> "persistent fixed header" described under **Header** below now exists
> as `src/components/shared/layout/PlatformHeader.tsx` (module title/
> breadcrumb left, language selector/notification placeholder/user+role+
> dealer+branch/user-menu-with-logout right - see `docs/UI_STANDARD.md`
> for the exact current-state component inventory and design tokens
> actually in force today). This document is kept as the longer-range
> target vision; where it and `UI_STANDARD.md` disagree on what's
> *already built*, `UI_STANDARD.md` is authoritative for current state.

## Scope and Intent — Read This First

This document defines the **target UI/UX standard for the entire MSEAL SERVICE SYSTEM**. It is intentionally forward-looking and independent of any single existing module's current appearance:

- **PM Record is not yet implemented** in this repository, so it cannot be (and is not) used as the design reference here.
- **The current MQR UI is not treated as the design standard either.** MQR is an existing, working application, but its present screens were built before this design system existed and are not assumed to already conform to it.
- MQR's codebase (`shared/ui/`, `shared/admin/`) is referenced only to identify **reusable patterns and components already worth keeping** — not as a description of the target look.

This document describes where the platform's UI is going, not where one module happens to be today. Three commitments follow from that:

1. **MQR will gradually migrate to this design system without changing business logic.** Migration is a presentation-layer effort — screens are restyled and restructured to match this document; the data, permissions, and workflows behind them do not change as part of that migration.
2. **PM Record will be the first business module implemented directly on this design system**, with no legacy UI to migrate away from.
3. **All future modules** — New Tractor Delivery, NTR, Warranty, Parts Request, Campaign, Dealer KPI, Service Bulletin, and any module added after this sprint — **must follow this design system** rather than introducing their own visual language.

## Layout

A consistent application shell wraps every module: a fixed header, a collapsible sidebar for navigation, and a main content area. The shell is implemented once in `shared/ui/` and composed by each module — a module supplies its page content, not its own header or sidebar.

- Single-column content area on mobile; sidebar collapses to an overlay/drawer.
- Two-region layout (sidebar + content) on tablet and desktop, with the sidebar collapsible to icon-only to reclaim width.
- Consistent max-width and padding rhythm across modules so switching modules doesn't feel like switching products.

## Header

- Persistent across all modules: product identity (MSEAL SERVICE SYSTEM), current module name, and global actions (notifications, user menu, logout).
- Does not vary in structure per module; only the "current module" label and module-specific quick actions change.

## Navigation / Sidebar

- Primary navigation lists the business modules the signed-in user has permission to access (see `shared/admin/PERMISSION_GUIDE.md`) — modules the user cannot access are not shown, not shown-but-disabled.
- Active module and active section are clearly highlighted.
- Collapses to icons-only on smaller viewports or on user preference; never disappears entirely on desktop.

## Dashboard

- Every module exposes a landing dashboard summarizing what the user needs to act on: counts, KPI cards, recent activity, and shortcuts to common actions — not a blank list view.
- Dashboards are built from the same KPI Card and Card primitives used everywhere else, not bespoke per module.

## Cards

- The base visual container for grouping related information (a record summary, a KPI, a dashboard tile).
- Consistent corner radius, elevation/border treatment, and internal padding across all uses.

## Tables

- The standard pattern for list views (see `shared/admin/TABLE_GUIDE.md` for the existing admin-table implementation this design system builds on).
- Sticky header row, consistent row density, consistent empty/loading/error states.
- Row actions (edit, delete, view) follow the same icon and placement convention across every module.
- On mobile, tables collapse to a stacked card-per-row view rather than horizontal scrolling as the default behavior.

## Forms

- Built from a shared set of field components (text, select, date, file/photo, searchable picker) — see `shared/admin/FORM_GUIDE.md`.
- Validation errors appear inline, next to the field, not only in a summary banner.
- Primary action (Save/Submit) is always in the same position relative to the form; destructive actions (Delete, Cancel) are visually de-emphasized relative to it.

## Search

- A single, consistent search input pattern (placement, placeholder convention, debounce behavior) used for every searchable list across modules.
- Search is forgiving: partial matches and common field aliases (e.g. serial number formats) are expected to resolve, consistent with `docs/PRODUCT_PHILOSOPHY.md`'s "Simple UI" principle.

## Filters

- Filters are presented as a clearly separated control group above or beside the list/table they affect, never mixed into table headers.
- Active filters are visible as removable chips/tags so the user always knows what view they're looking at.
- Filter state persists within a session (e.g. returning from a detail view keeps the prior filter), but does not silently persist across unrelated sessions.

## KPI Cards

- A dedicated, reusable component distinct from a generic Card — shows a metric, a label, and optionally a trend/comparison indicator.
- Consistent sizing and grid behavior so KPI rows look the same on every module's dashboard.

## Status Indicators / Status Colors

- A fixed, platform-wide color mapping for status meaning (e.g. pending, in progress, completed, rejected/error), applied consistently via badges/chips — a module does not invent its own color meaning for "approved" vs another module's "completed."
- Status colors meet accessibility contrast requirements (see Accessibility below) and are never the only signal of status — an icon or label always accompanies the color.

## Timeline

- A standard component for showing the chronological history of a record (status changes, actions taken, who/when) — used anywhere a module needs to show "what happened to this record over time" rather than each module building its own activity log UI.

## Notifications

- A consistent in-app notification pattern (toast for transient confirmations/errors, a notification center for persistent items needing attention) shared across modules, backed by the shared `notification` service (see `docs/PLATFORM_SERVICES.md`).
- Toasts follow one visual treatment platform-wide rather than each module styling its own success/error popups.

## Typography

- One type scale and one font stack for the whole platform, applied through shared UI primitives rather than per-module CSS.
- Hierarchy (page title, section heading, body, caption/helper text) is limited to a small, fixed set of styles so every module's text hierarchy reads the same way.

## Icons

- **Corrected by ADR-023** (`docs/adr/ADR-023-MSEAL-Design-Framework.md`):
  this line previously named Lucide React as the platform's icon set,
  contradicting `docs/UI_STANDARD.md`'s current-state, binding rule - no
  icon library has, in fact, ever been introduced. The actual, current
  standard is: **no icon library - inline SVG or emoji**, matching every
  shared component shipped to date (including this framework's own new
  widgets). Do not introduce an icon library without an explicit,
  documented ADR decision.

## Responsive Rules / Mobile-First Considerations

- Every component is designed for the smallest supported viewport first, then enhanced for larger screens — not designed for desktop and then "made to fit" on mobile.
- Touch targets meet a minimum tappable size on mobile; dense desktop table rows are not used as-is on small screens (see Tables above).
- Mobile-first matters in particular because the primary user (per `docs/PRODUCT_PHILOSOPHY.md`'s "Dealer First" principle) is frequently a technician on a phone in a workshop, not a desktop user.

## Accessibility

- Color is never the sole carrier of meaning (status, validation state) — always paired with text or an icon.
- Interactive elements are keyboard-reachable and have visible focus states.
- Form fields have associated labels (not placeholder-only labeling).
- Minimum contrast ratios are met for text and status indicators.

## How New Modules Should Use This Document

A new module's UI work starts by composing existing `shared/ui/` components per the patterns above. A genuinely new pattern is added to `shared/ui/` and this document together — it is not built locally inside the module first and "promoted" later as an afterthought, consistent with `docs/PRODUCT_PHILOSOPHY.md`'s "Reuse Before Create" principle.
