# Machine Digital Passport — Architecture

v1.2 (refined across two pre-merge PR #39 reviews; v1.0 baseline unchanged
in shape). See `docs/adr/ADR-026-Machine-Digital-Passport.md` for the
decision record this document expands on. Builds directly on the frozen
foundation: Architecture Blueprint v1.1, Platform Governance v1.1, MSEAL
Design Framework v1.1, Navigation Standard, Dashboard Standard,
Authentication Platform v3.x, Import Platform Foundation. No frozen
document was modified to build this.

## What this is

`/machines/[machineId]` (`machineId` = Serial Number) is the permanent home
of one machine across its whole lifecycle - Next Recommended Action,
Identity, Lifecycle, Ownership, Machine Health, Warranty, Preventive
Maintenance, Quality, Related Records, Documents, an Activity Timeline,
and placeholder Knowledge Integration / Reserved AI / Machine Completeness
/ Future IoT sections. It is an **aggregation layer**, exactly like
Vehicle 360 before it: it owns no data of its own and runs no query that
isn't already scoped by an existing module's own read function.

## v1.1 refinement (5 additions, no redesign)

A post-PR #39 review asked for five additions before merge, each reusing
an existing MSEAL widget, adding no table, and changing no authorization
path. None of them alter the v1.0 page shape described below - they slot
into the existing core-fetch/Suspense-section structure:

| # | Addition | Reuses | Fetch path | Future capability documented |
|---|---|---|---|---|
| 1 | Machine Health panel | `HealthCard` widget | Core (already-fetched `MachineSummary.healthScore`/`healthStatus` - zero new query) | Today's single computed signal is reserved to grow into trend history, sensor-driven inputs (once Future IoT lands), and predictive scoring |
| 2 | Knowledge Score tile | `EmptyState` (`comingSoon`), added to the existing Knowledge Integration grid | None (placeholder) | A documentation-completeness metric - no scoring logic exists yet |
| 3 | Lifecycle Timeline filtering | The existing `Timeline`/`TimelineItem`/`MachineTimelineRow` rows, `data-category` DOM hook | Client-side only, over the already-fetched milestone `timeline` array | N/A - a UI affordance, not a placeholder |
| 4 | Related Records panel | The existing list-row pattern (same shape as Warranty Claims/PM History/Quality Cases) | New `<Suspense>` section, reusing `fetchMqrRecords`/`fetchMaintenanceHistoryForSerial`/`fetchNtrRecordsForSerial` (same three reads Warranty/PM/Quality/Activity already call) | N/A - a real, working cross-module list |
| 5 | Reserved AI panels | `EmptyState` (`comingSoon`) | None (placeholder) | Machine Intelligence phase of `docs/ROADMAP.md`'s Next Development Phase order |

Items 2 and 5 are pure UI placeholders (no data source exists to back
them); items 1 and 4 use real, already-available data through existing
reads; item 3 is a real client-side feature over already-fetched data.
None introduce a new widget type (MSEAL Widget Guidelines' seven
contracts already covered every case).

### 3. Timeline filtering, in detail

`MachineTimelineFilterBar` (`features/machine/components/`, `'use client'`)
wraps the Lifecycle panel's existing server-rendered `Timeline` output -
it receives the already-rendered `MachineTimelineRow` JSX as `children`
(a Server Component's output can be passed into a Client Component as
children/props in the App Router) and only toggles each row's inline
`display` via a DOM effect, keyed off a `data-category` attribute each row
now carries (`TimelineItem`'s new optional `dataCategory` prop, purely a
pass-through - every existing caller omits it and is unaffected).

This shape was chosen specifically to avoid a second, client-rendered
timeline: `MachineTimelineRow` renders through the server-only
`lib/i18n/server` translator, so a client-side re-render of the same rows
would require either duplicating the row component with a client-side
translator (rejected - "no duplicate timeline") or this DOM-toggle
approach (chosen). Filter categories (`all`/`ntr`/`pm`/`mqr`/`other`) are a
fixed lookup from `MachineEventType` - not a new classification system.

### 4. Related Records, in detail

`MachineService.getMachineRelatedRecords()` re-runs the same three scoped
reads `getMachineWarrantySummary()`/`getMachineQualitySummary()`/
`getMachineAuditTimeline()` already call, and flattens the result into one
`MachineRelatedRecord[]` list (module + reference + status + date + link
to that record's own detail page). This is an accepted, pre-existing
trade-off, not a new one: this page already re-fetches the same MQR/PM/NTR
record sets independently per Suspense section (no request-level cache
exists yet - see "Known gaps"); Related Records is a fourth independent
consumer of the same pattern, not a new one.

## v1.2 refinement (4 more additions, no redesign)

A second pre-merge review asked for four more items, again each reusing
an existing MSEAL widget and touching no table/authorization path:

| # | Addition | Reuses | Fetch path | Future capability documented |
|---|---|---|---|---|
| 1 | Documentation drift resolution (Variant/Manufacturing Year) | N/A - doc-only | N/A | See `MACHINE_DATA_OWNERSHIP.md`'s "Documentation correction" - Current/Future Source of Truth |
| 2 | Machine Completeness panel | `StatusPill` (same pattern as Lifecycle's stage badges) + `EmptyState` | None (placeholder) | A Data Quality indicator across all seven Passport data dimensions - no scoring algorithm exists yet |
| 3 | Next Recommended Action panel | `EmptyState` (`comingSoon`) | None (placeholder) | The future AI entry point (Machine Intelligence) - positioned near the top of the page, distinct from Reserved AI panels lower down |
| 4 | Related Records Open/History split | The same list-row pattern, split into two `<h3>`-headed groups | None (client-side split of the already-fetched `MachineRelatedRecord[]`) | N/A - a real split of already-fetched data |

Item 1 is the only non-code item - it corrects a documentation claim, not
the data model (explicitly out of scope for this refinement). Item 4
reuses the same `OPEN_STATUSES` classification `getMachineQualitySummary()`
already applies to MQR; PM and NTR records always bucket as `'history'`
since neither has a genuine "open" workflow state in this schema (see
`docs/architecture/MACHINE_DATA_OWNERSHIP.md`).

### 3. Next Recommended Action, placement rationale

Positioned directly after the page header, before Identity - the one
place on the page a user's eye lands first. This is deliberate: once
Machine Intelligence exists, "what should I do about this machine right
now" is meant to be the very first thing shown, not buried among the
other placeholder sections. Reserved AI panels (v1.1, §12 of the Screen
Contract) remain lower on the page as the broader set of future AI
capabilities (diagnostic assistant, predictive failure alert, root cause
suggestion) - Next Recommended Action is the single, prominent entry
point into that broader set, not a duplicate of it.

## Data flow

```
                          MachineService (features/machine/service.ts)
                                       (ADR-009 facade)
                                            │
        ┌────────────────┬─────────────────┼──────────────────┬────────────────┐
        ▼                ▼                 ▼                  ▼                ▼
getVehicleSummary   getVehicleTimeline  fetchMqrRecords   fetchMaintenance   fetchNtrRecords
(vehicle/service)   (vehicle/service)   (mqrEvents.ts)    HistoryForSerial   ForSerial
                                                           (maintenance)      (ntr)
        │                │                 │                  │                │
        └── MachineSummary                 └── MqrRecord[] ───┴── warranty/quality/PM
             (Identity/Ownership/                                  derivations
              Lifecycle-signal fields)
                                            │
                                   listAuditLogForRecords (lib/db.ts, new)
                                            │
                                   mapMixedAuditLogToActivityEvents
                                   (components/shared/activity-timeline)
                                            │
                                     ActivityEvent[]  →  <ActivityTimeline>
```

Nothing here bypasses an existing module's own scoped read. `MachineService`
is the *only* new query surface, and it is four thin aggregation methods
(`getMachineWarrantySummary`, `getMachineQualitySummary`,
`getMachineAuditTimeline`, `getMachineRelatedRecords`) plus the two that
already existed (`getMachine360`, `getMachineTimeline`, both pre-dating
this build).

## Page composition & lazy loading

`src/app/(app)/machines/[machineId]/page.tsx` fetches three things up
front, in one `Promise.all` (all cheap - a single provider-aggregation
call, the existing milestone timeline, and one vehicle row lookup for the
Variant field):

- `MachineSummary` (feeds Identity, Lifecycle's stage badges, Ownership)
- the milestone timeline (feeds Lifecycle's timeline sub-section)
- the raw `vehicles` row (feeds Identity's Variant field only)

Everything else - Warranty, Preventive Maintenance, Quality, Documents,
Activity Timeline - is each its own small async Server Component
(`features/machine/components/sections/Machine*Section.tsx`), individually
wrapped in `<Suspense fallback={<Skeleton .../>}>` on the page. This means:

- A slow Activity Timeline query (the heaviest - it reads every MQR/PM/NTR
  record id for the machine, then bulk-queries `record_audit_log` per
  module) never blocks Identity/Lifecycle/Ownership from painting first.
- Each section fails/loads independently - a Warranty query error doesn't
  take down the Quality section next to it (React error boundaries per
  Suspense boundary is a natural follow-up, not yet added in v1.0 - see
  "Known gaps" below).
- No new caching layer was introduced; each section reuses whatever
  caching its underlying read already had (none, today - matching Vehicle
  360's own behavior. `force-dynamic` is set on the page, same as Vehicle
  360).

Knowledge Integration and Future IoT have no data source at all, so they
render synchronously (no `Suspense` needed - there's no query to await).

## Two timelines, not one

The Lifecycle panel reuses the **existing** milestone timeline verbatim
(`MachineService.getMachineTimeline()` → `vehicle_events` →
`MachineTimelineRow`, the same component/query Vehicle 360 already used -
extracted, not duplicated, from Vehicle 360's previously-local
`TimelineRow`). The new Activity section is a **different** feed:
`record_audit_log` field-level changes across this machine's own MQR/PM/NTR
records, mapped through the same `mapMixedAuditLogToActivityEvents()`
adapter Platform Overview's "Today's Activities" widget already uses, and
rendered through the platform-standard `<ActivityTimeline>` component
(MSEAL Design Framework, ADR-023).

These are deliberately not merged:

| | Milestone timeline (Lifecycle) | Activity Timeline (new) |
|---|---|---|
| Source table | `vehicle_events` | `record_audit_log` |
| Granularity | One row per business milestone (NTR Created, MQR Opened, ...) | One row per field/status/photo change |
| Component | `Timeline`/`TimelineItem`/`MachineTimelineRow` | `<ActivityTimeline>` |
| Scope today | NTR fully wired; MQR/PM via bespoke adapters | MQR/PM/NTR, uniformly, via `record_audit_log` |

Merging them would either drop the fine-grained detail the Activity feed
carries, or force `vehicle_events` rows to carry diff payloads they were
never designed for. Two clearly labeled sections instead.

## Permissions

No new authorization model. Every read goes through the same
`AuthorizationScope`/`resolveDealerScope` dealer-scoping every other
module already uses - `getVehicleSummary`, `fetchMqrRecords`,
`fetchMaintenanceHistoryForSerial`, and `fetchNtrRecordsForSerial` each
apply their own existing scope check; the Passport page never queries a
table directly. A machine outside the caller's dealer scope returns
`summary === null`, and the page renders the same "not found" shape
Vehicle 360 already uses for that case - it does not distinguish "doesn't
exist" from "exists but you can't see it," matching Vehicle 360's existing
behavior (avoids leaking existence).

## Known gaps (v1.0, not silently deferred)

- No per-section error boundary yet - a thrown error inside one `Suspense`
  boundary currently bubbles to the Next.js route error boundary for the
  whole page, not just that section. Acceptable for v1.0 since every
  underlying read already has its own error handling; flagged as a
  follow-up once a second Passport-like page exists to justify a shared
  `<SectionErrorBoundary>`.
- No response caching beyond what already existed. If this page's load
  time becomes a real problem, the individual `Machine*Section` components
  are the natural seam to add `unstable_cache`/tag-based revalidation to,
  one at a time, without touching the page shell.
- See `docs/architecture/MACHINE_DATA_OWNERSHIP.md` for the data-model
  gaps (Manufacturing Year/Country, Variant, Ownership History) and
  `docs/architecture/MACHINE_LIFECYCLE.md` for the lifecycle-stage
  derivation gaps (Registered vs. Delivered, PIP, Recall).
