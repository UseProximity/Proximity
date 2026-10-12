-- Chat: rate limits, enforced in the database.
--
-- Why not the in-memory limiters this repo already has (lib/reviews/rateLimit,
-- lib/leaseCheck/rateLimit, ...): those keep counters in a module-level Map, so
-- on Vercel every serverless instance has its own and a cold start wipes it.
-- That is an acceptable soft guard for an anonymous form. It is not acceptable
-- here, because chat reaches a real person's inbox: a loop that gets spread
-- across instances would still land every message, and every email.
--
-- Counting rows inside the sending transaction instead makes the limit exact,
-- costs no new infrastructure (this project has no Redis), and cannot be
-- bypassed by hitting a different instance. The counts read the messages and
-- threads already being written, so there is no counter table to drift.
--
-- Limits are deliberately far above any real conversation and are an abuse
-- ceiling, not a usage budget. A student comparing ten places and a landlord
-- working through a morning's inbox both stay well clear.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod.

CREATE OR REPLACE FUNCTION fn_chat_assert_send_rate(
  p_user_id uuid,
  p_kind    text
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_hour  integer;
  v_short integer;
  v_day   integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;

  IF p_kind = 'start' THEN
    -- New conversations. Soft-deleted threads still count, so clearing an
    -- inbox cannot be used to reset the ceiling.
    SELECT COUNT(*)::int INTO v_hour
    FROM chat_threads
    WHERE interested_user_id = p_user_id
      AND created_at > now() - interval '1 hour';

    SELECT COUNT(*)::int INTO v_day
    FROM chat_threads
    WHERE interested_user_id = p_user_id
      AND created_at > now() - interval '24 hours';

    IF v_hour >= 10 OR v_day >= 25 THEN
      RAISE EXCEPTION 'chat rate limit: too many new conversations';
    END IF;

  ELSIF p_kind = 'message' THEN
    SELECT COUNT(*)::int INTO v_short
    FROM chat_messages
    WHERE sender_id = p_user_id
      AND created_at > now() - interval '10 minutes';

    SELECT COUNT(*)::int INTO v_hour
    FROM chat_messages
    WHERE sender_id = p_user_id
      AND created_at > now() - interval '1 hour';

    IF v_short >= 30 OR v_hour >= 100 THEN
      RAISE EXCEPTION 'chat rate limit: too many messages';
    END IF;

  ELSIF p_kind = 'attachment' THEN
    SELECT COUNT(*)::int INTO v_hour
    FROM chat_messages
    WHERE sender_id = p_user_id
      AND message_type = 'attachment'
      AND created_at > now() - interval '1 hour';

    IF v_hour >= 20 THEN
      RAISE EXCEPTION 'chat rate limit: too many attachments';
    END IF;

  ELSE
    RAISE EXCEPTION 'unknown chat rate limit kind: %', p_kind;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_chat_assert_send_rate(uuid, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION fn_chat_assert_send_rate(uuid, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION fn_chat_assert_send_rate(uuid, text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION fn_chat_assert_send_rate(uuid, text) TO service_role;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610030002: fn_chat_assert_send_rate created.';
END $$;
