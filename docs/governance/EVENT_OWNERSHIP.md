# Event Ownership

## Relationship to existing documents (a real drift, now consolidated)

Two documents both claimed to be a canonical event catalog and
disagreed. **Resolved by `docs/adr/ADR-025-Canonical-Event-Catalog-
Consolidation.md`** (this same PR) - both catalogs remain, reclassified
as governing two different layers of the same facts, with an explicit
mapping table added to `docs/standards/EVENT_CATALOG.md` and a purely
-additive cross-reference added to the frozen
`docs/architecture/blueprint/18-CANONICAL-EVENT-CATALOG.md` (no existing
name/ownership row in 18 was changed - see the ADR's "Decision" section
for why this counts as a documentation correction, not a Breaking
Change).

| | `docs/standards/EVENT_CATALOG.md` | `docs/architecture/blueprint/18-CANONICAL-EVENT-CATALOG.md` |
|---|---|---|
| Status | Binding-but-secondary to the DB | Frozen (event ownership, one of 20's 5 Freeze items) |
| Naming convention | `event_code`, UPPER_SNAKE_CASE | `PlatformEventType`, PascalCase |
| Scope | Vehicle Life Cycle Timeline (broad - includes NTR/Campaign/Parts/Telematics/Software-Update) | Machine Lifecycle specifically (13 named types) |
| Cross-references the other? | **Yes, now** (ADR-025) | **Yes, now** (ADR-025, additive only) |
| Authoritative for | `event_code` + Timeline display metadata (label, order) | Event *name* and *ownership* |

## Canonical Events

Both catalogs are canonical, for different layers - see ADR-025. Do not
pick one over the other; check both, per the mapping table in
`docs/standards/EVENT_CATALOG.md`.

## Owners (per 18, unchanged, cited not restated)

Each of 18's 13 `PlatformEventType`s has exactly one owning module (the
sole permitted producer) - see 18 directly for the full table.

## Publishers / Consumers

- **Publishers**: exactly the owning module named in 18 for
  Machine-Lifecycle events; whichever module's repository/service layer
  calls `logAuditEvent()`/`logAuditEvents()` for Activity-Timeline-scoped
  events (`EVENT_CATALOG.md`'s "which modules actually publish today"
  section - MQR, PM, NTR at various stages of completeness).
- **Consumers**: Timeline (both catalogs), Knowledge (07, Machine
  -Lifecycle events only), Analytics (09), Engineering Intelligence (via
  Knowledge only, never events directly - 08's "no independent data of
  its own" rule applies here too).

## Naming Standards (now binding, per ADR-025)

1. **Check the mapping table in `docs/standards/EVENT_CATALOG.md` first**
   - a name that exists in one catalog under different casing for the
   same fact must not get a third name; extend the mapping table instead.
2. If the event is a Machine Lifecycle event (fits one of 18's 13 named
   stages), extend 18 - PascalCase, past tense, one owning module (18's
   existing convention) - requires 20's ADR process (18 is frozen).
3. If the event is a Timeline/operational event outside Machine Lifecycle
   scope, extend `docs/standards/EVENT_CATALOG.md` - UPPER_SNAKE_CASE
   `event_code`, added to `event_definitions` first (DB is authoritative).
4. When a currently-18-only event gets a real producer
   (`WarrantyActivated`, `PIPCreated`, `PIPCompleted`,
   `OwnershipTransferred`, `Retired`), add its `event_code` and mapping
   row to `EVENT_CATALOG.md` at the same time - don't let the two drift
   apart again.

## Versioning Rules

An event's **name and ownership** are frozen (18) - changing either is
always a Breaking Change, full ADR process, no exception. An event's
**metadata shape** is not itself frozen (18 explicitly leaves "exact
`metadata` shape per event" undecided) - additive metadata fields are a
domain-local change for the owning module; removing or renaming an
existing metadata field is a Breaking Change (it can silently break every
consumer that reads it). Formalized by ADR-025 alongside the
consolidation itself.

## Gap Analysis

- The drift is resolved at the documentation layer (ADR-025); no code
  changed - `VehicleEventPublisher`, `event_definitions`, and every
  existing `event_code` are untouched.
- No machine-readable `PlatformEventType` union type exists yet (18
  explicitly leaves this undecided) - a real future gap, not resolved
  here.
- `MachineImported`/`FACTORY_BUILD` is flagged in the mapping table as
  "related but not identical" rather than a clean 1:1 pair - re-verify
  when a real Machine-import producer is built, don't assume the mapping
  holds without checking.
