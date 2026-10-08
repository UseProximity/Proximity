-- Chat: lock every chat function to service_role, and pin search_path.
--
-- WHY THIS EXISTS AS ITS OWN MIGRATION
--
-- Audit finding, 2026-10-07. After the prod to dev snapshot on 2026-10-04,
-- 19 of 20 chat functions were EXECUTE-able by `anon` and `authenticated`,
-- reachable over PostgREST at /rest/v1/rpc/<name> with nothing but the
-- publishable key that ships in the browser bundle.
--
-- That is a full authentication bypass, because these functions are
-- SECURITY DEFINER and take the acting user as a PARAMETER. They do not verify
-- that the caller is that user; the whole design assumes only the service role
-- can reach them. Verified against dev: calling
-- rpc_list_chat_threads(<landlord uuid>) as `anon` returned that landlord's
-- inbox, and landlord uuids are published in every listing payload as
-- owner._id. From there rpc_get_chat_messages reads the conversation and
-- rpc_send_chat_message posts as either party.
--
-- The individual migrations each revoked these grants when they ran. They were
-- reinstated wholesale by the snapshot, because Supabase re-applies its default
-- grants to anon and authenticated when it recreates objects, and a bare
-- CREATE FUNCTION also defaults to EXECUTE for PUBLIC. Per-migration REVOKEs
-- therefore cannot be relied on: they are correct at the moment they run and
-- silently undone later.
--
-- So this sweeps by NAME PATTERN rather than listing signatures, and is the last
-- chat migration by design. Re-run it after any snapshot, restore or schema
-- reset. It is cheap and idempotent.
--
-- rpc_mark_thread_read is named explicitly because it has no "chat" in its
-- name, so the pattern alone skipped it. Any new chat function whose name
-- lacks "chat" must be added to that list too.
--
-- TWO DELIBERATE EXCEPTIONS
--
-- fn_current_user_id() and fn_is_chat_participant() are called from inside the
-- chat RLS policies. Policy expressions evaluate as the querying role, so
-- `authenticated` must retain EXECUTE on both or every policy errors and
-- Realtime stops delivering. Neither is a meaningful disclosure:
-- fn_current_user_id returns the caller's own id, and fn_is_chat_participant
-- returns a boolean for a (thread, user) pair the caller must already know.
--
-- Apply to BOTH dev and prod. On prod this runs before any chat function is
-- reachable, which is the point.

DO $$
DECLARE
  r record;
  -- Needed by the RLS policies themselves. See above.
  rls_helpers text[] := ARRAY['fn_current_user_id', 'fn_is_chat_participant'];
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           p.oid::regprocedure AS sig,
           p.prosecdef,
           p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE '%chat%'
           OR p.proname IN ('fn_current_user_id', 'rpc_mark_thread_read'))
  LOOP
    -- PUBLIC first: a function created without an explicit grant carries
    -- EXECUTE for PUBLIC, which anon and authenticated inherit.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC;', r.sig);

    IF r.proname = ANY (rls_helpers) THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon;', r.sig);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated;', r.sig);
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon;', r.sig);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated;', r.sig);
      END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', r.sig);
    END IF;

    /*
     * Pin search_path on SECURITY DEFINER functions that lack it. An unqualified
     * name inside a definer function resolves against the CALLER's search_path,
     * so a caller who can create objects in a schema earlier on that path can
     * shadow a table or function and have it run with the definer's privileges.
     * Only applied where missing, so functions that already set it (including
     * ones that set a different path on purpose) are left alone.
     */
    IF r.prosecdef
       AND (r.proconfig IS NULL
            OR NOT EXISTS (SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%'))
    THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp;', r.sig);
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610070001: chat functions locked to service_role (except the two RLS helpers) and search_path pinned.';
END $$;
