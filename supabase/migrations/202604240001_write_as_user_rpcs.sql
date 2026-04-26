-- Generic and dedicated RPC functions that bundle set_config('app.current_user_id')
-- with the write in the same PL/pgSQL function call (= same transaction).
-- This makes fn_action_log() attribute changes to the authenticated user rather
-- than the reserved system sentinel UUID.
--
-- Only tables in the allowlist constant below can be targeted by the generic RPCs.

-- ============================================================
-- 1. rpc_insert_as_user  — single-row INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_insert_as_user(
  p_user_id uuid,
  p_table   text,
  p_data    jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cols   text;
  v_sel    text;
  v_sql    text;
  v_result jsonb;
BEGIN
  IF p_table NOT IN (
    'listings','listing_amenities','listing_utilities','listing_units',
    'unit_leases','listing_images','listing_landlords','listing_reviews',
    'review_votes','user_listing_interactions','users'
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
$$;

-- ============================================================
-- 2. rpc_insert_batch_as_user  — multi-row INSERT (all rows same columns)
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_insert_batch_as_user(
  p_user_id uuid,
  p_table   text,
  p_rows    jsonb   -- JSON array: [{col: val, ...}, ...]
) RETURNS jsonb    -- JSON array of inserted rows
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_first   jsonb;
  v_row     jsonb;
  v_cols    text;
  v_sel     text;
  v_sql     text;
  v_one     jsonb;
  v_results jsonb[] := '{}';
BEGIN
  IF p_table NOT IN (
    'listings','listing_amenities','listing_utilities','listing_units',
    'unit_leases','listing_images','listing_landlords','listing_reviews',
    'review_votes','user_listing_interactions','users'
  ) THEN
    RAISE EXCEPTION 'rpc_insert_batch_as_user: table not in allowlist: %', p_table;
  END IF;

  SELECT r INTO v_first FROM jsonb_array_elements(p_rows) r LIMIT 1;
  IF v_first IS NULL THEN RETURN '[]'::jsonb; END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  v_cols := (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(v_first) k);
  v_sel  := (SELECT string_agg('r.' || quote_ident(k), ', ') FROM jsonb_object_keys(v_first) k);

  v_sql := format(
    'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, $1) r RETURNING to_jsonb(%I.*)',
    p_table, v_cols, v_sel, p_table, p_table
  );

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    EXECUTE v_sql USING v_row INTO v_one;
    v_results := array_append(v_results, v_one);
  END LOOP;

  RETURN to_jsonb(v_results);
END;
$$;

-- ============================================================
-- 3. rpc_update_as_user  — UPDATE by row id OR by match object
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_update_as_user(
  p_user_id uuid,
  p_table   text,
  p_data    jsonb,
  p_row_id  uuid   DEFAULT NULL,
  p_match   jsonb  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    'review_votes','user_listing_interactions','users'
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
$$;

-- ============================================================
-- 4. rpc_delete_as_user  — DELETE by row id OR by match object
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_delete_as_user(
  p_user_id uuid,
  p_table   text,
  p_row_id  uuid   DEFAULT NULL,
  p_match   jsonb  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_where_parts text[];
  v_key         text;
  v_sql         text;
  v_result      jsonb;
BEGIN
  IF p_table NOT IN (
    'listings','listing_amenities','listing_utilities','listing_units',
    'unit_leases','listing_images','listing_landlords','listing_reviews',
    'review_votes','user_listing_interactions','users'
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
$$;

-- ============================================================
-- 5. rpc_upsert_as_user  — INSERT … ON CONFLICT (…) DO UPDATE / DO NOTHING
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_upsert_as_user(
  p_user_id          uuid,
  p_table            text,
  p_data             jsonb,
  p_conflict_cols    text[]  DEFAULT ARRAY['id'],
  p_ignore_conflicts boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cols           text;
  v_sel            text;
  v_conflict_clause text;
  v_conflict_act   text;
  v_update_parts   text;
  v_sql            text;
  v_result         jsonb;
BEGIN
  IF p_table NOT IN (
    'listings','listing_amenities','listing_utilities','listing_units',
    'unit_leases','listing_images','listing_landlords','listing_reviews',
    'review_votes','user_listing_interactions','users'
  ) THEN
    RAISE EXCEPTION 'rpc_upsert_as_user: table not in allowlist: %', p_table;
  END IF;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  v_cols := (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(p_data) k);
  v_sel  := (SELECT string_agg('r.' || quote_ident(k), ', ') FROM jsonb_object_keys(p_data) k);

  v_conflict_clause := (
    SELECT string_agg(quote_ident(c), ', ') FROM unnest(p_conflict_cols) c
  );

  IF p_ignore_conflicts THEN
    v_conflict_act := 'DO NOTHING';
  ELSE
    v_update_parts := (
      SELECT string_agg(format('%I = EXCLUDED.%I', k, k), ', ')
      FROM jsonb_object_keys(p_data) k
      WHERE NOT (k = ANY(p_conflict_cols))
    );
    v_conflict_act := CASE
      WHEN v_update_parts IS NOT NULL THEN 'DO UPDATE SET ' || v_update_parts
      ELSE 'DO NOTHING'
    END;
  END IF;

  v_sql := format(
    'INSERT INTO %I (%s) SELECT %s FROM jsonb_populate_record(NULL::%I, $1) r ON CONFLICT (%s) %s RETURNING to_jsonb(%I.*)',
    p_table, v_cols, v_sel, p_table, v_conflict_clause, v_conflict_act, p_table
  );
  EXECUTE v_sql USING p_data INTO v_result;
  RETURN v_result;
END;
$$;

-- ============================================================
-- 6. rpc_edit_listing  — full listing PATCH in one transaction
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_edit_listing(
  p_user_id            uuid,
  p_listing_id         uuid,
  p_listing_updates    jsonb   DEFAULT NULL,
  p_amenities          jsonb   DEFAULT NULL,
  p_utilities          jsonb   DEFAULT NULL,
  p_images_keep        text[]  DEFAULT NULL,
  p_units              jsonb   DEFAULT NULL,
  p_lease_availability text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cols    text;
  v_sel     text;
  v_sql     text;
  v_unit    jsonb;
  v_unit_id uuid;
  v_rent    numeric;
  v_avail   date;
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Update scalar listing fields (only the keys present in the object)
  IF p_listing_updates IS NOT NULL AND p_listing_updates <> '{}'::jsonb THEN
    v_cols := (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(p_listing_updates) k);
    v_sel  := (SELECT string_agg('r.' || quote_ident(k), ', ') FROM jsonb_object_keys(p_listing_updates) k);
    v_sql  := format(
      'UPDATE listings t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::listings, $1) r) WHERE t.id = $2',
      v_cols, v_sel
    );
    EXECUTE v_sql USING p_listing_updates, p_listing_id;
  END IF;

  -- Upsert amenities row
  IF p_amenities IS NOT NULL THEN
    INSERT INTO listing_amenities (
      listing_id, air_conditioning, dishwasher, gym, laundry, mailroom,
      microwave, oven, parking, pets_allowed, pool, refrigerator, rooftop,
      storage, stove, study_room
    ) VALUES (
      p_listing_id,
      COALESCE((p_amenities->>'air_conditioning')::boolean, false),
      COALESCE((p_amenities->>'dishwasher')::boolean,       false),
      COALESCE((p_amenities->>'gym')::boolean,              false),
      COALESCE((p_amenities->>'laundry')::boolean,          false),
      COALESCE((p_amenities->>'mailroom')::boolean,         false),
      COALESCE((p_amenities->>'microwave')::boolean,        false),
      COALESCE((p_amenities->>'oven')::boolean,             false),
      COALESCE((p_amenities->>'parking')::boolean,          false),
      COALESCE((p_amenities->>'pets_allowed')::boolean,     false),
      COALESCE((p_amenities->>'pool')::boolean,             false),
      COALESCE((p_amenities->>'refrigerator')::boolean,     false),
      COALESCE((p_amenities->>'rooftop')::boolean,          false),
      COALESCE((p_amenities->>'storage')::boolean,          false),
      COALESCE((p_amenities->>'stove')::boolean,            false),
      COALESCE((p_amenities->>'study_room')::boolean,       false)
    )
    ON CONFLICT (listing_id) DO UPDATE SET
      air_conditioning = EXCLUDED.air_conditioning,
      dishwasher       = EXCLUDED.dishwasher,
      gym              = EXCLUDED.gym,
      laundry          = EXCLUDED.laundry,
      mailroom         = EXCLUDED.mailroom,
      microwave        = EXCLUDED.microwave,
      oven             = EXCLUDED.oven,
      parking          = EXCLUDED.parking,
      pets_allowed     = EXCLUDED.pets_allowed,
      pool             = EXCLUDED.pool,
      refrigerator     = EXCLUDED.refrigerator,
      rooftop          = EXCLUDED.rooftop,
      storage          = EXCLUDED.storage,
      stove            = EXCLUDED.stove,
      study_room       = EXCLUDED.study_room;
  END IF;

  -- Upsert utilities row
  IF p_utilities IS NOT NULL THEN
    INSERT INTO listing_utilities (
      listing_id, electric, gas, heat, water, internet, trash, cable, sewer, cooling
    ) VALUES (
      p_listing_id,
      COALESCE((p_utilities->>'electric')::boolean, false),
      COALESCE((p_utilities->>'gas')::boolean,      false),
      COALESCE((p_utilities->>'heat')::boolean,     false),
      COALESCE((p_utilities->>'water')::boolean,    false),
      COALESCE((p_utilities->>'internet')::boolean, false),
      COALESCE((p_utilities->>'trash')::boolean,    false),
      COALESCE((p_utilities->>'cable')::boolean,    false),
      COALESCE((p_utilities->>'sewer')::boolean,    false),
      COALESCE((p_utilities->>'cooling')::boolean,  false)
    )
    ON CONFLICT (listing_id) DO UPDATE SET
      electric = EXCLUDED.electric,
      gas      = EXCLUDED.gas,
      heat     = EXCLUDED.heat,
      water    = EXCLUDED.water,
      internet = EXCLUDED.internet,
      trash    = EXCLUDED.trash,
      cable    = EXCLUDED.cable,
      sewer    = EXCLUDED.sewer,
      cooling  = EXCLUDED.cooling;
  END IF;

  -- Delete images not in the keep list
  IF p_images_keep IS NOT NULL THEN
    DELETE FROM listing_images
    WHERE listing_id = p_listing_id
      AND NOT (url = ANY(p_images_keep));
  END IF;

  -- Replace units and leases
  IF p_units IS NOT NULL THEN
    DELETE FROM unit_leases
    WHERE unit_id IN (SELECT id FROM listing_units WHERE listing_id = p_listing_id);
    DELETE FROM listing_units WHERE listing_id = p_listing_id;

    FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
      INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area)
      VALUES (
        p_listing_id,
        NULLIF(v_unit->>'bedrooms',   '')::integer,
        NULLIF(v_unit->>'bathrooms',  '')::numeric,
        NULLIF(v_unit->>'area',       '')::numeric
      )
      RETURNING id INTO v_unit_id;

      v_rent  := NULLIF(v_unit->>'rent', '')::numeric;
      v_avail := NULLIF(
        COALESCE(NULLIF(v_unit->>'leaseAvailability', ''), p_lease_availability),
        ''
      )::date;

      IF v_rent IS NOT NULL OR v_avail IS NOT NULL THEN
        INSERT INTO unit_leases (unit_id, rent, is_active, available_from)
        VALUES (v_unit_id, v_rent, true, v_avail);
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- ============================================================
-- 7. rpc_create_listing  — full listing creation in one transaction
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_create_listing(
  p_user_id            uuid,
  p_listing_data       jsonb,
  p_amenities          jsonb   DEFAULT '{}',
  p_utilities          jsonb   DEFAULT '{}',
  p_walk_times         jsonb   DEFAULT '[]',
  p_units              jsonb   DEFAULT '[]',
  p_lease_availability text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_listing_id uuid;
  v_unit       jsonb;
  v_unit_id    uuid;
  v_wt         jsonb;
  v_rent       numeric;
  v_avail      date;
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Insert main listing row (only columns present in p_listing_data)
  INSERT INTO listings (
    title, address, longitude, latitude, description,
    lease_type, home_type_id, lease_structure,
    sublease_friendly, twenty_one_plus, furnished,
    move_in_date, contact_email, contact_phone, contact_name,
    unavailable, deleted_at
  )
  SELECT
    title, address, longitude, latitude, description,
    lease_type, home_type_id, lease_structure,
    sublease_friendly, twenty_one_plus, furnished,
    move_in_date, contact_email, contact_phone, contact_name,
    COALESCE(unavailable, false), deleted_at
  FROM jsonb_populate_record(NULL::listings, p_listing_data)
  RETURNING id INTO v_listing_id;

  -- Attach listing owner
  IF p_user_id IS NOT NULL THEN
    INSERT INTO listing_landlords (listing_id, user_id, is_primary)
    VALUES (v_listing_id, p_user_id, true);
  END IF;

  -- Insert amenities row
  INSERT INTO listing_amenities (
    listing_id, air_conditioning, dishwasher, gym, laundry, mailroom,
    microwave, oven, parking, pets_allowed, pool, refrigerator, rooftop,
    storage, stove, study_room
  ) VALUES (
    v_listing_id,
    COALESCE((p_amenities->>'air_conditioning')::boolean, false),
    COALESCE((p_amenities->>'dishwasher')::boolean,       false),
    COALESCE((p_amenities->>'gym')::boolean,              false),
    COALESCE((p_amenities->>'laundry')::boolean,          false),
    COALESCE((p_amenities->>'mailroom')::boolean,         false),
    COALESCE((p_amenities->>'microwave')::boolean,        false),
    COALESCE((p_amenities->>'oven')::boolean,             false),
    COALESCE((p_amenities->>'parking')::boolean,          false),
    COALESCE((p_amenities->>'pets_allowed')::boolean,     false),
    COALESCE((p_amenities->>'pool')::boolean,             false),
    COALESCE((p_amenities->>'refrigerator')::boolean,     false),
    COALESCE((p_amenities->>'rooftop')::boolean,          false),
    COALESCE((p_amenities->>'storage')::boolean,          false),
    COALESCE((p_amenities->>'stove')::boolean,            false),
    COALESCE((p_amenities->>'study_room')::boolean,       false)
  );

  -- Insert utilities row
  INSERT INTO listing_utilities (
    listing_id, electric, gas, heat, water, internet, trash, cable, sewer, cooling
  ) VALUES (
    v_listing_id,
    COALESCE((p_utilities->>'electric')::boolean, false),
    COALESCE((p_utilities->>'gas')::boolean,      false),
    COALESCE((p_utilities->>'heat')::boolean,     false),
    COALESCE((p_utilities->>'water')::boolean,    false),
    COALESCE((p_utilities->>'internet')::boolean, false),
    COALESCE((p_utilities->>'trash')::boolean,    false),
    COALESCE((p_utilities->>'cable')::boolean,    false),
    COALESCE((p_utilities->>'sewer')::boolean,    false),
    COALESCE((p_utilities->>'cooling')::boolean,  false)
  );

  -- Insert walk times
  FOR v_wt IN SELECT * FROM jsonb_array_elements(p_walk_times) LOOP
    INSERT INTO listing_walk_times (listing_id, location_id, minutes)
    VALUES (
      v_listing_id,
      (v_wt->>'location_id')::uuid,
      (v_wt->>'minutes')::integer
    );
  END LOOP;

  -- Insert units and leases
  FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
    INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area)
    VALUES (
      v_listing_id,
      NULLIF(v_unit->>'bedrooms',  '')::integer,
      NULLIF(v_unit->>'bathrooms', '')::numeric,
      NULLIF(v_unit->>'area',      '')::numeric
    )
    RETURNING id INTO v_unit_id;

    v_rent  := NULLIF(v_unit->>'rent', '')::numeric;
    v_avail := NULLIF(
      COALESCE(NULLIF(v_unit->>'leaseAvailability', ''), p_lease_availability),
      ''
    )::date;

    IF v_rent IS NOT NULL OR v_avail IS NOT NULL THEN
      INSERT INTO unit_leases (unit_id, rent, is_active, available_from)
      VALUES (v_unit_id, v_rent, true, v_avail);
    END IF;
  END LOOP;

  RETURN v_listing_id;
END;
$$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202604240001: write-as-user RPC functions created (insert, insert_batch, update, delete, upsert, edit_listing, create_listing).';
END $$;
