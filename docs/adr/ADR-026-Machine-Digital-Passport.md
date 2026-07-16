# ADR-026: Machine Digital Passport v1.0

> Numbering note: this branch (`feature/machine-digital-passport`) is
> stacked on `feature/mseal-design-framework` (PR #37, ADR-023), which is
> itself stacked ahead of the still-open `docs/platform-governance-framework`
> (PR #38, "proposed" ADR-024/ADR-025) and `feature/import-platform-v2`
> (PR #36, "proposed" ADR-022). None of those are merged to `main` yet.
> `ADR-026` is chosen to sit after every number already claimed by an open
> PR, avoiding a collision; final ADR numbering is reconciled once the
> stack merges, same pattern already used for ADR-022/024/025 while they
> were open.

## Problem

Architecture Blueprint v1.1, MSEAL Design Framework v1.1, and ADR-009
(Machine Domain) establish Machine as the platform's ubiquitous business
entity, but no dedicated page exists yet — "Machine Passport" is a Coming
Soon placeholder in `navConfig.ts`, and everything Machine-shaped lives
inside Vehicle 360 (`/vehicles/[serial]`), a page named and routed after
the pre-ADR-009 "Tractor, NOT Vehicle" convention. This is the first
business capability built directly on top of that foundation: a permanent,
dedicated home for one machine's full lifecycle, ownership, warranty, PM,
quality, documents, and (future) knowledge/IoT data.

## Decision

Ship `/machines` (search/landing) and `/machines/[machineId]` (the
Passport itself) as new routes, additive to - not replacing - the existing
`/vehicles` and `/vehicles/[serial]` routes. `machineId` is the machine's
**Serial Number**, the same natural key `/vehicles/[serial]` already
routes on, not the `vehicles.id` UUID - a search result can reference a
Tractor-IN-sheet row that hasn't synced into `vehicles` yet (no `id` to
route on), but always has a serial.

`MachineService` (`src/features/machine/service.ts`, the existing ADR-009
facade over `features/vehicle/service.ts`) gains three new methods -
`getMachineWarrantySummary()`, `getMachineQualitySummary()`,
`getMachineAuditTimeline()` - rather than a new service class, since the
Passport's data needs are almost entirely re-aggregations of data
`Machine 360`/PM/MQR/NTR's own scoped reads already produce. No new
tables, no new repository, no new authorization model: every read goes
through the exact same dealer/branch-scoped functions
(`getVehicleSummary`, `fetchMqrRecords`, `fetchMaintenanceHistoryForSerial`,
`fetchNtrRecordsForSerial`) Vehicle 360 and PM/MQR/NTR's own pages already
call.

The Passport page is composed from ten presentational panels
(`src/features/machine/components/`) built entirely from existing MSEAL
Design Framework primitives (`Card`, `DetailRow`, `KpiCard`, `StatusPill`,
`EmptyState`, `Skeleton`, `Timeline`/`TimelineItem`, `AttachmentViewer`,
`<ActivityTimeline>`) - no new visual language introduced. Five of the
heavier panels (Warranty, PM, Quality, Documents, Activity) are each
fetched by their own small async Server Component and wrapped in a
`<Suspense>` boundary with a `Skeleton` fallback, so one slow query never
blocks the sections above it from painting (the task's "load sections
independently, lazy-load heavy widgets" requirement) - Identity/
Lifecycle/Ownership stay on the page's one fast, blocking `Promise.all`
since they need nothing beyond `MachineSummary`, already fetched for the
page header.

Two timeline systems are deliberately kept, not merged: the existing
milestone timeline (`MachineService.getMachineTimeline()`, `vehicle_events`
-backed, rendered via `Timeline`/`TimelineItem`/`MachineTimelineRow`) is
reused verbatim inside the new Lifecycle panel; a *new* field-level
"Machine Timeline" (`getMachineAuditTimeline()`, `record_audit_log`
-backed, rendered via the platform-standard `<ActivityTimeline>`) is added
as its own Activity section. See
`docs/architecture/MACHINE_PASSPORT_ARCHITECTURE.md` for why these are
complementary, not duplicative.

Knowledge Integration (Knowledge Cases, Known Problems, Troubleshooting,
AI Recommendation, Prediction) and Future IoT (Running Hours, Fuel, GPS,
Engine Health) ship as `EmptyState` placeholders in the `comingSoon` tone
only - no AI, no telemetry, per the explicit "do not implement AI yet"
instruction.

## Alternatives Considered

- **A new `MachineRepository`/parallel data layer** — rejected: every
  data need the Passport has is already served by an existing, scoped
  read; a parallel repository would either duplicate those reads or
  introduce a second, unscoped path to the same tables. `MachineRepository`
  (ADR-009) stays intentionally unused, as already documented on that
  class.
- **Route `machineId` as the `vehicles.id` UUID** — considered first
  (a genuinely more "permanent" key than a natural key), but rejected once
  grounding showed `searchVehicles()`'s results can include Tractor-IN
  sheet rows with no synced `vehicles.id` yet - an id-keyed route would be
  unreachable for exactly those machines until their next sync. Serial
  avoids that gap entirely and matches `/vehicles/[serial]`'s existing
  precedent.
- **Merge the milestone timeline and the audit-log timeline into one
  feed** — rejected: they read different tables with different
  granularities (business milestones vs. field-level changes) and merging
  them would either drop detail or force `vehicle_events` to carry
  field-diff payloads it was never designed for. Kept as two clearly
  labeled sections instead - see `MACHINE_PASSPORT_ARCHITECTURE.md`.
- **Redirect `/vehicles/[serial]` to `/machines/[serial]`** — rejected for
  this pass: Vehicle 360 is a live, working page with its own callers/
  bookmarks/links from PM, MQR, and NTR detail pages; retiring it is a
  separate, larger decision than "add the Passport," out of scope here
  and called out as a follow-up in `MACHINE_PASSPORT_ARCHITECTURE.md`.

## Consequences

- `Vehicle 360` and `Machine Passport` both exist and are cross-linked
  (a "View Machine Digital Passport →" link on Vehicle 360); nothing about
  Vehicle 360 changed beyond the extraction of its `TimelineRow` helper
  into the shared `MachineTimelineRow` component and that one added link.
- Genuine, honestly-documented data-model gaps exist and are **not**
  fabricated to fill the Passport's Identity/Ownership sections:
  Manufacturing Country and an Ownership History table have no column/
  table anywhere; Manufacturing Year and a true "Variant" field do exist
  (sparsely, on `NtrRecord`) but aren't yet a reliable-enough source to
  promote to Identity - see the v1.2 addendum below and
  `docs/architecture/MACHINE_DATA_OWNERSHIP.md` for the corrected,
  current account.
- `navConfig.ts`'s Machines → Machine Passport entry is now a real route
  (`/machines`), no longer Coming Soon; `navConfig.test.ts` updated to
  match.

## Addendum: v1.1 refinement (pre-merge review of PR #39)

Before merge, a review requested five additions: a Machine Health
placeholder, a Knowledge Score placeholder, Lifecycle Timeline filtering,
a Related Records panel, and Reserved AI panels. All five reuse existing
MSEAL widgets (`HealthCard`, `EmptyState`, the existing list-row pattern),
add no table, and change no authorization path - see
`docs/architecture/MACHINE_PASSPORT_ARCHITECTURE.md`'s "v1.1 refinement"
section and `docs/architecture/MACHINE_PASSPORT_SCREEN_CONTRACT.md`'s
updated section table for the full detail. Two small, additive component
changes were needed to support Timeline filtering without duplicating the
timeline: `TimelineItem` gained an optional `dataCategory` prop (a
`data-*` DOM attribute, default omitted, zero behavior change for its
other caller in `ntr/[id]/page.tsx`), and `MachineTimelineRow` gained an
optional `category` pass-through of the same shape.

One data-model correction was found during this refinement, flagged here
rather than silently fixed (per the Grounding/Scope rules): `NtrRecord`
(`features/ntr/types/index.ts`) actually carries `variant` and
`manufacturing_year` columns - contradicting this document's original
"no column exists anywhere" claim about Manufacturing Year and Variant.
Both are populated by Legacy Import but **not** by the current manual NTR
registration form (a 2026-07 form change dropped them), so they are real
but sparse. Wiring Identity to read them was deliberately left out of this
refinement (out of the five requested items, and Identity is on the
page's blocking core-fetch path - adding an NTR read there is a separate,
larger decision) - flagged for a future pass, not silently corrected or
silently left wrong.

## Addendum: v1.2 refinement (second pre-merge review of PR #39)

A second review, before the v1.1 refinement above was merged, requested
four more items:

1. **Resolve the documentation drift** flagged in the v1.1 addendum. Done
   in `docs/architecture/MACHINE_DATA_OWNERSHIP.md`'s new "Documentation
   correction" section: the Current Source of Truth for Variant/
   Manufacturing Year is `NtrRecord.variant`/`NtrRecord.manufacturing_year`
   (Legacy-Import-only, sparse); the Future Source of Truth is
   deliberately left as an open, two-option question (re-collect on the
   NTR form vs. promote to `vehicles` master data) rather than picked
   here - it's a business decision this ADR isn't positioned to make
   alone. **The data model itself was not touched** - Identity still reads
   `vehicles.sub_model`/"not tracked yet" exactly as before, since sparse,
   registration-date-dependent data is a worse Identity source than an
   honest "not tracked yet."
2. **Machine Completeness placeholder** (`MachineCompletenessPanel`) -
   names the seven dimensions (Identity/Ownership/Warranty/PM/Quality/
   Documents/Knowledge) as a future Data Quality indicator via `StatusPill`
   badges (the same pattern Lifecycle's stage badges already use) plus an
   `EmptyState`. No scoring algorithm exists - naming the dimensions
   without scoring any of them, same "don't fake it" treatment as
   Knowledge Score/Reserved AI.
3. **Next Recommended Action placeholder** (`MachineNextActionPanel`) -
   one `EmptyState` tile, positioned near the top of the page (right after
   the header, before Identity) since it's meant to be the single, most
   prominent "what should I do next" prompt once Machine Intelligence
   ships - distinct from the broader Reserved AI panels section further
   down the page. No backend, no model, no recommendation logic.
4. **Related Records split into Open/History** -
   `MachineService.getMachineRelatedRecords()` gained a `bucket` field,
   reusing the exact `OPEN_STATUSES` classification
   `getMachineQualitySummary()` already applies to MQR. PM and NTR records
   always bucket as `'history'`: neither module has a genuine "open"
   workflow state in this schema (a `pm_records` row is only created once
   a visit is performed; every NTR write path sets `status: 'Completed'`
   at creation) - bucketing them as always-history is the honest read of
   the existing data, not an invented distinction. No new query - the same
   three scoped reads from v1.1 are reused, just tagged with one more
   computed field.

All four remain additive: no new table, no authorization change, no
redesign of the v1.0/v1.1 page shape. See
`docs/architecture/MACHINE_PASSPORT_ARCHITECTURE.md`'s "v1.2 refinement"
section and `docs/architecture/MACHINE_PASSPORT_SCREEN_CONTRACT.md`'s
updated section table for the full detail.
