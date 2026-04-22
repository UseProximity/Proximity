-- sync_listing_aggregates() still referenced listing_units.rent, which was dropped in 0025.
-- Every INSERT/UPDATE/DELETE on listing_units (including the listing-edit PATCH that replaces units)
-- threw: column lu.rent does not exist.
--
-- Fix: compute min/max rent from unit_leases (where rent now lives) joined on listing_units.
-- Restrict to active leases. bedrooms/bathrooms/area still come from listing_units.
-- Also attach the trigger to unit_leases so rent edits flow through to listings.min_rent/max_rent.

CREATE OR REPLACE FUNCTION sync_listing_aggregates()
RETURNS TRIGGER AS $$
DECLARE
  v_listing_id uuid;
BEGIN
  -- Resolve the affected listing based on which table triggered us.
  IF TG_TABLE_NAME = 'listing_units' THEN
    v_listing_id := CASE TG_OP WHEN 'DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
  ELSIF TG_TABLE_NAME = 'unit_leases' THEN
    SELECT lu.listing_id INTO v_listing_id
    FROM listing_units lu
    WHERE lu.id = CASE TG_OP WHEN 'DELETE' THEN OLD.unit_id ELSE NEW.unit_id END;
  END IF;

  IF v_listing_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE listings
  SET
    min_rent      = (SELECT MIN(ul.rent) FROM unit_leases ul
                       JOIN listing_units lu ON lu.id = ul.unit_id
                       WHERE lu.listing_id = v_listing_id AND ul.is_active = true),
    max_rent      = (SELECT MAX(ul.rent) FROM unit_leases ul
                       JOIN listing_units lu ON lu.id = ul.unit_id
                       WHERE lu.listing_id = v_listing_id AND ul.is_active = true),
    min_bedrooms  = (SELECT MIN(bedrooms)  FROM listing_units WHERE listing_id = v_listing_id),
    max_bedrooms  = (SELECT MAX(bedrooms)  FROM listing_units WHERE listing_id = v_listing_id),
    min_bathrooms = (SELECT MIN(bathrooms) FROM listing_units WHERE listing_id = v_listing_id),
    max_bathrooms = (SELECT MAX(bathrooms) FROM listing_units WHERE listing_id = v_listing_id),
    min_area      = (SELECT MIN(area)      FROM listing_units WHERE listing_id = v_listing_id),
    max_area      = (SELECT MAX(area)      FROM listing_units WHERE listing_id = v_listing_id),
    updated_at    = now()
  WHERE id = v_listing_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attach to unit_leases so rent changes there refresh listings.min_rent/max_rent.
DROP TRIGGER IF EXISTS trg_sync_listing_aggregates_unit_leases ON unit_leases;
CREATE TRIGGER trg_sync_listing_aggregates_unit_leases
  AFTER INSERT OR UPDATE OR DELETE ON unit_leases
  FOR EACH ROW EXECUTE FUNCTION sync_listing_aggregates();

DO $$ BEGIN RAISE NOTICE 'Migration 202604220003: sync_listing_aggregates now pulls rent from unit_leases.'; END $$;
