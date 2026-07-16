# 18 — Canonical Event Catalog

06 defined the *mechanism* — the `PlatformEvent` envelope and the
producer/consumer flow — and deliberately called its own catalog
"representative, not exhaustive." This document is the governed,
canonical list that catalog was always meant to converge on: every event
name below is the authoritative name for that fact, platform-wide. A new
event type is added to this list only through 20's Breaking Change
Process (additive is cheap; renaming an already-shipped event name is
not), matching 11's existing "additive-only" discipline applied to event
names specifically, not just table columns.

## Canonical Events

| Event | Owning Module (only producer) | Machine Lifecycle stage (03) |
|---|---|---|
| `MachineImported` | Machine (Registry — Tractor IN sync) | Factory / Import |
| `ImportPDICompleted` | Inspection | Import PDI |
| `DealerReceived` | Machine (Registry — dealer assignment) | Released to Dealer / Dealer Receive |
| `DealerPDICompleted` | Inspection | Dealer PDI |
| `MachineDelivered` | Registration (NTR) | Customer Delivery |
| `WarrantyActivated` | Service (Warranty) | Warranty Activated |
| `PMCompleted` | Maintenance (PM) | PM |
| `MQROpened` | Quality (MQR) | MQR |
| `MQRClosed` | Quality (MQR) | MQR |
| `PIPCreated` | Quality (PIP) | PIP |
| `PIPCompleted` | Quality (PIP) | PIP |
| `OwnershipTransferred` | Machine (Ownership) | Ownership Transfer |
| `Retired` | Machine (Registry) | Retired |

This list is 03's Machine Lifecycle diagram and 06's Event Catalog made
concrete and named — the same 13 stages, now as literal
`PlatformEventType` values a producer emits and a consumer pattern-matches
on, not prose.

## Event ownership

**Every event type has exactly one owning module — the only bounded
context permitted to emit it.** This is 02's Conformist/Published
Language relationship enforced event-by-event, not just at the
architecture-diagram level:

- Only Registration (NTR) emits `MachineDelivered` — Inspection,
  Knowledge, or any other module that reacts to a delivery never emits
  it themselves, even if they'd find it convenient. They consume it.
- Only Quality (MQR) emits `MQROpened`/`MQRClosed` — Knowledge building a
  case from a closed MQR does not re-emit or duplicate the event, it
  reads it.
- Only Machine (Registry/Ownership) emits `MachineImported`,
  `DealerReceived`, `OwnershipTransferred`, `Retired` — these describe the
  Machine aggregate itself, not a Service Record referencing it (02's
  Aggregate Roots distinction).

**Why this matters**: without a single owning producer, two modules could
each emit their own version of "this machine was delivered" with
slightly different timing/fields, and Knowledge (07)/Analytics (09) would
have to reconcile two sources of truth for one fact. Naming exactly one
owner per event is what makes "capture data once, reuse it everywhere"
(01 Principle 9) actually enforceable rather than aspirational.

**Consumers never become producers of an event they don't own.** Timeline
(03), Knowledge (07), Analytics (09), and Engineering Intelligence (08)
all read from this catalog; none of them emit any event in this table —
they emit their *own* domain's events where applicable (e.g., Knowledge
emits its own `KnowledgeCaseCreated`/`KnowledgeCaseUpdated`, outside this
table because they aren't Machine Lifecycle events) but never a Machine
Lifecycle event belonging to another module.

## Relationship to 06

06 remains the canonical reference for the event *shape*
(`PlatformEvent` envelope, `FieldChange[]`, `metadata` bag) and the *flow*
(producers → event log → Timeline/Knowledge/Analytics/Engineering
Intelligence). This document is the canonical reference for the event
*names* and their *ownership*. 06's own catalog section should be read as
superseded by this document for the 13 Machine Lifecycle events above;
06 continues to be correct for the general mechanism and for event types
outside the Machine Lifecycle (e.g., the already-shipped
`SESSION_CREATED`/`LOGIN_SUCCESS` auth events).

## Relationship to `docs/standards/EVENT_CATALOG.md`

**Added by ADR-025 (Canonical Event Catalog Consolidation) - purely
additive documentation cross-reference; no event name or ownership
assignment above is changed by this section.** `docs/standards/
EVENT_CATALOG.md` is the DB-level index of `event_definitions`'
UPPER_SNAKE_CASE `event_code`s (e.g. `MQR_OPENED`) - a different naming
layer for several of the same facts named above in PascalCase (e.g.
`MQROpened`). This document remains authoritative for event *name* and
*ownership*; that document is authoritative for the literal `event_code`
and Timeline display metadata neither this document nor 06 defines. See
`docs/governance/EVENT_OWNERSHIP.md` for the full name-mapping table
between the two.

## Explicitly not decided here

- The exact `PlatformEvent.metadata` shape per event type (e.g. what
  `WarrantyActivated`'s metadata contains) — an implementation detail for
  whichever phase (13) actually builds that producer.
- Whether this table needs a machine-readable form (e.g. a shared
  `PlatformEventType` union type file) before or as part of
  implementation — a normal engineering decision at build time, not an
  architecture question this document needs to answer.
