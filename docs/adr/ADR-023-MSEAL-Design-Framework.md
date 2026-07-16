# ADR-023: MSEAL Design Framework - Navigation, Dashboard, and Widget Standard

**Numbering note**: the next free number after ADR-022 is ADR-023.
`docs/architecture/blueprint/16-ADR-RECOMMENDATIONS.md` separately reserves
ADR-015 through ADR-021 for its own future domain ADRs (Machine Domain v2,
Event Model, Inspection, Knowledge, Engineering Intelligence, Analytics,
Machine Digital Passport) - none of which are written yet. This ADR does
not touch any of those numbers, matching ADR-022's own precedent.

## Status

Accepted. This is a structural/organizational decision, **not a visual
redesign** - existing Tailwind design tokens, brand colors, and the
"frozen" buttons/cards/typography documented in `docs/UI_STANDARD.md`
are unchanged. What changes is navigation taxonomy, dashboard composition
rules, a small set of new reusable widget components, and - for the first
time - a permanent, governed Design Framework document set.

This also formally reopens two things that were, until now, either
document-only or absent entirely:

1. `docs/adr/ADR-005-Design-System.md`'s aspirational `docs/DESIGN_SYSTEM.md`
   and its later current-state counterpart `docs/UI_STANDARD.md` had
   drifted into two documents answering slightly different questions
   (target vision vs. what's actually built) with at least one live,
   unresolved contradiction between them (see "Conflicts resolved" below).
   This ADR makes one of them win, explicitly, rather than leaving both as
   equally-authoritative and silently contradictory.
2. UI/navigation/dashboard structure has never been a named platform layer
   in `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation Freeze list
   (Storage, Authentication, DealerBranchScope, Attachment, Address,
   MasterData, Lookup, Configuration, Reference Data - nine layers, no
   "Design Framework" among them). This ADR adds it as the tenth, governed
   the same way: modification only for a confirmed defect, a security
   issue, a measurable UX/performance problem, or a further approved ADR -
   never a silent per-feature drift back to bespoke navigation/dashboard
   patterns.

## Grounding audit (what already existed before this ADR)

Per this repo's Grounding rule ("never write code from memory" - inspect
existing implementation, ADRs, and docs before changing anything), the
following were read in full before any new document or line of code was
written:

| Existing document | What it already owns |
|---|---|
| `docs/DESIGN_SYSTEM.md` (ADR-005) | Aspirational target: layout shell, header, sidebar, dashboard-per-module philosophy, Cards, Tables, Forms, Search, KPI Cards, Status Indicators, Timeline, Notifications, Typography, Responsive, Accessibility |
| `docs/UI_STANDARD.md` | Current-state, binding: the real shared component catalog, frozen tokens/buttons/cards, accessibility work already shipped |
| `docs/standards/UI_COMPONENT_STANDARD.md` | Stale (Release 1.0) forensic audit - historical "why," superseded by `UI_STANDARD.md` where they disagree |
| `docs/COMPONENT_CATALOG.md`, `docs/SHARED_UI_ANALYSIS.md` | Real-inventory catalog + a Sprint 3 gap analysis (22 scored items) - scanned a different branch/point in time than this local clone; reused as methodology, not re-derived from scratch |
| `docs/DASHBOARD_MODEL.md` | Eight shared KPI *definitions* (Completed Jobs, Pending Jobs, etc.) and a role-visibility rule - does **not** define dashboard philosophy or a Platform Overview / domain-dashboard split |
| `docs/SEARCH_MODEL.md` | Universal Search's data contract and ownership (one shared `search` service) - **no UI** defined |
| `docs/ADMIN_FRAMEWORK.md` | Admin module's three-layer shape (`page.tsx -> *-table.tsx -> route.ts`), design-only migration precedent |
| `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` | Foundation Freeze (nine layers, no UI layer) + Evolution Rule (defect/security/performance/approved-ADR only) |
| `docs/ROADMAP.md` | No phase named "Design System"/"UI"/"Dashboard"/"Navigation" - this work is net-new scope, not an already-scheduled slot |
| `docs/standards/DOMAIN_LANGUAGE_STANDARD.md` | A flat, thirteen-item "Official Menu Standard" table - the previous single source of truth for menu icons/labels |

Conclusion: most of what a "Design Framework" needs (visual language,
component catalog, KPI definitions, search data contract) **already
exists** and is extended here, not rebuilt. Three things were genuinely
missing and are what this ADR actually adds: (1) a dashboard *philosophy*
("decision center, not statistics page") and the Platform Overview /
domain-dashboard split, (2) a small set of named, reusable widget
*contracts* (Statistic/Chart/Timeline/Notification/Quick Action/
Health/Progress Card) beyond the one KPI Card that existed, and (3) a
permanent Navigation Standard replacing the flat Official Menu Standard
with the nested Group -> Item (-> Subgroup) taxonomy this task specifies.

## Conflicts resolved

Two live contradictions were found between existing documents and are
resolved here, explicitly, rather than left to silently persist:

1. **Icon library**: `docs/DESIGN_SYSTEM.md` states "Lucide React is the
   platform's icon set." `docs/UI_STANDARD.md` and
   `docs/standards/UI_COMPONENT_STANDARD.md` both state the opposite:
   "No icon library - inline SVG or emoji. Do not introduce an icon
   library without an explicit decision." **Resolution: `UI_STANDARD.md`
   wins** - it is the later, current-state, binding document; no icon
   library has, in fact, been introduced anywhere in this codebase.
   `DESIGN_SYSTEM.md`'s Lucide line is corrected by this ADR (see "Docs
   updated" below) rather than left standing as a false statement.
2. **Menu Standard vs. Target Navigation**: this task's brief specifies a
   nested Group -> Item taxonomy (Dashboard/Machines/Service/Quality/
   Engineering Intelligence/Reports/Administration) that structurally
   differs from `DOMAIN_LANGUAGE_STANDARD.md`'s flat thirteen-item table,
   and both PDI (Pre-Delivery Inspection) and Parts Request - present in
   the old flat table as recognized future modules - are absent from the
   new Target Navigation. `DOMAIN_LANGUAGE_STANDARD.md` itself says: "If a
   future implementation conflicts with this standard, stop and report the
   conflict instead of introducing new terminology." **Resolution**: the
   new nested navigation is adopted as specified (an explicit,
   business-directed instruction is exactly the kind of authority that
   document anticipates), and `DOMAIN_LANGUAGE_STANDARD.md`'s Official
   Menu Standard table is superseded by this ADR + the new Navigation
   Standard (see "Docs updated"). **PDI and Parts Request are not deleted
   from the platform's future-module list** (they remain named in the
   Architecture Blueprint's Business Capability Map) - they are simply
   absent from the *primary navigation* today, same as every other
   not-yet-built module. This is flagged, not silently resolved, in
   `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s Gap Analysis: worth a
   deliberate decision on whether PDI/Parts Request get a Coming Soon nav
   entry too, in a follow-up.

## Decision

Establish the **MSEAL Design Framework v1.0** as the tenth governed
platform layer, consisting of:

1. **Navigation Standard** - a permanent, nested Group -> Item
   (-> Subgroup, one level deep maximum) taxonomy (`src/app/(app)/navConfig.ts`'s
   `getNavGroups()`), replacing the old flat nav list and the superseded
   Official Menu Standard table. Every leaf is either a real route or a
   named, disabled "Coming Soon" placeholder - never a fake link.
2. **Dashboard Standard** - "a dashboard is a decision center, not a
   statistics page; every widget answers what should the user do next."
   Concretely: `/dashboard` becomes the **Platform Overview** (real,
   role-aware, platform-wide KPIs + Quick Actions), and MQR's existing
   analytics dashboard moves, unchanged, to `/quality/dashboard` as the
   Quality domain's own dashboard. Machines/Service/Engineering
   Intelligence domain dashboards are designed (Gap Analysis, Migration
   Roadmap) but not built in this pass - none has enough real, queryable
   data yet to justify one beyond what Quick Actions already surface.
3. **Widget Standard** - seven named, reusable card contracts:
   Statistic Card (`KpiCard`, extended non-breakingly with an optional
   `action` slot), Chart Card (`ChartCard`, new - every chart names the
   decision it supports or it doesn't get built), Timeline Card
   (`ActivityTimeline`, already platform-standard per its own doc
   comment - reused, not duplicated), Notification Card
   (`NotificationCard`, new), Quick Action Card (`QuickActionCard`, new),
   Health Card (`HealthCard`, new), Progress Card (`ProgressCard`, new).
4. **Empty/Error State Standard** - a generic, page-level `EmptyState`
   (title + reason + next step + action, never bare "No Data") and
   `ErrorState` (problem + reason + resolution + retry), distinct from the
   existing table-row-scoped `admin/EmptyState.tsx`/`admin/LoadingState.tsx`.
5. **Screen Contract** - a documented template (purpose, primary user,
   primary decision, primary action, success criteria, permissions,
   navigation, KPIs, quick actions, timeline, related records, future AI
   panel) every *new* screen going forward is expected to satisfy -
   applied here to two worked examples (Platform Overview, Import
   History), not retrofitted to every existing screen.
6. The 18-file guideline pack under `.claude/skills/mseal-platform-design/`
   as the operative, agent-facing distillation of all of the above -
   mirroring how `.claude/skills/MSEAL_Skill_Library_v2.0/` already
   packages this repo's other standards for agent consumption. The
   canonical prose lives under `docs/` as always; the skill pack is a
   pointer + checklist layer on top, not a second source of truth.

Real, scoped code changes made under this ADR (see
`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` for the full list): the
Navigation Standard's `navConfig.ts`/`Sidebar` rewrite; the Platform
Overview page and its two new small, role-scoped query functions
(`countVehiclesForSession`, `countOpenQualityCases` in `lib/db.ts`); the
seven new/extended widget components; the generic `EmptyState`/`ErrorState`/
`Skeleton`; a new `/admin/import-history` page (the "Import History" nav
leaf, and the "Recent Imports: latest 3, View All" pattern applied for
real to the Legacy Import wizard's history section); and removing the
Archive Queue table/buttons from the Legacy Import wizard's UI only (its
backend - `NtrImportService.archiveSession()`/`processArchiveQueue()`, the
`/api/ntr/import/archive` route, and every `ntr_import_sessions` archive
column - is unchanged, per this task's explicit instruction).

## Alternatives considered

- **Treat this purely as a documentation exercise, no code changes** -
  rejected: the brief explicitly names concrete UI actions (Archive Queue
  removal, Import History as a nav leaf, Platform Overview replacing the
  old MQR-only `/dashboard`) that are real, scoped, low-risk changes, not
  hypothetical future work; deferring all of them to "someday" would
  contradict this repo's Evidence First / Production Readiness standard,
  which asks for verified, working code over paper standards alone.
- **Rewrite `docs/DESIGN_SYSTEM.md` and `docs/UI_STANDARD.md` into one
  merged document** - rejected: they answer genuinely different questions
  (target vision vs. current-state binding truth) and merging them would
  lose that distinction, which several other ADRs (ADR-005 itself) already
  rely on. Instead this ADR reconciles the one real contradiction between
  them and leaves both documents standing, cross-referenced.
- **Build every domain dashboard (Machines/Service/Engineering
  Intelligence) now** - rejected: none of those domains has enough real,
  queryable backing data yet (no Warranty table, no aggregate PM-due
  query, no Recall/PIP/Knowledge/AI module) - building a dashboard shell
  around fabricated or absent data would itself violate the Dashboard
  Standard being established here. Named explicitly as deferred, not
  silently dropped.
- **Retrofit the Screen Contract onto every existing screen immediately** -
  rejected as a mass mechanical exercise with no real per-screen review
  behind it; the Contract is applied to two new/changed screens as worked
  examples, and retrofitting the rest is named in the Migration Roadmap as
  a phased, reviewed effort.

## Docs updated by this ADR

- `docs/DESIGN_SYSTEM.md` - icon-library line corrected to match
  `UI_STANDARD.md`'s current-state truth; pointer added to this ADR and
  `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`.
- `docs/standards/DOMAIN_LANGUAGE_STANDARD.md` - Official Menu Standard
  table marked superseded, pointing to the new Navigation Standard.
- `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` - Foundation Freeze list
  gains "Design Framework" as its tenth governed layer.
- New: `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` (the ten requested
  deliverables) and `.claude/skills/mseal-platform-design/` (eighteen
  guideline files + `SKILL.md`).

## Consequences

- Every future screen is expected to compose from the Navigation/
  Dashboard/Widget/Screen-Contract standards here rather than inventing a
  parallel pattern - matching how Attachment/Storage/Address platforms are
  already the only path for their respective concerns.
- `docs/DESIGN_SYSTEM.md` remains the longer-range aspirational target;
  `docs/UI_STANDARD.md` remains current-state truth; this ADR and
  `MSEAL_DESIGN_FRAMEWORK.md` are the layer that reconciles the two and
  adds what neither had (dashboard philosophy, widget contracts,
  navigation taxonomy) - a reader should consult this ADR first when the
  older two disagree.
- A real, named gap remains open: PDI and Parts Request's absence from the
  new Target Navigation was surfaced, not silently resolved - a follow-up
  decision (Coming Soon entries, or a deliberate deprecation) is still
  needed and is called out in the Gap Analysis.
- Large, genuinely deferred items (full Universal Search UI, Machines/
  Service/Engineering Intelligence domain dashboards, full Screen Contract
  retrofit, Reports module, Import Preview color taxonomy, cancelable/
  resumable import processing) are named explicitly in
  `MSEAL_DESIGN_FRAMEWORK.md`'s Migration Roadmap and Technical Debt
  sections - consistent with the Architecture Evolution Rule's "no
  speculative infrastructure," not an admission of incomplete work.

## Addendum: pre-merge architecture refinement

Applied as a direct amendment to this same ADR/PR (PR #37, not yet
merged) rather than a new ADR - per this refinement's own instruction to
preserve this ADR and open commits against the existing PR, not a new
one. Four changes:

1. **Product Improvement Plan (PIP) moves from Quality to Engineering
   Intelligence.** PIP is an Engineering deliverable, not a Quality one -
   it is *produced from* Quality Cases and Knowledge, but the plan itself
   (Quality Cases → Knowledge → Engineering Analysis → PIP → Recall) is
   Engineering Intelligence's output. The original navigation placed a
   Coming Soon PIP entry under both Service > Campaigns and Quality -
   this refinement removes the Quality copy entirely (PIP now has exactly
   one nav entry, under Engineering Intelligence, alongside the new
   Troubleshooting entry) and leaves the Service > Campaigns one
   unchanged (that one represents a different relationship - PIP as a
   campaign-adjacent deliverable Service tracks, not a duplicate page).
   Quality's nav group comment now explicitly states it produces Cases a
   PIP is built from but does not own the PIP page.
2. **Troubleshooting added to Engineering Intelligence**, Coming Soon,
   architecture-reserved only (no functionality) - future AI-assisted
   troubleshooting, knowledge-guided diagnostics, failure trees, decision
   trees, repair procedures. Same "Coming Soon" nav treatment as every
   other not-yet-built leaf, nothing new invented for it.
3. **Reports formally documented as a cross-cutting capability, not a
   business domain** - it consumes data from Machines, Service/PM,
   Warranty, Quality, Engineering Intelligence, and the Import Platform,
   and owns no data of its own. It keeps its nav group (the same way
   Administration - also cross-cutting - keeps one) but is now explicitly
   labeled as such in `navConfig.ts`'s own comments and
   `MSEAL_DESIGN_FRAMEWORK.md`. No existing report was touched or
   redesigned.
4. **Platform Overview gains "Today's Activities"** (a real widget, not
   Coming Soon) reusing `<ActivityTimeline>` - the same platform-standard
   component every module's own record page already uses, not a second
   timeline. Fed by two small, additive functions: `listTodaysAuditLog()`
   (`lib/db.ts`) and `mapMixedAuditLogToActivityEvents()`
   (`activity-timeline/mapAuditLogToActivityEvents.ts`, a cross-record
   sibling to the existing single-record mapper - no duplicated event
   logic, same collapsing rule, just orchestrated across many records).
   Gated to `seesAllDealers` roles only: `record_audit_log` has no
   dealer/branch column to scope by, so - to avoid a permission
   regression - this widget is shown only to roles that already see
   platform-wide data everywhere else on this same page (System Health,
   the unscoped Registered Machines total), never to a DealerAdmin/
   DealerUser who would otherwise see other dealers' activity. Also added:
   a **Global Search UI placeholder** (`GlobalSearchButton`, `PlatformHeader`) -
   disabled, tooltip-only, mirroring `NotificationBell`'s exact existing
   placeholder pattern - no backend, no index, no query; the data contract
   it will eventually wire into is `docs/SEARCH_MODEL.md`, unchanged.

No visual redesign, no change to any existing route's permission gate, no
second copy of any existing page or component - see the Regression Report
in this PR's description for verification evidence.
