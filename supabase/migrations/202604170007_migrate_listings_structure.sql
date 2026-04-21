-- Adds v4 columns to listings and populates home_type_id FK.

ALTER TABLE listings ADD COLUMN IF NOT EXISTS home_type_id  uuid REFERENCES home_types(id);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS city          text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS state         text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS zipcode       text;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;

-- twenty_one_plus and school_id already exist in current schema — ensure FK if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'listings' AND constraint_name = 'listings_school_id_fkey'
  ) THEN
    ALTER TABLE listings
      ADD CONSTRAINT listings_school_id_fkey
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Populate home_type_id from the home_type text column (case-insensitive match).
UPDATE listings l
SET home_type_id = ht.id
FROM home_types ht
WHERE ht.label ILIKE l.home_type
  AND l.home_type_id IS NULL;

-- Any unmatched home_type values fall back to 'Other'.
UPDATE listings l
SET home_type_id = (SELECT id FROM home_types WHERE label = 'Other')
WHERE l.home_type_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_listings_home_type  ON listings (home_type_id);
CREATE INDEX IF NOT EXISTS idx_listings_deleted_at ON listings (deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listings_geo        ON listings (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_listings_school     ON listings (school_id) WHERE school_id IS NOT NULL;

DO $$
DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listings WHERE home_type_id IS NOT NULL;
  RAISE NOTICE 'Migration 0007: % listings updated with home_type_id.', v_count;
END $$;
