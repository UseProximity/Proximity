-- Rebuilds listing_utilities from junction table (listing_id, utility_id) to boolean-column table.
-- Also merges from listings.utilities_included text[] if that column exists.
-- Exact utility names in DB: cable, cooling, electricity, gas, heating, internet, sewer, trash, water.
-- Mappings: electricity → electric, heating → heat. All others map directly.

DO $$
BEGIN
  -- Old junction table exists: migrate data from it, then replace with boolean-column table.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_utilities' AND column_name = 'utility_id'
  ) THEN

    CREATE TEMP TABLE _utility_merge AS
    SELECT
      lu.listing_id,
      bool_or(LOWER(u.name) IN ('electric','electricity')) AS electric,
      bool_or(LOWER(u.name) = 'gas')                       AS gas,
      bool_or(LOWER(u.name) IN ('heat','heating'))          AS heat,
      bool_or(LOWER(u.name) = 'water')                     AS water,
      bool_or(LOWER(u.name) IN ('internet','wifi','wi-fi')) AS internet,
      bool_or(LOWER(u.name) = 'trash')                     AS trash,
      bool_or(LOWER(u.name) = 'cable')                     AS cable,
      bool_or(LOWER(u.name) = 'sewer')                     AS sewer,
      bool_or(LOWER(u.name) = 'cooling')                   AS cooling
    FROM listing_utilities lu
    JOIN utilities u ON u.id = lu.utility_id
    GROUP BY lu.listing_id;

    DROP TABLE listing_utilities CASCADE;

    CREATE TABLE listing_utilities (
      listing_id  uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      electric    boolean NOT NULL DEFAULT false,
      gas         boolean NOT NULL DEFAULT false,
      heat        boolean NOT NULL DEFAULT false,
      water       boolean NOT NULL DEFAULT false,
      internet    boolean NOT NULL DEFAULT false,
      trash       boolean NOT NULL DEFAULT false,
      cable       boolean NOT NULL DEFAULT false,
      sewer       boolean NOT NULL DEFAULT false,
      cooling     boolean NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO listing_utilities (
      listing_id, electric, gas, heat, water, internet, trash, cable, sewer, cooling
    )
    SELECT
      listing_id, electric, gas, heat, water, internet, trash, cable, sewer, cooling
    FROM _utility_merge
    ON CONFLICT DO NOTHING;

    DROP TABLE _utility_merge;

  -- No junction table: create fresh boolean-column table.
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'listing_utilities'
  ) THEN
    CREATE TABLE listing_utilities (
      listing_id  uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      electric    boolean NOT NULL DEFAULT false,
      gas         boolean NOT NULL DEFAULT false,
      heat        boolean NOT NULL DEFAULT false,
      water       boolean NOT NULL DEFAULT false,
      internet    boolean NOT NULL DEFAULT false,
      trash       boolean NOT NULL DEFAULT false,
      cable       boolean NOT NULL DEFAULT false,
      sewer       boolean NOT NULL DEFAULT false,
      cooling     boolean NOT NULL DEFAULT false,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

-- Also merge from listings.utilities_included text[] if that column exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'utilities_included'
  ) THEN
    INSERT INTO listing_utilities (
      listing_id, electric, gas, heat, water, internet, trash, cable, sewer, cooling
    )
    SELECT
      l.id,
      bool_or(LOWER(u) IN ('electric','electricity')) AS electric,
      bool_or(LOWER(u) = 'gas')                       AS gas,
      bool_or(LOWER(u) IN ('heat','heating'))          AS heat,
      bool_or(LOWER(u) = 'water')                     AS water,
      bool_or(LOWER(u) IN ('internet','wifi','wi-fi')) AS internet,
      bool_or(LOWER(u) = 'trash')                     AS trash,
      bool_or(LOWER(u) = 'cable')                     AS cable,
      bool_or(LOWER(u) = 'sewer')                     AS sewer,
      bool_or(LOWER(u) = 'cooling')                   AS cooling
    FROM listings l, unnest(l.utilities_included) AS u
    WHERE l.utilities_included IS NOT NULL AND array_length(l.utilities_included, 1) > 0
    GROUP BY l.id
    ON CONFLICT (listing_id) DO UPDATE SET
      electric = listing_utilities.electric OR EXCLUDED.electric,
      gas      = listing_utilities.gas      OR EXCLUDED.gas,
      heat     = listing_utilities.heat     OR EXCLUDED.heat,
      water    = listing_utilities.water    OR EXCLUDED.water,
      internet = listing_utilities.internet OR EXCLUDED.internet,
      trash    = listing_utilities.trash    OR EXCLUDED.trash,
      cable    = listing_utilities.cable    OR EXCLUDED.cable,
      sewer    = listing_utilities.sewer    OR EXCLUDED.sewer,
      cooling  = listing_utilities.cooling  OR EXCLUDED.cooling;
  END IF;
END $$;

-- Ensure every active listing has a row (defaults all false).
INSERT INTO listing_utilities (listing_id)
SELECT l.id FROM listings l
WHERE l.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM listing_utilities lu WHERE lu.listing_id = l.id)
ON CONFLICT DO NOTHING;

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_utilities;
  RAISE NOTICE 'Migration 0011: listing_utilities rebuilt. % rows.', v_count;
END $$;
