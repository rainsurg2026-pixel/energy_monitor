# ADR-003: Google Sheets as the Reporting and Daily Snapshot Layer

## Context

Business and dealer-facing reporting needs (Power BI dashboards, ad hoc Excel analysis, simple daily review) require a reporting surface that doesn't require direct production database access. The codebase already has one narrow, read-only Google Sheets integration (`src/lib/tractorSheet.ts`, reading an existing reference list). This sprint decides the platform's general approach to reporting data, separate from that existing narrow integration.

## Decision

Google Sheets is the platform's reporting and daily-snapshot layer, populated by a one-way, incremental sync from Supabase (`docs/DATA_SYNCHRONIZATION.md`). Google Sheets is explicitly **not** a production database and is never written back into Supabase. This is new architecture — it is not based on, and does not replace, the existing `tractorSheet.ts` read-only integration, which serves an unrelated purpose (validating serials against an external reference list, not reporting on platform data).

## Alternatives Considered

- **A BI tool connected directly to Supabase** (e.g. Power BI's native Postgres connector) — viable and not precluded long-term, but rejected as the sole approach for this sprint because it doesn't serve the "familiar spreadsheet for non-technical staff" need that Sheets uniquely satisfies, and direct BI-tool access to production widens the production database's exposure surface.
- **Scheduled CSV/Excel export emailed out** — rejected: less useful than a live(ish), incrementally-updated Sheet that multiple people can reference simultaneously, and `exceljs` is already available as a building block but better suited to on-demand exports than a standing daily mirror.
- **Real-time sync instead of daily** — rejected for this sprint: real-time sync adds significant complexity (conflict handling, rate limits against the Sheets API) for a use case (daily reporting, daily snapshot) that doesn't need sub-day freshness; daily at 00:00 GMT+7 is sufficient and matches `docs/SCHEDULER_ARCHITECTURE.md`.

## Consequences

- Reporting consumers must understand the data is up to one day old by design — this is a documented trade-off, not a defect.
- The incremental `updated_at`-based sync requires every synchronized table to maintain that column accurately (`docs/NAMING_STANDARD.md`), which is a new discipline some existing tables may not yet follow and will need to adopt when this is implemented.
- The existing `tractorSheet.ts` read-only integration continues to serve its own purpose independently; whether it is eventually folded into or retired in favor of the new sync is left as a future decision, explicitly not resolved by this ADR.
