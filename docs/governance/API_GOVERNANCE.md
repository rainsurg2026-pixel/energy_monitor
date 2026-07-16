# API Governance

## Relationship to existing documents

`docs/standards/API_STANDARD.md` (binding - "a binding convention... not
a green-field proposal") already fully covers everything this section
title lists:

- **Naming/Response envelope**: `{ ok: true, data: T }` / `{ ok: false,
  error: { code, message } }`, with one documented grandfathered
  exception (MQR's flat shape).
- **Versioning**: explicit - "MASP does not version its API today...
  does not introduce one speculatively"; breaking changes become new
  routes, never a version prefix.
- **Authentication**: `getSession()` first line of every route, 401 if
  null.
- **Authorization**: role + dealer-scope re-check after load, before
  mutation (points to `SECURITY_STANDARD.md`).
- **Pagination**: `{ records, total, page, pageSize }`, 1-based page,
  `pageSize` clamped `[1,200]` default 50.
- **Filtering**: one shared query-building function reused by list +
  export, `.ilike` free-text stripped of `%`/`,`.
- **Error Handling**: a full HTTP-status × `code` × condition table
  (400/401/403/404/409/500).

**This document does not restate any of the above - `API_STANDARD.md` is
the single source of truth for it.** This document exists only to add
the one thing neither `API_STANDARD.md` nor `20-ARCHITECTURE-GOVERNANCE.md`
covers: what happens to an API route over time (deprecation), and how a
governance framework classifies an API change for `DECISION_MATRIX.md`
purposes.

## What this document adds

### API change classification (ties to `DECISION_MATRIX.md`)

| Change | Classification |
|---|---|
| New route, new field on an existing response (additive) | Domain-local - the owning module's own decision, must still conform to `API_STANDARD.md`'s envelope/pagination/error rules |
| Changing an existing field's meaning or removing a field | Breaking - new route per `API_STANDARD.md`'s no-versioning rule, plus a deprecation notice (below) on the old one |
| A new response envelope shape not covered by `API_STANDARD.md` | Cross-cutting - `API_STANDARD.md` itself would need updating, which is a documentation change to a binding standard and should go through the same review weight as any other binding-standard change |

### API deprecation process (new - neither `API_STANDARD.md` nor 20 states one)

Since this platform does not version its API (`API_STANDARD.md`'s
explicit choice), "deprecating" a route means: the old route keeps
working, unchanged, while the new one is the documented path forward,
until every known caller has migrated. Concretely:

1. The replacement route ships first, fully working, documented.
2. The old route is marked deprecated in its own code comment (this
   repository's existing convention for flagging superseded code -e.g.
   `ADR-011`'s v1→v2 Address Platform migration kept the old repository
   method working while the new one became the real path).
3. The old route is removed only once `docs/ROADMAP.md` or the relevant
   ADR records that every known caller (internal UI, any external
   integration per `INTEGRATION_BOUNDARY.md`) has migrated - never
   removed speculatively "because nothing should be using it anymore"
   without that confirmation.
4. See `CHANGE_MANAGEMENT.md` for the general deprecation-timeline rule
   this is one instance of.

## Gap Analysis

- No route in this codebase has ever needed to go through a real
  deprecation cycle yet (confirmed by `API_STANDARD.md`'s own framing -
  breaking changes have so far always been new routes, with the old one
  presumably still present) - this process is proposed, not
  battle-tested.
- `API_STANDARD.md`'s one grandfathered exception (MQR's flat response
  shape) is itself technical debt already named in that document - not
  repeated in detail here, just cross-referenced.
