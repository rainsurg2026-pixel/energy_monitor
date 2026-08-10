-- Google Sheets server-side OAuth state and refresh-token storage.
-- Tokens are encrypted by the application before they reach PostgreSQL. The
-- database stores no access tokens and no raw OAuth state/verifier values.

CREATE TABLE IF NOT EXISTS public.google_oauth_states (
  state_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id bigint NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  encrypted_code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_oauth_state_hash_ck CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT google_oauth_verifier_length_ck CHECK (char_length(encrypted_code_verifier) BETWEEN 1 AND 4096),
  CONSTRAINT google_oauth_expiry_ck CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.google_sheets_connections (
  user_id bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  encrypted_refresh_token text NOT NULL,
  email text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_sheets_refresh_token_length_ck CHECK (char_length(encrypted_refresh_token) BETWEEN 1 AND 8192),
  CONSTRAINT google_sheets_email_length_ck CHECK (email IS NULL OR char_length(email) BETWEEN 3 AND 320)
);

CREATE INDEX IF NOT EXISTS google_oauth_states_expiry_idx
  ON public.google_oauth_states(expires_at);

ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_sheets_connections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_all'
      AND polrelid = 'public.google_oauth_states'::regclass
  ) THEN
    CREATE POLICY energy_monitor_runtime_all ON public.google_oauth_states
      AS PERMISSIVE FOR ALL TO energy_monitor_runtime
      USING (pg_has_role(current_user, 'energy_monitor_runtime', 'member'))
      WITH CHECK (pg_has_role(current_user, 'energy_monitor_runtime', 'member'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'energy_monitor_runtime_all'
      AND polrelid = 'public.google_sheets_connections'::regclass
  ) THEN
    CREATE POLICY energy_monitor_runtime_all ON public.google_sheets_connections
      AS PERMISSIVE FOR ALL TO energy_monitor_runtime
      USING (pg_has_role(current_user, 'energy_monitor_runtime', 'member'))
      WITH CHECK (pg_has_role(current_user, 'energy_monitor_runtime', 'member'));
  END IF;
END $$;

REVOKE ALL ON TABLE public.google_oauth_states, public.google_sheets_connections FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOR role_name IN
    SELECT rolname FROM pg_roles
    WHERE rolname = ANY (ARRAY['anon', 'authenticated', 'service_role'])
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.google_oauth_states, public.google_sheets_connections FROM %I', role_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.google_oauth_states, public.google_sheets_connections
  TO energy_monitor_runtime;
