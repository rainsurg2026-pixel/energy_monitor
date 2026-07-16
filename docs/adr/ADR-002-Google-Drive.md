# ADR-002: Google Drive as the Media Repository

## Context

Every module produces media — photos of equipment/work, videos, generated PDFs — that must be stored somewhere durable, shareable, and accessible to non-technical staff (dealers, reviewers) without requiring them to use the application itself to view a file. The current codebase already has a partial Google Drive integration (`src/lib/googleDrive.ts`, OAuth2 setup via `scripts/get-google-refresh-token.mjs`). This sprint decides whether to formalize Drive as the platform-wide media store or move to an alternative.

## Decision

Google Drive is the platform's media repository for all modules. Media is never stored as binary data inside Supabase; Supabase stores only references (URLs/IDs) to files in Drive. The target folder structure and naming convention are defined in `docs/GOOGLE_DRIVE_ARCHITECTURE.md`, and all Drive access goes through the `google-drive` platform service (`docs/PLATFORM_SERVICES.md`) rather than modules calling the Drive API directly.

## Alternatives Considered

- **Cloud object storage (e.g. S3-compatible storage, or Supabase Storage itself)** — rejected for now: would offer better API ergonomics and access control, but loses the immediate human-browsability that Google Drive gives non-technical staff (dealers, managers) who today already expect to find files in a familiar Drive folder structure, and would require migrating the existing working integration with no functional gain identified for this sprint's scope.
- **No centralized media store (module-local storage)** — rejected: directly conflicts with "Shared Media Storage" in `docs/VISION.md` and would fragment access control and retention policy per module.

## Consequences

- The platform depends on Google's API quotas, availability, and OAuth credential lifecycle (the refresh-token script already reflects this dependency).
- Media access control is bounded by what Google Drive's sharing model supports, which is coarser than a custom-built permission system — `docs/GOOGLE_DRIVE_ARCHITECTURE.md`'s Permissions section sets the working convention (service-account ownership, scoped link sharing) given this constraint.
- Centralizing through one `google-drive` service means a future change of storage backend (if ever needed) is a single-service migration, not a per-module rewrite — this is the direct benefit of accepting the current coupling to Drive.
