-- Close the anon-key read paths to the audit trail and to reviewer identities.
--
-- action_log: fn_action_log copies whole OLD/NEW rows of every audited table,
-- users and pms_connections included, so the log held password hashes, token
-- columns and encrypted PMS credentials. No migration ever enabled RLS on it
-- (dev has it on from a manual change, prod is unknown), and the anon role
-- keeps Supabase's default SELECT grant. Anyone with the public anon key could
-- read every user's reset token straight out of the log.
--
-- listing_reviews / dorm_reviews: the public SELECT policies return every
-- column, including reviewer_email and the user_id behind reviews posted as
-- anonymous, which the app deliberately hides.
--
-- The app reads all three only with the service role (which bypasses RLS and
-- grants), and the browser's anon client only subscribes to chat tables over
-- Realtime, so the anon and authenticated roles lose access outright.
--
-- fn_action_log now drops the secret columns before writing, and existing log
-- rows are scrubbed of them. The function keeps SECURITY DEFINER (it must
-- write action_log whatever the caller) and gets a pinned search_path, as the
-- project convention requires on any CREATE OR REPLACE of a definer function.
--
-- Idempotent. Apply to BOTH dev and prod.

ALTER TABLE action_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.action_log FROM anon, authenticated;

REVOKE ALL ON public.listing_reviews FROM anon, authenticated;
REVOKE ALL ON public.dorm_reviews FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_action_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_changed_by_id     uuid;
  v_changed_by_source text;
  v_old_data          jsonb;
  v_new_data          jsonb;
  v_changed_fields    jsonb := '{}'::jsonb;
  v_key               text;
  v_old_val           jsonb;
  v_new_val           jsonb;
  v_record_id         uuid;
  v_pk_col            text;
  -- Never copied into the log. Keep in step with
  -- apps/web/src/lib/security/secretColumns.js.
  v_secret_cols       text[] := ARRAY[
    'password_hash',
    'password_reset_token', 'password_reset_expires_at',
    'email_verification_token', 'email_verification_expires_at',
    'profile_setup_token', 'profile_setup_link_hash', 'profile_setup_expires_at',
    'apple_refresh_token', 'token_hash', 'reply_token_hash',
    'cred_ciphertext', 'cred_iv', 'cred_tag', 'cred_key_version', 'cred_fingerprint'
  ];
BEGIN
  IF TG_TABLE_NAME = 'action_log' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_changed_by_id := current_setting('app.current_user_id', true)::uuid;
    IF v_changed_by_id IS NULL THEN
      RAISE EXCEPTION 'fallback';
    END IF;
    v_changed_by_source := 'user';
  EXCEPTION WHEN OTHERS THEN
    CASE current_setting('application_name', true)
      WHEN 'migration' THEN
        v_changed_by_id     := '00000000-0000-0000-0000-000000000002';
        v_changed_by_source := 'migration';
      WHEN 'trigger' THEN
        v_changed_by_id     := '00000000-0000-0000-0000-000000000003';
        v_changed_by_source := 'trigger';
      ELSE
        v_changed_by_id     := '00000000-0000-0000-0000-000000000001';
        v_changed_by_source := 'system';
    END CASE;
  END;

  -- Primary key is looked up from the full row, before secrets are dropped.
  SELECT a.attname INTO v_pk_col
  FROM pg_index i
  JOIN pg_attribute a
    ON a.attrelid = i.indrelid
   AND a.attnum   = i.indkey[0]
  WHERE i.indrelid = TG_RELID
    AND i.indisprimary;

  IF v_pk_col IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old_data := to_jsonb(OLD) - v_secret_cols;
  ELSIF TG_OP = 'INSERT' THEN
    v_new_data := to_jsonb(NEW) - v_secret_cols;
  ELSE
    v_old_data := to_jsonb(OLD) - v_secret_cols;
    v_new_data := to_jsonb(NEW) - v_secret_cols;
    FOR v_key IN SELECT jsonb_object_keys(v_new_data) LOOP
      v_old_val := v_old_data -> v_key;
      v_new_val := v_new_data -> v_key;
      IF v_old_val IS DISTINCT FROM v_new_val THEN
        v_changed_fields := v_changed_fields || jsonb_build_object(
          v_key, jsonb_build_object('old', v_old_val, 'new', v_new_val)
        );
      END IF;
    END LOOP;
    -- An update that only touched secret columns leaves nothing to record.
    IF v_changed_fields = '{}'::jsonb THEN
      RETURN NULL;
    END IF;
  END IF;

  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_record_id := (to_jsonb(OLD)->>v_pk_col)::uuid;
    ELSE
      v_record_id := (to_jsonb(NEW)->>v_pk_col)::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF v_record_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO action_log (
    table_name, record_id, event_type,
    changed_by_id, changed_by_source,
    old_data, new_data, changed_fields
  ) VALUES (
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    v_changed_by_id,
    v_changed_by_source,
    v_old_data,
    v_new_data,
    CASE TG_OP WHEN 'UPDATE' THEN v_changed_fields ELSE NULL END
  );

  RETURN NULL;
END;
$function$;

-- Scrub what the old function already wrote.
UPDATE action_log
   SET old_data       = old_data - ARRAY[
         'password_hash', 'password_reset_token', 'password_reset_expires_at',
         'email_verification_token', 'email_verification_expires_at',
         'profile_setup_token', 'profile_setup_link_hash', 'profile_setup_expires_at',
         'apple_refresh_token', 'token_hash', 'reply_token_hash',
         'cred_ciphertext', 'cred_iv', 'cred_tag', 'cred_key_version', 'cred_fingerprint'],
       new_data       = new_data - ARRAY[
         'password_hash', 'password_reset_token', 'password_reset_expires_at',
         'email_verification_token', 'email_verification_expires_at',
         'profile_setup_token', 'profile_setup_link_hash', 'profile_setup_expires_at',
         'apple_refresh_token', 'token_hash', 'reply_token_hash',
         'cred_ciphertext', 'cred_iv', 'cred_tag', 'cred_key_version', 'cred_fingerprint'],
       changed_fields = changed_fields - ARRAY[
         'password_hash', 'password_reset_token', 'password_reset_expires_at',
         'email_verification_token', 'email_verification_expires_at',
         'profile_setup_token', 'profile_setup_link_hash', 'profile_setup_expires_at',
         'apple_refresh_token', 'token_hash', 'reply_token_hash',
         'cred_ciphertext', 'cred_iv', 'cred_tag', 'cred_key_version', 'cred_fingerprint']
 WHERE old_data ?| ARRAY[
         'password_hash', 'password_reset_token', 'email_verification_token',
         'profile_setup_token', 'apple_refresh_token', 'token_hash', 'reply_token_hash',
         'cred_ciphertext']
    OR new_data ?| ARRAY[
         'password_hash', 'password_reset_token', 'email_verification_token',
         'profile_setup_token', 'apple_refresh_token', 'token_hash', 'reply_token_hash',
         'cred_ciphertext'];
