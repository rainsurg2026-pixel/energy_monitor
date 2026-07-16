# Architecture Principles

This document translates the product vision (`docs/VISION.md`) and philosophy (`docs/PRODUCT_PHILOSOPHY.md`) into concrete rules for how the platform is built. It complements, rather than replaces, the existing `docs/ARCHITECTURE.md` and `docs/MODULE_ARCHITECTURE.md` — those documents describe the current MQR application's structure; this document describes the standard every module, current and future, is expected to follow.

## 1. One Platform, Many Modules

The platform is a single Next.js application with multiple business modules living side by side under `modules/` (see `docs/MODULE_ARCHITECTURE.md`), not a collection of separately deployed applications. A module:

- Owns its own routes, pages, and module-specific logic.
- Does not duplicate authentication, permission checking, layout, or design-system components — it consumes them from `shared/`.
- Can be developed and reasoned about independently, but is not independently deployed.

## 2. Shared Code Lives in `shared/`, Not in a Module

Three categories of shared code exist, established across Sprints 3–5:

- `shared/ui/` — presentational components and layout primitives (Sprint 3).
- `shared/admin/` — the admin/CRUD framework used by master-data screens (Sprint 4).
- `shared/services/` — platform services: auth, upload, google-drive, pdf, synchronization, scheduler, notification, audit, logging, monitoring, cache, search (Sprint 5, this document's sibling: `docs/PLATFORM_SERVICES.md`).

A module imports from `shared/`; `shared/` never imports from a module. This keeps the dependency direction one-way and prevents shared code from silently becoming coupled to one module's assumptions.

## 3. Supabase Is the Source of Truth

All operational data — records, statuses, master data, audit trails — is written to and read from Supabase first. No other system (Google Sheets, Google Drive, a cache layer) is ever treated as authoritative. Google Sheets and Google Drive are downstream consumers of Supabase data, not alternative stores of record (see `docs/DATA_SYNCHRONIZATION.md`, `docs/GOOGLE_DRIVE_ARCHITECTURE.md`, and `docs/adr/ADR-001-Supabase.md`).

## 4. One Direction of Data Flow for Reporting

Data flows from Supabase outward to Google Sheets for reporting, and from a module outward to Google Drive for media. Neither Sheets nor Drive ever write back into Supabase as part of normal operation. Where a sheet today is used as a read-only reference list, that usage is documented as a known exception, not a pattern to extend (see `docs/DATA_SYNCHRONIZATION.md`).

## 5. API Conventions Are Platform-Wide, Not Per-Module

Every module's API routes follow the same response shape and the same permission-checking pattern already established by MQR and documented in `shared/admin/API_GUIDE.md`: a consistent `{ ok, error?, <entity>? }` response envelope, and scope-based permission checks (`src/lib/scope.ts`) applied before a handler touches data. A new module does not invent its own response format or its own auth check.

## 6. The Design System Is the UI Contract

A module's UI is built from `shared/ui/` components per `docs/DESIGN_SYSTEM.md`. A module does not introduce its own button styles, table layouts, or color palette. Where a module's need isn't met by an existing shared component, the right fix is to extend the shared component — not to build a local one-off.

## 7. Services Are Boundaries, Not Libraries to Inline

Platform services (`shared/services/*`) are consumed through a defined interface, not copy-pasted into a module. If two modules need the same Google Drive upload behavior, both call the same `upload`/`google-drive` service rather than each maintaining their own integration code. This is the same reuse-before-create principle from `docs/PRODUCT_PHILOSOPHY.md`, applied at the service layer.

## 8. Security and Permissions Are Enforced Centrally

Authentication and permission scoping are implemented once (`shared/services/auth`, `shared/admin/PERMISSION_GUIDE.md`) and applied consistently. A module never re-implements login, session handling, or role checks.

## 9. Documentation Precedes Implementation for Shared Surfaces

Any new shared service, schema change, or cross-module contract is documented (README, guide, or ADR) before or alongside the code that implements it, consistent with `docs/PRODUCT_PHILOSOPHY.md`'s "Documentation First" principle. This sprint's `docs/adr/` records the reasoning behind the foundational choices so future contributors don't have to re-derive it.

## 10. Architecture Changes Are Recorded, Not Implied

A decision that changes how modules interact with shared services, or how the platform is structured, is captured as an ADR (`docs/adr/`). Code review and onboarding should be able to answer "why is it built this way" by pointing at a document, not by asking the original author.
