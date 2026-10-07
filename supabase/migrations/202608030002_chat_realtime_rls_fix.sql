-- Chat Realtime RLS fix: break infinite recursion in chat_* policies.
--
-- Realtime delivers postgres_changes only for rows the JWT user can SELECT under RLS.
-- chat_messages_select / chat_threads_select subquery chat_participants, and
-- chat_participants_select also subqueries chat_participants — that recurses and
-- suppresses Realtime events (and any direct anon/authenticated SELECT).
--
-- Fix: SECURITY DEFINER helper that checks membership without going through RLS.
-- Also re-asserts fn_current_user_id() auth.uid() fallback + realtime publication
-- (safe after a prod→dev snapshot wipe).

CREATE OR REPLACE FUNCTION public.fn_is_chat_participant(
  p_thread_id uuid,
  p_user_id   uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_participants
    WHERE thread_id = p_thread_id
      AND user_id   = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_chat_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_is_chat_participant(uuid, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_current_user_id()
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    auth.uid()
  );
$$;

DROP POLICY IF EXISTS chat_participants_select ON public.chat_participants;
CREATE POLICY chat_participants_select ON public.chat_participants FOR SELECT
  USING (
    user_id = fn_current_user_id()
    OR fn_is_chat_participant(thread_id, fn_current_user_id())
  );

DROP POLICY IF EXISTS chat_threads_select ON public.chat_threads;
CREATE POLICY chat_threads_select ON public.chat_threads FOR SELECT
  USING (
    deleted_at IS NULL
    AND fn_is_chat_participant(id, fn_current_user_id())
  );

DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT
  USING (
    deleted_at IS NULL
    AND fn_is_chat_participant(thread_id, fn_current_user_id())
  );

DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages FOR INSERT
  WITH CHECK (
    sender_id = fn_current_user_id()
    AND fn_is_chat_participant(thread_id, fn_current_user_id())
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202608030002: chat Realtime RLS helper + policy rewrite + publication assert applied.';
END $$;
