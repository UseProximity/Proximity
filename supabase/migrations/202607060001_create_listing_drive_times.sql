-- Creates listing_drive_times and seeds fixed/synthetic driving destinations.
-- Mirrors listing_walk_times. Real candidate POIs are stored in locations,
-- while synthetic *_nearest rows store the per-listing nearest result.

INSERT INTO location_types (name)
VALUES ('poi')
ON CONFLICT (name) DO NOTHING;

-- Static driving destinations + synthetic candidate pools.
-- Existing locations intentionally reused and NOT reinserted:
--   Schnucks (Grocery), Galleria, East End Garage, Millbrook Garage,
--   WC Lower Lot, Snow Way.
INSERT INTO locations (location_type_id, name, latitude, longitude)
SELECT lt.id, v.name, v.lat, v.lng
FROM location_types lt
CROSS JOIN (VALUES
  -- Shopping
  ('Costco (Manchester)',              38.5976541, -90.5066655),
  ('Target (Brentwood)',               38.6279480, -90.3434056),
  ('Trader Joe''s (Brentwood)',        38.6273335, -90.3412312),
  ('Whole Foods (Brentwood)',          38.6271091, -90.3478836),

  -- Attractions
  ('Forest Park (Skinker Entrance)',   38.6492020, -90.3006530),
  ('Delmar Loop',                      38.6558000, -90.3034000),
  ('City Foundry STL',                 38.6330140, -90.2400266),

  -- Travel
  ('Lambert Airport',                  38.7486982, -90.3700257),

  -- Schnucks candidate pool for schnucks_nearest
  ('Schnucks (Richmond Center)',       38.6333967, -90.3147569),
  ('Schnucks (University City)',       38.6633689, -90.3143234),
  ('Schnucks (Ladue)',                 38.6560300, -90.3539800),
  ('Schnucks (Hampton Village)',       38.5916169, -90.2932513),

  -- Candidate pool for pharmacy_nearest
  ('CVS (Delmar)',                     38.6557160, -90.2999950),
  ('CVS (Inside Target Brentwood)',    38.6279480, -90.3434056),
  ('Walgreens (Clayton & Big Bend)',   38.6350307, -90.3175023),
  ('Walgreens (Delmar)',               38.6603240, -90.3546910),

  -- Candidate pool for gas_station_nearest
  ('Amoco (Hi-Pointe)',                38.6334000, -90.3043200),
  ('Mobil (Clayton & Big Bend)',       38.6350117, -90.3193634),
  ('Phillips 66 (Big Bend & 64)',      38.6254000, -90.3364000),
  ('Shell (Maplewood Big Bend)',       38.6119948, -90.3234102),
  ('BP (Webster Groves Big Bend)',     38.5835118, -90.3579921)
) AS v(name, lat, lng)
WHERE lt.name = 'poi'
ON CONFLICT (name) DO NOTHING;

-- Synthetic nearest-drive destinations. Coordinates are placeholders, matching
-- shuttle_nearest. The selected candidate comes from drivePlaces.js / driveTimes.js.
INSERT INTO locations (location_type_id, name, latitude, longitude)
SELECT lt.id, v.name, 0.0000000, 0.0000000
FROM location_types lt
CROSS JOIN (VALUES
  ('schnucks_nearest'),
  ('gas_station_nearest'),
  ('pharmacy_nearest')
) AS v(name)
WHERE lt.name = 'poi'
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS listing_drive_times (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  minutes     integer NOT NULL CHECK (minutes >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_drive_times_listing
  ON listing_drive_times (listing_id);

CREATE INDEX IF NOT EXISTS idx_listing_drive_times_location
  ON listing_drive_times (location_id, minutes);

ALTER TABLE listing_drive_times ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_drive_times_select ON listing_drive_times;
DROP POLICY IF EXISTS listing_drive_times_write ON listing_drive_times;

CREATE POLICY listing_drive_times_select
ON listing_drive_times
FOR SELECT
USING (true);

CREATE POLICY listing_drive_times_write
ON listing_drive_times
FOR ALL
USING (
  fn_current_user_role() = 'super'
  OR EXISTS (
    SELECT 1
    FROM listing_landlords ll
    WHERE ll.listing_id = listing_drive_times.listing_id
      AND ll.user_id = fn_current_user_id()
  )
);

DROP TRIGGER IF EXISTS trg_action_log_listing_drive_times ON listing_drive_times;

CREATE TRIGGER trg_action_log_listing_drive_times
  AFTER INSERT OR UPDATE OR DELETE ON listing_drive_times
  FOR EACH ROW EXECUTE FUNCTION fn_action_log();

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_drive_times;
  RAISE NOTICE 'Migration listing_drive_times created. Current listing_drive_times rows: %', v_count;
END $$;