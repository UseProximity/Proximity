-- Creates listing_walk_times and migrates from listings.place_walk_minutes JSONB + shuttle_walk_minutes.
-- JSONB keys (place names) are matched case-insensitively against the locations table.
-- shuttle_walk_minutes maps to the synthetic 'shuttle_nearest' location seeded in migration 0003.

CREATE TABLE IF NOT EXISTS listing_walk_times (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  minutes     integer NOT NULL CHECK (minutes >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, location_id)
);

-- Migrate place_walk_minutes JSONB → listing_walk_times.
-- Matches JSONB keys to location names via LOWER() comparison.
INSERT INTO listing_walk_times (listing_id, location_id, minutes)
SELECT
  l.id,
  loc.id,
  (kv.value #>> '{}')::integer
FROM listings l,
     jsonb_each(l.place_walk_minutes) AS kv(key, value)
JOIN locations loc
  ON LOWER(loc.name) = LOWER(kv.key)
     OR LOWER(REPLACE(loc.name, ' ', '_')) = LOWER(kv.key)
     OR LOWER(REPLACE(loc.name, '_', ' ')) = LOWER(kv.key)
WHERE l.place_walk_minutes IS NOT NULL
  AND kv.value IS NOT NULL
  AND kv.value::text <> 'null'
  AND (kv.value #>> '{}') ~ '^[0-9]+$'
  AND (kv.value #>> '{}')::integer > 0
ON CONFLICT (listing_id, location_id) DO NOTHING;

-- Migrate shuttle_walk_minutes scalar → 'shuttle_nearest' location.
INSERT INTO listing_walk_times (listing_id, location_id, minutes)
SELECT
  l.id,
  loc.id,
  l.shuttle_walk_minutes::integer
FROM listings l
JOIN locations loc ON loc.name = 'shuttle_nearest'
WHERE l.shuttle_walk_minutes IS NOT NULL
  AND l.shuttle_walk_minutes::text ~ '^[0-9]+$'
  AND l.shuttle_walk_minutes::integer > 0
ON CONFLICT (listing_id, location_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_listing_walk_times_listing  ON listing_walk_times (listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_walk_times_location ON listing_walk_times (location_id, minutes);

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_walk_times;
  RAISE NOTICE 'Migration 0012: % listing_walk_times rows migrated.', v_count;
END $$;
