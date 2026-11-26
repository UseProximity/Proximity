-- Chat: outbound half of reply-by-email.
--
-- Message alerts now carry a private reply address per (thread, recipient), so
-- replying to the email can land back in the conversation (inbound handling
-- comes later). This migration adds what the sending side needs:
--
--   chat_participants.reply_token_hash  SHA-256 of the token in that person's
--                                       reply address for this thread. The raw
--                                       token is an HMAC the server can always
--                                       recompute, so it is never stored.
--   chat_participants.email_mode        on while this person is answering by
--                                       email. Every message to them is then
--                                       emailed straight away, with no
--                                       actively-reading or 24 hour holds, so an
--                                       email conversation reads like a text
--                                       thread. Sending from the app turns it
--                                       off (Wyatt, 2026-10-09).
--   email_suppressions                  addresses that hard-bounced or marked us
--                                       as spam. Never emailed again, as
--                                       promised to AWS for SES production access.
--   chat_email_log                      one row per alert sent, with the
--                                       provider's message id, for support and
--                                       for matching inbound replies.
--
-- rpc_chat_notification_recipient gains p_sender_via and returns every message
-- the recipient has not been emailed yet, in full, instead of one preview.
--
-- Idempotent. Apply to BOTH dev and prod, then re-run
-- 202610070001_chat_lock_down_function_grants.sql.

-- ─── 1. columns and tables ───────────────────────────────────────────────────
ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS reply_token_hash text,
  ADD COLUMN IF NOT EXISTS email_mode boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_participants_reply_token_hash
  ON public.chat_participants (reply_token_hash)
  WHERE reply_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email      text PRIMARY KEY CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  reason     text NOT NULL CHECK (reason IN ('bounce', 'complaint')),
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_suppressions FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.chat_email_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  recipient_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  to_email            text NOT NULL,
  provider            text NOT NULL CHECK (provider IN ('ses', 'gmail')),
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_email_log_thread ON public.chat_email_log (thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_email_log_provider_message
  ON public.chat_email_log (provider_message_id) WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.chat_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_email_log FROM anon, authenticated;

-- ─── 2. functions ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_email_suppressed(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM email_suppressions WHERE email = lower(btrim(coalesce(p_email, '')))
  );
$function$;

-- The two-argument version is replaced, not overloaded, so a call naming only
-- the first two parameters stays unambiguous.
DROP FUNCTION IF EXISTS public.rpc_chat_notification_recipient(uuid, uuid);

/*
 * Who to email about the newest message in a thread, and what to put in it.
 * NULL means no email, which is the normal case.
 *
 * p_sender_via is how the sender wrote: 'app' turns their own email mode off,
 * 'email' turns it on. The recipient's email mode decides whether the holds
 * apply to them.
 *
 * The address is the routed alert address (lease or listing contact, see
 * fn_chat_alert_email), falling back to the account email when the routed one
 * is suppressed. A suppressed account email means no email at all.
 */
CREATE OR REPLACE FUNCTION public.rpc_chat_notification_recipient(
  p_thread_id  uuid,
  p_sender_id  uuid,
  p_sender_via text DEFAULT 'app'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_active_window  constant interval := interval '2 minutes';
  v_renotify_after constant interval := interval '24 hours';
  v_max_messages   constant int := 10;
  v_rec            record;
  v_thread         record;
  v_listing        record;
  v_sender         record;
  v_since          timestamptz;
  v_messages       jsonb;
  v_pending        int;
  v_to             text;
BEGIN
  IF p_thread_id IS NULL OR p_sender_id IS NULL THEN RETURN NULL; END IF;

  UPDATE chat_participants
  SET email_mode = (p_sender_via = 'email')
  WHERE thread_id = p_thread_id AND user_id = p_sender_id
    AND email_mode IS DISTINCT FROM (p_sender_via = 'email');

  SELECT cp.user_id, cp.last_read_at, cp.last_notified_at, cp.email_mode,
         u.email, u.name, u.email_notifications
  INTO v_rec
  FROM chat_participants cp
  JOIN users u ON u.id = cp.user_id
  WHERE cp.thread_id = p_thread_id
    AND cp.user_id  <> p_sender_id
    AND u.deleted_at IS NULL
    AND u.is_system IS NOT TRUE
    AND NULLIF(btrim(u.email), '') IS NOT NULL
  ORDER BY cp.joined_at
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_rec.email_notifications IS NOT TRUE THEN RETURN NULL; END IF;

  IF NOT v_rec.email_mode THEN
    IF v_rec.last_read_at IS NOT NULL
       AND v_rec.last_read_at > now() - v_active_window THEN
      RETURN NULL;
    END IF;

    IF NOT (
      v_rec.last_notified_at IS NULL
      OR (v_rec.last_read_at IS NOT NULL AND v_rec.last_read_at > v_rec.last_notified_at)
      OR v_rec.last_notified_at < now() - v_renotify_after
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  v_to := NULLIF(btrim(fn_chat_alert_email(p_thread_id, v_rec.user_id)), '');
  IF v_to IS NULL OR fn_email_suppressed(v_to) THEN
    v_to := btrim(v_rec.email);
  END IF;
  IF fn_email_suppressed(v_to) THEN RETURN NULL; END IF;

  -- Everything from the other side since they last read or were last emailed,
  -- whichever is later, so nothing is emailed twice.
  v_since := GREATEST(
    COALESCE(v_rec.last_read_at, '-infinity'::timestamptz),
    COALESCE(v_rec.last_notified_at, '-infinity'::timestamptz)
  );

  UPDATE chat_participants SET last_notified_at = now()
  WHERE thread_id = p_thread_id AND user_id = v_rec.user_id;

  SELECT count(*)::int INTO v_pending FROM chat_messages m
  WHERE m.thread_id = p_thread_id AND m.deleted_at IS NULL
    AND m.sender_id <> v_rec.user_id
    AND m.created_at > v_since;

  SELECT COALESCE(jsonb_agg(x.payload ORDER BY x.created_at), '[]'::jsonb)
  INTO v_messages
  FROM (
    SELECT m.created_at,
           jsonb_build_object(
             'body',        m.body,
             'messageType', m.message_type,
             'createdAt',   m.created_at
           ) AS payload
    FROM chat_messages m
    WHERE m.thread_id = p_thread_id AND m.deleted_at IS NULL
      AND m.sender_id <> v_rec.user_id
      AND m.created_at > v_since
    ORDER BY m.created_at DESC
    LIMIT v_max_messages
  ) x;

  -- The trigger message can predate v_since only in a race with a read; send
  -- the newest one rather than an empty email.
  IF v_pending = 0 THEN
    SELECT jsonb_build_array(jsonb_build_object(
             'body', m.body, 'messageType', m.message_type, 'createdAt', m.created_at))
    INTO v_messages
    FROM chat_messages m
    WHERE m.thread_id = p_thread_id AND m.deleted_at IS NULL AND m.sender_id = p_sender_id
    ORDER BY m.created_at DESC LIMIT 1;
    v_pending := 1;
  END IF;

  SELECT t.subject, t.interested_user_id INTO v_thread
  FROM chat_threads t WHERE t.id = p_thread_id;

  SELECT l.id, l.title, l.address INTO v_listing FROM listings l
  WHERE l.id = fn_chat_current_listing_id(p_thread_id);

  SELECT u.name, NULLIF(btrim(u.company_name), '') AS company
  INTO v_sender FROM users u WHERE u.id = p_sender_id;

  RETURN jsonb_build_object(
    'recipientId', v_rec.user_id, 'recipientEmail', v_to,
    'recipientName', v_rec.name,
    'senderId', p_sender_id, 'senderName', v_sender.name, 'senderCompany', v_sender.company,
    'threadId', p_thread_id, 'subject', v_thread.subject,
    'listingId', v_listing.id, 'listingTitle', v_listing.title,
    'listingAddress', v_listing.address,
    'messages', v_messages,
    'earlierCount', GREATEST(v_pending - jsonb_array_length(v_messages), 0),
    'emailMode', v_rec.email_mode,
    'recipientIsInterestedUser', COALESCE(v_thread.interested_user_id = v_rec.user_id, false)
  );
END;
$function$;

-- ─── 3. grants ───────────────────────────────────────────────────────────────
-- Service role only, same as every chat function. Re-run
-- 202610070001_chat_lock_down_function_grants.sql after this as well.
DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.fn_email_suppressed(text)',
    'public.rpc_chat_notification_recipient(uuid, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;
