# API Standard

Binding convention for every Next.js App Router API route in MASP, current
and future. Grounded in the actual production routes under
`src/app/api/records/`, `src/app/api/pm-records/`, and `src/app/api/admin/*`
— not a green-field proposal.

## Response envelope

Every route returns exactly one of two shapes:

```ts
// success
{ ok: true, data: T }

// failure
{ ok: false, error: { code: string; message: string } }
```

`code` is a stable, machine-checkable string (`UNAUTHORIZED`, `FORBIDDEN`,
`NOT_FOUND`, `VALIDATION_ERROR`, `LOCKED`, `INTERNAL_ERROR`, ...) that a
caller can `switch`/`instanceof`-style branch on without parsing
`message`. `message` is the localized, human-readable string (via
`translate(locale, key)`) shown to the user through `swal.ts`.

**Known exception, not a pattern to copy:** MQR's original routes
(`src/app/api/records/[jobId]/route.ts` and siblings) predate this
convention and return a flatter `{ ok: false, error: string }` (no `code`,
`data` returned as a bare top-level field instead of nested under `data`).
This is grandfathered — do not touch it opportunistically — but no new
route, in any module, uses the flat shape. PM's routes
(`src/app/api/pm-records/[id]/route.ts`) are the shape to copy.

## Request

- `Content-Type: application/json` for all mutating requests; a route
  parses the body once, catches JSON-parse failure explicitly, and
  returns `VALIDATION_ERROR` with a localized message rather than letting
  an unhandled exception fall through to a generic 500.
- Every mutating field a client can set is re-validated server-side via a
  zod schema built as a function of `locale` (see
  `src/features/maintenance/schemas/index.ts`) — never trusted from the
  request body without a schema pass, even if the client's own form
  already validated it.
- Fields the server must own (id, `dealer_id` when resolvable from
  session, generated report numbers, audit fields) are never accepted
  from the request body even if present — resolve them server-side from
  `getSession()`/the existing record, silently ignoring any client-sent
  value for them.

## Response — pagination

List endpoints that can return more than the module's session-scoped
active-record count must paginate, not `.limit(500)` silently
(`listRecordsPaginated()` in `src/lib/db.ts` is the reference — it
replaced exactly that bug in MQR). Shape:

```ts
{ ok: true, data: { records: T[]; total: number; page: number; pageSize: number } }
```

`page` is 1-based. `pageSize` is server-clamped to a sane range (MQR/PM
use `[1, 200]`, default 50) — never trust a client-supplied `pageSize`
without clamping it.

A route that genuinely needs the *entire* matching set regardless of size
(bulk export) may skip pagination but must still cap total rows
(`listRecords()`'s `.limit(500)`) and, per `MODULE_DEVELOPMENT_STANDARD.md`
§Search, must accept exactly the same filter parameters as the paginated
list endpoint it's exporting — a new module's export route is not allowed
to silently support a narrower filter set than its own list view (this
was a real MQR defect: date-range filtering existed on `/records` but was
dropped on export until it was fixed to reuse `listRecords()`'s filters).

## Sorting

Default sort is the module's natural recency order (`created_at desc` /
`performed_date desc`) applied via `.order()` in the repository/query
layer, not client-side. A module that needs user-selectable sort exposes
it as an explicit, allow-listed `sortField`/`sortDir` query param pair —
never pass a raw client string into `.order()`.

## Filtering

Every filter field accepted by a list/export endpoint is applied inside
the same query-building function used by both the paginated list and its
export sibling (see `MODULE_DEVELOPMENT_STANDARD.md` §Search) — not two
independently-maintained filter-application code paths that can drift out
of sync. Free-text search (`q`) is matched via `.ilike` across an
explicit, documented column list; user input is stripped of `%`/`,`
before being interpolated into an `.or()` filter string (see
`src/lib/db.ts`'s `listRecords()`/`listRecordsPaginated()`).

## Error response

| HTTP status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed JSON, or a zod schema failure |
| 401 | `UNAUTHORIZED` | No valid session (`getSession()` returned null) |
| 403 | `FORBIDDEN` | Valid session, but role or dealer-scope check failed |
| 404 | `NOT_FOUND` | Record doesn't exist, or is soft-deleted (indistinguishable from a caller's point of view — a second delete on an already-deleted record returns the same 404 as a nonexistent id, not a different "already deleted" error) |
| 409 | `LOCKED` | A module-specific state conflict (e.g. PM's calculation-protection lock) |
| 500 | `INTERNAL_ERROR` | Anything unexpected — always `console.error`'d server-side first, and the client message is a generic localized string, never a raw stack trace or driver error |

## Validation

See `MODULE_DEVELOPMENT_STANDARD.md` §Validation. In short: one zod
schema per request body shape, `.partial()` for update bodies so an
absent key means "don't touch this field" (distinct from an explicit
`null`, which means "clear it") — see the `nullableTrimmedString`
preprocessor pattern in `src/features/maintenance/schemas/index.ts` for
why this distinction has to be preserved through the preprocessing step.

## Authentication

Every route calls `getSession()` (`src/lib/auth.ts`) as its first line and
returns 401 immediately if it's null. No route trusts a client-supplied
identity claim (header, body field) in place of the session.

## Authorization

Every route re-checks role (`src/lib/scope.ts` predicates) and dealer
scope (`record.dealer_id !== session.dealerId` → 403) after loading the
target record and before performing the mutation — see
`SECURITY_STANDARD.md` for the full pattern and the cross-tenant IDOR
class of bug this exists to prevent.

## Versioning

MASP does not version its API today (no `/api/v1/`) and does not
introduce one speculatively. If a genuinely breaking change to an
existing route's request/response shape becomes necessary, it is
introduced as a new route (`/api/records/export-v2` style) rather than a
version prefix, and the old route is deprecated on an explicit timeline
documented in that module's own doc — not silently changed under callers.

## Verification

Documentation only. Does not modify any existing route.
