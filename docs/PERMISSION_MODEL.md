# Permission Model

The role/permission matrix every business module checks against.

## Status: forward-looking target, not the current production model

Production's `Role` type (`src/lib/scope.ts`) has exactly four values today: `SuperAdmin`, `CentralAdmin`, `DealerAdmin`, `DealerUser` (documented in `shared/admin/PERMISSION_GUIDE.md`). The six-role model below is Sprint 6's target model for future modules, the same way `docs/DESIGN_SYSTEM.md`/ADR-005 documented a target design system ahead of every screen matching it. **This document does not change `src/lib/scope.ts`, and no module should assume a role beyond the existing four exists until that type is actually extended.**

Mapping target → current, so the gap is explicit rather than implied:

| Target role | Current equivalent | Note |
|---|---|---|
| Super Admin | `SuperAdmin` | Same role, renamed for readability only |
| Customer Care | `CentralAdmin` | Same role; "Customer Care" is the business-facing name for what the code calls `CentralAdmin` |
| Dealer Admin | `DealerAdmin` | Same role |
| Dealer User | `DealerUser` | Same role |
| Technician | *(none yet)* | New role — narrower than Dealer User, intended for field/service staff who act on assigned records but don't manage a dealer's account |
| Viewer | *(none yet)* | New role — read-only, intended for stakeholders who need dashboard/export access without any write permission |

Until `Role` is extended, a module built today enforces this model by treating `Technician` and `Viewer` as out of scope, and treating `Customer Care` as `CentralAdmin` in code while using the business-facing name in UI copy if needed.

## Permission matrix

Permissions: Create, Read, Update, Delete, Approve, Export, Dashboard.

| Role | Create | Read | Update | Delete | Approve | Export | Dashboard |
|---|---|---|---|---|---|---|---|
| Super Admin | ✅ | ✅ (all) | ✅ (all) | ✅ (all) | ✅ | ✅ | ✅ |
| Customer Care | ✅ | ✅ (all) | ✅ (all) | ❌ | ✅ | ✅ | ✅ |
| Dealer Admin | ✅ | ✅ (own dealer) | ✅ (own dealer) | ✅ (own dealer, own drafts only) | ❌ | ✅ (own dealer) | ✅ (own dealer) |
| Dealer User | ✅ | ✅ (own records) | ✅ (own records, Draft only) | ✅ (own drafts only) | ❌ | ❌ | ❌ |
| Technician | ✅ (assigned-record updates only) | ✅ (assigned records) | ✅ (assigned records) | ❌ | ❌ | ❌ | ❌ |
| Viewer | ❌ | ✅ (scoped per grant) | ❌ | ❌ | ❌ | ✅ | ✅ |

Notes:

- "Delete" everywhere means the soft-delete (`record_status`) described in `docs/MODULE_ARCHITECTURE.md` §4, never a hard delete — no role, including Super Admin, hard-deletes a business record through the application.
- "Approve" corresponds to moving a record out of the Waiting Approval stage in `docs/MODULE_LIFECYCLE.md`. A module may narrow which records a Customer Care or Super Admin user can approve (e.g. only within their own region), but may not grant Approve to a role not marked ✅ here without documenting why as a module-specific exception.
- Scope qualifiers ("own dealer," "own records," "assigned records") are enforced through `applyScope()` and RLS exactly as today (`shared/admin/PERMISSION_GUIDE.md`), not through client-side filtering.

## Enforcement pattern

Unchanged from existing production convention: every permission check exists in two independent places — a UX gate in the page/component, and a server-side enforcement gate in the API route — and the two are never collapsed into one shared check (`shared/admin/PERMISSION_GUIDE.md`). A module's `validateRoleTarget`-style check (seen today only in the Users module, for one role acting on another) is adopted by a new module only if that module has the same "one role manages another role's record" shape — most modules will not need it.

## Verification

Documentation only. Does not modify `src/lib/scope.ts`, any RLS policy, or any existing role check. `Technician` and `Viewer` are not implemented by this sprint.
