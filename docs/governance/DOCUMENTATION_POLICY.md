# Documentation Policy

## Relationship to existing documents

No prior document standardizes documentation practice itself as a single
policy - individual conventions exist scattered (ADR template
conventions implied by the existing 14 ADRs' shared structure;
`docs/NAMING_STANDARD.md` for code naming, not doc naming;
`docs/architecture/blueprint/20-ARCHITECTURE-GOVERNANCE.md`'s ADR
Process for architecture decisions specifically). This document is new,
scoped narrowly to *documentation practice*, not a restatement of 20's
ADR Process (cited, not repeated).

**Why this is needed, evidenced, not asserted:** two real drifts were
found while grounding this governance framework, both of which a simple
documentation policy would have caught:

1. **Duplicate ADR number** - `docs/adr/ADR-009-Machine-Domain.md` and
   `docs/adr/ADR-009-Universal-Import-Framework.md` both existed on
   `main` with the same number (fixed in this same pass - the latter is
   now `ADR-024`, see `docs/adr/README.md`). A one-line "check existing
   ADR numbers before assigning a new one" rule would have prevented
   this in the first place.
2. **Two disagreeing event catalogs** - see `EVENT_OWNERSHIP.md` in
   full. A one-line "check for an existing canonical doc before creating
   a second one with a similar name/purpose" rule would have caught this
   at review time.

## ADR

- **Numbering**: before assigning a new ADR number, check `docs/adr/`'s
  actual current highest number **and** `docs/architecture/blueprint/
  16-ADR-RECOMMENDATIONS.md`'s reserved range (currently ADR-015 through
  ADR-021, reserved for future blueprint-domain ADRs) - do not reuse a
  number, and do not assign a number inside the reserved range for an
  unrelated decision (this session's own precedent: ADR-022 and ADR-023
  were each explicitly numbered past the reserved range for exactly this
  reason).
- **One ADR = one decision.** Context → Decision → Alternatives
  Considered → Consequences - the shape every existing ADR in this
  repository already follows; keep following it.
- **Status must be accurate.** An ADR describing a not-yet-merged PR is
  "Proposed," not "Accepted" - see this framework's own README.md
  handling of ADR-022/ADR-023 as the pattern to follow.
- **A duplicate number is a documentation defect**, not a style nitpick -
  treat finding one (like ADR-009 above) with the same weight as any
  other reviewable bug, per this repository's existing "a dependency
  direction violation is a defect, not a style preference" precedent
  (`PLATFORM_ARCHITECTURE_STANDARDS.md`).

## Architecture

- `docs/architecture/blueprint/` (01-20 + README) is the frozen Baseline
  once its README is marked APPROVED - already true (v1.1). Do not edit
  it outside 20's Breaking Change Process, even for a "just fixing a
  typo" edit to a *decision* (a genuine typo fix that changes no meaning
  is fine; anything that could be read as changing a rule is not).
- `docs/architecture/*.md` (outside `blueprint/`) are living,
  binding-but-editable platform documents (`PLATFORM_ARCHITECTURE_STANDARDS.md`,
  `MASP_ENTERPRISE_STANDARD.md`, `AUTHENTICATION_PLATFORM.md`, etc.) -
  edited directly when their content changes, no ADR needed unless the
  change itself is a Freeze-item change.
- **Before creating a new architecture document, search for an existing
  one covering the same ground** - this framework's own README.md's
  per-document "Relationship to existing documents" section is the
  required pattern going forward for any new `docs/architecture/*` or
  `docs/governance/*` file.

## Skills

- `.claude/skills/**` is gitignored by default (see
  `REPOSITORY_POLICY.md` §4) - a skill is force-added and tracked only
  when it is genuinely project-specific, referenced by a tracked `docs/`
  file, and meant to be shared with every future contributor/agent.
- A tracked skill follows the same "one clear purpose, cite don't
  duplicate" rule as any other document - `.claude/skills/
  mseal-platform-design/`'s pattern (a `SKILL.md` entry point + focused
  guideline files, each pointing back to the canonical `docs/` source) is
  the reference example.

## Design Docs

- The MSEAL Design Framework (`docs/adr/ADR-023`, proposed;
  `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`) is the current design
  -documentation pattern to follow: one ADR for the decision, one
  architecture doc for the living detail, kept in sync with the code
  (the same relationship `docs/adr/ADR-022`/`docs/architecture/
  IMPORT_PLATFORM.md` already established for the Import Platform).
  New design docs should follow this same ADR+living-doc pairing rather
  than inventing a third documentation shape.

## Release Notes

- `docs/releases/MASP_PLATFORM_FOUNDATION_V1.1.md` is the existing
  format to match: what shipped, verification evidence (typecheck/lint/
  tests/build/architecture-check), and an explicit recommendation
  (PASS/PASS WITH WARNINGS/FAIL) - the same three-part shape this
  session's own PR reports have used throughout. Keep using it; do not
  invent a new release-note shape per release.

## Roadmap

- `docs/ROADMAP.md` is the one place "what's next" lives - a new
  initiative (like this governance framework) gets a line in its
  Governance Roadmap section (see `README.md`) or in `docs/ROADMAP.md`
  itself once accepted, not a second competing roadmap document.
- Before naming a new phase/priority, check `docs/ROADMAP.md`'s current
  "Recommended next implementation order" - this framework does not
  reorder it; it's a documentation-governance layer, not a product
  -priority decision.

## Verification checklist (apply before merging any new document)

- [ ] Does an existing document already cover this? If yes, cite it -
      don't restate it.
- [ ] Does this document's number/name collide with an existing one
      (ADR number, file name, event name)?
- [ ] Does every claim about "current state" match what's actually on
      `main` (not a feature branch, not memory of a prior session)?
- [ ] Is every reference to a not-yet-merged PR/ADR marked "proposed,"
      not asserted as accepted?
- [ ] Does the document state what it does *not* cover, so the next
      reader doesn't have to guess?

## Gap Analysis

- The ADR-009 duplicate and the two-event-catalog drift both predate
  this policy - neither is fixed by writing this policy, only prevented
  going forward. See `README.md`'s Governance Roadmap for the fix items.
- No automated tooling enforces any item in the verification checklist
  above - it's a human review-time discipline today, same limitation
  `docs/standards/TESTING_STANDARD.md` accepts for its own non-numeric
  coverage requirement ("enforced by review instead").
