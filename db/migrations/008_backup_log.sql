-- Google Sheets backup run log (BACKUP/RECOVERY layer metadata only).
-- Supabase/PostgreSQL remains the system Source of Truth; this table never
-- stores the backed-up data itself, only the record of each backup attempt.

CREATE TABLE IF NOT EXISTS public.backup_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  backup_type text NOT NULL CHECK (backup_type IN ('scheduled', 'manual')),
  status text NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  records_processed integer NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
  records_success integer NOT NULL DEFAULT 0 CHECK (records_success >= 0),
  records_failed integer NOT NULL DEFAULT 0 CHECK (records_failed >= 0),
  error_summary text,
  initiated_by bigint REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT backup_log_completed_after_started_ck CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS backup_log_started_at_idx ON public.backup_log(started_at DESC);

ALTER TABLE public.backup_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_backup_log_all'
      AND polrelid = 'public.backup_log'::regclass
  ) THEN
    CREATE POLICY energy_monitor_runtime_backup_log_all
      ON public.backup_log
      AS PERMISSIVE FOR ALL TO energy_monitor_runtime
      USING (pg_has_role(current_user, 'energy_monitor_runtime', 'member'))
      WITH CHECK (pg_has_role(current_user, 'energy_monitor_runtime', 'member'));
  END IF;
END $$;

REVOKE ALL ON TABLE public.backup_log FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['anon', 'authenticated', 'service_role']) LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.backup_log FROM %I', role_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.backup_log TO energy_monitor_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.backup_log_id_seq TO energy_monitor_runtime;
