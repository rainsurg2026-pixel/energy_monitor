# Foundation Freeze v1.0

> **Extended by `docs/releases/FOUNDATION_FREEZE_v1.1.md`** (2026-07-13,
> five new frozen layers: Platform Constitution, Platform Architecture
> Standards, Navigation Visibility Policy, Capability Status Model,
> Business Terminology Governance). This document's own content is
> preserved unchanged as the historical record of the original
> declaration below - v1.1 extends this Freeze, it does not replace it;
> every layer declared frozen here remains frozen.

**Status: DECLARED. Effective 2026-07-12 (all four Foundation PRs merged to `main` and verified in Production).**

This declares the MSEAL DMS Foundation — Architecture, Design, Governance,
Authentication, Import, and Machine Domain — structurally complete and
frozen. It supersedes the Architecture-only freeze declared in
`docs/architecture/blueprint/20-ARCHITECTURE-GOVERNANCE.md` by extending
the same discipline (ADR + Review + Approval required to reopen) across
every layer named below, not just the Architecture Baseline.

## What is frozen

| Layer | Version | Governing document |
|---|---|---|
| Architecture Blueprint | v1.1 | `docs/architecture/blueprint/README.md`, `20-ARCHITECTURE-GOVERNANCE.md` |
| Platform Governance | v1.1 | `docs/governance/README.md`, `docs/adr/README.md` (ADR Index) |
| Design Framework | v1.1 | `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`, ADR-023 |
| Navigation Standard | v1.0 | `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` (Navigation section), `.claude/skills/mseal-platform-design/NAVIGATION_GUIDELINES.md` |
| Dashboard Standard | v1.0 | `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` (Dashboard section), `.claude/skills/mseal-platform-design/DASHBOARD_GUIDELINES.md` |
| Authentication Platform | v3.0 | `docs/architecture/AUTHENTICATION_PLATFORM.md`, ADR-014 |
| Import Platform Foundation | v2 | `docs/architecture/IMPORT_PLATFORM.md`, ADR-024 (renumbered from ADR-009), ADR-022 |
| Machine Domain | v1.0 | `docs/architecture/MACHINE_PASSPORT_ARCHITECTURE.md`, `docs/architecture/MACHINE_DATA_OWNERSHIP.md`, ADR-026 |

**Frozen means**: feature-complete for this version, no further structural
change without going through the process below. Bug fixes, security
patches, and performance fixes remain in scope at all times — the freeze
governs *structural/architectural* change, never blocks a defect fix,
exactly as `20-ARCHITECTURE-GOVERNANCE.md` already established for the
Architecture Baseline.

## What reopening requires

Unchanged from the existing Architecture Freeze process, now applied
uniformly to every layer above:

1. **ADR** proposing the change and grounding it in the current baseline.
2. **Architecture Review** against `01-NORTH-STAR-AND-PRINCIPLES.md`,
   `20-ARCHITECTURE-GOVERNANCE.md`'s Freeze list, and
   `14-RISKS-AND-TECHNICAL-DEBT.md`.
3. **Architecture Approval** — the same approval authority already defined
   for explicit git actions in `.claude/rules/git.md`; no new committee or
   role is invented by this freeze.
4. **Merge**, same as any other change.

This is the identical process ADR-011 used to reopen the Address Platform
(v1→v2) and ADR-014 used for Authentication Platform v3.0 — reopening a
frozen layer is a normal, expected, documented event, not an exception.

## How this Foundation was assembled

Four PRs, merged in dependency order, each independently reviewed and
production-verified before the next began:

| # | PR | Merge SHA | Deployment |
|---|---|---|---|
| 1 | #36 — Import Platform Foundation | `ccb9a7470cb7ce9feacf9be48f79c1f483cb02c5` | Verified success |
| 2 | #37 — Platform Design Framework | `486ea38494d8c8630b7975476db887bfc206d936` | Verified success |
| 3 | #38 — Platform Governance | `19c0a594a19d3e07e63459fdd7f3ffe5fd33b860` | Verified success |
| 4 | #39 — Machine Digital Passport | `97c8b8a5e1465d7290cd9c6e4d057c731a863175` | Verified success |

Full detail (independent review findings, fixes applied, deployment IDs):
see the Merge Report in this session's Foundation Freeze summary and
`docs/releases/RELEASE_NOTES_FOUNDATION_v1.0.md`.

## Next Epic

**Knowledge Engine v1.0** is the recommended next epic — see
`docs/ROADMAP.md`'s "Recommended next implementation order." Not started;
this document only recommends it, per this Freeze's own scope (Foundation
work is complete; new epics require their own plan, ADR-where-applicable,
and approval before implementation, the same discipline every prior
milestone followed).
