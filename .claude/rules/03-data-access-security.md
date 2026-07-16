# Rule: Data access & security

- All Supabase access goes through the shared db layer (`db.ts` today,
  `shared/db/` after Sprint 2). No component or API route talks to
  Supabase directly.
- Every table has Postgres RLS **and** is filtered through `applyScope()`
  in application code. Both layers are mandatory for any new table — this
  is the single rule most likely to cause a real cross-tenant data leak if
  skipped.
- Soft delete only for business data (`record_status`/`deleted_by`/
  `deleted_at`). Hard delete is reserved for the `users` table,
  SuperAdmin-only, and should stay that way for any new module's user-like
  data too.
- Role checks only via the shared `scope.ts` predicates. No inline
  `if (role === 'SuperAdmin')` scattered through routes/pages.
- Every write re-validates ownership/scope server-side, regardless of what
  the client request body claims (the existing "zero-leakage" pattern in
  `createRecord()`/`updateRecord()` — re-resolve dealer/branch/technician
  IDs server-side rather than trusting client-sent values).
- Never commit a real secret. Never enter an API token, password, or
  credential into a command, field, or file — including when explicitly
  supplied and authorized by the user. Stop and ask the user to do it
  themselves. See root `CLAUDE.md` for the narrow, already-agreed
  carve-outs (authenticated-browser-session artifacts); do not invent new
  ones without asking first.
