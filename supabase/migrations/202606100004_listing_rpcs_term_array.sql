-- Update create/edit listing RPCs: unit_leases.lease_term_months is now integer[].
-- A unit's "leaseTermMonths" arrives as a JSON array of month counts; store the array
-- on the single per-unit lease row. listings.lease_availability is derived in the API
-- routes (from the union of unit term arrays) and passed through p_listing_data /
-- p_listing_updates as before.

CREATE OR REPLACE FUNCTION public.rpc_create_listing(
  p_user_id uuid,
  p_listing_data jsonb,
  p_amenities jsonb DEFAULT '{}'::jsonb,
  p_utilities jsonb DEFAULT '{}'::jsonb,
  p_walk_times jsonb DEFAULT '[]'::jsonb,
  p_units jsonb DEFAULT '[]'::jsonb,
  p_lease_availability text DEFAULT NULL::text,
  p_custom_amenities jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_listing_id uuid;
  v_unit       jsonb;
  v_unit_id    uuid;
  v_wt         jsonb;
  v_rent       numeric;
  v_avail      date;
  v_sublease   boolean;
  v_terms      integer[];
  v_amenity    jsonb;
  v_label      text;
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  INSERT INTO listings (
    title, address, longitude, latitude, description,
    lease_type, home_type_id, lease_structure,
    sublease_friendly, twenty_one_plus, furnished,
    move_in_date, contact_email, contact_phone, contact_name,
    lease_availability, unavailable, deleted_at
  )
  SELECT
    title, address, longitude, latitude, description,
    lease_type, home_type_id, lease_structure,
    sublease_friendly, twenty_one_plus, furnished,
    move_in_date, contact_email, contact_phone, contact_name,
    lease_availability, COALESCE(unavailable, false), deleted_at
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

  FOR v_amenity IN SELECT * FROM jsonb_array_elements(COALESCE(p_custom_amenities, '[]'::jsonb)) LOOP
    v_label := btrim(v_amenity #>> '{}');
    IF v_label IS NOT NULL AND v_label <> '' THEN
      INSERT INTO listing_custom_amenities (listing_id, label) VALUES (v_listing_id, v_label);
    END IF;
  END LOOP;

  FOR v_wt IN SELECT * FROM jsonb_array_elements(p_walk_times) LOOP
    INSERT INTO listing_walk_times (listing_id, location_id, minutes)
    VALUES (
      v_listing_id,
      (v_wt->>'location_id')::uuid,
      (v_wt->>'minutes')::integer
    );
  END LOOP;

  FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
    INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, available, title, floor_plan_image_url)
    VALUES (
      v_listing_id,
      NULLIF(v_unit->>'bedrooms',  '')::integer,
      NULLIF(v_unit->>'bathrooms', '')::numeric,
      NULLIF(v_unit->>'area',      '')::numeric,
      COALESCE((NULLIF(v_unit->>'available', ''))::boolean, true),
      NULLIF(btrim(v_unit->>'title'), ''),
      NULLIF(v_unit->>'floorPlanImageUrl', '')
    )
    RETURNING id INTO v_unit_id;

    v_rent  := NULLIF(v_unit->>'rent', '')::numeric;
    v_avail := NULLIF(
      COALESCE(NULLIF(v_unit->>'leaseAvailability', ''), p_lease_availability),
      ''
    )::date;
    v_sublease := COALESCE((v_unit->>'sublease')::boolean, false);
    v_terms := CASE
      WHEN jsonb_typeof(v_unit->'leaseTermMonths') = 'array'
           AND jsonb_array_length(v_unit->'leaseTermMonths') > 0
      THEN ARRAY(SELECT jsonb_array_elements_text(v_unit->'leaseTermMonths')::int)
      ELSE NULL
    END;

    IF v_rent IS NOT NULL OR v_avail IS NOT NULL OR v_sublease OR v_terms IS NOT NULL THEN
      INSERT INTO unit_leases (unit_id, rent, is_active, available_from, sublease, lease_term_months)
      VALUES (v_unit_id, v_rent, true, v_avail, v_sublease, v_terms);
    END IF;
  END LOOP;

  RETURN v_listing_id;
END;
$function$;


CREATE OR REPLACE FUNCTION public.rpc_edit_listing(
  p_user_id uuid,
  p_listing_id uuid,
  p_listing_updates jsonb DEFAULT NULL::jsonb,
  p_amenities jsonb DEFAULT NULL::jsonb,
  p_utilities jsonb DEFAULT NULL::jsonb,
  p_images_keep text[] DEFAULT NULL::text[],
  p_units jsonb DEFAULT NULL::jsonb,
  p_lease_availability text DEFAULT NULL::text,
  p_leases jsonb DEFAULT NULL::jsonb,
  p_pet_policy text DEFAULT NULL::text,
  p_custom_amenities jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_cols     text;
  v_sel      text;
  v_sql      text;
  v_unit     jsonb;
  v_unit_id  uuid;
  v_rent     numeric;
  v_avail    date;
  v_sublease boolean;
  v_terms    integer[];
  v_lease    jsonb;
  v_amenity  jsonb;
  v_label    text;
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
      air_conditioning = EXCLUDED.air_conditioning, dishwasher = EXCLUDED.dishwasher,
      gym = EXCLUDED.gym, laundry = EXCLUDED.laundry, mailroom = EXCLUDED.mailroom,
      microwave = EXCLUDED.microwave, oven = EXCLUDED.oven, parking = EXCLUDED.parking,
      pets_allowed = EXCLUDED.pets_allowed, pool = EXCLUDED.pool,
      refrigerator = EXCLUDED.refrigerator, rooftop = EXCLUDED.rooftop,
      storage = EXCLUDED.storage, stove = EXCLUDED.stove, study_room = EXCLUDED.study_room;
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
      electric = EXCLUDED.electric, gas = EXCLUDED.gas, heat = EXCLUDED.heat,
      water = EXCLUDED.water, internet = EXCLUDED.internet, trash = EXCLUDED.trash,
      cable = EXCLUDED.cable, sewer = EXCLUDED.sewer, cooling = EXCLUDED.cooling;
  END IF;

  IF p_custom_amenities IS NOT NULL THEN
    DELETE FROM listing_custom_amenities WHERE listing_id = p_listing_id;
    FOR v_amenity IN SELECT * FROM jsonb_array_elements(p_custom_amenities) LOOP
      v_label := btrim(v_amenity #>> '{}');
      IF v_label IS NOT NULL AND v_label <> '' THEN
        INSERT INTO listing_custom_amenities (listing_id, label) VALUES (p_listing_id, v_label);
      END IF;
    END LOOP;
  END IF;

  IF p_images_keep IS NOT NULL THEN
    DELETE FROM listing_images
    WHERE listing_id = p_listing_id AND NOT (url = ANY(p_images_keep));
  END IF;

  IF p_units IS NOT NULL THEN
    DELETE FROM unit_leases
    WHERE unit_id IN (SELECT id FROM listing_units WHERE listing_id = p_listing_id);
    DELETE FROM listing_units WHERE listing_id = p_listing_id;

    FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
      INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, available, title, floor_plan_image_url)
      VALUES (
        p_listing_id,
        NULLIF(v_unit->>'bedrooms',  '')::integer,
        NULLIF(v_unit->>'bathrooms', '')::numeric,
        NULLIF(v_unit->>'area',      '')::numeric,
        COALESCE((NULLIF(v_unit->>'available', ''))::boolean, true),
        NULLIF(btrim(v_unit->>'title'), ''),
        NULLIF(v_unit->>'floorPlanImageUrl', '')
      )
      RETURNING id INTO v_unit_id;

      v_rent  := NULLIF(v_unit->>'rent', '')::numeric;
      v_avail := NULLIF(
        COALESCE(NULLIF(v_unit->>'leaseAvailability', ''), p_lease_availability), ''
      )::date;
      v_sublease := COALESCE((v_unit->>'sublease')::boolean, false);
      v_terms := CASE
        WHEN jsonb_typeof(v_unit->'leaseTermMonths') = 'array'
             AND jsonb_array_length(v_unit->'leaseTermMonths') > 0
        THEN ARRAY(SELECT jsonb_array_elements_text(v_unit->'leaseTermMonths')::int)
        ELSE NULL
      END;

      IF v_rent IS NOT NULL OR v_avail IS NOT NULL OR v_sublease OR v_terms IS NOT NULL THEN
        INSERT INTO unit_leases (unit_id, rent, is_active, available_from, sublease, lease_term_months)
        VALUES (v_unit_id, v_rent, true, v_avail, v_sublease, v_terms);
      END IF;
    END LOOP;
  END IF;

  IF p_leases IS NOT NULL THEN
    DELETE FROM listing_leases WHERE listing_id = p_listing_id;

    FOR v_lease IN SELECT * FROM jsonb_array_elements(p_leases) LOOP
      INSERT INTO listing_leases (
        listing_id, bedrooms, bathrooms, area,
        pricing_basis, rent, beds_in_lease,
        lease_term_months, available_from,
        sublease, summer_only, semester_only,
        unit_group_label, is_active
      ) VALUES (
        p_listing_id,
        (v_lease->>'bedrooms')::integer,
        (v_lease->>'bathrooms')::numeric,
        NULLIF(v_lease->>'area', '')::numeric,
        COALESCE(NULLIF(v_lease->>'pricing_basis', ''), 'per_unit'),
        COALESCE(NULLIF(v_lease->>'rent', '')::numeric, 0),
        NULLIF(v_lease->>'beds_in_lease', '')::integer,
        COALESCE(NULLIF(v_lease->>'lease_term_months', '')::integer, 12),
        NULLIF(v_lease->>'available_from', '')::date,
        COALESCE((v_lease->>'sublease')::boolean, false),
        COALESCE((v_lease->>'summer_only')::boolean, false),
        COALESCE((v_lease->>'semester_only')::boolean, false),
        NULLIF(v_lease->>'unit_group_label', ''),
        true
      );
    END LOOP;
  END IF;

  IF p_pet_policy IS NOT NULL THEN
    INSERT INTO listing_pet_policies (listing_id, policy_text)
    VALUES (p_listing_id, p_pet_policy)
    ON CONFLICT (listing_id) DO UPDATE SET policy_text = EXCLUDED.policy_text;
  END IF;
END;
$function$;
