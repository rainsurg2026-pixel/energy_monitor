# Phase 3 Agent 5 — Independent Test and Security Review Plan

Status: review-only. This note proposes tests and records risks; it does not
implement authentication, alter production code, alter the database, or commit
anything.

Review date: 2026-08-08

## Evidence and scope

- Branch: `feat/web-v3`; reviewed HEAD: `37fae26`.
- Phase 3 decision is local username/password authentication with exactly
  `admin` and `user` roles. Supabase Auth and Entra/OIDC are out of scope.
- Live Supabase project `tofdgndrrpnnyhbuurbx` is healthy, has migration
  `phase2_foundation`, and currently contains the Phase 2 schema only.
- Read-only inspection shows all 28 `public` tables have RLS disabled and no
  policies. This is a Critical security blocker, not a test failure to hide.
- Partial Phase 3 workstream files are currently untracked under `server/auth/`,
  `server/authz/`, and `server/http/security/`, with related docs and unit
  tests. They are not mounted into `server/http/app.ts` and are not evidence of
  an end-to-end security boundary.
- Before the concurrent auth workstream files appeared, the existing baseline
  `npm run lint` passed and `npm run test:api` passed with 22 assertions. After
  those untracked auth files appeared, the latest `npm run lint` fails in that
  workstream; `test:api` remains an in-memory test and is not evidence of live
  PostgreSQL integration.
- The working tree already had uncommitted `package.json` and
  `package-lock.json` changes adding `argon2@0.45.1`. No production source was
  changed by Agent 5. The dependency is not yet used by the current server.

## Current implementation findings

1. **Critical — no Web authentication boundary is wired yet.**
   `server/http/app.ts` exposes health, sites, settings, operational reads, and
   mutations without session authentication or role authorization. The current
   `readOnlyMutationGuard` only checks HTTP method and `READ_ONLY_MODE`.
   Untracked helper modules define useful contracts, but they are not mounted,
   do not create/load PostgreSQL users or sessions, and do not protect a route.

2. **Critical — Supabase RLS is disabled.**
   The Phase 2 migration creates exposed `public` tables but no RLS enablement
   or policies. Because Phase 3 uses application-local identities rather than
   Supabase Auth, `auth.uid()` cannot be assumed to identify an Energy Monitor
   user. The runtime-role/RLS design must be explicit; cosmetic
   `USING (true)` policies are not acceptable.

3. **High — runtime and migration privileges are currently coupled.**
   `server/main.ts` runs migrations during API startup, `ServerConfig` has only
   `DATABASE_URL`, and `createPool` uses a pool size of 10. This is unsafe to
   treat as a final Vercel design. Migration/admin access and the serverless
   runtime role must be separated and tested independently.

4. **High — current CORS is not an authenticated-cookie policy.**
   `server/http/app.ts` always emits the configured single
   `access-control-allow-origin` value and accepts preflight headers only for
   `content-type,x-request-id`. It does not yet validate the request Origin,
   declare a credential policy, or include the future CSRF header. Cookie
   authentication must not be added without exact local/Preview/Production
   origin tests.

5. **High — audit actor identity is not yet available.**
   Current repository writes use `actor_type='system'` and do not carry an
   authenticated business user ID. Phase 3 tests must reject actor IDs from
   request bodies/headers and verify the actor is derived from server session
   context inside the same transaction.

6. **High — live test coverage is intentionally blocked by the existing guard.**
   `scripts/test-postgres-foundation.ts` refuses non-loopback hosts. That guard
   is correct for Phase 2 and must not be weakened. Phase 3 needs a separately
   gated, synthetic-only live suite that constructs the real
   `PostgresRepository` and exercises the real HTTP server.

7. **Medium — existing Firebase/Google token code is a separate Desktop or
   legacy browser integration.** It must not become the Web v3 session model,
   and Phase 3 builds must prove that no `VITE_*` database/session secret or
   direct browser table access is introduced.

8. **Medium — the uncommitted Argon2 dependency is native.** Verify the
   supported Node/Vercel runtime, lockfile integrity, install/build behavior,
   and production audit before relying on it. Do not claim password security
   from the dependency being present alone.

9. **High — the current auth workstream does not pass the TypeScript gate.**
   `npm run lint` currently fails in untracked `server/auth/authCore.test.ts`
   and `server/auth/passwordPolicy.ts`: the test reads rejected-only fields from
   an un-narrowed `LoginDecision` union, and `assertPasswordPolicy` reads
   rejected-only fields from an un-narrowed `PasswordPolicyResult`. These must
   be resolved before any security test result is treated as reliable.

10. **Medium — helper tests are not integration tests.**
    The untracked authz suite passes 88 assertions and the HTTP-security helper
    suite passes 4 tests, but they use pure functions/mocked Express request and
    response objects. They do not prove cookie persistence, middleware order,
    route protection, session revocation, durable rate limiting, or live DB
    behavior.

11. **High — durable rate limiting is only an interface today.**
    `PostgresRateLimitStore` expects a future
    `http_rate_limit_buckets` table, but no migration exists and the current
    API does not mount the store. In-memory rate limiting must remain test-only
    and cannot be reported as Vercel protection.

12. **Medium — several repository documents describe other platform/auth
   architectures.** Treat the attached Phase 3 requirements and active
   `server/` implementation as authoritative for this project; do not import
   Supabase Auth, JWT, dealer-scope, or unrelated role models accidentally.

## Test harness rules

- Use Node `fetch`/HTTP against an ephemeral Express port, following the
  existing `scripts/test-api-foundation.ts` style.
- Unit tests may use pure functions or an in-memory fake. Acceptance tests for
  sessions, audit, RLS, privileges, readiness, and HTTP integration must use a
  real isolated Supabase PostgreSQL database and `PostgresRepository`.
- Create only synthetic users/data with a unique run prefix. Never use real
  operational users, workbook values, or production credentials.
- Use a cookie jar that preserves `Set-Cookie`, sends the cookie on subsequent
  requests, and records cookie attributes without printing the value.
- Assert database state before and after every mutation. Cleanup must delete
  only the run prefix in dependency order, preferably inside a transaction;
  never use broad `TRUNCATE`, `DROP`, or unscoped deletes.
- Keep live tests behind explicit environment gates and fail closed when the
  target project/environment is not the approved development project.
- Test output must redact passwords, hashes, session tokens, cookies, CSRF
  values, database URLs, IPs where policy requires, and provider keys.

## Exact test cases

### Authentication and credentials

| ID | Test | Expected result |
| --- | --- | --- |
| AUTH-01 | Normalize `"  Admin  "`, case variants, and selected Unicode edge cases; insert duplicate normalized names | One documented normalization rule; database uniqueness rejects the duplicate |
| AUTH-02 | Create local credential and inspect the row/DTO/logs | No plaintext; Argon2id identifier and unique salt are present; hash never leaves credential service |
| AUTH-03 | Admin and User login through HTTP | 200; safe user/role/session response only; hashed session row exists |
| AUTH-04 | Wrong password, unknown username, and inactive account | Same safe status/shape/message class; no account enumeration |
| AUTH-05 | Repeated failures for one account and one IP across usernames | Counter/temporary lockout and durable rate limit activate; successful login is blocked during lockout; no password is logged |
| AUTH-06 | Password boundary values: blank, whitespace, too short, too long, valid password-manager string | Consistent validation; no arbitrary composition rule unless documented |
| AUTH-07 | Initial admin bootstrap twice, including an existing admin | First controlled bootstrap works; second run cannot overwrite or recreate the admin; no unauthenticated permanent bootstrap endpoint |
| AUTH-08 | `GET /api/v1/auth/session` without, expired, revoked, and valid cookie | 401 for invalid states; 200 with safe principal for valid state |
| AUTH-09 | Inspect session storage after login | Only a cryptographic hash of the raw token is stored; raw token is absent from DB, logs, DTOs, and frontend artifacts |
| AUTH-10 | Seed/pre-auth cookie followed by successful login | A fresh session is created; pre-auth identifier cannot authenticate as the new user |
| AUTH-11 | Login, logout, then replay the old cookie | Logout revokes/deletes the server session and old replay returns 401 |
| AUTH-12 | Expire a session and leave its row present | Expired row returns 401; cleanup strategy removes only eligible expired rows |
| AUTH-13 | Change password with wrong/current password and valid new password | Wrong current password does not change hash; valid change updates timestamp/hash and follows documented current/other-session revocation policy |
| AUTH-14 | Admin password reset/replacement | Target can authenticate only with the new credential; old sessions follow policy; audit identifies admin and target but never new password/token/hash |
| AUTH-15 | Deactivate a logged-in user and immediately reuse its session | Authentication fails promptly; no indefinite session survives account deactivation |

### RBAC and authorization

| ID | Test | Expected result |
| --- | --- | --- |
| RBAC-01 | Every existing `/api/v1` read and mutation without a session | 401 except deliberately public health/readiness/bootstrap behavior, which must be explicitly documented |
| RBAC-02 | User accesses dashboard, energy, cost, electrical, rack, rack-unit, comparison, sites, and effective settings | 200 where the permission matrix allows it |
| RBAC-03 | User calls every `/api/v1/admin/users` operation | 403; no row, role, password, session, or audit change |
| RBAC-04 | Admin lists/creates/activates/deactivates users, changes role, and performs controlled reset | Allowed; validation, audit, and transaction behavior are correct |
| RBAC-05 | User submits `role=admin`, `actor_user_id=<admin>`, privileged fields, or another user ID in body/query/header | Ignored or rejected; server session remains the only actor/authority source |
| RBAC-06 | User reads effective Global Settings/Display Period and attempts mutation | GET allowed; mutation 403 |
| RBAC-07 | Admin changes Display Period and immediately calls an operational endpoint | Allowed; endpoint follows the new period without restart, then test restores settings |
| RBAC-08 | User requests admin-only audit history and database/admin migration operations | 403 and no side effect |
| RBAC-09 | Repeat authorization checks using alternate methods, paths, query/body IDs, and direct route invocation | No route bypass caused by method/path variations |

### Sessions, cookies, CSRF, CORS, and errors

| ID | Test | Expected result |
| --- | --- | --- |
| HTTP-01 | Inspect login/logout/session/change-password `Set-Cookie` headers | HttpOnly; Secure in production; appropriate SameSite/Path; innocuous name; no token in response body/localStorage |
| HTTP-02 | POST/PUT/PATCH/DELETE with cookie but no CSRF proof | Rejected before mutation; expected 4xx contract; DB unchanged |
| HTTP-03 | Invalid, wrong-session, stale, replayed, and valid CSRF proof | Only valid proof succeeds; behavior is documented for login/logout; one-time tokens are not replayable if that strategy is selected |
| HTTP-04 | Cross-origin requests from untrusted Origin, allowed local Origin, Preview, and Production | Untrusted origin rejected; only configured origins receive credentialed CORS; never `*` with credentials; `Vary: Origin` where required |
| HTTP-05 | OPTIONS preflight requesting the actual CSRF header and credentials | Exact allowlist; no arbitrary Origin/header reflection |
| HTTP-06 | Simple form/multipart and JSON mutation attempts | CSRF/origin policy covers browser form paths, not only JSON fetches |
| HTTP-07 | Invalid session, insufficient role, stale version, read-only, rate limit, and DB outage | Consistent 401/403/409/423/429/503 contract without internal SQL, role, credential, or stack details |
| HTTP-08 | Invalid JSON and oversized payload with and without Origin | Safe error response still has the request correlation contract and no sensitive echo |

### Supabase RLS, grants, and PostgreSQL security

| ID | Test | Expected result |
| --- | --- | --- |
| DB-01 | Inspect all 28 current and all new auth tables after migration | Every exposed table has deliberate RLS/grant classification; no unexplained `rls_enabled=false` |
| DB-02 | Access exposed tables through anonymous/publishable Data API credentials, if exposure exists | Direct browser/table access is denied or intentionally scoped; no raw operational/auth rows are readable or writable |
| DB-03 | Connect using the dedicated runtime role | Only required SELECT/INSERT/UPDATE/DELETE and function access works; DDL, role management, migration metadata, and unrelated privileged actions fail |
| DB-04 | Connect using migration/admin role and compare runtime role | Migration role can perform approved migrations; credentials/role are not used by browser/runtime; separation is observable |
| DB-05 | Evaluate policy behavior with local Energy Monitor identities | Policies do not assume `auth.uid()` is the local user ID. If runtime bypasses RLS, that trust boundary is documented and tested; policies are not blanket `USING (true)` cosmetics |
| DB-06 | Cross-site/cross-user ID substitution on every FK-backed operational path | No cross-site data can be read or written through guessed IDs; composite FK invariants remain enforced |
| DB-07 | SQL injection payloads in username, search, IDs, months, correlation IDs, and JSON fields | Parameters remain bound; no query structure or authorization changes |
| DB-08 | Inspect views/functions/triggers added by Phase 3 | No unsafe public `SECURITY DEFINER`; views use appropriate security-invoker/private-schema treatment; execute grants are least privilege |
| DB-09 | Apply auth migrations from current Phase 2 state and from a clean schema | Ordered, idempotent, transactional migration chain; no destructive alteration of Phase 2 raw/provenance data |
| DB-10 | Verify indexes and query plans for normalized username, provider/subject, token hash, user ID, expiry, roles, and lockout/rate-limit lookups | Required lookups are indexed without unbounded over-indexing; token hash lookup is exact and non-leaky |
| DB-11 | Force an error after a business mutation but before commit | Business row and audit row both roll back; no audit event claims a mutation that did not commit |

### READ_ONLY_MODE

| ID | Test | Expected result |
| --- | --- | --- |
| RO-01 | `READ_ONLY_MODE=true`, User operational mutation | 423; zero data/audit/provenance/row-version change |
| RO-02 | `READ_ONLY_MODE=true`, Admin operational mutation | 423; admin cannot bypass the global read-only guard |
| RO-03 | `READ_ONLY_MODE=true`, Admin settings/Display Period/user-management/password action | 423 or the explicitly documented pilot exception; test the chosen policy, not an implicit route-order accident |
| RO-04 | `READ_ONLY_MODE=true`, GET, session, login, logout | Continue only where the documented matrix allows; no mutation side effect |
| RO-05 | Try to override read-only with body/header/query values or client role | Override fails; only server configuration controls it |
| RO-06 | Exercise POST, PUT, PATCH, DELETE and every mutation route | No method/path bypass; auth endpoints are not accidentally blocked before login/session behavior is evaluated |
| RO-07 | Toggle/restart according to deployment design and recheck readiness | Runtime semantics are explicit: either immutable per process or intentionally reloadable; no stale flag surprise |

### Live HTTP → Supabase integration

| ID | Test | Expected result |
| --- | --- | --- |
| LIVE-01 | Start the API with the approved development Supabase runtime URL and real `PostgresRepository` | HTTP → auth → RBAC → service → repository → Supabase is proven; no in-memory dependency is injected |
| LIVE-02 | Health/readiness with valid, invalid, timed-out, and unavailable DB | Valid DB is ready; failure is 503 with safe detail; credentials/SQL are not exposed |
| LIVE-03 | Real login/session/role tests using synthetic Admin/User | All AUTH/RBAC expectations pass with real rows and cookies |
| LIVE-04 | Real operational mutation with provenance and audit | Raw data, provenance, actor, and audit commit together; derived values remain calculated by the shared domain layer |
| LIVE-05 | Real Display Period change by Admin and denied User mutation | Immediate HTTP policy change; no restart; settings restored after test |
| LIVE-06 | Real read-only mutation attempts by User and Admin | 423 and DB remains byte/row-version/audit equivalent before and after |
| LIVE-07 | Concurrent stale session/role/settings/period writes | Correct 409/authorization result; no lost update or duplicate audit claim |
| LIVE-08 | Transaction pooler runtime smoke test, cold start, concurrent requests, and connection exhaustion | Transactions remain pinned correctly; no named prepared statement failure; pool size is safe for Vercel/serverless |
| LIVE-09 | Verify runtime and migration URLs/roles are distinct in deployment configuration | Preview never receives Production credentials; frontend build contains neither URL nor private secret |
| LIVE-10 | Prefix-scoped cleanup and post-cleanup counts | All synthetic auth/operational/audit rows are gone; migration history and non-test data remain intact |

## Regression and source-safety gates

Before Phase 3 completion, repeat the existing baseline checks without changing
golden outputs:

- `npm run lint`, `npm run build`, `npm run desktop:build`
- domain parity 24/24, Display Period, API baseline 22+, Site Comparison 54,
  Rack, Rack Unit, Energy Cost, and RC3
- preserve known legacy failures separately: PPC43 July 2026, dashboard
  source-shape/mapping fixture, and UPS history fixture
- `npm audit --omit=dev` remains clean; review the native Argon2 dependency and
  lockfile before acceptance
- scan source and frontend build output for `DATABASE_URL`,
  `DIRECT_DATABASE_URL`, private secrets, raw passwords, raw session tokens,
  CSRF values, service-role keys, and accidental direct Supabase imports
- verify workbook SHA-256 values remain exactly:
  - Rangsit: `40336F34E041DF739A42267907FC72F49EE82F1036009D483CE14744896512DC`
  - Srinakarin: `D78CC76CCF053098A67827CCA4D9FA9F6D61B39A976087077804A7279D0B2F03`

## Exit criteria and blockers

Phase 3 must not be called complete while any of these remain unresolved:

1. Any unauthenticated operational endpoint or mutation succeeds.
2. Any User reaches an Admin operation or can spoof role/actor identity.
3. Raw session tokens/passwords/CSRF secrets appear in DB, logs, DTOs, or
   frontend artifacts.
4. RLS/grants are disabled, unexplained, or only cosmetic; direct unwanted
   table access remains possible.
5. Runtime and migration privileges are not separated and tested.
6. Live HTTP tests use mocks/in-memory repositories instead of the approved
   Supabase database.
7. READ_ONLY_MODE can be bypassed by Admin, route order, method, or request
   fields.
8. Any Critical/High finding from the independent security review remains.

Relevant Supabase guidance:

- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase serverless drivers](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers)
