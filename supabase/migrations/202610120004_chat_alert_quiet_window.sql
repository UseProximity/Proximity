-- One alert per burst of messages (Wyatt, 2026-10-12).
--
-- The app now waits a quiet window (30 seconds, lib/chat/notifyEmail.js) after
-- each message before asking this function for an alert, and passes the id of
-- the message that started the wait. Three messages in a row start three
-- waits; only the last one should send. So, when p_message_id is given, the
-- function returns NULL (no email) if:
--   1. the sender has posted a newer message in the thread since, because that
--      message's own wait will send an alert covering the whole run; or
--   2. the recipient has read the thread since that message was posted, because
--      they have already seen it.
-- Email replies pass no wait and still pass p_message_id, so rule 2 applies to
-- them too. Callers that pass no id get the previous behaviour.
--
-- The 3-argument signature is dropped: with a default on the new parameter,
-- keeping both would make a named 3-argument call ambiguous.
--
-- Apply to BOTH dev and prod, then re-run 202610070001.

DROP FUNCTION IF EXISTS public.rpc_chat_notification_recipient(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.rpc_chat_notification_recipient(
  p_thread_id  uuid,
  p_sender_id  uuid,
  p_sender_via text DEFAULT 'app',
  p_message_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_max_messages   constant int := 10;
  v_rec            record;
  v_thread         record;
  v_listing        record;
  v_sender         record;
  v_trigger_at     timestamptz;
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

  IF p_message_id IS NOT NULL THEN
    SELECT m.created_at INTO v_trigger_at
    FROM chat_messages m
    WHERE m.id = p_message_id AND m.thread_id = p_thread_id AND m.deleted_at IS NULL;
    IF NOT FOUND THEN RETURN NULL; END IF;

    -- A newer message from the same sender has its own wait running.
    IF EXISTS (
      SELECT 1 FROM chat_messages m
      WHERE m.thread_id = p_thread_id AND m.sender_id = p_sender_id
        AND m.deleted_at IS NULL AND m.created_at > v_trigger_at
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

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

  -- Already read in the app while the wait was running.
  IF v_trigger_at IS NOT NULL AND v_rec.last_read_at IS NOT NULL
     AND v_rec.last_read_at >= v_trigger_at THEN
    RETURN NULL;
  END IF;

  v_to := NULLIF(btrim(fn_chat_alert_email(p_thread_id, v_rec.user_id)), '');
  IF v_to IS NULL OR fn_email_suppressed(v_to) THEN
    v_to := btrim(v_rec.email);
  END IF;
  IF fn_email_suppressed(v_to) THEN RETURN NULL; END IF;

  -- Everything from the other side the recipient has not read yet. Replying
  -- (in the app or by email) counts as reading, so this is the whole run of
  -- messages they have not answered.
  v_since := COALESCE(v_rec.last_read_at, '-infinity'::timestamptz);

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

  -- Only reachable without p_message_id: the trigger message can predate
  -- v_since in a race with a read; send the newest one rather than an empty
  -- email.
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

REVOKE ALL ON FUNCTION public.rpc_chat_notification_recipient(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_chat_notification_recipient(uuid, uuid, text, uuid) TO service_role;
