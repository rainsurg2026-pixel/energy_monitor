# Admin Framework

> Status as of Sprint 4 (Admin Framework). This document is analysis and
> design only — no production files were modified to produce it. Source of
> truth: the live `main` branch on GitHub (`patamin-lab/mqr-mahindra`),
> read file-by-file on 2026-06-26. The local `mqr-webapp-new` clone in this
> workspace is confirmed stale (see `docs/SHARED_UI_ANALYSIS.md` §0) and was
> not used.

## 0. Scope

Five admin modules exist today, all under `src/app/(app)/admin/`:

| Module | Directory | Table component |
|---|---|---|
| Dealers | `admin/dealers/` | `dealers-table.tsx` (228 lines) |
| Branches | `admin/branches/` | `branches-table.tsx` (184 lines) |
| Users | `admin/users/` | `users-table.tsx` (293 lines) |
| Technicians | `admin/technicians/` | `technicians-table.tsx` (208 lines) |
| Problem Codes | `admin/problem-codes/` | `problem-codes-table.tsx` (275 lines) |

Each has a mirrored API directory under `src/app/api/admin/<module>/` with
`route.ts` (collection) and `[id]/route.ts` (single-record), and a `page.tsx`
server-component wrapper in the UI directory. Permissions for all five are
gated through a single shared file, `src/lib/scope.ts`.

## 1. Current architecture

Every module follows the same three-layer shape:

```
admin/<module>/page.tsx        – server component: auth + permission gate, fetch data, render table
admin/<module>/<module>-table.tsx – client component: local state, CRUD handlers, JSX
api/admin/<module>/route.ts       – GET (list) + POST (create)
api/admin/<module>/[id]/route.ts  – PATCH (update), and for Users only, DELETE
```

`page.tsx` is consistently small (20–27 lines) and consistently does, in
order: `getSession()` → return `null` if no session → call one `scope.ts`
predicate and `redirect('/dashboard')` if it fails → fetch the module's data
server-side (scoped to the caller's dealer when the role can't see all
dealers) → render `<ModuleTable initial...={data} ... />`. Confirmed
identical for Dealers, Branches, and Users page.tsx (read in full);
Technicians and Problem Codes follow the same import list and structure in
every file checked so far and are treated as following the same pattern,
not independently re-verified line-by-line.

The table component is a single large `'use client'` file that owns all
state for its module — there is no further decomposition into smaller
components. This is the main duplication source the rest of this document
addresses.

## 2. Shared CRUD flow

All five table components hold the same state shape:

```ts
const [items, setItems] = useState(initialItems);
const [busy, setBusy] = useState(false);
const [editingId, setEditingId] = useState<string | null>(null);
const [editDraft, setEditDraft] = useState<Partial<Entity>>({});
const [newItem, setNewItem] = useState({ /* empty-string defaults per field */ });
```

And the same handler shape for every mutation, confirmed identical (modulo
field names) in `dealers-table.tsx` and `branches-table.tsx`, and consistent
with the imports/state seen in `users-table.tsx`, `technicians-table.tsx`,
and `problem-codes-table.tsx`:

```ts
async function createX() {
  setBusy(true);
  swalLoading('กำลังเพิ่ม...');
  try {
    const json = await fetchJson<{ ok: boolean; error?: string; item: Entity }>(
      '/api/admin/<module>', { method: 'POST', body: JSON.stringify(newItem) },
    );
    if (!json.ok) throw new Error(json.error);
    setItems((prev) => [...prev, json.item].sort(...));
    setNewItem({ ...emptyDefaults });
    swalClose();
  } catch (err) {
    swalClose();
    await showError(err); // FetchJsonError-aware helper, local to each file
  } finally {
    setBusy(false);
  }
}
```

`saveEdit(id)` is the same shape with `method: 'PATCH'` against
`/api/admin/<module>/<id>`, body `JSON.stringify(editDraft)`, and an
update-in-place via `prev.map(...)` instead of an append.

**Variations on top of the base flow:**

- **Users** adds `toggleActive(u)` — `PATCH` with `{ active: !u.active }` —
  and `resetPassword(u)` — `swalPrompt()` for a new password, then a call to
  a nested action route `/api/admin/users/[id]/reset-password` (route
  directory confirmed; handler not opened). Users is also the only module
  with client-derived permission values (`assignableRoles(actorRole)`,
  `canDeleteUsers(actorRole)`) used to gate which roles can be assigned and
  whether a delete action renders at all.
- **Dealers, Problem Codes** (confirmed) update via `PATCH` with an
  `active: boolean` field rather than exposing delete — this is a soft
  toggle, not a removal. **Branches, Technicians** are presumed to follow
  the same toggle convention based on identical import/file shape; not
  independently confirmed at the API layer.
- **Users** is the only module whose `[id]/route.ts` exposes `DELETE`
  (hard delete, gated by `canDeleteUsers` — SuperAdmin only).

This "same flow, occasional bolt-on action" shape is the central design
input for the `AdminCrud` component in §5: the generic component must cover
the base flow exactly, and expose a slot for the bolt-ons rather than try to
predict every one of them.

## 3. Shared permissions

`src/lib/scope.ts` (51 lines, read in full) is the single source of truth.
It exports pure functions over a four-value `Role` (`SuperAdmin`,
`CentralAdmin`, `DealerAdmin`, `DealerUser`) and nothing else — no classes,
no role-loading logic, no async calls:

| Function | Used to gate |
|---|---|
| `seesAllDealers(role)` | Dealers page/route; whether Branches/Users/Technicians are pre-filtered to the caller's own dealer |
| `canManageMasterData(role)` | Branches page (and presumed Technicians/Problem Codes pages) |
| `canManageUsers(role)` / `canDeleteUsers(role)` | Users page/routes |
| `canManageRoleTarget(actorRole, targetRole)` | Users `[id]` PATCH only — the one place a permission check needs the *target* record, not just the actor's role |
| `assignableRoles(actorRole)` | Users create/edit — which `role` values may be assigned |
| `roleLabelTh` | Thai display label per role, used in `users-table.tsx` |
| `canExport`, `canUpdateStatus`, `canDelete`, `canManageParts`, `canCreateSuperAdmin` | Not admin-module-specific; listed for completeness since they live in the same file |

Every `page.tsx` calls exactly one boolean predicate and redirects if it's
false. Every `route.ts` calls the same predicate again server-side (the UI
gate is not trusted as the only check — confirmed: `dealers/route.ts` and
`problem-codes/[id]/route.ts` both re-check `seesAllDealers`/equivalent
independently of any page-level redirect). This duplicate-check pattern
(once in `page.tsx` for UX, once in `route.ts` for enforcement) is
intentional defense in depth and should be preserved by any shared
abstraction, not collapsed into a single check.

Users is the only module needing row-level (target-aware) authorization.
Every other module's checks are a pure function of the *caller's* role.

## 4. Shared API pattern

Every route file, with no exception found across `dealers/route.ts`,
`dealers/[id]/route.ts`, `problem-codes/[id]/route.ts`, and
`users/[id]/route.ts` (all read in full):

1. `const session = await getSession();` → `401 { ok: false, error: 'unauthorized' }` if missing.
2. One `scope.ts` predicate → `403 { ok: false, error: '<Thai message>' }` if it fails.
3. Body parsed inside a `try`; on success, calls exactly one `lib/db.ts`
   function (`createDealer`, `updateDealer`, `updateUserAdmin`,
   `deleteUserAdmin`, `updateProblemCode`, etc.), passing `session` through
   for server-side scoping/auditing.
4. Success: `NextResponse.json({ ok: true, <entityName>: result })`.
5. `catch`: `console.error('<action> <entity> error', err)` then
   `NextResponse.json({ ok: false, error: err?.message ?? '<Thai fallback>' }, { status: 500 })`.

Methods present per module:

| Module | GET | POST | PATCH | DELETE | Extra |
|---|---|---|---|---|---|
| Dealers | list | create | update (incl. `active`) | — | — |
| Branches | list (presumed) | create (presumed) | update | — | — |
| Problem Codes | list (presumed) | create (presumed) | update (incl. `active`) | — | — |
| Technicians | list (presumed) | create (presumed) | update (presumed) | — | — |
| Users | list | create | update (role-aware) | yes, SuperAdmin only | `[id]/reset-password` |

"Presumed" rows are inferred from identical file structure/imports across
modules, not independently opened — flagged rather than guessed as fact, per
the standing instruction not to assert unverified detail.

## 5. Shared table pattern

Layout is consistent across every table component read: a standalone
"create new record" card (`<div className="bg-white rounded-xl shadow-sm
border ... grid grid-cols-2 ...">` with one `<label>`+`<input>`/`<select>`
pair per field) rendered above a native `<table>`. Table rows render each
cell as `{isEditing ? <input ...editDraft.../> : <span>{value}</span>}`,
gated per-row by `editingId === item.id`. No shared `<Table>` or `<FormRow>`
component exists; every file hand-rolls the same markup with different
field names. See `docs/COMPONENT_CATALOG.md` → Tables for the original
finding (Sprint 3) that first identified this as a duplicate pattern.

## 6. Shared form pattern

Field types seen across the five "create" cards: plain text (`id`,
`short_name`, `full_name`, `address`, `username`, `full_name`, `mobile`,
`email`), password (`users` only), and enum `<select>` (`role` in Users;
`severity` and `system` in Problem Codes, backed by `SEVERITY_VALUES` /
`SEVERITY_LABELS` from `@/lib/types` and a page-local `SYSTEM_LABEL` map).
Every field is controlled (`value={newItem.x}` / `onChange` spread-update),
matching the global input-focus styling already centralized in
`globals.css` (see `docs/SHARED_UI_ANALYSIS.md` §2 — design tokens).

## 7. Generic `AdminCrud` component — design only, no implementation

```tsx
<AdminCrud
  entity="dealers"
  columns={[
    { key: 'id', label: 'รหัสดีลเลอร์', editable: false },
    { key: 'short_name', label: 'ชื่อย่อ', editable: true },
    { key: 'full_name', label: 'ชื่อเต็ม', editable: true },
    { key: 'address', label: 'ที่อยู่', editable: true, type: 'text' },
  ]}
  api="/api/admin/dealers"
  permissions={{
    view: seesAllDealers,
    create: seesAllDealers,
    edit: seesAllDealers,
    delete: undefined, // omit => soft-toggle via `active`, not a delete action
  }}
  newItemDefaults={{ id: '', short_name: '', full_name: '', address: '' }}
/>
```

Proposed contract (names illustrative, not binding):

- `entity: string` — used to build default Thai loading/success/error
  copy and as a React key namespace; does not need to match the API path.
- `columns: Column[]` — each column carries `key`, `label`, `editable`,
  and an optional `type` (`'text' | 'select' | 'password'`) plus
  `options`/`labels` for selects, covering every field type found in §6.
- `api: string` — base path; the component derives `GET api`, `POST api`,
  `PATCH api/:id` itself. A module needing a non-CRUD action (Users'
  `reset-password`) would pass it through a separate, optional
  `actions` prop rather than the component trying to guess it —
  this keeps the generic component honest about only covering the base
  flow documented in §2, not every bolt-on.
- `permissions: { view, create, edit, delete? }` — each a `(role) =>
  boolean` matching the existing `scope.ts` function signatures exactly,
  so adoption means passing in the existing functions, not rewriting them.
  Omitting `delete` should mean "no delete UI is rendered", reflecting
  that 4 of 5 current modules don't expose one.
- `newItemDefaults: Partial<Entity>` — seeds the create-form state,
  mirroring every module's hand-written `newX` initial state today.
- Row-level authorization (Users' `canManageRoleTarget` case) is
  explicitly **out of scope** for a first generic version — see §9.

This is a design sketch for a future, separately-approved implementation
sprint. No `AdminCrud` code exists anywhere in this repository today.

## 8. Generic API conventions

Recommended for any *new* admin module, and as a target shape if an
existing route is ever revisited (not a request to revisit one now):

- Response envelope: always `{ ok: boolean, error?: string, <entityKey>?:
  T }` — already 100% consistent across every route read; should not
  change.
- Status codes: `401` unauthorized, `403` forbidden (with a Thai
  human-readable `error`), `500` on caught exceptions, `200` otherwise —
  already consistent; no route returns `400` today even for validation
  failures (dealers' `route.ts` returns `200`-shaped JSON with `ok:
  false` for a missing required field, not a `4xx` — worth knowing before
  any client code is written that assumes status-code-based branching).
- Auth/permission check ordering: session check before permission check,
  always — preserve this even in a generic handler, since it's what lets
  the client distinguish "log in again" from "you don't have access".
- Nested action routes (`[id]/reset-password`) are the established
  escape hatch for module-specific behavior that isn't plain CRUD — new
  non-CRUD actions should follow that convention rather than overload
  `PATCH` with magic body fields.

## 9. Recommended migration order

This is a recommendation for *if and when* a future sprint is approved to
build `shared/admin/` for real. It is not authorization to start.

1. **Extract `scope.ts` usage as-is** — zero risk, since it requires no
   code change, only documenting (done, this sprint) that it's already the
   single shared permission layer. Nothing to migrate.
2. **`showError(err)` helper** — every table file defines its own
   near-identical local copy. Lowest-risk extraction: pure function, no
   JSX, no state.
3. **The base CRUD hook** (`useAdminCrud` or similar) — extract the
   `items/busy/editingId/editDraft` state + `createX`/`saveEdit` handler
   pair behind a hook, leaving each table's JSX untouched at first. This
   isolates behavior-preserving risk from rendering risk.
4. **Generic `AdminCrud` table/form rendering** — only after step 3 is
   proven safe on one module (suggest Technicians or Problem Codes first,
   the two modules with no nested actions and no row-level permission
   logic — lowest blast radius). Branches next (dealer-scoping only).
   Dealers next.
5. **Users last, and only with explicit follow-up approval** — it is the
   only module with a hard delete, a nested action route, and row-level
   (target-role-aware) permission logic. Folding it into a generic
   component without a dedicated review risks silently weakening the
   `canManageRoleTarget` check, which is a real security boundary today
   (it's what stops a `CentralAdmin` from editing a `SuperAdmin`).

## 10. Verification

No production file was read in a way that required modification, and none
was changed, moved, or renamed. The only artifacts produced by this sprint
are this document and the six files under `shared/admin/`. Every code
sample above is either copied verbatim from a file read in full this
sprint, or explicitly marked "presumed"/"design only, no implementation
exists" where it is not.
