# Module Checklist

Every new business module must satisfy each item below before it can be considered complete. This is the completeness gate referenced by `docs/BUSINESS_MODULE_STANDARD.md`; each item links to the doc that defines how to actually satisfy it.

- [ ] **Authentication.** Every page and route confirms a valid session before doing anything else. No module invents its own session handling — it uses the existing shared auth flow. See `modules/module-template/api/README.md`, `shared/admin/PERMISSION_GUIDE.md`.

- [ ] **Authorization.** Role and permission checks exist independently in both the page (UX) and the API route (enforcement), per `docs/PERMISSION_MODEL.md`. A module is not complete if access control exists only client-side.

- [ ] **Validation.** Every form's input is validated both client-side (immediate feedback) and server-side (independent re-check in the route) — see `modules/module-template/validation/README.md`. A route that trusts client validation alone fails this item.

- [ ] **Audit.** Create/update/delete and stage transitions (`docs/MODULE_LIFECYCLE.md`) on this module's records are recorded through the shared audit service once it exists (`docs/PLATFORM_SERVICES.md`) — a module does not build its own audit table.

- [ ] **Logging.** Errors and significant events in this module's services and routes go through the shared logging service (`docs/PLATFORM_SERVICES.md`), not `console.log` left in production code.

- [ ] **Upload.** Any file attached to a record goes through `shared/services/upload/` (`docs/PLATFORM_SERVICES.md`) — a module does not implement its own file handling.

- [ ] **PDF.** Any document export goes through `shared/services/pdf/`, including the existing GMT+7 timestamp-correctness expectation (`docs/MODULE_ARCHITECTURE.md` §9, `docs/PLATFORM_SERVICES.md`).

- [ ] **Dashboard.** The module exposes at least one dashboard view built from `shared/ui/` chart/table primitives and scoped data, reachable by every role marked ✅ under Dashboard in `docs/PERMISSION_MODEL.md`.

- [ ] **Search.** Records in this module are findable by the fields a user of that role would reasonably search by — module-specific, but should reuse `shared/ui/`'s existing search input pattern rather than a bespoke one (`docs/COMPONENT_CATALOG.md`).

- [ ] **Filters.** List views support filtering by, at minimum, status (`docs/MODULE_LIFECYCLE.md`) and date range, using shared filter components rather than module-specific ones where one already exists.

- [ ] **History.** A record's stage transitions (`docs/MODULE_LIFECYCLE.md`) and key field changes are visible as a history/timeline on the record itself, not only inferable from the audit log.

- [ ] **Status.** The record's lifecycle field is implemented exactly as `docs/MODULE_LIFECYCLE.md` defines it, and is not confused with or merged into the existing `record_status` soft-delete column (`docs/MODULE_ARCHITECTURE.md` §4).

- [ ] **Notifications.** State changes that matter to another role (e.g. entering Waiting Approval) trigger the shared notification service (`docs/PLATFORM_SERVICES.md`) rather than a module-specific email/SMS implementation.

- [ ] **Responsive.** The module's pages pass the existing manual mobile-responsive check (`docs/MODULE_ARCHITECTURE.md` §9) — usable on a phone-width viewport, not just desktop.

- [ ] **Accessibility.** Interactive elements are keyboard-reachable and labeled (form inputs have associated labels, icon-only buttons have an accessible name) — a new minimum as of Sprint 6; no existing module has been audited against it yet, so this is a forward requirement, not a claim that current modules already pass it.

## Verification

This checklist documents a definition of "done" for a future module. It does not itself implement, audit, or modify any existing module, route, or component.
