-- Chat: record what the content screen blocked or flagged.
--
-- lib/chat/moderation.js decides block / flag / allow, but a decision nobody
-- can review is not moderation. A block in particular leaves no message row
-- behind, so without this table an attempted deposit scam leaves no trace at
-- all and the same account can keep trying against different students.
--
-- Holds a truncated excerpt of the body on purpose: a reviewer cannot judge
-- "payment_rail_mentioned" from the label alone. Excerpt only, capped at 500
-- characters, and nothing is written for a message that screened clean.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod.

CREATE TABLE IF NOT EXISTS public.chat_moderation_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  thread_id    uuid REFERENCES public.chat_threads(id) ON DELETE SET NULL,
  message_id   uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  listing_id   uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  action       text NOT NULL,
  reasons      text[] NOT NULL DEFAULT '{}',
  body_excerpt text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  CONSTRAINT chat_moderation_events_action_check
    CHECK (action IN ('block', 'flag')),
  CONSTRAINT chat_moderation_events_excerpt_length_check
    CHECK (body_excerpt IS NULL OR char_length(body_excerpt) <= 500)
);

-- Review queue reads newest-unreviewed first; abuse triage reads by account.
CREATE INDEX IF NOT EXISTS idx_chat_moderation_events_pending
  ON public.chat_moderation_events (created_at DESC)
  WHERE reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_moderation_events_user
  ON public.chat_moderation_events (user_id, created_at DESC);

ALTER TABLE public.chat_moderation_events ENABLE ROW LEVEL SECURITY;

-- No policies: the table is reachable only through the service role, same as
-- the rest of the chat surface. Neither participant can read what was flagged
-- about them, and a flagged sender is never told.

CREATE OR REPLACE FUNCTION public.rpc_log_chat_moderation_event(
  p_user_id    uuid,
  p_action     text,
  p_reasons    text[],
  p_body       text,
  p_thread_id  uuid DEFAULT NULL,
  p_message_id uuid DEFAULT NULL,
  p_listing_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_action NOT IN ('block', 'flag') THEN
    RAISE EXCEPTION 'invalid moderation action: %', p_action;
  END IF;

  INSERT INTO chat_moderation_events (
    user_id, thread_id, message_id, listing_id, action, reasons, body_excerpt
  )
  VALUES (
    p_user_id,
    p_thread_id,
    p_message_id,
    p_listing_id,
    p_action,
    COALESCE(p_reasons, '{}'),
    left(COALESCE(p_body, ''), 500)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_log_chat_moderation_event(uuid, text, text[], text, uuid, uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.rpc_log_chat_moderation_event(uuid, text, text[], text, uuid, uuid, uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.rpc_log_chat_moderation_event(uuid, text, text[], text, uuid, uuid, uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.rpc_log_chat_moderation_event(uuid, text, text[], text, uuid, uuid, uuid) TO service_role;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610030005: chat_moderation_events + rpc_log_chat_moderation_event.';
END $$;
