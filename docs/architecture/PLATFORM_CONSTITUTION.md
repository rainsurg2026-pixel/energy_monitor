# MSEAL DMS Platform Constitution v1.0

## Status

**Effective 2026-07-13.** This is the governing document above ADRs, the
Design Framework, and individual capabilities - the highest-level
engineering and product principle for the MSEAL DMS platform.

**It is not an implementation guide, not an ADR, and not a coding
standard.** It states the permanent principles the platform's frozen
Architecture Blueprint, Architecture Standards, ADRs, and Design
Framework already put into practice - it does not restate their
implementation detail, only elevates the principles behind it into one
place a reader checks first. Where this document references another
document, that document remains the authoritative source for its own
detail; this Constitution never duplicates it.

## Relationship to existing documents (read this before anything else)

This Constitution was written after reading, not before: Foundation
Freeze v1.0 (`docs/releases/FOUNDATION_FREEZE_v1.0.md`), Architecture
Blueprint v1.1 (`docs/architecture/blueprint/`, chapters 01, 02, 07, 16,
17, 20 and the README), Platform Governance Framework v1.1
(`docs/governance/`), the MSEAL Design Framework
(`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`, ADR-023), the Navigation
Standard (part of the Design Framework, `.claude/skills/mseal-platform-
design/NAVIGATION_GUIDELINES.md`), the Terminology Standard
(`docs/standards/TERMINOLOGY_STANDARD.md`), the Engineering Knowledge
Platform (ADR-018, `docs/architecture/KNOWLEDGE_PLATFORM.md`), and the ADR
Index (`docs/adr/README.md`).

**A genuine naming conflict was found and resolved before this document
was written, not silently worked around**: `docs/architecture/
PLATFORM_CONSTITUTION.md` already existed under this exact filename, but
held implementation-level architecture rules (layer definitions,
dependency rules, platform-service boundaries, Storage/Auth/MasterData
freeze rules) - a different kind of document than the Vision/Mission/
Principles document this task asked for, and one that
`docs/governance/DOCUMENTATION_HIERARCHY.md` had ranked *below* the
Architecture Blueprint and ADRs, the opposite of where a true Constitution
belongs. Resolved (explicit decision, not a unilateral pick): that
document is renamed to `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`
with its content unchanged, every cross-reference to it updated, and this
document written fresh at the now-free path as the platform's actual
Constitution, above it in precedence. See `docs/governance/
DOCUMENTATION_HIERARCHY.md` for the full hierarchy and the reasoning.

**A second, narrower finding**: the Engineering Knowledge Platform
(ADR-018) that several Knowledge Principles below rely on is a *decided*
principle - approved with the user explicitly during that work - but its
implementing PR (#42) is not yet merged to `main` as of this Constitution.
This document states the principle as binding platform law regardless
(a Constitution states what is decided, not only what has shipped), but
does not claim the Knowledge Platform is live; check `docs/adr/README.md`
for ADR-018's current Status before citing it as built.

No other contradiction was found between the documents reviewed. This
Constitution does not duplicate any of their content - every rule below
that already exists in detail elsewhere is stated as a headline principle
with a pointer to where the detail lives, not restated.

---

## Platform Vision

Every machine interaction becomes knowledge. Every piece of knowledge
helps solve the next machine faster, more accurately, and with higher
confidence. **MSEAL DMS is not a record management system. It is an
Engineering Intelligence Platform** (Blueprint ch.01's Vision, restated
here as permanent platform law, not a Blueprint-only aspiration).

## Platform Mission

Turn every machine interaction into reusable engineering knowledge
(Blueprint ch.01's Mission). Capture data once, reuse it everywhere -
every module contributes reusable engineering knowledge instead of
sitting as an isolated record store.

## Platform Values

1. **Evidence over assertion.** A conclusion is only as trustworthy as
   the evidence behind it, and the evidence is never discarded once a
   conclusion is reached.
2. **Reuse over rebuild.** A second implementation of something the
   platform already has is a defect in the design process, not a
   convenience.
3. **Explainability over automation.** A system that acts without being
   able to explain why is not ready to act, no matter how accurate it is
   on average.
4. **Honesty over completeness.** A named, open gap is worth more than a
   fabricated answer or a silently dropped requirement - every document
   this platform produces says what is built, what is deferred, and what
   is not yet decided, distinctly.
5. **Stability over novelty.** A frozen foundation that many modules
   depend on is changed deliberately, through review, never casually
   because a newer pattern looks nicer.

## Engineering Principles

Restated from Blueprint ch.01's Architecture Principles and Engineering
Principles as permanent platform law (see ch.01 for the full rationale
and the Engineering Knowledge Loop/Value Creation Flow diagrams behind
each one - not restated here):

- Machine is the primary entity; every domain either belongs to a
  Machine, describes an interaction with a Machine, or exists to help an
  engineer understand a Machine faster.
- Everything important is an Event; a fact is not "done" once saved to a
  table, only once emitted as an event other domains can consume without
  coupling to the table that produced it.
- Every Event creates Knowledge; Knowledge continuously improves AI; AI
  assists engineers and never replaces engineering judgment.
- Every recommendation must be explainable and traceable back to the
  source events and knowledge records that produced it.
- **Reuse before Build.** Check for an existing platform service, shared
  component, or standard before writing a new one - the same discipline
  that produced the Attachment Platform, MasterDataService, and the
  shared `<ActivityTimeline>`, each built once and reused by every module
  that needed it since, instead of three or four parallel
  implementations.
- **Shared Platform before Local Solution.** A cross-cutting capability
  (storage, master data, authorization scope, activity timeline,
  navigation) is built as a platform service every module consumes
  through a defined interface, never re-implemented locally inside one
  module because it was faster that week. `docs/architecture/
  PLATFORM_ARCHITECTURE_STANDARDS.md`'s Platform service boundaries
  section is where this principle's implementation detail lives.
- Before a line of code is written, a feature must be able to name its
  Machine, Event, Knowledge, AI, Timeline, and Analytics contribution
  (ch.01's six questions) - a design that cannot is incomplete, not
  "acceptable for v1."

## Business Principles

- **Business terminology is architecture.** A business concept's name is
  not a cosmetic choice made after the code is written - it is a
  decision with the same weight as a schema choice, because a
  mismatched or duplicated term (two names for one concept, or one name
  covering two concepts) causes exactly the kind of silent domain
  confusion this Constitution's Domain Principles exist to prevent. The
  canonical business vocabulary lives in `docs/standards/
  TERMINOLOGY_STANDARD.md` (UI-facing wording) and `docs/standards/
  DOMAIN_LANGUAGE_STANDARD.md` (the business entity model, e.g. "Machine"
  per ADR-009) - this Constitution does not restate either, it elevates
  the principle that they are binding, not optional style guidance.
- A frozen business term (MQR, NTR, PM, PIP, AI Engineering, Predictive
  Quality, Troubleshooting, and every term the Terminology Standard
  freezes going forward) is changed only through Architecture Review +
  Design Review + Documentation Review, the same weight given to a
  frozen schema or API change - never a routine copy edit.
- Code, API routes, database tables/columns, and TypeScript types stay in
  English always; business terminology governs what a user reads, never
  an identifier - renaming a business concept is never, by itself, a
  reason to rename a table or route.

## Domain Principles

- **Machine is the center of the platform.** Every bounded context either
  belongs to a Machine, describes an interaction with a Machine, or
  exists to help an engineer understand a Machine faster (Blueprint
  ch.02's Domain Model is the detailed map this elevates to permanent
  law; Machine-as-aggregate-root is one of Blueprint ch.20's five frozen
  Architecture items).
- **Knowledge is an independent business domain.** Knowledge is not
  owned by Quality, PM, Warranty, or Machine - it aggregates Evidence
  from every domain and is consumed, never owned, by Engineering
  Intelligence (ADR-018, `docs/architecture/KNOWLEDGE_PLATFORM.md` §1).
  A domain being reachable from a familiar place in the navigation (e.g.
  Knowledge's nav entry sitting under the Quality menu group for
  discoverability) never implies that group owns its data - see
  Navigation Principles below for why those are two different questions.
- **One Aggregate.** A business concept is stored once, as one aggregate
  root with one repository boundary - never a second, parallel table
  with a "promotion" or "copy" workflow linking them (the Knowledge
  Case/Candidate reconciliation in ADR-018 is the concrete precedent: one
  `knowledge_cases` table, with "Candidate" and "Case" as lifecycle
  states of the same row, not two tables). A bounded context may import
  from a shared platform service; it must never import another bounded
  context's internals directly, and no repository ever joins across two
  bounded contexts' tables in one query (Blueprint ch.02).
- **One Owner.** Every domain has exactly one owner responsible for its
  aggregate and repository boundary - `docs/governance/
  DOMAIN_OWNERSHIP_MATRIX.md` is the current owner-by-domain record; this
  Constitution does not restate it, only requires that every domain have
  an entry there before it is considered real.
- **Timeline is shared platform infrastructure.** There is exactly one
  Activity Timeline component and one audit-log table every module
  writes through (`record_audit_log`, the closed `AuditModule` union,
  `<ActivityTimeline>`) - a new module never builds its own history view;
  it adds its module name to the existing union and reuses the existing
  component, the same way Knowledge did for ADR-018 with zero new
  timeline infrastructure.

## Capability Principles

Every capability - a nav-visible feature, a module, a platform service -
has, permanently:

- **Owner** - the domain or platform service responsible for it (see
  Domain Principles' "One Owner" and `docs/governance/
  DOMAIN_OWNERSHIP_MATRIX.md`).
- **Lifecycle** - the stage it is at (design-only, in development,
  active, deprecated, archived) - `docs/governance/
  MODULE_MATURITY_MATRIX.md` is where this is tracked platform-wide; a
  capability's own Coming Soon/Preview/Beta/Development/Active
  `CapabilityStatus` (Navigation Principles, below) is the nav-visible
  projection of this same lifecycle, not a second, independent concept.
- **Permission** - the `lib/scope.ts` predicate (or platform-equivalent)
  that gates who may use it once it is real; server-side, always, per
  `docs/standards/SECURITY_STANDARD.md`'s Application-layer
  authorization model.
- **Status** - whether it exists yet at all, and in what form (see
  Navigation Principles' `CapabilityStatus` enum).

**Reuse before Build applies to capabilities as much as to code**: before
a new capability is proposed, check whether an existing platform service
already provides it (Engineering Principles, above) - a capability
proposal that skips this check is incomplete, the same way a design that
cannot name its Machine/Event/Knowledge contribution is incomplete.

## Navigation Principles

**Business capability owns navigation. Navigation represents platform
capabilities. Navigation is never the roadmap.** A user sees the
capabilities available to them; navigation is not where a product
roadmap is previewed to a general audience. This is the Navigation
Visibility Rule (`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §2c,
`src/app/(app)/navConfig.ts`'s `CapabilityStatus` model - `ACTIVE`,
`COMING_SOON`, `PREVIEW`, `BETA`, `DEVELOPMENT`), elevated here as
permanent law rather than restated: visibility is always derived from a
capability's Status plus the viewer's authorization, never from a
hardcoded module name in the filtering logic, and never rendered as a
placeholder for a role that should not see it.

- **Users see capabilities.** Every role sees only `ACTIVE` capabilities -
  a capability that is Coming Soon, Preview, Beta, or in Development is
  hidden completely for that role, not shown disabled.
- **SuperAdmin may see future capabilities.** SuperAdmin sees every
  status - the platform's full roadmap - because SuperAdmin's job
  includes verifying what is coming, not because SuperAdmin's role is
  "more trusted" in the authorization sense for any one capability
  (Capability visibility is not authorization, below). **Temporarily
  suspended for the duration of Production Pilot** ("Production Pilot
  exposes only completed workflows" applies to every role, including
  SuperAdmin, per PR #60, 2026-07-15) - the mechanism this bullet
  describes is unchanged and the exception resumes whenever Pilot status
  is lifted; this note is a factual correction, not itself a
  Constitutional Amendment (no Architecture/Governance Review has
  formally revisited this bullet - one should accompany whatever
  decision makes the suspension permanent or ends it).
- A group of navigation entries with zero visible capabilities for the
  current viewer is hidden automatically, never rendered empty and never
  padded with a placeholder to keep the group visible.
- **Capability visibility is NOT authorization. Server-side RBAC remains
  the security boundary** (`docs/standards/SECURITY_STANDARD.md`).
  Showing or hiding a nav entry is a UX decision about what to present;
  it is never, on its own, what stands between a role and an action. A
  real route's own permission predicate is the only thing that actually
  authorizes access to it, regardless of what the current navigation
  shows.
- A capability's navigation *placement* (which menu group it sits under,
  for discoverability) never implies data *ownership* - see Domain
  Principles' Knowledge example, above. Confusing the two is the single
  most common documentation drift this Constitution's review found (see
  "Relationship to existing documents," above, and PR #42's Final
  Architecture Review for the concrete Knowledge-ownership-wording
  correction that motivated this rule being stated explicitly).

## Knowledge Principles

(ADR-018, `docs/architecture/KNOWLEDGE_PLATFORM.md` - detailed model, not
restated here; see the merge-status note under "Relationship to existing
documents," above.)

- Knowledge is a first-class, independent business domain - see Domain
  Principles.
- **Evidence is the only Source of Truth.** A Knowledge Case's
  conclusions (possible causes, validated fix, confidence) are
  engineering *conclusions*; the Evidence rows attached to it are the
  record of *why*. Evidence is never deleted when a conclusion changes
  (soft-delete only, the same rule every table in this platform follows).
- Knowledge Maturity (workflow state: Draft/Review/Published/Deprecated/
  Archived) and Knowledge Confidence (evidence quality: VeryLow/Low/
  Medium/High/Verified) are independent axes, never conflated into one
  field - a Draft case can already be high-confidence if its evidence is
  strong; a Published case is not automatically top-confidence just for
  having passed review.
- Confidence is manual only, set by an engineer who has reviewed the
  evidence - never computed, inferred, or assigned by AI (see AI
  Principles, below).
- Machine never owns Knowledge; Knowledge is never keyed off one
  module's table (a Knowledge row with a foreign key to a Quality/PM/
  Warranty table has silently become that module's knowledge, not the
  platform's) - Evidence rows are how Knowledge references other domains
  without being owned by any of them.

## AI Principles

- **AI never replaces engineering judgment** (Blueprint ch.01, Principle
  6 - a hard boundary, not a tuning parameter).
- **AI never becomes the Source of Truth.** AI consumes Knowledge; AI
  never produces the Knowledge or Evidence records other systems then
  treat as ground truth. Knowledge never consumes AI - the dependency
  direction is one-way, permanently.
- **AI must always cite Evidence.** Every AI-produced output (summary,
  recommendation, root cause, similar-case match) resolves back to the
  specific Evidence and Knowledge records that produced it, on demand -
  never a bare score or a recommendation with no traceable source
  (Blueprint ch.01, Principles 7-8: explainable and traceable, applied
  specifically to AI outputs).
- AI never assigns Confidence (Knowledge Principles, above) and never
  moves a Knowledge Case's Maturity - both remain human, engineer-gated
  actions, permanently.
- A reserved AI surface (a Coming Soon "AI Summary"/"AI Recommendation"
  tile, for example) is built as an explicit, empty, clearly-labeled
  placeholder before any model is selected or wired - never a
  partially-functional stand-in that quietly does less than its label
  claims.

## Data Principles

- Evidence is the only Source of Truth for a Knowledge conclusion (see
  Knowledge Principles); more generally, every domain's data has exactly
  one Source of Truth, recorded in `docs/governance/
  DATA_OWNERSHIP_MATRIX.md` - a second, independently-updated copy of the
  same fact is a defect, not a caching convenience, until proven
  otherwise through the same review a schema change requires.
- Every table carries RLS and is filtered through an application-layer
  scope check, both layers, always - neither is sufficient alone
  (`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Dependency
  rules and Authorization rules sections hold the implementation detail;
  this Constitution states the rule permanently, not the mechanism).
- Timeline is shared platform infrastructure (Domain Principles, above) -
  restated here because it is as much a data-architecture rule (one
  audit table, one shared read path) as a domain rule.
- Soft-delete, never hard-delete, is the default for every record this
  platform considers evidence of what happened - a hard-delete UI is
  deliberately absent until a specific, reviewed business need justifies
  one.

## Governance Principles

- **Every capability has an Owner, Lifecycle, Permission, and Status**
  (Capability Principles, above) - a capability without all four is not
  yet a real, governed part of this platform, regardless of how much
  code exists for it.
- **Capabilities evolve. The Foundation remains stable.** See the
  Platform Evolution Principle, below, for the full statement of this
  rule - restated here only as a governance consequence: because the
  Foundation is stable, a capability change is reviewed against
  Capability Principles (Owner/Lifecycle/Permission/Status), while a
  Foundation change is reviewed against the much heavier Foundation
  Freeze reopening process (`docs/releases/FOUNDATION_FREEZE_v1.0.md`).
  Conflating the two - reviewing a capability change as if it were a
  Foundation change, or letting a Foundation change slip through as if
  it were a routine capability change - is itself a governance defect.
- Decision authority over a platform-level concern (as opposed to
  application-level permission) is recorded in `docs/governance/
  DECISION_MATRIX.md`, not invented ad hoc per change.
- A dependency-direction violation, an authorization-boundary violation,
  a duplicated platform service, or a navigation entry that misrepresents
  what capability actually exists is a defect, given the same review
  weight as a correctness or security bug - never a style preference to
  be waved through.

## Platform Evolution Principle

> **Capabilities evolve.**
> **The Foundation remains stable.**

Individual capabilities - a new module, a new nav entry, a new Knowledge
domain feature, a new AI-consuming surface - are expected to change,
ship, and iterate continuously. That is where this platform's innovation
happens. The Foundation (`docs/releases/FOUNDATION_FREEZE_v1.0.md`'s
frozen layers: Architecture Blueprint, Platform Governance, Design
Framework, Navigation Standard, Dashboard Standard, Authentication
Platform, Import Platform Foundation, Machine Domain, plus
`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s own ten frozen
platform layers) does not innovate alongside them - it changes only for a
confirmed defect, a security issue, a measurable performance improvement,
or an approved ADR, never a routine PR, regardless of how small the diff
looks.

**Clarification: innovation happens above the Foundation, never inside
it.** A capability that needs the Foundation to change to accommodate it
has found a genuine Foundation gap worth a deliberate reopening (the same
process ADR-011 and ADR-014 already used) - it has not found a license to
patch the Foundation quietly from within a capability's own PR. Building
a new capability is judged by how well it *builds on* the frozen
Foundation (Engineering Principles' Reuse before Build, Shared Platform
before Local Solution); it is never judged by how cleverly it works
around a Foundation constraint instead of surfacing the constraint for
review. A Foundation that were changing as often as the capabilities
built on it would not be a Foundation - it would be just another
capability with extra ceremony, and every module depending on its
stability would be depending on nothing.

## Constitution Rules

**The Constitution overrides ADR interpretation, Design decisions, and
capability implementation if a conflict arises.** It sits above the
Architecture Blueprint, Architecture Standards, ADRs, and Design
Framework in `docs/governance/DOCUMENTATION_HIERARCHY.md`'s precedence
chain - not because it is more detailed (it is deliberately less
detailed than any of them), but because it states the principles those
more detailed documents are already interpretations of. A frozen
Blueprint item or ADR is never silently reinterpreted to fit a new
capability's convenience; if a genuine conflict between this Constitution
and a frozen item is found, it is resolved the same way every other
frozen-layer conflict in this platform's history has been resolved: an
explicit decision, recorded, never a silent pick (see "Relationship to
existing documents," above, for this exact process being followed to
write this document).

Changing the Constitution requires Architecture Review, Governance
Review, and Explicit human approval - see Constitutional Amendments,
below, for the full process and what every amendment must include.

## Constitutional Amendments

**Constitutional changes are exceptional events**, not routine
documentation edits - the Constitution states permanent principles by
design (Platform Evolution Principle, above: the Foundation, and the
Constitution above it, remain stable while capabilities evolve). A
change here should be rare enough that every one of them is individually
memorable, not a category of change this platform makes often.

**Every constitutional change requires all three, always:**

1. **Architecture Review** - against the Architecture Blueprint's North
   Star (ch.01) and the current Foundation Freeze, the same review a
   Breaking Change to a frozen layer requires (Blueprint ch.20).
2. **Governance Review** - per `docs/governance/DECISION_MATRIX.md`'s
   platform-level decision-authority rule; a Constitution change is
   always platform-level, never domain-local, by definition.
3. **Explicit human approval** - a named person's explicit sign-off, not
   an automated check or an inferred approval from silence - the same
   approval authority already defined for architecture-level changes
   (`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation
   Freeze process, `.claude/rules/git.md`). No new committee or role is
   invented by this Constitution; a routine PR review or an AI agent's
   own judgment is never sufficient on its own for a change at this
   level.

**Every amendment must document, in the PR/change record itself:**

- **Rationale** - why the existing principle is wrong, incomplete, or
  has been superseded by a real, already-approved decision (an
  amendment is a record of a decision already made, the same
  "Constitution states what is decided" discipline used to write
  Knowledge Principles above, not a place to work out whether the
  change should happen).
- **Impact Assessment** - what changes for every document below the
  Constitution in `docs/governance/DOCUMENTATION_HIERARCHY.md`'s
  precedence chain as a result - which ADRs, Architecture Standards
  sections, or Design Framework rules now need their own follow-up
  amendment to stay consistent with the new principle.
- **Affected Principles** - the exact section(s) of this document being
  added, changed, or removed, named explicitly (e.g. "Navigation
  Principles' Capability visibility is NOT authorization rule") - never
  a change described only in terms of the surrounding prose.
- **Migration Strategy (if applicable)** - if the amendment changes a
  principle existing capabilities were built against (e.g. narrowing
  "SuperAdmin may see future capabilities" to a smaller set of roles),
  how already-shipped capabilities and documentation reach the new state
  - a Constitutional amendment that leaves the rest of the platform
  silently inconsistent with the new principle is incomplete, the same
  "detect contradictions, do not duplicate, reference existing standards
  instead" discipline used to write this Constitution in the first
  place.

A proposed Constitution change that does not carry all three approvals
and all four documented fields (Migration Strategy only where the
amendment actually requires one) is not ready to merge, regardless of
how small it looks. The version number at the top of this document
(`v1.0` today) is bumped with every amendment (Future governance process,
below), and the amendment itself is recorded as a dated entry, never a
silent edit to the principle text alone.

## Relationship to Foundation Freeze

The Foundation Freeze (`docs/releases/FOUNDATION_FREEZE_v1.0.md`) is
*what is currently frozen and why*; this Constitution is *the permanent
principle that explains why freezing a foundation is the right thing to
do at all* (the Platform Evolution Principle, above: "Capabilities
evolve. The Foundation remains stable."). The Foundation Freeze's own reopening
process (ADR + Architecture Review + Architecture Approval + Merge) is
unchanged by this Constitution - this document does not add a second,
competing process, it states the principle that process protects.

## Relationship to ADRs

An ADR records one point-in-time decision, grounded in whatever this
Constitution, the Blueprint, and Architecture Standards already establish
- it is a leaf, not a root. Where an ADR's own reasoning conflicts with a
Constitutional principle, the Constitution governs (Constitution Rules,
above) and the conflict is itself worth a new ADR recording the
resolution - the same "never silently pick one" discipline `docs/
architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` already established for
its own precedence rule, now stated as permanent Constitutional law
rather than one document's local convention. `docs/adr/README.md`
remains the canonical ADR index; this Constitution does not duplicate it.

## Relationship to Design Framework

The MSEAL Design Framework (`docs/architecture/
MSEAL_DESIGN_FRAMEWORK.md`, ADR-023) is where the Navigation, Dashboard,
and Widget/Screen-Contract standards live in full implementation detail -
this Constitution's Navigation Principles are the permanent law the
Design Framework's Navigation Standard already implements (most recently
refined by the Capability Status model, `docs/architecture/
MSEAL_DESIGN_FRAMEWORK.md` §2c). A future Design Framework change that
would make Navigation stop representing capability, or start
representing roadmap, is a Constitutional conflict, not a routine design
refinement, and needs the Constitution Rules process above, not a normal
Design Review alone.

## Future governance process

1. A proposed new capability is checked against Capability Principles
   (Owner/Lifecycle/Permission/Status) and Domain Principles (One
   Aggregate, One Owner, Reuse before Build) before any code is written -
   the same "before a line of code is written" discipline Engineering
   Principles already requires for Machine/Event/Knowledge questions,
   extended to this Constitution's own principles.
2. A proposed change to a Foundation-frozen layer follows the Foundation
   Freeze's existing reopening process unchanged (Relationship to
   Foundation Freeze, above) - this Constitution does not add a second
   gate on top of it.
3. A proposed change to this Constitution itself follows the
   Constitutional Amendments process above in full - Architecture
   Review, Governance Review, Explicit human approval, plus a documented
   Rationale/Impact Assessment/Affected Principles/Migration Strategy -
   and is recorded as a new Constitution version (v1.1, v2.0, ...) with
   an explicit changelog entry at the top of this document, the same
   versioning discipline `docs/governance/DOCUMENTATION_POLICY.md`
   already requires of every governance framework. Constitutional
   changes are exceptional events, not a routine part of shipping a
   capability - see Constitutional Amendments above for why.
4. A contradiction discovered between this Constitution and any other
   document (an ADR, the Blueprint, a Standard, a living architecture
   document) is resolved explicitly, following `docs/governance/
   DOCUMENTATION_HIERARCHY.md`'s "How to use this when two documents
   disagree" process, with the Constitution's own precedence honored per
   Constitution Rules above - never by quietly editing one document to
   match the other with no note.
5. This Constitution is reviewed for continued accuracy whenever the
   Foundation Freeze is next revised or reopened (the Platform Evolution
   Principle's "Capabilities evolve. The Foundation remains stable." is
   itself a claim that should be re-checked against reality at that
   point, not assumed permanently true without review).

## Verification

Reviewed for contradiction against every document named in "Relationship
to existing documents," above. One genuine contradiction was found (the
`PLATFORM_CONSTITUTION.md` naming/hierarchy-layer conflict) and resolved
explicitly before this document was written, not silently. No other
contradiction was found. No content from Architecture Blueprint,
Architecture Standards, ADRs, Governance Framework, Design Framework,
Navigation Standard, Terminology Standard, or the Knowledge Platform is
duplicated here - every rule above that has implementation detail
elsewhere points to it rather than restating it.

**Revision pass (pre-merge documentation refinement)**: added
Constitutional Amendments (full Rationale/Impact Assessment/Affected
Principles/Migration Strategy requirement, on top of the three approvals
already stated) and the Platform Evolution Principle as its own named
section. Checked for internal duplication and stale cross-references
this pass introduced: Governance Principles' evolution bullet and both
"Relationship to Foundation Freeze" and "Future governance process"'s
references to it were updated to point to the new Platform Evolution
Principle section rather than restate its wording a second or third
time; "Constitution Rules"' amendment-requirements list was replaced
with a pointer to Constitutional Amendments rather than kept as a
second, shorter copy of the same three-item list. Repo-wide search
confirmed no other file states the old "Platform capabilities evolve.
Foundation remains stable." wording that would now read as
inconsistent with this document's phrasing. No architecture or
implementation changed by this pass - documentation only.

**Recommendation: APPROVED FOR MERGE.**
