-- Fix-up for 202605230002.
--
-- The previous migration's `CREATE OR REPLACE FUNCTION rpc_edit_listing(...)` used
-- the 8-arg signature from 202604240001, but the production/dev database had
-- already grown to a 10-arg version (with `p_leases` and `p_pet_policy`) that
-- was applied directly in Supabase Studio. CREATE OR REPLACE only replaces a
-- function with the exact same signature, so 202605230002 ended up *adding* a
-- second overload instead of replacing anything. That left PostgREST unable to
-- pick between the two when the app calls the function with 8 named args:
--   "Could not choose the best candidate function between ..."
--
-- This migration drops the obsolete 8-arg overload and reapplies the 10-arg
-- function with the `available` column threaded through the listing_units INSERT.

DROP FUNCTION IF EXISTS public.rpc_edit_listing(uuid, uuid, jsonb, jsonb, jsonb, text[], jsonb, text);

CREATE OR REPLACE FUNCTION public.rpc_edit_listing(
  p_user_id            uuid,
  p_listing_id         uuid,
  p_listing_updates    jsonb   DEFAULT NULL,
  p_amenities          jsonb   DEFAULT NULL,
  p_utilities          jsonb   DEFAULT NULL,
  p_images_keep        text[]  DEFAULT NULL,
  p_units              jsonb   DEFAULT NULL,
  p_lease_availability text    DEFAULT NULL,
  p_leases             jsonb   DEFAULT NULL,
  p_pet_policy         text    DEFAULT NULL
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
  v_lease   jsonb;
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

  IF p_images_keep IS NOT NULL THEN
    DELETE FROM listing_images
    WHERE listing_id = p_listing_id AND NOT (url = ANY(p_images_keep));
  END IF;

  IF p_units IS NOT NULL THEN
    DELETE FROM unit_leases
    WHERE unit_id IN (SELECT id FROM listing_units WHERE listing_id = p_listing_id);
    DELETE FROM listing_units WHERE listing_id = p_listing_id;

    FOR v_unit IN SELECT * FROM jsonb_array_elements(p_units) LOOP
      INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, available)
      VALUES (
        p_listing_id,
        NULLIF(v_unit->>'bedrooms',  '')::integer,
        NULLIF(v_unit->>'bathrooms', '')::numeric,
        NULLIF(v_unit->>'area',      '')::numeric,
        COALESCE((NULLIF(v_unit->>'available', ''))::boolean, true)
      )
      RETURNING id INTO v_unit_id;

      v_rent  := NULLIF(v_unit->>'rent', '')::numeric;
      v_avail := NULLIF(
        COALESCE(NULLIF(v_unit->>'leaseAvailability', ''), p_lease_availability), ''
      )::date;

      IF v_rent IS NOT NULL OR v_avail IS NOT NULL THEN
        INSERT INTO unit_leases (unit_id, rent, is_active, available_from)
        VALUES (v_unit_id, v_rent, true, v_avail);
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
$$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202605230003: 8-arg rpc_edit_listing dropped; 10-arg version now persists listing_units.available.';
END $$;
