# 20 — Architecture Governance

This blueprint has been under active revision (v1.0 → v1.1) throughout
its own review. This document defines the process that governs it
**after** it is accepted — so the next change to a domain boundary goes
through a named process instead of an ad hoc edit, the same way this
repo already governs its frozen infrastructure layers
(`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation Freeze +
Architecture Evolution Rule). This document generalizes that existing,
proven discipline from "the frozen platforms" to "the whole accepted
Blueprint."

## Architecture Baseline

Once this blueprint is accepted (its README marked `APPROVED`), the
**Architecture Baseline** is: this directory (`docs/architecture/
blueprint/`, README + 01–20) as it stands at the commit where approval
was recorded. The Baseline is a snapshot, not a living document that
silently drifts — any change to it afterward is either:

- A **documentation correction** (typo, broken cross-reference, a
  "Today" column update because shipped code caught up to a "Target") —
  no process required, just a normal docs PR.
- A **Baseline change** (anything that alters a domain boundary, an
  aggregate root, an event's ownership, a governance rule itself) —
  requires the ADR Process below before the Baseline document changes.

## Architecture Freeze

Once the Baseline is set, its core decisions are **frozen** in the same
sense `PLATFORM_ARCHITECTURE_STANDARDS.md` already freezes Storage/Authentication/
DealerBranchScope/Attachment: not "no further work happens" (13's Roadmap
continues) but "these specific decisions are not casually redesigned."
Frozen, specifically:

- Machine as the platform's aggregate root (02, 10)
- The bounded context list and their ownership boundaries (02, 17)
- The `PlatformEvent` envelope and the Canonical Event Catalog's event
  ownership (06, 18)
- Engineering Intelligence's AI Governance boundary (08) and the AI
  Confidence Policy's meaning (never authorization)
- The Integration Boundary rule (19) — no external system reads internal
  tables directly

Everything else in this blueprint (specific field names, exact table
shapes, capability-to-module mappings in 17) remains a normal design
detail, refined freely during implementation without triggering this
process — only the five items above are frozen.

## ADR Process

Matches this repo's own already-proven pattern (ADR-009, ADR-014):

1. **Propose** — write context, decision, and consequences, in the same
   format as existing ADRs under `docs/adr/`.
2. **Ground it in the Baseline** — cite which blueprint section(s) it
   extends or changes, same as this blueprint itself grounded every
   section in ADR-009/the Activity Timeline platform rather than
   inventing from a blank slate.
3. **Architecture Review** (below).
4. **Architecture Approval** (below).
5. **Merge** — the ADR is committed under `docs/adr/`, and if it changes
   a frozen item, the Baseline documents in this directory are updated in
   the same change to stay in sync — an ADR and a stale Baseline
   disagreeing is itself a defect, not an acceptable gap.

16's seven recommended ADRs (ADR-015 through ADR-021) are the first
concrete queue this process applies to, once each one's corresponding
phase (13) is actually approved to start — not before.

## Breaking Change Process

A **Breaking Change** is any change to one of the five frozen items
above — e.g., redefining Machine's aggregate boundary, reassigning an
event's owning module, or loosening the AI Governance boundary. A
breaking change always requires the full ADR Process; it is never made
as a routine PR, regardless of how small the code diff looks. An
**additive change** (new event type, new capability in 17, new bounded
context that doesn't touch an existing one's boundary) does not require
the full process — it still gets its own ADR for the record (per 16's
guidance), but does not need to reopen or re-litigate the Baseline.

This mirrors 11's Database Evolution Strategy rules (additive-only,
never rename) applied one level up, from schema changes to architecture
decisions themselves.

## Architecture Review

Before any ADR proposing a Breaking Change is approved, it is reviewed
against:

1. **01's Engineering Principles** (the six questions every feature must
   answer) — does the proposed change still let every future feature
   answer them?
2. **20's own Architecture Freeze list** — does the change actually touch
   a frozen item, or was it miscategorized as breaking when it's really
   additive (in which case the lighter ADR-only path applies instead)?
3. **14's Risks & Technical Debt** — does the change resolve a listed
   risk/debt item, introduce a new one, or leave an existing one
   unaffected? The review should say which, explicitly.

This is a review *of the ADR*, not a separate committee process — for a
platform this size (a handful of dealer accounts, per Authentication
Platform v3.0's own documented scale assumption), the reviewer is
whoever holds Architecture Approval below; over-formalizing this for a
small team would itself violate 01 Principle 9.

## Architecture Approval

Final authority to approve a Breaking Change ADR rests with whoever owns
this repository's architecture decisions today (the project owner/senior
engineering role that already approves every git action requiring
explicit authorization per `.claude/rules/git.md`) — this document does
not invent a new role or committee; it ties Architecture Approval to the
same explicit-approval discipline already binding on every other
consequential action in this repository. An approval is recorded as an
explicit sign-off on the ADR itself (a merged PR approval, matching how
every ADR in this repo already gets merged), not implied by silence.

## What this document deliberately does not do

- It does not name a person, title, or team — this repository has no
  fixed org chart to encode, and inventing one here would be exactly the
  kind of speculative structure 01 Principle 9 warns against.
- It does not define a cadence (quarterly review, etc.) — reviews happen
  when an ADR is proposed, not on a calendar this blueprint would have to
  guess at.
