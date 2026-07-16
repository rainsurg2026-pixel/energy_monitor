# ADR-025: Canonical Event Catalog Consolidation

## Status

Proposed (this PR, #38 - the Platform Governance Framework's governance
-blocker resolution pass). Numbered ADR-025 per `docs/adr/README.md`'s
index (ADR-015-021 reserved by blueprint 16; ADR-022/023 claimed by
other in-flight PRs; ADR-024 used earlier in this same pass to resolve
the ADR-009 duplicate).

## Problem

Two documents both claim to be a canonical event catalog and disagree:

- `docs/standards/EVENT_CATALOG.md` - binding-but-secondary to the
  database, UPPER_SNAKE_CASE `event_code`s (`MQR_OPENED`,
  `FACTORY_BUILD`), scoped to the Vehicle Life Cycle Timeline broadly
  (includes NTR/Campaign/Parts/Telematics/Software-Update events).
- `docs/architecture/blueprint/18-CANONICAL-EVENT-CATALOG.md` - frozen
  (event *ownership* is one of `20-ARCHITECTURE-GOVERNANCE.md`'s 5
  Architecture Freeze items), PascalCase `PlatformEventType`s
  (`MQROpened`, `MachineImported`), scoped to the 13-stage Machine
  Lifecycle specifically.

Neither cross-references the other. Several pairs name the *same
real-world fact* under different casing (`DealerReceived`/
`DEALER_RECEIVED`, `PMCompleted`/`MAINTENANCE_COMPLETED`, `MQROpened`/
`MQR_OPENED`, `MQRClosed`/`MQR_CLOSED`) with no stated rule for which
wins, or whether they're even meant to be the same thing. This is a real
drift, found while grounding the Platform Governance Framework
(`docs/governance/EVENT_OWNERSHIP.md`), not a hypothetical risk.

## Decision

**Both documents remain - this is not a merge, and no file is deleted.**
They are reclassified as governing two different *layers* of the same
underlying facts:

1. **18 remains authoritative for event *name* and *ownership*** - which
   `PlatformEventType` exists and which single module may produce it.
   This is frozen content; nothing in this ADR changes any name or
   ownership assignment 18 already makes.
2. **`docs/standards/EVENT_CATALOG.md` remains authoritative for the
   literal, DB-level `event_code`** and its Timeline display metadata
   (Thai/English label, display order) - implementation detail 18
   explicitly never defined ("the exact `PlatformEvent.metadata` shape
   per event type... an implementation detail").
3. A cross-reference table is added to `docs/standards/EVENT_CATALOG.md`
   mapping every event that exists in both catalogs to its counterpart
   in the other, with an explicit note for the one non-exact pair
   (`MachineImported`/`FACTORY_BUILD` - related but not asserted
   identical, since `MachineImported` is the Tractor-IN sync import and
   `FACTORY_BUILD` is reserved for a literal factory-build feed that
   doesn't exist yet).
4. A short, purely-additive cross-reference is added to 18 pointing back
   to `docs/standards/EVENT_CATALOG.md` - no existing row, name, or
   ownership statement in 18 is edited. This is a documentation
   correction under 20's own distinction ("a documentation correction...
   no process" vs. "a Baseline change"), not a Breaking Change, since it
   changes no decision - only adds a pointer to where the reader can find
   the DB-level counterpart.

## Alternatives Considered

- **Pick one catalog as the sole winner, delete/deprecate the other** -
  rejected. They serve genuinely different consumers today: 18 is read
  by architecture-level design work (Knowledge/Analytics/Engineering
  Intelligence consumption rules), `EVENT_CATALOG.md` is read by the
  actual running code (`VehicleEventPublisher`, `event_definitions`).
  Deleting either would remove real, currently-load-bearing information.
- **Rename 18's events to match `EVENT_CATALOG.md`'s casing (or vice
  versa)** - rejected. 18's names are frozen (Architecture Freeze);
  renaming them is a Breaking Change requiring full Architecture Review
  for a casing-convention preference, not a real defect - disproportionate.
  `EVENT_CATALOG.md`'s casing already matches its own DB column
  convention (snake_case throughout this codebase's schema,
  `docs/standards/DATABASE_STANDARD.md`) - changing it would create a
  new mismatch with every other table's naming instead.
- **Create a third, merged catalog** - rejected per
  `docs/governance/DOCUMENTATION_POLICY.md`'s own new rule: check for an
  existing document before creating a new one covering the same ground.
  A third catalog would be exactly the anti-pattern this ADR exists to
  stop.

## Consequences

- A new event should check both catalogs (the mapping table in
  `EVENT_CATALOG.md` makes this a five-second lookup) before being named
  - preventing a fourth naming convention or a fifth catalog from ever
  appearing.
- When a currently-18-only event (`WarrantyActivated`, `PIPCreated`,
  `PIPCompleted`, `OwnershipTransferred`, `Retired`) gets a real producer,
  its `event_code` is added to `EVENT_CATALOG.md` and its mapping row
  added at the same time - not left to drift again.
- No code changed - `VehicleEventPublisher`, `event_definitions`, and
  every existing `event_code` are untouched. This ADR is a documentation
  reconciliation, not a schema or API change.
