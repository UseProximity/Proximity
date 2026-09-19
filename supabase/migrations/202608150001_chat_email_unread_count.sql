-- Chat email notifications: include unreadCount in the notification payload so the
-- email can say "3 messages from Maya about …" when the recipient has more than one
-- unread message in the thread. Count = messages from the other participant after the
-- recipient's last_read_at (true unread, not "since we last emailed").
--
-- CREATE OR REPLACE only — no schema change. Apply to BOTH dev and prod.

CREATE OR REPLACE FUNCTION public.rpc_chat_notification_recipient(
  p_thread_id uuid,
  p_sender_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Read this recently means they have the thread open; Realtime already delivered it.
  v_active_window  constant interval := interval '2 minutes';
  -- Backstop nudge for a thread left unread this long.
  v_renotify_after constant interval := interval '24 hours';
  v_rec            record;
  v_msg            record;
  v_thread         record;
  v_sender_name    text;
  v_unread         int;
BEGIN
  IF p_thread_id IS NULL OR p_sender_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- The other participant. Direct threads have exactly one; ORDER BY + LIMIT keeps this
  -- well-defined if a group thread type is ever introduced.
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

  -- Email on a first unread, again once they've engaged since our last email, and once
  -- more if the thread has sat unread past the backstop.
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

  SELECT m.body, m.created_at
  INTO v_msg
  FROM chat_messages m
  WHERE m.thread_id = p_thread_id
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
  LIMIT 1;

  -- True unread for the recipient: messages from anyone else after their last read
  -- (or all of them if they've never opened the thread).
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
    'messageAt',      v_msg.created_at,
    'unreadCount',    v_unread,
    -- Picks the email wording: true = the prospective renter got a reply, false = the
    -- listing owner got an inquiry. COALESCE keeps this a real boolean for the JS side
    -- if a thread predates interested_user_id.
    'recipientIsInterestedUser',
      COALESCE(v_thread.interested_user_id = v_rec.user_id, false)
  );
END;
$$;

-- Keep execute locked to service_role (same grants as 202608130001).
DO $$
DECLARE
  fn          text := 'rpc_chat_notification_recipient(uuid, uuid)';
  rolename    text;
  revoke_from text[] := ARRAY['anon', 'authenticated'];
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC;', fn);
  FOREACH rolename IN ARRAY revoke_from LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rolename) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I;', fn, rolename);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn);
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202608150001: chat email unreadCount on rpc_chat_notification_recipient applied.';
END $$;
