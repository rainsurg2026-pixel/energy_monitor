# ADR-009: Machine Domain

## Problem

MASP's business terminology was "Tractor, NOT Vehicle" per
`docs/standards/DOMAIN_LANGUAGE_STANDARD.md` (Release 1.0). Phase 5B's
brief introduces a third, platform-wide term - **Machine** - as the
ubiquitous business entity every current and future module (PM, PDI, NTR,
MQR, Campaign, Parts, Knowledge Platform, AI Copilot) is meant to share,
in preparation for Product Categories beyond Tractor (Harvester, Power
Tiller, Implement, Engine). The existing standard explicitly says to "stop
and report" rather than silently introduce new terminology - this ADR is
that report, plus the decision that followed.

## Decision

Adopt **Machine** as the platform business entity, superseding "Tractor,
NOT Vehicle" for the aggregation/platform layer (Machine 360, Machine
Search, Machine Timeline, Machine Health, Machine Lifecycle, Machine
Registration, Machine Maintenance, Machine Attachments, Machine Event).
"Tractor" survives one level down, as today's single Product Category in
a new Product Hierarchy:

```
Machine → Product Category → Product Family → Model → Variant → Serial Number
```

No database table is renamed - `vehicles`, `vehicle_events`,
`vehicle_health`, etc. keep their current names permanently. A new facade
layer, `src/features/machine/` (`MachineService`, `MachineRepository`),
gives new code a Machine-named entry point without rewriting
`src/features/vehicle/`'s internals. See
`docs/engineering/MACHINE_DOMAIN.md` for the full file-by-file account.

## Alternatives Considered

- **Full rename** (`src/features/vehicle/` → `src/features/machine/`,
  every exported symbol renamed, every caller updated) — matches the brief
  most literally, but there was no `VehicleRepository`/`VehicleService`
  class to rename to begin with (vehicle reads are plain functions in
  `lib/db.ts`); a full rename would touch the provider registry, every
  module's `VehicleSummaryProvider` implementation, and dozens of import
  sites, for a change that is pure naming, not logic. Rejected for this
  pass as disproportionate regression risk for the actual requirement;
  left as a documented option in `MACHINE_DOMAIN.md` if a second, unrelated
  reason ever justifies that scope of change.
- **UI/docs terminology only, no new classes** — lowest effort, but doesn't
  satisfy the brief's explicit "Repository: MachineRepository / Service:
  MachineService" architecture line. Rejected.
- **Silently updating `DOMAIN_LANGUAGE_STANDARD.md` without a note** —
  rejected: that document is binding and other engineers/agents will read
  it; a bare content change with no record of *why* it changed would look
  like an unreviewed contradiction of Release 1.0. Its Business Domain
  section now carries an explicit forward-reference to this ADR instead.

## Consequences

- New code depends on `@/features/machine`, not `@/features/vehicle`,
  going forward.
- `docs/standards/DOMAIN_LANGUAGE_STANDARD.md`'s Business Domain, Official
  Menu Standard, and Official Business Terminology sections now describe
  Machine as the platform entity, with a note pointing back to this ADR
  for why the Release 1.0 "Tractor, NOT Vehicle" rule no longer holds
  as originally written.
- A future Product Category (Harvester, Power Tiller, ...) needs a
  `Product Category` column somewhere in the `product_families` lineage -
  not added in this pass since exactly one category (Tractor) exists
  today; called out as a gap, not silently solved.
