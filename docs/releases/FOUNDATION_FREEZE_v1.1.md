# Foundation Freeze v1.1

**Status: DECLARED. Effective 2026-07-13 (five governance/navigation
layers added to the Foundation, all merged to `main` and verified in
Production).**

> **Amendment (2026-07-13): PR #42 (Engineering Knowledge Platform,
> ADR-018) has since merged to `main` and is verified in Production.**
> Its own freeze is declared separately in
> `docs/releases/KNOWLEDGE_FOUNDATION_FREEZE_v1.0.md`, the same additive
> pattern this document itself used to extend v1.0 - the "What is not
> frozen by this document" section below is preserved unchanged as the
> historical record of this document's original 2026-07-13 declaration,
> written while PR #42 was still open. Read it as "not frozen *by this
> document*," not as "not frozen at all."

> **Second amendment (2026-07-13): PR #45 (Machine Delivery Platform
> v1.0, ADR-017/ADR-027) has since merged to `main` (SHA `de4d8cd`) and
> is verified in Production.** This is a purely additive extension - see
> "What is frozen (new in this amendment)," below. No content frozen by
> v1.0, v1.1's original table, or the Knowledge Foundation Freeze is
> modified.

**Supersedes `docs/releases/FOUNDATION_FREEZE_v1.0.md` by extension, not
replacement** - every layer v1.0 declared frozen remains frozen,
unchanged, under the same reopening process. v1.0's own content is
preserved as the historical record of the 2026-07-12 declaration; this
document adds the layers that were built and merged in the four PRs
since (#41, #43, #44 - #42, Engineering Knowledge Platform/ADR-018,
remains open and is explicitly **not** part of this freeze; see "What is
not frozen by this document," below).

## What is frozen (new in v1.1)

| Layer | Version | Governing document | Established by |
|---|---|---|---|
| Platform Constitution | v1.0 | `docs/architecture/PLATFORM_CONSTITUTION.md` | PR #44 |
| Platform Architecture Standards | (renamed, content continuous from the prior "MASP Platform Constitution") | `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md` | PR #44 |
| Navigation Visibility Policy | v1.0 | `docs/architecture/MSEAL_DESIGN_FRAMEWORK.md` §2c, `docs/standards/SECURITY_STANDARD.md`'s "Navigation visibility is not an authorization boundary" | PR #43 |
| Capability Status Model | v1.0 | `src/app/(app)/navConfig.ts` (`CapabilityStatus`, `isCapabilityVisible`, `filterGroupsByCapability`), `.claude/skills/mseal-platform-design/NAVIGATION_GUIDELINES.md` | PR #43 |
| Business Terminology Governance | v1.0 | `docs/standards/TERMINOLOGY_STANDARD.md` | PR #41 (formalized as its own frozen layer here; not listed as a distinct row in v1.0) |

**Frozen means the same thing it meant in v1.0**: feature-complete for
this version, no further structural change without going through the
reopening process below. Bug fixes, security patches, and performance
fixes remain in scope at all times.

Read together, not independently: the Platform Constitution is the
permanent-principles layer (`docs/governance/DOCUMENTATION_HIERARCHY.md`'s
new top layer); Platform Architecture Standards is the renamed
implementation-rules layer immediately below it; the Navigation
Visibility Policy and Capability Status Model are two names for the one
PR #43 change (the policy statement and the code/schema model that
implements it) - freezing them together, not as independently-reopenable
layers, since reopening one without the other would leave the policy and
its implementation out of sync; Business Terminology Governance was
already binding platform vocabulary per the PR #41 addendum to
`docs/releases/RELEASE_NOTES_FOUNDATION_v1.0.md` - this document is where
it first becomes a named row in a Foundation Freeze's own frozen-layer
table, not a new decision.

## What is frozen (new in this amendment - Machine Delivery Platform v1.0)

| Layer | Version | Governing document | Established by |
|---|---|---|---|
| Inspection Domain (PDI) | v1.0 | `docs/adr/ADR-017-Inspection-Domain.md`, `docs/architecture/INSPECTION_PDI.md` | PR #45 |
| Machine Delivery Platform (lifecycle orchestration) | v1.0 | `docs/adr/ADR-027-Machine-Delivery-Platform.md`, `docs/architecture/DELIVERY_PLATFORM.md` | PR #45 |
| Service Construction Standard | v1.0 | `docs/standards/SERVICE_CONSTRUCTION_STANDARD.md` | PR #45 (platform-quality refinement pass) |
| Architecture Check Rule 6 (no eager Repository/Service construction) | v1.0 | `scripts/architecture-check.ts`, `docs/engineering/ARCHITECTURE_ENFORCEMENT.md` | PR #45 (platform-quality refinement pass) |
| Machine Delivery Dashboard KPI Contract | v1.0 | `docs/architecture/DELIVERY_PLATFORM.md` §8 | PR #45 (platform-quality refinement pass) |

This is a purely additive extension - none of the layers named in v1.0's
own table, v1.1's original table above, or the Knowledge Foundation
Freeze are modified, reopened, or reinterpreted by this amendment.
Frozen means the same thing it has meant since v1.0: feature-complete
for this version, no further structural change without going through
"What reopening requires," below.

## What is not frozen by this document

**The Engineering Knowledge Platform (ADR-018, PR #42) is explicitly
excluded.** Its PR is open, not merged, as of this document. Freezing an
unmerged capability would contradict this Foundation's own "frozen means
feature-complete and merged" definition; ADR-018 remains Proposed
(`docs/adr/README.md`) until its own PR merges and is independently
verified, exactly like every other layer this Foundation has ever frozen.
The Platform Constitution's Knowledge Principles state ADR-018's
*decided* principles as permanent platform law regardless (a Constitution
states what is decided, not only what has shipped) - that is a statement
about the *principle*, not a declaration that the *implementation* is
frozen infrastructure yet.

## What reopening requires

Unchanged from v1.0 and from the original Architecture Freeze process:

1. **ADR** proposing the change and grounding it in the current baseline.
2. **Architecture Review** against `01-NORTH-STAR-AND-PRINCIPLES.md`,
   `20-ARCHITECTURE-GOVERNANCE.md`'s Freeze list, `14-RISKS-AND-
   TECHNICAL-DEBT.md`, and (new as of v1.1) the Platform Constitution's
   own North Star-equivalent principles.
3. **Architecture Approval** - the same approval authority already
   defined for explicit git actions in `.claude/rules/git.md`.
4. **Merge**, same as any other change.

Reopening the Platform Constitution specifically carries one additional
requirement beyond the four steps above: **Governance Review** and
**Explicit human approval**, plus a documented Rationale/Impact
Assessment/Affected Principles/Migration Strategy, per the Constitution's
own Constitutional Amendments section - the heaviest bar in this
Foundation, reserved for the document everything else in this table is
now interpreted through.

## How this Foundation extension was assembled

Merged in sequence, each independently reviewed and production-verified
before the next began (continuing the numbering from v1.0's own table):

| # | PR | Merge SHA | Deployment |
|---|---|---|---|
| 5 | #41 — UI Terminology & Navigation Cleanup + Business Terminology Governance | `8011a4d` | Verified success |
| 6 | #43 — Navigation Visibility Refinement (Capability Status Model) | `3d85bfb` | Verified success |
| 7 | #44 — Platform Constitution v1.0 / Platform Architecture Standards | `757ea9f` | Verified success |
| 8 | #42 — Engineering Knowledge Platform v1.0 (ADR-018) | `ad34708` | Verified success |
| 9 | #45 — Machine Delivery Platform v1.0 (ADR-017/ADR-027) | `de4d8cd` | Verified success |

Full detail for each: `docs/releases/RELEASE_NOTES_FOUNDATION_v1.0.md`'s
Post-Freeze Addenda (PR #41 and PR #43 sections), this PR's own merge
report (PR #44), `docs/releases/RELEASE_NOTES_KNOWLEDGE_v1.0.md` (PR #42),
and `docs/releases/RELEASE_NOTES_DELIVERY_v1.0.md` (PR #45).

## Next Epic

**Superseded again by the second amendment above.** PR #42 (Knowledge)
and PR #45 (Machine Delivery Platform) have both since merged. The
Knowledge Foundation Freeze previously recommended **AI Troubleshooting**
next; this second amendment's own task brief instead recommends
**Service Platform v1.0** (Preventive Maintenance, Warranty, Campaign,
Parts, Service Visit, Field Service, Service History, Technician) as the
next epic - not a rejection of the AI Troubleshooting recommendation, but
a sequencing call made at this amendment's own instruction, recorded here
rather than silently overriding the prior one. Service Platform must
reuse Machine Passport, Machine Delivery, Knowledge Platform, Activity
Timeline, Attachment Platform, Authorization, and the Dashboard Framework
- not rebuild any of them. See `docs/ROADMAP.md` for the living roadmap
ordering.
