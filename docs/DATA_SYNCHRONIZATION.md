# Data Synchronization

## Architecture

```
Supabase (source of truth) ──daily, incremental──▶ Google Sheets (reporting mirror)
```

Data flows one way: **Supabase → Google Sheets.** Google Sheets is never written back into Supabase as part of this architecture.

## Purpose

Google Sheets is **not** the production database. It exists so that:

- **Daily Snapshot** — a point-in-time copy of operational data is available without querying production directly.
- **Reporting** — dealer and business teams who work in spreadsheets get a familiar surface without needing database access.
- **Power BI** — Sheets (or the underlying data) can be connected as a data source for dashboards.
- **Excel** — data can be downloaded/exported by anyone who needs offline analysis.
- **Audit** — a daily snapshot provides a low-tech, human-readable trail of how key data looked on a given day, independent of the database's own audit log (`docs/PLATFORM_SERVICES.md` → `audit`).

## Design

- **Daily Sync:** runs once per day at **00:00 GMT+7**, triggered by the `scheduler` service (`docs/SCHEDULER_ARCHITECTURE.md`).
- **Incremental Sync via `updated_at`:** each sync run only processes rows whose `updated_at` timestamp is newer than the last successful sync, rather than rewriting entire sheets every run. This requires every synchronized table to maintain an accurate `updated_at` column (see `docs/NAMING_STANDARD.md`).

## Retry Policy

- A failed sync attempt is retried automatically a small, fixed number of times with backoff before being marked failed for that run.
- Retries operate on the same incremental window — a retry does not re-process rows already confirmed synced, to avoid duplicate writes into the destination sheet.

## Failure Recovery

- If a sync run fails after exhausting retries, the previous day's snapshot remains in place (the sync overlays/updates rows rather than truncating the sheet first) — a failed run degrades to "yesterday's data" rather than to "no data."
- A failed run is recorded so it can be investigated and, in the future, manually re-triggered (see "Future Manual Sync" below) rather than silently skipped.

## Retention

- Daily snapshots are retained on a rolling basis; the exact retention window is a future operational decision, not fixed by this document. The principle is that retention is bounded and explicit, not "keep forever by accident."

## Synchronization Logs

- Every sync run (success or failure) produces a log entry via the `logging` service: start time, end time, number of rows processed, and outcome.
- Sync logs are the first place to look when a discrepancy between Supabase and a report is reported — see `docs/OBSERVABILITY.md`.

## Future Manual Sync

- The architecture anticipates a future "sync now" capability for administrators, triggered on demand rather than waiting for the next scheduled run. This is not implemented in this sprint; it is noted here so the daily-sync design doesn't have to be reworked to add it later.

## Current State vs. This Architecture — Important Distinction

No part of the Supabase → Sheets daily sync described above exists yet. The only existing Google Sheets integration in the codebase today is `src/lib/tractorSheet.ts`, which is materially different in both direction and purpose:

- It is **read-only**: the application reads from an existing "Tractor IN" reference sheet via a public CSV export endpoint (no Google API credentials involved).
- It is **not derived from Supabase** — the sheet is an independently maintained warehouse intake list, used to confirm a serial number is real and to supply model/engine/product code.
- It is **narrow in scope** — one reference list, not a general reporting mirror.

This existing integration is not the foundation the daily sync is built on, and the two should not be conflated when this architecture is eventually implemented. Whether `tractorSheet.ts`'s read path continues to exist alongside the new sync, or is eventually superseded by it, is a future implementation decision outside this sprint's scope.
