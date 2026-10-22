-- Let landlords' review replies through the write-as-user RPC (Wyatt, 2026-10-22).
--
-- /api/replyReview inserts into listing_review_replies via rpc_insert_as_user,
-- but the table was never added to that function's allowlist. Every reply
-- raised "table not in allowlist" and the route answered "Server error", so no
-- reply has ever been saved. This recreates the function unchanged apart from
-- the one extra table.
--
-- Apply to BOTH dev and prod.

CREATE OR REPLACE FUNCTION public.rpc_insert_as_user(p_user_id uuid, p_table text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cols   text;
  v_sel    text;
  v_sql    text;
  v_result jsonb;
BEGIN
  IF p_table NOT IN (
    'listings','listing_amenities','listing_utilities','listing_units',
    'unit_leases','listing_images','listing_landlords','listing_reviews',
    'listing_review_replies','review_votes','user_listing_interactions','users'
  ) THEN
    RAISE EXCEPTION 'rpc_insert_as_user: table not in allowlist: %', p_table;
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  v_cols := (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(p_data) k);
  v_sel  := (SELECT string_agg('r.' || quote_ident(k), ', ') FROM jsonb_object_keys(p_data) k);

  v_sql := format(
    'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, $1) r RETURNING to_jsonb(%I.*)',
    p_table, v_cols, v_sel, p_table, p_table
  );
  EXECUTE v_sql USING p_data INTO v_result;
  RETURN v_result;
END;
$function$;
