-- Chat email notifications: email the other participant when a message arrives, and let
-- them open the conversation from that email without signing in.
--
-- Adds:
--   * chat_participants.last_notified_at — when we last emailed this participant about
--     this thread. Drives the frequency rules in rpc_chat_notification_recipient so a
--     burst of messages doesn't become a burst of emails.
--   * users.email_notifications — per-account opt-out, honoured by the same RPC.
--   * chat_access_tokens — expiring magic-link tokens scoped to one user and one thread.
--     Only the SHA-256 hash is stored, so leaking this table yields no usable links.
--   * rpc_chat_notification_recipient — decides whether to email and stamps
--     last_notified_at in the same transaction, so two near-simultaneous messages can't
--     both decide to send. Notifies whichever side didn't send, and reports which side
--     that is so the email can be worded for an owner or for a prospective renter.
--   * rpc_consume_chat_access_token — validates a token and burns it if single-use.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod: the weekly prod→dev snapshot
-- replaces dev's public schema with prod's, so anything missing from prod is destroyed
-- on Sunday (see scripts/snapshot-prod-to-dev.sh).

-- ─── notification bookkeeping ────────────────────────────────────────────────
ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true;

-- ─── magic-link tokens ───────────────────────────────────────────────────────
-- thread_id is nullable so the same table can carry account-scoped tokens (unsubscribe).
CREATE TABLE IF NOT EXISTS public.chat_access_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  thread_id  uuid REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  purpose    text NOT NULL DEFAULT 'thread_access',
  single_use boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.chat_access_tokens
    ADD CONSTRAINT chat_access_tokens_purpose_check
    CHECK (purpose IN ('thread_access', 'unsubscribe'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_access_tokens_user_thread
  ON public.chat_access_tokens (user_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_chat_access_tokens_expires
  ON public.chat_access_tokens (expires_at);

-- No policies are defined, so RLS denies anon/authenticated outright while service_role
-- (which bypasses RLS) keeps full access. This survives the snapshot script's blanket
-- re-grant, which a plain REVOKE would not.
ALTER TABLE public.chat_access_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- rpc_chat_notification_recipient
-- ============================================================
-- Returns the participant to email plus everything the template needs, or NULL when no
-- email should be sent. Stamping last_notified_at here (rather than after a successful
-- send) means a failed send is not retried for a day — deliberate, since a duplicate
-- email is worse than a missed one.
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
    -- Picks the email wording: true = the prospective renter got a reply, false = the
    -- listing owner got an inquiry. COALESCE keeps this a real boolean for the JS side
    -- if a thread predates interested_user_id.
    'recipientIsInterestedUser',
      COALESCE(v_thread.interested_user_id = v_rec.user_id, false)
  );
END;
$$;

-- ============================================================
-- rpc_consume_chat_access_token
-- ============================================================
-- Returns {userId, threadId} for a valid token, else NULL. FOR UPDATE serialises
-- concurrent redemptions so a single-use token can't be spent twice.
CREATE OR REPLACE FUNCTION public.rpc_consume_chat_access_token(
  p_token_hash text,
  p_purpose    text DEFAULT 'thread_access'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
BEGIN
  IF NULLIF(btrim(COALESCE(p_token_hash, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.id, t.user_id, t.thread_id, t.single_use
  INTO v_row
  FROM chat_access_tokens t
  JOIN users u ON u.id = t.user_id
  WHERE t.token_hash = p_token_hash
    AND t.purpose    = p_purpose
    AND t.used_at IS NULL
    AND t.expires_at > now()
    AND u.deleted_at IS NULL
  FOR UPDATE OF t;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_row.single_use THEN
    UPDATE chat_access_tokens SET used_at = now() WHERE id = v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'userId',   v_row.user_id,
    'threadId', v_row.thread_id
  );
END;
$$;

-- Only the server key may call these — they hand out identities and message contents.
DO $$
DECLARE
  fn          text;
  rolename    text;
  fns         text[] := ARRAY[
    'rpc_chat_notification_recipient(uuid, uuid)',
    'rpc_consume_chat_access_token(text, text)'
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
  RAISE NOTICE 'Migration 202608130001: chat email notifications (last_notified_at, email_notifications, chat_access_tokens, notification + token RPCs) applied.';
END $$;
