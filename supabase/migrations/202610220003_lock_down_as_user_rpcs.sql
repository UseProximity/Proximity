-- Lock down the write-as-user RPCs (202604240001_write_as_user_rpcs.sql).
--
-- They are SECURITY DEFINER and trust whatever p_user_id the caller passes, so
-- RLS never applies to them. Only the server (service role key, via
-- lib/supabaseWithUser.js) is meant to call them, but they were never revoked
-- from PUBLIC, so anyone holding the public anon key could call
-- /rest/v1/rpc/rpc_delete_as_user and write or delete allowlisted rows as any
-- user. Same lockdown as the chat RPCs in 202610070003.
--
-- Note: a later CREATE OR REPLACE of one of these keeps the grants below but
-- drops the search_path setting, so repeat the ALTER FUNCTION when you do.
--
-- Idempotent. Apply to BOTH dev and prod.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.rpc_insert_as_user(uuid, text, jsonb)',
    'public.rpc_insert_batch_as_user(uuid, text, jsonb)',
    'public.rpc_update_as_user(uuid, text, jsonb, uuid, jsonb)',
    'public.rpc_delete_as_user(uuid, text, uuid, jsonb)',
    'public.rpc_upsert_as_user(uuid, text, jsonb, text[], boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
  END LOOP;
END $$;
