-- Links the Admin-configurable backup destination (backup_config) to the
-- Admin's connected Google account (public.google_sheets_connections,
-- created by migration 004 but never previously used by any server code -
-- Desktop's own Google Sheets sync feature stores its tokens locally on
-- the Desktop machine, not in this table). Exactly one connected admin
-- account is "the" backup identity at a time; NULL means no admin has
-- connected an account yet, matching backup_config's existing "not yet
-- configured" semantics for spreadsheet_id.
--
-- Never stores a credential itself - this is a pointer to a row in the
-- already-encrypted-at-rest google_sheets_connections table, exactly the
-- same non-secret-config-only posture backup_config already has for
-- spreadsheet_id/sheet_url.

ALTER TABLE public.backup_config
  ADD COLUMN IF NOT EXISTS connected_google_user_id bigint REFERENCES public.users(id) ON DELETE SET NULL;
