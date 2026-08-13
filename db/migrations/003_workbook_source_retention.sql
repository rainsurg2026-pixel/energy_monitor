-- Retain the original Desktop workbook package in Supabase Storage and keep
-- only immutable metadata in Postgres. The current source version is used by
-- the Web round-trip exporter to patch the original OOXML package rather than
-- rebuilding a reduced workbook.

CREATE TABLE IF NOT EXISTS public.workbook_source_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id bigint NOT NULL REFERENCES public.sites(id),
  source_file_name text NOT NULL,
  source_file_hash text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  actor_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL,
  correlation_id text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workbook_source_name_ck CHECK (btrim(source_file_name) = source_file_name AND char_length(source_file_name) BETWEEN 1 AND 255),
  CONSTRAINT workbook_source_hash_ck CHECK (source_file_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT workbook_source_object_key_ck CHECK (object_key = btrim(object_key) AND object_key <> '' AND left(object_key, 1) <> '/' AND position('..' in object_key) = 0),
  CONSTRAINT workbook_source_type_ck CHECK (content_type IN ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel.sheet.macroEnabled.12')),
  CONSTRAINT workbook_source_site_hash_uk UNIQUE (site_id, source_file_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS workbook_source_current_uk
  ON public.workbook_source_versions(site_id)
  WHERE is_current = true;
CREATE INDEX IF NOT EXISTS workbook_source_site_imported_idx
  ON public.workbook_source_versions(site_id, imported_at DESC, id DESC);

ALTER TABLE public.workbook_source_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_workbook_source_all'
      AND polrelid = 'public.workbook_source_versions'::regclass
  ) THEN
    CREATE POLICY energy_monitor_runtime_workbook_source_all
      ON public.workbook_source_versions
      AS PERMISSIVE FOR ALL TO energy_monitor_runtime
      USING (pg_has_role(current_user, 'energy_monitor_runtime', 'member'))
      WITH CHECK (pg_has_role(current_user, 'energy_monitor_runtime', 'member'));
  END IF;
END $$;

REVOKE ALL ON TABLE public.workbook_source_versions FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname = ANY (ARRAY['anon', 'authenticated', 'service_role']) LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.workbook_source_versions FROM %I', role_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.workbook_source_versions TO energy_monitor_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.workbook_source_versions_id_seq TO energy_monitor_runtime;
