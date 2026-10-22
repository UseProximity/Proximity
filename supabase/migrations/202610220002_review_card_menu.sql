-- Edit, delete and report on review cards and landlord replies (Wyatt, 2026-10-22).
--
-- 1. edited_at on listing_reviews and listing_review_replies. Set only by the
--    edit endpoints, so the "Edited" label is not tripped by other writes that
--    bump updated_at (confirmation emails, review claims, anonymizing).
-- 2. listing_review_replies joins the update and delete allowlists of the
--    write-as-user RPCs. Replies are hard-deleted (review_id is unique, so a
--    soft-deleted reply would stop the landlord ever replying again); the new
--    action_log trigger keeps a copy of what was removed.
-- 3. review_reply_reports: the reply version of review_reports. Same shape and
--    same rules: one row per reporter per reply, RLS on with NO policies
--    (service-role only), purged with the reporter's account.
--
-- Apply to BOTH dev and prod.

ALTER TABLE public.listing_reviews
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE public.listing_review_replies
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

DROP TRIGGER IF EXISTS trg_action_log_listing_review_replies ON public.listing_review_replies;
CREATE TRIGGER trg_action_log_listing_review_replies
  AFTER INSERT OR DELETE OR UPDATE ON public.listing_review_replies
  FOR EACH ROW EXECUTE FUNCTION fn_action_log();

CREATE TABLE IF NOT EXISTS public.review_reply_reports (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reply_id         uuid        NOT NULL REFERENCES public.listing_review_replies(id) ON DELETE CASCADE,
  reported_user_id uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_reply_reports_once UNIQUE (reporter_id, reply_id)
);

CREATE INDEX IF NOT EXISTS review_reply_reports_reply_id_idx
  ON public.review_reply_reports (reply_id);

ALTER TABLE public.review_reply_reports ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rpc_update_as_user(p_user_id uuid, p_table text, p_data jsonb, p_row_id uuid DEFAULT NULL::uuid, p_match jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cols        text;
  v_sel         text;
  v_where_parts text[];
  v_key         text;
  v_sql         text;
  v_result      jsonb;
BEGIN
  IF p_table NOT IN (
    'listings','listing_amenities','listing_utilities','listing_units',
    'unit_leases','listing_images','listing_landlords','listing_reviews',
    'listing_review_replies','review_votes','user_listing_interactions','users'
  ) THEN
    RAISE EXCEPTION 'rpc_update_as_user: table not in allowlist: %', p_table;
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  v_cols := (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(p_data) k);
  v_sel  := (SELECT string_agg('r.' || quote_ident(k), ', ') FROM jsonb_object_keys(p_data) k);

  IF p_row_id IS NOT NULL THEN
    v_sql := format(
      'UPDATE %I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::%I, $1) r) WHERE t.id = $2 RETURNING to_jsonb(t.*)',
      p_table, v_cols, v_sel, p_table
    );
    EXECUTE v_sql USING p_data, p_row_id INTO v_result;

  ELSIF p_match IS NOT NULL THEN
    v_where_parts := ARRAY[]::text[];
    FOR v_key IN SELECT jsonb_object_keys(p_match) LOOP
      v_where_parts := array_append(v_where_parts,
        format('t.%I = (SELECT %I FROM jsonb_populate_record(NULL::%I, $2) r)',
               v_key, v_key, p_table));
    END LOOP;
    v_sql := format(
      'UPDATE %I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::%I, $1) r) WHERE %s RETURNING to_jsonb(t.*)',
      p_table, v_cols, v_sel, p_table, array_to_string(v_where_parts, ' AND ')
    );
    EXECUTE v_sql USING p_data, p_match INTO v_result;

  ELSE
    RAISE EXCEPTION 'rpc_update_as_user: must supply p_row_id or p_match';
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_delete_as_user(p_user_id uuid, p_table text, p_row_id uuid DEFAULT NULL::uuid, p_match jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_where_parts text[];
  v_key         text;
  v_sql         text;
  v_result      jsonb;
BEGIN
  IF p_table NOT IN (
    'listings','listing_amenities','listing_utilities','listing_units',
    'unit_leases','listing_images','listing_landlords','listing_reviews',
    'listing_review_replies','review_votes','user_listing_interactions','users'
  ) THEN
    RAISE EXCEPTION 'rpc_delete_as_user: table not in allowlist: %', p_table;
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  IF p_row_id IS NOT NULL THEN
    v_sql := format(
      'DELETE FROM %I WHERE id = $1 RETURNING to_jsonb(%I.*)',
      p_table, p_table
    );
    EXECUTE v_sql USING p_row_id INTO v_result;

  ELSIF p_match IS NOT NULL THEN
    v_where_parts := ARRAY[]::text[];
    FOR v_key IN SELECT jsonb_object_keys(p_match) LOOP
      v_where_parts := array_append(v_where_parts,
        format('%I = (SELECT %I FROM jsonb_populate_record(NULL::%I, $1) r)',
               v_key, v_key, p_table));
    END LOOP;
    v_sql := format(
      'DELETE FROM %I WHERE %s RETURNING to_jsonb(%I.*)',
      p_table, array_to_string(v_where_parts, ' AND '), p_table
    );
    EXECUTE v_sql USING p_match INTO v_result;

  ELSE
    RAISE EXCEPTION 'rpc_delete_as_user: must supply p_row_id or p_match';
  END IF;

  RETURN v_result;
END;
$function$;
