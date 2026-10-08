-- Chat: fixes from the PR #277 release review.
--
-- 1. rpc_mark_thread_read was missed by the 202610070001 lock-down sweep,
--    which matches on '%chat%' and this name has no "chat" in it. It is
--    SECURITY DEFINER and takes the acting user as a parameter, so with anon
--    EXECUTE (the state dev was left in by the 2026-10-04 snapshot) anyone
--    holding the publishable key could set another user's last_read_at,
--    hiding read receipts and suppressing their notification emails.
--    202610070001 now names it explicitly; this revokes it on databases that
--    already ran the old sweep.
--
-- 2. idx_chat_messages_sender_recent was partial on deleted_at IS NULL, but
--    none of the fn_chat_assert_send_rate counts filter on deleted_at (soft
--    deleted messages deliberately still count), so Postgres could never use
--    it. Rebuilt without the predicate.
--
-- 3. Presign rate limit. The presign route called
--    fn_chat_assert_send_rate(.., 'attachment'), which counts SENT attachment
--    messages. A presign that is never followed by a send writes no message
--    row, so presigning was unlimited. Presigns are now recorded and capped by
--    fn_chat_reserve_attachment_uploads.
--
-- 4. Attachments stranded by the 202610030001 thread merge. That merge moved
--    messages to the kept thread but left chat_attachments.thread_id on the
--    soft-deleted sibling, so rpc_get_chat_attachment refused both parties.
--    No such rows exist on dev or prod as of 2026-10-07; this is a repair for
--    any database that ran the old merge with forked attachment threads.
--
-- Idempotent. Apply to BOTH dev and prod.

-- ─── 1. lock down rpc_mark_thread_read ──────────────────────────────────────
REVOKE ALL ON FUNCTION public.rpc_mark_thread_read(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.rpc_mark_thread_read(uuid, uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.rpc_mark_thread_read(uuid, uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.rpc_mark_thread_read(uuid, uuid) TO service_role;
  END IF;
END $$;
ALTER FUNCTION public.rpc_mark_thread_read(uuid, uuid) SET search_path = public, pg_temp;

-- ─── 2. rate limiter index the queries can use ──────────────────────────────
DROP INDEX IF EXISTS public.idx_chat_messages_sender_recent;
CREATE INDEX idx_chat_messages_sender_recent
  ON public.chat_messages (sender_id, created_at DESC);

-- ─── 3. presign reservations ────────────────────────────────────────────────
-- One row per presign request. Only the last hour is ever read, and each
-- reservation prunes the caller's rows older than a day, so this stays tiny
-- without a cron.
CREATE TABLE IF NOT EXISTS public.chat_attachment_presigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  thread_id   uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  file_count  integer NOT NULL CHECK (file_count > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachment_presigns_user_recent
  ON public.chat_attachment_presigns (user_id, created_at DESC);

-- Server-only, like every other chat table: RLS on, no policies.
ALTER TABLE public.chat_attachment_presigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_attachment_presigns FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.chat_attachment_presigns FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.chat_attachment_presigns FROM authenticated;
  END IF;
END $$;

-- Check and record in one transaction, so two concurrent presigns cannot both
-- pass the count. The ceiling is twice the 20 per hour attachment SEND limit,
-- leaving room for retries and abandoned uploads while still bounding what an
-- unsent presign can put in the bucket (40 files x 20MB per user per hour).
CREATE OR REPLACE FUNCTION fn_chat_reserve_attachment_uploads(
  p_user_id    uuid,
  p_thread_id  uuid,
  p_file_count integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_hour integer;
BEGIN
  IF p_user_id IS NULL OR p_thread_id IS NULL THEN
    RAISE EXCEPTION 'user and thread are required';
  END IF;
  IF p_file_count IS NULL OR p_file_count < 1 THEN
    RAISE EXCEPTION 'file count must be positive';
  END IF;

  -- Serialise reservations per user so the count below is exact.
  PERFORM pg_advisory_xact_lock(hashtext('chat_presign:' || p_user_id::text));

  DELETE FROM chat_attachment_presigns
  WHERE user_id = p_user_id
    AND created_at < now() - interval '1 day';

  SELECT COALESCE(SUM(file_count), 0)::int INTO v_hour
  FROM chat_attachment_presigns
  WHERE user_id = p_user_id
    AND created_at > now() - interval '1 hour';

  IF v_hour + p_file_count > 40 THEN
    RAISE EXCEPTION 'chat rate limit: too many attachments';
  END IF;

  INSERT INTO chat_attachment_presigns (user_id, thread_id, file_count)
  VALUES (p_user_id, p_thread_id, p_file_count);
END;
$$;

REVOKE ALL ON FUNCTION fn_chat_reserve_attachment_uploads(uuid, uuid, integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION fn_chat_reserve_attachment_uploads(uuid, uuid, integer) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION fn_chat_reserve_attachment_uploads(uuid, uuid, integer) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION fn_chat_reserve_attachment_uploads(uuid, uuid, integer) TO service_role;
  END IF;
END $$;

-- ─── 4. repair attachments stranded by the thread merge ─────────────────────
UPDATE public.chat_attachments a
SET thread_id = m.thread_id
FROM public.chat_messages m
WHERE a.message_id = m.id
  AND a.thread_id <> m.thread_id;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610070003: rpc_mark_thread_read locked down, rate limit index rebuilt, presign reservations added, merged attachments repaired.';
END $$;
