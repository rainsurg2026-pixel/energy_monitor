-- Desktop v2.3.1 parity: retain the workbook's persisted
-- "2. UPS Group History" rows as immutable-by-key historical facts.
CREATE TABLE IF NOT EXISTS public.ups_group_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  source_sheet text NOT NULL DEFAULT '2. UPS Group History',
  facility text NOT NULL CHECK (btrim(facility) <> ''),
  history_month date NOT NULL CHECK (history_month = date_trunc('month', history_month)::date),
  group_name text NOT NULL CHECK (btrim(group_name) <> ''),
  total_load_kw numeric NOT NULL CHECK (total_load_kw >= 0),
  total_load_kva numeric NOT NULL CHECK (total_load_kva >= 0),
  capacity numeric NULL CHECK (capacity IS NULL OR capacity > 0),
  load_percent numeric NULL CHECK (load_percent IS NULL OR load_percent >= 0),
  available_percent numeric NULL CHECK (available_percent IS NULL OR available_percent >= 0),
  monthly_energy_kwh numeric NOT NULL CHECK (monthly_energy_kwh >= 0),
  generated_at timestamptz NULL,
  data_version integer NULL,
  CONSTRAINT ups_group_history_site_month_group_uk UNIQUE (site_id, history_month, group_name)
);

CREATE INDEX IF NOT EXISTS ups_group_history_site_month_idx
  ON public.ups_group_history(site_id, history_month, group_name);

ALTER TABLE public.ups_group_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_ups_group_history_all'
      AND polrelid = 'public.ups_group_history'::regclass
  ) THEN
    CREATE POLICY energy_monitor_runtime_ups_group_history_all
      ON public.ups_group_history
      AS PERMISSIVE FOR ALL TO energy_monitor_runtime
      USING (pg_has_role(current_user, 'energy_monitor_runtime', 'member'))
      WITH CHECK (pg_has_role(current_user, 'energy_monitor_runtime', 'member'));
  END IF;
END $$;

REVOKE ALL ON TABLE public.ups_group_history FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['anon', 'authenticated', 'service_role']) LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.ups_group_history FROM %I', role_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ups_group_history TO energy_monitor_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.ups_group_history_id_seq TO energy_monitor_runtime;
