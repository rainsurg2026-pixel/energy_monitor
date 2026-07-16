# ADR-001: Supabase as the Platform Database and Source of Truth

## Context

The MSEAL SERVICE SYSTEM needs one authoritative store for operational data across all business modules — records, master data, audit trails, permissions. The current MQR application already uses Supabase (`@supabase/supabase-js`, `src/lib/supabase.ts`, `src/lib/db.ts`) for this purpose. As the platform grows to support multiple modules, this sprint must decide whether Supabase remains the platform-wide standard or whether a different/additional database should be introduced for new modules.

## Decision

Supabase is the platform's database and the single source of truth for all operational data, for every module, present and future. No module introduces its own separate database. Where a module needs a capability Supabase doesn't directly provide (e.g. full-text search, caching), that capability is built as a platform service (`search`, `cache` in `docs/PLATFORM_SERVICES.md`) layered on top of Supabase data, not as a parallel store of record.

Authentication: the platform's official target is Supabase Auth as a principle (`docs/TECH_STACK.md`). The current codebase's `src/lib/auth.ts` implements a custom JWT/session layer (via `jose`) on top of Supabase rather than using Supabase's native Auth client directly. This ADR records Supabase (the project/database) as the source of truth regardless of which auth approach is ultimately standardized — that is a separate, narrower decision left open for a future ADR if needed.

## Alternatives Considered

- **A different managed Postgres provider** (e.g. plain RDS/Cloud SQL) — rejected: would require rebuilding the auth, storage, and realtime conveniences Supabase already provides, with no corresponding benefit given the existing working integration.
- **A NoSQL store** for flexibility on rapidly-changing module schemas — rejected: the platform's data (dealers, branches, records, claims) is relational by nature (foreign keys between dealers/branches/users/records), and consistency guarantees matter more than schema flexibility here.
- **Per-module databases** — rejected: directly conflicts with the "One Platform" and "Shared Services" principles in `docs/VISION.md`; would also break the single Supabase → Google Sheets sync model in `docs/DATA_SYNCHRONIZATION.md`, which assumes one source.

## Consequences

- Every new module's schema lives in the same Supabase project, requiring naming discipline (`docs/NAMING_STANDARD.md`) to avoid collisions and ambiguity across modules.
- The `docs/DATA_SYNCHRONIZATION.md` and `docs/GOOGLE_DRIVE_ARCHITECTURE.md` designs can both assume a single upstream source, simplifying both.
- A Supabase outage is a platform-wide outage — this is an accepted trade-off of "One Platform," not an oversight, and is the reason `docs/OBSERVABILITY.md` treats database connectivity as a primary health check.
- The open question of whether to migrate from the custom `jose`-based session layer to Supabase's native Auth client is deferred to a future sprint/ADR.
