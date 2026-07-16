# Prompt: diagnose a production-only failure

```
[FEATURE] fails in production (Vercel) but [works locally / fails with
error X]. Before assuming it's a code bug, check the known Vercel-specific
causes already hit in this project: (1) self-fetch to the app's own URL
being intercepted by Deployment Protection and returning an SSO page
instead of the expected bytes — affects anything that fetches its own
deployed origin server-side, not just fonts; (2) the 4.5MB serverless
body-size cap — affects any direct file upload, not just photos;
(3) a file needed at runtime not being included via
outputFileTracingIncludes, so it's missing from the bundled function even
though it exists in the repo.

Pull the Vercel function logs for the failing request, and Supabase logs/
advisors if the path touches the database, before proposing a fix.
```
