# Production Data Migration Plan (Prepare Only — Not Executed)

Prepared 2026-08-11. **No migration executed. No data copied to any
Production target (none exists yet). Preview Supabase, Production
Supabase, Vercel, and `main` are all untouched.** All row counts below
are read directly from live Preview (`tofdgndrrpnnyhbuurbx`) via
read-only `SELECT`s — nothing here is guessed.

## Source / Target

- **Source**: Preview Supabase, `tofdgndrrpnnyhbuurbx` (read-only for this plan).
- **Target**: a new, not-yet-created Production Supabase project (per the prior provisioning plan's decision).

---

## 1. Data classification (every application table, real counts)

**A = MUST MIGRATE, B = SHOULD MIGRATE, C = CREATE FRESH IN PRODUCTION, D = DO NOT MIGRATE, E = SYSTEM/EMPTY AFTER MIGRATION**

| Table | Class | Preview rows | Reasoning |
| --- | --- | --- | --- |
| `sites` | **C** | 2 | Real master data, but re-created fresh with new auto-generated IDs in Production (see §5 on ID remapping) — not a row-copy, a re-insert of the same two known values. |
| `site_profiles` | **C** | 2 | Same as `sites` — recreated fresh alongside it, not read anywhere in current server code paths (verified via grep this session), low-risk either way. |
| `global_settings` (Display Period) | **C** | 1 | Required, but the *value* (start/end month) is a Product Owner decision, not a copy of Preview's test range — see prior provisioning plan §D. |
| `monthly_periods` | **A** | 134 (Rangsit 67, Srinakarin 67) | The real historical record. Verified against actual Desktop XLSM files this session. Date range: Rangsit `2020-12`–`2026-06`, Srinakarin `2021-01`–`2026-07`. |
| `ups_readings` | **A** | 749 | Verified sum: `load_kw`=19,536.00, `load_kva`=19,745.20 across all 749 rows — this exact aggregate is the row-level integrity check target for post-migration verification. |
| `air_meter_readings` | **A** | 804 | Same historical dataset as `monthly_periods`. |
| `dc_readings` | **A** | 284 | Same. |
| `electrical_phase_readings` | **A** | 448 | Srinakarin-specific per-phase raw inputs (UPS/AC/PPC43) — same historical dataset. |
| `energy_cost_inputs` | **A** | 134 | One row per `monthly_periods` row (1:1) — building energy/cost inputs. |
| `rack_capacity_snapshots` + `rack_capacity_records` | **A** | 2 snapshots / 595 records (Rangsit 358, Srinakarin 237) | Real, already-migrated current-state rack inventory — this is the data the live Rack Capacity view renders; confirmed matching the live browser UAT numbers from earlier this session exactly. |
| `rack_unit_capacity_snapshots` | **A** | 7 (Srinakarin only, `2026-01`–`2026-07`; Rangsit has none — confirmed real, not a bug) | Real historical data, facility-asymmetric by design. |
| `rack_unit_capacity_images` | **A** (if any exist) | 0 | Empty in Preview — nothing to migrate, but the table must exist (schema-only, from migrations). |
| `devices`, `air_meters`, `dc_panels` | **C** | 23 / 12 / 6 | Self-provision automatically via `ON CONFLICT DO UPDATE` upserts the first time the migrated historical data (or any real save) is written — do not hand-copy; they will be recreated as a natural side effect of importing the tables above through the *same* code path (`saveMonthlyLogInTransaction`), guaranteeing identical device/meter/panel rows without a separate copy step. |
| `electrical_profiles` | **C** | 1 (Rangsit only currently) | Same self-provisioning mechanism — recreated automatically per site as historical months are imported through the real save path. |
| `ups_groups`, `ups_group_members` | **E** | 0 / 0 | Confirmed unused by the current application (UPS topology is code-based, `src/domain/upsGroupTopology.ts`) — these tables are empty in Preview too and stay empty in Production. Not a migration gap. |
| `ups_group_history` | **C** | 59 (Rangsit 24, Srinakarin 35) | **Derived/computed data**, not source data — these are the exact row counts my UPS History fix's lazy backfill produced during live Browser UAT this session (6 months × 4 groups + 7 months × 5 groups = 59). Deterministically reconstructible from `ups_readings` + code topology the moment anyone opens History in Production. Do not copy; let it self-regenerate. |
| `rack_capacity_history` | **E** | 0 | Confirmed empty in Preview too — no writer exists yet (Rack Capacity Editor was never built on Web). Stays empty in Production, same as Preview. Not a migration gap, a pre-existing, already-documented scope limitation. |
| `roles` | **E** | 2 | Inserted by migration `002` itself (`admin`, `user`) — already present the moment migrations are applied, never touched by data migration. |
| `users`, `local_credentials`, `auth_identities`, `user_roles`, `sessions` | **D** | 3 / 3 / 3 / 3 / 21 | **Do not copy any Preview account.** `admin`, `usertest`, `patamin` are all session/dev-bootstrap identities (confirmed: `admin` and `usertest` share the exact same `created_at` timestamp, consistent with `scripts/bootstrap-development-accounts.ts`, which creates both together and explicitly refuses to run when `NODE_ENV=production`). Production gets exactly one fresh admin — see §4. |
| `http_rate_limit_buckets` | **D** | 16 | Transient rate-limit state, meaningless outside the environment that generated it. |
| `audit_events` | **D** | 211 | Preview's own testing/audit trail (logins, saves, admin actions performed during this session's UAT) — not Production's history. Production starts its audit trail from zero, at go-live. |
| `provenance_records` | **B** | 136 | Provenance rows *for the historical data being migrated* (source file hash/sheet/location per imported value) — migrate **only** alongside the historical tables in §2, re-keyed to Production's new IDs; do not migrate rows tied to Preview-only test activity. |
| `migration_batches`, `migration_errors` | **C** | 2 / 0 | Re-run the original Excel→Postgres import tooling directly against Production (recommended in the prior provisioning plan, §D Option 1) — this naturally creates Production's own batch/provenance records, more auditable than copying Preview's batch IDs. |
| `calculation_runs`, `calculation_output_values` | **E** | 134 / 0 | Cache/derived tables (`calculation_output_values` is already empty even in Preview) — safe to leave empty; recomputed on demand by the app, never a migration source. |
| `legacy_cached_evidence` | **D** | 461 | Explicitly "evidence only," separate from authoritative raw inputs (per migration `001`'s own comment) — not required for the app to function; skip unless a specific audit need is identified later. |
| `workbook_source_versions` | **E** | 0 | Empty in Preview too (migration `003`'s table, never populated by any code path found this session). |
| `backup_config`, `backup_log`, `google_oauth_states`, `google_sheets_connections` | **D** | 0 / 1 / 0 / 0 | Google Backup is permanently out of scope. The single `backup_log` row is a test artifact from this session's own live UAT click — explicitly must not migrate, per your instruction. |
| `schema_migrations` | **E** | 11 | Populated automatically as Production's own migrations are applied — never copied, each environment tracks its own migration history. |

---

## 2. Historical data — exact migration detail

| Table | Source rows | Expected Production rows | Date range | Facility coverage | Dependencies | Method |
| --- | --- | --- | --- | --- | --- | --- |
| `sites` | 2 | 2 | — | Rangsit, Srinakarin | none (root) | Re-insert exact values (`code`/`name`), new IDs |
| `monthly_periods` | 134 | 134 | Rangsit `2020-12`–`2026-06`; Srinakarin `2021-01`–`2026-07` | Both | `sites` | Insert per (new_site_id, period_month), capture old→new period ID map |
| `ups_readings` | 749 | 749 | same as parent period | Both | `monthly_periods`, `devices` (auto-created) | Insert per period, device upserted by code first |
| `air_meter_readings` | 804 | 804 | same | Both | `monthly_periods`, `air_meters` (auto-created) | Same pattern |
| `dc_readings` | 284 | 284 | same | Both | `monthly_periods`, `dc_panels` (auto-created) | Same pattern |
| `electrical_phase_readings` | 448 | 448 | same | Srinakarin only (source-kind confirms Srinakarin-specific per-phase inputs) | `monthly_periods` | Same pattern |
| `energy_cost_inputs` | 134 | 134 | same | Both | `monthly_periods` | 1:1 with periods |
| `rack_capacity_snapshots` / `records` | 2 / 595 | 2 / 595 | current-state only (not month-series) | Rangsit 358 records, Srinakarin 237 records | `sites` | Insert snapshot then records |
| `rack_unit_capacity_snapshots` | 7 | 7 | Srinakarin `2026-01`–`2026-07` only | Srinakarin only | `sites` | Direct insert, no FK remap needed beyond site_id |
| `provenance_records` (historical subset only) | subset of 136 | matches whatever subset ties to migrated rows | — | Both | `monthly_periods`/entity being described | Re-key `entity_id` to new IDs, or regenerate fresh via re-running import tooling (preferred — see recommendation below) |

**Recommendation, restated from the prior provisioning plan and unchanged**: prefer **re-running the original Excel→Postgres import tooling directly against the new Production database from the source XLSM files**, rather than a row-level Preview→Production copy. This produces Production's own genuinely independent `migration_batches`/`provenance_records` (more auditable, matches the "Preview and Production never share data" architecture already documented in `PHASE7_1_VERCEL_PREVIEW.md`), and side-steps every ID-remapping risk in the table above entirely. The row-level copy script below exists as the **fallback method** if re-running the importer against the real XLSM files isn't feasible before go-live.

**Explicitly excluded from any historical migration, per your instruction**: the `backup_log` test row, `patamin`/`usertest`/Preview `admin` accounts and their sessions/credentials, and anything under `google_oauth_states`/`google_sheets_connections`/`backup_config`.

---

## 3. Data dependencies / order

```
1. sites
2. site_profiles                (optional, alongside sites)
3. global_settings               (Product-Owner-decided values)
4. monthly_periods                (per site)
5. ups_readings                   } all reference monthly_periods;
   air_meter_readings             } devices/air_meters/dc_panels
   dc_readings                    } auto-created by the same upsert
   electrical_phase_readings      } logic saveMonthlyLogInTransaction
   energy_cost_inputs             } already uses
6. rack_capacity_snapshots → rack_capacity_records
7. rack_unit_capacity_snapshots
8. provenance_records              (only if doing the row-copy fallback,
                                     after 4-7 so entity_ids exist)
9. Admin bootstrap                 (§4 — independent of the above,
                                     can happen at any point before go-live)
```

`ups_group_history`, `devices`, `air_meters`, `dc_panels`, `electrical_profiles` are deliberately **not** in this order — they self-provision as a side effect of step 5 (device/meter/panel upserts) and of the app being used after go-live (UPS History backfill), not as separate migration steps.

---

## 4. Admin creation procedure

**Do not copy any Preview user.** Production gets exactly one fresh admin via the existing, already-verified Production-safe mechanism:

```
npx tsx scripts/bootstrap-admin.ts
```

with `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_DISPLAY_NAME` set in the environment the script runs in (operator's own shell, pointed at Production's `DATABASE_URL`/`DIRECT_DATABASE_URL` — never committed, never typed into chat).

This script (read in full, unmodified, this session):
- Refuses to run if `countUsers() !== 0` — cannot accidentally create a second admin or run against an already-populated database.
- Does not touch `NODE_ENV=production` guards the way the dev-only scripts do — it's the one bootstrap script actually designed for Production use.

**Per your instruction: if real admin username/password values are needed, I stop and ask you — I am not requesting them now, and will not generate or invent them.**

---

## 5. Verification procedure (deterministic, per table)

For every migrated table, before declaring the migration complete:

| Check | Method |
| --- | --- |
| Row counts | `SELECT count(*)` source vs target, must match exactly (see table in §2 for expected values) |
| Primary keys | Confirm target PKs are freshly auto-generated (not copied from source) and internally consistent (no gaps that break FK chains) |
| Foreign keys | Every `site_id`/`period_id`/`device_id`/`snapshot_id` in target resolves to a real row in the corresponding target table (`NOT EXISTS` anti-join check, must return zero rows) |
| Site IDs / facility isolation | `GROUP BY site_id` counts per table must match the per-facility breakdown already recorded in §2 (e.g. Rangsit 67 periods / Srinakarin 67 periods) — a mismatch means cross-facility data got mixed up during remapping |
| Date/month coverage | `MIN`/`MAX(period_month)` per site must exactly match §2's recorded ranges |
| Aggregate totals | `SUM(load_kw)`, `SUM(load_kva)` on `ups_readings` must equal the source values captured this session: **19,536.00 kW / 19,745.20 kVA** across all 749 rows — any deviation means a value was altered, not just moved |
| Spot-check against XLSM | Re-run the same cross-check already performed this session for UPS History (raw device readings summed per real topology reproduce the exact historical "2. UPS Group History" values) against Production's copy, for at least Rangsit and Srinakarin June 2026 |
| RLS/grants | Full checklist already specified in `PRODUCTION_DATABASE_PROVISIONING_PLAN.md` §E, re-run against the now-populated database |
| No silent transformation | Diff a sample of raw `raw_inputs` JSONB columns (a handful of rows per table) byte-for-byte between source and target — these are stored verbatim and must never be reformatted/re-serialized differently during copy |

---

## 6. Migration method (prepared, not executed)

A real, reviewable script has been prepared at `scripts/migrate-preview-to-production.ts` (see below), following the exact same safety pattern already established by `scripts/bootstrap-admin.ts`:

- **Defaults to `--dry-run`** — read-only against the source, computes and prints exactly what it *would* copy (counts, aggregates, date ranges) without writing anything anywhere.
- Requires an explicit `--execute` flag **and** `MIGRATION_ALLOW_WRITE=true` **and** a target connection string that is verified, at runtime, to be a genuinely different database than the source (refuses to run if source and target resolve to the same project — a hard guard against accidentally double-writing into Preview).
- Only touches the tables classified **A**/**B** above, in the exact dependency order from §3.
- Remaps `site_id`/`period_id`/`device_id`/`snapshot_id` via an in-memory old→new ID map built as rows are inserted — never assumes IDs match between source and target.
- Never touches `users`/`sessions`/`credentials`/`audit_events`/`http_rate_limit_buckets`/anything Google-Backup-related — those table names are not present anywhere in the script.

**This session only ran the script in `--dry-run` mode against Preview** (pure `SELECT`s, zero writes, safe under "Preview must remain untouched") to confirm its counting/aggregation logic matches the real numbers in this document. It has never connected to, or written to, any Production target — none exists yet.

---

## 7. Rollback / recovery procedure

- Since Production starts empty and this migration is a **one-time import into a brand-new database**, "rollback" here means: if verification (§5) fails, **do not go live** — fix the script/process and re-run against a freshly re-provisioned (or truncated-and-reset) Production database, rather than attempting to patch partial/incorrect data in place.
- The script is designed to be **idempotent-safe to re-attempt**: because it always starts from an empty target (verification in §5 would catch a non-empty target before go-live), re-running after fixing an issue is a clean re-import, not a delta/merge operation.
- Once Production has accepted real operational writes (post go-live), ordinary rules apply: never drop/reset schema, additive-only migrations, Vercel Instant Rollback for application-code issues — per `docs/web-v3/ROLLBACK_PLAN.md`, already the standing policy.
- Source data (Preview) is never modified by this process at any point — the source of truth for a re-attempt always remains intact.

---

## Summary

No code was executed against Preview beyond read-only `SELECT`s. No Production target exists, so nothing was written anywhere. Waiting for explicit approval before any `--execute` run.
