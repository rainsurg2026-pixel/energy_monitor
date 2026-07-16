# Documentation Index

Entry point for every engineering document in this repository. Start
here; every other doc is reachable from one of the sections below.

## Read this first

- [`CLAUDE.md`](../CLAUDE.md) — what MQR/PM is, tech stack, DB schema,
  RBAC, deployment workflow. The single most load-bearing doc in the repo.
- [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) — how an AI agent should
  operate in this repository, on top of (not instead of) `CLAUDE.md`.
- [`AI_CONTEXT.md`](../AI_CONTEXT.md), [`PROJECT_STATE.md`](../PROJECT_STATE.md)
  — current project state snapshots.

## Engineering standards (`docs/standards/`)

Binding conventions every current and future module follows. Created by
the Release 1.0 Engineering Governance Sprint, grounded in how MQR and PM
actually ship today — not a green-field proposal.

- [`MODULE_DEVELOPMENT_STANDARD.md`](standards/MODULE_DEVELOPMENT_STANDARD.md)
  — the layered structure and completeness checklist every module
  (repository, service, validation, authorization, audit, timeline,
  attachment, localization, PDF, CSV, search, history, permission, tests,
  documentation) must satisfy.
- [`API_STANDARD.md`](standards/API_STANDARD.md) — request/response
  envelope, pagination, sorting, filtering, error codes, versioning.
- [`DATABASE_STANDARD.md`](standards/DATABASE_STANDARD.md) — naming,
  keys, soft delete, audit fields, timestamps, indexes, dealer scope,
  migration naming.
- [`SECURITY_STANDARD.md`](standards/SECURITY_STANDARD.md) — dealer
  isolation, RBAC, server-side authorization, input/upload validation,
  attachment access, Google Drive integration, audit logging, and why
  every role boundary here is application-layer (no Supabase Auth).
- [`EVENT_CATALOG.md`](standards/EVENT_CATALOG.md) — the canonical Vehicle
  Life Cycle timeline event codes (`vehicle_events`/`event_definitions`),
  which modules actually publish today, and how a new module wires in.
- [`NTR_IMPORT_MANUAL.md`](standards/NTR_IMPORT_MANUAL.md) — the Legacy
  Import template's exact column order, required/optional fields, and
  how to extend it for a future field.
- [`TESTING_STANDARD.md`](standards/TESTING_STANDARD.md) — unit,
  integration, security, permission, and regression test expectations;
  coverage bar.
- [`GIT_BRANCH_STANDARD.md`](standards/GIT_BRANCH_STANDARD.md) — branch
  model, naming, Semantic Versioning release policy, PR quality gates.
- [`DOMAIN_LANGUAGE_STANDARD.md`](standards/DOMAIN_LANGUAGE_STANDARD.md)
  — canonical business terminology (Tractor vs. Vehicle), the Dealer
  Standard (Dealer Code as primary identifier, report-number format),
  localization rules. Binding for every new feature/page/PDF/CSV/API.
- [`UI_COMPONENT_STANDARD.md`](standards/UI_COMPONENT_STANDARD.md) —
  frozen design tokens (spacing, typography, color, status colors, icon
  usage, button hierarchy) and the shared component inventory
  (`PageHeader`, `StatusPill`, `Card`, `Timeline`, `AttachmentGallery`,
  `SearchToolbar`, `DetailRow`, shared PDF theme).

## Architecture

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current production architecture
  (everything under `src/`) side by side with the target modular layout
  (`modules/`/`shared/`/`templates/`) — that migration has not happened;
  build new modules inside `src/` per `MODULE_DEVELOPMENT_STANDARD.md`
  until an explicit migration sprint says otherwise.
- [`architecture/SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md)
- [`ARCHITECTURE_PRINCIPLES.md`](ARCHITECTURE_PRINCIPLES.md)
- [`MODULE_ARCHITECTURE.md`](MODULE_ARCHITECTURE.md),
  [`MODULE_GUIDE.md`](MODULE_GUIDE.md),
  [`MODULE_CHECKLIST.md`](MODULE_CHECKLIST.md),
  [`MODULE_LIFECYCLE.md`](MODULE_LIFECYCLE.md) — the target-architecture
  module contract; `MODULE_DEVELOPMENT_STANDARD.md` is the same substance
  restated against the structure that actually exists today.
- [`BUSINESS_MODULE_STANDARD.md`](BUSINESS_MODULE_STANDARD.md) — index of
  per-module conventions (folder structure, naming, permissions, routing,
  shared services/UI, API usage, validation, PDF, upload, Drive,
  reporting, lifecycle).
- [`PLATFORM_SERVICES.md`](PLATFORM_SERVICES.md) — the shared-service
  catalogue (auth, upload, Drive, PDF, sync, scheduler, notification,
  audit, logging, monitoring, cache, search).
- [`NAMING_STANDARD.md`](NAMING_STANDARD.md) — naming conventions for
  modules, components, services, DB tables, API routes, Drive
  folders/files, env vars, types, hooks, utilities.
- [`PERMISSION_MODEL.md`](PERMISSION_MODEL.md) — target six-role
  permission matrix, mapped against the current production four-role
  `Role` type in `src/lib/scope.ts`.
- [`FUTURE_MODULE_DEPENDENCY.md`](FUTURE_MODULE_DEPENDENCY.md)
- [`CORE_DOMAIN_MODEL.md`](CORE_DOMAIN_MODEL.md),
  [`ENTITY_MODEL.md`](ENTITY_MODEL.md),
  [`ENTITY_RELATIONSHIP.md`](ENTITY_RELATIONSHIP.md),
  [`MASTER_DATA.md`](MASTER_DATA.md)
- [`DATA_SYNCHRONIZATION.md`](DATA_SYNCHRONIZATION.md),
  [`GOOGLE_DRIVE_ARCHITECTURE.md`](GOOGLE_DRIVE_ARCHITECTURE.md),
  [`SCHEDULER_ARCHITECTURE.md`](SCHEDULER_ARCHITECTURE.md),
  [`SEARCH_MODEL.md`](SEARCH_MODEL.md),
  [`DASHBOARD_MODEL.md`](DASHBOARD_MODEL.md),
  [`OBSERVABILITY.md`](OBSERVABILITY.md),
  [`ADMIN_FRAMEWORK.md`](ADMIN_FRAMEWORK.md)
- [`engineering/MACHINE_DOMAIN.md`](engineering/MACHINE_DOMAIN.md) —
  Phase 5B's Machine business entity: the `src/features/machine/` facade,
  what did/didn't get renamed, and the Product Hierarchy.
- [`architecture/MACHINE_PASSPORT_ARCHITECTURE.md`](architecture/MACHINE_PASSPORT_ARCHITECTURE.md),
  [`architecture/MACHINE_PASSPORT_SCREEN_CONTRACT.md`](architecture/MACHINE_PASSPORT_SCREEN_CONTRACT.md),
  [`architecture/MACHINE_LIFECYCLE.md`](architecture/MACHINE_LIFECYCLE.md),
  [`architecture/MACHINE_DATA_OWNERSHIP.md`](architecture/MACHINE_DATA_OWNERSHIP.md) —
  Machine Digital Passport v1.0 (`docs/adr/ADR-026-Machine-Digital-Passport.md`):
  the `/machines`/`/machines/[machineId]` aggregation layer built on top of
  the Machine Domain facade, its screen contract, lifecycle-stage
  derivation, and the honest data-model gaps (Manufacturing Year/Country,
  Variant, Owner History, no dedicated Warranty table) it does not paper over.
- [`engineering/ATTACHMENT_FRAMEWORK.md`](engineering/ATTACHMENT_FRAMEWORK.md),
  [`engineering/MEDIA_PLATFORM.md`](engineering/MEDIA_PLATFORM.md) —
  Phase 5B's shared file-storage platform (`src/shared/attachments/`):
  data model, provider independence, archive lifecycle, retention policy,
  and what's deliberately not yet migrated onto it.
- [`PLATFORM_BASELINE.md`](PLATFORM_BASELINE.md) — **start here for the
  Storage Platform's current, frozen state.** Overview, architecture,
  implemented/operational services, governance, CI enforcement, release
  status, production prerequisites, known limitations, roadmap.
  [`architecture/PLATFORM_ARCHITECTURE_STANDARDS.md`](architecture/PLATFORM_ARCHITECTURE_STANDARDS.md)
  is the permanent policy behind it; `engineering/STORAGE_PLATFORM_FINAL.md`/
  `STORAGE_PLATFORM_DECISION.md` are the detailed architecture/rationale
  references; `engineering/ARCHITECTURE_ENFORCEMENT.md` documents the
  automated `npm run architecture` check; `engineering/STORAGE_HYGIENE.md`/
  `STORAGE_OPERATIONS.md` cover the orphan-cleanup and health/metrics/audit
  operational layer.

## Design & UI

- [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md), [`COMPONENT_CATALOG.md`](COMPONENT_CATALOG.md),
  [`SHARED_UI_ANALYSIS.md`](SHARED_UI_ANALYSIS.md) — check before building
  a new component; the `UI_COMPONENT_STANDARD.md` shared inventory is
  usually enough.

## Decisions (ADRs)

- [`adr/ADR-001-Supabase.md`](adr/ADR-001-Supabase.md)
- [`adr/ADR-002-Google-Drive.md`](adr/ADR-002-Google-Drive.md)
- [`adr/ADR-003-Google-Sheets.md`](adr/ADR-003-Google-Sheets.md)
- [`adr/ADR-004-Platform-Services.md`](adr/ADR-004-Platform-Services.md)
- [`adr/ADR-005-Design-System.md`](adr/ADR-005-Design-System.md)
- [`adr/ADR-006-Module-Architecture.md`](adr/ADR-006-Module-Architecture.md)
- [`adr/ADR-007-Scheduler.md`](adr/ADR-007-Scheduler.md)
- [`adr/ADR-009-Machine-Domain.md`](adr/ADR-009-Machine-Domain.md)
- [`adr/ADR-010-Attachment-Platform.md`](adr/ADR-010-Attachment-Platform.md)

## Product & vision

- [`VISION.md`](VISION.md), [`PRODUCT_PHILOSOPHY.md`](PRODUCT_PHILOSOPHY.md),
  [`BUSINESS_WORKFLOW.md`](BUSINESS_WORKFLOW.md), [`TECH_STACK.md`](TECH_STACK.md),
  [`DEVELOPMENT_GUIDE.md`](DEVELOPMENT_GUIDE.md), [`ROADMAP.md`](ROADMAP.md)

## Deployment & operations

- [`deployment/DEPLOYMENT_GUIDE.md`](deployment/DEPLOYMENT_GUIDE.md)
- [`operations/OPERATIONS_RUNBOOK.md`](operations/OPERATIONS_RUNBOOK.md)
- [`releases/RELEASE_CHECKLIST_V1.md`](releases/RELEASE_CHECKLIST_V1.md)
  — environment, Google Drive, Supabase, storage/backup/restore,
  deployment, smoke test, rollback checklist for every production
  deployment.
- [`releases/MASP_PLATFORM_FOUNDATION_V1.1.md`](releases/MASP_PLATFORM_FOUNDATION_V1.1.md)
  — the official v1.1.0 release baseline: all four modules, the shared
  DealerBranchScope authorization standard, all four Foundation platforms
  (feature-frozen), verification, known limitations. **Start here for
  current release status.**
- [`releases/archive/MASP_PLATFORM_FOUNDATION_V1.0.md`](releases/archive/MASP_PLATFORM_FOUNDATION_V1.0.md)
  — archived: superseded by v1.1.0 above.
- [`releases/archive/RC1_RELEASE_NOTES.md`](releases/archive/RC1_RELEASE_NOTES.md)
  — archived: Release 1.0 candidate notes for an earlier, narrower
  scope, superseded by the baseline above.

## How these fit together

For a new module (NTR, PDI, Warranty, Campaign, Dashboard, AI Copilot):

1. Read `CLAUDE.md`, `ARCHITECTURE.md`, and `standards/MODULE_DEVELOPMENT_STANDARD.md` first.
2. Follow `standards/DATABASE_STANDARD.md` for schema, `standards/API_STANDARD.md`
   for every route, `standards/SECURITY_STANDARD.md` for every
   permission/scope check.
3. Write tests per `standards/TESTING_STANDARD.md` as you go, not after.
4. Use `standards/DOMAIN_LANGUAGE_STANDARD.md` for every user-facing
   string and `standards/UI_COMPONENT_STANDARD.md` for every page/component.
5. Branch, commit, and version per `standards/GIT_BRANCH_STANDARD.md`.
6. Before merge, satisfy every Quality Gate in `standards/GIT_BRANCH_STANDARD.md`.

Where an older doc (e.g. `MODULE_CHECKLIST.md`, `PERMISSION_MODEL.md`)
describes a **target** state ahead of current production (a six-role
model, a `modules/`/`shared/` folder layout), the newer `standards/*`
documents describe what a module actually does **today** and take
precedence for anything they cover; the older docs remain the record of
where the platform is headed.
