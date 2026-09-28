-- Photos gain a scope: the property, or one unit at it.
--
-- listing_images has always hung off the listing alone, which was right when a
-- listing WAS one landlord's apartment. Now a property carries units from
-- several landlords, and "a photo of the building" and "a photo of Apt 2E" are
-- different things owned by different people — a subletter should be able to
-- picture the unit they are letting without touching the building's record.
--
-- unit_id NULL  = a property photo (every existing row, unchanged)
-- unit_id SET   = a photo of that unit
--
-- ON DELETE SET NULL rather than CASCADE: if a unit is ever hard-deleted its
-- pictures are still pictures of the property, and silently destroying a
-- landlord's uploads is the worse failure. Units are soft-deleted in practice
-- (see the property merge), which this FK never sees.

ALTER TABLE listing_images
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES listing_units(id) ON DELETE SET NULL;

-- Ordering is per-scope: property photos order among themselves, each unit's
-- photos among themselves. This index serves both reads.
CREATE INDEX IF NOT EXISTS listing_images_unit_idx
  ON listing_images (unit_id, sort_order);

-- A photo may only be attached to a unit AT THE SAME PROPERTY. A plain FK
-- cannot express that (it would allow attaching an image on listing A to a unit
-- of listing B), and a CHECK cannot run a subquery, so it is a trigger.
CREATE OR REPLACE FUNCTION trg_listing_images_unit_matches_listing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_listing_id uuid;
BEGIN
  IF NEW.unit_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT listing_id INTO v_listing_id FROM listing_units WHERE id = NEW.unit_id;

  IF v_listing_id IS NULL OR v_listing_id <> NEW.listing_id THEN
    RAISE EXCEPTION
      'Image listing (%) does not match the unit''s property (%)', NEW.listing_id, v_listing_id
      USING ERRCODE = 'check_violation',
            HINT = 'Attach the photo to a unit at the same property, or leave unit_id null for a property photo.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS listing_images_unit_matches_listing ON listing_images;
CREATE TRIGGER listing_images_unit_matches_listing
  BEFORE INSERT OR UPDATE OF unit_id, listing_id ON listing_images
  FOR EACH ROW EXECUTE FUNCTION trg_listing_images_unit_matches_listing();
