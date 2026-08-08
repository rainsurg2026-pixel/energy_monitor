-- Energy Monitor Web v3 Phase 2 foundation.
-- This migration stores raw inputs and provenance. Ordinary derived values are
-- recomputed by the Phase 1 domain layer and are not authoritative columns.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL UNIQUE REFERENCES sites(id),
  profile_code text NOT NULL,
  profile_version text NOT NULL DEFAULT 'v3.0.0',
  formula_version text NOT NULL DEFAULT 'desktop-v2.3.1',
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS devices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ups', 'air', 'dc', 'ppc', 'other')),
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code),
  UNIQUE (id, site_id)
);

CREATE TABLE IF NOT EXISTS air_meters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (site_id, code),
  UNIQUE (id, site_id)
);

CREATE TABLE IF NOT EXISTS dc_panels (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id),
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (site_id, code),
  UNIQUE (id, site_id)
);

CREATE TABLE IF NOT EXISTS ups_groups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id),
  name text NOT NULL,
  capacity_kva numeric,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (site_id, name),
  UNIQUE (id, site_id)
);

CREATE TABLE IF NOT EXISTS ups_group_members (
  group_id bigint NOT NULL REFERENCES ups_groups(id) ON DELETE CASCADE,
  device_id bigint NOT NULL REFERENCES devices(id),
  site_id bigint NOT NULL REFERENCES sites(id),
  member_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, device_id),
  FOREIGN KEY (group_id, site_id) REFERENCES ups_groups(id, site_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id, site_id) REFERENCES devices(id, site_id)
);

CREATE TABLE IF NOT EXISTS electrical_profiles (
  site_id bigint PRIMARY KEY REFERENCES sites(id),
  profile_version text NOT NULL DEFAULT 'desktop-v2.3.1',
  ups_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  dc_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  air_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  special_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monthly_periods (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id),
  period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, period_month),
  UNIQUE (id, site_id)
);

CREATE TABLE IF NOT EXISTS ups_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint NOT NULL REFERENCES monthly_periods(id) ON DELETE CASCADE,
  device_id bigint NOT NULL REFERENCES devices(id),
  site_id bigint NOT NULL REFERENCES sites(id),
  phase_code text NOT NULL DEFAULT '',
  voltage numeric,
  current numeric,
  load_kw numeric,
  load_kva numeric,
  raw_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (period_id, device_id, phase_code),
  FOREIGN KEY (period_id, site_id) REFERENCES monthly_periods(id, site_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id, site_id) REFERENCES devices(id, site_id)
);

CREATE TABLE IF NOT EXISTS air_meter_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint NOT NULL REFERENCES monthly_periods(id) ON DELETE CASCADE,
  meter_id bigint NOT NULL REFERENCES air_meters(id),
  site_id bigint NOT NULL REFERENCES sites(id),
  reading numeric,
  raw_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (period_id, meter_id),
  FOREIGN KEY (period_id, site_id) REFERENCES monthly_periods(id, site_id) ON DELETE CASCADE,
  FOREIGN KEY (meter_id, site_id) REFERENCES air_meters(id, site_id)
);

CREATE TABLE IF NOT EXISTS dc_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint NOT NULL REFERENCES monthly_periods(id) ON DELETE CASCADE,
  panel_id bigint NOT NULL REFERENCES dc_panels(id),
  site_id bigint NOT NULL REFERENCES sites(id),
  voltage numeric,
  current numeric,
  raw_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (period_id, panel_id),
  FOREIGN KEY (period_id, site_id) REFERENCES monthly_periods(id, site_id) ON DELETE CASCADE,
  FOREIGN KEY (panel_id, site_id) REFERENCES dc_panels(id, site_id)
);

-- Covers UPS phase, raw AC phase, PPC43 current and PPC43 panel inputs without
-- collapsing the source-specific readings into derived aggregates.
CREATE TABLE IF NOT EXISTS electrical_phase_readings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint NOT NULL REFERENCES monthly_periods(id) ON DELETE CASCADE,
  device_id bigint REFERENCES devices(id),
  site_id bigint NOT NULL REFERENCES sites(id),
  source_kind text NOT NULL CHECK (source_kind IN ('ups_phase', 'ac_phase', 'ppc43_current', 'ppc43_panel')),
  source_key text NOT NULL,
  phase_code text NOT NULL DEFAULT '',
  panel_key text NOT NULL DEFAULT '',
  voltage numeric,
  current numeric,
  load_kw numeric,
  load_kva numeric,
  raw_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (period_id, source_kind, source_key, phase_code, panel_key),
  FOREIGN KEY (period_id, site_id) REFERENCES monthly_periods(id, site_id) ON DELETE CASCADE,
  FOREIGN KEY (device_id, site_id) REFERENCES devices(id, site_id)
);

CREATE TABLE IF NOT EXISTS energy_cost_inputs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint NOT NULL UNIQUE REFERENCES monthly_periods(id) ON DELETE CASCADE,
  site_id bigint NOT NULL REFERENCES sites(id),
  building_energy_kwh numeric,
  building_cost_thb numeric,
  raw_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, site_id) REFERENCES monthly_periods(id, site_id)
);

-- Workbook cached/derived values are evidence only and are deliberately kept
-- separate from authoritative raw inputs above.
CREATE TABLE IF NOT EXISTS legacy_cached_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint REFERENCES monthly_periods(id) ON DELETE CASCADE,
  site_id bigint REFERENCES sites(id),
  field_name text NOT NULL,
  numeric_value numeric,
  text_value text,
  source_sheet text,
  source_location text,
  formula_version text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (period_id, site_id) REFERENCES monthly_periods(id, site_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rack_capacity_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id),
  snapshot_month date NOT NULL CHECK (snapshot_month = date_trunc('month', snapshot_month)::date),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, snapshot_month)
);

CREATE TABLE IF NOT EXISTS rack_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id),
  rack_code text NOT NULL,
  rack_zone text,
  cabinet_size text,
  device_type text,
  detail text,
  remarks text,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (site_id, rack_code)
);

CREATE TABLE IF NOT EXISTS rack_capacity_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES rack_capacity_snapshots(id) ON DELETE CASCADE,
  source_row_number integer,
  rack_zone text,
  rack_id text,
  status text,
  cabinet_size text,
  detail text,
  device_type text,
  remarks text,
  raw_inputs jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS rack_unit_capacity_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES sites(id),
  period_month date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  total_u numeric NOT NULL CHECK (total_u >= 0),
  used_u numeric NOT NULL CHECK (used_u >= 0),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, period_month)
);

CREATE TABLE IF NOT EXISTS rack_unit_capacity_images (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id bigint NOT NULL REFERENCES rack_unit_capacity_snapshots(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint,
  sha256 text,
  width integer,
  height integer,
  saved_at timestamptz NOT NULL DEFAULT now(),
  saved_by text NOT NULL DEFAULT 'system',
  UNIQUE (snapshot_id, object_key)
);

CREATE TABLE IF NOT EXISTS global_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  start_month date NOT NULL CHECK (start_month = date_trunc('month', start_month)::date),
  end_month date NOT NULL CHECK (end_month = date_trunc('month', end_month)::date),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_month <= end_month)
);

CREATE TABLE IF NOT EXISTS provenance_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id bigint NOT NULL,
  source_type text NOT NULL,
  source_file_hash text,
  source_file_name text,
  source_sheet text,
  source_location text,
  migration_batch_id bigint,
  imported_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS migration_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_type text NOT NULL,
  source_identity text NOT NULL,
  source_hash text,
  status text NOT NULL CHECK (status IN ('read', 'validated', 'previewed', 'imported', 'verified', 'failed')),
  row_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provenance_migration_batch_fk'
  ) THEN
    ALTER TABLE provenance_records
      ADD CONSTRAINT provenance_migration_batch_fk
      FOREIGN KEY (migration_batch_id) REFERENCES migration_batches(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS migration_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  migration_batch_id bigint NOT NULL REFERENCES migration_batches(id) ON DELETE CASCADE,
  source_location text,
  error_code text NOT NULL,
  message text NOT NULL,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type text NOT NULL DEFAULT 'system',
  actor_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  correlation_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS calculation_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_id bigint NOT NULL REFERENCES monthly_periods(id) ON DELETE CASCADE,
  calculation_type text NOT NULL,
  formula_version text NOT NULL,
  input_hash text,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, calculation_type, formula_version, input_hash)
);

CREATE TABLE IF NOT EXISTS calculation_output_values (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES calculation_runs(id) ON DELETE CASCADE,
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  metric_code text NOT NULL,
  unit text,
  numeric_value numeric,
  json_value jsonb,
  source_role text NOT NULL CHECK (source_role IN ('calculated', 'workbook_cached')),
  UNIQUE (run_id, scope_type, scope_key, metric_code)
);

CREATE INDEX IF NOT EXISTS monthly_periods_site_month_idx ON monthly_periods(site_id, period_month);
CREATE INDEX IF NOT EXISTS site_profiles_code_idx ON site_profiles(profile_code);
CREATE INDEX IF NOT EXISTS ups_readings_period_idx ON ups_readings(period_id);
CREATE INDEX IF NOT EXISTS ups_readings_device_idx ON ups_readings(device_id);
CREATE INDEX IF NOT EXISTS air_meter_readings_period_idx ON air_meter_readings(period_id);
CREATE INDEX IF NOT EXISTS air_meter_readings_meter_idx ON air_meter_readings(meter_id);
CREATE INDEX IF NOT EXISTS dc_readings_period_idx ON dc_readings(period_id);
CREATE INDEX IF NOT EXISTS dc_readings_panel_idx ON dc_readings(panel_id);
CREATE INDEX IF NOT EXISTS electrical_phase_period_idx ON electrical_phase_readings(period_id);
CREATE INDEX IF NOT EXISTS legacy_evidence_period_idx ON legacy_cached_evidence(period_id);
CREATE INDEX IF NOT EXISTS rack_capacity_site_month_idx ON rack_capacity_snapshots(site_id, snapshot_month);
CREATE INDEX IF NOT EXISTS rack_unit_site_month_idx ON rack_unit_capacity_snapshots(site_id, period_month);
CREATE INDEX IF NOT EXISTS rack_assets_site_idx ON rack_assets(site_id);
CREATE INDEX IF NOT EXISTS provenance_entity_idx ON provenance_records(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS migration_batch_source_idx ON migration_batches(source_type, source_identity);
CREATE INDEX IF NOT EXISTS audit_occurred_idx ON audit_events(occurred_at);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS calculation_runs_period_idx ON calculation_runs(period_id, calculated_at);
