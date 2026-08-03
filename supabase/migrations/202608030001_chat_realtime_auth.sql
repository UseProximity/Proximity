CREATE OR REPLACE FUNCTION public.fn_current_user_id()
RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_user_id', true), '')::uuid,
    auth.uid()
  );
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;