# Rollback Plan — Energy Monitor Web v3

This repository's own `.claude/rules/git.md` already sets the top-level
rule: **if Production validation fails after a merge, do not silently patch
`main` directly — open a dedicated rollback or hotfix PR and document the
reason in it.** Everything below is the operational detail underneath that
rule, specific to this stack (Vercel + Supabase Postgres + Express API).

## 0. First move in any incident: Read-Only Mode, not a rollback

Before rolling anything back, consider whether flipping `READ_ONLY_MODE=true`
in the affected environment's Vercel project settings is enough to stop the
bleeding. It immediately blocks every mutating route (`POST`/`PUT`/`PATCH`
except login/logout/change-password — `server/authz/readOnly.ts`) while
reads keep working, with no deploy required (env var change + redeploy, or
a runtime-config path if one exists — confirm which before relying on it
under pressure). This buys time to diagnose without taking the app fully
down, and without needing any of the steps below yet.

## 1. Application/deployment rollback (Vercel)

Vercel deployments are immutable and independently addressable — the
previous good deployment is not deleted when a new one goes live.

1. In the Vercel dashboard (or `vercel rollback` via CLI, if available), find
   the last known-good Production deployment for this project
   (`energy-monitor`, per `.vercel/project.json`).
2. **Promote it back to Production** ("Instant Rollback" in Vercel's
   terminology). This repoints the Production domain at the old build
   immediately — no rebuild, no redeploy wait.
3. In parallel, open the dedicated rollback PR the git rules require:
   revert the offending commit(s) on `main` via a normal PR (never
   `git push --force`, never rewrite `main`'s history), state the reason,
   and get it through the same merge policy as any other change once
   validated.
4. Confirm via `GET /api/v1/health` and `/api/v1/health/ready` against the
   Production URL that the rolled-back deployment is actually serving
   traffic, not just that the dashboard says so.

**This alone is sufficient for any incident that is purely a code/logic
regression** — the database schema is additive-only (see §2), so an older
build talking to the current schema is the expected, safe case, not a
special one.

## 2. Database rollback

`db/migrations/001_phase2_foundation.sql` and `002_phase3_auth_security.sql`
are run via `scripts/run-migrations.ts` — a plain sequential-SQL-file
runner with **no down-migrations and no `DROP` statements**; every
migration is `CREATE TABLE IF NOT EXISTS` / additive `ALTER`. There is
currently no tooling to automatically reverse a migration.

**Default position: do not roll back the schema.** An additive-only schema
means an older application build (from §1's rollback) simply doesn't
reference whatever a newer migration added — it's forward-compatible by
construction, as long as every migration going forward keeps this
additive-only discipline. Rolling the *code* back is sufficient for the
overwhelming majority of incidents.

**If a migration itself is the incident** (e.g. a bad constraint blocks
writes, a bug in the migration corrupted data):

1. Do not hand-write a `DROP`/`ALTER ... DROP` against Production directly.
   Write a new, explicit migration (`003_...sql`) that corrects the
   problem forward — this keeps `db/migrations/` as the single source of
   truth for schema history, consistent with how `001`→`002` already work.
2. If data was actually corrupted (not just a blocked constraint), restore
   from the Supabase project's point-in-time recovery or scheduled backup
   — check the Supabase dashboard for what's actually available on this
   project's plan tier before assuming a specific recovery window; this
   document does not assert an RPO/RTO it can't verify.
3. Treat this as the "dedicated rollback/hotfix PR" case explicitly called
   out in `.claude/rules/git.md` — document the reason, the forward-fix
   migration, and the outcome in that PR, not as a silent `main` patch.

## 3. Environment / secret rollback

- **`SESSION_SECRET` rotation:** rotating this value invalidates every
  active session immediately (JWT signature verification fails for
  everyone) — see `docs/web-v3/ADR_AUTHENTICATION_ARCHITECTURE.md`. This is
  not data-destructive; the recovery is simply "every user logs in again."
  Only rotate deliberately (e.g. suspected secret leak), and communicate it
  ahead of time if possible — it is itself a mini-incident to plan, not
  just a rollback target.
- **`DATABASE_URL`/`DIRECT_DATABASE_URL` misconfiguration:** revert to the
  last known-good value in the Vercel project's environment variables and
  redeploy (env var changes require a redeploy to take effect on Vercel).
  Cross-check against `docs/web-v3/PHASE7_1_VERCEL_PREVIEW.md`'s documented
  pooler-vs-direct contract before changing either value under pressure.
- **`CSRF_SECRET` rotation:** invalidates in-flight CSRF tokens (users
  mid-form-submission see a 403 and must retry) but not sessions — lower
  severity than `SESSION_SECRET` rotation.
- General rule: never restore a secret by re-entering it into a command,
  chat, or file by hand — pull it from the environment's own secret store
  (Vercel project settings) or a secrets manager, never from a paste.

## 4. Escalation

1. Flip Read-Only Mode (§0) if the incident involves writes.
2. Instant-rollback the Vercel deployment (§1) if the incident is code.
3. Open the dedicated rollback/hotfix PR in parallel — never patch `main`
   directly, per `.claude/rules/git.md`.
4. If data integrity is in question, stop guessing and restore from backup
   (§2) rather than attempting a manual data fix live.
5. Re-run the relevant sections of `PRODUCTION_VERIFICATION_CHECKLIST.md`
   against the rolled-back state before declaring the incident closed —
   "the rollback deployed" is not the same claim as "the rollback works."
6. Document what happened, why, and what changed as a result — this is an
   ADR-worthy event if it changes a standing architecture decision, not
   just an incident note, per `.claude/rules/git.md`'s Post-Merge/Rollback
   sections.

## What this plan deliberately does not claim

- A specific backup retention window or recovery time objective for the
  Supabase project — verify against the actual project/plan before
  promising one.
- An automated rollback script — none exists yet. If incident frequency
  ever justifies building one, that's new tooling work with its own review,
  not something to improvise mid-incident.
