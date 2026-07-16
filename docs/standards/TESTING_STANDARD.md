# Testing Standard

Binding testing convention for every current and future MASP module.
Grounded in the actual test setup (`vitest.config.ts`, Node environment,
`src/**/*.test.ts`, 21 test files / 228 tests as of Release 1.0) — this
document formalizes the pattern already in use, it does not propose a new
framework.

## Framework and layout

- **Vitest**, Node environment, run via `node
  ".\node_modules\vitest\vitest.mjs" run` (the `npm run test` script
  breaks on this project's path containing `&` — see root `CLAUDE.md`'s
  known Windows/PowerShell gotcha; use the direct invocation in any
  script or CI config for this repo).
- Test files live beside the code they test, named `<file>.test.ts` (e.g.
  `src/app/api/pm-records/[id]/route.test.ts` next to `route.ts`) — not a
  separate parallel `tests/` tree.
- `vi.mock()` the module boundary just outside what's under test — API
  route tests mock `@/lib/auth` (`getSession`) and the repository class
  (`SupabaseMaintenanceRepository`), never a real Supabase connection.
  `@/lib/db`'s audit-writing functions (`logAuditEvent`/`logAuditEvents`)
  are stubbed via `importOriginal` + partial override so the rest of
  `db.ts`'s real logic (scope predicates, filter-building) still runs
  under test.

## Unit tests

Cover pure logic in isolation: validation schemas, lock/due/health-engine
calculators, audit-diff builders, permission predicates in
`src/lib/scope.ts`. A pure function (`evaluateMaintenanceLock()`,
`touchesLockAffectingFields()`) gets a unit test per branch/edge case
(locked vs. unlocked, each lock reason, boundary of the 24h window) — not
just a single happy-path case.

## Integration tests

Cover a full API route handler (`GET`/`PUT`/`DELETE` exported from
`route.ts`), invoked with a real `NextRequest`, against a mocked
repository — this is the `route.test.ts` pattern already established for
PM. Every mutating route's integration test suite covers, at minimum:

- 401 when no session.
- 200/expected-shape on the success path, asserting both the response
  body and the exact arguments the repository/service was called with.
- 404 when the target record doesn't exist (or is soft-deleted — the two
  must be indistinguishable to the caller, see `API_STANDARD.md`).
- 400 / `VALIDATION_ERROR` for a schema-rejected body.

## Security tests

Every route that reads or mutates a single record by id has an explicit
test asserting a session from a **different dealer** gets 403, not just a
test that a same-dealer session succeeds. This is not optional coverage —
it is the regression test for the exact class of bug found in PM's
single-record route during the Release 1.0 acceptance sprint (dealer-scope
check present on list/export, missing on `GET`/`PUT`/`DELETE
/api/pm-records/[id]`). The reference pattern (two sessions, same fixture
record, asserting 403 and that the repository mutation method was never
called) is in `src/app/api/pm-records/[id]/route.test.ts`.

## Permission tests

Every route gated by a `scope.ts` predicate (`canDelete`, `canExport`,
`canUpdateStatus`, ...) has a test asserting the role the predicate
excludes gets 403 and the underlying mutation never runs — not just that
the allowed role succeeds. Use two fixture sessions per test file (one
permitted, one excluded) rather than restating the same session inline
in every test.

## Regression tests

A bug fixed in production gets a test that would have caught it, added in
the same change that fixes it — not as separate follow-up work. The
IDOR/delete-permission fixes in Release 1.0 are the concrete precedent:
the fix and its four regression tests (cross-tenant 403 on
GET/PUT/DELETE, DealerUser-403 on delete) landed in the same commit.

## Coverage requirements

No numeric coverage threshold is enforced by tooling today (no
`coverage` config in `vitest.config.ts`). The practical bar, applied by
review rather than a gate, is: every mutating API route has at least one
test per status code it can return (200/401/403/404/400/409/500-worthy
paths that are actually reachable), and every non-trivial pure function
has at least one test per logical branch. A module is not "tested" if it
only has a single happy-path test per route.

## Quality gate

Per `GIT_BRANCH_STANDARD.md`'s Quality Gates: `tsc --noEmit`, `next lint`,
`next build`, and `vitest run` all pass clean (0 type errors, 0 lint
errors — pre-existing warnings are tracked, not silently added to) before
a PR merges. A red test suite or a new type error blocks merge; it is not
waived "to save time."

## Verification

Documentation only. Does not add, modify, or run any test.
