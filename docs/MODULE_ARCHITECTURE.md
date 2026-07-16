# Module Architecture

> Status as of Sprint 2 (Module Framework). This document is the concrete
> conventions layer underneath `docs/MODULE_GUIDE.md` (Sprint 1, the
> module contract and per-module plug-in notes). Nothing here has been
> built yet — `modules/` remains empty of real code. This describes what
> any future module must follow, elaborated per-layer in `modules/template/`.

## 1. Module folder structure

```
modules/<name>/
  module.config.ts    module identity — see modules/template/module.config.md
  pages/ (or co-located route group — undecided, see §8)
  components/          module-specific UI — see modules/template/components-template.md
  api/                 this module's route handlers — see modules/template/api-template.md
  db.ts                this module's data-access layer — see modules/template/service-template.md
  types.ts             this module's record shapes
  README.md            what this module does, who owns it, what it depends on
```

This is unchanged from `docs/MODULE_GUIDE.md` §2 — restated here as the
anchor point the rest of this document hangs off of.

## 2. Naming conventions

| What | Convention | Example |
|---|---|---|
| Module folder | `kebab-case`, matches `module.config.ts`'s `id` | `modules/parts-request/` |
| Component files/exports | `PascalCase` | `PartsRequestForm.tsx` |
| Functions, variables | `camelCase` | `listPartsRequests()` |
| Database tables/columns | `snake_case`, no module prefix (see `database-template.md`) | `parts_requests`, `requested_by` |
| API routes | resource-noun, plural, lowercase | `api/parts-request/requests` |
| Module nav label | matches `displayName` in `module.config.ts` | — |

## 3. API conventions

See `modules/template/api-template.md` for the full convention. Summary:
`{ ok: true, ... } / { ok: false, error }` envelope, resource-route shape
(`api/<module>/<resource>[/[id]]`), and independent server-side
re-validation of session + scope on every route regardless of what the
calling page already checked.

## 4. Database conventions

See `modules/template/database-template.md`. Summary: RLS **and**
`applyScope()` on every table (defense in depth, neither layer optional),
soft delete via `record_status`/`deleted_by`/`deleted_at`, schema changes
through the Supabase migration tooling, `snake_case` naming.

## 5. Shared component usage

See `modules/template/components-template.md`. Summary: a component
starts in `modules/<name>/components/`; it only moves to
`shared/components/` once a second module genuinely needs it (or that need
is already known and planned, as with `calcWarranty()`). The app shell
(`shared/components/layout`) is always shared, never module-owned.

## 6. Shared services usage

A module's service layer (`db.ts`) is built on `shared/db` (the Supabase
client + `applyScope()` + soft-delete helpers, once extracted from today's
`src/lib` in Sprint 3, proposed) — not a second Supabase client and not a
reimplementation of scoping. Cross-cutting utilities that already exist or
are planned as shared (`calcWarranty()`, `shared/uploads`, `shared/email`,
`shared/exportPdf`, `shared/exportExcel`) are consumed from `shared/`, never
copied into a module.

## 7. Permissions

The base layer is the existing dealer/branch/role scope, enforced via
`applyScope()` on every query — every module gets this for free and cannot
opt out of it. Beyond that base layer, a module declares any
module-specific permissions it introduces in its `module.config.ts`
(`permissions` field — see `modules/template/module.config.md`). As of
Sprint 2 there is no module that has needed a permission beyond the base
scope; this section will be revisited with a real example once one does.

## 8. Routing conventions

URL prefix per module, matching the module's `id`: `/<module-id>/...`
(e.g. `/pdi/...`, `/parts-request/...`). A module registers its own nav
entry in the shared sidebar/nav data list (`module.config.ts`'s `nav`
field) — the shell itself stays generic and never contains
module-specific conditionals (`docs/MODULE_GUIDE.md` §3.4).

Whether `modules/<name>/pages/` is a real folder or just documentation
pointing at a Next.js App Router route group under `src/app/` is explicitly
**not decided** here — see `docs/MODULE_GUIDE.md` §2 and
`modules/template/page-template.md`. This gets decided in the sprint that
migrates MQR (`docs/ROADMAP.md`), with a working example, not speculated
on in advance.

## 9. Testing checklist

There is no automated test framework in this codebase (flagged gap,
`docs/ROADMAP.md` open questions). Until that's deliberately addressed,
this manual checklist is the substitute for any change to or addition of a
module — run it before considering a module's feature "done":

1. `npm run build` completes with no errors or new warnings.
2. Page loads correctly for each role that should have access, and is
   correctly blocked (redirect or 403-equivalent) for roles that shouldn't.
3. Data returned is scoped correctly — log in as a non-admin dealer/branch
   user and confirm you cannot see another dealer's rows (tests both RLS
   and `applyScope()` independently if possible).
4. Create/update/soft-delete all round-trip correctly; a soft-deleted row
   disappears from lists but the row itself still exists in the database.
5. Every async action (create/update/delete/upload) shows SweetAlert2
   loading + success/error feedback — no silent failures, no inline
   banners.
6. If the module touches PDF/Excel export, exported files open correctly
   and timestamps are correct in GMT+7 (`.claude/rules/02-coding-standards.md`).
7. Mobile responsive check on the new pages (the app has no desktop-only
   assumption anywhere else, so a new module doesn't introduce one).
8. `git diff` reviewed by hand before commit — confirms the change touches
   only the intended module's files plus any explicitly-intended `shared/`
   change, nothing else.

## What this document deliberately does not do

It does not pick a schema-validation library, does not finalize the
`pages/` vs. route-group routing question, and does not assign real
permissions to any module — those remain open, tracked in
`docs/ROADMAP.md`, decided when a real module is actually built.
