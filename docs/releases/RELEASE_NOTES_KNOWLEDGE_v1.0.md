# Release Notes — Knowledge Platform v1.0

PR #42 (`feature/engineering-knowledge-platform`), squash-merged to
`main` 2026-07-13 (merge SHA `ad34708`), the final Foundation capability
before AI. See `docs/releases/KNOWLEDGE_FOUNDATION_FREEZE_v1.0.md` for
what's frozen and the process to reopen any of it.

## Architecture

- **Knowledge established as an independent business domain** — not
  owned by Quality, PM, Warranty, or Machine. Aggregates Evidence from
  every domain; consumed, never owned, by every other module (ADR-018,
  refining, not replacing, the frozen Architecture Blueprint's
  `07-KNOWLEDGE-DOMAIN-AND-GRAPH.md`).
- **One aggregate, one repository, one owner** — a single
  `knowledge_cases` table (case + its lifecycle state), a single child
  `knowledge_evidence` table, both behind one `KnowledgeRepository`/
  `KnowledgeService` boundary. "Knowledge Candidate" and "Knowledge
  Case" are UI names for the same row's maturity bucket, not two tables
  or a promotion/copy workflow — explicitly rejected as an alternative
  during design (see ADR-018's Alternatives Considered).
- **Zero new shared infrastructure** — Knowledge reuses the existing
  Attachment Platform (evidence/case-level attachments), the existing
  `record_audit_log`/`<ActivityTimeline>` (module `'knowledge'` added to
  the closed `AuditModule` union), and the existing `next_job_seq()`
  case-reference numbering RPC (a deliberate, documented deviation: a
  single global `'KNOW:GLOBAL'` bucket rather than the platform's usual
  per-dealer bucket, since Knowledge is platform-shared, not
  dealer-scoped).

## Data model

- `knowledge_cases` — symptom, affected system, product-family/model
  context (never a direct machine/serial FK — a case generalizes across
  machines, it never keys off one), possible causes, validated fix,
  verification steps, confidence, maturity, `superseded_by_case_id`.
- `knowledge_evidence` — 8 source types (Quality/PM/Warranty/Machine/
  Dealer/Customer/Engineer/IoT — IoT reserved, no producer yet), one row
  per observation, append-only (no update/delete path), each recording
  Source/Author/Date/Confidence/Attachments. `machine_serial` is
  denormalized directly onto the evidence row so Related Machines and
  the Machine Passport's reverse lookup work with zero join back through
  MQR/PM/NTR.
- Both tables: permissive RLS + mandatory application-layer `applyScope()`
  filtering, the same model as every other platform-shared reference
  table (`docs/standards/SECURITY_STANDARD.md`).

## Confidence and Lifecycle

- **Confidence** — five discrete, manual-only levels (`VeryLow`/`Low`/
  `Medium`/`High`/`Verified`). AI must never assign this — enforced by
  there being no AI write path anywhere in the codebase, not just by
  convention.
- **Lifecycle (Maturity)** — five stages (`Draft`/`Review`/`Published`/
  `Deprecated`/`Archived`), one transition graph
  (`KNOWLEDGE_MATURITY_TRANSITIONS`), with the trust-conferring
  transitions (into `Published`/`Deprecated`/`Archived`) gated by a new
  `canReviewKnowledge` predicate (`lib/scope.ts`, the same
  cross-dealer/system-wide boundary as `canManageEmailHealth`/PM Record
  unlock — no new authorization model invented).
- Confidence and Maturity are independent axes, verified as two separate
  columns, neither derived from the other.

## Screens and API

- `/quality/knowledge` (list) — maturity/search/product-family filters,
  `MaturityPill`/`ConfidencePill` (composed from the existing generic
  `StatusPill`).
- `/quality/knowledge/new` (create) — symptom, affected system, product
  family/model, initial possible causes → Draft.
- `/quality/knowledge/[id]` (detail) — full Screen Contract: case fields,
  Evidence list + Add Evidence form, Maturity control (role-gated),
  `<ActivityTimeline>`, Related Machines/Quality Reports/PM/Warranty
  (all derived from Evidence rows, never a raw FK on the case), Related
  Documents (case-level attachments), and the reserved Future AI panel.
- `GET/POST /api/knowledge-cases`, `GET/PATCH /api/knowledge-cases/[id]`,
  `PATCH /api/knowledge-cases/[id]/maturity`, `POST /api/knowledge-cases/
  [id]/evidence` — all four routes call `KnowledgeService` only; none
  queries Supabase directly.

## Machine Integration

- `MachineService.getMachineKnowledgeSummary(serial)` → one new,
  thin-facade method → `KnowledgeService.getKnowledgeForMachine(serial)`
  → **Published cases only** (a technician-facing "Known Issue" must be
  validated, never a raw Draft candidate) — read-only, one-directional;
  Machine never writes to Knowledge, and `src/features/knowledge/` has
  zero imports from `src/features/machine/`.
- `MachineKnowledgeSection`/`MachineKnowledgePanel` on the Machine
  Digital Passport now render real Knowledge Cases touching that
  machine; the AI Recommendation/Prediction/Knowledge Score tiles remain
  exactly as they were (Coming Soon `EmptyState`).

## Reserved AI surface (not implemented)

Four Coming Soon tiles on the Knowledge Case detail page (AI Summary/
Recommendation/Root Cause/Similar Cases), each captioned with the one
binding rule that must hold whenever they are ever implemented: **AI
must always cite Evidence.** No model is selected, no vendor is chosen,
no scoring algorithm exists — this release builds the foundation AI will
consume, not AI itself. See `docs/releases/
KNOWLEDGE_FOUNDATION_FREEZE_v1.0.md`'s AI Contract for the permanent
rules this reserved surface (and every future AI capability built on
Knowledge) must satisfy.

## Documentation

- `docs/adr/ADR-018-Knowledge-Model.md` — the decision record, including
  the explicit reconciliation between this build's own vocabulary
  (Knowledge Candidate/Case, 5-stage Maturity, discrete Confidence) and
  the frozen Blueprint ch.07's original proposed model (approved with
  the user before any code was written).
- `docs/architecture/KNOWLEDGE_PLATFORM.md` — the living implementation
  doc: domain model, lifecycle, evidence model, confidence model, screen
  contracts, governance, machine integration, architecture notes,
  production readiness.
- `docs/architecture/blueprint/07-KNOWLEDGE-DOMAIN-AND-GRAPH.md` —
  amendment note added at the top pointing to ADR-018 for the superseded
  stage names/confidence representation; original content preserved.
- `docs/standards/TERMINOLOGY_STANDARD.md`, `docs/governance/
  MODULE_MATURITY_MATRIX.md`, `docs/governance/CAPABILITY_MAP.md` —
  Knowledge domain-ownership wording corrected (a pre-existing "Quality
  owns Knowledge" drift, predating this epic, found and fixed during
  final architecture review — see below).
- `docs/releases/KNOWLEDGE_FOUNDATION_FREEZE_v1.0.md` (new, this
  release) — declares Knowledge Domain, Evidence Model, Knowledge
  Lifecycle, Confidence Model, Machine Integration Contract, Knowledge
  Ownership, and the AI Integration Contract frozen.

## Corrections made during review (not silently fixed)

- **Domain-ownership wording drift**: multiple documents (predating this
  epic) stated "Quality owns... Knowledge," directly contradicting this
  epic's own Vision ("Knowledge is NOT owned by Quality/PM/Warranty/
  Machine") and, in one case, self-contradicting the newly-written
  `KNOWLEDGE_PLATFORM.md`'s own §1. Found and corrected across six
  locations during the PR's Final Architecture Review, re-verified
  green (typecheck/lint/tests/build/architecture check unchanged) since
  the fix was documentation/comment-only.
- **Merge-forward reconciliation** (finalizing this PR): this branch
  predates the Platform Constitution (PR #44), the Architecture
  Standards rename (PR #44), and the Navigation Visibility Policy/
  Capability Status Model (PR #43). Merged forward with `main` before
  this release was finalized; two `navConfig.test.ts` assertions written
  before the Capability Status model existed were updated to reflect
  that Knowledge (now `ACTIVE`, a real route) is correctly visible to
  every role, unlike the still-`COMING_SOON` Analytics/Troubleshooting
  entries next to it.

## Verification

Typecheck clean, lint clean (0 errors, 12 pre-existing warnings),
705/705 tests pass, build succeeds (including `/quality/knowledge`,
`/quality/knowledge/[id]`, `/quality/knowledge/new`), architecture check
5/5 PASS.

## Explicitly deferred (named, not silently dropped)

AI Summary/Recommendation/Root Cause/Similar Cases implementation;
Knowledge Score computation; the matching/clustering algorithm behind a
future `findSimilarCases` (ch.07 defers this to Engineering
Intelligence); bulk actions/export on the Knowledge list; hard-delete UI
for a Knowledge Case; IoT evidence ingestion (schema reserves the value
only, no producer).
