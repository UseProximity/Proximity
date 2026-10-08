-- Chat: RPCs for the (landlord, student) pair thread model.
--
-- Rewrites the four functions that assumed the listing was the thread key:
--   rpc_start_or_get_listing_chat  routes an inquiry to the pair's thread
--   rpc_send_chat_message          inherits the thread's current listing
--   rpc_list_chat_threads          labels the inbox by the LATEST inquiry
--   rpc_get_chat_messages          returns per-message listing context
--
-- Apply to BOTH dev and prod. CREATE OR REPLACE only, no schema changes.

-- ─── helper: the listing a thread is currently about ─────────────────────────
-- The most recent message that carried a listing, falling back to the listing
-- that opened the thread. A reply with no listing of its own belongs to
-- whatever the conversation last discussed.
CREATE OR REPLACE FUNCTION fn_chat_current_listing_id(p_thread_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT m.listing_id
       FROM chat_messages m
      WHERE m.thread_id = p_thread_id
        AND m.deleted_at IS NULL
        AND m.listing_id IS NOT NULL
      ORDER BY m.created_at DESC
      LIMIT 1),
    (SELECT t.listing_id FROM chat_threads t WHERE t.id = p_thread_id)
  );
$$;

-- ─── rpc_start_or_get_listing_chat ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_start_or_get_listing_chat(
  p_user_id    uuid,
  p_listing_id uuid,
  p_body       text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_body            text;
  v_type_id         uuid;
  v_landlord_id     uuid;
  v_thread_id       uuid;
  v_message_id      uuid;
  v_is_new          boolean := false;
  v_is_new_listing  boolean := false;
  v_subject         text;
  v_contacted_type  uuid;
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

  -- Derived, not stored, for a NEW inquiry: whoever holds the listing today is
  -- who this message should reach. Once the thread exists its landlord_id is
  -- authoritative and this is not consulted again.
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

  PERFORM fn_chat_assert_send_rate(p_user_id, 'start');

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Keyed on the PAIR now, not the listing: two fast clicks on two different
  -- properties of the same landlord race for the same thread row, and the old
  -- listing-scoped lock would have let both through to create one each.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_landlord_id::text || ':' || p_user_id::text, 0::bigint)
  );

  SELECT id INTO v_thread_id
  FROM chat_threads
  WHERE landlord_id = v_landlord_id
    AND interested_user_id = p_user_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_thread_id IS NULL THEN
    v_is_new := true;

    SELECT COALESCE(NULLIF(btrim(l.title), ''), NULLIF(btrim(l.address), ''))
    INTO v_subject
    FROM listings l
    WHERE l.id = p_listing_id;

    INSERT INTO chat_threads (
      thread_type_id, listing_id, landlord_id, interested_user_id, subject
    )
    VALUES (
      v_type_id, p_listing_id, v_landlord_id, p_user_id,
      COALESCE(v_subject, 'Listing inquiry')
    )
    RETURNING id INTO v_thread_id;

    INSERT INTO chat_participants (thread_id, user_id)
    VALUES (v_thread_id, p_user_id), (v_thread_id, v_landlord_id)
    ON CONFLICT (thread_id, user_id) DO NOTHING;
  END IF;

  -- Is this the first time this conversation has been about this listing?
  -- Drives both the transcript's context divider and the contact tracking
  -- below, so an inquiry about a second property still registers as a contact
  -- on that property even though it reuses an existing thread.
  v_is_new_listing := NOT EXISTS (
    SELECT 1 FROM chat_messages
    WHERE thread_id = v_thread_id
      AND listing_id = p_listing_id
      AND deleted_at IS NULL
  );

  INSERT INTO chat_messages (thread_id, sender_id, body, message_type, listing_id)
  VALUES (v_thread_id, p_user_id, v_body, 'text', p_listing_id)
  RETURNING id INTO v_message_id;

  IF v_is_new_listing THEN
    -- Same contacted tracking as the email contact flow, per listing rather
    -- than per thread: the landlord's analytics for property B should count
    -- this even though the student already had a thread open about property A.
    SELECT id INTO v_contacted_type
    FROM interaction_types WHERE name = 'contacted' LIMIT 1;

    IF v_contacted_type IS NOT NULL THEN
      INSERT INTO user_listing_interactions (user_id, listing_id, interaction_type_id)
      VALUES (p_user_id, p_listing_id, v_contacted_type)
      ON CONFLICT (user_id, listing_id, interaction_type_id) DO NOTHING;
    END IF;

    PERFORM increment_listing_metric(p_listing_id, 'contacts');
  END IF;

  UPDATE chat_participants
  SET last_read_at = now()
  WHERE thread_id = v_thread_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'threadId',        v_thread_id,
    'messageId',       v_message_id,
    'isNew',           v_is_new,
    'isNewListing',    v_is_new_listing,
    'listingId',       p_listing_id,
    'landlordId',      v_landlord_id
  );
END;
$$;

-- ─── rpc_send_chat_message ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rpc_send_chat_message(
  p_user_id   uuid,
  p_thread_id uuid,
  p_body      text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_body       text;
  v_message_id uuid;
  v_listing_id uuid;
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

  PERFORM fn_chat_assert_send_rate(p_user_id, 'message');

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- A reply carries the conversation's current listing, so every message has
  -- context and the transcript only draws a divider where it actually changed.
  v_listing_id := fn_chat_current_listing_id(p_thread_id);

  INSERT INTO chat_messages (thread_id, sender_id, body, message_type, listing_id)
  VALUES (p_thread_id, p_user_id, v_body, 'text', v_listing_id)
  RETURNING id INTO v_message_id;

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

-- ─── rpc_list_chat_threads ───────────────────────────────────────────────────
-- Inbox rows are now PEOPLE. The listing shown is the one the conversation is
-- currently about (its latest inquiry), not the one that opened it.
CREATE OR REPLACE FUNCTION rpc_list_chat_threads(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user is required';
  END IF;

  SELECT COALESCE(jsonb_agg(payload ORDER BY sort_at DESC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      t.updated_at AS sort_at,
      jsonb_build_object(
        'threadId',            t.id,
        'subject',             t.subject,
        'updatedAt',           t.updated_at,
        'listingId',           l.id,
        'listingTitle',        l.title,
        'listingAddress',      l.address,
        'listingImage',        li.url,
        'listingMinRent',      l.min_rent,
        'listingMaxRent',      l.max_rent,
        'listingCount', (
          SELECT COUNT(DISTINCT m.listing_id)::int
          FROM chat_messages m
          WHERE m.thread_id = t.id
            AND m.deleted_at IS NULL
            AND m.listing_id IS NOT NULL
        ),
        'isInterestedUser',    (t.interested_user_id = p_user_id),
        'otherUserId',         ou.id,
        'otherUserName',       ou.name,
        'otherUserImage',      ou.image,
        'otherUserLastReadAt', ou.last_read_at,
        'lastMessageBody',     lm.body,
        'lastMessageType',     lm.message_type,
        'lastMessageAt',       lm.created_at,
        'lastMessageMine',     (lm.sender_id = p_user_id),
        'unreadCount', (
          SELECT COUNT(*)::int
          FROM chat_messages m
          WHERE m.thread_id = t.id
            AND m.deleted_at IS NULL
            AND m.sender_id IS DISTINCT FROM p_user_id
            AND m.created_at > COALESCE(cp.last_read_at, '-infinity'::timestamptz)
        ),
        'hasUnread', EXISTS (
          SELECT 1
          FROM chat_messages m
          WHERE m.thread_id = t.id
            AND m.deleted_at IS NULL
            AND m.sender_id IS DISTINCT FROM p_user_id
            AND m.created_at > COALESCE(cp.last_read_at, '-infinity'::timestamptz)
        )
      ) AS payload
    FROM chat_threads t
    JOIN chat_participants cp
      ON cp.thread_id = t.id
     AND cp.user_id   = p_user_id
    LEFT JOIN listings l ON l.id = fn_chat_current_listing_id(t.id)
    LEFT JOIN LATERAL (
      SELECT img.url
      FROM listing_images img
      WHERE img.listing_id = l.id
      ORDER BY img.sort_order NULLS LAST, img.created_at
      LIMIT 1
    ) li ON true
    LEFT JOIN LATERAL (
      SELECT u.id, u.name, u.image, cp2.last_read_at
      FROM chat_participants cp2
      JOIN users u ON u.id = cp2.user_id
      WHERE cp2.thread_id = t.id
        AND cp2.user_id <> p_user_id
      ORDER BY cp2.joined_at
      LIMIT 1
    ) ou ON true
    LEFT JOIN LATERAL (
      SELECT m.body, m.message_type, m.created_at, m.sender_id
      FROM chat_messages m
      WHERE m.thread_id = t.id
        AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC
      LIMIT 1
    ) lm ON true
    WHERE t.deleted_at IS NULL
      AND t.thread_type_id = fn_chat_direct_type_id()
  ) s;

  RETURN v_result;
END;
$$;

-- ─── rpc_get_chat_messages ───────────────────────────────────────────────────
-- Carries each message's listing so the transcript can draw a context divider
-- where the conversation moved to a different property.
CREATE OR REPLACE FUNCTION rpc_get_chat_messages(
  p_user_id   uuid,
  p_thread_id uuid,
  p_limit     integer     DEFAULT 50,
  p_before    timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_limit  integer;
  v_result jsonb;
BEGIN
  PERFORM fn_chat_assert_participant(p_user_id, p_thread_id);

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);

  SELECT COALESCE(jsonb_agg(payload ORDER BY created_at ASC), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      m.created_at,
      jsonb_build_object(
        'id',             m.id,
        'threadId',       m.thread_id,
        'senderId',       m.sender_id,
        'isMine',         (m.sender_id = p_user_id),
        'body',           m.body,
        'messageType',    m.message_type,
        'metadata',       m.metadata,
        'createdAt',      m.created_at,
        'listingId',      m.listing_id,
        'listingTitle',   l.title,
        'listingAddress', l.address
      ) AS payload
    FROM chat_messages m
    LEFT JOIN listings l ON l.id = m.listing_id
    WHERE m.thread_id = p_thread_id
      AND m.deleted_at IS NULL
      AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC
    LIMIT v_limit
  ) s;

  RETURN v_result;
END;
$$;

-- ─── grants ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn       text;
  rolename text;
  fns text[] := ARRAY[
    'fn_chat_current_listing_id(uuid)',
    'rpc_start_or_get_listing_chat(uuid, uuid, text)',
    'rpc_send_chat_message(uuid, uuid, text)',
    'rpc_list_chat_threads(uuid)',
    'rpc_get_chat_messages(uuid, uuid, integer, timestamptz)'
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
  RAISE NOTICE 'Migration 202610030003: chat RPCs rewritten for pair threads.';
END $$;
