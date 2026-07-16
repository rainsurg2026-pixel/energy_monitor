# ADR-008: Google Drive Decoupling for NTR Legacy Import

## Problem

The NTR Legacy Import pipeline (Upload → Preview → Confirm → Commit) uploaded the operator's file to Google Drive synchronously, inside `POST /api/ntr/import/preview`, before any parsing or validation happened (`uploadFileToDrive()` in the old `preview/route.ts`). `commit()` then re-fetched the file from that Drive URL to re-validate it server-side before writing `ntr_records`/`vehicles`.

This made a live, production Legacy Import run depend on Google Drive's OAuth2 refresh-token lifecycle being healthy at that exact moment (see `docs/operations/OPERATIONS_RUNBOOK.md` §3.1 — Drive's refresh token can expire or be revoked, surfacing as `invalid_grant`). A Drive outage or expired token meant the entire import — including rows that had nothing to do with file storage — could not proceed, even though Drive's actual role here (retaining a copy of the original uploaded file for audit purposes) has nothing to do with the correctness of the business data being registered.

Separately, the three writes a successful row produces (a `vehicles` row if the tractor didn't exist yet, the `ntr_records` row itself, and the `vehicle_events`/`record_audit_log` timeline and audit entries) were made through several independent Supabase REST calls in sequence, with no transactional guarantee — a failure partway through (e.g. between creating the vehicle and creating the NTR record) could leave a vehicle with no corresponding registration.

## Decision

Google Drive becomes an **archive-only** destination for Legacy Import, never a dependency of the transaction that actually registers a tractor:

1. **Upload → Parse → Validate → Duplicate Detection → Preview** are unchanged, except the uploaded file's bytes are now stored directly in Postgres (`ntr_import_sessions.file_content`, base64), not Drive. Preview never calls Drive.
2. **Commit** re-parses from `file_content` (same re-validate-server-side-never-trust-the-client property as before, just reading from Postgres instead of re-fetching a Drive URL) and, for each valid row, calls a new Postgres function, `commit_ntr_legacy_import_row()` (`SECURITY DEFINER`, pinned `search_path`), via `NtrRepository.commitLegacyImportRow()`. One RPC call is one Postgres transaction: Tractor (`vehicles`) + NTR (`ntr_records`) + Timeline (`vehicle_events`) + Audit (`record_audit_log`) either all commit together or none do. The function does persistence only — validation, duplicate pre-checking, and customer-name composition all still happen in `NtrImportService`/`ntrService.ts`, unchanged.
3. Once committed, the session moves `Imported → Archive Pending`. A separate step, `NtrImportService.archiveSession()`, uploads the stored file to Drive and marks the session `Archived` (clearing `file_content`) or `Archive Failed` (incrementing `archive_attempts`, recording `archive_error`) — never touching `ntr_records`/`vehicles` either way. `Archive Failed` is retryable via the Archive Queue (`GET/POST /api/ntr/import/archive`, SuperAdmin only, surfaced in the existing Legacy Import admin page).
4. Timeline events for imported rows reuse the existing `NTR_CREATED`/`NTR_COMPLETED` event codes (the same ones the manual registration flow publishes) rather than introducing import-specific codes — a tractor registration is one business event regardless of how it was entered. Provenance (`source: 'legacy_import'`, the session id) is recorded in `metadata`, not by forking the event vocabulary.

## Alternatives Considered

- **Keep Drive synchronous but retry on failure** — rejected: still makes a successful import wait on an external API with its own credential-expiry failure mode; doesn't address the multi-call transaction gap either.
- **Move the whole commit into a queue/worker (e.g. a job table processed by a cron)** — rejected for this sprint: the platform has no existing background-job infrastructure, and the business requirement is specifically that the *DB write* stays synchronous and immediate (the operator sees the import result right away); only the *archival* step needed to become asynchronous/retryable.
- **New event codes for import-originated registrations** — considered, then rejected per explicit engineering decision: timeline events represent business events, not ingestion method: legacy import, manual registration, and any future API integration must publish the same event vocabulary, with origin captured as metadata instead.
- **`bytea` column for `file_content`** — rejected in favor of base64 `text`: avoids PostgREST's bytea hex-encoding ambiguity entirely, at the cost of ~33% more storage for what is, in practice, a small (\<few MB) spreadsheet.

## Consequences

- A Legacy Import run now succeeds or fails purely on the health of Supabase/Postgres — Google's OAuth token lifecycle can no longer block it.
- `commit_ntr_legacy_import_row()` necessarily duplicates a small amount of logic that also exists in TypeScript: `ntr_number` generation (mirrors `next_job_seq()`'s existing bucket-key convention) and the two NTR event titles (mirrors `VehicleEventPublisher.publishNtrCreated/Completed`). This is an accepted, deliberately minimized trade-off — there is no cross-request transaction primitive in `supabase-js`, so true atomicity requires one server-side function call. If either of those two things changes in `ntrService.ts`/`publisher.ts`, this function must be updated to match, or NTR-imported records will silently drift from manually-created ones.
- Archiving is not automatic on a timer — there is no cron/queue infrastructure in this project (Vercel Hobby plan, no worker process). A Super Administrator must visit the Legacy Import page (which lists the Archive Queue) or explicitly trigger "Process Entire Queue"/"Retry" for a session to actually reach Drive. This is an accepted, explicitly-stated limitation, not an oversight.
- `ntr_import_sessions.original_file_url` now only gets populated once archiving succeeds, rather than synchronously at preview time — no other code reads this table, so this is a non-breaking change in practice.
