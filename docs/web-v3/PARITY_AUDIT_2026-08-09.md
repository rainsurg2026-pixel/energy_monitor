# Energy Monitor Web vs Desktop v2.3.1 Parity Audit

Date: 2026-08-10  
Baseline: Desktop application version `2.3.1`  
Branch audited: `feat/web-v3` (working tree release audit, 2026-08-10)

## Evidence collected

- `npm.cmd run vercel-build`: passed.
- `npm.cmd run test:domain-parity`: passed, 24/24 assertions, formula version `desktop-v2.3.1`.
- `npm.cmd run test:web-section-save-parity`: passed; per-section save timestamps, imported timestamp preservation, API `changed_sections` validation and optimistic versioning.
- `npm.cmd run test:phase3`: passed, authentication/security suites and 54 API assertions.
- `npm.cmd run test:phase6`: passed, 20 assertions.
- `npm.cmd run test:migration-tooling`: passed, 11 assertions.
- `npm.cmd run test:web-reporting`: passed, 18 assertions including Desktop section selection, period range, the 12-row historical-window rule and verified Rack Unit image embedding.
- `npm.cmd run test:web-report-artifacts`: passed, 14 assertions; PDF/PNG validation and the Desktop ZIP member contract.
- `npm.cmd run test:web-chromium-renderer`: passed; real local Chromium produced validated PDF and PNG artifacts.
- `npm.cmd run test:web-import`: passed, 20 assertions including monthly/Rack/history/image-source import, transaction rollback, backup restore, source-hash idempotency, and provenance hash.
- `npm.cmd run test:web-integrity`: passed, 5 assertions with explicit Postgres-projection scope.
- `npm.cmd run test:web-workbook-export`: passed, 7 assertions including readable XLSX round-trip with Rack Capacity and Rack Unit Capacity sheets.
- `npm.cmd run test:web-workbook-roundtrip`: passed; retained `.xlsm` source returned with VBA/pivot package members preserved.
- `npm.cmd run test:web-workbook-integrity`: passed; Desktop reader validation plus VBA/pivot/chart/drawing evidence.
- `npm.cmd run test:web-google-sheets`: passed; OAuth/PKCE state binding, encrypted verifier storage and fail-closed configuration boundary.
- `npm.cmd run test:rack-capacity-image-embed`: passed for both production workbook fixtures; unrelated OOXML/VBA/pivot parts remained unchanged.
- `npm.cmd run test:all-report:pdf`: passed; Desktop native PDF baseline produced 17 pages / 172,203 bytes.
- `npm.cmd run test:rack-capacity-image-migration`: passed; legacy K9 migration is idempotent and preserves image bytes.
- `npm.cmd run test:rack-unit-capacity-image-history`: passed; multi-month anchors share one drawing and facility isolation is preserved.
- `npm.cmd run test:api`: passed, 54 assertions including the shared engineering-dashboard snapshot and report/export/import/integrity/audit authorization checks.
- `npm.cmd run test:energy-cost-dashboard`: passed, 15 assertions; the regression month is read from Desktop Dashboard-FAC!A32 rather than hard-coded against stale fixture state.
- `npm.cmd run test:save-formatting`: passed, 1,289 checks across Rangsit and Srinakarin; the disposable test-copy active-month/cache alignment preserves VBA bytes and leaves production fixtures unchanged.
- `npm.cmd run lint:server`: passed.
- `npm.cmd run lint`, root TypeScript, and server TypeScript checks passed after the Reporting Center and Web structured-editor parity additions.

## Current Web coverage

The Web shell and API currently cover:

- authentication, session lifecycle, CSRF, RBAC and settings;
- Dashboard, Energy, Cost, Electrical, Site Comparison;
- Dashboard selected-month engineering snapshot with shared UPS, Air, DC and Energy/Cost calculations;
- Rack Capacity and Rack Unit Capacity read views;
- raw monthly-log operational write with optimistic concurrency;
- migrated Postgres data and Desktop calculation parity through the shared domain layer.
- `/reports` with a Postgres-backed adapter that reuses the Desktop report HTML renderer, selected sections and reporting period modes;
- server-side Chromium PDF/PNG/ZIP artifacts using the same report HTML and the Desktop ZIP member contract;
- administrator-only Desktop-compatible workbook import with validation, transactional upsert of monthly/Rack/history/image data, SHA-256 provenance, immutable source retention, backup listing/restore and source-hash idempotency;
- retained-source workbook round-trip export and workbook-package integrity inspection;
- Google Sheets OAuth/PKCE, active-month sync, export-all and import-and-persist routes/UI using the Desktop four-sheet verification service;
- core `.xlsx` export with Summary, UPS Loads, Air Conditioning, DC Power Panels, Energy & Cost, Rack Capacity and Rack Unit Capacity sheets when snapshots exist.
- `/integrity` with missing-month and empty-core-section findings over the Postgres monthly-log projection;
- Desktop-aligned UPS, Air, DC and Energy & Cost section editors, Sticky Entry Toolbar/completion workflow and Srinakarin phase/PPC editing for Web operational entry.

## Confirmed parity gaps

These are required for the requested migration scope and are not redesign items:

1. Local Web implementation now has server-side PDF/PNG/ZIP artifacts, Rack history/image projection, retained-source round-trip/integrity and application-level backup restore. Hosted Chromium, live Storage/DB verification and populated Desktop/Web visual comparison remain open.
2. Google Sheets has the Desktop-compatible server boundary and UI, but real Google OAuth consent, spreadsheet reconciliation and duplicate/read-back evidence require approved external credentials.
3. Supabase PITR/database recovery, Vercel Production environment configuration, authenticated populated UAT and cross-browser/performance verification remain open production gates.
4. Web now reuses the Desktop section editors, Sticky Entry Toolbar/completion workflow, section APIs, save/reset-all behavior and Srinakarin phase/PPC editor. Per-section saved timestamps, historical-save confirmation and validation dialog/section highlighting are implemented; `npm.cmd run test:web-section-save-parity` covers the persistence contract, while the live confirmation and populated facility-profile interaction still require authenticated UAT verification.
5. Full visual comparison against authenticated, populated Desktop and Web screens is still pending because this session has no valid UAT credentials.

The Web calculation API must continue to call the shared Desktop-compatible domain functions. No formula changes are authorized by this audit.

## Release blockers

- Vercel CLI authentication is now available and project linkage is verified. A Preview deployment was created, but `/api/v1/health/ready` returns `503 SERVICE_UNAVAILABLE` with `reason=configuration`; the Preview runtime cannot be approved until the project owner supplies valid application database/TLS/runtime environment values. The Production environment currently has no verified deployment of this release and lacks the required application runtime variables.
- Authenticated Preview UAT still requires approved account credentials. Required action: run `scripts/test-preview-http.ts` with `PREVIEW_URL`, `DEV_ADMIN_PASSWORD` and `PREVIEW_UAT_PASSWORD` after the Preview runtime is ready, then record the result.

This document is an audit record, not a sign-off. The application is not yet declared production-equivalent.
