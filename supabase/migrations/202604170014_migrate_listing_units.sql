-- Migrates listing_units: adds deleted_at. rent + lease_availability drops deferred to Phase 3.

ALTER TABLE listing_units ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- NOTE: Deferred to Phase 3 (0025):
--   DROP COLUMN rent, lease_availability
-- Reason: old main code reads listing_units.rent + lease_availability for price display on
-- every listing card. unit_leases is already populated by 0013 so new code has the data.

-- Ensure FK to listings exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'listing_units' AND constraint_name = 'listing_units_listing_id_fkey'
  ) THEN
    ALTER TABLE listing_units
      ADD CONSTRAINT listing_units_listing_id_fkey
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_listing_units_listing  ON listing_units (listing_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_listing_units_deleted  ON listing_units (deleted_at) WHERE deleted_at IS NULL;

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_units;
  RAISE NOTICE 'Migration 0014: listing_units updated. % rows.', v_count;
END $$;
