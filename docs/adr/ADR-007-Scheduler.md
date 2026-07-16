# ADR-007: A Generic Scheduler Service for Recurring Platform Jobs

## Context

The platform needs several recurring, time-triggered jobs — data synchronization, database backup, temporary file cleanup, health checks (`docs/SCHEDULER_ARCHITECTURE.md`) — and more will likely be added as the platform grows (e.g. a future weekly report). This sprint decides whether these are implemented as independent, one-off scheduled tasks or as instances of one generic scheduler service.

## Decision

A single `scheduler` platform service owns "when" recurring jobs run; the job logic itself lives in the service it belongs to (e.g. sync logic in `synchronization`, not in the scheduler). The four initial jobs — Data Synchronization (00:00 GMT+7), Database Backup (00:15), Temporary File Cleanup (00:30), Health Check (01:00) — are registered with this service rather than implemented as four separate, independently-scheduled scripts. The interface is designed for future extensibility: registering a fifth job should not require modifying the scheduler's internals.

## Alternatives Considered

- **Independent cron jobs/scheduled functions per concern, with no shared scheduler abstraction** — rejected: would work for four jobs today, but each new recurring need (and the platform anticipates several — `docs/PLATFORM_SERVICES.md` already lists `monitoring`, `audit`, etc. as candidates) would mean another bespoke scheduling setup, with inconsistent logging/failure-handling per job rather than the consistent observability `docs/OBSERVABILITY.md` calls for.
- **A third-party job-scheduling SaaS** — not rejected as a possible execution backend, but rejected as the primary abstraction the platform codes against: the platform still wants its own stable "register a job" interface so the underlying scheduling mechanism (Vercel scheduled functions, or something else later) can change without every job's registration code changing.
- **Running all four jobs as one combined script at midnight** — rejected: collapses jobs with different concerns and different appropriate failure-handling (a backup failure shouldn't block a health check) into one unit, and removes the explicit sequencing rationale (sync, then backup, then cleanup, then health check) documented in `docs/SCHEDULER_ARCHITECTURE.md`.

## Consequences

- Every recurring job gets consistent logging and monitoring "for free" by going through one scheduler interface, supporting `docs/OBSERVABILITY.md`'s goal of one coherent observability story.
- The scheduler itself becomes a piece of shared infrastructure whose own reliability matters platform-wide — its health is part of what the Health Check job and `monitoring` service should be able to verify.
- This ADR does not select a specific scheduling backend/provider; that remains an implementation decision for when the scheduler is actually built, which is out of scope for this sprint.
