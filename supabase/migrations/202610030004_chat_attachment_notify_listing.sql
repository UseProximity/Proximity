-- Chat: carry per-message listing context through the attachment and
-- notification paths, and put attachments under the rate limit.
--
-- Completes 202610030003. Those two functions also assumed the thread's
-- listing was the only listing, which is no longer true now that one
-- conversation can cover several properties: an email saying "new message
-- about 412 Delmar" when the student just asked about a different unit is
-- worse than no label at all.
--
-- Apply to BOTH dev and prod. CREATE OR REPLACE only.

-- ─── rpc_send_chat_attachment_message ────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_send_chat_attachment_message(
  p_user_id     uuid,
  p_thread_id   uuid,
  p_body        text,
  p_attachments jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caption       text;
  v_message_id    uuid;
  v_count         integer;
  v_item          jsonb;
  v_key           text;
  v_file_name     text;
  v_content_type  text;
  v_size_bytes    bigint;
  v_prefix        text;
  v_listing_id    uuid;
  v_meta_atts     jsonb := '[]'::jsonb;
  v_allowed       text[] := ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ];
  v_max_files     integer := 5;
  v_max_bytes     bigint := 20 * 1024 * 1024;
BEGIN
  IF p_user_id IS NULL OR p_thread_id IS NULL THEN
    RAISE EXCEPTION 'user and thread are required';
  END IF;

  PERFORM fn_chat_assert_participant(p_user_id, p_thread_id);

  IF NOT EXISTS (
    SELECT 1 FROM chat_threads WHERE id = p_thread_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'attachments are required';
  END IF;

  v_count := jsonb_array_length(p_attachments);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'attachments are required';
  END IF;
  IF v_count > v_max_files THEN
    RAISE EXCEPTION 'too many attachments (max 5)';
  END IF;

  v_caption := NULLIF(btrim(COALESCE(p_body, '')), '');
  IF v_caption IS NOT NULL AND char_length(v_caption) > 5000 THEN
    RAISE EXCEPTION 'message body exceeds the 5000 character limit';
  END IF;

  -- Both ceilings apply: an upload is a message as well as an attachment.
  PERFORM fn_chat_assert_send_rate(p_user_id, 'message');
  PERFORM fn_chat_assert_send_rate(p_user_id, 'attachment');

  v_prefix := 'chat-attachments/' || p_thread_id::text || '/';

  -- Validate every item before inserting anything.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments)
  LOOP
    v_key := NULLIF(btrim(COALESCE(v_item->>'key', '')), '');
    v_file_name := NULLIF(btrim(COALESCE(v_item->>'fileName', '')), '');
    v_content_type := lower(NULLIF(btrim(COALESCE(v_item->>'contentType', '')), ''));
    BEGIN
      v_size_bytes := (v_item->>'sizeBytes')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid attachment size';
    END;

    IF v_key IS NULL OR v_file_name IS NULL OR v_content_type IS NULL THEN
      RAISE EXCEPTION 'invalid attachment metadata';
    END IF;
    IF NOT (v_key LIKE v_prefix || '%') THEN
      RAISE EXCEPTION 'invalid attachment key';
    END IF;
    IF NOT (v_content_type = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'unsupported attachment type';
    END IF;
    IF v_size_bytes IS NULL OR v_size_bytes <= 0 OR v_size_bytes > v_max_bytes THEN
      RAISE EXCEPTION 'attachment exceeds size limit';
    END IF;
    IF char_length(v_file_name) > 200 THEN
      RAISE EXCEPTION 'file name too long';
    END IF;
  END LOOP;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  v_listing_id := fn_chat_current_listing_id(p_thread_id);

  -- Pre-assign attachment ids so message metadata is complete on INSERT
  -- (Realtime subscribers see full payload without a follow-up UPDATE).
  CREATE TEMP TABLE _chat_att_draft (
    id uuid PRIMARY KEY,
    r2_key text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sort_ord integer NOT NULL
  ) ON COMMIT DROP;

  v_count := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments)
  LOOP
    v_count := v_count + 1;
    INSERT INTO _chat_att_draft (id, r2_key, file_name, content_type, size_bytes, sort_ord)
    VALUES (
      gen_random_uuid(),
      btrim(v_item->>'key'),
      btrim(v_item->>'fileName'),
      lower(btrim(v_item->>'contentType')),
      (v_item->>'sizeBytes')::bigint,
      v_count
    );
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'fileName', d.file_name,
        'contentType', d.content_type,
        'sizeBytes', d.size_bytes
      )
      ORDER BY d.sort_ord
    ),
    '[]'::jsonb
  )
  INTO v_meta_atts
  FROM _chat_att_draft d;

  INSERT INTO chat_messages (
    thread_id, sender_id, body, message_type, metadata, listing_id
  )
  VALUES (
    p_thread_id,
    p_user_id,
    fn_chat_attachment_preview_body(v_caption, p_attachments),
    'attachment',
    jsonb_build_object(
      'caption', v_caption,
      'attachments', v_meta_atts
    ),
    v_listing_id
  )
  RETURNING id INTO v_message_id;

  INSERT INTO chat_attachments (
    id, message_id, thread_id, uploader_id, r2_key, file_name, content_type, size_bytes
  )
  SELECT
    d.id,
    v_message_id,
    p_thread_id,
    p_user_id,
    d.r2_key,
    d.file_name,
    d.content_type,
    d.size_bytes
  FROM _chat_att_draft d
  ORDER BY d.sort_ord;

  UPDATE chat_participants
  SET last_read_at = now()
  WHERE thread_id = p_thread_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'threadId',  p_thread_id,
    'messageId', v_message_id,
    'listingId', v_listing_id
  );
END;
$$;

-- ─── rpc_chat_notification_recipient ─────────────────────────────────────────
-- Same suppression rules as 202608150007 (2 minute active-reading window,
-- 24 hour per-participant cooldown, per-user opt-out). The only change is
-- that the listing label now comes from the message that triggered the email
-- rather than from the thread.
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
  v_renotify_after constant interval := interval '24 hours';
  v_rec            record;
  v_msg            record;
  v_thread         record;
  v_listing        record;
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

  SELECT m.body, m.created_at, m.message_type, m.listing_id
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

  SELECT t.subject, t.interested_user_id
  INTO v_thread
  FROM chat_threads t
  WHERE t.id = p_thread_id;

  -- The message's own listing, falling back to the thread's opening listing
  -- for a reply that predates per-message context.
  SELECT l.id, l.title, l.address
  INTO v_listing
  FROM listings l
  WHERE l.id = COALESCE(v_msg.listing_id, fn_chat_current_listing_id(p_thread_id));

  SELECT u.name INTO v_sender_name FROM users u WHERE u.id = p_sender_id;

  RETURN jsonb_build_object(
    'recipientId',    v_rec.user_id,
    'recipientEmail', v_rec.email,
    'recipientName',  v_rec.name,
    'senderName',     v_sender_name,
    'threadId',       p_thread_id,
    'subject',        v_thread.subject,
    'listingId',      v_listing.id,
    'listingTitle',   v_listing.title,
    'listingAddress', v_listing.address,
    'messageBody',    v_msg.body,
    'messageType',    v_msg.message_type,
    'messageAt',      v_msg.created_at,
    'unreadCount',    v_unread,
    'recipientIsInterestedUser',
      COALESCE(v_thread.interested_user_id = v_rec.user_id, false)
  );
END;
$$;

-- ─── grants ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn       text;
  rolename text;
  fns text[] := ARRAY[
    'rpc_send_chat_attachment_message(uuid, uuid, text, jsonb)',
    'rpc_chat_notification_recipient(uuid, uuid)'
  ];
  revoke_from text[] := ARRAY['anon', 'authenticated'];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC;', fn);
    FOREACH rolename IN ARRAY revoke_from LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rolename) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I;', fn, rolename);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn);
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202610030004: attachment + notification paths carry per-message listing; attachments rate limited.';
END $$;
