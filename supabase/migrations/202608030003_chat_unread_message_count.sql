-- Add per-thread unread message count to the inbox RPC so the header badge
-- can sum messages (not just threads with any unread).

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

-- Keep grants consistent with prior chat RPCs (service_role only).
REVOKE ALL ON FUNCTION rpc_list_chat_threads(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rpc_list_chat_threads(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_list_chat_threads(uuid) TO service_role;
