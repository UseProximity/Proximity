-- Phase 3 cleanup — drops legacy columns across all tables.
-- Pre-req: new code is deployed on main (not reading any of the legacy columns below).
--
-- Split by origin migration so each chunk matches the earlier ADD for traceability.

-- ── from 0007/0008/0010/0011/0012 (listings) ─────────────────────────────────
ALTER TABLE listings DROP COLUMN IF EXISTS home_type;
ALTER TABLE listings DROP COLUMN IF EXISTS landlord_id;
ALTER TABLE listings DROP COLUMN IF EXISTS place_walk_minutes;
ALTER TABLE listings DROP COLUMN IF EXISTS shuttle_walk_minutes;
ALTER TABLE listings DROP COLUMN IF EXISTS amenities;
ALTER TABLE listings DROP COLUMN IF EXISTS utilities_included;

-- Aggregate columns replaced by fn_get_listing_aggregates().
ALTER TABLE listings DROP COLUMN IF EXISTS num_reviews;
ALTER TABLE listings DROP COLUMN IF EXISTS rating;
ALTER TABLE listings DROP COLUMN IF EXISTS num_saves;
ALTER TABLE listings DROP COLUMN IF EXISTS num_clicks;

-- images array replaced by listing_images table (backfilled in 0009).
ALTER TABLE listings DROP COLUMN IF EXISTS images;

-- ── from 0004 (users) ────────────────────────────────────────────────────────
-- Backfill any users that main-era INSERTs created without role_id.
UPDATE users u
SET role_id = (SELECT id FROM roles WHERE name = COALESCE(u.role, 'student'))
WHERE u.role_id IS NULL;

-- Fallback for anything still null (unknown `role` strings).
UPDATE users u
SET role_id = (SELECT id FROM roles WHERE name = 'student')
WHERE u.role_id IS NULL;

ALTER TABLE users ALTER COLUMN role_id SET NOT NULL;

ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE users DROP COLUMN IF EXISTS mongo_id;
ALTER TABLE users DROP COLUMN IF EXISTS num_reviews;
ALTER TABLE users DROP COLUMN IF EXISTS rating;

-- ── from 0014 (listing_units) ────────────────────────────────────────────────
-- rent + lease_availability moved to unit_leases in 0013.
ALTER TABLE listing_units DROP COLUMN IF EXISTS rent;
ALTER TABLE listing_units DROP COLUMN IF EXISTS lease_availability;

-- ── from 0015 (listing_metrics_daily) ────────────────────────────────────────
-- Remove rows that still have no metric_type_id (unknown metric types from old inserts).
DELETE FROM listing_metrics_daily WHERE metric_type_id IS NULL;

-- Unique constraint needed for increment_listing_metric ON CONFLICT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'listing_metrics_daily_listing_metric_date_key'
  ) THEN
    ALTER TABLE listing_metrics_daily
      ADD CONSTRAINT listing_metrics_daily_listing_metric_date_key
      UNIQUE (listing_id, metric_type_id, recorded_date);
  END IF;
END $$;

ALTER TABLE listing_metrics_daily DROP COLUMN IF EXISTS metric_type;
ALTER TABLE listing_metrics_daily DROP COLUMN IF EXISTS landlord_id;
ALTER TABLE listing_metrics_daily ALTER COLUMN metric_type_id SET NOT NULL;

-- ── from 0019 + 0020 (dorms / dorm_reviews) ──────────────────────────────────
ALTER TABLE dorms        DROP COLUMN IF EXISTS room_types;
ALTER TABLE dorm_reviews DROP COLUMN IF EXISTS tags;

DO $$ BEGIN RAISE NOTICE 'Migration 0025: legacy columns dropped across listings, users, listing_units, listing_metrics_daily, dorms, dorm_reviews.'; END $$;
