# ADR-013: AuthorizationScope — Keeping Authorization Decisions Out of the Data-Access Layer

## Problem

`getVehicleBySerial()` in `lib/db.ts` took a raw `dealerId: string | null` and
applied `if (dealerId && data.dealer_id !== dealerId) return null` with no
role awareness at all. Every safe caller worked around this by pre-resolving
`dealerId` via `resolveDealerScope(session, ...)` first (which correctly
returns `null` for a `seesAllDealers` role). Exactly one caller —
`maintenanceSummaryProvider.ts` (PM's contribution to Vehicle 360/Machine
360) — passed `session.dealerId ?? null` directly, bypassing that
resolution. A SuperAdmin or CentralAdmin whose own account has a non-null
`dealerId` (e.g. the head-office dealer "MSEAL") was therefore incorrectly
blocked from Vehicle 360/PM data for any vehicle belonging to a different
dealer. Found live during the v2.3.1 production rollout verification (see
`docs/releases/RELEASE_CHECKLIST_V2.3.1_SYNC_HARDENING.md` §3.1).

The narrowest fix would have been to patch that one call site. Two things
made that insufficient:

1. `getVehicleBySerial()`'s own signature invited the exact same mistake
   again — nothing about `dealerId: string | null` signals "this must be
   pre-resolved with role in mind," so a future caller could reintroduce
   this bug by passing a raw session field directly.
2. The obvious alternative — changing `getVehicleBySerial()` to accept
   `session: SessionUser` directly — pulls authentication/authorization
   concepts (`Role`, `seesAllDealers`) into `lib/db.ts`, the data-access
   layer. This repo's layering convention (`.claude/rules/
   01-architecture-boundaries.md`, `docs/architecture/
   PLATFORM_ARCHITECTURE_STANDARDS.md`) keeps `lib/*` as infrastructure; authorization
   decisions belong in the calling layer.

## Decision

1. **`AuthorizationScope`** (`lib/dealerBranchScope.ts`) is the reusable,
   already-resolved authorization result that data-access functions consume
   instead of a `SessionUser`:

   ```ts
   export interface AuthorizationScope {
     dealerId: string | null;
     unrestricted: boolean;
   }
   ```

   `unrestricted: true` means "this scope sees every dealer — skip dealer
   filtering entirely, never compare against `dealerId`." This is the one
   flag that fixes the bug's root cause: a privileged role's own non-null
   `dealerId` is never mistaken for a restriction again, because the
   function checks `unrestricted` first, not `dealerId`'s nullness.

2. **`resolveDealerScope(session, requestedDealerId?)` now returns
   `AuthorizationScope`** (previously `DealerScopeResult`, shaped
   `{ dealerId, isPinned }` — removed; every caller either only used
   `.dealerId`, unaffected by the rename, or destructured `.isPinned`,
   updated to `!unrestricted` at its 3 call sites — see "Modified files"
   in the PR). This is still the *only* function that computes scope from
   a session; nothing new was introduced to duplicate it.

3. **`UNRESTRICTED_SCOPE`** (`{ dealerId: null, unrestricted: true }`) is
   an exported constant for the handful of call sites that deliberately
   never dealer-filter (an existence-only lookup where the caller applies
   its own scope elsewhere) — replaces passing a raw `null` so the intent
   reads directly at the call site instead of requiring the reader to know
   `getVehicleBySerial`'s old convention.

4. **`getVehicleBySerial(serial, scope: AuthorizationScope)`** — the fixed
   function. `lib/db.ts` still does not import `SessionUser` for this
   function's signature; it consumes only the already-resolved scope,
   preserving the layering rule.

5. **Every call site updated** (8 real callers, changed together in one
   PR so a compile pass is the completeness check — see "Modified files"):
   `maintenanceSummaryProvider.ts` (the actual bug), `vehicle/service.ts`,
   `vehicle/eventSources/platformEvents.ts`, `api/vehicles/[serial]/route.ts`,
   `api/records/route.ts`, `api/platform/events/route.ts`,
   `vehicle-event/factory.ts`, `api/ntr/tractors/route.ts`. Plus
   `MachineRepository.getBySerial()` (dead code, no live caller — kept
   per ADR-009's facade-layer intent, signature updated to stay
   compilable rather than becoming a stale relic).

## Permission audit (this review)

Every other dealer-scoping mechanism in NTR/PM/MQR/Vehicle 360 was checked
against the same bug class (a role-unaware comparison against a
privileged role's own `dealerId`/`session` field) and found already
correct:

- `applyScope()` (`lib/db.ts`) — used by NTR (`NtrSummaryProvider`,
  `supabaseNtrRepository`), PM (`supabaseMaintenanceRepository`), and MQR
  (`getVehicleHistory` → `MqrSummaryProvider`) — already calls
  `resolveDealerScope`/`resolveBranchScope` internally, role-aware by
  construction.
- `canAccessDealerBranch()` — already checks `seesAllDealers(session.role)`
  first, exactly the pattern this ADR generalizes.
- Every other `resolveDealerScope()` call site across admin pages and API
  routes (~25 total) either already used `.dealerId` correctly or (3 admin
  pages) needed only the mechanical `isPinned` → `unrestricted` rename.

Full detail: `docs/architecture/PERMISSION_MATRIX.md`.

## Duplicated logic removed

`api/records/route.ts` had its own redundant re-check immediately after
calling `getVehicleBySerial()`:

```ts
if (vehicle && dealerIdForLookup && vehicle.dealer_id && vehicle.dealer_id !== dealerIdForLookup) {
  return NextResponse.json({ ok: false, error: translate(locale, 'validation.serialNotInYourDealer') }, { status: 403 });
}
```

This condition can never be true: `getVehicleBySerial()` already returns
`null` for exactly this case (a truthy, non-matching dealer comparison),
so by the time this line runs, `vehicle` is guaranteed to already be
`null` whenever the condition's own dealer-mismatch clause would be true.
This was dead code in the original implementation too, not something this
fix broke — confirmed by tracing the exact same boolean condition
`getVehicleBySerial()` itself applies. Removed, along with the
now-orphaned `validation.serialNotInYourDealer` translation key (was used
nowhere else). No observable behavior change: a cross-dealer serial was
already treated as "not found" (falls through to the manual `stockNote`
path), matching every other unknown-serial case — the 403 branch never
fired in production.

## Not changed (explicitly out of scope)

- **`resolveBranchScope()`/branch-level scoping** — untouched. This fix is
  scoped to the dealer-level bug found; `getVehicleBySerial()` never had
  branch-level filtering and this ADR does not add any.
- **`MaintenanceRepository`/`NtrRepository`'s optional `session?: SessionUser`
  parameter** on `list()`/`getById()`/`listHistory()` — verified every real
  production caller always passes `session` (only unit tests omit it,
  directly, as a lower-level convenience); the "no session" raw-filter
  fallback branch is confirmed unreachable via any live route. Not
  tightened to required in this PR — flagged as tracked technical debt
  (`docs/OPERATIONS.md` §10) rather than expanding this fix's blast radius
  further.
- **`MachineRepository`** — confirmed dead code (no caller anywhere), but
  not deleted since ADR-009 documents it as deliberate facade
  infrastructure; removal is a separate decision, not part of an
  authorization fix.

## TODO: documentation sync after PR #27 merges

`docs/OPERATIONS.md` and the "Post-v2.3.1 Roadmap" section of
`docs/ROADMAP.md` (Phase 1, PR #27) did not exist on `main` when this ADR
was written — this ADR and `docs/architecture/PERMISSION_MATRIX.md`
reference them as forward references, not yet-broken links. **Once PR #27
merges**, update, in one small follow-up docs-only PR:

- `docs/OPERATIONS.md` §8 (Security) — replace the "known, tracked gap"
  description of the SuperAdmin dealer-scope bug with a reference to this
  ADR and `PERMISSION_MATRIX.md`, marked resolved.
- `docs/OPERATIONS.md` §10 (Technical Debt) — remove the now-fixed dealer
  scope bug entry; keep the `MaintenanceRepository`/`NtrRepository`
  optional-session and `MachineRepository` dead-code entries (still open).
- `docs/ROADMAP.md`'s Phase 2 status line — change from "Next" to
  "Complete."

Do not duplicate content — link to this ADR and `PERMISSION_MATRIX.md`
rather than restating their detail in `OPERATIONS.md`.

## Rollback

Additive/renaming only — no schema, no data change. To roll back:
revert this PR's commits. `AuthorizationScope`/`UNRESTRICTED_SCOPE` are
new exports with no other consumers introduced elsewhere; reverting
restores `DealerScopeResult`'s prior shape and `getVehicleBySerial()`'s
prior (buggy) signature exactly. No data loss risk — this is a read-path
authorization fix, no write path is touched.

## Consequences

- The bug class (a privileged role's own session field mistaken for a
  restriction) cannot recur silently at this function — `unrestricted` is
  checked first, and `AuthorizationScope`'s shape makes "did I bypass
  filtering" explicit at every call site, not implicit in a `null` check.
- `lib/db.ts` remains free of `SessionUser`/`Role` knowledge for this
  function, consistent with the layering rule — authorization is fully
  resolved before the data-access layer is reached.
- One redundant, dead authorization check and its orphaned translation key
  are removed.
- Regression test coverage now exists for `getVehicleBySerial()` and
  `resolveDealerScope()`'s `AuthorizationScope` shape, including a
  table-driven permission-matrix test across all 4 roles — previously
  zero test coverage existed for either.
