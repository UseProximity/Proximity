-- Chat: route an inquiry to the landlord of the LEASE being asked about, and
-- make every listing with a working email address reachable.
--
-- Two changes, both needed before the email contact form can be retired
-- (Wyatt, 2026-10-03).
--
-- 1. LEASE-AWARE ROUTING. A property can carry competing leases from different
--    landlords, one per unit. The email form has always resolved the recipient
--    from the chosen lease; chat resolved it from the listing's primary
--    landlord, so on those properties a student asking about unit 2E reached
--    whoever happened to be primary. Chat now follows the same chain the email
--    form does.
--
-- 2. REACHABILITY. landlordCanChat used to require Google or a verified
--    password, which only 33 of 46 landlord accounts behind live listings had:
--    the rest were created by the listing importer and have never signed in.
--    That gated chat to 58 of 205 listings while the email form reached 204.
--    Retiring the email form against that gate would have stranded most of the
--    inventory, so reachability now means "we have an email address for this
--    person", and the notification email's magic link carries them in without
--    a password. Replying still requires setting one.
--
--    Where only a contact_email exists and no account does, a shell user row is
--    created to hold the thread. It is the same shape the importer already
--    creates, with one difference: email_verified is forced FALSE. The column
--    defaults to true, and a scraped address is not proof of anything. The
--    magic link is what proves control of the address.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod.

-- ─── shell account for a contact address with no user row ────────────────────
CREATE OR REPLACE FUNCTION fn_chat_find_or_create_contact_user(
  p_email text,
  p_name  text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_email   text;
  v_user_id uuid;
  v_role_id uuid;
BEGIN
  v_email := lower(nullif(btrim(coalesce(p_email, '')), ''));
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    RETURN NULL;
  END IF;

  -- Case-insensitive, same as the rest of the auth surface.
  SELECT id INTO v_user_id
  FROM users
  WHERE lower(btrim(email)) = v_email
    AND deleted_at IS NULL
  ORDER BY created_at
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    RETURN v_user_id;
  END IF;

  SELECT id INTO v_role_id FROM roles WHERE name = 'landlord' LIMIT 1;
  IF v_role_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO users (email, name, role_id, email_verified, google_account)
  VALUES (
    v_email,
    COALESCE(nullif(btrim(p_name), ''), split_part(v_email, '@', 1)),
    v_role_id,
    false,   -- deliberate: the column defaults to true, a scraped address is not verified
    false
  )
  RETURNING id INTO v_user_id;

  RETURN v_user_id;
END;
$$;

-- ─── the recipient for an inquiry ────────────────────────────────────────────
-- Mirrors api/contactLandlord's chain: the lease's own landlord first, because
-- that is the person who holds the unit being asked about; then the lease's
-- contact address; then the listing's primary landlord; then the listing's
-- contact address.
--
-- info@useproximity.org is refused at every step, matching landlordCanChat. It
-- is a shared inbox, not a landlord, and routing to it would have meant a client
-- that says "no contact available" while the server quietly delivered into a
-- mailbox nobody reads as a landlord queue.
CREATE OR REPLACE FUNCTION fn_chat_resolve_landlord(
  p_listing_id uuid,
  p_lease_id   uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_house constant text := 'info@useproximity.org';
  v_lease   record;
  v_user_id uuid;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_lease_id IS NOT NULL THEN
    -- The lease has to belong to this listing. A lease id from elsewhere must
    -- not be able to redirect an inquiry at an unrelated landlord.
    SELECT ul.owner_id, ul.contact_email, ul.contact_name
    INTO v_lease
    FROM unit_leases ul
    JOIN listing_units lu ON lu.id = ul.unit_id
    WHERE ul.id = p_lease_id
      AND ul.deleted_at IS NULL
      AND lu.listing_id = p_listing_id;

    IF FOUND THEN
      IF v_lease.owner_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM users
        WHERE id = v_lease.owner_id
          AND deleted_at IS NULL
          AND is_system IS NOT TRUE
          AND lower(btrim(coalesce(email, ''))) <> v_house
      ) THEN
        RETURN v_lease.owner_id;
      END IF;

      IF lower(btrim(coalesce(v_lease.contact_email, ''))) <> v_house THEN
        v_user_id := fn_chat_find_or_create_contact_user(
          v_lease.contact_email, v_lease.contact_name
        );
        IF v_user_id IS NOT NULL THEN
          RETURN v_user_id;
        END IF;
      END IF;
    END IF;
  END IF;

  v_user_id := fn_chat_primary_landlord_id(p_listing_id);
  IF v_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM users
    WHERE id = v_user_id
      AND deleted_at IS NULL
      AND is_system IS NOT TRUE
      AND lower(btrim(coalesce(email, ''))) <> v_house
  ) THEN
    RETURN v_user_id;
  END IF;

  SELECT fn_chat_find_or_create_contact_user(l.contact_email, l.contact_name)
  INTO v_user_id
  FROM listings l
  WHERE l.id = p_listing_id
    AND l.deleted_at IS NULL
    AND lower(btrim(coalesce(l.contact_email, ''))) <> v_house;

  RETURN v_user_id;
END;
$$;

-- ─── rpc_start_or_get_listing_chat, now lease aware ──────────────────────────
-- The signature gains p_lease_id, so the old three-argument version is dropped
-- rather than left as an overload: PostgREST resolves by argument name and two
-- candidates would make the call ambiguous.
DROP FUNCTION IF EXISTS rpc_start_or_get_listing_chat(uuid, uuid, text);

CREATE OR REPLACE FUNCTION rpc_start_or_get_listing_chat(
  p_user_id    uuid,
  p_listing_id uuid,
  p_body       text,
  p_lease_id   uuid DEFAULT NULL
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

  v_landlord_id := fn_chat_resolve_landlord(p_listing_id, p_lease_id);
  IF v_landlord_id IS NULL THEN
    RAISE EXCEPTION 'listing has no landlord to contact';
  END IF;

  IF p_user_id = v_landlord_id OR EXISTS (
    SELECT 1 FROM listing_landlords
    WHERE listing_id = p_listing_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'cannot start a chat about your own listing';
  END IF;

  PERFORM fn_chat_assert_send_rate(p_user_id, 'start');

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

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
    'threadId',     v_thread_id,
    'messageId',    v_message_id,
    'isNew',        v_is_new,
    'isNewListing', v_is_new_listing,
    'listingId',    p_listing_id,
    'landlordId',   v_landlord_id
  );
END;
$$;

-- ─── rpc_list_chat_threads: every property the thread has covered ────────────
-- Returns the full list, most recent inquiry first, so the inbox can show each
-- property under the person's name instead of only the latest one. The UI caps
-- the visible rows; the cap does not belong in the query.
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
        'listings',            COALESCE(pl.items, '[]'::jsonb),
        'listingCount',        COALESCE(pl.n, 0),
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
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'listingId', x.listing_id,
            'title',     x.title,
            'address',   x.address,
            'lastAt',    x.last_at
          ) ORDER BY x.last_at DESC
        ) AS items,
        COUNT(*)::int AS n
      FROM (
        SELECT m.listing_id, li2.title, li2.address, MAX(m.created_at) AS last_at
        FROM chat_messages m
        JOIN listings li2 ON li2.id = m.listing_id
        WHERE m.thread_id = t.id
          AND m.deleted_at IS NULL
          AND m.listing_id IS NOT NULL
        GROUP BY m.listing_id, li2.title, li2.address
      ) x
    ) pl ON true
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

-- ─── grants ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn       text;
  rolename text;
  fns text[] := ARRAY[
    'fn_chat_find_or_create_contact_user(text, text)',
    'fn_chat_resolve_landlord(uuid, uuid)',
    'rpc_start_or_get_listing_chat(uuid, uuid, text, uuid)',
    'rpc_list_chat_threads(uuid)'
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
  RAISE NOTICE 'Migration 202610030006: lease-aware chat routing, shell contact accounts, per-thread property list.';
END $$;
