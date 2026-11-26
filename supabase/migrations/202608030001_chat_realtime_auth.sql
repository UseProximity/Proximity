-- Chat Realtime (1/2): identity helper + publish chat_messages.
--
-- fn_current_user_id() is what the chat RLS policies call. The auth.uid() fallback is what
-- makes Realtime work: the browser subscribes with a short-lived Supabase-shaped JWT minted
-- by /api/chat/realtime-token, so the user id arrives as auth.uid() rather than as the
-- app.current_user_id setting the server-side path uses.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod.

CREATE OR REPLACE FUNCTION public.fn_current_user_id()
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    auth.uid()
  );
$$;

-- Guarded: ALTER PUBLICATION ... ADD TABLE errors if the table is already a member, which
-- it is on any database where this migration (or 202608030002) has run before.
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
