# Scheduler Architecture

The `scheduler` platform service (`docs/PLATFORM_SERVICES.md`) is responsible for running recurring platform jobs at defined times. It does not exist yet — this document defines its target design and the jobs it will own.

## Design

| Time (GMT+7) | Job | Purpose |
|---|---|---|
| 00:00 | Data Synchronization | Triggers the Supabase → Google Sheets daily sync (`docs/DATA_SYNCHRONIZATION.md`). |
| 00:15 | Database Backup | Triggers a Supabase backup/export, scheduled after sync so the backup reflects a post-sync-consistent state. |
| 00:30 | Temporary File Cleanup | Clears any temporary/intermediate files produced by the day's uploads, PDF generation, or sync run (e.g. local conversion artifacts) that shouldn't persist past their job. |
| 01:00 | Health Check | Runs the platform's health checks (database connectivity, Drive API reachability, last sync status) and reports via the `monitoring` service. |

Jobs run in this sequence deliberately: synchronization completes before backup, and cleanup happens after both, so the backup and cleanup steps don't race against in-flight sync work.

## Scheduler Interface — Future Extensibility

The scheduler is designed as a generic "register a job with a schedule and a handler" interface, not as four hardcoded cron entries. Concretely, this means:

- A job is defined by a name, a schedule (time/cadence), and a handler function — adding a fifth job (e.g. a future weekly report) means registering a new entry, not modifying scheduler internals.
- Job handlers live in the service they logically belong to (e.g. the Data Synchronization job's logic lives in the `synchronization` service, not inside the scheduler itself) — the scheduler triggers; it does not implement business logic (`docs/ARCHITECTURE_PRINCIPLES.md` — services are boundaries).
- Each job's outcome (success, failure, duration) is logged via the `logging` service and surfaced to `monitoring`, so a silently-failing job is something the health check can detect and the `notification` service can alert on.
- The interface should not assume a specific hosting mechanism (e.g. a particular cron provider) — Vercel's scheduled functions are the likely implementation given the platform's hosting choice (`docs/TECH_STACK.md`), but the job-registration interface itself should not be written in a way that locks the platform to one scheduling backend if that ever needs to change.

## Current State

No scheduler exists in the codebase today. This is new, forward-looking architecture, consistent with this sprint's documentation-only scope.
