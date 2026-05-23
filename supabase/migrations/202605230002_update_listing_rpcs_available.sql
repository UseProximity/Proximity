-- Recreate rpc_edit_listing and rpc_create_listing so the unit INSERTs carry
-- listing_units.available (added in 202605230001). Falls back to true when the
-- payload omits the key, so older clients keep working.

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

  IF p_listing_updates IS NOT NULL AND p_listing_updates <> '{}'::jsonb THEN
    v_cols := (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(p_listing_updates) k);
    v_sel  := (SELECT string_agg('r.' || quote_ident(k), ', ') FROM jsonb_object_keys(p_listing_updates) k);
    v_sql  := format(
      'UPDATE listings t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::listings, $1) r) WHERE t.id = $2',
      v_cols, v_sel
    );
    EXECUTE v_sql USING p_listing_updates, p_listing_id;
  END IF;

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

  IF p_images_keep IS NOT NULL THEN
    DELETE FROM listing_images
    WHERE listing_id = p_listing_id
      AND NOT (url = ANY(p_images_keep));
  END IF;

  IF p_units IS NOT NULL THEN
    DELETE FROM unit_leases
    WHERE unit_id IN (SELECT id FROM listing_units WHERE listing_id = p_listing_id);
    DELETE FROM listing_units WHERE listing_id = p_listing_id;

    FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
      INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, available)
      VALUES (
        p_listing_id,
        NULLIF(v_unit->>'bedrooms',   '')::integer,
        NULLIF(v_unit->>'bathrooms',  '')::numeric,
        NULLIF(v_unit->>'area',       '')::numeric,
        COALESCE((NULLIF(v_unit->>'available', ''))::boolean, true)
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

  IF p_user_id IS NOT NULL THEN
    INSERT INTO listing_landlords (listing_id, user_id, is_primary)
    VALUES (v_listing_id, p_user_id, true);
  END IF;

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

  FOR v_wt IN SELECT * FROM jsonb_array_elements(p_walk_times) LOOP
    INSERT INTO listing_walk_times (listing_id, location_id, minutes)
    VALUES (
      v_listing_id,
      (v_wt->>'location_id')::uuid,
      (v_wt->>'minutes')::integer
    );
  END LOOP;

  FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
    INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, available)
    VALUES (
      v_listing_id,
      NULLIF(v_unit->>'bedrooms',  '')::integer,
      NULLIF(v_unit->>'bathrooms', '')::numeric,
      NULLIF(v_unit->>'area',      '')::numeric,
      COALESCE((NULLIF(v_unit->>'available', ''))::boolean, true)
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
  RAISE NOTICE 'Migration 202605230002: rpc_edit_listing and rpc_create_listing now persist listing_units.available.';
END $$;
