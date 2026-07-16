# Skill: scaffold a new admin CRUD module

Use when adding a new master-data entity to the admin area (the existing
pattern: Dealers, Branches, Technicians, Users, Problem Codes).

## Steps

1. **Data layer** — add `listAll<Entity>Admin()`, `create<Entity>()`,
   `update<Entity>()` (and a soft-delete function if the entity supports
   deletion) to `db.ts`, modeled directly on the Dealers functions. Apply
   `applyScope()`/soft-delete conventions exactly as Dealers does.
2. **Types** — add the entity's interface to `types.ts`.
3. **API routes** — `app/api/admin/<entity>/route.ts` (GET list, POST
   create) and `app/api/admin/<entity>/[id]/route.ts` (PATCH update, plus
   DELETE if applicable). Gate every handler on the relevant `scope.ts`
   predicate (usually `seesAllDealers` or an equivalent role check) before
   touching the DB layer. Return the `{ok,...}` / `{ok:false,error}`
   envelope.
4. **UI** — a page under `app/(app)/admin/<entity>/` (Server Component,
   session/scope check, fetch initial list) rendering a Client Component
   table (`<entity>-table.tsx`) with inline create/edit, using `swalLoading`
   / `swalClose` / `swalError` from `swal.ts` around every mutation and
   `fetchJson.ts` for the actual calls — never a raw `fetch()`.
5. **Nav** — add the entry to the sidebar config.
6. **Verify** — manually exercise create/edit/(delete) as each affected
   role (SuperAdmin/CentralAdmin/DealerAdmin) to confirm the scope gate
   actually blocks who it should.

## Gotcha

This pattern is duplicated five times today with no shared abstraction.
Until Sprint 2 extracts a generic `AdminCrudTable` into `shared/`, copy the
Dealers implementation directly rather than inventing a new shape —
consistency across the five matters more than improving any one of them
in isolation.
