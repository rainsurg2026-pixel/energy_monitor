# AI Engineering Playbook

## Relationship to existing documents

This is a **new, cross-cutting operational document**, not a content
layer competing with the Platform Constitution, Architecture Blueprint,
Architecture Standards, or ADRs (`docs/governance/
DOCUMENTATION_HIERARCHY.md`'s "Where Governance Framework and Standards
fit" section - this Playbook sits at the same altitude as
`DOCUMENTATION_POLICY.md`/`DECISION_MATRIX.md`: process/operating
guidance that wraps around the content layers, never overrides one).
It does not restate the Constitution's principles, the Business
Invariants' verdicts, or any ADR's decision - it is the **reading order
and PR checklist** an AI engineering session follows before touching
this repository, distilled to one page. Where this document and the
one it points to disagree, the pointed-to document always wins - this
is an index, not a source of truth.

**Grounding note (checked against the actual repo, not assumed)**: two
of this Playbook's reading-list entries needed resolving against a real
path rather than a literal filename:

- **"ARCHITECTURE.md"** does not mean `docs/ARCHITECTURE.md` - that file
  is a Sprint-1-era document describing a single-module MQR world and an
  aspirational `modules/`/`shared/`/`templates/` folder layout that was
  never adopted (confirmed: `modules/` still holds scaffolding only,
  `.claude/CLAUDE.md`'s own "Sprint 1 status" section says so). Citing
  it as "the architecture" today would be exactly the kind of
  documentation drift this platform has spent several recent milestones
  closing. The current, living architecture reference is
  `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` (renamed from
  "MASP Platform Constitution," Platform Constitution v1.0 - see
  `DOCUMENTATION_HIERARCHY.md`), one layer below the Architecture
  Blueprint and the Platform Constitution itself. This Playbook's
  Architecture reading list points there, not to `docs/ARCHITECTURE.md`.
- **"MACHINE_LIFECYCLE.md"** exists twice, deliberately, at different
  altitudes: `docs/architecture/MACHINE_LIFECYCLE.md` documents the nine
  Machine Passport UI badges; `docs/business/MACHINE_LIFECYCLE.md`
  documents the business-level state machine (Factory → Imported → ... →
  Retired) with transition triggers/roles/validation rules. Modifying
  business logic needs the latter - this Playbook's Business reading
  list points there explicitly, and both files cross-reference each
  other so the name collision doesn't read as an accidental duplicate.

---

## Mission

Build business value.

Business Workflow always comes before Technical Design.

---

## Platform Philosophy

The platform models one complete Machine Lifecycle.

Never build isolated modules.

**Grounded in this repository**: the lifecycle is Factory → Tractor IN →
Import Inspection → MSEAL Stock (Future) → Ship to Dealer (Future) →
Dealer Stock (Future) → New Tractor Delivery (NTR) → Warranty Activated
→ Machine Passport (Vehicle 360) → Preventive Maintenance → Machine
Problem → MQR → Repair → MQR Closed → (Future) Troubleshooting →
Knowledge Base → Product Improvement (`docs/business/
MACHINE_LIFECYCLE.md`). Every domain module (NTR, PM, MQR, Knowledge,
Import Inspection) is a stage in this one lifecycle, reading and writing
through the single Vehicle Master (`vehicles`) - never a parallel
per-module copy of machine identity.

---

## Architecture

Read

- `docs/architecture/PLATFORM_CONSTITUTION.md`
- `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` (see Grounding
  note above - this is what "ARCHITECTURE.md" means in this repo)
- `docs/adr/README.md` (the ADR Index)
- `docs/architecture/PROJECT_STATE.md`

before implementation.

---

## Business

Read

- `docs/architecture/BUSINESS_INVARIANTS.md`
- `docs/business/MACHINE_LIFECYCLE.md` (see Grounding note above - not
  `docs/architecture/MACHINE_LIFECYCLE.md`, a different document)
- `docs/business/FIELD_OWNERSHIP_MATRIX.md`
- `docs/business/WRITE_PRECEDENCE_MATRIX.md`

before modifying business logic.

---

## Production Pilot

Allowed

- Bug
- UX
- Performance
- Reports

Not Allowed

- New Domain
- New Workflow
- Breaking Changes

**Currently blocked under this rule, named so nobody rediscovers them as
a "just a small addition"**: MSEAL Stock/Ship to Dealer/Dealer Stock
(ADR-035 R-1, still an open business decision, not an engineering one),
the Troubleshooting workflow, MQR NTR auto-fill, machine-type
classification, and the Constitutional Amendment elevating Business
Invariants into `PLATFORM_CONSTITUTION.md`. Each is a New Domain or New
Workflow under this Playbook's rule - each needs its own explicit
milestone and ADR before implementation starts, not a Bug/UX/Performance
PR quietly growing into one.

---

## Engineering Rules

Reuse

before Rewrite

Extension

before Duplication

One Entity

One Owner

One Source of Truth

---

## Before Every PR

Verify

- **Architecture** - `npm run architecture` (6-rule enforcement:
  business-module boundaries, no raw SDK imports, Attachment Platform
  exclusivity, StorageProviderFactory exclusivity, no circular
  dependency, no eager Repository/Service construction).
- **Business Rules** - re-check the change against `BUSINESS_
  INVARIANTS.md`'s Holds/Resolved verdicts and `FIELD_OWNERSHIP_
  MATRIX.md`'s who-may-write column before touching any of `vehicles`/
  `ntr_records`/`pm_records`/`records`.
- **Permissions** - every new/changed route re-checks its own
  `lib/scope.ts` predicate server-side; nav visibility is never
  authorization (`PLATFORM_CONSTITUTION.md`'s Navigation Principles).
- **Timeline** - if the change touches a record lifecycle, confirm
  `record_audit_log`/`logAuditEvent()` still fires and
  `<ActivityTimeline>` still renders it - never a parallel, module-local
  timeline.
- **Tests** - `vitest run`.
- **Build** - `tsc --noEmit`, `eslint .`, `next build`.
- **Documentation** - update only the specific doc(s) this change
  actually affects (Reuse before Rewrite applies to docs too); if a
  business rule or architecture decision changes, that is an ADR, not a
  silent doc edit (`DOCUMENTATION_HIERARCHY.md`, precedence rule 4).

---

## Deliverable

Open ONE PR

Never Merge

Stop after reporting.
