-- Discount offers in listing chat: send (in a thread, or as first contact from the
-- listing modal), respond (accept/deny/counter), list savers, and broadcast to
-- everyone who saved a listing.
-- Uses chat_messages.message_type = 'discount_offer' + metadata jsonb.
-- Apply to BOTH dev and prod.

-- ============================================================
-- Helpers
-- ============================================================

CREATE OR REPLACE FUNCTION fn_chat_user_is_listing_landlord(
  p_user_id    uuid,
  p_listing_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT p_user_id IS NOT NULL
    AND p_listing_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM listing_landlords ll
        WHERE ll.listing_id = p_listing_id AND ll.user_id = p_user_id
      )
      OR EXISTS (
        SELECT 1 FROM listings l
        WHERE l.id = p_listing_id AND l.primary_landlord_id = p_user_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION fn_chat_format_offer_body(p_proposed_rent numeric)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Offer: $' || trim(to_char(round(p_proposed_rent, 0), 'FM999,999,999')) || '/mo';
$$;

-- Supersede every pending discount_offer in a thread (optionally except one id).
CREATE OR REPLACE FUNCTION fn_chat_supersede_pending_offers(
  p_thread_id uuid,
  p_except_message_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE chat_messages m
  SET metadata = m.metadata
    || jsonb_build_object(
         'status', 'superseded',
         'respondedAt', to_jsonb(now())
       )
  WHERE m.thread_id = p_thread_id
    AND m.deleted_at IS NULL
    AND m.message_type = 'discount_offer'
    AND COALESCE(m.metadata->>'status', 'pending') = 'pending'
    AND (p_except_message_id IS NULL OR m.id <> p_except_message_id);
END;
$$;

-- ============================================================
-- rpc_send_discount_offer
-- ============================================================
-- Initial offer (p_parent_offer_id IS NULL): either side of a listing thread may open
-- one — the listing owner (any user linked on listing_landlords or primary_landlord_id,
-- role does not matter) offering a discount, or the interested user proposing a rent.
-- Counter: caller must be a participant and not the parent offer's sender;
-- parent must be pending in this thread. Any other pending offers are
-- superseded (dedupe).

CREATE OR REPLACE FUNCTION rpc_send_discount_offer(
  p_user_id         uuid,
  p_thread_id       uuid,
  p_proposed_rent   numeric,
  p_note            text DEFAULT NULL,
  p_parent_offer_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_thread          chat_threads%ROWTYPE;
  v_parent          chat_messages%ROWTYPE;
  v_is_landlord     boolean;
  v_is_interested   boolean;
  v_note            text;
  v_original_rent   numeric;
  v_body            text;
  v_metadata        jsonb;
  v_message_id      uuid;
BEGIN
  IF p_user_id IS NULL OR p_thread_id IS NULL THEN
    RAISE EXCEPTION 'user and thread are required';
  END IF;

  IF p_proposed_rent IS NULL OR p_proposed_rent <= 0 OR p_proposed_rent > 1000000 THEN
    RAISE EXCEPTION 'proposed rent must be a positive number';
  END IF;

  PERFORM fn_chat_assert_participant(p_user_id, p_thread_id);

  SELECT * INTO v_thread
  FROM chat_threads
  WHERE id = p_thread_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF v_thread.listing_id IS NULL THEN
    RAISE EXCEPTION 'offers require a listing conversation';
  END IF;

  v_is_landlord := fn_chat_user_is_listing_landlord(p_user_id, v_thread.listing_id);
  v_is_interested := (v_thread.interested_user_id = p_user_id);

  IF p_parent_offer_id IS NULL THEN
    IF NOT (v_is_landlord OR v_is_interested) THEN
      RAISE EXCEPTION 'not allowed to send an offer in this conversation';
    END IF;
  ELSE
    SELECT * INTO v_parent
    FROM chat_messages
    WHERE id = p_parent_offer_id
      AND thread_id = p_thread_id
      AND deleted_at IS NULL
      AND message_type = 'discount_offer';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'parent offer not found';
    END IF;

    IF COALESCE(v_parent.metadata->>'status', 'pending') <> 'pending' THEN
      RAISE EXCEPTION 'parent offer is no longer pending';
    END IF;

    IF v_parent.sender_id = p_user_id THEN
      RAISE EXCEPTION 'cannot counter your own offer';
    END IF;

    IF NOT (v_is_landlord OR v_is_interested) THEN
      RAISE EXCEPTION 'not allowed to counter this offer';
    END IF;
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'offer note exceeds the 1000 character limit';
  END IF;

  SELECT l.min_rent INTO v_original_rent
  FROM listings l
  WHERE l.id = v_thread.listing_id;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Dedupe: only one actionable pending offer per thread.
  PERFORM fn_chat_supersede_pending_offers(p_thread_id, NULL);

  v_body := fn_chat_format_offer_body(p_proposed_rent);
  v_metadata := jsonb_build_object(
    'status', 'pending',
    'proposedRent', round(p_proposed_rent, 2),
    'originalRent', CASE WHEN v_original_rent IS NULL THEN NULL ELSE to_jsonb(round(v_original_rent, 2)) END,
    'note', to_jsonb(v_note),
    'parentOfferId', to_jsonb(p_parent_offer_id),
    'respondedAt', NULL,
    'respondedBy', NULL
  );

  INSERT INTO chat_messages (thread_id, sender_id, body, message_type, metadata)
  VALUES (p_thread_id, p_user_id, v_body, 'discount_offer', v_metadata)
  RETURNING id INTO v_message_id;

  UPDATE chat_participants
  SET last_read_at = now()
  WHERE thread_id = p_thread_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'threadId',   p_thread_id,
    'messageId',  v_message_id,
    'body',       v_body,
    'messageType','discount_offer',
    'metadata',   v_metadata,
    'listingId',  v_thread.listing_id
  );
END;
$$;

-- ============================================================
-- rpc_start_listing_offer
-- ============================================================
-- First-contact offer from the listing modal: an interested user proposes a rent
-- before any message exists. Start-or-get the listing thread on the same shape as
-- rpc_start_or_get_listing_chat, then post the proposal as a discount_offer.

CREATE OR REPLACE FUNCTION rpc_start_listing_offer(
  p_user_id       uuid,
  p_listing_id    uuid,
  p_proposed_rent numeric,
  p_note          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_note           text;
  v_type_id        uuid;
  v_landlord_id    uuid;
  v_thread_id      uuid;
  v_message_id     uuid;
  v_is_new         boolean := false;
  v_subject        text;
  v_contacted_type uuid;
  v_original_rent  numeric;
  v_body           text;
  v_metadata       jsonb;
BEGIN
  IF p_user_id IS NULL OR p_listing_id IS NULL THEN
    RAISE EXCEPTION 'user and listing are required';
  END IF;

  IF p_proposed_rent IS NULL OR p_proposed_rent <= 0 OR p_proposed_rent > 1000000 THEN
    RAISE EXCEPTION 'proposed rent must be a positive number';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'offer note exceeds the 1000 character limit';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = p_user_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'sender not found';
  END IF;

  SELECT COALESCE(NULLIF(btrim(l.title), ''), NULLIF(btrim(l.address), '')),
         l.min_rent
  INTO v_subject, v_original_rent
  FROM listings l
  WHERE l.id = p_listing_id
    AND l.deleted_at IS NULL
    AND l.unavailable IS NOT TRUE;

  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM listings WHERE id = p_listing_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'listing not found';
    END IF;
    RAISE EXCEPTION 'listing is not active';
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

  IF fn_chat_user_is_listing_landlord(p_user_id, p_listing_id) THEN
    RAISE EXCEPTION 'cannot send an offer on your own listing';
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

    INSERT INTO chat_threads (thread_type_id, listing_id, interested_user_id, subject)
    VALUES (v_type_id, p_listing_id, p_user_id, COALESCE(v_subject, 'Listing inquiry'))
    RETURNING id INTO v_thread_id;

    INSERT INTO chat_participants (thread_id, user_id)
    VALUES (v_thread_id, p_user_id), (v_thread_id, v_landlord_id)
    ON CONFLICT (thread_id, user_id) DO NOTHING;

    -- Same contacted tracking as the message and email contact flows.
    SELECT id INTO v_contacted_type
    FROM interaction_types WHERE name = 'contacted' LIMIT 1;

    IF v_contacted_type IS NOT NULL THEN
      INSERT INTO user_listing_interactions (user_id, listing_id, interaction_type_id)
      VALUES (p_user_id, p_listing_id, v_contacted_type)
      ON CONFLICT (user_id, listing_id, interaction_type_id) DO NOTHING;
    END IF;

    PERFORM increment_listing_metric(p_listing_id, 'contacts');
  END IF;

  -- Dedupe: only one actionable pending offer per thread.
  PERFORM fn_chat_supersede_pending_offers(v_thread_id, NULL);

  v_body := fn_chat_format_offer_body(p_proposed_rent);
  v_metadata := jsonb_build_object(
    'status', 'pending',
    'proposedRent', round(p_proposed_rent, 2),
    'originalRent', CASE WHEN v_original_rent IS NULL THEN NULL ELSE to_jsonb(round(v_original_rent, 2)) END,
    'note', to_jsonb(v_note),
    'parentOfferId', NULL,
    'respondedAt', NULL,
    'respondedBy', NULL
  );

  INSERT INTO chat_messages (thread_id, sender_id, body, message_type, metadata)
  VALUES (v_thread_id, p_user_id, v_body, 'discount_offer', v_metadata)
  RETURNING id INTO v_message_id;

  UPDATE chat_participants
  SET last_read_at = now()
  WHERE thread_id = v_thread_id AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'threadId',    v_thread_id,
    'messageId',   v_message_id,
    'isNew',       v_is_new,
    'body',        v_body,
    'messageType', 'discount_offer',
    'metadata',    v_metadata,
    'listingId',   p_listing_id,
    'landlordId',  v_landlord_id
  );
END;
$$;

-- ============================================================
-- rpc_respond_discount_offer
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_respond_discount_offer(
  p_user_id       uuid,
  p_message_id    uuid,
  p_action        text,
  p_proposed_rent numeric DEFAULT NULL,
  p_note          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_msg           chat_messages%ROWTYPE;
  v_thread        chat_threads%ROWTYPE;
  v_action        text;
  v_is_landlord   boolean;
  v_is_interested boolean;
  v_metadata      jsonb;
BEGIN
  IF p_user_id IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'user and message are required';
  END IF;

  v_action := lower(btrim(COALESCE(p_action, '')));
  IF v_action NOT IN ('accept', 'deny', 'counter') THEN
    RAISE EXCEPTION 'action must be accept, deny, or counter';
  END IF;

  SELECT * INTO v_msg
  FROM chat_messages
  WHERE id = p_message_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer not found';
  END IF;

  IF v_msg.message_type <> 'discount_offer' THEN
    RAISE EXCEPTION 'message is not a discount offer';
  END IF;

  PERFORM fn_chat_assert_participant(p_user_id, v_msg.thread_id);

  SELECT * INTO v_thread
  FROM chat_threads
  WHERE id = v_msg.thread_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF COALESCE(v_msg.metadata->>'status', 'pending') <> 'pending' THEN
    RAISE EXCEPTION 'offer is no longer pending';
  END IF;

  IF v_msg.sender_id = p_user_id THEN
    RAISE EXCEPTION 'cannot respond to your own offer';
  END IF;

  v_is_landlord := fn_chat_user_is_listing_landlord(p_user_id, v_thread.listing_id);
  v_is_interested := (v_thread.interested_user_id = p_user_id);

  IF NOT (v_is_landlord OR v_is_interested) THEN
    RAISE EXCEPTION 'not allowed to respond to this offer';
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  IF v_action = 'counter' THEN
    IF p_proposed_rent IS NULL THEN
      RAISE EXCEPTION 'proposed rent is required to counter';
    END IF;
    RETURN rpc_send_discount_offer(
      p_user_id,
      v_msg.thread_id,
      p_proposed_rent,
      p_note,
      p_message_id
    );
  END IF;

  v_metadata := v_msg.metadata || jsonb_build_object(
    'status', CASE WHEN v_action = 'accept' THEN 'accepted' ELSE 'denied' END,
    'respondedAt', to_jsonb(now()),
    'respondedBy', to_jsonb(p_user_id)
  );

  UPDATE chat_messages
  SET metadata = v_metadata
  WHERE id = p_message_id;

  RETURN jsonb_build_object(
    'threadId',    v_msg.thread_id,
    'messageId',   p_message_id,
    'body',        v_msg.body,
    'messageType', 'discount_offer',
    'metadata',    v_metadata,
    'action',      v_action
  );
END;
$$;

-- ============================================================
-- rpc_list_listing_savers
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_list_listing_savers(
  p_user_id    uuid,
  p_listing_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_saved_type uuid;
  v_result     jsonb;
BEGIN
  IF p_user_id IS NULL OR p_listing_id IS NULL THEN
    RAISE EXCEPTION 'user and listing are required';
  END IF;

  IF NOT fn_chat_user_is_listing_landlord(p_user_id, p_listing_id) THEN
    RAISE EXCEPTION 'only the listing owner can list savers';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM listings WHERE id = p_listing_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'listing not found';
  END IF;

  SELECT id INTO v_saved_type FROM interaction_types WHERE name = 'saved' LIMIT 1;
  IF v_saved_type IS NULL THEN
    RETURN jsonb_build_object('count', 0, 'savers', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'userId', u.id,
      'name',   u.name,
      'image',  u.image,
      'savedAt', uli.created_at
    )
    ORDER BY uli.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM user_listing_interactions uli
  JOIN users u ON u.id = uli.user_id AND u.deleted_at IS NULL
  WHERE uli.listing_id = p_listing_id
    AND uli.interaction_type_id = v_saved_type
    AND uli.user_id <> p_user_id;

  RETURN jsonb_build_object(
    'count', jsonb_array_length(v_result),
    'savers', v_result
  );
END;
$$;

-- ============================================================
-- rpc_broadcast_discount_offers
-- ============================================================
-- For each current saver: ensure a listing thread exists, then insert a
-- discount_offer (superseding any prior pending offer in that thread).

CREATE OR REPLACE FUNCTION rpc_broadcast_discount_offers(
  p_user_id       uuid,
  p_listing_id    uuid,
  p_proposed_rent numeric,
  p_note          text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_saved_type   uuid;
  v_type_id      uuid;
  v_landlord_id  uuid;
  v_subject      text;
  v_note         text;
  v_saver        record;
  v_thread_id    uuid;
  v_is_new       boolean;
  v_message_id   uuid;
  v_body         text;
  v_metadata     jsonb;
  v_original     numeric;
  v_sent         int := 0;
  v_skipped      int := 0;
  v_results      jsonb := '[]'::jsonb;
  v_contacted    uuid;
BEGIN
  IF p_user_id IS NULL OR p_listing_id IS NULL THEN
    RAISE EXCEPTION 'user and listing are required';
  END IF;

  IF p_proposed_rent IS NULL OR p_proposed_rent <= 0 OR p_proposed_rent > 1000000 THEN
    RAISE EXCEPTION 'proposed rent must be a positive number';
  END IF;

  IF NOT fn_chat_user_is_listing_landlord(p_user_id, p_listing_id) THEN
    RAISE EXCEPTION 'only the listing owner can broadcast offers';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM listings
    WHERE id = p_listing_id AND deleted_at IS NULL AND unavailable IS NOT TRUE
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM listings WHERE id = p_listing_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'listing not found';
    END IF;
    RAISE EXCEPTION 'listing is not active';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
    RAISE EXCEPTION 'offer note exceeds the 1000 character limit';
  END IF;

  v_type_id := fn_chat_direct_type_id();
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'direct thread type is not configured';
  END IF;

  v_landlord_id := fn_chat_primary_landlord_id(p_listing_id);
  IF v_landlord_id IS NULL THEN
    RAISE EXCEPTION 'listing has no landlord to contact';
  END IF;

  SELECT COALESCE(NULLIF(btrim(l.title), ''), NULLIF(btrim(l.address), '')),
         l.min_rent
  INTO v_subject, v_original
  FROM listings l
  WHERE l.id = p_listing_id;

  SELECT id INTO v_saved_type FROM interaction_types WHERE name = 'saved' LIMIT 1;
  SELECT id INTO v_contacted FROM interaction_types WHERE name = 'contacted' LIMIT 1;

  IF v_saved_type IS NULL THEN
    RETURN jsonb_build_object('sent', 0, 'skipped', 0, 'results', '[]'::jsonb);
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  v_body := fn_chat_format_offer_body(p_proposed_rent);

  FOR v_saver IN
    SELECT uli.user_id
    FROM user_listing_interactions uli
    JOIN users u ON u.id = uli.user_id AND u.deleted_at IS NULL
    WHERE uli.listing_id = p_listing_id
      AND uli.interaction_type_id = v_saved_type
      AND uli.user_id <> p_user_id
      AND NOT fn_chat_user_is_listing_landlord(uli.user_id, p_listing_id)
  LOOP
    BEGIN
      PERFORM pg_advisory_xact_lock(
        hashtextextended(p_listing_id::text || ':' || v_saver.user_id::text, 0::bigint)
      );

      v_is_new := false;
      SELECT id INTO v_thread_id
      FROM chat_threads
      WHERE listing_id = p_listing_id
        AND interested_user_id = v_saver.user_id
        AND deleted_at IS NULL
      LIMIT 1;

      IF v_thread_id IS NULL THEN
        v_is_new := true;
        INSERT INTO chat_threads (thread_type_id, listing_id, interested_user_id, subject)
        VALUES (
          v_type_id,
          p_listing_id,
          v_saver.user_id,
          COALESCE(v_subject, 'Listing inquiry')
        )
        RETURNING id INTO v_thread_id;

        INSERT INTO chat_participants (thread_id, user_id)
        VALUES (v_thread_id, v_saver.user_id), (v_thread_id, v_landlord_id)
        ON CONFLICT (thread_id, user_id) DO NOTHING;

        -- Ensure the sending landlord is a participant even if not primary.
        IF p_user_id <> v_landlord_id THEN
          INSERT INTO chat_participants (thread_id, user_id)
          VALUES (v_thread_id, p_user_id)
          ON CONFLICT (thread_id, user_id) DO NOTHING;
        END IF;

        IF v_contacted IS NOT NULL THEN
          INSERT INTO user_listing_interactions (user_id, listing_id, interaction_type_id)
          VALUES (v_saver.user_id, p_listing_id, v_contacted)
          ON CONFLICT (user_id, listing_id, interaction_type_id) DO NOTHING;
        END IF;

        PERFORM increment_listing_metric(p_listing_id, 'contacts');
      ELSE
        -- Existing thread: make sure sender is a participant.
        INSERT INTO chat_participants (thread_id, user_id)
        VALUES (v_thread_id, p_user_id)
        ON CONFLICT (thread_id, user_id) DO NOTHING;
      END IF;

      PERFORM fn_chat_supersede_pending_offers(v_thread_id, NULL);

      v_metadata := jsonb_build_object(
        'status', 'pending',
        'proposedRent', round(p_proposed_rent, 2),
        'originalRent', CASE WHEN v_original IS NULL THEN NULL ELSE to_jsonb(round(v_original, 2)) END,
        'note', to_jsonb(v_note),
        'parentOfferId', NULL,
        'respondedAt', NULL,
        'respondedBy', NULL
      );

      INSERT INTO chat_messages (thread_id, sender_id, body, message_type, metadata)
      VALUES (v_thread_id, p_user_id, v_body, 'discount_offer', v_metadata)
      RETURNING id INTO v_message_id;

      UPDATE chat_participants
      SET last_read_at = now()
      WHERE thread_id = v_thread_id AND user_id = p_user_id;

      v_sent := v_sent + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'userId', v_saver.user_id,
        'threadId', v_thread_id,
        'messageId', v_message_id,
        'isNewThread', v_is_new
      ));
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'sent', v_sent,
    'skipped', v_skipped,
    'results', v_results,
    'body', v_body
  );
END;
$$;

-- Grants
DO $$
DECLARE
  fn          text;
  rolename    text;
  fns         text[] := ARRAY[
    'fn_chat_user_is_listing_landlord(uuid, uuid)',
    'fn_chat_format_offer_body(numeric)',
    'fn_chat_supersede_pending_offers(uuid, uuid)',
    'rpc_send_discount_offer(uuid, uuid, numeric, text, uuid)',
    'rpc_start_listing_offer(uuid, uuid, numeric, text)',
    'rpc_respond_discount_offer(uuid, uuid, text, numeric, text)',
    'rpc_list_listing_savers(uuid, uuid)',
    'rpc_broadcast_discount_offers(uuid, uuid, numeric, text)'
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
  RAISE NOTICE 'Migration 202608150004: discount offer RPCs created.';
END $$;
