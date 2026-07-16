# Decision Matrix

## Relationship to existing documents

This is a different axis from two documents that already look similar:

- `docs/PERMISSION_MODEL.md` / `docs/architecture/PERMISSION_MATRIX.md`
  answer **"which application role can perform which action on which
  record"** (Create/Read/Update/Delete/Approve/Export, dealer/branch
  scope). That is an **application permission** question.
- This document answers **"which domain/layer has the authority to
  decide how a concern is designed or changed"** - a **platform decision
  authority** question. A DealerAdmin's CRUD permissions and "who decides
  how Warranty's data model works" are unrelated questions; conflating
  them would misuse both existing documents.

`docs/architecture/blueprint/20-ARCHITECTURE-GOVERNANCE.md` already
states, and this document does not re-decide: *"Architecture Approval
rests with whoever owns this repository's architecture decisions today
... this document does not invent a new role or committee."* This matrix
does not name a person, title, or committee either - it only classifies
**which concerns are domain-local (a domain's own maintainers can decide
non-breaking changes without invoking full Architecture Review) versus
cross-cutting or platform-level (any change, however small it looks,
should go through 20's Architecture Review since it affects more than
one domain by definition).**

## Matrix

| Concern | Owning Domain / Layer | Decision Scope | Escalates to Architecture Review (20) when |
|---|---|---|---|
| **Machine Identity** (serial/engine number resolution, dedup rules) | Machine Domain | Domain-local | The identity model itself changes (e.g. a new identity key beyond serial/engine number) - covered by 20's Freeze item "Machine as aggregate root" |
| **Warranty** (eligibility calculation, claim workflow) | Service | Domain-local | A Warranty change touches Machine's own fields (e.g. a new `vehicles` column) or crosses into Quality's MQR warranty determination |
| **Knowledge** (case model, confidence computation) | Engineering Intelligence (consumer) / Knowledge domain (owner, 07) | Domain-local for internal Knowledge mechanics; cross-cutting for anything AI-facing | Any change to the AI Governance boundary or Confidence Policy (08) - both are frozen per 20, always full ADR process, no exception |
| **Reports** | Cross-cutting | Cross-cutting by definition (Reports has no data of its own - every change reads from another domain) | Always, if the change adds a new data dependency on a domain not already read from |
| **Import (Platform)** | Platform (Import Platform service, `src/shared/import/`) | Platform-level | A new module adopts the framework (domain-local for that module integrating) vs. the framework's own contract changes (platform-level, needs review since every adopting module is affected) |
| **Authentication** | Platform (frozen, Foundation Freeze) | Platform-level, frozen | Any change at all - Authentication is in `PLATFORM_ARCHITECTURE_STANDARDS.md`'s Foundation Freeze; modification requires the same 4-condition bar (defect/security/performance/approved ADR) every frozen layer requires |
| **Quality Case lifecycle** (status model) | Quality Domain | Domain-local | The status model change affects Knowledge extraction (Principle 3, blueprint 01) or the Canonical Event Catalog (18, frozen) |
| **Master Data** (new master-data type, e.g. a new lookup table) | Platform (frozen, Foundation Freeze) | Platform-level, frozen | Always - Master Data is a Foundation Freeze item; a new master-data type is exactly the kind of "speculative new field" the Evolution Rule warns against unless a real module needs it |
| **API shape** (new endpoint, response envelope) | The owning business module/platform service | Domain-local, but must conform to `docs/standards/API_STANDARD.md` (binding) | The change would require a new response envelope shape or versioning scheme not already covered by `API_STANDARD.md` - see `API_GOVERNANCE.md` |
| **Security boundary** (a new authZ predicate, a new PII field) | Cross-cutting (every domain enforces the same `scope.ts` predicates) | Cross-cutting | Always, per `docs/standards/SECURITY_STANDARD.md`'s existing rule that every role-based boundary is application-layer and must be reviewed the same as a correctness bug |
| **Event naming/ownership** | Cross-cutting (18's Canonical Event Catalog, frozen) | Cross-cutting, frozen | Always - event ownership is one of 20's 5 Freeze items; a new event type needs an ADR even if it looks additive |
| **Integration (new external system)** | Platform (Integration Boundary, 19, frozen) | Platform-level, frozen | Always - "no external system reads internal tables directly" is a frozen rule (20); any new integration is reviewed against it, never assumed additive |

## How to read "Domain-local"

"Domain-local" does **not** mean unreviewed - every PR still goes through
this repository's existing code-review and quality-gate process
(`docs/standards/GIT_BRANCH_STANDARD.md`'s 8-step gate). It means: the
change does not, by itself, require invoking 20's full Architecture
Review + Architecture Approval ceremony, because it doesn't touch a
Freeze item and doesn't cross a domain boundary. The moment a change
would touch another domain's aggregate, a frozen item, or a cross-cutting
concern, it escalates - regardless of how the original author scoped
their PR.

## Gap Analysis

- This matrix names 12 concerns, chosen to match the task's own examples
  plus enough coverage to be useful; it is not exhaustive. A concern not
  listed here defaults to: if it touches a Freeze item (20) or a Frozen
  Foundation layer (`PLATFORM_ARCHITECTURE_STANDARDS.md`), treat it as platform
  -level; otherwise, ask whoever owns the domain it most resembles above.
- "Reports" and "Import Platform" both being simultaneously "cross
  -cutting"/"platform-level" is intentional, not an error - see
  `DOMAIN_OWNERSHIP_MATRIX.md`'s ownership rules for why both categories
  exist and how they differ (a cross-cutting capability owns no data; a
  platform-level layer is a shared dependency other domains call through).
