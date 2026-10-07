-- Chat read RPCs: list inbox threads and paginate messages.
-- Depends on 202607300002.

-- ============================================================
-- rpc_list_chat_threads
-- ============================================================
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
        'threadId',         t.id,
        'subject',          t.subject,
        'updatedAt',        t.updated_at,
        'listingId',        t.listing_id,
        'listingTitle',     l.title,
        'listingAddress',   l.address,
        'isInterestedUser', (t.interested_user_id = p_user_id),
        'otherUserId',      ou.id,
        'otherUserName',    ou.name,
        'otherUserImage',   ou.image,
        'lastMessageBody',  lm.body,
        'lastMessageType',  lm.message_type,
        'lastMessageAt',    lm.created_at,
        'lastMessageMine',  (lm.sender_id = p_user_id),
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
    LEFT JOIN listings l ON l.id = t.listing_id
    LEFT JOIN LATERAL (
      SELECT u.id, u.name, u.image
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

-- ============================================================
-- rpc_get_chat_messages
-- ============================================================
-- p_before: pass the oldest createdAt you already have to page further back.
-- Does not mark the thread read — call rpc_mark_thread_read when the user opens it.
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
        'id',          m.id,
        'threadId',    m.thread_id,
        'senderId',    m.sender_id,
        'isMine',      (m.sender_id = p_user_id),
        'body',        m.body,
        'messageType', m.message_type,
        'metadata',    m.metadata,
        'createdAt',   m.created_at
      ) AS payload
    FROM chat_messages m
    WHERE m.thread_id = p_thread_id
      AND m.deleted_at IS NULL
      AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC
    LIMIT v_limit
  ) s;

  RETURN v_result;
END;
$$;

-- Only the server key may call these (they trust p_user_id).
DO $$
DECLARE
  fn          text;
  rolename    text;
  fns         text[] := ARRAY[
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
  RAISE NOTICE 'Migration 202607300003: chat read RPCs created.';
END $$;