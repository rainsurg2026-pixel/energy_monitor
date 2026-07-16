# Business Module Standard

Single reference for how every business module in MSEAL SERVICE SYSTEM is built: MQR, PM Record, New Tractor Delivery, NTR, Warranty, Parts Request, Campaign, Dealer KPI. This document indexes the standard; it does not redefine conventions already documented elsewhere — each section links to the doc that owns the detail.

This is a standard, not an implementation. No business logic for any listed module is written by this sprint.

## Folder structure

Every module is a folder under `modules/<module-id>/` containing `components/`, `services/`, `hooks/`, `types/`, `validation/`, `api/`, `pages/`, and `assets/` — the layout defined in `modules/module-template/` (Sprint 6), with each folder's own `README.md` explaining what belongs in it. `modules/template/` (Sprint 2) remains the prose-convention layer behind that layout; a new module reads both before scaffolding.

## Naming conventions

kebab-case module folders and API paths, PascalCase components, camelCase functions and hooks, snake_case database columns, plural-lowercase API resource segments. Full table and rationale: `docs/NAMING_STANDARD.md`.

## Permissions

A module declares which roles can reach it and which permissions (Create, Read, Update, Delete, Approve, Export, Dashboard) each role holds for it. Every check is enforced twice, independently — once in the page for UX, once in the API route for actual access control — never collapsed into a single shared check. Role/permission matrix: `docs/PERMISSION_MODEL.md`. Existing two-layer pattern and the production `Role` type it's built on: `shared/admin/PERMISSION_GUIDE.md`.

## Routing

A module's pages live under its own URL prefix, `/<module-id>/...`, and register their nav entry through `module.config.ts` rather than the shared shell carrying module-specific logic. The choice between a literal `pages/` directory and a Next.js route group is still open (`docs/MODULE_ARCHITECTURE.md` §8) and not resolved by this sprint. Details: `modules/module-template/pages/README.md`, `docs/MODULE_ARCHITECTURE.md` §8.

## Shared services

A module never re-implements a cross-cutting concern. Auth, upload, Google Drive, PDF, synchronization, scheduler, notification, audit, logging, monitoring, cache, and search all live in `shared/services/`, and a module's own `services/` folder only wires into them. None of the twelve services is implemented yet — this is a consumption contract for when they are. Full catalogue: `docs/PLATFORM_SERVICES.md`, `shared/services/README.md`.

## Shared UI

A component starts inside the module's own `components/` folder and only promotes to `shared/ui/` once a second module needs it (`docs/MODULE_ARCHITECTURE.md` §5). Check `docs/COMPONENT_CATALOG.md` before building anything — most table, card, and form primitives a new module needs already exist. Visual language: `docs/DESIGN_SYSTEM.md`.

## API usage

Every route returns the `{ ok: true, ... }` / `{ ok: false, error }` envelope, re-validates input server-side regardless of what the client already checked, and re-checks session/scope independently of the calling page. Convention: `modules/template/api-template.md`, `docs/MODULE_ARCHITECTURE.md` §3. Folder-level detail: `modules/module-template/api/README.md`.

## Validation

A module defines one validation function or schema per form/entity, called from both the page (UX) and the route (enforcement) — never only one. Today's standard is hand-written validation; adopting a schema library is an open question, not a decision this sprint makes. Detail: `modules/module-template/validation/README.md`, `docs/MODULE_ARCHITECTURE.md` §3.

## PDF

PDF generation is a shared service (`shared/services/pdf/`), not a per-module implementation. A module supplies its own template/layout to the shared service; it does not generate PDFs itself. Existing manual-testing expectation — exports must show correct GMT+7 timestamps — carries forward unchanged (`docs/MODULE_ARCHITECTURE.md` §9). Architecture: `docs/PLATFORM_SERVICES.md`.

## Upload

File upload is a shared service (`shared/services/upload/`). A module calls it rather than handling multipart upload, storage, or filename handling itself. Architecture: `docs/PLATFORM_SERVICES.md`.

## Google Drive

Drive sync, when used, is a shared service (`shared/services/google-drive/`) with its own architecture document. A module does not talk to the Google Drive API directly. Architecture: `docs/GOOGLE_DRIVE_ARCHITECTURE.md`.

## Reporting

Dashboard and export surfaces follow the same shared-first rule as everything else: a module-specific dashboard widget is built from `shared/ui/` chart/table primitives and the module's own scoped data query, not a bespoke reporting stack per module. `docs/MODULE_CHECKLIST.md`'s Dashboard item is the per-module completeness gate for this.

## Lifecycle

Every module's records move through the same status workflow — Draft → Submitted → In Progress → Waiting Approval → Completed → Closed — unless a module's own doc explicitly extends it. This status field is distinct from the existing soft-delete `record_status` column (`docs/MODULE_ARCHITECTURE.md` §4); see `docs/MODULE_LIFECYCLE.md` for the full workflow and the naming distinction.

## Verification

Documentation only. No production code, routing, import, or schema change is introduced by this document or by Sprint 6.
