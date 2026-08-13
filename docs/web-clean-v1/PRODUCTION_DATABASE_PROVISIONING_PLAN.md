# Production Database Provisioning Plan (Read-Only Analysis)

Prepared 2026-08-11. **No migration applied, no data copied, no
credentials created.** This is a plan for a human/Product Owner to
execute, not an action taken by this session.

## Migration classification (001–011)

Every migration file was read in full for this classification, not
assumed.

| Migration | Schema creation | RLS | Grants | Runtime roles | Data inserted |
| --- | --- | --- | --- | --- | --- |
| `001_phase2_foundation` | Yes — 21 core tables (sites, devices, monthly_periods, readings, rack, provenance, audit, etc.) + indexes | No | No | No | **None** |
| `002_phase3_auth_security` | Yes — users/local_credentials/auth_identities/roles/user_roles/sessions/http_rate_limit_buckets | Yes — enables RLS + one `energy_monitor_runtime_all` policy on every table from 001+002 | Yes — full grant set for `energy_monitor_runtime`, explicit `REVOKE ALL` from `PUBLIC`/`anon`/`authenticated`/`service_role` | Yes — creates `energy_monitor_runtime` (NOLOGIN group role) | **Yes** — `INSERT INTO roles (admin, user)` only |
| `003_workbook_source_retention` | Yes, additive | Yes | Yes | No | None |
| `004_google_sheets_oauth` | Yes — `google_oauth_states`, `google_sheets_connections` | Yes | Yes | No | None |
| `005_rack_history_and_images` | Yes, additive | Yes | Yes | No | None |
| `006_section_save_timestamps` | Yes — `ALTER TABLE ADD COLUMN` only | N/A (existing tables) | N/A | No | None |
| `007_ups_group_history` | Yes — `ups_group_history` | Yes | Yes | No | None |
| `008_backup_log` | Yes — `backup_log` | Yes | Yes | No | None |
| `009_backup_config` | Yes — `backup_config` | Yes | Yes | No | None |
| `010_users_delete_grant` | No | No | Yes — one `GRANT DELETE ON users` | No | None |
| `011_backup_google_oauth_link` | Yes — `ALTER TABLE ADD COLUMN` only | No | No | No | None |

**Fresh grep confirms zero `DROP`/`TRUNCATE`/destructive statements across all 11 files** — every migration is additive-only, matching this project's stated convention.

**The only data any migration inserts is `roles` (`admin`, `user`) in `002`** — this is deterministic reference data baked into the migration itself; it requires no separate seeding decision.

### Classification against your 8 categories

1. **Schema creation** — all 11 migrations (tables/columns/indexes).
2. **RLS** — `002`–`009` (enable + policy per table); `010`/`011` don't touch RLS.
3. **Grants** — `002`–`010` (`010` is grant-only, no schema change).
4. **Runtime roles** — only `002` (creates `energy_monitor_runtime`).
5. **Master/reference data** — only `roles` (`admin`/`user`), inserted by `002` itself. Everything else your app needs as "master data" (`sites`, admin `users`) is **not** in any migration — it's operator-seeded separately (see below).
6. **Application data** — none inserted by migrations. Tables exist empty: `sites`, `users`, `devices`, `air_meters`, `dc_panels`, `ups_groups`, `global_settings`, etc.
7. **Historical data** — none. `monthly_periods` and every readings table are empty after migrations alone.
8. **Data that must NOT be copied from Preview** — see §C "DO NOT COPY" below.

## What a brand-new Production database contains after 001–011

- 34 tables, fully structured, RLS-enabled, correctly granted to `energy_monitor_runtime`.
- `public.roles`: 2 rows (`admin`, `user`) — the only real data present.
- `public.schema_migrations`: 11 tracking rows.
- **Every other table: zero rows.** No sites, no users, no display period, no readings, no rack data, nothing. The application cannot boot into a usable state yet — `GET /api/v1/settings` would `503 DISPLAY_PERIOD_NOT_CONFIGURED`, and there would be no admin account to log in with at all.

## Required Production seed data — REQUIRED / OPTIONAL / DO NOT COPY

| Category | Status | Why |
| --- | --- | --- |
| **Sites** (Rangsit, Srinakarin) | **REQUIRED** | App is non-functional without them. Codes must be exactly `rangsit`/`srinakarin` — `src/domain/upsGroupTopology.ts` keys UPS History's topology by these exact strings; a mismatch silently produces empty UPS History (the exact bug class fixed this session). Source of truth for the correct values: `scripts/seed-development-master-data.ts` (dev-only, self-refuses in Production — see §B). |
| **Admin user** | **REQUIRED** | No login is possible otherwise. `scripts/bootstrap-admin.ts` is the correct mechanism — real, Production-safe by design (refuses to run if any user already exists), just needs real `BOOTSTRAP_ADMIN_USERNAME`/`PASSWORD` supplied by the operator at run time, never by me. |
| **Display Period** (`global_settings`) | **REQUIRED** | `requirePeriod()` throws `503` for every period-gated route until this exists. Values (start/end month) are a Product Owner decision — Preview's current `2026-01`–`2027-12` range should not be copied blindly; it may be Preview-test-specific. |
| **Monthly Periods / readings** (`ups_readings`, `air_meter_readings`, `dc_readings`, `energy_cost_inputs`) | **Decision required — see §D** | 134 rows in Preview. Evidence this session (cross-checked against the real XLSM files) shows this is **real historical Rangsit/Srinakarin data**, not synthetic test data — it was very likely migrated once from the Desktop workbooks directly into what became the Preview database, because no separate Production database existed yet. Whether Production needs this same historical dataset is a business decision, not a technical one. |
| **UPS topology/configuration** | **N/A — not database data** | Lives in code (`src/domain/upsGroupTopology.ts`), ships with the deploy. No seeding of any kind required, for any environment. |
| **Rack configuration** (`rack_assets`, `rack_capacity_snapshots`/`records`) | **DO NOT COPY automatically; same §D decision as historical data** | `rack_assets` is currently 0 rows even in Preview (unused by the current read path — Rack Capacity data flows through `rack_capacity_snapshots`/`records` instead, which is 0 rows too since Rack Capacity is read-only on Web with no editor — see `RELEASE_HANDOFF.md` §6). Nothing to seed here beyond whatever the historical-data decision in §D covers. |
| **Air configuration** (`air_meters`), **DC panels** (`dc_panels`), **UPS devices** (`devices`), **UPS groups** (`ups_groups`) | **OPTIONAL — self-provisions** | `saveMonthlyLogInTransaction`'s `upsertDevice`/`upsertMeter`/`upsertPanel` helpers (`ON CONFLICT ... DO UPDATE`) create these rows automatically the first time an admin performs a real Data Entry save for a site. No manual pre-seeding needed once `sites` exists. |
| **`site_profiles`** | **OPTIONAL** | 2 rows in Preview (`rangsit-v3`/`srinakarin-v3`), inserted by the same dev-seed script as `sites`. Not read anywhere in the current server code paths I've traced this session (no `site_profiles` query in `postgresRepository.ts`) — appears to be forward-looking/unused today. Harmless to seed alongside `sites` for consistency, not blocking if omitted. |
| **Google Backup tables** (`backup_config`, `backup_log`, `google_oauth_states`, `google_sheets_connections`) | **DO NOT SEED** | Feature permanently out of scope. Migrations create the tables (harmless, already decided not to skip them); no rows should ever be inserted. |
| **Dev/test user accounts** (`patamin`, `usertest` in Preview) | **DO NOT COPY** | Created by `scripts/bootstrap-development-accounts.ts`, which explicitly refuses to run when `NODE_ENV=production`. These are session/test identities, not real Production users. |
| **The stray `backup_log` row from live UAT testing this session** | **DO NOT COPY** | One `failed`/"not configured" row generated by my own live click-testing of the (now-removed) Backup feature. Artifact of testing, not real operational history. |

---

## A. Production schema creation order

Apply `001` → `011` in exact filename order (matches how they were applied to Preview, and how `server/db/migrate.ts` applies them). No reordering — `009` depends on `008`'s `backup_log` table existing first (already-documented dependency from this session's Preview migration work); every other ordering dependency is implicit filename order.

## B. Production seed order

1. Apply migrations `001`–`011` (schema/RLS/grants only — no data yet beyond `roles`, which `002` inserts itself).
2. **Sites**: insert `{code: "rangsit", name: "Rangsit"}` and `{code: "srinakarin", name: "Srinakarin"}` into `public.sites` — the exact values `scripts/seed-development-master-data.ts` uses, via a reviewed one-off SQL statement or a new Production-safe variant of that script (the existing one intentionally refuses to run when `NODE_ENV=production`; a real Production seed path needs its own deliberately-reviewed script or manual SQL, not a bypass of that guard).
3. **Global Settings / Display Period**: insert one row into `global_settings` with a Product-Owner-decided `start_month`/`end_month`.
4. **Admin user**: run `scripts/bootstrap-admin.ts` with real, operator-supplied `BOOTSTRAP_ADMIN_USERNAME`/`BOOTSTRAP_ADMIN_PASSWORD` — never generated or entered by me.
5. Only after 2–4 exist: deploy the application code and let real Data Entry saves populate `devices`/`air_meters`/`dc_panels`/`ups_groups` automatically.
6. If a historical-data decision is made (§D), that import happens as its own explicit, reviewed step — not bundled into the base seed.

## C. Required Production master data (exact values, sourced not invented)

```
sites:
  { code: "rangsit",    name: "Rangsit" }
  { code: "srinakarin", name: "Srinakarin" }
```
Source: `scripts/seed-development-master-data.ts` (read directly, not inferred) — these are the same values Preview uses, and the same values `src/domain/upsGroupTopology.ts` requires by exact string match.

`global_settings` (start_month, end_month): **no value provided here — Product Owner decision**, not copied from Preview's `2026-01`–`2027-12` without an explicit choice to do so.

Admin username/password: **operator-supplied at bootstrap time, never generated or seen by me.**

## D. Historical data migration recommendation

Preview's 134 `monthly_periods` rows (plus associated readings) are, per this session's own evidence, real historical facility data rather than test fixtures — they were cross-verified against the actual Desktop XLSM files during the UPS History investigation and matched exactly. This strongly suggests Preview's database currently serves as the *de facto* home for the one-time Excel-to-Postgres migration that was originally intended for a real Production database.

**Recommendation**: treat this as a genuine decision point, not a default. Two real options:

- **Option 1 — Re-run the original migration tooling directly against the new Production database**, from the same source XLSM files, so Production gets its own independently-migrated copy of the real historical data (matches the architecture's stated intent of Preview and Production as genuinely separate environments, never sharing data).
- **Option 2 — Explicitly export/import the verified-correct rows from Preview into Production** as a one-time, reviewed data migration (faster, but blurs the "Preview never touches Production data" boundary this project has otherwise maintained carefully).

Either way: **do not copy automatically, do not copy silently, and do not skip verifying the copied/re-migrated data against the source XLSM afterward** — the same verification rigor already applied to Preview this session should apply again.

## E. RLS/grant verification checklist (post-migration, before go-live)

- [ ] All 34 tables show `rowsecurity = true` (`pg_tables`/`pg_class.relrowsecurity`).
- [ ] Every table from `001`+`002` has exactly one `energy_monitor_runtime_all` policy (plus `roles`'/`audit_events`'/`provenance_records`' extra SELECT/INSERT-only policies, per `002`'s exact logic).
- [ ] `anon`, `authenticated`, `service_role`, and `PUBLIC` have zero grants on any table (`002`'s explicit `REVOKE ALL` block, re-verified live).
- [ ] `energy_monitor_runtime` has exactly the grant set `002` (+`010`'s `DELETE` on `users`) specifies — no more, no less.
- [ ] No login role has `rolbypassrls = true` or `rolsuper = true`.

## F. Runtime-role configuration

- `energy_monitor_runtime` is a `NOLOGIN` group role (created by `002`) — it is never connected to directly.
- A **separate, dedicated login role** must be created for Production (matching Preview's pattern: `energy_monitor_preview` was Preview's login role, confirmed distinct from `energy_monitor_api`/`postgres` this session) — e.g. `energy_monitor_production` — with `NOSUPERUSER NOBYPASSRLS`, granted membership in `energy_monitor_runtime`. This is a new role to create in the new Production project; it does not exist yet because the project doesn't exist yet.
- `DATABASE_URL` for Production must authenticate as this new login role via the Transaction Pooler (port `6543`), never `postgres`/`supabase_admin`, per `.env.example`'s explicit warning.

## G. Vercel Production environment variable checklist

(Full required/optional/secret table already delivered in the prior turn's analysis — summarized here for completeness.)

- [ ] `DATABASE_URL` — new Production project's pooled connection string, dedicated non-bypass-RLS role.
- [ ] `SUPABASE_DB_CA_CERT` — new Production project's own CA PEM.
- [ ] `SESSION_SECRET`, `CSRF_SECRET` — independently generated, ≥32 chars, never reused from Preview.
- [ ] `NODE_ENV=production`.
- [ ] `APP_ORIGIN` — the confirmed Vercel-designated Production origin, `https://energy-monitor-puce.vercel.app` (verified via `vercel project ls`, not invented).
- [ ] `TRUST_PROXY=true` (literal string, code-required).
- [ ] `READ_ONLY_MODE` — unset or `false`.
- [ ] `DB_POOL_MAX` — optional, ≤10.
- [ ] `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — server-only; required for Rack Unit Capacity image read/upload and Desktop image import. Never expose them to the browser.
- [ ] `RACK_UNIT_IMAGE_BUCKET` — existing Supabase Storage bucket name, default `rack-unit-capacity`.
- [ ] Confirm absent: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_BACKUP_SERVICE_ACCOUNT_JSON`, `CRON_SECRET`.

## H. Pre-merge Production smoke test

(Same 12-point live checklist already in `RELEASE_HANDOFF.md` §4 — re-run against Production specifically once deployed, before declaring the release complete. Not repeated here to avoid drift between two copies of the same checklist.)

## I. Rollback considerations

- Schema: additive-only across all 11 migrations (verified fresh this pass) — an older code build remains forward-compatible with a newer schema by construction. No schema rollback should ever be needed for a pure application-code issue.
- Because Production starts from zero real data, an early-stage rollback (before real operational data accumulates) is lower-risk than a typical rollback — worst case is re-running the seed steps (B) again against a cleanly-reset new database, since nothing production-critical has accumulated yet.
- Once real Data Entry saves and historical data (§D) exist in Production, ordinary rollback rules apply: never drop/reset the schema, use Vercel Instant Rollback for the application layer, per `docs/web-v3/ROLLBACK_PLAN.md`.

## Summary answers to your specific questions

- **Sites**: REQUIRED, exact values above.
- **Users/Admin**: REQUIRED, via `scripts/bootstrap-admin.ts`, operator-run.
- **Display Period**: REQUIRED, values are a Product Owner decision.
- **Monthly Periods**: decision required (§D) — likely real data, not test data, but a genuine choice about how Production obtains its own copy.
- **UPS topology/configuration**: not database data at all — ships in code.
- **Rack configuration**: DO NOT COPY automatically; folded into the §D decision (currently empty even in Preview).
- **Air configuration**: OPTIONAL — self-provisions on first real save.
- **Facility-specific settings**: covered by `sites`/`site_profiles` above.
- **Other required system rows**: only `global_settings` (Display Period) beyond what §B already covers.

Stopping here, as instructed. No migration applied, no data copied, no credentials created, no PR opened, `main`/Preview Supabase/Production untouched.
