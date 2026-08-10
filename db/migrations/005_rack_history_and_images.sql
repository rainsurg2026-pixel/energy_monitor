-- Persist the Desktop v2.3.1 Rack Capacity History sheet and the
-- Rack Unit Capacity image metadata that the Web report renderer needs.
-- Image bytes remain in Supabase Storage; Postgres stores only immutable
-- identity/integrity metadata and the object key.

CREATE TABLE IF NOT EXISTS public.rack_capacity_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  snapshot_month date NOT NULL CHECK (snapshot_month = date_trunc('month', snapshot_month)::date),
  facility text NOT NULL CHECK (btrim(facility) <> ''),
  rack_zone text NOT NULL CHECK (btrim(rack_zone) <> ''),
  total_racks integer NOT NULL CHECK (total_racks >= 0),
  in_use integer NOT NULL CHECK (in_use >= 0),
  available integer NOT NULL CHECK (available >= 0),
  reserved integer NOT NULL CHECK (reserved >= 0),
  pending_dismantle integer NOT NULL CHECK (pending_dismantle >= 0),
  other integer NOT NULL CHECK (other >= 0),
  usage_pct numeric,
  availability_pct numeric,
  reserved_pct numeric,
  pending_dismantle_pct numeric,
  other_pct numeric,
  generated_at timestamptz NOT NULL,
  data_version integer NOT NULL CHECK (data_version > 0),
  CONSTRAINT rack_capacity_history_pct_ck CHECK (
    (usage_pct IS NULL OR usage_pct BETWEEN 0 AND 1) AND
    (availability_pct IS NULL OR availability_pct BETWEEN 0 AND 1) AND
    (reserved_pct IS NULL OR reserved_pct BETWEEN 0 AND 1) AND
    (pending_dismantle_pct IS NULL OR pending_dismantle_pct BETWEEN 0 AND 1) AND
    (other_pct IS NULL OR other_pct BETWEEN 0 AND 1)
  ),
  UNIQUE (site_id, snapshot_month, rack_zone)
);

CREATE INDEX IF NOT EXISTS rack_capacity_history_site_month_idx
  ON public.rack_capacity_history(site_id, snapshot_month, rack_zone);

ALTER TABLE public.rack_capacity_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_rack_capacity_history_all'
      AND polrelid = 'public.rack_capacity_history'::regclass
  ) THEN
    CREATE POLICY energy_monitor_runtime_rack_capacity_history_all
      ON public.rack_capacity_history
      AS PERMISSIVE FOR ALL TO energy_monitor_runtime
      USING (pg_has_role(current_user, 'energy_monitor_runtime', 'member'))
      WITH CHECK (pg_has_role(current_user, 'energy_monitor_runtime', 'member'));
  END IF;
END $$;

REVOKE ALL ON TABLE public.rack_capacity_history FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['anon', 'authenticated', 'service_role']) LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.rack_capacity_history FROM %I', role_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rack_capacity_history TO energy_monitor_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.rack_capacity_history_id_seq TO energy_monitor_runtime;

-- The image metadata table is created by the Phase 2 foundation migration.
-- Its RLS/privilege posture is asserted here as a defense against an
-- accidentally incomplete legacy migration set.
ALTER TABLE public.rack_unit_capacity_images ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rack_unit_capacity_images FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rack_unit_capacity_images TO energy_monitor_runtime;
