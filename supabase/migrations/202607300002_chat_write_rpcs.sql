-- Chat write RPCs: start/get listing chat, send message, mark read.
-- SECURITY DEFINER so thread + participants + first message happen in one shot.
-- Depends on 202607300001.

-- ============================================================
-- Helpers
-- ============================================================

CREATE OR REPLACE FUNCTION fn_chat_direct_type_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM thread_types WHERE name = 'direct' LIMIT 1;
$$;

-- Primary landlord, else earliest landlord, else listings.primary_landlord_id.
CREATE OR REPLACE FUNCTION fn_chat_primary_landlord_id(p_listing_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT ll.user_id FROM listing_landlords ll
      WHERE ll.listing_id = p_listing_id AND ll.is_primary
      ORDER BY ll.created_at LIMIT 1),
    (SELECT ll.user_id FROM listing_landlords ll
      WHERE ll.listing_id = p_listing_id
      ORDER BY ll.created_at LIMIT 1),
    (SELECT l.primary_landlord_id FROM listings l WHERE l.id = p_listing_id)
  );
$$;

CREATE OR REPLACE FUNCTION fn_chat_assert_participant(
  p_user_id   uuid,
  p_thread_id uuid
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  IF p_user_id IS NULL OR p_thread_id IS NULL THEN
    RAISE EXCEPTION 'user and thread are required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM chat_participants
    WHERE thread_id = p_thread_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'not a participant in this conversation';
  END IF;
END;
$$;

-- ============================================================
-- rpc_start_or_get_listing_chat
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_start_or_get_listing_chat(
  p_user_id    uuid,
  p_listing_id uuid,
  p_body       text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_body           text;
  v_type_id        uuid;
  v_landlord_id    uuid;
  v_thread_id      uuid;
  v_message_id     uuid;
  v_is_new         boolean := false;
  v_subject        text;
  v_contacted_type uuid;
BEGIN
  IF p_user_id IS NULL OR p_listing_id IS NULL THEN
    RAISE EXCEPTION 'user and listing are required';
  END IF;

  v_body := NULLIF(btrim(p_body), '');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'message body is required';
  END IF;
  IF char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'message body exceeds the 5000 character limit';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_user_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'sender not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM listings WHERE id = p_listing_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'listing not found';
  END IF;

  v_type_id := fn_chat_direct_type_id();
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'direct thread type is not configured';
  END IF;

  v_landlord_id := fn_chat_primary_landlord_id(p_listing_id);
  IF v_landlord_id IS NULL THEN
    RAISE EXCEPTION 'listing has no landlord to contact';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = v_landlord_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'listing landlord is no longer an active user';
  END IF;

  IF p_user_id = v_landlord_id OR EXISTS (
    SELECT 1 FROM listing_landlords
    WHERE listing_id = p_listing_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'cannot start a chat about your own listing';
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Avoid duplicate threads on double-click.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_listing_id::text || ':' || p_user_id::text, 0::bigint)
  );

  SELECT id INTO v_thread_id
  FROM chat_threads
  WHERE listing_id = p_listing_id
    AND interested_user_id = p_user_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    v_is_new := true;

    SELECT COALESCE(NULLIF(btrim(l.title), ''), NULLIF(btrim(l.address), ''))
    INTO v_subject
    FROM listings l
    WHERE l.id = p_listing_id;

    INSERT INTO chat_threads (thread_type_id, listing_id, interested_user_id, subject)
    VALUES (v_type_id, p_listing_id, p_user_id, COALESCE(v_subject, 'Listing inquiry'))
    RETURNING id INTO v_thread_id;

    INSERT INTO chat_participants (thread_id, user_id)
    VALUES (v_thread_id, p_user_id), (v_thread_id, v_landlord_id)
    ON CONFLICT (thread_id, user_id) DO NOTHING;

    -- Same contacted tracking as the email contact flow.
    SELECT id INTO v_contacted_type
    FROM interaction_types WHERE name = 'contacted' LIMIT 1;

    IF v_contacted_type IS NOT NULL THEN
      INSERT INTO user_listing_interactions (user_id, listing_id, interaction_type_id)
      VALUES (p_user_id, p_listing_id, v_contacted_type)
      ON CONFLICT (user_id, listing_id, interaction_type_id) DO NOTHING;
    END IF;

    PERFORM increment_listing_metric(p_listing_id, 'contacts');
  END IF;

  INSERT INTO chat_messages (thread_id, sender_id, body, message_type)
  VALUES (v_thread_id, p_user_id, v_body, 'text')
  RETURNING id INTO v_message_id;

  UPDATE chat_participants
  SET last_read_at = now()
  WHERE thread_id = v_thread_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'threadId',   v_thread_id,
    'messageId',  v_message_id,
    'isNew',      v_is_new,
    'listingId',  p_listing_id,
    'landlordId', v_landlord_id
  );
END;
$$;

-- ============================================================
-- rpc_send_chat_message
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_send_chat_message(
  p_user_id   uuid,
  p_thread_id uuid,
  p_body      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_body       text;
  v_message_id uuid;
BEGIN
  v_body := NULLIF(btrim(p_body), '');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'message body is required';
  END IF;
  IF char_length(v_body) > 5000 THEN
    RAISE EXCEPTION 'message body exceeds the 5000 character limit';
  END IF;

  PERFORM fn_chat_assert_participant(p_user_id, p_thread_id);

  IF NOT EXISTS (
    SELECT 1 FROM chat_threads WHERE id = p_thread_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  INSERT INTO chat_messages (thread_id, sender_id, body, message_type)
  VALUES (p_thread_id, p_user_id, v_body, 'text')
  RETURNING id INTO v_message_id;

  UPDATE chat_participants
  SET last_read_at = now()
  WHERE thread_id = p_thread_id AND user_id = p_user_id;

  RETURN jsonb_build_object('threadId', p_thread_id, 'messageId', v_message_id);
END;
$$;

-- ============================================================
-- rpc_mark_thread_read
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_mark_thread_read(
  p_user_id   uuid,
  p_thread_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_read_at timestamptz := now();
BEGIN
  PERFORM fn_chat_assert_participant(p_user_id, p_thread_id);
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  UPDATE chat_participants
  SET last_read_at = v_read_at
  WHERE thread_id = p_thread_id AND user_id = p_user_id;

  RETURN jsonb_build_object('threadId', p_thread_id, 'readAt', v_read_at);
END;
$$;

-- Only the server key may call these (they trust p_user_id).
DO $$
DECLARE
  fn          text;
  rolename    text;
  fns         text[] := ARRAY[
    'fn_chat_direct_type_id()',
    'fn_chat_primary_landlord_id(uuid)',
    'fn_chat_assert_participant(uuid, uuid)',
    'rpc_start_or_get_listing_chat(uuid, uuid, text)',
    'rpc_send_chat_message(uuid, uuid, text)',
    'rpc_mark_thread_read(uuid, uuid)'
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
  RAISE NOTICE 'Migration 202607300002: chat helpers + write RPCs created.';
END $$;