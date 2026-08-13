# Preview Verification

How to run `scripts/test-preview-http.ts` (`npm run test:preview-http`)
against a live Vercel Preview deployment, locally or in CI. This script is
the automated equivalent of most of
`docs/web-v3/PRODUCTION_VERIFICATION_CHECKLIST.md` sections 1-7 and 11 — run
it before working through anything that checklist doesn't already cover.

## What it needs

All of the following are read **only** from environment variables. Nothing
is ever written to disk, logged, or echoed back by the script — see
"What it never does" below.

| Variable | Required | Purpose |
|---|---|---|
| `PREVIEW_URL` | Yes | The deployed Preview URL, e.g. `https://energy-monitor-git-feat-web-v3-dcm15.vercel.app`. Must be HTTPS, no embedded credentials/query/fragment. `PREVIEW_BASE_URL` is accepted as an alias. |
| `DEV_ADMIN_PASSWORD` | Yes | Password for the seeded Preview `admin` account. |
| `PREVIEW_UAT_PASSWORD` | Yes, unless using the legacy account (below) | Password for the seeded Preview `previewuat` (secondary, `user`-role) account. |
| `PREVIEW_UAT_USERNAME` | No (default `previewuat`) | Set to `usertest` only to run against an older Preview deployment that predates the `previewuat` account. |
| `DEV_USER_PASSWORD` | Only with `PREVIEW_UAT_USERNAME=usertest` | Password for the legacy `usertest` account. Ignored otherwise. |
| `PREVIEW_ORIGIN` | No | Set only when deliberately testing CORS behavior; otherwise requests are same-origin and this should stay unset. |

These accounts and their passwords are provisioned when the Preview
environment's development-account bootstrap runs
(`npm run auth:bootstrap-dev-accounts`, see `docs/authentication.md`) — this
script does not create them, it only exercises them.

## What it never does

- Never prints a username, password, cookie, token, or `Authorization`
  header value, in either passing or failing output — see
  `scripts/lib/redactLog.ts` and its test (`scripts/lib/redactLog.test.ts`)
  for the exact guarantee and how it's verified.
- Never writes to the database outside what the API's own `READ_ONLY_MODE`
  gate allows (the script's own assertions confirm mutations are blocked in
  Preview — see "Preview is server-side READ_ONLY_MODE" in the script).
- Never needs, reads, or touches `DATABASE_URL`, `DIRECT_DATABASE_URL`, or
  any Supabase credential directly — it only ever speaks HTTP to the
  already-deployed API.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Every check passed. |
| `1` | At least one check failed against a correctly configured target — a real regression to investigate. |
| `2` | Configuration problem: `PREVIEW_URL`/credentials missing or invalid, or the target is unreachable (DNS/connection/timeout). Not a check failure — fix the setup and re-run. |

## Running it locally

```bash
PREVIEW_URL=https://energy-monitor-git-feat-web-v3-dcm15.vercel.app \
DEV_ADMIN_PASSWORD=<value> \
PREVIEW_UAT_PASSWORD=<value> \
npm run test:preview-http
```

Never paste real values for these into a chat, an issue, a commit, or any
AI assistant — set them directly in your own shell or CI secrets store.

## Running it in CI

`.github/workflows/preview-verification.yml` runs this on demand
(`workflow_dispatch` only — it never triggers automatically) once merged to
the default branch. To use it:

1. Add `DEV_ADMIN_PASSWORD` and `PREVIEW_UAT_PASSWORD` as repository (or
   environment-scoped) secrets in GitHub: **Settings → Secrets and
   variables → Actions**.
2. From the **Actions** tab, run the "Preview Verification" workflow,
   supplying the Preview URL as the trigger input.
3. GitHub Actions automatically masks any log output matching a registered
   secret value, on top of this script's own redaction — defense in depth,
   not a substitute for it.

The workflow fails the run (non-zero) exactly when the script exits 1 or 2,
so a red check in the Actions tab means either a real regression or a setup
problem — check the (fully redacted) log output to tell which.
