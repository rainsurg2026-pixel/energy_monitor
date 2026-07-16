# Module Guide

Defines what a "module" is in the target architecture, the standard shape
of a module folder, the contract every module must follow, and how each
named future module is expected to plug in. Nothing in this document moves
or creates module code in Sprint 1 — `modules/` stays empty until a sprint
explicitly says otherwise (see `docs/ROADMAP.md`).

## 1. What a module is

A module is a self-contained business capability: its own pages, its own
API routes, its own data-access functions for its own tables, its own
module-specific types. A module is *not* a place for cross-cutting code —
that's what `shared/` is for.

## 2. Standard module shape

```
modules/<name>/
  pages/            (or co-located with the app router group, depending on
                      how Next.js routing ends up wired — decided in the
                      Sprint 3 migration, not speculated on here)
  components/        module-specific UI (tables, forms, detail views)
  api/               this module's route handlers
  db.ts              this module's data-access functions (list/get/create/
                     update/softDelete), built on shared/db's client +
                     applyScope + soft-delete helpers
  types.ts           this module's record shapes (e.g. MqrRecord, PdiRecord)
  README.md          what this module does, who owns it, what it depends on
```

## 3. The module contract (non-negotiable)

1. A module **may** import anything from `shared/`.
2. A module **must not** import directly from another module's internals
   (`modules/pdi` reaching into `modules/mqr/db.ts` is not allowed). If two
   modules need the same thing, that thing belongs in `shared/`, or the
   cross-module need goes through a deliberate, exported interface — not a
   reach-through import.
3. A module's tables get RLS **and** go through `applyScope()` (or its
   `shared/db` successor) — the two-layer isolation rule in
   `docs/ARCHITECTURE.md` §5 applies to every module without exception.
4. A module registers itself in the shared navigation/sidebar config (a
   data list the shell reads), not by the shell containing
   module-specific conditionals. The shell (`shared/components/layout`)
   stays generic.
5. A module follows the same API envelope, RBAC-via-`scope.ts`,
   SweetAlert2-only-feedback, and GMT+7-timestamp conventions as every
   other module — see `docs/DEVELOPMENT_GUIDE.md` and `.claude/rules/`.

## 4. Per-module plug-in notes

### MQR (existing)
Today's entire application. Becomes module #1 — the reference
implementation every other module is modeled after, since it's the only
one that's actually been run in production. Migration (`src/` →
`modules/mqr/` + `shared/`) is a dedicated later sprint (Sprint 3), done as
a mechanical move with no behavior change, not a rewrite.

### PDI (Pre-Delivery Inspection)
Not started. Strong candidate for the **first new module**, because it
overlaps heavily with infrastructure MQR already proved out: vehicle
lookup (`shared` vehicle search), the photo-upload pipeline (size-routed
direct vs. Drive-resumable), and the admin-CRUD pattern (from
`templates/admin-crud-page/`). Building PDI second is also the first real
test of the module contract from a clean slate, with a working reference
next to it.

### Warranty
Not started. `calcWarranty()` (today `src/lib/warranty.ts`) is a **shared**
utility, not module-owned — both MQR (which already calls it on every new
record) and the future Warranty module need it. The Warranty module itself
would own the claims workflow: claim intake, approval status, linkage back
to an MQR record where relevant.

### Parts
Not started. A `parts` table already exists in the Supabase schema (see
root `CLAUDE.md`) but is **not currently wired into any application code**
— an MQR record stores `damaged_parts` as free text today. The Parts
module's first job is formalizing that into a real catalog with
structured references, which would also let MQR start linking to it from
`shared/` once that exists.

### NTR
**Scope not yet defined.** Do not guess at what this module covers —
confirm with the business owner before any design work starts. Tracked as
an open question in `docs/ROADMAP.md` until then.

### Dashboard
Today bundled inside MQR (`(app)/dashboard`). Two options for the target
state:
- **(a)** Each module ships its own dashboard section, built from shared
  chart/KPI components (`shared/components/charts`, `shared/components/ui`)
  — simplest, recommended until 3+ modules exist.
- **(b)** Dashboard becomes its own cross-module module that reads from
  every other module's data via well-defined read APIs.

Recommendation: start with (a); revisit (b) only once there's enough
real cross-module reporting demand to justify the added coupling.

## 5. What this guide deliberately does not do

It does not pick component libraries, does not decide Next.js routing
mechanics for `modules/`, and does not commit to exact module folder
contents beyond the shape in §2 — those are implementation decisions for
the sprint that actually builds the first new module, informed by how the
MQR migration in Sprint 3 actually goes.
