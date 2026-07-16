# Change Management

## Relationship to existing documents

`docs/architecture/blueprint/20-ARCHITECTURE-GOVERNANCE.md` (frozen)
already fully owns the **architecture** change process: Architecture
Baseline, the Architecture Freeze (5 items), the ADR Process (Propose →
Ground in Baseline → Architecture Review → Architecture Approval →
Merge), the Breaking Change Process (any Freeze-item change = full ADR
process; an additive change gets its own ADR "for the record" but not
the full ceremony), and Architecture Approval ("rests with whoever owns
this repository's architecture decisions today... this document does not
invent a new role or committee").

`docs/standards/GIT_BRANCH_STANDARD.md` (binding) already owns the
**mechanical** process: branch naming, commit discipline, SemVer release
-version meaning, tag/release approval (human/explicit-approval only,
never AI-initiated), and the 8-step ordered quality-gate list a PR must
pass (typecheck → lint → build → tests → security review → localization
review → dealer-scope review → smoke test, no waivers).

**This document does not restate either.** It exists to cover two things
neither owns: **data migration governance** and **deprecation
timelines** for non-architecture changes (a master-data value going
stale, an admin screen being replaced, a report being retired).

## Breaking Change Process

Cited from 20, not restated: a Breaking Change is any change to one of
the 5 Freeze items (Machine as aggregate root; bounded context list;
`PlatformEvent` envelope + Canonical Event Catalog ownership; Engineering
Intelligence's AI Governance boundary + Confidence Policy; the
Integration Boundary rule). Always the full ADR process. See
`DECISION_MATRIX.md` for how a proposed change is classified before it
reaches this process.

## Architecture Review

Cited from 20, not restated: checked against 01's six Engineering
Principles questions (What Machine is involved? What Event is created?
What Knowledge is created? How will AI use it? How will Timeline display
it? How will Analytics consume it?), 20's own Freeze list, and 14's Risks
& Technical Debt.

## ADR Required

Cited from 20 and `DOCUMENTATION_POLICY.md`: any Breaking Change, always;
an additive change, "for the record" per 20 - and per
`DOCUMENTATION_POLICY.md`'s numbering rule, check `docs/adr/` and 16's
reserved range before assigning a number.

## Migration (new - data migration governance)

Neither 20 nor `GIT_BRANCH_STANDARD.md` addresses **data** migration
governance (schema migrations are covered mechanically by
`docs/standards/DATABASE_STANDARD.md` - naming, sequencing, avoid
destructive migrations without a rollback path - cited, not restated
here). This document adds the **decision** layer: who approves a data
migration that changes the *meaning* of existing data, not just its
schema (e.g. reinterpreting a legacy `job_id` format, backfilling a new
required field for existing rows).

1. A schema-only migration (new column, new table, additive) is
   domain-local per `DECISION_MATRIX.md` - the owning module's own
   review.
2. A migration that changes the meaning of existing data, or that could
   produce a different answer for a historical record than it would have
   produced when that record was created, is cross-cutting - it affects
   every consumer of that data (Reports, Knowledge extraction, Timeline
   display) and should go through Architecture Review even if it touches
   no Freeze item, because its blast radius is genuinely platform-wide.
3. Every data migration ships with a rollback plan stated in its own PR
   description, per `DATABASE_STANDARD.md`'s existing "avoid destructive
   migrations without a rollback path" rule - this document adds that the
   rollback plan is reviewed with the same weight as the migration itself,
   not treated as an afterthought.

## Deprecation (new - non-API deprecation)

`API_GOVERNANCE.md` covers API-route deprecation specifically. This
section covers everything else: a master-data value, an admin screen, a
report, a whole module.

1. **Announce** - the replacement exists and works before the old thing
   is marked deprecated (never deprecate-then-build).
2. **Coexist** - both the old and new thing work simultaneously for a
   stated period, recorded in the relevant ADR or `docs/ROADMAP.md`
   entry - no fixed universal timeframe is mandated (this platform's
   traffic/change patterns don't justify inventing one speculatively,
   consistent with the Architecture Evolution Rule's "don't build
   infrastructure just in case").
3. **Confirm** - before removal, confirm no known caller/consumer still
   depends on the old thing (the same confirmation `API_GOVERNANCE.md`
   requires for route removal, generalized here).
4. **Remove** - and record the removal in the same ADR/roadmap entry that
   announced the deprecation, closing the loop.

## Versioning

- **Application/release versioning**: `GIT_BRANCH_STANDARD.md`'s SemVer
  table (v1.0.0 → v3.0.0 meaning) - cited, not restated.
- **API versioning**: `API_STANDARD.md`'s explicit no-versioning-today
  choice - cited, not restated.
- **Event versioning**: `EVENT_OWNERSHIP.md`'s proposed rule (name/
  ownership frozen; metadata shape additive-only) - cited, not restated.
- **Import Profile versioning**: `ImportContract.templateVersion`
  (ADR-022, proposed) - cited, not restated.
- **Design Framework versioning**: this repository's convention so far
  has been one version number per framework (MSEAL Design Framework
  v1.0, this Platform Governance Framework v1.0) bumped when the
  framework itself is materially revised, not per document inside it -
  keep following this, don't version-number individual files within a
  framework independently.

## Gap Analysis

- Data migration governance and deprecation timelines above are new,
  untested rules - no real migration has yet gone through the
  cross-cutting-review path described in §Migration item 2; revisit once
  one does.
- No universal deprecation timeframe is set intentionally (see
  §Deprecation item 2's reasoning) - if this becomes a recurring point of
  disagreement in practice, that itself would be the evidence needed to
  set one, per the Evolution Rule's own "only when a real business
  requirement makes it in-scope" test.
