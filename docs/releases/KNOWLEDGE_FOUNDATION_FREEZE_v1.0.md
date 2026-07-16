# Knowledge Foundation Freeze v1.0

**Status: EFFECTIVE.** PR #42 (`feature/engineering-knowledge-platform`)
squash-merged to `main` 2026-07-13 (merge SHA `ad34708`), verified in
Production. This is the final
Foundation capability before AI — Knowledge becomes the permanent
engineering knowledge foundation every future AI capability consumes.
No AI is implemented by this freeze; it freezes the foundation AI will
be built on top of.

This document extends `docs/releases/FOUNDATION_FREEZE_v1.1.md` the same
way that document extended v1.0 — additively, not a replacement. Every
layer frozen by v1.0/v1.1 remains frozen, unchanged, under the same
reopening process. Nothing here revisits the Platform Constitution or
Architecture Blueprint; this document operationalizes what they already
say about Knowledge.

## Relationship to existing documents (read before anything else)

Reviewed before writing this document: `docs/architecture/
PLATFORM_CONSTITUTION.md` (Domain Principles' "Knowledge is an
independent business domain," Knowledge Principles, AI Principles),
`docs/releases/FOUNDATION_FREEZE_v1.1.md`, `docs/architecture/blueprint/
07-KNOWLEDGE-DOMAIN-AND-GRAPH.md` ("ch.07," frozen Architecture
Baseline), `docs/adr/ADR-018-Knowledge-Model.md`, `docs/architecture/
KNOWLEDGE_PLATFORM.md`, and `docs/standards/TERMINOLOGY_STANDARD.md`'s
Domain ownership section. No new contradiction was found between them —
this freeze formalizes what they already, consistently, say.

**One pre-existing gap closed as part of finalizing this PR, not a new
decision**: `feature/engineering-knowledge-platform` was branched before
`docs/architecture/PLATFORM_CONSTITUTION.md` existed as the true
Constitution and before `docs/architecture/PLATFORM_ARCHITECTURE_
STANDARDS.md` was renamed from it (PR #44), and before the Navigation
Visibility Policy/Capability Status Model existed (PR #43). This branch
was merged forward with `main` before this freeze was written, so every
claim below is verified against the *current* Constitution/Foundation
Freeze v1.1/Architecture Standards, not the state at the time PR #42 was
originally opened.

## Final architecture review (performed before this freeze)

Verified directly against the merged code, not assumed from prior
review:

| Claim | Status | Evidence |
|---|---|---|
| Knowledge owns Knowledge | **Confirmed** | Only `src/features/knowledge/repository.ts` queries `knowledge_cases`/`knowledge_evidence` — 9 call sites, zero matches anywhere else in the repo |
| Machine consumes Knowledge | **Confirmed** | `MachineService.getMachineKnowledgeSummary()` calls `KnowledgeService.getKnowledgeForMachine()` only; `src/features/knowledge/` has zero imports from `src/features/machine/` |
| Quality owns Troubleshooting | **Confirmed** | Exactly one `nav.troubleshooting` entry in `navConfig.ts`, under the `quality` group, Coming Soon (`href: null`); no entry under `engineering-intelligence` |
| Engineering Intelligence consumes Knowledge | **Confirmed by contract, not yet built** | `docs/governance/CAPABILITY_MAP.md`/`TERMINOLOGY_STANDARD.md` both state EI "consumes Knowledge via `KnowledgeService`, never owns a second copy"; EI itself remains Coming Soon, so there is no live consumer yet — the contract is frozen, the implementation is future work |
| AI consumes Knowledge | **Confirmed as reserved contract** | `KnowledgeFutureAiPanel.tsx`'s four Coming Soon tiles are the only AI-facing surface; each is captioned "Any future AI output here must cite Evidence - never a standalone claim" (`en.json`/`th.json`, key `knowledge.aiReservedNextStep`) |
| Evidence is the only Source of Truth | **Confirmed** | `docs/architecture/KNOWLEDGE_PLATFORM.md` §1: "Evidence is always the Source of Truth - a Knowledge Case's `possible_causes`/`validated_fix`/`confidence` are engineering *conclusions*; the Evidence rows are the record of *why*." Evidence rows are soft-delete only, never hard-deleted when a conclusion changes |

**One Aggregate, One Owner, no duplication** — all confirmed:

- **One Aggregate**: single `knowledge_cases` table; no `knowledge_candidates`
  table, type, or repository exists anywhere in the codebase (grepped,
  zero matches beyond a UI form component name and ADR-018's own
  documentation of this as a *rejected* alternative). "Candidate" and
  "Case" are UI names for the `Draft`/`Review` vs. `Published`/
  `Deprecated`/`Archived` maturity buckets of the same row, not two
  entities.
- **One Owner**: `KnowledgeRepository`/`KnowledgeService` are the only
  writers of `knowledge_cases`/`knowledge_evidence`; every API route
  under `src/app/api/knowledge-cases/` calls into `KnowledgeService`,
  none queries Supabase directly.
- **No duplicated lifecycle**: `updateMaturity` performs an `UPDATE` on
  the existing row; there is no promotion/copy step anywhere.
- **No duplicated repositories**: one `KnowledgeRepository` for both
  `knowledge_cases` and `knowledge_evidence` (one aggregate, one
  repository boundary, per the Platform Constitution's Domain
  Principles).
- **No duplicated APIs**: four routes under `/api/knowledge-cases/`
  (list/create, detail/edit, evidence, maturity), each a thin layer over
  `KnowledgeService` — no second API surface exists.
- **No duplicated timeline**: Knowledge writes through the existing
  `record_audit_log` table (`AuditModule` now includes `'knowledge'`)
  and renders via the one existing `<ActivityTimeline>` component —
  zero new timeline infrastructure.

## Knowledge verification (Case / Evidence / Confidence / Lifecycle / Machine Integration / Timeline / Future AI)

Each verified consistent with the Platform Constitution, Foundation
Freeze v1.1, Architecture Blueprint ch.07, ADR-018, and the Terminology
Standard:

- **Knowledge Case** — the single aggregate root (`knowledge_cases`
  table). Fields: `symptom`, `affected_system`, `product_family_id`/
  `model` (machine-family context, never a direct machine/serial FK —
  ch.07's rule that a case generalizes across machines, never keys off
  one), `possible_causes`, `validated_fix`, `verification_steps`,
  `confidence`, `maturity`, `superseded_by_case_id`.
- **Evidence** — child rows (`knowledge_evidence`), 8 source types
  (Quality/PM/Warranty/Machine/Dealer/Customer/Engineer/IoT — IoT
  reserved, no producer yet), append-only (no update/delete method
  exists), each recording Source/Author/Date/Confidence/Attachments.
  `machine_serial` is denormalized directly onto the evidence row so
  "Related Machines" and the Machine Passport's reverse lookup work
  without ever giving the Case itself a foreign key to one module's
  table.
- **Confidence** — five discrete levels (`VeryLow`/`Low`/`Medium`/
  `High`/`Verified`), manual only, never AI-assigned, independent of
  Maturity.
- **Lifecycle (Maturity)** — five stages (`Draft`/`Review`/`Published`/
  `Deprecated`/`Archived`), a single transition graph
  (`KNOWLEDGE_MATURITY_TRANSITIONS`), gated by `canReviewKnowledge`
  (`seesAllDealers` boundary) for the trust-conferring transitions into
  `Published`/`Deprecated`/`Archived`. "Superseded" (ch.07's lifecycle
  wording) maps onto `maturity = 'Deprecated'` plus
  `superseded_by_case_id` for traceability — one concept, not two
  fields.
- **Machine Integration** — read-only, one-directional
  (`MachineService.getMachineKnowledgeSummary()` →
  `KnowledgeService.getKnowledgeForMachine()`), Published cases only (a
  technician-facing "Known Issue" must be validated, never a raw Draft
  candidate).
- **Activity Timeline** — reused, not duplicated (see architecture
  review table above).
- **Future AI placeholders** — `KnowledgeFutureAiPanel`'s four Coming
  Soon tiles (AI Summary/Recommendation/Root Cause/Similar Cases), each
  explicitly captioned with the citation requirement; zero AI
  implementation exists in this PR.

## What is frozen by this document

Effective now that PR #42 has merged, the following become part of the
platform's frozen Foundation, under the identical ADR + Architecture
Review + Architecture Approval reopening process every other Foundation
layer already uses:

| Layer | Frozen content | Governing document |
|---|---|---|
| Knowledge Domain | Independent bounded context; owns `knowledge_cases`/`knowledge_evidence`; consumed, never owned, by Quality/PM/Warranty/Machine/Engineering Intelligence | `docs/architecture/KNOWLEDGE_PLATFORM.md` §1, ADR-018 |
| Evidence Model | 8 source types, append-only, Source/Author/Date/Confidence/Attachments on every item; Evidence is the only Source of Truth | `docs/architecture/KNOWLEDGE_PLATFORM.md` §4 |
| Knowledge Lifecycle | 5-stage Maturity (`Draft`/`Review`/`Published`/`Deprecated`/`Archived`), one transition graph, `canReviewKnowledge`-gated trust transitions | `docs/architecture/KNOWLEDGE_PLATFORM.md` §3, `src/features/knowledge/types.ts` |
| Confidence Model | 5 discrete levels, manual-only, independent of Maturity | `docs/architecture/KNOWLEDGE_PLATFORM.md` §5 |
| Machine Integration Contract | Read-only, Published-only, via `KnowledgeService` only — Machine never owns or writes Knowledge | `docs/architecture/KNOWLEDGE_PLATFORM.md` §8 |
| Knowledge Ownership | One aggregate, one repository, one owner (`KnowledgeRepository`/`KnowledgeService`); nav placement under Quality is UX-only, never ownership | `docs/architecture/PLATFORM_CONSTITUTION.md` Domain Principles, `docs/governance/DOMAIN_OWNERSHIP_MATRIX.md` |
| AI Integration Contract | See "AI Contract," below | `docs/architecture/PLATFORM_CONSTITUTION.md` AI Principles, this document |

**Future AI capabilities may extend Knowledge, but must not violate its
frozen architecture.** Extension means: adding a new Evidence source
type, adding a new Future-AI-panel implementation that reads Knowledge
through `KnowledgeService` and cites Evidence, or adding a new consumer
(Engineering Intelligence) that reads Knowledge the same read-only way
Machine does. It never means: a second Knowledge table, a write path
into `knowledge_cases`/`knowledge_evidence` that bypasses
`KnowledgeService`, an AI-assigned Confidence or Maturity value, or an
AI output presented without a citation back to specific Evidence/
Knowledge records.

## AI Contract (permanent rules)

Restated from the Platform Constitution's AI Principles, as the binding
contract every future AI capability built on Knowledge must satisfy —
these do not change without a Constitutional Amendment (Architecture
Review + Governance Review + Explicit human approval), never a routine
PR:

1. **AI never owns Knowledge.** `KnowledgeRepository`/`KnowledgeService`
   remain the only writers of `knowledge_cases`/`knowledge_evidence`,
   permanently. An AI capability does not get its own write path.
2. **AI never becomes the Source of Truth.** Evidence remains the only
   Source of Truth (Knowledge Principles). AI consumes Knowledge; AI
   never produces the Knowledge or Evidence records other systems then
   treat as ground truth.
3. **AI always cites Evidence.** Every AI-produced output resolves back
   to the specific Evidence and Knowledge records that produced it, on
   demand — never a bare score or an uncited claim.
4. **AI consumes Knowledge** — through `KnowledgeService`'s public
   interface only, the same platform-service boundary every other
   consumer (Machine) already uses. No AI capability queries
   `knowledge_cases`/`knowledge_evidence` directly.
5. **AI never consumes raw MQR directly.** Quality/PM/Warranty data
   reaches AI only after it has been captured as Knowledge Evidence -
   the same "Open Host Service" rule ch.07 already established for
   Engineering Intelligence, extended explicitly to AI.
6. **AI never bypasses Knowledge.** There is no shortcut path from a
   future AI capability to raw domain tables "for efficiency" or "for a
   first version" - going through Knowledge is not a temporary
   convention, it is the permanent architecture.

## What reopening requires

Identical to every other Foundation layer's reopening process
(`docs/releases/FOUNDATION_FREEZE_v1.1.md`): an ADR, Architecture Review
against the Platform Constitution's Knowledge/AI Principles and
Blueprint ch.07, Architecture Approval, and Merge. A future AI capability
that needs to *extend* Knowledge (a new Evidence source type, a new
read-only consumer) does not require reopening this freeze - it is
already anticipated and in-scope. A future capability that needs to
*violate* one of the six AI Contract rules above requires the heavier
process, the same weight given to any other frozen-layer conflict.

## Next Epic

With this freeze declared, **AI Troubleshooting** becomes the
recommended next epic — see `docs/ROADMAP.md`'s updated Future Epics
chain. Not started; this document only recommends it, per this freeze's
own scope.
