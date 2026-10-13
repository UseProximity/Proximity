-- One rule for where a landlord is contacted, shared by chat alerts and the
-- matchmaking "have Proxy reach out" flow (Wyatt, 2026-10-12).
--
-- Until now chat alerts went lease contact > listing contact > account email,
-- while the matchmaker emailed the account first and only used the listing
-- contact when there was no account at all. Property managers who put a
-- leasing-office address on a listing were still getting matchmaking
-- inquiries in a personal inbox.
--
-- fn_landlord_contact_email is the rule. fn_chat_alert_email keeps its
-- signature and becomes a thin wrapper, so nothing that calls it changes.
-- A contact address is only used once it has been confirmed for that landlord
-- (fn_chat_contact_confirmed), the same as before.
--
-- Apply to BOTH dev and prod, then re-run 202610070001. The function has no
-- "chat" in its name, so it is listed there explicitly.

-- ─── 1. the shared rule ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_landlord_contact_email(
  p_landlord_id uuid,
  p_listing_id  uuid,
  p_lease_id    uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_account text;
  v_lease   text;
  v_listing text;
BEGIN
  SELECT u.email INTO v_account FROM users u WHERE u.id = p_landlord_id;

  IF p_listing_id IS NULL THEN
    RETURN v_account;
  END IF;

  IF p_lease_id IS NOT NULL THEN
    -- The lease has to belong to this listing; a lease id from elsewhere must
    -- not be able to redirect mail.
    SELECT ul.contact_email INTO v_lease
    FROM unit_leases ul
    JOIN listing_units lu ON lu.id = ul.unit_id
    WHERE ul.id = p_lease_id
      AND ul.deleted_at IS NULL
      AND lu.listing_id = p_listing_id;

    IF fn_chat_contact_confirmed(p_landlord_id, v_lease) THEN
      RETURN lower(btrim(v_lease));
    END IF;
  END IF;

  SELECT l.contact_email INTO v_listing
  FROM listings l WHERE l.id = p_listing_id;

  IF fn_chat_contact_confirmed(p_landlord_id, v_listing) THEN
    RETURN lower(btrim(v_listing));
  END IF;

  RETURN v_account;
END;
$function$;

-- ─── 2. chat alerts use it ───────────────────────────────────────────────────
-- The student side, and any participant who is not the thread's landlord
-- account, always gets their own account address.
CREATE OR REPLACE FUNCTION public.fn_chat_alert_email(p_thread_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_thread record;
BEGIN
  SELECT t.landlord_id, t.listing_id, t.lease_id INTO v_thread
  FROM chat_threads t WHERE t.id = p_thread_id;

  IF NOT FOUND OR v_thread.landlord_id IS DISTINCT FROM p_user_id THEN
    RETURN (SELECT u.email FROM users u WHERE u.id = p_user_id);
  END IF;

  RETURN fn_landlord_contact_email(p_user_id, v_thread.listing_id, v_thread.lease_id);
END;
$function$;

-- ─── 3. grants ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.fn_landlord_contact_email(uuid, uuid, uuid)',
    'public.fn_chat_alert_email(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;
