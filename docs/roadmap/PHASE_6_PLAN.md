# Phase 6 Plan (Planning Only)

**Historical, superseded by `docs/ROADMAP.md`'s own "Recommended next
implementation order"** (Documentation Cleanup for Production Pilot,
2026-07-15) — this document's priority order (Workflow Engine →
Notification Platform → Machine Domain extension → Dashboard →
Analytics → AI Platform) predates and was never reconciled against
`docs/ROADMAP.md`'s current recommended order (Machine Digital Passport
→ Knowledge Platform → Machine Delivery Platform → Service Platform v1.0
→ AI Troubleshooting → ...), which has since shipped most of Machine
Domain/Dashboard/Analytics-adjacent work under different names (Machine
Digital Passport, Knowledge Platform, Machine Delivery Platform). Kept
here as a record of the reasoning below, not as a live priority order -
`docs/ROADMAP.md` is the one canonical "what's next" document.

No implementation performed or implied by this document. Priority order
and scope for the next body of work after Storage Platform v2.1,
Architecture Governance/Enforcement, and NTR Historical Import Framework
v1.0 are all merged. Each item below requires its own explicit
milestone, its own approval, and its own branch - nothing here is
scheduled by being listed.

**Naming note:** a different, Storage-Platform-scoped `NEXT_PHASE.md`/
`TECHNICAL_DEBT.md` pair already exists (uncommitted, stashed on
`feature/pm-record-workflow-redesign` as `storage-platform-v1.0-uncommitted`)
recommending a narrower "Phase 6" of Storage/architecture-tooling
hardening. This document is broader and platform-feature-facing; the two
should be reconciled (not silently merged) once that stash is committed -
see this milestone's own Final Report.

## Priority order

1. Workflow Engine
2. Notification Platform
3. Machine Domain (extension)
4. Dashboard
5. Analytics
6. AI Platform

This order runs infrastructure-and-data-plumbing first
(Workflow/Notification), then extends the one domain model everything
else reads from (Machine Domain), then the two features that consume all
of the above (Dashboard, Analytics), and leaves AI Platform last since it
depends on real usage data existing across the other five.

---

## 1. Workflow Engine

**Objective**: a real state-machine/orchestration layer for cross-module
business processes (MQR investigation states, PM lock/supersession, NTR
import Preview→Commit, and any future module's lifecycle) that currently
each hand-roll their own status-transition logic
(`MQR_STATUS_TRANSITIONS`/`canTransitionMqrStatus()`, PM's lock rules,
NTR's session status enum) independently, with no shared engine.

**Dependencies**: none blocking - could start first, but its value is
highest once Notification Platform exists to act on workflow-state
changes (a workflow transition with nothing subscribing to it is just a
status column). Should also land before Dashboard, since a real
dashboard's "pending action" views are naturally workflow-state queries.

**Estimated scope**: Large. Requires an explicit architecture decision
(state machine library vs. hand-rolled, per-module state definitions vs.
one generic engine) before any code - this is exactly the kind of
decision `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s "Future
Extension Rules" says needs an ADR first, not an assumption.

**Risks**:
- Retrofitting existing, working status logic (MQR's transition graph,
  PM's lock rules) onto a new engine risks a subtle behavior regression
  in already-shipped, dealer-facing features - the highest-risk kind of
  regression this app has (per `.claude/rules/03-data-access-security.md`'s
  general caution about touching shared logic).
- Real scope-creep risk: "workflow engine" can expand indefinitely (visual
  builder? per-tenant custom flows?) without an explicit, narrow first
  milestone boundary.

## 2. Notification Platform

**Objective**: the ADR-004-documented `shared/services/notification`
platform service (still just a name in `docs/PLATFORM_SERVICES.md`,
never built) - a single place every module sends a
user-facing notification through, instead of each module calling
`lib/email.ts` (Resend) directly and ad hoc.

**Dependencies**: benefits from Workflow Engine existing first (most
notifications are "a workflow state changed"), but can be built
independently against today's existing status changes if Workflow Engine
is deprioritized.

**Estimated scope**: Medium. Email (Resend) already works and is the
starting point; in-app/push notification channels would be new,
separately-scoped additions, not assumed as part of a first milestone.

**Risks**:
- Email deliverability/rate-limiting at real dealer-network scale hasn't
  been tested - this app's current email usage (MQR record notifications)
  is low-volume; a shared platform service that many modules call through
  could change that profile.
- No existing in-app notification UI/data model exists anywhere in this
  app today - this is new UI surface, not a refactor of existing surface.

## 3. Machine Domain (extension)

**Objective**: extend the existing Machine Domain (ADR-009,
`docs/engineering/MACHINE_DOMAIN.md`) - specifically, finish wiring
`VehicleEventPublisher` (built in Phase 4.5, still not called by any real
module's `create()`/status-transition code) and migrate Machine 360's
Timeline to read from `vehicle_events` instead of its current
per-module live-aggregation (`src/features/vehicle/registry.ts`).

**Dependencies**: none - this is finishing already-started, already-
scoped work, not new design. Should land before Dashboard/Analytics,
since both would ideally read from the same real event stream rather
than each re-implementing their own cross-module aggregation.

**Estimated scope**: Medium. The Publisher and event schema already
exist and are tested; the work is wiring real call-sites (MQR
open/close, PM record creation, NTR registration) and one Timeline data-
source migration.

**Risks**:
- Migrating Timeline's data source is a real, user-visible behavior
  change if the live-aggregation and event-stream views ever disagree
  (e.g. a historically-imported NTR record with no corresponding
  `vehicle_events` row) - needs an explicit backfill decision, not an
  assumption that they'll match.
- Low risk otherwise - additive, no schema redesign needed (the
  `vehicle_events` table already exists).

## 4. Dashboard

**Objective**: Phase 5c's still-unstarted Service Intelligence Dashboard
(Executive/Dealer/Technician/MQR/Campaign KPI sections) plus Global
Search (serial/engine/PM number/MQR number/customer/phone/dealer/branch,
one box) - both explicitly deferred since the Production Stabilization
Sprint.

**Dependencies**: meaningfully easier and more accurate after Machine
Domain's event-stream migration (item 3) - a dashboard built against
today's per-module live-aggregation queries would need rebuilding once
that migration lands. Not a hard blocker, but sequencing after it avoids
throwaway work.

**Estimated scope**: Large. Multiple KPI sections across multiple roles,
plus a genuinely new cross-module search feature - likely several
sub-milestones (mirroring how PM's own History Center was built in
phases 4a/4b/4c).

**Risks**:
- Real-time/near-real-time KPI aggregation at scale hasn't been designed
  for anywhere in this app yet (existing dashboard is a simple, already-
  small-scale query set) - needs its own performance validation, same
  category of risk the Storage Platform's 10,000-row NTR import
  performance defect turned out to be real, not hypothetical.
- Global Search spanning this many tables/modules needs an explicit
  decision on whether it's live queries (simpler, slower at scale) or a
  materialized search index (faster, real infrastructure) - an ADR-level
  decision, not something to default into mid-implementation.

## 5. Analytics

**Objective**: reporting/trend analysis beyond the Dashboard's
operational KPIs - historical trends, dealer performance comparisons,
whatever the business defines as "Analytics" distinct from "Dashboard"
(this distinction itself needs an explicit product decision before
scoping - the two are easy to conflate).

**Dependencies**: Dashboard should exist first (Analytics is naturally
"Dashboard, but historical/comparative" - building it first risks
duplicating query/aggregation logic Dashboard will also need).

**Estimated scope**: Unknown until product scope is defined - this is
the least-specified item in the priority list and should not be
estimated further without an explicit requirements pass first, per
"never assume schema"/"never fabricate mappings" applied to planning,
not just data.

**Risks**:
- Scope is undefined as of this document - the single biggest risk is
  starting implementation before answering "what is Analytics that
  Dashboard isn't."
- Historical trend analysis implies retaining/aggregating data over
  time windows this app has never needed before - real storage/query
  planning required, not assumed to be free.

## 6. AI Platform

**Objective**: whatever AI-assisted capability MASP eventually wants
(the existing `AI_CONTEXT.md`/legacy naming references an "AI Copilot" as
a future module, never scoped beyond the name).

**Dependencies**: genuinely depends on the other five - an AI feature
needs real workflow state, real notifications, a real event stream, and
real dashboard/analytics data to be useful against, rather than
hallucinating in a vacuum. Deliberately last.

**Estimated scope**: Unknown - entirely unscoped today. The first real
milestone here would itself likely be a scoping/design exercise, not
implementation.

**Risks**:
- Highest uncertainty of any item on this list - no existing design, no
  existing ADR, no existing user-facing precedent anywhere in this app.
- Real risk of fabrication/hallucination if scoped or built without
  grounding in the real data the other five items produce - this is the
  same "never fabricate mappings, never silently guess" discipline this
  session's NTR UAT applied to address/serial validation, applied at the
  planning level to an entire future module.

---

## What this document deliberately does not do

- No implementation, no code, no schema change for any of the six items.
- No milestone scheduling - "next" in the priority order is not the same
  as "approved to start."
- No resolution of the Storage-Platform-stash's own, differently-scoped
  "Phase 6" recommendation - flagged for reconciliation, not decided here.
