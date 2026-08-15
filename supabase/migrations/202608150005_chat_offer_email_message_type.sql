-- Include message_type on chat notification payload so offer emails can use
-- a dedicated subject/intro. Based on 202608150001 (unreadCount + renotify).
-- Apply to BOTH dev and prod.

CREATE OR REPLACE FUNCTION public.rpc_chat_notification_recipient(
  p_thread_id uuid,
  p_sender_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_active_window  constant interval := interval '2 minutes';
  v_renotify_after constant interval := interval '30 minutes';
  v_rec            record;
  v_msg            record;
  v_thread         record;
  v_sender_name    text;
  v_unread         int;
BEGIN
  IF p_thread_id IS NULL OR p_sender_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT cp.user_id, cp.last_read_at, cp.last_notified_at,
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

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_rec.email_notifications IS NOT TRUE THEN
    RETURN NULL;
  END IF;

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

  UPDATE chat_participants
  SET last_notified_at = now()
  WHERE thread_id = p_thread_id
    AND user_id   = v_rec.user_id;

  SELECT m.body, m.created_at, m.message_type
  INTO v_msg
  FROM chat_messages m
  WHERE m.thread_id = p_thread_id
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
  LIMIT 1;

  SELECT count(*)::int
  INTO v_unread
  FROM chat_messages m
  WHERE m.thread_id = p_thread_id
    AND m.deleted_at IS NULL
    AND m.sender_id <> v_rec.user_id
    AND (v_rec.last_read_at IS NULL OR m.created_at > v_rec.last_read_at);

  IF v_unread < 1 THEN
    v_unread := 1;
  END IF;

  SELECT t.subject, t.interested_user_id, l.id AS listing_id, l.title, l.address
  INTO v_thread
  FROM chat_threads t
  LEFT JOIN listings l ON l.id = t.listing_id
  WHERE t.id = p_thread_id;

  SELECT u.name INTO v_sender_name FROM users u WHERE u.id = p_sender_id;

  RETURN jsonb_build_object(
    'recipientId',    v_rec.user_id,
    'recipientEmail', v_rec.email,
    'recipientName',  v_rec.name,
    'senderName',     v_sender_name,
    'threadId',       p_thread_id,
    'subject',        v_thread.subject,
    'listingId',      v_thread.listing_id,
    'listingTitle',   v_thread.title,
    'listingAddress', v_thread.address,
    'messageBody',    v_msg.body,
    'messageType',    v_msg.message_type,
    'messageAt',      v_msg.created_at,
    'unreadCount',    v_unread,
    'recipientIsInterestedUser',
      COALESCE(v_thread.interested_user_id = v_rec.user_id, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_chat_notification_recipient(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_chat_notification_recipient(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_chat_notification_recipient(uuid, uuid) TO service_role;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202608150005: notification payload includes messageType.';
END $$;
