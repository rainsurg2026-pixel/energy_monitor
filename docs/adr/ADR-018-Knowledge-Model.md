# ADR-018: Engineering Knowledge Platform (Knowledge Model)

## Status

Accepted (PR #42, merged). See `docs/releases/KNOWLEDGE_FOUNDATION_FREEZE_v1.0.md`
for what this ADR's architecture froze on merge.

`ADR-018` is the number `docs/architecture/blueprint/16-ADR-RECOMMENDATIONS.md`
reserved for "Knowledge Model" - used here, not the next sequential
number, per `docs/standards/DOCUMENTATION_POLICY.md`'s numbering rule.

## Problem

Foundation Freeze v1.0 (`docs/releases/FOUNDATION_FREEZE_v1.0.md`) named
"Knowledge Engine v1.0" as the recommended next epic. Knowledge is not a
new bounded context - it is already named in the frozen Architecture
Baseline (`docs/architecture/blueprint/02-DOMAIN-MODEL-AND-CONTEXT-MAP.md`,
`17-BUSINESS-CAPABILITY-MAP.md`) with a full proposed model already
written in `07-KNOWLEDGE-DOMAIN-AND-GRAPH.md` ("ch.07"). That model
predates this build's specific brief, and the brief's own vocabulary
("Knowledge Candidate," "Knowledge Case," a 5-stage "Knowledge Maturity"
of Draft/Review/Published/Deprecated/Archived, discrete 5-level manual
Confidence) differs from ch.07's already-written model (one
`KnowledgeCase` entity, a 5-stage Maturity of Draft/Validated/Trusted/
Best Practice/Retired, continuous 0-1 Confidence "computed from
corroborating cases"). Per this repo's Documentation Hierarchy ("a frozen
item always wins over a non-frozen document that contradicts it... never
by silently picking one"), this is a real conflict that needed an
explicit decision, not a silent pick - it was raised with the user before
any schema or code was written.

## Decision

**Refine ch.07, don't replace it.** Resolved with the user as follows,
and implemented exactly this way:

| | ch.07 (before) | This ADR (after) |
|---|---|---|
| Storage | One `KnowledgeCase` entity | **Unchanged** - one `knowledge_cases` table, confirmed explicitly |
| "Candidate" vs "Case" | N/A | UI-only names for maturity buckets on the *same* row - never two tables, never a promotion/copy workflow |
| Maturity stage names | Draft → Validated → Trusted → Best Practice → Retired | **Superseded**: Draft → Review → Published → Deprecated → Archived (this build's own 5-stage list wins verbatim) |
| Confidence representation | Continuous `0-1`, "computed from corroborating cases + stakeholder feedback" | **Superseded**: discrete, manual-only levels - VeryLow/Low/Medium/High/Verified. Confidence = evidence quality; independent of maturity (workflow state) |
| Core ownership principles | Knowledge never keyed off one module/machine's table; Machine never owns Knowledge; only an Engineer moves confidence, never AI | **Unchanged** - carried forward exactly, still the binding rule |

ch.07's own "Knowledge Lifecycle" diagram (Machine Event → Observation →
Investigation → Repair → Outcome → Knowledge → AI Learning →
Recommendation → Engineer Feedback → Knowledge Improvement) is a
**process narrative**, not a persisted state machine - this build's own
"Knowledge Lifecycle" (Observed → Candidate → Engineering Review →
Validated → Published → Superseded → Archived) is treated the same way:
documented prose in `docs/architecture/KNOWLEDGE_PLATFORM.md` §3
explaining how a row moves through the one real `maturity` column, not a
second stored field. "Superseded" (lifecycle wording) maps onto
`maturity = 'Deprecated'` (the 5-stage field's own wording) plus a
`superseded_by_case_id` pointer for traceability.

Engineering Review is the `Review` → `Published` maturity transition,
gated by a new `canReviewKnowledge` predicate (`lib/scope.ts`) - the same
cross-dealer/system-wide boundary as `canManageEmailHealth`/PM Record
unlock, not a new authorization model.

## Data model

`knowledge_cases` (the one aggregate) + `knowledge_evidence` (child rows
- every "Related Machine/Quality Report/PM/Warranty" is derived from
evidence, never a raw FK on the case itself, honoring ch.07's central
rule: *"if a 'Knowledge' table ends up with a foreign key to `records.id`
... it has silently become MQR's knowledge, not the platform's"*). Full
schema, indexes, and RLS: `docs/architecture/KNOWLEDGE_PLATFORM.md` §2/§4.
Attachments and the audit Timeline reuse the existing, frozen Attachment
Platform and `record_audit_log` (module `'knowledge'`) - zero new
infrastructure beyond the two tables above.

## Consequences

- `docs/architecture/blueprint/07-KNOWLEDGE-DOMAIN-AND-GRAPH.md` gets a
  short amendment note pointing here for the superseded stage names/
  confidence representation - its original content is preserved
  (historical record), not rewritten, matching this repo's existing
  amendment style for a frozen Baseline chapter.
- `docs/governance/MODULE_MATURITY_MATRIX.md` and `CAPABILITY_MAP.md`'s
  "Design-only"/"not built" annotations for Knowledge are updated now
  that code exists.
- Engineering Intelligence continues to consume Knowledge only through
  `KnowledgeService`, never `knowledge_cases`/`knowledge_evidence`
  directly - unchanged from ch.07's "Open Host Service" rule; not built
  in this PR (Engineering Intelligence itself remains Coming Soon).
- AI Summary/Recommendation/Root Cause/Similar Cases are reserved,
  unimplemented UI slots only - "Build the engineering knowledge
  foundation that AI will consume," not AI itself.

## Alternatives considered

- **Build ch.07's model exactly as originally written** (continuous
  confidence, its own stage names) - rejected: doesn't use the vocabulary
  this build's own brief names explicitly, and the reconciliation is a
  refinement, not a rewrite, so nothing about ch.07's ownership
  principles needed to change to accommodate it.
- **Two physical tables** (`knowledge_candidates` + `knowledge_cases`,
  with a promotion/copy step at Engineering Review) - rejected by the
  user explicitly: doubles the schema/service/API surface for what is
  the same underlying record at a different workflow state, and a
  promotion/copy step is itself a duplicated-ownership risk (which
  table is authoritative once both exist for the same case?).
