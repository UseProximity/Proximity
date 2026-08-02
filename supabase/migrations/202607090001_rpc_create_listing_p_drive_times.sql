-- Add p_drive_times to rpc_create_listing (mirrors p_walk_times → listing_drive_times).

DROP FUNCTION IF EXISTS public.rpc_create_listing(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_create_listing(
  p_user_id uuid,
  p_listing_data jsonb,
  p_amenities jsonb DEFAULT '{}'::jsonb,
  p_utilities jsonb DEFAULT '{}'::jsonb,
  p_walk_times jsonb DEFAULT '[]'::jsonb,
  p_drive_times jsonb DEFAULT '[]'::jsonb,
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
  v_dt         jsonb;
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

  FOR v_dt IN SELECT * FROM jsonb_array_elements(p_drive_times) LOOP
    INSERT INTO listing_drive_times (listing_id, location_id, minutes)
    VALUES (
      v_listing_id,
      (v_dt->>'location_id')::uuid,
      (v_dt->>'minutes')::integer
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