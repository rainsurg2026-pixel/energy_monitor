# 11 — Database & API Evolution Strategy

**No migration runs as part of this PR.** Every table below is a
proposal for a *future* phase (13) to implement, following this
strategy's rules — not a schema this PR applies.

## Database Evolution Strategy

### Rule 1: Additive only, always

Every table this blueprint proposes (`inspections`, `knowledge_cases`,
`pip_records`, `machine_ownership_history`) is a **new** table. Nothing
proposes altering or dropping an existing column, matching the exact
discipline every migration in this repo's history already follows
(`add_users_auth_hardening_columns`, `create_user_sessions`, etc. — see
`docs/adr/ADR-014-Authentication-Platform-v3.md` for the most recent
example of this pattern applied at scale).

### Rule 2: No existing table is renamed

`vehicles` stays `vehicles`. `records`/`pm_records`/`ntr_records` stay as
they are. This is not a compromise — ADR-009 already made this exact
decision for the Machine rename and it cost nothing: a facade layer
(`features/machine/`) gets 100% of the naming benefit at a fraction of
the regression risk of renaming live tables. Every future domain in this
blueprint follows the same rule.

### Rule 3: `AuditModule` and equivalent unions are additive-only

```ts
// Today:
type AuditModule = 'mqr' | 'pm' | 'ntr';

// Target (additive, not a breaking change to any existing row):
type AuditModule = 'mqr' | 'pm' | 'ntr' | 'inspection' | 'pip' | 'machine';
```

Every existing `record_audit_log` row with `module = 'mqr'` remains
valid forever — adding a union member never invalidates existing data,
matching how `ActivityEventType`/`AuthAuditEventType` were both
explicitly designed to be additive-only in the two most recent platform
builds.

### Rule 4: Machine identity — `serial` today, `machine_id` as an alias, not a replacement

Every proposed table above references a Machine via `machine_id`. Rather
than requiring every existing table to gain a new `machine_id` column
immediately, the pragmatic path is:

- New tables (`inspections`, etc.) use `machine_id uuid references
  vehicles(id)` — Postgres already supports this today, `vehicles.id` is
  already a real primary key.
- `serial` remains the human-facing/search identifier everywhere it is
  today (URLs, search boxes) — this blueprint does not propose changing
  `/vehicles/[serial]` to `/vehicles/[id]`.
- No existing table needs to change to support this — it's purely how
  *new* tables reference Machine.

### Proposed new tables (summary — full shapes in 04, 07, 05)

| Table | Domain | Introduced in |
|---|---|---|
| `inspections` | Inspection | 04 |
| `knowledge_cases` | Knowledge | 07 |
| `pip_records` | Quality (PIP) | 05 |
| `machine_ownership_history` | Machine (Ownership) | 02 |

### RLS / access model

Every new table follows the same permissive-anon + application-layer
enforcement model already established platform-wide
(`docs/standards/SECURITY_STANDARD.md`) — no new authorization paradigm.
`DealerBranchScope` (frozen platform layer) continues to be the one
dealer/branch scoping mechanism new tables integrate with, exactly as
NTR/PM did.

## API Evolution Strategy

### Rule 1: No existing route's contract changes

Every existing `/api/records`, `/api/pm-records`, `/api/ntr-records`,
`/api/auth/*` route keeps its current request/response shape. New
domains get **new** routes (`/api/inspections`, `/api/knowledge`,
`/api/pip`), never a v2 of an existing one, matching this platform's
"reuse the existing audit log, don't duplicate" instinct applied to APIs
instead of tables.

### Rule 2: Thin controllers, service owns logic (already the convention)

Every new route is a thin Next.js Route Handler calling a service
(`InspectionService`, `KnowledgeService`, `PipService`,
`EngineeringIntelligenceService`, `AnalyticsService`) — the exact convention
Authentication Platform v3.0 just re-established at scale
(`authServices/*`, thin `/api/auth/*` routes). No new architectural
pattern is introduced; this blueprint's job is to keep applying the one
that already works.

### Rule 3: Cross-domain reads are services calling services, never a route calling another route

The Machine Digital Passport (10) needs data from Inspection, Knowledge,
PIP, Engineering Intelligence simultaneously. That composition happens in
`MachineService` (a service calling other services in-process), never in
an API route that internally issues HTTP requests to other API routes on
the same app — consistent with `MachineService.getMachineAttachments()`
today.

### Rule 4: A generic Activity/Event read API is deferred until proven necessary

The Activity Timeline platform's own architecture doc already names
this fork: "If a future module's activity volume ever outgrows 'fetch
everything, filter client-side'... the generic shape this document
describes is exactly what a future paginated `GET /api/activity?...`
route would return." This blueprint inherits that same deferred
decision — build the generic *event shape* now (06), add the generic
*read API* only once Machine Profile's aggregation needs actually exceed
what per-domain service calls can efficiently provide.

## What changes vs. what doesn't (summary table)

| | Changes in this blueprint? |
|---|---|
| Existing table names | No |
| Existing table columns | No |
| Existing API contracts | No |
| Existing module code (`features/vehicle`, `features/ntr`, etc.) | No |
| New tables | Yes — additive only, per Rule 1 |
| New API routes | Yes — new domains only |
| New enum/union members (`AuditModule`, etc.) | Yes — additive only, per Rule 3 |
