# Documentation Hierarchy

## Relationship to existing documents

Precedence rules already exist, scattered across multiple documents:
`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` states "where this document
and an older one disagree, the newer, more specific decision governs";
`docs/architecture/MASP_ENTERPRISE_STANDARD.md` states "where this
document and `PLATFORM_ARCHITECTURE_STANDARDS.md` disagree on any other point,
`PLATFORM_ARCHITECTURE_STANDARDS.md`'s binding rules govern"; the Architecture
Blueprint's own README states the Blueprint is APPROVED/FROZEN as of its
merge; `docs/architecture/PLATFORM_CONSTITUTION.md` states it overrides
ADR interpretation, Design decisions, and capability implementation if a
conflict arises. **This document does not override any of these - it
consolidates them into one visible hierarchy**, per
`DOCUMENTATION_POLICY.md`'s own rule to check for existing coverage
before adding a new document.

**Revision note (Platform Constitution v1.0)**: this hierarchy previously
placed "Platform Governance Framework" at the top and had no Constitution
layer at all (`docs/architecture/PLATFORM_CONSTITUTION.md` did not exist
under that name - the document now at
`docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` was, at the time,
itself misleadingly titled "MASP Platform Constitution" despite holding
implementation-level architecture rules, not permanent principles). This
revision (a) introduces the real Constitution as the top of the
precedence chain, per the Constitution's own Constitution Rules section,
and (b) repositions Platform Governance Framework and Standards as
cross-cutting rather than numbered layers (see "Where Governance
Framework and Standards fit," below). This is an intentional governance
improvement, explicitly requested and approved, not architecture drift.

## The Hierarchy

```
1. Platform Constitution               (docs/architecture/PLATFORM_CONSTITUTION.md)
        │  permanent Vision/Mission/Values/Principles; overrides ADR
        │  interpretation, Design decisions, and capability implementation
        │  if a conflict arises (the Constitution's own Constitution Rules)
        ▼
2. Architecture Blueprint v1.1         (docs/architecture/blueprint/01-20 + README)
        │  APPROVED, FROZEN as of PR #34's merge - a snapshot, not living
        ▼
3. Architecture Standards              (docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md)
        │  implementation-level architecture rules the Constitution's
        │  principles govern the interpretation of - renamed from
        │  "MASP Platform Constitution" (Platform Constitution v1.0)
        ▼
4. ADRs                                (docs/adr/ADR-001 .. latest, see docs/adr/README.md)
        │  each one decision; frozen ADRs governed by the same Freeze as their subject
        ▼
5. Design Framework                    (MSEAL Design Framework, ADR-023 + its living doc)
        │
        ▼
6. Implementation                      (src/ - code, routes, schema)
```

Other living architecture documents outside the Blueprint (e.g.
`MASP_ENTERPRISE_STANDARD.md`, `KNOWLEDGE_PLATFORM.md`) sit at the same
altitude as the ADRs that ground them - a living document tracking a
specific ADR (`KNOWLEDGE_PLATFORM.md` tracks ADR-018, `IMPORT_PLATFORM.md`
tracks ADR-022, `MSEAL_DESIGN_FRAMEWORK.md` tracks ADR-023) is governed
by layer 4/5's precedence, not a separate layer of its own.

### Where Governance Framework and Standards fit

Two concerns from the previous version of this diagram are **cross-cutting**,
not numbered layers in the content-precedence chain above:

- **Platform Governance Framework** (`docs/governance/` - this document's
  own home) is the *process* layer: who reviews and approves a change at
  any level above, including how the Constitution itself may change (the
  Constitution's own Change Management section: Architecture Review +
  Governance Review + Explicit approval). It wraps around every layer
  1-6 rather than sitting between two of them - a Governance Framework
  document never outranks a Constitution principle or a Frozen Blueprint
  item on content, only defines the process for changing one.
- **Standards** (`docs/standards/*.md` - Terminology, Security, Domain
  Language, and similar binding conventions) are cross-cutting
  conventions consumed by whichever layer is relevant (an ADR citing the
  Terminology Standard for UI wording, the Design Framework citing the
  Security Standard for a navigation-authorization rule) - not a single
  fixed rank, because a Standard's own scope determines which layer
  consumes it.
- **Engineering Principles** (Blueprint ch.01, `docs/PRODUCT_PHILOSOPHY.md`)
  are now stated as permanent platform law in the Constitution's own
  Engineering Principles section - the Constitution states them, ch.01
  remains their detailed articulation and rationale; the Constitution
  does not duplicate ch.01, it elevates its headline principles.
- **AI Engineering Playbook** (`docs/governance/
  AI_ENGINEERING_PLAYBOOK.md`) is the operational reading-order and
  Before-Every-PR checklist for an AI engineering session specifically -
  same altitude as this document and `DOCUMENTATION_POLICY.md`: it
  indexes the content layers above, never competes with them. Referenced
  from `.claude/CLAUDE.md`'s "Where to look, in order" as the first
  stop after root `CLAUDE.md`.

## Precedence Rules (consolidated, not new)

1. **A frozen item always wins over a non-frozen document that
   contradicts it**, regardless of layer - e.g. a Standard cannot
   casually redefine something the Architecture Freeze (layer 2) already
   decided; that requires the Breaking Change Process (Blueprint ch.20),
   full stop. The Constitution (layer 1) is the one exception this rule
   itself carves out deliberately: per the Constitution's own
   Constitution Rules, it overrides ADR interpretation, Design
   decisions, and capability implementation on conflict - because it
   sits above the Freeze process that produced them, not beside it.
2. **Within the same layer, the newer, more specific decision governs**
   - `PLATFORM_ARCHITECTURE_STANDARDS.md`'s own rule, generalized: a later ADR
     supersedes an earlier living document's wording on the same point
     (ADR-011 v2 superseding `MASP_ENTERPRISE_STANDARD.md`'s Address
     Platform wording is the existing, cited precedent), but never
     silently - the disagreement itself gets a new ADR recording which
     one wins, per `PLATFORM_ARCHITECTURE_STANDARDS.md`'s own words: "the
     disagreement itself should be resolved with a new ADR, not by
     silently picking one."
3. **Governance Framework never contradicts layer 1/2/3 content** -
   every governance document states explicitly what it extends vs. cites
   vs. deliberately does not restate (`DOCUMENTATION_POLICY.md`'s
   verification checklist). If a future governance document would need
   to contradict a frozen item to make sense, that is a signal the
   frozen item itself needs a Breaking-Change-Process review - not
   something the governance layer can settle unilaterally by being
   "above" it in process terms. Being the *process* authority means
   broader procedural scope, not higher authority to override a Freeze
   or the Constitution on content.
4. **A document's own explicit precedence statement wins over this
   consolidated diagram** if the two ever conflict - this document
   summarizes, it does not supersede, the Constitution's, `PLATFORM_ARCHITECTURE_STANDARDS.md`'s, and
   `MASP_ENTERPRISE_STANDARD.md`'s own precedence clauses.

## How to use this when two documents disagree

1. Check whether either document is the Constitution (layer 1) or a
   Freeze item (Blueprint ch.20's 5 items, `PLATFORM_ARCHITECTURE_STANDARDS.md`'s
   Foundation Freeze). If the Constitution is one side of the
   disagreement, it wins per its own Constitution Rules. Otherwise, if
   either side is a Freeze item, that one wins regardless of layer or
   recency, unless changed via the Breaking Change Process.
2. If neither is the Constitution nor frozen, the higher layer number
   (further down this list, i.e. more specific/operational) usually
   reflects a more detailed, later decision - but check dates and
   existing explicit precedence clauses (rule 4) before assuming.
3. Record the resolution as a new ADR if the disagreement is
   substantive (changes what a reader should do) - not for a typo-level
   fix. A disagreement that reaches all the way to the Constitution's
   own principles requires the Constitution's own Change Management
   process instead of a routine ADR.
4. Never resolve a disagreement by quietly editing one document to match
   the other with no note - that is exactly the class of drift
   `DOCUMENTATION_POLICY.md` and this repository's own past fixes
   (ADR-009 dup, event catalog drift, repo-visibility drift, the
   Constitution/Architecture-Standards rename itself) exist to prevent
   from recurring.

## Gap Analysis

- This hierarchy is descriptive of existing, scattered precedence
  clauses - it is not itself a new binding rule beyond consolidating
  them into one visible diagram. If a future document's precedence
  clause contradicts this diagram, fix the diagram, not the document
  (rule 4).
- The Engineering Knowledge Platform (ADR-018, `docs/architecture/
  KNOWLEDGE_PLATFORM.md`) is referenced by the Constitution's Knowledge
  Principles as of Platform Constitution v1.0, but ADR-018's own PR is
  not yet merged to `main` as of this revision - the Constitution states
  the *decided* principle (Knowledge is an independent domain, Evidence
  is the Source of Truth), which is already approved, separately from
  whether the implementing PR has landed. Do not treat this as the
  Constitution assuming unmerged code is live; check `docs/adr/README.md`
  for ADR-018's current Status before citing it as built.
