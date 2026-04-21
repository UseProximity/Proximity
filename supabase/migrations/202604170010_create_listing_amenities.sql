-- Rebuilds listing_amenities from junction table (listing_id, amenity_id) to boolean-column table.
-- Also merges from listings.amenities text[] if that column exists.
-- Adds gym + pool columns found in the amenities lookup table.
-- Merge mappings: ac_heating/AC/HEATING → air_conditioning, extra_storage/Bike Storage/Storage → storage,
-- Parking/private_parking → parking, Pets Allowed/pets_allowed → pets_allowed, Laundry/in_unit_laundry → laundry.

DO $$
BEGIN
  -- Old junction table exists: migrate data from it, then replace with boolean-column table.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listing_amenities' AND column_name = 'amenity_id'
  ) THEN

    CREATE TEMP TABLE _amenity_merge AS
    SELECT
      la.listing_id,
      bool_or(LOWER(a.name) IN ('ac_heating','ac/heating','air_conditioning','air conditioning')) AS air_conditioning,
      bool_or(LOWER(a.name) = 'dishwasher')                                                       AS dishwasher,
      bool_or(LOWER(a.name) = 'gym')                                                              AS gym,
      bool_or(LOWER(a.name) IN ('laundry','in_unit_laundry','in-unit laundry'))                   AS laundry,
      bool_or(LOWER(a.name) = 'mailroom')                                                         AS mailroom,
      bool_or(LOWER(a.name) = 'microwave')                                                        AS microwave,
      bool_or(LOWER(a.name) = 'oven')                                                             AS oven,
      bool_or(LOWER(a.name) IN ('parking','private_parking','private parking'))                   AS parking,
      bool_or(LOWER(a.name) IN ('pets_allowed','pets allowed','pet friendly','pet_friendly'))      AS pets_allowed,
      bool_or(LOWER(a.name) = 'pool')                                                             AS pool,
      bool_or(LOWER(a.name) = 'refrigerator')                                                     AS refrigerator,
      bool_or(LOWER(a.name) = 'rooftop')                                                          AS rooftop,
      bool_or(LOWER(a.name) IN ('storage','extra_storage','extra storage','bike storage','bike_storage')) AS storage,
      bool_or(LOWER(a.name) = 'stove')                                                            AS stove,
      bool_or(LOWER(a.name) IN ('study_room','study room'))                                       AS study_room
    FROM listing_amenities la
    JOIN amenities a ON a.id = la.amenity_id
    GROUP BY la.listing_id;

    DROP TABLE listing_amenities CASCADE;

    CREATE TABLE listing_amenities (
      listing_id       uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      air_conditioning boolean NOT NULL DEFAULT false,
      dishwasher       boolean NOT NULL DEFAULT false,
      gym              boolean NOT NULL DEFAULT false,
      laundry          boolean NOT NULL DEFAULT false,
      mailroom         boolean NOT NULL DEFAULT false,
      microwave        boolean NOT NULL DEFAULT false,
      oven             boolean NOT NULL DEFAULT false,
      parking          boolean NOT NULL DEFAULT false,
      pets_allowed     boolean NOT NULL DEFAULT false,
      pool             boolean NOT NULL DEFAULT false,
      refrigerator     boolean NOT NULL DEFAULT false,
      rooftop          boolean NOT NULL DEFAULT false,
      storage          boolean NOT NULL DEFAULT false,
      stove            boolean NOT NULL DEFAULT false,
      study_room       boolean NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO listing_amenities (
      listing_id, air_conditioning, dishwasher, gym, laundry, mailroom, microwave,
      oven, parking, pets_allowed, pool, refrigerator, rooftop, storage, stove, study_room
    )
    SELECT
      listing_id, air_conditioning, dishwasher, gym, laundry, mailroom, microwave,
      oven, parking, pets_allowed, pool, refrigerator, rooftop, storage, stove, study_room
    FROM _amenity_merge
    ON CONFLICT DO NOTHING;

    DROP TABLE _amenity_merge;

  -- No junction table: create fresh boolean-column table.
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'listing_amenities'
  ) THEN
    CREATE TABLE listing_amenities (
      listing_id       uuid PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      air_conditioning boolean NOT NULL DEFAULT false,
      dishwasher       boolean NOT NULL DEFAULT false,
      gym              boolean NOT NULL DEFAULT false,
      laundry          boolean NOT NULL DEFAULT false,
      mailroom         boolean NOT NULL DEFAULT false,
      microwave        boolean NOT NULL DEFAULT false,
      oven             boolean NOT NULL DEFAULT false,
      parking          boolean NOT NULL DEFAULT false,
      pets_allowed     boolean NOT NULL DEFAULT false,
      pool             boolean NOT NULL DEFAULT false,
      refrigerator     boolean NOT NULL DEFAULT false,
      rooftop          boolean NOT NULL DEFAULT false,
      storage          boolean NOT NULL DEFAULT false,
      stove            boolean NOT NULL DEFAULT false,
      study_room       boolean NOT NULL DEFAULT false,
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

-- Also merge from listings.amenities text[] if that column exists (covers data added via API).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'amenities'
  ) THEN
    INSERT INTO listing_amenities (
      listing_id, air_conditioning, dishwasher, gym, laundry, mailroom, microwave,
      oven, parking, pets_allowed, pool, refrigerator, rooftop, storage, stove, study_room
    )
    SELECT
      l.id,
      bool_or(LOWER(a) IN ('ac_heating','ac/heating','air_conditioning','air conditioning')) AS air_conditioning,
      bool_or(LOWER(a) = 'dishwasher')                                                       AS dishwasher,
      bool_or(LOWER(a) = 'gym')                                                              AS gym,
      bool_or(LOWER(a) IN ('laundry','in_unit_laundry','in-unit laundry'))                   AS laundry,
      bool_or(LOWER(a) = 'mailroom')                                                         AS mailroom,
      bool_or(LOWER(a) = 'microwave')                                                        AS microwave,
      bool_or(LOWER(a) = 'oven')                                                             AS oven,
      bool_or(LOWER(a) IN ('parking','private_parking','private parking'))                   AS parking,
      bool_or(LOWER(a) IN ('pets_allowed','pets allowed','pet friendly','pet_friendly'))      AS pets_allowed,
      bool_or(LOWER(a) = 'pool')                                                             AS pool,
      bool_or(LOWER(a) = 'refrigerator')                                                     AS refrigerator,
      bool_or(LOWER(a) = 'rooftop')                                                          AS rooftop,
      bool_or(LOWER(a) IN ('storage','extra_storage','extra storage','bike storage','bike_storage')) AS storage,
      bool_or(LOWER(a) = 'stove')                                                            AS stove,
      bool_or(LOWER(a) IN ('study_room','study room'))                                       AS study_room
    FROM listings l, unnest(l.amenities) AS a
    WHERE l.amenities IS NOT NULL AND array_length(l.amenities, 1) > 0
    GROUP BY l.id
    ON CONFLICT (listing_id) DO UPDATE SET
      air_conditioning = listing_amenities.air_conditioning OR EXCLUDED.air_conditioning,
      dishwasher       = listing_amenities.dishwasher       OR EXCLUDED.dishwasher,
      gym              = listing_amenities.gym              OR EXCLUDED.gym,
      laundry          = listing_amenities.laundry          OR EXCLUDED.laundry,
      mailroom         = listing_amenities.mailroom         OR EXCLUDED.mailroom,
      microwave        = listing_amenities.microwave        OR EXCLUDED.microwave,
      oven             = listing_amenities.oven             OR EXCLUDED.oven,
      parking          = listing_amenities.parking          OR EXCLUDED.parking,
      pets_allowed     = listing_amenities.pets_allowed     OR EXCLUDED.pets_allowed,
      pool             = listing_amenities.pool             OR EXCLUDED.pool,
      refrigerator     = listing_amenities.refrigerator     OR EXCLUDED.refrigerator,
      rooftop          = listing_amenities.rooftop          OR EXCLUDED.rooftop,
      storage          = listing_amenities.storage          OR EXCLUDED.storage,
      stove            = listing_amenities.stove            OR EXCLUDED.stove,
      study_room       = listing_amenities.study_room       OR EXCLUDED.study_room;
  END IF;
END $$;

-- Ensure every active listing has a row (defaults all false).
INSERT INTO listing_amenities (listing_id)
SELECT l.id FROM listings l
WHERE l.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM listing_amenities la WHERE la.listing_id = l.id)
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_listing_amenities_parking  ON listing_amenities (listing_id) WHERE parking = true;
CREATE INDEX IF NOT EXISTS idx_listing_amenities_pets     ON listing_amenities (listing_id) WHERE pets_allowed = true;
CREATE INDEX IF NOT EXISTS idx_listing_amenities_laundry  ON listing_amenities (listing_id) WHERE laundry = true;

DO $$ DECLARE v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM listing_amenities;
  RAISE NOTICE 'Migration 0010: listing_amenities rebuilt. % rows.', v_count;
END $$;
