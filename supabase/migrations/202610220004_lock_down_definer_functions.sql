-- Lock down every remaining SECURITY DEFINER function in public.
--
-- Follow-up to 202610220003. A sweep found more definer functions still
-- callable with the anon key, several of which trust a caller-supplied
-- p_user_id (rpc_create_listing, rpc_edit_listing, rpc_pms_apply, ...), so
-- anyone could create or edit listings as any landlord. Every one of them is
-- called only from server code with the service role key.
--
-- On dev the chat RPCs locked by 202610070003 were open again: the prod to dev
-- snapshot recreated functions with default (PUBLIC) grants. The snapshot
-- script now carries function grants over, and this migration is safe to rerun.
--
-- Kept callable, on purpose:
--   fn_current_user_role, fn_is_chat_participant: RLS policies call them, so
--     anon and authenticated must be able to execute them or reads break
--     (including the browser's Realtime chat subscription).
--   Trigger functions: they cannot be called over the API, only fired.
--
-- search_path is not pinned here (unlike 0003): several of these predate the
-- convention and have not been audited for references outside public.
--
-- Idempotent. Apply to BOTH dev and prod.

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype
      AND p.proname NOT IN ('fn_current_user_role', 'fn_is_chat_participant')
  LOOP
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
  END LOOP;
END $$;
