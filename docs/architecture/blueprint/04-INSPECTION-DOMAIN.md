# 04 — Inspection Domain

> **Amendment (ADR-017, Machine Delivery Platform)**: this chapter's
> proposal is implemented as `docs/architecture/INSPECTION_PDI.md` and
> the `inspections` table - reconciled, not replaced. `DEALER_PDI` is the
> only inspection type with a real screen this epoch; `IMPORT_PDI`
> remains schema-ready, no UI. Findings/Measurements/Parts Replacement/
> Sign-off/Dealer Approval/Technician Certification/Checklist Version -
> not named below - are additive columns on the same one-table shape this
> chapter already proposed. Original content preserved below as the
> historical record.

## Why Inspection is its own domain

Inspection is **not** part of NTR, PM, or Warranty. Each of those
contexts currently embeds inspection-like data as free-text fields or
skips it entirely (e.g. NTR's delivery flow has no first-class PDI
record today — the checklist, if performed, isn't captured as
structured data). Splitting Inspection out means:

- One inspection data model serves every inspection type, present and
  future, instead of NTR/PM/Warranty each inventing their own checklist
  shape.
- An inspection's result (`pass`/`fail`/`conditional`) becomes a Machine
  Timeline event and a Knowledge observation regardless of which
  operational module triggered it — a Dealer PDI failure and a Warranty
  Inspection failure feed the same downstream Knowledge/Analytics
  pipeline.
- A future inspection type (Annual Inspection, PIP Inspection) is a new
  enum value and a new set of checklist items, never a new table or a
  new bounded context.

## Inspection Types

| Type | Status |
|---|---|
| `IMPORT_PDI` | Target — first to implement (Phase 1 candidate, see 13) |
| `DEALER_PDI` | Target — second |
| `QA_INSPECTION` | Future |
| `PIP_INSPECTION` | Future — triggered by a PIP (05) needing field verification |
| `WARRANTY_INSPECTION` | Future |
| `ANNUAL_INSPECTION` | Future |
| `PRE_DELIVERY_INSPECTION` | Future — if distinct from `DEALER_PDI` in practice; confirm with the business before implementing both, don't guess |

## Inspection Data Model (proposed, additive-only — no migration in this PR)

```ts
interface Inspection {
  id: string;
  machine_id: string;          // references Machine (today: vehicles.id/serial)
  inspection_type: InspectionType;
  performed_by: string;        // username/technician id
  performed_by_type: 'Dealer' | 'Factory' | 'Technician' | 'ThirdParty';
  inspection_date: string;     // ISO, always stored/displayed via the existing GMT+7 formatter (lib/thaiDate.ts)
  status: 'Scheduled' | 'InProgress' | 'Completed' | 'Cancelled';
  result: 'Pass' | 'Fail' | 'Conditional' | null;
  remark: string | null;
  checklist: InspectionChecklistItem[];  // shape per inspection_type, see below
  photos: PhotoLink[];          // reuses the existing PhotoLink shape (lib/types.ts), same categories convention
  attachments: string[];        // Attachment Platform ids (ADR-010) — never a parallel storage mechanism
  related_service_record?: { module: AuditModule; recordId: string } | null; // e.g. the NTR record this Dealer PDI belongs to
  created_at: string;
  created_by: string;
}

interface InspectionChecklistItem {
  key: string;           // e.g. "brake_test", "hydraulic_leak_check"
  label: string;         // localized label, i18n-driven like every other user-facing string in this app
  result: 'Pass' | 'Fail' | 'NotApplicable';
  remark: string | null;
}
```

Design choices, and why:

- **One `inspections` table, not one per type.** Matches this platform's
  existing preference for a shared, discriminated-union-style table
  (`record_audit_log`'s `module` column, `auth_tokens`'s `purpose`
  column) over N near-identical tables.
- **`checklist` as a JSON column**, not a normalized child table. Each
  inspection type's checklist differs in item count/labels; a JSON
  column avoids a schema migration every time a checklist changes, at
  the cost of not being independently queryable per-item — acceptable
  since checklist-item-level analytics is not a near-term requirement
  (revisit if Analytics, 09, ever needs "fail rate for `brake_test`
  specifically" — that's a real, but deferred, design fork, tracked in
  14).
- **`related_service_record` is optional and generic**, matching
  `AuditModule`'s existing `'mqr' | 'pm' | 'ntr'` union (extended, not
  replaced, per 11) — an inspection can exist standalone (`IMPORT_PDI`
  before any service record exists) or be tied to the record that
  triggered it (`DEALER_PDI` tied to an NTR record).
- **Reuses `PhotoLink` and the Attachment Platform directly** — no new
  photo/attachment mechanism. This is a hard requirement, not a nice-to-
  have: Attachment Platform is Foundation-Frozen (PLATFORM_ARCHITECTURE_STANDARDS.md).

## Service architecture

```
InspectionService (new, features/inspection/)
  ├── createInspection()
  ├── completeInspection()   — sets result, emits INSPECTION_COMPLETED event (06)
  └── listInspectionsForMachine(machineId) — used by Machine Timeline (03) and Machine Profile (10)

InspectionRepository (new) — the only reader/writer of the `inspections` table,
  same repository-boundary rule as every other context (02).
```

## What this unlocks downstream

- **Timeline (03)**: `INSPECTION_COMPLETED` becomes a Machine Timeline
  entry with a "View Checklist" expand action — same expand/collapse UX
  the Activity Timeline platform already built for MQR's Diff Viewer,
  reused, not reinvented.
- **Knowledge (07)**: a failed inspection is a first-class Knowledge
  observation input — "this symptom showed up at Dealer PDI on N
  machines of this model" is exactly the kind of pattern Knowledge is
  meant to surface.
- **Engineering Intelligence (08)**: "Inspection Recommendation" (suggest which
  checklist items are highest-risk for this model/symptom combination)
  is a named AI capability that depends entirely on Inspection data
  existing in structured form first.

## Explicitly not decided here

- Whether `PRE_DELIVERY_INSPECTION` is the same concept as `DEALER_PDI`
  or genuinely distinct — flagged above, not guessed.
- Whether checklist templates are configurable per dealer/product family
  or fixed platform-wide — a real product decision, out of scope for an
  architecture-only PR.
