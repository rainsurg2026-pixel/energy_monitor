# Energy Monitor Web v3 read shell

Phase 5 adds a browser-only shell while retaining the Electron/Desktop entry
path. HTTP(S) routes are lazy-loaded separately from the Desktop application:

- `/login`
- `/dashboard`
- `/energy`
- `/cost`
- `/electrical`
- `/site-comparison`
- `/racks`
- `/rack-units`
- `/settings` and `/settings/users`

The browser uses `src/web/apiClient.ts` for cookie-authenticated API calls and
never receives a PostgreSQL or Supabase credential. Backend bootstrap data is
authoritative for sites, Display Period, allowed months, latest available
month, and `READ_ONLY_MODE`. A stale month selection is replaced by the
backend-provided latest available month; hidden months are not requested or
rendered by the web shell.

The read pages display API/domain outputs. They do not reproduce Energy Monitor
calculation formulas in React. Rack Capacity and Rack Unit Capacity remain in
the parity scope. `vercel.json` rewrites browser routes to `index.html` while
leaving `/api/` and static assets outside the rewrite.

Live auth/RLS and live migration remain deployment gates:

- `LIVE_AUTH_SUPABASE_VERIFICATION_PENDING`
- `DEVELOPMENT_ACCOUNTS_LIVE_SEED_PENDING`
- `LIVE_PHASE4_IMPORT_PENDING`

No production deployment or Phase 6 work is included here.
