-- rpc_create_listing and rpc_edit_listing write listing_units.name, not title.
--
-- Follows 202610090001_listing_units_name.sql, which made listing_units.name
-- the one place a unit's name lives and retired title. Both functions still
-- inserted and updated title from the payload's 'title' key, and the edit
-- function's no-id fallback matched units on title.
--
-- Each unit now reads the payload's 'name' key, falling back to 'title' so a
-- caller written against the old key still names its units. No app caller
-- passes named units today (addListing and reviewReferral send p_units = [],
-- the landlord PATCH sends p_units = NULL), so this keeps the functions honest
-- rather than changing current behaviour.
--
-- Rewritten in place from the live definitions, with each replacement
-- asserted, so nothing else in these long functions can drift. Idempotent:
-- a second run finds nothing left to replace and passes the same checks.
--
-- Apply to BOTH dev and prod.

DO $migration$
DECLARE
  v_def  text;
  v_name constant text := $$NULLIF(btrim(COALESCE(v_unit->>'name', v_unit->>'title')), '')$$;
BEGIN
  -- rpc_create_listing ------------------------------------------------------
  v_def := pg_get_functiondef('public.rpc_create_listing'::regproc);
  v_def := replace(v_def,
    'INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, title, floor_plan_image_url)',
    'INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, name, floor_plan_image_url)');
  v_def := replace(v_def, $$NULLIF(btrim(v_unit->>'title'), '')$$, v_name);
  IF v_def LIKE '%area, title, floor_plan_image_url%'
     OR v_def LIKE $$%btrim(v_unit->>'title')%$$ THEN
    RAISE EXCEPTION 'rpc_create_listing: unit title still written after rewrite';
  END IF;
  EXECUTE v_def;

  -- rpc_edit_listing --------------------------------------------------------
  v_def := pg_get_functiondef('public.rpc_edit_listing'::regproc);
  v_def := replace(v_def,
    $$AND COALESCE(btrim(title), '') = COALESCE(NULLIF(btrim(v_unit->>'title'), ''), '')$$,
    'AND COALESCE(btrim(name), '''') = COALESCE(' || v_name || ', '''')');
  v_def := replace(v_def,
    $$title                = NULLIF(btrim(v_unit->>'title'), ''),$$,
    'name                 = ' || v_name || ',');
  v_def := replace(v_def,
    'INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, title, floor_plan_image_url)',
    'INSERT INTO listing_units (listing_id, bedrooms, bathrooms, area, name, floor_plan_image_url)');
  v_def := replace(v_def, $$NULLIF(btrim(v_unit->>'title'), '')$$, v_name);
  IF v_def LIKE '%area, title, floor_plan_image_url%'
     OR v_def LIKE $$%btrim(v_unit->>'title')%$$
     OR v_def LIKE '%btrim(title)%'
     OR v_def ~ '\mtitle\s+= ' THEN
    RAISE EXCEPTION 'rpc_edit_listing: unit title still read or written after rewrite';
  END IF;
  EXECUTE v_def;
END
$migration$;
