# Energy Monitor Web Clean v1 — Architecture

Status: design baseline for `feat/web-clean-v1`  
Source of truth: Energy Monitor Desktop v2.3.1

## Objective

Deliver the smallest production web application that preserves the Desktop
workflow and presentation:

`Login → Data Entry → Validate → Save → Dashboard → History → Excel/CSV/PDF → Logout`

Administrators additionally manage users. Desktop files, the existing Git
repository, the existing Supabase project, and existing data remain intact.

## Architecture

```text
Browser
  │ HTTPS JSON API only; no database credentials or Supabase service key
  ▼
Vercel Web/API
  │ server-only session, validation, authorization, calculations, exports
  ▼
Supabase PostgreSQL
  │ existing core tables, constraints, RLS, audit records
```

The browser never connects to PostgreSQL. It receives only the DTOs needed by
the current screen and sends validated monthly-log payloads to server routes.

### Web application

The clean client reuses the Desktop React components and the shared pure domain
modules wherever their contracts are storage-neutral:

- `src/components/UpsTable.tsx`
- `src/components/SrinakarinPowerPhaseTable.tsx`
- `src/components/AirTable.tsx`
- `src/components/DcTable.tsx`
- `src/components/EnergyCostTable.tsx`
- `src/components/DashboardSummary.tsx`
- `src/components/HistoricalExplorer.tsx`
- `src/domain/*`
- `src/utils/numberFormat*` and the shared GMT+7 timestamp formatter

`src/web/*` and its web-v3 navigation are not the clean application entry
point. Google Sheets, Google OAuth, workbook round-trip, macros, workbook
source retention, rack-image storage, and sync services are not imported by
clean v1.

### API boundary

Clean v1 exposes only the core application surface:

- session: login, logout, session, CSRF bootstrap
- bootstrap: facilities, profiles, devices, meters, available months
- monthly data: read and transactional upsert of one facility/month
- dashboard/history: server-authorized monthly data and Desktop calculations
- exports: Excel, CSV, and PDF generated from the same monthly-log DTOs
- admin: list/create, enable/disable, delete, and reset-password users

Every route performs server-side authentication and permission checks. UI
visibility is never authorization.

## Authentication and authorization

Clean v1 preserves the already-established local application authentication
contract because the existing database has `users`, `local_credentials`,
`roles`, `user_roles`, and `sessions`, while the Desktop source has no account
model to migrate. Passwords remain Argon2id hashes. Sessions are opaque,
server-side records represented to the browser by an HttpOnly, Secure,
SameSite cookie. Mutations require a session-bound CSRF token.

Roles are intentionally only `admin` and `user`:

- `user`: read/write permitted operational records, dashboard, history, exports
- `admin`: all user permissions plus user management

RLS remains enabled. The server connects only with the existing non-superuser,
non-BYPASSRLS runtime membership already defined by the database security
baseline. No new PostgreSQL role is introduced by clean v1, and the browser
never receives `DATABASE_URL`, `SUPABASE_DB_CA_CERT`, or any service credential.

### Why the server database adapter remains

This is a compatibility boundary, not an invitation to expand infrastructure.
The current live schema revokes table access from `anon`, `authenticated`, and
`service_role`, and its policies/grants target the existing runtime role. A
switch to Supabase Data API/Auth would therefore require changing RLS policies,
API grants, user identity mapping, and existing account/data authorization.
That is a separate migration with meaningful data-security risk and is not
required to deliver the Desktop workflow. Clean v1 keeps the existing adapter
server-only and limits it to the routes above. A future Data API migration may
remove the database URL/CA dependency only after a separate proof against the
Preview dataset and a rollback plan.

## Data and calculations

PostgreSQL stores raw monthly inputs and metadata. Derived values are computed
from the Desktop v2.3.1 domain functions and are not accepted from the client
as authoritative values. Each save is one transaction with optimistic
`row_version` checking and an audit event.

The existing core schema is retained. Clean v1 does not recreate data or add
the web-v3-only workbook/Google/rack-history infrastructure.

## Export design

All three formats consume the same normalized monthly-log collection and the
same Desktop calculation functions:

- Excel: a new report workbook with Summary, UPS Loads, Air Conditioning, DC
  Power Panels, and Energy & Cost sheets. It is a report export, not a
  macro-preserving workbook round trip.
- CSV: Desktop-compatible section blocks with raw inputs and calculated energy
  and cost columns; blanks stay blank rather than becoming zero.
- PDF: Desktop report HTML structure rendered server-side: cover, selected-month
  engineering dashboard, trend pages, and monthly energy/cost table. No
  workbook is required.

## Configuration

Client-visible configuration is limited to the public application origin and
static UI assets. Server-only configuration is validated at startup:

- `DATABASE_URL` — server runtime only, using the already-provisioned
  non-BYPASSRLS login role
- `SUPABASE_DB_CA_CERT` — server TLS verification only
- `SESSION_SECRET` and `CSRF_SECRET` — independent random secrets, each at
  least 32 characters

`SUPABASE_SERVICE_ROLE_KEY` is not required by clean v1. If a future privileged
operation needs it, that operation must be server-only and explicitly reviewed.

## Deployment rules

1. Build and tests run on `feat/web-clean-v1`.
2. Preview configuration is changed only after local gates pass.
3. Preview UAT must complete the normal-user and admin workflows.
4. Production is not changed until the complete gate matrix passes.
5. Production smoke testing and a rollback drill are recorded as evidence.

### Current Preview configuration finding (2026-08-10)

Vercel authentication was verified and a clean Preview candidate was built at
the `energy-monitor` project. Its public shell and health endpoint returned
HTTP 200, while `/api/v1/readiness` returned the deliberately sanitized
Preview diagnostic `reason: "configuration"`. The required server variables
currently exist only on the old `feat/web-v3` Preview branch scope; they are
not available to a `feat/web-clean-v1` deployment.

Values must never be copied through source control, commands, or chat. An
authorized project administrator must add or clone the following **Preview
only** variables for `feat/web-clean-v1` in Vercel, using the existing
least-privilege Supabase runtime credentials:

- `DATABASE_URL` (transaction pooler, port 6543, non-BYPASSRLS login)
- `SUPABASE_DB_CA_CERT` (valid PEM, with newlines preserved)
- `SESSION_SECRET` and `CSRF_SECRET` (independent values, 32+ characters)
- `NODE_ENV=production`, `APP_ORIGIN`, `APP_ORIGINS`, and
  `APP_PREVIEW_ORIGINS` for the resulting Preview hostname

This is a Preview-only action. It must not alter Production values, RLS, or
the `postgres` identity.

The target project reference for this clean deployment is
`tofdgndrrpnnyhbuurbx` (`energy_monitor`, `ap-southeast-1`). The former
`dnnufamiwxapqibdhwyj` reference is stale and must not be used. See
`SUPABASE_PROJECT_AUDIT.md` for the evidence and the current schema-access
limitation.

## Risks

| Risk | Level | Control |
|---|---:|---|
| Existing web-v3 files are mixed into the same repository | High | Isolated branch/worktree; clean entry points do not import `src/web/*` or Google/workbook services. |
| Runtime database credentials remain necessary | Medium | Server-only least-privilege role, TLS verification, RLS, no browser access; future removal requires a separate RLS/Auth migration. |
| Desktop component assumptions are Electron-specific | Medium | Reuse only storage-neutral components; compile and exercise every web route in a browser. |
| PDF parity drift | Medium | Build PDF data from the same domain functions and compare sanitized Desktop fixtures before Preview. |
| Existing data has incomplete months | Medium | Preserve null semantics and expose validation status; never invent zero values. |
| Vercel/Supabase credentials are unavailable to this session | External | Complete CLI/dashboard authentication before Preview deployment. |
