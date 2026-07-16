# Permission Matrix

The current, verified authorization model — what each role can see, the
mechanism that enforces it, and where that's tested. Companion to
`docs/adr/ADR-013-Authorization-Scope.md` (the v2.3.2 fix this matrix
documents) and `docs/OPERATIONS.md` §8 (Security overview). Update this
document whenever a new module or route changes dealer/branch scoping —
per the roadmap's Working Rule 10.

Distinct from `docs/PERMISSION_MODEL.md`, which describes a **target**,
not-yet-built six-role model — this document describes the **actual,
current** four-role model in production.

## Roles

| Role | Dealer scope | Branch scope |
|---|---|---|
| `SuperAdmin` | Unrestricted — sees every dealer | Unrestricted — sees every branch |
| `CentralAdmin` | Unrestricted — sees every dealer | Unrestricted — sees every branch |
| `DealerAdmin` | Pinned to their own dealer | Unrestricted within their dealer — sees every branch in it |
| `DealerUser` | Pinned to their own dealer | Pinned to their own branch — a service branch is a team, every `DealerUser` in it shares the same visibility |

`seesAllDealers(role)` (`lib/scope.ts`) is the single predicate for the
first column — `SuperAdmin`/`CentralAdmin` only. Every dealer-scoping
mechanism in this app must check this predicate (directly, or via
`AuthorizationScope.unrestricted`/`resolveDealerScope()`) before comparing
a session's dealer against a record's — comparing raw IDs without this
check is exactly the bug class ADR-013 fixes.

## AuthorizationScope

The reusable, already-resolved authorization result data-access functions
consume instead of a `SessionUser` (`lib/dealerBranchScope.ts`):

```ts
export interface AuthorizationScope {
  dealerId: string | null;
  unrestricted: boolean;
}
```

- `unrestricted: true` — dealer filtering must be skipped **entirely**.
  Never compare `dealerId` when this is true; `dealerId` may itself be
  non-null (e.g. a SuperAdmin's own dealer) and is irrelevant in that case.
- `unrestricted: false` — `dealerId` is the exact dealer this scope is
  pinned to; filter strictly by equality.

`UNRESTRICTED_SCOPE = { dealerId: null, unrestricted: true }` is the
shared constant for a deliberately unscoped lookup (an existence-only
check where the caller applies its own scope elsewhere).

## `resolveDealerScope()` — dealer filtering flow

```
resolveDealerScope(session, requestedDealerId?)
        │
        ▼
  seesAllDealers(session.role)?
        │
   ┌────┴────┐
  yes         no
   │           │
   ▼           ▼
{ dealerId: requestedDealerId ?? null,   { dealerId: session.dealerId,
  unrestricted: true }                     unrestricted: false }
```

A privileged role gets whatever dealer it explicitly requested (or `null`
= "all dealers"); every other role is always pinned to their own session
dealer, regardless of what was requested — a non-privileged session's
`requestedDealerId` is never trusted.

## Permission evaluation sequence (for a single-record read)

1. `getSession()` — resolve the caller's session (401 if none).
2. `resolveDealerScope(session, requestedDealerId)` → `AuthorizationScope`.
3. Pass the **scope**, not the session, into the data-access function
   (`getVehicleBySerial(serial, scope)`, or `applyScope(query, session, ...)`
   for the list-query helpers that still take `session` directly — see
   "Two enforcement mechanisms" below).
4. The data-access function checks `scope.unrestricted` first:
   - `true` → return the record unconditionally (subject to it existing).
   - `false` → compare `scope.dealerId` against the record's own
     `dealer_id`; mismatch → `null`/excluded, never partial data.
5. For branch-level single-record access (`canAccessDealerBranch`), the
   same sequence applies one level down: dealer must match (or be
   unrestricted), then a `DealerUser`'s `session.branchId` must exactly
   equal the record's `branch_id` — fail-closed when `session.branchId`
   is `null` (not yet assigned), never fail-open.

## Two enforcement mechanisms in this codebase (both correct, verified this review)

1. **`AuthorizationScope`-consuming functions** — `getVehicleBySerial()`
   (fixed in ADR-013). Caller resolves scope once, passes the scope object.
2. **`applyScope(query, session, requested)`** (`lib/db.ts`) — used by
   every list/history query (NTR, PM, MQR, dashboard). Internally calls
   `resolveDealerScope`/`resolveBranchScope` itself, so it still takes the
   full `session` — this is a query-builder helper operating inside
   `lib/db.ts`, not a `SessionUser`-typed data-access function returning a
   single business record, so it isn't in scope for the `AuthorizationScope`
   migration ADR-013 describes. Both mechanisms resolve through the same
   `resolveDealerScope`/`resolveBranchScope` functions underneath — there
   is exactly one place dealer/branch scope is computed from a session,
   regardless of which mechanism a given caller uses.

## Verified consumers (this review, 2026-07-09)

| Consumer | Mechanism | Status |
|---|---|---|
| NTR (`NtrSummaryProvider`, `supabaseNtrRepository`) | `applyScope()` | Correct |
| PM read (`MaintenanceSummaryProvider` → `getVehicleBySerial`) | `AuthorizationScope` | **Fixed this review** (was the bug) |
| PM list/history (`supabaseMaintenanceRepository`) | `applyScope()` | Correct |
| MQR (`MqrSummaryProvider` → `getVehicleHistory`) | `applyScope()` | Correct |
| Vehicle 360 (`vehicle/service.ts`) | `AuthorizationScope` | Correct (already resolved scope first; updated to pass the full scope object) |
| `api/vehicles/[serial]`, `api/records`, `api/platform/events`, `vehicle-event/factory.ts`, `api/ntr/tractors` | `AuthorizationScope` | Correct (already resolved scope first, or deliberately `UNRESTRICTED_SCOPE`) |
| Admin pages (users/technicians/branches) | `resolveDealerScope()` for `lockedDealerId` UI | Correct (mechanical `isPinned`→`unrestricted` rename) |
| Warranty, ORC | — | **Don't exist as modules yet** — nothing to review |
| `MachineRepository.getBySerial()` | `AuthorizationScope` | Dead code (no caller), signature kept in sync per ADR-009 |

## Test coverage

- `src/lib/dealerBranchScope.test.ts` — `resolveDealerScope`/
  `resolveBranchScope`/`canAccessDealerBranch`/`assertBranchAccess`,
  including the specific regression case (a privileged role with a
  non-null own `dealerId` must resolve `unrestricted: true`).
- `src/lib/getVehicleBySerial.test.ts` (new) — direct regression tests
  (own dealer, different dealer, missing vehicle dealer_id, invalid/
  unknown requested dealer, unrestricted access, the SuperAdmin/
  CentralAdmin regression case) plus a table-driven permission-matrix
  test (`it.each`) covering all 4 roles × own/different/missing dealer ×
  unrestricted access.
- `src/app/api/platform/events/route.test.ts` — updated for the new
  `getVehicleBySerial(serial, scope)` call signature.

## Known, tracked gaps (not fixed in this review — see `docs/OPERATIONS.md` §10)

- `MaintenanceRepository`/`NtrRepository`'s `session?: SessionUser`
  parameter on `list()`/`getById()`/`listHistory()` is optional; every real
  production caller always passes it (confirmed by tracing every call
  site), but the type itself doesn't enforce this. Tightening to required
  is a future, separate cleanup.
- Branch-level scoping for `vehicle_events` is coarser than dealer-level
  (documented directly in `platformEvents.ts`'s existing comment) — not
  changed by this review, since it was already a deliberate, documented
  trade-off, not a bug.
