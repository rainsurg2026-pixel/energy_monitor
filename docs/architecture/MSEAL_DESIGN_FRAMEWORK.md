# MSEAL Design Framework v1.0

Decision record: `docs/adr/ADR-023-MSEAL-Design-Framework.md`. This
document is the ten requested deliverables in one place, kept in sync
with the code the same way `IMPORT_PLATFORM.md` tracks ADR-022. It does
not restate what `docs/DESIGN_SYSTEM.md` (aspirational target) and
`docs/UI_STANDARD.md` (current-state, binding) already own - see each
section for what's new here versus what's a pointer to an existing doc.

This is **not a visual redesign**. Tailwind tokens, brand colors, and the
frozen buttons/cards/typography in `UI_STANDARD.md` are unchanged.

---

## 1. Design Framework

The Framework is four layers, each already-existing or newly-added as
noted:

| Layer | Owner doc | Status |
|---|---|---|
| Visual tokens (color, spacing, shadow, radius, type scale) | `docs/UI_STANDARD.md`, `tailwind.config.ts`, `globals.css` | Existing, unchanged |
| Component catalog (Card, KpiCard, PageHeader, StatusPill, forms, tables, timeline) | `docs/UI_STANDARD.md`, `src/components/shared/` | Existing, extended (7 new widgets, 3 new generic states - see §4) |
| Navigation/Dashboard/Screen structure | This document + ADR-023 | **New** |
| Agent-facing operational checklist | `.claude/skills/mseal-platform-design/` | **New** |

Governance: Design Framework is now the tenth entry in
`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation Freeze -
modifiable only for a confirmed defect, security issue, measurable UX/
performance problem, or a further approved ADR.

---

## 2. Platform Navigation Standard

Structure: a fixed list of top-level **Groups**, each holding flat
**Items** or one level of **Subgroups** (never deeper). Every leaf is
either a real route or an explicit, disabled "Coming Soon" placeholder -
never a fake/broken link. Implementation: `src/app/(app)/navConfig.ts`'s
`getNavGroups(t, session)`, rendered by `src/app/(app)/sidebar.tsx`.

**Update (2026-07-15, Production Pilot Readiness, PR #60):** the table
below is rewritten to match the current, live navigation - the version
that follows described a pre-Pilot target that has since shipped
differently (Legacy Import's nav entry was removed rather than kept
SuperAdmin-only; Coming Soon placeholders were removed from the code
entirely rather than left rendered-disabled; Vehicle Lookup and
Delivery Lifecycle are new top-level groups the original table never
had). Ground truth is always `src/app/(app)/navConfig.ts`'s
`getNavGroups()` - re-verify against it, not this table, if the two
ever drift again.

| Group | Item | Route | Status |
|---|---|---|---|
| 🏠 Dashboard | Platform Overview | `/dashboard` | Real |
| 🚜 Vehicle Lookup | Vehicle 360 | `/machines` | Real - persistent, always-available lookup, its own top-level group (not nested under any one lifecycle stage); `/vehicles` is a pure redirect, no separate entry |
| 🔍 Import & Inspection (MSEAL only) | Dashboard | `/delivery/pdi/dashboard` | Real |
| | Import Inspection | `/delivery/pdi` | Real |
| 🚚 Delivery Lifecycle | New Tractor Delivery (NTR) | `/ntr` | Real |
| 🔧 Service | Preventive Maintenance | `/pm-records` | Real |
| ⚠️ Quality | Dashboard (แดชบอร์ดคุณภาพ) | `/quality/dashboard` | Real |
| | Cases (รายงานปัญหาคุณภาพ) | `/records` | Real |
| | Knowledge (องค์ความรู้) | `/quality/knowledge` | Real (Engineering Knowledge Platform, ADR-018) |
| ⚙️ Administration | Users | `/admin/users` | Real |
| | Master Data (subgroup: Dealers/Branches/Technicians/Problem Codes/PM Intervals/Product Families/Product Family Models/Maintenance Programs) | `/admin/*` | Real |
| | Email Health | `/admin/email-health` | Real |

**Removed entirely for Production Pilot** ("Production Pilot exposes
only completed workflows," `navConfig.ts`'s own doc comment) - no
longer scaffolded even as disabled Coming Soon rows, for any role
including SuperAdmin: Machine Passport as a separate nav entry (folded
into Vehicle 360 above), Warranty, Service Campaign, PIP,
Quality Analytics, Troubleshooting, the entire Engineering Intelligence
group, the entire Reports group, Audit, Sessions, Settings. These are
named, real, still-open gaps (not silently dropped) - tracked in
`docs/architecture/BUSINESS_WORKFLOW_UX_AUDIT.md`/
`BUSINESS_WORKFLOW_CONSOLIDATION_AUDIT.md`. The underlying
`CapabilityStatus`/`comingSoon` mechanism is unchanged and ready for
the next capability that needs the same treatment post-Pilot; only the
inert placeholder rows and the `comingSoon()` construction helper were
deleted from the code.

**Permanently retired, not merely hidden (2026-07-16, ADR-038, Product
Owner decision)**: Historical NTR Import (formerly "Legacy Import") and
Import History. Unlike the Pilot-suspended items above, no route, page,
API, nav entry, or code path of any kind remains for either - this is a
product decision to remove the capability, not a Pilot-duration visibility
choice awaiting a "post-Pilot" resumption.

**Open item, not silently resolved**: PDI (Pre-Delivery Inspection) and
Parts Request appeared in the old flat Official Menu Standard
(`docs/standards/DOMAIN_LANGUAGE_STANDARD.md`) as recognized future
modules. Note this now reads ambiguously: a *different* "PDI" (MSEAL's
own Import Inspection domain, ADR-028) does have a real nav group
today (🔍 Import & Inspection, above) - that is not the same capability
as the dealer-facing "PDI (Pre-Delivery Inspection)"/Parts Request this
paragraph originally meant, which still has no nav entry anywhere.
Whether dealer-facing PDI/Parts Request should get a Coming Soon (or
now, no-entry-until-built) treatment is a deliberate call for product
direction, flagged here rather than decided unilaterally.

Role gating is unchanged in spirit from before: nav visibility is
UX-only, every route re-checks the same `lib/scope.ts` predicate
server-side (`docs/standards/SECURITY_STANDARD.md`).

### 2c. Navigation Visibility Rule - capability status, not roadmap (post-Foundation Freeze refinement; Production Pilot policy supersedes the SuperAdmin exception below)

**Navigation Principle**: Navigation represents platform capabilities.
Users see available capabilities. Navigation is never the roadmap.
~~SuperAdmin may see future capabilities.~~ **Suspended for the
duration of Production Pilot** (see the update below) - the mechanism
that would allow it is unchanged, but the exception itself does not
apply today.

**Capability Principle**: Every capability has an Owner (the domain that
owns it - §2a/§2b above), a Status (`CapabilityStatus`), a Permission
(its `lib/scope.ts` predicate once real), and a Lifecycle (it moves
through statuses via named releases, never silently). Visibility is
always derived from capability state + authorization, never from
hardcoded module names.

**Navigation represents available business capability, not the product
roadmap.** Every leaf carries a `CapabilityStatus` (`navConfig.ts`):
`ACTIVE` for a real, built route; `COMING_SOON`, `PREVIEW`, `BETA`, or
`DEVELOPMENT` for everything not yet a capability a regular user can
act on - the other three statuses exist for a future capability that's
further along than "Coming Soon" but not yet general-availability,
without inventing a new flag or filter when that happens.

**Update (2026-07-15, Production Pilot Readiness, PR #60):**
`getNavGroups()` now applies one rule, uniformly, to every leaf
regardless of role: **only `ACTIVE` leaves are visible, for every role
including SuperAdmin** ("Production Pilot exposes only completed
workflows"). The paragraph below describing a SuperAdmin-sees-everything
exception was accurate for the pre-Pilot Foundation Freeze design and
is superseded, not deleted, since the mechanism it describes
(`isCapabilityVisible()` taking a role parameter) still exists in the
code - `_role` is simply unused while this policy is in effect. If
every item in a group (or subgroup) is non-`ACTIVE`, the whole group is
omitted entirely, for every role - e.g. the entire former Engineering
Intelligence and Reports groups, and Service's Campaigns subgroup, are
gone from the nav tree, not merely hidden from non-SuperAdmin roles.
This is a generic, status-driven filter
(`isCapabilityVisible()`/`filterGroupsByCapability()`) - there is no
code naming any specific module in the filtering logic itself, so a
future capability gets this same hidden-until-`ACTIVE` treatment
automatically the moment it's added at a non-`ACTIVE` status.

**Pre-Pilot design (superseded by the update above, kept for history,
not current behavior):** `getNavGroups()` used to apply one rule,
uniformly, to every leaf regardless of which group it belonged to:
**SuperAdmin sees every status** (the full roadmap); **every other role
sees only `ACTIVE` leaves** - an unfinished capability hidden
completely, never shown as a disabled placeholder. If every item in a
group (or subgroup) was non-`ACTIVE`, the whole group was omitted for
non-SuperAdmin roles only.

This is a UX-visibility refinement only, not a new authorization
boundary: every gated leaf already had `href: null` (no real route to
protect) before this rule existed. Real routes continue to be enforced
exclusively server-side, per `docs/standards/SECURITY_STANDARD.md`'s
Application-layer authorization section, unaffected by what the nav
shows.

### 2a. Quality owns execution, Knowledge owns itself, Engineering Intelligence owns analysis (UI Terminology & Navigation Cleanup; ownership corrected by ADR-018, Engineering Knowledge Platform)

**Supersedes this section's original "pre-merge refinement" split.**
Quality owns operational execution - Quality Cases (รายงานปัญหาคุณภาพ)
and **Troubleshooting**, the technician-facing activity of diagnosing an
active quality problem. **Knowledge (องค์ความรู้) owns itself** - an
independent domain (ADR-018) with its own `knowledge_cases`/
`knowledge_evidence` tables and `KnowledgeService`, aggregating Evidence
from every domain (Quality included) rather than being owned by any one
of them; its nav entry sits under the Quality menu group for UX/
discoverability only, not data ownership (this section previously said
Quality owned Knowledge - corrected here since it contradicted ADR-018's
own explicit Vision). Engineering Intelligence consumes Knowledge (never
raw Quality data directly) to produce analysis and improvement plans -
**AI Engineering**, **PIP**, and **Predictive Quality** - it does not own
execution, does not own Knowledge, and does not get its own separate
"Knowledge Engine" entry or a second Troubleshooting entry. Troubleshooting
has exactly one nav entry, under Quality - never a second copy under
Engineering Intelligence.

Engineering Intelligence also no longer carries separate "AI Analysis"
and "Insights" entries - both are consolidated into the one **AI
Engineering** entry, since neither represented a distinct, real
capability beyond "AI-produced analysis." Engineering Intelligence now
exposes exactly three items: AI Engineering, PIP, Predictive Quality
(renamed from Prediction).

PIP is produced *from* Quality Cases/Knowledge but is itself an
Engineering Intelligence deliverable, not a Quality one - it has exactly
one Quality-adjacent nav entry, under Engineering Intelligence, never
duplicated under Quality. **PIP still also appears under Service >
Campaigns** (`Product Improvement Plan (Future)`) - that entry is
unchanged and is not a duplicate of the Engineering Intelligence one: it
represents Service's own campaign-tracking view of a PIP once one exists,
not a second copy of the PIP page itself. Both are Coming Soon today, so
there is no duplicated *page* either way - only a documentation
distinction worth keeping straight once a real PIP module exists.

Troubleshooting (Coming Soon, Quality-owned) is architecture-reserved
only: future AI-assisted troubleshooting, knowledge-guided diagnostics,
failure trees, decision trees, repair procedures. No functionality is
implemented. The Machine Digital Passport (`docs/architecture/
MACHINE_PASSPORT_ARCHITECTURE.md`) reserves a matching single section for
it, moved out of the Knowledge Integration tile grid so it is not
duplicated there either.

Recall was removed entirely (not carried forward as Coming Soon,
including its former Service > Campaigns entry and the dashboard's
"Recall / Service Campaigns" placeholder card, now just "Service
Campaigns") - no Recall module or data exists, and it had no distinct
destination from Service Campaign.

### 2b. Reports is cross-cutting, not a business domain

Reports consumes data from Machines, Service/PM, Warranty, Quality,
Engineering Intelligence, and the Import Platform - it owns no data of
its own and is not itself a business domain the way Machines/Service/
Quality are. It keeps a nav group (the same way Administration - also
cross-cutting - keeps one), now explicitly documented as such in
`navConfig.ts`'s own comments. No existing report was touched, redesigned,
or moved by this statement - it is a documentation clarification only.

---

## 3. Dashboard Standard

**Dashboard = Decision Center, not a Statistics Page.** Every widget
answers "what should the user do next," not just "what is the number."

- **Platform Overview** (`/dashboard`) - platform-wide, role-aware.
  Real KPIs today: Registered Machines (role-scoped vehicle count),
  Open Quality Cases (role-scoped open-MQR count), System Health (reuses
  the existing Tractor-IN sync health check, `seesAllDealers` roles only).
  Quick Actions: Register New Tractor, Machine Registry, Quality Cases.
  (Pending Imports KPI and Legacy Import Quick Action retired alongside
  Historical NTR Import - ADR-038, 2026-07-16.) **Today's Activities**
  (pre-merge refinement, real widget,
  `seesAllDealers` roles only) reuses `<ActivityTimeline>` - the same
  platform-standard component every module's own record page already
  renders through, not a second timeline - fed by every
  `record_audit_log` row from today across every module (see §4, §7).
  Explicitly-labeled Coming Soon widgets (not fabricated zeros, not silent
  omission) for Active Warranty, Open PM, Recall/Service Campaigns - none
  has a real, queryable data source yet (see §7 Gap Analysis; PIP itself
  moved off this page's Coming Soon list entirely - it now lives under
  Engineering Intelligence, §2a).
- **Quality Dashboard** (`/quality/dashboard`) - the pre-existing MQR
  analytics dashboard (backlog KPIs, status/aging charts, Pareto,
  leaderboards), moved unchanged. This is the Quality domain's own
  dashboard under the new structure, not replaced or redesigned.
- **Machines / Service / Engineering Intelligence dashboards** - designed
  (this document, ADR-023) but not built this pass. None has enough real
  backing data (no Warranty table, no aggregate PM-due query, no AI/
  Knowledge module) to justify a dashboard beyond what Quick Actions
  already surface on Platform Overview and the domain's own list pages.

Every dashboard widget follows: **Primary KPI + Secondary Context +
Primary Action** (`KpiCard`'s new optional `action` slot; see §4).

---

## 4. Widget Standard

Seven named, reusable contracts. All under
`src/components/shared/dashboard/` unless noted.

| Widget | Component | New/Existing |
|---|---|---|
| Statistic Card | `KpiCard` | Existing, extended non-breakingly (`action?` prop) |
| Chart Card | `ChartCard` | **New** - `decision` prop is required; a chart with no stated decision doesn't get this wrapper (Chart Guideline) |
| Timeline Card | `ActivityTimeline` (`shared/activity-timeline/`) | Existing platform standard, reused - now also live on Platform Overview's "Today's Activities" (pre-merge refinement), fed by a new cross-record adapter, `mapMixedAuditLogToActivityEvents()`, sibling to the existing single-record `mapAuditLogToActivityEvents()` - no second timeline component |
| Notification Card | `NotificationCard` | **New** |
| Quick Action Card | `QuickActionCard` | **New** |
| Health Card | `HealthCard` | **New** |
| Progress Card | `ProgressCard` | **New** |

Plus three generic states, under `src/components/shared/layout/`,
distinct from the existing table-row-scoped `admin/EmptyState.tsx` and
`admin/LoadingState.tsx`:

- `EmptyState` - title + **reason** (why) + **next step** (what to do) +
  optional action; never bare "No Data" (see the Empty State Guideline,
  `.claude/skills/mseal-platform-design/EMPTY_STATE_GUIDELINES.md`).
- `ErrorState` - problem + reason + resolution + optional retry (Error
  State Guideline).
- `Skeleton` - generic shimmer block for non-table loading states.

Plus a **Global Search UI placeholder** (`GlobalSearchButton`,
`PlatformHeader`, pre-merge refinement) - not one of the seven widget
contracts (it's header chrome, not a dashboard widget), but architecture-
reserved the same way: disabled, tooltip-only, mirroring
`NotificationBell`'s exact existing pattern rather than a new placeholder
language. No backend - the data contract it will eventually wire into is
`docs/SEARCH_MODEL.md`, unchanged by this pass (see `SEARCH_GUIDELINES.md`).

---

## 5. Screen Contract

Every screen going forward documents: Purpose, Primary User, Primary
Decision, Primary Action, Success Criteria, Permissions, Navigation,
KPIs, Quick Actions, Timeline, Related Records, Future AI Panel. Applied
here to two worked examples (not retrofitted to every existing screen -
see §8 Migration Roadmap):

### Platform Overview (`/dashboard`)
- **Purpose**: one screen answering "is the platform healthy and what
  needs my attention right now."
- **Primary User**: every authenticated role (content varies by role).
- **Primary Decision**: where should I go next - a quality case, an
  import, a new registration.
- **Primary Action**: one of the Quick Actions.
- **Success Criteria**: user reaches the right module in one click.
- **Permissions**: `getSession()` gate; per-widget role checks
  (`seesAllDealers`) hide, never fake, data.
- **Navigation**: Dashboard group, single item.
- **KPIs**: Registered Machines, Open Quality Cases, System Health.
  (Pending Imports KPI retired alongside Historical NTR Import - ADR-038,
  2026-07-16.)
- **Quick Actions**: as listed in §3.
- **Timeline**: **Today's Activities** (pre-merge refinement) - real,
  `<ActivityTimeline>`, `seesAllDealers` roles only (see §7 for the scoping
  reason).
- **Related Records**: none (this screen is a router, not a record view).
- **Future AI Panel**: reserved slot - see §14.
- **Global Search**: header-level placeholder (`GlobalSearchButton`), not
  page-specific - present on every authenticated page via `PlatformHeader`,
  not just this one.

### Import History (`/admin/import-history`) - RETIRED (ADR-038, 2026-07-16)

**Permanently retired, Product Owner decision - this screen no longer
exists.** The contract below is kept as historical record of what was
built, not a description of current state.

- **Purpose**: full, auditable Legacy Import session history.
- **Primary User**: Super Administrator.
- **Primary Decision**: did a given import run succeed; which session to
  investigate further.
- **Primary Action**: none required (read-only) - the wizard's own
  "View All" link is how a user arrives here from the action screen.
- **Success Criteria**: every historical session is visible with its
  outcome counts.
- **Permissions**: `canManageLegacyImport` (SuperAdmin only), same gate
  as Legacy Import itself.
- **Navigation**: Administration > Import History.
- **KPIs**: none (this is a list, not a dashboard).
- **Quick Actions**: none (see above).
- **Timeline**: not applicable - session rows are themselves the record.
- **Related Records**: none surfaced yet - a future link from a session
  row to its resulting NTR/Machine records is named in §8.
- **Future AI Panel**: reserved slot - see §14.

---

## 6. Enterprise UX Checklist

Applied to every screen touched this pass (Platform Overview, Import
History, Legacy Import's trimmed history section):

- [x] Native HTML forms where forms exist (Legacy Import's upload step
      already used a real `<form>`/file input - unchanged).
- [x] Keyboard: no screen here removes existing keyboard support; Login's
      Enter-to-submit was verified already correct in a prior pass (no
      change needed - see Release Notes below).
- [x] No "No Data" - every empty/未-built state uses `EmptyState` with a
      reason and next step, or Coming Soon styling.
- [x] Every error path (Platform Overview's data queries) already threw
      through the existing Server Component error boundary; `ErrorState`
      is available for any future client-side fetch on these screens.
- [x] Skeleton-first loading is available (`Skeleton`) for any future
      client-rendered widget; both new pages here are Server Components
      with no client-side loading state to skeleton.
- [x] Every chart kept (Quality Dashboard, unchanged) already has a
      `note`/decision caption via `Panel`; new charts should use
      `ChartCard` going forward.
- [x] Responsive: new pages reuse the existing `grid-cols-1
      sm:grid-cols-2 lg:grid-cols-*` mobile-first pattern, nothing novel.
- [x] Accessibility: `EmptyState`role is implicit text content (no ARIA
      needed beyond existing focus/contrast rules); `Skeleton` carries
      `role="status" aria-label="Loading"`.
- [ ] **Not done this pass**: a full accessibility audit (screen reader
      pass, contrast check) of the seven new widgets - named in §9
      Technical Debt.

---

## 7. Gap Analysis

| Area | Gap | Why not closed this pass |
|---|---|---|
| Active Warranty KPI | No Warranty table/module exists (`lib/warranty.ts` is pure calculation logic only) | Building a fake KPI around no data would violate the Dashboard Standard being established here |
| Open PM KPI | No aggregate "PM due" query exists - due-date evaluation is per-vehicle (`MaintenanceDueService`), not batched | Real engineering effort (a new batched query), out of this pass's scope |
| PIP / Knowledge / AI Engineering / Predictive Quality / Troubleshooting | No module exists for any of these (Quality vs. Engineering Intelligence ownership - §2a) | Named future modules, not built speculatively |
| Cross-module Today's Activities scoping | **Partially resolved this pass** - `<ActivityTimeline>` now shows real, today-only, cross-module events, but only to `seesAllDealers` roles; `record_audit_log` carries no dealer/branch column, so a DealerAdmin/DealerUser-scoped version would need an additional per-module join this pass doesn't build | Scoping the feed per-dealer for every role is real engineering effort; showing it unscoped to a scoped role would be a permission regression, so it's gated off instead - named in Migration Roadmap |
| Notifications | `NotificationBell` is a static placeholder, no backing query | Pre-existing gap, unchanged by this pass; `NotificationCard` is ready for whenever a real notification source exists |
| Universal Search UI | `docs/SEARCH_MODEL.md` defines the data contract; no UI built | Genuinely greenfield - named in Migration Roadmap, not attempted this pass |
| PDI / Parts Request navigation | Present in the old flat Menu Standard, absent from the new Target Navigation (real or Coming Soon) | Flagged for product direction, not resolved unilaterally (see §2) |
| Icon library contradiction | `DESIGN_SYSTEM.md`/`TECH_STACK.md` said Lucide React; `UI_STANDARD.md` says none | **Resolved this pass** - see ADR-023 "Conflicts resolved" |
| Header-existence contradiction | `docs/COMPONENT_CATALOG.md` (scanned a different branch) says no Header component exists; `UI_STANDARD.md`/this codebase have `PlatformHeader.tsx` | Not resolved here - `COMPONENT_CATALOG.md` scans live `main`, not this local clone; flagged for whoever next refreshes that catalog |
| `admin/EmptyState.tsx` default message | Its default is "ไม่มีข้อมูล" ("No Data") - contradicts the new Empty State Guideline | Not fixed - component is unused by any screen today (confirmed), so left as a named, zero-risk cleanup item rather than touched speculatively |

---

## 8. Migration Roadmap

Phased, matching this repo's own "design-only-until-approved" precedent
(`docs/ADMIN_FRAMEWORK.md`):

1. **Now (this PR)**: Navigation Standard, Platform Overview, Quality
   Dashboard move, seven widgets + three generic states, Import History
   page, Archive Queue UI removal; pre-merge refinement: PIP moved to
   Engineering Intelligence, Troubleshooting added, Reports documented as
   cross-cutting, Today's Activities + Global Search placeholder added.
   **UI Terminology & Navigation Cleanup pass (later)**: Quality Cases
   standardized to "รายงานปัญหาคุณภาพ" everywhere in the UI; Recall removed
   entirely (no Coming Soon carry-forward); Troubleshooting moved from
   Engineering Intelligence to Quality (execution vs. analysis - see
   §2a); Engineering Intelligence's "AI Analysis"/"Insights"/"Knowledge
   Engine" entries consolidated/removed, leaving exactly AI Engineering/
   PIP/Predictive Quality; Platform Overview's remaining hardcoded English
   labels moved through the i18n system (`dashboard.*` namespace); Machine
   Digital Passport gained a matching reserved Troubleshooting section.
   See `docs/standards/TERMINOLOGY_STANDARD.md`.
2. **Next**: retrofit the Screen Contract onto every existing detail page
   (records/[jobId], ntr/[id], pm-records/[id], vehicles/[serial]) -
   review each against the template rather than a mechanical stamp.
3. **Next**: batched "PM due" query -> real Open PM KPI on Platform
   Overview and a Service domain dashboard.
4. **Next**: scope Today's Activities per-dealer for DealerAdmin/
   DealerUser (currently `seesAllDealers`-only) - needs a join from
   `record_audit_log` back to each module's own scoped record set; real
   effort, not attempted this pass to avoid a permission regression.
5. **Later**: Universal Search UI on top of the existing `SEARCH_MODEL.md`
   contract.
6. **Later**: Machines/Service/Engineering Intelligence domain dashboards,
   once each has real backing data (Machine Passport content, Warranty
   table, a Knowledge/AI module).
7. **Later**: Reports module (Executive/Operations/Dealer/Export) - no
   real requirement or data shape agreed yet.
8. **Later**: Import Preview color taxonomy (🟢🟡🔵🟠🔴) and cancelable/
   resumable import processing for 5000+ rows - both named in ADR-022,
   still deferred.
9. **Later**: a resolved decision on PDI/Parts Request's navigation
   presence (§2, §7).

---

## 9. Technical Debt Report

- Seven new widgets have not had a full accessibility audit (screen
  reader pass, automated contrast check) - built to the same Tailwind
  tokens and focus-visible ring as every existing component, but not
  independently verified.
- `docs/COMPONENT_CATALOG.md` and `docs/SHARED_UI_ANALYSIS.md` were
  scanned against a different branch/point in time than this local clone
  (their own header notes say so) - both are due a refresh against this
  codebase's actual current state; not attempted here to avoid conflating
  that refresh with this framework's own changes.
- `admin/EmptyState.tsx`'s "No Data" default message contradicts the new
  Empty State Guideline but is unused anywhere - a zero-risk fix for
  whoever next touches that file.
- No cross-module notification/activity aggregation service exists;
  `NotificationCard`/the Platform Overview's Coming Soon Latest Activities
  slot are ready for one whenever it's built.
- `getServerLocale()`/`t()` were used directly in the two new Server
  Component pages, matching existing precedent
  (`pm-records/[id]/page.tsx` etc.) - no new i18n mechanism introduced.

---

## 10. Future Recommendations

- Build the batched PM-due query before the Service domain dashboard -
  it's the one real, scoped piece of engineering blocking two roadmap
  items (Open PM KPI, Service dashboard) at once.
- Resolve PDI/Parts Request's navigation presence in the same pass as
  whichever of those two modules gets built first, rather than as a
  standalone documentation change.
- When Engineering Intelligence gets its first real module, use the
  reserved "Future AI Panel" slot named in the Screen Contract (§5, §14)
  rather than redesigning the screens it appears on.
- Refresh `docs/COMPONENT_CATALOG.md`/`docs/SHARED_UI_ANALYSIS.md` against
  this local clone's actual state before relying on either for a future
  gap analysis - both are dated relative to a different branch.

---

## 14. Future AI Panel (reserved area)

Per the brief's "Future AI Ready" section: every Screen Contract (§5)
names a "Future AI Panel" slot. No AI Summary/Insight/Recommendation/
Action component is built this pass (Engineering Intelligence has no
module yet, §7). The convention going forward: a Future AI Panel is a
plain, clearly-labeled Coming Soon `EmptyState` in the same position a
real AI panel would eventually occupy - reserving the layout slot without
inventing a fake AI feature. No new component is needed for this today;
`EmptyState` with `comingSoon` already covers it.
