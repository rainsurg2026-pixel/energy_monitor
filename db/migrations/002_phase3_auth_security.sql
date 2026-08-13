-- Energy Monitor Web v3 Phase 3, Agent 3: authentication schema security.
-- Applies after 001_phase2_foundation.sql.
--
-- This migration implements local application authentication, not Supabase
-- Auth. The API authenticates users and enforces RBAC; PostgreSQL/RLS is the
-- defense-in-depth boundary around the server-only backend role. No login role
-- or password is created here.

-- The runtime role is a NOLOGIN group role. A separately provisioned login
-- role must be granted membership out-of-band by a database administrator.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'energy_monitor_runtime') THEN
    EXECUTE 'CREATE ROLE energy_monitor_runtime NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  ELSIF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'energy_monitor_runtime'
      AND (rolsuper OR rolcanlogin OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolinherit)
  ) THEN
    RAISE EXCEPTION 'energy_monitor_runtime exists with unsafe role attributes';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL,
  normalized_username text NOT NULL,
  display_name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failed_attempt_count integer NOT NULL DEFAULT 0 CHECK (failed_attempt_count >= 0),
  locked_until timestamptz,
  password_changed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_shape_ck CHECK (
    username = btrim(username)
    AND char_length(username) BETWEEN 1 AND 128
  ),
  CONSTRAINT users_normalized_username_shape_ck CHECK (
    normalized_username = lower(normalized_username)
    AND normalized_username = btrim(normalized_username)
    AND char_length(normalized_username) BETWEEN 1 AND 128
  ),
  CONSTRAINT users_normalized_username_uk UNIQUE (normalized_username)
);

CREATE TABLE IF NOT EXISTS public.local_credentials (
  user_id bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  password_version integer NOT NULL DEFAULT 1 CHECK (password_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auth_identities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('local', 'entra')),
  provider_subject text NOT NULL,
  provider_tenant text NOT NULL DEFAULT '',
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_identities_subject_shape_ck CHECK (
    provider_subject = btrim(provider_subject)
    AND char_length(provider_subject) BETWEEN 1 AND 512
  ),
  CONSTRAINT auth_identities_tenant_shape_ck CHECK (
    provider_tenant = btrim(provider_tenant)
    AND char_length(provider_tenant) <= 256
  ),
  CONSTRAINT auth_identities_entra_tenant_ck CHECK (
    provider = 'local' OR provider_tenant <> ''
  ),
  CONSTRAINT auth_identities_provider_subject_uk UNIQUE (provider, provider_tenant, provider_subject)
);

CREATE TABLE IF NOT EXISTS public.roles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_name_shape_ck CHECK (
    name = lower(btrim(name))
    AND name IN ('admin', 'user')
  ),
  CONSTRAINT roles_name_uk UNIQUE (name)
);

-- v3.0.0 assigns one effective role per user. A future multi-role model
-- requires a deliberate migration and authorization review.
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES public.roles(id),
  assigned_by_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  created_ip inet,
  user_agent text,
  revocation_reason text,
  CONSTRAINT sessions_token_hash_shape_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessions_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT sessions_user_agent_length_ck CHECK (user_agent IS NULL OR char_length(user_agent) <= 1024),
  CONSTRAINT sessions_revocation_reason_length_ck CHECK (revocation_reason IS NULL OR char_length(revocation_reason) <= 256)
);

-- Durable login/request rate-limit buckets. Keys are SHA-256 digests; raw IPs
-- and usernames are never persisted in this table.
CREATE TABLE IF NOT EXISTS public.http_rate_limit_buckets (
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL CHECK (hit_count > 0),
  PRIMARY KEY (key_hash, window_start),
  CONSTRAINT http_rate_limit_key_shape_ck CHECK (key_hash ~ '^[0-9a-f]{64}$')
);

-- Preserve Phase 2 system audit rows while allowing authenticated writes to
-- carry the stable application user identity.
ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS actor_user_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_events_actor_user_id_fk'
      AND conrelid = 'public.audit_events'::regclass
  ) THEN
    ALTER TABLE public.audit_events
      ADD CONSTRAINT audit_events_actor_user_id_fk
      FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

INSERT INTO public.roles (name, description)
VALUES
  ('admin', 'Full application administration and operational access'),
  ('user', 'Shared operational read/write access without administration')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description;

CREATE INDEX IF NOT EXISTS users_active_idx
  ON public.users(active);
CREATE INDEX IF NOT EXISTS users_locked_until_idx
  ON public.users(locked_until)
  WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS auth_identities_user_idx
  ON public.auth_identities(user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_idx
  ON public.user_roles(role_id);
CREATE INDEX IF NOT EXISTS user_roles_assigned_by_idx
  ON public.user_roles(assigned_by_user_id)
  WHERE assigned_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sessions_user_active_idx
  ON public.sessions(user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_expiry_idx
  ON public.sessions(expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS audit_events_actor_user_idx
  ON public.audit_events(actor_user_id, occurred_at);

-- All Phase 2 tables, auth tables, and the durable rate-limit table are
-- RLS-protected. Tables
-- not listed in runtime_* below intentionally receive no runtime policy/grant.
DO $$
DECLARE
  table_name text;
  all_tables text[] := ARRAY[
    'schema_migrations', 'sites', 'site_profiles', 'devices', 'air_meters',
    'dc_panels', 'ups_groups', 'ups_group_members', 'electrical_profiles',
    'monthly_periods', 'ups_readings', 'air_meter_readings', 'dc_readings',
    'electrical_phase_readings', 'energy_cost_inputs', 'legacy_cached_evidence',
    'rack_capacity_snapshots', 'rack_assets', 'rack_capacity_records',
    'rack_unit_capacity_snapshots', 'rack_unit_capacity_images', 'global_settings',
    'provenance_records', 'migration_batches', 'migration_errors', 'audit_events',
    'calculation_runs', 'calculation_output_values',
    'users', 'local_credentials', 'auth_identities', 'roles', 'user_roles', 'sessions',
    'http_rate_limit_buckets'
  ];
BEGIN
  FOREACH table_name IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    -- Keep the migration owner able to record migration metadata. The
    -- dedicated runtime role has NOBYPASSRLS and is always subject to these
    -- policies; application connections must never use the migration owner.
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'sites', 'site_profiles', 'devices', 'air_meters', 'dc_panels', 'ups_groups',
    'ups_group_members', 'electrical_profiles', 'monthly_periods', 'ups_readings',
    'air_meter_readings', 'dc_readings', 'electrical_phase_readings',
    'energy_cost_inputs', 'rack_capacity_snapshots', 'rack_assets',
    'rack_capacity_records', 'rack_unit_capacity_snapshots',
    'rack_unit_capacity_images', 'global_settings', 'calculation_runs',
    'calculation_output_values', 'users', 'local_credentials', 'auth_identities',
    'user_roles', 'sessions', 'http_rate_limit_buckets'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy
      WHERE polname = 'energy_monitor_runtime_all'
        AND polrelid = format('public.%I', table_name)::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY energy_monitor_runtime_all ON public.%I AS PERMISSIVE FOR ALL TO energy_monitor_runtime USING (pg_has_role(current_user, ''energy_monitor_runtime'', ''member'')) WITH CHECK (pg_has_role(current_user, ''energy_monitor_runtime'', ''member''))',
        table_name
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_roles_select'
      AND polrelid = 'public.roles'::regclass
  ) THEN
    EXECUTE 'CREATE POLICY energy_monitor_runtime_roles_select ON public.roles FOR SELECT TO energy_monitor_runtime USING (pg_has_role(current_user, ''energy_monitor_runtime'', ''member''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_audit_select'
      AND polrelid = 'public.audit_events'::regclass
  ) THEN
    EXECUTE 'CREATE POLICY energy_monitor_runtime_audit_select ON public.audit_events FOR SELECT TO energy_monitor_runtime USING (pg_has_role(current_user, ''energy_monitor_runtime'', ''member''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_audit_insert'
      AND polrelid = 'public.audit_events'::regclass
  ) THEN
    EXECUTE 'CREATE POLICY energy_monitor_runtime_audit_insert ON public.audit_events FOR INSERT TO energy_monitor_runtime WITH CHECK (pg_has_role(current_user, ''energy_monitor_runtime'', ''member''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_provenance_select'
      AND polrelid = 'public.provenance_records'::regclass
  ) THEN
    EXECUTE 'CREATE POLICY energy_monitor_runtime_provenance_select ON public.provenance_records FOR SELECT TO energy_monitor_runtime USING (pg_has_role(current_user, ''energy_monitor_runtime'', ''member''))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_provenance_insert'
      AND polrelid = 'public.provenance_records'::regclass
  ) THEN
    EXECUTE 'CREATE POLICY energy_monitor_runtime_provenance_insert ON public.provenance_records FOR INSERT TO energy_monitor_runtime WITH CHECK (pg_has_role(current_user, ''energy_monitor_runtime'', ''member''))';
  END IF;
END $$;

-- Remove Phase 2 default table exposure. This also removes direct
-- service_role access; the application must use the dedicated backend role.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON TABLE public.schema_migrations,
  public.sites,
  public.site_profiles,
  public.devices,
  public.air_meters,
  public.dc_panels,
  public.ups_groups,
  public.ups_group_members,
  public.electrical_profiles,
  public.monthly_periods,
  public.ups_readings,
  public.air_meter_readings,
  public.dc_readings,
  public.electrical_phase_readings,
  public.energy_cost_inputs,
  public.legacy_cached_evidence,
  public.rack_capacity_snapshots,
  public.rack_assets,
  public.rack_capacity_records,
  public.rack_unit_capacity_snapshots,
  public.rack_unit_capacity_images,
  public.global_settings,
  public.provenance_records,
  public.migration_batches,
  public.migration_errors,
  public.audit_events,
  public.calculation_runs,
  public.calculation_output_values,
  public.users,
  public.local_credentials,
  public.auth_identities,
  public.roles,
  public.user_roles,
  public.sessions,
  public.http_rate_limit_buckets
FROM PUBLIC;

DO $$
DECLARE
  table_name text;
  role_name text;
  all_tables text[] := ARRAY[
    'schema_migrations', 'sites', 'site_profiles', 'devices', 'air_meters',
    'dc_panels', 'ups_groups', 'ups_group_members', 'electrical_profiles',
    'monthly_periods', 'ups_readings', 'air_meter_readings', 'dc_readings',
    'electrical_phase_readings', 'energy_cost_inputs', 'legacy_cached_evidence',
    'rack_capacity_snapshots', 'rack_assets', 'rack_capacity_records',
    'rack_unit_capacity_snapshots', 'rack_unit_capacity_images', 'global_settings',
    'provenance_records', 'migration_batches', 'migration_errors', 'audit_events',
    'calculation_runs', 'calculation_output_values',
    'users', 'local_credentials', 'auth_identities', 'roles', 'user_roles', 'sessions',
    'http_rate_limit_buckets'
  ];
BEGIN
  -- Supabase projects normally have these roles; existence checks keep this
  -- migration portable to a plain local PostgreSQL instance.
  FOR role_name IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname = ANY (ARRAY['anon', 'authenticated', 'service_role'])
  LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', role_name);
    FOREACH table_name IN ARRAY all_tables LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
    END LOOP;
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
  END LOOP;

  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC';
END $$;

-- Server-only runtime grants. There is intentionally no grant on
-- schema_migrations, legacy_cached_evidence, migration_batches, or
-- migration_errors; those remain migration/admin concerns.
GRANT USAGE ON SCHEMA public TO energy_monitor_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.sites,
  public.site_profiles,
  public.devices,
  public.air_meters,
  public.dc_panels,
  public.ups_groups,
  public.ups_group_members,
  public.electrical_profiles,
  public.monthly_periods,
  public.ups_readings,
  public.air_meter_readings,
  public.dc_readings,
  public.electrical_phase_readings,
  public.energy_cost_inputs,
  public.rack_capacity_snapshots,
  public.rack_assets,
  public.rack_capacity_records,
  public.rack_unit_capacity_snapshots,
  public.rack_unit_capacity_images,
  public.global_settings,
  public.calculation_runs,
  public.calculation_output_values,
  public.http_rate_limit_buckets
TO energy_monitor_runtime;

GRANT SELECT, INSERT, UPDATE ON TABLE public.users, public.local_credentials TO energy_monitor_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_identities, public.user_roles, public.sessions TO energy_monitor_runtime;
GRANT SELECT ON TABLE public.roles TO energy_monitor_runtime;
GRANT SELECT, INSERT ON TABLE public.audit_events, public.provenance_records TO energy_monitor_runtime;

-- Grant sequence access only for identity sequences used by runtime-writable
-- tables. No TRUNCATE, REFERENCES, TRIGGER, DDL, or BYPASSRLS is granted.
DO $$
DECLARE
  table_name text;
  sequence_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sites', 'site_profiles', 'devices', 'air_meters', 'dc_panels', 'ups_groups',
    'monthly_periods', 'ups_readings', 'air_meter_readings', 'dc_readings',
    'electrical_phase_readings', 'energy_cost_inputs', 'rack_capacity_snapshots',
    'rack_assets', 'rack_capacity_records', 'rack_unit_capacity_snapshots',
    'rack_unit_capacity_images', 'calculation_runs', 'calculation_output_values',
    'users', 'auth_identities', 'sessions', 'audit_events', 'provenance_records'
  ] LOOP
    sequence_name := pg_get_serial_sequence(format('public.%I', table_name), 'id');
    IF sequence_name IS NOT NULL THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO energy_monitor_runtime', sequence_name::regclass);
    END IF;
  END LOOP;
END $$;
