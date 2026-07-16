# Security Standard

Binding security convention for every current and future MASP module.
Every rule below is written against a real incident or a real pattern
already in production — not a theoretical best practice list.

## Dealer isolation

Two independent layers, both mandatory for every table and every route
that touches business data — this is the single rule most likely to
cause a real cross-tenant data leak if either layer is skipped:

1. **Postgres RLS** on the table.
2. **Application-level scope check**, in two places:
   - **List/search queries**: `applyScope()` (or a module's equivalent)
     adds a `dealer_id`/`created_by` filter to every query, in addition to
     RLS (`src/lib/db.ts`).
   - **Single-record read/write/delete routes** (`GET`/`PUT`/`DELETE
     /api/<module>/[id]`): after loading the record, explicitly compare
     `record.dealer_id !== session.dealerId` (when `session.dealerId` is
     set — central roles have `null` and see all dealers) and return 403
     if it doesn't match, **before** performing the read or mutation.

The second bullet is not automatically covered by having the first —
this was a real bug found and fixed in Release 1.0: PM's list/export
routes had the dealer-scope check, but the single-record
`GET`/`PUT`/`DELETE /api/pm-records/[id]` route did not, letting any
authenticated user view/edit/delete another dealer's record by guessing
its UUID. Every new module's single-record CRUD routes must include this
check from the start, with a test for it (see `TESTING_STANDARD.md`).

## Role-based access control

- Exactly four roles exist today: `SuperAdmin` > `CentralAdmin` >
  `DealerAdmin` > `DealerUser` (`src/lib/scope.ts`'s `Role` type). A new
  module does not invent a fifth role or a parallel permission system —
  if a genuinely new role is needed, that's a decision for `Role` itself
  (see `docs/PERMISSION_MODEL.md`'s forward-looking `Technician`/`Viewer`
  proposal), not a module-local workaround.
- Every role check goes through a named predicate in `src/lib/scope.ts`
  (`canDelete`, `canExport`, `canUpdateStatus`, `seesAllDealers`,
  `seesOwnRecordsOnly`, ...) — never an inline
  `if (session.role === 'DealerAdmin')` scattered through a route or
  page. A new module adds its own predicates to `scope.ts` if it needs a
  permission shape none of the existing ones cover (e.g. PM's
  `canForceDelete` == `SuperAdmin`-only override of a locked record).
- A permission gate exists twice, independently, for every action: once
  in the page/component (hides the button — UX only, not enforcement),
  and once in the API route (rejects the request — the layer that
  actually matters). Deleting the UI gate must never be the only thing
  standing between a role and an action it shouldn't be able to take.

## Application-layer authorization (why RLS alone is never the gate)

This app has no Supabase Auth. It authenticates with its own JWT
(`lib/auth.ts`) and always connects to Supabase using a single `anon`
key/role, regardless of whether the human on the other end is a
SuperAdmin or a DealerUser — Postgres RLS has no way to see "this request
is from a SuperAdmin," only "this is the `anon` role." Consequently:

- **Every role-based permission boundary in this codebase is an
  application-layer control, not an RLS control.** `canDelete()`,
  `canManageUsers()`, `canExport()`, and `canManageEmailHealth()`
  (`seesAllDealers`-only) are all enforced exclusively in application
  code: a role check in the API route before any database access, plus a
  hidden/absent UI entry for every other role. RLS on the tables these
  features touch stays permissive for the `anon` role (matching every
  other table in the app), not narrowed per-feature. (`canManageLegacyImport()`
  was a prior example of this pattern - retired with NTR Legacy Import,
  ADR-038, 2026-07-16.)
- **This is an intentional architectural decision for MASP v1.x, not a
  security omission.** Building true DB-level role enforcement would
  require either a second, more restricted Supabase key/role this app
  doesn't have today, or adopting Supabase Auth outright — both are
  platform-architecture changes, not something a single module (or this
  standard) introduces unilaterally. A new module's SuperAdmin-only (or
  any other role-restricted) feature follows this same shape: hide the
  nav entry, gate the page, gate every route, and do not attempt to
  invent a stronger DB-level guarantee for just that one feature — a
  different authorization model for one table, while every other table
  in the app is permissive-at-RLS, would be inconsistent, not more
  secure, and would violate `MODULE_DEVELOPMENT_STANDARD.md`'s "reuse the
  existing platform pattern" rule.
- If the platform ever adopts Supabase Auth or a scoped service-role key,
  this section (and the RLS policies on every existing table) need a
  coordinated revisit — not a per-module patch.

### Navigation visibility is not an authorization boundary

**Capability visibility is NOT authorization. Server-side RBAC remains
the security boundary.** Navigation shows or hides a leaf based on that
capability's `CapabilityStatus`, purely as a UX decision about what to
present — it is never, on its own, what stands between a role and an
action. **Unfinished capabilities are visible only to SuperAdmin** (`docs/
architecture/MSEAL_DESIGN_FRAMEWORK.md` §2c, `navConfig.ts`'s
`isCapabilityVisible()`): every non-`ACTIVE` nav leaf (Coming Soon/
Preview/Beta/Development) is hidden entirely from every role except
SuperAdmin, rather than shown as a disabled placeholder. This is a UX
rule about which *placeholders* a role sees, not a new authorization
control — every gated leaf has `href: null`, so there is no real route
being newly protected by it, and the rule does not replace or weaken any
existing route-level check. A real, built route's own `lib/scope.ts`
predicate remains the only thing that actually authorizes access to it,
enforced server-side exactly as described above, regardless of whether
the current nav shows or hides the leaf pointing to it. Do not treat
"hidden from the nav because it isn't `ACTIVE` yet" as a substitute for a
real permission predicate once a capability's route is actually built —
at that point it becomes `ACTIVE` and needs its own `lib/scope.ts` gate
like every other real route, the same two-layer pattern (hidden nav entry
+ server-side route check) every other permission boundary in this app
already uses.

## Server-side authorization

- Every mutating route calls `getSession()` first and returns 401 if
  null, before touching any other logic.
- Every mutating route re-resolves ownership fields (`dealer_id`,
  `branch_id`, `technician_id`) from the session/existing record
  server-side — never trusts a client-sent `dealer_id` in a create/update
  body, even from an otherwise-authenticated request (the existing
  "zero-leakage" pattern in `createRecord()`/`updateRecord()`).
- A lock/state-machine guard (PM's calculation-protection lock, MQR's
  status-transition graph) is enforced in the Service layer, not the
  route or the client — the route calls the service and surfaces
  whatever error type the service throws; it does not duplicate the
  guard's condition itself.

## Input validation

- Every request body is validated against a zod schema server-side,
  regardless of what client-side form validation already checked (see
  `API_STANDARD.md` §Validation). A route that trusts client validation
  alone is not "faster," it's a bypassable one.
- Free-text search input is stripped of characters that are meaningful to
  the query builder (`%`, `,` for `.ilike`/`.or()`) before being
  interpolated into a filter string (`src/lib/db.ts`'s existing pattern).
- Numeric/date fields are validated for real range/format constraints
  server-side (hour meter ≥ 0, valid latitude/longitude ranges, a Thai
  phone number matching `^0\d{9}$`) — not just "is this present."

## Upload validation

- All attachment upload goes through the existing size-routed pipeline:
  ≤4MB via `/api/upload` (direct proxy, HEIC→JPEG conversion
  server-side); >4MB via `/api/upload/init` → chunked
  `/api/upload/chunk` → `/api/upload/finalize` (server-to-server Drive
  relay). A new module does not implement a parallel upload path, and
  does not attempt a direct browser→Drive PUT (Google Drive's resumable
  endpoint sends no CORS headers; this was tried and fails — see root
  `CLAUDE.md` §8.2).
- File type is validated server-side, not by trusting the `accept`
  attribute or client-declared MIME type alone (client-bypassable).
- The chunk-relay route validates that the session URL it's asked to
  relay to actually starts with `https://www.googleapis.com/upload/drive/`
  before forwarding any data to it.

## Attachment access

- A generated Drive share link is public-viewable-but-not-editable
  (`finalize`'s permission call), never public-editable, and never
  requires the viewer to be signed into the app's own Google account.
- An attachment URL is never guessable from the record id alone in a way
  that would let someone enumerate a dealer's attachments — Drive file
  IDs are opaque; a module does not construct a predictable filename/path
  scheme that defeats that (see `docs/NAMING_STANDARD.md`'s
  `<record-id>_<category>_<timestamp>.<ext>` convention — descriptive,
  but the underlying Drive file id, not the filename, is what gates
  access).

## Google Drive integration

- OAuth2 real-account client (not a service account) is the standing
  architecture decision (`docs/adr/ADR-002-Google-Drive.md`) — a new
  module reuses the existing Drive integration (`src/lib/googleDrive.ts`)
  rather than provisioning a separate Drive credential.
- Refresh tokens and client secrets are environment variables, never
  committed, never entered into a command/field/prompt even when
  explicitly supplied by a user — see `.claude/rules/03-data-access-security.md`.

## Audit logging

- Every create/update/delete/lock-state-change is logged via the shared
  `logAuditEvent()`/`logAuditEvents()`/`diffFieldsForAudit()` helpers
  (`src/lib/db.ts`), tagged with the module's own `module` string — a new
  module does not build its own audit table or logging mechanism.
- The audit log records *who* (`performedBy`, the session username, never
  a client-supplied actor name) and *when* (server clock, stored UTC,
  displayed via `formatThaiDateTime()`), never trusting a client-supplied
  timestamp or actor identity.
- A lock/unlock/override event (PM's `Locked`/`Unlocked` events) is
  logged even when it doesn't change a business field — the audit trail
  must be able to answer "who unlocked this and when," not just "what
  fields changed."

## Verification

Documentation only. Does not modify `src/lib/scope.ts`, any RLS policy,
any route, or any existing permission check.
