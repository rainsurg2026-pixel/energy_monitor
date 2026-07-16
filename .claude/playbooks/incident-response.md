# Playbook: production incident response

## First, gather facts — don't guess and don't hot-fix blind

1. Pull Vercel function/build logs for the failing request or the failed
   deploy.
2. If the path touches the database, pull Supabase logs and run the
   security/performance advisors.
3. Check whether the failure correlates with a specific deploy (Vercel
   deployment list, compare to the last known-good commit).
4. Reproduce manually in the live app if possible before changing
   anything — confirm the actual symptom, not the assumed one.

## Common known causes in this app (check these before anything else)

- Self-fetch to the app's own deployed URL intercepted by Vercel
  Deployment Protection (returns an SSO login page instead of the
  expected response) — see `.claude/skills/pdf-export-unicode-safe.md`
  gotcha 1, but this can affect any server-side self-fetch, not just
  fonts.
- 4.5MB serverless body-size cap — affects any direct file upload.
- A file referenced at runtime but missing from `outputFileTracingIncludes`
  in `next.config.mjs`, so it's absent from the deployed function even
  though it's in the repo.
- A timezone bug from a date call that bypassed the shared GMT+7
  formatter.

## Rollback

Vercel keeps prior deployments — an instant rollback to the last known-good
deployment is available from the Vercel dashboard and is the fastest way
to stop active user impact while the root cause is investigated, rather
than pushing a rushed fix directly to `main`.

## After

Document the root cause and the fix as a new `.claude/skills/` entry if
it's the kind of thing likely to recur, the way the PDF font and image
gotchas already are.
