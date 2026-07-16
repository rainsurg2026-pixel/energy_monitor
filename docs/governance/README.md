# MSEAL DMS — Platform Governance Framework v1.1

> **Amendment (Platform Constitution v1.0)**: `docs/architecture/
> PLATFORM_CONSTITUTION.md` now sits above this framework in the content-
> precedence hierarchy - see `DOCUMENTATION_HIERARCHY.md`'s "Where
> Governance Framework and Standards fit" section for the exact
> relationship (short version: this framework is the *process* layer -
> who reviews/approves a change, including a change to the Constitution
> itself - not a content layer the Constitution's principles compete
> with). The diagram immediately below is this framework's own v1.1
> diagram, preserved as written at the time; treat `DOCUMENTATION_
> HIERARCHY.md` as the current, authoritative version if the two ever
> read as disagreeing.

This is **not a feature**. It is the operating model that sits above every
other governing document this repository already has, other than the
Platform Constitution (see the amendment note above):

```
Platform Governance Framework   (this directory + docs/adr/README.md)
        │  operationalizes and cross-references
        ▼
Architecture Blueprint v1.1     (docs/architecture/blueprint/01-20, APPROVED, FROZEN)
        │
        ▼
ADRs                            (docs/adr/ADR-001 .. latest — see docs/adr/README.md, the ADR Index)
        │
        ▼
MSEAL Design Framework          (docs/adr/ADR-023, docs/architecture/MSEAL_DESIGN_FRAMEWORK.md)
        │
        ▼
Engineering Principles          (docs/PRODUCT_PHILOSOPHY.md, blueprint 01)
```

See `DOCUMENTATION_HIERARCHY.md` for the fully consolidated, current
version of this stack (precedence rules, how to resolve a disagreement
between layers, and where the Platform Constitution and Architecture
Standards now sit).

**v1.1 (this pass)** resolves four governance blockers found in v1.0's
own Gap Analysis before merge: a duplicate ADR number, two disagreeing
event catalogs, a repository-visibility documentation drift, and missing
skill governance - plus adds four new documents (Capability Dependency
Map, Module Maturity Matrix, Documentation Hierarchy, Repository
Structure Map). Per `DOCUMENTATION_POLICY.md`'s own rule ("one version
number per framework, bumped when materially revised"), this framework's
version is bumped from v1.0 to v1.1 in the same commit as these fixes.

**Governance status note (Evidence First):** as of this framework, `main`
has ADR-001 through ADR-014 (soon ADR-024, ADR-025 - this pass) merged
and the Architecture Blueprint v1.1 merged/APPROVED/FROZEN (PR #34).
**ADR-022 (Import Platform v2) and ADR-023 (MSEAL Design Framework) are
proposed, not yet merged** (open PRs #36 and #37 respectively, at the
time this framework was written). Every reference to ADR-022/ADR-023
below is written as *"proposed"* for that reason. Update these
references to "Accepted" once those PRs actually merge; don't leave this
note stale.

## Why this framework exists (and what it does not do)

This repository already has strong architecture governance:
`docs/architecture/blueprint/20-ARCHITECTURE-GOVERNANCE.md` defines the
Architecture Baseline, the Architecture Freeze (5 frozen items), the ADR
Process, Architecture Review, and Architecture Approval. **This framework
does not redefine any of that** — it cites 20 as binding and builds the
next layer up: an operating model that also covers domain/data ownership,
capability mapping, cross-cutting decision authority, event/integration/
API governance, documentation policy, AI governance, security boundary,
change management, skill governance, capability dependency, module
maturity, documentation hierarchy, and repository structure — several of
which either don't exist yet as named governance artifacts, or exist only
partially/in a different shape than what this task asks for. Every
document below states explicitly what it extends versus what it
deliberately does not restate.

**Grounding rule applied**: every document in `docs/governance/` was
written only after reading the existing binding document(s) that already
cover adjacent ground (`docs/architecture/blueprint/01, 02, 08, 16, 17,
18, 19, 20`; `docs/architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`;
`docs/architecture/MASP_ENTERPRISE_STANDARD.md`; `docs/standards/*`;
`docs/CORE_DOMAIN_MODEL.md`, `ENTITY_MODEL.md`, `ENTITY_RELATIONSHIP.md`,
`MASTER_DATA.md`, `FUTURE_MODULE_DEPENDENCY.md`; `docs/PERMISSION_MODEL.md`,
`docs/architecture/PERMISSION_MATRIX.md`) — see each document's own
"Relationship to existing documents" section for what was found and how
duplication was avoided.

## Documents in this framework

| Document | Covers | Duplicates? |
|---|---|---|
| `REPOSITORY_POLICY.md` | Public/private, secrets, demo/prod/test data, sample files, Claude Skills, architecture docs, release docs, security rules | New — no prior single repository-governance doc existed |
| `SKILL_GOVERNANCE.md` | Official skills, versioning, ownership, review, deprecation, repository location | New — extends `REPOSITORY_POLICY.md` §4's tracking facts with lifecycle governance neither that document nor any prior one covers |
| `DOMAIN_OWNERSHIP_MATRIX.md` | Owner/status for Machine, Service, Quality, Engineering Intelligence, Reports, Administration, Import Platform, Authentication, Master Data, Timeline, Notifications | Extends 02/17 (bounded contexts + capability map); fills 6 domains 17 doesn't name at all |
| `DATA_OWNERSHIP_MATRIX.md` | Owner Domain/SoT/Consumers/Update Rules/Relationships/Lifecycle for Machine, Customer, Dealer, Warranty, PM, Quality Case, Knowledge Case, PIP, Recall | Extends CORE_DOMAIN_MODEL/ENTITY_MODEL/ENTITY_RELATIONSHIP (Machine/Customer/Dealer only); Warranty/Quality Case/Knowledge Case/PIP/Recall are genuinely new here |
| `CAPABILITY_MAP.md` | Per-domain capability trees (Machine/Dealer/Customer/Service/Quality/Engineering/Administration) | A complementary tree-shaped view over 17's existing flat Capability→Module table — 17 remains authoritative on conflict |
| `CAPABILITY_DEPENDENCY_MAP.md` | Which domain/capability depends on which other (dependency direction, not just ownership) | New axis — neither `CAPABILITY_MAP.md` nor `DOMAIN_OWNERSHIP_MATRIX.md` shows cross-domain dependency; this fills that gap explicitly |
| `MODULE_MATURITY_MATRIX.md` | One consistent maturity scale (Frozen/Production/Partial/Design-only/Not started) across every domain | New — no prior document rates modules on one scale |
| `DECISION_MATRIX.md` | Who has binding decision authority over which concern (Machine Identity, Warranty, Knowledge, Reports, Import, Authentication, etc.) | New axis — `PERMISSION_MODEL.md`/`PERMISSION_MATRIX.md` already cover role×app-permission and role×dealer-scope; this covers decision *authority over the platform itself*, a different question neither answers |
| `EVENT_OWNERSHIP.md` | Canonical events, owners, publishers, consumers, naming, versioning | **Drift resolved this pass** via ADR-025 - see below |
| `INTEGRATION_BOUNDARY.md` | ERP, Dealer Portal, Power BI, Google Sheets, REST API, IoT, Authentication, Email, SMS, future integrations | Extends `docs/architecture/blueprint/19-INTEGRATION-BOUNDARY.md` (frozen) — 19 already covers ERP/Power BI/Dealer Portal/Customer Portal/Technician Mobile; this fills the Sheets/IoT/Auth/Email/SMS gap 19 leaves open, citing 19's frozen rule rather than restating it |
| `API_GOVERNANCE.md` | Naming, versioning, auth, authorization, pagination, filtering, error handling | Thin pointer — `docs/standards/API_STANDARD.md` already fully owns this; adds only the cross-module API deprecation *process* (ties to `CHANGE_MANAGEMENT.md`) |
| `DOCUMENTATION_POLICY.md` | ADR/Architecture/Skills/Design Docs/Release Notes/Roadmap standardization | New — uses the drifts found (duplicate ADR-009 number, now resolved; two disagreeing event catalogs, now resolved) as the evidence for why this policy is needed |
| `DOCUMENTATION_HIERARCHY.md` | Consolidated precedence rules across all 7 documentation layers | New artifact, consolidating precedence clauses already scattered across `PLATFORM_ARCHITECTURE_STANDARDS.md`/`MASP_ENTERPRISE_STANDARD.md`/the blueprint README rather than inventing new precedence rules |
| `AI_GOVERNANCE.md` | AI scope/boundaries, Evidence First, human approval, knowledge confidence, prompt standards, model independence, auditability | Thin pointer — `docs/architecture/blueprint/08-ENGINEERING-INTELLIGENCE-ARCHITECTURE.md` already defines the AI Governance boundary and Confidence Policy as **frozen** (one of 20's 5 frozen items); adds only what 08 explicitly leaves open (Prompt Standards, Model Independence as a named principle) |
| `SECURITY_BOUNDARY.md` | AuthN, AuthZ, dealer scope, audit, PII, email, import, secrets | Thin pointer — `docs/standards/SECURITY_STANDARD.md` already owns authN/authZ/dealer-scope/audit/secrets at rule level; adds a PII classification taxonomy and a security boundary diagram, neither of which exists anywhere today |
| `CHANGE_MANAGEMENT.md` | Breaking change process, architecture review, ADR required, migration, deprecation, versioning | Thin pointer to 20's Breaking Change Process + `GIT_BRANCH_STANDARD.md`'s quality gates; adds data-migration governance and deprecation timelines, neither owned elsewhere |
| `REPOSITORY_STRUCTURE_MAP.md` | Top-level, `src/`, `docs/`, `.claude/` structure with ownership pointers | Extends `CLAUDE.md` §4 (which covers `src/` file-level detail this doesn't repeat) with the top-level map no prior document has |

Plus **`docs/adr/README.md`** (the ADR Index - lives in `docs/adr/`, not
`docs/governance/`, since it indexes the ADRs directly, but is as much a
part of this framework's ADR-normalization guarantee as anything above).

## How to use this framework

1. Before proposing a new module, service, integration, or AI capability,
   check `DECISION_MATRIX.md` for who has authority over that concern,
   `DOMAIN_OWNERSHIP_MATRIX.md`/`CAPABILITY_MAP.md` for where it belongs,
   and `CAPABILITY_DEPENDENCY_MAP.md` for what it would depend on.
2. Before adding a new entity or table, check `DATA_OWNERSHIP_MATRIX.md`
   for its owner domain and update rules.
3. Before emitting a new event, check `EVENT_OWNERSHIP.md`'s mapping
   table (both catalogs, one lookup) before naming it.
4. Before adding an external integration, check `INTEGRATION_BOUNDARY.md`.
5. Before touching AI/Engineering Intelligence, check `AI_GOVERNANCE.md`
   and 08 (frozen) first.
6. Before assuming a document is authoritative over another, check
   `DOCUMENTATION_HIERARCHY.md`.
7. Before creating or changing a `.claude/skills/` entry, check
   `SKILL_GOVERNANCE.md`.
8. Any change matching 20's Architecture Freeze list still goes through
   20's ADR Process unchanged — this framework adds coverage, it does not
   lower that bar.

## Gap Analysis, Governance Roadmap, Technical Debt

See the end of each individual document for its own gaps. Cross-cutting
findings that don't belong to one single document:

### Gap Analysis (cross-cutting)

**Resolved this pass:**

1. ~~Duplicate ADR number~~ - **Resolved.** `ADR-009-Universal-Import-
   Framework.md` renamed to `ADR-024-Universal-Import-Framework.md`
   (`ADR-009-Machine-Domain.md` kept its number - see
   `docs/adr/README.md` for the full reasoning and the one known
   follow-up: PR #36's `ADR-022` still references the old `ADR-009` name
   on its own branch and needs updating before it merges).
2. ~~Two disagreeing event catalogs~~ - **Resolved** via `ADR-025-
   Canonical-Event-Catalog-Consolidation.md` - both catalogs remain,
   reclassified as governing name/ownership (18, frozen, unchanged) vs.
   `event_code`/display metadata (`docs/standards/EVENT_CATALOG.md`,
   now with an explicit mapping table and cross-reference in both
   directions).
3. ~~Repository visibility discrepancy~~ - **Documentation resolved.**
   `CLAUDE.md` now states public, matching verified `gh repo view`
   output, agreeing with `REPOSITORY_POLICY.md`. The separate business
   question ("should it be public") remains the repository owner's open
   decision - not a documentation drift anymore.

**Still open, not resolved by a documentation-only pass:**

4. **Six domains have no capability-map entry at all** in
   `docs/architecture/blueprint/17-BUSINESS-CAPABILITY-MAP.md`:
   Administration, Import Platform, Authentication (present only as
   frozen infrastructure, not a bounded context), Master Data, Timeline
   (present only as a shared component in 02), Notifications (explicitly
   flagged as a gap by 17 itself). `DOMAIN_OWNERSHIP_MATRIX.md` and
   `CAPABILITY_MAP.md` fill this at the governance layer, but 17 itself
   is unchanged (updating it is a Breaking-Change-Process question).
5. **`docs/PERMISSION_MODEL.md`'s six-role target model has never been
   built** — still 4 roles in production. `DECISION_MATRIX.md` builds on
   the *current* 4-role model, not the target 6-role one.
6. **`docs/release/` and `docs/releases/` both exist** - two
   similarly-named directories, likely accidental duplication, found
   while writing `REPOSITORY_STRUCTURE_MAP.md`. Not investigated or
   consolidated in this pass (outside this refinement's named scope) -
   flagged as a real follow-up.
7. **PR #36's `ADR-022-Import-Platform-v2.md` references the old
   `ADR-009` name for the Universal Import Framework.** Cannot be fixed
   from this branch (independent PR) - tracked in `docs/adr/README.md`
   and here as a required action before PR #36 merges.

### Governance Roadmap

1. **Done (this pass, v1.1)**: ADR normalization + index, event catalog
   consolidation (ADR-025), repository-visibility documentation fix,
   Skill Governance, Capability Dependency Map, Module Maturity Matrix,
   Documentation Hierarchy, Repository Structure Map.
2. **Next**: update PR #36's `ADR-022` reference from `ADR-009` to
   `ADR-024` before that PR merges.
3. **Next**: extend `17-BUSINESS-CAPABILITY-MAP.md` itself to include
   the six missing domains - a Breaking-Change-Process item.
4. **Next**: consolidate `docs/release/`/`docs/releases/`.
5. **Later**: decide the repository's intended visibility (business
   decision, not a documentation task).
6. **Later**: once ADR-022/ADR-023 merge, update every "(proposed)" tag
   in this framework to "(accepted)".

### Technical Debt

- No automated check enforces "no duplicate ADR number," "no
  undocumented event," or "no orphaned release-notes directory" today -
  all are review-time, human-caught rules (`DOCUMENTATION_POLICY.md`'s
  verification checklist). A future `npm run architecture`-style check
  could catch the ADR-number case mechanically; not built here (a real
  code change, out of scope for a governance-documentation-only pass).
- This framework's own `DECISION_MATRIX.md` names decision authority by
  *role name* (e.g. "Architecture Owner"), matching 20's own choice not to
  name a specific person/title/team - keep it that way.
- `SKILL_GOVERNANCE.md`'s versioning policy is untested - no skill has
  needed a post-creation revision yet.

## Recommendation

**PASS.** All four governance blockers named for this pass (ADR
duplicate, event catalog drift, repository-visibility drift, missing
skill governance) are resolved, plus four new governance artifacts
added (Capability Dependency Map, Module Maturity Matrix, Documentation
Hierarchy, Repository Structure Map). No existing frozen content was
changed - the ADR rename avoided touching the frozen Machine-Domain ADR
and the event-catalog consolidation added only non-breaking
cross-references to frozen blueprint chapter 18. One new real gap was
found and honestly flagged, not silently fixed (`docs/release`/
`docs/releases` duplication), consistent with this framework's own
practice of surfacing drift rather than hiding it. Ready to merge.
