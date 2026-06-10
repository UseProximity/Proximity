-- Per-unit title + floor plan image, custom per-lease term, and custom amenities.
--   listing_units.title              — landlord-named unit / floor plan (shown instead of "2 Bed / 1 Bath")
--   listing_units.floor_plan_image_url — downloadable floor plan image (R2 URL) per unit
--   unit_leases.lease_term_months    — custom lease duration in months (Semester=5, Summer=4, or any number)
--   listing_custom_amenities         — free-text "other" amenities a landlord can add to a listing

ALTER TABLE listing_units  ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE listing_units  ADD COLUMN IF NOT EXISTS floor_plan_image_url text;
ALTER TABLE unit_leases    ADD COLUMN IF NOT EXISTS lease_term_months integer;

CREATE TABLE IF NOT EXISTS listing_custom_amenities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  label      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_custom_amenities_listing
  ON listing_custom_amenities(listing_id);
