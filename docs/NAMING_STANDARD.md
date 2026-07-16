# Naming Standard

A consistent naming convention lets any contributor predict where something lives without searching. The conventions below are extended from patterns already in use in the current codebase (e.g. `src/lib/`) and formalized as the platform-wide standard for all future modules and shared code.

## Modules

- Directory name: lowercase, kebab-case, business-meaningful — e.g. `modules/maintenance/` (PM Record's technical domain name, per the Architecture Refactoring pass — business wording stays "PM"), `modules/new-tractor-delivery/`, `modules/parts-request/`.
- A module's internal structure mirrors `modules/template/` (see Sprint 1 scaffolding).
- A module name should match the business module name used in `docs/VISION.md`, just kebab-cased.

## Components

- React component files: PascalCase, matching the exported component — e.g. `KpiCard.tsx`, `StatusBadge.tsx`, `DealerSelect.tsx`.
- Shared, reusable components live in `shared/ui/`; module-specific components live inside that module's own directory.
- Component names describe what they are, not where they're used — `KpiCard`, not `DashboardTopBox`.

## Services

- Each platform service is a directory under `shared/services/<service-name>/`, named after its responsibility, not its vendor — `google-drive`, not `gdrive` or `drive-v2`; `pdf`, not `react-pdf-service` (see `docs/PLATFORM_SERVICES.md` for the full list).
- A service's public entry point exports clearly named functions describing the action, not the implementation — e.g. `uploadFile()`, not `driveApiCall()`.

## Database Tables (Supabase)

- Table names: lowercase, snake_case, plural — e.g. `dealers`, `branches`, `problem_codes`, `vehicles`.
- Every table that participates in synchronization or auditing has an `updated_at` timestamp column, consistent with `docs/DATA_SYNCHRONIZATION.md`'s incremental-sync design.
- Foreign key columns are named `<referenced_table_singular>_id` — e.g. `dealer_id`, `branch_id`.

## API Routes

- Next.js App Router route files follow REST-ish, resource-based paths — e.g. `src/app/api/dealers/route.ts`, `src/app/api/vehicles/[serial]/route.ts`.
- Every route returns the platform-standard response envelope `{ ok, error?, <entity>? }`, already documented in `shared/admin/API_GUIDE.md` — a new module's API does not introduce a different shape.

## Google Drive (folders and files)

- Top-level folder per business module; sub-folders by record/entity, then by record identifier — see `docs/GOOGLE_DRIVE_ARCHITECTURE.md` for the full structure and file-naming convention.
- File names are descriptive and collision-resistant: `<record-id>_<category>_<timestamp>.<ext>`, never a bare original filename from a phone camera.

## Environment Variables

- Uppercase, snake_case, prefixed by concern — e.g. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_REFRESH_TOKEN`, `RESEND_API_KEY`.
- A variable's prefix should make its owning service obvious without opening the file that consumes it.
- Secrets are never prefixed `NEXT_PUBLIC_`; only genuinely public, non-sensitive values use that prefix, consistent with Next.js's client/server boundary.

## Types

- Type and interface names: PascalCase, singular — e.g. `Dealer`, `WarrantyClaim`, `SessionUser`.
- Shared cross-module types live in a module's (or shared layer's) `types.ts`, matching the existing `src/lib/types.ts` convention.
- A type name should match the entity it represents, not the table or file it came from — `Dealer`, not `DealersRow`.

## Hooks

- Custom React hooks: camelCase, prefixed `use` — e.g. `useSession()`, `usePermission()`, `useDebouncedSearch()`.
- A hook's name describes the value or behavior it provides, not its internal implementation.

## Utilities

- Utility/helper files: camelCase, named after their responsibility — e.g. `thaiDate.ts`, `fetchJson.ts`, `exportExcel.ts` (matching existing `src/lib/` conventions).
- A utility function name is a verb phrase describing the action — `formatThaiDateTime()`, `fetchJson()` — not a vague noun.

## General Rule

When a new name doesn't obviously fit one of the categories above, prefer matching the closest existing convention in `src/lib/` or `shared/` over inventing a new style. Naming consistency is part of the platform's "Consistency" principle (`docs/PRODUCT_PHILOSOPHY.md`), not a cosmetic concern.
