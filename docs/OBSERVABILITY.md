# Observability

Observability is how the platform answers "is it working, and if not, why" without guessing. It is composed of five concerns, each backed by a platform service from `docs/PLATFORM_SERVICES.md`.

## Logging

- Structured, consistent log output across every module and service via the `logging` service — not ad-hoc `console.log` calls scattered per module.
- Logs capture enough context (which module, which operation, which record/user where relevant) to diagnose an issue without reproducing it live.
- Logs are the first artifact checked when investigating a sync discrepancy (`docs/DATA_SYNCHRONIZATION.md`) or a failed scheduled job (`docs/SCHEDULER_ARCHITECTURE.md`).

## Health Checks

- The `monitoring` service runs periodic health checks (triggered by the `scheduler`'s 01:00 Health Check job) covering: database connectivity, Google Drive API reachability, and the outcome of the most recent data sync.
- A health check's job is to detect a problem early — before a dealer or staff member notices broken functionality — not to fix it automatically.

## Monitoring

- Beyond scheduled health checks, monitoring tracks operational signals over time (job durations, failure rates) so degradation is visible as a trend, not only as a binary up/down state.
- Monitoring data feeds the `notification` service when a threshold is crossed (e.g. a sync job failing repeatedly).

## Notifications

- When monitoring detects a problem, the `notification` service is responsible for alerting the right people — this is the same notification service used for in-app, user-facing notifications (`docs/DESIGN_SYSTEM.md`), reused for operational alerting rather than building a separate alerting pipeline.
- Operational alerts are distinct from user-facing notifications in audience and urgency, but share the same delivery mechanism (e.g. email via `resend`) where that's sufficient.

## Audit Trail

- The `audit` service records who did what, when, to which record, across every module — distinct from application logging, which is about system behavior rather than user actions.
- Audit data is what `shared/ui/`'s Timeline component (`docs/DESIGN_SYSTEM.md`) renders on a record's detail view, and what the daily Google Sheets snapshot can serve as an independent, human-readable corroboration of (`docs/DATA_SYNCHRONIZATION.md`).
- Audit records are never deleted or edited after the fact — an audit trail that can be altered isn't a trustworthy one.

## Why This Matters Now

None of `logging`, `monitoring`, `notification`, or `audit` are implemented yet as platform services (per this sprint's documentation-only scope). Defining them together here ensures they're built as one coherent observability story rather than four unrelated, inconsistent mechanisms added independently as each becomes urgently needed.
