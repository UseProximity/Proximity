-- Chat alert destinations for many threads in one call (PR 447 review).
--
-- The admin direct-threads list called fn_chat_alert_email once per thread
-- (63 round trips today, growing with every thread). This answers a whole
-- list at once by calling the same function for each (thread, user) pair, so
-- the routing rules stay in one place.
--
-- SECURITY INVOKER: it only calls fn_chat_alert_email, which is already
-- locked to the service role. Revoked from everyone else all the same, as it
-- answers email addresses. Idempotent. Apply to BOTH dev and prod.

CREATE OR REPLACE FUNCTION public.fn_chat_alert_emails(p_thread_ids uuid[], p_user_ids uuid[])
RETURNS TABLE (thread_id uuid, email text)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT pair.thread_id, public.fn_chat_alert_email(pair.thread_id, pair.user_id)
  FROM unnest(p_thread_ids, p_user_ids) AS pair(thread_id, user_id)
  WHERE pair.thread_id IS NOT NULL AND pair.user_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.fn_chat_alert_emails(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chat_alert_emails(uuid[], uuid[]) TO service_role;
