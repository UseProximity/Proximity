-- Chat: re-key conversations from one thread per (landlord, student) pair to one
-- thread per (listing, landlord, student).
--
-- Why this reverses 202610030001:
--   Listings can now carry their own alert address (a leasing office inbox per
--   property, see 202610090002). A thread that spans several properties has no
--   single correct address to alert: a student asking about The Delmonte and
--   Marlowe in one conversation would have every reply routed by guesswork. So
--   the thread boundary has to match the routing boundary, and that boundary is
--   the listing (Wyatt, 2026-10-09). The inbox heads each row with the listing
--   and the other person moves into the preview.
--
-- Why the landlord stays in the key:
--   One listing can carry leases held by different landlord accounts. Each
--   conversation belongs to exactly one landlord, the one holding the lease the
--   student clicked contact on, and no other landlord on the listing sees it
--   (Wyatt, 2026-10-09). Asking about a second landlord's lease on the same
--   listing opens a second conversation with that landlord.
--
-- Shape after this migration:
--   chat_threads.listing_id           the listing this conversation is about.
--                                     Now part of the identity, not a label.
--   chat_threads.interested_user_id   the student side
--   chat_threads.landlord_id          the landlord ACCOUNT holding the thread,
--                                     and the only landlord participant. Every
--                                     listing of one landlord lands in the same
--                                     account inbox, however its alerts route.
--   chat_threads.lease_id             the lease most recently asked about, which
--                                     decides the lease-level alert address.
--   chat_messages.listing_id          kept, always equal to the thread's listing
--                                     from here on.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod, then re-run
-- 202610070001_chat_lock_down_function_grants.sql.

-- ─── 1. columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.chat_threads
  ADD COLUMN IF NOT EXISTS lease_id uuid
    REFERENCES public.unit_leases(id) ON DELETE SET NULL;

-- The business a landlord account represents ("Keeley Properties"). Shown
-- next to a person's name in the transcript and in alert emails.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS company_name text;

-- The pair key has to go before the split below, which creates a second
-- thread for the same (landlord, student).
DROP INDEX IF EXISTS public.idx_chat_threads_landlord_interested_user;

-- ─── 2. give every live thread a listing ─────────────────────────────────────
UPDATE public.chat_threads t
SET listing_id = (
  SELECT m.listing_id
  FROM public.chat_messages m
  WHERE m.thread_id = t.id
    AND m.deleted_at IS NULL
    AND m.listing_id IS NOT NULL
  ORDER BY m.created_at
  LIMIT 1
)
WHERE t.listing_id IS NULL
  AND t.deleted_at IS NULL;

-- ─── 3. split threads that covered more than one listing ─────────────────────
-- The thread keeps the listing it was opened about. Messages about any other
-- listing move to a new thread for that listing, with the same two people and
-- the same read state, so nothing reappears as unread. Attachments follow
-- their message. Access tokens stay on the original thread, which still
-- exists, so links already in inboxes keep working.
DO $$
DECLARE
  r     record;
  v_new uuid;
BEGIN
  FOR r IN
    SELECT t.id AS thread_id, m.listing_id,
           MIN(m.created_at) AS first_at
    FROM public.chat_threads t
    JOIN public.chat_messages m ON m.thread_id = t.id
    WHERE t.deleted_at IS NULL
      AND m.listing_id IS NOT NULL
      AND m.listing_id IS DISTINCT FROM t.listing_id
    GROUP BY t.id, m.listing_id
  LOOP
    INSERT INTO public.chat_threads (
      thread_type_id, listing_id, landlord_id, interested_user_id, subject, created_at
    )
    SELECT t.thread_type_id, r.listing_id, t.landlord_id, t.interested_user_id,
           COALESCE(NULLIF(btrim(l.title), ''), NULLIF(btrim(l.address), ''), t.subject),
           r.first_at
    FROM public.chat_threads t
    LEFT JOIN public.listings l ON l.id = r.listing_id
    WHERE t.id = r.thread_id
    RETURNING id INTO v_new;

    INSERT INTO public.chat_participants (thread_id, user_id, joined_at, last_read_at, last_notified_at)
    SELECT v_new, cp.user_id, cp.joined_at, cp.last_read_at, cp.last_notified_at
    FROM public.chat_participants cp
    WHERE cp.thread_id = r.thread_id
    ON CONFLICT (thread_id, user_id) DO NOTHING;

    UPDATE public.chat_attachments a
    SET thread_id = v_new
    FROM public.chat_messages m
    WHERE a.message_id = m.id
      AND m.thread_id = r.thread_id
      AND m.listing_id = r.listing_id;

    UPDATE public.chat_messages
    SET thread_id = v_new
    WHERE thread_id = r.thread_id
      AND listing_id = r.listing_id;
  END LOOP;
END $$;

-- ─── 4. merge live duplicates for one (listing, landlord, student) ───────────
-- The split above can produce a second thread for a key that already had one
-- (the pair once held a thread opened about that listing too). The new unique
-- index would refuse to build on that, so keep the oldest and fold the rest
-- into it. Threads with different landlords are never merged.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.id AS dup_id, k.keep_id
    FROM public.chat_threads t
    JOIN (
      SELECT DISTINCT ON (listing_id, landlord_id, interested_user_id)
             listing_id, landlord_id, interested_user_id, id AS keep_id
      FROM public.chat_threads
      WHERE deleted_at IS NULL
        AND listing_id IS NOT NULL
        AND landlord_id IS NOT NULL
        AND interested_user_id IS NOT NULL
      ORDER BY listing_id, landlord_id, interested_user_id, created_at, id
    ) k ON k.listing_id = t.listing_id
       AND k.landlord_id = t.landlord_id
       AND k.interested_user_id = t.interested_user_id
    WHERE t.deleted_at IS NULL
      AND t.id <> k.keep_id
  LOOP
    INSERT INTO public.chat_participants (thread_id, user_id, joined_at, last_read_at, last_notified_at)
    SELECT r.keep_id, cp.user_id, cp.joined_at, cp.last_read_at, cp.last_notified_at
    FROM public.chat_participants cp
    WHERE cp.thread_id = r.dup_id
    ON CONFLICT (thread_id, user_id) DO NOTHING;

    UPDATE public.chat_attachments SET thread_id = r.keep_id WHERE thread_id = r.dup_id;
    UPDATE public.chat_messages    SET thread_id = r.keep_id WHERE thread_id = r.dup_id;
    UPDATE public.chat_threads     SET deleted_at = now()    WHERE id = r.dup_id;
  END LOOP;
END $$;

-- ─── 5. recency follows the messages that moved ──────────────────────────────
-- The updated_at trigger would stamp now() on every thread touched above and
-- reorder every inbox, so it is held off for this one correction.
ALTER TABLE public.chat_threads DISABLE TRIGGER trg_set_updated_at_chat_threads;

UPDATE public.chat_threads t
SET updated_at = s.last_at
FROM (
  SELECT thread_id, MAX(created_at) AS last_at
  FROM public.chat_messages
  WHERE deleted_at IS NULL
  GROUP BY thread_id
) s
WHERE s.thread_id = t.id
  AND t.deleted_at IS NULL
  AND t.updated_at IS DISTINCT FROM s.last_at;

ALTER TABLE public.chat_threads ENABLE TRIGGER trg_set_updated_at_chat_threads;

-- ─── 6. the new identity ─────────────────────────────────────────────────────
-- An earlier draft of this migration keyed on (listing, student) alone.
DROP INDEX IF EXISTS public.idx_chat_threads_listing_interested_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_listing_landlord_interested_user
  ON public.chat_threads (listing_id, landlord_id, interested_user_id)
  WHERE deleted_at IS NULL
    AND listing_id IS NOT NULL
    AND landlord_id IS NOT NULL
    AND interested_user_id IS NOT NULL;

-- ─── 7. functions ────────────────────────────────────────────────────────────

-- The thread's own listing first. The message fallback only matters for a
-- thread whose listing was hard-deleted.
CREATE OR REPLACE FUNCTION public.fn_chat_current_listing_id(p_thread_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (SELECT t.listing_id FROM chat_threads t WHERE t.id = p_thread_id),
    (SELECT m.listing_id
       FROM chat_messages m
      WHERE m.thread_id = p_thread_id
        AND m.deleted_at IS NULL
        AND m.listing_id IS NOT NULL
      ORDER BY m.created_at DESC
      LIMIT 1)
  );
$function$;

/*
 * Which ACCOUNT holds a new conversation about this listing.
 *
 * Contact addresses are alert routes, never accounts (Wyatt, 2026-10-09), so a
 * lease or listing contact only decides where the email goes, see
 * fn_chat_alert_email. The one exception is a listing with no usable landlord
 * account at all: something has to hold the thread, so an account is still
 * provisioned from the contact address, exactly as before.
 *
 * Order: the lease's own landlord account, then the listing's primary landlord,
 * then a provisioned account from the lease contact, then the listing contact.
 */
CREATE OR REPLACE FUNCTION public.fn_chat_resolve_landlord(p_listing_id uuid, p_lease_id uuid DEFAULT NULL::uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_house constant text := 'info@useproximity.org';
  v_lease   record;
  v_user_id uuid;
BEGIN
  IF p_listing_id IS NULL THEN RETURN NULL; END IF;

  IF p_lease_id IS NOT NULL THEN
    SELECT ul.owner_id, ul.contact_email, ul.contact_name
    INTO v_lease
    FROM unit_leases ul
    JOIN listing_units lu ON lu.id = ul.unit_id
    WHERE ul.id = p_lease_id AND ul.deleted_at IS NULL AND lu.listing_id = p_listing_id;

    IF FOUND AND v_lease.owner_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM users
      WHERE id = v_lease.owner_id AND deleted_at IS NULL AND is_system IS NOT TRUE
        AND lower(btrim(coalesce(email, ''))) <> v_house
    ) THEN
      RETURN v_lease.owner_id;
    END IF;
  END IF;

  v_user_id := fn_chat_primary_landlord_id(p_listing_id);
  IF v_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM users
    WHERE id = v_user_id AND deleted_at IS NULL AND is_system IS NOT TRUE
      AND lower(btrim(coalesce(email, ''))) <> v_house
  ) THEN
    RETURN v_user_id;
  END IF;

  IF v_lease.contact_email IS NOT NULL
     AND lower(btrim(v_lease.contact_email)) <> v_house THEN
    v_user_id := fn_chat_find_or_create_contact_user(v_lease.contact_email, v_lease.contact_name);
    IF v_user_id IS NOT NULL THEN RETURN v_user_id; END IF;
  END IF;

  SELECT fn_chat_find_or_create_contact_user(l.contact_email, l.contact_name)
  INTO v_user_id FROM listings l
  WHERE l.id = p_listing_id AND l.deleted_at IS NULL
    AND lower(btrim(coalesce(l.contact_email, ''))) <> v_house;

  RETURN v_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_start_or_get_listing_chat(p_user_id uuid, p_listing_id uuid, p_body text, p_lease_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_body            text;
  v_type_id         uuid;
  v_landlord_id     uuid;
  v_thread_id       uuid;
  v_message_id      uuid;
  v_is_new          boolean := false;
  v_lease_id        uuid;
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

  -- Only a lease that belongs to this listing may steer the alert address.
  IF p_lease_id IS NOT NULL THEN
    SELECT ul.id INTO v_lease_id
    FROM unit_leases ul
    JOIN listing_units lu ON lu.id = ul.unit_id
    WHERE ul.id = p_lease_id AND ul.deleted_at IS NULL AND lu.listing_id = p_listing_id;
  END IF;

  PERFORM fn_chat_assert_send_rate(p_user_id, 'start');

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- The landlord holding the clicked lease owns the conversation, so it is
  -- resolved before the lookup: a different landlord's lease on the same
  -- listing is a different conversation.
  v_landlord_id := fn_chat_resolve_landlord(p_listing_id, v_lease_id);
  IF v_landlord_id IS NULL THEN
    RAISE EXCEPTION 'listing has no landlord to contact';
  END IF;

  IF p_user_id = v_landlord_id OR EXISTS (
    SELECT 1 FROM listing_landlords
    WHERE listing_id = p_listing_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'cannot start a chat about your own listing';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_listing_id::text || ':' || v_landlord_id::text || ':' || p_user_id::text, 0::bigint
    )
  );

  SELECT id INTO v_thread_id
  FROM chat_threads
  WHERE listing_id = p_listing_id
    AND landlord_id = v_landlord_id
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
      thread_type_id, listing_id, landlord_id, interested_user_id, lease_id, subject
    )
    VALUES (
      v_type_id, p_listing_id, v_landlord_id, p_user_id, v_lease_id,
      COALESCE(v_subject, 'Listing inquiry')
    )
    RETURNING id INTO v_thread_id;

    INSERT INTO chat_participants (thread_id, user_id)
    VALUES (v_thread_id, p_user_id), (v_thread_id, v_landlord_id)
    ON CONFLICT (thread_id, user_id) DO NOTHING;
  ELSE
    -- A later inquiry about another lease of the same landlord re-points the
    -- lease-level alert to that lease's contact.
    IF v_lease_id IS NOT NULL THEN
      UPDATE chat_threads SET lease_id = v_lease_id
      WHERE id = v_thread_id AND lease_id IS DISTINCT FROM v_lease_id;
    END IF;
  END IF;

  INSERT INTO chat_messages (thread_id, sender_id, body, message_type, listing_id)
  VALUES (v_thread_id, p_user_id, v_body, 'text', p_listing_id)
  RETURNING id INTO v_message_id;

  IF v_is_new THEN
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

  -- isNewListing is kept for the client, which reads it. With one thread per
  -- listing and landlord it is the same thing as isNew.
  RETURN jsonb_build_object(
    'threadId',     v_thread_id,
    'messageId',    v_message_id,
    'isNew',        v_is_new,
    'isNewListing', v_is_new,
    'listingId',    p_listing_id,
    'landlordId',   v_landlord_id
  );
END;
$function$;

-- Same as before, plus the sender's account name and company so the transcript
-- can label every message with who sent it (Wyatt, 2026-10-09).
CREATE OR REPLACE FUNCTION public.rpc_get_chat_messages(p_user_id uuid, p_thread_id uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
        'senderName',     su.name,
        'senderCompany',  NULLIF(btrim(su.company_name), ''),
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
    LEFT JOIN users su ON su.id = m.sender_id
    WHERE m.thread_id = p_thread_id
      AND m.deleted_at IS NULL
      AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC
    LIMIT v_limit
  ) s;

  RETURN v_result;
END;
$function$;

-- ─── 8. grants ───────────────────────────────────────────────────────────────
-- Service role only, same as every chat function. Re-run
-- 202610070001_chat_lock_down_function_grants.sql after this as well.
DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.fn_chat_current_listing_id(uuid)',
    'public.fn_chat_resolve_landlord(uuid, uuid)',
    'public.rpc_start_or_get_listing_chat(uuid, uuid, text, uuid)',
    'public.rpc_get_chat_messages(uuid, uuid, integer, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;
