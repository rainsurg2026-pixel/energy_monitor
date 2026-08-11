-- Admin-configurable Google Sheets backup destination. Extends the
-- migration 008 backup layer (does not modify it - 008 is treated as
-- already-applied history). Stores ONLY non-secret configuration: a
-- spreadsheet identifier and the admin's on/off toggle. The Google
-- service-account credential remains env-var-only (GOOGLE_BACKUP_
-- SERVICE_ACCOUNT_JSON) and is never written to any table.

CREATE TABLE IF NOT EXISTS public.backup_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  spreadsheet_id text,
  sheet_url text,
  enabled boolean NOT NULL DEFAULT false,
  updated_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Records which destination each backup run actually wrote to, so
-- changing destinations never loses track of where a past run went
-- (previous destinations are never touched or deleted by this migration
-- or by any backup code - this column is purely a historical record).
ALTER TABLE public.backup_log ADD COLUMN IF NOT EXISTS spreadsheet_id text;

ALTER TABLE public.backup_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_backup_config_all'
      AND polrelid = 'public.backup_config'::regclass
  ) THEN
    CREATE POLICY energy_monitor_runtime_backup_config_all
      ON public.backup_config
      AS PERMISSIVE FOR ALL TO energy_monitor_runtime
      USING (pg_has_role(current_user, 'energy_monitor_runtime', 'member'))
      WITH CHECK (pg_has_role(current_user, 'energy_monitor_runtime', 'member'));
  END IF;
END $$;

REVOKE ALL ON TABLE public.backup_config FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['anon', 'authenticated', 'service_role']) LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.backup_config FROM %I', role_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.backup_config TO energy_monitor_runtime;
