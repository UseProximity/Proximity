-- Chat: per-listing alert addresses, gated on a one-click confirmation.
--
-- A landlord account can now have message alerts for one listing (or one lease)
-- go to a different inbox than the account's own, e.g. every Keeley property
-- alerting its own leasing office. The conversation itself stays in the one
-- landlord account (Wyatt, 2026-10-09). Contact addresses are alert routes
-- only, never accounts.
--
-- Precedence for the landlord side of a thread:
--   1. the contact email on the lease the student asked about
--   2. the contact email on the listing
--   3. the landlord account's own email
-- A contact address is only used once it is CONFIRMED for that landlord, either
-- because it is the account's own address or because someone clicked the
-- confirmation link sent to it. An unconfirmed address is skipped, so until it
-- is confirmed alerts go exactly where they went before this migration.
--
-- Enforced here, at the point of routing, rather than at each of the dozen
-- places that write contact_email (wizard, editor, lease routes, PMS sync,
-- importer). Nothing can bypass it by writing the column some new way.
--
-- Idempotent / safe to re-run. Apply to BOTH dev and prod after
-- 202610090001, then re-run 202610070001_chat_lock_down_function_grants.sql.

-- ─── 1. confirmations ────────────────────────────────────────────────────────
-- One row per (landlord account, address). Scoped to the landlord so that an
-- address confirmed for one account cannot be pointed at by another.
CREATE TABLE IF NOT EXISTS public.contact_email_verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  token_hash    text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_email_verifications_email_normalized
    CHECK (email = lower(btrim(email)) AND position('@' in email) > 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_email_verifications_landlord_email
  ON public.contact_email_verifications (landlord_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_email_verifications_token
  ON public.contact_email_verifications (token_hash)
  WHERE token_hash IS NOT NULL;

-- Server only. The service role bypasses RLS; nobody else gets a policy.
ALTER TABLE public.contact_email_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_email_verifications FROM anon, authenticated;

-- ─── 2. is this address confirmed for this landlord? ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_contact_confirmed(p_landlord_id uuid, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_landlord_id IS NOT NULL
    AND lower(btrim(coalesce(p_email, ''))) NOT IN ('', 'info@useproximity.org')
    AND (
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = p_landlord_id
          AND lower(btrim(coalesce(u.email, ''))) = lower(btrim(p_email))
      )
      OR EXISTS (
        SELECT 1 FROM contact_email_verifications v
        WHERE v.landlord_id = p_landlord_id
          AND v.email = lower(btrim(p_email))
          AND v.verified_at IS NOT NULL
      )
    );
$function$;

-- ─── 3. where does an alert for this participant go? ─────────────────────────
-- The student side, and any participant who is not the thread's landlord
-- account, always gets their own account address.
CREATE OR REPLACE FUNCTION public.fn_chat_alert_email(p_thread_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_thread  record;
  v_account text;
  v_lease   text;
  v_listing text;
BEGIN
  SELECT u.email INTO v_account FROM users u WHERE u.id = p_user_id;

  SELECT t.landlord_id, t.listing_id, t.lease_id INTO v_thread
  FROM chat_threads t WHERE t.id = p_thread_id;

  IF NOT FOUND OR v_thread.landlord_id IS DISTINCT FROM p_user_id THEN
    RETURN v_account;
  END IF;

  IF v_thread.lease_id IS NOT NULL THEN
    SELECT ul.contact_email INTO v_lease
    FROM unit_leases ul
    JOIN listing_units lu ON lu.id = ul.unit_id
    WHERE ul.id = v_thread.lease_id
      AND ul.deleted_at IS NULL
      AND lu.listing_id = v_thread.listing_id;

    IF fn_chat_contact_confirmed(p_user_id, v_lease) THEN
      RETURN lower(btrim(v_lease));
    END IF;
  END IF;

  SELECT l.contact_email INTO v_listing
  FROM listings l WHERE l.id = v_thread.listing_id;

  IF fn_chat_contact_confirmed(p_user_id, v_listing) THEN
    RETURN lower(btrim(v_listing));
  END IF;

  RETURN v_account;
END;
$function$;

-- ─── 4. notification recipient uses the route ────────────────────────────────
-- Unchanged apart from recipientEmail, which now comes from fn_chat_alert_email
-- instead of the account row.
CREATE OR REPLACE FUNCTION public.rpc_chat_notification_recipient(p_thread_id uuid, p_sender_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_active_window  constant interval := interval '2 minutes';
  v_renotify_after constant interval := interval '24 hours';
  v_rec            record;
  v_msg            record;
  v_thread         record;
  v_listing        record;
  v_sender_name    text;
  v_unread         int;
  v_to             text;
BEGIN
  IF p_thread_id IS NULL OR p_sender_id IS NULL THEN RETURN NULL; END IF;

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

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_rec.email_notifications IS NOT TRUE THEN RETURN NULL; END IF;

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

  v_to := COALESCE(NULLIF(btrim(fn_chat_alert_email(p_thread_id, v_rec.user_id)), ''), v_rec.email);

  UPDATE chat_participants SET last_notified_at = now()
  WHERE thread_id = p_thread_id AND user_id = v_rec.user_id;

  SELECT m.body, m.created_at, m.message_type, m.listing_id
  INTO v_msg FROM chat_messages m
  WHERE m.thread_id = p_thread_id AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC LIMIT 1;

  SELECT count(*)::int INTO v_unread FROM chat_messages m
  WHERE m.thread_id = p_thread_id AND m.deleted_at IS NULL
    AND m.sender_id <> v_rec.user_id
    AND (v_rec.last_read_at IS NULL OR m.created_at > v_rec.last_read_at);

  IF v_unread < 1 THEN v_unread := 1; END IF;

  SELECT t.subject, t.interested_user_id INTO v_thread
  FROM chat_threads t WHERE t.id = p_thread_id;

  SELECT l.id, l.title, l.address INTO v_listing FROM listings l
  WHERE l.id = COALESCE(v_msg.listing_id, fn_chat_current_listing_id(p_thread_id));

  SELECT u.name INTO v_sender_name FROM users u WHERE u.id = p_sender_id;

  RETURN jsonb_build_object(
    'recipientId', v_rec.user_id, 'recipientEmail', v_to,
    'recipientName', v_rec.name, 'senderName', v_sender_name,
    'threadId', p_thread_id, 'subject', v_thread.subject,
    'listingId', v_listing.id, 'listingTitle', v_listing.title,
    'listingAddress', v_listing.address, 'messageBody', v_msg.body,
    'messageType', v_msg.message_type, 'messageAt', v_msg.created_at,
    'unreadCount', v_unread,
    'recipientIsInterestedUser', COALESCE(v_thread.interested_user_id = v_rec.user_id, false)
  );
END;
$function$;

-- ─── 5. grants ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.fn_chat_contact_confirmed(uuid, text)',
    'public.fn_chat_alert_email(uuid, uuid)',
    'public.rpc_chat_notification_recipient(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;
